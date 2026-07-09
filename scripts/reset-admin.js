import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../core/db.js';
import { BCRYPT_COST } from '../core/auth.js';

const email = process.argv[2] || 'admin@bamburu.com';

const user = db.prepare('SELECT id, email, active FROM admin_users WHERE email = ?').get(email);
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

const newPassword = randomBytes(12).toString('base64url');
const hash = bcrypt.hashSync(newPassword, BCRYPT_COST);   // el coste vive en un solo sitio (core/auth.js)

db.prepare(`
  UPDATE admin_users
  SET password_hash = ?, must_change_password = 1, active = 1
  WHERE id = ?
`).run(hash, user.id);

const sessionsDeleted = db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(user.id).changes;

console.log('');
console.log('=====================================================');
console.log('🔐  ADMIN RESETEADO');
console.log('');
console.log(`   Email:      ${user.email}`);
console.log(`   Contraseña: ${newPassword}`);
console.log('');
console.log('   GUÁRDALA AHORA. No volverá a mostrarse.');
console.log('   Se te pedirá cambiarla en el próximo login.');
if (sessionsDeleted > 0) {
  console.log(`   ${sessionsDeleted} sesión(es) activa(s) cerrada(s) por seguridad.`);
}
console.log('=====================================================');
console.log('');

process.exit(0);
