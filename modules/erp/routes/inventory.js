import { Hono } from 'hono';
import { adminLayout, can, skeletonRows } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { stockModalHtml, stockModalScript } from '../views/stock-modal.js';
import { activeWarehouses } from './warehouses.js';
import { escHtml, jsonForScript } from '../../../core/escape.js';

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
    const whOptions = warehouses.map(w => `<option value="${w.id}">${escHtml(w.name)}${w.is_default ? ' (principal)' : ''}</option>`).join('');
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
      <!-- I1 · el componente único de tarjeta de cifra (.bf-card, layout.js). Antes eran .kpi, que
           era otra tarjeta distinta para lo mismo. «Sin stock» pierde el rojo fijo: se lo pone el
           JS SOLO si hay alguno, porque un 0 en rojo asusta por nada. -->
      <div class="bf-cards">
        <div class="bf-card inerte"><span class="bf-k">Productos físicos</span><span class="bf-v" id="kTotal">—</span></div>
        <div class="bf-card inerte"><span class="bf-k">Stock bajo (&lt;5)</span><span class="bf-v" id="kLow">—</span></div>
        <div class="bf-card inerte"><span class="bf-k">Sin stock</span><span class="bf-v" id="kOut">—</span></div>
        <div class="bf-card inerte"><span class="bf-k" id="kValLabel">Valor del almacén</span><span class="bf-v gana" id="kVal">—</span></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Existencias (productos físicos)</h3><input class="search" id="searchBox" placeholder="Buscar nombre o SKU..." oninput="filterTable()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Stock</th><th>Reservado</th><th>Disponible</th><th>Coste medio</th><th>Valor</th><th>Estado</th><th></th></tr></thead>
          <tbody id="invBody">${skeletonRows(10)}</tbody>
        </table></div>
      </div>

      ${stockModalHtml()}
      <script>
      ${stockModalScript(sym, warehouses)}
      const CAN_EDIT = ${canEdit ? 'true' : 'false'};
      const WAREHOUSES = ${jsonForScript(warehouses)};
      let prods=[];
      let WH='';            // '' = Todos (total global); si no, id de almacén
      window.stockFilterWarehouse = '';   // Capa 2: el ajuste por defecto usa el almacén del filtro activo
      let whMap=null;       // mapa product_id -> {qty,reserved,available} en el almacén WH (null si Todos)
      // Cantidad a mostrar de un producto: global (caché) si "Todos", o por almacén (al vuelo).
      function stockOf(p){ return WH==='' ? (p.stock||0) : (whMap && whMap[p.id]!=null ? whMap[p.id].qty : 0); }
      // PIEZA 2a — reservado/disponible: global (de la lista de productos) o por almacén (del mapa).
      function reservedOf(p){ return WH==='' ? (p.reserved||0) : (whMap && whMap[p.id]!=null ? (whMap[p.id].reserved||0) : 0); }
      function availableOf(p){ return WH==='' ? (p.available!=null?p.available:(p.stock||0)) : (whMap && whMap[p.id]!=null ? (whMap[p.id].available!=null?whMap[p.id].available:whMap[p.id].qty) : 0); }
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
            whMap = {}; (rows||[]).forEach(function(r){ whMap[r.product_id]=r; });
          } catch(e){ toast(e.message||'Error','err'); return; }
        }
        const lbl = WH==='' ? 'Valor del almacén' : 'Valor (almacén seleccionado)';
        document.getElementById('kValLabel').textContent = lbl;
        render();
      }
      function render(){
        // Cifras sobre TODOS los físicos, con la cantidad del almacén activo (o global).
        // I1 · EL COLOR SOLO SI DICE ALGO: antes «Stock bajo» iba siempre en ámbar y «Sin stock»
        // siempre en rojo, incluso valiendo 0 — un cero en rojo asusta por nada y, si todo va
        // pintado, deja de destacar lo que importa. Ahora se enciende cuando hay algo que mirar.
        document.getElementById('kTotal').textContent=prods.length;
        var nLow = prods.filter(function(x){ const s=stockOf(x); return s>0&&s<5; }).length;
        var nOut = prods.filter(function(x){ return stockOf(x)===0; }).length;
        var elLow = document.getElementById('kLow'), elOut = document.getElementById('kOut');
        elLow.textContent = nLow; elOut.textContent = nOut;
        elLow.style.color = nLow ? 'var(--warn)' : '';
        elOut.classList.toggle('debe', nOut > 0);
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
            + (CAN_EDIT?' <button class="btn btn-secondary btn-sm" onclick="openAjustar('+p.id+',\\''+escHtml(nm)+'\\','+p.stock+')">Ajustar</button>':'');
          const avg=Number(p.average_cost||0);
          const val=avg*s;
          const rsv=reservedOf(p), avl=availableOf(p);
          return '<tr><td><strong>'+escHtml(p.name)+'</strong></td><td style="color:var(--muted)">'+escHtml(p.sku||'-')+'</td><td>'+escHtml(p.category_name||'-')+'</td><td><strong style="color:'+(s<5?'var(--danger)':'inherit')+'">'+s+'</strong></td><td style="color:'+(rsv>0?'var(--accent-purple)':'var(--muted)')+'">'+rsv+'</td><td><strong style="color:'+(avl<0?'var(--danger)':'inherit')+'">'+avl+'</strong></td><td>${sym}'+avg.toFixed(2)+'</td><td>${sym}'+val.toFixed(2)+'</td><td><span class="badge '+b[st]+'">'+sl[st]+'</span></td><td style="white-space:nowrap">'+acts+'</td></tr>';
        }).join(''):(q?window.emptyRow(10,'No se encontraron productos con ese filtro.',{icon:'ti-search'}):window.emptyRow(10,'Aquí verás el stock de tus productos físicos. Si vendes servicios, es normal que esté vacío.',{cta:'Ir al catálogo',href:'/admin/products',soft:true}));
      }
      // Tras ajustar/revertir desde el componente compartido, refresca todo (la caché global
      // cambió y, si hay un almacén filtrado, también su mapa al vuelo).
      window.stockOnSaved = async function(id){
        try { const all = await api('GET','/api/erp/products'); prods=(all||[]).filter(p=>(p.type||'physical')==='physical'); } catch(e){}
        if (WH!==''){ try { const rows=await api('GET','/api/erp/warehouses/'+WH+'/stock'); whMap={}; (rows||[]).forEach(function(r){ whMap[r.product_id]=r; }); } catch(e){} }
        render();
      };
      // Enlace directo desde /admin/avisos (?q=Nombre del producto): deja el producto ya
      // filtrado, con "Ajustar" a un clic. loadInv() llama a filterTable() al terminar.
      const _q = new URLSearchParams(location.search).get('q');
      if (_q) document.getElementById('searchBox').value = _q;
      loadInv();
      </script>`;
    return c.html(adminLayout('Inventario', content, 'inventory', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
