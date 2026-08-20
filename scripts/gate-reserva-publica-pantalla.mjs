// PUERTA PÚBLICA DE RESERVA · Escalera paso 7 · PIEZA 6 — Gate de NAVEGADOR contra el servidor real.
//
// QUÉ MIDE (la lógica ya la prueban test-reserva-publica / test-coincidencia-huecos / test-neto-cero-reserva):
//   [1] APAGADA por defecto: la dirección responde 404 antes de que el dueño la encienda.
//   [2] Los mandos del dueño: encender, poner dirección, publicar UN servicio, hacer visible A UNA persona.
//   [3] MÓVIL (390×844): reservar de verdad en 4 pasos, SIN sesión, con 0 errores JS.
//   [4] La POLÍTICA de cancelación se ve ANTES de confirmar, y la casilla de consentimiento es obligatoria.
//   [5] CERO FUGA: en el HTML y en TODO lo que viaja por la red no hay nombres de clientes, ni emails,
//       ni teléfonos, ni el nombre del usuario del sistema, ni servicios/personas no publicados.
//   [6] La cita entra en la agenda de dentro y coincide con lo reservado.
//   [7] ESCRITORIO (1400×900): la misma reserva, 0 errores JS.
//   [8] El enlace del cliente: cambiar la hora y anular dentro de la ventana.
//   [9] Los mandos exigen permiso (sin citas.edit → 403).
//
// NO deja residuo: borra sus citas/servicio/persona/horarios y DEVUELVE los ajustes públicos del tenant
// a como estaban (incluido dejar la puerta APAGADA si lo estaba).
//   node scripts/gate-reserva-publica-pantalla.mjs
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
// La memoria del proyecto lo dice: el Chromium de snap NO lee /tmp. Las capturas van bajo $HOME.
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'reserva-shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch {}

const TS = Date.now();
const HANDLE = 'gate' + TS;
const tokens = [], emps = [], citaIds = [], tramoIds = [];
let S = 0, SPRIV = 0, PERSONA = 0, PERSONA2 = 0;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
// Un día laborable a +10 días: lejos de la antelación mínima y dentro de la ventana.
function diaLaborable(desde = 10) {
  for (let i = desde; i < desde + 7; i++) {
    const f = ymd(Date.now() + i * 86400000);
    const dow = new Date(f + 'T00:00:00Z').getUTCDay();
    if (dow >= 1 && dow <= 5) return f;
  }
  return ymd(Date.now() + desde * 86400000);
}
const F = diaLaborable();

function sesion(userId) {
  const tok = 'gate-reserva-' + userId + '-' + Date.now() + '-' + Math.floor(performance.now());
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token, user_id, created_at, expires_at, csrf_token) VALUES (?,?,?,?,?)').run(tok, userId, ahora, ahora + 3600, 'csrf-' + tok);
  tokens.push(tok); return tok;
}
const darPerm = (uid, mod, act) => { const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act); if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id); };
function nuevoEmpleado(nombre, permisos) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)").run(nombre, 'gate-reserva-' + TS + '-' + emps.length + '@t.local', 'x').lastInsertRowid;
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id);
  for (const [m, a] of permisos) darPerm(id, m, a);
  emps.push(id); return id;
}

// Los ajustes públicos que había ANTES, para devolverlos al final tal cual.
const AJUSTES_PREVIOS = db.prepare(
  `SELECT cita_pub_activa, cita_pub_handle, cita_pub_antelacion_min, cita_pub_ventana_dias, cita_pub_modo,
          cita_pub_retencion_horas, cita_pub_cancelar_horas, cita_pub_cancelar_activo, cita_pub_politica,
          cita_pub_privacidad_url FROM company_config WHERE id=1`
).get();

let browser;
const call = (page, method, url, body) => page.evaluate(async (m, u, b) => {
  const opts = { method: m, cache: 'no-store', headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } };
  if (b) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(b); }
  const r = await fetch(u, opts); let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}, method, url, body);

async function paginaDe(userId, viewport = { width: 1400, height: 900 }) {
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.setCookie({ name: 'asess', value: sesion(userId), domain: HOST, path: '/' });
  return page;
}
// Una pestaña ANÓNIMA de verdad: contexto propio y sin cookie de sesión. Es como llega un cliente.
async function paginaAnonima(viewport) {
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.on('dialog', d => d.accept().catch(() => {}));
  return page;
}

// Recorre los 4 pasos y reserva. Devuelve lo observado por el camino.
async function reservar(page, { nombre, movil, email, sinConsent = false, shot = '' }) {
  const visto = { errores: [], red: [], politicaAntesDeConfirmar: false, servicios: [], personas: [], horas: 0 };
  page.on('pageerror', e => visto.errores.push(e.message));
  page.on('console', m => { if (m.type() === 'error') visto.errores.push('console: ' + m.text()); });
  page.on('response', async (r) => {
    try {
      const u = r.url();
      if (u.includes('/reservar/') && r.request().method() === 'GET') visto.red.push(await r.text());
    } catch {}
  });

  await page.goto(BASE + '/reservar/' + HANDLE, { waitUntil: 'networkidle2' });

  // Paso 1 — servicios
  await page.waitForSelector('#listaServicios .opt', { timeout: 8000 });
  if (shot) await page.screenshot({ path: join(SHOTS, shot + '-paso1.png'), fullPage: true }).catch(() => {});
  visto.servicios = await page.$$eval('#listaServicios .opt', els => els.map(e => e.textContent));
  await page.click('#listaServicios .opt');
  await page.click('#a2');

  // Paso 2 — profesional
  await page.waitForSelector('#listaPersonas .opt', { timeout: 8000 });
  visto.personas = await page.$$eval('#listaPersonas .opt', els => els.map(e => e.textContent.trim()));
  await page.evaluate(() => {
    // "Cualquiera disponible" es el primero; se elige el profesional CONCRETO (el segundo).
    const opts = document.querySelectorAll('#listaPersonas .opt');
    (opts[1] || opts[0]).click();
  });
  await page.click('#a3');

  // Paso 3 — día y hora
  await page.waitForSelector('#fecha', { timeout: 8000 });
  await page.evaluate((f) => { document.getElementById('fecha').value = f; document.getElementById('fecha').dispatchEvent(new Event('change')); }, F);
  await page.waitForFunction(() => document.querySelectorAll('#listaHoras .hora').length > 0, { timeout: 10000 });
  visto.horas = await page.$$eval('#listaHoras .hora', els => els.length);
  if (shot) await page.screenshot({ path: join(SHOTS, shot + '-paso3.png'), fullPage: true }).catch(() => {});
  await page.click('#listaHoras .hora');
  await page.click('#a4');

  // Paso 4 — datos. Se mira la política ANTES de tocar nada.
  await page.waitForSelector('#nombre', { timeout: 8000 });
  visto.politicaAntesDeConfirmar = await page.evaluate(() => {
    const p = document.querySelector('#p4 .pol');
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return r.height > 0 && r.width > 0 && p.textContent.length > 20;
  });
  visto.resumen = await page.$eval('#resumen', el => el.textContent).catch(() => '');
  visto.htmlPaso4 = await page.content();
  if (shot) await page.screenshot({ path: join(SHOTS, shot + '-paso4.png'), fullPage: true }).catch(() => {});

  await page.type('#nombre', nombre);
  if (movil) await page.type('#movil', movil);
  if (email) await page.type('#email', email);
  if (!sinConsent) await page.click('#consent');
  await page.click('#enviar');
  await new Promise(r => setTimeout(r, 1200));

  visto.error = await page.$eval('#err', el => (el.style.display === 'none' ? '' : el.textContent)).catch(() => '');
  visto.fin = await page.evaluate(() => {
    const f = document.getElementById('pFin');
    return f && f.style.display !== 'none' ? { texto: document.getElementById('finTexto').textContent, enlace: document.getElementById('finEnlace').getAttribute('href') } : null;
  });
  return visto;
}

try {
  const owner = db.prepare("SELECT id, name FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
  browser = await puppeteer.launch(launchOpts());

  // ── Datos de prueba ────────────────────────────────────────────────────────
  S = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,20,'service','general',21,'active')").run('GATE Corte Publico ' + TS).lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,margen_min,publico) VALUES (?,1,30,0,0)").run(S);
  SPRIV = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,99,'service','general',21,'active')").run('GATE Servicio Secreto ' + TS).lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,margen_min,publico) VALUES (?,1,30,0,0)").run(SPRIV);
  PERSONA = nuevoEmpleado('GateNombreDelSistema ' + TS, [['citas', 'read']]);
  PERSONA2 = nuevoEmpleado('GatePersonaOculta ' + TS, [['citas', 'read']]);
  const dow = new Date(F + 'T00:00:00Z').getUTCDay();
  for (const uid of [PERSONA, PERSONA2]) {
    tramoIds.push(db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('user',?,?,?,?)").run(uid, dow, 9 * 60, 14 * 60).lastInsertRowid);
  }
  tramoIds.push(db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dow, 8 * 60, 20 * 60).lastInsertRowid);

  // ── [1] APAGADA POR DEFECTO ────────────────────────────────────────────────
  console.log('\n[1] la puerta nace apagada');
  db.prepare("UPDATE company_config SET cita_pub_activa=0 WHERE id=1").run();
  {
    const anon = await paginaAnonima({ width: 390, height: 844 });
    const r1 = await anon.goto(BASE + '/reservar/' + HANDLE, { waitUntil: 'domcontentloaded' });
    ok(r1.status() === 404, 'con la puerta apagada, la dirección responde 404', String(r1.status()));
    const r2 = await anon.goto(BASE + '/reservar', { waitUntil: 'domcontentloaded' });
    ok(r2.status() === 404, 'y /reservar a secas, también', String(r2.status()));
    await anon.close();
  }

  // ── [2] LOS MANDOS DEL DUEÑO ───────────────────────────────────────────────
  console.log('\n[2] los mandos del dueño');
  const po = await paginaDe(owner.id);
  const errsAdmin = []; po.on('pageerror', e => errsAdmin.push(e.message));
  await po.goto(BASE + '/admin/citas/publica', { waitUntil: 'networkidle2' });
  await po.waitForFunction(() => window.PB && document.getElementById('pbPersonas').children.length > 0, { timeout: 10000 }).catch(() => {});
  ok(po.url().endsWith('/admin/citas/publica'), 'la pantalla "Reservas por Internet" carga', po.url());
  const apagadaEnPantalla = await po.$eval('#pbActiva', el => el.checked).catch(() => true);
  ok(apagadaEnPantalla === false, 'y la enseña APAGADA');

  const guardar = await call(po, 'POST', '/api/erp/reserva-publica/ajustes', {
    cita_pub_activa: true, cita_pub_handle: HANDLE, cita_pub_antelacion_min: 120,
    cita_pub_ventana_dias: 60, cita_pub_modo: 'auto', cita_pub_retencion_horas: 24,
    cita_pub_cancelar_horas: 24, cita_pub_cancelar_activo: true,
    cita_pub_politica: 'GATE POLITICA: avísanos con 24 horas de antelación si no puedes venir.',
    cita_pub_privacidad_url: 'https://example.com/privacidad',
    personas: [{ user_id: PERSONA, visible: true, nombre_publico: 'Ana la Peluquera' }],
  });
  ok(guardar.status === 200, 'se encienden los ajustes desde la pantalla del dueño', String(guardar.status));
  const pubS = await call(po, 'POST', '/api/erp/reserva-publica/servicio/' + S + '?publico=1');
  ok(pubS.status === 200, 'se publica UN servicio (el otro se queda privado)', String(pubS.status));
  const sinTiempo = db.prepare("INSERT INTO products (name,price,type,tax_band,status) VALUES (?,10,'service','general','active')").run('GATE Sin Config ' + TS).lastInsertRowid;
  const pubMal = await call(po, 'POST', '/api/erp/reserva-publica/servicio/' + sinTiempo + '?publico=1');
  ok(pubMal.status === 400, 'publicar un servicio SIN tiempo configurado se rechaza (400)', String(pubMal.status));
  db.prepare('DELETE FROM products WHERE id=?').run(sinTiempo);
  ok(errsAdmin.length === 0, 'la pantalla de mandos no lanza errores de JS/CSP', errsAdmin.join(' | ') || 'limpio');
  await po.screenshot({ path: join(SHOTS, 'mandos-dueno.png'), fullPage: true }).catch(() => {});

  // ── [3][4][5] MÓVIL: reservar sin sesión ───────────────────────────────────
  console.log('\n[3] móvil 390×844: reservar en 4 pasos, sin sesión');
  const movil = await paginaAnonima({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const v = await reservar(movil, { nombre: 'GATE Cliente ' + TS, movil: '600' + String(TS).slice(-6), email: 'gate' + TS + '@t.local', shot: 'movil' });

  ok(v.servicios.length === 1, 'paso 1: SOLO aparece el servicio publicado (1 de 3)', v.servicios.length + ' opción(es)');
  ok(!JSON.stringify(v.servicios).includes('Secreto'), 'el servicio NO publicado no aparece');
  ok(/24,20 €/.test(v.servicios.join(' ')), 'con el precio del catálogo e IVA incluido (20 € + 21 % = 24,20 €)', (v.servicios[0] || '').trim());
  ok(v.personas.length === 2, 'paso 2: "cualquiera disponible" + la ÚNICA persona publicada', v.personas.join(' / '));
  ok(v.personas.some(p => /Ana la Peluquera/.test(p)), 'con el nombre que puso el DUEÑO');
  ok(!v.personas.some(p => /GateNombreDelSistema|GatePersonaOculta/.test(p)), 'y NUNCA el nombre del usuario del sistema');
  ok(v.horas > 0, 'paso 3: el día ofrece huecos calculados en vivo', v.horas + ' hora(s)');
  ok(v.politicaAntesDeConfirmar === true, 'paso 4: la POLÍTICA de cancelación se ve ANTES de confirmar');
  ok(/24,20 €/.test(v.resumen || ''), 'y el resumen enseña el total con IVA antes de confirmar');
  ok(v.fin && /reservada/i.test(v.fin.texto), 'la reserva se confirma', v.fin ? v.fin.texto : (v.error || 'sin final'));
  ok(v.fin && /^\/cita\/[A-Za-z0-9_-]{20,}$/.test(v.fin.enlace), 'y entrega el ENLACE POR LLAVE que ya existía', v.fin && v.fin.enlace);
  ok(v.errores.length === 0, '0 errores JS/CSP en móvil', v.errores.join(' | ') || 'limpio');
  await movil.screenshot({ path: join(SHOTS, 'movil-fin.png'), fullPage: true }).catch(() => {});

  console.log('\n[4] cero fuga de datos');
  {
    // Se mira el HTML de la pantalla Y todo lo que viajó por la red.
    const superficie = (v.htmlPaso4 || '') + '\n' + v.red.join('\n');
    const clientes = db.prepare("SELECT name, email, movil_e164 FROM clients WHERE active=1 AND name<>'' LIMIT 40").all();
    const nombreFiltrado = clientes.find(c => c.name.length > 6 && superficie.includes(c.name));
    ok(!nombreFiltrado, 'ningún nombre de cliente del negocio viaja a la calle', nombreFiltrado ? nombreFiltrado.name : 'limpio');
    const mailFiltrado = clientes.find(c => c.email && c.email.length > 6 && superficie.includes(c.email));
    ok(!mailFiltrado, 'ningún email de cliente', mailFiltrado ? mailFiltrado.email : 'limpio');
    const telFiltrado = clientes.find(c => c.movil_e164 && c.movil_e164.length > 8 && superficie.includes(c.movil_e164));
    ok(!telFiltrado, 'ningún teléfono de cliente', telFiltrado ? telFiltrado.movil_e164 : 'limpio');
    const usuarios = db.prepare("SELECT name FROM admin_users WHERE active=1").all().map(u => u.name);
    const userFiltrado = usuarios.find(n => n.length > 5 && superficie.includes(n));
    ok(!userFiltrado, 'ningún nombre de usuario del sistema', userFiltrado || 'limpio');
    ok(!superficie.includes('Secreto'), 'ningún servicio no publicado');
    ok(!/CITA-\d{4}/.test(v.htmlPaso4 || ''), 'ningún código de cita ajena en la pantalla');
    // Y el endpoint de huecos no suelta el reparto interno del equipo. (Hay que estar EN la página:
    // un fetch desde about:blank no sale a ninguna parte.)
    const anon2 = await paginaAnonima({ width: 390, height: 844 });
    await anon2.goto(BASE + '/reservar/' + HANDLE, { waitUntil: 'domcontentloaded' });
    const h = await anon2.evaluate(async (u) => { const r = await fetch(u); return { s: r.status, t: await r.text() }; },
      '/reservar/' + HANDLE + '/huecos?fecha=' + F + '&service_ids=' + S);
    ok(h.s === 200 && !h.t.includes('user_ids'), 'el JSON de huecos no lleva user_ids (el reparto del equipo es de dentro)', h.t.slice(0, 80));
    const hPriv = await anon2.evaluate(async (u) => (await fetch(u)).status, '/reservar/' + HANDLE + '/huecos?fecha=' + F + '&service_ids=' + SPRIV);
    ok(hPriv === 404, 'pedir huecos de un servicio NO publicado → 404', String(hPriv));
    const hMal = await anon2.goto(BASE + '/reservar/handle-inventado-' + TS, { waitUntil: 'domcontentloaded' });
    ok(hMal.status() === 404, 'con un handle inventado → 404 (mismo cuerpo que la puerta cerrada)', String(hMal.status()));
    await anon2.close();
  }

  console.log('\n[5] sin consentimiento no se reserva');
  {
    const p = await paginaAnonima({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const v2 = await reservar(p, { nombre: 'GATE SinConsent ' + TS, movil: '600' + String(TS + 7).slice(-6), sinConsent: true });
    ok(!v2.fin, 'no llega a la pantalla final');
    ok(/consentimiento|casilla/i.test(v2.error || ''), 'y se le dice que marque la casilla', v2.error || '(sin mensaje)');
    ok(v2.errores.length === 0, '0 errores JS también en el camino de error', v2.errores.join(' | ') || 'limpio');
    await p.screenshot({ path: join(SHOTS, 'movil-sin-consent.png'), fullPage: true }).catch(() => {});
    await p.close();
  }

  // ── [6] LA CITA ESTÁ DENTRO ────────────────────────────────────────────────
  console.log('\n[6] la cita entra en la agenda de dentro');
  const cita = db.prepare(
    `SELECT c.*, r.email AS pub_email, r.consent_texto, r.politica_texto
       FROM citas c JOIN cita_reserva_publica r ON r.cita_id=c.id
      WHERE c.cliente_suelto_nombre LIKE ? ORDER BY c.id DESC LIMIT 1`
  ).get('GATE Cliente ' + TS + '%');
  ok(cita != null, 'la cita reservada existe en `citas`', cita ? cita.codigo : 'NO ESTÁ');
  if (cita) {
    citaIds.push(cita.id);
    ok(cita.estado === 'confirmada', 'en modo automático queda confirmada', cita.estado);
    ok(cita.user_id === PERSONA, 'asignada a la persona elegida');
    ok(cita.fecha === F, 'en el día elegido', cita.fecha);
    ok(/GATE POLITICA/.test(cita.politica_texto || ''), 'con la política archivada TAL COMO SE MOSTRÓ');
    ok(/Acepto que/.test(cita.consent_texto || ''), 'y el texto exacto del consentimiento aceptado');
    const agenda = await call(po, 'GET', '/api/erp/citas/agenda?desde=' + F + '&hasta=' + F);
    ok((agenda.body?.citas || []).some(x => x.id === cita.id), 'y el dueño la ve en su agenda del día');
  }

  // ── [7] ESCRITORIO ─────────────────────────────────────────────────────────
  console.log('\n[7] escritorio 1400×900: la misma reserva');
  {
    const esc = await paginaAnonima({ width: 1400, height: 900 });
    const v3 = await reservar(esc, { nombre: 'GATE Escritorio ' + TS, movil: '600' + String(TS + 13).slice(-6), shot: 'escritorio' });
    ok(v3.fin != null, 'la reserva funciona igual en escritorio', v3.fin ? v3.fin.texto : (v3.error || 'sin final'));
    ok(v3.errores.length === 0, '0 errores JS en escritorio', v3.errores.join(' | ') || 'limpio');
    const sinScrollH = await esc.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok(sinScrollH, 'y la página no se desborda a lo ancho');
    await esc.screenshot({ path: join(SHOTS, 'escritorio-fin.png'), fullPage: true }).catch(() => {});
    await esc.close();
    const c3 = db.prepare("SELECT id FROM citas WHERE cliente_suelto_nombre LIKE ? ORDER BY id DESC LIMIT 1").get('GATE Escritorio ' + TS + '%');
    if (c3) citaIds.push(c3.id);
  }

  // ── [8] EL ENLACE DEL CLIENTE: cambiar y anular ────────────────────────────
  console.log('\n[8] el enlace del cliente: cambiar y anular dentro de la ventana');
  if (cita) {
    const cli = await paginaAnonima({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errsCli = []; cli.on('pageerror', e => errsCli.push(e.message));
    await cli.goto(BASE + '/cita/' + cita.token, { waitUntil: 'networkidle2' });
    const html = await cli.content();
    ok(/GATE POLITICA/.test(html), 'el enlace repite la política de cancelación');
    ok(/Ana la Peluquera/.test(html) && !/GateNombreDelSistema/.test(html),
       'y enseña el nombre PÚBLICO del profesional, no el del sistema');
    ok(await cli.$('#btnCambiar') !== null, 'ofrece "Cambiar el día o la hora" (nació fuera, y falta más de 24 h)');

    // Cambiar a otra hora del mismo día.
    await cli.click('#btnCambiar');
    await cli.evaluate((f) => { document.getElementById('nvFecha').value = f; document.getElementById('nvFecha').dispatchEvent(new Event('change')); }, F);
    await cli.waitForFunction(() => { const s = document.getElementById('nvHora'); return s && s.options.length > 0 && s.options[0].value; }, { timeout: 10000 }).catch(() => {});
    const horaNueva = await cli.$eval('#nvHora', s => { s.selectedIndex = Math.min(2, s.options.length - 1); return s.options[s.selectedIndex].textContent; }).catch(() => '');
    await cli.evaluate(() => document.getElementById('nvHora').dispatchEvent(new Event('change')));
    await cli.evaluate(() => guardarCambio());
    await new Promise(r => setTimeout(r, 900));
    const tras = db.prepare('SELECT inicio_min FROM citas WHERE id=?').get(cita.id);
    ok(tras.inicio_min !== cita.inicio_min, 'cambiar la hora desde el enlace funciona', 'a ' + horaNueva);
    await cli.screenshot({ path: join(SHOTS, 'enlace-cliente.png'), fullPage: true }).catch(() => {});

    // Anular.
    await cli.evaluate(() => anular());
    await new Promise(r => setTimeout(r, 900));
    ok(db.prepare('SELECT estado FROM citas WHERE id=?').get(cita.id).estado === 'anulada', 'anular desde el enlace funciona');
    // Tarea 2 · cabo 4: por este camino no se le pregunta a nadie quién anula — se sabe por dónde
    // ha entrado. Aquí se comprueba entero: navegador → ruta pública → base de datos.
    ok(db.prepare('SELECT anulada_por FROM citas WHERE id=?').get(cita.id).anulada_por === 'cliente',
       'y queda registrada como anulada por el CLIENTE, sin preguntárselo');
    ok(errsCli.length === 0, '0 errores JS en el enlace del cliente', errsCli.join(' | ') || 'limpio');
    await cli.close();
  }

  // ── [9] PERMISOS DE LOS MANDOS ─────────────────────────────────────────────
  console.log('\n[9] permisos de los mandos');
  {
    const soloRead = nuevoEmpleado('GateReservaRead ' + TS, [['citas', 'read']]);
    const pr = await paginaDe(soloRead);
    const rv = await pr.goto(BASE + '/admin/citas/publica', { waitUntil: 'networkidle2' });
    ok(rv.status() === 403, 'con citas.read pero sin citas.edit: la pantalla de mandos → 403', String(rv.status()));
    await pr.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
    const post = await call(pr, 'POST', '/api/erp/reserva-publica/ajustes', {
      cita_pub_activa: false, cita_pub_handle: 'x', cita_pub_antelacion_min: 0, cita_pub_ventana_dias: 1,
      cita_pub_modo: 'auto', cita_pub_retencion_horas: 1, cita_pub_cancelar_horas: 0,
      cita_pub_cancelar_activo: false, cita_pub_politica: '', cita_pub_privacidad_url: '', personas: [],
    });
    ok(post.status === 403, 'y cambiar los ajustes por la API → 403', String(post.status));
    const svc = await call(pr, 'POST', '/api/erp/reserva-publica/servicio/' + S + '?publico=0');
    ok(svc.status === 403, 'y publicar/retirar un servicio → 403', String(svc.status));
    await pr.close();
  }

  await browser.close();
} catch (e) {
  console.error('ERROR', e.stack || e.message); fail++;
  try { await browser.close(); } catch {}
} finally {
  // ── Limpieza: sin residuo de negocio y con los ajustes del tenant como estaban ──
  for (const t of tokens) { try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t); } catch {} }
  for (const id of citaIds) {
    try { db.prepare('DELETE FROM cita_reserva_publica WHERE cita_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM cita_servicios WHERE cita_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM cita_avisos WHERE cita_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM citas WHERE id=?').run(id); } catch {}
  }
  for (const id of tramoIds) { try { db.prepare('DELETE FROM horario_tramos WHERE id=?').run(id); } catch {} }
  for (const pid of [S, SPRIV]) { try { if (pid) { db.prepare('DELETE FROM service_config WHERE product_id=?').run(pid); db.prepare('DELETE FROM products WHERE id=?').run(pid); } } catch {} }
  for (const id of emps) {
    try { db.prepare('DELETE FROM cita_pub_personas WHERE user_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM admin_users WHERE id=?').run(id); } catch {}
  }
  try {
    const a = AJUSTES_PREVIOS || {};
    db.prepare(
      `UPDATE company_config SET cita_pub_activa=?, cita_pub_handle=?, cita_pub_antelacion_min=?,
         cita_pub_ventana_dias=?, cita_pub_modo=?, cita_pub_retencion_horas=?, cita_pub_cancelar_horas=?,
         cita_pub_cancelar_activo=?, cita_pub_politica=?, cita_pub_privacidad_url=? WHERE id=1`
    ).run(a.cita_pub_activa ?? 0, a.cita_pub_handle ?? '', a.cita_pub_antelacion_min ?? 120,
          a.cita_pub_ventana_dias ?? 60, a.cita_pub_modo ?? 'auto', a.cita_pub_retencion_horas ?? 24,
          a.cita_pub_cancelar_horas ?? 24, a.cita_pub_cancelar_activo ?? 1, a.cita_pub_politica ?? '',
          a.cita_pub_privacidad_url ?? '');
  } catch {}
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===  (capturas en ' + SHOTS + ')');
process.exit(fail ? 1 : 0);
