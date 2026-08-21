// Gate de navegador C1.b — flujo completo contra el servidor real (tenant desarrollo-bamburu):
// orden nueva → enviar → recepción PARCIAL (estado Parcialmente recibida) → segunda recepción que
// CIERRA (Recibida) → anular una recepción (orden reabierta + stock revertido). Verifica el cuadre
// del libro. Y, desde el multi-almacén, el GUARDIÁN DE TRASLADOS: una recepción cuyo stock ya se
// trasladó a otro almacén NO se puede anular (dejaría el almacén de origen en negativo).
//
// POR QUÉ ESTE GATE TRAE SU PROPIO PRODUCTO. Antes compraba y anulaba sobre el producto 1 del
// tenant. Cuando llegó el multi-almacén, el producto 1 ya tenía traslados confirmados fuera del
// almacén principal → el motor empezó a bloquear la anulación con un 409 (y hace BIEN), y el gate
// murió. El gate no mentía: su DATO era prestado. Ahora se trae un producto recién nacido, sin
// historia, y el camino feliz vuelve a ser determinista pase lo que pase en el tenant.
//
// Y el bloqueo, que es comportamiento REAL del producto, se afirma aparte y a propósito (bloque 8),
// sobre un producto que sí tiene traslados. Se prueban los DOS caminos, no uno en vez del otro.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, engancharToasts, esperarToast } from './lib/gate-env.mjs';
import { productoDePrueba, purgarArtefactos, cuadraLibro } from './lib/gate-fixtures.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const TRASLADADO_ID = 1;   // Vela Lavanda 200g: tiene traslados confirmados fuera del almacén principal

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);

// El producto del gate (nace a 0) y el estado previo del que sí está trasladado, para devolverlo tal cual.
const PROD = productoDePrueba(db, 'Vela C1b');
const trasladadoBefore = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(TRASLADADO_ID);
const almacenPrincipal = db.prepare('SELECT id FROM warehouses WHERE is_default=1 AND active=1').get().id;

// Rastro de lo que crea el gate: se purga por ID al final, pase lo que pase.
const creado = { ordenes: [], recepciones: [], productos: [PROD.id] };

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await engancharToasts(page);
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

const dialogQueue = [];
// ── LOS ERRORES DE JAVASCRIPT DE LA PANTALLA, VIGILADOS ─────────────────────────────────────────
// POR QUÉ SE AÑADE. El 21 ago 2026 la pantalla «Registrar recepción» estaba MUERTA: un escape que la
// plantilla se comía partía una cadena, el bloque de script entero dejaba de ejecutarse y el botón
// «Confirmar recepción» no hacía nada. Este gate lo notó — pero de la peor forma posible: reventando
// con «confirmReceipt is not defined», que suena a gate roto y no a producto roto. Tardé un rato en
// distinguirlo. Con los errores enganchados, el gate DICE que la pantalla tiene un error de JS, que
// es la frase que ahorra ese rato. `gate-menu-navegacion` ya hace esto, pero solo recorre las
// pantallas del MENÚ, y esta cuelga de una orden de compra: no la ve nadie más.
const erroresJS = [];
page.on('pageerror', e => erroresJS.push(String(e && e.message || e)));
page.on('console', m => { if (m.type() === 'error') erroresJS.push('console: ' + m.text()); });

page.on('dialog', async d => {
  const next = dialogQueue.shift();
  if (next === undefined) await d.accept();
  else await d.accept(typeof next === 'string' ? next : undefined);
});

const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const post = async (u, body) => (await fetch(BASE + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) })).json();
const idDeLaUrl = () => parseInt((page.url().match(/\/(\d+)(?:\?|#|$)/) || [])[1]);

try {
  console.log('  (producto del gate: "' + PROD.name + '" #' + PROD.id + ', nace a 0)');

  // ── 1. Crear orden (vía API con la sesión) y enviarla ──
  const created = await post('/api/erp/purchase-orders', { supplier_id: 1, date: '2026-06-10', items: [{ product_id: PROD.id, quantity: 10, unit_cost: 2.5 }] });
  creado.ordenes.push(created.id);
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
  creado.recepciones.push(idDeLaUrl());
  body = await page.content();
  ok(body.includes('RC-') && body.includes('Confirmada'), 'ficha de recepción: RC-NNNN confirmada (solo lectura)');
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
  creado.recepciones.push(idDeLaUrl());
  await page.goto(BASE + `/admin/purchase-orders/${oid}`, { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('>Recibida<') || body.includes('status-recibida'), 'orden: estado RECIBIDA (cerrada sola)');
  ok(!body.includes('Registrar recepción'), 'sin pendiente → sin botón de registrar');
  ok(!body.includes('Anular y rehacer'), 'con recepciones confirmadas no se ofrece anular la orden');
  await page.screenshot({ path: '/tmp/c1b-4-recibida.png' });

  // ── 6. Lista: estado combinado ──
  await page.goto(BASE + '/admin/purchase-orders?estado=recibida', { waitUntil: 'networkidle0' });
  body = await page.content();
  ok((await page.content()).includes(sent.order_number), 'lista filtrada por Recibidas muestra la orden');

  // ── 7. Anular la 2ª recepción → orden reabierta (parcial) y stock revertido ──
  //     Camino feliz: el producto del gate NO tiene traslados, así que el motor deja anular.
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

  // ── 8. GUARDIÁN DE TRASLADOS (regla del multi-almacén) ────────────────────────────────────────
  //     Una recepción cuyo stock ya salió hacia otro almacén NO se puede anular: la salida inversa
  //     dejaría el almacén de origen en negativo. El motor devuelve 409 y la UI lo enseña. Esto es
  //     lo que mató a este gate cuando compraba sobre el producto 1; ahora se afirma a propósito.
  console.log('\n  ── guardián de traslados (anular una recepción ya trasladada) ──');

  // Precondición explícita: si el producto dejara de tener traslados, este bloque no probaría nada
  // y hay que ENTERARSE, no pasar de largo en silencio.
  const traslados = db.prepare(
    `SELECT COUNT(*) n FROM stock_transfer_items sti JOIN stock_transfers st ON st.id=sti.transfer_id
      WHERE st.status='confirmada' AND st.from_warehouse_id=? AND sti.product_id=?`).get(almacenPrincipal, TRASLADADO_ID).n;
  ok(traslados > 0, 'precondición: el producto ' + TRASLADADO_ID + ' tiene ' + traslados + ' traslado(s) confirmado(s) fuera del almacén principal');

  const oGuard = await post('/api/erp/purchase-orders', { supplier_id: 1, date: '2026-06-10', items: [{ product_id: TRASLADADO_ID, quantity: 5, unit_cost: 2 }] });
  creado.ordenes.push(oGuard.id);
  await post('/api/erp/purchase-orders/' + oGuard.id + '/enviar');
  await page.goto(BASE + `/admin/purchase-orders/${oGuard.id}/receipts/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#rLines tr .r-qty');
  dialogQueue.push(undefined);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.evaluate(() => confirmReceipt())]);
  const recGuardId = idDeLaUrl();
  creado.recepciones.push(recGuardId);
  const stockTrasRecibir = db.prepare('SELECT stock FROM products WHERE id=?').get(TRASLADADO_ID).stock;
  ok(stockTrasRecibir === trasladadoBefore.stock + 5, 'recepción del producto trasladado confirmada (stock ' + trasladadoBefore.stock + ' → ' + stockTrasRecibir + ')');

  // Intentar anularla POR LA UI: el usuario debe ver el bloqueo, no un fallo mudo.
  dialogQueue.push('me arrepiento');
  await page.evaluate(() => anularRecepcion());
  const avisoBloqueo = await esperarToast(page, /traslados activos/i);
  ok(!!avisoBloqueo, 'la UI avisa del bloqueo con un toast: ' + JSON.stringify(avisoBloqueo && avisoBloqueo.msg));
  ok(avisoBloqueo && avisoBloqueo.tipo === 'err', 'el aviso es de error (no un "hecho" disfrazado)');
  ok(avisoBloqueo && /anúlalos primero/i.test(avisoBloqueo.msg), 'el aviso dice QUÉ hacer (anular antes los traslados)');

  // Y el motor no se ha movido ni un milímetro: ni estado, ni stock.
  const recGuard = db.prepare('SELECT status FROM purchase_order_receipts WHERE id=?').get(recGuardId);
  ok(recGuard.status === 'confirmada', 'la recepción SIGUE confirmada (el bloqueo no la dejó a medias)');
  const stockTrasIntento = db.prepare('SELECT stock FROM products WHERE id=?').get(TRASLADADO_ID).stock;
  ok(stockTrasIntento === stockTrasRecibir, 'el stock NO se movió en el intento fallido (sigue en ' + stockTrasIntento + ')');
  ok(cuadraLibro(db, [TRASLADADO_ID]), 'caché == libro tras el intento bloqueado (nada quedó a medias)');
  await page.screenshot({ path: '/tmp/c1b-7-bloqueo-traslados.png' });

  // ── 9. Cuadre del camino feliz: delta del producto del gate = 4 (10 entradas − 6 revertidas) ──
  const prodAfter = db.prepare('SELECT stock FROM products WHERE id=?').get(PROD.id);
  ok(prodAfter.stock === 4, 'delta de stock del producto del gate = +4 (10 recibidas − 6 anuladas), got ' + prodAfter.stock);
  ok(cuadraLibro(db, [PROD.id]), 'caché products.stock == suma del libro, para el producto del gate');

  // Los errores de JS de la pantalla, dichos en voz alta. Se filtran los ruidos que no son del
  // producto (un favicon que no existe no rompe nada).
  const jsMalos = erroresJS.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e));
  ok(jsMalos.length === 0, 'cero errores de JavaScript en las pantallas de recepción', jsMalos.slice(0, 2).join(' | ') || 'ninguno');

} finally {
  await browser.close();

  // ── Limpieza: el gate borra POR ID lo que él creó y deja el tenant como lo encontró ──
  const db2 = new Database(DB_PATH);
  const tocadas = purgarArtefactos(db2, creado);
  console.log('  (limpieza: ' + tocadas.movimientos + ' movimientos, ' + tocadas.documentos + ' filas de documento, ' + tocadas.productos + ' producto)');

  const trasladadoAfter = db2.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(TRASLADADO_ID);
  ok(trasladadoAfter.stock === trasladadoBefore.stock,
     `el tenant queda como estaba: producto ${TRASLADADO_ID} vuelve a ${trasladadoBefore.stock} (got ${trasladadoAfter.stock})`);
  ok(Math.abs(trasladadoAfter.average_cost - trasladadoBefore.average_cost) < 1e-9, 'y su WAC vuelve al de partida');
  ok(!db2.prepare('SELECT 1 FROM products WHERE id=?').get(PROD.id), 'el producto de prueba ya no está en el catálogo');
  ok(cuadraLibro(db2, [TRASLADADO_ID]), 'caché == libro tras la limpieza');

  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador C1.b: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
