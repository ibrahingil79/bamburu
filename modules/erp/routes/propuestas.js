import { Hono } from 'hono';
import { adminLayout, can, skeletonRows } from '../layout.js';
import { hoyLocal } from '../avisos.js';
import { propuestasPendientes, contarPropuestasPendientes, generarPropuestasImpago } from '../propuestas.js';
import { registerCollectionAction } from '../cobros.js';
import { sendEmail } from '../../../core/mailer.js';

// D5 (Eje B) — PANEL "PROPUESTAS DE DISA". Lista los borradores que DISA ha preparado y espera
// aprobación. Hoy solo hay un tipo: recordatorio de impago. El dueño APRUEBA (envía de verdad),
// EDITA antes de enviar, o DESCARTA. NUNCA se envía sin aprobación.
//
// PERMISOS (mismo criterio anti-backdoor que la campana):
//   · VER (panel, lista, badge)   → invoices.read O cobros.read (las cifras de ventas usan el mismo).
//   · APROBAR Y ENVIAR            → cobros.manage. Manda un email real en nombre del negocio, y esa
//                                   misma acción por /admin/cobros exige cobros.manage: aprobar aquí
//                                   con menos sería una puerta trasera al envío de recordatorios.
//   · DESCARTAR                   → como VER (solo apaga una propuesta, no manda nada).
//   owner/admin hacen bypass en todos (can()).
export function createPropuestasRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  const today = () => hoyLocal();
  const puedeVer = c => can(c, 'invoices.read') || can(c, 'cobros.read');

  // GET /api/erp/propuestas — las pendientes, con importe y días de retraso recalculados en vivo.
  api.get('/', c => {
    if (!puedeVer(c)) return c.json({ error: 'Sin permiso' }, 403);
    try { return c.json({ propuestas: propuestasPendientes(db, today()) }); }
    catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /api/erp/propuestas/contador — nº pendientes, para el badge del topbar. Barato (un COUNT).
  api.get('/contador', c => {
    if (!puedeVer(c)) return c.json({ count: 0 });
    try { return c.json({ count: contarPropuestasPendientes(db) }); }
    catch (e) { return c.json({ error: e.message }, 500); }
  });

  // POST /api/erp/propuestas/:id/aprobar — APROBAR Y ENVIAR. Reutiliza registerCollectionAction (el
  // motor de email validado): envía por Resend con el borrador (posiblemente editado), y solo si el
  // envío sale bien marca la propuesta 'aprobada_enviada'. Bloquea el doble envío: solo desde
  // 'pendiente'. Si registerCollectionAction falla (sin email, factura no cobrable, Resend), la
  // propuesta SIGUE pendiente y se devuelve el motivo — nada se marca como enviado si no se envió.
  api.post('/:id/aprobar', async c => {
    if (!can(c, 'cobros.manage')) return c.json({ error: 'No tienes permiso para enviar recordatorios de cobro.' }, 403);
    try {
      const id = parseInt(c.req.param('id'));
      const body = await c.req.json().catch(() => ({}));
      const p = db.prepare("SELECT * FROM disa_proposals WHERE id=?").get(id);
      if (!p) return c.json({ error: 'Propuesta no encontrada' }, 404);
      if (p.status !== 'pendiente') return c.json({ error: 'Esta propuesta ya se resolvió (' + p.status + ').' }, 409);

      // El usuario puede haber editado asunto/cuerpo en el panel; si llegan, mandan y se persisten.
      const subject = (body.subject != null ? String(body.subject) : p.subject).trim();
      const text = (body.body != null ? String(body.body) : p.body);
      if (!subject || !text.trim()) return c.json({ error: 'El asunto y el cuerpo no pueden estar vacíos.' }, 400);

      const r = await registerCollectionAction(db, p.invoice_id,
        { type: 'recordatorio_email', channel: 'email', email_subject: subject, email_text: text },
        { sendEmail });

      const now = new Date().toISOString();
      const quien = c.get('session')?.userName || c.get('session')?.userId || '';
      db.prepare("UPDATE disa_proposals SET status='aprobada_enviada', subject=?, body=?, resolved_at=?, resolved_by=? WHERE id=?")
        .run(subject, text, now, String(quien), id);

      return c.json({ ok: true, message: 'Recordatorio enviado a ' + (r.email?.to || 'el cliente') + '.' });
    } catch (e) {
      // registerCollectionAction lanza con .status (400 sin email, 502 Resend, etc.): mensaje claro,
      // la propuesta NO cambia de estado.
      return c.json({ error: e.message }, e.status || 500);
    }
  });

  // POST /api/erp/propuestas/:id/descartar — marca 'descartada'. Por el índice único (factura,tipo)
  // NO se vuelve a proponer esa factura. No envía nada.
  api.post('/:id/descartar', c => {
    if (!puedeVer(c)) return c.json({ error: 'Sin permiso' }, 403);
    try {
      const id = parseInt(c.req.param('id'));
      const p = db.prepare("SELECT status FROM disa_proposals WHERE id=?").get(id);
      if (!p) return c.json({ error: 'Propuesta no encontrada' }, 404);
      if (p.status !== 'pendiente') return c.json({ error: 'Esta propuesta ya se resolvió.' }, 409);
      const quien = c.get('session')?.userName || c.get('session')?.userId || '';
      db.prepare("UPDATE disa_proposals SET status='descartada', resolved_at=?, resolved_by=? WHERE id=?")
        .run(new Date().toISOString(), String(quien), id);
      return c.json({ ok: true, message: 'Propuesta descartada.' });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // POST /api/erp/propuestas/generar — dispara la generación a demanda (además del cron diario).
  // Útil para que el panel muestre propuestas sin esperar al barrido. Requiere permiso de ver.
  api.post('/generar', c => {
    if (!puedeVer(c)) return c.json({ error: 'Sin permiso' }, 403);
    try { return c.json(generarPropuestasImpago(db, { today: today() })); }
    catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /admin/propuestas — la pantalla. Gate de VER; las acciones revalidan su permiso en la API.
  views.get('/', c => {
    if (!puedeVer(c)) return c.html(adminLayout('Propuestas de DISA',
      '<div class="card"><div class="card-body">No tienes permiso para ver las propuestas de DISA.</div></div>',
      'propuestas', c.get('session')?.csrfToken || '', c));
    const csrf = c.get('session')?.csrfToken || '';
    const puedeAprobar = can(c, 'cobros.manage');
    const content = `
      <div class="ph"><h2>Propuestas de DISA</h2>
        <button class="btn btn-secondary" onclick="loadProps()"><i class="ti ti-refresh"></i> Actualizar</button>
      </div>
      <div class="card" style="margin-bottom:1rem"><div class="card-body" style="color:var(--muted)">
        DISA prepara borradores de recordatorio de pago para las facturas vencidas. <strong>Nada se envía
        solo:</strong> revisa cada uno, edítalo si quieres, y apruébalo para enviarlo — o descártalo.
      </div></div>
      <div id="propList">${skeletonRows ? '' : ''}<p style="color:var(--muted)">Cargando…</p></div>
      <style>
        .prop-card{border:1px solid var(--border2);border-radius:12px;padding:1rem;margin-bottom:1rem;background:var(--card)}
        .prop-head{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem}
        .prop-meta{color:var(--muted);font-size:.85rem}
        .prop-field{margin:.5rem 0}
        .prop-field label{display:block;font-size:.78rem;color:var(--muted);margin-bottom:.2rem}
        .prop-field input,.prop-field textarea{width:100%;font-family:inherit;font-size:.9rem;padding:.5rem;border:1px solid var(--border2);border-radius:8px;background:var(--bg)}
        .prop-field textarea{min-height:150px;resize:vertical}
        .prop-actions{display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap}
        .prop-warn{color:var(--danger);font-size:.82rem;margin:.3rem 0}
      </style>
      <script>
      const PUEDE_APROBAR = ${puedeAprobar ? 'true' : 'false'};
      function propHtml(p){
        const dias = p.dias_vencida != null ? (p.dias_vencida + ' día' + (p.dias_vencida===1?'':'s') + ' de retraso') : 'retraso desconocido';
        const imp = (p.importe!=null ? p.importe.toFixed(2) : '—');
        const noViva = p.viva ? '' : '<p class="prop-warn">⚠ Esta factura ya no figura como deuda viva (¿cobrada?). Revisa antes de enviar.</p>';
        const acciones = PUEDE_APROBAR
          ? '<button class="btn btn-primary btn-sm" onclick="aprobar('+p.id+')">Aprobar y enviar</button>'
          : '<span class="prop-meta">Necesitas permiso de gestión de cobros para enviar.</span>';
        return '<div class="prop-card" id="prop'+p.id+'">'
          +'<div class="prop-head"><div><strong>'+escHtml(p.client_name||'Cliente')+'</strong> · '+escHtml(p.invoice_number||('#'+p.invoice_id))+'</div>'
          +'<div class="prop-meta">€'+imp+' · '+dias+'</div></div>'
          +'<div class="prop-meta">Para: '+escHtml(p.client_email||'(sin email)')+'</div>'
          + noViva
          +'<div class="prop-field"><label>Asunto</label><input id="subj'+p.id+'" value="'+escHtml(p.subject||'')+'"></div>'
          +'<div class="prop-field"><label>Mensaje</label><textarea id="body'+p.id+'">'+escHtml(p.body||'')+'</textarea></div>'
          +'<div class="prop-actions">'+acciones
          +' <button class="btn btn-secondary btn-sm" onclick="descartar('+p.id+')">Descartar</button></div>'
          +'</div>';
      }
      function pintar(props){
        const box=document.getElementById('propList');
        box.innerHTML = props.length ? props.map(propHtml).join('')
          : (window.emptyRow ? '' : '') + '<div class="card"><div class="card-body" style="color:var(--muted)">No hay propuestas pendientes. Cuando una factura lleve vencida más días que el umbral, DISA preparará aquí su recordatorio.</div></div>';
        if (typeof window.propBadgeSync==='function') window.propBadgeSync(props.length);
      }
      async function loadProps(){
        try { await api('POST','/api/erp/propuestas/generar'); }catch(e){}   // genera lo que falte (idempotente)
        try { pintar((await api('GET','/api/erp/propuestas')).propuestas||[]); }
        catch(e){ toast(e.message||'Error','err'); }
      }
      window.aprobar = async function(id){
        const subject=document.getElementById('subj'+id).value;
        const body=document.getElementById('body'+id).value;
        try { const r=await api('POST','/api/erp/propuestas/'+id+'/aprobar',{subject,body});
              toast(r.message||'Enviado'); loadProps(); }
        catch(e){ toast(e.message||'Error','err'); }
      };
      window.descartar = async function(id){
        try { const r=await api('POST','/api/erp/propuestas/'+id+'/descartar',{});
              toast(r.message||'Descartada'); loadProps(); }
        catch(e){ toast(e.message||'Error','err'); }
      };
      loadProps();
      </script>`;
    return c.html(adminLayout('Propuestas de DISA', content, 'propuestas', csrf, c));
  });

  return { api, views };
}
