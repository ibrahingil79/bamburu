// Test de lógica de Traslados (Multi-almacén · Capa 3). BD en memoria, migración real.
// Ejecuta: node scripts/test-transfers.js
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { recordMovement, productStock, productStockInWarehouse } from '../modules/erp/stock.js';
import { createStockTransferSvc, cancelStockTransferSvc, hasActiveTransfersFromOrigin, getTransfer } from '../modules/erp/routes/stock-transfers.js';

let pass = 0, fail = 0;
const approx = (a, b) => Math.abs(a - b) < 1e-6;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FALLO: ' + name); } }
function expectThrow(name, status, fn) {
  try { fn(); fail++; console.log('  ✗ FALLO (no lanzó): ' + name); }
  catch (e) { const good = e.status === status; if (good) { pass++; console.log('  ✓ ' + name + ' (→ ' + status + ')'); } else { fail++; console.log('  ✗ FALLO ' + name + ': esperaba ' + status + ', dio ' + e.status + ' (' + e.message + ')'); } }
}

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrations(db);

// Dos almacenes: principal (A) ya sembrado; creamos B.
const A = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
const Bid = db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES ('Almacén B', 1, 0)").run().lastInsertRowid;
const B = Number(Bid);

// Producto físico.
const P = db.prepare("INSERT INTO products (name, slug, price, type, status) VALUES ('Widget','widget',10,'physical','active')").run().lastInsertRowid;
const wac = () => db.prepare('SELECT average_cost FROM products WHERE id=?').get(P).average_cost;

// Sembrar 10 uds @ coste 5 en A (entrada con coste → fija WAC global = 5).
recordMovement(db, { product_id: P, type: 'entrada', quantity: 10, unit_cost: 5, origin_type: 'purchase', warehouse_id: A, note: 'seed' });

console.log('\n[1] Estado inicial');
ok('stock global = 10', productStock(db, P) === 10);
ok('stock A = 10', productStockInWarehouse(db, P, A) === 10);
ok('stock B = 0', productStockInWarehouse(db, P, B) === 0);
ok('WAC global = 5', approx(wac(), 5));

console.log('\n[2] Traslado parcial A→B (4 uds) — neutralidad WAC');
const t1 = createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: B, date: '2026-06-15', items: [{ product_id: P, quantity: 4 }] });
ok('stock global SIN cambio = 10', productStock(db, P) === 10);
ok('stock A = 6', productStockInWarehouse(db, P, A) === 6);
ok('stock B = 4', productStockInWarehouse(db, P, B) === 4);
ok('WAC global IDÉNTICO = 5', approx(wac(), 5));
ok('línea congeló unit_cost = 5', approx(getTransfer(db, t1.id).items[0].unit_cost, 5));

console.log('\n[3] Caso borde: vaciar el global a 0 a mitad (trasladar TODO lo que queda en A)');
// Mover otra entrada de 0... en su lugar: trasladamos las 6 restantes de A→B. El global NO
// llega a 0 (hay 4 en B). Para forzar el vaciado a 0 a mitad construimos el escenario puro:
// producto NUEVO con TODO el stock en A y lo trasladamos entero.
const Q = db.prepare("INSERT INTO products (name, slug, price, type, status) VALUES ('Gadget','gadget',20,'physical','active')").run().lastInsertRowid;
recordMovement(db, { product_id: Q, type: 'entrada', quantity: 7, unit_cost: 3, origin_type: 'purchase', warehouse_id: A, note: 'seed' });
const wacQ = () => db.prepare('SELECT average_cost FROM products WHERE id=?').get(Q).average_cost;
ok('Gadget WAC = 3 antes', approx(wacQ(), 3));
const t2 = createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: B, date: '2026-06-15', items: [{ product_id: Q, quantity: 7 }] });
ok('Gadget stock global = 7 (sin cambio)', productStock(db, Q) === 7);
ok('Gadget A = 0', productStockInWarehouse(db, Q, A) === 0);
ok('Gadget B = 7', productStockInWarehouse(db, Q, B) === 7);
ok('Gadget WAC RECOMPUESTO = 3 (no 0 pese al vaciado a mitad)', approx(wacQ(), 3));

console.log('\n[4] Guarda: disponible en ORIGEN');
expectThrow('trasladar 999 de A (solo 6) → 400', 400, () =>
  createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: B, date: '2026-06-15', items: [{ product_id: P, quantity: 999 }] }));

console.log('\n[5] Guarda: origen = destino');
expectThrow('A→A → 400', 400, () =>
  createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: A, date: '2026-06-15', items: [{ product_id: P, quantity: 1 }] }));

console.log('\n[6] Guarda: almacén destino archivado');
const Cid = Number(db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES ('Almacén C', 0, 0)").run().lastInsertRowid);
expectThrow('destino archivado → 400', 400, () =>
  createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: Cid, date: '2026-06-15', items: [{ product_id: P, quantity: 1 }] }));

console.log('\n[7] Anular un traslado (reversible) — vuelve al origen, WAC intacto');
const r2 = cancelStockTransferSvc(db, t2.id, 'error de destino');
ok('Gadget A = 7 (revertido)', productStockInWarehouse(db, Q, A) === 7);
ok('Gadget B = 0 (revertido)', productStockInWarehouse(db, Q, B) === 0);
ok('Gadget global = 7', productStock(db, Q) === 7);
ok('Gadget WAC = 3 tras anular', approx(wacQ(), 3));
ok('estado = anulada', db.prepare('SELECT status FROM stock_transfers WHERE id=?').get(t2.id).status === 'anulada');
expectThrow('re-anular → 400', 400, () => cancelStockTransferSvc(db, t2.id, 'otra vez'));
expectThrow('anular sin motivo → 400', 400, () => cancelStockTransferSvc(db, t1.id, '  '));

console.log('\n[8] Guarda al anular: el DESTINO ya no tiene el stock (se vendió/movió)');
// t1 movió 4 uds de Widget a B. Vendemos 3 desde B → B=1 < 4. Anular debe dar 409.
recordMovement(db, { product_id: P, type: 'salida', quantity: -3, origin_type: 'order', warehouse_id: B, note: 'venta desde B' });
ok('Widget B = 1 tras venta', productStockInWarehouse(db, P, B) === 1);
expectThrow('anular t1 con destino insuficiente → 409', 409, () => cancelStockTransferSvc(db, t1.id, 'intento de anular'));
ok('t1 sigue confirmada', db.prepare('SELECT status FROM stock_transfers WHERE id=?').get(t1.id).status === 'confirmada');

console.log('\n[9] Integridad aguas arriba: hasActiveTransfersFromOrigin');
ok('hay traslado activo desde A con Widget', hasActiveTransfersFromOrigin(db, A, [P]) === true);
ok('NO hay traslado activo desde A con Gadget (t2 anulado)', hasActiveTransfersFromOrigin(db, A, [Q]) === false);
ok('NO hay traslado activo desde B', hasActiveTransfersFromOrigin(db, B, [P]) === false);

console.log('\n[10] Integridad real: cancelar la compra cuyo stock se trasladó');
// Compra que metió Widget en A está implícita; probamos el guard directo en la salida inversa
// vía cancelPurchaseSvc requeriría una compra real. Ya cubierto por hasActiveTransfersFromOrigin
// (test [9]); el guard 409 en cancelPurchaseSvc/cancelReceiptSvc usa esa helper.
console.log('  (guard integrado en cancelPurchaseSvc/cancelReceiptSvc — ver test de regresión)');

console.log('\n──────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
