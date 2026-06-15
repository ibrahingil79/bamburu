// Test de integración: integridad AGUAS ARRIBA. Una compra recibida mete stock en A; se
// traslada parte a B; cancelar la compra debe dar 409 (no dejar A en negativo silencioso).
// Ejecuta: node scripts/test-transfer-upstream.js
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { productStockInWarehouse } from '../modules/erp/stock.js';
import { createDirectPurchaseSvc, cancelPurchaseSvc } from '../modules/erp/routes/purchases.js';
import { createStockTransferSvc, cancelStockTransferSvc } from '../modules/erp/routes/stock-transfers.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FALLO: ' + name); } }
function expectThrow(name, status, fn) {
  try { fn(); fail++; console.log('  ✗ FALLO (no lanzó): ' + name); }
  catch (e) { if (e.status === status) { pass++; console.log('  ✓ ' + name + ' (→ ' + status + ')'); } else { fail++; console.log('  ✗ FALLO ' + name + ': esperaba ' + status + ', dio ' + e.status + ' (' + e.message + ')'); } }
}

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrations(db);

const A = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
const B = Number(db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES ('Almacén B',1,0)").run().lastInsertRowid);
const sup = Number(db.prepare("INSERT INTO suppliers (name) VALUES ('Prov')").run().lastInsertRowid);
const P = Number(db.prepare("INSERT INTO products (name,slug,price,type,status) VALUES ('Widget','widget',10,'physical','active')").run().lastInsertRowid);

console.log('\n[A] Compra directa recibida (10 uds @5) a almacén A');
const purchaseId = createDirectPurchaseSvc(db, { supplier_id: sup, date: '2026-06-15', status: 'received', warehouse_id: A, items: [{ product_id: P, quantity: 10, unit_cost: 5 }] });
ok('A = 10 tras compra', productStockInWarehouse(db, P, A) === 10);

console.log('\n[B] Trasladar 4 uds A→B');
const t = createStockTransferSvc(db, { from_warehouse_id: A, to_warehouse_id: B, date: '2026-06-15', items: [{ product_id: P, quantity: 4 }] });
ok('A = 6, B = 4', productStockInWarehouse(db, P, A) === 6 && productStockInWarehouse(db, P, B) === 4);

console.log('\n[C] Cancelar la compra con traslado activo → 409 (no negativo silencioso)');
expectThrow('cancelPurchaseSvc → 409', 409, () => cancelPurchaseSvc(db, purchaseId));
ok('compra sigue received', db.prepare('SELECT status FROM purchases WHERE id=?').get(purchaseId).status === 'received');
ok('A intacto = 6 (no se tocó)', productStockInWarehouse(db, P, A) === 6);

console.log('\n[D] Anular el traslado y luego SÍ se puede cancelar la compra');
cancelStockTransferSvc(db, t.id, 'liberar para cancelar compra');
ok('A = 10 tras anular traslado', productStockInWarehouse(db, P, A) === 10);
const r = cancelPurchaseSvc(db, purchaseId);
ok('compra cancelada (reverted)', r.reverted === true);
ok('A = 0 tras cancelar compra (sin negativo)', productStockInWarehouse(db, P, A) === 0);

console.log('\n──────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
