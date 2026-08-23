#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FICHA I3 — «listar pantalla por pantalla y no dar por hecho ninguna».
//
// Esto NO adivina leyendo el código: ABRE cada pantalla del menú en un navegador de verdad con
// sesión de dueño y MIDE sobre píxeles. Dos cosas por pantalla:
//
//   (1) QUÉ COMPONENTE DE TARJETA usa hoy, si usa alguno: el nuevo (`.bf-card`), el viejo (`.kpi`) o
//       uno casero. Es lo que I1 tiene que unificar.
//   (2) CUÁNTAS CAJAS TIENEN EL TEXTO PEGADO AL BORDE: una `.card` sin `.card-body` dentro no tiene
//       relleno ninguno —el global `.card` no lo lleva— y su contenido toca el marco. Es la lección
//       del 19 ago 2026 que el TABLERO manda arrastrar hasta aquí: aquel gate medía solo `.bf-card`
//       y no la pantalla que lo rodea, y se comieron 17 sitios así.
//
//   node scripts/inventario-tarjetas.mjs            → tabla por pantalla
//   node scripts/inventario-tarjetas.mjs --json     → para otro script
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { MENU, CONFIG_NEGOCIO, FIJAS, CUENTA } from '../modules/erp/menu.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const JSON_OUT = process.argv.includes('--json');
const db = new Database(tenantDb(SLUG));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok = 'inv-tarjetas-' + randomBytes(16).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(16).toString('hex'));

// Todas las entradas del menú, sin excepción, y además las pantallas de DETALLE, que no cuelgan del
// menú y son justo donde vive hoy el componente nuevo. No dar por hecho ninguna incluye a esas.
const pantallas = [];
const meter = (href, label, area) => { if (href && href.startsWith('/admin') && !pantallas.some(p => p.href === href)) pantallas.push({ href, label, area }); };
const recorrer = (lista, area) => { for (const it of (lista || [])) {
  if (Array.isArray(it)) { recorrer(it, area); continue; }
  if (!it || typeof it !== 'object') continue;
  meter(it.href, it.label, it.area || area || '—');
  if (it.items) recorrer(it.items, it.label || area);
  if (it.hijos) recorrer(it.hijos, it.label || area);
} };
recorrer(MENU, null);
recorrer(CONFIG_NEGOCIO, 'Configuración del negocio');
recorrer(FIJAS, 'Fijas');
recorrer(CUENTA, 'Cuenta');

const uno = (sql) => { try { return db.prepare(sql).get(); } catch { return null; } };
// Las de DETALLE se buscan por su tabla: productos, proyectos y proveedores NO tienen pantalla
// propia (se editan en ventana desde su lista), así que pedirlas daría un 404 y contarlo como
// «pantalla rota» sería falso. Solo entran las que existen de verdad.
const det = [
  ['clients', 'Ficha de cliente'], ['invoices', 'Ficha de factura'], ['quotes', 'Ficha de presupuesto'],
  ['customer_orders', 'Ficha de pedido'], ['delivery_notes', 'Ficha de albarán'],
  ['purchase_orders', 'Ficha de orden de compra'], ['purchases', 'Ficha de compra directa'],
  ['supplier_invoices', 'Ficha de factura recibida'], ['supplier_returns', 'Ficha de devolución'],
];
const RUTA = { clients: 'clients', invoices: 'invoices', quotes: 'quotes', customer_orders: 'pedidos',
  delivery_notes: 'albaranes', purchase_orders: 'purchase-orders', purchases: 'purchases',
  supplier_invoices: 'supplier-invoices', supplier_returns: 'supplier-returns' };
for (const [tabla, label] of det) {
  const r = uno(`SELECT id FROM ${tabla} ORDER BY id DESC LIMIT 1`);
  if (r) meter(`/admin/${RUTA[tabla]}/${r.id}`, label + ' (detalle)', 'DETALLE');
}

const MEDIR = () => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const n = s => document.querySelectorAll(s).length;
  // ── EL TEXTO PEGADO AL BORDE, MEDIDO EN PÍXELES ─────────────────────────────────────────────────
  // No basta con mirar el relleno de la caja: una `.card` que solo envuelve una TABLA debe ir a
  // borde, porque las celdas traen el suyo. Lo que está mal es la PROSA y los CAMPOS pegados al
  // marco. Así que se mide la distancia real de cada trozo de contenido al borde de su caja, y se
  // deja fuera todo lo que viva dentro de una tabla.
  const pegadas = []; const aBorde = [];
  for (const c of document.querySelectorAll('.card')) {
    if (!vis(c)) continue;
    if (c.querySelector(':scope > .card-body, :scope > .card-head')) continue;
    // Una caja que declara `padding:0` en su propio style es el autor diciendo A PROPÓSITO que lo
    // de dentro va a borde: la rejilla de la agenda, un calendario. No se cuenta como fallo, pero
    // TAMPOCO se calla — se dice cuántas hay, para que nadie confunda «no aparece» con «no existe».
    if (/padding\s*:\s*0/.test(c.getAttribute('style') || '')) { aBorde.push(1); continue; }
    const rc = c.getBoundingClientRect();
    let peor = 999, muestra = '';
    for (const el of c.querySelectorAll('p, h1, h2, h3, h4, h5, label, input, select, textarea, button, li, span, div')) {
      if (el.closest('table')) continue;                 // la tabla va a borde a propósito
      if (!vis(el)) continue;
      if (el.querySelector('table')) continue;           // contenedores de tabla, no contenido
      const t = (el.innerText || el.value || el.placeholder || '').trim();
      if (!t) continue;
      const r = el.getBoundingClientRect();
      const g = Math.min(r.left - rc.left, rc.right - r.right, r.top - rc.top, rc.bottom - r.bottom);
      // Una distancia NEGATIVA no es texto pegado: es contenido que se ha ido FUERA de la caja
      // porque hay un panel con barra de desplazamiento dentro (la rejilla de la agenda, por
      // ejemplo). Eso no es un fallo de relleno y contarlo sería un rojo inventado.
      if (g < 0) continue;
      if (g < peor) { peor = g; muestra = t.slice(0, 42).replace(/\s+/g, ' '); }
    }
    if (peor < 8) pegadas.push(muestra + ' [' + Math.round(peor) + 'px]');
  }
  return {
    bf: n('.bf-card'), kpi: n('.kpi'), cifra: n('.cifra'), num: n('.num'),
    card: n('.card'), pegadas: pegadas.length, ejemplos: pegadas.slice(0, 3), aBorde: aBorde.length,
    titulo: (document.querySelector('h1,h2')?.innerText || '').trim().slice(0, 40),
  };
};

const browser = await puppeteer.launch(launchOpts());
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
const filas = [];
for (const p of pantallas) {
  let r = { status: 0, err: '' }, m = { bf: 0, kpi: 0, cifra: 0, num: 0, card: 0, pegadas: 0, ejemplos: [], aBorde: 0, titulo: '' };
  try {
    const resp = await page.goto(BASE + p.href, { waitUntil: 'networkidle0', timeout: 45000 });
    r.status = resp ? resp.status() : 0;
    await new Promise(x => setTimeout(x, 700));
    r.url = page.url().replace(BASE, '');
    m = await page.evaluate(MEDIR);
  } catch (e) { r.err = e.message.slice(0, 60); }
  filas.push({ ...p, ...r, ...m });
  if (!JSON_OUT) process.stdout.write('.');
}
await browser.close();
db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok);
db.close();

if (JSON_OUT) { console.log(JSON.stringify(filas, null, 1)); process.exit(0); }

console.log(`\n\nPANTALLAS MEDIDAS EN UN NAVEGADOR DE VERDAD: ${filas.length}   (sesión de dueño, 1440 px)\n`);
console.log('  ' + 'PANTALLA'.padEnd(32) + 'RUTA'.padEnd(30) + 'HTTP  bf   kpi cifra num  .card  PEGADAS');
console.log('  ' + '─'.repeat(112));
for (const f of filas) {
  console.log('  ' + String(f.label || '').slice(0, 30).padEnd(32) + f.href.slice(0, 28).padEnd(30) +
    String(f.status || f.err).padEnd(6) + String(f.bf).padStart(3) + String(f.kpi).padStart(6) +
    String(f.cifra).padStart(6) + String(f.num).padStart(5) + String(f.card).padStart(6) +
    (f.pegadas ? ('   ⚠ ' + f.pegadas) : '   ·'));
}
const lista = fn => filas.filter(fn).map(f => f.href).join(', ') || '—';
console.log('\nRESUMEN — LO QUE I1 TIENE QUE UNIFICAR');
console.log(`  · pantallas que abren bien .............. ${filas.filter(f => f.status === 200).length} de ${filas.length}`);
console.log(`  · con el componente NUEVO (.bf-card) .... ${filas.filter(f => f.bf).length}  → ${lista(f => f.bf)}`);
console.log(`  · con el VIEJO (.kpi) .................. ${filas.filter(f => f.kpi).length}  → ${lista(f => f.kpi)}`);
console.log(`  · con tarjetas CASERAS ................. ${filas.filter(f => f.num).length}  → ${lista(f => f.num)}`);
console.log(`  · (.cifra NO es una tarjeta: es la cifra dentro de una línea de DISA en el Inicio) ${filas.filter(f => f.cifra).length}`);
console.log(`  · SIN ninguna tarjeta de cifras ......... ${filas.filter(f => !f.bf && !f.kpi && !f.cifra && !f.num).length}`);
console.log('\nRESUMEN — EL TEXTO PEGADO AL BORDE (la lección del 19 ago)');
const conPeg = filas.filter(f => f.pegadas);
console.log(`  · pantallas con al menos una caja pegada  ${conPeg.length}`);
console.log(`  · cajas pegadas en total ............... ${filas.reduce((a, f) => a + f.pegadas, 0)}`);
for (const f of conPeg) console.log(`     ${String(f.pegadas).padStart(3)} · ${f.href}  ${f.ejemplos.join(' | ')}`);
console.log(`  · cajas DEJADAS FUERA por declarar padding:0 (van a borde a propósito): ${filas.reduce((a, f) => a + (f.aBorde || 0), 0)}`);
