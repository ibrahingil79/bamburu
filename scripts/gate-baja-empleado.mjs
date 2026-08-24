#!/usr/bin/env node
//
// gate-baja-empleado.mjs — DAR DE BAJA A ALGUIEN DEL EQUIPO, pulsando los botones de verdad.
//
// DE DÓNDE SALE. El 24 ago 2026 el dueño dijo «no se pueden borrar empleados». Medido en un
// navegador con su sesión: el botón «Eliminar» estaba y funcionaba con un empleado SIN ningún
// permiso; **con un solo permiso devolvía HTTP 500 «Ha ocurrido un error, inténtalo de nuevo» y el
// usuario seguía ahí**, porque `user_permissions` tiene clave ajena y nadie la soltaba. Como
// cualquier empleado útil tiene permisos, en la práctica no se podía dar de baja a ninguno.
//
// QUÉ SE EXIGE AHORA, y se prueba PULSANDO, no llamando a la API por debajo:
//   · Sin rastro → se BORRA, con confirmación.
//   · Con rastro → se ARCHIVA: pierde el acceso al momento, se va de las listas y los desplegables,
//     y su rastro queda intacto.
//   · La pantalla DICE cuál de las dos va a pasar y POR QUÉ, antes de pulsar.
//   · Se puede RECUPERAR.
//   · Y la sesión de esa persona cae en su siguiente clic.
//
//   node scripts/gate-baja-empleado.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { join } from 'path';
import puppeteer from 'puppeteer-core';
import { tenantDb, launchOpts, APP_DIR, autoAceptarPaneles } from './lib/gate-env.mjs';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com';
const BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'ZZ Baja ' + RID;
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'baja-shots');
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
import { mkdirSync } from 'fs';
try { mkdirSync(SHOTS, { recursive: true }); } catch {}

const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay dueño activo'); process.exit(2); }
const ahora = Math.floor(Date.now() / 1000);
const tokenDuenyo = 'zz-baja-' + randomBytes(20).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tokenDuenyo, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

const creados = [];
function crearEmpleado(sufijo, conPermiso) {
  const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run(MARCA + ' ' + sufijo, 'zz-baja-' + sufijo + '-' + RID + '@bamburu.test', 'x').lastInsertRowid;
  creados.push(id);
  if (conPermiso) {
    const p = db.prepare("SELECT id FROM permissions WHERE module='citas' AND action='read'").get();
    if (p) db.prepare('INSERT INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(id, p.id);
  }
  return id;
}
const existe = id => db.prepare('SELECT COUNT(*) n FROM admin_users WHERE id=?').get(id).n > 0;
const activo = id => (db.prepare('SELECT active FROM admin_users WHERE id=?').get(id) || {}).active;

let browser;
try {
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await autoAceptarPaneles(page);
  await page.setCookie({ name: 'asess', value: tokenDuenyo, domain: HOST, path: '/', secure: true });
  const errores = [], ventanitas = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { ventanitas.push(d.type() + ': ' + d.message().slice(0, 50)); await d.dismiss(); });

  const irALista = async () => {
    await page.goto(BASE + '/admin/users', { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('#userBody tr').length > 0, { timeout: 15000 }).catch(() => {});
    await dormir(600);
  };
  const filaDe = id => page.evaluate((i, marca) => {
    const tr = [...document.querySelectorAll('#userBody tr')].find(r => r.innerHTML.includes('(' + i + ')') || r.textContent.includes(marca));
    return tr ? { texto: tr.textContent.replace(/\s+/g, ' ').trim(), botones: [...tr.querySelectorAll('button')].map(b => b.textContent.trim()) } : null;
  }, id, MARCA);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] SIN RASTRO → SE BORRA, y la pantalla lo dice antes');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const limpio = crearEmpleado('limpio', true);   // CON permiso: era justo el caso que reventaba
  await irALista();
  const fLimpio = await filaDe(limpio);
  ok(!!fLimpio, 'la persona aparece en la lista', fLimpio && fLimpio.texto.slice(0, 60));
  ok(!!fLimpio && fLimpio.botones.some(b => /Dar de baja/i.test(b)), 'y su fila ofrece «Dar de baja»',
     fLimpio && fLimpio.botones.join(' | '));

  // Lo que la pantalla VA A DECIR, preguntado por la misma puerta que usa el botón.
  const planLimpio = await page.evaluate(async (i) => (await (await fetch('/api/erp/users/' + i + '/baja')).json()), limpio);
  ok(planLimpio.accion === 'borrar', 'ANTES de pulsar, la pantalla sabe que se va a BORRAR', planLimpio.accion);
  ok(/no ha hecho nada/i.test(planLimpio.texto || ''), '  y dice por qué, en cristiano', (planLimpio.texto || '').slice(0, 80));
  ok(/no se puede deshacer/i.test(planLimpio.texto || ''), '  y avisa de que no se deshace');

  // SE PULSA EL BOTÓN. El panel de confirmación lo acepta `autoAceptarPaneles`.
  await page.evaluate((i) => {
    const tr = [...document.querySelectorAll('#userBody tr')].find(r => r.innerHTML.includes('delUser(' + i + ')'));
    tr.querySelector('button.btn-danger').click();
  }, limpio);
  await dormir(2200);
  ok(!existe(limpio), 'PULSANDO EL BOTÓN, la persona sin rastro se BORRA — con permisos y todo',
     existe(limpio) ? 'sigue ahí' : 'borrada');
  ok(db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE admin_user_id=?').get(limpio).n === 0,
     '  y sus permisos se sueltan (era justo lo que daba el 500)');
  ok(ventanitas.length === 0, '  sin una sola ventanita del navegador', ventanitas.join(' | ') || 'ninguna');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] CON RASTRO → SE ARCHIVA, y su rastro se queda');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const conRastro = crearEmpleado('rastro', true);
  // Rastro de verdad: un apunte en el registro de actividad.
  db.prepare("INSERT INTO activity_logs (user_id, user_name, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)")
    .run(conRastro, MARCA + ' rastro', 'Hizo algo', 'client', 1, '');
  const apuntesAntes = db.prepare('SELECT COUNT(*) n FROM activity_logs WHERE user_id=?').get(conRastro).n;

  await irALista();
  const planRastro = await page.evaluate(async (i) => (await (await fetch('/api/erp/users/' + i + '/baja')).json()), conRastro);
  ok(planRastro.accion === 'archivar', 'ANTES de pulsar, la pantalla sabe que se va a ARCHIVAR', planRastro.accion);
  ok(/apuntes en el registro de actividad/i.test(planRastro.texto || ''),
     '  y NOMBRA el rastro que tiene, con su número', (planRastro.texto || '').slice(0, 120));
  ok(/se queda intacto|se queda/i.test(planRastro.texto || ''), '  y promete que su rastro no se toca');
  ok(/recuperarla/i.test(planRastro.texto || ''), '  y que se puede recuperar');

  await page.evaluate((i) => {
    const tr = [...document.querySelectorAll('#userBody tr')].find(r => r.innerHTML.includes('delUser(' + i + ')'));
    tr.querySelector('button.btn-danger').click();
  }, conRastro);
  await dormir(2200);
  ok(existe(conRastro) && !activo(conRastro), 'PULSANDO EL BOTÓN, la persona con rastro se ARCHIVA (no se borra)',
     existe(conRastro) ? ('activo=' + activo(conRastro)) : 'BORRADA (mal)');
  ok(db.prepare('SELECT COUNT(*) n FROM activity_logs WHERE user_id=?').get(conRastro).n === apuntesAntes,
     '  y su rastro queda INTACTO', apuntesAntes + ' apunte(s) antes y después');
  ok(db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE admin_user_id=?').get(conRastro).n > 0,
     '  y sus permisos se conservan, para cuando vuelva');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LA SESIÓN CAE EN EL SIGUIENTE CLIC');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const conSesion = crearEmpleado('sesion', true);
  db.prepare("INSERT INTO activity_logs (user_id, user_name, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)")
    .run(conSesion, MARCA + ' sesion', 'Hizo algo', 'client', 1, '');
  const tokEmp = 'zz-baja-emp-' + randomBytes(20).toString('hex');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tokEmp, conSesion, ahora, ahora + 3600, randomBytes(20).toString('hex'));

  const ctxEmp = await browser.createBrowserContext();
  const pEmp = await ctxEmp.newPage();
  await pEmp.setCookie({ name: 'asess', value: tokEmp, domain: HOST, path: '/', secure: true });
  const antesDeLaBaja = await pEmp.goto(BASE + '/admin/citas', { waitUntil: 'domcontentloaded' });
  ok(antesDeLaBaja.status() === 200, 'con su sesión abierta, la persona entra normal', 'HTTP ' + antesDeLaBaja.status());

  await irALista();
  await page.evaluate((i) => {
    const tr = [...document.querySelectorAll('#userBody tr')].find(r => r.innerHTML.includes('delUser(' + i + ')'));
    tr.querySelector('button.btn-danger').click();
  }, conSesion);
  await dormir(2000);
  const trasLaBaja = await pEmp.goto(BASE + '/admin/citas', { waitUntil: 'domcontentloaded' });
  const url = pEmp.url();
  ok(trasLaBaja.status() !== 200 || /login/.test(url),
     'y en su SIGUIENTE clic ya no entra', 'HTTP ' + trasLaBaja.status() + ' · ' + url.replace(BASE, ''));
  await ctxEmp.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] RECUPERARLA, y la captura');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await irALista();
  const fArch = await filaDe(conRastro);
  ok(!!fArch && /Inactivo/i.test(fArch.texto), 'la archivada se ve como Inactiva en la lista', fArch && fArch.texto.slice(0, 70));
  ok(!!fArch && fArch.botones.some(b => /Recuperar/i.test(b)), '  y su fila ofrece «Recuperar»', fArch && fArch.botones.join(' | '));
  ok(!!fArch && !fArch.botones.some(b => /Dar de baja/i.test(b)), '  y ya no ofrece darla de baja otra vez');

  await page.evaluate((i) => {
    const tr = [...document.querySelectorAll('#userBody tr')].find(r => r.innerHTML.includes('recuperarUser(' + i + ')'));
    tr.querySelector('button').parentElement.querySelector('[onclick*="recuperarUser"]').click();
  }, conRastro);
  await dormir(2200);
  ok(!!activo(conRastro), 'PULSANDO «Recuperar», vuelve a tener acceso', 'activo=' + activo(conRastro));
  ok(db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE admin_user_id=?').get(conRastro).n > 0,
     '  con los permisos que tenía');

  await irALista();
  // LA CAPTURA SE MIRA, así que se hace como la ve el dueño: sin `fullPage`, que con el rail fijo
  // recorta la primera columna y da una foto que no es la pantalla.
  await page.screenshot({ path: join(SHOTS, 'usuarios-baja.png') }).catch(() => {});
  // Y se comprueba sobre PÍXELES que la columna del nombre se ve entera, que es lo que la captura
  // hacía dudar: un nombre tapado por el rail no se arregla mirando el HTML.
  const nombreVisible = await page.evaluate(() => {
    const td = document.querySelector('#userBody tr td');
    if (!td) return null;
    const r = td.getBoundingClientRect();
    const rail = document.querySelector('.sidebar, nav, aside');
    const rr = rail ? rail.getBoundingClientRect() : { right: 0 };
    return { izq: Math.round(r.left), anchoRail: Math.round(rr.right), texto: td.textContent.trim().slice(0, 20) };
  });
  ok(!!nombreVisible && nombreVisible.izq >= nombreVisible.anchoRail - 1,
     'la columna del nombre NO queda debajo del rail', nombreVisible
       ? ('empieza en ' + nombreVisible.izq + 'px, el rail acaba en ' + nombreVisible.anchoRail + 'px · «' + nombreVisible.texto + '»')
       : '(sin filas)');
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)),
     '  y la página no se desborda a lo ancho');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] LO QUE NO SE PUEDE DAR DE BAJA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const filaDuenyo = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#userBody tr')].find(r => /Propietario/.test(r.textContent));
    return tr ? [...tr.querySelectorAll('button')].map(b => b.textContent.trim()) : null;
  });
  ok(filaDuenyo && !filaDuenyo.some(b => /Dar de baja/i.test(b)),
     'al dueño NO se le ofrece el botón', (filaDuenyo || []).join(' | '));
  const rDuenyo = await page.evaluate(async (i) => {
    const resp = await fetch('/api/erp/users/' + i, { method: 'DELETE', headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } });
    return resp.status;
  }, owner.id);
  ok(rDuenyo === 403, '  y forzar la ruta a mano da 403, no un borrado', 'HTTP ' + rDuenyo);

  ok(errores.length === 0, 'cero errores de JavaScript en todo el recorrido', errores.join(' | ') || 'ninguno');

} finally {
  // LO QUE LA PRUEBA CREA, LA PRUEBA LO BORRA.
  for (const id of creados) {
    try { db.prepare('DELETE FROM activity_logs WHERE user_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM admin_users WHERE id=?').run(id); } catch {}
  }
  try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tokenDuenyo); } catch {}
  const quedan = db.prepare("SELECT COUNT(*) n FROM admin_users WHERE name LIKE ?").get(MARCA + '%').n;
  console.log('  · limpieza: quedan ' + quedan + ' usuarios de esta pasada');
  try { if (browser) await browser.close(); } catch {}
  db.close();
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗   (captura en ' + SHOTS + ')');
process.exit(fail === 0 ? 0 : 1);
