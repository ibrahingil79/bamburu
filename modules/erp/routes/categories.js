import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { categorySchema } from '../schemas.js';

export function createCategoryRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  api.get('/', requirePerm('categories.read'), c => {
    try { return c.json(db.prepare('SELECT c.*, COUNT(p.id) as product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.name').all()); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/', requirePerm('categories.create'), validate(categorySchema), async c => {
    try {
      const d = c.get('validated');
      if (!d.name) return c.json({error:'Nombre requerido'},400);
      const r = db.prepare('INSERT INTO categories (name,description) VALUES (?,?)').run(d.name.trim(), d.description||'');
      return c.json({id:r.lastInsertRowid, message:'Creada'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id', requirePerm('categories.edit'), validate(categorySchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE categories SET name=?,description=? WHERE id=?').run(d.name, d.description||'', c.req.param('id'));
      return c.json({message:'Actualizada'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id', requirePerm('categories.delete'), c => {
    try { db.prepare('DELETE FROM categories WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminada'}); }
    catch(e) { return c.json({error:e.message},500); }
  });

  views.get('/', c => {
    const content = `
      <div class="ph"><h2>Categorías</h2>${can(c,'categories.create')?'<button class="btn btn-primary" onclick="openModal(\'catModal\')">Nueva categoría</button>':''}</div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Descripción</th><th>Productos</th><th></th></tr></thead>
          <tbody id="catBody"><tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr></tbody>
        </table></div>
      </div>

      <div class="modal-overlay" id="catModal">
        <div class="modal">
          <div class="modal-head"><h3 id="catModalTitle">Nueva Categoría</h3><button class="modal-close" onclick="closeModal('catModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="catId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="catName"></div>
            <div class="form-group"><label class="form-label">Descripción</label><textarea class="form-control" id="catDesc" rows="2"></textarea></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('catModal')">Cancelar</button><button class="btn btn-primary" onclick="saveCat()">Guardar</button></div>
        </div>
      </div>

      <script>
      let cats=[];
      async function loadCats(){
        cats=await api('GET','/api/erp/categories').catch(()=>[]);
        document.getElementById('catBody').innerHTML=cats.length?cats.map(c=>'<tr><td><strong>'+c.name+'</strong></td><td style="color:var(--muted);font-size:.85rem">'+(c.description||'-')+'</td><td><span class="badge b-blue">'+c.product_count+'</span></td><td>'+(window.canDo('categories.edit')?'<button class="btn btn-secondary btn-sm" onclick="editCat('+c.id+')">Editar</button> ':'')+( window.canDo('categories.delete')?'<button class="btn btn-danger btn-sm" onclick="delCat('+c.id+')">Eliminar</button>':'')+'</td></tr>').join(''):'<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin categorías</td></tr>';
      }
      function editCat(id){const c=cats.find(x=>x.id===id);if(!c)return;document.getElementById('catModalTitle').textContent='Editar Categoría';document.getElementById('catId').value=id;document.getElementById('catName').value=c.name;document.getElementById('catDesc').value=c.description||'';openModal('catModal');}
      async function saveCat(){
        const id=document.getElementById('catId').value;
        const body={name:document.getElementById('catName').value,description:document.getElementById('catDesc').value};
        try{if(id)await api('PUT','/api/erp/categories/'+id,body);else await api('POST','/api/erp/categories',body);closeModal('catModal');document.getElementById('catId').value='';document.getElementById('catModalTitle').textContent='Nueva Categoría';toast(id?'Actualizada':'Creada');loadCats();}catch(e){toast(e.message,'err')}
      }
      async function delCat(id){if(!confirm('¿Eliminar? Los productos quedarán sin categoría.'))return;await api('DELETE','/api/erp/categories/'+id);toast('Eliminada');loadCats();}
      loadCats();
      </script>`;
    return c.html(adminLayout('Categorías', content, 'categories', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
