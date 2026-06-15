// Voz de DISA — DICTAR COMPRA (Pilar 3) · tests de lógica del enganche nuevo.
// La voz solo cambia la PUERTA de entrada: reproduce el MISMO payload normalizado que el
// extractor de visión y aterriza por los caminos YA construidos. Cubre:
//  1) captureFromExtraction: crea un adjunto SIN fichero (path='' / mime=''), NORMALIZA por el
//     mismo parseExtraction, persiste extraction_json y NO escribe stock/compras.
//  2) preparedCapture sobre ese adjunto de voz: reconstruye el blob (mime vacío → pantalla
//     degradada) y RECALCULA match (proveedor por NIF, línea por descripción) fresco.
//  3) Ciclo completo voz → confirm (compra directa): createDirectPurchaseSvc mueve stock + WAC
//     por el libro, creando proveedor y producto nuevos con banda de IVA explícita.
//  4) Guardarraíl de la banda: createProductSvc exige banda válida (el arreglo de create_product).
//
//   node scripts/test-disa-dictar-compra.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  captureFromExtraction, preparedCapture, confirmCaptureSvc,
} from '../modules/erp/routes/purchases-capture.js';
import { createProductSvc } from '../modules/erp/routes/products.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  // company_config ya sembrado por las migraciones; aseguramos país/tipo (ES/21).
  db.prepare("UPDATE company_config SET country='ES', tax_rate=21 WHERE id=1").run();
  return db;
}
let n = 0;
const addSupplier = (db, name, nif = '', active = 1) => db.prepare('INSERT INTO suppliers (name,fiscal_id,active) VALUES (?,?,?)').run(name, nif, active).lastInsertRowid;
const addProduct = (db, name, sku = '', code = '') =>
  db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band,product_code,status) VALUES (?,?,?,50,'physical',0,21,'general',?,'active')")
    .run(name, 'p' + (++n), sku, code).lastInsertRowid;
const stockOf = (db, id) => db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock;
const wacOf = (db, id) => db.prepare('SELECT average_cost FROM products WHERE id=?').get(id).average_cost;

// Lo que DISA arma a partir de lo dictado (mismo shape que extractInvoice).
const dictado = () => ({
  supplier: { name: 'Aroma & Luz, S.L.', fiscal_id: 'B98765432' },
  date: '2026-06-15', invoice_number: '',
  lines: [
    { description: 'Vela Vainilla 200g', quantity: 3, unit_cost: 4, vat_rate: 21 },
    { description: 'Difusor de bambú', quantity: 2, unit_cost: 7.5, vat_rate: 10 },
  ],
  totals: { base: null, tax: null, total: null },
});

try {
  // ── 1. captureFromExtraction: adjunto fileless, normaliza, no mueve nada ──
  console.log('1. captureFromExtraction (voz): adjunto sin fichero + normalización + cero escritura');
  {
    const db = freshDb();
    const r = captureFromExtraction(db, null, dictado());
    ok(r.attachment_id > 0, 'devuelve attachment_id');
    eq(r.extracted.lines.length, 2, 'normaliza 2 líneas');
    const att = db.prepare('SELECT * FROM attachments WHERE id=?').get(r.attachment_id);
    eq(att.path, '', "path='' (sin fichero)");
    eq(att.mime, '', "mime='' (discriminador de voz → pantalla degradada)");
    eq(att.kind, 'supplier_invoice_voice', 'kind marca el origen por voz');
    ok(att.extraction_json, 'persiste extraction_json');
    const saved = JSON.parse(att.extraction_json);
    eq(saved.supplier.fiscal_id, 'B98765432', 'guarda el NIF dictado');
    ok(saved.match === undefined && saved.open_orders === undefined, 'NO guarda derivados de BD');
    eq(db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c, 0, 'no mueve stock');
    eq(db.prepare('SELECT COUNT(*) c FROM purchases').get().c, 0, 'no crea compras');
  }

  // ── 2. captureFromExtraction normaliza igual que la visión (números/cantidades por defecto) ──
  console.log('2. misma normalización que extractInvoice (defaults y números)');
  {
    const db = freshDb();
    const r = captureFromExtraction(db, null, {
      supplier: { name: 'X', fiscal_id: '' },
      lines: [
        { description: 'Sin cantidad', unit_cost: 9 },          // quantity → 1
        { description: 'Coste texto EU', quantity: 2, unit_cost: '3,50' }, // "3,50" → 3.5
      ],
    });
    eq(r.extracted.lines[0].quantity, 1, 'cantidad por defecto 1');
    eq(r.extracted.lines[1].unit_cost, 3.5, 'coste "3,50" → 3.5');
  }
  // 2b. sin líneas usables → lanza (el handler lo traduce a mensaje de voz)
  {
    const db = freshDb();
    let threw = false;
    try { captureFromExtraction(db, null, { supplier: { name: 'X' }, lines: [] }); } catch { threw = true; }
    ok(threw, 'sin líneas → lanza (no crea adjunto a medias)');
    eq(db.prepare('SELECT COUNT(*) c FROM attachments').get().c, 0, 'no deja adjunto huérfano');
  }

  // ── 3. preparedCapture reconstruye el blob de voz y cuadra fresco ──
  console.log('3. preparedCapture (voz): reconstruye + recalcula match (NIF + descripción)');
  {
    const db = freshDb();
    addSupplier(db, 'Aroma & Luz, S.L.', 'B98765432');             // existe por NIF
    const pid = addProduct(db, 'Vela Vainilla 200g', 'VV200');     // existe por nombre
    const r = captureFromExtraction(db, null, dictado());
    const blob = preparedCapture(db, r.attachment_id);
    ok(blob, 'devuelve blob');
    eq(blob.mime, '', 'mime vacío → la pantalla muestra panel "dictada por voz"');
    ok(blob.match.supplier && blob.match.supplier.matched_by === 'nif', 'cuadra proveedor por NIF');
    ok(blob.match.lines[0].match.matched && blob.match.lines[0].match.product_id === pid, 'cuadra la 1ª línea por descripción');
    ok(!blob.match.lines[1].match.matched, '2ª línea (Difusor) sin cuadre → producto nuevo en pantalla');
  }

  // ── 4. Ciclo COMPLETO voz → confirm: stock + WAC por el libro (proveedor y producto nuevos) ──
  console.log('4. voz → confirm (compra directa): mueve stock + WAC, crea proveedor/producto con banda');
  {
    const db = freshDb();
    const pid = addProduct(db, 'Vela Vainilla 200g', 'VV200');  // existente; arranca stock 0, WAC 0
    const r = captureFromExtraction(db, null, dictado());
    const blob = preparedCapture(db, r.attachment_id);
    // El usuario confirma en pantalla: proveedor NUEVO, línea 1 producto existente, línea 2 producto NUEVO
    // con su banda (banda 'reducido' = 10%, derivada del vat_rate dictado).
    const payload = {
      attachment_id: r.attachment_id,
      supplier_mode: 'new',
      new_supplier: { name: 'Aroma & Luz, S.L.', fiscal_id: 'B98765432' },
      target_mode: 'direct',
      date: '2026-06-15',
      lines: [
        { product_mode: 'existing', product_id: pid, quantity: 3, unit_cost: 4 },
        { product_mode: 'new', new_name: 'Difusor de bambú', new_tax_band: 'reducido', quantity: 2, unit_cost: 7.5 },
      ],
    };
    const res = confirmCaptureSvc(db, payload);
    ok(res.entity_id > 0, 'aterriza en una compra directa');
    eq(stockOf(db, pid), 3, 'stock del producto existente sube a 3 por el libro');
    eq(wacOf(db, pid), 4, 'WAC del existente = 4 (coste de la línea)');
    // proveedor nuevo creado y enlazado
    const sup = db.prepare("SELECT id FROM suppliers WHERE fiscal_id='B98765432'").get();
    ok(sup, 'crea el proveedor nuevo por NIF');
    // producto nuevo creado CON su banda (no general por defecto)
    const np = db.prepare("SELECT tax_band, tax_rate, stock, average_cost FROM products WHERE name='Difusor de bambú'").get();
    ok(np, 'crea el producto nuevo');
    eq(np.tax_band, 'reducido', 'producto nuevo nace con banda explícita (reducido), no general');
    eq(np.tax_rate, 10, 'tax_rate 10% resuelto de la banda');
    eq(np.stock, 2, 'stock del producto nuevo = 2 por el libro');
    eq(np.average_cost, 7.5, 'WAC del producto nuevo = 7.5');
    // adjunto de voz enlazado a la compra
    const att = db.prepare('SELECT entity_type, entity_id FROM attachments WHERE id=?').get(r.attachment_id);
    eq(att.entity_type, 'purchase', 'adjunto de voz enlazado a la compra (documento origen)');
    ok(att.entity_id === res.entity_id, 'enlazado a la compra correcta');
  }

  // ── 5. Arreglo de banda: createProductSvc exige banda válida (lo que usa create_product/confirm) ──
  console.log('5. banda de IVA obligatoria en el alta validada (arreglo de create_product)');
  {
    const db = freshDb();
    let e1 = null;
    try { createProductSvc(db, { name: 'Sin banda', sku: 'SB-1', price: 5, type: 'physical' }); } catch (e) { e1 = e; }
    ok(e1 && e1.status === 400 && /banda|tax_band/i.test(e1.message), 'sin banda → 400 por banda (no cae en general/21 silenciosa)');
    let e2 = null;
    try { createProductSvc(db, { name: 'Banda mala', sku: 'BM-1', price: 5, type: 'physical', tax_band: 'inventada' }); } catch (e) { e2 = e; }
    ok(e2 && e2.status === 400, 'banda inexistente → 400');
    const okp = createProductSvc(db, { name: 'Con banda', sku: 'CB-1', price: 5, type: 'physical', tax_band: 'superreducido' });
    eq(okp.tax_rate, 4, 'banda válida (superreducido) → tax_rate 4');
  }

  console.log('\nResultado: ' + pass + ' OK, ' + fail + ' fallos');
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('ERROR FATAL:', e);
  process.exit(1);
}
