// Gate de navegador C2 — la PANTALLA de revisión de una factura capturada, de punta a punta y SIN
// llamar al modelo. Contra el servidor real (tenant desarrollo-bamburu).
//
//   FLUJO A (imagen → compra directa): revisión precargada → corregir una línea (producto existente)
//           → crear un producto nuevo (banda obligatoria) → confirmar → stock y WAC cuadran con el
//           libro + "Documento origen" visible en la ficha.
//   FLUJO B (PDF → contra orden): cuadrar contra una orden enviada → recibir con EXCESO confirmado
//           → confirmar → recepción RC-NNNN que mueve stock + adjunto enlazado.
//   ACCESO: el archivo del adjunto, sin permiso de compras → 403; sin sesión → 401.
//
// POR QUÉ EXISTE ESTE GATE, SEPARADO DE gate-c2-captura.
// gate-c2-captura hace lo mismo PERO llamando al modelo de visión de verdad. Eso lo vuelve caro y no
// determinista, y en julio de 2026 lo dejó MUERTO: el tenant agotó su tope de gasto de IA del mes
// (5 € de 5 €), el freno de core/llm.js empezó a cortar con 429 ANTES de llamar a la API, la pantalla
// de revisión no se pintaba nunca y el gate moría esperando un selector. El diagnóstico que quedó
// escrito ("el selector #step2 ya no existe") era FALSO: #step2 está donde siempre. Un gate que
// depende del saldo de una cuenta no puede vivir en un barrido de regresión.
//
// Así que la extracción REAL se queda en gate-c2-captura (a mano, cuando haya cuota) y TODO lo demás
// —que es la mayor parte, y la que se rompe— vive aquí: se SIEMBRA el adjunto y su lectura en la BD,
// tal y como los deja el modelo, y a partir de ahí el flujo es el de verdad: la misma pantalla, el
// mismo cuadre contra el catálogo, el mismo endpoint de confirmación, el mismo motor de stock.
// No se simula NADA del producto: solo se le ahorra la foto.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { purgarArtefactos, cuadraLibro, RID } from './lib/gate-fixtures.mjs';
import { saveAttachment } from '../modules/erp/attachments.js';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

process.chdir(APP_DIR);   // saveAttachment resuelve data/uploads/<slug> contra el cwd, como el servidor

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';
const TENANT = { slug: 'desarrollo-bamburu' };

const SUPPLIER_ID = 1;    // Aromas del Sur SL (NIF 1111)
const VAINILLA_ID = 2;    // Vela Vainilla 200g (física)

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const post = async (u, body) => { const r = await fetch(BASE + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json() }; };
const stockOf = id => db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(id);

const creado = { ordenes: [], recepciones: [], compras: [], productos: [] };
const adjuntos = [];
const usuariosDePrueba = [];

// La factura de prueba (misma que usa gate-c2-captura contra el modelo real).
function invoiceHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:40px;font-size:16px}
    h1{font-size:26px;margin:0 0 4px} .muted{color:#333}
    table{width:100%;border-collapse:collapse;margin-top:24px}
    th,td{border:1px solid #444;padding:8px 10px;text-align:left}
    th{background:#eee} .r{text-align:right}
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
  </body></html>`;
}

// La LECTURA del modelo, tal y como la persiste la captura real en attachments.extraction_json
// (mismo esquema exacto: supplier{name,fiscal_id}, date, invoice_number, lines[], totals{}).
// Es el ÚNICO atajo del gate: a partir de aquí, todo lo que se ejercita es producto de verdad —el
// cuadre contra el catálogo lo recalcula el servidor con matchExtraction(), no viene sembrado.
const LECTURA = {
  supplier: { name: 'Aromas del Sur SL', fiscal_id: '1111' },
  date: '2026-06-09',
  invoice_number: 'F-2026-0042',
  lines: [
    { description: 'Vela Vainilla 200g', quantity: 3, unit_cost: 4, vat_rate: 21 },
    { description: 'Mecha de algodón premium', quantity: 2, unit_cost: 5, vat_rate: 21 },
  ],
  totals: { base: 22, tax: 4.62, total: 26.62 },
};

// Siembra el adjunto igual que lo deja la captura real: binario en disco (saveAttachment, el mismo
// código que usa el producto) + la lectura cruda en extraction_json.
function sembrarAdjunto(buffer, nombre, mime, lectura) {
  const att = saveAttachment(db, TENANT, { buffer, originalName: nombre, mime });
  db.prepare('UPDATE attachments SET extraction_json=? WHERE id=?').run(JSON.stringify(lectura), att.id);
  adjuntos.push(att.id);
  return att.id;
}

const browser = await puppeteer.launch({ ...launchOpts() });

async function newAdminPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
  page.on('dialog', async d => { await d.accept(); });   // acepta el confirm() del exceso
  return page;
}

try {
  // Imagen y PDF reales de la factura (los pinta el propio Chromium: ni modelo, ni red).
  const p0 = await browser.newPage();
  await p0.setViewport({ width: 800, height: 700 });
  await p0.setContent(invoiceHtml(), { waitUntil: 'networkidle0' });
  const png = Buffer.from(await p0.screenshot({ type: 'png' }));
  const pdf = Buffer.from(await p0.pdf({ format: 'A4', printBackground: true }));
  await p0.close();
  ok(png.length > 1000 && pdf.length > 1000, 'generadas imagen (' + png.length + 'B) y PDF (' + pdf.length + 'B) de factura de prueba');

  // ════ FLUJO A — imagen → compra directa ════
  console.log('\nFLUJO A · Revisión precargada → corregir línea + producto nuevo → compra directa');
  const nuevoNombre = 'Mecha Captura (gate ' + RID() + ')';
  const vainillaBefore = stockOf(VAINILLA_ID);
  {
    const attId = sembrarAdjunto(png, 'factura.png', 'image/png', LECTURA);
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/purchases/capture?attachment=' + attId, { waitUntil: 'networkidle0' });

    // Arranca YA en el Paso 2 (revisión), sin pasar por la subida.
    await page.waitForSelector('#step2', { visible: true, timeout: 15000 });
    ok(await page.$eval('#step1', el => getComputedStyle(el).display === 'none'), 'Paso 1 (subida) OCULTO — entró precargado');
    ok(await page.$eval('#step2', el => getComputedStyle(el).display !== 'none'), 'Paso 2 (revisión) VISIBLE');
    ok(await page.$('#docPreview img') !== null, 'documento (imagen) embebido en la revisión');

    // El cuadre lo hace el SERVIDOR contra el catálogo vivo (matchExtraction): no viene sembrado.
    ok(await page.$$eval('#supplierBox .badge', els => els.some(e => /Cuadrado/i.test(e.textContent))), 'proveedor cuadrado por NIF (Aromas del Sur)');
    ok(await page.$$eval('#linesBody .badge', els => els.some(e => e.textContent.includes('✓'))), 'la línea de Vainilla cuadra sola con su producto del catálogo');

    // Línea 1 (producto existente): corregir cantidad/coste a mano, como haría el usuario.
    await page.evaluate(() => {
      const l = window.lines.find(x => x.product_mode === 'existing' && x.product_id);
      window.lineSet(l.uid, 'quantity', '3');
      window.lineSet(l.uid, 'unit_cost', '4');
    });
    // Línea 2 (la que NO cuadra): darla de alta como producto NUEVO, con banda de IVA obligatoria.
    await page.evaluate((nm) => {
      const l = window.lines.find(x => !x.product_id);
      window.lineNewProduct(l.uid);
      window.lineSet(l.uid, 'new_name', nm);
      window.lineSet(l.uid, 'new_sku', '');
      window.lineSet(l.uid, 'new_tax_band', 'general');
      window.lineSet(l.uid, 'quantity', '2');
      window.lineSet(l.uid, 'unit_cost', '5');
    }, nuevoNombre);
    await sleep(300);
    await page.screenshot({ path: '/tmp/c2rev-1-revision.png' });

    await page.click('#btnConfirm');
    await page.waitForNavigation({ timeout: 20000 }).catch(() => {});
    const url = page.url();
    ok(/\/admin\/purchases\/\d+$/.test(url), 'confirmar → redirige a la ficha de la compra (' + url.split('/').pop() + ')');
    const purchaseId = parseInt(url.split('/').pop());
    creado.compras.push(purchaseId);

    // El motor: stock por el libro, producto nuevo con su banda, adjunto enlazado.
    const vainillaAfter = stockOf(VAINILLA_ID);
    ok(vainillaAfter.stock === vainillaBefore.stock + 3, 'stock de Vainilla subió +3 por el libro (' + vainillaBefore.stock + '→' + vainillaAfter.stock + ')');
    const np = db.prepare('SELECT * FROM products WHERE name=?').get(nuevoNombre);
    if (np) creado.productos.push(np.id);
    ok(np && np.stock === 2 && Math.abs(np.average_cost - 5) < 1e-9, 'producto nuevo creado con stock 2 y WAC 5');
    ok(np && np.tax_band === 'general' && np.tax_rate === 21, 'producto nuevo con la banda elegida explícitamente (21%)');
    const att = db.prepare("SELECT * FROM attachments WHERE entity_type='purchase' AND entity_id=?").get(purchaseId);
    ok(att && att.id === attId, 'el adjunto queda enlazado a la compra (entity_type=purchase)');
    const ficha = await page.content();
    ok(/Documento origen/.test(ficha) && /capture\/file\//.test(ficha), '"Documento origen" visible en la ficha de la compra');
    ok(cuadraLibro(db, [VAINILLA_ID, np.id]), 'caché == libro para los productos tocados');
    await page.screenshot({ path: '/tmp/c2rev-2-compra.png' });
    await page.close();
  }

  // ════ FLUJO B — PDF → cuadrar contra orden enviada (con exceso confirmado) ════
  console.log('\nFLUJO B · PDF → cuadrar contra orden enviada (exceso confirmado) → recepción');
  {
    const created = (await post('/api/erp/purchase-orders', { supplier_id: SUPPLIER_ID, date: '2026-06-10', items: [{ product_id: VAINILLA_ID, quantity: 10, unit_cost: 4 }] })).body;
    creado.ordenes.push(created.id);
    const sent = (await post('/api/erp/purchase-orders/' + created.id + '/enviar')).body;
    ok(/^OC-/.test(sent.order_number || ''), 'orden de prueba ' + sent.order_number + ' enviada (pendiente 10)');
    const vainBefore = stockOf(VAINILLA_ID);

    const attId = sembrarAdjunto(pdf, 'factura.pdf', 'application/pdf', LECTURA);
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/purchases/capture?attachment=' + attId, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#step2', { visible: true, timeout: 15000 });
    ok(await page.$('#docPreview embed') !== null, 'PDF embebido en la revisión');

    // La orden abierta del proveedor llega ya en el blob precargado (el servidor la recalcula).
    const hasDestino = await page.evaluate((oid) => {
      if (!window.DATA.open_orders.some(o => o.id === oid)) return false;
      window.pickDest('order', oid);
      return true;
    }, created.id);
    ok(hasDestino, 'la orden enviada aparece como destino elegible y se selecciona');
    await page.waitForSelector('#linesBody tr[data-uid]');

    // Recibir 12 de 10: la pantalla debe AVISAR del exceso antes de dejar confirmar.
    await page.evaluate(() => { const l = window.orderLines[0]; window.orderSet(l.uid, 'quantity', '12'); });
    const warnShown = await page.evaluate(() => /exceso/i.test(document.querySelector('#linesBody').textContent));
    ok(warnShown, 'aviso de exceso visible en el formulario (recibir 12 de 10)');
    await page.screenshot({ path: '/tmp/c2rev-3-exceso.png' });

    await page.click('#btnConfirm');   // el confirm() del exceso se acepta en el handler
    await page.waitForNavigation({ timeout: 20000 }).catch(() => {});
    const url = page.url();
    ok(/\/admin\/purchase-order-receipts\/\d+$/.test(url), 'confirmar → ficha de la recepción RC (' + url.split('/').pop() + ')');
    const recId = parseInt(url.split('/').pop());
    creado.recepciones.push(recId);

    const vainAfter = stockOf(VAINILLA_ID);
    ok(vainAfter.stock === vainBefore.stock + 12, 'stock subió +12 por la recepción, exceso incluido (' + vainBefore.stock + '→' + vainAfter.stock + ')');
    const att = db.prepare("SELECT * FROM attachments WHERE entity_type='po_receipt' AND entity_id=?").get(recId);
    ok(att && att.id === attId, 'el adjunto queda enlazado a la recepción (entity_type=po_receipt)');
    const html = await page.content();
    ok(/Documento origen/.test(html), '"Documento origen" visible en la ficha de la recepción');
    ok(cuadraLibro(db, [VAINILLA_ID]), 'caché == libro tras la recepción');
    await page.close();
  }

  // ════ ACCESO — el archivo del adjunto nunca es público (requiere purchases.read) ════
  //
  // El gate original usaba aquí al empleado del tenant (user 3) dando por hecho que NO tenía permiso
  // de compras. Hoy SÍ lo tiene (purchases.read), así que el endpoint le sirve el archivo — y hace
  // bien. La aserción llevaba tiempo comprobando una suposición falsa sobre un dato vivo: exactamente
  // la misma enfermedad que mató a los otros gates. El empleado sin permiso se CREA aquí.
  console.log('\nACCESO · el archivo del adjunto está protegido');
  {
    const attId = adjuntos[0];
    const emailSinPermiso = 'zz-gate-c2-' + RID() + '@bamburu.test';
    const sinPermiso = db.prepare(
      "INSERT INTO admin_users (name, email, password_hash, role, active) VALUES ('Gate C2 sin permisos', ?, 'x', 'employee', 1)"
    ).run(emailSinPermiso);
    const uid = Number(sinPermiso.lastInsertRowid);
    usuariosDePrueba.push(uid);
    // Precondición: no tiene NINGÚN permiso de compras. Si lo tuviera, el 403 no probaría nada.
    const tienePerm = db.prepare(
      "SELECT COUNT(*) n FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.admin_user_id=? AND p.module='purchases'").get(uid).n;
    ok(tienePerm === 0, 'precondición: el empleado de prueba NO tiene ningún permiso de compras');

    const etok = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(etok, uid, now, now + 600, randomBytes(16).toString('hex'));
    const r403 = await fetch(BASE + '/api/erp/purchases/capture/file/' + attId, { headers: { 'Cookie': 'asess=' + etok } });
    ok(r403.status === 403 || r403.status === 401, 'empleado SIN permiso de compras → ' + r403.status + ' al archivo');
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(etok);

    const rNoAuth = await fetch(BASE + '/api/erp/purchases/capture/file/' + attId, { redirect: 'manual' });
    ok(rNoAuth.status === 401 || rNoAuth.status === 403 || rNoAuth.status === 302, 'sin sesión → no sirve el archivo (status ' + rNoAuth.status + ')');

    // Y con permiso SÍ se sirve: sin esto, un endpoint roto (que negara a todo el mundo) pasaría por
    // "seguro". El 403 de arriba tiene que ser del PERMISO, no de una avería.
    const rOk = await fetch(BASE + '/api/erp/purchases/capture/file/' + attId, { headers: { 'Cookie': 'asess=' + token } });
    ok(rOk.status === 200, 'con sesión y permiso → 200: el 403 de arriba es del permiso, no de un endpoint averiado');
  }

} catch (e) {
  console.error('ERROR en el gate:', e.stack || e.message);
  fail++;
} finally {
  await browser.close();

  // ── Limpieza: el gate borra POR ID lo que creó (documentos, producto nuevo, movimientos) ──
  const db2 = new Database(DB_PATH);
  const tocadas = purgarArtefactos(db2, creado);
  console.log('  (limpieza: ' + tocadas.movimientos + ' movimientos, ' + tocadas.documentos + ' filas de documento, ' + tocadas.productos + ' producto)');
  ok(cuadraLibro(db2, [VAINILLA_ID]), 'caché == libro tras la limpieza (Vainilla vuelve a su sitio)');

  // El empleado de prueba se va con sus sesiones (no se queda un usuario fantasma por pasada).
  for (const uid of usuariosDePrueba) {
    db2.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(uid);
    db2.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(uid);
    db2.prepare('DELETE FROM admin_users WHERE id=?').run(uid);
  }
  ok(usuariosDePrueba.every(uid => !db2.prepare('SELECT 1 FROM admin_users WHERE id=?').get(uid)), 'el empleado de prueba queda retirado del tenant');

  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador C2 (revisión, sin modelo): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
