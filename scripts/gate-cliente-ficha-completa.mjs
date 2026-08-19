// ════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — FICHA DE CLIENTE COMPLETA: ventana + tarjetas + registro de contactos + los dos márgenes.
// Tarea TRANSVERSAL: el puntero de la escalera NO se mueve.
//
// LO QUE ESTE GATE EXISTE PARA IMPEDIR es que vuelva el fallo de origen: un porcentaje correcto que
// engaña porque su denominador no está en pantalla. El caso real fue 36,3 % de margen sobre un
// cliente con 4.018 € de venta y 1.577 € de coste — ninguna cuenta con esos dos números da 36,3,
// porque el divisor era un tercero (2.475 €) que no se enseñaba en ninguna parte.
//
// Por eso casi todas las comprobaciones de margen de aquí abajo son de la forma "el número Y ADEMÁS
// su base", no "el número existe". Y por eso el criterio 12 barre pantallas enteras buscando un %
// de margen huérfano: si aparece uno, el gate cae aunque el cálculo sea perfecto.
//
//   node scripts/gate-cliente-ficha-completa.mjs
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
import { margen as margenMotor, modoDeEmpresa, setModoDeEmpresa, MODO_POR_DEFECTO } from '../modules/erp/margen.js';
import { clientesFueraDeRitmo, RITMO_MIN_CITAS } from '../modules/erp/vigia-agenda.js';
import { ritmoDelCliente, contadoresDe, cabecera360 as cabecera360Gate,
  chipsForzados as chipsForzadosGate, encenderChip } from '../modules/erp/cliente-360.js';
import { apuntarContacto, contactoDeCorreo, ultimoContacto, diasDeVisita } from '../modules/erp/contactos.js';
import { margenResumen, ventasResumen, countingSalesInvoices } from '../modules/erp/ventas-metrics.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';
import { cuentaPyG } from '../modules/erp/contabilidad-pyg.js';
import { clientDebt } from '../modules/erp/cobros.js';
import { rentabilidadProyecto } from '../modules/erp/rentabilidad.js';

const RID = randomBytes(3).toString('hex');
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dormir = ms => new Promise(r => setTimeout(r, ms));
const HOY = new Date().toISOString().slice(0, 10);
const dias = n => new Date(Date.parse(HOY + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { if (c) { pass++; console.log('  ✓ ' + m + (x ? ' — ' + x : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (x ? ' — ' + x : '')); } };
let slug = null, db = null, browser = null;
function limpiar() {
  try { if (db) db.close(); } catch {}
  if (!slug) return;
  const t = getTenantBySlug(slug);
  if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) { const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} } }
}

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] DE CERO — negocio, catálogo con coste conocido, y un cliente con historia');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const alta = await provisionTenant({ businessName: 'Gate Margen ' + RID, ownerName: 'Dueña Gate',
    email: 'gatemg-' + RID + '@bamburu.test', password: 'Gate.Mg.' + RID + '!', phone: '+34 600 000 000' });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  ok(!!t, 'negocio creado desde cero', slug);
  db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename));
  const BASE = 'http://' + slug + '.localhost:3000';
  fijarOficio(db, 'peluqueria');
  sembrarCatalogo(db, 'peluqueria', (d, i) => createProductSvc(d, i));
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();
  db.prepare("UPDATE company_config SET fiscal_id='B00000000' WHERE id=1").run();

  // DOS productos: uno con coste conocido y otro sin él. Es la pareja que hace que el margen tenga
  // una parte juzgable y otra que queda fuera — que es justo lo que el % no decía.
  // Con stock de sobra: si no, la factura se rechaza por exceso y el gate se queda sin historia.
  const nuevoProd = (nombre, sku) => createProductSvc(db, { name: nombre, sku, price: 200,
    tax_band: 'general', type: 'physical', tracking: 'none', status: 'active', stock: 100 });
  const conCoste = nuevoProd('Tinte con material ' + RID, 'MG-C-' + RID);
  // El coste de la línea sale del WAC del producto (`snapshotCoste`). Con WAC a 0 la línea queda
  // SIN coste conocido — que no es coste cero, y es justo la mitad de la historia que interesa.
  db.prepare('UPDATE products SET average_cost=? WHERE id=?').run(140, conCoste.id);
  const sinCoste = nuevoProd('Corte a mano ' + RID, 'MG-S-' + RID);
  db.prepare('UPDATE products SET average_cost=0 WHERE id=?').run(sinCoste.id);

  const CLI = db.prepare("INSERT INTO clients (name,email,active,created_at) VALUES (?,?,1,datetime('now'))")
    .run('Marta Rovira', 'marta-' + RID + '@bamburu.test').lastInsertRowid;
  // Un cliente con nombre larguísimo, del tipo que teclea una persona de verdad en una empresa.
  // Sirve para que la medida de "no se sale" tenga algo que medir en la cabecera de la ventana.
  const LARGO = db.prepare("INSERT INTO clients (name,active,created_at) VALUES (?,1,datetime('now'))")
    .run('Construcciones y Reformas Integrales del Levante Mediterráneo Sociedad Limitada Unipersonal').lastInsertRowid;
  const LIMPIO = db.prepare("INSERT INTO clients (name,active,created_at) VALUES ('Nadie Nuevo',1,datetime('now'))").run().lastInsertRowid;

  const now = Math.floor(Date.now() / 1000);
  const sesion = uid => { const tok = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
      .run(tok, uid, now, now + 3600, randomBytes(32).toString('base64url')); return tok; };

  browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({ name: 'asess', value: sesion(owner.id), domain: slug + '.localhost', path: '/' });
  const api = (m, u, b) => page.evaluate(async (m, u, b) => {
    try { return await window.api(m, u, b); } catch (e) { return { __err: e.message }; }
  }, m, u, b);
  const cabeceraDe = (id) => cabecera360Gate(db, db.prepare('SELECT * FROM clients WHERE id=?').get(id), () => true);
  const irLista = async (qs = '') => { await page.goto(BASE + '/admin/clients' + qs, { waitUntil: 'networkidle0' }); await dormir(500); };
  const irFicha = async (id) => { await page.goto(BASE + '/admin/clients/' + id, { waitUntil: 'networkidle0' }); await dormir(1000); };
  const abrirVentana = async (id) => { await page.evaluate(i => window.viewDetail(i), id); await dormir(1400); };

  await irLista();
  // SEIS facturas VENCIDAS del producto con coste + DOS del que no lo tiene. Los seis vencidos son
  // el material del criterio 6 (una recomendación agrupada, no seis líneas).
  const fac = (pid, fecha) => api('POST', '/api/erp/invoices', {
    client_id: CLI, issue_date: fecha, due_date: fecha,
    lines: [{ description: 'Servicio', quantity: 1, unit_price: 200, tax_rate: 21, product_id: pid }] });
  const errFac = [];
  for (let i = 0; i < 6; i++) { const r = await fac(conCoste.id, dias(-200 + i * 10)); if (r.__err) errFac.push(r.__err); }
  for (let i = 0; i < 2; i++) { const r = await fac(sinCoste.id, dias(-100 + i * 10)); if (r.__err) errFac.push(r.__err); }
  if (errFac.length) console.error('    (facturas rechazadas: ' + [...new Set(errFac)].join(' | ') + ')');
  const nFac = db.prepare('SELECT COUNT(*) n FROM invoices WHERE client_id=?').get(CLI).n;
  ok(nFac === 8, 'ocho facturas: seis con coste conocido y dos sin él', nFac + '');

  const lineas = db.prepare('SELECT it.unit_cost c, it.total_price b FROM invoice_items it JOIN invoices i ON i.id=it.invoice_id WHERE i.client_id=?').all(CLI);
  const VENTA = r2(lineas.filter(l => l.c != null).reduce((x, l) => x + l.b, 0));
  const COSTE = r2(lineas.filter(l => l.c != null).reduce((x, l) => x + l.c, 0));
  const FUERA = r2(lineas.filter(l => l.c == null).reduce((x, l) => x + l.b, 0));
  ok(VENTA === 1200 && COSTE === 840 && FUERA === 400,
     'la historia queda: 1.200 € con coste (840 € de coste) y 400 € sin coste', VENTA + ' / ' + COSTE + ' / ' + FUERA);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA VENTANA TIENE DIRECCIÓN PROPIA, Y ATRÁS DEVUELVE A LA LISTA COMO ESTABA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const QS = '?q=Marta&page=1';
  await irLista(QS);
  const urlLista = await page.evaluate(() => location.pathname + location.search);
  await abrirVentana(CLI);
  const urlVentana = await page.evaluate(() => location.pathname);
  ok(urlVentana === '/admin/clients/' + CLI, 'abrir un cliente CAMBIA la dirección del navegador', urlVentana);
  ok(await page.evaluate(() => document.querySelectorAll('.bf-win-overlay.open').length) === 1,
     'y hay exactamente UNA ventana abierta');

  // Copiar esa dirección y recargarla tiene que dar la FICHA COMPLETA (una página de verdad, no un
  // modal que no existe hasta que alguien hace clic).
  await page.goto(BASE + urlVentana, { waitUntil: 'networkidle0' }); await dormir(1000);
  const esPagina = await page.evaluate(() => ({
    sinVentana: !document.querySelector('.bf-win-overlay.open'),
    hayResumen: !!document.getElementById('f360resumen'),
    hayHistoria: !!document.querySelector('[id$="_hist"]'),
  }));
  ok(esPagina.sinVentana && esPagina.hayResumen && esPagina.hayHistoria,
     'copiar esa dirección y recargarla abre la FICHA COMPLETA a página entera', JSON.stringify(esPagina));

  await irLista(QS);
  await abrirVentana(CLI);
  await page.goBack({ waitUntil: 'domcontentloaded' }); await dormir(900);
  const trasAtras = await page.evaluate(() => ({
    abiertas: document.querySelectorAll('.bf-win-overlay.open').length,
    url: location.pathname + location.search,
  }));
  ok(trasAtras.abiertas === 0, 'el botón atrás CIERRA la ventana');
  ok(trasAtras.url === urlLista, 'y devuelve a la lista conservando filtro y página', trasAtras.url);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] LAS OCHO TARJETAS ABREN SU DETALLE, Y NUNCA HAY DOS VENTANAS APILADAS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await irLista(QS);
  await abrirVentana(CLI);
  // C1 — el orden manda lo urgente. Se comprueba el ORDEN, no solo que estén: una tarjeta de deuda
  // la novena es una tarjeta que nadie mira.
  const CLAVES = ['deuda', 'margen', 'gasto', 'periodo', 'ticket', 'ultima', 'contacto', 'ritmo'];
  const pintadas = await page.evaluate(() => [...document.querySelectorAll('.bf-card')].map(c => c.getAttribute('data-tarjeta')));
  ok(JSON.stringify(pintadas) === JSON.stringify(CLAVES),
     'las ocho tarjetas están, EN EL ORDEN de urgencia, y todas son pulsables', pintadas.join(' → '));
  ok(!pintadas.includes('desde'), '«Cliente desde» ya NO es una tarjeta: no pide ninguna acción');
  const cabTxt = await page.evaluate(() => document.querySelector('.bf-win-head .sub').textContent);
  ok(/cliente desde \d{4}-\d{2}-\d{2}|no te ha comprado/i.test(cabTxt),
     'pero sigue estando, en los datos del cliente junto al NIF y el teléfono', cabTxt);

  // ── CRITERIO 2 · «VER FICHA COMPLETA» ABRE EN LA VENTANA, NO EN OTRA PÁGINA ───────────────────
  // Antes te sacaba de la ventana: se perdía el sitio, el filtro y la lista, y volver era un viaje.
  await page.evaluate(() => document.getElementById('bfFull').click());
  await dormir(2400);
  const vf = await page.evaluate(() => ({
    overlays: document.querySelectorAll('.bf-win-overlay.open').length,
    dentro: !!document.querySelector('#bfBody .bf-full'),
    historia: !!document.querySelector('#bfBody [id$="_hist"]'),
    notas: !!document.querySelector('#bfBody [id$="_notas"]'),
    facturas: document.querySelectorAll('#bfBody [id$="_fac"] tbody tr').length,
    atras: document.getElementById('bfAtras').style.display !== 'none',
    url: location.pathname,
  }));
  ok(vf.overlays === 1 && vf.dentro,
     '«Ver ficha completa» abre DENTRO de la ventana, no en otra página', vf.overlays + ' ventana(s)');
  ok(vf.url === '/admin/clients/' + CLI, 'sin salir de la dirección del cliente', vf.url);
  ok(vf.historia && vf.notas && vf.facturas >= 8,
     'y trae TODO: su historia, sus notas y la tabla larga de facturas (criterio 22)',
     vf.facturas + ' filas de factura');
  ok(vf.atras, 'con su flecha para volver al resumen');
  await page.evaluate(() => document.getElementById('bfAtras').click());
  await dormir(900);
  ok(await page.evaluate(() => document.querySelectorAll('.bf-card').length) === 8, 'y vuelve al resumen');
  let capasOk = 0, apiladas = 0, volvioOk = 0;
  for (const k of CLAVES) {
    await page.evaluate(k => document.querySelector('.bf-card[data-tarjeta="' + k + '"]').click(), k);
    await dormir(1100);
    const v = await page.evaluate(() => ({
      atras: document.getElementById('bfAtras').style.display !== 'none',
      overlays: document.querySelectorAll('.bf-win-overlay.open').length,
      cuerpo: document.getElementById('bfBody').textContent.trim().length,
    }));
    if (v.atras && v.cuerpo > 20) capasOk++;
    if (v.overlays !== 1) apiladas++;
    await page.evaluate(() => document.getElementById('bfAtras').click());
    await dormir(700);
    const r = await page.evaluate(() => document.querySelectorAll('.bf-card').length);
    if (r === 8) volvioOk++;
  }
  ok(capasOk === 8, 'las ocho abren su detalle DENTRO de la ventana, con flecha de volver', capasOk + '/8');
  ok(apiladas === 0, 'y en ningún momento hay dos ventanas apiladas');
  ok(volvioOk === 8, 'la flecha devuelve al resumen desde las ocho', volvioOk + '/8');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] «TE DEBE» ABRE LA GESTIÓN DE COBRO, Y DESDE AHÍ SE COBRA DE VERDAD');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const deudaAntes = clientDebt(db, CLI, HOY).total;
  await page.evaluate(() => document.querySelector('.bf-card[data-tarjeta="deuda"]').click());
  await dormir(1500);
  const gestion = await page.evaluate(() => ({
    cobrar: document.querySelectorAll('#bfBody [data-cobro]').length,
    cuenta: document.querySelectorAll('#bfBody [data-cuenta]').length,
  }));
  ok(gestion.cobrar >= 6 && gestion.cuenta === 1,
     'la capa de «Te debe» trae «Registrar cobro» por factura y «Gestionar cuenta»',
     gestion.cobrar + ' cobros · ' + gestion.cuenta + ' cuenta');
  const idFac = db.prepare('SELECT id FROM invoices WHERE client_id=? ORDER BY id LIMIT 1').get(CLI).id;
  const cobro = await api('POST', '/api/erp/invoices/' + idFac + '/payments', { amount: 50, payment_method: 'efectivo' });
  ok(!cobro.__err, 'y desde ahí se registra un cobro real', cobro.__err || 'cobrado 50 €');
  const deudaDespues = clientDebt(db, CLI, HOY).total;
  ok(r2(deudaAntes - deudaDespues) === 50, 'la deuda baja exactamente lo cobrado',
     deudaAntes + ' → ' + deudaDespues);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4-5] NI UN TEXTO SE SALE DE SU TARJETA, Y LA FILA MIDE IGUAL — A CUATRO ANCHOS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // MIDIENDO EL ELEMENTO, no mirando una captura: scrollWidth contra clientWidth (¿cabe el texto?)
  // y el borde derecho contra el del padre (¿se sale la caja?). Un texto largo tiene que quedar
  // recortado con puntos suspensivos, no desbordado ni obligando a la página a hacer scroll.
  //
  // Y SE MIDE ADEMÁS EL MECANISMO, no solo el resultado. Medir solo el resultado dejaba un agujero
  // real: con textos cortos las tarjetas caben aunque se le quite el recorte al componente, así que
  // el gate daba verde sobre un componente ya roto — y el primer nombre largo de un cliente real lo
  // habría destapado en producción, no aquí. Se comprueba que las tres líneas siguen siendo
  // nowrap + ellipsis + overflow:hidden, y que el valor entero sigue estando en `title` para que se
  // pueda leer al pasar por encima.
  const medir = async (w, donde) => {
    await page.setViewport({ width: w, height: 1000 });
    if (donde === 'ventana') { await irLista(QS); await abrirVentana(CLI); }
    else { await irFicha(CLI); }
    // Se ABREN los desplegables: «Ver los N documentos» de DISA es contenido que el usuario ve de
    // verdad, y medir solo con todo cerrado dejaría sin mirar justo el trozo que más crece.
    await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
    await dormir(700);
    return page.evaluate(() => {
      const AIRE = 6;                       // mínimo de aire entre el texto y el borde de su caja
      const sale = [], pegado = [], filas = {}, sinRecorte = [], sinTitulo = [];
      const raiz = document.querySelector('.bf-win-overlay.open') || document.body;
      // Las CAJAS son las que dibujan un marco alrededor del contenido. Una fila con solo un borde
      // inferior (un separador) NO es una caja: su texto no tiene que respetarle los lados. Sin esta
      // distinción la medida acusaba a 19 sitios que estaban perfectamente.
      const CAJAS = '.bf-card, .bf-caja, .bf-win, .card, .bf-nota, .bf-rec, .alert';
      const enScroller = el => { let n = el; while (n && n !== raiz) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; n = n.parentElement; } return false; };
      for (const caja of raiz.querySelectorAll(CAJAS)) {
        if (caja.querySelector(CAJAS)) continue;         // solo la caja MÁS INTERNA
        const rc = caja.getBoundingClientRect();
        if (!rc.width) continue;
        for (const el of caja.querySelectorAll('*')) {
          if (el.children.length) continue;
          const txt = (el.textContent || '').trim(); if (!txt) continue;
          // SOLO LO QUE SE VE. Chrome deja rectángulos vivos dentro de un <details> CERRADO
          // (content-visibility), y medir a ciegas acusaba de desbordar a texto que nadie ve.
          if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) continue;
          if (el.closest('details:not([open])')) continue;
          if (enScroller(el)) continue;                  // lo que scrollea, scrollea: no se sale
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
          const cls = (el.className || el.tagName).toString().slice(0, 22) + ' en ' + (caja.className || caja.tagName).toString().slice(0, 22);
          if (r.right > rc.right + 0.5 || r.left < rc.left - 0.5 || r.bottom > rc.bottom + 0.5) { sale.push({ t: txt.slice(0, 28), cls }); continue; }
          const holgura = Math.min(r.left - rc.left, rc.right - r.right, r.top - rc.top, rc.bottom - r.bottom);
          if (holgura < AIRE) pegado.push({ t: txt.slice(0, 28), cls, holgura: Math.round(holgura) });
        }
      }
      // Y EL MECANISMO, no solo el resultado: con textos cortos, quitarle el recorte al componente no
      // se nota — así di verde sobre un componente ya roto la vez anterior.
      for (const c of document.querySelectorAll('.bf-card')) {
        const rc = c.getBoundingClientRect();
        (filas[Math.round(rc.top)] = filas[Math.round(rc.top)] || []).push(Math.round(rc.height));
        for (const el of c.querySelectorAll('span')) {
          const st = getComputedStyle(el);
          if (st.whiteSpace !== 'nowrap' || st.textOverflow !== 'ellipsis' || st.overflow === 'visible')
            sinRecorte.push({ t: el.textContent.slice(0, 22), ws: st.whiteSpace, to: st.textOverflow, ov: st.overflow });
          if (!el.getAttribute('title')) sinTitulo.push(el.textContent.slice(0, 22));
        }
      }
      const desiguales = Object.entries(filas).filter(([, hs]) => new Set(hs).size > 1);
      return { sale, pegado, desiguales, sinRecorte, sinTitulo,
               tarjetas: document.querySelectorAll('.bf-card').length,
               scrollH: document.documentElement.scrollWidth > window.innerWidth };
    });
  };
  for (const w of [390, 768, 1024, 1440]) {
    for (const donde of ['ventana', 'pagina']) {
      const m = await medir(w, donde);
      ok(m.sale.length === 0, 'a ' + w + ' px (' + donde + '): ningún texto se sale de su caja',
         m.sale.length ? JSON.stringify(m.sale.slice(0, 3)) : 'medido en todas las cajas');
      ok(m.pegado.length === 0, 'a ' + w + ' px (' + donde + '): ni toca el borde (6 px de aire mínimo)',
         m.pegado.length ? JSON.stringify(m.pegado.slice(0, 3)) : 'aire suficiente en todas');
      ok(m.tarjetas === 8 && m.sinRecorte.length === 0,
         'a ' + w + ' px (' + donde + '): las tarjetas siguen recortando con puntos suspensivos',
         m.sinRecorte.length ? JSON.stringify(m.sinRecorte.slice(0, 2)) : m.tarjetas + ' tarjetas · 24 líneas');
      ok(m.sinTitulo.length === 0, 'a ' + w + ' px (' + donde + '): y el valor completo sigue al pasar por encima',
         m.sinTitulo.length ? m.sinTitulo.join(' | ') : 'title en todas');
      ok(m.desiguales.length === 0, 'a ' + w + ' px (' + donde + '): todas las de una fila miden lo mismo',
         m.desiguales.length ? JSON.stringify(m.desiguales) : 'filas uniformes');
      ok(!m.scrollH, 'a ' + w + ' px (' + donde + '): la página no hace scroll horizontal');
    }
  }
  await page.setViewport({ width: 1440, height: 1000 });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6-7] CADA TARJETA ABRE LO QUE EXPLICA SU CIFRA · EL PERIODO SE ELIGE Y SE RECUERDA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await irLista(QS); await abrirVentana(CLI);
  // «Última vez que vino» abre EL REGISTRO DE CONTACTOS, no una lista de facturas.
  await page.evaluate(() => document.querySelector('.bf-card[data-tarjeta="ultima"]').click());
  await dormir(1600);
  const capaUltima = await page.evaluate(() => ({
    registro: !!document.querySelector('#bfBody .bf-reg'),
    eventos: document.querySelectorAll('#bfBody .bf-reg .ev').length,
    esTablaFacturas: !!document.querySelector('#bfBody table thead'),
    apuntar: !!document.querySelector('#bfBody [data-apuntar]'),
  }));
  ok(capaUltima.registro && !capaUltima.esTablaFacturas,
     '«Última vez que vino» abre el REGISTRO DE CONTACTOS, no una lista de facturas',
     capaUltima.eventos + ' entradas');
  ok(capaUltima.eventos >= 8, 'y la lista CUADRA con la fecha que enseña la tarjeta', capaUltima.eventos + ' visitas');
  ok(capaUltima.apuntar, 'con su botón para apuntar un contacto a mano');
  await page.evaluate(() => document.getElementById('bfAtras').click()); await dormir(700);

  // C4 — el periodo se elige DENTRO de la tarjeta, cambia título y cifra, y se recuerda al reabrir.
  const tituloPeriodo = () => page.evaluate(() => {
    const c = [...document.querySelectorAll('.bf-card')].find(x => x.getAttribute('data-tarjeta') === 'periodo');
    return c ? { k: c.querySelector('.bf-k').textContent, v: c.querySelector('.bf-v').textContent } : null;
  });
  const antesPer = await tituloPeriodo();
  await page.evaluate(() => document.querySelector('.bf-card[data-tarjeta="periodo"]').click());
  await dormir(1400);
  ok(await page.evaluate(() => document.querySelectorAll('#bfBody [data-per]').length) >= 5,
     'la tarjeta del periodo trae sus opciones dentro: 3, 6, 12 meses, este año y fechas propias');
  await page.evaluate(() => document.querySelector('#bfBody [data-per="m3"]').click());
  await dormir(1600);
  await page.evaluate(() => document.getElementById('bfAtras').click()); await dormir(900);
  const trasPer = await tituloPeriodo();
  ok(trasPer && /3 meses/i.test(trasPer.k), 'elegirlo cambia EL TÍTULO de la tarjeta, no solo la cifra',
     antesPer.k + ' → ' + trasPer.k);
  ok(trasPer.v !== antesPer.v, 'y la cifra', antesPer.v + ' → ' + trasPer.v);
  // Y se recuerda: se cierra todo, se vuelve a abrir, y sigue en 3 meses.
  await irLista(QS); await abrirVentana(CLI);
  const recordado = await tituloPeriodo();
  ok(recordado && /3 meses/i.test(recordado.k), 'y se recuerda al reabrir la ficha', recordado.k);
  const guardado = db.prepare("SELECT blocks FROM dashboard_layouts WHERE scope=?").get('ficha-cliente:' + owner.id);
  ok(!!guardado && /m3/.test(guardado.blocks), 'guardado POR USUARIO, en la tabla de preferencias que ya existía',
     guardado ? guardado.blocks : '(nada)');
  await api('PUT', '/api/erp/clients/periodo-ficha', { clave: 'm12' });   // se deja como estaba

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[8-10] LA REGLA QUE PROTEGE A DISA: CONTACTO NO ES VISITA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // EL CASO QUE NO PUEDE ROMPERSE: un cliente con correos automáticos y ninguna visita en 18 meses
  // tiene que SEGUIR pareciendo dormido. Si los contactos contaran como visita, el detector dejaría
  // de avisar justo de los clientes que se están yendo — y un aviso que no salta no lo echa nadie
  // de menos, así que el fallo viviría años.
  const DORMIDO = db.prepare("INSERT INTO clients (name,active,created_at) VALUES ('Rosa Dormida',1,datetime('now'))").run().lastInsertRowid;
  const insC = db.prepare("INSERT INTO citas (codigo,cliente_id,user_id,fecha,inicio_min,dur_min,margen_min,estado,archived,created_at,updated_at) VALUES (?,?,?,?,?,30,0,'atendida',0,datetime('now'),datetime('now'))");
  [-620, -590, -560, -545].forEach((d, i) => insC.run('CITA-D' + RID + i, DORMIDO, owner.id, dias(d), 600 + i * 30));
  const ritmoAntes = ritmoDelCliente(db, DORMIDO);
  const vigiaAntes = clientesFueraDeRitmo(db, HOY).find(x => x.client_id === DORMIDO);
  ok(!!vigiaAntes, 'el vigía ve dormido a un cliente con 4 visitas y 18 meses sin aparecer',
     vigiaAntes ? vigiaAntes.dias_sin_venir + ' días sin venir' : '(no lo ve)');
  // Tres correos AUTOMÁTICOS y una llamada apuntada a mano. Ninguno es visita.
  for (let i = 0; i < 3; i++) contactoDeCorreo(db, { client_id: DORMIDO, asunto: 'Recordatorio ' + i, automatico: true, doc_id: 77000 + i });
  apuntarContacto(db, { client_id: DORMIDO, tipo: 'telefono', resultado: 'Le llamé, no contesta', user_name: 'Dueña Gate' });
  const ritmoDespues = ritmoDelCliente(db, DORMIDO);
  const vigiaDespues = clientesFueraDeRitmo(db, HOY).find(x => x.client_id === DORMIDO);
  ok(!!vigiaDespues && vigiaDespues.dias_sin_venir === vigiaAntes.dias_sin_venir,
     'tras 3 correos automáticos y una llamada, SIGUE dormido y con los mismos días',
     vigiaDespues ? vigiaDespues.dias_sin_venir + ' días' : '(ha dejado de verlo)');
  ok(ritmoAntes.ritmo_dias === ritmoDespues.ritmo_dias && ritmoAntes.visitas === ritmoDespues.visitas,
     'y su ritmo NO se ha movido ni un día', ritmoAntes.ritmo_dias + ' → ' + ritmoDespues.ritmo_dias);
  // Y las dos tarjetas dan fechas DISTINTAS, que es de lo que va tener dos.
  const cabD = cabeceraDe(DORMIDO);
  ok(cabD.ultima && cabD.contacto && cabD.ultima.fecha.slice(0, 10) !== cabD.contacto.fecha.slice(0, 10),
     '«Último contacto» y «Última vez que vino» dan fechas distintas en ese cliente',
     'vino ' + (cabD.ultima && cabD.ultima.fecha) + ' · contacto ' + (cabD.contacto && cabD.contacto.fecha));
  ok(cabD.contacto && !cabD.contacto.es_automatico, 'y el último contacto es la llamada, no el correo de la máquina',
     cabD.contacto ? cabD.contacto.etiqueta : '—');
  // Lo automático se distingue A SIMPLE VISTA en el registro.
  await irLista(); await abrirVentana(DORMIDO);
  await page.evaluate(() => document.querySelector('.bf-card[data-tarjeta="contacto"]').click());
  await dormir(1600);
  const reg = await page.evaluate(() => ({
    ev: document.querySelectorAll('#bfBody .bf-reg .ev').length,
    autos: document.querySelectorAll('#bfBody .bf-auto').length,
    llamada: /Le llamé/.test(document.getElementById('bfBody').textContent),
  }));
  ok(reg.ev >= 4 && reg.autos === 3,
     'en el registro, lo automático va marcado a simple vista', reg.autos + ' marcados de ' + reg.ev);
  ok(reg.llamada, 'y la llamada apuntada a mano está ahí con su resultado');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[11] LOS CHIPS SE OCULTAN POR LO QUE EL NEGOCIO USA, NUNCA POR VALER 0');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Se lee el perfil de oficio que YA existe (`usa_proyectos`) y `usaAgenda`. No hay un sistema nuevo.
  const chipsDe = () => contadoresDe(db, CLI, () => true, null)
    .map(x => x.key + (x.oculto ? ':oculto' : ':visible'));
  fijarOficio(db, 'taller');
  const enTaller = chipsDe();
  ok(enTaller.includes('proyectos:oculto'), 'en un TALLER el chip de Proyectos viene oculto', enTaller.join(' · '));
  encenderChip(db, 'proyectos', true);
  const trasEncender = contadoresDe(db, CLI, () => true, null).find(x => x.key === 'proyectos');
  ok(!!trasEncender && chipsForzadosGate(db).includes('proyectos'),
     'y encenderlo en «Más opciones» lo devuelve: nada se elimina, se oculta',
     chipsForzadosGate(db).join(',') || '(vacío)');
  encenderChip(db, 'proyectos', false);
  fijarOficio(db, 'asesoria');
  const enAsesoria = chipsDe();
  const nProy = contadoresDe(db, CLI, () => true, null).find(x => x.key === 'proyectos');
  ok(enAsesoria.includes('proyectos:visible') && nProy.n === 0,
     'en una ASESORÍA con 0 proyectos SÍ aparece: es su trabajo, y el 0 le enseña que puede empezar',
     'n=' + nProy.n);
  fijarOficio(db, 'peluqueria');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6-8] DISA RECOMIENDA: UNA LÍNEA POR FAMILIA, NO UNA POR DOCUMENTO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await irLista(QS); await abrirVentana(CLI);
  const D = await api('GET', '/api/erp/clients/' + CLI + '/360');
  const vencidas = (D.disa || []).filter(a => a.detector === 'deuda_vencida');
  const recs = D.recomienda || [];
  const recDeuda = recs.find(r => r.key === 'deuda');
  ok(vencidas.length >= 6, 'el vigía encuentra seis o más facturas vencidas de este cliente', vencidas.length + '');
  ok(!!recDeuda && recDeuda.n === vencidas.length && recs.filter(r => r.key === 'deuda').length === 1,
     'y las ' + vencidas.length + ' salen como UNA sola línea, no como ' + vencidas.length,
     recDeuda ? '1 línea con ' + recDeuda.n + ' documentos detrás' : '(falta)');
  ok(recs.length === new Set(recs.map(r => r.key)).size && recs.length <= 3,
     'una línea POR FAMILIA y ninguna repetida', recs.map(r => r.key).join(', '));
  const sumaVigia = r2(vencidas.reduce((x, a) => x + (Number(a.cifra) || 0), 0));
  ok(recDeuda && r2(recDeuda.total) === sumaVigia,
     'el total de la recomendación es la SUMA EXACTA de lo que dice el vigía, sin recalcular nada',
     recDeuda ? recDeuda.total + ' = ' + sumaVigia : '—');
  ok(recDeuda && /\d+ día/.test(recDeuda.antiguedad || ''), 'y dice los días de la más antigua', recDeuda?.antiguedad || '(falta)');
  const pintadoRec = await page.evaluate(() => ({
    cajas: document.querySelectorAll('.bf-rec').length,
    texto: document.querySelector('.bf-rec .q')?.textContent || '',
    reco: document.querySelector('.bf-rec .r')?.textContent || '',
    botones: [...(document.querySelector('.bf-rec')?.querySelectorAll('[data-rec]') || [])].map(b => b.textContent.trim()),
  }));
  ok(pintadoRec.cajas === recs.length && pintadoRec.cajas < vencidas.length,
     'en pantalla se ven ' + pintadoRec.cajas + ' cajas (una por familia) y no ' + vencidas.length + ' (una por factura)',
     pintadoRec.cajas + ' cajas · ' + vencidas.length + ' documentos');
  ok(/facturas vencidas por/.test(pintadoRec.texto) && /recomiendo/i.test(pintadoRec.reco),
     'con la decisión formulada, no un listado', pintadoRec.texto + ' ' + pintadoRec.reco);
  ok(pintadoRec.botones.includes('Gestionar cuenta') && pintadoRec.botones.includes('Preguntar a DISA cómo'),
     'y sus dos botones', pintadoRec.botones.join(' · '));

  // [7] Preguntar a DISA cómo → abre DISA con el cliente en contexto, sin escribir ni enviar nada.
  const antesPropuestas = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='disa_proposals'").get().n
    ? db.prepare('SELECT COUNT(*) n FROM disa_proposals').get().n : 0;
  await page.evaluate(() => document.querySelector('.bf-rec [data-rec="disa"]').click());
  await dormir(1500);
  const trasDisa = await page.evaluate(() => location.pathname + location.search);
  ok(/\/admin\/disa/.test(trasDisa) && /Marta%20Rovira|Marta\+Rovira/.test(trasDisa),
     'lleva a DISA con este cliente en el contexto de la pregunta', decodeURIComponent(trasDisa).slice(0, 90));
  const despuesPropuestas = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='disa_proposals'").get().n
    ? db.prepare('SELECT COUNT(*) n FROM disa_proposals').get().n : 0;
  ok(antesPropuestas === despuesPropuestas, 'y DISA no ha escrito ni enviado NADA por su cuenta',
     antesPropuestas + ' = ' + despuesPropuestas);

  // [8] Cliente sin nada que recomendar → el bloque NO aparece. Ni una frase vacía.
  await irLista(); await abrirVentana(LIMPIO);
  const limpio = await page.evaluate(() => ({
    recs: document.querySelectorAll('.bf-rec').length,
    texto: document.getElementById('bfBody').textContent,
  }));
  ok(limpio.recs === 0, 'un cliente sin nada que recomendar no enseña el bloque de DISA');
  ok(!/todo en orden|sin avisos|nada que/i.test(limpio.texto), 'ni una frase vacía en su lugar');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[9] CADA CIFRA DE TARJETA CUADRA AL CÉNTIMO CON SU PANTALLA DE ORIGEN');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await irFicha(CLI);
  const D2 = await api('GET', '/api/erp/clients/' + CLI + '/360');
  const deudaMotor = clientDebt(db, CLI, HOY);
  ok(Math.abs(D2.cabecera.deuda.total - deudaMotor.total) < 0.005,
     'la deuda de la tarjeta es la del motor de cobros', D2.cabecera.deuda.total + ' = ' + deudaMotor.total);
  const filaCli = cruzar(db, { area: 'ventas', dimension: 'cliente', medidas: ['base', 'coste', 'beneficio', 'margenPct'], hasPerm: () => true })
    .filas.find(f => f.clave === 'Marta Rovira');
  ok(Math.abs(D2.cabecera.gasto.total - filaCli.base) < 0.005,
     'el gasto total es el del constructor cruzando ventas por cliente', D2.cabecera.gasto.total + ' = ' + filaCli.base);
  ok(D2.cabecera.margen.euros === filaCli.margen.euros && D2.cabecera.margen.pctVenta === filaCli.margen.pctVenta,
     'y el margen es EL MISMO objeto de cifras que el constructor', JSON.stringify(D2.cabecera.margen.euros) + ' €');
  // El detalle de la tarjeta suma, factura a factura, exactamente el titular.
  const det = await api('GET', '/api/erp/clients/' + CLI + '/360/tarjeta/margen');
  const sumaDet = r2(det.filas.reduce((x, f) => x + (f.euros || 0), 0));
  ok(sumaDet === det.margen.euros,
     'el desglose por documento SUMA el titular: la cifra se puede comprobar a mano', sumaDet + ' = ' + det.margen.euros);
  const sumaBase = r2(det.filas.reduce((x, f) => x + f.venta, 0));
  ok(sumaBase === det.margen.venta,
     'y la base del porcentaje también se puede sumar a mano', sumaBase + ' = ' + det.margen.venta);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[10-11] LOS DOS MÁRGENES: EL MISMO IMPORTE, DOS PORCENTAJES, LA BASE SIEMPRE DICHA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const M = margenMotor({ venta: VENTA, coste: COSTE, fuera: FUERA });
  ok(M.euros === 360 && M.pctVenta === 30 && M.pctCoste === 42.86,
     'con 1.200 € de venta y 840 € de coste: 360 €, 30,0 % sobre la venta y 42,9 % sobre el coste',
     JSON.stringify({ euros: M.euros, venta: M.pctVenta, coste: M.pctCoste }));
  ok(M.pctVenta !== M.pctCoste, 'los dos porcentajes son DISTINTOS entre sí');
  // El importe en euros es EL MISMO en los dos modos: es lo que hace que las dos cifras hablen de lo
  // mismo. Si cambiara con el modo, serían dos cuentas distintas disfrazadas de una preferencia.
  setModoDeEmpresa(db, 'venta');
  const cV = cruzar(db, { area: 'ventas', dimension: 'cliente', medidas: ['beneficio', 'margenPct'], hasPerm: () => true }).filas.find(f => f.clave === 'Marta Rovira');
  setModoDeEmpresa(db, 'coste');
  const cC = cruzar(db, { area: 'ventas', dimension: 'cliente', medidas: ['beneficio', 'margenPct'], hasPerm: () => true }).filas.find(f => f.clave === 'Marta Rovira');
  ok(cV.beneficio === cC.beneficio, 'el IMPORTE EN EUROS es idéntico en los dos modos', cV.beneficio + ' € en ambos');
  ok(cV.margenPct !== cC.margenPct, 'y el porcentaje cambia con el modo', cV.margenPct + ' % vs ' + cC.margenPct + ' %');
  ok(cV.margenPct === M.pctVenta && cC.margenPct === M.pctCoste, 'cada modo enseña el suyo, no otro');

  // [10] Cambiar el ajuste cambia el titular EN TODAS las superficies A LA VEZ.
  const titulares = (modo) => {
    setModoDeEmpresa(db, modo);
    const cliente = cruzar(db, { area: 'ventas', dimension: 'cliente', medidas: ['margenPct'], hasPerm: () => true }).filas.find(f => f.clave === 'Marta Rovira').margenPct;
    const constructor = cruzar(db, { area: 'ventas', dimension: 'fecha', medidas: ['margenPct'], hasPerm: () => true }).filas[0]?.margenPct;
    const informes = margenResumen(db, {}).margen;
    return { cliente, constructor, informeVenta: informes.pctVenta, informeCoste: informes.pctCoste,
             informeTitular: modo === 'coste' ? informes.pctCoste : informes.pctVenta };
  };
  const tV = titulares('venta'), tC = titulares('coste');
  ok(tV.cliente === tV.informeTitular && tC.cliente === tC.informeTitular,
     'ficha de cliente e informes enseñan el MISMO titular en los dos modos',
     tV.cliente + ' / ' + tC.cliente);
  ok(tV.cliente !== tC.cliente && tV.constructor !== tC.constructor,
     'y las tres superficies cambian A LA VEZ al mover el ajuste',
     'cliente ' + tV.cliente + '→' + tC.cliente + ' · constructor ' + tV.constructor + '→' + tC.constructor);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[12] BARRIDO: NINGÚN PORCENTAJE DE MARGEN VA DESNUDO EN NINGUNA PANTALLA');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ESTE ES EL CRITERIO QUE CIERRA EL FALLO DE ORIGEN. Se recorren las pantallas que enseñan margen
  // y se busca un porcentaje HUÉRFANO: un número con % cuyo texto vecino hable de margen y que NO
  // diga sobre qué se divide. Un cálculo perfecto sin su base sigue engañando.
  setModoDeEmpresa(db, 'venta');
  const PANTALLAS = [
    ['/admin/clients/' + CLI, 'ficha de cliente'],
    ['/admin/analytics', 'informes'],
  ];
  let desnudos = [];
  for (const [ruta, nombre] of PANTALLAS) {
    await page.goto(BASE + ruta, { waitUntil: 'networkidle0' });
    await dormir(1800);
    const hallados = await page.evaluate(() => {
      const malos = [];
      const BASES = /sobre lo que (cobras|te cost|cobro|me cost)|sobre la venta|sobre el coste/i;
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length) continue;
        const txt = (el.textContent || '').trim();
        if (!/%/.test(txt)) continue;
        // ¿Este porcentaje habla de margen? Se mira su propio texto y el de su contenedor cercano.
        const ctx = [txt, el.parentElement?.textContent || '', el.parentElement?.parentElement?.textContent || ''].join(' ');
        if (!/margen|beneficio|ganas|gano|le meto/i.test(ctx)) continue;
        if (BASES.test(ctx)) continue;                       // dice su base: correcto
        malos.push(txt.slice(0, 60));
      }
      return malos;
    });
    if (hallados.length) desnudos.push(nombre + ': ' + hallados.join(' | '));
  }
  ok(desnudos.length === 0, 'ninguna pantalla enseña un % de margen sin decir su base',
     desnudos.length ? desnudos.join('  ·  ') : PANTALLAS.map(p => p[1]).join(' y ') + ' barridos');

  // Y el detalle enseña SIEMPRE los dos, con euros y con lo que queda fuera (G3).
  await irLista(QS); await abrirVentana(CLI);
  await page.evaluate(() => document.querySelector('.bf-card[data-tarjeta="margen"]').click());
  await dormir(1400);
  const desglose = await page.evaluate(() => document.getElementById('bfBody').textContent.replace(/\s+/g, ' '));
  ok(/sobre lo que cobras/i.test(desglose) && /sobre lo que te cost/i.test(desglose),
     'el detalle enseña SIEMPRE los dos porcentajes');
  ok(/el mismo importe en los dos/i.test(desglose), 'con el importe en euros, que es el mismo');
  ok(/[Qq]uedan fuera/.test(desglose) && /400,00/.test(desglose),
     'y dice qué parte queda fuera por no tener coste conocido', /Quedan fuera[^.]{0,60}/.exec(desglose)?.[0] || '(falta)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[13] P&G Y CONTABILIDAD NO SE MUEVEN, ELIJA LO QUE ELIJA EL DUEÑO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const pygDe = () => { const p = cuentaPyG(db, '0001-01-01', '9999-12-31');
    return { res: r2(p.resultadoEjercicio), n: p.partidas.length }; };
  setModoDeEmpresa(db, 'venta'); const pygV = pygDe(); const venV = ventasResumen(db, {});
  setModoDeEmpresa(db, 'coste'); const pygC = pygDe(); const venC = ventasResumen(db, {});
  ok(pygV.res === pygC.res && pygV.n === pygC.n,
     'la cuenta de resultados da lo MISMO en los dos modos', pygV.res + ' € = ' + pygC.res + ' €');
  ok(JSON.stringify(venV) === JSON.stringify(venC), 'y Ventas también', JSON.stringify(venV));
  // R1 — la rentabilidad por proyecto es P&G: su % va SIEMPRE sobre la venta.
  const pr = db.prepare("INSERT INTO proyectos (nombre,cliente_id,estado,active,created_at) VALUES ('Obra Gate',?,'abierto',1,datetime('now'))").run(CLI).lastInsertRowid;
  setModoDeEmpresa(db, 'venta'); const rV = rentabilidadProyecto(db, pr);
  setModoDeEmpresa(db, 'coste'); const rC = rentabilidadProyecto(db, pr);
  ok(rV.margenPct === rC.margenPct && rV.resultado === rC.resultado,
     'la rentabilidad por proyecto no cambia con el ajuste: es P&G, y ahí manda «sobre la venta»',
     rV.margenPct + ' en los dos');
  setModoDeEmpresa(db, 'venta');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[14] EL ALTA: ELEGIR A, ELEGIR B Y SALTAR — LOS TRES TERMINAN EL PASO');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  db.prepare("DELETE FROM settings WHERE key LIKE 'margen_modo%'").run();
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' }); await dormir(1300);
  const alta0 = await page.evaluate(() => ({
    anillo: document.querySelector('.onb-ring-n')?.textContent || '',
    pasos: [...document.querySelectorAll('.onb-stitle')].map(x => x.textContent),
    opciones: [...document.querySelectorAll('.onb-mg-op')].map(b => b.getAttribute('data-margen')),
    saltar: !!document.querySelector('[data-margen="saltar"]'),
    premarcada: [...document.querySelectorAll('.onb-mg-op')].filter(b => b.getAttribute('aria-pressed') === 'true').length,
  }));
  // EL ALTA CAMBIÓ DE FORMA (panel «Pon en marcha tu negocio»): son tres bloques con más pasos, no
  // una lista de cuatro. Lo que este gate defiende NO era el número: era que el contador sale solo
  // del array y que el paso del margen está, con sus dos opciones y sin premarcar. Eso sigue.
  ok(new RegExp('^' + alta0.pasos.length + '$|/' + alta0.pasos.length + '$').test(alta0.anillo.replace(/^\\d+/, '')) || alta0.anillo.endsWith('/' + alta0.pasos.length),
     'el contador del alta sale del propio array de pasos, no de un número escrito a mano',
     alta0.anillo + ' con ' + alta0.pasos.length + ' pasos');
  ok(alta0.pasos.includes('Cómo cuentas tu margen'), 'y el paso del margen sigue estando', alta0.pasos.join(' | '));
  const tresSalidas = [];
  for (const via of ['venta', 'coste', 'saltar']) {
    db.prepare("DELETE FROM settings WHERE key LIKE 'margen_modo%'").run();
    const r = await api('POST', '/api/erp/settings/margen/alta', via === 'saltar' ? { saltar: true } : { modo: via });
    const guardado = db.prepare("SELECT value FROM settings WHERE key='margen_modo'").get()?.value || null;
    const preguntado = db.prepare("SELECT value FROM settings WHERE key='margen_modo_elegido'").get()?.value || null;
    tresSalidas.push({ via, err: r.__err || null, modo: modoDeEmpresa(db), guardado, preguntado });
  }
  ok(tresSalidas.every(x => !x.err && x.preguntado === '1'),
     'las tres salidas terminan el paso', tresSalidas.map(x => x.via + '→' + (x.err || 'ok')).join(' · '));
  ok(tresSalidas.find(x => x.via === 'saltar').modo === MODO_POR_DEFECTO
     && tresSalidas.find(x => x.via === 'saltar').guardado === null,
     'saltar deja «sobre la venta» y NO escribe nada: la ausencia ya vale eso');
  ok(tresSalidas.find(x => x.via === 'coste').modo === 'coste', 'y elegir B deja «sobre el coste»');

  // Contestar el paso lo MARCA (ya no «retira el alta entera»: el panel se pliega cuando está todo
  // hecho, y de eso se ocupa gate-inicio-arranque). Aquí se comprueba lo de esta tarea: que
  // contestarlo cuenta.
  db.prepare("DELETE FROM settings WHERE key LIKE 'margen_modo%'").run();
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' }); await dormir(1800);
  const antesMg = await page.evaluate(() => (document.querySelector('.onb-ring-n') || {}).textContent || '');
  await api('POST', '/api/erp/settings/margen/alta', { saltar: true });
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' }); await dormir(1800);
  const trasMg = await page.evaluate(() => (document.querySelector('.onb-ring-n') || {}).textContent || '');
  const hechos = t => parseInt(String(t).split('/')[0], 10) || 0;
  ok(hechos(trasMg) === hechos(antesMg) + 1,
     'contestar (o saltar) el paso del margen lo marca en el panel de arranque', antesMg + ' → ' + trasMg);
  // DISA propone según el oficio, pero NUNCA premarca.
  ok(alta0.premarcada === 0, 'ninguna de las dos opciones viene premarcada', alta0.premarcada + ' premarcadas');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[15-16] EMPRESA EXISTENTE INTACTA · «VER TODO EN OPORTUNIDADES» YA NO MIENTE');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // R2 — Una empresa que nunca tocó el ajuste lee «sobre la venta», y ese porcentaje es EL MISMO que
  // daba la fórmula de antes (beneficio ÷ ingresos con coste), escrita aquí a mano a propósito: si
  // alguien cambiara la del motor, esta comparación caería.
  db.prepare("DELETE FROM settings WHERE key LIKE 'margen_modo%'").run();
  ok(modoDeEmpresa(db) === 'venta', 'una empresa que nunca eligió lee «sobre la venta»');
  const rm = margenResumen(db, {});
  const comoAntes = r2((rm.ingresosConCoste - rm.coste) / rm.ingresosConCoste * 100);
  ok(rm.margenPct === comoAntes,
     'y su margen vale EXACTAMENTE lo que valía antes de esta tarea', rm.margenPct + ' % = ' + comoAntes + ' %');

  // [16] El pie del embudo colgaba de la longitud del TIMELINE, no de si había oportunidades: con 0
  // oportunidades y 21 facturas aparecía igual, llevando a un embudo vacío.
  await irLista(QS); await abrirVentana(CLI);
  const nOpps = db.prepare('SELECT COUNT(*) n FROM opportunities WHERE client_id=? AND active=1').get(CLI).n;
  const embudo = await page.evaluate(() => document.body.textContent);
  ok(nOpps === 0, 'este cliente no tiene ninguna oportunidad', nOpps + '');
  ok(!/Ver todo en Oportunidades/i.test(embudo),
     'y «Ver todo en Oportunidades» NO aparece sobre su lista de facturas');
  ok(!/Actividad y (oportunidades|embudo)/i.test(embudo), 'el título «Actividad y embudo» ha desaparecido');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[17] LA FICHA COMPLETA CONSERVA TODO: HISTORIA, TABLA DE FACTURAS Y NOTAS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await api('POST', '/api/erp/clients/' + CLI + '/notas', { texto: 'Nota del gate: viene los viernes' });
  await irFicha(CLI);
  await dormir(900);
  const completa = await page.evaluate(() => ({
    historia: document.querySelectorAll('[id$="_tl"] .bf-reg .ev').length,
    tabla: document.querySelectorAll('[id$="_fac"] tbody tr').length,
    cobrarEnTabla: document.querySelectorAll('[id$="_fac"] [data-cobro]').length,
    notas: document.querySelectorAll('[id$="_notas"] .bf-nota').length,
    compra: document.querySelectorAll('[id$="_compra"] .fila').length,
    tarjetas: document.querySelectorAll('.bf-card').length,
  }));
  ok(completa.historia > 0, 'la historia sigue entera', completa.historia + ' eventos');
  ok(completa.tabla >= 8 && completa.cobrarEnTabla > 0,
     'la tabla larga de facturas está, con sus botones de cobro',
     completa.tabla + ' filas · ' + completa.cobrarEnTabla + ' botones');
  ok(completa.notas === 1, 'las notas a mano siguen ahí', completa.notas + '');
  ok(completa.compra > 0 && completa.tarjetas === 8, 'y el ranking y las ocho tarjetas también',
     completa.compra + ' líneas · ' + completa.tarjetas + ' tarjetas');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[18] PERMISOS INTACTOS: QUIEN NO VE FACTURAS NO VE SUS TARJETAS, NI POR LA URL');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const empleado = (nombre, permisos) => {
    const uid = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,must_change_password,created_at) VALUES (?,?,'x','employee',1,0,datetime('now'))")
      .run(nombre, nombre.toLowerCase().replace(/\s+/g, '') + RID + '@bamburu.test').lastInsertRowid;
    for (const [mod, acc] of permisos) {
      const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, acc);
      if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(uid, p.id);
    }
    return uid;
  };
  // Contexto propio: las páginas de Puppeteer COMPARTEN el tarro de cookies y la sesión del empleado
  // pisaría la de la dueña, produciendo fallos falsos aguas abajo.
  const ctx = await browser.createBrowserContext();
  const pe = await ctx.newPage();
  const errsE = []; pe.on('pageerror', e => errsE.push(String(e.message || e)));
  await pe.setViewport({ width: 1440, height: 1000 });
  const sinFacturas = empleado('Sin Facturas', [['clients', 'read'], ['citas', 'read']]);
  await pe.setCookie({ name: 'asess', value: sesion(sinFacturas), domain: slug + '.localhost', path: '/' });
  await pe.goto(BASE + '/admin/clients/' + CLI, { waitUntil: 'networkidle0' }); await dormir(1100);
  const vistaE = await pe.evaluate(() => ({
    entra: !!document.getElementById('f360resumen'),
    claves: [...document.querySelectorAll('.bf-card')].map(c => c.getAttribute('data-tarjeta')),
    // innerText y no textContent: textContent incluye el contenido de <script> y <style>, que no
    // es nada que el usuario vea. Medirlo ahí daba un falso positivo con el CSS del componente.
    texto: document.body.innerText,
  }));
  ok(vistaE.entra, 'quien ve clientes pero no facturas ENTRA en la ficha');
  ok(!vistaE.claves.some(k => ['gasto', 'doce', 'ticket', 'deuda', 'margen'].includes(k)),
     'y NO ve ninguna tarjeta de dinero', vistaE.claves.join(', ') || '(ninguna de dinero)');
  ok(!/margen|te debe|sobre lo que cobras/i.test(vistaE.texto),
     'ni la palabra «margen» ni «te debe» en ningún sitio VISIBLE de su ficha',
     (/[^\n]*margen[^\n]*/i.exec(vistaE.texto) || ['(ninguna)'])[0].slice(0, 70));
  const porLaUrl = await pe.evaluate(async id => {
    const r = await fetch('/api/erp/clients/' + id + '/360/tarjeta/margen');
    return r.status;
  }, CLI);
  ok(porLaUrl === 403, 'y pedir la tarjeta de margen a mano da 403, no los datos', 'HTTP ' + porLaUrl);
  await ctx.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[19] MÓVIL 390 px: HOJA INFERIOR, SIN SCROLL HORIZONTAL, CERO ERRORES DE JS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const errsM = [];
  const pm = await browser.newPage();
  pm.on('pageerror', e => errsM.push(String(e.message || e)));
  await pm.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await pm.setCookie({ name: 'asess', value: sesion(owner.id), domain: slug + '.localhost', path: '/' });
  await pm.goto(BASE + '/admin/clients' + QS, { waitUntil: 'networkidle0' }); await dormir(700);
  await pm.evaluate(i => window.viewDetail(i), CLI); await dormir(1600);
  const movil = await pm.evaluate(() => {
    const ov = document.querySelector('.bf-win-overlay.open');
    const w = ov && ov.querySelector('.bf-win');
    const r = w && w.getBoundingClientRect();
    const est = ov && getComputedStyle(ov);
    return {
      abierta: !!ov,
      pegadaAbajo: r ? Math.abs(r.bottom - window.innerHeight) < 2 : false,
      alineada: est ? est.alignItems : '',
      casiPantalla: r ? r.height / window.innerHeight > 0.6 : false,
      asa: !!(w && w.querySelector('.bf-grab') && getComputedStyle(w.querySelector('.bf-grab')).display !== 'none'),
      scrollH: document.documentElement.scrollWidth > window.innerWidth,
      tarjetas: document.querySelectorAll('.bf-card').length,
    };
  });
  ok(movil.abierta && movil.alineada === 'flex-end' && movil.pegadaAbajo,
     'en móvil la ventana es una HOJA INFERIOR pegada abajo', JSON.stringify({ al: movil.alineada, abajo: movil.pegadaAbajo }));
  ok(movil.casiPantalla, 'casi a pantalla completa');
  ok(movil.asa, 'con su asa para arrastrarla hacia abajo');
  ok(!movil.scrollH && movil.tarjetas === 8, 'sin scroll horizontal y con las ocho tarjetas',
     movil.tarjetas + ' tarjetas');
  // Arrastrar hacia abajo la cierra (A4).
  const caja = await pm.evaluate(() => { const r = document.querySelector('.bf-win').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; });
  await pm.touchscreen.touchStart(caja.x, caja.y);
  await pm.touchscreen.touchMove(caja.x, caja.y + 200);
  await pm.touchscreen.touchEnd();
  await dormir(800);
  ok(await pm.evaluate(() => document.querySelectorAll('.bf-win-overlay.open').length) === 0,
     'y arrastrarla hacia abajo la cierra');
  ok(errsM.length === 0, 'cero errores de JavaScript en móvil', errsM.join(' | ') || 'ninguno');
  await pm.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[20] NETO-CERO: VENTAS, P&G Y LAS HUELLAS DE VERIFACTU, INTACTAS');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const huella = () => db.prepare('SELECT id, verifactu_hash, prev_hash FROM invoices ORDER BY id').all()
    .map(i => i.id + ':' + (i.verifactu_hash || '') + ':' + (i.prev_hash || '')).join('|');
  const h1 = huella(), v1 = ventasResumen(db, {}), p1 = cuentaPyG(db, '0001-01-01', '9999-12-31').resultadoEjercicio;
  setModoDeEmpresa(db, 'coste');
  await irFicha(CLI); await dormir(900);
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle0' }); await dormir(1500);
  const h2 = huella(), v2 = ventasResumen(db, {}), p2 = cuentaPyG(db, '0001-01-01', '9999-12-31').resultadoEjercicio;
  ok(h1 === h2, 'ni una huella de Verifactu cambia al mover el ajuste de margen',
     h1.length + ' caracteres de cadena, idénticos');
  ok(JSON.stringify(v1) === JSON.stringify(v2), 'Ventas da lo mismo', JSON.stringify(v1));
  ok(r2(p1) === r2(p2), 'y la cuenta de resultados también', r2(p1) + ' €');
  const nFacFin = countingSalesInvoices(db, {}).length;
  ok(nFacFin === 8, 'y no se ha creado ni perdido ninguna factura por el camino', nFacFin + '');
  setModoDeEmpresa(db, 'venta');

  ok(errs.length === 0, 'cero errores de JavaScript en toda la sesión de escritorio',
     errs.join(' | ') || 'ninguno');

} catch (e) {
  fail++;
  console.error('\n✗ EL GATE HA REVENTADO: ' + (e && e.stack || e));
} finally {
  try { if (browser) await browser.close(); } catch {}
  limpiar();
  console.log('  ✓ negocio de prueba eliminado');
}

console.log('\n═════════ RESULTADO: ' + pass + ' OK · ' + fail + ' fallos ═════════');
process.exit(fail ? 1 : 0);
