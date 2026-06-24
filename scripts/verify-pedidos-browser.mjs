// Parte C (navegador, servidor real, tenant desarrollo): flujo del PEDIDO + RESERVA.
//   node scripts/verify-pedidos-browser.mjs
// crear borrador → confirmar (PED-NNNN + reserva) → comprobar reservado/disponible en la API
// e inventario → anular (reserva liberada) → "Crear pedido" desde un presupuesto.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
const PROD_NAME = 'Aceite Lavanda 30ml', PROD_ID = 6;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB);
const token = randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, randomBytes(8).toString('hex'));
db.close();

// reservado de un producto (lectura directa, para contrastar con la UI/API)
const reservedNow = (pid) => { const d = new Database(DB, { readonly: true }); const r = d.prepare("SELECT COALESCE(SUM(oi.quantity),0) r FROM customer_order_items oi JOIN customer_orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.status='confirmado'").get(pid).r; d.close(); return r; };

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });
page.on('dialog', async d => { await d.accept(d.type() === 'prompt' ? 'Anulación de prueba (verificación)' : undefined); });

let pedidoId = null;
try {
  console.log('\n=== Pedido — Parte C (navegador) ===\n');
  // Warm-up: la migración del tenant es lazy (corre al primer request tras reiniciar). Visitar
  // el listado la dispara y crea customer_orders/customer_order_items en el tenant de desarrollo.
  await page.goto(ORIGIN + '/admin/pedidos', { waitUntil: 'networkidle0' });
  const reservedBefore = reservedNow(PROD_ID);

  // 1) Crear borrador de pedido
  await page.goto(ORIGIN + '/admin/pedidos/new', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#f-client');
  await sleep(800);                              // carga de clientes + catálogo
  ok(await page.$('#f-warehouse') !== null, 'el formulario de pedido tiene selector de almacén (de dónde sale la reserva)');
  await page.select('#f-client', '1');           // María García López
  await page.click('.line-desc');
  await page.type('.line-desc', 'Aceite Lav', { delay: 25 });
  await page.waitForFunction(() => { const b = document.querySelector('.line-suggest'); return b && b.style.display !== 'none' && b.querySelector('.suggest-item'); }, { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.line-suggest .suggest-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await sleep(300);
  await page.evaluate(() => { const q = document.querySelector('.line-qty'); q.value = '5'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(400);
  await Promise.all([ page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#btn-save') ]);
  const pedUrl = page.url();
  pedidoId = pedUrl.match(/\/pedidos\/(\d+)/)?.[1];
  ok(!!pedidoId, 'borrador de pedido guardado → ' + pedUrl);
  let body = await page.evaluate(() => document.body.innerText);
  ok(/Borrador/.test(body) && /Confirmar pedido/.test(body), 'la vista muestra Borrador + botón "Confirmar pedido"');
  ok(reservedNow(PROD_ID) === reservedBefore, 'el borrador NO reserva todavía (reservado sin cambios)');

  // 2) Confirmar → PED-NNNN + reserva
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Confirmar pedido/.test(x.textContent)); b.click(); });
  await sleep(1500);
  await page.waitForFunction(() => /PED-\d{4}/.test(document.body.innerText), { timeout: 8000 });
  body = await page.evaluate(() => document.body.innerText);
  const pedNum = body.match(/PED-\d{4}/)?.[0];
  ok(!!pedNum && /Confirmado/.test(body), 'confirmado → número ' + pedNum + ' visible + estado Confirmado');
  ok(/reserva stock/i.test(body), 'la vista del pedido confirmado indica que RESERVA stock');
  ok(reservedNow(PROD_ID) === reservedBefore + 5, 'al confirmar, el reservado del producto sube en 5 (capa derivada)');

  // 3) La API de productos refleja reservado/disponible (alimenta inventario, TPV y factura)
  const apiProd = await page.evaluate(async (pid) => { const r = await fetch('/api/erp/products'); const all = await r.json(); return (all || []).find(p => p.id === pid); }, PROD_ID);
  ok(apiProd && apiProd.reserved >= 5 && apiProd.available === apiProd.stock - apiProd.reserved,
     'API /products expone reserved=' + (apiProd && apiProd.reserved) + ' y available=stock−reserved=' + (apiProd && apiProd.available));

  // 4) Inventario muestra columnas Reservado / Disponible
  await page.goto(ORIGIN + '/admin/inventory', { waitUntil: 'networkidle0' });
  await sleep(900);
  const headers = await page.$$eval('table thead th', ths => ths.map(t => t.textContent.trim()));
  ok(headers.includes('Reservado') && headers.includes('Disponible'), 'la pantalla de Inventario muestra columnas Reservado y Disponible (cabeceras: ' + headers.join(',') + ')');
  await page.screenshot({ path: '/home/ubuntu/pedido-inventory.png' });

  // 5) Anular el pedido → reserva liberada
  await page.goto(ORIGIN + '/admin/pedidos/' + pedidoId, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Anular'); b.click(); });
  await sleep(1500);
  body = await page.evaluate(() => document.body.innerText);
  ok(/Pedido anulado/i.test(body) && /reserva quedó liberada/i.test(body), 'anular → "Pedido anulado" + "reserva quedó liberada"');
  ok(reservedNow(PROD_ID) === reservedBefore, 'tras anular, el reservado vuelve a su valor inicial (reserva liberada)');

  // 6) "Crear pedido" desde un presupuesto (motor de conversión)
  await page.goto(ORIGIN + '/admin/quotes/new', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#f-client'); await sleep(800);
  await page.select('#f-client', '1');
  await page.click('.line-desc'); await page.type('.line-desc', 'Aceite Lav', { delay: 25 });
  await page.waitForFunction(() => { const b = document.querySelector('.line-suggest'); return b && b.style.display !== 'none' && b.querySelector('.suggest-item'); }, { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.line-suggest .suggest-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await sleep(300);
  await Promise.all([ page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#btn-save') ]);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Emitir presupuesto/.test(x.textContent)); b.click(); });
  await sleep(1500);
  await page.waitForFunction(() => /Crear pedido/.test(document.body.innerText), { timeout: 8000 });
  ok(true, 'un presupuesto emitido muestra el botón "Crear pedido" (siguiente paso visible)');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Crear pedido'); b.click(); });
  await page.waitForFunction(() => /\/admin\/pedidos\/\d+/.test(location.href), { timeout: 9000 });
  body = await page.evaluate(() => document.body.innerText);
  ok(/\/admin\/pedidos\/\d+/.test(page.url()) && /Procede del presupuesto/.test(body), 'crear pedido desde presupuesto → navega al pedido (borrador) "Procede del presupuesto"');
  // limpiar: este pedido es borrador, no reserva nada
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  await browser.close();
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO PARTE C: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
