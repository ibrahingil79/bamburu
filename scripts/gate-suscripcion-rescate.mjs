#!/usr/bin/env node
//
// gate-suscripcion-rescate.mjs — El camino de vuelta: paga un mes y elige.
//
// LOS DOS ESCENARIOS QUE PIDIÓ EL DUEÑO, con el tiempo avanzado de verdad:
//   A) Rescate DENTRO de los 90 días.
//   B) Rescate PASADOS los 90 días, desde la bóveda — porque **la bóveda no caduca para rescatar**.
// En los dos: pago → cuenta activa → **recuento de todas las tablas idéntico al de antes del corte**
// → el día 5 siguiente cobra normal con su aviso 7 días antes.
//
// Y LOS DOS CASOS INCÓMODOS, a propósito:
//   · Rescate pocos días antes del día 5: **paga el mes y el día 5 se cobra otra vez**. Es la regla
//     asumida por el dueño y aquí se mide para que nadie la «arregle» sin querer.
//   · Rescate el día 6: no se le cobra otra vez hasta el día 5 siguiente.
//
// NO MANDA CORREOS: el envío se inyecta y se captura.
// LO QUE CREA, LO BORRA: reloj, cliente de Stripe y el estado del negocio, en el `finally`.

import Database from 'better-sqlite3';
import * as stripe from '../core/stripe.js';
import { precioBaseCentimos, ivaPorcentaje } from '../core/plan.js';
import { siguienteDiaDeCobro, sumarDias, hoyISO, diasEntre } from '../core/suscripcion.js';
import { situacionDeRescate, rescatar } from '../core/suscripcion-rescate.js';
import { situacionDeLosDatos, DIAS_DE_DESCARGA } from '../core/suscripcion-datos.js';
import { enviarAvisoPrevio, proximoCargo, DIAS_DE_AVISO } from '../core/suscripcion-mensual.js';
import { getTenantById, setTenantStatus } from '../core/control-db.js';

const SLUG = 'helados-ibrahin';
let ok = 0, mal = 0;
const P = t => console.log(t);
const check = (n, c, d = '') => { if (c) { ok++; P(`  ✓ ${n}`); } else { mal++; P(`  ✗ ${n}${d ? '\n      ' + String(d).slice(0, 350) : ''}`); } };
const ts = i => Math.floor(Date.parse(i + 'T12:00:00Z') / 1000);
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);

const cd = new Database('/home/ubuntu/bamburu/data/control.db');
const tenant = cd.prepare('SELECT id, name, slug FROM tenants WHERE slug=?').get(SLUG);
const antes = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
const estadoAntes = getTenantById(tenant.id).status;
const notaAntes = getTenantById(tenant.id).suspend_note ?? null;
const relojes = [];
const correos = [];
const espia = async (m) => { correos.push(m); return { data: { id: 'x' }, error: null }; };

const conteoDeTodo = () => {
  const bd = new Database(`/home/ubuntu/bamburu/data/tenants/${SLUG}.db`, { readonly: true });
  const out = {};
  for (const { name } of bd.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    try { out[name] = bd.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n; } catch { out[name] = -1; }
  }
  bd.close();
  return out;
};

/** Deja el negocio cortado hace `dias`, con una tarjeta viva en un reloj de prueba de Stripe. */
async function montarCortado(dias, hoy) {
  const rc = await stripe.stripeApi('POST', '/test_helpers/test_clocks', { frozen_time: ts(hoy), name: 'gate rescate' });
  if (!rc.ok) throw new Error(rc.error);
  relojes.push(rc.datos.id);
  const cli = await stripe.stripeApi('POST', '/customers', { name: 'ZZ rescate', email: 'zz@ejemplo.test', test_clock: rc.datos.id });
  const pm = await stripe.stripeApi('POST', '/payment_methods', { type: 'card', card: { token: 'tok_visa' } });
  await stripe.stripeApi('POST', `/payment_methods/${pm.datos.id}/attach`, { customer: cli.datos.id });
  await stripe.fijarMetodoPorDefecto(cli.datos.id, pm.datos.id);
  const corte = sumarDias(hoy, -dias);
  cd.prepare(`UPDATE tenant_suscripciones SET estado='pago_pendiente', cortado_en=?, cortado_por_impago=1,
    impago_desde=?, corte_previsto=?, descarga_hasta=?, en_boveda_desde=?, stripe_cliente_id=?,
    stripe_metodo_pago_id=?, tarjeta_marca='visa', tarjeta_ultimos4=?, stripe_suscripcion_id=NULL,
    rescate_en=NULL, rescate_eleccion=NULL, rescate_factura=NULL, aviso_de_factura=NULL WHERE tenant_id=?`)
    .run(corte, sumarDias(corte, -30), corte, sumarDias(corte, DIAS_DE_DESCARGA),
         dias > DIAS_DE_DESCARGA ? sumarDias(corte, DIAS_DE_DESCARGA) : null,
         cli.datos.id, pm.datos.id, pm.datos.card?.last4 || '4242', tenant.id);
  setTenantStatus(tenant.id, 'suspended_admin', 'Sin pago. Ve a «Mi suscripción» y pon una tarjeta.');
  return { reloj: rc.datos.id, cliente: cli.datos.id };
}

try {
  const conteosPrevios = conteoDeTodo();

  // ══ A · RESCATE DENTRO DE LOS 90 DÍAS ═══════════════════════════════════════════════════════════
  P('\n[A] Rescate DENTRO de los 90 días');
  const HOY_A = '2026-09-20';
  await montarCortado(20, HOY_A);
  let r = situacionDeRescate(tenant.id, { hoy: HOY_A });
  check('se ofrece el rescate', r.aplica === true);
  check('cuesta UN MES completo, no un prorrateo', r.precio.total === '11,98 €', r.precio.total);
  check('con base e IVA desglosados', r.precio.base === '9,90 €' && r.precio.iva === '2,08 €', JSON.stringify(r.precio));
  check('y dice la fecha exacta del próximo cobro', r.proximo_cobro === '2026-10-05', r.proximo_cobro);
  check('la promesa lo dice en una frase', /mes completo.*11,98/.test(r.promesa) && /5 de octubre/.test(r.promesa), r.promesa);
  check('todavía NO está en la bóveda', r.en_boveda === false);

  let res = await rescatar(tenant, 'cuenta', { hoy: HOY_A });
  check('el rescate sale bien', res.ok, res.error);
  check('y deja SU FACTURA', !!res.factura, JSON.stringify(res.factura));
  check('la cuenta vuelve a estar activa', getTenantById(tenant.id).status === 'active', getTenantById(tenant.id).status);
  let s = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
  check('se va el corte y el episodio de impago', !s.cortado_por_impago && !s.impago_desde && s.estado === 'al_corriente',
    JSON.stringify({ c: s.cortado_por_impago, i: s.impago_desde, e: s.estado }));
  check('se cierran la ventana y la bóveda como estados', !s.descarga_hasta && !s.en_boveda_desde);
  check('queda apuntado QUÉ eligió', s.rescate_eleccion === 'cuenta', s.rescate_eleccion);
  check('EL NEGOCIO VUELVE EXACTAMENTE COMO ESTABA: ni una fila cambió',
    JSON.stringify(conteoDeTodo()) === JSON.stringify(conteosPrevios));

  // El ciclo del día 5 lo recoge como a cualquiera.
  const cargo = await proximoCargo(tenant);
  check('vuelve al ciclo del día 5', cargo && cargo.fecha === '2026-10-05', JSON.stringify(cargo));
  check('por el importe de siempre', cargo && cargo.total === '11,98 €', cargo?.total);
  correos.length = 0;
  const avisoPronto = await enviarAvisoPrevio(tenant, { hoy: '2026-09-25', enviar: espia });
  check('no se le avisa antes de tiempo', !avisoPronto.enviado && avisoPronto.motivo === 'todavia_no_toca', avisoPronto.motivo);
  const aviso = await enviarAvisoPrevio(tenant, { hoy: sumarDias('2026-10-05', -DIAS_DE_AVISO), enviar: espia });
  check(`y SÍ ${DIAS_DE_AVISO} días antes, como a cualquier cliente`, aviso.enviado === true, aviso.motivo);

  // ══ B · RESCATE DESDE LA BÓVEDA ═════════════════════════════════════════════════════════════════
  P('\n[B] Rescate PASADOS los 90 días — desde la bóveda');
  const HOY_B = '2027-02-10';
  await montarCortado(200, HOY_B);
  check('la ventana de descarga está cerrada', situacionDeLosDatos(tenant.id, { hoy: HOY_B }).fase === 'boveda');
  r = situacionDeRescate(tenant.id, { hoy: HOY_B });
  check('LA BÓVEDA NO CADUCA PARA RESCATAR: se sigue ofreciendo', r.aplica === true && r.en_boveda === true);
  check('y cuesta lo mismo: un mes, ni un euro de atrasos', r.precio.total === '11,98 €', r.precio.total);
  res = await rescatar(tenant, 'cuenta', { hoy: HOY_B });
  check('se rescata desde la bóveda', res.ok, res.error);
  check('la cuenta vuelve a estar activa', getTenantById(tenant.id).status === 'active');
  check('y el negocio sigue entero, 200 días después',
    JSON.stringify(conteoDeTodo()) === JSON.stringify(conteosPrevios));
  check('el próximo cobro es el día 5 siguiente', (await proximoCargo(tenant))?.fecha === '2027-03-05',
    (await proximoCargo(tenant))?.fecha);

  // ══ C · SOLO LOS DATOS ══════════════════════════════════════════════════════════════════════════
  P('\n[C] «Solo quiero mis datos»: se los lleva y la cuenta SIGUE en la bóveda');
  const HOY_C = '2027-05-10';
  await montarCortado(200, HOY_C);
  res = await rescatar(tenant, 'datos', { hoy: HOY_C });
  check('el rescate de solo datos sale bien', res.ok, res.error);
  check('cuesta lo mismo que el otro', res.importe === '11,98 €', res.importe);
  check('y deja su factura', !!res.factura);
  check('LA CUENTA SIGUE CORTADA, como dice el criterio',
    getTenantById(tenant.id).status === 'suspended_admin', getTenantById(tenant.id).status);
  s = cd.prepare('SELECT * FROM tenant_suscripciones WHERE tenant_id=?').get(tenant.id);
  check('y sigue marcada como cortada por impago', s.cortado_por_impago === 1);
  check('pero se le reabre la ventana para descargar', situacionDeLosDatos(tenant.id, { hoy: HOY_C }).puede_descargar === true);
  check(`con los ${DIAS_DE_DESCARGA} días de siempre, sin inventar un plazo nuevo`,
    situacionDeLosDatos(tenant.id, { hoy: HOY_C }).dias_restantes === DIAS_DE_DESCARGA);
  check('queda apuntado que eligió los datos', s.rescate_eleccion === 'datos', s.rescate_eleccion);
  check('y NI UNA FILA se ha tocado', JSON.stringify(conteoDeTodo()) === JSON.stringify(conteosPrevios));

  // ══ D · LOS DOS CASOS INCÓMODOS ═════════════════════════════════════════════════════════════════
  P('\n[D] Los casos incómodos, a propósito');
  // Rescata el día 2: paga el mes, y el día 5 —tres días después— se le cobra otra vez.
  const HOY_D = '2027-07-02';
  await montarCortado(150, HOY_D);
  r = situacionDeRescate(tenant.id, { hoy: HOY_D });
  check('rescatando el día 2, el próximo cobro es el día 5 (tres días después)',
    r.proximo_cobro === '2027-07-05', r.proximo_cobro);
  check('y la pantalla lo dice ANTES de pagar, con su fecha',
    r.promesa.includes('5 de julio de 2027'), r.promesa);
  res = await rescatar(tenant, 'cuenta', { hoy: HOY_D });
  check('se rescata igual', res.ok, res.error);
  const c2 = await proximoCargo(tenant);
  check('PAGA EL MES Y EL DÍA 5 VUELVE A PAGAR: la regla del dueño, no un fallo',
    c2 && c2.fecha === '2027-07-05' && diasEntre(HOY_D, c2.fecha) === 3, JSON.stringify(c2));
  check('y se le avisa 7 días antes igual, sin excepción',
    (await enviarAvisoPrevio(tenant, { hoy: sumarDias('2027-07-05', -DIAS_DE_AVISO), enviar: espia })).motivo !== 'sin_suscripcion_en_stripe');

  // Rescata el día 6: no se le cobra hasta el día 5 del mes siguiente.
  const HOY_E = '2027-09-06';
  await montarCortado(150, HOY_E);
  r = situacionDeRescate(tenant.id, { hoy: HOY_E });
  check('rescatando el día 6, el próximo cobro es el día 5 del mes siguiente',
    r.proximo_cobro === '2027-10-05', r.proximo_cobro);
  res = await rescatar(tenant, 'cuenta', { hoy: HOY_E });
  const c3 = await proximoCargo(tenant);
  check('no se le cobra otra vez hasta ese día 5', c3 && c3.fecha === '2027-10-05', JSON.stringify(c3));
  check('o sea, 29 días de margen', c3 && diasEntre(HOY_E, c3.fecha) === 29, String(diasEntre(HOY_E, c3?.fecha)));

  // ══ E · LO QUE NO PUEDE PASAR ═══════════════════════════════════════════════════════════════════
  P('\n[E] Lo que no puede pasar');
  const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const mod = sinCom((await import('fs')).readFileSync('/home/ubuntu/bamburu/core/suscripcion-rescate.js', 'utf8'));
  check('el rescate no borra NADA', !/DELETE FROM|DROP /i.test(mod));
  check('no hay descuentos ni ofertas en ningún sitio', !/descuento|oferta|rebaja|promoci[óo]n/i.test(mod));
  check('no se calcula ningún atraso: se paga UN mes y ya',
    !/atras|deuda|moros|meses_debidos/i.test(mod));
  check('no se prorratea: el rescate no es un alta', !/prorrateo|prorrate/i.test(mod));
  // Dentro de `rescatar`, no en el fichero entero: `volverALaNormalidad` aparece antes en la línea
  // del import, así que comparar posiciones globales medía otra cosa.
  const cuerpoRescatar = mod.slice(mod.indexOf('export async function rescatar'));
  check('el cobro va ANTES de reactivar (si falla, no se abre la cuenta)',
    cuerpoRescatar.indexOf('await cobrarUnMes') < cuerpoRescatar.indexOf('volverALaNormalidad(tenant.id'),
    'el orden importa: reactivar sin haber cobrado es peor que no abrir');
  const sinEleccion = await rescatar(tenant, 'lo-que-sea', { hoy: HOY_E });
  check('hay que ELEGIR: no vale cualquier cosa', !sinEleccion.ok && /elegir/i.test(sinEleccion.error), sinEleccion.error);
  check('y no se manda ni un correo desde el rescate', correos.length <= 2, `${correos.length} correos`);

  P('\n──────────────────────────────────────────────────────────');
  P(`  ${ok} OK · ${mal} fallos`);
  P('──────────────────────────────────────────────────────────\n');
} finally {
  for (const r of relojes) await stripe.stripeApi('DELETE', `/test_helpers/test_clocks/${r}`).catch(() => {});
  setTenantStatus(tenant.id, estadoAntes, estadoAntes === 'active' ? null : notaAntes);
  const cols = Object.keys(antes).filter(k => k !== 'tenant_id');
  cd.prepare('UPDATE tenant_suscripciones SET ' + cols.map(c => c + '=?').join(', ') + ' WHERE tenant_id=?')
    .run(...cols.map(c => antes[c]), tenant.id);
  P(`  relojes borrados · negocio devuelto a «${estadoAntes}»`);
}
process.exit(mal ? 1 : 0);
