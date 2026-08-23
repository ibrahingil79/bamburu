// ── PORTAL DE CLIENTE · Bloque C — rutas PÚBLICAS (sin /admin, sin auth de panel) ──
// Acceso por enlace mágico /portal/<token>. Solo lectura para el cliente: ver/descargar sus facturas
// y el estado de pago. Un token inválido/caducado/ajeno no expone nada. Aditivo.
import { escHtml } from '../../core/escape.js';
import { renderPdfFromHtml } from '../../core/pdf.js';
import { printableShell, ROOT_TOKENS } from '../erp/layout.js';
import { buildInvoicePaper } from '../erp/routes/invoices.js';
import { validateToken, clientInvoices, transferData, invoiceBelongsToClient,
         analiticaCliente, mensajesDe, escribirMensaje, marcarVisto } from './portal.js';

function shell(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escHtml(title)}</title><style>${ROOT_TOKENS}
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text);background:var(--bg);margin:0}
    .wrap{max-width:760px;margin:0 auto;padding:1.5rem 1rem}
    h1{font-size:1.3rem;margin:.2rem 0}.sub{color:var(--text2);font-size:.85rem;margin-bottom:1rem}
    .card{background:var(--bg2);border:1px solid var(--border2);border-radius:12px;padding:1rem;margin:.75rem 0}
    table{width:100%;border-collapse:collapse}td,th{padding:.5rem .4rem;border-bottom:1px solid var(--border);text-align:left;font-size:.9rem}
    th{color:var(--text2);font-weight:600}.r{text-align:right}.pill{border-radius:20px;padding:.1rem .55rem;font-size:.75rem;font-weight:600}
    .pagada{background:var(--ok-s);color:var(--ok)}.pend{background:var(--warn-s);color:var(--warn)}
    a.btn{display:inline-block;background:var(--text);color:var(--bg2);text-decoration:none;padding:.35rem .7rem;border-radius:8px;font-size:.8rem}
    .iban{font-family:ui-monospace,monospace;font-size:1rem;letter-spacing:.5px}
    .g{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.7rem}
    .kp{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:.6rem .7rem}
    .kp b{display:block;font-size:1.15rem}.kp span{font-size:.72rem;color:var(--text2)}
    .bar{height:8px;background:var(--border);border-radius:6px;overflow:hidden;margin-top:.25rem}
    .bar i{display:block;height:100%;background:var(--accent)}
    .msg{border:1px solid var(--border);border-radius:10px;padding:.5rem .65rem;margin:.4rem 0;font-size:.86rem}
    .msg.yo{background:var(--accent-soft);margin-left:2rem}
    .msg .q{display:block;font-size:.7rem;color:var(--text2);margin-bottom:.15rem}
    textarea{width:100%;box-sizing:border-box;font:inherit;font-size:.9rem;padding:.5rem;border:1px solid var(--border2);border-radius:8px;background:var(--bg2);color:var(--text)}
    button.btn{background:var(--text);color:var(--bg2);border:0;padding:.4rem .8rem;border-radius:8px;font-size:.85rem;cursor:pointer}
    .aviso{border-left:3px solid var(--danger);background:var(--danger-s);color:var(--danger);padding:.45rem .6rem;border-radius:6px;font-size:.82rem;margin:.4rem 0}
    .okmsg{border-left:3px solid var(--ok);background:var(--ok-s);color:var(--ok);padding:.45rem .6rem;border-radius:6px;font-size:.82rem;margin:.4rem 0}</style></head>
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
      || '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:2rem">No tienes facturas pendientes. Estás al día.</td></tr>';
    const pago = t.iban ? `<div class="card"><h3 style="margin:.2rem 0">¿Cómo pagar?</h3>
      <p class="sub">Haz una transferencia a esta cuenta indicando el nº de factura en el concepto. El estado se actualizará cuando tu proveedor concilie el pago.</p>
      <div class="iban">${escHtml(t.iban)}</div>${t.holder ? `<div style="color:var(--text2);font-size:.85rem;margin-top:.2rem">Titular: ${escHtml(t.holder)}</div>` : ''}</div>`
      : `<div class="card"><p class="sub">Para el pago por transferencia, contacta con tu proveedor para obtener el número de cuenta.</p></div>`;
    // ── FICHA G1 · SUS PROPIAS ANALÍTICAS ────────────────────────────────────────────────────
    // Solo sus datos, y con el MISMO criterio de «qué cuenta» que usa el negocio, para que no pueda
    // ver aquí un total distinto del de su lista de facturas dos centímetros más arriba.
    const A = analiticaCliente(db, v.client_id);
    const dias = n2 => n2 == null ? '—' : (n2 === 0 ? 'hoy mismo' : n2 + (n2 === 1 ? ' día' : ' días'));
    const maxL = A.hay && A.lineas.length ? Math.max(...A.lineas.map(l => Number(l.importe) || 0)) : 0;
    const analitica = !A.hay ? '' : `<div class="card"><h3 style="margin:.2rem 0">Tu histórico con ${escHtml(t.company_name)}</h3>
      <p class="sub">Lo que llevas comprado, calculado sobre las mismas facturas de arriba.</p>
      <div class="g">
        <div class="kp"><b>${A.compras}</b><span>${A.compras === 1 ? 'compra' : 'compras'}</span></div>
        <div class="kp"><b>${escHtml(A.sym)}${A.total.toFixed(2)}</b><span>en total (sin IVA)</span></div>
        <div class="kp"><b>${escHtml(A.sym)}${A.media.toFixed(2)}</b><span>de media por compra</span></div>
        <div class="kp"><b>${A.cadaDias == null ? '—' : 'cada ' + dias(A.cadaDias)}</b><span>es tu ritmo habitual</span></div>
        <div class="kp"><b>${dias(A.desdeUltima)}</b><span>desde la última${A.ultima ? ' (' + escHtml(A.ultima) + ')' : ''}</span></div>
      </div>
      ${A.lineas.length ? `<h3 style="margin:1rem 0 .3rem;font-size:.95rem">Lo que más compras</h3>
        ${A.lineas.map(l => `<div style="margin:.35rem 0">
          <div style="display:flex;justify-content:space-between;font-size:.85rem"><span>${escHtml(l.d || '—')}</span>
          <span>${escHtml(A.sym)}${Number(l.importe).toFixed(2)}</span></div>
          <div class="bar"><i style="width:${maxL ? Math.max(3, Math.round(Number(l.importe) / maxL * 100)) : 0}%"></i></div></div>`).join('')}` : ''}
      ${A.porAnio.length > 1 ? `<h3 style="margin:1rem 0 .3rem;font-size:.95rem">Por año</h3><table><tbody>${
        A.porAnio.map(x => `<tr><td>${escHtml(x.anio)}</td><td class="r">${escHtml(A.sym)}${x.importe.toFixed(2)}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>`;

    // ── FICHA G2 · EL CANAL DE COMUNICACIONES ────────────────────────────────────────────────
    // Al abrir el portal, lo que le escribió el negocio queda visto. Los suyos siguen sin ver para
    // el negocio hasta que este abra su bandeja: son dos contadores distintos y no se pisan.
    marcarVisto(db, v.client_id, 'cliente');
    const hilo = mensajesDe(db, v.client_id);
    const enviado = c.req.query('enviado') === '1';
    const errMsg = c.req.query('err') || '';
    const chat = `<div class="card"><h3 style="margin:.2rem 0">Hablar con ${escHtml(t.company_name)}</h3>
      <p class="sub">Escribe aquí lo que necesites y te contestarán desde aquí mismo. Queda por escrito para los dos.</p>
      ${enviado ? '<div class="okmsg">Mensaje enviado. Te contestarán por aquí.</div>' : ''}
      ${errMsg ? `<div class="aviso">${escHtml(errMsg)}</div>` : ''}
      ${hilo.length ? hilo.map(m => `<div class="msg${m.autor === 'cliente' ? ' yo' : ''}">
        <span class="q">${m.autor === 'cliente' ? 'Tú' : escHtml(t.company_name)} · ${escHtml(String(m.created_at || '').slice(0, 16))}</span>
        ${escHtml(m.texto)}</div>`).join('')
        : '<p class="sub">Todavía no habéis hablado por aquí.</p>'}
      <form method="post" action="/portal/${escHtml(token)}/mensaje" style="margin-top:.6rem">
        <textarea name="texto" rows="3" maxlength="2000" placeholder="Escribe tu mensaje…" required></textarea>
        <div style="margin-top:.4rem"><button class="btn" type="submit">Enviar</button></div>
      </form></div>`;

    const body = `<h1>Tus facturas</h1><div class="sub">${escHtml(t.company_name)} · ${escHtml(client.name || '')}${totalPendiente > 0 ? ` · Pendiente total: ${escHtml(rows[0]?.currency_symbol || '€')}${totalPendiente.toFixed(2)}` : ' · Todo al día'}</div>
      <div class="card"><table><thead><tr><th>Factura</th><th>Fecha</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
      ${pago}
      ${analitica}
      ${chat}`;
    return c.html(shell('Tus facturas', body));
  });

  // FICHA G2 — el cliente escribe. Va por formulario normal (el portal no lleva JavaScript y no se
  // le va a meter uno solo para esto): se guarda y se vuelve a su página con el aviso. El token ES
  // la llave, igual que en el resto del portal; sin él no se llega aquí.
  app.post('/portal/:token/mensaje', async (c) => {
    const token = c.req.param('token');
    const v = validateToken(db, token);
    if (!v) return c.html(denied(), 403);
    try {
      const form = await c.req.parseBody();
      escribirMensaje(db, v.client_id, 'cliente', form.texto);
      return c.redirect('/portal/' + token + '?enviado=1#hablar');
    } catch (e) {
      return c.redirect('/portal/' + token + '?err=' + encodeURIComponent(e.message || 'No se pudo enviar'));
    }
  });

  app.get('/portal/:token/factura/:id/pdf', async (c) => {
    const v = validateToken(db, c.req.param('token'));
    if (!v) return c.html(denied(), 403);
    const invId = Number(c.req.param('id'));
    if (!invoiceBelongsToClient(db, invId, v.client_id)) return c.html(shell('Factura no encontrada', `<div class="card"><h1>No encontramos esta factura</h1>
  <p class="sub">Puede que el enlace ya no sea válido. Pide a tu proveedor uno nuevo.</p></div>`), 404);   // nunca una factura ajena
    try {
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
      const paper = await buildInvoicePaper(db, inv);
      const pdf = await renderPdfFromHtml(printableShell(paper, { title: 'Factura ' + inv.invoice_number }));
      const fname = ('Factura-' + (inv.invoice_number || invId) + '.pdf').replace(/[\/\\]/g, '-');
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + fname + '"' } });
    } catch (e) { return c.html(shell('No se pudo generar el PDF', `<div class="card"><h1>No hemos podido preparar el PDF</h1>
  <p class="sub">Vuelve a intentarlo en un momento.</p></div>`), 500); }
  });

  console.log('✅ Portal: portal de cliente en /portal/<token>');
}
