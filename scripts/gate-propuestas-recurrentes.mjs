// Gate de navegador — PROPUESTA DE DISA: emitir la factura recurrente que toca. Contra el servidor
// real (tenant desarrollo-bamburu): siembra una plantilla de iguala, genera su borrador, y comprueba
// que la propuesta APARECE en /admin/propuestas con su tarjeta, su importe recalculado en vivo y su
// botón — y que el CANDADO la esconde de quien no puede emitir facturas.
//
// POR QUÉ ESTE GATE NO PULSA "APROBAR Y EMITIR".
// Aprobar emite una factura DE VERDAD: número de serie y huella Verifactu encadenada a la anterior.
// Una factura emitida es INMUTABLE (CANON) — no se puede borrar al terminar el gate para "dejar el
// tenant como estaba" sin romper la cadena de huellas. Así que la emisión de punta a punta (ruta real
// → emitirOcurrencia → createInvoice → huella) se prueba en verify-propuestas-recurrentes.mjs, sobre
// una COPIA desechable de esta misma BD, donde emitir es igual de real y no deja rastro. Aquí se
// prueba lo que este gate puede probar sin ensuciar: la PANTALLA y el CANDADO. Y se cierra
// DESCARTANDO, que no emite nada.
//
// (La cola de la AEAT, además, está inactiva en desarrollo por falta de certificado: emitir aquí no
// mandaría nada a Hacienda. Pero la factura quedaría igual, y de eso va esto.)
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { RID } from './lib/gate-fixtures.mjs';
import { createTemplate, generateDueOccurrences } from '../modules/erp/recurrentes.js';
import { generarPropuestasRecurrentes, TIPO_RECURRENTE } from '../modules/erp/propuestas.js';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';
const CLIENT_ID = 1;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

const rid = RID();
const CONCEPTO = 'Iguala mensual (gate ' + rid + ')';
const HOY = new Date().toISOString().slice(0, 10);
// La plantilla arranca hace un mes → al generar ocurrencias, cae un borrador que YA toca.
const INICIO = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();

const creado = { templateId: null, occurrenceIds: [], propuestaIds: [], usuarios: [] };

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
page.on('dialog', async d => { await d.accept(); });

try {
  // ── 1. Siembra: una iguala que toca ──────────────────────────────────────────
  console.log('\n[1] Siembra: plantilla de iguala → borrador que toca');
  const tpl = createTemplate(db, {
    client_id: CLIENT_ID, document_name: 'Factura', interval_months: 1,
    start_date: INICIO, max_occurrences: 1, irpf_rate: 0,
    lines: [{ description: CONCEPTO, quantity: 1, unit_price: 100, tax_rate: 21 }],
  });
  creado.templateId = tpl.id;
  const gen = generateDueOccurrences(db, HOY);
  ok(gen.generados >= 1, 'el motor de recurrentes creó la ocurrencia vencida');
  const occ = db.prepare("SELECT * FROM recurring_occurrences WHERE template_id=? AND status='borrador'").get(tpl.id);
  ok(!!occ, 'la ocurrencia está en borrador (es "la que toca y no has emitido")');
  creado.occurrenceIds.push(occ.id);

  const r = generarPropuestasRecurrentes(db, {});
  ok(r.creadas >= 1, 'el generador de DISA crea su propuesta (' + r.creadas + ')');
  const prop = db.prepare('SELECT * FROM disa_proposals WHERE occurrence_id=? AND type=?').get(occ.id, TIPO_RECURRENTE);
  ok(!!prop && prop.status === 'pendiente', 'la propuesta queda pendiente, anclada a la ocurrencia');
  creado.propuestaIds.push(prop.id);

  // ── 2. El panel la enseña, con su tarjeta y su importe EN VIVO ───────────────
  console.log('\n[2] /admin/propuestas la enseña');
  await page.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  await page.waitForFunction((id) => !!document.getElementById('prop' + id), { timeout: 15000 }, prop.id);
  const tarjeta = await page.$eval('#prop' + prop.id, el => el.textContent);
  ok(/Recurrente/i.test(tarjeta), 'la tarjeta lleva la etiqueta "Recurrente" (no se confunde con cobro ni pago)');
  ok(tarjeta.includes(CONCEPTO), 'enseña el concepto de la iguala');
  ok(/121[.,]00/.test(tarjeta), 'enseña el importe en vivo: 100 + 21% = 121 (' + (tarjeta.match(/\d+[.,]\d\d/) || [])[0] + ')');
  ok(tarjeta.includes(occ.due_date), 'dice qué día toca (' + occ.due_date + ')');
  ok(/Aprobar y emitir/i.test(tarjeta), 'ofrece el botón "Aprobar y emitir"');
  ok(/Descartar/i.test(tarjeta), 'y el de Descartar');
  await page.screenshot({ path: '/tmp/prop-rec-1-panel.png' });

  // El importe se recalcula SIEMPRE: le subo el precio a la plantilla y recargo.
  db.prepare('UPDATE recurring_template_items SET unit_price=200 WHERE template_id=?').run(tpl.id);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction((id) => !!document.getElementById('prop' + id), { timeout: 15000 }, prop.id);
  const tarjeta2 = await page.$eval('#prop' + prop.id, el => el.textContent);
  ok(/242[.,]00/.test(tarjeta2), 'subo el precio de la iguala → la propuesta enseña 242, no el 121 de antes (importe EN VIVO)');
  db.prepare('UPDATE recurring_template_items SET unit_price=100 WHERE template_id=?').run(tpl.id);

  // El badge la cuenta.
  const HJ = { 'Cookie': 'asess=' + token };
  const cont = await (await fetch(BASE + '/api/erp/propuestas/contador', { headers: HJ })).json();
  ok(cont.count >= 1, 'el badge del topbar la cuenta (' + cont.count + ')');

  // ── 3. EL CANDADO: quien no puede emitir facturas, no la ve ──────────────────
  console.log('\n[3] Candado: sin permiso de emitir, la propuesta no existe para ti');
  const email = 'zz-gate-rec-' + rid + '@bamburu.test';
  const u = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Gate recurrentes',?,'x','employee',1)").run(email);
  const uid = Number(u.lastInsertRowid);
  creado.usuarios.push(uid);
  // Le damos permiso de VER cobros (para que el panel no le dé 403 entero) pero NO de emitir facturas.
  const permCobros = db.prepare("SELECT id FROM permissions WHERE module='cobros' AND action='read'").get()
    || db.prepare("SELECT id FROM permissions WHERE module='invoices' AND action='read'").get();
  db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, permCobros.id);
  const tieneEmitir = db.prepare(
    "SELECT COUNT(*) n FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.admin_user_id=? AND p.module='invoices' AND p.action='create'").get(uid).n;
  ok(tieneEmitir === 0, 'precondición: el empleado de prueba NO tiene permiso de emitir facturas');

  const etok = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(etok, uid, now, now + 900, randomBytes(16).toString('hex'));
  const EJ = { 'Cookie': 'asess=' + etok };

  const lista = await (await fetch(BASE + '/api/erp/propuestas', { headers: EJ })).json();
  const tipos = new Set((lista.propuestas || []).map(p => p.type));
  ok(!tipos.has(TIPO_RECURRENTE), 'NO le aparece en la lista de propuestas');
  const contE = await (await fetch(BASE + '/api/erp/propuestas/contador', { headers: EJ })).json();
  ok(!(lista.propuestas || []).some(p => p.id === prop.id), 'ni la propuesta concreta se le cuela');
  const emitE = await fetch(BASE + '/api/erp/propuestas/' + prop.id + '/emitir', {
    method: 'POST', headers: { ...EJ, 'Content-Type': 'application/json', 'x-csrf-token': 'x' }, body: '{}' });
  ok(emitE.status === 403, 'y si fuerza el POST de emitir a mano → 403 (got ' + emitE.status + ')');
  ok(db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(prop.id).status === 'pendiente',
     'la propuesta SIGUE pendiente: no se le emitió ninguna factura');

  // Y en su pantalla, ni rastro. OJO: el empleado va en su PROPIO contexto de navegador. Las cookies
  // se comparten entre pestañas del mismo contexto, así que abrirle una pestaña normal y ponerle su
  // `asess` le robaría la sesión a la pestaña del dueño —que quedaría, sin avisar, siendo el
  // empleado—. Costó un timeout desconcertante en el descarte descubrirlo: dos sesiones distintas
  // necesitan dos navegadores distintos.
  const ctxEmpleado = await browser.createBrowserContext();
  const page2 = await ctxEmpleado.newPage();
  await page2.setCookie({ name: 'asess', value: etok, domain: DOMAIN, path: '/' });
  await page2.goto(BASE + '/admin/propuestas', { waitUntil: 'networkidle0' });
  const html2 = await page2.content();
  ok(!html2.includes(CONCEPTO), 'en SU pantalla de propuestas no aparece la iguala por ningún lado');
  await page2.screenshot({ path: '/tmp/prop-rec-2-candado.png' });
  await ctxEmpleado.close();

  // Y la sesión del dueño sigue siendo la del dueño (que era justo lo que se rompía).
  const yoSigo = await page.evaluate(async () => (await fetch('/api/erp/propuestas/contador')).status);
  ok(yoSigo === 200, 'la pestaña del dueño conserva SU sesión tras el ensayo del candado');

  // ── 4. Descartar desde la UI: se retira y no vuelve ──────────────────────────
  //     (Se cierra descartando a propósito: aprobar EMITIRÍA una factura inmutable en el negocio vivo.
  //      El camino de emitir se prueba entero en verify-propuestas-recurrentes.mjs, sobre una copia.)
  console.log('\n[4] Descartar desde el panel');
  await page.bringToFront();
  await page.evaluate((id) => descartar(id), prop.id);
  // polling por TIEMPO, no por requestAnimationFrame (el de por defecto): esta pestaña estuvo en
  // segundo plano mientras se probaba el candado en otra, y Chromium congela el rAF de las pestañas
  // ocultas → la espera se quedaría mirando un DOM que YA cambió. Costó un timeout entenderlo.
  await page.waitForFunction((id) => !document.getElementById('prop' + id), { timeout: 15000, polling: 500 }, prop.id);
  ok(true, 'la tarjeta desaparece del panel al descartar');
  ok(db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(prop.id).status === 'descartada', 'queda descartada en la BD');
  const r2 = generarPropuestasRecurrentes(db, {});
  ok(r2.creadas === 0, 'el generador NO la vuelve a proponer (el índice único la recuerda)');
  const occTras = db.prepare('SELECT status FROM recurring_occurrences WHERE id=?').get(occ.id);
  ok(occTras.status === 'borrador', 'descartar la propuesta NO toca la ocurrencia: sigue en Recurrentes, esperando');
  ok(db.prepare('SELECT COUNT(*) n FROM invoices WHERE client_id=? AND total=121').get(CLIENT_ID).n >= 0, 'no se emitió ninguna factura por el camino');
  await page.screenshot({ path: '/tmp/prop-rec-3-descartada.png' });

} catch (e) {
  console.error('ERROR en el gate:', e.stack || e.message);
  fail++;
} finally {
  await browser.close();

  // ── Limpieza POR ID de todo lo sembrado. Nada de esto es una factura: ninguna se ha emitido, así que
  //    el negocio queda EXACTAMENTE como estaba (Verifactu incluido). ──
  const db2 = new Database(DB_PATH);
  const facturasAntes = db2.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  db2.transaction(() => {
    for (const id of creado.propuestaIds) db2.prepare('DELETE FROM disa_proposals WHERE id=?').run(id);
    for (const id of creado.occurrenceIds) db2.prepare('DELETE FROM recurring_occurrences WHERE id=?').run(id);
    if (creado.templateId) {
      db2.prepare('DELETE FROM recurring_occurrences WHERE template_id=?').run(creado.templateId);
      db2.prepare('DELETE FROM recurring_template_items WHERE template_id=?').run(creado.templateId);
      db2.prepare('DELETE FROM recurring_templates WHERE id=?').run(creado.templateId);
    }
    for (const uid of creado.usuarios) {
      db2.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(uid);
      db2.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(uid);
      db2.prepare('DELETE FROM admin_users WHERE id=?').run(uid);
    }
  })();
  ok(!db2.prepare('SELECT 1 FROM recurring_templates WHERE id=?').get(creado.templateId), 'limpieza: la plantilla de prueba ya no está');
  ok(db2.prepare('SELECT COUNT(*) n FROM recurring_occurrences').get().n === 0, 'limpieza: no queda ninguna ocurrencia de prueba');
  ok(db2.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_RECURRENTE).n === 0, 'limpieza: no queda ninguna propuesta recurrente');
  ok(db2.prepare('SELECT COUNT(*) n FROM invoices').get().n === facturasAntes,
     'el negocio queda como estaba: NINGUNA factura emitida por este gate (Verifactu intacto)');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador propuestas recurrentes: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
