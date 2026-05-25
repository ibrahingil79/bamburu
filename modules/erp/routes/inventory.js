import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { inventoryMovementSchema } from '../schemas.js';

export function createInventoryRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  api.get('/movements', requirePerm('inventory.read'), c => {
    try {
      return c.json(db.prepare('SELECT m.*,p.name as product_name FROM inventory_movements m JOIN products p ON m.product_id=p.id ORDER BY m.created_at DESC LIMIT 100').all());
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/movements', requirePerm('inventory.edit'), validate(inventoryMovementSchema), async c => {
    try {
      const d = c.get('validated');
      if (!d.product_id || !d.quantity) return c.json({error:'Datos incompletos'},400);
      const cur = db.prepare('SELECT stock FROM products WHERE id=?').get(d.product_id);
      if (!cur) return c.json({error:'Producto no encontrado'},404);
      db.prepare('INSERT INTO inventory_movements (product_id,type,quantity,reason) VALUES (?,?,?,?)').run(d.product_id, d.type, parseInt(d.quantity), d.reason||'');
      let n = cur.stock;
      if (d.type==='in') n += parseInt(d.quantity);
      else if (d.type==='out') n -= parseInt(d.quantity);
      else n = parseInt(d.quantity);
      db.prepare('UPDATE products SET stock=? WHERE id=?').run(n, d.product_id);
      return c.json({message:'Actualizado', newStock:n});
    } catch(e) { return c.json({error:e.message},500); }
  });

  views.get('/', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Inventario</h2>${can(c,'inventory.edit')?'<button class="btn btn-primary" onclick="openModal(\'adjModal\')">Ajustar Stock</button>':''}</div>
      <div class="grid ga" style="margin-bottom:1.5rem">
        <div class="kpi"><div class="kpi-label">Total productos</div><div class="kpi-val" id="kTotal">-</div></div>
        <div class="kpi"><div class="kpi-label">Stock bajo (&lt;5)</div><div class="kpi-val" id="kLow" style="color:#f59e0b">-</div></div>
        <div class="kpi"><div class="kpi-label">Sin stock</div><div class="kpi-val" id="kOut" style="color:#ef4444">-</div></div>
        <div class="kpi"><div class="kpi-label">Valor inventario</div><div class="kpi-val" id="kVal" style="color:#10b981">-</div></div>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Existencias actuales</h3><input class="search" id="searchBox" placeholder="Buscar..." oninput="filterTable()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Stock</th><th>Estado</th><th></th></tr></thead>
          <tbody id="invBody"></tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Movimientos recientes</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th></tr></thead>
          <tbody id="movBody"></tbody>
        </table></div>
      </div>

      <div class="modal-overlay" id="adjModal">
        <div class="modal">
          <div class="modal-head"><h3>Ajustar Stock</h3><button class="modal-close" onclick="closeModal('adjModal')">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Producto</label><select class="form-control" id="adjProd"></select></div>
            <div class="form-group"><label class="form-label">Tipo</label>
              <select class="form-control" id="adjType">
                <option value="in">Entrada (sumar)</option>
                <option value="out">Salida (restar)</option>
                <option value="adjust">Ajuste (fijar exacto)</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Cantidad</label><input class="form-control" type="number" id="adjQty" min="1"></div>
            <div class="form-group"><label class="form-label">Motivo</label><input class="form-control" id="adjReason" placeholder="Ej: recepción proveedor..."></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('adjModal')">Cancelar</button><button class="btn btn-primary" onclick="doAdj()">Confirmar</button></div>
        </div>
      </div>

      <script>
      let prods=[];
      async function loadInv(){
        const [p,m]=await Promise.all([
          api('GET','/api/erp/products').catch(()=>[]),
          api('GET','/api/erp/inventory/movements').catch(()=>[])
        ]);
        prods=p;
        document.getElementById('kTotal').textContent=p.length;
        document.getElementById('kLow').textContent=p.filter(x=>x.stock>0&&x.stock<5).length;
        document.getElementById('kOut').textContent=p.filter(x=>x.stock===0).length;
        document.getElementById('kVal').textContent='${sym}'+p.reduce((a,b)=>a+(b.price*b.stock),0).toFixed(2);
        const sel=document.getElementById('adjProd');
        sel.innerHTML=p.map(x=>'<option value="'+x.id+'">'+x.name+' (stock: '+x.stock+')</option>').join('');
        filterTable();
        renderMov(m);
      }
      function filterTable(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        const f=q?prods.filter(p=>p.name.toLowerCase().includes(q)||(p.sku||'').toLowerCase().includes(q)):prods;
        const b={ok:'b-green',low:'b-yellow',out:'b-red'};
        document.getElementById('invBody').innerHTML=f.length?f.map(p=>{
          const st=p.stock===0?'out':p.stock<5?'low':'ok';
          const sl={ok:'OK',low:'Bajo',out:'Sin stock'};
          const vRow=p.variants&&p.variants.length?'<tr><td colspan="6" style="padding:0 16px 12px 32px;background:#f8fafc"><div style="font-size:12px;color:#64748b;margin-bottom:6px">Variantes:</div><div style="display:flex;flex-wrap:wrap;gap:8px">'+p.variants.map(function(v){const lbl=[v.option1_value,v.option2_value,v.name].filter(Boolean).join(' · ');return '<span style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px;font-size:12px">'+lbl+': <strong>'+v.stock+'</strong></span>';}).join('')+'</div></td></tr>':'';
          return '<tr><td><strong>'+p.name+'</strong></td><td style="color:var(--muted)">'+(p.sku||'-')+'</td><td>'+(p.category_name||'-')+'</td><td><strong style="color:'+(p.stock<5?'#ef4444':'inherit')+'">'+p.stock+'</strong></td><td><span class="badge '+b[st]+'">'+sl[st]+'</span></td><td>'+(window.canDo('inventory.edit')?'<button class="btn btn-secondary btn-sm" onclick="quickAdj('+p.id+')">Ajustar</button>':'')+'</td></tr>'+vRow;
        }).join(''):'<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Sin productos</td></tr>';
      }
      function quickAdj(id){document.getElementById('adjProd').value=id;openModal('adjModal');}
      function renderMov(movs){
        const tc={in:'<span style="color:#10b981;font-weight:600">Entrada</span>',out:'<span style="color:#ef4444;font-weight:600">Salida</span>',adjust:'<span style="color:#0ea5e9;font-weight:600">Ajuste</span>'};
        document.getElementById('movBody').innerHTML=movs.length?movs.map(m=>'<tr><td style="color:var(--muted);font-size:.8rem">'+(m.created_at?.split(' ')[0]||'-')+'</td><td>'+m.product_name+'</td><td>'+(tc[m.type]||m.type)+'</td><td>'+m.quantity+'</td><td style="color:var(--muted)">'+(m.reason||'-')+'</td></tr>').join(''):'<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin movimientos</td></tr>';
      }
      async function doAdj(){
        const pid=document.getElementById('adjProd').value;
        const qty=parseInt(document.getElementById('adjQty').value);
        if(!pid||!qty||qty<=0){toast('Datos incompletos','err');return;}
        try{await api('POST','/api/erp/inventory/movements',{product_id:pid,type:document.getElementById('adjType').value,quantity:qty,reason:document.getElementById('adjReason').value||'Ajuste manual'});closeModal('adjModal');toast('Stock actualizado');loadInv();}catch(e){toast(e.message,'err')}
      }
      loadInv();
      </script>`;
    return c.html(adminLayout('Inventario', content, 'inventory', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
