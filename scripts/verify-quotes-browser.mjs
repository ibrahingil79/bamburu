// Parte B (navegador, servidor real): crear borrador → emitir (PRE-NNNN) → convertir a factura.
//   node scripts/verify-quotes-browser.mjs
//
// ⚙️ SE TRAE SU PROPIO NEGOCIO (24 ago 2026). Esperaba un presupuesto ya convertido a factura en el
// negocio de desarrollo. Y sembrarlo allí no valía: convertir EMITE una factura, y una factura
// emitida entra en la cadena de VERI*FACTU y no se borra. Aquí nace y muere con el negocio.
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

const neg = await negocioDesechable('Gate Presupuestos');
const ORIGIN = neg.base;
let PROD_NAME, CLIENTE_ID, token;
try {
  const semilla = sembrarFlujoDocumentos(neg.db, { stock: 20, precio: 30 });
  PROD_NAME = neg.db.prepare('SELECT name FROM products WHERE id=?').get(semilla.productoId).name;
  CLIENTE_ID = semilla.clienteId;
  token = neg.sesion();
} catch (e) { console.error('✗ No se pudo sembrar: ' + e.message); neg.tirar(); process.exit(1); }

const browser = await puppeteer.launch({ userDataDir: perfilDesechable('verify-quotes-browser'),  headless: 'new', executablePath: '/snap/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: new URL(ORIGIN).hostname, path: '/' });
await autoAceptarPaneles(page);

try {
  console.log('\n=== Presupuesto — Parte B (navegador) ===\n');
  // 1) Crear borrador
  await page.goto(ORIGIN + '/admin/quotes/new', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#f-client');
  await sleep(700);                      // carga de clientes + catálogo
  await page.select('#f-client', String(CLIENTE_ID));   // María García
  await page.click('.line-desc');
  await page.type('.line-desc', PROD_NAME.slice(0, 10), { delay: 25 });
  await page.waitForFunction(() => { const b = document.querySelector('.line-suggest'); return b && b.style.display !== 'none' && b.querySelector('.suggest-item'); }, { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.line-suggest .suggest-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await sleep(300);
  await Promise.all([ page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#btn-save') ]);
  const quoteUrl = page.url();
  const quoteId = quoteUrl.match(/\/quotes\/(\d+)/)?.[1];
  ok(!!quoteId, 'borrador guardado → ' + quoteUrl);
  let body = await page.evaluate(() => document.body.innerText);
  ok(/Borrador/.test(body) && /Emitir presupuesto/.test(body), 'la vista muestra Borrador + botón "Emitir presupuesto"');

  // 2) Emitir → PRE-NNNN
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Emitir presupuesto/.test(x.textContent)); b.click(); });
  await sleep(1500);                      // emitir() hace fetch + location.reload()
  await page.waitForFunction(() => /PRE-\d{4}/.test(document.body.innerText), { timeout: 8000 });
  body = await page.evaluate(() => document.body.innerText);
  const preNum = body.match(/PRE-\d{4}/)?.[0];
  ok(!!preNum && /Emitido/.test(body), 'emitido → número ' + preNum + ' visible + estado Emitido');
  ok(/Convertir a ticket \(próximamente\)/.test(body), 'botón "Convertir a ticket" presente y deshabilitado (se construye con TPV)');
  ok(/Enviar por email/.test(body), 'botón "Enviar por email" presente');

  // 3) Convertir a factura
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Convertir a factura/.test(x.textContent)); b.click(); });
  await page.waitForFunction(() => /\/admin\/invoices\/\d+/.test(location.href), { timeout: 9000 });
  const invUrl = page.url();
  ok(/\/admin\/invoices\/\d+/.test(invUrl), 'convertir a factura → navega a la factura ' + invUrl);
  body = await page.evaluate(() => document.body.innerText);
  ok(/Procede del presupuesto/.test(body), 'la factura indica "Procede del presupuesto ' + preNum + '"');
  const facNum = (body.match(/F\d{4}-\d{4}/) || [''])[0];

  // 4) Enlace bidireccional: el presupuesto muestra "Convertido a factura"
  await page.goto(ORIGIN + '/admin/quotes/' + quoteId, { waitUntil: 'networkidle0' });
  body = await page.evaluate(() => document.body.innerText);
  // ⚙️ 24 ago 2026 · Esto exigía el texto literal «Convertido a factura». El producto dice ahora
  // «Convertido a: <enlaces>» —más general, porque un presupuesto puede convertirse en pedido o en
  // factura— y la aserción medía la REDACCIÓN, no el hecho. Ahora exige el hecho: que el presupuesto
  // diga que se convirtió Y nombre la factura a la que fue.
  ok(/Convertido a:/.test(body), 'el presupuesto dice que se convirtió');
  ok(new RegExp(facNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(body),
     '  y nombra la factura a la que fue (' + facNum + ')');

  // 5) Aparece en el listado con su número y estado
  await page.goto(ORIGIN + '/admin/quotes', { waitUntil: 'networkidle0' });
  body = await page.evaluate(() => document.body.innerText);
  ok(new RegExp(preNum).test(body), 'el listado muestra el presupuesto ' + preNum);
  await page.screenshot({ path: '/home/ubuntu/quote-list.png' });
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  try { await browser.close(); } catch (_) {}
  neg.tirar();
  console.log('  [limpieza] negocio de prueba «' + neg.slug + '» tirado entero');
}
console.log('\n=== RESULTADO PARTE B: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
