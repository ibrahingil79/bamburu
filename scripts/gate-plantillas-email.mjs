// Gate de navegador — PLANTILLAS DE EMAIL EDITABLES. Contra el servidor real (tenant desarrollo-bamburu).
//
// Recorre la pantalla de verdad: las dos familias agrupadas, el editor visual, los huecos que se
// insertan con un clic, la vista previa, el bloqueo duro de los correos de sistema, "volver al
// original" — y, al final, LA PRUEBA QUE IMPORTA: se guarda una plantilla propia y se manda un email
// DE VERDAD por Resend, comprobando que lo que sale es el texto del dueño y no el de fábrica.
//
// EL EMAIL SE ENVÍA DE VERDAD, al BUZÓN SUMIDERO de Resend (delivered@resend.dev): cero correos a
// personas. Y se limpia todo por id: el negocio queda como estaba.
import puppeteer from 'puppeteer';
import { tenantDb, launchOpts, engancharToasts, esperarToast, autoAceptarPaneles } from './lib/gate-env.mjs';
import { RID } from './lib/gate-fixtures.mjs';
import { plantillaDeFabrica, htmlAtexto } from '../modules/erp/email-templates.js';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB_PATH = tenantDb('desarrollo-bamburu');
const BASE = 'http://desarrollo-bamburu.localhost:3000';
const DOMAIN = 'desarrollo-bamburu.localhost';
const SINK_EMAIL = 'delivered@resend.dev';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB_PATH);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);

const rid = RID();
const creado = { clienteId: null, facturaIds: [], plantillas: [] };
// Foto de las plantillas de ANTES: al terminar hay que dejarlas exactamente igual.
const plantillasAntes = JSON.stringify(db.prepare('SELECT tipo,tono,subject,html FROM email_templates ORDER BY tipo,tono').all());
// EL INTERRUPTOR DE «AVISOS Y CORREOS», que es más nuevo que este gate. Desde que existe
// `exigirCorreoActivo`, mandar un correo APAGADO devuelve 409 y no sale — y en el negocio de
// desarrollo están todos apagados, así que este gate llevaba en rojo **culpando al producto de
// hacer exactamente lo que debe**. Se guarda cómo estaba para devolverlo igual al final.
const correoAntes = (() => {
  try { return db.prepare("SELECT activo FROM email_tipo_pref WHERE tipo='cobro_factura'").get() || null; }
  catch { return null; }
})();

const browser = await puppeteer.launch({ ...launchOpts() });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await engancharToasts(page);
await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });
const dialogos = [];
page.on('dialog', async d => { dialogos.push(d.message()); await d.accept(); });
// Y el panel que sustituyó a esas ventanitas: se acepta igual que se aceptaba el confirm().
await autoAceptarPaneles(page);

const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };

try {
  // ── 1. La pantalla, con las dos familias separadas ──────────────────────────
  console.log('\n[1] La pantalla: las dos familias, separadas');
  await page.goto(BASE + '/admin/settings/plantillas', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('.tpl-card').length > 0, { timeout: 15000, polling: 300 });
  const txt = await page.$eval('#tplLista', el => el.textContent);
  ok(/Correos a tus clientes/.test(txt), 'agrupa "Correos a tus clientes"');
  ok(/Correos de sistema/.test(txt), 'y "Correos de sistema", separados');
  ok(/sin ese enlace no te dejamos guardar/i.test(await page.$eval('#tplLista', el => el.innerHTML)),
     'y avisa, EN LA PANTALLA, de que los de sistema no se guardan sin su enlace');
  const nTarjetas = await page.$$eval('.tpl-card', els => els.length);
  ok(nTarjetas === 10, 'están los 10 tipos de email que este sistema puede enviar (' + nTarjetas + ')');   // +2: confirmacion_cita, recordatorio_cita (PIEZA 5)
  const nVariantes = await page.$$eval('.tpl-vars button', els => els.length);
  ok(nVariantes === 20, 'con sus 20 variantes editables (los 4 tonos del recordatorio, los 5 del comercial…, + confirmación/recordatorio de cita): ' + nVariantes);
  ok(/Recuperar contraseña/.test(txt) && /Enlace del portal/.test(txt), 'los operativos se ven y se identifican como tales');
  await page.screenshot({ path: '/tmp/tpl-1-lista.png' });

  // ── 2. El editor: visual, con huecos que se insertan ────────────────────────
  console.log('\n[2] El editor: visual, y los huecos se insertan de un clic');
  await page.evaluate(() => abrir('cobro_factura', 'firme-medio'));
  await page.waitForFunction(() => document.getElementById('tplModal').classList.contains('open'), { timeout: 10000, polling: 300 });
  ok(await page.$('#tplEditor[contenteditable="true"]') !== null, 'el editor es VISUAL (contenteditable), no una caja de HTML pelada');
  ok(await page.$$eval('.tpl-tools button', els => els.length) >= 4, 'con negrita, cursiva, listas y enlaces');
  const huecos = await page.$$eval('#tplHuecos .tpl-hueco', els => els.map(e => e.textContent));
  ok(huecos.includes('{{factura}}') && huecos.includes('{{cliente}}') && huecos.includes('{{importe}}'),
     'los huecos de ESTE email se ofrecen como piezas: ' + huecos.join(' '));
  const avanzado = await page.$eval('#tplModal details', el => el.open);
  ok(avanzado === false, 'el HTML crudo existe pero está PLEGADO (quien no lo quiera, ni lo ve)');
  await page.screenshot({ path: '/tmp/tpl-2-editor.png' });

  // Insertar un hueco con un clic (no se teclea: un {{factrua}} mal escrito saldría vacío).
  await page.evaluate(() => {
    const ed = document.getElementById('tplEditor');
    ed.innerHTML = '<p>Hola </p>'; ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.evaluate(() => insertar('{{cliente}}'));
  ok(/\{\{cliente\}\}/.test(await page.$eval('#tplEditor', el => el.innerHTML)), 'pinchar un hueco lo INSERTA en el cursor');

  // ── 3. Vista previa con datos de ejemplo ────────────────────────────────────
  console.log('\n[3] Vista previa antes de guardar');
  await page.evaluate(() => {
    document.getElementById('tplSubject').value = 'Recordatorio de {{empresa}}: {{factura}}';
    document.getElementById('tplEditor').innerHTML = '<p>Hola {{cliente}}, te queda pendiente la {{factura}} ({{importe}}).</p>';
  });
  await page.evaluate(() => previsualizar());
  await page.waitForFunction(() => document.getElementById('tplPreview').style.display !== 'none', { timeout: 10000, polling: 300 });
  const pvSubj = await page.$eval('#pvSubject', el => el.textContent);
  ok(/F2026-0042/.test(pvSubj), 'la previa rellena los huecos con datos de EJEMPLO: ' + JSON.stringify(pvSubj));
  ok(!/\{\{/.test(pvSubj), 'y no enseña ni un hueco crudo');
  const pvHtml = await page.$eval('#pvBody', el => el.getAttribute('srcdoc'));
  ok(/María García/.test(pvHtml), 'el cuerpo también (con un cliente de ejemplo, nunca uno real)');
  await page.screenshot({ path: '/tmp/tpl-3-previa.png' });

  // ── 4. FAMILIA CLIENTE: avisa pero deja guardar ─────────────────────────────
  console.log('\n[4] Cliente: si quitas un dato, te AVISA — pero es tu voz');
  await page.evaluate(() => {
    document.getElementById('tplSubject').value = 'Tienes algo pendiente';
    document.getElementById('tplEditor').innerHTML = '<p>Hola {{cliente}}, pásate cuando puedas.</p>';   // sin factura ni importe
  });
  await page.evaluate(() => guardar());
  await page.waitForFunction(() => document.querySelectorAll('#tplAvisos .alert').length > 0, { timeout: 10000, polling: 300 });
  const avisos = await page.$eval('#tplAvisos', el => el.textContent);
  ok(/Nº de factura/i.test(avisos), 'me avisa de que he quitado el nº de factura');
  ok(!/No se puede guardar/i.test(avisos), 'pero NO me lo impide');
  const guardadaA = db.prepare("SELECT * FROM email_templates WHERE tipo='cobro_factura' AND tono='firme-medio'").get();
  creado.plantillas.push(['cobro_factura', 'firme-medio']);
  ok(guardadaA && /pásate cuando puedas/.test(guardadaA.html), 'y se guardó: era su decisión');
  await page.screenshot({ path: '/tmp/tpl-4-aviso.png' });

  // ── 5. FAMILIA SISTEMA: bloqueo DURO ────────────────────────────────────────
  console.log('\n[5] Sistema: sin el enlace, NO te deja guardar');
  await page.evaluate(() => abrir('recuperar_password', '_'));
  await page.waitForFunction(() => document.getElementById('tplTitulo').textContent.includes('Recuperar'), { timeout: 10000, polling: 300 });
  ok(await page.$eval('#tplCritico', el => el.style.display !== 'none'), 'al abrirlo YA avisa de que es un correo de sistema');
  ok(/se queda fuera de su cuenta/i.test(await page.$eval('#tplCritico', el => el.textContent)),
     'y explica qué pasa si le quitas el enlace, ANTES de que lo intente');
  const huecoCrit = await page.$$eval('#tplHuecos .tpl-hueco.crit', els => els.map(e => e.textContent));
  ok(huecoCrit.includes('{{enlace}}'), 'el hueco crítico va marcado aparte, a la vista');

  await page.evaluate(() => {
    document.getElementById('tplSubject').value = 'Tu contraseña';
    document.getElementById('tplEditor').innerHTML = '<p>Hola {{nombre}}, entra en tu cuenta.</p>';   // ← sin {{enlace}}
  });
  await page.evaluate(() => guardar());
  await page.waitForFunction(() => /No se puede guardar/i.test(document.getElementById('tplAvisos').textContent), { timeout: 10000, polling: 300 });
  const bloqueo = await page.$eval('#tplAvisos', el => el.textContent);
  ok(/No se puede guardar/i.test(bloqueo), 'BLOQUEADO: no se guarda');
  ok(/enlace/i.test(bloqueo), 'y le dice exactamente por qué: ' + JSON.stringify(bloqueo.slice(0, 80) + '…'));
  ok(!db.prepare("SELECT 1 FROM email_templates WHERE tipo='recuperar_password'").get(),
     'y en la BD NO hay nada: la plantilla de recuperar contraseña sigue siendo la de fábrica');
  await page.screenshot({ path: '/tmp/tpl-5-bloqueo.png' });

  // Con el enlace puesto, la misma edición SÍ entra: se bloquea por el enlace, no por capricho.
  await page.evaluate(() => {
    document.getElementById('tplEditor').innerHTML = '<p>Hola {{nombre}}, entra aquí: <a href="{{enlace}}">recuperar</a></p>';
  });
  await page.evaluate(() => guardar());
  const okToast = await esperarToast(page, /guardada/i, 10000);
  ok(!!okToast, 'con el enlace puesto, la MISMA edición sí se guarda (el bloqueo era del enlace, no del texto)');
  creado.plantillas.push(['recuperar_password', '_']);

  // ── 6. Volver al original ───────────────────────────────────────────────────
  console.log('\n[6] Volver al original');
  await page.evaluate(() => volverAlOriginal());
  await esperarToast(page, /restaurada/i, 10000);
  ok(!db.prepare("SELECT 1 FROM email_templates WHERE tipo='recuperar_password'").get(),
     'la edición desaparece de la BD');
  const fab = plantillaDeFabrica('recuperar_password', '_');
  const enEditor = await page.$eval('#tplEditor', el => el.innerHTML);
  ok(enEditor.includes('{{enlace}}') && /Hemos recibido una solicitud/.test(enEditor),
     'y el editor vuelve a enseñar EXACTAMENTE la de fábrica');
  ok(fab.html.includes('{{enlace}}'), 'la de fábrica nunca se perdió: vive en el código');

  // ── 7. LA PRUEBA QUE IMPORTA: se envía MI texto, por Resend, de verdad ──────
  console.log('\n[7] Se envía MI texto — Resend REAL, al buzón sumidero');
  // Cliente de prueba con el buzón sumidero + una factura vencida que cobrar.
  const cli = db.prepare('INSERT INTO clients (name,email,active) VALUES (?,?,1)').run('ZZ Plantillas (gate ' + rid + ')', SINK_EMAIL);
  creado.clienteId = Number(cli.lastInsertRowid);
  const inv = db.prepare(`INSERT INTO invoices (invoice_number,series,year,sequence,client_id,issue_date,due_date,
      company_name,company_fiscal_id,subtotal,tax_amount,total,status)
    VALUES (?, 'F', 2026, 9800, ?, '2026-05-01', '2026-05-15', 'Desarrollo','B00000000', 300, 63, 363, 'emitida')`)
    .run('F2026-9800', creado.clienteId);
  creado.facturaIds.push(Number(inv.lastInsertRowid));

  // Guardo MI recordatorio de pago por la API real de Ajustes — en LOS CUATRO TONOS.
  //
  // Y esto no es pereza, es lo correcto: el motor de cobros ELIGE el tono según la etapa de la deuda
  // (una recién vencida se avisa 'amable'; una de tres meses, 'ultima'). El gate no debe adivinar cuál
  // le tocará. Guardando los cuatro, la afirmación es más fuerte: elija el que elija, tiene que salir
  // MI texto. (La primera versión de este gate guardaba solo 'firme-medio', el motor eligió 'amable',
  // y el gate acusó al producto de un fallo que era del gate.)
  const MARCA = 'Firmado por el gate ' + rid;
  for (const tono of ['amable', 'firme-medio', 'formal', 'ultima']) {
    const put = await fetch(BASE + '/api/erp/settings/email-templates/cobro_factura/' + tono, {
      method: 'PUT', headers: HJ,
      body: JSON.stringify({
        subject: 'Recordatorio de {{empresa}}: {{factura}}',
        html: '<div><p>Hola {{cliente}}, se te quedó pendiente la {{factura}} de {{importe}}.</p><p>' + MARCA + '</p></div>',
      }),
    });
    ok(put.status === 200, 'guardo MI recordatorio de pago (tono ' + tono + ') por la API real de Ajustes');
    creado.plantillas.push(['cobro_factura', tono]);
  }

  // EL GUARDIÁN, DE PASO. Con el correo apagado en Ajustes la ruta NO envía y lo dice con un 409.
  // Se comprueba aquí para que este gate no vuelva a confundir «apagado» con «roto».
  db.prepare(`INSERT INTO email_tipo_pref (tipo, activo, updated_at) VALUES ('cobro_factura', 0, CURRENT_TIMESTAMP)
              ON CONFLICT(tipo) DO UPDATE SET activo=0, updated_at=CURRENT_TIMESTAMP`).run();
  const apagado = await fetch(BASE + '/api/erp/invoices/' + creado.facturaIds[0] + '/collection-actions', {
    method: 'POST', headers: HJ, body: JSON.stringify({ type: 'recordatorio_email', channel: 'email' }),
  });
  ok(apagado.status === 409, 'con el correo APAGADO en Ajustes, el envío no sale y se dice → ' + apagado.status);

  // Y con el correo encendido, se manda POR SU CAMINO DE SIEMPRE (registerCollectionAction → Resend).
  db.prepare(`INSERT INTO email_tipo_pref (tipo, activo, updated_at) VALUES ('cobro_factura', 1, CURRENT_TIMESTAMP)
              ON CONFLICT(tipo) DO UPDATE SET activo=1, updated_at=CURRENT_TIMESTAMP`).run();
  const envio = await fetch(BASE + '/api/erp/invoices/' + creado.facturaIds[0] + '/collection-actions', {
    method: 'POST', headers: HJ,
    body: JSON.stringify({ type: 'recordatorio_email', channel: 'email' }),
  });
  const envBody = await envio.json();
  ok(envio.status === 200 || envio.status === 201, 'se manda el recordatorio por su ruta de siempre → ' + envio.status);
  ok(envBody.email && envBody.email.sent, 'Resend lo aceptó de verdad (sent: ' + JSON.stringify(envBody.email && envBody.email.to) + ')');
  ok(envBody.email && envBody.email.to === SINK_EMAIL, 'y fue al buzón sumidero, no a una persona');
  ok(/^Recordatorio de .*: F2026-9800$/.test(envBody.email.subject || ''),
     'el ASUNTO enviado es el MÍO, con los huecos rellenos: ' + JSON.stringify(envBody.email.subject));

  // El CUERPO. `collection_actions` guarda que se mandó un recordatorio, pero NO el texto, así que el
  // cuerpo no se puede leer de ahí (comprobado: la tabla no tiene columna de texto). Se pide a la ruta
  // que CONSTRUYE el email de esta factura — la misma llamada, la misma plantilla y el mismo tono que
  // acaba de usar el envío. Si aquí sale mi texto, es que es el que salió por Resend.
  const prev = await (await fetch(BASE + '/api/erp/invoices/' + creado.facturaIds[0] + '/collection-email-preview', { headers: HJ })).json();
  ok(prev.text && prev.text.includes(MARCA),
     'el CUERPO que construye la ruta de envío lleva MI texto, no el de fábrica');
  ok(/F2026-9800/.test(prev.text || ''), 'con los huecos rellenos con los datos reales de la factura');
  ok(prev.subject === envBody.email.subject,
     'y es la MISMA plantilla que Resend acaba de aceptar (mismo asunto, mismo tono: ' + JSON.stringify(prev.tono) + ')');
  // Ninguno de los CUATRO textos de fábrica salió: da igual qué tono eligiera el motor, mandó el mío.
  const fabricas = ['amable', 'firme-medio', 'formal', 'ultima']
    .map(t => htmlAtexto(plantillaDeFabrica('cobro_factura', t).html));
  ok(fabricas.every(f => !prev.text.includes(f.split('\n').find(l => l.length > 40) || '@@')),
     'y NINGUNO de los cuatro textos de fábrica se envió: eligiera el tono que eligiera, mandó el mío');
  await page.screenshot({ path: '/tmp/tpl-6-enviado.png' });

} catch (e) {
  console.error('ERROR en el gate:', e.stack || e.message);
  fail++;
} finally {
  await browser.close();

  // ── Limpieza POR ID: el negocio queda exactamente como estaba ──
  const db2 = new Database(DB_PATH);
  // El interruptor vuelve a como estaba: si no existía fila, se borra; si existía, su valor.
  try {
    if (correoAntes == null) db2.prepare("DELETE FROM email_tipo_pref WHERE tipo='cobro_factura'").run();
    else db2.prepare("UPDATE email_tipo_pref SET activo=? WHERE tipo='cobro_factura'").run(correoAntes.activo);
  } catch {}
  db2.transaction(() => {
    for (const [tipo, tono] of creado.plantillas) db2.prepare('DELETE FROM email_templates WHERE tipo=? AND tono=?').run(tipo, tono);
    db2.prepare("DELETE FROM email_templates WHERE tipo='cobro_factura' AND tono='firme-medio'").run();
    if (creado.clienteId) {
      for (const id of creado.facturaIds) {
        db2.prepare('DELETE FROM collection_actions WHERE invoice_id=?').run(id);
        db2.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(id);
        db2.prepare('DELETE FROM invoices WHERE id=?').run(id);
      }
      db2.prepare('DELETE FROM disa_proposals WHERE client_id=?').run(creado.clienteId);
      db2.prepare('DELETE FROM client_activities WHERE client_id=?').run(creado.clienteId);
      db2.prepare('DELETE FROM clients WHERE id=?').run(creado.clienteId);
    }
  })();
  const plantillasDespues = JSON.stringify(db2.prepare('SELECT tipo,tono,subject,html FROM email_templates ORDER BY tipo,tono').all());
  ok(plantillasDespues === plantillasAntes, 'limpieza: las plantillas del negocio quedan EXACTAMENTE como estaban');
  ok(!db2.prepare('SELECT 1 FROM clients WHERE id=?').get(creado.clienteId), 'limpieza: el cliente de prueba ya no está');
  db2.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
  db2.close();
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Gate navegador plantillas de email: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
