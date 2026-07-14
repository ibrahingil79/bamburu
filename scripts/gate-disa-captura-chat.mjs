// Gate — Subir factura DENTRO del chat de DISA (Pilar 3) — servidor real (tenant
// desarrollo-bamburu) y LLAMADA REAL al modelo (visión). Reutiliza C2 de punta a punta.
//
// ⚠️ ESTE GATE SE CORRE A MANO, NO EN EL BARRIDO. Llama al modelo de verdad: cuesta dinero, no es
// determinista y depende de la cuota de IA del mes. En julio de 2026 el tope del tenant (5 €) se
// agotó, DISA empezó a contestar "no he podido leerlo como una factura… límite de uso" (degradando
// con elegancia, que es lo correcto), y el gate reventaba leyendo un capture_url que ya no venía.
// Ahora, sin cuota, ABORTA de frente (código 2: "no he verificado NADA").
//
// Lo que NO necesita al modelo —las tres superficies de adjuntar de DISA, el aterrizaje precargado
// en la pantalla de revisión y la protección del archivo— vive en gate-disa-adjuntar.mjs, que sí
// entra en el barrido.
//
//   PART 1: POST /api/disa/attach con una imagen de factura → salida LITERAL del modelo,
//           reconocimiento (reply + capture_url) y confirm-first (NO escribe stock/compras).
//   FLUJO (navegador): abrir el widget de DISA → adjuntar la factura → DISA responde y
//           AUTONAVEGA a /admin/purchases/capture?attachment=ID YA PRECARGADA (Paso 2, sin
//           tocar el Paso 1) → confirmar compra directa → stock/WAC cuadran + adjunto enlazado.
//   ACCESO: el archivo del adjunto sin sesión → 401/403.
//
//   node scripts/gate-disa-captura-chat.mjs
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, requireLlmQuota } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB_PATH);
requireLlmQuota(db);   // sin cuota, DISA degrada y no devuelve capture_url: el gate no probaría NADA

const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

const SUPPLIER_ID = 1;   // Aromas del Sur SL (NIF 1111)
const VAINILLA_ID = 2;   // Vela Vainilla 200g (física)
const stockOf = id => db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(id);

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
    <div style="margin-top:18px"><strong>FACTURA</strong> Nº F-2026-0099 · Fecha: 11/06/2026</div>
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

async function makeImage() {
  const p = await browser.newPage();
  await p.setViewport({ width: 800, height: 700 });
  await p.setContent(invoiceHtml(), { waitUntil: 'networkidle0' });
  const png = Buffer.from(await p.screenshot({ type: 'png' }));
  await p.close();
  return png;
}

async function newAdminPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
  page.on('dialog', async d => { await d.accept(); });
  return page;
}

try {
  const png = await makeImage();
  ok(png.length > 1000, 'generada imagen de factura de prueba (' + png.length + 'B)');
  const tmpPng = '/tmp/disa-gate-factura.png';
  writeFileSync(tmpPng, png);

  // ════ PART 1 — LLAMADA REAL al modelo por el endpoint de DISA ════
  console.log('\nPART 1 · DISA /attach — extracción REAL + reconocimiento + confirm-first');
  const purchasesBefore = db.prepare('SELECT COUNT(*) c FROM purchases').get().c;
  const movsBefore = db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c;
  let captureUrl = null;
  {
    const blob = new Blob([png], { type: 'image/png' });
    const fd = new FormData();
    fd.append('file', blob, 'factura.png');
    const r = await fetch(BASE + '/api/disa/attach', { method: 'POST', headers: { 'Cookie': 'asess=' + token, 'x-csrf-token': csrf }, body: fd });
    const body = await r.json();
    console.log('  → status', r.status);
    console.log('  → reply LITERAL:', JSON.stringify(body.reply));
    console.log('  → capture_url:', JSON.stringify(body.capture_url));
    ok(r.status === 200, 'el endpoint responde 200');
    ok(typeof body.reply === 'string' && /factura/i.test(body.reply), 'DISA reconoce la factura en su respuesta');
    ok(typeof body.capture_url === 'string' && /\/admin\/purchases\/capture\?attachment=\d+/.test(body.capture_url), 'devuelve enlace a la revisión precargada');
    captureUrl = body.capture_url;
    // confirm-first: la extracción NO escribió stock ni compras (solo el adjunto).
    ok(db.prepare('SELECT COUNT(*) c FROM purchases').get().c === purchasesBefore, 'NO crea compras al adjuntar (confirm-first)');
    ok(db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c === movsBefore, 'NO mueve stock al adjuntar (confirm-first)');
    const attId = parseInt((captureUrl.match(/attachment=(\d+)/) || [])[1]);
    const att = db.prepare('SELECT extraction_json FROM attachments WHERE id=?').get(attId);
    ok(att && att.extraction_json, 'la lectura cruda quedó persistida en attachments.extraction_json');
  }

  // ════ PART 2 — Reconocimiento negativo: un archivo que NO es factura ════
  console.log('\nPART 2 · Archivo que no es factura → DISA no inventa');
  {
    const p2 = await browser.newPage();
    await p2.setContent('<html><body style="background:#fff;color:#000;font-size:40px;padding:60px">una foto cualquiera, sin datos de factura</body></html>', { waitUntil: 'networkidle0' });
    const junk = Buffer.from(await p2.screenshot({ type: 'png' }));
    await p2.close();
    const fd = new FormData(); fd.append('file', new Blob([junk], { type: 'image/png' }), 'foto.png');
    const r = await fetch(BASE + '/api/disa/attach', { method: 'POST', headers: { 'Cookie': 'asess=' + token, 'x-csrf-token': csrf }, body: fd });
    const body = await r.json();
    console.log('  → reply LITERAL:', JSON.stringify(body.reply));
    ok(r.status === 200 && !body.capture_url, 'sin factura → no devuelve capture_url (no lleva a revisión)');
    ok(typeof body.reply === 'string' && body.reply.length > 0, 'responde en el chat explicando que no es una factura');
  }

  // ════ FLUJO (navegador) — adjuntar en el chat → revisión precargada → confirmar ════
  console.log('\nFLUJO · Widget DISA → adjuntar → autonavegar a revisión precargada → confirmar');
  const vainillaBefore = stockOf(VAINILLA_ID);
  {
    const page = await newAdminPage();
    await page.goto(BASE + '/admin/inventory', { waitUntil: 'networkidle0' });
    // abrir el widget y adjuntar por el input real (#dpFile)
    await page.evaluate(() => window.disaOpen());
    await page.waitForSelector('#dpFile');
    const input = await page.$('#dpFile');
    await input.uploadFile(tmpPng);
    ok(true, 'archivo adjuntado en el widget de DISA (llamada real al modelo en curso…)');
    // el widget responde y AUTONAVEGA a la pantalla de revisión precargada
    await page.waitForFunction(() => location.pathname === '/admin/purchases/capture' && location.search.includes('attachment='), { timeout: 90000 });
    ok(true, 'DISA autonavega a /admin/purchases/capture?attachment=ID');
    // PRECARGA: arranca directamente en el Paso 2 (sin tocar el Paso 1)
    await page.waitForSelector('#step2', { visible: true, timeout: 15000 });
    ok(await page.$eval('#step1', el => getComputedStyle(el).display === 'none'), 'Paso 1 (subida) OCULTO — entró precargado');
    ok(await page.$eval('#step2', el => getComputedStyle(el).display !== 'none'), 'Paso 2 (revisión) VISIBLE');
    ok(await page.$('#docPreview img') !== null, 'documento (imagen) embebido en la revisión precargada');
    // proveedor cuadrado (Aromas del Sur por NIF) y al menos la línea de Vainilla cuadrada
    ok(await page.$$eval('#supplierBox .badge', els => els.some(e => /Cuadrado/i.test(e.textContent))), 'proveedor precuadrado (Aromas del Sur)');
    ok(await page.$$eval('#linesBody .badge', els => els.some(e => e.textContent.includes('✓'))), 'línea de Vainilla precuadrada con su producto');

    // Compra directa determinista: dejar SOLO la línea cuadrada (Vainilla 3 × 4), quitar la no cuadrada.
    await page.evaluate(() => {
      const keep = window.lines.find(l => l.product_mode === 'existing' && l.product_id);
      window.lines.slice().forEach(l => { if (!keep || l.uid !== keep.uid) window.lineRemove(l.uid); });
      const k = window.lines[0];
      window.lineSet(k.uid, 'quantity', '3');
      window.lineSet(k.uid, 'unit_cost', '4');
      if (!window.supplier || window.supplier.mode !== 'existing') window.pickSupplier(1, 'Aromas del Sur SL');
      if (window.target.mode !== 'direct') window.pickDest('direct', null);
    });
    await sleep(300);
    await page.click('#btnConfirm');
    await page.waitForNavigation({ timeout: 20000 }).catch(() => {});
    const url = page.url();
    ok(/\/admin\/purchases\/\d+$/.test(url), 'confirmar → ficha de la compra (' + url.split('/').pop() + ')');

    const purchaseId = parseInt(url.split('/').pop());
    const vainillaAfter = stockOf(VAINILLA_ID);
    ok(vainillaAfter.stock === vainillaBefore.stock + 3, 'stock de Vainilla +3 por el libro (' + vainillaBefore.stock + '→' + vainillaAfter.stock + ')');
    // WAC: media ponderada esperada con la entrada (3 × 4)
    const expWac = (vainillaBefore.stock * vainillaBefore.average_cost + 3 * 4) / (vainillaBefore.stock + 3);
    ok(Math.abs(vainillaAfter.average_cost - expWac) < 1e-6, 'WAC recalculado por el libro (≈' + expWac.toFixed(4) + ')');
    const att = db.prepare("SELECT * FROM attachments WHERE entity_type='purchase' AND entity_id=?").get(purchaseId);
    ok(!!att, 'adjunto enlazado a la compra (entity_type=purchase)');
    const fichaHtml = await page.content();
    ok(/Documento origen/.test(fichaHtml) && /capture\/file\//.test(fichaHtml), '"Documento origen" visible en la ficha');
    await page.close();
  }

  // ════ SUPERFICIES — el botón de adjuntar está en las 3 entradas de DISA ════
  console.log('\nSUPERFICIES · botón de adjuntar en widget, dashboard y asistente IA');
  {
    const p = await newAdminPage();
    // widget flotante (en páginas admin normales): #dpFile
    await p.goto(BASE + '/admin/inventory', { waitUntil: 'networkidle0' });
    ok(await p.$('#dpFile') !== null, 'widget flotante: input de adjuntar presente');
    // dashboard / pantalla principal: #dh-file
    await p.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
    ok(await p.$('#dh-file') !== null && await p.$('#dh-attach') !== null, 'dashboard: botón de adjuntar presente');
    // menú asistente IA: #disaFilePage
    await p.goto(BASE + '/admin/disa', { waitUntil: 'networkidle0' });
    ok(await p.$('#disaFilePage') !== null, 'asistente IA: botón de adjuntar presente');
    await p.close();
  }

  // ════ ACCESO — el archivo sin sesión → no público ════
  console.log('\nACCESO · archivo del adjunto protegido');
  {
    const attId = parseInt((captureUrl.match(/attachment=(\d+)/) || [])[1]);
    const r = await fetch(BASE + '/api/erp/purchases/capture/file/' + attId, { redirect: 'manual' });
    ok(r.status === 401 || r.status === 403 || r.status === 302, 'sin sesión → no sirve el archivo (status ' + r.status + ')');
  }
} catch (e) {
  console.error('GATE ERROR:', e);
  ok(false, 'el gate terminó sin excepción');
} finally {
  await browser.close();
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db.close();
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' OK, ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
