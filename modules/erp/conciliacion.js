// ── CONCILIACIÓN BANCARIA · Pieza 1 — parser Norma 43 (ingesta) + motor de cruce (ingresos) ──
//
// Ingesta y cruce SEPARADOS (costura limpia para poder enchufar otra fuente —PSD2— sin abstracciones
// especulativas). Aditivo: no toca facturas, cobros ni el ledger. La conciliación es SUGERENCIA que
// el usuario confirma; el estado se deriva de bank_reconciliations.
//
// Formato verificado contra el documento oficial "Cuaderno 43 — Junio 2012" (AEB/CECA/UNACC):
// registros de 80 posiciones, tipos 11 (cabecera cuenta) / 22 (movimiento) / 23 (conceptos, ≤5) /
// 24 (equivalencia divisa) / 33 (fin cuenta) / 88 (fin fichero). Fechas AAMMDD; importes 12+2 dec.
// implícitos sin coma; signo 1=Debe/adeudo (cargo), 2=Haber/abono (ingreso).

import { createHash } from 'crypto';
import { paymentsSum, countsAsReceivable } from './cobros.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const daysBetween = (a, b) => Math.abs(Math.floor((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000));
// Normaliza para comparar concepto con nombre/NIF/nº factura (mayúsculas, sin acentos).
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fld = (line, from, to) => line.slice(from - 1, to);               // posiciones 1-indexadas
const amount14 = s => { const d = (s || '').replace(/\D/g, ''); return d ? parseInt(d, 10) / 100 : 0; };   // 12+2 implícitos
// AAMMDD → YYYY-MM-DD (año 20AA; los extractos son recientes). '000000'/blanco → null.
function dateAAMMDD(s) {
  const t = (s || '').trim();
  if (!/^\d{6}$/.test(t) || t === '000000') return null;
  return `20${t.slice(0, 2)}-${t.slice(2, 4)}-${t.slice(4, 6)}`;
}

// ── Parser puro (sin BD): texto Norma 43 → cuentas con sus movimientos ──
// Devuelve { cuentas:[{...cabecera, movimientos:[...], fin}], numRegistros, avisos, integridad }.
export function parseNorma43(text) {
  const avisos = [];
  const rawLines = String(text || '').split(/\r?\n/).filter(l => l.length > 0);
  // Norma 43 es de posición fija de 80; toleramos líneas más cortas (editores que recortan espacios)
  // rellenando a 80, pero avisamos si una línea de datos no llega a 80.
  const lines = rawLines.map(l => (l.length < 80 ? l.padEnd(80, ' ') : l));
  const cuentas = [];
  let cuenta = null, mov = null, contadosDetalle = 0, finFichero = null;

  for (const line of lines) {
    const tipo = fld(line, 1, 2);
    if (tipo === '11') {
      const claveDH = fld(line, 33, 33);
      const saldoIni = amount14(fld(line, 34, 47)) * (claveDH === '1' ? -1 : 1);   // 1=Deudor
      cuenta = {
        entity: fld(line, 3, 6).trim(), office: fld(line, 7, 10).trim(), account: fld(line, 11, 20).trim(),
        fecha_inicial: dateAAMMDD(fld(line, 21, 26)), fecha_final: dateAAMMDD(fld(line, 27, 32)),
        saldo_inicial: r2(saldoIni), divisa: fld(line, 48, 50).trim(), nombre: fld(line, 52, 77).trim(),
        movimientos: [], fin: null,
      };
      cuenta._balance = cuenta.saldo_inicial;
      cuentas.push(cuenta); mov = null; contadosDetalle++;
    } else if (tipo === '22') {
      if (!cuenta) { avisos.push('Movimiento (22) sin cabecera de cuenta (11) previa; se ignora.'); continue; }
      const claveDH = fld(line, 28, 28);
      const val = amount14(fld(line, 29, 42));
      const signed = r2(claveDH === '2' ? val : -val);           // 2=Haber/abono → +, 1=Debe/cargo → −
      cuenta._balance = r2(cuenta._balance + signed);
      mov = {
        account: `${cuenta.entity}${cuenta.office}${cuenta.account}`,
        entity_code: cuenta.entity, office_code: cuenta.office, account_number: cuenta.account,
        op_date: dateAAMMDD(fld(line, 11, 16)), value_date: dateAAMMDD(fld(line, 17, 22)),
        concept_common: fld(line, 23, 24).trim(), concept_own: fld(line, 25, 27).trim(),
        is_credit: claveDH === '2' ? 1 : 0, amount: signed, balance: cuenta._balance,
        doc_number: fld(line, 43, 52).trim(), ref1: fld(line, 53, 64).trim(), ref2: fld(line, 65, 80).trim(),
        _conceptos: [],
      };
      cuenta.movimientos.push(mov); contadosDetalle++;
    } else if (tipo === '23') {
      if (!mov) { avisos.push('Concepto (23) sin movimiento (22) previo; se ignora.'); continue; }
      if (mov._conceptos.length >= 5) { avisos.push('Más de 5 registros 23 en un movimiento (norma: máx. 5).'); }
      const c1 = fld(line, 5, 42).trim(), c2 = fld(line, 43, 80).trim();
      mov._conceptos.push([c1, c2].filter(Boolean).join(' '));
      contadosDetalle++;
    } else if (tipo === '24') {
      contadosDetalle++;   // equivalencia de divisa: se cuenta para el cuadre del 88; no altera el importe contable
    } else if (tipo === '33') {
      if (!cuenta) { avisos.push('Fin de cuenta (33) sin cabecera; se ignora.'); continue; }
      cuenta.fin = {
        n_debe: parseInt(fld(line, 21, 25).replace(/\D/g, '') || '0', 10), tot_debe: amount14(fld(line, 26, 39)),
        n_haber: parseInt(fld(line, 40, 44).replace(/\D/g, '') || '0', 10), tot_haber: amount14(fld(line, 45, 58)),
        saldo_final: amount14(fld(line, 60, 73)) * (fld(line, 59, 59) === '1' ? -1 : 1),
      };
      contadosDetalle++; cuenta = null; mov = null;
    } else if (tipo === '88') {
      finFichero = { n_registros: parseInt(fld(line, 21, 26).replace(/\D/g, '') || '0', 10) };
    } else {
      avisos.push(`Tipo de registro desconocido "${tipo}"; se ignora.`);
    }
  }

  // Concepto legible del movimiento = registros 23 concatenados (o ref2 si no hay).
  for (const cta of cuentas) for (const m of cta.movimientos) {
    m.concept = (m._conceptos.join(' ').trim()) || m.ref2 || '';
    delete m._conceptos;
    delete m.concept_own;
  }
  for (const cta of cuentas) delete cta._balance;

  // ── Integridad (Cuaderno 43): el 88 cuenta todos los registros MENOS él mismo; el 33 cuadra
  // nº y totales de debe/haber con los movimientos parseados. Mismatch → aviso (no aborta).
  const checks = [];
  if (finFichero) {
    const cuadra88 = finFichero.n_registros === contadosDetalle;
    checks.push({ check: 'reg88_conteo', ok: cuadra88, esperado: finFichero.n_registros, real: contadosDetalle });
    if (!cuadra88) avisos.push(`El reg. 88 declara ${finFichero.n_registros} registros y se contaron ${contadosDetalle}.`);
  } else {
    avisos.push('Falta el registro 88 (fin de fichero): el fichero podría estar incompleto.');
  }
  for (const cta of cuentas) {
    if (!cta.fin) { avisos.push(`Cuenta ${cta.account} sin registro 33 (fin de cuenta).`); continue; }
    const nD = cta.movimientos.filter(m => !m.is_credit).length, nH = cta.movimientos.filter(m => m.is_credit).length;
    const tD = r2(cta.movimientos.filter(m => !m.is_credit).reduce((s, m) => s - m.amount, 0));
    const tH = r2(cta.movimientos.filter(m => m.is_credit).reduce((s, m) => s + m.amount, 0));
    const okCuenta = nD === cta.fin.n_debe && nH === cta.fin.n_haber
      && Math.round(tD * 100) === Math.round(cta.fin.tot_debe * 100) && Math.round(tH * 100) === Math.round(cta.fin.tot_haber * 100);
    checks.push({ check: `reg33_cuenta_${cta.account}`, ok: okCuenta, debe: [nD, tD], haber: [nH, tH], declarado: cta.fin });
    if (!okCuenta) avisos.push(`El reg. 33 de la cuenta ${cta.account} no cuadra con los movimientos (nº/importes debe/haber).`);
  }
  const integridad = { ok: checks.every(c => c.ok) && !!finFichero, checks };
  return { cuentas, numRegistros: contadosDetalle, finFichero, avisos, integridad };
}

// Aplana todas las cuentas a una lista de movimientos, cada uno con su hash natural de deduplicación.
// El hash incluye el saldo corriente calculado: distingue movimientos idénticos (saldo distinto) y
// deduplica el mismo movimiento reimportado (saldo idéntico), también en rangos solapados.
export function movimientosConHash(parsed) {
  const out = [];
  for (const cta of parsed.cuentas) for (const m of cta.movimientos) {
    const clave = [m.account, m.op_date, m.value_date, m.amount.toFixed(2), (m.balance ?? '').toString(),
                   m.concept, m.doc_number, m.ref1, m.ref2].join('|');
    out.push({ ...m, natural_hash: createHash('sha256').update(clave, 'utf8').digest('hex') });
  }
  return out;
}

// ── Importación IDEMPOTENTE a bank_movements (INSERT OR IGNORE por natural_hash) ──
// Reimportar el mismo fichero o un rango solapado NO duplica; dos movimientos legítimamente idénticos
// (distinto saldo corriente) SÍ se guardan ambos. No toca facturas/cobros/ledger.
export function importNorma43(db, text, { sourceFile = '' } = {}) {
  const parsed = parseNorma43(text);
  const movs = movimientosConHash(parsed);
  const ins = db.prepare(`INSERT OR IGNORE INTO bank_movements
    (account, entity_code, office_code, account_number, op_date, value_date, amount, is_credit, balance,
     concept_common, concept, doc_number, ref1, ref2, natural_hash, source_file)
    VALUES (@account,@entity_code,@office_code,@account_number,@op_date,@value_date,@amount,@is_credit,@balance,
     @concept_common,@concept,@doc_number,@ref1,@ref2,@natural_hash,@source_file)`);
  let insertados = 0, duplicados = 0;
  db.transaction(() => {
    for (const m of movs) {
      const r = ins.run({ ...m, source_file: sourceFile });
      if (r.changes === 1) insertados++; else duplicados++;
    }
  })();
  return { insertados, duplicados, total: movs.length, cuentas: parsed.cuentas.length, integridad: parsed.integridad, avisos: parsed.avisos };
}

// ════════════════════════════════════════════════════════════════════════════
// MOTOR DE CRUCE (ingresos) — SUGERENCIA, no automático. Separado de la ingesta.
// ════════════════════════════════════════════════════════════════════════════

// Estado de conciliación de un movimiento, DERIVADO de bank_reconciliations (no hay columna de estado).
export function estadoMovimiento(db, movementId) {
  const rec = db.prepare('SELECT * FROM bank_reconciliations WHERE movement_id=?').get(movementId);
  if (!rec) return { estado: 'pendiente', rec: null };
  return { estado: rec.estado, rec };
}

// Pistas del concepto del movimiento: ¿aparece el nº de factura, el nombre del cliente o su NIF?
function conceptHints(conceptNorm, inv) {
  const hints = [];
  if (inv.invoice_number && conceptNorm.includes(norm(inv.invoice_number))) hints.push('nº factura');
  if (inv.client_fiscal_id && conceptNorm.includes(norm(inv.client_fiscal_id))) hints.push('NIF');
  if (inv.client_name) {
    const tokens = norm(inv.client_name).split(/\s+/).filter(t => t.length >= 4);
    if (tokens.some(t => conceptNorm.includes(t))) hints.push('nombre');
  }
  return hints;
}

// Candidatos de conciliación para UN movimiento de ABONO (ingreso). Cruza por importe (exacto o dentro
// de `toleranciaCts` céntimos) + ventana de fechas (`ventanaDias`) + pistas del concepto, contra:
//  (a) cobros YA registrados (invoice_payments) — confirmarían ese cobro;
//  (b) facturas con pendiente — sugerirían que el abono paga esa factura.
// Devuelve lista ordenada por score (mejor primero). No escribe nada.
export function sugerenciasIngreso(db, movement, { toleranciaCts = 0, ventanaDias = 5, limit = 8 } = {}) {
  if (!movement || !movement.is_credit) return [];   // los cargos son Pieza 2
  const tol = toleranciaCts / 100;
  const importe = r2(movement.amount);
  const conceptNorm = norm(movement.concept);
  const opDate = movement.op_date;
  const cand = [];

  // (a) Cobros ya registrados con importe cercano y fecha dentro de ventana.
  const pagos = db.prepare(`SELECT p.id, p.invoice_id, p.amount, p.paid_date,
      i.invoice_number, i.client_name, i.client_fiscal_id
      FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE ABS(p.amount - ?) <= ?`).all(importe, tol + 0.0001);
  for (const p of pagos) {
    if (!p.paid_date || daysBetween(opDate, p.paid_date) > ventanaDias) continue;
    const hints = conceptHints(conceptNorm, p);
    const dd = daysBetween(opDate, p.paid_date);
    const score = 100 - Math.round(Math.abs(p.amount - importe) * 100) - dd + hints.length * 25;
    cand.push({ type: 'cobro', id: p.id, invoice_id: p.invoice_id, invoice_number: p.invoice_number,
      client_name: p.client_name, amount: r2(p.amount), date: p.paid_date, hints, score });
  }

  // (b) Facturas con pendiente cuyo importe cuadra con el abono.
  const invs = db.prepare('SELECT * FROM invoices ORDER BY issue_date DESC, id DESC LIMIT 500').all();
  for (const inv of invs) {
    if (!countsAsReceivable(db, inv)) continue;
    const pend = r2(Number(inv.total) - paymentsSum(db, inv.id));
    if (pend <= 0.0049) continue;
    if (Math.abs(pend - importe) > tol + 0.0001) continue;
    const refDate = inv.issue_date || inv.due_date;
    const dd = refDate ? daysBetween(opDate, refDate) : 999;
    const hints = conceptHints(conceptNorm, inv);
    // La factura solo se sugiere si la fecha entra en una ventana amplia O hay pista de concepto
    // (una transferencia puede tardar; el concepto es la señal fuerte).
    if (dd > ventanaDias * 6 && hints.length === 0) continue;
    const score = 90 - Math.round(Math.abs(pend - importe) * 100) - Math.min(dd, 60) + hints.length * 25;
    cand.push({ type: 'factura', id: inv.id, invoice_id: inv.id, invoice_number: inv.invoice_number,
      client_name: inv.client_name, amount: pend, date: refDate, hints, score });
  }

  cand.sort((a, b) => b.score - a.score);
  return cand.slice(0, limit);
}

// ════════════════════════════════════════════════════════════════════════════
// ACCIONES — todas por confirmación del usuario. Nada auto-escribe salvo el cobro de la Decisión 1
// (que reutiliza invoice_payments y va gateado por cobros.manage a nivel de ruta). Reversible.
// ════════════════════════════════════════════════════════════════════════════

const getMov = (db, id) => db.prepare('SELECT * FROM bank_movements WHERE id=?').get(id);
function assertPendiente(db, movementId) {
  const m = getMov(db, movementId);
  if (!m) { const e = new Error('Movimiento no encontrado'); e.status = 404; throw e; }
  if (db.prepare('SELECT 1 FROM bank_reconciliations WHERE movement_id=?').get(movementId)) {
    const e = new Error('El movimiento ya tiene un estado de conciliación; deshaz primero.'); e.status = 409; throw e;
  }
  return m;
}
const insRec = db => db.prepare(`INSERT INTO bank_reconciliations
  (movement_id, estado, target_type, target_id, created_payment_id, reconciled_by) VALUES (?,?,?,?,?,?)`);

// Enlaza el movimiento a un cobro (invoice_payment) YA existente. No crea nada.
export function conciliarConCobro(db, movementId, paymentId, { by = '' } = {}) {
  assertPendiente(db, movementId);
  const pay = db.prepare('SELECT id FROM invoice_payments WHERE id=?').get(paymentId);
  if (!pay) { const e = new Error('Cobro no encontrado'); e.status = 404; throw e; }
  insRec(db).run(movementId, 'conciliado', 'invoice_payment', paymentId, null, by);
  return estadoMovimiento(db, movementId);
}

// ¿La factura ya tiene un cobro que cuadra con el importe y que NO está enlazado a otro movimiento?
function cobroLibreQueCuadra(db, invoiceId, importe) {
  const pagos = db.prepare('SELECT id, amount FROM invoice_payments WHERE invoice_id=?').all(invoiceId);
  for (const p of pagos) {
    if (Math.abs(p.amount - importe) > 0.0049) continue;
    const usado = db.prepare("SELECT 1 FROM bank_reconciliations WHERE target_type='invoice_payment' AND target_id=?").get(p.id);
    if (!usado) return p;
  }
  return null;
}

// Concilia el movimiento contra una FACTURA. Decisión 1:
//  - si la factura ya tiene un cobro que cuadra (sin enlazar) → solo ENLAZA (no duplica cobro);
//  - si no, y registrarCobro=true → REGISTRA el cobro (reutiliza invoice_payments) con confirmación y
//    lo marca created_payment_id (para el aviso al deshacer);
//  - si registrarCobro=false → enlaza a la factura de forma informativa (sin crear cobro).
// registrarCobro debe venir de una ruta con permiso cobros.manage.
export function conciliarConFactura(db, movementId, invoiceId, { by = '', registrarCobro = false, payment_method = 'transferencia' } = {}) {
  const mov = assertPendiente(db, movementId);
  const inv = db.prepare('SELECT id, total FROM invoices WHERE id=?').get(invoiceId);
  if (!inv) { const e = new Error('Factura no encontrada'); e.status = 404; throw e; }
  const importe = r2(mov.amount);

  const libre = cobroLibreQueCuadra(db, invoiceId, importe);
  if (libre) { insRec(db).run(movementId, 'conciliado', 'invoice_payment', libre.id, null, by); return { ...estadoMovimiento(db, movementId), cobroCreado: false, enlazadoACobroExistente: true }; }

  if (registrarCobro) {
    const res = db.prepare('INSERT INTO invoice_payments (invoice_id, amount, paid_date, payment_method, note) VALUES (?,?,?,?,?)')
      .run(invoiceId, importe, mov.op_date, payment_method, `Conciliación bancaria (mov #${movementId})`);
    const paymentId = res.lastInsertRowid;
    insRec(db).run(movementId, 'conciliado', 'invoice_payment', paymentId, paymentId, by);
    return { ...estadoMovimiento(db, movementId), cobroCreado: true, payment_id: paymentId };
  }
  insRec(db).run(movementId, 'conciliado', 'invoice', invoiceId, null, by);
  return { ...estadoMovimiento(db, movementId), cobroCreado: false, soloVinculo: true };
}

// Marca el movimiento como "ignorado" (otros / no conciliable). Sirve para cargos en esta pieza.
export function ignorarMovimiento(db, movementId, { by = '' } = {}) {
  assertPendiente(db, movementId);
  insRec(db).run(movementId, 'ignorado', null, null, null, by);
  return estadoMovimiento(db, movementId);
}

// Deshace la conciliación (desenlaza). Si el cobro se creó AQUÍ, avisa antes de borrarlo:
//  - deletePayment === undefined → NO toca nada y devuelve { needsConfirm:true, payment_id } (la ruta pregunta);
//  - deletePayment === true  → desenlaza y BORRA el cobro creado aquí;
//  - deletePayment === false → desenlaza y CONSERVA el cobro.
// Si el cobro ya existía (no se creó aquí), solo desenlaza y lo deja intacto.
export function deshacer(db, movementId, { deletePayment } = {}) {
  const rec = db.prepare('SELECT * FROM bank_reconciliations WHERE movement_id=?').get(movementId);
  if (!rec) return { undone: false, motivo: 'no estaba conciliado' };
  const creadoAqui = !!rec.created_payment_id;
  if (creadoAqui && deletePayment === undefined) {
    return { needsConfirm: true, payment_id: rec.created_payment_id, aviso: 'Este movimiento creó un cobro al conciliar; deshacer puede eliminarlo. Confirma si quieres borrar también el cobro.' };
  }
  db.transaction(() => {
    db.prepare('DELETE FROM bank_reconciliations WHERE movement_id=?').run(movementId);
    if (creadoAqui && deletePayment === true) db.prepare('DELETE FROM invoice_payments WHERE id=?').run(rec.created_payment_id);
  })();
  return { undone: true, deletedPayment: !!(creadoAqui && deletePayment === true), keptPayment: creadoAqui && deletePayment === false };
}
