// REGISTRO DE TIEMPO · Escalera paso 7 · PIEZA 2 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE. La lógica ya la prueba test-tiempo (23/0). Aquí, contra el servidor:
//   [1] la entrada "Registro de tiempo" aparece y se llega pulsándola; cronómetro (arrancar/parar) y
//       entrada manual DESDE PANTALLA; importe cuadrado con la tarifa; la ficha del proyecto muestra el
//       total; vista semanal; 0 errores JS.
//   [2] permisos: sin tiempo.read → no ve la entrada y 403 por URL; con read sin edit → ve pero 403 al
//       registrar; PROPIEDAD: un usuario no edita las entradas de otro (403), el dueño/admin sí.
//
// NO ESCRIBE datos de negocio ajenos: siembra proyecto + empleados + entradas de prueba y los BORRA.
//   node scripts/gate-tiempo-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR, autoAceptarPaneles } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import bcrypt from 'bcrypt';
import { randomBytes as __rb } from 'crypto';
// Identificador de ESTA pasada: los códigos de los proyectos de prueba lo llevan, porque
// `proyectos.codigo` es UNIQUE y un código fijo deja el gate muerto en cuanto una pasada cae
// a medias sin limpiar (pasó el 24 ago 2026).
const RID = __rb(3).toString('hex');

const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'tiempo-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [];
const emps = [];
let proyId = null, ownerTarifaPrev;
const NOMBRE = 'GATE Tiempo ' + Date.now();

function sesion(userId) {
  const tok = 'gate-tie-' + userId + '-' + Date.now() + '-' + Math.floor(performance.now());
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
function nuevoEmpleado(nombre, permisos, tarifa = null) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,tarifa_hora) VALUES (?,?,?,'employee',1,?)")
    .run(nombre, 'gate-tie-' + Date.now() + '-' + emps.length + '@t.local', bcrypt.hashSync('Test1234!', 10), tarifa).lastInsertRowid;
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
  page.on('dialog', d => d.accept().catch(() => {}));   // confirm() de eliminar / alert() del 403
  await page.setCookie({ name: 'asess', value: sesion(userId), domain: HOST, path: '/' });
  // Y el panel que sustituyó a esas ventanitas: se acepta igual que se aceptaba el confirm().
  await autoAceptarPaneles(page);
  return page;
}

try {
  const owner = db.prepare("SELECT id, tarifa_hora FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  ownerTarifaPrev = owner.tarifa_hora;
  db.prepare('UPDATE admin_users SET tarifa_hora=60 WHERE id=?').run(owner.id);   // tarifa del dueño para el importe
  proyId = db.prepare("INSERT INTO proyectos (codigo,nombre,modo_cobro,active) VALUES (?,?,?,1)").run('GATE-PRY-' + RID, NOMBRE, 'horas').lastInsertRowid;

  browser = await puppeteer.launch(launchOpts());

  // ── [1] DUEÑO: entrada + cronómetro + manual + ficha + semanal ───────────────
  console.log('\n[1] DUEÑO: registro de tiempo desde pantalla');
  const po = await paginaDe(owner.id);
  const errs = []; po.on('pageerror', e => errs.push(e.message));
  await po.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const navLink = await po.$eval('a[href="/admin/tiempo"]', a => a.textContent.trim()).catch(() => null);
  ok(navLink && /tiempo/i.test(navLink), 'la entrada "Registro de tiempo" aparece en el menú', navLink || '(no está)');
  await Promise.all([ po.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), po.evaluate(() => document.querySelector('a[href="/admin/tiempo"]').click()) ]);
  ok(po.url().endsWith('/admin/tiempo'), 'pulsando la entrada se llega a /admin/tiempo', po.url());
  await po.waitForFunction(() => typeof tSaveManual === 'function', { timeout: 8000 }).catch(() => {});
  // Sin cronómetro en marcha, el botón "Empezar" debe estar HABILITADO y la caja "corriendo" oculta
  // (regresión del bug: /activo devolvía null y el api() lo volvía {} → botón deshabilitado de salida).
  const inicial = await po.evaluate(() => ({ disabled: document.getElementById('tBtnStart')?.disabled, running: (() => { const x = document.getElementById('tRunning'); return !!(x && x.style.display !== 'none'); })() }));
  ok(inicial.disabled === false && inicial.running === false, 'sin cronómetro: "Empezar" habilitado y sin caja "corriendo"', JSON.stringify(inicial));

  // Entrada MANUAL (2h, facturable) → aparece y su importe cuadra (2h × 60 = 120).
  await po.evaluate((pid) => { tOpenManual(); document.getElementById('tmProyecto').value = String(pid); document.getElementById('tmHoras').value = '2'; document.getElementById('tmMin').value = '0'; document.getElementById('tmFact').checked = true; }, proyId);
  await po.evaluate(() => tSaveManual());
  await po.waitForFunction(() => document.querySelector('#tBody table tbody tr'), { timeout: 8000 }).catch(() => {});
  const semana = await call(po, 'GET', '/api/erp/tiempo?desde=' + await po.evaluate(() => T_LUNES));
  const manual = (semana.body.entradas || []).find(e => e.proyecto_id === proyId && e.duracion_seg === 7200);
  ok(manual && manual.importe === 120, 'entrada manual 2h: importe = 120 € (2h × tarifa 60 de la persona)', manual && ('' + manual.importe));
  const filaVista = await po.$$eval('#tBody table tbody tr', rs => rs.some(r => /2h 00m|2h 0m/.test(r.textContent))).catch(() => false);
  ok(filaVista, 'la entrada aparece en la vista semanal con su duración');

  // CRONÓMETRO: se PULSA el botón real (no evaluate) → caja "corriendo" visible; parar → se oculta.
  await po.evaluate((pid) => { document.getElementById('tProyecto').value = String(pid); document.getElementById('tDesc').value = 'cronometrando'; }, proyId);
  await po.click('#tBtnStart');
  await po.waitForFunction(() => { const b = document.getElementById('tRunning'); return b && b.style.display !== 'none'; }, { timeout: 8000 }).catch(() => {});
  const corriendo = await po.evaluate(() => { const b = document.getElementById('tRunning'); return !!(b && b.style.display !== 'none'); });
  ok(corriendo, 'PULSANDO "Empezar" arranca el cronómetro (caja "en marcha" visible)');
  const activo = await call(po, 'GET', '/api/erp/tiempo/activo');
  ok(activo.body && activo.body.corriendo, 'la API confirma un cronómetro activo');
  await po.evaluate(() => tStop());
  await po.waitForFunction(() => { const b = document.getElementById('tRunning'); return b && b.style.display === 'none'; }, { timeout: 8000 }).catch(() => {});
  const activo2 = await call(po, 'GET', '/api/erp/tiempo/activo');
  ok(activo2.body && activo2.body.corriendo === null, 'al parar, ya no hay cronómetro activo');
  ok(errs.length === 0, 'la pantalla no lanza errores de JS/CSP', errs.join(' | ') || 'limpio');
  await po.screenshot({ path: join(SHOTS, 'tiempo-semana.png') }).catch(() => {});

  // La FICHA del proyecto muestra el registro de tiempo con su total.
  await po.goto(BASE + '/admin/proyectos', { waitUntil: 'networkidle2' });
  await po.evaluate((id) => viewDetail(id), proyId);
  await po.waitForFunction(() => { const b = document.getElementById('proyTiempo'); return b && /Registro de tiempo/.test(b.textContent) && /Total:/.test(b.textContent); }, { timeout: 8000 }).catch(() => {});
  const fichaTiempo = await po.evaluate(() => { const b = document.getElementById('proyTiempo'); return b ? b.textContent : ''; });
  ok(/Total:/.test(fichaTiempo) && /Facturable:/.test(fichaTiempo), 'la ficha del proyecto muestra el total de horas y el facturable');

  // ── [2] PERMISOS + PROPIEDAD ──────────────────────────────────────────────────
  console.log('\n[2] PERMISOS + PROPIEDAD');
  // (a) sin tiempo.read → no ve la entrada y 403 por URL.
  const empNoRead = nuevoEmpleado('Gate Sin Read', [['clients', 'read']]);
  const pnr = await paginaDe(empNoRead);
  await pnr.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const veEntrada = await pnr.$('a[href="/admin/tiempo"]').then(x => !!x).catch(() => false);
  ok(!veEntrada, 'sin tiempo.read: NO ve la entrada "Registro de tiempo"');
  const r403 = await pnr.goto(BASE + '/admin/tiempo', { waitUntil: 'networkidle2' });
  ok(r403.status() === 403, 'sin tiempo.read: /admin/tiempo por URL → 403', String(r403.status()));

  // (b) con read sin edit → ve la pantalla pero 403 al registrar.
  const empRead = nuevoEmpleado('Gate Read', [['tiempo', 'read']]);
  const pre = await paginaDe(empRead);
  const rl = await pre.goto(BASE + '/admin/tiempo', { waitUntil: 'networkidle2' });
  ok(rl.status() === 200, 'con tiempo.read: ve la pantalla (200)', String(rl.status()));
  const veTimer = await pre.$('#tBtnStart').then(x => !!x).catch(() => false);
  ok(!veTimer, 'con read-sin-edit: NO se ofrecen los controles de registrar (cronómetro/manual)');
  const postSinEdit = await call(pre, 'POST', '/api/erp/tiempo', { proyecto_id: proyId, fecha: '2026-07-21', horas: 1, minutos: 0 });
  ok(postSinEdit.status === 403, 'sin tiempo.edit: registrar por la API → 403', String(postSinEdit.status));

  // (c) PROPIEDAD: A crea; B (otro con edit) no puede editar la de A; el dueño sí.
  const empA = nuevoEmpleado('Gate A', [['tiempo', 'read'], ['tiempo', 'edit']]);
  const empB = nuevoEmpleado('Gate B', [['tiempo', 'read'], ['tiempo', 'edit']]);
  const pa = await paginaDe(empA);
  await pa.goto(BASE + '/admin/tiempo', { waitUntil: 'networkidle2' });   // situar la página en el origen (fetch relativo)
  const creada = await call(pa, 'POST', '/api/erp/tiempo', { proyecto_id: proyId, fecha: '2026-07-21', horas: 1, minutos: 0 });
  ok(creada.status === 200 && creada.body.id, 'A registra una entrada (200)');
  const pb = await paginaDe(empB);
  await pb.goto(BASE + '/admin/tiempo', { waitUntil: 'networkidle2' });
  const editB = await call(pb, 'PUT', '/api/erp/tiempo/' + creada.body.id, { proyecto_id: proyId, fecha: '2026-07-21', horas: 3, minutos: 0 });
  ok(editB.status === 403, 'PROPIEDAD: B NO puede editar la entrada de A → 403', String(editB.status));
  const editOwner = await call(po, 'PUT', '/api/erp/tiempo/' + creada.body.id, { proyecto_id: proyId, fecha: '2026-07-21', horas: 4, minutos: 0 });
  ok(editOwner.status === 200, 'el dueño/admin SÍ edita la entrada de cualquiera → 200', String(editOwner.status));

  await browser.close();
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
  try { await browser.close(); } catch {}
} finally {
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  try { const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get(); db.prepare('UPDATE admin_users SET tarifa_hora=? WHERE id=?').run(ownerTarifaPrev ?? null, owner.id); } catch {}
  try { if (proyId) db.prepare('DELETE FROM time_entries WHERE proyecto_id=?').run(proyId); } catch {}
  for (const id of emps) { try { db.prepare('DELETE FROM time_entries WHERE user_id=?').run(id); } catch {} try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id); } catch {} try { db.prepare('DELETE FROM admin_users WHERE id=?').run(id); } catch {} }
  try { if (proyId) db.prepare('DELETE FROM proyectos WHERE id=?').run(proyId); } catch {}
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
