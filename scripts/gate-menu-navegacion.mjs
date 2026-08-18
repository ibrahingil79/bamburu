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
  ['Agenda', 'Agenda', '/admin/citas'],
  ['Agenda', 'Cola de envíos', '/admin/citas/cola'],
  ['Agenda', 'Servicios reservables', '/admin/citas/servicios'],
  ['Agenda', 'Quién atiende', '/admin/users'],
  ['Agenda', '(puesto_plural)', '/admin/citas/recursos'],               // la etiqueta la pone el OFICIO
  ['Agenda', 'Horarios', '/admin/citas/horarios'],
  ['Agenda', 'Ajustes de citas', '/admin/citas/ajustes'],
  ['Agenda', 'Reservas por Internet', '/admin/citas/publica'],
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
  ['Analítica', 'Informes', '/admin/analytics'],
  ['Analítica', 'Vigía (DISA)', '/admin/vigia'],
];
const BASE_FIJAS  = [['Inicio', '/admin'], ['Ayuda y soporte', '/docs']];
const BASE_CUENTA = [['Perfil', '/admin/perfil'], ['Datos del negocio', '/admin/settings'],
                     ['Usuarios', '/admin/users'], ['Actividad', '/admin/activity'],
                     ['Documentación', '/docs'], ['Cerrar sesión', '/admin/logout']];
const N_BASE = BASE_RAIL.length + BASE_FIJAS.length + BASE_CUENTA.length;   // 42 + 2 + 6 = 50

// Qué entradas quedan ABAJO, bajo el rótulo «Ajustes de <Área>». No cambia el inventario: solo dónde
// se pinta cada una dentro del MISMO desplegable.
const AJUSTES_ESPERADOS = {
  'Clientes': ['Grupos'],
  'Agenda': ['Servicios reservables', 'Quién atiende', '(puesto_plural)', 'Horarios', 'Ajustes de citas', 'Reservas por Internet'],
  'Compras y gastos': ['Proveedores'],
  'Inventario': ['Almacenes'],
  'Catálogo': ['Categorías'],
};

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
    pie: { label: txt(nav.querySelector('a[href="/docs"] .nav-label')), href: '/docs' },
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
  console.log('\n[1] LA PRUEBA QUE MANDA — NO AMPUTACIÓN: las ' + N_BASE + ' puertas siguen ahí');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const menu = await leerMenu(page);
  ok(!!menu, 'el rail se renderiza');

  const esperado = BASE_RAIL.map(([a, l, h]) => [a, l === '(puesto_plural)' ? PUESTOS : l, h]);
  const vistoRail = [];
  for (const a of menu.areas) for (const i of a.diario.concat(a.ajustes)) vistoRail.push([a.area, i.label, i.href]);

  ok(vistoRail.length === BASE_RAIL.length,
     'el rail tiene EXACTAMENTE las ' + BASE_RAIL.length + ' entradas del inventario del PASO 0', 'hay ' + vistoRail.length);
  const clave = x => x[0] + ' » ' + x[1] + ' » ' + (x[2] || '(acción)');
  const setVisto = new Set(vistoRail.map(clave));
  const faltan = esperado.filter(e => !setVisto.has(clave(e)));
  const sobran = vistoRail.filter(v => !new Set(esperado.map(clave)).has(clave(v)));
  ok(faltan.length === 0, 'ninguna entrada del inventario ha desaparecido',
     faltan.length ? 'FALTAN: ' + faltan.map(clave).join(' | ') : 'las ' + esperado.length + ', una a una');
  ok(sobran.length === 0, 'no ha aparecido ninguna entrada que no estuviera',
     sobran.length ? 'SOBRAN: ' + sobran.map(clave).join(' | ') : 'ninguna de más');

  ok(menu.pin.label === 'Inicio' && menu.pin.href === '/admin', 'sigue el pin de Inicio arriba del rail');
  ok(menu.pie.label === 'Ayuda y soporte', 'sigue Ayuda y soporte al pie del rail');
  const cuentaVista = menu.cuenta.map(i => i.label + ' » ' + i.href);
  const cuentaEsp = BASE_CUENTA.map(([l, h]) => l + ' » ' + h);
  ok(cuentaEsp.every(x => cuentaVista.includes(x)) && cuentaVista.length === cuentaEsp.length,
     'el menú de cuenta conserva sus ' + cuentaEsp.length + ' entradas', cuentaVista.join(' · '));
  const N_VISTO = vistoRail.length + 2 + menu.cuenta.length;
  ok(N_VISTO === N_BASE, 'N ANTES = N DESPUÉS', N_BASE + ' puertas antes · ' + N_VISTO + ' ahora');

  // ── Separadas en dos bloques, pero SIN plegar: todas visibles en el mismo desplegable ──────────
  for (const a of menu.areas) {
    const esp = (AJUSTES_ESPERADOS[a.area] || []).map(l => (l === '(puesto_plural)' ? PUESTOS : l));
    const vis = a.ajustes.map(i => i.label);
    ok(JSON.stringify(vis) === JSON.stringify(esp),
       'área "' + a.area + '": el bloque de ajustes es el esperado', vis.length ? vis.join(', ') : '(ninguno)');
    if (esp.length) ok(a.rotulo === 'Ajustes de ' + a.area, 'área "' + a.area + '": el rótulo lo dice con su nombre', a.rotulo);
  }
  ok(menu.areasConPin === menu.areas.length,
     'CADA ÁREA del rail tiene su chincheta: se ancla cualquier entrada del menú, áreas incluidas',
     menu.areasConPin + ' de ' + menu.areas.length);
  ok(menu.areasArrastrables === menu.areas.length,
     'y CADA ÁREA se puede arrastrar para moverla de orden', menu.areasArrastrables + ' de ' + menu.areas.length);
  ok(menu.entradasArrastrables === BASE_RAIL.length,
     'y las ' + BASE_RAIL.length + ' entradas de los desplegables también', menu.entradasArrastrables + '');
  ok(!menu.reset, 'de fábrica NO hay botón de restablecer: no hay nada que restablecer');

  const nadaPlegado = await page.evaluate(() => {
    // Todas las entradas del área de Agenda tienen que estar en el MISMO desplegable y a la vez.
    const g = [...document.querySelectorAll('.navg')].find(x => x.querySelector('.nav-label')?.textContent.trim() === 'Agenda');
    window.openFly(g);
    const items = [...g.querySelectorAll('.flyout .fly-item')];
    return { total: items.length, visibles: items.filter(el => el.offsetParent !== null).length };
  });
  await dormir(150);
  ok(nadaPlegado.total === 8 && nadaPlegado.visibles === 8,
     'Agenda: sus 8 entradas se ven A LA VEZ al abrir el desplegable (separar, no plegar)',
     nadaPlegado.visibles + '/' + nadaPlegado.total + ' visibles');

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
  ok(rotos.length === 0, 'las ' + pulsables.length + ' entradas con pantalla se PULSAN y responden 200',
     rotos.length ? 'ROTAS: ' + rotos.join(' | ') : 'todas');

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
    return { abierto: fly.classList.contains('open'),
             primera: fly.querySelector('.fly-item .fly-tx')?.textContent.trim(),
             rotulo: fly.querySelector('.fly-grp')?.textContent.trim() };
  });
  await dormir(150);
  ok(flyAncla.abierto && flyAncla.primera === 'Facturas recibidas' && flyAncla.rotulo === 'Ajustes de Compras y gastos',
     'el área anclada abre el MISMO desplegable, con sus dos bloques', JSON.stringify(flyAncla));

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

  // ── CRUZAR LA LÍNEA: una entrada pasa al bloque de ajustes (y su rótulo aparece al arrastrar) ──
  await page.evaluate(() => {
    const g = [...document.querySelectorAll('#sbNav > .navg')].find(x => x.querySelector('.nav-label').textContent.trim() === 'Ventas');
    window.openFly(g);
  });
  await dormir(300);
  const rP = await cajaDe('.flyout.open .fly-item[data-ord="albaranes"]');
  const dt = await page.mouse.drag({ x: rP.x + 30, y: rP.y + rP.height / 2 }, { x: rP.x + 30, y: rP.y + rP.height / 2 + 15 });
  const rG = await cajaDe('.flyout.open .fly-grp[data-drop="ajustes"]');
  ok(!!rG, 'la línea «Ajustes de …» de un área sin ajustes APARECE al arrastrar (si no, sería un viaje sin vuelta)');
  await page.mouse.dragEnter({ x: rG.x + 30, y: rG.y + 2 }, dt);
  await page.mouse.dragOver({ x: rG.x + 30, y: rG.y + 2 }, dt);
  await page.mouse.drop({ x: rG.x + 30, y: rG.y + 2 }, dt);
  await page.mouse.up();
  await dormir(700);
  m = await leerMenu(page);
  ok(m.ordenEntradas['Ventas'].includes('albaranes:ajustes'),
     'soltar una entrada sobre la línea la pasa al bloque de AJUSTES', m.ordenEntradas['Ventas'].join(' '));
  ok(m.ordenEntradas['Ventas'].length === fabricaVentas.length,
     'cruzar la línea NO la pierde: sigue estando, en el otro bloque', m.ordenEntradas['Ventas'].length + '');
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

  const enMenu = new Set();
  for (const a of mEmp.areas) for (const i of a.diario.concat(a.ajustes)) if (i.href) enMenu.add(i.href);
  enMenu.add(mEmp.pin.href); enMenu.add('/docs');
  for (const i of mEmp.cuenta) enMenu.add(i.href);
  const enBuscador = mEmp.destinos.filter(d => d.href).map(d => d.href);
  const colados = enBuscador.filter(h => !enMenu.has(h));
  ok(colados.length === 0, 'el buscador NO enseña ni una puerta que no esté en su menú',
     colados.length ? 'COLADAS: ' + colados.join(' | ') : enBuscador.length + ' destinos, todos en el menú');
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
  ok(acor.total === 8 && acor.rotulo === 'Ajustes de Agenda', 'con sus 8 entradas y su rótulo de ajustes', acor.rotulo);
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
