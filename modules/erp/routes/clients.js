import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { escHtml } from '../../../core/escape.js';
import { clientSchema, clientGroupSchema } from '../schemas.js';

// Comprobación reutilizable de NIF duplicado (regla de integridad — sin duplicados).
// Devuelve el cliente ACTIVO en conflicto (otro id con el mismo fiscal_id normalizado)
// o null. fiscal_id vacío nunca bloquea (puede haber varios clientes sin NIF). En
// edición, excludeId excluye al propio cliente. La usan la API (POST/PUT) y DISA.
export function fiscalIdConflict(db, fiscalId, excludeId = null) {
  const norm = String(fiscalId || '').trim().toUpperCase();
  if (!norm) return null;
  const ex = Number(excludeId);
  return db.prepare(
    'SELECT id, name FROM clients WHERE active=1 AND UPPER(TRIM(fiscal_id))=? AND id<>?'
  ).get(norm, Number.isFinite(ex) ? ex : -1) || null;
}

export function createClientRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  // ── API: CLIENTS ───────────────────────────────────────────────
  api.get('/', requirePerm('clients.read'), c => {
    try {
      return c.json(db.prepare('SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id WHERE c.active=1 ORDER BY c.total_spent DESC').all());
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
      if (fiscalIdConflict(db, d.fiscal_id)) return c.json({error:'Ya existe un cliente con ese NIF'},409);
      const irpf = d.client_type === 'empresa' ? (d.irpf_rate||0) : 0;   // T3: el particular nunca lleva retención
      const r = db.prepare('INSERT INTO clients (name,fiscal_id,email,phone,address,city,country,group_id,notes,accepts_newsletter,client_type,irpf_rate,payment_term_days,payment_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(d.name, d.fiscal_id||'', d.email||'', d.phone||'', d.address||'', d.city||'', d.country||'', d.group_id||null, d.notes||'', d.accepts_newsletter?1:0, d.client_type||'particular', irpf, d.payment_term_days||0, d.payment_method||'');
      syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
      logActivity(db, c.get('session'), 'Creó cliente', 'client', r.lastInsertRowid, d.name);
      return c.json({id:r.lastInsertRowid, message:'Creado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id', requirePerm('clients.edit'), validate(clientSchema), async c => {
    try {
      const d = c.get('validated');
      if (fiscalIdConflict(db, d.fiscal_id, c.req.param('id'))) return c.json({error:'Ya existe un cliente con ese NIF'},409);
      const irpf = d.client_type === 'empresa' ? (d.irpf_rate||0) : 0;   // T3: el particular nunca lleva retención
      db.prepare('UPDATE clients SET name=?,fiscal_id=?,email=?,phone=?,address=?,city=?,country=?,group_id=?,notes=?,accepts_newsletter=?,client_type=?,irpf_rate=?,payment_term_days=?,payment_method=? WHERE id=?').run(d.name, d.fiscal_id||'', d.email||'', d.phone||'', d.address||'', d.city||'', d.country||'', d.group_id||null, d.notes||'', d.accepts_newsletter?1:0, d.client_type||'particular', irpf, d.payment_term_days||0, d.payment_method||'', c.req.param('id'));
      syncNewsletter(db, d.email, d.name, d.accepts_newsletter);
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id', requirePerm('clients.edit'), c => {
    try {
      const cl = db.prepare('SELECT name FROM clients WHERE id=?').get(c.req.param('id'));
      // Archivar, no borrar (regla permanente). Soft-delete: la fila se conserva y su
      // cuenta de tienda (customer_accounts) no se arrastra por ON DELETE CASCADE.
      db.prepare('UPDATE clients SET active=0 WHERE id=?').run(c.req.param('id'));
      logActivity(db, c.get('session'), 'Archivó cliente', 'client', c.req.param('id'), cl?.name||'');
      return c.json({message:'Archivado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.get('/:id/orders', requirePerm('clients.read'), c => {
    try {
      return c.json(db.prepare('SELECT * FROM sales_orders WHERE client_id=? ORDER BY id DESC').all(c.req.param('id')));
    } catch(e) { return c.json({error:e.message},500); }
  });

  // Restaurar un cliente archivado (inverso de archivar, T1). Guarda: archivar libera
  // el NIF, así que restaurar puede chocar con otro cliente activo que lo tenga — se
  // bloquea reutilizando el helper de NIF único (CANON §5, sin duplicados).
  api.post('/:id/restore', requirePerm('clients.edit'), c => {
    try {
      const id = c.req.param('id');
      const cl = db.prepare('SELECT id, name, fiscal_id FROM clients WHERE id=?').get(id);
      if (!cl) return c.json({error:'No encontrado'},404);
      if (fiscalIdConflict(db, cl.fiscal_id, id)) return c.json({error:'Ya existe un cliente activo con este NIF'},409);
      db.prepare('UPDATE clients SET active=1 WHERE id=?').run(id);
      logActivity(db, c.get('session'), 'Restauró cliente', 'client', id, cl.name||'');
      return c.json({message:'Restaurado'});
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

    // T2: búsqueda (nombre/NIF), filtro por estado (activos/archivados) y paginación, todo por URL (GET).
    const q = (c.req.query('q') || '').trim();
    const verArchivados = c.req.query('archivados') === '1';
    const activeVal = verArchivados ? 0 : 1;
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    // WHERE: estado + búsqueda parcial (LIKE %q% sobre nombre y NIF, insensible a mayúsculas en ASCII).
    const where = ['c.active = ?'];
    const params = [activeVal];
    if (q) { where.push('(c.name LIKE ? OR c.fiscal_id LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    // COUNT aparte para el total de páginas; SELECT con LIMIT/OFFSET para la página actual.
    const total = db.prepare('SELECT COUNT(*) AS n FROM clients c ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const clientsList = db.prepare(
      'SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id '
      + whereSql + ' ORDER BY c.name LIMIT ? OFFSET ?'
    ).all(...params, perPage, offset);

    // Opciones de grupo para el modal (server-render, sin fetch en cliente).
    const groupOptions = db.prepare('SELECT id, name FROM client_groups ORDER BY name').all()
      .map(g => '<option value="' + g.id + '">' + escHtml(g.name) + '</option>').join('');

    // Conserva q y archivados al cambiar de página.
    const buildQs = (p) => {
      const u = new URLSearchParams();
      if (q) u.set('q', q);
      if (verArchivados) u.set('archivados', '1');
      u.set('page', String(p));
      return u.toString();
    };

    const rowsHtml = clientsList.map(cl => '<tr>'+
      '<td><strong>'+escHtml(cl.name)+'</strong>'+(cl.fiscal_id?'<br><span style="color:var(--muted);font-size:.75rem">'+escHtml(cl.fiscal_id)+'</span>':'')+'</td>'+
      '<td style="color:var(--muted)">'+escHtml(cl.email||'-')+'</td>'+
      '<td style="color:var(--muted)">'+escHtml(cl.phone||'-')+'</td>'+
      '<td>'+(cl.group_name?'<span class="badge b-purple">'+escHtml(cl.group_name)+'</span>':'-')+'</td>'+
      '<td style="color:var(--muted);font-size:.8rem">'+((cl.created_at||'').split(' ')[0]||'-')+'</td>'+
      '<td style="white-space:nowrap">'+
        '<button class="btn btn-secondary btn-sm" onclick="viewDetail('+cl.id+')">Ver</button> '+
        (verArchivados
          ? (can(c,'clients.edit')?'<button class="btn btn-primary btn-sm" onclick="restoreClient('+cl.id+')">Restaurar</button>':'')
          : (can(c,'clients.edit')?'<button class="btn btn-secondary btn-sm" onclick="editClient('+cl.id+')">Editar</button> ':'')+
            (can(c,'clients.delete')?'<button class="btn btn-danger btn-sm" onclick="delClient('+cl.id+')">Archivar</button>':''))+
      '</td>'+
      '</tr>').join('');

    const content = `
      <div class="ph">
        <h2>Clientes</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${escHtml(q)}" placeholder="Buscar por nombre o NIF...">
          <select class="form-control" name="archivados" style="width:auto;min-width:150px" onchange="this.form.submit()">
            <option value=""${verArchivados ? '' : ' selected'}>Activos</option>
            <option value="1"${verArchivados ? ' selected' : ''}>Archivados</option>
          </select>
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'clients.create') ? '<button type="button" class="btn btn-primary" onclick="openNewClient()">Nuevo cliente</button>' : ''}
        </form>
      </div>

      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Grupo</th><th>Registrado</th><th></th></tr></thead>
          <tbody>${total === 0 ? '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">No se encontraron clientes</td></tr>' : rowsHtml}</tbody>
        </table></div>
      </div>

      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--muted);font-size:.85rem">Página ${page} de ${totalPages} · ${total} cliente${total === 1 ? '' : 's'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div>
      </div>` : ''}

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
              <div class="form-group"><label class="form-label">Grupo</label><select class="form-control" id="cGroup"><option value="">Sin grupo</option>${groupOptions}</select></div>
            </div>
            <hr style="margin:1rem 0;border:none;border-top:1px solid var(--border)">
            <h4 style="font-size:.85rem;font-weight:600;margin:.25rem 0 .75rem">Gestión / Datos fiscales</h4>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Tipo de cliente</label>
                <select class="form-control" id="cType" onchange="toggleIrpf()">
                  <option value="particular">Particular</option>
                  <option value="empresa">Empresa o profesional</option>
                </select>
              </div>
              <div class="form-group" id="cIrpfWrap"><label class="form-label">% IRPF por defecto</label>
                <input class="form-control" id="cIrpf" type="number" min="0" max="100" step="0.01" value="0">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Plazo de pago (días)</label>
                <input class="form-control" id="cTermDays" type="number" min="0" step="1" value="0">
              </div>
              <div class="form-group"><label class="form-label">Forma de pago preferida</label>
                <select class="form-control" id="cPayMethod">
                  <option value="">— Sin especificar —</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="domiciliacion">Domiciliación</option>
                </select>
              </div>
            </div>
            <div class="form-group"><label class="form-label">Notas internas</label><textarea class="form-control" id="cNotes" rows="2"></textarea></div>
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
      let currentClient=null;   // cliente en edición (conserva accepts_newsletter sin tocar la API)
      // T3: el % IRPF solo aplica a empresa/profesional; en particular se oculta y se fuerza a 0.
      function toggleIrpf(){
        const empresa=document.getElementById('cType').value==='empresa';
        document.getElementById('cIrpfWrap').style.display=empresa?'':'none';
        if(!empresa)document.getElementById('cIrpf').value=0;
      }
      function openNewClient(){
        currentClient=null;
        document.getElementById('clientModalTitle').textContent='Nuevo Cliente';
        document.getElementById('clientId').value='';
        ['cName','cFiscal','cEmail','cPhone','cAddress','cCity','cCountry','cNotes'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('cGroup').value='';
        document.getElementById('cType').value='particular';
        document.getElementById('cIrpf').value=0;
        document.getElementById('cTermDays').value=0;
        document.getElementById('cPayMethod').value='';
        toggleIrpf();
        openModal('clientModal');
      }
      async function editClient(id){
        const c=await api('GET','/api/erp/clients/'+id);
        currentClient=c;
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
        document.getElementById('cType').value=c.client_type||'particular';
        document.getElementById('cIrpf').value=Number(c.irpf_rate||0);
        document.getElementById('cTermDays').value=Number(c.payment_term_days||0);
        document.getElementById('cPayMethod').value=c.payment_method||'';
        toggleIrpf();
        openModal('clientModal');
      }
      async function saveClient(){
        const id=document.getElementById('clientId').value;
        const body={name:document.getElementById('cName').value,fiscal_id:document.getElementById('cFiscal').value,email:document.getElementById('cEmail').value,phone:document.getElementById('cPhone').value,address:document.getElementById('cAddress').value,city:document.getElementById('cCity').value,country:document.getElementById('cCountry').value,group_id:document.getElementById('cGroup').value||null,notes:document.getElementById('cNotes').value,accepts_newsletter: id ? !!(currentClient&&currentClient.accepts_newsletter) : false,client_type:document.getElementById('cType').value,irpf_rate:parseFloat(document.getElementById('cIrpf').value)||0,payment_term_days:parseInt(document.getElementById('cTermDays').value)||0,payment_method:document.getElementById('cPayMethod').value};
        try{if(id)await api('PUT','/api/erp/clients/'+id,body);else await api('POST','/api/erp/clients',body);closeModal('clientModal');toast(id?'Actualizado':'Creado');location.reload();}catch(e){toast(e.message,'err')}
      }
      async function delClient(id){if(!confirm('¿Archivar este cliente? Dejará de aparecer en la lista, pero no se borra.'))return;try{await api('DELETE','/api/erp/clients/'+id);toast('Archivado');location.reload();}catch(e){toast(e.message,'err')}}
      async function restoreClient(id){try{await api('POST','/api/erp/clients/'+id+'/restore');toast('Restaurado');location.reload();}catch(e){toast(e.message,'err')}}
      async function viewDetail(id){
        const c=await api('GET','/api/erp/clients/'+id);
        document.getElementById('detailName').textContent=c.name;
        const ordRows=c.orders?.length?c.orders.map(o=>'<tr><td>'+o.order_number+'</td><td>${sym}'+Number(o.total||0).toFixed(2)+'</td><td><span class="badge b-gray">'+o.status+'</span></td><td style="color:var(--muted);font-size:.8rem">'+(o.created_at?.split(' ')[0]||'-')+'</td></tr>').join(''):'<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1rem">Sin pedidos</td></tr>';
        document.getElementById('detailBody').innerHTML=
          '<div class="grid g2" style="margin-bottom:1rem">'+
          '<div><div class="form-label">Email</div><div>'+escHtml(c.email||'-')+'</div></div>'+
          '<div><div class="form-label">Teléfono</div><div>'+escHtml(c.phone||'-')+'</div></div>'+
          '<div><div class="form-label">Dirección</div><div>'+escHtml(c.address||'-')+(c.city?' · '+escHtml(c.city):'')+'</div></div>'+
          '<div><div class="form-label">NIF</div><div>'+escHtml(c.fiscal_id||'-')+'</div></div>'+
          '<div><div class="form-label">Tipo de cliente</div><div>'+(c.client_type==='empresa'?'Empresa o profesional':'Particular')+'</div></div>'+
          (c.client_type==='empresa'?'<div><div class="form-label">% IRPF por defecto</div><div>'+Number(c.irpf_rate||0)+'%</div></div>':'')+
          '<div><div class="form-label">Plazo de pago</div><div>'+(Number(c.payment_term_days||0)>0?Number(c.payment_term_days)+' días':'Contado')+'</div></div>'+
          '<div><div class="form-label">Forma de pago</div><div>'+({transferencia:"Transferencia",efectivo:"Efectivo",tarjeta:"Tarjeta",domiciliacion:"Domiciliación"}[c.payment_method]||'—')+'</div></div>'+
          '</div>'+
          (c.notes?'<div class="alert alert-ok" style="margin-bottom:1rem">'+c.notes+'</div>':'')+
          '<h4 style="margin-bottom:.75rem">Historial de pedidos</h4>'+
          '<div class="table-wrap"><table><thead><tr><th>Orden</th><th>Total</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>'+ordRows+'</tbody></table></div>';
        openModal('detailModal');
      }
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
          <thead><tr><th>Nombre</th><th>Descripción</th><th>Miembros</th><th></th></tr></thead>
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
        document.getElementById('groupBody').innerHTML=f.length?f.map(g=>'<tr><td><strong>'+g.name+'</strong></td><td style="color:var(--muted)">'+(g.description||'-')+'</td><td><span class="badge b-blue">'+g.member_count+'</span></td><td><button class="btn btn-secondary btn-sm" onclick="editGroup('+g.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="delGroup('+g.id+')">Eliminar</button></td></tr>').join(''):'<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--muted)">'+(q?'Sin coincidencias':'Sin grupos')+'</td></tr>';
      }
      function editGroup(id){const g=groups.find(x=>x.id===id);if(!g)return;document.getElementById('groupModalTitle').textContent='Editar Grupo';document.getElementById('groupId').value=id;document.getElementById('gName').value=g.name;document.getElementById('gDesc').value=g.description||'';openModal('groupModal');}
      async function saveGroup(){
        const id=document.getElementById('groupId').value;
        const body={name:document.getElementById('gName').value,description:document.getElementById('gDesc').value,discount_pct: id ? ((groups.find(x=>x.id===+id)||{}).discount_pct||0) : 0};
        try{if(id)await api('PUT','/api/erp/clients/groups/'+id,body);else await api('POST','/api/erp/clients/groups/create',body);closeModal('groupModal');document.getElementById('groupId').value='';toast('Guardado');load();}catch(e){toast(e.message,'err')}
      }
      async function delGroup(id){if(!confirm('¿Eliminar?'))return;await api('DELETE','/api/erp/clients/groups/'+id);toast('Eliminado');load();}
      load();
      </script>`;
    return c.html(adminLayout('Grupos de Clientes', content, 'client-groups', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
