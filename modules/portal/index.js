// ── PORTAL DE CLIENTE · Bloque C — rutas PÚBLICAS (sin /admin, sin auth de panel) ──
// Acceso por enlace mágico /portal/<token>. Solo lectura para el cliente: ver/descargar sus facturas
// y el estado de pago. Un token inválido/caducado/ajeno no expone nada. Aditivo.
import { escHtml } from '../../core/escape.js';
import { renderPdfFromHtml } from '../../core/pdf.js';
import { printableShell } from '../erp/layout.js';
import { buildInvoicePaper } from '../erp/routes/invoices.js';
import { validateToken, clientInvoices, transferData, invoiceBelongsToClient } from './portal.js';

function shell(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escHtml(title)}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#f6f6f8;margin:0}
    .wrap{max-width:760px;margin:0 auto;padding:1.5rem 1rem}
    h1{font-size:1.3rem;margin:.2rem 0}.sub{color:#666;font-size:.85rem;margin-bottom:1rem}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:1rem;margin:.75rem 0}
    table{width:100%;border-collapse:collapse}td,th{padding:.5rem .4rem;border-bottom:1px solid #eee;text-align:left;font-size:.9rem}
    th{color:#666;font-weight:600}.r{text-align:right}.pill{border-radius:20px;padding:.1rem .55rem;font-size:.75rem;font-weight:600}
    .pagada{background:#dcfce7;color:#15803d}.pend{background:#fef3c7;color:#92400e}
    a.btn{display:inline-block;background:#111;color:#fff;text-decoration:none;padding:.35rem .7rem;border-radius:8px;font-size:.8rem}
    .iban{font-family:ui-monospace,monospace;font-size:1rem;letter-spacing:.5px}</style></head>
    <body><div class="wrap">${body}</div></body></html>`;
}

const denied = () => shell('Enlace no válido', `<div class="card"><h1>Enlace no válido o caducado</h1>
  <p class="sub">Este enlace ya no funciona. Pide a tu proveedor uno nuevo.</p></div>`);

export function register(app, db) {
  console.log('🔗 Cargando módulo Portal de cliente...');

  app.get('/portal/:token', (c) => {
    const v = validateToken(db, c.req.param('token'));
    if (!v) return c.html(denied(), 403);
    const client = db.prepare('SELECT name FROM clients WHERE id=?').get(v.client_id) || {};
    const { rows, totalPendiente } = clientInvoices(db, v.client_id);
    const t = transferData(db);
    const token = c.req.param('token');
    const filas = rows.map(r => `<tr>
      <td>${escHtml(r.invoice_number)}</td><td>${escHtml(r.issue_date)}</td>
      <td class="r">${escHtml(r.currency_symbol)}${Number(r.total).toFixed(2)}</td>
      <td>${r.pagada ? '<span class="pill pagada">Pagada</span>' : `<span class="pill pend">Pendiente${r.pendiente < r.total ? ' · ' + r.currency_symbol + r.pendiente.toFixed(2) : ''}</span>`}</td>
      <td class="r"><a class="btn" href="/portal/${escHtml(token)}/factura/${r.id}/pdf">PDF</a></td></tr>`).join('')
      || '<tr><td colspan="5" style="text-align:center;color:#888">No hay facturas.</td></tr>';
    const pago = t.iban ? `<div class="card"><h3 style="margin:.2rem 0">¿Cómo pagar?</h3>
      <p class="sub">Haz una transferencia a esta cuenta indicando el nº de factura en el concepto. El estado se actualizará cuando tu proveedor concilie el pago.</p>
      <div class="iban">${escHtml(t.iban)}</div>${t.holder ? `<div style="color:#555;font-size:.85rem;margin-top:.2rem">Titular: ${escHtml(t.holder)}</div>` : ''}</div>`
      : `<div class="card"><p class="sub">Para el pago por transferencia, contacta con tu proveedor para obtener el número de cuenta.</p></div>`;
    const body = `<h1>Tus facturas</h1><div class="sub">${escHtml(t.company_name)} · ${escHtml(client.name || '')}${totalPendiente > 0 ? ` · Pendiente total: ${escHtml(rows[0]?.currency_symbol || '€')}${totalPendiente.toFixed(2)}` : ' · Todo al día'}</div>
      <div class="card"><table><thead><tr><th>Factura</th><th>Fecha</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
      ${pago}`;
    return c.html(shell('Tus facturas', body));
  });

  app.get('/portal/:token/factura/:id/pdf', async (c) => {
    const v = validateToken(db, c.req.param('token'));
    if (!v) return c.text('Enlace no válido', 403);
    const invId = Number(c.req.param('id'));
    if (!invoiceBelongsToClient(db, invId, v.client_id)) return c.text('No encontrada', 404);   // nunca una factura ajena
    try {
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
      const paper = await buildInvoicePaper(db, inv);
      const pdf = await renderPdfFromHtml(printableShell(paper, { title: 'Factura ' + inv.invoice_number }));
      const fname = ('Factura-' + (inv.invoice_number || invId) + '.pdf').replace(/[\/\\]/g, '-');
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + fname + '"' } });
    } catch (e) { return c.text('No se pudo generar el PDF', 500); }
  });

  console.log('✅ Portal: portal de cliente en /portal/<token>');
}
