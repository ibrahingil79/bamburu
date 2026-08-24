// PERFIL DE OFICIO — Gate de NAVEGADOR (Escalera · paso 8), contra el servidor real.
//   node scripts/gate-oficio-pantalla.mjs
//
// QUÉ MIDE:
//   [1] «Nueva cita» con VARIAS personas: CUATRO campos delante (cliente · servicio · día y hora · con quién).
//   [2] «Nueva cita» con UNA sola persona: TRES campos; el de persona NO se pinta y la cita se le asigna sola.
//   [3] NADA desapareció: puesto, proyecto, nota y avisar siguen alcanzables desde «Más opciones».
//   [4] El panel del HUECO sigue pidiendo DOS cosas (Agenda Sencilla intacta: persona y hora se heredan).
//   [5] El vocabulario del oficio llega a la pantalla Y al menú, desde la MISMA fuente.
//   [6] 0 errores JS, en móvil (390×844) y escritorio (1400×900).
// No deja residuo: restaura el oficio, las palabras de los puestos y los usuarios que desactiva.
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR, autoAceptarPaneles } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { unlinkSync } from 'fs';

const BASE = 'http://desarrollo-bamburu.localhost:3000', HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const TS = Date.now();
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 LIMIT 1").get();
const tok = 'gof-' + TS, now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(tok, owner.id, now, now + 3600, 'x');

// Estado previo, para devolverlo TAL CUAL al terminar.
const CFG0 = db.prepare('SELECT oficio, cita_puesto_sing, cita_puesto_plural FROM company_config WHERE id=1').get();
const OTROS = db.prepare('SELECT id FROM admin_users WHERE active=1 AND id<>?').all(owner.id).map(r => r.id);
let apagados = [], SVC = 0, RECURSO = 0, b, slugPropio = null;

// Cuántos campos se ven DELANTE (sin abrir "Más opciones"), y cuáles.
// ── UN NEGOCIO PROPIO, DE UNA SOLA PERSONA ──────────────────────────────────────────────────────
// POR QUÉ EXISTE ESTO. El paso [2] necesita un negocio con UNA sola persona activa. Antes lo
// conseguía APAGANDO a todas las demás del negocio de desarrollo… que comparten los 84 gates: se
// dejaba el negocio cambiado mientras corría, cualquiera que necesitara personas activas se lo
// encontraba tocado, y a él le llenaban la agenda o le movían el horario. Cayó en el barrido en
// distintas franjas y acabó DECLARADO como «corre solo», que es esconder el problema subiendo el
// tiempo del barrido. La causa se arregla aquí: un negocio recién dado de alta **nace con una sola
// persona**, así que no hay nada que apagar. Y al no tocar a nadie, el gate vuelve a correr en
// compañía.
async function negocioDeUnaPersona() {
  const { provisionTenant } = await import('../core/tenant-provisioning.js');
  const r = await provisionTenant({
    businessName: 'GOF Solo ' + TS, ownerName: 'Persona Única',
    email: 'gof-solo-' + TS + '@t.local', password: 'contrasena-larga-123',
    country: 'ES', sector: 'peluquería', oficio: 'peluqueria',
  });
  const d = new Database(join(APP_DIR, r.db_filename));
  const own = d.prepare('SELECT id FROM admin_users WHERE active=1').get();
  // Horario de negocio de lunes a viernes, para que haya huecos con los que crear la cita.
  for (const dow of [1, 2, 3, 4, 5]) {
    d.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dow, 9 * 60, 18 * 60);
  }
  // Un servicio reservable suyo.
  const svc = d.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,20,'service','general',21,'active')")
    .run('GOF Servicio Solo ' + TS).lastInsertRowid;
  d.prepare('INSERT INTO service_config (product_id,reservable,duracion_min,margen_min) VALUES (?,1,30,0)').run(svc);
  const t = 'gof-solo-' + TS;
  const n = Math.floor(Date.now() / 1000);
  d.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(t, own.id, n, n + 7200, 'csrf-' + TS);
  return { slug: r.slug, db: d, ownerId: own.id, tok: t, svc,
           base: 'http://' + r.slug + '.localhost:3000', host: r.slug + '.localhost' };
}

const visibles = p => p.evaluate(() => {
  const vis = el => !!el && el.offsetParent !== null;
  const dentroDeMas = el => !!(el && el.closest('#cMas'));
  const out = [];
  if (vis(document.getElementById('cBusca'))) out.push('cliente');
  if (vis(document.getElementById('cServicios'))) out.push('servicio');
  if (vis(document.getElementById('cCuando'))) out.push('cuando');
  if (vis(document.getElementById('cQuien'))) out.push('quien');
  return { campos: out, personaDentroDeMas: dentroDeMas(document.getElementById('cPersona')) };
});

try {
  SVC = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,20,'service','general',21,'active')").run('GOF Servicio ' + TS).lastInsertRowid;
  db.prepare('INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min) VALUES (?,1,30,0,0,0)').run(SVC);

  b = await puppeteer.launch(launchOpts());
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  // "Cero errores de JavaScript" = excepciones de la página + errores que ESCRIBE nuestro JS. Un
  // recurso que no carga NO es un error de JavaScript: /favicon.ico devuelve 404 en toda la app desde
  // antes de esta pieza (comprobado en /admin/clients, que no toca este trabajo), y contarlo aquí
  // convertiría el gate en un detector de ruido ajeno.
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) return;
    errs.push('console: ' + t);
  });
  p.on('dialog', d => d.accept().catch(() => {}));
  // Y el panel que sustituyó a esas ventanitas: se acepta igual que se aceptaba el confirm().
  await autoAceptarPaneles(p);
  await p.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/' });
  await p.evaluateOnNewDocument(() => { try { localStorage.removeItem('agPrefs'); } catch (e) {} });

  const abrirNueva = async () => {
    await p.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
    await p.waitForFunction(() => typeof openNuevaCita === 'function', { timeout: 8000 });
    await p.evaluate(() => openNuevaCita());
    await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open') && document.querySelectorAll('.csvc').length > 0, { timeout: 8000 });
  };

  // ── [1] VARIAS personas → CUATRO campos ────────────────────────────────────
  console.log('\n[1] «Nueva cita» con VARIAS personas → CUATRO campos');
  const nPersonas = db.prepare('SELECT COUNT(*) n FROM admin_users WHERE active=1').get().n;
  ok(nPersonas > 1, 'el tenant tiene varias personas activas (' + nPersonas + ')');
  await abrirNueva();
  let v = await visibles(p);
  ok(v.campos.length === 4, 'se ven CUATRO campos delante: ' + v.campos.join(' · '));
  ok(v.campos.join(',') === 'cliente,servicio,cuando,quien', 'y en el orden del encargo: quién · qué · cuándo · con quién');

  // ── [3] Nada desapareció ───────────────────────────────────────────────────
  console.log('\n[3] nada desapareció: sigue TODO, detrás de «Más opciones»');
  const mas = await p.evaluate(() => {
    const d = document.getElementById('cMas');
    const abierto0 = d.open;
    d.open = true;
    const dentro = id => !!(document.getElementById(id) && document.getElementById(id).closest('#cMas'));
    const r = { cerradoDeEntrada: !abierto0, recurso: dentro('cRecurso'), proyecto: dentro('cProyecto'), nota: dentro('cNota'), avisar: dentro('cAvisar') };
    d.open = abierto0;
    return r;
  });
  ok(mas.cerradoDeEntrada, '«Más opciones» viene cerrado de entrada');
  ok(mas.recurso && mas.proyecto && mas.nota && mas.avisar, 'puesto, proyecto, nota y avisar siguen ahí dentro (nada se eliminó)');

  // ── [4] El panel del HUECO no se tocó ──────────────────────────────────────
  console.log('\n[4] el panel del HUECO sigue pidiendo DOS cosas (Agenda Sencilla intacta)');
  await p.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => document.querySelectorAll('.agcell[data-col]').length > 0, { timeout: 8000 });
  await p.evaluate(() => { const c = document.querySelector('.agcell[data-col]:not([data-col=""])[data-min="660"]'); if (c) c.click(); });
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  v = await visibles(p);
  ok(v.campos.length === 2 && v.campos.join(',') === 'cliente,servicio', 'desde el hueco se piden DOS: ' + v.campos.join(' · '));
  const ctx = await p.$eval('#cContexto', e => e.textContent.trim());
  ok(ctx.split('·').length === 3, 'y la persona/día/hora se heredan del hueco, en la línea de contexto: «' + ctx + '»');

  // ── [2] UNA sola persona → TRES campos, y se asigna sola ───────────────────
  // TODO ESTE PASO CORRE EN UN NEGOCIO PROPIO, recién dado de alta, que nace con UNA sola persona.
  // Antes apagaba a todas las del negocio de desarrollo, que comparten los 84 gates: esa era la
  // causa de que se pisara con los demás y de que acabara declarado «corre solo». Aquí no se apaga
  // a nadie y no se toca nada de nadie, así que el gate vuelve a correr en compañía.
  console.log('\n[2] «Nueva cita» con UNA sola persona → TRES campos (en negocio propio)');
  const solo = await negocioDeUnaPersona();
  slugPropio = solo.slug;
  ok(solo.db.prepare('SELECT COUNT(*) n FROM admin_users WHERE active=1').get().n === 1,
     'el negocio propio nace con una sola persona activa: no hay que apagar a nadie');

  const p2 = await b.newPage();
  await p2.setViewport({ width: 1280, height: 900 });
  await p2.setCookie({ name: 'asess', value: solo.tok, domain: solo.host, path: '/' });
  const abrirNuevaEn2 = async () => {
    await p2.goto(solo.base + '/admin/citas', { waitUntil: 'networkidle2' });
    await p2.waitForFunction(() => typeof openNuevaCita === 'function', { timeout: 8000 });
    await p2.evaluate(() => openNuevaCita());
    await p2.waitForFunction(() => document.getElementById('mCita').classList.contains('open') && document.querySelectorAll('.csvc').length > 0, { timeout: 8000 });
  };
  await abrirNuevaEn2();
  v = await visibles(p2);
  ok(v.campos.length === 3, 'se ven TRES campos delante: ' + v.campos.join(' · '));
  ok(!v.campos.includes('quien'), 'el campo de persona NO se pinta');
  ok(!v.personaDentroDeMas, '…y tampoco se ha escondido dentro de «Más opciones»: sigue en el panel, oculto');
  const asignada = await p2.evaluate(() => document.getElementById('cPersona').value);
  ok(String(asignada) === String(solo.ownerId), 'la única persona queda preseleccionada: la cita se le asigna sola');

  // Y se puede crear la cita de verdad con esos tres campos. El día se busca abierto: en un negocio
  // recién nacido no hay ni una cita, así que no hace falta buscarlo «libre» — no hay nadie más.
  let DIA2 = null;
  for (let d = 1; d <= 14 && !DIA2; d++) {
    const f = new Date(Date.now() + d * 86400000);
    if ([1, 2, 3, 4, 5].includes(f.getUTCDay())) DIA2 = f.toISOString().slice(0, 10);
  }
  const creada = await p2.evaluate(async (svc, dia) => {
    document.getElementById('cBusca').value = 'GOF Cliente';
    document.getElementById('cNuevoNombre').textContent = 'GOF Cliente';
    cUsarNuevo();
    const cb = document.querySelector('.csvc[value="' + svc + '"]');
    if (!cb) return { ok: false, motivo: 'el servicio del gate no sale en el panel' };
    cb.checked = true; await cServChange();
    const fecha = document.getElementById('cFecha');
    if (fecha) { fecha.value = dia; await cRecalc(); }
    await new Promise(r => setTimeout(r, 700));
    const sel = document.getElementById('cHueco');
    const opt = [...sel.options].find(o => o.value !== '');
    if (!opt) return { ok: false, motivo: 'sin huecos · fecha=' + (fecha ? fecha.value : '?') + ' · opciones=' + sel.options.length };
    sel.value = opt.value; await cSugerir();
    await cGuardar();
    await new Promise(r => setTimeout(r, 800));
    return { ok: !document.getElementById('mCita').classList.contains('open') };
  }, solo.svc, DIA2);
  ok(creada.ok, 'se crea la cita con solo esos tres campos' + (creada.motivo ? ' (' + creada.motivo + ')' : ''));
  const citaNueva = solo.db.prepare("SELECT id,user_id FROM citas WHERE cliente_suelto_nombre='GOF Cliente' ORDER BY id DESC LIMIT 1").get();
  ok(citaNueva != null && String(citaNueva.user_id) === String(solo.ownerId), 'y queda guardada a nombre de esa persona');
  await p2.close();

  // ── [5] El vocabulario del oficio, en pantalla y en el menú ────────────────
  console.log('\n[5] el vocabulario del oficio llega a la pantalla Y al menú');
  db.prepare("UPDATE company_config SET oficio='salud', cita_puesto_sing='Sala', cita_puesto_plural='Salas' WHERE id=1").run();
  // ── EL GATE SE TRAE SU PROPIO PUESTO ──────────────────────────────────────────────────────────
  // POR QUÉ. La aserción de abajo comprueba que el MENÚ llama a los puestos como los llama la
  // pantalla («Salas»). Pero la entrada del menú es CONDICIONAL desde el 18 ago (`siHay: 'puestos'`
  // en menu.js: existe si hay algún recurso activo o algún servicio que exija uno). El tenant de
  // desarrollo no tiene ninguno, así que la entrada no se pintaba y el gate leía «» — llevaba en
  // rojo desde entonces sin que nadie lo viera, porque estaba FUERA del barrido. Es el argumento
  // entero de esta tarea en un solo caso: una comprobación que nadie ejecuta acaba mintiendo.
  //
  // LA ASERCIÓN NO CAMBIA: sigue siendo «el menú dice Salas». Lo que cambia es que el gate deja de
  // depender de que el negocio tenga puestos por casualidad y se trae el suyo, con nombre único, y
  // lo borra al salir. Mismo patrón que `productoDePrueba` en los gates de compras.
  RECURSO = db.prepare("INSERT INTO recursos (nombre,tipo,active) VALUES (?,'otro',1)").run('GATE Puesto ' + TS).lastInsertRowid;
  await abrirNueva();
  const voz = await p.evaluate(() => ({
    etiqueta: [...document.querySelectorAll('#mCita .form-label')].map(l => l.textContent.trim())[0],
    win: window.CLIENTE_SING,
  }));
  ok(/Paciente/.test(voz.etiqueta), 'la pantalla dice «Paciente»: «' + voz.etiqueta + '»');
  ok(voz.win === 'Paciente', 'y el JS de la pantalla recibe la misma palabra');

  // ── LA SEGUNDA CAUSA DEL ROJO: LA ENTRADA SE MUDÓ, Y EL GATE SEGUÍA MIRANDO DONDE ESTABA ──────
  // Esta línea buscaba el enlace en la pantalla de la agenda. El 18 ago 2026 (`921bbe1`, «en Agenda
  // solo vive lo que se usa atendiendo clientes») las seis entradas de configuración se mudaron a la
  // configuración del negocio, MISMA RUTA y MISMOS PERMISOS, otro sitio. Así que aquí ya no hay nada
  // que encontrar: comprobado sirviendo las dos pantallas con un puesto dado de alta —
  // /admin/citas → 0 enlaces, /admin/settings → 1.
  //
  // LA ASERCIÓN NO CAMBIA, ni se relaja: sigue exigiendo que el MENÚ diga «Salas», la misma palabra
  // que la pantalla. Lo único que se corrige es DÓNDE se mira, que es una caducidad del gate y no una
  // decisión de producto. Es lo mismo que se hizo con `gate-avisos-badge` cuando el Inicio cambió:
  // buscar por el DESTINO, que es lo que de verdad protege, y no por el sitio de ayer.
  await p.goto(BASE + '/admin/settings', { waitUntil: 'networkidle2' });
  const menu = await p.evaluate(() =>
    [...document.querySelectorAll('a[href="/admin/citas/recursos"]')].map(a => a.textContent.trim()).join(''));
  ok(/Salas/.test(menu), 'el MENÚ dice «Salas» — misma fuente que la pantalla: «' + menu + '»');

  db.prepare("UPDATE company_config SET oficio='otro', cita_puesto_sing='Puesto', cita_puesto_plural='Puestos' WHERE id=1").run();
  await abrirNueva();
  const voz2 = await p.evaluate(() => ({ etiqueta: [...document.querySelectorAll('#mCita .form-label')].map(l => l.textContent.trim())[0], win: window.CLIENTE_SING }));
  ok(/Cliente/.test(voz2.etiqueta) && voz2.win === 'Cliente', 'al volver a «Otro», vuelve a decir «Cliente» (nada se queda pegado)');

  // ── [6] Móvil ──────────────────────────────────────────────────────────────
  // TAMBIÉN EN EL NEGOCIO PROPIO: lo que este paso comprueba es que con UNA sola persona el móvil
  // sigue pidiendo tres campos, así que necesita el mismo negocio de una persona que el paso [2].
  // Con el de desarrollo veía cuatro campos, y con razón: allí hay varias personas.
  console.log('\n[6] móvil 390×844 (en el negocio propio, que es el de una sola persona)');
  const p6 = await b.newPage();
  await p6.setViewport({ width: 390, height: 844, isMobile: true });
  await p6.setCookie({ name: 'asess', value: solo.tok, domain: solo.host, path: '/' });
  await p6.goto(solo.base + '/admin/citas', { waitUntil: 'networkidle2' });
  await p6.waitForFunction(() => typeof openNuevaCita === 'function', { timeout: 8000 });
  await p6.evaluate(() => openNuevaCita());
  await p6.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  v = await visibles(p6);
  ok(v.campos.length === 3, 'en móvil, con una persona, siguen siendo TRES campos: ' + v.campos.join(' · '));
  const desborda = await p6.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok(!desborda, 'el panel no desborda a lo ancho en móvil');
  await p6.close();

  // ── [7] Cambiar de oficio desde los ajustes del negocio ────────────────────
  console.log('\n[7] cambiar de oficio desde «Datos del negocio»');
  await p.setViewport({ width: 1400, height: 900 });
  await p.goto(BASE + '/admin/settings', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => document.querySelectorAll('#cOficio option').length > 0, { timeout: 8000 });
  const opciones = await p.$$eval('#cOficio option', os => os.map(o => o.value));
  ok(opciones.length === 6, 'el selector ofrece los SEIS oficios: ' + opciones.join(', '));
  ok(await p.$eval('#cOficio', s => s.value) === 'otro', 'arranca en el oficio actual del negocio («otro»)');

  // Cambiarlo NO siembra: solo cambia palabras y OFRECE los que faltan.
  await p.evaluate(() => { const s = document.getElementById('cOficio'); s.value = 'asesoria'; s.dispatchEvent(new Event('change')); });
  await p.waitForFunction(() => /faltan/i.test(document.getElementById('oficioFaltan').textContent), { timeout: 8000 });
  ok(db.prepare('SELECT oficio o FROM company_config WHERE id=1').get().o === 'asesoria', 'el oficio queda guardado al cambiar el selector');
  const antesSembrar = db.prepare("SELECT COUNT(*) n FROM products WHERE type='service'").get().n;
  const aviso = await p.$eval('#oficioFaltan', e => e.textContent.trim());
  ok(/4/.test(aviso) && /Declaración de la Renta/.test(aviso), 'ofrece los 4 de asesoría, con sus duraciones: «' + aviso.slice(0, 90) + '…»');
  ok(db.prepare("SELECT COUNT(*) n FROM products WHERE type='service'").get().n === antesSembrar,
    'cambiar el selector NO ha creado ni un servicio (sembrar es otro botón)');

  // Y el botón añade SOLO los que faltan.
  await p.evaluate(() => document.getElementById('btnSembrar').click());
  await p.waitForFunction(() => /Ya tienes todos/i.test(document.getElementById('oficioFaltan').textContent), { timeout: 10000 });
  const sembrados = db.prepare("SELECT id,name FROM products WHERE name IN ('Declaración de la Renta','Alta de autónomo','Consulta laboral','Constitución de sociedad')").all();
  ok(sembrados.length === 4, 'el botón añade los 4 que faltaban');
  ok(db.prepare("SELECT COUNT(*) n FROM products WHERE type='service'").get().n === antesSembrar + 4,
    'y se SUMAN a los que ya había (' + antesSembrar + ' → ' + (antesSembrar + 4) + '): no pisa nada');
  for (const s of sembrados) { db.prepare('DELETE FROM service_config WHERE product_id=?').run(s.id); db.prepare('DELETE FROM products WHERE id=?').run(s.id); }

  console.log('\n[8] errores de JavaScript');
  ok(errs.length === 0, '0 errores JS en móvil y escritorio', errs.slice(0, 3).join(' | '));
} catch (e) {
  fail++; console.error('\n  ✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  // Devolver el tenant a como estaba, pase lo que pase.
  try { for (const id of apagados) db.prepare('UPDATE admin_users SET active=1 WHERE id=?').run(id); } catch {}
  // EL NEGOCIO DE MENTIRA SE BORRA. Se da de alta por el camino real y se retira por el mismo sitio
  // que los demás gates que se traen el suyo: fila de `tenants` y sus ficheros. Si no, cada pasada
  // del barrido dejaría un negocio más en la máquina.
  if (slugPropio) {
    try {
      const control = new Database(join(APP_DIR, 'data/control.db'));
      const t = control.prepare('SELECT db_filename FROM tenants WHERE slug=?').get(slugPropio);
      control.prepare('DELETE FROM tenants WHERE slug=?').run(slugPropio);
      control.close();
      if (t) for (const suf of ['', '-wal', '-shm']) {
        try { unlinkSync(join(APP_DIR, t.db_filename + suf)); } catch {}
      }
    } catch {}
  }
  try { db.prepare('UPDATE company_config SET oficio=?, cita_puesto_sing=?, cita_puesto_plural=? WHERE id=1').run(CFG0.oficio, CFG0.cita_puesto_sing, CFG0.cita_puesto_plural); } catch {}
  try { if (SVC) { db.prepare('DELETE FROM service_config WHERE product_id=?').run(SVC); db.prepare('DELETE FROM products WHERE id=?').run(SVC); } } catch {}
  try { if (RECURSO) db.prepare('DELETE FROM recursos WHERE id=?').run(RECURSO); } catch {}
  try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok); } catch {}
  try { db.close(); } catch {}
  try { if (b) await b.close(); } catch {}
}

console.log('\n──────────────────────────────');
console.log('  ' + pass + ' OK · ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
