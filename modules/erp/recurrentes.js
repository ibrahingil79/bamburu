// ── FACTURAS RECURRENTES · Bloque A — plantillas de cuota/iguala + generación de borradores ──
//
// Una plantilla define una factura que se repite (cliente + líneas + cadencia). En cada fecha que
// toca, `generateDueOccurrences` crea una OCURRENCIA en estado 'borrador' (idempotente). El dueño la
// revisa y la EMITE con un clic → `emitirOcurrencia` llama al flujo de emisión existente
// (createInvoice), que es donde nace la huella Verifactu. Aditivo: no toca invoices/ledger salvo esa
// emisión, y siempre por acción confirmada del usuario. "Emitir automático sin revisar" = futuro.

import { createInvoice } from './routes/invoices.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Suma n meses a 'YYYY-MM-DD' con recorte de día (31 ene + 1 mes → 28/29 feb). En UTC.
export function addMonths(iso, n) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, lastDay));
  return base.toISOString().slice(0, 10);
}

// Fechas de vencimiento de una plantilla desde start_date, paso interval_months, hasta `to`
// inclusive, respetando fin por fecha (end_date) y por nº de ocurrencias (max_occurrences).
export function dueDatesUntil(tpl, to) {
  const out = [];
  const cap = tpl.max_occurrences ? Number(tpl.max_occurrences) : Infinity;
  const step = Math.max(1, Number(tpl.interval_months) || 1);
  for (let k = 0; out.length < cap; k++) {
    const d = addMonths(tpl.start_date, k * step);
    if (d > to) break;
    if (tpl.end_date && d > tpl.end_date) break;
    out.push(d);
    if (k > 1200) break;   // tope de seguridad (100 años mensual)
  }
  return out;
}

// Próximas N fechas futuras (> today) de una plantilla activa, para mostrar en pantalla.
export function proximasFechas(tpl, today, n = 3) {
  const cap = tpl.max_occurrences ? Number(tpl.max_occurrences) : Infinity;
  const step = Math.max(1, Number(tpl.interval_months) || 1);
  const out = [];
  for (let k = 0, count = 0; count < cap && out.length < n; k++) {
    const d = addMonths(tpl.start_date, k * step);
    if (tpl.end_date && d > tpl.end_date) break;
    count++;
    if (d > today) out.push(d);
    if (k > 1200) break;
  }
  return out;
}

// EL JOB: para cada plantilla activa, crea las ocurrencias 'borrador' cuyas fechas ya vencieron y que
// aún no existen. Idempotente (UNIQUE(template_id, due_date) + INSERT OR IGNORE): correr de más no
// duplica. Devuelve { generados, plantillas }.
export function generateDueOccurrences(db, today) {
  const tpls = db.prepare("SELECT * FROM recurring_templates WHERE status='activa'").all();
  const ins = db.prepare('INSERT OR IGNORE INTO recurring_occurrences (template_id, due_date, status) VALUES (?,?,?)');
  let generados = 0;
  db.transaction(() => {
    for (const tpl of tpls) {
      for (const due of dueDatesUntil(tpl, today)) {
        const r = ins.run(tpl.id, due, 'borrador');
        if (r.changes === 1) generados++;
      }
    }
  })();
  return { generados, plantillas: tpls.length };
}

// Borradores pendientes (ocurrencias en 'borrador'), con datos de plantilla/cliente para pantalla y aviso.
export function borradoresPendientes(db) {
  return db.prepare(`SELECT o.id, o.template_id, o.due_date, t.document_name, t.client_id,
      COALESCE(c.name,'—') client_name
      FROM recurring_occurrences o JOIN recurring_templates t ON t.id = o.template_id
      LEFT JOIN clients c ON c.id = t.client_id
      WHERE o.status='borrador' ORDER BY o.due_date`).all();
}

// Importe estimado de una plantilla (base + IVA − IRPF) desde sus líneas, para mostrar en el borrador.
export function importeEstimado(db, templateId) {
  const items = db.prepare('SELECT quantity, unit_price, tax_rate FROM recurring_template_items WHERE template_id=?').all(templateId);
  const tpl = db.prepare('SELECT irpf_rate FROM recurring_templates WHERE id=?').get(templateId) || {};
  let base = 0, iva = 0;
  for (const it of items) { const b = r2(it.quantity * it.unit_price); base = r2(base + b); iva = r2(iva + b * (Number(it.tax_rate) || 0) / 100); }
  const irpf = r2(base * (Number(tpl.irpf_rate) || 0) / 100);
  return { base, iva, irpf, total: r2(base + iva - irpf) };
}

// EMITIR una ocurrencia 'borrador' → crea la factura real con el flujo existente (createInvoice, que
// pone huella Verifactu). Marca la ocurrencia 'emitida' + invoice_id. Guarda contra doble emisión.
export function emitirOcurrencia(db, occurrenceId) {
  const occ = db.prepare('SELECT * FROM recurring_occurrences WHERE id=?').get(occurrenceId);
  if (!occ) { const e = new Error('Borrador no encontrado'); e.status = 404; throw e; }
  if (occ.status !== 'borrador') { const e = new Error('Este borrador ya se emitió o se omitió'); e.status = 409; throw e; }
  const tpl = db.prepare('SELECT * FROM recurring_templates WHERE id=?').get(occ.template_id);
  if (!tpl) { const e = new Error('Plantilla no encontrada'); e.status = 404; throw e; }
  const items = db.prepare('SELECT description, quantity, unit_price, tax_rate FROM recurring_template_items WHERE template_id=?').all(tpl.id);
  if (!items.length) { const e = new Error('La plantilla no tiene líneas'); e.status = 400; throw e; }

  let created;
  db.transaction(() => {
    created = createInvoice(db, {
      client_id: tpl.client_id, issue_date: occ.due_date, irpf_rate: tpl.irpf_rate || 0,
      document_name: tpl.document_name || 'Factura',
      lines: items.map(it => ({ description: it.description, quantity: it.quantity, unit_price: it.unit_price, tax_rate: it.tax_rate })),
    });
    db.prepare("UPDATE recurring_occurrences SET status='emitida', invoice_id=?, emitted_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(created.id, occ.id);
  })();
  return created;
}

// Omitir un borrador (saltar esa ocurrencia sin emitir). No borra: marca 'omitida'.
export function omitirOcurrencia(db, occurrenceId) {
  const occ = db.prepare('SELECT status FROM recurring_occurrences WHERE id=?').get(occurrenceId);
  if (!occ) { const e = new Error('Borrador no encontrado'); e.status = 404; throw e; }
  if (occ.status !== 'borrador') { const e = new Error('Solo se puede omitir un borrador'); e.status = 409; throw e; }
  db.prepare("UPDATE recurring_occurrences SET status='omitida' WHERE id=?").run(occurrenceId);
}

// ── Servicios de escritura de plantillas (los usa la ruta con requirePerm + CSRF) ──
export function createTemplate(db, d) {
  const client_id = d.client_id ? Number(d.client_id) : null;
  const start_date = String(d.start_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) { const e = new Error('Fecha de inicio inválida'); e.status = 400; throw e; }
  const interval_months = Math.max(1, Number(d.interval_months) || 1);
  const lines = (d.lines || []).filter(l => String(l.description || '').trim() && Number(l.unit_price) >= 0);
  if (!lines.length) { const e = new Error('Añade al menos una línea'); e.status = 400; throw e; }
  const end_date = d.end_date ? String(d.end_date).slice(0, 10) : null;
  const max_occurrences = d.max_occurrences ? Number(d.max_occurrences) : null;
  let id;
  db.transaction(() => {
    const r = db.prepare(`INSERT INTO recurring_templates
      (client_id, document_name, interval_months, start_date, end_date, max_occurrences, irpf_rate, status, notes)
      VALUES (?,?,?,?,?,?,?, 'activa', ?)`)
      .run(client_id, String(d.document_name || 'Factura'), interval_months, start_date, end_date, max_occurrences, r2(d.irpf_rate || 0), String(d.notes || ''));
    id = r.lastInsertRowid;
    const insL = db.prepare('INSERT INTO recurring_template_items (template_id, description, quantity, unit_price, tax_rate) VALUES (?,?,?,?,?)');
    for (const l of lines) insL.run(id, String(l.description).trim(), Number(l.quantity) || 1, r2(l.unit_price), Number(l.tax_rate) || 0);
  })();
  return { id };
}

export function setTemplateStatus(db, id, status) {
  if (!['activa', 'pausada'].includes(status)) { const e = new Error('Estado inválido'); e.status = 400; throw e; }
  const g = db.prepare('SELECT id FROM recurring_templates WHERE id=?').get(id);
  if (!g) { const e = new Error('Plantilla no encontrada'); e.status = 404; throw e; }
  db.prepare('UPDATE recurring_templates SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
}
