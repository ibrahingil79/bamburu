// Pilar 3 (coste/valoración) — tests de lógica del coste medio ponderado (WAC) como caché
// derivada del libro. entrada+entrada da el medio correcto; salida no cambia el medio; entrada
// sin coste cuenta como 0; al vaciar (qty 0) el medio vuelve a 0 y la siguiente entrada lo
// reestablece; recibir compra sube el medio según WAC; cancelar revierte la cantidad. Y el
// backfill de la migración rellena unit_cost de las entradas de compra desde purchase_items.
//
//   node scripts/test-coste-wac.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { recordMovement, recomputeStock, productStock } from '../modules/erp/stock.js';
import { receivePurchaseSvc, cancelPurchaseSvc } from '../modules/erp/routes/purchases.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function close(a, b, m) { ok(Math.abs(a - b) < 1e-9, m + ' (got ' + a + ', want ' + b + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
function addProduct(db, type = 'physical') {
  return db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,10,?,0,21,'general')")
    .run('P' + (++n), 'p' + n, 'S' + n, type).lastInsertRowid;
}
const avg = (db, id) => db.prepare('SELECT average_cost FROM products WHERE id=?').get(id).average_cost;

// ── 1. entrada + entrada → media ponderada correcta ─────────────────────────
console.log('1. entrada + entrada (WAC)');
{
  const db = freshDb();
  const id = addProduct(db);
  recordMovement(db, { product_id: id, type: 'entrada', quantity: 10, unit_cost: 5, origin_type: 'purchase', origin_id: 1 });
  close(avg(db, id), 5, '10@5 → medio 5');
  recordMovement(db, { product_id: id, type: 'entrada', quantity: 10, unit_cost: 7, origin_type: 'purchase', origin_id: 2 });
  close(avg(db, id), 6, '+10@7 → (50+70)/20 = 6');
  recordMovement(db, { product_id: id, type: 'entrada', quantity: 30, unit_cost: 8, origin_type: 'purchase', origin_id: 3 });
  close(avg(db, id), 7.2, '+30@8 → (20·6 + 30·8)/50 = 360/50 = 7.2');
  eq(productStock(db, id), 50, 'stock = 50');
  db.close();
}

// ── 2. salida NO cambia el medio ────────────────────────────────────────────
console.log('2. salida no mueve el medio');
{
  const db = freshDb();
  const id = addProduct(db);
  recordMovement(db, { product_id: id, type: 'entrada', quantity: 10, unit_cost: 6, origin_type: 'purchase', origin_id: 1 });
  recordMovement(db, { product_id: id, type: 'salida', quantity: -4, origin_type: 'order', origin_id: 1 });
  close(avg(db, id), 6, 'tras vender 4, el medio sigue en 6');
  eq(productStock(db, id), 6, 'stock = 6');
  db.close();
}

// ── 3. entrada sin coste (NULL) cuenta como 0 ───────────────────────────────
console.log('3. entrada sin coste = 0');
{
  const db = freshDb();
  const id = addProduct(db);
  recordMovement(db, { product_id: id, type: 'apertura', quantity: 10, origin_type: 'opening' });   // sin unit_cost
  close(avg(db, id), 0, 'apertura sin coste → medio 0');
  recordMovement(db, { product_id: id, type: 'entrada', quantity: 10, unit_cost: 8, origin_type: 'purchase', origin_id: 1 });
  close(avg(db, id), 4, '10@0 + 10@8 → (0+80)/20 = 4 (la apertura diluye)');
  db.close();
}

// ── 4. al vaciar (qty 0) el medio vuelve a 0 y la siguiente entrada lo reestablece ──
console.log('4. vaciado → medio 0');
{
  const db = freshDb();
  const id = addProduct(db);
  recordMovement(db, { product_id: id, type: 'entrada', quantity: 10, unit_cost: 9, origin_type: 'purchase', origin_id: 1 });
  recordMovement(db, { product_id: id, type: 'salida', quantity: -10, origin_type: 'order', origin_id: 1 });   // vacía
  eq(productStock(db, id), 0, 'stock = 0');
  close(avg(db, id), 0, 'al vaciar, el medio vuelve a 0');
  recordMovement(db, { product_id: id, type: 'entrada', quantity: 5, unit_cost: 3, origin_type: 'purchase', origin_id: 2 });
  close(avg(db, id), 3, 'la siguiente entrada reestablece el medio a 3 (no arrastra el 9)');
  db.close();
}

// ── 5. recibir compra sube el medio según WAC; cancelar revierte la cantidad ──
console.log('5. recibir / cancelar compra');
{
  const db = freshDb();
  const id = addProduct(db);
  const sup = db.prepare("INSERT INTO suppliers (name) VALUES ('Prov')").run().lastInsertRowid;
  // stock previo a coste 5 (vía recepción de una primera compra)
  const p1 = db.prepare("INSERT INTO purchases (supplier_id,date,status,total,archived) VALUES (?,?, 'pending',?,0)").run(sup, '2026-06-01', 50).lastInsertRowid;
  db.prepare("INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)").run(p1, id, 10, 5);
  receivePurchaseSvc(db, p1);
  close(avg(db, id), 5, 'tras recibir 10@5 → medio 5');
  // segunda compra a coste 9
  const p2 = db.prepare("INSERT INTO purchases (supplier_id,date,status,total,archived) VALUES (?,?, 'pending',?,0)").run(sup, '2026-06-02', 90).lastInsertRowid;
  db.prepare("INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)").run(p2, id, 10, 9);
  receivePurchaseSvc(db, p2);
  close(avg(db, id), 7, 'recibir +10@9 → (50+90)/20 = 7');
  eq(productStock(db, id), 20, 'stock = 20');
  // cancelar la segunda: revierte la CANTIDAD (salida −10). El WAC no des-mezcla: una salida
  // nunca cambia el medio, así que queda en el blend 7 (regla del spec, comportamiento esperado).
  cancelPurchaseSvc(db, p2);
  eq(productStock(db, id), 10, 'cancelar revierte la cantidad → stock 10');
  close(avg(db, id), 7, 'salida de reversión no cambia el medio: queda en el blend 7');
  db.close();
}

// ── 6. backfill de la migración rellena unit_cost de las entradas de compra ──
console.log('6. backfill de coste (migración)');
{
  // Simula un tenant pre-coste: entradas de compra ya en el libro con unit_cost NULL +
  // purchase_items con el coste real. Tras runMigrations el backfill debe rellenarlas.
  const db = new Database(':memory:');
  runMigrations(db);   // crea esquema; marca la migración de coste como 'done'
  // Deshacemos la marca y vaciamos el coste para simular el estado "antiguo".
  db.prepare("DELETE FROM settings WHERE key='migration_inventory_cost_2026_v1'").run();
  const id = addProduct(db);
  const sup = db.prepare("INSERT INTO suppliers (name) VALUES ('Prov')").run().lastInsertRowid;
  const pid = db.prepare("INSERT INTO purchases (supplier_id,date,status,total,archived) VALUES (?,?, 'received',?,0)").run(sup, '2026-06-01', 0).lastInsertRowid;
  // dos líneas del mismo producto en la misma compra → media ponderada: (10*4 + 30*8)/40 = 7
  db.prepare("INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)").run(pid, id, 10, 4);
  db.prepare("INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)").run(pid, id, 30, 8);
  // entrada en el libro con coste NULL (como la dejaría el motor de compras antiguo)
  db.prepare("INSERT INTO stock_movements (product_id,warehouse_id,type,quantity,origin_type,origin_id,unit_cost,created_at) VALUES (?,?, 'entrada',40,'purchase',?,NULL,'2026-06-01 10:00:00')")
    .run(id, db.prepare('SELECT id FROM warehouses LIMIT 1').get().id, pid);
  recomputeStock(db, id);
  close(avg(db, id), 0, 'antes del backfill: entrada con coste NULL → medio 0');
  // re-ejecuta migraciones → corre el backfill
  runMigrations(db);
  const mv = db.prepare("SELECT unit_cost FROM stock_movements WHERE origin_type='purchase' AND origin_id=?").get(pid);
  close(mv.unit_cost, 7, 'backfill rellena unit_cost con la media ponderada (10*4+30*8)/40 = 7');
  close(avg(db, id), 7, 'average_cost recalculado tras el backfill = 7');
  db.close();
}

console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
process.exit(fail ? 1 : 0);
