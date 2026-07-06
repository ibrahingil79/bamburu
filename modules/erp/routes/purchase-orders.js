import { Hono } from 'hono';
import { adminLayout, can, docShell, estadoTabs, emptyRow } from '../layout.js';
import { validate } from '../../../core/validate.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { purchaseOrderSchema, purchaseOrderAnularSchema, purchaseOrderReceiptSchema } from '../schemas.js';
import { createReceiptSvc, orderReceptionState, receiptsOfOrder } from './purchase-order-receipts.js';
import { nextCode } from '../codes.js';
import { computeTotals } from './invoices.js';
import { lineSearchCellHtml, lineSearchScript } from '../views/line-search.js';
import { activeWarehouses } from './warehouses.js';
import { sendEmail } from '../../../core/mailer.js';

// ════════════════════════════════════════════════════════════════════════════
// C1.a — ORDEN DE COMPRA como documento. Es un PEDIDO al proveedor: aquí NO se
// crea NINGÚN stock_movement ni se toca coste (eso llega con las recepciones,
// C1.b). Ciclo: borrador (editable, sin número) → enviada (gana OC-NNNN y se
// bloquea) → anulada (con motivo; el cambio es anular + borrador nuevo que la
// referencia vía replaces_order_id). La compra directa (purchases) sigue intacta.
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Pie del documento: reusa la matemática fiscal de la factura (computeTotals →
// base + desglose IVA por tasa + total), sin IRPF (no aplica a la orden).
export function purchaseOrderTotals(items) {
  return computeTotals(
    items.map(i => ({ quantity: i.quantity, unit_price: i.unit_cost, tax_rate: i.tax_rate })),
    0
  );
}

function getOrder(db, id) {
  return db.prepare(
    'SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON po.supplier_id=s.id WHERE po.id=?'
  ).get(id);
}
function getItems(db, orderId) {
  return db.prepare(
    'SELECT poi.*, pr.name AS product_name, pr.sku, pr.product_code FROM purchase_order_items poi JOIN products pr ON poi.product_id=pr.id WHERE poi.order_id=? ORDER BY poi.id'
  ).all(orderId);
}

// Resuelve las líneas contra el catálogo: cada línea DEBE ser un producto real
// (sin línea libre) y el tax_rate lo fija el servidor desde el producto (su banda
// ya resuelta en products.tax_rate) — nunca se confía en el cliente.
function resolveItems(db, items) {
  const get = db.prepare('SELECT id, tax_rate FROM products WHERE id=?');
  return items.map(it => {
    const p = get.get(it.product_id);
    if (!p) { const e = new Error('La línea debe ser un producto del catálogo (producto ' + it.product_id + ' no existe)'); e.status = 400; throw e; }
    return { product_id: it.product_id, quantity: it.quantity, unit_cost: it.unit_cost, tax_rate: Number(p.tax_rate) || 0 };
  });
}

function checkSupplier(db, supplierId) {
  const s = db.prepare('SELECT id FROM suppliers WHERE id=? AND active=1').get(supplierId);
  if (!s) { const e = new Error('Proveedor no encontrado o archivado'); e.status = 400; throw e; }
}

// Último coste CONOCIDO de un producto, para precargar la línea de la orden: el más
// reciente entre la compra directa (no archivada) y la orden de compra ENVIADA.
// Borradores y anuladas no cuentan (el borrador no está comprometido; una anulada
// pudo anularse precisamente por precio incorrecto). NULL si nunca se compró/pidió.
export function lastKnownCost(db, productId) {
  const r = db.prepare(`
    SELECT cost FROM (
      SELECT pi.unit_cost AS cost, pu.date AS d, pu.created_at AS ca, pi.id AS i
        FROM purchase_items pi JOIN purchases pu ON pu.id=pi.purchase_id
       WHERE pi.product_id=? AND pu.archived=0
      UNION ALL
      SELECT poi.unit_cost, po.date, po.created_at, poi.id
        FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.order_id
       WHERE poi.product_id=? AND po.status='enviada'
    ) ORDER BY d DESC, ca DESC, i DESC LIMIT 1`).get(productId, productId);
  return r ? r.cost : null;
}

// ── Servicios (testables; los usan las rutas) ───────────────────────────────

export function createPurchaseOrderSvc(db, d, opts = {}) {
  checkSupplier(db, d.supplier_id);
  const items = resolveItems(db, d.items);
  const run = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO purchase_orders (supplier_id, date, expected_date, notes, replaces_order_id) VALUES (?,?,?,?,?)'
    ).run(d.supplier_id, d.date, d.expected_date || null, d.notes || '', opts.replaces_order_id || null);
    const id = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_cost, tax_rate) VALUES (?,?,?,?,?)');
    for (const it of items) ins.run(id, it.product_id, it.quantity, it.unit_cost, it.tax_rate);
    return id;
  });
  return run();
}

// EDITAR: solo un borrador. El borrador aún no es documento (sin número), así que
// reemplazar sus líneas es legítimo; una enviada NUNCA se edita (anular + nueva).
export function updatePurchaseOrderSvc(db, id, d) {
  const o = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
  if (!o) { const e = new Error('Orden no encontrada'); e.status = 404; throw e; }
  if (o.status !== 'borrador') { const e = new Error('Solo se puede editar un borrador (la orden enviada se anula y se rehace)'); e.status = 400; throw e; }
  checkSupplier(db, d.supplier_id);
  const items = resolveItems(db, d.items);
  db.transaction(() => {
    db.prepare('UPDATE purchase_orders SET supplier_id=?, date=?, expected_date=?, notes=? WHERE id=?')
      .run(d.supplier_id, d.date, d.expected_date || null, d.notes || '', id);
    db.prepare('DELETE FROM purchase_order_items WHERE order_id=?').run(id);
    const ins = db.prepare('INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_cost, tax_rate) VALUES (?,?,?,?,?)');
    for (const it of items) ins.run(id, it.product_id, it.quantity, it.unit_cost, it.tax_rate);
  })();
  return { id };
}

// ENVIAR: el borrador gana su número OC-NNNN (contador code_counters, solo aquí:
// un borrador no consume número) y queda bloqueado. En la MISMA transacción se
// CONGELA la foto de emisor y proveedor (mismo patrón que la factura al emitir):
// la orden enviada conserva los datos del momento aunque luego cambien Ajustes o
// la ficha del proveedor. NO mueve stock.
export function sendPurchaseOrderSvc(db, id) {
  const o = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
  if (!o) { const e = new Error('Orden no encontrada'); e.status = 404; throw e; }
  if (o.status !== 'borrador') { const e = new Error('Solo se puede enviar un borrador'); e.status = 400; throw e; }
  const run = db.transaction(() => {
    const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(o.supplier_id) || {};
    const order_number = nextCode(db, 'purchase_order');
    db.prepare(`UPDATE purchase_orders SET order_number=?, status='enviada',
        company_name=?, company_fiscal_id=?, company_address=?, company_phone=?,
        supplier_name=?, supplier_fiscal_id=?, supplier_address=?
      WHERE id=?`).run(
      order_number,
      cfg.company_name || '', cfg.fiscal_id || '', cfg.address || '', cfg.phone || '',
      s.name || '', s.fiscal_id || '', [s.address, s.city].filter(Boolean).join(', '),
      id
    );
    return { id, order_number };
  });
  return run();
}

// ANULAR: solo una enviada, con motivo (mín. 3). No se borra ni se edita nada:
// la orden queda 'anulada' con su motivo, número y líneas intactos. C1.b: si la
// orden tiene recepciones CONFIRMADAS no se puede anular (su stock ya se movió):
// primero se anulan las recepciones; cerrar con pendiente que no llegará es C1.c.
export function anularPurchaseOrderSvc(db, id, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const o = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
  if (!o) { const e = new Error('Orden no encontrada'); e.status = 404; throw e; }
  if (o.status !== 'enviada') { const e = new Error('Solo se puede anular una orden enviada'); e.status = 400; throw e; }
  const conRecepcion = db.prepare("SELECT 1 FROM purchase_order_receipts WHERE order_id=? AND status='confirmada' LIMIT 1").get(id);
  if (conRecepcion) { const e = new Error('Esta orden tiene recepciones confirmadas (su stock ya se movió): anula primero sus recepciones'); e.status = 400; throw e; }
  db.prepare("UPDATE purchase_orders SET status='anulada', anulada_motivo=? WHERE id=?").run(m, id);
  return { id, order_number: o.order_number };
}

// C1.c — CERRAR MANUALMENTE una orden con pendiente: declara que lo que falta
// "no va a llegar". NO mueve stock ni crea recepciones; las confirmadas quedan
// intactas. Estado TERMINAL (received_status='cerrada_manual' + motivo): la
// orden no admite más recepciones ni se reabre nunca — rehacer = orden nueva.
export function closePurchaseOrderSvc(db, id, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo del cierre'); e.status = 400; throw e; }
  const o = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
  if (!o) { const e = new Error('Orden no encontrada'); e.status = 404; throw e; }
  if (o.status !== 'enviada') { const e = new Error('Solo se puede cerrar una orden enviada (borradores y anuladas no)'); e.status = 400; throw e; }
  if (o.received_status === 'cerrada_manual') { const e = new Error('La orden ya está cerrada manualmente'); e.status = 400; throw e; }
  if (o.received_status === 'recibida') { const e = new Error('La orden ya está completamente recibida: no hay pendiente que cerrar'); e.status = 400; throw e; }
  db.prepare("UPDATE purchase_orders SET received_status='cerrada_manual', cerrada_motivo=? WHERE id=?").run(m, id);
  return { id, order_number: o.order_number, motivo: m };
}

// ANULAR Y REHACER: anula la enviada y abre un borrador NUEVO precargado con su
// proveedor y líneas (tal cual se pidieron), enlazado vía replaces_order_id.
export function anularYRehacerSvc(db, id, motivo, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const run = db.transaction(() => {
    const anulada = anularPurchaseOrderSvc(db, id, motivo);
    const o = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
    const r = db.prepare(
      'INSERT INTO purchase_orders (supplier_id, date, expected_date, notes, replaces_order_id) VALUES (?,?,?,?,?)'
    ).run(o.supplier_id, today, o.expected_date || null, o.notes || '', id);
    const newId = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_cost, tax_rate) VALUES (?,?,?,?,?)');
    for (const it of db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY id').all(id)) {
      ins.run(newId, it.product_id, it.quantity, it.unit_cost, it.tax_rate);
    }
    return { id: newId, anulada_id: id, anulada_number: anulada.order_number };
  });
  return run();
}

// EMAIL AL PROVEEDOR: solo una enviada y solo si el proveedor tiene email. El
// cuerpo es el propio documento en HTML. Resend devuelve {data,error} sin lanzar
// → se chequea error. Es una acción que pulsa el usuario (confirm-first), nunca
// automática. opts.sendEmail se inyecta (mock en tests).
export async function emailPurchaseOrderSvc(db, id, opts = {}) {
  const o = getOrder(db, id);
  if (!o) { const e = new Error('Orden no encontrada'); e.status = 404; throw e; }
  if (o.status !== 'enviada') { const e = new Error('Solo se puede enviar por email una orden enviada'); e.status = 400; throw e; }
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id=?').get(o.supplier_id);
  if (!supplier || !String(supplier.email || '').trim()) {
    const e = new Error('El proveedor no tiene email. Añádeselo en su ficha para poder enviarle la orden.');
    e.status = 400; throw e;
  }
  if (typeof opts.sendEmail !== 'function') { const e = new Error('El envío de email no está configurado'); e.status = 500; throw e; }

  const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const items = getItems(db, id);
  const sym = company.currency_symbol || '€';
  const empresa = company.company_name || 'Bamburu';
  // El cuerpo es el documento con su cabecera CONGELADA (foto del envío); el
  // destinatario sí es el email VIVO del proveedor (puede haberlo corregido).
  const { emisor, proveedor } = docParties(db, o);
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;font-size:14px;color:var(--accent-d);max-width:760px;margin:auto;padding:24px">
${documentBodyHtml(o, items, emisor, proveedor, sym)}
<p style="color:var(--text2);font-size:12px;margin-top:24px">Documento enviado desde ${esc(empresa)} con Bamburu.</p>
</body></html>`;
  const t = purchaseOrderTotals(items);
  const text = 'Orden de compra ' + o.order_number + ' de ' + empresa + '\n'
    + 'Fecha: ' + o.date + (o.expected_date ? ' · Entrega prevista: ' + o.expected_date : '') + '\n\n'
    + items.map(i => '- ' + i.product_name + (i.sku ? ' [' + i.sku + ']' : '') + ' × ' + i.quantity + ' a ' + Number(i.unit_cost).toFixed(2) + ' ' + sym + ' (neto)').join('\n')
    + '\n\nTotal (IVA incluido): ' + t.total.toFixed(2) + ' ' + sym
    + (o.notes ? '\n\nNotas: ' + o.notes : '');

  const payload = {
    from: empresa + ' <noreply@bamburu.com>',     // dominio verificado; el nombre es el del negocio
    to: supplier.email,
    subject: 'Orden de compra ' + o.order_number + ' — ' + empresa,
    html,
    text,
  };
  if (company.email) payload.replyTo = company.email;   // las respuestas van al negocio
  const { data, error } = await opts.sendEmail(payload);
  if (error) { const e = new Error('No se pudo enviar el email: ' + (error.message || JSON.stringify(error))); e.status = 502; throw e; }
  return { sent: true, to: supplier.email, order_number: o.order_number, id: data && data.id };
}

// ── Documento (compartido entre la vista imprimible y el email) ─────────────
// Cabecera de emisor y proveedor del documento: la orden ENVIADA/ANULADA usa su
// FOTO CONGELADA (copiada al enviar); el borrador — y las órdenes enviadas antes
// de existir la foto (company_name NULL) — leen en vivo.
function docParties(db, o) {
  if (o.company_name != null) {
    return {
      emisor:    { name: o.company_name, fiscal_id: o.company_fiscal_id, address: o.company_address, phone: o.company_phone },
      proveedor: { name: o.supplier_name, fiscal_id: o.supplier_fiscal_id, address: o.supplier_address },
    };
  }
  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(o.supplier_id) || {};
  return {
    emisor:    { name: cfg.company_name || '', fiscal_id: cfg.fiscal_id || '', address: cfg.address || '', phone: cfg.phone || '', email: cfg.email || '' },
    proveedor: { name: s.name || '', fiscal_id: s.fiscal_id || '', address: [s.address, s.city].filter(Boolean).join(', '), email: s.email || '', phone: s.phone || '' },
  };
}

// Líneas y pie con desglose de IVA por tasa; cabecera desde docParties.
function documentBodyHtml(o, items, emisor, proveedor, sym) {
  const t = purchaseOrderTotals(items);
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3)">${esc(i.product_name)}${i.sku ? ` <span style="color:var(--text2);font-size:11px">[${esc(i.sku)}]</span>` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${i.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${sym}${Number(i.unit_cost).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${Number(i.tax_rate) > 0 ? Number(i.tax_rate) + '%' : 'Exento'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${sym}${(Math.round(i.quantity * i.unit_cost * 100) / 100).toFixed(2)}</td>
    </tr>`).join('');

  const taxRows = Object.values(t.taxByRate).sort((a, b) => b.rate - a.rate).map(x =>
    `<tr><td style="padding:4px 12px;color:var(--text2)">${Number(x.rate) > 0 ? 'IVA ' + x.rate + '%' : 'Exento de IVA'} (sobre ${sym}${x.base.toFixed(2)})</td><td style="padding:4px 12px;text-align:right;font-weight:600">${sym}${x.amount.toFixed(2)}</td></tr>`
  ).join('');

  return `
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
  <div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 4px">Orden de compra</h1>
    <div style="color:var(--text2);font-size:12px">${o.order_number ? esc(o.order_number) : 'Borrador (sin número)'}</div>
  </div>
  <div style="text-align:right;color:var(--text2);font-size:12px">
    <div>Fecha: <strong style="color:var(--accent-d)">${esc(o.date)}</strong></div>
    ${o.expected_date ? `<div>Entrega prevista: <strong style="color:var(--accent-d)">${esc(o.expected_date)}</strong></div>` : ''}
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:24px">
  <div>
    <div style="font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:4px">Emisor</div>
    <div><strong>${esc(emisor.name || '')}</strong></div>
    ${emisor.fiscal_id ? `<div>${esc(emisor.fiscal_id)}</div>` : ''}
    ${emisor.address ? `<div style="color:var(--text2)">${esc(emisor.address)}</div>` : ''}
    ${emisor.email ? `<div style="color:var(--text2)">${esc(emisor.email)}</div>` : ''}
    ${emisor.phone ? `<div style="color:var(--text2)">${esc(emisor.phone)}</div>` : ''}
  </div>
  <div>
    <div style="font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:4px">Proveedor</div>
    <div><strong>${esc(proveedor.name || '')}</strong></div>
    ${proveedor.fiscal_id ? `<div>${esc(proveedor.fiscal_id)}</div>` : ''}
    ${proveedor.address ? `<div style="color:var(--text2)">${esc(proveedor.address)}</div>` : ''}
    ${proveedor.email ? `<div style="color:var(--text2)">${esc(proveedor.email)}</div>` : ''}
    ${proveedor.phone ? `<div style="color:var(--text2)">${esc(proveedor.phone)}</div>` : ''}
  </div>
</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
  <thead><tr>
    <th style="background:var(--bg);padding:8px 12px;text-align:left;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Producto</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Cant.</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Coste unit. (neto)</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">IVA</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Subtotal</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<table style="margin-left:auto;width:300px;border-collapse:collapse">
  <tr><td style="padding:4px 12px;color:var(--text2)">Base imponible</td><td style="padding:4px 12px;text-align:right;font-weight:600">${sym}${t.subtotal.toFixed(2)}</td></tr>
  ${taxRows}
  <tr><td style="padding:10px 12px;font-size:15px;border-top:2px solid var(--accent-d);font-weight:700">TOTAL</td><td style="padding:10px 12px;text-align:right;font-size:15px;border-top:2px solid var(--accent-d);font-weight:700">${sym}${t.total.toFixed(2)}</td></tr>
</table>
${o.notes ? `<div style="margin-top:16px;color:var(--text2)">${esc(o.notes)}</div>` : ''}`;
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export function createPurchaseOrderRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  const STATUS_LABEL = { borrador: 'Borrador', enviada: 'Enviada', anulada: 'Anulada' };
  const STATUS_BADGE = { borrador: 'b-yellow', enviada: 'b-green', anulada: 'b-red' };

  // C1.b — estado COMBINADO que ve el usuario: ciclo (status) + recepción
  // (received_status, columna aditiva). Anulada manda; recibida/parcial solo
  // existen sobre una enviada.
  const displayEstado = (o) =>
    o.status === 'anulada' ? ['Anulada', 'b-red']
      : o.received_status === 'cerrada_manual' ? ['Cerrada (incompleta)', 'b-gray']
      : o.received_status === 'recibida' ? ['Recibida', 'b-teal']
      : o.received_status === 'parcial' ? ['Parcialmente recibida', 'b-blue']
      : o.status === 'enviada' ? ['Enviada', 'b-green']
      : ['Borrador', 'b-yellow'];
  const ESTADO_FILTER = {
    borrador: "po.status='borrador'",
    enviada:  "po.status='enviada' AND po.received_status IS NULL",
    parcial:  "po.status='enviada' AND po.received_status='parcial'",
    recibida: "po.received_status='recibida'",
    cerrada:  "po.status='enviada' AND po.received_status='cerrada_manual'",
    anulada:  "po.status='anulada'",
  };
  const ESTADO_OPTION_LABEL = { borrador: 'Borradores', enviada: 'Enviadas', parcial: 'Parcialmente recibidas', recibida: 'Recibidas', cerrada: 'Cerradas (incompletas)', anulada: 'Anuladas' };

  // ── API ──
  api.get('/:id', requirePerm('purchases.read'), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const o = getOrder(db, id);
      if (!o) return c.json({ error: 'No encontrada' }, 404);
      const items = getItems(db, id);
      return c.json({ ...o, items, totals: purchaseOrderTotals(items) });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/', requirePerm('purchases.create'), validate(purchaseOrderSchema), c => {
    try {
      const id = createPurchaseOrderSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó borrador de orden de compra', 'purchase_order', id, '');
      return c.json({ id, message: 'Borrador guardado' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.put('/:id', requirePerm('purchases.edit'), validate(purchaseOrderSchema), c => {
    try {
      const r = updatePurchaseOrderSvc(db, parseInt(c.req.param('id')), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó borrador de orden de compra', 'purchase_order', r.id, '');
      return c.json({ ...r, message: 'Borrador actualizado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/enviar', requirePerm('purchases.edit'), c => {
    try {
      const r = sendPurchaseOrderSvc(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Envió orden de compra', 'purchase_order', r.id, r.order_number);
      return c.json({ ...r, message: 'Orden ' + r.order_number + ' enviada' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/email', requirePerm('purchases.edit'), async c => {
    try {
      const r = await emailPurchaseOrderSvc(db, parseInt(c.req.param('id')), { sendEmail });
      logActivity(db, c.get('session'), 'Envió orden de compra por email', 'purchase_order', parseInt(c.req.param('id')), r.order_number + ' → ' + r.to);
      return c.json({ ...r, message: 'Orden enviada por email a ' + r.to });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // C1.b — crear y confirmar una recepción contra la orden (valida estado y
  // pendientes, asigna RC-NNNN, escribe en el libro y actualiza received_status).
  api.post('/:id/receipts', requirePerm('purchases.create'), validate(purchaseOrderReceiptSchema), c => {
    try {
      const r = createReceiptSvc(db, parseInt(c.req.param('id')), c.get('validated'));
      logActivity(db, c.get('session'), 'Registró recepción de orden de compra', 'po_receipt', r.id, r.receipt_number + ' (' + r.lines + ' líneas)');
      return c.json({ ...r, message: 'Recepción ' + r.receipt_number + ' confirmada' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // C1.b — lista de recepciones de la orden + estado por línea (pedido/recibido/pendiente).
  api.get('/:id/receipts', requirePerm('purchases.read'), c => {
    try {
      const id = parseInt(c.req.param('id'));
      if (!db.prepare('SELECT 1 FROM purchase_orders WHERE id=?').get(id)) return c.json({ error: 'No encontrada' }, 404);
      return c.json({ reception: orderReceptionState(db, id), receipts: receiptsOfOrder(db, id) });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // C1.c — cierre manual con pendiente (motivo obligatorio). No mueve stock.
  api.post('/:id/close', requirePerm('purchases.edit'), validate(purchaseOrderAnularSchema), c => {
    try {
      const { motivo } = c.get('validated');
      const r = closePurchaseOrderSvc(db, parseInt(c.req.param('id')), motivo);
      logActivity(db, c.get('session'), 'Cerró orden de compra con pendiente', 'purchase_order', r.id, (r.order_number || '') + ' — ' + motivo);
      return c.json({ ...r, message: 'Orden cerrada (incompleta): el pendiente queda declarado como que no va a llegar' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/anular', requirePerm('purchases.edit'), validate(purchaseOrderAnularSchema), c => {
    try {
      const { motivo } = c.get('validated');
      const r = anularPurchaseOrderSvc(db, parseInt(c.req.param('id')), motivo);
      logActivity(db, c.get('session'), 'Anuló orden de compra', 'purchase_order', r.id, (r.order_number || '') + ' — ' + motivo);
      return c.json({ ...r, message: 'Orden anulada' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/anular-y-rehacer', requirePerm('purchases.create'), validate(purchaseOrderAnularSchema), c => {
    try {
      const { motivo } = c.get('validated');
      const r = anularYRehacerSvc(db, parseInt(c.req.param('id')), motivo);
      logActivity(db, c.get('session'), 'Anuló y rehízo orden de compra', 'purchase_order', r.id, 'sustituye a ' + (r.anulada_number || ('#' + r.anulada_id)));
      return c.json({ ...r, message: 'Orden anulada; borrador nuevo creado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // ── VISTAS ──

  // Lista server-rendered (patrón P4 de /admin/products): búsqueda por proveedor o
  // número, filtro por estado y paginación de 25, todo por URL (GET).
  views.get('/', requirePerm('purchases.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const q = (c.req.query('q') || '').trim();
    const estado = (c.req.query('estado') || '').trim();
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    const where = [];
    const params = [];
    if (q) { where.push('(s.name LIKE ? OR po.order_number LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    if (estado && ESTADO_FILTER[estado]) { where.push('(' + ESTADO_FILTER[estado] + ')'); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare('SELECT COUNT(*) AS n FROM purchase_orders po JOIN suppliers s ON po.supplier_id=s.id ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const orders = db.prepare(
      'SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON po.supplier_id=s.id '
      + whereSql + ' ORDER BY po.date DESC, po.id DESC LIMIT ? OFFSET ?'
    ).all(...params, perPage, offset);

    // Total del documento (IVA incluido) con la MISMA matemática del pie (computeTotals).
    const itemsStmt = db.prepare('SELECT quantity, unit_cost, tax_rate FROM purchase_order_items WHERE order_id=?');
    const totalOf = (oid) => {
      const its = itemsStmt.all(oid);
      return its.length ? purchaseOrderTotals(its).total : 0;
    };

    const buildQs = (p) => {
      const u = new URLSearchParams();
      if (q) u.set('q', q);
      if (estado) u.set('estado', estado);
      u.set('page', String(p));
      return u.toString();
    };

    const rowsHtml = orders.map(o => {
      const [lbl, badge] = displayEstado(o);
      return '<tr>'
        + '<td>' + (o.order_number ? '<strong style="font-family:monospace">' + esc(o.order_number) + '</strong>' : '<span style="color:var(--text3)">Borrador</span>') + '</td>'
        + '<td><strong>' + esc(o.supplier_name) + '</strong></td>'
        + '<td>' + esc(o.date) + '</td>'
        + '<td><span class="badge ' + badge + '">' + esc(lbl) + '</span></td>'
        + '<td><strong>' + totalOf(o.id).toFixed(2) + ' ' + sym + '</strong></td>'
        + '<td style="text-align:right"><a href="/admin/purchase-orders/' + o.id + '" class="btn btn-secondary btn-sm">Ver</a></td>'
        + '</tr>';
    }).join('');

    const estadoTabsHtml = estadoTabs(estado, [['', 'Todas'], ...Object.entries(ESTADO_OPTION_LABEL)], q);

    const content = `
      <div class="ph">
        <h2>Órdenes de compra</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${esc(q)}" placeholder="Buscar por proveedor o número...">
          <input type="hidden" name="estado" value="${esc(estado)}">
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'purchases.create') ? '<a href="/admin/purchases/capture" class="btn btn-secondary">Capturar factura</a>' : ''}
          ${can(c, 'purchases.create') ? '<a href="/admin/purchase-orders/new" class="btn btn-primary">Nueva orden</a>' : ''}
        </form>
      </div>
      ${estadoTabsHtml}
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Número</th><th>Proveedor</th><th>Fecha</th><th>Estado</th><th>Total</th><th></th></tr></thead>
          <tbody>${total === 0 ? ((q || estado) ? emptyRow(6, 'No se encontraron órdenes con ese filtro.', { icon: 'ti-search' }) : emptyRow(6, 'Aún no tienes órdenes de compra: tu pedido al proveedor. ¿Creamos la primera?', { cta: 'Nueva orden', href: '/admin/purchase-orders/new' })) : rowsHtml}</tbody>
        </table></div>
      </div>
      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--text3);font-size:.85rem">Página ${page} de ${totalPages} · ${total} orden${total === 1 ? '' : 'es'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div>
      </div>` : ''}`;
    return c.html(adminLayout('Órdenes de compra', content, 'purchase-orders', c.get('session')?.csrfToken || '', c));
  });

  // Formulario de alta/edición de borrador (compartido). Líneas con el buscador
  // compartido (views/line-search.js): solo productos reales del catálogo, coste
  // precargado desde el ÚLTIMO coste de compra (nunca el PVP) e IVA heredado de la
  // banda del producto. Pie en vivo: Base + IVA por tasa + Total (sin IRPF).
  const formView = (c, existing = null) => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const today = new Date().toISOString().split('T')[0];
    const suppliers = db.prepare('SELECT id,name FROM suppliers WHERE active=1 ORDER BY name').all();
    const csrfToken = c.get('session')?.csrfToken || '';

    if (!suppliers.length) {
      const content = `
        <div class="ph"><h2>Nueva orden de compra</h2><a href="/admin/purchase-orders" class="btn btn-secondary">Volver</a></div>
        <div class="card card-body" style="text-align:center;padding:2rem;color:var(--text3)">
          No hay proveedores. <a href="/admin/suppliers">Crea uno primero.</a>
        </div>`;
      return c.html(adminLayout('Nueva orden de compra', content, 'purchase-orders', csrfToken, c));
    }

    // Catálogo para el buscador: productos activos con su IVA (banda ya resuelta) y el
    // último coste conocido (compra directa U orden enviada, vía lastKnownCost) para
    // precargar la línea. Solo un producto NUEVO (sin historial) exige teclear el coste.
    const products = db.prepare(
      "SELECT p.id, p.name, p.sku, p.price, p.tax_rate FROM products p WHERE p.status='active' ORDER BY p.name"
    ).all().map(p => ({ ...p, last_cost: lastKnownCost(db, p.id) }));

    const isEdit = !!existing;
    const seed = isEdit ? {
      id: existing.id,
      supplier_id: existing.supplier_id,
      date: existing.date,
      expected_date: existing.expected_date || '',
      notes: existing.notes || '',
      items: getItems(db, existing.id).map(i => ({
        product_id: i.product_id, quantity: i.quantity, unit_cost: i.unit_cost,
        tax_rate: i.tax_rate, name: i.product_name, sku: i.sku,
      })),
    } : null;
    const replacesBanner = (isEdit && existing.replaces_order_id) ? (() => {
      const prev = db.prepare('SELECT id, order_number FROM purchase_orders WHERE id=?').get(existing.replaces_order_id);
      return prev ? `<div class="alert alert-warn">Sustituye a <a href="/admin/purchase-orders/${prev.id}" style="color:inherit;font-weight:600">${esc(prev.order_number || ('borrador #' + prev.id))}</a> (anulada).</div>` : '';
    })() : '';

    const supOptions = suppliers.map(s =>
      '<option value="' + s.id + '"' + (isEdit && existing.supplier_id === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'
    ).join('');

    const content = `
      <div class="ph"><h2>${isEdit ? 'Editar borrador' : 'Nueva orden de compra'}</h2><a href="${isEdit ? '/admin/purchase-orders/' + existing.id : '/admin/purchase-orders'}" class="btn btn-secondary">Volver</a></div>
      ${replacesBanner}
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Datos de la orden</h3></div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Proveedor *</label><select class="form-control" id="fSupplier">${supOptions}</select></div>
            <div class="form-group"><label class="form-label">Fecha *</label><input class="form-control" type="date" id="fDate" value="${isEdit ? esc(existing.date) : today}"></div>
            <div class="form-group"><label class="form-label">Entrega prevista</label><input class="form-control" type="date" id="fExpected" value="${isEdit ? esc(existing.expected_date || '') : ''}"></div>
          </div>
          <div class="form-group"><label class="form-label">Notas</label><textarea class="form-control" id="fNotes">${isEdit ? esc(existing.notes || '') : ''}</textarea></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Líneas</h3><button class="btn btn-secondary" onclick="addLine()">+ Añadir línea</button></div>
        <!-- overflow:visible: el desplegable del buscador es position:absolute y el
             overflow-x:auto de .table-wrap lo recortaría (mismo arreglo que en Compras). -->
        <div class="table-wrap" style="overflow:visible"><table>
          <thead><tr><th style="min-width:240px">Producto</th><th>Cantidad</th><th>Coste unit. (neto)</th><th>IVA</th><th style="text-align:right">Subtotal</th><th></th></tr></thead>
          <tbody id="lines-body"></tbody>
          <tfoot id="totals-foot"></tfoot>
        </table></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem">
        <a href="${isEdit ? '/admin/purchase-orders/' + existing.id : '/admin/purchase-orders'}" class="btn btn-secondary">Cancelar</a>
        <button class="btn btn-primary" id="btn-save" onclick="saveOrder()">${isEdit ? 'Guardar cambios' : 'Guardar borrador'}</button>
      </div>
      <script>
      const SYM = '${sym}';
      const catalog = ${JSON.stringify(products)};
      const SEED = ${JSON.stringify(seed)};
      // Campos ocultos propios de la orden: product_id (la línea DEBE resolver a un
      // producto real, sin línea libre) y el IVA heredado de la banda del producto.
      const LINE_CELL = ${JSON.stringify(lineSearchCellHtml(
        '<input type="hidden" class="line-pid"><input type="hidden" class="line-tax" value="0">'
      ))};

      ${lineSearchScript()}

      // Al elegir un producto: nombre + product_id + coste desde el ÚLTIMO coste
      // conocido (compra directa u orden enviada; NUNCA el PVP) + IVA de su banda.
      // Si el producto es NUEVO (sin historial) el campo queda en blanco y lo dice:
      // ahí sí hay que teclear el coste.
      function applyLinePick(row, p){
        row.querySelector('.line-desc').value = p.name;
        row.querySelector('.line-pid').value  = p.id;
        const costEl = row.querySelector('.line-cost');
        if (p.last_cost != null) {
          costEl.value = Number(p.last_cost).toFixed(2);
          costEl.placeholder = '';
        } else {
          costEl.value = '';
          costEl.placeholder = 'Nuevo: indica el coste';
        }
        row.querySelector('.line-tax').value  = String(Number(p.tax_rate) || 0);
        row.querySelector('.line-taxlbl').textContent = (Number(p.tax_rate) > 0) ? (Number(p.tax_rate) + '%') : 'Exento';
        recalc();
      }

      function addLine(prefill){
        const tbody = document.getElementById('lines-body');
        const row = document.createElement('tr');
        row.innerHTML =
          LINE_CELL +
          '<td><input type="number" class="form-control line-qty" min="1" value="1" style="width:90px"></td>' +
          '<td><input type="number" class="form-control line-cost" min="0" step="0.01" value="" style="width:120px"></td>' +
          '<td><span class="line-taxlbl" style="color:var(--text3)">—</span></td>' +
          '<td style="text-align:right;padding:.7rem 1rem"><span class="line-subtotal">' + SYM + '0.00</span></td>' +
          '<td><button class="btn btn-danger btn-sm" onclick="this.closest(\\'tr\\').remove();recalc()">✕</button></td>';
        tbody.appendChild(row);
        row.querySelectorAll('.line-qty, .line-cost').forEach(i => i.addEventListener('input', recalc));
        // Cambiar el texto a mano invalida la selección previa (igual que en Compras).
        row.querySelector('.line-desc').addEventListener('input', function(){
          row.querySelector('.line-pid').value = '';
          row.querySelector('.line-tax').value = '0';
          row.querySelector('.line-taxlbl').textContent = '—';
          recalc();
        });
        if (prefill){
          row.querySelector('.line-desc').value = prefill.name + (prefill.sku ? ' ['+prefill.sku+']' : '');
          row.querySelector('.line-pid').value  = prefill.product_id;
          row.querySelector('.line-qty').value  = prefill.quantity;
          row.querySelector('.line-cost').value = Number(prefill.unit_cost).toFixed(2);
          row.querySelector('.line-tax').value  = String(Number(prefill.tax_rate) || 0);
          row.querySelector('.line-taxlbl').textContent = (Number(prefill.tax_rate) > 0) ? (Number(prefill.tax_rate) + '%') : 'Exento';
        }
        recalc();
      }

      // Pie en vivo: Base + IVA agrupado por tasa + Total (misma agrupación que el
      // servidor, que es quien guarda; aquí es solo preview). Sin IRPF.
      function recalc(){
        const r2 = n => Math.round(n * 100) / 100;
        let subtotal = 0;
        const byRate = {};
        document.querySelectorAll('#lines-body tr').forEach(function(r){
          const qty  = parseFloat(r.querySelector('.line-qty').value)  || 0;
          const cost = parseFloat(r.querySelector('.line-cost').value) || 0;
          const rate = parseFloat(r.querySelector('.line-tax').value)  || 0;
          const base = r2(qty * cost);
          r.querySelector('.line-subtotal').textContent = SYM + base.toFixed(2);
          subtotal += base;
          const k = String(rate);
          if (!byRate[k]) byRate[k] = { rate: rate, base: 0, amount: 0 };
          byRate[k].base += base;
          byRate[k].amount += r2(base * rate / 100);
        });
        subtotal = r2(subtotal);
        let taxTotal = 0;
        let html = '<tr><td colspan="4" style="text-align:right;font-weight:600;padding:.7rem 1rem">Base imponible</td>' +
                   '<td style="text-align:right;padding:.7rem 1rem">' + SYM + subtotal.toFixed(2) + '</td><td></td></tr>';
        Object.values(byRate).sort((a,b) => b.rate - a.rate).forEach(function(x){
          const amount = r2(x.amount); taxTotal += amount;
          const lbl = (x.rate > 0 ? 'IVA ' + x.rate + '%' : 'Exento (0%)') + ' (sobre ' + SYM + r2(x.base).toFixed(2) + ')';
          html += '<tr><td colspan="4" style="text-align:right;padding:.45rem 1rem;color:var(--text3)">' + lbl + '</td>' +
                  '<td style="text-align:right;padding:.45rem 1rem;color:var(--text3)">' + SYM + amount.toFixed(2) + '</td><td></td></tr>';
        });
        html += '<tr><td colspan="4" style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">Total</td>' +
                '<td style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">' + SYM + r2(subtotal + taxTotal).toFixed(2) + '</td><td></td></tr>';
        document.getElementById('totals-foot').innerHTML = html;
      }

      async function saveOrder(){
        const rows = document.querySelectorAll('#lines-body tr');
        if (!rows.length){ toast('Añade al menos una línea','err'); return; }
        const items = [];
        for (const r of rows){
          const pid  = parseInt(r.querySelector('.line-pid').value) || 0;
          const qty  = parseInt(r.querySelector('.line-qty').value) || 0;
          const cost = parseFloat(r.querySelector('.line-cost').value);
          if (!pid){ toast('Busca y elige un producto del catálogo en cada línea','err'); return; }
          if (!(qty > 0)){ toast('La cantidad debe ser mayor que 0','err'); return; }
          if (!(cost >= 0)){
            const nm = (catalog.find(x => x.id === pid) || {}).name || 'una línea';
            toast('"' + nm + '" no tiene compras previas: indica su coste unitario','err');
            return;
          }
          items.push({ product_id: pid, quantity: qty, unit_cost: cost });
        }
        const body = {
          supplier_id: parseInt(document.getElementById('fSupplier').value),
          date: document.getElementById('fDate').value,
          expected_date: document.getElementById('fExpected').value || '',
          notes: document.getElementById('fNotes').value.trim(),
          items: items,
        };
        if (!body.date){ toast('La fecha es obligatoria','err'); return; }
        const btn = document.getElementById('btn-save');
        btn.disabled = true;
        try {
          ${isEdit
            ? `await api('PUT','/api/erp/purchase-orders/${existing.id}',body); window.location.href='/admin/purchase-orders/${existing.id}';`
            : `const r = await api('POST','/api/erp/purchase-orders',body); window.location.href='/admin/purchase-orders/'+r.id;`}
        } catch(e){ toast(e.message||'Error guardando','err'); btn.disabled = false; }
      }

      if (SEED && SEED.items && SEED.items.length){ SEED.items.forEach(it => addLine(it)); } else { addLine(); }
      </script>`;
    return c.html(adminLayout(isEdit ? 'Editar borrador' : 'Nueva orden de compra', content, 'purchase-orders', csrfToken, c));
  };

  views.get('/new', requirePerm('purchases.create'), c => formView(c));

  views.get('/:id/edit', requirePerm('purchases.edit'), c => {
    const o = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(parseInt(c.req.param('id')));
    if (!o) return c.redirect('/admin/purchase-orders');
    if (o.status !== 'borrador') return c.redirect('/admin/purchase-orders/' + o.id);   // enviada/anulada no se edita
    return formView(c, o);
  });

  // C1.b — Formulario de recepción: líneas de la orden con pendiente > 0, cantidad
  // precargada con el pendiente (editable a la baja; 0 = no recibir esa línea) y
  // coste precargado del de la orden (editable: el real puede diferir del pedido).
  // Confirm-first: la recepción confirmada es inmutable y mueve stock.
  views.get('/:id/receipts/new', requirePerm('purchases.create'), c => {
    const id = parseInt(c.req.param('id'));
    const o = getOrder(db, id);
    if (!o) return c.redirect('/admin/purchase-orders');
    if (o.status !== 'enviada') return c.redirect('/admin/purchase-orders/' + id);
    if (o.received_status === 'cerrada_manual') return c.redirect('/admin/purchase-orders/' + id);   // cerrada: no admite más recepciones
    const reception = orderReceptionState(db, id);
    const pendingLines = reception.lines.filter(l => l.pendiente > 0);
    if (!pendingLines.length) return c.redirect('/admin/purchase-orders/' + id);

    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const today = new Date().toISOString().split('T')[0];
    const csrfToken = c.get('session')?.csrfToken || '';
    // Capa 2: almacén de ESTA recepción (principal por defecto; cada parcial puede ir a otro).
    const warehouses = activeWarehouses(db);
    const whOptions = warehouses.map(w => '<option value="' + w.id + '"' + (w.is_default ? ' selected' : '') + '>' + esc(w.name) + (w.is_default ? ' (principal)' : '') + '</option>').join('');

    const rows = pendingLines.map(l => `
      <tr data-oid="${l.order_item_id}" data-pend="${l.pendiente}" data-pedido="${l.pedido}" data-rec="${l.recibido}">
        <td>${l.sku ? `<span style="color:var(--text3);font-size:.8rem">[${esc(l.sku)}]</span> ` : ''}${esc(l.product_name)}</td>
        <td style="text-align:right">${l.pedido}</td>
        <td style="text-align:right">${l.recibido}</td>
        <td style="text-align:right;font-weight:600">${l.pendiente}</td>
        <td>
          <input class="form-control r-qty" type="number" min="0" value="${l.pendiente}" style="width:90px" oninput="recalcR()">
          <div class="r-warn" style="display:none;color:var(--warn);font-size:.74rem;margin-top:4px;max-width:170px"></div>
        </td>
        <td><input class="form-control r-cost" type="number" min="0" step="0.01" value="${Number(l.unit_cost).toFixed(2)}" style="width:120px" oninput="recalcR()"></td>
        <td style="text-align:right"><span class="r-sub">0.00 ${sym}</span></td>
      </tr>`).join('');

    const content = `
      <div class="ph"><h2>Registrar recepción — ${esc(o.order_number || ('#' + id))}</h2><a href="/admin/purchase-orders/${id}" class="btn btn-secondary">Volver a la orden</a></div>
      <div class="alert alert-warn">Una recepción confirmada es <strong>inmutable</strong> y mueve el stock con el coste REAL recibido. Corregirla = anularla (con motivo) y crear otra. Pon cantidad 0 en las líneas que no llegan en esta entrega. Recibir <strong>más</strong> que el pendiente está permitido, pero se marca como exceso y exige confirmarlo expresamente.</div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Datos de la recepción</h3></div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Fecha *</label><input class="form-control" type="date" id="rDate" value="${today}"></div>
            <div class="form-group"><label class="form-label">Almacén de recepción</label><select class="form-control" id="rWarehouse">${whOptions}</select></div>
            <div class="form-group"><label class="form-label">Notas</label><input class="form-control" id="rNotes" placeholder="Nº de albarán del proveedor, incidencias..."></div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Líneas con pendiente</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th style="text-align:right">Pedido</th><th style="text-align:right">Recibido</th><th style="text-align:right">Pendiente</th><th>Recibir ahora</th><th>Coste unit. real (neto)</th><th style="text-align:right">Subtotal</th></tr></thead>
          <tbody id="rLines">${rows}</tbody>
          <tfoot><tr><td colspan="6" style="text-align:right;font-weight:700;padding:.7rem 1rem">Total recepción</td><td style="text-align:right;font-weight:700" id="rTotal">0.00 ${sym}</td></tr></tfoot>
        </table></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem">
        <a href="/admin/purchase-orders/${id}" class="btn btn-secondary">Cancelar</a>
        <button class="btn btn-primary" id="btn-confirm" onclick="confirmReceipt()">Confirmar recepción</button>
      </div>
      <script>
      const SYM = '${sym}';
      function rowsR(){ return Array.prototype.slice.call(document.querySelectorAll('#rLines tr')); }
      // Pie en vivo + AVISO de exceso por línea (C1.c): si la cantidad supera el
      // pendiente, la línea se resalta y dice cuánto recibirás de más. Nunca silencioso.
      function recalcR(){
        let total = 0;
        rowsR().forEach(function(r){
          const qty = parseInt(r.querySelector('.r-qty').value) || 0;
          const cost = parseFloat(r.querySelector('.r-cost').value) || 0;
          const sub = Math.round(qty * cost * 100) / 100;
          r.querySelector('.r-sub').textContent = sub.toFixed(2) + ' ' + SYM;
          total += sub;
          const pend = parseInt(r.dataset.pend), pedido = parseInt(r.dataset.pedido), rec = parseInt(r.dataset.rec);
          const warn = r.querySelector('.r-warn');
          if (qty > pend){
            const totalLinea = rec + qty;
            warn.textContent = 'Pedido ' + pedido + ', recibirás ' + totalLinea + ' — exceso de ' + (totalLinea - pedido);
            warn.style.display = '';
            r.style.background = 'var(--warn-s)';
          } else {
            warn.style.display = 'none';
            r.style.background = '';
          }
        });
        document.getElementById('rTotal').textContent = total.toFixed(2) + ' ' + SYM;
      }
      function collectR(){
        const items = [], excess = [];
        for (const r of rowsR()){
          const qty = parseInt(r.querySelector('.r-qty').value) || 0;
          const cost = parseFloat(r.querySelector('.r-cost').value);
          if (qty === 0) continue;                  // esta línea no llega en esta entrega
          if (qty < 0){ return { error: 'Cantidad inválida' }; }
          if (!(cost >= 0)){ return { error: 'Falta el coste unitario de una línea' }; }
          const pend = parseInt(r.dataset.pend), pedido = parseInt(r.dataset.pedido), rec = parseInt(r.dataset.rec);
          if (qty > pend){
            const totalLinea = rec + qty;
            excess.push(r.cells[0].textContent.trim() + ': pedido ' + pedido + ', recibirás ' + totalLinea + ' (exceso de ' + (totalLinea - pedido) + ')');
          }
          items.push({ order_item_id: parseInt(r.dataset.oid), quantity: qty, unit_cost: cost });
        }
        return { items: items, excess: excess };
      }
      async function confirmReceipt(){
        const col = collectR();
        if (col.error){ toast(col.error,'err'); return; }
        if (!col.items.length){ toast('Indica al menos una línea con cantidad a recibir','err'); return; }
        const date = document.getElementById('rDate').value;
        if (!date){ toast('La fecha es obligatoria','err'); return; }
        const units = col.items.reduce(function(s,i){ return s + i.quantity; }, 0);
        // Confirm-first: si hay exceso, la confirmación lo REPITE antes de guardar.
        let msg = 'Vas a CONFIRMAR la recepción de ' + col.items.length + ' línea(s) (' + units + ' unidades). Moverá el stock con el coste indicado y será inmutable (corregir = anular y crear otra).';
        if (col.excess.length){
          msg += '\\n\\nATENCIÓN — vas a recibir MÁS de lo pedido:\\n· ' + col.excess.join('\\n· ');
        }
        if (!confirm(msg + '\\n\\n¿Confirmar?')) return;
        const btn = document.getElementById('btn-confirm');
        btn.disabled = true;
        try {
          const d = await api('POST','/api/erp/purchase-orders/${id}/receipts',
            { date: date, notes: document.getElementById('rNotes').value.trim(), items: col.items, confirm_excess: col.excess.length > 0, warehouse_id: parseInt(document.getElementById('rWarehouse').value) || null });
          toast(d.message || 'Recepción confirmada');
          window.location.href = '/admin/purchase-order-receipts/' + d.id;
        } catch(e){ toast(e.message || 'Error registrando la recepción','err'); btn.disabled = false; }
      }
      recalcR();
      </script>`;
    return c.html(adminLayout('Registrar recepción', content, 'purchase-orders', csrfToken, c));
  });

  // Documento imprimible (patrón factura: página propia + window.print) con las
  // acciones según estado. Cabecera desde docParties: la enviada/anulada muestra
  // su foto congelada del envío; el borrador lee en vivo.
  views.get('/:id', requirePerm('purchases.read'), c => {
    const id = parseInt(c.req.param('id'));
    const o = getOrder(db, id);
    if (!o) return c.text('Orden no encontrada', 404);
    const items = getItems(db, id);
    const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id=?').get(o.supplier_id) || {};   // email VIVO para el confirm del botón de email
    const { emisor, proveedor } = docParties(db, o);
    const sym = company.currency_symbol || '€';
    const csrfToken = c.get('session')?.csrfToken || '';
    const canEdit = can(c, 'purchases.edit');
    const canCreate = can(c, 'purchases.create');

    // Enlaces de ciclo de vida: la orden que sustituye a esta (si fue anulada y
    // rehecha) y la que esta sustituye (si nació de un anular-y-rehacer).
    const replacedBy = db.prepare('SELECT id, order_number, status FROM purchase_orders WHERE replaces_order_id=? ORDER BY id DESC LIMIT 1').get(id) || null;
    const replacesPrev = o.replaces_order_id
      ? (db.prepare('SELECT id, order_number FROM purchase_orders WHERE id=?').get(o.replaces_order_id) || null)
      : null;

    let lifecycle = '';
    if (o.status === 'anulada') {
      lifecycle = `<div class="lifecycle lc-anulada"><strong>Orden anulada.</strong> Motivo: ${esc(o.anulada_motivo || '')}.` +
        (replacedBy ? ` La sustituye <a href="/admin/purchase-orders/${replacedBy.id}">${esc(replacedBy.order_number || ('el borrador #' + replacedBy.id))}</a>.` : '') +
        `</div>`;
    }
    if (replacesPrev) {
      lifecycle += `<div class="lifecycle lc-sustituye">Sustituye a <a href="/admin/purchase-orders/${replacesPrev.id}">${esc(replacesPrev.order_number || ('borrador #' + replacesPrev.id))}</a> (anulada).</div>`;
    }
    // C1.c — marca visible del cierre manual (también al imprimir, como la anulada).
    // (condición directa: isCerrada se declara más abajo, junto al pill)
    if (o.status !== 'anulada' && o.received_status === 'cerrada_manual') {
      lifecycle += `<div class="lifecycle lc-cerrada"><strong>Orden cerrada manualmente (incompleta).</strong> Motivo: ${esc(o.cerrada_motivo || '')}.
        <div style="font-size:11px;margin-top:4px">El pendiente queda declarado como que no va a llegar. Esta orden no admite más recepciones ni se reabre; anular una recepción confirmada revierte su stock, pero la orden permanece cerrada. Si necesitas rehacer el pedido, crea una orden nueva.</div></div>`;
    }

    // C1.b — estado de recepción (pedido/recibido/pendiente por línea + recepciones).
    // Solo aplica a órdenes que salieron de borrador; el bloque NO se imprime.
    const reception = o.status !== 'borrador' ? orderReceptionState(db, id) : null;
    const receipts = reception ? receiptsOfOrder(db, id) : [];
    const hasConfirmedReceipts = receipts.some(r => r.status === 'confirmada');

    const isCerrada = o.received_status === 'cerrada_manual';
    const statusPill =
      o.status === 'anulada' ? ['status-anulada', 'Anulada']
        : isCerrada ? ['status-cerrada', 'Cerrada (incompleta)']
        : o.received_status === 'recibida' ? ['status-recibida', 'Recibida']
        : o.received_status === 'parcial' ? ['status-parcial', 'Parcialmente recibida']
        : o.status === 'enviada' ? ['status-enviada', 'Enviada']
        : ['status-borrador', 'Borrador'];

    // C1.c — cierre manual: solo sobre enviada/parcial con pendiente > 0.
    const canClose = o.status === 'enviada' && !isCerrada && o.received_status !== 'recibida'
      && reception && reception.totalPendiente > 0;

    const statusBadgeMap = {
      'status-anulada': 'b-red', 'status-cerrada': 'b-gray', 'status-recibida': 'b-teal',
      'status-parcial': 'b-blue', 'status-enviada': 'b-green', 'status-borrador': 'b-yellow',
    };
    const statusBadge = `<span class="badge ${statusBadgeMap[statusPill[0]] || 'b-gray'}">${statusPill[1]}</span>`;

    const actions =
      (o.status === 'borrador' ? (
        (canEdit ? `<a href="/admin/purchase-orders/${id}/edit" class="btn btn-secondary">Editar</a>` : '') +
        (canEdit ? `<button onclick="enviarOrden()" class="btn btn-secondary">Enviar</button>` : '')
      ) : '') +
      (o.status === 'enviada' ? (
        (canEdit ? `<button onclick="emailOrden()" class="btn btn-secondary">Enviar por email</button>` : '') +
        (canEdit && canClose ? `<button onclick="cerrarOrden()" class="btn btn-secondary">Cerrar orden</button>` : '') +
        // Con recepciones confirmadas la orden no se puede anular (su stock ya se
        // movió): primero se anulan las recepciones. Se ocultan los botones.
        (canEdit && !hasConfirmedReceipts ? `<button onclick="anularOrden()" class="btn btn-danger">Anular</button>` : '') +
        (canCreate && !hasConfirmedReceipts ? `<button onclick="anularYRehacer()" class="btn btn-secondary">Anular y rehacer</button>` : '')
      ) : '');

    const receiptStatusBadge = s => s === 'confirmada'
      ? '<span class="badge b-green">Confirmada</span>'
      : '<span class="badge b-red">Anulada</span>';

    const receptionBlock = reception ? `
<div style="margin-top:32px;border-top:1px solid var(--border2);padding-top:16px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <h2 style="font-size:15px;font-weight:500">Recepción de mercancía</h2>
    ${o.status === 'enviada' && !isCerrada && reception.totalPendiente > 0 && canCreate
      ? `<a href="/admin/purchase-orders/${id}/receipts/new" class="btn btn-primary">Registrar recepción</a>` : ''}
  </div>
  <table>
    <thead><tr><th>Producto</th><th style="text-align:right">Pedido</th><th style="text-align:right">Recibido</th><th style="text-align:right">Pendiente</th></tr></thead>
    <tbody>${reception.lines.map(l => `
      <tr>
        <td>${esc(l.product_name)}${l.sku ? ` <span style="color:var(--text2);font-size:11px">[${esc(l.sku)}]</span>` : ''}</td>
        <td style="text-align:right">${l.pedido}</td>
        <td style="text-align:right">${l.exceso > 0 ? `${l.recibido} de ${l.pedido} <span style="color:var(--warn);font-weight:600">(+${l.exceso})</span>` : l.recibido}</td>
        <td style="text-align:right;font-weight:600${l.pendiente === 0 ? ';color:var(--ok)' : ''}">${l.pendiente}${isCerrada && l.pendiente > 0 ? ' <span style="color:var(--text2);font-size:11px">(no llegará)</span>' : ''}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ${receipts.length ? `
  <h2 style="font-size:14px;font-weight:500;margin:8px 0">Recepciones</h2>
  <table>
    <thead><tr><th>Número</th><th>Fecha</th><th>Estado</th><th style="text-align:right">Líneas</th><th style="text-align:right">Unidades</th><th></th></tr></thead>
    <tbody>${receipts.map(r => `
      <tr>
        <td style="font-family:ui-monospace,monospace;font-weight:600">${esc(r.receipt_number || ('#' + r.id))}</td>
        <td>${esc(r.date)}</td>
        <td>${receiptStatusBadge(r.status)}</td>
        <td style="text-align:right">${r.line_count}</td>
        <td style="text-align:right">${r.units}</td>
        <td style="text-align:right"><a href="/admin/purchase-order-receipts/${r.id}" class="btn btn-secondary btn-sm">Ver</a></td>
      </tr>`).join('')}
    </tbody>
  </table>` : '<div style="color:var(--text2);font-size:12px;margin-top:4px">Sin recepciones todavía.</div>'}
</div>` : '';

    const paper = `${lifecycle}
${documentBodyHtml(o, items, emisor, proveedor, sym)}
${receptionBlock}`;

    const panel = `
<div class="card"><div class="card-body">
  <div style="margin-bottom:12px">${statusBadge}</div>
  <div class="dp-row"><span class="k">Nº</span><span class="v">${o.order_number ? esc(o.order_number) : 'Borrador'}</span></div>
  <div class="dp-row"><span class="k">Fecha</span><span class="v">${esc(o.date)}</span></div>
  ${o.expected_date ? `<div class="dp-row"><span class="k">Entrega prevista</span><span class="v">${esc(o.expected_date)}</span></div>` : ''}
  <div class="dp-row"><span class="k">Proveedor</span><span class="v">${esc(proveedor.name || '')}</span></div>
  <div class="dp-actions" style="margin-top:14px">
    <button onclick="window.print()" class="btn btn-primary">Imprimir</button>
    ${actions}
    <a href="/admin/purchase-orders" class="btn btn-secondary">Volver al listado</a>
  </div>
</div></div>
<script>
  const CSRF = ${JSON.stringify(csrfToken)};
  async function post(url, body){
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','x-csrf-token':CSRF}, body: JSON.stringify(body||{}) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d;
  }
  async function enviarOrden(){
    if (!confirm('¿Enviar esta orden? Recibirá su número OC y quedará bloqueada (no editable).')) return;
    try { const d = await post('/api/erp/purchase-orders/${id}/enviar'); alert('Orden ' + d.order_number + ' enviada'); location.reload(); }
    catch(e){ alert(e.message || 'Error'); }
  }
  async function emailOrden(){
    if (!confirm('¿Enviar la orden por email a ${esc(supplier.email || 'el proveedor')}?')) return;
    try { const d = await post('/api/erp/purchase-orders/${id}/email'); alert('Enviada por email a ' + d.to); }
    catch(e){ alert(e.message || 'Error enviando el email'); }
  }
  async function anularOrden(){
    const motivo = prompt('Motivo de anulación de la orden ${esc(o.order_number || '')}:');
    if (motivo === null) return;
    if (motivo.trim().length < 3){ alert('El motivo es obligatorio (mínimo 3 caracteres)'); return; }
    try { await post('/api/erp/purchase-orders/${id}/anular', { motivo: motivo.trim() }); location.reload(); }
    catch(e){ alert(e.message || 'Error anulando'); }
  }
  async function anularYRehacer(){
    const motivo = prompt('Motivo de anulación (se abrirá un borrador nuevo precargado):');
    if (motivo === null) return;
    if (motivo.trim().length < 3){ alert('El motivo es obligatorio (mínimo 3 caracteres)'); return; }
    try { const d = await post('/api/erp/purchase-orders/${id}/anular-y-rehacer', { motivo: motivo.trim() }); window.location.href = '/admin/purchase-orders/' + d.id + '/edit'; }
    catch(e){ alert(e.message || 'Error'); }
  }
  async function cerrarOrden(){
    const motivo = prompt('Motivo del cierre (el pendiente NO va a llegar; la orden no admitirá más recepciones ni se reabre):');
    if (motivo === null) return;
    if (motivo.trim().length < 3){ alert('El motivo es obligatorio (mínimo 3 caracteres)'); return; }
    try { await post('/api/erp/purchase-orders/${id}/close', { motivo: motivo.trim() }); location.reload(); }
    catch(e){ alert(e.message || 'Error cerrando la orden'); }
  }
</script>`;
    return c.html(adminLayout('Orden de compra ' + (o.order_number ? esc(o.order_number) : '(borrador)'), docShell(paper, panel), 'purchase-orders', csrfToken, c));
  });

  return { api, views };
}
