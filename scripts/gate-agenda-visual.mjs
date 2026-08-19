// Gate — AGENDA · ACABADO VISUAL (día, semana y mes). Tarea de PRESENTACIÓN.
//
// Contra el servidor REAL y sobre un negocio CREADO DESDE CERO (y borrado al final). Comprueba que la
// rejilla dejó de ser una tabla de filas de media hora y es un LIENZO donde cada cita se coloca por
// sus minutos reales — y que al hacerlo no se rompió nada de lo que ya funcionaba.
//
// Las TRES que pidió Ibrahin además de las diez del encargo, y que son las que protegen lo que ya
// había: [11] pulsar una cita abre ESA cita (las zonas de clic van por DEBAJO) · [12] cabeceras y
// columna de horas fijas al hacer scroll (lo que la <table> daba gratis) · [13] el mes respeta los
// mismos filtros que el día.
//
//   node scripts/gate-agenda-visual.mjs
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
import { ahoraLocal } from '../modules/erp/citas-engine.js';
import { ESTADOS_COLOR } from '../modules/erp/routes/citas.js';

const RID = randomBytes(3).toString('hex');
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOY = ahoraLocal().fecha;
const dormir = ms => new Promise(r => setTimeout(r, ms));
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
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
  }
}
const otroDia = n => new Date(Date.parse(HOY + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

try {
  console.log('\n[0] DE CERO — negocio nuevo, oficio y horario');
  const alta = await provisionTenant({
    businessName: 'Gate Visual ' + RID, ownerName: 'Dueña Gate',
    email: 'gate-visual-' + RID + '@bamburu.test', password: 'Gate.Visual.' + RID + '!', phone: '+34 600 000 000',
  });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  ok(!!t, 'negocio creado desde cero', slug);
  db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename));
  const BASE = 'http://' + slug + '.localhost:3000';
  fijarOficio(db, 'peluqueria');
  sembrarCatalogo(db, 'peluqueria', (d, i) => createProductSvc(d, i));
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();
  const insTramo = db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES (?,?,?,?,?)");
  for (let dow = 0; dow <= 6; dow++) insTramo.run('negocio', null, dow, 9 * 60, 18 * 60);
  ok(db.prepare('SELECT COUNT(*) n FROM horario_tramos').get().n === 7, 'horario del negocio 9:00–18:00');

  const svc = db.prepare("SELECT p.id FROM products p JOIN service_config sc ON sc.product_id=p.id WHERE sc.reservable=1 LIMIT 1").get();
  const cliente = n => db.prepare("INSERT INTO clients (name,created_at) VALUES (?,datetime('now'))").run(n).lastInsertRowid;

  const now = Math.floor(Date.now() / 1000);
  const sesion = uid => {
    const tok = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
      .run(tok, uid, now, now + 3600, randomBytes(32).toString('base64url'));
    return tok;
  };
  browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  await page.setViewport({ width: 1400, height: 900 });
  await page.setCookie({ name: 'asess', value: sesion(owner.id), domain: slug + '.localhost', path: '/' });
  const abrir = async (f) => {
    await page.goto(BASE + '/admin/citas' , { waitUntil: 'networkidle0' });
    if (f) await page.evaluate(x => irA(x), f);
    await page.waitForFunction(() => !!document.getElementById('agWrap'), { timeout: 8000 });
    await dormir(400);
  };
  const crear = async (b) => page.evaluate(async x => { try { return await api('POST', '/api/erp/citas', x); } catch (e) { return { error: e.message }; } }, b);

  // ── LA CITA A UNA HORA QUE NO ES NI EN PUNTO NI Y MEDIA ────────────────────────────────────────
  await abrir();
  const c1 = cliente('Marta Gómez');
  await crear({ cliente_id: c1, user_id: owner.id, fecha: HOY, inicio_min: 550, service_ids: [svc.id] });
  const cita = db.prepare('SELECT id,inicio_min,dur_min FROM citas ORDER BY id DESC LIMIT 1').get();
  // La duración la pone el servicio del catálogo; para medir la regla de alturas se fija a 20 min.
  db.prepare('UPDATE citas SET dur_min=20 WHERE id=?').run(cita.id);
  ok(!!cita && cita.inicio_min === 550, 'cita creada a las 9:10 (ni en punto ni y media)', JSON.stringify(cita));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA REJILLA ES UN LIENZO, NO FILAS DE 30 MIN');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.evaluate(() => setZoom(72)); await dormir(600);
  const g = await page.evaluate(() => {
    const w = document.getElementById('agWrap');
    const b = w.querySelector('.citaBlock');
    return {
      hayTabla: !!w.querySelector('table'),
      altoHora: getComputedStyle(w).getPropertyValue('--alto-hora').trim(),
      top: parseFloat(b.style.top), alto: parseFloat(b.style.height),
      celdas: w.querySelectorAll('.agcell').length,
      cols: w.querySelectorAll('.ag-col').length,
    };
  });
  ok(!g.hayTabla, 'la rejilla ya NO es una <table>');
  // 9:10 con la rejilla arrancando a las 9:00 y la hora a 72px → (550-540)*72/60 = 12px exactos.
  ok(Math.abs(g.top - 12) < 0.5, 'la cita de las 9:10 se dibuja a 12px del inicio (minutos reales, no la fila de las 9:00)', g.top + 'px');
  // 20 min → 24px; pero el mínimo visible es 22px, así que 24 manda.
  ok(Math.abs(g.alto - 24) < 0.5, 'y con la altura de sus 20 minutos', g.alto + 'px');
  ok(g.celdas > 0 && g.cols > 0, 'el lienzo conserva sus zonas de clic de 30 min', g.celdas + ' zonas en ' + g.cols + ' columna(s)');

  // ── [2] Solo la hora en punto lleva texto ─────────────────────────────────────────────────────
  const et = await page.evaluate(() => [...document.querySelectorAll('.ag-hora')].map(e => e.textContent.trim()));
  ok(et.length > 0 && et.every(x => /:00$/.test(x)), 'solo las horas EN PUNTO llevan etiqueta (ninguna y media)', et.join(' '));
  ok(et.includes('9:00') && !et.includes('09:00'), 'y en formato «9:00», no «09:00»');

  // ── [3] No hay fondo alterno de filas ─────────────────────────────────────────────────────────
  const zebra = await page.evaluate(() => {
    let n = 0;
    for (const ss of document.styleSheets) {
      let rs; try { rs = ss.cssRules; } catch (e) { continue; }
      for (const r of rs || []) {
        if (!r.selectorText || !/nth-child|nth-of-type/.test(r.selectorText)) continue;
        if (/agcell|ag-col|ag-body|tbody|\btr\b/.test(r.selectorText) && /background/.test(r.cssText)) n++;
      }
    }
    return n;
  });
  ok(zebra === 0, 'no existe ninguna regla de fondo alterno en las filas de la rejilla', zebra + ' reglas');

  // ── [4] La línea de ahora ─────────────────────────────────────────────────────────────────────
  // La jornada se abre de par en par para este trozo: el navegador va en UTC y el horario de prueba
  // es 9–18, así que a las 8:50 UTC «ahora» cae FUERA de la rejilla y la línea se oculta — que es lo
  // correcto, pero deja la prueba midiendo el reloj en vez del producto. Tercera vez con la misma
  // trampa: aquí no se vuelve a caer.
  db.prepare("DELETE FROM horario_tramos WHERE scope='negocio'").run();
  for (let dow = 0; dow <= 6; dow++) insTramo.run('negocio', null, dow, 0, 24 * 60 - 1);
  await abrir();
  ok(await page.evaluate(() => !!document.getElementById('agAhora')), 'con HOY a la vista, la línea de ahora se pinta');
  ok(await page.evaluate(() => { const p = document.getElementById('agAhoraH'); return !!p && /^\d{1,2}:\d{2}$/.test(p.textContent); }),
     'con su pastilla de la hora actual sobre la columna de horas');
  await abrir(otroDia(7));
  ok(!(await page.evaluate(() => !!document.getElementById('agAhora'))), 'en un día que NO es hoy, la línea de ahora NO aparece');
  db.prepare("DELETE FROM horario_tramos WHERE scope='negocio'").run();
  for (let dow = 0; dow <= 6; dow++) insTramo.run('negocio', null, dow, 9 * 60, 18 * 60);

  // ── [5] El scroll de apertura ─────────────────────────────────────────────────────────────────
  // Se abre la jornada de par en par (0:00–23:59) para este trozo: con un horario de 9 a 18 y siendo
  // por la mañana, colocar "ahora" a un tercio da un scroll NEGATIVO — o sea 0, y no se probaría nada.
  db.prepare("DELETE FROM horario_tramos WHERE scope='negocio'").run();
  for (let dow = 0; dow <= 6; dow++) insTramo.run('negocio', null, dow, 0, 24 * 60 - 1);
  await abrir();
  await page.evaluate(() => setZoom(96)); await dormir(700);
  const sc = await page.evaluate(() => {
    const w = document.getElementById('agWrap');
    const l = w.querySelector('.ag-ahora');
    const r = l ? l.getBoundingClientRect() : null, rw = w.getBoundingClientRect();
    return { top: Math.round(w.scrollTop), alto: w.scrollHeight, visible: w.clientHeight,
             ahoraVisible: !!(r && r.top >= rw.top - 2 && r.top <= rw.bottom + 2),
             tercio: r ? Math.round(((r.top - rw.top) / rw.height) * 100) : null };
  });
  ok(sc.alto > sc.visible, 'con el día entero abierto, no cabe de una vez (hay que desplazar)', sc.alto + ' > ' + sc.visible);
  ok(sc.top > 0, 'y al abrir NO se queda en 0', 'scrollTop=' + sc.top);
  ok(sc.ahoraVisible && sc.tercio >= 20 && sc.tercio <= 45,
     'la hora actual queda a un tercio de lo que se ve, no pegada al borde', 'al ' + sc.tercio + '% del alto visible');
  db.prepare("DELETE FROM horario_tramos WHERE scope='negocio'").run();
  for (let dow = 0; dow <= 6; dow++) insTramo.run('negocio', null, dow, 9 * 60, 18 * 60);
  await abrir();
  await page.evaluate(() => setZoom(72)); await dormir(600);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] LA CITA COMO BLOQUE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const rgb = h => { const n = parseInt(h.slice(1), 16); return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')'; };
  const leerBloque = () => page.evaluate(() => {
    const b = document.querySelector('.citaBlock'); const cs = getComputedStyle(b);
    return { barra: cs.borderLeftColor, ancho: cs.borderLeftWidth, fondo: cs.backgroundColor, texto: cs.color,
             radio: cs.borderTopLeftRadius + '/' + cs.borderTopRightRadius, estado: b.dataset.estado,
             lineas: b.querySelectorAll('.cli,.svc,.hra').length, alto: Math.round(parseFloat(b.style.height)),
             title: b.getAttribute('title') || '' };
  });
  let bl = await leerBloque();
  const E = ESTADOS_COLOR[bl.estado];
  ok(bl.ancho === '3px' && bl.barra === rgb(E.fuerte), 'el bloque lleva barra izquierda de 3px en el tono FUERTE de su estado', bl.barra);
  ok(bl.fondo === rgb(E.suave), 'fondo en el tono SUAVE', bl.fondo);
  ok(bl.texto === rgb(E.oscuro), 'y el texto en el tono OSCURO de la misma familia, no negro', bl.texto);
  ok(bl.radio === '0px/6px', 'esquinas 0 a la izquierda (donde va la barra) y 6px a la derecha', bl.radio);

  // ── [7] Degradación por altura ────────────────────────────────────────────────────────────────
  await page.evaluate(() => setZoom(48)); await dormir(600);
  db.prepare('UPDATE citas SET dur_min=31 WHERE id=?').run(cita.id);   // 31 × 48/60 ≈ 25px
  await page.evaluate(() => agCargar()); await dormir(600);
  bl = await leerBloque();
  ok(bl.alto >= 22 && bl.alto < 40 && bl.lineas === 1, 'una cita de ~25px enseña SOLO el nombre del cliente', bl.alto + 'px · ' + bl.lineas + ' línea');
  ok(/·/.test(bl.title), 'y el servicio se va al title, no se pierde', bl.title.slice(0, 40));
  db.prepare('UPDATE citas SET dur_min=88 WHERE id=?').run(cita.id);   // 88 × 48/60 ≈ 70px
  await page.evaluate(() => agCargar()); await dormir(600);
  bl = await leerBloque();
  ok(bl.alto >= 60 && bl.lineas === 3, 'una de ~70px enseña las TRES líneas (cliente · servicio · hora)', bl.alto + 'px · ' + bl.lineas + ' líneas');
  db.prepare('UPDATE citas SET dur_min=60 WHERE id=?').run(cita.id);

  // ── [9] Los cuatro estados conservan color y nombre ───────────────────────────────────────────
  await page.evaluate(() => setZoom(72)); await dormir(600);
  const ley = await page.evaluate(() => { toggleLeyenda(); return [...document.querySelectorAll('#agLeyenda span span')].map(s => s.parentElement.textContent.trim()); });
  const esperados = Object.values(ESTADOS_COLOR).map(e => e.label);
  ok(esperados.every(l => ley.some(x => x.includes(l))), 'la leyenda conserva los cuatro estados con su nombre', ley.join(' · '));
  const colores = [];
  for (const est of ['pedida', 'confirmada', 'atendida', 'no_show']) {
    db.prepare('UPDATE citas SET estado=? WHERE id=?').run(est, cita.id);
    await page.evaluate(() => agCargar()); await dormir(450);
    colores.push(est + '=' + (await leerBloque()).barra);
  }
  ok(colores.every((c, i) => { const est = ['pedida', 'confirmada', 'atendida', 'no_show'][i]; return c === est + '=' + rgb(ESTADOS_COLOR[est].fuerte); }),
     'y cada estado conserva SU color (gris · verde · azul · rojo)', colores.join(' '));
  db.prepare("UPDATE citas SET estado='confirmada' WHERE id=?").run(cita.id);

  // ── [10] Los tres pasos de zoom, y que se recuerden ───────────────────────────────────────────
  const zooms = [];
  for (const z of [48, 96, 72]) {
    await page.evaluate(x => setZoom(x), z); await dormir(500);
    zooms.push(await page.evaluate(() => getComputedStyle(document.getElementById('agWrap')).getPropertyValue('--alto-hora').trim()));
  }
  ok(JSON.stringify(zooms) === JSON.stringify(['48px', '96px', '72px']), 'los tres pasos de zoom cambian --alto-hora', zooms.join(' '));
  await page.evaluate(() => setZoom(96)); await dormir(500);
  await abrir();
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('agWrap')).getPropertyValue('--alto-hora').trim() === '96px'),
     'y el paso elegido se RECUERDA al volver a entrar');
  await page.evaluate(() => setZoom(72)); await dormir(500);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LAS TRES QUE PROTEGEN LO QUE YA HABÍA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // [11] Pulsar una cita abre ESA cita, no el alta. Las zonas de clic van por DEBAJO.
  const apilado = await page.evaluate(() => {
    const b = document.querySelector('.citaBlock'), c = document.querySelector('.agcell');
    return { cita: +getComputedStyle(b).zIndex, celda: +getComputedStyle(c).zIndex };
  });
  ok(apilado.cita > apilado.celda, 'la cita se apila POR ENCIMA de las zonas de clic', 'cita z=' + apilado.cita + ' · zona z=' + apilado.celda);
  // Se lleva la cita a la vista ANTES de apuntarle: por la tarde el lienzo arranca desplazado a la
  // hora actual y una cita de las 9:10 queda encima del viewport, debajo de la cabecera fija. El
  // gate no puede depender de qué hora sea — es la misma trampa que tumbó a los gates de agenda.
  const alPulsar = await page.evaluate(() => {
    const b = document.querySelector('.citaBlock');
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const enc = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { esCita: !!(enc && enc.closest('.citaBlock')), etiqueta: enc ? enc.className : '' };
  });
  ok(alPulsar.esCita, 'pulsar encima de una cita alcanza LA CITA, no la zona de alta', alPulsar.etiqueta);
  await page.evaluate(() => document.querySelector('.citaBlock').click());
  await dormir(700);
  const modales = await page.evaluate(() => ({ detalle: !!document.querySelector('#mDet.open'), alta: !!document.querySelector('#mCita.open') }));
  ok(modales.detalle && !modales.alta, 'y abre la ficha de ESA cita, no el modal de cita nueva', JSON.stringify(modales));
  await page.evaluate(() => closeModal('mDet')); await dormir(300);

  // [12] Cabeceras y columna de horas fijas al hacer scroll.
  await page.evaluate(() => setZoom(96)); await dormir(600);
  const fijos = await page.evaluate(async () => {
    const w = document.getElementById('agWrap');
    const h = w.querySelector('.ag-head'), col = w.querySelector('.ag-horas');
    const antes = { head: h.getBoundingClientRect().top, horas: col.getBoundingClientRect().left };
    w.scrollTop = 300; w.scrollLeft = 0;
    await new Promise(r => setTimeout(r, 200));
    const despues = { head: h.getBoundingClientRect().top, horas: col.getBoundingClientRect().left };
    return { antes, despues, posHead: getComputedStyle(h).position, posHoras: getComputedStyle(col).position,
             cabeceras: [...w.querySelectorAll('.agcol-head')].length };
  });
  ok(fijos.posHead === 'sticky' && Math.abs(fijos.antes.head - fijos.despues.head) < 2,
     'al hacer scroll, la fila de cabeceras se queda FIJA arriba', 'top ' + Math.round(fijos.antes.head) + ' → ' + Math.round(fijos.despues.head));
  ok(fijos.posHoras === 'sticky' && Math.abs(fijos.antes.horas - fijos.despues.horas) < 2,
     'y la columna de horas fija a la izquierda', 'left ' + Math.round(fijos.antes.horas) + ' → ' + Math.round(fijos.despues.horas));
  ok(fijos.cabeceras > 0, 'cada cabecera de columna lleva su clase estable .agcol-head', fijos.cabeceras + '');
  await page.evaluate(() => setZoom(72)); await dormir(500);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] EL MES DICE QUÉ PASA SIN PASAR EL RATÓN');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await abrir();
  await page.evaluate(() => setVista('mes'));
  await page.waitForFunction(() => document.querySelectorAll('.mesdia').length > 0, { timeout: 8000 });
  await dormir(500);
  const mes = await page.evaluate(() => {
    const hoy = document.querySelector('.mesdia.hoy');
    return {
      lineas: hoy ? [...hoy.querySelectorAll('.lin')].map(l => l.textContent.trim()) : [],
      puntos: hoy ? hoy.querySelectorAll('.pt').length : 0,
      globos: document.querySelectorAll('.mesdia[title]').length,
      vacias: [...document.querySelectorAll('.mesdia:not(.otro)')].filter(d => !d.querySelector('.lin')).length,
      otros: document.querySelectorAll('.mesdia.otro').length,
      pie: (document.getElementById('mesPie') || {}).textContent || '',
    };
  });
  // El formato lo fija P3 (18 ago 2026): «9:10 Marta Gómez», la hora en negrita y sin punto medio.
  ok(mes.lineas.length >= 1 && /^\d{1,2}:\d{2}\s+\S/.test(mes.lineas[0]), 'el mes pinta las citas REALES en la celda («9:10 Marta Gómez»)', mes.lineas.join(' | '));
  ok(mes.puntos === mes.lineas.length, 'cada línea lleva el punto de color de su estado', mes.puntos + ' puntos');
  ok(mes.globos === 0, 'y ya NO existe el globo flotante (title) sobre los días');
  ok(mes.vacias > 0, 'los días sin citas no dicen nada: el silencio es información', mes.vacias + ' días callados');
  ok(mes.otros > 0, 'los días de otros meses se ven, en gris claro', mes.otros + ' días');
  // El pie es del día SELECCIONADO, y un clic selecciona sin abrir el día.
  const otro = await page.evaluate(() => {
    const d = [...document.querySelectorAll('.mesdia:not(.otro):not(.hoy):not(:disabled)')][0];
    d.click(); return d.getAttribute('data-fecha');
  });
  await dormir(400);
  const trasClic = await page.evaluate(() => ({ vista: document.getElementById('agVista').value, sel: (document.querySelector('.mesdia.sel') || {}).dataset?.fecha, pie: document.getElementById('mesPie').textContent }));
  ok(trasClic.vista === 'mes' && trasClic.sel === otro, 'UN clic selecciona el día y no se sale del mes', JSON.stringify(trasClic.sel));
  ok(trasClic.pie.includes(String(+otro.slice(8))), 'y la franja de abajo pasa a ser la del día SELECCIONADO, no la del ratón', trasClic.pie.trim().slice(0, 48));
  await page.evaluate(f => abrirDia(f), otro);
  await page.waitForFunction(() => !!document.getElementById('agWrap'), { timeout: 8000 });
  ok(await page.evaluate(() => document.getElementById('agVista').value === 'dia'), '«Abrir el día →» abre la vista Día');

  // ── [13] El mes respeta los MISMOS filtros que el día ─────────────────────────────────────────
  // Una segunda persona que NO trabaja hoy, con una cita hoy. En Día no tiene columna (salvo "ver
  // todo el equipo"), así que en Mes tampoco puede aparecer.
  const otraId = db.prepare(
    "INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Berta Libra',?,'x','employee',1,0,datetime('now'))"
  ).run('berta-' + RID + '@bamburu.test').lastInsertRowid;
  // Se libra con una EXCEPCIÓN «cerrado», que es como se libra de verdad: sin turno propio, la persona
  // HEREDA el horario del negocio y trabajaría igual (citas-engine.js, tramosPersona).
  db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,motivo) VALUES ('user',?,?,'cerrado','Libra')").run(otraId, HOY);
  const c2 = cliente('Cliente De Berta');
  db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,created_at,updated_at) VALUES (?,?,?,?,?,?,0,'confirmada',datetime('now'),datetime('now'))")
    .run('CITA-9' + RID.slice(0, 3), c2, otraId, HOY, 900, 30);
  const libra = db.prepare("SELECT COUNT(*) n FROM horario_excepciones WHERE scope='user' AND user_id=? AND fecha=? AND tipo='cerrado'").get(otraId, HOY).n;
  ok(libra === 1, 'la segunda persona LIBRA hoy (excepción cerrado), así que en Día no tiene columna');
  const pedirMes = (verTodo) => page.evaluate(async (v) => {
    const d = await api('GET', '/api/erp/citas/mes?ym=' + document.getElementById('agFecha').value.slice(0, 7) + '&eje=persona&verTodo=' + v);
    const hoy = new Date().toISOString().slice(0, 10);
    const dia = (d.dias || []).find(x => x.fecha === hoy) || {};
    return { total: dia.citas, nombres: (dia.primeras || []).map(p => p.cliente) };
  }, verTodo);
  const sinVerTodo = await pedirMes('0');
  const conVerTodo = await pedirMes('1');
  ok(!sinVerTodo.nombres.includes('Cliente De Berta'),
     'el mes NO enseña la cita de quien no tiene columna en Día', JSON.stringify(sinVerTodo.nombres));
  ok(conVerTodo.nombres.includes('Cliente De Berta'),
     'y con «ver todo el equipo» sí aparece: hereda el filtro, no lo inventa', JSON.stringify(conVerTodo.nombres));
  ok(conVerTodo.total > sinVerTodo.total, 'el total del día también respeta el filtro', sinVerTodo.total + ' → ' + conVerTodo.total);
  ok((conVerTodo.nombres.length <= 4), 'y no viaja el mes entero: como mucho 4 citas por día', conVerTodo.nombres.length + '');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] P2 — CAMBIAR DE MES');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await abrir();
  await page.evaluate(() => setVista('mes'));
  await page.waitForFunction(() => document.querySelectorAll('.mesdia').length > 0, { timeout: 8000 });
  await dormir(400);
  const sitio = await page.evaluate(() => {
    const t = document.getElementById('agTitulo').getBoundingClientRect();
    const f = [...document.querySelectorAll('.ag-nav')].map(b => b.getBoundingClientRect());
    return { dist: Math.round(f[0].x - t.x), mismaFila: Math.abs(f[0].y - t.y) < 24, n: f.length };
  });
  // Las flechas RESPONDÍAN, pero estaban a 624 px del título, en el otro extremo de la barra.
  ok(sitio.n === 2 && sitio.mismaFila && sitio.dist < 260,
     'las flechas ‹ › van PEGADAS al título, no al otro extremo de la barra', sitio.dist + 'px del título');
  const mesA = await page.evaluate(() => document.getElementById('agFecha').value.slice(0, 7));
  await page.evaluate(() => document.querySelector('.ag-nav').click());
  await dormir(900);
  const mesB = await page.evaluate(() => document.getElementById('agFecha').value.slice(0, 7));
  ok(mesA !== mesB && mesB < mesA, 'pulsar ‹ retrocede UN MES', mesA + ' → ' + mesB);
  await page.evaluate(() => document.querySelectorAll('.ag-nav')[1].click());
  await dormir(900);
  ok(await page.evaluate(m => document.getElementById('agFecha').value.slice(0, 7) === m, mesA), 'y › vuelve a avanzarlo');
  // Rueda del ratón sobre la rejilla: un mes por gesto, con freno.
  const caja = await (await page.$('.mes')).boundingBox();
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  const antesRueda = await page.evaluate(() => document.getElementById('agFecha').value.slice(0, 7));
  await page.mouse.wheel({ deltaY: 300 }); await dormir(900);
  const trasRueda = await page.evaluate(() => document.getElementById('agFecha').value.slice(0, 7));
  ok(trasRueda !== antesRueda, 'la rueda del ratón sobre la rejilla cambia de mes', antesRueda + ' → ' + trasRueda);
  // EL FRENO. Se prueba con una RÁFAGA de verdad —diez eventos seguidos, que es lo que manda un
  // trackpad en un solo gesto—, no con tres `mouse.wheel` de puppeteer: entre esos pasa tanto tiempo
  // por el protocolo que el freno ni se entera y la prueba no probaría nada.
  const desdeRafaga = await page.evaluate(() => document.getElementById('agFecha').value.slice(0, 7));
  await page.evaluate(() => {
    const d = document.querySelector('.mesdia');
    for (let i = 0; i < 10; i++) d.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
  });
  await dormir(900);
  const trasRafaga = await page.evaluate(() => document.getElementById('agFecha').value.slice(0, 7));
  const saltos = (new Date(trasRafaga + '-01') - new Date(desdeRafaga + '-01')) / (28 * 86400000);
  ok(saltos >= 0.9 && saltos <= 1.2, 'y lleva freno: diez eventos de un mismo gesto avanzan UN mes, no diez',
     desdeRafaga + ' → ' + trasRafaga);
  await page.evaluate(() => agHoy()); await dormir(800);
  ok(await page.evaluate(() => document.getElementById('agFecha').value.slice(0, 7) === new Date().toISOString().slice(0, 7)),
     '«Hoy» vuelve al mes actual');
  ok(await page.evaluate(() => { document.getElementById('agTitulo').click(); return document.getElementById('agFecha').style.display !== 'none'; }),
     'y pulsar el título abre el selector de fecha');
  await page.evaluate(() => { document.getElementById('agFecha').style.display = 'none'; });
  // En Día la rueda NO secuestra: desplaza el lienzo y no cambia de fecha.
  await page.evaluate(() => setVista('dia'));
  await page.waitForFunction(() => !!document.getElementById('agWrap'), { timeout: 8000 });
  await page.evaluate(() => setZoom(96)); await dormir(700);
  const cw = await (await page.$('#agWrap')).boundingBox();
  // Arriba del todo: si el lienzo ya está al final (por la tarde lo está), la rueda no tiene adónde
  // desplazar y la prueba mediría el tope, no el comportamiento.
  await page.evaluate(() => { document.getElementById('agWrap').scrollTop = 0; });
  await dormir(200);
  const s0 = await page.evaluate(() => ({ sc: document.getElementById('agWrap').scrollTop, f: document.getElementById('agFecha').value }));
  await page.mouse.move(cw.x + cw.width / 2, cw.y + cw.height / 2);
  await page.mouse.wheel({ deltaY: 250 }); await dormir(500);
  const s1 = await page.evaluate(() => ({ sc: document.getElementById('agWrap').scrollTop, f: document.getElementById('agFecha').value }));
  ok(s1.sc > s0.sc && s1.f === s0.f, 'en Día la rueda desplaza el lienzo y NO cambia de fecha', s0.sc + ' → ' + s1.sc);
  await page.evaluate(() => setZoom(72)); await dormir(500);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] P3 — EL LAYOUT DEL MES');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Datos de verdad: cinco citas un mismo día y citas en otros días distintos. Un mes vacío no prueba nada.
  const diaLleno = HOY.slice(0, 8) + '12';
  const insCita = db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,created_at,updated_at) VALUES (?,?,?,?,?,30,0,?,datetime('now'),datetime('now'))");
  const est4 = ['pedida', 'confirmada', 'atendida', 'no_show'];
  [560, 620, 700, 800, 900].forEach((m, i) => insCita.run('CITA-L' + RID + i, cliente('Lleno ' + i), owner.id, diaLleno, m, est4[i % 4]));
  [[HOY.slice(0, 8) + '05', 570], [HOY.slice(0, 8) + '06', 660], [HOY.slice(0, 8) + '19', 780], [HOY.slice(0, 8) + '26', 900]]
    .forEach(([f, m], i) => insCita.run('CITA-O' + RID + i, cliente('Otro ' + i), owner.id, f, m, est4[i % 4]));
  await abrir();
  await page.evaluate(() => setVista('mes'));
  await page.waitForFunction(() => document.querySelectorAll('.mesdia').length > 0, { timeout: 8000 });
  await dormir(600);
  const mm = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.mesdia')];
    const cs = getComputedStyle(c[8]);
    const lleno = c.find(x => x.querySelector('.mas'));
    return {
      casillas: c.length, alto: Math.round(c[8].getBoundingClientRect().height),
      separador: cs.borderRightWidth !== '0px' && cs.borderBottomWidth !== '0px',
      numAlineado: getComputedStyle(c[8].querySelector('.num')).alignSelf,
      numTam: getComputedStyle(c[8].querySelector('.num')).fontSize,
      diasConCitas: c.filter(x => x.querySelector('.lin')).length,
      vacias: c.filter(x => !x.querySelector('.lin')).length,
      lineasDelLleno: lleno ? lleno.querySelectorAll('.lin').length : 0,
      mas: lleno ? lleno.querySelector('.mas').textContent.trim() : '',
      puntos: lleno ? lleno.querySelectorAll('.pt').length : 0,
      segundoTitulo: !!document.querySelector('.mes-tit'),
      zoom: document.getElementById('agZoom').style.display,
      finde: c.filter(x => x.classList.contains('finde')).length,
      otros: c.filter(x => x.classList.contains('otro')).length,
    };
  });
  ok(mm.separador, 'las casillas del mes tienen separadores (antes no había ni una línea)');
  ok(mm.alto >= 84, 'la casilla mide al menos 84px de alto', mm.alto + 'px');
  ok(mm.numAlineado === 'flex-start' && mm.numTam === '12px', 'el número del día va arriba a la IZQUIERDA, a 12px', mm.numAlineado + ' · ' + mm.numTam);
  ok(mm.diasConCitas >= 5, 'los días con citas las llevan escritas dentro', mm.diasConCitas + ' días');
  ok(mm.lineasDelLleno === 3 && /^\+2 más$/.test(mm.mas), 'un día con CINCO citas enseña 3 y resume el resto', mm.lineasDelLleno + ' + «' + mm.mas + '»');
  ok(mm.puntos === 3, 'cada línea con su punto de color de estado', mm.puntos + '');
  ok(mm.vacias > 0, 'los días sin citas se quedan callados', mm.vacias + ' casillas vacías');
  ok(!mm.segundoTitulo, 'ya no hay un SEGUNDO «Agosto 2026» dentro de la tarjeta');
  ok(mm.zoom === 'none', 'el zoom S/M/L no se enseña en Mes');
  ok(mm.finde > 0 && mm.otros > 0, 'fin de semana y días de otro mes van marcados', mm.finde + ' findes · ' + mm.otros + ' de otro mes');

  ok(errs.length === 0, 'CERO errores de JavaScript en todo el recorrido', errs.join(' | '));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] LA ÚLTIMA, Y LA QUE FALTABA: ¿ESTO SE VE EN LA DIRECCIÓN PÚBLICA?');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Todo lo de arriba corre contra :3000, que ES el proceso que Caddy proxya al público — no hay
  // instancia de laboratorio. Pero eso no lo demuestra por sí solo, y el 18 ago 2026 pasó justo eso:
  // el commit empujado y la pantalla real sin cambiar. Así que la última comprobación sale a la calle:
  // se pide por HTTPS a un negocio REAL con DNS y se mira si el código nuevo está ahí.
  // Si el negocio de referencia no existe en esta máquina, se DICE, no se da por bueno en silencio.
  const REF = 'peluqueria-gil';
  const refT = controlDb.prepare('SELECT slug, db_filename FROM tenants WHERE slug=?').get(REF);
  if (!refT) {
    ok(false, 'no se pudo comprobar la dirección pública: no existe el negocio de referencia «' + REF + '» en esta máquina');
  } else {
    const refDb = new Database(path.isAbsolute(refT.db_filename) ? refT.db_filename : path.join(APP, refT.db_filename));
    let tokRef = null;
    try {
      const u = refDb.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1").get()
             || refDb.prepare('SELECT id FROM admin_users WHERE active=1 LIMIT 1').get();
      tokRef = randomBytes(32).toString('base64url');
      refDb.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
        .run(tokRef, u.id, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 300, randomBytes(32).toString('base64url'));
      const r = await fetch('https://' + REF + '.bamburu.com/admin/citas', {
        headers: { cookie: 'asess=' + tokRef, 'Cache-Control': 'no-cache' },
      });
      const html = await r.text();
      ok(r.status === 200, 'la dirección pública responde', 'HTTP ' + r.status);
      // Marcadores del lienzo y del mes nuevo. Si falta uno, el público está viendo lo de antes.
      const faltan = ['ag-wrap', 'agcol-head', 'ag-ahora', 'ruedaMes', 'agZoom', 'cResuelveCliente']
        .filter(m => !html.includes(m));
      ok(faltan.length === 0, 'y sirve el código NUEVO de la agenda, no el anterior',
         faltan.length ? 'FALTAN en el público: ' + faltan.join(', ') : 'los 6 marcadores presentes');
      ok(!html.includes('class="mes-tit"'), 'y ya no lleva el segundo título del mes que se quitó');
    } catch (e) {
      ok(false, 'no se pudo pedir a la dirección pública', String(e.message || e).slice(0, 90));
    } finally {
      try { if (tokRef) refDb.prepare('DELETE FROM admin_sessions WHERE token=?').run(tokRef); } catch {}
      try { refDb.close(); } catch {}
    }
  }
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
