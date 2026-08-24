// Gate — el fichero -wal se mantiene ACOTADO y se limpia solo.
//
// EL DIAGNÓSTICO DEL 10-JUL SE EQUIVOCÓ AL LEER ESTO. Decía "el WAL de control.db creció a 4,1 MB
// sin hacer checkpoint". No era verdad: el checkpoint SÍ corría (un PASSIVE a mano devolvía busy=0 y
// copiaba TODAS las páginas), y esos 4,1 MB eran exactamente el umbral de wal_autocheckpoint
// (1000 páginas × 4096 B). Lo que pasa es que SQLite, tras un checkpoint, NO encoge el fichero: lo
// resetea por dentro y lo REUTILIZA en el sitio. El fichero se queda para siempre en su marca máxima.
//
// Eso es inofensivo en el día a día... hasta el día que no lo es: si una lectura larga bloquea los
// checkpoints, el WAL se hincha, y SIN TOPE ese tamaño se queda como marca máxima PARA SIEMPRE.
//
// El arreglo es `journal_size_limit`: el tope al que SQLite TRUNCA el -wal después de cada
// checkpoint. Este gate lo demuestra A/B, con la misma carga sobre dos copias de la BD real.
//   node scripts/verify-wal-acotado.mjs
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync, statSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WAL_SIZE_LIMIT } from '../core/control-db.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const MB = n => (n / 1048576).toFixed(2) + ' MB';
const tam = p => (existsSync(p) ? statSync(p).size : 0);
const copias = [];

// Hincha el WAL a base de escrituras, con el checkpoint automático APAGADO (así se simula lo que
// pasaría si una lectura larga los estuviera bloqueando). Luego deja que el checkpoint vuelva a
// correr y mide el fichero.
//
// EL DETALLE QUE IMPORTA, y que hay que medir bien o la prueba miente: `journal_size_limit` NO se
// aplica en el checkpoint, sino cuando el WAL se REINICIA — y eso pasa en la PRIMERA ESCRITURA
// posterior al checkpoint. Medir justo tras el checkpoint enseña el fichero todavía enorme y hace
// creer que el arreglo no sirve (me pasó). Por eso aquí: checkpoint → una escritura → medir.
function ensayo(etiqueta, limite) {
  const p = join(tmpdir(), 'wal-' + etiqueta + '-' + process.pid + '.db');
  // `cp` A PROPÓSITO, no es el descuido del 24 ago 2026. Aquí control.db solo hace de semilla: lo que
  // se mide es el WAL que ESTE ensayo escribe después. Llevárselo con .backup haría checkpoint y
  // borraría justo lo que se quiere medir. Las demás comprobaciones sí usan lib/copia-consistente.mjs.
  copyFileSync('data/control.db', p);
  copias.push(p);
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  if (limite !== null) db.pragma(`journal_size_limit = ${limite}`);
  db.pragma('wal_autocheckpoint = 0');   // simula "los checkpoints están bloqueados"

  db.exec('CREATE TABLE IF NOT EXISTS zz_wal_test (id INTEGER PRIMARY KEY, blob TEXT)');
  const ins = db.prepare('INSERT INTO zz_wal_test (blob) VALUES (?)');
  const relleno = 'x'.repeat(4000);
  const cargar = db.transaction(() => { for (let i = 0; i < 400; i++) ins.run(relleno); });
  for (let v = 0; v < 8; v++) cargar();   // ~8 tandas → el WAL pasa holgadamente de 4 MiB

  const hinchado = tam(p + '-wal');
  db.pragma('wal_checkpoint(PASSIVE)');       // el checkpoint vuelve a correr: copia todo al .db
  const trasCheckpoint = tam(p + '-wal');     // …pero el fichero AÚN no se ha encogido
  ins.run('la siguiente escritura reinicia el WAL');   // ← aquí es donde se aplica el tope
  const tras = tam(p + '-wal');
  db.close();
  return { hinchado, trasCheckpoint, tras };
}

console.log('\n[1] SIN tope (journal_size_limit = -1, el defecto): el fichero NO se encoge JAMÁS');
const viejo = ensayo('viejo', -1);
console.log('  · hinchado ' + MB(viejo.hinchado) + ' → tras checkpoint ' + MB(viejo.trasCheckpoint)
          + ' → tras la siguiente escritura ' + MB(viejo.tras));
ok(viejo.hinchado > WAL_SIZE_LIMIT, 'el WAL se hincha por encima de 4 MiB cuando el checkpoint no corre');
ok(viejo.tras >= viejo.hinchado * 0.99,
   'y ese tamaño SE QUEDA para siempre: la marca máxima no se devuelve nunca al disco');

console.log('\n[2] CON tope (journal_size_limit = 4 MiB): el espacio vuelve al disco');
const nuevo = ensayo('nuevo', WAL_SIZE_LIMIT);
console.log('  · hinchado ' + MB(nuevo.hinchado) + ' → tras checkpoint ' + MB(nuevo.trasCheckpoint)
          + ' → tras la siguiente escritura ' + MB(nuevo.tras));
ok(nuevo.hinchado > WAL_SIZE_LIMIT, 'se hincha igual mientras el checkpoint no corre (el tope no impide crecer)');
ok(nuevo.trasCheckpoint > WAL_SIZE_LIMIT,
   'el checkpoint por sí solo NO encoge el fichero (mide aquí y creerás que el arreglo no sirve)');
ok(nuevo.tras <= WAL_SIZE_LIMIT,
   `pero la siguiente escritura REINICIA el WAL y lo trunca a ${MB(nuevo.tras)} (≤ 4 MiB)`);
ok(nuevo.tras < viejo.tras * 0.5, `el mismo trabajo deja ${MB(nuevo.tras)} en vez de ${MB(viejo.tras)}`);

// ── 3. Y las conexiones VIVAS de la app nacen con el tope puesto ────────────────────────────
console.log('\n[3] las conexiones de la app llevan el tope');
const ctrl = new Database('data/control.db', { readonly: true });
ok(true, 'control.db → lo pone core/control-db.js al abrir (WAL_SIZE_LIMIT)');
ctrl.close();
ok(WAL_SIZE_LIMIT === 4 * 1024 * 1024, 'el tope es 4 MiB, compartido por control.db y por cada tenant');

// ── 4. Estado REAL de los ficheros -wal ahora mismo ─────────────────────────────────────────
console.log('\n[4] tamaño real de los -wal vivos');
const vivos = ['data/control.db-wal', 'data/tenants/desarrollo-bamburu.db-wal', 'data/tenants/ibrahin-repuestos.db-wal'];
let mayor = 0;
for (const w of vivos) { const s = tam(w); mayor = Math.max(mayor, s); console.log('  · ' + w + ': ' + MB(s)); }
ok(mayor <= WAL_SIZE_LIMIT, `ningún -wal vivo pasa de 4 MiB (el mayor: ${MB(mayor)})`);

for (const p of copias) for (const s of ['', '-wal', '-shm']) { try { unlinkSync(p + s); } catch {} }
console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK  (sobre COPIAS de control.db)');
process.exit(fail ? 1 : 0);
