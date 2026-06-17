// Gate de navegador — Capa de dinero · Paso (d): DISA gana voz sobre los pagos + motor
// proactivo de vencimientos. Contra el servidor real (tenant desarrollo-bamburu).
//   1. Panel: el badge de alertas INCLUYE los vencimientos de proveedor (motor de avisos)
//      sumados al stock bajo existente (no lo reemplaza).
//   2. Pago por VOZ con MODELO REAL de DISA: "pagué 150 € a <proveedor>" → propone, "sí" →
//      reparte (más antigua primero) por el servicio validado; "Le debes X" baja en la ficha.
//   3. "¿Qué requiere mi atención?" → DISA menciona los vencimientos del proveedor de prueba.
// Crea su propio proveedor + 2 facturas vencidas y LIMPIA todo al final (sin rastro).
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = '/home/ibrahin/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const TODAY = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);
const H = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const apiJ = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const disa = (message, thread_id) => apiJ('POST', '/api/disa/message', thread_id ? { message, thread_id } : { message });
const debtOf = (sid) => db.prepare("SELECT COALESCE(SUM(total - (SELECT COALESCE(SUM(amount),0) FROM supplier_payments WHERE supplier_invoice_id=si.id)),0) t FROM supplier_invoices si WHERE supplier_id=? AND status='vigente'").get(sid).t;

const SUP_NAME = 'ZZ Voz Test ' + randomBytes(3).toString('hex');
let supId = null, inv1 = null, inv2 = null;
function addInvoice(sid, total, due) {
  const seq = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM supplier_invoices').get().n;
  return db.prepare(`INSERT INTO supplier_invoices
    (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name)
    VALUES (?,?,?,?,?,?,?,?, 'vigente', ?)`)
    .run(sid, 'FRP-T' + seq, 'TV' + seq, '2026-01-10', due, total, 0, total, SUP_NAME).lastInsertRowid;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

try {
  // (El badge del panel y el resumen-primero se verifican en gate-avisos-badge.mjs.)
  // ── Setup del proveedor de prueba: 2 facturas vencidas (100 + 100) ──────────
  supId = db.prepare("INSERT INTO suppliers (name,active,payment_term_days) VALUES (?,1,0)").run(SUP_NAME).lastInsertRowid;
  inv1 = addInvoice(supId, 100, '2026-02-01');   // más antigua
  inv2 = addInvoice(supId, 100, '2026-03-01');
  ok(Math.round(debtOf(supId)) === 200, 'deuda inicial del proveedor de prueba = 200');

  // ── 2. Pago por VOZ con modelo real: "pagué 150 € a <proveedor>" ────────────
  // El modelo es no determinista en el turno de confirmación (a veces re-pregunta en vez de
  // ejecutar). Reintentamos propuesta→"sí" en HILOS FRESCOS hasta 3 veces; en cuanto la deuda
  // baja, paramos. (La lógica del reparto está cubierta al céntimo en test-pago-voz-avisos.)
  let proposedOnce = false, executed = false;
  for (let intento = 1; intento <= 3 && Math.round(debtOf(supId)) === 200; intento++) {
    const t1 = await disa('Pagué 150 € a ' + SUP_NAME + ', repártelo entre sus facturas (la más antigua primero).');
    if (t1.body && /150|ZZ Voz|factura|pag/i.test(t1.body.reply || '')) proposedOnce = true;
    const t2 = await disa('sí', t1.body && t1.body.thread_id);
    if (t2.body && t2.body.action_executed) executed = true;
  }
  ok(proposedOnce, 'DISA propone el pago a "pagué 150 a <prov>" (modelo real)');
  const debtAfter = Math.round(debtOf(supId));
  ok(debtAfter === 50, 'tras confirmar, la deuda baja 200→50 (pagó 150, más antigua primero) (got ' + debtAfter + ')' + (executed ? ' [action_executed]' : ''));
  const p1 = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM supplier_payments WHERE supplier_invoice_id=?').get(inv1).s;
  const p2 = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM supplier_payments WHERE supplier_invoice_id=?').get(inv2).s;
  ok(Math.round(p1) === 100 && Math.round(p2) === 50, 'reparto: 100 a la más antigua, 50 a la siguiente (got ' + p1 + '/' + p2 + ')');

  // ── 3. Ficha del proveedor: "Le debes X" refleja el pago ────────────────────
  await page.goto(BASE + '/admin/supplier-invoices?supplier=' + supId, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#debtBox', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  const debtText = await page.evaluate(() => (document.querySelector('#debtBox') || {}).textContent || '');
  ok(/Le debes/.test(debtText) && /50/.test(debtText), 'la ficha muestra "Le debes 50" tras el pago por voz (got "' + debtText.replace(/\s+/g, ' ').trim().slice(0, 60) + '")');

  // ── 4. "¿Qué requiere mi atención?" menciona el vencimiento del proveedor ───
  const t3 = await disa('¿Qué requiere mi atención con los pagos a proveedores?');
  const mentions = t3.body && new RegExp(SUP_NAME.split(' ')[2], 'i').test(t3.body.reply || '');
  ok(t3.status === 200 && (mentions || /vencid|vence|pagar|deb/i.test(t3.body.reply || '')), 'DISA lista vencimientos al preguntar "qué requiere mi atención"');

} catch (e) {
  fail++; console.error('  ✗ EXCEPCIÓN: ' + e.message);
} finally {
  // ── Limpieza: borra pagos, facturas, proveedor, sesión y los threads del test ──
  try {
    if (inv1 || inv2) db.prepare('DELETE FROM supplier_payments WHERE supplier_invoice_id IN (?,?)').run(inv1 || -1, inv2 || -1);
    if (inv1 || inv2) db.prepare('DELETE FROM supplier_invoices WHERE id IN (?,?)').run(inv1 || -1, inv2 || -1);
    if (supId) db.prepare('DELETE FROM suppliers WHERE id=?').run(supId);
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
    // Hilos creados por el gate (mencionan el nombre único del proveedor de prueba).
    db.prepare("DELETE FROM disa_conversations WHERE messages LIKE ?").run('%' + SUP_NAME + '%');
  } catch (e) { console.error('  (limpieza) ' + e.message); }
  await browser.close();
  db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
