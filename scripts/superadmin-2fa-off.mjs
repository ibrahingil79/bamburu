// ÚLTIMO RECURSO — quitar el 2FA del superadmin desde el servidor.
//
// Para cuando ya no queda nada más: móvil perdido Y códigos de rescate perdidos. Antes de llegar
// aquí, prueba un código de rescate en la pantalla de verificación: es la vía normal y no requiere
// tocar el servidor.
//
// Uso:
//   cd /home/ubuntu/bamburu && node scripts/superadmin-2fa-off.mjs <email>
//
// Qué hace: borra el secreto TOTP y los códigos de rescate de esa cuenta, y cierra sus sesiones
// abiertas. Después se entra SOLO con contraseña — así que lo primero al volver a entrar es
// reactivar el 2FA en /superadmin/2fa y guardar los códigos nuevos.
//
// Por qué esto es aceptable y no una puerta trasera: exige ser root/ubuntu en la máquina y estar
// dentro por SSH. Quien puede correr esto ya puede leer control.db y reescribir el hash de la
// contraseña — no le hace falta este script para nada. No abre ningún acceso que no existiera ya;
// solo evita que TÚ te quedes fuera de tu propia plataforma. La alternativa —no tener salida— no es
// más segura: es la misma seguridad con una forma nueva de perderlo todo.
import {
  controlDb, getSuperadminByEmail, disableSuperadminTotp, destroyAllSuperadminSessions,
} from '../core/control-db.js';

const email = (process.argv[2] || '').trim().toLowerCase();

if (!email) {
  console.error('\n❌ Falta el email.\n   Uso: node scripts/superadmin-2fa-off.mjs <email>\n');
  const todos = controlDb.prepare('SELECT email, totp_enabled FROM superadmins ORDER BY id').all();
  if (todos.length) {
    console.error('   Cuentas de superadmin:');
    for (const s of todos) console.error(`   - ${s.email} (2FA ${s.totp_enabled ? 'ACTIVO' : 'desactivado'})`);
    console.error('');
  }
  process.exit(1);
}

const admin = getSuperadminByEmail(email);
if (!admin) {
  console.error(`\n❌ No hay ningún superadmin con email "${email}".\n`);
  process.exit(1);
}

if (!admin.totp_enabled) {
  console.log(`\nℹ️  "${email}" ya tenía el 2FA desactivado. No se ha tocado nada.\n`);
  process.exit(0);
}

const codigos = controlDb
  .prepare('SELECT COUNT(*) n FROM superadmin_recovery_codes WHERE superadmin_id=? AND used_at IS NULL')
  .get(admin.id).n;

disableSuperadminTotp(admin.id);
// Las sesiones abiertas se cierran a propósito: si esto se está usando porque el móvil se perdió,
// una sesión viva en ese móvil perdido es exactamente lo que no quieres dejar abierto.
destroyAllSuperadminSessions(admin.id);

console.log('');
console.log('=====================================================');
console.log('🔓  2FA DESACTIVADO');
console.log('');
console.log(`   Cuenta:   ${admin.email}`);
console.log(`   Borrados: el secreto TOTP y ${codigos} código(s) de rescate sin usar`);
console.log('   Sesiones abiertas: cerradas');
console.log('');
console.log('   Esta cuenta entra ahora SOLO con contraseña.');
console.log('   → Entra y reactívalo en /superadmin/2fa. Guarda los códigos nuevos.');
console.log('=====================================================');
console.log('');

process.exit(0);
