// suscripcion-cobro.js — El único sitio del producto que cobra la suscripción.
//
// POR QUÉ ESTÁ APARTE. Lo llaman DOS caminos: la vuelta de Stripe cuando el dueño deja la tarjeta con
// la prueba ya vencida, y la pasada diaria `scripts/suscripcion-cobros.mjs` cuando una prueba vence.
// Si cada uno tuviera su copia, se separarían al primer arreglo — y "el cobro se comporta distinto
// según por dónde entres" es un fallo que solo se descubre mirando el extracto de un cliente.
//
// LAS TRES REGLAS QUE NO SE TOCAN:
//
//  1. **Nunca se cobra dos veces el mismo periodo.** La llave de idempotencia que se le da a Stripe
//     es `prorrateo-<tenant>-<desde>-<hasta>`: la MISMA para el mismo periodo, siempre. Si un
//     timeout de red hace que se reintente, Stripe devuelve el cargo original en vez de crear otro.
//     Y antes de llamar siquiera se comprueba el estado local.
//  2. **Un fallo de cobro NO corta nada.** Aquí solo se marca `pago_pendiente` y se guarda el motivo.
//     Cortar es la tarea `suscripcion-impago-y-corte`, con sus avisos de 30 días. Un cobro que falla
//     y corta en el acto sería exactamente lo que Ibrahin pidió no hacer.
//  3. **No se cobra durante la prueba.** Si quedan días, se sale sin hacer nada. El criterio dice
//     «AL TERMINAR la prueba».

import { controlDb } from './control-db.js';
import { eur } from './plan.js';
import { situacion, prorrateo, suscripcionDe, guardarSuscripcion, hoyISO,
         siguienteDiaDeCobro, diasEntre } from './suscripcion.js';
import * as stripe from './stripe.js';

/**
 * Cobra a un negocio la parte proporcional hasta el próximo día de cobro.
 * Devuelve `{ ok, motivo, importe, error }` y NUNCA lanza: lo llama una pasada nocturna que no
 * puede morirse a mitad de la lista y dejar sin cobrar a los que venían detrás.
 *
 * `motivo` explica por qué NO se hizo nada, cuando no se hizo nada. Se distingue a propósito de un
 * error: "todavía está de prueba" no es un fallo, y contarlo como tal llenaría el registro de rojos
 * que no lo son.
 */
export async function cobrarProrrateo(tenant, { db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  const s = suscripcionDe(tenant.id, db);
  if (!s) return { ok: false, motivo: 'sin_suscripcion', error: 'Este negocio no tiene suscripción abierta.' };

  const est = situacion(tenant.id, { hoy: dia, db });

  if (est.situacion === 'prueba') {
    return { ok: false, motivo: 'en_prueba', error: null,
             detalle: `La prueba sigue viva hasta el ${s.prueba_fin}. No se cobra.` };
  }
  if (est.situacion === 'al_corriente' && s.proximo_cobro && diasEntre(dia, s.proximo_cobro) > 0) {
    return { ok: false, motivo: 'ya_al_corriente', error: null,
             detalle: `Ya está al corriente; el próximo cobro es el ${s.proximo_cobro}.` };
  }
  if (!s.stripe_cliente_id || !s.stripe_metodo_pago_id) {
    // No es un fallo de cobro: es que no hay con qué. Se deja dicho, sin marcar `pago_pendiente`
    // por algo que el dueño no ha llegado a intentar.
    return { ok: false, motivo: 'sin_tarjeta', error: null,
             detalle: 'No hay tarjeta guardada, así que no hay nada que cobrar.' };
  }

  const pr = prorrateo(dia, db);
  if (pr.total_centimos <= 0) {
    return { ok: false, motivo: 'importe_cero', error: null, detalle: 'El importe sale a cero.' };
  }

  const referencia = `prorrateo-${tenant.id}-${pr.desde}-${pr.hasta}`;
  const res = await stripe.cobrar({
    clienteId: s.stripe_cliente_id,
    metodoId: s.stripe_metodo_pago_id,
    centimos: pr.total_centimos,
    // Lo que el cliente leerá en su extracto. Que diga el periodo evita la llamada de "¿y esto qué es?".
    descripcion: `Bamburu · suscripción ${pr.desde} a ${pr.hasta} (${pr.base} + IVA ${pr.iva})`,
    referencia,
  });

  if (!res.ok) {
    guardarSuscripcion(tenant.id, {
      estado: 'pago_pendiente',
      ultimo_error: res.error || 'El cobro no salió adelante.',
    }, db);
    return { ok: false, motivo: 'cobro_rechazado', error: res.error, importe: pr.total, periodo: pr };
  }

  guardarSuscripcion(tenant.id, {
    estado: 'al_corriente',
    proximo_cobro: siguienteDiaDeCobro(pr.hasta, undefined),
    ultimo_cobro_centimos: pr.total_centimos,
    ultimo_cobro_en: dia,
    ultimo_error: null,
  }, db);

  return { ok: true, motivo: 'cobrado', error: null, importe: pr.total, periodo: pr,
           stripe_id: res.datos?.id || null };
}

/**
 * Los negocios a los que HOY les toca el cobro del prorrateo: prueba vencida, tarjeta puesta y sin
 * estar ya al corriente. Es lo que recorre la pasada diaria.
 */
export function pendientesDeProrrateo({ db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  const filas = db.prepare(`
    SELECT t.id, t.name, t.slug, s.*
      FROM tenants t
      JOIN tenant_suscripciones s ON s.tenant_id = t.id
     WHERE s.stripe_metodo_pago_id IS NOT NULL
       AND s.estado IN ('prueba', 'pago_pendiente')
  `).all();
  return filas.filter(f => f.prueba_fin && diasEntre(dia, f.prueba_fin) <= 0);
}

export { eur };
