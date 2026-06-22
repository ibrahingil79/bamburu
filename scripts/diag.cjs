/* Diagnóstico: ¿qué HTML sirve REALMENTE GET /admin? Mint de sesión + fetch real. */
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const token = crypto.randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const ctl = new Database(path.join(ROOT, 'data/control.db'));
ctl.prepare(`INSERT INTO tenant_sessions (tenant_id,session_token,user_id,user_email,user_role,expires_at)
  VALUES (20,?,2,'ibrahingil@gmail.com','owner',datetime('now','+1 hour'))`).run(token);
const tdb = new Database(path.join(ROOT, 'data/tenants/desarrollo-bamburu.db'));
tdb.prepare(`INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)`)
  .run(token, 2, now, now + 3600, crypto.randomBytes(16).toString('hex'));

(async () => {
  const r = await fetch('http://127.0.0.1:3000/admin', { headers: { cookie: 'asess=' + token } });
  const html = await r.text();
  console.log('STATUS', r.status, '· bytes', html.length);
  console.log('content-security-policy:', r.headers.get('content-security-policy') || '(ninguna)');
  const has = s => html.includes(s);
  console.log('--- marcadores en el HTML servido ---');
  console.log('--chrome:#20242F  :', has('--chrome:        #20242F') || has('#20242F'));
  console.log('<aside class=sidebar:', has('<aside class="sidebar"'));
  console.log('sb-brand          :', has('class="sb-brand"'));
  console.log('nav-item count    :', (html.match(/class="nav-item/g) || []).length);
  console.log('<i class="ti  count:', (html.match(/<i class="ti /g) || []).length);
  console.log('disaHome (chat)   :', has('dh-messages') || has('dh-hero'));
  console.log('tabler CDN link   :', has('tabler-icons'));
  console.log('--- primeras refs a --chrome en <style> ---');
  const idx = html.indexOf('--chrome');
  console.log(idx >= 0 ? html.slice(idx, idx + 320) : '(no aparece --chrome)');
  console.log('--- bloque <aside> ... fin de nav ---');
  const a = html.indexOf('<aside');
  console.log(a >= 0 ? html.slice(a, a + 600) : '(no aparece <aside>)');
  ctl.prepare('DELETE FROM tenant_sessions WHERE session_token=?').run(token);
  tdb.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
})();
