// scripts/lib/limpiar-asientos.mjs
//
// LOS ASIENTOS NO CUELGAN DE NINGUNA CLAVE AJENA.
//
// Cuando una comprobación borra su factura de prueba con `DELETE FROM supplier_invoices`, el CASCADE
// se lleva las líneas y los pagos —eso sí está atado— pero el asiento del libro NO: `ledger_entries`
// guarda `origin_type`/`origin_id` a mano, sin FOREIGN KEY. El documento desaparece y el asiento se
// queda. El libro de compras lo sigue contando y los documentos vivos ya no, así que los dos dejan
// de cuadrar.
//
// Esto no es teoría. El barrido del 24 ago 2026 dejó 327,00 € de más en el libro de compras, DOS
// noches seguidas y con la cifra exacta repetida (una carrera nunca da dos veces lo mismo). Medido
// una por una: gate-gasto-proveedor deja 1 asiento (206,00 €), gate-pagos-proveedor deja 1 (121,00 €)
// y gate-abono-proveedor deja 2 (24,20 € y su anulación, que en dinero se netean pero ensucian
// igual). 206 + 121 = 327,00 €.
//
// Se BORRAN, no se anulan. Una anulación es lo correcto en un libro de verdad, donde el documento
// existió; aquí el documento es de mentira y se está borrando entero «como si nunca hubiera
// existido» — que es lo que ya hacen esas comprobaciones con el stock y las compras. Anular dejaría
// el libro lleno de pares inventados. Para los huérfanos que YA están en el libro de un negocio
// vivo, lo correcto sigue siendo `scripts/reversar-asientos-huerfanos.mjs`, que anula.

export function borrarAsientosDe(db, origenTipo, ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!lista.length) return 0;
  const hueco = lista.map(() => '?').join(',');
  return db.transaction(() => {
    const dentro = 'SELECT id FROM ledger_entries WHERE origin_type=? AND origin_id IN (' + hueco + ')';
    const n = db.prepare('SELECT COUNT(*) n FROM ledger_entries WHERE origin_type=? AND origin_id IN (' + hueco + ')').get(origenTipo, ...lista).n;
    db.prepare('DELETE FROM ledger_lines WHERE entry_id IN (' + dentro + ')').run(origenTipo, ...lista);
    db.prepare('DELETE FROM ledger_entries WHERE origin_type=? AND origin_id IN (' + hueco + ')').run(origenTipo, ...lista);
    return n;
  })();
}

// Cuántos asientos apuntan a un documento que ya no existe. Se mide ANTES y DESPUÉS: si la
// comprobación deja uno más del que se encontró, es que se le ha escapado algo.
export function contarHuerfanos(db) {
  return db.prepare(`SELECT COUNT(*) n FROM ledger_entries e
    WHERE e.origin_type IN ('supplier_invoice','invoice')
      AND NOT EXISTS (SELECT 1 FROM supplier_invoices si WHERE e.origin_type='supplier_invoice' AND si.id=e.origin_id)
      AND NOT EXISTS (SELECT 1 FROM invoices i          WHERE e.origin_type='invoice'          AND i.id=e.origin_id)`).get().n;
}
