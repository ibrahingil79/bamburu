// PIEZA 5 · CITAS — RECORDATORIO AUTOMÁTICO POR EMAIL (el día antes).
//   node scripts/bamburu-recordatorios-cita.mjs      (o con CITAS_DRY=1 para simular sin enviar)
//
// El ÚNICO envío desatendido de citas, y SOLO por email (WhatsApp/SMS van siempre a mano — pieza 1.10).
// Reutiliza la vía Resend + plantillas que YA existen (renderEmail/sendEmail): cero camino nuevo.
// Por cada tenant cuyo ajuste sea cita_modo_recordatorio='auto_email', busca las citas de MAÑANA
// (Europe/Madrid) pendientes de recordatorio, con email del cliente, y manda UN recordatorio por cita.
// IDEMPOTENTE: si la cita ya tiene un aviso de recordatorio (manual o de una ejecución previa), la salta
// → una segunda ejecución (timer Persistent, arranque tardío) no reenvía. Estado honesto: 'email_enviado'.
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../modules/erp/models.js';
import { hoyLocal } from '../modules/erp/avisos.js';
import { hhmm } from '../modules/erp/citas-engine.js';
import { enviarEmailCita, serviciosDeCita, contactoDeCita, citaBaseUrl, citaEnlace, avisoHecho, registrarAviso } from '../modules/erp/citas-avisos.js';
import { sendEmail } from '../core/mailer.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANTS_DIR = join(APP_DIR, 'data', 'tenants');
const DRY = process.env.CITAS_DRY === '1';
const HOY = hoyLocal();
const MANANA = new Date(Date.parse(HOY + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const log = (m) => console.log('[recordatorios-cita] ' + m);

function tenantDbs() {
  try { return readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => join(TENANTS_DIR, f)); }
  catch { return []; }
}

async function processTenant(path) {
  const slug = basename(path, '.db');
  const db = new Database(path);
  let enviados = 0, fallos = 0, saltados = 0;
  try {
    runMigrations(db);   // idempotente: garantiza el esquema de citas (el script no pasa por el middleware)
    const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    if ((cfg.cita_modo_recordatorio || 'manual') !== 'auto_email') return { slug, modo: 'manual' };

    const empresa = cfg.company_name || 'tu negocio';
    const direccion = cfg.address || '';
    const replyTo = cfg.email || '';
    const baseUrl = citaBaseUrl(slug);

    const citas = db.prepare(
      `SELECT * FROM citas WHERE fecha=? AND archived=0 AND estado IN ('pedida','confirmada') ORDER BY inicio_min`
    ).all(MANANA);

    for (const cita of citas) {
      if (avisoHecho(db, cita.id, 'recordatorio')) { saltados++; continue; }   // ya avisado (manual o previo)
      const contacto = contactoDeCita(db, cita);
      if (!contacto.email) { saltados++; continue; }                            // sin email → no hay envío automático
      const vars = {
        tipo: 'recordatorio', destinatario: contacto.email, empresa, replyTo, cliente: contacto.nombre,
        servicio: serviciosDeCita(db, cita.id).join(' + '), fecha: cita.fecha, hora: hhmm(cita.inicio_min),
        direccion, enlace: citaEnlace(baseUrl, cita.token),
      };
      if (DRY) { log('  (dry) recordatorio a ' + contacto.email + ' · cita ' + cita.codigo); enviados++; continue; }
      try {
        await enviarEmailCita(db, vars, sendEmail);
        registrarAviso(db, { cita_id: cita.id, tipo: 'recordatorio', canal: 'email', estado: 'email_enviado' });
        enviados++;
      } catch (e) {
        registrarAviso(db, { cita_id: cita.id, tipo: 'recordatorio', canal: 'email', estado: 'email_fallo', nota: String(e.message || e).slice(0, 200) });
        fallos++;
      }
    }
    return { slug, enviados, fallos, saltados };
  } finally { db.close(); }
}

let totalEnv = 0, totalFallo = 0, conAuto = 0;
for (const path of tenantDbs()) {
  try {
    const r = await processTenant(path);
    if (r.modo === 'manual') continue;
    conAuto++; totalEnv += r.enviados; totalFallo += r.fallos;
    if (r.enviados || r.fallos) log(r.slug + ': enviados=' + r.enviados + ', fallos=' + r.fallos + ', saltados=' + r.saltados);
  } catch (e) { log('ERROR en ' + basename(path) + ': ' + (e.message || e)); }
}
log('Recordatorios ' + MANANA + ': tenants auto_email=' + conAuto + ', emails=' + totalEnv + ', fallos=' + totalFallo + (DRY ? ' (dry-run)' : ''));
process.exit(0);
