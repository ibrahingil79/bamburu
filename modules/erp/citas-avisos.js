// PIEZA 5 · CITAS — AVISOS AL CLIENTE (confirmación y recordatorio). TODOS pueden ir A MANO; el
// negocio decide. Tres canales, mismo mensaje y mismo enlace de la cita (1.9):
//   · WHATSAPP — enlace oficial wa.me (coste cero, sin cuenta de Meta). PROHIBIDO WhatsApp Web y
//     librerías no oficiales: aquí SOLO se construye el enlace, no se automatiza nada.
//   · SMS — enlace sms: nativo (sobre todo desde el móvil).
//   · EMAIL — el único que además puede salir SOLO (cron + plantillas Resend que YA existen).
// Estado HONESTO (1.12): por la vía manual solo sabemos que se pulsó el botón → 'marcado'. NUNCA
// 'entregado' ni 'leído'. NO se construye capa genérica de canales; solo se adelanta el DATO (1.13).

import { renderEmail, TONO_UNICO } from './email-templates.js';
import { PREFIJOS_VALIDOS } from './paises-telefono.js';
import { hhmm, ahoraLocal } from './citas-engine.js';
import { escHtml as escapeHtmlEmail } from '../../core/escape.js';
import { fechaEs } from './voz.js';   // la fecha, en cristiano (24/08/2026)

// ── 1.13 Móvil en formato internacional (+34…): validar al escribir y sanear los existentes ────────
// Devuelve { e164, valido }. Acepta '+CC...' / '00CC...' / un número nacional español de 9 cifras (se
// le antepone +34). Cualquier otra cosa → no válido (marca "sin móvil válido").
export function normalizeMovil(raw, prefijoDefecto = '+34') {
  let s = String(raw ?? '').trim().replace(/[\s.\-()]/g, '');
  if (!s) return { e164: '', valido: false };
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (/^\d{6,15}$/.test(digits)) return { e164: '+' + digits, valido: true };
    return { e164: s, valido: false };
  }
  if (/^\d{9}$/.test(s) && prefijoDefecto === '+34') return { e164: '+34' + s, valido: true };
  // Otro país: si el número desnudo es plausible y hay prefijo por defecto conocido, lo componemos.
  if (/^\d{6,14}$/.test(s) && PREFIJOS_VALIDOS.has(prefijoDefecto)) return { e164: prefijoDefecto + s, valido: true };
  return { e164: s, valido: false };
}

// ── Enlace público de la cita (1.9) ───────────────────────────────────────────────────────────────
// baseUrl = https://<slug>.<dominio>. En desarrollo (sin PUBLIC_BASE_DOMAIN) cae a un host relativo.
export function citaBaseUrl(tenantSlug) {
  const dom = process.env.PUBLIC_BASE_DOMAIN;
  return dom && tenantSlug ? `https://${tenantSlug}.${dom}` : '';
}
export function citaEnlace(baseUrl, token) {
  return `${baseUrl || ''}/cita/${token}`;
}

// ── Contacto de una cita: cliente de la ficha (con su móvil saneado) o cliente suelto ──────────────
export function contactoDeCita(db, cita) {
  if (cita.cliente_id) {
    const cl = db.prepare('SELECT name, email, phone, movil_e164, movil_invalido FROM clients WHERE id=?').get(cita.cliente_id) || {};
    const movil = cl.movil_e164 || '';
    return { nombre: cl.name || '', email: cl.email || '', movil_e164: movil, movil_valido: !!movil && !cl.movil_invalido, es_suelto: false };
  }
  const n = normalizeMovil(cita.cliente_suelto_movil || '');
  return { nombre: cita.cliente_suelto_nombre || '', email: '', movil_e164: n.e164, movil_valido: n.valido, es_suelto: true };
}

// Nombres de los servicios de la cita (en vivo del catálogo; fuente única).
export function serviciosDeCita(db, citaId) {
  return db.prepare(
    `SELECT cs.orden, p.name AS nombre FROM cita_servicios cs
       LEFT JOIN products p ON p.id = cs.product_id WHERE cs.cita_id=? ORDER BY cs.orden, cs.id`
  ).all(citaId).map(r => r.nombre || 'Servicio');
}

// ── Texto del mensaje (WhatsApp / SMS): corto, con el enlace. Bamburu lo redacta (1.10). ───────────
export function textoAviso(tipo, { empresa, servicio, fecha, hora, direccion, enlace }) {
  const cabecera = tipo === 'recordatorio'
    ? `Recordatorio de tu cita en ${empresa}:`
    : `Tu cita en ${empresa} está confirmada:`;
  const lineas = [
    cabecera,
    `${servicio} · ${fechaEs(fecha)} a las ${hora}`,
  ];
  if (direccion) lineas.push(`Dónde: ${direccion}`);
  lineas.push(`Confirma o avísanos si no puedes venir: ${enlace}`);
  return lineas.join('\n');
}

// wa.me OFICIAL. num sin '+' ni signos. text ya montado. Coste cero, sin cuenta de Meta.
export function waLink(movilE164, texto) {
  const num = String(movilE164 || '').replace(/[^\d]/g, '');
  return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
}
// SMS nativo. La forma '?&body=' funciona tanto en iOS como en Android.
export function smsLink(movilE164, texto) {
  return `sms:${movilE164}?&body=${encodeURIComponent(texto)}`;
}

// ── EMAIL — el único que además puede salir SOLO. Render + envío por la vía Resend que YA existe. ──
// tipo ∈ 'confirmacion' | 'recordatorio'. sendEmailImpl se inyecta (tests mockean; prod = core/mailer).
// PIEZA 6 — `politica` es OPCIONAL: la puerta pública manda el texto de cancelación que el cliente
// leyó antes de confirmar, y la agenda no manda nada. Sin política, el hueco {{politica}} se resuelve
// a cadena vacía y el correo sale exactamente igual que en la pieza 5. El texto lo escribe el DUEÑO,
// así que se ESCAPA aquí antes de envolverlo (el hueco está declarado esHtml: el bloque es el dato).
export async function enviarEmailCita(db, { tipo, destinatario, empresa, replyTo, servicio, fecha, hora, direccion, enlace, cliente, politica = '' }, sendEmailImpl) {
  if (!destinatario) { const e = new Error('El cliente no tiene email'); e.status = 400; throw e; }
  const tplId = tipo === 'recordatorio' ? 'recordatorio_cita' : 'confirmacion_cita';
  const bloquePolitica = String(politica || '').trim()
    ? { esHtml: true, valor: '<p style="margin:16px 0 6px;font-weight:700">Política de cancelación</p>'
        + '<p style="color:#374151;font-size:13px;line-height:1.6;white-space:pre-wrap">' + escapeHtmlEmail(politica) + '</p>' }
    : '';
  const tpl = renderEmail(db, tplId, TONO_UNICO, { cliente, empresa, servicio, fecha, hora, direccion, enlace, politica: bloquePolitica });
  const res = await sendEmailImpl({
    from: `${empresa} <noreply@bamburu.com>`, to: destinatario, replyTo: replyTo || undefined,
    subject: tpl.subject, html: tpl.html, text: tpl.text,
  });
  if (res && res.error) { const e = new Error('No hemos podido enviar el email. Comprueba la dirección e inténtalo más tarde.'); e.status = 502; throw e; }
  return { sent: true, email: destinatario };
}

// ── ¿Ya se marcó/envió un aviso de este tipo para esta cita? (idempotencia + estado de la cola) ────
export function avisoHecho(db, citaId, tipo) {
  return db.prepare('SELECT id, canal, estado, enviado_at FROM cita_avisos WHERE cita_id=? AND tipo=? ORDER BY id DESC LIMIT 1').get(citaId, tipo) || null;
}
// Deja rastro de un aviso. estado = 'marcado' (manual) | 'email_enviado' | 'email_fallo'. NUNCA 'entregado'.
export function registrarAviso(db, { cita_id, tipo, canal, estado = 'marcado', por_user_id = null, nota = '' }) {
  db.prepare('INSERT INTO cita_avisos (cita_id, tipo, canal, estado, por_user_id, nota) VALUES (?,?,?,?,?,?)')
    .run(cita_id, tipo, canal, estado, por_user_id, nota);
}

// Nº de avisos PENDIENTES (para el contador del menú, AGENDA SENCILLA §2.3): citas de mañana sin
// recordatorio + de hoy sin confirmación. Barato y tolerante a fallo (0 nunca rompe el chrome del layout).
export function contarAvisosPendientes(db) {
  try {
    const hoy = ahoraLocal().fecha;
    const manana = new Date(Date.parse(hoy + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    const q = (fecha, tipo) => db.prepare(
      `SELECT COUNT(*) n FROM citas c WHERE c.fecha=? AND c.archived=0 AND c.estado IN ('pedida','confirmada')
         AND NOT EXISTS (SELECT 1 FROM cita_avisos a WHERE a.cita_id=c.id AND a.tipo=?)`
    ).get(fecha, tipo).n;
    return q(manana, 'recordatorio') + q(hoy, 'confirmacion');
  } catch { return 0; }
}

// ── 1.11 LA COLA DE ENVÍOS ─────────────────────────────────────────────────────────────────────
// Devuelve, en una sola pantalla: las citas de MAÑANA pendientes de recordatorio y las de HOY
// pendientes de confirmación. Cada una con su contacto y el estado del aviso (si ya se marcó).
export function colaEnvios(db, { hoy, manana, baseUrl = '', empresa = 'tu negocio', direccion = '' }) {
  const pick = (fecha, tipo) => db.prepare(
    `SELECT c.*, u.name AS persona FROM citas c LEFT JOIN admin_users u ON u.id=c.user_id
      WHERE c.fecha=? AND c.archived=0 AND c.estado IN ('pedida','confirmada')
      ORDER BY c.inicio_min`
  ).all(fecha).map(cita => {
    const contacto = contactoDeCita(db, cita);
    const aviso = avisoHecho(db, cita.id, tipo);
    const servicios = serviciosDeCita(db, cita.id).join(' + ');
    // Texto y enlace REALES de esta cita (con su token): lo que viaja en TODOS los canales (1.9/1.10).
    const enlace = citaEnlace(baseUrl, cita.token);
    const texto = textoAviso(tipo, { empresa, servicio: servicios, fecha: cita.fecha, hora: hhmm(cita.inicio_min), direccion, enlace });
    return {
      id: cita.id, codigo: cita.codigo, hora: hhmm(cita.inicio_min), persona: cita.persona,
      cliente: contacto.nombre, movil_e164: contacto.movil_e164, movil_valido: contacto.movil_valido,
      email: contacto.email, estado_cita: cita.estado, servicios, enlace, texto,
      wa: contacto.movil_valido ? waLink(contacto.movil_e164, texto) : null,
      sms: contacto.movil_valido ? smsLink(contacto.movil_e164, texto) : null,
      aviso_hecho: !!aviso, aviso_canal: aviso?.canal || null, aviso_estado: aviso?.estado || null, aviso_at: aviso?.enviado_at || null,
    };
  });
  return {
    recordatorios: pick(manana, 'recordatorio'),   // citas de MAÑANA pendientes de recordatorio
    confirmaciones: pick(hoy, 'confirmacion'),      // citas de HOY pendientes de confirmación
  };
}
