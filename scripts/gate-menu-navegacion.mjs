// Gate — NAVEGACIÓN: MENOS RUIDO SIN PERDER NADA.
//
// Contra el servidor REAL y sobre un negocio CREADO DESDE CERO (y borrado al final), pulsando como
// pulsaría el dueño: que el enlace exista en el HTML NO demuestra que se pueda llegar.
//
// LA PRUEBA QUE MANDA es la [1] — NO AMPUTACIÓN. En julio se probó un menú "lean" que escondía
// funciones y se revirtió a propósito (U1, `494d2ab`). Esta pieza separa lo del día a día de los
// ajustes DENTRO de cada desplegable, y el número y la identidad de las entradas tiene que ser
// EXACTAMENTE el mismo que antes: las 50 puertas del inventario del PASO 0, una a una, pulsadas y
// respondiendo. Si falta una, la tarea está mal.
//
//   node scripts/gate-menu-navegacion.mjs
import puppeteer from 'puppeteer';
import path from 'path';
import { unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { launchOpts } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { fijarOficio, vocabulario } from '../modules/erp/oficios.js';

const RID = randomBytes(3).toString('hex');
const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PASS = 'Gate.Menu.' + RID + '!';

// ── LA LÍNEA BASE DEL PASO 0 — las 50 puertas del menú, con su área y su ruta ────────────────────
// Escrita a mano a partir del inventario medido ANTES de tocar nada (17 ago 2026). Es el contrato:
// esta lista NO se toca al añadir una función nueva sin actualizarla a conciencia, y cualquier
// entrada que desaparezca del menú pone este gate rojo.
const BASE_RAIL = [
  ['DISA', 'Propuestas', '/admin/propuestas'],
  ['DISA', 'Hablar con DISA', null],                                    // acción, no pantalla
  ['Ventas', 'Facturas', '/admin/invoices'],
  ['Ventas', 'Presupuestos', '/admin/quotes'],
  ['Ventas', 'Recurrentes', '/admin/recurrentes'],
  ['Ventas', 'Pedidos', '/admin/pedidos'],
  ['Ventas', 'Albaranes', '/admin/albaranes'],
  ['Ventas', 'Cobros', '/admin/cobros'],
  ['Ventas', 'TPV', '/admin/mostrador'],
  ['Clientes', 'Clientes', '/admin/clients'],
  ['Clientes', 'Oportunidades', '/admin/crm'],
  // MOVIDA DESDE VENTAS el 18 ago 2026 (decisión de Ibrahin). El inventario NO cambia de tamaño: son
  // las mismas 42 entradas del rail, una de ellas en otra área. Si algún día desaparece, este gate
  // se pone rojo igual.
  ['Clientes', 'Portal de cliente', '/admin/portal'],
  ['Clientes', 'Grupos', '/admin/clients/groups'],
  ['Proyectos', 'Proyectos', '/admin/proyectos'],
  ['Proyectos', 'Registro de tiempo', '/admin/tiempo'],
  ['Proyectos', 'Facturar horas', '/admin/facturar-horas'],
  ['Proyectos', 'Rentabilidad', '/admin/rentabilidad'],
  // ── AGENDA, DESPUÉS DE LA MUDANZA (18 ago 2026) ───────────────────────────────────────────────
  // EN AGENDA SOLO VIVE LO QUE SE USA ATENDIENDO CLIENTES. Las otras SEIS no se han borrado: están
  // en BASE_CONFIG, dentro de la configuración del negocio. El inventario NO encoge — lo comprueba
  // la prueba [1], sumando las dos listas y comparándolas UNA A UNA por identidad.
  ['Agenda', 'Agenda', '/admin/citas'],
  ['Agenda', 'Recordatorios a clientes', '/admin/citas/cola'],
  ['Compras y gastos', 'Facturas recibidas', '/admin/supplier-invoices'],
  ['Compras y gastos', 'Compra directa', '/admin/purchases'],
  ['Compras y gastos', 'Órdenes de compra', '/admin/purchase-orders'],
  ['Compras y gastos', 'Pagos a proveedores', '/admin/pagos'],
  ['Compras y gastos', 'Devoluciones', '/admin/supplier-returns'],
  ['Compras y gastos', 'Captura de factura', '/admin/purchases/capture'],
  ['Compras y gastos', 'Proveedores', '/admin/suppliers'],
  ['Contabilidad', 'Libros y modelos', '/admin/contabilidad'],
  ['Contabilidad', 'Conciliación bancaria', '/admin/conciliacion'],
  ['Contabilidad', 'Envío Verifactu (AEAT)', '/admin/verifactu/envios'],
  ['Inventario', 'Stock', '/admin/inventory'],
  ['Inventario', 'Traslados', '/admin/stock-transfers'],
  ['Inventario', 'Almacenes', '/admin/warehouses'],
  ['Catálogo', 'Productos', '/admin/products'],
  ['Catálogo', 'Categorías', '/admin/categories'],
  // B2 (23 ago 2026) — Etiquetas se reenganchó al menú: llevaba viva y sin enlace desde U7.
  // El inventario SUBE a propósito. Es lo contrario de una amputación, y por eso se apunta aquí:
  // si mañana desaparece, esta línea la echa de menos.
  ['Catálogo', 'Etiquetas', '/admin/tags'],
  ['Analítica', 'Informes', '/admin/analytics'],
  ['Analítica', 'Vigía (DISA)', '/admin/vigia'],
];
// ── LAS SEIS MUDADAS — la sección propia dentro de la configuración del negocio ─────────────────
// Mismo contrato que BASE_RAIL: nombre nuevo, nombre VIEJO (el que hay que seguir encontrando en el
// buscador), ruta —que NO cambia— y el permiso EXACTO que tenían en Agenda.
// El ORDEN importa y se comprueba: es el orden en que se monta un negocio, no el alfabético.
const BASE_CONFIG = [
  ['Cuándo abro',               'Horarios',              '/admin/citas/horarios',  'citas.read'],
  ['Cuánto dura cada servicio', 'Servicios reservables', '/admin/citas/servicios', 'citas.read'],
  ['Mi equipo',                 'Quién atiende',         '/admin/users',           'admin.manage_users'],
  ['Cómo se piden las citas',   'Ajustes de citas',      '/admin/citas/ajustes',   'citas.edit'],
  ['Mi página de reservas',     'Reservas por Internet', '/admin/citas/publica',   'citas.edit'],
  // CONDICIONAL: no aparece sin puestos. Por eso NO está en la comprobación de orden de [1] —
  // tiene su propio apartado, [6].
];
const CONFIG_PUESTOS = ['(puesto_plural)', 'Recursos', '/admin/citas/recursos', 'citas.read'];
const SECCION_CONFIG = 'Cómo funciona mi agenda';

// B1 (23 ago 2026) — «Trae tus datos» es la TERCERA fija: la puerta permanente a la migración
// asistida, al pie del rail, encima de la ayuda. Y desde hoy las fijas pasan por el filtro de
// permisos (lleva candado `company.read`), cosa que antes no ocurría con ninguna.
const BASE_FIJAS  = [['Inicio', '/admin'], ['Trae tus datos', '/admin/migracion'], ['Ayuda y soporte', '/docs']];
const BASE_CUENTA = [['Perfil', '/admin/perfil'], ['Datos del negocio', '/admin/settings'],
                     ['Usuarios', '/admin/users'], ['Actividad', '/admin/activity'],
                     ['Documentación', '/docs'], ['Cerrar sesión', '/admin/logout']];
// EL NÚMERO QUE NO PUEDE BAJAR. Antes de la mudanza: 42 del rail + 2 fijas + 6 de cuenta = 50.
// Después: 36 del rail + 6 en la configuración del negocio + 2 + 6 = las MISMAS 50.
// Y DESDE EL 23 AGO 2026 SON 52, porque la ficha B abrió dos puertas que estaban construidas y sin
// enlace: «Etiquetas» al rail (37) y «Trae tus datos» a las fijas (3). Que el número SUBA aquí es el
// resultado esperado del encargo; lo que este gate impide es que baje sin que nadie se entere.
//
// Con un matiz que se dice en voz alta en vez de esconderlo en el recuento: una de las seis —los
// puestos— es CONDICIONAL y nace oculta, así que un negocio recién creado enseña 49 y no 50. Por eso
// hay dos números y dos comprobaciones: [1] verifica las 49 de un negocio sin puestos, y [6] da uno
// de alta y verifica que aparece la 50ª. En ningún momento se comprueba «que salgan 50 cosas»: se
// comprueban UNA A UNA por identidad (área » nombre » ruta), que es lo que detecta una amputación
// disfrazada de entrada nueva.
const N_TOTAL       = BASE_RAIL.length + BASE_CONFIG.length + 1 + BASE_FIJAS.length + BASE_CUENTA.length;   // 36+5+1+2+6 = 50
const N_SIN_PUESTOS = N_TOTAL - 1;                                                                          // 49

// Qué áreas se parten en DOS bloques, y qué entradas quedan bajo el rótulo «Ajustes de <Área>». No
// cambia el inventario: solo dónde se pinta cada una dentro del MISMO desplegable.
//
// El desplegable se parte SOLO si hay al menos MIN_AJUSTES (3) entradas de ajuste — decisión de
// Ibrahin (18 ago 2026): «en el desplegable de Clientes hay como dos secciones, quiero una sola».
// Por debajo de eso se pinta UNA lista con los ajustes al final, sin rótulo. Hoy solo Agenda se parte.
// Clientes, Compras y gastos, Inventario y Catálogo tienen UNA entrada de ajuste cada uno y van
// enteros: siguen ahí, en su sitio y a los mismos clics, sin cartel.
// TRAS LA MUDANZA NO SE PARTE NINGUNA. Agenda era la única que llegaba al umbral (6 ajustes de 8) y
// se ha quedado en dos entradas del día a día. Las demás siguen con una sola entrada de ajuste, por
// debajo de MIN_AJUSTES (3). Que este mapa esté VACÍO es el resultado esperado, no un descuido: el
// desplegable de Agenda «va de una pieza» porque el umbral que ya existía lo decide solo.
const AJUSTES_ESPERADOS = {};
// Áreas con un solo ajuste: NO se parten, y su entrada de ajuste tiene que seguir estando, la última.
// Catálogo pasa a DOS entradas de ajuste (Categorías y Etiquetas) y sigue sin partirse: el umbral
// `MIN_AJUSTES` son 3. La última de su lista ya no es Categorías, es Etiquetas.
const SIN_PARTIR = { 'Clientes': 'Grupos', 'Compras y gastos': 'Proveedores', 'Inventario': 'Almacenes', 'Catálogo': 'Etiquetas' };

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); }
};
const dormir = ms => new Promise(r => setTimeout(r, ms));

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

// Lee el menú del DOM tal y como lo ve el navegador (no del HTML crudo: lo que cuenta es lo pintado).
const leerMenu = page => page.evaluate(() => {
  const txt = el => (el ? el.textContent.trim() : null);
  const sb = document.querySelector('.sidebar');
  if (!sb) return null;
  const nav = sb.querySelector('.sb-nav');
  const areas = [...nav.querySelectorAll(':scope > .navg')].map(g => {
    const out = { area: txt(g.querySelector('.nav-label')), diario: [], rotulo: null, ajustes: [] };
    let en = 'diario';
    for (const n of [...g.querySelector('.flyout').children]) {
      if (n.classList.contains('fly-grp')) { out.rotulo = txt(n); en = 'ajustes'; continue; }
      if (!n.classList.contains('fly-item')) continue;
      out[en].push({ label: txt(n.querySelector('.fly-tx')), href: n.getAttribute('href'),
                     anclable: !!n.querySelector('.fly-pin') });
    }
    return out;
  });
  return {
    areas,
    pin: { label: txt(sb.querySelector('.disa-pin .nav-label')), href: sb.querySelector('.disa-pin').getAttribute('href') },
    // EL PIE SON VARIAS desde el 23 ago 2026. Antes esto estaba cableado a `/docs`, así que una
    // entrada nueva al pie no la habría visto nadie — ni para bien ni para mal. Ahora se leen todas.
    pies: [...nav.querySelectorAll(':scope > a.nav-item')].map(a => ({
      label: txt(a.querySelector('.nav-label')), href: a.getAttribute('href') })),
    cuenta: [...document.querySelectorAll('.acct-menu .acct-item')].map(a => ({ label: txt(a.querySelector('span')), href: a.getAttribute('href') })),
    // Hijas DIRECTAS del bloque: un área anclada trae su desplegable dentro, y sus entradas no son anclas.
    anclas: [...document.querySelectorAll('#railAnc > .anc')].map(a => ({
      key: a.dataset.anc, href: a.getAttribute('href'),
      tipo: a.classList.contains('navg') ? 'area' : 'entrada',
      subentradas: a.querySelectorAll('.flyout .fly-item').length,
      label: a.querySelector('.nav-label')?.textContent.trim() || null,
    })),
    // ¿Tiene chincheta cada ÁREA del rail? (el encargo: se ancla CUALQUIER entrada, áreas incluidas)
    areasConPin: [...nav.querySelectorAll(':scope > .navg')].filter(g => g.querySelector(':scope > .nav-pin')).length,
    // (D) claves en el ORDEN en que se pintan, y qué es arrastrable
    ordenAreas: [...nav.querySelectorAll(':scope > .navg[data-ord]')].map(g => g.getAttribute('data-ord')),
    areasArrastrables: [...nav.querySelectorAll(':scope > .navg')].filter(g => g.getAttribute('draggable') === 'true').length,
    entradasArrastrables: [...nav.querySelectorAll(':scope > .navg .fly-item[data-ord][draggable="true"]')].length,
    ordenEntradas: Object.fromEntries([...nav.querySelectorAll(':scope > .navg')].map(g => [
      g.querySelector('.nav-label').textContent.trim(),
      [...g.querySelectorAll('.fly-item[data-ord]')].map(e => e.getAttribute('data-ord') + ':' + e.getAttribute('data-bloque')),
    ])),
    reset: !!document.getElementById('railReset'),
    destinos: (window.MENU_DESTINOS || []).map(d => ({ key: d.key, label: d.label, href: d.href })),
  };
});

// Lee la SECCIÓN de la configuración del negocio tal y como la ve el navegador, más qué OTRAS
// partes de esa pantalla se están pintando. Lo segundo es la mitad que demuestra la corrección de
// Ibrahin: que quien entra por `citas.read` vea SU sección no puede significar que vea el resto.
const leerConfig = page => page.evaluate(() => {
  const txt = el => (el ? el.textContent.trim() : null);
  const secs = [...document.querySelectorAll('.cfg-sec')].map(sec => ({
    id: sec.id,
    label: txt(sec.querySelector('h3')),
    items: [...sec.querySelectorAll('.cfg-item')].map(a => ({
      label: txt(a.querySelector('.cfg-tx strong')),
      desc: txt(a.querySelector('.cfg-tx small')),
      href: a.getAttribute('href'),
    })),
  }));
  const cuerpo = document.body.innerText;
  return {
    secs,
    // Las OTRAS partes de la pantalla, las que exigen company.read.
    empresa: !!document.getElementById('cName'),
    avisos: /Avisos y correos/.test(cuerpo),
    plantillas: /Plantillas de email/.test(cuerpo),
    fiscal: /Situación fiscal/.test(cuerpo),
  };
});

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] DE CERO — negocio nuevo y oficio elegido, como en el alta real');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const email = 'gate-menu-' + RID + '@bamburu.test';
  const alta = await provisionTenant({
    businessName: 'Gate Menu ' + RID, ownerName: 'Dueña Gate',
    email, password: PASS, phone: '+34 600 000 000',
  });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  ok(!!t, 'negocio creado desde cero', slug);
  const dbPath = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
  db = new Database(dbPath);
  const BASE = 'http://' + slug + '.localhost:3000';
  const DOMAIN = slug + '.localhost';

  fijarOficio(db, 'peluqueria');
  const PUESTOS = vocabulario(db).puesto_plural;
  ok(!!PUESTOS, 'oficio "peluquería" elegido; sus puestos se llaman', PUESTOS);

  browser = await puppeteer.launch(launchOpts());
  const errsGlobal = [];
  const page = await browser.newPage();
  page.on('pageerror', e => errsGlobal.push(String(e && e.message || e)));
  await page.setViewport({ width: 1400, height: 950 });

  // Entrar POR LA PUERTA: formulario de login real, no una fila de sesión inyectada.
  await page.goto(BASE + '/admin/login', { waitUntil: 'networkidle0' });
  await page.type('#email', email);
  await page.type('#password', PASS);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type="submit"]')]);
  ok(page.url().includes('/admin') && !page.url().includes('/login'), 'el dueño entra con su email y su contraseña', page.url());

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA PRUEBA QUE MANDA — NO AMPUTACIÓN: las ' + N_TOTAL + ' puertas siguen ahí');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // LA MUDANZA DEL 18 AGO 2026 movió SEIS entradas de Agenda a la configuración del negocio. Esta
  // prueba es la que dice si se movieron o si se perdieron, y lo hace SUMANDO LAS DOS SUPERFICIES y
  // comparando la lista entera UNA A UNA por identidad. Un recuento no valdría: 36+6 y 37+5 dan el
  // mismo número y son cosas distintas.
  const menu = await leerMenu(page);
  ok(!!menu, 'el rail se renderiza');

  const esperado = BASE_RAIL.map(([a, l, h]) => [a, l === '(puesto_plural)' ? PUESTOS : l, h]);
  const vistoRail = [];
  for (const a of menu.areas) for (const i of a.diario.concat(a.ajustes)) vistoRail.push([a.area, i.label, i.href]);

  ok(vistoRail.length === BASE_RAIL.length,
     'el rail tiene EXACTAMENTE las ' + BASE_RAIL.length + ' entradas que le quedan tras la mudanza', 'hay ' + vistoRail.length);
  const clave = x => x[0] + ' » ' + x[1] + ' » ' + (x[2] || '(acción)');

  // ── LA OTRA MITAD DEL INVENTARIO: la sección dentro de la configuración del negocio ────────────
  await page.goto(BASE + '/admin/settings', { waitUntil: 'networkidle0' });
  const cfg = await leerConfig(page);
  ok(cfg.secs.length === 1 && cfg.secs[0].label === SECCION_CONFIG,
     'la configuración del negocio tiene UNA sección propia para las mudadas', cfg.secs.map(x => x.label).join(' · '));
  const vistoConfig = (cfg.secs[0] ? cfg.secs[0].items : []).map(i => [SECCION_CONFIG, i.label, i.href]);
  // El negocio acaba de nacer y no tiene puestos, así que aquí se esperan CINCO (ver N_SIN_PUESTOS).
  const espConfig = BASE_CONFIG.map(([nuevo, , h]) => [SECCION_CONFIG, nuevo, h]);
  ok(JSON.stringify(vistoConfig.map(x => x[1])) === JSON.stringify(espConfig.map(x => x[1])),
     'y sus 5 entradas están EN EL ORDEN en que se monta un negocio',
     vistoConfig.map(x => x[1]).join(' → '));

  // ── LA SUMA: ni una menos que antes de la mudanza ──────────────────────────────────────────────
  const todoEsperado = esperado.concat(espConfig);
  const todoVisto = vistoRail.concat(vistoConfig);
  const setVisto = new Set(todoVisto.map(clave));
  const faltan = todoEsperado.filter(e => !setVisto.has(clave(e)));
  const sobran = todoVisto.filter(v => !new Set(todoEsperado.map(clave)).has(clave(v)));
  ok(faltan.length === 0, 'ninguna entrada del inventario ha desaparecido al mudarse',
     faltan.length ? 'FALTAN: ' + faltan.map(clave).join(' | ') : 'las ' + todoEsperado.length + ', una a una');
  ok(sobran.length === 0, 'no ha aparecido ninguna entrada que no estuviera',
     sobran.length ? 'SOBRAN: ' + sobran.map(clave).join(' | ') : 'ninguna de más');
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });

  ok(menu.pin.label === 'Inicio' && menu.pin.href === '/admin', 'sigue el pin de Inicio arriba del rail');
  const piesEsp = BASE_FIJAS.filter(([, h]) => h !== '/admin').map(([l, h]) => l + ' » ' + h);
  const piesVis = menu.pies.map(i => i.label + ' » ' + i.href);
  ok(JSON.stringify(piesVis) === JSON.stringify(piesEsp),
     'el pie del rail tiene sus ' + piesEsp.length + ' entradas, en orden y sin pisarse', piesVis.join(' · '));
  ok(menu.pies.some(i => i.href === '/docs'), 'y Ayuda y soporte sigue ahí');
  const cuentaVista = menu.cuenta.map(i => i.label + ' » ' + i.href);
  const cuentaEsp = BASE_CUENTA.map(([l, h]) => l + ' » ' + h);
  ok(cuentaEsp.every(x => cuentaVista.includes(x)) && cuentaVista.length === cuentaEsp.length,
     'el menú de cuenta conserva sus ' + cuentaEsp.length + ' entradas', cuentaVista.join(' · '));
  const N_VISTO = vistoRail.length + vistoConfig.length + (1 + menu.pies.length) + menu.cuenta.length;   // 1 = el pin de Inicio
  ok(N_VISTO === N_SIN_PUESTOS, 'N ANTES = N DESPUÉS (menos la condicional, que aparece en [6])',
     N_TOTAL + ' puertas antes · ' + N_VISTO + ' ahora + 1 condicional');

  // ── Separadas en dos bloques, pero SIN plegar: todas visibles en el mismo desplegable ──────────
  for (const a of menu.areas) {
    const esp = (AJUSTES_ESPERADOS[a.area] || []).map(l => (l === '(puesto_plural)' ? PUESTOS : l));
    const vis = a.ajustes.map(i => i.label);
    ok(JSON.stringify(vis) === JSON.stringify(esp),
       'área "' + a.area + '": el bloque de ajustes es el esperado', vis.length ? vis.join(', ') : '(ninguno, va de una pieza)');
    if (esp.length) ok(a.rotulo === 'Ajustes de ' + a.area, 'área "' + a.area + '": el rótulo lo dice con su nombre', a.rotulo);
    else ok(a.rotulo === null, 'área "' + a.area + '": UNA sola lista, sin segundo rótulo', String(a.rotulo));
  }
  // Las áreas que ya no se parten no han perdido su entrada de ajuste: sigue ahí, la última de la lista.
  for (const [area, ultima] of Object.entries(SIN_PARTIR)) {
    const a = menu.areas.find(x => x.area === area);
    ok(!!a && a.diario[a.diario.length - 1]?.label === ultima,
       'área "' + area + '" va de una pieza y "' + ultima + '" sigue ahí, al final',
       a ? a.diario.map(i => i.label).join(' · ') : '(sin área)');
  }
  ok(menu.areasConPin === menu.areas.length,
     'CADA ÁREA del rail tiene su chincheta: se ancla cualquier entrada del menú, áreas incluidas',
     menu.areasConPin + ' de ' + menu.areas.length);
  ok(menu.areasArrastrables === menu.areas.length,
     'y CADA ÁREA se puede arrastrar para moverla de orden', menu.areasArrastrables + ' de ' + menu.areas.length);
  ok(menu.entradasArrastrables === BASE_RAIL.length,
     'y las ' + BASE_RAIL.length + ' entradas de los desplegables también', menu.entradasArrastrables + '');
  ok(!menu.reset, 'de fábrica NO hay botón de restablecer: no hay nada que restablecer');

  // ── AGENDA: DOS ENTRADAS Y DE UNA PIEZA ───────────────────────────────────────────────────────
  const ag = await page.evaluate(() => {
    const g = [...document.querySelectorAll('.navg')].find(x => x.querySelector('.nav-label')?.textContent.trim() === 'Agenda');
    window.openFly(g);
    const items = [...g.querySelectorAll('.flyout .fly-item')];
    return {
      total: items.length,
      visibles: items.filter(el => el.offsetParent !== null).length,
      etiquetas: items.map(el => el.querySelector('.fly-tx').textContent.trim()),
      sep: g.querySelectorAll('.flyout .fly-sep').length,
      rotulo: g.querySelector('.flyout .fly-grp')?.textContent.trim() || null,
    };
  });
  await dormir(150);
  ok(ag.total === 2 && ag.visibles === 2, 'Agenda muestra EXACTAMENTE 2 entradas', ag.etiquetas.join(' · '));
  ok(JSON.stringify(ag.etiquetas) === JSON.stringify(['Agenda', 'Recordatorios a clientes']),
     'y son la agenda y los recordatorios: solo lo que se usa atendiendo clientes', ag.etiquetas.join(' · '));
  // «De una pieza» es literal: ni línea separadora ni rótulo «Ajustes de Agenda». Y no se ha tocado
  // ningún umbral para conseguirlo — con 0 entradas de ajuste, MIN_AJUSTES lo decide solo.
  ok(ag.sep === 0 && ag.rotulo === null,
     'y el desplegable va DE UNA PIEZA: sin línea y sin rótulo de ajustes', 'sep=' + ag.sep + ' rotulo=' + ag.rotulo);

  // ── PULSAR una a una. Que el enlace exista no demuestra que se pueda llegar. ───────────────────
  console.log('\n  ... pulsando las entradas una a una (esto tarda)');
  const rotos = [];
  const pulsables = esperado.filter(e => e[2]);
  for (const [area, label, href] of pulsables) {
    try {
      // Se abre el desplegable de su área pasando el ratón, como haría el dueño, y se PULSA.
      await page.evaluate(a => {
        const g = [...document.querySelectorAll('.navg')].find(x => x.querySelector('.nav-label')?.textContent.trim() === a);
        window.openFly(g);
      }, area);
      await page.waitForSelector('.flyout.open a.fly-item[href="' + href + '"]', { timeout: 4000 });
      const [res] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        page.click('.flyout.open a.fly-item[href="' + href + '"]'),
      ]);
      const st = res ? res.status() : 0;
      const tieneRail = await page.evaluate(() => !!document.querySelector('.sidebar'));
      if (st !== 200 || !tieneRail) rotos.push(label + ' (' + href + ') → HTTP ' + st + (tieneRail ? '' : ', sin rail'));
    } catch (e) {
      rotos.push(label + ' (' + href + ') → ' + (e.message || e).slice(0, 80));
    }
  }
  ok(rotos.length === 0, 'las ' + pulsables.length + ' entradas del rail se PULSAN y responden 200',
     rotos.length ? 'ROTAS: ' + rotos.join(' | ') : 'todas');

  // ── LAS SEIS MUDADAS: 200 DESDE SU SITIO NUEVO Y DESDE SU RUTA VIEJA ───────────────────────────
  // Las dos mitades importan. Desde el sitio nuevo, porque una entrada que se pinta y no lleva a
  // ningún sitio es peor que no tenerla. Desde la ruta vieja, porque el encargo promete que quien
  // tenga un enlace guardado (o un botón del vigía, o un aviso de DISA) sigue llegando: las rutas NO
  // han cambiado, y esto es lo que lo demuestra en vez de darlo por hecho.
  const rotosCfg = [], rotosViejo = [];
  for (const [nuevo, , href] of BASE_CONFIG) {
    try {
      await page.goto(BASE + '/admin/settings', { waitUntil: 'networkidle0' });
      await page.waitForSelector('.cfg-item[href="' + href + '"]', { timeout: 4000 });
      const [res] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        page.click('.cfg-item[href="' + href + '"]'),
      ]);
      const st = res ? res.status() : 0;
      const tieneRail = await page.evaluate(() => !!document.querySelector('.sidebar'));
      if (st !== 200 || !tieneRail) rotosCfg.push(nuevo + ' (' + href + ') → HTTP ' + st + (tieneRail ? '' : ', sin rail'));
    } catch (e) { rotosCfg.push(nuevo + ' (' + href + ') → ' + (e.message || e).slice(0, 80)); }
    // Y la MISMA ruta, tecleada a pelo como haría quien la tiene en favoritos.
    const r = await page.goto(BASE + href, { waitUntil: 'domcontentloaded' });
    if (!r || r.status() !== 200) rotosViejo.push(href + ' → HTTP ' + (r ? r.status() : 0));
  }
  ok(rotosCfg.length === 0, 'las ' + BASE_CONFIG.length + ' mudadas se PULSAN desde su sitio nuevo y responden 200',
     rotosCfg.length ? 'ROTAS: ' + rotosCfg.join(' | ') : 'todas');
  ok(rotosViejo.length === 0, 'y sus rutas VIEJAS siguen respondiendo 200: un enlace guardado sigue llegando',
     rotosViejo.length ? 'ROTAS: ' + rotosViejo.join(' | ') : BASE_CONFIG.map(x => x[2]).join(' · '));

  // «Hablar con DISA» no es pantalla: abre el chat de siempre. Se comprueba pulsándola.
  await page.goto(BASE + '/admin/clients', { waitUntil: 'networkidle0' });
  const hilosAntes = db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads').get().n;
  await page.evaluate(() => {
    const g = document.getElementById('disaRailBtn').closest('.navg');
    window.openFly(g);
    [...g.querySelectorAll('.flyout .fly-item')].find(el => el.textContent.trim() === 'Hablar con DISA').click();
  });
  await page.waitForFunction(() => !!document.querySelector('#disaModal.open'), { timeout: 5000 }).catch(() => {});
  const chat = await page.evaluate(() => ({ abierto: !!document.querySelector('#disaModal.open'), widgets: document.querySelectorAll('#disaFab').length }));
  ok(chat.abierto && chat.widgets === 1, '"Hablar con DISA" sigue abriendo el chat flotante de siempre');
  ok(db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads').get().n === hilosAntes, 'y no crea ningún hilo nuevo');

  // Las de cuenta, pulsadas también (salvo Cerrar sesión, que se pulsa al final, y /docs, que se sirve fuera).
  const rotosCuenta = [];
  for (const [label, href] of BASE_CUENTA) {
    if (href === '/admin/logout' || href === '/docs') continue;
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.click('#acctBtn');
    await dormir(120);
    const [res] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('.acct-menu a.acct-item[href="' + href + '"]'),
    ]);
    if (!res || res.status() !== 200) rotosCuenta.push(label + ' → HTTP ' + (res ? res.status() : 0));
  }
  ok(rotosCuenta.length === 0, 'las entradas del menú de cuenta se pulsan y responden 200',
     rotosCuenta.length ? rotosCuenta.join(' | ') : 'Perfil · Datos del negocio · Usuarios · Actividad');
  const docs = await page.goto(BASE + '/docs', { waitUntil: 'domcontentloaded' });
  ok(docs.status() === 200, 'Ayuda y soporte / Documentación (/docs) responde 200');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EL BUSCADOR NAVEGA — tres términos distintos, tres rutas correctas');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const buscar = async q => {
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
    await page.click('#tbq');
    await page.type('#tbq', q, { delay: 25 });
    await dormir(200);
    return page.evaluate(() => [...document.querySelectorAll('#tbres .tb-res-i')].map(a => ({
      label: a.querySelector('.tb-res-tx').textContent.trim(), href: a.getAttribute('href'),
    })));
  };
  const irConEnter = async q => {
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
    await page.click('#tbq');
    await page.type('#tbq', q, { delay: 25 });
    await dormir(200);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }), page.keyboard.press('Enter')]);
    return page.url();
  };
  const r1 = await buscar('presupuesto');
  ok(r1.length === 1 && r1[0].href === '/admin/quotes', '"presupuesto" encuentra Presupuestos', JSON.stringify(r1));
  const u1 = await irConEnter('presupuesto');
  ok(u1.endsWith('/admin/quotes'), 'y con Enter LLEVA a /admin/quotes', u1);

  const r2 = await buscar('almacen');   // sin tilde: se busca por nombre, normalizando acentos
  ok(r2.some(x => x.href === '/admin/warehouses'), '"almacen" (sin tilde) encuentra Almacenes', JSON.stringify(r2));
  const u2 = await irConEnter('almacen');
  ok(u2.endsWith('/admin/warehouses'), 'y con Enter LLEVA a /admin/warehouses', u2);

  const r3 = await buscar('conciliaci');
  ok(r3.some(x => x.href === '/admin/conciliacion'), '"conciliaci" encuentra Conciliación bancaria', JSON.stringify(r3));
  const u3 = await irConEnter('conciliaci');
  ok(u3.endsWith('/admin/conciliacion'), 'y con Enter LLEVA a /admin/conciliacion', u3);

  // ── LAS 8 DE LA AGENDA, POR SU NOMBRE NUEVO **Y** POR EL VIEJO ────────────────────────────────
  // Es la comprobación que impide que renombrar sea perder. Quien lleva un año escribiendo «Cola de
  // envíos» tiene que seguir llegando a su pantalla — y ver en el resultado el nombre NUEVO, que es
  // como se llama ahora y como la buscará la próxima vez.
  //
  // Se buscan las OCHO: las dos que se quedan en Agenda y las seis mudadas. Los puestos van aparte,
  // en [6], porque de fábrica no existen y buscar algo que aún no existe tiene que dar cero.
  const OCHO = [
    ['Agenda', null, '/admin/citas'],
    ['Recordatorios a clientes', 'Cola de envíos', '/admin/citas/cola'],
    ...BASE_CONFIG.map(([nuevo, viejo, href]) => [nuevo, viejo, href]),
  ];
  const malNuevo = [], malViejo = [], malEtiqueta = [];
  for (const [nuevo, viejo, href] of OCHO) {
    const rn = await buscar(nuevo.slice(0, 12));
    if (!rn.some(x => x.href === href)) malNuevo.push(nuevo + ' (' + href + ')');
    if (!viejo) continue;
    const rv = await buscar(viejo.slice(0, 12));
    const hit = rv.find(x => x.href === href);
    if (!hit) malViejo.push(viejo + ' → ' + href);
    // Y lo que se PINTA es el nombre nuevo, no el alias por el que se ha llegado.
    else if (hit.label.replace(/ · \d+$/, '') !== nuevo) malEtiqueta.push(viejo + ' → enseña "' + hit.label + '"');
  }
  ok(malNuevo.length === 0, 'las 8 de la agenda se encuentran por su nombre NUEVO',
     malNuevo.length ? 'NO SALEN: ' + malNuevo.join(' | ') : OCHO.map(x => x[0]).join(' · '));
  ok(malViejo.length === 0, 'y las 7 renombradas también por el VIEJO: quien buscaba «Cola de envíos» la encuentra',
     malViejo.length ? 'NO SALEN: ' + malViejo.join(' | ') : OCHO.filter(x => x[1]).map(x => x[1]).join(' · '));
  ok(malEtiqueta.length === 0, 'y el resultado enseña el nombre NUEVO, no el alias tecleado',
     malEtiqueta.length ? malEtiqueta.join(' | ') : 'los 7');

  // Buscar por el nombre viejo LLEVA de verdad, no solo pinta.
  const uViejo = await irConEnter('Cola de env');
  ok(uViejo.endsWith('/admin/citas/cola'), '«Cola de envíos» + Enter sigue llevando a los recordatorios', uViejo);
  const uHor = await irConEnter('Horarios');
  ok(uHor.endsWith('/admin/citas/horarios'), '«Horarios» + Enter sigue llevando a «Cuándo abro»', uHor);

  // Un alias NO crea un destino de más: sigue habiendo UNA entrada por pantalla.
  const dupe = await buscar('Cuándo abro');
  ok(dupe.filter(x => x.href === '/admin/citas/horarios').length === 1,
     'un alias no duplica el destino: sigue habiendo UNA entrada por pantalla', JSON.stringify(dupe.map(x => x.label)));

  // Teclado: flechas + Enter llevan al SEGUNDO resultado, no al primero.
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  await page.click('#tbq');
  await page.type('#tbq', 'factura', { delay: 25 });
  await dormir(200);
  const lista = await page.evaluate(() => [...document.querySelectorAll('#tbres .tb-res-i')].map(a => a.getAttribute('href')));
  await page.keyboard.press('ArrowDown');
  await dormir(80);
  const [, ] = await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }), page.keyboard.press('Enter')]);
  ok(lista.length > 1 && page.url().endsWith(lista[1]), 'flecha abajo + Enter llevan al 2º resultado', page.url());

  // Atajo de teclado.
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
  await dormir(120);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'tbq'), 'Ctrl+K pone el foco en el buscador');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] ANCLAR, REORDENAR, CERRAR SESIÓN Y VOLVER');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const anclar = async (area, href) => {
    await page.evaluate(a => {
      const g = [...document.querySelectorAll('.navg')].find(x => x.querySelector('.nav-label')?.textContent.trim() === a);
      window.openFly(g);
    }, area);
    await page.click('.flyout.open a.fly-item[href="' + href + '"] .fly-pin');
    await dormir(350);
  };
  // Anclar un ÁREA se hace con la chincheta del área, la que vive en el rail junto a su nombre.
  const anclarArea = async nombre => {
    await page.evaluate(a => {
      const g = [...document.querySelectorAll('.sb-nav > .navg')].find(x => x.querySelector('.nav-label')?.textContent.trim() === a);
      g.querySelector(':scope > .nav-pin').click();
    }, nombre);
    await dormir(350);
  };
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  await anclar('Ventas', '/admin/invoices');
  await anclar('Agenda', '/admin/citas');
  await anclar('Clientes', '/admin/clients');
  let m = await leerMenu(page);
  ok(JSON.stringify(m.anclas.map(a => a.key)) === JSON.stringify(['invoices', 'citas', 'clients']),
     'tres entradas ancladas, en el orden en que se pulsaron', JSON.stringify(m.anclas.map(a => a.key)));
  ok(m.areas.reduce((n, a) => n + a.diario.length + a.ajustes.length, 0) === BASE_RAIL.length,
     'anclar NO saca la entrada de su área: el rail sigue con sus ' + BASE_RAIL.length + ' entradas');

  // ── Y AHORA UN ÁREA ENTERA: el menú principal también se ancla ────────────────────────────────
  const areasAntes = m.areas.map(a => a.area);
  await anclarArea('Compras y gastos');
  m = await leerMenu(page);
  const ancArea = m.anclas.find(a => a.key === 'area:compras');
  ok(!!ancArea && ancArea.tipo === 'area', 'un ÁREA del rail se ancla igual que una entrada',
     JSON.stringify(m.anclas.map(a => a.key + ':' + a.tipo)));
  ok(ancArea && ancArea.label === 'Compras y gastos', 'y llega arriba con su nombre', ancArea && ancArea.label);
  ok(ancArea && ancArea.subentradas === 7,
     'el área anclada trae su desplegable ENTERO (no se convierte en un enlace suelto)',
     (ancArea && ancArea.subentradas) + ' entradas');
  ok(JSON.stringify(m.areas.map(a => a.area)) === JSON.stringify(areasAntes),
     'las áreas de fábrica NO se reordenan, NO se renombran y NO se quitan al anclar una',
     m.areas.map(a => a.area).join(' · '));
  ok(m.areas.reduce((n, a) => n + a.diario.length + a.ajustes.length, 0) === BASE_RAIL.length,
     'y el rail sigue con sus ' + BASE_RAIL.length + ' entradas: anclar un área es un ATAJO, no un traslado');
  // Y su desplegable de arriba ABRE, igual que el de siempre.
  const flyAncla = await page.evaluate(() => {
    const g = document.querySelector('#railAnc > .navg.anc');
    g.querySelector(':scope > .nav-item').click();
    const fly = g.querySelector('.flyout');
    const it = [...fly.querySelectorAll('.fly-item .fly-tx')].map(e => e.textContent.trim());
    return { abierto: fly.classList.contains('open'), primera: it[0], ultima: it[it.length - 1], n: it.length };
  });
  await dormir(150);
  // Compras y gastos va de UNA pieza (un solo ajuste), así que el desplegable del atajo es su lista
  // entera, de «Facturas recibidas» a «Proveedores» — la misma que la del área en su sitio.
  ok(flyAncla.abierto && flyAncla.primera === 'Facturas recibidas' && flyAncla.ultima === 'Proveedores' && flyAncla.n === 7,
     'el área anclada abre el MISMO desplegable, entero', JSON.stringify(flyAncla));

  // Reordenar: se guarda el orden nuevo por la misma puerta que usa el arrastre. Un área y tres
  // entradas se reordenan MEZCLADAS, que es de lo que va el bloque.
  const nuevoOrden = ['area:compras', 'clients', 'invoices', 'citas'];
  await page.evaluate(async o => {
    await api('PUT', '/api/erp/menu/anclas', { claves: o });
  }, nuevoOrden);
  await page.reload({ waitUntil: 'networkidle0' });
  m = await leerMenu(page);
  ok(JSON.stringify(m.anclas.map(a => a.key)) === JSON.stringify(nuevoOrden), 'el orden nuevo se guarda', JSON.stringify(m.anclas.map(a => a.key)));

  // CERRAR SESIÓN de verdad (pulsando) y volver a entrar.
  await page.click('#acctBtn');
  await dormir(120);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.acct-menu a[href="/admin/logout"]')]);
  ok(page.url().includes('/admin/login'), 'al pulsar "Cerrar sesión" se sale a la pantalla de entrada', page.url());
  await page.type('#email', email);
  await page.type('#password', PASS);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type="submit"]')]);
  m = await leerMenu(page);
  ok(JSON.stringify(m.anclas.map(a => a.key)) === JSON.stringify(nuevoOrden),
     'tras cerrar sesión y volver, siguen ancladas Y en el orden puesto', JSON.stringify(m.anclas.map(a => a.key)));

  // Quitar las anclas → el menú queda IDÉNTICO al de fábrica (y sin fila en la tabla).
  const antesFabrica = JSON.stringify((await leerMenu(page)).areas);
  await page.evaluate(async () => { await api('PUT', '/api/erp/menu/anclas', { claves: [] }); });
  await page.reload({ waitUntil: 'networkidle0' });
  m = await leerMenu(page);
  ok(m.anclas.length === 0, 'al quitarlas todas no queda ni un ancla');
  ok(await page.evaluate(() => {
       const b = document.getElementById('railAnc');
       return !!b && b.children.length === 0 && b.getBoundingClientRect().height === 0;
     }), 'y el bloque queda VACÍO y sin ocupar un solo píxel');
  ok(JSON.stringify(m.areas) === antesFabrica, 'el menú queda IDÉNTICO al de fábrica');
  const filas = db.prepare("SELECT COUNT(*) n FROM dashboard_layouts WHERE scope LIKE 'menu:usuario:%'").get().n;
  ok(filas === 0, 'la preferencia se borra: la ausencia de fila ES el defecto', filas + ' filas');

  // Tope de 8.
  await page.evaluate(async () => {
    const r = await fetch('/api/erp/menu/anclas', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
      body: JSON.stringify({ claves: ['invoices','quotes','recurrentes','pedidos','albaranes','cobros','mostrador','portal','clients'] }) });
    window.__tope = r.status;
  });
  ok(await page.evaluate(() => window.__tope) === 400, 'el servidor rechaza más de 8 anclas (400)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3-bis] MOVER DE ORDEN — los menús Y los submenús');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // CAMBIO DE REGLA pedido por Ibrahin: el encargo decía «las áreas de fábrica NO se reordenan». Ahora
  // SÍ. Lo que sigue intacto: nada se esconde, nada se quita, y ninguna entrada se muda de área.
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  const fabricaAreas = (await leerMenu(page)).ordenAreas;
  const fabricaVentas = (await leerMenu(page)).ordenEntradas['Ventas'];

  // ── ARRASTRE DE VERDAD: el área "Analítica" encima de "Ventas" ────────────────────────────────
  await page.setDragInterception(true);
  await page.evaluate(() => { document.querySelector('.sidebar').classList.add('flyopen'); });
  await dormir(250);
  const cajaDe = async sel => { const h = await page.$(sel); return h ? h.boundingBox() : null; };
  const rA = await cajaDe('#sbNav > .navg[data-ord="area:analitica"] > .nav-item');
  const rV = await cajaDe('#sbNav > .navg[data-ord="area:ventas"] > .nav-item');
  await page.mouse.dragAndDrop({ x: rA.x + rA.width / 2, y: rA.y + rA.height / 2 }, { x: rV.x + rV.width / 2, y: rV.y + 4 });
  await dormir(700);
  m = await leerMenu(page);
  const espAreas = fabricaAreas.filter(a => a !== 'area:analitica');
  espAreas.splice(espAreas.indexOf('area:ventas'), 0, 'area:analitica');
  ok(JSON.stringify(m.ordenAreas) === JSON.stringify(espAreas),
     'ARRASTRANDO un ÁREA se mueve de orden en el rail', m.ordenAreas.join(' '));
  ok(m.areas.reduce((n, a) => n + a.diario.length + a.ajustes.length, 0) === BASE_RAIL.length,
     'y no se pierde ni una entrada al moverla', BASE_RAIL.length + '');
  ok(m.reset, 'aparece el botón «Restablecer mi menú» en cuanto hay algo que restablecer');

  // ── ARRASTRE DE VERDAD: una ENTRADA dentro de su desplegable ──────────────────────────────────
  await page.evaluate(() => {
    const g = [...document.querySelectorAll('#sbNav > .navg')].find(x => x.querySelector('.nav-label').textContent.trim() === 'Ventas');
    window.openFly(g);
  });
  await dormir(300);
  const rT = await cajaDe('.flyout.open .fly-item[data-ord="mostrador"]');
  const rF = await cajaDe('.flyout.open .fly-item[data-ord="invoices"]');
  await page.mouse.dragAndDrop({ x: rT.x + 30, y: rT.y + rT.height / 2 }, { x: rF.x + 30, y: rF.y + 3 });
  await dormir(700);
  m = await leerMenu(page);
  ok(m.ordenEntradas['Ventas'][0] === 'mostrador:diario',
     'ARRASTRANDO una ENTRADA se mueve de orden dentro de su desplegable', m.ordenEntradas['Ventas'].join(' '));
  ok(m.ordenEntradas['Ventas'].length === fabricaVentas.length,
     'y su área sigue con todas sus entradas', m.ordenEntradas['Ventas'].length + ' de ' + fabricaVentas.length);

  // ── CRUZAR LA LÍNEA: una entrada pasa al bloque de ajustes ────────────────────────────────────
  // ⚠️ ESTA PRUEBA HA CAMBIADO DE ÁREA, Y SE DICE AQUÍ PARA QUE NO PAREZCA UNA COMPROBACIÓN PERDIDA.
  // Se hacía en AGENDA, que era la única área que llegaba al umbral (6 ajustes de 8). Tras la mudanza
  // del 18 ago 2026 Agenda tiene dos entradas y NINGUNA de ajuste, así que ya no se parte — y con
  // MIN_AJUSTES=3 ninguna área de fábrica lo hace. La CAPACIDAD sigue viva y sigue teniendo que
  // probarse: lo que se hace es fabricar el escenario con la preferencia del propio usuario, que es
  // exactamente lo que hoy puede provocar que un desplegable se parta. Bajar MIN_AJUSTES para que la
  // prueba siguiera valiendo habría sido cambiar el producto para que el gate no se queje.
  await page.evaluate(async () => {
    await api('PUT', '/api/erp/menu/orden', { entradas: { compras: {
      diario: ['supplier-invoices', 'purchases', 'purchase-orders', 'pagos'],
      ajustes: ['suppliers', 'supplier-returns', 'purchases-capture'],
    } } });
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => { document.querySelector('.sidebar').classList.add('flyopen'); });
  await dormir(250);
  await page.evaluate(() => {
    const g = [...document.querySelectorAll('#sbNav > .navg')].find(x => x.querySelector('.nav-label').textContent.trim() === 'Compras y gastos');
    window.openFly(g);
  });
  await dormir(300);
  const mParte = await leerMenu(page);
  const aCompras = mParte.areas.find(a => a.area === 'Compras y gastos');
  ok(aCompras && aCompras.rotulo === 'Ajustes de Compras y gastos',
     'con 3 entradas de ajuste el desplegable SÍ se parte: el umbral sigue vivo', aCompras && aCompras.rotulo);
  const fabricaCompras = mParte.ordenEntradas['Compras y gastos'];
  const rC = await cajaDe('.flyout.open .fly-item[data-ord="pagos"]');
  const dt = await page.mouse.drag({ x: rC.x + 30, y: rC.y + rC.height / 2 }, { x: rC.x + 30, y: rC.y + rC.height / 2 + 15 });
  const rG = await cajaDe('.flyout.open .fly-grp[data-drop="ajustes"]');
  ok(!!rG, 'el área que SÍ se parte tiene su línea «Ajustes de …» como destino de soltado');
  await page.mouse.dragEnter({ x: rG.x + 30, y: rG.y + 2 }, dt);
  await page.mouse.dragOver({ x: rG.x + 30, y: rG.y + 2 }, dt);
  await page.mouse.drop({ x: rG.x + 30, y: rG.y + 2 }, dt);
  await page.mouse.up();
  await dormir(700);
  m = await leerMenu(page);
  ok(m.ordenEntradas['Compras y gastos'].includes('pagos:ajustes'),
     'soltar una entrada sobre la línea la pasa al bloque de AJUSTES', m.ordenEntradas['Compras y gastos'].join(' '));
  ok(m.ordenEntradas['Compras y gastos'].length === fabricaCompras.length,
     'cruzar la línea NO la pierde: sigue estando, en el otro bloque', m.ordenEntradas['Compras y gastos'].length + '');
  await page.setDragInterception(false);

  // ── EL ORDEN GUARDADO ENVEJECE: lo que no está en la lista va DETRÁS, no desaparece ────────────
  // Es la regla que hace que un menú personalizado en agosto siga enseñando la función que se
  // construya en septiembre. Se simula guardando un orden con UNA sola entrada listada.
  await page.evaluate(async () => { await api('PUT', '/api/erp/menu/orden', { entradas: { ventas: { diario: ['cobros'], ajustes: [] } } }); });
  await page.reload({ waitUntil: 'networkidle0' });
  m = await leerMenu(page);
  const v = m.ordenEntradas['Ventas'];
  ok(v[0] === 'cobros:diario' && v.length === fabricaVentas.length,
     'un orden guardado INCOMPLETO no amputa: lo listado va delante y el resto detrás, en orden de fábrica',
     v.join(' '));

  // ── Persiste al recargar, y sobrevive a cerrar sesión ─────────────────────────────────────────
  await page.evaluate(async () => { await api('PUT', '/api/erp/menu/orden', { areas: ['analitica', 'disa', 'ventas', 'clientes', 'proyectos', 'agenda', 'compras', 'contabilidad', 'inventario', 'catalogo'] }); });
  await page.click('#acctBtn'); await dormir(120);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.acct-menu a[href="/admin/logout"]')]);
  await page.type('#email', email); await page.type('#password', PASS);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type="submit"]')]);
  m = await leerMenu(page);
  ok(m.ordenAreas[0] === 'area:analitica', 'el orden sobrevive a cerrar sesión y volver', m.ordenAreas.join(' '));

  // ── RESTABLECER: el menú vuelve a ser EXACTAMENTE el de fábrica ───────────────────────────────
  await page.evaluate(async () => { await api('DELETE', '/api/erp/menu/orden', {}); });
  await page.reload({ waitUntil: 'networkidle0' });
  m = await leerMenu(page);
  ok(JSON.stringify(m.ordenAreas) === JSON.stringify(fabricaAreas), 'restablecer devuelve el orden de las áreas', m.ordenAreas.join(' '));
  ok(JSON.stringify(m.ordenEntradas['Ventas']) === JSON.stringify(fabricaVentas), 'y el de las entradas, con sus bloques');
  ok(!menu.reset || !m.reset, 'y el botón de restablecer desaparece: no queda nada personalizado');
  ok(db.prepare("SELECT COUNT(*) n FROM dashboard_layouts WHERE scope LIKE 'menu:usuario:%'").get().n === 0,
     'sin fila en la tabla: la ausencia de fila ES el menú de fábrica');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] SEGUNDO USUARIO CON MENOS PERMISOS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // OJO: tiene que tener ALGÚN permiso. Con cero, el filtro del menú se salta entero (hallazgo
  // conocido y anotado del PASO 0: `hasCustomPerms`), y la prueba no demostraría nada.
  const emailEmp = 'gate-menu-emp-' + RID + '@bamburu.test';
  const empId = db.prepare(
    "INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES ('Empleada Gate',?,?,'employee',1,0,datetime('now'))"
  ).run(emailEmp, db.prepare("SELECT password_hash h FROM admin_users WHERE role='owner'").get().h).lastInsertRowid;
  const permId = (mod, acc) => db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, acc)?.id;
  for (const [mod, acc] of [['citas', 'read'], ['clients', 'read']]) {
    const pid = permId(mod, acc);
    if (pid) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(empId, pid);
  }
  const nPerms = db.prepare('SELECT COUNT(*) n FROM user_permissions WHERE admin_user_id=?').get(empId).n;
  ok(nPerms === 2, 'la empleada tiene permisos PROPIOS (citas.read + clients.read), no cero');

  // CONTEXTO AISLADO, y no es un detalle: las pestañas de un mismo navegador COMPARTEN el tarro de
  // cookies, así que meter la sesión de la empleada en una segunda pestaña convierte también al dueño
  // en empleada. La primera pasada de este gate dio dos rojos por eso y NO eran del producto.
  const ctxEmp = await browser.createBrowserContext();
  const pEmp = await ctxEmp.newPage();
  const errsEmp = [];
  pEmp.on('pageerror', e => errsEmp.push(String(e && e.message || e)));
  await pEmp.setViewport({ width: 1400, height: 950 });
  const now = Math.floor(Date.now() / 1000);
  const tokEmp = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tokEmp, empId, now, now + 3600, randomBytes(32).toString('base64url'));
  await pEmp.setCookie({ name: 'asess', value: tokEmp, domain: DOMAIN, path: '/' });
  await pEmp.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  const mEmp = await leerMenu(pEmp);

  // Su menú son las DOS superficies: el rail y su sección de la configuración del negocio.
  await pEmp.goto(BASE + '/admin/settings', { waitUntil: 'networkidle0' });
  const cfgEmp = await leerConfig(pEmp);
  await pEmp.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  const enMenu = new Set();
  for (const a of mEmp.areas) for (const i of a.diario.concat(a.ajustes)) if (i.href) enMenu.add(i.href);
  for (const sec of cfgEmp.secs) for (const i of sec.items) enMenu.add(i.href);
  enMenu.add(mEmp.pin.href); enMenu.add('/docs');
  for (const i of mEmp.cuenta) enMenu.add(i.href);
  const enBuscador = mEmp.destinos.filter(d => d.href).map(d => d.href);
  const colados = enBuscador.filter(h => !enMenu.has(h));
  ok(colados.length === 0, 'el buscador NO enseña ni una puerta que no esté en su menú',
     colados.length ? 'COLADAS: ' + colados.join(' | ') : enBuscador.length + ' destinos, todos en el menú');

  // ── CADA UNA CONSERVA SU PERMISO EXACTO, TAMBIÉN EN EL SITIO NUEVO ────────────────────────────
  // La empleada tiene `citas.read` y nada más de citas. De las seis mudadas le tocan exactamente DOS:
  // «Cuándo abro» y «Cuánto dura cada servicio». NO le toca «Mi equipo» (es `admin.manage_users`), ni
  // «Cómo se piden las citas» ni «Mi página de reservas» (las dos son `citas.edit`). Mudar de sitio no
  // puede aflojarle un candado — que es la mitad del riesgo de una mudanza, y la que no se ve.
  const suyas = (cfgEmp.secs[0] ? cfgEmp.secs[0].items : []).map(i => i.label);
  ok(JSON.stringify(suyas) === JSON.stringify(['Cuándo abro', 'Cuánto dura cada servicio']),
     've SOLO las mudadas cuyo permiso tiene, ni una más', suyas.join(' · ') || '(ninguna)');
  const negadas = ['/admin/users', '/admin/citas/ajustes', '/admin/citas/publica'];
  ok(negadas.every(h => !enMenu.has(h)),
     'sin admin.manage_users ni citas.edit, esas tres no le aparecen en el sitio nuevo',
     negadas.filter(h => enMenu.has(h)).join(' | ') || 'ninguna de las tres');
  ok(negadas.every(h => !enBuscador.includes(h)),
     'y tampoco se las encuentra el buscador: la sección nueva no es una puerta trasera',
     negadas.filter(h => enBuscador.includes(h)).join(' | ') || 'ninguna de las tres');
  // Y por el nombre VIEJO tampoco: un alias no puede colar lo que el permiso niega.
  const busEmp = await pEmp.evaluate(async () => {
    document.getElementById('tbq').value = '';
    const inp = document.getElementById('tbq');
    inp.focus(); inp.value = 'Ajustes de citas';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return [...document.querySelectorAll('#tbres .tb-res-i')].map(a => a.getAttribute('href'));
  });
  ok(!busEmp.includes('/admin/citas/ajustes'),
     'ni buscándola por su nombre viejo: el alias hereda el candado', JSON.stringify(busEmp));

  const totalEmp = mEmp.areas.reduce((n, a) => n + a.diario.length + a.ajustes.length, 0);
  ok(totalEmp < BASE_RAIL.length, 've MENOS entradas que el dueño (el filtro de permisos sigue funcionando)',
     totalEmp + ' de ' + BASE_RAIL.length);
  ok(!enMenu.has('/admin/invoices') && !enMenu.has('/admin/purchases'),
     'sin invoices.read ni purchases.read, no ve Facturas ni Compra directa');
  ok(mEmp.anclas.length === 0, 'sus anclas son SUYAS: no hereda las del dueño');

  // Anclar como empleada y comprobar que no se cruzan con las del dueño.
  await pEmp.evaluate(async () => { await api('PUT', '/api/erp/menu/anclas', { claves: ['citas'] }); });
  await pEmp.reload({ waitUntil: 'networkidle0' });
  const ancEmp = (await leerMenu(pEmp)).anclas.map(a => a.key);
  await page.reload({ waitUntil: 'networkidle0' });
  const ancDue = (await leerMenu(page)).anclas.map(a => a.key);
  ok(JSON.stringify(ancEmp) === JSON.stringify(['citas']) && ancDue.length === 0,
     'la preferencia es POR USUARIO: la empleada ancla y el dueño no se entera',
     'empleada ' + JSON.stringify(ancEmp) + ' · dueño ' + JSON.stringify(ancDue));

  // Anclar algo que NO ve → 403 (defensa en profundidad, no abre ninguna puerta).
  await pEmp.evaluate(async () => {
    const r = await fetch('/api/erp/menu/anclas', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.CSRF_TOKEN },
      body: JSON.stringify({ claves: ['invoices'] }) });
    window.__st = r.status;
  });
  ok(await pEmp.evaluate(() => window.__st) === 403, 'no puede anclar una entrada que no está en su menú (403)');

  // Si una entrada anclada deja de estar permitida, el ancla CALLA (no se borra, no da error).
  const pidCitas = permId('citas', 'read');
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=? AND permission_id=?').run(empId, pidCitas);
  await pEmp.reload({ waitUntil: 'networkidle0' });
  const mudo = await leerMenu(pEmp);
  // Una fila de menú guarda TODO lo del usuario: {anclas, areas, entradas}. (El formato viejo era una
  // lista suelta de anclas; se sigue leyendo, por si queda alguna fila de antes.)
  const filaEmp = JSON.parse(db.prepare("SELECT blocks b FROM dashboard_layouts WHERE scope=?").get('menu:usuario:' + empId).b);
  const guardadas = Array.isArray(filaEmp) ? filaEmp : filaEmp.anclas;
  ok(mudo.anclas.length === 0, 'sin permiso, el ancla CALLA: no se pinta');
  ok(errsEmp.length === 0 || !errsEmp.join('').includes('citas'), 'y no da ningún error');
  ok(JSON.stringify(guardadas) === JSON.stringify(['citas']), 'pero la preferencia NO se borra: vuelve sola al devolverle el permiso', JSON.stringify(guardadas));
  db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(empId, pidCitas);
  await pEmp.reload({ waitUntil: 'networkidle0' });
  ok((await leerMenu(pEmp)).anclas.length === 1, 'devuelto el permiso, el ancla vuelve sola');
  // ── [4-bis] LA SECCIÓN NO HEREDA EL CANDADO DE LA PÁGINA QUE LA CONTIENE ──────────────────────
  // CORRECCIÓN DE IBRAHIN sobre el hallazgo de la auditoría, y es el corazón de que la mudanza no
  // cierre puertas: esta empleada tiene `citas.read` y NO tiene `company.read` ni es dueña. Tiene que
  // ENTRAR en la configuración del negocio y ver SU sección — y absolutamente nada más de esa
  // pantalla. Si heredase el candado de la página, la mudanza le habría cerrado dos puertas que hoy
  // abre desde el desplegable de Agenda; si la página se abriera entera, le habría abierto seis.
  console.log('\n[4-bis] citas.read SIN company.read: entra, ve lo suyo y NADA más');
  const permEmpLista = db.prepare(`SELECT p.module || '.' || p.action k FROM user_permissions up
                                     JOIN permissions p ON p.id = up.permission_id
                                    WHERE up.admin_user_id = ?`).all(empId).map(r => r.k);
  ok(!permEmpLista.includes('company.read'), 'la empleada NO tiene company.read (la premisa de la prueba)',
     permEmpLista.join(' · '));

  const res4 = await pEmp.goto(BASE + '/admin/settings', { waitUntil: 'networkidle0' });
  ok(res4.status() === 200, 'ENTRA en la configuración del negocio sin company.read', 'HTTP ' + res4.status());
  const soloSuyo = await leerConfig(pEmp);
  ok(soloSuyo.secs.length === 1 && soloSuyo.secs[0].label === SECCION_CONFIG,
     've la sección de su agenda', soloSuyo.secs.map(x => x.label).join(' · '));
  ok(soloSuyo.secs[0].items.some(i => i.label === 'Cuándo abro'),
     'y dentro, «Cuándo abro»', soloSuyo.secs[0].items.map(i => i.label).join(' · '));
  ok(!soloSuyo.empresa && !soloSuyo.avisos && !soloSuyo.plantillas && !soloSuyo.fiscal,
     'y NO ve ninguna otra parte de la configuración del negocio',
     'empresa=' + soloSuyo.empresa + ' avisos=' + soloSuyo.avisos + ' plantillas=' + soloSuyo.plantillas + ' fiscal=' + soloSuyo.fiscal);

  // PULSA la entrada desde su sitio nuevo: 200 de verdad, no un enlace pintado.
  const [res4b] = await Promise.all([
    pEmp.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    pEmp.click('.cfg-item[href="/admin/citas/horarios"]'),
  ]);
  ok(res4b && res4b.status() === 200 && pEmp.url().endsWith('/admin/citas/horarios'),
     'y al pulsarla responde 200 y llega a su pantalla', pEmp.url() + ' HTTP ' + (res4b ? res4b.status() : 0));

  // Y NO ES SOLO QUE NO SE PINTE: los datos siguen negados. Dejar de pintar un formulario y dejar la
  // API abierta es la forma clásica de que una pantalla «no se vea» y sus datos sí. Se pregunta a las
  // tres puertas de datos de esa pantalla, con SU sesión.
  const apis = await pEmp.evaluate(async () => {
    const out = {};
    for (const u of ['/api/erp/settings/company', '/api/erp/settings/fiscal-profile', '/api/erp/settings/email-templates']) {
      const r = await fetch(u, { headers: { 'Accept': 'application/json' } });
      out[u] = r.status;
    }
    return out;
  });
  const abiertas = Object.entries(apis).filter(([, st]) => st === 200);
  ok(abiertas.length === 0, 'y las APIs de esa pantalla le siguen diciendo que no (no se pinta Y no se sirve)',
     JSON.stringify(apis));

  // Lo que SÍ tiene que poder es llegar: la entrada «Datos del negocio» está en su menú porque tiene
  // contenido propio detrás. Es lo único de esa pantalla que ve, y es lo que hace que no pierda el
  // camino visual a sus seis puertas.
  const veLaEntrada = mEmp.cuenta.some(i => i.href === '/admin/settings');
  ok(veLaEntrada, 've la entrada que la lleva ahí: el camino visual no se ha perdido',
     mEmp.cuenta.map(i => i.label).join(' · '));

  // Se la devuelve al Inicio antes de seguir. NO es cosmético: el gate le retira `citas.read` más
  // abajo y vuelve a cargar la página en la que esté. Si se quedara en «Cuándo abro», esa recarga
  // daría el 403 de `requirePerm`, cuyo HTML llama a `alert()` — y un alert BLOQUEA el render, así
  // que `networkidle0` no llega nunca y el gate muere por timeout fingiendo un fallo del producto.
  await pEmp.goto(BASE + '/admin', { waitUntil: 'networkidle0' });

  ok(errsEmp.length === 0, 'cero errores JS en las pantallas de la empleada', errsEmp.join(' | '));
  await pEmp.close();
  await ctxEmp.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] MÓVIL A 390 px');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.evaluate(async () => { await api('PUT', '/api/erp/menu/anclas', { claves: ['invoices', 'citas'] }); });
  const ctxMob = await browser.createBrowserContext();
  const mob = await ctxMob.newPage();
  const errsMob = [];
  mob.on('pageerror', e => errsMob.push(String(e && e.message || e)));
  await mob.setViewport({ width: 390, height: 780, isMobile: true, hasTouch: true });
  const tokMob = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tokMob, db.prepare("SELECT id FROM admin_users WHERE role='owner'").get().id, now, now + 3600, randomBytes(32).toString('base64url'));
  await mob.setCookie({ name: 'asess', value: tokMob, domain: DOMAIN, path: '/' });
  await mob.goto(BASE + '/admin', { waitUntil: 'networkidle0' });

  ok(await mob.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).transform !== 'none'), 'el rail arranca escondido (cajón cerrado)');
  await mob.click('.nav-toggle');
  await dormir(350);
  const cajon = await mob.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    const anc = [...document.querySelectorAll('#railAnc .anc')];
    const r = sb.getBoundingClientRect();
    const primera = [...sb.querySelectorAll('.nav-item')][0];
    return {
      abierto: sb.classList.contains('open'), x: r.x, w: r.width,
      anclas: anc.map(a => a.dataset.anc),
      primeraEsAncla: primera && primera.classList.contains('anc'),
      buscador: !!document.querySelector('#tbq'),
    };
  });
  ok(cajon.abierto && cajon.x === 0, 'la hamburguesa abre el cajón');
  ok(JSON.stringify(cajon.anclas) === JSON.stringify(['invoices', 'citas']) && cajon.primeraEsAncla,
     'las ancladas se ven ARRIBA del cajón', JSON.stringify(cajon.anclas));
  // El acordeón: se toca el área y sus dos bloques aparecen dentro, sin salirse ni encoger el cajón.
  const acor = await mob.evaluate(() => {
    const g = [...document.querySelectorAll('.navg')].find(x => x.querySelector('.nav-label')?.textContent.trim() === 'Agenda');
    g.querySelector('.nav-item').click();
    const fly = g.querySelector('.flyout');
    const items = [...fly.querySelectorAll('.fly-item')];
    const anchoCajon = document.querySelector('.sidebar').getBoundingClientRect().width;
    return {
      abierto: fly.classList.contains('open'),
      estatico: getComputedStyle(fly).position === 'static',
      total: items.length,
      rotulo: fly.querySelector('.fly-grp')?.textContent.trim() || null,
      seSalen: items.filter(el => el.getBoundingClientRect().right > anchoCajon + 1).length,
      anchoCajon,
    };
  });
  ok(acor.abierto && acor.estatico, 'el submenú se abre en ACORDEÓN dentro del cajón, no flotando');
  // En móvil Agenda también va de UNA PIEZA con sus dos entradas: el cajón no tiene una regla propia,
  // pinta lo mismo que el rail. (Antes esta línea esperaba 8 entradas y el rótulo «Ajustes de Agenda»,
  // que es justo lo que la mudanza se ha llevado.)
  ok(acor.total === 2 && acor.rotulo === null,
     'Agenda enseña sus 2 entradas y SIN rótulo de ajustes, igual que en escritorio',
     acor.total + ' entradas · rotulo=' + acor.rotulo);
  ok(acor.seSalen === 0, 'y ninguna entrada se sale del cajón', 'cajón de ' + Math.round(acor.anchoCajon) + ' px');
  // El buscador, usable a 390.
  await mob.evaluate(() => { document.querySelector('.nav-backdrop').click(); });
  await dormir(250);
  await mob.click('#tbq');
  await mob.type('#tbq', 'stock', { delay: 25 });
  await dormir(250);
  const mres = await mob.evaluate(() => {
    const p = document.getElementById('tbres');
    const r = p.getBoundingClientRect();
    return { abierto: p.classList.contains('open'), dentro: r.left >= -1 && r.right <= window.innerWidth + 1,
             items: [...p.querySelectorAll('.tb-res-i')].map(a => a.getAttribute('href')) };
  });
  ok(mres.abierto && mres.items.includes('/admin/inventory'), 'el buscador funciona a 390 px', JSON.stringify(mres.items));
  ok(mres.dentro, 'y su panel de resultados no se sale de la pantalla');
  ok(errsMob.length === 0, 'CERO errores de JS en móvil', errsMob.join(' | '));
  await mob.close();
  await ctxMob.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] «' + PUESTOS + '» NACE OCULTA Y APARECE SOLA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // La entrada de los puestos es la única condicional del menú. No se ve en un negocio que no los
  // usa —la peluquera que trabaja sola— y tiene que aparecer en cuanto hay uno, porque el taller con
  // dos elevadores la necesita para no vender un sitio que no tiene. Esconder no es eliminar, y esto
  // es lo que separa una cosa de la otra.
  await page.goto(BASE + '/admin/settings', { waitUntil: 'networkidle0' });
  let cfgAhora = await leerConfig(page);
  ok(!cfgAhora.secs[0].items.some(i => i.href === '/admin/citas/recursos'),
     'en un negocio SIN puestos, «' + PUESTOS + '» NO aparece en la configuración',
     cfgAhora.secs[0].items.map(i => i.label).join(' · '));
  const busSin = await buscar(PUESTOS);
  ok(!busSin.some(x => x.href === '/admin/citas/recursos'),
     'y el buscador tampoco la ofrece: esconderla es esconderla en las dos superficies', JSON.stringify(busSin.map(x => x.label)));

  // Un servicio con el que trabajar. Nace a PRECIO CERO a propósito: así [7] puede demostrar que la
  // página de reservas NO se enciende antes de tiempo.
  await page.goto(BASE + '/admin/citas/servicios', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await api('POST', '/api/erp/citas/servicios', { nombre: 'Corte de gate', precio: 0, tax_band: 'general', duracion_min: 30 });
  });
  await page.reload({ waitUntil: 'networkidle0' });

  // ── LA PUERTA DE ENTRADA: se da de alta DENTRO de «Cuánto dura cada servicio», sin recargar ────
  await page.waitForSelector('#svcBody button.btn-secondary', { timeout: 8000 });
  await page.click('#svcBody button.btn-secondary');
  await page.waitForSelector('#mSvc.open', { timeout: 5000 });
  const antesAlta = await page.evaluate(() => document.querySelectorAll('#svcResources .svcres').length);
  ok(antesAlta === 0, 'el servicio no tiene ningún ' + PUESTOS.toLowerCase() + ' que marcar todavía', antesAlta + '');
  await page.click('#svcAltaBtn');
  await page.type('#svcAltaNombre', 'Silla del gate', { delay: 20 });
  await page.click('#svcAltaOk');
  await page.waitForFunction(() => document.querySelectorAll('#svcResources .svcres').length > 0, { timeout: 8000 });
  const trasAlta = await page.evaluate(() => ({
    casillas: [...document.querySelectorAll('#svcResources .svcres')].map(x => ({ v: x.value, on: x.checked })),
    aviso: document.getElementById('svcAltaAviso').offsetParent !== null,
    avisoTx: document.getElementById('svcAltaAviso').textContent.trim(),
    modalAbierto: document.getElementById('mSvc').classList.contains('open'),
  }));
  ok(trasAlta.casillas.length === 1 && trasAlta.casillas[0].on,
     'se da de alta AHÍ MISMO y la casilla aparece ya marcada, SIN RECARGAR', JSON.stringify(trasAlta.casillas));
  ok(trasAlta.modalAbierto, 'y sin perder lo que el dueño llevaba escrito: el modal sigue abierto');
  ok(trasAlta.aviso && /configuración de tu negocio/i.test(trasAlta.avisoTx),
     'y se le dice que la entrada ya está en la configuración de su negocio', trasAlta.avisoTx);

  // ── Y AHORA SÍ: la entrada existe, con el nombre de su oficio ─────────────────────────────────
  await page.goto(BASE + '/admin/settings', { waitUntil: 'networkidle0' });
  cfgAhora = await leerConfig(page);
  const laDePuestos = cfgAhora.secs[0].items.find(i => i.href === '/admin/citas/recursos');
  ok(!!laDePuestos, 'dado de alta uno, «' + PUESTOS + '» YA aparece en la configuración',
     cfgAhora.secs[0].items.map(i => i.label).join(' · '));
  ok(laDePuestos && laDePuestos.label === PUESTOS,
     'y se llama como manda el oficio, no "Recursos"', laDePuestos && laDePuestos.label);
  ok(cfgAhora.secs[0].items.length === BASE_CONFIG.length + 1,
     'la sección pasa a tener las ' + (BASE_CONFIG.length + 1) + ': el inventario llega a ' + N_TOTAL,
     cfgAhora.secs[0].items.length + '');
  const [resPu] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    page.click('.cfg-item[href="/admin/citas/recursos"]'),
  ]);
  ok(resPu && resPu.status() === 200, 'y se pulsa y responde 200', 'HTTP ' + (resPu ? resPu.status() : 0));
  const busCon = await buscar(PUESTOS);
  ok(busCon.some(x => x.href === '/admin/citas/recursos'),
     'y ahora el buscador SÍ la encuentra, por su nombre de oficio', JSON.stringify(busCon.map(x => x.label)));
  const busViejo = await buscar('Recursos');
  ok(busViejo.some(x => x.href === '/admin/citas/recursos'),
     'y por «Recursos», que es como se llamaba', JSON.stringify(busViejo.map(x => x.label)));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] LA PÁGINA DE RESERVAS SE ENCIENDE SOLA — PERO NO ANTES DE TIEMPO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const pub = () => db.prepare('SELECT cita_pub_activa a, cita_pub_auto au, cita_pub_auto_visto v FROM company_config WHERE id=1').get();
  ok(pub().a === 0, 'en un negocio recién creado la página de reservas está APAGADA', JSON.stringify(pub()));

  // (a) sin horario: el negocio tiene el de fábrica (8:00–21:00, siete días), que NO es suyo.
  db.prepare("DELETE FROM horario_tramos WHERE scope='negocio'").run();
  ok(pub().a === 0, 'con un servicio de alta pero sin horario propio, sigue apagada', JSON.stringify(pub()));

  // Ahora el horario, por la pantalla de verdad. Sigue apagada: el servicio vale 0 €.
  await page.goto(BASE + '/admin/citas/horarios', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await api('POST', '/api/erp/citas/horario', { scope: 'negocio', tramos: [
      { dow: 1, inicio_min: 600, fin_min: 1140 }, { dow: 2, inicio_min: 600, fin_min: 1140 },
    ] });
  });
  ok(pub().a === 0,
     'con horario pero con el servicio a 0 €, SIGUE APAGADA: publicar precios en blanco sería peor que no publicar',
     JSON.stringify(pub()));

  // Y ahora el precio. Esta es la segunda condición, y se pone donde de verdad vive: en el catálogo.
  const svcId = db.prepare("SELECT id FROM products WHERE name='Corte de gate'").get().id;
  await page.goto(BASE + '/admin/products', { waitUntil: 'networkidle0' });
  await page.evaluate(async id => {
    await api('PUT', '/api/erp/products/' + id, {
      name: 'Corte de gate', sku: 'corte-de-gate', price: 18, tax_band: 'general', type: 'service', status: 'active',
    });
  }, svcId);
  const trasPrecio = pub();
  ok(trasPrecio.a === 1 && trasPrecio.au === 1,
     'con horario propio Y un servicio con precio y duración, se ENCIENDE SOLA', JSON.stringify(trasPrecio));
  ok(db.prepare('SELECT publico FROM service_config WHERE product_id=?').get(svcId).publico === 1,
     'y publica el servicio que ya es publicable: encender la puerta sin nada detrás sería encender nada');

  // La página pública responde de verdad, no solo el flag.
  const handle = db.prepare('SELECT cita_pub_handle h, company_name n FROM company_config WHERE id=1').get();
  const slugPub = (handle.h || handle.n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'reservar';
  const rPub = await page.goto(BASE + '/reservar/' + slugPub, { waitUntil: 'domcontentloaded' });
  ok(rPub && rPub.status() === 200, 'y la dirección pública responde 200 de verdad', '/reservar/' + slugPub + ' → HTTP ' + (rPub ? rPub.status() : 0));

  // ── EL AVISO Y SU INTERRUPTOR DE UN CLIC ──────────────────────────────────────────────────────
  await page.goto(BASE + '/admin/avisos', { waitUntil: 'networkidle0' });
  await dormir(600);
  const avi = await page.evaluate(() => {
    const filas = [...document.querySelectorAll('table tbody tr')];
    const f = filas.find(r => /página de reservas/i.test(r.textContent));
    return f ? { texto: f.textContent.replace(/\s+/g, ' ').trim(), apagar: !!f.querySelector('button[onclick*="apagarReservas"]') } : null;
  });
  ok(!!avi, 'al encenderse se AVISA al dueño por los canales que ya hay', avi && avi.texto.slice(0, 120));
  ok(avi && /\/reservar\//.test(avi.texto), 'y el aviso trae el ENLACE y qué se ve', avi && avi.texto.slice(0, 160));
  ok(avi && avi.apagar, 'y un interruptor para apagarla en UN CLIC');

  // Se PULSA el botón de verdad (con el confirm respondido que sí), no se llama al endpoint por
  // debajo: lo que hay que demostrar es que el interruptor funciona desde donde está el dueño.
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => document.querySelector('button[onclick*="apagarReservas"]').click());
  await dormir(800);
  ok(pub().a === 0, 'pulsarlo la APAGA, en un clic', JSON.stringify(pub()));

  // EL PESTILLO: y no se vuelve a encender sola nunca más. Sin esto, el interruptor sería mentira.
  await page.goto(BASE + '/admin/citas/horarios', { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await api('POST', '/api/erp/citas/horario', { scope: 'negocio', tramos: [{ dow: 3, inicio_min: 600, fin_min: 1140 }] });
  });
  ok(pub().a === 0,
     'y NO se vuelve a encender sola al guardar otra vez: el interruptor de apagado no es un adorno',
     JSON.stringify(pub()));
  await page.goto(BASE + '/admin/avisos', { waitUntil: 'networkidle0' });
  await dormir(500);
  const aviTras = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr')].some(r => /página de reservas/i.test(r.textContent)));
  ok(!aviTras, 'y el aviso se calla: era una noticia, no una tarea pendiente que repetir');

  ok(errsGlobal.length === 0, 'cero errores JS en todo el recorrido de escritorio', errsGlobal.join(' | '));

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
