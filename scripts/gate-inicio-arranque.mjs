// ════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — EL INICIO DE UN NEGOCIO QUE ARRANCA. Tarea TRANSVERSAL (el puntero del peldaño 8 NO se mueve).
//
// LO QUE ESTE GATE EXISTE PARA IMPEDIR son tres cosas concretas que estaban pasando:
//   1. Que el panel de arranque y la rejilla del Inicio COMPITAN. Antes, mientras faltara un paso la
//      rejilla no se pintaba, y en cuanto se completaban el panel desaparecía para siempre. Un dueño
//      nuevo no veía nunca su Inicio, y uno rodado no podía volver a lo que dejó a medias.
//   2. Que un paso se pueda marcar A MANO. Todo se deriva del estado real: no hay endpoint para
//      marcar nada, y este gate lo comprueba haciendo la acción de verdad y viendo la casilla cambiar.
//   3. Que «te quedan N horas libres» sea un número inventado. Sin horario el motor abre de 8 a 21
//      todos los días, así que el bloque «Hoy» solo existe donde hay agenda y lo dice cuando falta.
//
//   node scripts/gate-inicio-arranque.mjs
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
import { pasosDe, estadoArranque, trabajaConCitas } from '../modules/erp/arranque.js';
import { datosHoy, fabricaDe, bloqueAplica, bloquesDisponibles, NATIVOS } from '../modules/erp/inicio-layout.js';
import { ocupacionDia, huecosQueSePierden } from '../modules/erp/vigia-agenda.js';
import { agendaData } from '../modules/erp/routes/citas.js';

const RID = randomBytes(3).toString('hex');
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SINK = 'delivered@resend.dev';           // buzón sumidero de Resend: el envío es REAL, no llega a nadie
const dormir = ms => new Promise(r => setTimeout(r, ms));
const HOY = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { if (c) { pass++; console.log('  ✓ ' + m + (x ? ' — ' + x : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (x ? ' — ' + x : '')); } };
const tenants = [];
function limpiar() {
  for (const { slug, db } of tenants) {
    try { if (db) db.close(); } catch {}
    const t = getTenantBySlug(slug);
    if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
    controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
    if (t) { const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename);
      for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} } }
  }
}
let browser = null;

async function nuevoNegocio(nombre, oficio) {
  const r = randomBytes(3).toString('hex');
  const alta = await provisionTenant({ businessName: nombre + ' ' + r, ownerName: 'Dueña ' + r,
    email: 'ga-' + r + '@bamburu.test', password: 'Gate.Ar.' + r + '!', phone: '+34 600 000 000' });
  const t = getTenantBySlug(alta.slug);
  const db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename));
  tenants.push({ slug: alta.slug, db });
  if (oficio) fijarOficio(db, oficio);
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();
  const now = Math.floor(Date.now() / 1000), tok = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, now, now + 3600, csrf);
  return { slug: alta.slug, db, owner, tok, csrf, base: 'http://' + alta.slug + '.localhost:3000' };
}

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] UN NEGOCIO RECIÉN CREADO NO VE EL INICIO EN BLANCO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const N = await nuevoNegocio('Peluquería Arranque', 'peluqueria');
  browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: N.tok, domain: N.slug + '.localhost', path: '/' });
  const irInicio = async () => { await page.goto(N.base + '/admin', { waitUntil: 'networkidle0' }); await dormir(2000); };
  await irInicio();

  const v1 = await page.evaluate(() => ({
    panel: !!document.querySelector('.onb-card'),
    anillo: (document.querySelector('.onb-ring-n') || {}).textContent || '',
    bloques: [...document.querySelectorAll('.onb-bloque h4')].map(x => x.textContent),
    rejilla: !!document.getElementById('inicioGrid'),
    bloquesRejilla: [...document.querySelectorAll('.ig-block')].length,
    cuadro: !!document.getElementById('cmNumeros'),
  }));
  ok(v1.panel, 'el panel «Pon en marcha tu negocio» aparece en un negocio recién creado');
  ok(/^0\//.test(v1.anillo), 'con el progreso a 0', v1.anillo);
  ok(v1.bloques.length === 3, 'y sus tres bloques con título', v1.bloques.join(' · '));
  // 20-ago-2026 · EL CUADRO DE MANDO. La rejilla de fábrica ya no trae tres bloques: sus «Cifras del
  // negocio», «Hoy en la agenda» y «Vigía de DISA» pasaron ARRIBA, fijos, y duplicarlos en la rejilla
  // era enseñar la misma cifra dos veces. De fábrica queda «Avisos pendientes». Lo que este gate
  // protege NO cambia —que el panel de arranque no APAGUE el Inicio—, así que se comprueba eso: la
  // rejilla está y pinta, y además el cuadro de mando está.
  ok(v1.rejilla && v1.bloquesRejilla >= 1,
     'Y LA REJILLA SE PINTA IGUAL: el panel no la apaga (antes sí lo hacía)', v1.bloquesRejilla + ' bloques');
  ok(v1.cuadro, 'y el cuadro de mando del día se pinta con ella, no en su lugar');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] CADA PASO SE MARCA SOLO AL HACER LA ACCIÓN REAL. NINGUNO A MANO.');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const est = () => estadoArranque(N.db);
  const e0 = est();
  ok(Object.values(e0).every(v => v === false || v === true), 'el estado son booleanos derivados, no banderas guardadas');
  const marca = (clave, hacer, comoSeLlama) => {
    const antes = est()[clave];
    hacer();
    const despues = est()[clave];
    ok(antes === false && despues === true, comoSeLlama, antes + ' → ' + despues);
  };
  marca('fiscal', () => N.db.prepare("UPDATE company_config SET fiscal_id='B12345678' WHERE id=1").run(),
        'poner el NIF marca «tus datos fiscales»');
  marca('aspecto', () => N.db.prepare("UPDATE company_config SET logo_url='https://x/logo.png' WHERE id=1").run(),
        'poner el logo marca «el aspecto de tus facturas»');
  marca('cliente', () => N.db.prepare("INSERT INTO clients (name,active,created_at) VALUES ('Cliente Uno',1,datetime('now'))").run(),
        'crear un cliente marca «tu primer cliente»');
  marca('horario', () => { const ins = N.db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)");
                           for (let d = 1; d <= 5; d++) ins.run(d, 9 * 60, 18 * 60); },
        'poner el horario marca «cuándo abres»');
  // OJO: sembrar el catálogo NO basta, y está bien que no baste. La semilla de oficio crea los
  // servicios con DURACIÓN pero a PRECIO 0 a propósito («las fuentes publican duraciones, no
  // precios»). El paso pide las dos cosas, así que solo se marca cuando el dueño pone el precio —
  // que es exactamente para lo que existe el paso.
  sembrarCatalogo(N.db, 'peluqueria', (d, i) => createProductSvc(d, i));
  ok(est().servicios === false, 'sembrar el catálogo NO marca «tus servicios»: falta el precio, que lo pone el dueño');
  marca('servicios', () => N.db.prepare("UPDATE products SET price=25 WHERE id IN (SELECT product_id FROM service_config)").run(),
        'y ponerles precio SÍ lo marca');
  marca('equipo', () => N.db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Ayudante',?,'x','employee',1,0,datetime('now'))").run('ay-' + RID + '@bamburu.test'),
        'dar de alta a alguien marca «tu equipo»');
  marca('reservas', () => N.db.prepare('UPDATE company_config SET cita_pub_activa=1 WHERE id=1').run(),
        'encender la página de reservas marca su paso');
  marca('recordatorios', () => N.db.prepare("UPDATE company_config SET cita_modo_recordatorio='auto_email' WHERE id=1").run(),
        'encender los recordatorios marca su paso');
  marca('margen', () => N.db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('margen_modo_elegido','1')").run(),
        'contestar cómo cuentas tu margen marca su paso');

  // NINGÚN ENDPOINT PARA MARCAR: se prueba a la fuerza que no existe esa puerta.
  const intentos = await page.evaluate(async () => {
    const out = [];
    for (const u of ['/api/erp/inicio/arranque', '/api/erp/inicio/arranque/fiscal', '/api/erp/inicio/arranque/paso']) {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
                                 body: JSON.stringify({ paso: 'factura', done: true }) });
      out.push(u + ':' + r.status);
    }
    return out;
  });
  ok(intentos.every(x => !/:(200|201)$/.test(x)), 'no existe NINGÚN endpoint para marcar un paso a mano', intentos.join(' · '));
  ok(est().factura === false, 'y «tu primera factura» sigue sin marcar porque no se ha emitido ninguna');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3-4] SE PLIEGA SOLO AL TERMINAR, SIGUE ACCESIBLE, Y EL PLIEGUE SE RECUERDA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Falta la factura y la migración: se hacen por su camino real.
  const api = (m, u, b) => page.evaluate(async (m, u, b) => {
    try { return await window.api(m, u, b); } catch (e) { return { __err: e.message }; }
  }, m, u, b);
  await page.goto(N.base + '/admin/clients', { waitUntil: 'networkidle0' });
  const cliId = N.db.prepare('SELECT id FROM clients LIMIT 1').get().id;
  const rf = await api('POST', '/api/erp/invoices', { client_id: cliId, issue_date: HOY,
    lines: [{ description: 'Corte', quantity: 1, unit_price: 30, tax_rate: 21 }] });
  ok(!rf.__err && est().factura === true, 'emitir una factura de verdad marca «tu primera factura»', rf.__err || 'marcado');

  N.db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('migracion_buzon',?)").run(SINK);
  const mig1 = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('origen', 'holded'); fd.append('quiere', 'clientes,facturas');
    fd.append('comentario', 'Sin fichero todavía');
    const r = await fetch('/api/erp/migracion', { method: 'POST', headers: { 'x-csrf-token': window.CSRF_TOKEN }, body: fd });
    return { status: r.status, json: await r.json() };
  });
  ok(mig1.status === 200 && est().migracion === true, 'pedir la migración marca «trae tus datos»', 'HTTP ' + mig1.status);

  const p2 = pasosDe(N.db, { existe: () => true });
  ok(p2.completo, 'con todo hecho, el panel se da por completo', p2.hechos + '/' + p2.total);
  await irInicio();
  const v3 = await page.evaluate(() => ({
    plegado: !!document.querySelector('.onb-plegado'),
    abierto: !!document.querySelector('.onb-card'),
    texto: (document.querySelector('.onb-plegado') || {}).textContent || '',
  }));
  ok(v3.plegado && !v3.abierto, 'y se pliega SOLO, sin que nadie lo toque');
  ok(/Pon en marcha tu negocio/.test(v3.texto) && /todo hecho/.test(v3.texto),
     'pero NO desaparece: queda una línea con su progreso', v3.texto.replace(/\s+/g, ' ').trim());
  await irInicio();
  ok(await page.evaluate(() => !!document.querySelector('.onb-plegado')), 'al recargar, sigue plegado');

  // Desplegar a mano y que se recuerde.
  await page.evaluate(() => document.querySelector('[data-onb-toggle]').click());
  await dormir(900);
  ok(await page.evaluate(() => !!document.querySelector('.onb-card')), 'se despliega a mano de un clic');
  await irInicio();
  ok(await page.evaluate(() => !!document.querySelector('.onb-card')),
     'y al recargar SIGUE desplegado: la elección se recuerda por usuario');
  const pref = N.db.prepare("SELECT blocks FROM dashboard_layouts WHERE scope=?").get('arranque:usuario:' + N.owner.id);
  ok(!!pref && /"plegado":false/.test(pref.blocks), 'guardado por USUARIO en la tabla de preferencias que ya existía',
     pref ? pref.blocks : '(nada)');
  await page.evaluate(() => document.querySelector('[data-onb-toggle]').click());
  await dormir(900);
  await irInicio();
  ok(await page.evaluate(() => !!document.querySelector('.onb-plegado')), 'y volver a plegarlo también se recuerda');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5-6] PELUQUERÍA Y ASESORÍA DAN LISTAS DISTINTAS, Y NINGÚN PASO DESAPARECE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const A = await nuevoNegocio('Asesoría Arranque', 'asesoria');
  const P = await nuevoNegocio('Peluquería Lista', 'peluqueria');
  const lista = d => pasosDe(d, { existe: () => true });
  const lp = lista(P.db), la = lista(A.db);
  const clavesDe = r => r.bloques.flatMap(b => b.pasos.map(p => p.key));
  ok(trabajaConCitas(P.db) && !trabajaConCitas(A.db),
     'la peluquería trabaja con cita y la asesoría no, según el perfil de oficio que YA existía');
  ok(JSON.stringify(clavesDe(lp)) !== JSON.stringify(clavesDe(la)),
     'y sus listas de pasos son DISTINTAS', 'peluquería: ' + clavesDe(lp).length + ' · asesoría: ' + clavesDe(la).length);
  ok(la.extra.length > 0 && clavesDe(la).length + la.extra.length === lp.total,
     'NINGÚN paso desaparece en la asesoría: los que no aplican están en «Más opciones»',
     la.extra.map(p => p.key).join(', '));
  ok(la.extra.every(p => p.porque), 'y cada uno dice por qué está ahí', la.extra[0]?.porque || '');
  const enExtra = new Set(la.extra.map(p => p.key));
  ok(['servicios', 'horario', 'reservas', 'recordatorios'].every(k => enExtra.has(k)),
     'son exactamente los de agenda', [...enExtra].join(', '));

  // [6] Ni un 404: todas las URLs de los pasos responden.
  const urls = [...new Set([...lp.bloques.flatMap(b => b.pasos.map(p => p.href)), ...lp.extra.map(p => p.href)])];
  const codigos = [];
  for (const u of urls) {
    const r = await page.evaluate(async u => (await fetch(u, { redirect: 'manual' })).status, u);
    codigos.push(u + ':' + r);
  }
  ok(codigos.every(x => /:200$/.test(x)), 'TODAS las URLs de los pasos responden 200. Ni un 404',
     codigos.join(' · '));
  // Y un paso cuyo destino no existe NO se pinta.
  const sinDestino = pasosDe(P.db, { existe: h => h !== '/admin/migracion' });
  ok(!clavesDe(sinDestino).includes('migracion') && !sinDestino.extra.some(p => p.key === 'migracion'),
     'y si un destino no existiera, ese paso no se pintaría', 'probado quitando /admin/migracion');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] «HOY»: LAS CIFRAS SON LAS DEL MOTOR, CONTRASTADAS POR OTRO CAMINO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const insT = P.db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)");
  for (let d = 0; d <= 6; d++) insT.run(d, 9 * 60, 18 * 60);
  sembrarCatalogo(P.db, 'peluqueria', (d, i) => createProductSvc(d, i));
  const cliP = P.db.prepare("INSERT INTO clients (name,active,created_at) VALUES ('Marta Hoy',1,datetime('now'))").run().lastInsertRowid;
  const insC = P.db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,archived,created_at,updated_at) VALUES (?,?,?,?,?,?,0,'confirmada',0,datetime('now'),datetime('now'))");
  [[600, 30], [660, 60], [780, 45]].forEach(([ini, dur], i) => insC.run('C' + RID + i, cliP, P.owner.id, HOY, ini, dur));

  const h = datosHoy(P.db, { puede: () => true, fecha: HOY });
  const porElMotor = agendaData(P.db, { desde: HOY, hasta: HOY }).citas.length;
  const oc = ocupacionDia(P.db, HOY);
  ok(h.n === porElMotor && h.n === 3,
     'las citas de «Hoy» son las MISMAS que sirve la vista día de la agenda', h.n + ' = ' + porElMotor);
  ok(h.libre_min === oc.libre_min,
     'y las horas libres, las MISMAS que alimentan el aviso de huecos del vigía', h.libre_min + ' = ' + oc.libre_min + ' min');
  ok(h.citas.every((c, i) => i === 0 || c.hora >= h.citas[i - 1].hora), 'las citas salen en orden de hora',
     h.citas.map(c => c.hora).join(' · '));
  ok(h.citas.every(c => c.cliente && c.persona && c.estado),
     'con cliente, quién la atiende y estado', JSON.stringify(h.citas[0]));
  ok(h.sin_horario === false, 'y con el horario puesto, no avisa de que falte');
  // El mismo `ocupacionDia` es el que usa el detector: se contrasta por SU camino, no por el mío.
  const delVigia = huecosQueSePierden(P.db, HOY);
  ok(Array.isArray(delVigia), 'el detector de huecos corre sobre las mismas piezas', delVigia.length + ' días avisados');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[8-9] SIN AGENDA NO EXISTE, Y SIN PERMISO NO VIAJA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(!bloqueAplica(A.db, 'hoy'), 'un negocio SIN agenda no tiene el bloque «Hoy»');
  ok(!fabricaDe(A.db).some(b => b.tipo === 'hoy'), 'ni en su Inicio de fábrica',
     fabricaDe(A.db).map(b => b.tipo).join(', '));
  ok(!bloquesDisponibles(A.db, A.owner.id, () => true).nativos.some(n => n.tipo === 'hoy'),
     'NI EN LA PALETA: no se le ofrece siquiera');
  // 20-ago-2026 · EL CUADRO DE MANDO. «Hoy» ya no viene en la rejilla de FÁBRICA porque ahora es un
  // bloque FIJO del Inicio, arriba del todo (lo comprueba gate-inicio-cuadro-mando). Lo que sigue
  // vivo aquí, y es lo que protege esta línea, es que a un negocio CON agenda sí se le ofrece.
  ok(bloqueAplica(P.db, 'hoy')
     && bloquesDisponibles(P.db, P.owner.id, () => true).nativos.some(n => n.tipo === 'hoy'),
     'y al que sí lleva agenda se le ofrece en la paleta',
     bloquesDisponibles(P.db, P.owner.id, () => true).nativos.map(n => n.tipo).join(', '));
  ok(NATIVOS.hoy.perm === 'citas.read', 'el bloque exige `citas.read`');
  ok(datosHoy(P.db, { puede: p => p !== 'citas.read', fecha: HOY }) === null,
     'y sin ese permiso el dato NO SE CALCULA siquiera: no es que se esconda, es que no llega');

  // Un empleado sin citas.read, de verdad, contra el servidor.
  const permisos = [['clients', 'read']];
  const uid = P.db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Sin Citas',?,'x','employee',1,0,datetime('now'))")
    .run('sc-' + RID + '@bamburu.test').lastInsertRowid;
  for (const [mod, acc] of permisos) {
    const perm = P.db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, acc);
    if (perm) P.db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(uid, perm.id);
  }
  const nowS = Math.floor(Date.now() / 1000), tokS = randomBytes(32).toString('base64url');
  P.db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tokS, uid, nowS, nowS + 3600, randomBytes(32).toString('base64url'));
  const ctx = await browser.createBrowserContext();
  const pe = await ctx.newPage();
  await pe.setViewport({ width: 1440, height: 1000 });
  await pe.setCookie({ name: 'asess', value: tokS, domain: P.slug + '.localhost', path: '/' });
  await pe.goto(P.base + '/admin', { waitUntil: 'networkidle0' });
  await dormir(2000);
  const ve = await pe.evaluate(async () => {
    const datos = await (await fetch('/api/erp/inicio/datos')).json();
    const cit = await fetch('/api/erp/citas/agenda?desde=2026-01-01&hasta=2026-01-01');
    return { hoyEnPantalla: !!document.querySelector('.ig-hoy'),
             hoyEnDatos: datos.hoy, agenda: cit.status,
             paleta: (await (await fetch('/api/erp/inicio/bloques')).json()).nativos.map(n => n.tipo) };
  });
  ok(!ve.hoyEnPantalla, 'quien no ve citas no ve el bloque «Hoy» en su Inicio');
  ok(ve.hoyEnDatos === null || ve.hoyEnDatos === undefined,
     'y el dato NO VIAJA a su navegador', JSON.stringify(ve.hoyEnDatos));
  ok(!ve.paleta.includes('hoy'), 'ni se lo ofrece la paleta', ve.paleta.join(', '));
  ok(ve.agenda === 403, 'y forzar la ruta de la agenda a mano da 403', 'HTTP ' + ve.agenda);
  await ctx.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[10] MIGRACIÓN ASISTIDA: CON FICHERO Y SIN FICHERO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const antesMig = N.db.prepare('SELECT COUNT(*) n FROM migracion_peticiones').get().n;
  const mig2 = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('origen', 'otro'); fd.append('origen_otro', 'Un programa viejo');
    fd.append('quiere', 'clientes,productos');
    fd.append('comentario', 'Solo los activos');
    fd.append('fichero', new Blob(['nombre;nif\nAna;12345678Z\n'], { type: 'text/csv' }), 'clientes.csv');
    const r = await fetch('/api/erp/migracion', { method: 'POST', headers: { 'x-csrf-token': window.CSRF_TOKEN }, body: fd });
    return { status: r.status, json: await r.json() };
  });
  ok(mig2.status === 200 && mig2.json.con_fichero, 'se puede pedir CON fichero', 'HTTP ' + mig2.status);
  const filas = N.db.prepare('SELECT * FROM migracion_peticiones ORDER BY id').all();
  ok(filas.length === antesMig + 1, 'y queda su registro en la tabla', filas.length + ' peticiones');
  const conF = filas[filas.length - 1], sinF = filas[0];
  ok(sinF.fichero === null && conF.fichero === 'clientes.csv',
     'una sin fichero y otra con él, cada una como se pidió', (sinF.fichero || 'sin fichero') + ' / ' + conF.fichero);
  ok(conF.origen === 'otro' && conF.origen_otro === 'Un programa viejo' && conF.quiere === 'clientes,productos',
     'con de dónde viene y qué quiere traer', conF.origen_otro + ' · ' + conF.quiere);
  ok(conF.email_ok === 1 && sinF.email_ok === 1,
     'y el correo al equipo SALIÓ de verdad (al buzón sumidero, no a una persona)',
     'email_ok=' + conF.email_ok);
  // El acuse en pantalla y lo que dice la pantalla sobre quién migra.
  await page.goto(N.base + '/admin/migracion', { waitUntil: 'networkidle0' });
  await dormir(1200);
  const txtMig = await page.evaluate(() => document.body.innerText);
  ok(/la hacemos nosotros|equipo de Bamburu/i.test(txtMig) && /gratis/i.test(txtMig),
     'la pantalla dice que la migración la hace el equipo de Bamburu y es gratis');
  ok(!/import(ador|ación) autom|autom[áa]tic/i.test(txtMig),
     'y NO insinúa un importador automático que no existe');
  ok(await page.evaluate(() => document.querySelectorAll('#mgLista > div').length) >= 2,
     'y las peticiones ya hechas se ven, para que no parezcan perdidas');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[11] A 390 px: NI SCROLL HORIZONTAL NI TEXTO PEGADO AL BORDE, EN LAS DOS PANTALLAS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const medir = async (url) => {
    await page.setViewport({ width: 390, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await dormir(2200);
    return page.evaluate(() => {
      const AIRE = 6, sale = [], pegado = [];
      // Las CAJAS son las que DIBUJAN un marco. `.onb-step` es una fila sin fondo ni borde: su
      // «borde» no existe para el que mira, y exigirle aire sería inventarse un requisito.
      const CAJAS = '.onb-card, .onb-plegado, .ig-block, .mg-caja, .disa-card-main';
      const enScroller = el => { let n = el; while (n && n !== document.body) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; n = n.parentElement; } return false; };
      for (const caja of document.querySelectorAll(CAJAS)) {
        if (caja.querySelector(CAJAS)) continue;
        const rc = caja.getBoundingClientRect(); if (!rc.width) continue;
        for (const el of caja.querySelectorAll('*')) {
          if (el.children.length) continue;
          const txt = (el.textContent || '').trim(); if (!txt) continue;
          if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) continue;
          if (enScroller(el)) continue;
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
          const cls = (el.className || el.tagName).toString().slice(0, 20) + ' en ' + (caja.className || caja.tagName).toString().slice(0, 20);
          if (r.right > rc.right + 0.5 || r.left < rc.left - 0.5) { sale.push({ t: txt.slice(0, 26), cls }); continue; }
          const holgura = Math.min(r.left - rc.left, rc.right - r.right);
          if (holgura < AIRE) pegado.push({ t: txt.slice(0, 26), cls, holgura: Math.round(holgura) });
        }
      }
      return { sale, pegado, scrollH: document.documentElement.scrollWidth > window.innerWidth };
    });
  };
  for (const [nombre, url] of [['el Inicio', N.base + '/admin'], ['la pantalla de migración', N.base + '/admin/migracion']]) {
    const m = await medir(url);
    ok(!m.scrollH, 'a 390 px, ' + nombre + ' no hace scroll horizontal');
    ok(m.sale.length === 0, 'a 390 px, en ' + nombre + ' ningún texto se sale de su caja',
       m.sale.length ? JSON.stringify(m.sale.slice(0, 3)) : 'medido');
    ok(m.pegado.length === 0, 'a 390 px, en ' + nombre + ' ninguno toca el borde',
       m.pegado.length ? JSON.stringify(m.pegado.slice(0, 3)) : 'aire suficiente');
  }
  await page.setViewport({ width: 1440, height: 1000 });

  ok(errs.length === 0, 'cero errores de JavaScript en toda la sesión', errs.join(' | ') || 'ninguno');

} catch (e) {
  fail++;
  console.error('\n✗ EL GATE HA REVENTADO: ' + (e && e.stack || e));
} finally {
  try { if (browser) await browser.close(); } catch {}
  limpiar();
  console.log('  ✓ negocios de prueba eliminados');
}

console.log('\n═════════ RESULTADO: ' + pass + ' OK · ' + fail + ' fallos ═════════');
process.exit(fail ? 1 : 0);
