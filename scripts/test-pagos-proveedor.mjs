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
  EXPENSE_CATEGORIES, registerSupplierRefundSvc,
} from '../modules/erp/routes/supplier-invoices.js';
import { confirmCaptureSvc } from '../modules/erp/routes/purchases-capture.js';
import { createSupplierReturnSvc, cancelSupplierReturnSvc } from '../modules/erp/routes/supplier-returns.js';
import { isRefundable } from '../modules/erp/pagos.js';
import { createDirectPurchaseSvc } from '../modules/erp/routes/purchases.js';
import { supplierInvoiceSchema } from '../modules/erp/schemas.js';

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

// ════════════════════════════════════════════════════════════════════════════
// PASO (b) — FACTURAS DE GASTO PURO (sin origen de stock)
// ════════════════════════════════════════════════════════════════════════════

// ── 13. Alta de gasto: proveedor directo + líneas, total = suma, IVA por tipo ──
console.log('13. Gasto: alta sin origen + IVA por tipo');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 30 });
  const r = createSupplierInvoiceSvc(db, {
    supplier_id: sup, expense_category: 'Servicios profesionales',
    supplier_invoice_number: 'GEST-01', invoice_date: '2026-06-10',
    lines: [
      { concepto: 'Asesoría junio', base: 100, tax_rate: 21 },   // cuota 21
      { concepto: 'Gestión laboral', base: 50, tax_rate: 10 },   // cuota 5
      { concepto: 'Suplido exento', base: 30, tax_rate: 0 },     // cuota 0 (exento)
    ],
  }, { onDuplicate: 'throw', today: '2026-06-10' });
  ok(r.is_expense === true, 'la factura es de gasto (sin origen)');
  ok(/^FRP-\d{4}$/.test(r.internal_code), 'código FRP asignado');
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(r.id);
  eq([inv.base, inv.tax, inv.total], [180, 26, 206], 'base=180, IVA=26 (21+5+0), total=206 (mezcla 21+10+exenta)');
  eq([inv.entity_type, inv.entity_id], [null, null], 'sin enlace a documento de stock');
  eq(inv.expense_category, 'Servicios profesionales', 'categoría de gasto guardada');
  eq(inv.due_date, '2026-07-10', 'vencimiento = fecha + plazo del proveedor (30d)');
  const items = db.prepare('SELECT * FROM supplier_invoice_items WHERE supplier_invoice_id=? ORDER BY id').all(r.id);
  eq(items.length, 3, '3 líneas insertadas');
  eq([items[0].cuota, items[1].cuota, items[2].cuota], [21, 5, 0], 'cuota por línea = base*tipo/100');
  // El motor de pago funciona igual sobre el total de cabecera.
  eq(supplierInvoicePago(db, inv, '2026-06-10').estado, 'pendiente', 'gasto nace pendiente');
  db.close();
}

// ── 14. Gasto: due_date editable + guardas ──────────────────────────────────
console.log('14. Gasto: vencimiento editable + guardas');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 30 });
  const r = createSupplierInvoiceSvc(db, {
    supplier_id: sup, expense_category: 'Alquiler', invoice_date: '2026-06-10',
    due_date: '2026-06-30', lines: [{ concepto: 'Renta local', base: 800, tax_rate: 21 }],
  }, {});
  eq(db.prepare('SELECT due_date FROM supplier_invoices WHERE id=?').get(r.id).due_date, '2026-06-30', 'vencimiento manual respeta lo tecleado');
  // Sin proveedor → 400 (vía servicio).
  throws(() => createSupplierInvoiceSvc(db, { invoice_date: '2026-06-10', lines: [{ concepto: 'x', base: 10, tax_rate: 21 }] }, {}), 400, 'gasto sin proveedor → 400');
  // Sin líneas → 400.
  throws(() => createSupplierInvoiceSvc(db, { supplier_id: sup, invoice_date: '2026-06-10', lines: [] }, {}), 400, 'gasto sin líneas → 400');
  // Categoría inválida → 400.
  throws(() => createSupplierInvoiceSvc(db, { supplier_id: sup, expense_category: 'Inventada', invoice_date: '2026-06-10', lines: [{ concepto: 'x', base: 10, tax_rate: 21 }] }, {}), 400, 'categoría fuera de la lista → 400');
  // Total 0 (todas las bases a 0) → 400.
  throws(() => createSupplierInvoiceSvc(db, { supplier_id: sup, invoice_date: '2026-06-10', lines: [{ concepto: 'x', base: 0, tax_rate: 21 }] }, {}), 400, 'gasto con base 0 → total 0 → 400');
  ok(EXPENSE_CATEGORIES.includes('Servicios profesionales') && EXPENSE_CATEGORIES.includes('Otros'), 'lista de categorías expuesta');
  db.close();
}

// ── 15. Gasto: duplicado, anular y pagar ────────────────────────────────────
console.log('15. Gasto: duplicado + anular + pago');
{
  const db = freshDb();
  const sup = addSupplier(db);
  const mk = (num) => createSupplierInvoiceSvc(db, { supplier_id: sup, expense_category: 'Banca y financieros', supplier_invoice_number: num, invoice_date: '2026-06-10', lines: [{ concepto: 'Comisión', base: 100, tax_rate: 21 }] }, { onDuplicate: 'throw', today: '2026-06-10' });
  const a = mk('B-1');
  throws(() => mk('B-1'), 409, 'mismo proveedor + mismo número → 409 (igual que stock)');
  // Pagar parcial y total contra la factura de gasto.
  registerSupplierPaymentSvc(db, a.id, { amount: 50 }, { today: '2026-06-10' });
  eq(supplierInvoicePago(db, db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(a.id), '2026-06-10').estado, 'parcial', 'pago parcial → parcial');
  registerSupplierPaymentSvc(db, a.id, { amount: 71 }, { today: '2026-06-10' });
  eq(supplierInvoicePago(db, db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(a.id), '2026-06-10').estado, 'pagada', 'pago restante (121 total) → pagada');
  // Anular un gasto (inmutable, igual que stock).
  anularSupplierInvoiceSvc(db, a.id, 'duplicada por error');
  eq(db.prepare('SELECT status FROM supplier_invoices WHERE id=?').get(a.id).status, 'anulada', 'gasto anulado');
  db.close();
}

// ── 16. Convivencia gasto + stock en la torre de control ────────────────────
console.log('16. Gasto y stock conviven (torre de control)');
{
  const db = freshDb();
  const sup = addSupplier(db);
  const prod = addProduct(db);
  // factura de STOCK (paso a) — sin tocar nada del flujo
  const stockInv = createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: addReceivedPurchase(db, sup, prod), invoice_date: '2026-06-01', total: 100 }, {});
  // factura de GASTO (paso b)
  const gasto = createSupplierInvoiceSvc(db, { supplier_id: sup, expense_category: 'Suministros', invoice_date: '2026-06-01', lines: [{ concepto: 'Luz', base: 50, tax_rate: 21 }] }, {});
  const st = getSupplierInvoice(db, stockInv.id, '2026-06-16');
  const gt = getSupplierInvoice(db, gasto.id, '2026-06-16');
  ok(!st.is_expense && st.items.length === 0, 'la de stock NO es gasto y no tiene líneas');
  ok(gt.is_expense && gt.items.length === 1, 'la de gasto sí tiene su línea');
  eq(st.origin && st.origin.label.startsWith('Compra'), true, 'la de stock conserva su documento de origen');
  eq(gt.origin, null, 'la de gasto no tiene origen (ficha mostrará "—")');
  const torre = openPayables(db, '2026-06-16');
  eq(torre.total, 160.5, 'torre suma ambas: 100 (stock) + 60.5 (gasto 50+21%)');
  db.close();
}

// ── 17. Schema: origen ahora OPCIONAL; gasto exige proveedor + líneas ───────
console.log('17. Schema relajado');
{
  // (a) Con origen: válido sin supplier_id ni líneas.
  ok(supplierInvoiceSchema.safeParse({ entity_type: 'purchase', entity_id: 5, invoice_date: '2026-06-10', total: 100 }).success, 'modo stock: origen + total → válido');
  // (b) Gasto: válido con supplier_id + líneas, sin origen.
  ok(supplierInvoiceSchema.safeParse({ supplier_id: 3, invoice_date: '2026-06-10', lines: [{ base: 100, tax_rate: 21 }] }).success, 'modo gasto: proveedor + líneas → válido');
  // Sin origen y sin proveedor → inválido.
  ok(!supplierInvoiceSchema.safeParse({ invoice_date: '2026-06-10' }).success, 'sin origen ni proveedor → inválido');
  // Gasto sin líneas → inválido.
  ok(!supplierInvoiceSchema.safeParse({ supplier_id: 3, invoice_date: '2026-06-10' }).success, 'gasto sin líneas → inválido');
  // Con origen pero sin total → inválido.
  ok(!supplierInvoiceSchema.safeParse({ entity_type: 'purchase', entity_id: 5, invoice_date: '2026-06-10' }).success, 'stock sin total>0 → inválido');
}

// ════════════════════════════════════════════════════════════════════════════
// PASO (c) — la DEVOLUCIÓN resta deuda (ABONO) + REEMBOLSO recibido
// ════════════════════════════════════════════════════════════════════════════

// Producto con tipo de IVA concreto + compra recibida REAL (mueve stock) → para devolver.
function addProductRate(db, rate, band) {
  return db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,10,'physical',0,?,?)")
    .run('P' + (++seq), 'p' + seq, 'S' + seq, rate, band).lastInsertRowid;
}
function receivedPurchaseWithStock(db, sup, items) {  // items: [{product_id, quantity, unit_cost}]
  const pid = createDirectPurchaseSvc(db, { supplier_id: sup, reference: 'C', date: '2026-06-01', status: 'received', items });
  const lineIds = db.prepare('SELECT id, product_id FROM purchase_items WHERE purchase_id=? ORDER BY id').all(pid);
  return { pid, lineIds };
}

// ── 18. Confirmar devolución crea ABONO ABP con IVA por línea + total negativo ──
console.log('18. Devolución → abono ABP');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 0 });
  const prod = addProductRate(db, 21, 'general');
  const { pid, lineIds } = receivedPurchaseWithStock(db, sup, [{ product_id: prod, quantity: 10, unit_cost: 5 }]);
  const ret = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pid, date: '2026-06-05', motivo: 'defectuoso', items: [{ origin_item_id: lineIds[0].id, quantity: 4 }] });
  ok(ret.credit && /^ABP-\d{4}$/.test(ret.credit.internal_code), 'la devolución crea un abono ABP-NNNN');
  const abono = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(ret.credit.id);
  eq([abono.base, abono.tax, abono.total], [-20, -4.2, -24.2], 'abono negativo: base -20, IVA 21% -4.2, total -24.2');
  eq([abono.entity_type, abono.entity_id, abono.status], ['supplier_return', ret.id, 'vigente'], 'enlazado al DEV, vigente');
  eq(abono.supplier_invoice_number, '', 'sin número de proveedor (no es factura del proveedor)');
  const items = db.prepare('SELECT * FROM supplier_invoice_items WHERE supplier_invoice_id=?').all(ret.credit.id);
  eq([items.length, items[0].base, items[0].tax_rate, items[0].cuota], [1, -20, 21, -4.2], 'una línea de abono en negativo con IVA del producto');
  db.close();
}

// ── 19. El abono NETEA la deuda ("Debes X" baja) + estado 'abono' ───────────
console.log('19. El abono netea la deuda');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 0 });
  const prod = addProductRate(db, 21, 'general');
  const { pid, lineIds } = receivedPurchaseWithStock(db, sup, [{ product_id: prod, quantity: 10, unit_cost: 5 }]);
  // deuda de 100 (factura de la compra)
  createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pid, invoice_date: '2026-06-01', total: 100 }, {});
  eq(supplierDebt(db, sup, '2026-06-16').total, 100, 'deuda inicial 100');
  const ret = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pid, date: '2026-06-05', motivo: 'x', items: [{ origin_item_id: lineIds[0].id, quantity: 4 }] });
  eq(supplierDebt(db, sup, '2026-06-16').total, 75.8, 'tras el abono (-24.2) la deuda baja a 75.8');
  const abono = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(ret.credit.id);
  eq(supplierInvoicePago(db, abono, '2026-06-16').estado, 'abono', "estado 'abono' (no 'pagada')");
  ok(isRefundable(abono) && !isPayable(abono), 'el abono admite reembolso pero NO pago');
  db.close();
}

// ── 20. Abono > deuda → saldo a tu favor (total negativo) + desglose cuadra ──
console.log('20. Saldo a tu favor + desglose');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 0 });
  const prod = addProductRate(db, 21, 'general');
  const { pid, lineIds } = receivedPurchaseWithStock(db, sup, [{ product_id: prod, quantity: 10, unit_cost: 5 }]);
  createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pid, invoice_date: '2026-06-01', total: 10 }, {});   // deuda pequeña
  createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pid, date: '2026-06-05', motivo: 'x', items: [{ origin_item_id: lineIds[0].id, quantity: 4 }] });  // abono -24.2
  const d = supplierDebt(db, sup, '2026-06-16');
  ok(d.total < 0, 'el neto es NEGATIVO (saldo a tu favor): ' + d.total);
  eq(d.total, -14.2, 'saldo a tu favor = 10 − 24.2 = -14.2');
  // Desglose: Σ(filas) cuadra con el total de cabecera (deuda + abono).
  const torre = openPayables(db, '2026-06-16');
  const sumaFilas = Math.round(torre.rows.reduce((s, r) => s + r.pendiente, 0) * 100) / 100;
  eq(sumaFilas, torre.total, 'Σ(filas mostradas) == total de cabecera (incluye el abono)');
  ok(torre.rows.some(r => r.pendiente < 0), 'el abono aparece como fila (crédito) en el desglose');
  db.close();
}

// ── 21. Anular la devolución anula el abono → la deuda vuelve a subir ────────
console.log('21. Anular devolución sube la deuda');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 0 });
  const prod = addProductRate(db, 21, 'general');
  const { pid, lineIds } = receivedPurchaseWithStock(db, sup, [{ product_id: prod, quantity: 10, unit_cost: 5 }]);
  createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pid, invoice_date: '2026-06-01', total: 100 }, {});
  const ret = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pid, date: '2026-06-05', motivo: 'x', items: [{ origin_item_id: lineIds[0].id, quantity: 4 }] });
  eq(supplierDebt(db, sup, '2026-06-16').total, 75.8, 'con abono: 75.8');
  cancelSupplierReturnSvc(db, ret.id, 'me equivoqué');
  eq(db.prepare('SELECT status FROM supplier_invoices WHERE id=?').get(ret.credit.id).status, 'anulada', 'el abono queda anulado al anular la devolución');
  eq(supplierDebt(db, sup, '2026-06-16').total, 100, 'la deuda vuelve a 100');
  db.close();
}

// ── 22. Reembolso recibido: netea a 0, no se puede sobrepasar ───────────────
console.log('22. Reembolso recibido');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 0 });
  const prod = addProductRate(db, 21, 'general');
  const { pid, lineIds } = receivedPurchaseWithStock(db, sup, [{ product_id: prod, quantity: 10, unit_cost: 5 }]);
  createSupplierInvoiceSvc(db, { entity_type: 'purchase', entity_id: pid, invoice_date: '2026-06-01', total: 100 }, {});
  const ret = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pid, date: '2026-06-05', motivo: 'x', items: [{ origin_item_id: lineIds[0].id, quantity: 4 }] });
  const abonoId = ret.credit.id;
  // Sobrepasar el crédito (24.2) → 400.
  throws(() => registerSupplierRefundSvc(db, abonoId, { amount: 30 }, { today: '2026-06-16' }), 400, 'reembolso > crédito pendiente → 400');
  // Reembolso parcial de 10 → crédito pendiente 14.2; la deuda VUELVE a subir 10 (ya tienes el dinero).
  registerSupplierRefundSvc(db, abonoId, { amount: 10 }, { today: '2026-06-16' });
  eq(supplierDebt(db, sup, '2026-06-16').total, 85.8, 'tras reembolso de 10: deuda neta 75.8 + 10 = 85.8');
  // Reembolso del resto (14.2) → crédito a 0, estado reembolsado; la deuda vuelve a 100.
  registerSupplierRefundSvc(db, abonoId, { amount: 14.2 }, { today: '2026-06-16' });
  const abono = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(abonoId);
  eq(supplierInvoicePago(db, abono, '2026-06-16').estado, 'reembolsado', 'crédito reembolsado del todo → estado reembolsado');
  eq(supplierDebt(db, sup, '2026-06-16').total, 100, 'reembolsado del todo: la deuda vuelve a 100 (el abono ya no compensa)');
  db.close();
}

// ── 23. Guarda: no anular una devolución cuyo abono ya tiene reembolso ──────
console.log('23. Guarda anular con reembolso');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 0 });
  const prod = addProductRate(db, 21, 'general');
  const { pid, lineIds } = receivedPurchaseWithStock(db, sup, [{ product_id: prod, quantity: 10, unit_cost: 5 }]);
  const ret = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pid, date: '2026-06-05', motivo: 'x', items: [{ origin_item_id: lineIds[0].id, quantity: 4 }] });
  registerSupplierRefundSvc(db, ret.credit.id, { amount: 10 }, { today: '2026-06-16' });
  throws(() => cancelSupplierReturnSvc(db, ret.id, 'intento'), 409, 'anular devolución con abono ya reembolsado → 409 (deshacer reembolso antes)');
  // La devolución sigue confirmada y el abono vigente (la transacción revirtió).
  eq(db.prepare('SELECT status FROM supplier_returns WHERE id=?').get(ret.id).status, 'confirmada', 'la devolución sigue confirmada');
  eq(db.prepare('SELECT status FROM supplier_invoices WHERE id=?').get(ret.credit.id).status, 'vigente', 'el abono sigue vigente');
  db.close();
}

// ── 24. IVA por línea según la banda del producto (mezcla 21 + 10) ──────────
console.log('24. Abono con IVA por línea (mezcla)');
{
  const db = freshDb();
  const sup = addSupplier(db, { term: 0 });
  const p21 = addProductRate(db, 21, 'general');
  const p10 = addProductRate(db, 10, 'reducido');
  const { pid, lineIds } = receivedPurchaseWithStock(db, sup, [{ product_id: p21, quantity: 10, unit_cost: 5 }, { product_id: p10, quantity: 10, unit_cost: 8 }]);
  const byProd = Object.fromEntries(lineIds.map(l => [l.product_id, l.id]));
  const ret = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pid, date: '2026-06-05', motivo: 'x',
    items: [{ origin_item_id: byProd[p21], quantity: 2 }, { origin_item_id: byProd[p10], quantity: 5 }] });
  const abono = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(ret.credit.id);
  // p21: 2×5=10 base, IVA 2.1 ; p10: 5×8=40 base, IVA 4.0 → base -50, IVA -6.1, total -56.1
  eq([abono.base, abono.tax, abono.total], [-50, -6.1, -56.1], 'IVA por línea: 21% sobre 10 + 10% sobre 40 → IVA -6.1');
  db.close();
}

console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
process.exit(fail ? 1 : 0);
