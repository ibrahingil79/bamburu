// Verificación — PIEZA B · Sustitutiva en navegador headless (Puppeteer), servidor real.
// Desde un ticket real → "Emitir factura completa" → elegir cliente → factura completa con QR →
// enlace bidireccional → ticket marcado sustituido → no aparece cobro nuevo en Cobros.
//
// ⚙️ SE TRAE SU PROPIO NEGOCIO (24 ago 2026). Buscaba «el ticket sustituible más reciente» del negocio
// de desarrollo — un dato vivo que no creaba ella y que dejó de existir. Y sembrarlo allí no valía:
// este flujo emite DOS documentos con huella (el ticket y la factura que lo sustituye), y ninguno se
// puede borrar. Aquí los dos nacen y mueren con el negocio.
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer';
import { negocioDesechable, sembrarFlujoDocumentos } from './lib/negocio-desechable.mjs';
import { autoAceptarPaneles } from './lib/gate-env.mjs';
import { emitTicketSvc } from '../modules/erp/routes/invoices.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const neg = await negocioDesechable('Gate Sustitutiva');
const ORIGIN = neg.base;
let ticket, clientId, paysBefore, token;
try {
  const semilla = sembrarFlujoDocumentos(neg.db, { stock: 20, precio: 12 });
  clientId = semilla.clienteId;
  // EL TICKET, emitido aquí: es lo que esta comprobación necesita y no creaba.
  const t = emitTicketSvc(neg.db, {
    lines: [{ product_id: semilla.productoId, quantity: 1 }],
    warehouse_id: semilla.almacenId, payment_method: 'efectivo',
  });
  ticket = neg.db.prepare('SELECT id, invoice_number FROM invoices WHERE id=?').get(t.invoice_id || t.id);
  paysBefore = neg.db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n;
  token = neg.sesion();
} catch (e) { console.error('✗ No se pudo sembrar el ticket: ' + e.message); neg.tirar(); process.exit(1); }

// 24 ago 2026 · SIN `userDataDir` FIJO, A PROPOSITO. Estas seis compartian /home/ubuntu/.cache/pptr-verify
// y en el barrido la segunda que arrancaba moria con «The browser is already running». Puppeteer miente en
// ese mensaje: lo lanza en cuanto el log de Chromium dice «Failed to create a ProcessSingleton for your
// profile directory». El navegador ajeno no existia — el snap de Chromium no podia crear su cerrojo ahi
// (esos directorios de .cache no llegaron a existir nunca). Darle a cada una el suyo tampoco valia: seguian
// muriendo, cada una en el suyo. Sin la opcion, puppeteer levanta un perfil temporal unico por arranque,
// que ademas mata la otra trampa vieja: dos pestanas con las mismas cookies pisandose la sesion.
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: new URL(ORIGIN).hostname, path: '/' });
await autoAceptarPaneles(page);

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
  const dbv = new Database(neg.abs, { readonly: true });
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
  try { await browser.close(); } catch (_) {}
  neg.tirar();
  console.log('  [limpieza] negocio de prueba «' + neg.slug + '» tirado entero');
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
