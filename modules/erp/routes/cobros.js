import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout, skeletonRows } from '../layout.js';
import { collectionsWorklist } from '../cobros.js';
import { cobroModalHtml, cobroModalScript } from '../views/cobro-modal.js';

// T4 Paso 1 — Sección "Cobros": torre de control de lo que te deben. Lee SIEMPRE del
// motor (openDebts → clientDebt), no duplica cálculo. Cada fila permite registrar un
// cobro con el MODAL COMPARTIDO (views/cobro-modal.js), que pega al único endpoint
// POST /api/erp/invoices/:id/payments. Fuera de alcance: perfiles, próxima acción, DISA.
export function createCobrosRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // GET /api/erp/cobros — pipeline PRIORIZADO de deudas vivas (cada una con su próxima
  // acción + motivo) + total global. Una sola fuente de verdad (collectionsWorklist).
  api.get('/', requirePerm('cobros.read'), c => {
    try {
      return c.json(collectionsWorklist(db, new Date().toISOString().slice(0, 10)));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /admin/cobros — torre de control (client-render: se refresca en vivo tras un cobro).
  views.get('/', requirePerm('cobros.read'), c => {
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
        <div class="card-head"><h3>Pipeline de cobro (más urgentes arriba)</h3><input class="search" id="searchBox" placeholder="Buscar cliente o factura..." oninput="filterRows()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Cliente</th><th>Factura</th><th>Pendiente</th><th>Etapa</th><th>Próxima acción</th><th></th></tr></thead>
          <tbody id="cobrosBody">${skeletonRows(6)}</tbody>
        </table></div>
      </div>

      ${cobroModalHtml()}
      <script>
      ${cobroModalScript(sym)}
      const SYM = ${JSON.stringify(sym)};
      let cobrosRows = [];
      function accionTxt(p){
        if(!p) return 'Sin acción';
        if(p.accion==='recordatorio_email') return 'Mandar recordatorio';
        if(p.etapa==='promesa') return 'Esperar (promesa)';
        if(p.etapa==='manual') return 'Gestión manual';
        if(p.etapa==='por_vencer') return 'Aún no vence';
        return 'Sin acción';
      }
      async function loadCobros(){
        let data;
        try { data = await api('GET','/api/erp/cobros'); } catch(e){ toast(e.message||'Error','err'); return; }
        cobrosRows = data.rows || [];
        document.getElementById('cobrosTotal').textContent = SYM + Number(data.total||0).toFixed(2);
        document.getElementById('cobrosCount').textContent = '· ' + cobrosRows.length + ' factura' + (cobrosRows.length===1?'':'s') + ' pendiente' + (cobrosRows.length===1?'':'s');
        document.getElementById('cobrosBody').innerHTML = cobrosRows.length ? cobrosRows.map(function(r){
          const p = r.proximaAccion||null;
          const fecha = p&&p.fechaObjetivo ? ' <span style="color:var(--muted);font-size:.8rem">· '+escHtml(p.fechaObjetivo)+'</span>' : '';
          return '<tr class="frow">'
            +'<td>'+escHtml(r.client_name||'')+'</td>'
            +'<td><a href="/admin/invoices/'+r.invoice_id+'" target="_blank"><strong>'+escHtml(r.invoice_number||'')+'</strong></a></td>'
            +'<td><strong>'+SYM+Number(r.pendiente||0).toFixed(2)+'</strong></td>'
            +'<td>'+(window.proximaBadgeHtml?window.proximaBadgeHtml(p):'')+'</td>'
            +'<td>'+escHtml(accionTxt(p))+fecha+'<div style="color:var(--muted);font-size:.8rem">'+escHtml(r.motivo||'')+'</div></td>'
            // U4: la acción frecuente (registrar el cobro que ha entrado) es directa —abre el
            // formulario ya precargado (importe pendiente + fecha hoy + forma)—; "Gestionar" (la
            // reclamación: próxima acción, recordatorios) queda a un clic. Antes se llegaba al
            // cobro pasando SIEMPRE por Gestionar (3 clics); ahora son 2, como el espejo de Pagos.
            +'<td style="white-space:nowrap"><button class="btn btn-primary btn-sm" onclick="openCobros('+r.invoice_id+')">Registrar cobro</button> <button class="btn btn-secondary btn-sm" onclick="openGestion('+r.invoice_id+')">Gestionar</button></td>'
            +'</tr>';
        }).join('') : window.emptyRow(6, 'No hay nada pendiente de cobro ahora mismo. Todo al día.', { tone: 'ok' });
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
