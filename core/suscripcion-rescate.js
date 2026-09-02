// suscripcion-rescate.js — El camino de vuelta: paga un mes y elige.
//
// Tarea `suscripcion-rescate-de-la-boveda` (2 sep 2026). Última del bloque de suscripción.
//
// LA REGLA DEL DUEÑO SOBRE EL DINERO, Y NO SE REINTERPRETA:
//   · **Es pago por adelantado: se compra el derecho al periodo.** NO existe «deuda» ni «morosidad».
//     El que no pagó no compró el periodo, y punto. **No hay nada viejo que saldar ni que perdonar**,
//     así que aquí no se calcula ni un euro de atrasos por muchos meses que lleve cortado.
//   · **Cuesta un mes completo**, el precio único de siempre, base + IVA desde `core/plan.js`.
//     **La proporcionalidad existe solo en el alta; el rescate no es un alta.**
//   · Ese pago **compra el periodo en curso** (de día 5 a día 5). El siguiente cobro automático es el
//     día 5 de siempre, con su aviso 7 días antes, como cualquier cliente.
//   · **Si rescata muy cerca del día 5, paga el mes y el día 5 vuelve a pagar.** Es una regla asumida
//     por el dueño, no un defecto: NO se «arregla» prorrateando ni saltándose el cobro.
//   · **Sin descuentos, sin ofertas, sin excepciones.**
//
// LAS DOS PUERTAS DE SALIDA, que es el criterio 2 y lo que hace que esto no sea solo «reactivar»:
// al pagar **se le pregunta qué quiere**. O recupera la cuenta entera, o se lleva solo sus datos y
// la cuenta se queda en la bóveda. Las dos cuestan lo mismo, porque lo que se compra es sacar algo
// de la bóveda.
//
// NO HAY NADA QUE RESTAURAR, y por eso esto es corto: la bóveda nunca movió nada. El negocio está
// entero, en su sitio, con la última fila que dejó. Reactivar es cambiar un estado, no recomponer.

import { controlDb, getTenantById } from './control-db.js';
import { precioBaseCentimos, ivaPorcentaje, desglose, eur } from './plan.js';
import { suscripcionDe, guardarSuscripcion, hoyISO, siguienteDiaDeCobro, fechaEnPalabras } from './suscripcion.js';
import { volverALaNormalidad } from './suscripcion-impago.js';
import { DIAS_DE_DESCARGA } from './suscripcion-datos.js';
import { asegurarSuscripcionEnStripe } from './suscripcion-mensual.js';
import * as stripe from './stripe.js';

export const ELECCIONES = ['cuenta', 'datos'];

/**
 * Qué se le ofrece, y por cuánto. Devuelve SIEMPRE algo pintable.
 * El importe es **un mes completo**, no un prorrateo: el rescate no es un alta.
 */
export function situacionDeRescate(tenantId, { db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  const s = suscripcionDe(tenantId, db);
  if (!s || s.cortado_por_impago !== 1) return { aplica: false };

  const precio = desglose(precioBaseCentimos(db), db);
  const proximoCobro = siguienteDiaDeCobro(dia);
  return {
    aplica: true,
    // Da igual que esté dentro de los 90 días o ya en la bóveda: **la bóveda no caduca para
    // rescatar**. Se distingue solo para contarlo bien en pantalla.
    en_boveda: !!s.en_boveda_desde,
    cortado_en: s.cortado_en,
    precio,
    importe: precio.total,
    proximo_cobro: proximoCobro,
    proximo_cobro_en_palabras: fechaEnPalabras(proximoCobro),
    tarjeta: s.tarjeta_ultimos4 ? { marca: s.tarjeta_marca || 'tarjeta', ultimos4: s.tarjeta_ultimos4 } : null,
    ya_rescatado_en: s.rescate_en || null,
    ultima_eleccion: s.rescate_eleccion || null,
    // Lo que se le promete, en una frase, para que la pantalla y el correo digan LO MISMO.
    promesa: `Recuperas tu negocio hoy, pagas el mes completo (${precio.total}), `
           + `y tu próximo cobro es el ${fechaEnPalabras(proximoCobro)}, el día 5 como siempre.`,
  };
}

/**
 * COBRA EL MES Y DEJA SU FACTURA.
 *
 * Se cobra con una **factura de Stripe**, no con un cargo suelto, y es a propósito: una factura trae
 * su numeración y su PDF, y sale con **base e IVA desglosados** — que es lo que exige la ley y lo
 * mismo que hace el cobro mensual. Un `PaymentIntent` a pelo cobraría igual y no dejaría factura.
 */
async function cobrarUnMes(tenant, s, { db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  const plan = await stripe.asegurarPlanEnStripe({
    centimos: precioBaseCentimos(db), ivaPorcentaje: ivaPorcentaje(db),
  });
  if (!plan.ok) return plan;

  // La llave lleva el PERIODO dentro, como la del prorrateo: dos clics seguidos no cobran dos veces,
  // y un rescate del mes que viene sí es un cobro nuevo.
  //
  // ⚠️ Y PASA POR `llaveIdempotente`, que le añade la huella del contenido. La escribí a mano y
  // choqué con lo de siempre —«Keys for idempotent requests can only be used with the same
  // parameters»— en cuanto cambié un parámetro de la línea de factura. Es la CUARTA vez hoy con este
  // mismo fallo, y por eso la regla vive en una función: escribir la llave a mano es el error.
  // Sigue siendo estable por periodo, que es lo que impide cobrar dos veces: los parámetros son los
  // mismos para el mismo negocio y el mismo mes.
  const referencia = `rescate-${tenant.id}-${siguienteDiaDeCobro(dia)}`;

  // ⚠️ El IMPORTE va suelto, no el precio del plan, y Stripe obliga: una línea de factura solo
  // admite precios `one_time`, y el del plan es `recurring` —«The price specified is set to
  // type=recurring but this field only accepts prices with type=one_time»—. Medido al construirlo.
  // Lo que importa no se pierde: el importe sale de `core/plan.js`, que es su único sitio, y el IVA
  // sigue yendo como `tax_rate` aparte, así que la factura lo desglosa igual.
  // ⚠️ LA LÍNEA SE CREA DENTRO DE SU FACTURA, NO SUELTA. Y no es un detalle de estilo: una línea de
  // factura sin `invoice` queda PENDIENTE en el cliente, y Stripe la barre hacia la factura
  // siguiente. Medido: la próxima cuota salía a **23,96 € en vez de 11,98 €** — el cliente habría
  // pagado el rescate dos veces, la segunda sin enterarse.
  //
  // Por eso el orden es: primero la factura VACÍA (`pending_invoice_items_behavior: 'exclude'`, para
  // que no se lleve nada que ande suelto de antes), luego la línea apuntando a esa factura, y solo
  // entonces se cierra. Así no existe el momento en que hay una línea flotando.
  const paramsFac = {
    customer: s.stripe_cliente_id,
    collection_method: 'charge_automatically',
    default_payment_method: s.stripe_metodo_pago_id,
    auto_advance: false,
    pending_invoice_items_behavior: 'exclude',
    description: 'Rescate de la cuenta',
    metadata: { bamburu_tenant_id: String(tenant.id), bamburu_rescate: '1' },
  };
  const fac = await stripe.stripeApi('POST', '/invoices', paramsFac,
    { idempotencia: stripe.llaveIdempotente(referencia + '-factura', paramsFac) });
  if (!fac.ok) return fac;

  // El importe va suelto y no el precio del plan porque Stripe obliga: una línea de factura solo
  // admite precios `one_time`, y el del plan es `recurring` —«The price specified is set to
  // type=recurring but this field only accepts prices with type=one_time»—. Lo que importa no se
  // pierde: el importe sale de `core/plan.js`, su único sitio, y el IVA sigue yendo como `tax_rate`
  // aparte, así que la factura lo desglosa igual.
  const paramsItem = {
    customer: s.stripe_cliente_id,
    invoice: fac.datos.id,
    amount: precioBaseCentimos(db),
    currency: 'eur',
    tax_rates: [plan.datos.ivaId],
    description: `Bamburu · rescate: mes completo hasta el ${siguienteDiaDeCobro(dia)}`,
  };
  const item = await stripe.stripeApi('POST', '/invoiceitems', paramsItem,
    { idempotencia: stripe.llaveIdempotente(referencia + '-item', paramsItem) });
  if (!item.ok) return item;

  const cerrada = await stripe.stripeApi('POST', `/invoices/${fac.datos.id}/finalize`, {});
  if (!cerrada.ok) return cerrada;

  // ⚠️ CERRAR LA FACTURA YA LA COBRA. Con `collection_method: 'charge_automatically'` y una tarjeta
  // por defecto, Stripe cobra en el mismo `finalize`. Pedir el cobro después devuelve
  // «Invoice is already paid» — y eso era lo peor posible: **el dinero salía y el estado no
  // cambiaba**, porque el error abortaba el rescate después de haber cobrado. Medido al construirlo.
  //
  // Así que se mira el estado en vez de suponerlo: si ya está pagada, hemos terminado; si sigue
  // abierta, se cobra. Nunca las dos cosas.
  if (cerrada.datos?.status === 'paid') return cerrada;

  const pagada = await stripe.stripeApi('POST', `/invoices/${fac.datos.id}/pay`, {
    payment_method: s.stripe_metodo_pago_id,
  });
  // Y si entre medias la cobró Stripe por su cuenta, tampoco es un fallo del rescate.
  if (!pagada.ok && /already paid/i.test(pagada.error || '')) {
    return stripe.stripeApi('GET', `/invoices/${fac.datos.id}`);
  }
  return pagada;
}

/**
 * EL RESCATE. `eleccion` es 'cuenta' (recupera el negocio en marcha) o 'datos' (solo la copia; la
 * cuenta sigue en la bóveda). Devuelve `{ ok, error, ... }` y NUNCA lanza.
 *
 * El cobro va PRIMERO y el cambio de estado después. Si se hiciera al revés y el cobro fallara, el
 * negocio quedaría reactivado sin haber pagado — y volver a cortarlo sería peor que no haberlo
 * abierto.
 */
export async function rescatar(tenant, eleccion, { db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  if (!ELECCIONES.includes(eleccion)) {
    return { ok: false, error: 'Hay que elegir: recuperar la cuenta o solo los datos.' };
  }
  const s = suscripcionDe(tenant.id, db);
  if (!s || s.cortado_por_impago !== 1) {
    return { ok: false, error: 'Esta cuenta no está cortada: no hay nada que rescatar.' };
  }
  if (!s.stripe_cliente_id || !s.stripe_metodo_pago_id) {
    // No es un fallo de cobro: es que no hay con qué. La pantalla ofrece cambiar de tarjeta, que es
    // lo esperable — si le cortaron, lo más probable es que esa tarjeta ya no valga.
    return { ok: false, motivo: 'sin_tarjeta',
             error: 'No hay ninguna tarjeta que funcione. Pon una y vuelve a intentarlo.' };
  }

  const cobro = await cobrarUnMes(tenant, s, { db, hoy: dia });
  if (!cobro.ok) {
    guardarSuscripcion(tenant.id, { ultimo_error: cobro.error }, db);
    return { ok: false, motivo: 'cobro_rechazado', error: cobro.error };
  }

  const factura = cobro.datos?.number || cobro.datos?.id || null;
  const precio = desglose(precioBaseCentimos(db), db);

  if (eleccion === 'datos') {
    // SOLO LOS DATOS: la cuenta **sigue en la bóveda**. Lo único que cambia es que se le vuelve a
    // abrir la ventana de descarga, con los mismos días que decidió el dueño — no se inventa un
    // plazo nuevo. Y no se toca ni una fila del negocio: no hay nada que sacar de ningún sitio.
    const { sumarDias } = await import('./suscripcion.js');
    guardarSuscripcion(tenant.id, {
      rescate_en: dia, rescate_eleccion: 'datos', rescate_factura: factura,
      en_boveda_desde: null,
      descarga_hasta: sumarDias(dia, DIAS_DE_DESCARGA),
      descarga_estado: null, descarga_fichero: null, descarga_lista_en: null,
      descarga_resumen: null, descarga_error: null,
      ultimo_error: null,
    }, db);
    return { ok: true, eleccion: 'datos', importe: precio.total, factura,
             mensaje: `Pago recibido (${precio.total}). Tienes ${DIAS_DE_DESCARGA} días para `
                    + 'descargarte todo. Tu cuenta sigue en la bóveda: no se ha borrado nada.' };
  }

  // LA CUENTA: vuelve a estar en marcha. `volverALaNormalidad` es la MISMA pieza que ya usa el pago
  // del impago —no se duplica— y es la que quita el solo-lectura, la franja y el episodio.
  guardarSuscripcion(tenant.id, {
    rescate_en: dia, rescate_eleccion: 'cuenta', rescate_factura: factura,
    descarga_hasta: null, en_boveda_desde: null,
    descarga_estado: null, descarga_fichero: null, descarga_lista_en: null,
    descarga_resumen: null, descarga_error: null,
  }, db);
  const v = volverALaNormalidad(tenant.id, { db });

  // Y vuelve al ciclo del día 5 como cualquier cliente: la suscripción de Stripe se abre anclada al
  // próximo día 5, así que el cobro siguiente sale solo, con su aviso 7 días antes.
  let mensual = null;
  try {
    const r = await asegurarSuscripcionEnStripe(tenant, { db, ancla: siguienteDiaDeCobro(dia) });
    mensual = r.ok ? (r.datos?.id || null) : null;
    if (!r.ok) console.error('[rescate] cuenta reactivada pero no se pudo abrir la mensual:', r.error);
  } catch (e) {
    console.error('[rescate] cuenta reactivada pero no se pudo abrir la mensual:', e.message);
  }

  return { ok: true, eleccion: 'cuenta', importe: precio.total, factura,
           reactivado: v.reactivado, suscripcion: mensual,
           proximo_cobro: siguienteDiaDeCobro(dia),
           mensaje: `Pago recibido (${precio.total}). Tu cuenta vuelve a estar en marcha, con todo `
                  + `como lo dejaste. Tu próximo cobro es el ${fechaEnPalabras(siguienteDiaDeCobro(dia))}.` };
}

export { eur };
