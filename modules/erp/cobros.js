// T4 Paso 1 — Motor de cobros. El estado de cobro de una factura NUNCA se guarda:
// se calcula siempre en vivo desde la suma de cobros (invoice_payments) y la fecha
// de vencimiento (invoices.due_date), para que no quede desactualizado.
//
// Fuera de alcance (Paso 2): perfiles de cobro, próxima acción, DISA. Aquí solo el motor.

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
  return cobroState(inv, paymentsSum(db, inv.id), today);
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
