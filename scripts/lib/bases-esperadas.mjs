#!/usr/bin/env node
// Qué bases DEBERÍA contener una copia de seguridad — ficha `retencion-backup-fallo-parcial`.
//
// **El problema que resuelve, medido el 7 sep 2026 sobre el `bamburu-backup.sh` real:** el script
// arma su lista de bases con un comodín sobre `data/tenants/*.db`, así que **solo puede copiar lo
// que ve**. Si el fichero de un negocio no está en la carpeta —da igual el motivo—, ese negocio
// desaparece de la copia **sin una palabra**: el script termina con éxito, el correo dice «backup
// completado correctamente», y **la retención borra la última copia vieja que quedaba de él**.
// Reproducido en banco: tres negocios, se quita el fichero de uno, y su única copia se borra esa
// misma noche. A los pocos días ese negocio no tiene copia en ningún sitio y nadie lo sabe.
//
// La lista de bases que DEBEN existir no está en la carpeta: está en `control.db`, que es lo que
// dice qué negocios tiene Bamburu. Este ayudante la lee y la imprime, un nombre por línea.
//
//   node scripts/lib/bases-esperadas.mjs <ruta de control.db>
//
// Salida: un nombre de base por línea (`control`, `peluqueria-gil`, …), o `SIN_TABLA_TENANTS` si
// esa control.db no es la de Bamburu (bancos de prueba). Código 1 si no se puede leer: quien la
// llame decide, pero **no saber qué se espera nunca puede leerse como «todo en orden»**.

import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function basesEsperadas(rutaControl) {
  const Database = require('../../core/sqlite-bamburu/indice.cjs');
  const db = new Database(rutaControl, { readonly: true, fileMustExist: true });
  try {
    const hayTabla = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenants'").get();
    if (!hayTabla) return { sinTabla: true, bases: [] };
    const filas = db.prepare('SELECT slug, db_filename FROM tenants').all();
    // El nombre con el que la copia bautiza cada artefacto es el del FICHERO sin `.db`, no el slug:
    // son casi siempre iguales, pero el que manda es el fichero, porque es lo que sube.
    const bases = filas
      .map(f => path.basename(String(f.db_filename || ''), '.db'))
      .filter(Boolean);
    return { sinTabla: false, bases: [...new Set(bases)].sort() };
  } finally {
    try { db.close(); } catch { /* ya cerrada */ }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ruta = process.argv[2];
  if (!ruta) { console.error('uso: bases-esperadas.mjs <control.db>'); process.exit(1); }
  try {
    const r = basesEsperadas(ruta);
    if (r.sinTabla) { console.log('SIN_TABLA_TENANTS'); process.exit(0); }
    // `control` siempre entra: es la base de enrutado y va en toda copia.
    console.log(['control', ...r.bases].join('\n'));
  } catch (e) {
    console.error('no se pudo leer la lista de negocios: ' + e.message);
    process.exit(1);
  }
}
