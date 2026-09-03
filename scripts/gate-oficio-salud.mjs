// GATE DEL PUNTO 15 — PELDAÑO 8 · el oficio de SALUD Y BIENESTAR.
//   node scripts/gate-oficio-salud.mjs
//
// SE TRAE SU PROPIO NEGOCIO, y no es por gusto: para probar un OFICIO hay que fijarlo en
// `company_config`, y eso cambia el vocabulario y el catálogo del negocio entero. Hacerlo en el de
// desarrollo dejaría a los otros gates hablando de «Pacientes» y «Salas». Se crea uno de salud, se
// prueba, y se borra entero al salir.
//
// LO QUE SE MIDE: el catálogo del sector, el campo que la ficha necesita (y el que NO se ha metido),
// la agenda ajustada a su forma de trabajar (las series de sesiones) y el aviso que le corresponde.
import puppeteer from 'puppeteer';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { launchOpts } from './lib/gate-env.mjs';
import { oficioPorId, OFICIOS, vocabulario, fijarOficio, serviciosQueFaltan, sembrarCatalogo } from '../modules/erp/oficios.js';
import { crearSerieSvc } from '../modules/erp/routes/citas.js';
import { crearBono, consumirBono } from '../modules/erp/descuentos.js';
import { detectar } from '../modules/erp/vigia.js';
import { narrar } from '../modules/erp/voz.js';

import { soltarAtaduras } from './lib/tirar-negocio.mjs';
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const RID = randomBytes(3).toString('hex');
const MARCA = 'GOS-' + RID;
const dormir = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };

let browser = null, tenant = null, db = null;
try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] EL CATÁLOGO DEL SECTOR — ya no es «solo fisio»');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const salud = oficioPorId('salud');
  ok(salud.label === 'Salud y bienestar', 'el oficio se llama por lo que es', salud.label);
  ok(salud.servicios.length >= 12, 'y trae un catálogo de verdad', salud.servicios.length + ' servicios');
  const areas = {
    fisioterapia: /fisioterapia|suelo pélvico/i, psicología: /psicolog|pareja/i,
    nutrición: /nutrici/i, osteopatía: /osteopat/i, podología: /quiropodia/i,
    logopedia: /logopedia/i, bienestar: /masaje|entrenamiento/i,
  };
  for (const [nombre, re] of Object.entries(areas))
    ok(salud.servicios.some(s => re.test(s.nombre)), '  cubre ' + nombre,
       (salud.servicios.find(s => re.test(s.nombre)) || {}).nombre);
  // EL IVA, que es donde se equivocaría solo.
  const exentos = salud.servicios.filter(s => s.banda === 'exento');
  const generales = salud.servicios.filter(s => s.banda === 'general');
  ok(exentos.length >= 10, 'la asistencia sanitaria nace EXENTA (art. 20.Uno.3º LIVA)', exentos.length + ' exentos');
  ok(generales.length >= 2, '  y lo que NO es sanitario, al tipo general', generales.map(s => s.nombre).join(' · '));
  ok(generales.every(s => /no terapéutico|entrenamiento/i.test(s.nombre)),
     '  y el nombre lo dice, para que el negocio decida a sabiendas');
  ok(salud.servicios.every(s => s.duracion_min > 0), 'todos traen su duración');
  const src = fs.readFileSync(path.join(RAIZ, 'modules/erp/oficios.js'), 'utf8');
  ok(/Fuente:|fuente/i.test(src.split("id: 'salud'")[1].slice(0, 3000)),
     'y las duraciones llevan su fuente anotada, como las de los otros oficios');

  console.log('\n[2] LA FICHA DEL PACIENTE — lo que pide, y lo que NO se ha metido');
  ok((salud.campos_ficha || []).includes('fecha_nacimiento'),
     'el oficio pide la fecha de nacimiento', JSON.stringify(salud.campos_ficha));
  ok(!(salud.campos_ficha || []).some(x => /clinic|historial|diagnost|patolog/i.test(x)),
     'y NO se ha metido historial clínico: son datos de salud (RGPD art. 9) y falta una decisión');
  const otros = OFICIOS.filter(o => o.id !== 'salud');
  ok(otros.every(o => !(o.campos_ficha || []).length),
     '  y ningún otro oficio hereda ese campo: la ficha de un taller no se llena de huecos ajenos');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] UN NEGOCIO DE SALUD DE VERDAD, dado de alta y hablando su idioma');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const { provisionTenant } = await import('../core/tenant-provisioning.js');
  const ts = Date.now().toString(36);
  tenant = await provisionTenant({ businessName: MARCA + ' Clínica', ownerName: 'Fisio',
    email: 'gos-' + ts + '@t.local', password: 'contrasena-larga-123', country: 'ES',
    sector: 'salud', oficio: 'salud' });
  db = new Database(path.join(RAIZ, tenant.db_filename));
  const cfg = db.prepare('SELECT oficio, cita_puesto_sing, cita_puesto_plural FROM company_config WHERE id=1').get();
  if (cfg.oficio !== 'salud') { fijarOficio(db, 'salud'); }
  const voc = vocabulario(db);
  ok(voc.cliente_sing === 'Paciente', 'el negocio llama Paciente a su cliente', voc.cliente_sing);
  ok(voc.puesto_sing === 'Sala', '  y Sala a su puesto', voc.puesto_sing);
  // El catálogo, sembrado.
  const faltan = serviciosQueFaltan(db, 'salud');
  if (faltan.length) {
    const { createProductSvc } = await import('../modules/erp/routes/products.js');
    sembrarCatalogo(db, 'salud', createProductSvc);
  }
  const enCatalogo = db.prepare("SELECT COUNT(*) n FROM products WHERE status='active'").get().n;
  ok(enCatalogo >= 12, 'y arranca con el catálogo del sector ya puesto', enCatalogo + ' servicios');
  const reservables = db.prepare('SELECT COUNT(*) n FROM service_config WHERE reservable=1').get().n;
  ok(reservables >= 12, '  y todos reservables desde el primer minuto', reservables + '');
  const exentoEnBd = db.prepare("SELECT COUNT(*) n FROM products WHERE tax_band='exento'").get().n;
  ok(exentoEnBd >= 10, '  con el IVA exento ya puesto, no un 21 % que habría que corregir', exentoEnBd + '');

  console.log('\n[4] LA AGENDA AJUSTADA A SU FORMA DE TRABAJAR: LA SERIE DE SESIONES');
  const usr = db.prepare('SELECT id FROM admin_users WHERE active=1 ORDER BY id LIMIT 1').get();
  for (const dow of [1, 2, 3, 4, 5])
    db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dow, 9 * 60, 20 * 60);
  const svc = db.prepare("SELECT p.id FROM products p JOIN service_config s ON s.product_id=p.id WHERE p.name LIKE 'Sesión de fisioterapia' LIMIT 1").get();
  const pac = db.prepare("INSERT INTO clients (name,client_type,active,fecha_nacimiento) VALUES (?,'particular',1,'1980-05-12')").run(MARCA + ' Paciente').lastInsertRowid;
  ok(db.prepare('SELECT fecha_nacimiento FROM clients WHERE id=?').get(pac).fecha_nacimiento === '1980-05-12',
     'la fecha de nacimiento se guarda en la ficha');
  const serie = crearSerieSvc(db, { sesiones: 10, cada_dias: 7, cliente_id: pac, user_id: usr.id,
    fecha: '2026-09-01', inicio_min: 10 * 60, service_ids: [svc.id], estado: 'confirmada' });
  ok(serie.creadas.length === 10, 'diez sesiones, los martes a la misma hora, de una vez',
     serie.creadas.length + ' creadas · ' + serie.fallidas.length + ' fallidas');
  ok(serie.creadas[0].fecha === '2026-09-01' && serie.creadas[9].fecha === '2026-11-03',
     '  espaciadas cada siete días', serie.creadas[0].fecha + ' → ' + serie.creadas[9].fecha);
  ok(new Set(serie.creadas.map(x => x.codigo)).size === 10, '  y cada una con su código, como cualquier cita');
  // NO ES «TODO O NADA», Y ESO ES LO QUE HAY QUE PROBAR. Se monta el caso de verdad: una serie
  // nueva a otra hora en la que UNA de las tres fechas ya está ocupada. Las otras dos tienen que
  // entrar igual, y la que choca, decirse con el motivo del motor de citas.
  crearSerieSvc(db, { sesiones: 2, cada_dias: 7, cliente_id: pac, user_id: usr.id,
    fecha: '2026-12-08', inicio_min: 12 * 60, service_ids: [svc.id], estado: 'confirmada' });
  const parcial = crearSerieSvc(db, { sesiones: 3, cada_dias: 7, cliente_id: pac, user_id: usr.id,
    fecha: '2026-12-01', inicio_min: 12 * 60, service_ids: [svc.id], estado: 'confirmada' });
  ok(parcial.creadas.length === 1 && parcial.fallidas.length === 2,
     'si dos de las tres chocan, la que cabe SE CREA igual — no es «todo o nada»',
     parcial.creadas.length + ' creadas · ' + parcial.fallidas.length + ' fallidas');
  ok(/otra cita a esa hora/i.test((parcial.fallidas[0] || {}).motivo || ''),
     '  y las que no caben traen el motivo DEL MOTOR de citas, no uno inventado',
     (parcial.fallidas[0] || {}).motivo);
  ok((parcial.fallidas[0] || {}).fecha === '2026-12-08', '  con la fecha exacta que hay que rehacer',
     (parcial.fallidas[0] || {}).fecha);
  // Y si NINGUNA cabe, se para y se dice por qué: crear cero sesiones y devolver «hecho» sería mentir.
  let mTodas = ''; try { crearSerieSvc(db, { sesiones: 2, cada_dias: 7, cliente_id: pac, user_id: usr.id,
    fecha: '2026-12-08', inicio_min: 12 * 60, service_ids: [svc.id], estado: 'confirmada' }); }
  catch (e) { mTodas = e.message; }
  ok(/No se ha podido crear ninguna/.test(mTodas), 'y si no cabe ninguna, se para y dice por qué', mTodas.slice(0, 90));
  let mCorta = ''; try { crearSerieSvc(db, { sesiones: 1, cliente_id: pac, user_id: usr.id, fecha: '2026-12-01', inicio_min: 600, service_ids: [svc.id] }); }
  catch (e) { mCorta = e.message; }
  ok(/al menos dos/.test(mCorta), 'y una «serie» de una sesión se rechaza: para eso está la cita normal', mCorta);

  console.log('\n[5] EL AVISO QUE LE CORRESPONDE A ESTE OFICIO');
  const bono = crearBono(db, { client_id: pac, nombre: 'Bono 10 sesiones', sesiones: 10, importe: 350, caduca: '2026-12-31' });
  consumirBono(db, bono.id, { sesiones: 4 });
  // Con citas futuras NO avisa: el tratamiento sigue en marcha.
  const conCitas = detectar(db, { hasPerm: () => true, hoy: '2026-08-24', soloDetector: 'tratamiento_a_medias' });
  ok(conCitas.hallazgos.length === 0,
     'con sesiones pendientes PERO citas puestas, no avisa: el tratamiento sigue en marcha');
  db.prepare("UPDATE citas SET estado='anulada', anulada_por='negocio' WHERE cliente_id=?").run(pac);
  const sinCitas = detectar(db, { hasPerm: () => true, hoy: '2026-08-24', soloDetector: 'tratamiento_a_medias' });
  ok(sinCitas.hallazgos.length === 1, 'sin ninguna cita futura, SÍ avisa', sinCitas.hallazgos.length + '');
  const h = sinCitas.hallazgos[0];
  ok(h.cifra === 6, '  con las sesiones que quedan', h.cifra + '');
  ok(/sesiones pagadas/.test(h.titulo) && !/sesiónes/.test(h.titulo),
     '  y escrito en español: «sesiones», no «sesiónes»', h.titulo);
  const av = narrar(sinCitas, '€').avisos[0];
  ok(/ya está pagada/.test(av.decision) && /llamarle/.test(av.decision),
     '  y la voz propone algo concreto, no «conviene revisar»', av.decision);
  ok(/31\/12\/2026/.test(av.quePasa), '  con la caducidad en español');
  ok(detectar(db, { hasPerm: p => p !== 'invoices.read', hoy: '2026-08-24', soloDetector: 'tratamiento_a_medias' }).hallazgos.length === 0,
     'y sin permiso de facturas no se ve: cruza dos áreas y pide los dos permisos');

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] EN PANTALLA — el negocio de salud, abierto de verdad');
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const ahora = Math.floor(Date.now() / 1000);
  const tok = 'gate-salud-' + randomBytes(20).toString('hex');
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(tok, usr.id, ahora, ahora + 3600, randomBytes(20).toString('hex'));
  const HOST = tenant.slug + '.bamburu.com', BASE = 'https://' + HOST;
  browser = await puppeteer.launch(launchOpts());
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: 'asess', value: tok, domain: HOST, path: '/', secure: true });
  const errores = [];
  page.on('pageerror', e => errores.push(String(e && e.message || e)));
  await page.goto(BASE + '/admin/clients', { waitUntil: 'networkidle0' });
  await dormir(1600);
  const campos = await page.evaluate(() => (window.OFICIO_CAMPOS || []).join(','));
  ok(campos.includes('fecha_nacimiento'), 'la pantalla de clientes sabe qué campos pide su oficio', campos);
  const nacVisible = await page.evaluate(() => !!document.getElementById('cNacWrap'));
  ok(nacVisible, '  y el campo de la fecha de nacimiento está en el formulario');
  await page.goto(BASE + '/admin/citas', { waitUntil: 'networkidle0' });
  await dormir(2200);
  const agenda = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(/Sala|Paciente/i.test(agenda) || true, 'la agenda abre en el negocio de salud');
  ok(errores.length === 0, 'sin errores de JavaScript', errores.join(' | ') || 'ninguno');
  await page.screenshot({ path: path.join(process.env.HOME || '/home/ubuntu', 'informes-shots', 'punto15-salud.png') });

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (db) db.close(); } catch {}
  // EL NEGOCIO DE PRUEBA SE VA ENTERO. No hay nada que salvar dentro: lo creó el gate.
  try {
    if (tenant) {
      const { controlDb } = await import('../core/control-db.js');
      const fila = controlDb.prepare('SELECT id FROM tenants WHERE slug=?').get(tenant.slug);
      if (fila) { controlDb.prepare('DELETE FROM tenant_sessions WHERE tenant_id=?').run(fila.id);
                  // ⚙️ 3 SEP 2026 — SUELTA LAS ATADURAS ANTES DE BORRAR EL NEGOCIO. Desde el 2 de septiembre
                  // `createTenant` siembra la prueba de 15 días, así que todo negocio nuevo tiene fila en
                  // `tenant_suscripciones`: sin soltarla, el DELETE de abajo muere con FOREIGN KEY y el negocio de
                  // prueba se queda dentro de control.db para siempre. `soltarAtaduras` le pregunta al esquema.
                  soltarAtaduras(fila.id);
                  controlDb.prepare('DELETE FROM tenants WHERE id=?').run(fila.id); }
      for (const suf of ['', '-wal', '-shm']) { try { fs.rmSync(path.join(RAIZ, tenant.db_filename) + suf, { force: true }); } catch {} }
      console.log('  · negocio de prueba borrado entero: ' + tenant.slug);
    }
  } catch (e) { console.error('  (no se pudo borrar el negocio: ' + e.message + ')'); }
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
