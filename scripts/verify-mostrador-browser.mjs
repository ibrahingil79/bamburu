// Verificación — PIEZA A · Mostrador, navegador headless (Puppeteer), servidor real.
//   node scripts/verify-mostrador-browser.mjs
//
// ⚙️ SE TRAE SU PROPIO NEGOCIO (24 ago 2026). Esperaba el producto id 6 del negocio de desarrollo, y
// el ticket que emite es una FACTURA SIMPLIFICADA: entra en la cadena de VERI*FACTU y no se borra.
// Esta comprobación era una de las que dejaban tickets sueltos en los datos del dueño. Ahora el
// ticket nace y muere con el negocio, que se tira entero.
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer';
import { negocioDesechable, sembrarFlujoDocumentos } from './lib/negocio-desechable.mjs';
import { autoAceptarPaneles } from './lib/gate-env.mjs';
// 24 ago 2026 · Perfil ÚNICO por arranque y borrado al salir, aunque esto reviente. Ni perfil fijo
// (dos a la vez se matan) ni sin perfil (el temporal de puppeteer no se limpia si hay crash, y eso
// llenó el disco y tiró el servidor el 22 ago). Ver scripts/lib/perfil-chromium.mjs.
import { perfilDesechable } from './lib/perfil-chromium.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const neg = await negocioDesechable('Gate Mostrador');
const ORIGIN = neg.base;
let PROD_ID, PROD_NAME, PRECIO, wid, token;
try {
  // Cifras de la vida real: 12 € con IVA 10 % → 13,20 €, que es lo que este flujo comprueba.
  const semilla = sembrarFlujoDocumentos(neg.db, { stock: 20, precio: 12 });
  PROD_ID = semilla.productoId;
  neg.db.prepare("UPDATE products SET tax_rate=10, tax_band='reducido' WHERE id=?").run(PROD_ID);
  PROD_NAME = neg.db.prepare('SELECT name FROM products WHERE id=?').get(PROD_ID).name;
  PRECIO = semilla.precio;
  wid = semilla.almacenId;
  token = neg.sesion();
} catch (e) { console.error('✗ No se pudo sembrar: ' + e.message); neg.tirar(); process.exit(1); }

const stockNow = () => { const d = new Database(neg.abs, { readonly: true }); const s = d.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=? AND warehouse_id=?').get(PROD_ID, wid).s; d.close(); return s; };

const browser = await puppeteer.launch({ userDataDir: perfilDesechable('verify-mostrador-browser'),  headless: 'new', executablePath: '/snap/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: new URL(ORIGIN).hostname, path: '/' });
await autoAceptarPaneles(page);

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
  const dbq = new Database(neg.abs, { readonly: true });
  const invId = dbq.prepare('SELECT id FROM invoices WHERE invoice_number=?').get(invNum)?.id;
  dbq.close();
  const r = await page.evaluate(async (id) => { const resp = await fetch('/admin/mostrador/' + id + '/pdf'); return { status: resp.status, ct: resp.headers.get('content-type'), head: (await resp.text()).slice(0, 5) }; }, invId);
  ok(r.status === 200 && /application\/pdf/.test(r.ct) && r.head === '%PDF-', 'ticket PDF descargable (200 · application/pdf · %PDF-)');

  // 7) Aparece en Facturas + es F2 simplificada
  await page.goto(ORIGIN + '/admin/invoices', { waitUntil: 'networkidle0' });
  const invBody = await page.evaluate(() => document.body.innerText);
  ok(new RegExp(invNum).test(invBody), 'el ticket aparece en el listado de Facturas (' + invNum + ')');

  // 8) Comprobación fiscal directa: serie S, tipo F2, cobrada (no en worklist de cobros)
  const dbv = new Database(neg.abs, { readonly: true });
  const inv = dbv.prepare('SELECT * FROM invoices WHERE invoice_number=?').get(invNum);
  const reg = dbv.prepare("SELECT tipo_factura FROM verifactu_registros WHERE invoice_id=? AND record_type='alta'").get(inv.id);
  const paid = dbv.prepare('SELECT COALESCE(SUM(amount),0) s, MAX(payment_method) pm FROM invoice_payments WHERE invoice_id=?').get(inv.id);
  dbv.close();
  ok(inv.series === 'S' && reg.tipo_factura === 'F2' && inv.client_id === null, 'fiscal: serie S, tipo F2, sin cliente');
  ok(Math.round(paid.s * 100) === 1320 && paid.pm === 'efectivo', 'cobrada por completo (13,20 € efectivo) → no pendiente');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  try { await browser.close(); } catch (_) {}
  neg.tirar();
  console.log('  [limpieza] negocio de prueba «' + neg.slug + '» tirado entero');
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
