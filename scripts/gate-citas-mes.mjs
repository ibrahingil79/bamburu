// LA VISTA MES DE LA AGENDA — Gate de NAVEGADOR (Tarea A, 21 ago 2026).
//   node scripts/gate-citas-mes.mjs
//
// CONTRA LA DIRECCIÓN PÚBLICA, NO CONTRA LOCAL. Todo lo que mide este gate se pide por HTTPS a
// https://<slug>.bamburu.com, que es lo que ve el dueño. Correr contra :3000 probaría el proceso, no
// el despliegue — y el 18 ago 2026 ya pasó una vez que el commit estaba empujado y la pantalla real
// seguía siendo la de antes.
//
// QUÉ VIGILA, punto por punto del encargo:
//   A1 el pie DECLARA SU BASE (una persona → horas; con equipo → ocupación + capacidad; cerrado → «Cerrado»)
//   A2 un SOLO control de vista en toda la pantalla
//   A4 los tres grises dejan de ser el mismo (fuera de mes · fin de semana ABIERTO · cerrado)
//   A5 las filas reparten el alto: tantas como semanas reales
//   A7 hora + cliente + SERVICIO, y «+N más» abre el día
//   A8 crear desde el mes, con ratón y con teclado
//   + permisos, móvil y cero errores de consola.
//
// LOS NEGOCIOS SON DE MENTIRA Y SE BORRAN AL SALIR. Se dan de alta con `provisionTenant` (el alta
// real), se les pone horario y citas, y al terminar se borran de la control.db y del disco.
//
// LA HORA DEL DÍA NO PINTA NADA AQUÍ, y es deliberado (lección de la TAREA 1, 20 ago): la vista Mes
// NO llama a `huecos()` —que descarta lo anterior a «ahora»—, sino a `tramosPersona`/`ocupacionPersona`,
// que no miran el reloj. Este gate da lo mismo a las 9:00 que a las 23:00.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../core/control-db.js';

import { soltarAtaduras } from './lib/tirar-negocio.mjs';
let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const TS = Date.now();
const RID = String(TS).slice(-6);
const creados = [];
// LAS CONEXIONES, NO SOLO LOS NOMBRES. 24 ago 2026: este gate borraba el fichero del negocio con la
// conexión todavía abierta. En WAL, SQLite hace checkpoint al cerrarse y VUELVE A ESCRIBIR el fichero
// — completo, 1,2 MB, y con el umask del proceso, o sea 0644. Así que la limpieza dejaba dos bases de
// datos de negocio sueltas y legibles por cualquier usuario de la máquina. Lo cazó test-c6-secretos.
// Cerrar primero y borrar después.
const conexiones = [];
let b;

const dormir = ms => new Promise(r => setTimeout(r, ms));
// PULSAR SIN MORIR. La prueba de reversión me ha pillado TRES veces lo mismo: al quitar una pieza,
// su botón desaparece, `page.click` lanza y el gate muere ahí — llevándose por delante todo lo que
// venía detrás, que es justo lo que un gate no puede hacer. Devuelve false y sigue.
const clic = async (page, sel) => {
  try { await page.click(sel); return true; } catch { return false; }
};
const ymd = d => d.toISOString().slice(0, 10);
const dow = f => new Date(f + 'T00:00:00Z').getUTCDay();

function borrarTenant(slug) {
  const t = getTenantBySlug(slug);
  // ⚙️ 3 SEP 2026 — SUELTA LAS ATADURAS ANTES DE BORRAR EL NEGOCIO. Desde el 2 de septiembre
  // `createTenant` siembra la prueba de 15 días, así que todo negocio nuevo tiene fila en
  // `tenant_suscripciones`: sin soltarla, el DELETE de abajo muere con FOREIGN KEY y el negocio de
  // prueba se queda dentro de control.db para siempre. `soltarAtaduras` le pregunta al esquema.
  soltarAtaduras(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) for (const s of ['', '-wal', '-shm']) { try { unlinkSync(join(APP_DIR, t.db_filename + s)); } catch {} }
}

// Un negocio nuevo, por el alta REAL, con sesión lista y su dirección pública.
async function negocio(etiqueta, { personas = 1 } = {}) {
  const r = await provisionTenant({
    businessName: 'GMES ' + etiqueta + ' ' + TS, ownerName: 'Ana ' + etiqueta,
    email: 'gmes-' + etiqueta + '-' + TS + '@t.local', password: 'contrasena-larga-123',
    country: 'ES', sector: 'peluquería', oficio: 'peluqueria',
  });
  creados.push(r.slug);
  const db = new Database(join(APP_DIR, r.db_filename));
  conexiones.push(db);
  const owner = db.prepare('SELECT id,name FROM admin_users WHERE active=1').get();
  // El resto del EQUIPO. Sin horario propio heredan el del negocio (citas-engine · tramosPersona),
  // que es justo lo que hace que la capacidad del día sea N × las horas de apertura.
  for (let i = 1; i < personas; i++) {
    db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES (?,?,'x','employee',1,0,datetime('now'))")
      .run('Persona ' + i, 'p' + i + '-' + etiqueta + '-' + TS + '@t.local');
  }
  const tok = randomBytes(24).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, now, now + 7200, randomBytes(16).toString('base64url'));
  return { slug: r.slug, db, owner, tok, base: 'https://' + r.slug + '.bamburu.com' };
}

// Horario del NEGOCIO: los días `dows`, de `ini` a `fin` (en minutos).
function horario(db, dows, ini, fin) {
  const q = db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)");
  for (const d of dows) q.run(d, ini, fin);
}
const cerrarDia = (db, fecha) => db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,motivo) VALUES ('negocio',NULL,?,'cerrado','Gate')").run(fecha);

async function sesionEn(page, n) {
  await page.setCookie({ name: 'asess', value: n.tok, domain: n.slug + '.bamburu.com', path: '/', secure: true });
}
async function abrirMes(page, n, fecha) {
  await page.goto(n.base + '/admin/citas', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof agCargar === 'function', { timeout: 20000 });
  await page.evaluate(f => { document.getElementById('agFecha').value = f; setVista('mes'); }, fecha);
  await page.waitForFunction(() => document.querySelectorAll('.mesdia').length > 0, { timeout: 20000 });
  await dormir(500);
}

try {
  b = await puppeteer.launch(launchOpts());

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // NEGOCIO 1 — UNA PERSONA. Abre de lunes a sábado, de 9:00 a 18:00 (9 h). Domingo cerrado.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const uno = await negocio('uno', { personas: 1 });
  horario(uno.db, [1, 2, 3, 4, 5, 6], 9 * 60, 18 * 60);

  const HOY = ymd(new Date());
  const MES = HOY.slice(0, 7);
  // Días de trabajo DENTRO del mes en curso, elegidos por su día de la semana y no por «hoy+N»:
  // así el gate vale cualquier día del mes y no se sale de la rejilla que está mirando.
  const delMes = [];
  for (let d = 1; d <= new Date(Date.UTC(+MES.slice(0, 4), +MES.slice(5, 7), 0)).getUTCDate(); d++) {
    delMes.push(MES + '-' + String(d).padStart(2, '0'));
  }
  const martes = delMes.filter(f => dow(f) === 2);
  const sabados = delMes.filter(f => dow(f) === 6);
  const miercoles = delMes.filter(f => dow(f) === 3);
  const domingos = delMes.filter(f => dow(f) === 0);
  const D_VACIO = martes[0];                 // martes abierto y sin citas → 9 h libres
  const D_CITAS = martes[1] || martes[0];    // martes con cinco citas
  const D_SABADO = sabados[1] || sabados[0]; // sábado ABIERTO (A4·b)
  const D_CERRADO = miercoles[2] || miercoles[0];
  cerrarDia(uno.db, D_CERRADO);              // miércoles cerrado ENTRE SEMANA (A4·c)

  // Servicios: uno normal y otro de nombre absurdamente largo, para el recorte de A7.
  const insProd = uno.db.prepare("INSERT INTO products (name,type,price,tax_band,tax_rate,status,created_at) VALUES (?,'service',20,'general',21,'active',datetime('now'))");
  const insSvc = uno.db.prepare('INSERT INTO service_config (product_id,duracion_min,margen_min,reservable) VALUES (?,30,0,1)');
  const SVC_CORTO = 'Corte';
  const SVC_LARGO = 'Coloración completa con mechas balayage y tratamiento de keratina';
  const idCorto = insProd.run(SVC_CORTO).lastInsertRowid; insSvc.run(idCorto);
  const idLargo = insProd.run(SVC_LARGO).lastInsertRowid; insSvc.run(idLargo);

  const insCli = uno.db.prepare("INSERT INTO clients (name,active,created_at) VALUES (?,1,datetime('now'))");
  const insCita = uno.db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,created_at,updated_at) VALUES (?,?,?,?,?,30,0,?,datetime('now'),datetime('now'))");
  const insCS = uno.db.prepare('INSERT INTO cita_servicios (cita_id,product_id,orden,offset_min,dur_min,muerto_ini_min,muerto_dur_min) VALUES (?,?,0,0,30,0,0)');
  const CLI_CORTO = 'Ana Gil';
  // Cinco citas el mismo día: se pintan tres y la cuarta y la quinta se resumen en «+2 más».
  const estados = ['confirmada', 'pedida', 'atendida', 'confirmada', 'pedida'];
  for (let i = 0; i < 5; i++) {
    const cid = insCli.run(i === 0 ? CLI_CORTO : 'Cliente ' + i + ' ' + RID).lastInsertRowid;
    const cita = insCita.run('GM' + RID + i, cid, uno.owner.id, D_CITAS, 9 * 60 + i * 60, estados[i]).lastInsertRowid;
    insCS.run(cita, i === 0 ? idLargo : idCorto);   // la PRIMERA lleva el servicio larguísimo
  }

  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 950 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push('console: ' + m.text()); });
  await sesionEn(p, uno);
  await abrirMes(p, uno, D_VACIO);

  // ── [1] A1 · UNA PERSONA: EL PIE DICE LAS HORAS DEL DÍA, NO UNA SUMA DE EQUIPO ───────────────
  console.log('\n[1] A1 · negocio de UNA persona: 9 h, ni 168 ni 24');
  const unaP = await p.evaluate(f => {
    const cel = document.querySelector('.mesdia[data-fecha="' + f + '"]');
    return { res: cel.getAttribute('data-res'), pie: document.getElementById('mesPie').textContent.replace(/\s+/g, ' ').trim() };
  }, D_VACIO);
  ok(/9 h libres/.test(unaP.res), 'el día abierto y sin citas dice «9 h libres»', unaP.res);
  ok(!/168/.test(unaP.res) && !/24 h/.test(unaP.res), 'y no dice 168 ni 24 h', unaP.res);
  ok(unaP.pie.includes('9 h libres'), 'y el pie del día seleccionado dice lo mismo', unaP.pie.slice(0, 70));
  ok(!/personas/.test(unaP.res), 'con una sola persona NO se declara base: sobra decir «entre 1 personas»', unaP.res);

  // ── [3] A1 · DÍA CERRADO ────────────────────────────────────────────────────────────────────
  console.log('\n[3] A1 · día cerrado: «Cerrado», y la cadena «0 h» no aparece');
  const cerr = await p.evaluate(f => {
    const cel = document.querySelector('.mesdia[data-fecha="' + f + '"]');
    cel.focus();
    return { res: cel.getAttribute('data-res'), aria: cel.getAttribute('aria-label'), pie: document.getElementById('mesPie').textContent };
  }, D_CERRADO);
  ok(/Cerrado/.test(cerr.res), 'el día cerrado dice «Cerrado»', cerr.res);
  ok(!/0 h/.test(cerr.res) && !/0 h/.test(cerr.aria) && !/0 h/.test(cerr.pie), 'y en ningún sitio aparece «0 h»', cerr.res + ' | ' + cerr.pie.replace(/\s+/g, ' ').trim().slice(0, 50));
  const domRes = domingos.length ? await p.evaluate(f => (document.querySelector('.mesdia[data-fecha="' + f + '"]') || {}).getAttribute?.('data-res'), domingos[0]) : 'Cerrado';
  ok(/Cerrado/.test(domRes || ''), 'y el domingo, que tampoco abre, dice lo mismo', String(domRes));

  // ── [4][5] A2 · UN SOLO CONTROL DE VISTA ────────────────────────────────────────────────────
  console.log('\n[4][5] A2 · un solo control de vista, y refleja el estado');
  const ctrl = await p.evaluate(() => {
    // Cualquier cosa de la pantalla que pueda cambiar de vista: el grupo segmentado cuenta como UNO.
    const segs = document.querySelectorAll('.segmented[role="tablist"]').length;
    const selects = [...document.querySelectorAll('select')].filter(s =>
      [...s.options].map(o => o.value).join(',').includes('semana')).length;
    document.getElementById('agControles').style.display = 'flex';   // abre «Filtros»: ahí vivía el duplicado
    const selectsConFiltrosAbiertos = [...document.querySelectorAll('select')].filter(s =>
      [...s.options].map(o => o.value).join(',').includes('semana')).length;
    return { segs, selects, selectsConFiltrosAbiertos, hayAgVista: !!document.getElementById('agVista'),
             ejeSigue: !!document.getElementById('agEje'), verTodoSigue: !!document.getElementById('agVerTodo') };
  });
  ok(ctrl.segs === 1 && ctrl.selects === 0 && ctrl.selectsConFiltrosAbiertos === 0,
     'en toda la pantalla de Mes hay EXACTAMENTE un control que cambia de vista',
     ctrl.segs + ' segmentado(s) · ' + ctrl.selectsConFiltrosAbiertos + ' desplegable(s) de vista, con «Filtros» abierto');
  ok(!ctrl.hayAgVista, 'el desplegable duplicado ya no existe en el DOM (#agVista)');
  ok(ctrl.ejeSigue && ctrl.verTodoSigue, '«Por puesto» y «Ver todo el equipo» SIGUEN: no eran duplicados');
  const ida = await p.evaluate(async () => {
    setVista('semana');
    await new Promise(r => setTimeout(r, 700));
    const enSemana = document.getElementById('vbSemana').getAttribute('aria-selected');
    setVista('mes');
    await new Promise(r => setTimeout(r, 900));
    return { enSemana, enMes: document.getElementById('vbMes').getAttribute('aria-selected'),
             marcados: ['vbDia', 'vbSemana', 'vbMes'].filter(i => document.getElementById(i).getAttribute('aria-selected') === 'true'),
             vista: vistaActual(), hayRejilla: document.querySelectorAll('.mesdia').length > 0 };
  });
  ok(ida.enSemana === 'true', 'al pasar a Semana el control lo refleja');
  ok(ida.enMes === 'true' && ida.marcados.length === 1 && ida.vista === 'mes' && ida.hayRejilla,
     'y al volver a Mes también, con UN solo segmento marcado', JSON.stringify(ida.marcados));

  // ── [6][7][8][9] A4 · LOS TRES GRISES ───────────────────────────────────────────────────────
  console.log('\n[6][7][8][9] A4 · fuera de mes ≠ fin de semana ≠ cerrado');
  const grises = await p.evaluate((sab, cer) => {
    const est = el => {
      const s = getComputedStyle(el);
      const n = getComputedStyle(el.querySelector('.num'));
      return { bg: s.backgroundColor, img: s.backgroundImage, num: n.color, op: n.opacity, peso: n.fontWeight };
    };
    const q = f => document.querySelector('.mesdia[data-fecha="' + f + '"]');
    const otro = document.querySelector('.mesdia.otro');
    // El laborable de referencia se elige DENTRO de la pantalla y con cuidado: ni HOY (que va
    // destacado a propósito) ni el día SELECCIONADO (que lleva su círculo) ni uno cerrado. Comparar
    // contra uno de esos daría rojo por un motivo que no es el que se quiere medir.
    const lab = [...document.querySelectorAll('.mesdia:not(.otro):not(.hoy):not(.sel):not(.cerrado)')]
      .find(el => { const d = new Date(el.getAttribute('data-fecha') + 'T00:00:00Z').getUTCDay(); return d >= 1 && d <= 5; });
    const elSab = q(sab);
    return {
      otro: est(otro), sabado: est(elSab), cerrado: est(q(cer)), laborable: lab ? est(lab) : null,
      refLab: lab ? lab.getAttribute('data-fecha') : null,
      sabadoLimpio: !elSab.classList.contains('hoy') && !elSab.classList.contains('sel') && !elSab.classList.contains('cerrado'),
      sabadoAbierto: !elSab.disabled, cerradoTieneClase: q(cer).classList.contains('cerrado'),
      otroNoEsCerrado: !otro.classList.contains('cerrado'),
      destacados: document.querySelectorAll('.mesdia.hoy').length,
      hoyEnCirculo: (() => { const h = document.querySelector('.mesdia.hoy'); return !!h && getComputedStyle(h.querySelector('.num')).borderRadius.startsWith('50%'); })(),
    };
  }, D_SABADO, D_CERRADO);
  const firma = e => e && (e.bg + '|' + e.img + '|' + e.num + '|' + e.op + '|' + e.peso);
  const fOtro = firma(grises.otro), fSab = firma(grises.sabado), fCer = firma(grises.cerrado), fLab = firma(grises.laborable);
  ok(fOtro !== fSab && fOtro !== fCer && fSab !== fCer,
     'los tres estados tienen firma visual DISTINTA entre sí', 'otro≠finde≠cerrado');
  ok(grises.sabadoAbierto && grises.sabadoLimpio && fLab && fSab === fLab,
     'un sábado ABIERTO se pinta EXACTAMENTE como un laborable, no apagado',
     'sábado ' + D_SABADO + ' vs laborable ' + grises.refLab + ' → ' + String(fSab).slice(0, 52));
  ok(grises.cerradoTieneClase && grises.cerrado.img !== 'none' && grises.otro.img === 'none',
     'el día cerrado lleva marca propia (trama), no la tinta plana del «otro mes» — se distingue en blanco y negro',
     'cerrado.img=' + grises.cerrado.img.slice(0, 42));
  ok(grises.otroNoEsCerrado && grises.otro.bg !== 'rgba(0, 0, 0, 0)' && grises.otro.op !== grises.laborable.op,
     'y el día de otro mes sigue teniendo la suya, la más apagada', grises.otro.bg + ' · opacidad ' + grises.otro.op);
  ok(grises.destacados === 1 && grises.hoyEnCirculo, 'HOY es el ÚNICO día destacado, y sigue en su círculo', grises.destacados + ' destacado(s)');

  // ── [10] A5 · LAS FILAS REPARTEN EL ALTO ────────────────────────────────────────────────────
  console.log('\n[10] A5 · tantas filas como semanas reales, sin hueco muerto');
  const filasDe = async ym => {
    await p.evaluate(f => { document.getElementById('agFecha').value = f; agCargar(); }, ym + '-15');
    await p.waitForFunction(() => document.querySelectorAll('.mesdia').length > 0, { timeout: 15000 });
    await dormir(500);
    return p.evaluate(() => {
      const rej = document.querySelector('.mes-rej');
      const filas = getComputedStyle(rej).gridTemplateRows.split(' ').filter(Boolean).map(v => Math.round(parseFloat(v)));
      const celdas = document.querySelectorAll('.mescel').length;
      const alto = Math.round(rej.getBoundingClientRect().height);
      const sumaFilas = filas.reduce((a, x) => a + x, 0);
      return { filas, n: filas.length, celdas, alto, sumaFilas, altoCelda: Math.round(document.querySelectorAll('.mesdia')[8].getBoundingClientRect().height) };
    });
  };
  const seis = await filasDe('2026-08');   // agosto 2026 empieza en sábado → 6 semanas
  const cinco = await filasDe('2026-06');  // junio 2026 empieza en lunes → 5 semanas
  ok(seis.n === 6 && seis.celdas === 42, 'un mes de 6 semanas pinta 6 filas (42 casillas)', seis.n + ' filas · ' + seis.celdas + ' casillas');
  ok(cinco.n === 5 && cinco.celdas === 35, 'un mes de 5 semanas pinta 5 filas (35 casillas), ni una de más', cinco.n + ' filas · ' + cinco.celdas + ' casillas');
  ok(new Set(seis.filas).size === 1 && new Set(cinco.filas).size === 1,
     'y dentro de cada mes todas las filas miden lo mismo: el alto se REPARTE', seis.filas.join('/') + ' · ' + cinco.filas.join('/'));
  ok(Math.abs(seis.alto - cinco.alto) <= 2 && Math.abs(seis.sumaFilas - seis.alto) <= 3,
     'los dos meses ocupan el MISMO alto total: uno de 5 semanas ya no deja una pared en blanco',
     seis.alto + 'px (6 filas) vs ' + cinco.alto + 'px (5 filas)');
  ok(cinco.filas[0] > seis.filas[0], 'y las filas del mes corto son MÁS ALTAS, no iguales con hueco al final',
     cinco.filas[0] + 'px vs ' + seis.filas[0] + 'px');
  ok(seis.altoCelda >= 84, 'la casilla sigue midiendo al menos 84 px de alto en el mes más largo', seis.altoCelda + 'px');

  // ── [11][12][13] A7 · HORA + CLIENTE + SERVICIO, Y «+N MÁS» ABRE EL DÍA ──────────────────────
  console.log('\n[11][12][13] A7 · el servicio en la casilla, y «+N más» abre el día');
  await abrirMes(p, uno, D_CITAS);
  const lineas = await p.evaluate(f => {
    const cel = document.querySelector('.mesdia[data-fecha="' + f + '"]');
    const ls = [...cel.querySelectorAll('.lin')].map(l => ({
      txt: l.textContent.replace(/\s+/g, ' ').trim(),
      hora: (l.querySelector('b') || {}).textContent || '',
      cli: (l.querySelector('.cli') || {}).textContent || '',
      svc: (l.querySelector('.svc') || {}).textContent || '',
      pt: !!l.querySelector('.pt'),
    }));
    const c0 = cel.querySelector('.lin .cli'), s0 = cel.querySelector('.lin .svc');
    const recorta = el => !!el && el.scrollWidth > el.clientWidth + 1;
    return { ls, mas: (cel.querySelector('.mas') || {}).textContent || '',
             hayCli: !!c0, haySvc: !!s0, cliRecorta: recorta(c0), svcRecorta: recorta(s0),
             desborda: [...cel.querySelectorAll('.lin')].some(l => l.scrollWidth > cel.clientWidth + 1) };
  }, D_CITAS);
  ok(lineas.ls.length === 3, 'un día con CINCO citas enseña TRES', lineas.ls.length + '');
  ok(lineas.ls.every(l => /^\d{1,2}:\d{2}$/.test(l.hora.trim()) && l.cli.trim() && l.svc.trim() && l.pt),
     'y cada una lleva HORA + CLIENTE + SERVICIO, con su punto de estado', lineas.ls.map(l => l.txt).join(' | ').slice(0, 110));
  ok(lineas.ls[0].cli.trim() === CLI_CORTO && lineas.ls[0].svc.trim() === SVC_LARGO,
     'el cliente y el servicio que se pintan son los REALES de esa cita, no un texto de relleno',
     lineas.ls[0].cli + ' · ' + lineas.ls[0].svc.slice(0, 34) + '…');
  ok(lineas.hayCli && lineas.haySvc && !lineas.cliRecorta && lineas.svcRecorta,
     'con un servicio larguísimo se recorta EL SERVICIO, no el cliente',
     'hay servicio=' + lineas.haySvc + ' · cliente recortado=' + lineas.cliRecorta + ' · servicio recortado=' + lineas.svcRecorta);
  ok(!lineas.desborda, 'y ninguna línea se sale de su casilla');
  ok(/^\+2 más$/.test(lineas.mas.trim()), 'la cuarta y la quinta se resumen en «+2 más»', lineas.mas.trim());
  let trasMas = { vista: '(no se pudo pulsar)', fecha: null };
  try {
    await p.click('.mesdia[data-fecha="' + D_CITAS + '"] .mas');
    await p.waitForFunction(() => document.querySelectorAll('.agcell').length > 0, { timeout: 12000 });
    trasMas = await p.evaluate(() => ({ vista: vistaActual(), fecha: document.getElementById('agFecha').value }));
  } catch (e) { trasMas.vista = 'error: ' + String(e.message || e).slice(0, 40); }
  ok(trasMas.vista === 'dia' && trasMas.fecha === D_CITAS,
     'y pulsar «+2 más» ABRE ESE DÍA', JSON.stringify(trasMas));

  // ── [14][15][16] A8 · CREAR DESDE EL MES ────────────────────────────────────────────────────
  console.log('\n[14][15][16] A8 · «+ Nueva cita» con ratón y con teclado');
  // SE ABRE EL MES POSICIONADO EN OTRO DÍA A PROPÓSITO. Si el gate se pusiera encima del mismo día
  // que va a pulsar, «el alta trae ese día ya puesto» daría verde aunque el botón no heredara nada:
  // la fecha ya estaría ahí de antes. Con el mes puesto en D_CITAS, que la ficha salga con D_VACIO
  // solo puede venir de la casilla.
  await abrirMes(p, uno, D_CITAS);
  const oculto = await p.evaluate(f => {
    const c = document.querySelector('.mes-add[data-nueva="' + f + '"]');
    return { existe: !!c, opacidad: c ? getComputedStyle(c).opacity : null, puntero: c ? getComputedStyle(c).pointerEvents : null };
  }, D_VACIO);
  ok(oculto.existe && oculto.opacidad === '0' && oculto.puntero === 'none',
     'la casilla abierta trae su «+ Nueva cita», tapado y sin estorbar hasta que hace falta');
  await p.hover('.mesdia[data-fecha="' + D_VACIO + '"]');
  await dormir(350);
  // TODO LO QUE SIGUE SE MIDE CON GUARDA. Si el botón no existiera (que es justo lo que pasa al
  // deshacer A8), el gate tiene que dar ROJO LIMPIO y seguir midiendo lo demás — no morirse con una
  // excepción y llevarse por delante los bloques de detrás. Lo destapó la prueba de reversión.
  const alPasar = await p.evaluate(f => {
    const c = document.querySelector('.mes-add[data-nueva="' + f + '"]');
    return c ? { existe: true, op: getComputedStyle(c).opacity, txt: c.textContent.trim() } : { existe: false, op: null, txt: '' };
  }, D_VACIO);
  ok(alPasar.existe && alPasar.op === '1' && /Nueva cita/.test(alPasar.txt),
     'al pasar el ratón por encima aparece «+ Nueva cita»', alPasar.existe ? alPasar.txt : 'no existe el botón');
  let alta = { fecha: null, titulo: '(no se pudo abrir)' };
  if (alPasar.existe) {
    try {
      await p.click('.mes-add[data-nueva="' + D_VACIO + '"]');
      await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 12000 });
      alta = await p.evaluate(() => ({ fecha: document.getElementById('cFecha').value, titulo: document.getElementById('mCitaTitle').textContent }));
      await p.evaluate(() => closeModal('mCita'));
    } catch (e) { alta.titulo = 'error: ' + String(e.message || e).slice(0, 40); }
  }
  ok(alta.fecha === D_VACIO && /Nueva cita/.test(alta.titulo),
     'y al pulsarlo se abre el alta con ESE día ya puesto (el mes estaba en ' + D_CITAS + ')', JSON.stringify(alta));
  await dormir(300);

  const noOfrece = await p.evaluate(cer => ({
    enCerrado: !!document.querySelector('.mes-add[data-nueva="' + cer + '"]'),
    enOtroMes: !!document.querySelector('.mesdia.otro').closest('.mescel').querySelector('.mes-add'),
    enAbierto: !!document.querySelector('.mes-add'),
  }), D_CERRADO);
  ok(!noOfrece.enCerrado, 'en un día CERRADO no se ofrece crear');
  ok(!noOfrece.enOtroMes, 'y en un día de OTRO MES tampoco');
  ok(noOfrece.enAbierto, 'pero en los abiertos sí — la ausencia de arriba no es que no exista el botón');

  // TECLADO DE VERDAD: se enfoca la casilla y se tabula al botón. Ni un clic en todo el recorrido.
  await abrirMes(p, uno, D_CITAS);
  await p.evaluate(f => document.querySelector('.mesdia[data-fecha="' + f + '"]').focus(), D_VACIO);
  await p.keyboard.press('Tab');
  await dormir(250);
  const conTeclado = await p.evaluate(() => {
    const a = document.activeElement;
    return { esAdd: !!a && a.classList && a.classList.contains('mes-add'),
             fecha: a && a.getAttribute ? a.getAttribute('data-nueva') : null,
             op: a && a.nodeType === 1 ? getComputedStyle(a).opacity : null };
  });
  ok(conTeclado.esAdd && conTeclado.fecha === D_VACIO, 'con el tabulador se llega al «+ Nueva cita» de esa casilla', String(conTeclado.fecha));
  ok(conTeclado.esAdd && conTeclado.op === '1', 'y al llegar con el teclado se VE: no se activa a ciegas', 'opacidad ' + conTeclado.op);
  let altaTeclado = '(no se abrió)';
  if (conTeclado.esAdd) {
    try {
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.getElementById('mCita').classList.contains('open'), { timeout: 12000 });
      altaTeclado = await p.evaluate(() => document.getElementById('cFecha').value);
      await p.evaluate(() => closeModal('mCita'));
    } catch (e) { altaTeclado = 'error'; }
  }
  ok(altaTeclado === D_VACIO, 'y con Intro se abre el alta con ese día, sin tocar el ratón', altaTeclado);

  // ── [19] LA BARRA DE ARRIBA SE ENTIENDE ─────────────────────────────────────────────────────
  console.log('\n[19] la barra de arriba: el «Alto» tiene nombre y la (i) abre una VENTANA');
  await abrirMes(p, uno, D_VACIO);
  const barra = await p.evaluate(() => {
    const z = document.querySelector('.ag-zoomwrap');
    const lbl = document.querySelector('.ag-zoomlbl');
    return {
      hayZoom: !!document.getElementById('agZoom'),
      rotulo: lbl ? lbl.textContent.trim() : null,
      ocultoEnMes: z ? getComputedStyle(z).display === 'none' : null,
      tiraVieja: !!document.getElementById('agLeyenda'),
      hayVentana: !!document.getElementById('mLeyenda'),
      ventanaAbierta: document.getElementById('mLeyenda').classList.contains('open'),
    };
  });
  ok(barra.rotulo === 'Alto', 'el grupo S/M/L lleva su nombre delante y ya no son tres letras sueltas', String(barra.rotulo));
  ok(barra.ocultoEnMes === true, 'y en la vista Mes no se enseña: el alto de la hora ahí no pinta nada');
  ok(!barra.tiraVieja && barra.hayVentana, 'la tira de colores que se desplegaba encima de la agenda ya no existe; hay una VENTANA');
  ok(!barra.ventanaAbierta, 'y nace cerrada: no estorba a nadie que no la pida');
  await p.evaluate(() => setVista('dia'));
  await p.waitForFunction(() => document.querySelectorAll('.agcell').length > 0, { timeout: 15000 });
  await dormir(400);
  const conZoom = await p.evaluate(() => getComputedStyle(document.querySelector('.ag-zoomwrap')).display !== 'none');
  ok(conZoom, 'y en Día sí se enseña, que es donde el alto de la hora significa algo');
  // CON GUARDA: si la (i) no abriera la ventana, esto tiene que dar ROJO LIMPIO y seguir midiendo lo
  // de detrás. La prueba de reversión ya me pilló este mismo descuido en A7 y A8; no vuelve a pasar.
  let abrio = true;
  try {
    await clic(p, '#agLeyBtn');
    await p.waitForFunction(() => document.getElementById('mLeyenda').classList.contains('open'), { timeout: 6000 });
  } catch (e) { abrio = false; }
  ok(abrio, 'la (i) de la barra ABRE la ventana');
  const ley = abrio ? await p.evaluate(() => {
    const m = document.getElementById('mLeyenda');
    return { filas: m.querySelectorAll('.ley-fila').length, texto: m.textContent.replace(/\s+/g, ' ').trim(),
             empuja: !!document.querySelector('#agenda').previousElementSibling?.classList?.contains('ag-leyenda') };
  }) : { filas: 0, texto: '(no se abrió)', empuja: false };
  ok(ley.filas >= 5, 'la ventana explica los cuatro estados y el día cerrado', ley.filas + ' filas');
  ok(/Confirmada/.test(ley.texto) && /rayados/.test(ley.texto), 'y dice qué es cada uno, no solo cómo se llama', ley.texto.slice(0, 70) + '…');
  ok(!ley.empuja, 'y al abrirse NO empuja la agenda hacia abajo, que es lo que hacía la tira');
  if (abrio) await p.evaluate(() => closeModal('mLeyenda'));

  // ── [20] EL PIE RESPIRA ─────────────────────────────────────────────────────────────────────
  console.log('\n[20] el pie del mes ya no va pegado al filo de la tarjeta');
  await abrirMes(p, uno, D_VACIO);
  const pie = await p.evaluate(() => {
    const el = document.getElementById('mesPie');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const tarjeta = el.closest('.card').getBoundingClientRect();
    const txt = el.querySelector('.s');
    return { padAbajo: parseFloat(cs.paddingBottom), padLados: parseFloat(cs.paddingLeft),
             holguraAbajo: Math.round(tarjeta.bottom - r.bottom),
             textoAlFilo: txt ? Math.round(r.bottom - txt.getBoundingClientRect().bottom) : null };
  });
  ok(pie.padAbajo >= 12 && pie.padLados >= 12, 'el pie tiene aire por abajo y por los lados', pie.padAbajo + 'px / ' + pie.padLados + 'px');
  ok(pie.textoAlFilo >= 10, 'y su texto no roza el borde de abajo', pie.textoAlFilo + 'px hasta el filo');

  // ── [21] LAS INICIALES DE LOS DÍAS SE LEEN ──────────────────────────────────────────────────
  console.log('\n[21] L M X J V S D: con cuerpo y con aire');
  const cab = await p.evaluate(() => {
    const sp = document.querySelector('.mes-cab span');
    const cs = getComputedStyle(sp);
    const rej = document.querySelector('.mes-rej').getBoundingClientRect();
    const r = sp.getBoundingClientRect();
    return { tam: parseFloat(cs.fontSize), padArriba: parseFloat(cs.paddingTop),
             separacion: Math.round(rej.top - r.bottom), n: document.querySelectorAll('.mes-cab span').length };
  });
  ok(cab.n === 7, 'siguen siendo las siete');
  ok(cab.tam >= 12, 'con cuerpo suficiente para leerse (antes 10,5 px)', cab.tam + 'px');
  ok(cab.padArriba >= 10, 'y con aire por arriba: ya no van pegadas al filo de la tarjeta', cab.padArriba + 'px');

  // ── [22] UN DÍA CERRADO YA NO ESCONDE SUS CITAS ─────────────────────────────────────────────
  console.log('\n[22] un día cerrado enseña las citas que sí tiene, y se puede abrir');
  const cidC = insCli.run('Cliente En Dia Cerrado ' + RID).lastInsertRowid;
  const citaC = insCita.run('GMC' + RID, cidC, uno.owner.id, D_CERRADO, 10 * 60, 'confirmada').lastInsertRowid;
  insCS.run(citaC, idCorto);
  // Primero en la RESPUESTA DEL SERVIDOR, que es donde estaba el fallo: la cita se caía allí.
  const crudo = await (await fetch(uno.base + '/api/erp/citas/mes?ym=' + MES + '&eje=persona&verTodo=0', { headers: { cookie: 'asess=' + uno.tok } })).json();
  const diaC = (crudo.dias || []).find(d => d.fecha === D_CERRADO);
  ok(diaC && diaC.citas === 1 && !diaC.abierto,
     'el servidor manda la cita de un día CERRADO en vez de comérsela', JSON.stringify({ citas: diaC && diaC.citas, abierto: diaC && diaC.abierto }));
  await abrirMes(p, uno, D_VACIO);
  const enCerrado = await p.evaluate(f => {
    const cel = document.querySelector('.mesdia[data-fecha="' + f + '"]');
    return { lineas: cel.querySelectorAll('.lin').length, res: cel.getAttribute('data-res'),
             sigueRayado: cel.classList.contains('cerrado'), abrible: !cel.disabled,
             sinCrear: !document.querySelector('.mes-add[data-nueva="' + f + '"]') };
  }, D_CERRADO);
  ok(enCerrado.lineas === 1, 'y la pantalla la pinta', enCerrado.lineas + ' línea(s)');
  ok(/1 cita/.test(enCerrado.res) && /Cerrado/.test(enCerrado.res), 'diciendo las dos cosas: que hay una cita y que el día está cerrado', enCerrado.res);
  ok(enCerrado.sigueRayado && enCerrado.abrible, 'sigue rayado —está cerrado— pero ya se puede abrir para llegar a esa cita');
  ok(enCerrado.sinCrear, 'lo que NO se ofrece en un día cerrado es crear una cita nueva');

  // ── [23] ARRASTRAR UNA CITA DE UN DÍA A OTRO ────────────────────────────────────────────────
  console.log('\n[23] arrastrar en Mes: cambia de día y CONSERVA la hora');
  await abrirMes(p, uno, D_CITAS);
  // OJO AL NÚMERO, que en la primera pasada me dio rojo y la equivocada era LA ASERCIÓN: de las tres
  // citas que se pintan, una está ATENDIDA — y una cita atendida no se mueve (el motor la rechaza
  // con un 400). Así que lo correcto es 3 pintadas y 2 cogibles, y la que no se puede coger merece
  // su propia comprobación en vez de esconderse en un número.
  const arrastrables = await p.evaluate(f => {
    const cel = document.querySelector('.mesdia[data-fecha="' + f + '"]');
    const todas = [...cel.querySelectorAll('.lin')];
    return {
      pintadas: todas.length,
      cogibles: cel.querySelectorAll('.lin.movible[draggable="true"]').length,
      conId: !!cel.querySelector('.lin.movible[data-cita]'),
      quietas: todas.filter(l => !l.classList.contains('movible')).length,
    };
  }, D_CITAS);
  ok(arrastrables.pintadas === 3 && arrastrables.cogibles === 2 && arrastrables.conId,
     'las citas de la casilla se pueden coger', arrastrables.cogibles + ' de ' + arrastrables.pintadas + ' (la tercera está atendida)');
  ok(arrastrables.quietas === 1, 'y una cita ATENDIDA no se puede coger: el motor no la dejaría mover, así que ni se ofrece');
  // EL ARRASTRE, con eventos de arrastre REALES y un DataTransfer de verdad (el navegador sin ratón
  // físico no genera el gesto). Lo que se prueba es MI cadena: dragstart en la cita → drop en la
  // casilla → petición al servidor. Se comprueba en la BASE DE DATOS, no en la pantalla.
  const movida = await p.evaluate((desde, hasta) => {
    const lin = document.querySelector('.mesdia[data-fecha="' + desde + '"] .lin.movible');
    const cel = document.querySelector('.mesdia[data-fecha="' + hasta + '"]');
    if (!lin || !cel) return { id: null, min: null, diana: false };   // rojo limpio, no una excepción
    const dt = new DataTransfer();
    lin.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    cel.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const diana = cel.classList.contains('diana');
    cel.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { id: lin.getAttribute('data-cita'), min: lin.getAttribute('data-min'), diana };
  }, D_CITAS, D_VACIO);
  ok(movida.diana, 'y al pasar por encima de otro día ese día se marca como destino');
  await dormir(1500);
  const enBd = movida.id ? uno.db.prepare('SELECT fecha, inicio_min FROM citas WHERE id=?').get(Number(movida.id)) : { fecha: '(no se pudo arrastrar)', inicio_min: null };
  ok(enBd.fecha === D_VACIO, 'soltarla en otro día la MUEVE de verdad (comprobado en la base, no en la pantalla)', JSON.stringify(enBd));
  ok(movida.min !== null && String(enBd.inicio_min) === String(movida.min), 'y CONSERVA su hora: una casilla de mes no tiene hora que imponerle', enBd.inicio_min + ' min');
  // Se devuelve a su sitio para no dejar el negocio tocado a mitad del gate.
  if (movida.id) uno.db.prepare('UPDATE citas SET fecha=? WHERE id=?').run(D_CITAS, Number(movida.id));

  // ── [24] Y CON EL DEDO, que el arrastre de HTML5 no cubre ───────────────────────────────────
  console.log('\n[24] el mismo arrastre, con el dedo (pulsación mantenida)');
  await abrirMes(p, uno, D_CITAS);
  const dedo = await p.evaluate(async (desde, hasta) => {
    const lin = document.querySelector('.mesdia[data-fecha="' + desde + '"] .lin.movible');
    const cel = document.querySelector('.mesdia[data-fecha="' + hasta + '"]');
    if (!lin || !cel) return { id: null, min: null, antesDeTiempo: false, trasMantener: false, diana: false };
    const a = lin.getBoundingClientRect(), b = cel.getBoundingClientRect();
    const ev = (t, x, y, sobre) => (sobre || document).dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 1, isPrimary: true }));
    ev('pointerdown', a.left + 10, a.top + 5, lin);
    const antesDeTiempo = !!document.querySelector('.ag-fantasma');
    await new Promise(r => setTimeout(r, 500));                       // se mantiene pulsado
    const trasMantener = !!document.querySelector('.ag-fantasma');
    ev('pointermove', b.left + b.width / 2, b.top + b.height / 2);
    const diana = cel.classList.contains('diana');
    ev('pointerup', b.left + b.width / 2, b.top + b.height / 2);
    return { id: lin.getAttribute('data-cita'), min: lin.getAttribute('data-min'), antesDeTiempo, trasMantener, diana };
  }, D_CITAS, D_VACIO);
  ok(!dedo.antesDeTiempo, 'un toque suelto NO arranca un arrastre: la pantalla sigue pudiendo desplazarse');
  ok(dedo.trasMantener, 'manteniendo pulsado sí: aparece lo que se está moviendo');
  ok(dedo.diana, 'y el día de destino se marca al pasar el dedo por encima');
  await dormir(1500);
  const enBd2 = dedo.id ? uno.db.prepare('SELECT fecha, inicio_min FROM citas WHERE id=?').get(Number(dedo.id)) : { fecha: '(no se pudo)', inicio_min: null };
  ok(enBd2.fecha === D_VACIO && String(enBd2.inicio_min) === String(dedo.min),
     'al levantar el dedo la cita queda movida, con su hora intacta', JSON.stringify(enBd2));
  if (dedo.id) uno.db.prepare('UPDATE citas SET fecha=? WHERE id=?').run(D_CITAS, Number(dedo.id));

  // ── [25] EL SALTO DE FECHA: MESES Y AÑOS, NO UNA CASILLA PARA TECLEAR ───────────────────────
  console.log('\n[25] pulsar el título da MESES; pulsar el año da AÑOS');
  await abrirMes(p, uno, D_VACIO);
  const noHayCampo = await p.evaluate(() => {
    const f = document.getElementById('agFecha');
    return { esCampoVisible: f.type !== 'hidden', hojaCerrada: document.getElementById('agSalto').hasAttribute('hidden') };
  });
  ok(!noHayCampo.esCampoVisible, 'ya no hay una casilla de fecha que rellenar a mano');
  ok(noHayCampo.hojaCerrada, 'y la hoja de meses nace cerrada');
  await clic(p, '#agTitulo');
  await dormir(400);
  const hojaMeses = await p.evaluate(() => ({
    abierta: !document.getElementById('agSalto').hasAttribute('hidden'),
    n: document.querySelectorAll('#agSaltoRej button').length,
    titulo: document.getElementById('agSaltoTit').textContent.trim(),
    etiquetas: [...document.querySelectorAll('#agSaltoRej button')].map(b => b.textContent.trim()).slice(0, 3),
    marcado: (document.querySelector('#agSaltoRej button.sel') || {}).textContent,
  }));
  ok(hojaMeses.abierta && hojaMeses.n === 12, 'al pulsar el título salen los DOCE meses', hojaMeses.n + ' casillas');
  ok(/^\d{4}$/.test(hojaMeses.titulo) && hojaMeses.etiquetas.join(',') === 'Ene,Feb,Mar', 'con el año en la cabecera y los meses por su nombre', hojaMeses.titulo + ' · ' + hojaMeses.etiquetas.join(' '));
  ok(hojaMeses.marcado === 'Ago', 'y el mes que se está mirando viene marcado', String(hojaMeses.marcado));
  if (hojaMeses.abierta) await p.click('#agSaltoTit').catch(() => {});
  await dormir(300);
  const hojaAnios = await p.evaluate(() => ({
    n: document.querySelectorAll('#agSaltoRej button').length,
    titulo: (document.getElementById('agSaltoTit') || {}).textContent ? document.getElementById('agSaltoTit').textContent.trim() : '',
    abierta: !document.getElementById('agSalto').hasAttribute('hidden'),
  }));
  ok(hojaAnios.abierta && hojaAnios.n === 12 && /^\d{4} – \d{4}$/.test(hojaAnios.titulo), 'y pulsando el año salen los AÑOS, de doce en doce', hojaAnios.titulo);
  // Elegir año → vuelve a meses; elegir mes → cambia el calendario.
  await p.evaluate(() => { const b = [...document.querySelectorAll('#agSaltoRej button')].find(x => x.textContent.trim() === String(new Date().getFullYear())); if (b) b.click(); });
  await dormir(300);
  const deVuelta = await p.evaluate(() => document.querySelectorAll('#agSaltoRej button').length === 12 && /^Ene$/.test(document.querySelector('#agSaltoRej button').textContent.trim()));
  ok(deVuelta, 'elegir un año baja otra vez a sus meses');
  let tras = { f: '(no se pudo elegir)', cerrada: null, vista: null };
  try {
    await p.evaluate(() => { const b = [...document.querySelectorAll('#agSaltoRej button')].find(x => x.textContent.trim() === 'Dic'); if (!b) throw new Error('sin hoja'); b.click(); });
    await p.waitForFunction(() => document.getElementById('agFecha').value.slice(5, 7) === '12', { timeout: 6000 });
    tras = await p.evaluate(() => ({ f: document.getElementById('agFecha').value, cerrada: document.getElementById('agSalto').hasAttribute('hidden'), vista: vistaActual() }));
  } catch (e) { /* rojo limpio abajo */ }
  ok(tras.f.slice(5, 7) === '12' && tras.cerrada && tras.vista === 'mes',
     'y elegir un mes lleva el calendario a ese mes y cierra la hoja', JSON.stringify(tras));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // [27] LA PANTALLA «CUÁNDO ABRO» — atajos, interruptores y un resumen en cristiano
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Antes eran siete bloques iguales con campos de hora sueltos: para decir «de lunes a viernes de 9
  // a 2» había que repetir la misma operación cinco veces, y no había forma de cerrar un día sin
  // borrarle los campos a mano ni de saber de un vistazo qué horario tenía el negocio.
  console.log('\n[27] «Cuándo abro»: se pone de una vez, se cierra con un interruptor y se lee en una frase');
  await p.goto(uno.base + '/admin/citas/horarios', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => document.querySelectorAll('.hor-dia').length === 7, { timeout: 20000 });
  await dormir(600);
  const h0 = await p.evaluate(() => ({
    dias: document.querySelectorAll('.hor-dia').length,
    interruptores: document.querySelectorAll('.hor-dia .sw input').length,
    atajos: [...document.querySelectorAll('.hor-chip-atajo')].map(b => b.textContent.trim()),
    chips: document.querySelectorAll('.hor-dia-chip').length,
    resumen: document.getElementById('horResumen').textContent.replace(/\s+/g, ' ').trim(),
    primero: document.querySelector('.hor-dia .hor-dia-nombre').textContent.trim(),
  }));
  ok(h0.dias === 7 && h0.interruptores === 7, 'los siete días, cada uno con su interruptor de abierto/cerrado', h0.dias + ' días');
  ok(h0.primero === 'Lunes', 'y la semana empieza en lunes', h0.primero);
  ok(h0.atajos.join('|') === 'Lunes a viernes|Lunes a sábado|Todos los días|Sábado y domingo',
     'están los atajos para no marcar día a día', h0.atajos.join(' · '));
  ok(h0.chips === 7, 'y los siete días se pueden elegir de uno en uno', h0.chips + ' chips');
  // EL RESUMEN. El negocio del gate abre de lunes a sábado de 9 a 18 (lo puso el propio gate).
  ok(/Abres/.test(h0.resumen) && /lunes a s[áa]bado/i.test(h0.resumen) && /9:00 a 18:00/.test(h0.resumen),
     'el horario se lee en UNA FRASE, agrupando los días seguidos', h0.resumen.slice(0, 80));
  ok(/Cierras domingo/i.test(h0.resumen), 'y dice también qué días cierra', h0.resumen.slice(-40));

  // ── El atajo + jornada partida, aplicado de una vez ─────────────────────────────────────────
  await clic(p, '.hor-chip-atajo[data-atajo="1,2,3,4,5"]');
  await dormir(200);
  const elegidos = await p.evaluate(() => [...document.querySelectorAll('.hor-dia-chip[aria-pressed="true"]')].map(b => b.textContent.trim()));
  ok(elegidos.join('') === 'LMXJV', 'el atajo «lunes a viernes» marca los cinco días de golpe', elegidos.join(''));
  await clic(p, '#hjPartido');
  await dormir(200);
  // SE MIDE SI SE VE, NO SI TIENE EL ATRIBUTO. Miraba `hasAttribute('hidden')` y daba verde con el
  // tramo de tarde A LA VISTA: `display:flex` le gana a `[hidden]`. Lo destapó una captura.
  const partido = await p.evaluate(() => ({
    segundoPar: document.getElementById('hpPar2').offsetParent !== null,
    etiqueta: document.getElementById('hpLbl1').textContent.trim(),
    previa: document.getElementById('horPrevia').textContent.trim(),
    marcado: document.getElementById('hjPartido').getAttribute('aria-selected'),
  }));
  ok(partido.segundoPar && partido.etiqueta === 'Por la mañana', '«Mañana y tarde» ENSEÑA el segundo tramo y renombra el primero', partido.etiqueta);
  const corridoLimpio = await p.evaluate(async () => {
    horJornada('corrido'); await new Promise(r => setTimeout(r, 150));
    return { seVe: document.getElementById('hpPar2').offsetParent !== null, lbl: document.getElementById('hpLbl1').textContent.trim() };
  });
  ok(!corridoLimpio.seVe && corridoLimpio.lbl === 'Abro', 'y en «horario corrido» el tramo de tarde NO se ve: ni en el DOM ni en la pantalla', 'visible=' + corridoLimpio.seVe);
  await clic(p, '#hjPartido'); await dormir(200);
  ok(partido.marcado === 'true', 'y el control segmentado marca cuál está elegido');
  ok(/lunes a viernes/.test(partido.previa) && /y de/.test(partido.previa), 'y se ve de antemano lo que va a quedar, antes de tocar nada', partido.previa);
  // APLICAR NO ES GUARDAR: es la regla de esta pantalla y se comprueba contra la BASE.
  await clic(p, 'button[onclick="horAplica()"]');
  await dormir(500);
  const trasAplicar = await p.evaluate(() => ({
    resumen: document.getElementById('horResumen').textContent.replace(/\s+/g, ' ').trim(),
    tramosLunes: document.querySelectorAll('.hor-dia[data-dow="1"] .hor-tramo').length,
    tramosSabado: document.querySelectorAll('.hor-dia[data-dow="6"] .hor-tramo').length,
    avisa: !document.getElementById('horSucio').hasAttribute('hidden'),
  }));
  ok(trasAplicar.tramosLunes === 2, 'aplicarlo pone los DOS tramos en cada día elegido', trasAplicar.tramosLunes + ' tramos el lunes');
  ok(trasAplicar.tramosSabado === 1, 'y no toca los días que NO estaban elegidos', trasAplicar.tramosSabado + ' tramo el sábado');
  ok(trasAplicar.avisa, 'y avisa de que hay cambios sin guardar');
  const enBaseAun = uno.db.prepare("SELECT COUNT(*) n FROM horario_tramos WHERE scope='negocio' AND dow=1").get().n;
  ok(enBaseAun === 1, 'APLICAR NO ES GUARDAR: la base sigue como estaba hasta que se pulsa el botón', enBaseAun + ' tramo el lunes en la base');
  await clic(p, '#horGuardar');
  await dormir(900);
  const enBase = uno.db.prepare("SELECT inicio_min, fin_min FROM horario_tramos WHERE scope='negocio' AND dow=1 ORDER BY inicio_min").all();
  ok(enBase.length === 2 && enBase[0].inicio_min === 540 && enBase[1].inicio_min === 1020,
     'y al guardar sí queda en la base, con sus dos tramos', JSON.stringify(enBase));
  ok(await p.evaluate(() => document.getElementById('horSucio').hasAttribute('hidden')), 'y el aviso de «sin guardar» desaparece');

  // ── El interruptor: cerrar un día NO le borra las horas ─────────────────────────────────────
  await p.evaluate(() => { const el = document.querySelector('.hor-dia[data-dow="1"] .sw input'); if (el) el.click(); });
  await dormir(400);
  const cerrado = await p.evaluate(() => ({
    texto: document.querySelector('.hor-dia[data-dow="1"] .hor-dia-cuerpo').textContent.trim(),
    marcado: document.querySelector('.hor-dia[data-dow="1"]').classList.contains('cerrado'),
    sinCrear: !document.querySelector('.hor-dia[data-dow="1"] [data-mas]'),
    resumen: document.getElementById('horResumen').textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok(cerrado.texto === 'Cerrado' && cerrado.marcado, 'apagar el interruptor cierra el día, sin borrar campos a mano');
  ok(cerrado.sinCrear, 'y un día cerrado deja de ofrecer «+ tramo»');
  ok(/Cierras lunes/i.test(cerrado.resumen) || /lunes/.test(cerrado.resumen.split('Cierras')[1] || ''), 'y el resumen lo recoge al momento', cerrado.resumen.slice(-52));
  await p.evaluate(() => { const el = document.querySelector('.hor-dia[data-dow="1"] .sw input'); if (el) el.click(); });
  await dormir(400);
  const reabierto = await p.evaluate(() => [...document.querySelectorAll('.hor-dia[data-dow="1"] input[type="time"]')].map(i => i.value));
  ok(reabierto.join(',') === '09:00,14:00,17:00,20:00',
     'y al volver a abrirlo LE DEVUELVE SUS HORAS: cerrar no castiga por probar', reabierto.join(' '));

  // ── Copiar al resto ─────────────────────────────────────────────────────────────────────────
  await p.evaluate(() => { const el = document.querySelector('.hor-dia[data-dow="6"] .sw input'); if (el) el.click(); });   // cierro el sábado
  await dormir(300);
  await p.evaluate(() => { const el = document.querySelector('.hor-dia[data-dow="1"] [data-copia]'); if (el) el.click(); });
  await dormir(400);
  const copiado = await p.evaluate(() => ({
    martes: document.querySelectorAll('.hor-dia[data-dow="2"] .hor-tramo').length,
    sabado: document.querySelector('.hor-dia[data-dow="6"] .hor-dia-cuerpo').textContent.trim(),
  }));
  ok(copiado.martes === 2, '«Copiar al resto» lleva ese horario a los demás días que abren', copiado.martes + ' tramos el martes');
  ok(copiado.sabado === 'Cerrado', 'y NO abre los que estaban cerrados: copiar un horario no es abrir un día');

  // ── No se guarda un tramo imposible ─────────────────────────────────────────────────────────
  await p.evaluate(() => { const i = document.querySelector('.hor-dia[data-dow="2"] input[type="time"]'); i.value = '23:00'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await dormir(300);
  await clic(p, '#horGuardar');
  await dormir(700);
  const malo = await p.evaluate(() => !document.getElementById('horSucio').hasAttribute('hidden'));
  ok(malo, 'un tramo que termina antes de empezar NO se guarda, y el aviso de «sin guardar» sigue puesto');
  // OJO: mirar solo el PRIMER tramo daría verde por el motivo equivocado — con 23:00 guardado, al
  // ordenar por hora el 23:00 quedaría el SEGUNDO y la comprobación pasaría igual. Se exige que ese
  // tramo imposible no esté en NINGUNA posición.
  const martesEnBase = uno.db.prepare("SELECT inicio_min, fin_min FROM horario_tramos WHERE scope='negocio' AND dow=2 ORDER BY inicio_min").all();
  ok(!martesEnBase.some(t => t.inicio_min === 1380), 'y ese tramo imposible no está en la base, en ninguna posición', JSON.stringify(martesEnBase));
  ok(martesEnBase.every(t => t.fin_min > t.inicio_min), 'ni queda en la base ningún tramo que termine antes de empezar', martesEnBase.length + ' tramos, todos coherentes');

  const errsH = errs.length;
  ok(errsH === 0, 'cero errores de consola en la pantalla de horarios', errs.slice(0, 2).join(' | '));

  // ── [2] A1 · CON EQUIPO: LA CIFRA DECLARA SU BASE ───────────────────────────────────────────
  console.log('\n[2] A1 · negocio de 14 personas: la cifra declara su base');
  const equipo = await negocio('equipo', { personas: 14 });
  horario(equipo.db, [1, 2, 3, 4, 5, 6], 8 * 60, 20 * 60);   // 12 h × 14 personas = 168 h
  const pe = await b.newPage();
  await pe.setViewport({ width: 1400, height: 950 });
  const errsE = []; pe.on('pageerror', e => errsE.push(e.message));
  await sesionEn(pe, equipo);
  await abrirMes(pe, equipo, D_VACIO);
  const eq = await pe.evaluate(f => {
    const cel = document.querySelector('.mesdia[data-fecha="' + f + '"]');
    cel.focus();
    return { res: cel.getAttribute('data-res'), pie: document.getElementById('mesPie').textContent.replace(/\s+/g, ' ').trim() };
  }, D_VACIO);
  ok(/168 h libres/.test(eq.res), 'el número NO cambia: siguen siendo 168 h (12 h × 14 personas)', eq.res);
  ok(/personas/.test(eq.res) || /ocupad/.test(eq.res),
     'pero ya NO viaja desnudo: el texto nombra su base (personas u ocupación)', eq.res);
  ok(/14 personas/.test(eq.res), 'y dice ENTRE CUÁNTAS personas se reparten esas horas', eq.res);
  ok(/0 % ocupado/.test(eq.res), 'con la ocupación por delante, que es lo comparable entre días', eq.res);
  ok(eq.pie.includes('14 personas'), 'y el pie del día seleccionado declara la misma base', eq.pie.slice(0, 80));

  // ── [17] PERMISOS · LO QUE NO SE PUEDE VER NO VIAJA ─────────────────────────────────────────
  console.log('\n[17] permisos · se comprueba la RESPUESTA DEL SERVIDOR, no la pantalla');
  // (a) Sin `citas.read` no hay agenda: el servidor corta ANTES de escribir un solo nombre.
  const sinPerm = equipo.db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Sin Agenda',?,'x','employee',1,0,datetime('now'))")
    .run('sinagenda-' + TS + '@t.local').lastInsertRowid;
  const tokSin = randomBytes(24).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  equipo.db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(tokSin, sinPerm, ahora, ahora + 3600, 'x');
  const cliSecreto = 'Cliente Reservado ' + RID;
  const cidS = equipo.db.prepare("INSERT INTO clients (name,active,created_at) VALUES (?,1,datetime('now'))").run(cliSecreto).lastInsertRowid;
  equipo.db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,created_at,updated_at) VALUES (?,?,?,?,600,30,0,'confirmada',datetime('now'),datetime('now'))")
    .run('GMS' + RID, cidS, equipo.owner.id, D_VACIO);
  const rSin = await fetch(equipo.base + '/api/erp/citas/mes?ym=' + MES + '&eje=persona&verTodo=0', { headers: { cookie: 'asess=' + tokSin } });
  const bodySin = await rSin.text();
  ok(rSin.status === 403 || rSin.status === 401, 'sin permiso de agenda el servidor NIEGA la petición del mes', 'HTTP ' + rSin.status);
  ok(!bodySin.includes(cliSecreto), 'y en su respuesta NO viaja ni un nombre de cliente', bodySin.slice(0, 60));
  // (b) El filtro por eje se aplica EN EL SERVIDOR: quien no trabaja ese día no manda sus citas.
  const libra = equipo.db.prepare("SELECT id FROM admin_users WHERE name='Persona 1'").get().id;
  const cliLibre = 'Cliente De Quien Libra ' + RID;
  const cidL = equipo.db.prepare("INSERT INTO clients (name,active,created_at) VALUES (?,1,datetime('now'))").run(cliLibre).lastInsertRowid;
  equipo.db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,created_at,updated_at) VALUES (?,?,?,?,660,30,0,'confirmada',datetime('now'),datetime('now'))")
    .run('GML' + RID, cidL, libra, D_VACIO);
  equipo.db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,motivo) VALUES ('user',?,?,'cerrado','Libra')").run(libra, D_VACIO);
  const conCookie = { cookie: 'asess=' + equipo.tok };
  const rFiltrado = await (await fetch(equipo.base + '/api/erp/citas/mes?ym=' + MES + '&eje=persona&verTodo=0', { headers: conCookie })).text();
  const rTodo = await (await fetch(equipo.base + '/api/erp/citas/mes?ym=' + MES + '&eje=persona&verTodo=1', { headers: conCookie })).text();
  ok(!rFiltrado.includes(cliLibre), 'la cita de quien NO trabaja ese día no viaja al navegador: la filtra el servidor');
  ok(rTodo.includes(cliLibre), 'y con «ver todo el equipo» sí viaja — el filtro es real, no una casualidad');

  // ── [26] «CADA UNO VE SOLO SU AGENDA» — el permiso nuevo (citas.ver_todas) ─────────────────
  console.log('\n[26] citas.ver_todas · sin él, un empleado solo ve LO SUYO (y se mira en el servidor)');
  // Un empleado con citas.read pero SIN citas.ver_todas. Se le da el permiso a mano, como haría la
  // pantalla de usuarios, para no depender de cómo se pinte ese formulario.
  const emp = equipo.db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Empleado Curioso',?,'x','employee',1,0,datetime('now'))")
    .run('curioso-' + TS + '@t.local').lastInsertRowid;
  const permLeer = equipo.db.prepare("SELECT id FROM permissions WHERE module='citas' AND action='read'").get();
  const permTodas = equipo.db.prepare("SELECT id FROM permissions WHERE module='citas' AND action='ver_todas'").get();
  ok(!!permTodas, 'el permiso «ver toda la agenda» existe en el catálogo del negocio');
  equipo.db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(emp, permLeer.id);
  const tokEmp = randomBytes(24).toString('base64url');
  equipo.db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tokEmp, emp, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 3600, 'x');
  // Una cita SUYA y otra AJENA, el mismo día.
  const cidMia = equipo.db.prepare("INSERT INTO clients (name,active,created_at) VALUES (?,1,datetime('now'))").run('Cliente Mio ' + RID).lastInsertRowid;
  const cidAjena = equipo.db.prepare("INSERT INTO clients (name,active,created_at) VALUES (?,1,datetime('now'))").run('Cliente Ajeno ' + RID).lastInsertRowid;
  const insE = equipo.db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,created_at,updated_at) VALUES (?,?,?,?,?,30,0,'confirmada',datetime('now'),datetime('now'))");
  insE.run('GMM' + RID, cidMia, emp, D_VACIO, 9 * 60);
  const idAjena = insE.run('GMA' + RID, cidAjena, equipo.owner.id, D_VACIO, 11 * 60).lastInsertRowid;
  const cabEmp = { cookie: 'asess=' + tokEmp };
  // (a) EL MES. Se mira el JSON crudo, no la pantalla.
  const mesEmp = await (await fetch(equipo.base + '/api/erp/citas/mes?ym=' + MES + '&eje=persona&verTodo=1', { headers: cabEmp })).text();
  ok(mesEmp.includes('Cliente Mio ' + RID), 've SU cita en el mes');
  ok(!mesEmp.includes('Cliente Ajeno ' + RID), 'y la del compañero NO viaja a su navegador — ni con «ver todo el equipo» puesto');
  // Y las HORAS también son suyas: 12 h de una persona, no 168 de catorce.
  const jsonEmp = JSON.parse(mesEmp);
  const dEmp = jsonEmp.dias.find(d => d.fecha === D_VACIO);
  ok(dEmp.personas_abiertas === 1, 'las horas libres que se le enseñan son las SUYAS, no la capacidad del equipo', dEmp.personas_abiertas + ' persona · ' + dEmp.libres_min + ' min');
  ok(dEmp.capacidad_min === 12 * 60, 'o sea 12 h de una persona, no 168 de catorce', dEmp.capacidad_min + ' min');
  // (b) EL DÍA (la otra vista come del mismo candado).
  const diaEmp = await (await fetch(equipo.base + '/api/erp/citas/agenda?desde=' + D_VACIO + '&hasta=' + D_VACIO, { headers: cabEmp })).text();
  ok(diaEmp.includes('Cliente Mio ' + RID) && !diaEmp.includes('Cliente Ajeno ' + RID), 'en la vista Día pasa lo mismo: solo la suya');
  ok(!diaEmp.includes('Persona 1'), 'y las COLUMNAS tampoco delatan quién más trabaja hoy');
  // (c) LA PUERTA DE ATRÁS: tecleando el número de una cita ajena.
  const fichaAjena = await fetch(equipo.base + '/api/erp/citas/' + idAjena, { headers: cabEmp });
  const cuerpoAjena = await fichaAjena.text();
  ok(fichaAjena.status === 404, 'y entrando por el número de una cita ajena tampoco: 404', 'HTTP ' + fichaAjena.status);
  ok(!cuerpoAjena.includes('Cliente Ajeno ' + RID), 'sin filtrar ni un dato de esa cita en la respuesta');
  // (d) CON el permiso, lo ve todo. Si no, el candado estaría cerrado para todos y no probaría nada.
  equipo.db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(emp, permTodas.id);
  const conPermiso = await (await fetch(equipo.base + '/api/erp/citas/mes?ym=' + MES + '&eje=persona&verTodo=1', { headers: cabEmp })).text();
  ok(conPermiso.includes('Cliente Ajeno ' + RID), 'y al DARLE el permiso pasa a verlas todas: el candado abre, no solo cierra');
  // (e) El dueño nunca se queda fuera de su propia agenda.
  const delDuenyo = await (await fetch(equipo.base + '/api/erp/citas/mes?ym=' + MES + '&eje=persona&verTodo=1', { headers: conCookie })).text();
  ok(delDuenyo.includes('Cliente Ajeno ' + RID) && delDuenyo.includes('Cliente Mio ' + RID), 'el dueño sigue viéndolo todo sin que nadie le dé nada (bypass de rol)');

  // ── [18] MÓVIL ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[18] móvil · 360, 390 y 414 px: sin scroll horizontal ni errores');
  for (const w of [360, 390, 414]) {
    await pe.setViewport({ width: w, height: 780 });
    await abrirMes(pe, equipo, D_VACIO);
    const m = await pe.evaluate(() => ({
      desborda: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      filas: getComputedStyle(document.querySelector('.mes-rej')).gridTemplateRows.split(' ').filter(Boolean).length,
      celdas: document.querySelectorAll('.mescel').length,
      seSalen: [...document.querySelectorAll('.mesdia .lin')].some(l => l.getBoundingClientRect().right > document.querySelector('.mes-rej').getBoundingClientRect().right + 1),
    }));
    ok(!m.desborda, 'a ' + w + ' px no hay scroll horizontal');
    ok(!m.seSalen && m.celdas === m.filas * 7, 'a ' + w + ' px la rejilla cuadra y nada se sale', m.celdas + ' casillas en ' + m.filas + ' filas');
  }
  ok(errsE.length === 0, 'cero errores de consola en el negocio con equipo', errsE.slice(0, 2).join(' | '));
  ok(errs.length === 0, 'cero errores de consola en el negocio de una persona', errs.slice(0, 2).join(' | '));

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  try { if (b) await b.close(); } catch {}
  for (const c of conexiones) { try { c.close(); } catch {} }   // ANTES de borrar: ver arriba
  for (const s of creados) { try { borrarTenant(s); } catch {} }
  console.log('\n──────────────────────────────────────────────');
  console.log((fail === 0 ? '✓ GATE VERDE' : '✗ GATE ROJO') + ' — ' + pass + ' pasan · ' + fail + ' fallan');
  // Y EL MISMO VEREDICTO EN EL IDIOMA DEL RUNNER. `run-gates.mjs` decide PASA/SOSPECHOSO buscando un
  // resumen reconocible ("N OK", "PASS: n", "N comprobaciones"): un gate que sale 0 pero no dice
  // cuántas aserciones corrió lo marca SOSPECHOSO y **cuenta como no-pasa**. La línea de arriba, que
  // me inventé, no casaba con ninguno — así que este gate iba verde por su cuenta y el barrido lo
  // daba por no-pasado. Lo destapó el barrido del 21 ago: los CUATRO gates nuevos, los cuatro míos,
  // salían SOSPECHOSOS por esto. Es la hermana del fallo de estar fuera de GRUPOS: allí no lo
  // ejecutaba nadie, aquí sí lo ejecuta pero no sabe leer lo que contesta.
  console.log(pass + ' OK · ' + fail + ' fallos');
  process.exit(fail === 0 ? 0 : 1);
}
