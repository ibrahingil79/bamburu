// GATE DEL PUNTO 12 — el control horario (registro de jornada).
//   node scripts/gate-control-horario.mjs
//
// ESTO NO ES UNA FUNCIÓN MÁS: es un registro que exige la ley (RD-ley 8/2019, art. 34.9 ET) y que
// puede pedir la Inspección. Así que lo que más se mide aquí no es que funcione, sino que **no se
// pueda falsear sin que se note**:
//   · nada se borra — corregir deja el original a la vista, anulado y con su motivo;
//   · la jornada se DERIVA de los fichajes, así que el total siempre se puede reconstruir;
//   · una secuencia imposible se rechaza con su motivo, no «se arregla sola»;
//   · y CADA TRABAJADOR ve lo suyo, con permisos o sin ellos, porque eso es lo que da la ley.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { fichar, corregir, estadoDe, jornadaDe, resumen, quienEstaDentro, historialDe, horasTexto } from '../modules/erp/fichaje.js';
import { ahoraLocal, hhmm as hhmmDe } from '../modules/erp/citas-engine.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GCH-' + RID;
const TOKEN_PREFIJO = 'gate-fichaje-';
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const ahora = Math.floor(Date.now() / 1000);
const sesion = uid => { const t = TOKEN_PREFIJO + randomBytes(20).toString('hex');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(t, uid, ahora, ahora + 3600, randomBytes(20).toString('hex')); return t; };
const tok = sesion(owner.id);

let browser = null, empleado = null;
try {
  // EL RELOJ DEL NEGOCIO, NO EL DE UTC. Esta misma línea, escrita con `new Date().toISOString()`,
  // hizo que el gate sembrara fichajes en un día y el servidor mirara otro a las 23:50 — y dio
  // cuatro rojos sobre un producto que estaba bien. Un gate que usa otro reloj que el producto mide
  // otra cosa.
  const hoy = ahoraLocal().fecha;
  const ayer = new Date(Date.parse(hoy + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  // EL GATE SE TRAE SU PROPIO TRABAJADOR: sin él dependería de que el negocio tenga a alguien sin
  // permisos, que es justo la precondición ajena que ya costó la TAREA 1.
  empleado = db.prepare(
    "INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES (?,?,'x','employee',1,0,datetime('now'))"
  ).run(MARCA + ' Trabajador', 'gch-' + RID + '@t.local').lastInsertRowid;
  const tokEmp = sesion(empleado);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA SECUENCIA — y lo que NO se deja hacer');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(estadoDe(db, empleado, ayer).estado === 'fuera', 'quien no ha fichado está «fuera»');
  let m1 = ''; try { fichar(db, { userId: empleado, tipo: 'salida', fecha: ayer, hora: '18:00' }); } catch (e) { m1 = e.message; }
  ok(/no toca|toca entrada/i.test(m1), 'no se puede SALIR sin haber entrado, y se dice qué toca', m1);
  fichar(db, { userId: empleado, tipo: 'entrada', fecha: ayer, hora: '09:00' });
  ok(estadoDe(db, empleado, ayer).estado === 'trabajando', 'tras entrar, está trabajando');
  let m2 = ''; try { fichar(db, { userId: empleado, tipo: 'entrada', fecha: ayer, hora: '09:30' }); } catch (e) { m2 = e.message; }
  ok(/no toca/i.test(m2), '  y no puede entrar dos veces', m2);
  let m3 = ''; try { fichar(db, { userId: empleado, tipo: 'vuelta', fecha: ayer, hora: '09:30' }); } catch (e) { m3 = e.message; }
  ok(/no toca/i.test(m3), '  ni volver de una pausa que no existe', m3);
  let m4 = ''; try { fichar(db, { userId: empleado, tipo: 'pausa', fecha: ayer, hora: '08:00' }); } catch (e) { m4 = e.message; }
  ok(/anterior/i.test(m4), '  ni fichar hacia atrás en el tiempo', m4);

  fichar(db, { userId: empleado, tipo: 'pausa',  fecha: ayer, hora: '14:00' });
  fichar(db, { userId: empleado, tipo: 'vuelta', fecha: ayer, hora: '15:00' });
  fichar(db, { userId: empleado, tipo: 'salida', fecha: ayer, hora: '18:00' });

  console.log('\n[2] LA JORNADA SE DERIVA — y la cuenta tiene que salir a mano');
  const j = jornadaDe(db, empleado, ayer);
  ok(j.entrada === '09:00' && j.salida === '18:00', 'entrada y salida del día', j.entrada + ' → ' + j.salida);
  ok(j.minutos === 480, '  trabajado: 09→14 y 15→18 son 8 h exactas', horasTexto(j.minutos));
  ok(j.pausa_min === 60, '  y la pausa, una hora — que NO cuenta como trabajo', horasTexto(j.pausa_min));
  ok(!j.abierta, '  y la jornada quedó cerrada');
  // La jornada abierta de un día PASADO no se estira hasta ahora: eso sería inventar horas.
  // LA ENTRADA DE HOY NO PUEDE SER A LAS 08:00 «PORQUE SÍ»: si el gate corre a la 01:38, las 08:00
  // están en el futuro y el producto —con razón— rechaza fichar hacia atrás después. La primera
  // versión de esto daba dos rojos a las dos de la mañana y ninguno a las diez. Se ficha MEDIA HORA
  // ANTES DE AHORA, con el reloj del negocio, y así vale a cualquier hora.
  const haceMedia = hhmmDe(Math.max(0, ahoraLocal().min - 30));
  fichar(db, { userId: empleado, tipo: 'entrada', fecha: hoy, hora: haceMedia });
  const jHoy = jornadaDe(db, empleado, hoy);
  ok(jHoy.abierta, 'una jornada sin cerrar se marca como ABIERTA (es un dato, no un fallo)');
  const dosDiasAtras = new Date(Date.parse(hoy + 'T00:00:00Z') - 2 * 86400000).toISOString().slice(0, 10);
  fichar(db, { userId: empleado, tipo: 'entrada', fecha: dosDiasAtras, hora: '10:00' });
  const jVieja = jornadaDe(db, empleado, dosDiasAtras);
  ok(jVieja.abierta && jVieja.minutos === 0,
     'y una de HACE DÍAS que quedó abierta NO se estira hasta ahora: no se inventan horas',
     horasTexto(jVieja.minutos));

  console.log('\n[3] CORREGIR NO ES BORRAR — que es lo que hace que el registro valga');
  const fs0 = historialDe(db, empleado, ayer);
  const entradaAyer = fs0.find(f => f.tipo === 'entrada');
  let mSin = ''; try { corregir(db, { fichajeId: entradaAyer.id, hora: '09:30', motivo: 'ay' }); } catch (e) { mSin = e.message; }
  ok(/por qué|motivo/i.test(mSin), 'no se corrige sin decir por qué', mSin);
  corregir(db, { fichajeId: entradaAyer.id, hora: '09:30', motivo: 'Se le olvidó fichar al llegar', hechoPor: owner.id });
  const fs1 = historialDe(db, empleado, ayer);
  ok(fs1.length === fs0.length + 1, 'la corrección AÑADE un fichaje, no reemplaza', fs0.length + ' → ' + fs1.length);
  const viejo = fs1.find(f => f.id === entradaAyer.id);
  ok(viejo && viejo.anulado === 1, '  el original sigue ahí, anulado', 'anulado=' + (viejo && viejo.anulado));
  ok(/olvidó fichar/.test(viejo.motivo || ''), '  con el motivo escrito', viejo.motivo);
  const nuevo = fs1.find(f => f.corregido_de === entradaAyer.id);
  ok(!!nuevo && nuevo.hora === '09:30', '  y el nuevo dice a cuál sustituye', nuevo && nuevo.hora);
  ok(jornadaDe(db, empleado, ayer).minutos === 450, '  y la cuenta se rehace sola: media hora menos',
     horasTexto(jornadaDe(db, empleado, ayer).minutos));
  ok(db.prepare('SELECT COUNT(*) n FROM fichajes WHERE user_id=? AND fecha=?').get(empleado, ayer).n === fs1.length,
     'NADA se ha borrado de la tabla', fs1.length + ' filas');

  console.log('\n[4] EL RESUMEN Y QUIÉN ESTÁ DENTRO');
  const r = resumen(db, empleado, dosDiasAtras, hoy);
  ok(r.dias.length === 3, 'el resumen trae un día por fila', r.dias.length + ' días');
  ok(r.abiertas === 2, '  y cuenta las jornadas sin cerrar', r.abiertas + '');
  ok(quienEstaDentro(db, hoy).some(x => x.id === empleado), 'y «quién está dentro» lo ve trabajando');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] EL DERECHO DEL TRABAJADOR — ve lo suyo aunque no tenga permisos');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const conEmp = { cookie: 'asess=' + tokEmp };
  const rMio = await fetch(BASE + '/api/erp/fichaje/mio', { headers: conEmp });
  ok(rMio.status === 200, 'un empleado SIN permisos consulta su propio registro', 'got ' + rMio.status);
  const suyo = await rMio.json();
  ok((suyo.dias || []).length >= 1, '  y le sale', (suyo.dias || []).length + ' días');
  const rOtro = await fetch(BASE + '/api/erp/fichaje/de/' + owner.id, { headers: conEmp });
  ok(rOtro.status === 403, '  pero el de OTRA persona, no', 'got ' + rOtro.status);
  const rDentro = await fetch(BASE + '/api/erp/fichaje/dentro', { headers: conEmp });
  ok(rDentro.status === 403, '  ni quién está dentro', 'got ' + rDentro.status);
  const rHistAjeno = await fetch(BASE + '/api/erp/fichaje/historial/' + owner.id + '/' + hoy, { headers: conEmp });
  ok(rHistAjeno.status === 403, '  ni el historial ajeno', 'got ' + rHistAjeno.status);
  // Y fichar POR OTRO tampoco.
  const csrfEmp = db.prepare('SELECT csrf_token FROM admin_sessions WHERE token=?').get(tokEmp).csrf_token;
  const rPorOtro = await fetch(BASE + '/api/erp/fichaje', { method: 'POST',
    headers: { ...conEmp, 'content-type': 'application/json', 'x-csrf-token': csrfEmp },
    body: JSON.stringify({ tipo: 'entrada', user_id: owner.id }) });
  ok(rPorOtro.status === 403, 'y no puede fichar por otra persona', 'got ' + rPorOtro.status);
  const rCorregir = await fetch(BASE + '/api/erp/fichaje/corregir', { method: 'POST',
    headers: { ...conEmp, 'content-type': 'application/json', 'x-csrf-token': csrfEmp },
    body: JSON.stringify({ id: entradaAyer.id, hora: '07:00', motivo: 'yo me lo guiso' }) });
  ok(rCorregir.status === 403, '  ni corregir un fichaje sin el permiso de editar', 'got ' + rCorregir.status);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] LA PANTALLA, PULSANDO EL BOTÓN GRANDE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: tokEmp, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });
  await page.goto(BASE + '/admin/fichaje', { waitUntil: 'networkidle0' });
  await dormir(1400);
  const v1 = await page.evaluate(() => ({
    rotulo: (document.getElementById('rotulo') || {}).textContent || '',
    botones: [...document.querySelectorAll('[data-fichar]')].map(b => b.dataset.fichar),
    equipo: /El equipo/.test(document.body.innerText),
    texto: document.body.innerText.replace(/\s+/g, ' '),
  }));
  ok(/trabajando desde/i.test(v1.rotulo), 'la pantalla dice en qué estado está', v1.rotulo);
  ok(v1.botones.join(',') === 'pausa,salida', '  y ofrece solo lo que toca ahora', v1.botones.join(','));
  // EL RELOJ GRANDE TIENE QUE SER EL DEL NEGOCIO. Lo destapó la captura: enseñaba «23:39» arriba y
  // «en pausa desde las 01:39» debajo, porque uno venía del navegador y el otro del servidor. En un
  // registro de jornada, dos relojes en la misma tarjeta parecen un fichaje apuntado a otra hora.
  const relojEs = await page.evaluate(() => (document.getElementById('reloj') || {}).textContent || '');
  const minServidor = ahoraLocal().min;
  const [rh, rm] = relojEs.split(':').map(Number);
  ok(Number.isFinite(rh) && Math.abs((rh * 60 + rm) - minServidor) <= 2,
     '  y el reloj grande es el del NEGOCIO, no el del ordenador de quien mira',
     'pantalla ' + relojEs + ' · negocio ' + hhmmDe(minServidor));
  ok(!v1.equipo, '  y un empleado sin permisos NO ve el bloque del equipo');
  ok(/Mi semana/.test(v1.texto), '  pero sí el suyo');
  ok(/obligatorio por ley/i.test(v1.texto), 'y la pantalla dice para qué existe');
  ok(/no.*hace.*nóminas|nóminas/i.test(v1.texto), '  y también lo que NO hace');
  // PULSAR: pausa, y comprobar que el estado cambia de verdad.
  await page.evaluate(() => document.querySelector('[data-fichar="pausa"]').click());
  await dormir(800);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /^Sí/i.test(x.textContent.trim())); if (b) b.click(); });
  await dormir(2200);
  ok(estadoDe(db, empleado, hoy).estado === 'pausa', 'al pulsar «Pausa» y confirmar, queda en pausa DE VERDAD',
     estadoDe(db, empleado, hoy).estado);
  const v2 = await page.evaluate(() => [...document.querySelectorAll('[data-fichar]')].map(b => b.dataset.fichar));
  ok(v2.join(',') === 'vuelta,salida', '  y la pantalla ya ofrece volver o salir', v2.join(','));
  ok(errores.length === 0, 'sin errores de JavaScript ni ventanitas del navegador', errores.join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto12-fichaje.png') });

  // El dueño SÍ ve el equipo.
  const jefe = await ctx.newPage();
  await jefe.setViewport({ width: 1440, height: 1100 });
  await jefe.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  await jefe.goto(BASE + '/admin/fichaje', { waitUntil: 'networkidle0' });
  await dormir(1200);
  const vj = await jefe.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/El equipo/.test(vj), 'y quien tiene el permiso SÍ ve el bloque del equipo');
  ok(new RegExp(MARCA).test(vj), '  con quién está dentro ahora mismo');
  await jefe.close();

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    if (empleado) db.prepare('DELETE FROM fichajes WHERE user_id=?').run(empleado);
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
    db.prepare("DELETE FROM activity_logs WHERE entity='fichaje'").run();
    if (empleado) db.prepare('DELETE FROM admin_users WHERE id=?').run(empleado);
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
