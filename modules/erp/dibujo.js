// ════════════════════════════════════════════════════════════════════════════
// EL DIBUJO — receta de gráfico de apoyo por aviso. Escalera · paso 5 (DISA predictiva) · PIEZA 3.
//
// QUÉ HACE: por cada hallazgo del vigía (PIEZA 1) devuelve una RECETA fija para el MOTOR DEL
// CONSTRUCTOR (`cruzar`), de modo que su aviso (PIEZA 2) lleve un gráfico de apoyo. NO dibuja aquí ni
// calcula ninguna cifra: solo elige {área, cruce, medida, tipo de gráfico, filtro} y el motor del
// constructor hace el resto — el MISMO que pinta "Construye tu gráfico" y los informes. Así es
// IMPOSIBLE que el gráfico dé una cifra distinta de la del constructor hecho a mano.
//
// EXPRESABILIDAD (ver PASO 0). ⚙️ ACTUALIZADO EL 23 AGO 2026 (ficha D): antes esto decía «solo caída
// de facturación y de margen son EXACTAS» y hablaba de «las otras cuatro». Ya no: los detectores son
// DIEZ y las EXACTAS son TRES — caída de facturación, caída de margen y **hueco que se va a perder**,
// que entra en esta lista porque su cifra y la medida `horas_libres` del constructor salen de las
// mismas dos primitivas del motor de citas. Las demás son el gráfico expresable MÁS CERCANO, con su
// hueco anotado en `gap` — NO se inventa un render:
//   · deuda vencida  → facturación mensual del deudor (el constructor no tiene área de cobros/antigüedad)
//   · cliente dormido→ facturación mensual del cliente (se ve el desplome)
//   · desvío del plan→ la serie REAL por periodo (el constructor no tiene medida "objetivo")
//   · pago próximo   → pendiente por proveedor (el constructor no tiene dimensión "vencimiento")
//   · los tres de agenda por cliente (fuera de ritmo · sin próxima cita · ausencias) → su ritmo de
//     citas filtrado por él; el hueco es que el filtro añade el permiso de Clientes al de Agenda
//
// PERMISOS heredados: la receta se la come `cruzar`, que revalida el permiso del área (403 si falta).
// El dibujo NO reabre nada. Para el filtro por cliente se resuelve `client_id → nombre` (un rótulo, NO
// una cifra: la cifra la sigue dando el motor); el nombre ya es visible en el aviso, así que no filtra
// nada nuevo. Solo lectura: no escribe.
//
// SIN MOTOR NUEVO: aquí no hay Chart.js ni SVG. Esto solo compone la receta; el render lo hace el
// motor del constructor (Chart.js + `cruzar`), reutilizado por `public/js/grafico-constructor.js`.
import { AREAS } from './constructor-analitica.js';

// Meta de una medida (etiqueta/dinero/pct) tomada del catálogo REAL del constructor — no se inventa.
function metaMedida(area, medida) {
  const m = AREAS[area]?.medidas?.[medida];
  return m ? { etiqueta: m.etiqueta, dinero: !!m.dinero, pct: !!m.pct } : { etiqueta: medida, dinero: false, pct: false };
}

// periodo válido para `cruzar` (el plan puede venir por mes/trimestre/año).
const PERIODOS = new Set(['mes', 'trimestre', 'año', 'anio', 'ano']);
const periodoValido = p => (PERIODOS.has(p) ? (p === 'anio' || p === 'ano' ? 'año' : p) : 'mes');

// Construye una receta con su medida/meta/tipo y explicación. `filtros` opcional.
function receta(area, dimension, medida, grafico, { periodo = 'mes', filtros = null, explica = '', gap = null } = {}) {
  const r = { area, dimension, medidas: [medida], periodo, grafico };
  if (filtros) r.filtros = filtros;
  return { receta: r, medida, meta: metaMedida(area, medida), grafico, explica, gap };
}

// ── RECETA POR DETECTOR ───────────────────────────────────────────────────────
// Cada una recibe (h, { nombreCliente, nombreProveedor }) donde los `nombre*` resuelven el rótulo del
// filtro desde `ref` (solo lectura). Devuelve el objeto de gráfico, o uno "sin gráfico" (con `gap`) si
// no se puede componer una receta honesta (p. ej. no se pudo resolver el nombre para el filtro).
const sinGrafico = gap => ({ receta: null, medida: null, meta: null, grafico: null, explica: null, gap });

// ⚙️ PELDAÑO 8 · PIEZA 3 decía aquí que los cuatro avisos de agenda iban SIN GRÁFICO, con el cartel
// «el constructor todavía no tiene un área de agenda». **Eso dejó de ser cierto el 23 ago 2026**
// (ficha D · parte 1): el área de Agenda existe, y con ella los cuatro tienen su gráfico por la MISMA
// vía que los otros seis — una receta para `cruzar`, sin motor nuevo y sin una sola cifra calculada
// aquí. El cartel se retira porque ya no describe nada.
//
// EL DE HUECO PERDIDO ES EXACTO, no aproximado: su cifra sale de `ocupacionDia` y la medida
// `horas_libres` del constructor se calcula con las MISMAS dos primitivas del motor de citas
// (`tramosPersona` + `ocupacionPersona`), así que el gráfico no puede decir otra cosa que el aviso.
// Los otros tres pintan el RITMO DE CITAS del cliente, filtrado por él: es lo que hace visible «lleva
// 40 días sin venir» o «faltó dos veces». Su `gap` avisa de que el filtro por cliente añade el
// permiso de Clientes al de Agenda, igual que ya hacen los avisos de cliente dormido y deuda vencida.
export const RECETAS = {
  hueco_perdido: () =>
    receta('agenda', 'fecha', 'horas_libres', 'lineas', {
      periodo: 'mes',
      explica: 'Tus horas libres por meses: se ve si el hueco de este día es un caso suelto o la tónica.',
    }),

  fuera_de_ritmo: (h, { nombreCliente } = {}) => {
    if (!nombreCliente) return sinGrafico('No se pudo identificar al cliente para el gráfico.');
    return receta('agenda', 'fecha', 'citas', 'lineas', {
      periodo: 'mes',
      filtros: { cliente: [nombreCliente] },
      explica: 'Las citas de este cliente por meses: se ve cuándo se le fue el ritmo.',
      gap: 'El filtro por cliente hace que el gráfico necesite permiso de Clientes además del de Agenda.',
    });
  },

  sin_proxima_cita: (h, { nombreCliente } = {}) => {
    if (!nombreCliente) return sinGrafico('No se pudo identificar al cliente para el gráfico.');
    return receta('agenda', 'fecha', 'citas', 'lineas', {
      periodo: 'mes',
      filtros: { cliente: [nombreCliente] },
      explica: 'Las citas de este cliente por meses: la última visita es donde se corta la línea.',
      gap: 'El filtro por cliente hace que el gráfico necesite permiso de Clientes además del de Agenda.',
    });
  },

  ausencias: (h, { nombreCliente } = {}) => {
    if (!nombreCliente) return sinGrafico('No se pudo identificar al cliente para el gráfico.');
    return receta('agenda', 'fecha', 'ausencias', 'barras', {
      periodo: 'mes',
      filtros: { cliente: [nombreCliente] },
      explica: 'Las veces que este cliente no se presentó, por meses.',
      gap: 'El filtro por cliente hace que el gráfico necesite permiso de Clientes además del de Agenda.',
    });
  },

  caida_facturacion: (h) =>
    receta('ventas', 'fecha', 'base', 'lineas', {
      periodo: 'mes',
      explica: 'Tu facturación por meses: la caída se ve en la línea.',
    }),

  caida_margen: (h) =>
    receta('ventas', 'fecha', 'beneficio', 'lineas', {
      periodo: 'mes',
      explica: 'Tu margen (beneficio) por meses: la caída se ve en la línea.',
    }),

  desvio_plan: (h) => {
    const medida = h.ref && h.ref.tipo === 'beneficio' ? 'beneficio' : 'base';
    return receta('ventas', 'fecha', medida, 'lineas', {
      periodo: periodoValido(h.ref && h.ref.periodo),
      explica: 'Lo REAL por periodo (la serie que el plan compara contra tu objetivo).',
      gap: 'El constructor no tiene una medida de "objetivo": el gráfico muestra solo lo real, sin superponer la línea del objetivo.',
    });
  },

  pago_vence_pronto: (h) =>
    receta('compras', 'proveedor', 'pendiente', 'barras', {
      explica: 'Pendiente de pago por proveedor (este proveedor resalta entre los demás).',
      gap: 'El constructor no tiene una dimensión de "vencimiento": el gráfico muestra el pendiente por proveedor, no por fecha de vencimiento.',
    }),

  cliente_dormido: (h, { nombreCliente } = {}) => {
    if (!nombreCliente) return sinGrafico('No se pudo identificar al cliente para el gráfico.');
    return receta('ventas', 'fecha', 'base', 'lineas', {
      periodo: 'mes',
      filtros: { cliente: [nombreCliente] },
      explica: 'Facturación mensual de este cliente: se ve cuándo dejó de comprarte.',
      gap: 'El gráfico usa el área de Ventas: necesita permiso de Ventas (invoices) además del de Clientes.',
    });
  },

  deuda_vencida: (h, { nombreCliente } = {}) => {
    if (!nombreCliente) return sinGrafico('No se pudo identificar al cliente para el gráfico.');
    return receta('ventas', 'fecha', 'base', 'lineas', {
      periodo: 'mes',
      filtros: { cliente: [nombreCliente] },
      explica: 'Facturación mensual de este cliente (contexto de la deuda).',
      gap: 'El constructor no tiene un área de cobros: no puede pintar las facturas vencidas por antigüedad. Se muestra la facturación del cliente, que sí sale del constructor. Necesita permiso de Ventas y Clientes.',
    });
  },
};

// hallazgo → objeto de gráfico { receta, medida, meta, grafico, explica, gap }. `resolvers` provee los
// nombres para los filtros (inyectados por la ruta, que es quien tiene la BD). Nunca lanza: si no hay
// receta para el detector (no debería), devuelve "sin gráfico" con su motivo.
export function graficoDe(h, resolvers = {}) {
  const fn = RECETAS[h.detector];
  if (!fn) return sinGrafico('No hay gráfico de apoyo definido para este tipo de aviso.');
  const nombreCliente = resolvers.nombreCliente && h.ref && h.ref.client_id != null
    ? resolvers.nombreCliente(h.ref.client_id) : null;
  const nombreProveedor = resolvers.nombreProveedor && h.ref && h.ref.supplier_id != null
    ? resolvers.nombreProveedor(h.ref.supplier_id) : null;
  return fn(h, { nombreCliente, nombreProveedor });
}
