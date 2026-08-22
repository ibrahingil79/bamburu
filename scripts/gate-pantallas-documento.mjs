// ════════════════════════════════════════════════════════════════════════════════════════════════
// Gate — LAS PANTALLAS QUE CUELGAN DE UN DOCUMENTO NO PUEDEN TENER ERRORES DE JAVASCRIPT
// ════════════════════════════════════════════════════════════════════════════════════════════════
// POR QUÉ NACE ESTE GATE, con nombre y fecha. El 21 ago 2026 hubo DOS pantallas MUERTAS a la vez:
// «Registrar recepción» —donde el botón de confirmar no hacía nada— y la de facturas, que reventaba
// al abrirla. Las dos por la misma causa: una cadena de JS **del navegador** escrita dentro de una
// plantilla del servidor, a la que la plantilla se come una capa de escape. La cadena se parte, el
// bloque entero es un SyntaxError y **ninguna de sus funciones llega a existir**. Los botones no
// responden y NO SALE NI UN ERROR A LA VISTA.
//
// LA DE FACTURAS LA CAZÓ `gate-menu-navegacion`, que recorre las 89 rutas del menú midiendo errores
// de JS. LA DE RECEPCIONES NO LA CAZÓ NADIE: cuelga de una orden de compra, así que no está en el
// menú y ningún gate la abría. Se descubrió por casualidad, porque otro gate reventó con un
// «confirmReceipt is not defined» que parecía un fallo del gate y no del producto.
//
// ESTE GATE CIERRA ESE HUECO: abre las pantallas que llevan un :id —las que cuelgan de un documento
// real— y exige CERO errores de JavaScript en cada una. No comprueba lo que hacen: comprueba que
// **existen y arrancan**, que es exactamente lo que faltaba.
//
// POR QUÉ NO SE HACE CON EL LINT. Se intentó, dos veces, y se midió: mirar el fuente no distingue
// una comilla de atributo HTML de una comilla que abre una cadena JS, así que avisaba en falso —y un
// aviso en falso acaba ignorándose, que es peor que no tenerlo. `lint-plantillas.mjs` sí vigila el
// caso exacto de la comilla escapada (la racha de barras lo hace preciso); lo demás se mide AQUÍ,
// sobre la pantalla de verdad.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';

let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' — ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' — ' + det : '')); }
};

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const ahora = Math.floor(Date.now() / 1000);
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, owner.id, ahora, ahora + 1800, randomBytes(32).toString('base64url'));

// ── LAS PANTALLAS, CON DE DÓNDE SALE SU DOCUMENTO ───────────────────────────────────────────────
// Cada una declara la consulta que le busca un documento REAL en el negocio. Si no hay ninguno, el
// gate NO se lo salta en silencio: lo cuenta aparte y lo dice, porque «no probado» no es «verde».
const PANTALLAS = [
  { ruta: '/admin/clients/{id}',                       sql: 'SELECT id FROM clients WHERE active=1 ORDER BY id DESC LIMIT 1' },
  { ruta: '/admin/invoices/{id}',                      sql: "SELECT id FROM invoices ORDER BY id DESC LIMIT 1" },
  // `/admin/invoices/{id}/edit` NO ESTÁ EN ESTA LISTA PORQUE NO EXISTE. La puse al inventariar, de un
  // grep que en realidad encontró la de presupuestos y la de pedidos, y me costó caro: para probarla
  // creé una «factura en borrador»… y en Bamburu las facturas NACEN EMITIDAS (los estados son
  // emitida / anulada / rectificada). O sea que fabriqué una factura de verdad, F2026-0973, que
  // hubo que ANULAR por el camino del producto — no borrar: una emitida está en la cadena de huellas
  // y esa no se toca. Antes de meter una pantalla aquí, se comprueba que su ruta existe.
  { ruta: '/admin/quotes/{id}',                        sql: 'SELECT id FROM quotes ORDER BY id DESC LIMIT 1' },
  { ruta: '/admin/quotes/{id}/edit',                   sql: "SELECT id FROM quotes WHERE status='borrador' ORDER BY id DESC LIMIT 1" },
  { ruta: '/admin/pedidos/{id}',                       sql: 'SELECT id FROM customer_orders ORDER BY id DESC LIMIT 1' },
  { ruta: '/admin/albaranes/{id}',                     sql: 'SELECT id FROM delivery_notes ORDER BY id DESC LIMIT 1' },
  { ruta: '/admin/purchase-orders/{id}',               sql: 'SELECT id FROM purchase_orders ORDER BY id DESC LIMIT 1' },
  // LA QUE ESTABA MUERTA. Va con su documento en estado de recibir, que es cuando se pinta entera.
  // OJO A LA CONSULTA: el producto solo pinta este formulario si la orden está ENVIADA, no está
  // cerrada a mano y le queda algo por recibir. Con una consulta más laxa salía una orden ya
  // recibida, el servidor REDIRIGÍA a su ficha y el gate medía otra pantalla dando verde.
  { ruta: '/admin/purchase-orders/{id}/receipts/new',  sql: "SELECT id FROM purchase_orders WHERE status='enviada' AND (received_status IS NULL OR received_status='parcial') ORDER BY id DESC LIMIT 1" },
  { ruta: '/admin/purchase-order-receipts/{id}',       sql: 'SELECT id FROM purchase_order_receipts ORDER BY id DESC LIMIT 1' },
  { ruta: '/admin/purchases/{id}',                     sql: 'SELECT id FROM purchases ORDER BY id DESC LIMIT 1' },
  { ruta: '/admin/supplier-invoices/{id}',             sql: 'SELECT id FROM supplier_invoices ORDER BY id DESC LIMIT 1' },
  { ruta: '/admin/supplier-returns/{id}',              sql: 'SELECT id FROM supplier_returns ORDER BY id DESC LIMIT 1' },
  { ruta: '/admin/stock-transfers/{id}',               sql: 'SELECT id FROM stock_transfers ORDER BY id DESC LIMIT 1' },
];

// Ruido que no es del producto: un favicon que no existe no rompe ninguna pantalla.
const RUIDO = /favicon|net::ERR_|Failed to load resource/i;

// ── SE COMPILA EL HTML CRUDO, Y ESTO COSTÓ DOS INTENTOS FALLIDOS ────────────────────────────────
// (1) Escuchar `pageerror` y `console.error` NO SIRVE: un SyntaxError de un <script> inline **no
//     emite ningún evento** que se pueda oír desde fuera. Medido: con la pantalla rota, el único
//     evento era el 404 del favicon.
// (2) Compilar lo que hay en el DOM TAMPOCO SIRVE, y esta es la buena: cuando una cadena se queda
//     sin cerrar, **el parser del navegador TRUNCA el script ahí mismo**. El texto que llega al DOM
//     está cortado —2.380 caracteres en vez de 4.888— y el trozo que queda **compila
//     perfectamente**, porque es un prefijo válido. El gate daba verde con la pantalla muerta.
// Las dos las destapó la prueba de reversión, no el razonamiento. Lo único que ve el fallo es el
// HTML **tal y como sale del servidor**, antes de que ningún parser lo arregle por su cuenta.
function scriptsDelHtml(html) {
  const fuera = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/i.test(m[1])) continue;                 // los externos no son cosa nuestra
    if (/type\s*=\s*["']?(application\/json|text\/template)/i.test(m[1])) continue;
    if (m[2].trim()) fuera.push(m[2]);
  }
  return fuera;
}
function compila(txt) {
  try { new Function(txt); return null; }
  catch (e) { return String(e.message || e); }
}

// ── EL GATE SE TRAE SUS BORRADORES ──────────────────────────────────────────────────────────────
// Las dos pantallas de edición solo existen mientras el documento está en borrador, y el negocio
// puede no tener ninguno: la primera versión de este gate se quedó sin poder probarlas y lo dijo en
// rojo, que es lo correcto —«no probado» no es «verde»— pero no basta. Se crean POR LA API del
// producto, que es la que sabe numerar y calcular, y se borran al terminar. Un borrador NO entra en
// la cadena de huellas: esa nace al emitir, y aquí no se emite nada.
const csrf = randomBytes(32).toString('base64url');
db.prepare('UPDATE admin_sessions SET csrf_token=? WHERE token=?').run(csrf, token);
const CAB = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
const creado = { quotes: [] };

async function borradorSiHaceFalta(tabla, ruta, cuerpo) {
  const ya = db.prepare("SELECT id FROM " + tabla + " WHERE status='borrador' ORDER BY id DESC LIMIT 1").get();
  if (ya) return null;
  const r = await fetch(BASE + ruta, { method: 'POST', headers: CAB, body: JSON.stringify(cuerpo) });
  const b = await r.json().catch(() => ({}));
  if (r.status >= 400 || !b.id) { console.log('    · no pude crear el borrador de ' + tabla + ': HTTP ' + r.status + ' ' + JSON.stringify(b).slice(0, 90)); return null; }
  creado[tabla].push(b.id);
  return b.id;
}

let browser;
try {
  browser = await puppeteer.launch({ ...launchOpts() });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });

  // Los borradores, antes de recorrer nada.
  const cli = db.prepare('SELECT id FROM clients WHERE active=1 ORDER BY id DESC LIMIT 1').get();
  const prod = db.prepare("SELECT id, price FROM products WHERE status='active' ORDER BY id DESC LIMIT 1").get();
  if (cli && prod) {
    const linea = { product_id: prod.id, description: 'Línea del gate de pantallas', quantity: 1,
                    unit_price: Number(prod.price) || 10, tax_rate: 21, discount_pct: 0 };
    // SOLO PRESUPUESTOS: esos sí nacen en borrador y su pantalla de edición solo existe entonces.
    // Facturas NO se crean aquí por nada del mundo — nacen emitidas y entran en la cadena.
    await borradorSiHaceFalta('quotes', '/api/erp/quotes', { client_id: cli.id, lines: [linea] });
  }

  // ── CÓMO SE MIDE, Y POR QUÉ NO BASTA CON ESCUCHAR ERRORES ─────────────────────────────────────
  // La primera versión de este gate escuchaba `pageerror` y `console.error`… y daba VERDE con la
  // pantalla ROTA. Lo destapó la prueba de reversión: al devolverle el fallo que mató «Registrar
  // recepción», el gate seguía en 15/15. Medido después: **un SyntaxError de un <script> inline NO
  // emite ningún evento** que el navegador deje escuchar desde fuera — ni error de página ni de
  // consola. El único evento de esa pantalla rota era el 404 del favicon.
  // Así que no se escucha: se COMPILA. Cada <script> sin `src` se pasa por `new Function`, que
  // lanza si el texto no es JavaScript válido. Eso sí ve la clase entera.
  console.log('\n[1] cada pantalla que cuelga de un documento arranca, y todos sus scripts COMPILAN');
  let sinDato = [];
  for (const p of PANTALLAS) {
    let fila = null;
    try { fila = db.prepare(p.sql).get(); } catch { fila = null; }
    if (!fila) { sinDato.push(p.ruta); continue; }

    const url = BASE + p.ruta.replace('{id}', fila.id);
    const errs = [];
    const onErr = e => errs.push(String((e && e.message) || e));
    const onCon = m => { if (m.type() === 'error') errs.push('console: ' + m.text()); };
    page.on('pageerror', onErr);
    page.on('console', onCon);
    let estado = 0, sinCompilar = [], scriptsDe = 0, urlFinal = '';
    try {
      const r = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      estado = r ? r.status() : 0;
      // LA URL FINAL TIENE QUE SER LA PEDIDA. Media docena de estas pantallas redirigen cuando el
      // documento no está en el estado que necesitan, y una redirección también responde 200: sin
      // esta comprobación el gate mide OTRA pantalla y da verde por ella. Le pasó justo aquí.
      urlFinal = page.url();
      await new Promise(res => setTimeout(res, 250));
      const crudo = await (await fetch(url, { headers: { Cookie: 'asess=' + token } })).text();
      const trozos = scriptsDelHtml(crudo);
      scriptsDe = trozos.length;
      sinCompilar = trozos.map(compila).filter(Boolean);
    } catch (e) { errs.push('no cargó: ' + e.message); }
    page.off('pageerror', onErr);
    page.off('console', onCon);

    const malos = errs.filter(x => !RUIDO.test(x));
    const dondeToca = urlFinal.replace(/[?#].*$/, '').endsWith(p.ruta.replace('{id}', fila.id));
    ok(estado === 200 && dondeToca && malos.length === 0 && sinCompilar.length === 0, p.ruta,
       (dondeToca ? '' : 'REDIRIGIÓ a ' + urlFinal.replace(BASE, '') + ' · ') +
       'HTTP ' + estado
       + (sinCompilar.length ? ' · SCRIPT QUE NO COMPILA: ' + sinCompilar[0].slice(0, 95) : '')
       + (malos.length ? ' · ' + malos.slice(0, 2).join(' | ').slice(0, 90) : '')
       + (!sinCompilar.length && !malos.length ? ' · ' + scriptsDe + ' scripts, todos compilan' : ''));
  }

  // NO PROBADO NO ES VERDE. Si el negocio no tiene un documento de algún tipo, se dice: así el
  // recuento del gate nunca engorda con pantallas que en realidad no se han abierto.
  ok(sinDato.length === 0, 'todas las pantallas tenían un documento con el que probarse',
     sinDato.length ? 'sin dato: ' + sinDato.join(', ') : 'las ' + PANTALLAS.length);

  // ── [2] Y EL MECANISMO, NO SOLO EL RESULTADO ──────────────────────────────────────────────────
  // Un gate que solo mira «no hubo errores» puede estar verde porque no está mirando. Se comprueba
  // que la vía por la que mira SÍ ve un error cuando lo hay: se inyecta uno en una página en blanco.
  console.log('\n[2] la comprobación no está verde por no mirar');
  // LA SONDA QUE IMPORTA: reproduce EXACTAMENTE el fallo real —una cadena partida por un salto de
  // línea, que es lo que deja una plantilla al comerse un escape— y exige que el mecanismo lo vea.
  const roto = '<html><body><script>\nvar a = 1;\nvar codes = x.split(\'\nzz\');\n<\/script></body></html>';
  const cazado = scriptsDelHtml(roto).map(compila).filter(Boolean);
  ok(cazado.length > 0, 'una cadena partida por un salto de línea SÍ la caza el gate', cazado[0] ? cazado[0].slice(0, 60) : 'NO la caza');
  // Y que no cante en falso con una pantalla sana.
  const sano = '<html><body><script>function f(){ return "ok"; }<\/script></body></html>';
  ok(scriptsDelHtml(sano).map(compila).filter(Boolean).length === 0, 'y no canta en falso con un script sano');

} catch (e) {
  console.error('ERROR en el gate:', e.stack || e.message);
  fail++;
} finally {
  try { await browser.close(); } catch {}
  const db2 = new Database(DB_PATH);
  // Lo que trajo el gate se lo lleva el gate: los borradores que creó, por id, hijos antes que padres.
  for (const id of creado.quotes) {
    try { db2.prepare('DELETE FROM quote_lines WHERE quote_id=?').run(id); } catch {}
    try { db2.prepare("DELETE FROM quotes WHERE id=? AND status='borrador'").run(id); } catch {}
  }
  if (creado.quotes.length) console.log('  (limpieza: ' + creado.quotes.length + ' presupuesto(s) de prueba)');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
  console.log('\n──────────────────────────────');
  console.log((fail === 0 ? '✓ GATE VERDE' : '✗ GATE ROJO') + ' — ' + pass + ' pasan · ' + fail + ' fallan');
  console.log(pass + ' OK · ' + fail + ' fallos');
  process.exit(fail === 0 ? 0 : 1);
}
