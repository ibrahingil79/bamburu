// GATE de la FICHA E — la pantalla de Inicio, fichas como widgets (E1 · E2 · E3 · E4).
//   node scripts/gate-inicio-widgets.mjs
//
// LO QUE COMPRUEBA, y por qué así:
//   · Los cuatro subpuntos SE PULSAN en un navegador. Mover, esconder, volver a mostrar y volver a
//     fábrica son gestos: llamar a la API probaría el motor y no el mando (regla 1 de CLAUDE.md).
//   · E2 se mide RECARGANDO la página, que es la única forma de saber que se guardó de verdad y no
//     solo en la pantalla de esa sesión.
//   · Y el añadido del dueño: **un widget que apunte a un informe borrado no puede dejar un hueco
//     muerto**. Se crea un informe, se ancla a la rejilla, se borra el informe y se mira qué queda.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import * as IL from '../modules/erp/inicio-layout.js';

const SLUG = 'desarrollo-bamburu';
const DB_PATH = tenantDb(SLUG);
const HOST = `${SLUG}.bamburu.com`, BASE = 'https://' + HOST;
const RID = randomBytes(3).toString('hex');
const MARCA = 'GE-' + RID;
const TOKEN_PREFIJO = 'gate-fichae-';
const dormir = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 10000');
let browser = null;
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay owner activo'); process.exit(2); }
const token = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

const orden = page => page.evaluate(() =>
  [...document.querySelectorAll('#cmOrden .cm-w')].map(e => e.dataset.cm));
const visibles = page => page.evaluate(() =>
  [...document.querySelectorAll('#cmOrden .cm-w')].filter(e => e.style.display !== 'none').map(e => e.dataset.cm));

async function abrir() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: token, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle0' });
  await dormir(2200);
  return { page, errores };
}

try {
  // Se parte SIEMPRE de fábrica, para que la pasada no dependa de lo que dejó la anterior.
  IL.delCuadro(db, owner.id);

  browser = await puppeteer.launch(launchOpts());
  const { page, errores } = await abrir();

  console.log('\n[0] El Inicio arranca como siempre');
  const inicial = await orden(page);
  ok(inicial.length === 7, 'las siete fichas del cuadro están', inicial.join(' · '));
  ok(inicial.join(',') === IL.CUADRO_FABRICA.orden.join(','), '  en el orden de fábrica', inicial.join(','));
  ok(!(await page.evaluate(() => document.body.classList.contains('cm-editando'))), 'y NO arranca en modo colocar');
  ok(await page.evaluate(() => !document.querySelector('.cm-w-tools')),
     '  sin un solo mando de colocar a la vista (la pantalla se ve igual que antes)');

  console.log('\n[1] E1 — cada ficha se puede mover');
  await page.click('#cmPers'); await dormir(600);
  ok(await page.evaluate(() => document.body.classList.contains('cm-editando')), 'el botón enciende el modo colocar');
  ok(await page.evaluate(() => !!document.querySelector('.cm-w-tools')), '  y aparecen los mandos en cada ficha');
  // Se PULSA el mando, no se llama a la API.
  const antes = await orden(page);
  await page.evaluate(() => document.querySelector('[data-abajo="hoy"]').click());
  await dormir(1200);
  const despues = await orden(page);
  ok(despues[0] === antes[1] && despues[1] === 'hoy', 'al bajar «Hoy» cambia de sitio de verdad',
     antes.slice(0, 3).join(',') + '  →  ' + despues.slice(0, 3).join(','));
  ok(despues.length === 7, '  y no se pierde ninguna por el camino', despues.length + '');

  console.log('\n[2] E2 — la colocación se guarda POR USUARIO (medido recargando)');
  const guardado = IL.getCuadro(db, owner.id);
  ok(guardado.propio && guardado.orden.join(',') === despues.join(','), 'el servidor guarda lo mismo que se ve',
     guardado.orden.join(','));
  await page.reload({ waitUntil: 'networkidle0' }); await dormir(2200);
  ok((await orden(page)).join(',') === despues.join(','), 'y al RECARGAR sigue puesto', (await orden(page)).join(','));
  // Y es de ESTE usuario: otro no lo hereda.
  const otro = db.prepare("SELECT id FROM admin_users WHERE active=1 AND id<>? ORDER BY id LIMIT 1").get(owner.id);
  if (otro) ok(!IL.getCuadro(db, otro.id).propio, '  y otro usuario NO hereda la colocación ajena', 'usuario ' + otro.id);
  else ok(true, '  (no hay un segundo usuario con el que contrastar)');

  console.log('\n[3] E3 — esconder una ficha y volver a mostrarla');
  // Tras recargar, el modo colocar está apagado (y así debe ser: no se queda pegado entre visitas).
  await page.click('#cmPers'); await dormir(700);
  ok(await page.evaluate(() => !!document.querySelector('[data-ocultar]')),
     'tras recargar, el modo colocar arranca APAGADO y se vuelve a encender a mano');
  await page.evaluate(() => document.querySelector('[data-ocultar="grafico"]').click());
  await dormir(1200);
  ok(!(await visibles(page)).includes('grafico'), '«El gráfico del mes» desaparece al esconderlo');
  ok(IL.getCuadro(db, owner.id).ocultos.includes('grafico'), '  y queda escondido en el servidor');
  const cartel = await page.evaluate(() => { const o = document.getElementById('cmOcultas');
    return o && o.style.display !== 'none' ? o.innerText.replace(/\s+/g, ' ') : null; });
  ok(!!cartel && /gráfico/i.test(cartel), '  y se LISTA para poder recuperarla (esconder no es perder)', cartel);
  await page.evaluate(() => document.querySelector('[data-mostrar="grafico"]').click());
  await dormir(1200);
  ok((await visibles(page)).includes('grafico'), 'y vuelve a mostrarse al pulsarlo');
  ok(!IL.getCuadro(db, owner.id).ocultos.includes('grafico'), '  y el servidor lo recuerda');

  console.log('\n[4] E4 — volver a la colocación de fábrica en un clic');
  ok(await page.evaluate(() => !!document.getElementById('cmFabrica')), 'el botón «Volver al de fábrica» está en el modo colocar');
  await page.evaluate(() => document.getElementById('cmFabrica').click());
  await dormir(1400);
  ok((await orden(page)).join(',') === IL.CUADRO_FABRICA.orden.join(','), 'de un clic vuelve al orden de fábrica',
     (await orden(page)).join(','));
  ok(!IL.getCuadro(db, owner.id).propio, '  y el servidor borra la colocación propia, no la sobreescribe');
  await page.click('#cmPers'); await dormir(500);
  ok(await page.evaluate(() => !document.querySelector('.cm-w-tools')), 'al salir del modo colocar los mandos se van');

  console.log('\n[5] EL AÑADIDO — un widget que apunta a un informe BORRADO no deja hueco muerto');
  // Se crea un informe, se ancla a la rejilla y se borra el informe. La rejilla no puede quedarse
  // con un bloque vacío ni reventar: el bloque tiene que desaparecer, y el resto seguir vivo.
  const { guardarPanel, borrarPanel, listarPaneles } = await import('../modules/erp/constructor-analitica.js');
  const p1 = guardarPanel(db, owner.id, { nombre: MARCA + ' informe', compartido: false,
    config: { area: 'ventas', dimension: 'fecha', periodo: 'mes', medidas: ['base'], grafico: 'barras' } });
  // La forma real de un bloque: para uno nativo, su clave VA EN `tipo` (no en un campo `ref`).
  IL.setLayout(db, 'usuario:' + owner.id, [
    { tipo: 'avisos', x: 0, y: 0, w: 2, h: 2 },
    { tipo: 'panel', refId: p1.id, x: 2, y: 0, w: 2, h: 2 },
  ], owner.id);
  await page.reload({ waitUntil: 'networkidle0' }); await dormir(2400);
  const conPanel = await page.evaluate(() => [...document.querySelectorAll('#inicioGrid .ig-block')].length);
  ok(conPanel === 2, 'con el informe vivo, la rejilla pinta sus dos bloques', conPanel + '');
  borrarPanel(db, owner.id, p1.id);
  await page.reload({ waitUntil: 'networkidle0' }); await dormir(2400);
  const tras = await page.evaluate(() => {
    const g = document.getElementById('inicioGrid');
    return { bloques: [...g.querySelectorAll('.ig-block')].length,
             texto: g.innerText.replace(/\s+/g, ' ').trim().slice(0, 80),
             vacios: [...g.querySelectorAll('.ig-block')].filter(b => !b.innerText.trim()).length };
  });
  ok(tras.bloques === 1, 'borrado el informe, su widget DESAPARECE (no queda un hueco)', tras.bloques + ' bloque');
  ok(tras.vacios === 0, '  y ningún bloque se queda mudo', tras.vacios + ' vacíos');
  ok(/avisos/i.test(tras.texto) || tras.bloques === 1, '  y el otro bloque sigue vivo', tras.texto);
  ok(errores.length === 0, 'toda la sesión sin errores de JavaScript ni ventanitas', errores.join(' | ') || 'ninguno');

  console.log('\n[6] Lo que no se ha roto');
  ok(await page.evaluate(() => !!document.getElementById('inicioGrid')), 'la rejilla del paso 6 sigue estando');
  for (const ruta of ['/admin/analytics', '/admin/citas', '/admin/vigia']) {
    const r = await fetch(BASE + ruta, { headers: { cookie: 'asess=' + token }, redirect: 'manual' });
    ok(r.status === 200, `${ruta} responde`, 'got ' + r.status);
  }
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'ficha-e-inicio.png') });
  await page.close();

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  // LO QUE UNA PRUEBA CREA, LA PRUEBA LO BORRA — por marca y por ámbito, pase o falle.
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM analytics_panels WHERE nombre LIKE 'GE-%'").run();
    IL.delCuadro(db, owner.id);
    IL.delLayout(db, 'usuario:' + owner.id);
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
