// Parte navegador (Puppeteer headless, servidor real) — PIEZA 2b:
//   node scripts/verify-albaranes-browser.mjs
// pedido → albarán parcial (6) → segundo albarán que cierra (4) → factura desde albarán →
// anular albarán re-reserva.
//
// ⚙️ SE TRAE SU PROPIO NEGOCIO (24 ago 2026). Antes esperaba encontrar «PED-0006 confirmado (Aceite
// Lavanda ×10)» sembrado a mano en el negocio de desarrollo. Ese pedido dejó de existir y la
// comprobación llevaba meses en rojo — 0 aserciones, ni siquiera empezaba.
// Sembrarlo otra vez allí no valía: este flujo EMITE UNA FACTURA, y una factura emitida entra en la
// cadena de VERI*FACTU y **ya no se puede borrar**. Cada pasada dejaría residuo imborrable en los
// datos del dueño; hoy mismo eso costó 19 facturas por 523.002,90 €.
// Con su propio negocio, la factura nace y muere aquí dentro: no se borra ninguna factura ni se toca
// ninguna cadena — se tira el negocio entero, que nunca fue real.
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer';
import { negocioDesechable, sembrarFlujoDocumentos } from './lib/negocio-desechable.mjs';
import { autoAceptarPaneles } from './lib/gate-env.mjs';
import { createPedidoSvc, confirmPedidoSvc } from '../modules/erp/routes/pedidos.js';
// 24 ago 2026 · Perfil ÚNICO por arranque y borrado al salir, aunque esto reviente. Ni perfil fijo
// (dos a la vez se matan) ni sin perfil (el temporal de puppeteer no se limpia si hay crash, y eso
// llenó el disco y tiró el servidor el 22 ago). Ver scripts/lib/perfil-chromium.mjs.
import { perfilDesechable } from './lib/perfil-chromium.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const neg = await negocioDesechable('Gate Albaranes');
const ORIGIN = neg.base;
const db = neg.db;

// EL PEDIDO CONFIRMADO, sembrado aquí: 10 unidades de un producto físico con stock de 20.
// La siembra va dentro de su propio try: si algo falla ANTES del bloque de abajo, el negocio se
// tira igual. Un fallo al sembrar no puede dejar un negocio suelto en disco.
let semilla, PROD_ID, order, token;
try {
  semilla = sembrarFlujoDocumentos(db, { stock: 20, precio: 30 });
  PROD_ID = semilla.productoId;
  // createPedidoSvc devuelve el ID, no un objeto.
  const pedidoId = createPedidoSvc(db, { client_id: semilla.clienteId, warehouse_id: semilla.almacenId,
    lines: [{ product_id: PROD_ID, quantity: 10, unit_price: semilla.precio, tax_rate: 21 }] });
  confirmPedidoSvc(db, pedidoId);
  order = db.prepare('SELECT id, order_number, warehouse_id FROM customer_orders WHERE id=?').get(pedidoId);
  token = neg.sesion();
} catch (e) {
  console.error('✗ No se pudo sembrar el pedido de prueba: ' + e.message);
  neg.tirar();
  process.exit(1);
}

const stockWh = (pid, wid) => { const d = new Database(neg.abs, { readonly: true }); const s = d.prepare('SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE product_id=? AND warehouse_id=?').get(pid, wid).q; d.close(); return s; };
const reserved = (pid) => { const d = new Database(neg.abs, { readonly: true }); const r = d.prepare(`SELECT COALESCE(SUM(MAX(oi.quantity-COALESCE(x.e,0),0)),0) r FROM customer_order_items oi JOIN customer_orders o ON o.id=oi.order_id LEFT JOIN (SELECT di.order_item_id, SUM(di.quantity) e FROM delivery_note_items di JOIN delivery_notes dn ON dn.id=di.delivery_note_id WHERE dn.status='confirmado' GROUP BY di.order_item_id) x ON x.order_item_id=oi.id WHERE oi.product_id=? AND o.status='confirmado'`).get(pid).r; d.close(); return r; };

const browser = await puppeteer.launch({ userDataDir: perfilDesechable('verify-albaranes-browser'),  headless: 'new', executablePath: '/snap/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: new URL(ORIGIN).hostname, path: '/' });
// ⚙️ 24 ago 2026 · EL PRODUCTO YA NO USA VENTANITAS DEL NAVEGADOR. Aquí había un `page.on('dialog')`
// esperando un confirm() que dejó de existir cuando se migraron las 80 al panel de la casa: el botón
// «Facturar este albarán» abría el panel, nadie lo aceptaba, y la comprobación moría por tiempo sin
// decir por qué. `autoAceptarPaneles` acepta los paneles y deja empujar el texto de los que piden un
// dato — como el motivo de anular, que el producto exige.
await autoAceptarPaneles(page);

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
  const hayBoton = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Facturar este albarán/.test(x.textContent));
    if (b) { b.click(); return true; } return false;
  });
  ok(hayBoton, 'el albarán confirmado ofrece "Facturar este albarán"');
  // Si no navega, se dice QUÉ se ve en pantalla en vez de morir por tiempo sin explicar nada.
  await page.waitForFunction(() => /\/admin\/invoices\/\d+/.test(location.href), { timeout: 9000 })
    .catch(async () => {
      const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200));
      console.error('    (no navegó a la factura · lo que se ve: ' + txt + ')');
    });
  ok(/\/admin\/invoices\/\d+/.test(page.url()), 'factura desde albarán → navega a la factura ' + page.url());
  body = await page.evaluate(() => document.body.innerText);
  ok(/Procede del albarán/.test(body), 'la factura indica "Procede del albarán"');

  // 6) Anular el SEGUNDO albarán (no facturado) → re-entra stock y re-reserva
  await page.goto(ORIGIN + '/admin/albaranes/' + alb2Id, { waitUntil: 'networkidle0' });
  // EL MOTIVO SE EMPUJA DESPUÉS DE NAVEGAR, no antes: la cola vive en la página, y al navegar la
  // página se rehace y la cola vuelve a nacer vacía. Empujarlo antes es empujarlo al vacío.
  await page.evaluate(v => window.__pdCola.push(v), 'Anulación de prueba (verificación 2b)');
  const stockBeforeCancel = stockWh(PROD_ID, wid), resvBeforeCancel = reserved(PROD_ID);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Anular'); b && b.click(); });
  await page.waitForFunction(() => !document.querySelector('.modal-overlay.open'), { timeout: 6000 }).catch(() => {});
  await sleep(1200);
  ok(stockWh(PROD_ID, wid) === stockBeforeCancel + 4, 'anular 2º albarán: re-entra stock (+4)');
  ok(reserved(PROD_ID) === resvBeforeCancel + 4, 'anular RE-RESERVA: +4 vuelven a reservar');
  body = await page.evaluate(() => document.body.innerText);
  ok(/Albarán anulado/i.test(body), 'el albarán anulado lo refleja');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  try { await browser.close(); } catch (_) {}
  // SE TIRA EL NEGOCIO ENTERO. Con él se va la factura que este flujo emite — que no se podría
  // borrar de otra forma — y todo lo sembrado. No queda nada en los datos del dueño.
  neg.tirar();
  console.log('  [limpieza] negocio de prueba «' + neg.slug + '» tirado entero');
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
