// Parte C (DOM headless): el aviso de exceso aparece EN LA LÍNEA al elegir un físico y pedir
// más de lo disponible. (El dueño valida en navegador real; esto es apoyo.)
//   node scripts/verify-over-stock-ui.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
const token = randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, randomBytes(8).toString('hex'));
db.close();

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  console.log('\n=== Factura · exceso de stock — Parte C (aviso en la línea) ===\n');
  await page.goto(ORIGIN + '/admin/invoices/new', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.line-desc', { timeout: 8000 });
  await sleep(600);
  await page.click('.line-desc');
  await page.type('.line-desc', 'Vela Lavanda', { delay: 25 });
  await page.waitForFunction(() => { const b = document.querySelector('.line-suggest'); return b && b.style.display !== 'none' && b.querySelector('.suggest-item'); }, { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.line-suggest .suggest-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await sleep(200);
  await page.evaluate(() => { const q = document.querySelector('.line-qty'); q.value = '1000'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  const r = await page.evaluate(() => { const w = document.querySelector('.line-warn'); return { shown: w && getComputedStyle(w).display !== 'none', text: w ? w.textContent : '', desc: document.querySelector('.line-desc').value }; });
  await page.screenshot({ path: '/home/ubuntu/over-stock-line.png' });
  console.log('    línea="' + r.desc + '"  aviso="' + r.text + '"');
  ok(r.shown && /exceso/.test(r.text), 'aviso de exceso visible EN LA LÍNEA al pedir 1000 de un físico');
  // baja a una cantidad dentro de stock → el aviso desaparece
  await page.evaluate(() => { const q = document.querySelector('.line-qty'); q.value = '2'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(150);
  const hidden = await page.evaluate(() => { const w = document.querySelector('.line-warn'); return !w || getComputedStyle(w).display === 'none'; });
  ok(hidden, 'al bajar la cantidad a lo disponible, el aviso desaparece');
  console.log('    captura: /home/ubuntu/over-stock-line.png');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  await browser.close();
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO PARTE C: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
