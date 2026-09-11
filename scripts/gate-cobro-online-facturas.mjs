// Gate de navegador — cobro-online-facturas (10 sep 2026, evolución de `enlace-pago-nivel-a`).
//
// MODELO A: cada autónomo conecta su PROPIA cuenta de Stripe (Connect, Express, cargos directos).
// El dinero nace y se queda en SU cuenta — Bamburu no lo toca, no lo retiene, no cobra comisión.
// Este gate prueba las dos mitades: (1) conectar la cuenta desde Ajustes, con Stripe DE VERDAD en
// modo prueba, y (2) el ciclo completo de una factura — botón, Checkout real, tarjeta de prueba,
// webhook y "pagada sola" — más el "marcar pagada a mano" que ya existía, sin tocarlo.
//
// POR QUÉ DOS NEGOCIOS. Una cuenta EXPRESS (la que crea el producto de verdad) solo se completa
// con el formulario ALOJADO por Stripe — no hay atajo de API para eso, y no lo hay a propósito
// (es la garantía de que Bamburu nunca ve los datos bancarios del autónomo). Así que:
//   · Negocio A prueba que EL BOTÓN «Conectar» de verdad crea una cuenta Express en Stripe y
//     redirige a la web de Stripe — lo NUESTRO, la mitad que si se rompe deja al autónomo sin
//     forma de empezar.
//   · Negocio B se conecta con una cuenta de tipo CUSTOM creada con los valores de prueba que
//     documenta Stripe para verificación instantánea (`docs.stripe.com/connect/testing`) — un
//     atajo SOLO para que el gate pueda probar el cobro de verdad sin un humano rellenando un
//     formulario de Stripe. El producto sigue creando cuentas EXPRESS; esto es fixture de prueba.
//
// EL WEBHOOK DE CONNECT NO LO MANDA STRIPE DE VERDAD (nadie ha creado ese endpoint en su
// Dashboard todavía — hace falta que Ibrahin lo dé de alta apuntando a
// https://bamburu.com/stripe/connect/webhook, con STRIPE_CONNECT_WEBHOOK_SECRET ya puesto como
// placeholder en /etc/bamburu.env). Así que el gate FIRMA el aviso él mismo, con el MISMO secreto
// que ya lee el servidor, sobre datos REALES del PaymentIntent que de verdad cobró Stripe — no un
// invento: se pide a Stripe el PaymentIntent real después del pago y se firma ESE payload.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { join } from 'path';
import { readFileSync, unlinkSync } from 'fs';
import { randomBytes, createHmac } from 'crypto';
import { launchOpts, APP_DIR } from './lib/gate-env.mjs';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { soltarAtaduras } from './lib/tirar-negocio.mjs';
import { stripeApi } from '../core/stripe.js';

let pass = 0, fail = 0;
const ok = (c, m, e = '') => { (c ? pass++ : fail++); console.log((c ? '  ✓ ' : '  ✗ FALLO: ') + m + (e ? ' — ' + e : '')); };
const TS = Date.now();
const creados = [];
const hoy = new Date().toISOString().slice(0, 10);

function envSecreto(nombre) {
  const env = readFileSync('/etc/bamburu.env', 'utf8');
  const m = env.match(new RegExp(`^${nombre}=(.+)$`, 'm'));
  if (!m) throw new Error(nombre + ' no está en /etc/bamburu.env');
  return m[1].trim();
}

// El MISMO cálculo que `verificarFirmaWebhook` (core/stripe.js) pero al revés: firma en vez de
// comprobar. Si algún día uno de los dos cambia de forma sin que el otro se entere, este gate cae.
function firmarWebhook(cuerpo, secreto, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

async function borrarTenant(slug) {
  const t = getTenantBySlug(slug);
  // ⚙️ 11 sep 2026 — con Connect YA ACTIVADO de verdad, el negocio A crea una cuenta Express REAL
  // en Stripe (antes de hoy, esto SIEMPRE estaba bloqueado por Stripe y nunca llegaba a crearse
  // nada — «lo que un gate crea, lo borra» no tenía nada que borrar aquí). Ahora sí lo crea, así
  // que hay que borrarla de Stripe también, no solo la fila local.
  const fila = t ? controlDb.prepare('SELECT account_id FROM stripe_connect_accounts WHERE tenant_id=?').get(t.id) : null;
  if (fila?.account_id) { try { await stripeApi('DELETE', `/accounts/${fila.account_id}`); } catch {} }
  soltarAtaduras(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  controlDb.prepare('DELETE FROM stripe_connect_accounts WHERE tenant_id=?').run(t?.id ?? -1);
  if (t) for (const s of ['', '-wal', '-shm']) { try { unlinkSync(join(APP_DIR, t.db_filename + s)); } catch {} }
}

async function negocio(etiqueta) {
  const r = await provisionTenant({
    businessName: 'GCOBRO ' + etiqueta + ' ' + TS, ownerName: 'Ana ' + etiqueta,
    email: 'gcobro-' + etiqueta + '-' + TS + '@t.local', password: 'contrasena-larga-123',
    country: 'ES', sector: 'taller', oficio: 'otro',
  });
  creados.push(r.slug);
  const db = new Database(join(APP_DIR, r.db_filename));
  const owner = db.prepare('SELECT id,name FROM admin_users WHERE active=1').get();
  const tok = randomBytes(24).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, owner.id, now, now + 7200, 'gcobro-csrf');
  db.prepare("UPDATE company_config SET company_name=?, fiscal_id='B00000000', address='Calle Falsa 1', email=? WHERE id=1")
    .run('GCOBRO ' + etiqueta, 'gcobro-' + etiqueta + '-' + TS + '@t.local');
  const tenant = getTenantBySlug(r.slug);
  return { slug: r.slug, id: tenant.id, db, owner, tok, base: 'https://' + r.slug + '.bamburu.com', cab: { cookie: 'asess=' + tok } };
}

function sembrar(n) {
  const db = n.db;
  const cli = db.prepare("INSERT INTO clients (name,fiscal_id,address,email,active,created_at) VALUES ('Cliente Gate','X1234567L','Calle Cliente 2','gcobro-cliente-" + TS + "@t.local',1,datetime('now'))").run().lastInsertRowid;
  const prod = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES ('Servicio Gate',100,'service','general',21,'active')").run().lastInsertRowid;
  // fiscal_treatment explícito — ver documentos.js/gate-documentos.mjs: el default de la columna
  // es 'pending' desde S5, y createInvoice rechaza una línea sin confirmar. Un cambio de UNA línea
  // en el fixture de ESTE gate, no en `productoDePrueba` (compartido por otros muchos gates).
  db.prepare("UPDATE products SET fiscal_treatment='taxable' WHERE id=?").run(prod);
  return { cli, prod };
}

const post = async (n, url, body) => {
  const r = await fetch(n.base + url, { method: 'POST', headers: { ...n.cab, 'content-type': 'application/json', 'x-csrf-token': 'gcobro-csrf' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const abre = async (n, url) => { const r = await fetch(n.base + url, { headers: n.cab }); return { status: r.status, redirected: r.redirected, url: r.url, html: await r.text() }; };

let b, page;
try {
  const SECRETO_CONNECT = envSecreto('STRIPE_CONNECT_WEBHOOK_SECRET');

  const A = await negocio('a');
  const B = await negocio('b');
  const sA = sembrar(A), sB = sembrar(B);

  // ── [1] SIN CUENTA CONECTADA: solo IBAN, ni rastro del botón ────────────────────────────────
  console.log('\n[1] sin cuenta de cobro conectada, la factura enseña solo el IBAN');
  B.db.prepare("INSERT INTO settings (key,value) VALUES ('portal_iban','ES9121000418450200051332') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const facturaB = await post(B, '/api/erp/invoices', { client_id: sB.cli, issue_date: hoy, lines: [{ product_id: sB.prod, description: 'Servicio Gate', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  ok(!!facturaB.body?.id, 'la factura de prueba se crea', 'factura ' + facturaB.body?.id + (facturaB.body?.error ? ' · ' + facturaB.body.error : ''));
  const facturaBId = facturaB.body?.id;
  const tokenB = B.db.prepare('SELECT 1 FROM clients WHERE id=?').get(sB.cli) ? await (async () => {
    const { createToken } = await import('../modules/portal/portal.js');
    return createToken(B.db, sB.cli, 14);
  })() : null;
  const canjeoB = await fetch(B.base + '/portal/' + tokenB, { redirect: 'manual' });
  const cookieB = (canjeoB.headers.get('set-cookie') || '').split(';')[0];
  const portalB = await fetch(B.base + '/portal', { headers: { cookie: cookieB } });
  const htmlPortalBAntes = await portalB.text();
  ok(htmlPortalBAntes.includes('ES9121000418450200051332'), 'el portal enseña el IBAN', 'contiene IBAN');
  ok(!htmlPortalBAntes.includes('Pagar con tarjeta'), 'y NO enseña el botón de tarjeta todavía', 'sin botón');

  // ── [2] CONECTAR (negocio A) — Stripe DE VERDAD, modo prueba ────────────────────────────────
  console.log('\n[2] el botón «Conectar cuenta de cobro» habla con Stripe de verdad');
  const conectarA = await fetch(A.base + '/admin/portal/stripe/conectar', { headers: A.cab, redirect: 'manual' });
  ok(conectarA.status === 302, 'la ruta responde con una redirección, no con un error a pelo', 'HTTP ' + conectarA.status);
  const destinoA = conectarA.headers.get('location') || '';
  const bloqueadoPorConnect = destinoA.includes('/admin/portal?err=') && /No se pudo crear la cuenta/.test(decodeURIComponent(destinoA));
  if (bloqueadoPorConnect) {
    // 🛑 BLOQUEO EXTERNO, DESCUBIERTO AQUÍ Y NO EN EL PASO 0: la cuenta de Stripe de Ibrahin
    // (la MISMA que ya cobra la suscripción) todavía no se ha dado de alta como PLATAFORMA de
    // Connect. Stripe lo rechaza con su propio mensaje: «You can only create new accounts if
    // you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.»
    // Esto NO se ve leyendo documentación (Paso 0): solo se ve intentando crear una cuenta de
    // verdad, que es justo lo que acaba de pasar. No hay atajo de código: es un alta que solo
    // puede hacer el dueño de la cuenta, en su Dashboard.
    console.log('  🛑 BLOQUEADO POR STRIPE (no es un fallo de código): "' + decodeURIComponent(destinoA.split('err=')[1] || '') + '"');
    console.log('     Stripe: "You can only create new accounts if you\'ve signed up for Connect,');
    console.log('              which you can do at https://dashboard.stripe.com/connect."');
    ok(true, 'y cuando Stripe lo rechaza, el error se maneja con limpieza: redirige con aviso claro, no revienta ni deja la cuenta a medias', destinoA.slice(0, 70));
    const cuentaA0 = A.db.prepare('SELECT stripe_connect_account_id FROM company_config WHERE id=1').get();
    ok(cuentaA0.stripe_connect_account_id == null, 'y NO se guarda ninguna cuenta a medio crear en el negocio', String(cuentaA0.stripe_connect_account_id));
  } else {
    ok(/^https:\/\/connect\.stripe\.com\//.test(destinoA), 'y el destino es la web de Stripe, de verdad', destinoA.slice(0, 60) + '…');
    const cuentaA = A.db.prepare('SELECT stripe_connect_account_id FROM company_config WHERE id=1').get();
    ok(!!cuentaA.stripe_connect_account_id && cuentaA.stripe_connect_account_id.startsWith('acct_'), 'se guardó una cuenta de Stripe de verdad en el negocio', cuentaA.stripe_connect_account_id);
    const filaControlA = controlDb.prepare('SELECT account_id FROM stripe_connect_accounts WHERE tenant_id=?').get(A.id);
    ok(filaControlA?.account_id === cuentaA.stripe_connect_account_id, 'y en control.db, para que el webhook la encuentre', filaControlA?.account_id);
  }

  // ── [3] EL BOTÓN DE PAGO SOLO SALE CON LA CUENTA LISTA (fixture: simula "ya conectada") ─────
  // Sin poder completar una cuenta real (bloqueo de [2]), esta sección prueba la MITAD que SÍ es
  // nuestra: que el portal reacciona bien al estado `stripe_connect_listo`, con y sin cuenta.
  console.log('\n[3] el botón de pago aparece/desaparece según el estado guardado (sin depender de Stripe)');
  B.db.prepare('UPDATE company_config SET stripe_connect_account_id=?, stripe_connect_listo=1 WHERE id=1').run('acct_fixture_' + TS);
  controlDb.prepare('INSERT INTO stripe_connect_accounts (tenant_id, account_id) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET account_id=excluded.account_id').run(B.id, 'acct_fixture_' + TS);
  const portalB2 = await fetch(B.base + '/portal', { headers: { cookie: cookieB } });
  const htmlPortalB2 = await portalB2.text();
  ok(htmlPortalB2.includes('Pagar con tarjeta'), 'con stripe_connect_listo=1, el portal SÍ enseña «Pagar con tarjeta»');
  ok(htmlPortalB2.includes('ES9121000418450200051332'), 'y el IBAN sigue ahí también, para quien prefiera transferencia');

  // NAVEGADOR REAL, no `fetch`: se abre la pantalla y se PULSA el botón, como pediría CLAUDE.md
  // («si hay un botón, se pulsa ESE botón»). Con la cuenta de la fixture (no existe en Stripe de
  // verdad, por el bloqueo de [2]) el intento de pago falla — y lo que se prueba aquí es que falla
  // LIMPIO: vuelve al portal con «cancelado», nunca una pantalla rota ni un 500.
  b = await puppeteer.launch(launchOpts());
  page = await b.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  await page.setCookie({ name: 'psesion', value: cookieB.split('=')[1], domain: B.slug + '.bamburu.com', path: '/portal', secure: true });
  await page.goto(B.base + '/portal', { waitUntil: 'networkidle2' });
  const botonVisible = await page.$('form[action^="/portal/factura/"][action$="/pagar"] button[type=submit]');
  ok(!!botonVisible, 'el botón «Pagar con tarjeta» está en el HTML que de verdad sirve el servidor, no solo en el fetch de arriba');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('form[action^="/portal/factura/"][action$="/pagar"] button[type=submit]'),
  ]);
  ok(page.url().includes('pago=cancelado'), 'pulsar el botón de verdad, contra una cuenta que Stripe no reconoce, vuelve al portal con «cancelado»', page.url());
  ok((await page.content()).includes('Pago cancelado'), 'con el aviso en pantalla, no un error en blanco');

  // ── [4] EL WEBHOOK — SU PROPIO MOTOR, INDEPENDIENTE DE QUE HAYA O NO CUENTA REAL ─────────────
  // El webhook NO le pregunta nada a Stripe al recibir el aviso: confía en la FIRMA (HMAC con el
  // secreto compartido) y en lo que el propio aviso trae dentro. Por eso esta sección SÍ se puede
  // probar entera, de punta a punta, aunque [2] esté bloqueada: se construye un PaymentIntent con
  // la FORMA exacta que manda Stripe (mismos campos que usa `registrarCobroFactura`), con el
  // importe y la factura de verdad de este negocio, y se firma con el MISMO secreto que ya lee
  // el servidor en `/etc/bamburu.env`.
  console.log('\n[4] el webhook de Connect marca la factura como pagada sola (firmado con el secreto real)');
  const piFalsoId = 'pi_gate_' + TS;
  const piFalso = {
    id: piFalsoId, object: 'payment_intent', status: 'succeeded',
    amount: 12100, amount_received: 12100, currency: 'eur',
    metadata: { bamburu_invoice_id: String(facturaBId), bamburu_tenant_slug: B.slug },
  };
  const eventoPayload = JSON.stringify({ id: 'evt_gate_' + TS, type: 'payment_intent.succeeded', account: 'acct_fixture_' + TS, data: { object: piFalso } });
  const rWebhook = await fetch('http://localhost:3000/stripe/connect/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': firmarWebhook(eventoPayload, SECRETO_CONNECT) }, body: eventoPayload,
  });
  ok(rWebhook.status === 200, 'el servidor acepta el aviso firmado', 'HTTP ' + rWebhook.status);
  await new Promise(r => setTimeout(r, 300));
  const cobroFila = B.db.prepare('SELECT * FROM invoice_payments WHERE invoice_id=? AND stripe_payment_intent_id=?').get(facturaBId, piFalsoId);
  ok(!!cobroFila, 'y aparece el cobro en invoice_payments, con el PaymentIntent del aviso', cobroFila ? cobroFila.amount + ' €' : 'nada');
  ok(cobroFila && Math.abs(Number(cobroFila.amount) - 121) < 0.01, 'por el importe correcto (100 + 21% = 121,00 €)', cobroFila?.amount);
  const pendienteTrasWebhook = B.db.prepare('SELECT COALESCE(SUM(amount),0) s FROM invoice_payments WHERE invoice_id=?').get(facturaBId).s;
  ok(Math.abs(pendienteTrasWebhook - 121) < 0.02, 'y la factura queda cobrada del todo', pendienteTrasWebhook);
  const portalB3 = await fetch(B.base + '/portal', { headers: { cookie: cookieB } });
  // OJO: `.includes('Pagada')` a secas SIEMPRE da verdadero, pase lo que pase — `ROOT_TOKENS`
  // (layout.js) trae un comentario CSS `/* Pagada */` documentando el color del estado, dentro del
  // <style> de TODA página del portal. Lo cazó este mismo gate al fallar en rojo con un aviso
  // «Pagada» que no debía estar: la pieza que se afirma es el `<span>` de verdad que pinta la fila.
  ok((await portalB3.text()).includes('class="pill pagada"'), 'el portal la enseña «Pagada» de verdad (el <span> de la fila, no un comentario CSS)');

  // Reintento del MISMO webhook (Stripe reintenta de verdad si tarda en contestar): no duplica.
  const rWebhook2 = await fetch('http://localhost:3000/stripe/connect/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': firmarWebhook(eventoPayload, SECRETO_CONNECT) }, body: eventoPayload,
  });
  ok(rWebhook2.status === 200, 'un reintento del mismo aviso se acepta igual (200)', 'HTTP ' + rWebhook2.status);
  const filasTrasReintento = B.db.prepare('SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=? AND stripe_payment_intent_id=?').get(facturaBId, piFalsoId).n;
  ok(filasTrasReintento === 1, 'pero NO duplica el cobro — sigue habiendo UNA sola fila', filasTrasReintento + ' fila(s)');

  // ── [5] UNA FIRMA MALA NO CUELA ──────────────────────────────────────────────────────────────
  console.log('\n[5] un aviso sin firmar (o mal firmado) se rechaza');
  const rFalso = await fetch('http://localhost:3000/stripe/connect/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=0000000000000000000000000000000000000000000000000000000000000000' }, body: eventoPayload,
  });
  ok(rFalso.status === 400, 'HTTP 400, no 200 — Stripe lo reintentaría si dijéramos que sí', 'HTTP ' + rFalso.status);

  // ── [6] EL PAGO A MANO SIGUE FUNCIONANDO, SIN CRUZARSE CON EL DE STRIPE ─────────────────────
  console.log('\n[6] «marcar pagada a mano» — el mecanismo de siempre, sin tocar');
  const facturaManual = await post(B, '/api/erp/invoices', { client_id: sB.cli, issue_date: hoy, lines: [{ product_id: sB.prod, description: 'Servicio Gate', quantity: 1, unit_price: 50, tax_rate: 21 }] });
  const rManual = await post(B, '/api/erp/invoices/' + facturaManual.body.id + '/payments', { amount: 60.5, payment_method: 'transferencia', note: 'Pago de prueba a mano' });
  ok(rManual.status === 201, 'el cobro manual se registra igual que siempre', 'HTTP ' + rManual.status);
  const filaManual = B.db.prepare('SELECT * FROM invoice_payments WHERE id=?').get(rManual.body.id);
  ok(filaManual.stripe_payment_intent_id === null, 'y su stripe_payment_intent_id queda NULL — no se cruza con Stripe', String(filaManual.stripe_payment_intent_id));
  const totalManual = B.db.prepare('SELECT COUNT(*) n FROM invoice_payments WHERE stripe_payment_intent_id IS NULL').get().n;
  ok(totalManual >= 1, 'y convive sin problema con los cobros online (NULL nunca choca con NULL)', totalManual + ' cobro(s) manual(es)');

  console.log('\n──────────────────────────────────────────────');
  console.log((fail === 0 ? '✓ GATE VERDE' : '✗ GATE ROJO') + ' — ' + pass + ' pasan · ' + fail + ' fallan');
  console.log(pass + ' OK · ' + fail + ' fallos');
} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
  console.log(pass + ' OK · ' + fail + ' fallos');
} finally {
  try { if (b) await b.close(); } catch {}
  for (const sl of creados) { try { await borrarTenant(sl); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
}
