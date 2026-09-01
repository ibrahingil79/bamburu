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
import { redactar, redactarApartada, redactarAveria, entregar } from './vigia/parte.js';
import { configurado, queFalta } from './vigia/telegram.js';
import { leerTablero, buscarSiguienteTarea, tareasPendientes, esRepo, rama } from './reader.js';

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

  // Una orden nueva DESPIERTA al daemon. Sin esto, un «para» pedido durante una espera de
  // cuota tardaría los 15 minutos completos de la siguiente vuelta en aplicarse: el vigía
  // contesta «anotado» al momento y luego no pasa nada durante un cuarto de hora.
  // Se reaprovecha el mismo `despertar` que usa la parada, que ya existía.
  let mirón = null;
  try {
    fs.mkdirSync(path.dirname(cfg.rutasAbs.ordenes), { recursive: true });
    fs.closeSync(fs.openSync(cfg.rutasAbs.ordenes, 'a'));   // que exista, para poder vigilarlo
    mirón = fs.watch(cfg.rutasAbs.ordenes, () => { if (despertar) despertar(); });
    mirón.on('error', () => { /* si el vigilante se cae, las órdenes se recogen igual, más tarde */ });
  } catch (e) {
    log.aviso(`No puedo vigilar la bandeja de órdenes (${e.message}). Las recogeré en cada vuelta, sin prisa.`);
  }

  estado = almacen.transicion(estado, { tipo: 'ARRANCADO', pid: process.pid });
  escribirPid(cfg, log);

  // ── Vigía ─────────────────────────────────────────────────────────────────
  let ultimoParte = Date.now();
  let cuotaAlUltimoParte = null;
  // La última avería vista. Va al parte además del aviso suelto: el aviso se manda una vez,
  // pero mientras el sistema siga roto tiene que salir en TODOS los partes.
  let averiaViva = null;

  const mandarParte = async () => {
    let cuota = null;
    try { cuota = await vigilante.consultar(); } catch { /* el parte sale igual, diciendo que no la pudo leer */ }
    let enTablero = null;
    let pendientesEnTablero = [];
    try {
      const texto = leerTablero(cfg.tableroAbs);
      enTablero = buscarSiguienteTarea(texto, { excluir: (estado.apartadas || []).map((a) => a.id) });
      pendientesEnTablero = tareasPendientes(texto);
    } catch { /* idem */ }
    // El «qué se ha terminado» sale del historial EN DISCO, filtrado por fecha, no de un
    // array en memoria: si systemd reinicia el daemon, el parte tiene que seguir sabiendo
    // qué se cerró. (Lo cazó la autorrevisión: era el motivo del único criterio en NO.)
    const desdeIso = new Date(ultimoParte).toISOString();
    const historialReciente = almacen.leerHistorial().filter((h) => h.cuando >= desdeIso);
    const texto = redactar({
      estado, cuota, historialReciente, tareaEnTablero: enTablero, pendientesEnTablero,
      averia: averiaViva, desde: cuotaAlUltimoParte, config: cfg,
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
      // Y TAMBIÉN se acabó si la tarea está parada esperando cuota. Aquí no se está
      // terminando nada: se está durmiendo, a veces durante horas. La tarea queda intacta en
      // su paso —está en el journal— y se retoma tal cual al volver.
      //
      // De dónde sale (1 sep 2026): con la tarea esperando a que se reiniciara la ventana,
      // un `systemctl restart` se quedó colgado. SIGTERM no sacaba al daemon porque «tenía
      // tarea», y systemd habría acabado matándolo a los 35 minutos con un SIGKILL. Esperar
      // no es trabajar, y una parada buena no puede durar tres horas.
      if (parando && estado.esperandoCuota) {
        log.info('Paro aquí: la tarea está esperando cuota, no a medio hacer. Se retoma en su paso.');
        break;
      }
      if (emergencia) break;

      const r = await ciclo.unPaso(estado);
      estado = r.estado;
      espera = r.espera;

      // Dos cosas se avisan fuera del parte de las 3 horas, y solo dos: una tarea apartada
      // (necesita decisión) y una AVERÍA (el sistema está parado y nadie lo sabe).
      if (r.apartada) {
        await entregar({ texto: redactarApartada(r.apartada), config: cfg, entorno, logger: log });
      }
      // Lo que contestan las órdenes que llegaron por Telegram mientras trabajaba.
      for (const aviso of r.avisos || []) {
        await entregar({ texto: aviso, config: cfg, entorno, logger: log });
      }
      averiaViva = r.averiaViva ?? averiaViva;
      if (r.averia) {
        averiaViva = r.averia;
        await entregar({ texto: redactarAveria(r.averia), config: cfg, entorno, logger: log });
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
    if (parando && (!estado.tarea || estado.esperandoCuota)) break;
    await dormir(espera);
  }

  ciclo.cancelarTodo();
  try { mirón?.close(); } catch { /* ya estaba cerrado */ }
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
