import { renderEmail, TONO_UNICO } from '../email-templates.js';
import { Hono } from 'hono';
import { adminLayout, can, docShell, printableShell, estadoTabs, emptyRow, errorShell, ERR } from '../layout.js';
import { renderPdfFromHtml } from '../../../core/pdf.js';   // PDF real: mismo HTML imprimible → Chromium
import { validate } from '../../../core/validate.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { checkPermission } from '../../../core/permission-check.js';
import { quoteCreateSchema, quoteComputeSchema, quoteAnularSchema, quoteConvertSchema, quoteFollowSchema, quoteEmailSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { computeTotals, createInvoice, invoiceStockExcess, excessLineText } from './invoices.js';
import { lineSearchCellHtml, lineSearchScript } from '../views/line-search.js';
import { sendEmail } from '../../../core/mailer.js';
import { createPedidoSvc } from './pedidos.js';   // PIEZA 2a: presupuesto → pedido (motor de conversión)
import { ENTITY } from '../../../core/activity-entities.js';

// ════════════════════════════════════════════════════════════════════════════
// PILAR 4 · VENTAS · PIEZA 1 — PRESUPUESTO + MOTOR DE CONVERSIÓN.
// ESPEJO de la orden de compra (purchase_orders): mismo ciclo borrador→emitido→anulado,
// numeración PRE-NNNN solo al emitir, foto congelada al emitir, permisos por ruta, lista con
// buscador/filtro/paginación. Líneas como la FACTURA (catálogo o libre). Totales con la
// matemática de la factura (base + IVA por tasa + IRPF). El presupuesto NO mueve stock.
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function checkClient(db, clientId) {
  const c = db.prepare('SELECT id FROM clients WHERE id=?').get(clientId);
  if (!c) { const e = new Error('Cliente no encontrado'); e.status = 400; throw e; }
}

// Re-resuelve cada línea contra el catálogo: línea de catálogo (product_id) → el IVA lo fija el
// SERVIDOR desde la banda del producto (nunca se confía en el cliente); línea libre → el IVA que
// venga (el formulario manda 21% fijo, como la factura). unit_price es NETO.
function resolveQuoteLines(db, lines) {
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

// IRPF del presupuesto: igual que la factura — solo si el negocio es ES y el cliente es empresa,
// con el % por defecto del negocio (company_config.irpf_default). Particular → 0.
function quoteIrpfRate(db, clientId) {
  const cfg = db.prepare('SELECT country, irpf_default FROM company_config WHERE id=1').get() || {};
  if ((cfg.country || 'ES').toUpperCase() !== 'ES') return 0;
  const cl = clientId ? db.prepare('SELECT client_type FROM clients WHERE id=?').get(clientId) : null;
  return (cl && cl.client_type === 'empresa') ? (Number(cfg.irpf_default) || 0) : 0;
}

// Totales con la MISMA matemática de la factura (computeTotals): base + IVA por tasa − IRPF.
export function quoteTotals(db, clientId, resolvedLines) {
  const irpf_rate = quoteIrpfRate(db, clientId);
  const t = computeTotals(resolvedLines.map(l => ({ quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate })), irpf_rate);
  return { subtotal: t.subtotal, tax_amount: t.taxAmount, irpf_rate, irpf_amount: t.irpfAmount, total: t.total, taxByRate: t.taxByRate };
}

function insertItems(db, quoteId, lines) {
  const ins = db.prepare('INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, total_price, tax_rate, tax_amount) VALUES (?,?,?,?,?,?,?,?)');
  for (const l of lines) {
    const base = Math.round(l.quantity * l.unit_price * 100) / 100;
    const tax = Math.round(base * l.tax_rate / 100 * 100) / 100;
    ins.run(quoteId, l.product_id || null, l.description, l.quantity, l.unit_price, base, l.tax_rate, tax);
  }
}

function getQuote(db, id) {
  return db.prepare('SELECT q.*, c.name AS client_live_name FROM quotes q JOIN clients c ON q.client_id=c.id WHERE q.id=?').get(id);
}
function getItems(db, quoteId) {
  return db.prepare('SELECT qi.*, p.sku FROM quote_items qi LEFT JOIN products p ON qi.product_id=p.id WHERE qi.quote_id=? ORDER BY qi.id').all(quoteId);
}

// ── Servicios (testables; los usan las rutas) ───────────────────────────────

export function createQuoteSvc(db, d) {
  checkClient(db, d.client_id);
  const lines = resolveQuoteLines(db, d.lines);
  const tot = quoteTotals(db, d.client_id, lines);
  const date = d.date || new Date().toISOString().slice(0, 10);
  const cfg = db.prepare('SELECT currency, currency_symbol FROM company_config WHERE id=1').get() || {};
  const run = db.transaction(() => {
    const r = db.prepare(`INSERT INTO quotes (client_id, date, valid_until, notes, subtotal, tax_amount, irpf_rate, irpf_amount, total, currency, currency_symbol)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      d.client_id, date, d.valid_until || null, d.notes || '',
      tot.subtotal, tot.tax_amount, tot.irpf_rate, tot.irpf_amount, tot.total,
      cfg.currency || 'EUR', cfg.currency_symbol || '€');
    const id = r.lastInsertRowid;
    insertItems(db, id, lines);
    return id;
  });
  return run();
}

// EDITAR: solo un borrador (el emitido se anula y se rehace).
export function updateQuoteSvc(db, id, d) {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) { const e = new Error('Presupuesto no encontrado'); e.status = 404; throw e; }
  if (q.status !== 'borrador') { const e = new Error('Solo se puede editar un borrador (el presupuesto emitido se anula y se rehace)'); e.status = 400; throw e; }
  checkClient(db, d.client_id);
  const lines = resolveQuoteLines(db, d.lines);
  const tot = quoteTotals(db, d.client_id, lines);
  db.transaction(() => {
    db.prepare('UPDATE quotes SET client_id=?, date=?, valid_until=?, notes=?, subtotal=?, tax_amount=?, irpf_rate=?, irpf_amount=?, total=? WHERE id=?')
      .run(d.client_id, d.date || q.date, d.valid_until || null, d.notes || '', tot.subtotal, tot.tax_amount, tot.irpf_rate, tot.irpf_amount, tot.total, id);
    db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(id);
    insertItems(db, id, lines);
  })();
  return { id };
}

// EMITIR: el borrador gana su número PRE-NNNN (contador code_counters, solo aquí) y se bloquea.
// En la MISMA transacción se CONGELA la foto de emisor + cliente (igual que la factura/OC).
export function emitQuoteSvc(db, id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) { const e = new Error('Presupuesto no encontrado'); e.status = 404; throw e; }
  if (q.status !== 'borrador') { const e = new Error('Solo se puede emitir un borrador'); e.status = 400; throw e; }
  if (!db.prepare('SELECT 1 FROM quote_items WHERE quote_id=?').get(id)) { const e = new Error('El presupuesto no tiene líneas'); e.status = 400; throw e; }
  const run = db.transaction(() => {
    const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(q.client_id) || {};
    const number = nextCode(db, 'quote');
    db.prepare(`UPDATE quotes SET quote_number=?, status='emitido',
        company_name=?, company_fiscal_id=?, company_address=?, company_phone=?, company_email=?,
        client_name=?, client_fiscal_id=?, client_address=?, client_email=?
      WHERE id=?`).run(
      number,
      cfg.company_name || '', cfg.fiscal_id || '', cfg.address || '', cfg.phone || '', cfg.email || '',
      cl.name || '', cl.fiscal_id || '', cl.address || '', cl.email || '',
      id);
    return { id, quote_number: number };
  });
  return run();
}

// ANULAR: solo un emitido, con motivo (mín. 3). No se borra ni se edita nada.
export function anularQuoteSvc(db, id, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) { const e = new Error('Presupuesto no encontrado'); e.status = 404; throw e; }
  if (q.status !== 'emitido') { const e = new Error('Solo se puede anular un presupuesto emitido'); e.status = 400; throw e; }
  db.prepare("UPDATE quotes SET status='anulado', anulada_motivo=? WHERE id=?").run(m, id);
  return { id, quote_number: q.quote_number };
}

// ANULAR Y REHACER: anula el emitido y abre un borrador NUEVO precargado con su cliente y líneas,
// enlazado vía replaces_quote_id (espejo OC).
export function anularYRehacerQuoteSvc(db, id, motivo, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const run = db.transaction(() => {
    const anulada = anularQuoteSvc(db, id, motivo);
    const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
    const r = db.prepare(`INSERT INTO quotes (client_id, date, valid_until, notes, replaces_quote_id, subtotal, tax_amount, irpf_rate, irpf_amount, total, currency, currency_symbol)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      q.client_id, today, q.valid_until || null, q.notes || '', id,
      q.subtotal, q.tax_amount, q.irpf_rate, q.irpf_amount, q.total, q.currency || 'EUR', q.currency_symbol || '€');
    const newId = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, total_price, tax_rate, tax_amount) VALUES (?,?,?,?,?,?,?,?)');
    for (const it of db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id').all(id)) {
      ins.run(newId, it.product_id, it.description, it.quantity, it.unit_price, it.total_price, it.tax_rate, it.tax_amount);
    }
    return { id: newId, anulada_id: id, anulada_number: anulada.quote_number };
  });
  return run();
}

// SEGUIMIENTO: aceptado | rechazado | caducado (o '' para limpiar). Solo sobre un emitido.
export function setFollowStatusSvc(db, id, follow) {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) { const e = new Error('Presupuesto no encontrado'); e.status = 404; throw e; }
  if (q.status !== 'emitido') { const e = new Error('El seguimiento solo aplica a un presupuesto emitido'); e.status = 400; throw e; }
  db.prepare('UPDATE quotes SET follow_status=? WHERE id=?').run(follow || null, id);
  return { id, follow_status: follow || null };
}

// MOTOR DE CONVERSIÓN (general). Hoy: presupuesto emitido → FACTURA (createInvoice, real) con
// enlace bidireccional en document_links. 'ticket' queda registrado como destino, pero su creador
// se construye con la pieza de TPV. Solo conversión del documento COMPLETO (el código y el enlace
// admiten ya varias conversiones por origen → la parcial encaja después sin rehacer esto).
export function convertQuoteSvc(db, id, dest) {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) { const e = new Error('Presupuesto no encontrado'); e.status = 404; throw e; }
  if (q.status !== 'emitido') { const e = new Error('Solo se puede convertir un presupuesto emitido'); e.status = 400; throw e; }
  if (dest === 'ticket') { const e = new Error('La conversión a TICKET se construye con la pieza de TPV (mostrador). Por ahora, convierte a factura.'); e.status = 501; throw e; }
  if (dest !== 'invoice' && dest !== 'order') { const e = new Error('Destino de conversión no soportado'); e.status = 400; throw e; }
  const items = db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id').all(id);
  const lines = items.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, tax_rate: i.tax_rate, product_id: i.product_id || undefined }));

  // PIEZA 2a — presupuesto → PEDIDO (en BORRADOR): arrastra las líneas a un pedido nuevo
  // (sin número, sin reserva) que el usuario revisa —almacén, entrega prevista— y confirma.
  // Materializa el "siguiente paso que se propone". Enlace bidireccional en document_links.
  if (dest === 'order') {
    const already = db.prepare("SELECT dest_id FROM document_links WHERE source_type='quote' AND source_id=? AND dest_type='order'").get(id);
    if (already) {
      const ped = db.prepare('SELECT order_number, status FROM customer_orders WHERE id=?').get(already.dest_id);
      const ref = ped ? (ped.order_number || ('borrador #' + already.dest_id)) : ('#' + already.dest_id);
      const e = new Error('Este presupuesto ya se convirtió al pedido ' + ref + '.'); e.status = 400; throw e;
    }
    const run = db.transaction(() => {
      const pid = createPedidoSvc(db, {
        client_id: q.client_id, lines,
        notes: 'Procede del presupuesto ' + (q.quote_number || ('#' + id)),
      });
      db.prepare("INSERT INTO document_links (source_type, source_id, dest_type, dest_id) VALUES ('quote', ?, 'order', ?)").run(id, pid);
      return { dest: 'order', order_id: pid };
    });
    return run();
  }

  const already = db.prepare("SELECT dest_id FROM document_links WHERE source_type='quote' AND source_id=? AND dest_type='invoice'").get(id);
  if (already) {
    const inv = db.prepare('SELECT invoice_number FROM invoices WHERE id=?').get(already.dest_id);
    const e = new Error('Este presupuesto ya se convirtió a la factura ' + (inv ? inv.invoice_number : '#' + already.dest_id) + '.'); e.status = 400; throw e;
  }
  const run = db.transaction(() => {
    const inv = createInvoice(db, {
      client_id: q.client_id, lines, irpf_rate: q.irpf_rate,
      notes: 'Procede del presupuesto ' + (q.quote_number || ('#' + id)),
    });
    db.prepare("INSERT INTO document_links (source_type, source_id, dest_type, dest_id) VALUES ('quote', ?, 'invoice', ?)").run(id, inv.id);
    return { dest: 'invoice', invoice_id: inv.id, invoice_number: inv.invoice_number };
  });
  return run();
}

// EMAIL AL CLIENTE: solo un emitido y solo si el cliente tiene email. Confirm-first (lo pulsa el
// usuario). Resend devuelve {data,error} sin lanzar. opts.sendEmail se inyecta (mock en tests).
export async function emailQuoteSvc(db, id, opts = {}) {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) { const e = new Error('Presupuesto no encontrado'); e.status = 404; throw e; }
  if (q.status !== 'emitido') { const e = new Error('Solo se puede enviar por email un presupuesto emitido'); e.status = 400; throw e; }
  // Destinatario EDITABLE (envío puntual): viene del campo "Para" (pre-rellenado en la pantalla
  // con el email de la ficha, pero modificable). NO se exige que la ficha tenga email, NI se
  // modifica la ficha. Validación: vacío → 400; formato inválido → 400.
  const to = String(opts.to == null ? '' : opts.to).trim();
  if (!to) { const e = new Error('Indica un correo de destino'); e.status = 400; throw e; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { const e = new Error('El correo de destino no tiene un formato válido'); e.status = 400; throw e; }
  if (typeof opts.sendEmail !== 'function') { const e = new Error('El envío de email no está configurado'); e.status = 500; throw e; }
  const items = getItems(db, id);
  const sym = q.currency_symbol || '€';
  const { emisor, cliente } = docParties(db, q);
  const empresa = emisor.name || 'Bamburu';
  // PDF ADJUNTO: el documento ya NO va en el cuerpo del email — va como PDF (mismo HTML imprimible
  // del presupuesto, vía printableShell + Chromium). renderPdf inyectable (mock en tests). Si la
  // generación del PDF FALLA, se ERRA claro y NO se envía email (nada de email sin adjunto).
  const renderPdf = typeof opts.renderPdf === 'function' ? opts.renderPdf : renderPdfFromHtml;
  let pdf;
  try {
    pdf = await renderPdf(printableShell(quoteDocumentBodyHtml(q, items, emisor, cliente, sym), { title: 'Presupuesto ' + q.quote_number }));
  } catch (e) {
    const err = new Error('No se pudo generar el PDF del presupuesto: ' + (e.message || e) + '. No se ha enviado el email.'); err.status = 502; throw err;
  }
  if (!pdf || !pdf.length) { const e = new Error('El PDF del presupuesto salió vacío. No se ha enviado el email.'); e.status = 502; throw e; }
  const fname = ('Presupuesto-' + (q.quote_number || ('' + id)) + '.pdf').replace(/[\/\\]/g, '-');
  // Cuerpo CORTO + PDF adjunto. El TEXTO sale del catálogo de plantillas (editable en Ajustes);
  // el PDF se adjunta siempre, lo diga el texto o no.
  const tpl = renderEmail(db, 'presupuesto', TONO_UNICO, {
    numero: q.quote_number || String(id),
    validez: q.valid_until || '—',
    empresa,
  });
  const html = tpl.html, text = tpl.text;
  const payload = {
    from: empresa + ' <noreply@bamburu.com>', to, subject: tpl.subject, html, text,
    attachments: [{ filename: fname, content: pdf }],
  };
  if (emisor.email) payload.replyTo = emisor.email;
  const { data, error } = await opts.sendEmail(payload);
  if (error) { const e = new Error(ERR.EMAIL); e.status = 502; throw e; }   // U3: sin volcar el objeto de Resend
  return { sent: true, to, quote_number: q.quote_number, id: data && data.id };
}

// ── Documento (compartido entre vista imprimible y email) ───────────────────
// Cabecera de emisor + cliente: el emitido/anulado usa su FOTO CONGELADA; el borrador lee en vivo.
function docParties(db, q) {
  if (q.company_name != null) {
    return {
      emisor:  { name: q.company_name, fiscal_id: q.company_fiscal_id, address: q.company_address, phone: q.company_phone, email: q.company_email },
      cliente: { name: q.client_name, fiscal_id: q.client_fiscal_id, address: q.client_address, email: q.client_email },
    };
  }
  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const cl = db.prepare('SELECT * FROM clients WHERE id=?').get(q.client_id) || {};
  return {
    emisor:  { name: cfg.company_name || '', fiscal_id: cfg.fiscal_id || '', address: cfg.address || '', phone: cfg.phone || '', email: cfg.email || '' },
    cliente: { name: cl.name || '', fiscal_id: cl.fiscal_id || '', address: cl.address || '', email: cl.email || '' },
  };
}

// Líneas + pie con base → IVA por tasa → IRPF (si >0) → total. Mismo desglose que la factura.
function quoteDocumentBodyHtml(q, items, emisor, cliente, sym) {
  const taxByRate = {};
  for (const i of items) {
    const r = Number(i.tax_rate) || 0;
    if (!taxByRate[r]) taxByRate[r] = { rate: r, base: 0, amount: 0 };
    taxByRate[r].base += Number(i.total_price) || 0;
    taxByRate[r].amount += Number(i.tax_amount) || 0;
  }
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3)">${esc(i.description)}${i.sku ? ` <span style="color:var(--text2);font-size:11px">[${esc(i.sku)}]</span>` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${i.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${sym}${Number(i.unit_price).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${Number(i.tax_rate) > 0 ? Number(i.tax_rate) + '%' : 'Exento'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--bg3);text-align:right">${sym}${Number(i.total_price).toFixed(2)}</td>
    </tr>`).join('');
  const taxRows = Object.values(taxByRate).sort((a, b) => b.rate - a.rate).map(x =>
    `<tr><td style="padding:4px 12px;color:var(--text2)">${x.rate > 0 ? 'IVA ' + x.rate + '%' : 'Exento de IVA'} (sobre ${sym}${x.base.toFixed(2)})</td><td style="padding:4px 12px;text-align:right;font-weight:600">${sym}${x.amount.toFixed(2)}</td></tr>`
  ).join('');
  const irpfRow = (Number(q.irpf_amount) > 0)
    ? `<tr><td style="padding:4px 12px;color:var(--accent-purple)">IRPF (${q.irpf_rate}%)</td><td style="padding:4px 12px;text-align:right;color:var(--accent-purple)">−${sym}${Number(q.irpf_amount).toFixed(2)}</td></tr>` : '';
  return `
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
  <div>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 4px">Presupuesto</h1>
    <div style="color:var(--text2);font-size:12px">${q.quote_number ? esc(q.quote_number) : 'Borrador (sin número)'}</div>
  </div>
  <div style="text-align:right;color:var(--text2);font-size:12px">
    <div>Fecha: <strong style="color:var(--accent-d)">${esc(q.date)}</strong></div>
    ${q.valid_until ? `<div>Válido hasta: <strong style="color:var(--accent-d)">${esc(q.valid_until)}</strong></div>` : ''}
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:24px">
  <div>
    <div style="font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:4px">Emisor</div>
    <div><strong>${esc(emisor.name || '')}</strong></div>
    ${emisor.fiscal_id ? `<div>${esc(emisor.fiscal_id)}</div>` : ''}
    ${emisor.address ? `<div style="color:var(--text2)">${esc(emisor.address)}</div>` : ''}
  </div>
  <div>
    <div style="font-size:11px;text-transform:uppercase;color:var(--text2);font-weight:600;margin-bottom:4px">Cliente</div>
    <div><strong>${esc(cliente.name || '')}</strong></div>
    ${cliente.fiscal_id ? `<div>${esc(cliente.fiscal_id)}</div>` : ''}
    ${cliente.address ? `<div style="color:var(--text2)">${esc(cliente.address)}</div>` : ''}
    ${cliente.email ? `<div style="color:var(--text2)">${esc(cliente.email)}</div>` : ''}
  </div>
</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
  <thead><tr>
    <th style="background:var(--bg);padding:8px 12px;text-align:left;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Descripción</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Cant.</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">P. unit.</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">IVA</th>
    <th style="background:var(--bg);padding:8px 12px;text-align:right;font-size:12px;color:var(--text2);border-bottom:2px solid var(--border2)">Subtotal</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<table style="margin-left:auto;width:320px;border-collapse:collapse">
  <tr><td style="padding:4px 12px;color:var(--text2)">Base imponible</td><td style="padding:4px 12px;text-align:right;font-weight:600">${sym}${Number(q.subtotal).toFixed(2)}</td></tr>
  ${taxRows}
  ${irpfRow}
  <tr><td style="padding:10px 12px;font-size:15px;border-top:2px solid var(--accent-d);font-weight:700">TOTAL</td><td style="padding:10px 12px;text-align:right;font-size:15px;border-top:2px solid var(--accent-d);font-weight:700">${sym}${Number(q.total).toFixed(2)}</td></tr>
</table>
${q.notes ? `<div style="margin-top:16px;color:var(--text2)">${esc(q.notes)}</div>` : ''}`;
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export function createQuoteRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ¿Puede emitir factura con exceso de stock? (espejo del gate de la factura): owner/admin o permiso.
  const canEmitOverStock = c => c.get('isAdmin') || checkPermission(db, c.get('session'), 'sales', 'emit_over_stock');

  const ESTADO_FILTER = {
    borrador: "q.status='borrador'",
    emitido:  "q.status='emitido' AND q.follow_status IS NULL",
    aceptado: "q.follow_status='aceptado'",
    rechazado: "q.follow_status='rechazado'",
    caducado: "q.follow_status='caducado'",
    anulado:  "q.status='anulado'",
  };
  const ESTADO_OPTION_LABEL = { borrador: 'Borradores', emitido: 'Emitidos', aceptado: 'Aceptados', rechazado: 'Rechazados', caducado: 'Caducados', anulado: 'Anulados' };
  const displayEstado = (q) =>
    q.status === 'anulado' ? ['Anulado', 'b-red']
      : q.follow_status === 'aceptado' ? ['Aceptado', 'b-teal']
      : q.follow_status === 'rechazado' ? ['Rechazado', 'b-gray']
      : q.follow_status === 'caducado' ? ['Caducado', 'b-gray']
      : q.status === 'emitido' ? ['Emitido', 'b-green']
      : ['Borrador', 'b-yellow'];

  // ── API ──
  api.get('/:id', requirePerm('quotes.read'), c => {
    try {
      const q = getQuote(db, parseInt(c.req.param('id')));
      if (!q) return c.json({ error: 'No encontrado' }, 404);
      return c.json({ ...q, items: getItems(db, q.id) });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // Pie en vivo (mismo patrón que /invoices/compute-totals).
  api.post('/compute-totals', requirePerm('quotes.read'), validate(quoteComputeSchema), c => {
    try {
      const { client_id, lines } = c.get('validated');
      const resolved = resolveQuoteLines(db, lines);
      const t = quoteTotals(db, client_id, resolved);
      return c.json({ subtotal: t.subtotal, taxByRate: t.taxByRate, taxAmount: t.tax_amount, irpfRate: t.irpf_rate, irpfAmount: t.irpf_amount, total: t.total });
    } catch (e) { return c.json({ error: e.message }, 400); }
  });

  api.post('/', requirePerm('quotes.create'), validate(quoteCreateSchema), c => {
    try {
      const id = createQuoteSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó borrador de presupuesto', ENTITY.QUOTE, id, '');
      return c.json({ id, message: 'Borrador guardado' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.put('/:id', requirePerm('quotes.edit'), validate(quoteCreateSchema), c => {
    try {
      const r = updateQuoteSvc(db, parseInt(c.req.param('id')), c.get('validated'));
      logActivity(db, c.get('session'), 'Editó borrador de presupuesto', ENTITY.QUOTE, r.id, '');
      return c.json({ ...r, message: 'Borrador actualizado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/emitir', requirePerm('quotes.edit'), c => {
    try {
      const r = emitQuoteSvc(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Emitió presupuesto', ENTITY.QUOTE, r.id, r.quote_number);
      return c.json({ ...r, message: 'Presupuesto ' + r.quote_number + ' emitido' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/email', requirePerm('quotes.edit'), validate(quoteEmailSchema), async c => {
    try {
      const r = await emailQuoteSvc(db, parseInt(c.req.param('id')), { to: c.get('validated').to, sendEmail });
      logActivity(db, c.get('session'), 'Envió presupuesto por email', ENTITY.QUOTE, parseInt(c.req.param('id')), r.quote_number + ' → ' + r.to);
      return c.json({ ...r, message: 'Presupuesto enviado por email a ' + r.to });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/follow', requirePerm('quotes.edit'), validate(quoteFollowSchema), c => {
    try {
      const r = setFollowStatusSvc(db, parseInt(c.req.param('id')), c.get('validated').follow_status);
      logActivity(db, c.get('session'), 'Actualizó seguimiento de presupuesto', ENTITY.QUOTE, r.id, r.follow_status || 'sin estado');
      return c.json({ ...r, message: 'Seguimiento actualizado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/anular', requirePerm('quotes.edit'), validate(quoteAnularSchema), c => {
    try {
      const r = anularQuoteSvc(db, parseInt(c.req.param('id')), c.get('validated').motivo);
      logActivity(db, c.get('session'), 'Anuló presupuesto', ENTITY.QUOTE, r.id, (r.quote_number || '') + ' — ' + c.get('validated').motivo);
      return c.json({ ...r, message: 'Presupuesto anulado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/anular-y-rehacer', requirePerm('quotes.create'), validate(quoteAnularSchema), c => {
    try {
      const r = anularYRehacerQuoteSvc(db, parseInt(c.req.param('id')), c.get('validated').motivo);
      logActivity(db, c.get('session'), 'Anuló y rehízo presupuesto', ENTITY.QUOTE, r.id, 'sustituye a ' + (r.anulada_number || ('#' + r.anulada_id)));
      return c.json({ ...r, message: 'Presupuesto anulado; borrador nuevo creado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // MOTOR DE CONVERSIÓN. A factura: aplica el MISMO gate de exceso de stock que la pantalla de
  // factura (nunca en silencio): exceso sin confirm_excess → 400; sin permiso → 403.
  api.post('/:id/convert', requirePerm('quotes.edit'), validate(quoteConvertSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const { dest, confirm_excess } = c.get('validated');
      if (dest === 'invoice') {
        const q = db.prepare("SELECT id, status FROM quotes WHERE id=?").get(id);
        if (q && q.status === 'emitido') {
          const items = db.prepare('SELECT description, quantity, unit_price, tax_rate, product_id FROM quote_items WHERE quote_id=?').all(id);
          const excess = invoiceStockExcess(db, items);
          if (excess.length) {
            const detalle = excess.map(excessLineText).join('; ');
            if (!confirm_excess) return c.json({ error: 'La factura supera el stock disponible — ' + detalle + '. Confirma el exceso para convertir (confirm_excess).', excess }, 400);
            if (!canEmitOverStock(c)) return c.json({ error: 'No tienes permiso para facturar con exceso de stock. Solo el dueño o un administrador pueden hacerlo.' }, 403);
          }
        }
      }
      const r = convertQuoteSvc(db, id, dest);
      if (r.dest === 'order') {
        logActivity(db, c.get('session'), 'Convirtió presupuesto a pedido', ENTITY.QUOTE, id, 'pedido #' + r.order_id);
        return c.json({ ...r, message: 'Presupuesto convertido a un pedido (borrador). Revísalo y confírmalo para reservar el stock.' });
      }
      logActivity(db, c.get('session'), 'Convirtió presupuesto a factura', ENTITY.QUOTE, id, r.invoice_number || '');
      return c.json({ ...r, message: 'Presupuesto convertido a la factura ' + r.invoice_number });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // ── VISTAS ──

  // Lista server-rendered (patrón OC): búsqueda por cliente o número, filtro por estado, paginación 25.
  views.get('/', requirePerm('quotes.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const qstr = (c.req.query('q') || '').trim();
    const estado = (c.req.query('estado') || '').trim();
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    const where = [], params = [];
    if (qstr) { where.push('(cl.name LIKE ? OR q.quote_number LIKE ?)'); params.push('%' + qstr + '%', '%' + qstr + '%'); }
    if (estado && ESTADO_FILTER[estado]) where.push('(' + ESTADO_FILTER[estado] + ')');
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare('SELECT COUNT(*) AS n FROM quotes q JOIN clients cl ON q.client_id=cl.id ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const quotes = db.prepare('SELECT q.*, cl.name AS client_live_name FROM quotes q JOIN clients cl ON q.client_id=cl.id ' + whereSql + ' ORDER BY q.date DESC, q.id DESC LIMIT ? OFFSET ?').all(...params, perPage, offset);

    const buildQs = (p) => { const u = new URLSearchParams(); if (qstr) u.set('q', qstr); if (estado) u.set('estado', estado); u.set('page', String(p)); return u.toString(); };
    const rowsHtml = quotes.map(q => {
      const [lbl, badge] = displayEstado(q);
      const name = q.company_name != null ? (q.client_name || q.client_live_name) : q.client_live_name;
      return '<tr>'
        + '<td>' + (q.quote_number ? '<strong style="font-family:monospace">' + esc(q.quote_number) + '</strong>' : '<span style="color:var(--text3)">Borrador</span>') + '</td>'
        + '<td><strong>' + esc(name) + '</strong></td>'
        + '<td>' + esc(q.date) + '</td>'
        + '<td><span class="badge ' + badge + '">' + esc(lbl) + '</span></td>'
        + '<td><strong>' + Number(q.total).toFixed(2) + ' ' + sym + '</strong></td>'
        + '<td style="text-align:right"><a href="/admin/quotes/' + q.id + '" class="btn btn-secondary btn-sm">Ver</a></td>'
        + '</tr>';
    }).join('');
    const estadoTabsHtml = estadoTabs(estado, [['', 'Todos'], ...Object.entries(ESTADO_OPTION_LABEL)], qstr);

    const content = `
      <div class="ph">
        <h2>Presupuestos</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${esc(qstr)}" placeholder="Buscar por cliente o número...">
          <input type="hidden" name="estado" value="${esc(estado)}">
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'quotes.create') ? '<a href="/admin/quotes/new" class="btn btn-primary">Nuevo presupuesto</a>' : ''}
        </form>
      </div>
      ${estadoTabsHtml}
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Total</th><th></th></tr></thead>
        <tbody>${total === 0 ? ((qstr || estado) ? emptyRow(6, 'No se encontraron presupuestos con ese filtro.', { icon: 'ti-search' }) : emptyRow(6, 'Todavía no tienes presupuestos. ¿Preparamos el primero?', { cta: 'Nuevo presupuesto', href: '/admin/quotes/new' })) : rowsHtml}</tbody>
      </table></div></div>
      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--text3);font-size:.85rem">Página ${page} de ${totalPages} · ${total} presupuesto${total === 1 ? '' : 's'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div></div>` : ''}`;
    return c.html(adminLayout('Presupuestos', content, 'quotes', c.get('session')?.csrfToken || '', c));
  });

  // Formulario de alta/edición de borrador (líneas como la FACTURA: catálogo o libre).
  const formView = (c, existing = null) => {
    const cfg = db.prepare('SELECT currency_symbol, country, irpf_default FROM company_config WHERE id=1').get() || {};
    const sym = cfg.currency_symbol || '€';
    const showIrpf = (cfg.country || 'ES').toUpperCase() === 'ES';
    const irpfDefault = Number(cfg.irpf_default) || 0;
    const today = new Date().toISOString().slice(0, 10);
    const csrfToken = c.get('session')?.csrfToken || '';
    const clients = db.prepare("SELECT id, name, fiscal_id, client_type FROM clients ORDER BY name").all();
    if (!clients.length) {
      return c.html(adminLayout('Nuevo presupuesto', `<div class="ph"><h2>Nuevo presupuesto</h2><a href="/admin/quotes" class="btn btn-secondary">Volver</a></div><div class="card card-body" style="text-align:center;padding:2rem;color:var(--text3)">No hay clientes. <a href="/admin/clients">Crea uno primero.</a></div>`, 'quotes', csrfToken, c));
    }
    const isEdit = !!existing;
    const items = isEdit ? getItems(db, existing.id) : [];
    const clientOpts = clients.map(cl => '<option value="' + cl.id + '"' + (isEdit && existing.client_id === cl.id ? ' selected' : '') + '>' + esc(cl.name) + (cl.fiscal_id ? ' — ' + esc(cl.fiscal_id) : '') + '</option>').join('');

    const content = `
      <div class="ph"><h2>${isEdit ? 'Editar borrador' : 'Nuevo presupuesto'}</h2><a href="${isEdit ? '/admin/quotes/' + existing.id : '/admin/quotes'}" class="btn btn-secondary">Volver</a></div>
      <div class="card" style="max-width:960px"><div class="card-body">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Cliente *</label><select id="f-client" class="form-control"><option value="">— Selecciona cliente —</option>${clientOpts}</select></div>
          <div class="form-group"><label class="form-label">Fecha</label><input type="date" id="f-date" class="form-control" value="${isEdit ? esc(existing.date) : today}"></div>
          <div class="form-group"><label class="form-label">Válido hasta</label><input type="date" id="f-valid" class="form-control" value="${isEdit && existing.valid_until ? esc(existing.valid_until) : ''}"></div>
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
        <div style="text-align:right;margin-top:1rem"><button class="btn btn-primary" id="btn-save" onclick="saveQuote()">Guardar borrador</button></div>
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
        try { const t=await api('POST','/api/erp/quotes/compute-totals',{ client_id: parseInt(document.getElementById('f-client').value)||null, lines }); renderTotals(t); } catch(e){}
      }
      function renderTotals(t){
        const lab=(x,col)=>'<td colspan="3" style="text-align:right;padding:.45rem 1rem'+(col?';color:'+col:'')+'">'+x+'</td>';
        const val=(x,col)=>'<td style="text-align:right;padding:.45rem 1rem'+(col?';color:'+col:'')+'">'+x+'</td><td></td>';
        let html='<tr><td colspan="3" style="text-align:right;font-weight:600;padding:.7rem 1rem">Base imponible</td><td style="text-align:right;padding:.7rem 1rem">'+SYM+t.subtotal.toFixed(2)+'</td><td></td></tr>';
        const rates=Object.values(t.taxByRate||{});
        if(!rates.length){ html+='<tr>'+lab('IVA','var(--muted)')+val(SYM+'0.00','var(--muted)')+'</tr>'; }
        else { for(const x of rates){ const l=(Number(x.rate)>0?'IVA '+x.rate+'%':'Exento (0%)')+' (sobre '+SYM+Number(x.base).toFixed(2)+')'; html+='<tr>'+lab(l,'var(--muted)')+val(SYM+Number(x.amount).toFixed(2),'var(--muted)')+'</tr>'; } }
        if(SHOW_IRPF && t.irpfAmount>0){ html+='<tr>'+lab('IRPF '+t.irpfRate+'%','var(--accent-purple)')+val('−'+SYM+t.irpfAmount.toFixed(2),'var(--accent-purple)')+'</tr>'; }
        html+='<tr><td colspan="3" style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">Total</td><td style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">'+SYM+t.total.toFixed(2)+'</td><td></td></tr>';
        document.getElementById('totals-foot').innerHTML=html;
      }
      async function saveQuote(){
        const client_id=parseInt(document.getElementById('f-client').value);
        if(!client_id){ toast('Selecciona un cliente','err'); return; }
        const lines=collectLines(true); if(!lines) return;
        if(!lines.length){ toast('Añade al menos una línea','err'); return; }
        const body={ client_id, date: document.getElementById('f-date').value||undefined, valid_until: document.getElementById('f-valid').value||'', notes: document.getElementById('f-notes').value||'', lines };
        const btn=document.getElementById('btn-save'); btn.disabled=true;
        try {
          if (IS_EDIT){ await api('PUT','/api/erp/quotes/'+EDIT_ID,body); window.location.href='/admin/quotes/'+EDIT_ID; }
          else { const r=await api('POST','/api/erp/quotes',body); window.location.href='/admin/quotes/'+r.id; }
        } catch(e){ toast(e.message||'Error guardando','err'); btn.disabled=false; }
      }
      loadAll();
      </script>`;
    return c.html(adminLayout(isEdit ? 'Editar presupuesto' : 'Nuevo presupuesto', content, 'quotes', csrfToken, c));
  };
  views.get('/new', requirePerm('quotes.create'), c => formView(c, null));
  views.get('/:id/edit', requirePerm('quotes.edit'), c => {
    const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(parseInt(c.req.param('id')));
    if (!q) return c.redirect('/admin/quotes');
    if (q.status !== 'borrador') return c.redirect('/admin/quotes/' + q.id);
    return formView(c, q);
  });

  // Documento imprimible (patrón factura: docShell + window.print) + panel de acciones por estado.
  views.get('/:id', requirePerm('quotes.read'), c => {
    const id = parseInt(c.req.param('id'));
    const q = getQuote(db, id);
    if (!q) return c.html(errorShell('No encontramos este presupuesto', 'Puede que se haya anulado o que el enlace ya no sea válido.', { action: 'Ver presupuestos', href: '/admin/quotes' }), 404);
    const items = getItems(db, id);
    const { emisor, cliente } = docParties(db, q);
    const sym = q.currency_symbol || '€';
    const csrfToken = c.get('session')?.csrfToken || '';
    const liveEmail = db.prepare('SELECT email FROM clients WHERE id=?').get(q.client_id)?.email || q.client_email || '';

    // Enlaces de conversión (bidireccional): factura/ticket creados desde este presupuesto.
    const convs = db.prepare("SELECT * FROM document_links WHERE source_type='quote' AND source_id=?").all(id);
    const convLinks = convs.map(l => {
      if (l.dest_type === 'invoice') { const inv = db.prepare('SELECT id, invoice_number FROM invoices WHERE id=?').get(l.dest_id); return inv ? `factura <a href="/admin/invoices/${inv.id}" style="color:inherit;font-weight:600">${esc(inv.invoice_number)}</a>` : null; }
      if (l.dest_type === 'order') { const ped = db.prepare('SELECT id, order_number FROM customer_orders WHERE id=?').get(l.dest_id); return ped ? `pedido <a href="/admin/pedidos/${ped.id}" style="color:inherit;font-weight:600">${esc(ped.order_number || ('borrador #' + ped.id))}</a>` : null; }
      return null;
    }).filter(Boolean);
    const hasOrderLink = convs.some(l => l.dest_type === 'order');
    const replacedBy = db.prepare('SELECT id, quote_number, status FROM quotes WHERE replaces_quote_id=? ORDER BY id DESC LIMIT 1').get(id) || null;
    const replacesPrev = q.replaces_quote_id ? (db.prepare('SELECT id, quote_number FROM quotes WHERE id=?').get(q.replaces_quote_id) || null) : null;

    let lifecycle = '';
    if (q.status === 'anulado') lifecycle += `<div class="alert alert-err" style="margin-bottom:18px"><strong>Presupuesto anulado.</strong> Motivo: ${esc(q.anulada_motivo || '')}.${replacedBy ? ` La sustituye <a href="/admin/quotes/${replacedBy.id}" style="color:inherit;font-weight:600">${esc(replacedBy.quote_number || ('borrador #' + replacedBy.id))}</a>.` : ''}</div>`;
    if (replacesPrev) lifecycle += `<div class="alert alert-warn" style="margin-bottom:18px">Sustituye a <a href="/admin/quotes/${replacesPrev.id}" style="color:inherit;font-weight:600">${esc(replacesPrev.quote_number || ('borrador #' + replacesPrev.id))}</a> (anulado).</div>`;
    if (convLinks.length) lifecycle += `<div class="alert" style="margin-bottom:18px;background:var(--info-s);color:var(--info);border:1px solid var(--info)">Convertido a: ${convLinks.join(', ')}.</div>`;
    if (q.follow_status) lifecycle += `<div class="alert" style="margin-bottom:18px;background:var(--bg3);color:var(--accent);border:1px solid var(--border2)">Seguimiento: <strong>${esc(q.follow_status)}</strong>.</div>`;

    const paper = `${lifecycle}${quoteDocumentBodyHtml(q, items, emisor, cliente, sym)}`;

    const [lbl, badge] = displayEstado(q);
    const isBorrador = q.status === 'borrador', isEmitido = q.status === 'emitido';
    const panel = `
<div class="card"><div class="card-body">
  <div style="margin-bottom:12px"><span class="badge ${badge}">${esc(lbl)}</span></div>
  <div class="dp-row"><span class="k">Nº</span><span class="v">${q.quote_number ? esc(q.quote_number) : 'Borrador'}</span></div>
  <div class="dp-row"><span class="k">Cliente</span><span class="v">${esc(emisor && q.company_name != null ? (q.client_name || '') : (cliente.name || ''))}</span></div>
  <div class="dp-row"><span class="k">Total</span><span class="v">${sym}${Number(q.total).toFixed(2)}</span></div>
  ${q.valid_until ? `<div class="dp-row"><span class="k">Válido hasta</span><span class="v">${esc(q.valid_until)}</span></div>` : ''}
  <div class="dp-actions" style="margin-top:14px;display:flex;flex-direction:column;gap:.5rem">
    <button onclick="window.print()" class="btn btn-secondary">Imprimir</button>
    <a href="/admin/quotes/${id}/pdf" class="btn btn-secondary">Descargar PDF</a>
    ${isBorrador && can(c, 'quotes.edit') ? `<a href="/admin/quotes/${id}/edit" class="btn btn-secondary">Editar</a><button onclick="emitir()" class="btn btn-primary">Emitir presupuesto</button>` : ''}
    ${isEmitido && can(c, 'quotes.edit') ? `
      <button onclick="emailQuote()" class="btn btn-secondary">Enviar por email</button>
      ${hasOrderLink ? '' : '<button onclick="crearPedido()" class="btn btn-primary">Crear pedido</button>'}
      <button onclick="convertir('invoice')" class="btn btn-primary">Convertir a factura</button>
      <button class="btn btn-secondary" disabled title="Se construye con la pieza de TPV (mostrador)">Convertir a ticket (próximamente)</button>
      <div style="display:flex;gap:.4rem;margin-top:.3rem">
        <button onclick="seguimiento('aceptado')" class="btn btn-secondary btn-sm" style="flex:1">Aceptado</button>
        <button onclick="seguimiento('rechazado')" class="btn btn-secondary btn-sm" style="flex:1">Rechazado</button>
        <button onclick="seguimiento('caducado')" class="btn btn-secondary btn-sm" style="flex:1">Caducado</button>
      </div>
      <button onclick="anular()" class="btn btn-danger">Anular</button>
      <button onclick="anularYRehacer()" class="btn btn-secondary">Anular y rehacer</button>` : ''}
    <a href="/admin/quotes" class="btn btn-secondary">Volver al listado</a>
  </div>
</div></div>
<script>
  const CSRF=${JSON.stringify(csrfToken)}, QID=${id}, LIVE_EMAIL=${JSON.stringify(liveEmail)};
  async function call(path, body){ let r; try{ r=await fetch('/api/erp/quotes/'+QID+path,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':CSRF},body:JSON.stringify(body||{})}); }catch(_e){ throw new Error(window.ERR.NET); } let d; try{ d=await r.json(); }catch(_e){ d=null; } if(!r.ok||!d||d.error) throw new Error(window.cleanErrMsg((d&&d.error)||'')); return d; }
  async function emitir(){ if(!confirm('Vas a EMITIR el presupuesto: ganará número PRE-NNNN y quedará bloqueado (corregir = anular y rehacer). ¿Continuar?')) return; try{ const d=await call('/emitir'); location.reload(); }catch(e){ toast(e.message,'err'); } }
  async function emailQuote(){
    // "Para" pre-rellenado con el email de la ficha (si hay), pero EDITABLE: un único destinatario.
    const to = prompt('Enviar el presupuesto por email.\\nCorreo de destino (puedes cambiarlo):', LIVE_EMAIL || '');
    if (to === null) return;                       // cancelado
    if (!String(to).trim()){ toast('Indica un correo de destino','err'); return; }
    try{ const d=await call('/email', { to: String(to).trim() }); toast(d.message); }catch(e){ toast(e.message,'err'); }
  }
  async function crearPedido(){ if(!confirm('Crear un PEDIDO a partir de este presupuesto? Se creará un pedido en borrador con sus líneas; lo revisas (almacén, entrega) y lo confirmas para reservar el stock.')) return;
    try{ const d=await call('/convert',{dest:'order'}); location.href='/admin/pedidos/'+d.order_id; }
    catch(e){ toast(e.message,'err'); } }
  async function convertir(dest){ if(!confirm('Convertir este presupuesto a factura? Se creará una factura real con sus líneas.')) return;
    try{ const d=await call('/convert',{dest}); location.href='/admin/invoices/'+d.invoice_id; }
    catch(e){ if(/exceso|excede|supera el stock/i.test(e.message) && confirm(e.message+'\\n\\n¿Confirmar el exceso y convertir igualmente?')){ try{ const d=await call('/convert',{dest,confirm_excess:true}); location.href='/admin/invoices/'+d.invoice_id; }catch(e2){ toast(e2.message,'err'); } } else { toast(e.message,'err'); } } }
  async function seguimiento(s){ try{ await call('/follow',{follow_status:s}); location.reload(); }catch(e){ toast(e.message,'err'); } }
  async function anular(){ const m=prompt('Motivo de la anulación:'); if(m===null) return; if(!m.trim()){ toast('El motivo es obligatorio','err'); return; } try{ await call('/anular',{motivo:m.trim()}); location.reload(); }catch(e){ toast(e.message,'err'); } }
  async function anularYRehacer(){ const m=prompt('Motivo de la anulación (se creará un borrador nuevo con las mismas líneas):'); if(m===null) return; if(!m.trim()){ toast('El motivo es obligatorio','err'); return; } try{ const d=await call('/anular-y-rehacer',{motivo:m.trim()}); location.href='/admin/quotes/'+d.id+'/edit'; }catch(e){ toast(e.message,'err'); } }
</script>`;
    return c.html(adminLayout('Presupuesto ' + (q.quote_number || ('#' + id)), docShell(paper, panel), 'quotes', csrfToken, c));
  });

  // PDF real del presupuesto — MISMA guarda que la ficha (quotes.read), MISMO cuerpo imprimible
  // (quoteDocumentBodyHtml) → printableShell → Chromium.
  views.get('/:id/pdf', requirePerm('quotes.read'), async c => {
    try {
      const id = parseInt(c.req.param('id'));
      const q = getQuote(db, id);
      if (!q) return c.html(errorShell('No encontramos este presupuesto', 'Puede que se haya anulado o que el enlace ya no sea válido.', { action: 'Ver presupuestos', href: '/admin/quotes' }), 404);
      const items = getItems(db, id);
      const { emisor, cliente } = docParties(db, q);
      const sym = q.currency_symbol || '€';
      const body = quoteDocumentBodyHtml(q, items, emisor, cliente, sym);
      const pdf = await renderPdfFromHtml(printableShell(body, { title: 'Presupuesto ' + (q.quote_number || ('#' + id)) }));
      const fname = ('Presupuesto-' + (q.quote_number || ('' + id)) + '.pdf').replace(/[\/\\]/g, '-');
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + fname + '"' } });
    } catch (e) { return c.html(errorShell('No hemos podido generar el PDF', ERR.PDF, { action: 'Ver presupuestos', href: '/admin/quotes' }), e.status || 500); }
  });

  return { api, views };
}
