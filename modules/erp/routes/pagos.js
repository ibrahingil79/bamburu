import { Hono } from 'hono';
import { requirePerm } from '../../../core/auth.js';
import { adminLayout, skeletonRows } from '../layout.js';
import { openPayables } from '../pagos.js';
import { pagoModalHtml, pagoCuentaModalHtml, pagoModalScript } from '../views/pago-modal.js';

// Sección "Pagos a proveedores": torre de control de lo que DEBES. Espejo de la sección
// Cobros. Lee SIEMPRE del motor (openPayables → supplierDebt), no duplica cálculo. Cada
// fila registra un pago con el MODAL COMPARTIDO (views/pago-modal.js), que pega al único
// endpoint POST /api/erp/supplier-invoices/:id/payments. Fuera de alcance: DISA proactiva.
export function createPagosRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // GET /api/erp/pagos — deudas vivas con proveedores (más vencida arriba) + total global.
  api.get('/', requirePerm('purchases.read'), c => {
    try {
      return c.json(openPayables(db, new Date().toISOString().slice(0, 10)));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /admin/pagos — torre de control (client-render: se refresca en vivo tras un pago).
  views.get('/', requirePerm('purchases.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Pagos a proveedores</h2></div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-body" style="display:flex;align-items:baseline;gap:.75rem">
          <span style="color:var(--muted)">Debes</span>
          <span id="pagosTotal" style="font-size:1.8rem;font-weight:700">${sym}0.00</span>
          <span id="pagosCount" style="color:var(--muted);font-size:.85rem"></span>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Deudas con proveedores (más urgentes arriba)</h3><input class="search" id="searchBox" placeholder="Buscar proveedor o factura..." oninput="filterRows()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Proveedor</th><th>Factura</th><th>Vence</th><th>Pendiente</th><th>Estado</th><th></th></tr></thead>
          <tbody id="pagosBody">${skeletonRows(6)}</tbody>
        </table></div>
      </div>

      ${pagoModalHtml()}
      ${pagoCuentaModalHtml()}
      <script>
      ${pagoModalScript(sym)}
      const SYM = ${JSON.stringify(sym)};
      const ESTADO_LABEL = { pendiente:'Pendiente', parcial:'Pagada en parte', vencida:'Vencida', abono:'Abono (a tu favor)', reembolsado:'Reembolsado' };
      const ESTADO_BADGE = { pendiente:'b-yellow', parcial:'b-blue', vencida:'b-red', abono:'b-purple', reembolsado:'b-gray' };
      let pagosRows = [];
      async function loadPagos(){
        let data;
        try { data = await api('GET','/api/erp/pagos'); } catch(e){ toast(e.message||'Error','err'); return; }
        pagosRows = data.rows || [];
        // El total puede ser NEGATIVO si los abonos superan la deuda → saldo a tu favor.
        const neto = Number(data.total||0);
        const totEl = document.getElementById('pagosTotal');
        const lblEl = document.querySelector('#pagosTotal').previousElementSibling;
        if (neto < -0.0049) { lblEl.textContent='Saldo a tu favor'; totEl.textContent=SYM+Math.abs(neto).toFixed(2); totEl.style.color='var(--ok)'; }
        else { lblEl.textContent='Debes'; totEl.textContent=SYM+neto.toFixed(2); totEl.style.color=''; }
        document.getElementById('pagosCount').textContent = '· ' + pagosRows.length + ' documento' + (pagosRows.length===1?'':'s');
        document.getElementById('pagosBody').innerHTML = pagosRows.length ? pagosRows.map(function(r){
          const tramo = r.dias_vencida>0 ? ' · '+r.dias_vencida+'d' : '';
          const esAbono = r.estado==='abono' || Number(r.pendiente)<-0.0049;
          const pend = esAbono
            ? '<strong style="color:var(--ok)">'+SYM+Number(r.pendiente||0).toFixed(2)+'</strong> <span style="color:var(--muted);font-size:.78rem">(a tu favor)</span>'
            : '<strong>'+SYM+Number(r.pendiente||0).toFixed(2)+'</strong>';
          const btn = esAbono
            ? '<button class="btn btn-secondary btn-sm" onclick="openPagos('+r.supplier_invoice_id+')">Reembolso</button>'
            : '<button class="btn btn-secondary btn-sm" onclick="openPagos('+r.supplier_invoice_id+')">Pagar</button>'
              + ' <button class="btn btn-secondary btn-sm" title="Saldar varias facturas de este proveedor a la vez" onclick="openPagoCuenta('+r.supplier_id+')">A cuenta</button>';
          return '<tr class="frow">'
            +'<td>'+escHtml(r.supplier_name||'')+'</td>'
            +'<td><a href="/admin/supplier-invoices/'+r.supplier_invoice_id+'"><strong>'+escHtml(r.internal_code||'')+'</strong></a>'+(r.supplier_invoice_number?' <span style="color:var(--muted);font-size:.8rem">'+escHtml(r.supplier_invoice_number)+'</span>':'')+'</td>'
            +'<td>'+escHtml(r.due_date||'-')+'</td>'
            +'<td>'+pend+'</td>'
            +'<td><span class="badge '+(ESTADO_BADGE[r.estado]||'')+'">'+(ESTADO_LABEL[r.estado]||r.estado)+tramo+'</span></td>'
            +'<td>'+btn+'</td>'
            +'</tr>';
        }).join('') : window.emptyRow(6, 'No debes nada a proveedores ahora mismo. Todo al día.', { tone: 'ok' });
        filterRows();
      }
      function filterRows(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        document.querySelectorAll('#pagosBody tr.frow').forEach(function(tr){ tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      }
      // Tras un pago, recarga la torre (la fila baja su pendiente; si llega a 0 sale de la lista).
      window.pagoOnSaved = function(){ loadPagos(); };
      loadPagos();
      </script>`;
    return c.html(adminLayout('Pagos a proveedores', content, 'pagos', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
