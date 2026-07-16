// C6 — Los cuatro hallazgos BAJA que cambian comportamiento: B3, B2, B4 y B6.
//
// Los otros cuatro (B1, B7, B8, B9) no se prueban aquí: B1/B7 son "no imprimir" (se comprueban
// leyendo el fichero, ver test-c6-secretos.mjs), B8 tiene su prueba de redacción allí mismo, y B9
// es permisos de fichero, que se verifican con `find -perm`.
//
// Contra BD desechables: una temporal para el tenant (B3/B2/B4) y una control.db propia vía chdir
// (B6). La control.db real NO se toca.
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_no_se_envia_nada';
const raiz = mkdtempSync(join(tmpdir(), 'bamburu-c6-'));
mkdirSync(join(raiz, 'data'));
mkdirSync(join(raiz, 'data', 'tenants'));
const cwdOriginal = process.cwd();
process.chdir(raiz);   // control-db.js resuelve su ruta desde cwd → control.db desechable

try {
  const { createAuthRoutes } = await import('../modules/erp/routes/auth.js');
  const { createUserRoutes, HIDDEN_PERMS } = await import('../modules/erp/routes/users.js');
  const { hashPassword, createAdminSession } = await import('../core/auth.js');

  const db = new Database(join(raiz, 't.db'));
  db.exec(`
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT DEFAULT 'employee', active INTEGER DEFAULT 1,
      must_change_password INTEGER DEFAULT 0, totp_enabled INTEGER DEFAULT 0, totp_secret TEXT
    );
    CREATE TABLE admin_sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, csrf_token TEXT);
    CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL, expires_at DATETIME NOT NULL, used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT, action TEXT, description TEXT);
    CREATE TABLE user_permissions (admin_user_id INTEGER, permission_id INTEGER, UNIQUE(admin_user_id, permission_id));
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, user_name TEXT,
      action TEXT, entity TEXT, entity_id INTEGER, details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);

  const PW = 'contrasenya-larga-1';
  const EMAIL = 'duenyo@ej.com';
  const userId = db.prepare("INSERT INTO admin_users (name,email,password_hash,role) VALUES ('Ana',?,?,'owner')")
    .run(EMAIL, await hashPassword(PW)).lastInsertRowid;

  const app = new Hono();
  app.route('/admin', createAuthRoutes(db));
  const ENV = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
  const post = (ruta, datos, ip) => app.request(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip, host: 'x.bamburu.com' },
    body: new URLSearchParams(datos).toString(),
  }, ENV);
  const resetear = (token, password, ip = '10.9.9.9') =>
    post('/admin/reset-password', { token, password, password2: password }, ip);
  const nuevoToken = (t) => {
    db.prepare('INSERT INTO password_reset_tokens (admin_user_id, token, expires_at) VALUES (?,?,?)')
      .run(userId, t, new Date(Date.now() + 3600_000).toISOString());
    return t;
  };

  console.log('\n[B3] EL CRITERIO — el reset EXPULSA a quien ya estaba dentro');
  {
    // El escenario que da sentido al botón: alguien entró en tu cuenta. Reseteas... y seguía dentro.
    const sesionIntruso = createAdminSession(db, userId);
    const sesionMovil = createAdminSession(db, userId);
    check('el intruso tiene sesión viva antes', !!db.prepare('SELECT 1 FROM admin_sessions WHERE token=?').get(sesionIntruso));

    const r = await resetear(nuevoToken('tok-b3'), 'contrasenya-nueva-99');
    check('el reset funciona', r.status === 200);
    check('ROJO antes de C6 · la sesión del INTRUSO cae', !db.prepare('SELECT 1 FROM admin_sessions WHERE token=?').get(sesionIntruso));
    check('y la de cualquier otro dispositivo también', !db.prepare('SELECT 1 FROM admin_sessions WHERE token=?').get(sesionMovil));
    check('no queda ninguna sesión de ese usuario', db.prepare('SELECT COUNT(*) n FROM admin_sessions WHERE user_id=?').get(userId).n === 0);
  }

  console.log('\n[B3] Los enlaces de reseteo pendientes también se queman');
  {
    // Si alguien pidió enlaces a tu correo ANTES que tú, seguirían valiendo después de tu cambio.
    const delAtacante = nuevoToken('tok-b3-atacante');
    const mio = nuevoToken('tok-b3-mio');
    await resetear(mio, 'contrasenya-nueva-88');
    check('ROJO antes de C6 · el token que NO se usó queda invalidado',
      db.prepare('SELECT used FROM password_reset_tokens WHERE token=?').get(delAtacante).used === 1);
    const r = await resetear(delAtacante, 'contrasenya-del-atacante');
    check('y ya no sirve para volver a cambiarla', r.status === 400);
  }

  console.log('\n[B3] El mínimo es 10, igual que el cambio propio');
  {
    const r9 = await resetear(nuevoToken('tok-b3-corta'), '123456789');
    check('ROJO antes de C6 · 9 caracteres → rechazada', r9.status === 400);
    check('lo dice claro', (await r9.text()).includes('10 caracteres'));
    const r10 = await resetear(nuevoToken('tok-b3-justa'), '1234567890');
    check('10 → aceptada', r10.status === 200);
  }

  console.log('\n[B2] EL CRITERIO — el servidor rechaza los permisos que la UI solo ocultaba');
  {
    const permApi = new Hono();
    permApi.use('*', async (c, next) => { c.set('session', { userId: 999, role: 'owner', userName: 'Jefe' }); c.set('db', db); return next(); });
    const { api } = createUserRoutes(db);
    permApi.route('/users', api);
    const ins = db.prepare('INSERT INTO permissions (module, action, description) VALUES (?,?,?)');
    const idOculto = ins.run('admin', 'manage_roles', 'oculto').lastInsertRowid;    // está en HIDDEN_PERMS
    const idNormal = ins.run('invoices', 'read', 'normal').lastInsertRowid;         // concedible
    check('el permiso trampa está en la lista de ocultos', HIDDEN_PERMS.has('admin.manage_roles'));

    const enviar = (ids) => permApi.request('/users/1/permissions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permission_ids: ids }),
    }, ENV);

    const bueno = await enviar([idNormal]);
    check('un permiso normal se concede', bueno.status === 200);
    check('y queda guardado', db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE admin_user_id=1').get().n === 1);

    const malo = await enviar([idNormal, idOculto]);
    check('ROJO antes de C6 · colar un permiso OCULTO → 400', malo.status === 400);
    check('dice cuál rechaza', (await malo.json()).permission_ids?.includes(idOculto));
    check('FALLA ENTERO: no aplica "los buenos" del lote rechazado',
      db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE admin_user_id=1').get().n === 1);

    const inventado = await enviar([99999]);
    check('un id que no existe → 400 (no se traga cualquier número)', inventado.status === 400);
    check('cambiar permisos deja rastro en Actividad',
      db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE entity='admin_user'").get().n >= 1);
  }

  console.log('\n[B4] EL CRITERIO — el login se frena por CUENTA, y RALENTIZA (no bloquea)');
  {
    const { registrarFallo, limpiarFallos } = await import('../core/rate-limit.js');
    const VICTIMA = 'victima@ej.com';
    db.prepare("INSERT INTO admin_users (name,email,password_hash,role) VALUES ('V',?,?,'employee')")
      .run(VICTIMA, await hashPassword('otra-contrasenya-larga'));

    // Un atacante rota IPs: el freno por IP no lo ve (1 intento por IP), el de cuenta sí.
    const login = (email, pw, ip) => post('/admin/login', { email, password: pw }, ip);
    for (let i = 0; i < 6; i++) await login(VICTIMA, 'mal' + i, `10.60.0.${i}`);

    const t0 = Date.now();
    const r = await login(VICTIMA, 'mal-otra-vez', '10.60.0.50');
    const tardo = Date.now() - t0;
    check('ROJO antes de C6 · el 7º fallo desde una IP NUEVA ya paga espera', tardo >= 1500, `${tardo} ms`);
    check('pero NO bloquea: sigue respondiendo (302, no 429)', r.status === 302, String(r.status));

    // Lo importante: al legítimo NO se le deja fuera. Entra, solo que esperando.
    const t1 = Date.now();
    const ok2 = await login(VICTIMA, 'otra-contrasenya-larga', '10.60.0.51');
    check('con la contraseña BUENA entra igual (nunca hay bloqueo)', ok2.status === 302 && String(ok2.headers.get('set-cookie') || '').includes('asess='));
    console.log(`      (el legítimo esperó ${Date.now() - t1} ms — molesto, no excluido)`);

    // Y el acierto limpia el historial: fallar y luego entrar no deja penalización.
    const t2 = Date.now();
    await login(VICTIMA, 'otra-contrasenya-larga', '10.60.0.52');
    check('tras acertar, el siguiente login ya no espera', Date.now() - t2 < 500, `${Date.now() - t2} ms`);

    // No es un oráculo: un email que NO existe se frena igual.
    for (let i = 0; i < 6; i++) await login('fantasma@ej.com', 'x', `10.61.0.${i}`);
    const t3 = Date.now();
    await login('fantasma@ej.com', 'x', '10.61.0.50');
    check('un email INEXISTENTE también se frena (el reloj no chiva)', Date.now() - t3 >= 1500, `${Date.now() - t3} ms`);
    limpiarFallos('admin-login-cuenta', VICTIMA, 'global');
  }

  console.log('\n[B6] El enlace de acceso: de un solo uso y con caducidad');
  {
    // El mecanismo que sustituye al oráculo de /find-tenant. La respuesta genérica de la RUTA se
    // prueba contra el servidor vivo (gate-c6-find-tenant.mjs): index.js arranca servidor al
    // importarse, así que aquí se prueba lo que sí es importable — la pieza que decide.
    const cdb = await import('../core/control-db.js');
    cdb.initControlDb();
    const EM = 'quien@ej.com';

    const t = cdb.createAccessLink(EM);
    check('el token es largo e impredecible (32 bytes hex)', /^[0-9a-f]{64}$/.test(t));
    check('mirarlo NO lo gasta', cdb.peekAccessLink(t) === EM && cdb.peekAccessLink(t) === EM);
    check('gastarlo devuelve su email', cdb.consumeAccessLink(t) === EM);
    check('EL CRITERIO · gastarlo DOS veces → no', cdb.consumeAccessLink(t) === null);
    check('y ya ni se puede mirar', cdb.peekAccessLink(t) === null);

    const caducado = cdb.createAccessLink('otro@ej.com');
    cdb.controlDb.prepare('UPDATE tenant_access_links SET expires_at=? WHERE token=?')
      .run(Math.floor(Date.now() / 1000) - 1, caducado);
    check('EL CRITERIO · un enlace caducado no vale', cdb.consumeAccessLink(caducado) === null);
    check('ni se puede mirar', cdb.peekAccessLink(caducado) === null);
    check('un token inventado no vale', cdb.consumeAccessLink('me-lo-invento') === null);
    check('el TTL es corto (30 min)', cdb.ACCESS_LINK_TTL_S === 1800);
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
