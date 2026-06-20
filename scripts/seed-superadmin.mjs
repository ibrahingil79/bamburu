// Crea el superadmin inicial en control.db con una contraseña TEMPORAL y cambio obligatorio
// al primer login. Idempotente: si ya existe, no lo toca.
//   uso: node scripts/seed-superadmin.mjs [email]
import { initControlDb, getSuperadminByEmail, createSuperadmin } from '../core/control-db.js';
import { hashPassword } from '../core/auth.js';
import { randomBytes } from 'crypto';

initControlDb();

const email = (process.argv[2] || 'ibrahingil@gmail.com').trim().toLowerCase();

if (getSuperadminByEmail(email)) {
  console.log(`Ya existe un superadmin con ${email} — no se toca.`);
  process.exit(0);
}

const tempPassword = randomBytes(9).toString('base64url');  // ~12 chars
const password_hash = await hashPassword(tempPassword);
createSuperadmin({ email, password_hash, must_change_password: 1 });

console.log('=====================================================');
console.log('  SUPERADMIN CREADO');
console.log('  Email:               ' + email);
console.log('  Contraseña temporal: ' + tempPassword);
console.log('  (cambio OBLIGATORIO en el primer login)');
console.log('  Entra en:  https://bamburu.com/superadmin/login');
console.log('=====================================================');
process.exit(0);
