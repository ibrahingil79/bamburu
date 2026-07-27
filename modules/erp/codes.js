// Código interno autogenerado por tipo y por tenant (clientes, proveedores, productos).
// Es IDENTIFICACIÓN INTERNA (CLI-/PROV-/PROD-NNNN), no una guarda de duplicados (eso es el
// NIF/CIF / SKU). Patrón de ERP de referencia: por tipo, autogenerado, no editable, asignado
// al crear. Formato PREFIJO + 4 cifras con ceros; si se superan 9999, crece a 5+ sin romper.
// Cada tenant tiene su BD → el contador es por tenant automáticamente.

export const CODE_PREFIX = { client: 'CLI-', supplier: 'PROV-', product: 'PROD-', purchase_order: 'OC-', purchase_order_receipt: 'RC-', supplier_return: 'DEV-', stock_transfer: 'TR-', supplier_invoice: 'FRP-', supplier_credit: 'ABP-', quote: 'PRE-', order: 'PED-', delivery_note: 'DEL-', project: 'PRY-', cita: 'CITA-' };

export function formatCode(prefix, seq) {
  return prefix + String(seq).padStart(4, '0');   // 9999→'9999', 10000→'10000' (no rompe)
}

// Incremento atómico del contador del tipo. Synchronous (better-sqlite3) + transacción →
// dos altas no colisionan. Si ya estamos dentro de una transacción, no se anida.
function bump(db, entity) {
  db.prepare('INSERT OR IGNORE INTO code_counters (entity, last_seq) VALUES (?, 0)').run(entity);
  db.prepare('UPDATE code_counters SET last_seq = last_seq + 1 WHERE entity=?').run(entity);
  return db.prepare('SELECT last_seq FROM code_counters WHERE entity=?').get(entity).last_seq;
}
export function nextSeq(db, entity) {
  return db.inTransaction ? bump(db, entity) : db.transaction(bump)(db, entity);
}

// Devuelve el siguiente código del tipo (incrementando su contador). entity ∈ client|supplier|product.
export function nextCode(db, entity) {
  return formatCode(CODE_PREFIX[entity], nextSeq(db, entity));
}

// Backfill idempotente: asigna código a las filas SIN código en orden de creación (id asc),
// continuando el contador. Re-ejecutar no toca las que ya tienen código. Todo en una transacción.
export function backfillCodes(db, { table, column, entity }) {
  const rows = db.prepare(
    `SELECT id FROM ${table} WHERE ${column} IS NULL OR ${column}='' ORDER BY id ASC`
  ).all();
  if (!rows.length) return 0;
  const upd = db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`);
  db.transaction(() => {
    for (const r of rows) upd.run(nextCode(db, entity), r.id);
  })();
  return rows.length;
}
