// Verificación CONCILIACIÓN BANCARIA · Pieza 2 (cruce de GASTOS) — cargo ↔ compra/gasto.
//   node scripts/verify-conciliacion-gastos.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os'; import { join } from 'path'; import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { paymentsSum } from '../modules/erp/pagos.js';
import { sugerenciasGasto, conciliarConGasto, conciliarConPagoProveedor, ignorarMovimiento, deshacer, estadoMovimiento } from '../modules/erp/conciliacion.js';

const DBF = join(tmpdir(), 'congas-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const mkCargo = (amt, concept) => db.prepare("INSERT INTO bank_movements (account,op_date,amount,is_credit,balance,concept,natural_hash) VALUES ('X','2026-03-10',?,0,0,?,?)").run(-Math.abs(amt), concept, 'h' + Math.random()).lastInsertRowid;

try {
  runMigrations(db);
  db.prepare("INSERT INTO suppliers (name, fiscal_id, payment_term_days) VALUES ('Electrica Verde SA','A11111111',0)").run();
  const sup = db.prepare('SELECT id FROM suppliers LIMIT 1').get().id;
  // Factura de proveedor de 242 pendiente (gasto de suministros)
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, expense_category) VALUES (?, 'GAS-0001','L-500','2026-03-09','2026-03-09',200,42,242,'vigente','Electrica Verde SA','A11111111','Suministros')").run(sup);
  const si = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='GAS-0001'").get().id;

  console.log('\n=== Sugerencia de gasto (cargo ↔ compra) ===\n');
  const m1 = mkCargo(242, 'RECIBO ELECTRICA VERDE L-500');
  const mov1 = db.prepare('SELECT * FROM bank_movements WHERE id=?').get(m1);
  const sug = sugerenciasGasto(db, mov1, { ventanaDias: 7 });
  ok(sug.length >= 1 && sug[0].type === 'gasto' && sug[0].supplier_invoice_id === si && sug[0].amount === 242, 'sugiere la compra/gasto correcta por importe 242 + fecha');
  ok(sug[0].hints.includes('nº factura') && sug[0].hints.includes('proveedor'), 'pistas del concepto (nº factura del proveedor + nombre)');

  console.log('\n=== Conciliar + registrar pago (con confirmación) ===\n');
  const res = conciliarConGasto(db, m1, si, { by: 'ana', registrarPago: true });
  ok(res.pagoCreado === true && estadoMovimiento(db, m1).estado === 'conciliado', 'conciliar → registra el pago y marca conciliado');
  ok(paymentsSum(db, si) === 242, 'el pago de 242 quedó en supplier_payments (reutilizando el flujo)');

  console.log('\n=== Deshacer con aviso de borrado del pago creado ===\n');
  const d0 = deshacer(db, m1);
  ok(d0.needsConfirm === true && paymentsSum(db, si) === 242, 'deshacer sin confirmar → AVISA y no borra el pago');
  const d1 = deshacer(db, m1, { deletePayment: true });
  ok(d1.deletedPayment === true && paymentsSum(db, si) === 0 && estadoMovimiento(db, m1).estado === 'pendiente', 'deshacer confirmado → borra el pago (de supplier_payments) y vuelve a pendiente');

  console.log('\n=== Pago que YA existe → solo enlaza, no duplica ===\n');
  db.prepare("INSERT INTO supplier_payments (supplier_invoice_id, amount, paid_date, payment_method) VALUES (?,?,?,?)").run(si, 242, '2026-03-10', 'transferencia');
  const m2 = mkCargo(242, 'RECIBO LUZ SA');
  const r2 = conciliarConGasto(db, m2, si, { by: 'ana', registrarPago: true });
  ok(r2.enlazadoAPagoExistente === true && r2.pagoCreado === false, 'compra con pago que cuadra → enlaza, NO duplica pago');
  ok(db.prepare('SELECT COUNT(*) c FROM supplier_payments WHERE supplier_invoice_id=?').get(si).c === 1, 'sigue habiendo 1 solo pago');
  const d2 = deshacer(db, m2);
  ok(d2.undone === true && paymentsSum(db, si) === 242, 'deshacer sobre pago preexistente → desenlaza y deja el pago intacto');

  console.log('\n=== Enlazar a pago existente + ignorar un cargo no-gasto ===\n');
  const payId = db.prepare('SELECT id FROM supplier_payments WHERE supplier_invoice_id=?').get(si).id;
  const m3 = mkCargo(242, 'x');
  conciliarConPagoProveedor(db, m3, payId, { by: 'ana' });
  ok(estadoMovimiento(db, m3).estado === 'conciliado', 'conciliarConPagoProveedor enlaza a un pago existente');
  const m4 = mkCargo(15, 'TRASPASO A MI OTRA CUENTA');
  ignorarMovimiento(db, m4, { by: 'ana' });
  ok(estadoMovimiento(db, m4).estado === 'ignorado', 'un cargo que no es gasto (traspaso propio) se marca ignorado');

  console.log('\n=== No paga de más ===\n');
  const m5 = mkCargo(999, 'RECIBO LUZ SA L-500');
  let threw = false; try { conciliarConGasto(db, m5, si, { registrarPago: true }); } catch (e) { threw = e.status === 400; }
  ok(threw, 'un pago que supera lo pendiente → error (no paga de más)');
} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close(); try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
