// EL VIGÍA · Escalera paso 5 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. El motor ya lo prueba `test-vigia` (33/0) y `verify-vigia` (cuadre real).
// Aquí se prueba lo que esos no pueden: que la pantalla /admin/vigia PINTE la lista de hallazgos, que
// el menú tenga la entrada "Vigía (DISA)", que la página no reviente (0 errores de JS/CSP), y —lo
// importante— que el CANDADO valga por pantalla: un empleado con `analytics.read` pero SIN
// `cobros.read`/`purchases.read` abre el vigía pero NO ve los hallazgos de esas áreas (van al aviso
// "no ves … porque no tienes su permiso"). El desplegable filtrado no es el candado; esto lo demuestra.
//
// NO ESCRIBE datos de negocio: solo crea una sesión y un empleado de prueba y los BORRA al terminar.
//   node scripts/gate-vigia-pantalla.mjs
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
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'vigia-shots');   // snap-chromium NO escribe en /tmp
try { mkdirSync(SHOTS, { recursive: true }); } catch {}
const tokens = [];
let empId = null;
const EMAIL = 'gate-vigia-' + Date.now() + '@test.local';

function sesion(userId) {
  const tok = 'gate-vigia-' + userId + '-' + Date.now();
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok);
  return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };

try {
  const browser = await puppeteer.launch(launchOpts());

  // ── [1] LA PANTALLA PINTA (como el DUEÑO) ─────────────────────────────────────
  console.log('\n[1] LA PANTALLA DEL VIGÍA PINTA (dueño)');
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  await page.setCookie({ name: 'asess', value: sesion(owner.id), domain: HOST, path: '/' });

  const r = await page.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle2' });
  ok(r.status() === 200, '/admin/vigia responde 200', String(r.status()));
  const h2 = await page.$eval('.ph h2', e => e.textContent.trim()).catch(() => null);
  ok(h2 && /Vig[ií]a/i.test(h2), 'la cabecera dice "Vigía"', h2 || '(sin h2)');
  await page.waitForFunction(() => { const m = document.getElementById('vigMeta'); return m && /hallazgo/.test(m.textContent); }, { timeout: 10000 }).catch(() => {});
  const meta = await page.$eval('#vigMeta', e => e.textContent.trim()).catch(() => null);
  ok(meta && /hallazgo/.test(meta), 'la meta anuncia los hallazgos', meta || '(vacío)');
  const filas = await page.$$eval('#vigBody table tbody tr', rs => rs.length).catch(() => 0);
  ok(filas > 0, 'se pintan filas de hallazgos (desarrollo tiene deuda y pagos)', filas + ' filas');
  await page.screenshot({ path: join(SHOTS, 'vigia-owner.png'), fullPage: true }).catch(() => {});

  // El menú (riel) tiene la entrada "Vigía (DISA)" apuntando a /admin/vigia.
  const navLink = await page.$eval('a[href="/admin/vigia"]', a => a.textContent.trim()).catch(() => null);
  ok(navLink && /Vig[ií]a/i.test(navLink), 'el menú tiene la entrada "Vigía (DISA)"', navLink || '(no está)');

  // El JSON de la API trae los mismos hallazgos (número real > 0).
  const apiOwner = await page.evaluate(async () => {
    const res = await fetch('/api/erp/vigia/hallazgos', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
    return { status: res.status, body: await res.json() };
  });
  ok(apiOwner.status === 200 && apiOwner.body.total > 0, 'la API /vigia/hallazgos devuelve hallazgos', 'total=' + (apiOwner.body && apiOwner.body.total));
  ok(errores.length === 0, 'la pantalla no lanza errores de JS/CSP', errores.join(' | ') || 'limpio');

  // ── [2] CANDADO POR PANTALLA (empleado con analytics.read pero SIN cobros/compras) ──
  console.log('\n[2] EL CANDADO VALE POR PANTALLA (empleado sin permiso de área)');
  empId = db.prepare("INSERT INTO admin_users (name, email, password_hash, role, active) VALUES (?,?,?,'employee',1)")
            .run('Gate Vigía', EMAIL, bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
  darPerm(empId, 'analytics', 'read');   // puede ABRIR el vigía
  darPerm(empId, 'clients', 'read');     // ve clientes, pero NO cobros ni compras

  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1400, height: 900 });
  const errores2 = [];
  page2.on('pageerror', e => errores2.push(e.message));
  await page2.setCookie({ name: 'asess', value: sesion(empId), domain: HOST, path: '/' });
  const r2 = await page2.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle2' });
  ok(r2.status() === 200, 'el empleado con analytics.read abre el vigía (200)', String(r2.status()));
  await page2.waitForFunction(() => { const m = document.getElementById('vigMeta'); return m && /hallazgo/.test(m.textContent); }, { timeout: 10000 }).catch(() => {});

  const apiEmp = await page2.evaluate(async () => {
    const res = await fetch('/api/erp/vigia/hallazgos', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
    return { status: res.status, body: await res.json() };
  });
  const sinPerm = new Set((apiEmp.body.sinPermiso || []).map(s => s.key));
  const dets = new Set((apiEmp.body.hallazgos || []).map(h => h.detector));
  ok(sinPerm.has('deuda_vencida') && sinPerm.has('pago_vence_pronto'), 'deuda (cobros) y pago (compras) van a sinPermiso', [...sinPerm].join(','));
  ok(!dets.has('deuda_vencida') && !dets.has('pago_vence_pronto'), 'el empleado NO recibe hallazgos de cobros ni de compras');
  // El aviso de la pantalla nombra lo que no ve (no un hueco mudo).
  const aviso = await page2.$eval('#vigAviso', e => (e.style.display !== 'none' ? e.textContent : '')).catch(() => '');
  ok(/Deuda de cliente vencida/i.test(aviso) && /Pago a proveedor/i.test(aviso), 'el aviso dice qué áreas no ve', aviso ? 'visible' : '(oculto)');

  // Forzar el detector sin permiso por la API → 403 (la puerta de atrás está cerrada).
  const forced = await page2.evaluate(async () => {
    const res = await fetch('/api/erp/vigia/hallazgos?detector=deuda_vencida', { headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
    return res.status;
  });
  ok(forced === 403, 'forzar ?detector=deuda_vencida sin cobros.read → 403', String(forced));
  ok(errores2.length === 0, 'la pantalla del empleado tampoco lanza errores', errores2.join(' | ') || 'limpio');

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
