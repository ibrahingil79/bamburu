// Pilar 3 · Paso 1 — tests de lógica del inventario unificado: stock derivado = suma del
// libro; ajuste poner/sumar/restar da el delta correcto; reversión crea el opuesto y bloquea
// revertir dos veces; producto no físico → 400; apertura/baseline hace que SUMA==stock previo.
//
//   node scripts/test-stock-pilar3.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  recordMovement, recomputeStock, productStock, kardex, isReversed,
  adjustStock, reverseMovement, defaultWarehouseId,
} from '../modules/erp/stock.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let sku = 0;
function addProduct(db, { type = 'physical', stock = 0 } = {}) {
  const r = db.prepare("INSERT INTO products (name, slug, sku, price, type, stock, tax_rate, tax_band) VALUES (?,?,?,?,?,?,?,?)")
    .run('P' + (++sku), 'p' + sku, 'SKU' + sku, 10, type, 0, 21, 'general');
  return r.lastInsertRowid;
}

// ── 1. Migración base: tablas y almacén por defecto ─────────────────────────
console.log('1. Migración base');
{
  const db = freshDb();
  ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='warehouses'").get(), 'tabla warehouses creada');
  ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_movements'").get(), 'tabla stock_movements creada');
  ok(defaultWarehouseId(db) > 0, 'almacén por defecto sembrado');
  eq(db.prepare("SELECT name FROM warehouses WHERE id=?").get(defaultWarehouseId(db)).name, 'Almacén principal', 'se llama Almacén principal');
  db.close();
}

// ── 2. Stock derivado = SUMA del libro; caché siempre igual ─────────────────
console.log('2. Stock derivado');
{
  const db = freshDb();
  const id = addProduct(db);
  eq(productStock(db, id), 0, 'sin movimientos → 0');
  recordMovement(db, { product_id: id, type: 'apertura', quantity: 10, origin_type: 'opening' });
  recordMovement(db, { product_id: id, type: 'entrada', quantity: 5, origin_type: 'purchase', origin_id: 1 });
  recordMovement(db, { product_id: id, type: 'salida', quantity: -3, origin_type: 'order', origin_id: 1 });
  eq(productStock(db, id), 12, 'suma con signo = 10+5−3 = 12');
  eq(db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock, 12, 'caché products.stock == suma del libro');
  db.close();
}

// ── 3. Ajuste: poner / sumar / restar dan el delta correcto ─────────────────
console.log('3. Ajuste manual (modos)');
{
  const db = freshDb();
  const id = addProduct(db);
  recordMovement(db, { product_id: id, type: 'apertura', quantity: 20, origin_type: 'opening' });

  let r = adjustStock(db, id, { mode: 'set', value: 12, reason: 'error_conteo' });   // delta = 12 − 20 = −8
  eq(r.delta, -8, 'poner a 12 desde 20 → delta −8');
  eq(r.stock, 12, 'stock queda en 12');

  r = adjustStock(db, id, { mode: 'add', value: 5, reason: 'otro' });                // +5 → 17
  eq(r.delta, 5, 'sumar 5 → delta +5');
  eq(productStock(db, id), 17, 'stock 17');

  r = adjustStock(db, id, { mode: 'sub', value: 4, reason: 'rotura' });              // −4 → 13
  eq(r.delta, -4, 'restar 4 → delta −4');
  eq(productStock(db, id), 13, 'stock 13');

  r = adjustStock(db, id, { mode: 'set', value: 13, reason: 'otro' });               // delta 0 → sin movimiento
  eq(r.delta, 0, 'poner al mismo valor → delta 0');
  eq(r.movement_id, null, 'delta 0 no crea movimiento');

  // El ajuste guarda type='ajuste', origin='manual', reason.
  const last = db.prepare("SELECT * FROM stock_movements WHERE product_id=? AND type='ajuste' ORDER BY id DESC LIMIT 1").get(id);
  eq([last.origin_type, last.reason], ['manual', 'rotura'], 'ajuste lleva origin manual + motivo');
  db.close();
}

// ── 4. Reversión: crea el opuesto y bloquea revertir dos veces ──────────────
console.log('4. Reversión');
{
  const db = freshDb();
  const id = addProduct(db);
  recordMovement(db, { product_id: id, type: 'apertura', quantity: 10, origin_type: 'opening' });
  const adj = adjustStock(db, id, { mode: 'sub', value: 6, reason: 'rotura' });       // −6 → 4
  eq(productStock(db, id), 4, 'tras ajuste −6 → 4');

  const rev = reverseMovement(db, adj.movement_id);                                   // +6 → 10
  eq(rev.stock, 10, 'reversión devuelve el stock (vuelve a 10)');
  const revRow = db.prepare('SELECT * FROM stock_movements WHERE id=?').get(rev.movement_id);
  eq([revRow.quantity, revRow.type, revRow.origin_type, revRow.reverses_movement_id], [6, 'ajuste', 'reversal', adj.movement_id], 'reversión = opuesto, mismo type, origin reversal, enlaza al original');
  ok(isReversed(db, adj.movement_id), 'el original queda marcado como revertido (derivado)');

  throws(() => reverseMovement(db, adj.movement_id), 400, 'revertir dos veces → 400');
  db.close();
}

// ── 5. Producto NO físico → 400 ─────────────────────────────────────────────
console.log('5. No físico rechazado');
{
  const db = freshDb();
  const svc = addProduct(db, { type: 'service' });
  const dig = addProduct(db, { type: 'digital' });
  throws(() => adjustStock(db, svc, { mode: 'set', value: 5, reason: 'otro' }), 400, 'ajustar servicio → 400');
  throws(() => adjustStock(db, dig, { mode: 'add', value: 5, reason: 'otro' }), 400, 'ajustar digital → 400');
  db.close();
}

// ── 6. Motivo inválido → 400; kardex con saldo corriente ────────────────────
console.log('6. Guardas + kardex');
{
  const db = freshDb();
  const id = addProduct(db);
  recordMovement(db, { product_id: id, type: 'apertura', quantity: 8, origin_type: 'opening' });
  throws(() => adjustStock(db, id, { mode: 'add', value: 2, reason: 'inventado' }), 400, 'motivo fuera de la lista → 400');
  adjustStock(db, id, { mode: 'add', value: 2, reason: 'otro' });   // → 10
  adjustStock(db, id, { mode: 'sub', value: 3, reason: 'rotura' }); // → 7
  const k = kardex(db, id);
  eq(k.map(m => m.balance), [8, 10, 7], 'saldo corriente correcto tras cada movimiento');
  db.close();
}

// ── 7. Migración real simulada: import legacy con signo + baseline == stock ──
// Reproduce el escenario de la BD real: productos físicos con stock heredado + filas
// inventory_movements (in/out). Tras migrar, SUMA(libro) == products.stock por producto.
console.log('7. Migración de lo viejo (baseline)');
{
  const db = new Database(':memory:');
  // Esquema mínimo previo a la unificación: products + inventory_movements vieja con datos.
  runMigrationsWithoutStockUnify(db);
  // Productos físicos con stock heredado.
  const p1 = db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES ('A','a','A',10,'physical',45,21,'general')").run().lastInsertRowid;
  const p2 = db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES ('B','b','B',10,'physical',4,21,'general')").run().lastInsertRowid;
  // inventory_movements heredados (como en real): p2 con compra +10 (stock actual 4).
  db.prepare("INSERT INTO inventory_movements (product_id,type,quantity,reason,created_at) VALUES (?,?,?,?,?)").run(p2, 'in', 10, 'Compra PO', '2026-04-20 10:00:00');
  // Ahora corre la unificación.
  runMigrations(db);

  // Cuadre producto a producto.
  eq(productStock(db, p1), 45, 'p1: SUMA(libro) == stock heredado (45)');
  eq(productStock(db, p2), 4, 'p2: SUMA(libro) == stock heredado (4)');
  eq(db.prepare('SELECT stock FROM products WHERE id=?').get(p1).stock, 45, 'p1 caché == 45');
  eq(db.prepare('SELECT stock FROM products WHERE id=?').get(p2).stock, 4, 'p2 caché == 4');
  // La legacy se archivó (no se borró) y conserva su fila.
  ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_movements_legacy'").get(), 'inventory_movements renombrada a _legacy');
  eq(db.prepare('SELECT COUNT(*) n FROM inventory_movements_legacy').get().n, 1, 'la fila legacy se conserva');
  ok(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_movements'").get(), 'inventory_movements ya no existe como tabla viva');
  // p2: el libro tiene la entrada legacy (+10) y la apertura baseline (4−10=−6).
  const ks = kardex(db, p2);
  eq(ks[0].type, 'apertura', 'la apertura va primero (created_at sentinela)');
  eq(ks.reduce((s, m) => s + m.quantity, 0), 4, 'suma del libro de p2 = 4');
  db.close();
}

// Crea el esquema PERO sin la unificación, para tener la inventory_movements vieja con datos.
function runMigrationsWithoutStockUnify(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT, sku TEXT DEFAULT '',
    price REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, status TEXT DEFAULT 'active',
    type TEXT DEFAULT 'physical', tax_rate REAL NOT NULL DEFAULT 21, tax_band TEXT NOT NULL DEFAULT 'general')`);
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, variant_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('in','out','adjust')), quantity INTEGER NOT NULL,
    reason TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Pilar 3 Paso 1: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
