/* Verificación visual: mint de sesión owner (dev) + capturas de cada molde.
   Uso: node scripts/shoot.cjs   → escribe docs/diseno/shots/*.png
   ⚠️ PIEZA C: la captura de /admin/orders/pos (POS viejo) quedó OBSOLETA — esa URL se retiró del admin
   y ya no responde; ese shot fallará. No es prueba, no bloquea. Apuntar al mostrador nuevo al retomar. */
const Database = require('better-sqlite3');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/diseno/shots');
fs.mkdirSync(OUT, { recursive: true });

const TENANT_ID = 20, USER_ID = 2;
const token = crypto.randomBytes(32).toString('base64url');
const csrf = crypto.randomBytes(24).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const exp = now + 3600;

// 1) control.db → tenant_sessions (resuelve el tenant)
const ctl = new Database(path.join(ROOT, 'data/control.db'));
ctl.prepare(`INSERT INTO tenant_sessions (tenant_id,session_token,user_id,user_email,user_role,expires_at)
  VALUES (?,?,?,?,?,datetime('now','+1 hour'))`).run(TENANT_ID, token, USER_ID, 'ibrahingil@gmail.com', 'owner');
// 2) tenant.db → admin_sessions (resuelve el usuario/rol)
const tdb = new Database(path.join(ROOT, 'data/tenants/desarrollo-bamburu.db'));
tdb.prepare(`INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)`)
  .run(token, USER_ID, now, exp, csrf);
console.log('sesión minteada:', token.slice(0, 10) + '…');

const SHOTS = [
  ['1-dashboard',        '/admin'],
  ['3-lista-cobros',     '/admin/cobros'],
  ['3-lista-facturas',   '/admin/invoices'],
  ['3-lista-clientes',   '/admin/clients'],
  ['3-lista-productos',  '/admin/products'],
  ['2-doc-factura',      '/admin/invoices/20'],
  ['4-form-factura',     '/admin/invoices/new'],
  ['4-form-empresa',     '/admin/settings'],
  ['7-captura',          '/admin/purchases/capture'],
];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1340, height: 900, deviceScaleFactor: 1.5 });
  await page.setCookie({ name: 'asess', value: token, domain: '127.0.0.1', path: '/' });

  for (const [name, url] of SHOTS) {
    try {
      const resp = await page.goto('http://127.0.0.1:3000' + url, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 600));
      const file = path.join(OUT, name + '.png');
      await page.screenshot({ path: file, fullPage: true });
      console.log(`✓ ${name.padEnd(20)} ${resp.status()}  ${url}`);
    } catch (e) {
      console.log(`✗ ${name.padEnd(20)} ERROR ${url} → ${e.message}`);
    }
  }

  // 1-HERO: estado inicial de la home (saludo + DISA + cifras + lista). El dev tenant tiene
  // conversación, así que el JS oculta el hero; lo revelamos SOLO para la captura (no persiste).
  try {
    await page.goto('http://127.0.0.1:3000/admin', { waitUntil: 'networkidle2', timeout: 20000 });
    await page.evaluate(() => {
      const show = id => { const e = document.getElementById(id); if (e) e.classList.remove('hidden'); };
      show('dh-hero'); show('dh-cards');
      const m = document.getElementById('dh-messages'); if (m) m.classList.remove('visible');
      const ch = document.getElementById('dh-chips'); if (ch) ch.style.display = '';
    });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, '1-dashboard-hero.png'), fullPage: false });
    console.log('✓ 1-dashboard-hero      (estado inicial revelado)');
  } catch (e) { console.log('✗ 1-dashboard-hero ERROR → ' + e.message); }

  // 6-TPV: la página mantiene conexiones abiertas → networkidle2 no llega; usamos domcontentloaded.
  try {
    await page.goto('http://127.0.0.1:3000/admin/orders/pos', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(OUT, '6-tpv.png'), fullPage: false });
    console.log('✓ 6-tpv                 (domcontentloaded)');
  } catch (e) { console.log('✗ 6-tpv ERROR → ' + e.message); }

  // 5-MODAL: abrir el modal "Nuevo cliente" sobre la lista
  try {
    await page.goto('http://127.0.0.1:3000/admin/clients', { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 400));
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button,a,[onclick]')].find(el =>
        /nuevo cliente|añadir cliente|\+ cliente/i.test(el.textContent || '') ||
        /openModal/.test(el.getAttribute('onclick') || ''));
      if (btn) { btn.click(); return btn.textContent.trim().slice(0, 30); }
      return null;
    });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(OUT, '5-modal-cliente.png'), fullPage: false });
    console.log('✓ 5-modal-cliente       (botón: ' + opened + ')');
  } catch (e) {
    console.log('✗ 5-modal-cliente ERROR → ' + e.message);
  }

  await browser.close();
  // limpiar la sesión minteada
  ctl.prepare('DELETE FROM tenant_sessions WHERE session_token=?').run(token);
  tdb.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  console.log('listo. capturas en docs/diseno/shots/');
})();
