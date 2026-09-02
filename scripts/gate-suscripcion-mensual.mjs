#!/usr/bin/env node
//
// gate-suscripcion-mensual.mjs — El cobro del día 5 y el aviso de la semana antes, con el TIEMPO
// AVANZADO DE VERDAD.
//
// POR QUÉ CON RELOJES DE PRUEBA (`test clocks`) Y NO CON FECHAS FALSAS NUESTRAS. Lo que hay que
// demostrar no es que nuestra aritmética sume siete días: es que **Stripe factura el día 5** y que
// **el aviso sale con el importe que Stripe va a cobrar**. Eso solo se ve haciendo pasar el tiempo
// dentro de Stripe. Un reloj nuestro que avanza no prueba nada del otro lado — es exactamente el
// muñeco que le daba la razón al error el 1 de septiembre.
//
// ESTÁ DECLARADO FUERA DEL BARRIDO: necesita claves de Stripe vivas. En un servidor sin ellas sería
// un rojo permanente, y un rojo permanente se acaba ignorando.
//
// NO MANDA NI UN CORREO. El envío se inyecta y se captura, así que se puede afirmar sobre el TEXTO
// del aviso —importe, IVA, cuatro dígitos, fecha— sin llenarle el buzón al dueño. Que el camino real
// del correo funciona se comprueba aparte, una vez, con `--correo-de-verdad`.
//
// LO QUE CREA, LO BORRA: el reloj, el cliente y la suscripción son de usar y tirar, y el negocio de
// pruebas se devuelve a su estado exacto en el `finally`.

import Database from 'better-sqlite3';
import * as stripe from '../core/stripe.js';
import { precioBaseCentimos, ivaPorcentaje, eur } from '../core/plan.js';
import { siguienteDiaDeCobro, fechaEnPalabras } from '../core/suscripcion.js';
import { enviarAvisoPrevio, facturasDelNegocio, proximoCargo, DIAS_DE_AVISO } from '../core/suscripcion-mensual.js';

const CORREO_DE_VERDAD = process.argv.includes('--correo-de-verdad');
const SLUG = 'peluqueria-gil';
let ok = 0, mal = 0;
const P = t => console.log(t);
const check = (n, c, d = '') => { if (c) { ok++; P(`  ✓ ${n}`); } else { mal++; P(`  ✗ ${n}${d ? '\n      ' + String(d).slice(0, 300) : ''}`); } };
const ts = iso => Math.floor(Date.parse(iso + 'T12:00:00Z') / 1000);
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);

const cd = new Database('/home/ubuntu/bamburu/data/control.db');
const tenant = cd.prepare('SELECT id, name, slug FROM tenants WHERE slug=?').get(SLUG);
const antes = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
let reloj = null;

/** Espera a que el reloj termine de avanzar: Stripe lo hace en diferido. */
async function esperarReloj(id) {
  for (let i = 0; i < 60; i++) {
    const r = await stripe.stripeApi('GET', `/test_helpers/test_clocks/${id}`);
    if (r.ok && r.datos.status === 'ready') return true;
    if (r.ok && r.datos.status === 'internal_failure') return false;
    await new Promise(s => setTimeout(s, 2000));
  }
  return false;
}
async function avanzar(id, aIso) {
  const r = await stripe.stripeApi('POST', `/test_helpers/test_clocks/${id}/advance`, { frozen_time: ts(aIso) });
  if (!r.ok) throw new Error('no se pudo avanzar el reloj: ' + r.error);
  if (!await esperarReloj(id)) throw new Error('el reloj no llegó a estar listo');
}

try {
  // ── El montaje: un negocio que acaba de pagar su prorrateo y entra en el ciclo del día 5 ───────
  const HOY = '2026-09-20';
  const ANCLA = siguienteDiaDeCobro(HOY);            // 2026-10-05
  const AVISO = new Date(Date.parse(ANCLA) - DIAS_DE_AVISO * 86400000).toISOString().slice(0, 10);
  P(`\n[montaje] hoy ${HOY} · ancla ${ANCLA} · el aviso toca el ${AVISO}`);

  const rc = await stripe.stripeApi('POST', '/test_helpers/test_clocks', { frozen_time: ts(HOY), name: 'gate mensual' });
  if (!rc.ok) throw new Error(rc.error);
  reloj = rc.datos.id;

  const cli = await stripe.stripeApi('POST', '/customers',
    { name: 'ZZ gate mensual', email: 'zz-gate@ejemplo.test', test_clock: reloj });
  const pm = await stripe.stripeApi('POST', '/payment_methods', { type: 'card', card: { token: 'tok_visa' } });
  await stripe.stripeApi('POST', `/payment_methods/${pm.datos.id}/attach`, { customer: cli.datos.id });
  await stripe.fijarMetodoPorDefecto(cli.datos.id, pm.datos.id);

  const plan = await stripe.asegurarPlanEnStripe({ centimos: precioBaseCentimos(), ivaPorcentaje: ivaPorcentaje() });
  const sub = await stripe.crearSuscripcion({
    clienteId: cli.datos.id, precioId: plan.datos.precioId, ivaId: plan.datos.ivaId,
    metodoId: pm.datos.id, anclaTimestamp: ts(ANCLA), tenantId: tenant.id });
  if (!sub.ok) throw new Error('no se pudo crear la suscripción: ' + sub.error);

  cd.prepare(`UPDATE tenant_suscripciones SET estado='al_corriente', stripe_cliente_id=?,
    stripe_metodo_pago_id=?, stripe_suscripcion_id=?, tarjeta_marca='visa', tarjeta_ultimos4=?,
    proximo_cobro=?, aviso_de_factura=NULL, aviso_enviado_en=NULL WHERE tenant_id=?`)
    .run(cli.datos.id, pm.datos.id, sub.datos.id, pm.datos.card?.last4 || '4242', ANCLA, tenant.id);

  // ── CRITERIO 1 · «El cargo se hace el día 5 de cada mes, con la tarjeta guardada» ──────────────
  P('\n[criterio 1] El ciclo queda anclado al día 5');
  check('la suscripción queda activa', sub.datos.status === 'active', sub.datos.status);
  check('su primer periodo termina EL DÍA 5', iso(sub.datos.current_period_end) === ANCLA, iso(sub.datos.current_period_end));
  const fac0 = await stripe.stripeApi('GET', `/invoices?customer=${cli.datos.id}&limit=10`);
  check('al abrirla NO cobra nada (el prorrateo ya se cobró aparte)',
    (fac0.datos.data || []).filter(f => f.amount_paid > 0).length === 0,
    JSON.stringify((fac0.datos.data || []).map(f => f.amount_paid)));
  check('se cobra con la tarjeta guardada', sub.datos.default_payment_method === pm.datos.id);

  // ── CRITERIO 2 · «Una semana antes llega un aviso con importe y los 4 últimos dígitos» ─────────
  P('\n[criterio 2] El aviso, una semana antes');
  // EL ORDEN IMPORTA, y aquí me lo comí a la primera: si se comprueba «no avisa antes de tiempo»
  // DESPUÉS de haber avisado, la respuesta es `ya_avisado` y la aserción mide otra cosa. Primero los
  // días en que NO debe avisar, y solo después el día en que sí.
  for (const [dia, cuando] of [['2026-09-21', 'a 14 días'], ['2026-09-27', 'a 8 días'], ['2026-09-29', 'a 6 días']]) {
    const x = await enviarAvisoPrevio(tenant, { hoy: dia, enviar: async () => { throw new Error('¡no debía mandar!'); } });
    check(`NO se avisa ${cuando} del cobro`, !x.enviado && x.motivo === 'todavia_no_toca',
      `${dia} → ${x.motivo} (faltan ${x.faltan})`);
  }
  let r = await enviarAvisoPrevio(tenant, { hoy: AVISO, simulacro: false, enviar: async () => ({ data: { id: 'capturado' }, error: null }) });
  check(`se avisa exactamente ${DIAS_DE_AVISO} días antes`, r.enviado === true, JSON.stringify(r.motivo));
  if (r.enviado) {
    const total = eur(sub.datos.items.data[0].price.unit_amount + Math.round(sub.datos.items.data[0].price.unit_amount * ivaPorcentaje() / 100));
    check('el aviso dice el importe TOTAL que se va a cobrar', r.cuerpo.includes(total), total + ' · ' + r.cargo.total);
    check('y lo desglosa en base + IVA', r.cuerpo.includes(eur(precioBaseCentimos())) && /IVA \(21 %\)/.test(r.cuerpo));
    check('el aviso dice los CUATRO últimos dígitos de la tarjeta', /terminada en 4242/.test(r.cuerpo), r.cuerpo.slice(0, 400));
    check('y la fecha exacta del cargo', r.cuerpo.includes(fechaEnPalabras(ANCLA)), fechaEnPalabras(ANCLA));
    check('el asunto ya dice cuándo y cuánto, sin abrir el correo', /te cobraremos/.test(r.asunto) && r.asunto.includes(r.cargo.total), r.asunto);
  }
  // Dos disparadores, UN aviso: el webhook y la pasada diaria entran por la misma puerta.
  const otra = await enviarAvisoPrevio(tenant, { hoy: AVISO, forzar: true, enviar: async () => { throw new Error('¡segundo aviso!'); } });
  check('no se avisa dos veces del mismo cobro (webhook + pasada diaria)',
    !otra.enviado && otra.motivo === 'ya_avisado', JSON.stringify(otra.motivo));

  // ── CRITERIO 1-bis y 3 · el día 5 se cobra, y deja factura descargable ─────────────────────────
  P(`\n[criterios 1 y 3] Se avanza el reloj al ${ANCLA} — se cobra y deja factura`);
  await avanzar(reloj, ANCLA);
  // Y un día más. NO es impaciencia mal resuelta: Stripe deja la factura en BORRADOR y la cierra
  // (la finaliza y la cobra) aproximadamente una hora después de crearla. Con el reloj parado en el
  // día 5 justo, la factura existe por 11,98 € y su estado es `draft` — medido. Esperar segundos de
  // reloj real no la mueve: lo que hay que mover es el reloj de Stripe.
  await avanzar(reloj, '2026-10-06');
  await new Promise(s => setTimeout(s, 4000));

  const facturas = await stripe.stripeApi('GET', `/invoices?customer=${cli.datos.id}&limit=10`);
  const pagadas = (facturas.datos.data || []).filter(f => f.status === 'paid');
  check('el día 5 se ha cobrado', pagadas.length === 1, JSON.stringify((facturas.datos.data || []).map(f => f.status + ':' + f.total)));
  if (pagadas.length) {
    const f = pagadas[0];
    check('por el importe del plan con su IVA (11,98 €)', f.total === 1198, String(f.total));
    check('con la base y el IVA DESGLOSADOS en la factura', f.subtotal === 990 && f.tax === 208, `base ${f.subtotal} · iva ${f.tax}`);
    check('la factura tiene número', !!f.number, String(f.number));
    check('y se puede DESCARGAR (PDF)', !!f.invoice_pdf, String(f.invoice_pdf).slice(0, 60));
    check('el periodo cobrado empieza el día 5', iso(f.lines.data[0].period.start) === ANCLA, iso(f.lines.data[0].period.start));
    check('y se cobró el día 5, no el 6', iso(f.status_transitions.paid_at) === ANCLA || iso(f.created) === ANCLA,
      `creada ${iso(f.created)} · pagada ${iso(f.status_transitions.paid_at)}`);
  }
  const listado = await facturasDelNegocio(tenant);
  check('la pantalla del dueño la lista, con su enlace de descarga',
    listado.length >= 1 && listado[0].pdf && listado[0].total === '11,98 €', JSON.stringify(listado[0] || null));

  // ── CRITERIO 4 · «Si el cobro sale bien, no se le molesta con nada más» ────────────────────────
  P('\n[criterio 4] Un cobro que sale bien no genera ni un correo');
  let correos = 0;
  const espia = async () => { correos += 1; return { data: { id: 'x' }, error: null }; };
  const tras = await enviarAvisoPrevio(tenant, { hoy: ANCLA, enviar: espia });
  check('el día del cobro NO sale ningún correo nuestro', correos === 0, `salieron ${correos} · motivo ${tras.motivo}`);
  const sig = await proximoCargo(tenant);
  check('y el próximo cobro pasa al mes siguiente', sig && sig.fecha === '2026-11-05', JSON.stringify(sig));
  const trasSiguiente = await enviarAvisoPrevio(tenant, { hoy: '2026-10-06', enviar: espia });
  check('tampoco al día siguiente', correos === 0 && !trasSiguiente.enviado, `${correos} · ${trasSiguiente.motivo}`);
  check('pero SÍ volverá a avisar del cobro siguiente, 7 días antes',
    (await enviarAvisoPrevio(tenant, { hoy: '2026-10-29', enviar: espia })).enviado === true && correos === 1,
    `correos=${correos}`);

  // ── El camino real del correo, una sola vez y solo si se pide ──────────────────────────────────
  if (CORREO_DE_VERDAD) {
    P('\n[camino real] Se manda UN aviso de verdad para probar que el correo sale');
    cd.prepare('UPDATE tenant_suscripciones SET aviso_de_factura=NULL WHERE tenant_id=?').run(tenant.id);
    const real = await enviarAvisoPrevio(tenant, { hoy: '2026-10-29', forzar: true });
    check('el correo sale de verdad y Resend no devuelve error', real.enviado === true,
      real.error || JSON.stringify(real.motivo));
    if (real.enviado) P(`      → enviado a ${real.destino} · id ${real.id}`);
  } else {
    P('\n[camino real] omitido · usa --correo-de-verdad para mandar UNO al dueño');
  }

  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  // El reloj se lleva por delante a su cliente y su suscripción: es lo que Stripe hace al borrarlo.
  if (reloj) await stripe.stripeApi('DELETE', `/test_helpers/test_clocks/${reloj}`).catch(() => {});
  cd.prepare(`UPDATE tenant_suscripciones SET estado=?, stripe_cliente_id=?, stripe_metodo_pago_id=?,
    stripe_suscripcion_id=?, tarjeta_marca=?, tarjeta_ultimos4=?, tarjeta_caduca=?, proximo_cobro=?,
    ultimo_cobro_centimos=?, ultimo_cobro_en=?, ultimo_error=?, aviso_de_factura=?, aviso_enviado_en=?
    WHERE tenant_id=?`)
    .run(antes.estado, antes.stripe_cliente_id, antes.stripe_metodo_pago_id, antes.stripe_suscripcion_id,
         antes.tarjeta_marca, antes.tarjeta_ultimos4, antes.tarjeta_caduca, antes.proximo_cobro,
         antes.ultimo_cobro_centimos, antes.ultimo_cobro_en, antes.ultimo_error,
         antes.aviso_de_factura, antes.aviso_enviado_en, tenant.id);
  P('  reloj borrado y negocio devuelto a su estado anterior');
}
process.exit(mal ? 1 : 0);
