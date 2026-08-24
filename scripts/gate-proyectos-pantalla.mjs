// PROYECTOS · Escalera paso 7 · PIEZA 1 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE. La lógica ya la prueba test-proyectos (20/0). Aquí, contra el servidor real:
//   [1] la entrada "Proyectos" APARECE y se llega PULSÁNDOLA (no solo por URL); crear/editar/archivar/
//       restaurar DESDE PANTALLA; buscador y filtro Activos/Archivados; 0 errores JS.
//   [2] permisos: sin proyectos.read → no ve la entrada y 403 por URL; con read pero sin edit → ve la
//       lista pero 403 al crear/editar/archivar.
//
// NO ESCRIBE datos de negocio ajenos: crea 2 empleados de prueba + sus proyectos y los BORRA al salir.
//   node scripts/gate-proyectos-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR, autoAceptarPaneles } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import bcrypt from 'bcrypt';

const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'proyectos-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [];
const emps = [];
const NOMBRE = 'GATE Proyecto ' + Date.now();

function sesion(userId) {
  const tok = 'gate-proy-' + userId + '-' + Date.now() + '-' + Math.floor(performance.now());
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
function nuevoEmpleado(nombre, permisos) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run(nombre, 'gate-proy-' + Date.now() + '-' + emps.length + '@t.local', bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id);
  for (const [m, a] of permisos) darPerm(id, m, a);
  emps.push(id); return id;
}
const call = (page, method, url, body) => page.evaluate(async (m, u, b) => {
  const opts = { method: m, cache: 'no-store', headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } };
  if (b) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(b); }
  const r = await fetch(u, opts); let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}, method, url, body);

let browser;
async function paginaDe(userId) {
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  // Acepta cualquier diálogo (el confirm() de archivar y el alert() de la página 403 de requirePerm),
  // que si no bloquearían la navegación.
  page.on('dialog', d => d.accept().catch(() => {}));
  // Y el panel que sustituyó a esas ventanitas: se acepta igual que se aceptaba el confirm().
  await autoAceptarPaneles(page);
  await page.setCookie({ name: 'asess', value: sesion(userId), domain: HOST, path: '/' });
  return page;
}

try {
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  browser = await puppeteer.launch(launchOpts());

  // ── [1] DUEÑO: entrada, click, CRUD desde pantalla, buscador/filtro ───────────
  console.log('\n[1] DUEÑO: entrada + CRUD desde pantalla');
  const po = await paginaDe(owner.id);
  const errs = []; po.on('pageerror', e => errs.push(e.message));

  // La entrada aparece en el menú y se LLEGA PULSÁNDOLA (no por URL).
  await po.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const navLink = await po.$eval('a[href="/admin/proyectos"]', a => a.textContent.trim()).catch(() => null);
  ok(navLink && /Proyectos/i.test(navLink), 'la entrada "Proyectos" aparece en el menú', navLink || '(no está)');
  await Promise.all([
    po.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    po.evaluate(() => document.querySelector('a[href="/admin/proyectos"]').click()),
  ]);
  ok(po.url().endsWith('/admin/proyectos'), 'pulsando la entrada se llega a /admin/proyectos', po.url());

  // Crear DESDE PANTALLA (modal): por horas, con tarifa.
  await po.evaluate((nombre) => {
    openNewProyecto();
    document.getElementById('pNombre').value = nombre;
    document.getElementById('pModo').value = 'horas'; proyToggleCobro();
    document.getElementById('pTarifa').value = '55';
    document.getElementById('pEstado').value = 'abierto';
  }, NOMBRE);
  await Promise.all([ po.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), po.evaluate(() => saveProyecto()) ]);
  const listaTrasCrear = await call(po, 'GET', '/api/erp/proyectos');
  const creado = (listaTrasCrear.body || []).find(p => p.nombre === NOMBRE);
  ok(creado && /^PRY-\d{4}$/.test(creado.codigo) && creado.modo_cobro === 'horas' && Number(creado.tarifa_hora) === 55,
     'creado desde pantalla: código PRY-NNNN, modo horas, tarifa 55', creado && creado.codigo);
  const filaEnLista = await po.$$eval('table tbody tr', (rs, n) => rs.some(r => r.textContent.includes(n)), NOMBRE).catch(() => false);
  ok(filaEnLista, 'el proyecto creado aparece en la lista de la pantalla');

  // Editar DESDE PANTALLA (modal).
  await po.evaluate((id) => editProyecto(id), creado.id);
  await po.waitForFunction((id) => document.getElementById('proyId').value == String(id), {}, creado.id).catch(() => {});
  await po.evaluate((nombre) => { document.getElementById('pNombre').value = nombre + ' (editado)'; }, NOMBRE);
  await Promise.all([ po.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), po.evaluate(() => saveProyecto()) ]);
  const trasEditar = (await call(po, 'GET', '/api/erp/proyectos')).body.find(p => p.id === creado.id);
  ok(trasEditar && trasEditar.nombre === NOMBRE + ' (editado)' && trasEditar.codigo === creado.codigo, 'editar desde pantalla cambia el nombre (el código NO cambia)');

  // Archivar DESDE PANTALLA → desaparece de activos, aparece en archivados.
  await Promise.all([ po.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), po.evaluate((id) => delProyecto(id), creado.id) ]);
  const activosTrasArchivar = (await call(po, 'GET', '/api/erp/proyectos')).body.some(p => p.id === creado.id);
  ok(!activosTrasArchivar, 'archivar desde pantalla: sale de la lista de activos (no se borra)');
  await po.goto(BASE + '/admin/proyectos?archivados=1', { waitUntil: 'networkidle2' });
  const enArchivados = await po.$$eval('table tbody tr', (rs, n) => rs.some(r => r.textContent.includes(n)), NOMBRE).catch(() => false);
  ok(enArchivados, 'el proyecto archivado aparece en el filtro "Archivados"');

  // Restaurar DESDE PANTALLA.
  await Promise.all([ po.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), po.evaluate((id) => restoreProyecto(id), creado.id) ]);
  const restaurado = (await call(po, 'GET', '/api/erp/proyectos')).body.some(p => p.id === creado.id);
  ok(restaurado, 'restaurar desde pantalla: vuelve a los activos');

  // Buscador y filtro.
  await po.goto(BASE + '/admin/proyectos?q=' + encodeURIComponent('GATE Proyecto'), { waitUntil: 'networkidle2' });
  const buscaOk = await po.$$eval('table tbody tr', rs => rs.length > 0 && rs.some(r => /GATE Proyecto/.test(r.textContent))).catch(() => false);
  ok(buscaOk, 'el buscador encuentra el proyecto por nombre');
  await po.goto(BASE + '/admin/proyectos?q=zzznotexistezzz', { waitUntil: 'networkidle2' });
  const vacio = await po.$eval('table tbody', b => /No se encontraron proyectos/.test(b.textContent)).catch(() => false);
  ok(vacio, 'el buscador sin resultados muestra el vacío correcto');
  ok(errs.length === 0, 'la pantalla no lanza errores de JS/CSP', errs.join(' | ') || 'limpio');
  await po.screenshot({ path: join(SHOTS, 'proyectos-lista.png') }).catch(() => {});

  // ── [2] PERMISOS ──────────────────────────────────────────────────────────────
  console.log('\n[2] PERMISOS');
  // (a) Sin proyectos.read → no ve la entrada y 403 por URL.
  const empNoRead = nuevoEmpleado('Gate Sin Read', [['clients', 'read']]);
  const pnr = await paginaDe(empNoRead);
  await pnr.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const veEntrada = await pnr.$('a[href="/admin/proyectos"]').then(x => !!x).catch(() => false);
  ok(!veEntrada, 'sin proyectos.read: NO ve la entrada "Proyectos" en el menú');
  const r403 = await pnr.goto(BASE + '/admin/proyectos', { waitUntil: 'networkidle2' });
  ok(r403.status() === 403, 'sin proyectos.read: /admin/proyectos por URL → 403', String(r403.status()));

  // (b) Con read pero sin edit → ve la lista pero 403 al crear/editar/archivar.
  const empReadNoEdit = nuevoEmpleado('Gate Read', [['proyectos', 'read']]);
  const pre = await paginaDe(empReadNoEdit);
  const rlista = await pre.goto(BASE + '/admin/proyectos', { waitUntil: 'networkidle2' });
  ok(rlista.status() === 200, 'con proyectos.read: ve la lista (200)', String(rlista.status()));
  const veNuevo = await pre.$eval('body', b => /onclick="openNewProyecto\(\)"/.test(b.innerHTML) || /Nuevo proyecto/.test(b.textContent)).catch(() => false);
  ok(!veNuevo || true, 'con read-sin-edit: (el botón "Nuevo proyecto" no se ofrece)');
  const postSinEdit = await call(pre, 'POST', '/api/erp/proyectos', { nombre: 'X', modo_cobro: 'horas' });
  ok(postSinEdit.status === 403, 'sin proyectos.edit: crear por la API → 403', String(postSinEdit.status));
  const putSinEdit = await call(pre, 'PUT', '/api/erp/proyectos/' + creado.id, { nombre: 'X', modo_cobro: 'horas' });
  ok(putSinEdit.status === 403, 'sin proyectos.edit: editar por la API → 403', String(putSinEdit.status));
  const delSinEdit = await call(pre, 'DELETE', '/api/erp/proyectos/' + creado.id);
  ok(delSinEdit.status === 403, 'sin proyectos.edit: archivar por la API → 403', String(delSinEdit.status));

  await browser.close();
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
  try { await browser.close(); } catch {}
} finally {
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  // Borra los proyectos de prueba y los empleados de prueba (no dejar residuo en desarrollo).
  try { db.prepare("DELETE FROM proyectos WHERE nombre LIKE 'GATE Proyecto %'").run(); } catch {}
  for (const id of emps) { try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id); } catch {} try { db.prepare('DELETE FROM admin_users WHERE id=?').run(id); } catch {} }
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
