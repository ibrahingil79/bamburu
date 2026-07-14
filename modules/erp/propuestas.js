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
import { openPayables } from './pagos.js';
import { borradoresPendientes, importeEstimado } from './recurrentes.js';

export const TIPO_IMPAGO = 'recordatorio_impago';
export const TIPO_PAGO = 'pago_por_vencer';
export const TIPO_RECURRENTE = 'emitir_recurrente';
export const TIPOS = [TIPO_IMPAGO, TIPO_PAGO, TIPO_RECURRENTE];
const UMBRAL_DEFECTO = 7;   // días tras el vencimiento; editable en Ajustes (company_config)

// Días entre dos fechas YYYY-MM-DD (a - b), en UTC. Mismo cálculo que pagos.js/cobros.js.
const diasEntre = (a, b) => Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

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

// ════════════════════════════════════════════════════════════════════════════
// D5b — PROPUESTA DE PAGO A PROVEEDOR POR VENCER (el espejo de D5, invertido en el tiempo).
//
// D5 mira hacia ATRÁS: facturas de venta que YA vencieron y no te han pagado → prepara un email.
// Esto mira hacia DELANTE: facturas de compra que están A PUNTO de vencer → prepara el PAGO.
//
// La acción lista NO es un email: a un proveedor no se le avisa de que se le va a pagar. Es un
// ATAJO A REGISTRAR EL PAGO — el panel abre el MISMO modal del botón "Pagar" (views/pago-modal.js),
// que pega al ÚNICO endpoint de escritura POST /api/erp/supplier-invoices/:id/payments. No se
// duplica ni una línea del motor de pagos: solo se le lleva el dueño delante con el trabajo hecho.
// ════════════════════════════════════════════════════════════════════════════

// Umbral de aviso de pago (días ANTES del vencimiento). Hermano de umbralImpago: mismo defecto,
// misma robustez (columna ausente o basura → defecto), nunca < 0.
export function umbralPago(db) {
  try {
    const v = db.prepare('SELECT dias_aviso_pago AS d FROM company_config WHERE id=1').get()?.d;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : UMBRAL_DEFECTO;
  } catch { return UMBRAL_DEFECTO; }
}

// Facturas recibidas cuyo vencimiento cae DENTRO de los próximos `umbral` días: las que están por
// vencer, NO las ya vencidas (eso queda fuera de esta pieza a propósito). Fuente canónica:
// openPayables (pagos.js), el mismo motor que pinta /admin/pagos — no se recalcula la deuda aquí.
//
//   dias_para_vencer = due_date - hoy  →  0 (vence hoy) … umbral. Negativo = ya vencida → FUERA.
//
// openPayables ya deja fuera las anuladas y las de pendiente ~0; el estado 'vencida' descarta las
// pasadas de fecha, y 'abono'/'reembolsado' (pendiente negativo) no son algo que se pague.
export function pagosPorVencer(db, today, umbral) {
  const { rows } = openPayables(db, today);
  return rows
    .filter(r => (r.estado === 'pendiente' || r.estado === 'parcial') && r.pendiente > 0.0049 && r.due_date)
    .map(r => ({ ...r, dias_para_vencer: diasEntre(r.due_date, today) }))
    .filter(r => r.dias_para_vencer >= 0 && r.dias_para_vencer <= umbral)
    .sort((a, b) => a.dias_para_vencer - b.dias_para_vencer);   // lo que antes vence, arriba
}

// Genera las propuestas de pago por vencer que falten. Misma idempotencia estricta que D5, por el
// índice único (supplier_invoice_id, type): una factura de compra nunca tiene dos propuestas ni se
// re-propone una descartada. Devuelve { creadas, yaTenian, umbral, candidatas }.
export function generarPropuestasPago(db, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const umbral = umbralPago(db);
  const candidatas = pagosPorVencer(db, today, umbral);

  const ins = db.prepare(
    `INSERT OR IGNORE INTO disa_proposals (type, supplier_invoice_id, supplier_id, status, subject, body, created_at)
     VALUES (?, ?, ?, 'pendiente', ?, '', ?)`
  );
  const now = opts.now || new Date().toISOString();

  let creadas = 0, yaTenian = 0;
  for (const r of candidatas) {
    const existe = db.prepare('SELECT 1 FROM disa_proposals WHERE supplier_invoice_id=? AND type=?').get(r.supplier_invoice_id, TIPO_PAGO);
    if (existe) { yaTenian++; continue; }
    // `subject` es solo una etiqueta legible para el registro (aquí NO hay email). Lo que el panel
    // pinta —importe, vencimiento, días— se recalcula SIEMPRE en vivo, nunca de esta copia.
    const etiqueta = 'Pagar a ' + (r.supplier_name || 'proveedor') + ' · ' + (r.internal_code || '#' + r.supplier_invoice_id)
      + ' · vence el ' + r.due_date;
    const info = ins.run(TIPO_PAGO, r.supplier_invoice_id, r.supplier_id || null, etiqueta, now);
    if (info.changes) creadas++; else yaTenian++;   // el índice único cerró una carrera
  }
  return { creadas, yaTenian, umbral, candidatas: candidatas.length };
}

// ════════════════════════════════════════════════════════════════════════════
// EMITIR FACTURA RECURRENTE — la iguala/cuota que TOCA este ciclo y sigue sin emitirse.
//
// El motor de recurrentes ya existía entero: `generateDueOccurrences` (lo corre el cron de avisos)
// crea una OCURRENCIA en 'borrador' cada vez que una plantilla cumple fecha, y la pantalla
// /admin/recurrentes deja emitirla de un clic. Lo que faltaba era que DISA te lo PUSIERA DELANTE en
// vez de esperar a que entres a mirar. Ese es el mismo salto que dio D5: de avisar, a preparar.
//
// A diferencia de D5 (que prepara un email) y de D5b (que prepara un pago), aquí la acción no tiene
// nada que rellenar: la plantilla ya dice cliente, líneas, IVA e IRPF, y la ocurrencia dice la fecha.
// Aprobar = EMITIR, un clic, por `emitirOcurrencia` — la MISMA vía que usa la pantalla, la que pasa
// por createInvoice y pone la huella Verifactu. Aquí no se emite nada por un camino nuevo.
// ════════════════════════════════════════════════════════════════════════════

// Genera las propuestas de emisión que falten, una por ocurrencia en 'borrador'. Idempotente por el
// índice único (occurrence_id, type): una ocurrencia nunca tiene dos propuestas, y una descartada no
// se re-propone. Devuelve { creadas, yaTenian, sinLineas, candidatas }.
//
//   sinLineas = ocurrencias de una plantilla que se quedó sin líneas. `emitirOcurrencia` las
//               rechazaría (400), así que proponer su emisión sería prometer un botón que no funciona.
//               No se genera propuesta: se cuenta y se devuelve como hallazgo.
export function generarPropuestasRecurrentes(db, opts = {}) {
  const candidatas = borradoresPendientes(db);   // fuente canónica: ocurrencias en 'borrador'
  const ins = db.prepare(
    `INSERT OR IGNORE INTO disa_proposals (type, occurrence_id, client_id, status, subject, body, created_at)
     VALUES (?, ?, ?, 'pendiente', ?, '', ?)`
  );
  const now = opts.now || new Date().toISOString();

  let creadas = 0, yaTenian = 0, sinLineas = 0;
  for (const o of candidatas) {
    const existe = db.prepare('SELECT 1 FROM disa_proposals WHERE occurrence_id=? AND type=?').get(o.id, TIPO_RECURRENTE);
    if (existe) { yaTenian++; continue; }

    const nLineas = db.prepare('SELECT COUNT(*) n FROM recurring_template_items WHERE template_id=?').get(o.template_id).n;
    if (!nLineas) { sinLineas++; continue; }   // emitirla fallaría (400): no se promete lo que no se puede cumplir

    // `subject` es solo una etiqueta legible para el registro (aquí NO hay email, como en D5b). Todo lo
    // que el panel pinta —importe, cliente, fecha— se recalcula SIEMPRE en vivo, nunca de esta copia:
    // la plantilla pudo cambiar de precio entre que se propuso y que se aprueba.
    const etiqueta = 'Emitir ' + (o.document_name || 'Factura') + ' de ' + (o.client_name || 'cliente')
      + ' · toca el ' + o.due_date;
    const info = ins.run(TIPO_RECURRENTE, o.id, o.client_id || null, etiqueta, now);
    if (info.changes) creadas++; else yaTenian++;   // el índice único cerró una carrera → cuenta como ya-tenía
  }
  return { creadas, yaTenian, sinLineas, candidatas: candidatas.length };
}

// ════════════════════════════════════════════════════════════════════════════

// Propuestas PENDIENTES, con los datos que pinta el panel. `tipos` acota QUÉ tipos se devuelven: el
// panel pasa solo los que el usuario tiene permiso de ver (un tipo es una pantalla distinta y un
// permiso distinto), así una propuesta nunca es una puerta trasera a datos que su pantalla te niega.
// Por defecto, todos los tipos.
//
// Importe y días se recalculan EN VIVO (la deuda pudo cambiar desde que se generó la propuesta: un
// cobro/pago parcial, etc.). Si el documento ya no figura como deuda viva, `viva:false` → el panel avisa.
export function propuestasPendientes(db, today, tipos = TIPOS) {
  const t = today || new Date().toISOString().slice(0, 10);
  const quiere = new Set(tipos);
  const out = [];

  if (quiere.has(TIPO_IMPAGO)) {
    const deuda = new Map(openDebts(db, t).rows.map(r => [r.invoice_id, r]));
    const props = db.prepare(
      `SELECT p.*, i.invoice_number, i.total, i.currency_symbol, c.name AS client_name, c.email AS client_email
         FROM disa_proposals p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN clients  c ON c.id = p.client_id
        WHERE p.status = 'pendiente' AND p.type = ?
        ORDER BY p.created_at DESC, p.id DESC`
    ).all(TIPO_IMPAGO);
    for (const p of props) {
      const d = deuda.get(p.invoice_id);
      out.push({
        id: p.id, type: p.type, invoice_id: p.invoice_id, client_id: p.client_id,
        invoice_number: p.invoice_number, client_name: p.client_name, client_email: p.client_email,
        subject: p.subject, body: p.body, created_at: p.created_at,
        importe: d ? d.pendiente : Number(p.total || 0),
        dias_vencida: d ? d.dias_vencida : null,
        viva: !!d,   // false = la factura ya no es deuda viva (cobrada/anulada tras generarla)
      });
    }
  }

  if (quiere.has(TIPO_PAGO)) {
    // Deuda viva con proveedores, indexada por factura recibida: de aquí salen importe/vencimiento/días.
    const pagar = new Map(openPayables(db, t).rows.map(r => [r.supplier_invoice_id, r]));
    const props = db.prepare(
      `SELECT p.*, si.internal_code, si.supplier_invoice_number, si.due_date, si.total,
              s.name AS supplier_name
         FROM disa_proposals p
         LEFT JOIN supplier_invoices si ON si.id = p.supplier_invoice_id
         LEFT JOIN suppliers        s  ON s.id  = p.supplier_id
        WHERE p.status = 'pendiente' AND p.type = ?
        ORDER BY p.created_at DESC, p.id DESC`
    ).all(TIPO_PAGO);
    for (const p of props) {
      const d = pagar.get(p.supplier_invoice_id);
      const due = d ? d.due_date : p.due_date;
      out.push({
        id: p.id, type: p.type,
        supplier_invoice_id: p.supplier_invoice_id, supplier_id: p.supplier_id,
        supplier_name: p.supplier_name, internal_code: p.internal_code,
        supplier_invoice_number: p.supplier_invoice_number,
        subject: p.subject, created_at: p.created_at,
        due_date: due,
        importe: d ? d.pendiente : Number(p.total || 0),
        dias_para_vencer: due ? diasEntre(due, t) : null,
        viva: !!d,   // false = ya pagada/anulada tras generarla → el panel lo avisa
      });
    }
  }

  if (quiere.has(TIPO_RECURRENTE)) {
    const props = db.prepare(
      `SELECT p.*, o.due_date, o.status AS occ_status, o.template_id, o.invoice_id AS emitida_invoice_id,
              t.document_name, t.status AS tpl_status,
              c.name AS client_name
         FROM disa_proposals p
         LEFT JOIN recurring_occurrences o ON o.id = p.occurrence_id
         LEFT JOIN recurring_templates   t ON t.id = o.template_id
         LEFT JOIN clients               c ON c.id = t.client_id
        WHERE p.status = 'pendiente' AND p.type = ?
        ORDER BY o.due_date, p.id DESC`
    ).all(TIPO_RECURRENTE);
    for (const p of props) {
      // Importe y concepto SIEMPRE en vivo, desde la plantilla: si el dueño le subió el precio a la
      // iguala después de que DISA la propusiera, se emite —y se enseña— el precio de HOY.
      const imp = p.template_id ? importeEstimado(db, p.template_id) : null;
      const lineas = p.template_id
        ? db.prepare('SELECT description FROM recurring_template_items WHERE template_id=? ORDER BY id').all(p.template_id)
        : [];
      const concepto = lineas.length
        ? lineas[0].description
          + (lineas.length > 1 ? ' (+' + (lineas.length - 1) + ' línea' + (lineas.length === 2 ? '' : 's') + ' más)' : '')
        : '—';
      out.push({
        id: p.id, type: p.type,
        occurrence_id: p.occurrence_id, client_id: p.client_id, template_id: p.template_id,
        client_name: p.client_name, document_name: p.document_name || 'Factura',
        due_date: p.due_date, concepto,
        subject: p.subject, created_at: p.created_at,
        importe: imp ? imp.total : null,
        base: imp ? imp.base : null, iva: imp ? imp.iva : null, irpf: imp ? imp.irpf : null,
        // viva = la ocurrencia SIGUE en borrador. Si se emitió (o se omitió) por la pantalla de
        // recurrentes después de proponerla, el botón de aquí ya no debe prometer nada.
        viva: p.occ_status === 'borrador',
        occ_status: p.occ_status || null,
      });
    }
  }
  return out;
}

// Nº de propuestas pendientes (para el badge del topbar). Barato: un COUNT, sin escanear cobros ni
// pagos. `tipos` acota igual que arriba: el badge solo cuenta lo que el usuario podría abrir.
export function contarPropuestasPendientes(db, tipos = TIPOS) {
  if (!tipos.length) return 0;
  try {
    const marks = tipos.map(() => '?').join(',');
    return db.prepare(`SELECT COUNT(*) AS n FROM disa_proposals WHERE status='pendiente' AND type IN (${marks})`).get(...tipos).n;
  } catch { return 0; }
}
