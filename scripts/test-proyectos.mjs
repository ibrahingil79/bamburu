// Test de LÓGICA — PROYECTOS (Escalera · paso 7 · PIEZA 1), sobre BD temporal.
//   node scripts/test-proyectos.mjs
//
// Demuestra los criterios de lógica del encargo:
//   · alta 'horas' (con tarifa) y 'precio_cerrado' (con importe); el otro campo queda a null.
//   · modo_cobro fuera de lista → rechazado (400).
//   · código PRY-NNNN único, correlativo y NO editable.
//   · editar; archivar (no borra) y restaurar; cliente/responsable opcionales y leídos EN VIVO.
//   · migración idempotente (dos pasadas = mismo resultado), sin DROP.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createProyectoSvc, updateProyectoSvc, archiveProyectoSvc, restoreProyectoSvc, getProyecto } from '../modules/erp/routes/proyectos.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'proy-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name, currency_symbol) VALUES (1,'Test SL','B00000000','ES','F','R','IVA','€')").run();
  return db;
}
const nuevoCliente = (db, name) => { db.prepare("INSERT INTO clients (name, fiscal_id, active) VALUES (?, '11111111H',1)").run(name); return db.prepare('SELECT id FROM clients ORDER BY id DESC LIMIT 1').get().id; };
const nuevoUsuario = (db, name) => { db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)").run(name, name + '@t.local', 'x'); return db.prepare('SELECT id FROM admin_users ORDER BY id DESC LIMIT 1').get().id; };
const crea = (db, o) => { try { return { r: createProyectoSvc(db, o) }; } catch (e) { return { e }; } };

try {
  const db = nuevaBD();
  const cliA = nuevoCliente(db, 'Cliente A');
  const cliB = nuevoCliente(db, 'Cliente B');
  const uMar = nuevoUsuario(db, 'María');

  console.log('\n=== 1. Alta por HORAS (con tarifa) y PRECIO CERRADO (con importe) ===\n');
  const h = createProyectoSvc(db, { nombre: 'Web corporativa', modo_cobro: 'horas', tarifa_hora: 45, cliente_id: cliA, responsable_id: uMar });
  const ph = getProyecto(db, h.id);
  ok(ph.modo_cobro === 'horas' && Number(ph.tarifa_hora) === 45 && ph.precio_cerrado == null, 'alta por horas: guarda tarifa_hora, precio_cerrado a null');
  const pc = createProyectoSvc(db, { nombre: 'Auditoría fija', modo_cobro: 'precio_cerrado', precio_cerrado: 3000 });
  const ppc = getProyecto(db, pc.id);
  ok(ppc.modo_cobro === 'precio_cerrado' && Number(ppc.precio_cerrado) === 3000 && ppc.tarifa_hora == null, 'alta precio cerrado: guarda precio_cerrado, tarifa_hora a null');

  console.log('\n=== 2. modo_cobro fuera de lista → rechazado ===\n');
  const bad = crea(db, { nombre: 'X', modo_cobro: 'mensual' });
  ok(bad.e && bad.e.status === 400, 'modo_cobro="mensual" → 400 (lista cerrada)');
  const badFalta = crea(db, { nombre: 'X' });
  ok(badFalta.e && badFalta.e.status === 400, 'sin modo_cobro → 400 (obligatorio)');
  const badNombre = crea(db, { modo_cobro: 'horas' });
  ok(badNombre.e && badNombre.e.status === 400, 'sin nombre → 400 (obligatorio)');

  console.log('\n=== 3. Código PRY-NNNN correlativo, único y NO editable ===\n');
  ok(/^PRY-0001$/.test(ph.codigo), 'el primero es PRY-0001 (' + ph.codigo + ')');
  ok(/^PRY-0002$/.test(ppc.codigo), 'el segundo es PRY-0002 (correlativo)');
  const codigos = db.prepare('SELECT codigo FROM proyectos').all().map(x => x.codigo);
  ok(new Set(codigos).size === codigos.length, 'todos los códigos son únicos');
  // PUT completo (como el formulario): mantiene cliente/responsable y demuestra que el código enviado se ignora.
  updateProyectoSvc(db, h.id, { nombre: 'Web corporativa v2', modo_cobro: 'horas', tarifa_hora: 50, codigo: 'PRY-9999', cliente_id: cliA, responsable_id: uMar });
  const phEdit = getProyecto(db, h.id);
  ok(phEdit.codigo === 'PRY-0001', 'editar NO cambia el código (aunque se envíe otro): sigue PRY-0001');
  ok(phEdit.nombre === 'Web corporativa v2' && Number(phEdit.tarifa_hora) === 50, 'editar sí cambia nombre y tarifa');

  console.log('\n=== 4. Archivar (no borra) y restaurar ===\n');
  archiveProyectoSvc(db, h.id);
  ok(getProyecto(db, h.id).active === 0, 'archivar → active=0 (la fila SIGUE existiendo, no se borra)');
  ok(db.prepare('SELECT COUNT(*) n FROM proyectos WHERE id=?').get(h.id).n === 1, 'la fila archivada no se borra de la tabla');
  restoreProyectoSvc(db, h.id);
  ok(getProyecto(db, h.id).active === 1, 'restaurar → active=1');

  console.log('\n=== 5. Cliente/responsable OPCIONALES y leídos EN VIVO ===\n');
  const sinFk = createProyectoSvc(db, { nombre: 'Interno', modo_cobro: 'horas' });
  const psin = getProyecto(db, sinFk.id);
  ok(psin.cliente_id == null && psin.responsable_id == null, 'se puede crear sin cliente ni responsable (opcionales)');
  ok(psin.cliente_nombre == null && psin.responsable_nombre == null, 'sin cliente → nombre resuelto a null (no rompe)');
  // Reasignar el cliente cambia la ficha (en vivo, no congelado).
  ok(getProyecto(db, h.id).cliente_nombre === 'Cliente A', 'la ficha muestra el cliente asignado (Cliente A)');
  updateProyectoSvc(db, h.id, { nombre: 'Web corporativa v2', modo_cobro: 'horas', tarifa_hora: 50, cliente_id: cliB });
  ok(getProyecto(db, h.id).cliente_nombre === 'Cliente B', 'reasignar el cliente → la ficha muestra Cliente B (leído en vivo)');
  // Renombrar el cliente se refleja en la ficha del proyecto (no se congeló el nombre).
  db.prepare('UPDATE clients SET name=? WHERE id=?').run('Cliente B (renombrado)', cliB);
  ok(getProyecto(db, h.id).cliente_nombre === 'Cliente B (renombrado)', 'renombrar el cliente se refleja en el proyecto (en vivo)');

  console.log('\n=== 6. Migración idempotente (dos pasadas = mismo resultado), sin DROP ===\n');
  const colsAntes = db.prepare("PRAGMA table_info(proyectos)").all().map(c => c.name).join(',');
  const nAntes = db.prepare('SELECT COUNT(*) n FROM proyectos').get().n;
  runMigrations(db);   // segunda pasada
  const colsDespues = db.prepare("PRAGMA table_info(proyectos)").all().map(c => c.name).join(',');
  const nDespues = db.prepare('SELECT COUNT(*) n FROM proyectos').get().n;
  ok(colsAntes === colsDespues, 'segunda migración: mismas columnas (idempotente)');
  ok(nAntes === nDespues && nDespues > 0, 'segunda migración: los datos siguen intactos (' + nDespues + ' filas)');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
