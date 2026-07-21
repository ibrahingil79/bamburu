// FACTURAR HORAS · Escalera paso 7 · PIEZA 3 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE (la lógica ya la prueba test-facturar-horas 31/0). Aquí, contra el servidor real:
//   [1] la entrada "Facturar horas" aparece y se llega pulsándola; al elegir proyecto salen sus horas
//       facturables; la vista previa agrupa por tarea+tarifa y cuadra; "Generar factura" crea una FACTURA
//       REAL (motor de siempre) y lleva a su pantalla; las entradas quedan facturadas, fuera de la lista y
//       bloqueadas (editar/eliminar → 409); 0 errores JS.
//   [2] permisos: sin invoices.create → no ve la entrada, 403 por URL y 403 al emitir por la API; con el
//       permiso → 200 (prueba que el candado es por permiso, no por bypass del dueño).
//
// RESIDUO NETO-CERO: crea la factura y luego la ANULA (una factura anulada NO cuenta en Ventas, ver
// verify-constructor). Se comprueba que el total de Ventas queda EXACTAMENTE igual. La factura anulada y su
// registro de anulación permanecen en la cadena Verifactu A PROPÓSITO (es inmutable): es residuo esperado.
//   node scripts/gate-facturar-horas-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import bcrypt from 'bcrypt';
import { anularInvoice } from '../modules/erp/routes/invoices.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';

const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'fh-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [], emps = [];
let proyId = null, cliId = null, workerId = null, invoiceId = null;
const NOMBRE = 'GATE FH ' + Date.now();
const HOY = new Date().toISOString().slice(0, 10);
const TODO = () => true;
const ventasBase = () => { const r = cruzar(db, { dimension: 'fecha', medidas: ['base'], hasPerm: TODO }); return Math.round(r.filas.reduce((a, f) => a + (Number(f.base) || 0), 0) * 100) / 100; };

function sesion(userId) {
  const tok = 'gate-fh-' + userId + '-' + Date.now() + '-' + Math.floor(performance.now());
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
function nuevoEmpleado(nombre, permisos, tarifa = null) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,tarifa_hora) VALUES (?,?,?,'employee',1,?)")
    .run(nombre, 'gate-fh-' + Date.now() + '-' + emps.length + '@t.local', bcrypt.hashSync('Test1234!', 10), tarifa).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id);
  for (const [m, a] of permisos) darPerm(id, m, a);
  emps.push(id); return id;
}
const nuevaEntrada = (desc) => db.prepare('INSERT INTO time_entries (proyecto_id,user_id,descripcion,fecha,started_at,duracion_seg,facturable,active) VALUES (?,?,?,?,NULL,?,1,1)')
  .run(proyId, workerId, desc, HOY, 7200).lastInsertRowid;   // 2h exactas
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
  page.on('dialog', d => d.accept().catch(() => {}));   // confirm() de generar / alert() del 403
  await page.setCookie({ name: 'asess', value: sesion(userId), domain: HOST, path: '/' });
  return page;
}

try {
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  cliId = db.prepare("INSERT INTO clients (name,fiscal_id,country,active) VALUES (?,?, 'ES',1)").run('GATE FH Cliente', 'X1234567X').lastInsertRowid;
  proyId = db.prepare("INSERT INTO proyectos (codigo,nombre,cliente_id,modo_cobro,active) VALUES (?,?,?,?,1)").run('GATE-FH', NOMBRE, cliId, 'horas').lastInsertRowid;
  workerId = nuevoEmpleado('Gate FH Worker', [['tiempo', 'read']], 50);   // tarifa 50/h → importes deterministas
  const e1 = nuevaEntrada('Diseño'), e2 = nuevaEntrada('Diseño'), e3 = nuevaEntrada('Reunión');   // 2 se agrupan + 1
  const ventasAntes = ventasBase();

  browser = await puppeteer.launch(launchOpts());

  // ── [1] DUEÑO: facturar horas desde pantalla ─────────────────────────────────
  console.log('\n[1] DUEÑO: facturar horas desde pantalla');
  const po = await paginaDe(owner.id);
  const errs = []; po.on('pageerror', e => errs.push(e.message));
  await po.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const navLink = await po.$eval('a[href="/admin/facturar-horas"]', a => a.textContent.trim()).catch(() => null);
  ok(navLink && /facturar horas/i.test(navLink), 'la entrada "Facturar horas" aparece en el menú', navLink || '(no está)');
  await Promise.all([ po.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), po.evaluate(() => document.querySelector('a[href="/admin/facturar-horas"]').click()) ]);
  ok(po.url().endsWith('/admin/facturar-horas'), 'pulsando la entrada se llega a /admin/facturar-horas', po.url());
  await po.waitForFunction(() => typeof fhCargar === 'function', { timeout: 8000 }).catch(() => {});

  // Elegir el proyecto → salen sus horas facturables (3 entradas, todas con tarifa → 3 checkboxes).
  await po.evaluate((pid) => { document.getElementById('fhProyecto').value = String(pid); fhCargar(); }, proyId);
  await po.waitForFunction(() => document.querySelectorAll('.fhChk').length > 0, { timeout: 8000 }).catch(() => {});
  const nChk = await po.evaluate(() => document.querySelectorAll('.fhChk').length);
  ok(nChk === 3, 'al elegir el proyecto salen sus 3 horas facturables', String(nChk));

  // Vista previa: fijar IVA=21, IRPF=0 → 2 líneas (Diseño 4h=200 + Reunión 2h=100), base 300, total 363.
  await po.evaluate(() => { document.getElementById('fhIva').value = '21'; document.getElementById('fhIrpf').value = '0'; fhRecalc(); });
  const prevTxt = await po.evaluate(() => document.getElementById('fhPreview').textContent);
  const nLineasPrev = await po.evaluate(() => document.querySelectorAll('#fhPreview tbody tr').length);
  ok(nLineasPrev === 2, 'la vista previa agrupa en 2 líneas (Diseño + Reunión)', String(nLineasPrev));
  ok(/300\.00/.test(prevTxt) && /363\.00/.test(prevTxt), 'la previa cuadra: base 300 y total 363 (IVA 21%)', prevTxt.replace(/\s+/g, ' ').slice(0, 120));
  await po.screenshot({ path: join(SHOTS, 'fh-preview.png') }).catch(() => {});

  // Generar la factura REAL → navega a /admin/invoices/<id>.
  await Promise.all([ po.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}), po.click('#fhBtn') ]);
  ok(/\/admin\/invoices\/\d+/.test(po.url()), 'tras generar, lleva a la pantalla de la factura', po.url());
  invoiceId = Number((po.url().match(/\/admin\/invoices\/(\d+)/) || [])[1]);
  ok(invoiceId > 0, 'se creó una factura con id', String(invoiceId));

  // Verificar la factura en BD: emitida, cuadra, 2 líneas.
  const inv = invoiceId ? db.prepare('SELECT subtotal, tax_amount, total, status FROM invoices WHERE id=?').get(invoiceId) : null;
  ok(inv && inv.status === 'emitida', 'la factura nace EMITIDA');
  ok(inv && inv.subtotal === 300 && inv.tax_amount === 63 && inv.total === 363, 'la factura cuadra al céntimo: 300 + 63 IVA = 363', inv && (inv.subtotal + '+' + inv.tax_amount + '=' + inv.total));
  const nItems = invoiceId ? db.prepare('SELECT COUNT(*) n FROM invoice_items WHERE invoice_id=?').get(invoiceId).n : 0;
  ok(nItems === 2, 'la factura tiene 2 líneas', String(nItems));

  // Las entradas quedan enlazadas y salen de la lista de facturables.
  const marcadas = db.prepare('SELECT COUNT(*) n FROM time_entries WHERE proyecto_id=? AND invoice_id=?').get(proyId, invoiceId).n;
  ok(marcadas === 3, 'las 3 entradas quedan enlazadas a la factura');
  await po.goto(BASE + '/admin/facturar-horas', { waitUntil: 'networkidle2' });
  await po.waitForFunction(() => typeof fhCargar === 'function', { timeout: 8000 }).catch(() => {});
  const prev2 = await call(po, 'GET', '/api/erp/facturar-horas/preview?proyecto_id=' + proyId);
  ok(prev2.body && (prev2.body.entradas || []).length === 0, 'ya no quedan horas facturables (todas facturadas)', String((prev2.body?.entradas || []).length));

  // Bloqueo: una entrada facturada no se edita ni elimina (409).
  const editFact = await call(po, 'PUT', '/api/erp/tiempo/' + e1, { proyecto_id: proyId, fecha: HOY, horas: 9, minutos: 0, facturable: true });
  ok(editFact.status === 409, 'editar una entrada facturada → 409', String(editFact.status));
  const delFact = await call(po, 'DELETE', '/api/erp/tiempo/' + e1);
  ok(delFact.status === 409, 'eliminar una entrada facturada → 409', String(delFact.status));
  ok(errs.length === 0, 'la pantalla no lanza errores de JS/CSP', errs.join(' | ') || 'limpio');

  // ── [2] PERMISOS ─────────────────────────────────────────────────────────────
  console.log('\n[2] PERMISOS (candado por invoices.create, no por bypass del dueño)');
  const empNo = nuevoEmpleado('Gate FH SinPerm', [['tiempo', 'read']]);   // sin invoices.create
  const pn = await paginaDe(empNo);
  await pn.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const veNo = await pn.$('a[href="/admin/facturar-horas"]').then(x => !!x).catch(() => false);
  ok(!veNo, 'sin invoices.create: NO ve la entrada "Facturar horas"');
  const r403 = await pn.goto(BASE + '/admin/facturar-horas', { waitUntil: 'networkidle2' });
  ok(r403.status() === 403, 'sin invoices.create: /admin/facturar-horas por URL → 403', String(r403.status()));
  await pn.goto(BASE + '/admin', { waitUntil: 'networkidle2' });   // origen para fetch relativo
  const postNo = await call(pn, 'POST', '/api/erp/facturar-horas', { proyecto_id: proyId, entry_ids: [e1] });
  ok(postNo.status === 403, 'sin invoices.create: emitir por la API → 403', String(postNo.status));

  const empSi = nuevoEmpleado('Gate FH ConPerm', [['invoices', 'create']]);   // con el permiso
  const ps = await paginaDe(empSi);
  const rSi = await ps.goto(BASE + '/admin/facturar-horas', { waitUntil: 'networkidle2' });
  ok(rSi.status() === 200, 'con invoices.create (empleado, no dueño): ve la pantalla → 200', String(rSi.status()));

  await browser.close();

  // ── RESIDUO NETO-CERO: anular la factura y comprobar Ventas intacto ──────────
  console.log('\n[3] RESIDUO NETO-CERO');
  if (invoiceId) anularInvoice(db, invoiceId, 'Gate FH — limpieza de prueba');
  const ventasDespues = ventasBase();
  ok(Math.abs(ventasDespues - ventasAntes) < 0.005, 'Ventas queda EXACTAMENTE igual tras crear+anular (neto-cero)', ventasAntes + ' → ' + ventasDespues);
  const st = db.prepare('SELECT status FROM invoices WHERE id=?').get(invoiceId)?.status;
  ok(st === 'anulada', 'la factura de prueba queda anulada (permanece en la cadena, es inmutable)', st || '?');
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
  try { await browser.close(); } catch {}
} finally {
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  // Las entradas de tiempo se borran (dato de prueba). La factura anulada + su anulación PERMANECEN a
  // propósito (cadena Verifactu inmutable, neto-cero en Ventas); el cliente de prueba queda referenciado
  // por esa factura, así que tampoco se borra.
  try { if (proyId) db.prepare('DELETE FROM time_entries WHERE proyecto_id=?').run(proyId); } catch {}
  for (const id of emps) { try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id); } catch {} try { db.prepare('DELETE FROM admin_users WHERE id=?').run(id); } catch {} }
  try { if (proyId) db.prepare('DELETE FROM proyectos WHERE id=?').run(proyId); } catch {}
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
