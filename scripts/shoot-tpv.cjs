/* Captura aislada del TPV: la página mantiene el renderer ocupado (scanner/animación),
   así que paramos la actividad y subimos protocolTimeout antes de capturar. */
const Database = require('better-sqlite3');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/diseno/shots');
const TENANT_ID = 20, USER_ID = 2;
const token = crypto.randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);

const ctl = new Database(path.join(ROOT, 'data/control.db'));
ctl.prepare(`INSERT INTO tenant_sessions (tenant_id,session_token,user_id,user_email,user_role,expires_at)
  VALUES (?,?,?,?,?,datetime('now','+1 hour'))`).run(TENANT_ID, token, USER_ID, 'ibrahingil@gmail.com', 'owner');
const tdb = new Database(path.join(ROOT, 'data/tenants/desarrollo-bamburu.db'));
tdb.prepare(`INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)`)
  .run(token, USER_ID, now, now + 3600, crypto.randomBytes(16).toString('hex'));

(async () => {
  const jsOff = process.argv.includes('--no-js');
  const browser = await puppeteer.launch({
    headless: 'new', executablePath: '/snap/bin/chromium', protocolTimeout: 90000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  if (jsOff) await page.setJavaScriptEnabled(false);
  await page.setViewport({ width: 1340, height: 900, deviceScaleFactor: 1.25 });
  await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' });
  await page.setRequestInterception(true);                                       // bloquea imágenes pesadas
  page.on('request', req => {
    const t = req.resourceType();
    if (t === 'image' || t === 'media') req.abort(); else req.continue();
  });
  try {
    const resp = await page.goto('http://127.0.0.1:3000/admin/orders/pos', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(OUT, '6-tpv.png'), captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 1340, height: 900 } });
    console.log('✓ 6-tpv  status', resp.status());
  } catch (e) { console.log('✗ 6-tpv ERROR → ' + e.message); }
  await browser.close();
  ctl.prepare('DELETE FROM tenant_sessions WHERE session_token=?').run(token);
  tdb.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
})();
