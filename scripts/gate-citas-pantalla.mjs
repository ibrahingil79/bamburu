// CITAS · Escalera paso 7 · PIEZA 5 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE (la lógica ya la prueban test-citas / test-enlace-cita / test-avisos-cita / test-neto-cero):
//   [1] la entrada "Agenda" aparece y se llega pulsándola; CREAR una cita DESDE EL MODAL (servicio +
//       persona + recurso + fecha + hueco calculado en vivo); 0 errores JS.
//   [2] MOVER revalidando en servidor (a hueco libre → OK; encima de otra cita → 409).
//   [3] agenda por PERSONA y por RECURSO (ambos ejes pintan la cita).
//   [4] ATENDER cobrando desde pantalla: emite por el motor de siempre y CUADRA; anular la revierte.
//   [5] LA COLA lista la cita de mañana; el botón de WhatsApp abre con el texto y el ENLACE correctos;
//       marcar deja el estado en "marcado como enviado".
//   [6] permisos: sin citas.read → ni entrada ni URL (403); con read sin edit → ve, pero crear → 403.
//
// NO deja residuo de negocio: borra sus citas/recurso/servicio/cliente/horarios de prueba al salir.
// (La factura del cobro queda ANULADA — neto-cero — como cualquier anulación real; no se purga la
//  cadena Verifactu a mano.)
//   node scripts/gate-citas-pantalla.mjs
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';

const BASE = 'http://desarrollo-bamburu.localhost:3000';
const HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'citas-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}

const TS = Date.now();
const tokens = [], emps = [], citaIds = [], tramoIds = [];
let R = 0, S = 0, CLI = 0;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const F = ymd(Date.now() + 2 * 86400000);
const MANANA = ymd(Date.now() + 86400000);

function sesion(userId) {
  const tok = 'gate-citas-' + userId + '-' + Date.now() + '-' + Math.floor(performance.now());
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
function nuevoEmpleado(nombre, permisos) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)").run(nombre, 'gate-citas-' + TS + '-' + emps.length + '@t.local', 'x').lastInsertRowid;
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
  await page.setViewport({ width: 1500, height: 1000 });
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.setCookie({ name: 'asess', value: sesion(userId), domain: HOST, path: '/' });
  return page;
}

try {
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();

  // ── Datos de prueba (recurso + servicio reservable + cliente con móvil + horario de negocio) ──
  R = db.prepare("INSERT INTO recursos (nombre,tipo,active) VALUES (?, 'silla', 1)").run('GATE Silla ' + TS).lastInsertRowid;
  S = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,20,'service','general',21,'active')").run('GATE Corte ' + TS).lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,margen_min) VALUES (?,1,30,0)").run(S);
  CLI = db.prepare("INSERT INTO clients (name,email,movil_e164,active) VALUES (?, 'gatecita@t.local', '+34600999888', 1)").run('GATE Cliente ' + TS).lastInsertRowid;
  // Horario de negocio 8:00-20:00 para los dos días que usa el gate (si ya hubiera, se suman y se limpian por id).
  for (const fecha of [F, MANANA]) {
    const dow = new Date(fecha + 'T00:00:00Z').getUTCDay();
    const id = db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dow, 8 * 60, 20 * 60).lastInsertRowid;
    tramoIds.push(id);
  }

  browser = await puppeteer.launch(launchOpts());

  // ── [1] DUEÑO: entrada + crear DESDE MODAL ──────────────────────────────────
  console.log('\n[1] DUEÑO: entrada + crear cita desde el modal');
  const po = await paginaDe(owner.id);
  const errs = []; po.on('pageerror', e => errs.push(e.message));

  await po.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const navLink = await po.$eval('a[href="/admin/citas"]', a => a.textContent.trim()).catch(() => null);
  ok(navLink && /Agenda/i.test(navLink), 'la entrada "Agenda" aparece en el menú', navLink || '(no está)');
  await Promise.all([
    po.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    po.evaluate(() => document.querySelector('a[href="/admin/citas"]').click()),
  ]);
  ok(po.url().endsWith('/admin/citas'), 'pulsando la entrada se llega a /admin/citas', po.url());
  await po.waitForFunction(() => typeof openNuevaCita === 'function', { timeout: 8000 }).catch(() => {});

  // Crear cita A por la API (crear DESDE EL PANEL nuevo lo cubre gate-agenda-sencilla).
  const crearA = await call(po, 'POST', '/api/erp/citas', { cliente_suelto_nombre: 'GATE Suelto ' + Date.now(), user_id: owner.id, recurso_id: R, fecha: F, inicio_min: 10 * 60, service_ids: [S] });
  ok(crearA.status === 200, 'cita creada (API)', String(crearA.status));
  // Esperar a que la cita exista en la API.
  let citaA = null;
  for (let i = 0; i < 20 && !citaA; i++) {
    const lst = await call(po, 'GET', '/api/erp/citas?desde=' + F + '&hasta=' + F);
    citaA = (lst.body || []).find(x => x.recurso_id === R);
    if (!citaA) await new Promise(r => setTimeout(r, 200));
  }
  ok(citaA && /^CITA-\d{4}$/.test(citaA.codigo), 'cita con código CITA-NNNN', citaA && citaA.codigo);
  if (citaA) citaIds.push(citaA.id);

  // ── [3] Agenda por PERSONA y por RECURSO ────────────────────────────────────
  console.log('\n[2] agenda por persona y por recurso');
  await po.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
  await po.evaluate((f) => { document.getElementById('agFecha').value = f; document.getElementById('agEje').value = 'persona'; return agCargar(); }, F);
  await po.waitForFunction(() => document.querySelectorAll('.citaBlock').length > 0, { timeout: 8000 }).catch(() => {});
  const enPersona = await po.$$eval('.citaBlock', els => els.length).catch(() => 0);
  ok(enPersona > 0, 'eje PERSONA: la cita se pinta en la agenda', enPersona + ' bloque(s)');
  await po.evaluate(() => { document.getElementById('agEje').value = 'recurso'; return agCargar(); });
  await po.waitForFunction(() => document.querySelectorAll('.citaBlock').length > 0, { timeout: 8000 }).catch(() => {});
  const enRecurso = await po.$$eval('.citaBlock', els => els.length).catch(() => 0);
  ok(enRecurso > 0, 'eje RECURSO: la misma cita se pinta por recurso', enRecurso + ' bloque(s)');
  await po.screenshot({ path: join(SHOTS, 'agenda.png') }).catch(() => {});

  // ── [2] MOVER revalidando en servidor ───────────────────────────────────────
  console.log('\n[3] mover (revalida en servidor)');
  const citaB = await call(po, 'POST', '/api/erp/citas', { cliente_suelto_nombre: 'GATE B', user_id: owner.id, fecha: F, inicio_min: 12 * 60, service_ids: [S] });
  ok(citaB.status === 200, 'segunda cita creada por la API (para el conflicto)', String(citaB.status));
  if (citaB.body && citaB.body.id) citaIds.push(citaB.body.id);
  const moverOk = await call(po, 'POST', '/api/erp/citas/' + citaB.body.id + '/mover', { fecha: F, inicio_min: 13 * 60 });
  ok(moverOk.status === 200, 'mover a un hueco libre → 200', String(moverOk.status));
  const moverChoque = await call(po, 'POST', '/api/erp/citas/' + citaB.body.id + '/mover', { fecha: F, inicio_min: citaA.inicio_min });
  ok(moverChoque.status === 409, 'mover ENCIMA de otra cita de la misma persona → 409 (guarda de solape en servidor)', String(moverChoque.status));

  // ── [4] ATENDER cobrando (motor de siempre, cuadra) + anular (revierte) ──────
  console.log('\n[4] atender + cobrar (cuadra) + anular (revierte)');
  const at = await call(po, 'POST', '/api/erp/citas/' + citaA.id + '/atender', { cobrar: true, via: 'ticket', payment_method: 'efectivo' });
  ok(at.status === 200 && at.body.invoice_id, 'atender con cobro emite por el motor existente', 'factura ' + (at.body && at.body.invoice_id));
  const inv = at.body.invoice_id ? db.prepare('SELECT total, status FROM invoices WHERE id=?').get(at.body.invoice_id) : null;
  ok(inv && Math.abs(inv.total - 24.2) < 0.01, 'el cobro CUADRA: 20 € + 21% IVA = 24,20 €', inv && String(inv.total));
  const anu = await call(po, 'DELETE', '/api/erp/citas/' + citaA.id);
  ok(anu.status === 200, 'anular la cita atendida → 200', String(anu.status));
  const invTras = at.body.invoice_id ? db.prepare('SELECT status FROM invoices WHERE id=?').get(at.body.invoice_id) : null;
  ok(invTras && invTras.status === 'anulada', 'al anular la cita, su factura queda anulada (neto-cero)', invTras && invTras.status);

  // ── [5] LA COLA: cita de mañana + botón WhatsApp con enlace + marcar ─────────
  console.log('\n[5] cola de envíos + WhatsApp + marcar');
  const citaC = await call(po, 'POST', '/api/erp/citas', { cliente_id: CLI, user_id: owner.id, fecha: MANANA, inicio_min: 10 * 60, service_ids: [S] });
  ok(citaC.status === 200, 'cita de MAÑANA creada (cliente con móvil)', String(citaC.status));
  if (citaC.body && citaC.body.id) citaIds.push(citaC.body.id);
  await po.goto(BASE + '/admin/citas/cola', { waitUntil: 'networkidle2' });
  await po.waitForFunction(() => { const e = document.getElementById('colaRec'); return e && /GATE Cliente/.test(e.textContent); }, { timeout: 8000 }).catch(() => {});
  const colaTxt = await po.$eval('#colaRec', el => el.textContent).catch(() => '');
  ok(/GATE Cliente/.test(colaTxt), 'la cita de mañana aparece en la cola de recordatorios');
  const waHref = await po.$$eval('#colaRec a', as => { const w = as.find(a => /wa\.me/.test(a.href)); return w ? w.href : null; }).catch(() => null);
  ok(waHref && /wa\.me\/34600999888/.test(waHref), 'el botón de WhatsApp usa wa.me con el móvil del cliente', waHref ? 'ok' : '(no está)');
  ok(waHref && /\/cita\//.test(decodeURIComponent(waHref)), 'el mensaje de WhatsApp lleva el ENLACE de la cita (/cita/<token>)');
  ok(waHref && /Recordatorio/i.test(decodeURIComponent(waHref)), 'el texto del recordatorio va escrito en el mensaje');
  // Marcar como enviado (WhatsApp) y comprobar el estado honesto.
  const marc = await call(po, 'POST', '/api/erp/citas/' + citaC.body.id + '/aviso', { tipo: 'recordatorio', canal: 'whatsapp' });
  ok(marc.status === 200 && marc.body.estado === 'marcado', 'marcar el aviso deja el estado en "marcado" (nunca "entregado")', marc.body && marc.body.estado);
  await po.goto(BASE + '/admin/citas/cola', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 400));
  const colaTxt2 = await po.$eval('#colaRec', el => el.textContent).catch(() => '');
  ok(/marcado/i.test(colaTxt2) && !/entregado/i.test(colaTxt2), 'la cola muestra "marcado" y en ningún sitio "entregado"');
  ok(errs.length === 0, 'las pantallas de citas no lanzan errores de JS/CSP', errs.join(' | ') || 'limpio');
  await po.screenshot({ path: join(SHOTS, 'cola.png') }).catch(() => {});

  // ── [6] PERMISOS ────────────────────────────────────────────────────────────
  console.log('\n[6] permisos');
  const empNoRead = nuevoEmpleado('Gate Citas SinRead', [['clients', 'read']]);
  const pnr = await paginaDe(empNoRead);
  await pnr.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  const veEntrada = await pnr.$('a[href="/admin/citas"]').then(x => !!x).catch(() => false);
  ok(!veEntrada, 'sin citas.read: NO ve la entrada "Agenda" en el menú');
  const r403 = await pnr.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
  ok(r403.status() === 403, 'sin citas.read: /admin/citas por URL → 403', String(r403.status()));

  const empReadNoEdit = nuevoEmpleado('Gate Citas Read', [['citas', 'read']]);
  const pre = await paginaDe(empReadNoEdit);
  const rlista = await pre.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
  ok(rlista.status() === 200, 'con citas.read: ve la agenda (200)', String(rlista.status()));
  const postSinEdit = await call(pre, 'POST', '/api/erp/citas', { cliente_suelto_nombre: 'X', user_id: owner.id, fecha: F, inicio_min: 600, service_ids: [S] });
  ok(postSinEdit.status === 403, 'sin citas.edit: crear por la API → 403', String(postSinEdit.status));

  await browser.close();
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
  try { await browser.close(); } catch {}
} finally {
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  for (const id of citaIds) { try { db.prepare('DELETE FROM cita_servicios WHERE cita_id=?').run(id); } catch {} try { db.prepare('DELETE FROM cita_avisos WHERE cita_id=?').run(id); } catch {} try { db.prepare('DELETE FROM citas WHERE id=?').run(id); } catch {} }
  for (const id of tramoIds) { try { db.prepare('DELETE FROM horario_tramos WHERE id=?').run(id); } catch {} }
  try { if (S) { db.prepare('DELETE FROM service_config WHERE product_id=?').run(S); db.prepare('DELETE FROM products WHERE id=?').run(S); } } catch {}
  try { if (R) db.prepare('DELETE FROM recursos WHERE id=?').run(R); } catch {}
  try { if (CLI) db.prepare('DELETE FROM clients WHERE id=?').run(CLI); } catch {}
  for (const id of emps) { try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id); } catch {} try { db.prepare('DELETE FROM admin_users WHERE id=?').run(id); } catch {} }
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
