// Gate de navegador — C5-ter: la pantalla de códigos del SUPERADMIN no deja terminar sin confirmar
// que se han guardado. Réplica del gate del cliente (gate-c5bis-rescate-duenyo), contra el servidor
// real y con la CSP estricta puesta.
//
// QUÉ MIDE Y POR QUÉ. El cerrojo es JavaScript dentro de una superficie con CSP ESTRICTA: si el
// bloque perdiera su nonce, la casilla no haría nada y "Terminar" se quedaría muerto para siempre —
// o peor, el enlace seguiría abierto y no habría cerrojo ninguno. Las dos formas de fallar son
// silenciosas, así que aquí se PULSA y se escucha al navegador.
//
// SOBRE LA CUENTA. NO se toca la cuenta real ni su 2FA: se crea un superadmin DESECHABLE y se borra
// al final pase lo que pase (finally). Activar el 2FA de la cuenta real desde un script la dejaría
// con códigos que no tiene nadie — el bloqueo que C5 existe para evitar.
//
//   node scripts/gate-c5ter-cerrojo-superadmin.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { join } from 'path';
import bcrypt from 'bcrypt';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ ' + m + (extra ? ' — ' + extra : '')); } };

const totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
const codigoDe = async (secret) => {
  const r = await totp.generate({ secret });
  return typeof r === 'string' ? r : (r.otp ?? r.token);
};

const cdb = new Database(join(APP_DIR, 'data', 'control.db'));
const EMAIL = `gate-c5ter-${randomBytes(4).toString('hex')}@bamburu.local`;
const PW = 'contrasenya-del-gate-c5ter';
let saId = null, browser = null;

try {
  saId = cdb.prepare('INSERT INTO superadmins (email,password_hash,must_change_password) VALUES (?,?,0)')
    .run(EMAIL, bcrypt.hashSync(PW, 10)).lastInsertRowid;
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  cdb.prepare('INSERT INTO superadmin_sessions (token,superadmin_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(token, saId, now, now + 900, randomBytes(32).toString('base64url'));

  browser = await puppeteer.launch({ ...launchOpts() });
  const p = await browser.newPage();
  p.__errores = [];
  p.on('pageerror', e => p.__errores.push(String(e)));
  // Este gate hace 2 logins de superadmin, y el freno son 8 por IP cada 15 min. Todos los gates
  // comparten la IP de loopback, así que encadenar la suite agota el cupo y el SIGUIENTE gate sale
  // rojo por un fallo que no es suyo (comprobado: pasa). Declarando IP propia, este no se come el
  // cupo de nadie. La conexión llega por loopback, así que getClientIp se fía de X-Real-IP —
  // exactamente el camino de producción, donde la pone Caddy.
  const MI_IP = '10.95.0.1';
  await p.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective));
  });
  await p.setExtraHTTPHeaders({ 'X-Real-IP': MI_IP });
  await p.setCookie({ name: 'sadm', value: token, domain: 'localhost', path: '/' });

  console.log('\n[1] Activa el 2FA y ve sus códigos');
  await p.goto(BASE + '/superadmin/2fa', { waitUntil: 'networkidle0' });
  const secreto = await p.evaluate(() => document.querySelector('.card div[style*="ui-monospace"]').textContent.trim());
  ok(/^[A-Z2-7]{32}$/.test(secreto), 'la pantalla enseña el secreto', secreto.slice(0, 8) + '…');
  await p.type('#code', await codigoDe(secreto));
  await p.click('#btnActivar');
  await new Promise(r => setTimeout(r, 1600));   // bcrypt × 10 códigos
  const codigos = await p.evaluate(() => document.getElementById('codigos').textContent.trim().split('\n'));
  ok(codigos.length === 10, 'aparecen los 10 códigos', String(codigos.length));

  console.log('\n[2] EL CRITERIO — no se puede terminar sin marcar la casilla');
  ok((await p.$('#rcOk')) !== null, 'ROJO antes de C5-ter · existe la casilla "he guardado"');
  const bloqueado = await p.evaluate(() => getComputedStyle(document.getElementById('rcFin')).pointerEvents);
  ok(bloqueado === 'none', 'EL CRITERIO · "Terminar" NACE bloqueado');
  // Se intenta de verdad: pulsar sin marcar no debe llevar a ningún sitio.
  const urlAntes = p.url();
  await p.click('#rcFin').catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  ok(p.url() === urlAntes, 'EL CRITERIO · pulsarlo sin marcar NO lleva a ninguna parte', p.url());
  ok((await p.evaluate(() => document.getElementById('codigos').textContent.trim().length)) > 0,
    'y los códigos siguen en pantalla (no se los ha tragado)');

  console.log('\n[3] Al marcarla, se desbloquea y deja terminar');
  await p.click('#rcOk');
  const libre = await p.evaluate(() => getComputedStyle(document.getElementById('rcFin')).pointerEvents);
  ok(libre === 'auto', 'marcar la casilla lo desbloquea — el JS del nonce corre');
  ok((await p.evaluate(() => window.__csp.length)) === 0, 'CERO violaciones de CSP');
  ok(p.__errores.length === 0, 'ningún error de JavaScript', p.__errores.join(' · '));
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('#rcFin')]);
  ok(p.url().includes('/superadmin/negocios'), 'ahora sí, "Terminar" lleva al panel', p.url());

  console.log('\n[4] Y un código de rescate vale UNA sola vez');
  const ctx = await browser.createBrowserContext();   // navegador limpio: sin la cookie plantada
  const p2 = await ctx.newPage();
  await p2.setExtraHTTPHeaders({ 'X-Real-IP': '10.95.0.2' });
  await p2.goto(BASE + '/superadmin/login', { waitUntil: 'networkidle0' });
  await p2.type('input[name=email]', EMAIL);
  await p2.type('input[name=password]', PW);
  await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle0' }), p2.click('button[type=submit]')]);
  ok((await p2.$('input[name=pending]')) !== null, 'la contraseña sola ya no entra: pide el código');

  await p2.type('input[name=code]', codigos[0]);
  await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle0' }), p2.click('button[type=submit]')]);
  ok(p2.url().includes('/superadmin/negocios'), 'entra con el código de rescate', p2.url());
  ok(cdb.prepare('SELECT COUNT(*) n FROM superadmin_recovery_codes WHERE superadmin_id=? AND used_at IS NULL').get(saId).n === 9,
    'queda gastado: quedan 9');

  const ctx2 = await browser.createBrowserContext();
  const p3 = await ctx2.newPage();
  await p3.setExtraHTTPHeaders({ 'X-Real-IP': '10.95.0.3' });
  await p3.goto(BASE + '/superadmin/login', { waitUntil: 'networkidle0' });
  await p3.type('input[name=email]', EMAIL);
  await p3.type('input[name=password]', PW);
  await Promise.all([p3.waitForNavigation({ waitUntil: 'networkidle0' }), p3.click('button[type=submit]')]);
  await p3.type('input[name=code]', codigos[0]);
  await Promise.all([p3.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), p3.click('button[type=submit]')]);
  ok(!p3.url().includes('/superadmin/negocios'), 'EL CRITERIO · el MISMO código por segunda vez → NO entra', p3.url());
  ok(cdb.prepare('SELECT COUNT(*) n FROM superadmin_recovery_codes WHERE superadmin_id=? AND used_at IS NULL').get(saId).n === 9,
    'y no descuenta de más: siguen 9');

  console.log(`\n${pass} OK, ${fail} fallos\n`);
} finally {
  if (browser) await browser.close();
  if (saId) {
    cdb.prepare('DELETE FROM superadmin_recovery_codes WHERE superadmin_id=?').run(saId);
    cdb.prepare('DELETE FROM superadmin_sessions WHERE superadmin_id=?').run(saId);
    cdb.prepare('DELETE FROM superadmins WHERE id=?').run(saId);
    console.log(`🧹 cuenta desechable ${EMAIL} eliminada`);
  }
  cdb.close();
}

process.exit(fail === 0 ? 0 : 1);
