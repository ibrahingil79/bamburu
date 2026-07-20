// ════════════════════════════════════════════════════════════════════════════
// EL VIGÍA — motor de detección. Escalera · paso 5 (DISA predictiva) · PIEZA 1.
//
// LA REGLA DE ORO (idéntica a la del constructor, constructor-analitica.js): el vigía NO hace
// sus propias cuentas. Recorre los motores de área YA EXISTENTES y VERIFICADOS y solo MARCA lo
// que cumple un umbral. La cifra de cada hallazgo se toma TAL CUAL del motor que la owna — el
// mismo que pinta la pantalla de esa área — así es IMPOSIBLE que el vigía dé un número que
// contradiga a Cobros, a Pagos, a Ventas o al Plan financiero.
//
// PERMISOS DESDE EL INICIO: cada detector exige EL PERMISO DE LA PANTALLA QUE POSEE SU CIFRA
// (verificado contra el `requirePerm` real de cada ruta):
//   · deuda vencida        → cobros.read      (openDebts = la pantalla de Cobros)
//   · cliente dormido      → clients.read     (clientesDormidos, dato de cliente)
//   · caída de facturación → invoices.read    (vía `cruzar` del área Ventas)
//   · caída de margen      → invoices.read    (vía `cruzar` del área Ventas)
//   · desvío del plan      → invoices.read    (planFinanciero: son cifras de venta y margen)
//   · pago que vence pronto→ purchases.read   (openPayables = la pantalla de Pagos)
// Un usuario solo genera hallazgos de las áreas que puede ver. El que fuerza un detector sin su
// permiso recibe 403 (ver `detectar` con `soloDetector`), y los detectores 3/4 pasan por
// `cruzar`, que revalida el permiso por dentro: no hay puerta trasera.
//
// READ-ONLY: solo lee. No escribe ni una fila. No persiste (se calcula en vivo, como los
// informes); si una pieza futura quiere guardar hallazgos, irá en una tabla `disa_*` FUERA de
// WRITABLE_TABLES — nunca aquí.
import { openDebts } from './cobros.js';                       // deuda vencida (pantalla de Cobros)
import { openPayables } from './pagos.js';                     // pagos pendientes con vencimiento
import { clientesDormidos } from './ventas-metrics.js';        // cliente que se duerme (ritmo aprendido)
import { cruzar } from './constructor-analitica.js';           // el motor del constructor (área Ventas)
import { planFinanciero } from './plan-financiero.js';         // objetivo vs. real
import { hoyLocal } from './avisos.js';                        // hoy en Europe/Madrid (no en UTC)

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const DIA = 86400000;
// Días naturales entre dos fechas ISO (a − b), en UTC para no saltar de zona.
const diasEntre = (a, b) => Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DIA);
// Mes natural anterior a una clave 'YYYY-MM' (aritmética de meses, sin Date → sin sorpresa de TZ).
function mesAnterior(k) {
  const [y, m] = String(k).split('-').map(Number);
  const idx = y * 12 + (m - 1) - 1;
  return Math.floor(idx / 12) + '-' + String(idx % 12 + 1).padStart(2, '0');
}

// ── UMBRALES — sensatos y FIJOS (esta pieza no trae pantalla de configuración; eso es un paso
// posterior). Viven aquí, juntos y con nombre, para que ajustarlos sea leer una línea — igual que
// los ajustables de `clientesDormidos`. El detector de dormidos NO tiene umbral propio aquí: su
// listón lo aprende el motor por cliente (su `umbral_dias`), y respetarlo es justo no inventar.
export const VENCIDA_DIAS_MIN       = 1;    // deuda: pendiente y pasada su fecha (≥1 día vencida)
export const CAIDA_FACTURACION_PCT  = 20;   // facturación del último mes completo cae ≥20% vs. el anterior
export const CAIDA_MARGEN_PCT       = 20;   // beneficio (margen) del último mes completo cae ≥20% vs. el anterior
export const DESVIO_PLAN_PCT        = 10;   // plan: lo real queda ≥10% por debajo del objetivo
export const PAGO_VENCE_DIAS        = 7;    // pago a proveedor que vence en ≤7 días (incluye ya vencidos)

// ── FORMA DE UN HALLAZGO ──────────────────────────────────────────────────────
// { area, areaEtiqueta, detector, detectorEtiqueta, titulo, cifra, moneda, fecha, motivo, ref }
//   · cifra   — el número, TAL CUAL del motor de área (sin recalcular). `moneda:true` → se pinta con €.
//   · fecha   — la fecha o periodo relevante (vencimiento, última compra, mes, clave del objetivo).
//   · motivo  — qué umbral/condición se cumplió (por qué se marca). Explicable: un aviso que no se
//               puede explicar se ignora.
//   · ref     — ids para el drill-down (a la ficha del cliente, a la factura, al proveedor).

// ── LOS DETECTORES ────────────────────────────────────────────────────────────
// Cada uno: metadatos + `correr(db, {hoy})` que devuelve la lista de hallazgos (ya ordenada por su
// propia gravedad). El permiso se comprueba FUERA (en `detectar`), no aquí: el detector supone que
// ya se le dejó correr.
export const DETECTORES = [
  {
    key: 'deuda_vencida', etiqueta: 'Deuda de cliente vencida',
    area: 'cobros', areaEtiqueta: 'Cobros', perm: 'cobros.read',
    correr(db, { hoy }) {
      // openDebts = LA MISMA fuente que la pantalla de Cobros (torre de control). Una fila por
      // factura con pendiente>0; nos quedamos con las VENCIDAS (estado 'vencida', ≥ umbral de días).
      return (openDebts(db, hoy).rows || [])
        .filter(r => r.estado === 'vencida' && (r.dias_vencida || 0) >= VENCIDA_DIAS_MIN && r.pendiente > 0.0049)
        .map(r => ({
          area: 'cobros', areaEtiqueta: 'Cobros',
          detector: 'deuda_vencida', detectorEtiqueta: 'Deuda de cliente vencida',
          titulo: 'Factura ' + (r.invoice_number || '#' + r.invoice_id) + ' de ' + (r.client_name || 'cliente') + ' vencida',
          cifra: r2(r.pendiente), moneda: true,
          fecha: r.due_date,
          motivo: 'Vencida hace ' + r.dias_vencida + ' día' + (r.dias_vencida === 1 ? '' : 's')
            + ' (tramo ' + (r.tramo || '—') + '); pendiente de cobro.',
          ref: { client_id: r.client_id, invoice_id: r.invoice_id, invoice_number: r.invoice_number },
        }));
    },
  },
  {
    key: 'cliente_dormido', etiqueta: 'Cliente que se duerme',
    area: 'clientes', areaEtiqueta: 'Clientes', perm: 'clients.read',
    correr(db, { hoy }) {
      // `clientesDormidos` ya aplica el ritmo aprendido de cada cliente y devuelve su `motivo`. No se
      // recalcula nada: se marca cada uno que el motor da por dormido. La "cifra" es cuántos días
      // lleva sin comprar (no es dinero) — el importe no es lo relevante aquí, el silencio sí.
      return clientesDormidos(db, hoy).map(d => ({
        area: 'clientes', areaEtiqueta: 'Clientes',
        detector: 'cliente_dormido', detectorEtiqueta: 'Cliente que se duerme',
        titulo: (d.client_name || 'Cliente #' + d.client_id) + ' lleva ' + d.dias_sin_comprar + ' días sin comprar',
        cifra: d.dias_sin_comprar, moneda: false,
        fecha: d.ultima_compra,
        motivo: 'Última compra el ' + d.ultima_compra + '. ' + d.motivo
          + '; se ha pasado ' + d.exceso + ' día' + (d.exceso === 1 ? '' : 's') + ' de su ritmo.',
        ref: { client_id: d.client_id },
      }));
    },
  },
  {
    key: 'caida_facturacion', etiqueta: 'Caída de facturación',
    area: 'ventas', areaEtiqueta: 'Ventas', perm: 'invoices.read',
    correr(db, { hoy, hasPerm }) {
      // La facturación por mes sale del MOTOR DEL CONSTRUCTOR (`cruzar`, área Ventas, medida `base` =
      // Facturado sin IVA): el MISMO número que "Construye tu gráfico" y que los informes. Comparamos
      // el ÚLTIMO MES COMPLETO con el mes natural anterior — nunca el mes en curso, que está a medias
      // y daría una "caída" falsa (criterio: no inventa).
      return caidaMensual(db, { hoy, hasPerm, medida: 'base', umbralPct: CAIDA_FACTURACION_PCT,
        area: 'ventas', areaEtiqueta: 'Ventas', detector: 'caida_facturacion',
        detectorEtiqueta: 'Caída de facturación', concepto: 'La facturación' });
    },
  },
  {
    key: 'caida_margen', etiqueta: 'Caída de margen',
    area: 'ventas', areaEtiqueta: 'Ventas', perm: 'invoices.read',
    correr(db, { hoy, hasPerm }) {
      // Mismo patrón, medida `beneficio` (margen = venta − coste congelado) del área Ventas. Si un mes
      // no tiene beneficio conocido (todo sin coste registrado → null) no se compara: no se inventa un
      // 0. La misma honestidad que Rentabilidad.
      return caidaMensual(db, { hoy, hasPerm, medida: 'beneficio', umbralPct: CAIDA_MARGEN_PCT,
        area: 'ventas', areaEtiqueta: 'Ventas', detector: 'caida_margen',
        detectorEtiqueta: 'Caída de margen', concepto: 'El margen (beneficio)' });
    },
  },
  {
    key: 'desvio_plan', etiqueta: 'Desvío del plan financiero',
    area: 'plan', areaEtiqueta: 'Plan financiero', perm: 'invoices.read',
    correr(db) {
      // planFinanciero YA compara objetivo vs. real (sin recalcular: el real sale de ventasPorPeriodo /
      // margenResumen). Marcamos las metas NO cumplidas que queden ≥ umbral por debajo. Solo lo que el
      // dueño fijó — si no hay metas, no hay hallazgos (un plan de ceros que nadie puso sería ruido).
      const TIPO = { facturacion: 'Facturación', beneficio: 'Beneficio' };
      return planFinanciero(db, {})
        .filter(f => !f.cumplido && f.desviacionPct != null && f.desviacionPct <= -DESVIO_PLAN_PCT)
        .map(f => ({
          area: 'plan', areaEtiqueta: 'Plan financiero',
          detector: 'desvio_plan', detectorEtiqueta: 'Desvío del plan financiero',
          titulo: (TIPO[f.tipo] || f.tipo) + ' ' + f.clave + ' · ' + f.responsable + ': por debajo del objetivo',
          cifra: r2(f.real), moneda: true,
          fecha: f.clave,
          motivo: 'Objetivo ' + r2(f.objetivo) + ', real ' + r2(f.real) + ' ('
            + f.desviacionPct.toFixed(1) + '% por debajo, ' + r2(f.desviacion) + ' de desviación).',
          ref: { objetivo_id: f.id, tipo: f.tipo, periodo: f.periodo, clave: f.clave, user_id: f.user_id },
        }))
        .sort((a, b) => a.cifra - b.cifra);   // los más cortos de objetivo (menor real) arriba
    },
  },
  {
    key: 'pago_vence_pronto', etiqueta: 'Pago a proveedor que vence pronto',
    area: 'compras', areaEtiqueta: 'Compras', perm: 'purchases.read',
    correr(db, { hoy }) {
      // openPayables = LA MISMA fuente que la pantalla de Pagos. Marcamos las deudas vivas (pendiente>0;
      // los abonos, con pendiente<0, quedan fuera) cuyo vencimiento cae en ≤ N días — incluye las ya
      // vencidas (días negativos): "vence pronto" y "venció ayer" piden lo mismo, pagar ya.
      return (openPayables(db, hoy).rows || [])
        .filter(r => r.pendiente > 0.0049 && r.due_date && diasEntre(r.due_date, hoy) <= PAGO_VENCE_DIAS)
        .map(r => {
          const dias = diasEntre(r.due_date, hoy);
          return {
            area: 'compras', areaEtiqueta: 'Compras',
            detector: 'pago_vence_pronto', detectorEtiqueta: 'Pago a proveedor que vence pronto',
            titulo: 'Factura ' + (r.internal_code || r.supplier_invoice_number || '#' + r.supplier_invoice_id)
              + ' de ' + (r.supplier_name || 'proveedor'),
            cifra: r2(r.pendiente), moneda: true,
            fecha: r.due_date,
            motivo: dias >= 0
              ? 'Vence en ' + dias + ' día' + (dias === 1 ? '' : 's') + ' (' + r.due_date + '); pendiente de pago.'
              : 'Vencida hace ' + (-dias) + ' día' + (dias === -1 ? '' : 's') + ' (' + r.due_date + '); pendiente de pago.',
            ref: { supplier_id: r.supplier_id, supplier_invoice_id: r.supplier_invoice_id, internal_code: r.internal_code },
          };
        })
        .sort((a, b) => diasEntre(a.fecha, hoy) - diasEntre(b.fecha, hoy));   // lo que antes vence, arriba
    },
  },
];

// Caída mes-a-mes de una medida del área Ventas, vía el motor del constructor. Devuelve 0 o 1
// hallazgo (el del último mes completo). Compartido por facturación y margen: la única diferencia es
// qué medida se mira, así que la regla vive UNA vez.
function caidaMensual(db, { hoy, hasPerm, medida, umbralPct, area, areaEtiqueta, detector, detectorEtiqueta, concepto }) {
  // El área Ventas exige invoices.read; `cruzar` lo revalida con `hasPerm` (defensa en profundidad).
  const filas = cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: [medida], periodo: 'mes',
    from: null, to: null, limit: 100000, hasPerm }).filas;
  const mesActual = String(hoy).slice(0, 7);
  const valor = new Map(filas.map(f => [f.clave, f[medida]]));
  // El último MES COMPLETO = la clave más alta anterior al mes en curso.
  const completos = filas.map(f => f.clave).filter(k => k < mesActual).sort();
  if (!completos.length) return [];
  const ultimo = completos[completos.length - 1];
  const anterior = mesAnterior(ultimo);
  const vUlt = valor.get(ultimo), vAnt = valor.get(anterior);
  // Hace falta un mes anterior con base positiva para hablar de "caída" (dividir por 0 o por null no
  // dice nada). Si el valor del último mes es null (p. ej. margen sin coste), tampoco se juzga.
  if (vAnt == null || vAnt <= 0 || vUlt == null) return [];
  const caidaPct = (vUlt - vAnt) / vAnt * 100;
  if (caidaPct > -umbralPct) return [];   // no cae lo bastante (o sube) → no es hallazgo
  return [{
    area, areaEtiqueta, detector, detectorEtiqueta,
    titulo: concepto + ' cayó ' + Math.abs(caidaPct).toFixed(1) + '% en ' + ultimo,
    cifra: r2(vUlt), moneda: true,
    fecha: ultimo,
    motivo: concepto + ' pasó de ' + r2(vAnt) + ' en ' + anterior + ' a ' + r2(vUlt) + ' en ' + ultimo
      + ' (' + caidaPct.toFixed(1) + '%). Comparados meses completos, sin el mes en curso.',
    ref: { mes: ultimo, mes_anterior: anterior, medida },
  }];
}

// ── EL BARRIDO ────────────────────────────────────────────────────────────────
// Recorre los detectores que el usuario PUEDE ver (según `hasPerm`) y junta sus hallazgos.
//   · hasPerm      — (perm) => bool. Sin él (uso interno/pruebas) corren todos.
//   · hoy          — ISO 'YYYY-MM-DD'; por defecto hoy en Europe/Madrid.
//   · soloDetector — clave de un detector para pedir solo ese; si el usuario no tiene su permiso,
//                    LANZA 403 (esto cubre el "403 al forzar" del criterio de permisos).
// Devuelve { generado, hoy, hallazgos, porDetector, sinPermiso, umbrales }. Los detectores sin
// permiso NO corren (no filtran su dato) y se listan en `sinPermiso` — se dice qué falta, no se
// deja un hueco mudo (la regla del resto de la Analítica).
export function detectar(db, { hasPerm = null, hoy = null, soloDetector = null } = {}) {
  const dia = hoy || hoyLocal();
  const puede = det => !hasPerm || hasPerm(det.perm);

  let lista = DETECTORES;
  if (soloDetector) {
    const det = DETECTORES.find(d => d.key === soloDetector);
    if (!det) { const e = new Error('No conozco el detector "' + soloDetector + '"'); e.status = 400; throw e; }
    if (!puede(det)) { const e = new Error('No tienes permiso para el detector ' + det.etiqueta.toLowerCase()); e.status = 403; throw e; }
    lista = [det];
  }

  const hallazgos = [], porDetector = {}, sinPermiso = [];
  for (const det of DETECTORES) {
    if (soloDetector && det.key !== soloDetector) continue;
    if (!puede(det)) { sinPermiso.push({ key: det.key, etiqueta: det.etiqueta, area: det.area, perm: det.perm }); continue; }
    const salida = det.correr(db, { hoy: dia, hasPerm }) || [];
    porDetector[det.key] = salida.length;
    for (const h of salida) hallazgos.push(h);
  }

  return { generado: new Date(Date.parse(dia + 'T00:00:00Z')).toISOString(), hoy: dia,
           total: hallazgos.length, hallazgos, porDetector, sinPermiso,
           umbrales: { VENCIDA_DIAS_MIN, CAIDA_FACTURACION_PCT, CAIDA_MARGEN_PCT, DESVIO_PLAN_PCT, PAGO_VENCE_DIAS } };
}

// Catálogo de detectores para la pantalla (sin datos): qué hay y qué permiso pide cada uno.
export function catalogoDetectores() {
  return DETECTORES.map(d => ({ key: d.key, etiqueta: d.etiqueta, area: d.area, areaEtiqueta: d.areaEtiqueta, perm: d.perm }));
}
