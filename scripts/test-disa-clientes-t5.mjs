// T5 — DISA sobre clientes. Tests del SERVICIO validado compartido (la única vía de
// escritura que usan tanto el formulario como DISA), de la búsqueda/identificación, y de
// la paridad con la forma en que DISA fusiona ediciones parciales. Aquí cubrimos toda la
// lógica unitaria viva.
//
// §6 RETIRADA el 2026-07-10: probaba el enlace client_id de la vía VIEJA de pedidos de DISA
// (`create_order` sobre `sales_orders`). Esa acción ya no existe —se retiró junto con las otras
// cuatro del clúster archivado por D1—, así que la sección se elimina en vez de seguir aparcada
// anunciando una cobertura que no daba. Si DISA recupera la creación de ventas sobre la cadena
// nueva (`customer_orders`), se escribe un test NUEVO contra esa cadena.
//
//   node scripts/test-disa-clientes-t5.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  createClientSvc, updateClientSvc, archiveClientSvc, restoreClientSvc,
  searchClients, fiscalIdConflict,
} from '../modules/erp/routes/clients.js';
import { clientFieldOptions } from '../modules/erp/schemas.js';
// 25 ago 2026 · Los dominios de las direcciones de prueba pasan a `.test`, que está RESERVADO y no
// puede existir (RFC 2606). Antes usaban dominios que sí existen —de otra gente—, así que un correo
// del producto podía acabar en una bandeja ajena, y cada intento era un rebote contra bamburu.com.
// La puerta del correo los desvía a simulación. Ver docs/censo-correos.md.

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
  const id = createClientSvc(db, { name: 'Cliente', fiscal_id: 'NIF', email: 'c@x.test', city: 'Madrid', phone: '600', client_type: 'empresa', payment_term_days: 30 }).id;
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
  eq([after.email, after.phone, after.client_type, after.payment_term_days], ['c@x.test', '600', 'empresa', 30], 'preserva los campos NO enviados (edición parcial)');
  db.close();
}

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
