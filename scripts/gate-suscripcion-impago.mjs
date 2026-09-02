#!/usr/bin/env node
//
// gate-suscripcion-impago.mjs — El impago entero: fallo, avisos, corte a los 30 días y vuelta.
//
// DOS PARTES, y las dos hacen falta:
//   A) **La cadena, con el calendario en la mano.** Los cinco escalones caen en su día exacto, cada
//      uno con SU texto, el corte llega el 30 y la vuelta deshace todo. Aquí se comprueban también
//      los caminos de vuelta —pagar tras el primer aviso, pagar la víspera del corte— que son los
//      que de verdad importan y los que nadie prueba.
//   B) **El ciclo real, con el reloj de Stripe.** Una tarjeta que falla de verdad, el tiempo
//      avanzado, la factura que no se cobra, y el pago que reactiva. Sin esto, lo de arriba solo
//      demuestra que nuestra aritmética suma.
//
// NO MANDA NI UN CORREO: el envío se inyecta y se captura, para poder afirmar sobre el TEXTO de los
// cinco avisos sin llenarle el buzón al dueño.
//
// LO QUE CREA, LO BORRA: el reloj se lleva su cliente y su suscripción, y el negocio de pruebas
// —incluido su `tenants.status`— se devuelve a su estado exacto en el `finally`. Que un gate deje un
// negocio CORTADO sería el peor residuo posible de esta tarea.

import Database from 'better-sqlite3';
import * as stripe from '../core/stripe.js';
import { precioBaseCentimos, ivaPorcentaje } from '../core/plan.js';
import { siguienteDiaDeCobro, sumarDias, fechaEnPalabras } from '../core/suscripcion.js';
import { registrarFalloDeCobro, volverALaNormalidad, procesarImpago, escalonQueToca,
         conImpagoAbierto, ESCALONES, DIAS_HASTA_EL_CORTE } from '../core/suscripcion-impago.js';
import { getTenantById, setTenantStatus } from '../core/control-db.js';

const SLUG = 'peluqueria-gil';
let ok = 0, mal = 0;
const P = t => console.log(t);
const check = (n, c, d = '') => { if (c) { ok++; P(`  ✓ ${n}`); } else { mal++; P(`  ✗ ${n}${d ? '\n      ' + String(d).slice(0, 300) : ''}`); } };
const ts = i => Math.floor(Date.parse(i + 'T12:00:00Z') / 1000);
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);

const cd = new Database('/home/ubuntu/bamburu/data/control.db');
const tenant = cd.prepare('SELECT id, name, slug FROM tenants WHERE slug=?').get(SLUG);
const antes = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
const estadoAntes = getTenantById(tenant.id).status;
let reloj = null;

const correos = [];
const espia = async (m) => { correos.push(m); return { data: { id: 'x' }, error: null }; };
const limpiarEpisodio = () => cd.prepare(`UPDATE tenant_suscripciones SET estado='al_corriente',
  impago_desde=NULL, corte_previsto=NULL, avisos_impago=NULL, cortado_en=NULL, cortado_por_impago=0,
  tarjeta_marca='visa', tarjeta_ultimos4='4242', ultimo_cobro_centimos=1198 WHERE tenant_id=?`).run(tenant.id);

async function esperarReloj(id) {
  for (let i = 0; i < 60; i++) {
    const r = await stripe.stripeApi('GET', `/test_helpers/test_clocks/${id}`);
    if (r.ok && r.datos.status === 'ready') return true;
    if (r.ok && r.datos.status === 'internal_failure') return false;
    await new Promise(s => setTimeout(s, 2000));
  }
  return false;
}
async function avanzar(id, a) {
  const r = await stripe.stripeApi('POST', `/test_helpers/test_clocks/${id}/advance`, { frozen_time: ts(a) });
  if (!r.ok) throw new Error('no se pudo avanzar: ' + r.error);
  if (!await esperarReloj(id)) throw new Error('el reloj no llegó a estar listo');
}

try {
  // ══ PARTE A · LA CADENA ═════════════════════════════════════════════════════════════════════════
  const FALLO = '2026-09-05';
  const CORTE = sumarDias(FALLO, DIAS_HASTA_EL_CORTE);

  P('\n[criterio 1] Ante un pago fallido empiezan los avisos, y el corte es a los 30 días');
  limpiarEpisodio();
  registrarFalloDeCobro(tenant.id, 'La tarjeta fue rechazada.', { hoy: FALLO });
  let s = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
  check('el episodio se abre el día del fallo', s.impago_desde === FALLO, s.impago_desde);
  check(`el corte queda fijado a ${DIAS_HASTA_EL_CORTE} días`, s.corte_previsto === CORTE, `${s.corte_previsto} vs ${CORTE}`);
  check('y el negocio queda en «pago pendiente»', s.estado === 'pago_pendiente', s.estado);

  // Stripe reintenta y cada reintento fallido vuelve a llamar: el reloj NO puede moverse, o el corte
  // se alejaría solo y no llegaría nunca.
  registrarFalloDeCobro(tenant.id, 'Rechazada otra vez.', { hoy: '2026-09-09' });
  registrarFalloDeCobro(tenant.id, 'Y otra.', { hoy: '2026-09-14' });
  s = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
  check('un reintento fallido NO reinicia el reloj del corte', s.impago_desde === FALLO && s.corte_previsto === CORTE,
    `${s.impago_desde} · ${s.corte_previsto}`);

  P('\n[criterio 2] Cinco avisos DISTINTOS, cada vez más insistentes');
  const textos = [];
  for (const [dia, esperado] of [[0, 'aviso-0'], [7, 'aviso-7'], [20, 'aviso-20'], [27, 'aviso-27']]) {
    correos.length = 0;
    const r = await procesarImpago({ ...cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id), id: tenant.id, name: tenant.name, slug: SLUG },
      { hoy: sumarDias(FALLO, dia), enviar: espia });
    check(`el día ${dia} sale «${esperado}»`, r.escalon === esperado && r.enviado, `${r.escalon} · ${r.motivo || ''}`);
    if (correos[0]) textos.push(correos[0]);
  }
  check('los cuatro avisos son textos DISTINTOS, no el mismo repetido',
    new Set(textos.map(t => t.text)).size === 4 && new Set(textos.map(t => t.subject)).size === 4,
    textos.map(t => t.subject).join(' | '));
  check('el primero NO alarma: dice que se reintentará solo', /lo intentaremos otra vez/i.test(textos[0]?.text || ''));
  check('el segundo ya dice la fecha del corte', (textos[1]?.text || '').includes(fechaEnPalabras(CORTE)));
  check('el tercero avisa de que quedan 10 días', /quedan 10 días/i.test(textos[2]?.subject || ''), textos[2]?.subject);
  check('el cuarto es la última llamada, a 3 días', /quedan 3 días/i.test(textos[3]?.subject || ''), textos[3]?.subject);
  check('TODOS llevan enlace directo a la pantalla de pago',
    textos.every(t => t.text.includes('/admin/suscripcion')), textos.map(t => t.text.includes('/admin/suscripcion')).join(','));
  check('y ninguno ofrece descuento ni negocia el precio',
    !textos.some(t => /descuento|oferta|rebaja|promoci[óo]n|te lo dejamos/i.test(t.text)));

  P('\n[criterios 3, 4 y 5] El corte: cierra la puerta, no borra nada, y dice cómo volver');
  correos.length = 0;
  const rc = await procesarImpago({ ...cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id), id: tenant.id, name: tenant.name, slug: SLUG },
    { hoy: CORTE, enviar: espia });
  check('el día 30 se corta', rc.hizo === 'cortado', JSON.stringify(rc));
  check('el negocio pasa a SOLO LECTURA', getTenantById(tenant.id).status === 'suspended_admin', getTenantById(tenant.id).status);
  check('y queda marcado como cortado POR IMPAGO (no por otra cosa)',
    cd.prepare('SELECT cortado_por_impago FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id).cortado_por_impago === 1);
  const corteMsg = correos[0]?.text || '';
  check('el aviso del corte dice que NO se ha borrado nada', /no se ha borrado nada/i.test(corteMsg), corteMsg.slice(0, 200));
  // El correo del corte tiene que llevar los 90 días DENTRO (tarea `suscripcion-datos-tras-el-corte`):
  // es el correo que el dueño va a leer, y crear uno nuevo para eso sería otro correo más.
  check('y dice los 90 días para llevarse todo, con su fecha', /90 DÍAS PARA LLEVARTE TODO/i.test(corteMsg)
    && /hasta el \d+ de \w+ de \d{4}/.test(corteMsg), corteMsg.slice(0, 700));
  check('y que pasado ese plazo los datos NO se borran, pasan a la bóveda',
    /bóveda/i.test(corteMsg) && /NO se borran/i.test(corteMsg), corteMsg.slice(0, 900));
  check('y dice EXACTAMENTE qué hacer para volver, paso a paso',
    /1\..*Entra/s.test(corteMsg) && /Mi suscripción/.test(corteMsg) && /se reactiva sola/i.test(corteMsg), corteMsg.slice(-400));
  check('el motivo que ve el dueño en pantalla también lo dice',
    /Mi suscripción/.test(getTenantById(tenant.id).suspend_note || ''), getTenantById(tenant.id).suspend_note);
  // Nada de borrado: el corte solo toca `tenants.status`.
  const impagoMod = (await import('fs')).readFileSync('/home/ubuntu/bamburu/core/suscripcion-impago.js', 'utf8');
  check('el corte no borra NI UN DATO (ni DELETE ni DROP en todo el módulo)',
    !/DELETE FROM|DROP /i.test(impagoMod));

  P('\n[vuelta] Si paga, todo vuelve solo');
  const v = volverALaNormalidad(tenant.id);
  check('se reactiva la cuenta', v.reactivado === true, JSON.stringify(v));
  check('el negocio vuelve a estar activo', getTenantById(tenant.id).status === 'active');
  s = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
  check('cesa el impago y se limpian los avisos', !s.impago_desde && !s.avisos_impago && s.estado === 'al_corriente',
    JSON.stringify({ i: s.impago_desde, a: s.avisos_impago, e: s.estado }));
  check('y ya no queda ningún impago abierto', conImpagoAbierto().every(f => f.tenant_id !== tenant.id));

  P('\n[caminos de vuelta] Los que nadie prueba');
  // 1 · paga tras el primer aviso → no llega ninguno más
  limpiarEpisodio();
  registrarFalloDeCobro(tenant.id, 'x', { hoy: FALLO });
  await procesarImpago({ ...cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id), id: tenant.id, name: tenant.name, slug: SLUG }, { hoy: FALLO, enviar: espia });
  volverALaNormalidad(tenant.id);
  correos.length = 0;
  for (const d of [7, 20, 27, 30]) {
    const fila = { ...cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id), id: tenant.id, name: tenant.name, slug: SLUG };
    if (fila.impago_desde) await procesarImpago(fila, { hoy: sumarDias(FALLO, d), enviar: espia });
  }
  check('si paga tras el primer aviso, NO llega ninguno más', correos.length === 0, `llegaron ${correos.length}`);
  check('y no se corta', getTenantById(tenant.id).status === 'active');

  // 2 · paga la víspera del corte → no se corta
  limpiarEpisodio();
  registrarFalloDeCobro(tenant.id, 'x', { hoy: FALLO });
  volverALaNormalidad(tenant.id);
  correos.length = 0;
  const filaVispera = { ...cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id), id: tenant.id, name: tenant.name, slug: SLUG };
  if (filaVispera.impago_desde) await procesarImpago(filaVispera, { hoy: CORTE, enviar: espia });
  check('si paga la víspera, NO se corta al día siguiente', getTenantById(tenant.id).status === 'active', getTenantById(tenant.id).status);

  // 3 · el reintento cobra solo → ningún aviso de más
  limpiarEpisodio();
  registrarFalloDeCobro(tenant.id, 'x', { hoy: FALLO });
  volverALaNormalidad(tenant.id);
  check('un reintento que cobra solo deja el episodio cerrado',
    !cd.prepare('SELECT impago_desde FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id).impago_desde);
  check('y `escalonQueToca` ya no propone nada',
    escalonQueToca(cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id), { hoy: sumarDias(FALLO, 30) }) === null);

  // 4 · una suspensión que NO puso el impago no se levanta al pagar
  limpiarEpisodio();
  setTenantStatus(tenant.id, 'suspended_admin', 'Suspendido por el superadmin (prueba)');
  const v2 = volverALaNormalidad(tenant.id);
  check('pagar NO levanta una suspensión que puso otro',
    !v2.reactivado && getTenantById(tenant.id).status === 'suspended_admin', JSON.stringify(v2));
  setTenantStatus(tenant.id, 'active');

  // 5 · si una pasada se salta un día, el aviso no se pierde — pero no salen tres de golpe
  limpiarEpisodio();
  registrarFalloDeCobro(tenant.id, 'x', { hoy: FALLO });
  correos.length = 0;
  const filaTarde = { ...cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id), id: tenant.id, name: tenant.name, slug: SLUG };
  const rt = await procesarImpago(filaTarde, { hoy: sumarDias(FALLO, 9), enviar: espia });
  check('si el servidor estuvo apagado, sale el aviso vencido más reciente y SOLO uno',
    rt.escalon === 'aviso-7' && correos.length === 1, `${rt.escalon} · ${correos.length} correos`);

  // ══ PARTE B · EL CICLO REAL, CON EL RELOJ DE STRIPE ═════════════════════════════════════════════
  P('\n[ciclo real] Tarjeta que falla de verdad, tiempo avanzado, y pago que reactiva');
  limpiarEpisodio();
  const HOY = '2026-09-20';
  const ANCLA = siguienteDiaDeCobro(HOY);
  const rc2 = await stripe.stripeApi('POST', '/test_helpers/test_clocks', { frozen_time: ts(HOY), name: 'gate impago' });
  reloj = rc2.datos.id;
  const cli = await stripe.stripeApi('POST', '/customers', { name: 'ZZ gate impago', email: 'zz@ejemplo.test', test_clock: reloj });
  // Tarjeta de prueba que SE GUARDA bien y FALLA al cobrar: es exactamente el caso del impago.
  const mala = await stripe.stripeApi('POST', '/payment_methods', { type: 'card', card: { token: 'tok_chargeCustomerFail' } });
  await stripe.stripeApi('POST', `/payment_methods/${mala.datos.id}/attach`, { customer: cli.datos.id });
  await stripe.fijarMetodoPorDefecto(cli.datos.id, mala.datos.id);
  const plan = await stripe.asegurarPlanEnStripe({ centimos: precioBaseCentimos(), ivaPorcentaje: ivaPorcentaje() });
  const sub = await stripe.crearSuscripcion({ clienteId: cli.datos.id, precioId: plan.datos.precioId,
    ivaId: plan.datos.ivaId, metodoId: mala.datos.id, anclaTimestamp: ts(ANCLA), tenantId: tenant.id });
  check('la suscripción arranca con una tarjeta que va a fallar', sub.ok, sub.error);

  await avanzar(reloj, ANCLA);
  await avanzar(reloj, sumarDias(ANCLA, 1));
  await new Promise(s => setTimeout(s, 5000));
  const inv = await stripe.stripeApi('GET', `/invoices?customer=${cli.datos.id}&limit=5`);
  const impagada = (inv.datos.data || []).find(f => f.status === 'open' || f.attempt_count > 0);
  check('el día 5 el cobro FALLA de verdad', !!impagada && impagada.status !== 'paid',
    JSON.stringify((inv.datos.data || []).map(f => f.status + ':' + f.attempt_count)));

  // Ahora se paga con una tarjeta buena, como haría el dueño desde la pantalla.
  const buena = await stripe.stripeApi('POST', '/payment_methods', { type: 'card', card: { token: 'tok_visa' } });
  await stripe.stripeApi('POST', `/payment_methods/${buena.datos.id}/attach`, { customer: cli.datos.id });
  const pagada = await stripe.stripeApi('POST', `/invoices/${impagada.id}/pay`, { payment_method: buena.datos.id });
  check('al poner una tarjeta que funciona, la factura se paga', pagada.ok && pagada.datos.status === 'paid',
    pagada.ok ? pagada.datos.status : pagada.error);
  check('y con su base y su IVA desglosados', pagada.ok && pagada.datos.subtotal === 990 && pagada.datos.tax === 208,
    pagada.ok ? `${pagada.datos.subtotal}/${pagada.datos.tax}` : '');

  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  if (reloj) await stripe.stripeApi('DELETE', `/test_helpers/test_clocks/${reloj}`).catch(() => {});
  // Que un gate deje un negocio CORTADO sería el peor residuo posible de esta tarea.
  setTenantStatus(tenant.id, estadoAntes === 'active' ? 'active' : estadoAntes);
  cd.prepare(`UPDATE tenant_suscripciones SET estado=?, stripe_cliente_id=?, stripe_metodo_pago_id=?,
    stripe_suscripcion_id=?, tarjeta_marca=?, tarjeta_ultimos4=?, tarjeta_caduca=?, proximo_cobro=?,
    ultimo_cobro_centimos=?, ultimo_cobro_en=?, ultimo_error=?, aviso_de_factura=?, aviso_enviado_en=?,
    impago_desde=?, corte_previsto=?, avisos_impago=?, cortado_en=?, cortado_por_impago=?,
    descarga_hasta=?, en_boveda_desde=? WHERE tenant_id=?`)
    .run(antes.estado, antes.stripe_cliente_id, antes.stripe_metodo_pago_id, antes.stripe_suscripcion_id,
         antes.tarjeta_marca, antes.tarjeta_ultimos4, antes.tarjeta_caduca, antes.proximo_cobro,
         antes.ultimo_cobro_centimos, antes.ultimo_cobro_en, antes.ultimo_error, antes.aviso_de_factura,
         antes.aviso_enviado_en, antes.impago_desde ?? null, antes.corte_previsto ?? null,
         antes.avisos_impago ?? null, antes.cortado_en ?? null, antes.cortado_por_impago ?? 0,
         // ⚠️ Estas dos se añadieron DESPUÉS de escribir este gate, y por eso se quedaban puestas en
         // un negocio real: la restauración solo devuelve las columnas que conoce. Cuando se añade
         // una columna al episodio, hay que añadirla también aquí.
         antes.descarga_hasta ?? null, antes.en_boveda_desde ?? null, tenant.id);
  P(`  reloj borrado · negocio devuelto a «${estadoAntes}» y sin impago`);
}
process.exit(mal ? 1 : 0);
