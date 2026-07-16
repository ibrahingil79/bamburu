import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { ENTITY } from './activity-entities.js';

// ── Role permissions ───────────────────────────────────────────
export const PERMS = {
  owner:    ['*'],
  admin:    ['*'],
  employee: [],
  readonly: [],
};

export function requirePerm(perm) {
  return async (c, next) => {
    const s = c.get('session');
    if (!s) return c.redirect('/admin/login');
    if (s.role === 'owner' || s.role === 'admin') return next();

    const db = c.get('db');
    const [module, action] = perm.split('.');
    const row = db.prepare(`
      SELECT 1 FROM user_permissions up
      JOIN permissions p ON up.permission_id = p.id
      WHERE up.admin_user_id = ? AND p.module = ? AND p.action = ?
    `).get(s.userId, module, action);
    if (row) return next();

    return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>window.addEventListener('DOMContentLoaded',function(){if(typeof showAccessDenied==='function')showAccessDenied();else alert('Acceso no permitido');});<\/script></body></html>`, 403);
  };
}

function hashPasswordLegacy(password) {
  return createHash('sha256').update('bamburu_2026_' + password).digest('hex');
}

// Coste de bcrypt para contraseñas NUEVAS (opción A del diagnóstico de carga). Era 12: cada
// login costaba ~242 ms de CPU en este servidor y el pool de libuv (4 hilos) saturaba los 4
// cores. A 10 baja a ~61 ms —del orden de 4×— y sigue por encima del mínimo que recomienda
// OWASP. Cambiar esta constante migra a todo el mundo solo, vía needsRehash (abajo).
export const BCRYPT_COST = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

// Coste con el que se generó un hash bcrypt ('$2b$12$...' → 12). null si no se puede leer.
function bcryptCost(hash) {
  try { return bcrypt.getRounds(hash); } catch { return null; }
}

export async function verifyPassword(password, storedHash) {
  if (storedHash.startsWith('$2')) {
    const valid = await bcrypt.compare(password, storedHash);
    // Un hash bcrypt con un coste DISTINTO al vigente también hay que renovarlo: quien entra
    // con una contraseña guardada a coste 12 sale con ella guardada a coste 10, sin enterarse.
    // Antes esto devolvía siempre `false`, así que un cambio de coste no migraba a nadie: solo
    // se renovaban los hashes del sistema viejo (sha256). Vale en los dos sentidos (subir o
    // bajar el coste). Solo si la contraseña es correcta: renovar exige el texto plano.
    return { valid, needsRehash: valid && bcryptCost(storedHash) !== BCRYPT_COST };
  }
  const valid = hashPasswordLegacy(password) === storedHash;
  if (valid) return { valid: true, needsRehash: true };
  return { valid: false, needsRehash: false };
}

export { hashPasswordLegacy };

// ── Admin sessions ─────────────────────────────────────────────

export function createAdminSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 24 * 60 * 60;
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(token, userId, now, expires, csrfToken);
  return token;
}

export function getAdminSession(db, req) {
  const cookie = req.header('cookie') || '';
  const match = cookie.match(/asess=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const token = match[1];
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(`
    SELECT s.expires_at, s.user_id, s.csrf_token, u.name, u.role, u.active
    FROM admin_sessions s
    JOIN admin_users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
    return null;
  }
  // C5/M5: desactivado = fuera AHORA, no cuando caduque. Este es el sitio donde se decide, no la
  // ruta que desactiva: así cualquier vía que ponga active=0 (el panel, un script de ops, un UPDATE
  // a mano) expulsa igual. La ruta además borra las sesiones, pero ese borrado es higiene; el gate
  // es este. Antes el JOIN traía al usuario sin mirar `active` y la sesión aguantaba hasta 24 h.
  if (!row.active) {
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
    return null;
  }
  return { token, userId: row.user_id, userName: row.name, role: row.role, expiresAt: row.expires_at, csrfToken: row.csrf_token };
}

export function destroyAdminSession(db, token) {
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
}

export function destroyAllAdminSessionsForUser(db, userId, exceptToken = null) {
  db.prepare('DELETE FROM admin_sessions WHERE user_id=? AND token != COALESCE(?,\'\')').run(userId, exceptToken);
}

// ── C5-bis · 2FA del DUEÑO: secreto + códigos de rescate ───────────────────────
//
// Espejo fiel del mecanismo del superadmin (core/control-db.js), pero por negocio: aquel vive en
// control.db con `superadmin_id`; este, en la BD del tenant con `admin_user_id`. Por eso recibe `db`
// y no hay tabla compartida: no se comparte la base. La generación de los códigos SÍ es común y no se
// duplica — sale de core/recovery-codes.js, que ya era genérico.
//
// El secreto TOTP y los códigos se mueven JUNTOS y siempre por aquí: activar sin códigos de rescate,
// o dejar códigos vivos tras desactivar, son las dos formas de que esto salga mal.

export function enableAdminTotp(db, userId, secret, codeHashes) {
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    db.prepare('UPDATE admin_users SET totp_secret=?, totp_enabled=1 WHERE id=?').run(secret, userId);
    // Activar SUSTITUYE los códigos anteriores: si se reconfigura el 2FA, los papeles viejos dejan de
    // valer en el mismo instante. Si no, un código impreso hace meses seguiría abriendo la puerta.
    db.prepare('DELETE FROM admin_recovery_codes WHERE admin_user_id=?').run(userId);
    const ins = db.prepare('INSERT INTO admin_recovery_codes (admin_user_id, code_hash, created_at) VALUES (?,?,?)');
    for (const h of codeHashes) ins.run(userId, h, now);
  });
  tx();
}

// Desactivar borra el secreto Y los códigos: un código de rescate que sobreviva al 2FA que rescataba
// es una segunda llave olvidada debajo del felpudo.
export function disableAdminTotp(db, userId) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE admin_users SET totp_secret=NULL, totp_enabled=0 WHERE id=?').run(userId);
    db.prepare('DELETE FROM admin_recovery_codes WHERE admin_user_id=?').run(userId);
  });
  tx();
}

export function listUnusedAdminRecoveryCodes(db, userId) {
  try {
    return db.prepare('SELECT id, code_hash FROM admin_recovery_codes WHERE admin_user_id=? AND used_at IS NULL').all(userId);
  } catch (_) { return []; }   // BD sin migrar todavía: sin códigos, no sin login
}

// Marca el código como gastado. Devuelve false si otro lo gastó primero: el UPDATE lleva
// `used_at IS NULL`, así que dos intentos con el mismo código a la vez solo dejan pasar a uno.
export function consumeAdminRecoveryCode(db, rowId) {
  const r = db.prepare('UPDATE admin_recovery_codes SET used_at=? WHERE id=? AND used_at IS NULL')
    .run(Math.floor(Date.now() / 1000), rowId);
  return r.changes === 1;
}

export function countUnusedAdminRecoveryCodes(db, userId) {
  try {
    return db.prepare('SELECT COUNT(*) n FROM admin_recovery_codes WHERE admin_user_id=? AND used_at IS NULL').get(userId).n;
  } catch (_) { return 0; }
}

// ── Customer sessions ──────────────────────────────────────────

export function createCustomerSession(db, accountId) {
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 7 * 24 * 60 * 60;
  db.prepare('INSERT INTO customer_sessions (token, account_id, created_at, expires_at) VALUES (?,?,?,?)').run(token, accountId, now, expires);
  return token;
}

export function getCustomerSession(db, req) {
  const cookie = req.header('cookie') || '';
  const match = cookie.match(/csess=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const token = match[1];
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare('SELECT account_id, expires_at FROM customer_sessions WHERE token=?').get(token);
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM customer_sessions WHERE token=?').run(token);
    return null;
  }
  return { token, customerId: row.account_id, expiresAt: row.expires_at };
}

export function destroyCustomerSession(db, token) {
  db.prepare('DELETE FROM customer_sessions WHERE token=?').run(token);
}

export function destroyAllCustomerSessionsForAccount(db, accountId, exceptToken = null) {
  db.prepare('DELETE FROM customer_sessions WHERE account_id=? AND token != COALESCE(?,\'\')').run(accountId, exceptToken);
}

// ── Cleanup ────────────────────────────────────────────────────

export function cleanupExpiredSessions(db) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').run(now);
}

// ── Middleware ─────────────────────────────────────────────────

export function adminAuth(db) {
  return async (c, next) => {
    const session = getAdminSession(db, c.req);
    if (!session) {
      if (c.req.path.startsWith('/api/')) return c.json({ error: 'No autorizado' }, 401);
      return c.redirect('/admin/login');
    }
    c.set('session', session);
    const isOwner = session.role === 'owner';
    const isAdmin = session.role === 'admin' || isOwner;
    c.set('isOwner', isOwner);
    c.set('isAdmin', isAdmin);
    try {
      const userPerms = db.prepare(`
        SELECT p.module, p.action FROM user_permissions up
        JOIN permissions p ON up.permission_id = p.id
        WHERE up.admin_user_id = ?
      `).all(session.userId).map(p => p.module + '.' + p.action);
      c.set('userPerms', userPerms);
    } catch (_) {
      c.set('userPerms', []);
    }
    const user = db.prepare('SELECT must_change_password FROM admin_users WHERE id=?').get(session.userId);
    if (user && user.must_change_password === 1) {
      const path = c.req.path;
      const allowed = path === '/admin/change-password' || path === '/admin/logout';
      if (!allowed) {
        if (path.startsWith('/api/')) return c.json({ error: 'Debes cambiar tu contraseña' }, 403);
        return c.redirect('/admin/change-password');
      }
    }
    return next();
  };
}

export function getCsrfToken(c) {
  const session = c.get('session');
  return session?.csrfToken || '';
}

export function logActivity(db, session, action, entity = '', entityId = null, details = '') {
  try {
    db.prepare('INSERT INTO activity_logs (user_id, user_name, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)')
      .run(session?.userId || null, session?.userName || 'Sistema', action, entity, entityId, details);
  } catch (_) {}
}

// ── Cambio de contraseña del PROPIO usuario ────────────────────
// FUENTE ÚNICA. La usan la pantalla-cerrojo (/admin/change-password, obligatorio por
// must_change_password) y el Perfil (/admin/perfil, voluntario). Antes esta lógica estaba
// duplicada en dos rutas, y una de las copias no registraba en Actividad.
// Devuelve { ok:true, forced } o { ok:false, error } — NUNCA lanza; quien llama decide
// cómo presentar el error (redirect con ?error= o JSON para el toast).
export async function changeOwnPassword(db, session, { current = '', nuevo = '', confirm = '' }) {
  if (!current || !nuevo || !confirm) return { ok: false, error: 'Todos los campos son obligatorios.' };
  if (nuevo.length < 10) return { ok: false, error: 'La nueva contraseña debe tener al menos 10 caracteres.' };
  if (nuevo !== confirm) return { ok: false, error: 'Las contraseñas nuevas no coinciden.' };
  if (nuevo === current) return { ok: false, error: 'La nueva contraseña debe ser diferente a la actual.' };

  const user = db.prepare('SELECT * FROM admin_users WHERE id=?').get(session.userId);
  if (!user) return { ok: false, error: 'Usuario no encontrado.' };
  const result = await verifyPassword(current, user.password_hash);
  if (!result.valid) return { ok: false, error: 'La contraseña actual es incorrecta.' };

  const forced = user.must_change_password === 1;
  const newHash = await hashPassword(nuevo);
  db.prepare('UPDATE admin_users SET password_hash=?, must_change_password=0 WHERE id=?')
    .run(newHash, session.userId);
  // Convención del resto del código: action = frase humana, entity = tipo, entityId = id.
  logActivity(db, session,
    forced ? 'Cambió su contraseña (cambio obligatorio)' : 'Cambió su contraseña',
    ENTITY.ADMIN_USER, session.userId);
  // Cierra las demás sesiones del usuario; conserva la actual.
  destroyAllAdminSessionsForUser(db, session.userId, session.token);

  return { ok: true, forced };
}
