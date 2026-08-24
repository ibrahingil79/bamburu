// Gate de navegador C2 — captura de factura de proveedor por foto/PDF — contra el
// servidor real (tenant desarrollo-bamburu) y con LLAMADA REAL al modelo (visión).
//
// ⚠️ ESTE GATE SE CORRE A MANO, NO EN EL BARRIDO. Llama al modelo de visión de verdad: cuesta
// dinero, no es determinista, y depende de que al negocio le quede cuota de IA este mes. En julio de
// 2026 eso lo dejó MUERTO: el tenant de desarrollo agotó su tope (5 € de 5 €), el freno de gasto de
// core/llm.js empezó a cortar con 429 ANTES de llamar a la API, la pantalla de revisión no llegaba a
// pintarse y el gate moría esperando el selector #step2. El diagnóstico que quedó escrito —"#step2
// ya no existe"— era FALSO: el selector estaba donde siempre. Ahora, sin cuota, ABORTA de frente
// (código 2, "no he verificado NADA") en vez de morir con una traza que parece otra cosa.
//
// La PANTALLA de revisión (que es casi todo lo que hay aquí, y lo que de verdad se rompe con los
// cambios) vive ahora en gate-c2-revision.mjs, que siembra el adjunto en la BD y NO llama al modelo:
// ese sí entra en el barrido, gratis y determinista. Aquí se queda lo único que no se puede fingir:
// que el modelo LEE una factura de verdad.
//
//   PART 1: llamada real de extracción sobre una imagen de factura sintética →
//           imprime la salida LITERAL del modelo y verifica que parsea.
//   FLUJO A (imagen, compra directa): subir → revisar → corregir una línea (producto
//           existente) → crear un producto nuevo (banda obligatoria) → confirmar →
//           stock y WAC cuadran con el libro + "Documento origen" visible.
//   FLUJO B (PDF, contra orden): subir → cuadrar contra una orden enviada → recibir
//           con exceso confirmado → confirmar → recepción RC-NNNN mueve stock + adjunto.
//
// Genera dos órdenes/compra de prueba en el tenant de desarrollo y deja productos nuevos.
//   node scripts/gate-c2-captura.mjs
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, requireLlmQuota, autoAceptarPaneles } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB_PATH);
requireLlmQuota(db);   // sin cuota, el modelo devuelve 429 y este gate no probaría NADA: mejor abortar
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

const SUPPLIER_ID = 1;           // Aromas del Sur SL (NIF 1111)
const VAINILLA_ID = 2;           // Vela Vainilla 200g (física)
const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const post = async (u, body) => { const r = await fetch(BASE + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json() }; };
const stockOf = id => db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(id);

// Factura sintética (HTML) → la usaremos como imagen y como PDF. Limpia y de alto
// contraste para que la extracción real sea fiable.
function invoiceHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:40px;font-size:16px}
    h1{font-size:26px;margin:0 0 4px} .muted{color:#333}
    table{width:100%;border-collapse:collapse;margin-top:24px}
    th,td{border:1px solid #444;padding:8px 10px;text-align:left}
    th{background:#eee} .r{text-align:right}
    .tot{margin-top:20px;width:280px;margin-left:auto}
    .tot div{display:flex;justify-content:space-between;padding:3px 0}
  </style></head><body>
    <h1>Aromas del Sur SL</h1>
    <div class="muted">NIF: 1111 · Calle del Aroma 5, Sevilla</div>
    <div style="margin-top:18px"><strong>FACTURA</strong> Nº F-2026-0042 · Fecha: 09/06/2026</div>
    <table>
      <thead><tr><th>Descripción</th><th class="r">Cantidad</th><th class="r">Precio unitario (neto)</th><th class="r">IVA</th></tr></thead>
      <tbody>
        <tr><td>Vela Vainilla 200g</td><td class="r">3</td><td class="r">4,00 €</td><td class="r">21%</td></tr>
        <tr><td>Mecha de algodón premium</td><td class="r">2</td><td class="r">5,00 €</td><td class="r">21%</td></tr>
      </tbody>
    </table>
    <div class="tot">
      <div><span>Base imponible</span><span>22,00 €</span></div>
      <div><span>IVA 21%</span><span>4,62 €</span></div>
      <div><strong>TOTAL</strong><strong>26,62 €</strong></div>
    </div>
  </body></html>`;
}

const browser = await puppeteer.launch({ ...launchOpts() });

async function makeAssets() {
  const p = await browser.newPage();
  await p.setViewport({ width: 800, height: 700 });
  await p.setContent(invoiceHtml(), { waitUntil: 'networkidle0' });
  const png = await p.screenshot({ type: 'png' });          // Buffer
  const pdf = await p.pdf({ format: 'A4', printBackground: true });  // Buffer/Uint8Array
  await p.close();
  return { png: Buffer.from(png), pdf: Buffer.from(pdf) };
}

// Sube un Buffer al endpoint real de captura (multipart) y devuelve la respuesta JSON.
async function uploadCapture(buf, filename, mime) {
  const blob = new Blob([buf], { type: mime });
  const fd = new FormData();
  fd.append('file', blob, filename);
  const r = await fetch(BASE + '/api/erp/purchases/capture', { method: 'POST', headers: { 'Cookie': 'asess=' + token, 'x-csrf-token': csrf }, body: fd });
  return { status: r.status, body: await r.json() };
}

async function newAdminPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
  page.on('dialog', async d => { await d.accept(); });   // acepta los confirm() de exceso
  return page;
  // Y el panel que sustituyó a esas ventanitas: se acepta igual que se aceptaba el confirm().
  await autoAceptarPaneles(page);
}

try {
  const assets = await makeAssets();
  ok(assets.png.length > 1000 && assets.pdf.length > 1000, 'generadas imagen (' + assets.png.length + 'B) y PDF (' + assets.pdf.length + 'B) de factura de prueba');

  // ════ PART 1 — LLAMADA REAL al modelo, salida literal ════
  console.log('\nPART 1 · Extracción REAL (modelo de visión)');
  const real = await uploadCapture(assets.png, 'factura.png', 'image/png');
  console.log('  → status', real.status);
  if (real.status === 200) {
    console.log('  → extracción LITERAL:\n' + JSON.stringify(real.body.extracted, null, 2).split('\n').map(l => '    ' + l).join('\n'));
    console.log('  → cuadre proveedor:', JSON.stringify(real.body.match.supplier));
    ok(Array.isArray(real.body.extracted.lines) && real.body.extracted.lines.length >= 1, 'el modelo devolvió líneas usables');
    ok(real.body.attachment_id > 0, 'adjunto guardado (id ' + real.body.attachment_id + ')');
  } else {
    console.error('  ✗ extracción real falló:', JSON.stringify(real.body));
    ok(false, 'extracción real devolvió 200');
  }

  // ════ FLUJO A — imagen → compra directa ════
  console.log('\nFLUJO A · Imagen → compra directa (corregir línea + crear producto nuevo)');
  const vainillaBefore = stockOf(VAINILLA_ID);
  const newName = 'Mecha Captura ' + randomBytes(3).toString('hex');
  {
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/purchases/capture', { waitUntil: 'networkidle0' });
    // subir imagen por el input real
    const input = await page.$('#fileInput');
    const tmpPng = '/tmp/c2-gate-factura.png';
    const { writeFileSync } = await import('fs');
    writeFileSync(tmpPng, assets.png);
    await input.uploadFile(tmpPng);
    await page.click('#btnExtract');
    await page.waitForSelector('#step2', { visible: true, timeout: 60000 });
    ok(true, 'subida real → pantalla de revisión renderizada');
    // documento embebido visible
    ok(await page.$('#docPreview img') !== null, 'documento (imagen) embebido en la revisión');

    // Estado controlado: limpiamos las líneas extraídas y añadimos 2 propias por la UI.
    await page.evaluate(() => { (window.lines.slice()).forEach(l => window.lineRemove(l.uid)); });
    // Línea 1: producto existente vía buscador
    await page.click('#btnAddLine');
    await page.waitForSelector('.prodsearch');
    await page.type('.prodsearch', 'Vainilla');
    await page.waitForSelector('.prodsuggest div', { timeout: 8000 });
    await page.evaluate(() => { document.querySelector('.prodsuggest div').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    await sleep(200);
    ok(await page.$$eval('#linesBody .badge', els => els.some(e => e.textContent.includes('✓'))), 'línea 1 cuadrada con producto existente (Vainilla)');
    // ajustar cantidad/coste de la línea 1
    await page.evaluate(() => {
      const l = window.lines[0];
      window.lineSet(l.uid, 'quantity', '3'); window.lineSet(l.uid, 'unit_cost', '4');
    });
    // Línea 2: producto NUEVO con banda obligatoria
    await page.click('#btnAddLine');
    await page.evaluate(() => { const l = window.lines[window.lines.length - 1]; window.lineNewProduct(l.uid); });
    await page.waitForSelector('#linesBody select');
    await page.evaluate((nm) => {
      const l = window.lines[window.lines.length - 1];
      window.lineSet(l.uid, 'new_name', nm);
      window.lineSet(l.uid, 'new_sku', '');
      window.lineSet(l.uid, 'new_tax_band', 'general');
      window.lineSet(l.uid, 'quantity', '2'); window.lineSet(l.uid, 'unit_cost', '5');
    }, newName);
    // proveedor: asegurar uno existente (si el modelo no cuadró, elegir el id 1)
    await page.evaluate((sid) => {
      if (!window.supplier || window.supplier.mode !== 'existing') { window.pickSupplier(sid, 'Aromas del Sur SL'); }
    }, SUPPLIER_ID);
    await sleep(300);
    await page.click('#btnConfirm');
    await page.waitForNavigation({ timeout: 20000 }).catch(() => {});
    const url = page.url();
    ok(/\/admin\/purchases\/\d+$/.test(url), 'confirmar → redirige a la ficha de la compra (' + url.split('/').pop() + ')');

    // Verificación en BD: stock + WAC + producto nuevo + adjunto + documento origen
    const purchaseId = parseInt(url.split('/').pop());
    const vainillaAfter = stockOf(VAINILLA_ID);
    ok(vainillaAfter.stock === vainillaBefore.stock + 3, 'stock de Vainilla subió +3 por el libro (' + vainillaBefore.stock + '→' + vainillaAfter.stock + ')');
    const np = db.prepare('SELECT * FROM products WHERE name=?').get(newName);
    ok(np && np.stock === 2 && Math.abs(np.average_cost - 5) < 1e-9, 'producto nuevo creado con stock 2 y WAC 5 (banda general)');
    ok(np && np.tax_band === 'general' && np.tax_rate === 21, 'producto nuevo con banda elegida explícitamente (21%)');
    const att = db.prepare("SELECT * FROM attachments WHERE entity_type='purchase' AND entity_id=?").get(purchaseId);
    ok(!!att, 'adjunto enlazado a la compra (entity_type=purchase)');
    const fichaHtml = await page.content();
    ok(/Documento origen/.test(fichaHtml) && /capture\/file\//.test(fichaHtml), '"Documento origen" visible en la ficha de la compra');
    await page.close();
  }

  // ════ FLUJO B — PDF → cuadrar contra orden (con exceso confirmado) ════
  console.log('\nFLUJO B · PDF → cuadrar contra orden enviada (exceso confirmado)');
  {
    // orden de prueba enviada, pendiente 10 de Vainilla
    const created = (await post('/api/erp/purchase-orders', { supplier_id: SUPPLIER_ID, date: '2026-06-10', items: [{ product_id: VAINILLA_ID, quantity: 10, unit_cost: 4 }] })).body;
    const sent = (await post('/api/erp/purchase-orders/' + created.id + '/enviar')).body;
    ok(/^OC-/.test(sent.order_number || ''), 'orden de prueba ' + sent.order_number + ' enviada (pendiente 10)');
    const vainBefore = stockOf(VAINILLA_ID);

    const page = await newAdminPage();
    await page.goto(BASE + '/admin/purchases/capture', { waitUntil: 'networkidle0' });
    const tmpPdf = '/tmp/c2-gate-factura.pdf';
    const { writeFileSync } = await import('fs');
    writeFileSync(tmpPdf, assets.pdf);
    await (await page.$('#fileInput')).uploadFile(tmpPdf);
    await page.click('#btnExtract');
    await page.waitForSelector('#step2', { visible: true, timeout: 60000 });
    ok(await page.$('#docPreview embed') !== null, 'PDF embebido en la revisión');

    // elegir proveedor existente (carga sus órdenes abiertas) y cuadrar contra la nueva orden
    await page.evaluate((sid) => { window.pickSupplier(sid, 'Aromas del Sur SL'); }, SUPPLIER_ID);
    await sleep(600);   // refreshOpenOrders (fetch)
    const hasDestino = await page.evaluate((oid) => {
      if (!window.DATA.open_orders.some(o => o.id === oid)) return false;
      window.pickDest('order', oid);
      return true;
    }, created.id);
    ok(hasDestino, 'la orden enviada aparece como destino y se selecciona');
    await page.waitForSelector('#linesBody tr[data-uid]');
    // recibir 12 (exceso de 2 sobre 10) y confirmar (el dialog se acepta solo)
    await page.evaluate(() => { const l = window.orderLines[0]; window.orderSet(l.uid, 'quantity', '12'); });
    const warnShown = await page.evaluate(() => /exceso/i.test(document.querySelector('#linesBody').textContent));
    ok(warnShown, 'aviso de exceso visible en el formulario (recibir 12 de 10)');
    await page.click('#btnConfirm');
    await page.waitForNavigation({ timeout: 20000 }).catch(() => {});
    const url = page.url();
    ok(/\/admin\/purchase-order-receipts\/\d+$/.test(url), 'confirmar → ficha de recepción RC (' + url.split('/').pop() + ')');
    const recId = parseInt(url.split('/').pop());
    const vainAfter = stockOf(VAINILLA_ID);
    ok(vainAfter.stock === vainBefore.stock + 12, 'stock subió +12 por la recepción (exceso incluido)');
    const att = db.prepare("SELECT * FROM attachments WHERE entity_type='po_receipt' AND entity_id=?").get(recId);
    ok(!!att, 'adjunto enlazado a la recepción (entity_type=po_receipt)');
    const html = await page.content();
    ok(/Documento origen/.test(html), '"Documento origen" visible en la ficha de la recepción');
    await page.close();
  }

  // ════ Acceso al archivo sin permiso (403) ════
  console.log('\nControl de acceso al archivo');
  {
    // sesión de empleado SIN permisos de compras
    const etok = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(etok, 3, now, now + 600, randomBytes(16).toString('hex'));
    const anyAtt = db.prepare("SELECT id FROM attachments ORDER BY id DESC LIMIT 1").get();
    const r403 = await fetch(BASE + '/api/erp/purchases/capture/file/' + anyAtt.id, { headers: { 'Cookie': 'asess=' + etok } });
    ok(r403.status === 403 || r403.status === 401, 'empleado sin permiso de compras → ' + r403.status + ' al archivo');
    const rNoAuth = await fetch(BASE + '/api/erp/purchases/capture/file/' + anyAtt.id);
    ok(rNoAuth.status === 401, 'sin sesión → 401 al archivo');
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(etok);
  }

} catch (e) {
  console.error('ERROR en el gate:', e.stack || e.message);
  fail++;
} finally {
  await browser.close();
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db.close();
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + 'C2 gate navegador: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
