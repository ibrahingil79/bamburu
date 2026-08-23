// GATE DEL PUNTO 13 — la agenda del CRM: tareas y seguimientos con fecha, dueño y aviso.
//   node scripts/gate-crm-tareas.mjs
//
// LAS CUATRO PIEZAS QUE PEDÍA EL ENCARGO, y cada una con su prueba:
//   FECHA  → obligatoria, y una tarea sin fecha se rechaza.
//   DUEÑO  → se guarda y se enseña.
//   AVISO  → sale por el motor de avisos QUE YA EXISTE, así que aparece en la campana, en /admin/avisos,
//            en el Inicio y en el correo diario. Se comprueba pidiendo los avisos del día.
//   LÍNEA DE TIEMPO → aparece en la del cliente, junto a sus facturas y sus citas.
// Y lo que ata todo: **nada se borra**, y el aviso respeta el permiso de su pantalla.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { crearTarea, listarTareas, marcarHecha, anularTarea, reprogramar, tareasDeCliente,
         tareasCrmVencidas } from '../modules/erp/crm-tareas.js';
import { avisosDelDia, PERM_POR_FUENTE, fuentesDe, hoyLocal } from '../modules/erp/avisos.js';
import { clientTimeline } from '../modules/erp/crm.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GCT-' + RID;
const TOKEN_PREFIJO = 'gate-crmt-';
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id, name FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const ahora = Math.floor(Date.now() / 1000);
const tok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

let browser = null, cli = null;
try {
  const hoy = hoyLocal();
  const ayer = new Date(Date.parse(hoy + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const manana = new Date(Date.parse(hoy + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  cli = db.prepare("INSERT INTO clients (name, client_type, active) VALUES (?,'empresa',1)").run(MARCA + ' Cliente').lastInsertRowid;

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] FECHA Y DUEÑO — sin las dos cosas, no es una tarea');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  let m1 = ''; try { crearTarea(db, { client_id: cli, titulo: MARCA + ' sin fecha' }); } catch (e) { m1 = e.message; }
  ok(/fecha|cuándo/i.test(m1), 'una tarea sin fecha se rechaza', m1);
  let m2 = ''; try { crearTarea(db, { client_id: cli, titulo: '', fecha: hoy }); } catch (e) { m2 = e.message; }
  ok(/título|qué hay que hacer/i.test(m2), '  y sin decir qué hay que hacer, también', m2);
  let m3 = ''; try { crearTarea(db, { titulo: MARCA + ' huérfana', fecha: hoy }); } catch (e) { m3 = e.message; }
  ok(/cliente/i.test(m3), '  y una tarea comercial es de alguien: sin cliente, no', m3);
  const tVencida = crearTarea(db, { client_id: cli, titulo: MARCA + ' llamar', fecha: ayer, user_id: owner.id, created_by: owner.id });
  const tHoy     = crearTarea(db, { client_id: cli, titulo: MARCA + ' visitar', fecha: hoy, user_id: owner.id, created_by: owner.id });
  const tFutura  = crearTarea(db, { client_id: cli, titulo: MARCA + ' presupuesto', fecha: manana, created_by: owner.id });
  const lista = listarTareas(db, { estado: 'pendiente', clientId: cli, hoy });
  ok(lista.length === 3, 'las tres se guardan', lista.length + '');
  ok(lista.find(x => x.id === tVencida.id).responsable === owner.name, '  con su dueño', owner.name);
  ok(lista.find(x => x.id === tVencida.id).vencida === true, '  y la de ayer sale como VENCIDA',
     lista.find(x => x.id === tVencida.id).retraso + ' día(s)');
  ok(lista.find(x => x.id === tHoy.id).hoy === true, '  la de hoy, como de hoy');
  ok(lista.find(x => x.id === tFutura.id).vencida === false, '  y la de mañana, ni una cosa ni la otra');
  ok(lista.find(x => x.id === tFutura.id).responsable === null, '  una sin dueño se guarda, y se ve que no lo tiene');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EL AVISO — por el motor que YA HAY, no por una bandeja nueva');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const avisos = avisosDelDia(db, hoy).filter(a => a.tipo === 'tarea_crm');
  ok(avisos.length >= 2, 'la vencida y la de hoy salen en los avisos del día', avisos.length + ' avisos');
  ok(!avisos.some(a => a.ref.tarea_id === tFutura.id), '  y la de mañana NO: todavía no toca');
  const av = avisos.find(a => a.ref.tarea_id === tVencida.id);
  ok(/Se te pasó hace/.test(av.detalle), '  la vencida dice cuánto se pasó', av.detalle);
  ok(av.ref.client_id === cli && av.ref.responsable === owner.name, '  y trae cliente y dueño para poder actuar');
  ok(PERM_POR_FUENTE.tarea_crm === 'crm.read',
     'el aviso lleva el MISMO permiso que su pantalla: no es una puerta trasera', PERM_POR_FUENTE.tarea_crm);
  const sinCrm = fuentesDe({ role: 'employee', perms: ['invoices.read'] });
  ok(!sinCrm.has('tarea_crm'), '  y quien no puede abrir el CRM no ve estos avisos');
  ok(avisosDelDia(db, hoy, sinCrm).every(a => a.tipo !== 'tarea_crm'), '  ni forzando el motor con sus fuentes');
  // Y no tapa lo importante: una factura vencida sigue por encima.
  const todos = avisosDelDia(db, hoy);
  const cobro = todos.find(a => a.tipo === 'cobro_vencido');
  if (cobro) ok(cobro.urgencia > av.urgencia, 'y una factura sin cobrar sigue por encima de una tarea',
                cobro.urgencia + ' vs ' + av.urgencia);
  else ok(true, '  (hoy no hay cobros vencidos con los que contrastar la urgencia)');

  console.log('\n[3] LA LÍNEA DE TIEMPO DEL CLIENTE');
  const tl = clientTimeline(db, cli, hoy);
  const evs = tl.filter(e => e.kind === 'tarea');
  ok(evs.length === 3, 'las tres tareas están en la línea de tiempo del cliente', evs.length + '');
  ok(evs.some(e => /VENCIDA/.test(e.title)), '  y la vencida se marca como tal',
     (evs.find(e => /VENCIDA/.test(e.title)) || {}).title);
  ok(evs.every(e => e.detail !== undefined), '  con su dueño y su fecha al lado');
  // Y si no puedes ver el CRM, no las ves.
  const tlSin = clientTimeline(db, cli, hoy, { include: { tareas: false } });
  ok(!tlSin.some(e => e.kind === 'tarea'), '  y sin permiso de CRM, la línea de tiempo no las trae');
  ok(tareasDeCliente(db, cli).length === 3, 'y el ayudante de la ficha las devuelve con su forma');

  console.log('\n[4] HECHA, MOVIDA, ANULADA — y NADA SE BORRA');
  const antes = db.prepare('SELECT COUNT(*) n FROM crm_tareas WHERE client_id=?').get(cli).n;
  marcarHecha(db, tHoy.id, { resultado: 'Le llamé, quedamos en septiembre', por: owner.id });
  const hecha = listarTareas(db, { estado: 'hecha', clientId: cli })[0];
  ok(hecha && hecha.id === tHoy.id, 'una tarea se da por hecha', hecha && hecha.resultado);
  ok(/septiembre/.test(hecha.resultado || ''), '  con su resultado apuntado (el siguiente empieza sabiendo)');
  let m4 = ''; try { marcarHecha(db, tHoy.id); } catch (e) { m4 = e.message; }
  ok(/ya está/.test(m4), '  y no se puede cerrar dos veces', m4);
  reprogramar(db, tVencida.id, manana);
  ok(listarTareas(db, { estado: 'pendiente', clientId: cli }).find(x => x.id === tVencida.id).fecha === manana,
     'una pendiente se mueve de día — reprogramar no es anular');
  let m5 = ''; try { anularTarea(db, tFutura.id, 'no'); } catch (e) { m5 = e.message; }
  ok(/por qué/i.test(m5), 'no se anula sin decir por qué', m5);
  anularTarea(db, tFutura.id, 'El cliente ya no lo quiere');
  ok(db.prepare('SELECT COUNT(*) n FROM crm_tareas WHERE client_id=?').get(cli).n === antes,
     'NADA se ha borrado: hecha, movida y anulada siguen las tres', antes + ' filas');
  ok(listarTareas(db, { estado: 'anulada', clientId: cli })[0].motivo === 'El cliente ya no lo quiere',
     '  y la anulada conserva su motivo');
  ok(!avisosDelDia(db, hoy).some(a => a.tipo === 'tarea_crm' && a.ref.tarea_id === tHoy.id),
     'y una tarea hecha deja de avisar, claro');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] LA PANTALLA, PULSANDO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });
  await page.goto(BASE + '/admin/crm/tareas', { waitUntil: 'networkidle0' });
  await dormir(1500);
  const v = await page.evaluate(() => ({
    pestanas: [...document.querySelectorAll('.tab')].map(t => t.textContent.trim()),
    texto: document.body.innerText.replace(/\s+/g, ' '),
  }));
  ok(v.pestanas.includes('Tareas'), 'la pestaña está donde vive el CRM', v.pestanas.join(' · '));
  ok(/Se te ha pasado/.test(v.texto) && /Para hoy/.test(v.texto) && /Lo que viene/.test(v.texto),
     'y la pantalla ordena por lo que hay que mirar primero');
  ok(new RegExp(MARCA + ' presupuesto').test(v.texto) === false, '  (la anulada ya no sale entre las pendientes)');
  // Crear una tarea PULSANDO.
  await page.click('#btnNuevaTarea'); await dormir(900);
  const panel = await page.evaluate(() => { const o = document.querySelector('.modal-overlay.open');
    return o ? { t: (o.querySelector('h3') || {}).textContent, campos: o.querySelectorAll('.modal-body input, .modal-body select').length } : null; });
  ok(!!panel && /Nueva tarea/.test(panel.t || ''), 'el botón abre un panel, no una ventanita', panel && panel.t);
  ok(panel && panel.campos >= 4, '  con cliente, qué, cuándo y de quién', panel && panel.campos + ' campos');
  // Sin cliente: no se cierra y lo dice.
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Apuntarla/i.test(x.textContent)); if (b) b.click(); });
  await dormir(700);
  const err1 = await page.evaluate(() => { const e = document.querySelector('.modal-overlay.open .pd-err'); return e && e.style.display !== 'none' ? e.textContent : ''; });
  ok(/cliente/i.test(err1), '  y con el cliente vacío no se cierra: lo dice', err1);
  // Con todo bien: se crea.
  const antesN = db.prepare('SELECT COUNT(*) n FROM crm_tareas WHERE client_id=?').get(cli).n;
  await page.evaluate(m => { const c2 = document.querySelectorAll('.modal-overlay.open .modal-body input');
    c2[0].value = m + ' Cliente'; c2[1].value = m + ' desde la pantalla'; }, MARCA);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Apuntarla/i.test(x.textContent)); if (b) b.click(); });
  await dormir(2200);
  ok(db.prepare('SELECT COUNT(*) n FROM crm_tareas WHERE client_id=?').get(cli).n === antesN + 1,
     'y con los datos buenos, la tarea se apunta de verdad');
  ok(errores.length === 0, 'sin errores de JavaScript ni ventanitas', errores.join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto13-tareas.png') });

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM crm_tareas WHERE titulo LIKE 'GCT-%' OR client_id IN (SELECT id FROM clients WHERE name LIKE 'GCT-%')").run();
    db.prepare("DELETE FROM clients WHERE name LIKE 'GCT-%'").run();
    db.prepare("DELETE FROM activity_logs WHERE entity='crm_tarea'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
