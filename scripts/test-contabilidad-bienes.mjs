// Test — Contabilidad Pieza 3 · libro de bienes de inversión + amortización (DB temporal nueva).
//   node scripts/test-contabilidad-bienes.mjs
// Verifica el cálculo lineal: cuota correcta; acumulada con tope = valor amortizable; respeta la
// puesta en funcionamiento; la baja corta la amortización; prorrateo por periodo; alta desde compra;
// amortizable por defecto = adquisición; y el export con columnas oficiales AEAT + XLSX válido.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { acumuladaHasta, amortizacionPeriodo, libroBienes, createInvestmentGood, updateInvestmentGood, bajaInvestmentGood, reactivarInvestmentGood } from '../modules/erp/contabilidad-bienes.js';
import { bienesMatrix, buildXlsx, PENDING_COLUMNS } from '../modules/erp/contabilidad-export.js';

const DBF = join(tmpdir(), 'bienes-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);

try {
  runMigrations(db);
  ok(!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='investment_goods'").get(), 'Migración: tabla investment_goods creada (aditiva, idempotente)');
  runMigrations(db);   // idempotente
  ok(true, 'Migración idempotente (re-ejecutar runMigrations no falla)');

  console.log('\n=== Cálculo de amortización lineal ===\n');
  const g = { amortizable_base: 1000, annual_rate: 10, start_date: '2026-01-01', baja_date: null };

  // 1) Un año natural completo → exactamente base × % (también en bisiestos).
  ok(eq(acumuladaHasta(g, '2026-12-31'), 100), 'Cuota lineal: 1000 al 10% en el año natural 2026 completo = 100,00');
  const gleap = { amortizable_base: 1000, annual_rate: 10, start_date: '2028-01-01', baja_date: null };
  ok(eq(acumuladaHasta(gleap, '2028-12-31'), 100), 'Cuota lineal en año BISIESTO (2028) completo = 100,00 (no 100,27)');

  // 2) Tope: nunca amortiza por encima del valor amortizable.
  const gcap = { amortizable_base: 1000, annual_rate: 50, start_date: '2026-01-01', baja_date: null };
  ok(eq(acumuladaHasta(gcap, '2030-01-01'), 1000), 'Tope: la acumulada NUNCA supera el valor amortizable (1000)');

  // 3) Respeta la puesta en funcionamiento: nada antes de start_date.
  const gfut = { amortizable_base: 1000, annual_rate: 10, start_date: '2026-06-01', baja_date: null };
  ok(eq(acumuladaHasta(gfut, '2026-03-01'), 0), 'Respeta puesta en funcionamiento: 0 antes de la fecha de inicio');

  // 4) La baja corta la amortización a partir de su fecha.
  const gbaja = { amortizable_base: 1000, annual_rate: 10, start_date: '2026-01-01', baja_date: '2026-07-01' };
  const enBaja = acumuladaHasta(gbaja, '2026-07-01');
  ok(eq(acumuladaHasta(gbaja, '2028-01-01'), enBaja) && enBaja < 100, 'La baja DETIENE la amortización (acumulada tras la baja = acumulada a la fecha de baja, ' + enBaja + ')');

  // 5) Prorrateo por periodo: cuota = acumulada(to) − acumulada(antes de from).
  const am = amortizacionPeriodo(g, '2026-04-01', '2026-06-30');
  const esperado = r2(acumuladaHasta(g, '2026-06-30') - acumuladaHasta(g, '2026-03-31'));
  ok(eq(am.cuota, esperado) && eq(am.acuFinal, acumuladaHasta(g, '2026-06-30')), 'Prorrateo por periodo: cuota Q2 = acumulada(fin) − acumulada(inicio) = ' + am.cuota);
  ok(eq(am.pendiente, r2(1000 - am.acuFinal)), 'Pendiente = valor amortizable − acumulada al final');

  console.log('\n=== Servicios + libro + export ===\n');
  // Alta desde una compra existente (trae proveedor/NIF/doc/valor).
  db.prepare("INSERT INTO suppliers (name, fiscal_id) VALUES ('Equipos SL','B12345678')").run();
  const supId = db.prepare('SELECT id FROM suppliers ORDER BY id LIMIT 1').get().id;
  db.prepare("INSERT INTO purchases (supplier_id, reference, date, status, total) VALUES (?,?,?,?,?)").run(supId, 'FAC-77', '2026-02-10', 'received', 3000);
  const purId = db.prepare('SELECT id FROM purchases ORDER BY id LIMIT 1').get().id;
  const r = createInvestmentGood(db, { description: 'Furgoneta', purchase_id: purId, start_date: '2026-02-10', annual_rate: 16 });
  const good = db.prepare('SELECT * FROM investment_goods WHERE id=?').get(r.id);
  ok(good.supplier_name === 'Equipos SL' && good.supplier_fiscal_id === 'B12345678' && good.doc_number === 'FAC-77', 'Alta desde compra: trae proveedor, NIF y nº de documento');
  ok(eq(good.acquisition_value, 3000), 'Alta desde compra SIN teclear valor: adquisición = total de la compra (3000)');
  ok(eq(good.amortizable_base, 3000), 'Valor amortizable por defecto = valor de adquisición (3000)');
  let baseErr = false; try { createInvestmentGood(db, { description: 'X', start_date: '2026-01-01', acquisition_value: 100, amortizable_base: -5, annual_rate: 10 }); } catch (e) { baseErr = e.status === 400; }
  ok(baseErr, 'Valor amortizable explícito no positivo → rechazado (no se sustituye en silencio)');

  // Alta manual + baja con validación.
  const r2g = createInvestmentGood(db, { description: 'Ordenador', start_date: '2026-01-01', acquisition_value: 1200, annual_rate: 25 });
  let bajaErr = false; try { bajaInvestmentGood(db, r2g.id, '2025-01-01', 'error'); } catch (e) { bajaErr = e.status === 400; }
  ok(bajaErr, 'Baja con fecha anterior a la puesta en funcionamiento → rechazada');
  bajaInvestmentGood(db, r2g.id, '2026-09-01', 'venta del equipo');
  ok(!!db.prepare('SELECT baja_date FROM investment_goods WHERE id=?').get(r2g.id).baja_date, 'Baja correcta (fecha + motivo), sin borrar el registro');

  // Libro del ejercicio 2026.
  const libro = libroBienes(db, '2026-01-01', '2026-12-31');
  ok(libro.rows.length === 2, 'Libro: lista los 2 bienes registrados');
  ok(libro.rows.every(x => eq(x.pendiente, r2(x.amortizable_base - x.acuFinal)) && x.acuFinal <= x.amortizable_base + 0.001), 'Libro: cada bien con pendiente coherente y acumulada ≤ amortizable');

  // Export: columnas oficiales + XLSX válido.
  const mat = bienesMatrix(libro, '2026-01-01', '2026-12-31');
  ok(mat.headers[0] === 'Ejercicio' && mat.rows.length === 2, 'Export: cabecera oficial (Ejercicio…) y una fila por bien');
  ['Valor Adquisición', 'Valor Amortizable', 'Método de Amortización', 'Porcentaje de Amortización', 'Cuota Resultante', 'Acumulada al Final', 'Pendiente', 'Baja del Bien-Fecha'].forEach(h =>
    ok(mat.headers.includes(h), 'Export: columna oficial presente — "' + h + '"'));
  ok(mat.rows.every(x => x[0] === '2026'), 'Export: Ejercicio 2026 cuando el periodo cae en un solo año natural');
  const matX = bienesMatrix(libroBienes(db, '2025-07-01', '2026-06-30'), '2025-07-01', '2026-06-30');
  ok(matX.rows.every(x => x[0] === ''), 'Export: rango que cruza el año → Ejercicio vacío (nunca inventado)');
  const xlsx = buildXlsx([{ name: 'BIENES_INVERSION', matrix: mat }]);
  const s = xlsx.toString('latin1');
  ok(xlsx[0] === 0x50 && xlsx[1] === 0x4B && s.includes('name="BIENES_INVERSION"') && s.includes('Cuota Resultante'), 'Export: XLSX válido con hoja BIENES_INVERSION (' + xlsx.length + ' bytes)');

  console.log('\n=== Coherencia del periodo y del ciclo baja/reactivar ===\n');
  // El libro de un ejercicio NO incluye bienes puestos en funcionamiento después del periodo.
  const rFut = createInvestmentGood(db, { description: 'Máquina futura', start_date: '2027-03-01', acquisition_value: 500, annual_rate: 10 });
  const libro26 = libroBienes(db, '2026-01-01', '2026-12-31');
  ok(!libro26.rows.some(x => x.id === rFut.id) && eq(libro26.totals.adquisicion, libro.totals.adquisicion), 'Libro 2026: excluye bienes de 2027 (filas y TOTALES)');

  // Editar no puede mover la puesta en funcionamiento más allá de la baja registrada.
  let updErr = false; try { updateInvestmentGood(db, r2g.id, { start_date: '2026-10-01' }); } catch (e) { updErr = e.status === 400; }
  ok(updErr, 'Editar: puesta en funcionamiento posterior a la baja registrada → rechazada');

  // Reactivar: 404 con id inexistente; quita la baja y conserva el motivo como rastro.
  let reacErr = false; try { reactivarInvestmentGood(db, 99999); } catch (e) { reacErr = e.status === 404; }
  ok(reacErr, 'Reactivar un id inexistente → 404 (no éxito silencioso)');
  reactivarInvestmentGood(db, r2g.id);
  const reac = db.prepare('SELECT baja_date, baja_motivo FROM investment_goods WHERE id=?').get(r2g.id);
  ok(reac.baja_date === null && reac.baja_motivo === 'venta del equipo', 'Reactivar: quita la baja y CONSERVA el motivo como rastro');
  console.log('\nColumnas oficiales sin dato en Bamburu (vacías): ' + PENDING_COLUMNS.BIENES_INVERSION.join(' · '));

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close();
  try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
