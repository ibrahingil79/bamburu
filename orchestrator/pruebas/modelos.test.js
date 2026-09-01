// Un modelo por papel, y el gasto medido papel a papel. Decisión de Ibrahin del 1 sep 2026:
// arquitecto y revisor en Opus (deciden y vigilan), programador en Sonnet (construye lo ya
// decidido). Lo que estas pruebas defienden no es la elección —ésa se cambia en el config—,
// sino que la elección LLEGUE a la llamada y se pueda MEDIR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Almacen } from '../nucleo/almacen.js';
import { Ciclo } from '../ciclo.js';
import { cargarConfig, validarConfig } from '../nucleo/config.js';
import { aplicar, estadoInicial } from '../nucleo/almacen.js';
import { repoTemporal, limpiar, configDe, registroMudo, vigilanteFalso, invocadorFalso, respuestaOk } from './ayuda.js';

const RELLENO = 'Se toca la capa de rutas siguiendo el patrón de validación que ya existe. '.repeat(20);
const ANALISIS = `# Análisis\n\n${RELLENO}\n\n## Criterios de aceptación\n\n- [ ] Existe la funcion suma y devuelve el total correcto\n- [ ] Con entrada no numerica lanza un error claro\n- [ ] Hay una prueba que cubre los dos casos\n`;
const REVISION = `✅ APROBADO\n\n| # | Criterio | ¿Cumple? | Prueba |\n|---|---|---|---|\n| 1 | Existe la funcion suma y devuelve el total correcto | SÍ | suma.js:1 |\n| 2 | Con entrada no numerica lanza un error claro | SÍ | suma.js:3 |\n| 3 | Hay una prueba que cubre los dos casos | SÍ | suma.test.js |\n`;

test('CONFIG · ningún papel hereda un modelo global: si le falta el suyo, el daemon no arranca', () => {
  // Se le quita el modelo al programador SOBRE la configuración ya cargada, no por
  // sobreescritura: `fusionar` mezcla en profundidad y no sabe quitar claves.
  const cfg = cargarConfig({ raiz: '/tmp', entorno: {} });
  delete cfg.cli.modeloPorPapel.programador;
  assert.throws(() => validarConfig(cfg), /modeloPorPapel\.programador no dice ningún modelo/);
});

test('CONFIG · y tampoco vale dejarlo en blanco', () => {
  const cfg = cargarConfig({ raiz: '/tmp', entorno: {} });
  cfg.cli.modeloPorPapel.revisor = '   ';
  assert.throws(() => validarConfig(cfg), /modeloPorPapel\.revisor no dice ningún modelo/);
});

test('CONFIG · una clave mal escrita revienta en vez de colar un papel al modelo de al lado', () => {
  assert.throws(
    () => cargarConfig({ raiz: '/tmp', entorno: {}, sobreescritura: {
      cli: { modeloPorPapel: { arquitecto: 'claude-opus-5', programadorr: 'claude-sonnet-5', programador: 'claude-sonnet-5', revisor: 'claude-opus-5' } } } }),
    /modeloPorPapel\.programadorr no es ningún papel/,
  );
});

test('cada papel llama con SU modelo, y el gasto queda desglosado por papel', async () => {
  const raiz = repoTemporal();
  try {
    const cfg0 = configDe(raiz);
    const art = (n) => path.join(cfg0.rutasAbs.artefactos, n);
    // Cada paso devuelve un coste y un tiempo distintos, para que un desglose que sume mal
    // o que le atribuya a un papel lo de otro no pueda pasar por bueno.
    const guion = [
      () => { fs.mkdirSync(cfg0.rutasAbs.artefactos, { recursive: true }); fs.writeFileSync(art('task-sumar-dos-numeros-analysis.md'), ANALISIS);
              return { ...respuestaOk('análisis'), ms: 600000, coste: 2.5 }; },
      () => { fs.writeFileSync(path.join(raiz, 'suma.js'), 'export const suma = (a, b) => a + b;\n');
              execFileSync('git', ['add', '-A'], { cwd: raiz });
              execFileSync('git', ['commit', '-qm', 'Añade suma\n\nTarea: sumar-dos-numeros'], { cwd: raiz });
              return { ...respuestaOk('construido'), ms: 300000, coste: 0.4 }; },
      () => { fs.writeFileSync(art('task-sumar-dos-numeros-review.md'), REVISION);
              return { ...respuestaOk('revisado'), ms: 400000, coste: 1.8 }; },
    ];
    const cfg = configDe(raiz);
    const almacen = new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal, rutaHistorial: cfg.rutasAbs.historial });
    const inv = invocadorFalso(guion);
    const ciclo = new Ciclo({ config: cfg, almacen, vigilante: vigilanteFalso(), logger: registroMudo(), invocador: inv });

    let estado = almacen.recuperar().estado;
    for (let i = 0; i < 12 && !(i && !estado.tarea); i++) estado = (await ciclo.unPaso(estado)).estado;

    // 1 · El modelo que pide cada llamada es el de SU papel, no el de al lado.
    const pedidos = inv.llamadas.map((l) => l.modelo);
    assert.deepEqual(pedidos, [
      cfg.cli.modeloPorPapel.arquitecto,
      cfg.cli.modeloPorPapel.programador,
      cfg.cli.modeloPorPapel.revisor,
    ]);
    assert.notEqual(cfg.cli.modeloPorPapel.programador, cfg.cli.modeloPorPapel.revisor,
      'si un día coinciden, esta prueba deja de demostrar nada: cámbiala a propósito');

    // 2 · El desglose llega al historial, con el modelo de cada papel dentro.
    const fila = almacen.leerHistorial().at(-1);
    assert.equal(fila.resultado, 'cerrada');
    assert.equal(fila.gastoPorPapel.arquitecto.costeUsd, 2.5);
    assert.equal(fila.gastoPorPapel.programador.costeUsd, 0.4);
    assert.equal(fila.gastoPorPapel.revisor.costeUsd, 1.8);
    assert.deepEqual(fila.gastoPorPapel.programador.modelos, [cfg.cli.modeloPorPapel.programador]);
    assert.equal(fila.gastoPorPapel.arquitecto.llamadas, 1);
    assert.equal(fila.gastoPorPapel.revisor.ms, 400000);
  } finally { limpiar(raiz); }
});

test('los puntos de ventana se suman TAL CUAL, negativos incluidos: la ventana es deslizante', () => {
  // Recortar a cero inflaría el total y convertiría la medición en propaganda justo cuando
  // el papel es barato, que es el caso que hay que poder demostrar al bajar de modelo.
  let e = estadoInicial();
  e = aplicar(e, { tipo: 'PAPEL_MEDIDO', papel: 'programador', modelo: 'claude-sonnet-5', ms: 1000, costeUsd: 0.2, puntos: 5 });
  e = aplicar(e, { tipo: 'PAPEL_MEDIDO', papel: 'programador', modelo: 'claude-sonnet-5', ms: 1000, costeUsd: 0.1, puntos: -2 });
  assert.equal(e.gastoPorPapel.programador.puntos, 3);
  assert.equal(e.gastoPorPapel.programador.llamadas, 2);
  assert.equal(e.gastoPorPapel.programador.costeUsd, 0.3);
});

test('una medición sin lectura de cuota no rompe el desglose: se queda sin puntos y sigue', () => {
  const e = aplicar(estadoInicial(), { tipo: 'PAPEL_MEDIDO', papel: 'revisor', modelo: 'claude-opus-5', ms: 500, costeUsd: 1, puntos: null });
  assert.equal(e.gastoPorPapel.revisor.puntos, 0);
  assert.equal(e.gastoPorPapel.revisor.costeUsd, 1);
});
