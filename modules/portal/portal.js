// ── PORTAL DE CLIENTE · Bloque C — motor: enlaces mágicos + facturas del cliente + estado de pago ──
//
// Acceso por token temporal (sin contraseña), que solo abre las facturas de SU client_id. Solo
// lectura: no toca documentos ni ledger. El estado "pagada/pendiente" se DERIVA de cobros/conciliación
// (invoiceCobro), NUNCA de lo que diga el cliente. Pago online (tarjeta) fuera de alcance: se muestran
// los datos de transferencia. Aditivo.

import { renderEmail, TONO_UNICO } from '../erp/email-templates.js';
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FICHA G1 — LAS ANALÍTICAS DEL PROPIO CLIENTE: qué compra, cuánto y cada cuánto
// ════════════════════════════════════════════════════════════════════════════════════════════════
// SOLO SUS DATOS, y calculadas con los MISMOS criterios que las del negocio: cuenta lo que cuenta
// como venta (`countsAsReceivable`), así que una factura anulada no le infla su historial ni le
// contradice lo que ve en su lista de facturas dos centímetros más arriba.
//
// «Cada cuánto» se calcula con la MEDIANA de los días entre compras, no con la media: una compra
// grande y rara dispara el promedio y le diría a un cliente mensual que compra cada tres meses. Es
// el mismo criterio que usa `umbralDormido` para el ritmo de un cliente en el vigía.
export function analiticaCliente(db, clientId, hoy = new Date().toISOString().slice(0, 10)) {
  const invs = db.prepare('SELECT * FROM invoices WHERE client_id=? ORDER BY issue_date, id').all(clientId)
    .filter(i => countsAsReceivable(db, i));
  const sym = invs[0]?.currency_symbol || '€';
  if (!invs.length) return { hay: false, sym };

  const total = invs.reduce((n, i) => n + (Number(i.subtotal) || 0), 0);
  const fechas = invs.map(i => String(i.issue_date).slice(0, 10)).filter(Boolean);
  const dias = [];
  for (let k = 1; k < fechas.length; k++) {
    const d = Math.round((Date.parse(fechas[k] + 'T00:00:00Z') - Date.parse(fechas[k - 1] + 'T00:00:00Z')) / 86400000);
    if (Number.isFinite(d) && d >= 0) dias.push(d);
  }
  const mediana = xs => { if (!xs.length) return null; const s2 = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s2.length / 2); return s2.length % 2 ? s2[m] : Math.round((s2[m - 1] + s2[m]) / 2); };
  const ultima = fechas[fechas.length - 1] || null;
  const desdeUltima = ultima ? Math.round((Date.parse(hoy + 'T00:00:00Z') - Date.parse(ultima + 'T00:00:00Z')) / 86400000) : null;

  // QUÉ COMPRA: sus líneas, agrupadas por descripción (invoice_items no guarda product_id siempre).
  const ph = invs.map(() => '?').join(',');
  const lineas = db.prepare(
    `SELECT description d, SUM(quantity) uds, ROUND(SUM(total_price),2) importe
       FROM invoice_items WHERE invoice_id IN (${ph}) GROUP BY description ORDER BY importe DESC LIMIT 8`
  ).all(...invs.map(i => i.id));

  // POR AÑO, que es el grano que un cliente entiende sin explicación.
  const porAnio = {};
  for (const i of invs) {
    const a = String(i.issue_date).slice(0, 4);
    porAnio[a] = (porAnio[a] || 0) + (Number(i.subtotal) || 0);
  }
  return {
    hay: true, sym,
    compras: invs.length,
    total: Math.round(total * 100) / 100,
    media: Math.round((total / invs.length) * 100) / 100,
    primera: fechas[0] || null,
    ultima, desdeUltima,
    cadaDias: mediana(dias),
    lineas,
    porAnio: Object.entries(porAnio).sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([anio, imp]) => ({ anio, importe: Math.round(imp * 100) / 100 })),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FICHA G2 — EL CANAL DE COMUNICACIONES
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Un hilo por cliente. El cliente escribe desde su portal (entra por token, no tiene usuario) y el
// negocio desde /admin/portal. No hay borrado: una conversación con el cliente es registro.
const MAX_MENSAJE = 2000;
// Trae también QUIÉN contestó del lado del negocio: en un equipo de tres, «lo contestó Marta» es la
// mitad de la información. El cliente no lo ve —para él el interlocutor es la empresa—, pero dentro
// del negocio sí, y por eso la columna se guarda desde el primer día.
export function mensajesDe(db, clientId) {
  try {
    return db.prepare(
      `SELECT m.id, m.autor, m.texto, m.created_at, m.visto_negocio, m.visto_cliente, m.admin_user_id,
              u.name AS autor_nombre
         FROM portal_mensajes m LEFT JOIN admin_users u ON u.id = m.admin_user_id
        WHERE m.client_id=? ORDER BY m.id`).all(clientId);
  } catch { return []; }
}
export function escribirMensaje(db, clientId, autor, texto, adminUserId = null) {
  const t = String(texto == null ? '' : texto).trim();
  if (!t) { const e = new Error('Escribe un mensaje antes de enviarlo.'); e.status = 400; throw e; }
  if (t.length > MAX_MENSAJE) { const e = new Error('El mensaje es demasiado largo (máximo ' + MAX_MENSAJE + ' caracteres).'); e.status = 400; throw e; }
  if (autor !== 'negocio' && autor !== 'cliente') { const e = new Error('Autor no válido'); e.status = 400; throw e; }
  if (!db.prepare('SELECT 1 FROM clients WHERE id=?').get(clientId)) { const e = new Error('Cliente no encontrado'); e.status = 404; throw e; }
  const r = db.prepare(
    `INSERT INTO portal_mensajes (client_id, autor, texto, admin_user_id, visto_negocio, visto_cliente)
     VALUES (?,?,?,?,?,?)`
  ).run(clientId, autor, t, adminUserId, autor === 'negocio' ? 1 : 0, autor === 'cliente' ? 1 : 0);
  return { id: r.lastInsertRowid };
}
export function marcarVisto(db, clientId, lado) {
  const col = lado === 'negocio' ? 'visto_negocio' : 'visto_cliente';
  try { db.prepare(`UPDATE portal_mensajes SET ${col}=1 WHERE client_id=? AND ${col}=0`).run(clientId); } catch {}
}
export function sinLeer(db, lado) {
  const col = lado === 'negocio' ? 'visto_negocio' : 'visto_cliente';
  try { return db.prepare(`SELECT client_id, COUNT(*) n FROM portal_mensajes WHERE ${col}=0 GROUP BY client_id`).all(); }
  catch { return []; }
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
  // El TEXTO sale del catálogo de plantillas (editable en Ajustes). {{enlace}} es su ELEMENTO CRÍTICO:
  // Ajustes NO deja guardar esta plantilla sin él, porque un portal sin enlace es un correo inútil.
  const tpl = renderEmail(db, 'portal_cliente', TONO_UNICO, {
    cliente: client.name || '',
    empresa,
    enlace: url,
    dias: String(ttlDays),
  });
  const res = await sendEmailImpl({
    from: `${empresa} <noreply@bamburu.com>`, to: client.email, replyTo: cfg.email || undefined,
    subject: tpl.subject, html: tpl.html, text: tpl.text,
  });
  if (res && res.error) { const e = new Error('No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde.'); e.status = 502; throw e; }   // U3: sin volcar el objeto de Resend
  return { sent: true, email: client.email };
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
