// Test de LÓGICA — COSTE DE LAS HORAS en la rentabilidad por proyecto (Escalera · paso 7 · PIEZA 4 parte 2),
// sobre BD temporal.
//   node scripts/test-coste-horas-proyecto.mjs
//
// Demuestra: coste de horas = Σ(horas × coste-hora CONGELADO) de las entradas CON coste; las entradas SIN
// coste-hora se APARTAN (no son coste 0) y se informa cuántas horas quedan fuera; el coste se CONGELA al crear
// la entrada (cambiar el coste-hora de la persona HOY NO altera un proyecto pasado); la CASCADA
// contable → gestión (resultado de gestión = resultado contable − coste de horas); el RESULTADO CONTABLE y el
// cuadre Σ proyectos + estructura = total quedan INTACTOS (el coste de horas NO toca el diario); backfill de
// entradas anteriores marcado; migración idempotente.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createProyectoSvc } from '../modules/erp/routes/proyectos.js';
import { createEntry } from '../modules/erp/routes/tiempo.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { postSupplierInvoice } from '../modules/erp/contabilidad.js';
import { cuentaPyG } from '../modules/erp/contabilidad-pyg.js';
import { rentabilidadProyecto, comparativaProyectos, costeHorasProyecto, RANGO_TODO } from '../modules/erp/rentabilidad.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const near = (a, b) => Math.abs(a - b) < 0.005;
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'costeh-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name, tax_rate, currency_symbol) VALUES (1,'Test SL','B00000000','ES','F','R','IVA',21,'€')").run();
  return db;
}
const HOY = new Date().toISOString().slice(0, 10);
const nuevoCliente = (db, n) => db.prepare("INSERT INTO clients (name,fiscal_id,country,active) VALUES (?,?, 'ES',1)").run(n, 'X0000000X').lastInsertRowid;
const nuevoProveedor = (db, n) => db.prepare("INSERT INTO suppliers (name,active) VALUES (?,1)").run(n).lastInsertRowid;
const nuevoUsuario = (db, name, tarifa, coste) => db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,tarifa_hora,coste_hora) VALUES (?,?,?, 'employee',1,?,?)").run(name, name + '@t.local', 'x', tarifa, coste).lastInsertRowid;
const setCoste = (db, uid, c) => db.prepare('UPDATE admin_users SET coste_hora=? WHERE id=?').run(c, uid);
function ventaEtiquetada(db, cliId, neto, projectId) {
  const inv = createInvoice(db, { client_id: cliId, lines: [{ description: 'Servicio', quantity: 1, unit_price: neto, tax_rate: 21 }], issue_date: HOY });
  if (projectId != null) db.prepare('UPDATE invoices SET project_id=? WHERE id=?').run(projectId, inv.id);
  return inv.id;
}
function gastoEtiquetado(db, provId, base, projectId) {
  const tax = Math.round(base * 21) / 100, total = base + tax;
  const id = db.prepare("INSERT INTO supplier_invoices (supplier_id,invoice_date,base,tax,total,status,project_id) VALUES (?,?,?,?,?, 'vigente', ?)")
    .run(provId, HOY, base, tax, total, projectId).lastInsertRowid;
  postSupplierInvoice(db, id);
  return id;
}
const contableTotal = db => Math.round(cuentaPyG(db, RANGO_TODO[0], RANGO_TODO[1]).resultadoEjercicio * 100) / 100;
// Entrada con fecha concreta (para poner horas en "el pasado" sin depender del reloj).
const horas = (db, uid, proyId, h, fecha = HOY) => createEntry(db, uid, { proyecto_id: proyId, descripcion: 'trabajo', fecha, horas: h, minutos: 0, facturable: true });

try {
  const db = nuevaBD();
  const CLI = nuevoCliente(db, 'Cliente');
  const PROV = nuevoProveedor(db, 'Proveedor');
  const U1 = nuevoUsuario(db, 'Ana', 60, 30);      // coste 30/h
  const U2 = nuevoUsuario(db, 'Beto', 50, null);   // SIN coste
  const A = createProyectoSvc(db, { nombre: 'Proyecto A', modo_cobro: 'horas', tarifa_hora: 60, cliente_id: CLI }).id;
  const B = createProyectoSvc(db, { nombre: 'Proyecto B', modo_cobro: 'horas', tarifa_hora: 60, cliente_id: CLI }).id;

  console.log('\n=== 1. Coste de horas = Σ(horas × coste-hora congelado) ===\n');
  ventaEtiquetada(db, CLI, 1000, A);   // ingresos A = 1000
  gastoEtiquetado(db, PROV, 200, A);   // gastos A = 200 → contable A = 800
  const contableAntes = contableTotal(db);
  horas(db, U1, A, 10);                // 10 h × 30 = 300
  const chA = costeHorasProyecto(db, A);
  ok(near(chA.coste, 300), 'coste de horas de A = 10 h × 30/h = 300 (' + chA.coste + ')');
  ok(chA.n_con_coste === 1 && near(chA.horas_con_coste, 10), '1 entrada con coste, 10 h con coste');
  ok(!chA.hay_horas_sin_coste, 'no hay horas sin coste todavía');

  console.log('\n=== 2. La cascada: contable INTACTO, gestión = contable − coste de horas ===\n');
  const rA = rentabilidadProyecto(db, A);
  ok(near(rA.ingresos, 1000) && near(rA.gastos, 200), 'ingresos 1000, gastos 200');
  ok(near(rA.resultado, 800), 'RESULTADO CONTABLE = 800 (INTACTO, no lo toca el coste de horas)');
  ok(near(rA.costeHoras.coste, 300), 'coste de horas en el panel = 300');
  ok(near(rA.resultadoGestion, 500), 'RESULTADO DE GESTIÓN = 800 − 300 = 500');
  ok(near(rA.margenGestionPct, 50), 'margen de gestión = 500/1000 = 50%');
  ok(near(contableTotal(db), contableAntes), 'el P&G TOTAL no cambió al registrar horas (no postea al diario)');

  console.log('\n=== 3. Entradas SIN coste-hora: se apartan, NO son coste 0 ===\n');
  horas(db, U2, A, 4);                 // 4 h sin coste (Beto sin coste-hora)
  const chA2 = costeHorasProyecto(db, A);
  ok(near(chA2.coste, 300), 'el coste de horas SIGUE 300 (las 4 h de Beto NO se cuentan como 0)');
  ok(chA2.hay_horas_sin_coste && near(chA2.horas_sin_coste, 4), 'se informan 4 h SIN coste registrado, fuera del coste');
  ok(chA2.n_sin_coste === 1, '1 entrada sin coste apartada');
  const rA2 = rentabilidadProyecto(db, A);
  ok(near(rA2.resultadoGestion, 500), 'el resultado de gestión no baja por las horas sin coste (siguen fuera)');

  console.log('\n=== 4. CONGELADO: cambiar el coste-hora HOY no altera un proyecto pasado ===\n');
  setCoste(db, U1, 99);                // sube el coste de Ana de 30 → 99
  const chA3 = costeHorasProyecto(db, A);
  ok(near(chA3.coste, 300), 'las 10 h de Ana siguen valoradas a 30 (congelado), no a 99 (' + chA3.coste + ')');
  horas(db, U1, A, 2);                 // nueva entrada: 2 h × 99 = 198 (coste vigente al crearla)
  const chA4 = costeHorasProyecto(db, A);
  ok(near(chA4.coste, 498), 'la ENTRADA NUEVA congela 99: 300 + 2×99 = 498');

  console.log('\n=== 5. El RESULTADO CONTABLE y el cuadre Σ proyectos + estructura = total, INTACTOS ===\n');
  ventaEtiquetada(db, CLI, 500, B);    // B: ingresos 500, sin gastos → contable 500
  horas(db, U1, B, 100);               // 100 h × 99 = 9900 → B pierde EN GESTIÓN pero gana en contable
  const cmp = comparativaProyectos(db);
  ok(cmp.cuadra, 'cuadre contable Σ proyectos + estructura = P&G total (al céntimo), intacto');
  const fB = cmp.filas.find(f => f.project_id === B);
  ok(near(fB.resultado, 500), 'B: resultado CONTABLE = 500 (gana en contable)');
  ok(fB.pierde === false && fB.pierde_gestion === true, 'B: NO pierde en contable pero SÍ pierde con horas (marca "pierde con horas")');
  ok(near(fB.resultado_gestion, 500 - 9900), 'B: resultado de gestión = 500 − 9900 = −9400');
  ok(near(cmp.coste_horas_total, 498 + 9900), 'coste de horas total (gestión) = 498 + 9900');
  ok(cmp.hay_horas_sin_coste && near(cmp.horas_sin_coste, 4), 'la comparativa avisa de las 4 h sin coste (agregado)');

  console.log('\n=== 6. Backfill de entradas anteriores a la función (marcado) ===\n');
  {
    const db2 = nuevaBD();
    const U = nuevoUsuario(db2, 'Vieja', 40, 25);   // coste 25
    const P = createProyectoSvc(db2, { nombre: 'Histórico', modo_cobro: 'horas', tarifa_hora: 40 }).id;
    // Simula una entrada ANTERIOR a la parte 2: coste_hora_congelado NULL y sin haber corrido el backfill.
    db2.prepare("INSERT INTO time_entries (proyecto_id,user_id,descripcion,fecha,duracion_seg,facturable,active,coste_hora_congelado,coste_backfill) VALUES (?,?,?,?,?,1,1,NULL,0)").run(P, U, 'antigua', HOY, 3 * 3600);
    db2.prepare("DELETE FROM settings WHERE key='migration_time_entries_coste_backfill_2026_v1'").run();
    runMigrations(db2);   // re-migra: el backfill estampa el coste-hora actual (25) y marca backfill=1
    const e = db2.prepare('SELECT coste_hora_congelado c, coste_backfill b FROM time_entries WHERE descripcion=?').get('antigua');
    ok(near(e.c, 25) && e.b === 1, 'la entrada antigua se estampa a 25 (coste actual) y queda MARCADA como backfill');
    const ch = costeHorasProyecto(db2, P);
    ok(near(ch.coste, 75), 'coste de horas del proyecto histórico = 3 h × 25 = 75');
    // Idempotencia: re-migrar no re-estampa (la clave ya está).
    setCoste(db2, U, 999);
    runMigrations(db2);
    const e2 = db2.prepare('SELECT coste_hora_congelado c FROM time_entries WHERE descripcion=?').get('antigua');
    ok(near(e2.c, 25), 're-migrar NO re-estampa (idempotente): sigue a 25, no a 999');
  }

  console.log('\n=== 7. Migración idempotente (columnas nuevas, sin DROP) ===\n');
  const colsAntes = db.pragma('table_info(time_entries)').map(c => c.name);
  runMigrations(db);
  const colsDespues = db.pragma('table_info(time_entries)').map(c => c.name);
  ok(colsDespues.includes('coste_hora_congelado') && colsDespues.includes('coste_backfill'), 'columnas coste_hora_congelado y coste_backfill existen');
  ok(db.pragma('table_info(admin_users)').map(c => c.name).includes('coste_hora'), 'columna admin_users.coste_hora existe');
  ok(colsAntes.length === colsDespues.length, 're-migrar no duplica columnas');
  ok(near(rentabilidadProyecto(db, A).resultado, 800), 'tras re-migrar, el resultado contable de A sigue 800');

  console.log('\n────────────────────────────────────────');
  console.log('RESULTADO: ' + pass + ' OK, ' + fail + ' FALLOS');
} catch (e) {
  console.error('\n💥 ERROR:', e); fail++;
} finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
  process.exit(fail ? 1 : 0);
}
