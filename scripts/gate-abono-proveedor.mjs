// Gate de navegador — Capa de dinero · Paso (c): la devolución RESTA deuda (ABONO) +
// reembolso, contra el servidor real (tenant desarrollo-bamburu). Crea compra + deuda +
// devolución por API (la devolución dispara el abono real); luego conduce las superficies
// de (c): lista con tipo Abono, ficha del abono (líneas negativas + enlace al DEV), "Debes X"
// neteado, registrar reembolso, guarda de anular con reembolso, anular devolución → la deuda
// vuelve. Limpia tras de sí (borra todo el dato de prueba y recompone el stock).
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { recomputeStock } from '../modules/erp/stock.js';
import { borrarFacturaProveedor, contarHuerfanos } from './lib/limpiar-asientos.mjs';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const SUPPLIER_ID = 1, PRODUCT_ID = 1;   // Aromas del Sur SL · Vela Lavanda (física, IVA 21)

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
// 24 ago 2026 · Se cuenta la basura del libro ANTES y DESPUÉS. Ver scripts/lib/limpiar-asientos.mjs.
const huerfanosAntes = contarHuerfanos(db);
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);
const H = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const apiJ = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const debtTotal = () => db.prepare("SELECT COALESCE(SUM(total - (SELECT COALESCE(SUM(amount),0) FROM supplier_payments WHERE supplier_invoice_id=si.id)),0) t FROM supplier_invoices si WHERE supplier_id=? AND status='vigente'").get(SUPPLIER_ID).t;

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });
async function clickByText(sel, text) {
  return page.evaluate((sel, text) => { const root = document.querySelector(sel) || document; const b = Array.from(root.querySelectorAll('button,a')).find(x => x.textContent.trim() === text); if (b) { b.click(); return true; } return false; }, sel, text);
}

let pid = null, debtId = null, returnId = null, abonoId = null;
const baseDebt = debtTotal();
try {
  // ── Setup por API: compra recibida + deuda 100 + devolución de 4 (→ abono -24.2) ──
  const pu = await apiJ('POST', '/api/erp/purchases', { supplier_id: SUPPLIER_ID, date: '2026-06-10', status: 'received', items: [{ product_id: PRODUCT_ID, quantity: 10, unit_cost: 5 }] });
  pid = pu.body.id;
  const debt = await apiJ('POST', '/api/erp/supplier-invoices', { entity_type: 'purchase', entity_id: pid, invoice_date: '2026-06-10', total: 100 });
  debtId = debt.body.id;
  const lineId = db.prepare('SELECT id FROM purchase_items WHERE purchase_id=? AND product_id=?').get(pid, PRODUCT_ID).id;
  const ret = await apiJ('POST', '/api/erp/supplier-returns', { origin_type: 'purchase', origin_id: pid, date: '2026-06-12', motivo: 'defectuoso gate', items: [{ origin_item_id: lineId, quantity: 4 }] });
  ok(ret.status === 201 && ret.body.credit && /^ABP-\d{4}$/.test(ret.body.credit.internal_code), 'la devolución (API) crea el abono ' + (ret.body.credit && ret.body.credit.internal_code));
  returnId = ret.body.id; abonoId = ret.body.credit.id;
  ok(Math.round(debtTotal() * 100) === Math.round((baseDebt + 100 - 24.2) * 100), 'la deuda neta baja por el abono (-24.2)');

  // ── 1. Lista: filtro Abono muestra el ABP como tipo Abono ──
  await page.goto(BASE + '/admin/supplier-invoices', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#tipoFilter', { timeout: 5000 });
  await page.select('#tipoFilter', 'abono');
  const filaAbono = await page.evaluate((id) => { const a = document.querySelector('#siBody tr a[href$="/' + id + '"]'); return a ? { tipo: a.closest('tr').getAttribute('data-tipo'), vis: a.closest('tr').style.display !== 'none' } : null; }, abonoId);
  ok(filaAbono && filaAbono.tipo === 'abono' && filaAbono.vis, 'lista: el filtro "Abono" muestra el ABP como tipo abono');

  // ── 2. Ficha del abono ──
  await page.goto(BASE + '/admin/supplier-invoices/' + abonoId, { waitUntil: 'networkidle0' });
  let body = await page.content();
  ok(/ABP-\d{4}/.test(body) && body.includes('>Abono<'), 'ficha: código ABP + badge Abono');
  ok(body.includes('Líneas del abono'), 'ficha: tabla de líneas del abono (negativas)');
  ok(body.includes('-24.20') || body.includes('-24,20') || body.includes('-24.2'), 'ficha: total negativo -24.20');
  ok(body.includes('/admin/supplier-returns/' + returnId), 'ficha: enlace al DEV de origen');
  ok(body.includes('Registrar reembolso recibido'), 'ficha: botón de reembolso (no "Registrar pago")');
  await page.screenshot({ path: '/tmp/abono-1-ficha.png' });

  // ── 3. Sección Pagos: "Debes X" neteado + el abono como crédito ──
  await page.goto(BASE + '/admin/pagos', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('pagosTotal') && document.getElementById('pagosTotal').textContent.length > 1, { timeout: 8000 });
  const abonoEnTorre = await page.evaluate((id) => { const a = document.querySelector('#pagosBody a[href$="/' + id + '"]'); return a ? a.closest('tr').textContent.includes('a tu favor') : false; }, abonoId);
  ok(abonoEnTorre, 'sección Pagos: el abono aparece como crédito "a tu favor"');
  await page.screenshot({ path: '/tmp/abono-2-pagos.png' });

  // ── 4. Registrar reembolso parcial (10) desde el modal → la deuda sube ──
  await page.evaluate((id) => openPagos(id), abonoId);
  await page.waitForSelector('#ref-amount', { timeout: 8000 });
  await page.evaluate(() => { document.getElementById('ref-amount').value = '10'; });
  await clickByText('#pagoBody', 'Registrar reembolso recibido');
  await page.waitForFunction(() => { const b = document.getElementById('pagoBody'); return b && b.textContent.includes('Reembolsado') && b.textContent.match(/10[.,]00/); }, { timeout: 8000 });
  ok(Math.round(debtTotal() * 100) === Math.round((baseDebt + 100 - 24.2 + 10) * 100), 'reembolso de 10 → la deuda neta sube 10 (ya tienes el dinero)');

  // ── 5. Guarda: anular la devolución con reembolso registrado → 409 ──
  const anerr = await apiJ('POST', '/api/erp/supplier-returns/' + returnId + '/cancel', { motivo: 'intento con reembolso' });
  ok(anerr.status === 409, 'anular la devolución con reembolso → 409 (deshacer el reembolso primero)');

  // ── 6. Deshacer el reembolso y anular la devolución → la deuda vuelve ──
  const refundPay = db.prepare('SELECT id FROM supplier_payments WHERE supplier_invoice_id=? ORDER BY id DESC LIMIT 1').get(abonoId).id;
  await apiJ('DELETE', '/api/erp/supplier-invoices/' + abonoId + '/payments/' + refundPay);
  const anog = await apiJ('POST', '/api/erp/supplier-returns/' + returnId + '/cancel', { motivo: 'anulada en gate' });
  ok(anog.status === 200, 'tras deshacer el reembolso, anular la devolución → OK');
  ok(db.prepare('SELECT status FROM supplier_invoices WHERE id=?').get(abonoId).status === 'anulada', 'el abono queda anulado al anular la devolución');
  ok(Math.round(debtTotal() * 100) === Math.round((baseDebt + 100) * 100), 'la deuda vuelve a subir (sin abono): 100');

} finally {
  await browser.close();
  const db2 = new Database(DB_PATH); db2.pragma('journal_mode = WAL');
  // Limpieza sin rastro.
  // Borra las facturas Y sus asientos, los suyos y los de sus pagos, en ese orden. Ver lib/limpiar-asientos.mjs.
  borrarFacturaProveedor(db2, [abonoId, debtId]);
  if (returnId) { db2.prepare('DELETE FROM supplier_return_items WHERE return_id=?').run(returnId); db2.prepare('DELETE FROM supplier_returns WHERE id=?').run(returnId); }
  if (pid) {
    db2.transaction(() => {
      db2.prepare("DELETE FROM stock_movements WHERE (origin_type='purchase' AND origin_id=?) OR (origin_type='supplier_return' AND origin_id=?)").run(pid, returnId || -1);
      db2.prepare('DELETE FROM purchase_items WHERE purchase_id=?').run(pid);
      db2.prepare('DELETE FROM purchases WHERE id=?').run(pid);
      recomputeStock(db2, PRODUCT_ID);
    })();
  }
  const leftover = db2.prepare('SELECT COUNT(*) n FROM supplier_invoices WHERE id IN (?,?)').get(abonoId || -1, debtId || -1).n;
  ok(leftover === 0, 'limpieza: deuda y abono de prueba eliminados');
  ok(!pid || !db2.prepare('SELECT 1 FROM purchases WHERE id=?').get(pid), 'limpieza: compra de prueba eliminada (stock recompuesto)');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  // Y se comprueba que se ha ido de verdad. Si mañana esta comprobación crea un documento nuevo
  // y se olvida de su asiento, falla AQUÍ y no tres semanas después en el libro de compras.
  const huerfanosDespues = contarHuerfanos(db2);
  ok(huerfanosDespues === huerfanosAntes,
     'limpieza: no deja asientos huérfanos en el libro (antes ' + huerfanosAntes + ', ahora ' + huerfanosDespues + ')');
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador abono/reembolso a proveedor: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
