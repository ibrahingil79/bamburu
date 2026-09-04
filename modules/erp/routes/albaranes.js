import { Hono } from 'hono';
import { partesDe, membreteHtml } from '../documentos.js';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, docShell, printableShell, estadoTabs, emptyRow, errorShell, ERR } from '../layout.js';
import { renderPdfFromHtml } from '../../../core/pdf.js';   // PDF real: mismo HTML imprimible → Chromium
import { validate } from '../../../core/validate.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { albaranCreateSchema, albaranAnularSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { computeTotals, createInvoice } from './invoices.js';
import { recordMovement, isPhysical, resolveWarehouseId, availableOfProduct, productStockInWarehouse } from '../stock.js';
import { esTrazable, asignarFEFO, salirConTraza, revertirTrazaDeOrigen } from '../trazabilidad.js';   // Pilar 3: consumo/reingreso de lote/serie
import { activeWarehouses } from './warehouses.js';
import { lineSearchCellHtml, lineSearchScript } from '../views/line-search.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { jsonForScript } from '../../../core/escape.js';
import { fechaEs } from '../voz.js';   // la fecha, en cristiano (24/08/2026)

// ════════════════════════════════════════════════════════════════════════════
// PILAR 4 · VENTAS · PIEZA 2b — ALBARÁN (entrega). ESPEJO de la RECEPCIÓN de compra
// (purchase_order_receipts): documento DEL-NNNN INMUTABLE que CIERRA la cadena
// presupuesto→pedido→albarán→factura. Es el ÚNICO punto de ventas donde el stock SALE
// de verdad del libro. Dos orígenes: desde un PEDIDO confirmado (consume su reserva,
// parciales permitidos) o SUELTO (líneas de catálogo/libres, sin reserva previa). Foto
// congelada de empresa+cliente al confirmar. Corregir = anular (motivo) y rehacer; anular
// devuelve el stock al libro y, si venía de un pedido, esas unidades vuelven a reservar.
// Solo físicos mueven stock. NO reutiliza el clúster e-commerce viejo.
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function checkClient(db, clientId) {
  const c = db.prepare('SELECT id FROM clients WHERE id=?').get(clientId);
  if (!c) { const e = new Error('Cliente no encontrado'); e.status = 400; throw e; }
}

// IRPF: igual que la factura/pedido — solo ES + cliente empresa, con el % por defecto del negocio.
function albaranIrpfRate(db, clientId) {
  const cfg = db.prepare('SELECT country, irpf_default FROM company_config WHERE id=1').get() || {};
  if ((cfg.country || 'ES').toUpperCase() !== 'ES') return 0;
  const cl = clientId ? db.prepare('SELECT client_type FROM clients WHERE id=?').get(clientId) : null;
  return (cl && cl.client_type === 'empresa') ? (Number(cfg.irpf_default) || 0) : 0;
}

// Estado de ENTREGA del pedido, línea a línea y SIEMPRE derivado del dato (espejo de
// orderReceptionState): pedido (línea), entregado (suma de albaranes CONFIRMADOS), pendiente
// (nunca negativo). Incluye TODAS las líneas (físicas y no); solo las físicas mueven stock.
export function orderDeliveryState(db, orderId) {
  const lines = db.prepare(`
    SELECT oi.id AS order_item_id, oi.product_id, oi.description, oi.quantity AS pedido,
           oi.unit_price, oi.tax_rate, p.type AS product_type, p.sku,
           COALESCE((SELECT SUM(di.quantity) FROM delivery_note_items di
                       JOIN delivery_notes dn ON dn.id = di.delivery_note_id
                      WHERE di.order_item_id = oi.id AND dn.status='confirmado'), 0) AS entregado
      FROM customer_order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?
     ORDER BY oi.id`).all(orderId)
    .map(l => ({ ...l, pendiente: Math.max(0, l.pedido - l.entregado) }));
  const anyDelivered = lines.some(l => l.entregado > 0);
  const allDelivered = anyDelivered && lines.every(l => l.entregado >= l.pedido);
  return { lines, anyDelivered, allDelivered, totalPendiente: lines.reduce((s, l) => s + l.pendiente, 0) };
}

// Recalcula y guarda delivered_status (caché aditiva, espejo de received_status):
// NULL (sin entregas) | 'parcial' | 'entregado'. El pedido NO cambia su status.
export function recalcDeliveredStatus(db, orderId) {
  if (!orderId) return null;
  const st = orderDeliveryState(db, orderId);
  const val = !st.anyDelivered ? null : (st.allDelivered ? 'entregado' : 'parcial');
  db.prepare('UPDATE customer_orders SET delivered_status=? WHERE id=?').run(val, orderId);
  return val;
}

export function getAlbaran(db, id) {
  const a = db.prepare(`
    SELECT a.*, c.name AS client_live_name, w.name AS warehouse_name, o.order_number
      FROM delivery_notes a
      JOIN clients c ON c.id = a.client_id
      LEFT JOIN warehouses w ON w.id = a.warehouse_id
      LEFT JOIN customer_orders o ON o.id = a.order_id
     WHERE a.id = ?`).get(id);
  if (!a) return null;
  const items = db.prepare('SELECT di.*, p.sku, p.type AS product_type FROM delivery_note_items di LEFT JOIN products p ON di.product_id=p.id WHERE di.delivery_note_id=? ORDER BY di.id').all(id);
  return { ...a, items };
}

function albaranesOfOrder(db, orderId) {
  return db.prepare(`SELECT a.*, (SELECT COALESCE(SUM(quantity),0) FROM delivery_note_items WHERE delivery_note_id=a.id) AS units
    FROM delivery_notes a WHERE a.order_id=? ORDER BY a.id`).all(orderId);
}

function insertItems(db, dnId, lines) {
  const ins = db.prepare('INSERT INTO delivery_note_items (delivery_note_id, order_item_id, product_id, description, quantity, unit_price, total_price, tax_rate, tax_amount, fiscal_treatment, fiscal_exemption_code, fiscal_non_subject_code, fiscal_reverse_charge, fiscal_legal_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const l of lines) {
    const base = Math.round(l.quantity * l.unit_price * 100) / 100;
    const tax = (l.fiscal_treatment !== 'taxable' || l.fiscal_reverse_charge) ? 0 : Math.round(base * l.tax_rate / 100 * 100) / 100;
    ins.run(dnId, l.order_item_id || null, l.product_id || null, l.description, l.quantity, l.unit_price, base, l.tax_rate, tax, l.fiscal_treatment || 'pending', l.fiscal_exemption_code || null, l.fiscal_non_subject_code || null, l.fiscal_reverse_charge || 0, l.fiscal_legal_text || null);
  }
}

// ── SERVICIO: crear y confirmar un albarán (un solo paso; el confirm-first es de UI) ──
// Dos modos: DESDE PEDIDO (d.order_id) — líneas tomadas del pedido, cantidad ≤ pendiente,
// consume reserva — o SUELTO (d.client_id) — líneas de catálogo/libres, sin reserva. Confirmar
// = salida al libro por cada línea FÍSICA desde el almacén de salida. Guarda de disponible/stock
// (aviso-confirmado: confirm_over). Foto congelada de empresa+cliente.
export function createAlbaranSvc(db, d) {
  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const date = d.date || new Date().toISOString().slice(0, 10);
  let order = null, client_id, wid, resolved = [];

  if (d.order_id) {
    order = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(d.order_id);
    if (!order) { const e = new Error('Pedido no encontrado'); e.status = 404; throw e; }
    if (order.status !== 'confirmado') { const e = new Error('Solo se puede entregar (albarán) un pedido CONFIRMADO'); e.status = 400; throw e; }
    client_id = order.client_id;
    wid = order.warehouse_id || resolveWarehouseId(db, null);
    const state = orderDeliveryState(db, d.order_id);
    if (!state.lines.some(l => l.pendiente > 0)) { const e = new Error('El pedido ya está completamente entregado'); e.status = 400; throw e; }
    const byId = new Map(state.lines.map(l => [l.order_item_id, l]));
    const seen = new Set();
    for (const it of d.lines) {
      if (!it.order_item_id) { const e = new Error('Cada línea del albarán de pedido debe referenciar una línea del pedido'); e.status = 400; throw e; }
      const line = byId.get(it.order_item_id);
      if (!line) { const e = new Error('Una de las líneas no corresponde a este pedido'); e.status = 400; throw e; }
      if (seen.has(it.order_item_id)) { const e = new Error('Línea repetida en el albarán ("' + esc(line.description) + '")'); e.status = 400; throw e; }
      seen.add(it.order_item_id);
      if (!(it.quantity > 0)) continue;
      if (it.quantity > line.pendiente) {   // guarda ≤ pendiente (entregar de más NO entra en la 2b)
        const e = new Error('"' + line.description + '": pendiente ' + line.pendiente + ', intentas entregar ' + it.quantity + '. No se puede entregar más de lo pendiente.');
        e.status = 400; throw e;
      }
      // descripción/precio/IVA SIEMPRE del pedido (no se confía en el cliente).
      resolved.push({ order_item_id: line.order_item_id, product_id: line.product_id, description: line.description,
        quantity: it.quantity, unit_price: line.unit_price, tax_rate: line.tax_rate, product_type: line.product_type,
        fiscal_treatment:line.fiscal_treatment,fiscal_exemption_code:line.fiscal_exemption_code,fiscal_non_subject_code:line.fiscal_non_subject_code,fiscal_reverse_charge:line.fiscal_reverse_charge,fiscal_legal_text:line.fiscal_legal_text });
    }
    if (!resolved.length) { const e = new Error('Indica al menos una línea con cantidad a entregar'); e.status = 400; throw e; }
  } else {
    // Albarán SUELTO: cliente obligatorio, almacén elegible, líneas de catálogo o libres.
    if (!d.client_id) { const e = new Error('Indica el cliente del albarán'); e.status = 400; throw e; }
    checkClient(db, d.client_id);
    client_id = d.client_id;
    wid = resolveWarehouseId(db, d.warehouse_id);
    const get = db.prepare('SELECT id, name, tax_rate, type, fiscal_treatment, fiscal_exemption_code, fiscal_non_subject_code, fiscal_reverse_charge, fiscal_legal_text FROM products WHERE id=?');
    for (const it of d.lines) {
      let product_id = null, tax_rate = Number(it.tax_rate) || 0, description = String(it.description || '').trim(), product_type = null;
      if (it.product_id) {
        const p = get.get(it.product_id);
        if (p) { product_id = p.id; tax_rate = Number(p.tax_rate) || 0; product_type = p.type; Object.assign(it, p); if (!description) description = p.name; }
      }
      resolved.push({ order_item_id: null, product_id, description: description || '_', quantity: Number(it.quantity), unit_price: Number(it.unit_price), tax_rate, product_type, fiscal_treatment:it.fiscal_treatment || (tax_rate>0?'taxable':'pending'), fiscal_exemption_code:it.fiscal_exemption_code, fiscal_non_subject_code:it.fiscal_non_subject_code, fiscal_reverse_charge:it.fiscal_reverse_charge, fiscal_legal_text:it.fiscal_legal_text });
    }
  }

  // Guarda de DISPONIBLE/stock por línea física (aviso-confirmado, nunca en silencio):
  //  · desde pedido → mira el STOCK físico del almacén (la reserva es de este pedido).
  //  · suelto → mira el DISPONIBLE (= stock − reservado por otros): no entregar lo apartado a otros.
  const shortfall = [];
  for (const l of resolved) {
    const phys = l.product_id && isPhysical(db, l.product_id);
    if (!phys) continue;
    const limit = l.order_item_id ? productStockInWarehouse(db, l.product_id, wid) : availableOfProduct(db, l.product_id, wid);
    if (l.quantity > limit) {
      const wh = db.prepare('SELECT name FROM warehouses WHERE id=?').get(wid);
      shortfall.push('"' + l.description + '": ' + (l.order_item_id ? 'stock' : 'disponible') + ' en ' + (wh ? wh.name : 'el almacén') + ' ' + limit + ', entregas ' + l.quantity);
    }
  }
  if (shortfall.length && !d.confirm_over) {
    const e = new Error('La entrega supera lo disponible — ' + shortfall.join('; ') + '. Para entregar igualmente confírmalo (confirm_over).');
    e.status = 400; e.shortfall = shortfall; throw e;
  }

  const irpf_rate = order ? order.irpf_rate : albaranIrpfRate(db, client_id);
  const tot = computeTotals(resolved, irpf_rate);
  const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(client_id) || {};

  const run = db.transaction(() => {
    const number = nextCode(db, 'delivery_note');
    const r = db.prepare(`INSERT INTO delivery_notes
      (delivery_number, client_id, order_id, warehouse_id, date, notes,
       company_name, company_fiscal_id, company_address, company_phone, company_email, company_logo_id,
       client_name, client_fiscal_id, client_address, client_email,
       subtotal, tax_amount, irpf_rate, irpf_amount, total, currency, currency_symbol)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      number, client_id, d.order_id || null, wid, date, d.notes || '',
      cfg.company_name || '', cfg.fiscal_id || '', cfg.address || '', cfg.phone || '', cfg.email || '', cfg.company_logo_id || null,
      cl.name || '', cl.fiscal_id || '', cl.address || '', cl.email || '',
      tot.subtotal, tot.taxAmount, irpf_rate, tot.irpfAmount, tot.total,
      cfg.currency || 'EUR', cfg.currency_symbol || '€');
    const id = r.lastInsertRowid;
    insertItems(db, id, resolved);
    // SALIDA real al libro por cada línea FÍSICA (la entrega es el único punto que mueve stock).
    const notaAlb = 'Albarán ' + number + (order ? ' (pedido ' + (order.order_number || ('#' + order.id)) + ')' : ' (suelto)');
    for (const l of resolved) {
      if (l.product_id && isPhysical(db, l.product_id)) {
        if (esTrazable(db, l.product_id)) {
          // Trazado: consumo por lote/serie con FEFO (no se puede entregar más de lo que hay trazado).
          const alloc = asignarFEFO(db, l.product_id, wid, l.quantity);
          salirConTraza(db, { product_id: l.product_id, warehouse_id: wid, origin_type: 'delivery_note', origin_id: id,
            note: notaAlb, asignacion: alloc, cantidad: l.quantity });
        } else {
          recordMovement(db, { product_id: l.product_id, type: 'salida', quantity: -l.quantity,
            origin_type: 'delivery_note', origin_id: id, warehouse_id: wid, note: notaAlb });
        }
      }
    }
    const order_delivered_status = recalcDeliveredStatus(db, d.order_id);
    return { id, delivery_number: number, order_id: d.order_id || null, lines: resolved.length, over: shortfall.length, order_delivered_status };
  });
  return run();
}

// ── SERVICIO: anular un albarán confirmado (motivo obligatorio) ──────────────
// Re-entra el stock al libro (entrada inversa por línea física) y, si venía de un pedido,
// recalcula su estado de entrega (el pendiente sube → esas unidades vuelven a reservar).
// Integridad: no se anula un albarán ya FACTURADO (anula antes la factura por su vía legal).
export function cancelAlbaranSvc(db, id, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const a = db.prepare('SELECT * FROM delivery_notes WHERE id=?').get(id);
  if (!a) { const e = new Error('Albarán no encontrado'); e.status = 404; throw e; }
  if (a.status !== 'confirmado') { const e = new Error('Este albarán ya está anulado'); e.status = 400; throw e; }
  // Integridad bidireccional: si el albarán está facturado (factura NO anulada), hay que
  // deshacer antes esa factura por su vía legal (anular/rectificar), o el stock descuadraría.
  const link = db.prepare("SELECT dest_id FROM document_links WHERE source_type='delivery_note' AND source_id=? AND dest_type='invoice'").get(id);
  if (link) {
    const inv = db.prepare('SELECT invoice_number, status FROM invoices WHERE id=?').get(link.dest_id);
    if (inv && inv.status !== 'anulada') {
      const e = new Error('Este albarán está facturado en ' + (inv.invoice_number || ('#' + link.dest_id)) + '. Anula o rectifica antes esa factura por su vía legal.'); e.status = 409; throw e;
    }
  }
  const items = db.prepare('SELECT * FROM delivery_note_items WHERE delivery_note_id=?').all(id);
  const notaAnul = 'Anulación del albarán ' + (a.delivery_number || ('#' + id));
  const run = db.transaction(() => {
    // Trazado: reingreso a SU lote (revierte los movimientos con lote de este albarán).
    revertirTrazaDeOrigen(db, 'delivery_note', id, { type: 'entrada', note: notaAnul });
    for (const it of items) {
      if (it.product_id && isPhysical(db, it.product_id) && !esTrazable(db, it.product_id)) {
        recordMovement(db, { product_id: it.product_id, type: 'entrada', quantity: it.quantity,
          origin_type: 'delivery_note', origin_id: id, warehouse_id: a.warehouse_id, note: notaAnul });
      }
    }
    db.prepare("UPDATE delivery_notes SET status='anulado', anulada_motivo=? WHERE id=?").run(m, id);
    const order_delivered_status = recalcDeliveredStatus(db, a.order_id);
    return { id, delivery_number: a.delivery_number, order_id: a.order_id, reverted_lines: items.length, order_delivered_status };
  });
  return run();
}

// ── MOTOR DE CONVERSIÓN: albarán → FACTURA (factura lo ENTREGADO) ────────────
// Arrastra las líneas del albarán a una factura real (createInvoice, vía legal intacta) con
// enlace bidireccional en document_links. La factura NO mueve stock (lo movió el albarán). Sin
// gate de exceso de stock: lo entregado ya salió; aplicarlo daría un falso positivo.
export function albaranToInvoiceSvc(db, id) {
  const a = db.prepare('SELECT * FROM delivery_notes WHERE id=?').get(id);
  if (!a) { const e = new Error('Albarán no encontrado'); e.status = 404; throw e; }
  if (a.status !== 'confirmado') { const e = new Error('Solo se puede facturar un albarán confirmado'); e.status = 400; throw e; }
  const already = db.prepare("SELECT dest_id FROM document_links WHERE source_type='delivery_note' AND source_id=? AND dest_type='invoice'").get(id);
  if (already) {
    const inv = db.prepare('SELECT invoice_number FROM invoices WHERE id=?').get(already.dest_id);
    const e = new Error('Este albarán ya se facturó en ' + (inv ? inv.invoice_number : '#' + already.dest_id) + '.'); e.status = 400; throw e;
  }
  const items = db.prepare('SELECT * FROM delivery_note_items WHERE delivery_note_id=? ORDER BY id').all(id);
  const lines = items.map(i => ({ ...i, product_id: i.product_id || undefined }));
  const run = db.transaction(() => {
    const inv = createInvoice(db, { client_id: a.client_id, lines, irpf_rate: a.irpf_rate, notes: 'Procede del albarán ' + (a.delivery_number || ('#' + id)) });
    db.prepare("INSERT INTO document_links (source_type, source_id, dest_type, dest_id) VALUES ('delivery_note', ?, 'invoice', ?)").run(id, inv.id);
    return { invoice_id: inv.id, invoice_number: inv.invoice_number };
  });
  return run();
}

// ── Documento (compartido) ───────────────────────────────────────────────────
// La regla «foto congelada o configuración en vivo» YA NO VIVE AQUÍ. Estaba copiada en este
// fichero y en otros tres, idéntica carácter por carácter, y es una REGLA DE NEGOCIO: el día
// que alguien tocara una, las otras tres seguirían diciendo lo de antes. Vive en
// `documentos.js` y aquí solo se dice con qué contraparte se pide.
const docParties = (db, a) => partesDe(db, a, 'cliente');

function albaranDocumentBodyHtml(a, items, emisor, cliente, sym) {
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3)">${esc(i.description)}${i.sku ? ` <span style="color:var(--text2);font-size:11px">[${esc(i.sku)}]</span>` : ''}${(i.product_type && i.product_type !== 'physical') ? ' <span style="color:var(--text2);font-size:11px">(no mueve stock)</span>' : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${i.quantity}</td>
    </tr>`).join('');
  return `
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
  <div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 4px">Albarán de entrega</h1>
    <div style="color:var(--text2);font-size:12px">${a.delivery_number ? esc(a.delivery_number) : 'Sin número'}</div>
  </div>
  <div style="text-align:right;color:var(--text2);font-size:12px">
    <div>Fecha: <strong style="color:var(--accent-d)">${fechaEs(a.date)}</strong></div>
    ${a.order_number ? `<div>Pedido: <strong style="color:var(--accent-d)">${esc(a.order_number)}</strong></div>` : ''}
  </div>
</div>
${membreteHtml({ emisor, otra: cliente, rotuloOtra: 'Entregar a',
                 camposEmisor: ['fiscal_id', 'address'],
                 camposOtra: ['fiscal_id', 'address'] })}
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
  <thead><tr>
    <th style="background:var(--bg);padding:8px 12px;text-align:left;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Concepto entregado</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Cantidad</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
${a.notes ? `<div style="margin-top:16px;color:var(--text2)">${esc(a.notes)}</div>` : ''}
<div style="margin-top:8px;color:var(--text3);font-size:11px">Documento de ENTREGA (no es factura). Importe a facturar aparte.</div>`;
}

// ── Rutas ────────────────────────────────────────────────────────────────────
export function createAlbaranRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API ──
  api.get('/:id', requirePerm('albaranes.read'), c => {
    try {
      const a = getAlbaran(db, parseInt(c.req.param('id')));
      if (!a) return c.json({ error: 'No encontrado' }, 404);
      return c.json(a);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/', requirePerm('albaranes.create'), validate(albaranCreateSchema), c => {
    try {
      const r = createAlbaranSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Confirmó albarán (entrega)', ENTITY.DELIVERY_NOTE, r.id, r.delivery_number + (r.order_id ? ' (pedido #' + r.order_id + ')' : ' (suelto)'));
      return c.json({ ...r, message: 'Albarán ' + r.delivery_number + ' confirmado (stock entregado)' }, 201);
    } catch (e) { return c.json({ error: safeError(e), shortfall: e.shortfall }, e.status || 500); }
  });

  api.post('/:id/anular', requirePerm('albaranes.edit'), validate(albaranAnularSchema), c => {
    try {
      const r = cancelAlbaranSvc(db, parseInt(c.req.param('id')), c.get('validated').motivo);
      logActivity(db, c.get('session'), 'Anuló albarán', ENTITY.DELIVERY_NOTE, r.id, (r.delivery_number || '') + ' — ' + c.get('validated').motivo);
      return c.json({ ...r, message: 'Albarán anulado y stock revertido' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/:id/factura', requirePerm('albaranes.edit'), c => {
    try {
      const r = albaranToInvoiceSvc(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Facturó albarán', ENTITY.DELIVERY_NOTE, parseInt(c.req.param('id')), r.invoice_number);
      return c.json({ ...r, message: 'Albarán facturado en ' + r.invoice_number });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── VISTAS ──
  // Lista (patrón pedido): búsqueda por cliente o número, filtro por estado, paginación 25.
  views.get('/', requirePerm('albaranes.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const qstr = (c.req.query('q') || '').trim();
    const estado = (c.req.query('estado') || '').trim();
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    const where = [], params = [];
    if (qstr) { where.push('(cl.name LIKE ? OR a.delivery_number LIKE ?)'); params.push('%' + qstr + '%', '%' + qstr + '%'); }
    if (estado === 'confirmado' || estado === 'anulado') { where.push('a.status=?'); params.push(estado); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare('SELECT COUNT(*) AS n FROM delivery_notes a JOIN clients cl ON a.client_id=cl.id ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const rows = db.prepare('SELECT a.*, cl.name AS client_live_name FROM delivery_notes a JOIN clients cl ON a.client_id=cl.id ' + whereSql + ' ORDER BY a.date DESC, a.id DESC LIMIT ? OFFSET ?').all(...params, perPage, (page - 1) * perPage);
    const buildQs = (p) => { const u = new URLSearchParams(); if (qstr) u.set('q', qstr); if (estado) u.set('estado', estado); u.set('page', String(p)); return u.toString(); };
    const rowsHtml = rows.map(a => {
      const name = a.company_name != null ? (a.client_name || a.client_live_name) : a.client_live_name;
      const [lbl, badge] = a.status === 'anulado' ? ['Anulado', 'b-red'] : ['Confirmado', 'b-green'];
      return '<tr>'
        + '<td><strong style="font-family:monospace">' + esc(a.delivery_number || ('#' + a.id)) + '</strong></td>'
        + '<td><strong>' + esc(name) + '</strong></td>'
        + '<td>' + fechaEs(a.date) + '</td>'
        + '<td><span class="badge ' + badge + '">' + esc(lbl) + '</span></td>'
        + '<td style="text-align:right"><a href="/admin/albaranes/' + a.id + '" class="btn btn-secondary btn-sm">Ver</a></td>'
        + '</tr>';
    }).join('');
    const estadoTabsHtml = estadoTabs(estado, [['', 'Todos'], ['confirmado', 'Confirmados'], ['anulado', 'Anulados']], qstr);
    const content = `
      <div class="ph">
        <h2>Albaranes</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${esc(qstr)}" placeholder="Buscar por cliente o número...">
          <input type="hidden" name="estado" value="${esc(estado)}">
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'albaranes.create') ? '<a href="/admin/albaranes/new" class="btn btn-primary">Albarán suelto</a>' : ''}
        </form>
      </div>
      ${estadoTabsHtml}
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
        <tbody>${total === 0 ? ((qstr || estado) ? emptyRow(5, 'No se encontraron albaranes con ese filtro.', { icon: 'ti-search' }) : emptyRow(5, 'Aún no hay albaranes. Un albarán sale de entregar un pedido; también puedes crear uno suelto.', { cta: 'Nuevo albarán', href: '/admin/albaranes/new', soft: true })) : rowsHtml}</tbody>
      </table></div></div>
      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--text3);font-size:.85rem">Página ${page} de ${totalPages} · ${total} albarán${total === 1 ? '' : 'es'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : ''}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : ''}
        </div></div>` : ''}`;
    return c.html(adminLayout('Albaranes', content, 'albaranes', c.get('session')?.csrfToken || '', c));
  });

  // Formulario: desde pedido (?order=ID, líneas pendientes con cantidad editable a la baja) o
  // suelto (cliente + almacén + líneas de catálogo/libres con line-search).
  views.get('/new', requirePerm('albaranes.create'), c => {
    const csrfToken = c.get('session')?.csrfToken || '';
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const orderId = parseInt(c.req.query('order') || '0', 10) || null;

    if (orderId) {
      const o = db.prepare('SELECT o.*, c.name AS client_name FROM customer_orders o JOIN clients c ON c.id=o.client_id WHERE o.id=?').get(orderId);
      if (!o || o.status !== 'confirmado') return c.redirect('/admin/pedidos/' + orderId);
      const state = orderDeliveryState(db, orderId);
      const pend = state.lines.filter(l => l.pendiente > 0);
      if (!pend.length) return c.redirect('/admin/pedidos/' + orderId);
      const linesJson = jsonForScript(pend.map(l => ({ order_item_id: l.order_item_id, description: l.description, pendiente: l.pendiente, sku: l.sku || '' })));
      const content = `
        <div class="ph"><h2>Entregar pedido ${esc(o.order_number || ('#' + orderId))}</h2><a href="/admin/pedidos/${orderId}" class="btn btn-secondary">Volver al pedido</a></div>
        <div class="card" style="max-width:820px"><div class="card-body">
          <div style="color:var(--muted);margin-bottom:1rem">Cliente: <strong>${esc(o.client_name)}</strong> · Almacén de salida: <strong>${esc(db.prepare('SELECT name FROM warehouses WHERE id=?').get(o.warehouse_id)?.name || 'Principal')}</strong></div>
          <div class="form-group"><label class="form-label">Fecha de entrega</label><input type="date" id="f-date" class="form-control" value="${new Date().toISOString().slice(0, 10)}" style="max-width:200px"></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Concepto</th><th style="width:110px">Pendiente</th><th style="width:130px">Entregar</th></tr></thead>
            <tbody id="lines-body"></tbody>
          </table></div>
          <div class="form-group" style="margin-top:1rem"><label class="form-label">Notas (opcional)</label><textarea id="f-notes" class="form-control" rows="2"></textarea></div>
          <div style="text-align:right;margin-top:1rem"><button class="btn btn-primary" id="btn-save" onclick="saveAlbaran()">Confirmar entrega</button></div>
        </div></div>
        <script nonce="${c.get('cspNonce')}">
        const CSRF=${JSON.stringify(csrfToken)}, ORDER_ID=${orderId}, PEND=${linesJson};
        function render(){
          document.getElementById('lines-body').innerHTML = PEND.map(function(l,i){
            return '<tr><td>'+(l.sku?'<span style="color:var(--muted);font-size:.8rem">['+escHtml(l.sku)+'] </span>':'')+escHtml(l.description)+'</td>'
              +'<td>'+l.pendiente+'</td>'
              +'<td><input type="number" class="form-control q" data-oi="'+l.order_item_id+'" step="1" min="0" max="'+l.pendiente+'" value="'+l.pendiente+'"></td></tr>';
          }).join('');
        }
        async function saveAlbaran(over){
          const lines=[];
          document.querySelectorAll('#lines-body .q').forEach(function(inp){
            const q=parseFloat(inp.value)||0; if(q>0) lines.push({ order_item_id: parseInt(inp.dataset.oi), quantity: q, description:'_', unit_price:0 });
          });
          if(!lines.length){ toast('Indica alguna cantidad a entregar','err'); return; }
          const btn=document.getElementById('btn-save'); btn.disabled=true;
          try {
            const body={ order_id: ORDER_ID, date: document.getElementById('f-date').value||undefined, notes: document.getElementById('f-notes').value||'', lines, confirm_over: !!over };
            let r; try{ r=await fetch('/api/erp/albaranes',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':CSRF},body:JSON.stringify(body)}); }catch(_e){ throw new Error(window.ERR.NET); }
            let d; try{ d=await r.json(); }catch(_e){ d=null; } if(!r.ok||!d||d.error){
              const em=window.cleanErrMsg((d&&d.error)||'');
              if(/disponible|supera/i.test(em) && !over && await window.confirmarEnPagina({titulo:'No hay stock suficiente',texto:em,aceptar:'Entregar igualmente'})){ btn.disabled=false; return saveAlbaran(true); }
              throw new Error(em); }
            window.location.href='/admin/albaranes/'+d.id;
          } catch(e){ toast(e.message||'Error','err'); btn.disabled=false; }
        }
        render();
        </script>`;
      return c.html(adminLayout('Entregar pedido', content, 'albaranes', csrfToken, c));
    }

    // Albarán SUELTO
    const clients = db.prepare("SELECT id, name, fiscal_id FROM clients ORDER BY name").all();
    if (!clients.length) return c.html(adminLayout('Nuevo albarán', `<div class="ph"><h2>Nuevo albarán</h2><a href="/admin/albaranes" class="btn btn-secondary">Volver</a></div><div class="card card-body" style="text-align:center;padding:2rem;color:var(--text3)">No hay clientes. <a href="/admin/clients">Crea uno primero.</a></div>`, 'albaranes', csrfToken, c));
    const warehouses = activeWarehouses(db);
    const defWh = (warehouses.find(w => w.is_default) || warehouses[0] || {}).id || '';
    const clientOpts = clients.map(cl => '<option value="' + cl.id + '">' + esc(cl.name) + (cl.fiscal_id ? ' — ' + esc(cl.fiscal_id) : '') + '</option>').join('');
    const whOpts = warehouses.map(w => '<option value="' + w.id + '"' + (w.id === defWh ? ' selected' : '') + '>' + esc(w.name) + (w.is_default ? ' (principal)' : '') + '</option>').join('');
    const content = `
      <div class="ph"><h2>Albarán suelto (sin pedido)</h2><a href="/admin/albaranes" class="btn btn-secondary">Volver</a></div>
      <div class="card" style="max-width:960px"><div class="card-body">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Cliente *</label><select id="f-client" class="form-control"><option value="">— Selecciona cliente —</option>${clientOpts}</select></div>
          <div class="form-group"><label class="form-label">Almacén de salida</label><select id="f-warehouse" class="form-control">${whOpts}</select></div>
          <div class="form-group"><label class="form-label">Fecha</label><input type="date" id="f-date" class="form-control" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <hr style="margin:1.25rem 0;border:none;border-top:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <h3 style="font-size:.9rem;font-weight:600;margin:0">Líneas a entregar</h3>
          <button class="btn btn-secondary btn-sm" onclick="addLine()">+ Añadir línea</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Concepto</th><th style="width:120px">Cantidad</th><th style="width:36px"></th></tr></thead>
          <tbody id="lines-body"></tbody>
        </table></div>
        <div class="form-group" style="margin-top:1.25rem"><label class="form-label">Notas (opcional)</label><textarea id="f-notes" class="form-control" rows="2"></textarea></div>
        <div style="text-align:right;margin-top:1rem"><button class="btn btn-primary" id="btn-save" onclick="saveAlbaran()">Confirmar entrega</button></div>
      </div></div>
      <script nonce="${c.get('cspNonce')}">
      const CSRF=${JSON.stringify(csrfToken)};
      const LINE_CELL=${JSON.stringify(lineSearchCellHtml('<input type="hidden" class="line-pid"><input type="hidden" class="line-pname"><input type="hidden" class="line-price"><input type="hidden" class="line-tax" value="21">'))};
      let catalog=[];
      async function loadAll(){ try { const prods=await api('GET','/api/erp/products').catch(()=>[]); catalog=(prods||[]).filter(p=>p.status==='active'); } catch(e){} addLine(); }
      function addLine(){
        const tbody=document.getElementById('lines-body'); const row=document.createElement('tr');
        row.innerHTML = LINE_CELL
          + '<td><input type="number" class="form-control line-qty" step="1" min="1" value="1"></td>'
          + '<td><button class="btn btn-danger btn-sm" onclick="this.closest(\\'tr\\').remove()">✕</button></td>';
        tbody.appendChild(row);
      }
      ${lineSearchScript()}
      function applyLinePick(row,p){
        row.querySelector('.line-desc').value=p.name;
        row.querySelector('.line-price').value=Number(p.price||0).toFixed(2);
        row.querySelector('.line-tax').value=String(Number(p.tax_rate)||0);
        row.querySelector('.line-pid').value=p.id;
        row.querySelector('.line-pname').value=p.name;
      }
      function lineProduct(row){ const pid=row.querySelector('.line-pid'); if(!pid||!pid.value) return null; if((row.querySelector('.line-desc').value||'').trim()!==(row.querySelector('.line-pname').value||'').trim()) return null; return parseInt(pid.value); }
      async function saveAlbaran(over){
        const client_id=parseInt(document.getElementById('f-client').value);
        if(!client_id){ toast('Selecciona un cliente','err'); return; }
        const lines=[];
        for (const r of document.querySelectorAll('#lines-body tr')){
          const desc=(r.querySelector('.line-desc').value||'').trim();
          const qty=parseFloat(r.querySelector('.line-qty').value)||0;
          if(!desc){ toast('Falta concepto en una línea','err'); return; }
          if(!(qty>0)){ toast('Cantidad debe ser > 0','err'); return; }
          lines.push({ description: desc, quantity: qty, unit_price: parseFloat(r.querySelector('.line-price').value)||0, tax_rate: parseFloat(r.querySelector('.line-tax').value)||0, product_id: lineProduct(r) });
        }
        if(!lines.length){ toast('Añade al menos una línea','err'); return; }
        const btn=document.getElementById('btn-save'); btn.disabled=true;
        try {
          const body={ client_id, warehouse_id: parseInt(document.getElementById('f-warehouse').value)||null, date: document.getElementById('f-date').value||undefined, notes: document.getElementById('f-notes').value||'', lines, confirm_over: !!over };
          let r; try{ r=await fetch('/api/erp/albaranes',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':CSRF},body:JSON.stringify(body)}); }catch(_e){ throw new Error(window.ERR.NET); }
          let d; try{ d=await r.json(); }catch(_e){ d=null; } if(!r.ok||!d||d.error){
            const em=window.cleanErrMsg((d&&d.error)||'');
            if(/disponible|supera/i.test(em) && !over && await window.confirmarEnPagina({titulo:'No hay stock suficiente',texto:em,aceptar:'Entregar igualmente'})){ btn.disabled=false; return saveAlbaran(true); }
            throw new Error(em); }
          window.location.href='/admin/albaranes/'+d.id;
        } catch(e){ toast(e.message||'Error','err'); btn.disabled=false; }
      }
      loadAll();
      </script>`;
    return c.html(adminLayout('Nuevo albarán', content, 'albaranes', csrfToken, c));
  });

  // Documento del albarán + panel de acciones (anular / facturar).
  views.get('/:id', requirePerm('albaranes.read'), c => {
    const id = parseInt(c.req.param('id'));
    const a = getAlbaran(db, id);
    if (!a) return c.html(errorShell('No encontramos este albarán', 'Puede que se haya anulado o que el enlace ya no sea válido.', { action: 'Ver albaranes', href: '/admin/albaranes' }), 404);
    const { emisor, cliente } = docParties(db, a);
    const sym = a.currency_symbol || '€';
    const csrfToken = c.get('session')?.csrfToken || '';
    const invLink = db.prepare("SELECT dest_id FROM document_links WHERE source_type='delivery_note' AND source_id=? AND dest_type='invoice'").get(id);
    const invoice = invLink ? db.prepare('SELECT id, invoice_number FROM invoices WHERE id=?').get(invLink.dest_id) : null;

    let lifecycle = '';
    if (a.status === 'anulado') lifecycle += `<div class="alert alert-err" style="margin-bottom:18px"><strong>Albarán anulado.</strong> Motivo: ${esc(a.anulada_motivo || '')}. El stock que salió se revirtió${a.order_id ? ' y esas unidades vuelven a reservarse en el pedido' : ''}.</div>`;
    if (a.order_id && a.order_number) lifecycle += `<div class="alert" style="margin-bottom:18px;background:var(--info-s);color:var(--info);border:1px solid var(--info)">Entrega del pedido <a href="/admin/pedidos/${a.order_id}" style="color:inherit;font-weight:600">${esc(a.order_number)}</a>.</div>`;
    if (invoice) lifecycle += `<div class="alert" style="margin-bottom:18px;background:var(--ok-s);color:var(--ok);border:1px solid var(--ok-s)">Facturado en <a href="/admin/invoices/${invoice.id}" style="color:inherit;font-weight:600">${esc(invoice.invoice_number)}</a>.</div>`;

    const paper = `${lifecycle}${albaranDocumentBodyHtml(a, a.items, emisor, cliente, sym)}`;
    const [lbl, badge] = a.status === 'anulado' ? ['Anulado', 'b-red'] : ['Confirmado', 'b-green'];
    const isConfirmed = a.status === 'confirmado';
    const panel = `
<div class="card"><div class="card-body">
  <div style="margin-bottom:12px"><span class="badge ${badge}">${esc(lbl)}</span></div>
  <div class="dp-row"><span class="k">Nº</span><span class="v">${esc(a.delivery_number || ('#' + id))}</span></div>
  <div class="dp-row"><span class="k">Cliente</span><span class="v">${esc(a.company_name != null ? (a.client_name || '') : (cliente.name || ''))}</span></div>
  <div class="dp-row"><span class="k">Almacén</span><span class="v">${esc(a.warehouse_name || 'Principal')}</span></div>
  ${a.order_number ? `<div class="dp-row"><span class="k">Pedido</span><span class="v">${esc(a.order_number)}</span></div>` : ''}
  <div class="dp-actions" style="margin-top:14px;display:flex;flex-direction:column;gap:.5rem">
    <button data-act="imprimir" class="btn btn-secondary">Imprimir</button>
    <a href="/admin/albaranes/${id}/pdf" class="btn btn-secondary">Descargar PDF</a>
    ${isConfirmed && !invoice && can(c, 'albaranes.edit') ? `<button onclick="facturar()" class="btn btn-primary">Facturar este albarán</button>` : ''}
    ${invoice ? `<a href="/admin/invoices/${invoice.id}" class="btn btn-secondary">Ver factura ${esc(invoice.invoice_number)}</a>` : ''}
    ${isConfirmed && can(c, 'albaranes.edit') ? `<button onclick="anular()" class="btn btn-danger">Anular</button>` : ''}
    <a href="/admin/albaranes" class="btn btn-secondary">Volver al listado</a>
  </div>
</div></div>
<script nonce="${c.get('cspNonce')}">
  const CSRF=${JSON.stringify(csrfToken)}, AID=${id};
  async function call(path, body){ let r; try{ r=await fetch('/api/erp/albaranes/'+AID+path,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':CSRF},body:JSON.stringify(body||{})}); }catch(_e){ throw new Error(window.ERR.NET); } let d; try{ d=await r.json(); }catch(_e){ d=null; } if(!r.ok||!d||d.error) throw new Error(window.cleanErrMsg((d&&d.error)||'')); return d; }
  async function facturar(){
    if(!await window.confirmarEnPagina({titulo:'Facturar el albarán',
      texto:'Se creará una factura real con las líneas entregadas. El stock ya salió con el albarán, así que esto no lo mueve.',
      aceptar:'Sí, facturar'})) return; try{ const d=await call('/factura'); location.href='/admin/invoices/'+d.invoice_id; }catch(e){ toast(e.message,'err'); } }
  async function anular(){
    const v = await window.pedirDatos({titulo:'Anular el albarán',aceptar:'Anular',
      texto:'Se revertirá el stock que salió con él.',
      campos:[{id:'m',etiqueta:'Motivo de la anulación',ayuda:'Queda guardado con el albarán.'}],
      validar:v2 => !String(v2.m||'').trim() ? {campo:'m',mensaje:'El motivo es obligatorio.'} : null});
    if(!v) return; const m=String(v.m); try{ await call('/anular',{motivo:m.trim()}); location.reload(); }catch(e){ toast(e.message,'err'); } }
</script>`;
    return c.html(adminLayout('Albarán ' + (a.delivery_number || ('#' + id)), docShell(paper, panel), 'albaranes', csrfToken, c));
  });

  // PDF real del albarán — MISMA guarda que la ficha (albaranes.read), MISMO cuerpo imprimible
  // (albaranDocumentBodyHtml) → printableShell → Chromium.
  views.get('/:id/pdf', requirePerm('albaranes.read'), async c => {
    try {
      const id = parseInt(c.req.param('id'));
      const a = getAlbaran(db, id);
      if (!a) return c.html(errorShell('No encontramos este albarán', 'Puede que se haya anulado o que el enlace ya no sea válido.', { action: 'Ver albaranes', href: '/admin/albaranes' }), 404);
      const { emisor, cliente } = docParties(db, a);
      const sym = a.currency_symbol || '€';
      const body = albaranDocumentBodyHtml(a, a.items, emisor, cliente, sym);
      const pdf = await renderPdfFromHtml(printableShell(body, { title: 'Albarán ' + (a.delivery_number || ('#' + id)) }));
      const fname = ('Albaran-' + (a.delivery_number || ('' + id)) + '.pdf').replace(/[\/\\]/g, '-');
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + fname + '"' } });
    } catch (e) { return c.html(errorShell('No hemos podido generar el PDF', ERR.PDF, { action: 'Ver albaranes', href: '/admin/albaranes' }), e.status || 500); }
  });

  return { api, views };
}
