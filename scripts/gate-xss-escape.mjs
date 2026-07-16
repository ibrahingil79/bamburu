// Gate de navegador — C4a/M1 (Eje C): XSS ALMACENADO, contra el servidor real (tenant
// desarrollo-bamburu). Guarda payloads REALES en los campos que el informe señalaba sin escapar,
// abre las pantallas que los pintan y comprueba que el navegador los trata como TEXTO y no como
// código. Limpia tras de sí.
//
// POR QUÉ SE INSERTA EN LA BD Y NO POR LA UI. Un XSS almacenado es, por definición, un dato que YA
// está guardado — pudo entrar por la UI, por la API, por DISA o por una importación. Lo que este
// gate mide es la ÚNICA defensa que aplica a todos esos caminos: el escapado AL PINTAR. Si el gate
// dependiera del formulario, una validación de entrada que hoy filtre el '<' daría un verde que
// tapa el agujero de salida — y mañana, un camino nuevo sin esa validación lo reabre en silencio.
//
// LAS DOS CLASES DE FALLO SE PRUEBAN POR SEPARADO, porque su defensa es distinta:
//   A) Concatenación en HTML  → escHtml. Pantallas: Categorías (cliente) y Nueva compra (servidor).
//   B) Ruptura de <script> con '</script>' dentro de un JSON → jsonForScript. Pantalla: Nueva compra
//      (var PRODUCTS). Aquí escHtml NO vale: dentro de un <script> no se decodifican entidades.
//
// El veredicto NO es "no saltó un alert". Se comprueban tres cosas a la vez: que no se ejecutó JS
// (bandera window.__xss), que no nació ningún ELEMENTO inyectado (el <img> del payload), y que el
// texto se ve LITERAL. Un payload puede inyectar HTML sin ejecutar nada y sigue siendo un agujero.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { RID } from './lib/gate-fixtures.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { join } from 'path';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const rid = RID();
// Payload A: inyecta un <img> que, si el HTML se parsea, dispara onerror (src=x no carga nunca).
const IMG = '<img src=x onerror="window.__xss=1">';
// Payload B: cierra la etiqueta <script> antes de tiempo. Es el que escHtml NO puede parar.
const BREAKOUT = '</script>' + IMG;

const WH_NAME = 'Alm ' + BREAKOUT + ' (gate ' + rid + ')';
const CAT_NAME = 'Cat ' + IMG + ' (gate ' + rid + ')';
const CAT_DESC = 'Desc ' + IMG + ' (gate ' + rid + ')';
const SUP_NAME = 'Prov ' + IMG + ' (gate ' + rid + ')';
const PROD_NAME = 'Prod ' + BREAKOUT + ' (gate ' + rid + ')';

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 900, csrf);

const catId = db.prepare('INSERT INTO categories (name,description) VALUES (?,?)').run(CAT_NAME, CAT_DESC).lastInsertRowid;
const supId = db.prepare('INSERT INTO suppliers (name) VALUES (?)').run(SUP_NAME).lastInsertRowid;
const prodId = db.prepare("INSERT INTO products (name,sku,price,stock,status,type) VALUES (?,?,0,0,'active','physical')").run(PROD_NAME, 'GATE-' + rid).lastInsertRowid;
const whId = db.prepare("INSERT INTO warehouses (name,active,is_default) VALUES (?,1,0)").run(WH_NAME).lastInsertRowid;

// El negocio malicioso vive en control.db (la BD de enrutado de la plataforma), como el de cualquiera
// que se dé de alta por /registro. db_filename apunta a una BD que NO existe a propósito: tenantAiInfo
// abre con fileMustExist y traga la excepción, así que la fila se pinta sin crear ninguna BD fantasma.
const CONTROL_DB = join(APP_DIR, 'data', 'control.db');
const cdb = new Database(CONTROL_DB);
const SA_BASE = 'http://localhost:3000';
const TENANT_NAME = 'Negocio ' + IMG + ' (gate ' + rid + ')';
const saTenantId = cdb.prepare("INSERT INTO tenants (name,slug,db_filename,plan,status,country) VALUES (?,?,?,'starter','active','ES')")
  .run(TENANT_NAME, 'gate-xss-' + rid, 'data/tenants/__gate_' + rid + '_no_existe.db').lastInsertRowid;
const saToken = randomBytes(32).toString('base64url');
cdb.prepare('INSERT INTO superadmin_sessions (token,superadmin_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(saToken, 1, now, now + 900, randomBytes(32).toString('base64url'));

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

// Cualquier alert()/confirm() de un payload se anota; ninguno debería llegar.
const dialogos = [];
page.on('dialog', async d => { dialogos.push(d.message()); await d.dismiss(); });
const errores = [];
page.on('pageerror', e => errores.push(String(e)));

// ¿Ejecutó JS el payload, o nació el elemento inyectado?
const inyectado = () => page.evaluate(() => ({
  ejecutado: !!window.__xss,
  imgs: document.querySelectorAll('img[src="x"]').length,
}));

try {
  // ── A · Categorías: render de cliente (innerHTML + window.escHtml) ──
  console.log('\n[A] Categorías — nombre y descripción con <img onerror> guardados en la BD');
  await page.goto(BASE + '/admin/categories', { waitUntil: 'networkidle0' });
  await page.waitForFunction((r) => document.body.innerHTML.includes(r), { timeout: 10000 }, rid);
  let r = await inyectado();
  ok(r.ejecutado === false, 'el payload NO ejecutó JS (window.__xss sin poner)');
  ok(r.imgs === 0, 'NO nació el <img> inyectado → el HTML no se parseó, se escapó');
  const textoCat = await page.evaluate(() => document.getElementById('catBody').textContent);
  ok(textoCat.includes(IMG), 'el nombre se ve LITERAL, con sus < y > a la vista (es texto, no un elemento)');
  ok(textoCat.includes('Desc <img'), 'la descripción también se ve literal');

  // ── B · Nueva compra: <option> server-rendered + var PRODUCTS dentro de un <script> ──
  console.log('\n[B] Nueva compra — proveedor con <img onerror> y producto con </script>');
  await page.goto(BASE + '/admin/purchases/new', { waitUntil: 'networkidle0' });
  r = await inyectado();
  ok(r.ejecutado === false, 'el payload NO ejecutó JS (ni el <option>, ni la ruptura de <script>)');
  ok(r.imgs === 0, 'NO nació el <img> inyectado');
  ok(errores.length === 0, 'la página no lanzó ningún error de JS' + (errores.length ? ': ' + errores[0] : ''));

  // El <option> del proveedor: texto literal dentro del desplegable.
  const optTexto = await page.evaluate((n) => {
    const o = [...document.querySelectorAll('option')].find(x => x.textContent.includes(n));
    return o ? o.textContent : null;
  }, 'gate ' + rid);
  ok(optTexto !== null && optTexto.includes(IMG), 'el <option> de proveedor muestra el payload como texto literal');

  // La prueba de fuego de jsonForScript: PRODUCTS existe (no se rompió el script) y el nombre
  // llegó ENTERO. Si el escape hubiera estropeado el dato, esto fallaría igual que si hubiera XSS.
  const prod = await page.evaluate((id) => {
    if (typeof PRODUCTS === 'undefined') return { existe: false };
    const p = (PRODUCTS || []).find(x => x.id === id);
    return { existe: true, total: PRODUCTS.length, name: p ? p.name : null };
  }, prodId);
  ok(prod.existe === true, 'var PRODUCTS existe → el </script> del nombre NO cerró la etiqueta antes de tiempo');
  ok(prod.name === PROD_NAME, 'el nombre del producto llega INTACTO al navegador (el escape no corrompe el dato)');
  ok(prod.total >= 1, 'el catálogo completo sigue cargando (' + prod.total + ' productos)');

  // ── C · Almacenes: un solo sink de Clase B que alcanza TRES pantallas ──
  // views/stock-modal.js lo montan avisos.js, inventory.js y products.js: arreglarlo en el origen
  // (jsonForScript) los cubre a los tres. Se prueba por Inventario.
  console.log('\n[C] Inventario — almacén con </script> en el nombre (stock-modal, 3 pantallas)');
  await page.goto(BASE + '/admin/inventory', { waitUntil: 'networkidle0' });
  r = await inyectado();
  ok(r.ejecutado === false, 'el payload del almacén NO ejecutó JS');
  ok(r.imgs === 0, 'NO nació el <img> inyectado');
  const wh = await page.evaluate((n) => {
    if (typeof WAREHOUSES === 'undefined') return { existe: false };
    return { existe: true, encontrado: (WAREHOUSES || []).some(w => w.name === n) };
  }, WH_NAME);
  ok(wh.existe === true, 'const WAREHOUSES existe → el </script> del almacén no rompió el script');
  ok(wh.encontrado === true, 'el nombre del almacén llega INTACTO (el escape no corrompe el dato)');

  // ── D · SUPERADMIN: el más grave. Un desconocido se da de alta con un nombre-payload y espera
  // a que el superadmin pulse un botón en su fila. La LISTA escapa bien (index.js:156-157) —
  // el agujero está en el SEGUNDO viaje: dataset.name devuelve el valor DECODIFICADO y saCap()
  // lo reinyecta por innerHTML. Un escape que "ya está puesto" es justo lo que lo escondía.
  console.log('\n[D] Superadmin — negocio con nombre-payload (cruza inquilinos)');
  const sapage = await browser.newPage();
  const saDialogos = [];
  sapage.on('dialog', async d => { saDialogos.push(d.message()); await d.dismiss(); });
  await sapage.setCookie({ name: 'sadm', value: saToken, domain: 'localhost', path: '/' });
  await sapage.goto(SA_BASE + '/superadmin/negocios', { waitUntil: 'networkidle0' });

  const filaOk = await sapage.evaluate((id) => !!document.querySelector('tr[data-id="' + id + '"]'), saTenantId);
  ok(filaOk === true, 'el negocio malicioso aparece en la lista de Negocios');
  let sr = await sapage.evaluate(() => ({ ejecutado: !!window.__xss, imgs: document.querySelectorAll('img[src="x"]').length }));
  ok(sr.ejecutado === false && sr.imgs === 0, 'la LISTA no ejecuta el payload (esto ya era así: :156-157 escapan)');

  // El clic que dispara el fallo. Es lo que haría el superadmin en su día a día.
  await sapage.evaluate((id) => saCap(id), saTenantId);
  await sapage.waitForFunction(() => document.getElementById('modalBox').innerHTML.length > 0, { timeout: 8000 });
  sr = await sapage.evaluate(() => ({ ejecutado: !!window.__xss, imgs: document.querySelectorAll('img[src="x"]').length }));
  ok(sr.ejecutado === false, 'tras pulsar "Tope IA" el payload NO ejecuta JS en la sesión de superadmin');
  ok(sr.imgs === 0, 'NO nació el <img> inyectado en el modal');
  const modalTxt = await sapage.evaluate(() => document.getElementById('modalBox').textContent);
  ok(modalTxt.includes(IMG), 'el nombre del negocio se ve LITERAL en el modal');

  await sapage.evaluate((id) => saSuspend(id), saTenantId);
  await sapage.waitForFunction(() => document.getElementById('modalBox').innerHTML.includes('Suspender'), { timeout: 8000 });
  sr = await sapage.evaluate(() => ({ ejecutado: !!window.__xss, imgs: document.querySelectorAll('img[src="x"]').length }));
  ok(sr.ejecutado === false && sr.imgs === 0, 'lo mismo por el otro camino: "Suspender" tampoco ejecuta nada');
  ok(saDialogos.length === 0, 'ningún alert() saltó en la consola de superadmin');

  ok(dialogos.length === 0, 'ningún alert()/confirm() saltó en toda la pasada');
} finally {
  await browser.close();
  // Limpieza: se borra lo que creó el gate, nada más. Los ids son suyos (recién insertados).
  db.prepare('DELETE FROM products WHERE id=?').run(prodId);
  db.prepare('DELETE FROM suppliers WHERE id=?').run(supId);
  db.prepare('DELETE FROM categories WHERE id=?').run(catId);
  db.prepare('DELETE FROM warehouses WHERE id=?').run(whId);
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  const resto = db.prepare("SELECT COUNT(*) c FROM categories WHERE name LIKE ?").get('%gate ' + rid + '%').c
              + db.prepare("SELECT COUNT(*) c FROM products WHERE name LIKE ?").get('%gate ' + rid + '%').c
              + db.prepare("SELECT COUNT(*) c FROM suppliers WHERE name LIKE ?").get('%gate ' + rid + '%').c
              + db.prepare("SELECT COUNT(*) c FROM warehouses WHERE name LIKE ?").get('%gate ' + rid + '%').c;
  // control.db es la BD de enrutado de TODA la plataforma: aquí no se deja residuo ni de broma.
  cdb.prepare('DELETE FROM superadmin_sessions WHERE token=?').run(saToken);
  cdb.prepare('DELETE FROM tenants WHERE id=?').run(saTenantId);
  const restoCtl = cdb.prepare("SELECT COUNT(*) c FROM tenants WHERE slug LIKE ?").get('gate-xss-%').c;
  cdb.close();
  console.log('\n  (limpieza tenant: ' + (resto === 0 ? 'sin residuo' : '⚠️ quedan ' + resto + ' filas') +
              ' · control.db: ' + (restoCtl === 0 ? 'sin residuo' : '⚠️ quedan ' + restoCtl + ' negocios del gate') + ')');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' XSS almacenado (M1): ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
