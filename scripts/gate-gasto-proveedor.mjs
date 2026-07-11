// Gate de navegador — Capa de dinero · Paso (b): factura de GASTO PURO, contra el servidor
// real (tenant desarrollo-bamburu). Crea una factura de gasto desde el formulario (modo
// Gasto): proveedor por buscador, categoría, TRES líneas a tipos distintos (21 + 10 +
// exenta 0) → total con IVA por tipo → ficha con líneas/categoría → "Debes X" en Pagos →
// pago parcial → anular. Limpia tras de sí (la factura no tiene origen de stock).
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const SUPPLIER_NAME = 'Aromas';   // existe en el tenant (Aromas del Sur SL)

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });
const dialogQueue = [];
page.on('dialog', async d => { const next = dialogQueue.shift(); await d.accept(typeof next === 'string' ? next : undefined); });
async function clickByText(sel, text) {
  return page.evaluate((sel, text) => {
    const root = document.querySelector(sel) || document;
    const b = Array.from(root.querySelectorAll('button,a')).find(x => x.textContent.trim() === text);
    if (b) { b.click(); return true; } return false;
  }, sel, text);
}

let invoiceId = null;
try {
  // ── 1. Formulario en modo GASTO ──
  await page.goto(BASE + '/admin/supplier-invoices/new', { waitUntil: 'networkidle0' });
  ok((await page.content()).includes('Factura de gasto (sin mercancía)'), 'el alta ofrece el modo "Factura de gasto"');
  await clickByText('body', 'Factura de gasto (sin mercancía)');
  await page.waitForFunction(() => document.getElementById('modeGasto') && document.getElementById('modeGasto').style.display !== 'none', { timeout: 5000 });

  // Proveedor por buscador
  await page.type('#gSupSearch', SUPPLIER_NAME);
  await page.waitForFunction(() => { const b = document.getElementById('gSupSuggest'); return b && b.style.display !== 'none' && b.children.length > 0; }, { timeout: 6000 });
  await page.evaluate(() => document.querySelector('#gSupSuggest div').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForFunction(() => { const p = document.getElementById('gSupPicked'); return p && p.style.display !== 'none'; }, { timeout: 5000 });
  ok(true, 'proveedor elegido por el buscador');

  // Categoría
  await page.select('#gCategory', 'Servicios profesionales');
  await page.type('#gNumber', 'GASTO-TEST-001');

  // TRES líneas: 100@21, 50@10, 30@0 (exenta) → base 180, IVA 26, total 206
  await page.evaluate(() => {
    glines.length = 0;
    addGLine(); glines[0].concepto = 'Asesoría'; glines[0].base = 100; glines[0].tax_rate = 21;
    addGLine(); glines[1].concepto = 'Gestión laboral'; glines[1].base = 50; glines[1].tax_rate = 10;
    addGLine(); glines[2].concepto = 'Suplido exento'; glines[2].base = 30; glines[2].tax_rate = 0;
    renderGLines();
  });
  const totalsTxt = await page.$eval('#gTotals', el => el.textContent);
  ok(/206\.00/.test(totalsTxt), 'total a pagar = 206.00 (base 180 + IVA 26)');
  ok(/IVA 21%/.test(totalsTxt) && /IVA 10%/.test(totalsTxt), 'desglose de IVA por tipo (21% y 10%) visible');
  await page.screenshot({ path: '/tmp/gasto-1-form.png' });

  // Guardar → ficha
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickByText('#modeGasto', 'Registrar factura de gasto')]);
  const url = page.url();
  ok(/\/admin\/supplier-invoices\/\d+$/.test(url), 'tras guardar aterriza en la ficha');
  invoiceId = parseInt(url.match(/\/(\d+)$/)[1]);
  let body = await page.content();
  ok(/FRP-\d{4}/.test(body), 'ficha: código FRP');
  ok(body.includes('Gasto') && body.includes('Servicios profesionales'), 'ficha: tipo Gasto + categoría');
  ok(body.includes('Líneas del gasto') && body.includes('Asesoría') && body.includes('Suplido exento'), 'ficha: tabla de líneas del gasto');
  ok(body.includes('206.00'), 'ficha: total 206.00');
  ok(body.includes('—') , 'ficha: sin documento de origen ("—")');
  await page.screenshot({ path: '/tmp/gasto-2-ficha.png' });

  // BD: importes y líneas correctos
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(invoiceId);
  ok(inv && inv.entity_type === null && inv.expense_category === 'Servicios profesionales', 'BD: gasto sin origen + categoría');
  ok(Math.round(inv.total * 100) === 20600 && Math.round(inv.tax * 100) === 2600, 'BD: total 206 / IVA 26');
  ok(db.prepare('SELECT COUNT(*) n FROM supplier_invoice_items WHERE supplier_invoice_id=?').get(invoiceId).n === 3, 'BD: 3 líneas guardadas');

  // ── 2. Pago parcial desde la ficha ──
  await page.evaluate((id) => openPagos(id), invoiceId);
  await page.waitForSelector('#spay-amount', { timeout: 8000 });
  await page.evaluate(() => { document.getElementById('spay-amount').value = '100'; });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), clickByText('#pagoBody', 'Registrar pago')]);
  await page.waitForFunction(() => document.body.textContent.includes('106.00'), { timeout: 8000 });
  ok(true, 'pago parcial de 100 → pendiente 106.00');

  // ── 3. La factura de gasto aparece en la torre de control de pagos ──
  await page.goto(BASE + '/admin/pagos', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('pagosTotal') && document.getElementById('pagosTotal').textContent !== '€0.00', { timeout: 8000 });
  const enTorre = await page.evaluate((id) => !!document.querySelector('#pagosBody a[href$="/' + id + '"]'), invoiceId);
  ok(enTorre, 'el gasto aparece en "Pagos a proveedores" (Debes X)');

  // ── 4. Lista: filtro por tipo Gasto ──
  await page.goto(BASE + '/admin/supplier-invoices', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#tipoFilter', { timeout: 5000 });
  await page.select('#tipoFilter', 'gasto');
  const verGasto = await page.evaluate((id) => {
    const tr = document.querySelector('#siBody tr a[href$="/' + id + '"]');
    return !!tr && tr.closest('tr').getAttribute('data-tipo') === 'gasto' && tr.closest('tr').style.display !== 'none';
  }, invoiceId);
  ok(verGasto, 'lista: el filtro "Gasto" muestra la factura de gasto');

} finally {
  await browser.close();
  const db2 = new Database(DB_PATH);
  if (invoiceId) db2.prepare('DELETE FROM supplier_invoices WHERE id=?').run(invoiceId);   // CASCADE borra líneas + pagos
  ok(!invoiceId || !db2.prepare('SELECT 1 FROM supplier_invoices WHERE id=?').get(invoiceId), 'limpieza: factura de gasto eliminada (líneas/pagos en cascada)');
  ok(!invoiceId || db2.prepare('SELECT COUNT(*) n FROM supplier_invoice_items WHERE supplier_invoice_id=?').get(invoiceId).n === 0, 'limpieza: líneas eliminadas');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador gasto a proveedor: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
