#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL LINT QUE FALTABA — comprueba el JavaScript **tal y como llega al navegador**.
//
// DE DÓNDE SALE (24 ago 2026, punto 14). Al quitar las ventanitas (punto 7) convertí un `confirm()`
// en `await window.confirmarEnPagina(...)` dentro de una función que NO era `async`. Eso es un ERROR
// DE SINTAXIS, y un error de sintaxis **mata el bloque entero** de JavaScript de la pantalla: no la
// función, la pantalla. **El importador estuvo muerto varias horas.** Y no lo cazó nada:
//   · `node --check` valida el fichero del SERVIDOR, donde ese JS es solo texto dentro de una
//     plantilla: para él no hay ningún `await`, hay una cadena;
//   · `lint-plantillas.mjs` busca backticks sueltos y escapes comidos, no sintaxis;
//   · el barrido de pantallas del punto 7 miró las 47 entradas del MENÚ, y el importador no es una:
//     cuelga de /admin/migracion/importar, que es una subruta. Por ahí se coló.
//
// LO QUE HACE: pide cada pantalla al servidor con sesión de dueño, saca sus `<script>` en línea y
// le pasa `node --check` a cada uno. Es el único sitio donde ese JS es JS de verdad.
//
//   node scripts/lint-js-servido.mjs            → recorre todas las pantallas
//   node scripts/lint-js-servido.mjs /admin/x   → solo esa
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { tenantDb } from './lib/gate-env.mjs';
import { MENU, CONFIG_NEGOCIO, FIJAS, CUENTA } from '../modules/erp/menu.js';

const SLUG = 'desarrollo-bamburu';
const BASE = 'https://' + SLUG + '.bamburu.com';
const SOLO = process.argv.slice(2).filter(a => a.startsWith('/admin'));

const db = new Database(tenantDb(SLUG));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const tok = 'lint-js-' + randomBytes(16).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 1800, randomBytes(16).toString('hex'));

// TODAS las pantallas: las del menú, las de detalle Y LAS SUBRUTAS QUE NO CUELGAN DEL MENÚ, que son
// justo por donde se coló la que rompió. Enumerarlas a mano es feo; no enumerarlas es peor.
const rutas = [];
const meter = h => { if (h && h.startsWith('/admin') && !rutas.includes(h)) rutas.push(h); };
const rec = l => { for (const it of (l || [])) { if (Array.isArray(it)) { rec(it); continue; }
  if (!it || typeof it !== 'object') continue; meter(it.href); if (it.items) rec(it.items); } };
rec(MENU); rec(CONFIG_NEGOCIO); rec(FIJAS); rec(CUENTA);
for (const extra of [
  '/admin/migracion/importar',      // ← la que se coló
  '/admin/crm/cola', '/admin/crm/tareas', '/admin/fichaje', '/admin/descuentos',
  '/admin/invoices/new', '/admin/quotes/new', '/admin/pedidos/new',
]) meter(extra);
const uno = s => { try { return db.prepare(s).get(); } catch { return null; } };
for (const [tabla, ruta] of [['clients', 'clients'], ['invoices', 'invoices'], ['quotes', 'quotes'],
  ['customer_orders', 'pedidos'], ['delivery_notes', 'albaranes'], ['purchase_orders', 'purchase-orders'],
  ['purchases', 'purchases'], ['supplier_invoices', 'supplier-invoices'], ['supplier_returns', 'supplier-returns'],
  ['stock_transfers', 'stock-transfers'], ['purchase_order_receipts', 'purchase-order-receipts']]) {
  const r = uno(`SELECT id FROM ${tabla} ORDER BY id DESC LIMIT 1`);
  if (r) meter(`/admin/${ruta}/${r.id}`);
}
const lista = SOLO.length ? SOLO : rutas;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lintjs-'));
let bloques = 0, rotos = 0, pantallas = 0;
const malas = [];
for (const ruta of lista) {
  let html = '', status = 0;
  try { const r = await fetch(BASE + ruta, { headers: { cookie: 'asess=' + tok } }); status = r.status; html = await r.text(); }
  catch (e) { malas.push({ ruta, err: 'no responde: ' + e.message }); continue; }
  if (status !== 200) { malas.push({ ruta, err: 'HTTP ' + status }); continue; }
  pantallas++;
  let i = 0;
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const js = m.group ? m.group(1) : m[1];
    if (!js || !js.trim()) continue;
    bloques++;
    const f = path.join(tmp, 'b' + (i++) + '.js');
    fs.writeFileSync(f, js);
    try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); }
    catch (e) {
      rotos++;
      const err = String(e.stderr || '').split('\n').filter(Boolean);
      // La línea del error, situada dentro del bloque: es lo único que sirve para encontrarlo.
      const detalle = err.slice(0, 4).map(x => x.trim()).filter(x => x && !x.startsWith('at ')).join(' | ');
      malas.push({ ruta, bloque: i, err: detalle.slice(0, 200) });
    }
  }
  process.stdout.write(rotos ? '✗' : '.');
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
db.prepare("DELETE FROM admin_sessions WHERE token LIKE 'lint-js-%'").run();
db.close();

console.log('\n');
if (malas.length) {
  console.error('JAVASCRIPT ROTO EN LO QUE SE SIRVE — la pantalla entera se queda muerta:\n');
  for (const m of malas) console.error('  ✗ ' + m.ruta + (m.bloque ? '  (bloque ' + m.bloque + ')' : '') + '\n      ' + m.err);
  console.error('\n' + rotos + ' bloque(s) roto(s) en ' + pantallas + ' pantallas · ' + bloques + ' bloques mirados');
  process.exit(1);
}
console.log('✓ ' + pantallas + ' pantallas · ' + bloques + ' bloques de JavaScript en línea: todos válidos.');
