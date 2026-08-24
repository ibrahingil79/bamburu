// C2 — Captura de factura de proveedor por foto/PDF — tests de lógica.
// Cubre el encargo: búsquedas nuevas (producto/proveedor), parseo/validación del JSON
// de extracción (incl. malformado), cuadre por NIF/nombre/SKU/código, aterrizaje con y
// sin orden, exceso (confirm_excess), creación al vuelo de proveedor/producto con banda
// obligatoria, atomicidad (nada a medias) y attachment enlazado.
//
//   node scripts/test-c2-captura.mjs
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { searchProducts, createProductSvc } from '../modules/erp/routes/products.js';
import { searchSuppliers, createSupplierSvc } from '../modules/erp/routes/suppliers.js';
import { createPurchaseOrderSvc, sendPurchaseOrderSvc } from '../modules/erp/routes/purchase-orders.js';
import { orderReceptionState } from '../modules/erp/routes/purchase-order-receipts.js';
import { productStock } from '../modules/erp/stock.js';
import { attachmentsFor } from '../modules/erp/attachments.js';
import {
  parseExtraction, toNumber, normDate, matchExtraction, supplierOpenOrders,
  confirmCaptureSvc, confirmCaptureSchema,
} from '../modules/erp/routes/purchases-capture.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
const near = (a, b, m) => ok(Math.abs(a - b) < 1e-9, m + ' (got ' + a + ', want ' + b + ')');
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
const addSupplier = (db, name, nif = '', active = 1) => db.prepare('INSERT INTO suppliers (name,fiscal_id,active) VALUES (?,?,?)').run(name, nif, active).lastInsertRowid;
const addProduct = (db, name, sku = '', code = '', status = 'active') =>
  db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band,product_code,status) VALUES (?,?,?,50,'physical',0,21,'general',?,?)")
    .run(name, 'p' + (++n), sku, code, status).lastInsertRowid;
const addAttachment = db => db.prepare("INSERT INTO attachments (kind,path,mime,size) VALUES ('supplier_invoice','x',' ',0)").run().lastInsertRowid;
function sentOrder(db, sup, items) { const id = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items }); sendPurchaseOrderSvc(db, id); return id; }
const confirm = (db, payload) => confirmCaptureSvc(db, confirmCaptureSchema.parse(payload));

// ── 1. searchProducts: nombre / SKU / código interno, solo activos ──────────
console.log('1. searchProducts');
{
  const db = freshDb();
  addProduct(db, 'Vela Vainilla 200g', 'VV-200', 'PROD-0001');
  addProduct(db, 'Cera de soja', 'CERA-1', 'PROD-0002');
  addProduct(db, 'Producto inactivo', 'OFF-1', 'PROD-0003', 'draft');
  eq(searchProducts(db, { q: 'vainilla' }).map(p => p.sku), ['VV-200'], 'busca por nombre');
  eq(searchProducts(db, { q: 'CERA-1' }).map(p => p.name), ['Cera de soja'], 'busca por SKU');
  eq(searchProducts(db, { q: 'PROD-0001' }).map(p => p.sku), ['VV-200'], 'busca por código interno');
  eq(searchProducts(db, { q: 'inactivo' }).length, 0, 'no devuelve inactivos (status<>active)');
  ok(searchProducts(db, { q: '', limit: 1 }).length === 1, 'respeta el limit');
}

// ── 2. searchSuppliers: nombre / NIF, solo activos ──────────────────────────
console.log('2. searchSuppliers');
{
  const db = freshDb();
  addSupplier(db, 'Aromas del Sur SL', 'B12345678');
  addSupplier(db, 'Esencias SA', 'A87654321');
  addSupplier(db, 'Archivado SL', 'X0000', 0);
  eq(searchSuppliers(db, { q: 'aromas' }).map(s => s.fiscal_id), ['B12345678'], 'busca por nombre');
  eq(searchSuppliers(db, { q: 'A87654321' }).map(s => s.name), ['Esencias SA'], 'busca por NIF');
  eq(searchSuppliers(db, { q: 'archivado' }).length, 0, 'no devuelve archivados (active=0)');
}

// ── 3. parseExtraction: válido, fences, malformado, sin líneas, números EU ──
console.log('3. parseExtraction');
{
  const good = JSON.stringify({ supplier: { name: 'Prov', fiscal_id: 'B1' }, date: '2026-06-10', invoice_number: 'F-1', lines: [{ description: 'Item', quantity: 2, unit_cost: 3.5, vat_rate: 21 }], totals: { base: 7, tax: 1.47, total: 8.47 } });
  const r = parseExtraction(good);
  eq([r.supplier.name, r.supplier.fiscal_id, r.date, r.invoice_number], ['Prov', 'B1', '2026-06-10', 'F-1'], 'JSON limpio parsea');
  eq([r.lines[0].quantity, r.lines[0].unit_cost, r.lines[0].vat_rate], [2, 3.5, 21], 'línea con números');
  // fences ```json ... ```
  const fenced = '```json\n' + good + '\n```';
  ok(parseExtraction(fenced).lines.length === 1, 'quita fences ```json');
  // texto + objeto incrustado
  ok(parseExtraction('Aquí tienes:\n' + good + '\nFin.').supplier.name === 'Prov', 'recorta al objeto { ... }');
  // números a la europea + fecha DD/MM/YYYY
  const eu = JSON.stringify({ supplier: { name: 'P' }, date: '10/06/2026', lines: [{ description: 'X', quantity: '1', unit_cost: '1.234,56' }], totals: {} });
  const re = parseExtraction(eu);
  eq([re.date, re.lines[0].unit_cost], ['2026-06-10', 1234.56], 'fecha EU y coste "1.234,56"');
  // malformado → 422
  throws(() => parseExtraction('no soy json'), 422, 'malformado → 422 claro');
  throws(() => parseExtraction(''), 422, 'vacío → 422');
  // sin líneas → 422
  throws(() => parseExtraction(JSON.stringify({ supplier: { name: 'P' }, lines: [], totals: {} })), 422, 'sin líneas → 422');
}

// ── 3b. toNumber / normDate (unidades) ──────────────────────────────────────
console.log('3b. toNumber / normDate');
{
  eq([toNumber('1.234,56'), toNumber('1,234.56'), toNumber('12,50'), toNumber('5'), toNumber('  3,2 €')], [1234.56, 1234.56, 12.5, 5, 3.2], 'toNumber formatos');
  eq([toNumber(null), toNumber(''), toNumber('abc')], [null, null, null], 'toNumber nulos/no numéricos');
  eq([normDate('2026-6-9'), normDate('09/06/2026'), normDate('bad')], ['2026-06-09', '2026-06-09', ''], 'normDate');
}

// ── 4. matchExtraction: proveedor por NIF / nombre; línea por nombre/SKU/código ─
console.log('4. matchExtraction (cuadre)');
{
  const db = freshDb();
  const s1 = addSupplier(db, 'Aromas del Sur SL', 'B12345678');
  addSupplier(db, 'Otro', 'Z999', 0); // archivado con NIF
  addProduct(db, 'Vela Vainilla 200g', 'VV-200', 'PROD-0001');
  // por NIF exacto
  let m = matchExtraction(db, parseExtraction(JSON.stringify({ supplier: { name: 'no importa', fiscal_id: 'B12345678' }, lines: [{ description: 'Vela Vainilla 200g', quantity: 1, unit_cost: 1 }], totals: {} })));
  eq([m.supplier.id, m.supplier.matched_by], [s1, 'nif'], 'proveedor cuadrado por NIF');
  eq(m.lines[0].match.matched, true, 'línea cuadrada por nombre');
  eq(m.lines[0].match.product_id, 1, 'product_id propuesto');
  // por nombre (sin NIF)
  m = matchExtraction(db, parseExtraction(JSON.stringify({ supplier: { name: 'Aromas del Sur' }, lines: [{ description: 'VV-200', quantity: 1, unit_cost: 1 }], totals: {} })));
  eq(m.supplier.matched_by, 'name', 'proveedor cuadrado por nombre');
  eq(m.lines[0].match.product_id, 1, 'línea cuadrada por SKU');
  // por código interno + unmatched
  m = matchExtraction(db, parseExtraction(JSON.stringify({ supplier: { fiscal_id: 'Z999' }, lines: [{ description: 'PROD-0001', quantity: 1, unit_cost: 1 }, { description: 'Algo que no existe xyz', quantity: 1, unit_cost: 1 }], totals: {} })));
  eq(m.supplier, null, 'NIF de proveedor ARCHIVADO → no autoselecciona');
  eq(m.lines[0].match.product_id, 1, 'línea cuadrada por código interno');
  eq(m.lines[1].match.matched, false, 'línea sin cuadre → unmatched');
}

// ── 5. supplierOpenOrders: solo enviadas con pendiente ──────────────────────
console.log('5. supplierOpenOrders');
{
  const db = freshDb();
  const sup = addSupplier(db, 'Prov', 'B1');
  const p = addProduct(db, 'P', 'S1');
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 10, unit_cost: 2 }]);
  const oo = supplierOpenOrders(db, sup);
  eq(oo.length, 1, 'una orden abierta');
  eq(oo[0].total_pendiente, 10, 'pendiente correcto');
  eq(oo[0].lines[0].product_id, p, 'incluye las líneas pendientes');
  // un borrador no cuenta
  createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 5, unit_cost: 2 }] });
  eq(supplierOpenOrders(db, sup).length, 1, 'el borrador no cuenta (solo enviadas)');
}

// ── 6. Aterrizaje SIN orden (compra directa): mueve stock + WAC + attachment ─
console.log('6. confirmCaptureSvc — compra directa');
{
  const db = freshDb();
  const sup = addSupplier(db, 'Prov', 'B1');
  const p = addProduct(db, 'Vela', 'S1');
  const att = addAttachment(db);
  const r = confirm(db, {
    attachment_id: att, supplier_mode: 'existing', supplier_id: sup, target_mode: 'direct',
    date: '2026-06-10', reference: 'F-100',
    lines: [{ product_mode: 'existing', product_id: p, quantity: 4, unit_cost: 2.5 }],
  });
  eq(r.entity_type, 'purchase', 'aterriza como compra directa');
  eq(productStock(db, p), 4, 'el libro suma 4 (stock movido)');
  const cache = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(p);
  eq([cache.stock, cache.average_cost], [4, 2.5], 'caché stock y WAC cuadran');
  const pu = db.prepare('SELECT status, reference FROM purchases WHERE id=?').get(r.entity_id);
  eq([pu.status, pu.reference], ['received', 'F-100'], 'compra received con la referencia');
  eq(attachmentsFor(db, 'purchase', r.entity_id).map(a => a.id), [att], 'attachment enlazado a la compra');
}

// ── 7. Proveedor + producto nuevos al vuelo (banda obligatoria) ─────────────
console.log('7. confirmCaptureSvc — proveedor y producto nuevos');
{
  const db = freshDb();
  const att = addAttachment(db);
  // banda ausente → 400 (sin defecto silencioso)
  throws(() => confirm(db, {
    attachment_id: att, supplier_mode: 'new', new_supplier: { name: 'Nuevo Prov', fiscal_id: 'N-1' },
    target_mode: 'direct', date: '2026-06-10',
    lines: [{ product_mode: 'new', new_name: 'Producto X', new_tax_band: '', quantity: 2, unit_cost: 3 }],
  }), 400, 'producto nuevo sin banda → 400');
  // nada a medias: ni proveedor ni producto creados
  eq(db.prepare("SELECT COUNT(*) c FROM suppliers").get().c, 0, 'atomicidad: proveedor NO creado tras el fallo');
  eq(db.prepare("SELECT COUNT(*) c FROM products").get().c, 0, 'atomicidad: producto NO creado tras el fallo');

  // con banda → crea proveedor, producto y compra
  const r = confirm(db, {
    attachment_id: att, supplier_mode: 'new', new_supplier: { name: 'Nuevo Prov', fiscal_id: 'N-1' },
    target_mode: 'direct', date: '2026-06-10',
    lines: [{ product_mode: 'new', new_name: 'Producto X', new_sku: 'PX-1', new_tax_band: 'general', quantity: 2, unit_cost: 3 }],
  });
  const sup = db.prepare("SELECT * FROM suppliers WHERE fiscal_id='N-1'").get();
  ok(sup && /^PROV-/.test(sup.supplier_code), 'proveedor nuevo creado con código interno');
  const prod = db.prepare("SELECT * FROM products WHERE sku='PX-1'").get();
  eq([prod.tax_band, prod.tax_rate, prod.type], ['general', 21, 'physical'], 'producto nuevo con banda elegida (21%)');
  eq(productStock(db, prod.id), 2, 'la compra movió stock del producto nuevo');
  eq(db.prepare('SELECT supplier_id FROM purchases WHERE id=?').get(r.entity_id).supplier_id, sup.id, 'compra ligada al proveedor nuevo');
}

// ── 7b. NIF duplicado al crear proveedor → 409 y atomicidad ─────────────────
console.log('7b. proveedor nuevo con NIF en uso');
{
  const db = freshDb();
  addSupplier(db, 'Ya existe', 'DUP-1');
  throws(() => confirm(db, {
    supplier_mode: 'new', new_supplier: { name: 'Otro', fiscal_id: 'DUP-1' }, target_mode: 'direct', date: '2026-06-10',
    lines: [{ product_mode: 'new', new_name: 'P', new_tax_band: 'general', quantity: 1, unit_cost: 1 }],
  }), 409, 'NIF duplicado → 409');
  eq(db.prepare('SELECT COUNT(*) c FROM products').get().c, 0, 'atomicidad: producto no creado si falla el proveedor');
}

// ── 8. Aterrizaje CONTRA orden + exceso (confirm_excess) ────────────────────
console.log('8. confirmCaptureSvc — contra orden + exceso');
{
  const db = freshDb();
  const sup = addSupplier(db, 'Prov', 'B1');
  const p = addProduct(db, 'P', 'S1');
  const oid = sentOrder(db, sup, [{ product_id: p, quantity: 10, unit_cost: 2 }]);
  const oitem = orderReceptionState(db, oid).lines[0].order_item_id;
  const att = addAttachment(db);
  // recepción parcial normal
  const r1 = confirm(db, {
    attachment_id: att, target_mode: 'order', order_id: oid, date: '2026-06-11',
    lines: [{ product_mode: 'existing', order_item_id: oitem, quantity: 6, unit_cost: 2 }],
  });
  eq(r1.entity_type, 'po_receipt', 'aterriza como recepción');
  ok(/^RC-/.test(r1.label), 'recepción con número RC-NNNN');
  eq(productStock(db, p), 6, 'stock movido por la recepción');
  eq(attachmentsFor(db, 'po_receipt', r1.entity_id).map(a => a.id), [att], 'attachment enlazado a la recepción');
  eq(orderReceptionState(db, oid).lines[0].pendiente, 4, 'pendiente 4 tras recibir 6');
  // exceso sin confirm → 400
  throws(() => confirm(db, {
    target_mode: 'order', order_id: oid, date: '2026-06-12',
    lines: [{ product_mode: 'existing', order_item_id: oitem, quantity: 9, unit_cost: 2 }],
  }), 400, 'exceso (4 pendiente, recibir 9) sin confirm_excess → 400');
  eq(productStock(db, p), 6, 'el rechazo no movió stock');
  // exceso con confirm → ok, línea completada + exceso visible
  const r2 = confirm(db, {
    target_mode: 'order', order_id: oid, date: '2026-06-12', confirm_excess: true,
    lines: [{ product_mode: 'existing', order_item_id: oitem, quantity: 9, unit_cost: 2 }],
  });
  eq(productStock(db, p), 15, 'con confirm_excess entra todo (6+9=15)');
  const st = orderReceptionState(db, oid).lines[0];
  eq([st.pendiente, st.exceso], [0, 5], 'pendiente 0 y exceso +5 (15 de 10)');
}

// ── 9. DISA: purchases/purchase_items fuera de WRITABLE_TABLES (cierre) ──────
console.log('9. DISA — compras fuera de WRITABLE_TABLES');
{
  const src = readFileSync(new URL('../modules/disa/index.js', import.meta.url), 'utf8');
  const setBlock = src.slice(src.indexOf('const WRITABLE_TABLES'), src.indexOf('const WRITABLE_TABLES') + 600);
  ok(!/['"]purchases['"]/.test(setBlock) && !/['"]purchase_items['"]/.test(setBlock), "DISA ya no puede escribir 'purchases'/'purchase_items' por el genérico");
}

// ⚙️ 24 ago 2026 · EL RESUMEN, EN EL FORMATO QUE EL CORREDOR SABE LEER. Esto imprimía «N pasaron, M
// fallaron» y el barrido lo leía como «salió 0 pero no imprimió resumen — no demuestra nada»: una
// comprobación que pasa y que el corredor no puede dar por buena es una que no cuenta.
console.log('\n' + '─'.repeat(60));
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail ? 1 : 0);
