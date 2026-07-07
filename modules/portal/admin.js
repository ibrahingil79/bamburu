// ── PORTAL DE CLIENTE · Bloque C — vista de ADMIN: configurar IBAN + enviar enlaces a clientes ──
// Bajo /admin (con requirePerm + sesión). Gateado por invoices.read. Aditivo.
import { Hono } from 'hono';
import { requirePerm } from '../../core/auth.js';
import { adminLayout, emptyRow, cleanErrMsg } from '../erp/layout.js';
import { escHtml } from '../../core/escape.js';
import { sendEmail } from '../../core/mailer.js';
import { getPortalSetting, setPortalSetting, sendPortalLink } from './portal.js';

export function createPortalAdminRoutes(db) {
  const views = new Hono();

  views.get('/', requirePerm('invoices.read'), c => {
    const csrf = c.get('session')?.csrfToken || '';
    const iban = getPortalSetting(db, 'portal_iban'), holder = getPortalSetting(db, 'portal_iban_holder');
    const clientes = db.prepare(`SELECT c.id, c.name, c.email,
        (SELECT COUNT(*) FROM portal_tokens t WHERE t.client_id=c.id AND t.revoked=0 AND t.expires_at > strftime('%s','now')) enlaces
        FROM clients c ORDER BY c.name`).all();
    const flash = c.req.query('sent') ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--ok);background:var(--ok-s);font-size:12px;color:var(--ok)">Enlace enviado a ${escHtml(c.req.query('sent'))}.</div>` : '';
    const err = c.req.query('err') ? `<div style="margin:.5rem 0;padding:.5rem .75rem;border-left:3px solid var(--danger);background:var(--danger-s);font-size:12px;color:var(--danger)">${escHtml(cleanErrMsg(c.req.query('err')))}</div>` : '';
    const filas = clientes.map(cl => `<tr>
      <td>${escHtml(cl.name)}</td><td>${escHtml(cl.email || '')}</td>
      <td>${cl.enlaces ? `<span style="color:var(--ok)">${cl.enlaces} activo(s)</span>` : '<span style="color:var(--text2)">—</span>'}</td>
      <td>${cl.email
        ? `<form method="post" action="/admin/portal/enviar/${cl.id}" style="display:inline"><input type="hidden" name="_csrf" value="${escHtml(csrf)}"><button class="btn" type="submit">Enviar enlace</button></form>`
        : '<span style="color:var(--warn);font-size:12px">Sin email</span>'}</td></tr>`).join('')
      || emptyRow(4, 'Todavía no tienes clientes a los que dar acceso al portal. Empieza por crear uno.', { cta: 'Nuevo cliente', href: '/admin/clients' });
    const content = `<div class="ph"><h2>Portal de cliente</h2></div>
      <div style="color:var(--text2);font-size:12px;margin-bottom:.5rem">Envía a cada cliente un enlace privado (caduca en 14 días) para que vea y descargue sus facturas y su estado de pago. El pago con tarjeta queda fuera por ahora: se muestran los datos de transferencia.</div>
      ${flash}${err}
      <div class="card"><div class="card-body"><h3>Datos de transferencia (los ve el cliente)</h3>
        <form method="post" action="/admin/portal/iban" style="display:flex;gap:.5rem;align-items:end;flex-wrap:wrap;margin-top:.5rem">
          <input type="hidden" name="_csrf" value="${escHtml(csrf)}">
          <div><label class="doc-label">IBAN</label><br><input name="iban" value="${escHtml(iban)}" style="width:22rem" placeholder="ESXX XXXX ..."></div>
          <div><label class="doc-label">Titular</label><br><input name="holder" value="${escHtml(holder)}" placeholder="Nombre del titular"></div>
          <button class="btn" type="submit">Guardar</button>
        </form></div></div>
      <div class="card" style="margin-top:1rem"><table><thead><tr><th>Cliente</th><th>Email</th><th>Enlaces</th><th>Acción</th></tr></thead><tbody>${filas}</tbody></table></div>`;
    return c.html(adminLayout('Portal de cliente', content, 'portal', csrf, c));
  });

  views.post('/iban', requirePerm('invoices.read'), async c => {
    const b = await c.req.parseBody();
    setPortalSetting(db, 'portal_iban', (b.iban || '').toString().trim());
    setPortalSetting(db, 'portal_iban_holder', (b.holder || '').toString().trim());
    return c.redirect('/admin/portal');
  });

  views.post('/enviar/:id', requirePerm('invoices.read'), async c => {
    await c.req.parseBody();
    const tenant = c.get('tenant');
    const base = process.env.PUBLIC_BASE_DOMAIN && tenant?.slug ? `https://${tenant.slug}.${process.env.PUBLIC_BASE_DOMAIN}` : '';
    try {
      const r = await sendPortalLink(db, +c.req.param('id'), base, sendEmail);
      return c.redirect('/admin/portal?sent=' + encodeURIComponent(r.email));
    } catch (e) {
      return c.redirect('/admin/portal?err=' + encodeURIComponent(e.message || 'No se pudo enviar'));
    }
  });

  return { views };
}
