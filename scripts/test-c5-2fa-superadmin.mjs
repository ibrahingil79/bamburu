// C5 · M3 — 2FA (TOTP) para el superadmin, con códigos de rescate.
//
// La cuenta más poderosa de la plataforma: ve todos los negocios y puede suspenderlos. Hasta C5
// entraba solo con contraseña, aunque el esquema ya tuviera las columnas totp_* (muertas).
//
// Ejercita las RUTAS de verdad (Hono app.request) contra una control.db NUEVA y desechable: el
// truco es que control-db.js resuelve su ruta desde process.cwd(), así que basta con chdir a un
// directorio temporal antes de importarlo. La control.db real NO se toca en ningún momento.
//
// Los códigos TOTP los genera OTPLIB — una librería estándar independiente, la misma familia de
// implementación que Google Authenticator. Que core/totp.js (escrito a mano) acepte lo que genera
// otplib es la prueba de que una app real podrá entrar. Un test que reimplementara el algoritmo se
// aprobaría a sí mismo.
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
// 25 ago 2026 · Direcciones de dominio IMPOSIBLE (`.test`), no de dominios que existen de verdad.
// `ej.com`, `minegocio.com` y `barpepe.com` son dominios reales de otra gente: un correo de
// recuperación de contraseña dirigido ahí acaba en casa de un desconocido. `.test` está reservado
// justo para esto (RFC 2606) y la puerta del correo lo desvía a simulación. Ver docs/censo-correos.md.

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};

const raiz = mkdtempSync(join(tmpdir(), 'bamburu-c5m3-'));
mkdirSync(join(raiz, 'data'));
const cwdOriginal = process.cwd();
process.chdir(raiz);   // ← antes de importar control-db.js: ahí decide qué fichero abre

try {
  const { Hono } = await import('hono');
  const { hashPassword } = await import('../core/auth.js');
  const { generateSecret } = await import('../core/totp.js');
  const { normalizar } = await import('../core/recovery-codes.js');
  const cdb = await import('../core/control-db.js');
  const { register } = await import('../modules/superadmin/index.js');

  const totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
  const codigoDe = async (secret) => {
    const r = await totp.generate({ secret });
    return typeof r === 'string' ? r : (r.otp ?? r.token);
  };

  // Las cabeceras de seguridad REALES, como en index.js: /superadmin está en las superficies con CSP
  // estricta (C4b), donde un <script> sin nonce no se ejecuta. Sin este middleware el test pasaría
  // con páginas que en producción tendrían los botones muertos y en silencio.
  const { securityHeaders } = await import('../core/security-headers.js');
  const app = new Hono();
  app.use('*', securityHeaders());
  register(app);
  const ENV = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
  // Una IP distinta por caso: el login del superadmin está limitado a 8 intentos/15 min por IP, y
  // este test hace más de 8. Cada caso con su IP prueba lo suyo sin chocar con el freno.
  const post = (ruta, datos, ip, extra = {}) => app.request(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip, host: 'localhost', ...extra },
    body: new URLSearchParams(datos).toString(),
  }, ENV);
  const postJson = (ruta, datos, ip, extra = {}) => app.request(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, host: 'localhost', ...extra },
    body: JSON.stringify(datos),
  }, ENV);

  const login = (email, password, ip) => post('/superadmin/login', { email, password }, ip);
  const sacarPending = (html) => (html.match(/name="pending" value="([^"]+)"/) || [])[1];
  const sacarCookie = (r) => (String(r.headers.get('set-cookie') || '').match(/sadm=([A-Za-z0-9_-]+)/) || [])[1];
  const csrfDe = (token) => cdb.controlDb.prepare('SELECT csrf_token FROM superadmin_sessions WHERE token=?').get(token)?.csrf_token;

  console.log('\n[1] La migración es aditiva e idempotente');
  {
    cdb.initControlDb();
    cdb.initControlDb();   // dos veces seguidas: no debe reventar ni duplicar
    const t = cdb.controlDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='superadmin_recovery_codes'").get();
    check('la tabla superadmin_recovery_codes existe', !!t);
    check('correr las migraciones dos veces no rompe', true);
  }

  const PW = 'contrasenya-larga-superadmin';
  const EMAIL = 'jefe@bamburu.test';
  cdb.createSuperadmin({ email: EMAIL, password_hash: await hashPassword(PW), must_change_password: 0 });
  const admin = cdb.getSuperadminByEmail(EMAIL);

  console.log('\n[2] Sin 2FA, todo sigue como antes (no se rompe lo que había)');
  {
    const r = await login(EMAIL, PW, '10.0.1.1');
    check('login correcto → 302 con cookie de sesión', r.status === 302 && !!sacarCookie(r));
    const rMal = await login(EMAIL, 'me-la-invento', '10.0.1.2');
    check('contraseña mala → sin cookie', !sacarCookie(rMal));
  }

  console.log('\n[3] Activar 2FA EXIGE un código válido (no se activa a ciegas)');
  {
    const token = sacarCookie(await login(EMAIL, PW, '10.0.2.1'));
    const cookie = `sadm=${token}`;
    const csrf = csrfDe(token);

    // GET /2fa deja el secreto pendiente y pinta el QR
    const pagina = await app.request('/superadmin/2fa', { headers: { cookie, host: 'localhost' } }, ENV);
    const html = await pagina.text();
    check('la pantalla de alta enseña un QR', html.includes('<img src="data:image/png;base64,'));

    // C4b — /superadmin va con CSP estricta: sin nonce, el <script> de esta página no corre y el
    // botón "Activar" no hace NADA, sin un solo error visible. Se comprueba aquí porque el gate de
    // CSP con navegador no llega a esta pantalla (necesitaría un 2FA ya montado).
    const csp = pagina.headers.get('content-security-policy') || '';
    const nonce = (html.match(/<script nonce="([^"]+)"/) || [])[1];
    check('la respuesta trae CSP con nonce y sin unsafe-inline en script-src',
      /script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp));
    check('el <script> de la página lleva un nonce real', !!nonce && nonce !== 'undefined' && nonce.length > 10);
    check('y es EL nonce de esta respuesta (si no, el navegador lo bloquea)', csp.includes(`'nonce-${nonce}'`));
    check('ningún onclick= de atributo (moriría en silencio bajo CSP estricta)', !/\son(click|submit|change|load)=/i.test(html));
    check('el QR sobrevive a la CSP (img-src permite data:)', /img-src[^;]*data:/.test(csp));
    const secret = (html.match(/font-family:ui-monospace,monospace">([A-Z2-7]{32})</) || [])[1];
    check('y el secreto en texto para copiar a mano', !!secret, secret ? `${secret.slice(0, 8)}…` : 'no encontrado');

    const malo = await postJson('/superadmin/2fa/activar', { code: '000000' }, '10.0.2.2', { cookie, 'x-csrf-token': csrf });
    check('código incorrecto → NO activa', malo.status === 400);
    check('sigue sin 2FA en la BD', cdb.getSuperadminById(admin.id).totp_enabled === 0);

    // El código lo genera otplib a partir del secreto del QR: es lo que haría el móvil.
    const bueno = await postJson('/superadmin/2fa/activar', { code: await codigoDe(secret) }, '10.0.2.3', { cookie, 'x-csrf-token': csrf });
    const cuerpo = await bueno.json();
    check('código de una app REAL (otplib) → activa', bueno.status === 200 && cuerpo.ok === true);
    check('el 2FA queda activo en la BD', cdb.getSuperadminById(admin.id).totp_enabled === 1);
    check('devuelve 10 códigos de rescate', Array.isArray(cuerpo.codigos) && cuerpo.codigos.length === 10);
    check('todos distintos', new Set(cuerpo.codigos).size === 10);
    check('se guardan HASHEADOS, nunca en claro', (() => {
      const filas = cdb.controlDb.prepare('SELECT code_hash FROM superadmin_recovery_codes WHERE superadmin_id=?').all(admin.id);
      return filas.length === 10 && filas.every(f => f.code_hash.startsWith('$2') && !cuerpo.codigos.some(c => f.code_hash.includes(normalizar(c))));
    })());

    globalThis.__secret = secret;
    globalThis.__codigos = cuerpo.codigos;
  }

  const SECRET = globalThis.__secret;
  const CODIGOS = globalThis.__codigos;

  console.log('\n[4] EL CRITERIO — sin código válido NO se entra al superadmin');
  {
    const r = await login(EMAIL, PW, '10.0.3.1');
    check('ROJO antes de C5 · la contraseña correcta ya NO da sesión', !sacarCookie(r));
    check('responde la pantalla del segundo factor', r.status === 200);
    const html = await r.text();
    const pending = sacarPending(html);
    check('trae un vale `pending` (y NO el id de la cuenta)', !!pending && !html.includes(`value="${admin.id}"`));

    const malo = await post('/superadmin/verify-2fa', { pending, code: '000000' }, '10.0.3.2');
    check('código inventado → sin sesión', !sacarCookie(malo) && malo.status === 400);

    const vale = await post('/superadmin/verify-2fa', { pending, code: await codigoDe(SECRET) }, '10.0.3.3');
    check('código correcto → AHORA sí, sesión', vale.status === 302 && !!sacarCookie(vale));
  }

  console.log('\n[5] Un `pending` no vale como sesión ni se puede inventar');
  {
    const inventado = await post('/superadmin/verify-2fa', { pending: 'me-lo-invento', code: await codigoDe(SECRET) }, '10.0.4.1');
    check('pending falso → al login, sin sesión', !sacarCookie(inventado));
    // Un pending es de un solo uso: al gastarlo se borra del almacén.
    const html = await (await login(EMAIL, PW, '10.0.4.2')).text();
    const pending = sacarPending(html);
    await post('/superadmin/verify-2fa', { pending, code: await codigoDe(SECRET) }, '10.0.4.3');
    const reusar = await post('/superadmin/verify-2fa', { pending, code: await codigoDe(SECRET) }, '10.0.4.4');
    check('el mismo pending no se reutiliza', !sacarCookie(reusar));
  }

  console.log('\n[6] EL CRITERIO — un código de rescate permite entrar Y se consume');
  {
    const html = await (await login(EMAIL, PW, '10.0.5.1')).text();
    const pending = sacarPending(html);

    const r = await post('/superadmin/verify-2fa', { pending, code: CODIGOS[0] }, '10.0.5.2');
    check('con un código de rescate SE ENTRA (móvil perdido)', r.status === 302 && !!sacarCookie(r));
    check('queda gastado: 9 sin usar', cdb.countUnusedRecoveryCodes(admin.id) === 9);
    check('con marca de CUÁNDO se gastó', !!cdb.controlDb.prepare('SELECT used_at FROM superadmin_recovery_codes WHERE superadmin_id=? AND used_at IS NOT NULL').get(admin.id).used_at);

    // El mismo papel, otra vez: NO.
    const html2 = await (await login(EMAIL, PW, '10.0.5.3')).text();
    const r2 = await post('/superadmin/verify-2fa', { pending: sacarPending(html2), code: CODIGOS[0] }, '10.0.5.4');
    check('EL MISMO código de rescate por segunda vez → NO entra', !sacarCookie(r2) && r2.status === 400);
    check('y no descuenta de más: siguen 9', cdb.countUnusedRecoveryCodes(admin.id) === 9);

    // Otro código distinto sí vale, y se tolera cómo lo teclea una persona: minúsculas y sin guion.
    const html3 = await (await login(EMAIL, PW, '10.0.5.5')).text();
    const r3 = await post('/superadmin/verify-2fa', { pending: sacarPending(html3), code: CODIGOS[1].toLowerCase().replace('-', ' ') }, '10.0.5.6');
    check('otro código, en minúsculas y sin guion → entra igual', r3.status === 302 && !!sacarCookie(r3));
    check('quedan 8', cdb.countUnusedRecoveryCodes(admin.id) === 8);
  }

  console.log('\n[7] El código de la app sigue valiendo después de usar rescates');
  {
    const html = await (await login(EMAIL, PW, '10.0.6.1')).text();
    const r = await post('/superadmin/verify-2fa', { pending: sacarPending(html), code: await codigoDe(SECRET) }, '10.0.6.2');
    check('el TOTP no se ve afectado por los rescates gastados', r.status === 302 && !!sacarCookie(r));
  }

  console.log('\n[8] Regenerar y desactivar exigen el código (no basta la sesión robada)');
  {
    const html = await (await login(EMAIL, PW, '10.0.7.1')).text();
    const token = sacarCookie(await post('/superadmin/verify-2fa', { pending: sacarPending(html), code: await codigoDe(SECRET) }, '10.0.7.2'));
    const cookie = `sadm=${token}`;
    const csrf = csrfDe(token);

    const regenMal = await postJson('/superadmin/2fa/regenerar', { code: '000000' }, '10.0.7.3', { cookie, 'x-csrf-token': csrf });
    check('regenerar sin código válido → 400', regenMal.status === 400);

    const regen = await postJson('/superadmin/2fa/regenerar', { code: await codigoDe(SECRET) }, '10.0.7.4', { cookie, 'x-csrf-token': csrf });
    const d = await regen.json();
    check('regenerar con código → 10 códigos nuevos', regen.status === 200 && d.codigos.length === 10);
    check('vuelve a haber 10 sin usar', cdb.countUnusedRecoveryCodes(admin.id) === 10);
    check('los códigos VIEJOS ya no sirven', !d.codigos.includes(CODIGOS[2]));

    // Los viejos, de verdad, contra la puerta:
    const htmlV = await (await login(EMAIL, PW, '10.0.7.5')).text();
    const viejo = await post('/superadmin/verify-2fa', { pending: sacarPending(htmlV), code: CODIGOS[2] }, '10.0.7.6');
    check('un código de rescate de la lista vieja → NO entra', !sacarCookie(viejo));

    const offMal = await postJson('/superadmin/2fa/desactivar', { code: '000000' }, '10.0.7.7', { cookie, 'x-csrf-token': csrf });
    check('desactivar sin código válido → 400', offMal.status === 400);
    check('sigue activo', cdb.getSuperadminById(admin.id).totp_enabled === 1);

    const sinCsrf = await postJson('/superadmin/2fa/desactivar', { code: await codigoDe(SECRET) }, '10.0.7.8', { cookie });
    check('sin CSRF → 403 aunque el código sea bueno', sinCsrf.status === 403);
  }

  console.log('\n[9] La salida de emergencia del servidor deja la cuenta limpia');
  {
    cdb.disableSuperadminTotp(admin.id);
    const a = cdb.getSuperadminById(admin.id);
    check('2FA desactivado', a.totp_enabled === 0 && a.totp_secret === null);
    check('y NO sobrevive ningún código de rescate', cdb.countUnusedRecoveryCodes(admin.id) === 0);
    const r = await login(EMAIL, PW, '10.0.8.1');
    check('vuelve a entrar solo con contraseña (rescate efectivo)', r.status === 302 && !!sacarCookie(r));
  }

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  ${ok} OK · ${fail} fallos`);
  console.log('─'.repeat(56) + '\n');
} finally {
  process.chdir(cwdOriginal);
  rmSync(raiz, { recursive: true, force: true });
}

process.exit(fail === 0 ? 0 : 1);
