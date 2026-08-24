#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL BOTÓN «DESHACER» DE LA CONCILIACIÓN — PULSADO, y con las ventanitas silenciadas.
//
// DE DÓNDE SALE (24 ago 2026). Era la ÚLTIMA ventanita del navegador del producto: un
// `onclick="return confirm(...)"`. El censo decía CERO y no era cierto —se quedaba ciego en ese
// fichero desde un `accept="…,*/*"` que confundía con el principio de un comentario—.
//
// LA TRAMPA QUE HACE FALTA MEDIR, y por la que no basta con que el `confirm` ya no esté: ante el
// SEGUNDO diálogo seguido, Chrome ofrece la casilla «Impedir que esta página cree cuadros de diálogo
// adicionales». Marcada, `confirm()` devuelve false SIN ENSEÑAR NADA y el botón queda muerto: ni
// ventana, ni petición, ni aviso. Por eso aquí se navega con `prompt` y `confirm` NEUTRALIZADOS y se
// exige que el producto SIGA FUNCIONANDO — no que se disculpe.
//
// Y SE PRUEBA TAMBIÉN CUANDO EL USUARIO DICE QUE NO: cancelar tiene que dejar la fila como estaba.
// Una confirmación que no sabe cancelar es peor que no tenerla.
//
// LO QUE SIEMBRA, LO BORRA: un movimiento bancario y su conciliación, marcados con este RID, en el
// `finally` y por la marca. No toca ninguna factura, así que no roza la cadena de VERI*FACTU.
//
//   node scripts/gate-conciliacion-deshacer.mjs
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { join } from 'path';
import puppeteer from 'puppeteer-core';
import { tenantDb, launchOpts, exigeCodigoServido } from './lib/gate-env.mjs';

exigeCodigoServido();

const SLUG = 'desarrollo-bamburu';
const BASE = 'https://' + SLUG + '.bamburu.com';
const RID = randomBytes(3).toString('hex');
const MARCA = 'ZZ DESHACER ' + RID;
const SHOTS = join(process.env.HOME || '/home/ubuntu', 'concil-shots');
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };
const dormir = ms => new Promise(r => setTimeout(r, ms));

const db = new Database(tenantDb(SLUG));
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ ABORTADO: no hay dueño activo'); process.exit(2); }

const tok = 'zz-desh-' + randomBytes(16).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
let navegador;

const limpiar = () => {
  try {
    const ids = db.prepare("SELECT id FROM bank_movements WHERE concept LIKE ?").all(MARCA + '%').map(r => r.id);
    for (const id of ids) db.prepare('DELETE FROM bank_reconciliations WHERE movement_id=?').run(id);
    db.prepare("DELETE FROM bank_movements WHERE concept LIKE ?").run(MARCA + '%');
    db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok);
  } catch (e) { console.error('  (aviso: la limpieza no pudo completarse: ' + e.message + ')'); }
};

try {
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, ahora, ahora + 1800, randomBytes(12).toString('hex'));

  // ── Se siembra un movimiento CONCILIADO QUE CREÓ UN COBRO: es el único caso en el que el botón
  //    pregunta, porque deshacerlo borra también ese cobro.
  const mov = db.prepare(`INSERT INTO bank_movements (account, op_date, amount, is_credit, concept, natural_hash)
                          VALUES (?,?,?,?,?,?)`)
    .run('ES0000000000000000000000', new Date().toISOString().slice(0, 10), 121.0, 1, MARCA + ' cobro de prueba', 'zz-' + RID);
  db.prepare(`INSERT INTO bank_reconciliations (movement_id, estado, target_type, target_id, created_payment_id)
              VALUES (?,?,?,?,?)`).run(mov.lastInsertRowid, 'conciliado', 'invoice_payment', 999999, 999999);
  console.log('\n[0] SEMBRADO · movimiento #' + mov.lastInsertRowid + ' conciliado y con cobro creado');

  navegador = await puppeteer.launch(launchOpts());
  const ctx = await navegador.createBrowserContext();
  const page = await ctx.newPage();
  await page.setCookie({ name: 'asess', value: tok, domain: SLUG + '.bamburu.com', path: '/' });

  // LAS VENTANITAS, SILENCIADAS. Si el producto dependiera de una, a partir de aquí el botón moriría.
  await page.evaluateOnNewDocument(() => {
    window.prompt = () => null;
    window.confirm = () => false;
    window.alert = () => {};
  });
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));

  console.log('\n[1] LA PANTALLA, CON LOS DIÁLOGOS DEL NAVEGADOR NEUTRALIZADOS');
  await page.goto(BASE + '/admin/conciliacion', { waitUntil: 'networkidle2' });
  ok(page.url().includes('/admin/conciliacion'), 'la pantalla abre', page.url());
  ok(errores.length === 0, 'y no lanza errores de JavaScript', errores.slice(0, 2).join(' | ') || 'limpio');

  const hayBoton = await page.$('button[data-aviso]');
  ok(!!hayBoton, 'el botón «Deshacer» del movimiento que creó un cobro está en la pantalla');

  // Y NINGÚN confirm() DEL NAVEGADOR: se comprueba sobre el HTML servido, que es donde viviría.
  const html = await page.content();
  ok(!/onclick="return confirm\(/.test(html), 'ese botón ya NO usa un cuadro de diálogo del navegador');

  console.log('\n[2] SE PULSA, Y EL PANEL SALE DENTRO DE LA PÁGINA');
  await hayBoton.click();
  await page.waitForSelector('.modal-overlay.open', { timeout: 4000 }).catch(() => {});
  const panel = await page.$('.modal-overlay.open');
  ok(!!panel, 'al pulsar sale el panel de confirmación DENTRO de la página (no una ventanita)');
  const texto = panel ? await page.$eval('.modal-overlay.open', e => e.innerText) : '';
  ok(/ELIMINA|elimina/i.test(texto) && /cobro/i.test(texto),
     'y dice lo que va a pasar: que el cobro se elimina también', texto.replace(/\s+/g, ' ').slice(0, 90));
  await page.screenshot({ path: join(SHOTS, 'deshacer-panel.png') }).catch(() => {});

  console.log('\n[3] CUANDO EL USUARIO DICE QUE NO');
  const cancelar = await page.$('.modal-overlay.open [data-pd="x"]');
  if (cancelar) await cancelar.click(); else await page.keyboard.press('Escape');
  await dormir(400);
  const sigueAbierto = await page.$('.modal-overlay.open');
  ok(!sigueAbierto, 'cancelar cierra el panel');
  const fila = db.prepare('SELECT estado FROM bank_reconciliations WHERE movement_id=?').get(mov.lastInsertRowid);
  ok(fila && fila.estado === 'conciliado', 'y NO deshace nada: la fila sigue conciliada', fila && fila.estado);
  ok(errores.length === 0, 'y sigue sin errores de JavaScript', errores.slice(0, 2).join(' | ') || 'limpio');

  console.log('\n[4] LA REVERSIÓN — que el panel no sea un adorno');
  // Si se quitara el enganche, pulsar no abriría nada. Se comprueba que el enganche EXISTE en el JS
  // servido: sin esto, un panel que sale por otro motivo daría verde igual.
  ok(/data-aviso/.test(html) && /confirmarEnPagina/.test(html),
     'el botón y el panel están enganchados en el JavaScript que llega al navegador');

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + e.message);
} finally {
  if (navegador) await navegador.close().catch(() => {});
  limpiar();
  const quedan = db.prepare("SELECT COUNT(*) c FROM bank_movements WHERE concept LIKE ?").get(MARCA + '%').c;
  console.log('\n  Limpieza: quedan ' + quedan + ' movimientos de este gate (debe ser 0)');
  if (quedan !== 0) fail++;
  db.close();
}

console.log('\n' + '─'.repeat(70));
console.log('RESULTADO: ' + pass + ' ✓  ·  ' + fail + ' ✗');
process.exit(fail === 0 ? 0 : 1);
