// Gate de navegador — SEÑAL ÚNICA de avisos + estado visto/nuevo (Opción C).
// Contra el servidor real (tenant desarrollo-bamburu). Determinista (sin modelo).
// La única señal del chrome es el punto de la campana (#tbBell .dot); el número vive en la
// tarjeta "Avisos" del Inicio. Se retiraron el contador del pin de DISA y el badge flotante.
//   1. Campana ROJA cuando hay algo sin ver; tarjeta con el número y enlace a /admin/avisos.
//   2. Resumen-primero → DISA da un RESUMEN DE CONTEOS (de avisosDelDia), sin detalle y SIN
//      ofrecer acciones; el conteo == el de la tarjeta. La campana pasa a GRIS (visto) y SIGUE
//      gris al recargar y en otras pantallas (el fallo era que colgaba del conteo, no del estado).
//   3. Ciclo: tras abrir = visto; una factura NUEVA vencida → vuelve a rojo; empeorar una ya
//      vista → sigue visto. Restaura el estado previo del tenant (huella + datos) al terminar.
//   4. "Visto" es POR USUARIO: que uno los abra NO se los deja vistos a otro del mismo negocio.
//   5. Pantalla central /admin/avisos: mismo número que el motor, una fila por aviso, cada una
//      enlazada a su documento, sin XSS; y el contador del rail enlaza a ella.
// Que los avisos se RESUELVAN desde esa pantalla lo cubre gate-avisos-pantalla.mjs.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { estadoAvisos, resumenAvisos } from '../modules/erp/avisos.js';

const DB_PATH = '/home/ubuntu/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const TODAY = new Date().toISOString().slice(0, 10);
const UID = 2;          // el usuario de la sesión del gate: la huella de "visto" es SUYA

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, UID, now, now + 1800, csrf);

// Snapshot del estado a restaurar (huella de visto previa DE ESTE USUARIO).
const seenSnap = db.prepare('SELECT fingerprint FROM alert_seen_user WHERE user_id=?').get(UID);
const SUP_NAME = 'ZZ Avisos ' + randomBytes(3).toString('hex');
let supId = null, invId = null, otroUid = null;
// Huella del segundo usuario, para restaurarla al terminar (el gate la borra para probar el aislamiento).
const seenSnapOtro = db.prepare('SELECT user_id, fingerprint FROM alert_seen_user WHERE user_id<>?').all(2);

// La ÚNICA señal del chrome es el punto de la campana: rojo = algo sin ver, gris = pendientes
// ya vistos, ausente = nada. (Antes había además un contador en el pin de DISA y un badge
// flotante en Inicio, los tres diciendo lo mismo; se retiraron.)
const bellState = () => page.evaluate(() => {
  const dot = document.querySelector('#tbBell .dot');
  if (!dot) return { present: false };
  return { present: true, visto: dot.classList.contains('visto') };
});
// El NÚMERO vive en la tarjeta "Avisos" del Inicio, que además es un enlace a /admin/avisos.
const tarjetaAvisos = () => page.evaluate(() => {
  const a = document.querySelector('a.disa-fig-link');
  if (!a) return { present: false };
  return { present: true, href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim() };
});

// El Chrome que descarga puppeteer está roto en este arm64: se usa el Chromium del sistema.
// PUPPETEER_EXECUTABLE_PATH lo sobreescribe si hiciera falta otro.
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

try {
  // Estado de partida determinista: huella vacía → ROJO (el tenant tiene avisos reales).
  db.prepare("INSERT INTO alert_seen_user (user_id, fingerprint) VALUES (?,'[]') ON CONFLICT(user_id) DO UPDATE SET fingerprint='[]'").run(UID);
  const est0 = estadoAvisos(db, TODAY, UID);
  ok(est0.count > 0 && est0.estado === 'rojo', 'partida: hay avisos y estado ROJO (' + est0.count + ' avisos)');
  const groups0 = resumenAvisos(est0.avisos);

  // ── 1. Campana en ROJO; la tarjeta lleva el número y enlaza a la pantalla ───
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  let b = await bellState();
  ok(b.present && !b.visto, 'la campana muestra punto ROJO (hay avisos sin ver)');
  const tarj = await tarjetaAvisos();
  ok(tarj.present && tarj.text.includes(String(est0.count)), 'la tarjeta "Avisos" del Inicio lleva el número ' + est0.count + ' (got "' + tarj.text + '")');
  ok(tarj.href === '/admin/avisos', 'la tarjeta "Avisos" es un enlace a /admin/avisos (era un div muerto)');
  // Ya no queda ninguna señal duplicada en el chrome ni en el Inicio.
  const duplicados = await page.evaluate(() => ({
    pinBadge: !!document.querySelector('.disa-pin-badge'),
    pillFlotante: !!document.querySelector('#dh-alerts-badge'),
    filas: document.querySelectorAll('.disa-row').length,
  }));
  ok(!duplicados.pinBadge, 'el contador del pin de DISA ya NO existe');
  ok(!duplicados.pillFlotante, 'el badge flotante "N alertas" del Inicio ya NO existe');
  ok(duplicados.filas === 1, 'en el Inicio queda UNA sola fila de avisos (got ' + duplicados.filas + ')');

  // ── 2. Resumen-primero (tarjeta "¿Qué requiere mi atención?") → campana a gris ──
  await page.evaluate(() => window.disaShowAlerts());
  await page.waitForFunction(() => {
    const m = document.querySelectorAll('#dh-messages .disa-msg.assistant');
    return m.length && /que mirar|nada pendiente/.test(m[m.length - 1].textContent);
  }, { timeout: 8000 });
  const reply = await page.evaluate(() => {
    const m = document.querySelectorAll('#dh-messages .disa-msg.assistant');
    return m[m.length - 1].textContent;
  });
  ok(/Tienes .* que mirar/.test(reply), 'el resumen-primero sale del motor ("' + reply.slice(0, 70) + '…")');
  // Conteos del resumen == los del badge (cada grupo aparece con su número).
  const okCounts = groups0.every(g => reply.includes(String(g.count)));
  ok(okCounts, 'el resumen lista los conteos por fuente y cuadran con el badge (' + groups0.map(g => g.tipo + '=' + g.count).join(', ') + ')');
  // Lo que se vigila es que el resumen NO OFREZCA ACCIONES (era una pregunta abierta al modelo
  // que proponía mandar emails). Antes se usaba el token "cobr" como proxy; ahora "cobros de
  // cliente vencidos" es una FUENTE legítima y la palabra aparece describiendo el aviso, no
  // ofreciendo nada. Se vigilan los verbos de oferta y que cierre pidiendo elegir, no actuar.
  ok(!/recordatorio|email|reclam|prepar/i.test(reply) && /¿Cuál quieres ver\?|¿Quieres verlo\?/.test(reply),
    'el resumen NO ofrece acciones: solo conteos y "¿cuál quieres ver?"');
  b = await bellState();
  ok(b.present && b.visto, 'tras verlos, el punto de la campana pasa a GRIS sin recargar');

  // La huella quedó marcada → al recargar, la campana SIGUE gris. (Este es el fallo que se
  // corrige: antes el punto colgaba del conteo y seguía rojo después de leerlos.)
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  b = await bellState();
  ok(b.present && b.visto, 'al recargar, la campana sigue GRIS (ya no hay nada nuevo)');
  // Y en otra pantalla cualquiera del admin, también.
  await page.goto(BASE + '/admin/cobros', { waitUntil: 'networkidle0' });
  b = await bellState();
  ok(b.present && b.visto, 'en otra pantalla del admin la campana también está GRIS');

  // ── 3. Una factura NUEVA vencida → vuelve a ROJO ────────────────────────────
  supId = db.prepare("INSERT INTO suppliers (name,active,payment_term_days) VALUES (?,1,0)").run(SUP_NAME).lastInsertRowid;
  const sq = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM supplier_invoices').get().n;
  invId = db.prepare(`INSERT INTO supplier_invoices (supplier_id,internal_code,supplier_invoice_number,invoice_date,due_date,base,tax,total,status,supplier_name)
    VALUES (?,?,?,?,?,?,?,?, 'vigente', ?)`).run(supId, 'FRP-A' + sq, 'AV' + sq, '2026-01-10', '2026-02-01', 100, 0, 100, SUP_NAME).lastInsertRowid;
  ok(estadoAvisos(db, TODAY, UID).estado === 'rojo', 'aparece una factura vencida NUEVA → estado ROJO');
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  b = await bellState();
  ok(b.present && !b.visto, 'la campana vuelve a ROJO al aparecer un aviso nuevo');
  const tarj2 = await tarjetaAvisos();
  ok(tarj2.text.includes(String(est0.count + 1)), 'la tarjeta sube a ' + (est0.count + 1) + ' (got "' + tarj2.text + '")');

  // ── 4. Empeorar una ya vista NO reactiva el rojo ────────────────────────────
  await page.evaluate(() => window.disaShowAlerts());                 // marca visto (incluye la nueva)
  await page.waitForFunction(() => document.querySelectorAll('#dh-messages .disa-msg.assistant').length > 0, { timeout: 8000 });
  db.prepare('UPDATE supplier_invoices SET due_date=? WHERE id=?').run('2026-01-01', invId);   // empeora (más días vencida)
  ok(estadoAvisos(db, TODAY, UID).estado === 'visto', 'que una factura ya vista EMPEORE no reactiva el rojo (sigue VISTO)');

  // ── 5. "Visto" es POR USUARIO, no por negocio ───────────────────────────────
  // El usuario 2 acaba de abrir sus avisos (arriba). Otro usuario del MISMO negocio no puede
  // heredar ese "visto": para él sigue habiendo algo sin leer. Este era el bug de alert_seen
  // (singleton id=1): uno lo abría y quedaba visto para todos.
  otroUid = db.prepare("SELECT id FROM admin_users WHERE id<>? ORDER BY id LIMIT 1").get(UID)?.id || null;
  if (otroUid) {
    db.prepare('DELETE FROM alert_seen_user WHERE user_id=?').run(otroUid);   // usuario que nunca los abrió
    ok(estadoAvisos(db, TODAY, UID).estado === 'visto', 'el usuario ' + UID + ' (que los abrió) los ve VISTOS');
    ok(estadoAvisos(db, TODAY, otroUid).estado === 'rojo', 'otro usuario del mismo negocio los sigue viendo en ROJO (visto es por usuario)');
  } else {
    ok(false, 'el tenant no tiene un segundo usuario con el que probar el aislamiento por usuario');
  }

  // ── 6. La pantalla central lista los avisos con enlace de acción ────────────
  await page.goto(BASE + '/admin/avisos', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#avBody tr.frow', { timeout: 8000 });
  const pantalla = await page.evaluate(() => ({
    total: document.getElementById('avTotal').textContent.trim(),
    filas: document.querySelectorAll('#avBody tr.frow').length,
    conEnlace: [...document.querySelectorAll('#avBody tr.frow')].filter(tr => tr.querySelector('a[href]')).length,
    // El nombre de cliente con payload XSS debe salir como TEXTO, nunca como <script> vivo.
    scripts: document.querySelectorAll('#avBody script').length,
  }));
  const estPantalla = estadoAvisos(db, TODAY, UID);
  ok(pantalla.total === String(estPantalla.count), 'la pantalla central muestra el mismo número que el motor (' + pantalla.total + ')');
  ok(pantalla.filas === estPantalla.count, 'lista UNA fila por aviso (' + pantalla.filas + ')');
  // Que cada fila enlace a SU documento (contexto). Que además se pueda RESOLVER el aviso sin
  // salir de la pantalla lo comprueba gate-avisos-pantalla.mjs (pulsa el botón de verdad).
  ok(pantalla.conEnlace === pantalla.filas, 'TODAS las filas enlazan a su documento');
  ok(pantalla.scripts === 0, 'los nombres con payload XSS se pintan escapados (0 <script> inyectados)');

  // La campana enlaza a la pantalla central.
  const bellHref = await page.evaluate(() => document.querySelector('#bellPanel .bell-foot')?.getAttribute('href'));
  ok(bellHref === '/admin/avisos', 'el panel de la campana lleva a /admin/avisos (got ' + bellHref + ')');

} catch (e) {
  fail++; console.error('  ✗ EXCEPCIÓN: ' + e.message);
} finally {
  try {
    if (invId) db.prepare('DELETE FROM supplier_invoices WHERE id=?').run(invId);
    if (supId) db.prepare('DELETE FROM suppliers WHERE id=?').run(supId);
    // Restaura la huella previa de CADA usuario (deja el badge como estaba).
    if (seenSnap) db.prepare("INSERT INTO alert_seen_user (user_id, fingerprint) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET fingerprint=excluded.fingerprint").run(UID, seenSnap.fingerprint);
    else db.prepare('DELETE FROM alert_seen_user WHERE user_id=?').run(UID);
    for (const s of seenSnapOtro) {
      db.prepare("INSERT INTO alert_seen_user (user_id, fingerprint) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET fingerprint=excluded.fingerprint").run(s.user_id, s.fingerprint);
    }
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  } catch (e) { console.error('  (limpieza) ' + e.message); }
  await browser.close();
  db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
