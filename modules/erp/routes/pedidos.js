import { Hono } from 'hono';
import { adminLayout, can, docShell, printableShell } from '../layout.js';
import { renderPdfFromHtml } from '../../../core/pdf.js';   // PDF real: mismo HTML imprimible → Chromium
import { validate } from '../../../core/validate.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { pedidoCreateSchema, pedidoComputeSchema, pedidoAnularSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { computeTotals, createInvoice } from './invoices.js';
import { resolveWarehouseId, reservedOfProduct } from '../stock.js';
import { activeWarehouses } from './warehouses.js';
import { lineSearchCellHtml, lineSearchScript } from '../views/line-search.js';
import { orderDeliveryState } from './albaranes.js';   // PIEZA 2b: estado de entrega + atajo a factura

// ════════════════════════════════════════════════════════════════════════════
// PILAR 4 · VENTAS · PIEZA 2a — PEDIDO + RESERVA DE STOCK.
// ESPEJO del PRESUPUESTO (quotes): mismo ciclo borrador→confirmado→anulado, numeración
// PED-NNNN SOLO al confirmar, foto congelada al confirmar, permisos por ruta, lista con
// buscador/filtro/paginación. Líneas como la FACTURA (catálogo o libre). Totales con la
// matemática de la factura (base + IVA por tasa + IRPF). A diferencia del presupuesto, el
// pedido es venta EN FIRME: al confirmar APARTA (reserva) stock para el cliente sin sacarlo
// del almacén. La reserva es una capa DERIVADA (stock.js: reservedOfProduct) que se enciende
// al estar el pedido 'confirmado' y se suelta al 'anulado' (o al entregar, que es la 2b). El
// pedido lleva ALMACÉN (la reserva sale de ÉL) y una fecha de entrega prevista INFORMATIVA.
// Corregir un confirmado = anular y rehacer. NO reutiliza el clúster e-commerce viejo.
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function checkClient(db, clientId) {
  const c = db.prepare('SELECT id FROM clients WHERE id=?').get(clientId);
  if (!c) { const e = new Error('Cliente no encontrado'); e.status = 400; throw e; }
}

// Re-resuelve cada línea contra el catálogo (idéntico al presupuesto): línea de catálogo
// (product_id) → el IVA lo fija el SERVIDOR desde la banda del producto; línea libre → el IVA
// que venga (el formulario manda 21% fijo). unit_price es NETO.
function resolveOrderLines(db, lines) {
  const get = db.prepare('SELECT id, name, tax_rate FROM products WHERE id=?');
  return lines.map(l => {
    let product_id = null, tax_rate = Number(l.tax_rate) || 0, description = String(l.description || '').trim();
    if (l.product_id) {
      const p = get.get(l.product_id);
      if (p) { product_id = p.id; tax_rate = Number(p.tax_rate) || 0; if (!description) description = p.name; }
    }
    return { product_id, description, quantity: Number(l.quantity), unit_price: Number(l.unit_price), tax_rate };
  });
}

// IRPF del pedido: igual que la factura/presupuesto — solo si el negocio es ES y el cliente es
// empresa, con el % por defecto del negocio. Particular → 0.
function orderIrpfRate(db, clientId) {
  const cfg = db.prepare('SELECT country, irpf_default FROM company_config WHERE id=1').get() || {};
  if ((cfg.country || 'ES').toUpperCase() !== 'ES') return 0;
  const cl = clientId ? db.prepare('SELECT client_type FROM clients WHERE id=?').get(clientId) : null;
  return (cl && cl.client_type === 'empresa') ? (Number(cfg.irpf_default) || 0) : 0;
}

// Totales con la MISMA matemática de la factura (computeTotals): base + IVA por tasa − IRPF.
export function orderTotals(db, clientId, resolvedLines) {
  const irpf_rate = orderIrpfRate(db, clientId);
  const t = computeTotals(resolvedLines.map(l => ({ quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate })), irpf_rate);
  return { subtotal: t.subtotal, tax_amount: t.taxAmount, irpf_rate, irpf_amount: t.irpfAmount, total: t.total, taxByRate: t.taxByRate };
}

function insertItems(db, orderId, lines) {
  const ins = db.prepare('INSERT INTO customer_order_items (order_id, product_id, description, quantity, unit_price, total_price, tax_rate, tax_amount) VALUES (?,?,?,?,?,?,?,?)');
  for (const l of lines) {
    const base = Math.round(l.quantity * l.unit_price * 100) / 100;
    const tax = Math.round(base * l.tax_rate / 100 * 100) / 100;
    ins.run(orderId, l.product_id || null, l.description, l.quantity, l.unit_price, base, l.tax_rate, tax);
  }
}

function getOrder(db, id) {
  return db.prepare('SELECT o.*, c.name AS client_live_name, w.name AS warehouse_name FROM customer_orders o JOIN clients c ON o.client_id=c.id LEFT JOIN warehouses w ON o.warehouse_id=w.id WHERE o.id=?').get(id);
}
function getItems(db, orderId) {
  return db.prepare('SELECT oi.*, p.sku, p.type AS product_type FROM customer_order_items oi LEFT JOIN products p ON oi.product_id=p.id WHERE oi.order_id=? ORDER BY oi.id').all(orderId);
}

// ── Servicios validados (testables; los usan las rutas; DISA podrá engancharse después) ──

export function createPedidoSvc(db, d) {
  checkClient(db, d.client_id);
  const lines = resolveOrderLines(db, d.lines);
  const tot = orderTotals(db, d.client_id, lines);
  const date = d.date || new Date().toISOString().slice(0, 10);
  const cfg = db.prepare('SELECT currency, currency_symbol FROM company_config WHERE id=1').get() || {};
  // El pedido tiene un almacén (por defecto el principal, seleccionable): la reserva sale de ÉL.
  const wid = resolveWarehouseId(db, d.warehouse_id);
  const run = db.transaction(() => {
    const r = db.prepare(`INSERT INTO customer_orders (client_id, warehouse_id, date, expected_delivery_date, notes, subtotal, tax_amount, irpf_rate, irpf_amount, total, currency, currency_symbol)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      d.client_id, wid, date, d.expected_delivery_date || null, d.notes || '',
      tot.subtotal, tot.tax_amount, tot.irpf_rate, tot.irpf_amount, tot.total,
      cfg.currency || 'EUR', cfg.currency_symbol || '€');
    const id = r.lastInsertRowid;
    insertItems(db, id, lines);
    return id;
  });
  return run();
}

// EDITAR: solo un borrador (el confirmado se anula y se rehace). No mueve reserva (el borrador
// no reserva nada). El almacén es editable aquí.
export function updatePedidoSvc(db, id, d) {
  const o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(id);
  if (!o) { const e = new Error('Pedido no encontrado'); e.status = 404; throw e; }
  if (o.status !== 'borrador') { const e = new Error('Solo se puede editar un borrador (el pedido confirmado se anula y se rehace)'); e.status = 400; throw e; }
  checkClient(db, d.client_id);
  const lines = resolveOrderLines(db, d.lines);
  const tot = orderTotals(db, d.client_id, lines);
  const wid = resolveWarehouseId(db, d.warehouse_id);
  db.transaction(() => {
    db.prepare('UPDATE customer_orders SET client_id=?, warehouse_id=?, date=?, expected_delivery_date=?, notes=?, subtotal=?, tax_amount=?, irpf_rate=?, irpf_amount=?, total=? WHERE id=?')
      .run(d.client_id, wid, d.date || o.date, d.expected_delivery_date || null, d.notes || '', tot.subtotal, tot.tax_amount, tot.irpf_rate, tot.irpf_amount, tot.total, id);
    db.prepare('DELETE FROM customer_order_items WHERE order_id=?').run(id);
    insertItems(db, id, lines);
  })();
  return { id };
}

// CONFIRMAR: el borrador gana su número PED-NNNN (contador code_counters, solo aquí) y se
// bloquea. AQUÍ NACE LA RESERVA: al pasar a 'confirmado', sus líneas físicas cuentan como
// reservado (capa derivada; no se escribe en el libro). En la MISMA transacción se CONGELA la
// foto de emisor + cliente (igual que la factura/presupuesto).
export function confirmPedidoSvc(db, id) {
  const o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(id);
  if (!o) { const e = new Error('Pedido no encontrado'); e.status = 404; throw e; }
  if (o.status !== 'borrador') { const e = new Error('Solo se puede confirmar un borrador'); e.status = 400; throw e; }
  if (!db.prepare('SELECT 1 FROM customer_order_items WHERE order_id=?').get(id)) { const e = new Error('El pedido no tiene líneas'); e.status = 400; throw e; }
  const run = db.transaction(() => {
    const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(o.client_id) || {};
    const wid = o.warehouse_id || resolveWarehouseId(db, null);
    const number = nextCode(db, 'order');
    db.prepare(`UPDATE customer_orders SET order_number=?, status='confirmado', warehouse_id=?,
        company_name=?, company_fiscal_id=?, company_address=?, company_phone=?, company_email=?,
        client_name=?, client_fiscal_id=?, client_address=?, client_email=?
      WHERE id=?`).run(
      number, wid,
      cfg.company_name || '', cfg.fiscal_id || '', cfg.address || '', cfg.phone || '', cfg.email || '',
      cl.name || '', cl.fiscal_id || '', cl.address || '', cl.email || '',
      id);
    return { id, order_number: number };
  });
  return run();
}

// ANULAR: solo un confirmado, con motivo (mín. 3). SUELTA la reserva (al pasar a 'anulado', sus
// líneas dejan de contar como reservado: la capa derivada lo refleja sola). Nada se borra.
export function cancelPedidoSvc(db, id, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(id);
  if (!o) { const e = new Error('Pedido no encontrado'); e.status = 404; throw e; }
  if (o.status !== 'confirmado') { const e = new Error('Solo se puede anular un pedido confirmado'); e.status = 400; throw e; }
  // PIEZA 2b — integridad bidireccional (espejo de compras): no se anula un pedido con
  // albaranes (entregas) confirmados; hay que anular antes esos albaranes (si no, el stock
  // ya entregado quedaría descuadrado y la reserva se perdería en silencio).
  if (db.prepare("SELECT 1 FROM delivery_notes WHERE order_id=? AND status='confirmado' LIMIT 1").get(id)) {
    const e = new Error('Este pedido tiene albaranes (entregas) confirmados: anúlalos primero (devuelven el stock y la reserva) antes de anular el pedido.'); e.status = 409; throw e;
  }
  db.prepare("UPDATE customer_orders SET status='anulado', anulada_motivo=? WHERE id=?").run(m, id);
  return { id, order_number: o.order_number };
}

// ANULAR Y REHACER: anula el confirmado y abre un borrador NUEVO precargado con su cliente,
// almacén y líneas, enlazado vía replaces_order_id (espejo del presupuesto).
export function cancelRedoPedidoSvc(db, id, motivo, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const run = db.transaction(() => {
    const anulada = cancelPedidoSvc(db, id, motivo);
    const o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(id);
    const r = db.prepare(`INSERT INTO customer_orders (client_id, warehouse_id, date, expected_delivery_date, notes, replaces_order_id, subtotal, tax_amount, irpf_rate, irpf_amount, total, currency, currency_symbol)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      o.client_id, o.warehouse_id, today, o.expected_delivery_date || null, o.notes || '', id,
      o.subtotal, o.tax_amount, o.irpf_rate, o.irpf_amount, o.total, o.currency || 'EUR', o.currency_symbol || '€');
    const newId = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO customer_order_items (order_id, product_id, description, quantity, unit_price, total_price, tax_rate, tax_amount) VALUES (?,?,?,?,?,?,?,?)');
    for (const it of db.prepare('SELECT * FROM customer_order_items WHERE order_id=? ORDER BY id').all(id)) {
      ins.run(newId, it.product_id, it.description, it.quantity, it.unit_price, it.total_price, it.tax_rate, it.tax_amount);
    }
    return { id: newId, anulada_id: id, anulada_number: anulada.order_number };
  });
  return run();
}

// ── MOTOR DE CONVERSIÓN: pedido → FACTURA (atajo, cadena suelta) ─────────────
// Factura el pedido directamente (como presupuesto→factura), arrastrando sus líneas, con
// enlace bidireccional. La factura NO mueve stock (lo mueve el albarán) y NO consume la
// reserva: se puede facturar antes de entregar. Sin gate de exceso (las unidades son del
// propio pedido reservado: aplicarlo daría un falso positivo contra su propia reserva).
export function orderToInvoiceSvc(db, id) {
  const o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(id);
  if (!o) { const e = new Error('Pedido no encontrado'); e.status = 404; throw e; }
  if (o.status !== 'confirmado') { const e = new Error('Solo se puede facturar un pedido confirmado'); e.status = 400; throw e; }
  const already = db.prepare("SELECT dest_id FROM document_links WHERE source_type='order' AND source_id=? AND dest_type='invoice'").get(id);
  if (already) {
    const inv = db.prepare('SELECT invoice_number FROM invoices WHERE id=?').get(already.dest_id);
    const e = new Error('Este pedido ya se facturó en ' + (inv ? inv.invoice_number : '#' + already.dest_id) + '.'); e.status = 400; throw e;
  }
  const items = db.prepare('SELECT * FROM customer_order_items WHERE order_id=? ORDER BY id').all(id);
  const lines = items.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, tax_rate: i.tax_rate, product_id: i.product_id || undefined }));
  const run = db.transaction(() => {
    const inv = createInvoice(db, { client_id: o.client_id, lines, irpf_rate: o.irpf_rate, notes: 'Procede del pedido ' + (o.order_number || ('#' + id)) });
    db.prepare("INSERT INTO document_links (source_type, source_id, dest_type, dest_id) VALUES ('order', ?, 'invoice', ?)").run(id, inv.id);
    return { invoice_id: inv.id, invoice_number: inv.invoice_number };
  });
  return run();
}

// ── Documento (compartido entre vista imprimible y, si se añade, email) ──────
// Cabecera de emisor + cliente: el confirmado/anulado usa su FOTO CONGELADA; el borrador en vivo.
function docParties(db, o) {
  if (o.company_name != null) {
    return {
      emisor:  { name: o.company_name, fiscal_id: o.company_fiscal_id, address: o.company_address, phone: o.company_phone, email: o.company_email },
      cliente: { name: o.client_name, fiscal_id: o.client_fiscal_id, address: o.client_address, email: o.client_email },
    };
  }
  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(o.client_id) || {};
  return {
    emisor:  { name: cfg.company_name || '', fiscal_id: cfg.fiscal_id || '', address: cfg.address || '', phone: cfg.phone || '', email: cfg.email || '' },
    cliente: { name: cl.name || '', fiscal_id: cl.fiscal_id || '', address: cl.address || '', email: cl.email || '' },
  };
}

// Líneas + pie con base → IVA por tasa → IRPF (si >0) → total. Mismo desglose que la factura.
function orderDocumentBodyHtml(o, items, emisor, cliente, sym) {
  const taxByRate = {};
  for (const i of items) {
    const r = Number(i.tax_rate) || 0;
    if (!taxByRate[r]) taxByRate[r] = { rate: r, base: 0, amount: 0 };
    taxByRate[r].base += Number(i.total_price) || 0;
    taxByRate[r].amount += Number(i.tax_amount) || 0;
  }
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${esc(i.description)}${i.sku ? ` <span style="color:#64748b;font-size:11px">[${esc(i.sku)}]</span>` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${i.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${sym}${Number(i.unit_price).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${Number(i.tax_rate) > 0 ? Number(i.tax_rate) + '%' : 'Exento'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${sym}${Number(i.total_price).toFixed(2)}</td>
    </tr>`).join('');
  const taxRows = Object.values(taxByRate).sort((a, b) => b.rate - a.rate).map(x =>
    `<tr><td style="padding:4px 12px;color:#64748b">${x.rate > 0 ? 'IVA ' + x.rate + '%' : 'Exento de IVA'} (sobre ${sym}${x.base.toFixed(2)})</td><td style="padding:4px 12px;text-align:right;font-weight:600">${sym}${x.amount.toFixed(2)}</td></tr>`
  ).join('');
  const irpfRow = (Number(o.irpf_amount) > 0)
    ? `<tr><td style="padding:4px 12px;color:#9333ea">IRPF (${o.irpf_rate}%)</td><td style="padding:4px 12px;text-align:right;color:#9333ea">−${sym}${Number(o.irpf_amount).toFixed(2)}</td></tr>` : '';
  return `
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
  <div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 4px">Pedido</h1>
    <div style="color:#64748b;font-size:12px">${o.order_number ? esc(o.order_number) : 'Borrador (sin número)'}</div>
  </div>
  <div style="text-align:right;color:#64748b;font-size:12px">
    <div>Fecha: <strong style="color:#1e293b">${esc(o.date)}</strong></div>
    ${o.expected_delivery_date ? `<div>Entrega prevista: <strong style="color:#1e293b">${esc(o.expected_delivery_date)}</strong></div>` : ''}
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:24px">
  <div>
    <div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;margin-bottom:4px">Emisor</div>
    <div><strong>${esc(emisor.name || '')}</strong></div>
    ${emisor.fiscal_id ? `<div>${esc(emisor.fiscal_id)}</div>` : ''}
    ${emisor.address ? `<div style="color:#64748b">${esc(emisor.address)}</div>` : ''}
  </div>
  <div>
    <div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;margin-bottom:4px">Cliente</div>
    <div><strong>${esc(cliente.name || '')}</strong></div>
    ${cliente.fiscal_id ? `<div>${esc(cliente.fiscal_id)}</div>` : ''}
    ${cliente.address ? `<div style="color:#64748b">${esc(cliente.address)}</div>` : ''}
    ${cliente.email ? `<div style="color:#64748b">${esc(cliente.email)}</div>` : ''}
  </div>
</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
  <thead><tr>
    <th style="background:#F5F6F8;padding:8px 12px;text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0">Descripción</th>
    <th style="background:#F5F6F8;padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0">Cant.</th>
    <th style="background:#F5F6F8;padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0">P. unit.</th>
    <th style="background:#F5F6F8;padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0">IVA</th>
    <th style="background:#F5F6F8;padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0">Subtotal</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<table style="margin-left:auto;width:320px;border-collapse:collapse">
  <tr><td style="padding:4px 12px;color:#64748b">Base imponible</td><td style="padding:4px 12px;text-align:right;font-weight:600">${sym}${Number(o.subtotal).toFixed(2)}</td></tr>
  ${taxRows}
  ${irpfRow}
  <tr><td style="padding:10px 12px;font-size:15px;border-top:2px solid #1e293b;font-weight:700">TOTAL</td><td style="padding:10px 12px;text-align:right;font-size:15px;border-top:2px solid #1e293b;font-weight:700">${sym}${Number(o.total).toFixed(2)}</td></tr>
</table>
${o.notes ? `<div style="margin-top:16px;color:#64748b">${esc(o.notes)}</div>` : ''}`;
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export function createPedidoRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  const ESTADO_FILTER = {
    borrador:   "o.status='borrador'",
    confirmado: "o.status='confirmado'",
    anulado:    "o.status='anulado'",
    entregado:  "o.status='entregado'",
  };
  const ESTADO_OPTION_LABEL = { borrador: 'Borradores', confirmado: 'Confirmados', anulado: 'Anulados', entregado: 'Entregados' };
  const displayEstado = (o) =>
    o.status === 'anulado' ? ['Anulado', 'b-red']
      : o.status === 'entregado' ? ['Entregado', 'b-teal']
      : o.status === 'confirmado' ? ['Confirmado', 'b-green']
      : ['Borrador', 'b-yellow'];

  // ── API ──
  api.get('/:id', requirePerm('pedidos.read'), c => {
    try {
      const o = getOrder(db, parseInt(c.req.param('id')));
      if (!o) return c.json({ error: 'No encontrado' }, 404);
      return c.json({ ...o, items: getItems(db, o.id) });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // Pie en vivo (mismo patrón que /quotes/compute-totals).
  api.post('/compute-totals', requirePerm('pedidos.read'), validate(pedidoComputeSchema), c => {
    try {
      const { client_id, lines } = c.get('validated');
      const resolved = resolveOrderLines(db, lines);
      const t = orderTotals(db, client_id, resolved);
      return c.json({ subtotal: t.subtotal, taxByRate: t.taxByRate, taxAmount: t.tax_amount, irpfRate: t.irpf_rate, irpfAmount: t.irpf_amount, total: t.total });
    } catch (e) { return c.json({ error: e.message }, 400); }
  });

  api.post('/', requirePerm('pedidos.create'), validate(pedidoCreateSchema), c => {
    try {
      const id = createPedidoSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó borrador de pedido', 'customer_order', id, '');
      return c.json({ id, message: 'Borrador guardado' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.put('/:id', requirePerm('pedidos.edit'), validate(pedidoCreateSchema), c => {
    try {
      const r = updatePedidoSvc(db, parseInt(c.req.param('id')), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó borrador de pedido', 'customer_order', r.id, '');
      return c.json({ ...r, message: 'Borrador actualizado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/confirmar', requirePerm('pedidos.edit'), c => {
    try {
      const r = confirmPedidoSvc(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Confirmó pedido', 'customer_order', r.id, r.order_number);
      return c.json({ ...r, message: 'Pedido ' + r.order_number + ' confirmado (stock reservado)' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/anular', requirePerm('pedidos.edit'), validate(pedidoAnularSchema), c => {
    try {
      const r = cancelPedidoSvc(db, parseInt(c.req.param('id')), c.get('validated').motivo);
      logActivity(db, c.get('session'), 'Anuló pedido', 'customer_order', r.id, (r.order_number || '') + ' — ' + c.get('validated').motivo);
      return c.json({ ...r, message: 'Pedido anulado (reserva liberada)' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // PIEZA 2b — atajo pedido → FACTURA (cadena suelta: facturar desde el pedido o desde el albarán).
  api.post('/:id/factura', requirePerm('pedidos.edit'), c => {
    try {
      const r = orderToInvoiceSvc(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Facturó pedido', 'customer_order', parseInt(c.req.param('id')), r.invoice_number);
      return c.json({ ...r, message: 'Pedido facturado en ' + r.invoice_number });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/anular-y-rehacer', requirePerm('pedidos.create'), validate(pedidoAnularSchema), c => {
    try {
      const r = cancelRedoPedidoSvc(db, parseInt(c.req.param('id')), c.get('validated').motivo);
      logActivity(db, c.get('session'), 'Anuló y rehízo pedido', 'customer_order', r.id, 'sustituye a ' + (r.anulada_number || ('#' + r.anulada_id)));
      return c.json({ ...r, message: 'Pedido anulado; borrador nuevo creado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // ── VISTAS ──

  // Lista server-rendered (patrón presupuesto): búsqueda por cliente o número, filtro por
  // estado, paginación 25.
  views.get('/', requirePerm('pedidos.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const qstr = (c.req.query('q') || '').trim();
    const estado = (c.req.query('estado') || '').trim();
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    const where = [], params = [];
    if (qstr) { where.push('(cl.name LIKE ? OR o.order_number LIKE ?)'); params.push('%' + qstr + '%', '%' + qstr + '%'); }
    if (estado && ESTADO_FILTER[estado]) where.push('(' + ESTADO_FILTER[estado] + ')');
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare('SELECT COUNT(*) AS n FROM customer_orders o JOIN clients cl ON o.client_id=cl.id ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const orders = db.prepare('SELECT o.*, cl.name AS client_live_name FROM customer_orders o JOIN clients cl ON o.client_id=cl.id ' + whereSql + ' ORDER BY o.date DESC, o.id DESC LIMIT ? OFFSET ?').all(...params, perPage, offset);

    const buildQs = (p) => { const u = new URLSearchParams(); if (qstr) u.set('q', qstr); if (estado) u.set('estado', estado); u.set('page', String(p)); return u.toString(); };
    const rowsHtml = orders.map(o => {
      const [lbl, badge] = displayEstado(o);
      const name = o.company_name != null ? (o.client_name || o.client_live_name) : o.client_live_name;
      return '<tr>'
        + '<td>' + (o.order_number ? '<strong style="font-family:monospace">' + esc(o.order_number) + '</strong>' : '<span style="color:#9097A1">Borrador</span>') + '</td>'
        + '<td><strong>' + esc(name) + '</strong></td>'
        + '<td>' + esc(o.date) + '</td>'
        + '<td><span class="badge ' + badge + '">' + esc(lbl) + '</span></td>'
        + '<td><strong>' + Number(o.total).toFixed(2) + ' ' + sym + '</strong></td>'
        + '<td style="text-align:right"><a href="/admin/pedidos/' + o.id + '" class="btn btn-secondary btn-sm">Ver</a></td>'
        + '</tr>';
    }).join('');
    const estadoOptions = ['', 'borrador', 'confirmado', 'anulado', 'entregado'].map(v =>
      '<option value="' + v + '"' + (v === estado ? ' selected' : '') + '>' + (v ? ESTADO_OPTION_LABEL[v] : 'Todos') + '</option>').join('');

    const content = `
      <div class="ph">
        <h2>Pedidos</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${esc(qstr)}" placeholder="Buscar por cliente o número...">
          <select class="form-control" name="estado" style="width:auto;min-width:140px" onchange="this.form.submit()">${estadoOptions}</select>
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'pedidos.create') ? '<a href="/admin/pedidos/new" class="btn btn-primary">Nuevo pedido</a>' : ''}
        </form>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Total</th><th></th></tr></thead>
        <tbody>${total === 0 ? '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#9097A1">' + (qstr || estado ? 'No se encontraron pedidos' : 'Sin pedidos. Crea el primero.') + '</td></tr>' : rowsHtml}</tbody>
      </table></div></div>
      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:#9097A1;font-size:.85rem">Página ${page} de ${totalPages} · ${total} pedido${total === 1 ? '' : 's'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div></div>` : ''}`;
    return c.html(adminLayout('Pedidos', content, 'pedidos', c.get('session')?.csrfToken || '', c));
  });

  // Formulario de alta/edición de borrador (líneas como la FACTURA: catálogo o libre) + almacén
  // + fecha de entrega prevista.
  const formView = (c, existing = null) => {
    const cfg = db.prepare('SELECT currency_symbol, country, irpf_default FROM company_config WHERE id=1').get() || {};
    const sym = cfg.currency_symbol || '€';
    const showIrpf = (cfg.country || 'ES').toUpperCase() === 'ES';
    const irpfDefault = Number(cfg.irpf_default) || 0;
    const today = new Date().toISOString().slice(0, 10);
    const csrfToken = c.get('session')?.csrfToken || '';
    const clients = db.prepare("SELECT id, name, fiscal_id, client_type FROM clients ORDER BY name").all();
    if (!clients.length) {
      return c.html(adminLayout('Nuevo pedido', `<div class="ph"><h2>Nuevo pedido</h2><a href="/admin/pedidos" class="btn btn-secondary">Volver</a></div><div class="card card-body" style="text-align:center;padding:2rem;color:#9097A1">No hay clientes. <a href="/admin/clients">Crea uno primero.</a></div>`, 'pedidos', csrfToken, c));
    }
    const warehouses = activeWarehouses(db);
    const defWh = (warehouses.find(w => w.is_default) || warehouses[0] || {}).id || '';
    const isEdit = !!existing;
    const items = isEdit ? getItems(db, existing.id) : [];
    const clientOpts = clients.map(cl => '<option value="' + cl.id + '"' + (isEdit && existing.client_id === cl.id ? ' selected' : '') + '>' + esc(cl.name) + (cl.fiscal_id ? ' — ' + esc(cl.fiscal_id) : '') + '</option>').join('');
    const selWh = isEdit && existing.warehouse_id ? existing.warehouse_id : defWh;
    const whOpts = warehouses.map(w => '<option value="' + w.id + '"' + (w.id === selWh ? ' selected' : '') + '>' + esc(w.name) + (w.is_default ? ' (principal)' : '') + '</option>').join('');

    const content = `
      <div class="ph"><h2>${isEdit ? 'Editar borrador' : 'Nuevo pedido'}</h2><a href="${isEdit ? '/admin/pedidos/' + existing.id : '/admin/pedidos'}" class="btn btn-secondary">Volver</a></div>
      <div class="card" style="max-width:960px"><div class="card-body">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Cliente *</label><select id="f-client" class="form-control"><option value="">— Selecciona cliente —</option>${clientOpts}</select></div>
          <div class="form-group"><label class="form-label">Almacén (reserva)</label><select id="f-warehouse" class="form-control">${whOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Fecha</label><input type="date" id="f-date" class="form-control" value="${isEdit ? esc(existing.date) : today}"></div>
          <div class="form-group"><label class="form-label">Entrega prevista (informativa)</label><input type="date" id="f-delivery" class="form-control" value="${isEdit && existing.expected_delivery_date ? esc(existing.expected_delivery_date) : ''}"></div>
        </div>
        <hr style="margin:1.25rem 0;border:none;border-top:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <h3 style="font-size:.9rem;font-weight:600;margin:0">Líneas</h3>
          <button class="btn btn-secondary btn-sm" onclick="addLine()">+ Añadir línea</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Descripción</th><th style="width:80px">Cant.</th><th style="width:120px">P. unit.</th><th style="width:100px;text-align:right">Subtotal</th><th style="width:36px"></th></tr></thead>
          <tbody id="lines-body"></tbody>
          <tfoot id="totals-foot"></tfoot>
        </table></div>
        <div class="form-group" style="margin-top:1.25rem"><label class="form-label">Notas (opcional)</label><textarea id="f-notes" class="form-control" rows="2">${isEdit ? esc(existing.notes || '') : ''}</textarea></div>
        <div style="text-align:right;margin-top:1rem"><button class="btn btn-primary" id="btn-save" onclick="savePedido()">Guardar borrador</button></div>
      </div></div>
      <script>
      const SYM='${sym}', SHOW_IRPF=${showIrpf}, IRPF_DEFAULT=${irpfDefault};
      const LINE_CELL=${JSON.stringify(lineSearchCellHtml('<input type="hidden" class="line-pid"><input type="hidden" class="line-pname">'))};
      const IS_EDIT=${isEdit}, EDIT_ID=${isEdit ? existing.id : 'null'};
      const PRELOAD=${JSON.stringify(items.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, tax_rate: i.tax_rate, product_id: i.product_id || null })))};
      let clients=[], catalog=[], recalcTimer=null;
      async function loadAll(){
        try {
          const [cl, prods] = await Promise.all([api('GET','/api/erp/clients').catch(()=>[]), api('GET','/api/erp/products').catch(()=>[])]);
          clients=cl; catalog=(prods||[]).filter(p=>p.status==='active');
        } catch(e){}
        if (PRELOAD.length) PRELOAD.forEach(addLine); else addLine();
        document.getElementById('f-client').addEventListener('change', scheduleRecalc);
      }
      function currentIrpfRate(){ if(!SHOW_IRPF) return 0; const id=parseInt(document.getElementById('f-client').value); const cl=clients.find(x=>x.id===id); return (cl && cl.client_type==='empresa')?IRPF_DEFAULT:0; }
      function addLine(pre){
        const tbody=document.getElementById('lines-body'); const row=document.createElement('tr');
        row.innerHTML = LINE_CELL
          + '<td><input type="number" class="form-control line-qty" step="0.01" min="0.01" value="'+(pre?pre.quantity:1)+'"></td>'
          + '<td><input type="number" class="form-control line-price" step="0.01" min="0" value="'+(pre?Number(pre.unit_price).toFixed(2):'0')+'"></td>'
          + '<td style="text-align:right;padding:.7rem 1rem"><span class="line-subtotal">'+SYM+'0.00</span></td>'
          + '<td><button class="btn btn-danger btn-sm" onclick="this.closest(\\'tr\\').remove();scheduleRecalc()">✕</button></td>';
        row.cells[0].insertAdjacentHTML('beforeend','<input type="hidden" class="line-tax" value="21">');
        tbody.appendChild(row);
        if (pre){
          row.querySelector('.line-desc').value=pre.description||'';
          row.querySelector('.line-tax').value=String(Number(pre.tax_rate)||0);
          if (pre.product_id){ row.querySelector('.line-pid').value=pre.product_id; row.querySelector('.line-pname').value=pre.description||''; }
        }
        row.querySelectorAll('.line-qty, .line-price').forEach(inp=>inp.addEventListener('input',scheduleRecalc));
        scheduleRecalc();
      }
      ${lineSearchScript()}
      function applyLinePick(row,p){
        row.querySelector('.line-desc').value=p.name;
        row.querySelector('.line-price').value=Number(p.price||0).toFixed(2);
        row.querySelector('.line-tax').value=String(Number(p.tax_rate)||0);
        row.querySelector('.line-pid').value=p.id;
        row.querySelector('.line-pname').value=p.name;
        scheduleRecalc();
      }
      function lineProduct(row){ const pid=row.querySelector('.line-pid'); if(!pid||!pid.value) return null; if((row.querySelector('.line-desc').value||'').trim()!==(row.querySelector('.line-pname').value||'').trim()) return null; return parseInt(pid.value); }
      function scheduleRecalc(){ if(recalcTimer)clearTimeout(recalcTimer); recalcTimer=setTimeout(doRecalc,300); }
      function collectLines(forSave){
        const lines=[];
        for (const r of document.querySelectorAll('#lines-body tr')){
          const desc=(r.querySelector('.line-desc').value||'').trim();
          const qty=parseFloat(r.querySelector('.line-qty').value)||0;
          const price=parseFloat(r.querySelector('.line-price').value)||0;
          const rate=parseFloat(r.querySelector('.line-tax').value)||0;
          if (forSave && !desc){ toast('Falta descripción en una línea','err'); return null; }
          if (forSave && !(qty>0)){ toast('Cantidad debe ser > 0','err'); return null; }
          lines.push({ description: desc||'_', quantity: qty||0.01, unit_price: price, tax_rate: rate, product_id: lineProduct(r) });
          r.querySelector('.line-subtotal').textContent=SYM+(qty*price).toFixed(2);
        }
        return lines;
      }
      async function doRecalc(){
        const lines=collectLines(false); if(!lines||!lines.length) return;
        try { const t=await api('POST','/api/erp/pedidos/compute-totals',{ client_id: parseInt(document.getElementById('f-client').value)||null, lines }); renderTotals(t); } catch(e){}
      }
      function renderTotals(t){
        const lab=(x,col)=>'<td colspan="3" style="text-align:right;padding:.45rem 1rem'+(col?';color:'+col:'')+'">'+x+'</td>';
        const val=(x,col)=>'<td style="text-align:right;padding:.45rem 1rem'+(col?';color:'+col:'')+'">'+x+'</td><td></td>';
        let html='<tr><td colspan="3" style="text-align:right;font-weight:600;padding:.7rem 1rem">Base imponible</td><td style="text-align:right;padding:.7rem 1rem">'+SYM+t.subtotal.toFixed(2)+'</td><td></td></tr>';
        const rates=Object.values(t.taxByRate||{});
        if(!rates.length){ html+='<tr>'+lab('IVA','var(--muted)')+val(SYM+'0.00','var(--muted)')+'</tr>'; }
        else { for(const x of rates){ const l=(Number(x.rate)>0?'IVA '+x.rate+'%':'Exento (0%)')+' (sobre '+SYM+Number(x.base).toFixed(2)+')'; html+='<tr>'+lab(l,'var(--muted)')+val(SYM+Number(x.amount).toFixed(2),'var(--muted)')+'</tr>'; } }
        if(SHOW_IRPF && t.irpfAmount>0){ html+='<tr>'+lab('IRPF '+t.irpfRate+'%','#9333ea')+val('−'+SYM+t.irpfAmount.toFixed(2),'#9333ea')+'</tr>'; }
        html+='<tr><td colspan="3" style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">Total</td><td style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">'+SYM+t.total.toFixed(2)+'</td><td></td></tr>';
        document.getElementById('totals-foot').innerHTML=html;
      }
      async function savePedido(){
        const client_id=parseInt(document.getElementById('f-client').value);
        if(!client_id){ toast('Selecciona un cliente','err'); return; }
        const lines=collectLines(true); if(!lines) return;
        if(!lines.length){ toast('Añade al menos una línea','err'); return; }
        const body={ client_id, warehouse_id: parseInt(document.getElementById('f-warehouse').value)||null, date: document.getElementById('f-date').value||undefined, expected_delivery_date: document.getElementById('f-delivery').value||'', notes: document.getElementById('f-notes').value||'', lines };
        const btn=document.getElementById('btn-save'); btn.disabled=true;
        try {
          if (IS_EDIT){ await api('PUT','/api/erp/pedidos/'+EDIT_ID,body); window.location.href='/admin/pedidos/'+EDIT_ID; }
          else { const r=await api('POST','/api/erp/pedidos',body); window.location.href='/admin/pedidos/'+r.id; }
        } catch(e){ toast(e.message||'Error guardando','err'); btn.disabled=false; }
      }
      loadAll();
      </script>`;
    return c.html(adminLayout(isEdit ? 'Editar pedido' : 'Nuevo pedido', content, 'pedidos', csrfToken, c));
  };
  views.get('/new', requirePerm('pedidos.create'), c => formView(c, null));
  views.get('/:id/edit', requirePerm('pedidos.edit'), c => {
    const o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(parseInt(c.req.param('id')));
    if (!o) return c.redirect('/admin/pedidos');
    if (o.status !== 'borrador') return c.redirect('/admin/pedidos/' + o.id);
    return formView(c, o);
  });

  // Documento imprimible (patrón presupuesto: docShell + window.print) + panel de acciones.
  views.get('/:id', requirePerm('pedidos.read'), c => {
    const id = parseInt(c.req.param('id'));
    const o = getOrder(db, id);
    if (!o) return c.text('Pedido no encontrado', 404);
    const items = getItems(db, id);
    const { emisor, cliente } = docParties(db, o);
    const sym = o.currency_symbol || '€';
    const csrfToken = c.get('session')?.csrfToken || '';

    // Enlaces (bidireccional): de qué presupuesto procede este pedido.
    const fromQuote = db.prepare("SELECT source_id FROM document_links WHERE dest_type='order' AND dest_id=? AND source_type='quote'").get(id);
    const quoteLink = fromQuote ? (db.prepare('SELECT id, quote_number FROM quotes WHERE id=?').get(fromQuote.source_id) || null) : null;
    const replacedBy = db.prepare('SELECT id, order_number, status FROM customer_orders WHERE replaces_order_id=? ORDER BY id DESC LIMIT 1').get(id) || null;
    const replacesPrev = o.replaces_order_id ? (db.prepare('SELECT id, order_number FROM customer_orders WHERE id=?').get(o.replaces_order_id) || null) : null;

    // Líneas físicas que reserva (informativo). La reserva real la deriva stock.js.
    const reservaFisica = items.filter(i => i.product_id && (i.product_type || 'physical') === 'physical');
    // PIEZA 2b — estado de entrega (pedido/entregado/pendiente por línea) + albaranes + factura.
    const delivery = o.status === 'confirmado' ? orderDeliveryState(db, id) : null;
    const albaranes = db.prepare("SELECT id, delivery_number, status, date FROM delivery_notes WHERE order_id=? ORDER BY id").all(id);
    const invLink = db.prepare("SELECT dest_id FROM document_links WHERE source_type='order' AND source_id=? AND dest_type='invoice'").get(id);
    const invoice = invLink ? db.prepare('SELECT id, invoice_number FROM invoices WHERE id=?').get(invLink.dest_id) : null;
    const hasPending = delivery ? delivery.lines.some(l => l.pendiente > 0) : false;

    let lifecycle = '';
    if (o.status === 'anulado') lifecycle += `<div class="alert alert-err" style="margin-bottom:18px"><strong>Pedido anulado.</strong> Motivo: ${esc(o.anulada_motivo || '')}. La reserva quedó liberada.${replacedBy ? ` Lo sustituye <a href="/admin/pedidos/${replacedBy.id}" style="color:inherit;font-weight:600">${esc(replacedBy.order_number || ('borrador #' + replacedBy.id))}</a>.` : ''}</div>`;
    if (replacesPrev) lifecycle += `<div class="alert alert-warn" style="margin-bottom:18px">Sustituye a <a href="/admin/pedidos/${replacesPrev.id}" style="color:inherit;font-weight:600">${esc(replacesPrev.order_number || ('borrador #' + replacesPrev.id))}</a> (anulado).</div>`;
    if (quoteLink) lifecycle += `<div class="alert" style="margin-bottom:18px;background:#e0f2fe;color:#075985;border:1px solid #bae6fd">Procede del presupuesto <a href="/admin/quotes/${quoteLink.id}" style="color:inherit;font-weight:600">${esc(quoteLink.quote_number || ('#' + quoteLink.id))}</a>.</div>`;
    if (o.status === 'confirmado' && o.delivered_status) lifecycle += `<div class="alert" style="margin-bottom:18px;background:${o.delivered_status === 'entregado' ? '#f0fdf4;color:#166534;border:1px solid #bbf7d0' : '#fef9c3;color:#854d0e;border:1px solid #fde68a'}">Entrega: <strong>${o.delivered_status === 'entregado' ? 'completamente entregado' : 'parcialmente entregado'}</strong>.</div>`;
    if (o.status === 'confirmado' && reservaFisica.length && o.delivered_status !== 'entregado') lifecycle += `<div class="alert" style="margin-bottom:18px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">Este pedido <strong>reserva stock</strong> en ${esc(o.warehouse_name || 'el almacén principal')} (lo pendiente de entregar). La reserva se suelta al entregar (albarán) o al anular.</div>`;
    if (invoice) lifecycle += `<div class="alert" style="margin-bottom:18px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe">Facturado en <a href="/admin/invoices/${invoice.id}" style="color:inherit;font-weight:600">${esc(invoice.invoice_number)}</a>.</div>`;

    // Tabla de entrega por línea (pedido / entregado / pendiente) cuando el pedido está confirmado.
    let deliveryBlock = '';
    if (delivery) {
      const drows = delivery.lines.map(l => `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9">${esc(l.description)}${(l.product_type && l.product_type !== 'physical') ? ' <span style="color:#94a3b8;font-size:11px">(no mueve stock)</span>' : ''}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${l.pedido}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${l.entregado}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:${l.pendiente > 0 ? '#854d0e' : '#166534'}">${l.pendiente}</td></tr>`).join('');
      const albRows = albaranes.map(a => `<a href="/admin/albaranes/${a.id}" class="badge ${a.status === 'anulado' ? 'b-red' : 'b-green'}" style="margin-right:.3rem;text-decoration:none">${esc(a.delivery_number || ('#' + a.id))}${a.status === 'anulado' ? ' (anulado)' : ''}</a>`).join('');
      deliveryBlock = `
        <div style="margin-top:24px"><div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;margin-bottom:6px">Entrega</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr><th style="background:#F5F6F8;padding:6px 12px;text-align:left;font-size:11px;color:#64748b;border-bottom:2px solid #e2e8f0">Línea</th><th style="background:#F5F6F8;padding:6px 12px;text-align:right;font-size:11px;color:#64748b;border-bottom:2px solid #e2e8f0">Pedido</th><th style="background:#F5F6F8;padding:6px 12px;text-align:right;font-size:11px;color:#64748b;border-bottom:2px solid #e2e8f0">Entregado</th><th style="background:#F5F6F8;padding:6px 12px;text-align:right;font-size:11px;color:#64748b;border-bottom:2px solid #e2e8f0">Pendiente</th></tr></thead>
          <tbody>${drows}</tbody>
        </table>
        ${albaranes.length ? `<div style="margin-top:10px;font-size:12px;color:#64748b">Albaranes: ${albRows}</div>` : ''}</div>`;
    }

    const paper = `${lifecycle}${orderDocumentBodyHtml(o, items, emisor, cliente, sym)}${deliveryBlock}`;

    const [lbl, badge] = displayEstado(o);
    const isBorrador = o.status === 'borrador', isConfirmado = o.status === 'confirmado';
    const panel = `
<div class="card"><div class="card-body">
  <div style="margin-bottom:12px"><span class="badge ${badge}">${esc(lbl)}</span></div>
  <div class="dp-row"><span class="k">Nº</span><span class="v">${o.order_number ? esc(o.order_number) : 'Borrador'}</span></div>
  <div class="dp-row"><span class="k">Cliente</span><span class="v">${esc(o.company_name != null ? (o.client_name || '') : (cliente.name || ''))}</span></div>
  <div class="dp-row"><span class="k">Almacén</span><span class="v">${esc(o.warehouse_name || 'Principal')}</span></div>
  <div class="dp-row"><span class="k">Total</span><span class="v">${sym}${Number(o.total).toFixed(2)}</span></div>
  ${o.expected_delivery_date ? `<div class="dp-row"><span class="k">Entrega prevista</span><span class="v">${esc(o.expected_delivery_date)}</span></div>` : ''}
  <div class="dp-actions" style="margin-top:14px;display:flex;flex-direction:column;gap:.5rem">
    <button onclick="window.print()" class="btn btn-secondary">Imprimir</button>
    <a href="/admin/pedidos/${id}/pdf" class="btn btn-secondary">Descargar PDF</a>
    ${isBorrador && can(c, 'pedidos.edit') ? `<a href="/admin/pedidos/${id}/edit" class="btn btn-secondary">Editar</a><button onclick="confirmar()" class="btn btn-primary">Confirmar pedido</button>` : ''}
    ${isConfirmado && can(c, 'albaranes.create') && hasPending ? `<a href="/admin/albaranes/new?order=${id}" class="btn btn-primary">Crear albarán (entregar)</a>` : ''}
    ${isConfirmado && !invoice && can(c, 'pedidos.edit') ? `<button onclick="facturar()" class="btn btn-secondary">Facturar pedido</button>` : ''}
    ${invoice ? `<a href="/admin/invoices/${invoice.id}" class="btn btn-secondary">Ver factura ${esc(invoice.invoice_number)}</a>` : ''}
    ${isConfirmado && can(c, 'pedidos.edit') ? `
      <button onclick="anular()" class="btn btn-danger">Anular</button>
      <button onclick="anularYRehacer()" class="btn btn-secondary">Anular y rehacer</button>` : ''}
    <a href="/admin/pedidos" class="btn btn-secondary">Volver al listado</a>
  </div>
</div></div>
<script>
  const CSRF=${JSON.stringify(csrfToken)}, OID=${id};
  async function call(path, body){ const r=await fetch('/api/erp/pedidos/'+OID+path,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':CSRF},body:JSON.stringify(body||{})}); const d=await r.json(); if(!r.ok||d.error) throw new Error(d.error||'Error'); return d; }
  async function confirmar(){ if(!confirm('Vas a CONFIRMAR el pedido: ganará número PED-NNNN, quedará bloqueado (corregir = anular y rehacer) y APARTARÁ (reservará) el stock físico para este cliente. ¿Continuar?')) return; try{ await call('/confirmar'); location.reload(); }catch(e){ alert(e.message); } }
  async function facturar(){ if(!confirm('Facturar este pedido directamente? Se creará una factura real con sus líneas (no mueve stock; la entrega va por albarán). La cadena es suelta: también puedes facturar desde un albarán.')) return; try{ const d=await call('/factura'); location.href='/admin/invoices/'+d.invoice_id; }catch(e){ alert(e.message); } }
  async function anular(){ const m=prompt('Motivo de la anulación (se liberará la reserva):'); if(m===null) return; if(!m.trim()){ alert('El motivo es obligatorio'); return; } try{ await call('/anular',{motivo:m.trim()}); location.reload(); }catch(e){ alert(e.message); } }
  async function anularYRehacer(){ const m=prompt('Motivo de la anulación (se creará un borrador nuevo con las mismas líneas):'); if(m===null) return; if(!m.trim()){ alert('El motivo es obligatorio'); return; } try{ const d=await call('/anular-y-rehacer',{motivo:m.trim()}); location.href='/admin/pedidos/'+d.id+'/edit'; }catch(e){ alert(e.message); } }
</script>`;
    return c.html(adminLayout('Pedido ' + (o.order_number || ('#' + id)), docShell(paper, panel), 'pedidos', csrfToken, c));
  });

  // PDF real del pedido — MISMA guarda que la ficha (pedidos.read), MISMO cuerpo imprimible
  // (orderDocumentBodyHtml) → printableShell → Chromium.
  views.get('/:id/pdf', requirePerm('pedidos.read'), async c => {
    try {
      const id = parseInt(c.req.param('id'));
      const o = getOrder(db, id);
      if (!o) return c.text('Pedido no encontrado', 404);
      const items = getItems(db, id);
      const { emisor, cliente } = docParties(db, o);
      const sym = o.currency_symbol || '€';
      const body = orderDocumentBodyHtml(o, items, emisor, cliente, sym);
      const pdf = await renderPdfFromHtml(printableShell(body, { title: 'Pedido ' + (o.order_number || ('#' + id)) }));
      const fname = ('Pedido-' + (o.order_number || ('' + id)) + '.pdf').replace(/[\/\\]/g, '-');
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + fname + '"' } });
    } catch (e) { return c.text('No se pudo generar el PDF: ' + e.message, e.status || 500); }
  });

  return { api, views };
}
