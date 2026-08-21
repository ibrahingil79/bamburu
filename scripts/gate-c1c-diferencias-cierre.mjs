// Gate de navegador C1.c — contra el servidor real (tenant desarrollo-bamburu):
//   A) sobre-recepción: aviso visible en el formulario → confirmar (con el exceso
//      repetido en el confirm) → exceso reflejado en la ficha ("12 de 10 (+2)").
//   B) cerrar orden con pendiente → "Cerrada (incompleta)" + motivo visible +
//      línea de ayuda → intento de nueva recepción bloqueado (400 y sin botón).
// OJO: crea dos órdenes de prueba en el tenant de desarrollo.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);
const PRODUCT_ID = 2;   // Vela Vainilla 200g (física)
const stockBefore = db.prepare('SELECT stock FROM products WHERE id=?').get(PRODUCT_ID).stock;

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

const dialogQueue = [];
const dialogs = [];
page.on('dialog', async d => {
  dialogs.push(d.message());
  const next = dialogQueue.shift();
  if (next === undefined) await d.accept();
  else await d.accept(typeof next === 'string' ? next : undefined);
});

const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const post = async (u, body) => { const r = await fetch(BASE + u, { method: 'POST', headers: HJ, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json() }; };

try {
  // ════ A) SOBRE-RECEPCIÓN ════
  // LOS PROVEEDORES SE ELIGEN ACTIVOS, NO POR SU ID. Estaban clavados al 1 y al 2, y el reseed del
  // negocio a datos de taller archiva TODOS los proveedores genéricos: el 2 se quedó inactivo, la
  // orden B no llegaba a crearse y el gate moría al leer sus líneas — pero el fallo que cantaba era
  // «el delta de stock no cuadra», treinta líneas después y sin relación aparente con la causa.
  const PROVS = db.prepare('SELECT id FROM suppliers WHERE active=1 ORDER BY id LIMIT 2').all().map(r => r.id);
  ok(PROVS.length >= 1, 'hay proveedores activos con los que pedir', PROVS.join(', ') || 'ninguno');
  const PROV_A = PROVS[0], PROV_B = PROVS[1] || PROVS[0];

  const a = (await post('/api/erp/purchase-orders', { supplier_id: PROV_A, date: '2026-06-10', items: [{ product_id: PRODUCT_ID, quantity: 10, unit_cost: 1.5 }] })).body;
  const aSent = (await post('/api/erp/purchase-orders/' + a.id + '/enviar')).body;
  ok(/^OC-/.test(aSent.order_number || ''), 'orden A ' + aSent.order_number + ' enviada');

  // contrato del endpoint: exceso sin flag → 400 claro
  const items = await fetch(BASE + '/api/erp/purchase-orders/' + a.id + '/receipts', { headers: { 'Cookie': 'asess=' + token } }).then(r => r.json());
  const oitem = items.reception.lines[0].order_item_id;
  const noFlag = await post('/api/erp/purchase-orders/' + a.id + '/receipts', { date: '2026-06-10', items: [{ order_item_id: oitem, quantity: 12, unit_cost: 1.5 }] });
  ok(noFlag.status === 400 && /exceso/i.test(noFlag.body.error || ''), 'API: exceso sin confirm_excess → 400 con mensaje claro');

  // formulario: aviso visible al teclear 12
  await page.goto(BASE + `/admin/purchase-orders/${a.id}/receipts/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#rLines tr .r-qty');
  await page.evaluate(() => {
    const r = document.querySelector('#rLines tr');
    r.querySelector('.r-qty').value = '12';
    r.querySelector('.r-qty').dispatchEvent(new Event('input'));
  });
  const warn = await page.$eval('#rLines tr .r-warn', el => ({ text: el.textContent, visible: el.style.display !== 'none' }));
  ok(warn.visible && warn.text.includes('Pedido 10') && warn.text.includes('exceso de 2'), 'aviso visible en la línea: "' + warn.text + '"');
  const rowBg = await page.$eval('#rLines tr', el => el.style.background);
  ok(rowBg !== '', 'línea resaltada');
  await page.screenshot({ path: '/tmp/c1c-1-aviso-exceso.png' });

  dialogQueue.push(undefined);   // confirm (acepta)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.evaluate(() => confirmReceipt())]);
  ok(dialogs.some(m => m.includes('MÁS de lo pedido') && m.includes('exceso de 2')), 'la confirmación final REPITE el exceso');
  ok(page.url().includes('/purchase-order-receipts/'), 'recepción con exceso confirmada');

  await page.goto(BASE + `/admin/purchase-orders/${a.id}`, { waitUntil: 'networkidle0' });
  let body = await page.content();
  ok(body.includes('12 de 10') && body.includes('(+2)'), 'ficha: "Recibido 12 de 10 (+2)"');
  ok(body.includes('status-recibida') || body.includes('>Recibida<'), 'línea sobre-recibida cuenta como completada → orden Recibida');
  ok(!body.includes('Registrar recepción'), 'sin pendiente → sin botón');
  await page.screenshot({ path: '/tmp/c1c-2-exceso-ficha.png' });

  // ════ B) CIERRE MANUAL ════
  const b = (await post('/api/erp/purchase-orders', { supplier_id: PROV_B, date: '2026-06-10', items: [{ product_id: PRODUCT_ID, quantity: 8, unit_cost: 1.2 }] })).body;
  const bSent = (await post('/api/erp/purchase-orders/' + b.id + '/enviar')).body;
  const bItems = await fetch(BASE + '/api/erp/purchase-orders/' + b.id + '/receipts', { headers: { 'Cookie': 'asess=' + token } }).then(r => r.json());
  // ESTE PASO NO SE COMPROBABA, y por eso un fallo suyo solo se notaba 30 líneas más abajo, en el
  // delta de stock, sin decir de dónde venía. Un paso que no se verifica es un agujero.
  const parcial = await post('/api/erp/purchase-orders/' + b.id + '/receipts', { date: '2026-06-10', items: [{ order_item_id: bItems.reception.lines[0].order_item_id, quantity: 3, unit_cost: 1.2 }] });
  ok(parcial.status === 200 || parcial.status === 201, 'la recepción PARCIAL de 3 unidades se registra → ' + parcial.status + ' ' + JSON.stringify(parcial.body).slice(0, 90));

  await page.goto(BASE + `/admin/purchase-orders/${b.id}`, { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('Parcialmente recibida') && body.includes('Cerrar orden'), 'orden B parcial con botón "Cerrar orden"');
  dialogQueue.push('el proveedor ya no sirve este artículo');   // prompt motivo
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.evaluate(() => cerrarOrden())]);
  body = await page.content();
  ok(body.includes('Cerrada (incompleta)'), 'estado "Cerrada (incompleta)" visible');
  ok(body.includes('el proveedor ya no sirve este artículo'), 'motivo visible en la ficha');
  ok(body.includes('no admite más recepciones ni se reabre'), 'línea de ayuda visible');
  ok(!body.includes('Registrar recepción') && !body.includes('Cerrar orden</button>'), 'sin botones de recibir/cerrar');
  ok(body.includes('(no llegará)'), 'pendiente marcado como "no llegará"');
  await page.screenshot({ path: '/tmp/c1c-3-cerrada.png' });

  // intento de nueva recepción: API 400 y formulario redirige
  const tryRec = await post('/api/erp/purchase-orders/' + b.id + '/receipts', { date: '2026-06-11', confirm_excess: true, items: [{ order_item_id: bItems.reception.lines[0].order_item_id, quantity: 1, unit_cost: 1.2 }] });
  ok(tryRec.status === 400 && /cerrada/.test(tryRec.body.error || ''), 'API: recepción sobre cerrada → 400 ("' + tryRec.body.error + '")');
  await page.goto(BASE + `/admin/purchase-orders/${b.id}/receipts/new`, { waitUntil: 'networkidle0' });
  ok(!page.url().endsWith('/receipts/new'), 'el formulario de recepción redirige (cerrada)');

  // cierre sin motivo → 400
  const noMotivo = await post('/api/erp/purchase-orders/' + a.id + '/close', { motivo: '' });
  ok(noMotivo.status === 400, 'cerrar sin motivo → 400 (validación)');

} finally {
  await browser.close();
  const db2 = new Database(DB_PATH);
  const after = db2.prepare('SELECT stock FROM products WHERE id=?').get(PRODUCT_ID).stock;
  const libro = db2.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(PRODUCT_ID).s;
  ok(after === libro, `caché products.stock (${after}) == suma del libro (${libro})`);
  ok(after === stockBefore + 15, `delta de stock = +15 (12 con exceso + 3 parciales; antes ${stockBefore} → ${after})`);
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador C1.c: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
