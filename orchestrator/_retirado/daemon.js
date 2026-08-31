// daemon.js — El orquestador dando vueltas, sin que nadie lo empuje.
//
// La regla que manda sobre todas las demás: ESTO NO SE MUERE. Ni por falta de
// saldo, ni porque una tarea reviente, ni porque el TABLERO esté a medio escribir.
// Cada vuelta va envuelta, cada tarea corre en un proceso aparte, y cualquier
// desastre acaba en el registro y en la vuelta siguiente.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { RAIZ, leerTablero, buscarSiguienteTarea, esRepo, rama, arbolSucio } from './reader.js';
import { crearRegistro } from './dispatcher.js';
import { consultarSaldo, registrarResultado } from './token-monitor.js';

const LOOP = Number(process.env.ORCHESTRATOR_LOOP_INTERVAL || 60_000);
const PAUSA_CHECK = Number(process.env.ORCHESTRATOR_PAUSE_CHECK_INTERVAL || 300_000);
const MAX_INTENTOS = Number(process.env.ORCHESTRATOR_MAX_INTENTOS || 3);
const SILENCIO = Number(process.env.ORCHESTRATOR_QUIET_INTERVAL || 30 * 60_000);

const minutos = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 6000) / 10} min`);

// ─────────────────────────────────────────────────────────────────────────────
// Sueño interrumpible: dormir una hora y aun así atender un SIGTERM al instante.
// ─────────────────────────────────────────────────────────────────────────────

let parando = false;
let despertar = null;

function dormir(ms) {
  return new Promise((resolve) => {
    const reloj = setTimeout(() => { despertar = null; resolve(); }, ms);
    despertar = () => { clearTimeout(reloj); despertar = null; resolve(); };
  });
}

function pedirParada(registro, senal) {
  if (parando) return;
  parando = true;
  registro.aviso(`Recibida ${senal}: termino la vuelta y paro.`);
  if (despertar) despertar();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ejecutar una tarea, en un proceso aparte
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La tarea corre en un hijo a propósito. Si el orquestador de una tarea se cuelga,
 * lanza una excepción o se queda sin memoria, el que muere es el hijo. El daemon
 * lee el código de salida y sigue vivo.
 *
 * Códigos que devuelve orchestrator/index.js --once:
 *   0 aprobada y cerrada · 1 falló algo · 2 la revisión la rechazó · 3 sin saldo
 */
function ejecutarTarea({ registro, dispatch, hacerCommit }) {
  return new Promise((resolve) => {
    const args = [path.join(RAIZ, 'orchestrator', 'index.js'), '--once', `--dispatch=${dispatch}`];
    if (!hacerCommit) args.push('--sin-commit');

    let hijo;
    try {
      hijo = spawn(process.execPath, args, { cwd: RAIZ, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ codigo: 1, salida: `no pude lanzar el hijo: ${e.message}` });
    }

    let salida = '';
    const recoger = (t) => {
      salida += t;
      if (salida.length > 4 * 1024 * 1024) salida = salida.slice(-2 * 1024 * 1024);
      process.stdout.write(t);   // en directo al journal
    };
    hijo.stdout.on('data', recoger);
    hijo.stderr.on('data', recoger);
    hijo.on('error', (e) => resolve({ codigo: 1, salida: `el hijo falló: ${e.message}` }));
    hijo.on('close', (codigo) => resolve({ codigo: codigo === null ? 1 : codigo, salida }));

    // Si nos mandan parar a mitad de una tarea, se la lleva por delante con nosotros.
    const antes = despertar;
    despertar = () => { try { hijo.kill('SIGTERM'); } catch { /* ya estaba muerto */ } if (antes) antes(); };
  });
}

function huella(texto) {
  return crypto.createHash('sha1').update(texto).digest('hex').slice(0, 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// Una vuelta
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve cuántos milisegundos hay que esperar antes de la vuelta siguiente. */
async function unaVuelta(ctx) {
  const { registro, estado, dryRun, dispatch, hacerCommit, rutaTablero } = ctx;

  // 1 · ¿Se puede trabajar ahora mismo?
  // En pausa se fuerza la consulta: si no, la caché de 5 min y la espera de 5 min
  // se solaparían y podríamos estar mirando una respuesta vieja cada vez.
  const saldo = await consultarSaldo({ forzar: estado.enPausa });

  if (!saldo.hasBalance) {
    if (!estado.enPausa) {
      estado.enPausa = true;
      estado.desde = Date.now();
      registro.aviso(`⏸  PAUSA — ${saldo.estado} (${saldo.fuente}): ${saldo.motivo}`);
      if (saldo.reset_date) registro.info(`Reinicio previsto: ${saldo.reset_date}`);
      if (saldo.remaining !== null) registro.info(`Restante según cabeceras: ${saldo.remaining}`);
      registro.info(`Vuelvo a mirar cada ${minutos(PAUSA_CHECK)}. No me muero: espero.`);
      if (saldo.estado === 'configuracion') {
        registro.error('Esto NO se arregla solo: es configuración (clave, permisos o binario).');
      }
    } else {
      const rato = Math.round((Date.now() - estado.desde) / 60000);
      registro.info(`En pausa desde hace ${rato} min · ${saldo.estado}: ${saldo.motivo.slice(0, 120)}`);
    }
    return PAUSA_CHECK;
  }

  if (estado.enPausa) {
    const rato = Math.round((Date.now() - estado.desde) / 60000);
    estado.enPausa = false;
    registro.exito(`▶  REANUDACIÓN — vuelve a haber saldo (${saldo.fuente}) tras ${rato} min parado.`);
  }

  // 2 · ¿Hay algo que hacer?
  const texto = leerTablero(rutaTablero);
  const tarea = buscarSiguienteTarea(texto);
  const marcaTablero = huella(texto);

  if (!tarea) {
    if (Date.now() - estado.ultimoSilencio > SILENCIO) {
      estado.ultimoSilencio = Date.now();
      registro.info('Sin «SIGUIENTE TAREA» en el tablero. Espero a que alguien decida la próxima.');
    }
    return LOOP;
  }

  // 3 · ¿Está atascada?
  // Sin esto, una tarea que falla siempre se reintentaría cada minuto para siempre,
  // quemando tokens sin avanzar un milímetro. Se aparca hasta que el tablero cambie.
  const atasco = estado.atascadas.get(tarea.id);
  if (atasco) {
    if (atasco === marcaTablero) {
      if (Date.now() - estado.ultimoSilencio > SILENCIO) {
        estado.ultimoSilencio = Date.now();
        registro.aviso(`«${tarea.id}» sigue aparcada tras ${MAX_INTENTOS} intentos. Cambia el TABLERO para reactivarla.`);
      }
      return LOOP;
    }
    registro.info(`El TABLERO cambió: desaparco «${tarea.id}» y lo vuelvo a intentar.`);
    estado.atascadas.delete(tarea.id);
    estado.intentos.delete(tarea.id);
  }

  const intento = (estado.intentos.get(tarea.id) || 0) + 1;
  registro.paso(estado.ciclo, `Tarea «${tarea.titulo}» (${tarea.id}) · intento ${intento} de ${MAX_INTENTOS}`);

  if (dryRun) {
    registro.info(`[simulacro] aquí lanzaría: node orchestrator/index.js --once --dispatch=${dispatch}`);
    return LOOP;
  }

  // 4 · Adelante
  const r = await ejecutarTarea({ registro, dispatch, hacerCommit });

  // Solo el código de salida, nunca el texto del hijo. El hijo imprime los prompts
  // enteros, y ahí dentro hay frases que hablan de límites sin que falte saldo:
  // buscarlas en esa salida es pedir un falso positivo.
  const sinSaldo = r.codigo === 3;

  if (sinSaldo) {
    // No cuenta como intento: no falló el trabajo, faltó el combustible.
    registrarResultado('sin-saldo', 'lo dijo el propio despacho de la tarea');
    registro.aviso('La tarea se quedó sin saldo a mitad. No lo apunto como fallo suyo.');
    return 0;   // vuelta inmediata: entrará en pausa por la puerta de arriba
  }

  if (r.codigo === 0) {
    registrarResultado('ok', 'la tarea terminó bien');
    estado.intentos.delete(tarea.id);
    estado.hechas++;
    registro.exito(`✅ «${tarea.titulo}» cerrada. Van ${estado.hechas} en esta vida del daemon.`);
    return LOOP;
  }

  estado.intentos.set(tarea.id, intento);
  if (r.codigo === 2) registro.aviso(`❌ «${tarea.id}» rechazada por la revisión. El feedback está escrito.`);
  else registro.error(`«${tarea.id}» falló (código ${r.codigo}).`);

  if (intento >= MAX_INTENTOS) {
    estado.atascadas.set(tarea.id, marcaTablero);
    registro.error(`«${tarea.id}» llega a ${MAX_INTENTOS} intentos: la aparco.`);
    registro.error('No la vuelvo a tocar hasta que el TABLERO cambie. Sigo vivo y atento.');
  }
  return LOOP;
}

// ─────────────────────────────────────────────────────────────────────────────
// El bucle
// ─────────────────────────────────────────────────────────────────────────────

export async function arrancarDaemon({ dryRun = false, dispatch = 'claude', hacerCommit = true } = {}) {
  const dirLogs = path.join(RAIZ, 'logs');
  const rutaTablero = path.join(RAIZ, 'TABLERO.md');
  const registro = crearRegistro({ dirLogs, dryRun, nombre: 'daemon.log' });

  registro.titulo(`DAEMON DEL ORQUESTADOR${dryRun ? '  ·  SIMULACRO (una vuelta y fuera)' : ''}`);
  registro.info(`Repo:     ${RAIZ}`);
  registro.info(`Registro: ${registro.ruta}`);
  registro.info(`Vuelta:   cada ${minutos(LOOP)} · en pausa, cada ${minutos(PAUSA_CHECK)}`);
  registro.info(`Despacho: ${dispatch === 'claude' ? 'automático (claude -p)' : 'manual (ENTER)'}`);
  registro.info(`Saldo:    ${process.env.ANTHROPIC_API_KEY ? 'sonda contra la API' : 'sonda contra la CLI de Claude Code'}`);
  registro.info(`Intentos: ${MAX_INTENTOS} por tarea antes de aparcarla`);

  if (!esRepo(RAIZ)) { registro.error(`${RAIZ} no es un repositorio git. No arranco.`); return 1; }

  const donde = rama(RAIZ);
  registro.info(`Rama:     ${donde}`);
  if (dispatch === 'claude') {
    if (!process.env.ORCHESTRATOR_CLAUDE_ARGS) {
      registro.aviso('ORCHESTRATOR_CLAUDE_ARGS vacío: Claude Code pedirá permisos y aquí no hay quien conteste.');
      registro.aviso('Para trabajo desatendido hace falta ponerlo a mano. Está explicado en la unit de systemd.');
    }
    if (hacerCommit) {
      registro.aviso(`Esto va a escribir y CONFIRMAR en «${donde}» sin que nadie lo mire. Nunca hace push.`);
    }
  }
  const sucio = arbolSucio(RAIZ);
  if (sucio.length) registro.aviso(`El árbol arranca con ${sucio.length} cambio(s) sin confirmar.`);

  if (!dryRun) {
    process.on('SIGTERM', () => pedirParada(registro, 'SIGTERM'));
    process.on('SIGINT', () => pedirParada(registro, 'SIGINT'));
  }

  const estado = {
    ciclo: 0, enPausa: false, desde: 0, hechas: 0, ultimoSilencio: 0,
    intentos: new Map(), atascadas: new Map(),
  };
  const ctx = { registro, estado, dryRun, dispatch, hacerCommit, rutaTablero };

  while (!parando) {
    estado.ciclo++;
    let espera = LOOP;
    try {
      espera = await unaVuelta(ctx);
    } catch (e) {
      // La red de seguridad. Que una vuelta reviente no puede llevarse el daemon.
      registro.error(`La vuelta ${estado.ciclo} reventó: ${e.message}`);
      if (process.env.ORCH_DEBUG) registro.detalle(String(e.stack));
      espera = LOOP;
    }
    if (dryRun) { registro.titulo('SIMULACRO TERMINADO — una vuelta, nada escrito'); break; }
    if (parando) break;
    if (espera > 0) await dormir(espera);
  }

  registro.info(`Parada limpia tras ${estado.ciclo} vuelta(s) y ${estado.hechas} tarea(s) cerrada(s).`);
  return 0;
}
