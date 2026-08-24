// REGISTRO DE TIEMPO — Escalera · paso 7 · PIEZA 2.
// Dos vías: cronómetro (arrancar/parar) y entrada manual. Cada entrada = proyecto + descripción corta +
// duración EXACTA (segundos, sin redondeos) + facturable. El IMPORTE se calcula EN VIVO con la tarifa de
// la PERSONA (y la del proyecto de respaldo si la persona no tiene) — nunca se pide ni se congela.
// SOLO UN cronómetro activo por persona (arrancar uno nuevo finaliza el anterior). Vive en la ficha del
// proyecto (lista + total) y en /admin/tiempo (vista semanal). Permisos: tiempo.read/tiempo.edit +
// PROPIEDAD (cada uno edita las suyas; dueño/admin, por bypass, las de cualquiera). `time_entries` FUERA
// de WRITABLE_TABLES. NO entra facturar horas, rentabilidad ni calendario (piezas 3-5).
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { escHtml } from '../../../core/escape.js';
import { tiempoStartSchema, tiempoManualSchema } from '../schemas.js';
import { hoyLocal } from '../avisos.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { fechaEs } from '../voz.js';   // la fecha, en cristiano

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
// PIEZA 4 (parte 2) — coste/hora de la persona a CONGELAR en la entrada al crearla (mismo criterio que el WAC:
// el coste que había HOY, no el de mañana). NULL/0/negativo → NULL = "sin coste registrado" (NO es coste 0).
function costeHoraDe(db, userId) {
  const v = db.prepare('SELECT coste_hora FROM admin_users WHERE id=?').get(userId)?.coste_hora;
  return (v == null || Number(v) <= 0) ? null : Number(v);
}
const lunesDe = iso => { const d = new Date(iso + 'T12:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); };
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// La tarifa efectiva de una fila (persona → proyecto de respaldo → null) y el importe EN VIVO.
function conImporte(row) {
  const tarifa = row.user_tarifa != null ? row.user_tarifa : (row.proy_tarifa != null ? row.proy_tarifa : null);
  const seg = row.duracion_seg;
  const importe = (tarifa != null && seg != null) ? r2(seg / 3600 * tarifa) : null;
  return {
    id: row.id, proyecto_id: row.proyecto_id, user_id: row.user_id, descripcion: row.descripcion,
    fecha: row.fecha, started_at: row.started_at, duracion_seg: row.duracion_seg,
    facturable: !!row.facturable, corriendo: row.duracion_seg == null,
    proyecto_nombre: row.proyecto_nombre, proyecto_codigo: row.proyecto_codigo, user_nombre: row.user_nombre,
    tarifa_efectiva: tarifa, sin_tarifa: tarifa == null, importe,
    // PIEZA 3 — facturada EN VIVO: enlazada a una factura 'emitida'. Si se anula, vuelve a estar libre.
    invoice_id: row.invoice_id || null, facturada: !!(row.invoice_id && row.invoice_status === 'emitida'),
    invoice_number: (row.invoice_id && row.invoice_status === 'emitida') ? row.invoice_number : null,
  };
}
const SELECT_BASE =
  `SELECT te.*, p.nombre AS proyecto_nombre, p.codigo AS proyecto_codigo, p.tarifa_hora AS proy_tarifa,
          u.name AS user_nombre, u.tarifa_hora AS user_tarifa,
          inv.status AS invoice_status, inv.invoice_number AS invoice_number
     FROM time_entries te JOIN proyectos p ON p.id=te.proyecto_id JOIN admin_users u ON u.id=te.user_id
     LEFT JOIN invoices inv ON inv.id=te.invoice_id`;

// ── SERVICIO VALIDADO ─────────────────────────────────────────────────────────
// Valida con `.status=400` (como clientes/proyectos), para que el servicio se defienda igual lo llame la
// ruta (que ya pasa por `validate`) o un llamador directo/DISA.
function parseCon(schema, input) {
  const res = schema.safeParse(input);
  if (!res.success) {
    const msg = res.error.issues.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    const e = new Error(msg || 'Datos de tiempo inválidos'); e.status = 400; throw e;
  }
  return res.data;
}
function proyectoVivo(db, id) {
  const p = db.prepare('SELECT id FROM proyectos WHERE id=? AND active=1').get(id);
  if (!p) { const e = new Error('El proyecto no existe o está archivado'); e.status = 400; throw e; }
}
function cargar(db, id) { return db.prepare(SELECT_BASE + ' WHERE te.id=?').get(id); }
function guarda(actor, row) {
  if (!row) { const e = new Error('Entrada de tiempo no encontrada'); e.status = 404; throw e; }
  if (!actor.esAdmin && row.user_id !== actor.userId) { const e = new Error('Solo puedes editar tus propias entradas'); e.status = 403; throw e; }
}
// PIEZA 3 — una entrada ya FACTURADA (enlazada a una factura emitida) no se edita ni elimina: lo cobrado
// no se toca. Se libera sola si la factura se anula.
function noFacturada(row, verbo) {
  if (row.invoice_id && row.invoice_status === 'emitida') {
    const e = new Error('No se puede ' + verbo + ' una entrada ya facturada (' + row.invoice_number + ')'); e.status = 409; throw e;
  }
}

export function corriendoDe(db, userId) {
  const r = db.prepare(SELECT_BASE + ' WHERE te.user_id=? AND te.active=1 AND te.duracion_seg IS NULL').get(userId);
  return r ? conImporte(r) : null;
}

export function startTimer(db, userId, input) {
  const d = parseCon(tiempoStartSchema, input);
  proyectoVivo(db, d.proyecto_id);
  // Un solo cronómetro por persona: finaliza el que estuviera corriendo antes de arrancar el nuevo.
  const yaCorre = db.prepare('SELECT id, started_at FROM time_entries WHERE user_id=? AND active=1 AND duracion_seg IS NULL').get(userId);
  if (yaCorre) finalizar(db, yaCorre);
  // Congela el coste-hora de la persona en la entrada (backfill=0: es el coste real del día que se creó).
  const r = db.prepare('INSERT INTO time_entries (proyecto_id,user_id,descripcion,fecha,started_at,duracion_seg,facturable,active,coste_hora_congelado,coste_backfill) VALUES (?,?,?,?,?,NULL,1,1,?,0)')
    .run(d.proyecto_id, userId, d.descripcion || '', hoyLocal(), new Date().toISOString(), costeHoraDe(db, userId));
  return conImporte(cargar(db, r.lastInsertRowid));
}
function finalizar(db, running) {
  const seg = Math.max(1, Math.round((Date.now() - Date.parse(running.started_at)) / 1000));
  db.prepare('UPDATE time_entries SET duracion_seg=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(seg, running.id);
}
export function stopTimer(db, userId) {
  const running = db.prepare('SELECT id, started_at FROM time_entries WHERE user_id=? AND active=1 AND duracion_seg IS NULL').get(userId);
  if (!running) { const e = new Error('No tienes ningún cronómetro en marcha'); e.status = 400; throw e; }
  finalizar(db, running);
  return conImporte(cargar(db, running.id));
}

export function createEntry(db, userId, input) {
  const d = parseCon(tiempoManualSchema, input);
  proyectoVivo(db, d.proyecto_id);
  const seg = (d.horas || 0) * 3600 + (d.minutos || 0) * 60;
  if (seg <= 0) { const e = new Error('La duración debe ser mayor que cero'); e.status = 400; throw e; }
  // Congela el coste-hora de la persona en la entrada (backfill=0: coste real del momento de crearla).
  const r = db.prepare('INSERT INTO time_entries (proyecto_id,user_id,descripcion,fecha,started_at,duracion_seg,facturable,active,coste_hora_congelado,coste_backfill) VALUES (?,?,?,?,NULL,?,?,1,?,0)')
    .run(d.proyecto_id, userId, d.descripcion || '', d.fecha, seg, d.facturable ? 1 : 0, costeHoraDe(db, userId));
  return conImporte(cargar(db, r.lastInsertRowid));
}
export function updateEntry(db, actor, id, input) {
  const row = cargar(db, id); guarda(actor, row); noFacturada(row, 'editar');
  const d = parseCon(tiempoManualSchema, input);
  proyectoVivo(db, d.proyecto_id);
  const seg = (d.horas || 0) * 3600 + (d.minutos || 0) * 60;
  if (seg <= 0) { const e = new Error('La duración debe ser mayor que cero'); e.status = 400; throw e; }
  db.prepare('UPDATE time_entries SET proyecto_id=?, descripcion=?, fecha=?, duracion_seg=?, facturable=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(d.proyecto_id, d.descripcion || '', d.fecha, seg, d.facturable ? 1 : 0, id);
  return conImporte(cargar(db, id));
}
export function deleteEntry(db, actor, id) {
  const row = cargar(db, id); guarda(actor, row); noFacturada(row, 'eliminar');
  db.prepare('UPDATE time_entries SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);   // ocultar, no destruir
  return { id: Number(id) };
}

// Entradas de la semana [lunes, lunes+6] de un usuario, ya con importe. Ordenadas por fecha y hora.
export function semanaDe(db, userId, lunes) {
  const hasta = sumarDias(lunes, 6);
  return db.prepare(SELECT_BASE + ' WHERE te.user_id=? AND te.active=1 AND te.fecha>=? AND te.fecha<=? ORDER BY te.fecha DESC, te.id DESC')
    .all(userId, lunes, hasta).map(conImporte);
}
// Entradas y totales de un PROYECTO (de todas las personas), para la ficha del proyecto.
export function tiempoDeProyecto(db, proyectoId) {
  const rows = db.prepare(SELECT_BASE + ' WHERE te.proyecto_id=? AND te.active=1 ORDER BY te.fecha DESC, te.id DESC').all(proyectoId).map(conImporte);
  const totalSeg = rows.reduce((s, e) => s + (e.duracion_seg || 0), 0);
  const totalImporteFact = r2(rows.filter(e => e.facturable && e.importe != null).reduce((s, e) => s + e.importe, 0));
  const finalizadas = rows.filter(e => !e.corriendo);
  return { entradas: rows, total_seg: totalSeg, total_horas: r2(totalSeg / 3600), total_importe_facturable: totalImporteFact, n: finalizadas.length };
}

export function createTiempoRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const actorDe = c => ({ userId: c.get('session')?.userId, esAdmin: !!(c.get('isOwner') || c.get('isAdmin')) });

  // ── API ──────────────────────────────────────────────────────────────────────
  // Se envuelve en un objeto { corriendo } A PROPÓSITO: el helper `api()` compartido convierte un cuerpo
  // JSON `null` en `{}` (trata el 200 vacío como éxito), y eso haría creer a la pantalla que SIEMPRE hay
  // un cronómetro en marcha (deshabilitando "Empezar"). Con el objeto, `corriendo` es la entrada o null.
  api.get('/activo', requirePerm('tiempo.read'), c => {
    try { return c.json({ corriendo: corriendoDe(db, c.get('session')?.userId) }); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.get('/', requirePerm('tiempo.read'), c => {
    try {
      const q = c.req.query('desde');
      const lunes = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? lunesDe(q) : lunesDe(hoyLocal());
      return c.json({ desde: lunes, entradas: semanaDe(db, c.get('session')?.userId, lunes) });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.get('/proyecto/:id', requirePerm('tiempo.read'), c => {
    try { return c.json(tiempoDeProyecto(db, c.req.param('id'))); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/start', requirePerm('tiempo.edit'), validate(tiempoStartSchema), c => {
    try {
      const r = startTimer(db, c.get('session')?.userId, c.get('validated'));
      logActivity(db, c.get('session'), 'Arrancó cronómetro', ENTITY.TIME_ENTRY, r.id, r.proyecto_nombre || '');
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/stop', requirePerm('tiempo.edit'), c => {
    try {
      const r = stopTimer(db, c.get('session')?.userId);
      logActivity(db, c.get('session'), 'Paró cronómetro', ENTITY.TIME_ENTRY, r.id, r.proyecto_nombre || '');
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/', requirePerm('tiempo.edit'), validate(tiempoManualSchema), c => {
    try {
      const r = createEntry(db, c.get('session')?.userId, c.get('validated'));
      logActivity(db, c.get('session'), 'Registró tiempo', ENTITY.TIME_ENTRY, r.id, r.proyecto_nombre || '');
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.put('/:id', requirePerm('tiempo.edit'), validate(tiempoManualSchema), c => {
    try {
      const r = updateEntry(db, actorDe(c), c.req.param('id'), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó entrada de tiempo', ENTITY.TIME_ENTRY, r.id, r.proyecto_nombre || '');
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.delete('/:id', requirePerm('tiempo.edit'), c => {
    try {
      const r = deleteEntry(db, actorDe(c), c.req.param('id'));
      logActivity(db, c.get('session'), 'Eliminó entrada de tiempo', ENTITY.TIME_ENTRY, r.id, '');
      return c.json({ message: 'Eliminada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── VISTA SEMANAL (server-rendered, con candado) ─────────────────────────────
  views.get('/', requirePerm('tiempo.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const puedeEditar = can(c, 'tiempo.edit');
    const q = c.req.query('desde');
    const lunes = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? lunesDe(q) : lunesDe(hoyLocal());
    const prev = sumarDias(lunes, -7), next = sumarDias(lunes, 7), hoy = hoyLocal();
    const proyectoOptions = db.prepare("SELECT id, codigo, nombre FROM proyectos WHERE active=1 ORDER BY nombre").all()
      .map(p => '<option value="' + p.id + '">' + escHtml((p.codigo ? p.codigo + ' · ' : '') + p.nombre) + '</option>').join('');
    const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

    const content = `
      <div class="ph"><h2>Registro de tiempo</h2>
        <div style="display:flex;gap:.5rem;align-items:center">
          <a class="btn btn-secondary btn-sm" href="?desde=${prev}">← Semana anterior</a>
          <span style="color:var(--muted);font-size:.85rem" id="tSemLabel">Semana del ${fechaEs(lunes)}</span>
          <a class="btn btn-secondary btn-sm" href="?desde=${next}">Siguiente →</a>
          <a class="btn btn-secondary btn-sm" href="/admin/tiempo">Hoy</a>
        </div>
      </div>

      ${puedeEditar ? `<div class="card" style="margin-bottom:1rem"><div class="card-body">
        <div id="tTimerBox" style="display:flex;gap:.6rem;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:200px;margin:0"><label class="form-label">Proyecto</label>
            <select class="form-control" id="tProyecto">${proyectoOptions || '<option value="">— No hay proyectos —</option>'}</select></div>
          <div class="form-group" style="flex:2;min-width:200px;margin:0"><label class="form-label">¿En qué trabajas?</label>
            <input class="form-control" id="tDesc" placeholder="Descripción corta" maxlength="300"></div>
          <button class="btn btn-primary" id="tBtnStart" onclick="tStart()">▶ Empezar</button>
          <button class="btn btn-secondary" id="tBtnManual" onclick="tOpenManual()">+ Entrada manual</button>
        </div>
        <div id="tRunning" style="display:none;margin-top:.75rem;padding:.6rem .8rem;background:var(--accent-soft);border-radius:8px;display:none;align-items:center;justify-content:space-between;gap:.5rem">
          <span id="tRunningTx" style="color:var(--text)"></span>
          <span style="display:flex;align-items:center;gap:.75rem"><strong id="tRunningClock" style="font-family:monospace;font-size:1.1rem">0:00:00</strong>
          <button class="btn btn-danger btn-sm" onclick="tStop()">■ Parar</button></span>
        </div>
      </div></div>` : ''}

      <div id="tBody"><div class="card"><div class="card-body" style="color:var(--muted)">Cargando…</div></div></div>

      <div class="modal-overlay" id="tModal">
        <div class="modal" style="max-width:560px">
          <div class="modal-head"><h3 id="tModalTitle">Entrada manual</h3><button class="modal-close" onclick="closeModal('tModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="tId">
            <div class="form-group"><label class="form-label">Proyecto *</label><select class="form-control" id="tmProyecto">${proyectoOptions}</select></div>
            <div class="form-group"><label class="form-label">Descripción</label><input class="form-control" id="tmDesc" maxlength="300"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Fecha *</label><input class="form-control" id="tmFecha" type="date"></div>
              <div class="form-group"><label class="form-label">Horas</label><input class="form-control" id="tmHoras" type="number" min="0" step="1" value="0"></div>
              <div class="form-group"><label class="form-label">Minutos</label><input class="form-control" id="tmMin" type="number" min="0" max="59" step="1" value="0"></div>
            </div>
            <div class="form-group"><label style="display:flex;align-items:center;gap:.5rem"><input type="checkbox" id="tmFact" checked> Facturable</label></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('tModal')">Cancelar</button><button class="btn btn-primary" onclick="tSaveManual()">Guardar</button></div>
        </div>
      </div>

      <script>
      const T_SYM=${JSON.stringify(sym)}, T_LUNES=${JSON.stringify(lunes)}, T_HOY=${JSON.stringify(hoy)}, T_EDIT=${puedeEditar ? 'true' : 'false'};
      const T_DIAS=${JSON.stringify(dias)};
      // El dinero, escrito como en España. window.eur vive en layout.js.
      const eur=v=>window.eur(v||0, T_SYM);
      const fmtDur=s=>{ s=Math.max(0,Math.round(s||0)); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h+'h '+(m<10?'0':'')+m+'m'; };
      const clock=s=>{ s=Math.max(0,Math.round(s||0)); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=s%60; return h+':'+(m<10?'0':'')+m+':'+(x<10?'0':'')+x; };
      let T_ENTRIES=[], T_RUN=null, T_TICK=null;

      async function tCargar(){
        const d=await api('GET','/api/erp/tiempo?desde='+T_LUNES).catch(()=>({entradas:[]}));
        T_ENTRIES=d.entradas||[]; tRender();
        if(T_EDIT){ const _a=await api('GET','/api/erp/tiempo/activo').catch(()=>null); T_RUN=(_a&&_a.corriendo)?_a.corriendo:null; tRenderRun(); }
      }
      function tRenderRun(){
        const box=document.getElementById('tRunning'); if(!box) return;
        if(T_TICK){ clearInterval(T_TICK); T_TICK=null; }
        if(!T_RUN){ box.style.display='none'; document.getElementById('tBtnStart').disabled=false; return; }
        box.style.display='flex'; document.getElementById('tBtnStart').disabled=true;
        document.getElementById('tRunningTx').textContent='⏱ '+(T_RUN.proyecto_nombre||'')+(T_RUN.descripcion?' · '+T_RUN.descripcion:'');
        const t0=Date.parse(T_RUN.started_at);
        const upd=()=>{ document.getElementById('tRunningClock').textContent=clock((Date.now()-t0)/1000); };
        upd(); T_TICK=setInterval(upd,1000);
      }
      function tRender(){
        const body=document.getElementById('tBody');
        // Agrupar por día (de la semana), lunes→domingo.
        let totalSeg=0, totalImp=0;
        const porDia={};
        for(const e of T_ENTRIES){ (porDia[e.fecha]=porDia[e.fecha]||[]).push(e); if(!e.corriendo){ totalSeg+=e.duracion_seg||0; if(e.facturable&&e.importe!=null) totalImp+=e.importe; } }
        let html='<div class="card" style="margin-bottom:1rem"><div class="card-body" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem">'
          +'<strong>Total de la semana: '+fmtDur(totalSeg)+'</strong>'
          +'<span style="color:var(--muted)">Facturable: <strong>'+eur(totalImp)+'</strong></span></div></div>';
        let hay=false;
        for(let i=0;i<7;i++){
          const dia=T_ADD(T_LUNES,i); const es=porDia[dia]||[];
          if(!es.length) continue; hay=true;
          const segDia=es.reduce((s,e)=>s+(e.corriendo?0:(e.duracion_seg||0)),0);
          html+='<div class="card" style="margin-bottom:.75rem"><div class="card-head"><h3>'+T_DIAS[i]+' '+dia+' <span style="color:var(--muted);font-weight:400;font-size:.8rem">('+fmtDur(segDia)+')</span></h3></div>'
            +'<div class="table-wrap"><table><thead><tr><th>Proyecto</th><th>Descripción</th><th>Duración</th><th>Facturable</th><th>Importe</th>'+(T_EDIT?'<th></th>':'')+'</tr></thead><tbody>'
            +es.map(tRow).join('')+'</tbody></table></div></div>';
        }
        if(!hay) html+='<div class="card"><div class="card-body" style="color:var(--muted)">Sin tiempo registrado esta semana. '+(T_EDIT?'Arranca el cronómetro o añade una entrada manual.':'')+'</div></div>';
        body.innerHTML=html;
      }
      function tRow(e){
        const imp = e.corriendo ? '<span style="color:var(--muted)">en marcha…</span>' : (e.sin_tarifa?'<span style="color:var(--muted)" title="Sin tarifa: pon la tarifa/hora de la persona en Usuarios">— sin tarifa</span>':eur(e.importe));
        // Facturada = ya cobrada en una factura emitida: candado, no botones (se libera sola si se anula la factura).
        const fact = e.facturada?('<span class="badge b-blue" title="Facturada en '+escHtml(e.invoice_number||'')+'">🔒 Facturada</span>')
          : (e.facturable?'<span class="badge b-green">Sí</span>':'<span class="badge b-gray">No</span>');
        const acc = (T_EDIT && !e.corriendo && !e.facturada) ? '<button class="btn btn-secondary btn-sm" onclick="tEdit('+e.id+')">Editar</button> <button class="btn btn-danger btn-sm" onclick="tDel('+e.id+')">Eliminar</button>' : '';
        return '<tr><td><strong>'+escHtml(e.proyecto_nombre||'')+'</strong>'+(e.proyecto_codigo?'<br><span style="color:var(--muted);font-size:.75rem;font-family:monospace">'+escHtml(e.proyecto_codigo)+'</span>':'')+'</td>'
          +'<td>'+escHtml(e.descripcion||'—')+'</td>'
          +'<td style="white-space:nowrap">'+(e.corriendo?'<span style="color:var(--accent)">⏱ corriendo</span>':fmtDur(e.duracion_seg))+'</td>'
          +'<td>'+fact+'</td><td style="white-space:nowrap">'+imp+'</td>'+(T_EDIT?'<td style="white-space:nowrap;text-align:right">'+acc+'</td>':'')+'</tr>';
      }
      function T_ADD(iso,n){ const d=new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }

      async function tStart(){
        const proyecto_id=document.getElementById('tProyecto').value; if(!proyecto_id){ toast('Elige un proyecto','err'); return; }
        try{ await api('POST','/api/erp/tiempo/start',{proyecto_id,descripcion:document.getElementById('tDesc').value}); document.getElementById('tDesc').value=''; toast('Cronómetro en marcha'); tCargar(); }catch(e){ toast(e.message,'err'); }
      }
      async function tStop(){ try{ await api('POST','/api/erp/tiempo/stop'); toast('Cronómetro parado'); tCargar(); }catch(e){ toast(e.message,'err'); } }
      function tOpenManual(){
        document.getElementById('tModalTitle').textContent='Entrada manual';
        document.getElementById('tId').value=''; document.getElementById('tmDesc').value='';
        document.getElementById('tmProyecto').value=document.getElementById('tProyecto').value||'';
        document.getElementById('tmFecha').value=T_HOY; document.getElementById('tmHoras').value=0; document.getElementById('tmMin').value=0; document.getElementById('tmFact').checked=true;
        openModal('tModal');
      }
      function tEdit(id){
        const e=T_ENTRIES.find(x=>x.id===id); if(!e) return;
        document.getElementById('tModalTitle').textContent='Editar entrada';
        document.getElementById('tId').value=id; document.getElementById('tmProyecto').value=e.proyecto_id; document.getElementById('tmDesc').value=e.descripcion||'';
        document.getElementById('tmFecha').value=e.fecha; document.getElementById('tmHoras').value=Math.floor((e.duracion_seg||0)/3600); document.getElementById('tmMin').value=Math.floor(((e.duracion_seg||0)%3600)/60);
        document.getElementById('tmFact').checked=!!e.facturable; openModal('tModal');
      }
      async function tSaveManual(){
        const id=document.getElementById('tId').value;
        const body={proyecto_id:document.getElementById('tmProyecto').value,descripcion:document.getElementById('tmDesc').value,fecha:document.getElementById('tmFecha').value,horas:parseInt(document.getElementById('tmHoras').value)||0,minutos:parseInt(document.getElementById('tmMin').value)||0,facturable:document.getElementById('tmFact').checked};
        try{ if(id) await api('PUT','/api/erp/tiempo/'+id,body); else await api('POST','/api/erp/tiempo',body); closeModal('tModal'); toast(id?'Actualizada':'Registrada'); tCargar(); }catch(e){ toast(e.message,'err'); }
      }
      async function tDel(id){ if(!await window.confirmarEnPagina({titulo:'Eliminar la entrada de tiempo',texto:'Se oculta de la lista. El dato se conserva.',aceptar:'Sí, eliminarla'}))return; try{ await api('DELETE','/api/erp/tiempo/'+id); toast('Eliminada'); tCargar(); }catch(e){ toast(e.message,'err'); } }
      tCargar();
      </script>`;
    return c.html(adminLayout('Registro de tiempo', content, 'tiempo', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
