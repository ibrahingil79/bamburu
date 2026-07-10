// D5 (Eje B) — PROPUESTAS DE DISA · recordatorio de impago.
//
// La primera proactividad REAL de DISA: en vez de solo AVISAR de una factura vencida (eso ya lo hace
// la campana, fuente `cobro_vencido`), DISA PREPARA un borrador de email de recordatorio y lo deja en
// el panel "Propuestas de DISA" para que el dueño lo apruebe. NUNCA se autoenvía.
//
// Este módulo es SOLO la generación (F2). No envía nada: eso lo hace el panel al aprobar, reutilizando
// `registerCollectionAction` (cobros.js) — el mismo motor de email validado que ya existe.
//
// Reutiliza, sin duplicar:
//   · openDebts (cobros.js) — fuente canónica de deuda vencida (mismo cálculo que la ficha de cliente).
//   · collectionEmail (cobros.js) — la PLANTILLA (no LLM) de recordatorio, tono cordial-profesional.

import { openDebts, collectionEmail, invoiceCobro } from './cobros.js';

export const TIPO_IMPAGO = 'recordatorio_impago';
const UMBRAL_DEFECTO = 7;   // días tras el vencimiento; editable en Ajustes (company_config)

// Umbral configurado por el negocio (días tras vencimiento). Robusto: si la columna aún no existe o
// trae basura, cae al defecto. Nunca < 0 (un umbral negativo propondría antes de vencer).
export function umbralImpago(db) {
  try {
    const v = db.prepare('SELECT dias_recordatorio_impago AS d FROM company_config WHERE id=1').get()?.d;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : UMBRAL_DEFECTO;
  } catch { return UMBRAL_DEFECTO; }
}

// Genera las propuestas de recordatorio de impago que falten. Idempotente por el índice único
// (invoice_id, type): INSERT OR IGNORE, así una factura nunca tiene dos propuestas ni se re-propone
// una descartada. `today` para poder fijar el día en tests.
//
// Devuelve un resumen: { creadas, yaTenian, sinEmail, umbral, candidatas }.
//   sinEmail = facturas que cumplían el umbral pero cuyo cliente no tiene email (HALLAZGO, no se
//              genera nada; el panel podría mostrarlo en el futuro — hoy solo se cuenta/registra).
export function generarPropuestasImpago(db, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const umbral = umbralImpago(db);
  const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};

  const { rows } = openDebts(db, today);
  // Solo lo VENCIDO y con retraso ≥ umbral. openDebts ya filtró: cuenta como deuda (no anuladas,
  // no abonos, no sustituidas), pendiente > 0 y estado calculado. `estado==='vencida'` = pasó el plazo.
  const candidatas = rows.filter(r => r.estado === 'vencida' && (r.dias_vencida || 0) >= umbral);

  const ins = db.prepare(
    `INSERT OR IGNORE INTO disa_proposals (type, invoice_id, client_id, status, subject, body, created_at)
     VALUES (?, ?, ?, 'pendiente', ?, ?, ?)`
  );
  const now = opts.now || new Date().toISOString();

  let creadas = 0, yaTenian = 0, sinEmail = 0;
  const findingsSinEmail = [];
  for (const r of candidatas) {
    // ¿Ya hay propuesta para esta factura+tipo? (pendiente, enviada o descartada). El índice único la
    // rechazaría igual, pero comprobarlo evita construir la plantilla en balde y distingue el motivo.
    const existe = db.prepare('SELECT 1 FROM disa_proposals WHERE invoice_id=? AND type=?').get(r.invoice_id, TIPO_IMPAGO);
    if (existe) { yaTenian++; continue; }

    const client = r.client_id ? db.prepare('SELECT id, name, email FROM clients WHERE id=?').get(r.client_id) : null;
    if (!client || !client.email) {
      sinEmail++;
      findingsSinEmail.push({ invoice_id: r.invoice_id, invoice_number: r.invoice_number, client_id: r.client_id, client_name: r.client_name });
      continue;   // sin email no se puede enviar → no se genera propuesta (hallazgo, no se resuelve ahora)
    }

    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(r.invoice_id);
    const cobro = invoiceCobro(db, inv, today);   // pendiente/estado reales para la plantilla
    // PLANTILLA, no LLM. Tono 'firme-medio' = cordial y profesional para un primer recordatorio.
    const tpl = collectionEmail('firme-medio', { inv, client, cobro, company });
    const info = ins.run(TIPO_IMPAGO, r.invoice_id, r.client_id || null, tpl.subject, tpl.text, now);
    if (info.changes) creadas++; else yaTenian++;   // el índice único cerró una carrera → cuenta como ya-tenía
  }

  return { creadas, yaTenian, sinEmail, umbral, candidatas: candidatas.length, findingsSinEmail };
}

// Propuestas PENDIENTES, con los datos que pinta el panel (cliente, factura, importe, días de retraso).
// El importe/días se recalculan en vivo desde openDebts (la deuda pudo cambiar desde que se generó la
// propuesta: un cobro parcial, etc.); si la factura ya no figura como deuda viva, se marca resuelta_fuera.
export function propuestasPendientes(db, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const deuda = new Map(openDebts(db, t).rows.map(r => [r.invoice_id, r]));
  const props = db.prepare(
    `SELECT p.*, i.invoice_number, i.total, i.currency_symbol, c.name AS client_name, c.email AS client_email
       FROM disa_proposals p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN clients  c ON c.id = p.client_id
      WHERE p.status = 'pendiente'
      ORDER BY p.created_at DESC, p.id DESC`
  ).all();
  return props.map(p => {
    const d = deuda.get(p.invoice_id);
    return {
      id: p.id, type: p.type, invoice_id: p.invoice_id, client_id: p.client_id,
      invoice_number: p.invoice_number, client_name: p.client_name, client_email: p.client_email,
      subject: p.subject, body: p.body, created_at: p.created_at,
      importe: d ? d.pendiente : Number(p.total || 0),
      dias_vencida: d ? d.dias_vencida : null,
      viva: !!d,   // false = la factura ya no es deuda viva (cobrada/anulada tras generarla) → el panel lo avisa
    };
  });
}

// Nº de propuestas pendientes (para el badge del topbar). Barato: un COUNT, sin escanear cobros.
export function contarPropuestasPendientes(db) {
  try { return db.prepare("SELECT COUNT(*) AS n FROM disa_proposals WHERE status='pendiente'").get().n; }
  catch { return 0; }
}
