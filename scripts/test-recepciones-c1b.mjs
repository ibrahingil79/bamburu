// C1.b Recepciones contra la orden — tests de lógica. Gates del encargo:
//   · recepción total → orden RECIBIDA, stock y coste al libro
//   · dos parciales que cierran → parcial → recibida
//   · recibir más que el pendiente → rechazado (400)
//   · anulación → revierte stock con inversos, reabre la orden, recalcula coste
//   · orden no enviada (borrador/anulada) → rechazada
//   · cuadre: products.stock y average_cost == lo que dice el libro
// Extra: RC-NNNN correlativo, coste real distinto del pedido fija el WAC, línea
// ajena/repetida rechazada, orden con recepciones no se puede anular, compra
// directa intacta (misma BD).
//
//   node scripts/test-recepciones-c1b.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { createPurchaseOrderSvc, sendPurchaseOrderSvc, anularPurchaseOrderSvc } from '../modules/erp/routes/purchase-orders.js';
import { createReceiptSvc, cancelReceiptSvc, orderReceptionState, recalcReceivedStatus, receiptsOfOrder, getReceipt } from '../modules/erp/routes/purchase-order-receipts.js';
import { receivePurchaseSvc } from '../modules/erp/routes/purchases.js';
import { productStock } from '../modules/erp/stock.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, m) { ok(Math.abs(a - b) < 1e-9, m + ' (got ' + a + ', want ' + b + ')'); }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
const addSupplier = db => db.prepare("INSERT INTO suppliers (name) VALUES ('Prov')").run().lastInsertRowid;
const addProduct = db => db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,50,'physical',0,21,'general')").run('P' + (++n), 'p' + n, 'S' + n).lastInsertRowid;
function sentOrder(db, sup, items) {
  const id = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items });
  sendPurchaseOrderSvc(db, id);
  return id;
}
const orderRow = (db, id) => db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
const cache = (db, p) => db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(p);
const itemIds = (db, id) => db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? ORDER BY id').all(id).map(r => r.id);

// ── 1. Recepción TOTAL → orden RECIBIDA, stock y coste al libro ──────────────
console.log('1. Recepción total');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 10, unit_cost: 4 }]);
  const [li] = itemIds(db, oid);
  const r = createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 10, unit_cost: 4 }] });
  eq(r.receipt_number, 'RC-0001', 'primera recepción → RC-0001');
  eq(r.order_received_status, 'recibida', 'pendiente 0 → la orden pasa sola a RECIBIDA');
  eq(orderRow(db, oid).received_status, 'recibida', 'received_status guardado');
  eq(orderRow(db, oid).status, 'enviada', 'status del ciclo intacto (aditivo)');
  eq(productStock(db, p), 10, 'el libro suma 10');
  eq(cache(db, p), { stock: 10, average_cost: 4 }, 'caché stock y WAC cuadran con el libro');
  const mv = db.prepare("SELECT * FROM stock_movements WHERE origin_type='po_receipt' AND origin_id=?").all(r.id);
  eq([mv.length, mv[0].type, mv[0].quantity, mv[0].unit_cost], [1, 'entrada', 10, 4], 'entrada con coste y origen po_receipt');
  const st = orderReceptionState(db, oid);
  eq([st.lines[0].pedido, st.lines[0].recibido, st.lines[0].pendiente], [10, 10, 0], 'pedido/recibido/pendiente');
  throws(() => createReceiptSvc(db, oid, { date: '2026-06-12', items: [{ order_item_id: li, quantity: 1, unit_cost: 4 }] }), 400, 'recibir sobre orden ya completa → 400');
  db.close();
}

// ── 2. Dos parciales que cierran (con coste REAL distinto del pedido) ────────
console.log('2. Dos parciales cierran');
{
  const db = freshDb();
  const sup = addSupplier(db), a = addProduct(db), b = addProduct(db);
  const oid = sentOrder(db, sup, [
    { product_id: a, quantity: 10, unit_cost: 4 },
    { product_id: b, quantity: 6, unit_cost: 2 },
  ]);
  const [la, lb] = itemIds(db, oid);

  // 1ª parcial: 4 de A a coste REAL 5 (≠ 4 del pedido) y 6 de B al del pedido
  const r1 = createReceiptSvc(db, oid, { date: '2026-06-11', items: [
    { order_item_id: la, quantity: 4, unit_cost: 5 },
    { order_item_id: lb, quantity: 6, unit_cost: 2 },
  ] });
  eq(r1.order_received_status, 'parcial', 'con pendiente → PARCIALMENTE RECIBIDA');
  const st1 = orderReceptionState(db, oid);
  eq(st1.lines.map(l => [l.recibido, l.pendiente]), [[4, 6], [6, 0]], 'pendientes por línea tras la 1ª');
  eq(cache(db, a), { stock: 4, average_cost: 5 }, 'WAC de A usa el coste REAL (5, no 4)');
  eq(cache(db, b), { stock: 6, average_cost: 2 }, 'B completo a 2');

  // 2ª parcial: las 6 de A restantes a coste 4 → WAC = (4·5+6·4)/10 = 4.4
  const r2 = createReceiptSvc(db, oid, { date: '2026-06-12', items: [{ order_item_id: la, quantity: 6, unit_cost: 4 }] });
  eq(r2.receipt_number, 'RC-0002', 'segunda recepción → RC-0002 (correlativo)');
  eq(r2.order_received_status, 'recibida', 'la segunda cierra la orden sola');
  eq(productStock(db, a), 10, 'stock de A = 10');
  near(cache(db, a).average_cost, 4.4, 'WAC ponderado de las dos recepciones (4.4)');
  eq(receiptsOfOrder(db, oid).length, 2, 'la orden lista sus 2 recepciones');
  db.close();
}

// ── 3. No se puede recibir más que el pendiente / líneas inválidas ────────────
console.log('3. Guardas de pendiente y líneas');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db), otro = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 5, unit_cost: 3 }]);
  const otraOrden = sentOrder(db, sup, [{ product_id: otro, quantity: 2, unit_cost: 1 }]);
  const [li] = itemIds(db, oid);
  const [liAjena] = itemIds(db, otraOrden);

  throws(() => createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 6, unit_cost: 3 }] }), 400, 'recibir 6 con pedido 5 → 400');
  createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 3, unit_cost: 3 }] });
  throws(() => createReceiptSvc(db, oid, { date: '2026-06-12', items: [{ order_item_id: li, quantity: 3, unit_cost: 3 }] }), 400, 'recibir 3 con pendiente 2 → 400');
  throws(() => createReceiptSvc(db, oid, { date: '2026-06-12', items: [{ order_item_id: liAjena, quantity: 1, unit_cost: 1 }] }), 400, 'línea de OTRA orden → 400');
  throws(() => createReceiptSvc(db, oid, { date: '2026-06-12', items: [
    { order_item_id: li, quantity: 1, unit_cost: 3 }, { order_item_id: li, quantity: 1, unit_cost: 3 },
  ] }), 400, 'línea repetida en el payload → 400');
  eq(productStock(db, p), 3, 'los rechazos no movieron stock (sigue 3)');
  db.close();
}

// ── 4. Solo órdenes ENVIADAS ──────────────────────────────────────────────────
console.log('4. Solo enviadas');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const draft = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 5, unit_cost: 3 }] });
  const [liD] = itemIds(db, draft);
  throws(() => createReceiptSvc(db, draft, { date: '2026-06-11', items: [{ order_item_id: liD, quantity: 1, unit_cost: 3 }] }), 400, 'recibir contra BORRADOR → 400');
  sendPurchaseOrderSvc(db, draft);
  anularPurchaseOrderSvc(db, draft, 'ya no hace falta');
  throws(() => createReceiptSvc(db, draft, { date: '2026-06-11', items: [{ order_item_id: liD, quantity: 1, unit_cost: 3 }] }), 400, 'recibir contra ANULADA → 400');
  throws(() => createReceiptSvc(db, 9999, { date: '2026-06-11', items: [{ order_item_id: 1, quantity: 1, unit_cost: 1 }] }), 404, 'orden inexistente → 404');
  eq(productStock(db, p), 0, 'nada movió stock');
  db.close();
}

// ── 5. Anular una recepción: revierte stock, reabre la orden, recalcula coste ─
console.log('5. Anulación reabre y revierte');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 10, unit_cost: 4 }]);
  const [li] = itemIds(db, oid);
  const r1 = createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 4, unit_cost: 5 }] });
  const r2 = createReceiptSvc(db, oid, { date: '2026-06-12', items: [{ order_item_id: li, quantity: 6, unit_cost: 4 }] });
  eq(orderRow(db, oid).received_status, 'recibida', 'cerrada tras las dos');

  throws(() => cancelReceiptSvc(db, r2.id, ''), 400, 'anular sin motivo → 400');
  throws(() => cancelReceiptSvc(db, 9999, 'motivo'), 404, 'recepción inexistente → 404');

  const c2 = cancelReceiptSvc(db, r2.id, 'mercancía dañada');
  eq(c2.order_received_status, 'parcial', 'anular la 2ª REABRE la orden a parcial');
  eq(orderRow(db, oid).received_status, 'parcial', 'received_status recalculado');
  eq(productStock(db, p), 4, 'stock revertido a 4 (libro, con inversos — nada borrado)');
  near(cache(db, p).average_cost, 4.4, 'el medio no cambia con la salida (regla WAC existente)');
  const rec = getReceipt(db, r2.id);
  eq([rec.status, rec.anulada_motivo], ['anulada', 'mercancía dañada'], 'recepción anulada con su motivo, filas intactas');
  eq(rec.items.length, 1, 'sus líneas siguen ahí');
  const movs = db.prepare("SELECT type, quantity FROM stock_movements WHERE origin_type='po_receipt' AND origin_id=? ORDER BY id").all(r2.id);
  eq(movs, [{ type: 'entrada', quantity: 6 }, { type: 'salida', quantity: -6 }], 'entrada + salida inversa en el libro');
  throws(() => cancelReceiptSvc(db, r2.id, 'otra vez'), 400, 're-anular → 400');

  const st = orderReceptionState(db, oid);
  eq([st.lines[0].recibido, st.lines[0].pendiente], [4, 6], 'pendiente reabierto (recibido solo cuenta confirmadas)');

  // anular también la 1ª → la orden vuelve a SIN recepciones (received_status NULL)
  cancelReceiptSvc(db, r1.id, 'pedido equivocado');
  eq(orderRow(db, oid).received_status, null, 'sin recepciones confirmadas → received_status NULL (Enviada)');
  eq(productStock(db, p), 0, 'stock a 0 tras revertir todo');
  db.close();
}

// ── 6. La orden con recepciones confirmadas NO se puede anular ────────────────
console.log('6. Guarda de anular orden');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 5, unit_cost: 3 }]);
  const [li] = itemIds(db, oid);
  const r = createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 2, unit_cost: 3 }] });
  throws(() => anularPurchaseOrderSvc(db, oid, 'cambio de idea'), 400, 'anular orden con recepción confirmada → 400');
  cancelReceiptSvc(db, r.id, 'se devuelve todo');
  const a = anularPurchaseOrderSvc(db, oid, 'cambio de idea');
  eq(a.order_number, 'OC-0001', 'tras anular sus recepciones, la orden sí se puede anular');
  db.close();
}

// ── 7. Cuadre y convivencia con la COMPRA DIRECTA (intacta) ──────────────────
console.log('7. Cuadre + compra directa');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  // compra directa pendiente → recibir (flujo C1.a-previo, sin tocar)
  const pid = db.prepare("INSERT INTO purchases (supplier_id,date,status,total,archived) VALUES (?,?,?,?,0)").run(sup, '2026-06-09', 'pending', 20).lastInsertRowid;
  db.prepare('INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)').run(pid, p, 10, 2);
  receivePurchaseSvc(db, pid);
  eq(cache(db, p), { stock: 10, average_cost: 2 }, 'compra directa: 10 a 2');

  // recepción de orden encima: 5 a 4 → WAC = (10·2+5·4)/15 = 2.666…
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 5, unit_cost: 4 }]);
  const [li] = itemIds(db, oid);
  createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 5, unit_cost: 4 }] });
  eq(productStock(db, p), 15, 'libro = compra directa + recepción');
  eq(cache(db, p).stock, 15, 'caché == libro');
  near(cache(db, p).average_cost, 40 / 15, 'WAC mezcla ambos orígenes por el MISMO mecanismo');
  eq(db.prepare('SELECT status FROM purchases WHERE id=?').get(pid).status, 'received', 'la compra directa sigue su vida');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' C1.b Recepciones: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
