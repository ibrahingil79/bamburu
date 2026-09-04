// El vigía nunca puede parar el ciclo, y el parte nunca se pierde.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactar, redactarApartada, entregar } from '../vigia/parte.js';
import { estadoInicial } from '../nucleo/almacen.js';
import { leerLineas } from '../nucleo/almacen.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-vigia-'));
// ⚙️ ESTE REMEDO LLEVA LOS UMBRALES DE CUOTA DE VERDAD (1 sep 2026). Llevaba solo la sección
// `vigia`, y el día que el parte necesitó saber CUÁL de las dos ventanas frena —para no prometer
// una hora de reinicio que no desbloquea nada— reventó con «cannot read margenReservadoPct».
// Un remedio de configuración que no se parece a la configuración solo prueba el remedio.
const CONFIG = {
  vigia: { activo: true, intervaloParteMs: 10800000,
           telegram: { tokenEnv: 'TG_TOKEN', chatIdEnv: 'TG_CHAT', timeoutMs: 5000, maxPendientes: 50 } },
  cuota: { minimoParaCicloPct: 15, margenReservadoPct: 10, minimoSemanalPct: 10,
           esperaSinCuotaMs: 900000, margenTrasReinicioMs: 60000 },
  rutasAbs: { partesPendientes: path.join(dir, 'pendientes.ndjson') },
};
const mudo = { info() {}, aviso() {}, error() {}, exito() {} };

test('sin configurar, el parte se GUARDA y no revienta nada', async () => {
  fs.rmSync(CONFIG.rutasAbs.partesPendientes, { force: true });
  const r = await entregar({ texto: 'parte 1', config: CONFIG, entorno: {}, logger: mudo });
  assert.equal(r.ok, false);
  assert.equal(r.guardado, true);
  assert.equal(leerLineas(CONFIG.rutasAbs.partesPendientes).length, 1);
});

test('los partes se acumulan mientras no se pueden entregar', async () => {
  await entregar({ texto: 'parte 2', config: CONFIG, entorno: {}, logger: mudo });
  await entregar({ texto: 'parte 3', config: CONFIG, entorno: {}, logger: mudo });
  const cola = leerLineas(CONFIG.rutasAbs.partesPendientes);
  assert.equal(cola.length, 3);
  assert.equal(cola[0].texto, 'parte 1', 'se conserva el orden');
});


test('el parte dice lo que tiene que decir, en español y sin jerga', () => {
  const estado = { ...estadoInicial(),
    tarea: { id: 't1', titulo: 'Aislar bloqueos SQLite' }, paso: 'CONSTRUCCION',
    pasoDesde: new Date(Date.now() - 20 * 60000).toISOString(), intento: 2,
    apartadas: [{ id: 't0', titulo: 'Cosa imposible', motivo: 'no sale tras replantear' }],
    subidaPendiente: true, ultimoFalloSubida: { motivo: 'sin red' } };
  const texto = redactar({
    estado, cuota: { fiable: true, sesionPct: 40, semanaPct: 12, reinicioSesion: 'a las 21:50' },
    historialReciente: [{ titulo: 'Tarea previa', resultado: 'cerrada', intentos: 3, replanteos: 1 }],
    tareaEnTablero: { titulo: 'La siguiente' }, desde: { sesionPct: 25 }, config: CONFIG,
  });
  assert.match(texto, /Tarea previa/);
  assert.match(texto, /2 rechazo\(s\) corregido\(s\) y 1 replanteamiento/);
  assert.match(texto, /Aislar bloqueos SQLite/);
  assert.match(texto, /construyendo/);
  assert.match(texto, /La siguiente/);
  assert.match(texto, /Cosa imposible/);
  assert.match(texto, /15 puntos/);        // 40 - 25
  assert.match(texto, /Queda 60% de la ventana corta/);
  assert.match(texto, /sin subir/);
  assert.ok(!/undefined|NaN|\[object/.test(texto), 'nada de basura técnica en el parte');
});

test('si está parado por cuota, el parte lo dice y dice desde cuándo', () => {
  const estado = { ...estadoInicial(), esperandoCuota: true,
    esperaDesde: new Date(Date.now() - 90 * 60000).toISOString(),
    tarea: { id: 't1', titulo: 'Aislar bloqueos' }, paso: 'CONSTRUCCION' };
  const texto = redactar({ estado, cuota: { fiable: true, sesionPct: 99, semanaPct: 20, reinicioSesion: 'a las 21:50' },
    historialReciente: [], tareaEnTablero: null, desde: null, config: CONFIG });
  assert.match(texto, /Parado esperando cuota/);
  assert.match(texto, /hace 1 h 30 min/);
  assert.match(texto, /21:50/);
  assert.match(texto, /queda a medio hacer, en: construyendo/, 'dice DÓNDE se quedó, que es lo que importa');
});

test('si no se pudo leer la cuota, lo dice en vez de inventarse un número', () => {
  const texto = redactar({ estado: estadoInicial(), cuota: { fiable: false, motivo: 'no respondió' },
    historialReciente: [], tareaEnTablero: null, desde: null, config: CONFIG });
  assert.match(texto, /No he podido leerla/);
});

test('el aviso de una DECISIÓN lleva la pregunta arriba y el motivo ENTERO', () => {
  // ⚙️ 4.1 DEL ENCARGO DEL 1 SEP 2026. El aviso decía «el arquitecto declaró la tarea mal
  // planteada» y se quedaba ahí: lo que el arquitecto había ENCONTRADO viajaba en `detalle` y
  // nadie lo pasaba a esta función. Con eso Ibrahin no podía decidir desde el móvil — tenía que
  // entrar al servidor a leer el análisis para enterarse de qué le preguntaban.
  const texto = redactarApartada({
    tarea: { titulo: 'Ciclo de suscripción', descripcion: 'alta, cobro, tarjeta caducada' },
    motivo: 'el tablero no dice qué pasa cuando a un cliente le caduca la tarjeta',
    clase: 'decision-de-ibrahin',
    pregunta: '¿Cuántos días sigue funcionando el programa cuando le caduca la tarjeta a un cliente?',
    detalle: ['el tablero no dice qué pasa cuando a un cliente le caduca la tarjeta',
              'sin eso no se puede escribir el criterio de HECHO'],
    historial: [{ intento: 1, veredicto: 'rechazado', motivos: ['falta validar'] }],
  });
  assert.match(texto, /necesita una decisión tuya/);
  assert.match(texto, /Cuántos días sigue funcionando/, 'la pregunta, que es lo único que hay que contestar');
  assert.match(texto, /le caduca la tarjeta/, 'y el motivo ENTERO, no solo «mal planteada»');
  assert.match(texto, /sin eso no se puede escribir el criterio/, 'y lo demás que dejó escrito');
  assert.match(texto, /solo puedes tomar tú/i);

  // La pregunta va ANTES del cuerpo: en una pantalla de móvil, lo que va al final no se lee.
  assert.ok(texto.indexOf('Cuántos días') < texto.indexOf('Qué se pidió'));
});

test('una parada SIN clasificar NO se le vende a Ibrahin como decisión suya', () => {
  // La frase «No es un error técnico: es una decisión de producto» salía SIEMPRE. El 1 sep 2026 se
  // mandó dos veces y las dos fueron falsas: las seis pantallas llevaban ocho días borradas y el
  // cifrado estaba mal redactado. Ahora, si el arquitecto no dijo de qué clase es, el aviso lo dice.
  const texto = redactarApartada({
    tarea: { titulo: 'Retirar seis pantallas', descripcion: 'seis ficheros sin montar' },
    motivo: 'no encuentro los ficheros que dice la tarea',
    clase: 'sin-clasificar',
    historial: [],
  });
  assert.doesNotMatch(texto, /es una decisión de producto/,
    'no se puede afirmar que sea una decisión suya cuando nadie lo ha dicho');
  assert.match(texto, /no sé de qué clase es/);
  assert.match(texto, /entrada caducada del tablero/, 'y se le avisa de que puede no ser cosa suya');
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('el parte sobrevive a un reinicio: lee el historial del DISCO, no de memoria', async () => {
  // Era el motivo del único criterio en NO de la autorrevisión: systemd reinicia el daemon y
  // el parte siguiente decía «nada nuevo» aunque se hubieran cerrado tareas.
  const { Almacen } = await import('../nucleo/almacen.js');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-parte-'));
  try {
    const alm = new Almacen({ rutaEstado: path.join(d, 'e.json'), rutaJournal: path.join(d, 'j.ndjson'), rutaHistorial: path.join(d, 'h.ndjson') });
    // Fechas explícitas: si se dejan al reloj, los dos registros caen en el mismo
    // milisegundo y la prueba mide la resolución del reloj, no el filtro.
    alm.registrarHistorial({ cuando: '2026-08-31T10:00:00.000Z', id: 't1', titulo: 'Tarea vieja', resultado: 'cerrada', intentos: 1, replanteos: 0 });
    const corte = '2026-08-31T12:00:00.000Z';
    alm.registrarHistorial({ cuando: '2026-08-31T14:00:00.000Z', id: 't2', titulo: 'Tarea nueva', resultado: 'cerrada', intentos: 3, replanteos: 1 });

    // Proceso NUEVO: nada en memoria. Solo el disco.
    const otro = new Almacen({ rutaEstado: path.join(d, 'e.json'), rutaJournal: path.join(d, 'j.ndjson'), rutaHistorial: path.join(d, 'h.ndjson') });
    const recientes = otro.leerHistorial().filter((h) => h.cuando >= corte);

    assert.equal(recientes.length, 1, 'filtra por fecha: solo lo posterior al último parte');
    const texto = redactar({ estado: estadoInicial(), cuota: { fiable: true, sesionPct: 30, semanaPct: 5 },
      historialReciente: recientes, tareaEnTablero: null, desde: null, config: CONFIG });
    assert.match(texto, /Tarea nueva/, 'el parte la nombra aunque el daemon se haya reiniciado');
    assert.ok(!/Tarea vieja/.test(texto), 'y no repite lo que ya se contó');
    assert.match(texto, /2 rechazo\(s\) corregido\(s\) y 1 replanteamiento/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
