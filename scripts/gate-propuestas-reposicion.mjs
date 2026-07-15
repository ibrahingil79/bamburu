// Gate de navegador — PROPUESTA DE DISA: reposición de stock (D5f). Contra el servidor real
// (tenant desarrollo-bamburu). Determinista, sin modelo. Recorre el flujo por la PANTALLA:
//   producto bajo su mínimo (con proveedor) → aviso en la campana → propuesta en el panel, agrupada por
//   proveedor → "Preparar borrador de compra" CREA la orden en BORRADOR (no la envía) y lleva a revisarla.
//   Un producto bajo mínimo SIN proveedor avisa pero NO se propone. Un usuario sin purchases.create no la ve.
//
// Limpia POR ID todo lo que siembra (producto, niveles, propuesta, orden, proveedor, usuarios, sesiones):
// el negocio queda como estaba. NO envía nada al proveedor (el flujo solo crea un borrador).
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, engancharToasts } from './lib/gate-env.mjs';
import { RID, productoDePrueba, purgarArtefactos } from './lib/gate-fixtures.mjs';
import { generarPropuestasReposicion, setNivelesProducto } from '../modules/erp/reposicion.js';
import { TIPO_REPOSICION } from '../modules/erp/propuestas.js';
import { recordMovement, defaultWarehouseId } from '../modules/erp/stock.js';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 5000');
const PERM = Object.fromEntries(db.prepare("SELECT module||'.'||action AS code, id FROM permissions").all().map(r => [r.code, r.id]));
const SUF = RID();
const creado = { users: [], sessions: [], suppliers: [], productos: [], ordenes: [], props: [] };

function crearUsuario(nombre, perms) {
  const uid = Number(db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run('ZZ ' + nombre, 'zz-d5f-' + nombre + '-' + SUF + '@bamburu.test', 'x').lastInsertRowid);
  for (const p of perms) { if (!PERM[p]) throw new Error('permiso inexistente: ' + p); db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, PERM[p]); }
  creado.users.push(uid);
  return uid;
}
function sesion(uid) {
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, uid, now, now + 1800, randomBytes(16).toString('hex'));
  creado.sessions.push(token);
  return token;
}

const browser = await puppeteer.launch({ ...launchOpts() });
try {
  // ── 1. Siembra ──────────────────────────────────────────────────────────────
  console.log('\n[1] Siembra: un producto bajo mínimo CON proveedor y otro SIN');
  const W = defaultWarehouseId(db);
  const supId = Number(db.prepare("INSERT INTO suppliers (name, active) VALUES (?,1)").run('ZZ Proveedor (gate ' + SUF + ')').lastInsertRowid);
  creado.suppliers.push(supId);

  const conProv = productoDePrueba(db, 'ZZ Tornillos');
  creado.productos.push(conProv.id);
  db.prepare('UPDATE products SET supplier_id=? WHERE id=?').run(supId, conProv.id);
  recordMovement(db, { product_id: conProv.id, type: 'apertura', quantity: 2, origin_type: 'opening', warehouse_id: W, note: 'gate' });
  setNivelesProducto(db, conProv.id, [{ warehouse_id: W, min_qty: 10, target_qty: 50 }], 'gate');   // disp 2 < 10 → pedir 48

  const sinProv = productoDePrueba(db, 'ZZ Sin proveedor');
  creado.productos.push(sinProv.id);
  setNivelesProducto(db, sinProv.id, [{ warehouse_id: W, min_qty: 5, target_qty: 8 }], 'gate');       // disp 0 < 5, sin proveedor

  const g = generarPropuestasReposicion(db);
  ok(g.creadas === 1 && g.sinProveedor >= 1, 'DISA crea 1 propuesta (proveedor) y cuenta el sin-proveedor aparte');
  const prop = db.prepare("SELECT * FROM disa_proposals WHERE type=? AND supplier_id=? AND status='pendiente'").get(TIPO_REPOSICION, supId);
  ok(!!prop, 'la propuesta queda pendiente, anclada al proveedor');
  creado.props.push(prop.id);

  // ── 2. La CAMPANA avisa (con inventory.read) ────────────────────────────────
  console.log('\n[2] La campana avisa de ambos productos bajo mínimo');
  const uid = crearUsuario('compras', ['purchases.create', 'purchases.read', 'inventory.read', 'products.read', 'products.edit']);
  const tok = sesion(uid);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await engancharToasts(page);
  await page.setCookie({ name: 'asess', value: tok, domain: DOMAIN, path: '/' });
  page.on('dialog', async d => { await d.accept(); });

  await page.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle2' });
  const avisos = await page.evaluate(async () => (await (await fetch('/api/erp/avisos')).json()).avisos || []);
  const mios = avisos.filter(a => a.tipo === 'stock_bajo');
  ok(mios.length >= 2, 'la campana trae ≥2 avisos de stock bajo mínimo (' + mios.length + ')');
  ok(mios.some(a => /asígnale un proveedor/.test(a.detalle)), 'el del producto SIN proveedor pide asignarle uno');

  // ── 3. El panel enseña la propuesta agrupada por proveedor ──────────────────
  console.log('\n[3] El panel enseña la propuesta de reposición');
  await page.evaluate(() => loadProps());
  await new Promise(r => setTimeout(r, 800));
  const cardTxt = await page.evaluate(id => document.getElementById('prop' + id)?.innerText || '', prop.id);
  ok(/Reposición/i.test(cardTxt) && cardTxt.includes('Proveedor'), 'la tarjeta lleva la etiqueta "Reposición" y el proveedor');
  ok(/ZZ Tornillos/.test(cardTxt) && /48/.test(cardTxt), 'lista el producto con la cantidad a pedir (48 = objetivo 50 − disp 2)');
  ok(/Preparar borrador de compra/.test(cardTxt), 'ofrece "Preparar borrador de compra"');

  try { await import('fs').then(fs => fs.mkdirSync(process.env.HOME + '/uxprev', { recursive: true })); } catch {}
  await page.screenshot({ path: process.env.HOME + '/uxprev/repo-panel-' + SUF + '.png' });

  // ── 4. Un usuario SIN purchases.create no ve la propuesta (aún pendiente) ────
  // Por HTTP directo (no una 2ª pestaña: la cookie es por DOMINIO y pisaría la sesión de `page`).
  console.log('\n[4] Candado: sin purchases.create no se ve');
  const uidNo = crearUsuario('nocompras', ['invoices.read']);   // ve algo, pero NO compras
  const tokNo = sesion(uidNo);
  const resNo = await fetch('http://127.0.0.1:3000/api/erp/propuestas', { headers: { Host: DOMAIN, Cookie: 'asess=' + tokNo } });
  const propsNo = resNo.status === 403 ? [] : ((await resNo.json()).propuestas || []);
  ok(resNo.status === 403 || !propsNo.some(p => p.type === TIPO_REPOSICION), 'sin purchases.create: la reposición NO aparece en su panel');

  // ── 5. Aprobar CREA el borrador y lleva a revisarlo — SIN enviarlo ──────────
  // Se pega al MISMO endpoint que el botón "Preparar borrador de compra" (con CSRF, como api() del panel)
  // y luego se NAVEGA de verdad a la orden para confirmar que la pantalla de revisión carga.
  console.log('\n[5] Aprobar crea el borrador de compra (no lo envía)');
  const apr = await page.evaluate(async (id) => {
    const r = await fetch('/api/erp/propuestas/' + id + '/preparar-compra',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN }, body: '{}' });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, prop.id);
  console.log('   POST /preparar-compra →', apr.status, JSON.stringify(apr.body));
  ok(apr.status === 200 && apr.body.ok, 'el endpoint del botón responde 200 ok');
  ok(/\/admin\/purchase-orders\/\d+/.test(apr.body.ver_orden || ''), 'devuelve el enlace al borrador para revisarlo');
  ok(/no envía/i.test(apr.body.message || ''), 'el mensaje deja claro que Bamburu NO envía nada al proveedor');

  const propTras = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(prop.id);
  ok(propTras.status === 'aprobada' && propTras.repo_po_id, 'la propuesta queda aprobada, apuntando a su borrador');
  if (propTras.repo_po_id) creado.ordenes.push(propTras.repo_po_id);
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(propTras.repo_po_id);
  ok(po && po.supplier_id === supId && po.status === 'borrador', 'la orden es del proveedor y queda en BORRADOR (no enviada)');
  ok(po && po.order_number == null, 'un borrador NO consume número (no se envió)');
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').all(propTras.repo_po_id);
  ok(items.length === 1 && items[0].product_id === conProv.id && items[0].quantity === 48, 'el borrador lleva el producto con proveedor, cantidad 48 (el sin-proveedor NO entra)');

  // Navega de verdad a la orden: la pantalla de revisión carga y muestra el producto sembrado (el nombre
  // va en el value de un input de línea, así que se leen también inputs/options, no solo innerText).
  if (apr.body.ver_orden) {
    await page.goto(BASE + apr.body.ver_orden, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1000));
    const found = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input,textarea,option')].map(e => (e.value || '') + ' ' + (e.textContent || '')).join(' ');
      return (document.body.innerText + ' ' + inputs).includes('ZZ Tornillos');
    });
    ok(found, 'la pantalla de la orden en borrador carga y muestra el producto a pedir');
  }

} finally {
  await browser.close();
  // Limpieza por id (hijos antes que padres).
  try {
    for (const id of creado.props) db.prepare('DELETE FROM disa_proposals WHERE id=?').run(id);
    db.prepare("DELETE FROM disa_proposals WHERE supplier_id IN (" + (creado.suppliers.join(',') || '-1') + ") AND type='reposicion_stock'").run();
    db.prepare('DELETE FROM stock_levels WHERE product_id IN (' + (creado.productos.join(',') || '-1') + ')').run();
    purgarArtefactos(db, { ordenes: creado.ordenes, productos: creado.productos });
    for (const s of creado.suppliers) { try { db.prepare('DELETE FROM suppliers WHERE id=?').run(s); } catch {} }
    for (const u of creado.users) { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(u); db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(u); db.prepare('DELETE FROM admin_users WHERE id=?').run(u); }
    console.log('\n  (artefactos del gate limpiados por id; el negocio vivo queda como estaba)');
  } catch (e) { console.error('  ⚠ limpieza:', e.message); }
  db.close();
}
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate reposición (navegador): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
