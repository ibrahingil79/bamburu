// TRAZABILIDAD POR LOTE / Nº DE SERIE (Pilar 3). El "de dónde vino / a dónde fue" de cada unidad, sin
// añadir una segunda fuente de verdad: el saldo por lote se DERIVA del libro (stock_movements.lot_id),
// igual que el stock por almacén. Un lote y un nº de serie son lo mismo con distinta `kind`: una unidad
// de traza (stock_lots) con un `code` único por producto. La SERIE es un lote de capacidad 1.
//
// Red de seguridad: un producto sin traza (`tracking='none'`) NO pasa por aquí — sus movimientos siguen
// con lot_id NULL y todo funciona como hasta hoy. La traza solo entra en juego cuando el dueño marca un
// producto como 'lot' o 'serial'.
import { recordMovement } from './stock.js';

const ahora = () => new Date().toISOString();

// tracking de un producto: 'none' | 'lot' | 'serial'. Acepta el objeto o el id.
export function trackingDe(db, product) {
  const p = typeof product === 'object' ? product : db.prepare('SELECT tracking FROM products WHERE id=?').get(product);
  return (p && p.tracking) || 'none';
}
export const esTrazable = (db, product) => trackingDe(db, product) !== 'none';

// Guarda para los flujos que AÚN no capturan/consumen lote (compra directa, ajuste, traslado, devolución
// a proveedor): un producto trazado no puede moverse por ahí, o el libro quedaría con stock sin lote (el
// saldo por lotes dejaría de cuadrar con el stock). Falla cerrado con un mensaje que dice por dónde SÍ.
export function bloquearSiTrazable(db, productId, flujo) {
  if (esTrazable(db, productId)) {
    const e = new Error('Este producto lleva traza por lote/nº de serie: su stock se mueve por recepción de compra (entra) y por mostrador/albarán (sale). ' + (flujo || 'Este flujo') + ' con traza llegará más adelante.');
    e.status = 400; throw e;
  }
}

// Saldo de una unidad de traza (global o por almacén), derivado del libro. Para una serie es 0 o 1.
export function saldoLote(db, lotId, warehouseId = null) {
  const sql = 'SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE lot_id=?' + (warehouseId != null ? ' AND warehouse_id=?' : '');
  return warehouseId != null ? db.prepare(sql).get(lotId, warehouseId).s : db.prepare(sql).get(lotId).s;
}

// Lotes/series de un producto con SALDO > 0 en un almacén, ordenados FEFO: primero el que antes CADUCA
// (los sin caducidad, al final); a igualdad, el más viejo (id menor). Es el orden de consumo por defecto.
export function lotesDisponibles(db, productId, warehouseId) {
  const out = [];
  for (const l of db.prepare('SELECT id, code, kind, expiry FROM stock_lots WHERE product_id=?').all(productId)) {
    const saldo = saldoLote(db, l.id, warehouseId);
    if (saldo > 0) out.push({ ...l, saldo });
  }
  out.sort((a, b) => {
    if (a.expiry && b.expiry) return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.id - b.id;
    if (a.expiry) return -1;            // el que caduca va antes que el que no caduca
    if (b.expiry) return 1;
    return a.id - b.id;                 // sin caducidad: el más viejo primero
  });
  return out;
}

// Todos los lotes/series de un producto con su saldo (global), incluidos los agotados/caducados — para la
// ficha y el informe. Ordenado por caducidad (los sin caducidad al final), luego por antigüedad.
export function lotesDeProducto(db, productId) {
  return db.prepare('SELECT * FROM stock_lots WHERE product_id=? ORDER BY (expiry IS NULL), expiry, id').all(productId)
    .map(l => ({ ...l, saldo: saldoLote(db, l.id) }));
}

// PROPUESTA FEFO para sacar `cantidad` de un almacén: recorre los disponibles y toma hasta cubrir. Lanza
// 400 si no hay saldo trazado suficiente. Devuelve [{lot_id, code, expiry, quantity}] (mismo `quantity`
// que usan la entrada y la salida). La UI la muestra y deja editarla; el servicio revalida con `validarSalida`.
export function asignarFEFO(db, productId, warehouseId, cantidad) {
  const disp = lotesDisponibles(db, productId, warehouseId);
  const total = disp.reduce((s, l) => s + l.saldo, 0);
  if (cantidad > total) { const e = new Error('No hay saldo trazado suficiente en el almacén (' + total + ' de ' + cantidad + ').'); e.status = 400; throw e; }
  const out = [];
  let resto = cantidad;
  for (const l of disp) {
    if (resto <= 0) break;
    const toma = Math.min(l.saldo, resto);
    out.push({ lot_id: l.id, code: l.code, expiry: l.expiry, quantity: toma });
    resto -= toma;
  }
  return out;
}

// Resuelve (o crea) la unidad de traza en una ENTRADA. lot: get-or-create por (producto, code), fija la
// caducidad si el lote aún no la tenía. serial: cada code es una unidad ÚNICA; una serie que YA está en
// stock no puede volver a entrar (error); una que salió y vuelve (devolución) reutiliza su fila.
function resolverLote(db, productId, kind, code, expiry) {
  code = String(code == null ? '' : code).trim();
  if (!code) { const e = new Error('Falta el ' + (kind === 'serial' ? 'nº de serie' : 'código de lote') + '.'); e.status = 400; throw e; }
  const lot = db.prepare('SELECT * FROM stock_lots WHERE product_id=? AND code=?').get(productId, code);
  if (kind === 'serial') {
    if (lot) {
      if (saldoLote(db, lot.id) > 0) { const e = new Error('El nº de serie "' + code + '" ya está en stock: no puede entrar dos veces.'); e.status = 400; throw e; }
      return lot.id;
    }
    return Number(db.prepare("INSERT INTO stock_lots (product_id, code, kind, expiry, created_at) VALUES (?,?, 'serial', NULL, ?)").run(productId, code, ahora()).lastInsertRowid);
  }
  if (lot) {
    if (expiry && !lot.expiry) db.prepare('UPDATE stock_lots SET expiry=? WHERE id=?').run(expiry, lot.id);
    return lot.id;
  }
  return Number(db.prepare("INSERT INTO stock_lots (product_id, code, kind, expiry, created_at) VALUES (?,?, 'lot', ?, ?)").run(productId, code, expiry || null, ahora()).lastInsertRowid);
}

// Normaliza las unidades que entran. lot: [{code, expiry?, quantity}]. serial: [{code}, ...] (una por
// unidad; quantity forzado a 1). Un serial con quantity>1 no tiene sentido (una serie es una unidad).
function normalizarEntradas(kind, lotes) {
  const arr = Array.isArray(lotes) ? lotes.filter(x => x && String(x.code || '').trim()) : [];
  if (!arr.length) { const e = new Error('Indica el lote/serie de las unidades que entran.'); e.status = 400; throw e; }
  if (kind === 'serial') return arr.map(it => ({ code: it.code, quantity: 1 }));
  return arr.map(it => ({ code: it.code, expiry: it.expiry || null, quantity: Math.max(1, Math.floor(Number(it.quantity) || 0)) }));
}

// ENTRADA con traza: por cada lote/serie, resuelve la unidad y escribe un movimiento (+qty) con su lot_id.
// `cantidadEsperada` (opcional): exige que las unidades por lote/serie sumen la cantidad de la línea.
// Devuelve [{lot_id, code, quantity}].
export function entrarConTraza(db, { product_id, warehouse_id, origin_type, origin_id, unit_cost, note, created_at, type = 'entrada', lotes, cantidadEsperada = null }) {
  const kind = trackingDe(db, product_id);
  if (kind === 'none') { const e = new Error('El producto no lleva traza.'); e.status = 400; throw e; }
  const items = normalizarEntradas(kind, lotes);
  if (cantidadEsperada != null) {
    const suma = items.reduce((s, it) => s + it.quantity, 0);
    if (suma !== cantidadEsperada) { const e = new Error('Las unidades por lote/serie (' + suma + ') no cuadran con la cantidad recibida (' + cantidadEsperada + ').'); e.status = 400; throw e; }
  }
  const res = [];
  for (const it of items) {
    const lotId = resolverLote(db, product_id, kind, it.code, it.expiry);
    recordMovement(db, { product_id, warehouse_id, type, quantity: it.quantity, unit_cost, origin_type, origin_id, note, created_at, lot_id: lotId });
    res.push({ lot_id: lotId, code: String(it.code).trim(), quantity: it.quantity });
  }
  return res;
}

// Valida una asignación de salida contra el saldo real (sin escribir). Lanza 400 si algo no cuadra.
export function validarSalida(db, productId, warehouseId, cantidad, asignacion) {
  const alloc = (Array.isArray(asignacion) ? asignacion : []).filter(a => a && a.lot_id && Math.floor(Number(a.quantity)) > 0);
  if (!alloc.length) { const e = new Error('Indica de qué lote/serie sale la mercancía.'); e.status = 400; throw e; }
  if (cantidad != null) {
    const suma = alloc.reduce((s, a) => s + Math.floor(Number(a.quantity)), 0);
    if (suma !== cantidad) { const e = new Error('El reparto por lote/serie (' + suma + ') no cuadra con la cantidad de la línea (' + cantidad + ').'); e.status = 400; throw e; }
  }
  for (const a of alloc) {
    const q = Math.floor(Number(a.quantity));
    const lot = db.prepare('SELECT * FROM stock_lots WHERE id=? AND product_id=?').get(a.lot_id, productId);
    if (!lot) { const e = new Error('Lote/serie no encontrado para este producto.'); e.status = 400; throw e; }
    if (lot.kind === 'serial' && q !== 1) { const e = new Error('Un nº de serie sale de una en una.'); e.status = 400; throw e; }
    const saldo = saldoLote(db, lot.id, warehouseId);
    if (q > saldo) { const e = new Error('El lote/serie "' + lot.code + '" no tiene bastante en el almacén (' + saldo + ' de ' + q + ').'); e.status = 400; throw e; }
  }
  return alloc.map(a => ({ lot_id: a.lot_id, quantity: Math.floor(Number(a.quantity)) }));
}

// SALIDA con traza: valida y escribe un movimiento (−qty) por lote. `cantidad` (opcional) exige que la
// asignación sume la cantidad de la línea. Devuelve [{lot_id, code, quantity}].
export function salirConTraza(db, { product_id, warehouse_id, origin_type, origin_id, note, created_at, type = 'salida', asignacion, cantidad = null }) {
  const kind = trackingDe(db, product_id);
  if (kind === 'none') { const e = new Error('El producto no lleva traza.'); e.status = 400; throw e; }
  const alloc = validarSalida(db, product_id, warehouse_id, cantidad, asignacion);
  const res = [];
  for (const a of alloc) {
    const lot = db.prepare('SELECT code FROM stock_lots WHERE id=?').get(a.lot_id);
    recordMovement(db, { product_id, warehouse_id, type, quantity: -a.quantity, origin_type, origin_id, note, created_at, lot_id: a.lot_id });
    res.push({ lot_id: a.lot_id, code: lot.code, quantity: a.quantity });
  }
  return res;
}

// Revierte los movimientos TRAZADOS de un origen (anular recepción/albarán/traslado/devolución): por cada
// movimiento con lot_id de ese (origin_type, origin_id), escribe el opuesto con el MISMO lot_id, así el
// saldo por lote vuelve a su sitio. Devuelve cuántos revirtió (0 si el origen no tenía traza).
export function revertirTrazaDeOrigen(db, originType, originId, { type, note, created_at } = {}) {
  const movs = db.prepare('SELECT * FROM stock_movements WHERE origin_type=? AND origin_id=? AND lot_id IS NOT NULL AND reverses_movement_id IS NULL').all(originType, originId);
  for (const mv of movs) {
    recordMovement(db, { product_id: mv.product_id, warehouse_id: mv.warehouse_id, type: type || mv.type,
      quantity: -mv.quantity, origin_type: originType, origin_id: originId, reverses_movement_id: mv.id,
      note, created_at, lot_id: mv.lot_id });
  }
  return movs.length;
}

// Informe: la traza de un lote/serie — sus movimientos con el documento que los originó y su saldo actual.
export function trazaDeLote(db, lotId) {
  const lot = db.prepare('SELECT sl.*, p.name AS product_name FROM stock_lots sl JOIN products p ON p.id=sl.product_id WHERE sl.id=?').get(lotId);
  if (!lot) return null;
  const movimientos = db.prepare(`SELECT sm.id, sm.type, sm.quantity, sm.origin_type, sm.origin_id, sm.note, sm.created_at,
        w.name AS warehouse_name
      FROM stock_movements sm LEFT JOIN warehouses w ON w.id=sm.warehouse_id
      WHERE sm.lot_id=? ORDER BY sm.created_at, sm.id`).all(lotId);
  return { lot, movimientos, saldo: saldoLote(db, lotId) };
}
