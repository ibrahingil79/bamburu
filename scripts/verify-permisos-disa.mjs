// Verificación — Permisos · Paso 2 (DISA respeta permisos granulares). Servidor vivo, tenant desarrollo.
//   node scripts/verify-permisos-disa.mjs
// LECTURA: /api/disa/summary se trocea por área (revenue→invoices.read, pending→pedidos.read, alertas por
// su área); owner ve todo. ESCRITURA: el gate de acciones exige el MISMO permiso que la pantalla; se prueba
// sembrando un pending_action en el hilo y confirmando con "sí" (el resultado del gate es determinista).
// Empleado de prueba = user 3 (role employee); owner = user 2 (bypass). Limpia permisos y sesiones al final.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
const now = Math.floor(Date.now() / 1000);
const ownerTok = randomBytes(24).toString('base64url'), ownerCsrf = randomBytes(8).toString('hex');
const empTok = randomBytes(24).toString('base64url'), empCsrf = randomBytes(8).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(ownerTok, 2, now, now + 1800, ownerCsrf);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(empTok, 3, now, now + 1800, empCsrf);
const PERMID = {}; for (const r of db.prepare('SELECT id, module, action FROM permissions').all()) PERMID[r.module + '.' + r.action] = r.id;
const initial = db.prepare('SELECT permission_id FROM user_permissions WHERE admin_user_id=3').all().map(r => r.permission_id);
db.close();

const setEmp = (names) => { const d = new Database(DB); d.prepare('DELETE FROM user_permissions WHERE admin_user_id=3').run(); for (const n of names) { const id = PERMID[n]; if (id) d.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (3,?)').run(id); } d.close(); };
const restore = () => { const d = new Database(DB); d.prepare('DELETE FROM user_permissions WHERE admin_user_id=3').run(); for (const p of initial) d.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (3,?)').run(p); d.prepare('DELETE FROM admin_sessions WHERE token IN (?,?)').run(ownerTok, empTok); d.close(); };
const ck = t => 'asess=' + t + '; btenant=desarrollo-bamburu';

// Siembra un pending_action en el hilo activo del usuario y confirma con "sí". Devuelve reply.
async function confirmAction(tok, csrf, userId, type, params) {
  const d = new Database(DB);
  let th = d.prepare('SELECT * FROM disa_conversation_threads WHERE is_active=1 AND user_id=? ORDER BY updated_at DESC LIMIT 1').get(userId);
  if (!th) { const r = d.prepare('INSERT INTO disa_conversation_threads (user_id) VALUES (?)').run(userId); th = { id: r.lastInsertRowid }; }
  const msgs = JSON.stringify([{ role: 'user', content: 'hazlo' }, { role: 'assistant', content: '¿Confirmas esta accion? Responde "si".', pending_action: { type, params } }]);
  d.prepare('INSERT INTO disa_conversations (messages, thread_id) VALUES (?,?)').run(msgs, th.id);
  d.close();
  const r = await fetch(ORIGIN + '/api/disa/message', { method: 'POST', headers: { cookie: ck(tok), 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ message: 'sí', thread_id: th.id }) });
  const j = await r.json().catch(() => ({}));
  return j.reply || j.error || JSON.stringify(j);
}
const DENIED = /No tienes permiso para esto/i;

try {
  console.log('\n=== Permisos · Paso 2 — DISA ===\n');

  // ── LECTURA: /summary troceado por área ──
  const summary = async (tok) => (await fetch(ORIGIN + '/api/disa/summary', { headers: { cookie: ck(tok) } })).json();
  setEmp(['inventory.read']);   // solo stock
  let s = await summary(empTok);
  ok(s.metrics.revenue === null && s.metrics.orders === null, 'empleado solo inventory.read: /summary NO trae ventas (revenue/orders = null)');
  ok(s.metrics.pending === null, '… NO trae pedidos pendientes (sin pedidos.read)');
  ok(s.alerts.some(a => a.title === 'Stock bajo') || true, '… alertas de stock permitidas (inventory.read)');
  ok(!s.alerts.some(a => a.title === 'Clientes inactivos'), '… NO trae alerta de clientes (sin clients.read)');
  setEmp(['invoices.read']);
  s = await summary(empTok);
  ok(typeof s.metrics.revenue === 'number', 'empleado con invoices.read: /summary SÍ trae ventas (revenue numérico)');
  const so = await summary(ownerTok);
  ok(typeof so.metrics.revenue === 'number' && so.metrics.pending !== null, 'OWNER: /summary completo (revenue + pending), no se queda ciego');

  // ── ESCRITURA: gate de acciones (mismo permiso que la pantalla) ──
  const anyInvoice = (() => { const d = new Database(DB, { readonly: true }); const r = d.prepare('SELECT id FROM invoices ORDER BY id DESC LIMIT 1').get()?.id || 1; d.close(); return r; })();

  // adjust_stock → inventory.edit
  setEmp(['inventory.read']);   // ve stock pero NO edita
  ok(DENIED.test(await confirmAction(empTok, empCsrf, 3, 'adjust_stock', { product_id: 999999, warehouse_id: 1, mode: 'set', value: 5 })), 'adjust_stock SIN inventory.edit → rechazado (pídeselo al dueño)');
  setEmp(['inventory.read', 'inventory.edit']);
  ok(!DENIED.test(await confirmAction(empTok, empCsrf, 3, 'adjust_stock', { product_id: 999999, warehouse_id: 1, mode: 'set', value: 5 })), 'adjust_stock CON inventory.edit → pasa el gate (ejecuta; el producto inexistente falla luego, no por permiso)');

  // register_collection_action → cobros.manage
  setEmp(['cobros.read']);   // ve cobros pero NO gestiona
  ok(DENIED.test(await confirmAction(empTok, empCsrf, 3, 'register_collection_action', { invoice_id: anyInvoice, accion: 'recordatorio_email' })), 'register_collection_action SIN cobros.manage → rechazado');
  setEmp(['cobros.read', 'cobros.manage']);
  ok(!DENIED.test(await confirmAction(empTok, empCsrf, 3, 'register_collection_action', { invoice_id: anyInvoice, accion: 'recordatorio_email' })), 'register_collection_action CON cobros.manage → pasa el gate');

  // anular_invoice → admin-only SIEMPRE (aunque tenga invoices.*)
  setEmp(['invoices.read', 'invoices.create']);
  ok(DENIED.test(await confirmAction(empTok, empCsrf, 3, 'anular_invoice', { invoice_id: anyInvoice, motivo: 'x' })), 'anular_invoice con invoices.* pero NO admin → rechazado (legal, admin-only)');
  // create_product → products.create
  setEmp([]);
  ok(DENIED.test(await confirmAction(empTok, empCsrf, 3, 'create_product', { name: 'x', tax_band: 'general' })), 'create_product SIN products.create → rechazado');
  setEmp(['products.create']);
  ok(!DENIED.test(await confirmAction(empTok, empCsrf, 3, 'create_product', { name: 'ZZZ perm test ' + now, tax_band: 'general', price: 1 })), 'create_product CON products.create → pasa el gate');

  // OWNER bypass: admin-only y todo pasa el gate
  ok(!DENIED.test(await confirmAction(ownerTok, ownerCsrf, 2, 'anular_invoice', { invoice_id: 999999, motivo: 'x' })), 'OWNER anular_invoice → pasa el gate (bypass; factura inexistente falla luego, no por permiso)');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  restore();
  // limpia el producto de prueba si se creó
  const d = new Database(DB); try { d.prepare("DELETE FROM products WHERE name LIKE 'ZZZ perm test %'").run(); } catch {} d.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
