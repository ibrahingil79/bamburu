import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, skeletonRows } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { escHtml } from '../../../core/escape.js';
import { sendEmail } from '../../../core/mailer.js';
import { opportunitySchema, opportunityStageSchema, closeOpportunitySchema, clientActivitySchema } from '../schemas.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { exigirCorreoActivo } from '../avisos-preferencias.js';   // interruptor de Ajustes → Avisos y correos
import { hoyLocal } from '../avisos.js';   // el reloj del negocio, uno solo para todo
// PUNTO 13 · la agenda del CRM. El motor vive aparte; aquí solo la puerta.
import { crearTarea, getTarea, listarTareas, marcarHecha, anularTarea, reprogramar } from '../crm-tareas.js';
import {
  ETAPAS, ETAPA_LABEL, ORIGENES, ORIGEN_LABEL, MOTIVOS_PERDIDA, MOTIVO_PERDIDA_LABEL,
  CANALES, CANAL_LABEL, URGENCIA_LABEL,
  pipelineByStage, salesWorklist, clientCrmSummary, clientTimeline,
  opportunityActivities, opportunityProximaAccion, opportunityEmail, getOpportunityOr404,
  createOpportunitySvc, updateOpportunitySvc, moveOpportunityStageSvc, closeOpportunitySvc,
  reopenOpportunitySvc, archiveOpportunitySvc, restoreOpportunitySvc, registerClientActivitySvc,
} from '../crm.js';
import { fechaEs } from '../voz.js';   // la fecha, en cristiano (24/08/2026)
import { fmtEur as dineroEs } from '../margen.js';   // el dinero, como en España

// ════════════════════════════════════════════════════════════════════════════
// CRM COMERCIAL — pantalla del embudo (/admin/crm) y su API.
//
// Dos vistas sobre EL MISMO motor (crm.js), como Cobros: el EMBUDO (Kanban, "dónde está
// cada venta") y la COLA (worklist priorizado, "a quién llamo hoy"). Ninguna calcula nada:
// las dos leen de pipelineByStage()/salesWorklist(). Cero lógica duplicada.
//
// Las escrituras van TODAS por los servicios validados de crm.js — los mismos que usa DISA.
// La ruta solo añade permiso, log de actividad y código HTTP (patrón T5/cobros).
// ════════════════════════════════════════════════════════════════════════════
export function createCrmRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  // EL RELOJ DEL NEGOCIO, NO EL DE UTC (23 ago 2026, punto 13). Esto era
  // `new Date().toISOString()`, y a partir de las 22:00 de Madrid en verano devuelve el día
  // ANTERIOR: la pantalla de tareas enseñaba «para hoy» una tarea del día pasado, y la cola de
  // trabajo medía los retrasos contra un día que no era. hoyLocal() es el mismo reloj que usan
  // la agenda, los avisos y el fichaje — que es de lo que se trata: uno solo.
  const hoy = () => hoyLocal();
  const userName = c => c.get('session')?.userName || '';

  // ── API: LECTURA ────────────────────────────────────────────────
  // GET /api/erp/crm — el embudo por columnas (con suma de valor por etapa).
  api.get('/', requirePerm('crm.read'), c => {
    try { return c.json(pipelineByStage(db, hoy())); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // GET /api/erp/crm/worklist — cola de trabajo comercial priorizada. ANTES de '/:id'.
  api.get('/worklist', requirePerm('crm.read'), c => {
    try { return c.json(salesWorklist(db, hoy())); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Timeline unificado y resumen CRM de un cliente. Rutas de 3 segmentos: no chocan con '/:id'.
  // El timeline mezcla CUATRO fuentes con CUATRO permisos distintos. `crm.read` NO puede ser la
  // llave maestra que revele facturas y cobros: se trocean las fuentes por lo que ESTE usuario
  // puede ver (el contrato `opts.include` que documenta clientTimeline en crm.js). Sin esto, la
  // ruta sería la puerta trasera que el propio motor advierte que no debe existir.
  api.get('/clients/:cid/timeline', requirePerm('crm.read'), c => {
    try {
      const include = {
        oportunidades: true, actividad: true,              // ya exigidas por crm.read
        quotes:    can(c, 'quotes.read'),
        orders:    can(c, 'pedidos.read'),
        albaranes: can(c, 'albaranes.read'),
        invoices:  can(c, 'invoices.read'),
        cobros:    can(c, 'cobros.read'),
      };
      return c.json(clientTimeline(db, parseInt(c.req.param('cid')), hoy(), { include }));
    }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  api.get('/clients/:cid/summary', requirePerm('crm.read'), c => {
    try { return c.json(clientCrmSummary(db, parseInt(c.req.param('cid')), hoy())); }
    catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── PUNTO 13 · TAREAS. Van ANTES de '/:id': Hono casa por orden de registro, y '/tareas' se lo
  // comería la ruta del id. Es el mismo tropiezo que ya costó el '/cuadro/orden' de la ficha E.
  api.get('/tareas', requirePerm('crm.read'), c => {
    const estado = c.req.query('estado');
    return c.json(listarTareas(db, {
      estado: estado === 'todas' ? null : (estado || 'pendiente'),
      userId: c.req.query('mias') === '1' ? (c.get('session')?.userId || null) : null,
      clientId: c.req.query('cliente') ? Number(c.req.query('cliente')) : null,
      hoy: hoy(),
    }));
  });
  api.post('/tareas', requirePerm('crm.manage'), async c => {
    try {
      const b = await c.req.json();
      const r = crearTarea(db, { ...b, created_by: c.get('session')?.userId || null });
      logActivity(db, c.get('session'), 'Creó una tarea comercial', ENTITY.CRM_TAREA, r.id, r.titulo);
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/tareas/:id/hecha', requirePerm('crm.manage'), async c => {
    try {
      const b = await c.req.json().catch(() => ({}));
      const r = marcarHecha(db, Number(c.req.param('id')), { resultado: b.resultado || '', por: c.get('session')?.userId || null });
      logActivity(db, c.get('session'), 'Cerró una tarea comercial', ENTITY.CRM_TAREA, r.id, String(b.resultado || ''));
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.post('/tareas/:id/reprogramar', requirePerm('crm.manage'), async c => {
    try { const b = await c.req.json();
      return c.json(reprogramar(db, Number(c.req.param('id')), b.fecha)); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });
  api.delete('/tareas/:id', requirePerm('crm.manage'), async c => {
    try { const b = await c.req.json().catch(() => ({}));
      const r = anularTarea(db, Number(c.req.param('id')), b.motivo);
      logActivity(db, c.get('session'), 'Anuló una tarea comercial', ENTITY.CRM_TAREA, r.id, String(b.motivo || ''));
      return c.json(r); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.get('/:id', requirePerm('crm.read'), c => {
    try {
      const o = getOpportunityOr404(db, c.req.param('id'));
      const cl = db.prepare('SELECT id, name, email FROM clients WHERE id=?').get(o.client_id) || {};
      return c.json({
        ...o, client_name: cl.name || '', client_email: cl.email || '', has_email: !!cl.email,
        proximaAccion: opportunityProximaAccion(db, o, hoy()),
        actividad: opportunityActivities(db, o.id).slice().reverse(),
      });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Plantilla de email de seguimiento, precargada y EDITABLE antes de enviar (espejo del
  // preview de cobros). Nada se envía aquí: solo construye.
  api.get('/:id/email-preview', requirePerm('crm.read'), c => {
    try {
      const o = getOpportunityOr404(db, c.req.param('id'));
      const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(o.client_id) || {};
      const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
      const prox = opportunityProximaAccion(db, o, hoy());
      const tono = (prox && prox.tono) || 'primer-contacto';
      const tpl = opportunityEmail(tono, { client: cl, company, opp: o, db });
      return c.json({ subject: tpl.subject, text: tpl.text, tono, to: cl.email || '', has_email: !!cl.email, client_id: cl.id });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  // ── API: ESCRITURA (todo por servicio validado; crm.manage) ─────
  api.post('/', requirePerm('crm.manage'), validate(opportunitySchema), c => {
    try {
      const r = createOpportunitySvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó oportunidad', ENTITY.OPPORTUNITY, r.id, r.title);
      return c.json(r, 201);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  api.put('/:id', requirePerm('crm.manage'), validate(opportunitySchema), c => {
    try {
      const r = updateOpportunitySvc(db, c.req.param('id'), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó oportunidad', ENTITY.OPPORTUNITY, r.id, r.title);
      return c.json({ message: 'Actualizado' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  // Mover de etapa (el drop del Kanban). Solo etapas ABIERTAS: soltar en Ganada/Perdida va
  // por /close, que exige motivo — el esquema lo impide, no la buena voluntad del front.
  api.post('/:id/stage', requirePerm('crm.manage'), validate(opportunityStageSchema), c => {
    try {
      const d = c.get('validated');
      const r = moveOpportunityStageSvc(db, c.req.param('id'), d.stage, { note: d.note, userName: userName(c) });
      logActivity(db, c.get('session'), 'Movió oportunidad de etapa', ENTITY.OPPORTUNITY, r.id,
        r.title + ': ' + (ETAPA_LABEL[r.from] || r.from) + ' → ' + (ETAPA_LABEL[r.to] || r.to));
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  api.post('/:id/close', requirePerm('crm.manage'), validate(closeOpportunitySchema), c => {
    try {
      const d = c.get('validated');
      const r = closeOpportunitySvc(db, c.req.param('id'), d, { userName: userName(c) });
      logActivity(db, c.get('session'), r.status === 'ganada' ? 'Ganó una oportunidad' : 'Perdió una oportunidad',
        ENTITY.OPPORTUNITY, r.id, r.title + (r.lost_reason ? ' — ' + (MOTIVO_PERDIDA_LABEL[r.lost_reason] || r.lost_reason) : ''));
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  api.post('/:id/reopen', requirePerm('crm.manage'), c => {
    try {
      const r = reopenOpportunitySvc(db, c.req.param('id'), { userName: userName(c) });
      logActivity(db, c.get('session'), 'Reabrió oportunidad', ENTITY.OPPORTUNITY, r.id, r.title);
      return c.json(r);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  // Archivar, NUNCA borrar (regla permanente).
  api.delete('/:id', requirePerm('crm.manage'), c => {
    try {
      const r = archiveOpportunitySvc(db, c.req.param('id'));
      logActivity(db, c.get('session'), 'Archivó oportunidad', ENTITY.OPPORTUNITY, r.id, r.title);
      return c.json({ message: 'Archivada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });
  api.post('/:id/restore', requirePerm('crm.manage'), c => {
    try {
      const r = restoreOpportunitySvc(db, c.req.param('id'));
      logActivity(db, c.get('session'), 'Restauró oportunidad', ENTITY.OPPORTUNITY, r.id, r.title);
      return c.json({ message: 'Restaurada' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  // Registrar ACTIVIDAD de un cliente (con o sin oportunidad; NUNCA necesita factura).
  // type='email' envía por Resend con el mailer compartido (mismo que cobros) y replyTo al dueño.
  api.post('/clients/:cid/activities', requirePerm('crm.manage'), validate(clientActivitySchema), async c => {
    try {
      const d = c.get('validated');
      // Interruptor de Ajustes → Avisos y correos: solo cuando la actividad ES un envío de correo
      // (una nota o un compromiso no mandan nada y no tienen por qué mirar el interruptor).
      if (d.type === 'email') exigirCorreoActivo(db, 'comercial');
      const r = await registerClientActivitySvc(db, parseInt(c.req.param('cid')), d, { sendEmail, userName: userName(c) });
      const label = d.type === 'email' ? 'Envió email a un cliente'
        : d.type === 'compromiso' ? 'Registró un compromiso con un cliente'
        : d.type === 'nota' ? 'Anotó algo de un cliente' : 'Registró contacto con un cliente';
      logActivity(db, c.get('session'), label, ENTITY.CLIENT, r.client_id, r.client_name + (d.note ? ' · ' + d.note : ''));
      return c.json(r, 201);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  // ── VISTAS ──────────────────────────────────────────────────────
  const sym = () => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';

  // Datos que el front necesita como listas cerradas: salen del motor, no se escriben a mano.
  const stageOptions  = ETAPAS.map(e => `<option value="${e.key}">${escHtml(e.label)}</option>`).join('');
  const sourceOptions = ORIGENES.map(o => `<option value="${o}">${escHtml(ORIGEN_LABEL[o])}</option>`).join('');
  const lostOptions   = MOTIVOS_PERDIDA.map(m => `<option value="${m}">${escHtml(MOTIVO_PERDIDA_LABEL[m])}</option>`).join('');
  const channelOptions = CANALES.filter(x => x !== 'email' && x !== 'nota')
    .map(x => `<option value="${x}">${escHtml(CANAL_LABEL[x])}</option>`).join('');

  const tabs = (active) => `<div class="tabs">
      <a href="/admin/crm" class="tab${active === 'embudo' ? ' active' : ''}">Embudo</a>
      <a href="/admin/crm/cola" class="tab${active === 'cola' ? ' active' : ''}">Cola de trabajo</a>
      <a href="/admin/crm/tareas" class="tab${active === 'tareas' ? ' active' : ''}">Tareas</a>
    </div>`;

  // CSS del tablero. Vive aquí (no en layout.js) porque solo esta pantalla lo usa: el resto de
  // la app no tiene Kanban. Reutiliza los TOKENS (--accent, --border2, --radius-lg…): cero
  // colores nuevos, cero azules distintos del #2F6BFF aprobado.
  const kanbanCss = `<style>
    .kb{display:grid;grid-template-columns:repeat(${ETAPAS.length},minmax(240px,1fr));gap:.75rem;align-items:start}
    .kb-col{background:var(--bg3);border:1px solid var(--border2);border-radius:var(--radius-lg);min-height:220px;display:flex;flex-direction:column}
    .kb-col.over{border-color:var(--accent);background:var(--accent-soft);box-shadow:0 0 0 3px rgba(47,107,255,.12)}
    .kb-head{padding:.7rem .85rem;border-bottom:1px solid var(--border2);position:sticky;top:0;background:inherit;border-radius:var(--radius-lg) var(--radius-lg) 0 0}
    .kb-title{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
    .kb-title strong{font-size:.82rem;font-weight:600;color:var(--text)}
    .kb-n{font-size:.7rem;color:var(--text3);background:var(--bg2);border:1px solid var(--border2);border-radius:99px;padding:.05rem .4rem}
    .kb-sum{margin-top:.2rem;font-size:1.02rem;font-weight:600;color:var(--text)}
    .kb-prob{font-size:.68rem;color:var(--text3)}
    .kb-body{padding:.6rem;display:flex;flex-direction:column;gap:.55rem;flex:1}
    .kb-card{background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:.65rem .7rem;cursor:grab;transition:box-shadow .15s,transform .1s}
    .kb-card:hover{box-shadow:0 4px 14px rgba(16,24,40,.08)}
    .kb-card:active{cursor:grabbing}
    .kb-card.dragging{opacity:.45;transform:rotate(1.2deg)}
    .kb-c-t{font-size:.83rem;font-weight:600;color:var(--text);margin-bottom:.15rem;line-height:1.3}
    .kb-c-cl{font-size:.75rem;color:var(--text2);margin-bottom:.4rem}
    .kb-c-v{font-size:.9rem;font-weight:600;color:var(--text)}
    .kb-c-meta{display:flex;align-items:center;justify-content:space-between;gap:.4rem;margin-top:.45rem}
    .kb-c-days{font-size:.68rem;color:var(--text3);white-space:nowrap}
    .kb-c-days.stale{color:var(--warn)}
    .kb-c-prox{margin-top:.45rem;padding-top:.45rem;border-top:1px dashed var(--border2);font-size:.72rem;color:var(--text2);display:flex;align-items:center;gap:.3rem}
    .kb-c-prox.due{color:var(--accent);font-weight:500}
    .kb-empty{font-size:.74rem;color:var(--text3);text-align:center;padding:1.2rem .5rem;border:1px dashed var(--border2);border-radius:10px}
    /* Zonas terminales: NO son columnas del embudo (ganada/perdida es un ESTADO, no una etapa). */
    .kb-term{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:.9rem}
    .kb-drop{border:2px dashed var(--border2);border-radius:var(--radius-lg);padding:.9rem;text-align:center;font-size:.82rem;font-weight:500;color:var(--text2);background:var(--bg2);transition:all .15s}
    .kb-drop .kb-drop-s{display:block;font-size:.7rem;font-weight:400;color:var(--text3);margin-top:.15rem}
    .kb-drop.won.over{border-color:var(--ok);background:var(--ok-s);color:var(--ok)}
    .kb-drop.lost.over{border-color:var(--danger);background:var(--danger-s);color:var(--danger)}
    .kb-kpi{display:flex;gap:1.5rem;flex-wrap:wrap;align-items:baseline}
    .kb-kpi div span{display:block;font-size:.74rem;color:var(--text2)}
    .kb-kpi div strong{font-size:1.35rem;font-weight:600}
    /* Skeleton de carga propio: el compartido (skeletonRows) emite <tr><td>, que dentro de un
       <div> no es HTML válido. Mismo shimmer, misma pieza .skel de U2. */
    .kb-skel{background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:.7rem}
    .kb-skel .skel + .skel{margin-top:.45rem}
    /* Desplegable del buscador de cliente. NO se reusa .rmenu-pop: es position:fixed (menú "···"
       flotante), y aquí hace falta anclado al input. Se oculta solo cuando no hay resultados. */
    .crm-pop{position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.12);padding:6px;max-height:190px;overflow:auto}
    .crm-pop:empty{display:none}
    /* Los resultados del buscador deben LEERSE como clicables (antes parecían texto plano). */
    .crm-pop .rmenu-item{display:block;width:100%;text-align:left;cursor:pointer;padding:.4rem .55rem;border:0;background:none;border-radius:8px;font-size:.85rem;color:var(--text)}
    .crm-pop .rmenu-item:hover{background:var(--accent-soft)}
    .crm-link{background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font:inherit;text-decoration:underline}
    @media(max-width:900px){ .kb{grid-template-columns:1fr;} .kb-col{min-height:0} }
  </style>`;

  // JS compartido por las dos vistas: pintado de tarjetas, modales y llamadas al API.
  // OJO (errores-conocidos.md): NADA de '\\n' dentro de las cadenas que se emiten a este
  // <script>; un salto de línea real partiría el string y tumbaría TODO el bloque.
  const crmScript = (symbol) => `
    const SYM = ${JSON.stringify(symbol)};
    const ETAPA_LABEL = ${JSON.stringify(ETAPA_LABEL)};
    const URGENCIA_LABEL = ${JSON.stringify(URGENCIA_LABEL)};
    const MOTIVO_LABEL = ${JSON.stringify(MOTIVO_PERDIDA_LABEL)};
    const URGENCIA_BADGE = {en_riesgo:'b-red',negociacion:'b-blue',propuesta:'b-blue',cualificado:'b-yellow',nuevo:'b-gray',compromiso:'b-green'};
    const money = n => dineroEs(n||0, SYM);

    function proxBadge(p){
      if(!p) return '';
      return '<span class="badge '+(URGENCIA_BADGE[p.etapa]||'b-gray')+'">'+escHtml(URGENCIA_LABEL[p.etapa]||p.etapa)+'</span>';
    }
    function proxTexto(p){
      if(!p) return 'Sin acción';
      if(p.accion==='seguimiento') return 'Toca seguimiento';
      if(p.accion==='revisar') return 'Revisar: el cierre previsto ya pasó';
      if(p.etapa==='compromiso') return 'Esperando (hay compromiso)';
      return 'Al día';
    }

    // ── Modal: nueva / editar oportunidad ────────────────────────────────
    let editingId = null;
    async function openNewOpp(stage){
      editingId = null;
      document.getElementById('oppModalTitle').textContent = 'Nueva oportunidad';
      document.getElementById('oTitle').value='';
      document.getElementById('oAmount').value='';
      document.getElementById('oClient').value='';
      document.getElementById('oClientId').value='';
      document.getElementById('oStage').value = stage || 'nuevo';
      document.getElementById('oStageRow').style.display='';
      document.getElementById('oProb').value='';
      document.getElementById('oClose').value='';
      document.getElementById('oSource').value='';
      document.getElementById('oNotes').value='';
      document.getElementById('oCliList').innerHTML='';
      if(document.getElementById('oNewCli')) document.getElementById('oNewCli').style.display='none';
      openModal('oppModal');
    }
    async function openEditOpp(id){
      let o; try{ o = await api('GET','/api/erp/crm/'+id); }catch(e){ toast(e.message,'err'); return; }
      editingId = id;
      document.getElementById('oppModalTitle').textContent = 'Editar oportunidad';
      document.getElementById('oTitle').value=o.title||'';
      document.getElementById('oAmount').value=Number(o.amount||0);
      document.getElementById('oClient').value=o.client_name||'';
      document.getElementById('oClientId').value=o.client_id;
      document.getElementById('oStageRow').style.display='none';   // la etapa se mueve arrastrando, y deja registro
      document.getElementById('oProb').value=o.probability;
      document.getElementById('oClose').value=o.expected_close_date||'';
      document.getElementById('oSource').value=o.source||'';
      document.getElementById('oNotes').value=o.notes||'';
      openModal('oppModal');
    }
    async function saveOpp(){
      const body = {
        client_id: document.getElementById('oClientId').value,
        title: document.getElementById('oTitle').value,
        amount: document.getElementById('oAmount').value||0,
        probability: document.getElementById('oProb').value,
        expected_close_date: document.getElementById('oClose').value,
        source: document.getElementById('oSource').value,
        notes: document.getElementById('oNotes').value,
      };
      if(!body.client_id){ toast('Elige un cliente de la lista','err'); return; }
      if(!editingId) body.stage = document.getElementById('oStage').value;
      try{
        if(editingId) await api('PUT','/api/erp/crm/'+editingId, body);
        else await api('POST','/api/erp/crm', body);
        closeModal('oppModal'); toast(editingId?'Actualizada':'Oportunidad creada'); reload();
      }catch(e){ toast(e.message,'err'); }
    }

    // Selector de cliente (combobox). Al ENFOCAR el campo muestra tus clientes para ELEGIR (antes solo
    // filtraba al teclear ≥2 caracteres: si no tecleabas, no veías a nadie → "no puedo elegir registrados").
    // Teclear filtra. La selección va en mousedown con preventDefault: se elige ANTES de que el campo
    // pierda el foco, así ningún cierre-por-blur se come el clic (bug que no aparece en pruebas headless).
    let cliTimer=null;
    function cliSearch(){
      clearTimeout(cliTimer);
      const q=document.getElementById('oClient').value.trim();
      document.getElementById('oClientId').value='';
      cliTimer=setTimeout(async()=>{
        let rows=[];
        try{ rows=await api('GET','/api/erp/clients/search?q='+encodeURIComponent(q)+'&limit=20'); }
        catch(e){ document.getElementById('oCliList').innerHTML='<div style="padding:.5rem .6rem;color:var(--danger);font-size:.8rem">No se pudo cargar la lista de clientes.</div>'; return; }
        const crear = PUEDE_CLIENTE
          ? '<button type="button" class="rmenu-item" style="color:var(--accent)" data-crm="cliente-nuevo"><i class="ti ti-plus"></i> Crear '+(q?'«'+escHtml(q)+'» como cliente nuevo':'un cliente nuevo')+'</button>'
          : '';
        const items = rows.map(r=>'<button type="button" class="rmenu-item" data-crm="cliente-elegir" data-id="'+r.id+'">'+escHtml(r.name)+(r.fiscal_id?' <span style="color:var(--muted)">'+escHtml(r.fiscal_id)+'</span>':'')+'</button>').join('');
        const vacio = '<div style="padding:.5rem .6rem;color:var(--muted);font-size:.8rem">'+(q?'Ningún cliente con «'+escHtml(q)+'».':'Aún no tienes clientes registrados.')+'</div>';
        document.getElementById('oCliList').innerHTML = (rows.length ? items : vacio) + crear;
      }, q?200:0);
    }
    // Cierra el desplegable al salir del campo, con margen para que el mousedown de un resultado gane.
    function cliBlur(){ setTimeout(function(){ const el=document.getElementById('oCliList'); if(el) el.innerHTML=''; }, 200); }
    // ── Crear cliente EN LÍNEA (arregla el callejón sin salida: si el cliente no existe, se crea
    // aquí mismo sin salir de la oportunidad). Usa el POST validado de clientes (permiso propio).
    function showNewClient(){
      const box=document.getElementById('oNewCli'); if(!box) return;
      document.getElementById('oCliList').innerHTML='';
      document.getElementById('ncName').value=(document.getElementById('oClient').value||'').trim();
      document.getElementById('ncEmail').value='';
      document.getElementById('ncPhone').value='';
      document.getElementById('ncType').value='particular';
      box.style.display='';
      document.getElementById('ncName').focus();
    }
    function hideNewClient(){ const b=document.getElementById('oNewCli'); if(b) b.style.display='none'; }
    async function createInlineClient(){
      const name=(document.getElementById('ncName').value||'').trim();
      if(!name){ toast('El cliente necesita al menos un nombre','err'); return; }
      const body={ name, email:document.getElementById('ncEmail').value, phone:document.getElementById('ncPhone').value, client_type:document.getElementById('ncType').value };
      try{
        const r=await api('POST','/api/erp/clients', body);
        document.getElementById('oClientId').value=r.id;
        document.getElementById('oClient').value=name;
        document.getElementById('oCliList').innerHTML='';
        hideNewClient();
        toast('Cliente creado');
      }catch(e){ toast(e.message,'err'); }
    }
    function pickClient(id, el){
      document.getElementById('oClientId').value=id;
      document.getElementById('oClient').value=el.textContent.trim();
      document.getElementById('oCliList').innerHTML='';
    }

    // ── Cierre: GANADA / PERDIDA (estados terminales, con su registro) ───
    let closingId=null;
    function openClose(id, status){
      closingId=id;
      const perdida = status==='perdida';
      document.getElementById('closeTitle').textContent = perdida ? 'Dar por perdida' : 'Marcar como ganada';
      document.getElementById('closeStatus').value = status;
      document.getElementById('lostBlock').style.display = perdida ? '' : 'none';
      document.getElementById('cReason').value='';
      document.getElementById('cNote').value='';
      document.getElementById('closeBtn').textContent = perdida ? 'Dar por perdida' : 'Sí, la he ganado';
      document.getElementById('closeBtn').className = 'btn ' + (perdida ? 'btn-secondary' : 'btn-primary');
      document.getElementById('closeHint').textContent = perdida
        ? 'Sin motivo no se pierde nada: si no sabes por qué se cayó, dentro de un año el embudo no te dirá nada.'
        : 'Se cerrará como ganada. Conserva la etapa en la que estaba.';
      onReasonChange();
      openModal('closeModal');
    }
    function onReasonChange(){
      const otro = document.getElementById('cReason').value==='otro';
      document.getElementById('cNoteLabel').textContent = otro ? 'Cuéntame qué pasó *' : 'Nota (opcional)';
    }
    async function doClose(){
      const status=document.getElementById('closeStatus').value;
      const body={status, note:document.getElementById('cNote').value};
      if(status==='perdida') body.lost_reason=document.getElementById('cReason').value;
      try{
        await api('POST','/api/erp/crm/'+closingId+'/close', body);
        closeModal('closeModal'); toast(status==='ganada'?'¡Ganada!':'Registrada como perdida'); reload();
      }catch(e){ toast(e.message,'err'); }
    }

    async function reopenOpp(id){
      if(!await window.confirmarEnPagina({titulo:'Reabrir la oportunidad',texto:'Vuelve al embudo, en la etapa en la que estaba.',aceptar:'Sí, reabrirla'})) return;
      try{ await api('POST','/api/erp/crm/'+id+'/reopen'); toast('Reabierta'); reload(); }catch(e){ toast(e.message,'err'); }
    }
    async function archiveOpp(id){
      if(!await window.confirmarEnPagina({titulo:'Archivar la oportunidad',texto:'Sale del embudo. No se borra: se puede reabrir.',aceptar:'Sí, archivarla'})) return;
      try{ await api('DELETE','/api/erp/crm/'+id); toast('Archivada'); reload(); }catch(e){ toast(e.message,'err'); }
    }

    // ── Registrar actividad / enviar email desde la oportunidad ──────────
    let actOppId=null, actClientId=null;
    async function openActividad(oppId){
      let o; try{ o=await api('GET','/api/erp/crm/'+oppId); }catch(e){ toast(e.message,'err'); return; }
      actOppId=oppId; actClientId=o.client_id;
      const p=o.proximaAccion;
      document.getElementById('actTitle').textContent='Seguimiento — '+o.title;
      // La oportunidad LLEGA CON EL TRABAJO HECHO (CANON §2.3): la propuesta ya está calculada.
      document.getElementById('actProx').innerHTML = p
        ? '<div class="disa-band"><span class="db-ic"><i class="ti ti-sparkles"></i></span><span class="db-tx"><strong>Próxima acción:</strong> '
          +proxBadge(p)+' '+escHtml(proxTexto(p))+(p.fechaObjetivo?' <span style="color:var(--muted)">· '+escHtml(p.fechaObjetivo)+'</span>':'')
          +'<div style="color:var(--muted);font-size:.8rem;margin-top:.2rem">'+escHtml(p.motivo||'')+'</div></span></div>'
        : '';
      document.getElementById('actEmailBtn').style.display = o.has_email ? '' : 'none';
      document.getElementById('actNoEmail').style.display = o.has_email ? 'none' : '';
      document.getElementById('actForm').innerHTML='';
      const hist = (o.actividad||[]).slice(0,12);
      document.getElementById('actHist').innerHTML = hist.length
        ? '<h4 style="margin:1rem 0 .5rem;font-size:.85rem">Historial</h4>'+hist.map(a=>
            '<div style="display:flex;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.8rem">'
            +'<span style="color:var(--muted);white-space:nowrap">'+escHtml(String(a.created_at).slice(0,10))+'</span>'
            +'<span>'+escHtml(a.type)+(a.channel?' · '+escHtml(a.channel):'')+(a.note?' — '+escHtml(a.note):'')+'</span></div>').join('')
        : '';
      openModal('actModal');
    }
    function actContacto(){
      document.getElementById('actForm').innerHTML =
        '<div class="form-row" style="margin-top:.75rem">'
        +'<div class="form-group"><label class="form-label">Canal</label><select class="form-control" id="acChannel">${channelOptions}</select></div>'
        +'<div class="form-group" style="flex:1"><label class="form-label">Nota</label><input class="form-control" id="acNote" placeholder="Qué hablasteis (opcional)"></div>'
        +'</div><div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-crm="act-limpiar">Cancelar</button>'
        +'<button class="btn btn-primary btn-sm" data-crm="act-guardar" data-tipo="contacto">Registrar</button></div>';
    }
    function actNota(){
      document.getElementById('actForm').innerHTML =
        '<div class="form-group" style="margin-top:.75rem"><label class="form-label">Nota</label><textarea class="form-control" id="acNote" rows="3"></textarea></div>'
        +'<div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-crm="act-limpiar">Cancelar</button>'
        +'<button class="btn btn-primary btn-sm" data-crm="act-guardar" data-tipo="nota">Guardar nota</button></div>';
    }
    function actCompromiso(){
      const hoy=new Date().toISOString().slice(0,10);
      document.getElementById('actForm').innerHTML =
        '<div class="form-row" style="margin-top:.75rem">'
        +'<div class="form-group"><label class="form-label">Quedasteis para el</label><input type="date" class="form-control" id="acDate" value="'+hoy+'"></div>'
        +'<div class="form-group" style="flex:1"><label class="form-label">Nota</label><input class="form-control" id="acNote" placeholder="(opcional)"></div>'
        +'</div><div style="color:var(--muted);font-size:.78rem;margin-bottom:.5rem">Hasta esa fecha no te propondré insistir.</div>'
        +'<div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-crm="act-limpiar">Cancelar</button>'
        +'<button class="btn btn-primary btn-sm" data-crm="act-guardar" data-tipo="compromiso">Registrar compromiso</button></div>';
    }
    async function actEmail(){
      let prev; try{ prev=await api('GET','/api/erp/crm/'+actOppId+'/email-preview'); }catch(e){ toast(e.message,'err'); return; }
      document.getElementById('actForm').innerHTML =
        '<div style="margin-top:.75rem;color:var(--muted);font-size:.8rem">Para: '+escHtml(prev.to)+' · tono: '+escHtml(prev.tono)+'</div>'
        +'<div class="form-group"><label class="form-label">Asunto</label><input class="form-control" id="acSubject" value="'+escHtml(prev.subject)+'"></div>'
        +'<div class="form-group"><label class="form-label">Mensaje (editable antes de enviar)</label><textarea class="form-control" id="acText" rows="9">'+escHtml(prev.text)+'</textarea></div>'
        +'<div style="display:flex;gap:.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-crm="act-limpiar">Cancelar</button>'
        +'<button class="btn btn-primary btn-sm" id="acSendBtn" data-crm="act-guardar" data-tipo="email">Enviar email</button></div>';
    }
    async function saveActividad(type){
      const g=id=>{const el=document.getElementById(id);return el?el.value:'';};
      const body={type, opportunity_id: actOppId, note:g('acNote')};
      if(type==='contacto') body.channel=g('acChannel');
      if(type==='compromiso') body.commitment_date=g('acDate');
      if(type==='email'){ body.email_subject=g('acSubject'); body.email_text=g('acText');
        const b=document.getElementById('acSendBtn'); if(b){b.disabled=true;b.textContent='Enviando...';} }
      try{
        await api('POST','/api/erp/crm/clients/'+actClientId+'/activities', body);
        closeModal('actModal');
        toast(type==='email'?'Email enviado':'Registrado');
        reload();
      }catch(e){
        toast(e.message,'err');
        const b=document.getElementById('acSendBtn'); if(b){b.disabled=false;b.textContent='Enviar email';}
      }
    }

    // ── 4 SEP 2026 (csp-erp-migrar-handlers) — ENGANCHE COMUN A LAS DOS VISTAS ────────────────
    // Casi todo lo de aqui se pinta despues (las tarjetas, la lista de clientes del buscador, los
    // formularios de seguimiento), asi que va por delegacion. Los fijos de las ventanas tambien,
    // porque las ventanas son las MISMAS en las dos vistas y asi solo hay un sitio que mirar.
    // El menu de fila llega por el evento del armazon: sus botones ya no llevan codigo dentro.
    document.addEventListener('click', function(e){
      var t = e.target.closest('[data-crm]'); if (!t) return;
      var a = t.getAttribute('data-crm'), id = Number(t.getAttribute('data-id'));
      if (a === 'cliente-nuevo') showNewClient();
      else if (a === 'cliente-elegir') pickClient(id, t);
      else if (a === 'cliente-ocultar') hideNewClient();
      else if (a === 'cliente-crear') createInlineClient();
      else if (a === 'act-limpiar') document.getElementById('actForm').innerHTML = '';
      else if (a === 'act-guardar') saveActividad(t.getAttribute('data-tipo'));
      else if (a === 'act-contacto') actContacto();
      else if (a === 'act-compromiso') actCompromiso();
      else if (a === 'act-nota') actNota();
      else if (a === 'act-cerrar') closeModal('actModal');
      else if (a === 'opp-cerrar') closeModal('oppModal');
      else if (a === 'opp-guardar') saveOpp();
      else if (a === 'opp-nueva') openNewOpp();
      else if (a === 'cierre-cerrar') closeModal('closeModal');
      else if (a === 'seguimiento') openActividad(id);
    });
    // Las dos listas de sugerencias del buscador de cliente se elegian con mousedown para
    // adelantarse al blur del campo; sin el preventDefault, el blur cierra la lista antes del clic.
    document.addEventListener('mousedown', function(e){
      var t = e.target.closest('[data-crm="cliente-elegir"], [data-crm="cliente-nuevo"]');
      if (t) e.preventDefault();
    });
    document.addEventListener('rowmenu:act', function(e){
      var a = e.detail.act, id = Number(e.detail.arg);
      if (a === 'nueva-oportunidad') openNewOpp();
      else if (a === 'seguimiento') openActividad(id);
      else if (a === 'editar') openEditOpp(id);
      else if (a === 'ganada') openClose(id, 'ganada');
      else if (a === 'perdida') openClose(id, 'perdida');
      else if (a === 'archivar') archiveOpp(id);
    });
    document.addEventListener('DOMContentLoaded', function(){
      var d = function(sel, ev, fn){ var x = document.querySelector(sel); if (x) x.addEventListener(ev, fn); };
      d('#oClient', 'input', function(){ cliSearch(); });
      d('#oClient', 'focus', function(){ cliSearch(); });
      d('#oClient', 'blur',  function(){ cliBlur(); });
      d('#cReason', 'change', function(){ onReasonChange(); });
      d('#closeBtn', 'click', function(){ doClose(); });
      d('#actEmailBtn', 'click', function(){ actEmail(); });
    });`;

  // Modal "nueva / editar oportunidad" — COMPARTIDO por las dos vistas (antes estaba duplicado, y
  // era donde el usuario se atascaba). Incluye la CREACIÓN DE CLIENTE EN LÍNEA (`puedeCliente`): si
  // el cliente no está registrado, se crea aquí mismo en vez de dejar la oportunidad sin avanzar.
  const oppModalHtml = (s, puedeCliente) => `
      <div class="modal-overlay" id="oppModal"><div class="modal" style="max-width:620px">
        <div class="modal-head"><h3 id="oppModalTitle">Nueva oportunidad</h3><button class="modal-close" data-crm="opp-cerrar">✕</button></div>
        <div class="modal-body">
          <div class="form-group" style="position:relative">
            <label class="form-label">Cliente *</label>
            <input class="form-control" id="oClient" autocomplete="off" placeholder="Haz clic para elegir o escribe para buscar...">
            <input type="hidden" id="oClientId">
            <div id="oCliList" class="crm-pop"></div>
            ${puedeCliente ? '<div style="margin-top:.4rem;font-size:.8rem;color:var(--muted)">¿No está en la lista? <button type="button" class="crm-link" data-crm="cliente-nuevo">Crear un cliente nuevo</button></div>' : ''}
          </div>
          ${puedeCliente ? `<div id="oNewCli" style="display:none;border:1px solid var(--border2);border-radius:10px;padding:.75rem;margin-bottom:1rem;background:var(--bg3)">
            <div style="font-weight:600;font-size:.85rem;margin-bottom:.5rem">Nuevo cliente</div>
            <div class="form-row">
              <div class="form-group" style="flex:2"><label class="form-label">Nombre *</label><input class="form-control" id="ncName" placeholder="Nombre y apellidos o empresa"></div>
              <div class="form-group"><label class="form-label">Tipo</label><select class="form-control" id="ncType"><option value="particular">Particular</option><option value="empresa">Empresa o profesional</option></select></div>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex:1"><label class="form-label">Email</label><input class="form-control" id="ncEmail" type="email" placeholder="(opcional)"></div>
              <div class="form-group" style="flex:1"><label class="form-label">Teléfono</label><input class="form-control" id="ncPhone" placeholder="(opcional)"></div>
            </div>
            <div style="display:flex;gap:.5rem;justify-content:flex-end">
              <button class="btn btn-secondary btn-sm" data-crm="cliente-ocultar">Cancelar</button>
              <button class="btn btn-primary btn-sm" data-crm="cliente-crear">Crear y usar</button>
            </div>
          </div>` : ''}
          <div class="form-row">
            <div class="form-group" style="flex:2"><label class="form-label">Título *</label><input class="form-control" id="oTitle" placeholder="Reforma del baño"></div>
            <div class="form-group"><label class="form-label">Valor estimado (${s})</label><input class="form-control" id="oAmount" type="number" step="0.01" min="0" placeholder="0.00"></div>
          </div>
          <div class="form-row">
            <div class="form-group" id="oStageRow"><label class="form-label">Etapa</label><select class="form-control" id="oStage">${stageOptions}</select></div>
            <div class="form-group"><label class="form-label">Probabilidad (%)</label><input class="form-control" id="oProb" type="number" min="0" max="100" placeholder="la de la etapa"></div>
            <div class="form-group"><label class="form-label">Cierre previsto</label><input class="form-control" id="oClose" type="date"></div>
          </div>
          <div class="form-group"><label class="form-label">Origen</label><select class="form-control" id="oSource"><option value="">— Sin especificar —</option>${sourceOptions}</select></div>
          <div class="form-group"><label class="form-label">Notas</label><textarea class="form-control" id="oNotes" rows="2"></textarea></div>
          <div style="color:var(--muted);font-size:.78rem">El valor estimado es comercial, no fiscal: la factura la sigue llevando su documento.</div>
        </div>
        <div class="modal-foot"><button class="btn btn-secondary" data-crm="opp-cerrar">Cancelar</button><button class="btn btn-primary" data-crm="opp-guardar">Guardar</button></div>
      </div></div>`;

  // ── VISTA 1: EL EMBUDO (Kanban con drag & drop real) ────────────
  views.get('/', requirePerm('crm.read'), c => {
    const s = sym();
    const puedeGestionar = can(c, 'crm.manage');
    const puedeCrearCliente = can(c, 'clients.create');   // para crear cliente en línea desde la oportunidad

    const content = `
      ${kanbanCss}
      <div class="ph">
        <h2>Oportunidades</h2>
        ${puedeGestionar ? '<button class="btn btn-primary" data-crm="opp-nueva">Nueva oportunidad</button>' : ''}
      </div>
      ${tabs('embudo')}

      <div class="card" style="margin-bottom:1rem"><div class="card-body">
        <div class="kb-kpi">
          <div><span>En el embudo</span><strong id="kpiAbierto">${dineroEs(0, s)}</strong></div>
          <div><span>Previsión ponderada</span><strong id="kpiPonderado" style="color:var(--accent)">${dineroEs(0, s)}</strong></div>
          <div><span>Piden acción hoy</span><strong id="kpiPend">0</strong></div>
          <div><span>Ganadas</span><strong id="kpiGan" style="color:var(--ok)">${dineroEs(0, s)}</strong></div>
          <div><span>Perdidas</span><strong id="kpiPer" style="color:var(--text3)">${dineroEs(0, s)}</strong></div>
        </div>
      </div></div>

      <div id="kbWrap"><div class="kb" id="kb">
        ${ETAPAS.map(e => `<div class="kb-col"><div class="kb-head"><div class="kb-title"><strong>${escHtml(e.label)}</strong><span class="kb-n">0</span></div><div class="kb-sum">${dineroEs(0, s)}</div><div class="kb-prob">${e.prob}% por defecto</div></div><div class="kb-body"><div class="kb-skel"><span class="skel"></span><span class="skel" style="width:60%"></span></div><div class="kb-skel"><span class="skel"></span><span class="skel" style="width:45%"></span></div></div></div>`).join('')}
      </div></div>

      ${puedeGestionar ? `<div class="kb-term">
        <div class="kb-drop won"  id="dropWon"  data-status="ganada">Arrastra aquí para GANAR<span class="kb-drop-s">Se cierra conservando su etapa</span></div>
        <div class="kb-drop lost" id="dropLost" data-status="perdida">Arrastra aquí si se ha PERDIDO<span class="kb-drop-s">Te preguntaré el motivo</span></div>
      </div>` : ''}

      ${oppModalHtml(s, puedeCrearCliente)}

      <!-- Modal: cerrar (ganada / perdida) -->
      <div class="modal-overlay" id="closeModal"><div class="modal" style="max-width:520px">
        <div class="modal-head"><h3 id="closeTitle">Cerrar oportunidad</h3><button class="modal-close" data-crm="cierre-cerrar">✕</button></div>
        <div class="modal-body">
          <input type="hidden" id="closeStatus">
          <div id="closeHint" style="color:var(--muted);font-size:.82rem;margin-bottom:.85rem"></div>
          <div id="lostBlock" class="form-group">
            <label class="form-label">Motivo *</label>
            <select class="form-control" id="cReason"><option value="">— Elige el motivo —</option>${lostOptions}</select>
          </div>
          <div class="form-group"><label class="form-label" id="cNoteLabel">Nota (opcional)</label><textarea class="form-control" id="cNote" rows="2"></textarea></div>
        </div>
        <div class="modal-foot"><button class="btn btn-secondary" data-crm="cierre-cerrar">Cancelar</button><button class="btn btn-primary" id="closeBtn">Cerrar</button></div>
      </div></div>

      <!-- Modal: seguimiento (actividad + email) -->
      <div class="modal-overlay" id="actModal"><div class="modal" style="max-width:620px">
        <div class="modal-head"><h3 id="actTitle">Seguimiento</h3><button class="modal-close" data-crm="act-cerrar">✕</button></div>
        <div class="modal-body">
          <div id="actProx"></div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.5rem 0">
            <button class="btn btn-primary btn-sm" id="actEmailBtn">Enviar email</button>
            <button class="btn btn-secondary btn-sm" data-crm="act-contacto">Registrar contacto</button>
            <button class="btn btn-secondary btn-sm" data-crm="act-compromiso">Registrar compromiso</button>
            <button class="btn btn-secondary btn-sm" data-crm="act-nota">Añadir nota</button>
          </div>
          <div id="actNoEmail" style="display:none;color:var(--muted);font-size:.8rem">Este cliente no tiene email: puedes registrar el contacto o una nota.</div>
          <div id="actForm"></div>
          <div id="actHist"></div>
        </div>
      </div></div>

      <script nonce="${c.get('cspNonce')}">
      ${crmScript(s)}
      const PUEDE = ${puedeGestionar ? 'true' : 'false'};
      const PUEDE_CLIENTE = ${puedeCrearCliente ? 'true' : 'false'};
      let PIPE = null;

      function cardHtml(o){
        const p = o.proximaAccion;
        const stale = o.dias_en_etapa > 14;
        const due = !!(p && p.accion);
        const menu = PUEDE ? window.rowMenu([
          {label:'Seguimiento', act:'seguimiento', arg:o.id},
          {label:'Editar', act:'editar', arg:o.id},
          {label:'Marcar ganada', act:'ganada', arg:o.id},
          {label:'Dar por perdida', act:'perdida', arg:o.id},
          {label:'Archivar', danger:true, act:'archivar', arg:o.id},
        ]) : '';
        return '<div class="kb-card" draggable="'+(PUEDE?'true':'false')+'" data-id="'+o.id+'" data-stage="'+escHtml(o.stage)+'"'
          + (PUEDE ? ' data-crm-card="1"' : '') + '>'
          + '<div class="kb-c-t">'+escHtml(o.title)+'</div>'
          + '<div class="kb-c-cl"><i class="ti ti-user" style="font-size:.8rem"></i> '+escHtml(o.client_name||'')+'</div>'
          + '<div class="kb-c-meta"><span class="kb-c-v">'+money(o.amount)+' <span style="font-size:.68rem;color:var(--text3);font-weight:400">'+o.probability+'%</span></span>'
          + '<span style="display:flex;align-items:center;gap:.3rem"><span class="kb-c-days'+(stale?' stale':'')+'">'+o.dias_en_etapa+'d aquí</span>'+menu+'</span></div>'
          + '<div class="kb-c-prox'+(due?' due':'')+'" title="'+escHtml((p&&p.motivo)||'')+'">'
          +   (due?'<i class="ti ti-bell"></i>':'<i class="ti ti-clock"></i>')
          +   '<span>'+escHtml(proxTexto(p))+(p&&p.fechaObjetivo?' · '+escHtml(p.fechaObjetivo):'')+'</span></div>'
          + '</div>';
      }

      function render(){
        const cols = document.querySelectorAll('#kb .kb-col');
        PIPE.columnas.forEach(function(col, i){
          const el = cols[i];
          el.dataset.stage = col.key;
          el.querySelector('.kb-n').textContent = col.count;
          el.querySelector('.kb-sum').textContent = money(col.total);
          el.querySelector('.kb-body').innerHTML = col.items.length
            ? col.items.map(cardHtml).join('')
            : '<div class="kb-empty">Nada aquí todavía</div>';
        });
        document.getElementById('kpiAbierto').textContent = money(PIPE.totalAbierto);
        document.getElementById('kpiPonderado').textContent = money(PIPE.ponderado);
        document.getElementById('kpiPend').textContent = PIPE.pendientes;
        document.getElementById('kpiGan').textContent = money(PIPE.ganadas.total);
        document.getElementById('kpiPer').textContent = money(PIPE.perdidas.total);
        if(PIPE.huerfanas) toast(PIPE.huerfanas+' oportunidad(es) en una etapa desconocida; se muestran en la primera columna','warn');
      }

      async function reload(){
        try{ PIPE = await api('GET','/api/erp/crm'); }catch(e){ toast(e.message||'Error','err'); return; }
        render();
      }

      // ── DRAG & DROP (HTML5 nativo; sin librerías, sin framework) ──────
      let dragId=null, dragFrom=null;
      // 4 SEP 2026 — la tarjeta llega COMO ARGUMENTO. Antes se sacaba de ev.currentTarget, que
      // con el atributo era la propia tarjeta; ahora el oyente esta en el documento y currentTarget
      // seria el documento entero.
      function onDragStart(ev, card){
        dragId=card.dataset.id; dragFrom=card.dataset.stage;
        card.classList.add('dragging');
        ev.dataTransfer.effectAllowed='move';
        ev.dataTransfer.setData('text/plain', dragId);   // Firefox exige payload o no arrastra
      }
      function onDragEnd(ev, card){
        card.classList.remove('dragging');
        document.querySelectorAll('.over').forEach(function(e){e.classList.remove('over');});
      }
      function wireDropzones(){
        document.querySelectorAll('#kb .kb-col').forEach(function(col){
          col.addEventListener('dragover', function(ev){ if(!dragId)return; ev.preventDefault(); ev.dataTransfer.dropEffect='move'; col.classList.add('over'); });
          col.addEventListener('dragleave', function(){ col.classList.remove('over'); });
          col.addEventListener('drop', async function(ev){
            ev.preventDefault(); col.classList.remove('over');
            if(!dragId) return;
            const stage=col.dataset.stage, id=dragId; dragId=null;
            if(stage===dragFrom) return;            // soltar en su propia columna: no reinicia el reloj
            try{ await api('POST','/api/erp/crm/'+id+'/stage', {stage:stage}); toast('Movida a '+ETAPA_LABEL[stage]); }
            catch(e){ toast(e.message,'err'); }
            reload();
          });
        });
        ['dropWon','dropLost'].forEach(function(zid){
          const z=document.getElementById(zid); if(!z) return;
          z.addEventListener('dragover', function(ev){ if(!dragId)return; ev.preventDefault(); z.classList.add('over'); });
          z.addEventListener('dragleave', function(){ z.classList.remove('over'); });
          z.addEventListener('drop', function(ev){
            ev.preventDefault(); z.classList.remove('over');
            if(!dragId) return;
            const id=dragId; dragId=null;
            // Ganada/Perdida NO son etapas: no se mueve nada aquí. Se abre el cierre, que pide
            // motivo si es perdida. El servidor lo exige igual aunque alguien salte el modal.
            openClose(id, z.dataset.status);
          });
        });
      }
      wireDropzones();
      // El arrastre y el doble clic de la tarjeta, por delegacion: las tarjetas se repintan en cada
      // recarga del tablero, y un oyente por tarjeta habria que volver a ponerlo cada vez.
      document.addEventListener('dragstart', function(ev){
        var card = ev.target.closest('[data-crm-card]'); if (card) onDragStart(ev, card);
      });
      document.addEventListener('dragend', function(ev){
        var card = ev.target.closest('[data-crm-card]'); if (card) onDragEnd(ev, card);
      });
      document.addEventListener('dblclick', function(ev){
        var card = ev.target.closest('[data-crm-card]'); if (card) openActividad(Number(card.dataset.id));
      });
      reload();
      </script>`;
    return c.html(adminLayout('Oportunidades', content, 'crm', c.get('session')?.csrfToken || '', c));
  });

  // ── VISTA 2: LA COLA DE TRABAJO COMERCIAL ───────────────────────
  // Espejo del "Pipeline de cobro" de /admin/cobros: lo más urgente arriba, con su motivo.
  views.get('/cola', requirePerm('crm.read'), c => {
    const s = sym();
    const puedeGestionar = can(c, 'crm.manage');
    const puedeCrearCliente = can(c, 'clients.create');   // para crear cliente en línea desde la oportunidad
    const content = `
      ${kanbanCss}
      <div class="ph"><h2>Oportunidades</h2>
        ${puedeGestionar ? '<button class="btn btn-primary" data-crm="opp-nueva">Nueva oportunidad</button>' : ''}
      </div>
      ${tabs('cola')}
      <div class="card" style="margin-bottom:1rem"><div class="card-body" style="display:flex;align-items:baseline;gap:.75rem">
        <span style="color:var(--muted)">Piden acción hoy</span>
        <span id="wlPend" style="font-size:1.8rem;font-weight:700">0</span>
        <span id="wlCount" style="color:var(--muted);font-size:.85rem"></span>
      </div></div>
      <div class="card">
        <div class="card-head"><h3>A quién llamar hoy (más urgente arriba)</h3><input class="search" id="searchBox" data-crm="buscar" placeholder="Buscar cliente u oportunidad..."></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Cliente</th><th>Oportunidad</th><th>Valor</th><th>Etapa</th><th>Próxima acción</th><th></th></tr></thead>
          <tbody id="wlBody">${skeletonRows(6)}</tbody>
        </table></div>
      </div>

      ${oppModalHtml(s, puedeCrearCliente)}

      <div class="modal-overlay" id="closeModal"><div class="modal" style="max-width:520px">
        <div class="modal-head"><h3 id="closeTitle">Cerrar oportunidad</h3><button class="modal-close" data-crm="cierre-cerrar">✕</button></div>
        <div class="modal-body">
          <input type="hidden" id="closeStatus">
          <div id="closeHint" style="color:var(--muted);font-size:.82rem;margin-bottom:.85rem"></div>
          <div id="lostBlock" class="form-group"><label class="form-label">Motivo *</label>
            <select class="form-control" id="cReason"><option value="">— Elige el motivo —</option>${lostOptions}</select></div>
          <div class="form-group"><label class="form-label" id="cNoteLabel">Nota (opcional)</label><textarea class="form-control" id="cNote" rows="2"></textarea></div>
        </div>
        <div class="modal-foot"><button class="btn btn-secondary" data-crm="cierre-cerrar">Cancelar</button><button class="btn btn-primary" id="closeBtn">Cerrar</button></div>
      </div></div>

      <div class="modal-overlay" id="actModal"><div class="modal" style="max-width:620px">
        <div class="modal-head"><h3 id="actTitle">Seguimiento</h3><button class="modal-close" data-crm="act-cerrar">✕</button></div>
        <div class="modal-body">
          <div id="actProx"></div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.5rem 0">
            <button class="btn btn-primary btn-sm" id="actEmailBtn">Enviar email</button>
            <button class="btn btn-secondary btn-sm" data-crm="act-contacto">Registrar contacto</button>
            <button class="btn btn-secondary btn-sm" data-crm="act-compromiso">Registrar compromiso</button>
            <button class="btn btn-secondary btn-sm" data-crm="act-nota">Añadir nota</button>
          </div>
          <div id="actNoEmail" style="display:none;color:var(--muted);font-size:.8rem">Este cliente no tiene email: puedes registrar el contacto o una nota.</div>
          <div id="actForm"></div>
          <div id="actHist"></div>
        </div>
      </div></div>

      <script nonce="${c.get('cspNonce')}">
      ${crmScript(s)}
      const PUEDE = ${puedeGestionar ? 'true' : 'false'};
      const PUEDE_CLIENTE = ${puedeCrearCliente ? 'true' : 'false'};
      let WL = [];
      async function reload(){
        let data; try{ data = await api('GET','/api/erp/crm/worklist'); }catch(e){ toast(e.message||'Error','err'); return; }
        WL = data.rows||[];
        document.getElementById('wlPend').textContent = data.pendientes;
        document.getElementById('wlCount').textContent = '· ' + WL.length + ' oportunidad' + (WL.length===1?'':'es') + ' abierta' + (WL.length===1?'':'s') + ' · ' + money(data.total) + ' en juego';
        document.getElementById('wlBody').innerHTML = WL.length ? WL.map(function(o){
          const p=o.proximaAccion;
          const acciones = PUEDE
            ? '<button class="btn btn-primary btn-sm" data-crm="seguimiento" data-id="'+o.id+'">Seguimiento</button> '
              + window.rowMenu([
                  {label:'Editar', act:'editar', arg:o.id},
                  {label:'Marcar ganada', act:'ganada', arg:o.id},
                  {label:'Dar por perdida', act:'perdida', arg:o.id},
                  {label:'Archivar', danger:true, act:'archivar', arg:o.id},
                ])
            : '';
          return '<tr class="frow">'
            +'<td>'+escHtml(o.client_name||'')+'</td>'
            +'<td><strong>'+escHtml(o.title)+'</strong><div style="color:var(--muted);font-size:.75rem">'+o.dias_en_etapa+' días en esta etapa</div></td>'
            +'<td><strong>'+money(o.amount)+'</strong> <span style="color:var(--muted);font-size:.75rem">'+o.probability+'%</span></td>'
            +'<td>'+proxBadge(p)+'</td>'
            +'<td>'+escHtml(proxTexto(p))+(p&&p.fechaObjetivo?' <span style="color:var(--muted);font-size:.8rem">· '+escHtml(p.fechaObjetivo)+'</span>':'')
              +'<div style="color:var(--muted);font-size:.8rem">'+escHtml(o.motivo||'')+'</div></td>'
            +'<td style="white-space:nowrap">'+acciones+'</td></tr>';
        }).join('') : window.emptyRow(6, 'No tienes ninguna oportunidad abierta. Cuando alguien te pida precio, ábrele una y no se te escapa.', PUEDE ? { cta:'Nueva oportunidad', act:'nueva-oportunidad' } : { tone:'ok' });
        filterRows();
      }
      function filterRows(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        document.querySelectorAll('#wlBody tr.frow').forEach(function(tr){
          tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      }
      reload();
      
      document.getElementById('searchBox')?.addEventListener('input', function(){ filterRows(); });
</script>`;
    return c.html(adminLayout('Oportunidades', content, 'crm', c.get('session')?.csrfToken || '', c));
  });

  // ── PUNTO 13 · LA AGENDA DEL CRM ─────────────────────────────────────────────────────────────
  // Tres cosas y en este orden, que es el de quien la abre por la mañana: lo VENCIDO, lo de HOY, y
  // lo que viene. Y un botón para apuntar la siguiente, que es lo que se hace al colgar el teléfono.
  views.get('/tareas', requirePerm('crm.read'), c => {
    const csrf = c.get('session')?.csrfToken || '';
    const puedeGestionar = can(c, 'crm.manage');
    const t = hoy();
    const todas = listarTareas(db, { estado: 'pendiente', hoy: t });
    const vencidas = todas.filter(x => x.vencida);
    const deHoy = todas.filter(x => x.hoy);
    const futuras = todas.filter(x => !x.vencida && !x.hoy);
    const hechas = listarTareas(db, { estado: 'hecha', hoy: t }).slice(-15).reverse();
    const equipo = db.prepare('SELECT id, name FROM admin_users WHERE active=1 ORDER BY name').all();

    const fila = x => `<tr>
      <td><strong>${escHtml(x.titulo)}</strong>${x.detalle ? `<div style="font-size:.75rem;color:var(--text3)">${escHtml(x.detalle)}</div>` : ''}</td>
      <td><a href="/admin/clients/${x.client_id}">${escHtml(x.cliente || '—')}</a>
        ${x.oportunidad ? `<div style="font-size:.72rem;color:var(--text3)">${escHtml(x.oportunidad)}</div>` : ''}</td>
      <td>${escHtml(x.responsable || 'sin dueño')}</td>
      <td>${fechaEs(x.fecha)}${x.vencida ? `<div style="font-size:.72rem;color:var(--danger)">hace ${x.retraso} día(s)</div>` : ''}</td>
      <td class="r">${puedeGestionar ? `
        <button class="btn btn-sm" data-hecha="${x.id}">Hecha</button>
        <button class="btn btn-secondary btn-sm" data-mover="${x.id}">Mover</button>
        <button class="btn btn-secondary btn-sm" data-anular="${x.id}">Anular</button>` : ''}</td></tr>`;
    const bloque = (titulo, lista, vacio, color) => `
      <div class="card bf-caja" style="margin-bottom:1rem">
        <h3 style="margin-top:0${color ? ';color:' + color : ''}">${escHtml(titulo)} ${lista.length ? '<span style="color:var(--text3);font-weight:400">· ' + lista.length + '</span>' : ''}</h3>
        ${lista.length ? `<div class="table-wrap"><table><thead><tr><th>Qué hay que hacer</th><th>Cliente</th>
          <th>De quién</th><th>Para cuándo</th><th></th></tr></thead><tbody>${lista.map(fila).join('')}</tbody></table></div>`
          : `<div style="color:var(--text3);font-size:.86rem">${escHtml(vacio)}</div>`}
      </div>`;

    const content = `
      <div class="ph"><h2>Oportunidades</h2>
        ${puedeGestionar ? '<button class="btn btn-primary" id="btnNuevaTarea">Nueva tarea</button>' : ''}</div>
      ${tabs('tareas')}
      <div class="alert" style="margin-bottom:1rem">Lo que hay que hacer con cada cliente, <strong>con
        fecha y con dueño</strong>. Lo vencido y lo de hoy salen además <strong>en la campana de avisos</strong>,
        con el resto: no hay una bandeja nueva que vigilar. Y cada tarea aparece en la
        <strong>línea de tiempo del cliente</strong>, junto a sus facturas y sus citas.</div>
      ${bloque('Se te ha pasado', vencidas, 'Nada vencido. Bien.', 'var(--danger)')}
      ${bloque('Para hoy', deHoy, 'Hoy no tienes nada apuntado.')}
      ${bloque('Lo que viene', futuras, 'No hay nada apuntado más adelante.')}
      ${hechas.length ? `<div class="card bf-caja"><h3 style="margin-top:0">Últimas hechas</h3>
        <div class="table-wrap"><table><tbody>${hechas.map(x => `<tr>
          <td style="color:var(--text3)">${escHtml(String(x.hecha_at || '').slice(0, 10))}</td>
          <td>${escHtml(x.titulo)}</td><td>${escHtml(x.cliente || '')}</td>
          <td style="color:var(--text3)">${escHtml(x.resultado || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <script nonce="${c.get('cspNonce')}">
      const CSRF=${JSON.stringify(csrf)};
      const EQUIPO=${JSON.stringify(equipo)}, HOY=${JSON.stringify(t)};
      async function api(m,u,b){ const r=await fetch(u,{method:m,headers:{'Content-Type':'application/json','x-csrf-token':CSRF},body:b?JSON.stringify(b):undefined});
        let d=null; try{ d=await r.json(); }catch(e){} if(!r.ok||(d&&d.error)) throw new Error(window.cleanErrMsg((d&&d.error)||'')); return d; }
      async function nuevaTarea(){
        const v = await window.pedirDatos({ titulo:'Nueva tarea', aceptar:'Apuntarla',
          texto:'Qué hay que hacer, con quién y para cuándo. Sin fecha y sin dueño una tarea no la hace nadie.',
          campos:[
            { id:'cliente', etiqueta:'Cliente (nombre exacto o parte)', marcador:'Taxis Ríos' },
            { id:'titulo', etiqueta:'Qué hay que hacer', marcador:'Llamar para el presupuesto de la furgoneta' },
            { id:'fecha', etiqueta:'Para cuándo', valor:HOY, ayuda:'AAAA-MM-DD' },
            { id:'user_id', tipo:'lista', etiqueta:'De quién es',
              opciones:[{v:'',t:'— sin dueño —'}].concat(EQUIPO.map(u=>({v:u.id,t:u.name}))) },
            { id:'detalle', etiqueta:'Detalle (opcional)' },
          ],
          validar: v2 => {
            if(!String(v2.cliente||'').trim()) return { campo:'cliente', mensaje:'Dime de qué cliente es.' };
            if(!String(v2.titulo||'').trim()) return { campo:'titulo', mensaje:'Escribe qué hay que hacer.' };
            if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(v2.fecha||''))) return { campo:'fecha', mensaje:'Pon una fecha AAAA-MM-DD.' };
            return null;
          },
          alAceptar: async v2 => {
            const cl = await api('GET','/api/erp/clients?q='+encodeURIComponent(String(v2.cliente).trim()));
            const lista = Array.isArray(cl)?cl:(cl.clients||cl.rows||[]);
            if(!lista.length) throw new Error('No encuentro ningún cliente que se llame así.');
            const exacto = lista.find(x=>String(x.name).toLowerCase()===String(v2.cliente).trim().toLowerCase());
            if(lista.length>1 && !exacto) throw new Error('Hay '+lista.length+' clientes que encajan. Escribe el nombre completo.');
            await api('POST','/api/erp/crm/tareas',{ client_id:(exacto||lista[0]).id, titulo:String(v2.titulo).trim(),
              fecha:v2.fecha, user_id:v2.user_id||null, detalle:String(v2.detalle||'') });
          } });
        if (v) location.reload();
      }
      window.addEventListener('DOMContentLoaded',()=>{
        const b=document.getElementById('btnNuevaTarea'); if(b) b.onclick=nuevaTarea;
        document.querySelectorAll('[data-hecha]').forEach(x=>x.onclick=async()=>{
          const v = await window.pedirDatos({ titulo:'Dar la tarea por hecha', aceptar:'Hecha',
            texto:'Apunta cómo ha ido: sin resultado, el siguiente seguimiento empieza a ciegas.',
            campos:[{ id:'resultado', etiqueta:'¿Cómo ha ido?', marcador:'Quedamos en llamar en septiembre' }] });
          if(!v) return;
          try{ await api('POST','/api/erp/crm/tareas/'+x.dataset.hecha+'/hecha',{resultado:v.resultado||''});
            toast('Hecha'); setTimeout(()=>location.reload(),600); }catch(e){ toast(e.message,'err'); }
        });
        document.querySelectorAll('[data-mover]').forEach(x=>x.onclick=async()=>{
          const v = await window.pedirDatos({ titulo:'Mover la tarea de día', aceptar:'Mover',
            campos:[{ id:'fecha', etiqueta:'Nueva fecha', valor:HOY, ayuda:'AAAA-MM-DD' }],
            validar: v2 => /^\\d{4}-\\d{2}-\\d{2}$/.test(String(v2.fecha||'')) ? null : { campo:'fecha', mensaje:'AAAA-MM-DD.' } });
          if(!v) return;
          try{ await api('POST','/api/erp/crm/tareas/'+x.dataset.mover+'/reprogramar',{fecha:v.fecha});
            toast('Movida'); setTimeout(()=>location.reload(),600); }catch(e){ toast(e.message,'err'); }
        });
        document.querySelectorAll('[data-anular]').forEach(x=>x.onclick=async()=>{
          const v = await window.pedirDatos({ titulo:'Anular la tarea', aceptar:'Anular',
            texto:'No se borra: queda anulada con su motivo. Saber qué se decidió NO hacer también vale.',
            campos:[{ id:'motivo', etiqueta:'¿Por qué?' }],
            validar: v2 => String(v2.motivo||'').trim().length>=3 ? null : { campo:'motivo', mensaje:'Dilo en tres letras al menos.' } });
          if(!v) return;
          try{ await api('DELETE','/api/erp/crm/tareas/'+x.dataset.anular,{motivo:v.motivo});
            toast('Anulada'); setTimeout(()=>location.reload(),600); }catch(e){ toast(e.message,'err'); }
        });
      });
      </script>`;
    return c.html(adminLayout('Tareas comerciales', content, 'crm', csrf, c));
  });

  return { api, views };
}
