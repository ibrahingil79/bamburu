import { Hono } from 'hono';
import { adminLayout, can, skeletonRows } from '../layout.js';
import { hoyLocal } from '../avisos.js';
import {
  propuestasPendientes, contarPropuestasPendientes,
  generarPropuestasImpago, generarPropuestasPago, generarPropuestasRecurrentes, generarPropuestasDormidos,
  redactarReenganche, tiposVisiblesPara,
  TIPO_IMPAGO, TIPO_PAGO, TIPO_RECURRENTE, TIPO_DORMIDO,
} from '../propuestas.js';
import { emitirOcurrencia } from '../recurrentes.js';
import { registerClientActivitySvc } from '../crm.js';
import { registerCollectionAction } from '../cobros.js';
import { pagoModalHtml, pagoModalScript } from '../views/pago-modal.js';
import { sendEmail } from '../../../core/mailer.js';

// D5 (Eje B) — PANEL "PROPUESTAS DE DISA". Lista el trabajo que DISA ha preparado y que espera una
// decisión del dueño. NUNCA se ejecuta nada sin aprobación. Tres tipos hoy:
//
//   · recordatorio_impago (D5)  — factura de VENTA ya vencida → borrador de email de cobro.
//                                 Aprobar = ENVIAR el email (motor de cobros).
//   · pago_por_vencer   (D5b)   — factura de COMPRA a punto de vencer → atajo para PAGARLA.
//                                 Aprobar = abrir el MISMO modal del botón "Pagar" de /admin/pagos,
//                                 precargado con el importe pendiente, y registrar el pago por el
//                                 ÚNICO endpoint de escritura. A un proveedor no se le manda email
//                                 avisándole de que se le va a pagar: la acción útil es pagar.
//   · emitir_recurrente         — la iguala/cuota que TOCA este ciclo y sigue sin emitirse (una
//                                 ocurrencia en 'borrador'). Aprobar = EMITIRLA, un clic, llamando a
//                                 `emitirOcurrencia` — el MISMO servicio que usa el botón de
//                                 /admin/recurrentes, el que pasa por createInvoice y pone la huella
//                                 Verifactu. Aquí NO hay una segunda forma de emitir una factura.
//
// PERMISOS (criterio anti-backdoor: cada tipo exige lo mismo que SU pantalla de origen, así una
// propuesta nunca abre datos ni acciones que la pantalla te niega). owner/admin bypass en todos.
//
//   TIPO              VER (panel, lista, badge)          APROBAR                      DESCARTAR
//   recordatorio_impago  invoices.read O cobros.read     cobros.manage (manda email)  como VER
//   pago_por_vencer      purchases.read (= /admin/pagos) purchases.create (registra   como VER
//                                                        el pago; lo exige el propio
//                                                        endpoint de pagos)
//   emitir_recurrente    recurrentes.read Y             invoices.create (lo exige el  como VER
//                        invoices.create                 propio POST de emitir)
//   cliente_dormido      clients.read Y crm.manage      crm.manage (lo exige la ruta  como VER
//                                                        del CRM que manda el email)
//
//   · cliente_dormido (D5d) — el que te compraba a un ritmo y dejó de hacerlo. Aquí APROBAR **NO
//     ENVÍA**: DISA REDACTA el borrador y te lo enseña; enviarlo es un SEGUNDO clic, tuyo, después de
//     leerlo. Escribirle a un cliente que se te fue no es cobrar una deuda — el texto importa, y nadie
//     manda eso sin leerlo. El envío va por `registerClientActivitySvc` (type='email'), la MISMA vía
//     que el CRM usa para escribirle a un cliente: mismo Resend (core/mailer, el único envoltorio del
//     proyecto), misma plantilla (`opportunityEmail`), y queda registrado en `client_activities`.
//     No se puede reutilizar `registerCollectionAction` como las hermanas: ESA está atada a una
//     factura (la busca y la valida), y un cliente dormido no tiene ninguna que colgar — de eso va.
//
// El candado de emitir_recurrente es a propósito MÁS estricto que el de sus hermanos, y exige las DOS
// cosas: `recurrentes.read` (la propuesta enseña los datos de la plantilla —cliente, concepto,
// importe de la iguala— que son justo lo que esa pantalla guarda) e `invoices.create` (el permiso que
// exige de verdad emitir). Quien no puede emitir una recurrente NO la ve: ni en la lista, ni en el
// badge, ni se le genera. Falla cerrado. Ningún permiso nuevo: los dos ya existían.
export function createPropuestasRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  const today = () => hoyLocal();
  const puedeVerImpago = c => can(c, 'invoices.read') || can(c, 'cobros.read');
  const puedeVerPago = c => can(c, 'purchases.read');
  // Emitir una recurrente exige invoices.create; ver la plantilla, recurrentes.read. Se piden las DOS:
  // quien no puede emitirla no la ve (ver la cabecera del fichero).
  const puedeVerRecurrente = c => can(c, 'recurrentes.read') && can(c, 'invoices.create');
  // Escribirle a un cliente exige crm.manage (lo pide la ruta del CRM que manda el email); ver su
  // ficha, clients.read. Se piden las DOS: quien no puede escribirle, no ve la propuesta.
  const puedeVerDormido = c => can(c, 'clients.read') && can(c, 'crm.manage');
  // Los tipos que ESTE usuario puede ver. La regla NO se escribe aquí: vive en `tiposVisiblesPara`
  // (propuestas.js), que es también la que lee el badge del riel. Tenerla duplicada fue justo lo que
  // hizo que el panel enseñara 22 propuestas y el badge dijera 21.
  const tiposVisibles = c => tiposVisiblesPara(c, can);
  const puedeVer = c => tiposVisibles(c).length > 0;
  // Permiso de VER del tipo de una propuesta concreta (para descartar).
  const puedeVerTipo = (c, tipo) => (
    tipo === TIPO_PAGO ? puedeVerPago(c)
    : tipo === TIPO_RECURRENTE ? puedeVerRecurrente(c)
    : tipo === TIPO_DORMIDO ? puedeVerDormido(c)
    : puedeVerImpago(c));

  // GET /api/erp/propuestas — las pendientes, con importes y días recalculados en vivo. SOLO de los
  // tipos que este usuario puede ver.
  api.get('/', c => {
    if (!puedeVer(c)) return c.json({ error: 'Sin permiso' }, 403);
    try { return c.json({ propuestas: propuestasPendientes(db, today(), tiposVisibles(c)) }); }
    catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /api/erp/propuestas/contador — nº pendientes, para el badge del topbar. Barato (un COUNT).
  // Cuenta SOLO los tipos visibles: el badge nunca delata propuestas que el usuario no puede abrir.
  api.get('/contador', c => {
    if (!puedeVer(c)) return c.json({ count: 0 });
    try { return c.json({ count: contarPropuestasPendientes(db, tiposVisibles(c)) }); }
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

  // POST /api/erp/propuestas/:id/registrado — D5b. Cierra una propuesta de PAGO cuando el pago YA se
  // registró por su camino normal (el modal de "Pagar" → POST /supplier-invoices/:id/payments). Este
  // endpoint NO mueve dinero: solo apunta que la propuesta quedó atendida. El pago lo escribe —y lo
  // valida, y exige purchases.create— el endpoint de pagos, único que toca supplier_payments. Se pide
  // aquí el MISMO permiso para que no haya un camino más flojo de resolver la propuesta.
  api.post('/:id/registrado', c => {
    if (!can(c, 'purchases.create')) return c.json({ error: 'No tienes permiso para registrar pagos.' }, 403);
    try {
      const id = parseInt(c.req.param('id'));
      const p = db.prepare("SELECT status, type FROM disa_proposals WHERE id=?").get(id);
      if (!p) return c.json({ error: 'Propuesta no encontrada' }, 404);
      if (p.type !== TIPO_PAGO) return c.json({ error: 'Esta propuesta no es de pago.' }, 400);
      if (p.status !== 'pendiente') return c.json({ error: 'Esta propuesta ya se resolvió (' + p.status + ').' }, 409);
      const quien = c.get('session')?.userName || c.get('session')?.userId || '';
      db.prepare("UPDATE disa_proposals SET status='aprobada_registrada', resolved_at=?, resolved_by=? WHERE id=?")
        .run(new Date().toISOString(), String(quien), id);
      return c.json({ ok: true, message: 'Pago registrado.' });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // POST /api/erp/propuestas/:id/emitir — APROBAR Y EMITIR la factura recurrente que toca.
  //
  // NO emite por su cuenta: llama a `emitirOcurrencia`, EL MISMO servicio que hay detrás del botón de
  // /admin/recurrentes — el que pasa por createInvoice y pone la huella Verifactu. Aquí no nace una
  // segunda forma de emitir una factura; solo un atajo para llegar a la que ya existe.
  //
  // Exige `invoices.create`, lo mismo que exige ese POST: si no, esta ruta sería un camino más flojo
  // de emitir. Y como emitirOcurrencia ya rechaza la doble emisión (409 si la ocurrencia no está en
  // 'borrador'), el guardián real está donde tiene que estar: en el motor, no en el panel.
  //
  // La propuesta se marca resuelta SOLO si la factura se emitió de verdad. Si emitirOcurrencia lanza
  // (plantilla sin líneas, ya emitida, lo que sea), la propuesta SIGUE pendiente y se devuelve el
  // motivo: nada se da por hecho si no se hizo.
  api.post('/:id/emitir', c => {
    if (!can(c, 'invoices.create')) return c.json({ error: 'No tienes permiso para emitir facturas.' }, 403);
    try {
      const id = parseInt(c.req.param('id'));
      const p = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(id);
      if (!p) return c.json({ error: 'Propuesta no encontrada' }, 404);
      if (p.type !== TIPO_RECURRENTE) return c.json({ error: 'Esta propuesta no es de emisión recurrente.' }, 400);
      if (p.status !== 'pendiente') return c.json({ error: 'Esta propuesta ya se resolvió (' + p.status + ').' }, 409);
      if (!puedeVerRecurrente(c)) return c.json({ error: 'Sin permiso' }, 403);

      const factura = emitirOcurrencia(db, p.occurrence_id);   // ← la vía real. Si falla, lanza y no se marca nada.

      const quien = c.get('session')?.userName || c.get('session')?.userId || '';
      db.prepare("UPDATE disa_proposals SET status='aprobada_emitida', resolved_at=?, resolved_by=? WHERE id=?")
        .run(new Date().toISOString(), String(quien), id);
      return c.json({ ok: true, invoice_id: factura.id, invoice_number: factura.invoice_number,
        message: 'Factura ' + (factura.invoice_number || '#' + factura.id) + ' emitida.' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // POST /api/erp/propuestas/:id/redactar — APROBAR una propuesta de cliente dormido.
  //
  // APROBAR NO ENVÍA NADA. Lo único que hace es pedirle a DISA que REDACTE el borrador (plantilla
  // `opportunityEmail`, tono 'seguimiento' — la misma que el CRM) y devolverlo para que lo leas y lo
  // edites. La propuesta SIGUE pendiente: aprobar no la resuelve, la prepara. Lo que la resuelve es
  // enviarla o descartarla.
  //
  // Exige el MISMO permiso que enviar (crm.manage): que redactar fuera más barato que enviar sería
  // regalarle a un usuario sin permiso el texto y los datos del cliente.
  api.post('/:id/redactar', c => {
    if (!puedeVerDormido(c)) return c.json({ error: 'No tienes permiso para escribir a clientes.' }, 403);
    try {
      const r = redactarReenganche(db, parseInt(c.req.param('id')));
      return c.json({ ok: true, ...r, message: 'Borrador preparado. Léelo antes de enviarlo.' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // POST /api/erp/propuestas/:id/enviar — ENVIAR el email de reenganche (el segundo clic).
  //
  // Reutiliza `registerClientActivitySvc` con type='email': la MISMA vía por la que el CRM le escribe
  // a un cliente. Manda por Resend (core/mailer, el único envoltorio del proyecto) y deja el contacto
  // registrado en `client_activities` — así el email de DISA queda en el historial del cliente igual
  // que si lo hubieras escrito tú a mano, que es exactamente lo que ha pasado.
  //
  // Exige `crm.manage`, lo mismo que exige esa ruta: si no, sería un camino más flojo de escribirle a
  // un cliente. Y la propuesta se marca enviada SOLO si el email salió: si Resend falla, el servicio
  // lanza, la propuesta SIGUE pendiente y se devuelve el motivo. Nada se da por enviado si no se envió.
  api.post('/:id/enviar', async c => {
    if (!can(c, 'crm.manage')) return c.json({ error: 'No tienes permiso para escribir a clientes.' }, 403);
    try {
      const id = parseInt(c.req.param('id'));
      const body = await c.req.json().catch(() => ({}));
      const p = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(id);
      if (!p) return c.json({ error: 'Propuesta no encontrada' }, 404);
      if (p.type !== TIPO_DORMIDO) return c.json({ error: 'Esta propuesta no es de cliente dormido.' }, 400);
      if (p.status !== 'pendiente') return c.json({ error: 'Esta propuesta ya se resolvió (' + p.status + ').' }, 409);
      if (!puedeVerDormido(c)) return c.json({ error: 'Sin permiso' }, 403);

      // El texto que se manda es el que el usuario tiene DELANTE (pudo editarlo); si no llega, el que
      // DISA redactó. Nunca se envía un borrador vacío.
      const subject = String(body.subject != null ? body.subject : p.subject).trim();
      const text = String(body.body != null ? body.body : p.body);
      if (!subject || !text.trim()) {
        return c.json({ error: 'El asunto y el mensaje no pueden estar vacíos. Aprueba la propuesta para que DISA redacte el borrador.' }, 400);
      }

      const r = await registerClientActivitySvc(db, p.client_id,
        { type: 'email', email_subject: subject, email_text: text, note: 'Reenganche propuesto por DISA' },
        { sendEmail, userName: c.get('session')?.userName || '' });

      const quien = c.get('session')?.userName || c.get('session')?.userId || '';
      db.prepare("UPDATE disa_proposals SET status='aprobada_enviada', subject=?, body=?, resolved_at=?, resolved_by=? WHERE id=?")
        .run(subject, text, new Date().toISOString(), String(quien), id);
      return c.json({ ok: true, to: r.email?.to, message: 'Email enviado a ' + (r.email?.to || 'el cliente') + '.' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // POST /api/erp/propuestas/:id/descartar — marca 'descartada'. Por el índice único (factura,tipo)
  // NO se vuelve a proponer esa factura. No envía ni paga nada. Exige el permiso de VER de SU tipo:
  // descartar una propuesta de pago necesita permiso de compras, no de cobros.
  api.post('/:id/descartar', c => {
    try {
      const id = parseInt(c.req.param('id'));
      const p = db.prepare("SELECT status, type FROM disa_proposals WHERE id=?").get(id);
      if (!p) return c.json({ error: 'Propuesta no encontrada' }, 404);
      if (!puedeVerTipo(c, p.type)) return c.json({ error: 'Sin permiso' }, 403);
      if (p.status !== 'pendiente') return c.json({ error: 'Esta propuesta ya se resolvió.' }, 409);
      const quien = c.get('session')?.userName || c.get('session')?.userId || '';
      db.prepare("UPDATE disa_proposals SET status='descartada', resolved_at=?, resolved_by=? WHERE id=?")
        .run(new Date().toISOString(), String(quien), id);
      return c.json({ ok: true, message: 'Propuesta descartada.' });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // POST /api/erp/propuestas/generar — genera a demanda (además del cron diario), para que el panel
  // muestre propuestas sin esperar al barrido. Solo de los tipos que el usuario puede ver: quien no
  // tiene permiso de compras ni siquiera dispara la generación de propuestas de pago.
  api.post('/generar', c => {
    const tipos = tiposVisibles(c);
    if (!tipos.length) return c.json({ error: 'Sin permiso' }, 403);
    try {
      const out = {};
      if (tipos.includes(TIPO_IMPAGO)) out.impago = generarPropuestasImpago(db, { today: today() });
      if (tipos.includes(TIPO_PAGO)) out.pago = generarPropuestasPago(db, { today: today() });
      if (tipos.includes(TIPO_RECURRENTE)) out.recurrente = generarPropuestasRecurrentes(db, { today: today() });
      if (tipos.includes(TIPO_DORMIDO)) out.dormido = generarPropuestasDormidos(db, { today: today() });
      return c.json(out);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /admin/propuestas — la pantalla. Gate de VER; las acciones revalidan su permiso en la API.
  views.get('/', c => {
    if (!puedeVer(c)) return c.html(adminLayout('Propuestas de DISA',
      '<div class="card"><div class="card-body">No tienes permiso para ver las propuestas de DISA.</div></div>',
      'propuestas', c.get('session')?.csrfToken || '', c));
    const csrf = c.get('session')?.csrfToken || '';
    const puedeAprobar = can(c, 'cobros.manage');
    const puedePagar = can(c, 'purchases.create');   // el mismo que exige el botón "Pagar" de /admin/pagos
    const puedeEmitir = can(c, 'invoices.create');   // el mismo que exige emitir en /admin/recurrentes
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Propuestas de DISA</h2>
        <button class="btn btn-secondary" onclick="loadProps()"><i class="ti ti-refresh"></i> Actualizar</button>
      </div>
      <div class="card" style="margin-bottom:1rem"><div class="card-body" style="color:var(--muted)">
        DISA prepara el trabajo y te lo deja listo: recordatorios de cobro para tus facturas vencidas,
        los pagos a proveedor que están a punto de vencer, las facturas recurrentes (igualas y cuotas)
        que tocan y aún no has emitido, y los clientes que te compraban y han dejado de hacerlo.
        <strong>Nada se ejecuta solo:</strong> revísalo, edítalo si quieres, y apruébalo — o descártalo.
      </div></div>
      <div id="propList">${skeletonRows ? '' : ''}<p style="color:var(--muted)">Cargando…</p></div>
      ${pagoModalHtml()}
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
        .prop-tag{display:inline-block;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:.12rem .4rem;border-radius:5px;vertical-align:.08em}
        .prop-tag.t-cobro{background:var(--accent-soft,rgba(59,130,246,.14));color:var(--accent,#3b82f6)}
        .prop-tag.t-pago{background:rgba(245,158,11,.14);color:#b45309}
        .prop-tag.t-recurrente{background:rgba(16,185,129,.14);color:#047857}
        .prop-tag.t-dormido{background:rgba(139,92,246,.14);color:#6d28d9}
      </style>
      <script>
      ${pagoModalScript(sym)}
      const SYM = ${JSON.stringify(sym)};
      const PUEDE_APROBAR = ${puedeAprobar ? 'true' : 'false'};
      const PUEDE_PAGAR = ${puedePagar ? 'true' : 'false'};
      const PUEDE_EMITIR = ${puedeEmitir ? 'true' : 'false'};
      const PUEDE_ESCRIBIR = ${can(c, 'crm.manage') ? 'true' : 'false'};
      // De factura de compra → id de propuesta. El modal de pago avisa con el id de la FACTURA
      // (no sabe nada de propuestas); así sabemos qué propuesta cerrar cuando el pago se guarda.
      let PROP_POR_FACTURA = {};

      // ── Tarjeta de RECORDATORIO DE IMPAGO (D5): borrador de email editable ──
      function impagoHtml(p){
        const dias = p.dias_vencida != null ? (p.dias_vencida + ' día' + (p.dias_vencida===1?'':'s') + ' de retraso') : 'retraso desconocido';
        const imp = (p.importe!=null ? p.importe.toFixed(2) : '—');
        const noViva = p.viva ? '' : '<p class="prop-warn">⚠ Esta factura ya no figura como deuda viva (¿cobrada?). Revisa antes de enviar.</p>';
        const acciones = PUEDE_APROBAR
          ? '<button class="btn btn-primary btn-sm" onclick="aprobar('+p.id+')">Aprobar y enviar</button>'
          : '<span class="prop-meta">Necesitas permiso de gestión de cobros para enviar.</span>';
        return '<div class="prop-card" id="prop'+p.id+'">'
          +'<div class="prop-head"><div><span class="prop-tag t-cobro">Cobro</span> <strong>'+escHtml(p.client_name||'Cliente')+'</strong> · '+escHtml(p.invoice_number||('#'+p.invoice_id))+'</div>'
          +'<div class="prop-meta">'+SYM+imp+' · '+dias+'</div></div>'
          +'<div class="prop-meta">Para: '+escHtml(p.client_email||'(sin email)')+'</div>'
          + noViva
          +'<div class="prop-field"><label>Asunto</label><input id="subj'+p.id+'" value="'+escHtml(p.subject||'')+'"></div>'
          +'<div class="prop-field"><label>Mensaje</label><textarea id="body'+p.id+'">'+escHtml(p.body||'')+'</textarea></div>'
          +'<div class="prop-actions">'+acciones
          +' <button class="btn btn-secondary btn-sm" onclick="descartar('+p.id+')">Descartar</button></div>'
          +'</div>';
      }

      // ── Tarjeta de PAGO POR VENCER (D5b): NO hay email. Aprobar = abrir el MISMO modal del botón
      //    "Pagar" de /admin/pagos, precargado con el importe pendiente. Editar (importe, fecha,
      //    forma, nota) es lo que ese modal ya permite. ──
      function pagoHtml(p){
        const d = p.dias_para_vencer;
        const cuando = d == null ? 'sin fecha de vencimiento'
          : d === 0 ? 'vence HOY'
          : 'vence en ' + d + ' día' + (d===1?'':'s');
        const imp = (p.importe!=null ? p.importe.toFixed(2) : '—');
        const factura = escHtml(p.internal_code || ('#'+p.supplier_invoice_id))
          + (p.supplier_invoice_number ? ' <span class="prop-meta">'+escHtml(p.supplier_invoice_number)+'</span>' : '');
        const noViva = p.viva ? '' : '<p class="prop-warn">⚠ Esta factura ya no figura como deuda viva (¿pagada?). Revísala antes de pagar.</p>';
        const acciones = PUEDE_PAGAR
          ? '<button class="btn btn-primary btn-sm" onclick="openPagos('+p.supplier_invoice_id+')">Aprobar y registrar pago</button>'
          : '<span class="prop-meta">Necesitas permiso de compras para registrar el pago.</span>';
        return '<div class="prop-card" id="prop'+p.id+'">'
          +'<div class="prop-head"><div><span class="prop-tag t-pago">Pago</span> <strong>'+escHtml(p.supplier_name||'Proveedor')+'</strong> · '+factura+'</div>'
          +'<div class="prop-meta"><strong>'+SYM+imp+'</strong> · '+cuando+'</div></div>'
          +'<div class="prop-meta">Vencimiento: '+escHtml(p.due_date||'—')+' · importe pendiente '+SYM+imp+'</div>'
          + noViva
          +'<div class="prop-actions">'+acciones
          +' <button class="btn btn-secondary btn-sm" onclick="descartar('+p.id+')">Descartar</button></div>'
          +'</div>';
      }

      // ── Tarjeta de EMITIR FACTURA RECURRENTE: la iguala que toca y sigue sin emitirse. No hay nada
      //    que rellenar (la plantilla ya dice cliente, líneas, IVA e IRPF): Aprobar = emitir, un clic.
      //    El importe viene recalculado EN VIVO desde la plantilla, no de la copia del día que se propuso. ──
      function recurrenteHtml(p){
        const imp = (p.importe!=null ? p.importe.toFixed(2) : '—');
        const desglose = (p.base!=null)
          ? 'base '+SYM+p.base.toFixed(2)+' + IVA '+SYM+p.iva.toFixed(2)+(p.irpf>0?' − IRPF '+SYM+p.irpf.toFixed(2):'')
          : '';
        const noViva = p.viva ? ''
          : '<p class="prop-warn">⚠ Este borrador ya no está pendiente'+(p.occ_status?' ('+escHtml(p.occ_status)+')':'')+'. Se emitió u omitió desde Recurrentes. Descártala.</p>';
        const acciones = (PUEDE_EMITIR && p.viva)
          ? '<button class="btn btn-primary btn-sm" onclick="emitir('+p.id+')">Aprobar y emitir</button>'
          : (!PUEDE_EMITIR ? '<span class="prop-meta">Necesitas permiso para emitir facturas.</span>' : '');
        return '<div class="prop-card" id="prop'+p.id+'">'
          +'<div class="prop-head"><div><span class="prop-tag t-recurrente">Recurrente</span> <strong>'+escHtml(p.client_name||'Cliente')+'</strong> · '+escHtml(p.document_name||'Factura')+'</div>'
          +'<div class="prop-meta"><strong>'+SYM+imp+'</strong> · toca el '+escHtml(p.due_date||'—')+'</div></div>'
          +'<div class="prop-meta">'+escHtml(p.concepto||'—')+(desglose?' · '+desglose:'')+'</div>'
          + noViva
          +'<div class="prop-actions">'+acciones
          +' <button class="btn btn-secondary btn-sm" onclick="descartar('+p.id+')">Descartar</button></div>'
          +'</div>';
      }

      // ── Tarjeta de CLIENTE DORMIDO: el que te compraba y dejó de hacerlo.
      //    DOS PASOS a propósito: primero DISA REDACTA (aprobar), y solo después TÚ envías. Mientras
      //    no esté redactada, no hay texto que enseñar — y no se manda nada sin que lo leas. ──
      function dormidoHtml(p){
        const dias = p.dias_sin_comprar != null ? p.dias_sin_comprar + ' días sin comprar' : 'sin datos de compra';
        // El PORQUÉ, siempre a la vista: una propuesta que no puede explicarse no se aprueba, se ignora.
        const razon = p.motivo ? '<div class="prop-meta">Por qué: '+escHtml(p.motivo)+' · última compra el '+escHtml(p.ultima_compra||'—')+' ('+p.compras+' compra'+(p.compras===1?'':'s')+')</div>' : '';
        const noViva = p.viva ? ''
          : '<p class="prop-warn">⚠ Este cliente YA NO está dormido: te ha comprado desde que se propuso. Descártala — no le escribas que le echas de menos.</p>';
        if (!p.redactada) {
          const acc = (PUEDE_ESCRIBIR && p.viva)
            ? '<button class="btn btn-primary btn-sm" onclick="redactar('+p.id+')">Aprobar — DISA redacta el email</button>'
            : (!PUEDE_ESCRIBIR ? '<span class="prop-meta">Necesitas permiso de CRM para escribir a clientes.</span>' : '');
          return '<div class="prop-card" id="prop'+p.id+'">'
            +'<div class="prop-head"><div><span class="prop-tag t-dormido">Dormido</span> <strong>'+escHtml(p.client_name||'Cliente')+'</strong></div>'
            +'<div class="prop-meta">'+dias+'</div></div>'
            + razon
            +'<div class="prop-meta">Para: '+escHtml(p.client_email||'(sin email)')+'</div>'
            + noViva
            +'<div class="prop-meta" style="margin-top:.4rem;font-style:italic">Aprobar NO envía nada: DISA te redacta el borrador y lo lees antes.</div>'
            +'<div class="prop-actions">'+acc
            +' <button class="btn btn-secondary btn-sm" onclick="descartar('+p.id+')">Descartar</button></div>'
            +'</div>';
        }
        // Ya redactada: el borrador, editable, y el botón de enviar de verdad.
        const acc = PUEDE_ESCRIBIR
          ? '<button class="btn btn-primary btn-sm" onclick="enviarDormido('+p.id+')">Enviar email</button>'
          : '<span class="prop-meta">Necesitas permiso de CRM para enviar.</span>';
        return '<div class="prop-card" id="prop'+p.id+'">'
          +'<div class="prop-head"><div><span class="prop-tag t-dormido">Dormido</span> <strong>'+escHtml(p.client_name||'Cliente')+'</strong> · <span class="prop-meta">borrador listo</span></div>'
          +'<div class="prop-meta">'+dias+'</div></div>'
          + razon
          +'<div class="prop-meta">Para: '+escHtml(p.client_email||'(sin email)')+'</div>'
          + noViva
          +'<div class="prop-field"><label>Asunto</label><input id="subj'+p.id+'" value="'+escHtml(p.subject||'')+'"></div>'
          +'<div class="prop-field"><label>Mensaje (edítalo si quieres)</label><textarea id="body'+p.id+'">'+escHtml(p.body||'')+'</textarea></div>'
          +'<div class="prop-actions">'+acc
          +' <button class="btn btn-secondary btn-sm" onclick="descartar('+p.id+')">Descartar</button></div>'
          +'</div>';
      }

      function propHtml(p){
        if (p.type==='pago_por_vencer') return pagoHtml(p);
        if (p.type==='emitir_recurrente') return recurrenteHtml(p);
        if (p.type==='cliente_dormido') return dormidoHtml(p);
        return impagoHtml(p);
      }

      function pintar(props){
        const box=document.getElementById('propList');
        PROP_POR_FACTURA = {};
        props.forEach(function(p){ if(p.type==='pago_por_vencer') PROP_POR_FACTURA[p.supplier_invoice_id]=p.id; });
        box.innerHTML = props.length ? props.map(propHtml).join('')
          : (window.emptyRow ? '' : '') + '<div class="card"><div class="card-body" style="color:var(--muted)">No hay propuestas pendientes. Cuando una factura de venta lleve vencida más días que el umbral, un pago a proveedor esté a punto de vencer, o toque emitir una factura recurrente, DISA lo preparará aquí.</div></div>';
        if (typeof window.propBadgeSync==='function') window.propBadgeSync(props.length);
      }

      // El modal de pago llama aquí tras registrar el pago DE VERDAD (por su endpoint de siempre).
      // Solo entonces se cierra la propuesta: si el pago falla, la propuesta sigue pendiente.
      window.pagoOnSaved = async function(supplierInvoiceId){
        const propId = PROP_POR_FACTURA[supplierInvoiceId];
        if (propId) { try { await api('POST','/api/erp/propuestas/'+propId+'/registrado',{}); } catch(e){} }
        if (typeof closeModal==='function') closeModal('pagoModal');
        loadProps();
      };
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
      // Emitir = un clic. Llama a la propuesta, que por dentro usa la MISMA vía que /admin/recurrentes.
      // Si la emisión falla, la propuesta sigue pendiente y se ve el motivo.
      window.emitir = async function(id){
        if (!confirm('¿Emitir esta factura recurrente? Nacerá con su número y su huella Verifactu.')) return;
        try { const r=await api('POST','/api/erp/propuestas/'+id+'/emitir',{});
              toast(r.message||'Factura emitida'); loadProps(); }
        catch(e){ toast(e.message||'Error','err'); }
      };
      // Aprobar un dormido = que DISA REDACTE. No manda nada; recarga la tarjeta con el borrador dentro.
      window.redactar = async function(id){
        try { const r=await api('POST','/api/erp/propuestas/'+id+'/redactar',{});
              toast(r.message||'Borrador preparado'); loadProps(); }
        catch(e){ toast(e.message||'Error','err'); }
      };
      // Y este es el clic que SÍ manda el email, con el texto que tienes delante (editado o no).
      window.enviarDormido = async function(id){
        const subject=document.getElementById('subj'+id).value;
        const body=document.getElementById('body'+id).value;
        if (!confirm('¿Enviar este email a tu cliente?')) return;
        try { const r=await api('POST','/api/erp/propuestas/'+id+'/enviar',{subject,body});
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
