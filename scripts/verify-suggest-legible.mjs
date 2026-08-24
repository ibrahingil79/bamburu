// Verificación visual — desplegable de sugerencias del buscador de producto legible.
// Comprueba con ESTILOS COMPUTADOS (no inspección del fuente) que en cada sitio el panel
// es claro y el NOMBRE del producto es oscuro, con contraste suficiente. Capturas a /tmp.
//   node scripts/verify-suggest-legible.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
const now = Math.floor(Date.now() / 1000);
const token = randomBytes(32).toString('base64url');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, randomBytes(16).toString('hex'));
db.close();

const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const L1 = lum(rgb(a)), L2 = lum(rgb(b)); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); };
const isLight = c => lum(rgb(c)) > 0.6;

// 24 ago 2026 · SIN `userDataDir` FIJO, A PROPOSITO. Estas seis compartian /home/ubuntu/.cache/pptr-verify
// y en el barrido la segunda que arrancaba moria con «The browser is already running». Puppeteer miente en
// ese mensaje: lo lanza en cuanto el log de Chromium dice «Failed to create a ProcessSingleton for your
// profile directory». El navegador ajeno no existia — el snap de Chromium no podia crear su cerrojo ahi
// (esos directorios de .cache no llegaron a existir nunca). Darle a cada una el suyo tampoco valia: seguian
// muriendo, cada una en el suyo. Sin la opcion, puppeteer levanta un perfil temporal unico por arranque,
// que ademas mata la otra trampa vieja: dos pestanas con las mismas cookies pisandose la sesion.
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.CHROME || '/snap/bin/chromium',
  
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setCookie(
  { name: 'asess', value: token, domain: '127.0.0.1', path: '/' },
  { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' },
);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function check(label, url, inputSel, panelSel, nameSel, shot) {
  console.log('\n' + label + ' (' + url + '):');
  await page.goto(ORIGIN + url, { waitUntil: 'networkidle0' });
  await page.waitForSelector(inputSel, { timeout: 8000 });
  await sleep(600);                              // deja cargar el catálogo (fetch async en factura)
  await page.click(inputSel);
  await page.type(inputSel, 'vela', { delay: 30 });
  await page.waitForFunction(s => { const b = document.querySelector(s); return b && b.style.display !== 'none' && b.querySelector('strong'); }, { timeout: 8000 }, panelSel);
  const r = await page.evaluate((p, n) => {
    const panel = document.querySelector(p), name = document.querySelector(n);
    const pcs = getComputedStyle(panel), ncs = getComputedStyle(name);
    return { panelBg: pcs.backgroundColor, nameColor: ncs.color, nameText: name.textContent };
  }, panelSel, nameSel);
  await page.screenshot({ path: shot });
  const cr = contrast(r.panelBg, r.nameColor);
  console.log('    panel-bg=' + r.panelBg + '  nombre-color=' + r.nameColor + '  contraste=' + cr.toFixed(1) + ':1  ("' + r.nameText + '")');
  ok(isLight(r.panelBg), label + ': panel CLARO (' + r.panelBg + ')');
  ok(!isLight(r.nameColor), label + ': nombre OSCURO (' + r.nameColor + ')');
  ok(cr >= 4.5, label + ': contraste nombre/panel ≥ 4.5:1 (AA) → ' + cr.toFixed(1) + ':1');
  console.log('    captura: ' + shot);
}

try {
  await check('FACTURA · línea (line-search.js)', '/admin/invoices/new', '.line-desc', '.line-suggest', '.line-suggest strong', '/home/ubuntu/sugg-factura.png');
  await check('COMPRA · línea (purchases.js)', '/admin/purchases/new', 'input[id^=prodsearch-]', 'div[id^=suggest-]', 'div[id^=suggest-] strong', '/home/ubuntu/sugg-compra.png');
} catch (e) {
  console.error('ERROR', e.message); fail++;
} finally {
  await browser.close();
  const d2 = new Database(DB); d2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d2.close();
}

console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
