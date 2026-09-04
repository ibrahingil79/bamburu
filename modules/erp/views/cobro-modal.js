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
      <div class="modal-head"><h3 id="cobroTitle">Cobros</h3><button class="modal-close" data-act="cm-cerrar">✕</button></div>
      <div class="modal-body" id="cobroBody"></div>
    </div>
  </div>
  <div class="modal-overlay" id="gestionModal">
    <div class="modal" style="max-width:640px">
      <div class="modal-head"><h3 id="gestionTitle">Gestión de cobro</h3><button class="modal-close" data-act="cm-cerrar-gestion">✕</button></div>
      <div class="modal-body" id="gestionBody"></div>
    </div>
  </div>`;
}

// Etiquetas compartidas de etapa del pipeline (mismas en las 3 superficies).
export const STAGE_LABEL_JS = {
  por_vencer: 'Por vencer', r1: '1er recordatorio', r2: '2º recordatorio',
  firme: 'Aviso formal', en_riesgo: 'En riesgo', promesa: 'Promesa de pago',
  manual: 'Manual', sin_pasos: 'Gestionada',
};
export const STAGE_BADGE_JS = {
  por_vencer: 'b-gray', r1: 'b-yellow', r2: 'b-purple', firme: 'b-red',
  en_riesgo: 'b-red', promesa: 'b-blue', manual: 'b-gray', sin_pasos: 'b-green',
};

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
        return '<tr><td>'+p.paid_date+'</td><td style="text-align:right">'+dineroEs(p.amount, SYM)+'</td><td>'+escHtml(p.payment_method||'—')+'</td><td>'+escHtml(p.note||'')+'</td><td style="text-align:right;color:var(--muted)">'+dineroEs(saldo, SYM)+'</td>'
          +'<td style="text-align:right"><button class="btn btn-secondary btn-sm" title="Deshacer este cobro" data-act="cm-deshacer" data-inv="'+inv.id+'" data-cobro="'+p.id+'">Deshacer</button></td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:1rem">Sin cobros registrados</td></tr>';
      // El formulario solo si la factura admite cobro (flag del motor: inv.cobrable) y queda pendiente.
      const canRegister = inv.cobrable && co.pendiente > 0.0049;
      // U4: precarga de la "Forma" con la última usada / la registrada del cliente (editable). Espejo del modal de pago.
      const defMethod = inv.payment_method_default || '';
      const methodOpt = function(v,l){ return '<option value="'+v+'"'+(defMethod===v?' selected':'')+'>'+l+'</option>'; };
      const form = canRegister
        ? '<div class="form-row" style="align-items:end;gap:.5rem;flex-wrap:wrap">'
          +'<div class="form-group"><label class="form-label">Fecha</label><input type="date" id="pay-date" class="form-control" value="'+new Date().toISOString().slice(0,10)+'"></div>'
          +'<div class="form-group"><label class="form-label">Importe</label><input type="number" id="pay-amount" class="form-control" step="0.01" min="0.01" value="'+Number(co.pendiente||0).toFixed(2)+'" style="width:120px"></div>'
          +'<div class="form-group"><label class="form-label">Forma</label><select id="pay-method" class="form-control"><option value="">—</option>'+methodOpt('transferencia','Transferencia')+methodOpt('efectivo','Efectivo')+methodOpt('tarjeta','Tarjeta')+methodOpt('domiciliacion','Domiciliación')+'</select></div>'
          +'<div class="form-group" style="flex:1;min-width:140px"><label class="form-label">Nota</label><input type="text" id="pay-note" class="form-control" placeholder="(opcional)"></div>'
          +'<button class="btn btn-primary" data-act="cm-registrar" data-inv="'+inv.id+'">Registrar cobro</button>'
          +'</div>'
        : '<p style="color:var(--muted);margin:0">'+(co.estado==='cobrada'?'Factura cobrada por completo.':'Esta factura no admite registrar más cobros.')+'</p>';
      document.getElementById('cobroBody').innerHTML =
        '<div style="margin-bottom:1rem">Cobrado <strong>'+dineroEs(co.cobrado||0, SYM)+'</strong> · Pendiente <strong>'+dineroEs(co.pendiente||0, SYM)+'</strong> <span style="color:var(--muted)">(de '+dineroEs(inv.total||0, SYM)+')</span></div>'
        +'<div class="table-wrap" style="margin-bottom:1rem"><table><thead><tr><th>Fecha</th><th style="text-align:right">Importe</th><th>Forma</th><th>Nota</th><th style="text-align:right">Saldo</th><th></th></tr></thead><tbody>'+payRows+'</tbody></table></div>'
        +form;
      openModal('cobroModal');
    };
    // Deshacer un cobro concreto (corrige un apunte mal metido; NO anula la factura).
    window.deshacerCobro = async function(invoiceId, paymentId){
      if(!await window.confirmarEnPagina({titulo:'Deshacer el cobro',texto:'Se elimina solo este apunte de caja. La factura sigue igual, y volverá a contar como pendiente.',aceptar:'Sí, deshacerlo'})) return;
      try {
        await api('DELETE','/api/erp/invoices/'+invoiceId+'/payments/'+paymentId);
        toast('Cobro deshecho');
        await openCobros(invoiceId);
        if (typeof window.cobroOnSaved === 'function') window.cobroOnSaved(invoiceId);
      } catch(e){ toast(e.message||'Error deshaciendo el cobro','err'); }
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

    // ── Paso 2: GESTIÓN DE COBRO (próxima acción + acciones) — compartido por las 3 superficies ──
    const STAGE_LABEL = ${JSON.stringify(STAGE_LABEL_JS)};
    const STAGE_BADGE = ${JSON.stringify(STAGE_BADGE_JS)};
    window.STAGE_LABEL = STAGE_LABEL;
    window.proximaBadgeHtml = function(p){
      if(!p) return '';
      return '<span class="badge '+(STAGE_BADGE[p.etapa]||'')+'">'+(STAGE_LABEL[p.etapa]||p.etapa)+'</span>';
    };
    function accionLabel(p){
      if(!p) return 'Sin deuda viva';
      if(p.accion==='recordatorio_email') return 'Mandar '+(STAGE_LABEL[p.etapa]||p.etapa).toLowerCase();
      return STAGE_LABEL[p.etapa]||p.etapa;
    }
    // Abre el centro de gestión de UNA factura: próxima acción + las 4 acciones.
    window.openGestion = async function(id){
      let inv;
      try { inv = await api('GET','/api/erp/invoices/'+id); } catch(e){ toast(e.message||'Error','err'); return; }
      const co = inv.cobro||{}; const p = inv.proxima||null;
      document.getElementById('gestionTitle').textContent = 'Gestión de cobro · '+inv.invoice_number;
      const proxLine = p
        ? '<div class="alert '+(p.accion?'alert-warn':'alert-ok')+'" style="margin-bottom:1rem">'
            +'<strong>Próxima acción:</strong> '+window.proximaBadgeHtml(p)+' '+escHtml(accionLabel(p))
            +(p.fechaObjetivo?' <span style="color:var(--muted)">· '+escHtml(p.fechaObjetivo)+'</span>':'')
            +'<div style="color:var(--muted);font-size:.85rem;margin-top:.25rem">'+escHtml(p.motivo||'')+'</div></div>'
        : '<div class="alert alert-ok" style="margin-bottom:1rem">Sin deuda viva que gestionar.</div>';
      const hist = (inv.collectionActions&&inv.collectionActions.length)
        ? '<div style="margin-top:1rem"><div class="form-label">Historial de gestiones</div><ul style="margin:.25rem 0 0;padding-left:1.1rem;color:var(--muted);font-size:.85rem">'
          +inv.collectionActions.slice(0,6).map(function(a){
            const t={recordatorio_email:'Recordatorio email',contacto_manual:'Contacto',promesa_pago:'Promesa de pago'}[a.type]||a.type;
            return '<li>'+escHtml((a.created_at||'').slice(0,10))+' · '+escHtml(t)+(a.channel?' ('+escHtml(a.channel)+')':'')+(a.promised_date?' → '+escHtml(a.promised_date):'')+(a.note?' · '+escHtml(a.note):'')+'</li>';
          }).join('')+'</ul></div>'
        : '';
      const canCobro = inv.cobrable && co.pendiente>0.0049;
      const buttons = '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">'
        +(canCobro?'<button class="btn btn-secondary btn-sm" data-act="cm-abrir-cobros" data-id="'+id+'">Registrar cobro</button>':'')
        +(canCobro?'<button class="btn btn-primary btn-sm" data-act="cm-form-recordatorio" data-id="'+id+'">Mandar recordatorio</button>':'')
        +(canCobro?'<button class="btn btn-secondary btn-sm" data-act="cm-form-contacto" data-id="'+id+'">Registrar contacto</button>':'')
        +(canCobro?'<button class="btn btn-secondary btn-sm" data-act="cm-form-promesa" data-id="'+id+'">Registrar promesa de pago</button>':'')
        +'</div>';
      document.getElementById('gestionBody').innerHTML =
        '<div style="margin-bottom:.75rem">Pendiente <strong>'+dineroEs(co.pendiente||0, SYM)+'</strong> de '+dineroEs(inv.total||0, SYM)+'</div>'
        +proxLine+buttons+'<div id="gestionForm"></div>'+hist;
      openModal('gestionModal');
    };
    // Recordatorio por email: precarga la plantilla (editable) → confirmar → endpoint (envía).
    window.formRecordatorio = async function(id){
      let prev;
      try { prev = await api('GET','/api/erp/invoices/'+id+'/collection-email-preview'); } catch(e){ toast(e.message||'Error','err'); return; }
      if(!prev.has_email){ document.getElementById('gestionForm').innerHTML='<p style="color:var(--danger)">El cliente no tiene email. Usa "Registrar contacto".</p>'; return; }
      document.getElementById('gestionForm').innerHTML =
        '<div class="card" style="margin-top:.5rem"><div class="card-body">'
        +'<div class="form-group"><label class="form-label">Para</label><input class="form-control" value="'+escHtml(prev.to)+'" disabled></div>'
        +'<div class="form-group"><label class="form-label">Asunto</label><input class="form-control" id="em-subject" value="'+escHtml(prev.subject)+'"></div>'
        +'<div class="form-group"><label class="form-label">Mensaje (editable antes de enviar)</label><textarea class="form-control" id="em-text" rows="9">'+escHtml(prev.text)+'</textarea></div>'
        +'<div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-act="cm-limpiar-gestion">Cancelar</button><button class="btn btn-primary btn-sm" data-act="cm-enviar-recordatorio" data-id="'+id+'">Enviar email</button></div>'
        +'</div></div>';
    };
    window.enviarRecordatorio = async function(id){
      const email_subject=document.getElementById('em-subject').value;
      const email_text=document.getElementById('em-text').value;
      try {
        await api('POST','/api/erp/invoices/'+id+'/collection-actions',{ type:'recordatorio_email', email_subject, email_text });
        toast('Recordatorio enviado');
        await openGestion(id);
        if(typeof window.cobroOnSaved==='function') window.cobroOnSaved(id);
      } catch(e){ toast(e.message||'Error enviando','err'); }
    };
    window.formContacto = function(id){
      document.getElementById('gestionForm').innerHTML =
        '<div class="card" style="margin-top:.5rem"><div class="card-body"><div class="form-row" style="gap:.5rem">'
        +'<div class="form-group"><label class="form-label">Canal</label><select class="form-control" id="ct-channel"><option value="telefono">Teléfono</option><option value="whatsapp">WhatsApp</option><option value="otro">Otro</option></select></div>'
        +'<div class="form-group" style="flex:1"><label class="form-label">Nota</label><input class="form-control" id="ct-note" placeholder="Qué hablasteis (opcional)"></div>'
        +'</div><div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-act="cm-limpiar-gestion">Cancelar</button><button class="btn btn-primary btn-sm" data-act="cm-guardar-contacto" data-id="'+id+'">Registrar contacto</button></div></div></div>';
    };
    window.guardarContacto = async function(id){
      const channel=document.getElementById('ct-channel').value;
      const note=document.getElementById('ct-note').value;
      try {
        await api('POST','/api/erp/invoices/'+id+'/collection-actions',{ type:'contacto_manual', channel, note });
        toast('Contacto registrado');
        await openGestion(id);
        if(typeof window.cobroOnSaved==='function') window.cobroOnSaved(id);
      } catch(e){ toast(e.message||'Error','err'); }
    };
    window.formPromesa = function(id){
      const today=new Date().toISOString().slice(0,10);
      document.getElementById('gestionForm').innerHTML =
        '<div class="card" style="margin-top:.5rem"><div class="card-body"><div class="form-row" style="gap:.5rem">'
        +'<div class="form-group"><label class="form-label">Promete pagar el</label><input type="date" class="form-control" id="pr-date" value="'+today+'"></div>'
        +'<div class="form-group" style="flex:1"><label class="form-label">Nota</label><input class="form-control" id="pr-note" placeholder="(opcional)"></div>'
        +'</div><div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-act="cm-limpiar-gestion">Cancelar</button><button class="btn btn-primary btn-sm" data-act="cm-guardar-promesa" data-id="'+id+'">Registrar promesa</button></div></div></div>';
    };
    window.guardarPromesa = async function(id){
      const promised_date=document.getElementById('pr-date').value;
      const note=document.getElementById('pr-note').value;
      if(!promised_date){ toast('Indica una fecha','err'); return; }
      try {
        await api('POST','/api/erp/invoices/'+id+'/collection-actions',{ type:'promesa_pago', promised_date, note });
        toast('Promesa registrada');
        await openGestion(id);
        if(typeof window.cobroOnSaved==='function') window.cobroOnSaved(id);
      } catch(e){ toast(e.message||'Error','err'); }
    };

    // ── Paso 2.1: GESTIÓN A NIVEL DE CUENTA (toda la deuda viva del cliente) ──────
    let acct = null;   // resumen de cuenta abierto (facturasVivas, deudaTotal, etapaCuenta...)
    function repartoAutoJS(importe, vivas){
      let rest=Math.round(Number(importe)*100);
      const orden=vivas.slice().sort(function(a,b){return String(a.due_date||'').localeCompare(String(b.due_date||''))||(a.invoice_id-b.invoice_id);});
      const asg={}; for(var i=0;i<orden.length;i++){ var f=orden[i]; if(rest<=0)break; var d=Math.round(Number(f.pendiente)*100); var ap=Math.min(rest,d); if(ap>0){ asg[f.invoice_id]=ap/100; rest-=ap; } }
      return { asg:asg, sinAsignar:rest/100 };
    }
    // Abre el modal compartido en MODO CUENTA para un cliente.
    window.openGestionCuenta = async function(clientId){
      try { acct = await api('GET','/api/erp/clients/'+clientId+'/account-summary'); } catch(e){ toast(e.message||'Error','err'); return; }
      acct.client_id = clientId;
      const p = acct.proximaAccionCuenta||null;
      document.getElementById('gestionTitle').textContent = 'Gestionar cuenta · '+escHtml(acct.client_name||'');
      const vivas = acct.facturasVivas||[];
      if(!vivas.length){ document.getElementById('gestionBody').innerHTML='<div class="alert alert-ok">Este cliente no tiene deuda viva.</div>'; openModal('gestionModal'); return; }
      const proxLine = '<div class="alert alert-warn" style="margin-bottom:1rem"><strong>Cuenta:</strong> '
        +window.proximaBadgeHtml(p)+' '+escHtml(p&&p.accion==='recordatorio_email'?'Mandar recordatorio':(p?(STAGE_LABEL[p.etapa]||p.etapa):'Sin acción'))
        +'<div style="color:var(--muted);font-size:.85rem;margin-top:.25rem">Perfil '+escHtml(acct.perfilCuenta||'estandar')+(p&&p.motivo?(' · '+escHtml(p.motivo)):'')+'</div></div>';
      const listado = '<div class="table-wrap" style="margin-bottom:1rem"><table><thead><tr><th>Factura</th><th>Vence</th><th style="text-align:right">Pendiente</th></tr></thead><tbody>'
        +vivas.map(function(f){return '<tr><td>'+escHtml(f.invoice_number)+'</td><td style="color:var(--muted);font-size:.8rem">'+escHtml(f.due_date||'-')+'</td><td style="text-align:right">'+dineroEs(f.pendiente, SYM)+'</td></tr>';}).join('')
        +'<tr><td colspan="2" style="font-weight:700;border-top:1px solid var(--border)">Total adeudado</td><td style="text-align:right;font-weight:700;border-top:1px solid var(--border)">'+dineroEs(acct.deudaTotal, SYM)+'</td></tr></tbody></table></div>';
      const buttons = '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">'
        +'<button class="btn btn-primary btn-sm" data-act="cm-form-recordatorio-cuenta">Mandar recordatorio</button>'
        +'<button class="btn btn-secondary btn-sm" data-act="cm-form-promesa-cuenta">Registrar promesa</button>'
        +'<button class="btn btn-secondary btn-sm" data-act="cm-form-cobro-cuenta">Registrar cobro a cuenta</button>'
        +'</div>';
      document.getElementById('gestionBody').innerHTML =
        '<div style="margin-bottom:.75rem">Te debe <strong>'+dineroEs(acct.deudaTotal, SYM)+'</strong> en '+vivas.length+' factura'+(vivas.length===1?'':'s')+'</div>'
        +proxLine+listado+buttons+'<div id="acctForm"></div>';
      openModal('gestionModal');
    };
    window.formRecordatorioCuenta = async function(){
      let prev; try { prev = await api('GET','/api/erp/clients/'+acct.client_id+'/account-email-preview'); } catch(e){ toast(e.message||'Error','err'); return; }
      if(!prev.has_email){ document.getElementById('acctForm').innerHTML='<p style="color:var(--danger)">El cliente no tiene email. Usa cobro o promesa.</p>'; return; }
      document.getElementById('acctForm').innerHTML =
        '<div class="card" style="margin-top:.5rem"><div class="card-body">'
        +'<div class="form-group"><label class="form-label">Para</label><input class="form-control" value="'+escHtml(prev.to)+'" disabled></div>'
        +'<div class="form-group"><label class="form-label">Asunto</label><input class="form-control" id="acct-subject" value="'+escHtml(prev.subject)+'"></div>'
        +'<div class="form-group"><label class="form-label">Mensaje (un solo email de toda la cuenta, editable)</label><textarea class="form-control" id="acct-text" rows="10">'+escHtml(prev.text)+'</textarea></div>'
        +'<div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-act="cm-limpiar-cuenta">Cancelar</button><button class="btn btn-primary btn-sm" data-act="cm-enviar-recordatorio-cuenta">Enviar email</button></div>'
        +'</div></div>';
    };
    window.enviarRecordatorioCuenta = async function(){
      const email_subject=document.getElementById('acct-subject').value;
      const email_text=document.getElementById('acct-text').value;
      try {
        const r=await api('POST','/api/erp/clients/'+acct.client_id+'/account-actions',{ type:'recordatorio_cuenta', email_subject, email_text });
        toast('Recordatorio de cuenta enviado ('+r.facturas+' factura'+(r.facturas===1?'':'s')+')');
        if(typeof window.cobroOnSaved==='function') window.cobroOnSaved(acct.client_id);
        await openGestionCuenta(acct.client_id);
      } catch(e){ toast(e.message||'Error enviando','err'); }
    };
    window.formPromesaCuenta = function(){
      const today=new Date().toISOString().slice(0,10);
      document.getElementById('acctForm').innerHTML =
        '<div class="card" style="margin-top:.5rem"><div class="card-body"><div class="form-row" style="gap:.5rem">'
        +'<div class="form-group"><label class="form-label">Promete pagar el</label><input type="date" class="form-control" id="acct-pr-date" value="'+today+'"></div>'
        +'<div class="form-group" style="flex:1"><label class="form-label">Nota</label><input class="form-control" id="acct-pr-note" placeholder="(opcional)"></div>'
        +'</div><p style="color:var(--muted);font-size:.8rem;margin:.25rem 0">Pospone la próxima acción de TODAS las facturas vivas.</p>'
        +'<div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-act="cm-limpiar-cuenta">Cancelar</button><button class="btn btn-primary btn-sm" data-act="cm-guardar-promesa-cuenta">Registrar promesa</button></div></div></div>';
    };
    window.guardarPromesaCuenta = async function(){
      const promised_date=document.getElementById('acct-pr-date').value;
      const note=document.getElementById('acct-pr-note').value;
      if(!promised_date){ toast('Indica una fecha','err'); return; }
      try {
        const r=await api('POST','/api/erp/clients/'+acct.client_id+'/account-actions',{ type:'promesa_cuenta', promised_date, note });
        toast('Promesa de cuenta registrada ('+r.facturas+')');
        if(typeof window.cobroOnSaved==='function') window.cobroOnSaved(acct.client_id);
        await openGestionCuenta(acct.client_id);
      } catch(e){ toast(e.message||'Error','err'); }
    };
    window.formCobroCuenta = function(){
      document.getElementById('acctForm').innerHTML =
        '<div class="card" style="margin-top:.5rem"><div class="card-body">'
        +'<div class="form-row" style="gap:.5rem;align-items:end">'
        +'<div class="form-group"><label class="form-label">Importe a cuenta</label><input type="number" step="0.01" min="0.01" class="form-control" id="acct-importe" value="'+Number(acct.deudaTotal).toFixed(2)+'" style="width:140px" data-act="cm-reparto"></div>'
        +'<div class="form-group"><label class="form-label">Reparto</label><select class="form-control" id="acct-modo" data-act="cm-modo"><option value="auto">Automático (más antigua primero)</option><option value="manual">Repartir a mano</option></select></div>'
        +'</div><div id="acct-reparto"></div>'
        +'<div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.5rem"><button class="btn btn-secondary btn-sm" data-act="cm-limpiar-cuenta">Cancelar</button><button class="btn btn-primary btn-sm" id="acct-cobro-btn" data-act="cm-guardar-cobro-cuenta">Registrar cobro</button></div>'
        +'</div></div>';
      renderReparto();
    };
    window.renderReparto = function(){
      const importe=parseFloat(document.getElementById('acct-importe').value)||0;
      const modo=document.getElementById('acct-modo').value;
      const vivas=acct.facturasVivas||[];
      const cont=document.getElementById('acct-reparto');
      const btn=document.getElementById('acct-cobro-btn');
      if(modo==='auto'){
        const r=repartoAutoJS(importe, vivas);
        cont.innerHTML='<table style="width:100%;font-size:.85rem;margin-top:.5rem"><thead><tr><th style="text-align:left">Factura</th><th style="text-align:right">Se aplica</th></tr></thead><tbody>'
          +vivas.map(function(f){return '<tr><td>'+escHtml(f.invoice_number)+' <span style="color:var(--muted)">('+dineroEs(f.pendiente, SYM)+')</span></td><td style="text-align:right">'+dineroEs(r.asg[f.invoice_id]||0, SYM)+'</td></tr>';}).join('')+'</tbody></table>'
          +(r.sinAsignar>0.0049?'<p style="color:var(--warn);font-size:.8rem;margin:.4rem 0">Sobran '+dineroEs(r.sinAsignar, SYM)+' tras saldar toda la deuda (no se aplican).</p>':'');
        if(btn) btn.disabled=!(importe>0);
      } else {
        cont.innerHTML='<table style="width:100%;font-size:.85rem;margin-top:.5rem"><thead><tr><th style="text-align:left">Factura</th><th style="text-align:right">Pendiente</th><th style="text-align:right">Importe</th></tr></thead><tbody>'
          +vivas.map(function(f){return '<tr><td>'+escHtml(f.invoice_number)+'</td><td style="text-align:right;color:var(--muted)">'+dineroEs(f.pendiente, SYM)+'</td><td style="text-align:right"><input type="number" step="0.01" min="0" max="'+Number(f.pendiente).toFixed(2)+'" class="form-control acct-mf" data-id="'+f.invoice_id+'" data-pend="'+Number(f.pendiente).toFixed(2)+'" value="0" style="width:110px;text-align:right;display:inline-block" data-act="cm-suma"></td></tr>';}).join('')+'</tbody></table>'
          +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:.4rem"><button class="btn btn-secondary btn-sm" type="button" data-act="cm-auto">Auto por antigüedad</button><span id="acct-counter" style="font-size:.85rem"></span></div>';
        sumManual();
      }
    };
    window.autoFillManual = function(){
      const importe=parseFloat(document.getElementById('acct-importe').value)||0;
      const r=repartoAutoJS(importe, acct.facturasVivas||[]);
      document.querySelectorAll('.acct-mf').forEach(function(inp){ inp.value=Number(r.asg[inp.getAttribute('data-id')]||0).toFixed(2); });
      sumManual();
    };
    window.sumManual = function(){
      const importe=parseFloat(document.getElementById('acct-importe').value)||0;
      let suma=0, over=false;
      document.querySelectorAll('.acct-mf').forEach(function(inp){ const v=parseFloat(inp.value)||0; suma+=Math.round(v*100); if(Math.round(v*100)>Math.round(parseFloat(inp.getAttribute('data-pend'))*100)) over=true; });
      const totalC=Math.round(importe*100);
      const cuadra=(suma===totalC)&&!over&&importe>0;
      const cnt=document.getElementById('acct-counter');
      if(cnt) cnt.innerHTML='Asignado <strong>'+SYM+(suma/100).toFixed(2)+'</strong> / '+dineroEs(importe, SYM)+(over?' <span style="color:var(--danger)">· alguna se pasa</span>':(cuadra?' <span style="color:var(--ok)">· cuadra ✓</span>':' <span style="color:var(--muted)">· falta cuadrar</span>'));
      const btn=document.getElementById('acct-cobro-btn'); if(btn) btn.disabled=!cuadra;
    };
    window.guardarCobroCuenta = async function(){
      const importe=parseFloat(document.getElementById('acct-importe').value)||0;
      const modo=document.getElementById('acct-modo').value;
      if(!(importe>0)){ toast('Importe inválido','err'); return; }
      const body={ type:'cobro_cuenta', importe:importe, modo:modo };
      if(modo==='manual'){
        body.asignacion=Array.prototype.map.call(document.querySelectorAll('.acct-mf'), function(inp){ return { invoice_id:parseInt(inp.getAttribute('data-id')), importe:parseFloat(inp.value)||0 }; });
      }
      try {
        const r=await api('POST','/api/erp/clients/'+acct.client_id+'/account-actions',body);
        toast('Cobro a cuenta registrado en '+(r.pagos?r.pagos.length:0)+' factura(s)'+(r.sinAsignar>0.0049?' (sobran '+dineroEs(r.sinAsignar, SYM)+')':''));
        if(typeof window.cobroOnSaved==='function') window.cobroOnSaved(acct.client_id);
        await openGestionCuenta(acct.client_id);
      } catch(e){ toast(e.message||'Error registrando el cobro','err'); }
    };
  })();
  
      // ── 4 SEP 2026 (csp-erp-migrar-handlers) — ENGANCHE DE LAS VENTANAS DE COBRO Y GESTION ────
      // Aqui dentro NADA esta en el HTML de salida: la lista de cobros, los formularios de gestion
      // y el reparto a cuenta se pintan al abrir. Todo por delegacion, y los ids a numero.
      if (!window.__cobroModalDeleg) {
        window.__cobroModalDeleg = true;
        var _num = function(t, k){ return Number(t.getAttribute(k)); };
        document.addEventListener('click', function(e){
          var t = e.target.closest('[data-act^="cm-"]'); if (!t) return;
          var a = t.getAttribute('data-act'), id = _num(t, 'data-id');
          if (a === 'cm-cerrar') closeModal('cobroModal');
          else if (a === 'cm-cerrar-gestion') closeModal('gestionModal');
          else if (a === 'cm-deshacer') deshacerCobro(_num(t, 'data-inv'), _num(t, 'data-cobro'));
          else if (a === 'cm-registrar') registrarCobro(_num(t, 'data-inv'));
          else if (a === 'cm-abrir-cobros') openCobros(id);
          else if (a === 'cm-form-recordatorio') formRecordatorio(id);
          else if (a === 'cm-form-contacto') formContacto(id);
          else if (a === 'cm-form-promesa') formPromesa(id);
          else if (a === 'cm-enviar-recordatorio') enviarRecordatorio(id);
          else if (a === 'cm-guardar-contacto') guardarContacto(id);
          else if (a === 'cm-guardar-promesa') guardarPromesa(id);
          else if (a === 'cm-form-recordatorio-cuenta') formRecordatorioCuenta();
          else if (a === 'cm-form-promesa-cuenta') formPromesaCuenta();
          else if (a === 'cm-form-cobro-cuenta') formCobroCuenta();
          else if (a === 'cm-enviar-recordatorio-cuenta') enviarRecordatorioCuenta();
          else if (a === 'cm-guardar-promesa-cuenta') guardarPromesaCuenta();
          else if (a === 'cm-guardar-cobro-cuenta') guardarCobroCuenta();
          else if (a === 'cm-auto') autoFillManual();
          else if (a === 'cm-limpiar-gestion') document.getElementById('gestionForm').innerHTML = '';
          else if (a === 'cm-limpiar-cuenta') document.getElementById('acctForm').innerHTML = '';
        });
        document.addEventListener('input', function(e){
          var t = e.target.closest('[data-act="cm-reparto"], [data-act="cm-suma"]'); if (!t) return;
          if (t.getAttribute('data-act') === 'cm-reparto') renderReparto(); else sumManual();
        });
        document.addEventListener('change', function(e){
          if (e.target.closest('[data-act="cm-modo"]')) renderReparto();
        });
      }
`;
}
