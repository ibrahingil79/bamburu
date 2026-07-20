// DÓNDE TE ESPERA · Escalera paso 5 · PIEZA 5 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. La lógica del orden ya la prueba test-prioridad (13/0). Aquí:
//   [1] ORDEN: /admin/vigia sale ordenada por prioridad (Alta → Media → Baja), con cabeceras de grupo
//       y una píldora por aviso; el más importante arriba.
//   [2] INICIO: al entrar, el bloque "Vigía de DISA" asoma con los avisos top, cada uno con su
//       prioridad, y enlaza a /admin/vigia; lo que asoma COINCIDE con los primeros de la lista completa.
//   [3] BARRIDO DE PERMISOS (un solo pase, los CUATRO puntos): un empleado sin `purchases.read` NO ve
//       los avisos de pago (área Compras) en NINGÚN punto —lista cruda, texto de la voz, gráfico, y
//       bloque de Inicio— y da 403 al forzar por detrás (/avisos?detector=pago y /cruzar area=compras).
//
// NO ESCRIBE datos de negocio: crea una sesión y un empleado de prueba y los BORRA al terminar.
//   node scripts/gate-espera-pantalla.mjs
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
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'espera-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [];
let empId = null;
const EMAIL = 'gate-espera-' + Date.now() + '@test.local';
function sesion(userId) {
  const tok = 'gate-espera-' + userId + '-' + Date.now();
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
const avisosApi = page => page.evaluate(async () => {
  const r = await fetch('/api/erp/vigia/avisos', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
  return { status: r.status, body: await r.json().catch(() => null) };
});

try {
  const browser = await puppeteer.launch(launchOpts());

  // ── [1] ORDEN en /admin/vigia (dueño) ─────────────────────────────────────────
  console.log('\n[1] LA LISTA SALE ORDENADA POR PRIORIDAD (dueño)');
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errores = []; page.on('pageerror', e => errores.push(e.message));
  await page.setCookie({ name: 'asess', value: sesion(owner.id), domain: HOST, path: '/' });
  const r = await page.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle2' });
  ok(r.status() === 200, '/admin/vigia responde 200', String(r.status()));
  await page.waitForFunction(() => (window.__avisos || []).length > 0, { timeout: 10000 }).catch(() => {});

  const orden = await page.evaluate(() => {
    const a = window.__avisos || [];
    const ranks = a.map(x => x.prioridad && x.prioridad.rank);
    const noDecrece = ranks.every((v, i) => i === 0 || ranks[i - 1] <= v);
    // dentro de cada grupo, los que tienen € deben ir de mayor a menor
    let dentroOk = true;
    for (const g of ['alta', 'media', 'baja']) {
      const euros = a.filter(x => x.prioridad && x.prioridad.grupo === g && x.moneda).map(x => Number(x.cifra));
      if (!euros.every((v, i) => i === 0 || euros[i - 1] >= v)) dentroOk = false;
    }
    return { n: a.length, primero: a[0] && a[0].prioridad && a[0].prioridad.grupo, noDecrece, dentroOk,
             cabeceras: Array.from(document.querySelectorAll('#vozBody')).length ? document.querySelectorAll('#vozBody div').length : 0 };
  });
  ok(orden.noDecrece, 'los grupos no decrecen a lo largo de la lista (Alta → Media → Baja)');
  ok(orden.primero === 'alta', 'el primer aviso es de prioridad ALTA', orden.primero);
  ok(orden.dentroOk, 'dentro de cada grupo, los importes en € van de mayor a menor');
  const cabeceras = await page.evaluate(() => Array.from(document.querySelectorAll('#vozBody')).map(b => b.innerText).join('').match(/Prioridad (alta|media|baja)/gi) || []);
  ok(cabeceras.length > 0, 'hay cabeceras de grupo de prioridad en la lista', cabeceras.join(', '));
  const pills = await page.$$eval('#vozBody .card', els => els.filter(e => /Alta|Media|Baja/.test(e.textContent)).length).catch(() => 0);
  ok(pills > 0, 'cada aviso muestra su píldora de prioridad', pills + ' con píldora');
  ok(errores.length === 0, 'la lista no lanza errores de JS/CSP', errores.join(' | ') || 'limpio');
  await page.screenshot({ path: join(SHOTS, 'espera-lista.png') }).catch(() => {});

  // ── [2] EL INICIO ASOMA LOS AVISOS TOP (dueño) ────────────────────────────────
  console.log('\n[2] LOS AVISOS TOP ASOMAN EN EL INICIO Y COINCIDEN CON LA LISTA (dueño)');
  const home = await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  ok(home.status() === 200, '/admin (Inicio) responde 200', String(home.status()));
  await page.waitForFunction(() => { const b = document.getElementById('dhVigia'); return b && b.style.display !== 'none' && b.querySelector('.dh-vigia-row'); }, { timeout: 10000 }).catch(() => {});
  const inicio = await page.evaluate(async () => {
    const box = document.getElementById('dhVigia');
    const filas = box ? Array.from(box.querySelectorAll('.dh-vigia-row .dh-vigia-tx')).map(e => e.textContent) : [];
    const link = box ? box.querySelector('.dh-vigia-more') : null;
    // coincidencia: el top de la API == los primeros de la lista completa
    const top = await (await fetch('/api/erp/vigia/avisos?top=5', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } })).json();
    const full = await (await fetch('/api/erp/vigia/avisos', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } })).json();
    const topEnc = (top.avisos || []).map(a => a.encabezado);
    const fullEnc = (full.avisos || []).slice(0, topEnc.length).map(a => a.encabezado);
    return { visible: box ? box.style.display !== 'none' : false, filas, link: link ? link.getAttribute('href') : null,
             coincideConLista: JSON.stringify(topEnc) === JSON.stringify(fullEnc),
             coincideDom: JSON.stringify(filas) === JSON.stringify(topEnc) };
  });
  ok(inicio.visible && inicio.filas.length > 0, 'el bloque "Vigía de DISA" asoma con avisos', inicio.filas.length + ' filas');
  ok(inicio.link === '/admin/vigia', 'el bloque enlaza a la lista completa (/admin/vigia)', inicio.link);
  ok(inicio.coincideConLista, 'los avisos que asoman son los primeros de la lista (mismo orden, misma fuente)');
  ok(inicio.coincideDom, 'lo pintado en el Inicio coincide con lo que devuelve la API top');
  await page.screenshot({ path: join(SHOTS, 'espera-inicio.png') }).catch(() => {});

  // ── [3] BARRIDO DE PERMISOS — un solo pase, los CUATRO puntos (empleado sin purchases.read) ──
  console.log('\n[3] BARRIDO DE PERMISOS: sin purchases.read, el PAGO no aparece por ningún lado');
  empId = db.prepare("INSERT INTO admin_users (name, email, password_hash, role, active) VALUES (?,?,?,'employee',1)")
            .run('Gate Espera', EMAIL, bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
  for (const [m, a] of [['analytics', 'read'], ['cobros', 'read'], ['invoices', 'read'], ['clients', 'read']]) darPerm(empId, m, a);
  // (a propósito NO se da purchases.read → el área Compras / los pagos quedan fuera)

  const pe = await browser.newPage();
  await pe.setViewport({ width: 1400, height: 1000 });
  const err2 = []; pe.on('pageerror', e => err2.push(e.message));
  await pe.setCookie({ name: 'asess', value: sesion(empId), domain: HOST, path: '/' });

  // Punto 1 y 2 (lista cruda + texto de la voz) en /admin/vigia
  await pe.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle2' });
  await pe.waitForFunction(() => (window.__avisos || []).length >= 0 && document.getElementById('vigMeta'), { timeout: 10000 }).catch(() => {});
  const emp = await avisosApi(pe);
  const dets = new Set((emp.body.avisos || []).map(a => a.detector));
  ok(!dets.has('pago_vence_pronto'), '(voz) el empleado NO recibe avisos de pago (Compras)');
  ok(dets.has('deuda_vencida'), '(voz) sí recibe los de deuda (Cobros) — control positivo');
  const vozTxt = await pe.$eval('#vozBody', e => e.innerText).catch(() => '');
  ok(!/pago a proveedor/i.test(vozTxt), '(voz) el texto de la voz no menciona ningún pago a proveedor');
  const tablaTxt = await pe.$eval('#vigBody', e => e.innerText).catch(() => '');
  ok(!/Pago a proveedor que vence/i.test(tablaTxt), '(lista cruda) la tabla del vigía no lista pagos');
  // Punto 3 (gráfico): no hay gráfico de Compras; y forzar cruzar area=compras da 403.
  const cruzarCompras = await pe.evaluate(async () => {
    const r = await fetch('/api/erp/analytics/constructor/cruzar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN || '' }, body: JSON.stringify({ area: 'compras', dimension: 'proveedor', medidas: ['pendiente'] }) });
    return r.status;
  });
  ok(cruzarCompras === 403, '(gráfico) forzar el cruce del área Compras por detrás → 403', String(cruzarCompras));
  // Forzar el detector de pago por la API de avisos → 403.
  const forceDet = await pe.evaluate(async () => (await fetch('/api/erp/vigia/avisos?detector=pago_vence_pronto', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } })).status);
  ok(forceDet === 403, '(lista/voz/inicio) forzar ?detector=pago_vence_pronto → 403', String(forceDet));

  // Punto 4 (Inicio): el bloque no muestra ningún pago.
  await pe.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await pe.waitForFunction(() => { const b = document.getElementById('dhVigia'); return b && (b.style.display !== 'none' || b.innerHTML === ''); }, { timeout: 10000 }).catch(() => {});
  const inicioEmp = await pe.evaluate(() => { const b = document.getElementById('dhVigia'); return b ? b.innerText : ''; });
  ok(!/pago a proveedor/i.test(inicioEmp), '(Inicio) el bloque del Inicio del empleado no asoma ningún pago');
  ok(err2.length === 0, 'ninguna pantalla del empleado lanza errores', err2.join(' | ') || 'limpio');
  await pe.screenshot({ path: join(SHOTS, 'espera-empleado.png') }).catch(() => {});

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
