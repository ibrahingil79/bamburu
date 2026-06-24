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
