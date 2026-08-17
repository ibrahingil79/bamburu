// Gate — EL VIGÍA APRENDE DE AGENDA. Escalera · peldaño 8 · PIEZA 3.
//
// Contra el servidor REAL y sobre un negocio CREADO DESDE CERO (y borrado al final). La primera
// prueba es la que manda y es la del encargo: negocio nuevo → elegir oficio → poner citas → ver los
// avisos nuevos en /admin/vigia y asomando en el Inicio. Sin trucos y sin datos precargados.
//
// LA COMPROBACIÓN QUE DE VERDAD IMPORTA es la [2]: las horas libres que dice el aviso tienen que ser
// IDÉNTICAS AL MINUTO a las que enseña la agenda de ese día. Y no se comprueba contra sí mismo: se
// contrasta con `/api/erp/citas/mes`, que es OTRO camino de código (routes/citas.js) llegando al mismo
// número por su cuenta. Si algún día uno de los dos se desvía, este gate se pone rojo.
//
//   node scripts/gate-vigia-agenda.mjs
import puppeteer from 'puppeteer';
import path from 'path';
import { unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { launchOpts } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { fijarOficio, sembrarCatalogo } from '../modules/erp/oficios.js';
import { createProductSvc } from '../modules/erp/routes/products.js';
import { hoyLocal } from '../modules/erp/avisos.js';

const RID = randomBytes(3).toString('hex');
const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOY = hoyLocal();
const DIA = 86400000;
const masDias = n => new Date(Date.parse(HOY + 'T00:00:00Z') + n * DIA).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); }
};

let slug = null, db = null, browser = null;
function limpiar() {
  try { if (db) db.close(); } catch {}
  if (!slug) return;
  const t = getTenantBySlug(slug);
  if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
  }
}

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] DE CERO — negocio nuevo, oficio, citas, y los avisos apareciendo');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const alta = await provisionTenant({
    businessName: 'Gate Vigia Agenda ' + RID, ownerName: 'Dueña Gate',
    email: 'delivered@resend.dev', password: 'Gate.Vigia.' + RID + '!', phone: '+34 600 000 000',
  });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  ok(!!t, 'negocio creado desde cero', slug);
  const dbPath = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
  db = new Database(dbPath);
  const BASE = 'http://' + slug + '.localhost:3000';
  const DOMAIN = slug + '.localhost';

  // ── ANTES DE NADA: un negocio que no usa agenda tiene que CALLAR ──────────────────────────────
  // Se comprueba aquí, con el negocio recién nacido (sin horario y sin citas), porque es el estado en
  // el que vive la mayoría: si los detectores hablasen ahora, hablarían para todos los que no usan
  // agenda. Y hablarían mucho: sin horario el motor abre TODOS los días de 8:00 a 21:00.
  const { detectar } = await import('../modules/erp/vigia.js');
  const AGENDA = ['hueco_perdido', 'fuera_de_ritmo', 'sin_proxima_cita', 'ausencias'];
  const deAgenda = res => res.hallazgos.filter(h => AGENDA.includes(h.detector));
  ok(deAgenda(detectar(db, { hoy: HOY })).length === 0,
     'negocio recién creado (sin horario y sin citas): los cuatro detectores CALLAN');

  // ── Elegir oficio, como en el alta real ───────────────────────────────────────────────────────
  fijarOficio(db, 'peluqueria');
  const creados = sembrarCatalogo(db, 'peluqueria', (d, input) => createProductSvc(d, input));
  ok(creados.length > 0, 'oficio "peluquería" elegido y su catálogo sembrado', creados.length + ' servicios');
  const servicio = db.prepare(
    `SELECT p.id, p.name, sc.duracion_min FROM products p JOIN service_config sc ON sc.product_id=p.id
      WHERE sc.reservable=1 ORDER BY p.id LIMIT 1`).get();
  ok(!!servicio, 'hay un servicio reservable del catálogo del oficio', servicio && servicio.name);

  // ── Horario real: lunes a domingo, 9:00–17:00 (8 h) ───────────────────────────────────────────
  const insTramo = db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)");
  for (let dow = 0; dow <= 6; dow++) insTramo.run(dow, 9 * 60, 17 * 60);
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();

  // ── Clientes y citas ──────────────────────────────────────────────────────────────────────────
  const nuevoCliente = nombre => db.prepare("INSERT INTO clients (name,active) VALUES (?,1)").run(nombre).lastInsertRowid;
  const insCita = db.prepare(
    `INSERT INTO citas (cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,token,archived)
     VALUES (?,?,?,?,?,0,?,?,0)`);
  const insSvc = db.prepare(
    `INSERT INTO cita_servicios (cita_id,product_id,orden,offset_min,dur_min,muerto_ini_min,muerto_dur_min)
     VALUES (?,?,0,0,?,0,0)`);
  const ponCita = (cliente, fecha, inicio, estado, dur = 60) => {
    const id = insCita.run(cliente, owner.id, fecha, inicio, dur, estado, randomBytes(12).toString('base64url')).lastInsertRowid;
    insSvc.run(id, servicio.id, dur);
    return id;
  };

  // Cliente RITMO: viene cada 35 días (5 semanas), 4 visitas, la última hace 28 días → DENTRO de su
  // ritmo (35 × 1,5 = 52,5 → umbral 53). No debe generar aviso todavía.
  const cliRitmo = nuevoCliente('Clienta de ritmo');
  for (const d of [133, 98, 63, 28]) ponCita(cliRitmo, masDias(-d), 9 * 60, 'atendida');

  // Cliente DOS CITAS: solo dos visitas, la última hace 300 días. Con menos de 3 no se inventa ritmo.
  const cliDos = nuevoCliente('Clienta de dos citas');
  for (const d of [400, 300]) ponCita(cliDos, masDias(-d), 10 * 60, 'atendida');

  // Cliente RECIENTE: atendido hace 2 días y sin cita futura → detector C.
  const cliReciente = nuevoCliente('Cliente de ayer');
  ponCita(cliReciente, masDias(-2), 11 * 60, 'atendida');

  // Cliente CON PRÓXIMA: atendido hace 2 días PERO con cita futura → NO debe salir en C.
  const cliConProxima = nuevoCliente('Cliente que ya reservó');
  ponCita(cliConProxima, masDias(-2), 12 * 60, 'atendida');
  ponCita(cliConProxima, masDias(+10), 12 * 60, 'confirmada');

  // Cliente AUSENTE: faltó hace 5 días → detector D.
  const cliAusente = nuevoCliente('Cliente que no vino');
  ponCita(cliAusente, masDias(-5), 13 * 60, 'no_show');

  // ── Los avisos, ya de verdad ──────────────────────────────────────────────────────────────────
  const res1 = detectar(db, { hoy: HOY });
  const porDet = k => res1.hallazgos.filter(h => h.detector === k);
  ok(porDet('hueco_perdido').length > 0, 'el negocio con agenda YA genera avisos de hueco',
     porDet('hueco_perdido').length + ' días');
  ok(porDet('sin_proxima_cita').some(h => h.ref.client_id === cliReciente),
     'C: el cliente atendido hace 2 días y sin cita futura sale avisado');
  ok(!porDet('sin_proxima_cita').some(h => h.ref.client_id === cliConProxima),
     'C: el que YA dejó su próxima cita NO sale');
  ok(porDet('ausencias').some(h => h.ref.client_id === cliAusente),
     'D: el que faltó sale avisado (el estado no_show existe: se lee, no se deduce)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] LAS CIFRAS CUADRAN CON LA PANTALLA — al minuto');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(token, owner.id, now, now + 3600, csrf);
  const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
  const apiGet = async u => (await fetch(BASE + u, { headers: HJ })).json();

  // El MISMO día, por dos caminos distintos: el aviso del vigía y la vista de mes de la agenda.
  const aviso = porDet('hueco_perdido')[0];
  const ym = aviso.fecha.slice(0, 7);
  const mes = await apiGet('/api/erp/citas/mes?ym=' + ym);
  const diaMes = (mes.dias || []).find(d => d.fecha === aviso.fecha);
  ok(!!diaMes, 'la agenda conoce ese mismo día', aviso.fecha);
  const { ocupacionDia } = await import('../modules/erp/vigia-agenda.js');
  const oc = ocupacionDia(db, aviso.fecha);
  ok(diaMes && oc.libre_min === diaMes.libres_min,
     'las horas libres del aviso son IDÉNTICAS AL MINUTO a las de la agenda',
     'vigía ' + oc.libre_min + ' min · agenda ' + diaMes.libres_min + ' min');
  ok(Math.abs(aviso.cifra - oc.libre_min / 60) < 0.06,
     'y la cifra del aviso son esas mismas horas', aviso.cifra + ' h');
  ok(/\d{2}:\d{2}–\d{2}:\d{2}/.test(aviso.ref.tramos || ''),
     'el aviso dice los TRAMOS concretos, no solo un total', aviso.ref.tramos);

  // Un día con una cita larga baja el hueco: la cifra sigue al dato, no a un número guardado.
  const diaPrueba = aviso.fecha;
  const libreAntes = oc.libre_min;
  const citaTapon = ponCita(cliReciente, diaPrueba, 9 * 60, 'confirmada', 120);
  const libreDespues = ocupacionDia(db, diaPrueba).libre_min;
  ok(libreDespues === libreAntes - 120, 'meter una cita de 2 h resta exactamente 120 min de hueco',
     libreAntes + ' → ' + libreDespues);
  db.prepare('DELETE FROM cita_servicios WHERE cita_id=?').run(citaTapon);
  db.prepare('DELETE FROM citas WHERE id=?').run(citaTapon);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] EL RITMO SE APRENDE, NO SE INVENTA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(!porDet('fuera_de_ritmo').some(h => h.ref.client_id === cliRitmo),
     'viene cada 5 semanas y lleva 4: NO hay aviso (va dentro de su ritmo)');
  ok(!porDet('fuera_de_ritmo').some(h => h.ref.client_id === cliDos),
     'con solo 2 visitas NUNCA hay aviso, lleve lo que lleve sin venir');

  // Se le mueve la última visita a hace 56 días (8 semanas) → ahora sí pasa su umbral de 53.
  const ultimaRitmo = db.prepare(
    'SELECT id FROM citas WHERE cliente_id=? ORDER BY fecha DESC LIMIT 1').get(cliRitmo).id;
  db.prepare('UPDATE citas SET fecha=? WHERE id=?').run(masDias(-56), ultimaRitmo);
  const res2 = detectar(db, { hoy: HOY });
  const ritmoAviso = res2.hallazgos.find(h => h.detector === 'fuera_de_ritmo' && h.ref.client_id === cliRitmo);
  ok(!!ritmoAviso, 'a las 8 semanas SÍ salta el aviso');
  ok(ritmoAviso && ritmoAviso.ref.ritmo_dias === 35, 'y dice su ritmo REAL, aprendido de sus visitas',
     ritmoAviso && ('cada ' + ritmoAviso.ref.ritmo_dias + ' días'));
  ok(ritmoAviso && ritmoAviso.ref.dias_sin_venir === 56, 'y cuántos lleva', ritmoAviso && (ritmoAviso.ref.dias_sin_venir + ' días'));
  ok(ritmoAviso && !!ritmoAviso.ref.ultimo_servicio, 'y qué servicio hizo la última vez',
     ritmoAviso && ritmoAviso.ref.ultimo_servicio);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] NADIE RECIBE DOS AVISOS QUE DIGAN LO MISMO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Se le pone al cliente del ritmo una factura vieja: sin la cesión de jurisdicción, el detector de
  // FACTURAS (cliente_dormido) también lo marcaría, y el dueño leería dos avisos del mismo cliente.
  const { createInvoice } = await import('../modules/erp/routes/invoices.js');
  createInvoice(db, { client_id: cliRitmo, issue_date: masDias(-200),
    lines: [{ description: 'Corte', quantity: 1, unit_price: 20, tax_rate: 21 }] });
  const res3 = detectar(db, { hoy: HOY });
  const enRitmo = res3.hallazgos.filter(h => h.detector === 'fuera_de_ritmo').map(h => h.ref.client_id);
  const enDormido = res3.hallazgos.filter(h => h.detector === 'cliente_dormido').map(h => h.ref.client_id);
  ok(enRitmo.includes(cliRitmo), 'el cliente con historial de citas sale por el detector de CITAS');
  ok(!enDormido.includes(cliRitmo), 'y NO sale además como "cliente que se duerme"');
  ok(enRitmo.filter(id => enDormido.includes(id)).length === 0,
     'ningún cliente aparece en los dos detectores a la vez',
     'citas ' + enRitmo.length + ' · facturas ' + enDormido.length);

  // El que compra SIN pedir cita sigue vigilado por el detector viejo: la cesión no lo desactiva.
  const cliMostrador = nuevoCliente('Cliente de mostrador');
  createInvoice(db, { client_id: cliMostrador, issue_date: masDias(-400),
    lines: [{ description: 'Producto', quantity: 1, unit_price: 30, tax_rate: 21 }] });
  createInvoice(db, { client_id: cliMostrador, issue_date: masDias(-300),
    lines: [{ description: 'Producto', quantity: 1, unit_price: 30, tax_rate: 21 }] });
  const res4 = detectar(db, { hoy: HOY });
  ok(res4.hallazgos.some(h => h.detector === 'cliente_dormido' && h.ref.client_id === cliMostrador),
     'el que compra sin pedir cita SIGUE vigilado por el detector de facturas (no se apagó nada)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] PRIORIDAD Y ORDEN');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const avisos = await apiGet('/api/erp/vigia/avisos');
  const lista = avisos.avisos || [];
  const grupoDeDet = k => (lista.find(a => a.detector === k) || {}).prioridad?.grupo;
  ok(grupoDeDet('hueco_perdido') === 'alta', 'el hueco que se pierde va en ALTA (caduca)', grupoDeDet('hueco_perdido'));
  ok(grupoDeDet('sin_proxima_cita') === 'media', 'los otros de agenda van en MEDIA', grupoDeDet('sin_proxima_cita'));
  ok(lista.every(a => a.detector !== 'hueco_perdido' || a.moneda === false),
     'ningún aviso de agenda lleva importe en euros: no se estima dinero que nadie ha ganado');

  const huecos = lista.filter(a => a.detector === 'hueco_perdido');
  const fechasHuecos = huecos.map(a => a.fecha);
  ok(fechasHuecos.length < 2 || fechasHuecos.every((f, i) => i === 0 || fechasHuecos[i - 1] <= f),
     'los huecos salen ordenados por PROXIMIDAD: lo de antes, arriba', fechasHuecos.join(' → '));
  const idxDeuda = lista.findIndex(a => a.moneda === true && a.prioridad.grupo === 'alta');
  const idxHueco = lista.findIndex(a => a.detector === 'hueco_perdido');
  ok(idxDeuda === -1 || idxHueco === -1 || idxDeuda < idxHueco,
     'dentro de ALTA, primero lo que tiene importe y después la agenda');

  // El gráfico: no hay área de citas en el constructor y se DICE, no se calla.
  const conGap = lista.find(a => a.detector === 'hueco_perdido');
  ok(conGap && conGap.grafico && conGap.grafico.gap && /área de agenda/i.test(conGap.grafico.gap),
     'el aviso va sin gráfico y explica por qué (el constructor no tiene área de agenda)',
     conGap && conGap.grafico && (conGap.grafico.gap || '').slice(0, 60));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] PERMISOS — quien no ve la agenda, no ve estos avisos');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const empleadaId = db.prepare(
    "INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run('Empleada Gate', 'emp+' + RID + '@resend.dev', 'x').lastInsertRowid;
  const dar = (uid, mod, act) => {
    const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act);
    if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id);
  };
  dar(empleadaId, 'analytics', 'read');     // puede entrar al vigía…
  dar(empleadaId, 'clients', 'read');       // …y ver clientes, pero NO la agenda

  const tokenEmp = randomBytes(32).toString('base64url');
  const csrfEmp = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tokenEmp, empleadaId, now, now + 3600, csrfEmp);
  const HE = { 'Cookie': 'asess=' + tokenEmp, 'Content-Type': 'application/json', 'x-csrf-token': csrfEmp };

  const avisosEmp = await (await fetch(BASE + '/api/erp/vigia/avisos', { headers: HE })).json();
  const suyos = avisosEmp.avisos || [];
  ok(suyos.every(a => !AGENDA.includes(a.detector)), 'sin citas.read no recibe NI UNO de los cuatro avisos de agenda');
  ok(JSON.stringify(suyos).indexOf('libres en la agenda') === -1, 'ni se le cuela por el texto de otro aviso');
  ok((avisosEmp.sinPermiso || []).some(s => s.key === 'hueco_perdido'),
     'y se le DICE que hay detectores que no puede ver, en vez de dejar un hueco mudo');

  const forzado = await fetch(BASE + '/api/erp/vigia/avisos?detector=hueco_perdido', { headers: HE });
  ok(forzado.status === 403, 'forzar el detector por URL da 403', 'status ' + forzado.status);
  const forzadoHall = await fetch(BASE + '/api/erp/vigia/hallazgos?detector=fuera_de_ritmo', { headers: HE });
  ok(forzadoHall.status === 403, 'y por la vía de hallazgos, también', 'status ' + forzadoHall.status);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] LA PANTALLA — /admin/vigia y el Inicio');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // El Inicio de un negocio recién nacido NO enseña la rejilla: enseña el onboarding de tres pasos
  // (U6), y el bloque del vigía aparece cuando esos pasos están hechos. No es un fallo, es la
  // bienvenida del dueño — así que aquí se termina de dar de alta el negocio (NIF; cliente y factura
  // ya existen de los pasos anteriores) y el Inicio pasa a ser el de un negocio en marcha.
  db.prepare("UPDATE company_config SET fiscal_id='B12345678' WHERE id=1").run();

  browser = await puppeteer.launch({ ...launchOpts() });
  const page = await browser.newPage();
  const erroresJs = [], url404 = [];
  page.on('response', r => { if (r.status() === 404) url404.push(r.url()); });
  page.on('pageerror', e => erroresJs.push(String(e.message || e)));
  // Un 404 de /favicon.ico no es un error de JavaScript: lo emite el navegador en CUALQUIER pantalla
  // del panel y es anterior a esta pieza. El mensaje de consola NO trae la URL, así que se contrasta
  // con las respuestas 404 observadas: si todas son el favicon, es ruido de fondo, no un fallo.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon\.ico/.test(t)) return;
    if (/Failed to load resource/.test(t) && url404.length && url404.every(u => /favicon\.ico/.test(u))) return;
    erroresJs.push('console: ' + t);
  });
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });

  await page.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => /Agenda|agenda/.test(document.body.textContent), { timeout: 20000, polling: 300 });
  const txtVigia = await page.evaluate(() => document.body.textContent);
  ok(/horas libres|h libres/.test(txtVigia), 'el aviso de hueco se ve en /admin/vigia');
  ok(/sin dejar (la )?(otra|siguiente) cita|no dejó otra cita/.test(txtVigia), 'y el de "se fue sin próxima cita" también');
  ok(/Agenda/.test(txtVigia), 'etiquetados como área "Agenda"');
  await page.screenshot({ path: '/tmp/vigia-agenda-pantalla.png', fullPage: true });

  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  // El bloque del vigía del Inicio se rellena por fetch DESPUÉS de pintar la rejilla: hay que esperar
  // a que llegue su contenido, no a que exista la tarjeta (esa está desde el primer frame).
  await page.waitForFunction(
    () => document.querySelectorAll('.dh-vigia-row').length > 0
       || /Nada que te avise/.test(document.body.textContent),
    { timeout: 20000, polling: 300 }).catch(() => {});
  const txtInicio = await page.evaluate(() => document.body.textContent);
  ok(/h libres|sin dejar|no dejó otra cita|no se presentó|sin venir/i.test(txtInicio),
     'y asoman en el Inicio, por el bloque del vigía que ya existía');
  await page.screenshot({ path: '/tmp/vigia-agenda-inicio.png', fullPage: true });

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.goto(BASE + '/admin/vigia', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => /Agenda/.test(document.body.textContent), { timeout: 20000, polling: 300 });
  ok(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 2), 'móvil (390px): no desborda a lo ancho');
  ok(erroresJs.length === 0, 'CERO errores de JavaScript', erroresJs.slice(0, 2).join(' | ') || 'limpio');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[8] NO SE ESCRIBE NADA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Los detectores son de solo lectura. Se comprueba de la forma que no admite discusión: foto de las
  // tablas que tocan ANTES y DESPUÉS de un barrido completo.
  const foto = () => JSON.stringify({
    citas: db.prepare('SELECT COUNT(*) n, COALESCE(SUM(inicio_min),0) s FROM citas').get(),
    clientes: db.prepare('SELECT COUNT(*) n FROM clients').get(),
    servicios: db.prepare('SELECT COUNT(*) n FROM cita_servicios').get(),
    horario: db.prepare('SELECT COUNT(*) n FROM horario_tramos').get(),
  });
  const antes = foto();
  detectar(db, { hoy: HOY });
  detectar(db, { hoy: HOY });
  ok(foto() === antes, 'dos barridos completos no cambian ni una fila de citas, clientes o horarios');

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  try { if (browser) await browser.close(); } catch {}
  console.log('\n[limpieza] borrando el negocio de prueba: ' + slug);
  limpiar();
  console.log('  ✓ negocio de prueba eliminado');
}

console.log('\n═════════ RESULTADO: ' + pass + ' OK · ' + fail + ' fallos ═════════');
process.exit(fail ? 1 : 0);
