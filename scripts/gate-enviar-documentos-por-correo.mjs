// Gate de navegador — enviar-documentos-por-correo (9 sep 2026, Pilar 4 · Ventas).
//
// Hasta hoy SOLO el presupuesto se mandaba por correo con su PDF adjunto; factura, albarán y
// pedido había que descargarlos y adjuntarlos a mano. Esta ficha les da el mismo botón,
// reutilizando la MISMA maquinaria de envío (core/mailer.js, email-templates.js, el interruptor
// de Ajustes → Avisos y correos, el registro en Actividad) — nada nuevo montado al lado.
//
// TRES DIFERENCIAS DELIBERADAS respecto al presupuesto, que este gate verifica:
//   1. El destinatario NO es editable: es SIEMPRE el correo VIVO de la ficha del cliente.
//   2. Sin correo en la ficha, el botón sale DESACTIVADO con un aviso — nunca falla en silencio.
//      Se comprueba en DOS capas: el botón (UI) y el endpoint por debajo (defensa en profundidad,
//      por si algo llama directo sin pasar por el botón).
//   3. Lo que queda registrado es la actividad (quién y cuándo) — el MISMO criterio que ya usa el
//      presupuesto (emailQuoteSvc no tiene columna sent_at; solo logActivity), no una tabla nueva.
//
// Envío REAL contra Resend, al buzón sumidero de pruebas (delivered@resend.dev) — igual que
// gate-orden-compra-c1a.mjs: se prueba el envío de verdad, no una promesa de que funcionaría.
//
// ROJO PROVOCADO: se apaga el interruptor de «factura» en Ajustes → Avisos y correos (un estado
// real que un dueño puede poner) y se confirma que el envío SE BLOQUEA con un error claro (409),
// en vez de mandarse igual o fallar en silencio. Si alguien aflojara `exigirCorreoActivo`, esta
// aserción cae.
//
// No usa facturas/albaranes/pedidos nuevos donde puede evitarlo: reutiliza documentos REALES ya
// existentes en el tenant para factura y albarán (no toca Verifactu creando facturas de más), y
// solo crea un pedido nuevo (con su propio producto) porque no había ninguno confirmado — se
// borra entero al final, por ID, junto con el producto.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, engancharToasts, esperarToast, autoAceptarPaneles } from './lib/gate-env.mjs';
import { purgarArtefactos, productoDePrueba } from './lib/gate-fixtures.mjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const SINK_EMAIL = 'delivered@resend.dev';   // buzón sumidero de Resend: confirma entrega real sin escribirle a nadie

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 3600, csrf);

// ── Estado a restaurar SIEMPRE, pase lo que pase ─────────────────────────────────────────────────
const restore = { clientes: [], correos: [] };
const rememberClientEmail = (id) => {
  if (restore.clientes.some(x => x.id === id)) return;
  restore.clientes.push({ id, email: db.prepare('SELECT email FROM clients WHERE id=?').get(id)?.email ?? null });
};
const setClientEmail = (id, email) => { rememberClientEmail(id); db.prepare('UPDATE clients SET email=? WHERE id=?').run(email, id); };
const rememberCorreoPref = (tipo) => {
  if (restore.correos.some(x => x.tipo === tipo)) return;
  restore.correos.push({ tipo, row: db.prepare('SELECT activo FROM email_tipo_pref WHERE tipo=?').get(tipo) || null });
};
const setCorreoActivo = (tipo, activo) => {
  rememberCorreoPref(tipo);
  db.prepare(`INSERT INTO email_tipo_pref (tipo, activo, updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
              ON CONFLICT(tipo) DO UPDATE SET activo=excluded.activo, updated_at=CURRENT_TIMESTAMP`).run(tipo, activo ? 1 : 0);
};

const creado = { productos: [] };
const pedidoIds = [];   // el único pedido que este gate crea (no lo cubre purgarArtefactos)

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await engancharToasts(page);
await page.setCookie({ name: 'asess', value: token, domain: 'desarrollo-bamburu.localhost', path: '/' });
await autoAceptarPaneles(page);   // confirmarEnPagina() sin campos se acepta solo (email es confirm-first)

const dialogosInesperados = [];
page.on('dialog', async d => { dialogosInesperados.push(d.type() + ': ' + d.message()); await d.dismiss(); });

// Marca de tiempo del arranque de este gate: para distinguir SUS filas de actividad de cualquier
// otra que ya hubiera en el tenant.
// CURRENT_TIMESTAMP de SQLite escribe "AAAA-MM-DD HH:MM:SS" (espacio, no "T"): comparar contra un
// ISO con "T" compara mal por texto (el carácter 'T' pesa más que el espacio) y no encuentra NADA
// aunque la fila exista. Iso con espacio, para que la comparación de cadenas sea correcta.
const inicioISO = new Date().toISOString().slice(0, 19).replace('T', ' ');

async function comprobarEnviarDesdeLaFicha({ url, docLabel, entity, entityId, numeroRegex, sinkAssertRe }) {
  await page.goto(BASE + url, { waitUntil: 'networkidle0' });
  let body = await page.content();
  ok(body.includes('Enviar por correo') && !/disabled[^>]*>Enviar por correo/.test(body), docLabel + ': botón "Enviar por correo" activo (cliente con correo)');

  await page.evaluate(() => document.querySelectorAll('[data-act="email"], [data-iv="email"]').forEach(b => b.click()));
  const aviso = await esperarToast(page, sinkAssertRe, 30000);
  ok(!!aviso, docLabel + ': la UI avisa del resultado del envío: ' + JSON.stringify(aviso && aviso.msg));
  ok(aviso && aviso.tipo !== 'err', docLabel + ': el envío NO devolvió error de Resend');
  ok(aviso && aviso.msg.includes(SINK_EMAIL), docLabel + ': enviado por Resend a ' + SINK_EMAIL + ' (toast: ' + JSON.stringify(aviso && aviso.msg) + ')');

  const logRow = db.prepare(
    `SELECT * FROM activity_logs WHERE entity=? AND entity_id=? AND action LIKE '%mail%' AND created_at >= ? ORDER BY id DESC LIMIT 1`
  ).get(entity, entityId, inicioISO);
  ok(!!logRow, docLabel + ': queda registrado en Actividad (quién) — ' + (logRow ? logRow.action + ' · ' + logRow.details : 'nada'));
  ok(!!(logRow && logRow.created_at), docLabel + ': el registro lleva fecha/hora (cuándo) — ' + (logRow && logRow.created_at));
  ok(!!(logRow && logRow.details && logRow.details.includes(SINK_EMAIL)), docLabel + ': el registro dice a quién se mandó');
}

async function comprobarBotonDesactivadoSinCorreo({ url, docLabel, apiPath }) {
  await page.goto(BASE + url, { waitUntil: 'networkidle0' });
  const btn = await page.evaluateHandle(() => document.querySelector('[data-act="email"][disabled], [data-iv="email"][disabled]'));
  const hayBoton = await page.evaluate(el => !!el, btn);
  ok(hayBoton, docLabel + ': sin correo en la ficha, el botón sale DESACTIVADO (no desaparece, no falla)');
  const titulo = hayBoton ? await page.evaluate(el => el.getAttribute('title') || '', btn) : '';
  ok(!!titulo && /correo/i.test(titulo), docLabel + ': el botón desactivado lleva un aviso claro (title="' + titulo + '")');
  const body = await page.content();
  ok(body.includes('Completar ficha del cliente'), docLabel + ': ofrece completar la ficha del cliente');

  // Defensa en profundidad: aunque el botón esté desactivado, el endpoint por debajo tampoco falla
  // en silencio si alguien lo llama directo.
  const r = await page.evaluate(async (path, csrfTok) => {
    const resp = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfTok }, body: '{}' });
    return { status: resp.status, body: await resp.json().catch(() => null) };
  }, apiPath, csrf);
  ok(r.status === 409 && /correo/i.test(r.body?.error || ''), docLabel + ': el endpoint también bloquea sin correo, con error claro (409): ' + JSON.stringify(r.body));
}

try {
  // ══ FACTURA — documento real ya existente, no se crea ninguna factura nueva ══════════════════
  const inv = db.prepare("SELECT id, invoice_number, client_id, status FROM invoices WHERE status!='anulada' AND client_id IS NOT NULL ORDER BY id DESC LIMIT 1").get();
  ok(!!inv, 'hay una factura real en el tenant para probar (' + (inv && inv.invoice_number) + ')');
  if (inv) {
    setClientEmail(inv.client_id, SINK_EMAIL);
    await comprobarEnviarDesdeLaFicha({
      url: '/admin/invoices/' + inv.id, docLabel: 'Factura ' + inv.invoice_number,
      entity: 'invoice', entityId: inv.id, sinkAssertRe: /enviada por email/i,
    });

    // Sin correo en la ficha → botón desactivado + endpoint bloqueado.
    setClientEmail(inv.client_id, '');
    await comprobarBotonDesactivadoSinCorreo({ url: '/admin/invoices/' + inv.id, docLabel: 'Factura ' + inv.invoice_number, apiPath: '/api/erp/invoices/' + inv.id + '/email' });

    // ROJO PROVOCADO — se apaga el interruptor de «factura» (un estado real de Ajustes) y se
    // confirma que el envío se BLOQUEA con un error claro, en vez de mandarse o fallar en silencio.
    setClientEmail(inv.client_id, SINK_EMAIL);
    setCorreoActivo('factura', false);
    const bloqueado = await page.evaluate(async (path, csrfTok) => {
      const resp = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfTok }, body: '{}' });
      return { status: resp.status, body: await resp.json().catch(() => null) };
    }, '/api/erp/invoices/' + inv.id + '/email', csrf);
    ok(bloqueado.status === 409 && /apagad/i.test(bloqueado.body?.error || ''), 'ROJO PROVOCADO: con el correo de factura apagado en Ajustes, el envío se bloquea (409) en vez de salir igual: ' + JSON.stringify(bloqueado.body));
    setCorreoActivo('factura', true);
  }

  // ══ ALBARÁN — documento real ya existente, no se crea ninguno nuevo ═════════════════════════
  const alb = db.prepare("SELECT id, delivery_number, client_id FROM delivery_notes WHERE status='confirmado' ORDER BY id DESC LIMIT 1").get();
  ok(!!alb, 'hay un albarán confirmado real en el tenant para probar (' + (alb && alb.delivery_number) + ')');
  if (alb) {
    setClientEmail(alb.client_id, SINK_EMAIL);
    await comprobarEnviarDesdeLaFicha({
      url: '/admin/albaranes/' + alb.id, docLabel: 'Albarán ' + alb.delivery_number,
      entity: 'delivery_note', entityId: alb.id, sinkAssertRe: /enviado por email/i,
    });
    setClientEmail(alb.client_id, '');
    await comprobarBotonDesactivadoSinCorreo({ url: '/admin/albaranes/' + alb.id, docLabel: 'Albarán ' + alb.delivery_number, apiPath: '/api/erp/albaranes/' + alb.id + '/email' });
  }

  // ══ PEDIDO — no hay ninguno confirmado en el tenant: el gate se trae el suyo (y se lo lleva) ══
  const prod = productoDePrueba(db, 'Enviar pedido');
  creado.productos.push(prod.id);
  const cliente = db.prepare("SELECT id, email FROM clients WHERE id NOT IN (?,?) AND email IS NOT NULL AND email!='' LIMIT 1")
    .get(inv?.client_id || -1, alb?.client_id || -1) || db.prepare('SELECT id, email FROM clients LIMIT 1').get();
  const crear = await page.evaluate(async (csrfTok, clientId, productId) => {
    const r = await fetch('/api/erp/pedidos', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfTok },
      body: JSON.stringify({ client_id: clientId, lines: [{ product_id: productId, description: 'Enviar pedido (gate)', quantity: 1, unit_price: 5, tax_rate: 21 }] }),
    });
    return r.json();
  }, csrf, cliente.id, prod.id);
  ok(!!crear.id, 'pedido de prueba creado (borrador)');
  pedidoIds.push(crear.id);
  const confirmar = await page.evaluate(async (csrfTok, id) => {
    const r = await fetch('/api/erp/pedidos/' + id + '/confirmar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfTok } });
    return r.json();
  }, csrf, crear.id);
  ok(!!confirmar.order_number, 'pedido de prueba confirmado (' + confirmar.order_number + ')');

  setClientEmail(cliente.id, SINK_EMAIL);
  await comprobarEnviarDesdeLaFicha({
    url: '/admin/pedidos/' + crear.id, docLabel: 'Pedido ' + confirmar.order_number,
    entity: 'customer_order', entityId: crear.id, sinkAssertRe: /enviado por email/i,
  });
  setClientEmail(cliente.id, '');
  await comprobarBotonDesactivadoSinCorreo({ url: '/admin/pedidos/' + crear.id, docLabel: 'Pedido ' + confirmar.order_number, apiPath: '/api/erp/pedidos/' + crear.id + '/email' });

  ok(dialogosInesperados.length === 0, 'ningún diálogo de navegador (alert/confirm/prompt) — todo va por window.confirmarEnPagina' + (dialogosInesperados.length ? ': ' + JSON.stringify(dialogosInesperados) : ''));

} finally {
  await browser.close();
  const db2 = new Database(DB_PATH);

  // El pedido de prueba no lo cubre purgarArtefactos (es de otro pilar): se borra a mano, hijos
  // antes que padre. No mueve stock (el pedido solo reserva, no lo escribe en el libro).
  if (pedidoIds.length) {
    db2.prepare(`DELETE FROM customer_order_items WHERE order_id IN (${pedidoIds.join(',')})`).run();
    const restantes = db2.prepare(`DELETE FROM customer_orders WHERE id IN (${pedidoIds.join(',')})`).run().changes;
    ok(restantes === pedidoIds.length, 'pedido(s) de prueba borrado(s) (' + restantes + '/' + pedidoIds.length + ')');
  }
  purgarArtefactos(db2, creado);

  // Restaurar TODO lo que este gate tocó, exactamente a como estaba.
  for (const cl of restore.clientes) db2.prepare('UPDATE clients SET email=? WHERE id=?').run(cl.email, cl.id);
  for (const co of restore.correos) {
    if (co.row == null) db2.prepare('DELETE FROM email_tipo_pref WHERE tipo=?').run(co.tipo);
    else db2.prepare('UPDATE email_tipo_pref SET activo=? WHERE tipo=?').run(co.row.activo, co.tipo);
  }
  const clientesOk = restore.clientes.every(cl => db2.prepare('SELECT email FROM clients WHERE id=?').get(cl.id)?.email === cl.email);
  ok(clientesOk, 'los correos de cliente que se tocaron quedan restaurados exactamente');

  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate enviar-documentos-por-correo: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
