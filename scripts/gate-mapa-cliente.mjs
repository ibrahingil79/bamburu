// ════════════════════════════════════════════════════════════════════════════════════════════════
// Gate — F · EL MAPA EN LA FICHA DE CLIENTE
//
//   node scripts/gate-mapa-cliente.mjs
//
// LO QUE DEFIENDE, y por qué está escrito así:
//
//  1. QUE EL MECANISMO SEA EL QUE SE ACORDÓ, no solo que salga un mapa. La decisión de Ibrahin fue
//     «las teselas por nuestro servidor, con caché»: el navegador NO puede hablar con
//     openstreetmap.org al abrir una ficha. Por eso la aserción fuerte de este gate no es «se ve un
//     mapa» sino «TODAS las peticiones de la pantalla van a nuestro dominio y NINGUNA sale fuera».
//     Un gate que solo mirase si hay mapa daría verde con las teselas viniendo de un tercero — que
//     es exactamente la mitad del encargo que no se cumpliría.
//
//  2. QUE SIN DIRECCIÓN NO SE PINTE NADA, y «nada» medido en píxeles: la caja existe en el HTML
//     pero tiene que estar vacía, oculta y ocupar CERO. Comprobar solo «no hay mapa» dejaría pasar
//     el hueco en blanco, que es justo lo que el encargo prohíbe («ni hueco, ni mapa vacío»).
//
//  3. QUE UN PUNTO VIEJO NO SE PINTE NUNCA. Un cliente que se muda tiene guardadas las coordenadas
//     de su casa anterior hasta que alguien vuelva a guardar la ficha. Entre medias, la ficha NO
//     puede enseñar esa chincheta: mentiría con toda la confianza del mundo.
//
// ── POR QUÉ ESTE GATE NO LLAMA A NOMINATIM ──────────────────────────────────────────────────────
// A propósito y por escrito: un gate que dependa de un servicio ajeno da rojos que no son del
// producto, y esos enseñan a desconfiar del barrido. La resolución de verdad se probó a mano contra
// el servicio real (queda el caso medido en la cabecera de `modules/erp/mapa-cliente.js`). Aquí el
// punto se SIEMBRA en la base como si ya se hubiera resuelto al guardar, que es el estado en el que
// la ficha se lo encuentra siempre, y la criba (`aceptaResultado`) se prueba como función pura con
// las respuestas REALES que devolvió el servicio, copiadas literalmente.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import puppeteer from 'puppeteer';
import path from 'path';
import { unlinkSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { launchOpts } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { updateClientSvc } from '../modules/erp/routes/clients.js';
import { direccionDeCliente, aceptaResultado } from '../modules/erp/mapa-cliente.js';

const RID = randomBytes(3).toString('hex');
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { if (c) { pass++; console.log('  ✓ ' + m + (x ? ' — ' + x : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (x ? ' — ' + x : '')); } };

// Gran Vía 32 de Madrid, con las coordenadas que devolvió el servicio real. No se piden: se siembran.
const PUNTO = { lat: 40.4205785, lon: -3.7034263 };
const DIR = { address: 'Gran Via 32', postal_code: '28013', city: 'Madrid', province: 'Madrid', country: 'España' };
// Una tesela que ningún mapa de verdad va a pedir (z 19 en la esquina del tablero): así el gate
// puede sembrar la caché y comprobar que se sirve de disco SIN depender de que haya red.
const TESELA_PRUEBA = { z: 19, x: 1, y: 1 };
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let slug = null, db = null, browser = null, teselaSembrada = null;
function limpiar() {
  try { if (db) db.close(); } catch {}
  if (teselaSembrada) { try { unlinkSync(teselaSembrada); } catch {} }
  if (!slug) return;
  const t = getTenantBySlug(slug);
  if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
  }
}

try {
  // ── [0] LA CRIBA, COMO FUNCIÓN PURA ──────────────────────────────────────────────────────────
  // Va la primera y sin servidor: es la regla que decide si una chincheta se enseña o no, y las dos
  // respuestas de abajo son LITERALES del servicio real (23 ago 2026). La de Majadahonda es el caso
  // que da miedo: viene con la misma precisión declarada que la buena (place_rank 30) y cae en otro
  // municipio. Si esta comprobación se cae, el producto puede estar enviando a nadie sabe dónde.
  console.log('\n[0] LA CRIBA — con las respuestas reales del servicio');
  const partes = direccionDeCliente(DIR).partes;
  ok(aceptaResultado({ lat: '40.4715037', lon: '-3.8716821', place_rank: 30,
    address: { house_number: '32', road: 'Calle Gran Vía', town: 'Majadahonda', postcode: '28220' } }, partes) === false,
    'la respuesta que cae en MAJADAHONDA se rechaza (otro CP, otro municipio)');
  ok(aceptaResultado({ lat: '40.4205785', lon: '-3.7034263', place_rank: 30,
    address: { house_number: '32', road: 'Gran Vía', city: 'Madrid', postcode: '28013' } }, partes) === true,
    'la de Gran Vía 32 de Madrid se acepta');
  ok(aceptaResultado({ lat: '40.416782', lon: '-3.703507', place_rank: 15,
    address: { city: 'Madrid' } }, partes) === false,
    'el centro de Madrid (place_rank 15) se rechaza: es una mancha, no un sitio');
  ok(direccionDeCliente({ address: '', city: 'Madrid', country: 'España' }) === null,
    'un cliente que solo tiene ciudad NO tiene dirección');

  // ── [1] DE CERO — negocio y cuatro clientes, uno por cada caso ────────────────────────────────
  console.log('\n[1] DE CERO — negocio nuevo y los cuatro casos');
  const alta = await provisionTenant({ businessName: 'Gate Mapa ' + RID, ownerName: 'Dueña Gate',
    email: 'gatemapa-' + RID + '@bamburu.test', password: 'Gate.Mapa.' + RID + '!', phone: '+34 600 000 000' });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  ok(!!t, 'negocio creado desde cero', slug);
  db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP, t.db_filename));
  const BASE = 'http://' + slug + '.localhost:3000';
  const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner'").get();

  ok(!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='client_geo'").get(),
    'la migración deja la tabla client_geo en un negocio nuevo');

  const nuevoCliente = (nombre, dir) => db.prepare(
    'INSERT INTO clients (name,address,postal_code,city,province,country,active,created_at) VALUES (?,?,?,?,?,?,1,datetime(\'now\'))'
  ).run(nombre, dir.address || '', dir.postal_code || '', dir.city || '', dir.province || '', dir.country || '').lastInsertRowid;
  const sembrar = (id, huella, resuelto, lat, lon) => db.prepare(
    "INSERT INTO client_geo (client_id,huella,lat,lon,etiqueta,resuelto,updated_at) VALUES (?,?,?,?,?,?,datetime('now'))"
  ).run(id, huella, lat, lon, 'Gran Vía 32, Madrid', resuelto);

  // El nombre lleva carga XSS a propósito: en esta casa hay clientes así desde el primer día, y el
  // nombre viaja al enlace de ruta. Si algo se reinyecta sin escapar, se ve aquí.
  const CON = nuevoCliente('<img src=x onerror="window.__xss=1">Mapa Sí', DIR);
  const SIN = nuevoCliente('Mapa No', { city: 'Madrid', country: 'España' });   // ciudad pero SIN calle
  const MUDADO = nuevoCliente('Mapa Mudado', { ...DIR, address: 'Gran Via 99' });
  const FALLIDO = nuevoCliente('Mapa Fallido', { ...DIR, address: 'Calle Que No Existe 1' });

  sembrar(CON, direccionDeCliente(DIR).huella, 1, PUNTO.lat, PUNTO.lon);
  // Al mudado se le siembra el punto de la dirección VIEJA: la ficha no puede pintarlo.
  sembrar(MUDADO, direccionDeCliente(DIR).huella, 1, PUNTO.lat, PUNTO.lon);
  // Y al fallido, la respuesta legítima «se preguntó y no se pudo».
  sembrar(FALLIDO, direccionDeCliente({ ...DIR, address: 'Calle Que No Existe 1' }).huella, 0, null, null);
  ok(db.prepare('SELECT COUNT(*) n FROM client_geo').get().n === 3, 'sembrados los tres puntos de partida');

  // ── [2] EL SERVIDOR: qué dice el /360 de cada uno ─────────────────────────────────────────────
  console.log('\n[2] LO QUE MANDA EL SERVIDOR');
  const now = Math.floor(Date.now() / 1000);
  const sesion = uid => { const tok = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
      .run(tok, uid, now, now + 3600, randomBytes(32).toString('base64url')); return tok; };

  browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  // TODAS las peticiones de la pantalla, con su dominio. Es la prueba del mecanismo acordado.
  const dominios = new Set(); const teselas = [];
  page.on('request', r => {
    let h = ''; try { h = new URL(r.url()).host; } catch {}
    if (h) dominios.add(h);
    const u = r.url(); if (u.indexOf('/api/erp/mapa/tesela/') >= 0) teselas.push(u);
  });
  await page.setViewport({ width: 1400, height: 1000 });
  await page.setCookie({ name: 'asess', value: sesion(owner.id), domain: slug + '.localhost', path: '/' });
  const api = (m, u, b) => page.evaluate(async (m, u, b) => {
    try { return await window.api(m, u, b); } catch (e) { return { __err: e.message }; }
  }, m, u, b);

  const irFicha = async id => { await page.goto(BASE + '/admin/clients/' + id, { waitUntil: 'networkidle0' }); await dormir(900); };
  await irFicha(CON);
  const d360 = await api('GET', '/api/erp/clients/' + CON + '/360');
  ok(!!d360.mapa && Math.abs(d360.mapa.lat - PUNTO.lat) < 1e-6 && Math.abs(d360.mapa.lon - PUNTO.lon) < 1e-6,
    'con dirección resuelta, el /360 trae el punto', d360.mapa && (d360.mapa.lat + ',' + d360.mapa.lon));
  ok(d360.mapa && d360.mapa.direccion === 'Gran Via 32, 28013, Madrid, Madrid, España',
    'y la dirección completa para el pie del mapa', d360.mapa && d360.mapa.direccion);
  for (const [id, quien] of [[SIN, 'sin calle'], [MUDADO, 'que se ha mudado'], [FALLIDO, 'que no se pudo resolver']]) {
    const d = await api('GET', '/api/erp/clients/' + id + '/360');
    ok(d.mapa === null, 'el cliente ' + quien + ' viaja con mapa=null');
  }

  // ── [3] LA PANTALLA: se pinta, y NADIE habla con fuera ────────────────────────────────────────
  console.log('\n[3] LA PANTALLA DEL CLIENTE CON DIRECCIÓN');
  dominios.clear(); teselas.length = 0;
  await irFicha(CON);
  await dormir(1500);   // que al mapa le dé tiempo a pedir sus teselas
  const v = await page.evaluate(id => {
    const box = document.getElementById('bff' + id + '_mapaBox');
    const enlace = box && box.querySelector('.bf-mapa-pie a');
    return {
      visible: !!box && getComputedStyle(box).display !== 'none',
      alto: box ? box.offsetHeight : 0,
      lienzo: !!(box && box.querySelector('.leaflet-container')),
      chincheta: box ? box.querySelectorAll('.leaflet-marker-icon').length : 0,
      href: enlace ? enlace.getAttribute('href') : '',
      texto: enlace ? enlace.textContent.trim() : '',
      dir: box ? (box.querySelector('.bf-mapa-pie .dir') || {}).textContent : '',
      atrib: box ? (box.querySelector('.leaflet-control-attribution') || {}).textContent || '' : '',
      xss: !!window.__xss,
    };
  }, CON);
  ok(v.visible && v.alto > 100, 'el bloque del mapa se pinta y ocupa sitio', v.alto + ' px');
  ok(v.lienzo, 'con un mapa de verdad dentro (contenedor de Leaflet)');
  ok(v.chincheta === 1, 'y UNA chincheta en el punto del cliente', String(v.chincheta));
  ok(v.dir === 'Gran Via 32, 28013, Madrid, Madrid, España', 'con la dirección al pie', v.dir);
  ok(/OpenStreetMap/.test(v.atrib), 'y la atribución de OpenStreetMap, que la licencia exige', v.atrib);
  // F3 — el enlace de ruta. En escritorio es OpenStreetMap; en el móvil, el esquema del teléfono.
  ok(v.href.indexOf('40.4205785,-3.7034263') >= 0, 'el enlace de ruta lleva el punto del cliente', v.href);
  ok(/^https:\/\/www\.openstreetmap\.org\/directions/.test(v.href), 'y en escritorio abre OpenStreetMap');
  ok(!v.xss, 'el nombre con carga XSS NO se ejecuta');
  ok(errs.length === 0, 'CERO errores de JavaScript', errs.join(' | '));

  // LA ASERCIÓN DEL MECANISMO. Si un día alguien cambia la capa de teselas por la de openstreetmap
  // directamente, aquí sale el rojo — y no en «el mapa no se ve», porque el mapa se vería igual.
  const fuera = [...dominios].filter(h => h !== slug + '.localhost:3000');
  ok(fuera.length === 0, 'abrir la ficha NO habla con NINGÚN servidor de fuera', fuera.join(', ') || 'ningún dominio ajeno');
  ok(teselas.length > 0, 'y las teselas se le piden a Bamburu', teselas.length + ' teselas por /api/erp/mapa/tesela/');

  // ── [4] LOS TRES QUE NO SE PINTAN — «nada» medido en píxeles ──────────────────────────────────
  console.log('\n[4] LOS QUE NO LLEVAN MAPA: NI HUECO, NI MAPA VACÍO');
  for (const [id, quien] of [[SIN, 'sin calle'], [MUDADO, 'que se ha mudado'], [FALLIDO, 'que no se pudo resolver']]) {
    dominios.clear(); teselas.length = 0;
    await irFicha(id);
    await dormir(600);
    const n = await page.evaluate(x => {
      const box = document.getElementById('bff' + x + '_mapaBox');
      return { hay: !!box, display: box ? getComputedStyle(box).display : '', alto: box ? box.offsetHeight : -1,
               dentro: box ? box.innerHTML.trim().length : -1 };
    }, id);
    ok(n.hay && n.display === 'none' && n.alto === 0 && n.dentro === 0,
      'el cliente ' + quien + ': la caja del mapa está vacía, oculta y ocupa CERO',
      'display=' + n.display + ' alto=' + n.alto + ' contenido=' + n.dentro);
    ok(teselas.length === 0, 'y no se pide ni una tesela para ' + quien);
  }

  // ── [5] LA RUTA DE LAS TESELAS ───────────────────────────────────────────────────────────────
  console.log('\n[5] LA RUTA DE LAS TESELAS');
  const dirT = path.join(APP, 'data', 'teselas', String(TESELA_PRUEBA.z), String(TESELA_PRUEBA.x));
  const ficheroT = path.join(dirT, TESELA_PRUEBA.y + '.png');
  if (!existsSync(ficheroT)) { mkdirSync(dirT, { recursive: true }); writeFileSync(ficheroT, PNG_1x1); teselaSembrada = ficheroT; }
  const pide = async u => page.evaluate(async u => {
    const r = await fetch(u);
    const b = r.ok ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
    return { estado: r.status, tipo: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', bytes: b.length };
  }, u);
  const buena = await pide('/api/erp/mapa/tesela/' + TESELA_PRUEBA.z + '/' + TESELA_PRUEBA.x + '/' + TESELA_PRUEBA.y);
  ok(buena.estado === 200 && /image\/png/.test(buena.tipo) && buena.bytes === PNG_1x1.length,
    'una tesela en caché se sirve de NUESTRO disco, sin salir a la red',
    buena.estado + ' ' + buena.tipo + ' ' + buena.bytes + ' bytes');
  ok(/max-age=\d{5,}/.test(buena.cache), 'con caché larga en el navegador (abrir dos veces no cuesta peticiones)', buena.cache);
  // Lo que llega de la calle. Ninguna de estas puede acabar en una petición ni en un fichero.
  for (const [u, qué] of [
    ['/api/erp/mapa/tesela/19/999999999/1', 'una x fuera del tablero de ese zoom'],
    ['/api/erp/mapa/tesela/40/1/1', 'un zoom que no existe'],
    ['/api/erp/mapa/tesela/19/-1/1', 'una coordenada negativa'],
    ['/api/erp/mapa/tesela/19/1.5/1', 'una coordenada decimal'],
    ['/api/erp/mapa/tesela/19/..%2F..%2Fetc%2Fpasswd/1', 'un intento de salir de la carpeta'],
  ]) ok((await pide(u)).estado === 404, qué + ' se rechaza con 404', u);

  // ── [6] EL ENGANCHE AL GUARDADO ──────────────────────────────────────────────────────────────
  // Guardar el cliente SIN tocar la dirección no puede volver a preguntar (ni molestar al servicio
  // de fuera, ni perder el punto que ya había). Es el camino real: el mismo servicio que usa DISA.
  console.log('\n[6] GUARDAR NO PIERDE EL PUNTO');
  const antes = db.prepare('SELECT lat,lon,huella,resuelto FROM client_geo WHERE client_id=?').get(CON);
  updateClientSvc(db, CON, { name: 'Mapa Sí', phone: '+34 611 222 333', ...DIR });
  await dormir(1200);
  const despues = db.prepare('SELECT lat,lon,huella,resuelto FROM client_geo WHERE client_id=?').get(CON);
  ok(JSON.stringify(antes) === JSON.stringify(despues),
    'guardar el cliente con la MISMA dirección conserva el punto y no vuelve a preguntar');
  const tras = db.prepare('SELECT phone FROM clients WHERE id=?').get(CON);
  ok(tras.phone === '+34 611 222 333', 'y el guardado del cliente se completa con normalidad', tras.phone);
} catch (e) { fail++; console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e)); }
finally {
  try { if (browser) await browser.close(); } catch {}
  console.log('\n[limpieza] borrando el negocio de prueba: ' + slug);
  limpiar();
  console.log('  ✓ negocio de prueba eliminado');
}
console.log('\n═════════ RESULTADO: ' + pass + ' OK · ' + fail + ' fallos ═════════');
process.exit(fail ? 1 : 0);
