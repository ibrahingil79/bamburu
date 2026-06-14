// Pilar 3 · Paso 1 — Motor de inventario unificado.
// El stock NO se guarda y se pisa: es la SUMA de un libro de movimientos append-only
// (stock_movements). products.stock es una CACHÉ derivada que se mantiene SIEMPRE igual a
// esa suma (para que el POS siga rápido), recalculada tras cada inserción. Un movimiento es
// inmutable: nunca se edita ni se borra; para corregir se crea otro que lo revierte (misma
// filosofía que el ciclo de vida de la factura: original intacta, asiento nuevo enlazado).

// Vocabulario CERRADO.
export const STOCK_MOVEMENT_TYPES = ['apertura', 'entrada', 'salida', 'ajuste', 'transferencia'];
export const ADJUST_REASONS = ['rotura', 'caducado', 'robo_perdida', 'error_conteo', 'autoconsumo', 'muestra_regalo', 'otro'];
export const ORIGIN_TYPES = ['opening', 'order', 'purchase', 'po_receipt', 'supplier_return', 'manual', 'reversal', 'legacy'];   // po_receipt = recepción de orden de compra (C1.b); supplier_return = devolución a proveedor (sale stock)
export const ADJUST_MODES = ['set', 'add', 'sub'];   // Poner a X / Sumar X / Restar X

export const REASON_LABEL = {
  rotura: 'Rotura', caducado: 'Caducado', robo_perdida: 'Robo/pérdida',
  error_conteo: 'Error de conteo', autoconsumo: 'Autoconsumo', muestra_regalo: 'Muestra/regalo', otro: 'Otro',
};
export const TYPE_LABEL = {
  apertura: 'Apertura', entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', transferencia: 'Transferencia',
};

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');   // 'YYYY-MM-DD HH:MM:SS' (UTC), como CURRENT_TIMESTAMP
}

// Almacén por defecto: el activo marcado is_default=1 (multi-almacén · Capa 1). FALLBACK
// robusto al primer activo por id si ninguno tuviera la marca (datos previos al backfill),
// y a cualquier almacén si no hubiera activos. Los escritores que no eligen almacén siguen
// cayendo aquí (POS, compras, recepciones, devoluciones, ajustes — la elección es Capa 2).
export function defaultWarehouseId(db) {
  const d = db.prepare('SELECT id FROM warehouses WHERE active=1 AND is_default=1 ORDER BY id LIMIT 1').get();
  if (d) return d.id;
  const w = db.prepare('SELECT id FROM warehouses WHERE active=1 ORDER BY id LIMIT 1').get()
        || db.prepare('SELECT id FROM warehouses ORDER BY id LIMIT 1').get();
  return w ? w.id : null;
}

export function isPhysical(db, product) {
  const p = typeof product === 'object' ? product : db.prepare('SELECT type FROM products WHERE id=?').get(product);
  return !!p && (p.type || 'physical') === 'physical';
}

// Stock real = SUMA(quantity) del libro para ese producto (fuente de verdad, GLOBAL).
export function productStock(db, productId) {
  return db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(productId).s;
}

// Multi-almacén · Capa 2 — saldo de un producto EN UN ALMACÉN (mismo libro, al vuelo).
// Es la vía única de la guarda "¿hay suficiente?" por almacén (no hay caché por almacén).
export function productStockInWarehouse(db, productId, warehouseId) {
  return db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=? AND warehouse_id=?')
    .get(productId, warehouseId).s;
}

// Resuelve el almacén de una operación: el pedido si es un almacén ACTIVO válido; si no
// ('' / null / inexistente / archivado), el principal. Centraliza "selector vacío → principal".
export function resolveWarehouseId(db, requested) {
  const id = Number(requested);
  if (Number.isFinite(id) && id > 0) {
    const w = db.prepare('SELECT id FROM warehouses WHERE id=? AND active=1').get(id);
    if (w) return w.id;
  }
  return defaultWarehouseId(db);
}

// Almacén del que SALIÓ un movimiento de un origen dado (para devolver la entrada al MISMO
// almacén — C1). Mira la salida (quantity<0) de ese origen+producto; histórico → principal.
export function originMovementWarehouse(db, originType, originId, productId) {
  const r = db.prepare(
    'SELECT warehouse_id FROM stock_movements WHERE origin_type=? AND origin_id=? AND product_id=? AND quantity<0 ORDER BY id LIMIT 1'
  ).get(originType, originId, productId);
  return r ? r.warehouse_id : defaultWarehouseId(db);
}

// Mantiene products.stock == SUMA(libro) Y products.average_cost (coste medio ponderado, WAC)
// como cachés derivadas. Se llama tras CADA inserción de movimiento (y en la migración).
// Relee el libro EN ORDEN (mismo orden que el kardex) y aplica WAC:
//   · movimiento + (entrada/apertura/ajuste+/...) con unit_cost: avg=(qty*avg+mov*coste)/(qty+mov)
//   · movimiento + con unit_cost NULL: cuenta como coste 0 (diluye el medio; aperturas/legacy/ajustes)
//   · movimiento − (salida): solo baja la cantidad, el medio NO cambia
//   · si la cantidad llega a <=0 (vaciado o sobreventa): el medio se reestablece a 0
// La caché de stock es la SUMA EXACTA del libro (puede ser negativa por sobreventa); el contador
// del WAC se aparta de esa suma (se pisa a 0 al vaciar) para no contaminar la siguiente entrada.
export function recomputeStock(db, productId) {
  const rows = db.prepare(
    'SELECT quantity, unit_cost FROM stock_movements WHERE product_id=? ORDER BY created_at, id'
  ).all(productId);
  let stock = 0;            // caché = SUMA exacta del libro
  let wacQty = 0, avg = 0;  // acumuladores del coste medio ponderado
  for (const r of rows) {
    stock += r.quantity;
    if (r.quantity > 0) {
      const cost = r.unit_cost == null ? 0 : r.unit_cost;
      avg = (wacQty * avg + r.quantity * cost) / (wacQty + r.quantity);
      wacQty += r.quantity;
    } else {
      wacQty += r.quantity;
      if (wacQty <= 0) { wacQty = 0; avg = 0; }   // vaciado/sobreventa: el medio vuelve a 0
    }
  }
  db.prepare('UPDATE products SET stock=?, average_cost=? WHERE id=?').run(stock, avg, productId);
  return stock;
}

// ¿Está revertido? (se deriva por consulta: otro movimiento lo referencia; no hay flag).
export function isReversed(db, movementId) {
  return !!db.prepare('SELECT 1 FROM stock_movements WHERE reverses_movement_id=? LIMIT 1').get(movementId);
}

// ÚNICO punto de escritura del libro: inserta el movimiento y recalcula la caché (stock + WAC).
// m: { product_id, type, quantity(signo), reason?, origin_type, origin_id?, reverses_movement_id?, note?, unit_cost?, warehouse_id?, created_at? }
// unit_cost OPCIONAL: coste unitario de las unidades de la entrada (compra). Por defecto NULL
// (salidas, aperturas, ajustes, reversiones) → el WAC lo cuenta como coste 0.
export function recordMovement(db, m) {
  const wid = m.warehouse_id || defaultWarehouseId(db);
  const res = db.prepare(
    `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, reason, origin_type, origin_id, reverses_movement_id, note, unit_cost, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(m.product_id, wid, m.type, m.quantity, m.reason || null, m.origin_type || null,
        m.origin_id || null, m.reverses_movement_id || null, m.note || null,
        m.unit_cost == null ? null : m.unit_cost, m.created_at || nowStr());
  recomputeStock(db, m.product_id);
  return res.lastInsertRowid;
}

// Kardex: movimientos en orden con saldo corriente tras cada uno + si está revertido + origen.
export function kardex(db, productId) {
  const rows = db.prepare('SELECT * FROM stock_movements WHERE product_id=? ORDER BY created_at, id').all(productId);
  let bal = 0;
  return rows.map(r => {
    bal += r.quantity;
    return { ...r, balance: bal, reversed: isReversed(db, r.id), is_reversal: r.reverses_movement_id != null };
  });
}

// ── SERVICIO: ajuste manual (modo poner/sumar/restar) ───────────────────────
// Crea UN movimiento type='ajuste', origin_type='manual', con el delta calculado.
// Rechaza (status 400) si el producto no es físico o el motivo no es válido.
export function adjustStock(db, productId, { mode, value, reason, note, warehouse_id }, opts = {}) {
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(productId);
  if (!product) { const e = new Error('Producto no encontrado'); e.status = 404; throw e; }
  if (!isPhysical(db, product)) { const e = new Error('Solo los productos físicos llevan stock'); e.status = 400; throw e; }
  if (!ADJUST_MODES.includes(mode)) { const e = new Error('Modo de ajuste no válido'); e.status = 400; throw e; }
  if (!ADJUST_REASONS.includes(reason)) { const e = new Error('Motivo de ajuste no válido'); e.status = 400; throw e; }
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) { const e = new Error('Cantidad no válida'); e.status = 400; throw e; }

  // Capa 2: el ajuste opera sobre UN almacén (principal por defecto). "Poner a X" es
  // relativo al saldo de ESE almacén; sumar/restar es el delta. El ajuste puede dejar
  // negativo a propósito (política actual, sin guarda de negativo).
  const wid = resolveWarehouseId(db, warehouse_id);
  const current = productStockInWarehouse(db, productId, wid);
  const delta = mode === 'set' ? (v - current) : mode === 'add' ? v : -v;
  if (delta === 0) return { stock: current, warehouse_id: wid, movement_id: null, delta: 0, message: 'Sin cambios' };

  const movement_id = recordMovement(db, {
    product_id: productId, type: 'ajuste', quantity: delta, reason,
    origin_type: 'manual', note: note || null, warehouse_id: wid, created_at: opts.created_at,
  });
  return { stock: productStockInWarehouse(db, productId, wid), warehouse_id: wid, movement_id, delta };
}

// ── SERVICIO: revertir un movimiento (corrige un error) ─────────────────────
// Crea el movimiento OPUESTO: mismo type, quantity con signo opuesto, reverses_movement_id
// al original, origin_type='reversal'. Rechaza (400) si el original ya está revertido.
export function reverseMovement(db, movementId, opts = {}) {
  const orig = db.prepare('SELECT * FROM stock_movements WHERE id=?').get(movementId);
  if (!orig) { const e = new Error('Movimiento no encontrado'); e.status = 404; throw e; }
  if (isReversed(db, movementId)) { const e = new Error('Este movimiento ya está revertido'); e.status = 400; throw e; }
  const movement_id = recordMovement(db, {
    product_id: orig.product_id, warehouse_id: orig.warehouse_id,
    type: orig.type, quantity: -orig.quantity,
    reason: orig.reason || null,                       // conserva el motivo del original (válido si era ajuste)
    origin_type: 'reversal', reverses_movement_id: orig.id,
    note: 'Reversión del movimiento #' + orig.id, created_at: opts.created_at,
  });
  return { stock: productStock(db, orig.product_id), movement_id, reverses: orig.id };
}
