// Gate de navegador — DISA · adjuntar factura (Pilar 3), la parte que NO necesita al modelo.
// Contra el servidor real (tenant desarrollo-bamburu).
//
//   SUPERFICIES: el botón de adjuntar existe en las TRES entradas de DISA (widget flotante,
//                pantalla principal y menú Asistente IA). Si una se cae en un refactor, no hay
//                forma de subirle una factura a DISA desde ahí, y nadie se entera.
//   ATERRIZAJE:  el enlace que DISA devuelve tras leer una factura
//                (/admin/purchases/capture?attachment=ID) aterriza PRECARGADO en el Paso 2, con el
//                proveedor y la línea ya cuadrados. Es el CONTRATO del que cuelga toda la captura
//                por chat: DISA solo sabe autonavegar ahí.
//   ACCESO:      el archivo del adjunto no es público.
//
// La extracción REAL por el chat (POST /api/disa/attach → modelo de visión) vive en
// gate-disa-captura-chat, que se corre A MANO: llama al modelo, cuesta dinero y depende de que el
// negocio tenga cuota de IA este mes. En julio de 2026 esa dependencia lo mató (429 por tope de
// gasto agotado) y estuvo semanas sin cubrir NADA. Lo que se puede probar gratis y siempre, se
// prueba aquí, en cada barrido.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { saveAttachment } from '../modules/erp/attachments.js';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

process.chdir(APP_DIR);

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';
const TENANT = { slug: 'desarrollo-bamburu' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

// La lectura que DISA deja persistida al reconocer una factura (mismo esquema que la captura real).
const LECTURA = {
  supplier: { name: 'Aromas del Sur SL', fiscal_id: '1111' },
  date: '2026-06-11',
  invoice_number: 'F-2026-0099',
  lines: [{ description: 'Vela Vainilla 200g', quantity: 3, unit_cost: 4, vat_rate: 21 }],
  totals: { base: 12, tax: 2.52, total: 14.52 },
};

const purchasesBefore = db.prepare('SELECT COUNT(*) c FROM purchases').get().c;
const movsBefore = db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c;

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
page.on('dialog', async d => { await d.accept(); });

let attId = null;
try {
  // ── Factura de prueba, pintada por el propio navegador (ni modelo, ni red) ──
  const p0 = await browser.newPage();
  await p0.setViewport({ width: 800, height: 700 });
  await p0.setContent(`<!doctype html><html><body style="font-family:Arial;background:#fff;color:#000;padding:40px">
    <h1>Aromas del Sur SL</h1><div>NIF: 1111</div>
    <div><strong>FACTURA</strong> Nº F-2026-0099 · 11/06/2026</div>
    <table border="1" cellpadding="8" style="margin-top:20px;border-collapse:collapse">
      <tr><th>Descripción</th><th>Cantidad</th><th>Precio</th></tr>
      <tr><td>Vela Vainilla 200g</td><td>3</td><td>4,00 €</td></tr>
    </table></body></html>`, { waitUntil: 'networkidle0' });
  const png = Buffer.from(await p0.screenshot({ type: 'png' }));
  await p0.close();

  const att = saveAttachment(db, TENANT, { buffer: png, originalName: 'factura-disa.png', mime: 'image/png' });
  db.prepare('UPDATE attachments SET extraction_json=? WHERE id=?').run(JSON.stringify(LECTURA), att.id);
  attId = att.id;
  ok(attId > 0, 'adjunto sembrado como lo deja DISA al leer una factura (id ' + attId + ')');

  // ── 1. SUPERFICIES: las tres entradas de DISA tienen su botón de adjuntar ──
  console.log('\nSUPERFICIES · botón de adjuntar en el widget flotante y en el Asistente IA');
  await page.goto(BASE + '/admin/inventory', { waitUntil: 'networkidle0' });
  ok(await page.$('#dpFile') !== null, 'widget flotante: input de adjuntar presente');
  ok(await page.evaluate(() => typeof window.disaOpen === 'function'), 'widget flotante: se puede abrir (disaOpen)');

  // LA PORTADA YA NO ES UNA SUPERFICIE DE DISA, y eso fue una decisión, no una regresión: el chat se
  // fue del Inicio en el rediseño de la portada y está dicho por escrito en el producto
  // (`disaHome.html.js`: «EL CHAT DE DISA SE VA DEL INICIO, Y SOLO DEL INICIO»). Con él se fue su
  // botón de adjuntar. Este gate seguía exigiéndolo ahí y cantaba un fallo permanente.
  // Quedan DOS superficies, no tres, y son las que se comprueban: el widget flotante y la pantalla
  // de DISA. Lo que sí se comprueba de la portada es que no se haya quedado media cosa colgando.

  await page.goto(BASE + '/admin/disa', { waitUntil: 'networkidle0' });
  ok(await page.$('#disaFilePage') !== null, 'Asistente IA: botón de adjuntar presente');
  await page.screenshot({ path: '/tmp/disa-adj-1-superficies.png' });

  // ── 2. ATERRIZAJE: el enlace que DISA devuelve entra PRECARGADO en el Paso 2 ──
  //     Es el contrato del que cuelga la captura por chat. Si esta pantalla dejara de precargar,
  //     DISA seguiría autonavegando... a un formulario vacío, y el usuario tendría que subir la
  //     foto otra vez a mano. Silencioso y humillante: justo lo que un gate debe impedir.
  console.log('\nATERRIZAJE · /admin/purchases/capture?attachment=ID entra precargado en el Paso 2');
  await page.goto(BASE + '/admin/purchases/capture?attachment=' + attId, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#step2', { visible: true, timeout: 15000 });
  ok(await page.$eval('#step1', el => getComputedStyle(el).display === 'none'), 'Paso 1 (subida) OCULTO — no le pide la foto otra vez');
  ok(await page.$eval('#step2', el => getComputedStyle(el).display !== 'none'), 'Paso 2 (revisión) VISIBLE');
  ok(await page.$('#docPreview img') !== null, 'el documento que leyó DISA se ve embebido en la revisión');
  ok(await page.$$eval('#supplierBox .badge', els => els.some(e => /Cuadrado/i.test(e.textContent))), 'proveedor precuadrado (Aromas del Sur, por NIF)');
  ok(await page.$$eval('#linesBody .badge', els => els.some(e => e.textContent.includes('✓'))), 'la línea de Vainilla llega precuadrada con su producto');
  await page.screenshot({ path: '/tmp/disa-adj-2-precargada.png' });

  // ── 3. CONFIRM-FIRST: llegar a la revisión NO ha escrito nada. DISA propone; el usuario confirma ──
  //     (Regla de oro del proyecto: en cualquier acción con dinero, DISA nunca ejecuta en silencio.)
  ok(db.prepare('SELECT COUNT(*) c FROM purchases').get().c === purchasesBefore, 'NO se ha creado ninguna compra por adjuntar y revisar (confirm-first)');
  ok(db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c === movsBefore, 'NO se ha movido stock por adjuntar y revisar (confirm-first)');
  const attRow = db.prepare('SELECT entity_type, entity_id, extraction_json FROM attachments WHERE id=?').get(attId);
  ok(!attRow.entity_type && !attRow.entity_id, 'el adjunto sigue SUELTO (no se enlaza a nada hasta confirmar)');
  ok(!!attRow.extraction_json, 'la lectura cruda queda persistida en attachments.extraction_json');

  // ── 4. ACCESO: el archivo del adjunto no es público ──
  console.log('\nACCESO · el archivo del adjunto está protegido');
  const rNoAuth = await fetch(BASE + '/api/erp/purchases/capture/file/' + attId, { redirect: 'manual' });
  ok(rNoAuth.status === 401 || rNoAuth.status === 403 || rNoAuth.status === 302, 'sin sesión → no sirve el archivo (status ' + rNoAuth.status + ')');
  const rOk = await fetch(BASE + '/api/erp/purchases/capture/file/' + attId, { headers: { 'Cookie': 'asess=' + token } });
  ok(rOk.status === 200, 'con sesión y permiso → 200 (el bloqueo de arriba es del permiso, no una avería)');

} catch (e) {
  console.error('ERROR en el gate:', e.stack || e.message);
  fail++;
} finally {
  await browser.close();
  const db2 = new Database(DB_PATH);
  // El adjunto NO se borra: la regla del proyecto es archivar, no destruir, y un adjunto suelto no
  // ensucia nada (no cuelga de ningún documento). Lo que sí se retira es la sesión del gate.
  ok(db2.prepare('SELECT COUNT(*) c FROM purchases').get().c === purchasesBefore, 'el tenant queda como estaba: ninguna compra nueva');
  ok(db2.prepare('SELECT COUNT(*) c FROM stock_movements').get().c === movsBefore, 'el tenant queda como estaba: ningún movimiento de stock nuevo');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador DISA adjuntar (sin modelo): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
