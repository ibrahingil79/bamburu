// Verificación — Mostrador · aviso+permiso de SOBREVENTA (espejo de sales.emit_over_stock de la factura).
//   node scripts/verify-mostrador-overstock.mjs   (servidor en marcha, tenant desarrollo)
// Físico sobre disponible (por almacén) sin confirm → 400; con flag pero sin permiso → 403; con ambos →
// emite F2 + mueve stock. Servicio/digital/línea libre NUNCA se chequean. Atomicidad: un rechazo no emite
// ni mueve stock ni toca la cadena de huellas. Trabaja sobre productos DESECHABLES y los limpia al final.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { recordMovement } from '../modules/erp/stock.js';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
db.pragma('busy_timeout = 5000');
const now = Math.floor(Date.now() / 1000);
const sym = randomBytes(3).toString('hex');
// sesión OWNER (user 2) + sesión EMPLEADO (user 3) con invoices.create concedido temporalmente.
const ownerTok = randomBytes(24).toString('base64url'), ownerCsrf = randomBytes(8).toString('hex');
const empTok = randomBytes(24).toString('base64url'), empCsrf = randomBytes(8).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(ownerTok, 2, now, now + 1800, ownerCsrf);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(empTok, 3, now, now + 1800, empCsrf);
const wh = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
// permiso temporal: empleado con invoices.create (para LLEGAR a la ruta) pero SIN sales.emit_over_stock.
const permId = (mod, act) => db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act)?.id;
const invCreate = permId('invoices', 'create');
let grantedInv = false;
if (invCreate && !db.prepare('SELECT 1 FROM user_permissions WHERE admin_user_id=3 AND permission_id=?').get(invCreate)) {
  db.prepare('INSERT INTO user_permissions (admin_user_id, permission_id) VALUES (3,?)').run(invCreate); grantedInv = true;
}
// productos desechables: físico (stock 3), servicio, digital.
const ins = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)");
const pFis = ins.run('ZZZ Fis ' + sym, 'zzz-fis-' + sym, 'ZF-' + sym, 10, 0, 'active', 'physical', 21, 'general').lastInsertRowid;
const pSrv = ins.run('ZZZ Srv ' + sym, 'zzz-srv-' + sym, 'ZS-' + sym, 10, 0, 'active', 'service', 21, 'general').lastInsertRowid;
recordMovement(db, { product_id: pFis, type: 'apertura', quantity: 3, origin_type: 'opening', warehouse_id: wh });
db.close();

const hdr = (tok, csrf) => ({ cookie: 'asess=' + tok + '; btenant=desarrollo-bamburu', 'content-type': 'application/json', 'x-csrf-token': csrf });
const sale = (tok, csrf, body) => fetch(ORIGIN + '/api/erp/mostrador/sale', { method: 'POST', headers: hdr(tok, csrf), body: JSON.stringify(body) });
const snap = () => { const d = new Database(DB, { readonly: true }); const r = { inv: d.prepare('SELECT COUNT(*) n FROM invoices').get().n, reg: d.prepare('SELECT COUNT(*) n FROM verifactu_registros').get().n, last: d.prepare("SELECT huella FROM verifactu_registros ORDER BY id DESC LIMIT 1").get()?.huella || '', stock: d.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(pFis).s }; d.close(); return r; };

try {
  console.log('\n=== Mostrador — sobreventa (avisa + permiso, no en silencio) ===\n');
  const L = (pid, qty, extra = {}) => ({ warehouse_id: wh, payment_method: 'efectivo', lines: [{ product_id: pid, description: 'x', quantity: qty, unit_price: 10, tax_rate: 21 }], ...extra });

  // 1) FÍSICO sobre disponible (3), SIN confirm → 400 + atomicidad
  const before = snap();
  let r = await sale(ownerTok, ownerCsrf, L(pFis, 100));
  let b = await r.json();
  ok(r.status === 400 && /exceso|confirm_excess/i.test(JSON.stringify(b)), 'físico sobre stock sin confirmación → 400 (' + (b.error || '').slice(0, 50) + '…)');
  const after400 = snap();
  ok(after400.inv === before.inv && after400.reg === before.reg && after400.last === before.last && after400.stock === before.stock,
     'ATOMICIDAD: el 400 NO emitió factura, NO movió stock, NO tocó la cadena de huellas');

  // 2) FÍSICO sobre disponible, CON confirm pero SIN permiso (empleado) → 403
  r = await sale(empTok, empCsrf, { ...L(pFis, 100), confirm_excess: true });
  b = await r.json();
  ok(r.status === 403 && /permiso/i.test(JSON.stringify(b)), 'físico sobre stock con flag pero SIN permiso → 403');
  ok(snap().inv === before.inv, 'ATOMICIDAD: el 403 tampoco emitió nada');

  // 3) FÍSICO sobre disponible, CON confirm Y permiso (owner, bypass) → 201 + emite F2 + mueve stock
  r = await sale(ownerTok, ownerCsrf, { ...L(pFis, 100), confirm_excess: true });
  b = await r.json();
  ok(r.status === 201 && b.invoice_number?.startsWith('S'), 'físico sobre stock con confirm + permiso (owner) → 201, emite F2 ' + (b.invoice_number || ''));
  ok(snap().stock === 3 - 100, 'movió stock por el libro (3 → -97, venta bajo pedido)');

  // 4) Servicio NUNCA se chequea (qty enorme) → 201 sin gate
  r = await sale(ownerTok, ownerCsrf, L(pSrv, 9999));
  ok(r.status === 201, 'SERVICIO con qty enorme → 201 (no se chequea stock)');

  // 5) Línea LIBRE (sin product_id) nunca se chequea → 201
  r = await sale(ownerTok, ownerCsrf, { warehouse_id: wh, payment_method: 'efectivo', lines: [{ product_id: null, description: 'Mano de obra', quantity: 9999, unit_price: 5, tax_rate: 21 }] });
  ok(r.status === 201, 'LÍNEA LIBRE con qty enorme → 201 (no se chequea stock)');

  // 6) Venta NORMAL dentro de stock (otro físico, qty ≤ disponible) → 201 sin necesidad de confirm
  const d2 = new Database(DB); const pOk = d2.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)").run('ZZZ Ok ' + sym, 'zzz-ok-' + sym, 'ZO-' + sym, 10, 0, 'active', 'physical', 21, 'general').lastInsertRowid; d2.close();
  recordMovement(new Database(DB), { product_id: pOk, type: 'apertura', quantity: 10, origin_type: 'opening', warehouse_id: wh });
  r = await sale(ownerTok, ownerCsrf, L(pOk, 2));
  ok(r.status === 201, 'venta normal dentro de stock (2 de 10) → 201 sin confirmación');

  // limpieza de productos desechables (las facturas F2 de prueba quedan, con su cadena intacta)
  const c = new Database(DB);
  for (const pid of [pFis, pSrv, pOk]) { c.prepare('DELETE FROM stock_movements WHERE product_id=?').run(pid); c.prepare('DELETE FROM products WHERE id=?').run(pid); }
  if (grantedInv) c.prepare('DELETE FROM user_permissions WHERE admin_user_id=3 AND permission_id=?').run(invCreate);
  c.prepare('DELETE FROM admin_sessions WHERE token IN (?,?)').run(ownerTok, empTok);
  c.close();
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  const c = new Database(DB); c.prepare('DELETE FROM admin_sessions WHERE token IN (?,?)').run(ownerTok, empTok); c.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
console.log('(Limpieza: productos desechables y permiso temporal retirados; los tickets F2 de prueba quedan en dev con su cadena Verifactu intacta.)');
process.exit(fail ? 1 : 0);
