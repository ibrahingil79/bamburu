#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════════════════════════
// db-revisar.mjs — «¿esta base abre y sirve?», en un sitio y para todos.
//
// DE DÓNDE SALE. Tres piezas hacían exactamente esta comprobación llamando al `sqlite3` DEL SISTEMA:
// `bamburu-backup.sh` (la copia de cada noche), `restauracion-sistema-completo.mjs` (levantar el
// sistema entero desde la copia) y `ensayo-restauracion-cifrada.sh`. Con las bases cifradas, ese
// `sqlite3` **no puede abrirlas** —no sabe nada de nuestra llave—, así que las tres se habrían
// puesto rojas cada noche diciendo «file is not a database», que suena a copia corrupta y no lo es.
//
// Se unifican aquí, y no en tres parches: una comprobación escrita tres veces son tres
// comprobaciones en cuanto una se retoca.
//
// LAS DOS PREGUNTAS, que son las que ya hacían y no se rebajan:
//   1. `integrity_check` dice `ok`
//   2. y hay ESQUEMA dentro — porque `integrity_check` también dice `ok` de una base VACÍA, y una
//      copia vacía no es una copia útil. Esa frase ya estaba escrita en las tres piezas.
//
// EL MODO NO SE ELIGE A MANO: se mira la cabecera del fichero. Una copia vieja está en claro y una
// nueva está cifrada, y las dos tienen que poder revisarse — sin una opción que alguien olvide poner.
// Se dice en la salida CUÁL de los dos se usó, para que quede en el registro de la copia.
//
//   node scripts/db-revisar.mjs <fichero.db>
//     → «ok · cifrada · 139 objetos»   (salida 0)
//     → «<qué le pasa>»                (salida 1)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
import Database from 'better-sqlite3';

const fichero = process.argv[2];
if (!fichero) { console.error('uso: db-revisar.mjs <fichero.db>'); process.exit(2); }

let db;
try {
  db = Database.abrirCopia(fichero, { readonly: true, fileMustExist: true });
} catch (e) {
  console.error(String(e.message).split('\n')[0].slice(0, 160));
  process.exit(1);
}
const enClaro = db.bamburuEnClaro;

try {
  const ic = db.pragma('integrity_check');
  const texto = ic.length === 1 ? ic[0].integrity_check : JSON.stringify(ic).slice(0, 200);
  if (texto !== 'ok') { console.error('integrity_check => ' + texto); process.exit(1); }

  const objetos = db.prepare('SELECT count(*) n FROM sqlite_master').get().n;
  if (!objetos) { console.error('abre pero está VACÍA (0 objetos): eso no es una copia útil'); process.exit(1); }

  console.log('ok · ' + (enClaro ? 'en claro' : 'cifrada') + ' · ' + objetos + ' objetos');
} catch (e) {
  console.error('no se puede revisar (' + String(e.message).split('\n')[0].slice(0, 160) + ')');
  process.exit(1);
} finally {
  try { db.close(); } catch (_) {}
}
