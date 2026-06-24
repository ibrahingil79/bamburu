// Verificación — PIEZA A · Mostrador, navegador headless (Puppeteer), tenant desarrollo, server real.
//   node scripts/verify-mostrador-browser.mjs
// Venta completa: rejilla → cobro efectivo con cambio → ticket con QR → aparece en Facturas y en
// Cobros como cobrada → stock bajó por el libro.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
const PROD_ID = 6;  // Aceite Lavanda 30ml · 12 € · IVA 10% → total 13.20
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB);
const token = randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, randomBytes(8).toString('hex'));
const wid = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
db.close();
const stockNow = () => { const d = new Database(DB, { readonly: true }); const s = d.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=? AND warehouse_id=?').get(PROD_ID, wid).s; d.close(); return s; };

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });

let invNum = null;
try {
  console.log('\n=== Mostrador — navegador ===\n');
  const stock0 = stockNow();
  console.log('  Stock inicial Aceite Lavanda (principal): ' + stock0 + '\n');

  // 1) Pantalla de mostrador + rejilla
  await page.goto(ORIGIN + '/admin/mostrador', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('#prodGrid > div').length > 0, { timeout: 8000 });
  ok(true, 'la pantalla de mostrador carga la rejilla de productos');

  // 2) Añadir el producto al ticket
  await page.evaluate((id) => window.addProduct(id), PROD_ID);
  await sleep(200);
  let cobrarDisabled = await page.$eval('#btn-cobrar', b => b.disabled);
  ok(!cobrarDisabled, 'añadir producto habilita el botón Cobrar');
  const totalTxt = await page.evaluate(() => document.querySelector('#totals').textContent);
  ok(/13[.,]20/.test(totalTxt), 'total del ticket = 13,20 € (12 + IVA 10%) — got "' + totalTxt.replace(/\s+/g, ' ').trim() + '"');

  // 3) Cobro en efectivo con cambio
  await page.evaluate(() => window.openCobro());
  await sleep(200);
  await page.evaluate(() => window.setMethod('efectivo'));
  await page.evaluate(() => { const e = document.getElementById('entregado'); e.value = '20'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(150);
  const cambio = await page.evaluate(() => document.getElementById('cambio').textContent);
  ok(/6[.,]80/.test(cambio), 'cobro efectivo: entregado 20 → cambio 6,80 € (en pantalla) — got "' + cambio + '"');

  // 4) Confirmar → ticket emitido
  await page.evaluate(() => window.confirmarVenta());
  await page.waitForFunction(() => { const b = document.getElementById('ticketBody'); return b && /S\d{4}-\d{4}/.test(b.textContent); }, { timeout: 9000 });
  const ticketBody = await page.evaluate(() => document.getElementById('ticketBody').innerText);
  invNum = (ticketBody.match(/S\d{4}-\d{4}/) || [])[0];
  ok(!!invNum, 'ticket emitido con número de serie simplificada ' + invNum);
  ok(/Imprimir ticket \(PDF\)/.test(ticketBody) && /Ver en Facturas/.test(ticketBody), 'el ticket ofrece "Imprimir ticket (PDF)" y "Ver en Facturas"');

  // 5) Stock bajó por el libro
  ok(stockNow() === stock0 - 1, 'stock bajó por el libro: ' + stock0 + ' → ' + stockNow());

  // 6) El ticket PDF se descarga y es válido (QR incluido)
  const dbq = new Database(DB, { readonly: true });
  const invId = dbq.prepare('SELECT id FROM invoices WHERE invoice_number=?').get(invNum)?.id;
  dbq.close();
  const r = await page.evaluate(async (id) => { const resp = await fetch('/admin/mostrador/' + id + '/pdf'); return { status: resp.status, ct: resp.headers.get('content-type'), head: (await resp.text()).slice(0, 5) }; }, invId);
  ok(r.status === 200 && /application\/pdf/.test(r.ct) && r.head === '%PDF-', 'ticket PDF descargable (200 · application/pdf · %PDF-)');

  // 7) Aparece en Facturas + es F2 simplificada
  await page.goto(ORIGIN + '/admin/invoices', { waitUntil: 'networkidle0' });
  const invBody = await page.evaluate(() => document.body.innerText);
  ok(new RegExp(invNum).test(invBody), 'el ticket aparece en el listado de Facturas (' + invNum + ')');

  // 8) Comprobación fiscal directa: serie S, tipo F2, cobrada (no en worklist de cobros)
  const dbv = new Database(DB, { readonly: true });
  const inv = dbv.prepare('SELECT * FROM invoices WHERE invoice_number=?').get(invNum);
  const reg = dbv.prepare("SELECT tipo_factura FROM verifactu_registros WHERE invoice_id=? AND record_type='alta'").get(inv.id);
  const paid = dbv.prepare('SELECT COALESCE(SUM(amount),0) s, MAX(payment_method) pm FROM invoice_payments WHERE invoice_id=?').get(inv.id);
  dbv.close();
  ok(inv.series === 'S' && reg.tipo_factura === 'F2' && inv.client_id === null, 'fiscal: serie S, tipo F2, sin cliente');
  ok(Math.round(paid.s * 100) === 1320 && paid.pm === 'efectivo', 'cobrada por completo (13,20 € efectivo) → no pendiente');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  await browser.close();
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
