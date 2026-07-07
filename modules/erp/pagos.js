// Capa de dinero con proveedores · Paso (a) — Motor de PAGOS (cuentas a pagar).
// Espejo EXACTO del motor de Cobros (cobros.js), pero del lado proveedor: en vez de
// "lo que te deben" calcula "lo que DEBES". El estado de pago de una factura recibida
// NUNCA se guarda: se calcula siempre en vivo desde la suma de pagos (supplier_payments)
// y la fecha de vencimiento (supplier_invoices.due_date), para que no quede desfasado.
//
// Fuera de alcance (pendientes b–e en TABLERO): facturas de gasto puro, devoluciones que
// restan deuda, DISA proactiva (vencimientos/voz) y el pago "por cuenta". Aquí solo el motor.

const r2 = n => Math.round(n * 100) / 100;

// Días entre dos fechas YYYY-MM-DD (a - b), en UTC para evitar saltos de zona horaria.
function daysBetween(a, b) {
  return Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

// Suma de los pagos de una factura recibida.
export function paymentsSum(db, supplierInvoiceId) {
  return r2(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM supplier_payments WHERE supplier_invoice_id=?').get(supplierInvoiceId).s);
}

// ¿Esta factura recibida cuenta como deuda con el proveedor?
//  - anulada → no cuenta.
//  - vigente → sí cuenta.
// (No hay rectificativas/abonos en el lado proveedor en el Paso (a): la factura del
//  proveedor no es emisión nuestra; corregir es anular + crear otra.)
export function countsAsPayable(inv) {
  return inv.status !== 'anulada';
}

// ¿Esta factura recibida ADMITE pago? (gate de UI y de backend) — solo facturas vivas:
//  - NO anulada
//  - total >= 0  (un ABONO de total negativo NO se paga, se reembolsa)
// Espejo de isCobrable.
export function isPayable(inv) {
  return countsAsPayable(inv) && Number(inv.total) >= 0;
}

// ¿Esta factura ADMITE reembolso recibido? (paso c) — solo ABONOS vivos (total < 0).
// Un abono nace de una devolución a proveedor; si el proveedor te devuelve el dinero, se
// registra como pago NEGATIVO que lleva el crédito pendiente a 0. El gate de importe
// (no sobrepasar |crédito|) lo aplica el endpoint, igual que isPayable + el guard de sobrepago.
export function isRefundable(inv) {
  return countsAsPayable(inv) && Number(inv.total) < 0;
}

// Estado de pago en vivo de una factura recibida, dada la suma ya pagada y la fecha de hoy.
// estado ∈ {pendiente, parcial, pagada, vencida}. Espejo de cobroState.
export function pagoState(inv, pagado, today) {
  const total     = r2(inv.total || 0);
  pagado          = r2(pagado || 0);
  const pendiente = r2(total - pagado);
  const due       = inv.due_date || inv.invoice_date;

  let estado, vencida = false, dias_vencida = 0, tramo = null;
  if (total < 0) {
    // Documento de ABONO (crédito a tu favor, p. ej. una devolución). 'pendiente' es el
    // crédito que aún NO te han reembolsado (negativo). Un reembolso es un pago negativo
    // que lo lleva a 0. Un abono NO vence. Espejo de la rama 'abono' de cobros.js.
    estado = (pendiente >= -0.0049) ? 'reembolsado' : 'abono';
  } else if (pendiente <= 0.0049) {
    estado = 'pagada';
  } else {
    estado = pagado > 0 ? 'parcial' : 'pendiente';
    if (due && daysBetween(today, due) > 0) {            // pendiente y pasada la fecha → vencida
      estado = 'vencida';
      vencida = true;
      dias_vencida = daysBetween(today, due);
      tramo = dias_vencida <= 30 ? '0-30' : dias_vencida <= 60 ? '30-60' : '+60';
    }
  }
  return { total, pagado, pendiente, estado, vencida, dias_vencida, tramo, due_date: due };
}

// Estado de pago de una factura recibida leyendo sus pagos de la BD.
export function supplierInvoicePago(db, inv, today) {
  return pagoState(inv, paymentsSum(db, inv.id), today);
}

// Resumen de deuda con UN proveedor: sus facturas (con estado de pago), el total que le
// debes y tu deuda más antigua (factura con pendiente>0 y due_date más temprana).
export function supplierDebt(db, supplierId, today) {
  const invs = db.prepare('SELECT * FROM supplier_invoices WHERE supplier_id=? ORDER BY invoice_date, id').all(supplierId);
  let total = 0;
  let oldest = null;
  const rows = [];
  for (const inv of invs) {
    const counts = countsAsPayable(inv);
    const st = supplierInvoicePago(db, inv, today);
    if (counts) total = r2(total + st.pendiente);
    rows.push({ ...inv, counts, ...st });
    if (counts && st.pendiente > 0.0049) {
      const due = st.due_date;
      if (!oldest || due < oldest.due_date) {
        oldest = { supplier_invoice_id: inv.id, internal_code: inv.internal_code,
                   supplier_invoice_number: inv.supplier_invoice_number, due_date: due,
                   pendiente: st.pendiente, dias_vencida: st.dias_vencida, estado: st.estado };
      }
    }
  }
  return { total: r2(total), oldest, invoices: rows };
}

// Torre de control de pagos: TODAS las deudas vivas con TODOS los proveedores.
// Reutiliza supplierDebt (no duplica lógica): total global = Σ de lo que debes a cada
// proveedor; filas = facturas que cuentan como deuda y con pendiente>0 (las anuladas ya
// quedan fuera por countsAsPayable). Orden: la más vencida arriba. Espejo de openDebts.
export function openPayables(db, today) {
  const supplierIds = db.prepare('SELECT DISTINCT supplier_id FROM supplier_invoices').all().map(r => r.supplier_id);
  let total = 0;
  const rows = [];
  for (const sid of supplierIds) {
    const d = supplierDebt(db, sid, today);
    total = r2(total + d.total);
    const s = db.prepare('SELECT name FROM suppliers WHERE id=?').get(sid);
    const supplierName = s ? s.name : '—';
    for (const inv of d.invoices) {
      // Incluye deudas (pendiente>0) Y abonos vivos (pendiente<0, crédito sin reembolsar):
      // así Σ(filas) cuadra con el total de cabecera. Los abonos van con dias_vencida=0
      // (no vencen) → quedan abajo en el orden "más vencida arriba".
      if (inv.counts && Math.abs(inv.pendiente) > 0.0049) {
        rows.push({
          supplier_id: sid, supplier_name: supplierName,
          supplier_invoice_id: inv.id, internal_code: inv.internal_code,
          supplier_invoice_number: inv.supplier_invoice_number,
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

// Etiquetas legibles para el estado (UI). Espejo de ESTADO_LABEL/BADGE de cobros.
export const ESTADO_LABEL = {
  pendiente: 'Pendiente', parcial: 'Pagada en parte', pagada: 'Pagada', vencida: 'Vencida',
  abono: 'Abono (a tu favor)', reembolsado: 'Reembolsado',
};
export const ESTADO_BADGE = {
  pendiente: 'b-yellow', parcial: 'b-blue', pagada: 'b-green', vencida: 'b-red',
  abono: 'b-purple', reembolsado: 'b-gray',
};

// ════════════════════════════════════════════════════════════════════════════
// Paso (d) — PAGO A CUENTA del proveedor (saldar varias facturas de golpe) + el
// índice de deuda para la voz de DISA. Espejo EXACTO de la gestión de CUENTA de
// cobros.js (repartoAutomatico / validarRepartoManual / accountsSummary), al revés.
// El reparto trabaja en CÉNTIMOS para cuadrar siempre al céntimo; cada apunte real lo
// inserta registerSupplierPaymentSvc (no se duplica la guarda de pago/sobrepago aquí).
// ════════════════════════════════════════════════════════════════════════════

const cents = n => Math.round(Number(n || 0) * 100);

// Reparto AUTOMÁTICO de un pago a cuenta: de la factura MÁS ANTIGUA a la más nueva hasta
// agotar el importe. Si sobra dinero tras saldar todo, el resto queda SIN asignar (aviso);
// no se inventa nada (igual que cobro_cuenta). facturasVivas: [{supplier_invoice_id, pendiente, due_date}].
export function repartoAutomaticoPago(importe, facturasVivas) {
  let restante = cents(importe);
  const orden = facturasVivas.slice().sort((a, b) =>
    String(a.due_date || '').localeCompare(String(b.due_date || '')) || (a.supplier_invoice_id - b.supplier_invoice_id));
  const asignacion = [];
  for (const f of orden) {
    if (restante <= 0) break;
    const deuda = cents(f.pendiente);
    const aplica = Math.min(restante, deuda);
    if (aplica > 0) { asignacion.push({ supplier_invoice_id: f.supplier_invoice_id, importe: aplica / 100 }); restante -= aplica; }
  }
  return { asignacion, sinAsignar: restante / 100 };
}

// Valida un reparto MANUAL: ok solo si la suma == importeTotal (al céntimo) y ninguna factura
// recibe más que su pendiente (ni importes negativos / facturas ajenas o no vivas).
export function validarRepartoManualPago(asignacion, importeTotal, facturasVivas) {
  const deudaPorId = new Map(facturasVivas.map(f => [Number(f.supplier_invoice_id), cents(f.pendiente)]));
  let suma = 0;
  for (const a of (asignacion || [])) {
    const id = Number(a.supplier_invoice_id);
    const c = cents(a.importe);
    if (!deudaPorId.has(id)) return { ok: false, error: 'Una de las facturas del reparto ya no es deuda viva de este proveedor.' };
    if (c < 0) return { ok: false, error: 'No se permiten importes negativos' };
    if (c > deudaPorId.get(id)) return { ok: false, error: 'Una de las facturas del reparto recibe más que su deuda pendiente.' };
    suma += c;
  }
  const total = cents(importeTotal);
  if (suma !== total) return { ok: false, error: 'El reparto suma ' + (suma / 100).toFixed(2) + ' y debe sumar exactamente ' + (total / 100).toFixed(2) };
  return { ok: true };
}

// Facturas PAGABLES vivas de un proveedor (deuda real: isPayable + pendiente>0), de más
// antigua a más nueva. Los ABONOS (total<0) quedan FUERA por isPayable (son crédito, no deuda).
// Base común del reparto a cuenta y del índice de deuda de DISA.
export function liveSupplierPayables(db, supplierId, today) {
  const d = supplierDebt(db, supplierId, today);
  return d.invoices
    .filter(inv => isPayable(inv) && inv.pendiente > 0.0049)
    .map(inv => ({
      supplier_invoice_id: inv.id, internal_code: inv.internal_code,
      supplier_invoice_number: inv.supplier_invoice_number,
      pendiente: r2(inv.pendiente), due_date: inv.due_date,
      estado: inv.estado, dias_vencida: inv.dias_vencida,
    }));
}

// Resumen de cuentas de TODOS los proveedores con deuda (para la voz de DISA): cada proveedor
// con su deuda total + sus facturas pagables vivas, ordenado por urgencia (más vencida arriba).
// Espejo de accountsSummary de cobros, lado proveedor.
export function supplierAccountsSummary(db, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const supplierIds = db.prepare('SELECT DISTINCT supplier_id FROM supplier_invoices').all().map(r => r.supplier_id);
  const rows = [];
  let total = 0;
  for (const sid of supplierIds) {
    const vivas = liveSupplierPayables(db, sid, t);
    if (!vivas.length) continue;                       // sin deuda real (o solo abonos) → fuera
    const deuda = r2(vivas.reduce((s, f) => s + f.pendiente, 0));
    const maxVencida = vivas.reduce((m, f) => Math.max(m, f.dias_vencida || 0), 0);
    const s = db.prepare('SELECT name FROM suppliers WHERE id=?').get(sid);
    rows.push({
      supplier_id: sid, supplier_name: s ? s.name : '—',
      deudaTotal: deuda, facturas: vivas.length, maxVencida, vivas,
    });
    total = r2(total + deuda);
  }
  rows.sort((a, b) => (b.maxVencida - a.maxVencida) || (b.deudaTotal - a.deudaTotal));
  return { total: r2(total), rows };
}
