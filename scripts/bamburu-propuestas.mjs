#!/usr/bin/env node
//
// bamburu-propuestas.mjs — D5 (Eje B) · generación diaria de PROPUESTAS DE DISA (recordatorio de impago).
//
// Proceso programado (systemd timer). ITERA cada BD de tenant igual que el cron de avisos y, por cada una:
//   1. Asegura el esquema (runMigrations idempotente — el script no pasa por el middleware).
//   2. Genera los borradores de recordatorio que falten para facturas de venta vencidas con retraso ≥
//      umbral del negocio (company_config.dias_recordatorio_impago, por defecto 7). NO envía nada:
//      deja los borradores en disa_proposals para que el dueño los apruebe en el panel.
//
// IDEMPOTENTE: el índice único (invoice_id, type) impide duplicar; una factura ya propuesta —o
// descartada— no se vuelve a proponer. Correr dos veces el mismo día no crea nada de más.
//
// AISLAMIENTO: una BD por negocio; jamás se cruzan datos entre tenants.
//
// Este proceso NO manda emails (a diferencia del cron de avisos): solo prepara. El envío es manual,
// con aprobación, desde /admin/propuestas. Por eso no necesita RESEND_API_KEY para funcionar.
//
//   node scripts/bamburu-propuestas.mjs            # todos los tenants
//   node scripts/bamburu-propuestas.mjs --dry-run  # calcula y reporta, NO inserta
//   PROPUESTAS_DB=data/tenants/x.db node scripts/bamburu-propuestas.mjs   # un solo tenant (pruebas)
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../modules/erp/models.js';
import { generarPropuestasImpago, umbralImpago } from '../modules/erp/propuestas.js';
import { hoyLocal } from '../modules/erp/avisos.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANTS_DIR = join(APP_DIR, 'data', 'tenants');
const DRY = process.argv.includes('--dry-run');
const TODAY = hoyLocal();
const log = (...a) => console.log('[bamburu-propuestas]', ...a);

function tenantDbs() {
  if (process.env.PROPUESTAS_DB) return [process.env.PROPUESTAS_DB];
  return readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => join(TENANTS_DIR, f));
}

function processTenant(path) {
  const slug = basename(path, '.db');
  const db = new Database(path);
  try {
    runMigrations(db);   // idempotente: garantiza disa_proposals y la columna del umbral
    if (DRY) {
      // Simular sobre una transacción que se revierte: cuenta lo que crearía, sin escribir.
      const umbral = umbralImpago(db);
      db.exec('BEGIN');
      const r = generarPropuestasImpago(db, { today: TODAY });
      db.exec('ROLLBACK');
      log(slug + ': [dry-run] umbral ' + umbral + 'd · candidatas ' + r.candidatas + ' → crearía ' + r.creadas
        + ', ya tenían ' + r.yaTenian + ', sin email ' + r.sinEmail);
      return { slug, creadas: r.creadas, sinEmail: r.sinEmail };
    }
    const r = generarPropuestasImpago(db, { today: TODAY });
    log(slug + ': umbral ' + r.umbral + 'd · candidatas ' + r.candidatas + ' → creadas ' + r.creadas
      + ', ya tenían ' + r.yaTenian + ', sin email ' + r.sinEmail);
    return { slug, creadas: r.creadas, sinEmail: r.sinEmail };
  } finally {
    db.close();
  }
}

let totalCreadas = 0, totalSinEmail = 0, fallos = 0;
for (const path of tenantDbs()) {
  try {
    const r = processTenant(path);
    totalCreadas += r.creadas; totalSinEmail += r.sinEmail;
  } catch (e) {
    fallos++;
    log(basename(path) + ': EXCEPCIÓN: ' + e.message);
  }
}
log('Resumen ' + TODAY + ': propuestas nuevas=' + totalCreadas + ', facturas sin email del cliente=' + totalSinEmail
  + ', fallos=' + fallos + (DRY ? ' (dry-run)' : ''));
