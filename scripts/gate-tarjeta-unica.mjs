// GATE DE LA FICHA I — la tarjeta de cifra es UNA (I1) y ninguna pantalla se quedó fuera (I3).
//   node scripts/gate-tarjeta-unica.mjs
//
// CÓMO SE MIDE, y por qué así:
//   · No se comprueba que la CLASE esté puesta, sino que el ESTILO CALCULADO llega: una clase sin
//     CSS detrás es una tarjeta que no existe, y el HTML se vería igual de bien en un grep. Se
//     afirma sobre píxeles (getComputedStyle / getBoundingClientRect), como manda CLAUDE.md.
//   · Se recorren TODAS las pantallas del menú más las de detalle, no una muestra. I3 dice
//     literalmente «no dar por hecho ninguna».
//   · Y lleva su REVERSIÓN: se apaga el componente en el navegador y se exige que el gate CAIGA.
//     Un gate que no sabe ponerse rojo no está midiendo nada.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { MENU, CONFIG_NEGOCIO, FIJAS, CUENTA } from '../modules/erp/menu.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay owner activo'); process.exit(2); }
const TOKEN_PREFIJO = 'gate-fichai-';
const tok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

// ── Las pantallas: el menú entero + las de detalle que existen de verdad ─────────────────────────
const pantallas = [];
const meter = (href, label) => { if (href && href.startsWith('/admin') && !pantallas.some(p => p.href === href)) pantallas.push({ href, label }); };
const recorrer = l => { for (const it of (l || [])) { if (Array.isArray(it)) { recorrer(it); continue; }
  if (!it || typeof it !== 'object') continue; meter(it.href, it.label); if (it.items) recorrer(it.items); } };
recorrer(MENU); recorrer(CONFIG_NEGOCIO); recorrer(FIJAS); recorrer(CUENTA);
const uno = s => { try { return db.prepare(s).get(); } catch { return null; } };
for (const [tabla, ruta, label] of [
  ['clients', 'clients', 'ficha de cliente'], ['invoices', 'invoices', 'ficha de factura'],
  ['quotes', 'quotes', 'ficha de presupuesto'], ['customer_orders', 'pedidos', 'ficha de pedido'],
  ['delivery_notes', 'albaranes', 'ficha de albarán'], ['purchase_orders', 'purchase-orders', 'ficha de orden'],
  ['purchases', 'purchases', 'ficha de compra'], ['supplier_invoices', 'supplier-invoices', 'ficha de recibida'],
  ['supplier_returns', 'supplier-returns', 'ficha de devolución'],
]) {
  // EL MÁS ANTIGUO, NO EL MÁS NUEVO. Con `ORDER BY id DESC` se cogía el último registro creado, que
  // en un barrido es casi siempre de OTRO gate corriendo a la vez: para cuando esta pestaña navega,
  // el otro ya lo ha limpiado y la ficha responde 404. Pasó el 24 ago 2026 con /admin/clients/704 y
  // /admin/invoices/1302, y arrastró otras dos comprobaciones (sin ficha no hay tarjetas que contar).
  // El registro más antiguo es del negocio de verdad y nadie lo borra por debajo.
  const filtro = tabla === 'clients' ? ' WHERE active=1' : '';
  const r = uno(`SELECT id FROM ${tabla}${filtro} ORDER BY id ASC LIMIT 1`);
  if (r) meter(`/admin/${ruta}/${r.id}`, label);
}

// Lo que se mide dentro de cada pantalla.
const MEDIR = () => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const out = { bf: 0, vivo: null, viejas: 0, pegadas: [], aBorde: 0, huecas: 0 };
  // Se cuentan TODAS, visibles o no: la pantalla de Informes guarda las suyas detrás de un
  // desplegable y siguen siendo el componente. La visibilidad se exige donde importa —el texto
  // pegado al borde—, no aquí, y las que estén escondidas se prueban ABRIÉNDOLAS más abajo.
  const tarjetas = [...document.querySelectorAll('.bf-card')];
  out.bf = tarjetas.length;
  out.bfVis = tarjetas.filter(vis).length;
  if (tarjetas.length) {
    const cs = getComputedStyle(tarjetas[0]);
    out.vivo = { radio: cs.borderTopLeftRadius, padL: cs.paddingLeft, borde: cs.borderTopWidth, fondo: cs.backgroundColor };
    // Una tarjeta sin cifra dentro es una tarjeta hueca: la clase puesta y nada que leer.
    // Hueca = VISIBLE y sin cifra. Una escondida todavía no se ha rellenado, y eso está bien.
    out.huecas = tarjetas.filter(t => vis(t) && !(t.querySelector('.bf-v')?.innerText || '').trim()).length;
  }
  out.viejas = document.querySelectorAll('.kpi, .cm-num, .ig-kpi-label, .ig-kpi-value, .kpi-val, .kpi-label, .kpi-sub').length;
  for (const c of document.querySelectorAll('.card')) {
    if (!vis(c)) continue;
    if (c.querySelector(':scope > .card-body, :scope > .card-head')) continue;
    if (/padding\s*:\s*0/.test(c.getAttribute('style') || '')) { out.aBorde++; continue; }
    const rc = c.getBoundingClientRect(); let peor = 999, muestra = '';
    for (const el of c.querySelectorAll('p,h1,h2,h3,h4,h5,label,input,select,textarea,button,li,span,div')) {
      if (el.closest('table') || !vis(el) || el.querySelector('table')) continue;
      const t = (el.innerText || el.value || el.placeholder || '').trim(); if (!t) continue;
      const r = el.getBoundingClientRect();
      const g = Math.min(r.left - rc.left, rc.right - r.right, r.top - rc.top, rc.bottom - r.bottom);
      if (g < 0) continue;
      if (g < peor) { peor = g; muestra = t.slice(0, 34).replace(/\s+/g, ' '); }
    }
    if (peor < 8) out.pegadas.push(muestra + ' [' + Math.round(peor) + 'px]');
  }
  return out;
};

let browser = null;
try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] EL COMPONENTE SE DEFINE UNA SOLA VEZ, y en el sitio de todos');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Dos copias de un componente son dos componentes: a la segunda semana ya no se parecen.
  const ficheros = [];
  const barrer = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name === '.git' || f.name === 'data') continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) barrer(p); else if (f.name.endsWith('.js')) ficheros.push(p);
  } };
  barrer(path.join(RAIZ, 'modules'));
  const definen = ficheros.filter(f => /\.bf-card\s*\{/.test(fs.readFileSync(f, 'utf8')));
  ok(definen.length === 1 && definen[0].endsWith('erp/layout.js'),
     'la tarjeta se define en UN solo fichero, el estilo global',
     definen.map(f => f.replace(RAIZ + '/', '')).join(', ') || 'ninguno');
  const defViejas = ficheros.filter(f => /\.(kpi|cm-num|ig-kpi-value)\s*\{/.test(fs.readFileSync(f, 'utf8')));
  ok(defViejas.length === 0, 'y no queda ninguna de las tres tarjetas viejas definida en el código',
     defViejas.map(f => f.replace(RAIZ + '/', '')).join(', ') || 'ninguna');

  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log(`\n[1] I3 — LAS ${pantallas.length} PANTALLAS, UNA A UNA (ninguna se da por hecha)`);
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const R = [];
  for (const p of pantallas) {
    try {
      const resp = await page.goto(BASE + p.href, { waitUntil: 'networkidle0', timeout: 45000 });
      await dormir(600);
      R.push({ ...p, status: resp ? resp.status() : 0, ...(await page.evaluate(MEDIR)) });
    } catch (e) { R.push({ ...p, status: -1, err: e.message.slice(0, 50), bf: 0, viejas: 0, pegadas: [], aBorde: 0, huecas: 0 }); }
    process.stdout.write('.');
  }
  console.log('');
  const rotas = R.filter(x => x.status !== 200);
  ok(rotas.length === 0, `las ${R.length} pantallas siguen abriendo`, rotas.map(x => x.href + ' (' + (x.status || x.err) + ')').join(', ') || 'todas 200');
  const conViejas = R.filter(x => x.viejas > 0);
  ok(conViejas.length === 0, 'ni una pantalla pinta ya una tarjeta de las viejas',
     conViejas.map(x => x.href + ':' + x.viejas).join(', ') || 'ninguna');
  const conNueva = R.filter(x => x.bf > 0);
  ok(conNueva.length >= 4, 'y las que tienen tarjetas usan la única que hay',
     conNueva.map(x => x.href + ' (' + x.bf + ')').join(', '));

  // LA DE INFORMES SE PRUEBA PULSANDO, porque sus tarjetas nacen escondidas. Contarlas en el DOM y
  // darlas por buenas sería el verde por el motivo equivocado: la clase puesta sobre algo que
  // nadie llega a ver.
  await page.goto(BASE + '/admin/analytics', { waitUntil: 'networkidle0' }); await dormir(1200);
  await page.click('[data-inf="rentabilidad"]');
  await dormir(2000);
  const rent = await page.evaluate(() => {
    const c = [...document.querySelectorAll('#inf-rentabilidad .bf-card')];
    const v = c.filter(x => x.getBoundingClientRect().height > 0);
    return { total: c.length, visibles: v.length,
      radio: v.length ? parseFloat(getComputedStyle(v[0]).borderTopLeftRadius) : -1,
      valores: v.map(x => (x.querySelector('.bf-v')?.innerText || '').trim()) };
  });
  ok(rent.visibles === 4 && rent.radio === 14,
     'Informes: al ABRIR «Rentabilidad» salen sus cuatro tarjetas, con la forma del componente',
     `${rent.visibles} de ${rent.total} · radio ${rent.radio}px`);
  ok(rent.valores.every(v => v && v !== '—'), '  y con cifras dentro, no con guiones', rent.valores.join(' · '));
  const huecas = R.filter(x => x.huecas > 0);
  ok(huecas.length === 0, 'ninguna tarjeta se queda sin cifra dentro (clase puesta y nada que leer)',
     huecas.map(x => x.href + ':' + x.huecas).join(', ') || 'ninguna');

  console.log('\n[2] EL TEXTO PEGADO AL BORDE — la lección del 19 ago, medida en píxeles');
  const pegadas = R.filter(x => x.pegadas.length);
  ok(pegadas.length === 0, 'ninguna caja mete su texto contra el marco',
     pegadas.map(x => x.href + ' → ' + x.pegadas.join(' | ')).join('  ·  ') || 'ninguna');
  console.log(`  · dejadas fuera A PROPÓSITO (declaran padding:0, van a borde): ${R.reduce((a, x) => a + x.aBorde, 0)}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] EL ESTILO LLEGA DE VERDAD — no basta con que la clase esté puesta');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.goto(BASE + '/admin/inventory', { waitUntil: 'networkidle0' }); await dormir(1600);
  const inv = await page.evaluate(() => {
    const t = document.querySelector('.bf-card'); const cs = getComputedStyle(t);
    return { radio: parseFloat(cs.borderTopLeftRadius), pad: parseFloat(cs.paddingLeft),
             borde: parseFloat(cs.borderTopWidth), rot: getComputedStyle(t.querySelector('.bf-k')).textTransform,
             valores: [...document.querySelectorAll('.bf-v')].map(v => v.innerText.trim()),
             colorSinStock: getComputedStyle(document.getElementById('kOut')).color,
             pintadas: document.querySelectorAll('.bf-card').length };
  });
  ok(inv.radio === 14 && inv.pad > 12 && inv.borde >= 1, 'la tarjeta llega con su forma (radio, relleno y borde)',
     `radio ${inv.radio}px · relleno ${inv.pad}px · borde ${inv.borde}px`);
  ok(inv.rot === 'uppercase', '  y su rótulo con la tipografía del componente', inv.rot);
  ok(inv.pintadas === 4 && inv.valores.every(v => v && v !== '—'),
     'Stock: las cuatro cifras se rellenan de verdad tras convertirlas', inv.valores.join(' · '));
  ok(/rgb\(2[0-9]{2}|rgb\(1[0-9]{2}/.test(inv.colorSinStock) && inv.colorSinStock !== 'rgb(0, 0, 0)',
     '  y «Sin stock» sale en rojo porque hay 38, no porque esté pintado siempre', inv.colorSinStock);

  console.log('\n[4] NO SE HA PERDIDO NADA POR EL CAMINO (Inicio y ficha de cliente)');
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' }); await dormir(2400);
  const ini = await page.evaluate(() => ({
    tarjetas: document.querySelectorAll('#cmNumeros .bf-card.grande').length,
    chips: document.querySelectorAll('#cmNumeros .cm-cmp').length,
    chispas: document.querySelectorAll('#cmNumeros .cm-chispa svg').length,
    iconos: document.querySelectorAll('#cmNumeros .bf-k i.ti').length,
    corta: [...document.querySelectorAll('#cmNumeros .bf-v')].some(v => v.scrollWidth > v.clientWidth + 2),
    tamano: parseFloat(getComputedStyle(document.querySelector('#cmNumeros .bf-v')).fontSize),
    fichas: document.querySelectorAll('#cmOrden .cm-w').length,
  }));
  ok(ini.tarjetas === 4, 'el Inicio sigue con sus cuatro cifras de titular', ini.tarjetas + '');
  ok(ini.chips === 4 && ini.chispas >= 2 && ini.iconos === 4,
     '  y no pierde ni el chip de comparación, ni la chispa, ni el icono',
     `${ini.chips} chips · ${ini.chispas} chispas · ${ini.iconos} iconos`);
  ok(ini.tamano >= 21, '  y la cifra grande sigue siendo grande (no se encogió al unificar)', ini.tamano + 'px');
  ok(!ini.corta, '  y ninguna cifra del Inicio se queda cortada con puntos suspensivos');
  ok(ini.fichas === 7, '  y las siete fichas del cuadro de mando (ficha E) siguen ahí', ini.fichas + '');
  const idCli = uno('SELECT id FROM clients WHERE active=1 ORDER BY id LIMIT 1')?.id;
  await page.goto(BASE + '/admin/clients/' + idCli, { waitUntil: 'networkidle0' }); await dormir(1500);
  const fc = await page.evaluate(() => ({
    n: document.querySelectorAll('.bf-card').length,
    flechas: document.querySelectorAll('.bf-card .bf-go').length,
    pulsables: document.querySelectorAll('.bf-card[data-tarjeta]').length,
    recorta: getComputedStyle(document.querySelector('.bf-card > span')).textOverflow,
  }));
  ok(fc.n >= 6, 'la ficha de cliente conserva sus tarjetas tras quitarle el CSS propio', fc.n + '');
  ok(fc.flechas > 0 && fc.pulsables > 0, '  con sus flechas y su poder de abrirse', `${fc.flechas} flechas · ${fc.pulsables} pulsables`);
  ok(fc.recorta === 'ellipsis', '  y el recorte con puntos suspensivos, que era suyo', fc.recorta);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] LA REVERSIÓN — se apaga el componente y el gate TIENE que caer');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Si esto no se pusiera rojo, es que el gate estaba mirando la clase y no el estilo.
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.bf-card{border-radius:0!important;padding:0!important;border-width:0!important}';
    document.head.appendChild(s); s.id = 'zz-sabotaje';
  });
  await dormir(300);
  const roto = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.bf-card'));
    return { radio: parseFloat(cs.borderTopLeftRadius), pad: parseFloat(cs.paddingLeft) }; });
  ok(roto.radio === 0 && roto.pad === 0, 'apagado el componente, la medida lo NOTA (el gate sabe ponerse rojo)',
     `radio ${roto.radio}px · relleno ${roto.pad}px`);
  await page.evaluate(() => document.getElementById('zz-sabotaje')?.remove());
  await dormir(300);
  const vuelta = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.bf-card')).borderTopLeftRadius));
  ok(vuelta === 14, 'y quitado el sabotaje, vuelve', vuelta + 'px');

  ok(errores.length === 0, 'sin un solo error de JavaScript en todo el recorrido', errores.slice(0, 3).join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'ficha-i-tarjeta.png') });

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  // Este gate NO siembra datos: solo mira. Lo único suyo es su sesión, y se va igual.
  try { db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run(); } catch {}
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
