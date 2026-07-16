// Devuelve el acceso a un admin de negocio que se ha quedado fuera.
//
//   uso: node scripts/reset-admin.js <email>     ← en una terminal de verdad (pide la contraseña por teclado)
//
// La contraseña la TECLEAS tú y no se ve al escribirla. C6/B7: antes la generaba y la IMPRIMÍA, y
// ahí se quedaba —en el scrollback, y en lo que capturase stdout—. Un secreto no se imprime, igual
// que no va a un log; la salida no es imprimirlo mejor, es no generarlo.
import bcrypt from 'bcrypt';
import { db } from '../core/db.js';
import { BCRYPT_COST } from '../core/auth.js';
import { pedirContrasenyaNueva } from './lib/prompt-secret.mjs';

const email = process.argv[2] || 'admin@bamburu.com';

const user = db.prepare('SELECT id, email, active, totp_enabled FROM admin_users WHERE email = ?').get(email);
if (!user) {
  console.error(`\n❌ No existe ningún admin con email "${email}"`);
  console.error(`   Usuarios admin existentes:`);
  const all = db.prepare('SELECT email, role, active FROM admin_users').all();
  for (const u of all) {
    console.error(`   - ${u.email} (${u.role}, ${u.active ? 'activo' : 'desactivado'})`);
  }
  console.error('');
  process.exit(1);
}

console.log('');
console.log(`Reseteando el acceso de ${user.email}.`);
// Mínimo 10: el mismo listón que el cambio propio y el reset por enlace (C6/B3). Un mínimo es el
// más flojo de sus caminos — de nada sirve exigir 10 en la pantalla si por aquí entra uno de 4.
const newPassword = await pedirContrasenyaNueva('Contraseña nueva (mín. 10, no se verá)');
const hash = bcrypt.hashSync(newPassword, BCRYPT_COST);   // el coste vive en un solo sitio (core/auth.js)

// C5 — el reseteo limpia TAMBIÉN el 2FA, y esto no es un extra: sin ello el script no rescataba a
// nadie que tuviera el 2FA puesto. La persona entraba con la contraseña nueva, chocaba con la
// pantalla del código, y ahí se acababa el rescate — fuera de su cuenta para siempre, porque los
// admin de negocio no tienen códigos de rescate (los tiene el superadmin; para los dueños es tarea
// aparte, ver TABLERO). Devolver el acceso incluye devolver la puerta entera, no media.
const tenia2FA = user.totp_enabled === 1;
db.prepare(`
  UPDATE admin_users
  SET password_hash = ?, must_change_password = 1, active = 1,
      totp_secret = NULL, totp_enabled = 0
  WHERE id = ?
`).run(hash, user.id);

const sessionsDeleted = db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(user.id).changes;
// C6/B3 — los enlaces de reseteo pendientes también se queman: si alguien pidió uno a ese correo
// antes que tú, seguiría valiendo para volver a cambiar la contraseña justo después de esto.
let tokensQuemados = 0;
try {
  tokensQuemados = db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE admin_user_id = ? AND used = 0')
    .run(user.id).changes;
} catch (_) {}

console.log('');
console.log('=====================================================');
console.log('🔐  ADMIN RESETEADO');
console.log('');
console.log(`   Email: ${user.email}`);
console.log('   Contraseña: la que acabas de teclear (no se muestra).');
console.log('   Se le pedirá cambiarla en el próximo login.');
if (tenia2FA) {
  console.log('   2FA DESACTIVADO: entraba con app de autenticación y ya no la necesita.');
  console.log('   → Dile que lo reactive desde /admin/setup-2fa al entrar.');
}
if (sessionsDeleted > 0) {
  console.log(`   ${sessionsDeleted} sesión(es) activa(s) cerrada(s) por seguridad.`);
}
if (tokensQuemados > 0) {
  console.log(`   ${tokensQuemados} enlace(s) de reseteo pendiente(s) invalidado(s).`);
}
console.log('=====================================================');
console.log('');

process.exit(0);
