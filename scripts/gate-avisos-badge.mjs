// Gate de navegador — Paso (d) · corrección: RESUMEN-PRIMERO del badge + estado visto/nuevo
// (Opción C). Contra el servidor real (tenant desarrollo-bamburu). Determinista (sin modelo).
//   1. Badge ROJO con el número = conteo del motor (vencimientos + stock bajo).
//   2. Pulsarlo → DISA da un RESUMEN DE CONTEOS (de avisosDelDia), sin detalle y SIN ofrecer
//      acciones; el conteo del resumen == número del badge. El badge pasa a "visto" (gris).
//   3. Ciclo: tras abrir = visto; una factura NUEVA vencida → vuelve a rojo; empeorar una ya
//      vista → sigue visto. Restaura el estado previo del tenant (huella + datos) al terminar.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { estadoAvisos, resumenAvisos } from '../modules/erp/avisos.js';

const DB_PATH = '/home/ibrahin/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const TODAY = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

// Snapshot del estado a restaurar (huella de visto previa).
const seenSnap = db.prepare('SELECT fingerprint FROM alert_seen WHERE id=1').get();
const SUP_NAME = 'ZZ Avisos ' + randomBytes(3).toString('hex');
let supId = null, invId = null;

const badgeState = () => page.evaluate(() => {
  const b = document.querySelector('#dh-alerts-badge');
  if (!b) return { present: false };
  return { present: true, visto: b.classList.contains('visto'), text: b.textContent.trim() };
});

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

try {
  // Estado de partida determinista: huella vacía → ROJO (el tenant tiene avisos reales).
  db.prepare("INSERT INTO alert_seen (id, fingerprint) VALUES (1,'[]') ON CONFLICT(id) DO UPDATE SET fingerprint='[]'").run();
  const est0 = estadoAvisos(db, TODAY);
  ok(est0.count > 0 && est0.estado === 'rojo', 'partida: hay avisos y estado ROJO (' + est0.count + ' avisos)');
  const groups0 = resumenAvisos(est0.avisos);

  // ── 1. Badge ROJO con el número del motor ───────────────────────────────────
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  let b = await badgeState();
  ok(b.present && !b.visto && b.text.includes(String(est0.count)), 'badge ROJO con el número ' + est0.count + ' (got "' + b.text + '")');

  // ── 2. Pulsar el badge → resumen de conteos, sin acciones; badge → visto ────
  await page.evaluate(() => window.disaShowAlerts());
  await page.waitForFunction(() => {
    const m = document.querySelectorAll('#dh-messages .disa-msg.assistant');
    return m.length && /que mirar|nada pendiente/.test(m[m.length - 1].textContent);
  }, { timeout: 8000 });
  const reply = await page.evaluate(() => {
    const m = document.querySelectorAll('#dh-messages .disa-msg.assistant');
    return m[m.length - 1].textContent;
  });
  ok(/Tienes .* que mirar/.test(reply), 'el resumen-primero sale del motor ("' + reply.slice(0, 70) + '…")');
  // Conteos del resumen == los del badge (cada grupo aparece con su número).
  const okCounts = groups0.every(g => reply.includes(String(g.count)));
  ok(okCounts, 'el resumen lista los conteos por fuente y cuadran con el badge (' + groups0.map(g => g.tipo + '=' + g.count).join(', ') + ')');
  ok(!/recordatorio|mando un email|envío un email|cobr/i.test(reply), 'el resumen NO ofrece acciones (ni emails de cobro)');
  b = await badgeState();
  ok(b.present && b.visto, 'tras abrirlo, el badge pasa a VISTO (gris)');

  // La huella quedó marcada → al recargar, sigue visto.
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  b = await badgeState();
  ok(b.present && b.visto, 'al recargar el panel, el badge sigue VISTO (nada nuevo)');

  // ── 3. Una factura NUEVA vencida → vuelve a ROJO ────────────────────────────
  supId = db.prepare("INSERT INTO suppliers (name,active,payment_term_days) VALUES (?,1,0)").run(SUP_NAME).lastInsertRowid;
  const sq = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM supplier_invoices').get().n;
  invId = db.prepare(`INSERT INTO supplier_invoices (supplier_id,internal_code,supplier_invoice_number,invoice_date,due_date,base,tax,total,status,supplier_name)
    VALUES (?,?,?,?,?,?,?,?, 'vigente', ?)`).run(supId, 'FRP-A' + sq, 'AV' + sq, '2026-01-10', '2026-02-01', 100, 0, 100, SUP_NAME).lastInsertRowid;
  ok(estadoAvisos(db, TODAY).estado === 'rojo', 'aparece una factura vencida NUEVA → estado ROJO');
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  b = await badgeState();
  ok(b.present && !b.visto && b.text.includes(String(est0.count + 1)), 'el badge vuelve a ROJO con el número +1 (got "' + b.text + '")');

  // ── 4. Empeorar una ya vista NO reactiva el rojo ────────────────────────────
  await page.evaluate(() => window.disaShowAlerts());                 // marca visto (incluye la nueva)
  await page.waitForFunction(() => document.querySelectorAll('#dh-messages .disa-msg.assistant').length > 0, { timeout: 8000 });
  db.prepare('UPDATE supplier_invoices SET due_date=? WHERE id=?').run('2026-01-01', invId);   // empeora (más días vencida)
  ok(estadoAvisos(db, TODAY).estado === 'visto', 'que una factura ya vista EMPEORE no reactiva el rojo (sigue VISTO)');

} catch (e) {
  fail++; console.error('  ✗ EXCEPCIÓN: ' + e.message);
} finally {
  try {
    if (invId) db.prepare('DELETE FROM supplier_invoices WHERE id=?').run(invId);
    if (supId) db.prepare('DELETE FROM suppliers WHERE id=?').run(supId);
    // Restaura la huella previa del tenant (deja el badge como estaba).
    if (seenSnap) db.prepare("INSERT INTO alert_seen (id, fingerprint) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint").run(seenSnap.fingerprint);
    else db.prepare('DELETE FROM alert_seen WHERE id=1').run();
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  } catch (e) { console.error('  (limpieza) ' + e.message); }
  await browser.close();
  db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
