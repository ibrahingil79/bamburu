// Zona 3 · INTEGRIDAD DE FACTURAS — recorre la cadena de hash de cada negocio (cada factura
// enlazada a la anterior) y reporta "cuadra" o "ALARMA en negocio X, factura N". SOLO LEE y
// verifica: nunca toca una factura. Usa EXACTAMENTE el mismo calcHash que la emisión.
import path from 'path';
import Database from 'better-sqlite3';
import { escHtml } from '../../core/escape.js';
import { saLayout } from './layout.js';
import { calcHash } from '../erp/routes/invoices.js';
import { listTenants, saveIntegrityResult, listIntegrityResults } from '../../core/control-db.js';

const tenantAbs = (t) => path.isAbsolute(t.db_filename) ? t.db_filename : path.join(process.cwd(), t.db_filename);

// Verifica la cadena de UN negocio (SOLO LECTURA). Devuelve { total, ok, alarm }.
// Cadena por (serie, año), en orden de secuencia: cada factura debe (1) tener un hash que
// cuadre con sus propios datos y (2) enlazar (prev_hash) con el hash de la anterior.
export function verifyTenantInvoices(absPath) {
  let total = 0, alarm = null, db;
  try {
    db = new Database(absPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    return { total: 0, ok: false, alarm: { invoice_number: '—', reason: 'no se pudo abrir la BD: ' + e.message } };
  }
  try {
    const rows = db.prepare(
      'SELECT invoice_number, series, year, sequence, issue_date, company_fiscal_id, client_fiscal_id, total, verifactu_hash, prev_hash FROM invoices ORDER BY series, year, sequence ASC'
    ).all();
    total = rows.length;
    const groups = {};
    for (const r of rows) (groups[r.series + '|' + r.year] ||= []).push(r);
    for (const key of Object.keys(groups)) {
      let prevStored = '';
      for (const inv of groups[key]) {
        if (calcHash(inv) !== inv.verifactu_hash) { alarm = { invoice_number: inv.invoice_number, reason: 'el hash no cuadra con los datos de la factura (¿alterada?)' }; break; }
        if ((inv.prev_hash || '') !== prevStored) { alarm = { invoice_number: inv.invoice_number, reason: 'el enlace con la factura anterior está roto (¿borrada/insertada?)' }; break; }
        prevStored = inv.verifactu_hash;
      }
      if (alarm) break;
    }
  } catch (e) {
    alarm = { invoice_number: '—', reason: 'error al leer las facturas: ' + e.message };
  } finally { try { db.close(); } catch {} }
  return { total, ok: !alarm, alarm };
}

export function mountIntegridad(sa) {
  sa.get('/integridad', c => {
    const sess = c.get('sa');
    const results = listIntegrityResults();
    const anyAlarm = results.some(r => !r.ok);
    const rows = results.map(r => {
      const badge = r.ok ? '<span class="badge b-green">cuadra</span>' : '<span class="badge b-red">ALARMA</span>';
      return `<tr><td><strong>${escHtml(r.tenant_slug)}</strong></td>
        <td>${r.total} factura(s)</td><td>${badge}</td>
        <td style="color:#94a3b8;font-size:.82rem">${escHtml(r.detail || '—')}</td>
        <td style="color:#64748b;font-size:.8rem">${new Date(r.ts * 1000).toLocaleString('es-ES')}</td></tr>`;
    }).join('');
    const content = `
      <h1>Integridad de facturas</h1>
      <div class="sa-sub">Recorre la cadena de hash de cada negocio y detecta si una factura legal se dañó. Solo lee y verifica.</div>
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
        <div style="color:#94a3b8;font-size:13px">${results.length ? (anyAlarm ? '<span style="color:#f87171;font-weight:700">⚠ Hay alarmas — revísalas abajo.</span>' : '<span style="color:#34d399;font-weight:700">Todo cuadra en el último chequeo.</span>') : 'Aún no se ha lanzado ningún chequeo.'}</div>
        <button class="btn btn-amber" id="runBtn" id="btnRunCheck">Lanzar chequeo ahora</button>
      </div>
      ${results.length ? `<div class="card" style="padding:0;overflow:hidden"><table>
        <thead><tr><th>Negocio</th><th>Facturas</th><th>Resultado</th><th>Detalle</th><th>Chequeado</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : ''}
      <script nonce="${c.get('cspNonce')}">
      // C4b-1: enganchado aquí; la CSP estricta bloquea onclick de atributo.
      window.addEventListener('DOMContentLoaded', () => document.getElementById('btnRunCheck').addEventListener('click', runCheck));
        async function runCheck(){
          const b=document.getElementById('runBtn'); b.disabled=true; b.textContent='Chequeando…';
          try{ await saApi('POST','/superadmin/integridad/run'); location.reload(); }
          catch(e){ alert(e.message); b.disabled=false; b.textContent='Lanzar chequeo ahora'; }
        }
      </script>`;
    return c.html(saLayout('Integridad', content, 'integridad', sess, sess.csrfToken, c.get('cspNonce')));
  });

  sa.post('/integridad/run', c => {
    for (const t of listTenants()) {
      const r = verifyTenantInvoices(tenantAbs(t));
      const detail = r.ok
        ? (r.total === 0 ? 'sin facturas' : 'cadena íntegra')
        : `ALARMA en factura ${r.alarm.invoice_number}: ${r.alarm.reason}`;
      saveIntegrityResult(t.slug, r.ok, r.total, detail);
    }
    return c.json({ ok: true });
  });
}
