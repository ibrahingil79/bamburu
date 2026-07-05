// Verificación CONCILIACIÓN BANCARIA · Pieza 1 — parser Norma 43 + import idempotente + cruce de
// ingresos + acciones (conciliar/registrar cobro/ignorar/deshacer). BD temporal, sin servidor.
//   node scripts/verify-conciliacion.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os'; import { join } from 'path'; import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { paymentsSum } from '../modules/erp/cobros.js';
import { parseNorma43, importNorma43, sugerenciasIngreso, conciliarConFactura, ignorarMovimiento, deshacer, estadoMovimiento } from '../modules/erp/conciliacion.js';

const DBF = join(tmpdir(), 'concil-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// Constructor de líneas Norma 43 de 80 posiciones (1-indexado).
const L = f => { const a = ' '.repeat(80).split(''); for (const [from, val] of f) { const s = String(val); for (let i = 0; i < s.length; i++) a[from - 1 + i] = s[i]; } return a.join('').slice(0, 80); };
const amt = v => String(Math.round(v * 100)).padStart(14, '0');
const nz = (v, n) => String(v).padStart(n, '0');

try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, invoice_series) VALUES (1,'Test SL','89890001K','F')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('María García SL','B12345678','empresa',0)").run();
  const cli = db.prepare('SELECT id FROM clients LIMIT 1').get().id;
  const f1 = createInvoice(db, { client_id: cli, issue_date: '2026-03-09', irpf_rate: 0, lines: [{ description: 'Servicio', quantity: 1, unit_price: 100, tax_rate: 21 }] });   // 121.00
  const num = db.prepare('SELECT invoice_number FROM invoices WHERE id=?').get(f1.id).invoice_number;

  console.log('\n=== Parser Norma 43 (posiciones oficiales + integridad) ===\n');
  // saldo ini 1000; abono 121 (concepto con nº factura + nombre); cargo 50 (recibo)
  const extracto = [
    L([[1, '11'], [3, '2100'], [7, '0001'], [11, '0000000001'], [21, '260301'], [27, '260331'], [33, '2'], [34, amt(1000)], [48, '978'], [51, '3'], [52, 'CUENTA']]),
    L([[1, '22'], [7, '0001'], [11, '260310'], [17, '260310'], [23, '01'], [25, '001'], [28, '2'], [29, amt(121)], [43, '0000001234']]),
    L([[1, '23'], [3, '01'], [5, 'TRANSFERENCIA ' + num + ' DE MARIA GARCIA SL']]),
    L([[1, '22'], [7, '0001'], [11, '260311'], [17, '260311'], [23, '02'], [25, '050'], [28, '1'], [29, amt(50)]]),
    L([[1, '23'], [3, '01'], [5, 'RECIBO ELECTRICIDAD']]),
    L([[1, '33'], [3, '2100'], [7, '0001'], [11, '0000000001'], [21, nz(1, 5)], [26, amt(50)], [40, nz(1, 5)], [45, amt(121)], [59, '2'], [60, amt(1071)], [74, '978']]),
    L([[1, '88'], [3, '9'.repeat(18)], [21, nz(6, 6)]]),
  ].join('\r\n');
  const parsed = parseNorma43(extracto);
  ok(parsed.cuentas[0].movimientos.length === 2 && parsed.integridad.ok, 'parser: 2 movimientos + integridad OK (reg 88 y 33 cuadran)');
  ok(parsed.cuentas[0].movimientos[0].amount === 121 && parsed.cuentas[0].movimientos[1].amount === -50, 'signo correcto: abono +121, cargo −50');

  console.log('\n=== Import idempotente (dedup) ===\n');
  let r = importNorma43(db, extracto, { sourceFile: 'ext.q43' });
  ok(r.insertados === 2, 'camino feliz: 2 movimientos importados');
  r = importNorma43(db, extracto, { sourceFile: 'ext.q43' });
  ok(r.insertados === 0 && r.duplicados === 2, 'reimportar el mismo fichero NO duplica');

  console.log('\n=== Sugerencia de cruce (importe + fecha + concepto) ===\n');
  const abono = db.prepare("SELECT * FROM bank_movements WHERE is_credit=1").get();
  const cargo = db.prepare("SELECT * FROM bank_movements WHERE is_credit=0").get();
  const sug = sugerenciasIngreso(db, abono, { ventanaDias: 7 });
  ok(sug.length >= 1 && sug[0].invoice_number === num && sug[0].amount === 121, 'sugiere la factura correcta (121 €) por importe + fecha + concepto');
  ok(sug[0].hints.includes('nº factura'), 'la pista del nº de factura en el concepto se detecta');

  console.log('\n=== Conciliar + registrar cobro (con confirmación) ===\n');
  const res = conciliarConFactura(db, abono.id, f1.id, { by: 'ana', registrarCobro: true });
  ok(res.cobroCreado === true && estadoMovimiento(db, abono.id).estado === 'conciliado', 'conciliar → registra el cobro y marca conciliado');
  ok(paymentsSum(db, f1.id) === 121, 'el cobro de 121 quedó registrado en invoice_payments (reutilizando el flujo)');

  console.log('\n=== Deshacer con aviso de borrado del cobro creado ===\n');
  const d0 = deshacer(db, abono.id);
  ok(d0.needsConfirm === true && paymentsSum(db, f1.id) === 121, 'deshacer sin confirmar → AVISA y no borra el cobro');
  const d1 = deshacer(db, abono.id, { deletePayment: true });
  ok(d1.deletedPayment === true && paymentsSum(db, f1.id) === 0 && estadoMovimiento(db, abono.id).estado === 'pendiente', 'deshacer confirmado → borra el cobro y vuelve a pendiente (reversible)');

  console.log('\n=== Cargo marcado "ignorado" ===\n');
  ignorarMovimiento(db, cargo.id, { by: 'ana' });
  ok(estadoMovimiento(db, cargo.id).estado === 'ignorado', 'un cargo (gasto) se marca ignorado (su cruce es Pieza 2)');

  console.log('\n=== No se muta nada del núcleo ===\n');
  ok(db.prepare('SELECT COUNT(*) c FROM invoices').get().c === 1, 'no se crearon/alteraron facturas');
} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close();
  try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
