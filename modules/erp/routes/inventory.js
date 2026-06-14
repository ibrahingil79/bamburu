import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { stockModalHtml, stockModalScript } from '../views/stock-modal.js';
import { activeWarehouses } from './warehouses.js';

// Pilar 3 · Paso 1 — Inventario UNIFICADO. El stock es la SUMA del libro stock_movements
// (products.stock es caché derivada). Esta página lista los productos FÍSICOS con su stock
// (la caché) y permite Ajustar / ver el Kardex con el componente compartido (stock-modal.js).
// El modelo viejo (inventory_movements + ajuste que fijaba products.stock) se retiró.
export function createInventoryRoutes(db, cfg = {}) {
  const api = new Hono();      // sin endpoints propios: la escritura va por /products/:id/stock y /stock
  const views = new Hono();

  views.get('/', requirePerm('inventory.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const canEdit = can(c, 'inventory.edit');
    // Multi-almacén · Capa 1 — filtro de almacén. "Todos" = total global (comportamiento de
    // hoy); un almacén concreto = cantidad y valor calculados al vuelo sobre el libro.
    const warehouses = activeWarehouses(db);
    const whOptions = warehouses.map(w => `<option value="${w.id}">${String(w.name).replace(/</g, '&lt;')}${w.is_default ? ' (principal)' : ''}</option>`).join('');
    const content = `
      <div class="ph"><h2>Inventario</h2>
        <div style="display:flex;align-items:center;gap:.5rem">
          <label style="color:var(--muted);font-size:.85rem">Almacén</label>
          <select class="form-control" id="whFilter" style="width:auto;min-width:170px" onchange="onWhChange()">
            <option value="">Todos (total)</option>
            ${whOptions}
          </select>
        </div>
      </div>
      <div class="grid ga" style="margin-bottom:1.5rem">
        <div class="kpi"><div class="kpi-label">Productos físicos</div><div class="kpi-val" id="kTotal">-</div></div>
        <div class="kpi"><div class="kpi-label">Stock bajo (&lt;5)</div><div class="kpi-val" id="kLow" style="color:#f59e0b">-</div></div>
        <div class="kpi"><div class="kpi-label">Sin stock</div><div class="kpi-val" id="kOut" style="color:#ef4444">-</div></div>
        <div class="kpi"><div class="kpi-label" id="kValLabel">Valor del almacén</div><div class="kpi-val" id="kVal" style="color:#10b981">-</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Existencias (productos físicos)</h3><input class="search" id="searchBox" placeholder="Buscar nombre o SKU..." oninput="filterTable()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Stock</th><th>Coste medio</th><th>Valor</th><th>Estado</th><th></th></tr></thead>
          <tbody id="invBody"></tbody>
        </table></div>
      </div>

      ${stockModalHtml()}
      <script>
      ${stockModalScript(sym, warehouses)}
      const CAN_EDIT = ${canEdit ? 'true' : 'false'};
      const WAREHOUSES = ${JSON.stringify(warehouses)};
      let prods=[];
      let WH='';            // '' = Todos (total global); si no, id de almacén
      window.stockFilterWarehouse = '';   // Capa 2: el ajuste por defecto usa el almacén del filtro activo
      let whMap=null;       // mapa product_id -> cantidad en el almacén WH (null si Todos)
      // Cantidad a mostrar de un producto: global (caché) si "Todos", o por almacén (al vuelo).
      function stockOf(p){ return WH==='' ? (p.stock||0) : (whMap && whMap[p.id]!=null ? whMap[p.id] : 0); }
      async function loadInv(){
        let all;
        try { all = await api('GET','/api/erp/products'); } catch(e){ toast(e.message||'Error','err'); return; }
        // Solo físicos llevan stock/kardex (service/digital fuera).
        prods = (all||[]).filter(p => (p.type||'physical')==='physical');
        render();
      }
      async function onWhChange(){
        WH = document.getElementById('whFilter').value;
        window.stockFilterWarehouse = WH;   // el ajuste por defecto apuntará a este almacén
        if (WH===''){ whMap=null; }
        else {
          try {
            const rows = await api('GET','/api/erp/warehouses/'+WH+'/stock');
            whMap = {}; (rows||[]).forEach(function(r){ whMap[r.product_id]=r.qty; });
          } catch(e){ toast(e.message||'Error','err'); return; }
        }
        const lbl = WH==='' ? 'Valor del almacén' : 'Valor (almacén seleccionado)';
        document.getElementById('kValLabel').textContent = lbl;
        render();
      }
      function render(){
        // KPIs sobre TODOS los físicos, con la cantidad del almacén activo (o global).
        document.getElementById('kTotal').textContent=prods.length;
        document.getElementById('kLow').textContent=prods.filter(function(x){ const s=stockOf(x); return s>0&&s<5; }).length;
        document.getElementById('kOut').textContent=prods.filter(function(x){ return stockOf(x)===0; }).length;
        // Valor = Σ (cantidad × coste medio GLOBAL). Valoración a COSTE, no a precio de venta.
        document.getElementById('kVal').textContent='${sym}'+prods.reduce(function(a,b){ return a+((b.average_cost||0)*stockOf(b)); },0).toFixed(2);
        filterTable();
      }
      function filterTable(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        const f=q?prods.filter(p=>p.name.toLowerCase().includes(q)||(p.sku||'').toLowerCase().includes(q)):prods;
        const b={ok:'b-green',low:'b-yellow',out:'b-red'};
        document.getElementById('invBody').innerHTML=f.length?f.map(function(p){
          const s=stockOf(p);
          const st=s===0?'out':s<5?'low':'ok';
          const sl={ok:'OK',low:'Bajo',out:'Sin stock'};
          const nm = (p.name||'').replace(/'/g,'');
          // "Ver stock" abre el kardex (con desglose por almacén); "Ajustar" usa el stock GLOBAL
          // (el ajuste por almacén es Capa 2): por eso pasa p.stock, no la cantidad filtrada.
          const acts = '<button class="btn btn-secondary btn-sm" onclick="openStockKardex('+p.id+',\\''+escHtml(nm)+'\\')">Ver stock</button>'
            + (CAN_EDIT?' <button class="btn btn-primary btn-sm" onclick="openAjustar('+p.id+',\\''+escHtml(nm)+'\\','+p.stock+')">Ajustar</button>':'');
          const avg=Number(p.average_cost||0);
          const val=avg*s;
          return '<tr><td><strong>'+escHtml(p.name)+'</strong></td><td style="color:var(--muted)">'+escHtml(p.sku||'-')+'</td><td>'+escHtml(p.category_name||'-')+'</td><td><strong style="color:'+(s<5?'#ef4444':'inherit')+'">'+s+'</strong></td><td>${sym}'+avg.toFixed(2)+'</td><td>${sym}'+val.toFixed(2)+'</td><td><span class="badge '+b[st]+'">'+sl[st]+'</span></td><td style="white-space:nowrap">'+acts+'</td></tr>';
        }).join(''):'<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted)">Sin productos físicos</td></tr>';
      }
      // Tras ajustar/revertir desde el componente compartido, refresca todo (la caché global
      // cambió y, si hay un almacén filtrado, también su mapa al vuelo).
      window.stockOnSaved = async function(id){
        try { const all = await api('GET','/api/erp/products'); prods=(all||[]).filter(p=>(p.type||'physical')==='physical'); } catch(e){}
        if (WH!==''){ try { const rows=await api('GET','/api/erp/warehouses/'+WH+'/stock'); whMap={}; (rows||[]).forEach(function(r){ whMap[r.product_id]=r.qty; }); } catch(e){} }
        render();
      };
      loadInv();
      </script>`;
    return c.html(adminLayout('Inventario', content, 'inventory', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
