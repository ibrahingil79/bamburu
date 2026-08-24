#!/usr/bin/env node
//
// limpiar-residuo-gates.mjs — borra los documentos de prueba que los gates de navegador dejaron en
// el tenant de DESARROLLO al morir a mitad (no llegaban a su propia limpieza).
//
// ⚠️ BORRA DE VERDAD. Es una EXCEPCIÓN, autorizada expresamente por el dueño (11-jul-2026) sobre el
// tenant de desarrollo, sin clientes reales. La regla permanente del proyecto sigue siendo NO destruir
// datos de un tenant: si vuelves a necesitar esto, se pregunta antes.
//
// NO borra "todo lo creado hoy" a ciegas: construye el conjunto de artefactos siguiendo el GRAFO de
// dependencias (orden → recepciones → líneas → movimientos de stock → facturas → pagos → asientos) y
// solo toca lo que cuelga de ahí. Lo que no cuelgue de un artefacto, no se toca.
//
//   node scripts/limpiar-residuo-gates.mjs            # EN SECO: dice qué borraría, no escribe
//   node scripts/limpiar-residuo-gates.mjs --hazlo    # borra de verdad (en UNA transacción)
import Database from 'better-sqlite3';
import { join } from 'path';
import { tenantDb } from './lib/gate-env.mjs';
import { recomputeStock } from '../modules/erp/stock.js';

const HAZLO = process.argv.includes('--hazlo');
const db = new Database(tenantDb('desarrollo-bamburu'));
const ids = a => a.length ? a.join(',') : '-1';
const col = (sql, ...p) => db.prepare(sql).all(...p).map(r => Object.values(r)[0]);

// ── 1. Los artefactos: lo que los gates crearon HOY, más los almacenes de prueba (que sobreviven
//       de días anteriores porque gate-almacenes nunca los limpió). ────────────────────────────────
const HOY = "date(created_at)=date('now')";
const ordenes    = col(`SELECT id FROM purchase_orders WHERE ${HOY}`);
const recepciones= col(`SELECT id FROM purchase_order_receipts WHERE ${HOY}`);
const compras    = col(`SELECT id FROM purchases WHERE ${HOY}`);
const devols     = col(`SELECT id FROM supplier_returns WHERE ${HOY}`);
const facturas   = col(`SELECT id FROM supplier_invoices WHERE ${HOY}`);
// Almacenes de prueba: los crea gate-almacenes ("(gate)") y gate-c2-captura ("c2-gate"). Nunca el dueño.
const almacenes  = col(`SELECT id FROM warehouses WHERE name LIKE '%(gate)%' OR name LIKE '%c2-gate%'`);

// Pagos que cuelgan de esas facturas (y sus asientos).
const pagos = col(`SELECT id FROM supplier_payments WHERE supplier_invoice_id IN (${ids(facturas)})`);

console.log('ARTEFACTOS A BORRAR');
console.log('  órdenes de compra .......... ' + ordenes.length);
console.log('  recepciones ................ ' + recepciones.length);
console.log('  compras directas ........... ' + compras.length);
console.log('  devoluciones a proveedor ... ' + devols.length);
console.log('  facturas de proveedor ...... ' + facturas.length);
console.log('  pagos a proveedor .......... ' + pagos.length);
console.log('  almacenes de prueba ........ ' + almacenes.length + '  ' + JSON.stringify(
  db.prepare(`SELECT name FROM warehouses WHERE id IN (${ids(almacenes)})`).all().map(r => r.name)));

// ── 2. GUARDA: un almacén de prueba con documentos REALES colgando NO se borra. Mejor dejar basura
//       que romper un dato bueno. (stock_transfers/customer_orders/delivery_notes lo referencian.) ──
const almacenesBloqueados = almacenes.filter(w => {
  const t = db.prepare('SELECT COUNT(*) n FROM stock_transfers WHERE from_warehouse_id=? OR to_warehouse_id=?').get(w, w).n;
  const o = db.prepare('SELECT COUNT(*) n FROM customer_orders WHERE warehouse_id=?').get(w).n;
  const d = db.prepare('SELECT COUNT(*) n FROM delivery_notes WHERE warehouse_id=?').get(w).n;
  return (t + o + d) > 0;
});
const almacenesOk = almacenes.filter(w => !almacenesBloqueados.includes(w));
if (almacenesBloqueados.length) {
  console.log('\n⚠️  NO se borran (tienen documentos colgando): almacenes ' + almacenesBloqueados.join(', '));
}

// ── 3. Movimientos de stock y asientos que cuelgan de los artefactos. Se listan por ORIGEN, nunca
//       "los de hoy": un movimiento cuyo origen no sea artefacto se queda. ─────────────────────────
const movs = db.prepare(
  `SELECT COUNT(*) n, COALESCE(SUM(quantity),0) q FROM stock_movements
    WHERE (origin_type='po_receipt'      AND origin_id IN (${ids(recepciones)}))
       OR (origin_type='purchase'        AND origin_id IN (${ids(compras)}))
       OR (origin_type='supplier_return' AND origin_id IN (${ids(devols)}))
       OR warehouse_id IN (${ids(almacenesOk)})`).get();
const asientos = db.prepare(
  `SELECT COUNT(*) n FROM ledger_entries
    WHERE (origin_type='supplier_invoice' AND origin_id IN (${ids(facturas)}))
       OR (origin_type='supplier_payment' AND origin_id IN (${ids(pagos)}))`).get();
console.log('  movimientos de stock ....... ' + movs.n + '  (suma ' + movs.q + ')');
console.log('  asientos contables ......... ' + asientos.n);

// ── 3b. ASIENTOS HUÉRFANOS. Los gates borran el DOCUMENTO en su limpieza pero NO su asiento, así
//        que el libro contable queda con apuntes que señalan a facturas y pagos que ya no existen.
//        Eso es basura contable, no un dato: un asiento sin documento no lo es de nada. Se comprueba
//        que el origen NO existe antes de tocarlo (nunca se borra por fecha, siempre por orfandad).
const HUERFANOS_SQL = `
  SELECT id FROM ledger_entries e
   WHERE (e.origin_type='supplier_invoice' AND NOT EXISTS (SELECT 1 FROM supplier_invoices s WHERE s.id=e.origin_id))
      OR (e.origin_type='supplier_payment' AND NOT EXISTS (SELECT 1 FROM supplier_payments p WHERE p.id=e.origin_id))
      OR (e.origin_type='invoice_payment'  AND NOT EXISTS (SELECT 1 FROM invoice_payments  p WHERE p.id=e.origin_id))`;
const huerfanosIds = col(HUERFANOS_SQL);
console.log('  asientos HUÉRFANOS (su documento ya no existe) ... ' + huerfanosIds.length);

// ── 3c. PERSONAS Y HORARIOS FANTASMA (21 ago 2026). Un gate que muere por `process.exit` —el aborto
//        de `gate-env`, un timeout, un kill— NO ejecuta su `finally`, así que su empleado de prueba y
//        su excepción de horario se quedan. Y nadie los limpiaba: NINGÚN paso de este script miraba
//        `admin_users`. El precio, medido el 21 ago en el negocio de desarrollo: de **14 personas
//        activas, 10 eran fantasmas** de gates viejos — y como la capacidad del día es «personas ×
//        horas de apertura», la agenda anunciaba **168 h libres** donde había 48. Una cifra correcta
//        sobre datos falsos es peor que una cifra rota: nadie la duda.
//        LAS PERSONAS NO SE BORRAN, SE DESACTIVAN (`active=0`), que es lo que hace el producto con
//        todo lo que tiene historia detrás (citas, facturas). Las EXCEPCIONES de horario sí se
//        borran: no son un dato con historia, son una regla de calendario, y se reconocen por su
//        motivo. El filtro es por email de laboratorio o nombre de gate — nunca por fecha.
const PERSONA_GATE = `(email LIKE '%@bamburu.test' OR email LIKE '%@t.local'
                       OR name LIKE 'Gate %' OR name LIKE 'GATE %' OR name LIKE 'Gate-%')`;
const personasFantasma = col(`SELECT id FROM admin_users WHERE active=1 AND ${PERSONA_GATE}`);
console.log('  PERSONAS fantasma de gates (se DESACTIVAN, no se borran) ... ' + personasFantasma.length);
const excFantasma = col(`SELECT id FROM horario_excepciones WHERE motivo IN ('GATE agenda sencilla','Libra')
                          OR motivo LIKE 'GATE %' OR motivo LIKE 'Gate %'`);
console.log('  EXCEPCIONES de horario dejadas por gates ....... ' + excFantasma.length);

const stockAntes = db.prepare('SELECT id, stock FROM products').all();

if (!HAZLO) {
  console.log('\n[EN SECO] No se ha escrito nada. Para borrar de verdad: --hazlo');
  db.close();
  process.exit(0);
}

// ── 4. Borrado, en UNA transacción y en orden de dependencias (hijos antes que padres). ───────────
const borrar = db.transaction(() => {
  // Personas y horarios fantasma (3c). Va lo primero porque no depende de nada de lo de abajo.
  for (const id of personasFantasma) db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(id);
  if (personasFantasma.length) db.prepare(`DELETE FROM admin_sessions WHERE user_id IN (SELECT id FROM admin_users WHERE active=0 AND ${PERSONA_GATE})`).run();
  for (const id of excFantasma) db.prepare('DELETE FROM horario_excepciones WHERE id=?').run(id);
  // Dinero con el proveedor.
  db.exec(`DELETE FROM supplier_payments      WHERE supplier_invoice_id IN (${ids(facturas)})`);
  db.exec(`DELETE FROM supplier_invoice_items WHERE supplier_invoice_id IN (${ids(facturas)})`);
  db.exec(`DELETE FROM supplier_invoices      WHERE id IN (${ids(facturas)})`);
  // Movimientos de stock (el libro).
  db.exec(`DELETE FROM stock_movements
            WHERE (origin_type='po_receipt'      AND origin_id IN (${ids(recepciones)}))
               OR (origin_type='purchase'        AND origin_id IN (${ids(compras)}))
               OR (origin_type='supplier_return' AND origin_id IN (${ids(devols)}))
               OR warehouse_id IN (${ids(almacenesOk)})`);
  // Documentos de compra (hijos → padres).
  db.exec(`DELETE FROM supplier_return_items        WHERE return_id IN (${ids(devols)})`);
  db.exec(`DELETE FROM supplier_returns             WHERE id IN (${ids(devols)})`);
  db.exec(`DELETE FROM purchase_order_receipt_items WHERE receipt_id IN (${ids(recepciones)})`);
  db.exec(`DELETE FROM purchase_order_receipts      WHERE id IN (${ids(recepciones)})`);
  db.exec(`DELETE FROM purchase_order_items         WHERE order_id IN (${ids(ordenes)})`);
  db.exec(`DELETE FROM purchase_orders              WHERE id IN (${ids(ordenes)})`);
  db.exec(`DELETE FROM purchase_items               WHERE purchase_id IN (${ids(compras)})`);
  db.exec(`DELETE FROM purchases                    WHERE id IN (${ids(compras)})`);
  // Almacenes de prueba (solo los que no tienen nada colgando).
  db.exec(`DELETE FROM warehouses WHERE id IN (${ids(almacenesOk)})`);
  // Y SI SE LLEVÓ POR DELANTE EL PRINCIPAL, SE DEVUELVE. El producto no deja archivar el almacén
  // principal (warehouses.js: 409 «marca antes otro como principal»), pero esta limpieza escribe SQL
  // directo y se salta esa regla. El 24 ago 2026 el negocio de desarrollo apareció con los tres
  // almacenes a is_default=0: ninguno principal. No se inventa uno nuevo — se le devuelve la marca al
  // más antiguo que siga activo, que es el del negocio de verdad.
  const hayPrincipal = db.prepare('SELECT COUNT(*) n FROM warehouses WHERE active=1 AND is_default=1').get().n;
  if (!hayPrincipal) {
    const w = db.prepare('SELECT id, name FROM warehouses WHERE active=1 ORDER BY id LIMIT 1').get();
    if (w) {
      db.prepare('UPDATE warehouses SET is_default=1 WHERE id=?').run(w.id);
      console.log(`  ⚠️ no quedaba almacén principal: se le devuelve la marca a «${w.name}» (id ${w.id})`);
    }
  }

  // ÚLTIMO: los asientos huérfanos. Va al final A PROPÓSITO — borrar las facturas y los pagos de
  // arriba CONVIERTE en huérfanos a sus asientos, así que la consulta se re-evalúa aquí, ya con la
  // BD en su estado final. Una sola regla: si el documento no existe, el asiento no es de nada.
  db.exec(`DELETE FROM ledger_lines   WHERE entry_id IN (${HUERFANOS_SQL})`);
  db.exec(`DELETE FROM ledger_entries WHERE id IN (${HUERFANOS_SQL})`);
});
borrar();

// ── 5. Recalcular la caché de stock desde el libro y comprobar que cuadra. ────────────────────────
const productos = col('SELECT id FROM products');
for (const p of productos) { try { recomputeStock(db, p); } catch {} }

let desc = 0, negativos = 0, cambiados = [];
for (const p of productos) {
  const cache = db.prepare('SELECT stock FROM products WHERE id=?').get(p).stock;
  const libro = db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(p).s;
  if (Math.abs(cache - libro) > 0.0001) desc++;
  if (cache < 0) negativos++;
  const antes = stockAntes.find(x => x.id === p)?.stock;
  if (antes !== cache) cambiados.push(`  producto ${p}: ${antes} → ${cache}`);
}
console.log('\n── COMPROBACIÓN ──');
console.log('  caché de stock descuadrada del libro: ' + desc + (desc ? '  ✗' : '  ✓'));
console.log('  productos con stock NEGATIVO: ' + negativos + (negativos ? '  ✗' : '  ✓'));
if (cambiados.length) { console.log('  stock que cambió al retirar el residuo:'); console.log(cambiados.join('\n')); }

// Huérfanos: nada debe apuntar a un padre que ya no existe.
const huerfanos = [
  ['recepciones sin orden', `SELECT COUNT(*) n FROM purchase_order_receipts r WHERE NOT EXISTS (SELECT 1 FROM purchase_orders o WHERE o.id=r.order_id)`],
  ['líneas sin recepción',  `SELECT COUNT(*) n FROM purchase_order_receipt_items i WHERE NOT EXISTS (SELECT 1 FROM purchase_order_receipts r WHERE r.id=i.receipt_id)`],
  ['pagos sin factura',     `SELECT COUNT(*) n FROM supplier_payments p WHERE NOT EXISTS (SELECT 1 FROM supplier_invoices f WHERE f.id=p.supplier_invoice_id)`],
  ['líneas de asiento sin asiento', `SELECT COUNT(*) n FROM ledger_lines l WHERE NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.id=l.entry_id)`],
  ['asientos sin documento', `SELECT COUNT(*) n FROM (${HUERFANOS_SQL})`],
  ['movimientos en un almacén inexistente', `SELECT COUNT(*) n FROM stock_movements m WHERE m.warehouse_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.id=m.warehouse_id)`],
];
for (const [etiqueta, sql] of huerfanos) {
  const n = db.prepare(sql).get().n;
  console.log('  ' + etiqueta + ': ' + n + (n ? '  ✗' : '  ✓'));
}
db.close();
console.log('\nHecho.');
