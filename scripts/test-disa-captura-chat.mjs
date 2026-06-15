// Subir factura DENTRO del chat de DISA (Pilar 3) — tests de lógica del enganche nuevo.
// Cubre: runCapture (pipeline compartido) guarda el adjunto + PERSISTE la lectura cruda en
// attachments.extraction_json y NO escribe stock/compras; preparedCapture reconstruye el
// blob RECALCULANDO match + open_orders frescos (no usa nada derivado guardado, no re-extrae);
// reconocimiento (factura legible vs. ilegible) por la vía de parseExtraction (≥1 línea).
//
//   node scripts/test-disa-captura-chat.mjs
import Database from 'better-sqlite3';
import { rmSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createPurchaseOrderSvc, sendPurchaseOrderSvc } from '../modules/erp/routes/purchase-orders.js';
import { runCapture, preparedCapture } from '../modules/erp/routes/purchases-capture.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

const TENANT = { slug: '__test_disa_captura__' };
function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
const addSupplier = (db, name, nif = '', active = 1) => db.prepare('INSERT INTO suppliers (name,fiscal_id,active) VALUES (?,?,?)').run(name, nif, active).lastInsertRowid;
const addProduct = (db, name, sku = '', code = '') =>
  db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band,product_code,status) VALUES (?,?,?,50,'physical',0,21,'general',?,'active')")
    .run(name, 'p' + (++n), sku, code).lastInsertRowid;

// Fake de extracción: una factura con proveedor + 2 líneas (una cuadra por SKU).
const FAKE = JSON.stringify({
  supplier: { name: 'Aromas del Sur SL', fiscal_id: 'B12345678' },
  date: '09/06/2026', invoice_number: 'F-2026-0042',
  lines: [
    { description: 'Vela Vainilla 200g', quantity: 3, unit_cost: 4, vat_rate: 21 },
    { description: 'Mecha de algodón premium', quantity: 2, unit_cost: 5, vat_rate: 21 },
  ],
  totals: { base: 22, tax: 4.62, total: 26.62 },
});
const FAKE_SIN_LINEAS = JSON.stringify({ supplier: { name: 'X' }, lines: [], totals: {} });
const buf = () => Buffer.from('binario-de-prueba');

try {
  // ── 1. runCapture: guarda adjunto + extracción cruda; NO escribe stock/compras ──
  console.log('1. runCapture persiste y no mueve stock/compras');
  {
    const db = freshDb();
    process.env.C2_FAKE_EXTRACTION = FAKE;
    const r = await runCapture(db, TENANT, null, { buffer: buf(), mime: 'image/png', originalName: 'factura.png' });
    ok(r.attachment_id > 0, 'devuelve attachment_id');
    eq(r.mime, 'image/png', 'devuelve el mime');
    eq(r.extracted.lines.length, 2, 'extrae 2 líneas');
    eq(r.extracted.supplier.fiscal_id, 'B12345678', 'extrae el NIF del proveedor');
    // Persistencia: extraction_json = la lectura CRUDA (extracted), no match/open_orders.
    const att = db.prepare('SELECT extraction_json FROM attachments WHERE id=?').get(r.attachment_id);
    ok(att && att.extraction_json, 'persiste extraction_json en el adjunto');
    const saved = JSON.parse(att.extraction_json);
    eq(saved.invoice_number, 'F-2026-0042', 'lo guardado es el extracted crudo');
    ok(saved.match === undefined && saved.open_orders === undefined, 'NO guarda match/open_orders (derivados de BD)');
    // Cero escritura de stock/compras (confirm-first): solo el adjunto.
    eq(db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c, 0, 'no crea movimientos de stock');
    eq(db.prepare('SELECT COUNT(*) c FROM purchases').get().c, 0, 'no crea compras');
    eq(db.prepare('SELECT COUNT(*) c FROM attachments').get().c, 1, 'guarda exactamente 1 adjunto');
  }

  // ── 2. matchExtraction se recalcula fresco al precargar (no se guarda) ──────
  console.log('2. preparedCapture recalcula match/open_orders frescos');
  {
    const db = freshDb();
    process.env.C2_FAKE_EXTRACTION = FAKE;
    addProduct(db, 'Vela Vainilla 200g', 'VV-200', 'PROD-0001');   // cuadra la 1ª línea por nombre/SKU
    const r = await runCapture(db, TENANT, null, { buffer: buf(), mime: 'image/png', originalName: 'f.png' });
    // En el momento de extraer NO existía el proveedor → sin cuadre.
    eq(r.match.supplier, null, 'al extraer, proveedor aún no existe → sin cuadre');
    // Ahora el proveedor SE DA DE ALTA después. preparedCapture debe cuadrarlo (recalcula).
    const sid = addSupplier(db, 'Aromas del Sur SL', 'B12345678');
    const prep = preparedCapture(db, r.attachment_id);
    ok(prep, 'preparedCapture devuelve blob');
    ok(prep.match.supplier && prep.match.supplier.id === sid, 'recalcula el cuadre de proveedor (alta posterior)');
    eq(prep.match.supplier.matched_by, 'nif', 'cuadra por NIF');
    ok(prep.match.lines[0].match.matched === true, 'recalcula el cuadre de la 1ª línea por producto');
    ok(prep.match.lines[1].match.matched === false, '2ª línea sin producto → sin cuadre');
    // Mismo blob que espera la pantalla (DATA): claves presentes.
    eq(Object.keys(prep).sort(), ['attachment_id', 'extracted', 'match', 'mime', 'open_orders'], 'forma del blob = la que espera DATA');
  }

  // ── 3. open_orders recalculadas frescas (orden enviada posterior) ──────────
  console.log('3. preparedCapture recalcula open_orders frescas');
  {
    const db = freshDb();
    process.env.C2_FAKE_EXTRACTION = FAKE;
    const pid = addProduct(db, 'Vela Vainilla 200g', 'VV-200', 'PROD-0001');
    const sid = addSupplier(db, 'Aromas del Sur SL', 'B12345678');
    const r = await runCapture(db, TENANT, null, { buffer: buf(), mime: 'application/pdf', originalName: 'f.pdf' });
    ok(r.open_orders.length === 0, 'sin órdenes enviadas → open_orders vacío al extraer');
    // Se crea y envía una orden de ese proveedor DESPUÉS.
    const oid = createPurchaseOrderSvc(db, { supplier_id: sid, date: '2026-06-10', items: [{ product_id: pid, quantity: 10, unit_cost: 4 }] });
    sendPurchaseOrderSvc(db, oid);
    const prep = preparedCapture(db, r.attachment_id);
    ok(prep.open_orders.length === 1, 'preparedCapture ve la orden enviada (recalcula fresco)');
    eq(prep.open_orders[0].id, oid, 'es la orden correcta');
  }

  // ── 4. Reconocimiento: factura ilegible / sin líneas → runCapture lanza 422 ──
  console.log('4. Reconocimiento (extracción no usable → 422, adjunto sin extraction_json)');
  {
    const db = freshDb();
    process.env.C2_FAKE_EXTRACTION = 'esto no es json';
    let err = null;
    try { await runCapture(db, TENANT, null, { buffer: buf(), mime: 'image/png', originalName: 'x.png' }); } catch (e) { err = e; }
    ok(err && err.status === 422, 'documento ilegible → 422 (el chat responde "no es una factura")');
    // El adjunto SÍ se guardó (documento conservado), pero sin extraction_json.
    const att = db.prepare('SELECT extraction_json FROM attachments ORDER BY id DESC LIMIT 1').get();
    ok(att && att.extraction_json == null, 'adjunto guardado pero extraction_json NULL');
    ok(preparedCapture(db, att ? db.prepare('SELECT id FROM attachments ORDER BY id DESC LIMIT 1').get().id : 0) === null, 'preparedCapture → null si no hay lectura guardada');

    process.env.C2_FAKE_EXTRACTION = FAKE_SIN_LINEAS;
    let err2 = null;
    try { await runCapture(db, TENANT, null, { buffer: buf(), mime: 'image/png', originalName: 'y.png' }); } catch (e) { err2 = e; }
    ok(err2 && err2.status === 422, 'sin líneas → 422 (no se reconoce como factura)');
  }

  // ── 5. preparedCapture con id inexistente → null (no rompe la pantalla) ─────
  console.log('5. preparedCapture defensivo');
  {
    const db = freshDb();
    ok(preparedCapture(db, 99999) === null, 'id inexistente → null');
  }
} finally {
  rmSync('data/uploads/' + TENANT.slug, { recursive: true, force: true });
  delete process.env.C2_FAKE_EXTRACTION;
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' OK, ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
