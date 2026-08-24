// GATE DEL PUNTO 14 — lo construible de las fichas J y K.
//   node scripts/gate-importador-proveedores.mjs
//
// QUÉ SE ENTREGA AQUÍ. Las dos fichas están paradas por algo EXTERNO, y el encargo pedía dos cosas:
// medir exactamente qué falta de fuera, y construir todo lo que no dependa de ello.
//   · FICHA J (pago con tarjeta en el portal): lo que falta es una PASARELA CONTRATADA, y hay una
//     norma del propio dueño (28 jul 2026) que **prohíbe dejar ganchos preparados**. Así que lo
//     construible es CERO por decisión suya, no por falta de ganas — y este gate lo comprueba:
//     que NO haya aparecido ningún gancho.
//   · FICHA K (importadores de Holded y Quipu): la máquina genérica ya existía (ficha H). El hueco
//     REAL, y que no dependía de ningún fichero de fuera, eran los PROVEEDORES: se podían traer
//     clientes y productos de otro programa, y los proveedores había que teclearlos uno a uno.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { tenantDb, launchOpts } from './lib/gate-env.mjs';
import { TIPOS, CAMPOS, analizar, importar, automapear } from '../modules/erp/importador.js';

const SLUG = 'desarrollo-bamburu';
const HOST = SLUG + '.bamburu.com', BASE = 'https://' + HOST;
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const RID = randomBytes(3).toString('hex');
const MARCA = 'GIP-' + RID;
const TOKEN_PREFIJO = 'gate-imprv-';
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

const db = new Database(tenantDb(SLUG));
db.pragma('busy_timeout = 10000');
const owner = db.prepare("SELECT id, name FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
const ahora = Math.floor(Date.now() / 1000);
const tok = TOKEN_PREFIJO + randomBytes(20).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(tok, owner.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));

let browser = null;
try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] FICHA J — sigue SIN un solo gancho de pasarela, que es lo que manda la norma');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // La norma del 28 jul 2026 prohíbe dejar ganchos preparados. Un gancho a medias es peor que nada:
  // parece que el pago existe, y no existe. Esto lo comprueba, no lo supone.
  const ficheros = [];
  const barrer = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'public'].includes(f.name)) continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) barrer(p); else if (/\.(js|mjs)$/.test(f.name)) ficheros.push(p);
  } };
  barrer(path.join(RAIZ, 'modules')); barrer(path.join(RAIZ, 'core'));
  const sospechosos = ficheros.filter(f => {
    const s = fs.readFileSync(f, 'utf8');
    // Se buscan SEÑALES DE INTEGRACIÓN, no la palabra suelta: un comentario que diga «pasarela» es
    // documentación, y una clave de Stripe o una llamada a su API es un gancho.
    return /require\(['"]stripe|from ['"]stripe|api\.stripe\.com|sis\.redsys|STRIPE_[A-Z_]*KEY|REDSYS_/.test(s);
  });
  ok(sospechosos.length === 0, 'ni una integración de pasarela en el código',
     sospechosos.map(f => f.replace(RAIZ + '/', '')).join(', ') || 'ninguna');
  const portal = fs.readFileSync(path.join(RAIZ, 'modules/portal/index.js'), 'utf8');
  ok(!/Pagar con tarjeta|pagar ahora|checkout/i.test(portal),
     'y el portal no promete un botón de pagar que no existe');
  ok(/iban|transferencia/i.test(portal), '  pero sí dice cómo se paga hoy: por transferencia');
  // Lo que YA está listo para el día que llegue la pasarela, y que no es un gancho: es el negocio.
  const facturasPortal = /clientInvoices/.test(portal);
  ok(facturasPortal, 'lo que sí está listo: la factura, su estado de pago derivado y el IBAN');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] FICHA K — el hueco real que no dependía de nadie: los PROVEEDORES');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(!!TIPOS.proveedores, 'el importador sabe traer proveedores', TIPOS.proveedores?.label);
  ok(TIPOS.proveedores.perm === 'suppliers.create',
     '  con el MISMO permiso que el formulario de alta, no uno nuevo', TIPOS.proveedores.perm);
  ok(CAMPOS.proveedores.length >= 9, '  y con sus campos', CAMPOS.proveedores.length + ' campos');
  ok(CAMPOS.proveedores.filter(c => c.obligatorio).length === 1,
     '  de los que solo el nombre es obligatorio (lo demás puede faltar en una exportación real)');
  // El automapeo, con cabeceras como las escribe un programa español de verdad.
  const cabeceras = ['Razón social', 'CIF', 'Persona de contacto', 'Correo electrónico', 'Teléfono',
                     'Domicilio', 'Población', 'Plazo de pago', 'Método de pago', 'Observaciones'];
  const mapa = automapear(cabeceras, 'proveedores');
  const acertados = Object.values(mapa).filter(v => v != null).length;
  ok(acertados >= 9, 'el automapeo acierta cabeceras españolas de verdad, con acentos y todo',
     acertados + ' de ' + cabeceras.length);
  ok(mapa.name === 0 && mapa.fiscal_id === 1 && mapa.city === 6,
     '  y cada una en su sitio', JSON.stringify({ nombre: mapa.name, nif: mapa.fiscal_id, ciudad: mapa.city }));

  console.log('\n[3] LA VISTA PREVIA NO ESCRIBE, y dice qué está mal ANTES de tocar nada');
  const antes = db.prepare('SELECT COUNT(*) n FROM suppliers').get().n;
  const csv = 'Nombre;NIF;Email;Forma de pago;Dias de pago\n'
    + MARCA + ' Uno;' + MARCA.slice(0, 8) + '1;a@b.c;transferencia;30\n'
    + MARCA + ' Dos;;x@y.z;efectivo;0\n'
    + ';' + MARCA.slice(0, 8) + '3;;;\n'
    + MARCA + ' Cuatro;' + MARCA.slice(0, 8) + '1;;;\n';
  const prev = analizar(db, { tipo: 'proveedores', texto: csv });
  ok(db.prepare('SELECT COUNT(*) n FROM suppliers').get().n === antes, 'la vista previa NO escribe nada');
  ok(prev.resumen.total === 4 && prev.resumen.malas === 2, '  y cuenta lo bueno y lo malo', JSON.stringify(prev.resumen));
  const f4 = prev.filas.find(f => f.n === 4);
  ok(/Nombre: hace falta/.test((f4.errores || []).join(' ')), '  una fila sin nombre falla, y dice por qué', (f4.errores || [])[0]);
  const f5 = prev.filas.find(f => f.n === 5);
  ok(/repetido en este fichero/.test((f5.errores || []).join(' ')),
     '  y un NIF repetido DENTRO del fichero se caza antes de tocar la base', (f5.errores || [])[0]);

  console.log('\n[4] IMPORTAR DE VERDAD, Y DESHACER');
  const bueno = 'Nombre;NIF;Email;Forma de pago;Dias de pago\n'
    + MARCA + ' Uno;' + MARCA.slice(0, 8) + '1;a@b.c;transferencia;30\n'
    + MARCA + ' Dos;;x@y.z;efectivo;0\n';
  const r = importar(db, { tipo: 'proveedores', texto: bueno, nombre: MARCA + '.csv',
                           session: { userId: owner.id, userName: owner.name } });
  ok(r.creadas === 2, 'entran los dos proveedores', r.creadas + '');
  const uno = db.prepare('SELECT * FROM suppliers WHERE name=?').get(MARCA + ' Uno');
  ok(!!uno && uno.payment_term_days === 30 && uno.payment_method === 'transferencia',
     '  con sus días de pago y su forma de pago traducidos', uno.payment_term_days + 'd · ' + uno.payment_method);
  ok(!!uno.supplier_code, '  y con su código interno, como si se hubiera dado de alta a mano', uno.supplier_code);
  // El NIF duplicado contra la BASE se rechaza en la segunda pasada.
  const prev2 = analizar(db, { tipo: 'proveedores', texto: bueno });
  ok(/ya lo tiene/.test(JSON.stringify(prev2.filas)), 'volver a subir el mismo fichero se rechaza por NIF, no duplica');
  // DESHACER: archiva, no borra.
  const undo = await fetch(BASE + '/api/erp/importar/' + r.lote_id + '/deshacer', { method: 'POST',
    headers: { cookie: 'asess=' + tok, 'x-csrf-token': db.prepare('SELECT csrf_token FROM admin_sessions WHERE token=?').get(tok).csrf_token,
               'content-type': 'application/json' } });
  const undoJson = await undo.json().catch(() => ({}));
  ok(undo.status === 200 && undoJson.archivadas === 2, 'deshacer archiva los dos', JSON.stringify(undoJson));
  ok(db.prepare("SELECT COUNT(*) n FROM suppliers WHERE name LIKE '" + MARCA + "%'").get().n === 2,
     '  y NO los borra: siguen en la tabla, archivados');
  ok(db.prepare("SELECT COUNT(*) n FROM suppliers WHERE name LIKE '" + MARCA + "%' AND active=1").get().n === 0,
     '  pero fuera de la lista');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] EN LA PANTALLA — la tercera opción está, y se puede elegir');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  page.on('dialog', async d => { errores.push('VENTANITA: ' + d.type()); await d.dismiss(); });
  await page.goto(BASE + '/admin/migracion/importar', { waitUntil: 'networkidle0' });
  await dormir(1500);
  const v = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/Proveedores/.test(v), 'la pantalla del importador ofrece «Proveedores»');
  ok(/Clientes/.test(v) && /Productos/.test(v), '  y no ha perdido las dos que ya había');
  ok(errores.length === 0, 'sin errores de JavaScript ni ventanitas', errores.join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto14-importador.png') });

  // ── EL LINT QUE NACIÓ DE AQUÍ ────────────────────────────────────────────────────────────────
  // Este gate destapó que la pantalla del importador llevaba horas MUERTA: un `await` metido en una
  // función que no era `async` al quitar las ventanitas (punto 7). Un error de sintaxis mata el
  // bloque ENTERO de JavaScript de la pantalla, y ni node --check ni el lint de plantillas lo cazan.
  // Ahora hay un lint que mira el JS TAL Y COMO LLEGA AL NAVEGADOR, y el gate lo exige.
  console.log('\n[6] EL JAVASCRIPT SERVIDO, EN TODAS LAS PANTALLAS');
  let lint = '', lintOk = false;
  try { lint = execFileSync('node', [path.join(RAIZ, 'scripts', 'lint-js-servido.mjs')], { encoding: 'utf8' }); lintOk = true; }
  catch (e) { lint = String(e.stdout || '') + String(e.stderr || ''); }
  ok(lintOk, 'ni un bloque de JavaScript roto en ninguna pantalla', (lint.trim().split('\n').pop() || '').slice(0, 120));

  console.log('\n[7] LO MEDIDO, para el informe');
  let campos = 0, alias = 0;
  for (const k of Object.keys(CAMPOS)) { campos += CAMPOS[k].length; for (const c of CAMPOS[k]) alias += (c.alias || []).length; }
  console.log('  · el importador cubre ' + Object.keys(TIPOS).length + ' tipos, ' + campos + ' campos y ' + alias + ' alias de cabecera.');
  console.log('  · lo que le falta a la ficha K NO es máquina: es un fichero real de Holded o Quipu');
  console.log('    con el que comprobar sus nombres de columna. Sin él, un alias es una apuesta.');

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    db.prepare("DELETE FROM importacion_items WHERE entidad='supplier' AND entidad_id IN (SELECT id FROM suppliers WHERE name LIKE 'GIP-%')").run();
    db.prepare("DELETE FROM importaciones WHERE fichero LIKE 'GIP-%'").run();
    db.prepare("DELETE FROM suppliers WHERE name LIKE 'GIP-%'").run();
    db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run();
  } catch (e) { console.error('  (limpieza incompleta: ' + e.message + ')'); }
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
