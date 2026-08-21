// Gate de navegador C1.a — flujo completo contra el servidor real (puerto 3000,
// tenant desarrollo-bamburu): crear borrador → editar → enviar (OC-NNNN + bloqueo)
// → imprimir (botón) → enviar email (proveedor con email) → anular → anular y
// rehacer (referencia visible). Verifica además 0 stock_movements nuevos.
//
// DOS COSAS QUE ESTE GATE APRENDIÓ POR LAS MALAS:
//
//   1. LA UI YA NO USA alert(), USA toast(). El gate esperaba un `dialog` de Chromium que hoy no
//      llega nunca. Y no fallaba solo esa aserción: la respuesta que dejaba preparada para el alert
//      fantasma se quedaba en la cola y se la comía el prompt() SIGUIENTE, que recibía basura → se
//      anulaba con un motivo vacío, la página no navegaba, y el gate moría en un timeout que no
//      tenía nada que ver con la causa. Ahora se encola SOLO lo que la página pregunta de verdad,
//      y los avisos se afirman leyendo el toast REAL (ver engancharToasts).
//
//   2. MANDABA UN EMAIL DE VERDAD AL DUEÑO EN CADA PASADA. El envío se sigue probando CONTRA RESEND
//      DE VERDAD —es lo que hay que probar—, pero contra su buzón sumidero de pruebas
//      (delivered@resend.dev), no contra la bandeja de nadie. El email del proveedor se restaura al
//      terminar.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, engancharToasts, esperarToast } from './lib/gate-env.mjs';
import { purgarArtefactos, productoDePrueba } from './lib/gate-fixtures.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
// Buzón sumidero de Resend: acepta y confirma la entrega, pero no aterriza en la bandeja de nadie.
// Un barrido de regresión no puede tener como efecto secundario escribirle al dueño.
const SINK_EMAIL = 'delivered@resend.dev';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// ── Preparación: sesión + proveedor con email del dueño (se restaura al final) ──
const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, csrf);
const supOrig = db.prepare('SELECT id, email FROM suppliers WHERE id=1').get();
db.prepare('UPDATE suppliers SET email=? WHERE id=1').run(SINK_EMAIL);
const movBefore = db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c;
const poBefore = db.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c;

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await engancharToasts(page);
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

// Cola de respuestas a los diálogos REALES de la página: confirm() y prompt(), y nada más. Encolar
// de más es tan peligroso como encolar de menos: un sobrante se lo traga el diálogo siguiente.
// Si la página abre un diálogo que nadie ha encolado, el gate tiene que ENTERARSE.
// Rastro de lo que crea el gate (3 órdenes: la del flujo, la 2ª y el sustituto de anular-y-rehacer).
// Se purga por ID al final: una orden no mueve stock, pero dejar documentos de prueba tirados en el
// tenant en cada pasada también es ensuciar.
const creado = { ordenes: [], productos: [] };
let correoAntes = null;   // cómo estaba el interruptor de «orden de compra» antes de tocarlo

const dialogQueue = [];
const dialogosInesperados = [];
page.on('dialog', async d => {
  if (!dialogQueue.length) {
    dialogosInesperados.push(d.type() + ': ' + d.message());
    await d.dismiss();
    return;
  }
  const next = dialogQueue.shift();
  if (next === undefined) await d.accept();
  else if (next === false) await d.dismiss();
  else await d.accept(typeof next === 'string' ? next : undefined);
});

try {
  // ── 1. Lista ──
  await page.goto(BASE + '/admin/purchase-orders', { waitUntil: 'networkidle0' });
  ok((await page.content()).includes('Órdenes de compra'), 'lista carga');
  ok(await page.$('a[href="/admin/purchase-orders/new"]') !== null, 'botón "Nueva orden" visible');

  // ── 2. Crear borrador con 2 líneas vía buscador ──
  // EL GATE SE TRAE SUS PRODUCTOS, no busca dos del negocio por su nombre. Buscaba «Vela Lavanda» y
  // «Vela Vainilla», y al resembrar el negocio con datos de taller esos dos quedaron ARCHIVADOS: el
  // buscador de líneas dejó de sugerirlos y el gate moría con un timeout de 30 s, sin decir por qué.
  // Es la misma trampa que se llevó por delante a los gates que dependían del proveedor «Aromas»:
  // una precondición ajena que nadie mantiene. Con producto propio, el escenario es del gate.
  const pA = productoDePrueba(db, 'Compra A');
  const pB = productoDePrueba(db, 'Compra B');
  creado.productos.push(pA.id, pB.id);
  // …Y SE CREAN **ANTES** DE ABRIR LA PANTALLA: el buscador de líneas no consulta al servidor, filtra
  // sobre un catálogo que la página se lleva cargado al pintarse. Creándolos después no existían
  // para el buscador, y el timeout era exactamente el mismo — el mismo síntoma por otra causa.
  await page.goto(BASE + '/admin/purchase-orders/new', { waitUntil: 'networkidle0' });
  await page.select('#fSupplier', '1');

  async function fillLine(rowIndex, query, qty, cost) {
    const rows = await page.$$('#lines-body tr');
    const row = rows[rowIndex];
    const desc = await row.$('.line-desc');
    await desc.click({ clickCount: 3 });
    await desc.type(query, { delay: 20 });
    await page.waitForFunction((i) =>
      document.querySelectorAll('#lines-body tr')[i].querySelector('.line-suggest').style.display !== 'none', {}, rowIndex);
    await page.evaluate((i) => {
      document.querySelectorAll('#lines-body tr')[i].querySelector('.line-suggest .suggest-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }, rowIndex);
    await page.evaluate((i, q, co) => {
      const r = document.querySelectorAll('#lines-body tr')[i];
      r.querySelector('.line-qty').value = q;
      if (co !== null) r.querySelector('.line-cost').value = co;
      r.querySelector('.line-qty').dispatchEvent(new Event('input'));
      r.querySelector('.line-cost').dispatchEvent(new Event('input'));
    }, rowIndex, String(qty), cost === null ? null : String(cost));
  }

  await fillLine(0, pA.name, 3, '2.50');
  await page.click('.card-head button.btn-secondary');   // + Añadir línea
  await fillLine(1, pB.name, 2, '1.80');

  const pid0 = await page.$eval('#lines-body tr .line-pid', el => el.value);
  ok(pid0 !== '', 'la línea resolvió a un product_id real (sin línea libre)');
  const foot = await page.$eval('#totals-foot', el => el.textContent);
  ok(foot.includes('Base imponible') && foot.includes('IVA 21%') && foot.includes('Total'), 'pie en vivo: Base + IVA por tasa + Total');
  // 3×2.50 + 2×1.80 = 11.10 base; IVA por línea redondeado y sumado (1.58 + 0.76)
  // = 2.34; total 13.44 — misma matemática que computeTotals en el servidor.
  ok(foot.includes('11.10') && foot.includes('2.34') && foot.includes('13.44'), 'pie cuadra (11.10 / 2.34 / 13.44)');

  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#btn-save')]);
  const docUrl = page.url();
  const orderId = parseInt(docUrl.match(/purchase-orders\/(\d+)/)[1]);
  creado.ordenes.push(orderId);
  let body = await page.content();
  ok(body.includes('Borrador (sin número)'), 'documento de borrador sin número');
  ok(body.includes('>Editar<') && body.includes('Enviar</button>'), 'borrador: botones Editar y Enviar');
  ok(body.includes('window.print()'), 'botón Imprimir (window.print)');
  // (Era una tautología: `x === x`, una aserción que NO podía fallar. Un check que siempre pasa es
  //  un falso verde en miniatura. Ahora afirma lo que decía afirmar: el proveedor, en la cabecera.)
  ok(body.includes('Aromas del Sur'), 'cabecera con el proveedor en vivo (Aromas del Sur)');
  await page.screenshot({ path: '/tmp/po-gate-1-borrador.png' });

  // ── 3. Editar el borrador ──
  await page.goto(BASE + `/admin/purchase-orders/${orderId}/edit`, { waitUntil: 'networkidle0' });
  const seeded = await page.$$eval('#lines-body tr', rows => rows.length);
  ok(seeded === 2, 'editar: las 2 líneas precargadas');
  await page.evaluate(() => {
    const r = document.querySelectorAll('#lines-body tr')[0];
    r.querySelector('.line-qty').value = '5';
    r.querySelector('.line-qty').dispatchEvent(new Event('input'));
  });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#btn-save')]);
  body = await page.content();
  ok(body.includes('>5</td>'), 'edición guardada (cantidad 3 → 5)');

  // ── 4. Enviar: gana OC-NNNN y se bloquea ──
  dialogQueue.push(undefined);                     // confirm() — y NADA más: ya no hay alert()
  await page.evaluate(() => enviarOrden());
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  body = await page.content();
  const ocMatch = body.match(/OC-\d{4,}/);
  ok(!!ocMatch, 'la orden enviada muestra su número ' + (ocMatch ? ocMatch[0] : ''));
  ok(!body.includes('>Editar<'), 'enviada: botón Editar desaparece');
  ok(body.includes('Enviar por email') && body.includes('Anular y rehacer'), 'enviada: acciones email/anular/anular-y-rehacer');
  await page.screenshot({ path: '/tmp/po-gate-2-enviada.png' });

  // PUT sobre enviada → rechazado por el backend
  const putRes = await page.evaluate(async (id, csrfTok) => {
    const r = await fetch('/api/erp/purchase-orders/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfTok },
      body: JSON.stringify({ supplier_id: 1, date: '2026-06-10', items: [{ product_id: 1, quantity: 1, unit_cost: 1 }] }),
    });
    return { status: r.status, body: await r.json() };
  }, orderId, csrf);
  ok(putRes.status === 400 && /borrador/.test(putRes.body.error || ''), 'PUT sobre enviada → 400 con error claro');

  // editar por URL también rebota al documento
  await page.goto(BASE + `/admin/purchase-orders/${orderId}/edit`, { waitUntil: 'networkidle0' });
  ok(!page.url().endsWith('/edit'), 'GET /edit de una enviada redirige al documento');

  // ── 5. Enviar por email — envío REAL por Resend, al buzón sumidero ──
  //     El aviso ya no es un alert() sino un toast: se espera al toast REAL, sin dormir a ciegas.
  //     Si Resend fallara, el servicio lanza y la UI pinta un toast de error → la aserción cae.
  // EL INTERRUPTOR DE «AVISOS Y CORREOS» TIENE QUE ESTAR ENCENDIDO. Desde que existe
  // `exigirCorreoActivo`, mandar un correo apagado no sale y responde 409 — y en este negocio están
  // todos apagados. El gate es más viejo que ese guardián y no lo sabía: los tres fallos del envío
  // eran el producto haciendo lo correcto. Se enciende aquí y se deja como estaba en la limpieza.
  correoAntes = db.prepare("SELECT activo FROM email_tipo_pref WHERE tipo='orden_compra'").get() || null;
  db.prepare(`INSERT INTO email_tipo_pref (tipo, activo, updated_at) VALUES ('orden_compra', 1, CURRENT_TIMESTAMP)
              ON CONFLICT(tipo) DO UPDATE SET activo=1, updated_at=CURRENT_TIMESTAMP`).run();
  await page.goto(BASE + `/admin/purchase-orders/${orderId}`, { waitUntil: 'networkidle0' });
  dialogQueue.push(undefined);                     // confirm() — el resultado llega por toast
  await page.evaluate(() => emailOrden());
  const avisoEmail = await esperarToast(page, /email/i, 30000);
  ok(!!avisoEmail, 'la UI avisa del resultado del envío: ' + JSON.stringify(avisoEmail && avisoEmail.msg));
  ok(avisoEmail && avisoEmail.tipo !== 'err', 'el envío NO devolvió error de Resend');
  ok(avisoEmail && avisoEmail.msg === 'Enviada por email a ' + SINK_EMAIL,
     'email enviado por Resend a ' + SINK_EMAIL + ' (toast exacto)');

  // ── 6. Anular (pide motivo) ──
  dialogQueue.push('precio pactado incorrecto');   // prompt
  await page.evaluate(() => anularOrden());
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('Orden anulada') && body.includes('precio pactado incorrecto'), 'anulada con su motivo visible');
  ok(!body.includes('Enviar por email'), 'anulada: sin acciones de enviada');
  await page.screenshot({ path: '/tmp/po-gate-3-anulada.png' });

  // ── 7. Anular y rehacer (sobre una segunda orden) ──
  const create2 = await page.evaluate(async (csrfTok) => {
    const r = await fetch('/api/erp/purchase-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfTok },
      body: JSON.stringify({ supplier_id: 1, date: '2026-06-10', items: [{ product_id: 2, quantity: 4, unit_cost: 2.10 }] }),
    });
    return r.json();
  }, csrf);
  creado.ordenes.push(create2.id);
  await page.goto(BASE + `/admin/purchase-orders/${create2.id}`, { waitUntil: 'networkidle0' });
  dialogQueue.push(undefined);                     // confirm()
  await page.evaluate(() => enviarOrden());
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  const oc2 = (await page.content()).match(/OC-\d{4,}/)[0];

  dialogQueue.push('cantidad equivocada');         // prompt de anular-y-rehacer
  await page.evaluate(() => anularYRehacer());
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  ok(page.url().endsWith('/edit'), 'anular-y-rehacer aterriza en el borrador nuevo (editable)');
  creado.ordenes.push(parseInt(page.url().match(/purchase-orders\/(\d+)/)[1]));   // el sustituto
  body = await page.content();
  ok(body.includes('Sustituye a') && body.includes(oc2), 'el borrador nuevo muestra "Sustituye a ' + oc2 + ' (anulada)"');
  const seeded2 = await page.$$eval('#lines-body tr', rows => rows.length);
  ok(seeded2 === 1, 'líneas precargadas en el sustituto');
  await page.screenshot({ path: '/tmp/po-gate-4-sustituto.png' });

  // documento de la anulada enlaza al sustituto
  await page.goto(BASE + `/admin/purchase-orders/${create2.id}`, { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('cantidad equivocada') && body.includes('La sustituye'), 'la anulada enlaza a la orden que la sustituye');

  // ── 8. Lista con datos + filtro por estado ──
  await page.goto(BASE + '/admin/purchase-orders?estado=anulada', { waitUntil: 'networkidle0' });
  body = await page.content();
  ok(body.includes('Anulada') && !body.includes('>Borrador</span>'), 'filtro por estado funciona');
  await page.goto(BASE + '/admin/purchase-orders', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/tmp/po-gate-5-lista.png' });

  // ── 9. Ningún diálogo sorpresa: si la página abriera un alert/confirm que el gate no espera,
  //       la cola se descuadraría y el siguiente prompt recibiría basura. Es exactamente como se
  //       rompió este gate cuando la UI cambió de alert() a toast(). Que se vea.
  ok(dialogosInesperados.length === 0, 'ningún diálogo inesperado' + (dialogosInesperados.length ? ': ' + JSON.stringify(dialogosInesperados) : ''));

} finally {
  await browser.close();
  // ── Cuadre final + restauración ──
  const db2 = new Database(DB_PATH);
  const movAfter = db2.prepare('SELECT COUNT(*) c FROM stock_movements').get().c;
  ok(movAfter === movBefore, `stock_movements intactos (${movBefore} → ${movAfter}): la orden NO mueve stock`);

  // Limpieza: se lleva por delante las órdenes que creó el gate (no movieron stock, pero son basura).
  // El interruptor vuelve a como estaba: si no había fila, se borra; si la había, su valor.
  try {
    if (correoAntes == null) db2.prepare("DELETE FROM email_tipo_pref WHERE tipo='orden_compra'").run();
    else db2.prepare("UPDATE email_tipo_pref SET activo=? WHERE tipo='orden_compra'").run(correoAntes.activo);
  } catch {}
  purgarArtefactos(db2, creado);
  const poAfter = db2.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c;
  ok(poAfter === poBefore, `el tenant queda como estaba: purchase_orders vuelve a ${poBefore} (got ${poAfter})`);

  db2.prepare('UPDATE suppliers SET email=? WHERE id=1').run(supOrig.email);   // restaurar email original
  const supAhora = db2.prepare('SELECT email FROM suppliers WHERE id=1').get().email;
  ok(supAhora === supOrig.email, 'el email del proveedor queda restaurado (' + JSON.stringify(supAhora) + ')');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);          // limpiar la sesión del test
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador C1.a: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
