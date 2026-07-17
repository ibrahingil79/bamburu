// ════════════════════════════════════════════════════════════════════════════
// FUENTE ÚNICA de métricas de VENTAS (Pilar 4 · PIEZA C). Las ventas se cuentan desde
// las FACTURAS (todas las series: F ordinaria, S simplificada/ticket, R rectificativa;
// tipos F1/F2/F3), NO desde el clúster viejo `sales_orders`. La regla de "qué documento
// cuenta como venta real" es EXACTAMENTE la de cobros.js (`countsAsReceivable`):
//   · factura anulada → NO cuenta.
//   · ticket (simplificada) SUSTITUIDO por una factura completa → NO cuenta (su F3 la reemplaza).
//   · factura rectificada por SUSTITUCIÓN → NO cuenta (la rectificativa lleva el importe completo).
//   · rectificativas / abonos → NETEAN (un total negativo resta).
// Una sola fuente → dashboard, analítica, contexto de DISA e historial de cliente comparten
// el MISMO criterio (no se duplica la regla con matices distintos). Solo LEE; no escribe nada.
import { countsAsReceivable } from './cobros.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const daysAgoISO = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

// Facturas que cuentan como venta real (clasificación de cobros), con filtro de fecha
// opcional sobre issue_date. Es la base de todas las cifras de abajo.
export function countingSalesInvoices(db, { from = null, to = null } = {}) {
  const where = [], params = [];
  if (from) { where.push('issue_date >= ?'); params.push(from); }
  if (to)   { where.push('issue_date <= ?'); params.push(to); }
  const sql = 'SELECT * FROM invoices' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY issue_date, id';
  return db.prepare(sql).all(...params).filter(inv => countsAsReceivable(db, inv));
}

// Resumen de ventas: total FACTURADO (con IVA — titular de KPI), base imponible, IVA y nº de
// documentos (para el ticket medio). Las rectificativas/abonos netean por su total.
export function ventasResumen(db, opts = {}) {
  let base = 0, iva = 0, total = 0, count = 0;
  for (const i of countingSalesInvoices(db, opts)) {
    base += Number(i.subtotal) || 0; iva += Number(i.tax_amount) || 0; total += Number(i.total) || 0; count++;
  }
  return { count, base: r2(base), iva: r2(iva), total: r2(total) };
}

// Productos más vendidos desde las líneas de las facturas que cuentan (agrupado por descripción;
// invoice_items no guarda product_id). Las líneas de un abono restan. [{product_name,total_qty,total_val}].
export function topProductos(db, { from = null, to = null, limit = 10 } = {}) {
  const ids = countingSalesInvoices(db, { from, to }).map(i => i.id);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.prepare(
    `SELECT description AS product_name, SUM(quantity) AS total_qty, ROUND(SUM(total_price),2) AS total_val
       FROM invoice_items WHERE invoice_id IN (${ph})
      GROUP BY description ORDER BY total_val DESC LIMIT ?`
  ).all(...ids, limit);
}

// ── ESCALERA · PASO 2 — MARGEN ───────────────────────────────────────────────
// Cuánto GANA el negocio, no cuánto factura. Vive aquí porque las ventas se cuentan aquí: el margen
// usa EXACTAMENTE el mismo conjunto de facturas (`countingSalesInvoices`) que el resto de cifras, así
// que el ingreso del informe de rentabilidad y el de la home NO pueden discrepar.
//
// LAS TRES REGLAS QUE LO SOSTIENEN:
//  1. **El IVA se queda fuera, siempre.** Se opera sobre `total_price`, que es la BASE de la línea
//     (qty × precio neto; el IVA vive aparte en `tax_amount`). El IVA no es tuyo: es de Hacienda.
//     Meterlo inflaría el margen con dinero que vas a devolver.
//  2. **El coste es el CONGELADO en la línea** (`unit_cost`), no el WAC de hoy. Si leyéramos el WAC
//     vivo, el margen de enero cambiaría porque en marzo compraste más caro.
//  3. **Sin coste registrado ≠ margen del 100%.** `unit_cost IS NULL` (servicio, digital, línea libre
//     o físico nunca comprado) significa "no lo sé", no "me costó 0". Esas líneas NO entran en el
//     beneficio: se apartan y se enseñan, para que el total no mienta. Es la diferencia entre un
//     informe útil y uno bonito.
//
// Los abonos NETEAN solos: su línea lleva cantidad negativa, así que ingreso y coste restan a la vez.
const lineasDeVenta = (db, opts = {}) => {
  const ids = countingSalesInvoices(db, opts).map(i => i.id);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.prepare(
    `SELECT ii.description, ii.quantity, ii.total_price, ii.product_id, ii.unit_cost, ii.cost_source
       FROM invoice_items ii WHERE ii.invoice_id IN (${ph})`
  ).all(...ids);
};

// Rentabilidad del periodo. `sinCoste*` es la parte que NO se puede juzgar; `margenPct` se calcula
// SOLO sobre lo que sí tiene coste (`ingresosConCoste`), nunca sobre el total — dividir el beneficio
// entre todos los ingresos, incluidos los que no tienen coste, hundiría el margen con una división
// sobre algo que no participó.
export function margenResumen(db, opts = {}) {
  let ingresos = 0, ingresosConCoste = 0, coste = 0, sinCoste = 0, nConCoste = 0, nSinCoste = 0, nAprox = 0;
  for (const l of lineasDeVenta(db, opts)) {
    const base = Number(l.total_price) || 0;
    ingresos += base;
    if (l.unit_cost == null) { sinCoste += base; nSinCoste++; continue; }
    ingresosConCoste += base;
    coste += (Number(l.unit_cost) || 0) * (Number(l.quantity) || 0);
    nConCoste++;
    if (l.cost_source === 'backfill') nAprox++;
  }
  const beneficio = ingresosConCoste - coste;
  return {
    ingresos: r2(ingresos),                       // base sin IVA de TODO lo vendido
    ingresosConCoste: r2(ingresosConCoste),       // la parte que sí se puede juzgar
    coste: r2(coste),
    beneficio: r2(beneficio),
    margenPct: ingresosConCoste ? r2(beneficio / ingresosConCoste * 100) : null,
    sinCoste: r2(sinCoste),                       // ventas sin coste conocido (NO son beneficio)
    sinCostePct: ingresos ? r2(sinCoste / ingresos * 100) : 0,
    lineas: nConCoste + nSinCoste, lineasConCoste: nConCoste, lineasSinCoste: nSinCoste,
    lineasAproximadas: nAprox,                    // coste de backfill (WAC de hoy), no congelado
  };
}

// Desglose por producto. Agrupa por `product_id` cuando lo hay y cae a la DESCRIPCIÓN cuando no
// (líneas libres, y las históricas que el backfill no pudo casar) — así ninguna venta desaparece del
// informe por no tener catálogo detrás. `margenPct` es null si esa fila no tiene coste: null se pinta
// como "—", que dice la verdad; un 0 diría que no ganas nada, y un 100 que es todo beneficio.
export function margenPorProducto(db, { from = null, to = null, limit = 100 } = {}) {
  const map = new Map();
  for (const l of lineasDeVenta(db, { from, to })) {
    const key = l.product_id ? 'p' + l.product_id : 'd' + l.description;
    const e = map.get(key) || { product_name: l.description, product_id: l.product_id || null,
                                qty: 0, ingresos: 0, coste: 0, ingresosConCoste: 0, sinCoste: 0, aproximado: false };
    const base = Number(l.total_price) || 0;
    e.qty += Number(l.quantity) || 0;
    e.ingresos += base;
    if (l.unit_cost == null) e.sinCoste += base;
    else {
      e.ingresosConCoste += base;
      e.coste += (Number(l.unit_cost) || 0) * (Number(l.quantity) || 0);
      if (l.cost_source === 'backfill') e.aproximado = true;
    }
    map.set(key, e);
  }
  return [...map.values()].map(e => {
    const beneficio = e.ingresosConCoste - e.coste;
    const tiene = e.ingresosConCoste !== 0;
    return { product_name: e.product_name, product_id: e.product_id, qty: r2(e.qty),
             ingresos: r2(e.ingresos), coste: tiene ? r2(e.coste) : null,
             beneficio: tiene ? r2(beneficio) : null,
             margenPct: tiene ? r2(beneficio / e.ingresosConCoste * 100) : null,
             sinCoste: r2(e.sinCoste), aproximado: e.aproximado };
  }).sort((a, b) => b.ingresos - a.ingresos).slice(0, limit);
}

// Ventas por DÍA (últimos N días) — total con IVA. Para el gráfico de analítica.
export function ventasPorDia(db, days = 30) {
  const map = new Map();
  for (const i of countingSalesInvoices(db, { from: daysAgoISO(days - 1) })) {
    const d = String(i.issue_date).slice(0, 10);
    const e = map.get(d) || { date: d, total: 0, orders: 0 };
    e.total += Number(i.total) || 0; e.orders++;
    map.set(d, e);
  }
  return [...map.values()].map(e => ({ ...e, total: r2(e.total) })).sort((a, b) => a.date < b.date ? -1 : 1);
}

// Ventas por MES (últimos N meses) — para el contexto de DISA en la página de analítica.
export function ventasPorMes(db, months = 3) {
  const map = new Map();
  for (const i of countingSalesInvoices(db, { from: daysAgoISO(months * 31) })) {
    const m = String(i.issue_date).slice(0, 7);
    const e = map.get(m) || { month: m, revenue: 0, orders: 0 };
    e.revenue += Number(i.total) || 0; e.orders++;
    map.set(m, e);
  }
  return [...map.values()].map(e => ({ ...e, revenue: r2(e.revenue) })).sort((a, b) => a.month < b.month ? 1 : -1);
}

// Filas para el CSV de ventas: una por línea de las facturas que cuentan.
export function ventasCsvRows(db) {
  const items = db.prepare('SELECT description, quantity, unit_price, total_price FROM invoice_items WHERE invoice_id=? ORDER BY id');
  const cli = db.prepare('SELECT name FROM clients WHERE id=?');
  const out = [];
  for (const i of countingSalesInvoices(db, {})) {
    const client = i.client_id ? (cli.get(i.client_id)?.name || i.client_name || '') : (i.client_name || '');
    for (const it of items.all(i.id)) {
      out.push({ invoice_number: i.invoice_number, issue_date: i.issue_date, status: i.status, series: i.series, client, product_name: it.description, quantity: it.quantity, unit_price: it.unit_price, total: it.total_price });
    }
  }
  return out;
}

// Historial de FACTURAS de un cliente (incluye anuladas, marcadas por su status). Shape
// compatible con la ficha de cliente: {order_number, total, status, created_at}.
export function clientVentas(db, clientId) {
  return db.prepare(
    'SELECT invoice_number AS order_number, total, status, issue_date AS created_at FROM invoices WHERE client_id=? ORDER BY id DESC'
  ).all(clientId);
}

// Últimas facturas (documentos recientes) — para el contexto de DISA.
export function ultimasFacturas(db, limit = 5) {
  return db.prepare('SELECT id, invoice_number, total, status, series FROM invoices ORDER BY id DESC LIMIT ?').all(limit);
}

// Clientes activos SIN ninguna factura que cuente en los últimos N días (inactivos). El "último
// documento" del cliente es su última factura, no un pedido viejo.
export function clientesInactivos(db, days = 30) {
  const from = daysAgoISO(days);
  let count = 0;
  for (const cl of db.prepare('SELECT id FROM clients WHERE active=1').all()) {
    const recent = db.prepare('SELECT * FROM invoices WHERE client_id=? AND issue_date >= ?').all(cl.id, from);
    if (!recent.some(inv => countsAsReceivable(db, inv))) count++;
  }
  return count;
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENTES DORMIDOS — el que te compraba y dejó de hacerlo.
//
// `clientesInactivos` (arriba) responde "¿cuántos?" con un listón fijo. Esto responde "¿QUIÉN, y por
// qué lo sé?", y no usa un listón fijo para todos: **aprende el ritmo de cada cliente**. Un cliente
// que te compra cada semana lleva dormido a los 30 días; uno que te compra cada trimestre, no. Medir
// a los dos con la misma vara es lo que convierte un aviso útil en ruido que se ignora.
//
// LA REGLA
//   · Con 2+ compras: se mira el hueco MEDIANO entre compras consecutivas (la mediana, no la media:
//     una compra rara no debe torcer el ritmo de todo un año) y se le da un margen de FACTOR_RITMO.
//     Con un SUELO de DIAS_SUELO, para no dar la alarma porque un cliente muy frecuente llegue tarde
//     cuatro días.
//   · Con 1 sola compra: no hay ritmo que aprender. Listón fijo de DIAS_UNA_COMPRA.
//   · El que NUNCA compró no es un cliente dormido: es un cliente que nunca despertó. Otra
//     conversación, y otra propuesta. Aquí NO entra.
//
// LO QUE NO CUENTA, Y POR QUÉ IMPORTA
//   Una venta de mostrador SIN cliente (factura simplificada, `client_id` NULL — hoy son 35 de 72 en
//   el negocio de desarrollo) no es de nadie: no puede hacer que ningún cliente parezca dormido. Aquí
//   eso no se arregla con un filtro, se cae solo: se agrupa POR client_id, así que una venta sin
//   cliente no entra en el cómputo de ningún cliente. Y una de mostrador CON cliente sí cuenta, que es
//   justo lo que debe pasar.
//   Lo que cuenta como venta lo decide `countsAsReceivable` — la MISMA regla que cobros y que el resto
//   de métricas (anuladas fuera, tickets sustituidos fuera, rectificativas por sustitución fuera). No
//   se reinventa aquí: un cliente al que le anulaste la única factura no "compró".
//
// AJUSTABLES. Son los tres números del encargo. Viven aquí, juntos y con nombre, para que cambiarlos
// sea leer una línea. Si algún día se quieren por-negocio, el patrón está hecho: una columna en
// `company_config` + su campo en Ajustes, como `dias_recordatorio_impago` y `dias_aviso_pago`.
export const FACTOR_RITMO   = 2;    // margen sobre el hueco mediano del cliente
export const DIAS_SUELO     = 30;   // por debajo de esto NUNCA se considera dormido (2+ compras)
export const DIAS_UNA_COMPRA = 90;  // listón de respaldo para el que solo compró una vez

const DIA = 86400000;
const diasEntreISO = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DIA);

// Mediana de una lista de números (no la media: robusta a la compra rara que dispara el promedio).
function mediana(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// El umbral de ESTE cliente, con la razón por la que es ese. La razón se devuelve porque el panel la
// enseña: una propuesta que no puede explicarse no se aprueba, se ignora.
//
// SE MIDE EN DÍAS DE COMPRA, NO EN FACTURAS. Lo aprendí por las malas con un cliente real: tenía tres
// facturas del MISMO día (una visita, tres documentos), y contando facturas salían "dos huecos de 0
// días" → ritmo 0 → se le daba por dormido a los 30 días, con la explicación indefendible de que
// "compra cada 0 días". Tres facturas de una misma visita son UNA compra, no tres compras separadas
// por nada. Se agrupan por día, y con un solo día de compra no hay ritmo que aprender: respaldo fijo.
export function umbralDormido(compras, opts = {}) {
  const factor = opts.factor ?? FACTOR_RITMO;
  const suelo = opts.suelo ?? DIAS_SUELO;
  const unaCompra = opts.unaCompra ?? DIAS_UNA_COMPRA;

  // Días DISTINTOS en los que compró, en orden. Varias facturas del mismo día cuentan como una.
  const dias = [...new Set(compras.map(c => String(c).slice(0, 10)))].sort();

  if (dias.length < 2) {
    return {
      umbral: unaCompra, ritmo: null, dias_compra: dias.length,
      motivo: (compras.length > 1
        ? 'compró una sola vez (' + compras.length + ' facturas del mismo día)'
        : 'una sola compra')
        + ': sin ritmo que aprender, listón de respaldo de ' + unaCompra + ' días',
    };
  }
  const huecos = [];
  for (let i = 1; i < dias.length; i++) huecos.push(diasEntreISO(dias[i], dias[i - 1]));
  const ritmo = mediana(huecos);
  const umbral = Math.max(Math.round(ritmo * factor), suelo);
  const mandaElSuelo = Math.round(ritmo * factor) < suelo;
  return {
    umbral, ritmo, dias_compra: dias.length,
    motivo: 'compra cada ' + Math.round(ritmo) + ' días de media; el umbral es ×' + factor
      + (mandaElSuelo ? ' (con el suelo de ' + suelo + ' días)' : ''),
  };
}

// Los clientes dormidos HOY, con su ritmo y sus días. Ordenados por los que más se han pasado.
// `today` para poder fijar el día en las pruebas.
export function clientesDormidos(db, today = null, opts = {}) {
  const hoy = today || new Date().toISOString().slice(0, 10);
  const out = [];

  // Solo clientes ACTIVOS. Uno archivado no se "reengancha": se archivó por algo.
  for (const cl of db.prepare('SELECT id, name, email FROM clients WHERE active=1 ORDER BY id').all()) {
    // Sus ventas ATRIBUIDAS, por la regla canónica. Sin cliente → no llega aquí (se agrupa por id).
    const facturas = db.prepare(
      'SELECT * FROM invoices WHERE client_id=? ORDER BY issue_date, id'
    ).all(cl.id).filter(inv => countsAsReceivable(db, inv));

    if (!facturas.length) continue;              // NUNCA compró → no es dormido, es otra conversación

    const compras = facturas.map(f => String(f.issue_date).slice(0, 10));
    const ultima = compras[compras.length - 1];
    const dias = diasEntreISO(hoy, ultima);
    if (dias < 0) continue;                      // factura con fecha futura: no es asunto de esto

    const { umbral, ritmo, motivo } = umbralDormido(compras, opts);
    if (dias <= umbral) continue;                // sigue dentro de su ritmo: NO está dormido

    out.push({
      client_id: cl.id, client_name: cl.name, client_email: cl.email || null,
      ultima_compra: ultima, dias_sin_comprar: dias,
      compras: compras.length, ritmo_dias: ritmo, umbral_dias: umbral, motivo,
      // Cuánto se ha pasado de SU ritmo: es lo que ordena la lista (no los días en bruto, que
      // favorecerían siempre al cliente trimestral sobre el semanal que lleva un mes desaparecido).
      exceso: dias - umbral,
    });
  }
  return out.sort((a, b) => b.exceso - a.exceso);
}

// ── Pedidos (cadena nueva: customer_orders) ──────────────────────────────────
// Alineado con la PIEZA 2a: "pedido pendiente de entrega" = customer_orders en estado
// 'confirmado'. Además, los confirmados con fecha del mes en curso (KPI de pedidos).
export function pedidosResumen(db) {
  const month = new Date().toISOString().slice(0, 7);
  const confirmadosMes = db.prepare("SELECT COUNT(*) n FROM customer_orders WHERE status='confirmado' AND strftime('%Y-%m', date) = ?").get(month).n;
  const pendientes = db.prepare("SELECT COUNT(*) n FROM customer_orders WHERE status='confirmado'").get().n;
  return { confirmadosMes, pendientes };
}

// Pedidos confirmados aún SIN ENTREGAR desde hace > N días (equivalente nuevo de "pedidos
// bloqueados": delivered_status != 'entregado'). Sustituye al viejo "en_preparacion > 3 días".
export function pedidosSinEntregar(db, days = 3) {
  return db.prepare(
    "SELECT COUNT(*) n FROM customer_orders WHERE status='confirmado' AND COALESCE(delivered_status,'') <> 'entregado' AND date(date) < ?"
  ).get(daysAgoISO(days)).n;
}
