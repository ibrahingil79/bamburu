#!/usr/bin/env node
//
// bamburu-avisos.mjs — Paso (d) · canal EMAIL del motor proactivo de avisos.
//
// Tarea diaria por la mañana (systemd timer). ITERA cada BD de tenant igual que el backup y,
// por cada una:
//   1. Asegura el esquema (runMigrations idempotente — el script no pasa por el middleware).
//   2. Calcula avisosDelDia (cobros de cliente vencidos, vencimientos de proveedor ≤7d o
//      vencidos, stock bajo y recurrentes en borrador).
//   3. Si HAY avisos y NO se envió ya hoy (daily_alert_log), manda UN email resumen al
//      email del negocio (company_config.email) y deja rastro. Si no hay avisos, NO envía
//      (nunca un correo vacío). Si el negocio no tiene email configurado, lo registra y sigue.
//
// Idempotente: una fila por día en daily_alert_log evita que una segunda ejecución (timer
// Persistent / reintento) reenvíe el mismo correo.
//
// Secretos (RESEND_API_KEY) vienen del EnvironmentFile del servicio (=/etc/bamburu.env), igual
// que la app. Corre como User=ubuntu (el dueño de data/ y de bamburu.service) desde el timer
// bamburu-avisos.timer (deploy/systemd/, diario 08:00 Europe/Madrid). Escribe al journal.
//
// OJO: solo envía a los tenants con company_config.email configurado. Un negocio sin email en
// sus ajustes se registra como 'no_email' y se salta — no es un fallo del canal.
//
//   node scripts/bamburu-avisos.mjs            # todos los tenants
//   node scripts/bamburu-avisos.mjs --dry-run  # calcula y reporta, NO envía ni marca
//   AVISOS_DB=data/tenants/x.db node scripts/bamburu-avisos.mjs   # un solo tenant (pruebas)
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { avisosDelDia, avisosEmail } from '../modules/erp/avisos.js';
import { sendEmail } from '../core/mailer.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANTS_DIR = join(APP_DIR, 'data', 'tenants');
const DRY = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().slice(0, 10);
const log = (...a) => console.log('[bamburu-avisos]', ...a);

// Lista de BD de tenant a procesar (o una sola vía AVISOS_DB para pruebas).
function tenantDbs() {
  if (process.env.AVISOS_DB) return [process.env.AVISOS_DB];
  return readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => join(TENANTS_DIR, f));
}

async function processTenant(path) {
  const slug = basename(path, '.db');
  const db = new Database(path);
  try {
    runMigrations(db);   // idempotente: garantiza daily_alert_log y demás esquema

    // Bloque A: genera los borradores de facturas recurrentes vencidos ANTES de calcular los avisos
    // (idempotente), para que el aviso del día incluya "borrador listo para emitir".
    try { (await import('../modules/erp/recurrentes.js')).generateDueOccurrences(db, TODAY); } catch { /* tenant sin esquema aún */ }

    const avisos = avisosDelDia(db, TODAY);
    if (!avisos.length) { log(slug + ': sin avisos hoy → no se envía'); return { slug, sent: false, avisos: 0 }; }

    const already = db.prepare('SELECT 1 FROM daily_alert_log WHERE fecha=?').get(TODAY);
    if (already && !DRY) { log(slug + ': ya enviado hoy (idempotente) → se omite'); return { slug, sent: false, avisos: avisos.length, skipped: 'already' }; }

    const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    if (!company.email) { log(slug + ': ' + avisos.length + ' aviso(s) PERO el negocio no tiene email configurado → no se envía'); return { slug, sent: false, avisos: avisos.length, skipped: 'no_email' }; }

    const tpl = avisosEmail({ avisos, company });
    if (DRY) { log(slug + ': [dry-run] ' + avisos.length + ' aviso(s) → enviaría a ' + company.email + ' · "' + tpl.subject + '"'); return { slug, sent: false, avisos: avisos.length, dry: true }; }

    const empresa = company.company_name || 'Bamburu';
    const payload = { from: 'Bamburu <noreply@bamburu.com>', to: company.email, subject: tpl.subject, html: tpl.html, text: tpl.text, replyTo: company.email };
    const { data, error } = await sendEmail(payload);
    if (error) { log(slug + ': ERROR al enviar: ' + (error.message || JSON.stringify(error))); return { slug, sent: false, avisos: avisos.length, error: true }; }

    db.prepare('INSERT OR REPLACE INTO daily_alert_log (fecha, canal, avisos) VALUES (?,?,?)').run(TODAY, 'email', avisos.length);
    log(slug + ': enviado a ' + company.email + ' · ' + avisos.length + ' aviso(s) · id ' + (data && data.id));
    return { slug, sent: true, avisos: avisos.length };
  } finally {
    db.close();
  }
}

let enviados = 0, conAvisos = 0, fallos = 0;
for (const path of tenantDbs()) {
  try {
    const r = await processTenant(path);
    if (r.avisos > 0) conAvisos++;
    if (r.sent) enviados++;
    if (r.error) fallos++;
  } catch (e) {
    fallos++;
    log(basename(path) + ': EXCEPCIÓN: ' + e.message);
  }
}
log('Resumen ' + TODAY + ': tenants con avisos=' + conAvisos + ', emails enviados=' + enviados + ', fallos=' + fallos + (DRY ? ' (dry-run)' : ''));
process.exit(fallos ? 1 : 0);
