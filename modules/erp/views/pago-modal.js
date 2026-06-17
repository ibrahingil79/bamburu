// Componente compartido del MODAL DE PAGO de una factura recibida. Espejo de
// views/cobro-modal.js (parte de cobro de Paso 1): HTML reutilizable + script reutilizable
// con un punto de extensión por página.
//
// Lo usan los sitios de pagos (lista de facturas recibidas, ficha de la factura recibida,
// sección "Pagos a proveedores" y la deuda del proveedor). Al guardar, TODOS llaman al
// ÚNICO endpoint de escritura POST /api/erp/supplier-invoices/:id/payments (no hay otra
// lógica de guardado). Cada página define window.pagoOnSaved(id) para refrescar SOLO su
// propia vista (igual que cobroOnSaved en el modal de cobro).
//
// Requiere los globales de adminLayout: api, toast, escHtml, openModal, closeModal.

export function pagoModalHtml() {
  return `<div class="modal-overlay" id="pagoModal">
    <div class="modal" style="max-width:640px">
      <div class="modal-head"><h3 id="pagoTitle">Pagos</h3><button class="modal-close" onclick="closeModal('pagoModal')">✕</button></div>
      <div class="modal-body" id="pagoBody"></div>
    </div>
  </div>`;
}

export function pagoModalScript(sym) {
  return `
  (function(){
    const SYM = ${JSON.stringify(sym)};
    // Abre el modal de pago de UNA factura recibida: pagado/pendiente + historial + formulario.
    window.openPagos = async function(id){
      let inv;
      try { inv = await api('GET','/api/erp/supplier-invoices/'+id); } catch(e){ toast(e.message||'Error','err'); return; }
      const pg = inv.pago||{};
      const titulo = inv.internal_code || ('#'+inv.id);
      // ABONO (total negativo): no se paga, se REEMBOLSA. Modal en modo crédito/reembolso.
      if (Number(inv.total) < 0) { renderAbono(inv, pg, titulo); return; }
      document.getElementById('pagoTitle').textContent = 'Pagos · '+titulo;
      let running = 0;
      const payRows = (inv.payments && inv.payments.length) ? inv.payments.map(function(p){
        running = Math.round((running+Number(p.amount))*100)/100;
        const saldo = Math.round((Number(inv.total)-running)*100)/100;
        return '<tr><td>'+p.paid_date+'</td><td style="text-align:right">'+SYM+Number(p.amount).toFixed(2)+'</td><td>'+escHtml(p.payment_method||'—')+'</td><td>'+escHtml(p.note||'')+'</td><td style="text-align:right;color:var(--muted)">'+SYM+saldo.toFixed(2)+'</td>'
          +'<td style="text-align:right"><button class="btn btn-secondary btn-sm" title="Deshacer este pago" onclick="deshacerPago('+inv.id+','+p.id+')">Deshacer</button></td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:1rem">Sin pagos registrados</td></tr>';
      // El formulario solo si la factura admite pago (flag del motor: inv.pagable) y queda pendiente.
      const canRegister = inv.pagable && pg.pendiente > 0.0049;
      const defMethod = inv.payment_method_default || '';
      const methodOpt = function(v,l){ return '<option value="'+v+'"'+(defMethod===v?' selected':'')+'>'+l+'</option>'; };
      const form = canRegister
        ? '<div class="form-row" style="align-items:end;gap:.5rem;flex-wrap:wrap">'
          +'<div class="form-group"><label class="form-label">Fecha</label><input type="date" id="spay-date" class="form-control" value="'+new Date().toISOString().slice(0,10)+'"></div>'
          +'<div class="form-group"><label class="form-label">Importe</label><input type="number" id="spay-amount" class="form-control" step="0.01" min="0.01" value="'+Number(pg.pendiente||0).toFixed(2)+'" style="width:120px"></div>'
          +'<div class="form-group"><label class="form-label">Forma</label><select id="spay-method" class="form-control"><option value="">—</option>'+methodOpt('transferencia','Transferencia')+methodOpt('efectivo','Efectivo')+methodOpt('tarjeta','Tarjeta')+methodOpt('domiciliacion','Domiciliación')+'</select></div>'
          +'<div class="form-group" style="flex:1;min-width:140px"><label class="form-label">Nota</label><input type="text" id="spay-note" class="form-control" placeholder="(opcional)"></div>'
          +'<button class="btn btn-primary" onclick="registrarPago('+inv.id+')">Registrar pago</button>'
          +'</div>'
        : '<p style="color:var(--muted);margin:0">'+(pg.estado==='pagada'?'Factura pagada por completo.':(inv.status==='anulada'?'Factura anulada: no admite pagos.':'Esta factura no admite registrar más pagos.'))+'</p>';
      document.getElementById('pagoBody').innerHTML =
        '<div style="margin-bottom:1rem">Pagado <strong>'+SYM+Number(pg.pagado||0).toFixed(2)+'</strong> · Pendiente <strong>'+SYM+Number(pg.pendiente||0).toFixed(2)+'</strong> <span style="color:var(--muted)">(de '+SYM+Number(inv.total||0).toFixed(2)+')</span></div>'
        +'<div class="table-wrap" style="margin-bottom:1rem"><table><thead><tr><th>Fecha</th><th style="text-align:right">Importe</th><th>Forma</th><th>Nota</th><th style="text-align:right">Saldo</th><th></th></tr></thead><tbody>'+payRows+'</tbody></table></div>'
        +form;
      openModal('pagoModal');
    };
    // Deshacer un pago concreto (corrige un apunte mal metido; NO anula la factura).
    window.deshacerPago = async function(invoiceId, paymentId){
      if(!confirm('¿Deshacer este pago? Se elimina solo este apunte de caja; la factura sigue igual.')) return;
      try {
        await api('DELETE','/api/erp/supplier-invoices/'+invoiceId+'/payments/'+paymentId);
        toast('Pago deshecho');
        await openPagos(invoiceId);
        if (typeof window.pagoOnSaved === 'function') window.pagoOnSaved(invoiceId);
      } catch(e){ toast(e.message||'Error deshaciendo el pago','err'); }
    };
    // Guarda un pago: ÚNICO endpoint de escritura. Refresca el modal y avisa a la página.
    window.registrarPago = async function(id){
      const amount = parseFloat(document.getElementById('spay-amount').value);
      if(!(amount>0)){ toast('Importe inválido','err'); return; }
      const paid_date = document.getElementById('spay-date').value || undefined;
      const payment_method = document.getElementById('spay-method').value || '';
      const note = document.getElementById('spay-note').value || '';
      try {
        await api('POST','/api/erp/supplier-invoices/'+id+'/payments',{ amount, paid_date, payment_method, note });
        toast('Pago registrado');
        await openPagos(id);                                              // refresca el propio modal
        if (typeof window.pagoOnSaved === 'function') window.pagoOnSaved(id);  // refresca la vista de la página
      } catch(e){ toast(e.message||'Error registrando el pago','err'); }
    };

    // ── ABONO (crédito a tu favor por una devolución) — registrar REEMBOLSO recibido ──
    function renderAbono(inv, pg, titulo){
      document.getElementById('pagoTitle').textContent = 'Abono · '+titulo;
      const credito = Math.abs(Number(inv.total)||0);
      const reembolsado = Math.abs(Number(pg.pagado)||0);     // pagos negativos → abs
      const pteCredito = Math.abs(Number(pg.pendiente)||0);   // crédito sin reembolsar
      const refRows = (inv.payments && inv.payments.length) ? inv.payments.map(function(p){
        return '<tr><td>'+p.paid_date+'</td><td style="text-align:right">'+SYM+Math.abs(Number(p.amount)).toFixed(2)+'</td><td>'+escHtml(p.payment_method||'—')+'</td><td>'+escHtml(p.note||'')+'</td>'
          +'<td style="text-align:right"><button class="btn btn-secondary btn-sm" onclick="deshacerPago('+inv.id+','+p.id+')">Deshacer</button></td></tr>';
      }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:1rem">Sin reembolsos registrados</td></tr>';
      const canRefund = inv.refundable && pteCredito > 0.0049;
      const form = canRefund
        ? '<div class="form-row" style="align-items:end;gap:.5rem;flex-wrap:wrap">'
          +'<div class="form-group"><label class="form-label">Fecha</label><input type="date" id="ref-date" class="form-control" value="'+new Date().toISOString().slice(0,10)+'"></div>'
          +'<div class="form-group"><label class="form-label">Importe reembolsado</label><input type="number" id="ref-amount" class="form-control" step="0.01" min="0.01" value="'+pteCredito.toFixed(2)+'" style="width:130px"></div>'
          +'<div class="form-group"><label class="form-label">Forma</label><select id="ref-method" class="form-control"><option value="">—</option><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option></select></div>'
          +'<div class="form-group" style="flex:1;min-width:140px"><label class="form-label">Nota</label><input type="text" id="ref-note" class="form-control" placeholder="(opcional)"></div>'
          +'<button class="btn btn-primary" onclick="registrarReembolso('+inv.id+')">Registrar reembolso recibido</button>'
          +'</div>'
        : '<p style="color:var(--muted);margin:0">'+(pteCredito<=0.0049?'Crédito reembolsado por completo.':'Este abono no admite más reembolsos.')+'</p>';
      document.getElementById('pagoBody').innerHTML =
        '<div class="alert alert-ok" style="margin-bottom:1rem">Abono a tu favor por devolución. <strong>No se paga: ya resta de lo que debes</strong>; si el proveedor te devuelve el dinero, regístralo como reembolso.</div>'
        +'<div style="margin-bottom:1rem">Crédito <strong>'+SYM+credito.toFixed(2)+'</strong> · Reembolsado <strong>'+SYM+reembolsado.toFixed(2)+'</strong> · Pendiente de reembolso <strong>'+SYM+pteCredito.toFixed(2)+'</strong></div>'
        +'<div class="table-wrap" style="margin-bottom:1rem"><table><thead><tr><th>Fecha</th><th style="text-align:right">Reembolsado</th><th>Forma</th><th>Nota</th><th></th></tr></thead><tbody>'+refRows+'</tbody></table></div>'
        +form;
      openModal('pagoModal');
    }
    window.registrarReembolso = async function(id){
      const amount = parseFloat(document.getElementById('ref-amount').value);
      if(!(amount>0)){ toast('Importe inválido','err'); return; }
      const paid_date = document.getElementById('ref-date').value || undefined;
      const payment_method = document.getElementById('ref-method').value || '';
      const note = document.getElementById('ref-note').value || '';
      try {
        await api('POST','/api/erp/supplier-invoices/'+id+'/refunds',{ amount, paid_date, payment_method, note });
        toast('Reembolso registrado');
        await openPagos(id);
        if (typeof window.pagoOnSaved === 'function') window.pagoOnSaved(id);
      } catch(e){ toast(e.message||'Error registrando el reembolso','err'); }
    };
  })();
  `;
}
