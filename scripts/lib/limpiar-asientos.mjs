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
//
// CUENTA LOS TRES ORÍGENES, y esto no es celo: la primera versión miraba solo facturas y facturas
// recibidas. Con ella, gate-pagos-proveedor decía «antes 68, ahora 68» tan tranquilo mientras dejaba
// asientos de PAGO colgando — porque al borrar la factura, el CASCADE se lleva sus pagos y los
// asientos de esos pagos se quedan igual de huérfanos. Un contador que no cuenta todo da un verde
// que no vale nada.
const ORIGENES = [
  ['supplier_invoice', 'supplier_invoices'],
  ['invoice',          'invoices'],
  ['supplier_payment', 'supplier_payments'],
];

export function contarHuerfanos(db) {
  let n = 0;
  for (const [tipo, tabla] of ORIGENES) {
    n += db.prepare('SELECT COUNT(*) n FROM ledger_entries e WHERE e.origin_type=?'
      + ' AND NOT EXISTS (SELECT 1 FROM ' + tabla + ' t WHERE t.id=e.origin_id)').get(tipo).n;
  }
  return n;
}

// Borra una factura de proveedor de prueba SIN dejar rastro en el libro, y en el orden correcto.
//
// El orden importa y es la parte que se me escapó la primera vez: al borrar la factura, el CASCADE
// se lleva sus pagos, y entonces ya no hay forma de saber qué ids tenían para limpiar SUS asientos.
// Hay que apuntarlos ANTES.
export function borrarFacturaProveedor(db, ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!lista.length) return { asientos: 0, pagos: 0 };
  const hueco = lista.map(() => '?').join(',');
  return db.transaction(() => {
    const pagos = db.prepare('SELECT id FROM supplier_payments WHERE supplier_invoice_id IN (' + hueco + ')')
      .all(...lista).map(r => r.id);
    const a = borrarAsientosDe(db, 'supplier_payment', pagos);
    const b = borrarAsientosDe(db, 'supplier_invoice', lista);
    db.prepare('DELETE FROM supplier_invoices WHERE id IN (' + hueco + ')').run(...lista);
    return { asientos: a + b, pagos: pagos.length };
  })();
}
