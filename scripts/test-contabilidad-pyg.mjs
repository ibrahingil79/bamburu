// Test de LÓGICA — Contabilidad Pieza 5 · Cuenta de Pérdidas y Ganancias (PGC PYMES, DB temporal).
//   node scripts/test-contabilidad-pyg.mjs
// Siembra ventas (F1 de servicios con IRPF + ticket F2 de mostrador) y facturas de proveedor
// (gastos de servicios exteriores 62x + una compra de mercaderías 600) con importes elegidos a
// mano. Verifica: la P&G cuadra (Resultado del ejercicio = Σingresos − Σgastos del periodo);
// coherencia de subtotales (A.3 = A.1 + A.2; A.4 = A.3 + impuestos); cruce con el Libro Mayor y
// con los libros registro de Pieza 1 (INCN = base de ventas; aprovisionamientos + otros gastos =
// base de compras); financiero a 0 con nota; filtro de periodo; y la red de seguridad de cuentas
// sin partida estándar (aviso).
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { backfillLedger, libroVentas, libroCompras, libroMayor } from '../modules/erp/contabilidad.js';
import { cuentaPyG, filasPyG, pygPartida } from '../modules/erp/contabilidad-pyg.js';

const DBF = join(tmpdir(), 'pyg-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);
const FROM = '2026-01-01', TO = '2026-12-31';
const val = (pyg, key) => pyg.partidas.find(p => p.key === key)?.importe;

try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name) VALUES (1,'Test SL','B00000000','ES','F','R','IVA')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Cliente Uno','11111111H','empresa',0)").run();
  const clientId = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get().id;
  try { db.prepare("INSERT INTO warehouses (name, is_default) VALUES ('Principal',1)").run(); } catch {}
  db.prepare("INSERT INTO suppliers (name, fiscal_id, payment_term_days) VALUES ('Proveedor Uno','A99999999',0)").run();
  const supId = db.prepare('SELECT id FROM suppliers ORDER BY id LIMIT 1').get().id;

  console.log('\n=== Clasificador cuenta→partida (mapeo PGC verificado) ===\n');
  ok(pygPartida('705') === 'incn', '705 Prestaciones de servicios → Importe neto de la cifra de negocios');
  ok(pygPartida('700') === 'incn', '700 Ventas de mercaderías → Importe neto de la cifra de negocios');
  ok(pygPartida('708') === 'incn', '708 Devoluciones de ventas → INCN (minora)');
  ok(pygPartida('600') === 'aprovisionamientos', '600 Compras de mercaderías → Aprovisionamientos');
  ok(pygPartida('626') === 'otros_gastos', '626 Servicios bancarios → Otros gastos de explotación (NO financiero)');
  ok(pygPartida('621') === 'otros_gastos' && pygPartida('629') === 'otros_gastos', '621/629 (servicios exteriores 62) → Otros gastos de explotación');
  ok(pygPartida('640') === 'personal', '640 Sueldos → Gastos de personal');
  ok(pygPartida('681') === 'amortizacion', '681 Amortización inmovilizado material → Amortización del inmovilizado');
  ok(pygPartida('662') === 'gastos_financieros', '662 Intereses de deudas → Gastos financieros');
  ok(pygPartida('769') === 'ing_financieros', '769 Otros ingresos financieros → Ingresos financieros');
  ok(pygPartida('6300') === 'impuestos', '6300 Impuesto corriente → Impuestos sobre beneficios');
  ok(pygPartida('631') === 'otros_gastos', '631 Otros tributos → Otros gastos de explotación (no es impuesto sobre beneficios)');
  ok(pygPartida('430') === null && pygPartida('572') === null, 'Cuentas de balance (430, 572) → sin partida de P&G (excluidas)');

  console.log('\n=== Siembra 2026 — ventas de servicios + ticket + gastos + una compra de mercaderías ===\n');
  // VENTA F1 (servicios): base 1000@21% + 200@10%, IRPF 15% → ingreso 705 = 1200.
  createInvoice(db, { client_id: clientId, issue_date: '2026-02-10', irpf_rate: 15, lines: [
    { description: 'Servicio A', quantity: 1, unit_price: 1000, tax_rate: 21 },
    { description: 'Servicio B', quantity: 1, unit_price: 200, tax_rate: 10 },
  ]});
  // TICKET F2 (mostrador, efectivo): base 100@21% → ingreso 700 = 100.
  const tk = emitTicketSvc(db, { payment_method: 'efectivo', lines: [{ description: 'Venta libre', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  db.prepare("UPDATE invoices SET issue_date='2026-03-01' WHERE id=?").run(tk.id);
  db.prepare("DELETE FROM ledger_entries WHERE origin_type='invoice' AND origin_id=?").run(tk.id);
  // GASTO servicios profesionales (623): base 300@21%.
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, expense_category) VALUES (?, 'SAP-1','G-1','2026-03-10','2026-03-10',300,63,363,'vigente','Proveedor Uno','A99999999','Servicios profesionales')").run(supId);
  const g1 = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='SAP-1'").get().id;
  db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)').run(g1, 'Honorarios', 300, 21, 63);
  // GASTO alquiler (621): base 500@21%.
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, expense_category) VALUES (?, 'SAP-2','G-2','2026-04-01','2026-04-01',500,105,605,'vigente','Proveedor Uno','A99999999','Alquiler')").run(supId);
  const g2 = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='SAP-2'").get().id;
  db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)').run(g2, 'Local', 500, 21, 105);
  // COMPRA de mercaderías (600, sin expense_category): base 250@21%.
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id) VALUES (?, 'SAP-3','C-3','2026-05-05','2026-05-05',250,52.5,302.5,'vigente','Proveedor Uno','A99999999')").run(supId);
  const c3 = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='SAP-3'").get().id;
  db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)').run(c3, 'Mercadería', 250, 21, 52.5);

  backfillLedger(db);

  const pyg = cuentaPyG(db, FROM, TO);

  console.log('\n=== Estructura y cuadre de la P&G ===\n');
  // INCN = 705 (1200) + 700 (100) = 1300. Aprovisionamientos = −250 (600). Otros gastos = −800 (623+621).
  ok(eq(val(pyg, 'incn'), 1300), 'Partida 1 · Importe neto de la cifra de negocios = 1300 (705=1200 + 700=100)');
  ok(eq(val(pyg, 'aprovisionamientos'), -250), 'Partida 4 · Aprovisionamientos = −250 (compra de mercaderías 600, en negativo)');
  ok(eq(val(pyg, 'otros_gastos'), -800), 'Partida 7 · Otros gastos de explotación = −800 (623=300 + 621=500)');
  ok(eq(pyg.resultadoExplotacion, 250), 'A.1) Resultado de explotación = 1300 − 250 − 800 = 250');
  ok(eq(pyg.resultadoFinanciero, 0), 'A.2) Resultado financiero = 0 (sin cuentas 66x/76x)');
  ok(eq(pyg.resultadoAntesImpuestos, r2(pyg.resultadoExplotacion + pyg.resultadoFinanciero)), 'A.3) Resultado antes de impuestos = A.1 + A.2');
  ok(eq(pyg.impuestos, 0), 'Partida 17 · Impuestos sobre beneficios = 0');
  ok(eq(pyg.resultadoEjercicio, r2(pyg.resultadoAntesImpuestos + pyg.impuestos)), 'A.4) Resultado del ejercicio = A.3 + impuestos');
  ok(eq(pyg.resultadoEjercicio, 250), 'A.4) Resultado del ejercicio = 250');

  // CUADRE MAESTRO: Resultado del ejercicio = Σingresos − Σgastos del periodo (directo del Mayor).
  const mayor = libroMayor(db, FROM, TO);
  const g7 = mayor.rows.filter(r => String(r.code)[0] === '7').reduce((s, r) => s + (r.haber - r.debe), 0);   // ingresos (haber−debe)
  const g6 = mayor.rows.filter(r => String(r.code)[0] === '6').reduce((s, r) => s + (r.debe - r.haber), 0);   // gastos (debe−haber)
  ok(eq(pyg.resultadoEjercicio, r2(g7 - g6)), `CUADRE: Resultado del ejercicio (${pyg.resultadoEjercicio}) = Σingresos (${r2(g7)}) − Σgastos (${r2(g6)}) del Mayor`);

  console.log('\n=== Cruce con el Libro Mayor (partida a partida) ===\n');
  // Cada partida = Σ(haber − debe) de sus cuentas en el Mayor.
  const partidaFromMayor = key => r2(mayor.rows.filter(r => pygPartida(r.code) === key).reduce((s, r) => s + (r.haber - r.debe), 0));
  ok(eq(val(pyg, 'incn'), partidaFromMayor('incn')), 'Cruce Mayor: INCN coincide con Σ(haber−debe) de 700/705');
  ok(eq(val(pyg, 'otros_gastos'), partidaFromMayor('otros_gastos')), 'Cruce Mayor: Otros gastos coincide con Σ(haber−debe) de 62x');
  ok(eq(val(pyg, 'aprovisionamientos'), partidaFromMayor('aprovisionamientos')), 'Cruce Mayor: Aprovisionamientos coincide con Σ(haber−debe) de 600');

  console.log('\n=== Cruce con los libros registro de Pieza 1 (totales coinciden) ===\n');
  const ventas = libroVentas(db, FROM, TO);
  const compras = libroCompras(db, FROM, TO);
  ok(eq(val(pyg, 'incn'), ventas.totals.base), `INCN (${val(pyg, 'incn')}) = base del Libro de ventas (${ventas.totals.base})`);
  const gastoBase = r2(Math.abs(val(pyg, 'aprovisionamientos')) + Math.abs(val(pyg, 'otros_gastos')));
  ok(eq(gastoBase, compras.totals.base), `|Aprovisionamientos| + |Otros gastos| (${gastoBase}) = base del Libro de compras (${compras.totals.base})`);

  console.log('\n=== Estructura formal (filas) y avisos ===\n');
  const filas = filasPyG(pyg);
  ok(filas.some(f => f[0] === 'A.1)' && f[3] === 'subtotal') && filas.some(f => f[0] === 'A.4)' && f[3] === 'subtotal'), 'filasPyG incluye los subtotales A.1) … A.4)');
  ok(filas.filter(f => f[3] === 'partida').length === 17, 'filasPyG lista las 17 partidas PYMES (estructura formal completa, 0 donde no hay movimiento)');
  ok(Array.isArray(pyg.warnings) && pyg.warnings.some(w => w.toLowerCase().includes('financ')), 'Aviso: bloque financiero a 0 cuando no hay cuentas 66x/76x');

  console.log('\n=== Filtro de periodo ===\n');
  const pygVacio = cuentaPyG(db, '2025-01-01', '2025-12-31');
  ok(eq(pygVacio.resultadoEjercicio, 0) && eq(val(pygVacio, 'incn'), 0), 'Periodo sin asientos (2025) → todas las partidas y el resultado a 0');

  console.log('\n=== Red de seguridad: cuenta de grupo 6/7 sin partida estándar ===\n');
  // Inyecta un asiento cuadrado con la cuenta 678 (Gastos excepcionales), que no tiene partida
  // estándar en el modelo PYMES → debe caer en "Otros gastos de explotación" CON AVISO.
  const eid = db.prepare("INSERT INTO ledger_entries (entry_date, entry_type, origin_type, origin_id, memo) VALUES ('2026-06-01','test','test',1,'huerfana')").run().lastInsertRowid;
  db.prepare("INSERT INTO ledger_lines (entry_id, account_code, debit, credit) VALUES (?, '678', 50, 0)").run(eid);
  db.prepare("INSERT INTO ledger_lines (entry_id, account_code, debit, credit) VALUES (?, '570', 0, 50)").run(eid);
  const pyg2 = cuentaPyG(db, FROM, TO);
  ok(pygPartida('678') === null, '678 no tiene partida estándar (devuelve null)');
  ok(eq(val(pyg2, 'otros_gastos'), r2(-800 - 50)), 'La cuenta huérfana 678 se agrega a Otros gastos de explotación (−850)');
  ok(eq(pyg2.resultadoEjercicio, r2(250 - 50)), 'El resultado del ejercicio absorbe la cuenta huérfana (200) — cuadre preservado');
  ok(pyg2.warnings.some(w => w.includes('678')), 'Aviso: la cuenta 678 sin partida estándar queda señalada');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close();
  try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
