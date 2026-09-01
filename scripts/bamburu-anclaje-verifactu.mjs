#!/usr/bin/env node
//
// bamburu-anclaje-verifactu.mjs — el barrido que ancla, por negocio, la cadena de VERI*FACTU
// FUERA del servidor (docs/verifactu/anclaje-externo.md).
//
// Calcado del esqueleto de scripts/bamburu-verifactu-cola.mjs: itera cada BD de tenant, resuelve el
// slug, llama a runMigrations(db) porque no pasa por el tenant-middleware, y sigue con el siguiente
// negocio si uno falla. La pieza que de verdad decide y escribe es modules/erp/verifactu-anclaje.js
// (anclar()); este script SOLO la invoca por negocio y manda el correo diario.
//
// APAGADO POR DEFECTO Y A PROPÓSITO: sin VERIFACTU_ANCLAJE_TSA + VERIFACTU_ANCLAJE_TSA_CA en el
// entorno del servicio, `anclar()` no escribe ni una fila en ningún negocio — este barrido puede
// correr entero sin sellar nada, y lo dice.
//
//   node scripts/bamburu-anclaje-verifactu.mjs                         # todos los negocios
//   node scripts/bamburu-anclaje-verifactu.mjs --dry-run               # dice qué haría, no ancla ni manda correo
//   ANCLAJE_VERIFACTU_DB=data/tenants/x.db node scripts/...            # un solo negocio (pruebas)
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { anclar, motivoAnclajeInactivo } from '../modules/erp/verifactu-anclaje.js';
import { hoyLocal } from '../modules/erp/avisos.js';
import { sendEmail } from '../core/mailer.js';
import { initControlDb, controlDb } from '../core/control-db.js';
import { escHtml } from '../core/escape.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANTS_DIR = join(APP_DIR, 'data', 'tenants');
const DRY = process.argv.includes('--dry-run');
const HOY = hoyLocal();
const MAILTO = process.env.BAMBURU_ANCLAJE_MAILTO || 'ibrahingil@gmail.com';
const MARCA_KEY = 'verifactu_anclaje_email_' + HOY;
const log = (...a) => console.log('[anclaje-verifactu]', ...a);

function tenantDbs() {
  if (process.env.ANCLAJE_VERIFACTU_DB) return [process.env.ANCLAJE_VERIFACTU_DB];
  return readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => join(TENANTS_DIR, f));
}

// Vista previa SIN escribir nada y SIN llamar a la TSA: la misma decisión de `anclar()` (§2.4 del
// plano), reproducida aquí de solo lectura porque un --dry-run no puede invocar la función que sella.
function decidiriaAnclar(db) {
  const maxInv = db.prepare('SELECT COALESCE(MAX(id),0) m FROM invoices').get().m;
  const maxAnu = db.prepare('SELECT COALESCE(MAX(id),0) m FROM invoice_anulaciones').get().m;
  const maxReg = db.prepare('SELECT COALESCE(MAX(id),0) m FROM verifactu_registros').get().m;
  if (maxInv === 0 && maxReg === 0) return 'sin material fiscal que anclar';
  const ultimo = db.prepare(`SELECT * FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia DESC LIMIT 1`).get();
  const latidoMs = (Number(process.env.ANCLAJE_LATIDO_H) > 0 ? Number(process.env.ANCLAJE_LATIDO_H) : 24) * 3600 * 1000;
  const subioAlgo = !ultimo || maxInv > ultimo.hasta_invoice_id || maxAnu > ultimo.hasta_anulacion_id || maxReg > ultimo.hasta_registro_id;
  const pasoElLatido = !ultimo || (Date.now() - Date.parse(ultimo.created_at)) >= latidoMs;
  return (subioAlgo || pasoElLatido) ? 'tocaría anclar' : 'nada nuevo, no toca aún';
}

async function procesar(path) {
  const slug = basename(path, '.db');
  const db = new Database(path);
  db.bamburuSlug = slug;
  try {
    runMigrations(db);   // idempotente: garantiza el esquema (el script no pasa por el middleware)

    const motivo = motivoAnclajeInactivo(slug);
    if (motivo) { log(slug + ': anclaje inactivo → ' + motivo); return { slug, anclado: false, motivo }; }

    if (DRY) { const previsto = decidiriaAnclar(db); log(slug + ': [dry-run] ' + previsto); return { slug, dry: true }; }

    const r = await anclar(db);
    if (r.motivo) log(slug + ': ' + r.motivo);
    else if (r.anclado) log(slug + ': anclado · secuencia ' + r.secuencia + (r.cadenaOk ? '' : ' · ALARMA: ' + r.cadenaDetalle));
    else log(slug + ': NO se pudo sellar: ' + r.error);
    return { slug, ...r };
  } finally {
    db.close();
  }
}

// ── Correo diario, UNA vez por fecha (marca en settings de control.db) ──────────────────────────
// Lee el estado ACTUAL de cada negocio (no solo lo que hizo este barrido: el primer barrido del día
// puede correr antes de que a un negocio le toque su latido). Los negocios sin ningún dato fiscal
// (facturas ni registros) no aparecen: nunca los ancla `anclar()`, así que no tienen nada que contar.
async function mandarCorreoDiario() {
  initControlDb();
  if (controlDb.prepare('SELECT value FROM settings WHERE key=?').get(MARCA_KEY)) {
    log('correo diario: ya se mandó hoy (' + HOY + ')'); return;
  }

  const filas = [];
  const attachments = [];
  let algunoSinSellar = false;

  for (const path of tenantDbs()) {
    const slug = basename(path, '.db');
    const db = new Database(path, { readonly: true });
    try {
      const nInv = db.prepare('SELECT COUNT(*) c FROM invoices').get().c;
      const nReg = db.prepare('SELECT COUNT(*) c FROM verifactu_registros').get().c;
      if (nInv === 0 && nReg === 0) continue;

      const ultimo = db.prepare(`SELECT * FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia DESC LIMIT 1`).get();
      if (!ultimo) {
        algunoSinSellar = true;
        const motivo = motivoAnclajeInactivo(slug);
        filas.push({ slug, texto: 'Nunca se ha sellado nada.' + (motivo ? ' (' + motivo + ')' : '') });
        continue;
      }

      filas.push({
        slug,
        texto: nInv + ' factura(s) · sello ' + (ultimo.sellado_at || ultimo.created_at)
          + ' · raíz ' + ultimo.raiz + ' · TSA ' + ultimo.tsa_url,
      });
      if (ultimo.token) attachments.push({ filename: slug + '-anclaje-' + ultimo.secuencia + '.tsr', content: ultimo.token });
    } finally {
      db.close();
    }
  }

  if (!filas.length) { log('correo diario: ningún negocio con material fiscal que reportar'); return; }

  const asunto = 'Sellado externo Verifactu — ' + HOY + (algunoSinSellar ? ' · ⚠️ sin sellar' : '');
  const texto = filas.map(f => '· ' + f.slug + ': ' + f.texto).join('\n');
  const html = '<p>Estado del anclaje externo de VERI*FACTU, ' + escHtml(HOY) + ':</p><ul>'
    + filas.map(f => '<li><strong>' + escHtml(f.slug) + '</strong>: ' + escHtml(f.texto) + '</li>').join('') + '</ul>';

  const r = await sendEmail({
    from: 'Bamburu <noreply@bamburu.com>',
    to: MAILTO,
    subject: asunto,
    text: texto,
    html,
    ...(attachments.length ? { attachments } : {}),
  });
  if (r && r.error) { log('correo diario: NO enviado: ' + (r.error.message || JSON.stringify(r.error))); return; }

  controlDb.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(MARCA_KEY, new Date().toISOString());
  log('correo diario: enviado a ' + MAILTO + ' · ' + filas.length + ' negocio(s)' + (algunoSinSellar ? ' · ⚠️ sin sellar' : ''));
}

let anclados = 0, fallos = 0;
for (const path of tenantDbs()) {
  try {
    const r = await procesar(path);
    if (r.anclado) anclados++;
    else if (r.error) fallos++;
  } catch (e) {
    fallos++;
    log(basename(path) + ': EXCEPCIÓN: ' + (e.stack || e.message));
  }
}
log('Resumen: ' + anclados + ' anclado(s), ' + fallos + ' fallo(s)' + (DRY ? ' (dry-run)' : ''));

if (!DRY) {
  try { await mandarCorreoDiario(); }
  catch (e) { log('correo diario: EXCEPCIÓN: ' + (e.stack || e.message)); }
}

// Interruptor de hombre muerto opcional (igual que las copias): sin la variable, no se llama a nadie.
if (!DRY && process.env.ANCLAJE_HC_URL) {
  try { await fetch(process.env.ANCLAJE_HC_URL, { signal: AbortSignal.timeout(20000) }); }
  catch (e) { log('ping healthchecks falló: ' + e.message); }
}

process.exit(fallos ? 1 : 0);
