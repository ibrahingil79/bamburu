// Preparación y limpieza de DATOS de prueba de los gates de navegador.
//
// NACE DE DOS BUGS REALES, y su trabajo es que ninguno vuelva.
//
//   1. GATES QUE SE APOYABAN EN DATOS VIVOS. gate-recepciones-c1b y gate-devoluciones-proveedor
//      compraban y anulaban sobre el producto 1 del tenant. Cuando el multi-almacén trajo el
//      guardián de traslados, el producto 1 YA tenía traslados confirmados fuera del almacén
//      principal → anular quedó (bien) bloqueado con 409 y los dos gates murieron. El gate no era
//      falso: su DATO era prestado. Un gate que se apoya en datos que otro puede mover, se pudre.
//      → `productoDePrueba()`: cada gate se trae su propio producto, recién nacido y sin historia.
//
//   2. GATES QUE NO RECOGÍAN LA MESA. gate-almacenes creaba un "Almacén Norte (gate)" en cada
//      pasada y no lo borraba; a la siguiente enganchaba el rancio y fallaba distinto cada vez.
//      → `purgarArtefactos()`: el gate borra POR ID lo que él creó, y deja el tenant como estaba.
//
// El borrado es por ID —nunca por fecha, nunca por nombre— y solo sobre filas que creó el propio
// gate. Es la misma regla que limpiar-residuo-gates.mjs, pero ejercida por el gate sobre lo suyo,
// en vez de por un barrendero a posteriori.
import { randomBytes } from 'crypto';
import { recomputeStock } from '../../modules/erp/stock.js';

// Sufijo único por pasada. Va en el nombre de todo lo que crea un gate para que dos pasadas (o dos
// gates a la vez) no puedan pisarse ni reconocerse entre sí.
export const RID = () => randomBytes(3).toString('hex');

// Producto físico recién nacido: stock 0, coste 0, SIN traslados ni documentos. Es la única forma
// de que un gate que anula (recepciones, devoluciones) pruebe el camino feliz de forma determinista:
// sobre un producto vivo del tenant, cualquier traslado ajeno lo bloquea con razón.
// El nombre lleva "(gate)" para que limpiar-residuo-gates.mjs lo reconozca si el gate muere antes
// de limpiar.
export function productoDePrueba(db, etiqueta) {
  const rid = RID();
  const name = etiqueta + ' (gate ' + rid + ')';
  const r = db.prepare(
    `INSERT INTO products (name, slug, sku, price, stock, status, type, tax_rate, tax_band, average_cost)
     VALUES (?, ?, ?, 0, 0, 'active', 'physical', 21, 'general', 0)`
  ).run(name, 'gate-' + rid, 'GATE-' + rid.toUpperCase());
  return { id: Number(r.lastInsertRowid), name, rid };
}

// Borra POR ID los artefactos que creó el gate, hijos antes que padres, y recalcula la caché de
// stock desde el libro. Devuelve el nº de filas que tocó, para poder afirmarlo.
//
// OJO con el orden: los movimientos de stock se borran ANTES que los documentos que los originaron
// (se localizan por origin_type+origin_id), y el producto va el ÚLTIMO, cuando ya no lo referencia
// ninguna línea.
export function purgarArtefactos(db, {
  ordenes = [], recepciones = [], compras = [], devoluciones = [], productos = [], almacenes = [],
} = {}) {
  const ids = a => (a.length ? a.join(',') : '-1');
  const tocadas = { movimientos: 0, documentos: 0, productos: 0, almacenes: 0 };

  // Productos cuyo stock hay que recalcular al final: los del gate + cualquiera que tocaran sus
  // documentos (p. ej. el producto 1, si el gate le hizo una recepción para probar el bloqueo).
  const afectados = new Set(productos);
  for (const row of db.prepare(
    `SELECT DISTINCT product_id FROM stock_movements
      WHERE (origin_type='po_receipt'      AND origin_id IN (${ids(recepciones)}))
         OR (origin_type='purchase'        AND origin_id IN (${ids(compras)}))
         OR (origin_type='supplier_return' AND origin_id IN (${ids(devoluciones)}))
         OR warehouse_id IN (${ids(almacenes)})
         OR product_id IN (${ids(productos)})`).all()) afectados.add(row.product_id);

  db.transaction(() => {
    const mov = db.prepare(
      `DELETE FROM stock_movements
        WHERE (origin_type='po_receipt'      AND origin_id IN (${ids(recepciones)}))
           OR (origin_type='purchase'        AND origin_id IN (${ids(compras)}))
           OR (origin_type='supplier_return' AND origin_id IN (${ids(devoluciones)}))
           OR warehouse_id IN (${ids(almacenes)})
           OR product_id IN (${ids(productos)})`).run();
    tocadas.movimientos = mov.changes;

    let doc = 0;
    doc += db.prepare(`DELETE FROM supplier_return_items        WHERE return_id  IN (${ids(devoluciones)})`).run().changes;
    doc += db.prepare(`DELETE FROM supplier_returns             WHERE id         IN (${ids(devoluciones)})`).run().changes;
    doc += db.prepare(`DELETE FROM purchase_order_receipt_items WHERE receipt_id IN (${ids(recepciones)})`).run().changes;
    doc += db.prepare(`DELETE FROM purchase_order_receipts      WHERE id         IN (${ids(recepciones)})`).run().changes;
    doc += db.prepare(`DELETE FROM purchase_order_items         WHERE order_id   IN (${ids(ordenes)})`).run().changes;
    doc += db.prepare(`DELETE FROM purchase_orders              WHERE id         IN (${ids(ordenes)})`).run().changes;
    doc += db.prepare(`DELETE FROM purchase_items               WHERE purchase_id IN (${ids(compras)})`).run().changes;
    doc += db.prepare(`DELETE FROM purchases                    WHERE id         IN (${ids(compras)})`).run().changes;
    tocadas.documentos = doc;

    // Los adjuntos del gate: se sueltan del documento borrado (no se destruyen; el binario y su
    // lectura son historia, y la regla del proyecto es archivar, no destruir).
    db.prepare(`UPDATE attachments SET entity_type=NULL, entity_id=NULL
                 WHERE (entity_type='po_receipt' AND entity_id IN (${ids(recepciones)}))
                    OR (entity_type='purchase'   AND entity_id IN (${ids(compras)}))`).run();

    tocadas.productos = productos.length
      ? db.prepare(`DELETE FROM products WHERE id IN (${ids(productos)})`).run().changes : 0;

    // Un almacén de prueba con documentos REALES colgando NO se borra: mejor dejar una fila que
    // romper un dato bueno. Misma guarda que limpiar-residuo-gates.mjs.
    for (const w of almacenes) {
      const colgando =
        db.prepare('SELECT COUNT(*) n FROM stock_transfers WHERE from_warehouse_id=? OR to_warehouse_id=?').get(w, w).n
        + db.prepare('SELECT COUNT(*) n FROM customer_orders WHERE warehouse_id=?').get(w).n
        + db.prepare('SELECT COUNT(*) n FROM delivery_notes  WHERE warehouse_id=?').get(w).n
        + db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE warehouse_id=?').get(w).n;
      if (colgando === 0) tocadas.almacenes += db.prepare('DELETE FROM warehouses WHERE id=?').run(w).changes;
    }
  })();

  // La caché de stock se recalcula SIEMPRE desde el libro, y solo de lo afectado. Un producto que
  // ya no existe se salta.
  for (const pid of afectados) {
    if (db.prepare('SELECT 1 FROM products WHERE id=?').get(pid)) { try { recomputeStock(db, pid); } catch { /* no rompe la limpieza */ } }
  }
  return tocadas;
}

// ¿Cuadra la caché de stock con el libro, para estos productos? Es la comprobación que todo gate que
// mueve stock debe hacer al final: si el gate deja la caché descuadrada, ha roto el inventario.
export function cuadraLibro(db, productIds) {
  return productIds.every(pid => {
    const cache = db.prepare('SELECT stock FROM products WHERE id=?').get(pid)?.stock ?? 0;
    const libro = db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(pid).s;
    return Math.abs(cache - libro) < 0.0001;
  });
}
