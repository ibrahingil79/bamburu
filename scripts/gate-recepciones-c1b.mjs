// Gate de navegador C1.b — flujo completo contra el servidor real (tenant
// desarrollo-bamburu): orden nueva → enviar → recepción PARCIAL (estado
// Parcialmente recibida) → segunda recepción que CIERRA (Recibida) → anular una
// recepción (orden reabierta + stock revertido). Verifica el cuadre del libro.
// OJO: crea una orden y dos recepciones de prueba en el tenant de desarrollo.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = '/home/ibrahin/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);
const PRODUCT_ID = 1;   // Vela Lavanda 200g (física)
const stockBefore = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(PRODUCT_ID);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

const dialogQueue = [];
page.on('dialog', async d => {
  const next = dialogQueue.shift();
  if (next === undefined) await d.accept();
  else await d.accept(typeof next === 'string' ? next : undefined);
});

try {
  // ── 1. Crear orden (vía API con la sesión) y enviarla ──
  const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
  const post = async (u, body) => (await fetch(BASE + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) })).json();
  const created = await post('/api/erp/purchase-orders', { supplier_id: 1, date: '2026-06-10', items: [{ product_id: PRODUCT_ID, quantity: 10, unit_cost: 2.5 }] });
  const sent = await post('/api/erp/purchase-orders/' + created.id + '/enviar');
  ok(/^OC-\d{4}$/.test(sent.order_number || ''), 'orden ' + sent.order_number + ' enviada');
  const oid = created.id;

  // ── 2. Ficha de la orden: tabla Pedido/Recibido/Pendiente + botón ──
  await page.goto(BASE + `/admin/purchase-orders/${oid}`, { waitUntil: 'networkidle0' });
  let body = await page.content();
  ok(body.includes('Recepción de mercancía') && body.includes('Pendiente'), 'ficha: bloque de recepción con Pedido/Recibido/Pendiente');
  ok(body.includes('Registrar recepción'), 'ficha: botón "Registrar recepción" (hay pendiente)');
  ok(body.includes('Sin recepciones todavía'), 'ficha: aún sin recepciones');
  await page.screenshot({ path: '/tmp/c1b-1-orden-enviada.png' });

  // ── 3. Recepción PARCIAL desde el formulario (4 de 10, coste real 3.00) ──
  await page.click(`a[href="/admin/purchase-orders/${oid}/receipts/new"]`);
  await page.waitForSelector('#rLines tr .r-qty');
  body = await page.content();
  ok(body.includes('Recibir ahora') && body.includes('Coste unit. real'), 'formulario de recepción carga');
  const prefill = await page.$eval('#rLines tr .r-qty', el => el.value);
  ok(prefill === '10', 'cantidad precargada con el pendiente (10)');
  await page.evaluate(() => {
    const r = document.querySelector('#rLines tr');
    r.querySelector('.r-qty').value = '4';
    r.querySelector('.r-cost').value = '3.00';
    r.querySelector('.r-qty').dispatchEvent(new Event('input'));
  });
  dialogQueue.push(undefined);   // confirm-first
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.evaluate(() => confirmReceipt())]);
  ok(page.url().includes('/admin/purchase-order-receipts/'), 'tras confirmar aterriza en la ficha de la recepción');
  body = await page.content();
  ok(body.includes('RC-') && body.includes('Confirmada'), 'ficha de recepción: RC-NNNN confirmada (solo lectura)');
  const receiptUrl1 = page.url();
  await page.screenshot({ path: '/tmp/c1b-2-recepcion-parcial.png' });

  // ── 4. La orden queda PARCIALMENTE RECIBIDA con pendiente 6 ──
  await page.goto(BASE + `/admin/purchase-orders/${oid}`, { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('Parcialmente recibida'), 'orden: estado Parcialmente recibida');
  ok(/>4<\/td>\s*<td[^>]*>6</.test(body.replace(/\n/g, '')) || (body.includes('>4</td>') && body.includes('>6</td>')), 'tabla: recibido 4 / pendiente 6');
  await page.screenshot({ path: '/tmp/c1b-3-parcial.png' });

  // ── 5. Segunda recepción (el resto) → orden RECIBIDA y sin botón ──
  await page.goto(BASE + `/admin/purchase-orders/${oid}/receipts/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#rLines tr .r-qty');
  const prefill2 = await page.$eval('#rLines tr .r-qty', el => el.value);
  ok(prefill2 === '6', 'segunda recepción: pendiente precargado (6)');
  dialogQueue.push(undefined);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.evaluate(() => confirmReceipt())]);
  const receiptUrl2 = page.url();
  await page.goto(BASE + `/admin/purchase-orders/${oid}`, { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('>Recibida<') || body.includes('status-recibida'), 'orden: estado RECIBIDA (cerrada sola)');
  ok(!body.includes('Registrar recepción'), 'sin pendiente → sin botón de registrar');
  ok(!body.includes('Anular y rehacer'), 'con recepciones confirmadas no se ofrece anular la orden');
  await page.screenshot({ path: '/tmp/c1b-4-recibida.png' });

  // ── 6. Lista: estado combinado ──
  await page.goto(BASE + '/admin/purchase-orders?estado=recibida', { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes(sent.order_number), 'lista filtrada por Recibidas muestra la orden');

  // ── 7. Anular la 2ª recepción → orden reabierta (parcial) y stock revertido ──
  await page.goto(receiptUrl2, { waitUntil: 'networkidle0' });
  dialogQueue.push('bultos dañados en el transporte');   // prompt del motivo
  await page.evaluate(() => anularRecepcion());
  await page.waitForFunction(() => document.body.innerHTML.includes('Recepción anulada'), { timeout: 10000 });
  body = await page.content();
  ok(body.includes('bultos dañados en el transporte'), 'ficha de recepción: anulada con su motivo');
  await page.screenshot({ path: '/tmp/c1b-5-recepcion-anulada.png' });

  await page.goto(BASE + `/admin/purchase-orders/${oid}`, { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('Parcialmente recibida'), 'orden REABIERTA a Parcialmente recibida');
  ok(body.includes('Registrar recepción'), 'vuelve el botón de registrar (pendiente > 0)');
  await page.screenshot({ path: '/tmp/c1b-6-reabierta.png' });

} finally {
  await browser.close();
  // ── Cuadre en BD: caché == libro; delta de stock = 4 (10 entradas − 6 revertidas) ──
  const db2 = new Database(DB_PATH);
  const after = db2.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(PRODUCT_ID);
  const libro = db2.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(PRODUCT_ID).s;
  ok(after.stock === libro, `caché products.stock (${after.stock}) == suma del libro (${libro})`);
  ok(after.stock === stockBefore.stock + 4, `delta de stock = +4 (antes ${stockBefore.stock} → ${after.stock})`);
  const movs = db2.prepare("SELECT type, quantity, unit_cost FROM stock_movements WHERE origin_type='po_receipt' ORDER BY id").all();
  console.log('  movimientos po_receipt:', JSON.stringify(movs));
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador C1.b: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
