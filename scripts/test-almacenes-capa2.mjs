// Multi-almacén · Capa 2 — tests de lógica: cada operación opera sobre un almacén concreto;
// el WAC sigue GLOBAL. Cubre resolveWarehouseId, saldo por almacén, compra directa, recepción
// RC (parciales a almacenes distintos), devolución DEV (sale del origen), ajuste por almacén,
// apertura, y C1 (deriva del movimiento original). Cuadre caché==libro por almacén y total.
//
//   node scripts/test-almacenes-capa2.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  recordMovement, productStock, productStockInWarehouse, resolveWarehouseId,
  originMovementWarehouse, adjustStock, defaultWarehouseId,
} from '../modules/erp/stock.js';
import { createWarehouseSvc, warehouseStockMap } from '../modules/erp/routes/warehouses.js';
import { createDirectPurchaseSvc, receivePurchaseSvc, cancelPurchaseSvc } from '../modules/erp/routes/purchases.js';
import { createPurchaseOrderSvc, sendPurchaseOrderSvc } from '../modules/erp/routes/purchase-orders.js';
import { createReceiptSvc, cancelReceiptSvc } from '../modules/erp/routes/purchase-order-receipts.js';
import { createSupplierReturnSvc, cancelSupplierReturnSvc } from '../modules/erp/routes/supplier-returns.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, m) { ok(Math.abs(a - b) < 1e-9, m + ' (got ' + a + ', want ' + b + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
const addSupplier = db => db.prepare("INSERT INTO suppliers (name) VALUES ('Prov')").run().lastInsertRowid;
const addProduct = db => db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,50,'physical',0,21,'general')").run('P' + (++n), 'p' + n, 'S' + n).lastInsertRowid;
const pItemId = (db, pid) => db.prepare('SELECT id FROM purchase_items WHERE purchase_id=? ORDER BY id LIMIT 1').get(pid).id;
const itemIds = (db, oid) => db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? ORDER BY id').all(oid).map(r => r.id);
const avg = (db, p) => db.prepare('SELECT average_cost FROM products WHERE id=?').get(p).average_cost;

// ── 1. resolveWarehouseId: vacío/invalido/archivado → principal; válido activo → ese ──
console.log('1. resolveWarehouseId');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  eq(resolveWarehouseId(db, ''), principal, 'vacío → principal');
  eq(resolveWarehouseId(db, null), principal, 'null → principal');
  eq(resolveWarehouseId(db, 0), principal, '0 → principal');
  eq(resolveWarehouseId(db, 99999), principal, 'inexistente → principal');
  eq(resolveWarehouseId(db, B), B, 'almacén activo válido → ese');
  db.prepare('UPDATE warehouses SET active=0 WHERE id=?').run(B);
  eq(resolveWarehouseId(db, B), principal, 'archivado → principal');
  db.close();
}

// ── 2. Compra directa recibida en B: entra en B, no en el principal; WAC global ──
console.log('2. Compra directa en B');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const sup = addSupplier(db), p = addProduct(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  const pid = createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-14', status: 'received', warehouse_id: B, items: [{ product_id: p, quantity: 10, unit_cost: 4 }] });
  eq(db.prepare('SELECT warehouse_id FROM purchases WHERE id=?').get(pid).warehouse_id, B, 'la compra guarda warehouse_id=B');
  eq(productStockInWarehouse(db, p, B), 10, 'saldo en B = 10');
  eq(productStockInWarehouse(db, p, principal), 0, 'saldo en principal = 0');
  eq(productStock(db, p), 10, 'saldo GLOBAL = 10');
  near(avg(db, p), 4, 'WAC GLOBAL = 4 (no cambia el coste por almacén)');
  const mv = db.prepare("SELECT warehouse_id FROM stock_movements WHERE origin_type='purchase' AND origin_id=?").get(pid);
  eq(mv.warehouse_id, B, 'el movimiento de entrada va a B');
  db.close();
}

// ── 3. Compra pendiente → recibir usa el almacén guardado; cancelar revierte en B ──
console.log('3. Recibir/cancelar usan el almacén de la compra');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const sup = addSupplier(db), p = addProduct(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  const pid = createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-14', status: 'pending', warehouse_id: B, items: [{ product_id: p, quantity: 6, unit_cost: 2 }] });
  eq(productStock(db, p), 0, 'pendiente: aún no mueve stock');
  receivePurchaseSvc(db, pid);
  eq(productStockInWarehouse(db, p, B), 6, 'al recibir, entra en B (almacén guardado)');
  cancelPurchaseSvc(db, pid);
  eq(productStockInWarehouse(db, p, B), 0, 'al cancelar, la salida inversa sale de B');
  eq(productStock(db, p), 0, 'global a 0 tras cancelar');
  db.close();
}

// ── 4. Recepción RC: parciales a almacenes distintos; cancelar revierte en su almacén ──
console.log('4. RC a almacenes distintos');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const sup = addSupplier(db), p = addProduct(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  const oid = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-14', items: [{ product_id: p, quantity: 10, unit_cost: 3 }] });
  sendPurchaseOrderSvc(db, oid);
  const [li] = itemIds(db, oid);
  const r1 = createReceiptSvc(db, oid, { date: '2026-06-14', warehouse_id: B, items: [{ order_item_id: li, quantity: 4, unit_cost: 3 }] });
  const r2 = createReceiptSvc(db, oid, { date: '2026-06-15', items: [{ order_item_id: li, quantity: 6, unit_cost: 3 }] });  // sin almacén → principal
  eq(db.prepare('SELECT warehouse_id FROM purchase_order_receipts WHERE id=?').get(r1.id).warehouse_id, B, 'RC1 guarda almacén B');
  eq(productStockInWarehouse(db, p, B), 4, 'B tiene 4 (de RC1)');
  eq(productStockInWarehouse(db, p, principal), 6, 'principal tiene 6 (de RC2)');
  eq(productStock(db, p), 10, 'global = 10 (suma de ambos almacenes)');
  cancelReceiptSvc(db, r1.id, 'mercancía dañada');
  eq(productStockInWarehouse(db, p, B), 0, 'anular RC1 revierte en B');
  eq(productStockInWarehouse(db, p, principal), 6, 'principal intacto');
  db.close();
}

// ── 5. Devolución DEV sale del almacén del documento de origen; anular reingresa ahí ──
console.log('5. DEV sale del almacén de origen');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const sup = addSupplier(db), p = addProduct(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  const pid = createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-14', status: 'received', warehouse_id: B, items: [{ product_id: p, quantity: 10, unit_cost: 4 }] });
  const oi = pItemId(db, pid);
  const dev = createSupplierReturnSvc(db, { origin_type: 'purchase', origin_id: pid, date: '2026-06-15', motivo: 'defectuosa', items: [{ origin_item_id: oi, quantity: 3 }] });
  eq(productStockInWarehouse(db, p, B), 7, 'la DEV sale de B (10−3=7)');
  eq(productStockInWarehouse(db, p, principal), 0, 'el principal no se toca');
  const mv = db.prepare("SELECT warehouse_id FROM stock_movements WHERE origin_type='supplier_return' AND origin_id=? AND quantity<0").get(dev.id);
  eq(mv.warehouse_id, B, 'el movimiento de salida de la DEV va a B');
  cancelSupplierReturnSvc(db, dev.id, 'el proveedor la rechaza');
  eq(productStockInWarehouse(db, p, B), 10, 'anular la DEV reingresa en B');
  db.close();
}

// ── 6. Ajuste por almacén: "Poner a X" relativo al saldo de ESE almacén ──
console.log('6. Ajuste por almacén');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const sup = addSupplier(db), p = addProduct(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-14', status: 'received', warehouse_id: B, items: [{ product_id: p, quantity: 10, unit_cost: 4 }] });
  adjustStock(db, p, { mode: 'set', value: 3, reason: 'error_conteo', warehouse_id: B });
  eq(productStockInWarehouse(db, p, B), 3, 'poner a 3 en B (relativo al saldo de B)');
  eq(productStockInWarehouse(db, p, principal), 0, 'principal intacto');
  adjustStock(db, p, { mode: 'add', value: 5, reason: 'error_conteo', warehouse_id: principal });
  eq(productStockInWarehouse(db, p, principal), 5, 'sumar 5 en principal');
  eq(productStock(db, p), 8, 'global = 3(B) + 5(principal)');
  // ajuste sin almacén → principal
  adjustStock(db, p, { mode: 'set', value: 0, reason: 'error_conteo' });
  eq(productStockInWarehouse(db, p, principal), 0, 'ajuste sin almacén opera sobre el principal');
  db.close();
}

// ── 7. Apertura (alta de producto) en B ──
console.log('7. Apertura en B');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const p = addProduct(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  recordMovement(db, { product_id: p, type: 'apertura', quantity: 12, origin_type: 'opening', warehouse_id: B, note: 'Stock inicial' });
  eq(productStockInWarehouse(db, p, B), 12, 'apertura entra en B');
  eq(productStockInWarehouse(db, p, principal), 0, 'principal en 0');
  db.close();
}

// ── 8. C1 — la entrada de vuelta deriva el almacén del movimiento original (salida) ──
console.log('8. C1 deriva del movimiento original');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const p = addProduct(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  // simula venta POS en B (salida origin 'order')
  recordMovement(db, { product_id: p, type: 'apertura', quantity: 5, origin_type: 'opening', warehouse_id: B });
  recordMovement(db, { product_id: p, type: 'salida', quantity: -2, origin_type: 'order', origin_id: 777, warehouse_id: B });
  eq(originMovementWarehouse(db, 'order', 777, p), B, 'C1: deriva B del movimiento original de salida');
  eq(originMovementWarehouse(db, 'order', 999, p), principal, 'sin movimiento previo (histórico) → principal');
  db.close();
}

// ── 9. Cuadre: caché == libro por almacén y en total; mapa por almacén ──
console.log('9. Cuadre por almacén y total');
{
  const db = freshDb();
  const principal = defaultWarehouseId(db);
  const sup = addSupplier(db), p = addProduct(db), q = addProduct(db);
  const B = createWarehouseSvc(db, { name: 'B' }).id;
  createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-14', status: 'received', warehouse_id: B, items: [{ product_id: p, quantity: 10, unit_cost: 4 }, { product_id: q, quantity: 5, unit_cost: 2 }] });
  createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-14', status: 'received', items: [{ product_id: p, quantity: 3, unit_cost: 6 }] });  // principal
  // por almacén
  eq(productStockInWarehouse(db, p, B) + productStockInWarehouse(db, p, principal), productStock(db, p), 'p: suma por almacén == global');
  eq(productStock(db, p), 13, 'p global = 10(B)+3(principal)');
  // caché global products.stock == suma del libro
  eq(db.prepare('SELECT stock FROM products WHERE id=?').get(p).stock, productStock(db, p), 'caché products.stock == libro (global)');
  // WAC global pondera ambos: (10*4 + 3*6)/13
  near(avg(db, p), (10 * 4 + 3 * 6) / 13, 'WAC global pondera ambas entradas (independiente del almacén)');
  // mapa por almacén
  const mapB = warehouseStockMap(db, B);
  eq(mapB.find(r => r.product_id === p)?.qty, 10, 'warehouseStockMap(B): p=10');
  eq(mapB.find(r => r.product_id === q)?.qty, 5, 'warehouseStockMap(B): q=5');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Almacenes Capa 2: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
