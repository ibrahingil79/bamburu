// Gate — AVISOS Y CORREOS: que el dueño mande sobre su bandeja de entrada.
//
// Contra el servidor REAL y sobre un negocio CREADO DESDE CERO para esta pasada (y borrado al
// final): así se comprueba lo que le pasa a un negocio nuevo, que es donde viven los defectos, y no
// lo que le pasa al tenant de desarrollo, que lleva meses de manoseo encima.
//
// LOS CORREOS SE ENVÍAN DE VERDAD, al BUZÓN SUMIDERO de Resend (delivered@resend.dev): se ejerce el
// camino entero —plantilla, render, Resend, registro— sin que le llegue un correo a ninguna persona.
// Un gate que sustituye el envío por un doble no prueba el envío.
//
//   node scripts/gate-avisos-correos.mjs
import puppeteer from 'puppeteer';
import path from 'path';
import { unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { launchOpts } from './lib/gate-env.mjs';
import { controlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { dinero } from '../modules/erp/parte-diario.js';

import { soltarAtaduras } from './lib/tirar-negocio.mjs';
const SINK = 'delivered@resend.dev';          // buzón sumidero de Resend: cero correos a personas
const RID = randomBytes(3).toString('hex');
const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + m + (extra ? ' — ' + extra : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); }
};

// Ejecuta el cron del resumen forzando la hora local. Devuelve su salida entera.
function pasadaDelTemporizador(dbRel, hora, extra = []) {
  try {
    return execFileSync('/usr/bin/node', ['scripts/bamburu-avisos.mjs', ...extra], {
      cwd: APP_DIR, encoding: 'utf8',
      env: { ...process.env, AVISOS_DB: dbRel, AVISOS_HORA: String(hora) },
    });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

function pasadaRecordatorios(dbRel) {
  try {
    return execFileSync('/usr/bin/node', ['scripts/bamburu-recordatorios-cita.mjs'], {
      cwd: APP_DIR, encoding: 'utf8', env: { ...process.env, CITAS_DB: dbRel },
    });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

let slug = null, dbPath = null, dbRel = null, db = null, browser = null;

function limpiar() {
  try { if (db) db.close(); } catch {}
  if (!slug) return;
  const t = getTenantBySlug(slug);
  if (t) controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(t.id);
  // ⚙️ 3 SEP 2026 — SUELTA LAS ATADURAS ANTES DE BORRAR EL NEGOCIO. Desde el 2 de septiembre
  // `createTenant` siembra la prueba de 15 días, así que todo negocio nuevo tiene fila en
  // `tenant_suscripciones`: sin soltarla, el DELETE de abajo muere con FOREIGN KEY y el negocio de
  // prueba se queda dentro de control.db para siempre. `soltarAtaduras` le pregunta al esquema.
  soltarAtaduras(slug);
  controlDb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  if (t) {
    const abs = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
    for (const f of [abs, abs + '-wal', abs + '-shm']) { try { unlinkSync(f); } catch {} }
  }
}

const hoy = () => new Date().toISOString().slice(0, 10);
const maniana = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] HUMO DE PUNTA A PUNTA — negocio nuevo, apagar, encender a otra hora');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const alta = await provisionTenant({
    businessName: 'Gate Avisos ' + RID,
    ownerName: 'Dueña Gate',
    email: SINK,                                  // el dueño recibe en el sumidero
    password: 'Gate.Avisos.' + RID + '!',
    phone: '+34 600 000 000',
  });
  slug = alta.slug || getTenantBySlug(alta.slug)?.slug;
  const t = getTenantBySlug(slug);
  ok(!!t, 'negocio creado desde cero', slug);
  dbPath = path.isAbsolute(t.db_filename) ? t.db_filename : path.join(APP_DIR, t.db_filename);
  dbRel = path.relative(APP_DIR, dbPath);
  db = new Database(dbPath);

  const BASE = 'http://' + slug + '.localhost:3000';
  const DOMAIN = slug + '.localhost';

  // El dueño (id 1) y una empleada SIN permiso de cobros. Los dos con dirección propia: es la
  // premisa entera del encargo (el correo va a la persona, no al negocio).
  const owner = db.prepare("SELECT id, email FROM admin_users WHERE role='owner'").get();
  ok(!!owner && !!owner.email, 'el dueño tiene dirección de correo propia', owner && owner.email);
  const empleadaId = db.prepare(
    "INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run('Empleada Gate', 'empleada+' + RID + '@resend.dev', 'x').lastInsertRowid;
  const dar = (uid, mod, act) => {
    const p = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(mod, act);
    if (p) db.prepare('INSERT OR IGNORE INTO user_permissions (admin_user_id, permission_id) VALUES (?,?)').run(uid, p.id);
  };
  // Ve inventario y citas; NO ve cobros. Es la pareja de la prueba de permisos.
  dar(empleadaId, 'inventory', 'read');
  dar(empleadaId, 'citas', 'read');

  // Datos REALES que el parte tiene que contar: una factura vencida (deuda) y un producto bajo mínimo.
  // La factura se crea por el SERVICIO VALIDADO, no a mano: así lleva su numeración, su cadena de
  // huella y su vencimiento como cualquier factura de verdad, y el parte cuenta un dato real. Con
  // pago a 0 días y fecha de enero, nace vencida — que es lo que el parte tiene que saber contar.
  const cli = db.prepare("INSERT INTO clients (name,email,active,payment_term_days) VALUES (?,?,1,0)")
    .run('Cliente Gate', SINK).lastInsertRowid;
  const factura = createInvoice(db, {
    client_id: cli, issue_date: '2026-01-10',
    lines: [{ description: 'Trabajo del gate', quantity: 1, unit_price: 1000, tax_rate: 21 }],
  });

  // ── 1.a Apagar el resumen DESDE LA PANTALLA ────────────────────────────────────────────────────
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(token, owner.id, now, now + 3600, csrf);

  browser = await puppeteer.launch({ ...launchOpts() });
  const page = await browser.newPage();
  const erroresJs = [], respuestas404 = [];
  page.on('response', r => { if (r.status() === 404) respuestas404.push(r.url()); });
  page.on('pageerror', e => erroresJs.push(String(e.message || e)));
  // Un 404 de /favicon.ico NO es un error de JavaScript: lo emite el navegador en CUALQUIER pantalla
  // del panel y es anterior a este encargo. Contarlo aquí convertiría el gate en un detector de
  // ruido de fondo, y un gate que falla por algo que no mira deja de significar nada.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon\.ico/.test(t)) return;
    if (/Failed to load resource/.test(t) && respuestas404.every(u => /favicon\.ico/.test(u))) return;
    erroresJs.push('console: ' + t);
  });

  await page.setViewport({ width: 1280, height: 1000 });
  await page.setCookie({ name: 'asess', value: token, domain: DOMAIN, path: '/' });

  await page.goto(BASE + '/admin/settings/avisos', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('[data-linea]').length > 0, { timeout: 15000, polling: 200 });
  ok(await page.$('#avActivo') !== null, 'la pantalla Ajustes → Avisos y correos existe y carga');
  ok(await page.$eval('#avActivo', el => el.checked) === true, 'el resumen nace ENCENDIDO (nadie deja de recibir por la migración)');
  const nLineas = await page.$$eval('[data-linea]', els => els.length);
  ok(nLineas >= 8, 'y con todas las fuentes marcadas por defecto (' + nLineas + ' casillas)');
  ok(await page.$$eval('[data-linea]', els => els.every(e => e.checked)), 'las casillas nacen TODAS marcadas');

  await page.click('#avActivo');
  await page.click('#avGuardar');
  await page.waitForFunction(() => /Guardado/.test(document.body.textContent), { timeout: 10000, polling: 200 }).catch(() => {});
  const esperarPref = async (cond, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = db.prepare('SELECT activo, hora FROM avisos_pref_usuario WHERE admin_user_id=?').get(owner.id);
      if (r && cond(r)) return r;
      await new Promise(res => setTimeout(res, 150));
    }
    return db.prepare('SELECT activo, hora FROM avisos_pref_usuario WHERE admin_user_id=?').get(owner.id) || null;
  };
  const prefTrasApagar = await esperarPref(r => r.activo === 0);
  ok(prefTrasApagar && prefTrasApagar.activo === 0, 'apagar el interruptor en pantalla se guarda de verdad',
     JSON.stringify(prefTrasApagar));

  // ── 1.b Con el resumen apagado, la pasada NO manda nada ───────────────────────────────────────
  let salida = pasadaDelTemporizador(dbRel, 8);
  ok(!/enviado a/.test(salida), 'con el resumen apagado, la pasada de las 08:00 NO envía ni un correo');
  const filasTrasApagado = db.prepare('SELECT COUNT(*) n FROM resumen_envios WHERE admin_user_id=?').get(owner.id).n;
  ok(filasTrasApagado === 0, 'y no marca el día como resuelto: si mañana lo enciende, le llega');

  // ── 1.c Encenderlo A OTRA HORA, desde la pantalla ─────────────────────────────────────────────
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('avActivo') !== null, { timeout: 15000, polling: 200 });
  await page.click('#avActivo');
  await page.select('#avHora', '15');
  await page.click('#avGuardar');
  await page.waitForFunction(() => /Guardado/.test(document.body.textContent), { timeout: 10000, polling: 200 }).catch(() => {});
  const pref15 = await esperarPref(r => r.activo === 1 && r.hora === 15);
  ok(pref15 && pref15.activo === 1 && pref15.hora === 15, 'encendido y movido a las 15:00 desde la pantalla',
     JSON.stringify(pref15));

  salida = pasadaDelTemporizador(dbRel, 9);
  ok(!/enviado a/.test(salida), 'la pasada de las 09:00 NO le escribe: su hora es la de las 15:00');

  salida = pasadaDelTemporizador(dbRel, 15);
  ok(/enviado a/.test(salida), 'la pasada de las 15:00 SÍ le escribe');
  const envio = db.prepare('SELECT * FROM resumen_envios WHERE admin_user_id=? AND fecha=?').get(owner.id, hoy());
  ok(envio && envio.enviado === 1, 'y queda registrado como enviado');
  ok(envio && envio.lineas > 0, 'con las líneas que llevaba el parte (' + (envio && envio.lineas) + ')');
  // El contenido: la pasada de verdad solo registra "enviado a X · N línea(s)" (no vuelca el correo
  // al journal, que sería sacar cifras del negocio al log del sistema). Para leer lo que llevaba se
  // repite la MISMA pasada en seco, que sí imprime las frases.
  const esperado = dinero(1210);   // el mismo formateador del producto: en es-ES, '1210,00 €'
  const contenido = pasadaDelTemporizador(dbRel, 15, ['--dry-run']);
  ok(contenido.includes(esperado), 'el contenido cuadra con los datos REALES del negocio: la deuda de ' + esperado,
     (contenido.match(/Te deben[^\n]*/) || [''])[0].trim());
  ok(/Tu negocio hoy · /.test(contenido), 'y el asunto lleva la noticia, no un recuento de avisos',
     (contenido.match(/"Tu negocio hoy[^"]*"/) || [''])[0]);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] EL CORREO VACÍO — si no hay nada que contar, no se envía (pero consta)');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // La empleada ve inventario y citas, y este negocio no tiene ni productos bajo mínimo ni citas:
  // su parte sale vacío. Es el caso exacto de "no hay nada que contar".
  const salidaVacio = pasadaDelTemporizador(dbRel, 15);
  const filaEmpleada = db.prepare('SELECT * FROM resumen_envios WHERE admin_user_id=? AND fecha=?').get(empleadaId, hoy());
  ok(filaEmpleada && filaEmpleada.enviado === 0, 'sin nada que contar → NO se envía correo');
  ok(filaEmpleada && filaEmpleada.motivo === 'sin_nada_que_contar', 'y el motivo queda escrito, no se pierde en el silencio',
     filaEmpleada && filaEmpleada.motivo);
  ok(!new RegExp('enviado a ' + 'empleada').test(salidaVacio), 'no le sale ni un "no tienes avisos"');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] PERMISOS — misma pasada, mismo negocio, dos partes distintos');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Se le da a la empleada un producto bajo mínimo para que SÍ tenga parte, y así la comparación es
  // entre dos partes que existen, no entre "uno sí y otro vacío".
  // "Bajo mínimo" no es una columna del producto: vive en stock_levels.min_qty POR ALMACÉN (así lo
  // calcula productosBajoMinimo, que es la fuente del aviso). Sin stock y con mínimo 5 → bajo mínimo.
  const prodId = db.prepare(`INSERT INTO products (name, sku, price, stock, status, type)
                             VALUES (?,?,?,0,'active','physical')`).run('Producto Gate', 'GATE-' + RID, 10).lastInsertRowid;
  const almacen = db.prepare('SELECT id FROM warehouses WHERE active=1 ORDER BY is_default DESC, id LIMIT 1').get();
  ok(!!almacen, 'el negocio nuevo trae su almacén por defecto');
  db.prepare('INSERT OR REPLACE INTO stock_levels (product_id, warehouse_id, min_qty, target_qty) VALUES (?,?,?,?)')
    .run(prodId, almacen.id, 5, 10);
  const seco = pasadaDelTemporizador(dbRel, 15, ['--dry-run']);
  // El dry-run imprime "<slug>/<correo>: [dry-run] …" y debajo sus frases con sangría. Se sigue esa
  // estructura línea a línea: recortar por índices de texto se rompía en cuanto cambiaba el formato.
  //   [bamburu-avisos] <slug>/<correo>: [dry-run] N línea(s) · "asunto"
  //   [bamburu-avisos]     · <frase>
  //   [bamburu-avisos]     · <frase>
  // Se abre bloque en la línea de [dry-run] y se cierra en cuanto llega una que NO sea una frase
  // sangrada. Nada de recortar por índices de texto: eso se rompe en cuanto cambia el formato.
  const esFrase = l => /^\[bamburu-avisos\]\s{2,}·\s/.test(l);
  const bloqueDe = correo => {
    const out = [];
    let dentro = false;
    for (const linea of seco.split('\n')) {
      if (/\[dry-run\]/.test(linea)) { dentro = linea.includes(correo); continue; }
      if (dentro && esFrase(linea)) out.push(linea);
      else if (dentro) dentro = false;
    }
    return out.join('\n');
  };
  const parteDueña = bloqueDe(owner.email);
  const parteEmpleada = bloqueDe('empleada+' + RID);
  ok(/Te deben/.test(parteDueña), 'la dueña, con permiso de cobros, SÍ recibe la cifra de deuda');
  ok(/Te deben/.test(parteEmpleada) === false, 'la empleada, con cobros prohibido, NO recibe ni una cifra de deuda');
  ok(/1210/.test(parteEmpleada) === false, 'ni el importe se le cuela por otra frase');
  ok(/por debajo de su mínimo/.test(parteEmpleada), 'pero sí recibe lo suyo: el producto bajo mínimo',
     parteEmpleada.trim().split('\n').pop());

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] NO DUPLICADO — dos pasadas seguidas a la misma hora, un solo correo');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const antes = db.prepare('SELECT COUNT(*) n FROM resumen_envios WHERE fecha=? AND enviado=1').get(hoy()).n;
  const rep1 = pasadaDelTemporizador(dbRel, 15);
  const rep2 = pasadaDelTemporizador(dbRel, 15);
  const despues = db.prepare('SELECT COUNT(*) n FROM resumen_envios WHERE fecha=? AND enviado=1').get(hoy()).n;
  ok(despues === antes, 'dos pasadas más a la misma hora no generan ni un envío nuevo', antes + ' → ' + despues);
  ok(!/enviado a/.test(rep1) && !/enviado a/.test(rep2), 'y ninguna de las dos vuelve a escribir a nadie');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] INTERRUPTORES DE LOS CORREOS A CLIENTES');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const HJ = { 'Cookie': 'asess=' + token, 'Content-Type': 'application/json', 'x-csrf-token': csrf };
  const apiGet = async u => (await fetch(BASE + u, { headers: HJ })).json();
  const apiPut = async (u, body) => {
    const r = await fetch(BASE + u, { method: 'PUT', headers: HJ, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const correos = await apiGet('/api/erp/settings/avisos/correos');
  const porTipo = Object.fromEntries((correos.correos || []).map(x => [x.tipo, x]));
  ok(!!porTipo.recordatorio_cita && !!porTipo.cobro_factura, 'el bloque 2 lista los correos conmutables');
  ok((correos.sinInterruptor || []).some(x => x.tipo === 'recuperar_password'),
     'y deja fuera, explicándolo, el de recuperar contraseña');

  // 5.a El recordatorio de cita: apagado → no sale; encendido → sale.
  const cita = db.prepare(`INSERT INTO citas (user_id, fecha, inicio_min, dur_min, estado, cliente_id, token)
                           VALUES (1,?,600,30,'confirmada',?,?)`)
    .run(maniana(), cli, randomBytes(16).toString('base64url')).lastInsertRowid;

  await apiPut('/api/erp/settings/avisos/correos/recordatorio_cita', { activo: false });
  let recSalida = pasadaRecordatorios(dbRel);
  let avisado = db.prepare("SELECT COUNT(*) n FROM cita_avisos WHERE cita_id=? AND tipo='recordatorio'").get(cita).n;
  ok(avisado === 0, 'recordatorio de cita APAGADO → se crea una cita y NO sale correo');

  await apiPut('/api/erp/settings/avisos/correos/recordatorio_cita', { activo: true });
  recSalida = pasadaRecordatorios(dbRel);
  avisado = db.prepare("SELECT COUNT(*) n FROM cita_avisos WHERE cita_id=? AND tipo='recordatorio'").get(cita).n;
  ok(avisado === 1, 'encendido → la misma cita SÍ recibe su recordatorio');
  // Y el interruptor es EL QUE YA HABÍA, no uno nuevo al lado.
  const modo = db.prepare('SELECT cita_modo_recordatorio m FROM company_config WHERE id=1').get().m;
  ok(modo === 'auto_email', 'el interruptor escribe en el ajuste que YA existía (cita_modo_recordatorio), no en uno paralelo', modo);

  // 5.b La confirmación de reserva, con la puerta pública encendida: BLOQUEADA.
  db.prepare('UPDATE company_config SET cita_pub_activa=1 WHERE id=1').run();
  const conPuerta = await apiGet('/api/erp/settings/avisos/correos');
  const conf = (conPuerta.correos || []).find(x => x.tipo === 'confirmacion_cita');
  ok(!!conf && !!conf.bloqueo, 'con las reservas por Internet encendidas, la confirmación aparece BLOQUEADA');
  ok(!!conf && /apaga antes las reservas por Internet/i.test(conf.bloqueo), 'y explica cómo desbloquearla', conf && conf.bloqueo);
  const intento = await apiPut('/api/erp/settings/avisos/correos/confirmacion_cita', { activo: false });
  ok(intento.status === 409, 'y el servidor RECHAZA apagarla (409), no solo la pantalla', 'status ' + intento.status);
  ok(conf.activo === true, 'mientras tanto sigue encendida: la promesa de la política de cancelación se cumple');

  // 5.c Un interruptor de los de botón: apagado, el envío se niega con un motivo claro.
  await apiPut('/api/erp/settings/avisos/correos/cobro_factura', { activo: false });
  const facturaId = factura.id;
  const envioCobro = await fetch(BASE + '/api/erp/invoices/' + facturaId + '/collection-actions', {
    method: 'POST', headers: HJ, body: JSON.stringify({ type: 'recordatorio_email', channel: 'email' }),
  });
  const cuerpoCobro = await envioCobro.json().catch(() => ({}));
  ok(envioCobro.status === 409, 'con el recordatorio de pago apagado, el envío se niega (409)', 'status ' + envioCobro.status);
  ok(/apagado en Ajustes/i.test(cuerpoCobro.error || ''), 'y dice exactamente dónde encenderlo', cuerpoCobro.error);
  await apiPut('/api/erp/settings/avisos/correos/cobro_factura', { activo: true });

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] LA PANTALLA — escritorio y móvil, sin un solo error de JavaScript');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  await page.goto(BASE + '/admin/settings/avisos', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('.av-correo').length > 0, { timeout: 15000, polling: 200 });
  ok(await page.$$eval('.av-correo', els => els.length) >= 7, 'escritorio: los dos bloques se pintan enteros');
  ok(/🔒/.test(await page.$eval('#avCorreos', el => el.textContent)), 'y el candado de la confirmación de reserva se ve');
  const anchoDesktop = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 2);
  ok(anchoDesktop, 'escritorio: no hay desbordamiento horizontal');
  await page.screenshot({ path: '/tmp/avisos-correos-escritorio.png', fullPage: true });

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('[data-linea]').length > 0, { timeout: 15000, polling: 200 });
  const anchoMovil = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 2);
  ok(anchoMovil, 'móvil (390px): tampoco desborda a lo ancho');
  ok(await page.$eval('#avHora', el => el.offsetWidth > 60), 'móvil: el selector de hora sigue siendo usable');
  await page.screenshot({ path: '/tmp/avisos-correos-movil.png', fullPage: true });

  // La previa del parte: la pantalla enseña el MISMO veredicto que decide el envío.
  const previa = await page.$eval('#avPrevia', el => el.textContent);
  ok(/Tu parte de hoy/.test(previa), 'la pantalla enseña cómo quedaría tu parte de hoy');
  ok(/Te deben|no hay nada que contarte/.test(previa), 'con el mismo cálculo que usa el correo', previa.trim().slice(0, 80));

  ok(erroresJs.length === 0, 'CERO errores de JavaScript en todo el recorrido',
     erroresJs.length ? erroresJs.slice(0, 3).join(' | ') : 'limpio (404 ignorados: ' + (respuestas404.length ? respuestas404.map(u => u.split('/').pop()).join(', ') : 'ninguno') + ')');

} catch (e) {
  fail++;
  console.error('\n✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  try { if (browser) await browser.close(); } catch {}
  console.log('\n[limpieza] borrando el negocio de prueba: ' + slug);
  limpiar();
  console.log('  ✓ negocio de prueba eliminado');
}

console.log('\n═════════ RESULTADO: ' + pass + ' OK · ' + fail + ' fallos ═════════');
process.exit(fail ? 1 : 0);
