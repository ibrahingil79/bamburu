import { Hono } from 'hono';
import { adminLayout, can, printableShell, errorShell, ERR } from '../layout.js';
import { validate } from '../../../core/validate.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { checkPermission } from '../../../core/permission-check.js';   // permiso programático sales.emit_over_stock (espejo de la factura)
import { mostradorSaleSchema } from '../schemas.js';
import { emitTicketSvc, buildTicketPaper, ticketStockExcess, excessLineText } from './invoices.js';
import { renderPdfFromHtml } from '../../../core/pdf.js';
import { activeWarehouses } from './warehouses.js';
import { ENTITY } from '../../../core/activity-entities.js';

// ════════════════════════════════════════════════════════════════════════════
// PILAR 4 · MOSTRADOR (PIEZA A) — pantalla del mostrador NUEVO, separada del POS viejo.
// La venta emite una FACTURA SIMPLIFICADA (ticket, Verifactu F2) de forma instantánea al
// cobrar, por el motor de facturas existente (emitTicketSvc): serie propia 'S', huella
// encadenada + QR, IVA por banda (línea libre 21%), SIN cliente, SIN IRPF. Cobro al momento
// por el motor de cobros (queda cobrada). Stock por el libro. El POS viejo (/admin/orders/pos)
// sigue vivo solo por URL; su retirada es la PIEZA C. DISA no escribe tickets en esta pieza.
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function createMostradorRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API: emitir el ticket (factura simplificada) y cobrar al momento ──
  api.post('/sale', requirePerm('invoices.create'), validate(mostradorSaleSchema), c => {
    try {
      const d = c.get('validated');
      // Sobreventa de FÍSICOS — espejo del mecanismo de la factura (sales.emit_over_stock), pero con el
      // disponible POR ALMACÉN que el TPV ya usa (stock − reservado en ese almacén). NO se bloquea, pero
      // NUNCA en silencio: sin confirm_excess → 400; con el flag pero sin permiso (owner/admin por el
      // bypass de requirePerm; otros con sales.emit_over_stock) → 403. El rechazo va ANTES de emitTicketSvc,
      // así que una sobreventa rechazada NO emite F2 ni mueve stock (atomicidad intacta). Servicios,
      // digitales y líneas libres no se chequean.
      const excess = ticketStockExcess(db, d.lines, d.warehouse_id);
      if (excess.length) {
        const detalle = excess.map(excessLineText).join('; ');
        if (!d.confirm_excess)
          return c.json({ error: 'Hay líneas que superan el stock disponible — ' + detalle + '. Para vender el exceso confírmalo explícitamente (confirm_excess).', excess }, 400);
        if (!(c.get('isAdmin') || checkPermission(db, c.get('session'), 'sales', 'emit_over_stock')))
          return c.json({ error: 'No tienes permiso para vender por encima del stock. Solo el dueño o un administrador pueden hacerlo; baja la cantidad a lo disponible.' }, 403);
      }
      const r = emitTicketSvc(db, { lines: d.lines, warehouse_id: d.warehouse_id, payment_method: d.payment_method });
      logActivity(db, c.get('session'), 'Emitió ticket de mostrador', ENTITY.INVOICE, r.id, r.invoice_number + ' · ' + r.payment_method + (excess.length ? ' (exceso de stock confirmado)' : ''));
      return c.json({ ...r, message: 'Ticket ' + r.invoice_number + ' emitido y cobrado' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // ── VISTA: pantalla de mostrador ──
  views.get('/', requirePerm('invoices.create'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const csrfToken = c.get('session')?.csrfToken || '';
    const warehouses = activeWarehouses(db);
    const defWh = (warehouses.find(w => w.is_default) || warehouses[0] || {}).id || '';
    const lastWh = db.prepare('SELECT last_warehouse_id FROM admin_users WHERE id=?').get(c.get('session')?.userId)?.last_warehouse_id;
    const selWh = (lastWh && warehouses.some(w => w.id === lastWh)) ? lastWh : defWh;
    const whSelector = warehouses.length > 1
      ? `<select class="form-control" id="mWarehouse" style="width:auto;min-width:170px" onchange="onWhChange()">${warehouses.map(w => `<option value="${w.id}"${w.id === selWh ? ' selected' : ''}>${esc(w.name)}${w.is_default ? ' (principal)' : ''}</option>`).join('')}</select>`
      : `<input type="hidden" id="mWarehouse" value="${selWh}">`;

    const content = `
      <div class="ph">
        <h2>Mostrador</h2>
        <div style="display:flex;align-items:center;gap:.5rem">
          ${warehouses.length > 1 ? '<label style="color:var(--muted);font-size:.85rem">Almacén</label>' : ''}${whSelector}
        </div>
      </div>
      <div class="grid g2" style="align-items:start">
        <div class="card"><div class="card-body">
          <input class="search" id="prodSearch" placeholder="Buscar producto..." oninput="renderGrid()" style="width:100%;margin-bottom:1rem">
          <div id="prodGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.6rem;max-height:60vh;overflow:auto">${Array.from({ length: 10 }, () => '<div class="skel skel-block"></div>').join('')}</div>
          <div style="margin-top:1rem"><button class="btn btn-secondary btn-sm" onclick="addFreeLine()">+ Línea libre (concepto + importe, IVA 21%)</button></div>
        </div></div>
        <div class="card"><div class="card-body">
          <h3 style="font-size:.95rem;margin:0 0 .75rem">Ticket</h3>
          <div id="cart" style="min-height:60px"></div>
          <div id="stockWarn" style="display:none;margin:.75rem 0;padding:.6rem .8rem;border-radius:8px;background:var(--danger-s);color:var(--danger);font-size:.82rem;border:1px solid var(--danger-s)"></div>
          <div id="limitWarn" style="display:none;margin:.75rem 0;padding:.6rem .8rem;border-radius:8px;background:var(--warn-s);color:var(--warn);font-size:.82rem;border:1px solid var(--warn-s)"></div>
          <table style="width:100%;margin-top:.75rem;font-size:.9rem"><tfoot id="totals"></tfoot></table>
          <button class="btn btn-primary" id="btn-cobrar" style="width:100%;margin-top:1rem" onclick="openCobro()" disabled>Cobrar</button>
        </div></div>
      </div>

      <div class="modal-overlay" id="cobroModal">
        <div class="modal" style="max-width:420px">
          <div class="modal-head"><h3>Cobrar <span id="cobroTotal"></span></h3><button class="modal-close" onclick="closeModal('cobroModal')">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Método de pago</label>
              <div style="display:flex;gap:.5rem">
                <button class="btn btn-secondary" id="pm-efectivo" style="flex:1" onclick="setMethod('efectivo')">Efectivo</button>
                <button class="btn btn-secondary" id="pm-tarjeta" style="flex:1" onclick="setMethod('tarjeta')">Tarjeta</button>
              </div>
            </div>
            <div class="form-group" id="efectivoWrap" style="display:none">
              <label class="form-label">Entregado</label>
              <input type="number" class="form-control" id="entregado" step="0.01" min="0" oninput="calcCambio()" placeholder="0.00">
              <div id="cambio" style="margin-top:.5rem;font-weight:600"></div>
            </div>
            <div id="stockWarn2" style="display:none;margin-top:.5rem;padding:.6rem .8rem;border-radius:8px;background:var(--danger-s);color:var(--danger);font-size:.82rem;border:1px solid var(--danger-s)"></div>
            <div id="limitWarn2" style="display:none;margin-top:.5rem;padding:.6rem .8rem;border-radius:8px;background:var(--warn-s);color:var(--warn);font-size:.82rem;border:1px solid var(--warn-s)"></div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" onclick="closeModal('cobroModal')">Cancelar</button>
            <button class="btn btn-primary" id="btn-confirmar" onclick="confirmarVenta()" disabled>Emitir ticket y cobrar</button>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="ticketModal">
        <div class="modal" style="max-width:420px">
          <div class="modal-head"><h3>Ticket emitido</h3><button class="modal-close" onclick="closeTicket()">✕</button></div>
          <div class="modal-body" id="ticketBody"></div>
          <div class="modal-foot"><button class="btn btn-primary" onclick="closeTicket()">Nueva venta</button></div>
        </div>
      </div>

      <script>
      const SYM=${JSON.stringify(sym)}, CSRF=${JSON.stringify(csrfToken)};
      const LIMIT=400;
      let catalog=[], whStock={}, cart=[], method=null;
      function WH(){ const e=document.getElementById('mWarehouse'); return e?e.value:''; }
      async function loadCatalog(){
        try { const prods=await api('GET','/api/erp/products'); catalog=(prods||[]).filter(p=>p.status==='active' && (!p.variants || !p.variants.length)); }
        catch(e){ toast(e.message||'Error cargando productos','err'); }
        await loadStock(); renderGrid();
      }
      async function loadStock(){
        whStock={}; const w=WH(); if(!w) return;
        try { const rows=await api('GET','/api/erp/warehouses/'+w+'/stock'); (rows||[]).forEach(function(r){ whStock[r.product_id]=(r.available!=null?r.available:r.qty); }); } catch(e){}
      }
      async function onWhChange(){ await loadStock(); renderGrid(); }
      function stockOf(p){ return (p.type||'physical')!=='physical' ? null : (whStock[p.id]!=null?whStock[p.id]:0); }
      // Disponible POR ALMACÉN de una línea física del carrito (el MISMO que muestra la rejilla). null = no se chequea.
      function lineAvail(l){ return (l.physical && l.product_id!=null) ? (whStock[l.product_id]!=null?whStock[l.product_id]:0) : null; }
      // Líneas de físico que superan su disponible (espejo del aviso de la factura, por almacén).
      function stockExcess(){ return cart.filter(function(l){ const a=lineAvail(l); return a!=null && l.qty>a; })
        .map(function(l){ const a=lineAvail(l); return { name:l.description, available:a, requested:l.qty, excess:l.qty-a }; }); }
      function renderGrid(){
        const q=(document.getElementById('prodSearch').value||'').toLowerCase();
        const list=catalog.filter(p=>!q || p.name.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q));
        document.getElementById('prodGrid').innerHTML = list.length ? list.map(function(p){
          const s=stockOf(p);
          const stxt = s===null ? '' : '<div style="font-size:.7rem;color:'+(s<=0?'var(--danger)':'var(--muted)')+'">disp. '+s+'</div>';
          return '<div onclick="addProduct('+p.id+')" style="border:1px solid var(--border2);border-radius:8px;padding:.55rem;cursor:pointer;background:var(--bg2)">'
            +'<div style="font-size:.8rem;font-weight:500;line-height:1.2">'+escHtml(p.name)+'</div>'
            +'<div style="font-size:.82rem;color:var(--accent);font-weight:600;margin-top:.2rem">'+SYM+Number(p.price||0).toFixed(2)+'</div>'+stxt+'</div>';
        }).join('') : (q?'<div style="grid-column:1/-1">'+window.emptyState('No hay productos que coincidan con la búsqueda.',{icon:'ti-search'})+'</div>':'<div style="grid-column:1/-1">'+window.emptyState('No hay productos con stock en este almacén. Repón stock o añade productos al catálogo para vender aquí.',{cta:'Ir al catálogo',href:'/admin/products',soft:true})+'</div>');
      }
      function addProduct(id){
        const p=catalog.find(x=>x.id===id); if(!p) return;
        const ex=cart.find(x=>x.product_id===id);
        if(ex){ ex.qty++; } else { cart.push({ product_id:id, description:p.name, qty:1, unit_price:Number(p.price)||0, tax_rate:Number(p.tax_rate)||0, free:false, physical:(p.type||'physical')==='physical' }); }
        renderCart();
      }
      function addFreeLine(){
        const desc=prompt('Concepto de la línea libre:'); if(desc===null) return;
        if(!desc.trim()){ toast('Indica un concepto','err'); return; }
        const imp=prompt('Importe (sin IVA) por unidad:'); if(imp===null) return;
        const price=parseFloat(imp); if(!(price>=0)){ toast('Importe no válido','err'); return; }
        cart.push({ product_id:null, description:desc.trim(), qty:1, unit_price:price, tax_rate:21, free:true });
        renderCart();
      }
      function setQty(i,v){ cart[i].qty=Math.max(1,parseInt(v)||1); renderCart(); }
      function removeLine(i){ cart.splice(i,1); renderCart(); }
      function totals(){
        let base=0, iva=0; const byRate={};
        cart.forEach(function(l){ const b=Math.round(l.qty*l.unit_price*100)/100; const t=Math.round(b*l.tax_rate/100*100)/100; base+=b; iva+=t; byRate[l.tax_rate]=(byRate[l.tax_rate]||0)+t; });
        base=Math.round(base*100)/100; iva=Math.round(iva*100)/100;
        return { base, iva, total:Math.round((base+iva)*100)/100, byRate };
      }
      function renderCart(){
        document.getElementById('cart').innerHTML = cart.length ? cart.map(function(l,i){
          const a=lineAvail(l); const over=(a!=null && l.qty>a);
          const overTxt = over ? '<br><span style="color:var(--danger);font-size:.72rem">⚠ hay '+a+', vendes '+l.qty+' — exceso de '+(l.qty-a)+'</span>' : '';
          return '<div style="display:flex;align-items:center;gap:.4rem;padding:.35rem 0;border-bottom:1px solid var(--border)">'
            +'<div style="flex:1;font-size:.85rem">'+escHtml(l.description)+(l.free?' <span style="color:var(--muted);font-size:.72rem">(libre 21%)</span>':'')+'<br><span style="color:var(--muted);font-size:.75rem">'+SYM+l.unit_price.toFixed(2)+' · IVA '+l.tax_rate+'%</span>'+overTxt+'</div>'
            +'<input type="number" min="1" value="'+l.qty+'" onchange="setQty('+i+',this.value)" style="width:52px;padding:.2rem .3rem;border:1px solid '+(over?'var(--danger)':'var(--border2)')+';border-radius:4px;font-size:.82rem">'
            +'<span style="min-width:64px;text-align:right;font-size:.85rem">'+SYM+(l.qty*l.unit_price).toFixed(2)+'</span>'
            +'<button class="btn btn-danger btn-sm" onclick="removeLine('+i+')">✕</button></div>';
        }).join('') : '<div style="color:var(--muted);font-size:.85rem">Carrito vacío. Toca un producto.</div>';
        const exc=stockExcess(); const sw=document.getElementById('stockWarn');
        if(exc.length){ sw.style.display='block'; sw.innerHTML='⚠ Venta por encima del stock disponible: '+exc.map(function(x){return escHtml(x.name)+' (hay '+x.available+', vendes '+x.requested+')';}).join('; ')+'. Puedes continuar; al cobrar se pedirá confirmación.'; }
        else { sw.style.display='none'; }
        const t=totals();
        const ivaRows=Object.keys(t.byRate).sort((a,b)=>b-a).map(r=>'<tr><td style="color:var(--muted);padding:.15rem 0">IVA '+r+'%</td><td style="text-align:right">'+SYM+t.byRate[r].toFixed(2)+'</td></tr>').join('');
        document.getElementById('totals').innerHTML = cart.length
          ? '<tr><td style="color:var(--muted);padding:.15rem 0">Base</td><td style="text-align:right">'+SYM+t.base.toFixed(2)+'</td></tr>'+ivaRows
            +'<tr><td style="font-weight:700;font-size:1.05rem;padding-top:.4rem">TOTAL</td><td style="text-align:right;font-weight:700;font-size:1.05rem;padding-top:.4rem">'+SYM+t.total.toFixed(2)+'</td></tr>'
          : '';
        document.getElementById('btn-cobrar').disabled = !cart.length;
        const warn=document.getElementById('limitWarn');
        if(cart.length && t.total>LIMIT){ warn.style.display='block'; warn.textContent='Aviso: '+SYM+t.total.toFixed(2)+' supera 400 €. Por encima de ese importe normalmente corresponde una factura completa (hay excepciones por sector). Puedes continuar.'; }
        else { warn.style.display='none'; }
      }
      function openCobro(){
        if(!cart.length) return;
        method=null;
        const t=totals();
        document.getElementById('cobroTotal').textContent=SYM+t.total.toFixed(2);
        document.getElementById('pm-efectivo').className='btn btn-secondary'; document.getElementById('pm-tarjeta').className='btn btn-secondary';
        document.getElementById('efectivoWrap').style.display='none';
        document.getElementById('entregado').value=''; document.getElementById('cambio').textContent='';
        document.getElementById('btn-confirmar').disabled=true;
        const w2=document.getElementById('limitWarn2');
        if(t.total>LIMIT){ w2.style.display='block'; w2.textContent='Importe > 400 €: normalmente correspondería factura completa. Aviso, no bloqueo.'; } else { w2.style.display='none'; }
        // Repite el aviso de sobreventa en la confirmación final (espejo de la factura).
        const exc=stockExcess(); const sw2=document.getElementById('stockWarn2');
        if(exc.length){ sw2.style.display='block'; sw2.innerHTML='⚠ Vas a vender por encima del stock disponible: '+exc.map(function(x){return escHtml(x.name)+' (hay '+x.available+', vendes '+x.requested+' — exceso de '+x.excess+')';}).join('; ')+'. Al confirmar se registrará el exceso.'; }
        else { sw2.style.display='none'; }
        openModal('cobroModal');
      }
      function setMethod(m){
        method=m;
        document.getElementById('pm-efectivo').className = m==='efectivo'?'btn btn-primary':'btn btn-secondary';
        document.getElementById('pm-tarjeta').className = m==='tarjeta'?'btn btn-primary':'btn btn-secondary';
        document.getElementById('efectivoWrap').style.display = m==='efectivo'?'block':'none';
        updateConfirm();
      }
      function calcCambio(){
        const t=totals(); const ent=parseFloat(document.getElementById('entregado').value);
        const el=document.getElementById('cambio');
        if(isFinite(ent)){ const c=Math.round((ent-t.total)*100)/100; el.textContent = c>=0 ? 'Cambio: '+SYM+c.toFixed(2) : 'Falta '+SYM+(-c).toFixed(2); el.style.color=c>=0?'var(--ok)':'var(--danger)'; }
        else { el.textContent=''; }
        updateConfirm();
      }
      function updateConfirm(){
        let ok = method==='tarjeta';
        if(method==='efectivo'){ const t=totals(); const ent=parseFloat(document.getElementById('entregado').value); ok = isFinite(ent) && ent>=t.total; }
        document.getElementById('btn-confirmar').disabled=!ok;
      }
      async function confirmarVenta(){
        if(!method){ toast('Elige método de pago','err'); return; }
        const btn=document.getElementById('btn-confirmar'); btn.disabled=true;
        const t=totals();
        const lines=cart.map(function(l){ return { product_id:l.product_id, description:l.description, quantity:l.qty, unit_price:l.unit_price, tax_rate:l.tax_rate }; });
        try {
          const d=await api('POST','/api/erp/mostrador/sale',{ warehouse_id: parseInt(WH())||null, payment_method: method, lines, confirm_excess: stockExcess().length>0 });
          let extra='';
          if(method==='efectivo'){ const ent=parseFloat(document.getElementById('entregado').value); if(isFinite(ent)) extra='<div style="margin-top:.4rem">Cambio: <strong>'+SYM+(Math.round((ent-d.total)*100)/100).toFixed(2)+'</strong></div>'; }
          closeModal('cobroModal');
          document.getElementById('ticketBody').innerHTML='<div><strong>'+escHtml(d.invoice_number)+'</strong> · '+SYM+Number(d.total).toFixed(2)+' ('+method+')</div>'+extra
            +'<div style="margin-top:.8rem;display:flex;gap:.5rem;flex-wrap:wrap"><a class="btn btn-primary btn-sm" href="/admin/mostrador/'+d.id+'/pdf" target="_blank">Imprimir ticket (PDF)</a><a class="btn btn-secondary btn-sm" href="/admin/invoices/'+d.id+'" target="_blank">Ver en Facturas</a></div>';
          openModal('ticketModal');
          cart=[]; renderCart(); await loadStock(); renderGrid();
        } catch(e){ toast(e.message||'Error emitiendo el ticket','err'); btn.disabled=false; }
      }
      function closeTicket(){ closeModal('ticketModal'); }
      loadCatalog();
      </script>`;
    return c.html(adminLayout('Mostrador', content, 'mostrador', csrfToken, c));
  });

  // ── Ticket imprimible (PDF) — formato ticket, sin cliente, con QR + leyenda + método de pago.
  views.get('/:id/pdf', requirePerm('invoices.read'), async c => {
    try {
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(parseInt(c.req.param('id')));
      if (!inv) return c.html(errorShell('No encontramos este ticket', 'Puede que se haya anulado o que el enlace ya no sea válido.', { action: 'Ir al TPV', href: '/admin/mostrador' }), 404);
      const paper = await buildTicketPaper(db, inv);
      const pdf = await renderPdfFromHtml(printableShell(paper, { title: 'Ticket ' + inv.invoice_number }));
      const fname = ('Ticket-' + (inv.invoice_number || ('' + inv.id)) + '.pdf').replace(/[\/\\]/g, '-');
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + fname + '"' } });
    } catch (e) { return c.html(errorShell('No hemos podido generar el PDF', ERR.PDF, { action: 'Ir al TPV', href: '/admin/mostrador' }), e.status || 500); }
  });

  return { api, views };
}
