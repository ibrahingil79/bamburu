// Gate — C3/M4 (Eje C): `safeError` no filtra estructura de la BD al cliente. Un error de CLIENTE que
// lanzamos a propósito (4xx con mensaje propio) se muestra; un error SQL/inesperado se oculta tras un
// mensaje genérico, y el detalle técnico se queda en el log del servidor (console.error).
//
//   node scripts/verify-safe-error.mjs
import { safeError } from '../core/errors.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const GENERICO = 'Ha ocurrido un error, inténtalo de nuevo.';

console.log('\n[1] Errores de CLIENTE intencionales (4xx): se muestra su mensaje');
ok(safeError({ status: 404, message: 'Proveedor no encontrado' }) === 'Proveedor no encontrado', '404 con mensaje propio → se muestra');
ok(safeError({ status: 400, message: 'Cantidad no válida' }) === 'Cantidad no válida', '400 → se muestra');
ok(safeError({ status: 409, message: 'La compra ya está cancelada' }) === 'La compra ya está cancelada', '409 → se muestra');

console.log('\n[2] Errores de SQL / inesperados: mensaje GENÉRICO, sin estructura de la BD');
// Estos son los que antes se filtraban crudos (better-sqlite3).
for (const msg of [
  'UNIQUE constraint failed: admin_users.email',
  'NOT NULL constraint failed: invoices.total',
  'no such column: foo',
  'no such table: verifactu_registros',
]) {
  const e = new Error(msg); e.code = 'SQLITE_ERROR';
  const r = safeError(e);
  ok(r === GENERICO, 'SQL "' + msg.slice(0, 32) + '…" → genérico');
  ok(!/constraint|admin_users|SQLITE|no such|column|table|invoices|verifactu/i.test(r), '  …y el mensaje al cliente NO contiene NADA de la estructura de la BD');
}

console.log('\n[3] Casos borde robustos');
ok(safeError({ message: 'no such column: x' }) === GENERICO, 'error SIN status (raw) → genérico');
ok(safeError({ status: 500, message: 'boom interno' }) === GENERICO, '500 explícito → genérico (no se muestra el detalle)');
ok(safeError(null) === GENERICO && safeError(undefined) === GENERICO, 'null/undefined → genérico (no rompe)');
ok(safeError({ status: 400 }) === 'Solicitud no válida.', '4xx sin mensaje → texto de cliente por defecto, no undefined');

console.log('\n(Las líneas «[error]» de arriba son el DETALLE técnico que safeError manda al LOG DEL SERVIDOR — nunca al cliente.)');
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' safeError (M4): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
