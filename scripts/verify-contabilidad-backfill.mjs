// Verificación — Contabilidad Pieza 1 · backfill sobre COPIA de la BD real.
//   node scripts/verify-contabilidad-backfill.mjs
// Copia data/tenants/desarrollo-bamburu.db a un temporal, corre el backfill, y verifica:
// datos intactos; 0 errores de posteo; TODO asiento cuadra; backfill idempotente (re-ejecutar
// no duplica); y CUADRE de los dos libros vs los documentos vivos del mismo periodo
// (countsAsReceivable / countsAsPayable), sin doble conteo y con anuladas/sustituidas fuera.
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { backfillLedger, libroVentas, libroCompras } from '../modules/erp/contabilidad.js';
import { countsAsReceivable } from '../modules/erp/cobros.js';
import { countsAsPayable } from '../modules/erp/pagos.js';

const SRC = 'data/tenants/desarrollo-bamburu.db';
const DBF = join(tmpdir(), 'conta-backfill-' + randomBytes(4).toString('hex') + '.db');
copyFileSync(SRC, DBF);
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

try {
  console.log('\n=== Contabilidad — backfill sobre copia de la BD real ===\n');

  // Conteos previos (datos intactos).
  const cnt = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  const before = { invoices: cnt('invoices'), items: cnt('invoice_items'), pays: cnt('invoice_payments'),
                   sinv: cnt('supplier_invoices'), spays: cnt('supplier_payments') };

  // 1) Backfill.
  const r1 = backfillLedger(db);
  ok(r1.errors.length === 0, 'Backfill: 0 errores de posteo' + (r1.errors.length ? ' — ' + r1.errors.slice(0, 3).join(' | ') : ''));
  ok(r1.entries > 0, 'Backfill: generó asientos (' + r1.entries + ')');

  // 2) Datos de los documentos intactos (el motor es de SOLO LECTURA sobre ellos).
  const after = { invoices: cnt('invoices'), items: cnt('invoice_items'), pays: cnt('invoice_payments'),
                  sinv: cnt('supplier_invoices'), spays: cnt('supplier_payments') };
  ok(JSON.stringify(before) === JSON.stringify(after), 'Documentos intactos tras el backfill (sin altas/bajas): ' + JSON.stringify(after));

  // 3) Todo asiento cuadra (Σdebe = Σhaber).
  const bad = db.prepare(`SELECT e.id FROM ledger_entries e JOIN ledger_lines l ON l.entry_id=e.id
    GROUP BY e.id HAVING ROUND(SUM(l.debit),2) <> ROUND(SUM(l.credit),2)`).all();
  ok(bad.length === 0, 'Todos los asientos cuadran (Σdebe=Σhaber) — ' + r1.entries + ' asientos');

  // 4) Idempotente: re-ejecutar no duplica.
  const r2run = backfillLedger(db);
  ok(r1.entries === r2run.entries && r2run.errors.length === 0, 'Backfill idempotente: re-ejecutar NO duplica (' + r1.entries + ' = ' + r2run.entries + ')');

  // 5) Cuadre del LIBRO DE VENTAS vs documentos vivos (todo el histórico).
  const R = ['1900-01-01', '2999-12-31'];
  const lv = libroVentas(db, ...R);
  let liveV = 0;
  for (const inv of db.prepare('SELECT * FROM invoices').all()) if (countsAsReceivable(db, inv)) liveV = r2(liveV + r2(inv.subtotal) + r2(inv.tax_amount));
  ok(r2(lv.totals.total) === liveV, 'Libro de VENTAS cuadra con documentos vivos (libro ' + r2(lv.totals.total) + ' = vivo ' + liveV + ')');

  // 6) Cuadre del LIBRO DE COMPRAS vs documentos vivos.
  const lc = libroCompras(db, ...R);
  let liveC = 0;
  for (const si of db.prepare('SELECT * FROM supplier_invoices').all()) if (countsAsPayable(si)) liveC = r2(liveC + r2(si.base) + r2(si.tax));
  ok(r2(lc.totals.total) === liveC, 'Libro de COMPRAS cuadra con documentos vivos (libro ' + r2(lc.totals.total) + ' = vivo ' + liveC + ')');

  // 7) Anti-doble-conteo explícito: ninguna factura sustituida (ticket→F3) ni anulada aparece en el libro.
  const subTickets = db.prepare('SELECT substitutes_invoice_id s FROM invoices WHERE substitutes_invoice_id IS NOT NULL').all().map(r => r.s);
  const anuladas = db.prepare("SELECT id FROM invoices WHERE status='anulada'").all().map(r => r.id);
  const libroNums = new Set(lv.rows.map(r => r.invoice_number));
  const numOf = id => db.prepare('SELECT invoice_number FROM invoices WHERE id=?').get(id)?.invoice_number;
  const leakTickets = subTickets.filter(id => libroNums.has(numOf(id)));
  const leakAnul = anuladas.filter(id => libroNums.has(numOf(id)));
  ok(leakTickets.length === 0, 'Tickets sustituidos por F3 NO aparecen en el libro (anti-doble-conteo): ' + subTickets.length + ' sustituidos, 0 fugados');
  ok(leakAnul.length === 0, 'Facturas anuladas NO aparecen en el libro (neteadas): ' + anuladas.length + ' anuladas, 0 fugadas');

  // 8) Periodo real concreto (mes con más facturas): el libro suma == vivo de ese mes.
  const topMonth = db.prepare("SELECT substr(issue_date,1,7) ym, COUNT(*) n FROM invoices WHERE issue_date IS NOT NULL GROUP BY ym ORDER BY n DESC LIMIT 1").get();
  if (topMonth) {
    const mFrom = topMonth.ym + '-01', mTo = topMonth.ym + '-31';
    const mlv = libroVentas(db, mFrom, mTo);
    let mLive = 0;
    for (const inv of db.prepare("SELECT * FROM invoices WHERE substr(issue_date,1,7)=?").all(topMonth.ym)) if (countsAsReceivable(db, inv)) mLive = r2(mLive + r2(inv.subtotal) + r2(inv.tax_amount));
    ok(r2(mlv.totals.total) === mLive, 'Periodo real ' + topMonth.ym + ' (' + topMonth.n + ' facturas): libro de ventas (' + r2(mlv.totals.total) + ') = vivo (' + mLive + ')');
  }

  // 9) Coherencia del DESGLOSE por tipo en TODAS las filas (ventas y compras): Σ por tipo = total fila.
  const desgloseCoherente = (rows) => rows.every(r =>
    r2(r.desglose.reduce((s, g) => s + g.base, 0)) === r2(r.base) &&
    r2(r.desglose.reduce((s, g) => s + g.cuota, 0)) === r2(r.cuota));
  ok(desgloseCoherente(lv.rows) && desgloseCoherente(lc.rows), 'Desglose por tipo coherente en todas las filas (Σ bases por tipo = base; Σ cuotas por tipo = cuota)');

  // 10) Si hay una factura multi-tipo real, mostrarla y verificar su desglose explícito.
  const multi = lv.rows.find(r => r.desglose.length > 1) || lc.rows.find(r => r.desglose.length > 1);
  if (multi) {
    const sb = r2(multi.desglose.reduce((s, g) => s + g.base, 0)), sc = r2(multi.desglose.reduce((s, g) => s + g.cuota, 0));
    ok(sb === r2(multi.base) && sc === r2(multi.cuota), 'Factura multi-tipo real ' + (multi.invoice_number || multi.internal_code) + ': ' + multi.desglose.map(g => (g.rate ?? 's/d') + '%→base ' + g.base + '/cuota ' + g.cuota).join(' · ') + ' → Σ base ' + sb + ' / Σ cuota ' + sc);
  } else {
    console.log('  · (sin factura multi-tipo en los datos reales; cubierto en test-contabilidad.mjs con F1 21%+10%)');
  }

  console.log('\nResumen libro de ventas (histórico): base ' + lv.totals.base + ' · cuota ' + lv.totals.cuota + ' · total ' + lv.totals.total + ' · ' + lv.rows.length + ' facturas');
  console.log('Resumen libro de compras (histórico): base ' + lc.totals.base + ' · cuota ' + lc.totals.cuota + ' · total ' + lc.totals.total + ' · ' + lc.rows.length + ' facturas');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close();
  try { unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
