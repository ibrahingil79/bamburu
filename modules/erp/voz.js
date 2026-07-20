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
// avisos.js. Formato idéntico al del resto de la app y al de la vista del vigía: `€232.75`.
const dinero = (n, sym) => (sym || '') + Number(n || 0).toFixed(2);

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
      `Tienes una factura de cliente sin cobrar por ${importe}. Venció el ${fecha} y sigue pendiente.`,
    decision: (h, { importe, fecha }) => {
      const fac = h.ref && h.ref.invoice_number ? `la factura ${h.ref.invoice_number}` : 'esta factura';
      return `Conviene reclamar el cobro de ${importe} de ${fac}, vencida desde el ${fecha}.`;
    },
  },

  cliente_dormido: {
    quePasa: (h, { importe, fecha }) =>
      `Un cliente que te compraba con regularidad lleva ${importe} días sin hacerlo. Su última compra fue el ${fecha}.`,
    decision: (h, { importe, fecha }) =>
      `Conviene retomar el contacto con este cliente: lleva ${importe} días en silencio desde su última compra, del ${fecha}.`,
  },

  caida_facturacion: {
    quePasa: (h, { importe, fecha }) =>
      `En ${fecha} tu facturación fue de ${importe}. Ha bajado respecto al mes anterior.`,
    decision: (h, { importe, fecha }) =>
      `La facturación ha caído respecto al mes anterior; en ${fecha} quedó en ${importe}. Conviene revisar a qué se debe.`,
  },

  caida_margen: {
    quePasa: (h, { importe, fecha }) =>
      `En ${fecha} tu margen (lo que ganas, no lo que facturas) fue de ${importe}. Ha bajado respecto al mes anterior.`,
    decision: (h, { importe, fecha }) =>
      `El margen ha caído respecto al mes anterior; en ${fecha} quedó en ${importe}. Conviene revisar precios o costes.`,
  },

  desvio_plan: {
    quePasa: (h, { importe, fecha }) =>
      `Vas por debajo del objetivo que te fijaste para ${fecha}. Lo real va por ${importe}.`,
    decision: (h, { importe, fecha }) =>
      `Vas por debajo del objetivo de ${fecha}: lo real suma ${importe}. Conviene ajustar el ritmo o revisar la previsión.`,
  },

  pago_vence_pronto: {
    quePasa: (h, { importe, fecha, hoy }) => {
      const vencido = h.fecha && hoy && diasEntre(h.fecha, hoy) < 0;
      return vencido
        ? `Tienes un pago a proveedor de ${importe} que venció el ${fecha} y sigue pendiente.`
        : `Tienes un pago a proveedor de ${importe} con vencimiento el ${fecha}.`;
    },
    decision: (h, { importe, fecha, hoy }) => {
      const fac = h.ref && h.ref.internal_code ? `la factura ${h.ref.internal_code}` : 'esta factura';
      const vencido = h.fecha && hoy && diasEntre(h.fecha, hoy) < 0;
      return vencido
        ? `Conviene pagar cuanto antes ${importe} de ${fac}: venció el ${fecha}.`
        : `Conviene tener saldo o programar el pago de ${importe} de ${fac}, que vence el ${fecha}.`;
    },
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
  const fecha = h.fecha || '—';
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
