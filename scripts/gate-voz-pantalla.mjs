// LA VOZ · Escalera paso 5 · PIEZA 2 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. La lógica ya la prueban test-voz (87/0) y verify-voz (cuadre real 58/58).
// Aquí se prueba lo que esos no pueden: que /admin/vigia PINTE la voz (una tarjeta por aviso, con su
// (a) qué pasa y su (b) decisión propuesta), que el número que se ve == el de la API (misma cifra sin
// copiarla), que NO HAY NINGÚN CONTROL DE ACCIÓN en la voz (ni botón, ni formulario, ni enlace: la voz
// narra, no ejecuta), que la página no revienta (0 errores JS/CSP), y que el CANDADO por pantalla se
// hereda: un empleado sin cobros/compras NO ve avisos de esas áreas y forzarlos por la API da 403.
//
// NO ESCRIBE datos de negocio: solo crea una sesión y un empleado de prueba y los BORRA al terminar.
//   node scripts/gate-voz-pantalla.mjs
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
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'voz-shots');   // snap-chromium NO escribe en /tmp
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [];
let empId = null;
const EMAIL = 'gate-voz-' + Date.now() + '@test.local';

function sesion(userId) {
  const tok = 'gate-voz-' + userId + '-' + Date.now();
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok);
  return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };

try {
  const browser = await puppeteer.launch(launchOpts());

  // ── [1] LA VOZ PINTA (como el DUEÑO) ──────────────────────────────────────────
  console.log('\n[1] LA VOZ PINTA (dueño)');
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.setCookie({ name: 'asess', value: sesion(owner.id), domain: HOST, path: '/' });

  const r = await page.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle2' });
  ok(r.status() === 200, '/admin/vigia responde 200', String(r.status()));

  // La API de la voz: los avisos que deberíamos ver pintados.
  const apiOwner = await page.evaluate(async () => {
    const res = await fetch('/api/erp/vigia/avisos', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
    return { status: res.status, body: await res.json() };
  });
  ok(apiOwner.status === 200 && (apiOwner.body.avisos || []).length > 0, 'la API /vigia/avisos devuelve avisos', 'n=' + (apiOwner.body.avisos || []).length);

  // Se pinta UNA tarjeta por aviso.
  await page.waitForFunction(() => document.querySelectorAll('#vozBody .card').length > 0, { timeout: 10000 }).catch(() => {});
  const tarjetas = await page.$$eval('#vozBody .card', els => els.length).catch(() => 0);
  ok(tarjetas === (apiOwner.body.avisos || []).length, 'se pinta una tarjeta por aviso', tarjetas + ' tarjetas / ' + (apiOwner.body.avisos || []).length + ' avisos');

  // Cada tarjeta lleva su DECISIÓN PROPUESTA (criterio: siempre decide).
  const decisiones = await page.$$eval('#vozBody .card', els => els.filter(e => /Decisión propuesta/i.test(e.textContent)).length).catch(() => 0);
  ok(decisiones === tarjetas && tarjetas > 0, 'cada tarjeta muestra su "Decisión propuesta"', decisiones + '/' + tarjetas);

  // La MISMA cifra sin copiarla: el importe del primer aviso de dinero aparece pintado.
  //
  // ⚙️ CORREGIDO EL 24 AGO 2026. Esta aserción construía lo esperado como `'€' + toFixed(2)` — o sea
  // «€60493.95», el dinero a la inglesa— y desde que el producto lo escribe como en España
  // («60.493,95 €») no lo encontraba. **El fallo era de la comprobación, no de la pantalla**: medía
  // la ORTOGRAFÍA de la cifra en vez de la cifra. Ahora se compara el NÚMERO, quitando el punto de
  // los miles, y se exige además que NO aparezca escrito a la inglesa — así la aserción sirve para
  // las dos cosas y no se puede volver a colar el formato viejo.
  const primerDinero = (apiOwner.body.avisos || []).find(a => a.moneda);
  const vozText = await page.$eval('#vozBody', e => e.innerText).catch(() => '');
  const plano = t => String(t || '').replace(/(\d)\.(?=\d{3}(\D|$))/g, '$1');
  const esperado = primerDinero ? Number(primerDinero.cifra || 0).toFixed(2).replace('.', ',') : null;
  ok(esperado && plano(vozText).includes(esperado), 'el importe del aviso se ve en pantalla, escrito como en España',
     esperado ? esperado + ' €' : '(sin aviso de dinero)');
  ok(!/[€$£] ?-?\d/.test(vozText) && !/-?\d+\.\d{2}\s*[€$£]/.test(vozText),
     '  y NINGÚN importe de esa pantalla sale a la inglesa (símbolo delante o punto decimal)',
     (vozText.match(/[€$£] ?-?\d[\d.,]*/g) || []).slice(0, 3).join(' · ') || 'ninguno');

  // NO EJECUTA: en la voz no hay ni un botón, ni un formulario, ni un enlace de acción.
  const controles = await page.$$eval('#vozBody button, #vozBody form, #vozBody a, #vozBody input, #vozBody [onclick]', els => els.length).catch(() => 0);
  ok(controles === 0, 'la voz NO tiene controles de acción (ni botón/formulario/enlace)', controles + ' controles');

  // El detalle crudo del vigía sigue disponible (dentro del <details>).
  const filasCrudas = await page.$$eval('#vigBody table tbody tr', rs => rs.length).catch(() => 0);
  ok(filasCrudas > 0, 'el detalle crudo del vigía sigue pintándose (para verificar)', filasCrudas + ' filas');

  const navLink = await page.$eval('a[href="/admin/vigia"]', a => a.textContent.trim()).catch(() => null);
  ok(navLink && /Vig[ií]a/i.test(navLink), 'el menú tiene la entrada "Vigía (DISA)"', navLink || '(no está)');
  ok(errores.length === 0, 'la pantalla no lanza errores de JS/CSP', errores.join(' | ') || 'limpio');
  await page.screenshot({ path: join(SHOTS, 'voz-owner.png'), fullPage: true }).catch(() => {});

  // ── [2] EL CANDADO POR PANTALLA SE HEREDA (empleado sin cobros/compras) ────────
  console.log('\n[2] EL CANDADO SE HEREDA (empleado sin permiso de área)');
  empId = db.prepare("INSERT INTO admin_users (name, email, password_hash, role, active) VALUES (?,?,?,'employee',1)")
            .run('Gate Voz', EMAIL, bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
  darPerm(empId, 'analytics', 'read');   // puede ABRIR el vigía/voz
  darPerm(empId, 'clients', 'read');     // ve clientes, pero NO cobros ni compras

  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1400, height: 1000 });
  const errores2 = [];
  page2.on('pageerror', e => errores2.push(e.message));
  await page2.setCookie({ name: 'asess', value: sesion(empId), domain: HOST, path: '/' });
  const r2 = await page2.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle2' });
  ok(r2.status() === 200, 'el empleado con analytics.read abre la voz (200)', String(r2.status()));

  const apiEmp = await page2.evaluate(async () => {
    const res = await fetch('/api/erp/vigia/avisos', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
    return { status: res.status, body: await res.json() };
  });
  const dets = new Set((apiEmp.body.avisos || []).map(a => a.detector));
  ok(!dets.has('deuda_vencida') && !dets.has('pago_vence_pronto'), 'el empleado NO recibe avisos de cobros ni de compras');
  const sinPerm = new Set((apiEmp.body.sinPermiso || []).map(s => s.key));
  ok(sinPerm.has('deuda_vencida') && sinPerm.has('pago_vence_pronto'), 'cobros y compras figuran en sinPermiso', [...sinPerm].join(','));

  await page2.waitForFunction(() => { const m = document.getElementById('vigMeta'); return m && /hallazgo/.test(m.textContent); }, { timeout: 10000 }).catch(() => {});
  const vozEmp = await page2.$eval('#vozBody', e => e.innerText).catch(() => '');
  ok(!/reclamar el cobro/i.test(vozEmp) && !/pago a proveedor/i.test(vozEmp), 'en la voz del empleado NO aparece ningún aviso de cobros/compras');
  const aviso = await page2.$eval('#vigAviso', e => (e.style.display !== 'none' ? e.textContent : '')).catch(() => '');
  ok(/Deuda de cliente vencida/i.test(aviso) && /Pago a proveedor/i.test(aviso), 'el aviso dice qué áreas no ve (no un hueco mudo)', aviso ? 'visible' : '(oculto)');

  // Forzar el detector sin permiso por la API de la voz → 403 (la puerta de atrás está cerrada).
  const forced = await page2.evaluate(async () => {
    const res = await fetch('/api/erp/vigia/avisos?detector=deuda_vencida', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
    return res.status;
  });
  ok(forced === 403, 'forzar ?detector=deuda_vencida sin cobros.read → 403', String(forced));
  ok(errores2.length === 0, 'la pantalla del empleado tampoco lanza errores', errores2.join(' | ') || 'limpio');
  await page2.screenshot({ path: join(SHOTS, 'voz-empleado.png'), fullPage: true }).catch(() => {});

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
