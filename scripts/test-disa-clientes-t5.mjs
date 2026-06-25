// T5 — DISA sobre clientes. Tests del SERVICIO validado compartido (la única vía de
// escritura que usan tanto el formulario como DISA), de la búsqueda/identificación, y de
// la paridad con la forma en que DISA fusiona ediciones parciales. El enlace de client_id
// en pedidos y las guardas de create_order se validan en navegador (lógica dentro del
// loop de DISA); aquí cubrimos toda la lógica unitaria.
//
//   node scripts/test-disa-clientes-t5.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  createClientSvc, updateClientSvc, archiveClientSvc, restoreClientSvc,
  searchClients, fiscalIdConflict,
} from '../modules/erp/routes/clients.js';
import { clientFieldOptions } from '../modules/erp/schemas.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function throws(fn, status, m) {
  let e = null; try { fn(); } catch (x) { e = x; }
  ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')');
}
function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

// ── 1. createClientSvc: validación + guarda de NIF ──────────────────────────
console.log('1. createClientSvc');
{
  const db = freshDb();
  const r = createClientSvc(db, { name: 'Ana García', fiscal_id: '12345678Z', city: 'Madrid', client_type: 'empresa' });
  ok(r.id > 0, 'crea un cliente y devuelve id');
  const row = db.prepare('SELECT * FROM clients WHERE id=?').get(r.id);
  eq(row.name, 'Ana García', 'guarda el nombre');
  eq(row.active, 1, 'nace activo');
  eq(row.collections_profile, 'estandar', 'perfil de cobro por defecto');

  throws(() => createClientSvc(db, {}), 400, 'sin nombre → 400 (validación de esquema)');
  throws(() => createClientSvc(db, { name: '' }), 400, 'nombre vacío → 400');
  throws(() => createClientSvc(db, { name: 'Otra', fiscal_id: '12345678Z' }), 409, 'NIF duplicado → 409 (misma guarda que el formulario)');
  // NIF vacío nunca bloquea (varios sin NIF).
  createClientSvc(db, { name: 'Sin NIF 1' }); createClientSvc(db, { name: 'Sin NIF 2' });
  ok(true, 'varios clientes sin NIF conviven');
  db.close();
}

// ── 2. updateClientSvc: 404, guarda de NIF excluyendo self, replace ─────────
console.log('2. updateClientSvc');
{
  const db = freshDb();
  const a = createClientSvc(db, { name: 'A', fiscal_id: 'AAA' }).id;
  const b = createClientSvc(db, { name: 'B', fiscal_id: 'BBB' }).id;
  throws(() => updateClientSvc(db, 9999, { name: 'X' }), 404, 'editar inexistente → 404');
  throws(() => updateClientSvc(db, b, { name: 'B', fiscal_id: 'AAA' }), 409, 'cambiar a un NIF ya usado por otro activo → 409');
  // Editar el propio con su mismo NIF NO choca (se excluye a sí mismo).
  const r = updateClientSvc(db, a, { name: 'A2', fiscal_id: 'AAA', city: 'Bilbao' });
  eq(r.id, a, 'edita el propio cliente');
  const row = db.prepare('SELECT name, city FROM clients WHERE id=?').get(a);
  eq([row.name, row.city], ['A2', 'Bilbao'], 'aplica los cambios');
  db.close();
}

// ── 3. archive / restore + liberación y reconquista del NIF ─────────────────
console.log('3. archiveClientSvc / restoreClientSvc');
{
  const db = freshDb();
  const a = createClientSvc(db, { name: 'Cliente', fiscal_id: 'NIF1' }).id;
  archiveClientSvc(db, a);
  eq(db.prepare('SELECT active FROM clients WHERE id=?').get(a).active, 0, 'archivar pone active=0 (no borra)');
  ok(db.prepare('SELECT 1 FROM clients WHERE id=?').get(a), 'la fila sigue existiendo');
  eq(fiscalIdConflict(db, 'NIF1'), null, 'archivar libera el NIF');
  // Otro cliente activo reconquista el NIF liberado.
  createClientSvc(db, { name: 'Nuevo', fiscal_id: 'NIF1' });
  throws(() => restoreClientSvc(db, a), 409, 'restaurar choca si el NIF ya lo tiene un activo → 409');
  throws(() => archiveClientSvc(db, 9999), 404, 'archivar inexistente → 404');
  throws(() => restoreClientSvc(db, 9999), 404, 'restaurar inexistente → 404');
  db.close();
}

// ── 4. searchClients (identificación + consulta de lectura) ─────────────────
console.log('4. searchClients');
{
  const db = freshDb();
  createClientSvc(db, { name: 'María López', fiscal_id: 'M1', city: 'Madrid' });
  createClientSvc(db, { name: 'María Soler', fiscal_id: 'M2', city: 'Madrid' });
  createClientSvc(db, { name: 'Pedro Ruiz', fiscal_id: 'P1', city: 'Bilbao' });
  const archId = createClientSvc(db, { name: 'Archivada', fiscal_id: 'AR', city: 'Madrid' }).id;
  archiveClientSvc(db, archId);

  eq(searchClients(db, { q: 'maría' }).map(c => c.name), ['María López', 'María Soler'], 'busca por nombre parcial (insensible a may.)');
  eq(searchClients(db, { q: 'M2' }).map(c => c.name), ['María Soler'], 'busca por NIF');
  eq(searchClients(db, { city: 'Madrid' }).map(c => c.name), ['María López', 'María Soler'], 'filtra por ciudad y excluye archivados');
  eq(searchClients(db, { q: 'maría', limit: 1 }).length, 1, 'respeta el límite');
  db.close();
}

// ── 5. Paridad con DISA: edición PARCIAL fusionada → replace por el servicio ─
console.log('5. Paridad DISA (edición parcial fusionada)');
{
  const db = freshDb();
  const id = createClientSvc(db, { name: 'Cliente', fiscal_id: 'NIF', email: 'c@x.es', city: 'Madrid', phone: '600', client_type: 'empresa', payment_term_days: 30 }).id;
  // Simula exactamente lo que hace el case edit_client de DISA: fusiona {city} sobre lo actual.
  const cur = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
  const keep = (v, c) => (v !== undefined ? v : c);
  const p = { city: 'Sevilla' };   // solo cambia la ciudad
  updateClientSvc(db, id, {
    name: keep(p.name, cur.name) || '', fiscal_id: keep(p.fiscal_id, cur.fiscal_id) || '',
    email: keep(p.email, cur.email) || '', phone: keep(p.phone, cur.phone) || '',
    address: keep(p.address, cur.address) || '', city: keep(p.city, cur.city) || '',
    country: keep(p.country, cur.country) || '', group_id: keep(p.group_id, cur.group_id) || null,
    notes: keep(p.notes, cur.notes) || '', accepts_newsletter: !!cur.accepts_newsletter,
    client_type: keep(p.client_type, cur.client_type) || 'particular',
    payment_term_days: Number(keep(p.payment_term_days, cur.payment_term_days)) || 0,
    payment_method: keep(p.payment_method, cur.payment_method) || '',
    collections_profile: keep(p.collections_profile, cur.collections_profile) || 'estandar',
  });
  const after = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
  eq(after.city, 'Sevilla', 'cambia el campo enviado');
  eq([after.email, after.phone, after.client_type, after.payment_term_days], ['c@x.es', '600', 'empresa', 30], 'preserva los campos NO enviados (edición parcial)');
  db.close();
}

// ── 6. Pedido enlaza client_id (invariante anti-huérfanos) ──────────────────
// La guarda viva ("sin client_id no se crea") está en el case create_order de DISA y se
// valida en navegador; aquí comprobamos el invariante de datos: un pedido de un cliente
// activo queda enlazado y se puede recuperar por cliente.
// ⏸ §6 APARCADO (obsoleto) — probaba la VÍA VIEJA de pedidos de DISA sobre `sales_orders`, tabla
// ARCHIVADA en D1 (commit 5d181c7) cuando se cortó esa vía. Se rehará cuando DISA recupere la creación
// de ventas sobre la CADENA NUEVA (customer_orders). NO se reescribe ni se inventa otra aserción aquí.
// Las secciones 1–5 (identificación de cliente, lo vivo de T5) siguen corriendo arriba.
console.log('6. Pedido enlazado a cliente — ⏸ APARCADO (vía vieja sales_orders retirada en D1; saneamiento de tests aparte)');
// {
//   const db = freshDb();
//   const cid = createClientSvc(db, { name: 'Compradora', fiscal_id: 'C1' }).id;
//   const r = db.prepare("INSERT INTO sales_orders (order_number, client_id, status, subtotal, tax_amount, total) VALUES ('DISA-T', ?, 'completado', 100, 21, 121)").run(cid);
//   const ord = db.prepare('SELECT client_id FROM sales_orders WHERE id=?').get(r.lastInsertRowid);
//   eq(ord.client_id, cid, 'el pedido queda enlazado al cliente (no huérfano)');
//   eq(db.prepare('SELECT COUNT(*) n FROM sales_orders WHERE client_id=?').get(cid).n, 1, 'recuperable por cliente');
//   db.close();
// }

// ── 7. Campos de lista cerrada: valores exactos del esquema + caso "contado" ─
// DISA debe usar solo estos valores (se inyectan en su prompt desde aquí). El servicio
// rechaza cualquier invento; dejar el campo en blanco es válido.
console.log('7. Campos de lista cerrada (no inventar)');
{
  const db = freshDb();
  // Los valores se derivan del clientSchema (fuente única, sin desincronizar).
  eq(clientFieldOptions.payment_method, ['', 'transferencia', 'efectivo', 'tarjeta', 'domiciliacion'], 'payment_method = enum exacto del esquema');
  eq(clientFieldOptions.client_type, ['particular', 'empresa'], 'client_type = enum exacto del esquema');
  ok(!clientFieldOptions.payment_method.includes('Contado'), '"Contado" NO es un valor de payment_method');

  // El servicio rechaza un invento (la guarda que saltó en el bug).
  throws(() => createClientSvc(db, { name: 'X', payment_method: 'Contado' }), 400, 'payment_method inventado ("Contado") → 400');

  // Caso navegador 1: "Luis, particular, Madrid, contado" → DISA deja la forma en blanco.
  const luis = createClientSvc(db, { name: 'Luis', client_type: 'particular', city: 'Madrid', payment_method: '' });
  const lrow = db.prepare('SELECT client_type, city, payment_method FROM clients WHERE id=?').get(luis.id);
  eq([lrow.client_type, lrow.city, lrow.payment_method], ['particular', 'Madrid', ''], 'Luis se crea con forma de pago EN BLANCO');

  // Caso navegador 2: "por transferencia" → se guarda transferencia.
  const ana = createClientSvc(db, { name: 'Ana', payment_method: 'transferencia' });
  eq(db.prepare('SELECT payment_method FROM clients WHERE id=?').get(ana.id).payment_method, 'transferencia', 'forma de pago válida se guarda');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' T5: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
