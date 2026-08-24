// Verificación — Contabilidad Pieza 1 · exportación (formato oficial AEAT) sobre copia BD real.
//   node scripts/verify-contabilidad-export.mjs
// UN ASIENTO = UNA FILA (una por tipo de IVA; multi-tipo = varias filas, mismo nº de factura).
// "Total Factura" = subtotal de cada línea (Σ = total factura, base+IVA, sin restar IRPF);
// retención sólo en la 1ª línea. Hojas EXPEDIDAS_INGRESOS/RECIBIDAS_GASTOS; columnas en orden
// oficial; XLSX/CSV válidos. No recalcula: consume libroVentas/libroCompras.
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { backfillLedger, libroVentas, libroCompras } from '../modules/erp/contabilidad.js';
import { ventasAsientos, comprasAsientos, ventasMatrix, comprasMatrix, toCSV, buildXlsx, PENDING_COLUMNS } from '../modules/erp/contabilidad-export.js';
// 24 ago 2026 · La copia va por `copiarBase` (sqlite .backup), no por copyFileSync: los negocios
// corren en WAL y un `cp` deja fuera el -wal, o sea mide una foto vieja. Ver scripts/lib/copia-consistente.mjs.
import { copiarBase } from './lib/copia-consistente.mjs';

const DBF = join(tmpdir(), 'conta-export-' + randomBytes(4).toString('hex') + '.db');
copiarBase('data/tenants/desarrollo-bamburu.db', DBF);
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

try {
  console.log('\n=== Contabilidad — exportación (formato oficial AEAT) ===\n');
  backfillLedger(db);
  const R = ['1900-01-01', '2999-12-31'];
  const lv = libroVentas(db, ...R), lc = libroCompras(db, ...R);
  const av = ventasAsientos(lv), ac = comprasAsientos(lc);
  const mv = ventasMatrix(lv), mc = comprasMatrix(lc);

  // 1) Un asiento = una fila (Σ desgloses = nº de asientos = nº de filas del export).
  const totalDesgloses = lv.rows.reduce((s, r) => s + Math.max(1, r.desglose.length), 0);
  ok(av.length === totalDesgloses && mv.rows.length === av.length, 'Ventas: una fila por asiento (' + mv.rows.length + ' filas = ' + totalDesgloses + ' líneas de tipo)');
  ok(mc.rows.length === ac.length, 'Compras: una fila por asiento (' + mc.rows.length + ' filas)');

  // 2) Cabeceras oficiales en orden (EXPEDIDAS_INGRESOS).
  ok(mv.headers[0] === 'Ejercicio' && mv.headers[1] === 'Periodo' && mv.headers[5] === 'Tipo de Factura' && mv.headers[8] === 'Fecha Expedición', 'EXPEDIDAS: primeras columnas en orden oficial (Ejercicio·Periodo·…·Tipo de Factura·Fecha Expedición)');
  ['Total Factura', 'Base Imponible', 'Tipo de IVA', 'Cuota IVA Repercutida', 'Importe Retenido del IRPF', 'Operación Exenta'].forEach(h =>
    ok(mv.headers.includes(h), 'EXPEDIDAS: columna oficial presente — "' + h + '"'));
  ['Base Imponible', 'Tipo de IVA', 'Cuota IVA Soportado', 'Total Factura', 'Cuota Deducible'].forEach(h =>
    ok(mc.headers.includes(h), 'RECIBIDAS: columna oficial presente — "' + h + '"'));

  // 3) Factura multi-tipo real: varias filas, mismo nº; Σ bases/cuotas = totales; Σ Total Factura = base+IVA.
  const multiNum = lv.rows.find(r => r.desglose.length > 1)?.invoice_number;
  if (multiNum) {
    const filas = av.filter(a => a.invoice_number === multiNum);
    const sb = r2(filas.reduce((s, a) => s + a.base, 0)), sc = r2(filas.reduce((s, a) => s + a.cuota, 0));
    const sTot = r2(filas.reduce((s, a) => s + a.total_linea, 0));
    const libroRow = lv.rows.find(r => r.invoice_number === multiNum);
    ok(filas.length === libroRow.desglose.length && filas.length > 1, multiNum + ': ' + filas.length + ' filas (una por tipo), mismo nº de factura');
    ok(sb === r2(libroRow.base) && sc === r2(libroRow.cuota), multiNum + ': Σ bases=' + sb + ' Σ cuotas=' + sc + ' = totales de la factura');
    ok(sTot === r2(libroRow.base + libroRow.cuota), 'BLINDAJE: Σ "Total Factura" de las líneas = base+IVA (' + sTot + '), sin restar IRPF ni duplicar');
  }

  // 4) "Total Factura" por línea = base+cuota de esa línea (en TODAS las filas).
  const ti = mv.headers.indexOf('Total Factura'), bi = mv.headers.indexOf('Base Imponible'), qi = mv.headers.indexOf('Cuota IVA Repercutida');
  ok(mv.rows.every(r => Math.round((r[ti] || 0) * 100) === Math.round(((r[bi] || 0) + (r[qi] || 0)) * 100)), 'EXPEDIDAS: "Total Factura" de cada fila = Base+Cuota de esa línea (regla oficial de subtotal)');

  // 5) Retención sólo en la primera línea de cada factura (no repetida).
  const irpfCol = mv.headers.indexOf('Importe Retenido del IRPF');
  const conRet = av.filter(a => a.irpf != null && a.irpf !== 0);
  const repetida = av.some(a => !a.primera && a.irpf != null && a.irpf !== 0);
  ok(!repetida, 'EXPEDIDAS: retención IRPF anotada SÓLO en la 1ª línea de la factura' + (conRet.length ? ' (' + conRet.length + ' facturas con retención)' : ' (ninguna con IRPF)'));

  // 6) Rectificativas marcadas con tipo R.
  const rec = av.find(a => a.es_rectificativa);
  if (rec) ok(/^R/.test(rec.tipo_factura), 'Rectificativa ' + rec.invoice_number + ' marcada (tipo ' + rec.tipo_factura + (rec.rect_mode ? '·' + rec.rect_mode : '') + ')');
  else console.log('  · (sin rectificativa en el periodo real; cubierto en test de lógica)');

  // 7) CSV: BOM + ';' + una línea por asiento + cabecera.
  const csv = toCSV(mv); const lines = csv.split('\r\n');
  ok(csv.charCodeAt(0) === 0xFEFF && lines[0].replace(/^﻿/, '').split(';')[0] === 'Ejercicio', 'CSV: BOM + cabecera oficial separada por ";"');
  ok(lines.length === av.length + 1, 'CSV: una línea por asiento + cabecera (' + (lines.length - 1) + ' filas)');

  // 8) XLSX válido (ZIP STORE) con hojas oficiales y cabeceras embebidas.
  const xlsx = buildXlsx([{ name: 'EXPEDIDAS_INGRESOS', matrix: mv }, { name: 'RECIBIDAS_GASTOS', matrix: mc }]);
  const s = xlsx.toString('latin1');
  ok(xlsx[0] === 0x50 && xlsx[1] === 0x4B, 'XLSX: firma ZIP "PK"');
  ok(s.includes('name="EXPEDIDAS_INGRESOS"') && s.includes('name="RECIBIDAS_GASTOS"'), 'XLSX: hojas con nombres oficiales EXPEDIDAS_INGRESOS / RECIBIDAS_GASTOS');
  ok(xlsx.length < 4 * 1024 * 1024, 'XLSX: tamaño < 4 MB (ejercicio completo en un fichero) — ' + xlsx.length + ' bytes');
  const tmpx = join(tmpdir(), 'libro-' + randomBytes(3).toString('hex') + '.xlsx');
  writeFileSync(tmpx, xlsx);
  console.log('  · XLSX de muestra: ' + tmpx + ' (' + xlsx.length + ' bytes) — validar apertura abajo');

  // 9) Reporte de columnas oficiales sin dato.
  console.log('\nColumnas oficiales SIN dato en Bamburu (vacías, NO inventadas):');
  console.log('  EXPEDIDAS_INGRESOS: ' + PENDING_COLUMNS.EXPEDIDAS_INGRESOS.join(' · '));
  console.log('  RECIBIDAS_GASTOS:   ' + PENDING_COLUMNS.RECIBIDAS_GASTOS.join(' · '));
  console.log('\nXLSX de muestra para validación externa: ' + tmpx);

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close();
  try { unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
