// Test de LÓGICA — PUERTA PÚBLICA DE RESERVA (Escalera · paso 7 · PIEZA 6), sobre BD temporal.
//   node scripts/test-reserva-publica.mjs
//
// Demuestra, SIN SESIÓN y sin servidor: la puerta nace APAGADA; el handle equivocado da el mismo 404;
// reserva completa de punta a punta; hueco pisado → 409 con huecos cercanos; antelación mínima y
// máxima respetadas EN SERVIDOR (aunque el navegador mande lo que quiera); servicio no público → 404;
// persona no pública no aparece ni se puede pedir; el nombre que sale es el del DUEÑO, nunca el del
// usuario del sistema; modo "yo apruebo" RETIENE el hueco y CADUCA solo; cancelar dentro y fuera de la
// ventana; un cliente que ya existe se ENLAZA y no se duplica (ni se crea ficha nueva); sin
// consentimiento no se reserva; el campo trampa no crea nada.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { dowDeFecha, hhmm } from '../modules/erp/citas-engine.js';
import {
  serviciosPublicos, huecosPublicos, crearReservaPublica, cambiarReservaPublica,
  anularReservaPublica, aprobarReserva, rechazarReserva, caducarReservasPendientes,
  resolverClientePublico, politicaHuecos,
} from '../modules/erp/reserva-publica.js';
import {
  ajustesPublicos, handleEfectivo, slugHandle, exigirPuerta, personasPublicas,
  ventanaCliente, reservaDeCita, textoConsentimiento, reservasPublicasPendientes, PUERTA_CERRADA,
} from '../modules/erp/reserva-publica-config.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
// Tarea 2 · cabo 4: quién anuló. Los tres caminos que NO pasan por la pantalla del negocio se
// rellenan solos, y cada uno con su autor: el cliente por su enlace, el negocio al rechazar, y el
// reloj cuando la solicitud caduca sin que nadie conteste.
const quienAnulo = (db, id) => db.prepare('SELECT anulada_por FROM citas WHERE id=?').get(id).anulada_por;
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'reserva-pub-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  return db;
}
// Captura el error de una llamada que debe fallar, para poder mirar su .status y su .huecos.
function cae(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

const usuario = (db, name) =>
  db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run(name, name.replace(/\s/g, '') + '@t.local', 'x').lastInsertRowid;

// Un servicio del CATÁLOGO (products) + su capa de reserva (service_config). Precio e IVA del catálogo.
function servicio(db, { nombre, precio = 20, dur = 60, margen = 0, espera = 0, esperaIni = 0, publico = 1, reservable = 1 }) {
  const pid = db.prepare(
    "INSERT INTO products (name,sku,price,tax_band,type,status,stock) VALUES (?,?,?,'general','service','active',0)"
  ).run(nombre, slugHandle(nombre), precio).lastInsertRowid;
  db.prepare(
    'INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min,publico) VALUES (?,?,?,?,?,?,?)'
  ).run(pid, reservable, dur, esperaIni, espera, margen, publico);
  return pid;
}
const verVisible = (db, uid, nombrePublico) =>
  db.prepare('INSERT INTO cita_pub_personas (user_id,visible,nombre_publico) VALUES (?,1,?)').run(uid, nombrePublico || '');

// Horario de negocio L-V 9:00-14:00 (sin descanso, para que las cuentas sean fáciles de leer).
function horarioLV(db) {
  for (let dow = 1; dow <= 5; dow++) {
    db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)")
      .run(dow, 9 * 60, 14 * 60);
  }
}
function abrirPuerta(db, extra = {}) {
  const d = { activa: 1, handle: 'lola', antel: 120, ventana: 60, modo: 'auto', ret: 24, cancH: 24, cancAct: 1, politica: 'Avísanos con 24 h.', ...extra };
  db.prepare(
    `UPDATE company_config SET company_name='Peluquería Lola', cita_pub_activa=?, cita_pub_handle=?,
       cita_pub_antelacion_min=?, cita_pub_ventana_dias=?, cita_pub_modo=?, cita_pub_retencion_horas=?,
       cita_pub_cancelar_horas=?, cita_pub_cancelar_activo=?, cita_pub_politica=? WHERE id=1`
  ).run(d.activa, d.handle, d.antel, d.ventana, d.modo, d.ret, d.cancH, d.cancAct, d.politica);
}
// Un lunes futuro (lejos de hoy, para no chocar con la antelación ni con la ventana).
function proximoLunes(desdeDias = 7) {
  const base = Date.now() + desdeDias * 86400000;
  for (let i = 0; i < 14; i++) {
    const f = new Date(base + i * 86400000).toISOString().slice(0, 10);
    if (dowDeFecha(f) === 1) return f;
  }
  return new Date(base).toISOString().slice(0, 10);
}
const AHORA = (fecha, min) => ({ fecha, min, dow: dowDeFecha(fecha) });

try {
  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 0. LA PUERTA NACE APAGADA (y el 404 no es un oráculo) ===\n');
  {
    const db = nuevaBD();
    const aj = ajustesPublicos(db);
    ok(aj.activa === false, 'cita_pub_activa nace en 0: nada es público hasta que el dueño lo enciende');
    ok(aj.antelacion_min === 120, 'antelación mínima por defecto = 120 min (2 h), como pide el encargo');
    ok(aj.ventana_dias === 60, 'antelación máxima por defecto = 60 días');
    ok(aj.modo === 'auto', 'modo por defecto = confirmación automática');
    ok(aj.cancelar_horas === 24 && aj.cancelar_activo === true, 'ventana de cambio/anulación por defecto = 24 h, activa');

    const e = cae(() => exigirPuerta(db, 'lo-que-sea'));
    ok(e && e.status === 404, 'con la puerta apagada, cualquier handle → 404');

    // El handle se genera del nombre del negocio si el dueño no pone ninguno.
    db.prepare("UPDATE company_config SET company_name='Peluquería Lolá & Co' WHERE id=1").run();
    ok(handleEfectivo(db) === 'peluqueria-lola-co', 'sin handle, se genera del nombre del negocio: ' + handleEfectivo(db));
    db.prepare("UPDATE company_config SET cita_pub_handle='mi-sitio' WHERE id=1").run();
    ok(handleEfectivo(db) === 'mi-sitio', 'con handle puesto, manda el del dueño');
    ok(slugHandle('  Á Ñ o!! 2026  ') === 'a-n-o-2026', 'slugHandle limpia acentos, símbolos y guiones sobrantes');

    abrirPuerta(db, { handle: 'lola' });
    const e2 = cae(() => exigirPuerta(db, 'otro-negocio'));
    ok(e2 && e2.status === 404 && e2.message === PUERTA_CERRADA,
       'puerta abierta pero handle equivocado → MISMO 404 y MISMO texto que la puerta apagada (no es un oráculo)');
    ok(exigirPuerta(db, 'lola').activa === true, 'handle correcto → pasa');
    ok(exigirPuerta(db, 'LOLA').activa === true, 'el handle no distingue mayúsculas (se normaliza)');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 1. SOLO SALE LO MARCADO (servicios, personas, y el nombre del DUEÑO) ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'), luis = usuario(db, 'Luis Sistema');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const privado = servicio(db, { nombre: 'Tratamiento interno', precio: 90, dur: 60, publico: 0 });
    const sinTiempo = servicio(db, { nombre: 'Solo dentro', precio: 10, dur: 30, publico: 1, reservable: 0 });

    const pubs = serviciosPublicos(db);
    ok(pubs.length === 1 && pubs[0].id === corte, 'serviciosPublicos devuelve SOLO el marcado público y reservable (1 de 3)');
    ok(!JSON.stringify(pubs).includes('Tratamiento interno'), 'el servicio no público NO aparece por ningún lado');
    ok(!JSON.stringify(pubs).includes('Solo dentro'), 'un servicio "publico" pero NO reservable tampoco sale (hacen falta las dos marcas)');
    ok(pubs[0].precio === 20 && pubs[0].iva_pct === 21 && pubs[0].precio_total === 24.2,
       'precio, IVA y total salen DEL CATÁLOGO, sin recalcular nada: 20 € + 21 % = 24,20 €');

    const fecha = proximoLunes();
    const e = cae(() => huecosPublicos(db, { fecha, service_ids: [privado] }));
    ok(e && e.status === 404, 'pedir huecos de un servicio NO público → 404');
    const e2 = cae(() => huecosPublicos(db, { fecha, service_ids: [corte, privado] }));
    ok(e2 && e2.status === 404, 'colar un servicio no público en una cadena válida → 404 (no se cuela ninguno)');

    ok(personasPublicas(db, [corte]).length === 0, 'por defecto NO aparece NADIE (cita_pub_personas vacía)');
    verVisible(db, ana, 'Ana');
    const pers = personasPublicas(db, [corte]);
    ok(pers.length === 1 && pers[0].id === ana, 'solo aparece quien el dueño marcó visible (Ana sí, Luis no)');
    ok(pers[0].nombre === 'Ana', 'el nombre visible es el que puso el DUEÑO ("Ana"), no el del sistema ("Ana Sistema")');
    ok(!JSON.stringify(pers).includes('Sistema'), 'admin_users.name NO se filtra a la calle');

    verVisible(db, luis, '');   // visible pero sin nombre público
    const pers2 = personasPublicas(db, [corte]);
    ok(pers2.some(p => p.nombre === 'Profesional 2') && !JSON.stringify(pers2).includes('Luis Sistema'),
       'visible SIN nombre público → "Profesional N", nunca el usuario del sistema');

    // Un servicio que declara quién lo presta restringe; sin declarar, "cualquiera".
    const tinte = servicio(db, { nombre: 'Tinte', precio: 40, dur: 60 });
    db.prepare('INSERT INTO service_providers (product_id,user_id) VALUES (?,?)').run(tinte, ana);
    ok(personasPublicas(db, [tinte]).length === 1, 'con service_providers declarado, solo esa persona sale');
    ok(personasPublicas(db, [corte]).length === 2, 'sin service_providers, el servicio no restringe a nadie');
    ok(personasPublicas(db, [corte, tinte]).length === 1,
       'cadena de dos servicios: solo quien puede prestar LOS DOS (una cita tiene una sola persona)');

    const eP = cae(() => huecosPublicos(db, { fecha, service_ids: [corte], user_id: 99999 }));
    ok(eP && eP.status === 404, 'pedir huecos de una persona que no es pública → 404');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. RESERVA COMPLETA, SIN SESIÓN ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const fecha = proximoLunes();
    const ahora = AHORA(proximoLunes(0), 8 * 60);   // muy anterior: la antelación no estorba

    const hs = huecosPublicos(db, { fecha, service_ids: [corte], ahora });
    ok(hs.length === 10 && hs[0].hora === '09:00' && hs[hs.length - 1].hora === '13:30',
       'huecos del día: 9:00→13:30 en rejilla de 30 min, 10 en total (' + hs.length + ')');

    const r = crearReservaPublica(db, {
      service_ids: [corte], user_id: ana, fecha, inicio_min: 10 * 60,
      nombre: 'María García', movil: '600111222', email: 'maria@ej.com',
      consent: true, trampa: '',
    }, { ahora });
    ok(r.id > 0 && /^CITA-\d{4}$/.test(r.codigo), 'la cita se crea con el código de la pieza 5: ' + r.codigo);
    ok(typeof r.token === 'string' && r.token.length >= 40, 'lleva la LLAVE del enlace de la pieza 5 (token de 256 bits)');
    ok(r.aprobacion === 'auto', 'en modo automático, aprobacion = auto');

    const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(r.id);
    ok(cita.estado === 'confirmada', 'en modo automático la cita queda CONFIRMADA');
    ok(cita.user_id === ana && cita.fecha === fecha && cita.inicio_min === 600, 'persona, día y hora son los pedidos');
    ok(cita.dur_min === 30, 'la duración la CONGELA la geometría de la pieza 5 (30 min)');
    ok(cita.cliente_suelto_nombre === 'María García' && cita.cliente_suelto_movil === '+34600111222',
       'cliente nuevo → SUELTO con el móvil normalizado a E.164, igual que en la agenda');
    ok(db.prepare('SELECT COUNT(*) n FROM clients').get().n === 0,
       'la puerta pública NO da de alta fichas de cliente (decisión del dueño)');

    const res = reservaDeCita(db, r.id);
    ok(res != null, 'queda la marca de origen: existe fila en cita_reserva_publica');
    ok(res.email === 'maria@ej.com', 'se guarda el email (el cliente suelto de la pieza 5 no tenía dónde)');
    ok(res.consent_texto === textoConsentimiento('Peluquería Lola'), 'se archiva el TEXTO EXACTO del consentimiento aceptado');
    ok(/^\d{4}-\d{2}-\d{2}/.test(res.consent_at), 'con su fecha y hora: ' + res.consent_at);
    ok(res.politica_texto === 'Avísanos con 24 h.', 'se archiva la política TAL COMO SE MOSTRÓ, no la de hoy');

    // Varios servicios en una cita: el motor los encadena, así que la puerta lo permite.
    const tinte = servicio(db, { nombre: 'Tinte', precio: 40, dur: 60 });
    const r2 = crearReservaPublica(db, {
      service_ids: [corte, tinte], user_id: ana, fecha, inicio_min: 11 * 60,
      nombre: 'Otra', movil: '600999888', consent: true,
    }, { ahora });
    const c2 = db.prepare('SELECT * FROM citas WHERE id=?').get(r2.id);
    ok(c2.dur_min === 90, 'cadena de dos servicios en UNA cita: 30+60 = 90 min (el motor ya lo admitía)');
    ok(db.prepare('SELECT COUNT(*) n FROM cita_servicios WHERE cita_id=?').get(r2.id).n === 2, 'con sus dos líneas de servicio');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. HUECO PISADO → 409 con huecos cercanos ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const fecha = proximoLunes();
    const ahora = AHORA(proximoLunes(0), 8 * 60);
    const base = { service_ids: [corte], user_id: ana, fecha, nombre: 'X', movil: '600111222', consent: true };

    crearReservaPublica(db, { ...base, inicio_min: 10 * 60 }, { ahora });
    const e = cae(() => crearReservaPublica(db, { ...base, inicio_min: 10 * 60, movil: '600222333' }, { ahora }));
    ok(e && e.status === 409, 'reservar el MISMO hueco otra vez → 409');
    ok(Array.isArray(e.huecos) && e.huecos.length > 0, 'el 409 propone huecos CERCANOS, no un error seco: ' + e.huecos.map(h => h.hora).join(', '));
    ok(!e.huecos.some(h => h.min === 10 * 60), 'y el hueco ya pisado no está entre los propuestos');

    const hs = huecosPublicos(db, { fecha, service_ids: [corte], ahora });
    ok(!hs.some(h => h.min === 10 * 60), 'el hueco ocupado desaparece de la lista pública');
    ok(hs.length === 9, 'quedan 9 de los 10 (' + hs.length + ')');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. ANTELACIÓN MÍNIMA Y MÁXIMA — se hacen cumplir EN SERVIDOR ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db, { antel: 120, ventana: 60 }); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const hoy = proximoLunes(0);
    const ahora = AHORA(hoy, 9 * 60);   // hoy, 9:00 → con 2 h de antelación, lo antes posible son las 11:00

    const hs = huecosPublicos(db, { fecha: hoy, service_ids: [corte], ahora });
    ok(hs.length > 0 && hs[0].min === 11 * 60, 'a las 9:00 con 2 h de antelación, el primer hueco de hoy es 11:00 (es ' + (hs[0] && hs[0].hora) + ')');
    ok(!hs.some(h => h.min < 11 * 60), 'ningún hueco de hoy por debajo del mínimo');

    const base = { service_ids: [corte], user_id: ana, nombre: 'X', movil: '600111222', consent: true };
    const e = cae(() => crearReservaPublica(db, { ...base, fecha: hoy, inicio_min: 10 * 60 }, { ahora }));
    ok(e && e.status === 409, 'forzar una hora DENTRO de la antelación mínima (10:00) → 409, aunque el navegador la mande');
    ok(crearReservaPublica(db, { ...base, fecha: hoy, inicio_min: 11 * 60 }, { ahora }).id > 0, 'a las 11:00 (justo el mínimo) sí entra');

    // Ventana máxima: 60 días. El día 61 no existe para la puerta.
    const dentro = new Date(Date.parse(hoy + 'T00:00:00Z') + 59 * 86400000).toISOString().slice(0, 10);
    const fuera = new Date(Date.parse(hoy + 'T00:00:00Z') + 61 * 86400000).toISOString().slice(0, 10);
    ok(huecosPublicos(db, { fecha: fuera, service_ids: [corte], ahora }).length === 0, 'a 61 días (ventana 60) no hay huecos');
    const e2 = cae(() => crearReservaPublica(db, { ...base, fecha: fuera, inicio_min: 10 * 60 }, { ahora }));
    ok(e2 && e2.status === 409, 'forzar una fecha fuera de la ventana máxima → 409');
    // (dentro puede caer en fin de semana; solo se comprueba que la ventana no lo excluye)
    ok(dowDeFecha(dentro) === 0 || dowDeFecha(dentro) === 6 || huecosPublicos(db, { fecha: dentro, service_ids: [corte], ahora }).length > 0,
       'a 59 días (dentro de la ventana) sí hay huecos si es día laborable');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 5. CONSENTIMIENTO OBLIGATORIO Y CAMPO TRAMPA ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const fecha = proximoLunes();
    const ahora = AHORA(proximoLunes(0), 8 * 60);
    const base = { service_ids: [corte], user_id: ana, fecha, inicio_min: 10 * 60, nombre: 'X', movil: '600111222' };
    const citas = () => db.prepare('SELECT COUNT(*) n FROM citas').get().n;

    const e = cae(() => crearReservaPublica(db, { ...base, consent: false }, { ahora }));
    ok(e && e.status === 400, 'sin marcar el consentimiento → 400, NO se reserva');
    ok(citas() === 0, 'y no se ha creado ninguna cita');

    const e2 = cae(() => crearReservaPublica(db, { ...base, consent: true, trampa: 'soy-un-bot' }, { ahora }));
    ok(e2 && e2.status === 400, 'con el campo trampa relleno → 400');
    ok(!/trampa|bot|campo/i.test(e2.message), 'y el mensaje NO le dice al bot qué le delató: «' + e2.message + '»');
    ok(citas() === 0, 'el campo trampa no crea nada');

    const e3 = cae(() => crearReservaPublica(db, { ...base, consent: true, movil: '', email: '' }, { ahora }));
    ok(e3 && e3.status === 400 && citas() === 0, 'sin móvil ni email no se reserva (no habría cómo avisarle)');

    ok(crearReservaPublica(db, { ...base, consent: true }, { ahora }).id > 0 && citas() === 1, 'con consentimiento y trampa vacía, entra');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 6. EL CLIENTE QUE YA EXISTE SE ENLAZA, NO SE DUPLICA ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const fecha = proximoLunes();
    const ahora = AHORA(proximoLunes(0), 8 * 60);

    const cliTel = db.prepare("INSERT INTO clients (name,email,movil_e164,active,client_code) VALUES (?,?,?,1,'CLI-0001')")
      .run('María García', 'maria@ej.com', '+34600111222').lastInsertRowid;
    const cliMail = db.prepare("INSERT INTO clients (name,email,movil_e164,active,client_code) VALUES (?,?,?,1,'CLI-0002')")
      .run('Pedro Ruiz', 'Pedro@Ej.com', '').lastInsertRowid;
    const antes = db.prepare('SELECT COUNT(*) n FROM clients').get().n;

    // Por MÓVIL, escrito en nacional (se normaliza a +34… antes de buscar).
    ok(resolverClientePublico(db, { movil: '600 111 222' }).cliente_id === cliTel, 'resolverClientePublico enlaza por móvil NORMALIZADO');
    ok(resolverClientePublico(db, { email: 'PEDRO@ej.COM' }).cliente_id === cliMail, 'y por email, sin distinguir mayúsculas');
    ok(resolverClientePublico(db, { movil: '699000000', email: 'nadie@ej.com' }).cliente_id === null, 'y devuelve null si no hay nadie');

    const r = crearReservaPublica(db, {
      service_ids: [corte], user_id: ana, fecha, inicio_min: 10 * 60,
      nombre: 'María G.', movil: '600-111-222', consent: true,
    }, { ahora });
    const c1 = db.prepare('SELECT * FROM citas WHERE id=?').get(r.id);
    ok(c1.cliente_id === cliTel, 'reservar con un móvil que ya está en la ficha ENLAZA a ese cliente');
    ok(c1.cliente_suelto_nombre === '' && c1.cliente_suelto_movil === '', 'y no deja copia suelta del nombre (no se duplica el dato)');

    const r2 = crearReservaPublica(db, {
      service_ids: [corte], user_id: ana, fecha, inicio_min: 11 * 60,
      nombre: 'P. Ruiz', email: 'pedro@ej.com', consent: true,
    }, { ahora });
    ok(db.prepare('SELECT cliente_id FROM citas WHERE id=?').get(r2.id).cliente_id === cliMail, 'y enlaza igual por email');
    ok(db.prepare('SELECT COUNT(*) n FROM clients').get().n === antes,
       'NINGUNA ficha nueva: ni duplicada ni creada (' + antes + ' antes, ' + db.prepare('SELECT COUNT(*) n FROM clients').get().n + ' después)');

    // Un cliente ARCHIVADO no se reutiliza (archivar = fuera del sistema vivo).
    db.prepare('UPDATE clients SET active=0 WHERE id=?').run(cliTel);
    ok(resolverClientePublico(db, { movil: '600111222' }).cliente_id === null, 'un cliente archivado no se enlaza (se queda suelto)');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 7. MODO "YO APRUEBO": RETIENE EL HUECO Y CADUCA SOLO ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db, { modo: 'aprobar', ret: 24 }); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const fecha = proximoLunes();
    const ahora = AHORA(proximoLunes(0), 8 * 60);
    const T0 = 1800000000;   // epoch fijo: el test no depende del reloj
    const base = { service_ids: [corte], user_id: ana, fecha, nombre: 'X', movil: '600111222', consent: true };

    const r = crearReservaPublica(db, { ...base, inicio_min: 10 * 60 }, { ahora, nowEpoch: T0 });
    ok(r.aprobacion === 'pendiente', 'en modo aprobar, la reserva nace PENDIENTE');
    const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(r.id);
    ok(cita.estado === 'pedida', 'la cita queda en "pedida" (no confirmada)');
    const res = reservaDeCita(db, r.id);
    ok(res.retiene_hasta === T0 + 24 * 3600, 'con su caducidad a 24 h (retiene_hasta = ahora + 24 h)');

    // LO IMPORTANTE: retiene el hueco. La cita EXISTE, así que ocupa.
    const hs = huecosPublicos(db, { fecha, service_ids: [corte], ahora });
    ok(!hs.some(h => h.min === 10 * 60), 'la solicitud pendiente RETIENE el hueco: ya no se ofrece a nadie');
    const e = cae(() => crearReservaPublica(db, { ...base, inicio_min: 10 * 60, movil: '600222333' }, { ahora, nowEpoch: T0 }));
    ok(e && e.status === 409, 'y otro cliente que intente ese hueco recibe 409');

    // Avisos al negocio: la fuente que se engancha al motor que YA existe.
    const av = reservasPublicasPendientes(db, proximoLunes(0), T0 + 3600);
    ok(av.length === 1 && av[0].tipo === 'reserva_publica', 'la solicitud aparece como aviso al negocio (fuente reserva_publica)');
    ok(/caduca sola en 23 h/.test(av[0].detalle), 'y dice cuánto le queda: «' + av[0].detalle + '»');

    // La fuente no basta: el motor de avisos SOLO cuenta los tipos que están en TIPO_ORDEN, y la huella
    // de "visto" depende de avisoKey. Sin esas dos piezas el aviso existiría pero no se contaría, o
    // reaparecería como nuevo cada hora al cambiar horas_restantes. Se comprueban las dos.
    const { resumenAvisos, avisoKey, PERM_POR_FUENTE } = await import('../modules/erp/avisos.js');
    const grupos = resumenAvisos(av);
    ok(grupos.length === 1 && grupos[0].count === 1, 'el resumen del motor de avisos LO CUENTA (está en TIPO_ORDEN)');
    ok(/solicitud de cita por Internet/.test(grupos[0].frase), 'con frase legible: «' + grupos[0].frase + '»');
    ok(PERM_POR_FUENTE.reserva_publica === 'citas.read', 'la fuente declara su permiso (sin permiso declarado no se sirve a nadie)');
    const clave = avisoKey(av[0]);
    const masTarde = reservasPublicasPendientes(db, proximoLunes(0), T0 + 20 * 3600);
    ok(clave === 'rp:' + r.id && avisoKey(masTarde[0]) === clave,
       'la clave del aviso es ESTABLE aunque cambien las horas que le quedan (' + clave + '): marcarlo visto no se deshace solo');

    // Caducar: idempotente, y DEVUELVE el hueco.
    ok(caducarReservasPendientes(db, T0 + 3600) === 0, 'antes de las 24 h no caduca nada');
    ok(caducarReservasPendientes(db, T0 + 25 * 3600) === 1, 'pasadas las 24 h sin respuesta, caduca sola');
    ok(caducarReservasPendientes(db, T0 + 25 * 3600) === 0, 'y es idempotente: pasar dos veces no vuelve a tocarla');
    ok(db.prepare('SELECT estado FROM citas WHERE id=?').get(r.id).estado === 'anulada', 'la cita caducada queda ANULADA');
    ok(reservaDeCita(db, r.id).aprobacion === 'caducada', 'y la solicitud marcada como caducada');
    ok(quienAnulo(db, r.id) === 'automatico', 'y queda escrito que la anuló el RELOJ, no una persona: automatico');
    ok(huecosPublicos(db, { fecha, service_ids: [corte], ahora }).some(h => h.min === 10 * 60), 'el hueco VUELVE a estar libre');
    ok(reservasPublicasPendientes(db, proximoLunes(0), T0 + 25 * 3600).length === 0, 'y desaparece de los avisos del negocio');

    // Aprobar y rechazar.
    const r2 = crearReservaPublica(db, { ...base, inicio_min: 12 * 60 }, { ahora, nowEpoch: T0 });
    aprobarReserva(db, r2.id);
    ok(db.prepare('SELECT estado FROM citas WHERE id=?').get(r2.id).estado === 'confirmada', 'aprobar deja la cita CONFIRMADA');
    ok(reservaDeCita(db, r2.id).retiene_hasta === null, 'y le quita la caducidad (ya no cuelga de un reloj)');
    ok(caducarReservasPendientes(db, T0 + 999 * 3600) === 0, 'una aprobada NO puede caducar después');

    const r3 = crearReservaPublica(db, { ...base, inicio_min: 13 * 60 }, { ahora, nowEpoch: T0 });
    rechazarReserva(db, r3.id);
    ok(db.prepare('SELECT estado FROM citas WHERE id=?').get(r3.id).estado === 'anulada', 'rechazar anula la cita');
    ok(quienAnulo(db, r3.id) === 'negocio', 'y la anulación es del NEGOCIO: la decidió él al rechazar');
    ok(huecosPublicos(db, { fecha, service_ids: [corte], ahora }).some(h => h.min === 13 * 60), 'y devuelve el hueco');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 8. CAMBIAR Y ANULAR: DENTRO Y FUERA DE LA VENTANA ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db, { cancH: 24, cancAct: 1 }); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const fecha = proximoLunes();
    const lejos = AHORA(proximoLunes(0), 8 * 60);
    const base = { service_ids: [corte], user_id: ana, fecha, nombre: 'X', movil: '600111222', consent: true };

    const r = crearReservaPublica(db, { ...base, inicio_min: 10 * 60 }, { ahora: lejos });
    const cita = () => db.prepare('SELECT * FROM citas WHERE id=?').get(r.id);

    // DENTRO de la ventana (faltan días).
    const v1 = ventanaCliente(db, cita(), lejos);
    ok(v1.aplica === true && v1.puede === true, 'faltando días, el cliente SÍ puede cambiar o anular');
    const cam = cambiarReservaPublica(db, r.id, { fecha, inicio_min: 12 * 60 }, { ahora: lejos });
    ok(cam.hora === '12:00' && cita().inicio_min === 12 * 60, 'cambiar la hora dentro de la ventana funciona (10:00 → 12:00)');
    ok(huecosPublicos(db, { fecha, service_ids: [corte], ahora: lejos }).some(h => h.min === 10 * 60),
       'y el hueco viejo queda libre otra vez');

    const eCh = cae(() => cambiarReservaPublica(db, r.id, { fecha, inicio_min: 12 * 60 }, { ahora: lejos }));
    ok(eCh && eCh.status === 409, 'cambiar a un hueco ocupado (el suyo ya movido no cuenta, pero otro sí) → 409');

    // FUERA de la ventana: 12 h antes de una cita con plazo de 24 h.
    const doceHAntes = AHORA(fecha, 12 * 60 - 60);   // el mismo día, una hora antes de las 12:00... faltan 60 min
    const v2 = ventanaCliente(db, cita(), doceHAntes);
    ok(v2.puede === false, 'a 60 min de la cita, con plazo de 24 h, ya NO puede');
    ok(/24 h antes/.test(v2.motivo), 'y se le dice por qué, con el plazo real: «' + v2.motivo + '»');
    const e1 = cae(() => cambiarReservaPublica(db, r.id, { fecha, inicio_min: 13 * 60 }, { ahora: doceHAntes }));
    ok(e1 && e1.status === 403, 'cambiar fuera de la ventana → 403');
    const e2 = cae(() => anularReservaPublica(db, r.id, { ahora: doceHAntes }));
    ok(e2 && e2.status === 403, 'anular fuera de la ventana → 403');
    ok(cita().estado !== 'anulada', 'y la cita sigue en pie');

    // Anular dentro de la ventana sí.
    anularReservaPublica(db, r.id, { ahora: lejos });
    ok(cita().estado === 'anulada', 'anular dentro de la ventana funciona');
    ok(quienAnulo(db, r.id) === 'cliente', 'y consta como anulada por el CLIENTE, sin preguntarle: lo dice el camino que ha usado');

    // Desactivar la ventana del todo.
    const r2 = crearReservaPublica(db, { ...base, inicio_min: 9 * 60 }, { ahora: lejos });
    db.prepare('UPDATE company_config SET cita_pub_cancelar_activo=0 WHERE id=1').run();
    const c2 = db.prepare('SELECT * FROM citas WHERE id=?').get(r2.id);
    const v3 = ventanaCliente(db, c2, lejos);
    ok(v3.puede === false && v3.desactivado === true, 'con la ventana DESACTIVADA, el cliente no puede tocar nada');
    ok(/ponte en contacto/i.test(v3.motivo), 'y se le manda a hablar con el negocio: «' + v3.motivo + '»');
    ok(cae(() => anularReservaPublica(db, r2.id, { ahora: lejos })).status === 403, 'anular con la ventana desactivada → 403');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 9. LA VENTANA NO TOCA A LAS CITAS DE LA AGENDA (pieza 5 intacta) ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db, { cancH: 24 }); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const fecha = proximoLunes();
    // Cita creada COMO EN LA AGENDA (sin pasar por la puerta): no hay fila en cita_reserva_publica.
    const { createCitaSvc } = await import('../modules/erp/routes/citas.js');
    const dentro = createCitaSvc(db, {
      service_ids: [corte], user_id: ana, fecha, inicio_min: 10 * 60, cliente_suelto_nombre: 'De dentro',
    }, {});
    const cita = db.prepare('SELECT * FROM citas WHERE id=?').get(dentro.id);
    const v = ventanaCliente(db, cita, AHORA(fecha, 9 * 60));   // ¡a 60 min de la cita!
    ok(v.aplica === false, 'una cita creada en la agenda NO entra en la ventana de la pieza 6');
    ok(v.puede === true, 'y su enlace sigue comportándose como en la pieza 5, aunque falte una hora');
    ok(reservaDeCita(db, dentro.id) === null, 'no tiene marca de origen público');
    const e = cae(() => anularReservaPublica(db, dentro.id, {}));
    ok(e && e.status === 403, 'las acciones nuevas del enlace rechazan una cita de dentro (403): no la gestionan');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 10. "CUALQUIERA DISPONIBLE" y la política de huecos ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'), luis = usuario(db, 'Luis Sistema');
    verVisible(db, ana, 'Ana'); verVisible(db, luis, 'Luis');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    const fecha = proximoLunes();
    const ahora = AHORA(proximoLunes(0), 8 * 60);
    const base = { service_ids: [corte], fecha, nombre: 'X', movil: '600111222', consent: true };

    // Ana ocupa las 10:00; "cualquiera" debe seguir ofreciéndolas (queda Luis).
    crearReservaPublica(db, { ...base, user_id: ana, inicio_min: 10 * 60 }, { ahora });
    ok(!huecosPublicos(db, { fecha, service_ids: [corte], user_id: ana, ahora }).some(h => h.min === 600),
       'pidiendo a Ana, las 10:00 ya no están');
    const cualquiera = huecosPublicos(db, { fecha, service_ids: [corte], ahora });
    ok(cualquiera.some(h => h.min === 600), '"cualquiera disponible" SÍ ofrece las 10:00 (queda Luis libre)');

    const r = crearReservaPublica(db, { ...base, user_id: null, inicio_min: 10 * 60, movil: '600222333' }, { ahora });
    ok(db.prepare('SELECT user_id FROM citas WHERE id=?').get(r.id).user_id === luis,
       '"cualquiera" asigna a quien de verdad tiene el hueco libre (Luis)');
    ok(!huecosPublicos(db, { fecha, service_ids: [corte], ahora }).some(h => h.min === 600),
       'con los dos ocupados, las 10:00 desaparecen también de "cualquiera"');

    const pol = politicaHuecos(db);
    ok(pol.antelacion_min === 120 && pol.ventana_dias === 60, 'la política de la puerta lleva SU antelación y SU ventana');
    ok(pol.grid === 30, 'y la rejilla del NEGOCIO (la misma de dentro), porque es cómo trabaja, no escaparate');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 11. NO HAY FUGA DE DATOS ===\n');
  {
    const db = nuevaBD(); abrirPuerta(db); horarioLV(db);
    const ana = usuario(db, 'Ana Sistema'); verVisible(db, ana, 'Ana');
    const corte = servicio(db, { nombre: 'Corte', precio: 20, dur: 30 });
    db.prepare("INSERT INTO clients (name,email,movil_e164,active,client_code) VALUES ('Cliente Secreto','secreto@ej.com','+34600555444',1,'CLI-0001')").run();
    const fecha = proximoLunes();
    const ahora = AHORA(proximoLunes(0), 8 * 60);
    crearReservaPublica(db, {
      service_ids: [corte], user_id: ana, fecha, inicio_min: 10 * 60,
      nombre: 'Otro', movil: '600555444', consent: true,
    }, { ahora });

    const superficie = JSON.stringify({
      servicios: serviciosPublicos(db),
      personas: personasPublicas(db, [corte]),
      huecos: huecosPublicos(db, { fecha, service_ids: [corte], ahora }).map(h => ({ min: h.min, hora: h.hora })),
    });
    ok(!superficie.includes('Cliente Secreto'), 'lo que sale a la calle no lleva nombres de clientes');
    ok(!superficie.includes('secreto@ej.com') && !superficie.includes('600555444'), 'ni emails ni teléfonos de terceros');
    ok(!superficie.includes('Sistema'), 'ni nombres de usuarios del sistema');
    ok(!superficie.includes('Otro'), 'ni el nombre de quien acaba de reservar');
    ok(!/cita_id|token|CITA-/.test(superficie), 'ni identificadores ni llaves de citas ajenas');

    // Y el endpoint de huecos no debe soltar el reparto interno del equipo (user_ids es de servidor).
    const hs = huecosPublicos(db, { fecha, service_ids: [corte], ahora });
    ok(hs[0].user_ids !== undefined, 'huecosPublicos SÍ resuelve user_ids… (lo usa el servidor para asignar)');
    ok(!superficie.includes('user_ids'), '…pero no viaja en lo que se sirve al navegador');
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 12. MIGRACIÓN ADITIVA E IDEMPOTENTE ===\n');
  {
    const db = nuevaBD();
    const cols = (t) => db.pragma('table_info(' + t + ')').map(c => c.name);
    ok(cols('service_config').includes('publico'), 'service_config gana la columna `publico`');
    // La cuenta es CERRADA a propósito: si alguien añade una columna y no pasa por aquí, este test se
    // pone rojo y hay que mirar por qué. Eso funcionó — pero nadie lo vio, porque este fichero estaba
    // FUERA del barrido. Eran 10 el 8 ago; el 18 ago (`921bbe1`) llegaron `cita_pub_auto` y
    // `cita_pub_auto_visto` (el pestillo del encendido automático de la puerta y su aviso al dueño) y
    // la cuenta se quedó vieja. Se actualiza a 12: mismo listón, número al día.
    ok(cols('company_config').filter(c => c.startsWith('cita_pub_')).length === 12, 'company_config gana las 12 columnas cita_pub_*');
    ok(cols('cita_pub_personas').length === 4, 'existe la tabla cita_pub_personas');
    ok(cols('cita_reserva_publica').includes('consent_texto'), 'existe la tabla cita_reserva_publica');
    // Nada de la pieza 5 cambió.
    const citasCols = cols('citas');
    ok(!citasCols.some(c => c.startsWith('cita_pub') || c === 'origen'), 'la tabla `citas` de la pieza 5 NO gana ninguna columna');
    // Re-migrar no rompe ni duplica.
    runMigrations(db); runMigrations(db);
    ok(cols('company_config').filter(c => c.startsWith('cita_pub_')).length === 12, 'runMigrations x3 es idempotente');
    ok(db.prepare('SELECT COUNT(*) n FROM company_config').get().n === 1, 'y no duplica la fila de configuración');
  }

  console.log('\n' + '─'.repeat(72));
  console.log(fail === 0 ? `✅ TODO VERDE — ${pass} comprobaciones, 0 fallos` : `❌ ${fail} FALLO(S) de ${pass + fail}`);
} finally {
  for (const [db, f] of dbs) { try { db.close(); unlinkSync(f); } catch {} }
}
process.exit(fail === 0 ? 0 : 1);
