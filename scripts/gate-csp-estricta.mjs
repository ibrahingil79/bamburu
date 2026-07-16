// Gate de navegador — C4b-1: las superficies ENDURECIDAS sirven script-src SIN 'unsafe-inline' y
// siguen funcionando. Contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. Endurecer la CSP no es "cambiar una cabecera": en cuanto una respuesta lleva un
// nonce, el navegador IGNORA 'unsafe-inline' en ESA respuesta y **cualquier `onclick=` de atributo que
// se haya escapado deja de funcionar — en silencio, sin error visible en la página**. Ese es el riesgo
// real de C4b, no el número de líneas. Por eso aquí no basta con mirar la cabecera: se PULSAN los
// botones y se escucha al navegador (`securitypolicyviolation`), que es el único que dice la verdad.
//
// Las superficies endurecidas son las dos donde un XSS duele más y el coste era mínimo:
//   · /registro   — pública y ANÓNIMA (2 handlers).
//   · /superadmin — la cuenta que ve TODOS los negocios (11 handlers). C4a encontró aquí el peor
//                   agujero del proyecto: un nombre de negocio malicioso ejecutándose en esta sesión.
// El ERP (470 handlers) se queda con 'unsafe-inline' a propósito hasta que se decida C4b-4: meterlo
// aquí sin migrar sería exactamente el fallo que este gate existe para impedir.
//
//   node scripts/gate-csp-estricta.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { join } from 'path';

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const cdb = new Database(join(APP_DIR, 'data', 'control.db'));
const saToken = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
cdb.prepare('INSERT INTO superadmin_sessions (token,superadmin_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(saToken, 1, now, now + 900, randomBytes(32).toString('base64url'));

const browser = await puppeteer.launch({ ...launchOpts() });

// Apunta TODA violación de CSP que declare el navegador. Es la red que caza un handler olvidado.
async function nuevaPagina() {
  const p = await browser.newPage();
  p.__csp = [];
  await p.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => {
      window.__csp.push(e.violatedDirective + ' ← ' + (e.sourceFile || '') + ':' + e.lineNumber);
    });
  });
  return p;
}
const violaciones = p => p.evaluate(() => window.__csp || []);
const cabecera = r => (r.headers()['content-security-policy'] || '');

try {
  // ── 1 · La cabecera: nonce sí, unsafe-inline no ──
  console.log('\n[1] La política que se sirve en cada superficie');
  const p1 = await nuevaPagina();
  const r1 = await p1.goto(BASE + '/registro', { waitUntil: 'networkidle0' });
  const csp1 = cabecera(r1);
  ok(/script-src[^;]*'nonce-/.test(csp1), '/registro — script-src lleva nonce');
  ok(!/script-src[^;]*'unsafe-inline'/.test(csp1), "/registro — script-src YA NO lleva 'unsafe-inline'");
  ok(/style-src[^;]*'unsafe-inline'/.test(csp1), "/registro — style-src SÍ lo conserva (decidido: 2027 style=, valor menor)");

  // El nonce de la cabecera y el de la etiqueta tienen que ser el MISMO en la MISMA respuesta,
  // y cambiar en cada petición: un nonce fijo no protege de nada.
  const nonceCab = (csp1.match(/'nonce-([^']+)'/) || [])[1];
  const nonceTag = await p1.evaluate(() => (document.querySelector('script[nonce]') || {}).nonce
    || (document.querySelector('script[nonce]') || {}).getAttribute?.('nonce'));
  ok(!!nonceCab && !!nonceTag, '/registro — hay nonce en la cabecera y en la etiqueta');
  const r1b = await p1.goto(BASE + '/registro', { waitUntil: 'networkidle0' });
  const nonce2 = (cabecera(r1b).match(/'nonce-([^']+)'/) || [])[1];
  ok(nonceCab !== nonce2, 'el nonce CAMBIA en cada petición (no es fijo)');

  // ── 2 · El ERP sigue con la política de siempre: no se ha endurecido de rebote ──
  console.log('\n[2] El ERP NO se ha endurecido (sus 470 handlers siguen vivos, a propósito)');
  const r2 = await p1.goto('http://desarrollo-bamburu.localhost:3000/admin/login', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'unsafe-inline'/.test(cabecera(r2)), "/admin — conserva 'unsafe-inline' (C4b-4 sin decidir)");
  ok(!/script-src[^;]*'nonce-/.test(cabecera(r2)), '/admin — sin nonce: no se ha endurecido a medias');

  // ── 3 · /registro FUNCIONA con la CSP estricta ──
  console.log('\n[3] /registro — la pantalla vive y sus botones responden');
  const p3 = await nuevaPagina();
  await p3.goto(BASE + '/registro', { waitUntil: 'networkidle0' });
  ok((await violaciones(p3)).length === 0, 'ninguna violación de CSP al cargar');
  const jsVivo = await p3.evaluate(() => typeof window.togglePw === 'function' && typeof window.crear === 'function');
  ok(jsVivo, 'el <script> con nonce SÍ se ejecutó (togglePw y crear existen)');
  // El botón de mostrar/ocultar contraseña: se pulsa y tiene que CAMBIAR algo.
  const antes = await p3.evaluate(() => document.getElementById('pw-toggle')?.textContent);
  await p3.evaluate(() => document.getElementById('pw-toggle').click());
  const despues = await p3.evaluate(() => document.getElementById('pw-toggle')?.textContent);
  ok(antes && despues && antes !== despues, 'el botón "Mostrar" responde al clic (' + antes + ' → ' + despues + ')');
  ok((await violaciones(p3)).length === 0, 'y tras pulsarlo sigue sin violaciones');

  // ── 4 · /superadmin FUNCIONA con la CSP estricta ──
  console.log('\n[4] /superadmin — el panel vive y los botones de cada fila responden');
  const p4 = await nuevaPagina();
  await p4.setCookie({ name: 'sadm', value: saToken, domain: 'localhost', path: '/' });
  const r4 = await p4.goto(BASE + '/superadmin/negocios', { waitUntil: 'networkidle0' });
  ok(/script-src[^;]*'nonce-/.test(cabecera(r4)) && !/script-src[^;]*'unsafe-inline'/.test(cabecera(r4)),
     '/superadmin/negocios — nonce sí, unsafe-inline no');
  ok((await violaciones(p4)).length === 0, 'ninguna violación de CSP al cargar');
  ok(await p4.evaluate(() => typeof window.saCap === 'function' && typeof window.saApi === 'function'),
     'los <script> con nonce se ejecutaron (saCap del contenido y saApi del layout)');

  // El clic REAL sobre el botón de una fila: es lo que dispara saCap por delegación.
  // Todo va con guarda: contra un código sin migrar estos elementos NO existen, y un gate que
  // revienta con un TypeError no distingue "he encontrado el fallo" de "estoy roto".
  const hayFilas = await p4.evaluate(() => !!document.querySelector('tbody tr[data-id] button[data-act="cap"]'));
  ok(hayFilas, 'hay al menos un negocio con su botón "Tope IA" (data-act, sin onclick)');
  const abrio = hayFilas && await p4.evaluate(() => document.querySelector('tbody tr[data-id] button[data-act="cap"]').click())
    .then(() => p4.waitForFunction(() => document.getElementById('modalBox').innerHTML.includes('Tope de IA'), { timeout: 8000 }))
    .then(() => true).catch(() => false);
  ok(abrio, 'pulsar "Tope IA" abre su modal → la DELEGACIÓN funciona sin onclick de atributo');
  ok((await violaciones(p4)).length === 0, 'y el modal no genera violaciones');
  // Los botones DENTRO del modal también se enganchan por JS: si no, quedarían muertos.
  ok(await p4.evaluate(() => { const b = document.getElementById('capCancel'); if (!b) return false; b.click(); return document.getElementById('modalBg').style.display === 'none'; }),
     'el "Cancelar" del modal cierra → los botones del innerHTML también están enganchados');

  const todas = [...(await violaciones(p3)), ...(await violaciones(p4))];
  ok(todas.length === 0, 'CERO violaciones de CSP en toda la pasada' + (todas.length ? ': ' + todas[0] : ''));
} finally {
  await browser.close();
  cdb.prepare('DELETE FROM superadmin_sessions WHERE token=?').run(saToken);
  cdb.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' CSP estricta (C4b-1): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
