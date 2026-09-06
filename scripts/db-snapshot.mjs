// Genera un snapshot CONSISTENTE de una BD SQLite. Lee la BD en caliente sin romper por el WAL: el
// resultado es un único .db autocontenido.
//
// ⚙️ 6 SEP 2026 — CIFRADO EN REPOSO. Antes esto usaba la Online Backup API (`db.backup(dst)`). Con
// las bases cifradas eso **NO VALE**, y el motivo es de los que no se ven leyendo el código: la API
// de copia escribe página a página en un fichero destino que se abre SIN llave, así que de una base
// cifrada saca **una copia EN CLARO**. Medido: la copia salía con «SQLite format 3» en la cabecera y
// con los NIF legibles dentro. Habría dejado, cada madrugada a las 03:33, una copia entera y legible
// de los once negocios en el disco del servidor — justo lo que esta ficha existe para impedir.
//
// Ahora se usa `VACUUM INTO`, que hereda el cifrado de la base de origen: si la base va cifrada, el
// snapshot sale cifrado y con la MISMA llave; si va en claro, sale en claro. **Un solo camino, sin
// rama blanda**: el snapshot es siempre tan secreto como su original, y nunca hay un instante en que
// los datos toquen el disco sin cifrar.
//
// Uso: node db-snapshot.mjs <origen.db> <destino.db>
import Database from 'better-sqlite3';
import { existsSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';

const [, , src, dst] = process.argv;
if (!src || !dst) {
  console.error('uso: db-snapshot.mjs <origen.db> <destino.db>');
  process.exit(1);
}

// `VACUUM INTO` se niega a escribir sobre un fichero que ya existe, y tiene razón. Se limpia antes,
// que es lo que hacía la API de copia por su cuenta.
if (existsSync(dst)) unlinkSync(dst);

const db = new Database(src, { readonly: true, fileMustExist: true });
try {
  db.exec("VACUUM INTO '" + path.resolve(dst).replace(/'/g, "''") + "'");
} finally {
  db.close();
}
// El snapshot es tan tuyo como la base: nace privado, no con lo que diga el umask de quien lo lance.
chmodSync(dst, 0o600);
console.log(`snapshot ok: ${src} -> ${dst}`);
