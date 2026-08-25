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
import { launchOpts, APP_DIR, autoAceptarPaneles } from './lib/gate-env.mjs';
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
// LOS DOS DÍAS SE ELIGEN VACÍOS, NO SE CUENTAN CON LOS DEDOS ────────────────────────────────────
// Antes eran «hoy + 2» y «hoy + 1» a secas, y este gate cablea las 9, 10, 11, 12 y 13 de ese día. El
// 25 ago 2026 se puso rojo de golpe sin que nadie tocara nada: llevaba cuatro barridos en verde con
// 42 ✓ y de repente daba 409 al crear la primera cita. No era una regresión — «hoy + 2» había pasado
// de caer en el 26 (libre) a caer en el 27, donde había DOS citas de los datos de ejemplo del negocio
// puestas el 20 de agosto. Una bomba de relojería: el residuo estaba quieto y fue el gate el que se
// acercó a él.
//
// Esas dos citas NO se borran: son de clientes del propio negocio y pueden ser una demostración de
// verdad. Un gate no tiene por qué quitar de en medio los datos de otros; lo que tiene que hacer es no
// dar por hecho que su hueco está libre. Se buscan dos días SIN NINGUNA cita, y así las cinco horas
// que usa quedan libres por construcción.
function diaVacio(desdeDias, ocupados) {
  for (let i = desdeDias; i < desdeDias + 60; i++) {
    const f = ymd(Date.now() + i * 86400000);
    if (ocupados.has(f)) continue;
    ocupados.add(f);   // el segundo día no puede ser el mismo que el primero
    return f;
  }
  console.error('\n✗ GATE ABORTADO — no encuentro ni un día sin citas en los próximos dos meses. No ha verificado NADA.');
  process.exit(2);
}
const ocupados = new Set(db.prepare("SELECT DISTINCT fecha FROM citas WHERE fecha >= date('now')").all().map(r => r.fecha));
const MANANA = diaVacio(1, ocupados);
const F = diaVacio(2, ocupados);

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
  // Y el panel que sustituyó a esas ventanitas: se acepta igual que se aceptaba el confirm().
  await autoAceptarPaneles(page);
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
  // Desde el 20 ago (Tarea 2 · cabo 4) anular exige decir QUIÉN. Aquí anula el negocio desde su
  // pantalla, así que va 'negocio'. La aserción de neto-cero de abajo no cambia ni un ápice.
  const anu = await call(po, 'DELETE', '/api/erp/citas/' + citaA.id, { anulada_por: 'negocio' });
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

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // [6] QUIÉN ANULÓ LA CITA (Tarea 2 · cabo 4)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Lo que se protege: que el dato NAZCA COMPLETO. Un dato de autoría que se puede dejar en blanco
  // desde la pantalla no sirve para nada tres meses después, porque la mitad de las filas dirán
  // «no consta» y nadie sabrá si es que no se supo o que no se preguntó.
  console.log('\n[6] quién anuló la cita');
  const pag = await paginaDe(owner.id);
  await pag.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });   // los fetch de abajo son relativos
  const nuevaCita = async (min) => {
    const r = await call(pag, 'POST', '/api/erp/citas', { cliente_id: CLI, user_id: owner.id, fecha: F, inicio_min: min, service_ids: [S] });
    if (r.body && r.body.id) citaIds.push(r.body.id);
    return r.body && r.body.id;
  };
  const filaDe = id => db.prepare('SELECT estado, anulada_por, anulada_at FROM citas WHERE id=?').get(id);

  const cA = await nuevaCita(9 * 60);
  const sinQuien = await call(pag, 'POST', '/api/erp/citas/' + cA + '/estado', { estado: 'anulada' });
  ok(sinQuien.status === 400, 'anular SIN decir quién se RECHAZA (400): elegir es obligatorio', 'HTTP ' + sinQuien.status);
  ok(filaDe(cA).estado === 'confirmada' || filaDe(cA).estado === 'pedida',
     'y la cita NO se queda anulada a medias', filaDe(cA).estado);

  const conCliente = await call(pag, 'POST', '/api/erp/citas/' + cA + '/estado', { estado: 'anulada', anulada_por: 'cliente' });
  const fA = filaDe(cA);
  ok(conCliente.status === 200 && fA.estado === 'anulada' && fA.anulada_por === 'cliente',
     'la anula el CLIENTE: queda registrado', JSON.stringify(fA));
  ok(!!fA.anulada_at, 'y anulada_at sigue guardando el CUÁNDO, intacto', fA.anulada_at);

  const cB = await nuevaCita(10 * 60);
  const sinQuien2 = await call(pag, 'DELETE', '/api/erp/citas/' + cB, {});
  ok(sinQuien2.status === 400, 'el botón «Anular» tampoco cuela sin quién (400)', 'HTTP ' + sinQuien2.status);
  await call(pag, 'DELETE', '/api/erp/citas/' + cB, { anulada_por: 'negocio' });
  ok(filaDe(cB).anulada_por === 'negocio', 'la anula el NEGOCIO: queda registrado', JSON.stringify(filaDe(cB)));

  // «No se presentó» NO es una anulación: es su propio estado y no escribe autor de anulación.
  const cC = await nuevaCita(11 * 60);
  const ns = await call(pag, 'POST', '/api/erp/citas/' + cC + '/estado', { estado: 'no_show' });
  const fC = filaDe(cC);
  ok(ns.status === 200 && fC.estado === 'no_show' && fC.anulada_por === null,
     'NO SE PRESENTÓ sigue siendo un ESTADO, no una anulación: sin autor y sin anulada_at', JSON.stringify(fC));
  ok(!fC.anulada_at, 'y no se le pone sello de anulación a algo que nadie anuló');

  // Una cita anulada ANTES de que existiera el dato: se enseña «sin registrar», no se le inventa autor.
  const cD = await nuevaCita(12 * 60);
  await call(pag, 'POST', '/api/erp/citas/' + cD + '/estado', { estado: 'anulada', anulada_por: 'negocio' });
  db.prepare('UPDATE citas SET anulada_por=NULL WHERE id=?').run(cD);          // simula el pasado
  await pag.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
  await pag.evaluate(id => verCita(id), cD);
  await pag.waitForFunction(() => document.getElementById('mDet').classList.contains('open'), { timeout: 8000 }).catch(() => {});
  const textoDet = await pag.evaluate(() => (document.getElementById('mDetBody') || {}).textContent || '');
  ok(/Sin registrar/.test(textoDet), 'una anulada de ANTES del cambio se lee «Sin registrar» — no se le adivina autor',
     (textoDet.match(/Anulada por\s*\S+[^·]*/) || ['(no sale)'])[0].slice(0, 60));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // [7] LAS CITAS DE UN CLIENTE, FILTRADAS (Tarea 2 · cabo 5)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] desde la ficha del cliente, sus citas llegan filtradas');
  const otroCli = db.prepare("INSERT INTO clients (name,active) VALUES (?,1)").run('GATE Otro ' + TS).lastInsertRowid;
  const cOtro = await call(pag, 'POST', '/api/erp/citas', { cliente_id: otroCli, user_id: owner.id, fecha: F, inicio_min: 13 * 60, service_ids: [S] });
  if (cOtro.body && cOtro.body.id) citaIds.push(cOtro.body.id);

  // Las citas de este gate están en F (pasado mañana), así que se navega ahí por la propia pantalla.
  const verDia = async (url) => {
    await pag.goto(BASE + url, { waitUntil: 'networkidle2' });
    await pag.waitForFunction(() => typeof irA === 'function', { timeout: 8000 });
    await pag.evaluate(f => irA(f), F);
    await new Promise(r => setTimeout(r, 1400));
  };
  await verDia('/admin/citas');
  const sinFiltro = await pag.evaluate(() => ({ n: document.querySelectorAll('.citaBlock').length, chip: !!document.querySelector('.ag-chip') }));
  ok(!sinFiltro.chip, 'sin filtro, no hay chip que quitar');
  ok(sinFiltro.n > 1, 'y se ven las citas de varios clientes', sinFiltro.n + ' citas');

  await verDia('/admin/citas?cliente=' + CLI);
  const conFiltro = await pag.evaluate(() => ({
    n: document.querySelectorAll('.citaBlock').length,
    chip: (document.querySelector('.ag-chip') || {}).textContent || '',
    quitar: !!document.querySelector('.ag-chip button'),
  }));
  ok(conFiltro.n < sinFiltro.n, 'con el filtro se ven MENOS citas que sin él', conFiltro.n + ' de ' + sinFiltro.n);
  ok(conFiltro.n > 0, 'pero se siguen viendo las suyas', conFiltro.n + ' citas');
  ok(/Solo las citas de/.test(conFiltro.chip), 'el filtro SE VE, con el nombre del cliente', conFiltro.chip.trim().slice(0, 50));
  ok(conFiltro.quitar, 'y tiene su aspa para quitarlo');
  const dejaVerLaDelOtro = await pag.evaluate(id => !document.querySelector('.citaBlock[data-id="' + id + '"]'), cOtro.body && cOtro.body.id);
  ok(dejaVerLaDelOtro, 'la cita de OTRO cliente no aparece con el filtro puesto');
  await Promise.all([pag.waitForNavigation({ waitUntil: 'networkidle2' }),
                     pag.evaluate(() => document.querySelector('.ag-chip button').click())]);
  await pag.evaluate(f => irA(f), F);
  await new Promise(r => setTimeout(r, 1400));
  const trasQuitar = await pag.evaluate(() => ({ n: document.querySelectorAll('.citaBlock').length, chip: !!document.querySelector('.ag-chip') }));
  ok(!trasQuitar.chip && trasQuitar.n === sinFiltro.n, 'al quitarlo vuelven todas', trasQuitar.n + ' citas');
  try { db.prepare('DELETE FROM clients WHERE id=?').run(otroCli); } catch {}

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
