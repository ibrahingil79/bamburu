// Gate — TRAZABILIDAD por LOTE / Nº DE SERIE (Pilar 3), núcleo (modules/erp/trazabilidad.js). Sobre BD
// :memory: con runMigrations real. Afirma lo difícil: FEFO (antes caduca, primero sale), la invariante de
// la serie (capacidad 1, no entra dos veces), los saldos DERIVADOS del libro, la validación de la salida,
// la reversión que devuelve el saldo al lote correcto, y que un producto SIN traza no se toca.
//
//   node scripts/verify-trazabilidad.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  trackingDe, esTrazable, saldoLote, lotesDisponibles, lotesDeProducto, asignarFEFO,
  entrarConTraza, salirConTraza, validarSalida, revertirTrazaDeOrigen, trazaDeLote,
} from '../modules/erp/trazabilidad.js';
import { productStockInWarehouse } from '../modules/erp/stock.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const throws = (fn, m) => { let s = false; try { fn(); } catch (e) { s = e.status === 400; } ok(s, m); };

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let seq = 0;
function almacen(db, name, def = 0) { return Number(db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES (?,1,?)").run(name, def).lastInsertRowid); }
function producto(db, name, tracking) {
  seq++;
  return Number(db.prepare("INSERT INTO products (name, slug, sku, price, status, type, stock, tracking) VALUES (?,?,?,10,'active','physical',0,?)")
    .run(name, 'tz-' + seq, 'TZ' + seq, tracking).lastInsertRowid);
}

// ── 1. Esquema ────────────────────────────────────────────────────────────────
console.log('\n[1] Esquema');
{
  const db = freshDb();
  ok(!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stock_lots'").get(), 'existe stock_lots');
  ok(db.prepare("PRAGMA table_info(products)").all().some(c => c.name === 'tracking'), 'products.tracking');
  ok(db.prepare("PRAGMA table_info(stock_movements)").all().some(c => c.name === 'lot_id'), 'stock_movements.lot_id');
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_stock_lots_product_code'").get();
  ok(!!idx && /UNIQUE/i.test(idx.sql), 'índice único (producto, code)');
  db.close();
}

// ── 2. Producto SIN traza: intacto ─────────────────────────────────────────────
console.log('\n[2] Sin traza (tracking=none): no se toca');
{
  const db = freshDb();
  const p = producto(db, 'ZZ Normal', 'none');
  ok(trackingDe(db, p) === 'none' && !esTrazable(db, p), 'tracking none, no trazable');
  throws(() => entrarConTraza(db, { product_id: p, warehouse_id: almacen(db, 'W', 1), lotes: [{ code: 'X', quantity: 1 }] }), 'entrarConTraza en un producto sin traza → 400');
  db.close();
}

// ── 3. LOTE + FEFO ──────────────────────────────────────────────────────────────
console.log('\n[3] Lote: entrada, saldos derivados y FEFO');
{
  const db = freshDb();
  const W = almacen(db, 'Principal', 1);
  const p = producto(db, 'ZZ Yogur', 'lot');
  // Entra: lote A caduca 2026-09-01 (10 uds), lote B caduca 2026-08-01 (5 uds). B caduca ANTES.
  const eA = entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'po_receipt', origin_id: 1, unit_cost: 2, lotes: [{ code: 'A', expiry: '2026-09-01', quantity: 10 }] });
  const eB = entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'po_receipt', origin_id: 2, unit_cost: 2, lotes: [{ code: 'B', expiry: '2026-08-01', quantity: 5 }] });
  const A = eA[0].lot_id, B = eB[0].lot_id;
  ok(saldoLote(db, A, W) === 10 && saldoLote(db, B, W) === 5, 'saldos por lote derivados del libro (A=10, B=5)');
  ok(productStockInWarehouse(db, p, W) === 15, 'el stock del almacén sigue cuadrando (15) — la traza no lo cambia');
  const disp = lotesDisponibles(db, p, W);
  ok(disp[0].id === B && disp[1].id === A, 'FEFO: B (caduca antes) va primero, A después');

  // Sacar 7 → FEFO: 5 de B + 2 de A.
  const alloc = asignarFEFO(db, p, W, 7);
  ok(alloc.length === 2 && alloc[0].lot_id === B && alloc[0].quantity === 5 && alloc[1].lot_id === A && alloc[1].quantity === 2,
     'asignarFEFO(7) = 5 de B + 2 de A (agota el que antes caduca)');
  salirConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'ticket', origin_id: 9, asignacion: alloc, cantidad: 7 });
  ok(saldoLote(db, B, W) === 0 && saldoLote(db, A, W) === 8, 'tras la salida: B=0, A=8');
  ok(productStockInWarehouse(db, p, W) === 8, 'el stock del almacén = 8 (cuadra con los lotes)');
  ok(asignarFEFO(db, p, W, 8).every(a => a.lot_id === A), 'ahora FEFO ya solo ofrece A (B agotado)');
  throws(() => asignarFEFO(db, p, W, 9), 'pedir más de lo que hay (9 de 8) → 400');

  // Reutilizar el MISMO código de lote suma stock (recepción del mismo lote otra vez).
  entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'po_receipt', origin_id: 3, lotes: [{ code: 'A', quantity: 4 }] });
  ok(saldoLote(db, A, W) === 12 && db.prepare("SELECT COUNT(*) n FROM stock_lots WHERE product_id=? AND code='A'").get(p).n === 1,
     'recibir el mismo lote A otra vez suma (12) y NO crea una segunda fila');
  db.close();
}

// ── 4. Nº de SERIE: capacidad 1, unicidad ──────────────────────────────────────
console.log('\n[4] Serie: capacidad 1 y unicidad');
{
  const db = freshDb();
  const W = almacen(db, 'Principal', 1);
  const p = producto(db, 'ZZ Portátil', 'serial');
  const e = entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'po_receipt', origin_id: 1, lotes: [{ code: 'SN-1' }, { code: 'SN-2' }, { code: 'SN-3' }] });
  ok(e.length === 3 && e.every(x => x.quantity === 1), '3 series entran como 3 unidades de capacidad 1');
  ok(productStockInWarehouse(db, p, W) === 3, 'stock = 3');
  ok(db.prepare("SELECT COUNT(*) n FROM stock_lots WHERE product_id=? AND kind='serial'").get(p).n === 3, '3 filas de serie');
  // Serie repetida que YA está en stock → error.
  throws(() => entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'po_receipt', origin_id: 2, lotes: [{ code: 'SN-1' }] }), 'una serie que ya está en stock no entra dos veces → 400');
  // Sacar SN-2.
  const sn2 = e[1].lot_id;
  salirConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'ticket', origin_id: 9, asignacion: [{ lot_id: sn2, quantity: 1 }], cantidad: 1 });
  ok(saldoLote(db, sn2, W) === 0 && productStockInWarehouse(db, p, W) === 2, 'sale SN-2: su saldo 0, stock 2');
  // Sacar una serie de 2 en 2 → error (una serie sale de una en una).
  throws(() => validarSalida(db, p, W, 2, [{ lot_id: e[0].lot_id, quantity: 2 }]), 'una serie no puede salir de 2 en 2 → 400');
  // SN-2 devuelta (vuelve a entrar reutilizando su fila).
  entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'supplier_return', origin_id: 5, lotes: [{ code: 'SN-2' }] });
  ok(saldoLote(db, sn2, W) === 1 && db.prepare("SELECT COUNT(*) n FROM stock_lots WHERE product_id=? AND code='SN-2'").get(p).n === 1,
     'una serie que salió y vuelve reutiliza su fila (saldo 1, no duplica)');
  db.close();
}

// ── 5. Validación de la salida ──────────────────────────────────────────────────
console.log('\n[5] Validación de la salida');
{
  const db = freshDb();
  const W = almacen(db, 'Principal', 1);
  const p = producto(db, 'ZZ Lote', 'lot');
  const [{ lot_id: L }] = entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'po_receipt', origin_id: 1, lotes: [{ code: 'L1', quantity: 5 }] });
  throws(() => validarSalida(db, p, W, 3, [{ lot_id: L, quantity: 2 }]), 'el reparto no cuadra con la cantidad (2≠3) → 400');
  throws(() => validarSalida(db, p, W, 6, [{ lot_id: L, quantity: 6 }]), 'sacar más de lo que tiene el lote (6 de 5) → 400');
  const p2 = producto(db, 'ZZ Otro', 'lot');
  const [{ lot_id: L2 }] = entrarConTraza(db, { product_id: p2, warehouse_id: W, origin_type: 'po_receipt', origin_id: 2, lotes: [{ code: 'Z', quantity: 3 }] });
  throws(() => validarSalida(db, p, W, 1, [{ lot_id: L2, quantity: 1 }]), 'un lote de OTRO producto → 400');
  db.close();
}

// ── 6. Reversión (anular): devuelve el saldo al lote correcto ───────────────────
console.log('\n[6] Reversión de una recepción trazada');
{
  const db = freshDb();
  const W = almacen(db, 'Principal', 1);
  const p = producto(db, 'ZZ Yogur', 'lot');
  const e = entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'po_receipt', origin_id: 77, unit_cost: 1, lotes: [{ code: 'A', expiry: '2026-10-01', quantity: 6 }, { code: 'B', expiry: '2026-09-01', quantity: 4 }] });
  ok(productStockInWarehouse(db, p, W) === 10, 'recepción trazada: 10 en stock');
  const n = revertirTrazaDeOrigen(db, 'po_receipt', 77, { type: 'salida', note: 'anulación' });
  ok(n === 2, 'revierte los 2 movimientos trazados de la recepción');
  ok(productStockInWarehouse(db, p, W) === 0 && saldoLote(db, e[0].lot_id, W) === 0 && saldoLote(db, e[1].lot_id, W) === 0,
     'tras anular: stock 0 y cada lote a 0 (el saldo vuelve a SU lote)');
  db.close();
}

// ── 7. Informe de traza ─────────────────────────────────────────────────────────
console.log('\n[7] Informe: de dónde vino / a dónde fue');
{
  const db = freshDb();
  const W = almacen(db, 'Principal', 1);
  const p = producto(db, 'ZZ Yogur', 'lot');
  const [{ lot_id: L }] = entrarConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'po_receipt', origin_id: 10, unit_cost: 1, lotes: [{ code: 'A', quantity: 8 }] });
  salirConTraza(db, { product_id: p, warehouse_id: W, origin_type: 'ticket', origin_id: 20, asignacion: [{ lot_id: L, quantity: 3 }], cantidad: 3 });
  const t = trazaDeLote(db, L);
  ok(t && t.saldo === 5, 'saldo del lote = 5 (8 entraron, 3 salieron)');
  ok(t.movimientos.length === 2 && t.movimientos.some(m => m.origin_type === 'po_receipt') && t.movimientos.some(m => m.origin_type === 'ticket'),
     'el informe muestra la ENTRADA (recepción) y la SALIDA (ticket) del lote');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Trazabilidad (núcleo): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
