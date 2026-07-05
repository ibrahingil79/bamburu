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

// Paso (e) — modal de PAGO A CUENTA (saldar varias facturas del proveedor a la vez). Overlay
// propio; las funciones viven en pagoModalScript (mismas dependencias). Espejo del "cobro a
// cuenta" de clientes, payment-only.
export function pagoCuentaModalHtml() {
  return `<div class="modal-overlay" id="pagoCuentaModal">
    <div class="modal" style="max-width:640px">
      <div class="modal-head"><h3 id="pagoCuentaTitle">Pagar a cuenta</h3><button class="modal-close" onclick="closeModal('pagoCuentaModal')">✕</button></div>
      <div class="modal-body" id="pagoCuentaBody"></div>
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

    // ── Paso (e): PAGO A CUENTA del proveedor (saldar varias facturas a la vez) ──────────
    // Clon del cobro a cuenta de clientes, payment-only. El reparto (auto/manual) lo CALCULA y
    // lo VALIDA el servidor (registerSupplierAccountPayment); aquí solo se previsualiza y se
    // pega al endpoint POST /api/erp/suppliers/:id/account-payments. Abonos ya vienen excluidos.
    let pcAcct = null;
    window.pcClose = function(){ closeModal('pagoCuentaModal'); };
    function pcLabel(f){ return escHtml(f.internal_code||('#'+f.supplier_invoice_id)); }
    function pcRepartoAuto(importe, vivas){
      let rest=Math.round(Number(importe)*100);
      const orden=vivas.slice().sort(function(a,b){return String(a.due_date||'').localeCompare(String(b.due_date||''))||(a.supplier_invoice_id-b.supplier_invoice_id);});
      const asg={}; for(var i=0;i<orden.length;i++){ var f=orden[i]; if(rest<=0)break; var d=Math.round(Number(f.pendiente)*100); var ap=Math.min(rest,d); if(ap>0){ asg[f.supplier_invoice_id]=ap/100; rest-=ap; } }
      return { asg:asg, sinAsignar:rest/100 };
    }
    // Abre el modal para un proveedor: carga su deuda viva y pinta el reparto.
    window.openPagoCuenta = async function(supplierId){
      try { pcAcct = await api('GET','/api/erp/suppliers/'+supplierId+'/account-summary'); } catch(e){ toast(e.message||'Error','err'); return; }
      pcAcct.supplier_id = supplierId;
      document.getElementById('pagoCuentaTitle').textContent = 'Pagar a cuenta · '+escHtml(pcAcct.supplier_name||'');
      const vivas = pcAcct.facturasVivas||[];
      if(!vivas.length){ document.getElementById('pagoCuentaBody').innerHTML='<div class="alert alert-ok">Este proveedor no tiene deuda viva que pagar.</div>'; openModal('pagoCuentaModal'); return; }
      const listado = '<div class="table-wrap" style="margin-bottom:1rem"><table><thead><tr><th>Factura</th><th>Vence</th><th style="text-align:right">Pendiente</th></tr></thead><tbody>'
        +vivas.map(function(f){return '<tr><td>'+pcLabel(f)+(f.supplier_invoice_number?' <span style="color:var(--muted);font-size:.8rem">'+escHtml(f.supplier_invoice_number)+'</span>':'')+'</td><td style="color:var(--muted);font-size:.8rem">'+escHtml(f.due_date||'-')+(f.dias_vencida>0?' · vencida '+f.dias_vencida+'d':'')+'</td><td style="text-align:right">'+SYM+Number(f.pendiente).toFixed(2)+'</td></tr>';}).join('')
        +'<tr><td colspan="2" style="font-weight:700;border-top:1px solid var(--border)">Le debes</td><td style="text-align:right;font-weight:700;border-top:1px solid var(--border)">'+SYM+Number(pcAcct.deudaTotal).toFixed(2)+'</td></tr></tbody></table></div>';
      document.getElementById('pagoCuentaBody').innerHTML =
        '<div style="margin-bottom:.75rem">Le debes <strong>'+SYM+Number(pcAcct.deudaTotal).toFixed(2)+'</strong> en '+vivas.length+' factura'+(vivas.length===1?'':'s')+'</div>'
        +listado
        +'<div class="form-row" style="gap:.5rem;align-items:end">'
        +'<div class="form-group"><label class="form-label">Importe a pagar</label><input type="number" step="0.01" min="0.01" class="form-control" id="pc-importe" value="'+Number(pcAcct.deudaTotal).toFixed(2)+'" style="width:140px" oninput="pcRender()"></div>'
        +'<div class="form-group"><label class="form-label">Reparto</label><select class="form-control" id="pc-modo" onchange="pcRender()"><option value="auto">Automático (más antigua primero)</option><option value="manual">Repartir a mano</option></select></div>'
        +'<div class="form-group"><label class="form-label">Forma</label><select class="form-control" id="pc-method"><option value="">—</option><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="domiciliacion">Domiciliación</option></select></div>'
        +'</div><div id="pc-reparto"></div>'
        +'<div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.75rem"><button class="btn btn-secondary btn-sm" onclick="pcClose()">Cancelar</button><button class="btn btn-primary btn-sm" id="pc-btn" onclick="guardarPagoCuenta()">Registrar pago</button></div>';
      pcRender();
      openModal('pagoCuentaModal');
    };
    window.pcRender = function(){
      const importe=parseFloat(document.getElementById('pc-importe').value)||0;
      const modo=document.getElementById('pc-modo').value;
      const vivas=pcAcct.facturasVivas||[];
      const cont=document.getElementById('pc-reparto');
      const btn=document.getElementById('pc-btn');
      if(modo==='auto'){
        const r=pcRepartoAuto(importe, vivas);
        cont.innerHTML='<table style="width:100%;font-size:.85rem;margin-top:.5rem"><thead><tr><th style="text-align:left">Factura</th><th style="text-align:right">Se aplica</th></tr></thead><tbody>'
          +vivas.map(function(f){return '<tr><td>'+pcLabel(f)+' <span style="color:var(--muted)">('+SYM+Number(f.pendiente).toFixed(2)+')</span></td><td style="text-align:right">'+SYM+Number(r.asg[f.supplier_invoice_id]||0).toFixed(2)+'</td></tr>';}).join('')+'</tbody></table>'
          +(r.sinAsignar>0.0049?'<p style="color:var(--warn);font-size:.8rem;margin:.4rem 0">Sobran '+SYM+r.sinAsignar.toFixed(2)+' tras saldar toda la deuda (no se aplican).</p>':'');
        if(btn) btn.disabled=!(importe>0);
      } else {
        cont.innerHTML='<table style="width:100%;font-size:.85rem;margin-top:.5rem"><thead><tr><th style="text-align:left">Factura</th><th style="text-align:right">Pendiente</th><th style="text-align:right">Importe</th></tr></thead><tbody>'
          +vivas.map(function(f){return '<tr><td>'+pcLabel(f)+'</td><td style="text-align:right;color:var(--muted)">'+SYM+Number(f.pendiente).toFixed(2)+'</td><td style="text-align:right"><input type="number" step="0.01" min="0" max="'+Number(f.pendiente).toFixed(2)+'" class="form-control pc-mf" data-id="'+f.supplier_invoice_id+'" data-pend="'+Number(f.pendiente).toFixed(2)+'" value="0" style="width:110px;text-align:right;display:inline-block" oninput="pcSum()"></td></tr>';}).join('')+'</tbody></table>'
          +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:.4rem"><button class="btn btn-secondary btn-sm" type="button" onclick="pcAutoFill()">Auto por antigüedad</button><span id="pc-counter" style="font-size:.85rem"></span></div>';
        pcSum();
      }
    };
    window.pcAutoFill = function(){
      const importe=parseFloat(document.getElementById('pc-importe').value)||0;
      const r=pcRepartoAuto(importe, pcAcct.facturasVivas||[]);
      document.querySelectorAll('.pc-mf').forEach(function(inp){ inp.value=Number(r.asg[inp.getAttribute('data-id')]||0).toFixed(2); });
      pcSum();
    };
    window.pcSum = function(){
      const importe=parseFloat(document.getElementById('pc-importe').value)||0;
      let suma=0, over=false;
      document.querySelectorAll('.pc-mf').forEach(function(inp){ const v=parseFloat(inp.value)||0; suma+=Math.round(v*100); if(Math.round(v*100)>Math.round(parseFloat(inp.getAttribute('data-pend'))*100)) over=true; });
      const cuadra=(suma===Math.round(importe*100))&&!over&&importe>0;
      const cnt=document.getElementById('pc-counter');
      if(cnt) cnt.innerHTML='Asignado <strong>'+SYM+(suma/100).toFixed(2)+'</strong> / '+SYM+importe.toFixed(2)+(over?' <span style="color:var(--danger)">· alguna se pasa</span>':(cuadra?' <span style="color:var(--ok)">· cuadra ✓</span>':' <span style="color:var(--muted)">· falta cuadrar</span>'));
      const btn=document.getElementById('pc-btn'); if(btn) btn.disabled=!cuadra;
    };
    window.guardarPagoCuenta = async function(){
      const importe=parseFloat(document.getElementById('pc-importe').value)||0;
      const modo=document.getElementById('pc-modo').value;
      if(!(importe>0)){ toast('Importe inválido','err'); return; }
      const body={ amount:importe, modo:modo, payment_method:document.getElementById('pc-method').value||'' };
      if(modo==='manual'){
        body.asignacion=Array.prototype.map.call(document.querySelectorAll('.pc-mf'), function(inp){ return { supplier_invoice_id:parseInt(inp.getAttribute('data-id')), importe:parseFloat(inp.value)||0 }; });
      }
      try {
        const r=await api('POST','/api/erp/suppliers/'+pcAcct.supplier_id+'/account-payments',body);
        toast('Pagados '+SYM+Number(r.repartido).toFixed(2)+' en '+r.pagos.length+' factura'+(r.pagos.length===1?'':'s')+(r.sinAsignar>0.0049?' (sobran '+SYM+Number(r.sinAsignar).toFixed(2)+')':''));
        closeModal('pagoCuentaModal');
        if(typeof window.pagoOnSaved==='function') window.pagoOnSaved(pcAcct.supplier_id);
      } catch(e){ toast(e.message||'Error registrando el pago','err'); }
    };
  })();
  `;
}
