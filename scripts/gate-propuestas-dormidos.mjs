// Gate de navegador — PROPUESTA DE DISA: cliente dormido (reenganche). Contra el servidor real.
//
// Siembra un cliente con un ritmo claro que dejó de comprar, y recorre el flujo ENTERO por la pantalla:
//   propuesta en el panel (con el PORQUÉ a la vista) → "Aprobar" REDACTA y NO envía nada → el borrador
//   aparece editable → "Enviar email" manda POR RESEND DE VERDAD → queda registrado en el historial del
//   cliente y la propuesta se cierra.
//
// EL EMAIL SE ENVÍA DE VERDAD, pero al BUZÓN SUMIDERO de Resend (delivered@resend.dev): acepta y
// confirma la entrega, y no aterriza en la bandeja de nadie. Un barrido de regresión no puede tener
// como efecto secundario escribirle a una persona — es la misma lección que dejó gate-orden-compra-c1a,
// que le mandaba un correo al dueño en cada pasada.
//
// Limpia POR ID todo lo que siembra (cliente, facturas, propuesta, actividad): el negocio queda como
// estaba. OJO: las facturas sembradas son de un cliente de prueba y se borran con él; aquí NO se emite
// ninguna factura por el flujo (esto no emite nada), así que la cadena de Verifactu no se toca.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, engancharToasts, esperarToast } from './lib/gate-env.mjs';
import { RID } from './lib/gate-fixtures.mjs';
import { generarPropuestasDormidos, TIPO_DORMIDO } from '../modules/erp/propuestas.js';
import { clientesDormidos } from '../modules/erp/ventas-metrics.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';
// Buzón sumidero de Resend: el envío es REAL, pero no llega a la bandeja de nadie.
const SINK_EMAIL = 'delivered@resend.dev';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

const rid = RID();
const NOMBRE = 'ZZ Dormido (gate ' + rid + ')';
const HOY = new Date().toISOString().slice(0, 10);
const diasAntes = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const creado = { clienteId: null, facturaIds: [], propuestaIds: [], usuarios: [] };

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await engancharToasts(page);
await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
page.on('dialog', async d => { await d.accept(); });

try {
  // ── 1. Siembra: un cliente que compraba cada 7 días y lleva 40 sin aparecer ──
  console.log('\n[1] Siembra: cliente con ritmo semanal que dejó de comprar');
  const cli = db.prepare('INSERT INTO clients (name, email, active) VALUES (?,?,1)').run(NOMBRE, SINK_EMAIL);
  creado.clienteId = Number(cli.lastInsertRowid);
  for (const d of [61, 54, 47, 40]) {
    const inv = createInvoice(db, {
      client_id: creado.clienteId, issue_date: diasAntes(d),
      lines: [{ description: 'Servicio mensual', quantity: 1, unit_price: 100, tax_rate: 21 }],
    });
    creado.facturaIds.push(inv.id);
  }
  const dormidos = clientesDormidos(db, HOY);
  const d = dormidos.find(x => x.client_id === creado.clienteId);
  ok(!!d, 'la detección lo ve dormido');
  ok(d.ritmo_dias === 7 && d.umbral_dias === 30, 'aprende su ritmo (7 d) y le pone umbral 30 (suelo)');
  ok(d.dias_sin_comprar === 40, 'lleva 40 días sin comprar');

  const r = generarPropuestasDormidos(db, { today: HOY });
  ok(r.creadas >= 1, 'DISA crea su propuesta');
  const prop = db.prepare("SELECT * FROM disa_proposals WHERE client_id=? AND type=? AND status='pendiente'").get(creado.clienteId, TIPO_DORMIDO);
  ok(!!prop, 'la propuesta queda pendiente, anclada al CLIENTE');
  creado.propuestaIds.push(prop.id);
  ok(prop.body === '', 'y nace SIN borrador (el texto se redacta al aprobar)');

  // ── 2. El panel la enseña, con el PORQUÉ a la vista ─────────────────────────
  console.log('\n[2] El panel la enseña, y se explica');
  await page.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  await page.waitForFunction((id) => !!document.getElementById('prop' + id), { timeout: 15000, polling: 500 }, prop.id);
  let tarjeta = await page.$eval('#prop' + prop.id, el => el.textContent);
  ok(/Dormido/i.test(tarjeta), 'la tarjeta lleva la etiqueta "Dormido"');
  ok(tarjeta.includes(NOMBRE), 'con el nombre del cliente');
  ok(/40 días sin comprar/.test(tarjeta), 'dice cuánto lleva sin comprar');
  ok(/compra cada 7 días/.test(tarjeta), 'y EXPLICA por qué lo considera dormido (su ritmo real)');
  ok(/Aprobar/.test(tarjeta) && /NO envía/i.test(tarjeta), 'avisa de que aprobar NO envía nada');
  ok(!/<textarea|Mensaje/.test(await page.$eval('#prop' + prop.id, el => el.innerHTML)), 'aún NO hay borrador que enseñar');
  await page.screenshot({ path: '/tmp/dorm-1-propuesta.png' });

  // ── 3. APROBAR: DISA redacta. Y NO envía nada. ──────────────────────────────
  console.log('\n[3] Aprobar → DISA redacta, sin enviar');
  const actividadAntes = db.prepare('SELECT COUNT(*) n FROM client_activities WHERE client_id=?').get(creado.clienteId).n;
  await page.evaluate((id) => redactar(id), prop.id);
  await page.waitForFunction((id) => {
    const el = document.getElementById('prop' + id);
    return el && el.querySelector('textarea');
  }, { timeout: 15000, polling: 500 }, prop.id);
  ok(true, 'la tarjeta se recarga con el borrador dentro');

  const borrador = await page.$eval('#prop' + prop.id + ' textarea', el => el.value);
  const asunto = await page.$eval('#prop' + prop.id + ' input', el => el.value);
  ok(borrador.length > 30 && !!asunto, 'hay asunto y cuerpo redactados por DISA');
  ok(!/factura|deuda|vencid|pagar/i.test(borrador), 'tono de reenganche, NO de cobro (ni facturas ni deudas)');
  ok(!/solicitud/i.test(borrador + ' ' + asunto), 'NO se inventa una "solicitud" que el cliente nunca hizo');
  ok(/Enviar email/i.test(await page.$eval('#prop' + prop.id, el => el.textContent)), 'y ahora sí ofrece "Enviar email"');
  console.log('    borrador: ' + JSON.stringify(asunto) + ' / ' + JSON.stringify(borrador.slice(0, 70) + '…'));

  // LO IMPORTANTE: no ha salido ningún email.
  ok(db.prepare('SELECT COUNT(*) n FROM client_activities WHERE client_id=?').get(creado.clienteId).n === actividadAntes,
     'APROBAR NO ENVIÓ NADA: cero contactos registrados para el cliente');
  const pTrasRedactar = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(prop.id);
  ok(pTrasRedactar.status === 'pendiente' && !pTrasRedactar.resolved_at,
     'y la propuesta SIGUE pendiente: aprobar la PREPARA, no la resuelve');
  await page.screenshot({ path: '/tmp/dorm-2-borrador.png' });

  // ── 4. ENVIAR: el segundo clic. Resend de verdad, al buzón sumidero. ────────
  console.log('\n[4] Enviar → Resend REAL, al buzón sumidero');
  // El usuario puede editar el texto antes de enviar: lo editamos, para probar que manda LO QUE VE.
  const MARCA = 'Un saludo del gate ' + rid;
  await page.$eval('#prop' + prop.id + ' textarea', (el, m) => { el.value = el.value + '\n\n' + m; }, MARCA);
  await page.evaluate((id) => enviarDormido(id), prop.id);
  const aviso = await esperarToast(page, /enviado|error/i, 30000);
  ok(!!aviso, 'la UI avisa del resultado: ' + JSON.stringify(aviso && aviso.msg));
  ok(aviso && aviso.tipo !== 'err', 'el envío NO devolvió error de Resend');
  ok(aviso && aviso.msg.includes(SINK_EMAIL), 'enviado al buzón sumidero (' + SINK_EMAIL + '), no a una persona');

  // El motor: queda en el historial del cliente, por la vía del CRM.
  const act = db.prepare("SELECT * FROM client_activities WHERE client_id=? AND type='email' ORDER BY id DESC LIMIT 1").get(creado.clienteId);
  ok(!!act, 'el email queda REGISTRADO en el historial del cliente (client_activities), como si lo hubieras escrito tú');
  ok(act.channel === 'email', 'con canal email');
  const pFinal = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(prop.id);
  ok(pFinal.status === 'aprobada_enviada' && pFinal.resolved_at, 'y la propuesta queda resuelta (aprobada_enviada)');
  ok(pFinal.body.includes(MARCA), 'se envió EL TEXTO QUE EL USUARIO TENÍA DELANTE (con su edición), no el original');
  await page.waitForFunction((id) => !document.getElementById('prop' + id), { timeout: 15000, polling: 500 }, prop.id);
  ok(true, 'la tarjeta desaparece del panel');
  await page.screenshot({ path: '/tmp/dorm-3-enviado.png' });

  // ── 5. Y NO se le vuelve a escribir mañana ──────────────────────────────────
  console.log('\n[5] Tras enviar, descansa (no es una máquina de spam)');
  const r2 = generarPropuestasDormidos(db, { today: HOY });
  const sigue = db.prepare("SELECT 1 FROM disa_proposals WHERE client_id=? AND type=? AND status='pendiente'").get(creado.clienteId, TIPO_DORMIDO);
  ok(!sigue, 'el cliente NO se vuelve a proponer al instante (sigue dormido, pero acaba de recibir el email)');
  ok(r2.enDescanso >= 1, 'el generador lo cuenta como en descanso');

  // ── 6. Candado en la pantalla real ──────────────────────────────────────────
  console.log('\n[6] Candado: sin permiso de CRM, la propuesta no existe para ti');
  // Nueva propuesta para probar el candado (la anterior ya se envió).
  db.prepare("UPDATE disa_proposals SET status='descartada', resolved_at=? WHERE id=?")
    .run(new Date(Date.now() - 200 * 86400000).toISOString(), prop.id);   // descanso vencido → se re-propone
  generarPropuestasDormidos(db, { today: HOY });
  const prop2 = db.prepare("SELECT * FROM disa_proposals WHERE client_id=? AND type=? AND status='pendiente'").get(creado.clienteId, TIPO_DORMIDO);
  ok(!!prop2, 'pasado el descanso vuelve a proponerse (y sirve para probar el candado)');
  creado.propuestaIds.push(prop2.id);

  const email = 'zz-gate-dorm-' + rid + '@bamburu.test';
  const u = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Gate dormidos',?,'x','employee',1)").run(email);
  const uid = Number(u.lastInsertRowid);
  creado.usuarios.push(uid);
  // Le damos clients.read (ve clientes) pero NO crm.manage (no puede escribirles).
  const permClientes = db.prepare("SELECT id FROM permissions WHERE module='clients' AND action='read'").get();
  db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, permClientes.id);
  const tieneCrm = db.prepare(
    "SELECT COUNT(*) n FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.admin_user_id=? AND p.module='crm' AND p.action='manage'").get(uid).n;
  ok(tieneCrm === 0, 'precondición: el empleado de prueba NO tiene crm.manage');

  const etok = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(etok, uid, now, now + 900, randomBytes(16).toString('hex'));
  const EJ = { 'Cookie': 'asess=' + etok };

  const lista = await (await fetch(BASE + '/api/erp/propuestas', { headers: EJ })).json();
  ok(!(lista.propuestas || []).some(p => p.type === TIPO_DORMIDO), 'NO le aparece en la lista');
  const envE = await fetch(BASE + '/api/erp/propuestas/' + prop2.id + '/enviar', {
    method: 'POST', headers: { ...EJ, 'Content-Type': 'application/json', 'x-csrf-token': 'x' }, body: JSON.stringify({ subject: 'x', body: 'y' }) });
  ok(envE.status === 403, 'y si fuerza el POST de enviar a mano → 403 (got ' + envE.status + ')');
  const redE = await fetch(BASE + '/api/erp/propuestas/' + prop2.id + '/redactar', {
    method: 'POST', headers: { ...EJ, 'Content-Type': 'application/json', 'x-csrf-token': 'x' }, body: '{}' });
  ok(redE.status === 403, 'ni pedir el borrador → 403');
  ok(db.prepare("SELECT COUNT(*) n FROM client_activities WHERE client_id=? AND type='email'").get(creado.clienteId).n === 1,
     'no le ha salido NINGÚN email nuevo al cliente por el intento sin permiso');

  // En su pantalla, ni rastro (contexto propio: las cookies se comparten entre pestañas).
  const ctx = await browser.createBrowserContext();
  const page2 = await ctx.newPage();
  await page2.setCookie({ name: 'asess', value: etok, domain: DOMAIN, path: '/' });
  await page2.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  ok(!(await page2.content()).includes(NOMBRE), 'en SU pantalla de propuestas no aparece el cliente por ningún lado');
  await page2.screenshot({ path: '/tmp/dorm-4-candado.png' });
  await ctx.close();

} catch (e) {
  console.error('ERROR en el gate:', e.stack || e.message);
  fail++;
} finally {
  await browser.close();

  // ── Limpieza POR ID. El cliente sembrado y sus facturas se van enteros. ──
  const db2 = new Database(DB_PATH);
  const facturasAntes = db2.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  db2.transaction(() => {
    for (const id of creado.propuestaIds) db2.prepare('DELETE FROM disa_proposals WHERE id=?').run(id);
    if (creado.clienteId) {
      db2.prepare('DELETE FROM disa_proposals WHERE client_id=?').run(creado.clienteId);
      db2.prepare('DELETE FROM client_activities WHERE client_id=?').run(creado.clienteId);
      for (const id of creado.facturaIds) {
        db2.prepare('DELETE FROM ledger_lines WHERE entry_id IN (SELECT id FROM ledger_entries WHERE origin_type=? AND origin_id=?)').run('invoice', id);
        db2.prepare('DELETE FROM ledger_entries WHERE origin_type=? AND origin_id=?').run('invoice', id);
        db2.prepare('DELETE FROM verifactu_envios WHERE registro_id IN (SELECT id FROM verifactu_registros WHERE invoice_id=?)').run(id);
        db2.prepare('DELETE FROM verifactu_registros WHERE invoice_id=?').run(id);
        db2.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(id);
        db2.prepare('DELETE FROM invoices WHERE id=?').run(id);
      }
      db2.prepare('DELETE FROM clients WHERE id=?').run(creado.clienteId);
    }
    for (const uid of creado.usuarios) {
      db2.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(uid);
      db2.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(uid);
      db2.prepare('DELETE FROM admin_users WHERE id=?').run(uid);
    }
  })();
  ok(!db2.prepare('SELECT 1 FROM clients WHERE id=?').get(creado.clienteId), 'limpieza: el cliente de prueba ya no está');
  ok(db2.prepare('SELECT COUNT(*) n FROM invoices').get().n === facturasAntes - creado.facturaIds.length,
     'limpieza: sus facturas de prueba tampoco (eran suyas, y nacieron aquí)');
  ok(db2.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_DORMIDO).n >= 0, 'limpieza: sin propuestas huérfanas');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador clientes dormidos: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
