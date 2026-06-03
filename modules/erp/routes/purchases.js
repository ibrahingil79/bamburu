import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { validate } from '../../../core/validate.js';
import { purchaseSchema } from '../schemas.js';

export function createPurchaseRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  api.get('/', c => {
    try {
      return c.json(db.prepare('SELECT p.*,s.name as supplier_name FROM purchases p JOIN suppliers s ON p.supplier_id=s.id ORDER BY p.date DESC,p.created_at DESC').all());
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.get('/:id', c => {
    try {
      const id = parseInt(c.req.param('id'));
      const purchase = db.prepare('SELECT p.*,s.name as supplier_name FROM purchases p JOIN suppliers s ON p.supplier_id=s.id WHERE p.id=?').get(id);
      if (!purchase) return c.json({error:'No encontrado'},404);
      const items = db.prepare('SELECT pi.*,pr.name as product_name FROM purchase_items pi JOIN products pr ON pi.product_id=pr.id WHERE pi.purchase_id=?').all(id);
      return c.json({...purchase, items});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/', validate(purchaseSchema), c => {
    try {
      const d = c.get('validated');
      const create = db.transaction(() => {
        const total = d.items.reduce((s,i) => s + i.quantity * i.unit_cost, 0);
        const r = db.prepare('INSERT INTO purchases (supplier_id,reference,date,notes,status,total) VALUES (?,?,?,?,?,?)').run(d.supplier_id, d.reference||'', d.date, d.notes||'', d.status, total);
        const pid = r.lastInsertRowid;
        const insItem = db.prepare('INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,?,?)');
        for (const item of d.items) insItem.run(pid, item.product_id, item.quantity, item.unit_cost);
        if (d.status === 'received') {
          const upd = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
          const insMov = db.prepare('INSERT INTO inventory_movements (product_id,type,quantity,reason) VALUES (?,?,?,?)');
          for (const item of d.items) {
            upd.run(item.quantity, item.product_id);
            insMov.run(item.product_id, 'in', item.quantity, 'Compra #'+pid+(d.reference?' ref:'+d.reference:''));
          }
        }
        return pid;
      });
      const newId = create();
      return c.json({id:newId, message:'Compra registrada'}, 201);
    } catch(e) { return c.json({error:e.message},500); }
  });

  views.get('/', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Compras</h2>${can(c,'purchases.create')?'<a href="/admin/purchases/new" class="btn btn-primary">Nueva compra</a>':''}</div>
      <div class="card">
        <div class="card-head"><h3>Registro de compras</h3><input class="search" id="searchBox" placeholder="Buscar..." oninput="renderPurchases()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Proveedor</th><th>Referencia</th><th>Fecha</th><th>Estado</th><th>Total</th><th></th></tr></thead>
          <tbody id="purchBody"></tbody>
        </table></div>
      </div>
      <script>
      var PURCHASES=[];
      var STATUS_MAP={pending:'Pendiente',received:'Recibida',cancelled:'Cancelada'};
      var BADGE_MAP={pending:'b-yellow',received:'b-green',cancelled:'b-red'};
      async function loadPurchases(){
        PURCHASES=await api('GET','/api/erp/purchases').catch(function(){return[];});
        renderPurchases();
      }
      function renderPurchases(){
        var q=(document.getElementById('searchBox').value||'').toLowerCase();
        var rows=q?PURCHASES.filter(function(r){
          return (r.supplier_name||'').toLowerCase().indexOf(q)>=0
            ||(r.reference||'').toLowerCase().indexOf(q)>=0
            ||(STATUS_MAP[r.status]||r.status||'').toLowerCase().indexOf(q)>=0;
        }):PURCHASES;
        document.getElementById('purchBody').innerHTML=rows.length?rows.map(function(r){
          return '<tr><td style="color:var(--muted)">#'+r.id+'</td><td><strong>'+escHtml(r.supplier_name)+'</strong></td><td>'+escHtml(r.reference||'-')+'</td><td>'+escHtml(r.date)+'</td><td><span class="badge '+(BADGE_MAP[r.status]||'b-gray')+'">'+escHtml(STATUS_MAP[r.status]||r.status)+'</span></td><td><strong>'+parseFloat(r.total).toFixed(2)+' ${sym}</strong></td><td style="text-align:right"><a href="/admin/purchases/'+r.id+'" class="btn btn-secondary btn-sm">Ver</a></td></tr>';
        }).join(''):'<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">'+(q?'Sin coincidencias':'Sin compras registradas')+'</td></tr>';
      }
      loadPurchases();
      </script>`;
    return c.html(adminLayout('Compras', content, 'purchases', c.get('session')?.csrfToken||'', c));
  });

  views.get('/new', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const today = new Date().toISOString().split('T')[0];
    const suppliers = db.prepare('SELECT id,name FROM suppliers ORDER BY name').all();
    const products = db.prepare("SELECT id,name,sku,price FROM products WHERE status='active' ORDER BY name").all();

    const csrfToken = c.get('session')?.csrfToken||'';
    const role = c.get('session')?.role||'';

    if (!suppliers.length) {
      const content = `
        <div class="ph"><h2>Nueva compra</h2><a href="/admin/purchases" class="btn btn-secondary">Volver</a></div>
        <div class="card card-body" style="text-align:center;padding:2rem;color:var(--muted)">
          No hay proveedores. <a href="/admin/suppliers">Crea uno primero.</a>
        </div>`;
      return c.html(adminLayout('Nueva compra', content, 'purchases', csrfToken, c));
    }

    const suppliersJson = JSON.stringify(suppliers);
    const productsJson = JSON.stringify(products);
    const supOptions = suppliers.map(s => '<option value="'+s.id+'">'+s.name+'</option>').join('');

    const content = `
      <div class="ph"><h2>Nueva compra</h2><a href="/admin/purchases" class="btn btn-secondary">Volver</a></div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Datos de la compra</h3></div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Proveedor *</label><select class="form-control" id="fSupplier">${supOptions}</select></div>
            <div class="form-group"><label class="form-label">Referencia</label><input class="form-control" id="fReference" placeholder="Nº albarán, factura..."></div>
            <div class="form-group"><label class="form-label">Fecha *</label><input class="form-control" type="date" id="fDate" value="${today}"></div>
            <div class="form-group"><label class="form-label">Estado</label>
              <select class="form-control" id="fStatus">
                <option value="received">Recibida</option>
                <option value="pending">Pendiente</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </div>
          </div>
          <div class="form-group"><label class="form-label">Notas</label><textarea class="form-control" id="fNotes"></textarea></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Líneas de compra</h3><button class="btn btn-secondary" onclick="addLine()">+ Añadir línea</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>Cantidad</th><th>Coste unitario</th><th>Subtotal</th><th></th></tr></thead>
          <tbody id="linesBody"></tbody>
        </table></div>
        <div class="card-body" style="text-align:right"><strong>Total: <span id="totalDisplay">0.00 ${sym}</span></strong></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem">
        <a href="/admin/purchases" class="btn btn-secondary">Cancelar</a>
        <button class="btn btn-primary" onclick="submitPurchase()">Registrar compra</button>
      </div>
      <script>
      var PRODUCTS=${productsJson};
      var lineCounter=0;
      // IDs de las líneas vivas (filas en el DOM), sin estado paralelo que se desincronice.
      function lineIds(){
        return Array.prototype.slice.call(document.querySelectorAll('#linesBody tr[id^="line-"]'))
          .map(function(tr){return parseInt(tr.id.replace('line-',''));});
      }
      function addLine(){
        lineCounter++;
        var id=lineCounter;
        var empty=document.getElementById('emptyRow');
        if(empty)empty.remove();
        var html='<tr id="line-'+id+'">'
          +'<td style="position:relative">'
            +'<input class="form-control" type="text" id="prodsearch-'+id+'" autocomplete="off" placeholder="Buscar producto..." oninput="onProdInput('+id+')" onfocus="onProdInput('+id+')" onblur="hideProdSuggest('+id+')" style="min-width:200px">'
            +'<input type="hidden" id="prod-'+id+'">'
            +'<div id="suggest-'+id+'" style="display:none;position:absolute;z-index:30;left:0;right:0;top:100%;background:var(--card,#1e1e1e);border:1px solid var(--border);border-radius:6px;max-height:240px;overflow:auto;box-shadow:0 6px 16px rgba(0,0,0,.25)"></div>'
          +'</td>'
          +'<td><input class="form-control" type="number" id="qty-'+id+'" min="1" value="1" style="width:80px" oninput="calcTotal()"></td>'
          +'<td><input class="form-control" type="number" id="cost-'+id+'" min="0" step="0.01" value="0.00" style="width:110px" oninput="calcTotal()"></td>'
          +'<td id="sub-'+id+'" style="font-weight:600">0.00 ${sym}</td>'
          +'<td><button class="btn btn-danger btn-sm" onclick="removeLine('+id+')">Eliminar</button></td>'
          +'</tr>';
        document.getElementById('linesBody').insertAdjacentHTML('beforeend',html);
        calcTotal();
      }
      function removeLine(id){
        var tr=document.getElementById('line-'+id);
        if(tr)tr.remove();
        if(!lineIds().length){
          document.getElementById('linesBody').innerHTML='<tr id="emptyRow"><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--muted)">Usa &ldquo;+ Añadir línea&rdquo; para agregar productos</td></tr>';
        }
        calcTotal();
      }
      // Buscador de producto: al teclear, ofrece coincidencias del catálogo (nombre o SKU).
      // En una compra la línea SIEMPRE es un producto del catálogo (mueve stock): no hay
      // línea libre; hasta elegir una sugerencia, prod-id queda vacío y la validación lo exige.
      function onProdInput(id){
        var box=document.getElementById('suggest-'+id);
        var q=(document.getElementById('prodsearch-'+id).value||'').trim().toLowerCase();
        document.getElementById('prod-'+id).value='';   // cambiar el texto invalida la selección previa
        if(!q){box.style.display='none';box.innerHTML='';return;}
        var matches=PRODUCTS.filter(function(p){
          return (p.name&&p.name.toLowerCase().indexOf(q)>=0)||(p.sku&&p.sku.toLowerCase().indexOf(q)>=0);
        }).slice(0,8);
        if(!matches.length){box.style.display='none';box.innerHTML='';return;}
        box.innerHTML=matches.map(function(p){
          return '<div style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid var(--border)" onmousedown="event.preventDefault();pickProd('+id+','+p.id+')">'
            +'<strong>'+escHtml(p.name)+'</strong>'
            +(p.sku?' <span style="color:var(--muted);font-size:.8rem">['+escHtml(p.sku)+']</span>':'')
            +' <span style="float:right;color:var(--muted)">'+Number(p.price||0).toFixed(2)+' ${sym}</span>'
            +'</div>';
        }).join('');
        box.style.display='';
      }
      function pickProd(lineId,prodId){
        var p=PRODUCTS.find(function(x){return x.id===prodId;});
        if(!p)return;
        document.getElementById('prod-'+lineId).value=prodId;
        document.getElementById('prodsearch-'+lineId).value=(p.sku?'['+p.sku+'] ':'')+p.name;
        document.getElementById('cost-'+lineId).value=Number(p.price||0).toFixed(2);
        var box=document.getElementById('suggest-'+lineId);
        if(box){box.style.display='none';box.innerHTML='';}
        calcTotal();
      }
      function hideProdSuggest(id){
        var box=document.getElementById('suggest-'+id);
        setTimeout(function(){box.style.display='none';},150);
      }
      function calcTotal(){
        var total=0;
        lineIds().forEach(function(id){
          var qtyEl=document.getElementById('qty-'+id);
          var costEl=document.getElementById('cost-'+id);
          var subEl=document.getElementById('sub-'+id);
          if(!qtyEl||!costEl)return;
          var qty=parseFloat(qtyEl.value)||0;
          var cost=parseFloat(costEl.value)||0;
          var sub=qty*cost;
          if(subEl)subEl.textContent=sub.toFixed(2)+' ${sym}';
          total+=sub;
        });
        document.getElementById('totalDisplay').textContent=total.toFixed(2)+' ${sym}';
      }
      async function submitPurchase(){
        var ids=lineIds();
        if(!ids.length){toast('Añade al menos una línea','err');return;}
        var items=ids.map(function(id){
          return{
            product_id:parseInt(document.getElementById('prod-'+id).value)||0,
            quantity:parseInt(document.getElementById('qty-'+id).value)||0,
            unit_cost:parseFloat(document.getElementById('cost-'+id).value)||0
          };
        });
        var invalid=items.filter(function(i){return !i.product_id||i.quantity<1;});
        if(invalid.length){toast('Revisa las líneas: busca y elige un producto del catálogo y la cantidad','err');return;}
        var body={
          supplier_id:parseInt(document.getElementById('fSupplier').value),
          reference:document.getElementById('fReference').value.trim(),
          date:document.getElementById('fDate').value,
          notes:document.getElementById('fNotes').value.trim(),
          status:document.getElementById('fStatus').value,
          items:items
        };
        if(!body.date){toast('La fecha es obligatoria','err');return;}
        try{
          var r=await api('POST','/api/erp/purchases',body);
          window.location.href='/admin/purchases/'+r.id;
        }catch(e){toast(e.message,'err');}
      }
      addLine();
      </script>`;
    return c.html(adminLayout('Nueva compra', content, 'purchases', csrfToken, c));
  });

  views.get('/:id', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const id = parseInt(c.req.param('id'));
    const purchase = db.prepare('SELECT p.*,s.name as supplier_name FROM purchases p JOIN suppliers s ON p.supplier_id=s.id WHERE p.id=?').get(id);
    if (!purchase) return c.redirect('/admin/purchases');
    const items = db.prepare('SELECT pi.*,pr.name as product_name,pr.sku FROM purchase_items pi JOIN products pr ON pi.product_id=pr.id WHERE pi.purchase_id=?').all(id);

    const statusMap = {pending:'Pendiente',received:'Recibida',cancelled:'Cancelada'};
    const badgeMap = {pending:'b-yellow',received:'b-green',cancelled:'b-red'};
    const statusLabel = statusMap[purchase.status] || purchase.status;
    const badge = badgeMap[purchase.status] || 'b-gray';

    const itemRows = items.map(i => {
      const skuTag = i.sku ? `<span style="color:var(--muted);font-size:.8rem">[${i.sku}]</span> ` : '';
      return `<tr><td>${skuTag}${i.product_name}</td><td>${i.quantity}</td><td>${parseFloat(i.unit_cost).toFixed(2)} ${sym}</td><td><strong>${(i.quantity*i.unit_cost).toFixed(2)} ${sym}</strong></td></tr>`;
    }).join('') || '<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin líneas</td></tr>';

    const refBlock = purchase.reference ? `<div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Referencia</span><br>${purchase.reference}</div>` : '';
    const notesBlock = purchase.notes ? `<div><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Notas</span><br>${purchase.notes}</div>` : '';

    const content = `
      <div class="ph"><h2>Compra #${purchase.id}</h2><a href="/admin/purchases" class="btn btn-secondary">Volver</a></div>
      <div class="grid g2" style="margin-bottom:1rem">
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Proveedor</span><br><strong>${purchase.supplier_name}</strong></div>
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Fecha</span><br>${purchase.date}</div>
          ${refBlock}
        </div>
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Estado</span><br><span class="badge ${badge}">${statusLabel}</span></div>
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Total</span><br><strong style="font-size:1.2rem">${parseFloat(purchase.total).toFixed(2)} ${sym}</strong></div>
          ${notesBlock}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Líneas de compra</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>Cantidad</th><th>Coste unitario</th><th>Subtotal</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table></div>
      </div>`;
    return c.html(adminLayout('Compra #'+purchase.id, content, 'purchases', c.get('session')?.csrfToken||'', c));
  });

  return { api, views };
}
