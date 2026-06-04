import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout } from '../layout.js';
import { openDebts } from '../cobros.js';
import { cobroModalHtml, cobroModalScript } from '../views/cobro-modal.js';

// T4 Paso 1 — Sección "Cobros": torre de control de lo que te deben. Lee SIEMPRE del
// motor (openDebts → clientDebt), no duplica cálculo. Cada fila permite registrar un
// cobro con el MODAL COMPARTIDO (views/cobro-modal.js), que pega al único endpoint
// POST /api/erp/invoices/:id/payments. Fuera de alcance: perfiles, próxima acción, DISA.
export function createCobrosRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // GET /api/erp/cobros — todas las deudas vivas + total global.
  api.get('/', requirePerm('orders.read'), c => {
    try {
      return c.json(openDebts(db, new Date().toISOString().slice(0, 10)));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /admin/cobros — torre de control (client-render: se refresca en vivo tras un cobro).
  views.get('/', requirePerm('orders.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';

    const content = `
      <div class="ph"><h2>Cobros</h2></div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-body" style="display:flex;align-items:baseline;gap:.75rem">
          <span style="color:var(--muted)">Te deben</span>
          <span id="cobrosTotal" style="font-size:1.8rem;font-weight:700">${sym}0.00</span>
          <span id="cobrosCount" style="color:var(--muted);font-size:.85rem"></span>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Deudas vivas (más vencidas arriba)</h3><input class="search" id="searchBox" placeholder="Buscar cliente o factura..." oninput="filterRows()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Cliente</th><th>Factura</th><th>Vence</th><th>Pendiente</th><th>Antigüedad</th><th></th></tr></thead>
          <tbody id="cobrosBody"></tbody>
        </table></div>
      </div>

      ${cobroModalHtml()}
      <script>
      ${cobroModalScript(sym)}
      const SYM = ${JSON.stringify(sym)};
      const tramoBadge = { '0-30':'b-yellow', '30-60':'b-purple', '+60':'b-red' };
      let cobrosRows = [];
      async function loadCobros(){
        let data;
        try { data = await api('GET','/api/erp/cobros'); } catch(e){ toast(e.message||'Error','err'); return; }
        cobrosRows = data.rows || [];
        document.getElementById('cobrosTotal').textContent = SYM + Number(data.total||0).toFixed(2);
        document.getElementById('cobrosCount').textContent = '· ' + cobrosRows.length + ' factura' + (cobrosRows.length===1?'':'s') + ' pendiente' + (cobrosRows.length===1?'':'s');
        document.getElementById('cobrosBody').innerHTML = cobrosRows.length ? cobrosRows.map(function(r){
          const venc = r.estado==='vencida'
            ? '<span class="badge '+(tramoBadge[r.tramo]||'')+'">'+r.dias_vencida+' días · '+r.tramo+'</span>'
            : '<span style="color:var(--muted)">al corriente</span>';
          return '<tr class="frow">'
            +'<td>'+escHtml(r.client_name||'')+'</td>'
            +'<td><a href="/admin/invoices/'+r.invoice_id+'" target="_blank"><strong>'+escHtml(r.invoice_number||'')+'</strong></a></td>'
            +'<td style="color:var(--muted);font-size:.85rem">'+escHtml(r.due_date||'-')+'</td>'
            +'<td><strong>'+SYM+Number(r.pendiente||0).toFixed(2)+'</strong></td>'
            +'<td>'+venc+'</td>'
            +'<td><button class="btn btn-secondary btn-sm" onclick="openCobros('+r.invoice_id+')">Registrar cobro</button></td>'
            +'</tr>';
        }).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">No hay deudas pendientes 🎉</td></tr>';
        filterRows();
      }
      function filterRows(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        document.querySelectorAll('#cobrosBody tr.frow').forEach(function(tr){
          tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      }
      // Punto de extensión del modal compartido: tras un cobro, recarga la torre de control
      // (la fila baja su pendiente; si llega a 0 sale de la lista y el total se actualiza).
      window.cobroOnSaved = function(id){ loadCobros(); };
      loadCobros();
      </script>`;
    return c.html(adminLayout('Cobros', content, 'cobros', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
