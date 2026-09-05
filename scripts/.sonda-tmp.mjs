// SONDA (Report-Only) — mide qué bloquearía la política estricta en las pantallas candidatas.
// No endurece nada: solo escucha lo que el navegador DECLARA. Borra su propia sesión al salir.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';

const BASE = 'http://desarrollo-bamburu.localhost:3011';
const db = new Database(tenantDb('desarrollo-bamburu'));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok = 'sonda-csp-' + randomBytes(12).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 1800, randomBytes(16).toString('hex'));

const RUTAS = process.argv.slice(2);
const browser = await puppeteer.launch({ ...launchOpts() });
try {
  const p = await browser.newPage();
  await p.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => {
      window.__csp.push(e.violatedDirective + ' ← ' + (e.sourceFile || '').split('/').pop() + ':' + e.lineNumber);
    });
  });
  await p.setCookie({ name: 'asess', value: tok, domain: 'desarrollo-bamburu.localhost', path: '/' });
  let sucias = 0;
  for (const ruta of RUTAS) {
    const r = await p.goto(BASE + ruta, { waitUntil: 'networkidle0' });
    const ro = (r.headers()['content-security-policy-report-only'] || '');
    await new Promise(x => setTimeout(x, 500));
    const v = await p.evaluate(() => { const x = window.__csp || []; window.__csp = []; return x; });
    const atrib = await p.evaluate(() => (document.documentElement.outerHTML
      .replace(/<script[\s\S]*?<\/script>/gi, '').match(/\son[a-z]+\s*=\s*"/gi) || []).length);
    if (v.length || atrib) sucias++;
    console.log((v.length || atrib ? ' ✗ ' : ' ✓ ') + ruta.padEnd(40)
      + 'HTTP ' + r.status() + ' · aviso:' + (ro ? 'sí' : 'NO') + ' · violaciones:' + v.length + ' · handlers:' + atrib
      + (v.length ? '  → ' + v.slice(0, 3).join(' | ') : ''));
  }
  console.log('\n  ' + (RUTAS.length - sucias) + '/' + RUTAS.length + ' limpias bajo la política estricta');
} finally {
  await browser.close();
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok);
  db.close();
}
