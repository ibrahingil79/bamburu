// PIEZA 6 · PUERTA PÚBLICA — CADUCAR LAS SOLICITUDES QUE NADIE CONTESTÓ.
//   node scripts/bamburu-caducar-reservas.mjs        (o con RESERVAS_DRY=1 para simular sin escribir)
//
// POR QUÉ EXISTE. En modo "yo apruebo", una solicitud RETIENE el hueco: la cita ya está creada y ocupa
// sitio en la agenda, porque si no lo retuviera, aprobar podría fallar por un solape aparecido entre
// medias y el cliente se enteraría el día de la cita. El precio de retener es que hay que soltar: una
// solicitud sin respuesta tiene que caerse SOLA y devolver el hueco, o el negocio se queda con la
// agenda llena de citas fantasma que nadie confirmó nunca.
//
// IDEMPOTENTE por construcción: caducarReservasPendientes solo mira las que están 'pendiente' con su
// retiene_hasta ya cumplido, y al caducarlas las marca 'caducada'. Pasar dos veces no cambia nada, así
// que un arranque tardío (timer Persistent) es inofensivo.
//
// El hueco se libera por el motor de la pieza 5 (anularCitaSvc → NETO-CERO si hubiera cobro, que en una
// solicitud pendiente nunca lo hay). Cero camino de escritura nuevo.
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../modules/erp/models.js';
import { caducarReservasPendientes } from '../modules/erp/reserva-publica.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANTS_DIR = join(APP_DIR, 'data', 'tenants');
const DRY = process.env.RESERVAS_DRY === '1';
const log = (m) => console.log('[caducar-reservas] ' + m);

function tenantDbs() {
  try { return readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => join(TENANTS_DIR, f)); }
  catch { return []; }
}

let total = 0;
for (const path of tenantDbs()) {
  const slug = basename(path, '.db');
  const db = new Database(path);
  try {
    runMigrations(db);   // idempotente: el script no pasa por el middleware, así que asegura el esquema
    // Sin puerta pública encendida no hay nada que caducar, y no vale la pena barrer.
    const cfg = db.prepare('SELECT cita_pub_activa, cita_pub_modo FROM company_config WHERE id=1').get() || {};
    if (!cfg.cita_pub_activa || cfg.cita_pub_modo !== 'aprobar') { db.close(); continue; }

    if (DRY) {
      const n = db.prepare(
        "SELECT COUNT(*) n FROM cita_reserva_publica WHERE aprobacion='pendiente' AND retiene_hasta IS NOT NULL AND retiene_hasta<=?"
      ).get(Math.floor(Date.now() / 1000)).n;
      log(slug + ': ' + n + ' caducaría(n) (DRY, no se ha escrito nada)');
    } else {
      const n = caducarReservasPendientes(db);
      total += n;
      if (n) log(slug + ': ' + n + ' solicitud(es) caducada(s), hueco devuelto');
    }
  } catch (e) {
    console.error('[caducar-reservas] ' + slug + ' — ' + (e?.message || e));
  } finally {
    db.close();
  }
}
log('terminado' + (DRY ? ' (DRY)' : ' — ' + total + ' caducada(s) en total'));
