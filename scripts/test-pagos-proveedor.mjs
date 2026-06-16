// Capa de dinero con proveedores · Paso (a) — tests de lógica del motor de PAGOS y de los
// servicios de factura recibida: vencimiento desde el plazo del proveedor, estados de pago
// (pendiente/parcial/pagada/vencida + tramos), pago parcial/total, SOBREPAGO rechazado,
// guarda de duplicado, anular (inmutable) y su efecto en la deuda, torre de control
// (openPayables), y la creación AUTOMÁTICA de la factura recibida desde la captura C2.
// Ejecuta sobre BD :memory: con el runMigrations real. No toca la BD real.
//
//   node scripts/test-pagos-proveedor.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  paymentsSum, countsAsPayable, isPayable, pagoState, supplierInvoicePago,
  supplierDebt, openPayables,
} from '../modules/erp/pagos.js';
import {
  createSupplierInvoiceSvc, anularSupplierInvoiceSvc, registerSupplierPaymentSvc,
  deleteSupplierPaymentSvc, supplierInvoiceDuplicate, getSupplierInvoice, eligibleOriginsForSupplier,
} from '../modules/erp/routes/supplier-invoices.js';
import { confirmCaptureSvc } from '../modules/erp/routes/purchases-capture.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
let seq = 0;
function addSupplier(db, { term = 0, name = 'Prov', fiscal = '', method = '' } = {}) {
  return db.prepare("INSERT INTO suppliers (name,fiscal_id,active,payment_term_days,payment_method) VALUES (?,?,1,?,?)")
    .run(name + (++seq), fiscal, term, method).lastInsertRowid;
}
function addProduct(db) {
  return db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,10,'physical',0,21,'general')")
    .run('P' + (++seq), 'p' + seq, 'S' + seq).lastInsertRowid;
}
// Compra directa RECIBIDA (origen válido para una factura recibida).
function addReceivedPurchase(db, supplierId, prod, qty = 10, cost = 5) {
  const total = qty * cost;
  const pid = db.prepare("INSERT INTO purchases (supplier_id,date,status,total,archived) VALUES (?,?,'received',?,0)").run(supplierId, '2026-06-01', total).lastInsertRowid;
  db.prepare("INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)").run(pid, prod, qty, cost);
  return pid;
}

// ── 1. Migración aditiva ────────────────────────────────────────────────────
console.log('1. Migración');
{
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(suppliers)").all().map(c => c.name);
  ok(cols.includes('payment_term_days'), 'suppliers.payment_term_days existe');
  ok(cols.includes('payment_method'), 'suppliers.payment_method existe');
  const tabs = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  ok(tabs.includes('supplier_invoices'), 'tabla supplier_invoices existe');
  ok(tabs.includes('supplier_payments'), 'tabla supplier_payments existe');
  // Idempotente: re-correr no rompe.
  runMigrations(db);
  ok(true, 'runMigrations idempotente');
  db.close();
}

// ── 2. Creación manual + vencimiento desde el plazo del proveedor ───────────
console.log('2. Crear factura recibida (vencimiento + snapshot + FRP)');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 30, name: 'Acme', fiscal: 'B111', method: 'transferencia' });
  const prod = addProduct(db);
  const pur = addReceivedPurchase(db, sup, prod);
  const r = createSupplierInvoiceSvc(db, {
    entity_type: 'purchase', entity_id: pur, supplier_invoice_number: 'A-100',
    invoice_date: '2026-06-01', base: 100, tax: 21, total: 121, notes: 'x',
  }, { onDuplicate: 'throw' });
  ok(/^FRP-\d{4}$/.test(r.internal_code), 'código interno FRP-NNNN');
  eq(r.due_date, '2026-07-01', 'vencimiento = fecha + 30 días');
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(r.id);
  eq([inv.base, inv.tax, inv.total], [100, 21, 121], 'importes guardados (total CON IVA)');
  eq([inv.supplier_name, inv.supplier_fiscal_id], ['Acme1', 'B111'], 'snapshot del proveedor congelado');
  eq([inv.entity_type, inv.entity_id], ['purchase', pur], 'enlace al documento de stock de origen');
  eq(inv.status, 'vigente', 'nace vigente');
  db.close();
}

// ── 3. Origen inválido se rechaza ───────────────────────────────────────────
console.log('3. Origen inválido');
{
  const db = freshDb();
  const sup = addSupplier(db);
  const prod = addProduct(db);
  // compra PENDIENTE (no recibida) → no es origen válido
  const pend = db.prepare("INSERT INTO purchases (supplier_id,date,status,total,archived) VALUES (?,?,'pending',50,0)").run(sup, '2026-06-01').lastInsertRowid;
  throws(() => createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pend, invoice_date: '2026-06-01', total: 50 }, {}), 400, 'compra pendiente rechazada');
  throws(() => createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: 9999, invoice_date: '2026-06-01', total: 50 }, {}), 404, 'origen inexistente rechazado');
  throws(() => createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: addReceivedPurchase(db, sup, prod), invoice_date: '2026-06-01', total: 0 }, {}), 400, 'total 0 rechazado');
  db.close();
}

// ── 4. Guarda de duplicado (por proveedor + número) ─────────────────────────
console.log('4. Duplicado');
{
  const db = freshDb();
  const supA = addSupplier(db), supB = addSupplier(db);
  const prod = addProduct(db);
  const p1 = addReceivedPurchase(db, supA, prod), p2 = addReceivedPurchase(db, supA, prod), p3 = addReceivedPurchase(db, supB, prod);
  createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: p1, supplier_invoice_number: 'F-1', invoice_date: '2026-06-01', total: 60 }, { onDuplicate: 'throw' });
  throws(() => createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: p2, supplier_invoice_number: 'F-1', invoice_date: '2026-06-02', total: 60 }, { onDuplicate: 'throw' }), 409, 'mismo proveedor + mismo número → 409');
  const skip = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: p2, supplier_invoice_number: 'F-1', invoice_date: '2026-06-02', total: 60 }, { onDuplicate: 'skip' });
  ok(skip.skipped === true, 'onDuplicate=skip no crea y avisa');
  const otherSupplier = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: p3, supplier_invoice_number: 'F-1', invoice_date: '2026-06-01', total: 60 }, { onDuplicate: 'throw' });
  ok(otherSupplier.id > 0, 'mismo número en OTRO proveedor → permitido');
  db.close();
}

// ── 5. Motor: estados de pago + parcial/total ───────────────────────────────
console.log('5. Estados de pago');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 0 });
  const prod = addProduct(db);
  const pur = addReceivedPurchase(db, sup, prod);
  const { id } = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pur, invoice_date: '2026-06-10', total: 100 }, {});
  const today = '2026-06-10';
  let inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  eq(supplierInvoicePago(db, inv, today).estado, 'pendiente', 'sin pagos → pendiente');
  registerSupplierPaymentSvc(db, id, { amount: 40, paid_date: today }, { today });
  eq(supplierInvoicePago(db, inv, today).estado, 'parcial', 'pago parcial → parcial');
  eq(paymentsSum(db, id), 40, 'suma de pagos = 40');
  registerSupplierPaymentSvc(db, id, { amount: 60, paid_date: today }, { today });
  const st = supplierInvoicePago(db, inv, today);
  eq([st.estado, st.pendiente], ['pagada', 0], 'pago restante → pagada, pendiente 0');
  db.close();
}

// ── 6. Sobrepago rechazado ──────────────────────────────────────────────────
console.log('6. Sobrepago');
{
  const db = freshDb();
  const sup = addSupplier(db);
  const prod = addProduct(db);
  const pur = addReceivedPurchase(db, sup, prod);
  const { id } = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pur, invoice_date: '2026-06-10', total: 100 }, {});
  throws(() => registerSupplierPaymentSvc(db, id, { amount: 120 }, { today: '2026-06-10' }), 400, 'pago > total rechazado');
  registerSupplierPaymentSvc(db, id, { amount: 70 }, { today: '2026-06-10' });
  throws(() => registerSupplierPaymentSvc(db, id, { amount: 40 }, { today: '2026-06-10' }), 400, 'pago > pendiente (30) rechazado');
  registerSupplierPaymentSvc(db, id, { amount: 30 }, { today: '2026-06-10' });   // exacto al céntimo: OK
  eq(supplierInvoicePago(db, db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id), '2026-06-10').estado, 'pagada', 'pago exacto del pendiente → pagada');
  db.close();
}

// ── 7. Vencimiento + tramos ─────────────────────────────────────────────────
console.log('7. Vencida');
{
  const inv = { total: 100, due_date: '2026-05-01', invoice_date: '2026-05-01' };
  const st = pagoState(inv, 0, '2026-06-10');   // 40 días después
  eq([st.estado, st.vencida, st.dias_vencida, st.tramo], ['vencida', true, 40, '30-60'], 'pendiente y pasado el vencimiento → vencida (tramo 30-60)');
  const st2 = pagoState(inv, 100, '2026-06-10');
  eq(st2.estado, 'pagada', 'aunque esté pasada, si está pagada → pagada (no vencida)');
}

// ── 8. Anular (inmutable) + efecto en deuda ─────────────────────────────────
console.log('8. Anular');
{
  const db = freshDb();
  const sup = addSupplier(db);
  const prod = addProduct(db);
  const pur = addReceivedPurchase(db, sup, prod);
  const { id } = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pur, invoice_date: '2026-06-10', total: 100 }, {});
  throws(() => anularSupplierInvoiceSvc(db, id, 'no'), 400, 'motivo corto rechazado');
  anularSupplierInvoiceSvc(db, id, 'factura duplicada');
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  eq([inv.status, inv.anulada_motivo], ['anulada', 'factura duplicada'], 'queda anulada + motivo');
  ok(!countsAsPayable(inv), 'anulada no cuenta como deuda');
  ok(!isPayable(inv), 'anulada no admite pago');
  throws(() => registerSupplierPaymentSvc(db, id, { amount: 10 }, {}), 400, 'no se puede pagar una anulada');
  throws(() => anularSupplierInvoiceSvc(db, id, 'otra vez'), 400, 'no se puede anular dos veces');
  eq(supplierDebt(db, sup, '2026-06-10').total, 0, 'la deuda del proveedor excluye la anulada');
  db.close();
}

// ── 9. Deuda por proveedor + torre de control (openPayables) ────────────────
console.log('9. Deuda + torre de control');
{
  const db = freshDb();
  const supA = addSupplier(db, { name: 'A' }), supB = addSupplier(db, { name: 'B' });
  const prod = addProduct(db);
  const a1 = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: addReceivedPurchase(db, supA, prod), invoice_date: '2026-04-01', total: 100 }, {});  // due 2026-04-01
  const a2 = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: addReceivedPurchase(db, supA, prod), invoice_date: '2026-06-01', total: 50 }, {});
  const b1 = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: addReceivedPurchase(db, supB, prod), invoice_date: '2026-05-01', total: 80 }, {});
  registerSupplierPaymentSvc(db, a2.id, { amount: 50 }, { today: '2026-06-10' });   // a2 pagada → fuera de deuda
  const debtA = supplierDebt(db, supA, '2026-06-10');
  eq(debtA.total, 100, 'deuda de A = 100 (a2 ya pagada no suma)');
  eq(debtA.oldest.supplier_invoice_id, a1.id, 'deuda más antigua de A = a1');
  const torre = openPayables(db, '2026-06-10');
  eq(torre.total, 180, 'total global debido = 100 (A) + 80 (B)');
  // Orden: más vencida arriba. a1 (vence 2026-04-01) más vencida que b1 (2026-05-01).
  eq([torre.rows[0].supplier_invoice_id, torre.rows[1].supplier_invoice_id], [a1.id, b1.id], 'ordena por más vencida arriba');
  db.close();
}

// ── 10. Creación AUTOMÁTICA desde la captura C2 ─────────────────────────────
console.log('10. Auto desde captura C2');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 15 });
  const prod = addProduct(db);
  const d = {
    target_mode: 'direct', supplier_mode: 'existing', supplier_id: sup,
    reference: 'PROV-77', date: '2026-06-05', notes: '',
    lines: [{ product_mode: 'existing', product_id: prod, quantity: 4, unit_cost: 10 }],
    inv_base: 40, inv_tax: 8.4, inv_total: 48.4, confirm_excess: false,
  };
  const r = confirmCaptureSvc(db, d);
  eq(r.entity_type, 'purchase', 'aterriza como compra directa');
  ok(r.supplier_invoice && r.supplier_invoice.id > 0, 'crea la factura recibida (deuda) automáticamente');
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(r.supplier_invoice.id);
  eq([inv.total, inv.supplier_invoice_number, inv.entity_type, inv.entity_id], [48.4, 'PROV-77', 'purchase', r.entity_id], 'factura con total CON IVA, número del proveedor y enlace a la compra');
  eq(inv.due_date, '2026-06-20', 'vencimiento = fecha + plazo (15 días)');
  // El stock se movió igualmente (no se tumbó).
  eq(db.prepare('SELECT stock FROM products WHERE id=?').get(prod).stock, 4, 'el stock aterrizó (4 uds.)');
  // Re-confirmar la MISMA factura (mismo número) → no duplica la deuda (skip), pero el stock vuelve a entrar.
  const r2 = confirmCaptureSvc(db, d);
  ok(r2.supplier_invoice && r2.supplier_invoice.skipped === true, 'segunda captura del mismo número NO duplica la deuda (skip)');
  eq(db.prepare("SELECT COUNT(*) n FROM supplier_invoices WHERE supplier_invoice_number='PROV-77'").get().n, 1, 'sigue habiendo UNA sola factura recibida con ese número');
  db.close();
}

// ── 11. Sin total (voz sin importes) → no crea deuda ────────────────────────
console.log('11. Captura sin importe');
{
  const db = freshDb();
  const sup = addSupplier(db);
  const prod = addProduct(db);
  const r = confirmCaptureSvc(db, {
    target_mode: 'direct', supplier_mode: 'existing', supplier_id: sup,
    reference: '', date: '2026-06-05', notes: '',
    lines: [{ product_mode: 'existing', product_id: prod, quantity: 2, unit_cost: 5 }],
    confirm_excess: false,
  });
  ok(r.supplier_invoice == null, 'sin inv_total no se crea factura recibida');
  eq(db.prepare('SELECT COUNT(*) n FROM supplier_invoices').get().n, 0, 'no hay deuda creada');
  eq(db.prepare('SELECT stock FROM products WHERE id=?').get(prod).stock, 2, 'el stock sí aterrizó');
  db.close();
}

// ── 12. Deshacer un pago (corrige sin anular la factura) ────────────────────
console.log('12. Deshacer pago');
{
  const db = freshDb();
  const sup = addSupplier(db);
  const prod = addProduct(db);
  const pur = addReceivedPurchase(db, sup, prod);
  const { id } = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pur, invoice_date: '2026-06-10', total: 100 }, {});
  const p1 = registerSupplierPaymentSvc(db, id, { amount: 40 }, { today: '2026-06-10' });
  const p2 = registerSupplierPaymentSvc(db, id, { amount: 60 }, { today: '2026-06-10' });
  let inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  eq(supplierInvoicePago(db, inv, '2026-06-10').estado, 'pagada', 'tras dos pagos → pagada');
  // Deshacer el segundo pago → vuelve a parcial, pendiente 60.
  const d = deleteSupplierPaymentSvc(db, id, p2.id, { today: '2026-06-10' });
  eq([d.pago.estado, d.pago.pendiente], ['parcial', 60], 'deshacer un pago → vuelve a parcial (pendiente 60)');
  eq(paymentsSum(db, id), 40, 'la suma de pagos baja a 40');
  // La factura sigue VIGENTE (deshacer un pago NO la anula).
  eq(db.prepare('SELECT status FROM supplier_invoices WHERE id=?').get(id).status, 'vigente', 'la factura sigue vigente tras deshacer el pago');
  // Deshacer un pago inexistente / de otra factura → 404.
  throws(() => deleteSupplierPaymentSvc(db, id, 99999, {}), 404, 'deshacer pago inexistente → 404');
  db.close();
}

console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
process.exit(fail ? 1 : 0);
