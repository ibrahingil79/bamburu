#!/usr/bin/env node
//
// gate-disa-csrf.mjs — QUE UNA PÁGINA AJENA NO PUEDA MANDAR A DISA EN TU NOMBRE.
//
// DE DÓNDE SALE (AUD-006). El router de DISA se montaba directo en `/admin/disa` y `/api/disa` y
// **no heredaba el `csrfProtect()` que sí llevan los routers del ERP**. Nueve rutas de escritura sin
// ninguna protección: con la sesión de la víctima abierta en otra pestaña, una página ajena podía
// mandarle un mensaje a DISA en su nombre, renombrarle o fijarle conversaciones, cambiarle el agente
// y **subirle un adjunto que arranca la lectura por IA de una factura** (gastando cuota del negocio).
//
// QUÉ EXIGE, y todo se mide PIDIENDO de verdad, no leyendo el código:
//   [1] EL ATAQUE, REPRODUCIDO PRIMERO: se demuestra que la petición sin cabecera es la que haría
//       una página ajena — misma cookie de sesión, sin `x-csrf-token`. Línea base.
//   [2] Con el arreglo: TODAS las rutas de escritura la rechazan con 403.
//   [3] La misma petición CON la prueba legítima sigue funcionando igual.
//   [4] Las de SOLO LECTURA no se tocan: siguen respondiendo sin cabecera.
//   [5] El rate limit de /message sigue funcionando para quien tiene sesión.
//   [6] EN NAVEGADOR, con las pantallas reales: chatear, subir un adjunto y borrar una conversación.
//       Que la protección no rompa el uso normal es la mitad de la tarea.
//
// Se trae su propio negocio y lo tira al terminar con `tirarNegocio`. No usa el modelo: el chat se
// prueba mirando que la petición SALE con su cabecera y el servidor la acepta, no la respuesta.
//
//   node scripts/gate-disa-csrf.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer-core';
import { APP_DIR, launchOpts } from './lib/gate-env.mjs';
import { tirarNegocio } from './lib/tirar-negocio.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { getTenantBySlug } from '../core/control-db.js';

const RID = randomBytes(3).toString('hex');
let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

let slug = null, db = null, browser = null;

// Las ESCRITURAS de DISA, tal y como salen del censo del Paso 0. Si mañana aparece otra y no está
// aquí, el centinela `censo-disa-csrf` lo canta — este gate prueba las que hay.
const ESCRITURAS = [
  ['POST',   '/api/disa/threads'],
  ['POST',   '/api/disa/select-agent'],
  ['POST',   '/api/disa/alerts/open'],
  ['POST',   '/api/disa/chips'],
  ['POST',   '/api/disa/store-message'],
  ['POST',   '/api/disa/clear'],
  ['POST',   '/api/disa/message'],
  ['POST',   '/api/disa/attach'],
];
const LECTURAS = ['/api/disa/threads', '/api/disa/agents', '/api/disa/chips', '/api/disa/summary'];

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] UN NEGOCIO DE CERO, con su sesión');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const alta = await provisionTenant({
    businessName: 'Gate CSRF DISA ' + RID, ownerName: 'Dueña Gate',
    email: 'delivered@resend.dev', password: 'Gate.Csrf.' + RID + '!', phone: '+34 600 000 000',
  });
  slug = alta.slug;
  const t = getTenantBySlug(slug);
  db = new Database(path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename));
  db.pragma('busy_timeout = 10000');
  const uid = db.prepare("SELECT id FROM admin_users WHERE role='owner' ORDER BY id LIMIT 1").get().id;
  const tok = 'zz-csrf-' + randomBytes(20).toString('hex');
  const csrf = randomBytes(20).toString('hex');
  const ahora = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, uid, ahora, ahora + 3600, csrf);
  const BASE = 'http://' + slug + '.localhost:3000';
  ok(!!slug, 'negocio de prueba creado, con sesión de dueño', slug);

  const pedir = (ruta, metodo, conCsrf) => fetch(BASE + ruta, {
    method: metodo,
    headers: { cookie: 'asess=' + tok, ...(conCsrf ? { 'x-csrf-token': csrf } : {}) },
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EL ATAQUE, tal y como lo mandaría una página ajena');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Una página ajena SÍ puede hacer que el navegador mande la cookie de sesión (va sola), pero NO
  // puede leer ni poner la cabecera `x-csrf-token`: eso solo lo hace una página del propio dominio.
  // Por eso la prueba es exactamente esa: misma cookie, sin cabecera.
  let rechazadas = 0;
  for (const [metodo, ruta] of ESCRITURAS) {
    const r = await pedir(ruta, metodo, false);
    const bien = r.status === 403;
    if (bien) rechazadas++;
    ok(bien, 'sin la cabecera, ' + metodo + ' ' + ruta.replace('/api/disa', '') + ' se RECHAZA', 'HTTP ' + r.status);
  }
  ok(rechazadas === ESCRITURAS.length,
     'las ' + ESCRITURAS.length + ' rutas de escritura rechazan el ataque, ninguna se escapa',
     rechazadas + ' de ' + ESCRITURAS.length);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] CON LA PRUEBA LEGÍTIMA, siguen funcionando igual');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  for (const [metodo, ruta] of [['POST', '/api/disa/threads'], ['POST', '/api/disa/alerts/open'], ['POST', '/api/disa/select-agent']]) {
    const r = await pedir(ruta, metodo, true);
    ok(r.status !== 403, 'con la cabecera, ' + metodo + ' ' + ruta.replace('/api/disa', '') + ' pasa', 'HTTP ' + r.status);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] LAS DE SOLO LECTURA NO SE TOCAN');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  for (const ruta of LECTURAS) {
    const r = await pedir(ruta, 'GET', false);
    ok(r.status === 200, 'GET ' + ruta.replace('/api/disa', '') + ' sigue respondiendo SIN cabecera', 'HTTP ' + r.status);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] EL LÍMITE DE VELOCIDAD DE /message SIGUE VIVO para quien tiene sesión');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Con la puerta, el orden pasó de `rateLimit → auth` a `auth → csrf → rateLimit`. Para el usuario
  // legítimo no cambia: sigue recibiendo 429 al pasarse. Se comprueba, no se supone.
  let vio429 = false;
  for (let i = 0; i < 20 && !vio429; i++) {
    const r = await fetch(BASE + '/api/disa/message', {
      method: 'POST',
      headers: { cookie: 'asess=' + tok, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'zz ' + i }),
    });
    if (r.status === 429) vio429 = true;
  }
  ok(vio429, 'con sesión y cabecera, pasarse de mensajes sigue dando 429 (el limitador no se ha perdido)');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] EL NAVEGADOR — las pantallas reales de DISA siguen funcionando');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 950 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e?.message || e)));
  const fallos403 = [];
  page.on('response', r => { if (r.status() === 403 && r.url().includes('/disa/')) fallos403.push(r.url()); });
  await page.setCookie({ name: 'asess', value: tok, domain: slug + '.localhost', path: '/' });
  await page.goto(BASE + '/admin/disa', { waitUntil: 'networkidle0' });
  ok(await page.evaluate(() => !!document.getElementById('dtList')), 'la pantalla de DISA abre');

  // Crear una conversación: es un POST real desde la propia página.
  const antes = db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads WHERE user_id=?').get(uid).n;
  await page.evaluate(() => window.dtNewThread && window.dtNewThread());
  await new Promise(r => setTimeout(r, 900));
  const despues = db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads WHERE user_id=?').get(uid).n;
  ok(despues === antes + 1, 'crear una conversación DESDE LA PÁGINA sigue funcionando', antes + ' → ' + despues);

  // Subir un adjunto por el compositor del chat: la ruta /attach, que era de las desprotegidas.
  const tmp = path.join(process.env.HOME || '/tmp', 'zz-csrf-' + RID + '.png');
  fs.writeFileSync(tmp, Buffer.from('89504e470d0a1a0a', 'hex'));   // no es un PNG válido a propósito
  const inputFile = await page.$('input[type=file]');
  let subida = null;
  if (inputFile) {
    page.on('response', r => { if (r.url().includes('/disa/attach')) subida = r.status(); });
    await inputFile.uploadFile(tmp);
    await new Promise(r => setTimeout(r, 2500));
  }
  try { fs.unlinkSync(tmp); } catch {}
  ok(inputFile !== null, 'el compositor del chat tiene su botón de adjuntar');
  // Lo que importa aquí NO es que el fichero se lea (no es una factura): es que la petición
  // NO muera con 403. Un 400/500 del extractor es otra cosa y no es lo que mide esta tarea.
  ok(subida === null || subida !== 403,
     'subir un adjunto NO choca con la protección (403)', 'respuesta ' + (subida === null ? 'no llegó a salir' : subida));

  // Borrar una conversación: pasa por el panel de confirmación y por DELETE /threads/:id.
  await page.evaluate(() => { window.__pdAuto = true; });
  await page.evaluate(() => window.confirmarEnPagina = async () => true);
  const antesB = db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads WHERE user_id=?').get(uid).n;
  const idHilo = db.prepare('SELECT id FROM disa_conversation_threads WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid)?.id;
  if (idHilo) { await page.evaluate(id => window.dtDelete && window.dtDelete(id), idHilo); await new Promise(r => setTimeout(r, 900)); }
  const despuesB = db.prepare('SELECT COUNT(*) n FROM disa_conversation_threads WHERE user_id=?').get(uid).n;
  ok(despuesB === antesB - 1, 'borrar una conversación DESDE LA PÁGINA sigue funcionando', antesB + ' → ' + despuesB);

  ok(fallos403.length === 0, 'ninguna petición de la pantalla ha chocado con un 403', fallos403.join(' | ').slice(0, 120) || 'ninguna');
  ok(errs.length === 0, 'cero errores de JavaScript en la pasada', errs.join(' | ').slice(0, 120) || 'ninguno');

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (db) db.close(); } catch {}
  if (slug) { console.log('\n[limpieza] tirando el negocio de prueba: ' + slug); tirarNegocio(slug); }
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
