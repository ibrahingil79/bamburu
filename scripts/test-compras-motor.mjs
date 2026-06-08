// Motor de Compras — tests de lógica: recibir una compra pendiente sube el stock en el
// libro; cancelar una recibida lo revierte (movimiento inverso); cancelar una pendiente no
// mueve stock; el saldo cuadra producto a producto; guardas de estado; y la migración que
// archiva las compras rotas heredadas (sin líneas) sin borrarlas.
//
//   node scripts/test-compras-motor.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { receivePurchaseSvc, cancelPurchaseSvc } from '../modules/erp/routes/purchases.js';
import { productStock } from '../modules/erp/stock.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
function addSupplier(db) { return db.prepare("INSERT INTO suppliers (name) VALUES ('Prov')").run().lastInsertRowid; }
function addProduct(db) { return db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,10,'physical',0,21,'general')").run('P' + (++n), 'p' + n, 'S' + n).lastInsertRowid; }
function addPurchase(db, supplierId, items, status = 'pending') {
  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
  const pid = db.prepare("INSERT INTO purchases (supplier_id,date,status,total,archived) VALUES (?,?,?,?,0)").run(supplierId, '2026-06-01', status, total).lastInsertRowid;
  const ins = db.prepare("INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)");
  for (const it of items) ins.run(pid, it.product_id, it.quantity, it.unit_cost);
  return pid;
}
const status = (db, id) => db.prepare('SELECT status FROM purchases WHERE id=?').get(id).status;
const cache = (db, id) => db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock;

// ── 1. Recibir una pendiente sube el stock ──────────────────────────────────
console.log('1. Recibir');
{
  const db = freshDb();
  const sup = addSupplier(db), prod = addProduct(db);
  const pid = addPurchase(db, sup, [{ product_id: prod, quantity: 10, unit_cost: 5 }], 'pending');
  eq(productStock(db, prod), 0, 'pendiente: el stock NO se ha movido');
  const r = receivePurchaseSvc(db, pid);
  eq(r.lines, 1, 'recibe 1 línea');
  eq(productStock(db, prod), 10, 'recibida: stock sube a 10 (libro)');
  eq(cache(db, prod), 10, 'caché products.stock == suma del libro');
  eq(status(db, pid), 'received', 'la compra queda recibida');
  const mv = db.prepare("SELECT * FROM stock_movements WHERE origin_type='purchase' AND origin_id=?").all(pid);
  eq(mv.length, 1, 'un movimiento de entrada con origen compra');
  eq([mv[0].type, mv[0].quantity], ['entrada', 10], 'entrada +10 origen compra');
  db.close();
}

// ── 2. Cancelar una recibida revierte el stock ──────────────────────────────
console.log('2. Cancelar recibida (revierte)');
{
  const db = freshDb();
  const sup = addSupplier(db), prod = addProduct(db);
  const pid = addPurchase(db, sup, [{ product_id: prod, quantity: 10, unit_cost: 5 }], 'pending');
  receivePurchaseSvc(db, pid);
  eq(productStock(db, prod), 10, 'tras recibir: 10');
  const r = cancelPurchaseSvc(db, pid);
  eq(r.reverted, true, 'cancelar una recibida revierte');
  eq(productStock(db, prod), 0, 'stock vuelve a 0 (movimiento inverso)');
  eq(cache(db, prod), 0, 'caché cuadra a 0');
  eq(status(db, pid), 'cancelled', 'la compra queda cancelada (no se borra)');
  ok(db.prepare('SELECT 1 FROM purchases WHERE id=?').get(pid), 'la compra sigue existiendo');
  const sal = db.prepare("SELECT * FROM stock_movements WHERE origin_type='purchase' AND origin_id=? AND type='salida'").get(pid);
  eq(sal.quantity, -10, 'movimiento inverso salida −10 origen compra');
  db.close();
}

// ── 3. Cancelar una pendiente NO mueve stock ────────────────────────────────
console.log('3. Cancelar pendiente (sin stock)');
{
  const db = freshDb();
  const sup = addSupplier(db), prod = addProduct(db);
  const pid = addPurchase(db, sup, [{ product_id: prod, quantity: 7, unit_cost: 2 }], 'pending');
  const r = cancelPurchaseSvc(db, pid);
  eq(r.reverted, false, 'cancelar pendiente no revierte stock');
  eq(productStock(db, prod), 0, 'stock intacto (no se había movido)');
  eq(status(db, pid), 'cancelled', 'queda cancelada');
  eq(db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE origin_id=?").get(pid).c, 0, 'cero movimientos para esa compra');
  db.close();
}

// ── 4. Guardas de estado ────────────────────────────────────────────────────
console.log('4. Guardas');
{
  const db = freshDb();
  const sup = addSupplier(db), prod = addProduct(db);
  const pid = addPurchase(db, sup, [{ product_id: prod, quantity: 5, unit_cost: 1 }], 'pending');
  receivePurchaseSvc(db, pid);
  throws(() => receivePurchaseSvc(db, pid), 400, 'recibir una ya recibida → 400');
  cancelPurchaseSvc(db, pid);
  throws(() => receivePurchaseSvc(db, pid), 400, 'recibir una cancelada → 400');
  throws(() => cancelPurchaseSvc(db, pid), 400, 'cancelar una ya cancelada → 400');
  throws(() => receivePurchaseSvc(db, 9999), 404, 'recibir inexistente → 404');
  db.close();
}

// ── 5. Cuadre producto a producto (varias líneas) ───────────────────────────
console.log('5. Cuadre multi-producto');
{
  const db = freshDb();
  const sup = addSupplier(db), a = addProduct(db), b = addProduct(db);
  const pid = addPurchase(db, sup, [{ product_id: a, quantity: 3, unit_cost: 4 }, { product_id: b, quantity: 8, unit_cost: 2 }], 'pending');
  receivePurchaseSvc(db, pid);
  eq([productStock(db, a), productStock(db, b)], [3, 8], 'cada producto sube por su línea');
  ok(productStock(db, a) === cache(db, a) && productStock(db, b) === cache(db, b), 'caché == libro en ambos');
  cancelPurchaseSvc(db, pid);
  eq([productStock(db, a), productStock(db, b)], [0, 0], 'cancelar revierte ambos a 0');
  db.close();
}

// ── 6. Migración: archiva las compras rotas (sin líneas) sin borrarlas ──────
console.log('6. Migración archiva rotas');
{
  // Pre-estado SIN la columna archived ni la clave de migración, con compras rotas.
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER, date DATE, notes TEXT, status TEXT, total REAL, created_at DATETIME)`);
  db.exec(`CREATE TABLE purchase_items (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, product_id INTEGER, quantity INTEGER, unit_cost REAL)`);
  const roto1 = db.prepare("INSERT INTO purchases (supplier_id,date,status,total) VALUES (1,'2026-01-01','received',320)").run().lastInsertRowid;
  const bueno = db.prepare("INSERT INTO purchases (supplier_id,date,status,total) VALUES (1,'2026-01-02','received',50)").run().lastInsertRowid;
  const roto2 = db.prepare("INSERT INTO purchases (supplier_id,date,status,total) VALUES (1,'2026-01-03','pending',450)").run().lastInsertRowid;
  db.prepare("INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,1,5,10)").run(bueno);

  runMigrations(db);   // crea el resto + addCol archived + archiva las rotas (una vez)

  eq(db.prepare('SELECT archived FROM purchases WHERE id=?').get(roto1).archived, 1, 'compra rota 1 (sin líneas) → archivada');
  eq(db.prepare('SELECT archived FROM purchases WHERE id=?').get(roto2).archived, 1, 'compra rota 2 (sin líneas) → archivada');
  eq(db.prepare('SELECT archived FROM purchases WHERE id=?').get(bueno).archived, 0, 'compra con líneas → NO archivada');
  eq(db.prepare('SELECT COUNT(*) c FROM purchases').get().c, 3, 'nada se borró (siguen las 3)');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Motor de Compras: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
