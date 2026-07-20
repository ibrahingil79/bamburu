// INICIO PERSONALIZABLE · Escalera paso 6 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE. La lógica ya la prueba test-inicio (22/0). Aquí, con datos REALES de desarrollo y contra el
// servidor, los 8 criterios: (1) usuario nuevo ve el Inicio de fábrica montado; (2) el dueño fija el
// default de EMPRESA y un empleado sin capa lo ve; (3) el empleado retoca y ve SU versión; (4) reset en
// los dos niveles; (5) un panel del constructor se coloca, se redimensiona y PERSISTE; (6) permisos: un
// empleado sin un área no ve sus paneles (paleta/pintado/Inicio) y da 403 al forzar; el bloque del
// default del dueño se le omite; (7) el gráfico del panel CUADRA con el constructor (mismo motor).
//
// NO ESCRIBE datos de negocio: siembra 2 paneles + 1 empleado + layouts de prueba y los BORRA al salir.
//   node scripts/gate-inicio-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import bcrypt from 'bcrypt';

const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'inicio-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [];
let empId = null, panelVentas = null, panelCompras = null;
const EMAIL = 'gate-inicio-' + Date.now() + '@test.local';
const RECETA_VENTAS = { area: 'ventas', dimension: 'fecha', medidas: ['base'], periodo: 'mes', grafico: 'lineas' };

function sesion(userId) {
  const tok = 'gate-inicio-' + userId + '-' + Date.now() + '-' + Math.floor(performance.now());
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
// llamadas a la API desde la sesión de la página (contrato real, con cookie de sesión)
const call = (page, method, url, body) => page.evaluate(async (m, u, b) => {
  const opts = { method: m, cache: 'no-store', headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } };
  if (b) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(b); }
  const r = await fetch(u, opts); let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}, method, url, body);

try {
  // Contextos separados: en un mismo contexto Puppeteer comparte el frasco de cookies entre páginas, así
  // que la sesión del empleado pisaría la del dueño (misma cookie `asess`, mismo dominio). Un contexto por
  // rol aísla las cookies y cada página conserva SU sesión.
  const crearCtx = () => (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());

  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  // Siembra: 2 paneles compartidos del dueño (uno de Ventas, uno de Compras) + un empleado sin Compras.
  panelVentas = db.prepare("INSERT INTO analytics_panels (user_id, nombre, config, compartido) VALUES (?,?,?,1)")
    .run(owner.id, 'GATE Ventas por mes', JSON.stringify(RECETA_VENTAS)).lastInsertRowid;
  panelCompras = db.prepare("INSERT INTO analytics_panels (user_id, nombre, config, compartido) VALUES (?,?,?,1)")
    .run(owner.id, 'GATE Compras pendiente', JSON.stringify({ area: 'compras', dimension: 'proveedor', medidas: ['pendiente'], grafico: 'barras' })).lastInsertRowid;
  empId = db.prepare("INSERT INTO admin_users (name, email, password_hash, role, active) VALUES (?,?,?,'employee',1)").run('Gate Inicio', EMAIL, bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
  for (const [m, a] of [['analytics', 'read'], ['invoices', 'read'], ['clients', 'read']]) darPerm(empId, m, a);   // NO purchases.read

  const browser = await puppeteer.launch(launchOpts());

  // ── [1] EL DUEÑO: FÁBRICA MONTADA + COLOCAR/REDIMENSIONAR UN PANEL + CUADRE ────
  console.log('\n[1] DUEÑO: fábrica montada, colocar panel, redimensionar, cuadre');
  const ctxO = await crearCtx();
  const po = await ctxO.newPage();
  await po.setViewport({ width: 1400, height: 1100 });
  const eo = []; po.on('pageerror', e => eo.push(e.message));
  await po.setCookie({ name: 'asess', value: sesion(owner.id), domain: HOST, path: '/' });
  await po.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await po.waitForFunction(() => document.querySelectorAll('#inicioGrid .ig-block').length > 0, { timeout: 10000 }).catch(() => {});
  const fab = await call(po, 'GET', '/api/erp/inicio/layout');
  ok(fab.body && fab.body.origen === 'fabrica' && (fab.body.blocks || []).length > 0, 'usuario nuevo ve el Inicio de FÁBRICA montado (no en blanco)', 'origen=' + (fab.body && fab.body.origen));
  const bloquesDom = await po.$$eval('#inicioGrid .ig-block', els => els.length).catch(() => 0);
  ok(bloquesDom >= 2, 'la rejilla pinta los bloques de fábrica', bloquesDom + ' bloques');

  // Coloca el panel de Ventas (w2,h2) + kpis, guarda por la API, recarga.
  await call(po, 'PUT', '/api/erp/inicio/layout', { blocks: [{ tipo: 'panel', refId: panelVentas, w: 2, h: 2 }, { tipo: 'kpis', w: 4, h: 1 }] });
  await po.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await po.waitForFunction(() => { const c = document.querySelector('#inicioGrid .ig-block canvas'); return c && window.Chart && Chart.getChart(c); }, { timeout: 12000 }).catch(() => {});
  const persistePanel = await po.evaluate(() => { const c = document.querySelector('#inicioGrid .ig-block canvas'); return !!(c && window.Chart && Chart.getChart(c)); });
  ok(persistePanel, 'el panel colocado PERSISTE al recargar y pinta su gráfico');

  // Cuadre al céntimo: lo pintado == /constructor/cruzar de la MISMA receta.
  const cuadre = await po.evaluate(async (receta) => {
    const canvas = document.querySelector('#inicioGrid .ig-block canvas');
    const inst = canvas && window.Chart && Chart.getChart(canvas);
    if (!inst) return { noInst: true };
    const r = await fetch('/api/erp/analytics/constructor/cruzar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN || '' }, body: JSON.stringify(receta) });
    const d = await r.json();
    return { esperado: d.filas.map(f => f.base), pintado: inst.data.datasets[0].data };
  }, RECETA_VENTAS);
  ok(cuadre && cuadre.esperado && JSON.stringify(cuadre.esperado) === JSON.stringify(cuadre.pintado), 'el gráfico del panel CUADRA al céntimo con el constructor (mismo motor)');

  // Redimensiona (w4) por la API, recarga → persiste el tamaño.
  await call(po, 'PUT', '/api/erp/inicio/layout', { blocks: [{ tipo: 'panel', refId: panelVentas, w: 4, h: 2 }, { tipo: 'kpis', w: 4, h: 1 }] });
  await po.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await po.waitForFunction(() => document.querySelector('#inicioGrid .ig-block'), { timeout: 10000 }).catch(() => {});
  const size = await po.$eval('#inicioGrid .ig-block', el => el.className).catch(() => '');
  ok(/\bw4\b/.test(size), 'el panel redimensionado a ancho 4 persiste al recargar', size);
  ok(eo.length === 0, 'el Inicio del dueño no lanza errores de JS/CSP', eo.join(' | ') || 'limpio');
  await po.screenshot({ path: join(SHOTS, 'inicio-duenyo.png') }).catch(() => {});

  // Reset del usuario → vuelve a fábrica.
  await call(po, 'DELETE', '/api/erp/inicio/layout');
  const trasReset = await call(po, 'GET', '/api/erp/inicio/layout');
  ok(trasReset.body && trasReset.body.origen === 'fabrica', 'reset del usuario (dueño) → vuelve al de fábrica');

  // ── [2] EL DUEÑO FIJA EL DEFAULT DE EMPRESA (con un panel de Compras dentro) ───
  console.log('\n[2] DUEÑO fija el default de EMPRESA');
  const putEmpresa = await call(po, 'PUT', '/api/erp/inicio/empresa', { blocks: [{ tipo: 'kpis', w: 4, h: 1 }, { tipo: 'panel', refId: panelCompras, w: 2, h: 2 }, { tipo: 'vigia', w: 2, h: 2 }] });
  ok(putEmpresa.status === 200, 'el dueño guarda el Inicio de empresa (200)', String(putEmpresa.status));

  // ── [3][6] EL EMPLEADO SIN COMPRAS ────────────────────────────────────────────
  console.log('\n[3][6] EMPLEADO sin purchases.read: ve el default de empresa, pero el panel de Compras se OMITE');
  const ctxE = await crearCtx();
  const pe = await ctxE.newPage();
  await pe.setViewport({ width: 1400, height: 1100 });
  const ee = []; pe.on('pageerror', e => ee.push(e.message));
  await pe.setCookie({ name: 'asess', value: sesion(empId), domain: HOST, path: '/' });
  await pe.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await pe.waitForFunction(() => document.querySelectorAll('#inicioGrid .ig-block').length > 0, { timeout: 10000 }).catch(() => {});
  const empLayout = await call(pe, 'GET', '/api/erp/inicio/layout');
  const tipos = (empLayout.body.blocks || []).map(b => b.tipo + (b.refId ? ':' + b.refId : ''));
  ok(empLayout.body.origen === 'empresa', 'el empleado sin capa ve el default de EMPRESA', 'origen=' + empLayout.body.origen);
  ok(tipos.indexOf('kpis') >= 0 && tipos.indexOf('vigia') >= 0, 've los bloques del default que SÍ puede (kpis, vigía)');
  ok(tipos.indexOf('panel:' + panelCompras) < 0, 'el panel de Compras del default del dueño se le OMITE (no se le cuela)');
  // Paleta: sin el panel de Compras; forzar por la API → 403.
  const pal = await call(pe, 'GET', '/api/erp/inicio/bloques');
  const refs = (pal.body.paneles || []).map(p => p.refId);
  ok(refs.indexOf(panelVentas) >= 0 && refs.indexOf(panelCompras) < 0, 'la paleta ofrece el panel de Ventas pero NO el de Compras');
  const forzarPanel = await call(pe, 'PUT', '/api/erp/inicio/layout', { blocks: [{ tipo: 'panel', refId: panelCompras, w: 2, h: 2 }] });
  ok(forzarPanel.status === 403, 'forzar por la API colocar el panel de Compras → 403', String(forzarPanel.status));
  const forzarCruzar = await call(pe, 'POST', '/api/erp/analytics/constructor/cruzar', { area: 'compras', dimension: 'proveedor', medidas: ['pendiente'] });
  ok(forzarCruzar.status === 403, 'forzar el cruce del área Compras por detrás → 403', String(forzarCruzar.status));
  const forzarEmpresa = await call(pe, 'PUT', '/api/erp/inicio/empresa', { blocks: [{ tipo: 'kpis', w: 4, h: 1 }] });
  ok(forzarEmpresa.status === 403, 'un empleado NO puede editar el Inicio de empresa (403)', String(forzarEmpresa.status));

  // El empleado retoca su Inicio → ve SU versión.
  await call(pe, 'PUT', '/api/erp/inicio/layout', { blocks: [{ tipo: 'avisos', w: 4, h: 1 }] });
  const empProp = await call(pe, 'GET', '/api/erp/inicio/layout');
  ok(empProp.body.origen === 'usuario' && (empProp.body.blocks || []).length === 1 && empProp.body.blocks[0].tipo === 'avisos', 'el empleado retoca y ve SU versión (no la del dueño)');
  ok(ee.length === 0, 'el Inicio del empleado no lanza errores', ee.join(' | ') || 'limpio');
  await pe.screenshot({ path: join(SHOTS, 'inicio-empleado.png') }).catch(() => {});

  // ── [4] RESETS ────────────────────────────────────────────────────────────────
  console.log('\n[4] RESET en los dos niveles');
  await call(pe, 'DELETE', '/api/erp/inicio/layout');
  const empTrasReset = await call(pe, 'GET', '/api/erp/inicio/layout');
  ok(empTrasReset.body.origen === 'empresa', 'reset del empleado → vuelve al default de empresa');
  const delEmpresa = await call(po, 'DELETE', '/api/erp/inicio/empresa');
  const empTrasResetEmpresa = await call(pe, 'GET', '/api/erp/inicio/layout');
  ok(empTrasResetEmpresa.body.origen === 'fabrica', 'reset del dueño (empresa) → todos vuelven al de fábrica',
     'DELETE→' + delEmpresa.status + ' · origen→' + (empTrasResetEmpresa.body && empTrasResetEmpresa.body.origen));

  await browser.close();
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
} finally {
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  // Limpieza total de lo sembrado (no dejar residuo en desarrollo).
  try { db.prepare("DELETE FROM dashboard_layouts WHERE scope IN ('empresa','usuario:' || ?)").run(String(empId)); } catch {}
  try { const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get(); db.prepare("DELETE FROM dashboard_layouts WHERE scope='usuario:' || ?").run(String(owner.id)); } catch {}
  for (const pid of [panelVentas, panelCompras]) { if (pid) try { db.prepare('DELETE FROM analytics_panels WHERE id=?').run(pid); } catch {} }
  if (empId) { try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId); } catch {} try { db.prepare('DELETE FROM admin_users WHERE id=?').run(empId); } catch {} }
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
