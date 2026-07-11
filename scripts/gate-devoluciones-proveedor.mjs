// Gate de navegador — devolución a proveedor contra el servidor real (tenant
// desarrollo-bamburu): compra recibida de prueba → crear devolución PARCIAL desde
// el formulario (stock baja) → anular desde la ficha (stock vuelve, WAC correcto).
// Verifica el cuadre del libro y que el WAC no se corrompe. Limpia tras de sí.
// OJO: crea una compra y una devolución de prueba en el tenant de desarrollo.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const PRODUCT_ID = 1;   // Vela Lavanda 200g (física)
const SUPPLIER_ID = 1;

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
const before = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(PRODUCT_ID);

const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const post = async (u, body) => (await fetch(BASE + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) })).json();

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

const dialogQueue = [];
page.on('dialog', async d => { const next = dialogQueue.shift(); if (next === undefined) await d.accept(); else await d.accept(typeof next === 'string' ? next : undefined); });

let purchaseId = null, returnUrl = null;
try {
  // ── 1. Compra directa recibida de prueba (sube stock +6 a coste 2.50) ──
  const pu = await post('/api/erp/purchases', { supplier_id: SUPPLIER_ID, date: '2026-06-14', status: 'received', items: [{ product_id: PRODUCT_ID, quantity: 6, unit_cost: 2.5 }] });
  purchaseId = pu.id;
  ok(!!purchaseId, 'compra de prueba creada (#' + purchaseId + ', +6 @ 2.50)');
  const afterBuy = db.prepare('SELECT stock FROM products WHERE id=?').get(PRODUCT_ID);
  ok(afterBuy.stock === before.stock + 6, 'stock sube +6 tras la compra (' + before.stock + ' → ' + afterBuy.stock + ')');

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
  body = await page.content();
  ok(/DEV-\d{4}/.test(body) && body.includes('Confirmada'), 'ficha: DEV-NNNN confirmada (inmutable)');
  ok(body.includes('Valor devuelto'), 'ficha: muestra valor devuelto');
  await page.screenshot({ path: '/tmp/devol-2-ficha.png' });

  // ── 3. Stock bajó (+6 −4 = +2 sobre el inicial) ──
  const afterReturn = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(PRODUCT_ID);
  ok(afterReturn.stock === before.stock + 2, 'stock baja a inicial+2 tras devolver 4 (' + afterReturn.stock + ')');
  ok(Math.abs(afterReturn.average_cost - wacFromBook(db, PRODUCT_ID)) < 1e-9, 'WAC == recálculo del libro tras la salida');

  // ── 4. Lista filtrada por Confirmadas muestra la devolución ──
  await page.goto(BASE + '/admin/supplier-returns?estado=confirmada', { waitUntil: 'networkidle0' });
  body = await page.content();
  const num = (returnUrl.match(/\/(\d+)$/) || [])[1];
  ok(body.includes('Devoluciones a proveedor'), 'lista de devoluciones carga');

  // ── 5. Anular la devolución desde la ficha → stock vuelve, WAC correcto ──
  await page.goto(returnUrl, { waitUntil: 'networkidle0' });
  dialogQueue.push('error administrativo, se reintegra');   // prompt del motivo
  await page.evaluate(() => anularDevolucion());
  await page.waitForFunction(() => document.body.innerHTML.includes('Devolución anulada'), { timeout: 10000 });
  body = await page.content();
  ok(body.includes('error administrativo, se reintegra'), 'ficha: anulada con su motivo');
  await page.screenshot({ path: '/tmp/devol-3-anulada.png' });

  const afterCancel = db.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(PRODUCT_ID);
  ok(afterCancel.stock === before.stock + 6, 'stock vuelve a inicial+6 tras anular la devolución (' + afterCancel.stock + ')');
  ok(afterCancel.average_cost > 0, 'WAC NO se hunde a 0 al reintegrar (re-entra con coste de origen)');
  ok(Math.abs(afterCancel.average_cost - wacFromBook(db, PRODUCT_ID)) < 1e-9, 'WAC == recálculo del libro tras la entrada');

} finally {
  await browser.close();
  const db2 = new Database(DB_PATH);
  // Cuadre final: caché == libro.
  const after = db2.prepare('SELECT stock, average_cost FROM products WHERE id=?').get(PRODUCT_ID);
  const libro = db2.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(PRODUCT_ID).s;
  ok(after.stock === libro, `caché products.stock (${after.stock}) == suma del libro (${libro})`);
  // Limpieza: cancelar la compra de prueba (permitido: su devolución está anulada) → stock al inicial.
  if (purchaseId) {
    await fetch(BASE + '/api/erp/purchases/' + purchaseId + '/cancel', { method: 'POST', headers: HJ, body: '{}' }).catch(() => {});
    const restored = db2.prepare('SELECT stock FROM products WHERE id=?').get(PRODUCT_ID);
    ok(restored.stock === before.stock, `limpieza: cancelar la compra de prueba devuelve el stock al inicial (${restored.stock})`);
  }
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador devoluciones: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
