// Gate de navegador — TRAZABILIDAD por lote (Pilar 3). Contra el servidor real (tenant desarrollo-bamburu).
// Recorre la parte de UI: el formulario de RECEPCIÓN muestra la captura de lote por línea; al confirmar
// (por el mismo endpoint que el botón, con CSRF), el stock entra con su lote y caducidad; y el INFORME de
// lotes del producto (endpoint de la ficha) lo refleja con su saldo. Limpia por id.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { RID, productoDePrueba, purgarArtefactos } from './lib/gate-fixtures.mjs';
import { createPurchaseOrderSvc, sendPurchaseOrderSvc } from '../modules/erp/routes/purchase-orders.js';
import { lotesDeProducto } from '../modules/erp/trazabilidad.js';
import { productStock } from '../modules/erp/stock.js';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH); db.pragma('busy_timeout = 5000');
const PERM = Object.fromEntries(db.prepare("SELECT module||'.'||action AS code, id FROM permissions").all().map(r => [r.code, r.id]));
const SUF = RID();
const creado = { users: [], productos: [], ordenes: [], recepciones: [], suppliers: [] };

function crearUsuario(perms) {
  const uid = Number(db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run('ZZ traza', 'zz-traz-' + SUF + '@bamburu.test', 'x').lastInsertRowid);
  for (const p of perms) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, PERM[p]);
  creado.users.push(uid);
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, uid, now, now + 1800, randomBytes(8).toString('hex'));
  return { uid, token };
}

const browser = await puppeteer.launch({ ...launchOpts() });
try {
  console.log('\n[1] Siembra: producto por lote + orden de compra enviada');
  const S = Number(db.prepare("INSERT INTO suppliers (name, active) VALUES (?,1)").run('ZZ Prov traza ' + SUF).lastInsertRowid);
  creado.suppliers.push(S);
  const prod = productoDePrueba(db, 'ZZ Yogur lote');
  creado.productos.push(prod.id);
  db.prepare("UPDATE products SET tracking='lot' WHERE id=?").run(prod.id);
  const poId = Number(createPurchaseOrderSvc(db, { supplier_id: S, date: '2026-07-15', items: [{ product_id: prod.id, quantity: 12, unit_cost: 2 }] }));
  creado.ordenes.push(poId);
  sendPurchaseOrderSvc(db, poId);
  const oid = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(poId).id;
  ok(!!oid, 'orden enviada con su línea');

  const { token } = crearUsuario(['purchases.create', 'purchases.read', 'products.read', 'products.edit', 'inventory.read']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });

  console.log('\n[2] El formulario de recepción muestra la captura de lote');
  await page.goto(BASE + '/admin/purchase-orders/' + poId + '/receipts/new', { waitUntil: 'networkidle2' });
  const tieneCaptura = await page.evaluate(() => !!document.querySelector('.r-lot-code') && !!document.querySelector('.r-lot-expiry'));
  ok(tieneCaptura, 'la línea trazada muestra los campos de código de lote y caducidad');

  console.log('\n[3] Confirmar la recepción con lote y caducidad');
  const res = await page.evaluate(async (poId, oid) => {
    const r = await fetch('/api/erp/purchase-orders/' + poId + '/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
      body: JSON.stringify({ date: '2026-07-15', notes: '', warehouse_id: null,
        items: [{ order_item_id: oid, quantity: 12, unit_cost: 2, lotes: [{ code: 'L-GATE', expiry: '2026-12-31', quantity: 12 }] }] }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, poId, oid);
  console.log('   POST receipts →', res.status, JSON.stringify(res.body).slice(0, 80));
  ok([200, 201].includes(res.status) && res.body.id, 'la recepción se confirma (201 Created)');
  if (res.body.id) creado.recepciones.push(res.body.id);
  ok(productStock(db, prod.id) === 12, 'el stock del producto = 12 (entró la recepción)');
  const lotes = lotesDeProducto(db, prod.id);
  ok(lotes.length === 1 && lotes[0].code === 'L-GATE' && lotes[0].saldo === 12 && lotes[0].expiry === '2026-12-31',
     'nace el lote L-GATE con saldo 12 y caducidad 2026-12-31');

  console.log('\n[4] El informe de lotes de la ficha lo refleja');
  const informe = await page.evaluate(async (pid) => (await (await fetch('/api/erp/products/' + pid + '/lotes')).json()), prod.id);
  ok(informe.tracking === 'lot' && (informe.lotes || []).some(l => l.code === 'L-GATE' && l.saldo === 12),
     'el endpoint del informe devuelve el lote con su saldo (lo que pinta la ficha)');

} finally {
  await browser.close();
  try {
    for (const r of creado.recepciones) { db.prepare('DELETE FROM purchase_order_receipt_items WHERE receipt_id=?').run(r); db.prepare('DELETE FROM purchase_order_receipts WHERE id=?').run(r); }
    db.prepare('DELETE FROM stock_lots WHERE product_id IN (' + (creado.productos.join(',') || '-1') + ')').run();
    purgarArtefactos(db, { ordenes: creado.ordenes, productos: creado.productos });
    for (const s of creado.suppliers) { try { db.prepare('DELETE FROM suppliers WHERE id=?').run(s); } catch {} }
    for (const u of creado.users) { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(u); db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(u); db.prepare('DELETE FROM admin_users WHERE id=?').run(u); }
    console.log('\n  (artefactos del gate limpiados por id)');
  } catch (e) { console.error('  ⚠ limpieza:', e.message); }
  db.close();
}
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate trazabilidad (navegador): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
