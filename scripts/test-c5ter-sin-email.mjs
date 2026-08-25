// C5-ter · Tarea 2 — el email NO entra en la tabla de eventos de seguridad.
//
// LA CONTRADICCIÓN QUE CIERRA. En C6 cerramos que nadie pudiera sonsacar por HTTP "¿existe este
// email?" (respuesta idéntica, frenos, sin oráculo de reloj). Y mientras tanto, cada login fallido
// escribía el email EN CLARO en `security_events`: la lista de los que se probaron, y —cruzándola
// con los negocios— cuáles existen. La puerta cerrada y la ventana abierta.
//
// Minimización de datos: cuenta conocida → su id (la referencia estable que ya usa el resto del
// sistema); email desconocido → no se guarda el email, solo que alguien probó una cuenta que no
// existe, que es la señal útil sin el dato personal.
//
// Contra BD desechables (control.db propia vía chdir). La control.db real NO se toca.
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
// 25 ago 2026 · Los dominios de las direcciones de prueba pasan a `.test`, que está RESERVADO y no
// puede existir (RFC 2606). Antes usaban dominios que sí existen —de otra gente—, así que un correo
// del producto podía acabar en una bandeja ajena, y cada intento era un rebote contra bamburu.com.
// La puerta del correo los desvía a simulación. Ver docs/censo-correos.md.

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_no_se_envia_nada';
const raiz = mkdtempSync(join(tmpdir(), 'bamburu-c5ter-'));
mkdirSync(join(raiz, 'data'));
const cwdOriginal = process.cwd();
process.chdir(raiz);

try {
  const { createAuthRoutes } = await import('../modules/erp/routes/auth.js');
  const { hashPassword } = await import('../core/auth.js');
  const cdb = await import('../core/control-db.js');
  cdb.initControlDb();

  const db = new Database(join(raiz, 't.db'));
  db.exec(`
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT DEFAULT 'employee', active INTEGER DEFAULT 1,
      must_change_password INTEGER DEFAULT 0, totp_enabled INTEGER DEFAULT 0, totp_secret TEXT
    );
    CREATE TABLE admin_sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, csrf_token TEXT);
    CREATE TABLE admin_recovery_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL, used_at INTEGER DEFAULT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL, expires_at DATETIME NOT NULL, used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);

  const EMAIL = 'duenyo-real@minegocio.test';
  const PW = 'contrasenya-larga-real';
  const userId = db.prepare("INSERT INTO admin_users (name,email,password_hash,role) VALUES ('Ana',?,?,'owner')")
    .run(EMAIL, await hashPassword(PW)).lastInsertRowid;

  const app = new Hono();
  app.route('/admin', createAuthRoutes(db));
  const ENV = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
  const login = (email, pw, ip) => app.request('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip, host: 'x.bamburu.com' },
    body: new URLSearchParams({ email, password: pw }).toString(),
  }, ENV);
  const eventos = () => cdb.controlDb.prepare('SELECT type, detail FROM security_events ORDER BY id').all();
  const conArroba = () => cdb.controlDb.prepare("SELECT COUNT(*) n FROM security_events WHERE detail LIKE '%@%'").get().n;

  console.log('\n[1] EL CRITERIO — un login fallido NO deja el email en la tabla');
  {
    // Cuenta REAL, contraseña mala: el caso que más tentaba a guardar el email.
    await login(EMAIL, 'contrasenya-mala', '10.10.0.1');
    const evs = eventos().filter(e => e.type === 'login_failed');
    check('el evento se registra (la vigilancia sigue viva)', evs.length === 1);
    check('ROJO antes de C5-ter · el email NO está en claro', conArroba() === 0,
      evs.map(e => e.detail).join(' | '));
    check('en su lugar va la referencia estable: su id', evs[0].detail === `usuario #${userId}`, evs[0].detail);
  }

  console.log('\n[2] Un intento contra un email DESCONOCIDO tampoco lo guarda');
  {
    await login('barrido-de-bots@ejemplo.com', 'x', '10.10.0.2');
    const evs = eventos().filter(e => e.type === 'login_failed');
    check('se registra el intento (sigue viéndose que alguien barre)', evs.length === 2);
    check('EL CRITERIO · sin el email', conArroba() === 0);
    check('solo dice que la cuenta no existe', evs[1].detail === 'cuenta desconocida', evs[1].detail);
    check('y NO revela ni un trozo del email probado',
      !evs.some(e => /barrido|ejemplo/i.test(e.detail || '')));
  }

  console.log('\n[3] La tabla distingue lo que hace falta, sin PII');
  {
    // La señal que necesita el superadmin sigue ahí: cuántos fallos, contra qué negocio, desde qué IP,
    // y si iban contra cuentas reales o inventadas. Todo eso SIN un solo email.
    const filas = cdb.controlDb.prepare("SELECT ip, tenant_slug, detail FROM security_events WHERE type='login_failed' ORDER BY id").all();
    check('conserva la IP (sin ella no hay vigilancia)', filas.every(f => !!f.ip), filas.map(f => f.ip).join(','));
    check('conserva el negocio', filas.every(f => f.tenant_slug === 'x' || f.tenant_slug === null));
    check('distingue cuenta real de inventada', filas[0].detail !== filas[1].detail);
  }

  console.log('\n[4] Ningún OTRO evento mete el email (los otros 10 puntos de llamada)');
  {
    // Frenos: el rate-limit dispara su propio evento. Se agota el cupo del forgot por email.
    for (let i = 0; i < 7; i++) {
      await app.request('/admin/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.11.0.1', host: 'x.bamburu.com' },
        body: new URLSearchParams({ email: EMAIL }).toString(),
      }, ENV);
    }
    const frenos = eventos().filter(e => e.type.startsWith('ratelimit:'));
    check('los frenos también registran', frenos.length >= 1, `${frenos.length} eventos`);
    check('EL CRITERIO · en TODA la tabla no hay un solo email', conArroba() === 0);
    check('y ninguna fila contiene el email, ni troceado',
      !eventos().some(e => (e.detail || '').includes(EMAIL.split('@')[0])));
  }

  console.log('\n[5] El comentario del código ya no miente');
  {
    const { readFileSync } = await import('fs');
    const src = readFileSync(join(cwdOriginal, 'modules/erp/routes/auth.js'), 'utf8');
    check('dice que el email no va a NINGÚN sitio del login',
      /el email NO se registra en NINGÚN sitio del login/.test(src));
    check('y explica que antes era falso como regla', /era FALSO como regla/.test(src));
    check('ninguna llamada a recordSecurityEvent pasa `email`',
      !/recordSecurityEvent\([^)]*,\s*email\s*\)/.test(src));
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
