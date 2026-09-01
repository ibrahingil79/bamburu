// bucle.js — El daemon. Da vueltas y no se muere.
//
// La regla que manda: ESTO NO SE MUERE. Ni por falta de cuota, ni porque una tarea reviente,
// ni porque el tablero esté a medio escribir. Cada vuelta va envuelta y cualquier desastre
// acaba en el registro y en la vuelta siguiente.
//
// Dos formas de parar, y son distintas a propósito:
//   SIGTERM → parada BUENA: termina EL PASO en curso si le da tiempo, y no empieza otro.
//   SIGINT  → parada de EMERGENCIA: corta la llamada en curso. Puede dejar algo a medias.
//
// ⚙️ QUÉ SIGNIFICA «PARADA BUENA», DESPUÉS DEL 1 SEP 2026 (avería 3). Ese día un
// `systemctl restart` se quedó colgado y hubo que matarlo con SIGKILL. Había DOS fallos
// debajo, no uno, y el arreglo de esa misma mañana no tocó ninguno de los dos:
//
//   1. NO PARABA TRAS EL PASO: paraba tras la TAREA. La condición del bucle era
//      `while (!parando || estado.tarea)`, así que un SIGTERM con una tarea entre manos
//      seguía dando vueltas —análisis, construcción, revisión, cierre— hasta terminarla.
//      Tres llamadas más al modelo, de hasta 30 min cada una. «Termina el paso en curso»
//      era, literalmente, falso.
//   2. NO TENÍA PLAZO. `pararBien()` levantaba una bandera y despertaba al `dormir()`, pero
//      la llamada al modelo en vuelo no se enteraba: seguía hasta su timeout de 30 min.
//      systemd esperaba sus 35 (`TimeoutStopSec=2100`) antes de matar.
//
// Ahora: se para tras UN paso, y el paso tiene PLAZO (`ciclo.plazoParadaMs`). Si termina
// dentro del plazo no se pierde nada; si no, se corta y la tarea se retoma en su paso, que
// está en el journal. Un segundo SIGTERM corta sin esperar el plazo.
//
// LO QUE CUESTA, dicho claro: cortar una llamada a mitad tira los tokens de esa llamada. Se
// paga a propósito. Una parada que puede durar media hora no es una parada, y el 1 sep costó
// un SIGKILL, que sí deja cosas a medias de verdad.
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
import { correrBarrido } from './barrido.js';
import { alcanzaParaCiclo } from './nucleo/maquina.js';

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

  const vigilante = new Vigilante({ config: cfg, ruta: cfg.rutasAbs.cuota });
  const ciclo = new Ciclo({ config: cfg, almacen, vigilante, logger: log });

  // ── Parada ────────────────────────────────────────────────────────────────
  let parando = false;
  let emergencia = false;
  let cortado = false;
  let plazoParada = null;
  let despertar = null;
  // Lo único en vuelo que no lleva el ciclo en sus `cancelables`: el barrido de los ratos
  // muertos, que dura 20-30 min. Sin esta manija, un SIGTERM durante un barrido colgaba
  // exactamente igual que uno durante una llamada al modelo.
  let cortarBarrido = null;
  const dormir = (ms) => new Promise((res) => {
    if (ms <= 0) return res();
    const r = setTimeout(() => { despertar = null; res(); }, ms);
    despertar = () => { clearTimeout(r); despertar = null; res(); };
  });

  /**
   * Corta cuanto esté en vuelo. Es seguro: el paso está en el journal antes de empezar,
   * así que al arrancar de nuevo se retoma ahí. Lo que se pierde son los tokens de la llamada
   * a medias, y eso se dice en el registro en vez de disimularlo.
   */
  const cortarLoQueHaya = (porque) => {
    if (cortado) return;
    cortado = true;
    log.aviso(`⛔ ${porque}: corto lo que tengo en vuelo.`);
    if (estado.tarea) log.aviso(`   «${estado.tarea.titulo}» queda en el paso ${estado.paso} y se retoma ahí al arrancar.`);
    try { ciclo.cancelarTodo(); } catch (e) { log.error(`No pude cortar la llamada: ${e.message}`); }
    // La consulta de cuota es TAMBIÉN una llamada al modelo, con su propio plazo de 3 minutos.
    // Se cuelga igual que un análisis si nadie la corta (lo destapó la prueba de la parada).
    try { vigilante.cancelarTodo(); } catch (e) { log.error(`No pude cortar la consulta de cuota: ${e.message}`); }
    try { cortarBarrido?.(); } catch (e) { log.error(`No pude cortar el barrido: ${e.message}`); }
    if (despertar) despertar();
  };

  const pararBien = () => {
    if (parando) {
      // Segundo SIGTERM. Ya no hay cortesía: alguien está esperando delante del terminal.
      cortarLoQueHaya('Me lo has pedido dos veces');
      return;
    }
    parando = true;
    const segs = Math.round(cfg.ciclo.plazoParadaMs / 1000);
    log.aviso(`SIGTERM: no empiezo ningún paso más. Al de ahora le doy ${segs} s y luego lo corto.`);
    if (despertar) despertar();
    // EL PLAZO. Sin él, «terminar el paso en curso» puede durar los 30 min del timeout de la
    // llamada, y `systemctl restart` se queda colgado hasta que systemd manda el SIGKILL.
    plazoParada = setTimeout(() => cortarLoQueHaya(`Se pasó el plazo de ${segs} s`), cfg.ciclo.plazoParadaMs);
    plazoParada.unref?.();
  };
  const pararYa = () => {
    emergencia = true; parando = true;
    log.error('SIGINT: parada de EMERGENCIA. Corto la llamada en curso; puede quedar algo a medias.');
    cortarLoQueHaya('Parada de emergencia');
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
  // Los barridos corridos en los ratos muertos desde el último parte. Van AL PARTE (regla 3 del
  // bloque 4): qué se ejecutó y qué salió rojo. Se vacía al mandarlo.
  let barridosDelParte = [];
  // Una sola pasada por espera (regla 1): esto se pone a true al lanzarla y vuelve a false en
  // cuanto el orquestador deja de estar esperando cuota. No es un bucle.
  let barridoDeEstaEspera = false;

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
      averia: averiaViva, desde: cuotaAlUltimoParte, config: cfg, barridos: barridosDelParte,
    });
    const r = await entregar({ texto, config: cfg, entorno, logger: log });
    log.info(`Parte ${r.ok ? 'entregado' : `guardado (${r.pendientes} pendiente/s)`}.`);
    ultimoParte = Date.now();
    cuotaAlUltimoParte = cuota;
    barridosDelParte = [];
  };

  // ── El bucle ──────────────────────────────────────────────────────────────
  let vueltas = 0;
  while (true) {
    // NADA NUEVO SI YA SE ESTÁ PARANDO. Una sola regla, arriba del todo, y sustituye a los tres
    // casos particulares que había aquí (sin tarea / esperando cuota / emergencia).
    //
    // De dónde sale (1 sep 2026). Los casos particulares tapaban el fallo de fondo: la
    // condición del bucle era `while (!parando || estado.tarea)`, así que un SIGTERM con una
    // tarea entre manos NO paraba — seguía dando vueltas hasta terminarla entera. El arreglo de
    // esa mañana añadió el caso «esperando cuota», que era el único de los tres que se había
    // visto fallar, y el que falló de verdad esa tarde fue el otro: SIGTERM con el arquitecto
    // trabajando. Un caso particular por avería vista deja viva la de debajo.
    //
    // La regla vieja «no cojo otra TAREA» se queda corta a propósito: un paso ya cuesta hasta
    // 30 min, y encadenar los cuatro de una tarea es media mañana. No se empieza otro PASO.
    if (parando || emergencia) break;
    vueltas++;
    let espera = cfg.ciclo.intervaloVueltaMs;
    try {
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
    // Y aquí otra vez, porque el SIGTERM ha podido llegar DURANTE el paso que acaba de terminar.
    // Éste es el que hace verdadera la frase «termina el paso en curso»: uno, no la tarea.
    if (parando) break;

    // ── EL RATO MUERTO SE APROVECHA (bloque 4 del encargo del 1 sep 2026) ────────────────────
    // Si estamos parados esperando a que se reinicie la ventana, se corre UNA pasada del barrido
    // en vez de dormir. No cuesta cuota —205 de las 208 comprobaciones no tocan el modelo, y las
    // que sí están declaradas fuera a propósito—: cuesta tiempo de máquina, y ese tiempo hoy se
    // tira. La madrugada del 1 sep fueron 3 h 22 min de espera muerta.
    //
    // Las cuatro reglas viven aquí y en barrido.js: UNA pasada por espera; la cuota manda y corta;
    // el resultado va al parte; y NADA de esto puede tumbar el daemon —de ahí el try entero.
    if (estado.esperandoCuota && !barridoDeEstaEspera && !parando) {
      barridoDeEstaEspera = true;
      try {
        log.info('⏳ Parado por cuota: aprovecho para pasar el barrido de comprobaciones.');
        const r = await correrBarrido({
          cfg, log, entorno,
          // La manija para cortarlo. Sin esto, un SIGTERM durante el barrido colgaba igual que
          // uno durante una llamada al modelo: 20-30 min de espera con systemd delante.
          alSalir: (cancelar) => { cortarBarrido = cancelar; },
          hayCuotaYa: async () => {
            try {
              const c = await vigilante.consultar();
              return alcanzaParaCiclo(c, cfg).alcanza;
            } catch { return false; }
          },
        }).finally(() => { cortarBarrido = null; });
        barridosDelParte.push(r);
        const resumen = `${r.ejecutados.length} ejecutadas · ${r.rojos.length} en rojo · ${r.segs} s`;
        if (r.estado === 'completo') log.exito(`Barrido terminado: ${resumen}.`);
        else if (r.estado === 'cortado') log.info(`Barrido cortado: ${resumen}. ${r.motivo}.`);
        else log.aviso(`El barrido no se pudo pasar: ${r.motivo}`);
        // DÓNDE MIRAR, y los rojos POR SU NOMBRE en el propio registro. El 1 sep 2026 el primer
        // barrido que funcionó dijo «113 en rojo» y no había forma de saber cuáles: la lista se
        // iba con el daemon en el siguiente reinicio.
        if (r.registro) log.info(`   salida entera en ${r.registro}`);
        for (const x of r.rojos.slice(0, 40)) log.aviso(`   ✗ ${x.gate} — ${x.estado}`);
        if (r.rojos.length > 40) log.aviso(`   …y ${r.rojos.length - 40} más, en ${r.registro || 'la salida'}`);
      } catch (e) {
        // Aquí NO se llega salvo desastre: correrBarrido no lanza. La red está por si acaso,
        // porque la regla del fichero es que esto no se muere.
        log.error(`El barrido de la espera reventó y sigo igual: ${e.message}`);
      }
      continue;   // vuelta nueva: lo primero que hará es volver a mirar la cuota.
    }
    if (!estado.esperandoCuota) barridoDeEstaEspera = false;

    await dormir(espera);
  }

  if (plazoParada) clearTimeout(plazoParada);
  ciclo.cancelarTodo();
  // Los oyentes de señal se quitan al salir. Sin esto, cada `arrancar()` deja los suyos puestos
  // para siempre: en producción no se nota porque el proceso muere con el daemon, pero en las
  // pruebas —donde `arrancar()` se llama varias veces en el MISMO proceso— el SIGTERM de una
  // prueba despertaba también a los daemons de las anteriores. Una prueba que puede contaminar
  // a la siguiente no puede usarse para juzgar a ninguna de las dos.
  process.off('SIGTERM', pararBien);
  process.off('SIGINT', pararYa);
  try { mirón?.close(); } catch { /* ya estaba cerrado */ }
  borrarPid(cfg);
  // CÓMO se paró, no solo que se paró. Una parada que tuvo que cortar algo a mitad no es lo
  // mismo que una que llegó a tiempo, y el que lea el registro mañana necesita distinguirlas.
  const como = emergencia ? 'de emergencia' : (cortado ? 'limpia, cortando el paso en curso' : 'limpia');
  log.info(`Parada ${como} tras ${vueltas} vuelta(s).`);
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
