// Zona 2 · SEGURIDAD — superficie de ataques: lo que la Fase 1 frena + logins fallidos + topes.
// Reutiliza las señales: security_events (rate-limits 429 + logins fallidos) y el gasto ya
// persistido (llm_spend_global global · disa_spend por negocio). Solo lectura.
import path from 'path';
import Database from 'better-sqlite3';
import { escHtml } from '../../core/escape.js';
import { saLayout } from './layout.js';
import { listSecurityEvents, securityCounts, listTenants, getGlobalLlmSpend } from '../../core/control-db.js';

const month = () => new Date().toISOString().slice(0, 7);
const eur = (n) => Number(n || 0).toFixed(2).replace('.', ',') + ' €';
const sum = (map, ...types) => types.reduce((a, t) => a + (map[t] || 0), 0);

// Gasto de IA del mes + tope de un negocio (lectura SOLO LECTURA de su .db; tolerante).
function tenantSpend(t) {
  let spend = 0, cap = 5;
  try {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(process.cwd(), t.db_filename);
    const db = new Database(abs, { readonly: true, fileMustExist: true });
    try { spend = db.prepare('SELECT eur FROM disa_spend WHERE month=?').get(month())?.eur || 0; } catch {}
    try { const v = db.prepare("SELECT value FROM platform_limits WHERE key='ai_cap_eur'").get()?.value; if (typeof v === 'number') cap = v; } catch {}
    db.close();
  } catch {}
  return { spend, cap };
}

export function mountSeguridad(sa) {
  sa.get('/seguridad', c => {
    const sess = c.get('sa');
    const m = securityCounts(24);
    const loginFail = m['login_failed'] || 0;
    const rlLogin = sum(m, 'ratelimit:admin-login', 'ratelimit:superadmin-login');
    const rlDisa = sum(m, 'ratelimit:disa-message');
    const rlReg = sum(m, 'ratelimit:registro-hora', 'ratelimit:registro-dia', 'ratelimit:onboarding-crear', 'ratelimit:onboarding', 'ratelimit:onboarding-init');
    const rlGen = sum(m, 'ratelimit:global');
    const rl429 = Object.keys(m).filter(k => k.startsWith('ratelimit:')).reduce((a, k) => a + m[k], 0);

    // Topes de gasto
    const g = getGlobalLlmSpend(month());
    const globalPct = Math.min(100, (g.eur / 50) * 100);
    const tenants = listTenants();
    const atCap = [];
    for (const t of tenants) {
      const { spend, cap } = tenantSpend(t);
      if (spend >= cap) atCap.push({ name: t.name, spend, cap });
    }

    const kpi = (n, label, danger) => `<div style="flex:1;min-width:150px;background:#0D1229;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:16px">
      <div style="font-size:26px;font-weight:800;color:${danger && n > 0 ? '#f87171' : '#e2e8f0'}">${n}</div>
      <div style="color:#94a3b8;font-size:12px;margin-top:2px">${label}</div></div>`;

    const evRows = listSecurityEvents(100).map(e => {
      const t = e.type || '';
      const badge = t === 'login_failed' ? '<span class="badge b-red">login fallido</span>'
        : t.startsWith('ratelimit:') ? `<span class="badge b-amber">freno ${escHtml(t.slice(10))}</span>`
        : `<span class="badge b-gray">${escHtml(t)}</span>`;
      return `<tr><td style="color:#94a3b8;font-size:.8rem;white-space:nowrap">${new Date(e.ts * 1000).toLocaleString('es-ES')}</td>
        <td>${badge}</td><td style="font-family:monospace;font-size:.8rem">${escHtml(e.ip || '-')}</td>
        <td>${escHtml(e.tenant_slug || '—')}</td><td style="color:#94a3b8;font-size:.82rem">${escHtml(e.detail || '')}</td></tr>`;
    }).join('');

    const content = `
      <h1>Seguridad</h1>
      <div class="sa-sub">Lo que la plataforma frena, en las últimas 24 h. Si te atacan, se ve aquí.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px">
        ${kpi(loginFail, 'Logins fallidos (24h)', true)}
        ${kpi(rlLogin, 'Frenos de login (24h)', true)}
        ${kpi(rlDisa, 'Frenos en DISA (24h)', false)}
        ${kpi(rlReg, 'Registros frenados (24h)', true)}
        ${kpi(rl429, 'Total peticiones frenadas (24h)', false)}
      </div>
      <div class="card">
        <div style="font-weight:700;margin-bottom:10px">Topes de gasto de IA</div>
        <div style="color:#94a3b8;font-size:13px">Gasto global del mes: <strong style="color:#e2e8f0">${eur(g.eur)}</strong> / 50 € (${globalPct.toFixed(0)}%)${g.alerted_80 ? ' · <span class="badge b-amber">aviso 80% enviado</span>' : ''}</div>
        <div style="margin-top:8px;color:#94a3b8;font-size:13px">Negocios que han alcanzado su tope este mes: ${atCap.length === 0 ? '<span class="badge b-green">ninguno</span>' : atCap.map(x => `<span class="badge b-red">${escHtml(x.name)} (${eur(x.spend)}/${eur(x.cap)})</span>`).join(' ')}</div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:14px 16px;font-weight:700;border-bottom:1px solid rgba(255,255,255,.06)">Eventos recientes</div>
        <table><thead><tr><th>Cuándo</th><th>Tipo</th><th>IP</th><th>Negocio</th><th>Detalle</th></tr></thead>
        <tbody>${evRows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:#64748b">Sin eventos registrados todavía</td></tr>'}</tbody></table>
      </div>`;
    return c.html(saLayout('Seguridad', content, 'seguridad', sess, sess.csrfToken, c.get('cspNonce')));
  });
}
