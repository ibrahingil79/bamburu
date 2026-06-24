// Parte navegador (Puppeteer headless, tenant desarrollo, servidor real) — PIEZA 2b:
//   node scripts/verify-albaranes-browser.mjs
// pedido → albarán parcial (6) → segundo albarán que cierra (4) → factura desde albarán →
// anular albarán re-reserva. Estado dev preparado: PED-0006 confirmado (Aceite Lavanda ×10).
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
const PROD_ID = 6;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB);
const order = db.prepare("SELECT id, order_number, warehouse_id FROM customer_orders WHERE status='confirmado' AND id IN (SELECT order_id FROM customer_order_items WHERE product_id=?) ORDER BY id DESC LIMIT 1").get(PROD_ID);
const token = randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, randomBytes(8).toString('hex'));
db.close();

const stockWh = (pid, wid) => { const d = new Database(DB, { readonly: true }); const s = d.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=? AND warehouse_id=?').get(pid, wid).s; d.close(); return s; };
const reserved = (pid) => { const d = new Database(DB, { readonly: true }); const r = d.prepare(`SELECT COALESCE(SUM(MAX(oi.quantity-COALESCE(x.e,0),0)),0) r FROM customer_order_items oi JOIN customer_orders o ON o.id=oi.order_id LEFT JOIN (SELECT di.order_item_id, SUM(di.quantity) e FROM delivery_note_items di JOIN delivery_notes dn ON dn.id=di.delivery_note_id WHERE dn.status='confirmado' GROUP BY di.order_item_id) x ON x.order_item_id=oi.id WHERE oi.product_id=? AND o.status='confirmado'`).get(pid).r; d.close(); return r; };

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });
page.on('dialog', async d => { await d.accept(d.type() === 'prompt' ? 'Anulación de prueba (verificación 2b)' : undefined); });

try {
  console.log('\n=== Albarán — navegador (cierra la cadena) ===\n');
  if (!order) { ok(false, 'no hay pedido confirmado de prueba'); throw new Error('sin pedido'); }
  const wid = order.warehouse_id;
  const stock0 = stockWh(PROD_ID, wid), resv0 = reserved(PROD_ID);
  console.log('  Pedido ' + order.order_number + ' · stock inicial ' + stock0 + ' · reservado ' + resv0 + '\n');

  // 1) Desde el pedido: botón "Crear albarán"
  await page.goto(ORIGIN + '/admin/pedidos/' + order.id, { waitUntil: 'networkidle0' });
  let body = await page.evaluate(() => document.body.innerText);
  ok(/Crear albarán/.test(body), 'el pedido confirmado ofrece "Crear albarán (entregar)"');

  // 2) Albarán parcial: entregar 6
  await page.goto(ORIGIN + '/admin/albaranes/new?order=' + order.id, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#lines-body .q'); await sleep(300);
  await page.evaluate(() => { const i = document.querySelector('#lines-body .q'); i.value = '6'; });
  await Promise.all([ page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#btn-save') ]);
  const alb1Url = page.url();
  const alb1Id = alb1Url.match(/\/albaranes\/(\d+)/)?.[1];
  ok(!!alb1Id, 'albarán parcial confirmado → ' + alb1Url);
  body = await page.evaluate(() => document.body.innerText);
  ok(/DEL-\d{4}/.test(body) && /Confirmado/.test(body), 'el albarán muestra número DEL-NNNN + Confirmado');
  ok(stockWh(PROD_ID, wid) === stock0 - 6, 'CONFIRMAR SACA STOCK: ' + stock0 + ' − 6 = ' + (stock0 - 6));
  ok(reserved(PROD_ID) === resv0 - 6, 'CONSUME RESERVA: reservado ' + resv0 + ' − 6 = ' + (resv0 - 6));

  // 3) El pedido muestra parcialmente entregado (6/4)
  await page.goto(ORIGIN + '/admin/pedidos/' + order.id, { waitUntil: 'networkidle0' });
  await sleep(300);
  body = await page.evaluate(() => document.body.innerText);
  ok(/parcialmente entregado/i.test(body), 'el pedido pasa a "parcialmente entregado" y muestra la tabla de entrega');

  // 4) Segundo albarán cierra el pedido (entregar lo pendiente, 4)
  await page.goto(ORIGIN + '/admin/albaranes/new?order=' + order.id, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#lines-body .q'); await sleep(300);
  await Promise.all([ page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#btn-save') ]);   // valor por defecto = pendiente (4)
  const alb2Id = page.url().match(/\/albaranes\/(\d+)/)?.[1];
  ok(!!alb2Id && alb2Id !== alb1Id, 'segundo albarán confirmado (' + alb2Id + ')');
  ok(stockWh(PROD_ID, wid) === stock0 - 10 && reserved(PROD_ID) === resv0 - 10, 'tras 6+4: stock −10, reserva consumida del todo (−10)');
  await page.goto(ORIGIN + '/admin/pedidos/' + order.id, { waitUntil: 'networkidle0' });
  body = await page.evaluate(() => document.body.innerText);
  ok(/completamente entregado/i.test(body), 'el pedido pasa a "completamente entregado" (6+4 cierra)');

  // 5) Facturar desde el primer albarán
  await page.goto(ORIGIN + '/admin/albaranes/' + alb1Id, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Facturar este albarán/.test(x.textContent)); b && b.click(); });
  await page.waitForFunction(() => /\/admin\/invoices\/\d+/.test(location.href), { timeout: 9000 });
  ok(/\/admin\/invoices\/\d+/.test(page.url()), 'factura desde albarán → navega a la factura ' + page.url());
  body = await page.evaluate(() => document.body.innerText);
  ok(/Procede del albarán/.test(body), 'la factura indica "Procede del albarán"');

  // 6) Anular el SEGUNDO albarán (no facturado) → re-entra stock y re-reserva
  await page.goto(ORIGIN + '/admin/albaranes/' + alb2Id, { waitUntil: 'networkidle0' });
  const stockBeforeCancel = stockWh(PROD_ID, wid), resvBeforeCancel = reserved(PROD_ID);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Anular'); b && b.click(); });
  await sleep(1500);
  ok(stockWh(PROD_ID, wid) === stockBeforeCancel + 4, 'anular 2º albarán: re-entra stock (+4)');
  ok(reserved(PROD_ID) === resvBeforeCancel + 4, 'anular RE-RESERVA: +4 vuelven a reservar');
  body = await page.evaluate(() => document.body.innerText);
  ok(/Albarán anulado/i.test(body), 'el albarán anulado lo refleja');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  await browser.close();
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
