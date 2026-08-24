import { fmtEur } from './margen.js';

// ════════════════════════════════════════════════════════════════════════════
// LA VOZ — narración + decisión propuesta. Escalera · paso 5 (DISA predictiva) · PIEZA 2.
//
// QUÉ HACE: toma cada HALLAZGO que ya entregó el vigía (PIEZA 1, modules/erp/vigia.js) y lo viste
// como un AVISO legible con dos partes:
//   (a) QUÉ PASA + DESDE CUÁNDO  — una frase en español llano.
//   (b) DECISIÓN PROPUESTA       — una decisión concreta que pedirle al dueño (jamás un hueco vacío).
//
// LA REGLA DE ORO (idéntica a la del vigía y el constructor): PROHIBIDO INVENTAR CIFRAS. El texto se
// compone DETERMINÍSTICAMENTE por plantillas; los huecos se rellenan SOLO con los campos limpios del
// hallazgo (`cifra`, `fecha`, códigos de `ref`). NINGÚN número sale de una IA ni se recalcula. Todo
// número que aparece en (a)/(b) es EXACTAMENTE `cifra` o `fecha` — el mismo que el vigía tomó del
// motor de área, y por tanto el mismo que la pantalla de esa área. Si un campo no tiene dato, el
// aviso lo dice ("—"), no inventa.
//
// EL NOMBRE Y EL DETALLE EXACTO (de X a Y, objetivo/real, tramo, días) NO se reparsean: el vigía ya
// los puso, con sus cifras, en `titulo` y `motivo`. La voz los muestra VERBATIM (`encabezado`,
// `porque`) — su texto, sus números → imposible contradecirle. La decisión referencia la factura por
// su CÓDIGO (`invoice_number`/`internal_code`), no por un nombre reparseado de una cadena (que además,
// en datos reales, puede llevar un payload XSS: se escapa SIEMPRE al pintar, nunca aquí).
//
// LÍMITE DE ALCANCE: la voz SOLO narra y propone en TEXTO. NO ejecuta: no manda recordatorios, no
// escribe correos, no crea botones de envío, no toca datos de negocio. No consulta la BD por su
// cuenta ni reabre permisos: se limita a vestir lo que el vigía (que ya respeta permisos) le pasó, así
// que hereda el filtrado por área. La ejecución es una capa posterior.
//
// SIN PERSISTENCIA: función pura, como el vigía. Si una pieza futura guarda el texto, irá en una
// tabla `disa_*` FUERA de WRITABLE_TABLES — nunca aquí.

// El símbolo de moneda lo pasa quien pinta (el motor no lo conoce), igual que `detalleAviso` en
// avisos.js.
//
// EN ESPAÑOL, DESDE EL 23 AGO 2026 (noche, punto 8). Antes esto escribía `€232.75`: símbolo delante,
// punto decimal y sin separador de miles. En una frase que le lee un dueño español —«Tienes una
// factura sin cobrar por €232.75»— eso no se lee, se descifra. Ahora es `232,75 €`, que es como se
// escribe el dinero aquí y como ya lo escriben la ficha de cliente, el Inicio y los Informes.
// Se usa `fmtEur` de margen.js: es el formateador que ya existía, y no hacía falta un segundo.
export const dinero = (n, sym) => fmtEur(Number(n || 0), sym || '€');

// Y LAS FECHAS TAMBIÉN. `2026-08-23` es como se guarda, no como se dice. En una frase va `23/08/2026`.
// Lo que NO cambia es el dato: se formatea lo que llega, no se recalcula ni se reinterpreta — la
// regla de oro de este fichero es que el número que sale es EXACTAMENTE el que entró.
export function fechaEs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '—');
}

// La cifra ya formateada: con moneda si el hallazgo la marca; si no hay dato, "—" (no inventa).
function cifraTexto(h, sym) {
  if (h == null || h.cifra == null) return '—';
  return h.moneda ? dinero(h.cifra, sym) : String(h.cifra);
}

// Días naturales entre dos fechas ISO (a − b), en UTC. Solo se usa para elegir el TIEMPO verbal
// ("vence" vs "venció") — NUNCA para escribir un número: no muestra el resultado, solo su signo.
const DIA = 86400000;
const diasEntre = (a, b) => Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DIA);

// ── LAS PLANTILLAS ────────────────────────────────────────────────────────────
// Una por tipo de detector. `quePasa` y `decision` reciben (h, ctx) y devuelven una frase. `ctx` trae
// lo ya calculado: `importe` (cifra formateada), `fecha` y `hoy`. REGLA: dentro de estas frases el
// único texto con dígitos permitido es `importe`, `fecha` o un código de `ref` — nada más se escribe.
export const PLANTILLAS = {
  deuda_vencida: {
    quePasa: (h, { importe, fecha }) =>
      `Tienes una factura de cliente sin cobrar por ${importe}. Venció el ${fechaEs(fecha)} y sigue pendiente.`,
    decision: (h, { importe, fecha }) => {
      const fac = h.ref && h.ref.invoice_number ? `la factura ${h.ref.invoice_number}` : 'esta factura';
      return `Conviene reclamar el cobro de ${importe} de ${fac}, vencida desde el ${fechaEs(fecha)}.`;
    },
  },

  cliente_dormido: {
    quePasa: (h, { importe, fecha }) =>
      `Un cliente que te compraba con regularidad lleva ${importe} días sin hacerlo. Su última compra fue el ${fechaEs(fecha)}.`,
    decision: (h, { importe, fecha }) =>
      `Conviene retomar el contacto con este cliente: lleva ${importe} días en silencio desde su última compra, del ${fechaEs(fecha)}.`,
  },

  caida_facturacion: {
    quePasa: (h, { importe, fecha }) =>
      `En ${fechaEs(fecha)} tu facturación fue de ${importe}. Ha bajado respecto al mes anterior.`,
    decision: (h, { importe, fecha }) =>
      `La facturación ha caído respecto al mes anterior; en ${fechaEs(fecha)} quedó en ${importe}. Conviene revisar a qué se debe.`,
  },

  caida_margen: {
    quePasa: (h, { importe, fecha }) =>
      `En ${fechaEs(fecha)} tu margen (lo que ganas, no lo que facturas) fue de ${importe}. Ha bajado respecto al mes anterior.`,
    decision: (h, { importe, fecha }) =>
      `El margen ha caído respecto al mes anterior; en ${fechaEs(fecha)} quedó en ${importe}. Conviene revisar precios o costes.`,
  },

  desvio_plan: {
    quePasa: (h, { importe, fecha }) =>
      `Vas por debajo del objetivo que te fijaste para ${fechaEs(fecha)}. Lo real va por ${importe}.`,
    decision: (h, { importe, fecha }) =>
      `Vas por debajo del objetivo de ${fechaEs(fecha)}: lo real suma ${importe}. Conviene ajustar el ritmo o revisar la previsión.`,
  },

  pago_vence_pronto: {
    quePasa: (h, { importe, fecha, hoy }) => {
      const vencido = h.fecha && hoy && diasEntre(h.fecha, hoy) < 0;
      return vencido
        ? `Tienes un pago a proveedor de ${importe} que venció el ${fechaEs(fecha)} y sigue pendiente.`
        : `Tienes un pago a proveedor de ${importe} con vencimiento el ${fechaEs(fecha)}.`;
    },
    decision: (h, { importe, fecha, hoy }) => {
      const fac = h.ref && h.ref.internal_code ? `la factura ${h.ref.internal_code}` : 'esta factura';
      const vencido = h.fecha && hoy && diasEntre(h.fecha, hoy) < 0;
      return vencido
        ? `Conviene pagar cuanto antes ${importe} de ${fac}: venció el ${fechaEs(fecha)}.`
        : `Conviene tener saldo o programar el pago de ${importe} de ${fac}, que vence el ${fechaEs(fecha)}.`;
    },
  },

  // ── PELDAÑO 8 · PIEZA 3 — LOS CUATRO DE AGENDA ────────────────────────────────────────────────
  // Estos avisos NO llevan euros: su `importe` es lo que sí se sabe (horas libres, días, faltas), sin
  // símbolo de moneda porque `moneda:false`. Se respeta la regla de arriba —las cifras no se calculan
  // aquí, se ECHAN de lo que ya trajo el vigía—; las que no caben en `importe` viajan en `ref`, que es
  // exactamente lo que la regla permite. Ninguna frase propone enviar nada a nadie: DISA propone y el
  // dueño decide, y aquí ni siquiera hay a quién escribir.
  // PELDAÑO 8 · el detector del oficio de salud. Sin plantilla, la voz se degrada con honestidad
  // (usa el título y el motivo del vigía), pero la DECISIÓN quedaría genérica — «conviene revisar
  // este punto» — y aquí la decisión concreta es obvia: llamarle y cerrar la siguiente sesión.
  tratamiento_a_medias: {
    quePasa: (h, { importe, fecha }) => {
      const r = h.ref || {};
      return 'Le quedan ' + importe + (Number(h.cifra) === 1 ? ' sesión pagada' : ' sesiones pagadas')
        + ' del bono «' + (r.bono || 'suyo') + '» y no tiene ninguna cita puesta'
        + (r.caduca ? ', y el bono caduca el ' + fechaEs(r.caduca) : '') + '.';
    },
    decision: (h) => {
      const r = h.ref || {};
      return 'Conviene llamarle y cerrar la siguiente sesión: ya está pagada'
        + (r.caduca ? ', y si el bono caduca la pierde' : '') + '.';
    },
  },

  hueco_perdido: {
    quePasa: (h, { importe, fecha }) => {
      const pct = h.ref && h.ref.pct != null ? h.ref.pct : null;
      return pct == null
        ? `El ${fechaEs(fecha)} te quedan ${importe} horas libres en la agenda.`
        : `El ${fechaEs(fecha)} tu agenda está al ${pct}% y te quedan ${importe} horas libres.`;
    },
    decision: (h, { importe, fecha }) => {
      const tramos = h.ref && h.ref.tramos ? ` Libre: ${h.ref.tramos}.` : '';
      return `Conviene llenar el ${fechaEs(fecha)}: hay ${importe} horas sin reservar y ese día no se repite.${tramos}`;
    },
  },

  fuera_de_ritmo: {
    quePasa: (h, { importe, fecha }) => {
      const r = (h.ref && h.ref.ritmo_dias) || null;
      const base = r
        ? `Este cliente suele venir cada ${r} días y lleva ${importe} sin aparecer.`
        : `Este cliente lleva ${importe} días sin aparecer, más de lo que acostumbra.`;
      const serv = h.ref && h.ref.ultimo_servicio ? ` La última vez vino a ${h.ref.ultimo_servicio}.` : '';
      return base + ` Su última visita fue el ${fechaEs(fecha)}.` + serv;
    },
    decision: (h, { importe, fecha }) => {
      const r = (h.ref && h.ref.ritmo_dias) || null;
      return r
        ? `Conviene llamarle: viene cada ${r} días y ya lleva ${importe} desde el ${fechaEs(fecha)}.`
        : `Conviene llamarle: lleva ${importe} días desde su última visita, del ${fechaEs(fecha)}.`;
    },
  },

  sin_proxima_cita: {
    quePasa: (h, { fecha }) => {
      const serv = h.ref && h.ref.ultimo_servicio ? ` Vino a ${h.ref.ultimo_servicio}.` : '';
      return `Este cliente estuvo aquí el ${fechaEs(fecha)} y se fue sin dejar la siguiente cita.` + serv;
    },
    decision: (h, { fecha }) =>
      `Conviene proponerle día para la próxima: estuvo el ${fechaEs(fecha)} y no tiene ninguna cita puesta.`,
  },

  ausencias: {
    quePasa: (h, { importe, fecha }) => {
      const n = (h.ref && h.ref.faltas) || 0;
      return `Este cliente no se presentó ${importe} ${n === 1 ? 'vez' : 'veces'} en el último mes; la última, el ${fechaEs(fecha)}.`;
    },
    decision: (h, { fecha }) =>
      `Conviene confirmarle la cita antes de reservarle otra vez: la última falta fue el ${fechaEs(fecha)}.`,
  },
};

// ── VESTIR UN HALLAZGO ────────────────────────────────────────────────────────
// hallazgo → aviso. Función PURA: no lee BD, no escribe, no ejecuta. `sym` = símbolo de moneda (lo
// pasa la ruta). `hoy` = el día del barrido (res.hoy del vigía), solo para el tiempo verbal.
//   · encabezado — el `titulo` del vigía, VERBATIM (lleva el nombre; se escapa al pintar).
//   · quePasa    — parte (a): qué pasa + desde cuándo, en llano.
//   · decision   — parte (b): SIEMPRE una decisión concreta.
//   · porque     — el `motivo` del vigía, VERBATIM: el dato exacto y trazable (de X a Y, objetivo…).
// Si no hay plantilla para el detector (no debería), se degrada con honestidad usando titulo/motivo.
export function vestir(h, sym = '€', hoy = null) {
  const importe = cifraTexto(h, sym);
  const fecha = h.fecha ? fechaEs(h.fecha) : '—';
  const ctx = { importe, fecha, hoy, sym };
  const plantilla = PLANTILLAS[h.detector];

  const quePasa = plantilla ? plantilla.quePasa(h, ctx)
    : (h.titulo || 'Hay algo que conviene mirar.');
  const decision = plantilla ? plantilla.decision(h, ctx)
    : 'Conviene revisar este punto en su área.';

  return {
    area: h.area, areaEtiqueta: h.areaEtiqueta,
    detector: h.detector, detectorEtiqueta: h.detectorEtiqueta,
    encabezado: h.titulo,          // verbatim del vigía (nombre incluido) — escapar al pintar
    quePasa,                        // (a) — solo cifra/fecha/código
    decision,                       // (b) — siempre concreta, solo cifra/fecha/código
    porque: h.motivo || '',         // verbatim del vigía — el dato exacto y trazable
    cifra: h.cifra, moneda: h.moneda, fecha: h.fecha, ref: h.ref,   // passthrough para trazabilidad
  };
}

// ── NARRAR UN BARRIDO ─────────────────────────────────────────────────────────
// Toma la salida COMPLETA de `detectar()` (ya filtrada por permisos) y le añade `avisos` (la voz),
// conservando todo lo demás (`hallazgos`, `sinPermiso`, `umbrales`, contadores). La voz solo viste lo
// que el vigía entregó a ese usuario: si un área fue a `sinPermiso`, no hay hallazgo → no hay aviso.
export function narrar(resultado, sym = '€') {
  const hallazgos = (resultado && resultado.hallazgos) || [];
  const hoy = resultado && resultado.hoy;
  return { ...resultado, avisos: hallazgos.map(h => vestir(h, sym, hoy)) };
}
