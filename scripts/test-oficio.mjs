// Test de LÓGICA — PERFIL DE OFICIO (Escalera · paso 8), sobre BD temporal.
//   node scripts/test-oficio.mjs
//
// Demuestra, sin navegador y sin tocar el tenant de desarrollo:
//   [1] un negocio nuevo de CADA UNO de los 6 oficios arranca con su vocabulario y su catálogo, sin
//       tocar un solo ajuste;
//   [2] 'otro' deja el negocio EXACTAMENTE como estaba (los que ya existen no se rompen);
//   [3] cambiar de oficio NO borra ni pisa servicios ya creados o editados: solo ofrece los que faltan;
//   [4] las palabras salen de UNA sola fuente (ajustesCitas() y vocabulario() no pueden discrepar);
//   [5] un nombre de puesto escrito a mano NO se pisa al cambiar de oficio;
//   [6] sembrar es idempotente (llamarlo dos veces no duplica nada);
//   [7] las duraciones sembradas son las investigadas, al minuto.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createProductSvc } from '../modules/erp/routes/products.js';
import { ajustesCitas } from '../modules/erp/routes/citas.js';
import {
  OFICIOS, OFICIO_IDS, OFICIO_DEFECTO, normalizaOficio, oficioDe, vocabulario,
  fijarOficio, catalogoDe, serviciosQueFaltan, sembrarCatalogo, puestoEsDeFabrica,
} from '../modules/erp/oficios.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'oficio-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  return db;
}
// Un negocio recién provisionado con ese oficio: exactamente lo que hace provisionTenant.
function negocioNuevo(oficio) {
  const db = nuevaBD();
  const fijado = fijarOficio(db, oficio);
  sembrarCatalogo(db, fijado, createProductSvc);
  return db;
}
const servicios = db => db.prepare(
  `SELECT p.name, p.tax_band, sc.duracion_min, sc.reservable, sc.muerto_dur_min, sc.margen_min
     FROM products p JOIN service_config sc ON sc.product_id=p.id
    WHERE p.type='service' ORDER BY p.name`
).all();

try {
  console.log('\n=== 0. el enum y su normalización ===\n');
  ok(OFICIO_IDS.length === 6, 'hay exactamente SEIS oficios (' + OFICIO_IDS.join(', ') + ')');
  ok(OFICIO_DEFECTO === 'otro', "el defecto es 'otro'");
  ok(normalizaOficio('peluqueria') === 'peluqueria', 'un id válido se respeta');
  ok(normalizaOficio('Peluquería de barrio, la de toda la vida') === 'otro', 'texto libre NO se adivina → otro');
  ok(normalizaOficio('') === 'otro' && normalizaOficio(null) === 'otro' && normalizaOficio(undefined) === 'otro',
    'paso saltado (vacío/null/undefined) → otro');
  ok(normalizaOficio('SALUD') === 'salud', 'no distingue mayúsculas');
  ok(normalizaOficio('fontaneria') === 'otro', 'un oficio que no está en la lista → otro (nunca revienta)');

  console.log('\n=== 1. un negocio nuevo de CADA oficio arranca solo (encargo, prueba 1) ===\n');
  for (const of of OFICIOS) {
    const db = negocioNuevo(of.id);
    const voz = vocabulario(db);
    const svc = servicios(db);
    ok(voz.oficio === of.id, of.label + ': el oficio queda guardado');
    ok(voz.cliente_sing === of.cliente_sing,
      of.label + ': dice «' + of.cliente_sing + '» sin tocar un ajuste');
    ok(voz.puesto_sing === of.puesto_sing && voz.puesto_plural === of.puesto_plural,
      of.label + ': los puestos se llaman «' + of.puesto_plural + '»');
    ok(svc.length === of.servicios.length,
      of.label + ': arranca con ' + of.servicios.length + ' servicios (encontrados ' + svc.length + ')');
    ok(svc.every(s => s.reservable === 1),
      of.label + ': todos nacen reservables (se puede pedir cita el primer día)');
    ok(serviciosQueFaltan(db, of.id).length === 0,
      of.label + ': tras sembrar no falta ninguno');
  }

  console.log('\n=== 2. «paciente» solo en salud; el resto sigue diciendo «cliente» ===\n');
  {
    const salud = vocabulario(negocioNuevo('salud'));
    ok(salud.cliente_sing === 'Paciente' && salud.cliente_plural === 'Pacientes', 'salud dice Paciente/Pacientes');
    for (const id of OFICIO_IDS.filter(x => x !== 'salud')) {
      ok(vocabulario(negocioNuevo(id)).cliente_sing === 'Cliente', id + ' dice Cliente');
    }
  }

  console.log('\n=== 3. «otro»: el negocio que YA existe no cambia nada (encargo, «no se rompen») ===\n');
  {
    // Un tenant recién migrado, SIN pasar por fijarOficio: es el estado de los negocios de antes.
    const db = nuevaBD();
    const voz = vocabulario(db);
    ok(oficioDe(db) === 'otro', 'la columna nace en «otro» por defecto');
    ok(voz.puesto_sing === 'Puesto' && voz.puesto_plural === 'Puestos',
      'sigue diciendo «Puesto/Puestos», que es LITERALMENTE lo que veía ayer');
    ok(voz.cliente_sing === 'Cliente', 'sigue diciendo «Cliente»');
    ok(servicios(db).length === 0, 'no se le siembra ni un servicio');
    ok(catalogoDe('otro').length === 0, '«Otro» no trae catálogo: no se inventa a qué se dedica');
  }

  console.log('\n=== 4. las palabras salen de UNA sola fuente ===\n');
  for (const id of OFICIO_IDS) {
    const db = negocioNuevo(id);
    const aj = ajustesCitas(db), voz = vocabulario(db);
    ok(aj.puesto_sing === voz.puesto_sing && aj.puesto_plural === voz.puesto_plural
      && aj.cliente_sing === voz.cliente_sing && aj.cliente_plural === voz.cliente_plural,
      id + ': ajustesCitas() (pantallas) y vocabulario() (menú) dicen lo MISMO');
  }

  console.log('\n=== 5. cambiar de oficio NO borra ni pisa lo que ya hay (encargo, «qué no se toca») ===\n');
  {
    const db = negocioNuevo('peluqueria');
    // El negocio EDITA uno de los sembrados y CREA uno propio.
    const corte = db.prepare("SELECT p.id FROM products p WHERE p.name='Corte caballero'").get();
    db.prepare('UPDATE products SET price=25 WHERE id=?').run(corte.id);
    db.prepare('UPDATE service_config SET duracion_min=40 WHERE product_id=?').run(corte.id);
    const propio = createProductSvc(db, { name: 'Ritual de la casa', sku: 'ritual', price: 55, tax_band: 'general', type: 'service', status: 'active', stock: 0, tags: [] });
    db.prepare('INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min) VALUES (?,1,90,0,0,0)').run(propio.id);
    const antes = servicios(db).length;

    fijarOficio(db, 'salud');   // se cambia de oficio
    const despues = servicios(db);
    ok(despues.length === antes, 'cambiar de oficio no borra NI UN servicio (' + antes + ' antes, ' + despues.length + ' después)');
    const corteAhora = db.prepare('SELECT p.price, sc.duracion_min FROM products p JOIN service_config sc ON sc.product_id=p.id WHERE p.id=?').get(corte.id);
    ok(corteAhora.price === 25 && corteAhora.duracion_min === 40, 'el servicio que el negocio EDITÓ conserva su precio y su duración');
    ok(despues.some(s => s.name === 'Ritual de la casa'), 'el servicio que el negocio CREÓ sigue ahí');
    ok(vocabulario(db).cliente_sing === 'Paciente', 'las palabras SÍ cambian al oficio nuevo');

    // Y solo OFRECE los que faltan.
    const faltan = serviciosQueFaltan(db, 'salud');
    ok(faltan.length === catalogoDe('salud').length, 'ofrece añadir los ' + faltan.length + ' de salud que no tiene');
    sembrarCatalogo(db, 'salud', createProductSvc);
    const tras = servicios(db);
    ok(tras.length === antes + catalogoDe('salud').length, 'al añadirlos, se SUMAN a los que ya había');
    ok(tras.some(s => s.name === 'Corte caballero') && tras.some(s => s.name === 'Ritual de la casa'),
      'los de peluquería y el propio SIGUEN existiendo tras sembrar salud');
  }

  console.log('\n=== 6. un nombre de puesto escrito a mano NO se pisa ===\n');
  {
    const db = negocioNuevo('salud');
    ok(vocabulario(db).puesto_plural === 'Salas', 'salud arranca en «Salas»');
    db.prepare("UPDATE company_config SET cita_puesto_sing='Camilla', cita_puesto_plural='Camillas' WHERE id=1").run();
    ok(!puestoEsDeFabrica('Camilla', 'Camillas'), '«Camillas» se reconoce como escrito a mano');
    fijarOficio(db, 'taller');
    ok(vocabulario(db).puesto_plural === 'Camillas', 'tras cambiar de oficio SIGUE diciendo «Camillas» (no se pisa)');
    ok(vocabulario(db).oficio === 'taller', '…pero el oficio sí cambió');

    // Y al revés: si nadie lo tocó, las palabras siguen al oficio.
    const db2 = negocioNuevo('salud');
    fijarOficio(db2, 'taller');
    ok(vocabulario(db2).puesto_plural === 'Boxes', 'si nadie lo tocó, las palabras SIGUEN al oficio nuevo');
  }

  console.log('\n=== 7. sembrar es idempotente ===\n');
  {
    const db = negocioNuevo('taller');
    const n1 = servicios(db).length;
    const creados = sembrarCatalogo(db, 'taller', createProductSvc);
    ok(creados.length === 0, 'la segunda siembra no crea nada');
    ok(servicios(db).length === n1, 'el catálogo no crece (' + n1 + ' servicios)');
    // Y si el negocio RENOMBRA uno, ese hueco sí se puede rellenar — sin tocar el renombrado.
    const id = db.prepare("SELECT id FROM products WHERE name='Revisión pre-ITV'").get().id;
    db.prepare("UPDATE products SET name='Revisión antes de la ITV' WHERE id=?").run(id);
    ok(serviciosQueFaltan(db, 'taller').length === 1, 'al renombrar uno, vuelve a aparecer como «falta»');
    sembrarCatalogo(db, 'taller', createProductSvc);
    ok(db.prepare("SELECT 1 FROM products WHERE name='Revisión antes de la ITV'").get() != null,
      'el renombrado por el negocio sigue intacto');
    ok(db.prepare("SELECT 1 FROM products WHERE name='Revisión pre-ITV'").get() != null,
      'y el de fábrica se añade al lado, sin pisarlo');
  }

  console.log('\n=== 8. las duraciones sembradas son las investigadas, al minuto ===\n');
  for (const of of OFICIOS.filter(o => o.servicios.length)) {
    const db = negocioNuevo(of.id);
    const filas = servicios(db);
    const malas = of.servicios.filter(s => {
      const f = filas.find(x => x.name === s.nombre);
      return !f || f.duracion_min !== s.duracion_min;
    });
    ok(malas.length === 0, of.label + ': las ' + of.servicios.length + ' duraciones coinciden con el catálogo');
    // El reparto interno (espera/margen) nace a 0 a propósito: las fuentes publican el TOTAL.
    ok(filas.every(f => f.muerto_dur_min === 0 && f.margen_min === 0),
      of.label + ': tiempo de espera y margen nacen a 0 (no se inventa el reparto interno)');
  }
  {
    // ⚙️ CORREGIDO EL 24 AGO 2026, por Ibrahin, y la corrección importa. Esto exigía que TODOS los
    // servicios de salud nacieran exentos, y eso es falso: la exención del art. 20.Uno.3º LIVA pide
    // DOS cosas a la vez —profesional sanitario titulado Y finalidad terapéutica—. El MISMO
    // fisioterapeuta factura sin IVA una rehabilitación y al 21 % un masaje relajante, un tratamiento
    // estético, pilates o un informe para una aseguradora.
    // **Un fisio que emitiera todo exento tendría un problema con Hacienda, y se lo habríamos dado
    // nosotros.** Así que lo que se exige no es «todo exento», es que CADA SERVICIO lleve su marca y
    // que el catálogo precargado traiga marcado lo obvio.
    const db = negocioNuevo('salud');
    const svc = servicios(db);
    ok(svc.every(s => s.tax_band === 'exento' || s.tax_band === 'general'),
      'salud: TODOS los servicios nacen con su banda de IVA declarada (ninguno sin marcar)',
      svc.filter(s => !['exento', 'general'].includes(s.tax_band)).map(s => s.name).join(', ') || svc.length + ' servicios');
    const SANITARIOS = /fisioterapia|psicolog|nutrici|osteopat|quiropodia|logopedia|suelo pélvico|consulta y valoración|terapia de pareja/i;
    const BIENESTAR  = /bienestar|no terapéutico|entrenamiento personal|estétic|pilates|relajante/i;
    const malSanitarios = svc.filter(s => SANITARIOS.test(s.name) && s.tax_band !== 'exento');
    ok(malSanitarios.length === 0,
      '  lo sanitario y terapéutico nace EXENTO (art. 20.Uno.3º LIVA)',
      malSanitarios.map(s => s.name).join(', ') || svc.filter(s => s.tax_band === 'exento').length + ' exentos');
    const malBienestar = svc.filter(s => BIENESTAR.test(s.name) && s.tax_band !== 'general');
    ok(malBienestar.length === 0,
      '  y lo de BIENESTAR nace al tipo GENERAL: no es asistencia sanitaria aunque lo dé un sanitario',
      malBienestar.map(s => s.name).join(', ') || svc.filter(s => s.tax_band === 'general').map(s => s.name).join(' · '));
    ok(servicios(negocioNuevo('taller')).every(s => s.tax_band === 'general'),
      'taller nace al tipo general');
  }

  console.log('\n=== 9. el oficio no toca NADA del motor ni de las tablas de citas ===\n');
  {
    const db = negocioNuevo('estetica');
    ok(db.prepare("SELECT COUNT(*) n FROM citas").get().n === 0, 'no crea ni una cita');
    ok(db.prepare("SELECT COUNT(*) n FROM recursos").get().n === 0, 'no crea ni un puesto (solo cambia cómo se llaman)');
    ok(db.prepare("SELECT COUNT(*) n FROM horario_tramos").get().n === 0, 'no toca los horarios');
    const cols = db.prepare('PRAGMA table_info(citas)').all().map(c => c.name);
    ok(!cols.includes('oficio'), 'la tabla `citas` no gana ni una columna');
    // El interruptor de la puerta pública sigue APAGADO: el oficio no publica nada por sorpresa.
    ok(db.prepare('SELECT cita_pub_activa a FROM company_config WHERE id=1').get().a === 0,
      'la puerta pública sigue apagada (el oficio no enciende funciones)');
  }
} catch (e) {
  fail++; console.error('\n  ✗ EXCEPCIÓN: ' + (e && e.stack || e));
} finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} for (const s of ['', '-wal', '-shm']) { try { unlinkSync(f + s); } catch {} } }
}

console.log('\n──────────────────────────────');
console.log('  ' + pass + ' OK · ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
