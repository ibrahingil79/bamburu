// Voz de DISA sobre stock — lógica unitaria. Espejo de T5: se testean los HELPERS curados
// (valoración a coste) y los SERVICIOS validados que invocan las acciones de DISA (adjustStock,
// createStockTransferSvc). El loop de DISA (executeAction + confirm-first + identificación por
// nombre) se valida en el gate de modelo real y en navegador (lógica dentro del loop).
//   node scripts/test-disa-stock.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { recordMovement, productStockInWarehouse, adjustStock, ADJUST_REASONS } from '../modules/erp/stock.js';
import { inventoryValuation, productValuation, activeWarehouses } from '../modules/erp/routes/warehouses.js';
import { createStockTransferSvc } from '../modules/erp/routes/stock-transfers.js';

let pass = 0, fail = 0;
const approx = (a, b) => Math.abs(a - b) < 1e-6;
function ok(c, m) { if (c) { pass++; } else { fail++; console.error('  ✗ ' + m); } }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function setup() {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db);
  const A = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
  const B = Number(db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES ('Tienda',1,0)").run().lastInsertRowid);
  return { db, A, B };
}
const wac = (db, id) => db.prepare('SELECT average_cost FROM products WHERE id=?').get(id).average_cost;

// ── 1. Valoración curada: global y por almacén ──────────────────────────────
console.log('1. Helpers de valoración (inventoryValuation / productValuation)');
{
  const { db, A, B } = setup();
  const P = Number(db.prepare("INSERT INTO products (name,slug,price,type,status) VALUES ('Widget','w',10,'physical','active')").run().lastInsertRowid);
  const Q = Number(db.prepare("INSERT INTO products (name,slug,price,type,status) VALUES ('Gadget','g',20,'physical','active')").run().lastInsertRowid);
  recordMovement(db, { product_id: P, type: 'entrada', quantity: 10, unit_cost: 5, origin_type: 'purchase', warehouse_id: A });
  recordMovement(db, { product_id: Q, type: 'entrada', quantity: 4, unit_cost: 3, origin_type: 'purchase', warehouse_id: A });

  const v = inventoryValuation(db);
  ok(approx(v.total_value, 10 * 5 + 4 * 3), 'valor total global = Σ stock×WAC = 62');     // 50 + 12
  ok(v.total_units === 14, 'unidades totales = 14');
  const whA = v.warehouses.find(w => w.id === A);
  ok(approx(whA.value, 62) && whA.units === 14, 'almacén principal concentra 62 / 14 uds');
  const whB = v.warehouses.find(w => w.id === B);
  ok(approx(whB.value, 0) && whB.units === 0, 'Tienda vacía: 0');

  const pv = productValuation(db, P);
  ok(pv.stock === 10 && approx(pv.average_cost, 5) && approx(pv.value, 50), 'productValuation Widget: 10 uds, WAC 5, valor 50');
  ok(pv.warehouses.find(w => w.id === A).value === 50, 'desglose por almacén del producto = 50 en principal');
  db.close();
}

// ── 2. Valoración tras un traslado: total global INTACTO, se mueve entre almacenes ──
console.log('2. Traslado: valor total intacto, redistribuido por almacén');
{
  const { db, A, B } = setup();
  const P = Number(db.prepare("INSERT INTO products (name,slug,price,type,status) VALUES ('Widget','w',10,'physical','active')").run().lastInsertRowid);
  recordMovement(db, { product_id: P, type: 'entrada', quantity: 10, unit_cost: 5, origin_type: 'purchase', warehouse_id: A });
  const before = inventoryValuation(db);
  createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: B, date: '2026-06-15', items: [{ product_id: P, quantity: 4 }] });
  const after = inventoryValuation(db);
  ok(approx(before.total_value, after.total_value) && approx(after.total_value, 50), 'valor total global IDÉNTICO tras el traslado (50)');
  ok(approx(wac(db, P), 5), 'WAC global intacto = 5');
  const pv = productValuation(db, P);
  ok(pv.warehouses.find(w => w.id === A).value === 30 && pv.warehouses.find(w => w.id === B).value === 20, 'valor redistribuido: principal 30 / Tienda 20');
  db.close();
}

// ── 3. adjust_stock por el servicio validado (lo que invoca DISA): set/add/sub, por almacén ──
console.log('3. adjustStock (servicio validado): modos y motivo de lista cerrada');
{
  const { db, A, B } = setup();
  const P = Number(db.prepare("INSERT INTO products (name,slug,price,type,status) VALUES ('Widget','w',10,'physical','active')").run().lastInsertRowid);
  recordMovement(db, { product_id: P, type: 'entrada', quantity: 10, unit_cost: 5, origin_type: 'purchase', warehouse_id: A });

  adjustStock(db, P, { mode: 'set', value: 5, reason: 'error_conteo', warehouse_id: A });
  ok(productStockInWarehouse(db, P, A) === 5, 'set 5 en principal → 5');
  adjustStock(db, P, { mode: 'add', value: 3, reason: 'error_conteo', warehouse_id: A });
  ok(productStockInWarehouse(db, P, A) === 8, 'add 3 → 8');
  adjustStock(db, P, { mode: 'sub', value: 2, reason: 'rotura', warehouse_id: A });
  ok(productStockInWarehouse(db, P, A) === 6, 'sub 2 → 6');
  // por almacén: ajustar Tienda (vacía) no toca el principal
  adjustStock(db, P, { mode: 'set', value: 4, reason: 'error_conteo', warehouse_id: B });
  ok(productStockInWarehouse(db, P, B) === 4 && productStockInWarehouse(db, P, A) === 6, 'set en Tienda no afecta al principal');

  ok(ADJUST_REASONS.includes('rotura') && !ADJUST_REASONS.includes('porque_si'), 'motivos de lista cerrada');
  throws(() => adjustStock(db, P, { mode: 'set', value: 1, reason: 'porque_si' }), 400, 'motivo inventado → 400');
  throws(() => adjustStock(db, P, { mode: 'multiplicar', value: 1, reason: 'rotura' }), 400, 'modo inválido → 400');
  const S = Number(db.prepare("INSERT INTO products (name,slug,price,type,status) VALUES ('Servicio','s',10,'service','active')").run().lastInsertRowid);
  throws(() => adjustStock(db, S, { mode: 'set', value: 1, reason: 'rotura' }), 400, 'producto no físico → 400');
  db.close();
}

// ── 4. transfer_stock por el servicio validado: mueve stock + guardas traducibles ──
console.log('4. createStockTransferSvc (servicio validado): movimiento + guardas');
{
  const { db, A, B } = setup();
  const P = Number(db.prepare("INSERT INTO products (name,slug,price,type,status) VALUES ('Widget','w',10,'physical','active')").run().lastInsertRowid);
  recordMovement(db, { product_id: P, type: 'entrada', quantity: 10, unit_cost: 5, origin_type: 'purchase', warehouse_id: A });

  // multi-línea en un gesto (segundo producto)
  const Q = Number(db.prepare("INSERT INTO products (name,slug,price,type,status) VALUES ('Gadget','g',20,'physical','active')").run().lastInsertRowid);
  recordMovement(db, { product_id: Q, type: 'entrada', quantity: 6, unit_cost: 3, origin_type: 'purchase', warehouse_id: A });
  const r = createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: B, date: '2026-06-15', items: [{ product_id: P, quantity: 4 }, { product_id: Q, quantity: 2 }] });
  ok(r.lines === 2 && /^TR-/.test(r.transfer_number), 'traslado multi-línea confirma TR-NNNN con 2 líneas');
  ok(productStockInWarehouse(db, P, B) === 4 && productStockInWarehouse(db, Q, B) === 2, 'ambas líneas llegan a Tienda');

  throws(() => createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: A, date: '2026-06-15', items: [{ product_id: P, quantity: 1 }] }), 400, 'origen=destino → 400 (DISA lo traduce)');
  throws(() => createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: B, date: '2026-06-15', items: [{ product_id: P, quantity: 999 }] }), 400, 'sin disponible en origen → 400 (DISA lo traduce)');
  db.close();
}

// ── 5. Almacenes activos como lista cerrada (índice de identificación inyectado) ────
console.log('5. activeWarehouses como índice de identificación');
{
  const { db, A, B } = setup();
  const whs = activeWarehouses(db);
  ok(whs.length === 2 && whs.some(w => w.is_default) && whs.find(w => w.id === B).name === 'Tienda', 'lista de almacenes activos con principal marcado');
  db.close();
}

console.log(`\n===== RESULTADO: ${pass} OK, ${fail} fallos =====`);
process.exit(fail ? 1 : 0);
