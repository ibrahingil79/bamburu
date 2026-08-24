// scripts/lib/horario-intacto.mjs
//
// EL HORARIO DEL NEGOCIO ES DE OTROS: SE DEJA COMO ESTABA.
//
// `gate-agenda-sencilla` cambia el horario de apertura POR LA PANTALLA —por eso no hay ningún INSERT
// en su código y nadie lo veía— y no lo devolvía a su sitio. El 24 ago 2026 dejó dos tramos de más
// (martes y miércoles, 8:00-20:00, encima de los 9:00-14:00 que ya había) y una excepción suelta.
//
// El resultado no fue un rojo en ese gate, que pasó tan contento: fue que `gate-oficio-pantalla`
// empezó a fallar con «sin huecos» al pedir cita para el día siguiente. Con los tramos solapados, la
// agenda no ofrece ni un hueco. Un gate rompiendo a otro por datos que no le pertenecen, y el rojo
// apareciendo a tres pantallas de distancia del culpable.
//
// Se guarda una foto al empezar y se restaura al acabar. Y se COMPRUEBA: restaurar sin mirar es
// confiar en que el DELETE valió, que es justo lo que ya falló una vez hoy.

const TABLAS = ['horario_tramos', 'horario_excepciones'];

export function fotoHorario(db) {
  const foto = {};
  for (const t of TABLAS) {
    try { foto[t] = db.prepare('SELECT * FROM ' + t).all(); } catch { foto[t] = null; }
  }
  return foto;
}

// Devuelve { cambios, iguales } — `cambios` es lo que hubo que deshacer, para poder contarlo.
export function restaurarHorario(db, foto) {
  let cambios = 0;
  for (const t of TABLAS) {
    const antes = foto[t];
    if (!antes) continue;
    const cols = antes.length ? Object.keys(antes[0]) : null;
    const ids = new Set(antes.map(r => r.id));
    db.transaction(() => {
      for (const r of db.prepare('SELECT id FROM ' + t).all()) {
        if (!ids.has(r.id)) { db.prepare('DELETE FROM ' + t + ' WHERE id=?').run(r.id); cambios++; }
      }
      if (cols) {
        const hueco = cols.map(() => '?').join(',');
        for (const r of antes) {
          const hay = db.prepare('SELECT 1 FROM ' + t + ' WHERE id=?').get(r.id);
          if (hay) continue;
          db.prepare('INSERT INTO ' + t + ' (' + cols.join(',') + ') VALUES (' + hueco + ')').run(...cols.map(c => r[c]));
          cambios++;
        }
      }
    })();
  }
  return { cambios, iguales: mismoHorario(db, foto) };
}

export function mismoHorario(db, foto) {
  for (const t of TABLAS) {
    if (!foto[t]) continue;
    const ahora = db.prepare('SELECT * FROM ' + t + ' ORDER BY id').all();
    const antes = [...foto[t]].sort((a, b) => a.id - b.id);
    if (JSON.stringify(ahora) !== JSON.stringify(antes)) return false;
  }
  return true;
}
