// Zona 6 · COPIAS — estado de la última copia (reutiliza el backup+healthchecks ya existente)
// + botón para lanzar una copia a demanda (ejecuta el MISMO script que el timer, como hijo).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { escHtml } from '../../core/escape.js';
import { saLayout } from './layout.js';

const MARKER = path.join(os.homedir(), '.local/state/bamburu-backup/last-success');
const SCRIPT = '/home/ubuntu/bamburu/scripts/bamburu-backup.sh';

export function backupStatus() {
  let lastEpoch = null;
  try { lastEpoch = parseInt(fs.readFileSync(MARKER, 'utf8').trim(), 10); } catch {}
  const ageH = lastEpoch ? (Date.now() / 1000 - lastEpoch) / 3600 : null;
  let lastResult = null;
  try { lastResult = execSync('systemctl show bamburu-backup.service -p Result --value', { timeout: 3000 }).toString().trim(); } catch {}
  const sem = ageH == null ? 'red' : ageH < 36 ? 'green' : ageH < 60 ? 'amber' : 'red';
  return { lastEpoch, ageH, lastResult, hc: !!process.env.HEALTHCHECKS_URL, sem };
}

export function mountBackups(sa) {
  sa.get('/backups', c => {
    const sess = c.get('sa');
    const s = backupStatus();
    const big = s.sem === 'green' ? '#10b981' : s.sem === 'amber' ? '#f59e0b' : '#ef4444';
    const cuando = s.lastEpoch ? new Date(s.lastEpoch * 1000).toLocaleString('es-ES') : 'NUNCA';
    const hace = s.ageH == null ? '—' : s.ageH < 1 ? Math.round(s.ageH * 60) + ' min' : s.ageH.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' h';
    const resultBadge = s.lastResult === 'success' ? '<span class="badge b-green">OK</span>'
      : s.lastResult ? `<span class="badge b-red">${escHtml(s.lastResult)}</span>` : '<span class="badge b-gray">—</span>';
    const content = `
      <h1>Copias de seguridad</h1>
      <div class="sa-sub">Copia diaria a Google Drive (rclone), verificada, con healthchecks. Aquí ves la última y puedes lanzar una.</div>
      <div class="card" style="display:flex;align-items:center;gap:18px">
        <div style="width:48px;height:48px;border-radius:50%;background:${big};box-shadow:0 0 22px ${big}55"></div>
        <div>
          <div style="font-size:16px;font-weight:700">Última copia con éxito: ${escHtml(cuando)} <span style="color:#64748b;font-weight:400">(hace ${escHtml(hace)})</span></div>
          <div style="color:#94a3b8;font-size:13px;margin-top:4px">Resultado del último intento del servicio: ${resultBadge} · Monitor externo (healthchecks): ${s.hc ? '<span class="badge b-green">configurado</span>' : '<span class="badge b-amber">no</span>'}</div>
        </div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px">
          <div style="color:#94a3b8;font-size:13px">Lanzar una copia ahora (snapshot + subida verificada + prueba de restore). Tarda ~1–2 min; refresca esta página al terminar.</div>
          <button class="btn btn-amber" id="runBtn" id="btnRunBackup">Lanzar copia ahora</button>
        </div>
        <div id="runMsg" style="margin-top:12px;color:#34d399;font-size:13px"></div>
      </div>
      <script nonce="${c.get('cspNonce')}">
      // C4b-1: enganchado aquí; la CSP estricta bloquea onclick de atributo.
      window.addEventListener('DOMContentLoaded', () => document.getElementById('btnRunBackup').addEventListener('click', runBackup));
        async function runBackup(){
          const b=document.getElementById('runBtn'); b.disabled=true; b.textContent='Lanzando…';
          const m=document.getElementById('runMsg');
          try{
            await saApi('POST','/superadmin/backups/run');
            m.textContent='✅ Copia lanzada en segundo plano. En ~1–2 min refresca para ver la nueva fecha.';
          }catch(e){ m.style.color='#fca5a5'; m.textContent='❌ '+e.message; }
          b.disabled=false; b.textContent='Lanzar copia ahora';
        }
      </script>`;
    return c.html(saLayout('Copias', content, 'backups', sess, sess.csrfToken, c.get('cspNonce')));
  });

  sa.post('/backups/run', c => {
    try {
      // Mismo script que el timer; corre como hijo del servicio (User=ubuntu) con su env
      // (RESEND_API_KEY, HEALTHCHECKS_URL ya están en process.env). En segundo plano.
      const child = spawn(SCRIPT, [], { env: process.env, detached: true, stdio: 'ignore' });
      child.unref();
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: 'No se pudo lanzar la copia: ' + e.message }, 500);
    }
  });
}
