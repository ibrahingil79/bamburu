// SUSCRIPCIÓN — lo que el negocio paga por usar Bamburu.
//
// Tarea `suscripcion-plan-y-alta` (2 sep 2026). Es SOLO el plan y la puerta de entrada: el cobro
// mensual del día 5, el impago y la bóveda son las tres tareas siguientes y no se adelantan aquí.
//
// LAS DECISIONES QUE CONVIENE NO DESHACER SIN PENSARLO:
//
//  · **El precio no se escribe aquí.** Ni "9,90", ni el 21 del IVA, ni los 15 días. Todo sale de
//    `core/plan.js`, que es el "un solo sitio configurable" del criterio 1. Si en esta pantalla
//    aparece un número de dinero escrito a mano, es un fallo.
//
//  · **El importe se enseña ANTES de ir a Stripe, y el dueño lo confirma.** CANON §"acciones con
//    dinero": nada de ejecución silenciosa. La pantalla dice exactamente cuánto se va a cobrar, por
//    cuántos días y hasta qué fecha, antes de que nadie toque una tarjeta.
//
//  · **Dar la tarjeta durante la prueba NO cobra nada.** El criterio 3 dice «AL TERMINAR la prueba,
//    o al darse de alta a mitad de mes». Si quedan días de prueba, se guarda la tarjeta y se cobra
//    cuando venza — lo hace `scripts/suscripcion-cobros.mjs`, una vez al día. Cobrar al guardar la
//    tarjeta le quitaría al cliente los días que le quedan, que es justo lo contrario de lo pedido.
//
//  · **La tarjeta se teclea en Stripe, no en Bamburu.** Checkout alojado, en modo `setup`. Aquí no
//    entra nunca un número de tarjeta, así que el producto se queda fuera del alcance de PCI-DSS.
//
//  · **Solo el DUEÑO.** No es un permiso nuevo de la tabla `permissions`: es el rol. Esto no es una
//    pantalla del negocio, es el contrato del negocio con Bamburu — y `checkPermission` le da paso
//    también a un `admin`, que aquí no queremos. Mismo criterio que el historial clínico
//    (`core/auth.js:338`), que también se sale del bypass por su cuenta y con su motivo.
//
//  · **Se opera como AUTÓNOMO.** En toda esta pantalla no se pide, ni se menciona, ninguna sociedad
//    (criterio 4). Si alguien añade un campo de "razón social obligatoria", rompe el criterio.

import { Hono } from 'hono';
import { escHtml } from '../../../core/escape.js';
import { adminLayout } from '../layout.js';
import { safeError } from '../../../core/errors.js';
import { controlDb } from '../../../core/control-db.js';
import { plan, textoPrecio, eur } from '../../../core/plan.js';
import { situacion, prorrateo, asegurarSuscripcion, suscripcionDe, guardarSuscripcion,
         hoyISO, fechaEnPalabras, siguienteDiaDeCobro } from '../../../core/suscripcion.js';
import * as stripe from '../../../core/stripe.js';

// El dueño y nadie más. Devuelve la respuesta de denegación ya hecha, o `null` si puede pasar.
function soloDueno(c) {
  if (c.get('isOwner')) return null;
  return c.html(adminLayout('Suscripción', `
    <div class="page-header"><h1>Suscripción</h1></div>
    <div class="card" style="max-width:640px"><div class="card-body">
      <h3 style="margin-bottom:.5rem">Esto solo lo ve el dueño del negocio</h3>
      <p style="font-size:.88rem;color:var(--text3);line-height:1.6">
        La suscripción es el contrato entre tu negocio y Bamburu, así que solo la ve y la gestiona la
        persona dueña de la cuenta. Si necesitas cambiar la tarjeta o ver la situación de pago,
        pídeselo a quien sea dueño.
      </p>
      <a href="/admin" class="btn" style="margin-top:1rem">Volver al inicio</a>
    </div></div>`, 'suscripcion', c.get('session')?.csrfToken || '', c), 403);
}

export function createSuscripcionRoutes(db) {
  const views = new Hono();
  const api = new Hono();

  // ── La pantalla (criterio 5) ────────────────────────────────────────────────
  views.get('/', c => {
    const no = soloDueno(c); if (no) return no;
    const tenant = c.get('tenant');
    if (!tenant) return c.redirect('/admin');

    asegurarSuscripcion(tenant.id);
    const s = situacion(tenant.id);
    const P = plan();
    const diag = stripe.diagnostico();
    const msg = c.req.query('msg');
    const err = c.req.query('err');

    // El importe del PRIMER cobro, calculado con la fecha que de verdad le toca a este negocio: si
    // la prueba sigue viva, desde el día en que vence; si ya venció, desde hoy.
    const desdeCobro = (s.situacion === 'prueba' && s.prueba_fin) ? s.prueba_fin : hoyISO();
    const pr = prorrateo(desdeCobro);

    const INSIGNIA = {
      prueba:            ['De prueba', 'sus-chip-info'],
      prueba_terminada:  ['Prueba terminada', 'sus-chip-aviso'],
      al_corriente:      ['Al corriente', 'sus-chip-ok'],
      pago_pendiente:    ['Pago pendiente', 'sus-chip-mal'],
      sin_suscripcion:   ['Sin suscripción', 'sus-chip-aviso'],
    }[s.situacion] || ['—', 'sus-chip-aviso'];

    const tarjetaHtml = s.tarjeta
      ? `<div class="sus-tarjeta">
           <i class="ti ti-credit-card"></i>
           <span><strong>${escHtml(s.tarjeta.marca)}</strong> ···· ${escHtml(s.tarjeta.ultimos4)}</span>
           ${s.tarjeta.caduca ? `<span class="sus-cad">caduca ${escHtml(s.tarjeta.caduca)}</span>` : ''}
         </div>`
      : `<p class="sus-sin-tarjeta">No hay ninguna tarjeta guardada. No te hemos pedido ninguna para la prueba.</p>`;

    const content = `
    <style>
      .sus-grid{display:grid;grid-template-columns:1fr;gap:1rem;max-width:760px}
      .sus-chip{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .8rem;border-radius:20px;font-size:.8rem;font-weight:500}
      .sus-chip-ok{background:var(--ok-s);border:1px solid var(--ok);color:var(--ok)}
      .sus-chip-info{background:var(--accent-soft);border:1px solid var(--accent);color:var(--accent)}
      .sus-chip-aviso{background:var(--bg3);border:1px solid var(--border);color:var(--text3)}
      .sus-chip-mal{background:var(--danger-s);border:1px solid var(--danger);color:var(--danger)}
      .sus-titulo{font-size:1.05rem;font-weight:600;margin:.75rem 0 .35rem}
      .sus-detalle{font-size:.88rem;color:var(--text3);line-height:1.6}
      .sus-precio{font-size:1.6rem;font-weight:600;letter-spacing:-.02em}
      .sus-precio small{font-size:.85rem;font-weight:400;color:var(--text3);letter-spacing:0}
      .sus-desglose{font-size:.82rem;color:var(--text3);margin-top:.35rem;line-height:1.6}
      .sus-tarjeta{display:flex;align-items:center;gap:.6rem;font-size:.9rem;background:var(--bg3);
        border:1px solid var(--border);border-radius:8px;padding:.65rem .9rem}
      .sus-cad{font-size:.78rem;color:var(--text3)}
      .sus-sin-tarjeta{font-size:.85rem;color:var(--text3);line-height:1.6}
      .sus-nota{background:var(--accent-soft);border:1px solid var(--border);border-radius:8px;
        padding:.7rem .9rem;font-size:.82rem;color:var(--text2);margin-top:.75rem;line-height:1.6}
      .sus-alert{padding:.75rem 1rem;border-radius:8px;font-size:.85rem;margin-bottom:1.2rem;max-width:760px}
      .sus-ok{background:var(--ok-s);border:1px solid var(--ok);color:var(--ok)}
      .sus-err{background:var(--danger-s);border:1px solid var(--danger);color:var(--danger)}
      .sus-prueba-lab{background:#7c3a0033;border:1px solid #c2751a;color:#c2751a;border-radius:8px;
        padding:.6rem .9rem;font-size:.8rem;margin-bottom:1rem;max-width:760px;line-height:1.5}
      .sus-tabla{width:100%;font-size:.85rem;border-collapse:collapse;margin-top:.5rem}
      .sus-tabla td{padding:.35rem 0;color:var(--text3)}
      .sus-tabla td:last-child{text-align:right;color:var(--text);font-variant-numeric:tabular-nums}
      .sus-tabla tr.sus-total td{border-top:1px solid var(--border);padding-top:.5rem;font-weight:600;color:var(--text)}
    </style>

    <div class="page-header"><h1>Mi suscripción</h1></div>

    ${msg ? `<div class="sus-alert sus-ok">${escHtml(decodeURIComponent(msg))}</div>` : ''}
    ${err ? `<div class="sus-alert sus-err">${escHtml(decodeURIComponent(err))}</div>` : ''}
    ${diag.modo === 'PRUEBA'
      ? `<div class="sus-prueba-lab"><strong>Stripe está en modo de PRUEBA.</strong> Ningún cobro de
           esta pantalla mueve dinero de verdad. Se usan las tarjetas de prueba de Stripe
           (por ejemplo <code>4242 4242 4242 4242</code>, cualquier fecha futura y cualquier CVC).</div>`
      : ''}

    <div class="sus-grid">

      <div class="card"><div class="card-body">
        <span class="sus-chip ${INSIGNIA[1]}">${escHtml(INSIGNIA[0])}</span>
        <div class="sus-titulo">${escHtml(s.titulo)}</div>
        <p class="sus-detalle">${escHtml(s.detalle)}</p>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem">Tu plan</h3>
        <div class="sus-precio">${escHtml(P.texto_precio)}</div>
        <div class="sus-desglose">
          Se te cobra <strong>${escHtml(P.desglose_mes.total)}</strong> al mes
          (${escHtml(P.desglose_mes.base)} + ${escHtml(String(P.desglose_mes.iva_porcentaje))} % de IVA:
          ${escHtml(P.desglose_mes.iva)}), el día ${escHtml(String(P.dia_de_cobro))} de cada mes.
          Tu factura desglosa la base y el IVA, como manda la ley.
        </div>
        <div class="sus-nota">
          Un plan único, sin permanencia y sin letra pequeña. Los ${escHtml(String(P.dias_prueba))} días
          de prueba son gratis y <strong>no te pedimos ninguna tarjeta</strong> para empezar.
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem">Tu tarjeta</h3>
        ${tarjetaHtml}

        <h3 style="font-size:.9rem;font-weight:600;margin:1.25rem 0 .3rem">
          ${s.situacion === 'prueba' ? 'Tu primer cobro' : 'Lo que se te cobrará ahora'}
        </h3>
        <p class="sus-detalle">
          ${pr.es_mes_completo
            ? `Un mes completo, del ${escHtml(fechaEnPalabras(pr.desde))} al ${escHtml(fechaEnPalabras(pr.hasta))}.`
            : `La parte proporcional: <strong>${escHtml(String(pr.dias_periodo))} de ${escHtml(String(pr.dias_ciclo))} días</strong>,
               del ${escHtml(fechaEnPalabras(pr.desde))} al ${escHtml(fechaEnPalabras(pr.hasta))}.`}
          ${s.situacion === 'prueba'
            ? ` No se te cobra nada hasta que termine la prueba, el ${escHtml(fechaEnPalabras(s.prueba_fin))}.`
            : ''}
        </p>
        <table class="sus-tabla">
          <tr><td>Base</td><td>${escHtml(pr.base)}</td></tr>
          <tr><td>IVA (${escHtml(String(pr.iva_porcentaje))} %)</td><td>${escHtml(pr.iva)}</td></tr>
          <tr class="sus-total"><td>Total</td><td>${escHtml(pr.total)}</td></tr>
        </table>

        <div style="margin-top:1.1rem;display:flex;gap:.6rem;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="susAlta"
                  data-total="${escHtml(pr.total)}"
                  data-cuando="${escHtml(s.situacion === 'prueba' ? 'al terminar tu prueba, el ' + fechaEnPalabras(s.prueba_fin) : 'ahora mismo')}">
            ${s.tarjeta ? 'Cambiar de tarjeta' : 'Dejar una tarjeta'}
          </button>
          <a href="/admin" class="btn">Volver</a>
        </div>
        <p id="susAviso" class="sus-detalle" style="margin-top:.6rem"></p>

        ${!diag.usable ? `<div class="sus-nota" style="border-color:var(--danger);color:var(--danger)">
          Los pagos todavía no están conectados en este servidor, así que el botón no funcionará.
          ${diag.hay_clave && !diag.es_de_prueba
            ? 'Hay una clave de Stripe de producción y el modo real no está autorizado.'
            : 'Falta configurar Stripe: <code>bash scripts/configurar-stripe.sh</code>.'}
        </div>` : ''}
      </div></div>
    </div>

    <script>
      // CERO ventanitas del navegador: se pregunta DENTRO de la página con el panel compartido
      // (window.confirmarEnPagina, layout.js). Un confirm() aquí sería un botón que deja de
      // funcionar en silencio en cuanto alguien marca "impedir cuadros de diálogo".
      document.getElementById('susAlta')?.addEventListener('click', async (ev) => {
        const boton = ev.currentTarget;
        const aviso = document.getElementById('susAviso');
        const total = boton.dataset.total || '';
        const cuando = boton.dataset.cuando || 'ahora mismo';

        const sigue = await window.confirmarEnPagina({
          titulo: 'Vas a dejar una tarjeta',
          mensaje: 'La tarjeta la tecleas en la pantalla segura de Stripe, no aquí. Se te cobrará '
                 + total + ' ' + cuando + '. Puedes cambiarla o quitarla cuando quieras.',
          aceptar: 'Continuar a Stripe',
          cancelar: 'Ahora no',
        });
        if (!sigue) { aviso.textContent = 'No se ha hecho nada.'; return; }

        boton.disabled = true;
        aviso.textContent = 'Preparando la pantalla de Stripe…';
        try {
          const r = await fetch('/api/erp/suscripcion/alta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' },
            body: JSON.stringify({}),
          });
          const d = await r.json();
          if (!r.ok || !d.url) {
            boton.disabled = false;
            aviso.textContent = d.error || 'No se pudo abrir la pantalla de pago. Inténtalo de nuevo.';
            return;
          }
          window.location.href = d.url;
        } catch (e) {
          boton.disabled = false;
          aviso.textContent = 'No se pudo contactar con el servidor. Inténtalo de nuevo.';
        }
      });
    </script>`;

    return c.html(adminLayout('Mi suscripción', content, 'suscripcion', c.get('session')?.csrfToken || '', c));
  });

  // ── Vuelta desde Stripe ─────────────────────────────────────────────────────
  // `success_url` de la sesión de Checkout. Aquí se guarda la tarjeta y —solo si la prueba ya
  // venció— se cobra la parte proporcional.
  views.get('/vuelta', async c => {
    const no = soloDueno(c); if (no) return no;
    const tenant = c.get('tenant');
    const sesionId = c.req.query('sesion') || '';
    const volver = (q) => c.redirect('/admin/suscripcion?' + q);

    if (!sesionId) return volver('err=' + encodeURIComponent('No sabemos de qué alta vienes.'));

    try {
      const ses = await stripe.recuperarSesion(sesionId);
      if (!ses.ok) return volver('err=' + encodeURIComponent(ses.error));

      // Que la sesión sea de ESTE negocio, y no de otro cuyo identificador alguien haya pegado.
      if (String(ses.datos?.metadata?.bamburu_tenant_id || '') !== String(tenant.id)) {
        return volver('err=' + encodeURIComponent('Esa alta no es de este negocio.'));
      }
      if (ses.datos?.status !== 'complete') {
        return volver('err=' + encodeURIComponent('El alta no llegó a completarse. No se ha guardado ninguna tarjeta.'));
      }

      const si = await stripe.recuperarSetupIntent(ses.datos.setup_intent);
      if (!si.ok) return volver('err=' + encodeURIComponent(si.error));
      const metodoId = si.datos?.payment_method;
      if (!metodoId) return volver('err=' + encodeURIComponent('Stripe no devolvió ninguna tarjeta.'));

      const mp = await stripe.recuperarMetodoPago(metodoId);
      const tarjeta = mp.ok ? (mp.datos?.card || {}) : {};

      await stripe.fijarMetodoPorDefecto(ses.datos.customer, metodoId);

      guardarSuscripcion(tenant.id, {
        stripe_cliente_id: ses.datos.customer,
        stripe_metodo_pago_id: metodoId,
        tarjeta_marca: tarjeta.brand || 'tarjeta',
        tarjeta_ultimos4: tarjeta.last4 || null,
        tarjeta_caduca: tarjeta.exp_month ? `${String(tarjeta.exp_month).padStart(2, '0')}/${tarjeta.exp_year}` : null,
        ultimo_error: null,
      });

      // ¿Toca cobrar ya? SOLO si la prueba terminó. Con prueba viva se guarda la tarjeta y punto:
      // el criterio dice «al terminar la prueba», y quitarle días pagados sería incumplirlo.
      const est = situacion(tenant.id);
      if (est.situacion === 'prueba') {
        return volver('msg=' + encodeURIComponent(
          `Tarjeta guardada. No se te ha cobrado nada: tu prueba sigue hasta el ${fechaEnPalabras(est.prueba_fin)}.`));
      }

      const { cobrarProrrateo } = await import('../../../core/suscripcion-cobro.js');
      const res = await cobrarProrrateo(tenant, { db: controlDb });
      return volver(res.ok
        ? 'msg=' + encodeURIComponent(`Tarjeta guardada y primer cobro hecho: ${res.importe}. Gracias.`)
        : 'err=' + encodeURIComponent(`Tarjeta guardada, pero el cobro no salió: ${res.error}`));
    } catch (e) {
      return volver('err=' + encodeURIComponent(safeError(e, 'No se pudo terminar el alta.')));
    }
  });

  views.get('/cancelado', c => {
    const no = soloDueno(c); if (no) return no;
    return c.redirect('/admin/suscripcion?msg=' + encodeURIComponent('No se ha guardado ninguna tarjeta. No se te ha cobrado nada.'));
  });

  // ── API: abrir el Checkout ──────────────────────────────────────────────────
  api.post('/alta', async c => {
    if (!c.get('isOwner')) return c.json({ error: 'Solo el dueño puede gestionar la suscripción.' }, 403);
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'No se pudo identificar el negocio.' }, 400);

    try {
      asegurarSuscripcion(tenant.id);
      const s = suscripcionDe(tenant.id);

      let clienteId = s?.stripe_cliente_id || null;
      if (!clienteId) {
        const cli = await stripe.crearCliente({
          nombre: tenant.name, email: c.get('session')?.email || null,
          tenantId: tenant.id, slug: tenant.slug,
        });
        if (!cli.ok) return c.json({ error: cli.error }, 502);
        clienteId = cli.datos.id;
        guardarSuscripcion(tenant.id, { stripe_cliente_id: clienteId });
      }

      // Absoluta y con el host de ESTA petición: cada negocio vive en su subdominio, y una URL fija
      // devolvería al cliente al panel de otro.
      const base = new URL(c.req.url).origin;
      const ses = await stripe.crearSesionDeAlta({
        clienteId, tenantId: tenant.id,
        exitoUrl: `${base}/admin/suscripcion/vuelta?sesion={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${base}/admin/suscripcion/cancelado`,
      });
      if (!ses.ok) return c.json({ error: ses.error }, 502);
      return c.json({ url: ses.datos.url });
    } catch (e) {
      return c.json({ error: safeError(e, 'No se pudo abrir la pantalla de pago.') }, 500);
    }
  });

  // Estado en JSON, para DISA y para el gate. Las dos puertas (CANON §3-bis) con el mismo candado:
  // aquí también manda el rol de dueño.
  api.get('/situacion', c => {
    if (!c.get('isOwner')) return c.json({ error: 'Solo el dueño puede ver la suscripción.' }, 403);
    const tenant = c.get('tenant');
    asegurarSuscripcion(tenant.id);
    return c.json({ plan: plan(), situacion: situacion(tenant.id), stripe: stripe.diagnostico() });
  });

  return { api, views };
}
