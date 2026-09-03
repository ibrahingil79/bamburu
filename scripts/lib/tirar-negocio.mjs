// ─────────────────────────────────────────────────────────────────────────────────────────────────
// TIRAR UN NEGOCIO DE PRUEBA, ENTERO Y SIN DEJAR FANTASMAS.
//
// POR QUÉ EXISTE (3 sep 2026, lo destapó el barrido completo). Cada comprobación que se traía su
// propio negocio lo borraba a mano, y todas escribían la misma pareja de líneas:
//
//     controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
//     controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
//
// El 2 de septiembre, la tarea de suscripción metió en `createTenant` —el ÚNICO sitio del repo donde
// nace un negocio— la siembra de la prueba de 15 días. Desde entonces **todo negocio nuevo tiene una
// fila en `tenant_suscripciones`**, que también apunta a `tenants` por clave ajena, y ninguna de
// aquellas limpiezas la soltaba: el `DELETE FROM tenants` muere con
// `SQLITE_CONSTRAINT_FOREIGNKEY`.
//
// ⚠️ Y TIENE DOS CARAS, LA SEGUNDA PEOR QUE LA PRIMERA:
//   · La comprobación que NO envuelve su limpieza sale en ROJO (exit 1) **con las aserciones en
//     verde**: parece rota y no lo está.
//   · La que SÍ la envuelve en `try {} catch {}` sale en **VERDE dejando el negocio dentro**. En
//     silencio. Es la avería de siempre de este repo: lo que se traga un error deja de avisar.
//
// Coste medido en UNA sola pasada del barrido completo: `control.db` pasó de **84 negocios a 127**.
// Cuarenta y tres fantasmas, varios con su `.db` ya borrado del disco —porque el `unlinkSync` iba
// DESPUÉS del DELETE que reventaba—, o sea filas de enrutado apuntando a ficheros que no existen.
//
// LA REGLA QUE SALE DE AQUÍ, y este repo ya la tiene escrita con otras palabras: **una lista de
// tablas escrita a mano siempre se queda corta.** `tenant_suscripciones` no existía cuando se
// escribieron esas limpiezas y nadie iba a volver a repasarlas. Así que esto **le pregunta al
// esquema** quién apunta a `tenants` y suelta lo que haya, aparezca cuando aparezca.
//
// NO TOCA EL PRODUCTO: vive en `scripts/lib/` y solo lo usan las comprobaciones. La alternativa
// —poner `ON DELETE CASCADE` o un trigger en `control.db`— habría tocado la tabla del cobro, que es
// justo lo que el encargo de ayer dejó fuera, y habría hecho que borrar un negocio de VERDAD se
// llevara su historial de suscripción en silencio.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { unlinkSync } from 'fs';
import path from 'path';
import { controlDb, getTenantBySlug } from '../../core/control-db.js';
import { APP_DIR } from './gate-env.mjs';

/** Las tablas de `control.db` que apuntan a `tenants`. Se pregunta al esquema, no se escribe a mano. */
function atadurasDe(db = controlDb) {
  const atas = [];
  for (const tabla of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name)) {
    try {
      for (const k of db.prepare('PRAGMA foreign_key_list("' + tabla + '")').all()) {
        if (k.table === 'tenants') atas.push({ tabla, col: k.from });
      }
    } catch { /* una tabla sin claves ajenas: nada que soltar */ }
  }
  return atas;
}

/**
 * Borra un negocio de prueba de `control.db` y sus ficheros. Devuelve `{ ok, slug, soltadas, error }`.
 *
 * **NO se traga el error.** Si algo impide borrarlo, lo dice y devuelve `ok:false`: un fantasma
 * silencioso en la base de enrutado de toda la plataforma es peor que una comprobación en rojo.
 */
export function tirarNegocio(slug, { db = controlDb, silencioso = false } = {}) {
  if (!slug) return { ok: true, slug, soltadas: 0 };
  const t = getTenantBySlug(slug);
  let soltadas = 0;
  try {
    if (t) {
      for (const { tabla, col } of atadurasDe(db)) {
        try { soltadas += db.prepare('DELETE FROM "' + tabla + '" WHERE "' + col + '"=?').run(t.id).changes; }
        catch { /* la tabla puede no existir en una control.db vieja */ }
      }
    }
    db.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  } catch (e) {
    if (!silencioso) {
      console.error('  ⚠️ NO SE PUDO TIRAR EL NEGOCIO DE PRUEBA «' + slug + '»: ' + e.message);
      console.error('     Queda un FANTASMA en control.db. Bórralo a mano o el siguiente barrido lo arrastra.');
    }
    return { ok: false, slug, soltadas, error: e.message };
  }
  // Los ficheros van al final y a prueba de fallos: si la fila ya no está, el `.db` sobra.
  if (t) {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch { /* no estaba */ } }
  }
  return { ok: true, slug, soltadas };
}


/**
 * Suelta TODA atadura de clave ajena de un negocio, sin borrarlo. Es lo que hay que llamar **justo
 * antes** de un `DELETE FROM tenants` escrito a mano, y por eso existe aparte de `tirarNegocio`: las
 * comprobaciones ya escritas tienen su propia limpieza (cierran su base, borran sus ficheros, cuentan
 * lo que queda) y **cambiársela entera sería tocar 27 comprobaciones para arreglar una línea**.
 *
 * Admite el `slug` o el `id`. Devuelve cuántas filas soltó.
 */
export function soltarAtaduras(slugOId, { db = controlDb } = {}) {
  let id = slugOId;
  if (typeof slugOId === 'string') {
    const t = getTenantBySlug(slugOId);
    if (!t) return 0;
    id = t.id;
  }
  if (id == null) return 0;
  let n = 0;
  for (const { tabla, col } of atadurasDe(db)) {
    try { n += db.prepare('DELETE FROM "' + tabla + '" WHERE "' + col + '"=?').run(id).changes; }
    catch { /* tabla ausente en una control.db vieja */ }
  }
  return n;
}

/** Barre los negocios de prueba que quedaron de pasadas anteriores. Devuelve cuántos se fueron. */
export function tirarNegociosPorPatron(patron, { db = controlDb } = {}) {
  const filas = db.prepare('SELECT slug FROM tenants WHERE slug LIKE ?').all(patron);
  let n = 0;
  for (const f of filas) if (tirarNegocio(f.slug, { db, silencioso: true }).ok) n++;
  return n;
}
