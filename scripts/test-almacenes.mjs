// Multi-almacén · Capa 1 — tests de lógica del CRUD de almacenes y sus guardas.
//   · backfill: exactamente un default activo, el primer activo por id
//   · defaultWarehouseId explícito (is_default) con fallback
//   · crear: nombre obligatorio + único entre activos
//   · renombrar: único excluyendo el propio
//   · marcar principal: exclusividad atómica (exactamente uno activo)
//   · archivar: bloqueado si es el principal, bloqueado si contiene stock; ok si vacío
//   · restaurar: vuelve a activo, con guarda de nombre único
//   · warehouseStockMap / warehouseBreakdown
//
//   node scripts/test-almacenes.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { defaultWarehouseId, recordMovement } from '../modules/erp/stock.js';
import {
  createWarehouseSvc, renameWarehouseSvc, makeDefaultWarehouseSvc,
  archiveWarehouseSvc, restoreWarehouseSvc, warehouseNameConflict,
  warehouseHasStock, warehouseStockMap, warehouseBreakdown, activeWarehouses,
} from '../modules/erp/routes/warehouses.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
const wh = (db, id) => db.prepare('SELECT * FROM warehouses WHERE id=?').get(id);
const defaultsActivos = db => db.prepare('SELECT COUNT(*) c FROM warehouses WHERE active=1 AND is_default=1').get().c;
let n = 0;
const addProduct = db => db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,10,'physical',0,21,'general')").run('P' + (++n), 'p' + n, 'S' + n).lastInsertRowid;

// ── 1. Backfill + defaultWarehouseId explícito ──────────────────────────────
console.log('1. Backfill y default explícito');
{
  const db = freshDb();
  const ws = db.prepare('SELECT * FROM warehouses').all();
  eq(ws.length, 1, 'arranca con 1 almacén sembrado');
  eq(ws[0].is_default, 1, 'el sembrado quedó marcado is_default=1 (backfill)');
  eq(defaultsActivos(db), 1, 'exactamente UN default activo');
  eq(defaultWarehouseId(db), ws[0].id, 'defaultWarehouseId devuelve el marcado');
  // Fallback: si nadie tuviera la marca, cae al primer activo por id.
  db.prepare('UPDATE warehouses SET is_default=0').run();
  eq(defaultWarehouseId(db), ws[0].id, 'fallback al primer activo por id si ninguno marcado');
  db.close();
}

// ── 2. Crear: nombre obligatorio + único entre activos ──────────────────────
console.log('2. Crear con guarda de nombre');
{
  const db = freshDb();
  throws(() => createWarehouseSvc(db, { name: '' }), 400, 'nombre vacío → 400 (schema)');
  throws(() => createWarehouseSvc(db, { name: '   ' }), 400, 'nombre solo espacios → 400');
  const w2 = createWarehouseSvc(db, { name: 'Tienda Centro' });
  ok(w2.id, 'crea "Tienda Centro"');
  eq(wh(db, w2.id).is_default, 0, 'el nuevo NO es principal');
  eq(wh(db, w2.id).active, 1, 'el nuevo nace activo');
  throws(() => createWarehouseSvc(db, { name: 'tienda centro' }), 409, 'nombre duplicado (case-insensitive) → 409');
  throws(() => createWarehouseSvc(db, { name: '  Tienda Centro  ' }), 409, 'duplicado con espacios → 409');
  ok(!!warehouseNameConflict(db, 'TIENDA CENTRO'), 'warehouseNameConflict detecta el activo');
  db.close();
}

// ── 3. Renombrar: único excluyendo el propio ────────────────────────────────
console.log('3. Renombrar');
{
  const db = freshDb();
  const a = createWarehouseSvc(db, { name: 'Almacén A' });
  const b = createWarehouseSvc(db, { name: 'Almacén B' });
  throws(() => renameWarehouseSvc(db, b.id, { name: 'Almacén A' }), 409, 'renombrar a un nombre ya usado → 409');
  const r = renameWarehouseSvc(db, b.id, { name: 'Almacén B' });   // mismo nombre, excluye al propio
  eq(r.name, 'Almacén B', 'renombrar a su propio nombre no colisiona');
  renameWarehouseSvc(db, b.id, { name: 'Almacén B2' });
  eq(wh(db, b.id).name, 'Almacén B2', 'renombrado aplicado');
  throws(() => renameWarehouseSvc(db, 9999, { name: 'X' }), 404, 'renombrar inexistente → 404');
  db.close();
}

// ── 4. Marcar principal: exclusividad atómica ───────────────────────────────
console.log('4. Marcar principal');
{
  const db = freshDb();
  const principal = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
  const w2 = createWarehouseSvc(db, { name: 'Secundario' });
  makeDefaultWarehouseSvc(db, w2.id);
  eq(wh(db, w2.id).is_default, 1, 'el nuevo pasa a principal');
  eq(wh(db, principal).is_default, 0, 'el anterior deja de ser principal');
  eq(defaultsActivos(db), 1, 'sigue habiendo EXACTAMENTE un default activo');
  eq(defaultWarehouseId(db), w2.id, 'defaultWarehouseId refleja el nuevo principal');
  throws(() => makeDefaultWarehouseSvc(db, 9999), 404, 'marcar inexistente → 404');
  db.close();
}

// ── 5. Archivar: guardas (principal, con stock) + restaurar ─────────────────
console.log('5. Archivar y restaurar');
{
  const db = freshDb();
  const principal = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
  const w2 = createWarehouseSvc(db, { name: 'Depósito' });
  const p = addProduct(db);

  // no se puede archivar el principal
  throws(() => archiveWarehouseSvc(db, principal), 409, 'archivar el principal → 409');

  // mete stock en w2 → no se puede archivar
  recordMovement(db, { product_id: p, type: 'entrada', quantity: 5, warehouse_id: w2.id, origin_type: 'manual', note: 't' });
  ok(warehouseHasStock(db, w2.id), 'w2 contiene stock');
  throws(() => archiveWarehouseSvc(db, w2.id), 409, 'archivar almacén con stock → 409');

  // lo vacía → ahora sí
  recordMovement(db, { product_id: p, type: 'salida', quantity: -5, warehouse_id: w2.id, origin_type: 'manual', note: 't' });
  ok(!warehouseHasStock(db, w2.id), 'w2 vaciado (suma 0)');
  const ar = archiveWarehouseSvc(db, w2.id);
  eq(ar.id, w2.id, 'archivar w2 vacío y no principal → ok');
  eq(wh(db, w2.id).active, 0, 'w2 active=0 (no borrado)');
  throws(() => archiveWarehouseSvc(db, w2.id), 400, 're-archivar → 400');
  eq(defaultsActivos(db), 1, 'el principal sigue activo y único');

  // restaurar
  const re = restoreWarehouseSvc(db, w2.id);
  eq(wh(db, w2.id).active, 1, 'restaurar → active=1');
  eq(wh(db, w2.id).is_default, 0, 'restaurado NO es principal');
  throws(() => restoreWarehouseSvc(db, w2.id), 400, 're-restaurar un activo → 400');
  db.close();
}

// ── 5b. Restaurar con nombre ya tomado por un activo → 409 ──────────────────
console.log('5b. Restaurar con conflicto de nombre');
{
  const db = freshDb();
  const w2 = createWarehouseSvc(db, { name: 'Sucursal' });
  archiveWarehouseSvc(db, w2.id);
  createWarehouseSvc(db, { name: 'Sucursal' });   // otro activo toma el nombre (el archivado no reserva)
  throws(() => restoreWarehouseSvc(db, w2.id), 409, 'restaurar con nombre ya usado por un activo → 409');
  db.close();
}

// ── 6. Stock por almacén: map y breakdown (al vuelo, sin caché) ─────────────
console.log('6. Stock por almacén');
{
  const db = freshDb();
  const principal = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
  const w2 = createWarehouseSvc(db, { name: 'Norte' });
  const p = addProduct(db), q = addProduct(db);
  recordMovement(db, { product_id: p, type: 'entrada', quantity: 7, warehouse_id: principal, origin_type: 'manual' });
  recordMovement(db, { product_id: p, type: 'entrada', quantity: 3, warehouse_id: w2.id, origin_type: 'manual' });
  recordMovement(db, { product_id: q, type: 'entrada', quantity: 4, warehouse_id: w2.id, origin_type: 'manual' });

  const mapPrin = warehouseStockMap(db, principal);
  eq(mapPrin.find(r => r.product_id === p)?.qty, 7, 'mapa principal: producto p = 7');
  ok(!mapPrin.find(r => r.product_id === q), 'producto q no aparece en el principal (no tiene allí)');

  const mapW2 = warehouseStockMap(db, w2.id);
  eq(mapW2.find(r => r.product_id === p)?.qty, 3, 'mapa Norte: p = 3');
  eq(mapW2.find(r => r.product_id === q)?.qty, 4, 'mapa Norte: q = 4');

  const bd = warehouseBreakdown(db, p);
  eq(bd.length, 2, 'desglose de p: 2 almacenes activos');
  eq(bd.find(w => w.id === principal).qty, 7, 'desglose: principal 7');
  eq(bd.find(w => w.id === w2.id).qty, 3, 'desglose: Norte 3');
  // El stock global del producto = suma de almacenes (caché derivada intacta)
  eq(db.prepare('SELECT stock FROM products WHERE id=?').get(p).stock, 10, 'stock GLOBAL de p = 7+3 = 10 (caché sin tocar)');
  eq(activeWarehouses(db).length, 2, 'activeWarehouses lista los 2 activos');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Almacenes Capa 1: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
