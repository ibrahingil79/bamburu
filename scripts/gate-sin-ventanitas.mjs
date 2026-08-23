// GATE DEL PUNTO 7 — el producto ya no usa las ventanitas del navegador.
//   node scripts/gate-sin-ventanitas.mjs
//
// POR QUÉ EXISTE. Chrome ofrece la casilla «Impedir que esta página cree cuadros de diálogo
// adicionales» en el SEGUNDO diálogo seguido. Marcada, `prompt()` devuelve null y `confirm()` false
// SIN ENSEÑAR NADA: el botón queda muerto —ni ventana, ni petición, ni aviso— y el usuario cree que
// el programa está roto. Costó una entrega entera con 97 aserciones en verde.
//
// CÓMO SE MIDE, y por qué así:
//   · Las ventanitas se NEUTRALIZAN antes de que cargue nada (`prompt`/`confirm` cambiados en el
//     documento nuevo). Cualquier superviviente queda APUNTADO, y una sola tumba el gate. No se
//     cuenta con que no las haya: se comprueba que aunque las hubiera, no se usan.
//   · Se PULSAN los botones de verdad, no se llama a la API: el mando es donde se rompen las cosas.
//   · Se prueba TAMBIÉN cuando el usuario dice que no (cancelar) y cuando deja el campo vacío, que
//     eran los tres caminos muertos y silenciosos del caso original.
//   · Y el censo del código tiene que dar CERO: pulsar seis pantallas no demuestra nada de las otras
//     cincuenta.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import path from 'path';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const RID = randomBytes(3).toString('hex');
const MARCA = 'GSV-' + RID;
const TOKEN_PREFIJO = 'gate-sinvent-';
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay owner activo'); process.exit(2); }
const tok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

// Las ventanitas se apagan ANTES de que corra una línea de la página. Y se apuntan: el gate no
// quiere que «no pase nada», quiere saber si alguien lo INTENTÓ.
const NEUTRALIZAR = `
  window.__ventanitas = [];
  window.prompt  = function(m){ window.__ventanitas.push('prompt: ' + m); return null; };
  window.confirm = function(m){ window.__ventanitas.push('confirm: ' + m); return false; };
  window.alert   = function(m){ window.__ventanitas.push('alert: ' + m); };
  window.__peticiones = 0;
  (function(){ var f = window.fetch; window.fetch = function(){ window.__peticiones++; return f.apply(this, arguments); }; })();
`;

let browser = null;
try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[0] EL CENSO DEL CÓDIGO — cero, o esto no vale de nada');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Pulsar seis pantallas no dice nada de las otras cincuenta. El censo es lo que cubre el resto.
  let censo = '', censoOk = false;
  try { censo = execFileSync('node', [path.join(RAIZ, 'scripts', 'censo-ventanitas.mjs')], { encoding: 'utf8' }); censoOk = true; }
  catch (e) { censo = String(e.stdout || e.message); }
  const nVivas = Number((censo.match(/VENTANITAS VIVAS: (\d+)/) || [0, -1])[1]);
  ok(censoOk && nVivas === 0, 'no queda ni un prompt() ni un confirm() vivo en modules/', nVivas + ' vivas');
  ok(/ENCADENADAS[^\n]*: 0/.test(censo), 'y ninguna pantalla encadena dos, que era el caso que mataba');

  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();

  async function abrir(ruta) {
    const page = await ctx.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
    await page.evaluateOnNewDocument(NEUTRALIZAR);
    const errores = [];
    page.on('pageerror', e => errores.push(String(e && e.message || e)));
    page.on('dialog', async d => { errores.push('VENTANITA NATIVA: ' + d.type()); await d.dismiss(); });
    await page.goto(BASE + ruta, { waitUntil: 'networkidle0' });
    await dormir(1100);
    return { page, errores };
  }
  const panel = page => page.evaluate(() => {
    const o = document.querySelector('.modal-overlay.open');
    if (!o) return null;
    return { titulo: (o.querySelector('h3') || {}).textContent || '',
             texto: (o.querySelector('.modal-body p') || {}).textContent || '',
             campos: o.querySelectorAll('.modal-body input, .modal-body select').length,
             botones: [...o.querySelectorAll('.modal-foot button')].map(b => b.textContent.trim()) };
  });
  const intentos = page => page.evaluate(() => window.__ventanitas || []);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] PRESUPUESTOS — «Anular y rehacer», la que encadenaba dos');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const q = db.prepare("SELECT id, status FROM quotes WHERE status='emitido' ORDER BY id DESC LIMIT 1").get();
  if (!q) { console.log('  (sin presupuesto emitido con el que probar: se salta y se dice)'); }
  else {
    const { page, errores } = await abrir('/admin/quotes/' + q.id);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Anular y rehacer/i.test(x.textContent)); if (b) b.click(); });
    await dormir(700);
    const p1 = await panel(page);
    ok(!!p1 && /Anular y rehacer/i.test(p1.titulo), 'al pulsar sale un panel DENTRO de la página', p1 && p1.titulo);
    ok(p1 && p1.campos >= 1, '  con su campo para el motivo', p1 && p1.campos + ' campo(s)');
    ok((await intentos(page)).length === 0, '  y sin haber intentado abrir una ventanita del navegador');
    // EL USUARIO DICE QUE NO: cancelar no puede disparar nada.
    const antesPet = await page.evaluate(() => window.__peticiones);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /No,|Cancelar/i.test(x.textContent)); if (b) b.click(); });
    await dormir(600);
    ok(!(await panel(page)), 'al cancelar, el panel se cierra');
    ok(await page.evaluate(() => window.__peticiones) === antesPet, '  y NO se manda ninguna petición');
    ok(db.prepare('SELECT status FROM quotes WHERE id=?').get(q.id).status === q.status,
       '  y el presupuesto sigue como estaba', q.status);
    // EL CAMPO VACÍO: el panel no se cierra y dice dónde está el fallo.
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Anular y rehacer/i.test(x.textContent)); if (b) b.click(); });
    await dormir(600);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Anular/i.test(x.textContent)); if (b) b.click(); });
    await dormir(700);
    const p2 = await panel(page);
    const err = await page.evaluate(() => { const e = document.querySelector('.modal-overlay.open .pd-err'); return e && e.style.display !== 'none' ? e.textContent : ''; });
    ok(!!p2, 'con el motivo VACÍO el panel NO se cierra');
    ok(/obligatorio/i.test(err), '  y dice por qué, en su sitio', err);
    ok(db.prepare('SELECT status FROM quotes WHERE id=?').get(q.id).status === q.status, '  y no se ha anulado nada');
    await page.keyboard.press('Escape'); await dormir(400);
    ok(!(await panel(page)), 'y Escape también cierra el panel (no deja atrapado a nadie)');
    ok(errores.length === 0, 'sin errores de JavaScript ni ventanitas nativas', errores.join(' | ') || 'ninguno');
    await page.close();
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] ÓRDENES DE COMPRA — «Anular», y el aviso de que el motivo es corto');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // OJO A LA PRECONDICIÓN: una orden con recepción confirmada NO se puede anular y el producto ni
  // siquiera pinta el botón. La primera versión de este gate cogía la última enviada, que tenía una
  // recepción, y daba rojo sobre una pantalla correcta. Se pide una que SÍ se pueda anular.
  const oc = db.prepare(`SELECT id, status FROM purchase_orders po WHERE po.status='enviada'
      AND NOT EXISTS (SELECT 1 FROM purchase_order_receipts r WHERE r.order_id=po.id AND r.status='confirmada')
      ORDER BY po.id DESC LIMIT 1`).get();
  if (oc) {
    const { page, errores } = await abrir('/admin/purchase-orders/' + oc.id);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Anular'); if (b) b.click(); });
    await dormir(700);
    const p1 = await panel(page);
    ok(!!p1 && /Anular la orden/i.test(p1.titulo), 'sale el panel de anular', p1 && p1.titulo);
    // Motivo demasiado corto: el panel se queda y lo dice.
    await page.evaluate(() => { const i = document.querySelector('.modal-overlay.open input'); if (i) { i.value = 'ab'; i.dispatchEvent(new Event('input')); } });
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Anular/i.test(x.textContent)); if (b) b.click(); });
    await dormir(700);
    const err = await page.evaluate(() => { const e = document.querySelector('.modal-overlay.open .pd-err'); return e && e.style.display !== 'none' ? e.textContent : ''; });
    ok(/3 caracteres/.test(err), 'con un motivo de dos letras, lo dice y NO se cierra', err);
    ok(db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(oc.id).status === oc.status, '  y la orden sigue enviada');
    ok((await intentos(page)).length === 0, 'y ni un intento de ventanita del navegador');
    ok(errores.length === 0, 'sin errores de JavaScript', errores.join(' | ') || 'ninguno');
    await page.close();
  } else console.log('  (sin orden enviada con la que probar)');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] MOSTRADOR — la línea libre, que pedía DOS datos en dos ventanitas seguidas');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const { page, errores } = await abrir('/admin/mostrador');
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /libre/i.test(x.textContent)); if (b) b.click(); });
    await dormir(700);
    const p1 = await panel(page);
    ok(!!p1 && /Línea libre/i.test(p1.titulo), 'sale UN panel con los DOS datos, no dos ventanitas', p1 && p1.titulo);
    ok(p1 && p1.campos === 2, '  concepto e importe, juntos', p1 && p1.campos + ' campos');
    // Importe que no es un número: se dice, y no se añade nada.
    await page.evaluate(() => { const c = document.querySelectorAll('.modal-overlay.open input');
      c[0].value = 'Mano de obra'; c[1].value = 'no soy un número'; });
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Añadir/i.test(x.textContent)); if (b) b.click(); });
    await dormir(600);
    ok(!!(await panel(page)), 'con un importe que no es número, el panel se queda abierto');
    // Y ahora bien: se añade al ticket de verdad.
    await page.evaluate(() => { const c = document.querySelectorAll('.modal-overlay.open input'); c[1].value = '12.50'; });
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Añadir/i.test(x.textContent)); if (b) b.click(); });
    await dormir(800);
    const enTicket = await page.evaluate(() => (document.body.innerText || '').includes('Mano de obra'));
    ok(!(await panel(page)) && enTicket, 'y con los dos datos buenos, la línea entra en el ticket');
    ok((await intentos(page)).length === 0, 'sin una sola ventanita del navegador por el camino');
    ok(errores.length === 0, 'sin errores de JavaScript', errores.join(' | ') || 'ninguno');
    await page.close();
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] FICHA DE CLIENTE — editar y quitar una nota (el otro par encadenado)');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const cli = db.prepare("INSERT INTO clients (name, client_type, active) VALUES (?,'particular',1)").run(MARCA + ' Cliente').lastInsertRowid;
    const { page, errores } = await abrir('/admin/clients/' + cli);
    // Se crea la nota por la pantalla, pulsando: es el camino del dueño.
    await page.evaluate(m => { const t = document.querySelector('[id$="nueva"]'); if (t) { t.value = m + ' nota'; } }, MARCA);
    await page.evaluate(() => { const b = document.querySelector('[id$="addNota"]'); if (b) b.click(); });
    await dormir(1200);
    ok(db.prepare("SELECT COUNT(*) n FROM client_notes WHERE client_id=? AND active=1").get(cli).n === 1, 'la nota se crea desde la pantalla');
    // EDITAR: panel, no prompt.
    await page.evaluate(() => { const a = document.querySelector('a[data-nedit]'); if (a) a.click(); });
    await dormir(700);
    const p1 = await panel(page);
    ok(!!p1 && /Editar la nota/i.test(p1.titulo), 'editar abre un panel, no una ventanita', p1 && p1.titulo);
    await page.evaluate(m => { const i = document.querySelector('.modal-overlay.open input'); if (i) i.value = m + ' EDITADA'; }, MARCA);
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /Guardar/i.test(x.textContent)); if (b) b.click(); });
    await dormir(1200);
    ok(/EDITADA/.test(db.prepare("SELECT texto FROM client_notes WHERE client_id=? AND active=1").get(cli).texto), '  y guarda de verdad lo que se escribe');
    // QUITAR: panel, y cancelar no borra.
    await page.evaluate(() => { const a = document.querySelector('a[data-ndel]'); if (a) a.click(); });
    await dormir(700);
    ok(/Quitar la nota/i.test((await panel(page) || {}).titulo || ''), 'quitar abre su panel');
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /No,/i.test(x.textContent)); if (b) b.click(); });
    await dormir(900);
    ok(db.prepare("SELECT COUNT(*) n FROM client_notes WHERE client_id=? AND active=1").get(cli).n === 1, '  y si se dice que NO, la nota sigue ahí');
    await page.evaluate(() => { const a = document.querySelector('a[data-ndel]'); if (a) a.click(); });
    await dormir(700);
    const botones = await page.evaluate(() => [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].map(b => b.textContent.trim()));
    await page.evaluate(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-foot button')].find(x => /^Sí/i.test(x.textContent.trim())); if (b) b.click(); });
    await dormir(1500);
    // OJO: quitar una nota la ARCHIVA (active=0), no la borra — regla permanente del proyecto. La
    // primera versión contaba las filas de la tabla y daba rojo sobre un producto que hacía lo
    // correcto. Se cuenta lo que se VE, que es lo activo, y se comprueba aparte que la fila sigue.
    ok(db.prepare("SELECT COUNT(*) n FROM client_notes WHERE client_id=? AND active=1").get(cli).n === 0,
       '  y si se dice que sí, se quita de la vista', 'botones del panel: ' + JSON.stringify(botones));
    ok(db.prepare("SELECT COUNT(*) n FROM client_notes WHERE client_id=?").get(cli).n === 1,
       '  archivándola, no destruyéndola (regla permanente del proyecto)');
    ok((await intentos(page)).length === 0, 'sin una sola ventanita en toda la ficha');
    ok(errores.length === 0, 'sin errores de JavaScript', errores.join(' | ') || 'ninguno');
    await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto7-panel.png') });
    await page.close();
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] EL SUPERADMIN, que tiene otro panel y también se quedó sin ventanitas');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const page = await ctx.newPage();
    await page.evaluateOnNewDocument(NEUTRALIZAR);
    const errores = [];
    page.on('pageerror', e => errores.push(String(e && e.message || e)));
    await page.goto(BASE.replace(SLUG + '.', '') + '/superadmin/login', { waitUntil: 'networkidle0' }).catch(() => {});
    await dormir(500);
    const tieneFn = await page.evaluate(() => typeof window.saConfirmar === 'function');
    // En la pantalla de login no hay layout, así que solo se comprueba que la página vive; la
    // función se comprueba en el fichero, que es lo que se puede afirmar sin una sesión de superadmin.
    const src = (await import('fs')).readFileSync(path.join(RAIZ, 'modules/superadmin/layout.js'), 'utf8');
    ok(/window\.saConfirmar\s*=/.test(src), 'el superadmin tiene su propio confirmar-en-la-página');
    // Se mide con el MISMO censo que el resto, que sabe saltarse los comentarios. Mirar el fichero
    // con una expresión a pelo contaba la nota que explica la avería como si fuera la avería.
    ok(!/superadmin/.test(censo), '  y su layout no llama a confirm() ni una vez (según el censo)');
    ok(errores.length === 0, 'y su login sigue vivo', errores.join(' | ') || 'ninguno');
    console.log('  · no se prueba pulsando: haría falta una sesión de superadmin, y este gate no la abre.');
    await page.close();
  }

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM client_notes WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'GSV-%')").run();
    db.prepare("DELETE FROM client_activities WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'GSV-%')").run();
    db.prepare("DELETE FROM clients WHERE name LIKE 'GSV-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
