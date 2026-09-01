// Pruebas del barrido en los ratos muertos (bloque 4 del encargo del 1 sep 2026).
//
// Lo que se prueba aquí es lo que NO se puede comprobar mirando el código: que la pieza
// CUMPLE SUS CUATRO REGLAS. La cuarta es la que más importa y la más fácil de romper sin
// enterarse: esto no puede tumbar al daemon, así que `correrBarrido` NO LANZA NUNCA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { correrBarrido, leerResultado } from '../barrido.js';
import { redactar } from '../vigia/parte.js';

const repoFalso = (guion = null) => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'barrido-'));
  mkdirSync(path.join(raiz, 'scripts'), { recursive: true });
  if (guion !== null) writeFileSync(path.join(raiz, 'scripts', 'run-gates.mjs'), guion);
  return { repo: { raiz }, cuota: {}, vigia: { intervaloParteMs: 10800000 } };
};

test('lee del bloque «RESULTADO POR NOMBRE» qué se ejecutó y qué salió rojo', () => {
  const r = leerResultado([
    'ruido de antes',
    '──── RESULTADO POR NOMBRE (orden fijo, para comparar dos barridos) ────',
    '✅ gate-uno                              PASA',
    '❌ gate-dos                              FALLA',
    '🛑 gate-tres                             ABORTADO',
    '⚠️ gate-cuatro                           SOSPECHOSO',
    'ruido de después',
  ].join('\n'));
  assert.deepEqual(r.ejecutados, ['gate-uno', 'gate-dos', 'gate-tres', 'gate-cuatro']);
  assert.deepEqual(r.rojos.map((x) => x.gate), ['gate-dos', 'gate-tres', 'gate-cuatro']);
});

test('ante una salida que no entiende NO inventa: devuelve listas vacías', () => {
  const r = leerResultado('el formato cambió y aquí no hay nada que leer');
  assert.equal(r.ejecutados.length, 0);
  assert.equal(r.rojos.length, 0);
});

test('REGLA 4 · si no existe el script, NO lanza: lo dice y el daemon sigue', async () => {
  const r = await correrBarrido({ cfg: repoFalso(null), log: null });
  assert.equal(r.estado, 'reventado');
  assert.match(r.motivo, /no existe/);
});

test('REGLA 4 · si el barrido revienta a media salida, NO lanza: sale «reventado»', async () => {
  const cfg = repoFalso('console.log("me caigo"); process.exit(3);');
  const r = await correrBarrido({ cfg, log: null });
  assert.equal(r.estado, 'reventado');
  assert.equal(r.ejecutados.length, 0);
});

test('un barrido con rojos NO es un barrido reventado: los rojos son su veredicto', async () => {
  // run-gates sale con código != 0 cuando hay rojos. Eso es su respuesta, no una avería.
  const cfg = repoFalso(`
    console.log('──── RESULTADO POR NOMBRE ────');
    console.log('✅ gate-bueno                            PASA');
    console.log('❌ gate-malo                             FALLA');
    process.exit(1);
  `);
  const r = await correrBarrido({ cfg, log: null });
  assert.equal(r.estado, 'completo');
  assert.deepEqual(r.ejecutados, ['gate-bueno', 'gate-malo']);
  assert.deepEqual(r.rojos, [{ gate: 'gate-malo', estado: 'FALLA' }]);
});

test('REGLA 3 · el resultado sale en el parte, con lo ejecutado y lo rojo', () => {
  const parte = redactar({
    estado: { paso: 'OCIOSO', apartadas: [], historial: [] },
    cuota: { fiable: true, sesionPct: 70 },
    historialReciente: [],
    tareaEnTablero: null,
    pendientesEnTablero: [],
    desde: null,
    config: { vigia: { intervaloParteMs: 10800000 } },
    barridos: [{ estado: 'completo', ejecutados: new Array(208).fill('g'), rojos: [{ gate: 'gate-malo', estado: 'FALLA' }], segs: 1500 }],
  });
  assert.match(parte, /Comprobaciones en los ratos de espera/);
  assert.match(parte, /208 ejecutadas en 25 min/);
  assert.match(parte, /gate-malo/);
});

test('un barrido cortado se dice que se cortó, y por qué', () => {
  const parte = redactar({
    estado: { paso: 'OCIOSO', apartadas: [], historial: [] },
    cuota: { fiable: true, sesionPct: 70 },
    historialReciente: [], tareaEnTablero: null, pendientesEnTablero: [], desde: null,
    config: { vigia: { intervaloParteMs: 10800000 } },
    barridos: [{ estado: 'cortado', ejecutados: ['a'], rojos: [], segs: 120 }],
  });
  assert.match(parte, /cortado: volvió la cuota y mandó la tarea/);
});

test('sin barridos, el parte no cambia: no aparece la sección', () => {
  const parte = redactar({
    estado: { paso: 'OCIOSO', apartadas: [], historial: [] },
    cuota: { fiable: true, sesionPct: 70 },
    historialReciente: [], tareaEnTablero: null, pendientesEnTablero: [], desde: null,
    config: { vigia: { intervaloParteMs: 10800000 } },
  });
  assert.doesNotMatch(parte, /ratos de espera/);
});
