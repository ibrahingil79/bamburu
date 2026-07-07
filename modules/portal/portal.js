// ── PORTAL DE CLIENTE · Bloque C — motor: enlaces mágicos + facturas del cliente + estado de pago ──
//
// Acceso por token temporal (sin contraseña), que solo abre las facturas de SU client_id. Solo
// lectura: no toca documentos ni ledger. El estado "pagada/pendiente" se DERIVA de cobros/conciliación
// (invoiceCobro), NUNCA de lo que diga el cliente. Pago online (tarjeta) fuera de alcance: se muestran
// los datos de transferencia. Aditivo.

import { randomBytes } from 'crypto';
import { countsAsReceivable, invoiceCobro } from '../erp/cobros.js';

const DAY = 86400;

// Config del portal en la tabla settings (key-value): IBAN y titular para los datos de transferencia.
export function getPortalSetting(db, key) {
  try { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? ''; } catch { return ''; }
}
export function setPortalSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(key, String(value ?? ''));
}
export function transferData(db) {
  const cfg = db.prepare('SELECT company_name FROM company_config WHERE id=1').get() || {};
  return { company_name: cfg.company_name || '', iban: getPortalSetting(db, 'portal_iban'), holder: getPortalSetting(db, 'portal_iban_holder') };
}

// Crea un token temporal para un cliente. ttlDays por defecto 14. Devuelve el token (string).
export function createToken(db, clientId, ttlDays = 14, nowSec = Math.floor(Date.now() / 1000)) {
  const client = db.prepare('SELECT id FROM clients WHERE id=?').get(clientId);
  if (!client) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO portal_tokens (client_id, token, expires_at) VALUES (?,?,?)').run(clientId, token, nowSec + ttlDays * DAY);
  return token;
}

// Valida un token: devuelve { client_id } si vigente (no caducado, no revocado), o null. No filtra
// nada del sistema: un token inválido/ajeno/caducado simplemente no resuelve.
export function validateToken(db, token, nowSec = Math.floor(Date.now() / 1000)) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM portal_tokens WHERE token=?').get(token);
  if (!row || row.revoked || row.expires_at < nowSec) return null;
  try { db.prepare('UPDATE portal_tokens SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(row.id); } catch { /* no crítico */ }
  return { client_id: row.client_id };
}

export function revokeTokensDeCliente(db, clientId) {
  db.prepare('UPDATE portal_tokens SET revoked=1 WHERE client_id=? AND revoked=0').run(clientId);
}

// Facturas del cliente con su estado de pago DERIVADO. Excluye las que no cuentan (anuladas, etc.).
export function clientInvoices(db, clientId, today = new Date().toISOString().slice(0, 10)) {
  const invs = db.prepare('SELECT * FROM invoices WHERE client_id=? ORDER BY issue_date DESC, id DESC').all(clientId);
  const out = [];
  let totalPendiente = 0;
  for (const inv of invs) {
    if (!countsAsReceivable(db, inv)) continue;
    const st = invoiceCobro(db, inv, today);
    if (st.pendiente > 0.0049) totalPendiente += st.pendiente;
    out.push({
      id: inv.id, invoice_number: inv.invoice_number, issue_date: inv.issue_date, due_date: inv.due_date,
      total: inv.total, currency_symbol: inv.currency_symbol || '€',
      pagada: st.pendiente <= 0.0049, pendiente: Math.round(st.pendiente * 100) / 100, estado: st.estado,
    });
  }
  return { rows: out, totalPendiente: Math.round(totalPendiente * 100) / 100 };
}

// ¿La factura pertenece a este cliente? (guarda de acceso al PDF: nunca servir una factura ajena).
export function invoiceBelongsToClient(db, invoiceId, clientId) {
  const inv = db.prepare('SELECT client_id FROM invoices WHERE id=?').get(invoiceId);
  return !!inv && inv.client_id === clientId;
}

// Envía el enlace del portal por email (Resend). `baseUrl` = https://<slug>.<dominio>. sendEmailImpl
// se inyecta (los tests pasan un mock; producción usa core/mailer). Devuelve { sent, email } o lanza.
export async function sendPortalLink(db, clientId, baseUrl, sendEmailImpl, { ttlDays = 14 } = {}) {
  const client = db.prepare('SELECT id, name, email FROM clients WHERE id=?').get(clientId);
  if (!client) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  if (!client.email) { const e = new Error('El cliente no tiene email configurado'); e.status = 400; throw e; }
  const cfg = db.prepare('SELECT company_name, email FROM company_config WHERE id=1').get() || {};
  const token = createToken(db, clientId, ttlDays);
  const url = `${baseUrl}/portal/${token}`;
  const empresa = cfg.company_name || 'tu proveedor';
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;color:#111;max-width:520px">
    <p>Hola ${escapeHtml(client.name || '')},</p>
    <p>${escapeHtml(empresa)} pone a tu disposición un portal privado donde puedes <b>ver y descargar tus facturas</b> y consultar su estado de pago.</p>
    <p><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ver mis facturas</a></p>
    <p style="color:#555;font-size:12px">El enlace es personal y caduca en ${ttlDays} días. Si no lo has solicitado, ignora este correo.</p>
  </div>`;
  const res = await sendEmailImpl({
    from: `${empresa} <noreply@bamburu.com>`, to: client.email, replyTo: cfg.email || undefined,
    subject: `Tus facturas — ${empresa}`, html,
  });
  if (res && res.error) { const e = new Error('No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde.'); e.status = 502; throw e; }   // U3: sin volcar el objeto de Resend
  return { sent: true, email: client.email };
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
