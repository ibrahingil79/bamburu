// Las reglas difíciles del encargo. Todas contra la máquina PURA: sin CLI, sin red, sin disco.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decidir, alcanzaParaCiclo, ACCIONES, PASOS } from '../nucleo/maquina.js';
import { estadoInicial, aplicar } from '../nucleo/almacen.js';

const CONFIG = {
  cuota: { minimoParaCicloPct: 25, margenReservadoPct: 20, minimoSemanalPct: 10, esperaSinCuotaMs: 900000,
           ultimoValorValidoMs: 1200000, margenCiegoPct: 15, esperaSinLecturaMs: 60000 },
  ciclo: { maxIntentosRevision: 3, maxReplanteos: 1, maxFallosTecnicosPorPaso: 3, intervaloVueltaMs: 60000 },
};
const TAREA = { id: 't1', titulo: 'Tarea uno', descripcion: 'algo', criterios: [], origen: 'bloque' };
const holgada = { fiable: true, sesionPct: 10, semanaPct: 5 };

function conEstado(cambios) { return { ...estadoInicial(), ...cambios }; }

test('sin cuota fiable NI lectura reciente de la que tirar, NO arranca', () => {
  const d = decidir({ estado: estadoInicial(), cuota: { fiable: false }, tareaDisponible: TAREA, config: CONFIG });
  assert.equal(d.tipo, ACCIONES.ESPERAR_CUOTA);
  assert.ok(d.desconocida);
});

// ── No poder LEER la cuota no es lo mismo que no TENERLA ──────────────────────
// El 1 sep 2026 esto era una sola regla —«no lo sé, me planto»— y con ella el orquestador
// pasó cinco minutos quieto con un 32 % disponible por UNA lectura ilegible. La mitad buena
// se conserva (no se arranca a ciegas); lo que cambia es qué cuenta como ciego.

test('no poder leerla NO es quedarse quieto: con lectura reciente y holgada, tira con ella', () => {
  const cuota = { fiable: false, ultimaFiable: { sesionPct: 20, semanaPct: 5, edadMs: 3 * 60000 } };
  const v = alcanzaParaCiclo(cuota, CONFIG);
  assert.equal(v.alcanza, true);
  assert.ok(v.aCiegas, 'y queda marcado que se tiró sin lectura del momento');
  const d = decidir({ estado: estadoInicial(), cuota, tareaDisponible: TAREA, config: CONFIG });
  assert.equal(d.tipo, ACCIONES.TOMAR_TAREA);
  assert.ok(d.cuotaACiegas, 'gastar cuota sin haberla comprobado NO viaja en silencio');
});

test('un dato viejo se paga con holgura: lo justo NO basta para arrancar sin leer', () => {
  // Queda 45%: pasaría de sobra con una lectura del momento (45-20=25), y NO pasa sin ella,
  // porque el margen ciego exige 15 puntos más. Es el precio de no haber podido mirar.
  const cuota = { fiable: false, ultimaFiable: { sesionPct: 55, semanaPct: 5, edadMs: 3 * 60000 } };
  assert.equal(alcanzaParaCiclo({ fiable: true, sesionPct: 55, semanaPct: 5 }, CONFIG).alcanza, true);
  const v = alcanzaParaCiclo(cuota, CONFIG);
  assert.equal(v.alcanza, false);
  assert.ok(v.desconocida);
  assert.match(v.motivo, /15% extra por ir con un dato viejo/);
});

test('una lectura vieja no dice nada de ahora: pasado el plazo, no autoriza nada', () => {
  const cuota = { fiable: false, ultimaFiable: { sesionPct: 5, semanaPct: 5, edadMs: 61 * 60000 } };
  const v = alcanzaParaCiclo(cuota, CONFIG);
  assert.equal(v.alcanza, false);
  assert.match(v.motivo, /no tengo lectura reciente/);
});

test('esperar por NO SABER es una espera corta y con plazo, no el sondeo de la ventana', () => {
  // La avería no era esperar: era esperar 15 minutos a que se reiniciara una ventana que no
  // tenía nada roto, cuando lo que faltaba era una lectura de dos segundos y cero tokens.
  const d = decidir({ estado: estadoInicial(), cuota: { fiable: false }, tareaDisponible: TAREA, config: CONFIG });
  assert.equal(d.esperaMs, CONFIG.cuota.esperaSinLecturaMs);
  assert.ok(d.esperaMs < CONFIG.cuota.esperaSinCuotaMs);
});

test('sin cuota DE VERDAD se sigue durmiendo hasta el reinicio: eso no ha cambiado', () => {
  const ahora = Date.UTC(2026, 8, 1, 12, 0, 0);
  const d = decidir({ estado: estadoInicial(), tareaDisponible: TAREA, config: CONFIG, ahora,
    cuota: { fiable: true, sesionPct: 99, semanaPct: 5, reinicioSesion: 'Sep 1, 12:05pm (UTC)',
             reinicioSesionMs: ahora + 5 * 60000 } });
  assert.equal(d.tipo, ACCIONES.ESPERAR_CUOTA);
  assert.equal(d.desconocida, false);
  assert.equal(d.esperaMs, 5 * 60000 + 60000);
});

test('respeta el margen reservado para el chat de Ibrahin', () => {
  // Queda 30% libre; reservando 20% quedan 10 utilizables y hacen falta 25.
  const v = alcanzaParaCiclo({ fiable: true, sesionPct: 70, semanaPct: 0 }, CONFIG);
  assert.equal(v.alcanza, false);
  assert.match(v.motivo, /reservando 20%/);
});

test('con cuota de sobra sí arranca', () => {
  assert.equal(alcanzaParaCiclo(holgada, CONFIG).alcanza, true);
  const d = decidir({ estado: estadoInicial(), cuota: holgada, tareaDisponible: TAREA, config: CONFIG });
  assert.equal(d.tipo, ACCIONES.TOMAR_TAREA);
});

test('la ventana semanal también frena', () => {
  const v = alcanzaParaCiclo({ fiable: true, sesionPct: 0, semanaPct: 95 }, CONFIG);
  assert.equal(v.alcanza, false);
  assert.match(v.motivo, /semanal/);
});

test('un análisis SIN criterios de aceptación se repite, no pasa', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_ANALISIS, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { analisis: { valido: false, motivos: ['NO TRAE CRITERIOS DE ACEPTACIÓN'] } } });
  assert.equal(d.tipo, ACCIONES.EJECUTAR);
  assert.equal(d.papel, 'arquitecto');
  assert.ok(d.rehacer);
  assert.match(d.motivos[0], /CRITERIOS/);
});

test('el arquitecto para SIN decir de qué clase: se aparta, pero NO se llama decisión de producto', () => {
  // ⚙️ ESTA PRUEBA AFIRMABA EL DEFECTO (corregida el 1 sep 2026). Decía `assert.ok(d.decisionDeProducto)`
  // para CUALQUIER parada del arquitecto, y ése era exactamente el fallo: el aviso al móvil de
  // Ibrahin decía «es una decisión de producto» fuese verdad o no. Ese día se mandó dos veces y las
  // dos fueron falsas. Una parada sin clasificar sube a Ibrahin —por si acaso—, pero NO se le
  // vende como una decisión suya.
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_ANALISIS, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { analisis: { valido: false, paroArquitecto: true, clase: 'sin-clasificar',
                       motivos: ['toca Capa 2, congelada'] } } });
  assert.equal(d.tipo, ACCIONES.APARTAR);
  assert.equal(d.clase, 'sin-clasificar');
  assert.equal(d.decisionDeProducto, false, 'sin clasificar NO es «decisión de producto»');
});

test('una PREMISA FALSA con su prueba se cierra sola: no le roba una interrupción a Ibrahin', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_ANALISIS, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { analisis: { valido: false, paroArquitecto: true, clase: 'premisa-falsa',
                       prueba: 'git ls-files no devuelve ninguno de los seis; tampoco están en HEAD',
                       motivos: ['los seis ficheros se retiraron el 24 ago 2026'] } } });
  assert.equal(d.tipo, ACCIONES.CERRAR_PREMISA_FALSA);
  assert.match(d.prueba, /git ls-files/, 'la prueba viaja con la decisión: se escribe en el tablero');
});

test('una PREMISA FALSA SIN prueba NO se cierra sola: sube, que es el camino que no destruye nada', () => {
  // Cerrar una tarea sola es irreversible en la práctica —nadie vuelve a mirar lo que se cerró—,
  // así que el error seguro es escalar de más, nunca cerrar de más.
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_ANALISIS, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { analisis: { valido: false, paroArquitecto: true, clase: 'premisa-falsa', prueba: null,
                       motivos: ['creo que ya está hecho'] } } });
  assert.equal(d.tipo, ACCIONES.APARTAR, 'sin prueba no se cierra nada');
  assert.equal(d.decisionDeProducto, false);
});

test('una DECISIÓN DE IBRAHIN sí sube, y lleva la pregunta con ella', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_ANALISIS, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { analisis: { valido: false, paroArquitecto: true, clase: 'decision-de-ibrahin',
                       pregunta: '¿Cuántos días sigue funcionando el programa cuando caduca la tarjeta?',
                       motivos: ['no está escrito qué pasa al caducar la tarjeta'] } } });
  assert.equal(d.tipo, ACCIONES.APARTAR);
  assert.equal(d.decisionDeProducto, true);
  assert.match(d.pregunta, /cuántos días/i, 'la pregunta llega hasta el aviso: es lo único que hay que contestar');
});

test('un rechazo vuelve al programador con el motivo', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_REVISION, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { revision: { veredicto: 'rechazado', motivos: ['CRITERIO-INCUMPLIDO: falta validar'] } } });
  assert.equal(d.tipo, ACCIONES.REINTENTAR);
  assert.equal(d.intentoSiguiente, 2);
});

test('TRES rechazos disparan REPLANTEAMIENTO, no un cuarto intento igual', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_REVISION, intento: 3, replanteos: 0 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { revision: { veredicto: 'rechazado', motivos: ['otra vez lo mismo'] } } });
  assert.equal(d.tipo, ACCIONES.REPLANTEAR);
});

test('replanteada y vuelve a fallar: se APARTA y el sistema sigue', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_REVISION, intento: 3, replanteos: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { revision: { veredicto: 'rechazado', motivos: ['sigue sin salir'] } } });
  assert.equal(d.tipo, ACCIONES.APARTAR);
  assert.ok(d.decisionDeProducto, 'se avisa como decisión de producto, no como error técnico');
});

test('una revisión ilegible NO consume intento del ciclo', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_REVISION, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG,
    obs: { revision: { veredicto: null, motivos: ['sin veredicto legible'] } } });
  assert.equal(d.tipo, ACCIONES.EJECUTAR);
  assert.equal(d.papel, 'revisor');
  assert.ok(d.rehacer);
});

test('aprobado cierra', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.VALIDAR_REVISION, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG, obs: { revision: { veredicto: 'aprobado' } } });
  assert.equal(d.tipo, ACCIONES.CERRAR);
});

test('una subida pendiente se reintenta ANTES de coger tarea nueva', () => {
  const e = conEstado({ subidaPendiente: true });
  const d = decidir({ estado: e, cuota: holgada, tareaDisponible: TAREA, config: CONFIG });
  assert.equal(d.tipo, ACCIONES.REINTENTAR_SUBIDA);
});

test('sin cuota a mitad de tarea se espera EN EL PASO, sin perder nada', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.CONSTRUCCION, intento: 2, base: 'abc123' });
  const d = decidir({ estado: e, cuota: { fiable: true, sesionPct: 95, semanaPct: 5 }, config: CONFIG });
  assert.equal(d.tipo, ACCIONES.ESPERAR_CUOTA);
  // Lo que importa: el estado NO se toca, así que al volver se retoma en CONSTRUCCION con intento 2.
  assert.equal(e.paso, PASOS.CONSTRUCCION);
  assert.equal(e.intento, 2);
  assert.equal(e.base, 'abc123');
});

test('el reductor reconstruye el mismo estado desde el journal', () => {
  const eventos = [
    { seq: 1, tipo: 'ARRANCADO', cuando: 'x' },
    { seq: 2, tipo: 'TAREA_TOMADA', tarea: TAREA, cuota: 12, cuando: 'x' },
    { seq: 3, tipo: 'BASE_FIJADA', base: 'abc' },
    { seq: 4, tipo: 'VEREDICTO', veredicto: 'rechazado', motivos: ['m1'], cuando: 'x' },
    { seq: 5, tipo: 'REINTENTO', cuando: 'x' },
  ];
  const e = eventos.reduce(aplicar, estadoInicial());
  assert.equal(e.tarea.id, 't1');
  assert.equal(e.intento, 2);
  assert.equal(e.historial.length, 1);
  assert.equal(e.cuotaInicio, 12);
  // La base se suelta a propósito al reintentar: el intento nuevo se mide desde HEAD, para
  // que los commits del anterior no cuenten y el programador tenga que entregar algo nuevo.
  assert.equal(e.base, null);
});

test('un paso cuyo artefacto ya vale NO se vuelve a pagar', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.ANALISIS, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG, obs: { analisis: { valido: true } } });
  assert.equal(d.tipo, ACCIONES.SALTAR, 'manda el artefacto: no se repite el análisis');
  assert.equal(d.paso, PASOS.VALIDAR_ANALISIS);
});

test('sin artefacto válido, el paso sí se ejecuta', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.ANALISIS, intento: 1 });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG, obs: { analisis: { valido: false } } });
  assert.equal(d.tipo, ACCIONES.EJECUTAR);
  assert.equal(d.papel, 'arquitecto');
});

test('el programador no se repite a ciegas si ya hay commits válidos', () => {
  const e = conEstado({ tarea: TAREA, paso: PASOS.CONSTRUCCION, intento: 1, base: 'abc' });
  const d = decidir({ estado: e, cuota: holgada, config: CONFIG, obs: { codigo: { valido: true } } });
  assert.equal(d.tipo, ACCIONES.SALTAR);
  assert.equal(d.paso, PASOS.VALIDAR_CODIGO);
});
