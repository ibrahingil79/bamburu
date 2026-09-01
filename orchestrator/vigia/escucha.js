// escucha.js — El vigía que RECIBE. Corre aparte del ciclo y no lo toca.
//
// POR QUÉ VIVE EN SU PROPIO PROCESO
// ─────────────────────────────────
// Porque la pregunta que más falta hace es «¿qué está pasando?», y ésa hay que poder hacerla
// justo cuando el orquestador está ocupado media hora en una llamada, o cuando se ha caído.
// Un vigía dentro del ciclo solo contestaría cuando el ciclo tuviera un rato libre. Aparte,
// contesta siempre.
//
// QUÉ HACE Y QUÉ NO
// ─────────────────
// Lo que se contesta leyendo (parte, estado, cuota, tareas) lo hace él: lee los mismos
// ficheros que escribe el daemon y no necesita permiso de nadie.
// Lo que hay que MANDARLE al orquestador (parar, arrancar, saltar, desapartar) lo deja
// anotado en la bandeja, y el daemon la vacía al principio de cada vuelta. Por eso «para»
// significa de verdad «termina lo que estás haciendo y no cojas la siguiente»: nadie corta
// nada a mitad.
// La única excepción es «parar ya», que es una emergencia y va por señal directa.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { anadirLinea, leerLineas } from '../nucleo/almacen.js';
import { tapar } from '../nucleo/secretos.js';
import { recibir, responderA, configurado, queFalta } from './telegram.js';
import { redactar } from './parte.js';
import {
  ORDENES, PIDEN_CONFIRMACION, VAN_AL_ORQUESTADOR,
  interpretar, ayuda, pedirConfirmacion, NO_ERES_QUIEN,
} from './ordenes.js';
import { leerTablero, buscarSiguienteTarea, tareasPendientes } from '../reader.js';
import { averiaOciosoConTablero } from '../nucleo/maquina.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const NOMBRE_PASO = {
  OCIOSO: 'esperando tarea', ANALISIS: 'analizando', VALIDAR_ANALISIS: 'revisando el análisis',
  CONSTRUCCION: 'construyendo', VALIDAR_CODIGO: 'comprobando el código',
  REVISION: 'revisando', VALIDAR_REVISION: 'leyendo el veredicto',
  CIERRE: 'cerrando la tarea', ESPERANDO_CUOTA: 'parado esperando cuota',
};

function desdeHace(iso, ahora = Date.now()) {
  if (!iso) return 'no sé desde cuándo';
  const min = Math.round((ahora - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h ${min % 60} min` : `hace ${Math.floor(h / 24)} d ${h % 24} h`;
}

/** ¿Está vivo el daemon? Se mira el pid que él mismo escribe. */
export function daemonVivo(config) {
  try {
    const pid = Number(fs.readFileSync(path.join(path.dirname(config.rutasAbs.estado), 'daemon.pid'), 'utf8').trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    process.kill(pid, 0);      // señal 0: no hace nada, solo comprueba que existe
    return pid;
  } catch { return null; }
}

/**
 * Si no está corriendo, ¿va a volver solo o no?
 *
 * De dónde sale (1 sep 2026): el vigía contestaba «Systemd debería levantarlo solo en menos de
 * un minuto» SIEMPRE que no encontraba el proceso. Es cierto cuando se ha caído —hay
 * `Restart=always`— y es FALSO cuando alguien lo ha parado a propósito con `systemctl stop`,
 * porque entonces systemd lo deja parado. Ese mensaje salió de verdad a Telegram, con el
 * servicio parado adrede. Decirle a alguien que espere algo que no va a pasar es peor que no
 * decirle nada: se queda mirando el móvil.
 *
 * Se le pregunta a systemd, que es quien lo sabe. La consulta es de SOLO LECTURA y con el
 * comando FIJO: aquí no entra ni un carácter de ningún mensaje de Telegram.
 */
export function situacionDelServicio(config) {
  const pid = daemonVivo(config);
  if (pid) return { vivo: pid };

  const unidad = config.vigia.escucha?.unidad;
  // Sin unidad configurada no se inventa nada: se dice que no se sabe.
  if (!unidad || !/^[A-Za-z0-9@._-]{1,64}$/.test(unidad)) return { vivo: null, desconocido: true };

  try {
    const salida = execFileSync('systemctl', ['show', unidad, '-p', 'ActiveState', '-p', 'SubState', '--value'],
      { encoding: 'utf8', timeout: 5000 }).trim().split('\n').map((x) => x.trim());
    const [activo, sub] = salida;
    if (activo === 'activating' || sub === 'auto-restart') return { vivo: null, volviendo: true };
    if (activo === 'failed') return { vivo: null, fallado: true };
    if (activo === 'inactive') return { vivo: null, parado: true, unidad };
    return { vivo: null, desconocido: true };
  } catch { return { vivo: null, desconocido: true }; }
}

/** Cómo se cuenta esa situación, en castellano y sin prometer lo que no va a pasar. */
export function comoEsta(sit) {
  if (sit.volviendo) return ['⚠️ <b>No está corriendo ahora mismo.</b>', 'Se está levantando solo; dame unos segundos y vuelve a preguntarme.'];
  if (sit.parado) return ['⏹ <b>Está parado, y parado se queda.</b>', 'Alguien lo paró desde el servidor, así que no vuelve solo.',
                          `Para levantarlo hace falta entrar al servidor: <code>sudo systemctl start ${esc(sit.unidad)}</code>.`,
                          'Desde aquí no puedo: no tengo permiso para arrancar servicios, y es a propósito.'];
  if (sit.fallado) return ['🚨 <b>Se ha caído y no consigue volver.</b>', 'Esto necesita que alguien lo mire en el servidor.'];
  return ['⚠️ <b>No está corriendo</b>, y no sé decirte si va a volver solo.'];
}

// ─────────────────────────────────────────────────────────────────────────────
// Las respuestas. Puras: se les da el mundo y devuelven texto.
// ─────────────────────────────────────────────────────────────────────────────

export function contestarEstado({ estado, pid, situacion = null, ahora = Date.now() }) {
  const L = ['<b>⏳ Ahora mismo</b>', ''];
  if (!pid) {
    L.push(...comoEsta(situacion || { desconocido: true }));
    return L.join('\n');
  }
  if (estado.esperandoCuota) {
    L.push(`Parado esperando cuota, ${desdeHace(estado.esperaDesde, ahora)}.`);
    if (estado.tarea) L.push(`«${esc(estado.tarea.titulo)}» queda a medio hacer, en: ${NOMBRE_PASO[estado.paso] || estado.paso}.`);
  } else if (estado.tarea) {
    L.push(`<b>${esc(estado.tarea.titulo)}</b>`);
    L.push(`Va por: ${NOMBRE_PASO[estado.paso] || estado.paso}, ${desdeHace(estado.pasoDesde, ahora)}.`);
    if (estado.intento > 1) L.push(`Intento ${estado.intento}${estado.replanteos ? ` (replanteada ${estado.replanteos} vez/veces)` : ''}.`);
  } else if (estado.pausado) {
    L.push(`En pausa desde ${desdeHace(estado.pausadoDesde, ahora)}, porque me lo pediste.`);
    L.push('Dime <b>arranca</b> y sigo.');
  } else {
    L.push('Sin tarea entre manos.');
  }
  if (estado.pausado && estado.tarea) L.push('', '⏸ Cuando la termine, no cojo ninguna más: me pediste parar.');
  return L.join('\n');
}

export function contestarCuota({ cuota }) {
  if (!cuota?.fiable) return `<b>🔋 Cuota</b>\n\nNo he podido leerla: ${esc(cuota?.motivo || 'sin detalle')}.`;
  const L = ['<b>🔋 Cuota</b>', ''];
  L.push(`Queda <b>${(100 - cuota.sesionPct).toFixed(0)}%</b> de la ventana corta.`);
  if (cuota.reinicioSesion) L.push(`Se reinicia: ${esc(cuota.reinicioSesion)}.`);
  if (cuota.semanaPct != null) L.push(`De la semanal queda ${(100 - cuota.semanaPct).toFixed(0)}%.`);
  return L.join('\n');
}

export function contestarTareas({ pendientes, siguiente, estado }) {
  const L = ['<b>📋 Lo que queda</b>', ''];
  if (!pendientes.length) L.push('El tablero no tiene ninguna tarea pendiente.');
  else {
    L.push(`${pendientes.length} pendiente(s):`);
    for (const t of pendientes.slice(0, 12)) {
      L.push(`${t.id === siguiente?.id ? '➡️' : '•'} ${esc(t.titulo)}`);
    }
    if (pendientes.length > 12) L.push(`…y ${pendientes.length - 12} más`);
  }
  if (estado.apartadas?.length) {
    L.push('', `<b>⛔ Apartadas, esperando decisión tuya (${estado.apartadas.length})</b>`);
    for (const a of estado.apartadas.slice(-5)) L.push(`• <b>${esc(a.titulo)}</b>: ${esc(a.motivo)}\n  <i>para recuperarla: desapartar ${esc(a.id)}</i>`);
  }
  if (estado.pausado) L.push('', '⏸ Estoy en pausa: no cojo ninguna hasta que me digas <b>arranca</b>.');
  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// El vigía
// ─────────────────────────────────────────────────────────────────────────────

export class Escucha {
  constructor({ config, almacen, vigilante, logger, entorno = process.env }) {
    this.config = config;
    this.almacen = almacen;
    this.vigilante = vigilante;
    this.log = logger;
    this.entorno = entorno;
    this.offset = 0;
    this.parando = false;
    // La orden que espera un «sí». Vive en memoria a propósito: si el vigía se reinicia, la
    // confirmación caduca, que es exactamente lo que debe pasar con algo que puede romper.
    this.pendienteDeConfirmar = null;
  }

  /** El chat de Ibrahin. Es el ÚNICO que manda aquí. */
  get chatAutorizado() {
    return String(this.entorno[this.config.vigia.telegram.chatIdEnv] || '');
  }

  /** Todo lo que se ordena queda escrito: qué, cuándo, quién y qué se contestó. */
  registrar(entrada) {
    try {
      anadirLinea(this.config.rutasAbs.registroOrdenes, {
        cuando: new Date().toISOString(),
        ...entrada,
        // Doble red: aquí no puede acabar un token ni por accidente.
        texto: tapar(String(entrada.texto ?? '').slice(0, 300), this.entorno),
        respuesta: tapar(String(entrada.respuesta ?? '').slice(0, 300), this.entorno),
      });
    } catch (e) { this.log.aviso(`No pude registrar la orden: ${e.message}`); }
  }

  /** Deja la orden en la bandeja que el daemon vacía cada vuelta. */
  anotarParaElOrquestador(orden, id = null) {
    anadirLinea(this.config.rutasAbs.ordenes, {
      cuando: new Date().toISOString(), orden, id, de: 'telegram',
    });
  }

  /**
   * El estado, SIN escribir nada. El vigía es un lector: el dueño del estado en disco es el
   * daemon, y dos procesos escribiéndolo acabarían pisándose.
   */
  estadoActual() { return this.almacen.leerEstado(); }

  /**
   * Una vuelta: pedir mensajes y contestarlos. No lanza.
   * Separada del bucle para poder probarla sin red ni temporizadores.
   */
  async unaVuelta({ recibidor = recibir } = {}) {
    const r = await recibidor({
      config: this.config, entorno: this.entorno,
      offset: this.offset, esperaS: this.config.vigia.escucha.esperaLargaS,
    });
    if (!r.ok) {
      this.log.aviso(`No pude escuchar: ${r.motivo}`);
      return { ok: false, atendidos: 0, espera: this.config.vigia.escucha.esperaTrasFalloMs };
    }
    this.offset = r.siguienteOffset;

    let atendidos = 0;
    for (const m of r.mensajes) {
      try { await this.atender(m); atendidos++; }
      catch (e) { this.log.error(`Un mensaje reventó: ${tapar(e.message, this.entorno)}`); }
    }
    return { ok: true, atendidos, espera: 0 };
  }

  /** LA PUERTA. Un mensaje entra por aquí y solo sale como una orden de la lista. */
  async atender(m) {
    // 1 · ¿Quién? Cualquiera que no sea Ibrahin se ignora y se anota. No se le da pista de
    //     qué es esto ni de qué se puede pedir: a un desconocido no se le enseña el mando.
    if (!this.chatAutorizado || m.chatId !== this.chatAutorizado) {
      this.log.aviso(`⛔ Mensaje de un chat NO autorizado (${m.chatId}, «${m.de}»). Ignorado.`);
      this.registrar({ chatId: m.chatId, de: m.de, texto: m.texto, autorizado: false,
                       orden: null, respuesta: NO_ERES_QUIEN });
      await responderA({ chatId: m.chatId, texto: NO_ERES_QUIEN, config: this.config, entorno: this.entorno });
      return;
    }

    // 2 · ¿Qué? El texto se traduce a una entrada de la lista cerrada. Nunca se ejecuta.
    const { orden, id } = interpretar(m.texto);
    const respuesta = await this.resolver(orden, id, m);

    this.registrar({ chatId: m.chatId, de: m.de, texto: m.texto, autorizado: true, orden, id, respuesta });
    await responderA({ chatId: m.chatId, texto: respuesta, config: this.config, entorno: this.entorno });
  }

  async resolver(orden, id, m) {
    const estado = this.estadoActual();

    // ── La confirmación pendiente se resuelve antes que nada ──
    const esperando = this.confirmacionViva();
    if (esperando) {
      if (orden === ORDENES.SI) { this.pendienteDeConfirmar = null; return this.ejecutarConfirmada(esperando, estado); }
      if (orden === ORDENES.NO) { this.pendienteDeConfirmar = null; return 'Vale, lo dejo estar. No he hecho nada.'; }
      // Cualquier otra cosa cancela: no se da por confirmado lo que no se confirmó.
      this.pendienteDeConfirmar = null;
      if (orden === ORDENES.AYUDA) return `No te he entendido, así que <b>no he hecho nada</b> con lo anterior.\n\n${ayuda()}`;
    }
    if (orden === ORDENES.SI || orden === ORDENES.NO) {
      return 'No te había preguntado nada. Dime qué quieres y, si hace falta, te pregunto antes.';
    }

    // ── Las que hay que confirmar: se preguntan, no se hacen ──
    if (PIDEN_CONFIRMACION.includes(orden)) {
      if (orden === ORDENES.DESAPARTAR) {
        const ap = (estado.apartadas || []).find((a) => a.id === id);
        if (!ap) {
          const lista = (estado.apartadas || []).map((a) => `• ${esc(a.titulo)}\n  <i>desapartar ${esc(a.id)}</i>`).join('\n');
          return lista
            ? `¿Cuál de éstas quieres recuperar?\n\n${lista}`
            : 'No hay ninguna tarea apartada ahora mismo.';
        }
        this.pendienteDeConfirmar = { orden, id, hasta: Date.now() + this.config.vigia.escucha.confirmacionMs };
        return pedirConfirmacion(orden, { id, tarea: ap.titulo });
      }
      this.pendienteDeConfirmar = { orden, id, hasta: Date.now() + this.config.vigia.escucha.confirmacionMs };
      return pedirConfirmacion(orden, { tarea: estado.tarea?.titulo || null });
    }

    // ── Las que no rompen nada: se hacen ──
    return this.ejecutar(orden, id, estado);
  }

  confirmacionViva() {
    const p = this.pendienteDeConfirmar;
    if (!p) return null;
    if (Date.now() > p.hasta) { this.pendienteDeConfirmar = null; return null; }
    return p;
  }

  async ejecutarConfirmada({ orden, id }, estado) {
    if (orden === ORDENES.PARAR_YA) {
      const pid = daemonVivo(this.config);
      if (!pid) return 'No está corriendo, así que no hay nada que cortar.';
      // La ÚNICA orden que va por señal directa: es una emergencia y no puede esperar a que
      // el daemon termine el paso para enterarse.
      process.kill(pid, 'SIGINT');
      this.log.error(`Orden desde Telegram: PARAR YA. SIGINT al pid ${pid}.`);
      return '🛑 Cortado. Puede haber quedado algo a medias; al volver retomo desde el último paso guardado.\n\n<i>Systemd lo levanta solo en unos segundos.</i>';
    }
    this.anotarParaElOrquestador(orden, id);
    this.log.info(`Orden anotada para el orquestador: ${orden}${id ? ` (${id})` : ''}.`);
    return orden === ORDENES.SALTAR
      ? '⏭ Anotado. La suelta en cuanto termine el paso que tiene entre manos y te lo digo.'
      : '↩️ Anotado. Lo hace en cuanto termine el paso que tiene entre manos y te lo digo.';
  }

  async ejecutar(orden, id, estado) {
    switch (orden) {
      case ORDENES.PARTE: return this.parte(estado);
      case ORDENES.ESTADO: {
        const sit = situacionDelServicio(this.config);
        return contestarEstado({ estado, pid: sit.vivo, situacion: sit });
      }
      case ORDENES.CUOTA: return contestarCuota({ cuota: await this.cuota() });
      case ORDENES.TAREAS: {
        const t = this.tablero(estado);
        return contestarTareas({ ...t, estado });
      }
      case ORDENES.PARAR:
      case ORDENES.ARRANCAR: {
        if (orden === ORDENES.PARAR && estado.pausado) return '⏸ Ya estaba parado: no cojo tareas nuevas. Dime <b>arranca</b> cuando quieras que siga.';
        if (orden === ORDENES.ARRANCAR && !estado.pausado) return '▶️ Ya estaba en marcha.';
        this.anotarParaElOrquestador(orden);
        this.log.info(`Orden anotada para el orquestador: ${orden}.`);
        const sit = situacionDelServicio(this.config);
        if (!sit.vivo) {
          // Se anota igual —la recogerá cuando vuelva— pero NO se promete que vuelva solo.
          return ['Lo he anotado y lo hará en cuanto esté en marcha, pero:', '', ...comoEsta(sit)].join('\n');
        }
        return orden === ORDENES.PARAR
          ? '⏸ Anotado. Termina lo que tiene entre manos y no coge ninguna más. Te aviso cuando lo haga.'
          : '▶️ Anotado. Vuelve a coger tareas en cuanto dé la siguiente vuelta.';
      }
      default: return ayuda();
    }
  }

  async cuota() {
    try { return await this.vigilante.consultar(); }
    catch (e) { return { fiable: false, motivo: tapar(e.message, this.entorno) }; }
  }

  tablero(estado) {
    try {
      const texto = leerTablero(this.config.tableroAbs);
      return {
        pendientes: tareasPendientes(texto),
        siguiente: buscarSiguienteTarea(texto, { excluir: (estado.apartadas || []).map((a) => a.id) }),
      };
    } catch { return { pendientes: [], siguiente: null }; }
  }

  /** El parte de siempre, pero pedido a mano. El mismo texto que llega cada 3 horas. */
  async parte(estado) {
    const cuota = await this.cuota();
    const { pendientes, siguiente } = this.tablero(estado);
    const averia = (!estado.tarea && !estado.pausado && !siguiente) ? averiaOciosoConTablero(pendientes) : null;
    // Lo cerrado en las últimas 3 horas, del historial EN DISCO.
    const desde = new Date(Date.now() - this.config.vigia.intervaloParteMs).toISOString();
    let historialReciente = [];
    try { historialReciente = this.almacen.leerHistorial().filter((h) => h.cuando >= desde); } catch { /* el parte sale igual */ }

    return redactar({
      estado, cuota, historialReciente, tareaEnTablero: siguiente,
      pendientesEnTablero: pendientes, averia, desde: null, config: this.config,
    });
  }

  parar() { this.parando = true; }

  /** El bucle. No se muere: cualquier desastre acaba en el registro y en la vuelta siguiente. */
  async correr({ recibidor = recibir, dormir = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    if (!configurado(this.config, this.entorno)) {
      this.log.error(`No puedo escuchar: falta ${queFalta(this.config, this.entorno).join(' y ')}.`);
      return 1;
    }
    this.log.info(`Escuchando órdenes de Telegram. Solo obedezco al chat ${this.chatAutorizado}.`);
    // Lo que llegó mientras no había nadie escuchando se descarta: contestar a las 3 de la
    // mañana a un «para» de ayer sería peor que no contestar.
    await this.descartarAtrasados({ recibidor });

    while (!this.parando) {
      let espera = 0;
      try { espera = (await this.unaVuelta({ recibidor })).espera; }
      catch (e) {
        this.log.error(`La vuelta del vigía reventó: ${tapar(e.message, this.entorno)}`);
        espera = this.config.vigia.escucha.esperaTrasFalloMs;
      }
      if (espera > 0) await dormir(espera);
    }
    this.log.info('Vigía parado.');
    return 0;
  }

  async descartarAtrasados({ recibidor = recibir } = {}) {
    const r = await recibidor({ config: this.config, entorno: this.entorno, offset: -1, esperaS: 0 });
    if (r.ok && r.siguienteOffset) {
      this.offset = r.siguienteOffset;
      if (r.mensajes.length) this.log.info(`Descarto ${r.mensajes.length} mensaje(s) de antes de arrancar.`);
    }
  }
}
