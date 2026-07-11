// Gate de navegador — Capa de dinero con proveedores · Paso (a), contra el servidor real
// (tenant desarrollo-bamburu): compra recibida de prueba → crear factura recibida MANUAL
// enlazada desde el formulario → registrar pago PARCIAL desde la ficha (modal) → ver
// "Debes X" en la sección Pagos y pagar el resto desde ahí (2º sitio) → ver "Le debes" en
// la cuenta del proveedor (3er sitio). Verifica los 3 sitios del modal compartido, el
// vencimiento y el estado en vivo. Limpia tras de sí (anula la factura, cancela la compra).
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { recomputeStock } from '../modules/erp/stock.js';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const PRODUCT_ID = 1;
const SUPPLIER_ID = 1;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);
const term = db.prepare('SELECT payment_term_days FROM suppliers WHERE id=?').get(SUPPLIER_ID).payment_term_days || 0;

const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const post = async (u, body) => (await fetch(BASE + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) })).json();
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });
const dialogQueue = [];
page.on('dialog', async d => { const next = dialogQueue.shift(); await d.accept(typeof next === 'string' ? next : undefined); });

// Clic en un botón por su texto dentro de un contenedor.
async function clickByText(sel, text) {
  return page.evaluate((sel, text) => {
    const root = document.querySelector(sel) || document;
    const b = Array.from(root.querySelectorAll('button,a')).find(x => x.textContent.trim() === text);
    if (b) { b.click(); return true; } return false;
  }, sel, text);
}

let purchaseId = null, invoiceId = null;
const INV_DATE = '2026-06-10';
try {
  // ── 1. Compra recibida de prueba (origen de la factura) ──
  const pu = await post('/api/erp/purchases', { supplier_id: SUPPLIER_ID, date: INV_DATE, status: 'received', items: [{ product_id: PRODUCT_ID, quantity: 5, unit_cost: 4 }] });
  purchaseId = pu.id;
  ok(!!purchaseId, 'compra recibida de prueba creada (#' + purchaseId + ')');

  // ── 2. Crear factura recibida MANUAL desde el formulario, enlazada a la compra ──
  await page.goto(BASE + '/admin/supplier-invoices/new', { waitUntil: 'networkidle0' });
  ok((await page.content()).includes('Registrar factura recibida'), 'formulario de nueva factura recibida carga');
  await page.select('#fSupplier', String(SUPPLIER_ID));
  await page.waitForFunction(() => document.getElementById('fOrigin').options.length > 1, { timeout: 8000 });
  const picked = await page.evaluate((pid) => {
    const sel = document.getElementById('fOrigin');
    for (const o of sel.options) { if (o.value === 'purchase:' + pid) { sel.value = o.value; return true; } }
    return false;
  }, purchaseId);
  ok(picked, 'la compra de prueba aparece como origen elegible y se selecciona');
  await page.type('#fNumber', 'TEST-FRA-001');
  await page.evaluate(() => { document.getElementById('fDate').value = '2026-06-10'; });
  await page.evaluate(() => { document.getElementById('fBase').value = '100'; document.getElementById('fTax').value = '21'; document.getElementById('fTax').dispatchEvent(new Event('input')); });
  await page.evaluate(() => { document.getElementById('fTotal').value = '121'; });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickByText('body', 'Registrar factura')]);
  const url = page.url();
  ok(/\/admin\/supplier-invoices\/\d+$/.test(url), 'tras guardar aterriza en la ficha de la factura recibida');
  invoiceId = parseInt(url.match(/\/(\d+)$/)[1]);
  let body = await page.content();
  ok(/FRP-\d{4}/.test(body), 'ficha: código interno FRP-NNNN');
  ok(body.includes('121.00'), 'ficha: total CON IVA = 121.00');
  ok(body.includes(addDays(INV_DATE, term)), 'ficha: vencimiento = fecha + plazo del proveedor (' + addDays(INV_DATE, term) + ')');

  // ── 3. SITIO 1 — registrar pago PARCIAL desde la ficha (modal compartido) ──
  await page.evaluate((id) => openPagos(id), invoiceId);
  await page.waitForSelector('#spay-amount', { timeout: 8000 });
  await page.evaluate(() => { document.getElementById('spay-amount').value = '50'; });
  // En la ficha, pagoOnSaved recarga la página: tras el pago la ficha se refresca con el nuevo pendiente.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
    clickByText('#pagoBody', 'Registrar pago'),
  ]);
  await page.waitForFunction(() => document.body.textContent.includes('71.00'), { timeout: 8000 });
  ok(true, 'sitio 1 (ficha): pago parcial de 50 → pendiente 71.00');
  await page.screenshot({ path: '/tmp/pagos-1-ficha.png' });

  // ── 4. SITIO 2 — sección "Pagos a proveedores": "Debes X" + pagar el resto ──
  await page.goto(BASE + '/admin/pagos', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('pagosTotal') && document.getElementById('pagosTotal').textContent !== '€0.00', { timeout: 8000 });
  body = await page.content();
  ok(/Debes/.test(body), 'sección Pagos: muestra "Debes"');
  const tieneFila = await page.evaluate((id) => !!document.querySelector('#pagosBody a[href$="/' + id + '"]'), invoiceId);
  ok(tieneFila, 'la factura aparece en la torre de control de pagos');
  await page.evaluate((id) => openPagos(id), invoiceId);
  await page.waitForSelector('#spay-amount', { timeout: 8000 });
  await page.evaluate(() => { document.getElementById('spay-amount').value = '71'; });
  await clickByText('#pagoBody', 'Registrar pago');
  await page.waitForFunction(() => document.getElementById('pagoBody').textContent.includes('Factura pagada por completo') || document.getElementById('pagoBody').textContent.includes('Pendiente €0.00'), { timeout: 8000 });
  ok(true, 'sitio 2 (sección Pagos): pago restante de 71 → factura pagada');
  await page.screenshot({ path: '/tmp/pagos-2-seccion.png' });

  // ── 5. SITIO 3 — cuenta del proveedor: "Le debes X" (0.00 tras saldar) ──
  await page.goto(BASE + '/admin/supplier-invoices?supplier=' + SUPPLIER_ID, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('debtBox') && document.getElementById('debtBox').textContent.includes('Le debes'), { timeout: 8000 });
  body = await page.content();
  ok(/Le debes/.test(body), 'sitio 3 (cuenta del proveedor): muestra "Le debes"');
  await page.screenshot({ path: '/tmp/pagos-3-cuenta.png' });

  // Estado final en BD: la factura quedó pagada (suma de pagos = total).
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM supplier_payments WHERE supplier_invoice_id=?').get(invoiceId).s;
  ok(Math.round(paid * 100) === 12100, 'BD: pagos registrados suman el total (121.00)');

} finally {
  await browser.close();
  const db2 = new Database(DB_PATH);
  db2.pragma('journal_mode = WAL');
  // Limpieza "sin rastro": borra la factura de prueba y sus pagos (CASCADE), y elimina la
  // compra de prueba con sus movimientos recomponiendo el stock. (No usa /cancel porque el
  // tenant de desarrollo puede tener traslados activos que lo bloqueen; aquí borramos el
  // dato de prueba como si nunca hubiera existido.)
  if (invoiceId) db2.prepare('DELETE FROM supplier_invoices WHERE id=?').run(invoiceId);
  if (purchaseId) {
    const affected = db2.prepare("SELECT DISTINCT product_id pid FROM stock_movements WHERE origin_type='purchase' AND origin_id=?").all(purchaseId).map(r => r.pid);
    db2.transaction(() => {
      db2.prepare("DELETE FROM stock_movements WHERE origin_type='purchase' AND origin_id=?").run(purchaseId);
      db2.prepare('DELETE FROM purchase_items WHERE purchase_id=?').run(purchaseId);
      db2.prepare('DELETE FROM purchases WHERE id=?').run(purchaseId);
      for (const pid of affected) recomputeStock(db2, pid);
    })();
  }
  ok(!invoiceId || !db2.prepare('SELECT 1 FROM supplier_invoices WHERE id=?').get(invoiceId), 'limpieza: factura de prueba eliminada');
  ok(!purchaseId || !db2.prepare('SELECT 1 FROM purchases WHERE id=?').get(purchaseId), 'limpieza: compra de prueba eliminada (stock recompuesto)');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador pagos a proveedor: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
