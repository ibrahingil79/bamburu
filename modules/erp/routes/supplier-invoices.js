import { Hono } from 'hono';
import { adminLayout, can, docShell } from '../layout.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { supplierInvoiceSchema, supplierInvoiceAnularSchema, supplierPaymentSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { supplierInvoicePago, isPayable, isRefundable, supplierDebt, ESTADO_LABEL, ESTADO_BADGE,
         liveSupplierPayables, repartoAutomaticoPago, validarRepartoManualPago } from '../pagos.js';
import { pagoModalHtml, pagoCuentaModalHtml, pagoModalScript } from '../views/pago-modal.js';
import { getVatBands } from '../../../core/vat-bands.js';

// ════════════════════════════════════════════════════════════════════════════
// FACTURA RECIBIDA (Capa de dinero con proveedores · Paso a) — documento INMUTABLE
// que genera la DEUDA con el proveedor. Espejo de la factura/cobros, al revés.
//
// Nace de DOS formas, SIEMPRE enlazada a un documento de stock de origen:
//  - AUTO desde la captura C2 (confirmCaptureSvc): con los importes reales que la
//    captura calcula (base/IVA/total CON IVA) y hoy se descartaban.
//  - MANUAL (/admin/supplier-invoices/new): la mercancía llegó antes que la factura.
// Inmutable: corregir = ANULAR (motivo) + crear otra; nunca se edita ni se borra.
// NO toca stock/WAC (solo lee) ni la cadena de hash/Verifactu (no es emisión nuestra).
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const round2 = n => Math.round(Number(n || 0) * 100) / 100;
function addDays(iso, n) {
  const d = new Date(Date.parse(iso + 'T00:00:00Z') + Number(n || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

// Resolución del documento de stock de origen: dónde vive, su estado válido y su etiqueta.
// Mismo patrón que el ORIGIN de las devoluciones a proveedor.
const ORIGIN = {
  purchase: {
    load(db, id) {
      const o = db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
      if (!o) return null;
      return { supplier_id: o.supplier_id, status: o.status, ok: o.status === 'received' && !o.archived,
               label: 'Compra #' + o.id + (o.reference ? ' · ' + o.reference : ''), date: o.date, href: '/admin/purchases/' + o.id };
    },
    eligibleSql: "SELECT p.id, p.date, p.reference FROM purchases p WHERE p.supplier_id=? AND p.status='received' AND p.archived=0 ORDER BY p.date DESC, p.id DESC",
    label: r => 'Compra #' + r.id + (r.reference ? ' · ' + r.reference : ''),
  },
  po_receipt: {
    load(db, id) {
      const r = db.prepare('SELECT por.*, po.supplier_id FROM purchase_order_receipts por JOIN purchase_orders po ON po.id=por.order_id WHERE por.id=?').get(id);
      if (!r) return null;
      return { supplier_id: r.supplier_id, status: r.status, ok: r.status === 'confirmada',
               label: 'Recepción ' + (r.receipt_number || ('#' + r.id)), date: r.date, href: '/admin/purchase-order-receipts/' + r.id };
    },
    eligibleSql: "SELECT por.id, por.date, por.receipt_number FROM purchase_order_receipts por JOIN purchase_orders po ON po.id=por.order_id WHERE po.supplier_id=? AND por.status='confirmada' ORDER BY por.date DESC, por.id DESC",
    label: r => 'Recepción ' + (r.receipt_number || ('#' + r.id)),
  },
  // Paso (c): el ABONO nace de una devolución a proveedor. Solo se usa para resolver el
  // enlace de origen en la ficha (no es elegible en el alta manual: el abono se crea solo).
  supplier_return: {
    load(db, id) {
      const r = db.prepare('SELECT * FROM supplier_returns WHERE id=?').get(id);
      if (!r) return null;
      return { supplier_id: r.supplier_id, status: r.status, ok: r.status === 'confirmada',
               label: 'Devolución ' + (r.return_number || ('#' + r.id)), date: r.date, href: '/admin/supplier-returns/' + r.id };
    },
  },
};

// Guarda de duplicado (CANON §5 — sin duplicados): una factura VIGENTE del mismo
// proveedor con el mismo número del proveedor. El número puede repetir ENTRE proveedores
// (cada uno tiene su propia numeración), por eso la guarda es por proveedor. Vacío no bloquea.
export function supplierInvoiceDuplicate(db, supplierId, number, excludeId = null) {
  const norm = String(number || '').trim();
  if (!norm) return null;
  const ex = Number(excludeId);
  return db.prepare(
    "SELECT id, internal_code FROM supplier_invoices WHERE supplier_id=? AND status='vigente' AND TRIM(supplier_invoice_number)=? AND id<>?"
  ).get(supplierId, norm, Number.isFinite(ex) ? ex : -1) || null;
}

// Categorías de gasto — lista CERRADA definida en código (fácil de ampliar). Se inyecta en
// el formulario; el servicio valida que la elegida pertenezca a la lista (no se inventan).
export const EXPENSE_CATEGORIES = [
  'Alquiler', 'Suministros', 'Servicios profesionales', 'Software y herramientas',
  'Banca y financieros', 'Marketing y publicidad', 'Transporte y vehículo',
  'Material de oficina', 'Otros',
];

// ── SERVICIO: crear una factura recibida (DOS modos) ────────────────────────
// (a) CON origen de stock: proveedor DERIVADO del origen; base/tax/total del documento de
//     mercancía. Lo usan la ruta manual del paso (a) y la captura C2 (auto).
// (b) GASTO PURO (sin origen): proveedor tecleado (supplier_id), categoría y LÍNEAS
//     (concepto/base/IVA); base/tax/total = SUMA de las líneas; foto del proveedor congelada
//     del registro vivo. NUNCA mueve stock.
// due_date = invoice_date + plazo del proveedor (en gasto, editable vía d.due_date).
// opts.onDuplicate: 'throw' (manual) | 'skip' (auto). NO abre transacción propia (seguro
// suelto y anidado dentro de la transacción de la captura).
export function createSupplierInvoiceSvc(db, d, opts = {}) {
  const isExpense = !d.entity_type;   // sin origen de stock → factura de GASTO

  // 1) Proveedor + importes (+ líneas en gasto), según el modo.
  let supplierId, base, tax, total, lines = null, dueOverride = null, category = null;
  if (isExpense) {
    supplierId = Number(d.supplier_id);
    if (!supplierId) { const e = new Error('Falta el proveedor de la factura de gasto'); e.status = 400; throw e; }
    if (!db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(supplierId)) { const e = new Error('Proveedor no encontrado'); e.status = 404; throw e; }
    lines = (d.lines || []).map(l => {
      const b = round2(l.base);
      const rate = Number(l.tax_rate) || 0;
      return { concepto: String(l.concepto || '').trim(), base: b, tax_rate: rate, cuota: round2(b * rate / 100) };
    });
    if (!lines.length) { const e = new Error('Una factura de gasto necesita al menos una línea'); e.status = 400; throw e; }
    base  = round2(lines.reduce((s, l) => s + l.base, 0));
    tax   = round2(lines.reduce((s, l) => s + l.cuota, 0));
    total = round2(base + tax);
    if (!(total > 0)) { const e = new Error('El total de la factura debe ser mayor que 0 (revisa las bases de las líneas)'); e.status = 400; throw e; }
    category = String(d.expense_category || '').trim() || null;
    if (category && !EXPENSE_CATEGORIES.includes(category)) { const e = new Error('Categoría de gasto no válida'); e.status = 400; throw e; }
    if (d.due_date) dueOverride = d.due_date;
  } else {
    const cfg = ORIGIN[d.entity_type];
    if (!cfg) { const e = new Error('Tipo de origen no válido'); e.status = 400; throw e; }
    const origin = cfg.load(db, d.entity_id);
    if (!origin) { const e = new Error('Documento de origen no encontrado'); e.status = 404; throw e; }
    if (!origin.ok) { const e = new Error('El documento de origen no es válido (necesita una compra RECIBIDA o una recepción CONFIRMADA)'); e.status = 400; throw e; }
    supplierId = origin.supplier_id;
    base  = round2(d.base != null ? d.base : 0);
    total = round2(d.total != null ? d.total : (Number(d.base || 0) + Number(d.tax || 0)));
    tax   = round2(d.tax != null ? d.tax : Math.max(0, total - base));
    if (!(total > 0)) { const e = new Error('El total de la factura debe ser mayor que 0'); e.status = 400; throw e; }
  }

  // 2) Guarda de duplicado por proveedor + número (igual en ambos modos).
  const number = String(d.supplier_invoice_number || '').trim();
  if (number) {
    const dup = supplierInvoiceDuplicate(db, supplierId, number);
    if (dup) {
      if (opts.onDuplicate === 'skip') return { skipped: true, reason: 'duplicate', existing_id: dup.id, internal_code: dup.internal_code };
      const e = new Error('Ya existe una factura vigente de este proveedor con el número "' + number + '" (' + (dup.internal_code || ('#' + dup.id)) + ')'); e.status = 409; throw e;
    }
  }

  // 3) Snapshot del proveedor + vencimiento + FRP + inserción (+ líneas en gasto).
  const s = db.prepare('SELECT name, fiscal_id, address, payment_term_days FROM suppliers WHERE id=?').get(supplierId) || {};
  const dueDate = dueOverride || addDays(d.invoice_date, s.payment_term_days || 0);
  const code = nextCode(db, 'supplier_invoice');
  const r = db.prepare(`INSERT INTO supplier_invoices
      (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status,
       supplier_name, supplier_fiscal_id, supplier_address, entity_type, entity_id, expense_category, notes)
      VALUES (?,?,?,?,?,?,?,?, 'vigente', ?,?,?,?,?,?,?)`)
    .run(supplierId, code, number, d.invoice_date, dueDate, base, tax, total,
         s.name || '', s.fiscal_id || '', s.address || '',
         isExpense ? null : d.entity_type, isExpense ? null : d.entity_id, category, d.notes || '');
  const invId = r.lastInsertRowid;
  if (lines) {
    const ins = db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)');
    for (const l of lines) ins.run(invId, l.concepto, l.base, l.tax_rate, l.cuota);
  }
  return { id: invId, internal_code: code, supplier_id: supplierId, total, due_date: dueDate, is_expense: isExpense };
}

// ── SERVICIO: anular una factura recibida (motivo obligatorio) ──────────────
// Inmutable: marca anulada + motivo; la fila queda intacta. Sale de la deuda (countsAsPayable).
// Corregir = anular y crear otra. Los pagos ya registrados se conservan.
export function anularSupplierInvoiceSvc(db, id, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  if (!inv) { const e = new Error('Factura recibida no encontrada'); e.status = 404; throw e; }
  if (inv.status === 'anulada') { const e = new Error('Esta factura ya está anulada'); e.status = 400; throw e; }
  db.prepare("UPDATE supplier_invoices SET status='anulada', anulada_motivo=? WHERE id=?").run(m, id);
  return { id, status: 'anulada' };
}

// ── SERVICIO: registrar un pago a proveedor (total o parcial) ───────────────
// ÚNICA vía de escritura de pagos (la usa el endpoint; espejo de registrar cobro).
// Doble seguro: solo facturas vivas (isPayable) y sin SOBREPAGO (no superar lo pendiente
// al céntimo). El estado de pago se calcula en vivo, no se guarda. Errores con .status.
export function registerSupplierPaymentSvc(db, id, input, opts = {}) {
  const t = opts.today || new Date().toISOString().slice(0, 10);
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  if (!inv) { const e = new Error('Factura recibida no encontrada'); e.status = 404; throw e; }
  if (!isPayable(inv)) { const e = new Error('Esta factura no admite pago (anulada o total inválido)'); e.status = 400; throw e; }
  const amount = round2(input.amount);
  if (!(amount > 0)) { const e = new Error('El importe debe ser mayor que 0'); e.status = 400; throw e; }
  const st = supplierInvoicePago(db, inv, t);
  if (Math.round(amount * 100) > Math.round(st.pendiente * 100)) {
    const e = new Error('El pago (' + amount.toFixed(2) + ') supera lo pendiente (' + st.pendiente.toFixed(2) + ')'); e.status = 400; throw e;
  }
  const res = db.prepare('INSERT INTO supplier_payments (supplier_invoice_id, amount, paid_date, payment_method, note) VALUES (?,?,?,?,?)')
    .run(id, amount, input.paid_date || t, input.payment_method || '', input.note || '');
  return { id: res.lastInsertRowid, pago: supplierInvoicePago(db, inv, t) };
}

// ── SERVICIO: PAGO A CUENTA del proveedor (saldar varias facturas de golpe) ──
// Paso (d): espejo de cobro_cuenta. Reparte input.amount entre las facturas PAGABLES vivas
// del proveedor (más antigua primero en auto, o asignacion[] en manual), insertando cada
// apunte por el MISMO registerSupplierPaymentSvc (que revalida isPayable + no-sobrepago).
// Los abonos quedan fuera (liveSupplierPayables ya los excluye). El sobrante (amount > deuda
// total) NO crea crédito: se devuelve como sinAsignar para avisar. NO mueve stock ni hash.
export function registerSupplierAccountPayment(db, supplierId, input, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const sup = db.prepare('SELECT id, name FROM suppliers WHERE id=?').get(supplierId);
  if (!sup) { const e = new Error('Proveedor no encontrado'); e.status = 404; throw e; }

  const vivas = liveSupplierPayables(db, supplierId, today);   // deuda real, más antigua primero
  if (!vivas.length) { const e = new Error('El proveedor no tiene deuda viva que pagar'); e.status = 400; throw e; }

  const importe = round2(input.amount);
  if (!(importe > 0)) { const e = new Error('El importe debe ser mayor que 0'); e.status = 400; throw e; }

  let asignacion, sinAsignar = 0;
  if (input.modo === 'manual') {
    const v = validarRepartoManualPago(input.asignacion, importe, vivas);
    if (!v.ok) { const e = new Error(v.error); e.status = 400; throw e; }
    asignacion = (input.asignacion || []).filter(a => round2(a.importe) > 0)
      .map(a => ({ supplier_invoice_id: Number(a.supplier_invoice_id), importe: round2(a.importe) }));
  } else {
    const auto = repartoAutomaticoPago(importe, vivas);
    asignacion = auto.asignacion; sinAsignar = auto.sinAsignar;
  }

  const pagos = [];
  db.transaction(() => {
    for (const a of asignacion) {
      const r = registerSupplierPaymentSvc(db, a.supplier_invoice_id, {
        amount: a.importe, paid_date: input.paid_date || today,
        payment_method: input.payment_method || '', note: input.note || 'Pago a cuenta',
      }, { today });
      pagos.push({ supplier_invoice_id: a.supplier_invoice_id, importe: a.importe, payment_id: r.id });
    }
  })();

  return {
    supplier_id: supplierId, supplier_name: sup.name,
    asignacion, sinAsignar: round2(sinAsignar), pagos, repartido: round2(importe - sinAsignar),
  };
}

// ── SERVICIO: deshacer (borrar) un pago mal metido ─────────────────────────
// Un pago a proveedor es un apunte de CAJA interno (no documento legal, no toca hash):
// corregir un pago equivocado = borrar ESE apunte, sin anular la factura entera. La
// factura recibida sigue intacta; su estado de pago se recalcula en vivo. Errores .status.
export function deleteSupplierPaymentSvc(db, invoiceId, paymentId, opts = {}) {
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(invoiceId);
  if (!inv) { const e = new Error('Factura recibida no encontrada'); e.status = 404; throw e; }
  const pay = db.prepare('SELECT * FROM supplier_payments WHERE id=? AND supplier_invoice_id=?').get(paymentId, invoiceId);
  if (!pay) { const e = new Error('Pago no encontrado en esta factura'); e.status = 404; throw e; }
  db.prepare('DELETE FROM supplier_payments WHERE id=?').run(paymentId);
  return { deleted: paymentId, amount: pay.amount, pago: supplierInvoicePago(db, inv, opts.today || new Date().toISOString().slice(0, 10)) };
}

// ════════════════════════════════════════════════════════════════════════════
// PASO (c) — ABONO de proveedor (la devolución RESTA deuda) + REEMBOLSO recibido
// ════════════════════════════════════════════════════════════════════════════

// Crea el ABONO (supplier_invoices de total NEGATIVO) que nace de una devolución CONFIRMADA.
// NO mueve stock (la devolución física ya lo hizo): es solo dinero. Líneas en negativo con
// el IVA por banda del producto (products.tax_rate). Enlazado al DEV (entity_type
// 'supplier_return'). Idempotente: como mucho UN abono vigente por devolución. Se llama
// DENTRO de la transacción de createSupplierReturnSvc (no abre transacción propia).
export function createReturnCredit(db, returnId) {
  const ret = db.prepare('SELECT * FROM supplier_returns WHERE id=?').get(returnId);
  if (!ret) { const e = new Error('Devolución no encontrada'); e.status = 404; throw e; }
  const existing = db.prepare("SELECT id, internal_code FROM supplier_invoices WHERE entity_type='supplier_return' AND entity_id=? AND status='vigente'").get(returnId);
  if (existing) return { id: existing.id, internal_code: existing.internal_code, skipped: true };

  const items = db.prepare(
    'SELECT sri.product_id, sri.quantity, sri.unit_cost, p.name AS product_name, p.tax_rate FROM supplier_return_items sri JOIN products p ON p.id=sri.product_id WHERE sri.return_id=? ORDER BY sri.id'
  ).all(returnId);
  if (!items.length) return null;   // devolución sin líneas → sin abono

  const lines = items.map(it => {
    const base = round2(-(it.quantity * it.unit_cost));    // NEGATIVO (crédito a tu favor)
    const rate = Number(it.tax_rate) || 0;                 // banda de IVA del producto
    return { concepto: it.product_name + ' (dev. ' + (ret.return_number || ('#' + returnId)) + ')', base, tax_rate: rate, cuota: round2(base * rate / 100) };
  });
  const base = round2(lines.reduce((s, l) => s + l.base, 0));
  const tax = round2(lines.reduce((s, l) => s + l.cuota, 0));
  const total = round2(base + tax);

  const sup = db.prepare('SELECT address FROM suppliers WHERE id=?').get(ret.supplier_id) || {};
  const code = nextCode(db, 'supplier_credit');   // ABP-NNNN
  const r = db.prepare(`INSERT INTO supplier_invoices
      (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status,
       supplier_name, supplier_fiscal_id, supplier_address, entity_type, entity_id, expense_category, notes)
      VALUES (?,?, '', ?,?,?,?,?, 'vigente', ?,?,?, 'supplier_return', ?, NULL, ?)`)
    .run(ret.supplier_id, code, ret.date, ret.date, base, tax, total,
         ret.supplier_name || '', ret.supplier_fiscal_id || '', sup.address || '', returnId,
         'Abono por devolución ' + (ret.return_number || ('#' + returnId)));
  const invId = r.lastInsertRowid;
  const ins = db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)');
  for (const l of lines) ins.run(invId, l.concepto, l.base, l.tax_rate, l.cuota);
  return { id: invId, internal_code: code, total };
}

// Anula el abono vigente de una devolución (lo dispara la anulación de la devolución). Si el
// abono ya tiene reembolsos registrados → 409 (deshazlos antes; mismo criterio que "deshacer
// pago" del paso a). Se llama dentro de la transacción de cancelSupplierReturnSvc.
export function anularReturnCredit(db, returnId, motivo) {
  const credit = db.prepare("SELECT * FROM supplier_invoices WHERE entity_type='supplier_return' AND entity_id=? AND status='vigente'").get(returnId);
  if (!credit) return null;
  const refunds = db.prepare('SELECT COUNT(*) n FROM supplier_payments WHERE supplier_invoice_id=?').get(credit.id).n;
  if (refunds > 0) { const e = new Error('El abono ' + (credit.internal_code || ('#' + credit.id)) + ' ya tiene reembolsos: deshazlos antes de anular la devolución'); e.status = 409; throw e; }
  db.prepare("UPDATE supplier_invoices SET status='anulada', anulada_motivo=? WHERE id=?")
    .run('Anulada por anulación de la devolución' + (motivo ? ': ' + motivo : ''), credit.id);
  return { id: credit.id, internal_code: credit.internal_code };
}

// ── SERVICIO: registrar un REEMBOLSO recibido contra un abono ────────────────
// El proveedor te devuelve el dinero: se modela como un pago NEGATIVO que lleva el crédito
// pendiente a 0. input.amount es POSITIVO (lo que te reembolsan); se guarda en negativo.
// Doble seguro: solo abonos vivos (isRefundable) y sin sobrepasar el crédito pendiente.
export function registerSupplierRefundSvc(db, id, input, opts = {}) {
  const t = opts.today || new Date().toISOString().slice(0, 10);
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  if (!inv) { const e = new Error('Factura recibida no encontrada'); e.status = 404; throw e; }
  if (!isRefundable(inv)) { const e = new Error('Esta factura no admite reembolso (no es un abono vivo)'); e.status = 400; throw e; }
  const amount = round2(input.amount);
  if (!(amount > 0)) { const e = new Error('El importe del reembolso debe ser mayor que 0'); e.status = 400; throw e; }
  const st = supplierInvoicePago(db, inv, t);
  const creditoPendiente = round2(-st.pendiente);   // crédito sin reembolsar (positivo)
  if (Math.round(amount * 100) > Math.round(creditoPendiente * 100)) {
    const e = new Error('El reembolso (' + amount.toFixed(2) + ') supera el crédito pendiente (' + creditoPendiente.toFixed(2) + ')'); e.status = 400; throw e;
  }
  const res = db.prepare('INSERT INTO supplier_payments (supplier_invoice_id, amount, paid_date, payment_method, note) VALUES (?,?,?,?,?)')
    .run(id, -amount, input.paid_date || t, input.payment_method || '', input.note || 'Reembolso recibido');
  return { id: res.lastInsertRowid, pago: supplierInvoicePago(db, inv, t) };
}

// Lectura enriquecida de una factura recibida (para la ficha y el modal de pago).
export function getSupplierInvoice(db, id, today) {
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  if (!inv) return null;
  const t = today || new Date().toISOString().slice(0, 10);
  const payments = db.prepare('SELECT * FROM supplier_payments WHERE supplier_invoice_id=? ORDER BY paid_date, id').all(id);
  const pago = supplierInvoicePago(db, inv, t);
  const cfg = ORIGIN[inv.entity_type];
  const origin = cfg ? cfg.load(db, inv.entity_id) : null;
  const items = db.prepare('SELECT * FROM supplier_invoice_items WHERE supplier_invoice_id=? ORDER BY id').all(id);
  const sup = db.prepare('SELECT payment_method FROM suppliers WHERE id=?').get(inv.supplier_id) || {};
  return { ...inv, payments, items, is_expense: !inv.entity_type, is_credit: inv.entity_type === 'supplier_return',
           pago, pagable: isPayable(inv), refundable: isRefundable(inv), origin, payment_method_default: sup.payment_method || '' };
}

// Orígenes elegibles para una factura MANUAL de un proveedor: compras recibidas +
// recepciones confirmadas, marcando las que ya tienen una factura vigente enlazada.
export function eligibleOriginsForSupplier(db, supplierId) {
  const out = [];
  for (const type of ['po_receipt', 'purchase']) {
    const cfg = ORIGIN[type];
    for (const r of db.prepare(cfg.eligibleSql).all(supplierId)) {
      const already = db.prepare("SELECT 1 FROM supplier_invoices WHERE status='vigente' AND entity_type=? AND entity_id=? LIMIT 1").get(type, r.id);
      out.push({ entity_type: type, entity_id: r.id, label: cfg.label(r), date: r.date, already_invoiced: !!already });
    }
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export function createSupplierInvoiceRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const today = () => new Date().toISOString().slice(0, 10);

  // ── API ────────────────────────────────────────────────────────────────────
  // Lista (opcional ?supplier=ID), con estado de pago en vivo.
  api.get('/', requirePerm('purchases.read'), c => {
    try {
      const supplier = parseInt(c.req.query('supplier')) || null;
      const rows = db.prepare(
        'SELECT si.*, s.name AS supplier_name FROM supplier_invoices si JOIN suppliers s ON s.id=si.supplier_id'
        + (supplier ? ' WHERE si.supplier_id=?' : '') + ' ORDER BY si.invoice_date DESC, si.id DESC'
      ).all(...(supplier ? [supplier] : []));
      const t = today();
      const out = rows.map(inv => {
        const st = supplierInvoicePago(db, inv, t);
        return { ...inv, ...st, pagable: isPayable(inv) };
      });
      return c.json(out);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // Orígenes elegibles para la creación manual (ANTES de '/:id').
  api.get('/eligible-origins', requirePerm('purchases.read'), c => {
    try {
      const sid = parseInt(c.req.query('supplier_id'));
      if (!sid) return c.json([]);
      return c.json(eligibleOriginsForSupplier(db, sid));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // Deuda viva de un proveedor (para la cabecera "Le debes X €" — superficie de cuenta).
  api.get('/supplier-debt', requirePerm('purchases.read'), c => {
    try {
      const sid = parseInt(c.req.query('supplier_id'));
      if (!sid) return c.json({ total: 0, oldest: null });
      const d = supplierDebt(db, sid, today());
      return c.json({ total: d.total, oldest: d.oldest });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  api.get('/:id', requirePerm('purchases.read'), c => {
    try {
      const inv = getSupplierInvoice(db, parseInt(c.req.param('id')), today());
      if (!inv) return c.json({ error: 'No encontrada' }, 404);
      return c.json(inv);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // Crear MANUAL.
  api.post('/', requirePerm('purchases.create'), validate(supplierInvoiceSchema), c => {
    try {
      const r = createSupplierInvoiceSvc(db, c.get('validated'), { onDuplicate: 'throw', today: today() });
      logActivity(db, c.get('session'), 'Creó factura recibida', 'supplier_invoice', r.id, r.internal_code || '');
      return c.json({ ...r, message: 'Factura recibida registrada' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // Anular.
  api.post('/:id/anular', requirePerm('purchases.create'), validate(supplierInvoiceAnularSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const r = anularSupplierInvoiceSvc(db, id, c.get('validated').motivo);
      logActivity(db, c.get('session'), 'Anuló factura recibida', 'supplier_invoice', id, c.get('validated').motivo);
      return c.json({ ...r, message: 'Factura anulada' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // ÚNICO punto de escritura de pagos a proveedor. Espejo de POST /invoices/:id/payments.
  api.post('/:id/payments', requirePerm('purchases.create'), validate(supplierPaymentSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const r = registerSupplierPaymentSvc(db, id, c.get('validated'), { today: today() });
      const inv = db.prepare('SELECT internal_code FROM supplier_invoices WHERE id=?').get(id);
      logActivity(db, c.get('session'), 'Registró pago a proveedor', 'supplier_invoice', id, `${(inv && inv.internal_code) || ('#' + id)} · ${c.get('validated').amount}`);
      return c.json(r, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 400); }
  });

  // Deshacer un pago concreto (corrige un apunte mal metido sin anular la factura).
  api.delete('/:id/payments/:pid', requirePerm('purchases.create'), c => {
    try {
      const id = parseInt(c.req.param('id')), pid = parseInt(c.req.param('pid'));
      const r = deleteSupplierPaymentSvc(db, id, pid, { today: today() });
      const inv = db.prepare('SELECT internal_code FROM supplier_invoices WHERE id=?').get(id);
      logActivity(db, c.get('session'), 'Deshizo pago a proveedor', 'supplier_invoice', id, `${(inv && inv.internal_code) || ('#' + id)} · ${r.amount}`);
      return c.json(r);
    } catch (e) { return c.json({ error: e.message }, e.status || 400); }
  });

  // Paso (c): registrar un REEMBOLSO recibido contra un abono (importe positivo en la
  // entrada; se guarda como pago negativo). Reutiliza supplierPaymentSchema (amount>0).
  api.post('/:id/refunds', requirePerm('purchases.create'), validate(supplierPaymentSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const r = registerSupplierRefundSvc(db, id, c.get('validated'), { today: today() });
      const inv = db.prepare('SELECT internal_code FROM supplier_invoices WHERE id=?').get(id);
      logActivity(db, c.get('session'), 'Registró reembolso de proveedor', 'supplier_invoice', id, `${(inv && inv.internal_code) || ('#' + id)} · ${c.get('validated').amount}`);
      return c.json(r, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 400); }
  });

  // ── Vistas ──────────────────────────────────────────────────────────────────
  const sym = () => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';

  // Lista. Con ?supplier=ID muestra la cabecera "Le debes X €" (superficie de cuenta).
  views.get('/', requirePerm('purchases.read'), c => {
    const s = sym();
    const supplierId = parseInt(c.req.query('supplier')) || null;
    const supplier = supplierId ? db.prepare('SELECT name FROM suppliers WHERE id=?').get(supplierId) : null;
    const canCreate = can(c, 'purchases.create');
    const content = `
      <div class="ph">
        <h2>Facturas recibidas${supplier ? ' · ' + esc(supplier.name) : ''}</h2>
        <div style="display:flex;gap:.5rem">
          ${supplierId ? '<a href="/admin/supplier-invoices" class="btn btn-secondary">Ver todas</a>' : ''}
          ${canCreate ? '<a href="/admin/supplier-invoices/new" class="btn btn-primary">Registrar factura</a>' : ''}
        </div>
      </div>
      ${supplierId ? `<div class="card" id="debtCard" style="margin-bottom:1rem;display:none"><div class="card-body" id="debtBox"></div></div>` : ''}
      <div class="card">
        <div class="card-head" style="gap:.5rem;flex-wrap:wrap"><h3>Documentos de deuda con proveedores</h3>
          <div style="display:flex;gap:.5rem;align-items:center;margin-left:auto">
            <select class="form-control" id="tipoFilter" style="width:auto;min-width:120px" onchange="filterRows()">
              <option value="">Todos los tipos</option>
              <option value="compra">Compra (stock)</option>
              <option value="gasto">Gasto</option>
              <option value="abono">Abono (devolución)</option>
            </select>
            <input class="search" id="searchBox" placeholder="Buscar proveedor, código o nº factura..." oninput="filterRows()">
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Código</th><th>Tipo</th><th>Proveedor</th><th>Nº factura</th><th>Fecha</th><th>Vence</th><th>Total</th><th>Estado</th><th>Pendiente</th><th></th></tr></thead>
          <tbody id="siBody"></tbody>
        </table></div>
      </div>
      ${pagoModalHtml()}
      ${pagoCuentaModalHtml()}
      <script>
      ${pagoModalScript(s)}
      const SYM = ${JSON.stringify(s)};
      const SUPPLIER_ID = ${supplierId ? supplierId : 'null'};
      const ESTADO_LABEL = ${JSON.stringify(ESTADO_LABEL)};
      const ESTADO_BADGE = ${JSON.stringify(ESTADO_BADGE)};
      let rows = [];
      async function loadList(){
        try { rows = await api('GET','/api/erp/supplier-invoices'+(SUPPLIER_ID?('?supplier='+SUPPLIER_ID):'')); } catch(e){ toast(e.message||'Error','err'); return; }
        document.getElementById('siBody').innerHTML = rows.length ? rows.map(function(r){
          const badge = r.status==='anulada' ? '<span class="badge b-gray">Anulada</span>' : '<span class="badge '+(ESTADO_BADGE[r.estado]||'')+'">'+(ESTADO_LABEL[r.estado]||r.estado)+(r.dias_vencida>0?' · '+r.dias_vencida+'d':'')+'</span>';
          const pend = r.status==='anulada' ? '—' : SYM+Number(r.pendiente||0).toFixed(2);
          const payBtn = (r.pagable && r.pendiente>0.0049) ? '<button class="btn btn-primary btn-sm" onclick="openPagos('+r.id+')">Pago</button> '
            : (r.entity_type==='supplier_return' && r.status==='vigente' && r.pendiente<-0.0049) ? '<button class="btn btn-secondary btn-sm" onclick="openPagos('+r.id+')">Reembolso</button> '
            : '';
          const esAbono = r.entity_type==='supplier_return';
          const esGasto = !r.entity_type;
          const tipo = esAbono
            ? '<span class="badge b-gray">Abono</span>'
            : esGasto
            ? '<span class="badge b-purple">Gasto</span>'+(r.expense_category?'<div style="color:var(--muted);font-size:.76rem;margin-top:2px">'+escHtml(r.expense_category)+'</div>':'')
            : '<span class="badge b-teal">Compra</span>';
          const dataTipo = esAbono?'abono':(esGasto?'gasto':'compra');
          return '<tr class="frow" data-tipo="'+dataTipo+'">'
            +'<td style="font-family:monospace;color:var(--muted)">'+escHtml(r.internal_code||'-')+'</td>'
            +'<td>'+tipo+'</td>'
            +'<td><strong>'+escHtml(r.supplier_name||'')+'</strong></td>'
            +'<td>'+escHtml(r.supplier_invoice_number||'-')+'</td>'
            +'<td>'+escHtml(r.invoice_date||'')+'</td>'
            +'<td>'+escHtml(r.due_date||'-')+'</td>'
            +'<td><strong>'+SYM+Number(r.total||0).toFixed(2)+'</strong></td>'
            +'<td>'+badge+'</td>'
            +'<td>'+pend+'</td>'
            +'<td style="text-align:right;white-space:nowrap">'+payBtn+'<a href="/admin/supplier-invoices/'+r.id+'" class="btn btn-secondary btn-sm">Ver</a></td>'
            +'</tr>';
        }).join('') : '<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--muted)">Sin facturas recibidas</td></tr>';
        filterRows();
        if(SUPPLIER_ID) loadDebt();
      }
      async function loadDebt(){
        try {
          const d = await api('GET','/api/erp/supplier-invoices/supplier-debt?supplier_id='+SUPPLIER_ID);
          const card=document.getElementById('debtCard'); const box=document.getElementById('debtBox');
          const o=d.oldest;
          const neto=Number(d.total||0);
          box.innerHTML = (neto < -0.0049
              ? 'Saldo a tu favor <strong style="font-size:1.3rem;color:var(--ok,#127a3a)">'+SYM+Math.abs(neto).toFixed(2)+'</strong>'
              : 'Le debes <strong style="font-size:1.3rem">'+SYM+neto.toFixed(2)+'</strong>')
            + (o ? ' · Deuda más antigua: <a href="/admin/supplier-invoices/'+o.supplier_invoice_id+'">'+escHtml(o.internal_code||'')+'</a> ('+SYM+Number(o.pendiente||0).toFixed(2)+', vence '+escHtml(o.due_date||'-')+(o.dias_vencida>0?' · '+o.dias_vencida+' días vencida':'')+')' : ' · sin deuda pendiente')
            + (neto > 0.0049 ? ' <button class="btn btn-primary btn-sm" style="margin-left:.75rem" onclick="openPagoCuenta('+SUPPLIER_ID+')">Pagar a cuenta</button>' : '');
          card.style.display='';
        } catch(e){}
      }
      function filterRows(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        const tipo=document.getElementById('tipoFilter').value;
        document.querySelectorAll('#siBody tr.frow').forEach(function(tr){
          const okText = tr.textContent.toLowerCase().includes(q);
          const okTipo = !tipo || tr.getAttribute('data-tipo')===tipo;
          tr.style.display = (okText && okTipo) ? '' : 'none';
        });
      }
      window.pagoOnSaved = function(){ loadList(); };
      loadList();
      </script>`;
    return c.html(adminLayout('Facturas recibidas', content, 'supplier-invoices', c.get('session')?.csrfToken || '', c));
  });

  // Creación MANUAL — DOS modos: factura de compra (enlazada a stock, paso a) o factura de
  // gasto (sin mercancía, paso b: proveedor directo + categoría + líneas con IVA por tipo).
  views.get('/new', requirePerm('purchases.create'), c => {
    const s = sym();
    const t = today();
    const cfg = db.prepare('SELECT country FROM company_config WHERE id=1').get() || {};
    const bands = getVatBands((cfg.country || 'ES').toUpperCase());   // [{code,label,rate}]
    const suppliers = db.prepare('SELECT id,name FROM suppliers WHERE active=1 ORDER BY name').all();
    const supOptions = suppliers.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
    const catOptions = EXPENSE_CATEGORIES.map(x => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('');
    const content = `
      <div class="ph"><h2>Registrar factura recibida</h2><a href="/admin/supplier-invoices" class="btn btn-secondary">Volver</a></div>

      <div class="card" style="max-width:760px;margin-bottom:1rem"><div class="card-body" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        <span style="color:var(--text2)">Tipo de factura:</span>
        <button id="btnModeCompra" class="btn btn-primary btn-sm" onclick="setMode('compra')">Factura de compra (enlazar a mercancía)</button>
        <button id="btnModeGasto" class="btn btn-secondary btn-sm" onclick="setMode('gasto')">Factura de gasto (sin mercancía)</button>
      </div></div>

      <!-- ── MODO COMPRA (paso a, intacto) ── -->
      <div class="card" id="modeCompra" style="max-width:760px">
        <div class="card-body">
          <p style="color:var(--text2);margin-bottom:1rem">Para cuando la mercancía llegó antes que la factura. Se enlaza a una <strong>compra recibida</strong> o <strong>recepción confirmada</strong> de stock ya existente.</p>
          ${suppliers.length ? '' : '<div class="alert alert-warn">No hay proveedores. <a href="/admin/suppliers">Crea uno primero.</a></div>'}
          <div class="form-row">
            <div class="form-group"><label class="form-label">Proveedor *</label><select class="form-control" id="fSupplier" onchange="loadOrigins()"><option value="">— Elige —</option>${supOptions}</select></div>
            <div class="form-group"><label class="form-label">Documento de origen *</label><select class="form-control" id="fOrigin"><option value="">— Elige proveedor primero —</option></select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nº factura del proveedor</label><input class="form-control" id="fNumber" placeholder="(el que pone la factura)"></div>
            <div class="form-group"><label class="form-label">Fecha de factura *</label><input class="form-control" type="date" id="fDate" value="${t}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Base imponible</label><input class="form-control" type="number" step="0.01" min="0" id="fBase" value="0" oninput="syncTotal()"></div>
            <div class="form-group"><label class="form-label">IVA</label><input class="form-control" type="number" step="0.01" min="0" id="fTax" value="0" oninput="syncTotal()"></div>
            <div class="form-group"><label class="form-label">Total (con IVA) *</label><input class="form-control" type="number" step="0.01" min="0.01" id="fTotal" value="0"></div>
          </div>
          <div class="form-group"><label class="form-label">Notas</label><input class="form-control" id="fNotes"></div>
          <div style="display:flex;justify-content:flex-end;gap:.5rem">
            <a href="/admin/supplier-invoices" class="btn btn-secondary">Cancelar</a>
            <button class="btn btn-primary" onclick="saveCompra()">Registrar factura</button>
          </div>
        </div>
      </div>

      <!-- ── MODO GASTO (paso b) ── -->
      <div class="card" id="modeGasto" style="max-width:880px;display:none">
        <div class="card-body">
          <p style="color:var(--text2);margin-bottom:1rem">Factura de <strong>gasto</strong> (gestoría, alquiler, software, suministros, banca…): no trae mercancía. Lleva líneas con concepto, base y tipo de IVA — el IVA soportado queda desglosado por tipo.</p>
          ${suppliers.length ? '' : '<div class="alert alert-warn">No hay proveedores. <a href="/admin/suppliers">Crea uno primero.</a></div>'}
          <div class="form-row">
            <div class="form-group" style="position:relative"><label class="form-label">Proveedor *</label>
              <input class="form-control" id="gSupSearch" autocomplete="off" placeholder="Buscar proveedor por nombre o NIF...">
              <div id="gSupSuggest" style="display:none;position:absolute;z-index:30;left:0;right:0;top:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;max-height:240px;overflow:auto;box-shadow:0 6px 16px rgba(0,0,0,.4)"></div>
              <div id="gSupPicked" style="display:none;margin-top:.35rem"></div>
            </div>
            <div class="form-group"><label class="form-label">Categoría de gasto *</label><select class="form-control" id="gCategory"><option value="">— Elige —</option>${catOptions}</select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nº factura del proveedor</label><input class="form-control" id="gNumber" placeholder="(el que pone la factura)"></div>
            <div class="form-group"><label class="form-label">Fecha de factura *</label><input class="form-control" type="date" id="gDate" value="${t}" onchange="recalcDue()"></div>
            <div class="form-group"><label class="form-label">Vencimiento</label><input class="form-control" type="date" id="gDue" value="${t}"></div>
          </div>
          <div class="card" style="margin:0 0 1rem"><div class="card-head" style="padding:.6rem 1rem"><h3 style="font-size:.95rem">Líneas (concepto · base · IVA)</h3><button class="btn btn-secondary btn-sm" onclick="addGLine()">+ Añadir línea</button></div>
            <div class="table-wrap" style="overflow:visible"><table>
              <thead><tr><th>Concepto</th><th style="width:120px">Base</th><th style="width:140px">IVA</th><th style="width:110px">Cuota</th><th style="width:40px"></th></tr></thead>
              <tbody id="gLinesBody"></tbody>
            </table></div>
          </div>
          <div class="card-body" id="gTotals" style="padding:.5rem 0"></div>
          <div class="form-group"><label class="form-label">Notas</label><input class="form-control" id="gNotes"></div>
          <div style="display:flex;justify-content:flex-end;gap:.5rem">
            <a href="/admin/supplier-invoices" class="btn btn-secondary">Cancelar</a>
            <button class="btn btn-primary" onclick="saveGasto()">Registrar factura de gasto</button>
          </div>
        </div>
      </div>

      <script>
      var SYM = ${JSON.stringify(s)};
      var BANDS = ${JSON.stringify(bands)};
      // Banda por defecto de una línea nueva: la general (mayor tasa); si no, la primera.
      function defaultBand(){ var g=BANDS.find(function(b){return b.code==='general';}); return g?Number(g.rate):(BANDS[0]?Number(BANDS[0].rate):21); }

      function setMode(m){
        document.getElementById('modeCompra').style.display = m==='compra'?'':'none';
        document.getElementById('modeGasto').style.display  = m==='gasto'?'':'none';
        document.getElementById('btnModeCompra').className = 'btn btn-sm '+(m==='compra'?'btn-primary':'btn-secondary');
        document.getElementById('btnModeGasto').className  = 'btn btn-sm '+(m==='gasto'?'btn-primary':'btn-secondary');
        if(m==='gasto' && !glines.length){ addGLine(); }
      }

      // ───────── MODO COMPRA (paso a) ─────────
      async function loadOrigins(){
        const sid=document.getElementById('fSupplier').value;
        const sel=document.getElementById('fOrigin');
        if(!sid){ sel.innerHTML='<option value="">— Elige proveedor primero —</option>'; return; }
        let list=[];
        try { list = await api('GET','/api/erp/supplier-invoices/eligible-origins?supplier_id='+sid); } catch(e){ toast(e.message||'Error','err'); }
        sel.innerHTML = list.length
          ? '<option value="">— Elige —</option>'+list.map(function(o){ return '<option value="'+o.entity_type+':'+o.entity_id+'">'+escHtml(o.label)+' ('+escHtml(o.date||'')+')'+(o.already_invoiced?' · ya facturada':'')+'</option>'; }).join('')
          : '<option value="">— Sin compras/recepciones de este proveedor —</option>';
      }
      function syncTotal(){
        const b=parseFloat(document.getElementById('fBase').value)||0;
        const t=parseFloat(document.getElementById('fTax').value)||0;
        if(b||t) document.getElementById('fTotal').value=(Math.round((b+t)*100)/100).toFixed(2);
      }
      async function saveCompra(){
        const origin=document.getElementById('fOrigin').value;
        if(!origin){ toast('Elige el documento de origen','err'); return; }
        const parts=origin.split(':');
        const total=parseFloat(document.getElementById('fTotal').value)||0;
        if(!(total>0)){ toast('El total debe ser mayor que 0','err'); return; }
        const date=document.getElementById('fDate').value;
        if(!date){ toast('La fecha es obligatoria','err'); return; }
        const body={
          entity_type:parts[0], entity_id:parseInt(parts[1]),
          supplier_invoice_number:document.getElementById('fNumber').value.trim(),
          invoice_date:date,
          base:parseFloat(document.getElementById('fBase').value)||0,
          tax:parseFloat(document.getElementById('fTax').value)||0,
          total:total,
          notes:document.getElementById('fNotes').value.trim()
        };
        try { const r=await api('POST','/api/erp/supplier-invoices',body); toast(r.message||'Registrada'); window.location.href='/admin/supplier-invoices/'+r.id; }
        catch(e){ toast(e.message||'Error','err'); }
      }

      // ───────── MODO GASTO (paso b) ─────────
      var gsupplier = null;   // { id, name, term }
      var glines = [];        // { uid, concepto, base, tax_rate }
      var gseq = 0;

      // Buscador de proveedor (server-side, mismo patrón que la captura C2).
      (function(){
        var inp=document.getElementById('gSupSearch'); var box=document.getElementById('gSupSuggest');
        inp.oninput=async function(){
          var q=inp.value.trim();
          if(!q){ box.style.display='none'; box.innerHTML=''; return; }
          try{
            var res=await api('GET','/api/erp/suppliers/search?q='+encodeURIComponent(q));
            if(!res.length){ box.style.display='none'; box.innerHTML=''; return; }
            box.innerHTML=res.map(function(s){ return '<div style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid var(--border)" onmousedown="event.preventDefault();pickGSup('+s.id+',&quot;'+escAttr(s.name)+'&quot;,'+(s.payment_term_days||0)+')"><strong>'+escHtml(s.name)+'</strong>'+(s.fiscal_id?' <span style="color:var(--text3);font-size:.8rem">'+escHtml(s.fiscal_id)+'</span>':'')+'</div>'; }).join('');
            box.style.display='';
          }catch(e){ box.style.display='none'; }
        };
        inp.onblur=function(){ setTimeout(function(){ box.style.display='none'; },150); };
      })();
      window.escAttr=function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); };
      window.pickGSup=function(id,name,term){
        gsupplier={ id:id, name:name, term:Number(term)||0 };
        document.getElementById('gSupSearch').value='';
        document.getElementById('gSupSuggest').style.display='none';
        var p=document.getElementById('gSupPicked');
        p.style.display=''; p.innerHTML='<span class="badge b-green">Proveedor</span> <strong>'+escHtml(name)+'</strong> <span style="color:var(--muted);font-size:.8rem">· plazo '+gsupplier.term+'d</span> <button class="btn btn-secondary btn-sm" onclick="clearGSup()">Cambiar</button>';
        recalcDue();
      };
      window.clearGSup=function(){ gsupplier=null; document.getElementById('gSupPicked').style.display='none'; };
      window.recalcDue=function(){
        var date=document.getElementById('gDate').value; if(!date) return;
        var term=gsupplier?gsupplier.term:0;
        var d=new Date(Date.parse(date+'T00:00:00Z')+term*86400000);
        document.getElementById('gDue').value=d.toISOString().slice(0,10);
      };

      window.addGLine=function(){ gseq++; glines.push({uid:gseq, concepto:'', base:0, tax_rate:defaultBand()}); renderGLines(); };
      window.gRemove=function(uid){ glines=glines.filter(function(l){return l.uid!==uid;}); renderGLines(); };
      window.gSet=function(uid,key,val){ var l=glines.find(function(x){return x.uid===uid;}); if(!l)return; if(key==='base')l.base=parseFloat(val)||0; else if(key==='tax_rate')l.tax_rate=Number(val)||0; else l[key]=val; if(key!=='concepto'){ updateGRow(uid); renderGTotals(); } };
      function renderGLines(){
        var body=document.getElementById('gLinesBody');
        if(!glines.length){ body.innerHTML='<tr><td colspan="5" style="text-align:center;padding:1rem;color:var(--text3)">Sin líneas. Usa "+ Añadir línea".</td></tr>'; renderGTotals(); return; }
        var bandOpts=function(rate){ return BANDS.map(function(b){ return '<option value="'+b.rate+'"'+(Number(b.rate)===Number(rate)?' selected':'')+'>'+escHtml(b.label)+' ('+b.rate+'%)</option>'; }).join(''); };
        body.innerHTML=glines.map(function(l){
          var cuota=Math.round(l.base*l.tax_rate)/100;
          return '<tr data-uid="'+l.uid+'">'
            +'<td><input class="form-control" value="'+escAttr(l.concepto)+'" placeholder="Concepto (p. ej. Asesoría junio)" oninput="gSet('+l.uid+',\\'concepto\\',this.value)"></td>'
            +'<td><input class="form-control" type="number" min="0" step="0.01" value="'+Number(l.base).toFixed(2)+'" oninput="gSet('+l.uid+',\\'base\\',this.value)"></td>'
            +'<td><select class="form-control" onchange="gSet('+l.uid+',\\'tax_rate\\',this.value)">'+bandOpts(l.tax_rate)+'</select></td>'
            +'<td class="gcuota" style="font-weight:600">'+cuota.toFixed(2)+' '+SYM+'</td>'
            +'<td><button class="btn btn-danger btn-sm" onclick="gRemove('+l.uid+')">×</button></td>'
            +'</tr>';
        }).join('');
        renderGTotals();
      }
      function updateGRow(uid){ var l=glines.find(function(x){return x.uid===uid;}); if(!l)return; var tr=document.querySelector('#gLinesBody tr[data-uid="'+uid+'"]'); if(tr){ var c=tr.querySelector('.gcuota'); if(c) c.textContent=(Math.round(l.base*l.tax_rate)/100).toFixed(2)+' '+SYM; } }
      window.renderGTotals=function(){
        var base=0, byRate={};
        glines.forEach(function(l){ base+=l.base; var k=String(l.tax_rate); byRate[k]=(byRate[k]||0)+l.base; });
        var iva=0, rateHtml='';
        Object.keys(byRate).sort(function(a,b){return Number(b)-Number(a);}).forEach(function(rate){
          var cuota=byRate[rate]*Number(rate)/100; iva+=cuota;
          rateHtml+='<div style="display:flex;justify-content:space-between"><span>IVA '+rate+'% sobre '+byRate[rate].toFixed(2)+'</span><span>'+cuota.toFixed(2)+' '+SYM+'</span></div>';
        });
        var total=base+iva;
        document.getElementById('gTotals').innerHTML=
          '<div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span>Base</span><strong>'+base.toFixed(2)+' '+SYM+'</strong></div>'
          +rateHtml
          +'<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:.4rem;padding-top:.4rem"><span style="font-weight:700">Total a pagar</span><strong style="font-size:1.1rem">'+total.toFixed(2)+' '+SYM+'</strong></div>';
      };
      async function saveGasto(){
        if(!gsupplier){ toast('Elige el proveedor','err'); return; }
        var category=document.getElementById('gCategory').value;
        if(!category){ toast('Elige la categoría de gasto','err'); return; }
        var date=document.getElementById('gDate').value;
        if(!date){ toast('La fecha es obligatoria','err'); return; }
        var lines=glines.filter(function(l){ return l.base>0 || (l.concepto||'').trim(); })
          .map(function(l){ return { concepto:(l.concepto||'').trim(), base:l.base, tax_rate:l.tax_rate }; });
        if(!lines.length){ toast('Añade al menos una línea con base','err'); return; }
        if(!lines.some(function(l){return l.base>0;})){ toast('Al menos una línea debe tener base > 0','err'); return; }
        var body={
          supplier_id:gsupplier.id,
          expense_category:category,
          supplier_invoice_number:document.getElementById('gNumber').value.trim(),
          invoice_date:date,
          due_date:document.getElementById('gDue').value||undefined,
          lines:lines,
          notes:document.getElementById('gNotes').value.trim()
        };
        try { var r=await api('POST','/api/erp/supplier-invoices',body); toast(r.message||'Registrada'); window.location.href='/admin/supplier-invoices/'+r.id; }
        catch(e){ toast(e.message||'Error','err'); }
      }
      </script>`;
    return c.html(adminLayout('Registrar factura recibida', content, 'supplier-invoices', c.get('session')?.csrfToken || '', c));
  });

  // Ficha del documento.
  views.get('/:id', requirePerm('purchases.read'), c => {
    const s = sym();
    const id = parseInt(c.req.param('id'));
    const inv = getSupplierInvoice(db, id, today());
    if (!inv) return c.redirect('/admin/supplier-invoices');
    const pg = inv.pago;
    const statusBadge = inv.status === 'anulada'
      ? '<span class="badge b-gray">Anulada</span>'
      : '<span class="badge ' + (ESTADO_BADGE[pg.estado] || '') + '">' + (ESTADO_LABEL[pg.estado] || pg.estado) + '</span>';
    const canCreate = can(c, 'purchases.create');
    const anuladaBlock = inv.status === 'anulada'
      ? `<div class="alert alert-warn" style="margin-bottom:1rem">Factura <strong>anulada</strong>. Motivo: ${esc(inv.anulada_motivo || '')}</div>` : '';
    const originBlock = inv.origin
      ? `<a href="${inv.origin.href}">${esc(inv.origin.label)}</a>` : '<span style="color:var(--muted)">—</span>';
    const isExpense = inv.is_expense;
    const isCredit = inv.is_credit;
    const actionBtns = (canCreate && inv.status !== 'anulada')
      ? (isCredit
          ? (inv.refundable && pg.pendiente < -0.0049 ? `<button class="btn btn-primary" onclick="openPagos(${inv.id})">Registrar reembolso recibido</button> ` : '')
          : `<button class="btn btn-primary" onclick="openPagos(${inv.id})">Registrar pago</button> <button class="btn btn-danger" onclick="anular()">Anular factura</button> `)
      : '';
    const tipoBadge = isCredit ? '<span class="badge b-purple" style="margin-left:.5rem">Abono</span>'
      : isExpense ? '<span class="badge b-purple" style="margin-left:.5rem">Gasto</span>'
      : '<span class="badge b-teal" style="margin-left:.5rem">Compra</span>';
    const linesTitle = isCredit ? 'Líneas del abono (negativas)' : 'Líneas del gasto';
    const linesBlock = (inv.items.length)
      ? `<h2 style="font-size:14px;font-weight:500;margin:0 0 8px">${linesTitle}</h2>
          <table>
            <thead><tr><th>Concepto</th><th style="text-align:right">Base</th><th>IVA</th><th style="text-align:right">Cuota</th></tr></thead>
            <tbody>${inv.items.map(it => `<tr><td>${esc(it.concepto || '—')}</td><td style="text-align:right">${s}${Number(it.base).toFixed(2)}</td><td>${Number(it.tax_rate)}%</td><td style="text-align:right">${s}${Number(it.cuota).toFixed(2)}</td></tr>`).join('')}
            <tr><td style="font-weight:700;border-top:1px solid var(--border)">Totales</td><td style="text-align:right;font-weight:700;border-top:1px solid var(--border)">${s}${Number(inv.base).toFixed(2)}</td><td style="border-top:1px solid var(--border)"></td><td style="text-align:right;font-weight:700;border-top:1px solid var(--border)">${s}${Number(inv.tax).toFixed(2)}</td></tr></tbody>
          </table>` : '';
    const paper = `
      <h1>Factura recibida ${esc(inv.internal_code || ('#' + inv.id))}${tipoBadge}</h1>
      <div class="doc-sub">${esc(inv.invoice_date)} · vence ${esc(inv.due_date || '-')}</div>
      ${anuladaBlock}
      <div class="doc-cols">
        <div>
          <div class="doc-label">Proveedor</div>
          <div><strong>${esc(inv.supplier_name || '')}</strong>${inv.supplier_fiscal_id ? ' <span style="color:var(--muted)">' + esc(inv.supplier_fiscal_id) + '</span>' : ''}</div>
          <div style="margin-top:.5rem"><div class="doc-label">Nº factura proveedor</div>${esc(inv.supplier_invoice_number || '—')}</div>
          ${isExpense
            ? `<div style="margin-top:.5rem"><div class="doc-label">Tipo</div><span class="badge b-purple">Gasto</span>${inv.expense_category ? ' · <strong>' + esc(inv.expense_category) + '</strong>' : ''}</div>`
            : `<div style="margin-top:.5rem"><div class="doc-label">Documento de origen</div>${originBlock}</div>`}
          ${inv.notes ? `<div style="margin-top:.5rem"><div class="doc-label">Notas</div>${esc(inv.notes)}</div>` : ''}
        </div>
        <div>
          <div class="doc-label">Fecha / Vencimiento</div>
          <div>${esc(inv.invoice_date)} · vence <strong>${esc(inv.due_date || '-')}</strong></div>
          <div style="margin-top:.5rem"><div class="doc-label">${isCredit ? 'Estado del abono' : 'Estado de pago'}</div>${statusBadge} ${inv.status === 'anulada' ? '' : isCredit ? `Crédito ${s}${Math.abs(Number(inv.total)).toFixed(2)} · Reembolsado ${s}${Math.abs(Number(pg.pagado)).toFixed(2)} · Pendiente <strong>${s}${Math.abs(Number(pg.pendiente)).toFixed(2)}</strong>` : `Pagado ${s}${Number(pg.pagado).toFixed(2)} · Pendiente <strong>${s}${Number(pg.pendiente).toFixed(2)}</strong>`}</div>
        </div>
      </div>
      ${linesBlock}
      <table class="doc-totals">
        <tr><td>Base</td><td>${s}${Number(inv.base).toFixed(2)}</td></tr>
        <tr><td>IVA</td><td>${s}${Number(inv.tax).toFixed(2)}</td></tr>
        <tr class="grand"><td>Total</td><td>${s}${Number(inv.total).toFixed(2)}</td></tr>
      </table>
      <h2 style="font-size:14px;font-weight:500;margin:22px 0 8px">Pagos registrados</h2>
      <table>
        <thead><tr><th>Fecha</th><th style="text-align:right">Importe</th><th>Forma</th><th>Nota</th><th></th></tr></thead>
        <tbody>${inv.payments.length ? inv.payments.map(p => `<tr><td>${esc(p.paid_date)}</td><td style="text-align:right">${s}${Number(p.amount).toFixed(2)}</td><td>${esc(p.payment_method || '—')}</td><td>${esc(p.note || '')}</td><td style="text-align:right">${canCreate ? `<button class="btn btn-secondary btn-sm" onclick="deshacerPago(${inv.id},${p.id})">Deshacer</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin pagos registrados</td></tr>'}</tbody>
      </table>`;

    const panel = `
      <div class="card"><div class="card-body">
        <div style="margin-bottom:12px">${statusBadge}</div>
        <div class="dp-row"><span class="k">Código</span><span class="v">${esc(inv.internal_code || ('#' + inv.id))}</span></div>
        <div class="dp-row"><span class="k">Proveedor</span><span class="v">${esc(inv.supplier_name || '')}</span></div>
        <div class="dp-row"><span class="k">Fecha</span><span class="v">${esc(inv.invoice_date)}</span></div>
        <div class="dp-row"><span class="k">Vencimiento</span><span class="v">${esc(inv.due_date || '-')}</span></div>
        <div class="dp-row"><span class="k">Total</span><span class="v">${s}${Number(inv.total).toFixed(2)}</span></div>
        <div class="dp-actions" style="margin-top:14px">
          ${actionBtns}
          <a href="/admin/supplier-invoices" class="btn btn-secondary">Volver</a>
        </div>
      </div></div>
      ${pagoModalHtml()}
      <script>
      ${pagoModalScript(s)}
      window.pagoOnSaved = function(){ location.reload(); };
      var INV_HAS_PAYMENTS = ${inv.payments.length};
      async function anular(){
        var aviso = 'Motivo de la anulación (mín. 3 caracteres):';
        if(INV_HAS_PAYMENTS>0) aviso = 'OJO: esta factura tiene ' + INV_HAS_PAYMENTS + ' pago(s) registrado(s). Anular la FACTURA no es lo mismo que deshacer un pago (para eso usa "Deshacer" en cada pago).\\n\\n' + aviso;
        const motivo = prompt(aviso);
        if(motivo==null) return;
        try { await api('POST','/api/erp/supplier-invoices/${inv.id}/anular',{ motivo:motivo }); toast('Factura anulada'); location.reload(); }
        catch(e){ toast(e.message||'Error','err'); }
      }
      </script>`;
    return c.html(adminLayout('Factura recibida ' + (inv.internal_code || ('#' + inv.id)), docShell(paper, panel), 'supplier-invoices', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
