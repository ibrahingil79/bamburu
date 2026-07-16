// C5 · M5 — Revocar las sesiones activas al desactivar un usuario.
//
// Antes de C5, desactivar a alguien NO lo echaba: getAdminSession hacía JOIN admin_users sin mirar
// `active`, así que la sesión seguía viva hasta caducar (≤24 h). Un dueño que quitaba el acceso a un
// empleado se quedaba tranquilo mientras el empleado seguía dentro un día entero.
//
// Prueba core/auth.js en aislamiento, sin servidor: BD temporal con las dos tablas que toca el
// mecanismo (admin_users + admin_sessions). Al terminar borra el fichero.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import {
  createAdminSession, getAdminSession, destroyAllAdminSessionsForUser,
} from '../core/auth.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};

// getAdminSession lee la cookie del request de Hono; aquí basta con su forma.
const reqConCookie = (token) => ({ header: (n) => (n === 'cookie' ? `asess=${token}` : undefined) });

const dir = mkdtempSync(join(tmpdir(), 'bamburu-c5-'));
const db = new Database(join(dir, 't.db'));

try {
  db.exec(`
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'employee', active INTEGER DEFAULT 1
    );
    CREATE TABLE admin_sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, csrf_token TEXT
    );
  `);
  const nuevoUsuario = (email, active = 1) => db.prepare(
    "INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,'x','employee',?)"
  ).run(email, email, active).lastInsertRowid;

  console.log('\n[1] Un usuario ACTIVO conserva su sesión');
  {
    const id = nuevoUsuario('activo@ej.com');
    const token = createAdminSession(db, id);
    const sess = getAdminSession(db, reqConCookie(token));
    check('sesión válida antes de tocar nada', sess !== null && sess.userId === id);
  }

  console.log('\n[2] EL CRITERIO — desactivar expulsa en la siguiente petición');
  {
    const id = nuevoUsuario('victima@ej.com');
    const token = createAdminSession(db, id);
    check('entra: la sesión vale', getAdminSession(db, reqConCookie(token)) !== null);

    // El dueño lo desactiva (lo que hace PUT /api/users/:id en users.js).
    db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(id);

    // Sin volver a loguearse ni esperar a que caduque: su siguiente petición.
    const sess = getAdminSession(db, reqConCookie(token));
    check('ROJO antes de C5 · desactivado → getAdminSession devuelve null (→ /admin/login)', sess === null);
  }

  console.log('\n[3] La fila muerta no sobrevive: se limpia al detectarla');
  {
    const id = nuevoUsuario('limpieza@ej.com');
    const token = createAdminSession(db, id);
    db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(id);
    getAdminSession(db, reqConCookie(token));
    const viva = db.prepare('SELECT 1 FROM admin_sessions WHERE token=?').get(token);
    check('la sesión del desactivado se borra de admin_sessions', viva === undefined);
  }

  console.log('\n[4] Reactivar NO resucita la sesión vieja (hay que volver a entrar)');
  {
    const id = nuevoUsuario('vuelve@ej.com');
    const token = createAdminSession(db, id);
    db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(id);
    getAdminSession(db, reqConCookie(token));
    db.prepare('UPDATE admin_users SET active=1 WHERE id=?').run(id);
    check('token viejo sigue muerto tras reactivar', getAdminSession(db, reqConCookie(token)) === null);
    const token2 = createAdminSession(db, id);
    check('un login nuevo sí vale', getAdminSession(db, reqConCookie(token2)) !== null);
  }

  console.log('\n[5] Desactivar a UNO no toca a los demás');
  {
    const malo = nuevoUsuario('malo@ej.com');
    const bueno = nuevoUsuario('bueno@ej.com');
    const tMalo = createAdminSession(db, malo);
    const tBueno = createAdminSession(db, bueno);
    db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(malo);
    check('el desactivado fuera', getAdminSession(db, reqConCookie(tMalo)) === null);
    check('el otro sigue dentro', getAdminSession(db, reqConCookie(tBueno)) !== null);
  }

  console.log('\n[6] destroyAllAdminSessionsForUser corta TODOS sus dispositivos');
  {
    const id = nuevoUsuario('multi@ej.com');
    const movil = createAdminSession(db, id);
    const portatil = createAdminSession(db, id);
    destroyAllAdminSessionsForUser(db, id);
    check('móvil fuera', getAdminSession(db, reqConCookie(movil)) === null);
    check('portátil fuera', getAdminSession(db, reqConCookie(portatil)) === null);
  }

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  ${ok} OK · ${fail} fallos`);
  console.log('─'.repeat(56) + '\n');
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

process.exit(fail === 0 ? 0 : 1);
