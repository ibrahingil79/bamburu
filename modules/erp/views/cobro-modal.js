// Componente compartido del MODAL DE COBRO de una factura. Mismo patrón que
// views/line-search.js: HTML reutilizable + script reutilizable con un punto de
// extensión por página.
//
// Lo usan los TRES sitios (factura, sección Cobros, ficha de cliente). Al guardar,
// todos llaman al ÚNICO endpoint de escritura POST /api/erp/invoices/:id/payments
// (no hay otra lógica de guardado). Cada página define window.cobroOnSaved(invoiceId)
// para refrescar SOLO su propia vista (igual que applyLinePick en line-search).
//
// Requiere los globales de adminLayout: api, toast, escHtml, openModal, closeModal.

export function cobroModalHtml() {
  return `<div class="modal-overlay" id="cobroModal">
    <div class="modal" style="max-width:640px">
      <div class="modal-head"><h3 id="cobroTitle">Cobros</h3><button class="modal-close" onclick="closeModal('cobroModal')">✕</button></div>
      <div class="modal-body" id="cobroBody"></div>
    </div>
  </div>`;
}

export function cobroModalScript(sym) {
  return `
  (function(){
    const SYM = ${JSON.stringify(sym)};
    // Abre el modal de cobro de UNA factura: cobrado/pendiente + historial + formulario.
    window.openCobros = async function(id){
      let inv;
      try { inv = await api('GET','/api/erp/invoices/'+id); } catch(e){ toast(e.message||'Error','err'); return; }
      const co = inv.cobro||{};
      document.getElementById('cobroTitle').textContent = 'Cobros · '+inv.invoice_number;
      let running = 0;
      const payRows = (inv.payments && inv.payments.length) ? inv.payments.map(function(p){
        running = Math.round((running+Number(p.amount))*100)/100;
        const saldo = Math.round((Number(inv.total)-running)*100)/100;
        return '<tr><td>'+p.paid_date+'</td><td style="text-align:right">'+SYM+Number(p.amount).toFixed(2)+'</td><td>'+escHtml(p.payment_method||'—')+'</td><td>'+escHtml(p.note||'')+'</td><td style="text-align:right;color:var(--muted)">'+SYM+saldo.toFixed(2)+'</td></tr>';
      }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:1rem">Sin cobros registrados</td></tr>';
      // El formulario solo si la factura admite cobro (flag del motor: inv.cobrable) y queda pendiente.
      const canRegister = inv.cobrable && co.pendiente > 0.0049;
      const form = canRegister
        ? '<div class="form-row" style="align-items:end;gap:.5rem;flex-wrap:wrap">'
          +'<div class="form-group"><label class="form-label">Fecha</label><input type="date" id="pay-date" class="form-control" value="'+new Date().toISOString().slice(0,10)+'"></div>'
          +'<div class="form-group"><label class="form-label">Importe</label><input type="number" id="pay-amount" class="form-control" step="0.01" min="0.01" value="'+Number(co.pendiente||0).toFixed(2)+'" style="width:120px"></div>'
          +'<div class="form-group"><label class="form-label">Forma</label><select id="pay-method" class="form-control"><option value="">—</option><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="domiciliacion">Domiciliación</option></select></div>'
          +'<div class="form-group" style="flex:1;min-width:140px"><label class="form-label">Nota</label><input type="text" id="pay-note" class="form-control" placeholder="(opcional)"></div>'
          +'<button class="btn btn-primary" onclick="registrarCobro('+inv.id+')">Registrar cobro</button>'
          +'</div>'
        : '<p style="color:var(--muted);margin:0">'+(co.estado==='cobrada'?'Factura cobrada por completo.':'Esta factura no admite registrar más cobros.')+'</p>';
      document.getElementById('cobroBody').innerHTML =
        '<div style="margin-bottom:1rem">Cobrado <strong>'+SYM+Number(co.cobrado||0).toFixed(2)+'</strong> · Pendiente <strong>'+SYM+Number(co.pendiente||0).toFixed(2)+'</strong> <span style="color:var(--muted)">(de '+SYM+Number(inv.total||0).toFixed(2)+')</span></div>'
        +'<div class="table-wrap" style="margin-bottom:1rem"><table><thead><tr><th>Fecha</th><th style="text-align:right">Importe</th><th>Forma</th><th>Nota</th><th style="text-align:right">Saldo</th></tr></thead><tbody>'+payRows+'</tbody></table></div>'
        +form;
      openModal('cobroModal');
    };
    // Guarda un cobro: ÚNICO endpoint de escritura. Refresca el modal y avisa a la página.
    window.registrarCobro = async function(id){
      const amount = parseFloat(document.getElementById('pay-amount').value);
      if(!(amount>0)){ toast('Importe inválido','err'); return; }
      const paid_date = document.getElementById('pay-date').value || undefined;
      const payment_method = document.getElementById('pay-method').value || '';
      const note = document.getElementById('pay-note').value || '';
      try {
        await api('POST','/api/erp/invoices/'+id+'/payments',{ amount, paid_date, payment_method, note });
        toast('Cobro registrado');
        await openCobros(id);                                              // refresca el propio modal
        if (typeof window.cobroOnSaved === 'function') window.cobroOnSaved(id);  // refresca la vista de la página
      } catch(e){ toast(e.message||'Error registrando el cobro','err'); }
    };
  })();
  `;
}
