// Crea el superadmin inicial en control.db. La contraseña la TECLEAS tú (no se ve al escribirla) y
// se exige cambiarla en el primer login. Idempotente: si ya existe, no lo toca.
//   uso: node scripts/seed-superadmin.mjs [email]     ← en una terminal de verdad (pide teclado)
//
// C6/B7: antes generaba una contraseña temporal y la IMPRIMÍA. Quedaba en el scrollback y en lo que
// capturase stdout. Ahora no se genera ni se imprime ningún secreto.
import { initControlDb, getSuperadminByEmail, createSuperadmin } from '../core/control-db.js';
import { hashPassword } from '../core/auth.js';
import { pedirContrasenyaNueva } from './lib/prompt-secret.mjs';

initControlDb();

const email = (process.argv[2] || 'ibrahingil@gmail.com').trim().toLowerCase();

if (getSuperadminByEmail(email)) {
  console.log(`Ya existe un superadmin con ${email} — no se toca.`);
  process.exit(0);
}

console.log('');
console.log(`Creando el superadmin ${email}.`);
const password = await pedirContrasenyaNueva('Contraseña inicial (mín. 10, no se verá)');
const password_hash = await hashPassword(password);
createSuperadmin({ email, password_hash, must_change_password: 1 });

console.log('=====================================================');
console.log('  SUPERADMIN CREADO');
console.log('  Email:  ' + email);
console.log('  (se te pedirá cambiar la contraseña en el primer login)');
console.log('  Entra en:  https://bamburu.com/superadmin/login');
console.log('  → Y activa el doble factor en /superadmin/2fa (C5/M3).');
console.log('=====================================================');
process.exit(0);
