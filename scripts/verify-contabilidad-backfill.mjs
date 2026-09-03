// Verificación — Contabilidad Pieza 1 · backfill sobre COPIA de la BD real.
//   node scripts/verify-contabilidad-backfill.mjs
// Copia data/tenants/desarrollo-bamburu.db a un temporal, corre el backfill, y verifica:
// datos intactos; 0 errores de posteo; TODO asiento cuadra; backfill idempotente (re-ejecutar
// no duplica); y CUADRE de los dos libros vs los documentos vivos del mismo periodo
// (countsAsReceivable / countsAsPayable), sin doble conteo y con anuladas/sustituidas fuera.
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { backfillLedger, libroVentas, libroCompras, correccionesDeOtroPeriodo } from '../modules/erp/contabilidad.js';
import { countsAsReceivable } from '../modules/erp/cobros.js';
import { countsAsPayable } from '../modules/erp/pagos.js';

const SRC = 'data/tenants/desarrollo-bamburu.db';
const DBF = join(tmpdir(), 'conta-backfill-' + randomBytes(4).toString('hex') + '.db');
// LA COPIA SE HACE CON .backup, NO CON copyFileSync. 24 ago 2026: esta comprobación llevaba días
// dando tumbos —roja en el barrido con «libro 119976.28 = vivo 119649.28», verde media hora después
// sin que nadie tocara nada, y siempre el mismo desfase de 327,00 €—. No era el producto ni una
// carrera: el negocio está en modo WAL, y `copyFileSync` se lleva el fichero .db pero deja fuera el
// -wal, que es donde viven los últimos cambios confirmados. La comprobación medía una foto vieja.
// Medido: el original leído con su WAL daba desfase 0 y un `cp` del mismo fichero daba 654,00 €.
// `.backup` de sqlite copia la base ENTERA, WAL incluido, y de forma consistente.
execFileSync('sqlite3', [SRC, ".backup '" + DBF + "'"]);
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

  // 5 y 6) Cuadre de los LIBROS vs documentos vivos (todo el histórico).
  //
  // LAS CUATRO LECTURAS VAN EN UNA SOLA FOTO. 24 ago 2026: esto salió ROJO en el barrido de anoche
  // —«libro 119976.28 = vivo 119649.28», 327,00 € de más EN EL LIBRO— y a la mañana siguiente estaba
  // verde sin que nadie tocara nada. No era el producto: era esta comprobación. Leía el libro, y
  // DESPUÉS recorría los documentos. Entre las dos lecturas, otra de las 204 comprobaciones que
  // corren a la vez sobre el mismo negocio anulaba facturas de proveedor: el libro ya las había
  // contado y el segundo recuento ya no. Por eso el desfase siempre salía del mismo signo, libro >
  // vivo, nunca al revés. Reproducido en una copia: anular 93,06 € entre las dos lecturas da un
  // desfase de exactamente 93,06 €; con la foto puesta, da 0 aunque la otra conexión anule en medio.
  //
  // La foto NO ablanda nada: se sigue exigiendo cuadre exacto al céntimo. Solo obliga a que los dos
  // lados se midan en el mismo instante, que es lo único que la comprobación quería decir.
  const R = ['1900-01-01', '2999-12-31'];
  const foto = db.transaction(() => {
    const lv = libroVentas(db, ...R);
    let liveV = 0;
    for (const inv of db.prepare('SELECT * FROM invoices').all()) if (countsAsReceivable(db, inv)) liveV = r2(liveV + r2(inv.subtotal) + r2(inv.tax_amount));
    const lc = libroCompras(db, ...R);
    let liveC = 0;
    for (const si of db.prepare('SELECT * FROM supplier_invoices').all()) if (countsAsPayable(si)) liveC = r2(liveC + r2(si.base) + r2(si.tax));
    return { lv, liveV, lc, liveC };
  });
  const { lv, liveV, lc, liveC } = foto();
  ok(r2(lv.totals.total) === liveV, 'Libro de VENTAS cuadra con documentos vivos (libro ' + r2(lv.totals.total) + ' = vivo ' + liveV + ')');
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
    // ── LAS CORRECCIONES DE OTRO PERIODO, DESCONTADAS ────────────────────────────────────────────
    // Un asiento que anula a otro se fecha el día que se hace: no se reabre un periodo cerrado. Así
    // que la corrección de un apunte de junio aterriza en el mes en curso con signo negativo, y este
    // periodo se compara contra las facturas EMITIDAS en él — que no incluyen esa de junio.
    // Medido el 24 ago 2026: 992,20 € en cinco asientos, todos reversiones de enero a marzo.
    // No se afloja la aserción: se hace que compare lo mismo en los dos lados. Una corrección de otro
    // periodo no es una venta de este, y contarla como si lo fuera deja un rojo PERMANENTE — y un rojo
    // permanente se acaba ignorando, que es como se llega a 99 comprobaciones que no mira nadie.
    const corr = correccionesDeOtroPeriodo(db, 'invoice', mFrom, mTo);
    let mLive = 0;
    for (const inv of db.prepare("SELECT * FROM invoices WHERE substr(issue_date,1,7)=?").all(topMonth.ym)) if (countsAsReceivable(db, inv)) mLive = r2(mLive + r2(inv.subtotal) + r2(inv.tax_amount));
    const mLibro = r2(r2(mlv.totals.total) - corr.total);
    ok(mLibro === mLive, 'Periodo real ' + topMonth.ym + ' (' + topMonth.n + ' facturas): libro de ventas ('
      + mLibro + ') = vivo (' + mLive + ')'
      + (corr.detalle.length
         ? '  ·  descontadas ' + corr.detalle.length + ' correcciones de otro periodo por ' + r2(-corr.total) + ' €'
           + ' (el libro en bruto suma ' + r2(mlv.totals.total) + ')'
         : ''));

    // ── Y QUE LA REGLA SIGA CUBRIENDO LOS DOS SENTIDOS ───────────────────────────────────────────
    // 3 sep 2026. `correccionesDeOtroPeriodo` prometía en su comentario «comparar lo mismo en los dos
    // lados» y **solo miraba uno**: la reversión fechada DENTRO del periodo con su original fuera. Le
    // faltaba el espejo —el original DENTRO y su reversión FUERA—, que es lo que sale al corregir en
    // septiembre un apunte de agosto. Costó 96,80 € de descuadre en el libro de agosto y una tarde de
    // perseguir un fallo del producto que no existía.
    //
    // Esto NO mira los datos del negocio, que cambian solos: monta una base de mentira con **los dos
    // casos exactos** y exige que la función los vea. Si alguien vuelve a escribir la regla a medias,
    // sale en rojo aquí y no dentro de un mes, cuando alguien corrija un apunte del mes anterior.
    const bd = new Database(':memory:');
    bd.exec(`CREATE TABLE ledger_entries (id INTEGER PRIMARY KEY, entry_date DATE NOT NULL,
      entry_type TEXT NOT NULL, origin_type TEXT NOT NULL, origin_id INTEGER NOT NULL,
      reverses_entry_id INTEGER, memo TEXT DEFAULT '', created_at DATETIME);
     CREATE TABLE ledger_lines (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL,
      account_code TEXT NOT NULL, debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0,
      tax_rate REAL, line_kind TEXT);`);
    const asi = (id, fecha, tipo, origen, revierte) =>
      bd.prepare('INSERT INTO ledger_entries (id,entry_date,entry_type,origin_type,origin_id,reverses_entry_id) VALUES (?,?,?,?,?,?)')
        .run(id, fecha, tipo, 'invoice', origen, revierte || null);
    const lin = (id, cuenta, debe, haber) =>
      bd.prepare('INSERT INTO ledger_lines (entry_id,account_code,debit,credit) VALUES (?,?,?,?)').run(id, cuenta, debe, haber);
    const vta = (id, base, iva) => { lin(id, '430', base + iva, 0); lin(id, '700', 0, base); lin(id, '477', 0, iva); };
    const rev = (id, base, iva) => { lin(id, '430', 0, base + iva); lin(id, '700', base, 0); lin(id, '477', iva, 0); };
    asi(1, '2026-01-15', 'asiento', 101, null); vta(1, 100, 21);    // original FUERA
    asi(2, '2026-08-10', 'reversion', 101, 1);  rev(2, 100, 21);    //   reversión DENTRO
    asi(3, '2026-08-20', 'asiento', 202, null); vta(3, 40, 8.40);   // original DENTRO  ← el espejo
    asi(4, '2026-09-03', 'reversion', 202, 3);  rev(4, 40, 8.40);   //   reversión FUERA
    const dos = correccionesDeOtroPeriodo(bd, 'invoice', '2026-08-01', '2026-08-31');
    const veA = dos.detalle.some(f => f.origin_id === 101);
    const veB = dos.detalle.some(f => f.origin_id === 202);
    bd.close();
    ok(veA, 'la regla ve la reversión fechada DENTRO del periodo con su original fuera');
    ok(veB, 'y ve el ESPEJO: el original dentro del periodo con su reversión fuera (el punto ciego del 3 sep)');
    ok(veA && veB && r2(dos.total) === -72.6,
       'y las suma con su signo: la de fuera sube el periodo y la de dentro lo baja', r2(dos.total) + ' € (esperado -72,6)');
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
