// Gate — PROPUESTA DE DISA: reposición de stock (D5f). Tipo `reposicion_stock`.
//
// Ciclo completo sobre COPIA de BD real (los datos vivos NO se tocan). Siembra productos/proveedores/
// almacenes propios (ZZ) y afirma lo difícil: el disparo se mide POR ALMACÉN contra el DISPONIBLE
// (físico − reservado); la cantidad va hasta el OBJETIVO; se AGRUPA por proveedor (un borrador por
// proveedor con todas sus líneas); un producto SIN proveedor avisa pero NO se propone; el CANDADO es
// purchases.create; y el NO-DUPLICAR (una viva por proveedor, borrador vivo, descartada, y la re-caída
// tras recuperación). Aprobar CREA el borrador de compra correcto SIN enviarlo.
//
//   node scripts/verify-propuestas-reposicion.mjs
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import {
  productosBajoMinimo, generarPropuestasReposicion, detallePropuestaReposicion,
  aprobarReposicionSvc, setNivelesProducto, nivelesDeProducto, TIPO_REPOSICION,
} from '../modules/erp/reposicion.js';
import { propuestasPendientes, tiposVisiblesPara } from '../modules/erp/propuestas.js';
import { createPropuestasRoutes } from '../modules/erp/routes/propuestas.js';
import { recordMovement, defaultWarehouseId } from '../modules/erp/stock.js';

const HOY = '2026-07-15';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const copias = [];
function copia(slug) {
  const p = join(tmpdir(), 'repo-' + slug + '-' + process.pid + '.db');
  copyFileSync(`data/tenants/${slug}.db`, p);
  copias.push(p);
  const db = new Database(p);
  runMigrations(db);
  db.prepare('DELETE FROM disa_proposals').run();
  db.prepare('DELETE FROM stock_levels').run();
  return db;
}
let seq = 7000;
const proveedor = (db, name) => Number(db.prepare("INSERT INTO suppliers (name, active) VALUES (?,1)").run(name).lastInsertRowid);
function producto(db, name, supplierId, type = 'physical') {
  seq++;
  return Number(db.prepare(
    "INSERT INTO products (name, slug, sku, price, status, type, stock, supplier_id) VALUES (?,?,?,?, 'active', ?, 0, ?)"
  ).run(name, 'zz-' + seq, 'ZZ' + seq, 10, type, supplierId || null).lastInsertRowid);
}
const almacen = (db, name, def = 0) => Number(db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES (?,1,?)").run(name, def).lastInsertRowid);
const ponerStock = (db, pid, wid, qty) => recordMovement(db, { product_id: pid, type: 'apertura', quantity: qty, origin_type: 'opening', warehouse_id: wid, note: 'ZZ seed' });
const setNivel = (db, pid, wid, min, target) => setNivelesProducto(db, pid, [{ warehouse_id: wid, min_qty: min, target_qty: target }], 'gate');
const propDe = (db, supplierId, status = 'pendiente') => db.prepare("SELECT * FROM disa_proposals WHERE type=? AND supplier_id=? AND status=?").get(TIPO_REPOSICION, supplierId, status);

function appPara(db, perms, opts = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('isOwner', !!opts.owner); c.set('isAdmin', false);
    c.set('userPerms', perms);
    c.set('session', { userName: 'gate', userId: 9, csrfToken: 'x' });
    await next();
  });
  app.route('/', createPropuestasRoutes(db).api);
  return app;
}
const POST = (app, path, body = {}) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

try {
  // ── 1. Esquema ──────────────────────────────────────────────────────────────
  console.log('\n[1] Esquema');
  const db = copia('desarrollo-bamburu');
  ok(!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stock_levels'").get(), 'existe la tabla stock_levels');
  const cols = db.prepare('PRAGMA table_info(disa_proposals)').all().map(r => r.name);
  ok(cols.includes('repo_signature') && cols.includes('repo_po_id'), 'disa_proposals tiene repo_signature y repo_po_id');
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_disa_proposals_reposicion_pendiente'").get();
  ok(!!idx && /UNIQUE/i.test(idx.sql) && /status='pendiente'/.test(idx.sql), 'índice único PARCIAL (una viva por proveedor)');

  // ── 2. Montaje del escenario ────────────────────────────────────────────────
  console.log('\n[2] Disparo POR ALMACÉN contra el disponible');
  const W1 = defaultWarehouseId(db);
  const W2 = almacen(db, 'ZZ Almacén 2');
  const A = proveedor(db, 'ZZ Proveedor A');
  const B = proveedor(db, 'ZZ Proveedor B');

  const P1 = producto(db, 'ZZ Tornillos', A);      // bajo mínimo en W1
  ponerStock(db, P1, W1, 3);   setNivel(db, P1, W1, 10, 50);   // disp 3 < mín 10 → faltan hasta 50 = 47
  const P2 = producto(db, 'ZZ Tuercas', A);        // sobrado en W1, bajo mínimo SOLO en W2
  ponerStock(db, P2, W1, 100); setNivel(db, P2, W1, 10, 40);   // disp 100 ≥ 10 → NO
  ponerStock(db, P2, W2, 2);   setNivel(db, P2, W2, 20, 30);   // disp 2 < 20 → faltan hasta 30 = 28
  const P3 = producto(db, 'ZZ Arandelas', B);      // bajo mínimo en W1
  ponerStock(db, P3, W1, 1);   setNivel(db, P3, W1, 5, 5);     // disp 1 < 5 → faltan hasta 5 = 4
  const P4 = producto(db, 'ZZ Sin proveedor', null); // bajo mínimo, SIN proveedor
  ponerStock(db, P4, W1, 0);   setNivel(db, P4, W1, 5, 8);
  const P5 = producto(db, 'ZZ Servicio', A, 'service'); // servicio: no debe entrar
  db.prepare("INSERT INTO stock_levels (product_id, warehouse_id, min_qty, target_qty) VALUES (?,?,?,?)").run(P5, W1, 5, 10);

  const bajo = productosBajoMinimo(db);
  const de = (pid, wid) => bajo.find(e => e.product_id === pid && e.warehouse_id === wid);
  ok(bajo.length === 4, 'hay 4 (producto,almacén) bajo mínimo (P1·W1, P2·W2, P3·W1, P4·W1) — got ' + bajo.length);
  ok(!!de(P1, W1) && de(P1, W1).faltan === 47, 'P1 bajo mínimo en W1, faltan 47 (objetivo 50 − disp 3)');
  ok(!!de(P2, W2) && !de(P2, W1), 'P2 salta SOLO en W2 (bajo su mínimo allí), no en W1 (sobrado): se mide por almacén');
  ok(de(P2, W2).faltan === 28, 'P2·W2 faltan 28 (objetivo 30 − disp 2)');
  ok(!!de(P4, W1) && !de(P4, W1).supplier_id, 'P4 bajo mínimo y SIN proveedor (supplier_id null)');
  ok(!bajo.some(e => e.product_id === P5), 'el producto de SERVICIO no entra (solo físicos)');

  // ── 3. Generación: agrupa por proveedor; sin proveedor no se propone ─────────
  console.log('\n[3] Agrupación por proveedor');
  const g1 = generarPropuestasReposicion(db, { now: HOY + 'T08:00:00Z' });
  console.log('   generar#1 =>', JSON.stringify(g1));
  ok(g1.creadas === 2 && g1.candidatas === 2, 'crea 2 propuestas (proveedor A y B), 2 candidatos');
  ok(g1.sinProveedor === 1, 'P4 (sin proveedor) cuenta como sinProveedor, NO se propone');
  const propA = propDe(db, A), propB = propDe(db, B);
  ok(!!propA && !!propB, 'hay una propuesta por proveedor');

  const detA = detallePropuestaReposicion(db, propA);
  ok(detA.n_productos === 2, 'la de A agrupa sus DOS productos bajo mínimo (P1 y P2) en una sola propuesta');
  const lP1 = detA.lineas.find(l => l.product_id === P1), lP2 = detA.lineas.find(l => l.product_id === P2);
  ok(lP1 && lP1.quantity === 47 && lP2 && lP2.quantity === 28, 'cantidades por línea = objetivo − disponible (47 y 28)');
  ok(detA.lineas.every(l => l.unit_cost === 0), 'coste precargado 0 (nunca se compró); el dueño lo ajusta');
  ok(detA.viva === true, 'la propuesta está viva (el proveedor sigue con productos bajo mínimo)');

  // ── 4. Idempotencia: una viva por proveedor ─────────────────────────────────
  console.log('\n[4] Una viva por proveedor');
  const g2 = generarPropuestasReposicion(db, { now: HOY + 'T09:00:00Z' });
  ok(g2.creadas === 0 && g2.yaTenian === 2, 'segunda pasada: 0 creadas, 2 ya tenían');
  let choco = false;
  try { db.prepare("INSERT INTO disa_proposals (type, supplier_id, status) VALUES (?,?,'pendiente')").run(TIPO_REPOSICION, A); }
  catch { choco = true; }
  ok(choco, 'el índice único parcial rechaza una segunda PENDIENTE del mismo proveedor');

  // ── 5. Aprobar = borrador de compra correcto, SIN enviar ────────────────────
  console.log('\n[5] Aprobar crea el borrador (no lo envía)');
  const r = aprobarReposicionSvc(db, propA.id, 'gate', { today: HOY });
  ok(r.po_id > 0 && r.lineas === 2, 'aprobar devuelve po_id y 2 líneas');
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(r.po_id);
  ok(po.supplier_id === A && po.status === 'borrador', 'la orden es del proveedor A y queda en BORRADOR (no enviada)');
  ok(po.order_number == null, 'un borrador NO consume número de orden (order_number null)');
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY product_id').all(r.po_id);
  ok(items.length === 2, 'el borrador tiene 2 líneas');
  ok(items.some(i => i.product_id === P1 && i.quantity === 47) && items.some(i => i.product_id === P2 && i.quantity === 28),
     'las líneas llevan los productos y cantidades correctos');
  const propAtras = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(propA.id);
  ok(propAtras.status === 'aprobada' && propAtras.repo_po_id === r.po_id, 'la propuesta queda aprobada, apuntando a su borrador');
  ok(aprobarReposicionSvc.length >= 2, 'aprobarReposicionSvc existe');   // sanity
  let doble = false; try { aprobarReposicionSvc(db, propA.id, 'gate'); } catch (e) { doble = (e.status === 409); }
  ok(doble, 'aprobar una YA aprobada → 409 (no se resuelve dos veces)');

  // ── 6. NO apilar sobre un borrador vivo ─────────────────────────────────────
  console.log('\n[6] Borrador vivo: no se propone otra compra encima');
  const g3 = generarPropuestasReposicion(db, { now: HOY + 'T10:00:00Z' });
  ok(g3.creadas === 0, 'con el borrador de A aún vivo (status borrador), NO se genera otra para A');
  ok(!propDe(db, A), 'y no hay ninguna PENDIENTE nueva de A');

  // ── 7. Descartar: no reaparece la MISMA situación ───────────────────────────
  console.log('\n[7] Descartar no reaparece (misma situación)');
  db.prepare("UPDATE disa_proposals SET status='descartada' WHERE id=?").run(propB.id);
  const g4 = generarPropuestasReposicion(db, { now: HOY + 'T11:00:00Z' });
  ok(g4.creadas === 0, 'B descartada con la misma situación → no se re-propone');
  ok(!propDe(db, B), 'B sigue sin pendiente');

  // ── 8. RE-CAÍDA: se repone y vuelve a caer → sí re-propone ───────────────────
  console.log('\n[8] Recuperación y re-caída');
  ponerStock(db, P3, W1, 100);   // P3 pasa de disp 1 a 101 → por encima del mínimo 5 → B recupera
  const g5 = generarPropuestasReposicion(db, { now: HOY + 'T12:00:00Z' });
  ok(g5.expiradas >= 1, 'al recuperar, la descartada de B se EXPIRA (deja de bloquear)');
  ok(!db.prepare("SELECT 1 FROM disa_proposals WHERE supplier_id=? AND status='descartada'").get(B), 'ya no hay descartada de B');
  ponerStock(db, P3, W1, -100);  // vuelve a caer (disp 1)
  const g6 = generarPropuestasReposicion(db, { now: HOY + 'T13:00:00Z' });
  ok(g6.creadas === 1 && !!propDe(db, B), 'tras reponer y VOLVER a caer, B se re-propone (situación nueva)');

  // ── 9. Un producto NUEVO baja de mínimo → cambia la situación, no la bloquea la descartada ──
  console.log('\n[9] Producto nuevo bajo mínimo cambia la situación');
  const pB2 = propDe(db, B);
  db.prepare("UPDATE disa_proposals SET status='descartada' WHERE id=?").run(pB2.id);
  const P6 = producto(db, 'ZZ Clavos', B);
  ponerStock(db, P6, W1, 0); setNivel(db, P6, W1, 3, 3);   // otro producto de B cae
  const g7 = generarPropuestasReposicion(db, { now: HOY + 'T14:00:00Z' });
  ok(g7.creadas === 1, 'con un producto NUEVO de B bajo mínimo, la huella cambia → se propone de nuevo (no lo bloquea la descartada anterior)');
  const detB = detallePropuestaReposicion(db, propDe(db, B));
  ok(detB.n_productos === 2, 'y la nueva propuesta de B incluye P3 y P6');

  // ── 10. Candado de permiso (purchases.create) + badge ───────────────────────
  console.log('\n[10] Candado: purchases.create');
  const tiposOwner = tiposVisiblesPara({ get: k => k === 'isOwner' }, () => true);
  ok(tiposOwner.includes(TIPO_REPOSICION) && tiposOwner.length === 6, 'la fuente única declara los SEIS tipos, con reposición');
  ok(!tiposVisiblesPara({ get: () => false }, (c, p) => p === 'invoices.read').includes(TIPO_REPOSICION),
     'sin purchases.create, el tipo NO es visible');

  const dbC = copia('desarrollo-bamburu');
  const sA = proveedor(dbC, 'ZZ Prov'); const q = producto(dbC, 'ZZ Prod', sA);
  const w = defaultWarehouseId(dbC); ponerStock(dbC, q, w, 0); setNivel(dbC, q, w, 5, 10);
  generarPropuestasReposicion(dbC, { now: HOY + 'T08:00:00Z' });
  const pr = propDe(dbC, sA);
  ok(!!pr, 'hay una propuesta que proteger');

  const appNo = appPara(dbC, ['invoices.read']);   // ve algo, pero NO compras
  const gNo = await (await appNo.request('/')).json();
  ok(!(gNo.propuestas || []).some(x => x.type === TIPO_REPOSICION), 'sin purchases.create: la reposición NO aparece en su lista');
  ok((await POST(appNo, '/' + pr.id + '/preparar-compra')).status === 403, 'ni puede aprobarla → 403');

  const appSi = appPara(dbC, ['purchases.create']);
  const gSi = await (await appSi.request('/')).json();
  ok((gSi.propuestas || []).some(x => x.type === TIPO_REPOSICION), 'con purchases.create: sí la ve');
  const cSi = await (await appSi.request('/contador')).json();
  ok(cSi.count === (gSi.propuestas || []).length, 'el badge cuenta lo mismo que el panel');
  // Generación filtrada por permiso:
  dbC.prepare('DELETE FROM disa_proposals').run();
  await POST(appNo, '/generar');
  ok(!propDe(dbC, sA), 'quien no puede comprar ni siquiera GENERA la propuesta (falla cerrado)');
  await POST(appSi, '/generar');
  ok(!!propDe(dbC, sA), 'y quien puede, sí');
  // Aprobar por la RUTA crea el borrador:
  const resAppr = await POST(appSi, '/' + propDe(dbC, sA).id + '/preparar-compra');
  const bodyAppr = await resAppr.json();
  ok(resAppr.status === 200 && /purchase-orders/.test(bodyAppr.ver_orden || ''), 'aprobar por la ruta → 200 y enlace al borrador');

  // ── 11. propuestasPendientes marca viva=false si se repuso ───────────────────
  console.log('\n[11] El panel avisa si se repuso');
  const dbD = copia('desarrollo-bamburu');
  const sD = proveedor(dbD, 'ZZ P'); const pD = producto(dbD, 'ZZ X', sD);
  const wD = defaultWarehouseId(dbD); ponerStock(dbD, pD, wD, 0); setNivel(dbD, pD, wD, 5, 5);
  generarPropuestasReposicion(dbD, { now: HOY + 'T08:00:00Z' });
  ponerStock(dbD, pD, wD, 100);   // se repone SIN aprobar ni descartar
  const vista = propuestasPendientes(dbD, HOY, [TIPO_REPOSICION]).find(x => x.supplier_id === sD);
  ok(vista && vista.viva === false && vista.n_productos === 0, 'repuesto sin resolver: el panel la marca viva=false (0 productos), no empuja a comprar');

} finally {
  for (const p of copias) { for (const f of [p, p + '-wal', p + '-shm']) { try { unlinkSync(f); } catch {} } }
  console.log('\n  (copias desechables borradas; el negocio vivo NO se ha tocado)');
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Propuestas de reposición de stock: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
