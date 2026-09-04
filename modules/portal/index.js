// ── PORTAL DE CLIENTE · Bloque C — rutas PÚBLICAS (sin /admin, sin auth de panel) ──
// Solo lectura para el cliente: ver/descargar sus facturas y el estado de pago. Un acceso
// inválido/caducado/ajeno no expone nada. Aditivo.
//
// ⚙️ AUD-009 (4 sep 2026) — LA LLAVE YA NO VIAJA EN LA DIRECCIÓN. El enlace del correo sigue
// teniendo la misma forma (`/portal/<token>`) y se abre igual de fácil, pero al pulsarlo **se
// canjea una sola vez** por una sesión en cookie y se redirige a `/portal`, sin llave a la vista.
// Desde ahí, todas las páginas del portal se sostienen en la cookie:
//   · la barra de direcciones no lleva llave, así que el `referer` tampoco la filtra;
//   · el enlace del correo queda gastado — una copia del historial del navegador o del registro de
//     un intermediario llega tarde y no abre nada;
//   · la sesión caduca CUANDO CADUCABA EL ENLACE, no más tarde.
import { escHtml } from '../../core/escape.js';
import { renderPdfFromHtml } from '../../core/pdf.js';
import { printableShell, ROOT_TOKENS } from '../erp/layout.js';
import { buildInvoicePaper } from '../erp/routes/invoices.js';
import { canjearToken, crearSesion, validarSesion, clientInvoices, transferData, invoiceBelongsToClient,
         analiticaCliente, mensajesDe, escribirMensaje, marcarVisto } from './portal.js';
import { fechaEs, fechaHoraEs } from '../erp/voz.js';   // la fecha, en cristiano (24/08/2026 14:30)
import { fmtEur } from '../erp/margen.js';   // el dinero, como en España: 6.023,00 €

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
  <p class="sub">Este enlace ya no funciona: los enlaces del portal se abren <b>una sola vez</b> y
  caducan. Si necesitas volver a entrar, pide a tu proveedor que te mande uno nuevo — es un clic
  para él.</p></div>`);

// El dinero, como en el resto del producto: `6.023,00 €` — miles con punto, decimales con coma, y
// el símbolo DETRÁS y separado. NO nace aquí un formateador: se usa el único que hay
// (`fmtEur`, modules/erp/margen.js:161), igual que `money` en contabilidad-routes.js:33 y `dinero`
// en avisos.js:432. Antes esto se escribía a mano SIETE veces y salía `€6023.00`.
// Se escapa el resultado porque el símbolo sale de la BD (`invoices.currency_symbol`): `fmtEur`
// compone TEXTO, no HTML, y escaparlo aquí quita la asimetría que había entre las líneas 54 y 55.
const dinero = (n, sym) => escHtml(fmtEur(Number(n || 0), sym || '€'));

export function register(app, db) {
  console.log('🔗 Cargando módulo Portal de cliente...');

  // ── LA PUERTA: se entra por el enlace del correo, y solo se cruza UNA vez ────────────────────
  // Aquí no se pinta nada. Se canjea el enlace por una sesión, se deja la llave en una cookie
  // `HttpOnly` (ningún JavaScript la lee) limitada a `/portal`, y se manda al cliente a una
  // dirección SIN llave. El 302 es lo que saca el token de la barra de direcciones — y con él,
  // del `referer` de cualquier enlace que el cliente pulse después.
  app.get('/portal/:token', (c) => {
    const v = canjearToken(db, c.req.param('token'));
    if (!v) return c.html(denied(), 403);
    const sesion = crearSesion(db, v.client_id, v.expires_at);
    const maxAge = Math.max(60, v.expires_at - Math.floor(Date.now() / 1000));
    return new Response(null, {
      status: 302,
      headers: {
        location: '/portal',
        'set-cookie': `psesion=${sesion}; Path=/portal; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
      },
    });
  });

  /** La llave, desde la cookie. Es la única forma de identificarse dentro del portal. */
  const deLaCookie = (c) => {
    const m = /(?:^|;\s*)psesion=([A-Za-z0-9_-]+)/.exec(c.req.header('cookie') || '');
    return m ? validarSesion(db, m[1]) : null;
  };

  app.get('/portal', (c) => {
    const v = deLaCookie(c);
    if (!v) return c.html(denied(), 403);
    const client = db.prepare('SELECT name FROM clients WHERE id=?').get(v.client_id) || {};
    const { rows, totalPendiente } = clientInvoices(db, v.client_id);
    const t = transferData(db);
    const filas = rows.map(r => `<tr>
      <td>${escHtml(r.invoice_number)}</td><td>${fechaEs(r.issue_date)}</td>
      <td class="r">${dinero(r.total, r.currency_symbol)}</td>
      <td>${r.pagada ? '<span class="pill pagada">Pagada</span>' : `<span class="pill pend">Pendiente${r.pendiente < r.total ? ' · ' + dinero(r.pendiente, r.currency_symbol) : ''}</span>`}</td>
      <td class="r"><a class="btn" href="/portal/factura/${r.id}/pdf">PDF</a></td></tr>`).join('')
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
    // OJO CON `A.ultima`: es la TERCERA fecha inglesa de este módulo, y va con `fechaEs` como las
    // otras dos. `analiticaCliente` la devuelve tal cual se guarda (2026-03-12) y hasta hoy se
    // pintaba así, dentro del paréntesis de «desde la última». Con ella cruda, el portal seguiría
    // enseñando una fecha ISO por mucho que se arreglara la del chat.
    const analitica = !A.hay ? '' : `<div class="card"><h3 style="margin:.2rem 0">Tu histórico con ${escHtml(t.company_name)}</h3>
      <p class="sub">Lo que llevas comprado, calculado sobre las mismas facturas de arriba.</p>
      <div class="g">
        <div class="kp"><b>${A.compras}</b><span>${A.compras === 1 ? 'compra' : 'compras'}</span></div>
        <div class="kp"><b>${dinero(A.total, A.sym)}</b><span>en total (sin IVA)</span></div>
        <div class="kp"><b>${dinero(A.media, A.sym)}</b><span>de media por compra</span></div>
        <div class="kp"><b>${A.cadaDias == null ? '—' : 'cada ' + dias(A.cadaDias)}</b><span>es tu ritmo habitual</span></div>
        <div class="kp"><b>${dias(A.desdeUltima)}</b><span>desde la última${A.ultima ? ' (' + escHtml(fechaEs(A.ultima)) + ')' : ''}</span></div>
      </div>
      ${A.lineas.length ? `<h3 style="margin:1rem 0 .3rem;font-size:.95rem">Lo que más compras</h3>
        ${A.lineas.map(l => `<div style="margin:.35rem 0">
          <div style="display:flex;justify-content:space-between;font-size:.85rem"><span>${escHtml(l.d || '—')}</span>
          <span>${dinero(l.importe, A.sym)}</span></div>
          <div class="bar"><i style="width:${maxL ? Math.max(3, Math.round(Number(l.importe) / maxL * 100)) : 0}%"></i></div></div>`).join('')}` : ''}
      ${A.porAnio.length > 1 ? `<h3 style="margin:1rem 0 .3rem;font-size:.95rem">Por año</h3><table><tbody>${
        A.porAnio.map(x => `<tr><td>${escHtml(x.anio)}</td><td class="r">${dinero(x.importe, A.sym)}</td></tr>`).join('')}</tbody></table>` : ''}
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
        <span class="q">${m.autor === 'cliente' ? 'Tú' : escHtml(t.company_name)} · ${escHtml(fechaHoraEs(m.created_at))}</span>
        ${escHtml(m.texto)}</div>`).join('')
        : '<p class="sub">Todavía no habéis hablado por aquí.</p>'}
      <form method="post" action="/portal/mensaje" style="margin-top:.6rem">
        <textarea name="texto" rows="3" maxlength="2000" placeholder="Escribe tu mensaje…" required></textarea>
        <div style="margin-top:.4rem"><button class="btn" type="submit">Enviar</button></div>
      </form></div>`;

    // AUD-009 · «La llave caduca, y se dice cuándo». El correo ya lo dice al mandar el enlace;
    // aquí se repite con la FECHA concreta, que es lo que el cliente puede mirar mientras usa el
    // portal. Sale de la sesión, así que es la caducidad de verdad, no una promesa del correo.
    const caduca = `<p class="sub" style="margin-top:1.2rem">Este acceso caduca el
      <b>${escHtml(fechaEs(new Date(v.expires_at * 1000).toISOString().slice(0, 10)))}</b>.
      Después tendrás que pedirle a ${escHtml(t.company_name)} un enlace nuevo.</p>`;

    const body = `<h1>Tus facturas</h1><div class="sub">${escHtml(t.company_name)} · ${escHtml(client.name || '')}${totalPendiente > 0 ? ` · Pendiente total: ${dinero(totalPendiente, rows[0]?.currency_symbol)}` : ' · Todo al día'}</div>
      <div class="card"><table><thead><tr><th>Factura</th><th>Fecha</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
      ${pago}
      ${analitica}
      ${chat}
      ${caduca}`;
    return c.html(shell('Tus facturas', body));
  });

  // FICHA G2 — el cliente escribe. Va por formulario normal (el portal no lleva JavaScript y no se
  // le va a meter uno solo para esto): se guarda y se vuelve a su página con el aviso. Desde
  // AUD-009 la llave es la COOKIE, no la dirección: la vuelta es a `/portal`, sin nada que filtrar.
  app.post('/portal/mensaje', async (c) => {
    const v = deLaCookie(c);
    if (!v) return c.html(denied(), 403);
    try {
      const form = await c.req.parseBody();
      escribirMensaje(db, v.client_id, 'cliente', form.texto);
      return c.redirect('/portal?enviado=1#hablar');
    } catch (e) {
      return c.redirect('/portal?err=' + encodeURIComponent(e.message || 'No se pudo enviar'));
    }
  });

  app.get('/portal/factura/:id/pdf', async (c) => {
    const v = deLaCookie(c);
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

  console.log('✅ Portal: portal de cliente en /portal (se entra con el enlace de un solo uso)');
}
