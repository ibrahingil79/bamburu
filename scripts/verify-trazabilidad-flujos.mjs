// Gate — TRAZABILIDAD por lote/serie, FLUJOS reales (Pilar 3). Sobre COPIA de BD real: recorre el bucle
// entero por los SERVICIOS de verdad — orden de compra → recepción (captura lote/serie) → venta mostrador
// y albarán (consumo FEFO) → anulación (reingreso al lote) → informe. La INVARIANTE que vigila en cada
// paso: la suma de los saldos por lote == el stock del producto (la traza nunca descuadra el libro). Y que
// las guardas bloquean un producto trazado en los flujos aún no cableados (ajuste, traslado, devolución,
// compra directa). Limpia por id.
//
//   node scripts/verify-trazabilidad-flujos.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { copyFileSync, unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createPurchaseOrderSvc, sendPurchaseOrderSvc } from '../modules/erp/routes/purchase-orders.js';
import { createReceiptSvc, cancelReceiptSvc } from '../modules/erp/routes/purchase-order-receipts.js';
import { emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { createAlbaranSvc, cancelAlbaranSvc } from '../modules/erp/routes/albaranes.js';
import { createStockTransferSvc } from '../modules/erp/routes/stock-transfers.js';
import { createSupplierReturnSvc } from '../modules/erp/routes/supplier-returns.js';
import { createDirectPurchaseSvc } from '../modules/erp/routes/purchases.js';
import { adjustStock, productStock, defaultWarehouseId } from '../modules/erp/stock.js';
import { lotesDeProducto, saldoLote, trazaDeLote } from '../modules/erp/trazabilidad.js';
// 24 ago 2026 · La copia va por `copiarBase` (sqlite .backup), no por copyFileSync: los negocios
// corren en WAL y un `cp` deja fuera el -wal, o sea mide una foto vieja. Ver scripts/lib/copia-consistente.mjs.
import { copiarBase } from './lib/copia-consistente.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const throws = (fn, m) => { let s = false; try { fn(); } catch (e) { s = e.status === 400; } ok(s, m); };

const copias = [];
let nCopias = 0;
function copia(slug) {
  // UN NOMBRE POR LLAMADA, no por negocio. 24 ago 2026: `copia('desarrollo-bamburu')` se llama DOS
  // veces (secciones 1 y 5) y las dos caían en el mismo fichero temporal, así que la segunda pisaba
  // la base que la primera todavía tenía abierta. Con `cp` colaba de milagro; al copiar bien, la
  // sección 6 dejó de encontrar el lote L-A. El fallo llevaba ahí desde siempre, tapado.
  const p = join(tmpdir(), 'traz-' + slug + '-' + process.pid + '-' + (++nCopias) + '.db');
  copiarBase(`data/tenants/${slug}.db`, p); copias.push(p);
  const db = new Database(p); runMigrations(db);
  return db;
}
let seq = 8100;
const proveedor = (db, n) => Number(db.prepare("INSERT INTO suppliers (name, active) VALUES (?,1)").run(n).lastInsertRowid);
function producto(db, name, tracking) {
  seq++;
  return Number(db.prepare("INSERT INTO products (name, slug, sku, price, status, type, stock, tax_rate, tax_band, tracking) VALUES (?,?,?,20,'active','physical',0,21,'general',?)")
    .run(name, 'trz-' + seq, 'TRZ' + seq, tracking).lastInsertRowid);
}
// Invariante: ∑ saldos de lotes del producto == stock del producto.
function cuadra(db, pid) {
  const sumLotes = lotesDeProducto(db, pid).reduce((s, l) => s + l.saldo, 0);
  return sumLotes === productStock(db, pid);
}
// Recibe una orden ENTERA contra sus líneas, con la traza indicada por producto.
function recibir(db, orderId, W, lotesPorProducto) {
  const its = db.prepare('SELECT id, product_id, quantity FROM purchase_order_items WHERE order_id=?').all(orderId);
  return createReceiptSvc(db, orderId, {
    date: '2026-07-15', notes: '', warehouse_id: W,
    items: its.map(it => ({ order_item_id: it.id, quantity: it.quantity, unit_cost: 3, lotes: lotesPorProducto[it.product_id] })),
  });
}

try {
  const db = copia('desarrollo-bamburu');
  const W = defaultWarehouseId(db);
  const S = proveedor(db, 'ZZ Prov traza');
  const LOTE = producto(db, 'ZZ Yogur (lote)', 'lot');
  const SERIE = producto(db, 'ZZ Portátil (serie)', 'serial');

  // ── 1. Orden de compra + recepción con captura de lote/serie ────────────────
  console.log('\n[1] Recepción: captura de lote y serie');
  const poId = Number(createPurchaseOrderSvc(db, { supplier_id: S, date: '2026-07-15', items: [
    { product_id: LOTE, quantity: 10, unit_cost: 3 }, { product_id: SERIE, quantity: 3, unit_cost: 300 },
  ] }));
  sendPurchaseOrderSvc(db, poId);
  const rec = recibir(db, poId, W, {
    [LOTE]: [{ code: 'L-A', expiry: '2026-09-01', quantity: 6 }, { code: 'L-B', expiry: '2026-08-01', quantity: 4 }],
    [SERIE]: [{ code: 'SN-1' }, { code: 'SN-2' }, { code: 'SN-3' }],
  });
  ok(productStock(db, LOTE) === 10 && productStock(db, SERIE) === 3, 'entran 10 del lote y 3 de serie');
  ok(cuadra(db, LOTE) && cuadra(db, SERIE), 'INVARIANTE: ∑ saldos de lotes == stock, en ambos');
  const lotes = lotesDeProducto(db, LOTE);
  ok(lotes.length === 2 && lotes.find(l => l.code === 'L-A').saldo === 6 && lotes.find(l => l.code === 'L-B').saldo === 4, 'dos lotes con su saldo y caducidad');
  ok(lotesDeProducto(db, SERIE).length === 3 && lotesDeProducto(db, SERIE).every(l => l.saldo === 1), '3 series de saldo 1');

  // Recibir cantidad que NO cuadra con las unidades por lote → 400.
  const poId2 = Number(createPurchaseOrderSvc(db, { supplier_id: S, date: '2026-07-15', items: [{ product_id: LOTE, quantity: 5, unit_cost: 3 }] }));
  sendPurchaseOrderSvc(db, poId2);
  throws(() => recibir(db, poId2, W, { [LOTE]: [{ code: 'X', quantity: 3 }] }), 'recibir 5 declarando 3 en lotes → 400 (no cuadra)');

  // ── 2. Venta MOSTRADOR con consumo FEFO ─────────────────────────────────────
  console.log('\n[2] Mostrador: consumo FEFO');
  emitTicketSvc(db, { lines: [{ product_id: LOTE, quantity: 5 }], warehouse_id: W, payment_method: 'efectivo' });
  ok(productStock(db, LOTE) === 5 && cuadra(db, LOTE), 'sale 5 del lote; invariante se mantiene');
  const trasVenta = lotesDeProducto(db, LOTE);
  ok(trasVenta.find(l => l.code === 'L-B').saldo === 0 && trasVenta.find(l => l.code === 'L-A').saldo === 5,
     'FEFO: se agotó L-B (caduca antes, 4) y se tomó 1 de L-A → L-A=5, L-B=0');

  // No se puede sobrevender un trazado (no hay lote que consumir) → el ticket no se emite.
  throws(() => emitTicketSvc(db, { lines: [{ product_id: LOTE, quantity: 99 }], warehouse_id: W, payment_method: 'efectivo' }),
     'vender más de lo que hay trazado → 400 (un trazado no se sobrevende)');

  // ── 3. Albarán con consumo FEFO + anulación que reingresa al lote ───────────
  console.log('\n[3] Albarán: consumo FEFO y anulación');
  const cli = Number(db.prepare("INSERT INTO clients (name, active) VALUES ('ZZ Cliente traza',1)").run().lastInsertRowid);
  const alb = createAlbaranSvc(db, { client_id: cli, warehouse_id: W, date: '2026-07-15', notes: '', lines: [{ product_id: LOTE, description: 'ZZ Yogur', quantity: 2, unit_price: 20, tax_rate: 21 }], confirm_over: false });
  ok(productStock(db, LOTE) === 3 && cuadra(db, LOTE), 'albarán entrega 2 (FEFO de L-A); quedan 3; invariante ok');
  ok(lotesDeProducto(db, LOTE).find(l => l.code === 'L-A').saldo === 3, 'salió de L-A (el único con saldo)');
  cancelAlbaranSvc(db, alb.id, 'prueba');
  ok(productStock(db, LOTE) === 5 && lotesDeProducto(db, LOTE).find(l => l.code === 'L-A').saldo === 5 && cuadra(db, LOTE),
     'anular el albarán REINGRESA a su lote (L-A vuelve a 5); invariante ok');

  // ── 4. Guardas: un trazado no se mueve por flujos sin captura de lote ───────
  console.log('\n[4] Guardas de los flujos aún no cableados');
  throws(() => adjustStock(db, LOTE, { mode: 'sub', value: 1, reason: 'rotura' }), 'ajuste manual de un trazado → 400');
  const W2 = Number(db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES ('ZZ W2',1,0)").lastInsertRowid);
  throws(() => createStockTransferSvc(db, { from_warehouse_id: W, to_warehouse_id: W2, date: '2026-07-15', items: [{ product_id: LOTE, quantity: 1 }] }), 'traslado de un trazado → 400');
  throws(() => createSupplierReturnSvc(db, { origin_type: 'po_receipt', origin_id: rec.id, date: '2026-07-15', motivo: 'x', items: [{ origin_item_id: 1, quantity: 1 }] }), 'devolución a proveedor de un trazado → 400');
  throws(() => createDirectPurchaseSvc(db, { supplier_id: S, date: '2026-07-15', status: 'received', items: [{ product_id: LOTE, quantity: 1, unit_cost: 3 }] }), 'compra directa de un trazado → 400');
  // Un producto SIN traza sigue funcionando en esos flujos (no se rompió nada):
  const NORMAL = producto(db, 'ZZ Normal', 'none');
  createDirectPurchaseSvc(db, { supplier_id: S, date: '2026-07-15', status: 'received', items: [{ product_id: NORMAL, quantity: 5, unit_cost: 2 }] });
  ok(productStock(db, NORMAL) === 5, 'un producto SIN traza entra por compra directa como siempre (no se rompió)');

  // ── 5. Anular la recepción: cada lote vuelve a 0 ────────────────────────────
  console.log('\n[5] Anular recepción trazada');
  // (Primero deshago la venta para poder anular limpio no hace falta: la anulación solo revierte SUS
  //  movimientos; el saldo puede quedar negativo si ya se vendió — se prueba en otra copia limpia.)
  const db2 = copia('desarrollo-bamburu');
  const W_ = defaultWarehouseId(db2); const S_ = proveedor(db2, 'ZZ P'); const P_ = producto(db2, 'ZZ Yogur2', 'lot');
  const po_ = Number(createPurchaseOrderSvc(db2, { supplier_id: S_, date: '2026-07-15', items: [{ product_id: P_, quantity: 8, unit_cost: 1 }] }));
  sendPurchaseOrderSvc(db2, po_);
  const rec_ = recibir(db2, po_, W_, { [P_]: [{ code: 'A', expiry: '2026-10-01', quantity: 5 }, { code: 'B', expiry: '2026-09-01', quantity: 3 }] });
  ok(productStock(db2, P_) === 8, 'recepción: 8 en stock');
  cancelReceiptSvc(db2, rec_.id, 'prueba de anulación');
  ok(productStock(db2, P_) === 0 && lotesDeProducto(db2, P_).every(l => l.saldo === 0) && cuadra(db2, P_),
     'anular la recepción deja cada lote a 0 y el stock a 0 (el saldo vuelve a SU lote)');

  // ── 6. Informe de traza ─────────────────────────────────────────────────────
  console.log('\n[6] Informe: de dónde vino / a dónde fue');
  const lA = lotesDeProducto(db, LOTE).find(l => l.code === 'L-A');
  const t = trazaDeLote(db, lA.id);
  ok(t.movimientos.some(m => m.origin_type === 'po_receipt') && t.movimientos.some(m => m.origin_type === 'ticket'),
     'el informe del lote L-A muestra su ENTRADA (recepción) y su SALIDA (ticket)');
  ok(t.saldo === 5, 'y su saldo actual (5)');

} finally {
  for (const p of copias) { for (const f of [p, p + '-wal', p + '-shm']) { try { unlinkSync(f); } catch {} } }
  console.log('\n  (copias desechables borradas; el negocio vivo NO se ha tocado)');
}
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Trazabilidad (flujos): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
