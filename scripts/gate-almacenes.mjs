// Gate de navegador — Multi-almacén · Capa 1 contra el servidor real (tenant
// desarrollo-bamburu): crear 2º almacén → verlo → marcarlo principal → intentar
// archivar el principal (BLOQUEADO) → devolver el principal al original → archivar
// el 2º (vacío) y restaurarlo → filtro de stock por almacén en /admin/inventory +
// desglose "Stock por almacén" en la ficha. Las mutaciones se ejecutan llamando a
// las funciones JS de la página (api real + CSRF + sesión). Limpia tras de sí.
//
// POR QUÉ ESTE GATE SE ENVENENABA SOLO. Creaba un almacén con un nombre FIJO ("Almacén Norte
// (gate)") y, al terminar, lo archivaba en vez de borrarlo. A la pasada siguiente creaba OTRO con el
// mismo nombre... pero se buscaba a sí mismo POR NOMBRE, y `SELECT ... WHERE name=?` le devolvía el
// RANCIO de la pasada anterior. A partir de ahí conducía el almacén equivocado: "nace activo" fallaba
// (el viejo estaba archivado), y los fallos cambiaban de una pasada a otra. Un gate que depende de
// lo que dejó su pasada anterior no mide el producto: se mide a sí mismo.
//
// Las dos reglas que lo arreglan:
//   1. NOMBRE ÚNICO por pasada (sufijo aleatorio) → imposible engancharse a un rancio.
//   2. El gate BORRA su almacén al terminar (no lo archiva) → no acumula. Y con la misma guarda que
//      limpiar-residuo-gates.mjs: si algo real colgara de él, se deja estar. Mejor una fila de basura
//      que romper un dato bueno.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { purgarArtefactos, cuadraLibro, RID } from './lib/gate-fixtures.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { recordMovement } from '../modules/erp/stock.js';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const PRODUCT_ID = 1;            // Vela Lavanda 200g (física)
// El "(gate)" es la marca que limpiar-residuo-gates.mjs reconoce si el gate muere antes de limpiar;
// el sufijo aleatorio es lo que impide que una pasada se enganche a la anterior.
const NORTE = 'Almacén Norte (gate ' + RID() + ')';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);
const W1 = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
const stockBefore = db.prepare('SELECT stock FROM products WHERE id=?').get(PRODUCT_ID).stock;
const almacenesBefore = db.prepare('SELECT COUNT(*) c FROM warehouses').get().c;

const dbRead = () => new Database(DB_PATH, { readonly: true });
const whRow = (name) => { const d = dbRead(); const r = d.prepare('SELECT * FROM warehouses WHERE name=?').get(name); d.close(); return r; };
const whById = (id) => { const d = dbRead(); const r = d.prepare('SELECT * FROM warehouses WHERE id=?').get(id); d.close(); return r; };
const defCount = () => { const d = dbRead(); const r = d.prepare('SELECT COUNT(*) c FROM warehouses WHERE active=1 AND is_default=1').get().c; d.close(); return r; };

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 950 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });
page.on('dialog', async d => { await d.accept(); });   // solo confirm() en este flujo → aceptar siempre
const sleep = ms => new Promise(r => setTimeout(r, ms));

let norteId = null;
try {
  console.log('  (almacén del gate: "' + NORTE + '")');

  // Aislamiento: nadie puede llamarse ya como el nuestro. Si esto falla, el nombre único no es único
  // y todo lo que viene detrás es mentira.
  ok(!whRow(NORTE), 'el nombre del almacén de prueba está libre (nombre único por pasada)');

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
  await page.evaluate((id) => archiveWh(id), norteId);
  await sleep(500);
  ok(whById(norteId).active === 1, 'archivar el principal queda BLOQUEADO (sigue activo)');

  // ── 4. Devolver principal al original y archivar Norte (vacío) ──
  await page.evaluate((id) => defaultWh(id), W1);
  await sleep(400);
  ok(whById(W1).is_default === 1 && whById(norteId).is_default === 0, 'el original vuelve a ser principal');
  await page.evaluate((id) => archiveWh(id), norteId);
  await page.waitForFunction(() => true); await sleep(500);
  ok(whById(norteId).active === 0, 'Norte (vacío, no principal) se archiva');

  // ── 5. Restaurar Norte ──
  await page.evaluate((id) => restoreWh(id), norteId);
  await sleep(500);
  ok(whById(norteId).active === 1, 'Norte restaurado (active=1)');
  await page.screenshot({ path: '/tmp/wh-2-restaurado.png' });

  // ── 6. Stock por almacén: inyecto +6 en Norte (dato de prueba) y verifico filtro+ficha ──
  recordMovement(db, { product_id: PRODUCT_ID, type: 'entrada', quantity: 6, warehouse_id: norteId, origin_type: 'manual', note: 'gate almacenes' });

  await page.goto(BASE + '/admin/inventory', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#invBody tr'));
  body = await page.content();
  ok(body.includes('id="whFilter"') && body.includes('Todos (total)'), 'filtro de almacén presente (Todos + almacenes)');

  // Filtra por Norte: el producto debe mostrar 6 (lo inyectado en Norte), no su total global.
  await page.select('#whFilter', String(norteId));
  await page.waitForFunction(() => true); await sleep(500);
  const norteQty = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#invBody tr'));
    for (const tr of rows) { const t = tr.textContent; if (t.includes('Vela Lavanda')) return tr.querySelectorAll('td')[3].textContent.trim(); }
    return null;
  });
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
  ok(totalQty !== '6' && Number(totalQty) === stockBefore + 6,
     'con "Todos" muestra el total global (' + totalQty + ' = ' + stockBefore + ' del principal + 6 de Norte)');

  // Ficha (kardex modal): desglose "Stock por almacén" con los 2 almacenes.
  await page.evaluate((pid) => openStockKardex(pid, 'Vela Lavanda 200g'), PRODUCT_ID);
  await page.waitForFunction(() => { const b = document.getElementById('stockKardexBody'); return b && b.innerHTML.includes('Stock por almacén'); }, { timeout: 8000 });
  const fichaTxt = await page.$eval('#stockKardexBody', el => el.textContent);
  ok(fichaTxt.includes('Stock por almacén'), 'ficha: bloque "Stock por almacén" presente');
  ok(fichaTxt.includes('Almacén principal') && fichaTxt.includes(NORTE), 'ficha: desglose lista ambos almacenes activos');
  await page.screenshot({ path: '/tmp/wh-4-ficha-desglose.png' });

} finally {
  await browser.close();

  // ── Limpieza: borrar el movimiento inyectado Y el almacén de prueba (no archivarlo: archivarlo es
  //    lo que hizo que se acumularan y que la pasada siguiente se enganchara al rancio). ──
  const db2 = new Database(DB_PATH);
  const tocadas = purgarArtefactos(db2, { almacenes: norteId ? [norteId] : [] });
  console.log('  (limpieza: ' + tocadas.movimientos + ' movimiento(s), ' + tocadas.almacenes + ' almacén)');

  const after = db2.prepare('SELECT stock FROM products WHERE id=?').get(PRODUCT_ID).stock;
  ok(after === stockBefore, `el tenant queda como estaba: stock vuelve a ${stockBefore} (got ${after})`);
  ok(cuadraLibro(db2, [PRODUCT_ID]), 'caché == libro tras retirar el dato de prueba');
  ok(!whRow(NORTE), 'el almacén de prueba ya NO existe (borrado, no archivado: no se acumula)');
  const almacenesAfter = db2.prepare('SELECT COUNT(*) c FROM warehouses').get().c;
  ok(almacenesAfter === almacenesBefore, `el nº de almacenes vuelve al de partida (${almacenesBefore} → ${almacenesAfter})`);

  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador Almacenes: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
