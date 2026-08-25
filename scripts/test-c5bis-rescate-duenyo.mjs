// C5-bis — Códigos de rescate del 2FA para los DUEÑOS de negocio.
//
// El agujero que cierra: el dueño podía activar el 2FA y, al perder el móvil, quedarse fuera de su
// negocio PARA SIEMPRE. La única salida era que alguien entrara por SSH. El superadmin tenía red
// desde C5; los clientes, no.
//
// Contra un tenant DESECHABLE (BD temporal), nunca contra una cuenta real ni contra el 2FA de nadie.
// Los códigos TOTP los genera OTPLIB —librería estándar independiente, la misma familia que Google
// Authenticator—: que nuestro core/totp.js acepte lo que genera es la prueba de que una app real
// entra. Un test que reimplementara el algoritmo se aprobaría a sí mismo.
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
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

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_no_se_envia_nada';
const raiz = mkdtempSync(join(tmpdir(), 'bamburu-c5bis-'));
mkdirSync(join(raiz, 'data'));
mkdirSync(join(raiz, 'data', 'tenants'));
const cwdOriginal = process.cwd();
process.chdir(raiz);   // control.db desechable (recordSecurityEvent escribe ahí)

try {
  const { runMigrations } = await import('../modules/erp/models.js');
  const { createAuthRoutes } = await import('../modules/erp/routes/auth.js');
  const { createPerfilRoutes } = await import('../modules/erp/routes/perfil.js');
  const { hashPassword, countUnusedAdminRecoveryCodes } = await import('../core/auth.js');
  const { generateSecret } = await import('../core/totp.js');
  const { normalizar } = await import('../core/recovery-codes.js');
  const cdb = await import('../core/control-db.js');
  cdb.initControlDb();

  const db = new Database(join(raiz, 'tenant.db'));
  db.pragma('journal_mode = WAL');
  runMigrations(db);   // ← la migración REAL: si la tabla no nace aquí, esto revienta

  const totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
  const codigoDe = async (secret) => {
    const r = await totp.generate({ secret });
    return typeof r === 'string' ? r : (r.otp ?? r.token);
  };

  const PW = 'contrasenya-del-duenyo';
  const EMAIL = 'duenyo@minegocio.test';
  const userId = db.prepare("INSERT INTO admin_users (name,email,password_hash,role) VALUES ('Ana',?,?,'owner')")
    .run(EMAIL, await hashPassword(PW)).lastInsertRowid;

  // App como en producción: auth (login) + perfil bajo sesión.
  const app = new Hono();
  app.route('/admin', createAuthRoutes(db));
  const { views: perfilViews } = createPerfilRoutes(db);
  const admin = new Hono();
  admin.use('*', async (c, next) => {
    c.set('session', { userId, role: 'owner', userName: 'Ana', csrfToken: 'csrf-test' });
    c.set('db', db); return next();
  });
  admin.route('/perfil', perfilViews);
  app.route('/admin', admin);

  const ENV = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
  const post = (ruta, datos, ip = '10.0.0.1') => app.request(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip, host: 'x.bamburu.com' },
    body: new URLSearchParams(datos).toString(),
  }, ENV);
  const get = (ruta) => app.request(ruta, { headers: { host: 'x.bamburu.com' } }, ENV);
  const sacarPending = (html) => (html.match(/name="pending" value="([^"]+)"/) || [])[1];
  const sacarCookie = (r) => (String(r.headers.get('set-cookie') || '').match(/asess=([A-Za-z0-9_-]+)/) || [])[1];
  const login = (ip) => post('/admin/login', { email: EMAIL, password: PW }, ip);

  console.log('\n[1] La migración crea la tabla, es aditiva e idempotente');
  {
    runMigrations(db);   // dos veces seguidas: no debe romper ni duplicar
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_recovery_codes'").get();
    check('admin_recovery_codes existe', !!t);
    check('correr las migraciones dos veces no rompe', true);
    // Reversible/no destructiva: la cuenta del dueño sigue intacta tras repetir las migraciones.
    // (En la BD también está la semilla admin@bamburu.com que crea runMigrations; en un alta real
    // el provisioning la sustituye por el dueño. Por eso se comprueba la FILA, no el total.)
    check('la cuenta del dueño sigue intacta (no fue destructiva)',
      db.prepare('SELECT email FROM admin_users WHERE id=?').get(userId)?.email === EMAIL);
  }

  console.log('\n[2] Sin 2FA el login no cambia (no se ha roto lo que había)');
  {
    const r = await login('10.1.0.1');
    check('login correcto → 302 con sesión', r.status === 302 && !!sacarCookie(r));
  }

  console.log('\n[3] EL CRITERIO — activar EXIGE código de app válido y da 10 códigos');
  {
    const pagina = await get('/admin/perfil');
    const html = await pagina.text();
    const secret = (html.match(/class="pf-secret">([A-Z2-7]{32})</) || [])[1];
    check('el Perfil enseña QR y secreto', html.includes('<img src="data:image/png;base64,') && !!secret);

    const malo = await post('/admin/perfil/confirm-2fa', { code: '000000', _csrf: 'csrf-test' });
    check('código incorrecto → NO activa', (malo.headers.get('location') || '').includes('err='));
    check('sigue sin 2FA en la BD', db.prepare('SELECT totp_enabled FROM admin_users WHERE id=?').get(userId).totp_enabled === 0);
    check('y sin códigos', countUnusedAdminRecoveryCodes(db, userId) === 0);

    const bueno = await post('/admin/perfil/confirm-2fa', { code: await codigoDe(secret), _csrf: 'csrf-test' });
    const cuerpo = await bueno.text();
    check('código de una app REAL (otplib) → activa', bueno.status === 200);
    check('2FA activo en la BD', db.prepare('SELECT totp_enabled FROM admin_users WHERE id=?').get(userId).totp_enabled === 1);

    const codigos = [...cuerpo.matchAll(/class="rc-code">([A-Z2-9]{5}-[A-Z2-9]{5})</g)].map(m => m[1]);
    check('EL CRITERIO · enseña 10 códigos, una sola vez', codigos.length === 10, String(codigos.length));
    check('todos distintos', new Set(codigos).size === 10);
    check('guardados: 10 sin usar', countUnusedAdminRecoveryCodes(db, userId) === 10);
    check('EL CRITERIO · guardados CIFRADOS, nunca en claro', (() => {
      const filas = db.prepare('SELECT code_hash FROM admin_recovery_codes WHERE admin_user_id=?').all(userId);
      return filas.length === 10 && filas.every(f => f.code_hash.startsWith('$2')
        && !codigos.some(x => f.code_hash.includes(normalizar(x))));
    })());
    check('EL CRITERIO · el "Terminar" nace BLOQUEADO', /id="rcFin"[^>]*pointer-events:none/.test(cuerpo));
    check('y hay casilla de "he guardado"', cuerpo.includes('id="rcOk"') && cuerpo.includes('He guardado mis códigos'));
    check('se puede copiar y descargar', cuerpo.includes('id="rcCopiar"') && cuerpo.includes('id="rcBajar"'));
    check('queda registrado en Actividad',
      db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action LIKE '%dos pasos%'").get().n >= 1);

    globalThis.__secret = secret;
    globalThis.__codigos = codigos;
  }

  const SECRET = globalThis.__secret;
  const CODIGOS = globalThis.__codigos;

  console.log('\n[4] Con el 2FA puesto, la contraseña ya no basta');
  {
    const r = await login('10.2.0.1');
    check('la contraseña correcta ya NO da sesión', !sacarCookie(r) && r.status === 200);
    const html = await r.text();
    check('sale la pantalla del código', !!sacarPending(html));
    check('y dice que vale un código de rescate', html.includes('rescate'));
  }

  console.log('\n[5] EL CRITERIO — un código de rescate entra UNA vez y luego es rechazado');
  {
    const html = await (await login('10.3.0.1')).text();
    const r = await post('/admin/verify-2fa', { pending: sacarPending(html), code: CODIGOS[0] }, '10.3.0.2');
    check('EL CRITERIO · con un código de rescate SE ENTRA (móvil perdido)', r.status === 302 && !!sacarCookie(r));
    check('queda gastado: 9 sin usar', countUnusedAdminRecoveryCodes(db, userId) === 9);
    check('con marca de CUÁNDO se gastó',
      !!db.prepare('SELECT used_at FROM admin_recovery_codes WHERE admin_user_id=? AND used_at IS NOT NULL').get(userId)?.used_at);

    const html2 = await (await login('10.3.0.3')).text();
    const r2 = await post('/admin/verify-2fa', { pending: sacarPending(html2), code: CODIGOS[0] }, '10.3.0.4');
    check('EL CRITERIO · el MISMO código por segunda vez → NO entra', !sacarCookie(r2) && r2.status === 400);
    check('y no descuenta de más: siguen 9', countUnusedAdminRecoveryCodes(db, userId) === 9);

    // Como lo teclea una persona con prisa: minúsculas y sin guion.
    const html3 = await (await login('10.3.0.5')).text();
    const r3 = await post('/admin/verify-2fa', { pending: sacarPending(html3), code: CODIGOS[1].toLowerCase().replace('-', ' ') }, '10.3.0.6');
    check('otro código, en minúsculas y sin guion → entra igual', r3.status === 302 && !!sacarCookie(r3));
    check('quedan 8', countUnusedAdminRecoveryCodes(db, userId) === 8);
  }

  console.log('\n[6] EL CRITERIO — usar un código queda REGISTRADO (para que lo vea el dueño)');
  {
    const filas = db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE '%rescate%'").all();
    check('EL CRITERIO · la entrada con rescate está en su Actividad', filas.length >= 2, `${filas.length} apuntes`);
    check('y dice cuántos le quedan', filas.some(f => /Quedan \d+/.test(f.details || '')));
    check('el CÓDIGO nunca se registra (sería publicar la llave usada)',
      !filas.some(f => CODIGOS.some(x => (f.details || '').includes(x))));
    const ev = cdb.controlDb.prepare("SELECT COUNT(*) n FROM security_events WHERE type='login_2fa_rescate'").get().n;
    check('y levanta evento de seguridad', ev >= 2, String(ev));
  }

  console.log('\n[7] El código de la app sigue valiendo tras usar rescates');
  {
    const html = await (await login('10.4.0.1')).text();
    const r = await post('/admin/verify-2fa', { pending: sacarPending(html), code: await codigoDe(SECRET) }, '10.4.0.2');
    check('el TOTP no se ve afectado por los rescates gastados', r.status === 302 && !!sacarCookie(r));
  }

  console.log('\n[8] EL CRITERIO — regenerar exige código e invalida el juego anterior');
  {
    const mal = await post('/admin/perfil/regenerar-rescate', { code: '000000', _csrf: 'csrf-test' });
    check('sin código válido → no regenera', (mal.headers.get('location') || '').includes('err='));
    check('siguen los mismos 8', countUnusedAdminRecoveryCodes(db, userId) === 8);

    const r = await post('/admin/perfil/regenerar-rescate', { code: await codigoDe(SECRET), _csrf: 'csrf-test' });
    const cuerpo = await r.text();
    const nuevos = [...cuerpo.matchAll(/class="rc-code">([A-Z2-9]{5}-[A-Z2-9]{5})</g)].map(m => m[1]);
    check('con código válido → 10 códigos nuevos', nuevos.length === 10);
    check('vuelve a haber 10 sin usar', countUnusedAdminRecoveryCodes(db, userId) === 10);
    check('son otros', !nuevos.some(x => CODIGOS.includes(x)));
    check('el "Terminar" también nace bloqueado aquí', /id="rcFin"[^>]*pointer-events:none/.test(cuerpo));

    // Los VIEJOS, de verdad, contra la puerta:
    const html = await (await login('10.5.0.1')).text();
    const viejo = await post('/admin/verify-2fa', { pending: sacarPending(html), code: CODIGOS[2] }, '10.5.0.2');
    check('EL CRITERIO · un código del juego VIEJO ya no entra', !sacarCookie(viejo));

    // Y un rescate NUEVO también sirve para regenerar (no solo el de la app).
    const r2 = await post('/admin/perfil/regenerar-rescate', { code: nuevos[0], _csrf: 'csrf-test' });
    check('regenerar acepta también un código de rescate', r2.status === 200);
    check('y ese rescate se gasta al usarlo', countUnusedAdminRecoveryCodes(db, userId) === 10);
  }

  console.log('\n[9] Desactivar borra los códigos (nada de llaves bajo el felpudo)');
  {
    await post('/admin/perfil/disable-2fa', { _csrf: 'csrf-test' });
    const u = db.prepare('SELECT totp_enabled, totp_secret FROM admin_users WHERE id=?').get(userId);
    check('2FA desactivado', u.totp_enabled === 0 && u.totp_secret === null);
    check('EL CRITERIO · no sobrevive NINGÚN código de rescate', countUnusedAdminRecoveryCodes(db, userId) === 0);
    check('ni siquiera gastados', db.prepare('SELECT COUNT(*) n FROM admin_recovery_codes WHERE admin_user_id=?').get(userId).n === 0);
    const r = await login('10.6.0.1');
    check('vuelve a entrar solo con contraseña', r.status === 302 && !!sacarCookie(r));
  }

  console.log('\n[10] Las rutas huérfanas ya no activan nada (puerta trasera cerrada)');
  {
    for (const ruta of ['/admin/setup-2fa']) {
      const r = await get(ruta);
      check(`GET ${ruta} → redirige al Perfil`, r.status === 302 && r.headers.get('location') === '/admin/perfil');
    }
    const antes = db.prepare('SELECT totp_enabled FROM admin_users WHERE id=?').get(userId).totp_enabled;
    const r = await post('/admin/confirm-2fa', { code: '123456' });
    check('POST /admin/confirm-2fa → redirige y NO activa', r.status === 302 && r.headers.get('location') === '/admin/perfil');
    check('el 2FA sigue como estaba', db.prepare('SELECT totp_enabled FROM admin_users WHERE id=?').get(userId).totp_enabled === antes);
    const r2 = await post('/admin/disable-2fa', {});
    check('POST /admin/disable-2fa → redirige y NO desactiva', r2.status === 302 && r2.headers.get('location') === '/admin/perfil');
  }

  console.log('\n[11] DISA no toca los códigos');
  {
    const { QUERY_PROTECTED_TABLES, evaluateQueryAccess } = await import('../modules/disa/index.js');
    check('la tabla está en la lista PROTEGIDA', QUERY_PROTECTED_TABLES.has('admin_recovery_codes'));
    const err = evaluateQueryAccess('SELECT * FROM admin_recovery_codes', { isAdmin: true, allTables: ['admin_recovery_codes'], hasPerm: () => true });
    check('ni siquiera un owner puede leerlos por chat (bypass incluido)', !!err, err || '');
  }

  console.log(`\n${'─'.repeat(58)}`);
  console.log(`  ${ok} OK · ${fail} fallos`);
  console.log('─'.repeat(58) + '\n');
  db.close();
} finally {
  process.chdir(cwdOriginal);
  rmSync(raiz, { recursive: true, force: true });
}

process.exit(fail === 0 ? 0 : 1);
