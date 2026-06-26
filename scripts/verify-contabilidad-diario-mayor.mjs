// Verificación — Contabilidad Pieza 2 · Libro Diario y Libro Mayor (sobre copia de la BD real).
//   node scripts/verify-contabilidad-diario-mayor.mjs
// Vistas de SOLO LECTURA sobre el cuaderno existente. Comprueba: cuadre Debe=Haber del diario
// (global y por asiento); saldo del mayor por cuenta = Σ de sus movimientos; doble entrada cierra
// (Σ saldos = 0); el diario cruza con los libros registro de la Pieza 1 (ventas/compras); drill-down
// con saldo acumulado correcto; export XLSX/CSV válido. No crea ni escribe nada.
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { backfillLedger, libroVentas, libroCompras, libroDiario, libroMayor, mayorCuenta } from '../modules/erp/contabilidad.js';
import { diarioMatrix, mayorMatrix, buildXlsx } from '../modules/erp/contabilidad-export.js';

const DBF = join(tmpdir(), 'conta-dm-' + randomBytes(4).toString('hex') + '.db');
copyFileSync('data/tenants/desarrollo-bamburu.db', DBF);
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);

try {
  console.log('\n=== Contabilidad Pieza 2 — Libro Diario y Libro Mayor ===\n');
  backfillLedger(db);
  const R = ['1900-01-01', '2999-12-31'];

  // 1) DIARIO: cuadre global y por asiento.
  const dia = libroDiario(db, ...R);
  ok(dia.rows.length > 0, 'Diario: tiene asientos (' + dia.rows.length + ')');
  ok(dia.cuadra && eq(dia.totals.debe, dia.totals.haber), 'Diario: CUADRA global — Debe ' + dia.totals.debe + ' = Haber ' + dia.totals.haber);
  ok(dia.rows.every(a => a.cuadra), 'Diario: TODOS los asientos cuadran (Σdebe=Σhaber por asiento)');

  // 2) MAYOR: Σ por cuenta = totales del diario; saldo=debe−haber; doble entrada cierra (Σ saldos=0).
  const may = libroMayor(db, ...R);
  ok(eq(may.totals.debe, dia.totals.debe) && eq(may.totals.haber, dia.totals.haber), 'Mayor: Σ Debe/Haber de las cuentas = totales del diario (' + may.totals.debe + '/' + may.totals.haber + ')');
  ok(may.rows.every(r => eq(r.saldo, r.debe - r.haber)), 'Mayor: saldo de cada cuenta = Debe − Haber');
  const sumaSaldos = r2(may.rows.reduce((s, r) => s + r.saldo, 0));
  ok(eq(sumaSaldos, 0), 'Mayor: la doble entrada cierra — Σ saldos de todas las cuentas = 0 (' + sumaSaldos + ')');

  // 3) DRILL-DOWN: saldo acumulado final = saldo de la cuenta en el mayor; Debe/Haber coinciden.
  const cuentaTop = may.rows.slice().sort((a, b) => (Math.abs(b.debe) + Math.abs(b.haber)) - (Math.abs(a.debe) + Math.abs(a.haber)))[0];
  const det = mayorCuenta(db, cuentaTop.code, ...R);
  const saldoAcum = det.rows.length ? det.rows[det.rows.length - 1].saldo : 0;
  ok(eq(det.debe, cuentaTop.debe) && eq(det.haber, cuentaTop.haber), 'Drill-down cuenta ' + cuentaTop.code + ': Debe/Haber del detalle = los del mayor');
  ok(eq(saldoAcum, cuentaTop.saldo) && eq(det.saldo, cuentaTop.saldo), 'Drill-down ' + cuentaTop.code + ': saldo acumulado final (' + saldoAcum + ') = saldo del mayor (' + cuentaTop.saldo + ')');

  // 4) CRUCE con los libros registro de la Pieza 1.
  //    Ventas: ingreso (haber−debe en 700/705) + IVA repercutido (haber−debe en 477) = total libro de ventas.
  const acc = (code, sign) => { const r = may.rows.find(x => x.code === code); return r ? r2(sign * (r.debe - r.haber)) : 0; };
  const ventasDiario = r2(-acc('700', 1) - acc('705', 1) - acc('477', 1));   // ingresos/IVA son de naturaleza acreedora
  const lv = libroVentas(db, ...R);
  ok(eq(ventasDiario, lv.totals.total), 'Cruce ventas: diario (700+705+477 = ' + ventasDiario + ') = libro de ventas (' + lv.totals.total + ')');
  //    Compras: compras/gastos (debe en 600/62x) + IVA soportado (debe en 472) = total libro de compras.
  const GASTO = ['600', '621', '622', '623', '624', '625', '626', '627', '628', '629', '472'];
  const comprasDiario = r2(GASTO.reduce((s, code) => s + acc(code, 1), 0));
  const lc = libroCompras(db, ...R);
  ok(eq(comprasDiario, lc.totals.total), 'Cruce compras: diario (600/62x+472 = ' + comprasDiario + ') = libro de compras (' + lc.totals.total + ')');

  // 5) EXPORT: una fila por línea en el diario; una fila por cuenta en el mayor; XLSX válido.
  const md = diarioMatrix(dia), mm = mayorMatrix(may);
  const totalLineas = dia.rows.reduce((s, a) => s + a.lines.length, 0);
  ok(md.rows.length === totalLineas, 'Export diario: una fila por línea de asiento (' + md.rows.length + ' = ' + totalLineas + ')');
  ok(mm.rows.length === may.rows.length, 'Export mayor: una fila por cuenta (' + mm.rows.length + ')');
  ok(md.headers.join('|') === 'Fecha|Asiento|Tipo|Concepto|Cuenta|Nombre de la cuenta|Debe|Haber' && mm.headers.join('|') === 'Cuenta|Nombre de la cuenta|Debe|Haber|Saldo', 'Export: cabeceras de diario y mayor correctas');
  const xlsx = buildXlsx([{ name: 'DIARIO', matrix: md }, { name: 'MAYOR', matrix: mm }]);
  const s = xlsx.toString('latin1');
  ok(xlsx[0] === 0x50 && xlsx[1] === 0x4B && s.includes('name="DIARIO"') && s.includes('name="MAYOR"'), 'Export: XLSX válido con hojas DIARIO y MAYOR (' + xlsx.length + ' bytes)');

  console.log('\nDiario: ' + dia.rows.length + ' asientos · ' + totalLineas + ' líneas · Debe=Haber=' + dia.totals.debe);
  console.log('Mayor: ' + may.rows.length + ' cuentas · Σ saldos=' + sumaSaldos);

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close();
  try { unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
