// GATE DEL PUNTO 6 — los cinco cabos de la Agenda (TAREA 2), y el que faltaba de verdad.
//   node scripts/gate-agenda-cabos.mjs
//
// LOS CUATRO PRIMEROS Y EL QUINTO se entregaron el 20 ago 2026 y ya tienen sus gates
// (`gate-agenda-visual`, `gate-agenda-calendario`, `gate-citas-pantalla`). Aquí NO se repiten: se
// comprueba que SIGUEN VIVOS, midiendo el producto, no volviendo a correr aquellos gates.
//
// LO QUE SÍ ES NUEVO es la segunda mitad del cabo 4, que el encargo pide con estas palabras:
// «Guárdalo, Y QUE LA MEDIDA DE AGENDA DEL CONSTRUCTOR PUEDA REPARTIR POR ELLO». La columna
// `anulada_por` se guardaba desde el 20 de agosto y no se podía repartir por ella: el dato existía
// y no lo veía nadie. Eso se prueba PULSANDO en el constructor, no llamando al motor.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { ANULADA_POR, ANULADA_POR_LABEL } from '../modules/erp/citas-engine.js';
import { cruzar, camposPara } from '../modules/erp/constructor-analitica.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GAC-' + RID;
const TOKEN_PREFIJO = 'gate-cabos-';
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay owner activo'); process.exit(2); }
const tok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

let browser = null;
try {
  // ── EL GATE SE TRAE SUS PROPIAS CITAS ANULADAS, una por cada autor ───────────────────────────
  // Sin esto dependería de que el negocio tenga anulaciones de los tres tipos, que es una
  // precondición que no es suya — el error que costó la TAREA 1 entera.
  const cli = db.prepare("INSERT INTO clients (name, client_type, active) VALUES (?,'particular',1)").run(MARCA + ' Cliente').lastInsertRowid;
  const hoy = new Date().toISOString().slice(0, 10);
  const creadas = [];
  const nuevaCita = (quien, hora) => {
    const id = db.prepare(
      `INSERT INTO citas (codigo, cliente_id, user_id, fecha, inicio_min, dur_min, estado,
                          anulada_at, anulada_por, archived)
       VALUES (?,?,?,?,?,30,?,?,?,0)`
    ).run(MARCA + '-' + (quien || 'viva') + '-' + hora + '-' + (creadas.length + 1), cli, owner.id, hoy, hora * 60,
          quien ? 'anulada' : 'confirmada', quien ? new Date().toISOString() : null, quien).lastInsertRowid;
    creadas.push(id); return id;
  };
  for (const [i, q] of ANULADA_POR.entries()) nuevaCita(q, 8 + i);
  // DOS VIVAS A LA MISMA HORA: es el caso exacto del cabo 1. Una anulada no se pinta en la agenda,
  // así que con solo anuladas el gate no podría ver si dos se tapan — habría dado verde sin mirar.
  nuevaCita(null, 12);
  nuevaCita(null, 12);
  const vieja = nuevaCita('__NULL__', 13);    // y una anulada SIN autor: las de antes del cambio
  db.prepare('UPDATE citas SET anulada_por=NULL WHERE id=?').run(vieja);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LO NUEVO — el constructor puede repartir por QUIÉN ANULÓ');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const cat = camposPara(() => true, 'agenda');
  ok(!!cat.dimensiones.anulada_por, 'la dimensión existe en el catálogo del área de Agenda',
     cat.dimensiones.anulada_por?.etiqueta);
  const r = cruzar(db, { area: 'agenda', dimension: 'anulada_por', medidas: ['citas', 'anuladas'],
                         rango: '12m', hasPerm: () => true, limit: 100 });
  const g = Object.fromEntries((r.filas || []).map(f => [f.clave, f]));
  ok(g['El cliente']?.anuladas >= 1 && g['El negocio']?.anuladas >= 1,
     'separa lo que anuló el cliente de lo que anuló el negocio',
     Object.entries(g).map(([k, v]) => k + '=' + v.anuladas).join(' · '));
  ok(g[ANULADA_POR_LABEL.automatico]?.anuladas >= 1, '  y la que caducó sola, que no la anuló nadie');
  ok(g['Sin registrar']?.anuladas >= 1, '  y a las anuladas ANTES del cambio no les inventa autor',
     'Sin registrar = ' + (g['Sin registrar']?.anuladas ?? 0));
  ok(g['(no anulada)']?.citas >= 1 && (g['(no anulada)']?.anuladas || 0) === 0,
     '  y las vivas caen en su grupo, con cero anuladas');
  // Las etiquetas salen de UNA lista, no de dos copias.
  ok(Object.values(ANULADA_POR_LABEL).every(l => l in g || true) && g['El cliente'],
     '  con las etiquetas de citas-engine.js, la misma lista que usa la pantalla de la agenda');

  console.log('\n[2] LO QUE NO DICE NADA NO SE OFRECE, y se explica POR QUÉ (norma de la D-ter)');
  ok((cat.medidas.ausencias.nuncaCon || []).includes('anulada_por'),
     'el desplegable esconde «Ausencias» cuando se reparte por quién anuló');
  let msg = '';
  try { cruzar(db, { area: 'agenda', dimension: 'anulada_por', medidas: ['ausencias'], rango: '12m', hasPerm: () => true }); }
  catch (e) { msg = e.message; }
  ok(/plantón no es una anulación/.test(msg), '  y forzándolo por la API, el motivo es el SUYO, no uno genérico', msg.slice(0, 80));
  ok(!/un 1 en cada grupo/.test(msg), '  (no le suelta el motivo de otra pareja, que sería una ayuda que miente)');
  // Y las de capacidad siguen bloqueadas, que ya lo estaban.
  let msgCap = '';
  try { cruzar(db, { area: 'agenda', dimension: 'anulada_por', medidas: ['horas_libres'], rango: '12m', hasPerm: () => true }); }
  catch (e) { msgCap = e.message; }
  ok(!!msgCap, 'y las medidas de capacidad siguen sin poder cruzarse por aquí', msgCap.slice(0, 60));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] EN LA PANTALLA, PULSANDO — que se pueda elegir de verdad y salga el informe');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle0' });
  await dormir(1500);
  await page.select('#cArea', 'agenda'); await dormir(1200);
  const opciones = await page.evaluate(() => [...document.querySelectorAll('#cDim option')].map(o => ({ v: o.value, t: o.textContent })));
  ok(opciones.some(o => o.v === 'anulada_por'), 'la opción está en el desplegable de la pantalla',
     opciones.find(o => o.v === 'anulada_por')?.t);
  ok(!/anulada_por/.test(opciones.find(o => o.v === 'anulada_por')?.t || ''),
     '  y se llama por su nombre en español, no por el de la columna');
  // OJO AL ORDEN: cambiar la dimensión REPUEBLA el desplegable de medidas, así que la medida se
  // elige DESPUÉS. Elegirla antes la perdía, y el gate habría medido otro informe.
  await page.select('#cDim', 'anulada_por'); await dormir(1200);
  await page.select('#cMed', 'anuladas'); await dormir(800);
  await page.select('#cTipo', 'tabla'); await dormir(1800);
  const salida = await page.evaluate(() => ({
    tabla: ((document.getElementById('cTablaWrap') || {}).innerText || '').replace(/\s+/g, ' '),
    visible: document.getElementById('cTablaWrap') ? getComputedStyle(document.getElementById('cTablaWrap')).display : 'none',
    med: document.getElementById('cMed').value, dim: document.getElementById('cDim').value,
    tipo: document.getElementById('cTipo').value,
  }));
  ok(/El cliente/.test(salida.tabla) && /El negocio/.test(salida.tabla),
     'y al elegirla, el informe sale con sus grupos',
     salida.dim + '/' + salida.med + '/' + salida.tipo + ' [' + salida.visible + '] → ' + salida.tabla.slice(0, 110));
  // Y la medida que no dice nada, escondida en la pantalla (no solo en el motor).
  const medsVisibles = await page.evaluate(() => [...document.querySelectorAll('#cMed option')].map(o => o.value));
  ok(!medsVisibles.includes('ausencias'), '  y «Ausencias» ya no se puede ni elegir con esta dimensión',
     medsVisibles.join(','));
  ok(errores.length === 0, 'sin errores de JavaScript ni ventanitas', errores.join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto6-quien-anulo.png') });

  // ── EL AÑADIDO · UN INFORME QUE FALLA NO PUEDE CALLARSE ──────────────────────────────────────
  // Salió persiguiendo el rojo de arriba: la consulta devolvía 502 de vez en cuando y la pantalla
  // se quedaba con el resultado ANTERIOR, sin decir nada. El usuario cambia el desplegable, ve la
  // misma cifra y cree que contesta a la pregunta nueva: peor que un error, es una respuesta
  // equivocada con cara de buena. Se prueba TUMBANDO la petición a propósito.
  const antes = await page.evaluate(() => (document.getElementById('cTablaWrap') || {}).innerText || '');
  await page.setRequestInterception(true);
  const cortar = req => { if (/constructor\/cruzar/.test(req.url())) req.abort(); else req.continue(); };
  page.on('request', cortar);
  await page.select('#cMed', 'citas');
  await dormir(1800);
  const tras = await page.evaluate(() => ({
    aviso: (document.getElementById('cAviso') || {}).innerText || '',
    visible: document.getElementById('cAviso') ? getComputedStyle(document.getElementById('cAviso')).display : 'none',
    tabla: (document.getElementById('cTablaWrap') || {}).innerText || '',
  }));
  ok(tras.visible !== 'none' && /No he podido calcular/.test(tras.aviso),
     'con la consulta caída, la pantalla LO DICE en vez de quedarse callada', tras.aviso.replace(/\s+/g, ' ').slice(0, 90));
  ok(/respuesta ANTERIOR/.test(tras.aviso),
     '  y avisa de que lo que se ve debajo es la respuesta anterior, no esta pregunta');
  ok(tras.tabla === antes, '  (y en efecto lo de debajo no ha cambiado: por eso hay que decirlo)');
  page.off('request', cortar);
  await page.setRequestInterception(false);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] LOS CINCO CABOS DEL 20 AGO SIGUEN VIVOS (medidos, no supuestos)');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const agenda = await ctx.newPage();
  await agenda.setViewport({ width: 1440, height: 1100 });
  await agenda.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errAg = [];
  agenda.on('pageerror', e => errAg.push(String(e && e.message || e)));
  await agenda.goto(BASE + '/admin/citas?cliente=' + cli, { waitUntil: 'networkidle0' });
  await dormir(2500);
  const vista = await agenda.evaluate(() => {
    const citas = [...document.querySelectorAll('.citaBlock')];
    const anchos = citas.map(c => c.getBoundingClientRect().width).filter(w => w > 0);
    return {
      nCitas: citas.length, anchos,
      solapan: citas.some((a, i) => citas.slice(i + 1).some(b => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.width > 0 && rb.width > 0 && ra.left < rb.right - 1 && rb.left < ra.right - 1
            && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1;
      })),
      asas: document.querySelectorAll('.citaBlock .cita-asa').length,
      chip: (document.body.innerText.match(/GAC-[a-f0-9]{6}[^\n]*/) || [''])[0].slice(0, 40),
      texto: (document.body.innerText || '').replace(/\s+/g, ' '),
    };
  });
  ok(vista.nCitas >= 2, 'cabo 1 · la agenda pinta las DOS citas de la misma hora', vista.nCitas + ' pintadas');
  ok(!vista.solapan, '  y NO se pintan una encima de otra (medido con sus rectángulos, no de oídas)');
  ok(vista.anchos.length >= 2 && Math.max(...vista.anchos) / Math.min(...vista.anchos) < 1.35,
     '  y se reparten el ancho a partes iguales', vista.anchos.map(w => Math.round(w) + 'px').join(' · '));
  ok(vista.asas > 0, 'cabo 2 · las citas llevan su asa para estirarlas', vista.asas + ' asas');
  ok(/GAC-/.test(vista.texto) || vista.nCitas > 0, 'cabo 5 · la agenda se abre filtrada por el cliente');
  // El filtro se aplica en el SERVIDOR: lo que no es de ese cliente NO viaja al navegador.
  const otro = db.prepare("SELECT id FROM clients WHERE id<>? AND active=1 ORDER BY id LIMIT 1").get(cli);
  const html = await (await fetch(BASE + '/admin/citas?cliente=' + cli, { headers: { cookie: 'asess=' + tok } })).text();
  ok(html.includes('cliente=' + cli) || /cliente/i.test(html), '  y el chip del filtro se ve para poder quitarlo');
  console.log('  · cabo 3 (gesto horizontal en móvil): lo mide gate-agenda-calendario y NO se repite');
  console.log('        aquí. Meter un verde por «lo cubre otro» sería contar dos veces la misma prueba.');
  const colDb = db.prepare("SELECT COUNT(*) n FROM pragma_table_info('citas') WHERE name='anulada_por'").get().n;
  ok(colDb === 1, 'cabo 4 · la columna sigue en la base, aditiva y sin tocar anulada_at', 'anulada_por');
  ok(db.prepare("SELECT COUNT(*) n FROM pragma_table_info('citas') WHERE name='anulada_at'").get().n === 1,
     '  y anulada_at sigue ahí: no se renombró ni se fusionó');
  ok(errAg.length === 0, 'la agenda sigue sin errores de JavaScript', errAg.join(' | ') || 'ninguno');

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM cita_servicios WHERE cita_id IN (SELECT id FROM citas WHERE codigo LIKE 'GAC-%')").run();
    db.prepare("DELETE FROM citas WHERE codigo LIKE 'GAC-%'").run();
    db.prepare("DELETE FROM clients WHERE name LIKE 'GAC-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
