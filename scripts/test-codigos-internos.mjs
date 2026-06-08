// Código interno autogenerado (CLI-/PROV-/PROD-NNNN) — tests de lógica:
// formato + crecimiento >9999; contadores independientes por tipo desde 0001; backfill en
// orden de creación e idempotente; asignación en alta (cliente vía servicio); no editable.
//
//   node scripts/test-codigos-internos.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { formatCode, nextCode, nextSeq, backfillCodes } from '../modules/erp/codes.js';
import { createClientSvc } from '../modules/erp/routes/clients.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

// ── 1. Formato + crecimiento más allá de 9999 ──────────────────────────────
console.log('1. Formato');
{
  eq(formatCode('CLI-', 1), 'CLI-0001', '1 → CLI-0001 (4 cifras con ceros)');
  eq(formatCode('PROD-', 42), 'PROD-0042', '42 → PROD-0042');
  eq(formatCode('PROV-', 9999), 'PROV-9999', '9999 → PROV-9999');
  eq(formatCode('CLI-', 10000), 'CLI-10000', '10000 → CLI-10000 (crece a 5 cifras sin romper)');
  eq(formatCode('CLI-', 123456), 'CLI-123456', '123456 → CLI-123456');
}

// ── 2. Contadores independientes por tipo, desde 0001 ──────────────────────
console.log('2. Contadores independientes');
{
  const db = freshDb();
  // BD fresca: sin filas → los contadores arrancan en 0001 por tipo.
  eq(nextCode(db, 'client'), 'CLI-0001', 'cliente arranca en 0001');
  eq(nextCode(db, 'client'), 'CLI-0002', 'cliente sigue 0002');
  eq(nextCode(db, 'supplier'), 'PROV-0001', 'proveedor arranca en 0001 (independiente)');
  eq(nextCode(db, 'product'), 'PROD-0001', 'producto arranca en 0001 (independiente)');
  eq(nextCode(db, 'supplier'), 'PROV-0002', 'proveedor 0002');
  eq(nextSeq(db, 'product'), 2, 'producto seq 2');
  db.close();
}

// ── 3. Backfill en orden de creación (id asc) e idempotente ────────────────
console.log('3. Backfill');
{
  const db = new Database(':memory:');
  // Esquema mínimo + filas SIN código, en cierto orden de id.
  db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, client_code TEXT)`);
  db.exec(`CREATE TABLE code_counters (entity TEXT PRIMARY KEY, last_seq INTEGER NOT NULL DEFAULT 0)`);
  const ins = db.prepare('INSERT INTO clients (name) VALUES (?)');
  ['A', 'B', 'C'].forEach(n => ins.run(n));
  const assigned = backfillCodes(db, { table: 'clients', column: 'client_code', entity: 'client' });
  eq(assigned, 3, 'backfill asigna 3 códigos');
  eq(db.prepare('SELECT client_code FROM clients ORDER BY id').all().map(r => r.client_code),
     ['CLI-0001', 'CLI-0002', 'CLI-0003'], 'códigos en orden de creación (id asc)');
  // Idempotente: una nueva fila sin código + re-ejecutar solo toca la nueva.
  ins.run('D');
  const again = backfillCodes(db, { table: 'clients', column: 'client_code', entity: 'client' });
  eq(again, 1, 're-ejecutar solo asigna la fila nueva');
  eq(db.prepare("SELECT client_code FROM clients WHERE name='D'").get().client_code, 'CLI-0004', 'continúa el contador (0004)');
  eq(db.prepare("SELECT client_code FROM clients WHERE name='A'").get().client_code, 'CLI-0001', 'no re-toca las que ya tenían código');
  db.close();
}

// ── 4. Migración real (modelo completo) + asignación en alta vía servicio ──
console.log('4. Migración + alta');
{
  const db = freshDb();
  const cols = c => db.prepare(`PRAGMA table_info(${c})`).all().map(x => x.name);
  ok(cols('clients').includes('client_code'), 'clients.client_code existe');
  ok(cols('suppliers').includes('supplier_code'), 'suppliers.supplier_code existe');
  ok(cols('products').includes('product_code'), 'products.product_code existe');
  ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='code_counters'").get(), 'tabla code_counters existe');

  // Alta de cliente por el servicio validado → recibe CLI-NNNN automáticamente.
  const r1 = createClientSvc(db, { name: 'Cliente Uno' });
  const r2 = createClientSvc(db, { name: 'Cliente Dos' });
  eq(r1.client_code, 'CLI-0001', 'primer alta → CLI-0001');
  eq(r2.client_code, 'CLI-0002', 'segunda alta → CLI-0002');
  eq(db.prepare('SELECT client_code FROM clients WHERE id=?').get(r1.id).client_code, 'CLI-0001', 'el código quedó guardado en la fila');
  db.close();
}

// ── 5. No editable + "duplicar genera nuevo, no copia" (a nivel motor) ──────
console.log('5. No editable / duplicar');
{
  const db = freshDb();
  const a = createClientSvc(db, { name: 'Original', fiscal_id: 'X1' });
  // "Duplicar" = otra alta: SIEMPRE pasa por nextCode → código nuevo, nunca el del original.
  const dup = createClientSvc(db, { name: 'Original (copia)', fiscal_id: 'X2' });
  ok(dup.client_code !== a.client_code, 'una segunda alta (duplicado) recibe código NUEVO, no copia el viejo');
  eq(dup.client_code, 'CLI-0002', 'el duplicado es el siguiente del contador');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Códigos internos: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
