// AGENDA SENCILLA — Gate de NAVEGADOR (ajuste de presentación de la pieza 5).
//   node scripts/gate-agenda-sencilla.mjs
//
// QUÉ MIDE, contra el servidor real:
//   [1] la vista de entrada muestra HOY, por persona, y SOLO quien trabaja hoy (quien libra no ocupa
//       columna; "Ver todo el equipo" lo trae de vuelta).
//   [2] crear una cita COMPLETA pulsando un hueco vacío: persona y hora salen del hueco (no se
//       vuelven a preguntar); cliente + servicio + Guardar.
//   [3] cliente NUEVO creado sin salir del panel.
//   [4] el tramo de ESPERA se dibuja distinto ("Aquí estás libre").
//   [5] al chocar, se proponen HUECOS cercanos (no un error seco).
//   [6] 0 errores JS.
// No deja residuo: borra sus citas/servicios/cliente/empleados/horarios al salir.
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';

const BASE = 'http://desarrollo-bamburu.localhost:3000', HOST = 'desarrollo-bamburu.localhost';
let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const db = new Database(join(APP_DIR, 'data/tenants/desarrollo-bamburu.db'));
const TS = Date.now();
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 LIMIT 1").get();
const HOY = new Date().toISOString().slice(0, 10);
const tok = 'gas-' + TS, now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(tok, owner.id, now, now + 3600, 'x');
const emps = []; let S = 0, Sesp = 0, CLI = 0, excId = 0, excDiaId = 0;
function emp(n) { const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)").run(n, 'gas-' + TS + '-' + emps.length + '@t.local', 'x').lastInsertRowid; emps.push(id); return id; }
let b;
const call = (p, m, u, body) => p.evaluate(async (m, u, b) => { const o = { method: m, headers: { 'x-csrf-token': window.CSRF_TOKEN || '' } }; if (b) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(b); } const r = await fetch(u, o); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; }, m, u, body);

try {
  const A = emp('GATE Ana ' + TS);          // trabaja hoy (hereda el día abierto por defecto)
  const B = emp('GATE Berta ' + TS);         // NO trabaja hoy (excepción "cerrado")
  excId = db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,motivo) VALUES ('user',?,?,'cerrado','Libra')").run(B, HOY).lastInsertRowid;

  // ── EL GATE SE TRAE SU PROPIO HORARIO PARA HOY ────────────────────────────────────────────────
  // POR QUÉ. El paso [5] afirma que, al chocar, la pantalla PROPONE huecos cercanos (> 0). Esos
  // huecos los calcula el SERVIDOR con `huecos()`, que del día de hoy descarta todo lo anterior a
  // «ahora» (`minInicioHoy = ahora.min + antelacion`). Sin horario propio, el negocio hereda el día
  // por defecto del motor —8:00 a 21:00—, así que a partir de las 21:00 no queda ni un hueco y la
  // aserción caía. El mismo código, el mismo gate, distinto veredicto según la hora del reloj.
  //
  // LA ASERCIÓN NO CAMBIA: sigue siendo «al chocar, propone huecos cercanos (> 0)». Lo que cambia es
  // que el escenario deja de apoyarse en una precondición que no es suya (el horario por defecto del
  // motor) y se trae el suyo: HOY abierto de 00:00 a 24:00, por excepción de fecha, que se borra al
  // salir. Es el mismo patrón que ya usa este gate con la excepción de Berta, y el mismo que usan los
  // gates de compras con `productoDePrueba`: cada uno se trae lo suyo.
  //
  // OJO, Y QUEDA ANOTADO EN EL TABLERO: esto no llega hasta la medianoche. `huecos()` solo propone
  // huecos del MISMO día, así que con la rejilla de 30 min el último arranque posible es a las 23:30
  // y el gate deja de sostenerse si se lanza después. MEDIDO: antes aguantaba hasta las 20:30 (3 h 30
  // de ventana mala); ahora hasta las 23:30 (29 min). Ese resto NO es del gate: es el límite del
  // producto que se anota como hallazgo, y se cerrará solo el día que `huecos()` ofrezca el día
  // siguiente en vez de devolver cero.
  excDiaId = db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,inicio_min,fin_min,motivo) VALUES ('negocio',NULL,?,'horario',0,1440,'GATE agenda sencilla')").run(HOY).lastInsertRowid;
  S = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,20,'service','general',21,'active')").run('GATE Corte ' + TS).lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min) VALUES (?,1,30,0,0,0)").run(S);
  Sesp = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,30,'service','general',21,'active')").run('GATE Tinte ' + TS).lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min) VALUES (?,1,45,15,30,0)").run(Sesp);  // 15 contigo + 30 espera
  CLI = db.prepare("INSERT INTO clients (name,email,active) VALUES (?,'gasc@t.local',1)").run('GATE Cli ' + TS).lastInsertRowid;

  b = await puppeteer.launch(launchOpts());
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1000 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
  await p.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/' });
  await p.evaluateOnNewDocument(() => { try { localStorage.removeItem('agPrefs'); } catch (e) {} });   // vista de entrada limpia

  // ── [1] Vista de entrada: hoy, por persona, solo quien trabaja hoy ──────────
  console.log('\n[1] vista de entrada (hoy · por persona · solo quien trabaja hoy)');
  await p.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => document.querySelectorAll('#agenda th').length > 1, { timeout: 8000 }).catch(() => {});
  // La rejilla dejó de ser una <table> (AGENDA · ACABADO VISUAL): las cabeceras de columna llevan
  // ahora la clase ESTABLE .agcol-head con su data-col, y se leen por ahí. La aserción es la misma y
  // no se debilita: sigue exigiendo que aparezca quien trabaja hoy y no aparezca quien libra.
  const heads = () => p.$$eval('#agenda .agcol-head', ths => ths.map(t => t.textContent.trim()));
  let h = await heads();
  ok(h.some(x => x.includes('Ana ' + TS)), 'la columna de quien trabaja hoy (Ana) aparece');
  ok(!h.some(x => x.includes('Berta ' + TS)), 'quien libra hoy (Berta) NO ocupa columna');
  // "Ver todo el equipo" la trae de vuelta (un clic).
  await p.evaluate(() => { toggleControles(); document.getElementById('agVerTodo').checked = true; agCargar(); });
  await p.waitForFunction((ts) => [...document.querySelectorAll('#agenda .agcol-head')].some(t => t.textContent.includes('Berta ' + ts)), { timeout: 8000 }, TS).catch(() => {});
  h = await heads();
  ok(h.some(x => x.includes('Berta ' + TS)), 'con "Ver todo el equipo" reaparece Berta (nada se elimina)');
  // Volver a la vista de entrada.
  await p.evaluate(() => { document.getElementById('agVerTodo').checked = false; agCargar(); });
  await new Promise(r => setTimeout(r, 400));

  // ── [2] Crear pulsando un hueco vacío: persona y hora salen del hueco ────────
  console.log('\n[2] crear pulsando el hueco vacío (persona y hora salen de ahí)');
  await p.evaluate((A) => { document.querySelector('.agcell[data-col="' + A + '"][data-min="660"]').click(); }, A);   // 11:00 en la columna de Ana
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open') && document.querySelectorAll('.csvc').length > 0, { timeout: 8000 });
  const ctx = await p.$eval('#cContexto', e => e.textContent);
  ok(/Ana/.test(ctx) && /11:00/.test(ctx), 'el panel ya trae persona y hora del hueco (no se preguntan)', ctx);
  // Interacción cliente: filtrar y elegir el existente.
  await p.evaluate((nom) => { var i = document.getElementById('cBusca'); i.value = nom; cFiltra(); }, 'GATE Cli ' + TS);
  await p.waitForFunction(() => document.querySelector('#cResultados .cliOpt'), { timeout: 5000 });
  await p.evaluate(() => document.querySelector('#cResultados .cliOpt').click());
  // Interacción servicio.
  await p.evaluate((sid) => document.querySelector('.csvc[value="' + sid + '"]').click(), S);
  // Guardar.
  await p.evaluate(() => cGuardar());
  await new Promise(r => setTimeout(r, 500));
  const c2 = db.prepare("SELECT * FROM citas WHERE user_id=? AND inicio_min=660 AND cliente_id=? ORDER BY id DESC LIMIT 1").get(A, CLI);
  ok(!!c2, 'cita creada desde el hueco', c2 ? c2.codigo : '(no)');
  ok(c2 && c2.user_id === A && c2.inicio_min === 660, 'la persona y la hora son las del hueco pulsado (no se re-preguntaron)');

  // ── [3] Cliente NUEVO sin salir del panel ───────────────────────────────────
  console.log('\n[3] cliente nuevo sin salir del panel');
  await p.evaluate((A) => { document.querySelector('.agcell[data-col="' + A + '"][data-min="720"]').click(); }, A);   // 12:00
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  const NUEVO = 'GATE Walkin ' + TS;
  // SE TECLEA DE VERDAD, no se le mete el valor al input y se llama a cFiltra() a mano. Un gate que
  // se salta lo que hace una persona puede dar verde sobre una pantalla rota — y eso es justo lo que
  // pasó con el alta el 18 ago 2026.
  await p.click('#cBusca');
  await p.type('#cBusca', NUEVO, { delay: 20 });
  await p.waitForFunction(() => document.getElementById('cNuevo').style.display !== 'none', { timeout: 5000 });
  await p.evaluate(() => { document.getElementById('cSueltoMovil').value = '600111222'; cUsarNuevo(); });
  await p.evaluate((sid) => document.querySelector('.csvc[value="' + sid + '"]').click(), S);
  await p.evaluate(() => cGuardar());
  await new Promise(r => setTimeout(r, 500));
  const c3 = db.prepare("SELECT * FROM citas WHERE user_id=? AND cliente_suelto_nombre=? ORDER BY id DESC LIMIT 1").get(A, NUEVO);
  ok(!!c3, 'cita con cliente nuevo creada sin salir del panel', c3 ? c3.cliente_suelto_movil : '(no)');

  // ── [3-bis] EL ALTA NO SE PIERDE AL CORREGIR EL NOMBRE ──────────────────────
  // Regresión REAL encontrada el 18 ago 2026 y anterior a esa semana: cFiltra() corría en cada tecla y
  // borraba el cliente elegido, así que bastaba con elegirlo y luego añadir el apellido para que al
  // guardar saliera «Elige o crea un cliente» y la cita NO se creara. Sin esta prueba el gate seguía
  // verde con el alta rota.
  console.log('\n[3-bis] elegir el cliente y DESPUÉS corregir el nombre: la cita se crea igual');
  await p.evaluate((A) => { document.querySelector('.agcell[data-col="' + A + '"][data-min="780"]').click(); }, A);   // 13:00
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  await p.click('#cBusca');
  await p.type('#cBusca', 'GATE Corregido ' + TS, { delay: 20 });
  await p.waitForFunction(() => document.getElementById('cNuevo').style.display !== 'none', { timeout: 5000 });
  await p.evaluate(() => document.querySelector('#cNuevo button').click());
  await new Promise(r => setTimeout(r, 250));
  // …y ahora se sigue escribiendo, que es lo que rompía el alta.
  await p.click('#cBusca'); await p.keyboard.press('End');
  await p.type('#cBusca', ' Apellido', { delay: 20 });
  await new Promise(r => setTimeout(r, 250));
  await p.evaluate((sid) => document.querySelector('.csvc[value="' + sid + '"]').click(), S);
  await p.evaluate(() => cGuardar());
  await new Promise(r => setTimeout(r, 900));
  const cCorr = db.prepare("SELECT * FROM citas WHERE user_id=? AND cliente_suelto_nombre=? ORDER BY id DESC LIMIT 1").get(A, 'GATE Corregido ' + TS + ' Apellido');
  ok(!!cCorr, 'la cita se crea con el nombre CORREGIDO, sin volver a pulsar nada', cCorr ? cCorr.codigo : '(no se creó: el alta vuelve a estar rota)');
  ok(!(await p.evaluate(() => document.getElementById('mCita').classList.contains('open'))), 'y el panel se cierra: no se queda colgado con un error');

  // ── [3-ter] EL BUSCADOR VE A LOS CLIENTES DADOS DE ALTA DESPUÉS DE CARGAR ───
  // META se pedía UNA vez y se guardaba: un cliente creado luego no aparecía, y desde fuera eso se lee
  // como «ese cliente no está registrado».
  console.log('\n[3-ter] el buscador encuentra a un cliente dado de alta DESPUÉS de cargar la pantalla');
  const TARDE = 'GATE Tardio ' + TS;
  db.prepare("INSERT INTO clients (name,created_at) VALUES (?,datetime('now'))").run(TARDE);
  await p.evaluate((A) => { document.querySelector('.agcell[data-col="' + A + '"][data-min="840"]').click(); }, A);   // 14:00
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  await p.click('#cBusca');
  await p.type('#cBusca', TARDE, { delay: 20 });
  await new Promise(r => setTimeout(r, 600));
  const hallado = await p.evaluate(() => [...document.querySelectorAll('#cResultados .cliOpt')].map(o => o.textContent.trim()));
  ok(hallado.includes(TARDE), 'sale en el buscador sin recargar la pantalla', JSON.stringify(hallado));
  await p.evaluate(() => closeModal('mCita'));
  await new Promise(r => setTimeout(r, 300));

  // ── [4] El tramo de ESPERA se dibuja distinto ───────────────────────────────
  console.log('\n[4] el tramo de espera se ve distinto ("Aquí estás libre")');
  await call(p, 'POST', '/api/erp/citas', { cliente_id: CLI, user_id: A, fecha: HOY, inicio_min: 840, service_ids: [Sesp] });   // 14:00 tinte
  await p.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => document.querySelectorAll('.citaBlock').length > 0, { timeout: 8000 }).catch(() => {});
  const espera = await p.$$eval('.citaBlock div[title]', ds => ds.map(d => d.title)).catch(() => []);
  ok(espera.some(t => /Aquí estás libre/.test(t)), 'el bloque del tinte lleva su tramo de espera con "Aquí estás libre"', espera.join('|') || '(ninguno)');

  // ── [5] Choque → propone huecos cercanos ────────────────────────────────────
  console.log('\n[5] al chocar, propone huecos cercanos');
  // EL CHOQUE SE MONTA EN UN DÍA FUTURO, NO EN HOY. El motor corta el mismo día en cuanto pasa la
  // hora («si es hoy y ya pasó la hora de corte, no hay huecos hoy», citas-engine.js), así que de
  // noche el servidor no tiene NADA que proponer y el producto acierta dando el error a secas. Con
  // el escenario clavado en hoy, este gate era verde de día y rojo de noche — medido a las 23:30.
  // Se busca un día abierto y sin citas, y se monta allí el choque entero.
  const dowsOpen = new Set(db.prepare("SELECT DISTINCT dow FROM horario_tramos WHERE scope='negocio'").all().map(r => r.dow));
  const ocupado = db.prepare('SELECT 1 FROM citas WHERE fecha=? LIMIT 1');
  let DIA_CHOQUE = null;
  for (let d = 10; d <= 60 && !DIA_CHOQUE; d++) {
    const f = new Date(Date.now() + d * 86400000);
    const iso = f.toISOString().slice(0, 10);
    if ((!dowsOpen.size || dowsOpen.has(f.getUTCDay())) && !ocupado.get(iso)) DIA_CHOQUE = iso;
  }
  ok(!!DIA_CHOQUE, 'hay un día abierto y libre donde montar el choque', DIA_CHOQUE || 'ninguno en 60 días');
  // La cita que va a estorbar, y la agenda puesta en ese día.
  await call(p, 'POST', '/api/erp/citas', { cliente_id: CLI, user_id: A, fecha: DIA_CHOQUE, inicio_min: 660, service_ids: [S] });
  await p.goto(BASE + '/admin/citas', { waitUntil: 'networkidle2' });
  await p.evaluate((f) => { setVista('dia'); irA(f); }, DIA_CHOQUE);
  await p.waitForFunction((A) => !!document.querySelector('.agcell[data-col="' + A + '"][data-min="660"]'), { timeout: 8000 }, A);
  await new Promise(r => setTimeout(r, 500));
  await p.evaluate((A) => { document.querySelector('.agcell[data-col="' + A + '"][data-min="660"]').click(); }, A);   // 11:00, ya ocupado
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  await p.evaluate((nom) => { var i = document.getElementById('cBusca'); i.value = nom; cFiltra(); }, 'GATE Cli ' + TS);
  await p.waitForFunction(() => document.querySelector('#cResultados .cliOpt'), { timeout: 5000 });
  await p.evaluate(() => document.querySelector('#cResultados .cliOpt').click());
  await p.evaluate((sid) => document.querySelector('.csvc[value="' + sid + '"]').click(), S);
  await p.evaluate(() => cGuardar());
  await p.waitForFunction(() => /Huecos cerca/.test(document.getElementById('cResumen').textContent), { timeout: 6000 }).catch(() => {});
  const resumen = await p.$eval('#cResumen', e => e.textContent);
  ok(/Huecos cerca/.test(resumen), 'el choque propone huecos cercanos (no un error seco)', resumen.slice(0, 80));
  const altLinks = await p.$$eval('#cResumen a', as => as.length).catch(() => 0);
  ok(altLinks > 0, 'los huecos alternativos son pulsables', altLinks + ' alternativas');
  await p.evaluate(() => closeModal('mCita'));

  ok(errs.length === 0, '0 errores JS en todo el flujo', errs.join(' | ') || 'limpio');
  await b.close();
} catch (e) { console.error('ERROR', e.stack || e.message); fail++; try { await b.close(); } catch {} }
finally {
  try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok); } catch {}
  for (const uid of emps) { try { db.prepare('DELETE FROM cita_servicios WHERE cita_id IN (SELECT id FROM citas WHERE user_id=?)').run(uid); } catch {} try { db.prepare('DELETE FROM cita_avisos WHERE cita_id IN (SELECT id FROM citas WHERE user_id=?)').run(uid); } catch {} try { db.prepare('DELETE FROM citas WHERE user_id=?').run(uid); } catch {} }
  try { if (excId) db.prepare('DELETE FROM horario_excepciones WHERE id=?').run(excId); } catch {}
  try { if (excDiaId) db.prepare('DELETE FROM horario_excepciones WHERE id=?').run(excDiaId); } catch {}
  for (const sid of [S, Sesp]) { try { db.prepare('DELETE FROM service_config WHERE product_id=?').run(sid); } catch {} try { db.prepare('DELETE FROM products WHERE id=?').run(sid); } catch {} }
  try { if (CLI) db.prepare('DELETE FROM clients WHERE id=?').run(CLI); } catch {}
  for (const uid of emps) { try { db.prepare('DELETE FROM admin_users WHERE id=?').run(uid); } catch {} }
  db.close();
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
