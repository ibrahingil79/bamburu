// Gate de navegador — D5b · Propuestas de DISA: PAGO A PROVEEDOR POR VENCER.
// Contra el servidor real (tenant desarrollo-bamburu). Determinista (sin modelo).
//
// Comprueba EN EL NAVEGADOR lo que el gate de modelo no puede:
//   1. El dueño ve la propuesta con sus datos reales (proveedor, nº, importe, vencimiento, días).
//   2. PERMISOS — quien NO tiene permiso de compras NO ve la propuesta de pago (ni en el panel, ni
//      en la API, ni en el badge). El candado es el MISMO que el de /admin/pagos.
//   3. Quien puede VER compras pero no CREAR pagos ve la propuesta SIN el botón de aprobar, y el
//      endpoint que la cierra le responde 403 (no hay puerta trasera por la API).
//   4. "Aprobar y registrar pago" abre el MISMO modal del botón "Pagar", PRECARGADO con lo pendiente.
//   5. E2E: registrar el pago desde la propuesta → el pago queda en supplier_payments, la propuesta
//      se cierra y desaparece del panel.
//   6. El nombre del proveedor va ESCAPADO (sin XSS) y no hay errores JS.
// Limpia tras de sí: borra SUS fixtures (proveedor, factura, pagos, propuestas y usuarios de prueba).
//   node scripts/gate-propuestas-pagos-permisos.mjs
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { borrarFacturaProveedor, contarHuerfanos } from './lib/limpiar-asientos.mjs';

const DB_PATH = '/home/ubuntu/bamburu/data/tenants/desarrollo-bamburu.db';
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const TODAY = new Date().toISOString().slice(0, 10);
const dias = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
// 24 ago 2026 · Se cuenta la basura del libro ANTES y DESPUÉS. Ver scripts/lib/limpiar-asientos.mjs.
const huerfanosAntes = contarHuerfanos(db);
const PERM = Object.fromEntries(db.prepare("SELECT module||'.'||action AS code, id FROM permissions").all().map(r => [r.code, r.id]));

// ── Fixtures. Todo lo que creo lo borro al final; no toco un solo dato real. ──────────────
const SUFIJO = randomBytes(3).toString('hex');
const XSS = '<img src=x onerror=alert(1)>';
const SUP_NAME = 'ZZ Proveedor D5b ' + XSS + ' ' + SUFIJO;
const creados = { users: [], sessions: [], supplier: null, invoice: null };

function crearUsuario(nombre, perms) {
  const email = 'zz-d5b-' + nombre + '-' + SUFIJO + '@bamburu.test';
  const uid = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run('ZZ ' + nombre, email, 'x').lastInsertRowid;
  for (const p of perms) {
    if (!PERM[p]) throw new Error('permiso inexistente: ' + p);
    db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, PERM[p]);
  }
  creados.users.push(uid);
  return uid;
}
function sesion(uid) {
  const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(token, uid, now, now + 1800, csrf);
  creados.sessions.push(token);
  return { token, csrf };
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium',
  args: ['--no-sandbox'],
});

// Abre una página autenticada como `uid`, capturando errores JS y diálogos (XSS).
//
// CADA USUARIO EN SU PROPIO CONTEXTO DE NAVEGADOR. Es imprescindible: page.setCookie escribe en el
// tarro de cookies COMPARTIDO por todas las páginas del contexto, así que abrir una segunda sesión
// pisaría la cookie 'asess' de la primera y la página del dueño pasaría a ser la del empleado. Un
// contexto por usuario = un tarro de cookies por usuario, y las sesiones no se pisan.
const contextos = [];
async function pageComo(uid) {
  const { token } = sesion(uid);
  const ctx = await (browser.createBrowserContext?.() ?? browser.createIncognitoBrowserContext());
  contextos.push(ctx);
  const page = await ctx.newPage();
  const errores = [], dialogos = [];
  page.on('pageerror', e => errores.push(String(e.message)));
  page.on('dialog', async d => { dialogos.push(d.message()); await d.dismiss(); });
  await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });
  return { page, errores, dialogos };
}
const propuestasApi = page => page.evaluate(async () => {
  const r = await fetch('/api/erp/propuestas', { headers: { 'Accept': 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
});
// Botones REALMENTE pintados en el panel. Mirar el HTML crudo no sirve: el <script> del panel lleva
// dentro el texto de todos los botones posibles, se pinten o no.
const botonesPintados = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#propList button')).map(b => (b.textContent || '').trim()));

try {
  // ── Fixture: proveedor + factura de compra que vence en 3 días ────────────────────────
  console.log('\n[0] Fixture');
  creados.supplier = db.prepare('INSERT INTO suppliers (name, active) VALUES (?,1)').run(SUP_NAME).lastInsertRowid;
  creados.invoice = db.prepare(
    `INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date,
                                    base, tax, total, status, supplier_name)
     VALUES (?,?,?,?,?,?,?,?,'vigente',?)`
  ).run(creados.supplier, 'D5B-' + SUFIJO, 'PROV-' + SUFIJO, dias(-10), dias(3), 240, 0, 240, SUP_NAME).lastInsertRowid;
  ok(!!creados.invoice, `factura de compra de prueba: 240,00 € vence el ${dias(3)} (en 3 días)`);

  // ── 1. El dueño ve la propuesta, con datos reales ─────────────────────────────────────
  console.log('\n[1] El dueño ve la propuesta');
  const dueño = await pageComo(2);
  await dueño.page.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  // El panel genera al abrirse (como el cron). Se espera a que la tarjeta esté pintada de verdad.
  await dueño.page.waitForFunction(
    code => document.getElementById('propList').innerText.includes(code),
    { timeout: 15000 }, 'D5B-' + SUFIJO,
  ).catch(() => {});
  const mia = db.prepare('SELECT * FROM disa_proposals WHERE supplier_invoice_id=?').get(creados.invoice);
  ok(!!mia && mia.type === 'pago_por_vencer' && mia.status === 'pendiente',
     'al abrir el panel, DISA genera la propuesta de pago (como el cron)');

  const tarjeta = await dueño.page.evaluate(id => {
    const el = document.getElementById('prop' + id);
    return el ? el.innerText : null;
  }, mia.id);
  ok(!!tarjeta, 'la propuesta se pinta en el panel');
  ok(/240[.,]00/.test(tarjeta), 'muestra el importe pendiente (240,00)');
  ok(tarjeta.includes('D5B-' + SUFIJO), 'muestra el nº de factura');
  ok(tarjeta.includes(dias(3)), 'muestra la fecha de vencimiento');
  ok(/vence en 3 d[ií]as/i.test(tarjeta), 'muestra los días que faltan ("vence en 3 días")');
  ok(tarjeta.includes('ZZ Proveedor D5b'), 'muestra el proveedor');
  ok(/Aprobar y registrar pago/i.test(tarjeta), 'el dueño ve el botón "Aprobar y registrar pago"');
  ok(!/Aprobar y enviar/i.test(tarjeta), 'NO ofrece enviar un email: a un proveedor no se le avisa de que se le va a pagar');
  ok(dueño.dialogos.length === 0, 'el nombre del proveedor va ESCAPADO (0 diálogos: sin XSS)');
  ok(dueño.errores.length === 0, `0 errores JS en el panel${dueño.errores.length ? ' — ' + dueño.errores[0] : ''}`);

  // ── 2. Sin permiso de compras → NO ve la propuesta de pago ────────────────────────────
  console.log('\n[2] Permisos — quien no tiene permiso de pagos NO la ve');
  const uSoloCobros = crearUsuario('cobros', ['invoices.read', 'cobros.read']);
  const soloCobros = await pageComo(uSoloCobros);
  await soloCobros.page.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  const apiCobros = await propuestasApi(soloCobros.page);
  const dePago = (apiCobros.body.propuestas || []).filter(p => p.type === 'pago_por_vencer');
  ok(apiCobros.status === 200, 'un usuario solo de cobros SÍ entra al panel (ve las suyas)');
  ok(dePago.length === 0, 'la API NO le devuelve ni una propuesta de pago');
  const pintadoCobros = await soloCobros.page.evaluate(() => document.getElementById('propList').innerText);
  ok(!pintadoCobros.includes('D5B-' + SUFIJO), 'la propuesta de pago NO aparece en su pantalla');
  ok(!(await botonesPintados(soloCobros.page)).some(t => /registrar pago/i.test(t)), 'no ve el botón de registrar pago');
  // El badge del riel no debe delatarla: cuenta solo lo que puede abrir.
  const badgeCobros = await soloCobros.page.evaluate(() => {
    const el = document.getElementById('propCount');
    return el ? (el.textContent || '').trim() : '';
  });
  const nImpagoPend = db.prepare("SELECT COUNT(*) n FROM disa_proposals WHERE status='pendiente' AND type='recordatorio_impago'").get().n;
  ok(String(badgeCobros) === String(nImpagoPend || ''), `su badge cuenta SOLO sus tipos (${badgeCobros || '0'} = impagos pendientes ${nImpagoPend})`);

  // ── 3. Puede ver compras, pero no crear pagos → sin botón, y la API le dice 403 ───────
  console.log('\n[3] Permisos — ver compras sin poder pagar');
  const uSoloVer = crearUsuario('vercompras', ['purchases.read']);
  const soloVer = await pageComo(uSoloVer);
  await soloVer.page.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  const apiVer = await propuestasApi(soloVer.page);
  const suyas = (apiVer.body.propuestas || []).filter(p => p.type === 'pago_por_vencer');
  ok(suyas.length >= 1, 'con purchases.read SÍ ve la propuesta de pago');
  const pintadoVer = await soloVer.page.evaluate(() => document.getElementById('propList').innerText);
  ok(!(await botonesPintados(soloVer.page)).some(t => /registrar pago/i.test(t)),
     'pero NO ve el botón de aprobar (le falta purchases.create)');
  ok(/Necesitas permiso de compras/i.test(pintadoVer), 'se le explica por qué no puede');
  // Y por la API tampoco: el cierre de la propuesta exige el MISMO permiso que el pago.
  const forzar = await soloVer.page.evaluate(async id => {
    const r = await fetch('/api/erp/propuestas/' + id + '/registrado', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    return r.status;
  }, mia.id);
  ok(forzar === 403, `forzar el cierre por la API → 403 (no hay puerta trasera; devolvió ${forzar})`);
  const pagosDelForzado = db.prepare('SELECT COUNT(*) n FROM supplier_payments WHERE supplier_invoice_id=?').get(creados.invoice).n;
  ok(pagosDelForzado === 0, 'y no se registró ningún pago');
  ok(db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(mia.id).status === 'pendiente', 'la propuesta sigue pendiente');

  // ── 4 y 5. El dueño aprueba: modal precargado → pago registrado → propuesta cerrada ───
  console.log('\n[4] Aprobar abre el MISMO modal, precargado con lo pendiente');
  await dueño.page.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  // Esperar al BOTÓN, no a un reloj: el panel genera los dos tipos al abrirse y eso tarda lo que tarda.
  const btnAprobar = '#prop' + mia.id + ' .btn-primary';
  try {
    await dueño.page.waitForSelector(btnAprobar, { visible: true, timeout: 15000 });
  } catch (e) {
    const diag = await dueño.page.evaluate(() => ({
      url: location.pathname,
      lista: (document.getElementById('propList') || {}).innerText?.slice(0, 200) || '(sin #propList)',
      cards: document.querySelectorAll('.prop-card').length,
    }));
    console.error('  · DIAG: url=' + diag.url + ' cards=' + diag.cards + ' errores=' + JSON.stringify(dueño.errores.slice(0, 2)));
    console.error('  · DIAG lista: ' + diag.lista.replace(/\n/g, ' | '));
    throw e;
  }
  await dueño.page.click(btnAprobar);
  await dueño.page.waitForSelector('#spay-amount', { visible: true, timeout: 5000 });
  const precarga = await dueño.page.$eval('#spay-amount', el => el.value);
  ok(Math.abs(Number(precarga) - 240) < 0.005, `el modal viene PRECARGADO con el importe pendiente (${precarga})`);
  const tituloModal = await dueño.page.$eval('#pagoTitle', el => el.textContent);
  ok(/D5B-/.test(tituloModal), `es el modal de pago de ESA factura ("${tituloModal}")`);

  console.log('\n[5] E2E — registrar el pago desde la propuesta');
  await dueño.page.click('#pagoBody .btn-primary');          // "Registrar pago"
  // SE ESPERA A LA CONDICIÓN, NO AL RELOJ. Aquí había un `setTimeout` de 1.500 ms fijos, y esa era
  // toda la causa de que este gate cayera en el barrido: registrar el pago va al servidor, y con
  // otros veinte gates encima y el freno de peticiones de por medio no siempre había terminado a los
  // 1,5 s — el gate leía la base antes de tiempo y cantaba las TRES aserciones de golpe. Los datos
  // nunca estuvieron pisados: ya filtran por SU factura y por SU propuesta. Ahora se espera a que el
  // pago exista, hasta 20 s, y se sale en cuanto está: rápido cuando no hay carga y paciente cuando
  // la hay. Con esto el gate deja de necesitar correr solo.
  let pagos = [];
  for (let i = 0; i < 80; i++) {
    pagos = db.prepare('SELECT * FROM supplier_payments WHERE supplier_invoice_id=?').all(creados.invoice);
    if (pagos.length) break;
    await new Promise(r => setTimeout(r, 250));
  }
  // Y un respiro corto para que el servidor termine de cerrar la propuesta, que va en la misma
  // transacción lógica pero se lee de otra tabla.
  for (let i = 0; i < 40 && pagos.length; i++) {
    const p = db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(mia.id);
    if (p && p.status === 'aprobada_registrada') break;
    await new Promise(r => setTimeout(r, 250));
  }
  ok(pagos.length === 1 && Math.abs(pagos[0].amount - 240) < 0.005,
     `queda UN pago real de 240,00 en supplier_payments (el mismo camino que el botón "Pagar")`);
  const tras = db.prepare('SELECT status, resolved_by FROM disa_proposals WHERE id=?').get(mia.id);
  ok(tras.status === 'aprobada_registrada', 'la propuesta queda cerrada (aprobada_registrada)');
  ok(!!tras.resolved_by, `queda rastro de quién la aprobó ("${tras.resolved_by}")`);
  // Y AL PANEL TAMBIÉN SE LE ESPERA POR CONDICIÓN. El `setTimeout` que había antes le daba de
  // rebote el tiempo de repintarse; al salir en cuanto el pago está en la base, había que pedírselo
  // explícitamente. Se espera a que la tarjeta desaparezca, no a que pase un rato.
  await dueño.page.waitForFunction(id => !document.getElementById('prop' + id), { timeout: 15000 }, mia.id)
    .catch(() => {});
  const sigueEnPanel = await dueño.page.evaluate(id => !!document.getElementById('prop' + id), mia.id);
  ok(!sigueEnPanel, 'la propuesta desaparece del panel al quedar atendida');
  ok(dueño.errores.length === 0, `0 errores JS en todo el flujo${dueño.errores.length ? ' — ' + dueño.errores[0] : ''}`);
  ok(dueño.dialogos.length === 0, '0 diálogos (sin XSS) en todo el flujo');

  // Y no se re-propone.
  await dueño.page.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  const reprop = db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE supplier_invoice_id=?').get(creados.invoice).n;
  ok(reprop === 1, 'reabrir el panel NO vuelve a proponer esa factura (idempotencia)');
} catch (e) {
  // Sin esto, el process.exit() del finally se traga la excepción y el gate "falla en silencio".
  fail++;
  console.error('\n  ✗ EXCEPCIÓN: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
} finally {
  await browser.close().catch(() => {});
  // ── Limpieza: solo lo que creó ESTE gate. La BD viva queda como estaba. ──────────────
  try {
    if (creados.invoice) {
      db.prepare('DELETE FROM disa_proposals WHERE supplier_invoice_id=?').run(creados.invoice);
      // La factura, sus pagos y los ASIENTOS de ambos, en ese orden: los asientos no cuelgan de ninguna
      // clave ajena, así que el CASCADE no se los lleva. Ver scripts/lib/limpiar-asientos.mjs.
      borrarFacturaProveedor(db, [creados.invoice]);
    }
    if (creados.supplier) db.prepare('DELETE FROM suppliers WHERE id=?').run(creados.supplier);
    for (const t of creados.sessions) db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t);
    for (const u of creados.users) {
      db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(u);
      db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(u);
      db.prepare('DELETE FROM admin_users WHERE id=?').run(u);
    }
    const resto = db.prepare('SELECT COUNT(*) n FROM supplier_invoices WHERE internal_code=?').get('D5B-' + SUFIJO).n;
    console.log('\n· Limpieza: fixtures borrados (quedan ' + resto + ' facturas de prueba).');
  } catch (e) { console.error('· AVISO: limpieza incompleta: ' + e.message); }
  const huerfanosDespues = contarHuerfanos(db);
  ok(huerfanosDespues === huerfanosAntes,
     'limpieza: no deja asientos huérfanos en el libro (antes ' + huerfanosAntes + ', ahora ' + huerfanosDespues + ')');
  db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
