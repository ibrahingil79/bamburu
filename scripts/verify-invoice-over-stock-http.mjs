// Parte B (servidor real, tenant desarrollo): códigos de estado y PERMISO con sesiones reales.
//   node scripts/verify-invoice-over-stock-http.mjs
import Database from 'better-sqlite3';
import { prepararEmpleado } from './lib/empleado-de-prueba.mjs';
import { randomBytes } from 'crypto';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
// El empleado de prueba, activo mientras dura esto y devuelto como estaba.
const emp = prepararEmpleado(db, 3);
const PHYS = 1, SERV = 8;            // Vela Lavanda (físico, stock 62) · Servicio de Montaje
const permId = (mod, act) => db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act).id;
const PID_CREATE = permId('invoices', 'create'), PID_OVER = permId('sales', 'emit_over_stock');

function session(userId) {
  const token = randomBytes(24).toString('base64url'), csrf = randomBytes(16).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, userId, now, now + 3600, csrf);
  return { token, csrf };
}
async function emit(sess, line, confirm_excess) {
  const res = await fetch(ORIGIN + '/api/erp/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': sess.csrf, 'Cookie': 'asess=' + sess.token + '; btenant=desarrollo-bamburu' },
    body: JSON.stringify({ client_id: 1, lines: [line], confirm_excess }),
  });
  let body = {}; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}
const grant = (uid, pid) => db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, pid);
const revoke = (uid, pid) => db.prepare('DELETE FROM user_permissions WHERE admin_user_id=? AND permission_id=?').run(uid, pid);

console.log('\n=== Factura · exceso de stock — Parte B (servidor real) ===\n');
const cleanup = [];
try {
  const owner = session(2); cleanup.push(owner.token);

  console.log('OWNER (dueño):');
  let r = await emit(owner, { description: 'Vela Lavanda 200g', quantity: 1000, unit_price: 10, tax_rate: 21, product_id: PHYS }, false);
  ok(r.status === 400 && /exceso/i.test(r.body.error || ''), 'físico 1000 (hay 62) SIN confirm_excess → 400 con aviso. ("' + (r.body.error || '').slice(0, 70) + '...")');

  r = await emit(owner, { description: 'Vela Lavanda 200g', quantity: 1000, unit_price: 10, tax_rate: 21, product_id: PHYS }, true);
  ok(r.status === 201 && r.body.invoice_number, 'físico 1000 CON confirm_excess (dueño) → 201 ' + (r.body.invoice_number || ''));

  r = await emit(owner, { description: 'Servicio de Montaje', quantity: 12, unit_price: 5, tax_rate: 21, product_id: SERV }, false);
  ok(r.status === 201, 'un SERVICIO no mira el stock, pida lo que pida → 201 ' + (r.body.invoice_number || ''));

  console.log('\nEMPLEADO (sin permiso de exceso):');
  const emp = session(3); cleanup.push(emp.token);
  grant(3, PID_CREATE);                 // para que pase requirePerm(invoices.create) y llegue a mi check
  revoke(3, PID_OVER);                  // asegurar que NO tiene el permiso de exceso
  r = await emit(emp, { description: 'Vela Lavanda 200g', quantity: 1000, unit_price: 10, tax_rate: 21, product_id: PHYS }, true);
  ok(r.status === 403, 'empleado SIN sales.emit_over_stock + confirm_excess → 403 (rechazo) ("' + (r.body.error || '').slice(0, 60) + '...")');

  console.log('\nEMPLEADO (con permiso concedido):');
  grant(3, PID_OVER);
  r = await emit(emp, { description: 'Vela Lavanda 200g', quantity: 1000, unit_price: 10, tax_rate: 21, product_id: PHYS }, true);
  ok(r.status === 201 && r.body.invoice_number, 'empleado CON sales.emit_over_stock + confirm_excess → 201 ' + (r.body.invoice_number || ''));
} finally {
  emp.restaurar(db);
  for (const t of cleanup) db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t);
  revoke(3, PID_CREATE); revoke(3, PID_OVER);   // dejar al empleado como estaba
  db.close();
}
console.log('\n=== RESULTADO PARTE B: ' + pass + ' OK / ' + fail + ' FALLOS ===');
console.log('(facturas demo creadas en desarrollo por las emisiones 201; el empleado vuelve a quedar sin permisos)');
process.exit(fail ? 1 : 0);
