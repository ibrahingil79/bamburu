// Parte B (navegador, servidor real, tenant desarrollo): crear borrador → emitir (PRE-NNNN) →
// convertir a factura → (ticket diferido) → email. NO se envía email real (solo se comprueba el botón).
//   node scripts/verify-quotes-browser.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';
import { autoAceptarPaneles } from './lib/gate-env.mjs';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB);
const token = randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, randomBytes(8).toString('hex'));
db.close();

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });
page.on('dialog', async d => { await d.accept(); });
// Y el panel que sustituyó a esas ventanitas: se acepta igual que se aceptaba el confirm().
await autoAceptarPaneles(page);

try {
  console.log('\n=== Presupuesto — Parte B (navegador) ===\n');
  // 1) Crear borrador
  await page.goto(ORIGIN + '/admin/quotes/new', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#f-client');
  await sleep(700);                      // carga de clientes + catálogo
  await page.select('#f-client', '1');   // María García
  await page.click('.line-desc');
  await page.type('.line-desc', 'Vela', { delay: 25 });
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

  // 4) Enlace bidireccional: el presupuesto muestra "Convertido a factura"
  await page.goto(ORIGIN + '/admin/quotes/' + quoteId, { waitUntil: 'networkidle0' });
  body = await page.evaluate(() => document.body.innerText);
  ok(/Convertido a factura/.test(body), 'el presupuesto muestra el enlace inverso "Convertido a factura"');

  // 5) Aparece en el listado con su número y estado
  await page.goto(ORIGIN + '/admin/quotes', { waitUntil: 'networkidle0' });
  body = await page.evaluate(() => document.body.innerText);
  ok(new RegExp(preNum).test(body), 'el listado muestra el presupuesto ' + preNum);
  await page.screenshot({ path: '/home/ubuntu/quote-list.png' });
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  await browser.close();
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO PARTE B: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
