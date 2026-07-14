// T4 Paso 1 — Motor de cobros. El estado de cobro de una factura NUNCA se guarda:
// se calcula siempre en vivo desde la suma de cobros (invoice_payments) y la fecha
// de vencimiento (invoices.due_date), para que no quede desactualizado.
//
// Fuera de alcance (Paso 2): perfiles de cobro, próxima acción, DISA. Aquí solo el motor.
import { renderEmail, renderEmailFabrica } from './email-templates.js';

const r2 = n => Math.round(n * 100) / 100;

// Días entre dos fechas YYYY-MM-DD (a - b), en UTC para evitar saltos de zona horaria.
function daysBetween(a, b) {
  return Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

// Suma de los cobros de una factura.
export function paymentsSum(db, invoiceId) {
  return r2(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM invoice_payments WHERE invoice_id=?').get(invoiceId).s);
}

// ¿Esta factura cuenta como deuda del cliente? (regla fiscal confirmada, por modalidad)
//  - anulada                         → no cuenta.
//  - rectificada por SUSTITUCIÓN (S) → no cuenta (la rectificativa lleva el importe completo).
//  - rectificada por DIFERENCIAS (I) → sí cuenta (la rectificativa solo añade el delta).
//  - resto (emitida, incl. rectificativa) → cuenta; un abono (total negativo) resta deuda.
// La modalidad vive en la rectificativa (rectification_mode), no en la original.
export function countsAsReceivable(db, inv) {
  if (inv.status === 'anulada') return false;
  // PIEZA B: un ticket (factura simplificada) SUSTITUIDO por una factura completa (F3) deja de
  // contar — su importe fiscal lo lleva la sustitutiva (la venta no se cuenta dos veces). Espejo
  // de la rectificada-por-sustitución. La marca es la FK substitutes_invoice_id de la sustitutiva.
  if (db.prepare('SELECT 1 FROM invoices WHERE substitutes_invoice_id=? LIMIT 1').get(inv.id)) return false;
  if (inv.status === 'rectificada') {
    const rect = db.prepare(
      'SELECT rectification_mode FROM invoices WHERE rectifies_invoice_id=? ORDER BY id DESC LIMIT 1'
    ).get(inv.id);
    if (rect && rect.rectification_mode === 'S') return false;   // sustituida
    return true;                                                 // diferencias (o sin dato → conserva)
  }
  return true;
}

// ¿Esta factura ADMITE cobro? (gate de UI y de backend) — solo facturas vivas:
//  - NO anulada
//  - total >= 0 (un abono / rectificativa negativa no se cobra, se paga)
//  - NO rectificada por SUSTITUCIÓN (la sustituida ya no se cobra; la cobra su
//    rectificativa). La rectificada por DIFERENCIAS sí (la original sigue viva).
// Es exactamente countsAsReceivable + el guard de importe negativo.
export function isCobrable(db, inv) {
  return countsAsReceivable(db, inv) && Number(inv.total) >= 0;
}

// Estado de cobro en vivo de una factura, dada la suma ya cobrada y la fecha de hoy.
// estado ∈ {pendiente, parcial, cobrada, vencida, abono}. 'abono' = factura de total
// negativo (rectificativa de abono): no se "cobra", es crédito a favor del cliente.
export function cobroState(inv, cobrado, today) {
  const total     = r2(inv.total || 0);
  cobrado         = r2(cobrado || 0);
  const pendiente = r2(total - cobrado);
  const due       = inv.due_date || inv.issue_date;

  let estado, vencida = false, dias_vencida = 0, tramo = null;
  if (total < 0) {
    estado = 'abono';
  } else if (pendiente <= 0.0049) {
    estado = 'cobrada';
  } else {
    estado = cobrado > 0 ? 'parcial' : 'pendiente';
    if (due && daysBetween(today, due) > 0) {            // pendiente y pasada la fecha → vencida
      estado = 'vencida';
      vencida = true;
      dias_vencida = daysBetween(today, due);
      tramo = dias_vencida <= 30 ? '0-30' : dias_vencida <= 60 ? '30-60' : '+60';
    }
  }
  return { total, cobrado, pendiente, estado, vencida, dias_vencida, tramo, due_date: due };
}

// Estado de cobro de una factura leyendo sus cobros de la BD.
export function invoiceCobro(db, inv, today) {
  let cobrado = paymentsSum(db, inv.id);
  // PIEZA B: la factura completa de canje NACE PAGADA por el cobro del ticket que sustituye —
  // hereda sus pagos (NO se crea una fila nueva en invoice_payments) → queda 'cobrada', no pendiente.
  if (inv.substitutes_invoice_id) cobrado = r2(cobrado + paymentsSum(db, inv.substitutes_invoice_id));
  return cobroState(inv, cobrado, today);
}

// Resumen de deuda de un cliente: sus facturas (con estado de cobro), el total que
// debe y su deuda más antigua (factura con pendiente>0 y due_date más temprana).
export function clientDebt(db, clientId, today) {
  const invs = db.prepare('SELECT * FROM invoices WHERE client_id=? ORDER BY issue_date, id').all(clientId);
  let total = 0;
  let oldest = null;
  const rows = [];
  for (const inv of invs) {
    const counts = countsAsReceivable(db, inv);
    const st = invoiceCobro(db, inv, today);
    if (counts) total = r2(total + st.pendiente);
    rows.push({ ...inv, counts, ...st });
    if (counts && st.pendiente > 0.0049) {
      const due = st.due_date;
      if (!oldest || due < oldest.due_date) {
        oldest = { invoice_id: inv.id, invoice_number: inv.invoice_number, due_date: due,
                   pendiente: st.pendiente, dias_vencida: st.dias_vencida, estado: st.estado };
      }
    }
  }
  return { total: r2(total), oldest, invoices: rows };
}

// Torre de control de cobros: TODAS las deudas vivas de TODOS los clientes.
// Reutiliza clientDebt (no duplica lógica): total global = Σ de lo que debe cada
// cliente uno a uno; filas = facturas que cuentan como deuda y con pendiente>0
// (las anuladas/sustituidas/abono ya quedan fuera por countsAsReceivable). Orden:
// la más vencida arriba.
export function openDebts(db, today) {
  const clientIds = db.prepare('SELECT DISTINCT client_id FROM invoices WHERE client_id IS NOT NULL').all().map(r => r.client_id);
  let total = 0;
  const rows = [];
  for (const cid of clientIds) {
    const d = clientDebt(db, cid, today);          // mismo cálculo que la ficha de cliente
    total = r2(total + d.total);
    const cl = db.prepare('SELECT name FROM clients WHERE id=?').get(cid);
    const clientName = cl ? cl.name : '—';
    for (const inv of d.invoices) {
      if (inv.counts && inv.pendiente > 0.0049) {
        rows.push({
          client_id: cid, client_name: clientName,
          invoice_id: inv.id, invoice_number: inv.invoice_number,
          due_date: inv.due_date, pendiente: inv.pendiente,
          estado: inv.estado, dias_vencida: inv.dias_vencida, tramo: inv.tramo,
        });
      }
    }
  }
  // Más vencida arriba (más días vencida primero; a igualdad, vencimiento más antiguo).
  rows.sort((a, b) => (b.dias_vencida - a.dias_vencida) || String(a.due_date || '').localeCompare(String(b.due_date || '')));
  return { total: r2(total), rows };
}

// Etiquetas legibles para el estado (UI).
export const ESTADO_LABEL = {
  pendiente: 'Pendiente', parcial: 'Cobrada en parte', cobrada: 'Cobrada',
  vencida: 'Vencida', abono: 'Abono',
};
export const ESTADO_BADGE = {
  pendiente: 'b-yellow', parcial: 'b-blue', cobrada: 'b-green',
  vencida: 'b-red', abono: 'b-gray',
};

// ════════════════════════════════════════════════════════════════════════════
// T4 Paso 2 — PIPELINE DE COBROS: perfiles + próxima acción + priorización.
// Amplía el motor de Paso 1 (no lo rehace): el estado de cobro sigue calculándose
// en vivo arriba; aquí se decide QUÉ HACER con cada deuda según el perfil del cliente.
// Nada se envía solo: la próxima acción es una PROPUESTA; el envío es confirm-first.
// ════════════════════════════════════════════════════════════════════════════

// Cadencias por perfil: días de retraso (dpd, respecto al vencimiento) a los que toca
// cada paso. La etapa "por_vencer" (aún no vencida) es informativa, sin acción. El perfil
// 'manual' no propone nada (DISA solo informa). Las cadencias van FIJAS en MVP.
export const CADENCIAS = {
  suave:    { r1: 7,  r2: 21, firme: 45, en_riesgo: 90 },
  estandar: { r1: 3,  r2: 15, firme: 30, en_riesgo: 60 },
  firme:    { r1: 1,  r2: 7,  firme: 15, en_riesgo: 30 },
  manual:   null,
};
export const PROFILE_LABELS = { suave: 'Suave', estandar: 'Estándar', firme: 'Firme', manual: 'Manual' };

// Pasos de la cadencia en orden, con su tono por defecto. El tono sube de nivel por paso
// (y un nivel más si hay promesa incumplida). Los tonos mapean a plantillas de email.
const TONOS = ['amable', 'firme-medio', 'formal', 'ultima'];
const CADENCE_STEPS = [
  { key: 'r1',        tonoIdx: 0 },
  { key: 'r2',        tonoIdx: 1 },
  { key: 'firme',     tonoIdx: 2 },
  { key: 'en_riesgo', tonoIdx: 3 },
];
function bumpTono(tono) {
  const i = TONOS.indexOf(tono);
  return TONOS[Math.min((i < 0 ? 0 : i) + 1, TONOS.length - 1)];
}
function stageTono(stage) {
  const s = CADENCE_STEPS.find(s => s.key === stage);
  return TONOS[s ? s.tonoIdx : 0];
}

// Urgencia de cada etapa para ordenar el pipeline (mayor = más arriba).
export const STAGE_ORDER = {
  en_riesgo: 5, firme: 4, r2: 3, r1: 2, promesa: 1, por_vencer: 0, manual: -1,
};
export const STAGE_LABEL = {
  por_vencer: 'Por vencer', r1: '1er recordatorio', r2: '2º recordatorio',
  firme: 'Aviso formal', en_riesgo: 'En riesgo', promesa: 'Promesa de pago',
  manual: 'Manual', sin_pasos: 'Gestionada',
};

function daysPastDue(due, today) {
  return due ? daysBetween(today, due) : 0;   // >0 = vencida hace N días
}

// Acciones activas de una factura (log que lee el motor de próxima acción).
export function activeActions(db, invoiceId) {
  return db.prepare(
    'SELECT * FROM collection_actions WHERE invoice_id=? AND active=1 ORDER BY created_at, id'
  ).all(invoiceId);
}

// ¿Está ya hecho este paso de la cadencia? Un recordatorio_email o un contacto_manual
// registrado CON esa etapa marca el peldaño como cubierto (no se repite).
function stepDone(log, stepKey) {
  return log.some(a => (a.type === 'recordatorio_email' || a.type === 'contacto_manual') && a.stage === stepKey);
}

// La promesa de pago VIVA = la promesa_pago activa más reciente (la última gobierna).
function lastPromise(log) {
  const proms = log.filter(a => a.type === 'promesa_pago' && a.promised_date);
  return proms.length ? proms[proms.length - 1] : null;
}

// ── Próxima acción de UNA deuda ────────────────────────────────────────────
// factura: fila de invoice + estado de cobro (total, pendiente, due_date, counts).
// cliente: { collections_profile }. accionesLog: collection_actions activas. hoy: ISO.
// Devuelve { etapa, accion, fechaObjetivo, tono, motivo } | null.
//   accion ∈ { 'recordatorio_email', null }. null = nada que proponer (informativo).
export function calcularProximaAccion(factura, cliente, accionesLog, hoy) {
  const log = accionesLog || [];
  const pendiente = Number(factura.pendiente != null ? factura.pendiente : (factura.total || 0));
  const counts = factura.counts !== undefined ? factura.counts : true;

  // 1) Cobrada / sin deuda / no computa (anulada, sustituida, abono) → nada.
  if (!counts || pendiente <= 0.0049 || factura.estado === 'cobrada' || factura.estado === 'abono') return null;

  // 2) Perfil manual → DISA solo informa.
  const profile = (cliente && cliente.collections_profile) || 'estandar';
  const cad = CADENCIAS[profile];
  if (profile === 'manual' || !cad) {
    return { etapa: 'manual', accion: null, fechaObjetivo: null, tono: null,
             motivo: 'Perfil manual: lo gestionas tú' };
  }

  const due = factura.due_date || factura.issue_date;
  const dpd = daysPastDue(due, hoy);

  // 3/4) Promesa de pago.
  const prom = lastPromise(log);
  let promesaIncumplida = false;
  if (prom) {
    if (prom.promised_date >= hoy) {
      return { etapa: 'promesa', accion: null, fechaObjetivo: prom.promised_date, tono: null,
               motivo: 'Promesa de pago hasta ' + prom.promised_date + ' (no se reclama hasta esa fecha)' };
    }
    promesaIncumplida = true;   // promised_date < hoy e impagada → reanuda cadencia, sube el tono.
  }

  // 5) Resto → siguiente paso de cadencia cuyo umbral ya pasó y aún no esté en el log.
  let next = null;
  for (const step of CADENCE_STEPS) {
    if (dpd >= cad[step.key] && !stepDone(log, step.key)) { next = step; break; }
  }

  if (!next) {
    // No hay ningún paso accionable AHORA. ¿Queda algún peldaño pendiente (futuro)?
    const upcoming = CADENCE_STEPS.find(s => !stepDone(log, s.key));
    if (upcoming) {
      const fechaObjetivo = due ? addDays(due, cad[upcoming.key]) : null;
      const motivo = dpd > 0
        ? 'Vencida hace ' + dpd + ' día' + (dpd === 1 ? '' : 's') + '; siguiente recordatorio el ' + (fechaObjetivo || '-')
        : 'Aún no ha vencido (vence ' + (due || '-') + ')';
      return { etapa: 'por_vencer', accion: null, fechaObjetivo, tono: null, motivo };
    }
    // Todos los pasos hechos y sigue pendiente → sin más automático.
    return { etapa: 'sin_pasos', accion: null, fechaObjetivo: due, tono: null,
             motivo: 'Ya contactado en todos los pasos; sin más automático' };
  }

  let tono = TONOS[next.tonoIdx];
  if (promesaIncumplida) tono = bumpTono(tono);
  const fechaObjetivo = due ? addDays(due, cad[next.key]) : null;
  const stageLbl = STAGE_LABEL[next.key] || next.key;
  const motivo = (promesaIncumplida ? 'Promesa incumplida — ' : '')
    + stageLbl + ' (vencida hace ' + dpd + ' día' + (dpd === 1 ? '' : 's') + ')';

  return { etapa: next.key, accion: 'recordatorio_email', fechaObjetivo, tono, motivo };
}

function addDays(iso, n) {
  const d = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// ── Priorización EXPLICABLE del pipeline ────────────────────────────────────
// Orden: urgencia de etapa → días vencida desc → importe (pendiente) desc.
// Añade un .motivo de texto por item (por qué está donde está).
export function priorizarCobros(items) {
  const rank = it => STAGE_ORDER[it.proximaAccion ? it.proximaAccion.etapa : 'por_vencer'] ?? 0;
  const out = items.slice().sort((a, b) => {
    const r = rank(b) - rank(a);
    if (r) return r;
    const dv = (b.dias_vencida || 0) - (a.dias_vencida || 0);
    if (dv) return dv;
    return (b.pendiente || 0) - (a.pendiente || 0);
  });
  return out.map(it => {
    const pa = it.proximaAccion;
    const dv = it.dias_vencida || 0;
    const etapaLbl = pa ? (STAGE_LABEL[pa.etapa] || pa.etapa) : 'Por vencer';
    let motivo;
    if (pa && pa.etapa === 'promesa') motivo = 'Promesa de pago en curso — no reclamar todavía';
    else if (pa && pa.etapa === 'manual') motivo = 'Perfil manual — gestión a tu criterio';
    else if (dv > 0) motivo = etapaLbl + ': vencida ' + dv + ' día' + (dv === 1 ? '' : 's')
      + ', ' + Number(it.pendiente || 0).toFixed(2) + ' pendiente';
    else motivo = etapaLbl + ': ' + Number(it.pendiente || 0).toFixed(2) + ' pendiente, aún no vencida';
    return { ...it, motivo };
  });
}

// ── Worklist priorizado para la TORRE DE CONTROL (sección Cobros) ───────────
// Reutiliza openDebts (Paso 1): cada deuda viva se enriquece con perfil + próxima
// acción + motivo, y se ordena con priorizarCobros. Una sola fuente de verdad para
// las tres superficies.
export function collectionsWorklist(db, today) {
  const base = openDebts(db, today);
  const items = base.rows.map(r => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(r.invoice_id);
    const client = r.client_id ? db.prepare('SELECT collections_profile FROM clients WHERE id=?').get(r.client_id) : null;
    const log = activeActions(db, r.invoice_id);
    const proximaAccion = calcularProximaAccion(
      { ...inv, pendiente: r.pendiente, estado: r.estado, counts: true }, client, log, today
    );
    return {
      ...r,
      collections_profile: (client && client.collections_profile) || 'estandar',
      proximaAccion,
    };
  });
  return { total: base.total, rows: priorizarCobros(items) };
}

// Próxima acción de UNA factura (para el listado de facturas y la ficha de cliente).
// Devuelve null si no es deuda viva.
export function invoiceProximaAccion(db, inv, today) {
  if (!countsAsReceivable(db, inv)) return null;
  const st = invoiceCobro(db, inv, today);
  if (st.pendiente <= 0.0049 || st.estado === 'abono') return null;
  const client = inv.client_id ? db.prepare('SELECT collections_profile FROM clients WHERE id=?').get(inv.client_id) : null;
  const log = activeActions(db, inv.id);
  return calcularProximaAccion({ ...inv, pendiente: st.pendiente, estado: st.estado, counts: true }, client, log, today);
}

// ── Plantillas de email por tono (español, server-side, remitente = el autónomo) ──
// Precargadas en el modal de confirmación; el usuario las ve y puede editar antes de
// enviar. Devuelve { subject, html, text }. Nada se envía aquí: solo construye.
// El TEXTO ya no vive aquí: vive en el catálogo de plantillas (email-templates.js), como dato con
// huecos, para que el dueño pueda reescribirlo desde Ajustes. Esta función se queda con su firma de
// siempre y hace lo de siempre — solo que ahora le pregunta al catálogo cuál es la plantilla EN VIGOR
// (la editada, si la hay; si no, la de fábrica). `db` es opcional: sin él manda la de fábrica.
export function collectionEmail(tono, ctx) {
  const { inv, client, cobro, company, db } = ctx;
  const sym = (company && company.currency_symbol) || '€';
  const pend = Number((cobro && cobro.pendiente) != null ? cobro.pendiente : inv.total || 0).toFixed(2);
  const vars = {
    cliente: (client && client.name) || 'cliente',
    factura: inv.invoice_number || '',
    importe: sym + pend,
    vencimiento: inv.due_date || inv.issue_date || '',
    empresa: (company && company.company_name) || 'Nosotros',
  };
  return db ? renderEmail(db, 'cobro_factura', tono, vars)
            : renderEmailFabrica('cobro_factura', tono, vars);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ── SERVICIO DE ESCRITURA — única vía validada para registrar una acción de cobro ──
// La usan TANTO el endpoint HTTP COMO DISA (DISA no hace INSERT directo: pasa por aquí,
// con confirmación previa). Reutiliza el doble seguro de Paso 1 (isCobrable): rechaza
// con error.status=400 sobre factura no viva. Para recordatorio_email ENVÍA por Resend
// (función inyectada opts.sendEmail → mock en test) y registra. Nada se borra.
export async function registerCollectionAction(db, invoiceId, input, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const now = opts.now || new Date().toISOString();

  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  if (!inv) { const e = new Error('Factura no encontrada'); e.status = 404; throw e; }
  if (!isCobrable(db, inv)) {
    const e = new Error('Esta factura no admite gestión de cobro (anulada, abono o sustituida por una rectificativa)');
    e.status = 400; throw e;
  }

  const { type, channel, note, promised_date } = input;
  const cobro = invoiceCobro(db, inv, today);
  const client = inv.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id) : null;
  const log = activeActions(db, invoiceId);
  const prox = calcularProximaAccion({ ...inv, pendiente: cobro.pendiente, estado: cobro.estado, counts: true }, client, log, today);
  const stage = (prox && prox.etapa) || 'por_vencer';

  let emailInfo = null;
  if (type === 'recordatorio_email') {
    if (!client || !client.email) { const e = new Error('El cliente no tiene email para enviarle el recordatorio'); e.status = 400; throw e; }
    if (typeof opts.sendEmail !== 'function') { const e = new Error('El envío de email no está configurado'); e.status = 500; throw e; }
    const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
    const tono = (prox && prox.tono) || stageTono(stage);
    const tpl = collectionEmail(tono, { inv, client, cobro, company, db });
    // El usuario puede haber editado asunto/cuerpo en el modal: si llegan, mandan.
    const subject = input.email_subject || tpl.subject;
    const text = input.email_text || tpl.text;
    const html = input.email_html || (input.email_text ? null : tpl.html);
    const empresa = company.company_name || 'Bamburu';
    const payload = {
      from: empresa + ' <noreply@bamburu.com>',     // dominio verificado; el nombre es el del autónomo
      to: client.email,
      subject,
      ...(html ? { html } : {}),
      text,
    };
    if (company.email) payload.replyTo = company.email;   // las respuestas van al autónomo
    const { data, error } = await opts.sendEmail(payload);
    if (error) { const e = new Error('No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde.'); e.status = 502; throw e; }   // U3: sin volcar el objeto de Resend
    emailInfo = { sent: true, to: client.email, subject, id: data && data.id };
  }

  const res = db.prepare(
    'INSERT INTO collection_actions (invoice_id, client_id, type, channel, stage, note, promised_date, created_at, active) VALUES (?,?,?,?,?,?,?,?,1)'
  ).run(
    invoiceId, inv.client_id || null, type, channel || null, stage, note || null,
    (type === 'promesa_pago' ? (promised_date || null) : null), now
  );

  return { id: res.lastInsertRowid, stage, type, email: emailInfo, invoice_number: inv.invoice_number };
}

// Historial corto de acciones de cobro de una factura (para la ficha de cliente).
export function invoiceActionHistory(db, invoiceId) {
  return db.prepare(
    'SELECT id, type, channel, stage, note, promised_date, created_at FROM collection_actions WHERE invoice_id=? AND active=1 ORDER BY created_at DESC, id DESC'
  ).all(invoiceId);
}

// ════════════════════════════════════════════════════════════════════════════
// T4 Paso 2.1 — GESTIÓN A NIVEL DE CUENTA del cliente (toda su deuda viva a la vez).
// La factura es el documento legal; la cuenta es la suma de deuda viva. Conviven: esto
// añade la vía de cuenta REUTILIZANDO el motor (clientDebt, próxima acción, priorización),
// el cobro de Paso 1 (invoice_payments) y las plantillas/Resend de Paso 2. Nada se rehace.
// ════════════════════════════════════════════════════════════════════════════

const cents = n => Math.round(Number(n || 0) * 100);

// Inserts compartidos (con la columna aditiva account_batch_id, NULL en gestión normal).
function insertCollectionActionRow(db, r) {
  return db.prepare(
    'INSERT INTO collection_actions (invoice_id, client_id, type, channel, stage, note, promised_date, created_at, active, account_batch_id) VALUES (?,?,?,?,?,?,?,?,1,?)'
  ).run(r.invoice_id, r.client_id || null, r.type, r.channel || null, r.stage || null,
        r.note || null, r.promised_date || null, r.created_at, r.account_batch_id || null);
}
function insertPaymentRow(db, r) {
  return db.prepare(
    'INSERT INTO invoice_payments (invoice_id, amount, paid_date, payment_method, note, account_batch_id) VALUES (?,?,?,?,?,?)'
  ).run(r.invoice_id, r.amount, r.paid_date, r.payment_method || '', r.note || '', r.account_batch_id || null);
}

// Resumen de CUENTA: deuda total viva + facturas vivas (priorizadas), con la etapa y la
// próxima acción HEREDADAS de la factura MÁS GRAVE (primera por priorizarCobros). El
// perfil de cuenta es el del cliente (ya es a nivel cliente).
export function resumenCuentaCliente(db, clientId, today) {
  const debt = clientDebt(db, clientId, today);   // total, oldest, invoices[] (con estado de cobro)
  const cl = db.prepare('SELECT collections_profile, name, email FROM clients WHERE id=?').get(clientId) || {};
  const vivas = [];
  for (const inv of debt.invoices) {
    if (inv.counts && inv.pendiente > 0.0049) {
      const full = db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id);
      vivas.push({
        invoice_id: inv.id, invoice_number: inv.invoice_number,
        due_date: inv.due_date, pendiente: r2(inv.pendiente),
        estado: inv.estado, dias_vencida: inv.dias_vencida, tramo: inv.tramo,
        cobrable: isCobrable(db, full),
        proximaAccion: invoiceProximaAccion(db, full, today),
      });
    }
  }
  const ordenadas = priorizarCobros(vivas);     // más grave arriba
  const masGrave = ordenadas[0] || null;
  return {
    client_id: clientId,
    client_name: cl.name || '',
    client_email: cl.email || '',
    deudaTotal: r2(debt.total),
    facturasVivas: ordenadas,
    etapaCuenta: masGrave ? (masGrave.proximaAccion ? masGrave.proximaAccion.etapa : 'por_vencer') : null,
    perfilCuenta: cl.collections_profile || 'estandar',
    proximaAccionCuenta: masGrave ? masGrave.proximaAccion : null,
  };
}

// Reparto AUTOMÁTICO de un cobro a cuenta: de la MÁS ANTIGUA a la más nueva hasta agotar
// el importe. Si sobra dinero tras saldar todo, el resto queda sin asignar (aviso); no se
// inventa una factura. Trabaja en céntimos para cuadrar SIEMPRE al céntimo.
export function repartoAutomatico(importe, facturasVivas) {
  let restante = cents(importe);
  const orden = facturasVivas.slice().sort((a, b) =>
    String(a.due_date || '').localeCompare(String(b.due_date || '')) || (a.invoice_id - b.invoice_id));
  const asignacion = [];
  for (const f of orden) {
    if (restante <= 0) break;
    const deuda = cents(f.pendiente);
    const aplica = Math.min(restante, deuda);
    if (aplica > 0) { asignacion.push({ invoice_id: f.invoice_id, importe: aplica / 100 }); restante -= aplica; }
  }
  return { asignacion, sinAsignar: restante / 100 };
}

// Valida un reparto MANUAL: ok solo si la suma == importeTotal (al céntimo) y ninguna
// factura recibe más que su deuda pendiente (ni importes negativos / facturas ajenas).
export function validarRepartoManual(asignacion, importeTotal, facturasVivas) {
  const deudaPorId = new Map(facturasVivas.map(f => [Number(f.invoice_id), cents(f.pendiente)]));
  let suma = 0;
  for (const a of (asignacion || [])) {
    const id = Number(a.invoice_id);
    const c = cents(a.importe);
    if (!deudaPorId.has(id)) return { ok: false, error: 'La factura ' + id + ' no es deuda viva del cliente' };
    if (c < 0) return { ok: false, error: 'No se permiten importes negativos' };
    if (c > deudaPorId.get(id)) return { ok: false, error: 'La factura ' + id + ' recibe más que su deuda pendiente' };
    suma += c;
  }
  const total = cents(importeTotal);
  if (suma !== total) return { ok: false, error: 'El reparto suma ' + (suma / 100).toFixed(2) + ' y debe sumar exactamente ' + (total / 100).toFixed(2) };
  return { ok: true };
}

// Plantilla de email de CUENTA (total adeudado + desglose de facturas vivas). Tono = etapa
// de la factura más grave. Editable en el modal antes de enviar (confirm-first).
export function accountEmail(tono, ctx) {
  const { client, company, facturasVivas, total, db } = ctx;
  const sym = (company && company.currency_symbol) || '€';
  // La lista de facturas es un BLOQUE que genera el sistema (el dueño no la teclea): se le ofrece como
  // hueco {{facturas}} para que la coloque donde quiera, pero el HTML de dentro lo pone Bamburu.
  const filasHtml = facturasVivas.map(f =>
    '<tr><td style="padding:4px 8px">' + escapeHtml(f.invoice_number) + '</td><td style="padding:4px 8px;color:#6b7280">vence ' + escapeHtml(f.due_date || '-') + '</td><td style="padding:4px 8px;text-align:right">' + sym + Number(f.pendiente).toFixed(2) + '</td></tr>').join('');
  const tabla = '<table style="border-collapse:collapse;width:100%;margin:12px 0;background:#f9fafb;border-radius:8px">' + filasHtml
    + '<tr><td colspan="2" style="padding:8px;font-weight:700;border-top:1px solid #e5e7eb">TOTAL ADEUDADO</td><td style="padding:8px;text-align:right;font-weight:700;border-top:1px solid #e5e7eb">'
    + sym + Number(total).toFixed(2) + '</td></tr></table>';
  const vars = {
    cliente: (client && client.name) || 'cliente',
    n_facturas: String(facturasVivas.length),
    total: sym + Number(total).toFixed(2),
    facturas: { esHtml: true, valor: tabla },
    empresa: (company && company.company_name) || 'Nosotros',
  };
  return db ? renderEmail(db, 'cobro_cuenta', tono, vars)
            : renderEmailFabrica('cobro_cuenta', tono, vars);
}

// ── SERVICIO de acción de CUENTA — única vía validada (endpoint y DISA la usan) ──────
// recordatorio_cuenta: UN email (total + desglose) + una acción registrada por factura viva.
// promesa_cuenta: promesa en todas las facturas vivas (pospone todas).
// cobro_cuenta: reparto auto/manual → un invoice_payment por factura (reusa Paso 1).
// Reutiliza el doble seguro (isCobrable): ignora/rechaza facturas no vivas.
export async function registerAccountAction(db, clientId, input, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const now = opts.now || new Date().toISOString();
  const batchId = opts.batchId || ('acct_' + now.replace(/[^0-9]/g, '').slice(0, 14) + '_' + clientId);

  const resumen = resumenCuentaCliente(db, clientId, today);
  const vivas = resumen.facturasVivas;
  if (!vivas.length) { const e = new Error('El cliente no tiene deuda viva que gestionar'); e.status = 400; throw e; }
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  const company = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const type = input.type;

  if (type === 'recordatorio_cuenta') {
    if (!client || !client.email) { const e = new Error('El cliente no tiene email'); e.status = 400; throw e; }
    if (typeof opts.sendEmail !== 'function') { const e = new Error('El envío de email no está configurado'); e.status = 500; throw e; }
    const tono = (resumen.proximaAccionCuenta && resumen.proximaAccionCuenta.tono) || stageTono(resumen.etapaCuenta || 'r1');
    const tpl = accountEmail(tono, { client, company, facturasVivas: vivas, total: resumen.deudaTotal, db });
    const subject = input.email_subject || tpl.subject;
    const text = input.email_text || tpl.text;
    const html = input.email_html || (input.email_text ? null : tpl.html);
    const empresa = company.company_name || 'Bamburu';
    const payload = { from: empresa + ' <noreply@bamburu.com>', to: client.email, subject, ...(html ? { html } : {}), text };
    if (company.email) payload.replyTo = company.email;
    const { data, error } = await opts.sendEmail(payload);   // UN solo email
    if (error) { const e = new Error('No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde.'); e.status = 502; throw e; }   // U3: sin volcar el objeto de Resend
    db.transaction(() => {
      for (const f of vivas) {
        insertCollectionActionRow(db, {
          invoice_id: f.invoice_id, client_id: clientId, type: 'recordatorio_email', channel: null,
          stage: (f.proximaAccion && f.proximaAccion.etapa) || 'por_vencer',
          note: input.note || 'Recordatorio de cuenta', promised_date: null, created_at: now, account_batch_id: batchId,
        });
      }
    })();
    return { batch_id: batchId, type, email: { sent: true, to: client.email, subject, id: data && data.id }, facturas: vivas.length };
  }

  if (type === 'promesa_cuenta') {
    if (!input.promised_date) { const e = new Error('La promesa de cuenta necesita una fecha'); e.status = 400; throw e; }
    db.transaction(() => {
      for (const f of vivas) {
        insertCollectionActionRow(db, {
          invoice_id: f.invoice_id, client_id: clientId, type: 'promesa_pago', channel: null,
          stage: (f.proximaAccion && f.proximaAccion.etapa) || 'por_vencer',
          note: input.note || 'Promesa de cuenta', promised_date: input.promised_date, created_at: now, account_batch_id: batchId,
        });
      }
    })();
    return { batch_id: batchId, type, facturas: vivas.length, promised_date: input.promised_date };
  }

  if (type === 'cobro_cuenta') {
    const importe = Number(input.importe);
    if (!(importe > 0)) { const e = new Error('Importe inválido'); e.status = 400; throw e; }
    let asignacion, sinAsignar = 0;
    if (input.modo === 'manual') {
      const v = validarRepartoManual(input.asignacion, importe, vivas);
      if (!v.ok) { const e = new Error(v.error); e.status = 400; throw e; }
      asignacion = (input.asignacion || []).filter(a => cents(a.importe) > 0)
        .map(a => ({ invoice_id: Number(a.invoice_id), importe: r2(a.importe) }));
    } else {
      const auto = repartoAutomatico(importe, vivas);
      asignacion = auto.asignacion; sinAsignar = auto.sinAsignar;
    }
    const pagos = [];
    db.transaction(() => {
      for (const a of asignacion) {
        const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(a.invoice_id);
        if (!inv || !isCobrable(db, inv)) { const e = new Error('Una de las facturas seleccionadas ya no admite cobro (anulada o sustituida).'); e.status = 400; throw e; }
        const r = insertPaymentRow(db, { invoice_id: a.invoice_id, amount: a.importe, paid_date: today, payment_method: input.payment_method || '', note: input.note || 'Cobro a cuenta', account_batch_id: batchId });
        pagos.push({ invoice_id: a.invoice_id, importe: a.importe, payment_id: r.lastInsertRowid });
      }
    })();
    return { batch_id: batchId, type, asignacion, sinAsignar: r2(sinAsignar), pagos, repartido: r2(importe - sinAsignar) };
  }

  const e = new Error('Tipo de acción de cuenta no válido'); e.status = 400; throw e;
}

// Resumen de cuentas de TODOS los clientes con deuda (para la voz de DISA): cada cliente
// con su deuda de cuenta + etapa + próxima acción de cuenta, ordenado por urgencia.
export function accountsSummary(db, today) {
  const clientIds = db.prepare('SELECT DISTINCT client_id FROM invoices WHERE client_id IS NOT NULL').all().map(r => r.client_id);
  const rows = [];
  let total = 0;
  for (const cid of clientIds) {
    const r = resumenCuentaCliente(db, cid, today);
    if (r.deudaTotal > 0.0049) {
      rows.push({
        client_id: cid, client_name: r.client_name || '—', deudaTotal: r.deudaTotal,
        facturas: r.facturasVivas.length, etapaCuenta: r.etapaCuenta,
        proximaAccionCuenta: r.proximaAccionCuenta, perfilCuenta: r.perfilCuenta,
      });
      total = r2(total + r.deudaTotal);
    }
  }
  rows.sort((a, b) => ((STAGE_ORDER[b.etapaCuenta] ?? 0) - (STAGE_ORDER[a.etapaCuenta] ?? 0)) || (b.deudaTotal - a.deudaTotal));
  return { total: r2(total), rows };
}
