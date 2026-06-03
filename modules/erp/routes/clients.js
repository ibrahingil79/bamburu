import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { clientSchema, clientGroupSchema } from '../schemas.js';

export function createClientRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  // ── API: CLIENTS ───────────────────────────────────────────────
  api.get('/', requirePerm('clients.read'), c => {
    try {
      return c.json(db.prepare('SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id ORDER BY c.total_spent DESC').all());
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.get('/:id', requirePerm('clients.read'), c => {
    try {
      const client = db.prepare('SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id WHERE c.id=?').get(c.req.param('id'));
      if (!client) return c.json({error:'No encontrado'},404);
      client.orders = db.prepare('SELECT * FROM sales_orders WHERE client_id=? ORDER BY id DESC').all(client.id);
      return c.json(client);
    } catch(e) { return c.json({error:e.message},500); }
  });

  function syncNewsletter(db, email, name, accepts) {
    if (!email) return;
    if (accepts) {
      db.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email,name) VALUES (?,?)').run(email, name||'');
    } else {
      db.prepare('DELETE FROM newsletter_subscribers WHERE email=?').run(email);
    }
  }

  api.post('/', requirePerm('clients.create'), validate(clientSchema), async c => {
    try {
      const d = c.get('validated');
      if (!d.name) return c.json({error:'Nombre requerido'},400);
      const r = db.prepare('INSERT INTO clients (name,fiscal_id,email,phone,address,city,country,group_id,notes,accepts_newsletter) VALUES (?,?,?,?,?,?,?,?,?,?)').run(d.name, d.fiscal_id||'', d.email||'', d.phone||'', d.address||'', d.city||'', d.country||'', d.group_id||null, d.notes||'', d.accepts_newsletter?1:0);
      syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
      logActivity(db, c.get('session'), 'Creó cliente', 'client', r.lastInsertRowid, d.name);
      return c.json({id:r.lastInsertRowid, message:'Creado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id', requirePerm('clients.edit'), validate(clientSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE clients SET name=?,fiscal_id=?,email=?,phone=?,address=?,city=?,country=?,group_id=?,notes=?,accepts_newsletter=? WHERE id=?').run(d.name, d.fiscal_id||'', d.email||'', d.phone||'', d.address||'', d.city||'', d.country||'', d.group_id||null, d.notes||'', d.accepts_newsletter?1:0, c.req.param('id'));
      syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id', requirePerm('clients.edit'), c => {
    try {
      const cl = db.prepare('SELECT name FROM clients WHERE id=?').get(c.req.param('id'));
      db.prepare('DELETE FROM clients WHERE id=?').run(c.req.param('id'));
      logActivity(db, c.get('session'), 'Eliminó cliente', 'client', c.req.param('id'), cl?.name||'');
      return c.json({message:'Eliminado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.get('/:id/orders', requirePerm('clients.read'), c => {
    try {
      return c.json(db.prepare('SELECT * FROM sales_orders WHERE client_id=? ORDER BY id DESC').all(c.req.param('id')));
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: CLIENT GROUPS ─────────────────────────────────────────
  api.get('/groups/all', requirePerm('clients.read'), c => {
    try { return c.json(db.prepare('SELECT g.*, COUNT(c.id) as member_count FROM client_groups g LEFT JOIN clients c ON c.group_id=g.id GROUP BY g.id ORDER BY g.name').all()); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/groups/create', requirePerm('clients.create'), validate(clientGroupSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO client_groups (name,description,discount_pct) VALUES (?,?,?)').run(d.name, d.description||'', d.discount_pct||0);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/groups/:id', requirePerm('clients.edit'), validate(clientGroupSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE client_groups SET name=?,description=?,discount_pct=? WHERE id=?').run(d.name, d.description||'', d.discount_pct||0, c.req.param('id'));
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/groups/:id', requirePerm('clients.edit'), c => {
    try { db.prepare('DELETE FROM client_groups WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:e.message},500); }
  });

  // ── VIEWS ──────────────────────────────────────────────────────
  views.get('/', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph">
        <h2>Clientes</h2>
        <div style="display:flex;gap:.5rem">
          <input class="search" id="searchBox" placeholder="Buscar...">
          ${can(c, 'clients.create') ? '<button class="btn btn-primary" onclick="openNewClient()">Nuevo cliente</button>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Grupo</th><th>Total gastado</th><th>Registrado</th><th></th></tr></thead>
          <tbody id="clientBody"></tbody>
        </table></div>
      </div>

      <div class="modal-overlay" id="clientModal">
        <div class="modal" style="max-width:640px">
          <div class="modal-head"><h3 id="clientModalTitle">Nuevo Cliente</h3><button class="modal-close" onclick="closeModal('clientModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="clientId">
            <div class="form-row">
              <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="cName"></div>
              <div class="form-group"><label class="form-label">ID Fiscal</label><input class="form-control" id="cFiscal"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Email</label><input class="form-control" id="cEmail" type="email"></div>
              <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="cPhone"></div>
            </div>
            <div class="form-group"><label class="form-label">Dirección</label><input class="form-control" id="cAddress"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Ciudad</label><input class="form-control" id="cCity"></div>
              <div class="form-group"><label class="form-label">País</label><input class="form-control" id="cCountry"></div>
              <div class="form-group"><label class="form-label">Grupo</label><select class="form-control" id="cGroup"><option value="">Sin grupo</option></select></div>
            </div>
            <div class="form-group"><label class="form-label">Notas internas</label><textarea class="form-control" id="cNotes" rows="2"></textarea></div>
            <div class="form-group"><label class="form-label"><input type="checkbox" id="cNewsletter"> Acepta newsletter</label></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('clientModal')">Cancelar</button><button class="btn btn-primary" onclick="saveClient()">Guardar</button></div>
        </div>
      </div>

      <!-- Detail Modal -->
      <div class="modal-overlay" id="detailModal">
        <div class="modal" style="max-width:700px">
          <div class="modal-head"><h3 id="detailName">Detalle Cliente</h3><button class="modal-close" onclick="closeModal('detailModal')">✕</button></div>
          <div class="modal-body" id="detailBody"></div>
        </div>
      </div>

      <script>
      let clients=[], groups=[];
      async function loadAll(){
        [clients, groups]=await Promise.all([
          api('GET','/api/erp/clients').catch(()=>[]),
          api('GET','/api/erp/clients/groups/all').catch(()=>[])
        ]);
        const gSel=document.getElementById('cGroup');
        gSel.innerHTML='<option value="">Sin grupo</option>'+groups.map(g=>'<option value="'+g.id+'">'+g.name+(g.discount_pct>0?' (-'+g.discount_pct+'%)':'')+'</option>').join('');
        renderClients(clients);
      }
      function renderClients(list){
        const q=document.getElementById('searchBox').value.toLowerCase();
        const f=q?list.filter(c=>c.name.toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q)):list;
        document.getElementById('clientBody').innerHTML=f.length?f.map(c=>'<tr>'+
          '<td><strong>'+c.name+'</strong></td>'+
          '<td style="color:var(--muted)">'+(c.email||'-')+'</td>'+
          '<td style="color:var(--muted)">'+(c.phone||'-')+'</td>'+
          '<td>'+(c.group_name?'<span class="badge b-purple">'+c.group_name+'</span>':'-')+'</td>'+
          '<td><strong>${sym}'+Number(c.total_spent||0).toFixed(2)+'</strong></td>'+
          '<td style="color:var(--muted);font-size:.8rem">'+(c.created_at?.split(' ')[0]||'-')+'</td>'+
          '<td style="white-space:nowrap">'+
          '<button class="btn btn-secondary btn-sm" onclick="viewDetail('+c.id+')">Ver</button> '+
          (window.canDo('clients.edit')?'<button class="btn btn-secondary btn-sm" onclick="editClient('+c.id+')">Editar</button> ':'')+
          (window.canDo('clients.delete')?'<button class="btn btn-danger btn-sm" onclick="delClient('+c.id+')">Eliminar</button>':'')+
          '</td>'+
          '</tr>').join(''):'<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Sin clientes</td></tr>';
      }
      document.getElementById('searchBox').addEventListener('input',()=>renderClients(clients));
      function openNewClient(){
        document.getElementById('clientModalTitle').textContent='Nuevo Cliente';
        document.getElementById('clientId').value='';
        ['cName','cFiscal','cEmail','cPhone','cAddress','cCity','cCountry','cNotes'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('cGroup').value='';
        document.getElementById('cNewsletter').checked=false;
        openModal('clientModal');
      }
      function editClient(id){
        const c=clients.find(x=>x.id===id);if(!c)return;
        document.getElementById('clientModalTitle').textContent='Editar Cliente';
        document.getElementById('clientId').value=id;
        document.getElementById('cName').value=c.name;
        document.getElementById('cFiscal').value=c.fiscal_id||'';
        document.getElementById('cEmail').value=c.email||'';
        document.getElementById('cPhone').value=c.phone||'';
        document.getElementById('cAddress').value=c.address||'';
        document.getElementById('cCity').value=c.city||'';
        document.getElementById('cCountry').value=c.country||'';
        document.getElementById('cGroup').value=c.group_id||'';
        document.getElementById('cNotes').value=c.notes||'';
        document.getElementById('cNewsletter').checked=!!c.accepts_newsletter;
        openModal('clientModal');
      }
      async function saveClient(){
        const id=document.getElementById('clientId').value;
        const body={name:document.getElementById('cName').value,fiscal_id:document.getElementById('cFiscal').value,email:document.getElementById('cEmail').value,phone:document.getElementById('cPhone').value,address:document.getElementById('cAddress').value,city:document.getElementById('cCity').value,country:document.getElementById('cCountry').value,group_id:document.getElementById('cGroup').value||null,notes:document.getElementById('cNotes').value,accepts_newsletter:document.getElementById('cNewsletter').checked};
        try{if(id)await api('PUT','/api/erp/clients/'+id,body);else await api('POST','/api/erp/clients',body);closeModal('clientModal');toast(id?'Actualizado':'Creado');loadAll();}catch(e){toast(e.message,'err')}
      }
      async function delClient(id){if(!confirm('¿Eliminar cliente?'))return;await api('DELETE','/api/erp/clients/'+id);toast('Eliminado');loadAll();}
      async function viewDetail(id){
        const c=await api('GET','/api/erp/clients/'+id);
        document.getElementById('detailName').textContent=c.name;
        const ordRows=c.orders?.length?c.orders.map(o=>'<tr><td>'+o.order_number+'</td><td>${sym}'+Number(o.total||0).toFixed(2)+'</td><td><span class="badge b-gray">'+o.status+'</span></td><td style="color:var(--muted);font-size:.8rem">'+(o.created_at?.split(' ')[0]||'-')+'</td></tr>').join(''):'<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1rem">Sin pedidos</td></tr>';
        document.getElementById('detailBody').innerHTML=
          '<div class="grid g2" style="margin-bottom:1rem">'+
          '<div><div class="form-label">Email</div><div>'+escHtml(c.email||'-')+'</div></div>'+
          '<div><div class="form-label">Teléfono</div><div>'+escHtml(c.phone||'-')+'</div></div>'+
          '<div><div class="form-label">Dirección</div><div>'+escHtml(c.address||'-')+(c.city?' · '+escHtml(c.city):'')+'</div></div>'+
          '<div><div class="form-label">Total gastado</div><div style="color:#10b981;font-weight:700;font-size:1.2rem">${sym}'+Number(c.total_spent||0).toFixed(2)+'</div></div>'+
          '</div>'+
          (c.notes?'<div class="alert alert-ok" style="margin-bottom:1rem">'+c.notes+'</div>':'')+
          '<h4 style="margin-bottom:.75rem">Historial de pedidos</h4>'+
          '<div class="table-wrap"><table><thead><tr><th>Orden</th><th>Total</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>'+ordRows+'</tbody></table></div>';
        openModal('detailModal');
      }
      loadAll();
      </script>`;
    return c.html(adminLayout('Clientes', content, 'clients', c.get('session')?.csrfToken || '', c));
  });

  views.get('/groups', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Grupos de Clientes</h2><button class="btn btn-primary" onclick="openModal('groupModal')">Nuevo grupo</button></div>
      <div class="card">
        <div class="card-head"><h3>Lista de grupos</h3><input class="search" id="searchBox" placeholder="Buscar..." oninput="renderGroups()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Descripción</th><th>Descuento</th><th>Miembros</th><th></th></tr></thead>
          <tbody id="groupBody"></tbody>
        </table></div>
      </div>
      <div class="modal-overlay" id="groupModal">
        <div class="modal">
          <div class="modal-head"><h3 id="groupModalTitle">Nuevo Grupo</h3><button class="modal-close" onclick="closeModal('groupModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="groupId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="gName"></div>
            <div class="form-group"><label class="form-label">Descripción</label><input class="form-control" id="gDesc"></div>
            <div class="form-group"><label class="form-label">Descuento automático (%)</label><input class="form-control" type="number" id="gDiscount" min="0" max="100" value="0"></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('groupModal')">Cancelar</button><button class="btn btn-primary" onclick="saveGroup()">Guardar</button></div>
        </div>
      </div>
      <script>
      let groups=[];
      async function load(){
        groups=await api('GET','/api/erp/clients/groups/all').catch(()=>[]);
        renderGroups();
      }
      function renderGroups(){
        const q=(document.getElementById('searchBox').value||'').toLowerCase();
        const f=q?groups.filter(g=>(g.name||'').toLowerCase().includes(q)||(g.description||'').toLowerCase().includes(q)):groups;
        document.getElementById('groupBody').innerHTML=f.length?f.map(g=>'<tr><td><strong>'+g.name+'</strong></td><td style="color:var(--muted)">'+(g.description||'-')+'</td><td>'+(g.discount_pct>0?'<span class="badge b-green">-'+g.discount_pct+'%</span>':'-')+'</td><td><span class="badge b-blue">'+g.member_count+'</span></td><td><button class="btn btn-secondary btn-sm" onclick="editGroup('+g.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="delGroup('+g.id+')">Eliminar</button></td></tr>').join(''):'<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--muted)">'+(q?'Sin coincidencias':'Sin grupos')+'</td></tr>';
      }
      function editGroup(id){const g=groups.find(x=>x.id===id);if(!g)return;document.getElementById('groupModalTitle').textContent='Editar Grupo';document.getElementById('groupId').value=id;document.getElementById('gName').value=g.name;document.getElementById('gDesc').value=g.description||'';document.getElementById('gDiscount').value=g.discount_pct||0;openModal('groupModal');}
      async function saveGroup(){
        const id=document.getElementById('groupId').value;
        const body={name:document.getElementById('gName').value,description:document.getElementById('gDesc').value,discount_pct:parseFloat(document.getElementById('gDiscount').value)||0};
        try{if(id)await api('PUT','/api/erp/clients/groups/'+id,body);else await api('POST','/api/erp/clients/groups/create',body);closeModal('groupModal');document.getElementById('groupId').value='';toast('Guardado');load();}catch(e){toast(e.message,'err')}
      }
      async function delGroup(id){if(!confirm('¿Eliminar?'))return;await api('DELETE','/api/erp/clients/groups/'+id);toast('Eliminado');load();}
      load();
      </script>`;
    return c.html(adminLayout('Grupos de Clientes', content, 'client-groups', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
