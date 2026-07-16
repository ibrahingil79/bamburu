// C5 · M6 — Freno en "he olvidado mi contraseña".
//
// Cuatro propiedades, y las cuatro se comprueban ejercitando las RUTAS de verdad (Hono app.request,
// sin levantar servidor ni tocar la red):
//   1. los intentos repetidos se frenan — por IP y por email (los dos, y por separado)
//   2. la respuesta es idéntica exista o no el email — cuerpo, estado, y sin depender del envío
//   3. el enlace caduca
//   4. el enlace es de un solo uso
//
// El correo NUNCA sale: no hay RESEND_API_KEY de prueba y el envío corre fuera de la respuesta. Que
// el envío reviente y la respuesta siga siendo la misma es, de hecho, una de las cosas que se prueba.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';

// Clave FALSA a propósito, y antes de importar la ruta: el SDK de Resend revienta al construirse sin
// clave, y auth.js lo construye al cargar el módulo. Con esta clave el envío falla al intentar salir
// — que es justo el escenario del caso [2]. De este test no sale ni un correo.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_no_se_envia_nada';
const { createAuthRoutes } = await import('../modules/erp/routes/auth.js');

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};

const dir = mkdtempSync(join(tmpdir(), 'bamburu-c5m6-'));
const db = new Database(join(dir, 't.db'));

// getClientIp solo se fía de x-real-ip si la conexión viene de loopback (= de Caddy). Se imita esa
// condición: socket en 127.0.0.1 + x-real-ip, que es exactamente lo que llega en producción.
const app = new Hono();
app.route('/admin', createAuthRoutes(db));
const ENV = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const pedirEnlace = (email, ip = '10.0.0.1') => app.request('/admin/forgot-password', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip, host: 'test.bamburu.com' },
  body: new URLSearchParams({ email }).toString(),
}, ENV);
const resetear = (token, password) => app.request('/admin/reset-password', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '10.0.0.99', host: 'test.bamburu.com' },
  body: new URLSearchParams({ token, password, password2: password }).toString(),
}, ENV);

const insertarToken = (userId, token, expiresAt) => db.prepare(
  'INSERT INTO password_reset_tokens (admin_user_id, token, expires_at) VALUES (?,?,?)'
).run(userId, token, expiresAt);
const enUnaHora = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const haceUnaHora = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

try {
  db.exec(`
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'employee', active INTEGER DEFAULT 1
    );
    CREATE TABLE password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL, used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- C6/B3: el reset ahora CIERRA las sesiones del usuario, así que esta tabla tiene que estar.
    -- Faltaba, y el test se puso rojo al añadir B3 — pero el fallo era del fixture: una BD de negocio
    -- sin admin_sessions no existe (la crea runMigrations). Un fixture que no puede existir en la
    -- realidad no prueba la realidad.
    CREATE TABLE admin_sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, csrf_token TEXT
    );
  `);
  const EXISTE = 'existe@ej.com';
  const userId = db.prepare(
    "INSERT INTO admin_users (name,email,password_hash,role) VALUES ('Ana',?,'x','owner')"
  ).run(EXISTE).lastInsertRowid;

  console.log('\n[1] EL CRITERIO — la respuesta NO revela si el email existe');
  {
    const rExiste = await pedirEnlace(EXISTE, '10.1.0.1');
    const rNoExiste = await pedirEnlace('fantasma@ej.com', '10.1.0.2');
    const bodyExiste = await rExiste.text();
    const bodyNoExiste = await rNoExiste.text();

    check('mismo código de estado', rExiste.status === rNoExiste.status, `${rExiste.status} vs ${rNoExiste.status}`);
    check('estado 200 (ni 500 ni redirect delator)', rExiste.status === 200);
    check('cuerpo byte a byte IDÉNTICO', bodyExiste === bodyNoExiste);
    check('el texto es el genérico', bodyExiste.includes('Si el email existe en nuestra base de datos'));
  }

  console.log('\n[2] Un fallo del envío NO delata a la cuenta que sí existe');
  {
    // Resend revienta (sin API key, sin red). Antes eso era un 500 — y un 500 solo se podía ver con
    // un email REGISTRADO: el error de infraestructura confirmaba la cuenta.
    const r = await pedirEnlace(EXISTE, '10.2.0.1');
    const body = await r.text();
    check('ROJO antes de C5 · el envío falla y aun así responde 200 genérico', r.status === 200);
    check('nunca asoma "Error al enviar el email"', !body.includes('Error al enviar'));
  }

  console.log('\n[2b] El trabajo diferido SÍ ocurre (responder rápido ≠ no hacer nada)');
  {
    // La respuesta sale ANTES de crear el token (setImmediate, para no delatar por el reloj). El
    // riesgo de ese patrón es callarse: si el trabajo diferido no corriera, la pantalla diría
    // "revisa tu bandeja" y no habría ni token ni correo, y nadie se enteraría. Esto lo vigila.
    // Primero se vacía lo que dejaron pendiente los casos anteriores: sus setImmediate siguen en
    // cola (esperar una respuesta no hace girar el bucle de eventos), y si no, el contador saltaría
    // de golpe y este caso mediría de más.
    await new Promise(r => setImmediate(r));
    const antes = db.prepare('SELECT COUNT(*) n FROM password_reset_tokens WHERE admin_user_id=?').get(userId).n;
    await pedirEnlace(EXISTE, '10.25.0.1');
    await new Promise(r => setImmediate(r));   // un tick: lo justo para que corra lo diferido
    const despues = db.prepare('SELECT COUNT(*) n FROM password_reset_tokens WHERE admin_user_id=?').get(userId).n;
    check('tras responder, el token de reseteo existe', despues === antes + 1);
    const t = db.prepare('SELECT token, expires_at, used FROM password_reset_tokens WHERE admin_user_id=? ORDER BY id DESC LIMIT 1').get(userId);
    check('nace sin usar', t.used === 0);
    check('nace con caducidad futura', new Date(t.expires_at) > new Date());
    check('el token es largo e impredecible (32 bytes hex)', /^[0-9a-f]{64}$/.test(t.token));
  }

  console.log('\n[3] EL CRITERIO — los intentos repetidos se frenan (por IP)');
  {
    const IP = '10.3.0.1';
    const codigos = [];
    for (let i = 0; i < 7; i++) codigos.push((await pedirEnlace(`quien${i}@ej.com`, IP)).status);
    check('ROJO antes de C5 · los 5 primeros pasan', codigos.slice(0, 5).every(s => s === 200), codigos.slice(0, 5).join(','));
    check('del 6º en adelante → 429', codigos.slice(5).every(s => s === 429), codigos.slice(5).join(','));
  }

  console.log('\n[4] EL CRITERIO — y también por EMAIL, aunque cambien la IP');
  {
    // Cuenta propia para este caso: el cupo por email es de 3 por ventana y los casos [1] y [2] ya
    // habían gastado dos de los de EXISTE. Cada caso trae la suya y no se pisan.
    const DIANA = 'diana@ej.com';
    db.prepare("INSERT INTO admin_users (name,email,password_hash,role) VALUES ('Diana',?,'x','owner')").run(DIANA);
    // Barrer una sola cuenta desde IPs distintas: el freno por IP no ve nada raro (una petición por
    // IP); el freno por email sí. Es el caso que el límite por IP, solo, no cubre.
    const codigos = [];
    for (let i = 0; i < 5; i++) codigos.push((await pedirEnlace(DIANA, `10.4.0.${i + 10}`)).status);
    check('3 pasan (cupo por email)', codigos.slice(0, 3).every(s => s === 200), codigos.slice(0, 3).join(','));
    check('la 4ª y 5ª → 429 pese a venir de IPs nuevas', codigos.slice(3).every(s => s === 429), codigos.slice(3).join(','));
  }

  console.log('\n[5] El freno por email distingue cuentas (no es un freno global)');
  {
    const r = await pedirEnlace('otra-distinta@ej.com', '10.5.0.1');
    check('otra cuenta con su propio cupo sigue pasando', r.status === 200);
  }

  console.log('\n[6] EL CRITERIO — el enlace CADUCA');
  {
    insertarToken(userId, 'tok-caducado', haceUnaHora());
    const r = await resetear('tok-caducado', 'contrasenya-nueva-1');
    const body = await r.text();
    check('token caducado → rechazado', r.status === 400);
    check('lo dice y ofrece pedir otro', body.includes('expirado'));
    const u = db.prepare('SELECT password_hash FROM admin_users WHERE id=?').get(userId);
    check('la contraseña NO cambió', u.password_hash === 'x');
  }

  console.log('\n[7] EL CRITERIO — el enlace es de UN SOLO USO');
  {
    insertarToken(userId, 'tok-bueno', enUnaHora());
    const r1 = await resetear('tok-bueno', 'contrasenya-nueva-2');
    check('primer uso: cambia la contraseña', r1.status === 200);
    const u1 = db.prepare('SELECT password_hash FROM admin_users WHERE id=?').get(userId);
    check('el hash ya no es el viejo', u1.password_hash !== 'x');
    check('el token queda marcado como gastado', db.prepare('SELECT used FROM password_reset_tokens WHERE token=?').get('tok-bueno').used === 1);

    const r2 = await resetear('tok-bueno', 'contrasenya-nueva-3');
    const body2 = await r2.text();
    check('SEGUNDO uso del mismo enlace → rechazado', r2.status === 400);
    check('lo llama inválido o usado', body2.includes('inválido') || body2.includes('utilizado'));
    const u2 = db.prepare('SELECT password_hash FROM admin_users WHERE id=?').get(userId);
    check('la contraseña NO volvió a cambiar', u2.password_hash === u1.password_hash);
  }

  console.log('\n[8] Un token inventado no vale');
  {
    const r = await resetear('me-lo-invento', 'contrasenya-nueva-4');
    check('token inexistente → 400', r.status === 400);
  }

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  ${ok} OK · ${fail} fallos`);
  console.log('─'.repeat(56) + '\n');
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

process.exit(fail === 0 ? 0 : 1);
