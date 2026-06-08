// T4 Paso 2.1 — tests de lógica de CUENTA: agregado, herencia de etapa/perfil de la
// factura más grave, reparto automático (incl. parcial a medias y sobrante), validación
// de reparto manual (descuadre), servicio de acciones de cuenta (recordatorio = 1 email +
// 1 acción por factura, promesa pospone todas, cobro reparte invoice_payments correctos,
// rechazo de no vivas), resumen DISA de cuenta, y REGRESIÓN de Paso 2 factura-a-factura.
//
//   node scripts/test-cobros-paso2-1.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  resumenCuentaCliente, repartoAutomatico, validarRepartoManual,
  registerAccountAction, accountsSummary, accountEmail,
  invoiceProximaAccion, registerCollectionAction, activeActions, paymentsSum, invoiceCobro,
} from '../modules/erp/cobros.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
const TODAY = '2026-06-08';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("UPDATE company_config SET company_name=?, email=?, currency_symbol=? WHERE id=1").run('Autónomo SL', 'yo@autonomo.es', '€');
  return db;
}
let seq = 0;
function addClient(db, profile, email = 'c@x.es', name = 'Cliente') {
  return db.prepare("INSERT INTO clients (name,email,active,collections_profile) VALUES (?,?,1,?)").run(name, email, profile).lastInsertRowid;
}
function addInvoice(db, { clientId, due, total = 100, status = 'emitida', number }) {
  number = number || ('F2026-' + (++seq));
  return db.prepare(`INSERT INTO invoices
    (invoice_number, client_id, year, sequence, issue_date, company_name, company_fiscal_id, due_date, total, status)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(number, clientId, 2026, seq, '2026-01-01', 'Autónomo SL', 'B1', due, total, status).lastInsertRowid;
}
function logStep(db, invId, clientId, stage) {
  db.prepare("INSERT INTO collection_actions (invoice_id,client_id,type,stage,created_at,active) VALUES (?,?,?,?,?,1)")
    .run(invId, clientId, 'recordatorio_email', stage, TODAY + 'T00:00:00Z');
}
const mockMailer = () => { let n = 0; const f = async (p) => { n++; f.last = p; return { data: { id: 'em' }, error: null }; }; f.count = () => n; return f; };

// ── 1. resumenCuentaCliente: agregado + herencia de la factura más grave ────
console.log('1. Resumen de cuenta');
{
  const db = freshDb();
  const cid = addClient(db, 'firme');
  const iA = addInvoice(db, { clientId: cid, due: '2026-03-01', total: 200 }); // muy vencida
  const iB = addInvoice(db, { clientId: cid, due: '2026-06-04', total: 100 }); // poco vencida
  // A ya tiene r1+r2+firme hechos → su próxima es en_riesgo (la más grave).
  logStep(db, iA, cid, 'r1'); logStep(db, iA, cid, 'r2'); logStep(db, iA, cid, 'firme');

  const r = resumenCuentaCliente(db, cid, TODAY);
  eq(r.deudaTotal, 300, 'deuda total = suma de pendientes');
  eq(r.facturasVivas.length, 2, 'dos facturas vivas');
  eq(r.etapaCuenta, 'en_riesgo', 'etapa de cuenta hereda de la más grave (en_riesgo)');
  eq(r.facturasVivas[0].invoice_id, iA, 'la más grave va primero (priorizada)');
  eq(r.perfilCuenta, 'firme', 'perfil de cuenta = perfil del cliente');
  ok(r.proximaAccionCuenta && r.proximaAccionCuenta.etapa === 'en_riesgo', 'próxima acción de cuenta = la de la más grave');
  db.close();
}

// ── 2. repartoAutomatico (más antigua primero; parcial a medias; sobrante) ──
console.log('2. Reparto automático');
{
  const vivas = [
    { invoice_id: 1, pendiente: 100, due_date: '2026-01-01' },
    { invoice_id: 2, pendiente: 200, due_date: '2026-02-01' },
    { invoice_id: 3, pendiente: 50,  due_date: '2026-03-01' },
  ];
  // 130 → salda la 1 (100) y deja la 2 a medias (30); la 3 sin tocar.
  const r1 = repartoAutomatico(130, vivas);
  eq(r1.asignacion, [{ invoice_id: 1, importe: 100 }, { invoice_id: 2, importe: 30 }], 'reparto cubre la más antigua y deja la siguiente a medias');
  eq(r1.sinAsignar, 0, 'sin sobrante');
  // 400 (>350 total) → salda todo y sobran 50 sin asignar (no se inventa factura).
  const r2 = repartoAutomatico(400, vivas);
  eq(r2.asignacion.reduce((s, a) => s + a.importe, 0), 350, 'cubre toda la deuda');
  eq(r2.sinAsignar, 50, 'el sobrante queda sin asignar');
  // Cuadre al céntimo con decimales.
  const r3 = repartoAutomatico(100.10, [{ invoice_id: 9, pendiente: 60.05, due_date: '2026-01-01' }, { invoice_id: 8, pendiente: 80, due_date: '2026-02-01' }]);
  eq(r3.asignacion, [{ invoice_id: 9, importe: 60.05 }, { invoice_id: 8, importe: 40.05 }], 'reparto exacto al céntimo');
  eq(r3.sinAsignar, 0, 'sin descuadre de céntimos');
}

// ── 3. validarRepartoManual (suma exacta; ni más ni menos; no sobre-pago) ───
console.log('3. Validación de reparto manual');
{
  const vivas = [{ invoice_id: 1, pendiente: 200 }, { invoice_id: 2, pendiente: 150 }];
  eq(validarRepartoManual([{ invoice_id: 1, importe: 200 }, { invoice_id: 2, importe: 150 }], 350, vivas).ok, true, 'suma == total → ok');
  eq(validarRepartoManual([{ invoice_id: 1, importe: 100 }, { invoice_id: 2, importe: 150 }], 350, vivas).ok, false, 'suma de menos → falla');
  eq(validarRepartoManual([{ invoice_id: 1, importe: 250 }, { invoice_id: 2, importe: 100 }], 350, vivas).ok, false, 'factura por encima de su deuda → falla');
  eq(validarRepartoManual([{ invoice_id: 99, importe: 350 }], 350, vivas).ok, false, 'factura ajena → falla');
}

// ── 4. Servicio de cuenta — recordatorio (1 email + 1 acción/factura) ───────
console.log('4. registerAccountAction · recordatorio');
{
  const db = freshDb();
  const cid = addClient(db, 'estandar', 'cli@x.es');
  const iA = addInvoice(db, { clientId: cid, due: '2026-05-01', total: 200 });
  const iB = addInvoice(db, { clientId: cid, due: '2026-05-20', total: 100 });
  const m = mockMailer();
  const r = await registerAccountAction(db, cid, { type: 'recordatorio_cuenta' }, { sendEmail: m, today: TODAY, now: TODAY + 'T10:00:00Z', batchId: 'B1' });
  eq(m.count(), 1, 'recordatorio de cuenta envía UN solo email');
  ok(/200\.00|300\.00/.test(m.last.text), 'el email incluye importes del desglose');
  eq(r.facturas, 2, 'reporta 2 facturas incluidas');
  eq(activeActions(db, iA).length, 1, 'acción registrada en factura A');
  eq(activeActions(db, iB).length, 1, 'acción registrada en factura B');
  eq(db.prepare("SELECT COUNT(*) n FROM collection_actions WHERE account_batch_id='B1'").get().n, 2, 'ambas acciones marcadas con el lote');
  db.close();
}

// ── 5. Servicio de cuenta — promesa pospone TODAS ───────────────────────────
console.log('5. registerAccountAction · promesa');
{
  const db = freshDb();
  const cid = addClient(db, 'estandar');
  const iA = addInvoice(db, { clientId: cid, due: '2026-05-01', total: 200 });
  const iB = addInvoice(db, { clientId: cid, due: '2026-05-20', total: 100 });
  await registerAccountAction(db, cid, { type: 'promesa_cuenta', promised_date: '2026-06-30' }, { sendEmail: mockMailer(), today: TODAY, now: TODAY + 'T10:00:00Z' });
  const pa = invoiceProximaAccion(db, db.prepare('SELECT * FROM invoices WHERE id=?').get(iA), TODAY);
  const pb = invoiceProximaAccion(db, db.prepare('SELECT * FROM invoices WHERE id=?').get(iB), TODAY);
  eq(pa.etapa, 'promesa', 'factura A pospuesta (promesa)');
  eq(pb.etapa, 'promesa', 'factura B pospuesta (promesa)');
  db.close();
}

// ── 6. Servicio de cuenta — cobro auto reparte invoice_payments correctos ───
console.log('6. registerAccountAction · cobro a cuenta (auto)');
{
  const db = freshDb();
  const cid = addClient(db, 'estandar');
  const iA = addInvoice(db, { clientId: cid, due: '2026-03-01', total: 200, number: 'F-A' }); // más antigua
  const iB = addInvoice(db, { clientId: cid, due: '2026-05-01', total: 100, number: 'F-B' });
  const r = await registerAccountAction(db, cid, { type: 'cobro_cuenta', importe: 230, modo: 'auto' }, { sendEmail: mockMailer(), today: TODAY, now: TODAY + 'T10:00:00Z', batchId: 'BC' });
  eq(paymentsSum(db, iA), 200, 'la más antigua se salda (200)');
  eq(paymentsSum(db, iB), 30, 'la siguiente recibe el resto (30)');
  eq(invoiceCobro(db, db.prepare('SELECT * FROM invoices WHERE id=?').get(iA), TODAY).estado, 'cobrada', 'A queda cobrada');
  const stB = invoiceCobro(db, db.prepare('SELECT * FROM invoices WHERE id=?').get(iB), TODAY);
  eq(stB.cobrado, 30, 'B queda con 30 cobrado (a medias)');
  eq(stB.pendiente, 70, 'B queda con 70 pendiente');
  eq(r.sinAsignar, 0, 'sin sobrante con 230 sobre 300 de deuda');
  // Conservación: lo cobrado == importe (ni crea ni pierde dinero).
  eq(paymentsSum(db, iA) + paymentsSum(db, iB), 230, 'la suma cobrada == importe (cuadra al céntimo)');
  eq(db.prepare("SELECT COUNT(*) n FROM invoice_payments WHERE account_batch_id='BC'").get().n, 2, 'pagos marcados con el lote');
  db.close();
}

// ── 7. Cobro a cuenta MANUAL: ok cuadrado, rechazo descuadre, rechazo no viva ──
console.log('7. registerAccountAction · cobro manual + guardas');
{
  const db = freshDb();
  const cid = addClient(db, 'estandar');
  const iA = addInvoice(db, { clientId: cid, due: '2026-03-01', total: 200 });
  const iB = addInvoice(db, { clientId: cid, due: '2026-05-01', total: 100 });

  // Manual cuadrado.
  await registerAccountAction(db, cid, { type: 'cobro_cuenta', importe: 150, modo: 'manual', asignacion: [{ invoice_id: iA, importe: 120 }, { invoice_id: iB, importe: 30 }] }, { sendEmail: mockMailer(), today: TODAY });
  eq(paymentsSum(db, iA), 120, 'manual aplica 120 a A');
  eq(paymentsSum(db, iB), 30, 'manual aplica 30 a B');

  // Manual descuadrado → 400 y nada se inserta.
  let threw = null;
  const before = db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n;
  try { await registerAccountAction(db, cid, { type: 'cobro_cuenta', importe: 100, modo: 'manual', asignacion: [{ invoice_id: iA, importe: 40 }, { invoice_id: iB, importe: 30 }] }, { sendEmail: mockMailer(), today: TODAY }); }
  catch (e) { threw = e; }
  ok(threw && threw.status === 400, 'descuadre manual → error 400');
  eq(db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n, before, 'descuadre no inserta ningún pago');

  // Cliente sin deuda viva (todo anulado) → 400.
  const cid2 = addClient(db, 'estandar');
  addInvoice(db, { clientId: cid2, due: '2026-03-01', total: 100, status: 'anulada' });
  let threw2 = null;
  try { await registerAccountAction(db, cid2, { type: 'recordatorio_cuenta' }, { sendEmail: mockMailer(), today: TODAY }); }
  catch (e) { threw2 = e; }
  ok(threw2 && threw2.status === 400, 'cliente con solo facturas no vivas → 400');
  db.close();
}

// ── 8. DISA: accountsSummary refleja deuda de cuenta + próxima acción ───────
console.log('8. DISA · resumen de cuenta');
{
  const db = freshDb();
  const cA = addClient(db, 'firme', 'a@x.es', 'Ana');
  const cB = addClient(db, 'estandar', 'b@x.es', 'Bea');
  addInvoice(db, { clientId: cA, due: '2026-03-01', total: 300 });
  addInvoice(db, { clientId: cA, due: '2026-04-01', total: 150 });
  addInvoice(db, { clientId: cB, due: '2026-06-04', total: 80 });
  const s = accountsSummary(db, TODAY);
  eq(s.rows.length, 2, 'resumen de cuenta lista 2 clientes con deuda');
  const ana = s.rows.find(r => r.client_name === 'Ana');
  eq(ana.deudaTotal, 450, 'deuda de cuenta de Ana = 450');
  eq(ana.facturas, 2, 'Ana tiene 2 facturas vivas');
  ok(ana.proximaAccionCuenta, 'Ana lleva próxima acción de cuenta');
  eq(s.total, 530, 'total global de cuentas = 530');
  db.close();
}

// ── 9. REGRESIÓN: la gestión factura-a-factura de Paso 2 sigue igual ────────
console.log('9. Regresión Paso 2 (factura a factura)');
{
  const db = freshDb();
  const cid = addClient(db, 'estandar', 'reg@x.es');
  const id = addInvoice(db, { clientId: cid, due: '2026-05-20', total: 100 });
  const m = mockMailer();
  const r = await registerCollectionAction(db, id, { type: 'recordatorio_email' }, { sendEmail: m, today: TODAY, now: TODAY + 'T10:00:00Z' });
  eq(m.count(), 1, 'recordatorio por factura sigue enviando 1 email');
  eq(r.email.sent, true, 'servicio de Paso 2 intacto');
  eq(activeActions(db, id).length, 1, 'acción de factura registrada (sin batch)');
  eq(db.prepare('SELECT account_batch_id FROM collection_actions WHERE invoice_id=?').get(id).account_batch_id, null, 'gestión por factura no lleva lote de cuenta');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Paso 2.1: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
