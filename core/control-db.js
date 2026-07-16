import Database from 'better-sqlite3';
import path from 'path';
import { randomBytes } from 'crypto';

// Tope al que SQLite TRUNCA el fichero -wal después de cada checkpoint. Sin esto
// (`journal_size_limit = -1`, el defecto), el WAL nunca se encoge: se resetea por dentro y se
// REUTILIZA en el sitio, así que el fichero se queda para siempre en su marca máxima.
//
// El diagnóstico del 10-jul leyó eso como "el WAL crece sin límite y no hace checkpoint". No era
// verdad: el checkpoint SÍ corría (un PASSIVE a mano devolvía busy=0 y copiaba todas las páginas), y
// los 4,1 MB no eran descontrol sino exactamente el umbral de `wal_autocheckpoint` (1000 páginas ×
// 4096 B). Lo que faltaba era esto: que el fichero se TRUNQUE al terminar.
//
// Importa de verdad ante un imprevisto: si algún día una lectura larga bloquea los checkpoints, el
// WAL se hincha — y sin este tope, ese tamaño se queda como marca máxima PARA SIEMPRE. Con él, en
// cuanto el checkpoint vuelve a correr, el espacio se devuelve al disco.
export const WAL_SIZE_LIMIT = 4 * 1024 * 1024;   // 4 MiB

// BD central de control: registra todos los tenants y sus sesiones.
// Es independiente de las BDs individuales de cada negocio.
const CONTROL_DB_PATH = path.join(process.cwd(), 'data', 'control.db');
export const controlDb = new Database(CONTROL_DB_PATH);
controlDb.pragma('journal_mode = WAL');
controlDb.pragma('foreign_keys = ON');
controlDb.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT}`);

// ---------------------------------------------------------------------------
// Migraciones — idempotentes (IF NOT EXISTS)
// ---------------------------------------------------------------------------

function runMigrations(db) {
  // Registro de negocios (uno por fila)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      slug         TEXT    UNIQUE NOT NULL,
      db_filename  TEXT    UNIQUE NOT NULL,
      plan         TEXT    DEFAULT 'starter',
      status       TEXT    DEFAULT 'active',
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.exec("ALTER TABLE tenants ADD COLUMN country TEXT DEFAULT 'ES'");
  } catch {}

  // Suspensión por el superadmin (estado vive en control.db; status ∈
  // active | suspended_admin (solo lectura) | suspended_security (corte total)).
  try { db.exec("ALTER TABLE tenants ADD COLUMN suspended_at DATETIME"); } catch {}
  try { db.exec("ALTER TABLE tenants ADD COLUMN suspend_note TEXT"); } catch {}

  // Sesiones cross-tenant: relaciona una cookie con un usuario de un tenant
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER  NOT NULL,
      session_token TEXT     UNIQUE NOT NULL,
      user_id       INTEGER  NOT NULL,
      user_email    TEXT     NOT NULL,
      user_role     TEXT,
      expires_at    DATETIME NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);

  // Valores de configuración de la plataforma (clave/valor libre)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Acumulador GLOBAL del gasto de Anthropic por mes natural (freno anti-avalancha de gasto).
  // El gasto por-negocio vive en la BD de cada tenant (tabla disa_spend); este es la suma global.
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_spend_global (
      month      TEXT PRIMARY KEY,
      eur        REAL    NOT NULL DEFAULT 0,
      alerted_80 INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Configuración de países disponibles en la plataforma
  db.exec(`
    CREATE TABLE IF NOT EXISTS country_configs (
      code            TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      currency        TEXT NOT NULL,
      currency_symbol TEXT NOT NULL,
      tax_name        TEXT NOT NULL,
      tax_rates       TEXT NOT NULL,
      tax_default     REAL NOT NULL,
      fiscal_id_label TEXT NOT NULL,
      document_name   TEXT NOT NULL
    )
  `);
  db.exec(`
    INSERT OR IGNORE INTO country_configs VALUES
    ('ES','España','EUR','€','IVA','21,10,4',21.0,'NIF/CIF','Factura'),
    ('MX','México','MXN','$','IVA','16,8,0',16.0,'RFC','CFDI'),
    ('CO','Colombia','COP','$','IVA','19,5,0',19.0,'NIT','Factura electrónica')
  `);

  // Superadmin (sala de máquinas de la plataforma) — identidad SEPARADA del admin de negocios.
  db.exec(`
    CREATE TABLE IF NOT EXISTS superadmins (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      email                TEXT UNIQUE NOT NULL,
      password_hash        TEXT NOT NULL,
      totp_secret          TEXT DEFAULT NULL,
      totp_enabled         INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS superadmin_sessions (
      token         TEXT PRIMARY KEY,
      superadmin_id INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      csrf_token    TEXT NOT NULL
    )
  `);
  // C5/M3 — códigos de rescate del 2FA del superadmin. Existen para que perder el móvil no sea
  // perder la plataforma. Se guardan HASHEADOS (bcrypt), como una contraseña: si alguien lee esta
  // tabla no puede entrar con lo que ve. `used_at` en vez de borrar la fila: un código gastado deja
  // rastro de CUÁNDO se gastó, que es justo lo que querrías saber si un día se gasta uno que tú no
  // usaste. Aditiva e idempotente: si la tabla ya está, esto no hace nada.
  db.exec(`
    CREATE TABLE IF NOT EXISTS superadmin_recovery_codes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      superadmin_id INTEGER NOT NULL,
      code_hash     TEXT NOT NULL,
      used_at       INTEGER DEFAULT NULL,
      created_at    INTEGER NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_sa_recovery_owner ON superadmin_recovery_codes (superadmin_id, used_at)');

  // Vigilancia del superadmin (tablas RODANTES: se conservan las últimas ~1000 filas).
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      type        TEXT NOT NULL,
      ip          TEXT,
      tenant_slug TEXT,
      detail      TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      tenant_slug TEXT,
      method      TEXT,
      path        TEXT,
      message     TEXT
    )
  `);

  // Resultado del ÚLTIMO chequeo de integridad de facturas por negocio (zona 3 del panel).
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrity_checks (
      tenant_slug TEXT PRIMARY KEY,
      ts          INTEGER NOT NULL,
      ok          INTEGER NOT NULL,
      total       INTEGER NOT NULL DEFAULT 0,
      detail      TEXT
    )
  `);
}

// ---------------------------------------------------------------------------
// Inicialización — llamar una sola vez al arrancar el servidor
// ---------------------------------------------------------------------------

export function initControlDb() {
  runMigrations(controlDb);
  return controlDb;
}

// ---------------------------------------------------------------------------
// Helpers de lectura (solo SELECT; escritura en tarea 4)
// ---------------------------------------------------------------------------

// Resuelve un subdominio al tenant correspondiente.
// Devuelve la fila completa o null si no existe.
export function getTenantBySlug(slug) {
  return controlDb
    .prepare('SELECT * FROM tenants WHERE slug = ?')
    .get(slug) ?? null;
}

// Devuelve el tenant por su ID interno o null si no existe.
export function getTenantById(id) {
  return controlDb
    .prepare('SELECT * FROM tenants WHERE id = ?')
    .get(id) ?? null;
}

// Valida una cookie de sesión y devuelve { session, tenant } o null.
// El portero usa esto para autenticar cada petición.
export function getSessionByToken(token) {
  const session = controlDb
    .prepare('SELECT * FROM tenant_sessions WHERE session_token = ? AND expires_at > CURRENT_TIMESTAMP')
    .get(token);
  if (!session) return null;

  const tenant = getTenantById(session.tenant_id);
  if (!tenant) return null;

  return { session, tenant };
}

// ---------------------------------------------------------------------------
// Helpers de escritura (tarea 4)
// ---------------------------------------------------------------------------

export function createTenant({ name, slug, db_filename, plan = 'starter', country = 'ES' }) {
  const result = controlDb
    .prepare(`INSERT INTO tenants (name, slug, db_filename, plan, country) VALUES (?, ?, ?, ?, ?)`)
    .run(name, slug, db_filename, plan, country);
  return getTenantById(result.lastInsertRowid);
}

export function createTenantSession({ tenant_id, session_token, user_id, user_email, user_role, expires_at }) {
  const result = controlDb
    .prepare(`INSERT INTO tenant_sessions
      (tenant_id, session_token, user_id, user_email, user_role, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(tenant_id, session_token, user_id, user_email, user_role, expires_at);
  return controlDb.prepare('SELECT * FROM tenant_sessions WHERE id = ?').get(result.lastInsertRowid);
}

// Borra el vínculo sesión→negocio (al cerrar sesión). Idempotente.
export function destroyTenantSession(token) {
  controlDb.prepare('DELETE FROM tenant_sessions WHERE session_token = ?').run(token);
}

export function getCountryConfig(code) {
  return controlDb
    .prepare('SELECT * FROM country_configs WHERE code = ?')
    .get(code) ?? null;
}

export function getAllCountryConfigs() {
  return controlDb
    .prepare('SELECT * FROM country_configs ORDER BY name')
    .all();
}

// Abre la .db de un negocio en SOLO LECTURA, para consultarla desde fuera de su petición.
//
// SOLO LECTURA a propósito. Buscar un email recorre la .db de CADA negocio activo, y abrirlas en
// modo escritura —como se hacía— tenía dos pegas: (1) una conexión de escritura más contra el mismo
// fichero, que se serializa con la del propio negocio (el patrón que el diagnóstico de carga marcó
// como riesgo; el mismo que se corrigió en superadmin), y (2) si el fichero NO existía, SQLite lo
// CREABA vacío en el intento — dejando una .db fantasma por cada tenant descuadrado. `readonly` no
// compite por el bloqueo de escritura, y `fileMustExist` hace que un fichero ausente falle en vez de
// nacer. Los errores los traga quien llama (un tenant ilegible simplemente no coincide).
function openTenantReadonly(tenant) {
  const abs = path.isAbsolute(tenant.db_filename)
    ? tenant.db_filename
    : path.join(process.cwd(), tenant.db_filename);
  return new Database(abs, { readonly: true, fileMustExist: true });
}

// ¿En qué negocio activo es este email un admin? Devuelve el PRIMERO que coincida (o null).
export function getTenantByEmail(email) {
  const tenants = controlDb
    .prepare("SELECT * FROM tenants WHERE status='active'")
    .all();

  for (const tenant of tenants) {
    try {
      const db = openTenantReadonly(tenant);
      const user = db
        .prepare('SELECT id FROM admin_users WHERE email=? AND active=1')
        .get(email);
      db.close();
      if (user) return tenant;
    } catch {
      continue;
    }
  }
  return null;
}

// Como getTenantByEmail pero devuelve TODOS los negocios donde el email es admin activo.
// Lo usa /find-tenant: si hay varios, deja que el usuario elija a cuál entrar (en vez de
// elegir el primero en silencio). Devuelve [] si no hay ninguno.
export function getTenantsByEmail(email) {
  const tenants = controlDb
    .prepare("SELECT * FROM tenants WHERE status='active'")
    .all();

  const matches = [];
  for (const tenant of tenants) {
    try {
      const db = openTenantReadonly(tenant);
      const user = db
        .prepare('SELECT id FROM admin_users WHERE email=? AND active=1')
        .get(email);
      db.close();
      if (user) matches.push(tenant);
    } catch {
      continue;
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Gasto GLOBAL de Anthropic (freno de gasto, por mes natural 'YYYY-MM')
// ---------------------------------------------------------------------------

// Devuelve { eur, alerted_80 } del mes (0 si no hay fila).
export function getGlobalLlmSpend(month) {
  return controlDb
    .prepare('SELECT eur, alerted_80 FROM llm_spend_global WHERE month = ?')
    .get(month) ?? { eur: 0, alerted_80: 0 };
}

// Suma gasto al acumulador global del mes (crea la fila si no existe).
export function addGlobalLlmSpend(month, eur) {
  controlDb
    .prepare(`INSERT INTO llm_spend_global (month, eur) VALUES (?, ?)
              ON CONFLICT(month) DO UPDATE SET eur = eur + excluded.eur`)
    .run(month, eur);
}

// Marca que ya se envió el aviso del 80% de este mes (para no repetirlo).
export function markGlobalLlmAlerted(month) {
  controlDb.prepare('UPDATE llm_spend_global SET alerted_80 = 1 WHERE month = ?').run(month);
}

// ---------------------------------------------------------------------------
// Superadmin: identidad + sesiones (todo en control.db, separado de los tenants)
// ---------------------------------------------------------------------------

export function getSuperadminByEmail(email) {
  return controlDb.prepare('SELECT * FROM superadmins WHERE email = ?').get(String(email || '').trim().toLowerCase()) ?? null;
}
export function getSuperadminById(id) {
  return controlDb.prepare('SELECT * FROM superadmins WHERE id = ?').get(id) ?? null;
}
export function createSuperadmin({ email, password_hash, must_change_password = 1 }) {
  const r = controlDb.prepare(
    'INSERT INTO superadmins (email, password_hash, must_change_password) VALUES (?,?,?)'
  ).run(String(email).trim().toLowerCase(), password_hash, must_change_password ? 1 : 0);
  return getSuperadminById(r.lastInsertRowid);
}
// Fija una contraseña nueva y limpia el flag de cambio obligatorio.
export function setSuperadminPassword(id, password_hash) {
  controlDb.prepare('UPDATE superadmins SET password_hash=?, must_change_password=0 WHERE id=?').run(password_hash, id);
}

export function createSuperadminSession(superadminId) {
  const token = randomBytes(32).toString('base64url');
  const csrf  = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  controlDb.prepare(
    'INSERT INTO superadmin_sessions (token, superadmin_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)'
  ).run(token, superadminId, now, now + 24 * 60 * 60, csrf);
  return { token, csrf };
}
export function getSuperadminSessionByToken(token) {
  const now = Math.floor(Date.now() / 1000);
  const row = controlDb.prepare(`
    SELECT s.token, s.csrf_token, s.expires_at, a.id, a.email, a.must_change_password, a.totp_enabled
    FROM superadmin_sessions s JOIN superadmins a ON a.id = s.superadmin_id
    WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at <= now) { controlDb.prepare('DELETE FROM superadmin_sessions WHERE token=?').run(token); return null; }
  return { token: row.token, csrfToken: row.csrf_token, id: row.id, email: row.email,
           mustChangePassword: !!row.must_change_password, totpEnabled: !!row.totp_enabled };
}
export function destroySuperadminSession(token) {
  controlDb.prepare('DELETE FROM superadmin_sessions WHERE token=?').run(token);
}
export function destroyAllSuperadminSessions(superadminId) {
  controlDb.prepare('DELETE FROM superadmin_sessions WHERE superadmin_id=?').run(superadminId);
}

// ── 2FA del superadmin (C5/M3) ───────────────────────────────────────────────
// El secreto TOTP y los códigos de rescate se mueven JUNTOS y siempre por aquí: activar sin códigos
// de rescate, o dejar códigos vivos tras desactivar, son las dos formas de que esto salga mal.

export function enableSuperadminTotp(id, secret, codeHashes) {
  const now = Math.floor(Date.now() / 1000);
  const tx = controlDb.transaction(() => {
    controlDb.prepare('UPDATE superadmins SET totp_secret=?, totp_enabled=1 WHERE id=?').run(secret, id);
    // Activar SUSTITUYE los códigos anteriores: si se reconfigura el 2FA, los papeles viejos dejan
    // de valer en el mismo instante. Si no, un código impreso hace meses seguiría abriendo la puerta.
    controlDb.prepare('DELETE FROM superadmin_recovery_codes WHERE superadmin_id=?').run(id);
    const ins = controlDb.prepare('INSERT INTO superadmin_recovery_codes (superadmin_id, code_hash, created_at) VALUES (?,?,?)');
    for (const h of codeHashes) ins.run(id, h, now);
  });
  tx();
}

// Desactivar borra el secreto Y los códigos: un código de rescate que sobreviva al 2FA que rescataba
// es una segunda llave olvidada debajo del felpudo.
export function disableSuperadminTotp(id) {
  const tx = controlDb.transaction(() => {
    controlDb.prepare('UPDATE superadmins SET totp_secret=NULL, totp_enabled=0 WHERE id=?').run(id);
    controlDb.prepare('DELETE FROM superadmin_recovery_codes WHERE superadmin_id=?').run(id);
  });
  tx();
}

export function listUnusedRecoveryCodes(id) {
  return controlDb.prepare(
    'SELECT id, code_hash FROM superadmin_recovery_codes WHERE superadmin_id=? AND used_at IS NULL'
  ).all(id);
}

// Marca el código como gastado. Devuelve false si otro lo gastó primero: el UPDATE lleva
// `used_at IS NULL`, así que dos intentos con el mismo código a la vez solo dejan pasar a uno.
export function consumeRecoveryCode(rowId) {
  const r = controlDb.prepare('UPDATE superadmin_recovery_codes SET used_at=? WHERE id=? AND used_at IS NULL')
    .run(Math.floor(Date.now() / 1000), rowId);
  return r.changes === 1;
}

export function countUnusedRecoveryCodes(id) {
  return controlDb.prepare(
    'SELECT COUNT(*) n FROM superadmin_recovery_codes WHERE superadmin_id=? AND used_at IS NULL'
  ).get(id).n;
}

// ---------------------------------------------------------------------------
// Control de tenants desde el superadmin (estado de suspensión vive aquí)
// ---------------------------------------------------------------------------

export function listTenants() {
  return controlDb.prepare(
    'SELECT id, name, slug, db_filename, plan, status, country, created_at, suspended_at, suspend_note FROM tenants ORDER BY created_at DESC, id DESC'
  ).all();
}
// status ∈ active | suspended_admin | suspended_security. note: motivo visible.
export function setTenantStatus(id, status, note = null) {
  const suspended = status === 'active' ? null : "datetime('now')";
  if (status === 'active') {
    controlDb.prepare('UPDATE tenants SET status=?, suspended_at=NULL, suspend_note=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
  } else {
    controlDb.prepare("UPDATE tenants SET status=?, suspended_at=datetime('now'), suspend_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, note, id);
  }
  return getTenantById(id);
}

// ---------------------------------------------------------------------------
// Vigilancia: eventos de seguridad + log de errores (para el panel de superadmin)
// ---------------------------------------------------------------------------

const _trunc = (s, n) => String(s == null ? '' : s).slice(0, n);

// Registra un evento de seguridad (rate-limits 429, logins fallidos, …). Nunca lanza.
export function recordSecurityEvent(type, ip, tenantSlug, detail) {
  try {
    const r = controlDb.prepare('INSERT INTO security_events (ts,type,ip,tenant_slug,detail) VALUES (?,?,?,?,?)')
      .run(Math.floor(Date.now() / 1000), _trunc(type, 40), _trunc(ip, 60), tenantSlug ? _trunc(tenantSlug, 60) : null, detail ? _trunc(detail, 200) : null);
    if (Number(r.lastInsertRowid) % 200 === 0) controlDb.prepare('DELETE FROM security_events WHERE id <= ? - 1000').run(r.lastInsertRowid);
  } catch { /* la vigilancia nunca rompe la petición */ }
}
export function listSecurityEvents(limit = 100) {
  return controlDb.prepare('SELECT id, ts, type, ip, tenant_slug, detail FROM security_events ORDER BY id DESC LIMIT ?').all(limit);
}
// Conteo por tipo en las últimas `hours` horas → { type: count }.
export function securityCounts(hours = 24) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const map = {};
  for (const r of controlDb.prepare('SELECT type, COUNT(*) c FROM security_events WHERE ts >= ? GROUP BY type').all(since)) map[r.type] = r.c;
  return map;
}

// Registra un error de la plataforma. Nunca lanza.
export function recordError({ tenantSlug, method, path, message }) {
  try {
    const r = controlDb.prepare('INSERT INTO error_log (ts,tenant_slug,method,path,message) VALUES (?,?,?,?,?)')
      .run(Math.floor(Date.now() / 1000), tenantSlug ? _trunc(tenantSlug, 60) : null, _trunc(method, 10), _trunc(path, 200), _trunc(message, 500));
    if (Number(r.lastInsertRowid) % 200 === 0) controlDb.prepare('DELETE FROM error_log WHERE id <= ? - 1000').run(r.lastInsertRowid);
  } catch { /* idem */ }
}
export function listErrors(limit = 100) {
  return controlDb.prepare('SELECT id, ts, tenant_slug, method, path, message FROM error_log ORDER BY id DESC LIMIT ?').all(limit);
}
export function errorCount(hours = 24) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  return controlDb.prepare('SELECT COUNT(*) c FROM error_log WHERE ts >= ?').get(since).c;
}

// Guarda/lee el resultado del último chequeo de integridad de facturas (zona 3).
export function saveIntegrityResult(tenantSlug, ok, total, detail) {
  controlDb.prepare(`INSERT INTO integrity_checks (tenant_slug, ts, ok, total, detail) VALUES (?,?,?,?,?)
    ON CONFLICT(tenant_slug) DO UPDATE SET ts=excluded.ts, ok=excluded.ok, total=excluded.total, detail=excluded.detail`)
    .run(tenantSlug, Math.floor(Date.now() / 1000), ok ? 1 : 0, total | 0, detail || null);
}
export function listIntegrityResults() {
  return controlDb.prepare('SELECT tenant_slug, ts, ok, total, detail FROM integrity_checks ORDER BY ok ASC, tenant_slug').all();
}
