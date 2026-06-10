// C1.c Diferencias y cierre manual — tests de lógica. Gates del encargo:
//   · sobre-recepción CON flag aceptada, SIN flag rechazada (400)
//   · línea sobre-recibida → pendiente 0 (nunca negativo) y exceso correcto
//   · el WAC pondera el exceso (camino existente)
//   · cierre manual con motivo OK; sin motivo rechazado
//   · orden cerrada rechaza nuevas recepciones
//   · anular recepción de una cerrada revierte stock SIN reabrirla
//   · borrador/anulada rechazadas (recepción y cierre)
//
//   node scripts/test-c1c-diferencias-cierre.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { createPurchaseOrderSvc, sendPurchaseOrderSvc, anularPurchaseOrderSvc, closePurchaseOrderSvc, anularYRehacerSvc } from '../modules/erp/routes/purchase-orders.js';
import { createReceiptSvc, cancelReceiptSvc, orderReceptionState } from '../modules/erp/routes/purchase-order-receipts.js';
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

// ── 1. Sobre-recepción: sin flag 400, con flag aceptada; pendiente 0 + exceso ─
console.log('1. Sobre-recepción');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 10, unit_cost: 2 }]);
  const [li] = itemIds(db, oid);

  throws(() => createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 12, unit_cost: 2 }] }),
    400, 'exceso SIN confirm_excess → 400');
  eq(productStock(db, p), 0, 'el rechazo no movió stock');

  const r = createReceiptSvc(db, oid, { date: '2026-06-11', confirm_excess: true, items: [{ order_item_id: li, quantity: 12, unit_cost: 2 }] });
  eq(r.excess_lines, 1, 'el servicio reporta la línea con exceso');
  eq(r.order_received_status, 'recibida', 'línea sobre-recibida cuenta como completada → orden RECIBIDA');
  const st = orderReceptionState(db, oid);
  eq([st.lines[0].pedido, st.lines[0].recibido, st.lines[0].pendiente, st.lines[0].exceso], [10, 12, 0, 2],
     'pedido 10 / recibido 12 / pendiente 0 (nunca negativo) / exceso +2');
  eq(productStock(db, p), 12, 'el exceso entra al libro como cualquier entrada');
  eq(cache(db, p), { stock: 12, average_cost: 2 }, 'caché == libro, coste 2');
  throws(() => createReceiptSvc(db, oid, { date: '2026-06-12', confirm_excess: true, items: [{ order_item_id: li, quantity: 1, unit_cost: 2 }] }),
    400, 'orden ya completa: ni con flag se abre otra recepción');
  db.close();
}

// ── 2. El WAC pondera el exceso por el camino existente ──────────────────────
console.log('2. WAC con exceso');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 10, unit_cost: 4 }]);
  const [li] = itemIds(db, oid);
  // 1ª recepción normal: 6 a 4. 2ª con exceso: 6 más (total 12 de 10) a coste real 5.
  createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 6, unit_cost: 4 }] });
  const r2 = createReceiptSvc(db, oid, { date: '2026-06-12', confirm_excess: true, items: [{ order_item_id: li, quantity: 6, unit_cost: 5 }] });
  eq(r2.order_received_status, 'recibida', 'cierra con exceso');
  eq(productStock(db, p), 12, 'stock 12');
  near(cache(db, p).average_cost, (6 * 4 + 6 * 5) / 12, 'WAC pondera el exceso: (6·4+6·5)/12 = 4.5');
  const st = orderReceptionState(db, oid);
  eq([st.lines[0].pendiente, st.lines[0].exceso], [0, 2], 'pendiente 0, exceso +2');
  // exceso parcial multi-línea: una línea con exceso y otra pendiente → parcial
  const b = addProduct(db);
  const oid2 = sentOrder(db, sup, [{ product_id: p, quantity: 2, unit_cost: 1 }, { product_id: b, quantity: 5, unit_cost: 1 }]);
  const [l1, l2] = itemIds(db, oid2);
  const rp = createReceiptSvc(db, oid2, { date: '2026-06-12', confirm_excess: true, items: [{ order_item_id: l1, quantity: 3, unit_cost: 1 }] });
  eq(rp.order_received_status, 'parcial', 'exceso en una línea con otra pendiente → PARCIAL');
  db.close();
}

// ── 3. Cierre manual: motivo obligatorio, estados correctos ──────────────────
console.log('3. Cierre manual');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 10, unit_cost: 2 }]);
  const [li] = itemIds(db, oid);
  createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 3, unit_cost: 2 }] });

  throws(() => closePurchaseOrderSvc(db, oid, ''), 400, 'cerrar sin motivo → 400');
  throws(() => closePurchaseOrderSvc(db, oid, 'ab'), 400, 'motivo de 2 caracteres → 400');
  const r = closePurchaseOrderSvc(db, oid, 'el proveedor ya no sirve este artículo');
  eq(r.order_number, 'OC-0001', 'cierra y devuelve el número');
  const o = orderRow(db, oid);
  eq([o.received_status, o.cerrada_motivo], ['cerrada_manual', 'el proveedor ya no sirve este artículo'], 'cerrada_manual + motivo guardado');
  eq(o.status, 'enviada', 'status del ciclo intacto (aditivo)');
  eq(productStock(db, p), 3, 'cerrar NO movió stock');
  eq(db.prepare("SELECT COUNT(*) c FROM purchase_order_receipts WHERE order_id=?").get(oid).c, 1, 'cerrar NO creó recepciones');

  throws(() => closePurchaseOrderSvc(db, oid, 'otra vez'), 400, 're-cerrar → 400');
  throws(() => createReceiptSvc(db, oid, { date: '2026-06-12', items: [{ order_item_id: li, quantity: 1, unit_cost: 2 }] }),
    400, 'orden cerrada rechaza nuevas recepciones');
  throws(() => createReceiptSvc(db, oid, { date: '2026-06-12', confirm_excess: true, items: [{ order_item_id: li, quantity: 1, unit_cost: 2 }] }),
    400, 'tampoco con confirm_excess');
  db.close();
}

// ── 4. Anular recepción de una cerrada: revierte stock SIN reabrirla ─────────
console.log('4. Cerrada es terminal');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 10, unit_cost: 2 }]);
  const [li] = itemIds(db, oid);
  const rec = createReceiptSvc(db, oid, { date: '2026-06-11', items: [{ order_item_id: li, quantity: 4, unit_cost: 2 }] });
  closePurchaseOrderSvc(db, oid, 'descatalogado');
  eq(orderRow(db, oid).received_status, 'cerrada_manual', 'cerrada');

  const c = cancelReceiptSvc(db, rec.id, 'mercancía defectuosa');
  eq(c.order_received_status, 'cerrada_manual', 'anular su recepción NO la reabre (terminal)');
  eq(orderRow(db, oid).received_status, 'cerrada_manual', 'sigue cerrada en BD');
  eq(orderRow(db, oid).cerrada_motivo, 'descatalogado', 'conserva su motivo');
  eq(productStock(db, p), 0, 'pero el stock de la recepción SÍ se revirtió (inversos)');
  const movs = db.prepare("SELECT type, quantity FROM stock_movements WHERE origin_type='po_receipt' ORDER BY id").all();
  eq(movs, [{ type: 'entrada', quantity: 4 }, { type: 'salida', quantity: -4 }], 'entrada + salida inversa, nada borrado');
  db.close();
}

// ── 5. Borradores y anuladas: ni recepción ni cierre ──────────────────────────
console.log('5. Borrador/anulada rechazadas');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const draft = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 5, unit_cost: 1 }] });
  throws(() => closePurchaseOrderSvc(db, draft, 'no procede'), 400, 'cerrar un BORRADOR → 400');
  sendPurchaseOrderSvc(db, draft);
  anularPurchaseOrderSvc(db, draft, 'pedido por error');
  throws(() => closePurchaseOrderSvc(db, draft, 'no procede'), 400, 'cerrar una ANULADA → 400');
  throws(() => closePurchaseOrderSvc(db, 9999, 'x x x'), 404, 'cerrar inexistente → 404');
  // recibida completa tampoco se cierra (no hay pendiente)
  const oid2 = sentOrder(db, sup, [{ product_id: p, quantity: 2, unit_cost: 1 }]);
  const [li2] = itemIds(db, oid2);
  createReceiptSvc(db, oid2, { date: '2026-06-11', items: [{ order_item_id: li2, quantity: 2, unit_cost: 1 }] });
  throws(() => closePurchaseOrderSvc(db, oid2, 'no procede'), 400, 'cerrar una RECIBIDA completa → 400');
  db.close();
}

// ── 6. Rehacer tras cierre = orden nueva (patrón existente, sin recepciones) ──
console.log('6. Rehacer tras cierre');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 5, unit_cost: 1 }]);
  closePurchaseOrderSvc(db, oid, 'proveedor sin stock');
  // sin recepciones confirmadas → anular-y-rehacer sigue disponible como vía de rehacer
  const r = anularYRehacerSvc(db, oid, 'se rehace con otro proveedor', { today: '2026-06-11' });
  eq(orderRow(db, r.id).replaces_order_id, oid, 'el borrador nuevo referencia a la cerrada+anulada');
  // con recepciones confirmadas → bloqueado (regla C1.b intacta)
  const oid2 = sentOrder(db, sup, [{ product_id: p, quantity: 5, unit_cost: 1 }]);
  const [li2] = itemIds(db, oid2);
  createReceiptSvc(db, oid2, { date: '2026-06-11', items: [{ order_item_id: li2, quantity: 1, unit_cost: 1 }] });
  closePurchaseOrderSvc(db, oid2, 'el resto no llega');
  throws(() => anularPurchaseOrderSvc(db, oid2, 'intento'), 400, 'cerrada CON recepciones: anular sigue bloqueado');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' C1.c Diferencias y cierre: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
