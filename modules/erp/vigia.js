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
// PELDAÑO 8 · PIEZA 3 — los cuatro detectores de agenda. El cálculo vive en su propio fichero (lee del
// motor de citas); aquí solo se registran y se les da su permiso, como a los seis de arriba.
import {
  huecosQueSePierden, clientesFueraDeRitmo, seFueSinProxima, ausenciasRecientes,
  clientesConRitmoDeCitas, OCUPACION_FLOJA_PCT, RITMO_FACTOR, RITMO_MIN_CITAS,
  SIN_PROXIMA_DIAS, AUSENCIA_DIAS, DIAS_VISTA,
} from './vigia-agenda.js';

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
    key: 'deuda_vencida', porCliente: true, etiqueta: 'Deuda de cliente vencida',
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
    key: 'cliente_dormido', porCliente: true, etiqueta: 'Cliente que se duerme',
    area: 'clientes', areaEtiqueta: 'Clientes', perm: 'clients.read',
    correr(db, { hoy }) {
      // `clientesDormidos` ya aplica el ritmo aprendido de cada cliente y devuelve su `motivo`. No se
      // recalcula nada: se marca cada uno que el motor da por dormido. La "cifra" es cuántos días
      // lleva sin comprar (no es dinero) — el importe no es lo relevante aquí, el silencio sí.
      //
      // PELDAÑO 8 · PIEZA 3 — LA CESIÓN DE JURISDICCIÓN. Este detector mide por FACTURAS; el nuevo
      // `fuera_de_ritmo` mide por CITAS ATENDIDAS. En un negocio de agenda que factura cada visita son
      // la misma persona y casi el mismo mensaje, y sus umbrales NI SIQUIERA COINCIDEN (aquí ×2 con
      // suelo de 30 días; allí ×1,5 sin suelo): el mismo cliente saldría dos veces diciendo cosas
      // distintas. Así que todo cliente con ritmo aprendible por citas queda bajo el detector de
      // citas —haya saltado o no—, y aquí se le retira. Que el motor de citas diga "va en su ritmo" y
      // este diga "está dormido" a la vez es peor que no avisar. Los clientes que compran sin pedir
      // cita (mostrador) no tienen historial de citas y siguen vigilados aquí, intactos.
      const mandaCitas = clientesConRitmoDeCitas(db);
      return clientesDormidos(db, hoy).filter(d => !mandaCitas.has(d.client_id)).map(d => ({
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

  // ══ PELDAÑO 8 · PIEZA 3 — EL VIGÍA APRENDE DE AGENDA ═══════════════════════════════════════════
  // Cuatro detectores que leen del MOTOR DE CITAS (citas-engine.js, vía vigia-agenda.js), el mismo que
  // pinta la agenda y la puerta pública. Todos exigen `citas.read` —el permiso de la pantalla que
  // posee el dato— así que quien no puede ver la agenda no los recibe: ni en la lista, ni en el
  // texto, ni en el Inicio, y 403 al forzar por URL. Es el mismo mecanismo de los seis de arriba: no
  // hay código de permisos nuevo.
  //
  // NINGUNO LLEVA IMPORTE EN EUROS, y es deliberado: un hueco libre no vale un número hasta que
  // alguien lo llena, y estimarlo sería inventarse dinero. Su `cifra` es lo que sí se sabe (horas
  // libres, días sin venir, faltas), con `moneda:false`.
  {
    key: 'hueco_perdido', etiqueta: 'Hueco que se va a perder',
    area: 'agenda', areaEtiqueta: 'Agenda', perm: 'citas.read',
    correr(db, { hoy }) {
      return huecosQueSePierden(db, hoy).map(h => ({
        area: 'agenda', areaEtiqueta: 'Agenda',
        detector: 'hueco_perdido', detectorEtiqueta: 'Hueco que se va a perder',
        titulo: 'El ' + h.fecha + ' tienes ' + h.horas_libres + ' h libres (ocupación ' + h.pct + '%)',
        cifra: h.horas_libres, moneda: false,
        fecha: h.fecha,
        motivo: 'Ese día abres ' + Math.round(h.abierto_min / 60 * 10) / 10 + ' h en total y solo hay '
          + h.pct + '% ocupado (umbral ' + OCUPACION_FLOJA_PCT + '%). Libre: ' + h.detalle + '.',
        ref: { fecha: h.fecha, horas_libres: h.horas_libres, pct: h.pct, dias_para: h.dias_para,
               tramos: h.detalle, personas: h.personas.length },
      }));
    },
  },
  {
    key: 'fuera_de_ritmo', porCliente: true, etiqueta: 'Cliente fuera de su ritmo',
    area: 'agenda', areaEtiqueta: 'Agenda', perm: 'citas.read',
    correr(db, { hoy }) {
      // El ritmo es SUYO: la mediana de días entre sus visitas atendidas. Con menos de 3 visitas no se
      // inventa ritmo y no hay aviso — un cliente nuevo que tarda tres semanas no es un cliente que se
      // va, es un cliente del que aún no se sabe nada.
      return clientesFueraDeRitmo(db, hoy).map(d => ({
        area: 'agenda', areaEtiqueta: 'Agenda',
        detector: 'fuera_de_ritmo', detectorEtiqueta: 'Cliente fuera de su ritmo',
        titulo: (d.client_name || 'Cliente #' + d.client_id) + ' lleva ' + d.dias_sin_venir + ' días sin venir',
        cifra: d.dias_sin_venir, moneda: false,
        fecha: d.ultima_visita,
        motivo: 'Suele venir cada ' + d.ritmo_dias + ' días (mediana de ' + d.visitas
          + ' visitas) y lleva ' + d.dias_sin_venir + '; el umbral es ×' + RITMO_FACTOR + ' = '
          + d.umbral_dias + ' días.' + (d.ultimo_servicio ? ' Última vez: ' + d.ultimo_servicio + '.' : ''),
        ref: { client_id: d.client_id, ritmo_dias: d.ritmo_dias, dias_sin_venir: d.dias_sin_venir,
               visitas: d.visitas, ultimo_servicio: d.ultimo_servicio, ultima_visita: d.ultima_visita },
      }));
    },
  },
  {
    key: 'sin_proxima_cita', porCliente: true, etiqueta: 'Se fue sin próxima cita',
    area: 'agenda', areaEtiqueta: 'Agenda', perm: 'citas.read',
    correr(db, { hoy }) {
      return seFueSinProxima(db, hoy).map(d => ({
        area: 'agenda', areaEtiqueta: 'Agenda',
        detector: 'sin_proxima_cita', detectorEtiqueta: 'Se fue sin próxima cita',
        titulo: (d.client_name || 'Cliente #' + d.client_id) + ' vino el ' + d.ultima_visita + ' y no dejó otra cita',
        cifra: d.dias_desde, moneda: false,
        fecha: d.ultima_visita,
        motivo: 'Atendido hace ' + d.dias_desde + ' día' + (d.dias_desde === 1 ? '' : 's')
          + ' (' + d.ultima_visita + ') y no tiene ninguna cita futura.'
          + (d.ultimo_servicio ? ' Última vez: ' + d.ultimo_servicio + '.' : ''),
        ref: { client_id: d.client_id, ultima_visita: d.ultima_visita, dias_desde: d.dias_desde,
               ultimo_servicio: d.ultimo_servicio },
      }));
    },
  },
  {
    key: 'ausencias', porCliente: true, etiqueta: 'Faltó a su cita',
    area: 'agenda', areaEtiqueta: 'Agenda', perm: 'citas.read',
    correr(db, { hoy }) {
      // El estado 'no_show' EXISTE en el motor (citas-engine.js · ESTADOS), con su etiqueta y su
      // transición: esto se LEE, no se deduce. Si no existiera, este detector no estaría aquí.
      return ausenciasRecientes(db, hoy).map(d => ({
        area: 'agenda', areaEtiqueta: 'Agenda',
        detector: 'ausencias', detectorEtiqueta: 'Faltó a su cita',
        titulo: (d.client_name || 'Cliente #' + d.client_id) + ' faltó ' + d.faltas + ' vez'
          + (d.faltas === 1 ? '' : 'ces') + ' en los últimos ' + AUSENCIA_DIAS + ' días',
        cifra: d.faltas, moneda: false,
        fecha: d.ultima_falta,
        motivo: 'Marcada' + (d.faltas === 1 ? '' : 's') + ' como "No se presentó" en la agenda; la última, el '
          + d.ultima_falta + ' (hace ' + d.dias_desde + ' día' + (d.dias_desde === 1 ? '' : 's') + ').',
        ref: { client_id: d.client_id, faltas: d.faltas, ultima_falta: d.ultima_falta, dias_desde: d.dias_desde },
      }));
    },
  },
  {
    // ── PELDAÑO 8 · EL AVISO DEL OFICIO DE SALUD ───────────────────────────────────────────────
    // TRATAMIENTO A MEDIAS: alguien pagó un bono de diez sesiones, lleva cuatro, y no tiene ninguna
    // cita futura. En una consulta de salud eso no es «un cliente dormido»: es un tratamiento sin
    // terminar, que es peor para el paciente y para el negocio — el dinero ya está cobrado, así que
    // el que se pierde es el resultado.
    //
    // POR QUÉ ES DISTINTO DE `sin_proxima_cita`, que ya existe: aquel mira a quien vino y no dejó
    // otra cita. Este mira a quien **tiene sesiones pagadas sin usar**. Un paciente puede tener una
    // cita futura y aun así estar a punto de dejarse cinco sesiones sin gastar si el bono caduca.
    // Y al revés: quien no volvió pero no tenía bono ya lo cuenta el otro. No se pisan.
    //
    // CRUZA DOS ÁREAS, así que pide LOS DOS permisos (`citas.read` y `invoices.read`): un aviso no
    // puede ser la rendija por la que se ve algo que su pantalla te niega.
    key: 'tratamiento_a_medias', porCliente: true, etiqueta: 'Tratamiento sin terminar',
    area: 'agenda', areaEtiqueta: 'Agenda', perm: 'citas.read', permExtra: 'invoices.read',
    correr(db, { hoy, hasPerm }) {
      if (hasPerm && !hasPerm('invoices.read')) return [];
      let filas = [];
      try {
        filas = db.prepare(
          `SELECT b.id, b.client_id, b.nombre, b.sesiones, b.usadas, b.caduca, c.name AS client_name,
                  (SELECT MAX(fecha) FROM bono_consumos bc WHERE bc.bono_id = b.id) AS ultima
             FROM bonos b JOIN clients c ON c.id = b.client_id
            WHERE b.activo = 1 AND b.usadas < b.sesiones
              AND (b.caduca IS NULL OR b.caduca >= ?)
              AND NOT EXISTS (SELECT 1 FROM citas ci WHERE ci.cliente_id = b.client_id
                              AND ci.archived = 0 AND ci.estado IN ('pedida','confirmada') AND ci.fecha >= ?)`
        ).all(hoy, hoy);
      } catch { return []; }                        // tenant sin bonos todavía
      const DIA = 86400000;
      return filas.map(b => {
        const quedan = Number(b.sesiones) - Number(b.usadas);
        const diasCaduca = b.caduca
          ? Math.round((Date.parse(b.caduca + 'T00:00:00Z') - Date.parse(hoy + 'T00:00:00Z')) / DIA) : null;
        return {
          area: 'agenda', areaEtiqueta: 'Agenda',
          detector: 'tratamiento_a_medias', detectorEtiqueta: 'Tratamiento sin terminar',
          // «sesión» + «es» da «sesiónes», que no existe. El plural pierde la tilde. Se escribe
          // entero cada forma en vez de pegar sufijos: es más largo y es lo que se lee bien.
          titulo: (b.client_name || 'Paciente #' + b.client_id) + ' tiene ' + quedan
            + (quedan === 1 ? ' sesión pagada' : ' sesiones pagadas') + ' sin usar y ninguna cita',
          cifra: quedan, moneda: false,
          fecha: b.ultima || null,
          motivo: 'Bono «' + b.nombre + '»: ' + b.usadas + ' de ' + b.sesiones + ' usadas'
            + (b.ultima ? ', la última el ' + b.ultima : ', ninguna todavía')
            + '. No tiene ninguna cita futura'
            + (diasCaduca != null ? ' y el bono caduca en ' + diasCaduca + ' día' + (diasCaduca === 1 ? '' : 's') : '') + '.',
          ref: { client_id: b.client_id, bono_id: b.id, bono: b.nombre, quedan,
                 usadas: b.usadas, sesiones: b.sesiones, caduca: b.caduca || null, ultima: b.ultima || null },
        };
      });
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
// Los detectores que PUEDEN señalar a un cliente concreto. Lo declara cada detector con
// `porCliente: true`, no una lista escrita aparte: si mañana nace uno nuevo, lo marca su autor y la
// ficha de cliente lo recoge sola. Sin esto, la ficha corría los diez detectores —análisis del
// negocio entero, unos 300 ms— para quedarse con los de UN cliente.
export const DETECTORES_POR_CLIENTE = DETECTORES.filter(d => d.porCliente).map(d => d.key);

// `soloCliente:true` corre SOLO los detectores que pueden referirse a un cliente. El resultado para
// ese cliente es EL MISMO —los demás detectores nunca ponen `ref.client_id`, así que la ficha los
// descartaba igual—, pero sin pagar el análisis del negocio entero.
export function detectar(db, { hasPerm = null, hoy = null, soloDetector = null, soloCliente = false } = {}) {
  const dia = hoy || hoyLocal();
  const puede = det => !hasPerm || hasPerm(det.perm);

  let lista = soloCliente ? DETECTORES.filter(d => d.porCliente) : DETECTORES;
  if (soloDetector) {
    const det = DETECTORES.find(d => d.key === soloDetector);
    if (!det) { const e = new Error('No conozco el detector "' + soloDetector + '"'); e.status = 400; throw e; }
    if (!puede(det)) { const e = new Error('No tienes permiso para el detector ' + det.etiqueta.toLowerCase()); e.status = 403; throw e; }
    lista = [det];
  }

  const hallazgos = [], porDetector = {}, sinPermiso = [];
  // Se recorre `lista`, NO `DETECTORES`: la variable existía y el bucle la ignoraba, así que pedir
  // un subconjunto no ahorraba nada — se ejecutaban los diez y se descartaba lo demás después.
  for (const det of lista) {
    if (!puede(det)) { sinPermiso.push({ key: det.key, etiqueta: det.etiqueta, area: det.area, perm: det.perm }); continue; }
    const salida = det.correr(db, { hoy: dia, hasPerm }) || [];
    porDetector[det.key] = salida.length;
    for (const h of salida) hallazgos.push(h);
  }

  return { generado: new Date(Date.parse(dia + 'T00:00:00Z')).toISOString(), hoy: dia,
           total: hallazgos.length, hallazgos, porDetector, sinPermiso,
           umbrales: { VENCIDA_DIAS_MIN, CAIDA_FACTURACION_PCT, CAIDA_MARGEN_PCT, DESVIO_PLAN_PCT, PAGO_VENCE_DIAS,
                       OCUPACION_FLOJA_PCT, DIAS_VISTA, RITMO_FACTOR, RITMO_MIN_CITAS, SIN_PROXIMA_DIAS, AUSENCIA_DIAS } };
}

// Catálogo de detectores para la pantalla (sin datos): qué hay y qué permiso pide cada uno.
export function catalogoDetectores() {
  return DETECTORES.map(d => ({ key: d.key, etiqueta: d.etiqueta, area: d.area, areaEtiqueta: d.areaEtiqueta, perm: d.perm }));
}
