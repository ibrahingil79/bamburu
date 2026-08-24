// Parte C (navegador, servidor real): flujo del PEDIDO + RESERVA.
//   node scripts/verify-pedidos-browser.mjs
// crear borrador → confirmar (PED-NNNN + reserva) → comprobar reservado/disponible en la API
// e inventario → anular (reserva liberada) → "Crear pedido" desde un presupuesto.
//
// ⚙️ SE TRAE SU PROPIO NEGOCIO (24 ago 2026). Antes daba por sentado el producto «Aceite Lavanda
// 30ml» (id 6) del negocio de desarrollo. Ese producto cambió y la comprobación se quedó en 1
// aserción. Y sembrarlo allí no valía: este flujo acaba emitiendo, y una factura emitida entra en la
// cadena de VERI*FACTU y no se borra. Con su propio negocio, todo nace y muere aquí dentro.
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer';
import { negocioDesechable, sembrarFlujoDocumentos } from './lib/negocio-desechable.mjs';
import { autoAceptarPaneles } from './lib/gate-env.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const neg = await negocioDesechable('Gate Pedidos');
const ORIGIN = neg.base;
let PROD_ID, PROD_NAME, token;
try {
  const semilla = sembrarFlujoDocumentos(neg.db, { stock: 20, precio: 30 });
  PROD_ID = semilla.productoId;
  PROD_NAME = neg.db.prepare('SELECT name FROM products WHERE id=?').get(PROD_ID).name;
  token = neg.sesion();
} catch (e) {
  console.error('✗ No se pudo sembrar: ' + e.message); neg.tirar(); process.exit(1);
}

// reservado de un producto (lectura directa, para contrastar con la UI/API)
const reservedNow = (pid) => { const d = new Database(neg.abs, { readonly: true }); const r = d.prepare("SELECT COALESCE(SUM(oi.quantity),0) r FROM customer_order_items oi JOIN customer_orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.status='confirmado'").get(pid).r; d.close(); return r; };

// 24 ago 2026 · SIN perfil fijo, A PROPOSITO. Uno fijo hace que dos comprobaciones a la vez se maten con
// «The browser is already running» — mensaje enganoso: puppeteer lo lanza en cuanto Chromium dice «Failed
// to create a ProcessSingleton», y el snap no puede poner su cerrojo ahi. Sin la opcion, puppeteer levanta
// un perfil temporal unico por arranque, que ademas evita que dos pestanas compartan cookies.
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: new URL(ORIGIN).hostname, path: '/' });
// El producto ya no usa ventanitas del navegador: los paneles se aceptan desde la página.
await autoAceptarPaneles(page);

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
  // El cliente y el producto son los que sembró ESTA comprobación, no los que hubiera en el negocio
  // de otro: se leen de la semilla en vez de escribirlos a mano.
  await page.select('#f-client', String(neg.db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get().id));
  await page.click('.line-desc');
  await page.type('.line-desc', PROD_NAME.slice(0, 10), { delay: 25 });
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
  // El motivo va a la cola DESPUÉS de estar en la página: la cola vive en ella y al navegar se rehace.
  await page.evaluate(v => window.__pdCola.push(v), 'Anulación de prueba (verificación)');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Anular'); b.click(); });
  await sleep(1500);
  body = await page.evaluate(() => document.body.innerText);
  ok(/Pedido anulado/i.test(body) && /reserva quedó liberada/i.test(body), 'anular → "Pedido anulado" + "reserva quedó liberada"');
  ok(reservedNow(PROD_ID) === reservedBefore, 'tras anular, el reservado vuelve a su valor inicial (reserva liberada)');

  // 6) "Crear pedido" desde un presupuesto (motor de conversión)
  await page.goto(ORIGIN + '/admin/quotes/new', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#f-client'); await sleep(800);
  await page.select('#f-client', String(neg.db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get().id));
  await page.click('.line-desc'); await page.type('.line-desc', PROD_NAME.slice(0, 10), { delay: 25 });
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
  try { await browser.close(); } catch (_) {}
  neg.tirar();
  console.log('  [limpieza] negocio de prueba «' + neg.slug + '» tirado entero');
}
console.log('\n=== RESULTADO PARTE C: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
