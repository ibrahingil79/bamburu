// LA AVERÍA DE LA NOCHE DEL 1 AL 2 DE SEPTIEMBRE, y lo que la prueba de ayer NO miraba.
//
// Ayer se verificó el camino de la firma de punta a punta y pasó. Se rompió al primer uso real.
// La diferencia no estaba en el código: estaba en DE DÓNDE SALÍA EL ESTADO. La prueba arrancaba
// sobre un repo de usar y tirar, sin fichero de estado, así que el estado nacía de
// `estadoInicial()` — que SÍ tiene `firmasPendientes`. En producción el estado venía de un
// fichero escrito DÍAS ANTES de que ese campo existiera, y `version` seguía siendo 1 porque la
// forma no había cambiado: solo se había añadido algo. Mismo código, dos formas distintas de
// estado, y solo una de ellas tenía el campo.
//
// Estas pruebas ejercitan la que producción usa de verdad: la vieja.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Almacen, estadoInicial, aplicar, VERSION_ESTADO } from '../nucleo/almacen.js';
import { frenoDeVueltasRotas } from '../bucle.js';

function almacenConEstadoViejo(quitar) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-viejo-'));
  const viejo = { ...estadoInicial(), version: VERSION_ESTADO, seq: 5, paso: 'VALIDAR_REVISION' };
  for (const campo of quitar) delete viejo[campo];       // el fichero de antes de que existiera
  fs.writeFileSync(path.join(dir, 'estado.json'), JSON.stringify(viejo));
  return { dir, almacen: new Almacen({ rutaEstado: path.join(dir, 'estado.json'),
    rutaJournal: path.join(dir, 'journal.ndjson'), rutaHistorial: path.join(dir, 'hist.ndjson') }) };
}

test('un estado guardado ANTES de que existiera un campo se lee con ese campo puesto', () => {
  const { almacen } = almacenConEstadoViejo(['firmasPendientes', 'gastoPorPapel']);
  const e = almacen.recuperar().estado;
  assert.deepEqual(e.firmasPendientes, [], 'el campo que faltaba sale con su valor por defecto');
  assert.deepEqual(e.gastoPorPapel, {});
  assert.equal(e.seq, 5, 'y lo que SÍ traía el fichero se respeta');
  assert.equal(e.paso, 'VALIDAR_REVISION');
});

test('pedir la firma sobre un estado viejo NO revienta — es la avería exacta', () => {
  // `Cannot read properties of undefined (reading 'filter')`: 381 vueltas en 6 horas.
  const { almacen } = almacenConEstadoViejo(['firmasPendientes']);
  let e = almacen.recuperar().estado;
  e = aplicar(e, { tipo: 'FIRMA_PEDIDA', id: 'x', titulo: 'Una tarea', rama: 'tarea/x',
                   promesa: 'algo', cuando: '2026-09-02T05:00:00.000Z' });
  assert.equal(e.firmasPendientes.length, 1);
  assert.equal(e.firmasPendientes[0].id, 'x');
});

test('y el reductor aguanta la lista ausente aunque nadie haya rellenado los defectos', () => {
  // Cinturón además de tirantes: `aplicar` es pura y se la puede llamar con lo que sea.
  const pelado = { ...estadoInicial() };
  delete pelado.firmasPendientes; delete pelado.apartadas; delete pelado.historial;
  assert.doesNotThrow(() => aplicar(pelado, { tipo: 'FIRMA_PEDIDA', id: 'x', titulo: 'T', rama: 'r', cuando: 'c' }));
  assert.doesNotThrow(() => aplicar(pelado, { tipo: 'FIRMA_RESUELTA', id: 'x' }));
  assert.doesNotThrow(() => aplicar({ ...pelado, tarea: { id: 'a', titulo: 'A' } },
    { tipo: 'TAREA_APARTADA', motivo: 'm', cuando: 'c' }));
  assert.doesNotThrow(() => aplicar(pelado, { tipo: 'VEREDICTO', veredicto: 'rechazado', cuando: 'c' }));
});

// ── El freno: fallar tres veces en el mismo sitio no es mala suerte ───────────
test('tres vueltas rotas EN EL MISMO PASO y por lo mismo → se planta', () => {
  let f = frenoDeVueltasRotas({ paso: 'VALIDAR_REVISION', mensaje: 'boom', huellaPrevia: null, tope: 3 });
  assert.equal(f.plantarse, false);
  f = frenoDeVueltasRotas({ paso: 'VALIDAR_REVISION', mensaje: 'boom', huellaPrevia: f.huella, seguidas: f.seguidas, tope: 3 });
  assert.equal(f.plantarse, false);
  f = frenoDeVueltasRotas({ paso: 'VALIDAR_REVISION', mensaje: 'boom', huellaPrevia: f.huella, seguidas: f.seguidas, tope: 3 });
  assert.equal(f.plantarse, true, 'a la tercera se planta: 381 vueltas no vuelven a pasar');
});

test('fallos DISTINTOS no se acumulan: aguantar un tropiezo suelto sigue estando bien', () => {
  let f = frenoDeVueltasRotas({ paso: 'REVISION', mensaje: 'git tardó', huellaPrevia: null, tope: 3 });
  f = frenoDeVueltasRotas({ paso: 'REVISION', mensaje: 'otra cosa', huellaPrevia: f.huella, seguidas: f.seguidas, tope: 3 });
  assert.equal(f.seguidas, 1, 'el contador se reinicia con cada fallo nuevo');
  // Y el mismo mensaje en OTRO paso tampoco cuenta: son dos incidencias, no una que no se cura.
  const g = frenoDeVueltasRotas({ paso: 'CONSTRUCCION', mensaje: 'otra cosa', huellaPrevia: f.huella, seguidas: f.seguidas, tope: 3 });
  assert.equal(g.seguidas, 1);
});
