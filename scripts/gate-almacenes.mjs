// Gate de navegador — Multi-almacén · Capa 1 contra el servidor real (tenant
// desarrollo-bamburu): crear 2º almacén → verlo → marcarlo principal → intentar
// archivar el principal (BLOQUEADO) → devolver el principal al original → archivar
// el 2º (vacío) y restaurarlo → filtro de stock por almacén en /admin/inventory +
// desglose "Stock por almacén" en la ficha. Las mutaciones se ejecutan llamando a
// las funciones JS de la página (api real + CSRF + sesión). Limpia tras de sí.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { recordMovement, recomputeStock } from '../modules/erp/stock.js';

const DB_PATH = '/home/ibrahin/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const PRODUCT_ID = 1;            // Vela Lavanda 200g (física)
const NORTE = 'Almacén Norte (gate)';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);
const W1 = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;

const dbRead = () => new Database(DB_PATH, { readonly: true });
const whRow = (name) => { const d = dbRead(); const r = d.prepare('SELECT * FROM warehouses WHERE name=?').get(name); d.close(); return r; };
const whById = (id) => { const d = dbRead(); const r = d.prepare('SELECT * FROM warehouses WHERE id=?').get(id); d.close(); return r; };
const defCount = () => { const d = dbRead(); const r = d.prepare('SELECT COUNT(*) c FROM warehouses WHERE active=1 AND is_default=1').get().c; d.close(); return r; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });
const dialogQueue = [];   // solo confirm() en este flujo → aceptar siempre
page.on('dialog', async d => { await d.accept(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let norteId = null, injectedMovId = null;
try {
  await page.goto(BASE + '/admin/warehouses', { waitUntil: 'networkidle0' });
  let body = await page.content();
  ok(body.includes('Almacenes') && body.includes('Principal'), 'pantalla de Almacenes carga (lista + columna Principal)');

  // ── 1. Crear el 2º almacén por la UI ──
  await page.evaluate((nm) => { document.getElementById('whName').value = nm; saveWh(); }, NORTE);
  await page.waitForFunction((nm) => document.body.innerHTML.includes(nm), { timeout: 8000 }, NORTE);
  const created = whRow(NORTE);
  ok(!!created, 'creado "' + NORTE + '" (visible en la lista)');
  norteId = created.id;
  ok(created.is_default === 0 && created.active === 1, 'nace activo y NO principal');
  await page.screenshot({ path: '/tmp/wh-1-creado.png' });

  // ── 2. Marcarlo principal → exclusividad ──
  await page.evaluate((id) => defaultWh(id), norteId);
  await page.waitForFunction(() => true); await sleep(400);
  ok(whById(norteId).is_default === 1, 'Norte pasa a principal');
  ok(whById(W1).is_default === 0, 'el original deja de ser principal');
  ok(defCount() === 1, 'EXACTAMENTE un default activo tras marcar');

  // ── 3. Intentar archivar el principal (Norte) → BLOQUEADO ──
  dialogQueue.push(true);   // confirm() de archiveWh
  await page.evaluate((id) => archiveWh(id), norteId);
  await sleep(500);
  ok(whById(norteId).active === 1, 'archivar el principal queda BLOQUEADO (sigue activo)');

  // ── 4. Devolver principal al original y archivar Norte (vacío) ──
  await page.evaluate((id) => defaultWh(id), W1);
  await sleep(400);
  ok(whById(W1).is_default === 1 && whById(norteId).is_default === 0, 'el original vuelve a ser principal');
  dialogQueue.push(true);
  await page.evaluate((id) => archiveWh(id), norteId);
  await page.waitForFunction(() => true); await sleep(500);
  ok(whById(norteId).active === 0, 'Norte (vacío, no principal) se archiva');

  // ── 5. Restaurar Norte ──
  await page.evaluate((id) => restoreWh(id), norteId);
  await sleep(500);
  ok(whById(norteId).active === 1, 'Norte restaurado (active=1)');
  await page.screenshot({ path: '/tmp/wh-2-restaurado.png' });

  // ── 6. Stock por almacén: inyecto +6 en Norte (dato de prueba) y verifico filtro+ficha ──
  injectedMovId = recordMovement(db, { product_id: PRODUCT_ID, type: 'entrada', quantity: 6, warehouse_id: norteId, origin_type: 'manual', note: 'gate almacenes' });
  const globalStock = whById ? null : null; // (no-op; leemos abajo)

  await page.goto(BASE + '/admin/inventory', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#invBody tr'));
  body = await page.content();
  ok(body.includes('id="whFilter"') && body.includes('Todos (total)'), 'filtro de almacén presente (Todos + almacenes)');

  // Filtra por Norte: el producto debe mostrar 6 (lo inyectado en Norte), no su total global.
  await page.select('#whFilter', String(norteId));
  await page.waitForFunction(() => true); await sleep(500);
  const norteQty = await page.evaluate((pid) => {
    const rows = Array.from(document.querySelectorAll('#invBody tr'));
    for (const tr of rows) { const t = tr.textContent; if (t.includes('Vela Lavanda')) return tr.querySelectorAll('td')[3].textContent.trim(); }
    return null;
  }, PRODUCT_ID);
  ok(norteQty === '6', 'con Norte seleccionado, Vela Lavanda muestra 6 (stock de ESE almacén), got ' + norteQty);
  await page.screenshot({ path: '/tmp/wh-3-filtro-norte.png' });

  // Vuelve a "Todos": muestra el total global (≠ 6, incluye el principal).
  await page.select('#whFilter', '');
  await sleep(400);
  const totalQty = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#invBody tr'));
    for (const tr of rows) { if (tr.textContent.includes('Vela Lavanda')) return tr.querySelectorAll('td')[3].textContent.trim(); }
    return null;
  });
  ok(totalQty !== '6' && Number(totalQty) > 6, 'con "Todos" muestra el total global (' + totalQty + ', incluye principal + Norte)');

  // Ficha (kardex modal): desglose "Stock por almacén" con los 2 almacenes.
  await page.evaluate((pid) => openStockKardex(pid, 'Vela Lavanda 200g'), PRODUCT_ID);
  await page.waitForFunction(() => { const b = document.getElementById('stockKardexBody'); return b && b.innerHTML.includes('Stock por almacén'); }, { timeout: 8000 });
  const fichaTxt = await page.$eval('#stockKardexBody', el => el.textContent);
  ok(fichaTxt.includes('Stock por almacén'), 'ficha: bloque "Stock por almacén" presente');
  ok(fichaTxt.includes('Almacén principal') && fichaTxt.includes(NORTE), 'ficha: desglose lista ambos almacenes activos');
  await page.screenshot({ path: '/tmp/wh-4-ficha-desglose.png' });

} finally {
  await browser.close();
  // Limpieza: borra el movimiento inyectado + recomputa la caché; archiva Norte para
  // dejar el tenant con un solo almacén activo principal (estado inicial).
  const db2 = new Database(DB_PATH);
  if (injectedMovId) { db2.prepare('DELETE FROM stock_movements WHERE id=?').run(injectedMovId); recomputeStock(db2, PRODUCT_ID); }
  const after = db2.prepare('SELECT stock FROM products WHERE id=?').get(PRODUCT_ID).stock;
  const libro = db2.prepare('SELECT COALESCE(SUM(quantity),0) s FROM stock_movements WHERE product_id=?').get(PRODUCT_ID).s;
  ok(after === libro, `limpieza: caché stock (${after}) == libro (${libro}) tras quitar el dato de prueba`);
  if (norteId) db2.prepare('UPDATE warehouses SET active=0 WHERE id=?').run(norteId);  // archiva el de prueba (queda como fila, no se borra)
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador Almacenes: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
