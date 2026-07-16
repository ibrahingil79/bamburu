// Zona 4 · ERRORES EN VIVO — los errores internos quedan registrados y visibles aquí (los más
// recientes, con su negocio y momento), en vez de perderse. Los alimenta el app.onError de index.js.
import { escHtml } from '../../core/escape.js';
import { saLayout } from './layout.js';
import { listErrors, errorCount } from '../../core/control-db.js';

export function mountErrores(sa) {
  sa.get('/errores', c => {
    const sess = c.get('sa');
    const count = errorCount(24);
    const rows = listErrors(100).map(e => `<tr>
      <td style="color:#94a3b8;font-size:.8rem;white-space:nowrap">${new Date(e.ts * 1000).toLocaleString('es-ES')}</td>
      <td>${escHtml(e.tenant_slug || '—')}</td>
      <td style="font-family:monospace;font-size:.8rem">${escHtml((e.method || '') + ' ' + (e.path || ''))}</td>
      <td style="color:#fca5a5;font-size:.82rem">${escHtml(e.message || '')}</td></tr>`).join('');
    const content = `
      <h1>Errores en vivo</h1>
      <div class="sa-sub">Los errores internos de la plataforma quedan aquí (los ~100 más recientes), en vez de perderse.</div>
      <div class="card" style="display:flex;align-items:center;gap:14px">
        <div style="font-size:26px;font-weight:800;color:${count > 0 ? '#f87171' : '#34d399'}">${count}</div>
        <div style="color:#94a3b8;font-size:13px">errores en las últimas 24 h</div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table><thead><tr><th>Cuándo</th><th>Negocio</th><th>Petición</th><th>Mensaje</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:24px;color:#64748b">Sin errores registrados 🎉</td></tr>'}</tbody></table>
      </div>`;
    return c.html(saLayout('Errores', content, 'errores', sess, sess.csrfToken, c.get('cspNonce')));
  });
}
