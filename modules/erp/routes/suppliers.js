import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { validate } from '../../../core/validate.js';
import { supplierSchema } from '../schemas.js';

export function createSupplierRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  api.get('/', c => {
    try {
      return c.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all());
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/', validate(supplierSchema), c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO suppliers (name,contact,email,phone,notes) VALUES (?,?,?,?,?)').run(d.name, d.contact||'', d.email||'', d.phone||'', d.notes||'');
      return c.json({id:r.lastInsertRowid, message:'Proveedor creado'}, 201);
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id', validate(supplierSchema), c => {
    try {
      const d = c.get('validated');
      const id = parseInt(c.req.param('id'));
      const info = db.prepare('UPDATE suppliers SET name=?,contact=?,email=?,phone=?,notes=? WHERE id=?').run(d.name, d.contact||'', d.email||'', d.phone||'', d.notes||'', id);
      if (!info.changes) return c.json({error:'No encontrado'},404);
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id', c => {
    try {
      const id = parseInt(c.req.param('id'));
      const count = db.prepare('SELECT COUNT(*) as c FROM purchases WHERE supplier_id=?').get(id).c;
      if (count > 0) return c.json({error:'No se puede eliminar: tiene compras asociadas'},400);
      db.prepare('DELETE FROM suppliers WHERE id=?').run(id);
      return c.json({message:'Eliminado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  views.get('/', c => {
    const content = `
      <div class="ph"><h2>Proveedores</h2>${can(c,'suppliers.create')?'<button class="btn btn-primary" id="btnNew">Nuevo proveedor</button>':''}</div>
      <div class="card">
        <div class="card-head"><h3>Lista de proveedores</h3><input class="search" id="searchBox" placeholder="Buscar..." oninput="filterTable()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Contacto</th><th>Email</th><th>Teléfono</th><th></th></tr></thead>
          <tbody id="supBody"></tbody>
        </table></div>
      </div>

      <div class="modal-overlay" id="supModal">
        <div class="modal">
          <div class="modal-head"><h3 id="modalTitle">Nuevo proveedor</h3><button class="modal-close" onclick="closeModal('supModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="supId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="supName"></div>
            <div class="form-group"><label class="form-label">Persona de contacto</label><input class="form-control" id="supContact"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Email</label><input class="form-control" id="supEmail" type="email"></div>
              <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="supPhone"></div>
            </div>
            <div class="form-group"><label class="form-label">Notas</label><textarea class="form-control" id="supNotes"></textarea></div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" onclick="closeModal('supModal')">Cancelar</button>
            <button class="btn btn-primary" onclick="saveSup()">Guardar</button>
          </div>
        </div>
      </div>

      <script>
      var sups=[];
      var _btnNew=document.getElementById('btnNew'); if(_btnNew) _btnNew.onclick=function(){openNew();};
      async function loadSups(){
        sups=await api('GET','/api/erp/suppliers').catch(function(){return[];});
        filterTable();
      }
      function filterTable(){
        var q=document.getElementById('searchBox').value.toLowerCase();
        var f=q?sups.filter(function(s){return s.name.toLowerCase().includes(q)||(s.email||'').toLowerCase().includes(q);}):sups;
        document.getElementById('supBody').innerHTML=f.length?f.map(function(s){
          return '<tr><td><strong>'+escHtml(s.name)+'</strong></td><td>'+escHtml(s.contact||'-')+'</td><td>'+escHtml(s.email||'-')+'</td><td>'+escHtml(s.phone||'-')+'</td><td style="text-align:right">'+(window.canDo('suppliers.edit')?'<button class="btn btn-secondary btn-sm" onclick="editSup('+s.id+')">Editar</button> ':'')+( window.canDo('suppliers.delete')?'<button class="btn btn-danger btn-sm" onclick="delSup('+s.id+')">Eliminar</button>':'')+'</td></tr>';
        }).join(''):'<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Sin proveedores registrados</td></tr>';
      }
      function openNew(){
        document.getElementById('supId').value='';
        document.getElementById('supName').value='';
        document.getElementById('supContact').value='';
        document.getElementById('supEmail').value='';
        document.getElementById('supPhone').value='';
        document.getElementById('supNotes').value='';
        document.getElementById('modalTitle').textContent='Nuevo proveedor';
        openModal('supModal');
      }
      function editSup(id){
        var s=sups.find(function(x){return x.id===id;});
        if(!s)return;
        document.getElementById('supId').value=s.id;
        document.getElementById('supName').value=s.name;
        document.getElementById('supContact').value=s.contact||'';
        document.getElementById('supEmail').value=s.email||'';
        document.getElementById('supPhone').value=s.phone||'';
        document.getElementById('supNotes').value=s.notes||'';
        document.getElementById('modalTitle').textContent='Editar proveedor';
        openModal('supModal');
      }
      async function saveSup(){
        var id=document.getElementById('supId').value;
        var body={
          name:document.getElementById('supName').value.trim(),
          contact:document.getElementById('supContact').value.trim(),
          email:document.getElementById('supEmail').value.trim(),
          phone:document.getElementById('supPhone').value.trim(),
          notes:document.getElementById('supNotes').value.trim()
        };
        if(!body.name){toast('El nombre es obligatorio','err');return;}
        try{
          if(id){await api('PUT','/api/erp/suppliers/'+id,body);}
          else{await api('POST','/api/erp/suppliers',body);}
          closeModal('supModal');
          toast('Proveedor guardado');
          loadSups();
        }catch(e){toast(e.message,'err');}
      }
      async function delSup(id){
        if(!confirm('¿Eliminar este proveedor?'))return;
        try{await api('DELETE','/api/erp/suppliers/'+id);toast('Eliminado');loadSups();}
        catch(e){toast(e.message,'err');}
      }
      loadSups();
      </script>`;
    return c.html(adminLayout('Proveedores', content, 'suppliers', c.get('session')?.csrfToken||'', c));
  });

  return { api, views };
}
