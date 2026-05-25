import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';

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

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, storedHash) {
  if (storedHash.startsWith('$2')) {
    const valid = await bcrypt.compare(password, storedHash);
    return { valid, needsRehash: false };
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
    SELECT s.expires_at, s.user_id, s.csrf_token, u.name, u.role
    FROM admin_sessions s
    JOIN admin_users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (row.expires_at <= now) {
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
