// Test de LÓGICA — Contabilidad Pieza 4 · modelos 303 (IVA) y 130 (IRPF), borradores (DB temporal).
//   node scripts/test-contabilidad-modelos.mjs
// Siembra ventas (F1 con IRPF, ticket F2) y facturas de proveedor (gasto corriente + una compra
// dada de alta como BIEN DE INVERSIÓN) con importes elegidos para poder comprobar cada casilla a
// mano. Verifica: 303 devengado por tipo → casillas 07/08, 04/05; deducible corriente 28/29 vs
// bienes de inversión 30/31; total 45, resultado 46/66/71; compensación de trimestre negativo a
// positivo (casilla 78). Y 130: ingresos 01, gastos+amortización 02, 20% en 04, retenciones 06,
// acumulado del año, encadenado entre trimestres.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { backfillLedger } from '../modules/erp/contabilidad.js';
import { createInvestmentGood } from '../modules/erp/contabilidad-bienes.js';
import { modelo303, modelo130, filas303, filas130, quarterRange } from '../modules/erp/contabilidad-modelos.js';

const DBF = join(tmpdir(), 'modelos-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);

try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name) VALUES (1,'Test SL','B00000000','ES','F','R','IVA')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Cliente Uno','11111111H','empresa',0)").run();
  const clientId = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get().id;
  try { db.prepare("INSERT INTO warehouses (name, is_default) VALUES ('Principal',1)").run(); } catch {}
  db.prepare("INSERT INTO suppliers (name, fiscal_id, payment_term_days) VALUES ('Proveedor Uno','A99999999',0)").run();
  const supId = db.prepare('SELECT id FROM suppliers ORDER BY id LIMIT 1').get().id;

  console.log('\n=== Q1 2026 — ventas, gastos y un bien de inversión ===\n');

  // VENTA F1 (Q1): base 1000 @21% + 200 @10%, cliente empresa con IRPF 15%.
  //   IVA devengado = 210 (21%) + 20 (10%) = 230.  Retención soportada = 15% de 1200 = 180.
  const f1 = createInvoice(db, { client_id: clientId, issue_date: '2026-02-10', irpf_rate: 15, lines: [
    { description: 'Servicio A', quantity: 1, unit_price: 1000, tax_rate: 21 },
    { description: 'Producto B', quantity: 1, unit_price: 200, tax_rate: 10 },
  ]});
  // TICKET F2 (Q1): base 100 @21%, efectivo (IVA devengado +21).
  // emitTicketSvc sella la fecha de HOY (no acepta issue_date); como el motor no postea al emitir
  // (lo hace el backfill al final), reubicamos el ticket en Q1 ANTES del backfill para probar que
  // las ventas de mostrador entran en el periodo. Device de prueba (no verificamos hash aquí).
  const tk = emitTicketSvc(db, { payment_method: 'efectivo', lines: [{ description: 'Venta libre', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  db.prepare("UPDATE invoices SET issue_date='2026-03-01' WHERE id=?").run(tk.id);
  db.prepare("DELETE FROM ledger_entries WHERE origin_type='invoice' AND origin_id=?").run(tk.id);   // el emit ya lo posteó con fecha de hoy; el backfill lo reposta en Q1

  // GASTO corriente (Q1): honorarios base 300 @21% → IVA soportado 63.
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, expense_category) VALUES (?, 'SAP-0001','G-1','2026-03-10','2026-03-10',300,63,363,'vigente','Proveedor Uno','A99999999','Servicios profesionales')").run(supId);
  const gId = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='SAP-0001'").get().id;
  db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)').run(gId, 'Honorarios', 300, 21, 63);

  // COMPRA que será BIEN DE INVERSIÓN (Q1): una furgoneta, base 2000 @21% → IVA soportado 420.
  db.prepare("INSERT INTO purchases (supplier_id, reference, date, status, total) VALUES (?, 'FAC-INV','2026-03-15','received',2420)").run(supId);
  const purId = db.prepare("SELECT id FROM purchases ORDER BY id DESC LIMIT 1").get().id;
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, entity_type, entity_id) VALUES (?, 'SAP-0002','FAC-INV','2026-03-15','2026-03-15',2000,420,2420,'vigente','Proveedor Uno','A99999999','purchase',?)").run(supId, purId);
  const invGoodId = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='SAP-0002'").get().id;
  db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)').run(invGoodId, 'Furgoneta', 2000, 21, 420);
  // Alta como bien de inversión enlazada a esa compra.
  createInvestmentGood(db, { description: 'Furgoneta', purchase_id: purId, start_date: '2026-03-15', annual_rate: 16 });

  backfillLedger(db);

  // ── MODELO 303 · Q1 ──
  const m303 = modelo303(db, 2026, 1);
  // Devengado: 21% base = 1000 (F1) + 100 (ticket) = 1100 → cuota 231; 10% base 200 → cuota 20.
  const f21 = m303.dev.filas.find(f => f.tipo === 21);
  const f10 = m303.dev.filas.find(f => f.tipo === 10);
  ok(f21 && eq(f21.base, 1100) && eq(f21.cuota, 231) && f21.casillaBase === '07' && f21.casillaCuota === '08', '303 devengado 21%: base 1100 / cuota 231 en casillas [07][08]');
  ok(f10 && eq(f10.base, 200) && eq(f10.cuota, 20) && f10.casillaBase === '04' && f10.casillaCuota === '05', '303 devengado 10%: base 200 / cuota 20 en casillas [04][05]');
  ok(eq(m303.casilla27, 251), '303 casilla [27] total devengado = 231 + 20 = 251');
  // Deducible: corriente = gasto 300/63; bienes de inversión = 2000/420.
  ok(eq(m303.ded.corriente.base, 300) && eq(m303.ded.corriente.cuota, 63), '303 deducible corriente [28][29]: base 300 / cuota 63');
  ok(eq(m303.ded.inversion.base, 2000) && eq(m303.ded.inversion.cuota, 420), '303 deducible bienes de inversión [30][31]: base 2000 / cuota 420 (separado del corriente)');
  ok(eq(m303.casilla45, 483), '303 casilla [45] total a deducir = 63 + 420 = 483');
  ok(eq(m303.casilla46, -232), '303 casilla [46] resultado = 251 − 483 = −232 (a compensar)');
  ok(eq(m303.casilla66, -232) && eq(m303.casilla71, -232) && eq(m303.casilla78, 0), '303 casilla [71] Q1 = −232 (negativo, sin compensación previa)');
  ok(eq(m303.pendienteSiguiente, 232), '303: el trimestre negativo deja 232 pendiente de compensar para Q2');

  // ── MODELO 130 · Q1 ──
  const m130 = modelo130(db, 2026, 1);
  // Ingresos base = 1000 + 200 (F1) + 100 (ticket) = 1300.
  ok(eq(m130.c01, 1300), '130 casilla [01] ingresos = 1300');
  // Gastos base = 300 (gasto) + 2000 (compra furgoneta) = 2300; + amortización del periodo.
  ok(m130.amort >= 0 && eq(m130.c02, r2(2300 + m130.amort)), `130 casilla [02] gastos = 2300 + amortización (${m130.amort}) = ${m130.c02}`);
  ok(eq(m130.c03, r2(1300 - m130.c02)), '130 casilla [03] rendimiento neto = 01 − 02');
  ok(m130.c03 < 0 && eq(m130.c04, 0), '130 casilla [04] = 0 cuando el rendimiento es negativo');
  ok(eq(m130.c06, 180), '130 casilla [06] retenciones soportadas = 180 (IRPF de la F1)');
  ok(eq(m130.c07, r2(m130.c04 - m130.c05 - m130.c06)), '130 casilla [07] = 04 − 05 − 06');
  ok(eq(m130.c19, m130.c17), '130 casilla [19] = 17 (sin complementaria, casilla 18 = 0)');

  console.log('\n=== Q2 2026 — trimestre positivo que compensa el negativo de Q1 ===\n');
  // VENTA F1 en Q2 grande: base 5000 @21% → IVA 1050; sin IRPF (cliente particular-like via empresa 0).
  createInvoice(db, { client_id: clientId, issue_date: '2026-05-10', irpf_rate: 0, lines: [
    { description: 'Gran servicio', quantity: 1, unit_price: 5000, tax_rate: 21 },
  ]});
  backfillLedger(db);
  const m303q2 = modelo303(db, 2026, 2);
  // Devengado Q2 = 1050; deducible Q2 = 0 → resultado 46 = 1050. Compensa los 232 de Q1.
  ok(eq(m303q2.casilla27, 1050) && eq(m303q2.casilla45, 0), '303 Q2: devengado 1050, deducible 0');
  ok(eq(m303q2.casilla66, 1050), '303 Q2 casilla [66] = 1050');
  ok(eq(m303q2.casilla78, 232), '303 Q2 casilla [78] compensa los 232 pendientes de Q1');
  ok(eq(m303q2.casilla71, 818), '303 Q2 casilla [71] = 1050 − 232 = 818 a ingresar');
  ok(eq(m303q2.pendienteSiguiente, 0), '303 Q2: no queda saldo pendiente tras compensar');

  // 130 Q2 acumulado: ingresos = 1300 + 5000 = 6300.
  const m130q2 = modelo130(db, 2026, 2);
  ok(eq(m130q2.c01, 6300), '130 Q2 casilla [01] acumulado = 1300 + 5000 = 6300');
  // c05 = Σ [07] positivas de trimestres anteriores (Q1 fue negativo → 0).
  ok(eq(m130q2.c05, 0), '130 Q2 casilla [05] = 0 (Q1 no tuvo pago positivo)');

  console.log('\n=== Export (filas casilla·descripción·importe) ===\n');
  const f303 = filas303(m303q2), f130 = filas130(m130q2);
  ok(f303.some(r => r[0] === '71') && f303.some(r => r[0] === '30'), 'Export 303: incluye casilla [71] y [30] (bienes de inversión)');
  ok(f130.some(r => r[0] === '01') && f130.some(r => r[0] === '19'), 'Export 130: incluye casilla [01] y [19]');
  ok(quarterRange(2026, 3).from === '2026-07-01' && quarterRange(2026, 3).to === '2026-09-30', 'quarterRange(2026, 3) = 01/07 → 30/09');

  console.log('\n=== Avisos (transparencia, no inventar) ===\n');
  ok(Array.isArray(m130.warnings) && m130.warnings.some(w => w.includes('existencias')), '130: avisa de que no incluye variación de existencias');
  ok(m130.warnings.some(w => w.includes('vivienda')), '130: avisa de la deducción de vivienda a 0 (manual)');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close();
  try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
