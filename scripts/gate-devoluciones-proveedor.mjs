// Gate de navegador — devolución a proveedor contra el servidor real (tenant desarrollo-bamburu):
// compra recibida de prueba → crear devolución PARCIAL desde el formulario (stock baja) → anular
// desde la ficha (stock vuelve, WAC correcto). Verifica el cuadre del libro y que el WAC no se
// corrompe. Y el GUARDIÁN DE TRASLADOS: una compra cuyo stock ya se trasladó a otro almacén NO se
// puede cancelar.
//
// POR QUÉ ESTE GATE TRAE SU PROPIO PRODUCTO. Antes compraba sobre el producto 1 del tenant. El
// FLUJO pasaba entero: lo que fallaba era su propia LIMPIEZA — al cancelar la compra de prueba, el
// guardián de traslados la bloqueaba (con razón: el producto 1 ya tenía stock trasladado), así que
// el gate dejaba +6 de stock fantasma en cada pasada y se declaraba roto. El fallo no estaba en lo
// que probaba, sino en la mesa que no recogía. Con un producto recién nacido, la limpieza vuelve a
// ser posible y el tenant queda como estaba.
//
// El bloqueo, que es comportamiento REAL y bueno del producto, se afirma aparte (bloque 6).
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, engancharToasts, esperarToast, autoAceptarPaneles } from './lib/gate-env.mjs';
import { productoDePrueba, purgarArtefactos, cuadraLibro } from './lib/gate-fixtures.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const SUPPLIER_ID = 1;
const TRASLADADO_ID = 1;   // Vela Lavanda 200g: con traslados confirmados fuera del almacén principal

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// WAC recalculado desde el libro (misma regla que recomputeStock) para comparar.
function wacFromBook(db, productId) {
  const rows = db.prepare('SELECT quantity, unit_cost FROM stock_movements WHERE product_id=? ORDER BY created_at, id').all(productId);
  let wacQty = 0, avg = 0;
  for (const r of rows) {
    if (r.quantity > 0) { const c = r.unit_cost == null ? 0 : r.unit_cost; avg = (wacQty * avg + r.quantity * c) / (wacQty + r.quantity); wacQty += r.quantity; }
    else { wacQty += r.quantity; if (wacQty <= 0) { wacQty = 0; avg = 0; } }
  }
  return avg;
}

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);

const PROD = productoDePrueba(db, 'Vela Devol');
const trasladadoBefore = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(TRASLADADO_ID);
const almacenPrincipal = db.prepare('SELECT id FROM warehouses WHERE is_default=1 AND active=1').get().id;
const creado = { compras: [], devoluciones: [], productos: [PROD.id] };

const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const post = async (u, body) => (await fetch(BASE + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) })).json();

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await engancharToasts(page);
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

const dialogQueue = [];
page.on('dialog', async d => { const next = dialogQueue.shift(); if (next === undefined) await d.accept(); else await d.accept(typeof next === 'string' ? next : undefined); });
// Y el panel que sustituyó a esas ventanitas: se acepta igual que se aceptaba el confirm().
await autoAceptarPaneles(page);

let purchaseId = null, returnUrl = null;
try {
  console.log('  (producto del gate: "' + PROD.name + '" #' + PROD.id + ', nace a 0)');

  // ── 1. Compra directa recibida de prueba (sube stock +6 a coste 2.50) ──
  const pu = await post('/api/erp/purchases', { supplier_id: SUPPLIER_ID, date: '2026-06-14', status: 'received', items: [{ product_id: PROD.id, quantity: 6, unit_cost: 2.5 }] });
  purchaseId = pu.id;
  creado.compras.push(purchaseId);
  ok(!!purchaseId, 'compra de prueba creada (#' + purchaseId + ', +6 @ 2.50)');
  const afterBuy = db.prepare('SELECT stock FROM products WHERE id=?').get(PROD.id);
  ok(afterBuy.stock === 6, 'stock sube a 6 tras la compra (nace a 0 → ' + afterBuy.stock + ')');

  // ── 2. Formulario de devolución: elegir el origen, devolver 4 de 6 ──
  await page.goto(BASE + '/admin/supplier-returns/new', { waitUntil: 'networkidle0' });
  let body = await page.content();
  ok(body.includes('Nueva devolución a proveedor') && body.includes('Documento de origen'), 'formulario de nueva devolución carga');
  const picked = await page.evaluate((pid) => {
    const sel = document.getElementById('fOrigin');
    for (const o of sel.options) { if (o.textContent.includes('Compra #' + pid)) { sel.value = o.value; sel.dispatchEvent(new Event('change')); return true; } }
    return false;
  }, purchaseId);
  ok(picked, 'la compra de prueba aparece como origen elegible y se selecciona');
  await page.waitForSelector('#rLines tr[data-oid] .r-qty', { timeout: 8000 });
  const dev = await page.$eval('#rLines tr[data-oid]', r => r.dataset.dev);
  ok(dev === '6', 'línea con devolvible = 6');
  await page.type('#fMotivo', 'mercancia defectuosa en transporte');
  await page.evaluate(() => { const r = document.querySelector('#rLines tr[data-oid]'); r.querySelector('.r-qty').value = '4'; r.querySelector('.r-qty').dispatchEvent(new Event('input')); });
  const subTxt = await page.$eval('#rLines tr[data-oid] .r-sub', el => el.textContent);
  ok(/10\.00/.test(subTxt), 'valor de la línea = 4 × 2.50 = 10.00 (' + subTxt.trim() + ')');
  await page.screenshot({ path: '/tmp/devol-1-form.png' });

  dialogQueue.push(undefined);   // confirm-first
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.evaluate(() => confirmReturn())]);
  returnUrl = page.url();
  ok(returnUrl.includes('/admin/supplier-returns/'), 'tras confirmar aterriza en la ficha de la devolución');
  creado.devoluciones.push(parseInt((returnUrl.match(/\/(\d+)$/) || [])[1]));
  body = await page.content();
  ok(/DEV-\d{4}/.test(body) && body.includes('Confirmada'), 'ficha: DEV-NNNN confirmada (inmutable)');
  ok(body.includes('Valor devuelto'), 'ficha: muestra valor devuelto');
  await page.screenshot({ path: '/tmp/devol-2-ficha.png' });

  // ── 3. Stock bajó (6 − 4 = 2) ──
  const afterReturn = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(PROD.id);
  ok(afterReturn.stock === 2, 'stock baja a 2 tras devolver 4 (' + afterReturn.stock + ')');
  ok(Math.abs(afterReturn.average_cost - wacFromBook(db, PROD.id)) < 1e-9, 'WAC == recálculo del libro tras la salida');

  // ── 4. Lista filtrada por Confirmadas muestra la devolución ──
  await page.goto(BASE + '/admin/supplier-returns?estado=confirmada', { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('Devoluciones a proveedor'), 'lista de devoluciones carga');

  // ── 5. Anular la devolución desde la ficha → stock vuelve, WAC correcto ──
  await page.goto(returnUrl, { waitUntil: 'networkidle0' });
  // El motivo ya no lo pide un prompt(): va en un panel con campo. Se empuja a la cola del panel,
  // el equivalente exacto de la de diálogos (ver autoAceptarPaneles en lib/gate-env.mjs).
  await page.evaluate(v => window.__pdCola.push(v), 'error administrativo, se reintegra');
  await page.evaluate(() => anularDevolucion());
  await page.waitForFunction(() => document.body.innerHTML.includes('Devolución anulada'), { timeout: 10000 });
  body = await page.content();
  ok(body.includes('error administrativo, se reintegra'), 'ficha: anulada con su motivo');
  await page.screenshot({ path: '/tmp/devol-3-anulada.png' });

  const afterCancel = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(PROD.id);
  ok(afterCancel.stock === 6, 'stock vuelve a 6 tras anular la devolución (' + afterCancel.stock + ')');
  ok(afterCancel.average_cost > 0, 'WAC NO se hunde a 0 al reintegrar (re-entra con coste de origen)');
  ok(Math.abs(afterCancel.average_cost - wacFromBook(db, PROD.id)) < 1e-9, 'WAC == recálculo del libro tras la entrada');

  // ── 6. GUARDIÁN DE TRASLADOS: cancelar una compra ya trasladada queda BLOQUEADO ──────────────
  //     Es la regla que mató a este gate cuando compraba sobre el producto 1. Aquí se afirma a
  //     propósito, POR LA UI, sobre un producto que sí tiene traslados.
  console.log('\n  ── guardián de traslados (cancelar una compra ya trasladada) ──');
  const traslados = db.prepare(
    `SELECT COUNT(*) n FROM stock_transfer_items sti JOIN stock_transfers st ON st.id=sti.transfer_id
      WHERE st.status='confirmada' AND st.from_warehouse_id=? AND sti.product_id=?`).get(almacenPrincipal, TRASLADADO_ID).n;
  ok(traslados > 0, 'precondición: el producto ' + TRASLADADO_ID + ' tiene ' + traslados + ' traslado(s) confirmado(s) fuera del almacén principal');

  const puGuard = await post('/api/erp/purchases', { supplier_id: SUPPLIER_ID, date: '2026-06-14', status: 'received', items: [{ product_id: TRASLADADO_ID, quantity: 5, unit_cost: 2 }] });
  creado.compras.push(puGuard.id);
  const stockTrasCompra = db.prepare('SELECT stock FROM products WHERE id=?').get(TRASLADADO_ID).stock;
  ok(stockTrasCompra === trasladadoBefore.stock + 5, 'compra del producto trasladado recibida (stock ' + trasladadoBefore.stock + ' → ' + stockTrasCompra + ')');

  await page.goto(BASE + '/admin/purchases/' + puGuard.id, { waitUntil: 'networkidle0' });
  dialogQueue.push(undefined);   // confirm() de cancelPurchase
  await page.evaluate(() => cancelPurchase());
  const avisoBloqueo = await esperarToast(page, /traslados activos/i);
  ok(!!avisoBloqueo, 'la UI avisa del bloqueo con un toast: ' + JSON.stringify(avisoBloqueo && avisoBloqueo.msg));
  ok(avisoBloqueo && avisoBloqueo.tipo === 'err', 'el aviso es de error (no un "hecho" disfrazado)');
  ok(avisoBloqueo && /anúlalos primero/i.test(avisoBloqueo.msg), 'el aviso dice QUÉ hacer (anular antes los traslados)');

  const compraGuard = db.prepare('SELECT status FROM purchases WHERE id=?').get(puGuard.id);
  ok(compraGuard.status === 'received', 'la compra SIGUE recibida (el bloqueo no la dejó a medias)');
  const stockTrasIntento = db.prepare('SELECT stock FROM products WHERE id=?').get(TRASLADADO_ID).stock;
  ok(stockTrasIntento === stockTrasCompra, 'el stock NO se movió en el intento fallido (sigue en ' + stockTrasIntento + ')');
  ok(cuadraLibro(db, [TRASLADADO_ID]), 'caché == libro tras el intento bloqueado');
  await page.screenshot({ path: '/tmp/devol-4-bloqueo-traslados.png' });

  // ── 7. La compra del gate SÍ se cancela (sin traslados) → stock vuelve a 0 ──
  //     El camino feliz de la cancelación, que el guardián no debe estorbar. Aquí NO se mira el
  //     toast: al cancelar bien, la UI recarga la página acto seguido y se lo lleva por delante.
  //     Se afirma lo que QUEDA, que es más fuerte que el aviso: la ficha en Cancelada y el stock
  //     revertido en el libro.
  await page.goto(BASE + '/admin/purchases/' + purchaseId, { waitUntil: 'networkidle0' });
  dialogQueue.push(undefined);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.evaluate(() => cancelPurchase())]);
  const fichaCancelada = await page.content();
  ok(/Cancelada/.test(fichaCancelada), 'la compra SIN traslados sí se cancela: la ficha queda en "Cancelada"');
  const estadoFinal = db.prepare('SELECT status FROM purchases WHERE id=?').get(purchaseId).status;
  ok(estadoFinal === 'cancelled', 'y el motor la deja en cancelled (got ' + estadoFinal + ')');
  const finalProd = db.prepare('SELECT stock FROM products WHERE id=?').get(PROD.id).stock;
  ok(finalProd === 0, 'stock del producto del gate vuelve a 0 al cancelar su compra (got ' + finalProd + ')');
  ok(cuadraLibro(db, [PROD.id]), 'caché == libro para el producto del gate');

} finally {
  await browser.close();

  // ── Limpieza: borra POR ID lo que creó el gate y deja el tenant como estaba ──
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

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador devoluciones: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
