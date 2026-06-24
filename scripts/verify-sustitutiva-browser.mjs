// Verificación — PIEZA B · Sustitutiva en navegador headless (Puppeteer), tenant desarrollo, real.
//   node scripts/verify-sustitutiva-browser.mjs
// Desde un ticket real → "Emitir factura completa" → elegir cliente → factura completa con QR →
// enlace bidireccional → ticket marcado sustituido → no aparece cobro nuevo en Cobros.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB);
const token = randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, randomBytes(8).toString('hex'));
// Ticket sustituible más reciente (serie S, emitida, no sustituido) + un cliente.
const ticket = db.prepare("SELECT i.id, i.invoice_number FROM invoices i WHERE i.series='S' AND i.status='emitida' AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.substitutes_invoice_id=i.id) ORDER BY i.id DESC LIMIT 1").get();
const clientId = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get().id;
const paysBefore = db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n;
db.close();

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });

try {
  console.log('\n=== Sustitutiva — navegador ===\n');
  if (!ticket) { ok(false, 'no hay ticket sustituible en dev'); throw new Error('sin ticket'); }
  console.log('  Ticket de prueba: ' + ticket.invoice_number + ' (id ' + ticket.id + ')\n');

  // 1) Ficha del ticket → botón "Emitir factura completa"
  await page.goto(ORIGIN + '/admin/invoices/' + ticket.id, { waitUntil: 'networkidle0' });
  let body = await page.evaluate(() => document.body.innerText);
  ok(/Emitir factura completa/.test(body), 'la ficha del ticket ofrece "Emitir factura completa"');

  // 2) Abrir modal, elegir cliente existente, emitir
  await page.evaluate(() => window.openSust());
  await page.waitForFunction(() => { const s = document.getElementById('sustClient'); return s && s.options.length > 1; }, { timeout: 8000 });
  await page.select('#sustClient', String(clientId));
  await Promise.all([
    page.waitForFunction(() => /\/admin\/invoices\/\d+/.test(location.href) && !location.href.endsWith('/' + ' '), { timeout: 9000 }).catch(() => {}),
    page.evaluate(() => window.emitirSust()),
  ]);
  await page.waitForFunction(() => /Sustituye al ticket/.test(document.body.innerText) || /\/admin\/invoices\/\d+/.test(location.href), { timeout: 9000 });
  await sleep(400);
  const facUrl = page.url();
  const facId = facUrl.match(/\/invoices\/(\d+)/)?.[1];
  body = await page.evaluate(() => document.body.innerText);
  ok(!!facId && facId !== String(ticket.id), 'emite y navega a la factura completa nueva (' + facUrl + ')');
  ok(/Sustituye al ticket/.test(body) && new RegExp(ticket.invoice_number).test(body), 'la factura muestra "Sustituye al ticket ' + ticket.invoice_number + '"');
  ok(/VERI\*FACTU|Veri.?Factu/i.test(body), 'la factura completa lleva su QR/leyenda Veri*Factu');

  // 3) El ticket muestra el enlace inverso "sustituido por..."
  await page.goto(ORIGIN + '/admin/invoices/' + ticket.id, { waitUntil: 'networkidle0' });
  body = await page.evaluate(() => document.body.innerText);
  ok(/Ticket sustituido/.test(body) && new RegExp('F\\d{4}-\\d{4}').test(body), 'el ticket muestra "Ticket sustituido por la factura F…" (enlace inverso)');
  ok(!/Emitir factura completa/.test(body), 'el ticket ya NO ofrece "Emitir factura completa" (no se sustituye dos veces)');

  // 4) Comprobación fiscal + cobros (directo en BD)
  const dbv = new Database(DB, { readonly: true });
  const fac = dbv.prepare('SELECT * FROM invoices WHERE id=?').get(parseInt(facId));
  const reg = dbv.prepare("SELECT tipo_factura FROM verifactu_registros WHERE invoice_id=? AND record_type='alta'").get(fac.id);
  const paysAfter = dbv.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n;
  const facOwnPays = dbv.prepare('SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=?').get(fac.id).n;
  dbv.close();
  ok(fac.series === 'F' && reg.tipo_factura === 'F3' && fac.substitutes_invoice_id === ticket.id, 'fiscal: serie F, TipoFactura F3, referencia al ticket');
  ok(paysAfter === paysBefore && facOwnPays === 0, 'NO se creó cobro nuevo (invoice_payments igual; la sustitutiva sin fila propia)');

  // 5) En Cobros no aparece como pendiente
  await page.goto(ORIGIN + '/admin/cobros', { waitUntil: 'networkidle0' });
  await sleep(400);
  body = await page.evaluate(() => document.body.innerText);
  ok(!new RegExp(fac.invoice_number).test(body), 'la factura sustitutiva NO aparece en Cobros pendientes');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  await browser.close();
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
