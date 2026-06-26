// Test de LÓGICA — Motor de contabilidad Pieza 1 (DB temporal nueva).
//   node scripts/test-contabilidad.mjs
// Dirige los servicios REALES de ventas (createInvoice/emitTicket/sustitutiva/anular/rectificar)
// e inserta documentos de proveedor en su forma canónica. Verifica: cada asiento cuadra
// (Σdebe=Σhaber); cada hecho mapea; anuladas netean a 0; sustituidas no aparecen; abonos restan;
// comprobación A (430 = base+IVA−retención, no doble resta); comprobación B (ticket+F3: ingreso
// y tesorería una sola vez); backfill idempotente; cuadre de los dos libros vs documentos vivos.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, anularInvoice, createRectificativa, emitTicketSvc, emitSustitutivaSvc } from '../modules/erp/routes/invoices.js';
import { countsAsReceivable } from '../modules/erp/cobros.js';
import { countsAsPayable } from '../modules/erp/pagos.js';
import {
  ensureLedgerSchema, backfillLedger, postInvoice, postInvoicePayment,
  postSupplierInvoice, postSupplierPayment, libroVentas, libroCompras,
} from '../modules/erp/contabilidad.js';

const DBF = join(tmpdir(), 'conta-test-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Cuadre de un asiento por origen (Σdebe=Σhaber) + helper de saldos por cuenta.
function entryLines(originType, originId, entryType) {
  const e = db.prepare('SELECT id FROM ledger_entries WHERE origin_type=? AND origin_id=? AND entry_type=?').get(originType, originId, entryType);
  if (!e) return null;
  return db.prepare('SELECT account_code, debit, credit, tax_rate, line_kind FROM ledger_lines WHERE entry_id=? ORDER BY id').all(e.id);
}
const cuadra = (lines) => r2(lines.reduce((s, l) => s + l.debit, 0)) === r2(lines.reduce((s, l) => s + l.credit, 0));
const dr = (lines, acc) => r2(lines.filter(l => l.account_code === acc).reduce((s, l) => s + l.debit, 0));
const cr = (lines, acc) => r2(lines.filter(l => l.account_code === acc).reduce((s, l) => s + l.credit, 0));
// Saldo neto (debe−haber) de una cuenta sobre TODOS los asientos de un conjunto de orígenes.
function netByAccount(originType, ids, acc) {
  const ph = ids.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM ledger_lines l
       JOIN ledger_entries e ON e.id=l.entry_id
      WHERE e.origin_type=? AND e.origin_id IN (${ph}) AND l.account_code=?`
  ).get(originType, ...ids, acc);
  return r2(row.d - row.c);
}

try {
  runMigrations(db);
  ensureLedgerSchema(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name) VALUES (1,'Test SL','B00000000','ES','F','R','IVA')").run();
  db.prepare("UPDATE company_config SET country='ES', fiscal_id='B00000000', invoice_series='F', rectificative_series='R' WHERE id=1").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Cliente Uno','11111111H','empresa',0)").run();
  const clientId = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get().id;
  try { db.prepare("INSERT INTO warehouses (name, is_default) VALUES ('Principal',1)").run(); } catch {}
  db.prepare("INSERT INTO suppliers (name, fiscal_id, payment_term_days) VALUES ('Proveedor Uno','A99999999',0)").run();
  const supId = db.prepare('SELECT id FROM suppliers ORDER BY id LIMIT 1').get().id;

  console.log('\n=== Motor de contabilidad — LÓGICA ===\n');

  // ── 1) Factura F1 multi-tipo (21% y 10%) con IRPF 15% (cliente empresa) — Comprobación A ──
  const f1 = createInvoice(db, { client_id: clientId, irpf_rate: 15, lines: [
    { description: 'Servicio A', quantity: 1, unit_price: 1000, tax_rate: 21 },
    { description: 'Producto B', quantity: 1, unit_price: 200, tax_rate: 10 },
  ]});
  postInvoice(db, f1.id);
  const invF1 = db.prepare('SELECT * FROM invoices WHERE id=?').get(f1.id);
  let L = entryLines('invoice', f1.id, 'venta');
  ok(L && cuadra(L), 'F1: asiento de venta CUADRA (Σdebe=Σhaber)');
  // base 1200, IVA 21%·1000=210 + 10%·200=20 = 230, IRPF 15%·1200=180, total=1200+230−180=1250
  ok(cr(L, '705') === 1200, 'F1: abono a 705 Prestaciones de servicios por la base total (1200)');
  ok(cr(L, '477') === 230, 'F1: abono a 477 IVA repercutido por la cuota total (230)');
  ok(dr(L, '473') === 180, 'F1: cargo a 473 retenciones por el IRPF (180)');
  ok(dr(L, '430') === 1250, 'F1: cargo a 430 Clientes = base+IVA−retención (1250)');
  ok(dr(L, '430') === r2(invF1.total) && r2(invF1.total) === 1250, 'Comprobación A: 430 coincide con total guardado y NO resta el IRPF dos veces');
  // desglose por tipo en las líneas del asiento
  ok(L.some(l => l.account_code === '705' && l.tax_rate === 21 && l.credit === 1000) && L.some(l => l.account_code === '705' && l.tax_rate === 10 && l.credit === 200), 'F1: base desglosada por tipo de IVA (1000@21 + 200@10), no por el header');

  // ── 2) Ticket mostrador F2 (efectivo) — nace cobrado, anónimo ──
  const tk = emitTicketSvc(db, { payment_method: 'efectivo', lines: [{ description: 'Venta libre', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  postInvoice(db, tk.id);
  L = entryLines('invoice', tk.id, 'venta');
  ok(L && cuadra(L), 'F2: asiento de ticket CUADRA');
  ok(dr(L, '570') === 121 && cr(L, '430') === 0, 'F2: cargo a 570 Caja (efectivo) por el total, SIN pasar por 430 (anónima)');
  ok(cr(L, '700') === 100 && cr(L, '477') === 21, 'F2: abono a 700 mercaderías (100) + 477 IVA (21)');
  // el cobro automático del ticket NO se postea aparte
  const tkPay = db.prepare('SELECT id FROM invoice_payments WHERE invoice_id=?').get(tk.id);
  postInvoicePayment(db, tkPay.id);
  ok(!db.prepare("SELECT 1 FROM ledger_entries WHERE origin_type='invoice_payment' AND origin_id=?").get(tkPay.id), 'F2: el cobro del ticket NO genera asiento aparte (tesorería ya en la venta)');

  // ── 3) Sustitutiva F3 (canje del ticket) — Comprobación B ──
  const f3 = emitSustitutivaSvc(db, tk.id, clientId);
  postInvoice(db, f3.id);
  postInvoice(db, tk.id);   // reconcilia el ticket: ahora sustituido → su venta se reversa
  ok(!!entryLines('invoice', tk.id, 'reversion'), 'F3: el asiento del ticket sustituido se REVERSA');
  L = entryLines('invoice', f3.id, 'venta');
  ok(L && cuadra(L) && dr(L, '570') === 121, 'F3: asiento cuadra y carga a tesorería (cobro heredado del ticket), no a 430');
  // Comprobación B: sumando ticket + F3, ingreso una vez (100) y tesorería una vez (121)
  const ingresoChain = r2(-netByAccount('invoice', [tk.id, f3.id], '700') - netByAccount('invoice', [tk.id, f3.id], '705'));
  const tesoreriaChain = netByAccount('invoice', [tk.id, f3.id], '570');
  ok(ingresoChain === 100, 'Comprobación B: ingreso del ticket+F3 aparece UNA sola vez (100)');
  ok(tesoreriaChain === 121, 'Comprobación B: tesorería del ticket+F3 aparece UNA sola vez (121)');

  // ── 4) Anulación ──
  const an = createInvoice(db, { client_id: clientId, lines: [{ description: 'Para anular', quantity: 1, unit_price: 500, tax_rate: 21 }] });
  postInvoice(db, an.id);
  anularInvoice(db, an.id, 'prueba de anulación');
  postInvoice(db, an.id);
  ok(!!entryLines('invoice', an.id, 'anulacion_venta'), 'Anulación: genera asiento inverso (anulacion_venta)');
  ok(netByAccount('invoice', [an.id], '705') === 0 && netByAccount('invoice', [an.id], '477') === 0 && netByAccount('invoice', [an.id], '430') === 0, 'Anulación: la venta queda NETEADA a cero (705/477/430)');

  // ── 5) Rectificativa por SUSTITUCIÓN (S): reverso original + R completa ──
  const oS = createInvoice(db, { client_id: clientId, lines: [{ description: 'Orig S', quantity: 1, unit_price: 1000, tax_rate: 21 }] });
  postInvoice(db, oS.id);
  const rS = createRectificativa(db, { original_id: oS.id, rectification_type: 'R1', rectification_mode: 'S', lines: [{ description: 'Rect S', quantity: 1, unit_price: 800, tax_rate: 21 }] });
  postInvoice(db, rS.id);
  postInvoice(db, oS.id);   // reconcilia original → rectificada-S → no cuenta → reversa
  ok(netByAccount('invoice', [oS.id], '705') === 0, 'Rectificativa S: la original se REVERSA (no cuenta)');
  ok(-netByAccount('invoice', [rS.id], '705') === 800 && !!entryLines('invoice', rS.id, 'rectificativa'), 'Rectificativa S: la R lleva el importe COMPLETO (800)');

  // ── 6) Rectificativa por DIFERENCIAS (I): original se queda + solo el delta ──
  const oI = createInvoice(db, { client_id: clientId, lines: [{ description: 'Orig I', quantity: 1, unit_price: 1000, tax_rate: 21 }] });
  postInvoice(db, oI.id);
  const rI = createRectificativa(db, { original_id: oI.id, rectification_type: 'R1', rectification_mode: 'I', lines: [{ description: 'Delta I', quantity: 1, unit_price: -200, tax_rate: 21 }] });
  postInvoice(db, rI.id);
  postInvoice(db, oI.id);
  ok(-netByAccount('invoice', [oI.id], '705') === 1000, 'Rectificativa I: la original SE QUEDA (1000)');
  ok(-netByAccount('invoice', [rI.id], '705') === -200, 'Rectificativa I: la R solo añade el DELTA (−200)');

  // ── 7) Proveedor: gasto puro multi-tipo (líneas), mercadería header-only, abono ──
  // 7a) Gasto (servicios profesionales) con dos tipos de IVA
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, expense_category) VALUES (?, 'SAP-0001','G-1','2026-03-10','2026-03-10',?,?,?, 'vigente','Proveedor Uno','A99999999','Servicios profesionales')").run(supId, 300, 53, 353);
  const gId = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='SAP-0001'").get().id;
  db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)').run(gId, 'Honorarios', 200, 21, 42);
  db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)').run(gId, 'Dietas', 100, 11, 11);
  postSupplierInvoice(db, gId);
  L = entryLines('supplier_invoice', gId, 'compra_gasto');
  ok(L && cuadra(L), 'Gasto: asiento CUADRA');
  ok(dr(L, '623') === 300 && dr(L, '472') === 53 && cr(L, '410') === 353, 'Gasto: cargo 623 servicios prof. (300) + 472 IVA (53) / abono 410 acreedores (353)');

  // 7b) Mercadería SOLO en cabecera, tipo efectivo banda legal (21%)
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, entity_type, entity_id) VALUES (?, 'SAP-0002','M-1','2026-03-11','2026-03-11',?,?,?, 'vigente','Proveedor Uno','A99999999','purchase',1)").run(supId, 200, 42, 242);
  const mId = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='SAP-0002'").get().id;
  postSupplierInvoice(db, mId);
  L = entryLines('supplier_invoice', mId, 'compra_gasto');
  ok(L && cuadra(L) && dr(L, '600') === 200 && dr(L, '472') === 42 && cr(L, '400') === 242, 'Mercadería header-only: 600 (200) + 472 (42) / 400 (242), tipo 21% derivado');
  ok(L.some(l => l.account_code === '600' && l.tax_rate === 21), 'Mercadería header-only: tipo de IVA 21% reconocido como banda legal');

  // 7c) Mercadería header-only con tipo efectivo NO legal (13%) → marca "IVA sin desglosar"
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, entity_type, entity_id) VALUES (?, 'SAP-0003','M-2','2026-03-12','2026-03-12',?,?,?, 'vigente','Proveedor Uno','A99999999','purchase',2)").run(supId, 100, 13, 113);
  const m2 = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='SAP-0003'").get().id;
  postSupplierInvoice(db, m2);
  L = entryLines('supplier_invoice', m2, 'compra_gasto');
  const flaggedEntry = db.prepare("SELECT memo FROM ledger_entries WHERE origin_type='supplier_invoice' AND origin_id=?").get(m2);
  ok(L && cuadra(L) && L.some(l => l.account_code === '600' && l.tax_rate === null) && /sin desglosar/i.test(flaggedEntry.memo), 'Mercadería tipo raro: base con tax_rate NULL + marca "IVA sin desglosar" (no inventa reparto)');

  // 7d) Abono de proveedor (negativo, forma de createReturnCredit) → resta compras y deuda
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id, entity_type, entity_id) VALUES (?, 'ABP-0001','', '2026-03-13','2026-03-13',?,?,?, 'vigente','Proveedor Uno','A99999999','supplier_return',9)").run(supId, -100, -21, -121);
  const abId = db.prepare("SELECT id FROM supplier_invoices WHERE internal_code='ABP-0001'").get().id;
  db.prepare('INSERT INTO supplier_invoice_items (supplier_invoice_id, concepto, base, tax_rate, cuota) VALUES (?,?,?,?,?)').run(abId, 'Devolución', -100, 21, -21);
  postSupplierInvoice(db, abId);
  L = entryLines('supplier_invoice', abId, 'abono_proveedor');
  ok(L && cuadra(L), 'Abono proveedor: asiento CUADRA');
  ok(cr(L, '600') === 100 && cr(L, '472') === 21 && dr(L, '400') === 121, 'Abono proveedor: RESTA compras (haber 600=100) y deuda (debe 400=121)');

  // ── 8) Pago a proveedor (del gasto, transferencia → Bancos) ──
  db.prepare("INSERT INTO supplier_payments (supplier_invoice_id, amount, paid_date, payment_method) VALUES (?,?,?,?)").run(gId, 353, '2026-03-20', 'transferencia');
  const spId = db.prepare('SELECT id FROM supplier_payments WHERE supplier_invoice_id=?').get(gId).id;
  postSupplierPayment(db, spId);
  L = entryLines('supplier_payment', spId, 'pago_proveedor');
  ok(L && cuadra(L) && dr(L, '410') === 353 && cr(L, '572') === 353, 'Pago proveedor: cargo 410 acreedores / abono 572 Bancos (353)');

  // ── 9) Backfill idempotente: re-ejecutar no duplica ──
  const before = backfillLedger(db);
  const after = backfillLedger(db);
  ok(before.errors.length === 0 && after.errors.length === 0, 'Backfill: 0 errores en ambas pasadas');
  ok(before.entries === after.entries, 'Backfill idempotente: re-ejecutar NO crea asientos nuevos (' + before.entries + ' = ' + after.entries + ')');

  // ── 10) Cuadre de los DOS libros vs documentos vivos (criterio countsAsReceivable/Payable) ──
  const RANGE = ['2000-01-01', '2100-12-31'];
  const lv = libroVentas(db, ...RANGE);
  let liveVentas = 0;
  for (const inv of db.prepare('SELECT * FROM invoices').all()) if (countsAsReceivable(db, inv)) liveVentas = r2(liveVentas + r2(inv.subtotal) + r2(inv.tax_amount));
  ok(r2(lv.totals.total) === liveVentas, 'Libro de ventas CUADRA con los documentos vivos (libro ' + lv.totals.total + ' = vivo ' + liveVentas + ')');

  // Desglose por tipo en la factura multi-tipo REAL (F1: 21% y 10%): una línea por tipo, y
  // Σ bases por tipo = base total, Σ cuotas por tipo = cuota total.
  const rowF1 = lv.rows.find(r => r.invoice_number === invF1.invoice_number);
  const sumBaseRates = r2(rowF1.desglose.reduce((s, g) => s + g.base, 0));
  const sumCuotaRates = r2(rowF1.desglose.reduce((s, g) => s + g.cuota, 0));
  ok(rowF1.desglose.length === 2 && rowF1.desglose.some(g => g.rate === 21) && rowF1.desglose.some(g => g.rate === 10), 'Desglose: la F1 multi-tipo muestra UNA línea por tipo (21% y 10%)');
  ok(sumBaseRates === rowF1.base && rowF1.base === 1200, 'Desglose: Σ bases por tipo = base total de la factura (1200)');
  ok(sumCuotaRates === rowF1.cuota && rowF1.cuota === 230, 'Desglose: Σ cuotas por tipo = cuota total de la factura (230)');
  ok(rowF1.irpf === 180, 'Desglose: la retención IRPF aparece en el libro de ventas (180)');

  const lc = libroCompras(db, ...RANGE);
  let liveCompras = 0;
  for (const si of db.prepare('SELECT * FROM supplier_invoices').all()) if (countsAsPayable(si)) liveCompras = r2(liveCompras + r2(si.base) + r2(si.tax));
  ok(r2(lc.totals.total) === liveCompras, 'Libro de compras CUADRA con los documentos vivos (libro ' + lc.totals.total + ' = vivo ' + liveCompras + ')');

  // ── 11) Invariante global: TODOS los asientos cuadran ──
  const bad = db.prepare(`SELECT e.id FROM ledger_entries e JOIN ledger_lines l ON l.entry_id=e.id
    GROUP BY e.id HAVING ROUND(SUM(l.debit),2) <> ROUND(SUM(l.credit),2)`).all();
  ok(bad.length === 0, 'Invariante: los ' + db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c + ' asientos cuadran (Σdebe=Σhaber)');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close();
  try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
