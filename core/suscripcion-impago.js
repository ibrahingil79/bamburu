// suscripcion-impago.js — Qué pasa cuando el cobro del día 5 falla.
//
// Tarea `suscripcion-impago-y-corte` (2 sep 2026). La regla del dueño, en una frase: **no se corta
// de golpe ni en silencio.** Treinta días de avisos, cada vez más claros, y solo entonces se cierra
// la puerta — sin borrar nada.
//
// LO QUE HACE STRIPE Y LO QUE HACEMOS NOSOTROS, porque mezclarlo sería confuso:
//   · **Stripe reintenta.** Un cobro fallido lo vuelve a intentar solo. Eso recupera una buena parte
//     sin molestar a nadie, y por eso el primer aviso dice «lo intentaremos otra vez» en vez de
//     «arregla esto ya».
//   · **Nosotros contamos los 30 días y cortamos.** El calendario de avisos y el corte son NUESTROS,
//     medidos desde `impago_desde`. No dependen de la política de reintentos de Stripe — que, medido
//     el 2 sep 2026, **no se puede fijar por API**: es una casilla de su panel. Un criterio del dueño
//     no puede colgar de una casilla que alguien tenga que ir a marcar en otra web.
//   · **Si Stripe cancela la suscripción** por su cuenta antes de nuestro día 30 (su política por
//     defecto puede hacerlo), no pasa nada: al pagar, `asegurarSuscripcionEnStripe` la vuelve a
//     abrir. Es idempotente y por eso esto aguanta cualquier configuración de la cuenta.
//
// EL CORTE NO BORRA NADA. Cambia `tenants.status` a `suspended_admin`, que es el modo SOLO LECTURA
// que ya existía: el dueño entra, ve sus datos y sus facturas, y no puede crear ni modificar. Ni una
// fila se toca. La descarga de 90 días, la bóveda y el rescate son las dos tareas siguientes.
//
// ⚠️ Y LO MÁS IMPORTANTE DE TODO EL FICHERO: **desde cortado SIEMPRE se puede pagar.** El 2 de
// septiembre se descubrió que ese mismo estado bloqueaba el botón de pagar — al negocio al que se le
// pedía regularizar se le quitaba la única forma de hacerlo. `readOnlyGuard` deja pasar
// `/admin/suscripcion` y `/api/erp/suscripcion` por eso, y hay una comprobación que lo vigila.

import { controlDb, setTenantStatus, getTenantById } from './control-db.js';
import { suscripcionDe, guardarSuscripcion, hoyISO, sumarDias, diasEntre, fechaEnPalabras } from './suscripcion.js';
import { eur } from './plan.js';
import { correoDelNegocio } from './suscripcion-mensual.js';
import { sendEmail } from './mailer.js';

/** Días desde el primer fallo hasta el corte. Es la regla del dueño: 30. */
export const DIAS_HASTA_EL_CORTE = 30;

/**
 * LA CADENA DE AVISOS. Cinco mensajes DISTINTOS, no el mismo repetido — es el criterio 2, y por eso
 * cada uno tiene su propio texto, su propio tono y su propio asunto.
 *
 * Los días están elegidos para acompañar a los reintentos de Stripe, no para pelearse con ellos: el
 * día 0 se avisa sin alarmar porque lo normal es que el reintento lo resuelva; el 7 ya es una
 * tarjeta que de verdad no funciona; el 20 y el 27 son la cuenta atrás; el 30 es el corte.
 *
 * `dia` se cuenta desde `impago_desde`. Si una pasada se salta un día (servidor apagado), el aviso
 * que tocaba **sale igualmente en la siguiente**: se busca el último escalón vencido, no el exacto.
 */
export const ESCALONES = [
  { dia: 0,  clave: 'aviso-0',  tono: 'tranquilo' },
  { dia: 7,  clave: 'aviso-7',  tono: 'informativo' },
  { dia: 20, clave: 'aviso-20', tono: 'directo' },
  { dia: 27, clave: 'aviso-27', tono: 'urgente' },
  // El día del corte SALE DE LA CONSTANTE, no escrito otra vez. Si alguien cambiara los 30 días por
  // 45, un `30` aquí dejaría el corte donde estaba y la cuenta atrás mentiría. El resto de escalones
  // son fechas propias de la cadena y sí son suyas.
  { dia: DIAS_HASTA_EL_CORTE, clave: 'corte', tono: 'corte' },
];

// ── Registrar el fallo y la vuelta a la normalidad ────────────────────────────────────────────────

/**
 * Un cobro ha fallado. Abre el episodio de impago si no había uno abierto.
 *
 * NO reinicia el reloj si ya estaba abierto, y ése es el punto: Stripe reintenta varias veces y cada
 * reintento fallido volvería a llamar aquí. Si `impago_desde` se moviera, **el corte se alejaría solo
 * y no llegaría nunca**, y el dueño se quedaría con avisos eternos y sin cobrar.
 */
export function registrarFalloDeCobro(tenantId, motivo, { db = controlDb, hoy = null } = {}) {
  const dia = hoy || hoyISO();
  const s = suscripcionDe(tenantId, db);
  if (!s) return null;
  if (s.impago_desde) {
    guardarSuscripcion(tenantId, { estado: 'pago_pendiente', ultimo_error: motivo || s.ultimo_error }, db);
    return suscripcionDe(tenantId, db);
  }
  guardarSuscripcion(tenantId, {
    estado: 'pago_pendiente',
    ultimo_error: motivo || 'El cobro no salió adelante.',
    impago_desde: dia,
    corte_previsto: sumarDias(dia, DIAS_HASTA_EL_CORTE),
    avisos_impago: '',
  }, db);
  return suscripcionDe(tenantId, db);
}

/**
 * Ha pagado. Todo vuelve a la normalidad SOLO: cesan los avisos, desaparece la franja y, si estaba
 * cortado, se reactiva.
 *
 * Solo levanta la suspensión que puso el impago (`cortado_por_impago`). Si el superadmin suspendió
 * ese negocio por otro motivo —seguridad, por ejemplo— un pago no puede abrirle la puerta.
 */
export function volverALaNormalidad(tenantId, { db = controlDb } = {}) {
  const s = suscripcionDe(tenantId, db);
  if (!s) return { reactivado: false, motivo: 'sin_suscripcion' };

  const estabaCortado = s.cortado_por_impago === 1;
  guardarSuscripcion(tenantId, {
    estado: 'al_corriente', ultimo_error: null,
    impago_desde: null, corte_previsto: null, avisos_impago: null,
    cortado_en: null, cortado_por_impago: 0,
  }, db);

  if (!estabaCortado) return { reactivado: false, motivo: 'no_estaba_cortado' };

  const t = getTenantById(tenantId);
  if (t?.status === 'suspended_admin') {
    setTenantStatus(tenantId, 'active');
    return { reactivado: true, motivo: 'reactivado' };
  }
  // Si ya no está en `suspended_admin` es que alguien lo movió: no se toca su estado.
  return { reactivado: false, motivo: 'estado_cambiado_por_otro', estado: t?.status || null };
}

// ── La cadena: qué toca hoy ───────────────────────────────────────────────────────────────────────

/** Los negocios con un impago abierto. Es lo que recorre la pasada diaria. */
export function conImpagoAbierto({ db = controlDb } = {}) {
  try {
    return db.prepare(`
      SELECT t.id, t.name, t.slug, t.status, s.*
        FROM tenants t JOIN tenant_suscripciones s ON s.tenant_id = t.id
       WHERE s.impago_desde IS NOT NULL AND s.estado = 'pago_pendiente'`).all();
  } catch { return []; }
}

/**
 * Qué escalón toca hoy para este negocio, o `null` si ninguno.
 * Se busca el ÚLTIMO escalón vencido y no avisado, no el que caiga justo hoy: si el servidor estuvo
 * apagado el día 7, el aviso sale el 8 en vez de perderse. Y si se saltaron dos, **sale solo el más
 * reciente** — mandar tres correos de golpe es ruido, no diligencia.
 */
export function escalonQueToca(s, { hoy = null } = {}) {
  const dia = hoy || hoyISO();
  if (!s.impago_desde) return null;
  const transcurridos = diasEntre(s.impago_desde, dia);
  const yaAvisados = String(s.avisos_impago || '').split(',').filter(Boolean);
  const vencidos = ESCALONES.filter(e => transcurridos >= e.dia && !yaAvisados.includes(e.clave));
  return vencidos.length ? vencidos[vencidos.length - 1] : null;
}

/** El texto de cada escalón. Cinco mensajes distintos, con su tono y su enlace para pagar. */
export function textoDelAviso(escalon, { negocio, tarjeta, importe, corteEl, url }) {
  const cuatro = tarjeta ? ` (${tarjeta.marca} ···· ${tarjeta.ultimos4})` : '';
  const pie = [``, `Puedes arreglarlo aquí, en un minuto:`, `    ${url}`, ``, `— Bamburu`].join('\n');
  const corte = fechaEnPalabras(corteEl);

  switch (escalon.clave) {
    case 'aviso-0': return {
      asunto: `Bamburu · no hemos podido cobrar tu suscripción`,
      texto: [`Hola,`, ``,
        `No hemos podido cobrar ${importe} de tu suscripción de Bamburu${cuatro}.`, ``,
        `No tienes que hacer nada todavía: **lo intentaremos otra vez automáticamente** en los`,
        `próximos días. La mayoría de las veces se resuelve solo.`, ``,
        `Si sabes que esa tarjeta ya no vale, puedes cambiarla cuando quieras y evitarnos el viaje.`,
      ].join('\n') + pie };

    case 'aviso-7': return {
      asunto: `Bamburu · seguimos sin poder cobrar tu suscripción`,
      texto: [`Hola,`, ``,
        `Lo hemos intentado varias veces y seguimos sin poder cobrar ${importe}${cuatro}.`, ``,
        `Lo más habitual es que la tarjeta haya caducado o no tenga saldo. **Cambiarla lleva un**`,
        `**minuto** y todo vuelve a la normalidad al momento.`, ``,
        `Tu cuenta sigue funcionando con normalidad. Si esto no se arregla, quedaría en solo`,
        `lectura el ${corte}.`,
      ].join('\n') + pie };

    case 'aviso-20': return {
      asunto: `Bamburu · quedan 10 días para que tu cuenta pase a solo lectura`,
      texto: [`Hola,`, ``,
        `Tu suscripción sigue sin poder cobrarse (${importe}${cuatro}), y queremos que lo sepas con`,
        `tiempo: **el ${corte} tu cuenta pasará a SOLO LECTURA.**`, ``,
        `Eso significa que podrás seguir entrando y viendo TODO —tus clientes, tus facturas, tus`,
        `datos— pero no crear ni modificar nada. **No se borra absolutamente nada.**`, ``,
        `Para evitarlo solo hay que poner una tarjeta que funcione.`,
      ].join('\n') + pie };

    case 'aviso-27': return {
      asunto: `Bamburu · quedan 3 días: el ${corte} tu cuenta pasa a solo lectura`,
      texto: [`Hola,`, ``,
        `Última llamada antes de la fecha: **el ${corte}**, dentro de 3 días, tu cuenta de Bamburu`,
        `pasará a SOLO LECTURA porque no hemos podido cobrar ${importe}${cuatro}.`, ``,
        `Qué pasa exactamente ese día: entras igual, ves todo igual, y no puedes crear ni modificar`,
        `nada. Ni facturas nuevas, ni clientes, ni citas. **Tus datos siguen intactos**, y en cuanto`,
        `pagues vuelve todo a funcionar al instante.`, ``,
        `Se arregla poniendo una tarjeta que funcione. Nada más.`,
      ].join('\n') + pie };

    case 'corte': return {
      asunto: `Bamburu · tu cuenta ha pasado a solo lectura`,
      texto: [`Hola,`, ``,
        `Como te avisamos, hoy tu cuenta de Bamburu ha pasado a **SOLO LECTURA**: no hemos podido`,
        `cobrar ${importe}${cuatro} en ${DIAS_HASTA_EL_CORTE} días.`, ``,
        `**Qué significa, en concreto:**`,
        `  · Puedes entrar y ver TODO: clientes, facturas, citas, informes.`,
        `  · Puedes descargarte tus facturas.`,
        `  · NO puedes crear ni modificar nada.`,
        `  · **No se ha borrado nada, y no se va a borrar.**`, ``,
        `**Qué hay que hacer para volver, exactamente:**`,
        `  1. Entra en Bamburu como siempre.`,
        `  2. Ve a «Mi suscripción» (abajo del todo, en el menú de la izquierda).`,
        `  3. Pon una tarjeta que funcione.`,
        `Tu cuenta se reactiva sola en el momento en que el pago salga bien.`,
      ].join('\n') + pie };

    default: return null;
  }
}

// ── La pasada: avisar y, si toca, cortar ──────────────────────────────────────────────────────────

/**
 * Procesa el impago de UN negocio: manda el aviso que toque y, si el escalón es el corte, corta.
 * Devuelve siempre qué hizo y por qué, incluso cuando no hace nada — un aviso que no sale y no deja
 * rastro es el fallo de helados-ibrahin.
 */
export async function procesarImpago(fila, { db = controlDb, hoy = null, simulacro = false, enviar = sendEmail, baseUrl = null } = {}) {
  const dia = hoy || hoyISO();
  const esc = escalonQueToca(fila, { hoy: dia });
  if (!esc) return { hizo: 'nada', motivo: 'ningun_escalon_vencido' };

  const destino = correoDelNegocio({ id: fila.tenant_id ?? fila.id }, db);
  const url = `${baseUrl || `https://${fila.slug}.bamburu.com`}/admin/suscripcion`;
  const s = suscripcionDe(fila.tenant_id ?? fila.id, db);
  const msg = textoDelAviso(esc, {
    negocio: fila.name,
    tarjeta: s?.tarjeta_ultimos4 ? { marca: s.tarjeta_marca || 'tarjeta', ultimos4: s.tarjeta_ultimos4 } : null,
    importe: s?.ultimo_cobro_centimos ? eur(s.ultimo_cobro_centimos) : 'tu cuota mensual',
    corteEl: s?.corte_previsto, url,
  });

  if (simulacro) return { hizo: 'simulacro', escalon: esc.clave, destino, asunto: msg.asunto };

  // EL CORTE VA ANTES DEL CORREO, y el orden importa: si se mandara el correo primero y el corte
  // fallara, el dueño tendría un correo diciendo que está cortado y una cuenta que funciona. Al
  // revés es recuperable: la cuenta está cortada y el aviso sale en la pasada siguiente.
  let cortado = false;
  if (esc.clave === 'corte') {
    setTenantStatus(fila.tenant_id ?? fila.id, 'suspended_admin',
      `Sin pago desde el ${fechaEnPalabras(s?.impago_desde)}. Ve a «Mi suscripción» y pon una tarjeta: se reactiva sola.`);
    guardarSuscripcion(fila.tenant_id ?? fila.id, { cortado_en: dia, cortado_por_impago: 1 }, db);
    cortado = true;
  }

  let enviado = false, errorCorreo = null;
  if (destino) {
    try {
      const r = await enviar({ from: 'Bamburu <noreply@bamburu.com>', to: destino, subject: msg.asunto, text: msg.texto });
      if (r?.error) errorCorreo = r.error.message || String(r.error);
      else enviado = true;
    } catch (e) { errorCorreo = e.message || String(e); }
  } else {
    errorCorreo = 'no hay a quién escribir';
  }

  // El escalón se apunta aunque el correo falle: si no, la pasada de mañana volvería a intentar el
  // MISMO escalón para siempre y el dueño recibiría el aviso del día 7 en bucle. El fallo del correo
  // se dice y se ve; lo que no puede es atascar la cadena.
  const ya = String(s?.avisos_impago || '').split(',').filter(Boolean);
  guardarSuscripcion(fila.tenant_id ?? fila.id, { avisos_impago: [...ya, esc.clave].join(',') }, db);

  return { hizo: cortado ? 'cortado' : 'avisado', escalon: esc.clave, destino, enviado, errorCorreo, asunto: msg.asunto };
}
