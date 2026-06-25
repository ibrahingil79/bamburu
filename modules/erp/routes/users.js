import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { hashPassword, requirePerm } from '../../../core/auth.js';
import { readFileSync } from 'fs';
import path from 'path';
import { validate } from '../../../core/validate.js';
import { userCreateSchema, userUpdateSchema } from '../schemas.js';

export function createUserRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const activityViews = new Hono();

  const PROTECTED_ROLES = ['owner', 'admin'];

  // ── API: ADMIN USERS ───────────────────────────────────────────
  api.get('/', requirePerm('admin.manage_users'), c => {
    try { return c.json(db.prepare('SELECT id,name,email,role,active,created_at FROM admin_users ORDER BY id').all()); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/', requirePerm('admin.manage_users'), validate(userCreateSchema), async c => {
    try {
      const s = c.get('session');
      const d = c.get('validated');
      if (!d.email || !d.password) return c.json({error:'Email y contraseña requeridos'},400);
      // Admin no puede crear usuarios con rol owner o admin
      if (s.role !== 'owner' && PROTECTED_ROLES.includes(d.role||'employee')) {
        return c.json({error:'No puedes crear usuarios con ese rol'},403);
      }
      const r = db.prepare('INSERT INTO admin_users (name,email,password_hash,role) VALUES (?,?,?,?)').run(d.name||'', d.email, await hashPassword(d.password), d.role||'employee');
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id', requirePerm('admin.manage_users'), validate(userUpdateSchema), async c => {
    try {
      const s = c.get('session');
      const targetId = parseInt(c.req.param('id'));
      const d = c.get('validated');
      const target = db.prepare('SELECT id,role FROM admin_users WHERE id=?').get(targetId);
      if (!target) return c.json({error:'Usuario no encontrado'},404);
      // Nunca cambiar el rol del propio usuario
      if (targetId === s.userId) return c.json({error:'No puedes modificar tu propio rol'},403);
      // Admin no puede tocar usuarios owner ni admin
      if (s.role !== 'owner' && PROTECTED_ROLES.includes(target.role)) {
        return c.json({error:'No tienes permiso para editar ese usuario'},403);
      }
      // Admin no puede asignar roles protegidos
      if (s.role !== 'owner' && PROTECTED_ROLES.includes(d.role||'employee')) {
        return c.json({error:'No puedes asignar ese rol'},403);
      }
      if (d.password) {
        db.prepare('UPDATE admin_users SET name=?,email=?,role=?,active=?,password_hash=? WHERE id=?').run(d.name||'', d.email||'', d.role||'employee', d.active?1:0, await hashPassword(d.password), targetId);
      } else {
        db.prepare('UPDATE admin_users SET name=?,email=?,role=?,active=? WHERE id=?').run(d.name||'', d.email||'', d.role||'employee', d.active?1:0, targetId);
      }
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id', requirePerm('admin.manage_users'), c => {
    try {
      const s = c.get('session');
      const targetId = parseInt(c.req.param('id'));
      const target = db.prepare('SELECT id,role FROM admin_users WHERE id=?').get(targetId);
      if (!target) return c.json({error:'Usuario no encontrado'},404);
      // Nunca borrar al owner
      if (target.role === 'owner') return c.json({error:'No puedes eliminar al owner'},403);
      // Admin no puede borrar usuarios admin ni owner
      if (s.role !== 'owner' && PROTECTED_ROLES.includes(target.role)) {
        return c.json({error:'No tienes permiso para eliminar ese usuario'},403);
      }
      const count = db.prepare('SELECT COUNT(*) as c FROM admin_users WHERE active=1').get().c;
      if (count <= 1) return c.json({error:'No puedes eliminar el último usuario activo'},400);
      db.prepare('DELETE FROM admin_users WHERE id=?').run(targetId);
      return c.json({message:'Eliminado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: PERMISOS DE USUARIO ───────────────────────────────────
  api.get('/:id/permissions', requirePerm('admin.manage_users'), c => {
    try {
      const userId = parseInt(c.req.param('id'));
      const assigned = db.prepare(`
        SELECT p.id FROM permissions p
        JOIN user_permissions up ON p.id = up.permission_id
        WHERE up.admin_user_id = ?
      `).all(userId).map(r => r.id);
      return c.json({ assigned });
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/:id/permissions', requirePerm('admin.manage_users'), async c => {
    try {
      const s = c.get('session');
      const userId = parseInt(c.req.param('id'));
      if (userId === s.userId) return c.json({error:'No puedes cambiar tus propios permisos'},403);
      const body = await c.req.json();
      const permIds = Array.isArray(body.permission_ids) ? body.permission_ids.map(Number) : [];
      db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(userId);
      const ins = db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)');
      for (const pid of permIds) ins.run(userId, pid);
      return c.json({message:'Permisos actualizados'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: ACTIVITY LOGS ─────────────────────────────────────────
  api.get('/activity', requirePerm('admin.manage_users'), c => {
    try {
      return c.json(db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 200').all());
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: BACKUP ────────────────────────────────────────────────
  api.get('/backup', requirePerm('backup.download'), c => {
    try {
      const tenant = c.get('tenant');
      const dbPath = path.join(process.cwd(), tenant.db_filename);
      const data = readFileSync(dbPath);
      const filename = 'bamburu_backup_' + new Date().toISOString().slice(0,10) + '.db';
      return new Response(data, { headers: {'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+filename+'"'} });
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── VIEWS ──────────────────────────────────────────────────────
  views.get('/', requirePerm('admin.manage_users'), c => {
    // Permisos · Paso 1 FASE 2 — la pantalla deja de OFRECER los permisos decorativos/legacy que no
    // gobiernan nada vivo (no se borran del catálogo ni se tocan asignaciones existentes; solo no se
    // listan para asignar). orders.* (POS retirado, ya no gatea nada tras recablear facturas/cobros),
    // services.* (servicios unificados en productos), activity.read (la actividad va por admin.manage_users),
    // purchases.delete / tags.edit (sin ruta), admin.manage_roles / admin.settings (sin uso). Los cobros.*
    // nuevos sí aparecen (vienen del catálogo).
    const HIDDEN_PERMS = new Set([
      'orders.read','orders.create','orders.edit','orders.update_status',
      'services.read','services.create','services.edit','services.delete',
      'activity.read','purchases.delete','tags.edit','admin.manage_roles','admin.settings',
    ]);
    const allPerms = db.prepare('SELECT id, module, action, description FROM permissions ORDER BY module, action')
      .all().filter(p => !HIDDEN_PERMS.has(p.module + '.' + p.action));
    const permsJson = JSON.stringify(allPerms);
    const content = `
      <div class="ph"><h2>Usuarios Administradores</h2><button class="btn btn-primary" onclick="newUser()">Nuevo usuario</button></div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Email</th><th>Acceso</th><th>Permisos</th><th>Estado</th><th>Creado</th><th></th></tr></thead>
          <tbody id="userBody"></tbody>
        </table></div>
      </div>
      <div class="card" style="margin-top:1rem;max-width:400px">
        <div class="card-head"><h3>Backup de base de datos</h3></div>
        <div class="card-body">
          <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">Descarga una copia de seguridad completa de la base de datos.</p>
          <a href="/api/erp/users/backup" class="btn btn-secondary">Descargar backup .db</a>
        </div>
      </div>

      <!-- Modal usuario -->
      <div class="modal-overlay" id="userModal">
        <div class="modal" style="max-width:600px">
          <div class="modal-head"><h3 id="userModalTitle">Nuevo Usuario</h3><button class="modal-close" onclick="closeModal('userModal')">✕</button></div>
          <div class="modal-body" style="max-height:75vh;overflow-y:auto">
            <input type="hidden" id="userId">
            <div class="form-row">
              <div class="form-group"><label class="form-label">Nombre</label><input class="form-control" id="uName"></div>
              <div class="form-group"><label class="form-label">Email *</label><input class="form-control" type="email" id="uEmail"></div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Contraseña <span id="pwdHint" style="color:var(--muted);font-size:.75rem">(dejar en blanco para no cambiar)</span></label>
                <input class="form-control" type="password" id="uPwd">
              </div>
              <div class="form-group"><label class="form-label">Nivel de acceso</label>
                <select class="form-control" id="uRole">
                  <option value="owner">Propietario</option>
                  <option value="admin">Administrador</option>
                  <option value="employee">Empleado</option>
                  <option value="readonly">Solo lectura</option>
                </select>
              </div>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:1rem;margin-top:.25rem">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
                <label class="form-label" style="margin:0">Permisos</label>
                <div style="display:flex;gap:.5rem">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="selectAllPerms(true)">Todos</button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="selectAllPerms(false)">Ninguno</button>
                </div>
              </div>
              <div id="permsContainer"></div>
            </div>

            <div class="form-group" style="margin-top:1rem"><label class="form-label"><input type="checkbox" id="uActive" checked> Activo</label></div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" onclick="closeModal('userModal')">Cancelar</button>
            <button class="btn btn-primary" onclick="saveUser()">Guardar</button>
          </div>
        </div>
      </div>

      <script>
      const SYSTEM_ROLES={owner:'Propietario',admin:'Administrador',employee:'Empleado',readonly:'Solo lectura'};
      const MODULE_LABELS={activity:'Actividad',admin:'Administración',analytics:'Analítica',categories:'Categorías',clients:'Clientes',cobros:'Cobros',discounts:'Descuentos',inventory:'Inventario',invoices:'Facturas',orders:'Pedidos',products:'Productos',purchases:'Compras',quotes:'Presupuestos',pedidos:'Pedidos de venta',albaranes:'Albaranes',sales:'Ventas',feedback:'Feedback',suppliers:'Proveedores',tags:'Etiquetas'};
      const ALL_PERMS=${permsJson};
      let users=[], selectedPermIds=new Set();

      function groupByModule(perms){
        const g={};
        for(const p of perms){if(!g[p.module])g[p.module]=[];g[p.module].push(p);}
        return g;
      }

      function renderPermsContainer(assignedIds){
        selectedPermIds=new Set(assignedIds);
        const groups=groupByModule(ALL_PERMS);
        document.getElementById('permsContainer').innerHTML=Object.entries(groups).map(([mod,perms])=>\`
          <div style="margin-bottom:.85rem">
            <div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.4rem">
              \${MODULE_LABELS[mod]||mod}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:.4rem">
              \${perms.map(p=>\`
                <label style="display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .65rem;border:1px solid \${selectedPermIds.has(p.id)?'var(--teal)':'var(--border)'};border-radius:20px;font-size:.8rem;cursor:pointer;background:\${selectedPermIds.has(p.id)?'rgba(58,65,80,.1)':'transparent'};color:\${selectedPermIds.has(p.id)?'var(--teal)':'var(--text2)'};transition:all .15s" id="plabel_\${p.id}">
                  <input type="checkbox" value="\${p.id}" \${selectedPermIds.has(p.id)?'checked':''} onchange="togglePerm(\${p.id},this.checked)" style="display:none">
                  \${p.description}
                </label>\`).join('')}
            </div>
          </div>\`).join('');
      }

      function togglePerm(id,checked){
        if(checked)selectedPermIds.add(id);else selectedPermIds.delete(id);
        const lbl=document.getElementById('plabel_'+id);
        if(lbl){
          lbl.style.borderColor=checked?'var(--teal)':'var(--border)';
          lbl.style.background=checked?'rgba(58,65,80,.1)':'transparent';
          lbl.style.color=checked?'var(--teal)':'var(--text2)';
        }
      }

      function selectAllPerms(checked){
        for(const p of ALL_PERMS) togglePerm(p.id,checked);
        document.querySelectorAll('#permsContainer input[type=checkbox]').forEach(cb=>{cb.checked=checked;});
      }

      async function loadUsers(){
        users=await api('GET','/api/erp/users').catch(()=>[]);
        const permsMap={};
        await Promise.all(users.map(async u=>{
          try{const d=await api('GET','/api/erp/users/'+u.id+'/permissions');permsMap[u.id]=d.assigned||[];}catch{permsMap[u.id]=[];}
        }));
        document.getElementById('userBody').innerHTML=users.length?users.map(u=>{
          const cnt=permsMap[u.id]?.length||0;
          const permBadge=cnt>0
            ?'<span class="badge b-teal">'+cnt+' permiso'+(cnt!==1?'s':'')+'</span>'
            :'<span style="color:var(--muted);font-size:.8rem">Sin permisos</span>';
          return '<tr>'+
            '<td><strong>'+escHtml(u.name)+'</strong></td>'+
            '<td style="color:var(--muted)">'+escHtml(u.email)+'</td>'+
            '<td><span class="badge '+(u.role==='owner'?'b-purple':u.role==='admin'?'b-blue':'b-gray')+'">'+SYSTEM_ROLES[u.role]+'</span></td>'+
            '<td>'+permBadge+'</td>'+
            '<td>'+(u.active?'<span class="badge b-green">Activo</span>':'<span class="badge b-red">Inactivo</span>')+'</td>'+
            '<td style="color:var(--muted);font-size:.8rem">'+(u.created_at?.split(' ')[0]||'-')+'</td>'+
            '<td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" onclick="editUser('+u.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="delUser('+u.id+')">Eliminar</button></td>'+
            '</tr>';
        }).join(''):'<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin usuarios</td></tr>';
      }

      function newUser(){
        document.getElementById('userModalTitle').textContent='Nuevo Usuario';
        document.getElementById('userId').value='';
        document.getElementById('uName').value='';
        document.getElementById('uEmail').value='';
        document.getElementById('uPwd').value='';
        document.getElementById('uRole').value='employee';
        document.getElementById('uActive').checked=true;
        document.getElementById('pwdHint').style.display='none';
        renderPermsContainer([]);
        openModal('userModal');
      }

      async function editUser(id){
        const u=users.find(x=>x.id===id);if(!u)return;
        document.getElementById('userModalTitle').textContent='Editar Usuario';
        document.getElementById('userId').value=id;
        document.getElementById('uName').value=u.name;
        document.getElementById('uEmail').value=u.email;
        document.getElementById('uPwd').value='';
        document.getElementById('uRole').value=u.role;
        document.getElementById('uActive').checked=!!u.active;
        document.getElementById('pwdHint').style.display='';
        const d=await api('GET','/api/erp/users/'+id+'/permissions').catch(()=>({assigned:[]}));
        renderPermsContainer(d.assigned||[]);
        openModal('userModal');
      }

      async function saveUser(){
        const id=document.getElementById('userId').value;
        const body={name:document.getElementById('uName').value,email:document.getElementById('uEmail').value,role:document.getElementById('uRole').value,active:document.getElementById('uActive').checked};
        const pwd=document.getElementById('uPwd').value;
        if(pwd)body.password=pwd;
        try{
          if(id){
            await api('PUT','/api/erp/users/'+id,body);
            await api('POST','/api/erp/users/'+id+'/permissions',{permission_ids:[...selectedPermIds]});
          }else{
            if(!pwd){toast('Contraseña requerida','err');return;}
            const r=await api('POST','/api/erp/users',body);
            if(r?.id) await api('POST','/api/erp/users/'+r.id+'/permissions',{permission_ids:[...selectedPermIds]});
          }
          closeModal('userModal');
          toast('Guardado');
          loadUsers();
        }catch(e){toast(e.message,'err')}
      }

      async function delUser(id){
        if(!confirm('¿Eliminar usuario?'))return;
        try{await api('DELETE','/api/erp/users/'+id);toast('Eliminado');loadUsers();}catch(e){toast(e.message,'err');}
      }

      loadUsers();
      </script>`;
    return c.html(adminLayout('Usuarios Admin', content, 'users', c.get('session')?.csrfToken || '', c));
  });

  activityViews.get('/', requirePerm('admin.manage_users'), c => {
    const content = `
      <div class="ph"><h2>Registro de Actividad</h2></div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
          <tbody id="actBody"><tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr></tbody>
        </table></div>
      </div>
      <script>
      api('GET','/api/erp/users/activity').then(logs=>{
        document.getElementById('actBody').innerHTML=logs.length?logs.map(l=>'<tr>'+
          '<td style="color:var(--muted);font-size:.78rem;white-space:nowrap">'+(l.created_at?.replace('T',' ').split('.')[0]||'-')+'</td>'+
          '<td><span class="badge b-blue">'+l.user_name+'</span></td>'+
          '<td>'+l.action+'</td>'+
          '<td style="color:var(--muted)">'+(l.entity||'-')+(l.entity_id?' #'+l.entity_id:'')+'</td>'+
          '<td style="color:var(--muted);font-size:.82rem">'+escHtml(l.details||'-')+'</td>'+
          '</tr>').join(''):'<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Sin actividad registrada</td></tr>';
      });
      </script>`;
    return c.html(adminLayout('Actividad', content, 'activity', c.get('session')?.csrfToken || '', c));
  });

  return { api, views, activityViews };
}
