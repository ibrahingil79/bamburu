#!/usr/bin/env node
//
// bamburu-verifactu-cola.mjs — RED DE SEGURIDAD de la cola de envío a la AEAT.
//
// El camino normal es la cola EN PROCESO (modules/erp/verifactu-cola.js): al emitir una factura, su
// registro sale hacia la AEAT en segundos, dentro de la ventana de 240 s de la huella. Este script no
// sustituye a esa cola: la respalda. Cubre exactamente tres huecos, todos por reinicio o caída:
//
//   1. El proceso murió entre encolar el registro y enviarlo (la fila quedó 'pendiente').
//   2. El proceso se reinició mientras un registro esperaba su backoff (el timer en memoria se perdió).
//   3. La AEAT estuvo caída más de lo que dura un backoff y quedaron reintentos por hacer.
//
// NO drena el histórico: solo toca filas de verifactu_envios con `next_retry_at` no nulo, y eso solo
// lo pone la cola. Un registro antiguo, sin fila de envío, se queda donde está (enviarlo hoy solo
// devolvería 'AceptadoConErrores': su huella caducó hace semanas).
//
// Se apoya en el mismo cerrojo que la cola en proceso (lease sobre next_retry_at en una transacción
// IMMEDIATE), así que puede correr con la app viva sin enviar nada dos veces.
//
// Si un negocio no tiene certificado o falta la contraseña en el entorno, su cola está inactiva: el
// barrido lo dice y sigue con el siguiente. No es un fallo del canal.
//
// Itera cada BD de tenant igual que bamburu-avisos.mjs, y como él corre bajo systemd con
// EnvironmentFile=/etc/bamburu.env (User=ubuntu, desde /home/ubuntu/bamburu).
//
//   node scripts/bamburu-verifactu-cola.mjs                    # todos los negocios
//   node scripts/bamburu-verifactu-cola.mjs --dry-run          # dice qué haría, no envía
//   VERIFACTU_COLA_DB=data/tenants/x.db node scripts/...       # un solo negocio (pruebas)
import Database from 'better-sqlite3';
import { readdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { barrer, motivoColaInactiva, proximoTrabajo, detenerTodo } from '../modules/erp/verifactu-cola.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TENANTS_DIR = join(APP_DIR, 'data', 'tenants');
const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log('[verifactu-cola]', ...a);

function tenantDbs() {
  if (process.env.VERIFACTU_COLA_DB) return [process.env.VERIFACTU_COLA_DB];
  return readdirSync(TENANTS_DIR).filter(f => f.endsWith('.db')).map(f => join(TENANTS_DIR, f));
}

async function procesar(path) {
  const slug = basename(path, '.db');
  const db = new Database(path);
  db.bamburuSlug = slug;   // igual que hace el tenant-middleware: la cola resuelve el certificado por aquí
  try {
    runMigrations(db);     // idempotente: garantiza la columna next_retry_at (el script no pasa por el middleware)

    const motivo = motivoColaInactiva(slug);
    if (motivo) { log(slug + ': cola inactiva → ' + motivo); return { slug, motivo }; }

    if (proximoTrabajo(db) === null) { log(slug + ': nada pendiente'); return { slug, enviados: 0 }; }
    if (DRY) { log(slug + ': [dry-run] hay trabajo pendiente y la cola está activa → barrería ahora'); return { slug, dry: true }; }

    const r = await barrer(db);
    if (r.motivo) log(slug + ': ' + r.motivo);
    if (r.enviados) log(slug + ': ' + r.enviados + ' registro(s) procesado(s) en ' + r.tandas + ' tanda(s) · ' + r.aceptados + ' aceptado(s) · ' + r.fallos + ' fallo(s)');
    else if (!r.motivo) log(slug + ': nada que enviar en este barrido');
    return { slug, ...r };
  } finally {
    db.close();
  }
}

let enviados = 0, fallos = 0;
for (const path of tenantDbs()) {
  try {
    const r = await procesar(path);
    enviados += r.enviados || 0;
    fallos += r.fallos || 0;
  } catch (e) {
    fallos++;
    log(basename(path) + ': EXCEPCIÓN: ' + (e.stack || e.message));
  }
}
detenerTodo();   // por si algún vaciado dejó un timer armado: que el oneshot termine
log('Resumen: ' + enviados + ' registro(s) procesado(s), ' + fallos + ' fallo(s)' + (DRY ? ' (dry-run)' : ''));
process.exit(fallos ? 1 : 0);
