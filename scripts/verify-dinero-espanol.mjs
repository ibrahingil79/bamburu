#!/usr/bin/env node
//
// verify-dinero-espanol.mjs — EL DINERO Y LAS FECHAS, ESCRITOS COMO EN ESPAÑA.
//
// LA REGLA: un importe se escribe `117.087,43 €` — miles con punto, decimales con COMA, símbolo
// DETRÁS y separado. Nunca `€117087.43`, ni `€-1461.93`, ni `1234.56 €`. Y una fecha en pantalla se
// escribe `24/08/2026`, no `2026-08-24`.
//
// SE MIDE SOBRE LO SERVIDO, no sobre el código. Es la única forma de que valga: el código tiene
// `toFixed(2)` legítimos —el valor de un campo, el cuerpo de una petición, una comparación— que NO
// son dinero en pantalla y que romperlos sí sería un fallo. Lo que se prohíbe es lo que LEE UNA
// PERSONA. Por eso esto pide las pantallas y mira el texto que sale.
//
// DE DÓNDE SALE: el 24 ago 2026 convivían las dos formas en el mismo producto — `117.087,43 €` en el
// Inicio y `€117087.43` en Cobros, Stock y Rentabilidad, con quince ayudantes distintos repartidos
// por las pantallas. Ahora hay UNO (`window.eur` en layout.js, `fmtEur` en el servidor) y esto cae
// si vuelve a colarse otro.
//
//   node scripts/verify-dinero-espanol.mjs
//   node scripts/verify-dinero-espanol.mjs /admin/cobros      # una pantalla suelta
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tenantDb, exigeCodigoServido } from './lib/gate-env.mjs';
import { MENU, CONFIG_NEGOCIO, FIJAS, CUENTA } from '../modules/erp/menu.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'desarrollo-bamburu';
// Por el subdominio real: el negocio se resuelve por el host, y `fetch` no deja poner la
// cabecera Host a mano (la ignora). Es como llega el navegador.
const BASE = 'https://' + SLUG + '.bamburu.com';
exigeCodigoServido();

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

// ── LO QUE ESTÁ PROHIBIDO EN PANTALLA ───────────────────────────────────────────────────────────
// 1. El símbolo DELANTE del número: €117087.43 · € 1.234,56 · $99.90
// 2. Un importe con PUNTO decimal y el símbolo detrás: 1234.56 €
// Se exige que haya dos decimales para no marcar un «€ 20» de un texto suelto ni una versión «v1.2».
// El símbolo y el número, PEGADOS (sin saltos de línea entre medias): un «€» de cabecera de
// columna con los números debajo no es un importe mal escrito, y marcarlo sería ruido.
// PEGADOS, con UN espacio como mucho. Con dos espacios lo que hay casi siempre es el final de un
// importe bien escrito («0,00 €») y el principio del campo siguiente («10% por defecto»): marcarlo
// era ruido, y una comprobación que grita en falso se acaba ignorando. Comprobado en /admin/crm y
// en /admin/contabilidad antes de aflojar nada.
const SIMBOLO_DELANTE = /[€$£] ?-?\d[\d.,]*\d/g;
const PUNTO_DECIMAL   = /-?\d+\.\d{2}\s*[€$£]/g;
// Una fecha en formato inglés a la vista (2026-08-24). Se permite dentro de atributos (value, data-*)
// porque ahí es un DATO que alguien vuelve a leer, no texto para una persona.
const FECHA_ISO_VISIBLE = /(^|[^\w-])(\d{4}-\d{2}-\d{2})([^\w-]|$)/;

const db = new Database(tenantDb(SLUG));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ ABORTADO: no hay dueño activo'); process.exit(2); }
const ahora = Math.floor(Date.now() / 1000);
const tok = 'zz-dinero-' + randomBytes(20).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 900, randomBytes(20).toString('hex'));

// Las pantallas: las del menú más las fichas de detalle. Mismo criterio que `lint-js-servido`.
const SOLO = process.argv.slice(2).filter(a => a.startsWith('/admin'));
const rutas = [];
const meter = h => { if (h && h.startsWith('/admin') && !rutas.includes(h)) rutas.push(h); };
const rec = l => { for (const it of (l || [])) { if (Array.isArray(it)) { rec(it); continue; }
  if (!it || typeof it !== 'object') continue; meter(it.href); if (it.items) rec(it.items); } };
rec(MENU); rec(CONFIG_NEGOCIO); rec(FIJAS); rec(CUENTA);
const uno = s => { try { return db.prepare(s).get(); } catch { return null; } };
for (const [tabla, ruta] of [['clients', 'clients'], ['invoices', 'invoices'], ['quotes', 'quotes'],
  ['customer_orders', 'pedidos'], ['delivery_notes', 'albaranes'], ['purchase_orders', 'purchase-orders'],
  ['purchases', 'purchases'], ['supplier_invoices', 'supplier-invoices']]) {
  const r = uno(`SELECT id FROM ${tabla} ORDER BY id ASC LIMIT 1`);
  if (r) meter(`/admin/${ruta}/${r.id}`);
}
// Y EL PAPEL. «Pantalla, papel, correos y avisos»: un importe mal escrito en la factura impresa es
// peor que en la pantalla, porque ese papel se lo queda un cliente. Se piden las versiones para
// imprimir de los listados y de los documentos.
const PAPEL = ['/admin/listados/clientes/imprimir', '/admin/listados/facturas/imprimir',
               '/admin/listados/productos/imprimir', '/admin/listados/proveedores/imprimir'];
for (const r of PAPEL) meter(r);
for (const [tabla, ruta] of [['invoices', 'invoices'], ['quotes', 'quotes'], ['purchase_orders', 'purchase-orders']]) {
  const r = uno(`SELECT id FROM ${tabla} ORDER BY id ASC LIMIT 1`);
  if (r) meter(`/admin/${ruta}/${r.id}/imprimir`);
}

const lista = SOLO.length ? SOLO : rutas;

// El texto que ve una persona: sin <script>, sin <style> y sin atributos.
function textoVisible(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/g, '€');
}

const malas = [], conFechaIso = [];
let miradas = 0;
try {
  for (const ruta of lista) {
    let html = '', status = 0;
    try {
      const r = await fetch(BASE + ruta, { headers: { cookie: 'asess=' + tok } });
      status = r.status; html = await r.text();
    } catch (e) { malas.push({ ruta, err: 'no responde: ' + e.message }); continue; }
    if (status !== 200) continue;                       // 403/404 los cuenta otra comprobación
    miradas++;
    const txt = textoVisible(html);
    const fechas = [...new Set((txt.match(/(?<![\w-])\d{4}-\d{2}-\d{2}(?![\w-])/g) || []))];
    if (fechas.length) conFechaIso.push({ ruta, fechas: fechas.slice(0, 4) });
    const delante = [...txt.matchAll(SIMBOLO_DELANTE)].map(m => m[0].trim());
    const punto = [...txt.matchAll(PUNTO_DECIMAL)].map(m => m[0].trim());
    if (delante.length || punto.length) {
      malas.push({ ruta, delante: [...new Set(delante)].slice(0, 4), punto: [...new Set(punto)].slice(0, 4) });
    }
    process.stdout.write(delante.length || punto.length ? '✗' : '.');
  }
  console.log('');

  ok(malas.length === 0, 'ninguna pantalla escribe el dinero en inglés',
     malas.length ? malas.map(m => m.ruta + ': ' + [...(m.delante || []), ...(m.punto || [])].join(' ')).join('  ·  ')
                  : miradas + ' pantallas miradas');

  // ── Y LAS FECHAS ──────────────────────────────────────────────────────────────────────────────
  // `2026-08-24` es como se guarda, no como se dice. En pantalla va 24/08/2026. Se mira el TEXTO
  // visible, nunca los atributos: dentro de un `value` o de un `data-…` la fecha va en formato ISO a
  // propósito, porque ahí es un dato que alguien vuelve a leer.
  ok(conFechaIso.length === 0, 'ninguna pantalla enseña una fecha en formato inglés',
     conFechaIso.length ? conFechaIso.map(m => m.ruta + ': ' + m.fechas.join(' ')).join('  ·  ')
                        : miradas + ' pantallas miradas');

  // ── LOS CORREOS Y LA VOZ DE DISA ──────────────────────────────────────────────────────────────
  // No se sirven por una URL, así que se prueban llamando a quien los redacta. El mismo criterio:
  // lo que lee una persona.
  const { vestir, dinero, fechaEs } = await import('../modules/erp/voz.js');
  ok(dinero(117087.43) === '117.087,43 €', 'la voz de DISA escribe el dinero como en España', dinero(117087.43));
  ok(dinero(-1461.93) === '-1.461,93 €', '  también en negativo', dinero(-1461.93));
  ok(fechaEs('2026-08-24') === '24/08/2026', '  y la fecha en cristiano', fechaEs('2026-08-24'));
  const { detalleAviso } = await import('../modules/erp/avisos.js');
  const det = detalleAviso({ tipo: 'cobro_vencido', ref: { importe: 1234.5, dias: 3 } }, '€');
  ok(!/[€$£] ?-?\d/.test(det), 'el detalle de un aviso no pone el símbolo delante', det);

  // ── Y EL FORMATEADOR ÚNICO, DONDE TIENE QUE ESTAR ─────────────────────────────────────────────
  const layout = readFileSync(join(APP_DIR, 'modules', 'erp', 'layout.js'), 'utf8');
  ok(/window\.eur\s*=/.test(layout), 'el formateador del navegador vive en el componente compartido');
  ok(/window\.fechaEs\s*=/.test(layout), '  y con él el de las fechas');

  // Ningún ayudante NUEVO que escriba el símbolo delante. Es lo que había: quince copias distintas.
  const sueltos = [];
  const mirar = ruta => {
    let st; try { st = statSync(ruta); } catch { return; }
    if (st.isDirectory()) { for (const f of readdirSync(ruta)) mirar(join(ruta, f)); return; }
    if (!/\.js$/.test(ruta)) return;
    const src = readFileSync(ruta, 'utf8');
    const rx = /(?:const|var|let)\s+\w+\s*=\s*[^;\n]{0,40}(sym|SYM|_SYM)\s*\+\s*Number\([^)]*\)\.toFixed\(2\)/g;
    for (const m of src.matchAll(rx)) sueltos.push(ruta.replace(APP_DIR + '/', '') + ': ' + m[0].slice(0, 60));
  };
  mirar(join(APP_DIR, 'modules'));
  ok(sueltos.length === 0, 'ningún ayudante suelto vuelve a poner el símbolo delante',
     sueltos.slice(0, 4).join(' · ') || 'ninguno');

} finally {
  try { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok); } catch {}
  db.close();
}

if (malas.length) {
  console.error('\nDÓNDE, EXACTAMENTE:');
  for (const m of malas) {
    console.error('  ✗ ' + m.ruta + (m.err ? '  ' + m.err : ''));
    if (m.delante && m.delante.length) console.error('      símbolo delante: ' + m.delante.join(' · '));
    if (m.punto && m.punto.length) console.error('      punto decimal:   ' + m.punto.join(' · '));
  }
}
console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗   (' + miradas + ' pantallas)');
process.exit(fail === 0 ? 0 : 1);
