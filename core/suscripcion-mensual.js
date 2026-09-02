// suscripcion-mensual.js — El cobro del día 5, y el aviso de la semana antes.
//
// Tarea `suscripcion-cobro-mensual` (2 sep 2026). Se apoya en lo que ya existe y NO lo rehace: el
// plan de 9,90 € + IVA vive en `core/plan.js`, la prueba de 15 días y el prorrateo inicial en
// `core/suscripcion.js` y `core/suscripcion-cobro.js`, y el guardado de tarjeta en la pantalla.
//
// QUIÉN COBRA, A PARTIR DE AQUÍ: STRIPE. Y es una decisión, no una comodidad:
//   · El **día 5** lo mantiene `billing_cycle_anchor`, que resuelve solo los meses cortos. Un
//     calendario escrito a mano falla una vez al año y siempre en producción.
//   · La **factura** la emite Stripe, con su numeración y con **base e IVA desglosados** — que es
//     el criterio del dueño y lo que exige la ley. Por eso el IVA va como `tax_rate` aparte y no
//     metido en el precio.
//   · Los **reintentos** ante un fallo los lleva Stripe. Aquí no se construye ni una línea de eso:
//     el impago, los avisos de deuda y el corte son la tarea SIGUIENTE
//     (`suscripcion-impago-y-corte`). Si un cobro falla, esto solo lo APUNTA.
//
// EL AVISO DE LA SEMANA ANTES TIENE DOS DISPARADORES, Y NO ES REDUNDANCIA TONTA:
//   1. El webhook `invoice.upcoming` de Stripe, que es lo que pide el encargo.
//   2. Una pasada diaria propia que mira si a alguien le falta una semana.
// El motivo del segundo, medido en esta cuenta: **el plazo de `invoice.upcoming` NO se puede fijar
// por API** — `GET /v1/account` devuelve `settings.billing` vacío; es un ajuste del panel de Stripe.
// Dejar el criterio del dueño («una semana antes») colgando de una casilla que alguien tiene que ir
// a marcar en otra web es exactamente lo que se decidió no hacer con Managed Payments. Los dos
// disparadores entran por la MISMA puerta (`enviarAvisoPrevio`), que apunta la factura por la que ya
// avisó, así que el dueño recibe **un** aviso por cobro, venga por donde venga.

import { controlDb } from './control-db.js';
import { precioBaseCentimos, ivaPorcentaje, eur } from './plan.js';
import { suscripcionDe, guardarSuscripcion, siguienteDiaDeCobro, hoyISO,
         diasEntre, fechaEnPalabras } from './suscripcion.js';
import * as stripe from './stripe.js';
import { sendEmail } from './mailer.js';
import Database from 'better-sqlite3';
import path from 'path';

/** Cuántos días antes del cargo se avisa. Es el criterio del dueño: una semana. */
export const DIAS_DE_AVISO = 7;

// ── La suscripción en Stripe ──────────────────────────────────────────────────────────────────────

/**
 * Deja creada en Stripe la suscripción mensual de este negocio, anclada al día 5.
 *
 * SE LLAMA JUSTO DESPUÉS DEL PRORRATEO, nunca antes: el tramo de hoy al día 5 lo cobra el prorrateo
 * de la tarea anterior, y la suscripción empieza a facturar EN ese día 5 (`proration_behavior:
 * 'none'`). Comprobado contra Stripe: al crearla no emite ninguna factura cobrada, y la siguiente
 * sale por 11,98 € con base 9,90 e IVA 2,08.
 *
 * Idempotente: si el negocio ya tiene una suscripción viva, no crea otra.
 */
export async function asegurarSuscripcionEnStripe(tenant, { db = controlDb, desde = null, ancla = null } = {}) {
  const s = suscripcionDe(tenant.id, db);
  if (!s) return { ok: false, error: 'Este negocio no tiene suscripción abierta.' };
  if (!s.stripe_cliente_id || !s.stripe_metodo_pago_id) {
    return { ok: false, error: 'No hay tarjeta guardada: no se puede abrir la suscripción.' };
  }

  if (s.stripe_suscripcion_id) {
    const ya = await stripe.recuperarSuscripcion(s.stripe_suscripcion_id);
    // `canceled` o `incomplete_expired` significan que aquélla murió: se abre otra. Cualquier otro
    // estado (active, past_due, unpaid) es una suscripción viva y no se toca.
    if (ya.ok && !['canceled', 'incomplete_expired'].includes(ya.datos?.status)) {
      return { ok: true, datos: ya.datos, yaEstaba: true, error: null };
    }
  }

  const plan = await stripe.asegurarPlanEnStripe({
    centimos: precioBaseCentimos(db), ivaPorcentaje: ivaPorcentaje(db),
  });
  if (!plan.ok) return plan;

  // El ancla es el día 5 en el que empieza a facturar Stripe.
  //
  // ⚠️ `ancla` SE PASA YA RESUELTA, y no se calcula a partir de `desde`. Aquí hubo un fallo de UN MES
  // mientras se escribía: quien llama es el prorrateo, y su `pr.hasta` **ya es** el día 5 que
  // queremos; pasarlo por `siguienteDiaDeCobro`, que es estricto, devolvía el 5 del mes siguiente.
  // El negocio habría pasado un mes entero sin que se le facturara nada. Por eso hay dos entradas:
  // `ancla` para quien ya sabe la fecha, y `desde` para quien solo sabe el día en que está.
  const fechaAncla = ancla || siguienteDiaDeCobro(desde || hoyISO(), undefined);
  // A las 09:00 UTC y no a medianoche: un cargo a las 00:00 cae en el día anterior en algunos husos,
  // y el dueño lo lee como «me habéis cobrado el día 4».
  const anclaTimestamp = Math.floor(Date.parse(`${fechaAncla}T09:00:00Z`) / 1000);

  const sub = await stripe.crearSuscripcion({
    clienteId: s.stripe_cliente_id, precioId: plan.datos.precioId, ivaId: plan.datos.ivaId,
    metodoId: s.stripe_metodo_pago_id, anclaTimestamp, tenantId: tenant.id,
  });
  if (!sub.ok) return sub;

  guardarSuscripcion(tenant.id, {
    stripe_suscripcion_id: sub.datos.id,
    proximo_cobro: fechaAncla,
    estado: 'al_corriente',
    ultimo_error: null,
  }, db);

  return { ok: true, datos: sub.datos, yaEstaba: false, error: null };
}

// ── El aviso de la semana antes ───────────────────────────────────────────────────────────────────

/** Lo que se le va a cobrar y cuándo, tal y como lo dice Stripe. `null` si no hay nada pendiente. */
export async function proximoCargo(tenant, { db = controlDb } = {}) {
  const s = suscripcionDe(tenant.id, db);
  if (!s?.stripe_suscripcion_id) return null;
  const f = await stripe.proximaFactura(s.stripe_suscripcion_id);
  if (!f.ok) return null;
  const d = f.datos;
  return {
    factura_id: d.id || `upcoming-${d.period_end}`,
    fecha: new Date((d.next_payment_attempt || d.period_end) * 1000).toISOString().slice(0, 10),
    base_centimos: d.subtotal, iva_centimos: d.tax ?? 0, total_centimos: d.total,
    base: eur(d.subtotal), iva: eur(d.tax ?? 0), total: eur(d.total),
  };
}

/**
 * Manda el aviso previo si toca y si no se mandó ya. Devuelve por qué NO se mandó, cuando no se
 * manda: un aviso que no sale y no deja rastro es el fallo de helados-ibrahin —ocho días sin correo
 * y nadie se enteró— y aquí no se repite.
 *
 * `forzar` salta la comprobación de los 7 días (lo usa el webhook `invoice.upcoming`, que ya viene
 * disparado por Stripe a su plazo), pero NO salta la de «ya avisé de esta factura».
 */
export async function enviarAvisoPrevio(tenant, { db = controlDb, hoy = null, forzar = false,
                                                 simulacro = false, enviar = sendEmail } = {}) {
  const dia = hoy || hoyISO();
  const s = suscripcionDe(tenant.id, db);
  if (!s) return { enviado: false, motivo: 'sin_suscripcion' };
  if (!s.stripe_suscripcion_id) return { enviado: false, motivo: 'sin_suscripcion_en_stripe' };

  const cargo = await proximoCargo(tenant, { db });
  if (!cargo) return { enviado: false, motivo: 'sin_proximo_cargo' };

  if (s.aviso_de_factura && s.aviso_de_factura === cargo.factura_id) {
    return { enviado: false, motivo: 'ya_avisado', cargo };
  }
  const faltan = diasEntre(dia, cargo.fecha);
  if (!forzar && faltan !== DIAS_DE_AVISO) {
    return { enviado: false, motivo: 'todavia_no_toca', faltan, cargo };
  }

  const destino = correoDelNegocio(tenant, db);
  if (!destino) return { enviado: false, motivo: 'sin_destinatario', cargo };

  // SIMULACRO: se ha calculado todo —a quién, cuánto, qué día— y NO se manda ni se apunta. Un guion
  // que mueve algo no lo mueve por defecto, y «mandar un correo a un cliente» es mover algo.
  if (simulacro) return { enviado: false, motivo: 'simulacro', destino, cargo };

  const tarjeta = s.tarjeta_ultimos4
    ? `tu ${s.tarjeta_marca || 'tarjeta'} terminada en ${s.tarjeta_ultimos4}`
    : 'la tarjeta que tienes guardada';

  const asunto = `Bamburu · el ${fechaEnPalabras(cargo.fecha)} te cobraremos ${cargo.total}`;
  const cuerpo = [
    `Hola,`,
    ``,
    `Te avisamos con una semana de antelación, como siempre: **no cobramos por sorpresa**.`,
    ``,
    `El ${fechaEnPalabras(cargo.fecha)} se cargará tu suscripción de Bamburu en ${tarjeta}:`,
    ``,
    `    Base            ${cargo.base}`,
    `    IVA (${ivaPorcentaje(db)} %)      ${cargo.iva}`,
    `    ─────────────────────────`,
    `    Total           ${cargo.total}`,
    ``,
    `No tienes que hacer nada: si todo va bien, el cobro sale solo y no volveremos a escribirte.`,
    ``,
    `Si quieres cambiar la tarjeta, puedes hacerlo tú desde «Mi suscripción», en tu panel.`,
    ``,
    `— Bamburu`,
  ].join('\n');

  // El SDK de Resend NO lanza: devuelve { data, error }. Hay que MIRAR el error, y por eso el
  // resultado se guarda solo cuando de verdad salió. Ocho días de correos tirados a la basura en
  // agosto vinieron de dar por enviado lo que no se comprobó.
  // `enviar` es inyectable para que la comprobación pueda AFIRMAR SOBRE EL TEXTO —el importe, los
  // cuatro dígitos, la fecha— sin mandarle un correo de verdad al dueño cada vez que corre. Por
  // defecto es el `sendEmail` del producto: nadie que llame normalmente se entera de que existe.
  // DOS FORMAS DE FALLAR, Y HAY QUE CUBRIR LAS DOS. El SDK de Resend no lanza al ENVIAR —devuelve
  // `{ data, error }`, y por eso se mira `error`—, pero su CONSTRUCTOR sí lanza si no hay clave:
  // «Missing API key». Medido el 2 sep 2026 ejecutando la pasada sin el entorno cargado. Sin este
  // try/catch, un servidor al que le falte `RESEND_API_KEY` no se queda sin avisos: se queda con la
  // pasada MUERTA a mitad de la lista, y los negocios de detrás ni se intentan.
  let r;
  try {
    r = await enviar({ from: 'Bamburu <noreply@bamburu.com>', to: destino, subject: asunto, text: cuerpo });
  } catch (e) {
    return { enviado: false, motivo: 'fallo_al_enviar', error: e.message || String(e), cargo };
  }
  if (r?.error) {
    return { enviado: false, motivo: 'fallo_al_enviar', error: r.error.message || String(r.error), cargo };
  }

  guardarSuscripcion(tenant.id, { aviso_de_factura: cargo.factura_id, aviso_enviado_en: dia }, db);
  return { enviado: true, motivo: 'enviado', destino, cargo, asunto, cuerpo, id: r?.data?.id || null };
}

/**
 * A quién se le escribe. El correo del DUEÑO, de la base del negocio — la misma fuente que usa el
 * alta para el cliente de Stripe, y por el mismo motivo: `admin_users.email` existe en el 100 % de
 * los usuarios y `company_config.email` estaba vacío en 6 de 7 negocios (medido el 17 ago 2026).
 *
 * ⚠️ SE ABRE LA BASE A MANO Y NO CON `getTenantDb`, y hay dos motivos medidos el 2 sep 2026:
 *
 *  1. **`getTenantDb` abre para ESCRIBIR y corre las migraciones.** Leer un correo no puede migrar
 *     la base de un negocio. Y si quien llama no trae el `db_filename` completo —le pasé
 *     `{id, name, slug}` desde una consulta mía— `new Database(undefined)` **abre una base anónima
 *     vacía**, le corre las migraciones enteras, le siembra una cuenta semilla… y la mete en la
 *     caché de conexiones **bajo el slug del negocio de verdad**. A partir de ahí, en ese proceso,
 *     el negocio real es una base vacía. No dejó fichero, pero pudo haber sido peor.
 *  2. **`fileMustExist`.** Sin él, SQLite CREA la base que no encuentra. Es el hallazgo que ya está
 *     escrito en las notas del proyecto: una simple búsqueda por email llegó a fabricar una base
 *     fantasma por cada tenant descuadrado.
 *
 * Solo lectura, el fichero tiene que existir, y se cierra al salir.
 */
export function correoDelNegocio(tenant, db = controlDb) {
  let bd = null;
  try {
    // El `db_filename` se lee de control.db y no del objeto que llega: quien llama puede traer un
    // tenant a medias, y de eso salió el fallo de arriba.
    const fila = db.prepare('SELECT db_filename FROM tenants WHERE id = ?').get(tenant?.id);
    if (!fila?.db_filename) return null;
    const ruta = path.isAbsolute(fila.db_filename)
      ? fila.db_filename : path.join(process.cwd(), fila.db_filename);
    bd = new Database(ruta, { readonly: true, fileMustExist: true });
    return bd.prepare(
      "SELECT email FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get()?.email || null;
  } catch {
    return null;
  } finally {
    try { bd?.close(); } catch { /* ya estaba cerrada */ }
  }
}

// ── Las facturas del cliente ──────────────────────────────────────────────────────────────────────

/** Las facturas ya emitidas, con su número y su PDF, para pintarlas en la pantalla del dueño. */
export async function facturasDelNegocio(tenant, { db = controlDb } = {}) {
  const s = suscripcionDe(tenant.id, db);
  if (!s?.stripe_cliente_id) return [];
  const r = await stripe.facturasDe(s.stripe_cliente_id);
  if (!r.ok) return [];
  return (r.datos.data || [])
    .filter(f => f.status !== 'draft' && f.total > 0)
    .map(f => ({
      numero: f.number || f.id,
      fecha: new Date((f.status_transitions?.paid_at || f.created) * 1000).toISOString().slice(0, 10),
      base: eur(f.subtotal), iva: eur(f.tax ?? 0), total: eur(f.total),
      pagada: f.status === 'paid',
      pdf: f.invoice_pdf || null,
      web: f.hosted_invoice_url || null,
    }));
}

// ── Cambiar la tarjeta ────────────────────────────────────────────────────────────────────────────

/**
 * Deja la tarjeta nueva como la que se cobra, y retira la anterior de Stripe.
 * Retirar la vieja es parte del criterio («sin que nadie tenga que tocarle la cuenta por dentro»):
 * si se quedara ahí, el cliente vería dos tarjetas suyas guardadas y no sabría cuál se le cobra.
 * El orden importa: primero se pone la nueva, y solo si eso sale bien se retira la vieja — al revés,
 * un fallo a mitad dejaría la suscripción sin ninguna tarjeta.
 */
export async function cambiarTarjeta(tenant, metodoNuevoId, { db = controlDb } = {}) {
  const s = suscripcionDe(tenant.id, db);
  if (!s) return { ok: false, error: 'Este negocio no tiene suscripción abierta.' };
  const viejo = s.stripe_metodo_pago_id && s.stripe_metodo_pago_id !== metodoNuevoId
    ? s.stripe_metodo_pago_id : null;

  if (s.stripe_suscripcion_id) {
    const r = await stripe.cambiarMetodoDeSuscripcion(s.stripe_suscripcion_id, metodoNuevoId);
    if (!r.ok) return r;
  }
  if (viejo) {
    // Si la retirada falla, NO es un fallo del cambio: la nueva ya está puesta y es la que se cobra.
    // Se deja dicho en el registro y se sigue; abortar aquí sería deshacer algo que salió bien.
    const d = await stripe.desasociarMetodo(viejo);
    if (!d.ok) console.error('[suscripcion] no se pudo retirar la tarjeta anterior:', d.error);
  }
  return { ok: true, error: null, retirada: viejo };
}
