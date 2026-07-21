// PROYECTOS — Escalera · paso 7 (servicios profesionales) · PIEZA 1: EL PROYECTO.
// Entidad "proyecto" + su pantalla de gestión. Espejo EXACTO del patrón de clientes (routes/clients.js):
// servicio validado compartido (create/update/archive/restore con `.status`), guarda de código único vía
// el contador, lista server-rendered (buscador + Activos/Archivados + paginación 25 + Restaurar) y
// `requirePerm` en TODAS las rutas —incluidas las VISTAS (lección M2)—. `proyectos` FUERA de
// WRITABLE_TABLES: DISA no la escribe. Aquí NO entra registro de tiempo, facturar horas, rentabilidad ni
// calendario (piezas 2–5), ni se enlaza project_id a facturas/compras (llega con la rentabilidad).
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, rowMenu, emptyRow } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { escHtml } from '../../../core/escape.js';
import { proyectoSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { ENTITY } from '../../../core/activity-entities.js';

const MODO_LABEL = { horas: 'Por horas', precio_cerrado: 'Precio cerrado' };
const ESTADO_LABEL = { abierto: 'Abierto', cerrado: 'Cerrado' };

// ── SERVICIO VALIDADO COMPARTIDO — única fuente de verdad de escritura (misma idea que clientes) ──
function parseProyecto(input) {
  const res = proyectoSchema.safeParse(input);
  if (!res.success) {
    const msg = res.error.issues.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    const e = new Error(msg || 'Datos de proyecto inválidos'); e.status = 400; throw e;
  }
  return res.data;
}
// Guarda el importe SOLO del modo elegido: por horas → tarifa_hora (precio_cerrado a null) y viceversa.
const tarifaDe = d => (d.modo_cobro === 'horas' ? (d.tarifa_hora ?? null) : null);
const precioDe = d => (d.modo_cobro === 'precio_cerrado' ? (d.precio_cerrado ?? null) : null);

export function createProyectoSvc(db, input) {
  const d = parseProyecto(input);
  const codigo = nextCode(db, 'project');   // PRY-NNNN, correlativo y NO editable
  const r = db.prepare(
    'INSERT INTO proyectos (codigo,nombre,cliente_id,responsable_id,modo_cobro,tarifa_hora,precio_cerrado,fecha_inicio,fecha_fin_prevista,estado,notas,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)'
  ).run(codigo, d.nombre, d.cliente_id || null, d.responsable_id || null, d.modo_cobro, tarifaDe(d), precioDe(d),
        d.fecha_inicio || null, d.fecha_fin_prevista || null, d.estado || 'abierto', d.notas || '');
  return { id: r.lastInsertRowid, nombre: d.nombre, codigo };
}

export function updateProyectoSvc(db, id, input) {
  const exists = db.prepare('SELECT id FROM proyectos WHERE id=?').get(id);
  if (!exists) { const e = new Error('Proyecto no encontrado'); e.status = 404; throw e; }
  const d = parseProyecto(input);
  db.prepare(
    'UPDATE proyectos SET nombre=?,cliente_id=?,responsable_id=?,modo_cobro=?,tarifa_hora=?,precio_cerrado=?,fecha_inicio=?,fecha_fin_prevista=?,estado=?,notas=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(d.nombre, d.cliente_id || null, d.responsable_id || null, d.modo_cobro, tarifaDe(d), precioDe(d),
        d.fecha_inicio || null, d.fecha_fin_prevista || null, d.estado || 'abierto', d.notas || '', id);
  return { id: Number(id), nombre: d.nombre };
}

export function archiveProyectoSvc(db, id) {
  const p = db.prepare('SELECT id, nombre FROM proyectos WHERE id=?').get(id);
  if (!p) { const e = new Error('Proyecto no encontrado'); e.status = 404; throw e; }
  db.prepare('UPDATE proyectos SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);   // archivar, no borrar
  return { id: Number(id), nombre: p.nombre };
}

export function restoreProyectoSvc(db, id) {
  const p = db.prepare('SELECT id, nombre FROM proyectos WHERE id=?').get(id);
  if (!p) { const e = new Error('Proyecto no encontrado'); e.status = 404; throw e; }
  // El código es único por construcción (contador): restaurar no puede chocar → sin guarda.
  db.prepare('UPDATE proyectos SET active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  return { id: Number(id), nombre: p.nombre };
}

// Lectura con cliente/responsable resueltos EN VIVO (LEFT JOIN): reasignar cambia la ficha, no se congela.
export function getProyecto(db, id) {
  return db.prepare(
    `SELECT p.*, c.name AS cliente_nombre, u.name AS responsable_nombre
       FROM proyectos p
       LEFT JOIN clients c ON c.id = p.cliente_id
       LEFT JOIN admin_users u ON u.id = p.responsable_id
      WHERE p.id=?`
  ).get(id);
}

export function createProyectoRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API ────────────────────────────────────────────────────────────────────
  api.get('/', requirePerm('proyectos.read'), c => {
    try {
      return c.json(db.prepare(
        `SELECT p.*, c.name AS cliente_nombre, u.name AS responsable_nombre
           FROM proyectos p LEFT JOIN clients c ON c.id=p.cliente_id LEFT JOIN admin_users u ON u.id=p.responsable_id
          WHERE p.active=1 ORDER BY p.id DESC`
      ).all());
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.get('/:id', requirePerm('proyectos.read'), c => {
    try {
      const p = getProyecto(db, c.req.param('id'));
      if (!p) return c.json({ error: 'No encontrado' }, 404);
      return c.json(p);
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Las 4 escrituras pasan por el servicio compartido; la ruta añade permiso, log y código HTTP.
  api.post('/', requirePerm('proyectos.edit'), validate(proyectoSchema), async c => {
    try {
      const r = createProyectoSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó proyecto', ENTITY.PROJECT, r.id, r.codigo + ' · ' + r.nombre);
      return c.json({ id: r.id, codigo: r.codigo, message: 'Creado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.put('/:id', requirePerm('proyectos.edit'), validate(proyectoSchema), async c => {
    try {
      const r = updateProyectoSvc(db, c.req.param('id'), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó proyecto', ENTITY.PROJECT, r.id, r.nombre);
      return c.json({ message: 'Actualizado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.delete('/:id', requirePerm('proyectos.edit'), c => {
    try {
      const r = archiveProyectoSvc(db, c.req.param('id'));
      logActivity(db, c.get('session'), 'Archivó proyecto', ENTITY.PROJECT, r.id, r.nombre || '');
      return c.json({ message: 'Archivado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/:id/restore', requirePerm('proyectos.edit'), c => {
    try {
      const r = restoreProyectoSvc(db, c.req.param('id'));
      logActivity(db, c.get('session'), 'Restauró proyecto', ENTITY.PROJECT, r.id, r.nombre || '');
      return c.json({ message: 'Restaurado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── VISTA (server-rendered, con candado) ─────────────────────────────────────
  views.get('/', requirePerm('proyectos.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const q = (c.req.query('q') || '').trim();
    const verArchivados = c.req.query('archivados') === '1';
    const activeVal = verArchivados ? 0 : 1;
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    const where = ['p.active = ?'];
    const params = [activeVal];
    if (q) { where.push('(p.nombre LIKE ? OR p.codigo LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const total = db.prepare('SELECT COUNT(*) AS n FROM proyectos p ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const lista = db.prepare(
      `SELECT p.*, c.name AS cliente_nombre, u.name AS responsable_nombre
         FROM proyectos p LEFT JOIN clients c ON c.id=p.cliente_id LEFT JOIN admin_users u ON u.id=p.responsable_id `
      + whereSql + ' ORDER BY p.id DESC LIMIT ? OFFSET ?'
    ).all(...params, perPage, offset);

    const clientOptions = db.prepare("SELECT id, name FROM clients WHERE active=1 ORDER BY name").all()
      .map(cl => '<option value="' + cl.id + '">' + escHtml(cl.name) + '</option>').join('');
    const userOptions = db.prepare("SELECT id, name FROM admin_users WHERE active=1 ORDER BY name").all()
      .map(u => '<option value="' + u.id + '">' + escHtml(u.name) + '</option>').join('');

    const buildQs = (p) => {
      const u = new URLSearchParams();
      if (q) u.set('q', q);
      if (verArchivados) u.set('archivados', '1');
      u.set('page', String(p));
      return u.toString();
    };
    const dinero = n => (n == null ? '—' : sym + Number(n).toFixed(2));
    const cobroCol = p => p.modo_cobro === 'horas'
      ? 'Por horas · ' + (p.tarifa_hora == null ? '<span style="color:var(--muted)">sin tarifa</span>' : dinero(p.tarifa_hora) + '/h')
      : 'Precio cerrado · ' + dinero(p.precio_cerrado);

    const rowsHtml = lista.map(p => '<tr>'
      + '<td style="color:var(--muted);font-family:monospace;font-size:.8rem">' + escHtml(p.codigo || '-') + '</td>'
      + '<td><strong>' + escHtml(p.nombre) + '</strong></td>'
      + '<td style="color:var(--muted)">' + escHtml(p.cliente_nombre || '—') + '</td>'
      + '<td style="color:var(--muted)">' + escHtml(p.responsable_nombre || '—') + '</td>'
      + '<td style="font-size:.85rem">' + cobroCol(p) + '</td>'
      + '<td><span class="badge ' + (p.estado === 'abierto' ? 'b-green' : 'b-gray') + '">' + escHtml(ESTADO_LABEL[p.estado] || p.estado) + '</span></td>'
      + '<td style="white-space:nowrap">'
        + '<button class="btn btn-secondary btn-sm" onclick="viewDetail(' + p.id + ')">Ver</button> '
        + (verArchivados
            ? (can(c, 'proyectos.edit') ? '<button class="btn btn-secondary btn-sm" onclick="restoreProyecto(' + p.id + ')">Restaurar</button>' : '')
            : (can(c, 'proyectos.edit')
                ? rowMenu([
                    { label: 'Editar', onclick: 'editProyecto(' + p.id + ')' },
                    { label: 'Archivar', danger: true, onclick: 'delProyecto(' + p.id + ')' },
                  ])
                : ''))
      + '</td></tr>').join('');

    const content = `
      <div class="ph">
        <h2>Proyectos</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${escHtml(q)}" placeholder="Buscar por nombre o código...">
          <select class="form-control" name="archivados" style="width:auto;min-width:150px" onchange="this.form.submit()">
            <option value=""${verArchivados ? '' : ' selected'}>Activos</option>
            <option value="1"${verArchivados ? ' selected' : ''}>Archivados</option>
          </select>
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'proyectos.edit') ? '<button type="button" class="btn btn-primary" onclick="openNewProyecto()">Nuevo proyecto</button>' : ''}
        </form>
      </div>

      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Código</th><th>Nombre</th><th>Cliente</th><th>Responsable</th><th>Cobro</th><th>Estado</th><th></th></tr></thead>
          <tbody>${total === 0 ? ((q || verArchivados) ? emptyRow(7, 'No se encontraron proyectos con ese filtro.', { icon: 'ti-search' }) : emptyRow(7, 'Todavía no tienes proyectos. Vamos a crear el primero.', can(c, 'proyectos.edit') ? { cta: 'Nuevo proyecto', onclick: 'openNewProyecto()' } : {})) : rowsHtml}</tbody>
        </table></div>
      </div>

      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--muted);font-size:.85rem">Página ${page} de ${totalPages} · ${total} proyecto${total === 1 ? '' : 's'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div>
      </div>` : ''}

      <div class="modal-overlay" id="proyModal">
        <div class="modal" style="max-width:640px">
          <div class="modal-head"><h3 id="proyModalTitle">Nuevo proyecto</h3><button class="modal-close" onclick="closeModal('proyModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="proyId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="pNombre"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Cliente</label>
                <select class="form-control" id="pCliente"><option value="">— Sin cliente —</option>${clientOptions}</select>
                <div style="font-size:.7rem;color:var(--muted);margin-top:.25rem">Opcional. Si lo reasignas, la ficha se actualiza sola.</div>
              </div>
              <div class="form-group"><label class="form-label">Responsable</label>
                <select class="form-control" id="pResp"><option value="">— Sin asignar —</option>${userOptions}</select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Modo de cobro *</label>
                <select class="form-control" id="pModo" onchange="proyToggleCobro()">
                  <option value="horas">Por horas</option>
                  <option value="precio_cerrado">Precio cerrado</option>
                </select>
              </div>
              <div class="form-group" id="pTarifaWrap"><label class="form-label">Tarifa por hora</label>
                <input class="form-control" id="pTarifa" type="number" min="0" step="0.01" placeholder="${sym}/h">
                <div style="font-size:.7rem;color:var(--muted);margin-top:.25rem">Tarifa por defecto del proyecto (puede quedar vacía).</div>
              </div>
              <div class="form-group" id="pPrecioWrap" style="display:none"><label class="form-label">Precio cerrado</label>
                <input class="form-control" id="pPrecio" type="number" min="0" step="0.01" placeholder="${sym}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Fecha de inicio</label><input class="form-control" id="pInicio" type="date"></div>
              <div class="form-group"><label class="form-label">Fin previsto</label><input class="form-control" id="pFin" type="date"></div>
              <div class="form-group"><label class="form-label">Estado</label>
                <select class="form-control" id="pEstado"><option value="abierto">Abierto</option><option value="cerrado">Cerrado</option></select>
              </div>
            </div>
            <div class="form-group"><label class="form-label">Notas internas</label><textarea class="form-control" id="pNotas" rows="2"></textarea></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('proyModal')">Cancelar</button><button class="btn btn-primary" onclick="saveProyecto()">Guardar</button></div>
        </div>
      </div>

      <div class="modal-overlay" id="proyDetail">
        <div class="modal" style="max-width:640px">
          <div class="modal-head"><h3 id="proyDetailName">Detalle del proyecto</h3><button class="modal-close" onclick="closeModal('proyDetail')">✕</button></div>
          <div class="modal-body" id="proyDetailBody"></div>
        </div>
      </div>

      <script>
      const PROY_SYM = ${JSON.stringify(sym)};
      const PUEDE_TIEMPO = ${can(c, 'tiempo.read') ? 'true' : 'false'};   // sección de registro de tiempo (peldaño 7 · pieza 2)
      const PUEDE_RENT = ${(can(c, 'proyectos.read') && can(c, 'invoices.read')) ? 'true' : 'false'};   // panel de rentabilidad (peldaño 7 · pieza 4): exige proyectos.read + P&G
      function proyToggleCobro(){
        const horas = document.getElementById('pModo').value === 'horas';
        document.getElementById('pTarifaWrap').style.display = horas ? '' : 'none';
        document.getElementById('pPrecioWrap').style.display = horas ? 'none' : '';
      }
      function openNewProyecto(){
        document.getElementById('proyModalTitle').textContent = 'Nuevo proyecto';
        ['proyId','pNombre','pTarifa','pPrecio','pInicio','pFin','pNotas'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('pCliente').value='';
        document.getElementById('pResp').value='';
        document.getElementById('pModo').value='horas';
        document.getElementById('pEstado').value='abierto';
        proyToggleCobro();
        openModal('proyModal');
      }
      async function editProyecto(id){
        const p = await api('GET','/api/erp/proyectos/'+id);
        document.getElementById('proyModalTitle').textContent='Editar proyecto';
        document.getElementById('proyId').value=id;
        document.getElementById('pNombre').value=p.nombre||'';
        document.getElementById('pCliente').value=p.cliente_id||'';
        document.getElementById('pResp').value=p.responsable_id||'';
        document.getElementById('pModo').value=p.modo_cobro||'horas';
        document.getElementById('pTarifa').value=(p.tarifa_hora!=null?p.tarifa_hora:'');
        document.getElementById('pPrecio').value=(p.precio_cerrado!=null?p.precio_cerrado:'');
        document.getElementById('pInicio').value=p.fecha_inicio||'';
        document.getElementById('pFin').value=p.fecha_fin_prevista||'';
        document.getElementById('pEstado').value=p.estado||'abierto';
        document.getElementById('pNotas').value=p.notas||'';
        proyToggleCobro();
        openModal('proyModal');
      }
      async function saveProyecto(){
        const id=document.getElementById('proyId').value;
        const modo=document.getElementById('pModo').value;
        const body={
          nombre:document.getElementById('pNombre').value,
          cliente_id:document.getElementById('pCliente').value||null,
          responsable_id:document.getElementById('pResp').value||null,
          modo_cobro:modo,
          tarifa_hora: modo==='horas' ? (document.getElementById('pTarifa').value||null) : null,
          precio_cerrado: modo==='precio_cerrado' ? (document.getElementById('pPrecio').value||null) : null,
          fecha_inicio:document.getElementById('pInicio').value||'',
          fecha_fin_prevista:document.getElementById('pFin').value||'',
          estado:document.getElementById('pEstado').value,
          notas:document.getElementById('pNotas').value
        };
        try{ if(id) await api('PUT','/api/erp/proyectos/'+id,body); else await api('POST','/api/erp/proyectos',body);
          closeModal('proyModal'); toast(id?'Actualizado':'Creado'); location.reload();
        }catch(e){ toast(e.message,'err'); }
      }
      async function delProyecto(id){ if(!confirm('¿Archivar este proyecto? Dejará de aparecer en la lista, pero no se borra.'))return;
        try{ await api('DELETE','/api/erp/proyectos/'+id); toast('Archivado'); location.reload(); }catch(e){ toast(e.message,'err'); } }
      async function restoreProyecto(id){ try{ await api('POST','/api/erp/proyectos/'+id+'/restore'); toast('Restaurado'); location.reload(); }catch(e){ toast(e.message,'err'); } }
      async function viewDetail(id){
        const p = await api('GET','/api/erp/proyectos/'+id);
        document.getElementById('proyDetailName').textContent=p.nombre;
        const dinero = n => (n==null?'—':PROY_SYM+Number(n).toFixed(2));
        const cobro = p.modo_cobro==='horas' ? ('Por horas'+(p.tarifa_hora!=null?' · '+dinero(p.tarifa_hora)+'/h':' · sin tarifa')) : ('Precio cerrado · '+dinero(p.precio_cerrado));
        document.getElementById('proyDetailBody').innerHTML =
          '<div class="grid g2" style="margin-bottom:1rem">'
          +'<div><div class="form-label">Código</div><div style="font-family:monospace">'+escHtml(p.codigo||'-')+'</div></div>'
          +'<div><div class="form-label">Estado</div><div>'+(p.estado==='abierto'?'Abierto':'Cerrado')+'</div></div>'
          +'<div><div class="form-label">Cliente</div><div>'+escHtml(p.cliente_nombre||'—')+'</div></div>'
          +'<div><div class="form-label">Responsable</div><div>'+escHtml(p.responsable_nombre||'—')+'</div></div>'
          +'<div><div class="form-label">Modo de cobro</div><div>'+cobro+'</div></div>'
          +'<div><div class="form-label">Fechas</div><div>'+(p.fecha_inicio||'—')+' → '+(p.fecha_fin_prevista||'—')+'</div></div>'
          +'</div>'
          +(p.notas?'<div class="alert alert-ok">'+escHtml(p.notas)+'</div>':'')
          +(PUEDE_RENT?'<div id="proyRent" style="margin-top:1.25rem;color:var(--muted)">Cargando rentabilidad…</div>':'')
          +(PUEDE_TIEMPO?'<div id="proyTiempo" style="margin-top:1.25rem;color:var(--muted)">Cargando registro de tiempo…</div>':'');
        openModal('proyDetail');
        if(PUEDE_RENT) loadRentProy(id);
        if(PUEDE_TIEMPO) loadTiempoProy(id);
      }
      // PIEZA 4 — panel de rentabilidad: ingresos (facturado sin IVA) − gastos = resultado, con margen. El
      // cobrado se muestra aparte (dato de caja). Sale del P&G filtrado por proyecto (única fuente de verdad).
      async function loadRentProy(id){
        const box=document.getElementById('proyRent'); if(!box) return;
        let d; try{ d=await api('GET','/api/erp/rentabilidad/proyecto/'+id); }catch(e){ box.innerHTML=''; return; }
        const dinero=n=>PROY_SYM+Number(n||0).toFixed(2);
        const col=n=>(n<0?'var(--danger,#b23)':(n>0?'var(--ok,#1a7f37)':'var(--muted)'));
        box.style.color='';
        box.innerHTML='<h4 style="margin:0 0 .5rem">Rentabilidad</h4>'
          +'<div class="grid g2" style="gap:.5rem 1rem">'
          +'<div><div class="form-label">Ingresos (facturado, sin IVA)</div><div>'+dinero(d.ingresos)+'</div></div>'
          +'<div><div class="form-label">Gastos asignados</div><div>'+dinero(d.gastos)+'</div></div>'
          +'<div><div class="form-label">Resultado</div><div style="font-weight:700;color:'+col(d.resultado)+'">'+dinero(d.resultado)+'</div></div>'
          +'<div><div class="form-label">Margen</div><div style="color:'+col(d.resultado)+'">'+(d.margenPct==null?'—':Number(d.margenPct).toFixed(1)+'%')+'</div></div>'
          +'</div>'
          +'<div style="margin-top:.5rem;color:var(--muted);font-size:.85rem">Cobrado (caja): <strong>'+dinero(d.cobrado)+'</strong> · no cambia el resultado</div>';
      }
      // PIEZA 2 — dentro de la ficha del proyecto: lista de tiempo + total de horas + total facturable.
      async function loadTiempoProy(id){
        const box=document.getElementById('proyTiempo'); if(!box) return;
        let d; try{ d=await api('GET','/api/erp/tiempo/proyecto/'+id); }catch(e){ box.innerHTML=''; return; }
        const dinero=n=>(n==null?'—':PROY_SYM+Number(n).toFixed(2));
        const fmtDur=s=>{ s=Math.max(0,Math.round(s||0)); const m=Math.floor((s%3600)/60); return Math.floor(s/3600)+'h '+(m<10?'0':'')+m+'m'; };
        const rows=(d.entradas||[]).filter(e=>!e.corriendo);
        box.style.color='';
        box.innerHTML='<h4 style="margin:0 0 .5rem">Registro de tiempo</h4>'
          +'<div class="alert '+(d.total_seg>0?'alert-ok':'')+'" style="margin-bottom:.75rem">Total: <strong>'+fmtDur(d.total_seg)+'</strong> · Facturable: <strong>'+dinero(d.total_importe_facturable)+'</strong></div>'
          +(rows.length?'<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Persona</th><th>Descripción</th><th>Duración</th><th>Fact.</th><th>Importe</th></tr></thead><tbody>'
            +rows.map(e=>'<tr><td style="color:var(--muted);font-size:.8rem">'+escHtml(e.fecha)+'</td><td>'+escHtml(e.user_nombre||'')+'</td><td>'+escHtml(e.descripcion||'—')+'</td><td style="white-space:nowrap">'+fmtDur(e.duracion_seg)+'</td><td>'+(e.facturada?'<span class="badge b-blue" title="Facturada en '+escHtml(e.invoice_number||'')+'">🔒</span>':(e.facturable?'Sí':'No'))+'</td><td style="white-space:nowrap">'+(e.sin_tarifa?'<span style="color:var(--muted)">—</span>':dinero(e.importe))+'</td></tr>').join('')
            +'</tbody></table></div>'
            :'<div style="color:var(--muted);font-size:.85rem">Aún no hay tiempo registrado en este proyecto.</div>');
      }
      </script>`;
    return c.html(adminLayout('Proyectos', content, 'proyectos', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
