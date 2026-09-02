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
import { facturasDelNegocio, proximoCargo, cambiarTarjeta } from '../../../core/suscripcion-mensual.js';
import { situacionDeLosDatos, DIAS_DE_DESCARGA } from '../../../core/suscripcion-datos.js';
import { situacionDeRescate, rescatar } from '../../../core/suscripcion-rescate.js';
import { exportarNegocio } from '../exportacion.js';
import { createReadStream, existsSync, statSync } from 'fs';

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
  views.get('/', async c => {
    const no = soloDueno(c); if (no) return no;
    const tenant = c.get('tenant');
    if (!tenant) return c.redirect('/admin');

    asegurarSuscripcion(tenant.id);
    const s = situacion(tenant.id);
    // Las facturas y el próximo cargo se piden a Stripe, que es quien los tiene. Fallan en blando a
    // propósito: si Stripe no contesta, la pantalla se pinta igual y el dueño ve su situación — una
    // pantalla caída porque el listado de facturas no cargó sería peor que una sin listado.
    const facturas = await facturasDelNegocio(tenant).catch(() => []);
    const cargo = await proximoCargo(tenant).catch(() => null);
    const datos = situacionDeLosDatos(tenant.id);
    const rescate = situacionDeRescate(tenant.id);
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
      cortado:           ['Solo lectura', 'sus-chip-mal'],
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
      .sus-facturas{width:100%;font-size:.85rem;border-collapse:collapse}
      .sus-facturas th{text-align:left;font-weight:500;color:var(--text3);font-size:.78rem;padding:.3rem 0;border-bottom:1px solid var(--border)}
      .sus-facturas td{padding:.5rem 0;border-bottom:1px solid var(--border);color:var(--text2);vertical-align:middle}
      .sus-facturas tr:last-child td{border-bottom:none}
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

        ${(cargo || s.situacion === 'pago_pendiente' || s.situacion === 'cortado') ? '' : `
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
        </table>`}

        <div style="margin-top:1.1rem;display:flex;gap:.6rem;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="susAlta"
                  data-total="${escHtml(cargo ? cargo.total : pr.total)}"
                  data-cuando="${escHtml(cargo
                      ? 'en tu próximo cobro, el ' + fechaEnPalabras(cargo.fecha)
                      : (s.situacion === 'prueba' ? 'al terminar tu prueba, el ' + fechaEnPalabras(s.prueba_fin) : 'ahora mismo'))}"
                  data-cambio="${cargo ? '1' : ''}">
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

      ${cargo ? `<div class="card"><div class="card-body">
        <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.35rem">Tu próximo cobro automático</h3>
        <p class="sus-detalle">
          El <strong>${escHtml(fechaEnPalabras(cargo.fecha))}</strong> se cargará
          <strong>${escHtml(cargo.total)}</strong>${s.tarjeta ? ` en tu ${escHtml(s.tarjeta.marca)} terminada en ${escHtml(s.tarjeta.ultimos4)}` : ''}.
          Te avisaremos por correo <strong>una semana antes</strong>: nunca cobramos por sorpresa.
        </p>
        <table class="sus-tabla">
          <tr><td>Base</td><td>${escHtml(cargo.base)}</td></tr>
          <tr><td>IVA (${escHtml(String(P.desglose_mes.iva_porcentaje))} %)</td><td>${escHtml(cargo.iva)}</td></tr>
          <tr class="sus-total"><td>Total</td><td>${escHtml(cargo.total)}</td></tr>
        </table>
      </div></div>` : ''}

      ${/* SOLO con impago abierto y SIN cortar. En una cuenta ya CORTADA esta caja mentía: decía
             «en cuanto el cobro salga bien, tu cuenta se reactiva sola», y en una cuenta cortada NO
             va a salir ningún cobro solo — el único camino de vuelta es el rescate, que está en la
             tarjeta de al lado. Alguien podía quedarse esperando un cargo que no iba a llegar.
             Es la quinta tarea seguida en que dos frases correctas por separado se contradicen
             juntas, y esta vez la contradicción costaba tiempo de espera al cliente. */
        s.situacion === 'pago_pendiente' ? `<div class="card"><div class="card-body">
        <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.35rem">Qué hay que pagar</h3>
        <p class="sus-detalle">
          Tu cuota mensual: <strong>${escHtml(P.desglose_mes.total)}</strong>
          (${escHtml(P.desglose_mes.base)} + ${escHtml(String(P.desglose_mes.iva_porcentaje))} % de IVA).
          En cuanto el cobro salga bien, no volveremos a escribirte.
        </p>
      </div></div>` : ''}

      ${rescate.aplica ? `<div class="card"><div class="card-body">
        <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.35rem">Recuperar mi negocio</h3>
        <p class="sus-detalle">
          Tu negocio está entero: ${rescate.en_boveda ? 'en la bóveda, ' : ''}tal y como lo dejaste el
          ${escHtml(fechaEnPalabras(rescate.cortado_en))}. <strong>No se ha borrado nada.</strong>
        </p>
        <div class="sus-nota" style="margin-top:.7rem">
          <strong>Qué compras, exactamente:</strong> recuperas tu negocio hoy, pagas
          <strong>el mes completo</strong> (${escHtml(rescate.precio.total)} =
          ${escHtml(rescate.precio.base)} + ${escHtml(String(rescate.precio.iva_porcentaje))} % de IVA:
          ${escHtml(rescate.precio.iva)}), y tu <strong>próximo cobro es el
          ${escHtml(rescate.proximo_cobro_en_palabras)}</strong>, el día 5 como siempre y con su aviso
          una semana antes.
          <br><br>No hay nada atrasado que pagar: en Bamburu se paga por adelantado, así que los meses
          que has estado fuera <strong>no se te cobran</strong>.
        </div>
        <table class="sus-tabla">
          <tr><td>Base</td><td>${escHtml(rescate.precio.base)}</td></tr>
          <tr><td>IVA (${escHtml(String(rescate.precio.iva_porcentaje))} %)</td><td>${escHtml(rescate.precio.iva)}</td></tr>
          <tr class="sus-total"><td>Total hoy</td><td>${escHtml(rescate.precio.total)}</td></tr>
        </table>
        <p class="sus-detalle" style="margin-top:.9rem"><strong>¿Qué prefieres?</strong></p>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.4rem">
          <button type="button" class="btn btn-primary" id="susRescateCuenta"
                  data-total="${escHtml(rescate.precio.total)}"
                  data-cuando="${escHtml(rescate.proximo_cobro_en_palabras)}">
            Recuperar mi cuenta en marcha
          </button>
          <button type="button" class="btn" id="susRescateDatos"
                  data-total="${escHtml(rescate.precio.total)}">
            Solo quiero mis datos
          </button>
        </div>
        <p class="sus-detalle" style="margin-top:.5rem;font-size:.8rem">
          Las dos cuestan lo mismo: lo que se paga es sacar tu negocio de la bóveda. Si eliges solo
          los datos, te los llevas completos y <strong>tu cuenta se queda en la bóveda</strong>, sin
          borrar nada.
        </p>
        ${rescate.tarjeta
          ? `<p class="sus-detalle" style="margin-top:.5rem">Se cobrará en tu ${escHtml(rescate.tarjeta.marca)} terminada en ${escHtml(rescate.tarjeta.ultimos4)}. Si ya no vale, cámbiala aquí arriba primero.</p>`
          : `<p class="sus-detalle" style="margin-top:.5rem;color:var(--danger)">No hay ninguna tarjeta guardada: pon una aquí arriba antes de rescatar.</p>`}
        <p id="susRescateAviso" class="sus-detalle" style="margin-top:.6rem"></p>
      </div></div>` : ''}

      ${datos.aplica ? `<div class="card"><div class="card-body">
        <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.35rem">${escHtml(datos.titulo)}</h3>
        <p class="sus-detalle">${datos.detalle.replace(/\*\*(.+?)\*\*/g, (m, t) => '<strong>' + escHtml(t) + '</strong>')
                                              .replace(/(?<!>)([^<>]+)(?![^<]*>)/g, (m) => m)}</p>
        ${datos.puede_descargar ? `
          <div id="susDescarga" data-estado="${escHtml(datos.descarga.estado || '')}" style="margin-top:1rem">
            ${datos.descarga.estado === 'lista' && datos.descarga.resumen ? `
              <p class="sus-detalle"><strong>Tu copia está lista.</strong>
                ${escHtml(String(datos.descarga.resumen.tablas))} ficheros de datos,
                ${escHtml(String(datos.descarga.resumen.filas))} filas y
                ${escHtml(String(datos.descarga.resumen.pdfs))}
                ${datos.descarga.resumen.pdfs === 1 ? 'factura de tu negocio' : 'facturas de tu negocio'} en PDF.</p>
              <a class="btn btn-primary" href="/admin/suscripcion/descargar">Descargar mis datos</a>
              <button type="button" class="btn" id="susRehacer">Volver a prepararla</button>`
            : datos.descarga.estado === 'preparando' ? `
              <p class="sus-detalle">Estamos preparando tu copia. Tarda unos minutos si tienes muchas
                facturas, porque cada una se genera en PDF. <strong>Puedes cerrar esta pantalla</strong>:
                seguimos aunque te vayas.</p>`
            : `
              ${datos.descarga.error ? `<p class="sus-detalle" style="color:var(--danger)">La última vez no salió bien: ${escHtml(datos.descarga.error)}</p>` : ''}
              <button type="button" class="btn btn-primary" id="susPreparar">Preparar mi descarga</button>`}
          </div>` : ''}
      </div></div>` : ''}

      <div class="card"><div class="card-body">
        <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.6rem">Tus facturas de Bamburu</h3>
        ${facturas.length ? `<table class="sus-facturas">
          <thead><tr><th>Factura</th><th>Fecha</th><th style="text-align:right">Total</th><th></th></tr></thead>
          <tbody>${facturas.map(f => `<tr>
            <td>${escHtml(f.numero)}</td>
            <td>${escHtml(fechaEnPalabras(f.fecha))}</td>
            <td style="text-align:right">${escHtml(f.total)} <span class="sus-cad">(${escHtml(f.base)} + IVA ${escHtml(f.iva)})</span></td>
            <td style="text-align:right">${f.pdf
              ? `<a class="btn btn-sm" href="${escHtml(f.pdf)}" target="_blank" rel="noopener">Descargar</a>`
              : (f.web ? `<a class="btn btn-sm" href="${escHtml(f.web)}" target="_blank" rel="noopener">Ver</a>` : '—')}</td>
          </tr>`).join('')}</tbody>
        </table>` : `<p class="sus-detalle">Todavía no hay ninguna factura <strong>de tu suscripción</strong>. La primera saldrá con tu primer cobro.
          (Las facturas que emites tú a tus clientes están en <a href="/admin/invoices">Facturas</a>, y van en tu descarga.)</p>`}
      </div></div>
    </div>

    <script>
      // La descarga se PREPARA en segundo plano: el negocio más grande de este servidor tiene 939
      // facturas y cada PDF pasa por Chromium. Una petición que tarda minutos se corta por el camino
      // y deja al cliente con medio fichero, o con nada y sin saber por qué.
      //
      // ⚙️ REMATE 2 SEP 2026 (Ibrahin, probándolo con sus ojos): LA PANTALLA YA NO SE RECARGA
      // MIENTRAS ESPERA. Antes hacía location.reload() cada 15 s para ver si la copia estaba lista, y
      // eso son once minutos de la página ENTERA parpadeando con el cliente delante — pierde el
      // sitio donde estaba mirando y parece que algo va mal. Ahora se pregunta solo por el estado y
      // se repinta ÚNICAMENTE esta tarjeta. El resto de la pantalla no se entera.
      (function () {
        var caja = document.getElementById('susDescarga');
        if (!caja) return;
        var esc = window.escHtmlCli || function (x) { return String(x == null ? '' : x); };
        var parado = false;

        function boton(id, clase, texto) {
          return '<button type="button" class="' + clase + '" id="' + id + '">' + texto + '</button>';
        }

        // Los mismos tres estados que pinta el servidor, para que lo que se ve al recargar a mano y
        // lo que se ve sin recargar sean lo MISMO. Si un día cambia uno, tiene que cambiar el otro.
        function pinta(d) {
          var e = (d && d.descarga && d.descarga.estado) || null;
          var r = (d && d.descarga && d.descarga.resumen) || null;
          caja.dataset.estado = e || '';
          if (e === 'lista' && r) {
            caja.innerHTML =
              '<p class="sus-detalle"><strong>Tu copia está lista.</strong> ' +
              esc(r.tablas) + ' ficheros de datos, ' + esc(r.filas) + ' filas y ' + esc(r.pdfs) + ' ' +
              (r.pdfs === 1 ? 'factura de tu negocio' : 'facturas de tu negocio') + ' en PDF.</p>' +
              '<a class="btn btn-primary" href="/admin/suscripcion/descargar">Descargar mis datos</a> ' +
              boton('susRehacer', 'btn', 'Volver a prepararla');
            enganchar();
            return true;
          }
          if (e === 'preparando') {
            caja.innerHTML =
              '<p class="sus-detalle">Estamos preparando tu copia. Tarda unos minutos si tienes muchas ' +
              'facturas, porque cada una se genera en PDF. <strong>Puedes cerrar esta pantalla</strong>: ' +
              'seguimos aunque te vayas.</p>';
            return false;
          }
          caja.innerHTML =
            ((d && d.descarga && d.descarga.error)
              ? '<p class="sus-detalle" style="color:var(--danger)">La última vez no salió bien: ' + esc(d.descarga.error) + '</p>'
              : '') +
            boton('susPreparar', 'btn btn-primary', 'Preparar mi descarga');
          enganchar();
          return true;
        }

        function enganchar() {
          ['susPreparar', 'susRehacer'].forEach(function (id) {
            var b = document.getElementById(id);
            if (!b) return;
            b.addEventListener('click', function () {
              b.disabled = true;
              b.textContent = 'Preparando…';
              fetch('/api/erp/suscripcion/descarga/preparar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' },
                body: '{}',
              }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
                .then(function (x) {
                  if (!x.ok) {
                    b.disabled = false; b.textContent = 'Preparar mi descarga';
                    caja.insertAdjacentHTML('beforeend',
                      '<p class="sus-detalle" style="color:var(--danger)">' + esc(x.d.error || 'No se pudo preparar.') + '</p>');
                    return;
                  }
                  pinta({ descarga: { estado: 'preparando' } });
                  parado = false;
                  vigilar();
                })
                .catch(function () { b.disabled = false; b.textContent = 'Preparar mi descarga'; });
            });
          });
        }

        // Se pregunta cada 4 s, con setTimeout encadenado y NO con setInterval: si una respuesta
        // tarda, las peticiones no se apilan unas sobre otras.
        // (Sin acentos graves en este comentario: va DENTRO de un template literal y uno solo lo
        //  cierra. Es la trampa que ya mato pantallas enteras en este repo, y hoy dos veces.)
        function vigilar() {
          if (parado) return;
          fetch('/api/erp/suscripcion/situacion', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (!j || !j.datos) { setTimeout(vigilar, 8000); return; }
              // Solo se repinta cuando el estado CAMBIA. Repintar cada cuatro segundos con lo mismo
              // haría parpadear la tarjeta, que es justo lo que este remate viene a quitar.
              var nuevo = (j.datos.descarga && j.datos.descarga.estado) || '';
              if (nuevo !== caja.dataset.estado) parado = pinta(j.datos);
              if (!parado) setTimeout(vigilar, 4000);
            })
            .catch(function () { setTimeout(vigilar, 8000); });
        }

        enganchar();
        if (caja.dataset.estado === 'preparando') vigilar();
      })();

      // EL RESCATE. Dos botones, dos resultados, el mismo precio. Se confirma DENTRO de la página con
      // el importe y la fecha delante: nunca se cobra por sorpresa, tampoco aquí.
      [['susRescateCuenta', 'cuenta'], ['susRescateDatos', 'datos']].forEach(function (par) {
        var b = document.getElementById(par[0]);
        if (!b) return;
        b.addEventListener('click', async function () {
          var aviso = document.getElementById('susRescateAviso');
          var total = b.dataset.total || '';
          var cuando = b.dataset.cuando || '';
          var esCuenta = par[1] === 'cuenta';
          var sigue = await window.confirmarEnPagina({
            titulo: esCuenta ? 'Vas a recuperar tu cuenta' : 'Vas a llevarte solo tus datos',
            texto: esCuenta
              ? 'Se te cobrarán ' + total + ' ahora, el mes completo. Tu negocio vuelve a estar en '
                + 'marcha con todo como lo dejaste, y tu proximo cobro sera el ' + cuando + ', el dia '
                + '5 como siempre. No se te cobra nada de los meses que has estado fuera.'
              : 'Se te cobraran ' + total + ' ahora. Te llevas TODOS tus datos, y tu cuenta se queda '
                + 'en la boveda: no se borra nada, y podras recuperarla mas adelante si quieres.',
            aceptar: esCuenta ? 'Sí, recuperar mi cuenta' : 'Sí, quiero mis datos',
            cancelar: 'Ahora no',
          });
          if (!sigue) { aviso.textContent = 'No se ha hecho nada.'; return; }

          b.disabled = true;
          aviso.textContent = 'Cobrando y preparando tu cuenta…';
          try {
            var r = await fetch('/api/erp/suscripcion/rescatar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' },
              body: JSON.stringify({ eleccion: par[1] }),
            });
            var d = await r.json();
            if (!r.ok) {
              b.disabled = false;
              aviso.textContent = d.error || 'No se pudo completar el rescate.';
              aviso.style.color = 'var(--danger)';
              return;
            }
            // Aquí SÍ se recarga, y a propósito: al recuperar la cuenta cambia la pantalla ENTERA
            // —se va la franja roja, se va el solo-lectura, vuelve el menú completo—. Repintar una
            // tarjeta no bastaría, y el cliente tiene que ver su negocio otra vez en marcha.
            window.location.href = '/admin/suscripcion?msg=' + encodeURIComponent(d.mensaje || 'Listo.');
          } catch (e) {
            b.disabled = false;
            aviso.textContent = 'No se pudo contactar con el servidor. Inténtalo de nuevo.';
          }
        });
      });

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
          // OJO: el campo se llama texto, NO mensaje. window.confirmarEnPagina (layout.js) reenvia
          // o.texto a pedirDatos, y un nombre que no conoce lo descarta EN SILENCIO: el panel salia
          // con su titulo y sus dos botones, y el cuerpo en blanco. Ninguna asercion lo vio —el
          // panel abria, los botones funcionaban y el alta se completaba—; lo vio Ibrahin mirandolo.
          // De las 67 llamadas del producto, 66 usaban texto y esta era la unica que no: el panel
          // compartido estaba bien.
          // (Sin acentos graves en este comentario a proposito: va DENTRO de un template literal y
          //  uno solo lo cierra. Es la trampa que ya mato pantallas enteras en este repo.)
          // Cambiar de tarjeta NO cobra nada, y decir «se te cobrará X ahora» al cambiarla sería
          // asustar al dueño con un cargo que no existe. Dos textos, uno por cada caso.
          texto: boton.dataset.cambio
            ? 'Te llevamos a la página segura de Stripe para guardar la tarjeta nueva. El número no '
              + 'pasa por Bamburu en ningún momento. No se te cobra nada por cambiarla: la nueva se '
              + 'usará ' + cuando + ', por ' + total + '. La anterior se retira.'
            : 'Te llevamos a la página segura de Stripe para guardar tu tarjeta. El número no '
              + 'pasa por Bamburu en ningún momento. Se te cobrará ' + total + ' ' + cuando
              + '. Puedes cambiarla o quitarla cuando quieras.',
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

      // ── CAMBIO DE TARJETA (criterio 5) ────────────────────────────────────
      // Va ANTES de guardar la nueva en nuestra base, y el orden no es casual: `cambiarTarjeta` lee
      // de ahí cuál era la anterior para retirarla de Stripe. Guardando primero, la vieja quedaría
      // olvidada en la cuenta del cliente y él vería dos tarjetas suyas sin saber cuál se le cobra.
      // Si no hay suscripción abierta todavía, esto no hace nada y el alta sigue su camino normal.
      const anterior = suscripcionDe(tenant.id)?.stripe_metodo_pago_id || null;
      let cambiada = false;
      if (anterior && anterior !== metodoId) {
        const cam = await cambiarTarjeta(tenant, metodoId);
        if (!cam.ok) return volver('err=' + encodeURIComponent(`No se pudo cambiar la tarjeta: ${cam.error}`));
        cambiada = true;
      }

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

      // Cambiar de tarjeta NO cobra nada: solo pasa a ser la que se usará en el próximo día 5.
      if (cambiada) {
        const prox = await proximoCargo(tenant).catch(() => null);
        return volver('msg=' + encodeURIComponent(
          `Tarjeta cambiada. A partir de ahora se cobra en la nueva${prox ? `, la próxima vez el ${fechaEnPalabras(prox.fecha)} por ${prox.total}` : ''}. No se te ha cobrado nada ahora.`));
      }

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

  // ── LA DESCARGA (tarea `suscripcion-datos-tras-el-corte`) ───────────────────────────────────
  //
  // Cuelga de `/admin/suscripcion`, y no es casualidad: `readOnlyGuard` deja pasar ese prefijo
  // entero, así que **la descarga funciona desde una cuenta cortada** igual que el botón de pagar.
  // Es la misma lección del 2 de septiembre, y aquí importa más todavía: negarle a alguien la copia
  // de sus datos porque no ha pagado sería justo lo contrario de lo que promete esta tarea.
  views.get('/descargar', c => {
    const no = soloDueno(c); if (no) return no;
    const tenant = c.get('tenant');
    const d = situacionDeLosDatos(tenant.id);

    if (!d.aplica || !d.puede_descargar) {
      return c.redirect('/admin/suscripcion?err=' + encodeURIComponent(
        d.fase === 'boveda'
          ? 'La ventana de descarga se cerró. Tus datos NO se han borrado: están enteros en la bóveda.'
          : 'No hay ninguna descarga disponible ahora mismo.'));
    }
    if (d.descarga.estado !== 'lista' || !d.descarga.fichero || !existsSync(d.descarga.fichero)) {
      return c.redirect('/admin/suscripcion?err=' + encodeURIComponent('Tu copia todavía no está lista. Prepárala primero.'));
    }

    const nombre = `bamburu-${tenant.slug}-${new Date().toISOString().slice(0, 10)}.zip`;
    return new Response(createReadStream(d.descarga.fichero), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(statSync(d.descarga.fichero).size),
        'Content-Disposition': `attachment; filename="${nombre}"`,
      },
    });
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
        // El correo del DUEÑO, leído de la base del negocio. `c.get('session')` NO lo trae
        // (`core/auth.js:112` devuelve token, userId, userName, role, expiresAt y csrfToken — email
        // no), así que `session.email` era siempre `undefined` y el cliente de Stripe nacía sin
        // correo. Consecuencia medida probando el alta con navegador: **el Checkout le pedía el
        // correo al dueño**, un campo más que teclear para algo que Bamburu ya sabe. Y sin correo en
        // el cliente, los recibos de Stripe no tienen a dónde ir.
        // Falla en blando a propósito: sin correo el alta sigue funcionando, solo que Stripe lo pide.
        let correo = null;
        try { correo = db.prepare('SELECT email FROM admin_users WHERE id = ?').get(c.get('session')?.userId)?.email || null; }
        catch { correo = null; }

        const cli = await stripe.crearCliente({
          nombre: tenant.name, email: correo,
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

  /**
   * Prepara la copia EN SEGUNDO PLANO. Contesta en el acto y sigue trabajando.
   * Medido: 939 facturas en el negocio más grande, y cada PDF pasa por Chromium — minutos.
   */
  api.post('/descarga/preparar', async c => {
    if (!c.get('isOwner')) return c.json({ error: 'Solo el dueño puede descargar los datos.' }, 403);
    const tenant = c.get('tenant');
    const d = situacionDeLosDatos(tenant.id);
    if (!d.aplica || !d.puede_descargar) {
      return c.json({ error: d.fase === 'boveda'
        ? 'La ventana de descarga se cerró. Tus datos NO se han borrado: están en la bóveda.'
        : 'La descarga se abre cuando la cuenta pasa a solo lectura.' }, 400);
    }
    if (d.descarga.estado === 'preparando') return c.json({ ok: true, ya: true });

    guardarSuscripcion(tenant.id, { descarga_estado: 'preparando', descarga_error: null });

    // Se lanza SIN esperarla, a propósito: la respuesta sale ya y el trabajo sigue. El `catch` de
    // arriba del todo es obligatorio — una promesa de fondo que revienta sin recoger tumbaría el
    // proceso entero de Node y con él el producto de todos los negocios.
    (async () => {
      const r = await exportarNegocio(tenant, db, {
        alProgresar: (t) => console.log(`[exportacion:${tenant.slug}] ${t}`),
      });
      if (r.ok) {
        guardarSuscripcion(tenant.id, {
          descarga_estado: 'lista', descarga_fichero: r.ruta, descarga_lista_en: new Date().toISOString(),
          descarga_resumen: JSON.stringify(r.resumen), descarga_error: null,
        });
        console.log(`[exportacion:${tenant.slug}] lista: ${r.bytes} bytes · ${JSON.stringify(r.resumen)}`);
      } else {
        guardarSuscripcion(tenant.id, { descarga_estado: 'error', descarga_error: r.error });
        console.error(`[exportacion:${tenant.slug}] FALLÓ: ${r.error}`);
      }
    })().catch(e => {
      guardarSuscripcion(tenant.id, { descarga_estado: 'error', descarga_error: e.message || String(e) });
      console.error(`[exportacion:${tenant.slug}] excepción: ${e.stack || e.message}`);
    });

    return c.json({ ok: true });
  });

  /**
   * EL RESCATE. Cobra el mes y aplica lo que el cliente eligió.
   * Cuelga de `/api/erp/suscripcion`, que `readOnlyGuard` deja pasar: desde una cuenta cortada
   * SIEMPRE se puede pagar, y el rescate es exactamente eso.
   */
  api.post('/rescatar', async c => {
    if (!c.get('isOwner')) return c.json({ error: 'Solo el dueño puede rescatar la cuenta.' }, 403);
    const tenant = c.get('tenant');
    let eleccion = null;
    try { eleccion = (await c.req.json())?.eleccion || null; } catch { eleccion = null; }

    try {
      const r = await rescatar(tenant, eleccion);
      if (!r.ok) return c.json({ error: r.error, motivo: r.motivo || null }, r.motivo === 'sin_tarjeta' ? 400 : 502);
      return c.json({ ok: true, mensaje: r.mensaje, eleccion: r.eleccion, importe: r.importe, factura: r.factura });
    } catch (e) {
      return c.json({ error: safeError(e, 'No se pudo completar el rescate.') }, 500);
    }
  });

  // Estado en JSON, para DISA y para el gate. Las dos puertas (CANON §3-bis) con el mismo candado:
  // aquí también manda el rol de dueño.
  api.get('/situacion', c => {
    if (!c.get('isOwner')) return c.json({ error: 'Solo el dueño puede ver la suscripción.' }, 403);
    const tenant = c.get('tenant');
    asegurarSuscripcion(tenant.id);
    return c.json({ plan: plan(), situacion: situacion(tenant.id), datos: situacionDeLosDatos(tenant.id),
                    rescate: situacionDeRescate(tenant.id), stripe: stripe.diagnostico() });
  });

  return { api, views };
}
