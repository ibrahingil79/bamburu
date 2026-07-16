// Gate de navegador — C5/M3: el alta del 2FA del superadmin FUNCIONA de verdad, contra el servidor
// real y con la CSP estricta puesta.
//
// QUÉ MIDE Y POR QUÉ. Los tests de rutas prueban la lógica, pero esta pantalla depende de JavaScript
// dentro de una superficie con CSP estricta (C4b): si el <script> perdiera su nonce, el botón
// "Verificar y activar" no haría NADA — sin error, sin aviso, con el QR tan bonito en pantalla. Un
// 2FA que no se puede activar no protege nada, y no se notaría hasta que alguien intentara usarlo.
// Por eso aquí se PULSA el botón y se escucha al navegador, que es el único que dice la verdad.
//
// SOBRE LA CUENTA. NO se toca la cuenta real: se crea un superadmin DESECHABLE, se le monta y activa
// el 2FA, y se borra al final pase lo que pase (finally). Activar el 2FA de la cuenta real desde un
// script sería la peor idea posible: si el script muriera a mitad, quedaría con un 2FA cuyos códigos
// no tiene nadie — exactamente el bloqueo que C5 existe para evitar.
//
//   node scripts/gate-c5-2fa-superadmin.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { join } from 'path';
import bcrypt from 'bcrypt';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
const codigoDe = async (secret) => {
  const r = await totp.generate({ secret });
  return typeof r === 'string' ? r : (r.otp ?? r.token);
};

const cdb = new Database(join(APP_DIR, 'data', 'control.db'));
const EMAIL = `gate-2fa-${randomBytes(4).toString('hex')}@bamburu.local`;
let saId = null, browser = null;

try {
  // Cuenta desechable + su sesión. El servidor ya está arrancado: lee la misma control.db.
  saId = cdb.prepare('INSERT INTO superadmins (email,password_hash,must_change_password) VALUES (?,?,0)')
    .run(EMAIL, bcrypt.hashSync('da-igual-no-se-usa', 10)).lastInsertRowid;
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  cdb.prepare('INSERT INTO superadmin_sessions (token,superadmin_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(token, saId, now, now + 900, randomBytes(32).toString('base64url'));

  browser = await puppeteer.launch({ ...launchOpts() });
  const p = await browser.newPage();
  p.__errores = [];
  p.on('pageerror', e => p.__errores.push(String(e)));
  await p.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => {
      window.__csp.push(e.violatedDirective + ' ← ' + (e.sourceFile || '') + ':' + e.lineNumber);
    });
  });
  await p.setCookie({ name: 'sadm', value: token, domain: 'localhost', path: '/' });

  console.log('\n[1] La pantalla de alta carga entera bajo la CSP estricta');
  const r = await p.goto(BASE + '/superadmin/2fa', { waitUntil: 'networkidle0' });
  const csp = r.headers()['content-security-policy'] || '';
  ok(/script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp),
    '/superadmin/2fa — nonce sí, unsafe-inline no');
  ok((await p.$('img[src^="data:image/png;base64,"]')) !== null, 'el QR se pinta (la CSP no lo bloquea)');
  ok((await p.$('#code')) !== null && (await p.$('#btnActivar')) !== null, 'están el campo y el botón');
  ok((await p.evaluate(() => window.__csp.length)) === 0, 'ninguna violación de CSP al cargar');

  console.log('\n[2] Un código MALO no activa nada, y lo dice');
  const secreto = await p.evaluate(() => document.querySelector('.card div[style*="ui-monospace"]').textContent.trim());
  ok(/^[A-Z2-7]{32}$/.test(secreto), 'el secreto se lee de la pantalla', secreto);
  await p.type('#code', '000000');
  await p.click('#btnActivar');
  await new Promise(r => setTimeout(r, 600));
  const msgMalo = await p.evaluate(() => document.getElementById('msg').textContent);
  ok(msgMalo.length > 0, 'el botón RESPONDE y sale un mensaje de error — el JS del nonce corre');
  ok((await p.evaluate(() => document.getElementById('codigosBox').style.display)) !== 'block',
    'no se enseñan códigos de rescate con un código malo');
  ok(cdb.prepare('SELECT totp_enabled FROM superadmins WHERE id=?').get(saId).totp_enabled === 0,
    'sigue sin 2FA en la BD');

  console.log('\n[3] EL CRITERIO — con el código de una app real, se activa y salen los códigos');
  await p.evaluate(() => { document.getElementById('code').value = ''; });
  await p.type('#code', await codigoDe(secreto));
  await p.click('#btnActivar');
  await new Promise(r => setTimeout(r, 1500));   // bcrypt × 10 códigos
  ok((await p.evaluate(() => document.getElementById('codigosBox').style.display)) === 'block',
    'aparece el bloque de códigos de rescate');
  const codigos = await p.evaluate(() => document.getElementById('codigos').textContent.trim().split('\n'));
  ok(codigos.length === 10, 'son 10 códigos', String(codigos.length));
  ok(codigos.every(c => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c.trim())), 'con el formato legible XXXXX-XXXXX');
  ok((await p.evaluate(() => document.getElementById('paso1').style.display)) === 'none',
    'el QR desaparece: ya no hace falta y no debe quedarse a la vista');
  ok(cdb.prepare('SELECT totp_enabled FROM superadmins WHERE id=?').get(saId).totp_enabled === 1,
    '2FA ACTIVO en la BD');
  ok(cdb.prepare('SELECT COUNT(*) n FROM superadmin_recovery_codes WHERE superadmin_id=? AND used_at IS NULL').get(saId).n === 10,
    'y 10 códigos guardados (hasheados) esperando');
  ok((await p.evaluate(() => window.__csp.length)) === 0, 'CERO violaciones de CSP en toda la pasada');
  ok(p.__errores.length === 0, 'ningún error de JavaScript', p.__errores.join(' · '));

  console.log('\n[4] La puerta quedó cerrada de verdad: el login ya pide el código');
  // Contexto AISLADO: en el normal sigue la cookie `sadm` que este gate plantó a mano al empezar, y
  // con ella "no hay sesión nueva" sería mentira — estaríamos mirando la vieja. Un navegador limpio
  // es lo único que responde a la pregunta de verdad: ¿entra alguien con solo la contraseña?
  const ctx = await browser.createBrowserContext();
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '/superadmin/login', { waitUntil: 'networkidle0' });
  await p2.type('input[name=email]', EMAIL);
  await p2.type('input[name=password]', 'da-igual-no-se-usa');
  await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle0' }), p2.click('button[type=submit]')]);
  const hayPending = (await p2.$('input[name=pending]')) !== null;
  ok(hayPending, 'la contraseña correcta lleva a la pantalla del código, no al panel');
  const cookies = await p2.cookies();
  ok(!cookies.some(c => c.name === 'sadm' && c.value), 'y NO se ha entregado cookie de sesión');

  console.log(`\n${pass} OK, ${fail} fallos\n`);
} finally {
  if (browser) await browser.close();
  // Pase lo que pase: la cuenta desechable y todo lo suyo, fuera. Si esto no corriera, quedaría una
  // cuenta de superadmin con 2FA en la control.db real — basura con llave.
  if (saId) {
    cdb.prepare('DELETE FROM superadmin_recovery_codes WHERE superadmin_id=?').run(saId);
    cdb.prepare('DELETE FROM superadmin_sessions WHERE superadmin_id=?').run(saId);
    cdb.prepare('DELETE FROM superadmins WHERE id=?').run(saId);
    console.log(`🧹 cuenta desechable ${EMAIL} eliminada`);
  }
  cdb.close();
}

process.exit(fail === 0 ? 0 : 1);
