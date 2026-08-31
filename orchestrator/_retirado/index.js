#!/usr/bin/env node
// index.js — Orquestador de tareas de Bamburu. Punto de entrada y orquestación.
//
//   npm run orchestrate                    ejecuta la tarea siguiente, con pausas
//   npm run orchestrate --dry-run          simula, sin escribir nada
//   npm run orchestrate --task=mi-tarea    ejecuta una tarea concreta
//
// Sin dependencias externas: solo fs, path, child_process y readline.

import fs from 'node:fs';
import path from 'node:path';
import {
  RAIZ, leerTablero, buscarSiguienteTarea, buscarTareaPorId,
  esRepo, cabeza, rama, arbolSucio, commitsDesde, resolver,
} from './reader.js';
import { crearRegistro, pausa, promptArquitecto, promptProgramador, promptRevision } from './dispatcher.js';
import { pareceSinSaldo } from './token-monitor.js';
import { validarAnalisis, validarCodigo, validarReview } from './validator.js';
import { crearAnalisisVacio, marcarHecha, escribirFeedback } from './updater.js';

const AYUDA = `
Orquestador de tareas de Bamburu

  npm run orchestrate                      daemon: da vueltas hasta que lo paren
  npm run orchestrate:once                 una sola tarea y termina
  npm run orchestrate -- --dry-run         simula, sin escribir
  npm run orchestrate -- --task=<id>       una tarea concreta, por su id (implica --once)

  Modo: daemon salvo que se pida --once o --task=<id>.

  Opciones (con npm, van detrás de «--»):
    --dry-run          no escribe nada y no para en las pausas
    --task=<id>        salta la búsqueda de «SIGUIENTE TAREA»
    --sin-pausa        no espera a nadie: comprueba las salidas y sigue
    --daemon           bucle infinito (es lo que hace si no se pide otra cosa)
    --once             una sola tarea y termina
    --dispatch=<modo>  quién hace el trabajo en cada pausa:
                         manual  espera a que alguien pulse ENTER (por defecto con terminal)
                         claude  lanza «claude -p» y espera (por defecto sin terminal)
    --sin-commit       actualiza TABLERO.md pero no lo confirma en git
    --desde=<ref>      cuenta los commits desde ahí, no desde HEAD. Es lo que hace
                       falta al relanzar una tarea rechazada cuyos arreglos ya
                       están confirmados.
    --tablero=<ruta>   usa otro tablero (por defecto TABLERO.md en la raíz)
    --ayuda            esto

  Recorrido: leer tablero → crear análisis → PAUSA arquitecto → validar análisis →
  PAUSA programador → validar commits → PAUSA revisión → validar veredicto →
  aprobado: marcar HECHA · rechazado: escribir feedback.
`;

function opciones(argv, entorno) {
  const o = {
    dryRun: entorno.npm_config_dry_run === 'true',
    task: entorno.npm_config_task || null,
    sinPausa: false,
    hacerCommit: true,
    tablero: null,
    desde: entorno.npm_config_desde || null,
    daemon: null,   // null = sin decidir; se resuelve al final
    dispatch: entorno.ORCHESTRATOR_DISPATCH || null,
    ayuda: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '--simulacro') o.dryRun = true;
    else if (arg === '--sin-pausa' || arg === '--no-pause') o.sinPausa = true;
    else if (arg === '--sin-commit' || arg === '--no-commit') o.hacerCommit = false;
    else if (arg === '--ayuda' || arg === '--help' || arg === '-h') o.ayuda = true;
    else if (arg.startsWith('--task=')) o.task = arg.slice(7).trim();
    else if (arg.startsWith('--tarea=')) o.task = arg.slice(8).trim();
    else if (arg.startsWith('--tablero=')) o.tablero = arg.slice(10).trim();
    else if (arg.startsWith('--desde=')) o.desde = arg.slice(8).trim();
    else if (arg.startsWith('--from=')) o.desde = arg.slice(7).trim();
    else if (arg === '--daemon') o.daemon = true;
    else if (arg === '--once' || arg === '--una') o.daemon = false;
    else if (arg.startsWith('--dispatch=')) o.dispatch = arg.slice(11).trim();
    else throw new Error(`Opción que no conozco: ${arg}\n${AYUDA}`);
  }

  // Una tarea concreta es, por definición, un encargo suelto: no da vueltas.
  if (o.task && o.daemon === null) o.daemon = false;
  if (o.daemon === null) o.daemon = true;

  if (!o.dispatch) o.dispatch = process.stdin.isTTY ? 'manual' : 'claude';
  if (!['manual', 'claude'].includes(o.dispatch)) {
    throw new Error(`--dispatch solo admite «manual» o «claude», no «${o.dispatch}».`);
  }
  return o;
}

/**
 * Una pausa que sale mal puede ser dos cosas muy distintas: el trabajo salió mal,
 * o la cuenta se quedó sin saldo a mitad. El daemon necesita saber cuál, porque
 * ante la segunda no debe reintentar: debe esperar.
 */
function codigoDeFallo(resultado, registro) {
  if (resultado.despacho && pareceSinSaldo(resultado.despacho.salida)) {
    registro.error('El despacho murió por límite o falta de saldo, no por el trabajo.');
    return 3;
  }
  return 1;
}

async function principal() {
  const o = opciones(process.argv.slice(2), process.env);
  if (o.ayuda) { process.stdout.write(AYUDA + '\n'); return 0; }

  if (o.daemon) {
    const { arrancarDaemon } = await import('./daemon.js');
    return arrancarDaemon({ dryRun: o.dryRun, dispatch: o.dispatch, hacerCommit: o.hacerCommit });
  }

  const rutaTablero = path.resolve(o.tablero ? path.resolve(process.cwd(), o.tablero) : path.join(RAIZ, 'TABLERO.md'));
  const dirLogs = path.join(RAIZ, 'logs');
  const dirDocs = path.join(RAIZ, 'docs', 'architecture');

  const registro = crearRegistro({ dirLogs, dryRun: o.dryRun });
  registro.titulo(`ORQUESTADOR DE BAMBURU${o.dryRun ? '  ·  SIMULACRO (no se escribe nada)' : ''}`);
  registro.info(`Repo:     ${RAIZ}`);
  registro.info(`Tablero:  ${path.relative(RAIZ, rutaTablero)}`);
  registro.info(`Registro: ${registro.ruta}`);
  registro.info(`Despacho: ${o.dispatch === 'claude' ? 'automático (claude -p)' : 'manual (ENTER)'}`);

  if (!esRepo(RAIZ)) { registro.error(`${RAIZ} no es un repositorio git.`); return 1; }
  registro.info(`Rama:     ${rama(RAIZ)}`);

  const sucio = arbolSucio(RAIZ);
  if (sucio.length) {
    registro.aviso(`El árbol de trabajo tiene ${sucio.length} cambio(s) sin confirmar:`);
    for (const l of sucio.slice(0, 8)) registro.info(`  ${l}`);
    if (sucio.length > 8) registro.info(`  … y ${sucio.length - 8} más`);
    registro.aviso('Los commits se cuentan desde HEAD: lo que no se confirme no cuenta como trabajo.');
  }

  // ── PASO 1 · Leer el TABLERO ────────────────────────────────────────────────
  registro.paso(1, 'Leer TABLERO.md');
  const texto = leerTablero(rutaTablero);
  const tarea = o.task ? buscarTareaPorId(texto, o.task) : buscarSiguienteTarea(texto);

  if (!tarea) {
    if (o.task) {
      registro.error(`No encuentro ninguna tarea con id «${o.task}» en ${path.basename(rutaTablero)}.`);
    } else {
      registro.error('No hay ninguna tarea siguiente en el tablero.');
      registro.info('Se busca, por este orden:');
      registro.info('  1. un encabezado markdown «## SIGUIENTE TAREA»;');
      registro.info('  2. una línea de prosa «SIGUIENTE TAREA OFICIAL: ...».');
      registro.info('Decide la siguiente y escríbela. El orquestador no elige tareas.');
    }
    return 1;
  }

  registro.exito(`Tarea encontrada (línea ${tarea.linea}, formato «${tarea.origen}»).`);
  registro.info(`taskId:      ${tarea.id}`);
  registro.info(`Título:      ${tarea.titulo}`);
  registro.info(`Descripción: ${tarea.descripcion.slice(0, 220)}${tarea.descripcion.length > 220 ? '…' : ''}`);
  registro.info(`Criterios:   ${tarea.criterios.length || 'ninguno escrito en el tablero'}`);
  for (const c of tarea.criterios) registro.info(`  [${c.hecho ? 'x' : ' '}] ${c.texto}`);
  if (!tarea.criterios.length) {
    registro.aviso('Sin criterios de aceptación no hay forma objetiva de revisar. Escríbelos en el tablero.');
  }
  if (/✅|\bHECHA\b/i.test(tarea.bruto.split('\n')[0])) {
    registro.aviso('El encabezado de esta tarea ya dice HECHA. La vas a volver a recorrer entera.');
  }
  if (tarea.origen === 'prosa') {
    registro.aviso('La tarea sale de una línea de prosa dentro de una cita, no de un bloque propio.');
    registro.aviso('Se puede leer, pero el paso 9 NO podrá reescribir el tablero solo (ver el final).');
  }

  const rutas = {
    analisis: path.join(dirDocs, `task-${tarea.id}-analysis.md`),
    review: path.join(dirDocs, `task-${tarea.id}-review.md`),
    feedback: path.join(dirDocs, `task-${tarea.id}-feedback.md`),
  };

  // ── PASO 2 · Crear el análisis vacío ────────────────────────────────────────
  registro.paso(2, 'Crear el fichero de análisis vacío');
  crearAnalisisVacio({ ruta: rutas.analisis, tarea, dryRun: o.dryRun, registro });
  registro.info(`Análisis: ${path.relative(RAIZ, rutas.analisis)}`);

  // ── PASO 3 · Pausa: Code Architect ──────────────────────────────────────────
  registro.paso(3, 'PAUSA — dispara el Code Architect');
  const seguir3 = await pausa({
    registro,
    fase: 'CODE ARCHITECT · análisis',
    prompt: promptArquitecto(tarea, rutas),
    rutaPrompt: path.join(dirLogs, `prompt-${tarea.id}-1-arquitecto.txt`),
    rutaSalida: rutas.analisis,
    dryRun: o.dryRun,
    sinPausa: o.sinPausa,
    modo: o.dispatch,
    cwd: RAIZ,
  });
  if (!seguir3.ok) return codigoDeFallo(seguir3, registro);

  // ── PASO 4 · Validar el análisis ────────────────────────────────────────────
  registro.paso(4, 'Validar el análisis');
  if (o.dryRun) {
    registro.info('[simulacro] aquí se comprobaría: >500 caracteres propios y palabra de arquitectura.');
  } else {
    const v = validarAnalisis(rutas.analisis);
    if (!v.ok) {
      registro.error(v.resumen);
      for (const d of v.detalles) registro.info(d);
      registro.error('No sigo: sin análisis no hay código.');
      return 1;
    }
    registro.exito(v.resumen);
  }

  // ── PASO 5 · Pausa: Code Programmer ─────────────────────────────────────────
  // La referencia se toma AQUÍ: lo anterior (el análisis) no es trabajo de programación.
  // Con --desde se cuenta desde donde diga el humano: al relanzar una tarea rechazada,
  // los arreglos ya están confirmados y contar desde HEAD no vería ni un commit.
  const base = o.desde ? resolver(o.desde, RAIZ) : cabeza(RAIZ);
  if (o.desde) registro.info(`Referencia dada a mano con --desde=${o.desde}`);
  registro.paso(5, `PAUSA — dispara el Code Programmer (referencia: ${base.slice(0, 7)})`);
  const seguir5 = await pausa({
    registro,
    fase: 'CODE PROGRAMMER · construcción',
    prompt: promptProgramador(tarea, rutas),
    rutaPrompt: path.join(dirLogs, `prompt-${tarea.id}-2-programador.txt`),
    // El programador no escribe un fichero suyo: lo que deja son commits, y eso se
    // comprueba en el paso 6. Aquí basta con que el análisis siga en su sitio.
    rutaSalida: rutas.analisis,
    dryRun: o.dryRun,
    sinPausa: o.sinPausa,
    modo: o.dispatch,
    cwd: RAIZ,
  });
  if (!seguir5.ok) return codigoDeFallo(seguir5, registro);

  // ── PASO 6 · Validar los commits ────────────────────────────────────────────
  registro.paso(6, 'Validar los commits nuevos');
  let commits = [];
  if (o.dryRun) {
    registro.info(`[simulacro] aquí se comprobaría: ≥1 commit desde ${base.slice(0, 7)}, mensaje con «${tarea.id}», sin restos.`);
  } else {
    const v = validarCodigo({ base, taskId: tarea.id, cwd: RAIZ });
    if (!v.ok) {
      registro.error(v.resumen);
      for (const d of v.detalles) registro.detalle(d);
      registro.error('No sigo: no hay código válido que revisar.');
      return 1;
    }
    registro.exito(v.resumen);
    for (const d of v.detalles) registro.detalle(d);
    commits = commitsDesde(base, RAIZ);
  }

  // ── PASO 7 · Pausa: Code Architect Review ───────────────────────────────────
  registro.paso(7, 'PAUSA — dispara el Code Architect Review');
  const seguir7 = await pausa({
    registro,
    fase: 'CODE ARCHITECT · revisión',
    prompt: promptRevision(tarea, rutas, commits),
    rutaPrompt: path.join(dirLogs, `prompt-${tarea.id}-3-revision.txt`),
    rutaSalida: rutas.review,
    dryRun: o.dryRun,
    sinPausa: o.sinPausa,
    modo: o.dispatch,
    cwd: RAIZ,
  });
  if (!seguir7.ok) return codigoDeFallo(seguir7, registro);

  // ── PASO 8 · Validar la revisión ────────────────────────────────────────────
  registro.paso(8, 'Leer el veredicto de la revisión');
  if (o.dryRun) {
    registro.info('[simulacro] aquí se leería «✅ APROBADO» o «❌ RECHAZADO» y se cerraría o se devolvería la tarea.');
    registro.titulo('SIMULACRO TERMINADO — no se ha escrito nada');
    return 0;
  }
  const vr = validarReview(rutas.review);
  if (!vr.ok) {
    registro.error(vr.resumen);
    for (const d of vr.detalles) registro.info(d);
    registro.error('No sigo: sin veredicto claro no se cierra ni se devuelve nada.');
    return 1;
  }
  registro.exito(vr.resumen);

  // ── PASO 9 · Cerrar o devolver ──────────────────────────────────────────────
  if (vr.veredicto === 'rechazado') {
    registro.paso(9, 'RECHAZADO — escribir el feedback');
    escribirFeedback({ ruta: rutas.feedback, tarea, revision: vr.texto, base, dryRun: false, registro, cwd: RAIZ });
    registro.titulo(`❌ «${tarea.titulo}» NO se cierra. El tablero queda como estaba.`);
    registro.info(`Corrige, confirma con «${tarea.id}» en el mensaje y vuelve a lanzar:`);
    registro.info(`    npm run orchestrate -- --task=${tarea.id} --desde=${base.slice(0, 7)}`);
    return 2;
  }

  registro.paso(9, 'APROBADO — marcar la tarea como HECHA en el TABLERO');
  const r = marcarHecha({
    rutaTablero, tarea, commits, rutas, dirLogs,
    dryRun: false, hacerCommit: o.hacerCommit, registro, cwd: RAIZ,
  });
  registro.titulo(r.escrito
    ? `✅ «${tarea.titulo}» queda HECHA.`
    : `✅ «${tarea.titulo}» aprobada, pero el tablero hay que cerrarlo a mano.`);
  registro.info(`Registro completo: ${registro.ruta}`);
  return r.escrito ? 0 : 1;
}

principal()
  .then((codigo) => process.exit(codigo))
  .catch((e) => {
    process.stderr.write(`\n❌ El orquestador se ha parado: ${e.message}\n`);
    if (process.env.ORCH_DEBUG) process.stderr.write(String(e.stack) + '\n');
    process.exit(1);
  });
