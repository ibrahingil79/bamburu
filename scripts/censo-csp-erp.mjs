#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DEL CÓDIGO INCRUSTADO DEL PANEL — cuánto queda para poder endurecer la CSP de /admin.
//
// PARA QUÉ. La ficha `csp-erp-migrar-handlers` (lo que el código llama C4b-4) no se puede planificar
// con un `grep`: en esta misma ficha el grep ya mintió dos veces (los «58» que eran 43; 12 puntos en
// código muerto; y el «8» de la ficha madre, que eran 6 comentarios). Lo único que cuenta es **el
// HTML que el servidor MANDA**, pantalla por pantalla.
//
// QUÉ CUENTA, por pantalla:
//   · handlers de atributo  — onclick=, onchange=, onsubmit=… Son los que un nonce NO cubre y los
//                             que, al endurecer, se quedan MUDOS sin avisar. Fallan al pulsar.
//   · bloques en línea      — <script> sin src y sin nonce. Un nonce los arregla de un plumazo.
//   · enlaces javascript:   — href="javascript:…", que la CSP estricta también bloquea.
//
// EL ORDEN QUE PROPONE es de menos a más: las pantallas pequeñas se cierran enteras y rápido, y
// validan el patrón antes de meterse en las cargadas.
//
//   node scripts/censo-csp-erp.mjs             → el censo entero
//   node scripts/censo-csp-erp.mjs --pendientes → solo lo que aún no está endurecido
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { tenantDb } from './lib/gate-env.mjs';
import { MENU, CONFIG_NEGOCIO, FIJAS, CUENTA, condicionesConfig } from '../modules/erp/menu.js';

const SLUG = 'desarrollo-bamburu';
const BASE = 'https://' + SLUG + '.bamburu.com';

const db = new Database(tenantDb(SLUG));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok = 'censo-csp-' + randomBytes(16).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(16).toString('hex'));

const rutas = [];
const meter = h => { if (h && h.startsWith('/admin') && !rutas.includes(h)) rutas.push(h); };
const CONDS = condicionesConfig(db);
const rec = l => { for (const it of (l || [])) { if (Array.isArray(it)) { rec(it); continue; }
  if (!it || typeof it !== 'object') continue;
  if (it.siHay && CONDS[it.siHay] !== true) continue;
  meter(it.href); if (it.items) rec(it.items); } };
rec(MENU); rec(CONFIG_NEGOCIO); rec(FIJAS); rec(CUENTA);
for (const extra of ['/admin/migracion/importar', '/admin/crm/cola', '/admin/crm/tareas', '/admin/fichaje',
  '/admin/descuentos', '/admin/invoices/new', '/admin/quotes/new', '/admin/pedidos/new']) meter(extra);
const uno = s => { try { return db.prepare(s).get(); } catch { return null; } };
for (const [tabla, ruta] of [['clients','clients'], ['invoices','invoices'], ['quotes','quotes'],
  ['customer_orders','pedidos'], ['delivery_notes','albaranes'], ['purchase_orders','purchase-orders'],
  ['purchases','purchases'], ['supplier_invoices','supplier-invoices'], ['supplier_returns','supplier-returns'],
  ['stock_transfers','stock-transfers'], ['purchase_order_receipts','purchase-order-receipts']]) {
  const r = uno(`SELECT id FROM ${tabla} ORDER BY id ASC LIMIT 1`);
  if (r) meter(`/admin/${ruta}/${r.id}`);
}

const NO_RASTREAR = /\/(logout|export|imprimir|pdf|descargar|csv|nuevo-tenant)(\/|$|\?)/i;
const cookie = 'asess=' + tok;
async function conRastreo(semilla) {
  const vistas = new Set(semilla);
  for (const ruta of [...semilla]) {
    let html = '';
    try { const r = await fetch(BASE + ruta, { headers: { cookie } }); if (r.status !== 200) continue; html = await r.text(); }
    catch { continue; }
    for (const m of html.matchAll(/href="(\/admin[^"#?]*)"/g)) {
      const h = m[1].replace(/\/$/, '');
      if (/['"+${}\\]|\s/.test(h)) continue;
      if (!h || vistas.has(h) || NO_RASTREAR.test(h)) continue;
      vistas.add(h);
    }
  }
  return [...vistas];
}

// Los handlers se cuentan FUERA de los bloques de código: dentro de un <script> un `onclick=` es
// una asignación de JavaScript, no un atributo del HTML, y contarlo hincharía la cifra.
function contar(html) {
  const sinScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const handlers = [...sinScripts.matchAll(/\son([a-z]+)\s*=\s*["']/gi)].map(m => 'on' + m[1].toLowerCase());
  const enLinea = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/gi)].filter(m => !/\bnonce=/i.test(m[1]));
  const conNonce = [...html.matchAll(/<script[^>]*\bnonce=/gi)];
  const jsHref = [...sinScripts.matchAll(/href\s*=\s*["']javascript:/gi)];
  const cuenta = {};
  for (const h of handlers) cuenta[h] = (cuenta[h] || 0) + 1;
  return { handlers: handlers.length, tipos: cuenta, enLinea: enLinea.length, conNonce: conNonce.length, jsHref: jsHref.length };
}

const filas = [];
try {
  const lista = await conRastreo(rutas);
  for (const ruta of lista) {
    let html = '', status = 0;
    try { const r = await fetch(BASE + ruta, { headers: { cookie } }); status = r.status; html = await r.text(); }
    catch { continue; }
    if (status !== 200) continue;
    const c = contar(html);
    filas.push({ ruta, ...c, total: c.handlers + c.enLinea + c.jsHref });
  }
} finally {
  db.prepare("DELETE FROM admin_sessions WHERE token LIKE 'censo-csp-%'").run();
  db.close();
}

filas.sort((a, b) => a.total - b.total || a.ruta.localeCompare(b.ruta));
const limpias = filas.filter(f => f.total === 0);
const sucias = filas.filter(f => f.total > 0);

console.log('\n═══ CENSO DEL CÓDIGO INCRUSTADO DE /admin (sobre el HTML SERVIDO) ═══\n');
console.log(`  pantallas alcanzadas: ${filas.length}`);
console.log(`  ya limpias (0 handlers, 0 bloques sin nonce): ${limpias.length}`);
console.log(`  con algo que migrar: ${sucias.length}\n`);
console.log('  ORDEN DE TRABAJO PROPUESTO — de menos a más:\n');
console.log('     handlers  bloques  js:  pantalla');
for (const f of sucias) {
  console.log(`     ${String(f.handlers).padStart(8)}  ${String(f.enLinea).padStart(7)}  ${String(f.jsHref).padStart(3)}  ${f.ruta}`);
}
const T = sucias.reduce((a, f) => ({ h: a.h + f.handlers, b: a.b + f.enLinea, j: a.j + f.jsHref }), { h: 0, b: 0, j: 0 });
console.log(`\n     ${String(T.h).padStart(8)}  ${String(T.b).padStart(7)}  ${String(T.j).padStart(3)}  ── TOTAL`);
if (limpias.length) {
  console.log('\n  YA LIMPIAS (se pueden endurecer sin migrar nada):');
  for (const f of limpias) console.log('     · ' + f.ruta);
}
const tipos = {};
for (const f of sucias) for (const [k, v] of Object.entries(f.tipos)) tipos[k] = (tipos[k] || 0) + v;
console.log('\n  QUÉ HANDLERS SON, por tipo:');
for (const [k, v] of Object.entries(tipos).sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(5)}  ${k}`);
