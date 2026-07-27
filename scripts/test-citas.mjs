// Test de LÓGICA — SISTEMA DE CITAS · motor (Escalera · paso 7 · PIEZA 5), sobre BD temporal.
//   node scripts/test-citas.mjs
//
// Demuestra: huecos calculados con horario + margen + tiempo muerto interior (que se devuelve LIBRE);
// solape rechazado por PERSONA y por RECURSO; la EXCEPCIÓN manda sobre la regla semanal; antelación,
// ventana máxima y corte del mismo día; estados y sus saltos; zona horaria Europe/Madrid.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import {
  hhmm, parseHHMM, overlaps, dowDeFecha, ahoraLocal, geometriaCadena, huecos, comprobarSolape,
  tramosPersona, tramosAmbito, puedeTransicionar, ESTADOS,
} from '../modules/erp/citas-engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'citas-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  return db;
}
const nuevoUsuario = (db, name) => db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)").run(name, name + '@t.local', 'x').lastInsertRowid;
// Horario de negocio: L-V 9:00-14:00 y 16:00-20:00 (descanso 14-16). dow 1..5.
function horarioNegocioLV(db) {
  for (let dow = 1; dow <= 5; dow++) {
    db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dow, 9 * 60, 14 * 60);
    db.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dow, 16 * 60, 20 * 60);
  }
}
// Una fecha futura que caiga en un día concreto de la semana (dowObjetivo), a partir de hoy+7.
function proximoDow(dowObjetivo) {
  const base = new Date(Date.now() + 7 * 86400000);
  for (let i = 0; i < 14; i++) {
    const f = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (dowDeFecha(f) === dowObjetivo) return f;
  }
  return base.toISOString().slice(0, 10);
}

try {
  console.log('\n=== 0. helpers de tiempo y zona Europe/Madrid ===\n');
  ok(hhmm(0) === '00:00' && hhmm(9 * 60 + 30) === '09:30' && hhmm(20 * 60) === '20:00', 'hhmm formatea minutos → HH:MM');
  ok(parseHHMM('09:30') === 570 && parseHHMM('24:00') === null && parseHHMM('9:5') === null, 'parseHHMM valida y convierte');
  ok(overlaps(0, 10, 5, 15) && !overlaps(0, 10, 10, 20), 'overlaps: semiabierto (tocar por el borde NO solapa)');
  const a = ahoraLocal('Europe/Madrid');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(a.fecha) && a.min >= 0 && a.min < 1440 && a.dow >= 0 && a.dow <= 6, 'ahoraLocal da fecha+min+dow en Europe/Madrid');
  // Un instante conocido: 2026-07-27 (lunes) a las 00:30 UTC = 02:30 en Madrid (verano, +2).
  const aFijo = ahoraLocal('Europe/Madrid', new Date('2026-07-27T00:30:00Z'));
  ok(aFijo.fecha === '2026-07-27' && aFijo.min === 150, 'zona: 00:30 UTC → 02:30 (150 min) en Madrid en verano');
  ok(dowDeFecha('2026-07-27') === 1, '2026-07-27 es lunes (dow=1)');

  console.log('\n=== 1. geometría de la cadena de servicios (congela offsets/duración/margen) ===\n');
  const g = geometriaCadena([
    { product_id: 1, duracion_min: 60, muerto_ini_min: 15, muerto_dur_min: 30, margen_min: 5 },  // tinte: libre 15..45
    { product_id: 2, duracion_min: 30, muerto_ini_min: 0, muerto_dur_min: 0, margen_min: 10 },   // corte
  ]);
  ok(g.dur_total === 90, 'duración total = suma de duraciones (60+30=90)');
  ok(g.servicios[1].offset_min === 60, 'el 2º servicio arranca tras el 1º (offset 60)');
  ok(g.margen_min === 10, 'el margen posterior es el del ÚLTIMO servicio (limpieza al terminar)');
  ok(g.servicios[0].muerto_ini_min === 15 && g.servicios[0].muerto_dur_min === 30, 'tiempo muerto interior congelado');

  console.log('\n=== 2. huecos: horario + rejilla + margen ===\n');
  const db = nuevaBD();
  const U1 = nuevoUsuario(db, 'Ana');
  horarioNegocioLV(db);
  const F = proximoDow(3);   // un miércoles futuro
  const ahora = { fecha: ahoraLocal().fecha, min: 0, dow: dowDeFecha(ahoraLocal().fecha) };
  let hs = huecos(db, { fecha: F, user_id: U1, dur_min: 30, margen_min: 0, grid: 30, ahora });
  ok(hs.length > 0 && hs[0] === 9 * 60, 'primer hueco a las 09:00');
  ok(hs.includes(13 * 60 + 30) && !hs.includes(14 * 60), 'último hueco de mañana a las 13:30 (30 min caben antes de 14:00), no a las 14:00');
  ok(!hs.some(s => s >= 14 * 60 && s < 16 * 60), 'no hay huecos en el descanso 14:00-16:00');
  ok(hs.includes(16 * 60) && hs.includes(19 * 60 + 30), 'la tarde va de 16:00 a 19:30');
  // Rejilla 15 min
  const hs15 = huecos(db, { fecha: F, user_id: U1, dur_min: 30, grid: 15, ahora });
  ok(hs15.includes(9 * 60 + 15), 'con rejilla de 15 aparece el hueco de 09:15');
  // Margen posterior consume tiempo: dur 30 + margen 15 → el último de la mañana es 13:15.
  const hsM = huecos(db, { fecha: F, user_id: U1, dur_min: 30, margen_min: 15, grid: 15, ahora });
  ok(hsM.includes(13 * 60 + 15) && !hsM.includes(13 * 60 + 30), 'con margen 15, el último hueco de mañana cae a 13:15 (30+15 antes de 14:00)');

  console.log('\n=== 3. huecos: el tiempo muerto interior de otra cita se devuelve LIBRE ===\n');
  // Cita de Ana a las 10:00: tinte de 60 min con libre 15..45 (min 10:15..10:45).
  const geo = geometriaCadena([{ product_id: 1, duracion_min: 60, muerto_ini_min: 15, muerto_dur_min: 30, margen_min: 0 }]);
  const cId = db.prepare("INSERT INTO citas (codigo,user_id,fecha,inicio_min,dur_min,margen_min,estado) VALUES ('CITA-0001',?,?,?,?,0,'confirmada')").run(U1, F, 10 * 60, geo.dur_total).lastInsertRowid;
  for (const s of geo.servicios) db.prepare("INSERT INTO cita_servicios (cita_id,product_id,orden,offset_min,dur_min,muerto_ini_min,muerto_dur_min) VALUES (?,?,?,?,?,?,?)").run(cId, s.product_id, 0, s.offset_min, s.dur_min, s.muerto_ini_min, s.muerto_dur_min);
  const hs2 = huecos(db, { fecha: F, user_id: U1, dur_min: 30, grid: 15, ahora });
  ok(hs2.includes(10 * 60 + 15), 'un hueco de 30 min cabe DENTRO del tiempo muerto (10:15) — la persona está libre');
  ok(!hs2.includes(10 * 60) && !hs2.includes(10 * 60 + 45), 'pero NO durante el trabajo real del tinte (10:00 ni 10:45)');

  console.log('\n=== 4. guarda de solape: por PERSONA y por RECURSO ===\n');
  // Nueva cita de Ana a las 10:00 (30 min, sin tiempo muerto) pisa el trabajo real → conflicto persona.
  const s1 = comprobarSolape(db, { user_id: U1, fecha: F, inicio_min: 10 * 60, dur_min: 30, servicios: [{ offset_min: 0, dur_min: 30, muerto_ini_min: 0, muerto_dur_min: 0 }] });
  ok(!s1.ok && s1.campo === 'persona', 'cita a las 10:00 pisa el trabajo real de Ana → 409 (persona)');
  // La misma nueva cita a las 10:15, ENTERA dentro del tiempo muerto → permitida.
  const s2 = comprobarSolape(db, { user_id: U1, fecha: F, inicio_min: 10 * 60 + 15, dur_min: 30, servicios: [{ offset_min: 0, dur_min: 30, muerto_ini_min: 0, muerto_dur_min: 0 }] });
  ok(s2.ok, 'cita a las 10:15 (dentro del tiempo muerto) → permitida (tiempo muerto = única excepción de la persona)');
  // Recurso compartido: la silla sigue ocupada durante el tinte → conflicto de recurso a las 10:15.
  const R1 = db.prepare("INSERT INTO recursos (nombre,tipo) VALUES ('Silla 1','silla')").run().lastInsertRowid;
  db.prepare('UPDATE citas SET recurso_id=? WHERE id=?').run(R1, cId);
  const U2 = nuevoUsuario(db, 'Beto');
  const s3 = comprobarSolape(db, { user_id: U2, recurso_id: R1, fecha: F, inicio_min: 10 * 60 + 15, dur_min: 30, servicios: [{ offset_min: 0, dur_min: 30, muerto_ini_min: 0, muerto_dur_min: 0 }] });
  ok(!s3.ok && s3.campo === 'recurso', 'otra persona en la MISMA silla a las 10:15 → 409 (el recurso no se libera en el tiempo muerto)');
  // Al mover la propia cita, se excluye a sí misma (no se auto-solapa).
  const s4 = comprobarSolape(db, { user_id: U1, fecha: F, inicio_min: 10 * 60, dur_min: 60, servicios: geo.servicios, excludeCitaId: cId });
  ok(s4.ok, 'revalidar la propia cita en su sitio no da autosolape (excludeCitaId)');

  console.log('\n=== 5. la EXCEPCIÓN manda sobre la regla semanal ===\n');
  // Excepción de negocio: ese día CERRADO → sin huecos aunque la regla semanal abriera.
  db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,motivo) VALUES ('negocio',NULL,?,'cerrado','Festivo')").run(F);
  ok(tramosAmbito(db, 'negocio', null, F).length === 0, 'excepción cerrado → 0 tramos ese día');
  ok(huecos(db, { fecha: F, user_id: U1, dur_min: 30, grid: 15, ahora }).length === 0, 'día con excepción cerrado → 0 huecos');
  db.prepare("DELETE FROM horario_excepciones WHERE fecha=?").run(F);
  // Excepción de horario especial: solo 10:00-12:00.
  db.prepare("INSERT INTO horario_excepciones (scope,user_id,fecha,tipo,inicio_min,fin_min,motivo) VALUES ('negocio',NULL,?,'horario',?,?,'Media jornada')").run(F, 10 * 60, 12 * 60);
  const tr = tramosAmbito(db, 'negocio', null, F);
  ok(tr.length === 1 && tr[0][0] === 600 && tr[0][1] === 720, 'excepción horario reemplaza la regla semanal (solo 10:00-12:00)');

  console.log('\n=== 6. antelación mínima, ventana máxima y corte del mismo día ===\n');
  const db2 = nuevaBD(); const UU = nuevoUsuario(db2, 'Cris'); horarioNegocioLV(db2);
  // Un día hoy-mismo abierto: forzamos "ahora" a un miércoles a las 09:00 y el negocio abre ese dow.
  const hoyStr = proximoDow(3);
  const ahoraHoy = { fecha: hoyStr, min: 9 * 60, dow: 3 };
  const hsHoy = huecos(db2, { fecha: hoyStr, user_id: UU, dur_min: 30, grid: 30, ahora: ahoraHoy, antelacion_min: 60 });
  ok(!hsHoy.includes(9 * 60) && hsHoy.includes(10 * 60), 'antelación 60 min a las 09:00 → no cabe 09:00 ni 09:30, sí 10:00');
  // Ventana máxima: un día más allá de la ventana → 0 huecos.
  const lejano = new Date(Date.parse(hoyStr + 'T00:00:00Z') + 90 * 86400000).toISOString().slice(0, 10);
  ok(huecos(db2, { fecha: lejano, user_id: UU, dur_min: 30, grid: 30, ahora: ahoraHoy, ventana_dias: 30 }).length === 0, 'fecha más allá de la ventana (30 días) → 0 huecos');
  // Corte del mismo día: si ya pasó la hora de corte, no hay huecos hoy.
  const ahoraTarde = { fecha: hoyStr, min: 13 * 60, dow: 3 };
  ok(huecos(db2, { fecha: hoyStr, user_id: UU, dur_min: 30, grid: 30, ahora: ahoraTarde, corte_mismo_dia_min: 12 * 60 }).length === 0, 'pasado el corte del mismo día (12:00) → 0 huecos hoy');
  ok(huecos(db2, { fecha: hoyStr, user_id: UU, dur_min: 30, grid: 30, ahora: ahoraHoy, corte_mismo_dia_min: 12 * 60 }).length > 0, 'antes del corte, sí hay huecos hoy');

  console.log('\n=== 7. estados y sus saltos ===\n');
  ok(ESTADOS.length === 5, '5 estados: pedida, confirmada, atendida, no_show, anulada');
  ok(puedeTransicionar('pedida', 'confirmada') && puedeTransicionar('confirmada', 'atendida'), 'pedida→confirmada→atendida');
  ok(puedeTransicionar('atendida', 'anulada'), 'atendida→anulada permitido (revierte cobro; NETO-CERO)');
  ok(!puedeTransicionar('anulada', 'confirmada') && !puedeTransicionar('atendida', 'pedida'), 'no se retrocede desde anulada/atendida');

  console.log('\n=== 8. herencia de horario de la persona ===\n');
  const db3 = nuevaBD(); horarioNegocioLV(db3);
  const P1 = nuevoUsuario(db3, 'Sin horario propio');
  const P2 = nuevoUsuario(db3, 'Con horario propio');
  db3.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('user',?,3,?,?)").run(P2, 10 * 60, 13 * 60);  // solo miércoles 10-13
  const Fx = proximoDow(3);
  ok(tramosPersona(db3, P1, Fx).length === 2, 'persona SIN horario propio hereda los 2 tramos del negocio');
  const trP2 = tramosPersona(db3, P2, Fx);
  ok(trP2.length === 1 && trP2[0][0] === 600 && trP2[0][1] === 780, 'persona CON horario propio (10-13) manda, intersecado con el negocio');

  console.log('\n=== 9. sin horario configurado → día abierto por defecto (arranque sin fricción) ===\n');
  const db4 = nuevaBD();                       // BD nueva SIN ningún horario de negocio
  const UU4 = nuevoUsuario(db4, 'Nuevo');
  const F4 = proximoDow(3);
  const ahora4 = { fecha: ahoraLocal().fecha, min: 0, dow: dowDeFecha(ahoraLocal().fecha) };
  const hsDef = huecos(db4, { fecha: F4, user_id: UU4, dur_min: 30, grid: 30, ahora: ahora4 });
  ok(hsDef.length > 0 && hsDef[0] === 8 * 60, 'negocio SIN horario → hay huecos con el día abierto por defecto (primero 08:00)');
  ok(hsDef.includes(20 * 60 + 30) && !hsDef.some(s => s >= 21 * 60), 'el día por defecto llega hasta las 21:00 (último 20:30)');
  db4.prepare("INSERT INTO horario_tramos (scope,user_id,dow,inicio_min,fin_min) VALUES ('negocio',NULL,?,?,?)").run(dowDeFecha(F4), 10 * 60, 12 * 60);
  const hsConf = huecos(db4, { fecha: F4, user_id: UU4, dur_min: 30, grid: 30, ahora: ahora4 });
  ok(hsConf.length > 0 && hsConf[0] === 10 * 60 && !hsConf.some(s => s >= 12 * 60), 'al configurar horario (10-12) el default desaparece y manda lo puesto');
  let otroDow = proximoDow((dowDeFecha(F4) + 1) % 7);
  ok(huecos(db4, { fecha: otroDow, user_id: UU4, dur_min: 30, grid: 30, ahora: ahora4 }).length === 0, 'con horario ya configurado, un día sin tramos queda cerrado (no vuelve el default)');

  console.log('\n' + (fail === 0 ? '✅ TODO VERDE' : '❌ HAY FALLOS') + ` — ${pass} ok, ${fail} fallos`);
} catch (e) {
  console.error('\n💥 EXCEPCIÓN:', e);
  fail++;
} finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
}
