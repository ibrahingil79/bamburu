// LA AGENDA COMO UN CALENDARIO DE VERDAD — Gate de NAVEGADOR (Escalera · paso 8 · pieza 2).
//   node scripts/gate-agenda-calendario.mjs
//
// LA PRUEBA QUE MANDA, y por eso es la primera: **crea un negocio DE CERO y llega hasta tener una cita
// puesta, sin ayuda**, exactamente como el dueño. Nada de sembrar datos a mano para que el gate pase:
// si el recorrido real se atasca en algún punto, el gate se atasca ahí.
//
// Además: [1] las tres vistas cargan y se navega entre ellas · [2] desde mes, pulsar un día abre ese
// día · [3] pulsar un hueco vacío abre la cita con día, hora y persona puestos · [4] un negocio sin
// horarios NO sale en blanco: explica que ya funciona y ofrece el horario · [5] peluquería no ve
// «Proyecto», asesoría sí · [6] 0 errores JS en móvil y escritorio.
// Crea tenants de prueba en la control.db REAL y los borra al terminar.
import puppeteer from 'puppeteer';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import Database from 'better-sqlite3';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../core/control-db.js';

let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const TS = Date.now();
const creados = [];
let b;

function borrarTenant(slug) {
  const t = getTenantBySlug(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) for (const s of ['', '-wal', '-shm']) { try { unlinkSync(join(APP_DIR, t.db_filename + s)); } catch {} }
}
// Da de alta un negocio como el registro real y devuelve { slug, db, sesión lista }.
async function negocio(oficio, etiqueta) {
  const r = await provisionTenant({
    businessName: 'GAC ' + etiqueta + ' ' + TS, ownerName: 'Ana ' + etiqueta,
    email: 'gac-' + etiqueta + '-' + TS + '@t.local', password: 'contrasena-larga-123',
    country: 'ES', sector: 'lo que sea', oficio,
  });
  creados.push(r.slug);
  const db = new Database(join(APP_DIR, r.db_filename));
  const owner = db.prepare('SELECT id,name FROM admin_users WHERE active=1').get();
  const tok = 'gac-' + etiqueta + '-' + TS;
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(tok, owner.id, now, now + 3600, 'x');
  return { slug: r.slug, db, owner, tok };
}
const abrirAgenda = async (p, n) => {
  await p.setCookie({ name: 'asess', value: n.tok, domain: n.slug + '.localhost', path: '/' });
  await p.goto('http://' + n.slug + '.localhost:3000/admin/citas', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => typeof agCargar === 'function', { timeout: 8000 });
};

try {
  b = await puppeteer.launch(launchOpts());
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 950 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push('console: ' + m.text()); });
  p.on('dialog', d => d.accept().catch(() => {}));

  // ── EL RECORRIDO REAL: negocio nuevo → cita puesta ──────────────────────────
  console.log('\n[0] LA PRUEBA QUE MANDA — negocio de cero hasta tener una cita');
  const pel = await negocio('peluqueria', 'peluqueria');
  ok(pel.db.prepare('SELECT COUNT(*) n FROM horario_tramos').get().n === 0, 'el negocio nace SIN horarios configurados (como cualquiera)');
  await abrirAgenda(p, pel);

  // [4] no sale en blanco: dice que ya funciona y ofrece el horario.
  await p.waitForFunction(() => document.querySelectorAll('.agcell.libre').length > 0, { timeout: 8000 });
  const aviso = await p.evaluate(() => {
    const el = document.getElementById('agSinHorario');
    return { visible: !!el && el.offsetParent !== null, texto: el ? el.textContent.replace(/\s+/g, ' ').trim() : '', enlace: el ? !!el.querySelector('a[href="/admin/citas/horarios"]') : false };
  });
  ok(aviso.visible, 'la agenda sin horarios NO sale muda: hay aviso');
  ok(/ya funciona/i.test(aviso.texto) && /pulsa cualquier hueco/i.test(aviso.texto),
    'y dice lo que PUEDE hacer ya, no lo que le "falta": «' + aviso.texto.slice(0, 80) + '…»');
  ok(aviso.enlace, 'con el horario a un clic');

  // [3] el hueco se ve pulsable Y lo es.
  const huecos = await p.evaluate(() => document.querySelectorAll('.agcell.libre').length);
  ok(huecos > 0, 'hay ' + huecos + ' huecos pulsables de entrada');
  // Se lleva el hueco al CENTRO antes de pasarle el ratón: desde que la rejilla es un lienzo con
  // scroll propio y cabecera fija, por la tarde arranca desplazada a la hora actual y el hueco de las
  // 11:00 queda fuera de vista o justo debajo de la cabecera — y el ratón caería sobre ella, no sobre
  // el hueco. El gate no puede depender de qué hora sea.
  await p.evaluate(() => document.querySelector('.agcell.libre[data-min="660"]').scrollIntoView({ block: 'center' }));
  await new Promise(r => setTimeout(r, 200));
  await p.hover('.agcell.libre[data-min="660"]');
  await new Promise(r => setTimeout(r, 300));
  const afford = await p.evaluate(() => {
    const c = document.querySelector('.agcell.libre[data-min="660"]');
    const s = getComputedStyle(c), a = getComputedStyle(c, '::after');
    return { fondo: s.backgroundColor, sombra: s.boxShadow, pista: (a.content || '').replace(/"/g, ''), foco: c.getAttribute('tabindex') };
  });
  ok(afford.fondo !== 'rgba(0, 0, 0, 0)' && afford.sombra !== 'none',
    'al pasar por encima CAMBIA (fondo ' + afford.fondo + ')');
  ok(/Nueva cita/.test(afford.pista), 'y aparece la pista «' + afford.pista + '»');
  ok(afford.foco === '0', 'y se puede alcanzar con el teclado (tabindex)');

  await p.evaluate(() => document.querySelector('.agcell.libre[data-min="660"]').click());
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  const ctx = await p.$eval('#cContexto', e => e.textContent.trim());
  ok(ctx.split('·').length === 3, 'al pulsarlo se abre la cita con persona · día · hora: «' + ctx + '»');
  ok(/11:00/.test(ctx), 'con la hora del hueco que se pulsó (11:00)');

  // [5] El panel pide SOLO lo que este negocio tiene: ni Proyecto, ni Silla, ni persona.
  const campos = await p.evaluate(() => {
    document.getElementById('cMas').open = true;
    const v = id => { const e = document.getElementById(id); return !!e && e.offsetParent !== null; };
    return {
      proyecto: v('cProyectoWrap'), silla: v('cRecursoWrap'), quien: v('cQuien'),
      enElDom: !!document.getElementById('cProyecto') && !!document.getElementById('cRecurso'),
      visibles: [...document.querySelectorAll('#mCita .form-group')].filter(g => g.offsetParent !== null)
        .map(g => (g.querySelector('.form-label') || {}).textContent || '').filter(Boolean),
    };
  });
  ok(!campos.proyecto, 'peluquería: «Proyecto» NO se pinta');
  ok(!campos.silla, 'sin sillas dadas de alta, el selector de «Silla» tampoco se pinta');
  ok(!campos.quien, 'con una sola persona, «Con quién» tampoco');
  ok(campos.enElDom, '…los tres siguen en el DOM (si se quitaran, editar una cita borraría sus datos)');
  // Ojo al contexto: esto es el panel abierto DESDE EL HUECO, donde día y hora se heredan de la celda
  // y no se re-preguntan (Agenda Sencilla). Así que aquí lo correcto es cliente + servicio, y nada más.
  ok(campos.visibles.join(' · ') === 'Cliente * · Servicio * · Nota',
    'así que desde el hueco el panel pide solo lo que este negocio tiene: ' + campos.visibles.join(' · '));

  // Y se crea la cita de verdad, con lo que hay: cliente + servicio del catálogo del oficio.
  const creada = await p.evaluate(async () => {
    document.getElementById('cMas').open = false;
    document.getElementById('cBusca').value = 'Marta Gómez';
    document.getElementById('cNuevoNombre').textContent = 'Marta Gómez';
    cUsarNuevo();
    const cb = document.querySelector('.csvc'); if (!cb) return { ok: false, motivo: 'sin servicios en el catálogo' };
    const nombre = cb.parentElement.textContent.trim();
    cb.checked = true; await cServChange();
    await new Promise(r => setTimeout(r, 800));
    await cGuardar();
    await new Promise(r => setTimeout(r, 1000));
    return { ok: !document.getElementById('mCita').classList.contains('open'), servicio: nombre };
  });
  ok(creada.ok, 'se guarda la cita sin salir del panel' + (creada.motivo ? ' (' + creada.motivo + ')' : ''));
  const cita = pel.db.prepare("SELECT id,fecha,inicio_min,user_id,cliente_suelto_nombre FROM citas ORDER BY id DESC LIMIT 1").get();
  ok(cita != null && cita.cliente_suelto_nombre === 'Marta Gómez' && cita.inicio_min === 660,
    'y queda en la BD a las 11:00 con su cliente', cita ? JSON.stringify(cita) : 'no hay cita');
  ok(cita != null && String(cita.user_id) === String(pel.owner.id), 'asignada a la única persona del negocio');
  console.log('    → recorrido completo: negocio nuevo → agenda → hueco → cita. Servicio usado: ' + (creada.servicio || '?'));

  // ── [1] Las tres vistas ────────────────────────────────────────────────────
  console.log('\n[1] las tres vistas cargan y se navega entre ellas');
  for (const v of ['dia', 'semana', 'mes']) {
    await p.evaluate((v) => setVista(v), v);
    await p.waitForFunction((v) => {
      const n = document.getElementById('agenda');
      return v === 'mes' ? n.querySelectorAll('.mesdia').length > 0 : n.querySelectorAll('.agcell').length > 0;
    }, { timeout: 8000 }, v);
    const activo = await p.evaluate(() => ['vbDia', 'vbSemana', 'vbMes'].filter(id => document.getElementById(id).getAttribute('aria-selected') === 'true'));
    ok(activo.length === 1, 'vista «' + v + '» carga y su segmento queda marcado (' + activo[0] + ')');
  }
  // DISEÑO §6: un solo primario azul por pantalla. El selector de vista es UN control segmentado,
  // no tres botones compitiendo con «Nueva cita».
  const azules = await p.evaluate(() => ({
    primarios: document.querySelectorAll('.ph .btn-primary').length,
    segmentado: !!document.querySelector('.segmented'),
    segmentosAzules: [...document.querySelectorAll('.segmented button')].filter(b => b.classList.contains('btn-primary')).length,
  }));
  ok(azules.segmentado, 'las tres vistas van en un control segmentado');
  ok(azules.primarios === 1 && azules.segmentosAzules === 0,
    'y solo hay UN botón primario azul en la cabecera (DISEÑO §6)', 'primarios=' + azules.primarios);
  // El mes es un CALENDARIO, no una hoja de cálculo: número + puntos, sin cuadrícula ni texto dentro.
  // El dato exacto vive en el aria-label de cada día y en el pie, que sigue al día que señalas.
  const mes = await p.evaluate(() => {
    const dias = [...document.querySelectorAll('.mesdia')];
    const hoy = document.querySelector('.mesdia.hoy');
    return {
      conPuntos: dias.filter(d => d.querySelectorAll('.pt').length > 0).length,
      conCita: dias.filter(d => /1 cita/.test(d.getAttribute('aria-label') || '')).length,
      conHueco: dias.filter(d => /libre/.test(d.getAttribute('aria-label') || '')).length,
      sinTextoDentro: dias.every(d => !/libre|cita/.test(d.textContent)),
      hoyEnCirculo: !!hoy && getComputedStyle(hoy.querySelector('.num')).borderRadius.startsWith('50%'),
      pie: (document.getElementById('mesPie') || {}).textContent || '',
      // P3 (18 ago 2026) quitó el SEGUNDO título de dentro de la tarjeta: el que manda es el grande
      // de la cabecera. La exigencia no cambia — sigue teniendo que decir «Mes AAAA».
      titulo: (document.getElementById('agTitulo') || {}).textContent || '',
    };
  });
  ok(mes.conCita === 1, 'el mes cuenta la cita recién creada (aria-label «1 cita»)');
  ok(mes.conPuntos === 1, 'y la dibuja con un PUNTO, no con texto (' + mes.conPuntos + ' día con punto)');
  ok(mes.sinTextoDentro, 'ninguna casilla lleva texto dentro: es un calendario, no una tabla');
  ok(mes.conHueco > 0, 'cada día dice cuánto hueco queda (' + mes.conHueco + ' días), en su etiqueta');
  ok(mes.hoyEnCirculo, 'hoy va en círculo, como en el calendario del sistema');
  ok(/^[A-ZÁÉÍÓÚ]\S* \d{4}$/.test(mes.titulo.trim()), 'el título es «Mes AAAA», sin “de” capitalizado: «' + mes.titulo.trim() + '»');
  ok(/libre|cita/.test(mes.pie), 'y el pie lleva los números exactos del día seleccionado: «' + mes.pie.trim().slice(0, 60) + '»');

  // ── [2] Desde mes, llegar a ese día ────────────────────────────────────────
  // CAMBIO DELIBERADO (AGENDA · ACABADO VISUAL, 18 ago 2026): un clic SELECCIONA el día y actualiza la
  // franja de abajo; abrir el día son dos clics (o «Abrir el día →»). Antes un clic abría directamente.
  // La aserción no se debilita: se sigue exigiendo llegar a ESE día desde el mes.
  console.log('\n[2] desde mes se llega a ESE día (un clic selecciona, dos abren)');
  const objetivo = await p.evaluate(() => {
    const d = [...document.querySelectorAll('.mesdia:not(:disabled)')].find(x => x.getAttribute('data-fecha'));
    const f = d.getAttribute('data-fecha');
    d.click();                                    // selecciona, sin salir del mes
    return f;
  });
  await new Promise(r => setTimeout(r, 300));
  const siguesEnMes = await p.evaluate(() => document.getElementById('agVista').value === 'mes');
  ok(siguesEnMes, 'un clic SELECCIONA el día y no se sale del mes');
  await p.evaluate((f) => {
    const d = document.querySelector('.mesdia[data-fecha="' + f + '"]');
    d.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }, objetivo);
  await p.waitForFunction(() => document.querySelectorAll('.agcell').length > 0, { timeout: 8000 });
  const tras = await p.evaluate(() => ({ fecha: document.getElementById('agFecha').value, vista: document.getElementById('agVista').value }));
  ok(tras.vista === 'dia' && tras.fecha === objetivo, 'y pulsándolo dos veces se abre la vista de Día en esa fecha (' + objetivo + ')', JSON.stringify(tras));

  // Navegación adelante/atrás en la unidad correcta.
  const antes = await p.evaluate(() => document.getElementById('agFecha').value);
  await p.evaluate(() => agMover(1));
  await new Promise(r => setTimeout(r, 500));
  const despues = await p.evaluate(() => document.getElementById('agFecha').value);
  ok(new Date(despues) - new Date(antes) === 86400000, 'en Día, «›» avanza un día (' + antes + ' → ' + despues + ')');

  // ── [6] Móvil ──────────────────────────────────────────────────────────────
  console.log('\n[6] móvil 390×844');
  await p.setViewport({ width: 390, height: 844, isMobile: true });
  await abrirAgenda(p, pel);
  await p.evaluate(() => setVista('mes'));
  await p.waitForFunction(() => document.querySelectorAll('.mesdia').length > 0, { timeout: 8000 });
  const desborda = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok(!desborda, 'el mes no desborda a lo ancho en móvil');
  await p.setViewport({ width: 1400, height: 950 });

  // ── [5-bis] Asesoría SÍ ve Proyecto ────────────────────────────────────────
  console.log('\n[5] «Proyecto» según el oficio');
  const ase = await negocio('asesoria', 'asesoria');
  await abrirAgenda(p, ase);
  await p.waitForFunction(() => typeof openNuevaCita === 'function', { timeout: 8000 });
  await p.evaluate(() => openNuevaCita());
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  const proyAse = await p.evaluate(() => { document.getElementById('cMas').open = true; const w = document.getElementById('cProyectoWrap'); return !!w && w.offsetParent !== null; });
  ok(proyAse, 'asesoría: «Proyecto» SÍ se pinta');

  // Y el puesto reaparece en cuanto el negocio da de alta uno: se oculta por VACÍO, no por oficio.
  console.log('\n[5-bis] el puesto vuelve en cuanto existe');
  ase.db.prepare("INSERT INTO recursos (nombre,tipo,active) VALUES ('Sala 1','sala',1)").run();
  await abrirAgenda(p, ase);
  await p.waitForFunction(() => typeof openNuevaCita === 'function', { timeout: 8000 });
  await p.evaluate(() => openNuevaCita());
  await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 8000 });
  const conPuesto = await p.evaluate(() => { document.getElementById('cMas').open = true; const w = document.getElementById('cRecursoWrap'); return !!w && w.offsetParent !== null; });
  ok(conPuesto, 'tras dar de alta una «Sala», el selector de puesto vuelve a pintarse');

  // ── LA PUERTA A LAS PERSONAS SIGUE EXISTIENDO — EN SU SITIO NUEVO ─────────────────────────────
  // ⚠️ ESTA COMPROBACIÓN HA CAMBIADO DE PANTALLA, y se dice para que no parezca que se ha perdido.
  // Nació porque en el área de Agenda no había ninguna puerta a las PERSONAS: la peluquera que quería
  // dar de alta a su segunda estilista se encontraba «Sillas» como lo más parecido. Se resolvió
  // metiendo «Quién atiende» en el desplegable de Agenda. El 18 ago 2026 esa entrada se mudó a la
  // configuración del negocio y se llama «Mi equipo» (decisión de producto de Ibrahin: en Agenda solo
  // vive lo que se usa atendiendo clientes). Lo que esta línea protege NO era el sitio: era que la
  // puerta exista y se pueda pulsar. Así que se comprueba donde vive ahora.
  await p.goto('http://' + ase.slug + '.localhost:3000/admin/settings', { waitUntil: 'networkidle0' });
  const puerta = await p.evaluate(() => {
    const a = [...document.querySelectorAll('.cfg-item')].find(x => /Mi equipo/i.test(x.textContent));
    return a ? a.getAttribute('href') : null;
  });
  ok(puerta === '/admin/users',
     'la puerta a las personas sigue existiendo: «Mi equipo» en la configuración del negocio', String(puerta));

  console.log('\n[7] errores de JavaScript');
  ok(errs.length === 0, '0 errores JS en móvil y escritorio', errs.slice(0, 3).join(' | '));

  try { pel.db.close(); ase.db.close(); } catch {}
} catch (e) {
  fail++; console.error('\n  ✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  try { if (b) await b.close(); } catch {}
  for (const s of creados) { try { borrarTenant(s); } catch {} }
  console.log('\n  (limpiados ' + creados.length + ' negocios de prueba)');
}

console.log('\n──────────────────────────────');
console.log('  ' + pass + ' OK · ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
