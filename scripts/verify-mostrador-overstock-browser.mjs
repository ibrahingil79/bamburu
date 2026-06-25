// Verificación navegador (Chromium real) — Mostrador sobreventa: la línea del físico avisa del exceso
// y la confirmación de Cobrar lo repite. Producto desechable (stock 2), se limpia. No emite (el 201 ya
// está probado por HTTP); solo comprueba los avisos visibles.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';
import { recordMovement } from '../modules/erp/stock.js';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(DB);
const tok = randomBytes(24).toString('base64url'); const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(tok, 2, now, now + 1800, randomBytes(8).toString('hex'));
const wh = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
const sym = randomBytes(3).toString('hex');
const pid = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)").run('ZZZ OverUI ' + sym, 'zzz-overui-' + sym, 'ZU-' + sym, 10, 0, 'active', 'physical', 21, 'general').lastInsertRowid;
db.close();
recordMovement(new Database(DB), { product_id: pid, type: 'apertura', quantity: 2, origin_type: 'opening', warehouse_id: wh });

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/snap/bin/chromium', userDataDir: '/home/ubuntu/.cache/pptr-verify', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setCookie({ name: 'asess', value: tok, domain: '127.0.0.1', path: '/' }, { name: 'btenant', value: 'desarrollo-bamburu', domain: '127.0.0.1', path: '/' });
try {
  console.log('\n=== Mostrador sobreventa — navegador ===\n');
  await page.goto(ORIGIN + '/admin/mostrador', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => Array.isArray(window.catalog) && window.catalog.length > 0 && typeof window.addProduct === 'function', { timeout: 8000 }).catch(() => {});
  // añadir el desechable y subir la cantidad por encima del disponible (2)
  await page.evaluate((id) => window.addProduct(id), pid);
  await page.evaluate(() => window.setQty(0, 5));
  await sleep(200);
  const cartTxt = await page.evaluate(() => document.getElementById('cart').textContent);
  ok(/hay 2, vendes 5 — exceso de 3/.test(cartTxt), 'la LÍNEA del físico avisa del exceso en la propia línea ("hay 2, vendes 5 — exceso de 3")');
  const warnVisible = await page.evaluate(() => { const w = document.getElementById('stockWarn'); return w && w.style.display !== 'none' && /por encima del stock/i.test(w.textContent); });
  ok(warnVisible, 'banner de aviso de sobreventa visible en el ticket');
  // abrir Cobrar → la confirmación repite el aviso
  await page.evaluate(() => window.openCobro());
  await sleep(300);
  const w2 = await page.evaluate(() => { const e = document.getElementById('stockWarn2'); return { vis: e && e.style.display !== 'none', txt: e ? e.textContent : '' }; });
  ok(w2.vis && /vender por encima del stock/i.test(w2.txt) && /exceso de 3/.test(w2.txt), 'la confirmación de Cobrar REPITE el aviso ("…exceso de 3")');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  await browser.close();
  const c = new Database(DB);
  c.prepare('DELETE FROM stock_movements WHERE product_id=?').run(pid);
  c.prepare('DELETE FROM products WHERE id=?').run(pid);
  c.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok);
  c.close();
}
console.log('\n=== RESULTADO NAVEGADOR: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
