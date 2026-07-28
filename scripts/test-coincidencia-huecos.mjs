// PRUEBA DE COINCIDENCIA — PIEZA 6. Los huecos de la agenda INTERNA y los de la página PÚBLICA son
// IDÉNTICOS AL MINUTO para el mismo día, el mismo servicio y la misma persona.
//   node scripts/test-coincidencia-huecos.mjs
//
// POR QUÉ ESTE TEST ES EL QUE IMPORTA. Un sistema de reservas que ofrece fuera un hueco que dentro no
// existe (o al revés) produce dobles reservas y clientes plantados, y lo hace en silencio: nadie mira
// las dos listas a la vez. La defensa NO es "revisar que coincidan", es que haya UNA SOLA función que
// las calcule. Este test lo demuestra por comparación exhaustiva, no por lectura del código.
//
// `huecosDentro` de aquí abajo REPLICA, línea por línea, lo que hace la ruta interna
// GET /api/erp/citas/huecos (modules/erp/routes/citas.js): mismos ajustes, misma geometría, misma
// llamada a huecos(). Si algún día alguien mete un cálculo propio en un lado, este test se pone rojo.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { huecos, geometriaCadena, dowDeFecha, hhmm } from '../modules/erp/citas-engine.js';
import { ajustesCitas, resolveServiceConfigs, createCitaSvc } from '../modules/erp/routes/citas.js';
import { huecosPublicos } from '../modules/erp/reserva-publica.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'coinc-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  return db;
}

// ── LA RUTA INTERNA, replicada tal cual (citas.js · api.get('/huecos')) ────────────────────────────
function huecosDentro(db, { fecha, user_id, service_ids, recurso_id = null, ahora }) {
  const aj = ajustesCitas(db);
  const configs = resolveServiceConfigs(db, service_ids, aj.margen_defecto_min);
  const geo = geometriaCadena(configs);
  return huecos(db, {
    fecha, user_id, recurso_id,
    dur_min: geo.dur_total, margen_min: geo.margen_min, grid: aj.grid,
    antelacion_min: aj.antelacion_min, ventana_dias: aj.ventana_dias,
    corte_mismo_dia_min: aj.corte_mismo_dia_min,
    ahora,
  });
}
const huecosFuera = (db, o) => huecosPublicos(db, o).map(h => h.min);

// Compara las dos listas y, si difieren, dice EXACTAMENTE en qué minutos.
function coinciden(db, etiqueta, opts) {
  const dentro = huecosDentro(db, opts);
  const fuera = huecosFuera(db, opts);
  const soloDentro = dentro.filter(m => !fuera.includes(m));
  const soloFuera = fuera.filter(m => !dentro.includes(m));
  const igual = soloDentro.length === 0 && soloFuera.length === 0 && dentro.length === fuera.length;
  ok(igual, etiqueta + ' — ' + dentro.length + ' huecos, idénticos'
    + (igual ? ' (' + (dentro.length ? hhmm(dentro[0]) + '…' + hhmm(dentro[dentro.length - 1]) : 'ninguno') + ')'
             : ' · SOLO DENTRO: [' + soloDentro.map(hhmm).join(',') + '] · SOLO FUERA: [' + soloFuera.map(hhmm).join(',') + ']'));
  return dentro;
}

const usuario = (db, name) =>
  db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)")
    .run(name, name.replace(/\s/g, '') + '@t.local', 'x').lastInsertRowid;
function servicio(db, { nombre, dur = 60, margen = 0, espera = 0, esperaIni = 0 }) {
  const pid = db.prepare(
    "INSERT INTO products (name,sku,price,tax_band,type,status,stock) VALUES (?,?,20,'general','service','active',0)"
  ).run(nombre, nombre.toLowerCase().replace(/[^a-z]+/g, '-')).lastInsertRowid;
  db.prepare(
    'INSERT INTO service_config (product_id,reservable,duracion_min,muerto_ini_min,muerto_dur_min,margen_min,publico) VALUES (?,1,?,?,?,?,1)'
  ).run(pid, dur, esperaIni, espera, margen);
  return pid;
}
function proximoLunes(desdeDias = 7) {
  const base = Date.now() + desdeDias * 86400000;
  for (let i = 0; i < 14; i++) {
    const f = new Date(base + i * 86400000).toISOString().slice(0, 10);
    if (dowDeFecha(f) === 1) return f;
  }
  return new Date(base).toISOString().slice(0, 10);
}
const AHORA = (fecha, min) => ({ fecha, min, dow: dowDeFecha(fecha) });

// Escenario base: la MISMA política dentro y fuera, para que la comparación sea limpia.
function escenario(extra = {}) {
  const db = nuevaBD();
  db.prepare(
    `UPDATE company_config SET company_name='Negocio', cita_pub_activa=1, cita_pub_handle='n',
       cita_pub_antelacion_min=?, cita_pub_ventana_dias=?, cita_grid_min=?, cita_antelacion_min=?,
       cita_ventana_dias=?, cita_margen_defecto_min=? WHERE id=1`
  ).run(extra.antel ?? 120, extra.ventana ?? 60, extra.grid ?? 30, extra.antel ?? 120, extra.ventana ?? 60, extra.margenDef ?? 0);
  const u = usuario(db, 'Ana Sistema');
  db.prepare('INSERT INTO cita_pub_personas (user_id,visible,nombre_publico) VALUES (?,1,?)').run(u, 'Ana');
  return { db, u };
}
const tramoNegocio = (db, dow, ini, fin) =>
  db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dow, ini, fin);

try {
  const L = proximoLunes();
  const HOY = proximoLunes(0);

  console.log('\n=== 1. El caso simple: horario corrido ===\n');
  {
    const { db, u } = escenario();
    for (let d = 1; d <= 5; d++) tramoNegocio(db, d, 9 * 60, 14 * 60);
    const s = servicio(db, { nombre: 'Corte', dur: 30 });
    const hs = coinciden(db, 'L 9:00-14:00, servicio de 30 min', { fecha: L, user_id: u, service_ids: [s], ahora: AHORA(HOY, 8 * 60) });
    ok(hs.length === 10, 'y son los 10 esperados (9:00→13:30)');
  }

  console.log('\n=== 2. Descanso a media mañana (dos tramos) ===\n');
  {
    const { db, u } = escenario();
    for (let d = 1; d <= 5; d++) { tramoNegocio(db, d, 9 * 60, 14 * 60); tramoNegocio(db, d, 16 * 60, 20 * 60); }
    const s = servicio(db, { nombre: 'Corte', dur: 30 });
    const hs = coinciden(db, 'dos tramos con descanso 14-16', { fecha: L, user_id: u, service_ids: [s], ahora: AHORA(HOY, 8 * 60) });
    ok(!hs.some(m => m >= 14 * 60 && m < 16 * 60), 'y el descanso no ofrece huecos en ninguna de las dos listas');
  }

  console.log('\n=== 3. Márgenes, tiempo de espera interior y cadenas ===\n');
  {
    const { db, u } = escenario();
    for (let d = 1; d <= 5; d++) tramoNegocio(db, d, 9 * 60, 14 * 60);
    const conMargen = servicio(db, { nombre: 'Con margen', dur: 45, margen: 15 });
    const conEspera = servicio(db, { nombre: 'Tinte', dur: 90, esperaIni: 20, espera: 40 });
    const corto = servicio(db, { nombre: 'Flequillo', dur: 15 });
    coinciden(db, 'servicio de 45 min + 15 de margen', { fecha: L, user_id: u, service_ids: [conMargen], ahora: AHORA(HOY, 8 * 60) });
    coinciden(db, 'servicio con tiempo de espera interior (90 min, libre 20→60)', { fecha: L, user_id: u, service_ids: [conEspera], ahora: AHORA(HOY, 8 * 60) });
    coinciden(db, 'cadena de tres servicios (45+90+15 = 150 min)', { fecha: L, user_id: u, service_ids: [conMargen, conEspera, corto], ahora: AHORA(HOY, 8 * 60) });
  }

  console.log('\n=== 4. Con la agenda YA OCUPADA (el caso que de verdad se rompe) ===\n');
  {
    const { db, u } = escenario();
    for (let d = 1; d <= 5; d++) tramoNegocio(db, d, 9 * 60, 14 * 60);
    const corte = servicio(db, { nombre: 'Corte', dur: 30 });
    const tinte = servicio(db, { nombre: 'Tinte', dur: 90, esperaIni: 20, espera: 40 });

    // Una cita normal, una con tiempo de espera interior (que DEVUELVE hueco), y un bloqueo.
    createCitaSvc(db, { service_ids: [corte], user_id: u, fecha: L, inicio_min: 9 * 60 + 30, cliente_suelto_nombre: 'A' }, {});
    createCitaSvc(db, { service_ids: [tinte], user_id: u, fecha: L, inicio_min: 11 * 60, cliente_suelto_nombre: 'B' }, {});
    db.prepare("INSERT INTO agenda_bloqueos (user_id,fecha,inicio_min,fin_min,motivo) VALUES (?,?,?,?,'Comida')")
      .run(u, L, 13 * 60, 13 * 60 + 30);

    const hs = coinciden(db, 'con 2 citas y 1 bloqueo puestos', { fecha: L, user_id: u, service_ids: [corte], ahora: AHORA(HOY, 8 * 60) });
    ok(!hs.includes(9 * 60 + 30), 'la hora de la cita existente no se ofrece');
    ok(!hs.includes(13 * 60), 'ni la del bloqueo');
    // El tiempo muerto interior del tinte (11:20→12:00) es hueco LIBRE para la persona: 40 min caben.
    ok(hs.includes(11 * 60 + 30),
       'y el TIEMPO DE ESPERA interior del tinte se ofrece como hueco libre en LAS DOS listas (11:30)');
    coinciden(db, 'lo mismo pidiendo un servicio largo (no cabe en el hueco muerto)', { fecha: L, user_id: u, service_ids: [tinte], ahora: AHORA(HOY, 8 * 60) });
  }

  console.log('\n=== 5. Excepciones de horario (la excepción manda) ===\n');
  {
    const { db, u } = escenario();
    for (let d = 1; d <= 5; d++) tramoNegocio(db, d, 9 * 60, 14 * 60);
    const s = servicio(db, { nombre: 'Corte', dur: 30 });
    const L2 = proximoLunes(21);

    db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,motivo) VALUES ('negocio',NULL,?,'cerrado','Festivo')").run(L);
    const cerrado = coinciden(db, 'día CERRADO por excepción del negocio', { fecha: L, user_id: u, service_ids: [s], ahora: AHORA(HOY, 8 * 60) });
    ok(cerrado.length === 0, 'y las dos dicen: cero huecos');

    db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,inicio_min,fin_min,motivo) VALUES ('negocio',NULL,?,'horario',?,?,'Víspera')")
      .run(L2, 10 * 60, 12 * 60);
    const especial = coinciden(db, 'día con HORARIO ESPECIAL 10-12', { fecha: L2, user_id: u, service_ids: [s], ahora: AHORA(HOY, 8 * 60) });
    ok(especial.length === 4 && especial[0] === 10 * 60, 'y son los 4 de 10:00→11:30, no los del horario semanal');

    // Vacaciones de la PERSONA (excepción de ámbito user).
    const L3 = proximoLunes(35);
    db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,motivo) VALUES ('user',?,?,'cerrado','Vacaciones')").run(u, L3);
    const vac = coinciden(db, 'la PERSONA de vacaciones ese día', { fecha: L3, user_id: u, service_ids: [s], ahora: AHORA(HOY, 8 * 60) });
    ok(vac.length === 0, 'cero huecos en las dos');
  }

  console.log('\n=== 6. Horario propio de la persona, y rejilla de 15 ===\n');
  {
    const { db, u } = escenario({ grid: 15 });
    for (let d = 1; d <= 5; d++) tramoNegocio(db, d, 9 * 60, 20 * 60);
    // Ana solo trabaja de 10 a 13, dentro del horario del negocio.
    for (let d = 1; d <= 5; d++) db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('user',?,?,?,?)").run(u, d, 10 * 60, 13 * 60);
    const s = servicio(db, { nombre: 'Corte', dur: 30 });
    const hs = coinciden(db, 'horario propio 10-13 con rejilla de 15 min', { fecha: L, user_id: u, service_ids: [s], ahora: AHORA(HOY, 8 * 60) });
    ok(hs.length === 11 && hs[0] === 10 * 60 && hs[hs.length - 1] === 12 * 60 + 30,
       'y son los 11 de 10:00→12:30 en pasos de 15 (' + hs.length + ')');
    ok(!hs.some(m => m < 10 * 60 || m >= 13 * 60), 'el horario del negocio no le añade horas que ella no trabaja');
  }

  console.log('\n=== 7. HOY, con la antelación mordiendo ===\n');
  {
    const { db, u } = escenario({ antel: 120 });
    for (let d = 0; d <= 6; d++) tramoNegocio(db, d, 9 * 60, 20 * 60);
    const s = servicio(db, { nombre: 'Corte', dur: 30 });
    for (const hora of [8, 9, 11, 13, 17, 19, 20]) {
      coinciden(db, 'HOY consultado a las ' + hhmm(hora * 60) + ' (antelación 2 h)',
        { fecha: HOY, user_id: u, service_ids: [s], ahora: AHORA(HOY, hora * 60) });
    }
  }

  console.log('\n=== 8. Corte del mismo día ===\n');
  {
    const { db, u } = escenario({ antel: 0 });
    db.prepare('UPDATE company_config SET cita_corte_mismo_dia_min=? WHERE id=1').run(12 * 60);
    for (let d = 0; d <= 6; d++) tramoNegocio(db, d, 9 * 60, 20 * 60);
    const s = servicio(db, { nombre: 'Corte', dur: 30 });
    const antes = coinciden(db, 'HOY a las 11:00, con corte a las 12:00', { fecha: HOY, user_id: u, service_ids: [s], ahora: AHORA(HOY, 11 * 60) });
    ok(antes.length > 0, 'antes del corte, hay huecos');
    const despues = coinciden(db, 'HOY a las 13:00, ya pasado el corte', { fecha: HOY, user_id: u, service_ids: [s], ahora: AHORA(HOY, 13 * 60) });
    ok(despues.length === 0, 'pasado el corte, ninguna de las dos ofrece nada para hoy');
    coinciden(db, 'pero mañana sigue abierto', { fecha: proximoLunes(1), user_id: u, service_ids: [s], ahora: AHORA(HOY, 13 * 60) });
  }

  console.log('\n=== 9. Barrido de 60 días seguidos (todos los días, sin excepción) ===\n');
  {
    const { db, u } = escenario();
    for (let d = 1; d <= 6; d++) { tramoNegocio(db, d, 9 * 60, 14 * 60); tramoNegocio(db, d, 16 * 60, 20 * 60); }
    const corte = servicio(db, { nombre: 'Corte', dur: 30 });
    const tinte = servicio(db, { nombre: 'Tinte', dur: 90, esperaIni: 20, espera: 40, margen: 10 });
    // Se siembra la agenda de citas repartidas por el mes, para que haya ocupación real.
    for (let i = 1; i <= 40; i += 3) {
      const f = new Date(Date.parse(HOY + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
      try { createCitaSvc(db, { service_ids: [i % 2 ? corte : tinte], user_id: u, fecha: f, inicio_min: (10 + (i % 4)) * 60, cliente_suelto_nombre: 'C' + i }, {}); } catch {}
    }
    const ahora = AHORA(HOY, 7 * 60);
    let dias = 0, iguales = 0, totalHuecos = 0;
    for (let i = 0; i <= 60; i++) {
      const f = new Date(Date.parse(HOY + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
      for (const svc of [[corte], [tinte], [corte, tinte]]) {
        const a = huecosDentro(db, { fecha: f, user_id: u, service_ids: svc, ahora }).join(',');
        const b = huecosFuera(db, { fecha: f, service_ids: svc, user_id: u, ahora }).join(',');
        dias++; if (a === b) iguales++;
        totalHuecos += a ? a.split(',').length : 0;
      }
    }
    ok(iguales === dias, 'BARRIDO: ' + iguales + '/' + dias + ' combinaciones día×servicio coinciden al minuto');
    ok(totalHuecos > 1500, 'y no es un empate vacío: se compararon ' + totalHuecos + ' huecos de verdad');
  }

  console.log('\n=== 10. Políticas DISTINTAS: la de fuera FILTRA, no calcula otra cosa ===\n');
  {
    // Dentro: antelación 0, ventana 3650. Fuera: antelación 2 h, ventana 60 días. En un día que las
    // DOS admiten, las listas siguen siendo idénticas — porque es la misma función con otros topes.
    const db = nuevaBD();
    db.prepare(
      `UPDATE company_config SET company_name='N', cita_pub_activa=1, cita_pub_handle='n',
         cita_antelacion_min=0, cita_ventana_dias=3650, cita_pub_antelacion_min=120,
         cita_pub_ventana_dias=60, cita_grid_min=30 WHERE id=1`
    ).run();
    const u = usuario(db, 'Ana Sistema');
    db.prepare('INSERT INTO cita_pub_personas (user_id,visible,nombre_publico) VALUES (?,1,?)').run(u, 'Ana');
    for (let d = 0; d <= 6; d++) tramoNegocio(db, d, 9 * 60, 20 * 60);
    const s = servicio(db, { nombre: 'Corte', dur: 30 });
    const ahora = AHORA(HOY, 8 * 60);

    coinciden(db, 'día +7 (dentro de las dos ventanas)', { fecha: proximoLunes(7), user_id: u, service_ids: [s], ahora });
    coinciden(db, 'día +30 (dentro de las dos ventanas)', { fecha: proximoLunes(30), user_id: u, service_ids: [s], ahora });

    // Y en los BORDES, la diferencia es la esperada y está DECLARADA: fuera recorta, no inventa.
    const f90 = new Date(Date.parse(HOY + 'T00:00:00Z') + 90 * 86400000).toISOString().slice(0, 10);
    const dentro90 = huecosDentro(db, { fecha: f90, user_id: u, service_ids: [s], ahora });
    const fuera90 = huecosFuera(db, { fecha: f90, service_ids: [s], user_id: u, ahora });
    ok(dentro90.length > 0 && fuera90.length === 0,
       'a 90 días: dentro sí (ventana 3650), fuera NO (ventana 60). La puerta recorta, y eso es su política');
    const dentroHoy = huecosDentro(db, { fecha: HOY, user_id: u, service_ids: [s], ahora: AHORA(HOY, 9 * 60) });
    const fueraHoy = huecosFuera(db, { fecha: HOY, service_ids: [s], user_id: u, ahora: AHORA(HOY, 9 * 60) });
    ok(dentroHoy[0] === 9 * 60 && fueraHoy[0] === 11 * 60,
       'HOY a las 9:00: dentro puede citar ya (' + hhmm(dentroHoy[0]) + '), fuera espera 2 h (' + hhmm(fueraHoy[0]) + ')');
    ok(fueraHoy.every(m => dentroHoy.includes(m)),
       'y TODO hueco público es un hueco interno: la lista de fuera es un SUBCONJUNTO de la de dentro, nunca algo distinto');
  }

  console.log('\n' + '─'.repeat(72));
  console.log(fail === 0 ? `✅ COINCIDENCIA DEMOSTRADA — ${pass} comprobaciones, 0 fallos` : `❌ ${fail} FALLO(S) de ${pass + fail}`);
} finally {
  for (const [db, f] of dbs) { try { db.close(); unlinkSync(f); } catch {} }
}
process.exit(fail === 0 ? 0 : 1);
