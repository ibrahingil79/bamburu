// Genera un snapshot CONSISTENTE de una BD SQLite usando la SQLite Online
// Backup API (la misma que `sqlite3 <db> ".backup '<dst>'"`). Lee la BD en
// caliente sin romper por el WAL: el resultado es un único .db autocontenido.
//
// Uso: node db-snapshot.mjs <origen.db> <destino.db>
import Database from 'better-sqlite3';

const [, , src, dst] = process.argv;
if (!src || !dst) {
  console.error('uso: db-snapshot.mjs <origen.db> <destino.db>');
  process.exit(1);
}

const db = new Database(src, { readonly: true, fileMustExist: true });
try {
  await db.backup(dst);
} finally {
  db.close();
}
console.log(`snapshot ok: ${src} -> ${dst}`);
