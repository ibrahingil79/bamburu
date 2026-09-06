// scripts/lib/copia-consistente.mjs
//
// COPIAR UNA BASE EN MODO WAL CON `cp` SE LLEVA UNA FOTO VIEJA.
//
// Los negocios de Bamburu corren en WAL: los últimos cambios confirmados viven en el fichero `-wal`
// hasta que alguien hace checkpoint. `copyFileSync('...db', destino)` copia SOLO el `.db`, así que
// la comprobación acaba midiendo un pasado — y no uno cualquiera, sino uno que cambia según cuándo
// tocó el último checkpoint. De ahí salen los rojos que van y vienen sin que nadie toque el código.
//
// Cazado el 24 ago 2026 en verify-contabilidad-backfill: el original leído con su WAL daba desfase 0
// y un `cp` del mismo fichero, en el mismo instante, daba 654,00 €. La comprobación llevaba días
// acusando al libro de compras de un descuadre de 327,00 € que no existía.
//
// Lo grave no es el rojo falso: es el VERDE falso. Una comprobación que lee una foto anterior puede
// dar por buena una cadena, un libro o un saldo que ya no es el que hay.
//
// `.backup` de sqlite copia la base entera —WAL incluido— y de forma consistente aunque alguien esté
// escribiendo. Es la única forma correcta de llevarse un negocio a un temporal.

// ⚙️ 6 SEP 2026 — CIFRADO EN REPOSO. Esto llamaba al `sqlite3` DEL SISTEMA, que no puede abrir una
// base cifrada. Ahora la copia se hace con la MISMA API de copia de SQLite, pero desde dentro, por el
// punto único de apertura — que es quien tiene la llave.
//
// LA COPIA DE TRABAJO SALE EN CLARO, Y ESTÁ DECIDIDO ASÍ. La API de copia escribe en un fichero
// destino que se abre sin llave, así que el resultado no va cifrado. Aquí eso es lo que hace falta y
// no un descuido: estas copias son para que una comprobación lea un negocio sin estorbar al de
// verdad, viven segundos en un temporal y las abren catorce comprobaciones con `new Database(...)` a
// secas. Cifrarlas obligaría a tocar esas catorce para que supieran pedir la llave, a cambio de nada:
// el mismo proceso ya tiene la llave en memoria.
//
// Lo que SÍ se arregla es el permiso: el fichero nacía con el umask de quien lanzara la comprobación
// —y `/tmp` lo lee todo el mundo—. Ahora nace 0600 y sin ventana, poniendo el umask ANTES de crearlo.
// Para las copias que sí se quedan (el snapshot de cada noche) está `db-snapshot.mjs`, que usa
// `VACUUM INTO` y sale cifrado.
// Y SIGUE SIENDO SÍNCRONA. La API de copia de better-sqlite3 devuelve una promesa, y las catorce
// comprobaciones que llaman aquí lo hacen desde funciones que no son `async`. Se consigue lo mismo
// con dos pasos síncronos: `VACUUM INTO` —que saca una copia consistente y hereda el cifrado del
// origen— y `PRAGMA rekey = ''` sobre el resultado, que la deja en claro para quien la va a leer.
import Database from 'better-sqlite3';
import { existsSync, readFileSync, chmodSync, renameSync, rmSync } from 'fs';
import path from 'path';

const enClaro = f => {
  try { return readFileSync(f, { length: 16 }).subarray(0, 15).toString('latin1') === 'SQLite format 3'; }
  catch { return false; }
};

export function copiarBase(origen, destino) {
  if (!existsSync(origen)) throw new Error('copiarBase: no existe el origen ' + origen);

  // El umask se pone ANTES de crear nada: un chmod después deja una ventana, y `/tmp` lo lee todo
  // el mundo. Esto es nuevo — antes el fichero nacía con el umask de quien lanzara el barrido.
  const antesUmask = process.umask(0o077);
  const enCurso = destino + '.copiando';
  try {
    rmSync(enCurso, { force: true });
    rmSync(destino, { force: true });          // VACUUM INTO se niega a escribir sobre algo que existe
    const db = new Database(origen, { readonly: true, fileMustExist: true });
    try { db.exec("VACUUM INTO '" + path.resolve(enCurso).replace(/'/g, "''") + "'"); }
    finally { db.close(); }

    if (!enClaro(enCurso)) {
      const c = new Database(enCurso, { fileMustExist: true, bamburuLlave: Database.llaveParaMigrar() });
      try { c.pragma("rekey = ''"); } finally { c.close(); }
    }
    renameSync(enCurso, destino);
  } finally {
    process.umask(antesUmask);
    rmSync(enCurso, { force: true });
  }

  if (!existsSync(destino)) throw new Error('copiarBase: la copia no dejó nada en ' + destino);
  chmodSync(destino, 0o600);
  return destino;
}
