// EL DIBUJO · Escalera paso 5 · PIEZA 3 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. La lógica ya la prueban test-dibujo (32/0) y verify-dibujo (cuadre real 58/58).
// Aquí se prueba lo que esos no pueden: que bajo cada aviso se PINTE un gráfico con el MISMO motor del
// constructor (Chart.js del mismo vendor + /constructor/cruzar), que lo pintado sea la MISMA cifra que
// devuelve el constructor (no una copia recalculada), que NO haya un segundo motor de dibujo, y que el
// CANDADO se herede: un empleado que ve un aviso pero no el área de su gráfico recibe una nota honesta
// ("no puedes ver este gráfico"), no un gráfico inventado ni un error.
//
// NO ESCRIBE datos de negocio: crea una sesión y un empleado de prueba y los BORRA al terminar.
//   node scripts/gate-dibujo-pantalla.mjs
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
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'dibujo-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [];
let empId = null;
const EMAIL = 'gate-dibujo-' + Date.now() + '@test.local';

function sesion(userId) {
  const tok = 'gate-dibujo-' + userId + '-' + Date.now();
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok);
  return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };

try {
  const browser = await puppeteer.launch(launchOpts());

  // ── [1] EL GRÁFICO SE PINTA CON EL MOTOR DEL CONSTRUCTOR (dueño) ───────────────
  console.log('\n[1] EL GRÁFICO SE PINTA CON EL MOTOR DEL CONSTRUCTOR (dueño)');
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.setCookie({ name: 'asess', value: sesion(owner.id), domain: HOST, path: '/' });
  const r = await page.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle2' });
  ok(r.status() === 200, '/admin/vigia responde 200', String(r.status()));

  // El MISMO motor: Chart.js (del vendor del constructor) y el render compartido, cargados.
  const libs = await page.evaluate(() => ({ chart: typeof window.Chart, gc: typeof window.GraficoConstructor }));
  ok(libs.chart === 'function', 'Chart.js (el del constructor) está cargado', 'typeof Chart=' + libs.chart);
  ok(libs.gc === 'object', 'el render compartido GraficoConstructor está cargado');

  // Se dibuja al menos el primer gráfico (el observer lo pinta al estar en pantalla).
  await page.waitForFunction(() => {
    const c = document.querySelector('#vozBody .voz-graf canvas');
    return c && window.Chart && Chart.getChart && Chart.getChart(c);
  }, { timeout: 12000 }).catch(() => {});
  const primerChart = await page.evaluate(() => {
    const c = document.querySelector('#vozBody .voz-graf canvas');
    const inst = c && window.Chart && Chart.getChart(c);
    return { hay: !!inst, tipo: inst && inst.config.type };
  });
  ok(primerChart.hay, 'el primer aviso tiene un gráfico dibujado por Chart.js (mismo motor)', 'tipo=' + primerChart.tipo);

  // CUADRE en pantalla: lo pintado == lo que devuelve /constructor/cruzar para la MISMA receta.
  const cuadre = await page.evaluate(async () => {
    const avisos = window.__avisos || [];
    const i = avisos.findIndex(a => a.grafico && a.grafico.receta);
    if (i < 0) return { skip: true };
    const a = avisos[i];
    const inst = Chart.getChart(document.getElementById('vg' + i));
    if (!inst) return { noInst: true };
    const res = await fetch('/api/erp/analytics/constructor/cruzar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN || '' }, body: JSON.stringify(a.grafico.receta) });
    const d = await res.json();
    const esperado = d.filas.map(f => f[a.grafico.medida]);
    const pintado = inst.data.datasets[0].data;
    return { detector: a.detector, esperado, pintado };
  });
  ok(cuadre && cuadre.esperado && JSON.stringify(cuadre.esperado) === JSON.stringify(cuadre.pintado),
     'lo pintado == lo que devuelve el constructor para la misma receta (MISMA cifra)', cuadre && cuadre.detector);

  // Un solo motor de dibujo: Chart.js. No hay un segundo (D3, Highcharts, un SVG a mano…).
  const otrosMotores = await page.evaluate(() => ['d3', 'Highcharts', 'ApexCharts', 'Plotly', 'echarts'].filter(n => typeof window[n] !== 'undefined'));
  ok(otrosMotores.length === 0, 'no hay un segundo motor de gráficos cargado (solo Chart.js)', otrosMotores.join(',') || 'solo Chart.js');

  const explica = await page.$$eval('#vozBody .voz-graf', els => els.filter(e => e.textContent.trim().length > 10).length).catch(() => 0);
  ok(explica > 0, 'cada gráfico lleva su explicación de qué muestra', explica + ' con texto');
  ok(errores.length === 0, 'la pantalla no lanza errores de JS/CSP', errores.join(' | ') || 'limpio');
  await page.screenshot({ path: join(SHOTS, 'dibujo-owner.png'), fullPage: false }).catch(() => {});

  // ── [2] EL CANDADO SE HEREDA (empleado ve el aviso, no el gráfico de su área) ──
  console.log('\n[2] EL CANDADO SE HEREDA (empleado ve el aviso pero no el área del gráfico)');
  empId = db.prepare("INSERT INTO admin_users (name, email, password_hash, role, active) VALUES (?,?,?,'employee',1)")
            .run('Gate Dibujo', EMAIL, bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
  darPerm(empId, 'analytics', 'read');   // abre la voz
  darPerm(empId, 'cobros', 'read');      // VE los avisos de deuda… pero su gráfico usa Ventas (invoices), que NO tiene

  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1400, height: 1000 });
  const errores2 = [];
  page2.on('pageerror', e => errores2.push(e.message));
  await page2.setCookie({ name: 'asess', value: sesion(empId), domain: HOST, path: '/' });
  const r2 = await page2.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle2' });
  ok(r2.status() === 200, 'el empleado abre la voz (200)', String(r2.status()));

  // Ve avisos de deuda (cobros.read) …
  const veAvisos = await page2.evaluate(() => (window.__avisos || []).some(a => a.detector === 'deuda_vencida'));
  ok(veAvisos, 'el empleado (cobros.read) SÍ ve los avisos de deuda');

  // … pero su gráfico (área Ventas) le da 403 → nota honesta, NO un gráfico.
  await page2.waitForFunction(() => {
    const n = document.querySelector('#vozBody .voz-graf-nota');
    return n && n.style.display !== 'none' && /permiso/i.test(n.textContent);
  }, { timeout: 12000 }).catch(() => {});
  const nota = await page2.evaluate(() => {
    const n = document.querySelector('#vozBody .voz-graf-nota');
    const c = document.querySelector('#vozBody .voz-graf canvas');
    return { texto: n ? n.textContent : '', notaVisible: n ? n.style.display !== 'none' : false, hayChart: !!(window.Chart && c && Chart.getChart(c)) };
  });
  ok(nota.notaVisible && /permiso/i.test(nota.texto), 'el gráfico muestra una nota de permiso heredado (no un gráfico inventado)', nota.texto);
  ok(!nota.hayChart, 'NO se dibuja ningún gráfico del área que el empleado no puede ver');
  ok(errores2.length === 0, 'la pantalla del empleado tampoco lanza errores', errores2.join(' | ') || 'limpio');
  await page2.screenshot({ path: join(SHOTS, 'dibujo-empleado.png'), fullPage: false }).catch(() => {});

  await browser.close();
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
} finally {
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  if (empId) { try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId); } catch {} try { db.prepare('DELETE FROM admin_users WHERE id=?').run(empId); } catch {} }
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
