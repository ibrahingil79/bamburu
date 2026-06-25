// Verificación — Permisos · Paso 1 FASE 2 (coherencia). Servidor vivo, tenant desarrollo.
//   node scripts/verify-permisos-coherencia.mjs
// Facturas (ver/crear) y Cobros (ver/registrar): empleado CON el permiso pasa, SIN él → 403 (botón y
// URL directa); dueño pasa todo por el bypass; la pantalla de asignación ya no ofrece los decorativos.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
const now = Math.floor(Date.now() / 1000);
// sesión OWNER (user 2, bypass) y EMPLEADO (user 3, role employee → pasa por user_permissions)
const ownerTok = randomBytes(24).toString('base64url'), ownerCsrf = randomBytes(8).toString('hex');
const empTok = randomBytes(24).toString('base64url'), empCsrf = randomBytes(8).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(ownerTok, 2, now, now + 1800, ownerCsrf);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(empTok, 3, now, now + 1800, empCsrf);
const pid = (m, a) => db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(m, a)?.id;
const PERMS = { 'invoices.read': pid('invoices', 'read'), 'invoices.create': pid('invoices', 'create'), 'cobros.read': pid('cobros', 'read'), 'cobros.manage': pid('cobros', 'manage') };
const anyInvoice = db.prepare('SELECT id FROM invoices ORDER BY id DESC LIMIT 1').get()?.id || 1;
// estado inicial de permisos del empleado (para restaurar)
const initialPerms = db.prepare('SELECT permission_id FROM user_permissions WHERE admin_user_id=3').all().map(r => r.permission_id);
db.close();

const setEmpPerms = (names) => {
  const d = new Database(DB);
  d.prepare('DELETE FROM user_permissions WHERE admin_user_id=3').run();
  for (const n of names) if (PERMS[n]) d.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (3,?)').run(PERMS[n]);
  d.close();
};
const restore = () => {
  const d = new Database(DB);
  d.prepare('DELETE FROM user_permissions WHERE admin_user_id=3').run();
  for (const p of initialPerms) d.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (3,?)').run(p);
  d.prepare('DELETE FROM admin_sessions WHERE token IN (?,?)').run(ownerTok, empTok);
  d.close();
};
const ck = (tok) => 'asess=' + tok + '; btenant=desarrollo-bamburu';
const GET = (tok, path) => fetch(ORIGIN + path, { headers: { cookie: ck(tok) } });
const POST = (tok, csrf, path, body) => fetch(ORIGIN + path, { method: 'POST', headers: { cookie: ck(tok), 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body || {}) });
const code403 = r => r.status === 403;
const notBlocked = r => r.status !== 403 && r.status !== 302;   // pasó el candado (200/201/400/404…)

try {
  console.log('\n=== Permisos coherencia — Facturas / Cobros ===\n');

  // ── FACTURAS · VER (invoices.read) ──
  setEmpPerms([]);  // empleado sin permisos
  ok(code403(await GET(empTok, '/api/erp/invoices')), 'facturas (API) SIN invoices.read → 403 (URL directa)');
  ok(code403(await GET(empTok, '/admin/invoices')), 'facturas (pantalla) SIN invoices.read → 403');
  setEmpPerms(['invoices.read']);
  ok(notBlocked(await GET(empTok, '/api/erp/invoices')), 'facturas (API) CON invoices.read → pasa');
  ok(notBlocked(await GET(empTok, '/admin/invoices')), 'facturas (pantalla) CON invoices.read → pasa');
  // ya NO depende de orders.read: con orders.read pero sin invoices.read → bloqueado (no existe orders.read asignable, así que sin invoices.read = 403)

  // ── FACTURAS · CREAR (invoices.create) ──
  setEmpPerms(['invoices.read']);  // tiene ver pero no crear
  ok(code403(await POST(empTok, empCsrf, '/api/erp/invoices', { lines: [] })), 'crear factura SIN invoices.create → 403');
  setEmpPerms(['invoices.read', 'invoices.create']);
  ok(notBlocked(await POST(empTok, empCsrf, '/api/erp/invoices', { lines: [] })), 'crear factura CON invoices.create → pasa el candado (llega a validación)');

  // ── COBROS · VER (cobros.read) ──
  setEmpPerms([]);
  ok(code403(await GET(empTok, '/admin/cobros')), 'sección Cobros SIN cobros.read → 403 (URL directa)');
  ok(code403(await GET(empTok, '/api/erp/cobros')), 'API Cobros SIN cobros.read → 403');
  setEmpPerms(['cobros.read']);
  ok(notBlocked(await GET(empTok, '/admin/cobros')), 'sección Cobros CON cobros.read → pasa');

  // ── COBROS · REGISTRAR (cobros.manage) ──
  setEmpPerms(['cobros.read']);  // ve pero no gestiona
  ok(code403(await POST(empTok, empCsrf, '/api/erp/invoices/' + anyInvoice + '/payments', { amount: 1 })), 'registrar cobro SIN cobros.manage → 403');
  setEmpPerms(['cobros.read', 'cobros.manage']);
  ok(notBlocked(await POST(empTok, empCsrf, '/api/erp/invoices/' + anyInvoice + '/payments', { amount: 1 })), 'registrar cobro CON cobros.manage → pasa el candado');

  // ── DUEÑO (bypass) pasa todo sin permisos asignados ──
  ok(notBlocked(await GET(ownerTok, '/api/erp/invoices')), 'DUEÑO ve facturas (bypass)');
  ok(notBlocked(await GET(ownerTok, '/admin/cobros')), 'DUEÑO ve Cobros (bypass)');
  ok(notBlocked(await POST(ownerTok, ownerCsrf, '/api/erp/invoices/' + anyInvoice + '/payments', { amount: 1 })), 'DUEÑO registra cobro (bypass)');

  // ── PANTALLA de asignación: ya no ofrece decorativos; sí ofrece cobros.* ──
  const screen = await (await GET(ownerTok, '/admin/users')).text();
  // el catálogo embebido (ALL_PERMS) está en el HTML
  ok(/"module":"cobros","action":"read"/.test(screen) && /"module":"cobros","action":"manage"/.test(screen), 'la pantalla OFRECE cobros.read y cobros.manage');
  const hidden = ['"module":"orders"', '"module":"services"', '"action":"update_status"', '"module":"activity"', '"action":"manage_roles"'];
  ok(hidden.every(h => !screen.includes(h)), 'la pantalla NO ofrece los decorativos (orders.*, services.*, update_status, activity.*, manage_roles)');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  restore();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
console.log('(Permisos del empleado de prueba restaurados a su estado inicial; sesiones limpiadas.)');
process.exit(fail ? 1 : 0);
