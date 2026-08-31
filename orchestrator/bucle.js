// bucle.js — El daemon. Da vueltas y no se muere.
//
// La regla que manda: ESTO NO SE MUERE. Ni por falta de cuota, ni porque una tarea reviente,
// ni porque el tablero esté a medio escribir. Cada vuelta va envuelta y cualquier desastre
// acaba en el registro y en la vuelta siguiente.
//
// Dos formas de parar, y son distintas a propósito:
//   SIGTERM → parada BUENA: termina el paso en curso y no coge la siguiente tarea.
//   SIGINT  → parada de EMERGENCIA: corta la llamada en curso. Puede dejar algo a medias.
import fs from 'node:fs';
import path from 'node:path';
import { cargarConfig } from './nucleo/config.js';
import { Almacen } from './nucleo/almacen.js';
import { crearRegistro } from './nucleo/registro.js';
import { Vigilante } from './cuota/vigilante.js';
import { Ciclo } from './ciclo.js';
import { redactar, redactarApartada, entregar } from './vigia/parte.js';
import { configurado, queFalta } from './vigia/telegram.js';
import { leerTablero, buscarSiguienteTarea, esRepo, rama } from './reader.js';

export async function arrancar({ config = null, unaVuelta = false, entorno = process.env } = {}) {
  const cfg = config || cargarConfig({ entorno });
  const log = crearRegistro({ dirLogs: cfg.rutasAbs.logs, nombre: 'orquestador.log' });

  log.titulo(`ORQUESTADOR DE BAMBURU${unaVuelta ? '  ·  UNA VUELTA' : ''}`);
  log.info(`Repo:     ${cfg.repo.raiz}`);
  log.info(`Tablero:  ${cfg.repo.tablero}`);
  log.info(`Registro: ${log.ruta}`);
  log.info(`Cuota:    empieza si quedan ${cfg.cuota.minimoParaCicloPct}% tras reservar ${cfg.cuota.margenReservadoPct}% para el chat`);
  log.info(`Ciclo:    ${cfg.ciclo.maxIntentosRevision} rechazos → replanteo · ${cfg.ciclo.maxReplanteos} replanteo(s) → apartar`);
  log.info(`Subida:   ${cfg.subida.activa ? `${cfg.repo.remoto}/${cfg.repo.ramaPrincipal}` : 'desactivada'}`);

  if (!esRepo(cfg.repo.raiz)) { log.error(`${cfg.repo.raiz} no es un repositorio git. No arranco.`); return 1; }
  log.info(`Rama:     ${rama(cfg.repo.raiz)}`);

  if (cfg.vigia.activo && !configurado(cfg, entorno)) {
    log.aviso(`Vigía de Telegram SIN CONFIGURAR: falta ${queFalta(cfg, entorno).join(' y ')}.`);
    log.aviso('El ciclo funciona igual; los partes se guardan y se mandan cuando se configure.');
  }

  const almacen = new Almacen({
    rutaEstado: cfg.rutasAbs.estado,
    rutaJournal: cfg.rutasAbs.journal,
    rutaHistorial: cfg.rutasAbs.historial,
  });
  const rec = almacen.recuperar();
  let estado = rec.estado;
  if (rec.eventosAplicados) {
    log.aviso(`Recuperado tras un corte: ${rec.eventosAplicados} evento(s) del journal${rec.reconstruido ? ' (estado reconstruido entero)' : ''}.`);
  }
  if (estado.tarea) {
    log.info(`Retomo «${estado.tarea.titulo}» en el paso ${estado.paso} (intento ${estado.intento}).`);
  }

  const vigilante = new Vigilante({ config: cfg });
  const ciclo = new Ciclo({ config: cfg, almacen, vigilante, logger: log });

  // ── Parada ────────────────────────────────────────────────────────────────
  let parando = false;
  let emergencia = false;
  let despertar = null;
  const dormir = (ms) => new Promise((res) => {
    if (ms <= 0) return res();
    const r = setTimeout(() => { despertar = null; res(); }, ms);
    despertar = () => { clearTimeout(r); despertar = null; res(); };
  });

  const pararBien = () => {
    if (parando) return;
    parando = true;
    log.aviso('SIGTERM: termino el paso en curso y no cojo otra tarea.');
    if (despertar) despertar();
  };
  const pararYa = () => {
    emergencia = true; parando = true;
    log.error('SIGINT: parada de EMERGENCIA. Corto la llamada en curso; puede quedar algo a medias.');
    ciclo.cancelarTodo();
    if (despertar) despertar();
  };
  process.on('SIGTERM', pararBien);
  process.on('SIGINT', pararYa);

  estado = almacen.transicion(estado, { tipo: 'ARRANCADO', pid: process.pid });
  escribirPid(cfg, log);

  // ── Vigía ─────────────────────────────────────────────────────────────────
  let ultimoParte = Date.now();
  let cuotaAlUltimoParte = null;

  const mandarParte = async () => {
    let cuota = null;
    try { cuota = await vigilante.consultar(); } catch { /* el parte sale igual, diciendo que no la pudo leer */ }
    let enTablero = null;
    try { enTablero = buscarSiguienteTarea(leerTablero(cfg.tableroAbs)); } catch { /* idem */ }
    // El «qué se ha terminado» sale del historial EN DISCO, filtrado por fecha, no de un
    // array en memoria: si systemd reinicia el daemon, el parte tiene que seguir sabiendo
    // qué se cerró. (Lo cazó la autorrevisión: era el motivo del único criterio en NO.)
    const desdeIso = new Date(ultimoParte).toISOString();
    const historialReciente = almacen.leerHistorial().filter((h) => h.cuando >= desdeIso);
    const texto = redactar({
      estado, cuota, historialReciente, tareaEnTablero: enTablero,
      desde: cuotaAlUltimoParte, config: cfg,
    });
    const r = await entregar({ texto, config: cfg, entorno, logger: log });
    log.info(`Parte ${r.ok ? 'entregado' : `guardado (${r.pendientes} pendiente/s)`}.`);
    ultimoParte = Date.now();
    cuotaAlUltimoParte = cuota;
  };

  // ── El bucle ──────────────────────────────────────────────────────────────
  let vueltas = 0;
  while (!parando || estado.tarea) {
    vueltas++;
    let espera = cfg.ciclo.intervaloVueltaMs;
    try {
      // Con parada buena pedida y sin tarea entre manos, se acabó.
      if (parando && !estado.tarea) break;
      if (emergencia) break;

      const r = await ciclo.unPaso(estado);
      estado = r.estado;
      espera = r.espera;

      // Una tarea apartada es lo ÚNICO que se avisa fuera del parte de las 3 horas.
      if (r.apartada) {
        await entregar({ texto: redactarApartada(r.apartada), config: cfg, entorno, logger: log });
      }
    } catch (e) {
      // La red de seguridad. Que una vuelta reviente no puede llevarse el daemon.
      log.error(`La vuelta ${vueltas} reventó: ${e.message}`);
      if (entorno.ORQ_DEBUG) log.detalle(String(e.stack));
      espera = cfg.ciclo.intervaloVueltaMs;
    }

    if (cfg.vigia.activo && Date.now() - ultimoParte >= cfg.vigia.intervaloParteMs) {
      try { await mandarParte(); } catch (e) { log.error(`El parte falló: ${e.message}`); }
    }
    if (unaVuelta) break;
    if (parando && !estado.tarea) break;
    await dormir(espera);
  }

  ciclo.cancelarTodo();
  borrarPid(cfg);
  log.info(`Parada ${emergencia ? 'de emergencia' : 'limpia'} tras ${vueltas} vuelta(s).`);
  return 0;
}

function escribirPid(cfg, log) {
  const ruta = path.join(path.dirname(cfg.rutasAbs.estado), 'daemon.pid');
  try { fs.mkdirSync(path.dirname(ruta), { recursive: true }); fs.writeFileSync(ruta, String(process.pid), 'utf8'); }
  catch (e) { log.aviso(`No pude escribir el pid: ${e.message}`); }
}
function borrarPid(cfg) {
  const ruta = path.join(path.dirname(cfg.rutasAbs.estado), 'daemon.pid');
  try { fs.unlinkSync(ruta); } catch { /* ya no estaba */ }
}
