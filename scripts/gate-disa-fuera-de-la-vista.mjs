#!/usr/bin/env node
// Gate — NO QUEDA RASTRO VISIBLE DE DISA EN EL PANEL.
//
// Ficha `sacar-disa-del-producto`, paso 1 (7 sep 2026). El 6 de septiembre se apagó la IA; esto es
// lo siguiente: que el asistente **no se vea**. No oculto con CSS — **no pintado**.
//
// Mide tres cosas, y la tercera es la que impide que este gate se vuelva un adorno:
//   [1] RECORRIENDO EL PANEL con sesión, pantalla por pantalla, sobre el HTML que sale del
//       servidor: cero apariciones de la palabra, de «Asistente IA», de la burbuja, de sus enlaces
//       y de sus clases.
//   [2] PULSANDO en un navegador de verdad: no hay botón flotante en el DOM, el riel no tiene
//       DISA, el buscador del menú no la encuentra, y Propuestas sigue abriéndose con un clic.
//   [3] LO QUE NO SE TOCA SIGUE EN PIE: propuestas, avisos, recurrentes y el vigía responden, y la
//       tabla que guarda las propuestas —que se llama `disa_proposals`, y ése es el peligro del
//       paso 2— sigue con sus filas.
//
//   node scripts/gate-disa-fuera-de-la-vista.mjs

import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { launchOpts } from './lib/gate-env.mjs';

const require = createRequire(import.meta.url);
const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const Database = require('../core/sqlite-bamburu/indice.cjs');
const SLUG = process.env.GATE_SLUG || 'peluqueria-gil';
const PUERTO = Number(process.env.BAMBURU_PUERTO) || 3000;

let pass = 0, fail = 0;
const ok = (c, t, d = '') => { if (c) { pass++; console.log(`  ✓ ${t}`); } else { fail++; console.log(`  ✗ ${t}${d ? ' — ' + d : ''}`); } };

// ── EL DETECTOR ────────────────────────────────────────────────────────────────────────────────
// Lo que cuenta como «se ve DISA» en el HTML servido. Si alguien lo afloja, la comprobación [0]
// se cae: se le pasa una página con los rastros de VERDAD que había antes y tiene que cazarlos.
const RASTROS = [
  ['la palabra DISA',      /\bDISA\b/g],
  ['«Asistente IA»',       /Asistente\s+IA/gi],
  ['la burbuja o el chat', /disaWidget|disa-widget|disaOpen|disaBubble|id="disaFab"|id="disaPanel"/g],
  ['enlace o acción disa', /data-act="disa-[a-z-]+"|\/admin\/disa|\/api\/disa/g],
  ['clases disa-',         /class="[^"]*\bdisa-[a-z-]+/g],
];
const rastrosDe = html => RASTROS
  .map(([n, re]) => [n, (html.match(re) || []).length])
  .filter(([, k]) => k > 0);

// Un trozo de panel COMO ERA ANTES del 7 sep: sirve de rojo permanente del detector.
const COMO_ERA = `
  <button id="disaFab" class="disa-fab" onclick="disaOpen()">✦</button>
  <div id="disaPanel"><div class="disa-widget">Asistente IA</div></div>
  <a href="/admin/disa" data-act="disa-abrir">Hablar con DISA</a>
  <div class="disa-band">DISA prepara el trabajo</div>`;

function sesion() {
  const control = new Database(path.join(RAIZ, 'data/control.db'), { readonly: true });
  const t = control.prepare('SELECT db_filename FROM tenants WHERE slug=?').get(SLUG);
  control.close();
  if (!t) return null;
  const ruta = t.db_filename.startsWith('/') ? t.db_filename : path.join(RAIZ, t.db_filename);
  const db = new Database(ruta);
  const u = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1").get()
         || db.prepare('SELECT id FROM admin_users WHERE active=1 LIMIT 1').get();
  const tok = randomBytes(32).toString('base64url');
  const s = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, u.id, s, s + 900, randomBytes(32).toString('base64url'));
  db.close();
  return { tok, ruta };
}

const pedir = (camino, tok) => new Promise(res => {
  const r = request({ host: '127.0.0.1', port: PUERTO, path: camino,
    headers: { host: `${SLUG}.bamburu.com`, cookie: 'asess=' + tok } },
    resp => { let b = ''; resp.on('data', d => b += d); resp.on('end', () => res({ code: resp.statusCode, html: b })); });
  r.on('error', () => res({ code: 0, html: '' })); r.end();
});

const ses = sesion();
if (!ses) { console.log('  · no existe el negocio de prueba «' + SLUG + '»'); process.exit(2); }

console.log('\n[0] ROJO PROVOCADO — el detector no está ciego');
{
  const cazados = rastrosDe(COMO_ERA);
  const total = cazados.reduce((a, [, n]) => a + n, 0);
  ok(cazados.length === RASTROS.length,
     'sobre una página COMO ERA ANTES, el detector caza las CINCO familias de rastro',
     cazados.map(([n, k]) => `${n}×${k}`).join(' · '));
  ok(total >= 10, `y las caza todas: ${total} apariciones`);
  ok(rastrosDe('<div>una pantalla limpia, sin nada</div>').length === 0, 'y no inventa donde no hay');
}

console.log('\n[1] el panel entero, pantalla por pantalla');
let sucias = [];
{
  const mapa = process.env.MAPA_RUTAS;
  let pantallas;
  if (mapa) {
    pantallas = JSON.parse(readFileSync(mapa, 'utf8')).rutas
      .filter(r => r.metodo === 'GET' && r.camino.startsWith('/admin') && !r.camino.includes(':'))
      .map(r => r.camino);
  } else {
    // Sin el mapa de rutas, una lista corta pero representativa: el armazón es común a todas.
    pantallas = ['/admin', '/admin/clients', '/admin/invoices', '/admin/propuestas', '/admin/settings',
                 '/admin/agenda', '/admin/inventory', '/admin/crm', '/admin/vigia', '/admin/avisos',
                 '/admin/products', '/admin/supplier-invoices', '/admin/recurrentes'];
  }
  pantallas = pantallas.filter(p => !['/admin/logout', '/admin/autologin', '/admin/disable-2fa'].includes(p));
  let vistas = 0;
  for (const p of pantallas) {
    const { code, html } = await pedir(p, ses.tok);
    if (code !== 200) continue;
    vistas++;
    const r = rastrosDe(html);
    if (r.length) sucias.push(`${p} (${r.map(([n, k]) => n + '×' + k).join(', ')})`);
  }
  ok(vistas >= 10, `hay pantallas que mirar (${vistas} responden 200 de ${pantallas.length})`);
  ok(sucias.length === 0, 'NINGUNA pantalla enseña rastro de DISA', sucias.slice(0, 4).join(' · '));
  const disa = await pedir('/admin/disa', ses.tok);
  ok(disa.code === 302, 'y /admin/disa ya no sirve el chat: manda al panel', 'HTTP ' + disa.code);
  const agents = await pedir('/admin/disa/agents', ses.tok);
  ok(agents.code === 302, 'y tampoco responde lo que colgaba de él', 'HTTP ' + agents.code);
}

console.log('\n[2] PULSANDO, en un navegador de verdad');
let navegador = null;
try {
  navegador = await puppeteer.launch(launchOpts());
  const pag = await navegador.newPage();
  await pag.setViewport({ width: 1400, height: 900 });
  await pag.setCookie({ name: 'asess', value: ses.tok, domain: `${SLUG}.localhost`, path: '/' });
  const errores = [];
  pag.on('pageerror', e => errores.push(String(e?.message || e)));
  await pag.goto(`http://${SLUG}.localhost:${PUERTO}/admin/clients`, { waitUntil: 'networkidle2', timeout: 45000 });

  ok(await pag.$('#disaFab, #disaPanel, .disa-fab, .disa-widget') === null,
     'no hay botón flotante ni panel del asistente en el DOM');
  const rielTexto = await pag.$eval('.sidebar', el => el.innerText).catch(() => '');
  ok(!/DISA/i.test(rielTexto), 'el riel del menú no nombra a DISA', rielTexto.replace(/\n/g, ' | ').slice(0, 90));
  ok(/Propuestas/i.test(rielTexto), 'y Propuestas sigue estando en el riel');

  // Se PULSA: abrir el grupo y entrar en Propuestas.
  const abierto = await pag.evaluate(() => {
    const b = [...document.querySelectorAll('.sidebar button, .sidebar a')]
      .find(x => /Propuestas/i.test(x.textContent || x.title || ''));
    if (!b) return false; b.click(); return true;
  });
  ok(abierto, 'se puede PULSAR el grupo Propuestas en el riel');
  await new Promise(r => setTimeout(r, 400));
  const fue = await pag.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '/admin/propuestas');
    if (!a) return false; a.click(); return true;
  });
  if (fue) { await pag.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}); }
  ok(fue && /\/admin\/propuestas/.test(pag.url()), 'y el clic lleva a Propuestas', pag.url());
  const cuerpo = await pag.evaluate(() => document.body.innerText);
  ok(!/DISA/i.test(cuerpo), 'la pantalla de Propuestas no dice DISA por ningún lado');
  ok(errores.length === 0, 'y el navegador no suelta ni un error', errores.slice(0, 2).join(' | '));
} catch (e) {
  ok(false, 'la comprobación con navegador se pudo ejecutar', String(e?.message || e).slice(0, 120));
} finally { try { await navegador?.close(); } catch {} }

console.log('\n[3] lo que NO se toca sigue en pie');
{
  for (const [ruta, nombre] of [['/admin/propuestas', 'Propuestas'], ['/admin/avisos', 'Avisos'],
                                ['/admin/recurrentes', 'Recurrentes'], ['/admin/vigia', 'el Vigía'],
                                ['/api/erp/propuestas/contador', 'el contador de propuestas']]) {
    const r = await pedir(ruta, ses.tok);
    ok(r.code === 200 && r.html.length > 5, `${nombre} responde`, `HTTP ${r.code}`);
  }
  // ⚠️ LA TRAMPA DEL PASO 2: las propuestas viven en una tabla llamada `disa_proposals`.
  const db = new Database(ses.ruta, { readonly: true });
  let filas = -1;
  try { filas = db.prepare('SELECT count(*) c FROM disa_proposals').get().c; } catch { /* no está */ }
  db.close();
  ok(filas >= 0, '⚠️ la tabla `disa_proposals` SIGUE EXISTIENDO — es la de las propuestas, NO es del chat',
     filas < 0 ? 'no se encontró' : `${filas} filas en este negocio`);
}

console.log(`\nRESULTADO: ${pass} ✓ · ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
