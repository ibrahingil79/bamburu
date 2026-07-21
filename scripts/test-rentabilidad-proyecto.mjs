// Test de LÓGICA — RENTABILIDAD POR PROYECTO (Escalera · paso 7 · PIEZA 4 parte 1), sobre BD temporal.
//   node scripts/test-rentabilidad-proyecto.mjs
//
// Demuestra: etiquetar factura de venta y factura recibida a un proyecto y que el P&G FILTRADO cuadra con
// los documentos; la REGLA DURA Σ(P&G de cada proyecto) + P&G de la estructura = P&G total AL CÉNTIMO (por
// resultado y por partida); reasignar un documento MUEVE su importe al proyecto nuevo (en vivo) sin cambiar
// el total; el panel (ingresos − gastos = resultado, margen); el cobrado es dato de caja aparte; la
// comparativa marca en rojo un proyecto que pierde; migración idempotente. NO toca la matemática de cuentaPyG.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createProyectoSvc } from '../modules/erp/routes/proyectos.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { postSupplierInvoice } from '../modules/erp/contabilidad.js';
import { cuentaPyG } from '../modules/erp/contabilidad-pyg.js';
import { rentabilidadProyecto, rentabilidadEstructura, comparativaProyectos, RANGO_TODO } from '../modules/erp/rentabilidad.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const near = (a, b) => Math.abs(a - b) < 0.005;
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'rent-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name, tax_rate, currency_symbol) VALUES (1,'Test SL','B00000000','ES','F','R','IVA',21,'€')").run();
  return db;
}
const HOY = new Date().toISOString().slice(0, 10);
const nuevoCliente = (db, n) => db.prepare("INSERT INTO clients (name,fiscal_id,country,active) VALUES (?,?, 'ES',1)").run(n, 'X0000000X').lastInsertRowid;
const nuevoProveedor = (db, n) => db.prepare("INSERT INTO suppliers (name,active) VALUES (?,1)").run(n).lastInsertRowid;

// Factura de VENTA con neto exacto, etiquetada a un proyecto (project_id se pone tras crear, como la UI).
function ventaEtiquetada(db, cliId, neto, projectId) {
  const inv = createInvoice(db, { client_id: cliId, lines: [{ description: 'Servicio', quantity: 1, unit_price: neto, tax_rate: 21 }], issue_date: HOY });
  if (projectId != null) db.prepare('UPDATE invoices SET project_id=? WHERE id=?').run(projectId, inv.id);
  return inv.id;
}
// Factura RECIBIDA (mercadería, sin líneas → cuenta 600) con base exacta, etiquetada. Postea al diario.
function gastoEtiquetado(db, provId, base, projectId) {
  const tax = Math.round(base * 21) / 100, total = base + tax;
  const id = db.prepare("INSERT INTO supplier_invoices (supplier_id,invoice_date,base,tax,total,status,project_id) VALUES (?,?,?,?,?, 'vigente', ?)")
    .run(provId, HOY, base, tax, total, projectId).lastInsertRowid;
  postSupplierInvoice(db, id);
  return id;
}
const resultadoTotal = db => rentabilidadEstructuraTotal(db);
const rentabilidadEstructuraTotal = db => { const pyg = cuentaPyG(db, RANGO_TODO[0], RANGO_TODO[1]); return Math.round(pyg.resultadoEjercicio * 100) / 100; };

try {
  const db = nuevaBD();
  const CLI = nuevoCliente(db, 'Cliente');
  const PROV = nuevoProveedor(db, 'Proveedor');
  const A = createProyectoSvc(db, { nombre: 'Proyecto A (gana)', modo_cobro: 'horas', tarifa_hora: 60, cliente_id: CLI }).id;
  const B = createProyectoSvc(db, { nombre: 'Proyecto B (pierde)', modo_cobro: 'horas', tarifa_hora: 60, cliente_id: CLI }).id;

  console.log('\n=== 1. Etiquetar y filtrar el P&G por proyecto ===\n');
  const fA = ventaEtiquetada(db, CLI, 1000, A);       // A: ingreso 1000
  const fB = ventaEtiquetada(db, CLI, 500, B);        // B: ingreso 500
  const fE = ventaEtiquetada(db, CLI, 300, null);     // estructura: ingreso 300
  const gB = gastoEtiquetado(db, PROV, 800, B);       // B: gasto 800
  const gE = gastoEtiquetado(db, PROV, 200, null);    // estructura: gasto 200

  const rA = rentabilidadProyecto(db, A);
  ok(near(rA.ingresos, 1000) && near(rA.gastos, 0) && near(rA.resultado, 1000), 'A: ingresos 1000, gastos 0, resultado 1000');
  ok(near(rA.margenPct, 100), 'A: margen 100%');
  const rB = rentabilidadProyecto(db, B);
  ok(near(rB.ingresos, 500) && near(rB.gastos, 800) && near(rB.resultado, -300), 'B: ingresos 500, gastos 800, resultado −300');
  const rEstr = rentabilidadEstructura(db);
  ok(near(rEstr.ingresos, 300) && near(rEstr.gastos, 200) && near(rEstr.resultado, 100), 'estructura (no asignado): ingresos 300, gastos 200, resultado 100');

  console.log('\n=== 2. REGLA DURA: Σ proyectos + estructura = total al céntimo ===\n');
  const total = rentabilidadEstructuraTotal(db);
  ok(near(total, 800), 'P&G total = 800 (1000 − 300 + 100)');
  ok(near(rA.resultado + rB.resultado + rEstr.resultado, total), 'Σ(A + B) + estructura = total, al céntimo');
  // También por PARTIDA (INCN = importe neto cifra de negocios): 1000 + 500 + 300 = 1800.
  const incn = pyg => pyg.partidas.find(p => p.key === 'incn').importe;
  const incnA = incn(cuentaPyG(db, RANGO_TODO[0], RANGO_TODO[1], { project: A }));
  const incnB = incn(cuentaPyG(db, RANGO_TODO[0], RANGO_TODO[1], { project: B }));
  const incnE = incn(cuentaPyG(db, RANGO_TODO[0], RANGO_TODO[1], { project: null }));
  const incnT = incn(cuentaPyG(db, RANGO_TODO[0], RANGO_TODO[1]));
  ok(near(incnA + incnB + incnE, incnT) && near(incnT, 1800), 'por partida (INCN): 1000 + 500 + 300 = total 1800');

  console.log('\n=== 3. cuentaPyG SIN filtro es idéntica a antes (compat) ===\n');
  const sinArg = cuentaPyG(db, RANGO_TODO[0], RANGO_TODO[1]);
  const conUndef = cuentaPyG(db, RANGO_TODO[0], RANGO_TODO[1], {});
  ok(near(sinArg.resultadoEjercicio, conUndef.resultadoEjercicio) && near(sinArg.resultadoEjercicio, 800), 'llamar con {} o sin opts da el mismo total (no cambia la matemática)');

  console.log('\n=== 4. Reasignar MUEVE el importe, sin cambiar el total ===\n');
  db.prepare('UPDATE supplier_invoices SET project_id=? WHERE id=?').run(A, gE);   // el gasto 200 de estructura → A
  const rA2 = rentabilidadProyecto(db, A), rEstr2 = rentabilidadEstructura(db), total2 = rentabilidadEstructuraTotal(db);
  ok(near(rA2.resultado, 800), 'tras reasignar el gasto 200 a A: A resultado 1000 − 200 = 800');
  ok(near(rEstr2.resultado, 300), 'estructura queda en 300 (solo el ingreso 300)');
  ok(near(total2, 800), 'el P&G TOTAL no cambia por reasignar (800)');
  ok(near(rA2.resultado + rentabilidadProyecto(db, B).resultado + rEstr2.resultado, total2), 'sigue cuadrando tras reasignar');
  db.prepare('UPDATE supplier_invoices SET project_id=? WHERE id=?').run(null, gE);   // deshacer para el resto

  console.log('\n=== 5. Cobrado = dato de caja aparte (no cambia el resultado) ===\n');
  db.prepare('INSERT INTO invoice_payments (invoice_id, amount, paid_date) VALUES (?,?,?)').run(fA, 400, HOY);
  const rA3 = rentabilidadProyecto(db, A);
  ok(near(rA3.cobrado, 400), 'A: cobrado = 400 (un cobro parcial)');
  ok(near(rA3.resultado, 1000), 'A: el resultado (facturado) sigue 1000 — el cobrado no lo toca');

  console.log('\n=== 6. Comparativa: cuadra y marca al que pierde ===\n');
  const cmp = comparativaProyectos(db);
  ok(cmp.cuadra, 'la comparativa CUADRA (Σ proyectos + estructura = total): descuadre ' + cmp.descuadre);
  ok(near(cmp.total.resultado, 800), 'total de la comparativa = 800');
  const filaB = cmp.filas.find(f => f.project_id === B);
  ok(filaB && filaB.pierde === true, 'B aparece marcado como que PIERDE (gastos > ingresos)');
  const filaA = cmp.filas.find(f => f.project_id === A);
  ok(filaA && filaA.pierde === false, 'A no pierde');
  ok(cmp.filas[0].project_id === B, 'ordena primero al que más pierde (B)');

  console.log('\n=== 7. Migración idempotente (columnas + índices) ===\n');
  runMigrations(db); runMigrations(db);
  const colInv = db.prepare("SELECT COUNT(*) n FROM pragma_table_info('invoices') WHERE name='project_id'").get().n;
  const colSup = db.prepare("SELECT COUNT(*) n FROM pragma_table_info('supplier_invoices') WHERE name='project_id'").get().n;
  ok(colInv === 1 && colSup === 1, 'columnas invoices.project_id y supplier_invoices.project_id existen (una sola vez)');
  const idx = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name IN ('idx_invoices_project','idx_supplier_invoices_project')").get().n;
  ok(idx === 2, 'ambos índices existen');
  ok(near(rentabilidadEstructuraTotal(db), 800), 'tras re-migrar, el total sigue 800 (nada se recalculó ni movió)');

  console.log('\n────────────────────────────────────────');
  console.log(`RESULTADO: ${pass} OK, ${fail} FALLOS`);
} catch (e) {
  console.error('\n💥 EXCEPCIÓN NO CONTROLADA:', e);
  fail++;
} finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
process.exit(fail ? 1 : 0);
