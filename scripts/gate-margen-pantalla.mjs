// ESCALERA · PASO 2 — MARGEN. Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE Y POR QUÉ. El motor ya lo prueba `verify-margen` (38/0). Aquí se prueba lo que ese no
// puede: que la pantalla PINTE, que el aviso de "sin coste registrado" SALGA (es lo único que evita
// que el dueño lea mal su propio beneficio), que el "—" aparezca donde no hay coste en vez de un 0 o
// un 100, y —lo importante— que el CANDADO valga igual por pantalla y por export: un empleado sin
// `analytics.read` no puede ver el coste ni sacándolo por CSV. Un export sin candado sería la puerta
// de atrás del permiso.
//
// NO ESCRIBE NADA: solo lee la Analítica del tenant de desarrollo. El usuario de prueba se crea y se
// BORRA al terminar (finally), pase lo que pase.
//
//   node scripts/gate-margen-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import bcrypt from 'bcrypt';

// El tenant se resuelve por SUBDOMINIO, así que se le habla por la URL. (No con `Host` en
// setExtraHTTPHeaders: Chromium lo rechaza con ERR_INVALID_ARGUMENT.)
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
let empId = null;
const EMAIL = 'gate-margen-' + Date.now() + '@test.local';

try {
  // Empleado SIN analytics.read, creado a propósito. (Lección de C4a-bis: dar por hecho que un
  // usuario existente no tiene el permiso es cómo un gate deja de probar lo que cree probar.)
  empId = db.prepare("INSERT INTO admin_users (name, email, password_hash, role, active) VALUES (?,?,?,'employee',1)")
            .run('Gate Margen', EMAIL, bcrypt.hashSync('Test1234!', 10)).lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);

  const browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));

  // ── Sesión de OWNER (por la BD, como el resto de gates) ────────────────────
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  const tok = 'gate-margen-' + Date.now();
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, ahora, ahora + 3600, 'csrf-' + tok);
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/' });

  console.log('\n[1] LA PANTALLA PINTA LA RENTABILIDAD');
  const r = await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle2' });
  ok(r.status() === 200, 'Analítica responde 200', String(r.status()));
  await page.waitForSelector('#mgBody tr', { timeout: 10000 }).catch(() => {});
  const ben = await page.$eval('#mBen', e => e.textContent.trim()).catch(() => null);
  const pct = await page.$eval('#mPct', e => e.textContent.trim()).catch(() => null);
  ok(ben && ben !== '-', 'el beneficio se pinta', ben);
  ok(pct && pct !== '-', 'el margen % se pinta', pct);
  ok(errores.length === 0, '0 errores JS', errores.join(' | '));

  console.log('\n[2] EL AVISO DE "SIN COSTE REGISTRADO" — lo que impide leer mal la cifra');
  const avisoVisible = await page.$eval('#mgAviso', e => e.style.display !== 'none' && e.textContent.length > 0).catch(() => false);
  ok(avisoVisible, 'el aviso SALE (este tenant tiene ventas sin coste)');
  const avisoTxt = await page.$eval('#mgAviso', e => e.textContent).catch(() => '');
  ok(/sin coste registrado/i.test(avisoTxt), 'dice "sin coste registrado"');
  ok(/%/.test(avisoTxt), 'dice QUÉ PARTE de las ventas queda fuera');

  console.log('\n[3] LO QUE NO SE SABE SE PINTA "—", NO 0 NI 100%');
  const filas = await page.$$eval('#mgBody tr', trs => trs.map(t => [...t.querySelectorAll('td')].map(d => d.textContent.trim())));
  const sinCoste = filas.filter(f => f[3] && /sin coste/i.test(f[3]));
  ok(sinCoste.length > 0, 'hay filas sin coste en este tenant', sinCoste.length + ' filas');
  ok(sinCoste.every(f => f[5] === '—'), 'todas ellas muestran "—" en Margen, nunca 100%');
  ok(!filas.some(f => f[5] === '100.0%' && /sin coste/i.test(f[3] || '')), 'ninguna línea sin coste declara 100% de margen');

  console.log('\n[4] EL CANDADO — mismo permiso por pantalla Y por export');
  const csv = await page.evaluate(async b => { const r = await fetch(b + '/api/erp/analytics/export/margen'); return { s: r.status, t: (await r.text()).slice(0, 200) }; }, BASE);
  ok(csv.s === 200, 'el owner SÍ puede exportar', String(csv.s));
  ok(/Producto,Unidades,Ingresos_sin_IVA,Coste,Beneficio/.test(csv.t), 'el CSV trae coste y beneficio');
  ok(/TOTAL/.test((await page.evaluate(async b => (await (await fetch(b + '/api/erp/analytics/export/margen')).text()), BASE))), 'el CSV cierra con la fila TOTAL');

  // Ahora el empleado SIN permiso
  const page2 = await browser.newPage();
  const tok2 = 'gate-margen-emp-' + Date.now();
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)')
    .run(tok2, empId, ahora, ahora + 3600, 'csrf-' + tok2);
  await page2.setCookie({ name: 'asess', value: tok2, domain: HOST, path: '/' });
  // Se aterriza en el Inicio (que el empleado SÍ puede ver) y desde ahí se piden las tres puertas por
  // `fetch`. Se mide el ESTADO, que es lo que manda: navegar a una 403 con puppeteer se queda colgado
  // esperando un `domcontentloaded` que nunca llega, y ese timeout no probaría nada.
  await page2.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  const tres = await page2.evaluate(async b => ({
    vista:  (await fetch(b + '/admin/analytics')).status,
    export: (await fetch(b + '/api/erp/analytics/export/margen')).status,
    api:    (await fetch(b + '/api/erp/analytics/margen')).status,
  }), BASE);
  ok(tres.vista === 403, 'el empleado sin permiso NO ve la Analítica (403)', String(tres.vista));
  ok(tres.export === 403, 'y TAMPOCO saca el coste por el export (403)', String(tres.export));
  ok(tres.api === 403, 'ni por el API de margen (403)', String(tres.api));

  await browser.close();
} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN:', e.message);
} finally {
  // Limpieza en el `finally` y POR PREFIJO, no por las variables de esta pasada: si el gate muere a
  // mitad, sus sesiones se quedarían vivas para siempre y la siguiente pasada añadiría dos más.
  // (Es el pecado de `gate-almacenes`, que se envenenaba solo — ya pagado una vez en este repo.)
  db.prepare("DELETE FROM admin_sessions WHERE token LIKE 'gate-margen%'").run();
  if (empId) {
    db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(empId);
    db.prepare('DELETE FROM admin_users WHERE id=?').run(empId);
  }
  db.prepare("DELETE FROM admin_users WHERE email LIKE 'gate-margen-%@test.local'").run();   // por si una pasada anterior murió antes
  db.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} gate-margen-pantalla: ${pass} OK · ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
