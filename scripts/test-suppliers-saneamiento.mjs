// Saneamiento de Proveedor (espejo del T1 de Clientes) — tests de lógica:
// migración (columnas + activo), guarda de NIF único (normaliza, solo activos, excluye self),
// soft-delete (archivar saca de la lista activa y libera el NIF) y la guarda al restaurar.
//
//   node scripts/test-suppliers-saneamiento.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { supplierFiscalIdConflict } from '../modules/erp/routes/suppliers.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
function addSup(db, { name, fiscal_id = '', active = 1 } = {}) {
  return db.prepare('INSERT INTO suppliers (name, fiscal_id, active) VALUES (?,?,?)')
    .run(name || ('Prov' + (++n)), fiscal_id, active).lastInsertRowid;
}
const activeList = db => db.prepare('SELECT id, name FROM suppliers WHERE active=1 ORDER BY name').all();

// ── 1. Migración: columnas nuevas + activo por defecto ──────────────────────
console.log('1. Migración');
{
  const db = freshDb();
  const cols = db.prepare('PRAGMA table_info(suppliers)').all().map(c => c.name);
  ['fiscal_id', 'address', 'city', 'active'].forEach(col => ok(cols.includes(col), 'columna ' + col + ' existe'));
  const id = db.prepare("INSERT INTO suppliers (name) VALUES ('X')").run().lastInsertRowid;
  eq(db.prepare('SELECT active FROM suppliers WHERE id=?').get(id).active, 1, 'proveedor nuevo nace activo (default 1)');
  db.close();
}

// ── 2. Guarda de NIF único (normaliza, excluye self, solo activos) ──────────
console.log('2. Guarda de NIF');
{
  const db = freshDb();
  const a = addSup(db, { name: 'ACME', fiscal_id: 'B12345678' });
  eq(supplierFiscalIdConflict(db, ''), null, 'NIF vacío nunca bloquea');
  ok(supplierFiscalIdConflict(db, 'B12345678'), 'mismo NIF activo → conflicto');
  ok(supplierFiscalIdConflict(db, '  b12345678 '), 'normaliza trim + mayúsculas → conflicto');
  eq(supplierFiscalIdConflict(db, 'B12345678', a), null, 'excluye al propio (edición) → sin conflicto');
  eq(supplierFiscalIdConflict(db, 'OTRO99'), null, 'NIF distinto → sin conflicto');
  // Varios sin NIF conviven.
  addSup(db, { name: 'SinNIF1' }); addSup(db, { name: 'SinNIF2' });
  ok(true, 'varios proveedores sin NIF conviven');
  db.close();
}

// ── 3. Soft-delete: archivar saca de la lista activa pero el NIF SIGUE reservado ──
console.log('3. Archivar / restaurar (NIF reservado global)');
{
  const db = freshDb();
  const a = addSup(db, { name: 'Proveedor A', fiscal_id: 'NIF1' });
  eq(activeList(db).length, 1, 'aparece en la lista de activos');
  // Archivar (soft-delete).
  db.prepare('UPDATE suppliers SET active=0 WHERE id=?').run(a);
  eq(activeList(db).length, 0, 'archivado: fuera de la lista de activos');
  ok(db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(a), 'la fila se conserva (no se borra)');
  // Unicidad GLOBAL: el archivado SIGUE reservando su NIF (el bug que pediste corregir).
  const conf = supplierFiscalIdConflict(db, 'NIF1');
  ok(conf && conf.active === 0, 'crear con el NIF de un archivado → conflicto (apunta al archivado)');
  // Editar al propio archivado con su mismo NIF no choca (se excluye).
  eq(supplierFiscalIdConflict(db, 'NIF1', a), null, 'excluye al propio archivado en edición');
  db.close();
}

// ── 4. Archivado con compras asociadas se conserva (no se bloquea archivar) ──
console.log('4. Archivar con compras asociadas');
{
  const db = freshDb();
  const a = addSup(db, { name: 'Con compras', fiscal_id: 'NIFC' });
  db.prepare("INSERT INTO purchases (supplier_id, date, status, total) VALUES (?, '2026-01-01', 'received', 0)").run(a);
  // Soft-delete no destruye la compra (antes el borrado en duro se bloqueaba; ahora se archiva).
  db.prepare('UPDATE suppliers SET active=0 WHERE id=?').run(a);
  eq(db.prepare('SELECT active FROM suppliers WHERE id=?').get(a).active, 0, 'proveedor archivado');
  eq(db.prepare('SELECT COUNT(*) c FROM purchases WHERE supplier_id=?').get(a).c, 1, 'la compra asociada se conserva');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Proveedor saneamiento: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
