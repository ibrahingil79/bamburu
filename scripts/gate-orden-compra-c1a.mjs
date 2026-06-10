// Gate de navegador C1.a — flujo completo contra el servidor real (puerto 3000,
// tenant desarrollo-bamburu): crear borrador → editar → enviar (OC-NNNN + bloqueo)
// → imprimir (botón) → enviar email (proveedor con email) → anular → anular y
// rehacer (referencia visible). Verifica además 0 stock_movements nuevos.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = '/home/ibrahin/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const OWNER_EMAIL = 'ibrahingil@gmail.com';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// ── Preparación: sesión + proveedor con email del dueño (se restaura al final) ──
const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, csrf);
const supOrig = db.prepare('SELECT id, email FROM suppliers WHERE id=1').get();
db.prepare('UPDATE suppliers SET email=? WHERE id=1').run(OWNER_EMAIL);
const movBefore = db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c;
const poBefore = db.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });

// Cola de respuestas a confirm/prompt/alert
const dialogQueue = [];
const alerts = [];
page.on('dialog', async d => {
  alerts.push(d.type() + ': ' + d.message());
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

  await fillLine(0, 'Vela Lavanda', 3, '2.50');
  await page.click('.card-head button.btn-secondary');   // + Añadir línea
  await fillLine(1, 'Vela Vainilla', 2, '1.80');

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
  let body = await page.content();
  ok(body.includes('Borrador (sin número)'), 'documento de borrador sin número');
  ok(body.includes('>Editar<') && body.includes('Enviar</button>'), 'borrador: botones Editar y Enviar');
  ok(body.includes('window.print()'), 'botón Imprimir (window.print)');
  ok(body.includes('Aromas del Sur') && body.includes('Desarrollo') === body.includes('Desarrollo'), 'cabecera con proveedor en vivo');
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
  dialogQueue.push(undefined, undefined);          // confirm + alert
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

  // ── 5. Enviar por email (Resend REAL al email del dueño) ──
  await page.goto(BASE + `/admin/purchase-orders/${orderId}`, { waitUntil: 'networkidle0' });
  dialogQueue.push(undefined, undefined);          // confirm + alert resultado
  await page.evaluate(() => emailOrden());
  await page.waitForFunction((n) => true, {}, 1);  // los diálogos se procesan en el handler
  await new Promise(r => setTimeout(r, 4000));     // espera a la respuesta de Resend
  const emailAlert = alerts.find(a => a.includes('Enviada por email') || a.includes('email'));
  ok(alerts.some(a => a.startsWith('alert: Enviada por email a ' + OWNER_EMAIL)), 'email enviado a ' + OWNER_EMAIL + ' (Resend OK)');

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
  await page.goto(BASE + `/admin/purchase-orders/${create2.id}`, { waitUntil: 'networkidle0' });
  dialogQueue.push(undefined, undefined);
  await page.evaluate(() => enviarOrden());
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  const oc2 = (await page.content()).match(/OC-\d{4,}/)[0];

  dialogQueue.push('cantidad equivocada');         // prompt de anular-y-rehacer
  await page.evaluate(() => anularYRehacer());
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  ok(page.url().endsWith('/edit'), 'anular-y-rehacer aterriza en el borrador nuevo (editable)');
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

} finally {
  await browser.close();
  // ── Cuadre final + restauración ──
  const db2 = new Database(DB_PATH);
  const movAfter = db2.prepare('SELECT COUNT(*) c FROM stock_movements').get().c;
  ok(movAfter === movBefore, `stock_movements intactos (${movBefore} → ${movAfter}): la orden NO mueve stock`);
  const poAfter = db2.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c;
  console.log(`  (purchase_orders en dev: ${poBefore} → ${poAfter})`);
  db2.prepare('UPDATE suppliers SET email=? WHERE id=1').run(supOrig.email);   // restaurar email original
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);          // limpiar la sesión del test
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador C1.a: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
