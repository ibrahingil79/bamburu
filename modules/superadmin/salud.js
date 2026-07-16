// Zona 1 · SALUD — semáforo del estado REAL de la plataforma (lectura del SO + ping a BD).
// Todo se calcula en vivo en cada carga; la página se autorefresca para verlo cambiar.
import os from 'os';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { escHtml } from '../../core/escape.js';
import { saLayout } from './layout.js';
import { controlDb, listTenants } from '../../core/control-db.js';

const gb = (n) => (n / 1e9).toFixed(1) + ' GB';
const worst = (a, b) => (a === 'red' || b === 'red') ? 'red' : (a === 'amber' || b === 'amber') ? 'amber' : 'green';

function diskCheck() {
  try {
    const s = fs.statfsSync(path.join(process.cwd(), 'data'));
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize, used = total - free;
    const pct = total ? (used / total) * 100 : 0;
    const sem = pct >= 90 ? 'red' : pct >= 80 ? 'amber' : 'green';
    return { sem, label: 'Disco', detail: `${pct.toFixed(0)}% usado · ${gb(free)} libres de ${gb(total)}` };
  } catch (e) { return { sem: 'red', label: 'Disco', detail: 'no se pudo leer: ' + e.message }; }
}

function dbCheck() {
  let okControl = false, total = 0, openOk = 0;
  try { controlDb.prepare('SELECT 1').get(); okControl = true; } catch {}
  let tenants = [];
  try { tenants = listTenants(); } catch {}
  total = tenants.length;
  for (const t of tenants) {
    try {
      const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(process.cwd(), t.db_filename);
      const d = new Database(abs, { readonly: true, fileMustExist: true });
      d.prepare('SELECT 1').get(); d.close(); openOk++;
    } catch {}
  }
  const sem = !okControl ? 'red' : openOk < total ? 'amber' : 'green';
  const detail = (okControl ? 'control.db responde' : 'control.db NO responde') + ` · negocios abiertos ${openOk}/${total}`;
  return { sem, label: 'Base de datos', detail };
}

function loadCheck() {
  const [l1] = os.loadavg(); const cpus = os.cpus().length || 1;
  const ratio = l1 / cpus;
  const sem = ratio >= 1.5 ? 'red' : ratio >= 0.8 ? 'amber' : 'green';
  return { sem, label: 'Carga (CPU)', detail: `load ${l1.toFixed(2)} en ${cpus} núcleos (${(ratio * 100).toFixed(0)}%)` };
}

function memCheck() {
  const free = os.freemem(), total = os.totalmem(); const pct = free / total * 100;
  const sem = pct < 10 ? 'red' : pct < 20 ? 'amber' : 'green';
  return { sem, label: 'Memoria', detail: `${gb(free)} libres de ${gb(total)} (${pct.toFixed(0)}% libre)` };
}

function serviceCheck() {
  // El panel responde → la app está viva. Caddy se consulta por systemctl (lectura, sin sudo).
  let caddy = 'desconocido';
  try { caddy = execSync('systemctl is-active caddy', { timeout: 2500 }).toString().trim(); } catch (e) { caddy = (e.stdout || '').toString().trim() || 'inactivo'; }
  const up = process.uptime();
  const upTxt = up > 3600 ? Math.floor(up / 3600) + 'h' : Math.floor(up / 60) + 'min';
  const sem = caddy === 'active' ? 'green' : 'amber';
  return { sem, label: 'Servicios', detail: `app viva (uptime ${upTxt}) · Caddy ${caddy}` };
}

export function mountSalud(sa) {
  sa.get('/salud', c => {
    const sess = c.get('sa');
    const checks = [serviceCheck(), diskCheck(), dbCheck(), loadCheck(), memCheck()];
    const overall = checks.reduce((acc, ch) => worst(acc, ch.sem), 'green');
    const dot = (s) => `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${s === 'green' ? '#10b981' : s === 'amber' ? '#f59e0b' : '#ef4444'}"></span>`;
    const big = overall === 'green' ? '#10b981' : overall === 'amber' ? '#f59e0b' : '#ef4444';
    const bigTxt = overall === 'green' ? 'TODO BIEN' : overall === 'amber' ? 'ATENCIÓN' : 'PROBLEMA';
    const rows = checks.map(ch => `<tr><td style="width:30px">${dot(ch.sem)}</td><td><strong>${escHtml(ch.label)}</strong></td><td style="color:#94a3b8">${escHtml(ch.detail)}</td></tr>`).join('');
    const content = `
      <h1>Salud del sistema</h1>
      <div class="sa-sub">Estado real, en vivo. La página se refresca sola cada 15 s.</div>
      <div class="card" style="display:flex;align-items:center;gap:18px">
        <div style="width:56px;height:56px;border-radius:50%;background:${big};box-shadow:0 0 24px ${big}66"></div>
        <div><div style="font-size:22px;font-weight:800;color:${big}">${bigTxt}</div>
        <div style="color:#94a3b8;font-size:13px">Semáforo general de la plataforma · ${new Date().toLocaleString('es-ES')}</div></div>
      </div>
      <div class="card" style="padding:6px 0"><table>${rows}</table></div>
      <meta http-equiv="refresh" content="15">`;
    return c.html(saLayout('Salud', content, 'salud', sess, sess.csrfToken, c.get('cspNonce')));
  });
}
