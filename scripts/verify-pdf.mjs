// Verificación — PDF real (generador compartido). Partes A/B/C (sin servidor HTTP).
//   node scripts/verify-pdf.mjs
// A) helper renderPdfFromHtml: Buffer %PDF no vacío + Inter aplicada (no fallback).
// B) la factura: su HTML imprimible (buildInvoicePaper) lleva QR Verifactu + leyenda.
// C) email del presupuesto: cuerpo corto + PDF adjunto; fallo de PDF → error claro y NO envía.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import puppeteer from 'puppeteer';
import { runMigrations } from '../modules/erp/models.js';
import { renderPdfFromHtml } from '../core/pdf.js';
import { printableShell } from '../modules/erp/layout.js';
import { buildInvoicePaper } from '../modules/erp/routes/invoices.js';
import { createQuoteSvc, emitQuoteSvc, emailQuoteSvc } from '../modules/erp/routes/quotes.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

console.log('\n=== PDF real — Parte A (helper) ===\n');
try {
  const buf = await renderPdfFromHtml(printableShell('<h1>Hola Inter</h1><p>Prueba PDF</p>', { title: 'Prueba' }));
  ok(Buffer.isBuffer(buf) && buf.length > 1000, 'devuelve un Buffer no vacío (' + buf.length + ' bytes)');
  ok(buf.slice(0, 5).toString('latin1') === '%PDF-', 'la cabecera es %PDF- (PDF válido)');

  // Inter aplicada (no fuente de reserva): cargar el mismo shell y comprobar document.fonts.check.
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setContent(printableShell('<h1>Inter</h1>', { title: 'x' }), { waitUntil: 'networkidle0' });
  const interLoaded = await page.evaluate(async () => { try { await document.fonts.ready; } catch {} return document.fonts.check('500 13px Inter'); });
  ok(interLoaded === true, 'Inter cargada y aplicada (document.fonts.check → ' + interLoaded + ', no fallback)');
  await browser.close();
} catch (e) { console.error('  ✗ Parte A ERROR', e.message); fail++; }

console.log('\n=== PDF real — Parte B (factura: QR + leyenda en el HTML imprimible) ===\n');
try {
  const dbReal = new Database('data/tenants/desarrollo-bamburu.db', { readonly: true });
  const inv = dbReal.prepare("SELECT i.* FROM invoices i JOIN verifactu_registros vr ON vr.invoice_id=i.id AND vr.record_type='alta' ORDER BY i.id DESC LIMIT 1").get();
  if (!inv) { ok(false, 'no hay factura con registro Verifactu en dev para la prueba'); }
  else {
    const paper = await buildInvoicePaper(dbReal, inv);
    ok(/VERI\*FACTU/.test(paper), 'el HTML de la factura ' + inv.invoice_number + ' incluye la leyenda VERI*FACTU');
    ok(/sede electrónica de la AEAT/i.test(paper), 'incluye la leyenda "verificable en la sede electrónica de la AEAT"');
    ok(/data:image\/png;base64,/.test(paper), 'incluye el QR de cotejo (imagen embebida)');
    // Y que ese HTML produce un PDF válido:
    const pdf = await renderPdfFromHtml(printableShell(paper, { title: 'Factura ' + inv.invoice_number }));
    ok(pdf.slice(0, 5).toString('latin1') === '%PDF-' && pdf.length > 2000, 'el PDF de la factura (con QR) se genera y es válido (' + pdf.length + ' bytes)');
  }
  dbReal.close();
} catch (e) { console.error('  ✗ Parte B ERROR', e.message); fail++; }

console.log('\n=== PDF real — Parte C (email presupuesto: cuerpo corto + PDF adjunto) ===\n');
const dbPath = join(tmpdir(), 'pdf-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate) VALUES (1,'Acme SL','B11111111',21)").run();
  db.prepare("UPDATE company_config SET country='ES', company_name='Acme SL', email='acme@x.com' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name, fiscal_id, email, client_type) VALUES ('Cliente SL','B22222222','cli@x.com','empresa')").run().lastInsertRowid;
  const qid = createQuoteSvc(db, { client_id: cli, lines: [{ description: 'Servicio', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  emitQuoteSvc(db, qid);

  // C1) éxito: mock de envío captura el payload; mock de PDF devuelve un %PDF.
  let captured = null;
  const sendOk = async (p) => { captured = p; return { data: { id: 'mock' }, error: null }; };
  const pdfOk = async () => Buffer.from('%PDF-1.4\n cuerpo del pdf de prueba '.padEnd(1200, 'x'));
  const r = await emailQuoteSvc(db, qid, { to: 'dest@x.com', sendEmail: sendOk, renderPdf: pdfOk });
  ok(r.sent === true, 'el envío del presupuesto se completa');
  ok(captured && Array.isArray(captured.attachments) && captured.attachments.length === 1, 'el email lleva exactamente 1 adjunto');
  ok(captured.attachments[0].filename === 'Presupuesto-PRE-0001.pdf', 'el adjunto se llama Presupuesto-PRE-0001.pdf (got ' + (captured.attachments[0] || {}).filename + ')');
  ok(Buffer.isBuffer(captured.attachments[0].content) && captured.attachments[0].content.slice(0, 4).toString('latin1') === '%PDF', 'el contenido del adjunto es el Buffer PDF');
  ok(/Adjuntamos tu presupuesto/i.test(captured.html) && !/Base imponible/.test(captured.html), 'el cuerpo es CORTO ("Adjuntamos tu presupuesto…"), sin el desglose del documento');

  // C2) fallo de PDF: renderPdf lanza → emailQuoteSvc ERRA y NO llama a sendEmail.
  let sendCalled = false;
  const sendSpy = async (p) => { sendCalled = true; return { data: { id: 'x' }, error: null }; };
  const pdfFail = async () => { throw new Error('Chromium no disponible (simulado)'); };
  let errored = false;
  try { await emailQuoteSvc(db, qid, { to: 'dest@x.com', sendEmail: sendSpy, renderPdf: pdfFail }); }
  catch (e) { errored = /No se pudo generar el PDF/i.test(e.message); }
  ok(errored, 'fallo de PDF → error claro ("No se pudo generar el PDF…")');
  ok(sendCalled === false, 'con el PDF fallido NO se envía el email (sendEmail no se llama)');
} catch (e) { console.error('  ✗ Parte C ERROR', e.message); fail++; } finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}

console.log('\n=== RESULTADO A+B+C: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
