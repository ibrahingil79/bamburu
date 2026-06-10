import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { purchaseOrderAnularSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { recordMovement } from '../stock.js';
import { originDocBlock } from '../attachments.js';

// ════════════════════════════════════════════════════════════════════════════
// C1.b — RECEPCIONES contra la orden de compra. Una orden ENVIADA se recibe en
// varias veces; cada recepción es un documento propio (RC-NNNN) e INMUTABLE que
// mueve stock y fija coste por lo REALMENTE recibido (entrada al libro con
// unit_cost → recomputeStock recalcula el WAC, el mecanismo existente — aquí no
// hay camino nuevo de coste). Corregir una recepción = anularla (motivo
// obligatorio) y crear otra: la anulación revierte su stock con movimientos
// inversos (salida, coste NULL — igual que cancelar una compra directa), nunca
// borrando. El estado de recepción de la orden vive en la columna ADITIVA
// purchase_orders.received_status (NULL | 'parcial' | 'recibida'), recalculada
// aquí tras confirmar o anular; purchase_orders.status no cambia de significado.
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Estado de recepción de la orden, línea a línea y SIEMPRE derivado del dato:
// pedido (línea de la orden), recibido (suma de recepciones CONFIRMADAS),
// pendiente (NUNCA negativo en pantalla) y exceso (C1.c: recibido − pedido si
// se sobre-recibió — derivado, sin columna nueva). Una línea sobre-recibida
// cuenta como completada.
export function orderReceptionState(db, orderId) {
  const lines = db.prepare(`
    SELECT poi.id AS order_item_id, poi.product_id, poi.quantity AS pedido,
           poi.unit_cost, poi.tax_rate, pr.name AS product_name, pr.sku,
           COALESCE((SELECT SUM(pori.quantity)
                       FROM purchase_order_receipt_items pori
                       JOIN purchase_order_receipts por ON por.id = pori.receipt_id
                      WHERE pori.order_item_id = poi.id AND por.status = 'confirmada'), 0) AS recibido
      FROM purchase_order_items poi
      JOIN products pr ON pr.id = poi.product_id
     WHERE poi.order_id = ?
     ORDER BY poi.id`).all(orderId)
    .map(l => ({ ...l, pendiente: Math.max(0, l.pedido - l.recibido), exceso: Math.max(0, l.recibido - l.pedido) }));
  const anyReceived = lines.some(l => l.recibido > 0);
  const allReceived = anyReceived && lines.every(l => l.recibido >= l.pedido);
  return { lines, anyReceived, allReceived, totalPendiente: lines.reduce((s, l) => s + l.pendiente, 0) };
}

// Recalcula y guarda received_status (caché aditiva del estado de recepción).
// C1.c: 'cerrada_manual' es TERMINAL — anular recepciones de una orden cerrada
// revierte su stock pero NO la reabre nunca (rehacer = orden nueva).
export function recalcReceivedStatus(db, orderId) {
  const current = db.prepare('SELECT received_status FROM purchase_orders WHERE id=?').get(orderId);
  if (current && current.received_status === 'cerrada_manual') return 'cerrada_manual';
  const st = orderReceptionState(db, orderId);
  const val = !st.anyReceived ? null : (st.allReceived ? 'recibida' : 'parcial');
  db.prepare('UPDATE purchase_orders SET received_status=? WHERE id=?').run(val, orderId);
  return val;
}

// Recepciones de una orden (resumen para la ficha de la orden y la API).
export function receiptsOfOrder(db, orderId) {
  return db.prepare(`
    SELECT por.*, (SELECT COUNT(*) FROM purchase_order_receipt_items i WHERE i.receipt_id=por.id) AS line_count,
           (SELECT COALESCE(SUM(i.quantity),0) FROM purchase_order_receipt_items i WHERE i.receipt_id=por.id) AS units
      FROM purchase_order_receipts por WHERE por.order_id=? ORDER BY por.id`).all(orderId);
}

export function getReceipt(db, id) {
  const r = db.prepare(`
    SELECT por.*, po.order_number, po.supplier_id, s.name AS supplier_name
      FROM purchase_order_receipts por
      JOIN purchase_orders po ON po.id = por.order_id
      JOIN suppliers s ON s.id = po.supplier_id
     WHERE por.id=?`).get(id);
  if (!r) return null;
  const items = db.prepare(`
    SELECT pori.*, pr.name AS product_name, pr.sku
      FROM purchase_order_receipt_items pori
      JOIN products pr ON pr.id = pori.product_id
     WHERE pori.receipt_id=? ORDER BY pori.id`).all(id);
  return { ...r, items };
}

// ── CREAR Y CONFIRMAR una recepción (un solo paso; el confirm-first es de UI) ──
// Solo contra orden ENVIADA (ni borrador, ni anulada, ni cerrada manualmente).
// C1.c: recibir MÁS que el pendiente está permitido pero NUNCA en silencio — el
// exceso exige el flag explícito confirm_excess (sin él → 400 con el detalle).
// En transacción: número RC-NNNN, recepción + líneas, ENTRADA al libro por línea
// con su coste real (el exceso entra como cualquier entrada y el WAC lo pondera
// por el camino existente), y recálculo del estado de recepción de la orden.
export function createReceiptSvc(db, orderId, d) {
  const o = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!o) { const e = new Error('Orden no encontrada'); e.status = 404; throw e; }
  if (o.status !== 'enviada') { const e = new Error('Solo se puede recibir contra una orden ENVIADA (borradores y anuladas no)'); e.status = 400; throw e; }
  if (o.received_status === 'cerrada_manual') { const e = new Error('Esta orden está cerrada manualmente y no admite más recepciones. Si hace falta, crea una orden nueva.'); e.status = 400; throw e; }

  const state = orderReceptionState(db, orderId);
  if (!state.lines.some(l => l.pendiente > 0)) { const e = new Error('La orden ya está completamente recibida'); e.status = 400; throw e; }

  const byId = new Map(state.lines.map(l => [l.order_item_id, l]));
  const seen = new Set();
  const excess = [];
  for (const it of d.items) {
    const line = byId.get(it.order_item_id);
    if (!line) { const e = new Error('La línea ' + it.order_item_id + ' no pertenece a esta orden'); e.status = 400; throw e; }
    if (seen.has(it.order_item_id)) { const e = new Error('Línea repetida en la recepción ("' + line.product_name + '")'); e.status = 400; throw e; }
    seen.add(it.order_item_id);
    if (it.quantity > line.pendiente) {
      const totalLinea = line.recibido + it.quantity;
      excess.push('"' + line.product_name + '": pedido ' + line.pedido + ', recibirás ' + totalLinea + ' — exceso de ' + (totalLinea - line.pedido));
    }
  }
  if (excess.length && !d.confirm_excess) {
    const e = new Error('La recepción supera lo pedido — ' + excess.join('; ') + '. Para aceptar el exceso confirma explícitamente (confirm_excess).');
    e.status = 400; throw e;
  }

  const run = db.transaction(() => {
    const receipt_number = nextCode(db, 'purchase_order_receipt');
    const r = db.prepare('INSERT INTO purchase_order_receipts (order_id, receipt_number, date, notes) VALUES (?,?,?,?)')
      .run(orderId, receipt_number, d.date, d.notes || '');
    const rid = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO purchase_order_receipt_items (receipt_id, order_item_id, product_id, quantity, unit_cost) VALUES (?,?,?,?,?)');
    for (const it of d.items) {
      const line = byId.get(it.order_item_id);
      ins.run(rid, it.order_item_id, line.product_id, it.quantity, it.unit_cost);
      recordMovement(db, {
        product_id: line.product_id, type: 'entrada', quantity: it.quantity, unit_cost: it.unit_cost,
        origin_type: 'po_receipt', origin_id: rid,
        note: 'Recepción ' + receipt_number + ' de la orden ' + (o.order_number || ('#' + orderId)),
      });
    }
    const order_received_status = recalcReceivedStatus(db, orderId);
    return { id: rid, receipt_number, order_id: orderId, lines: d.items.length, excess_lines: excess.length, order_received_status };
  });
  return run();
}

// ── ANULAR una recepción confirmada (motivo obligatorio) ────────────────────
// Revierte su stock con movimientos INVERSOS (salida −, coste NULL: el WAC se
// reajusta solo al recalcular, igual que al cancelar una compra directa) y
// recalcula el estado de la orden — la reabre si corresponde. Nada se borra.
export function cancelReceiptSvc(db, receiptId, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const rec = db.prepare('SELECT * FROM purchase_order_receipts WHERE id=?').get(receiptId);
  if (!rec) { const e = new Error('Recepción no encontrada'); e.status = 404; throw e; }
  if (rec.status !== 'confirmada') { const e = new Error('Esta recepción ya está anulada'); e.status = 400; throw e; }
  const items = db.prepare('SELECT * FROM purchase_order_receipt_items WHERE receipt_id=?').all(receiptId);

  const run = db.transaction(() => {
    for (const it of items) {
      recordMovement(db, {
        product_id: it.product_id, type: 'salida', quantity: -it.quantity,
        origin_type: 'po_receipt', origin_id: receiptId,
        note: 'Anulación de la recepción ' + (rec.receipt_number || ('#' + receiptId)),
      });
    }
    db.prepare("UPDATE purchase_order_receipts SET status='anulada', anulada_motivo=? WHERE id=?").run(m, receiptId);
    const order_received_status = recalcReceivedStatus(db, rec.order_id);
    return { id: receiptId, receipt_number: rec.receipt_number, order_id: rec.order_id, reverted_lines: items.length, order_received_status };
  });
  return run();
}

// ── Rutas (ficha de recepción + anular; las recepciones se CREAN desde la orden) ──

export function createPurchaseOrderReceiptRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  api.get('/:id', requirePerm('purchases.read'), c => {
    try {
      const r = getReceipt(db, parseInt(c.req.param('id')));
      if (!r) return c.json({ error: 'No encontrada' }, 404);
      return c.json(r);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/cancel', requirePerm('purchases.edit'), validate(purchaseOrderAnularSchema), c => {
    try {
      const { motivo } = c.get('validated');
      const r = cancelReceiptSvc(db, parseInt(c.req.param('id')), motivo);
      logActivity(db, c.get('session'), 'Anuló recepción de orden de compra', 'po_receipt', r.id, (r.receipt_number || '') + ' — ' + motivo);
      return c.json({ ...r, message: 'Recepción anulada y stock revertido' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // Ficha de recepción: SOLO LECTURA (la recepción confirmada es inmutable) con
  // botón Anular (pide motivo) si está confirmada.
  views.get('/:id', requirePerm('purchases.read'), c => {
    const r = getReceipt(db, parseInt(c.req.param('id')));
    if (!r) return c.redirect('/admin/purchase-orders');
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const csrfToken = c.get('session')?.csrfToken || '';
    const canEdit = can(c, 'purchases.edit');

    const total = r.items.reduce((s, i) => s + Math.round(i.quantity * i.unit_cost * 100) / 100, 0);
    const rows = r.items.map(i =>
      `<tr><td>${i.sku ? `<span style="color:var(--text3);font-size:.8rem">[${esc(i.sku)}]</span> ` : ''}${esc(i.product_name)}</td>` +
      `<td>${i.quantity}</td><td>${Number(i.unit_cost).toFixed(2)} ${sym}</td>` +
      `<td><strong>${(Math.round(i.quantity * i.unit_cost * 100) / 100).toFixed(2)} ${sym}</strong></td></tr>`
    ).join('');

    const badge = r.status === 'confirmada' ? '<span class="badge b-green">Confirmada</span>' : '<span class="badge b-red">Anulada</span>';
    const motivoBlock = r.status === 'anulada'
      ? `<div class="alert alert-err">Recepción anulada. Motivo: ${esc(r.anulada_motivo || '')}. El stock que movió se revirtió con movimientos inversos.</div>` : '';
    const notesBlock = r.notes ? `<div style="margin-top:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Notas</span><br>${esc(r.notes)}</div>` : '';

    const content = `
      <div class="ph"><h2>Recepción ${esc(r.receipt_number || ('#' + r.id))}</h2>
        <div style="display:flex;gap:.5rem">
          ${r.status === 'confirmada' && canEdit ? '<button class="btn btn-danger" onclick="anularRecepcion()">Anular</button>' : ''}
          <a href="/admin/purchase-orders/${r.order_id}" class="btn btn-secondary">Ver orden</a>
        </div>
      </div>
      ${motivoBlock}
      <div class="grid g2" style="margin-bottom:1rem">
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Orden</span><br><a href="/admin/purchase-orders/${r.order_id}" style="color:var(--teal);font-weight:600">${esc(r.order_number || ('#' + r.order_id))}</a></div>
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Proveedor</span><br><strong>${esc(r.supplier_name)}</strong></div>
        </div>
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Fecha</span><br>${esc(r.date)}</div>
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Estado</span><br>${badge}</div>
          ${notesBlock}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Líneas recibidas (inmutables — corregir = anular y crear otra recepción)</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>Cantidad recibida</th><th>Coste unit. real (neto)</th><th>Subtotal</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;padding:.7rem 1rem">Total recepción</td><td style="font-weight:700">${total.toFixed(2)} ${sym}</td></tr></tfoot>
        </table></div>
      </div>
      ${originDocBlock(db, 'po_receipt', r.id)}
      <script>
      async function anularRecepcion(){
        const motivo = prompt('Motivo de anulación de la recepción ${esc(r.receipt_number || '')} (revertirá su stock):');
        if (motivo === null) return;
        if (motivo.trim().length < 3){ toast('El motivo es obligatorio (mínimo 3 caracteres)','err'); return; }
        try {
          const d = await api('POST','/api/erp/purchase-order-receipts/${r.id}/cancel',{ motivo: motivo.trim() });
          toast(d.message || 'Recepción anulada'); location.reload();
        } catch(e){ toast(e.message || 'Error anulando','err'); }
      }
      </script>`;
    return c.html(adminLayout('Recepción ' + (r.receipt_number || ''), content, 'purchase-orders', csrfToken, c));
  });

  return { api, views };
}
