// Test de LÓGICA — REGISTRO DE TIEMPO (Escalera · paso 7 · PIEZA 2), sobre BD temporal.
//   node scripts/test-tiempo.mjs
//
// Demuestra: cronómetro (start/stop) con duración EXACTA (sin redondeos); UN solo cronómetro activo por
// persona (arrancar uno nuevo finaliza el anterior); entrada manual; facturable; importe con la tarifa de
// la PERSONA (y la del proyecto de respaldo, o "sin tarifa" si no hay ninguna); PROPIEDAD (cada uno las
// suyas; dueño/admin cualquiera); eliminar = ocultar (no destruir); total por proyecto; migración idempotente.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createProyectoSvc } from '../modules/erp/routes/proyectos.js';
import { startTimer, stopTimer, createEntry, updateEntry, deleteEntry, corriendoDe, semanaDe, tiempoDeProyecto } from '../modules/erp/routes/tiempo.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
const intenta = fn => { try { return { r: fn() }; } catch (e) { return { e }; } };
function nuevaBD() {
  const f = join(tmpdir(), 'tiempo-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name, currency_symbol) VALUES (1,'Test SL','B00000000','ES','F','R','IVA','€')").run();
  return db;
}
const nuevoUsuario = (db, name, tarifa) => { const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,tarifa_hora) VALUES (?,?,?,'employee',1,?)").run(name, name + '@t.local', 'x', tarifa).lastInsertRowid; return id; };
const HOY = new Date().toISOString().slice(0, 10);

try {
  const db = nuevaBD();
  const U1 = nuevoUsuario(db, 'Ana', 60);        // con tarifa 60/h
  const U2 = nuevoUsuario(db, 'Beto', null);     // sin tarifa
  const ADMIN = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Jefa','jefa@t.local','x','owner',1)").run().lastInsertRowid;
  const P1 = createProyectoSvc(db, { nombre: 'Con tarifa de proyecto', modo_cobro: 'horas', tarifa_hora: 40 }).id;
  const P2 = createProyectoSvc(db, { nombre: 'Sin tarifa', modo_cobro: 'horas' }).id;

  console.log('\n=== 1. Cronómetro: duración EXACTA, sin redondeos ===\n');
  const run = startTimer(db, U1, { proyecto_id: P1, descripcion: 'Analizando' });
  ok(run.corriendo && run.duracion_seg == null, 'al arrancar, la entrada queda CORRIENDO (duración null)');
  // Forzamos un started_at conocido (3661 s = 1h 1m 1s atrás) para comprobar el cálculo exacto.
  db.prepare('UPDATE time_entries SET started_at=? WHERE id=?').run(new Date(Date.now() - 3661000).toISOString(), run.id);
  const stopped = stopTimer(db, U1);
  ok(stopped.duracion_seg >= 3660 && stopped.duracion_seg <= 3663, 'al parar, la duración es la exacta (~3661 s, sin redondear a bloques): ' + stopped.duracion_seg + 's');

  console.log('\n=== 2. UN solo cronómetro activo por persona ===\n');
  const r1 = startTimer(db, U1, { proyecto_id: P1, descripcion: 'Tarea A' });
  const r2 = startTimer(db, U1, { proyecto_id: P2, descripcion: 'Tarea B' });
  const corriendo = db.prepare('SELECT COUNT(*) n FROM time_entries WHERE user_id=? AND active=1 AND duracion_seg IS NULL').get(U1).n;
  ok(corriendo === 1, 'tras arrancar dos, solo queda UNO corriendo (el anterior se finalizó): ' + corriendo);
  ok(corriendoDe(db, U1).id === r2.id, 'el cronómetro activo es el último arrancado (Tarea B)');
  ok(db.prepare('SELECT duracion_seg FROM time_entries WHERE id=?').get(r1.id).duracion_seg != null, 'el anterior (Tarea A) quedó finalizado con su duración');
  stopTimer(db, U1);   // limpiar
  ok(intenta(() => stopTimer(db, U1)).e?.status === 400, 'parar sin cronómetro en marcha → error 400');

  console.log('\n=== 3. Entrada manual + facturable ===\n');
  const man = createEntry(db, U1, { proyecto_id: P1, fecha: HOY, horas: 1, minutos: 30, facturable: false, descripcion: 'Reunión' });
  ok(man.duracion_seg === 5400 && !man.corriendo, 'entrada manual 1h30 = 5400 s exactos (sin redondeo)');
  ok(man.facturable === false, 'se guarda como NO facturable');
  ok(intenta(() => createEntry(db, U1, { proyecto_id: P1, fecha: HOY, horas: 0, minutos: 0 })).e?.status === 400, 'duración 0 → 400');
  ok(intenta(() => createEntry(db, U1, { proyecto_id: P1, fecha: 'ayer', horas: 1 })).e?.status === 400, 'fecha inválida → 400');

  console.log('\n=== 4. Importe: tarifa de la persona; proyecto de respaldo; o sin tarifa ===\n');
  const e1 = createEntry(db, U1, { proyecto_id: P1, fecha: HOY, horas: 2, minutos: 0 });   // U1 tiene 60/h
  ok(e1.importe === 120 && e1.tarifa_efectiva === 60, '2h de Ana (60/h) = 120 € (manda la tarifa de la persona, no la del proyecto=40)');
  const e2 = createEntry(db, U2, { proyecto_id: P1, fecha: HOY, horas: 2, minutos: 0 });   // U2 sin tarifa, P1=40
  ok(e2.importe === 80 && e2.tarifa_efectiva === 40, '2h de Beto (sin tarifa) en P1 (40/h) = 80 € (respaldo la tarifa del proyecto)');
  const e3 = createEntry(db, U2, { proyecto_id: P2, fecha: HOY, horas: 2, minutos: 0 });   // U2 sin tarifa, P2 sin tarifa
  ok(e3.importe == null && e3.sin_tarifa === true, 'sin tarifa de persona NI de proyecto → sin importe ("— sin tarifa"), no inventa un 0');

  console.log('\n=== 5. PROPIEDAD: cada uno las suyas; dueño/admin cualquiera ===\n');
  const deAna = e1;   // entrada de Ana (U1)
  ok(intenta(() => updateEntry(db, { userId: U2, esAdmin: false }, deAna.id, { proyecto_id: P1, fecha: HOY, horas: 3, minutos: 0 })).e?.status === 403, 'Beto NO puede editar la entrada de Ana → 403');
  ok(intenta(() => deleteEntry(db, { userId: U2, esAdmin: false }, deAna.id)).e?.status === 403, 'Beto NO puede eliminar la entrada de Ana → 403');
  const edit = intenta(() => updateEntry(db, { userId: U1, esAdmin: false }, deAna.id, { proyecto_id: P1, fecha: HOY, horas: 3, minutos: 0 }));
  ok(edit.r && edit.r.duracion_seg === 10800, 'Ana SÍ edita la suya (3h = 10800 s)');
  const editAdmin = intenta(() => updateEntry(db, { userId: ADMIN, esAdmin: true }, deAna.id, { proyecto_id: P1, fecha: HOY, horas: 4, minutos: 0 }));
  ok(editAdmin.r && editAdmin.r.duracion_seg === 14400, 'el dueño/admin SÍ edita la de cualquiera (4h)');

  console.log('\n=== 6. Eliminar = OCULTAR (no destruir) ===\n');
  deleteEntry(db, { userId: U1, esAdmin: false }, e1.id);
  ok(db.prepare('SELECT active FROM time_entries WHERE id=?').get(e1.id).active === 0, 'eliminar → active=0');
  ok(db.prepare('SELECT COUNT(*) n FROM time_entries WHERE id=?').get(e1.id).n === 1, 'la fila NO se borra (se conserva el dato)');
  ok(!semanaDe(db, U1, HOY).some(x => x.id === e1.id), 'una entrada eliminada NO aparece en la semana');

  console.log('\n=== 7. Total por proyecto (para la ficha) ===\n');
  // Proyecto NUEVO y aislado, con dos entradas conocidas: 1h30 NO facturable + 2h facturable de Ana (60/h).
  const P3 = createProyectoSvc(db, { nombre: 'Total ficha', modo_cobro: 'horas' }).id;
  createEntry(db, U1, { proyecto_id: P3, fecha: HOY, horas: 1, minutos: 30, facturable: false });
  createEntry(db, U1, { proyecto_id: P3, fecha: HOY, horas: 2, minutos: 0, facturable: true });   // 2h × 60 = 120
  const tp = tiempoDeProyecto(db, P3);
  ok(tp.total_seg === 5400 + 7200, 'total de horas del proyecto = suma de sus entradas activas (12600 s)');
  ok(tp.total_importe_facturable === 120, 'total facturable = solo las facturables (120 €; la de 1h30 no facturable no suma)');

  console.log('\n=== 8. Migración idempotente (sin DROP) ===\n');
  const colsA = db.prepare("PRAGMA table_info(time_entries)").all().map(c => c.name).join(',');
  const nA = db.prepare('SELECT COUNT(*) n FROM time_entries').get().n;
  runMigrations(db);
  const colsB = db.prepare("PRAGMA table_info(time_entries)").all().map(c => c.name).join(',');
  const nB = db.prepare('SELECT COUNT(*) n FROM time_entries').get().n;
  ok(colsA === colsB && nA === nB && nB > 0, 'segunda migración: mismas columnas y datos intactos (' + nB + ' filas)');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
