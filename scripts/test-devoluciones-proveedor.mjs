// Devoluciones a proveedor — tests de lógica (solo capa física). Gates del encargo:
//   · devolvible = recibido − devuelto, desde compra recibida Y desde recepción confirmada
//   · guardas: origen debe haber movido stock; cantidad ≤ devolvible; línea ajena/repetida;
//     solo productos físicos; origen no elegible (pendiente/inexistente)
//   · numeración DEV-NNNN correlativa, asignada al confirmar
//   · WAC: salida al confirmar NO cambia el medio; anular re-entra con coste de origen y
//     recompone el medio (NO lo hunde a 0) — el punto frágil
//   · libro: salida al confirmar, entrada al anular; nada se borra
//   · integridad: compra/recepción con devoluciones confirmadas NO se puede cancelar/anular
//   · foto congelada del proveedor; cuadre caché==libro
//
//   node scripts/test-devoluciones-proveedor.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { createPurchaseOrderSvc, sendPurchaseOrderSvc } from '../modules/erp/routes/purchase-orders.js';
import { createReceiptSvc, cancelReceiptSvc } from '../modules/erp/routes/purchase-order-receipts.js';
import { createDirectPurchaseSvc, cancelPurchaseSvc } from '../modules/erp/routes/purchases.js';
import { createSupplierReturnSvc, cancelSupplierReturnSvc, returnableLines, eligibleOrigins, getReturn, hasConfirmedReturns } from '../modules/erp/routes/supplier-returns.js';
import { productStock } from '../modules/erp/stock.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, m) { ok(Math.abs(a - b) < 1e-9, m + ' (got ' + a + ', want ' + b + ')'); }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
const addSupplier = db => db.prepare("INSERT INTO suppliers (name,fiscal_id) VALUES ('Prov SL','B12345678')").run().lastInsertRowid;
const addProduct = db => db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,50,'physical',0,21,'general')").run('P' + (++n), 'p' + n, 'S' + n).lastInsertRowid;
const addService = db => db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,50,'service',0,21,'general')").run('Srv' + (++n), 'srv' + n, 'SV' + n).lastInsertRowid;
const cache = (db, p) => db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(p);
const itemIds = (db, oid) => db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? ORDER BY id').all(oid).map(r => r.id);
function recvOrder(db, sup, items) { const oid = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items }); sendPurchaseOrderSvc(db, oid); return oid; }
function directPurchase(db, sup, items) { return createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-09', status: 'received', items }); }
const pItemId = (db, pid) => db.prepare('SELECT id FROM purchase_items WHERE purchase_id=? ORDER BY id LIMIT 1').get(pid).id;
const recItemId = (db, rid) => db.prepare('SELECT id FROM purchase_order_receipt_items WHERE receipt_id=? ORDER BY id LIMIT 1').get(rid).id;

// ── 1. Devolución desde COMPRA DIRECTA: salida, número, WAC intacto ───────────
console.log('1. Devolución desde compra directa');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const pu = directPurchase(db, sup, [{ product_id: p, quantity: 10, unit_cost: 4 }]);
  eq(cache(db, p), { stock: 10, average_cost: 4 }, 'compra: 10 a coste 4');

  const oi = pItemId(db, pu);
  const lines = returnableLines(db, 'purchase', pu);
  eq([lines.length, lines[0].recibido, lines[0].devuelto, lines[0].devolvible], [1, 10, 0, 10], 'devolvible inicial = recibido (10)');

  const r = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-12', motivo: 'defectuosa', items: [{ origin_item_id: oi, quantity: 4 }] });
  eq(r.return_number, 'DEV-0001', 'primera devolución → DEV-0001');
  eq(productStock(db, p), 6, 'stock baja a 6');
  eq(cache(db, p).average_cost, 4, 'WAC NO cambia con la salida (sigue 4)');
  const mv = db.prepare("SELECT type, quantity, unit_cost FROM stock_movements WHERE origin_type='supplier_return' AND origin_id=?").all(r.id);
  eq(mv, [{ type: 'salida', quantity: -4, unit_cost: null }], 'salida en el libro con coste NULL');
  const ret = getReturn(db, r.id);
  eq([ret.supplier_name, ret.supplier_fiscal_id], ['Prov SL', 'B12345678'], 'foto congelada del proveedor');
  eq(ret.items[0].unit_cost, 4, 'el coste de origen se guarda en la línea (para el valor)');

  // devolvible se reduce tras la confirmada
  const lines2 = returnableLines(db, 'purchase', pu);
  eq([lines2[0].devuelto, lines2[0].devolvible], [4, 6], 'devolvible tras devolver 4 = 6');
  db.close();
}

// ── 2. WAC tras ANULAR (punto frágil): re-entra con coste de origen, no a 0 ───
console.log('2. Anular reintegra y recompone el WAC');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const pu = directPurchase(db, sup, [{ product_id: p, quantity: 10, unit_cost: 4 }]);
  const oi = pItemId(db, pu);
  const r = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-12', motivo: 'defectuosa', items: [{ origin_item_id: oi, quantity: 4 }] });
  eq([productStock(db, p), cache(db, p).average_cost], [6, 4], 'tras devolver: stock 6, WAC 4');

  throws(() => cancelSupplierReturnSvc(db, r.id, ''), 400, 'anular sin motivo → 400');
  throws(() => cancelSupplierReturnSvc(db, 9999, 'x motivo'), 404, 'devolución inexistente → 404');

  const c = cancelSupplierReturnSvc(db, r.id, 'el proveedor no la acepta');
  eq(c.reverted_lines, 1, 'anulación reintegra 1 línea');
  eq(productStock(db, p), 10, 'stock vuelve a 10');
  eq(cache(db, p).average_cost, 4, 'WAC recompuesto exacto (4), NO hundido a 0');
  const movs = db.prepare("SELECT type, quantity, unit_cost FROM stock_movements WHERE origin_type='supplier_return' AND origin_id=? ORDER BY id").all(r.id);
  eq(movs, [{ type: 'salida', quantity: -4, unit_cost: null }, { type: 'entrada', quantity: 4, unit_cost: 4 }], 'libro: salida(NULL) + entrada(coste origen)');
  const ret = getReturn(db, r.id);
  eq([ret.status, ret.anulada_motivo], ['anulada', 'el proveedor no la acepta'], 'devolución anulada con motivo; filas intactas');
  eq(ret.items.length, 1, 'sus líneas siguen ahí (nada borrado)');
  throws(() => cancelSupplierReturnSvc(db, r.id, 'otra vez'), 400, 're-anular → 400');
  // tras anular, vuelve a ser devolvible
  eq(returnableLines(db, 'purchase', pu)[0].devolvible, 10, 'tras anular, devolvible vuelve a 10');
  db.close();
}

// ── 2b. WAC con coste mixto: anular re-entra con SU coste de origen (no a 0) ──
console.log('2b. WAC mixto no se corrompe');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  directPurchase(db, sup, [{ product_id: p, quantity: 10, unit_cost: 4 }]);
  const pu2 = directPurchase(db, sup, [{ product_id: p, quantity: 10, unit_cost: 6 }]);
  near(cache(db, p).average_cost, 5, 'WAC mezclado = 5 (10@4 + 10@6)');
  const oi2 = pItemId(db, pu2);
  const r = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu2, date: '2026-06-12', motivo: 'sobrante', items: [{ origin_item_id: oi2, quantity: 5 }] });
  eq([productStock(db, p), cache(db, p).average_cost], [15, 5], 'tras devolver 5: stock 15, WAC 5 (salida no toca el medio)');
  cancelSupplierReturnSvc(db, r.id, 'el proveedor rechaza la devolución');
  eq(productStock(db, p), 20, 'stock vuelve a 20');
  ok(cache(db, p).average_cost > 0, 'WAC NO se hunde a 0 al reintegrar (re-entra con coste 6 de origen)');
  db.close();
}

// ── 3. Devolución desde RECEPCIÓN de orden ───────────────────────────────────
console.log('3. Devolución desde recepción confirmada');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = recvOrder(db, sup, [{ product_id: p, quantity: 8, unit_cost: 3 }]);
  const [li] = itemIds(db, oid);
  const rec = createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 8, unit_cost: 3 }] });
  eq(cache(db, p), { stock: 8, average_cost: 3 }, 'recepción: 8 a 3');

  const ri = recItemId(db, rec.id);
  const lines = returnableLines(db, 'po_receipt', rec.id);
  eq([lines[0].recibido, lines[0].devolvible, lines[0].unit_cost], [8, 8, 3], 'devolvible de la recepción = 8, coste 3');
  const r = createSupplierReturnSvc(db, { origin_type: 'po_receipt', origin_id: rec.id, date: '2026-06-12', motivo: 'rotas en almacén', items: [{ origin_item_id: ri, quantity: 3 }] });
  eq(productStock(db, p), 5, 'stock baja a 5');
  eq(cache(db, p).average_cost, 3, 'WAC intacto (3)');
  eq(r.return_number, 'DEV-0001', 'numeración independiente del origen');
  db.close();
}

// ── 4. Guardas: exceso, ajena, repetida, no física, origen no elegible ───────
console.log('4. Guardas');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db), otro = addProduct(db);
  const pu = directPurchase(db, sup, [{ product_id: p, quantity: 5, unit_cost: 2 }]);
  const puOtro = directPurchase(db, sup, [{ product_id: otro, quantity: 2, unit_cost: 1 }]);
  const oi = pItemId(db, pu), oiAjena = pItemId(db, puOtro);

  // (el motivo < 3 lo corta el schema/middleware; el servicio recibe ya validado)
  // exceso
  throws(() => createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-12', motivo: 'defecto', items: [{ origin_item_id: oi, quantity: 6 }] }), 400, 'devolver 6 con devolvible 5 → 400');
  // línea ajena
  throws(() => createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-12', motivo: 'defecto', items: [{ origin_item_id: oiAjena, quantity: 1 }] }), 400, 'línea de OTRA compra → 400');
  // repetida
  throws(() => createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-12', motivo: 'defecto', items: [{ origin_item_id: oi, quantity: 1 }, { origin_item_id: oi, quantity: 1 }] }), 400, 'línea repetida → 400');
  // acumulado supera devolvible (parcial + parcial)
  createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-12', motivo: 'defecto', items: [{ origin_item_id: oi, quantity: 3 }] });
  throws(() => createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-13', motivo: 'defecto', items: [{ origin_item_id: oi, quantity: 3 }] }), 400, 'devolver 3 con devolvible ya 2 → 400');
  eq(productStock(db, p), 2, 'los rechazos no movieron stock (5 − 3 confirmada = 2)');
  db.close();
}

// ── 4b. Producto NO físico excluido + origen no elegible ─────────────────────
console.log('4b. No físico / origen no elegible');
{
  const db = freshDb();
  const sup = addSupplier(db), fis = addProduct(db), srv = addService(db);
  // compra con una línea física y una de servicio
  const pu = createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-09', status: 'received', items: [
    { product_id: fis, quantity: 4, unit_cost: 2 }, { product_id: srv, quantity: 1, unit_cost: 9 },
  ] });
  const lines = returnableLines(db, 'purchase', pu);
  eq(lines.length, 1, 'solo la línea FÍSICA es devolvible (servicio excluido)');
  eq(lines[0].product_id, fis, 'la línea devolvible es la física');

  // origen pendiente (no movió stock) → no elegible
  const pend = createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-09', status: 'pending', items: [{ product_id: fis, quantity: 3, unit_cost: 2 }] });
  const oiPend = pItemId(db, pend);
  throws(() => createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pend, date: '2026-06-12', motivo: 'defecto', items: [{ origin_item_id: oiPend, quantity: 1 }] }), 400, 'compra PENDIENTE → 400 (no movió stock)');
  throws(() => createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: 9999, date: '2026-06-12', motivo: 'defecto', items: [{ origin_item_id: 1, quantity: 1 }] }), 404, 'origen inexistente → 404');
  db.close();
}

// ── 5. Integridad: no cancelar/anular un origen con devoluciones confirmadas ──
console.log('5. Guarda de integridad bidireccional');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  // compra directa
  const pu = directPurchase(db, sup, [{ product_id: p, quantity: 5, unit_cost: 2 }]);
  const oi = pItemId(db, pu);
  const r = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-12', motivo: 'defecto', items: [{ origin_item_id: oi, quantity: 2 }] });
  ok(hasConfirmedReturns(db, 'purchase', pu), 'la compra consta con devoluciones confirmadas');
  throws(() => cancelPurchaseSvc(db, pu), 409, 'cancelar compra con devolución confirmada → 409');
  cancelSupplierReturnSvc(db, r.id, 'anulo la devolución primero');
  const cc = cancelPurchaseSvc(db, pu);
  eq(cc.reverted, true, 'tras anular la devolución, la compra SÍ se puede cancelar');

  // recepción de orden
  const oid = recvOrder(db, sup, [{ product_id: p, quantity: 6, unit_cost: 3 }]);
  const [li] = itemIds(db, oid);
  const rec = createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 6, unit_cost: 3 }] });
  const ri = recItemId(db, rec.id);
  const r2 = createSupplierReturnSvc(db, { origin_type: 'po_receipt', origin_id: rec.id, date: '2026-06-12', motivo: 'defecto', items: [{ origin_item_id: ri, quantity: 2 }] });
  throws(() => cancelReceiptSvc(db, rec.id, 'quiero anular la recepción'), 409, 'anular recepción con devolución confirmada → 409');
  cancelSupplierReturnSvc(db, r2.id, 'anulo la devolución de la recepción');
  const cr = cancelReceiptSvc(db, rec.id, 'ahora sí anulo la recepción');
  eq(cr.reverted_lines, 1, 'tras anular la devolución, la recepción SÍ se puede anular');
  db.close();
}

// ── 6. Cuadre caché==libro, numeración correlativa, orígenes elegibles ───────
console.log('6. Cuadre + correlativo + elegibles');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const pu = directPurchase(db, sup, [{ product_id: p, quantity: 10, unit_cost: 4 }]);
  const oi = pItemId(db, pu);
  const r1 = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-12', motivo: 'lote 1', items: [{ origin_item_id: oi, quantity: 2 }] });
  const r2 = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-13', motivo: 'lote 2', items: [{ origin_item_id: oi, quantity: 3 }] });
  eq([r1.return_number, r2.return_number], ['DEV-0001', 'DEV-0002'], 'DEV correlativo');
  const libro = db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(p).s;
  eq(cache(db, p).stock, libro, 'caché products.stock == suma del libro');
  eq(productStock(db, p), 5, 'stock = 10 − 2 − 3 = 5');
  const elig = eligibleOrigins(db);
  ok(elig.some(o => o.origin_type === 'purchase' && o.origin_id === pu), 'la compra sigue elegible (aún quedan 5 devolvibles)');
  // agotar lo devolvible → deja de ser elegible
  createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pu, date: '2026-06-14', motivo: 'lote 3', items: [{ origin_item_id: oi, quantity: 5 }] });
  ok(!eligibleOrigins(db).some(o => o.origin_id === pu && o.origin_type === 'purchase'), 'sin devolvible → fuera de elegibles');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Devoluciones a proveedor: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
