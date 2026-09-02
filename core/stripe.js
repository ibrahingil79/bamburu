// stripe.js — Todo lo que Bamburu le dice a Stripe, y nada más.
//
// SIN DEPENDENCIA NUEVA, y es una decisión, no una pereza. El SDK de Stripe son ~60 paquetes en el
// árbol para lo que aquí son cuatro llamadas HTTP con el cuerpo en `application/x-www-form-urlencoded`.
// El repo ya habla con Anthropic por `fetch` (`core/llm.js`) y ese patrón está rodado. Una
// dependencia menos es también una cadena de suministro menos que vigilar en un fichero que mueve
// dinero.
//
// ⚠️ EL CERROJO DEL MODO DE PRUEBA. Ibrahin pidió construir esto EN MODO DE PRUEBA. Eso no se
// consigue con buena intención: se consigue haciendo que **una clave de producción no funcione**
// mientras nadie la autorice a mano. `claveSecreta()` RECHAZA cualquier clave que no empiece por
// `sk_test_` salvo que exista el ajuste `stripe_modo_real = si` en `settings` de control.db. Sin ese
// ajuste, una clave real devuelve error y no se cobra a nadie de verdad por accidente.
//
// LO QUE ESTE FICHERO NO HACE, NUNCA:
//   · No guarda un número de tarjeta, ni un CVV, ni una fecha de caducidad completa. La tarjeta la
//     teclea el cliente EN STRIPE, no en Bamburu: por eso el alta es un Checkout alojado por ellos.
//     Así el producto se queda fuera del alcance de PCI-DSS, que es donde tiene que quedarse.
//   · No cobra por su cuenta. Cobra cuando alguien le llama, y quien le llama es una ruta que el
//     dueño ha pulsado o el cobro mensual (tarea siguiente).
//   · No decide. Calcular cuánto se cobra es de `core/suscripcion.js`; aquí solo se transmite.

import { readFileSync } from 'fs';
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { controlDb } from './control-db.js';

const API = 'https://api.stripe.com/v1';

function delEntorno(nombre) {
  let v = process.env[nombre];
  if (!v) {
    try {
      const env = readFileSync('/etc/bamburu.env', 'utf8');
      // Anclado al principio de línea: sin `^`, `STRIPE_SECRET_KEY` casaría dentro de
      // `OTRA_STRIPE_SECRET_KEY` y se leería la clave equivocada.
      const m = env.match(new RegExp(`^${nombre}=(.+)$`, 'm'));
      if (m) v = m[1].trim();
    } catch { /* sin fichero: se queda sin valor */ }
  }
  return (v && v.trim()) || null;
}

function ajuste(clave) {
  try { return controlDb.prepare('SELECT value FROM settings WHERE key = ?').get(clave)?.value ?? null; }
  catch { return null; }
}

/** ¿Está permitido usar claves de PRODUCCIÓN? Solo si alguien lo ha dicho a mano en control.db. */
export function modoRealAutorizado() {
  return String(ajuste('stripe_modo_real') || '').trim().toLowerCase() === 'si';
}

export function esClaveDePrueba(clave) { return String(clave || '').startsWith('sk_test_'); }

/**
 * La clave secreta, o `null` si no hay. Devuelve `null` TAMBIÉN cuando hay una clave real y el modo
 * real no está autorizado: para el resto del producto, eso es "Stripe no configurado", que es
 * exactamente lo que queremos que pase mientras se construye.
 */
export function claveSecreta() {
  const clave = delEntorno('STRIPE_SECRET_KEY');
  if (!clave) return null;
  if (!esClaveDePrueba(clave) && !modoRealAutorizado()) return null;
  return clave;
}

export function clavePublica() { return delEntorno('STRIPE_PUBLISHABLE_KEY'); }
export function secretoWebhook() { return delEntorno('STRIPE_WEBHOOK_SECRET'); }
export function estaConfigurado() { return !!claveSecreta(); }

/** Para pintarlo en la pantalla del dueño sin enseñar ninguna clave. */
export function diagnostico() {
  const bruta = delEntorno('STRIPE_SECRET_KEY');
  return {
    hay_clave: !!bruta,
    es_de_prueba: esClaveDePrueba(bruta),
    modo_real_autorizado: modoRealAutorizado(),
    usable: !!claveSecreta(),
    hay_webhook: !!secretoWebhook(),
    modo: !bruta ? 'sin configurar' : (esClaveDePrueba(bruta) ? 'PRUEBA' : 'REAL'),
  };
}

// ── La llamada ────────────────────────────────────────────────────────────────────────────────────

/** Aplana `{a:{b:1}, c:[x,y]}` al formato de corchetes que espera Stripe: `a[b]=1&c[0]=x&c[1]=y`. */
function aFormulario(obj, prefijo = '', salida = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((el, i) => aFormulario({ [i]: el }, clave, salida));
    else if (typeof v === 'object') aFormulario(v, clave, salida);
    else salida.push(`${encodeURIComponent(clave)}=${encodeURIComponent(String(v))}`);
  }
  return salida;
}

/**
 * Una llamada a Stripe. Devuelve `{ ok, datos, error }` y NUNCA lanza — igual que el SDK de Resend,
 * que este repo ya usa así (`core/mailer.js`): quien llama tiene que mirar `error`, y con
 * excepciones es fácil que un `catch` de más arriba se coma un fallo de cobro.
 *
 * `Idempotency-Key` va en todos los POST. No es adorno: sin ella, un reintento por timeout de red
 * cobra DOS VECES al mismo cliente, y el cliente ve dos cargos idénticos con segundos de diferencia.
 */
export async function stripeApi(metodo, ruta, params = {}, { idempotencia = null } = {}) {
  const clave = claveSecreta();
  if (!clave) {
    const d = diagnostico();
    return { ok: false, datos: null,
             error: d.hay_clave && !d.es_de_prueba
               ? 'Hay una clave de Stripe de PRODUCCIÓN y el modo real no está autorizado. Mientras se construye, solo se admiten claves sk_test_.'
               : 'Stripe no está configurado en este servidor.' };
  }

  const cabeceras = {
    Authorization: `Bearer ${clave}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2024-06-20',
  };
  if (idempotencia && metodo !== 'GET') cabeceras['Idempotency-Key'] = idempotencia;

  let r;
  try {
    r = await fetch(`${API}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: metodo === 'GET' ? undefined : aFormulario(params).join('&'),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { ok: false, datos: null, error: `No se pudo contactar con Stripe: ${e.message}` };
  }

  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* respuesta ilegible */ }

  if (!r.ok) {
    const err = cuerpo?.error || {};
    // El `message` de Stripe está pensado para enseñárselo a la persona y viene en su idioma; el
    // `code` es lo que sirve para decidir. Se devuelven los dos.
    return { ok: false, datos: cuerpo, codigo: err.code || err.type || `http_${r.status}`,
             error: err.message || `Stripe respondió ${r.status}` };
  }
  return { ok: true, datos: cuerpo, error: null };
}

// ── Las cuatro cosas que Bamburu necesita ─────────────────────────────────────────────────────────

/**
 * LA LLAVE DE IDEMPOTENCIA, EN UN SOLO SITIO — y existe porque el fallo se repitió.
 *
 * Una llave de idempotencia queda atada EN STRIPE a los parámetros con los que se usó la primera
 * vez. La misma llave con parámetros distintos **no repite la respuesta: da error**, durante las 24 h
 * que Stripe la recuerda:
 *   «Keys for idempotent requests can only be used with the same parameters they were first used with»
 *
 * Pasó con `cliente-tenant-<id>` al añadir el correo del dueño, se arregló allí… y volvió a pasar
 * con `suscripcion-tenant-<id>-<ancla>` el mismo día. Arreglarlo en un punto de llamada y no en la
 * regla es exactamente el patrón que este repo tiene escrito con nombre: la regla no puede vivir en
 * quien llama, porque quien llama se olvida.
 *
 * Con el contenido dentro: dos clics seguidos siguen colapsando en UNA sola creación —que es para lo
 * que existe la llave— y cambiar cualquier parámetro deja de ser un error.
 */
export function llaveIdempotente(prefijo, params) {
  const huella = createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 12);
  return `${prefijo}-${huella}`;
}

/** Un cliente en Stripe para este negocio. Se crea una vez y se reutiliza siempre. */
export async function crearCliente({ nombre, email, tenantId, slug }) {
  const params = {
    name: nombre, email: email || undefined,
    metadata: { bamburu_tenant_id: String(tenantId), bamburu_slug: slug || '' },
  };

  // ⚙️ LA LLAVE LLEVA EL CONTENIDO DENTRO, no solo el número del negocio (2 sep 2026).
  //
  // Era `cliente-tenant-<id>` a secas, y eso está MAL de una forma que solo se ve al usarlo: una
  // llave de idempotencia queda atada en Stripe a los parámetros con los que se usó la primera vez,
  // así que la misma llave con parámetros distintos **no repite la respuesta: da error**. Medido:
  //   «Keys for idempotent requests can only be used with the same parameters they were first used
  //    with. Try using a key other than 'cliente-tenant-156'»
  // Salió al añadir el correo del dueño a la petición: el mismo negocio, un parámetro más, y el alta
  // dejó de funcionar durante 24 h (que es lo que Stripe recuerda una llave).
  //
  // Con el contenido dentro, cada versión de la petición tiene su llave. La compone
  // `llaveIdempotente`, que es donde vive ahora la regla — ver su comentario.
  return stripeApi('POST', '/customers', params,
                   { idempotencia: llaveIdempotente(`cliente-tenant-${tenantId}`, params) });
}

/**
 * El ALTA (criterio 4): una sesión de Checkout **en modo `setup`**, que guarda la tarjeta sin
 * cobrar nada. Es lo que permite cumplir a la vez el criterio 2 —15 días SIN pedir tarjeta— y el 3
 * —cobrar la parte proporcional cuando toque—: la tarjeta se guarda cuando el dueño quiere, y el
 * cobro sale después, con el importe ya calculado.
 *
 * Se opera COMO AUTÓNOMO: aquí no se pide, ni se menciona, ninguna sociedad. Stripe no lo exige para
 * cobrar, y la pantalla tampoco.
 */
export async function crearSesionDeAlta({ clienteId, exitoUrl, cancelUrl, tenantId }) {
  const base = {
    mode: 'setup',
    customer: clienteId,
    success_url: exitoUrl,
    cancel_url: cancelUrl,
    locale: 'es',
    payment_method_types: ['card'],
    metadata: { bamburu_tenant_id: String(tenantId) },
  };

  // ⚙️ MANAGED PAYMENTS (2 sep 2026) — por qué esto no es una línea de más.
  //
  // Stripe activa «Managed Payments» POR DEFECTO en las cuentas nuevas, y una cuenta con eso puesto
  // **rechaza `mode: setup`**: solo admite `subscription` o `payment`. Medido en la cuenta de
  // Ibrahin, con el mensaje entero de Stripe:
  //   «Invalid mode: setup. Managed Payments, which is enabled by default on your account, only
  //    supports mode: subscription or mode: payment. […] or pass managed_payments[enabled]=false»
  //
  // Se apaga **por petición**, no en el panel de Stripe. Es deliberado: el dueño no tiene por qué
  // ir a un ajuste de un panel ajeno para que su programa funcione, y un producto que depende de
  // una casilla marcada a mano en otra web se rompe en la primera cuenta nueva que se dé de alta.
  //
  // Y NO se puede resolver cambiando a `mode: subscription`, que es lo que sugiere el mensaje: ese
  // modo cobra (o abre una suscripción) en el mismo acto, y aquí hace falta justo lo contrario —
  // guardar la tarjeta SIN cobrar, porque al cliente le pueden quedar días de prueba. El criterio 3
  // dice «al TERMINAR la prueba».
  const r = await stripeApi('POST', '/checkout/sessions', { ...base, managed_payments: { enabled: false } });
  if (r.ok) return r;

  // La otra mitad, para que funcione en CUALQUIER cuenta: una que no conozca ese parámetro —versión
  // de API vieja, o cuenta sin Managed Payments— lo rechaza con `parameter_unknown`. Medido: Stripe
  // NO ignora los parámetros que no conoce, devuelve `code=parameter_unknown` con `param` diciendo
  // cuál es. En ese caso, y SOLO en ese, se repite sin él.
  //
  // No es una rama blanda: los dos caminos terminan en un éxito real o en el error de verdad. Lo que
  // se evita es que un producto que funciona en la cuenta de hoy deje de funcionar en la de mañana.
  const desconocido = r.codigo === 'parameter_unknown'
    && String(r.datos?.error?.param || '').startsWith('managed_payments');
  if (!desconocido) return r;

  return stripeApi('POST', '/checkout/sessions', base);
}

export async function recuperarSesion(sesionId) {
  return stripeApi('GET', `/checkout/sessions/${encodeURIComponent(sesionId)}`);
}
export async function recuperarSetupIntent(id) {
  return stripeApi('GET', `/setup_intents/${encodeURIComponent(id)}`);
}
export async function recuperarMetodoPago(id) {
  return stripeApi('GET', `/payment_methods/${encodeURIComponent(id)}`);
}

/** Deja esta tarjeta como la que se usará en los cobros automáticos del cliente. */
export async function fijarMetodoPorDefecto(clienteId, metodoId) {
  return stripeApi('POST', `/customers/${encodeURIComponent(clienteId)}`, {
    invoice_settings: { default_payment_method: metodoId },
  });
}

/**
 * EL COBRO. `off_session` + `confirm` = cárgalo ahora, sin el cliente delante.
 * `descripcion` sale en el extracto del banco del cliente, así que dice qué es.
 * La `referencia` es la llave de idempotencia y tiene que ser ESTABLE para el mismo cobro: si un
 * reintento genera otra, Stripe lo trata como un cargo nuevo y el cliente paga dos veces.
 *
 * ⚠️ ES LA ÚNICA LLAVE DEL FICHERO QUE **NO** PASA POR `llaveIdempotente`, y es a propósito. Allí la
 * huella del contenido evita el choque cuando los parámetros cambian; aquí ese choque es justo lo
 * que se quiere: la identidad de este cobro es SU PERIODO, y si el importe cambiara por un error de
 * cálculo, meterlo en la llave haría que el segundo intento cobrara otra vez en vez de chocar.
 */
export async function cobrar({ clienteId, metodoId, centimos, descripcion, referencia }) {
  return stripeApi('POST', '/payment_intents', {
    amount: centimos,
    currency: 'eur',
    customer: clienteId,
    payment_method: metodoId,
    off_session: true,
    confirm: true,
    description: descripcion,
  }, { idempotencia: referencia });
}

// ── EL PLAN MENSUAL EN STRIPE (tarea `suscripcion-cobro-mensual`) ────────────────────────────────
//
// SE CREA SOLO, DESDE EL CÓDIGO. El dueño no entra en el panel de Stripe a crear un producto ni un
// tipo de IVA: es la misma regla que obligó a apagar Managed Payments por petición en vez de por
// una casilla del panel. Una cuenta de Stripe recién hecha tiene que funcionar sin que nadie toque
// nada, y este servidor arranca con una cuenta vacía (comprobado: 0 productos, 0 precios, 0 IVA).
//
// EL IVA VA COMO `tax_rate` APARTE, NO METIDO EN EL PRECIO. Es lo que hace que la factura de Stripe
// salga con **base e IVA desglosados**, que es el criterio del dueño y lo que exige la ley. Si el
// precio fuera 11,98 € «con IVA incluido», la factura diría 11,98 € y punto.
//
// IDEMPOTENTE POR `lookup_key`: la clave lleva los céntimos dentro
// (`bamburu_plan_mensual_990`), así que llamar mil veces devuelve el mismo precio, y **cambiar el
// precio del plan crea uno nuevo en vez de mentir sobre el viejo** — los precios de Stripe son
// inmutables a propósito, porque hay suscripciones vivas colgando de ellos.
export async function asegurarPlanEnStripe({ centimos, ivaPorcentaje, nombre = 'Bamburu' }) {
  const clave = `bamburu_plan_mensual_${centimos}`;

  const yaHay = await stripeApi('GET', `/prices?lookup_keys[]=${encodeURIComponent(clave)}&active=true&limit=1`);
  if (!yaHay.ok) return yaHay;
  let precio = yaHay.datos?.data?.[0] || null;

  if (!precio) {
    const prods = await stripeApi('GET', '/products?active=true&limit=100');
    if (!prods.ok) return prods;
    let prod = (prods.datos?.data || []).find(p => p.metadata?.bamburu_plan === 'mensual') || null;
    if (!prod) {
      const pProd = {
        name: `${nombre} — suscripción mensual`,
        description: 'Acceso a Bamburu. Un plan único, sin permanencia.',
        metadata: { bamburu_plan: 'mensual' },
      };
      const nuevo = await stripeApi('POST', '/products', pProd,
                                    { idempotencia: llaveIdempotente('producto-plan-mensual', pProd) });
      if (!nuevo.ok) return nuevo;
      prod = nuevo.datos;
    }
    const pPrecio = {
      product: prod.id,
      unit_amount: centimos,
      currency: 'eur',
      recurring: { interval: 'month' },
      // El precio es la BASE. El IVA se suma aparte, con su tipo, para que la factura lo desglose.
      tax_behavior: 'exclusive',
      lookup_key: clave,
      nickname: `Bamburu mensual ${(centimos / 100).toFixed(2)} € + IVA`,
    };
    const creado = await stripeApi('POST', '/prices', pPrecio,
                                   { idempotencia: llaveIdempotente(`precio-${clave}`, pPrecio) });
    if (!creado.ok) return creado;
    precio = creado.datos;
  }

  const tipos = await stripeApi('GET', '/tax_rates?active=true&limit=100');
  if (!tipos.ok) return tipos;
  let iva = (tipos.datos?.data || []).find(t => t.metadata?.bamburu_iva === 'general'
                                             && Number(t.percentage) === Number(ivaPorcentaje)) || null;
  if (!iva) {
    const pIva = {
      display_name: 'IVA', description: `IVA ${ivaPorcentaje} % (España)`,
      percentage: ivaPorcentaje, inclusive: false, country: 'ES', jurisdiction: 'ES',
      metadata: { bamburu_iva: 'general' },
    };
    const nuevo = await stripeApi('POST', '/tax_rates', pIva,
                                  { idempotencia: llaveIdempotente(`iva-es-${ivaPorcentaje}`, pIva) });
    if (!nuevo.ok) return nuevo;
    iva = nuevo.datos;
  }

  return { ok: true, error: null, datos: { precioId: precio.id, ivaId: iva.id, productoId: precio.product } };
}

/**
 * La suscripción mensual, ANCLADA AL DÍA 5 con el mecanismo nativo de Stripe.
 *
 * `billing_cycle_anchor` es lo que hace que el cargo caiga el día 5 **y que los meses cortos los
 * resuelva Stripe solo**: en febrero factura el 5, no el 3 ni el 7, sin que nadie escriba un
 * calendario. Escribirlo a mano es la clase de código que falla una vez al año y siempre en
 * producción.
 *
 * `proration_behavior: 'none'` NO ES OPCIONAL, y es lo que impide COBRAR DOS VECES: el tramo desde
 * hoy hasta el día 5 **ya se ha cobrado** con el prorrateo de `suscripcion-plan-y-alta`. Sin este
 * parámetro, Stripe factura ese mismo tramo por su cuenta al crear la suscripción.
 */
export async function crearSuscripcion({ clienteId, precioId, ivaId, metodoId, anclaTimestamp, tenantId }) {
  const params = {
    customer: clienteId,
    items: [{ price: precioId }],
    default_tax_rates: [ivaId],
    default_payment_method: metodoId,
    billing_cycle_anchor: anclaTimestamp,
    proration_behavior: 'none',
    collection_method: 'charge_automatically',
    metadata: { bamburu_tenant_id: String(tenantId) },
  };
  return stripeApi('POST', '/subscriptions', params,
                   { idempotencia: llaveIdempotente(`suscripcion-tenant-${tenantId}`, params) });
}

export async function recuperarSuscripcion(id) {
  return stripeApi('GET', `/subscriptions/${encodeURIComponent(id)}`);
}
export async function cancelarSuscripcion(id) {
  return stripeApi('DELETE', `/subscriptions/${encodeURIComponent(id)}`);
}

/** La factura que viene: importe, IVA y fecha. Es de donde sale el aviso de la semana antes. */
export async function proximaFactura(suscripcionId) {
  return stripeApi('GET', `/invoices/upcoming?subscription=${encodeURIComponent(suscripcionId)}`);
}

/** Las facturas ya emitidas de este cliente, con su PDF y su número. */
export async function facturasDe(clienteId, limite = 24) {
  return stripeApi('GET', `/invoices?customer=${encodeURIComponent(clienteId)}&limit=${limite}`);
}

/** Cambia la tarjeta con la que se cobra la suscripción, y retira la anterior. */
export async function cambiarMetodoDeSuscripcion(suscripcionId, metodoId) {
  return stripeApi('POST', `/subscriptions/${encodeURIComponent(suscripcionId)}`, {
    default_payment_method: metodoId,
  });
}
export async function desasociarMetodo(metodoId) {
  return stripeApi('POST', `/payment_methods/${encodeURIComponent(metodoId)}/detach`);
}

/**
 * Verifica la firma de un webhook de Stripe. Sin esto, la URL del webhook es un botón público para
 * que cualquiera diga "este cliente ya ha pagado".
 *
 * Comprobación en tiempo constante (`timingSafeEqual`) y con ventana de tolerancia: una firma vieja
 * se rechaza, porque si no, un mensaje legítimo capturado hoy se puede reenviar dentro de un mes.
 */
export function verificarFirmaWebhook(cuerpoCrudo, cabeceraFirma, secreto = null, { toleranciaSeg = 300, ahora = null } = {}) {
  const clave = secreto || secretoWebhook();
  if (!clave) return { ok: false, error: 'No hay STRIPE_WEBHOOK_SECRET configurado.' };
  if (!cabeceraFirma) return { ok: false, error: 'Falta la cabecera Stripe-Signature.' };

  const partes = Object.fromEntries(
    String(cabeceraFirma).split(',').map(p => p.split('=').map(x => x.trim())).filter(p => p.length === 2));
  const t = partes.t;
  const v1 = partes.v1;
  if (!t || !v1) return { ok: false, error: 'Cabecera Stripe-Signature mal formada.' };

  const segundos = Math.floor((ahora ?? Date.now()) / 1000);
  if (Math.abs(segundos - Number(t)) > toleranciaSeg) {
    return { ok: false, error: 'La firma del webhook está fuera de la ventana de tiempo.' };
  }

  const esperada = createHmac('sha256', clave).update(`${t}.${cuerpoCrudo}`).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'La firma del webhook no cuadra.' };
  }
  return { ok: true, error: null };
}
