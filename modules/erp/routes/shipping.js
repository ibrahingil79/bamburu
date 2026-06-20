import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { shippingSchema } from '../schemas.js';

export function createShippingRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  api.get('/', requirePerm('shipping.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM shipping_methods ORDER BY price').all()); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/', requirePerm('shipping.create'), validate(shippingSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO shipping_methods (name,description,price,free_from,estimated_days,active) VALUES (?,?,?,?,?,?)').run(d.name, d.description||'', d.price||0, d.free_from||null, d.estimated_days||'', d.active?1:0);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id', requirePerm('shipping.update'), validate(shippingSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE shipping_methods SET name=?,description=?,price=?,free_from=?,estimated_days=?,active=? WHERE id=?').run(d.name, d.description||'', d.price||0, d.free_from||null, d.estimated_days||'', d.active?1:0, c.req.param('id'));
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id', requirePerm('shipping.delete'), c => {
    try { db.prepare('DELETE FROM shipping_methods WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:e.message},500); }
  });

  views.get('/', requirePerm('shipping.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Métodos de Envío</h2><button class="btn btn-primary" onclick="openModal('shipModal')">Nuevo método</button></div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Descripción</th><th>Precio</th><th>Gratis desde</th><th>Plazo</th><th>Estado</th><th></th></tr></thead>
          <tbody id="shipBody"></tbody>
        </table></div>
      </div>

      <div class="modal-overlay" id="shipModal">
        <div class="modal">
          <div class="modal-head"><h3 id="shipModalTitle">Nuevo Método de Envío</h3><button class="modal-close" onclick="closeModal('shipModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="shipId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="sName" placeholder="Ej: Envío estándar"></div>
            <div class="form-group"><label class="form-label">Descripción</label><input class="form-control" id="sDesc" placeholder="Descripción visible en la tienda"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Precio (${sym})</label><input class="form-control" type="number" id="sPrice" min="0" step="0.01" value="0"></div>
              <div class="form-group"><label class="form-label">Gratis desde (${sym}, vacío = nunca)</label><input class="form-control" type="number" id="sFree" step="0.01" placeholder="Ej: 50"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Plazo estimado</label><input class="form-control" id="sDays" placeholder="Ej: 2-3 días hábiles"></div>
              <div class="form-group"><label class="form-label"><br><input type="checkbox" id="sActive" checked> Activo</label></div>
            </div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('shipModal')">Cancelar</button><button class="btn btn-primary" onclick="saveShip()">Guardar</button></div>
        </div>
      </div>

      <script>
      let ships=[];
      async function load(){
        ships=await api('GET','/api/erp/shipping').catch(()=>[]);
        document.getElementById('shipBody').innerHTML=ships.length?ships.map(s=>'<tr>'+
          '<td><strong>'+s.name+'</strong></td>'+
          '<td style="color:var(--muted)">'+(s.description||'-')+'</td>'+
          '<td>'+(s.price===0?'<span class="badge b-green">Gratis</span>':'${sym}'+Number(s.price).toFixed(2))+'</td>'+
          '<td>'+(s.free_from?'${sym}'+Number(s.free_from).toFixed(2):'-')+'</td>'+
          '<td style="color:var(--muted)">'+(s.estimated_days||'-')+'</td>'+
          '<td>'+(s.active?'<span class="badge b-green">Activo</span>':'<span class="badge b-red">Inactivo</span>')+'</td>'+
          '<td><button class="btn btn-secondary btn-sm" onclick="editShip('+s.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="delShip('+s.id+')">Eliminar</button></td></tr>').join(''):'<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin métodos de envío</td></tr>';
      }
      function editShip(id){
        const s=ships.find(x=>x.id===id);if(!s)return;
        document.getElementById('shipModalTitle').textContent='Editar Método';
        document.getElementById('shipId').value=id;
        document.getElementById('sName').value=s.name;
        document.getElementById('sDesc').value=s.description||'';
        document.getElementById('sPrice').value=s.price||0;
        document.getElementById('sFree').value=s.free_from||'';
        document.getElementById('sDays').value=s.estimated_days||'';
        document.getElementById('sActive').checked=!!s.active;
        openModal('shipModal');
      }
      async function saveShip(){
        const id=document.getElementById('shipId').value;
        const body={name:document.getElementById('sName').value,description:document.getElementById('sDesc').value,price:parseFloat(document.getElementById('sPrice').value)||0,free_from:parseFloat(document.getElementById('sFree').value)||null,estimated_days:document.getElementById('sDays').value,active:document.getElementById('sActive').checked};
        try{if(id)await api('PUT','/api/erp/shipping/'+id,body);else await api('POST','/api/erp/shipping',body);closeModal('shipModal');document.getElementById('shipId').value='';document.getElementById('shipModalTitle').textContent='Nuevo Método de Envío';toast('Guardado');load();}catch(e){toast(e.message,'err')}
      }
      async function delShip(id){if(!confirm('¿Eliminar?'))return;await api('DELETE','/api/erp/shipping/'+id);toast('Eliminado');load();}
      load();
      </script>`;
    return c.html(adminLayout('Métodos de Envío', content, 'shipping', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
