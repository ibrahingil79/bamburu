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
import { mkdirSync, unlinkSync, existsSync } from 'fs';
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

  // El menú (riel) tiene la entrada "Vigía (DISA)" apuntando a /admin/vigia.
  const navLink = await page.$eval('a[href="/admin/vigia"]', a => a.textContent.trim()).catch(() => null);
  ok(navLink && /Vig[ií]a/i.test(navLink), 'el menú tiene la entrada "Vigía (DISA)"', navLink || '(no está)');

  // LA CAPTURA, LA ÚLTIMA. 24 ago 2026: estaba ANTES de leer el menú, y en el barrido este gate se caía
  // con «el menú no está» y «Attempted to use detached Frame» — pero a solas daba 13/13. La pantalla del
  // vigía trae 304 filas: una captura `fullPage` de eso es enorme, y bajo la carga del barrido tarda lo
  // bastante como para dejar el marco colgado. Lo que se rompía no era el producto, era todo lo que
  // venía detrás de la foto. La foto sigue haciéndose —hay que MIRARLA—, pero ya no puede tumbar una
  // aserción: va cuando no queda nada que medir en esta página.
  // Y SI LA FOTO FALLA, QUE SE SEPA. El `.catch(() => {})` de antes se tragaba el error en silencio:
  // el gate decía verde y dejaba en disco la captura de la pasada ANTERIOR, que es peor que no dejar
  // ninguna — se mira una pantalla vieja creyendo que es la de ahora. No tumba el gate (la foto es
  // para mirarla, no una aserción), pero lo dice y borra la caducada.
  // Y CHROMIUM NO PUEDE CON LA PÁGINA ENTERA. Con 304 hallazgos, `fullPage: true` devuelve «Unable to
  // capture screenshot»: la imagen es demasiado alta. O sea que este gate llevaba tiempo dejando en disco
  // la captura de una pasada ANTERIOR y nadie lo sabía, porque el `.catch(() => {})` se lo tragaba. Peor
  // que no tener foto: se mira una pantalla vieja creyendo que es la de ahora. Se intenta entera y, si no
  // cabe, se guarda lo que se ve en la ventana — que es justo lo que un cliente tiene delante.
  // ── EL GRÁFICO DE APOYO SE DIBUJA DE VERDAD ─────────────────────────────────────────────────────
  // La pantalla promete, con estas palabras, que «cada aviso trae un gráfico de apoyo dibujado por tu
  // propio constructor». Hasta hoy no lo comprobaba nadie: 13 aserciones en verde y la captura enseñaba
  // un hueco blanco donde va el dibujo. No estaba roto —los gráficos son PEREZOSOS, se dibujan al
  // hacerse visibles— pero la foto se tomaba antes de que les diera tiempo, así que la única prueba que
  // un humano iba a mirar enseñaba una pantalla a medio hacer.
  //
  // Se mide por PÍXELES, no por que el <canvas> exista: un canvas vacío también está en el DOM y también
  // tiene tamaño. Y se exige que los VISIBLES estén pintados, no todos: los 300 de abajo no deben
  // dibujarse hasta que se llegue a ellos, que es justo lo que hace que la pantalla no se arrastre.
  const dibujados = await page.waitForFunction(() => {
    const cs = [...document.querySelectorAll('.voz-graf canvas')];
    const conPixeles = cs.filter(c => {
      try {
        const d = c.getContext('2d').getImageData(0, 0, c.width || 1, c.height || 1).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
      } catch (e) { /* canvas sin contexto: cuenta como no dibujado */ }
      return false;
    });
    return conPixeles.length >= 1 ? { total: cs.length, pintados: conPixeles.length } : false;
  }, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
  ok(dibujados && dibujados.pintados >= 1,
     'el gráfico de apoyo se DIBUJA (píxeles, no solo el <canvas>)',
     dibujados ? dibujados.pintados + ' pintados de ' + dibujados.total + ' (los de abajo esperan a verse: es lo correcto)' : '(ninguno pintó en 20 s)');

  // ⚠ LA CAPTURA NO ENSEÑA LOS GRÁFICOS, Y EL PRODUCTO ESTÁ BIEN. Léelo antes de asustarte:
  // en la foto, donde va cada gráfico se ve un hueco blanco con un iconito de imagen partida. Yo mismo
  // di por hecho que estaban rotos el 24 ago 2026. NO LO ESTÁN. Medido en la página de verdad: el
  // elemento que hay en ese punto ES el <canvas>, mide 1252x180, tiene 30 colores distintos y su
  // toDataURL devuelve un PNG de 21 KB. Este Chromium headless no compone el canvas dentro de la
  // captura — la misma limitación por la que `fullPage` responde «Unable to capture screenshot».
  // Por eso el gráfico se comprueba por PÍXELES (la aserción de arriba) y no mirando la foto: aquí la
  // foto es el instrumento que miente, no la pantalla.
  const foto = join(SHOTS, 'vigia-owner.png');
  try { unlinkSync(foto); } catch {}
  try {
    await page.screenshot({ path: foto, fullPage: true });
  } catch (e1) {
    try {
      await page.screenshot({ path: foto });   // la ventana, sin más
      console.warn('  ⚠ la página entera no cabe en una captura (' + e1.message.slice(0, 60) + '); guardada la ventana.');
    } catch (e2) {
      console.warn('  ⚠ NO hay captura del vigía: ' + e2.message.slice(0, 80));
    }
  }
  ok(existsSync(foto), 'queda una captura del vigía para mirarla (y es de AHORA, no de la pasada anterior)');

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
