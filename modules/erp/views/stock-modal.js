// Pilar 3 · Paso 1 — componente COMPARTIDO de stock (mismo patrón que cobro-modal.js):
// HTML reutilizable + script reutilizable. Lo usan la sección /admin/inventory y la ficha
// de producto físico. Dos modales: "Ajustar stock" y "Kardex" (historial + saldo + revertir).
// Requiere los globales de adminLayout: api, toast, escHtml, openModal, closeModal.
import { ADJUST_REASONS, REASON_LABEL, TYPE_LABEL } from '../stock.js';

export function stockModalHtml() {
  const reasonOpts = ADJUST_REASONS.map(r => `<option value="${r}">${REASON_LABEL[r]}</option>`).join('');
  return `<div class="modal-overlay" id="stockAdjModal" style="z-index:320">
    <div class="modal" style="max-width:520px">
      <div class="modal-head"><h3 id="stockAdjTitle">Ajustar stock</h3><button class="modal-close" onclick="closeModal('stockAdjModal')">✕</button></div>
      <div class="modal-body">
        <div class="form-group" id="stockAdjWhWrap"><label class="form-label">Almacén</label>
          <select class="form-control" id="stockAdjWh" onchange="stockAdjWhChange()"></select>
        </div>
        <div style="margin-bottom:.75rem;color:var(--muted)">Stock actual en el almacén: <strong id="stockAdjCurrent">—</strong></div>
        <div class="form-row" style="gap:.5rem">
          <div class="form-group"><label class="form-label">Modo</label>
            <select class="form-control" id="stockAdjMode" onchange="stockAdjLabel()">
              <option value="set">Poner a</option>
              <option value="add">Sumar</option>
              <option value="sub">Restar</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label" id="stockAdjValLabel">Cantidad</label>
            <input class="form-control" type="number" min="0" step="1" id="stockAdjValue" value="0">
          </div>
        </div>
        <div class="form-group"><label class="form-label">Motivo *</label>
          <select class="form-control" id="stockAdjReason">${reasonOpts}</select>
        </div>
        <div class="form-group"><label class="form-label">Nota</label><input class="form-control" id="stockAdjNote" placeholder="(opcional)"></div>
      </div>
      <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('stockAdjModal')">Cancelar</button><button class="btn btn-primary" onclick="guardarAjuste()">Guardar ajuste</button></div>
    </div>
  </div>
  <div class="modal-overlay" id="stockKardexModal" style="z-index:300">
    <div class="modal" style="max-width:760px">
      <div class="modal-head"><h3 id="stockKardexTitle">Stock</h3><button class="modal-close" onclick="closeModal('stockKardexModal')">✕</button></div>
      <div class="modal-body" id="stockKardexBody"></div>
    </div>
  </div>`;
}

export function stockModalScript(sym, warehouses = []) {
  return `
  (function(){
    const SYM = ${JSON.stringify(sym)};
    const TYPE_LABEL = ${JSON.stringify(TYPE_LABEL)};
    const WAREHOUSES = ${JSON.stringify(warehouses)};   // Capa 2: almacenes activos
    let curProd = null;     // {id, name}
    let curByWh = [];       // by_warehouse del producto abierto (para "Stock actual" por almacén)
    // Almacén por defecto del ajuste: el del filtro activo en pantalla si lo hay; si no, el principal.
    function defaultAdjWh(){
      const f = Number(window.stockFilterWarehouse);
      if (Number.isFinite(f) && f > 0 && WAREHOUSES.some(w => w.id === f)) return f;
      const def = WAREHOUSES.find(w => w.is_default) || WAREHOUSES[0];
      return def ? def.id : '';
    }
    function whQty(wid){ const r = curByWh.find(x => x.id === Number(wid)); return r ? r.qty : 0; }
    window.stockAdjWhChange = function(){
      const wid = document.getElementById('stockAdjWh').value;
      const q = whQty(wid);
      document.getElementById('stockAdjCurrent').textContent = q;
      if (document.getElementById('stockAdjMode').value === 'set') document.getElementById('stockAdjValue').value = q;
    };
    window.stockAdjLabel = function(){
      const m = document.getElementById('stockAdjMode').value;
      document.getElementById('stockAdjValLabel').textContent = m==='set' ? 'Nuevo total' : 'Cantidad';
    };
    function originTxt(m){
      if(!m.origin_id) return m.note ? escHtml(m.note) : '';
      if(m.origin_type==='order') return '<a href="/admin/orders/'+m.origin_id+'" target="_blank">Pedido #'+m.origin_id+'</a>';
      if(m.origin_type==='purchase') return '<a href="/admin/purchases/'+m.origin_id+'" target="_blank">Compra #'+m.origin_id+'</a>';
      if(m.origin_type==='transfer_out'||m.origin_type==='transfer_in') return '<a href="/admin/stock-transfers/'+m.origin_id+'" target="_blank">'+escHtml(m.note||('Traslado #'+m.origin_id))+'</a>';
      return escHtml(m.note||'');
    }
    // Abre el kardex de un producto: stock actual + movimientos con saldo + revertir.
    // Se abre el modal YA (dentro del gesto de clic) con un "Cargando…" y se rellena tras
    // el fetch: si no, al venir tras el await (fuera del clic) el navegador no repinta el
    // modal sobre modal hasta el siguiente clic (parece que no se abre).
    window.openStockKardex = async function(id, name){
      curProd = { id: id, name: name||('#'+id) };
      document.getElementById('stockKardexTitle').textContent = 'Stock' + (name?(' · '+name):'');
      document.getElementById('stockKardexBody').innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--muted)">Cargando…</div>';
      openModal('stockKardexModal');
      let data;
      try { data = await api('GET','/api/erp/products/'+id+'/stock'); }
      catch(e){ document.getElementById('stockKardexBody').innerHTML = '<div class="alert alert-warn">'+escHtml(e.message||'Error')+'</div>'; return; }
      if(!data.physical){ document.getElementById('stockKardexBody').innerHTML='<div class="alert alert-ok">Este producto no lleva stock.</div>'; return; }
      document.getElementById('stockKardexTitle').textContent = 'Stock · '+curProd.name;
      const rows = (data.movements||[]).slice().reverse().map(function(m){
        const qty = (m.quantity>0?'+':'')+m.quantity;
        const motivo = m.reason_label ? escHtml(m.reason_label) : (m.is_reversal ? 'Reversión' : (TYPE_LABEL[m.type]||m.type));
        const revCell = m.reversed
          ? '<span class="badge b-gray">revertido</span>'
          : '<button class="btn btn-secondary btn-sm" onclick="revertirMov('+m.id+')">Revertir</button>';
        return '<tr>'
          +'<td style="color:var(--muted);font-size:.8rem">'+escHtml((m.created_at||'').slice(0,16))+'</td>'
          +'<td><span class="badge '+badge(m.type)+'">'+escHtml(TYPE_LABEL[m.type]||m.type)+'</span></td>'
          +'<td style="text-align:right;font-weight:600;color:'+(m.quantity<0?'#ef4444':'#10b981')+'">'+qty+'</td>'
          +'<td>'+motivo+(m.note&&m.reason_label?(' · '+escHtml(m.note)):'')+'</td>'
          +'<td>'+originTxt(m)+'</td>'
          +'<td style="text-align:right">'+m.balance+'</td>'
          +'<td style="text-align:right">'+revCell+'</td>'
          +'</tr>';
      }).join('');
      // Multi-almacén · Capa 1 — desglose por almacén activo (solo lectura).
      const wh = data.by_warehouse || [];
      const whBlock = wh.length
        ? '<div style="margin-bottom:1rem"><div style="font-size:.75rem;text-transform:uppercase;color:var(--muted);margin-bottom:.4rem">Stock por almacén</div>'
          +'<div class="table-wrap"><table><tbody>'
          +wh.map(function(w){ return '<tr><td>'+escHtml(w.name)+(w.is_default?' <span class="badge b-green" style="font-size:.62rem">Principal</span>':'')+'</td><td style="text-align:right;font-weight:600">'+w.qty+'</td></tr>'; }).join('')
          +'</tbody></table></div></div>'
        : '';
      document.getElementById('stockKardexBody').innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">'
        +'<div>Stock actual: <strong style="font-size:1.4rem">'+data.stock+'</strong></div>'
        +'<button class="btn btn-primary btn-sm" onclick="openAjustar('+id+',\\''+escHtml((name||'').replace(/\\'/g,''))+'\\','+data.stock+')">Ajustar stock</button>'
        +'</div>'
        +whBlock
        +'<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th style="text-align:right">Cant.</th><th>Motivo</th><th>Origen</th><th style="text-align:right">Saldo</th><th></th></tr></thead><tbody>'
        +(rows||'<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:1rem">Sin movimientos</td></tr>')
        +'</tbody></table></div>';
      // (el modal ya está abierto desde el inicio del gesto de clic)
    };
    function badge(t){ return ({apertura:'b-gray',entrada:'b-green',salida:'b-red',ajuste:'b-yellow',transferencia:'b-blue'})[t]||''; }
    // Abre el modal de ajuste (modos poner/sumar/restar + motivo + nota). Capa 2: opera sobre
    // UN almacén; "Stock actual" y el valor de "Poner a" reflejan el saldo de ESE almacén.
    window.openAjustar = async function(id, name){
      curProd = { id: id, name: name||('#'+id) };
      document.getElementById('stockAdjTitle').textContent = 'Ajustar stock · '+curProd.name;
      const sel = document.getElementById('stockAdjWh');
      const wrap = document.getElementById('stockAdjWhWrap');
      sel.innerHTML = WAREHOUSES.map(function(w){ return '<option value="'+w.id+'">'+escHtml(w.name)+(w.is_default?' (principal)':'')+'</option>'; }).join('');
      if (wrap) wrap.style.display = WAREHOUSES.length > 1 ? '' : 'none';   // un solo almacén → sin selector
      curByWh = [];
      try { const d = await api('GET','/api/erp/products/'+id+'/stock'); curByWh = d.by_warehouse || []; } catch(e){}
      sel.value = String(defaultAdjWh());
      document.getElementById('stockAdjMode').value='set';
      document.getElementById('stockAdjReason').selectedIndex = 0;
      document.getElementById('stockAdjNote').value='';
      stockAdjWhChange();   // fija "Stock actual" y el valor de "Poner a" según el almacén
      stockAdjLabel();
      openModal('stockAdjModal');
    };
    window.guardarAjuste = async function(){
      if(!curProd) return;
      const mode = document.getElementById('stockAdjMode').value;
      const value = parseInt(document.getElementById('stockAdjValue').value);
      const reason = document.getElementById('stockAdjReason').value;
      const note = document.getElementById('stockAdjNote').value;
      if(!(value>=0)){ toast('Cantidad no válida','err'); return; }
      try {
        const r = await api('POST','/api/erp/products/'+curProd.id+'/stock/adjust',{ mode, value, reason, note, warehouse_id: document.getElementById('stockAdjWh').value || null });
        toast(r.message || ('Stock: '+r.stock));
        closeModal('stockAdjModal');
        if (typeof window.stockOnSaved === 'function') window.stockOnSaved(curProd.id);
        // Si el kardex está abierto, refréscalo.
        if (document.getElementById('stockKardexModal').classList.contains('active') || document.getElementById('stockKardexModal').style.display==='flex') openStockKardex(curProd.id, curProd.name);
      } catch(e){ toast(e.message||'Error ajustando','err'); }
    };
    window.revertirMov = async function(movId){
      if(!confirm('¿Revertir este movimiento? Se creará el movimiento opuesto (no se borra el original).')) return;
      try {
        await api('POST','/api/erp/stock/movements/'+movId+'/reverse',{});
        toast('Movimiento revertido');
        if (curProd) openStockKardex(curProd.id, curProd.name);
        if (typeof window.stockOnSaved === 'function' && curProd) window.stockOnSaved(curProd.id);
      } catch(e){ toast(e.message||'Error revirtiendo','err'); }
    };
  })();
  `;
}
