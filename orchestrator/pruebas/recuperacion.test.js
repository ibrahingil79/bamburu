// Se corta la luz en cada paso: al reanudar, ni se pierde ni se duplica trabajo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Almacen, estadoInicial, escribirAtomico, leerLineas } from '../nucleo/almacen.js';
import { PASOS } from '../nucleo/maquina.js';

function almacenTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-estado-'));
  return {
    dir,
    nuevo: () => new Almacen({
      rutaEstado: path.join(dir, 'estado.json'),
      rutaJournal: path.join(dir, 'journal.ndjson'),
      rutaHistorial: path.join(dir, 'historial.ndjson'),
    }),
    limpiar: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const TAREA = { id: 't1', titulo: 'Tarea uno', descripcion: 'd', criterios: [], origen: 'bloque' };

test('un corte en CUALQUIER paso se retoma en ese mismo paso', () => {
  const a = almacenTemporal();
  try {
    for (const paso of [PASOS.ANALISIS, PASOS.VALIDAR_ANALISIS, PASOS.CONSTRUCCION,
                        PASOS.VALIDAR_CODIGO, PASOS.REVISION, PASOS.VALIDAR_REVISION, PASOS.CIERRE]) {
      const alm = a.nuevo();
      let e = alm.recuperar().estado;
      e = alm.transicion(e, { tipo: 'TAREA_TOMADA', tarea: TAREA, cuota: 10 });
      e = alm.transicion(e, { tipo: 'PASO_INICIADO', paso });

      // ── se va la luz: proceso nuevo, se recupera de disco ──
      const otro = a.nuevo();
      const r = otro.recuperar();
      assert.equal(r.estado.paso, paso, `debería retomar en ${paso}`);
      assert.equal(r.estado.tarea.id, 't1');
      fs.rmSync(a.dir, { recursive: true, force: true });
      fs.mkdirSync(a.dir, { recursive: true });
    }
  } finally { a.limpiar(); }
});

test('si el corte pilla entre el journal y la instantánea, gana el journal', () => {
  const a = almacenTemporal();
  try {
    const alm = a.nuevo();
    let e = alm.recuperar().estado;
    e = alm.transicion(e, { tipo: 'TAREA_TOMADA', tarea: TAREA, cuota: 10 });

    // Simula el corte: la instantánea se queda ATRÁS, el journal tiene el evento nuevo.
    const rutaEstado = path.join(a.dir, 'estado.json');
    const vieja = JSON.parse(fs.readFileSync(rutaEstado, 'utf8'));
    escribirAtomico(path.join(a.dir, 'journal.ndjson'),
      fs.readFileSync(path.join(a.dir, 'journal.ndjson'), 'utf8') +
      JSON.stringify({ seq: vieja.seq + 1, tipo: 'PASO_INICIADO', paso: PASOS.REVISION, cuando: 'x' }) + '\n');

    const r = a.nuevo().recuperar();
    assert.equal(r.eventosAplicados, 1, 'aplica el evento que la instantánea no tenía');
    assert.equal(r.estado.paso, PASOS.REVISION);
  } finally { a.limpiar(); }
});

test('una instantánea corrupta se reconstruye entera desde el journal', () => {
  const a = almacenTemporal();
  try {
    const alm = a.nuevo();
    let e = alm.recuperar().estado;
    e = alm.transicion(e, { tipo: 'TAREA_TOMADA', tarea: TAREA, cuota: 10 });
    e = alm.transicion(e, { tipo: 'PASO_INICIADO', paso: PASOS.CONSTRUCCION });
    e = alm.transicion(e, { tipo: 'BASE_FIJADA', base: 'deadbeef' });

    fs.writeFileSync(path.join(a.dir, 'estado.json'), '{ esto no es json', 'utf8');

    const r = a.nuevo().recuperar();
    assert.ok(r.reconstruido);
    assert.equal(r.estado.paso, PASOS.CONSTRUCCION);
    assert.equal(r.estado.base, 'deadbeef');
  } finally { a.limpiar(); }
});

test('una línea del journal partida por el corte no invalida el resto', () => {
  const a = almacenTemporal();
  try {
    const alm = a.nuevo();
    let e = alm.recuperar().estado;
    e = alm.transicion(e, { tipo: 'TAREA_TOMADA', tarea: TAREA, cuota: 10 });
    fs.appendFileSync(path.join(a.dir, 'journal.ndjson'), '{"seq":99,"tipo":"PASO_INI');  // a medias
    fs.rmSync(path.join(a.dir, 'estado.json'));

    const r = a.nuevo().recuperar();
    assert.equal(r.estado.tarea.id, 't1', 'lo anterior a la línea rota se conserva');
  } finally { a.limpiar(); }
});

test('la escritura atómica no deja el fichero a medias', () => {
  const a = almacenTemporal();
  try {
    const ruta = path.join(a.dir, 'x.json');
    escribirAtomico(ruta, JSON.stringify({ a: 1 }));
    escribirAtomico(ruta, JSON.stringify({ a: 2 }));
    assert.deepEqual(JSON.parse(fs.readFileSync(ruta, 'utf8')), { a: 2 });
    // Y no queda basura de temporales.
    assert.equal(fs.readdirSync(a.dir).filter((f) => f.includes('.tmp')).length, 0);
  } finally { a.limpiar(); }
});

test('el historial sobrevive aunque se borre el estado', () => {
  const a = almacenTemporal();
  try {
    const alm = a.nuevo();
    alm.registrarHistorial({ id: 't1', titulo: 'Tarea uno', resultado: 'cerrada', intentos: 2 });
    fs.rmSync(path.join(a.dir, 'estado.json'), { force: true });
    fs.rmSync(path.join(a.dir, 'journal.ndjson'), { force: true });
    const filas = a.nuevo().leerHistorial();
    assert.equal(filas.length, 1);
    assert.equal(filas[0].titulo, 'Tarea uno');
  } finally { a.limpiar(); }
});
