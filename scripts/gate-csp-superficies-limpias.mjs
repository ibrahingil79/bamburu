#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NINGUNA PANTALLA ENDURECIDA PUEDE TENER CÓDIGO EN UN ATRIBUTO — la red que faltaba.
//
// DE DÓNDE SALE (5 sep 2026, y costó tres pantallas). Se endurecieron `/admin/purchases/<id>` y
// `/admin/supplier-returns/<id>` POR FORMA, después de ver limpias las que salían en el censo. Pero
// esas plantillas tienen botones CONDICIONALES —el de anular solo se pinta si el documento está en
// cierto estado— y el censo muestreó documentos que no lo mostraban. Resultado: tres fichas quedaron
// endurecidas CON un handler vivo, y su botón de anular estuvo MUERTO, en silencio. Es exactamente
// el fallo que esta ficha existe para impedir, cometido por quien la estaba haciendo.
//
// LO QUE VIGILA. Recorre TODAS las pantallas del panel que hoy reciben la política estricta y exige
// que su HTML servido no traiga NI UN handler de atributo ni un bloque sin nonce. No mide el código:
// mide lo que sale por el cable, que es donde vivía la trampa.
//
// LO QUE NO PUEDE VER, y hay que decirlo. Dos cosas:
//   · un documento en un estado que no exista hoy en el negocio de desarrollo;
//   · y —lección del 4 sep 2026— **un handler que se pinte DESDE JavaScript**. El buscador de línea
//     (`views/line-search.js`) monta su campo con `insertAdjacentHTML`, así que sus `oninput=` NO
//     salían por el cable: este gate daba verde y `/admin/pedidos/new` llevaba con el buscador MUDO
//     desde que se endureció. Eso solo lo ve un navegador de verdad mirando el DOM ya montado, y
//     por eso vive en `gate-csp-estricta.mjs` [12b], que TECLEA y exige sugerencias.
// Por eso la regla que acompaña a esto está escrita en `core/security-headers.js`:
// **una regla POR FORMA solo vale si TODAS las pantallas de esa forma están limpias EN TODOS SUS
// ESTADOS.** Mientras una plantilla tenga handlers condicionales, sus fichas van de una en una.
//
//   node scripts/gate-csp-superficies-limpias.mjs
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { tenantDb } from './lib/gate-env.mjs';
import { MENU, CONFIG_NEGOCIO, FIJAS, CUENTA, condicionesConfig } from '../modules/erp/menu.js';

const SLUG = 'desarrollo-bamburu';
const BASE = 'https://' + SLUG + '.bamburu.com';
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✓ ' + m + (d ? ' · ' + d : '')); }
                          else { fail++; console.error('  ✗ FALLO: ' + m + (d ? ' · ' + d : '')); } };

const db = new Database(tenantDb(SLUG));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok = 'gate-csplimpias-' + randomBytes(12).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(12).toString('hex'));

// Las rutas se enumeran igual que el censo: menú + subrutas + un documento de cada tipo + rastreo.
const rutas = [];
const meter = h => { if (h && h.startsWith('/admin') && !rutas.includes(h)) rutas.push(h); };
const CONDS = condicionesConfig(db);
const rec = l => { for (const it of (l || [])) { if (Array.isArray(it)) { rec(it); continue; }
  if (!it || typeof it !== 'object') continue;
  if (it.siHay && CONDS[it.siHay] !== true) continue;
  meter(it.href); if (it.items) rec(it.items); } };
rec(MENU); rec(CONFIG_NEGOCIO); rec(FIJAS); rec(CUENTA);
for (const extra of ['/admin/migracion/importar', '/admin/crm/cola', '/admin/crm/tareas', '/admin/fichaje',
  '/admin/descuentos', '/admin/analytics', '/admin/vigia', '/admin/suscripcion', '/admin/settings/avisos']) meter(extra);
// Documentos: TODOS los que haya de cada tipo, no uno — el estado es justo lo que cambia el HTML.
const uno = s => { try { return db.prepare(s).all(); } catch { return []; } };
for (const [tabla, ruta] of [['clients','clients'], ['invoices','invoices'], ['quotes','quotes'],
  ['customer_orders','pedidos'], ['delivery_notes','albaranes'], ['purchase_orders','purchase-orders'],
  ['purchases','purchases'], ['supplier_returns','supplier-returns'], ['stock_transfers','stock-transfers'],
  ['portal_mensajes','portal/mensajes']]) {
  for (const r of uno(`SELECT id FROM ${tabla} ORDER BY id LIMIT 40`)) meter(`/admin/${ruta}/${r.id}`);
}
// Y las pantallas de ALTA y EDICIÓN, que tienen reglas propias desde el 4 sep 2026 y no cuelgan del
// menú: sin esto quedarían endurecidas y sin vigilar.
for (const ruta of ['quotes', 'pedidos', 'albaranes', 'supplier-returns', 'purchase-orders', 'purchases']) {
  meter(`/admin/${ruta}/new`);
}
for (const [tabla, ruta] of [['quotes','quotes'], ['purchase_orders','purchase-orders']]) {
  for (const r of uno(`SELECT id FROM ${tabla} ORDER BY id LIMIT 8`)) meter(`/admin/${ruta}/${r.id}/edit`);
}

const cookie = 'asess=' + tok;
const sucias = [];
let endurecidas = 0, miradas = 0;
try {
  for (const ruta of rutas) {
    let r, html;
    try { r = await fetch(BASE + ruta, { headers: { cookie } }); html = await r.text(); } catch { continue; }
    if (r.status !== 200) continue;
    miradas++;
    const csp = r.headers.get('content-security-policy') || '';
    const estricta = /script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp);
    if (!estricta) continue;
    endurecidas++;
    const sinScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    const handlers = (sinScripts.match(/\son[a-z]+\s*=\s*["']/gi) || []).length;
    const sinNonce = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/gi)].filter(m => !/\bnonce=/i.test(m[1])).length;
    if (handlers || sinNonce) sucias.push(`${ruta} (${handlers} handlers, ${sinNonce} bloques)`);
  }
} finally {
  db.prepare("DELETE FROM admin_sessions WHERE token LIKE 'gate-csplimpias-%'").run();
  db.close();
}

console.log(`\n  pantallas miradas: ${miradas} · endurecidas: ${endurecidas}\n`);
ok(endurecidas > 0, 'hay pantallas endurecidas que vigilar', String(endurecidas));
ok(sucias.length === 0,
   'NINGUNA pantalla endurecida sirve código en un atributo ni un bloque sin nonce',
   sucias.length ? sucias.length + ' sucias · la 1ª: ' + sucias[0] : '');
for (const s of sucias.slice(0, 10)) console.error('      · ' + s);

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
