// Gate — Capa de dinero · Paso (e): PAGO A CUENTA del proveedor (pantalla sobre el motor de d).
// Contra el servidor real (tenant desarrollo-bamburu). Verifica el endpoint nuevo
// (POST /api/erp/suppliers/:id/account-payments) — reparto auto/manual, abono excluido, no
// sobrepasa, cuadra al céntimo — y la PANTALLA: botón "A cuenta" en la torre de Pagos y "Pagar
// a cuenta" en la ficha del proveedor; el modal reparte por antigüedad y "Le debes X" baja.
// Crea su propio proveedor + 3 facturas + 1 abono y LIMPIA todo al final.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = '/home/ibrahin/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);
const H = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const apiJ = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const debtOf = (sid) => Math.round(db.prepare("SELECT COALESCE(SUM(total - (SELECT COALESCE(SUM(amount),0) FROM supplier_payments WHERE supplier_invoice_id=si.id)),0) t FROM supplier_invoices si WHERE supplier_id=? AND status='vigente' AND total>0").get(sid).t * 100) / 100;
const paidOf = (id) => Math.round(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM supplier_payments WHERE supplier_invoice_id=?').get(id).s * 100) / 100;

const SUP_NAME = 'ZZ Cuenta ' + randomBytes(3).toString('hex');
let supId = null, a = null, b = null, cc = null, abono = null;
function addInv(sid, total, due, neg = false) {
  const seq = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM supplier_invoices').get().n;
  return db.prepare(`INSERT INTO supplier_invoices (supplier_id,internal_code,supplier_invoice_number,invoice_date,due_date,base,tax,total,status,supplier_name,entity_type,entity_id)
    VALUES (?,?,?,?,?,?,?,?, 'vigente', ?, ?, ?)`)
    .run(sid, (neg ? 'ABP-T' : 'FRP-T') + seq, 'CT' + seq, '2026-01-10', due, total, 0, total, SUP_NAME, neg ? 'supplier_return' : null, neg ? seq : null).lastInsertRowid;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });
const waitModal = () => page.waitForFunction(() => { const m = document.getElementById('pagoCuentaModal'); return m && getComputedStyle(m).display !== 'none' && document.querySelectorAll('#pagoCuentaBody #pc-importe').length; }, { timeout: 6000 });

try {
  // Setup: 3 facturas (100 c/u, vencimientos ascendentes) + 1 abono (-50).
  supId = db.prepare("INSERT INTO suppliers (name,active,payment_term_days) VALUES (?,1,0)").run(SUP_NAME).lastInsertRowid;
  a = addInv(supId, 100, '2026-02-01'); b = addInv(supId, 100, '2026-03-01'); cc = addInv(supId, 100, '2026-04-01');
  abono = addInv(supId, -50, '2026-02-15', true);
  ok(debtOf(supId) === 300, 'deuda pagable inicial = 300 (3 facturas; el abono no es deuda pagable)');

  // ── 1. account-summary excluye el abono ─────────────────────────────────────
  const sum = await apiJ('GET', '/api/erp/suppliers/' + supId + '/account-summary');
  ok(sum.status === 200 && sum.body.facturasVivas.length === 3 && sum.body.deudaTotal === 300, 'account-summary: 3 facturas vivas, deudaTotal 300, ABONO EXCLUIDO');

  // ── 2. Torre de Pagos: el botón "A cuenta" abre el modal con las 3 facturas ──
  await page.goto(BASE + '/admin/pagos', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#pagosBody tr', { timeout: 5000 });
  const clicked = await page.evaluate((sid) => { const btns = Array.from(document.querySelectorAll('#pagosBody button')).filter(x => x.getAttribute('onclick') === 'openPagoCuenta(' + sid + ')'); if (btns.length) { btns[0].click(); return true; } return false; }, supId);
  ok(clicked, 'la torre de Pagos muestra el botón "A cuenta" del proveedor');
  await waitModal();
  const filasModal = await page.evaluate(() => document.querySelectorAll('#pagoCuentaBody table tbody tr').length);
  ok(filasModal >= 4, 'el modal lista las 3 facturas + la fila de total (sin el abono)');
  await page.evaluate(() => window.pcClose());

  // ── 3. Ficha del proveedor: "Pagar a cuenta" 200 € auto → reparte por antigüedad ──
  await page.goto(BASE + '/admin/supplier-invoices?supplier=' + supId, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#debtBox', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  const hasBtn = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#debtBox button')).find(x => /Pagar a cuenta/.test(x.textContent)); if (b) { b.click(); return true; } return false; });
  ok(hasBtn, 'la ficha del proveedor ("Le debes X") muestra "Pagar a cuenta"');
  await waitModal();
  await page.evaluate(() => { document.getElementById('pc-importe').value = '200'; window.pcRender(); });
  await page.evaluate(() => { const b = document.getElementById('pc-btn'); b && b.click(); });
  await page.waitForFunction((sid) => true, {}, supId);
  await new Promise(r => setTimeout(r, 600));
  ok(paidOf(a) === 100 && paidOf(b) === 100 && paidOf(cc) === 0, 'reparto AUTO por antigüedad: 100 a la 1ª, 100 a la 2ª, 0 a la 3ª (got ' + paidOf(a) + '/' + paidOf(b) + '/' + paidOf(cc) + ')');
  ok(debtOf(supId) === 100, 'la deuda pagable baja 300→100 tras el pago a cuenta');
  // El abono no se tocó.
  ok(paidOf(abono) === 0, 'el abono no recibió ningún apunte');

  // ── 4. Guardas del endpoint (manual): cuadre y no sobrepaso ──────────────────
  const over = await apiJ('POST', '/api/erp/suppliers/' + supId + '/account-payments', { amount: 100, modo: 'manual', asignacion: [{ supplier_invoice_id: cc, importe: 200 }] });
  ok(over.status === 400, 'manual sobrepasando el pendiente de una factura → 400');
  const mism = await apiJ('POST', '/api/erp/suppliers/' + supId + '/account-payments', { amount: 50, modo: 'manual', asignacion: [{ supplier_invoice_id: cc, importe: 100 }] });
  ok(mism.status === 400, 'manual cuya suma != importe → 400');
  const good = await apiJ('POST', '/api/erp/suppliers/' + supId + '/account-payments', { amount: 100, modo: 'manual', asignacion: [{ supplier_invoice_id: cc, importe: 100 }] });
  ok(good.status === 201 && paidOf(cc) === 100 && debtOf(supId) === 0, 'manual válido salda la 3ª factura → deuda 0');

  // ── 5. Sin deuda viva → 400 ──────────────────────────────────────────────────
  const none = await apiJ('POST', '/api/erp/suppliers/' + supId + '/account-payments', { amount: 10, modo: 'auto' });
  ok(none.status === 400, 'sin deuda viva → 400');

} catch (e) {
  fail++; console.error('  ✗ EXCEPCIÓN: ' + e.message);
} finally {
  try {
    const ids = [a, b, cc, abono].filter(Boolean);
    if (ids.length) { db.prepare('DELETE FROM supplier_payments WHERE supplier_invoice_id IN (' + ids.map(() => '?').join(',') + ')').run(...ids); db.prepare('DELETE FROM supplier_invoices WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids); }
    if (supId) db.prepare('DELETE FROM suppliers WHERE id=?').run(supId);
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  } catch (e) { console.error('  (limpieza) ' + e.message); }
  await browser.close();
  db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
