// almacen.js — Persistencia. Lo único que toca el estado en disco.
//
// Dos piezas y un contrato:
//   · journal.ndjson  — append-only. LA VERDAD. Cada transición se añade aquí primero.
//   · estado.json     — instantánea, por comodidad de lectura. Se puede reconstruir.
//
// El orden importa y es al revés de lo que parece: PRIMERO el journal, DESPUÉS la
// instantánea. Si el corte llega en medio, el journal tiene el evento y la instantánea
// está vieja: `recuperar()` lo detecta y rehace la instantánea. Al revés se perdería el
// evento, que es lo irrecuperable.
import fs from 'node:fs';
import path from 'node:path';
import { ErrorOrquestador, claseDesdeErrno } from './errores.js';

export const VERSION_ESTADO = 1;

/**
 * Escritura atómica: temporal en el MISMO directorio (para que rename no cruce sistemas de
 * ficheros), fsync del fichero, rename, y fsync del directorio para que el rename también
 * llegue al disco. Sin el fsync del directorio, un corte puede dejar el rename sin registrar.
 */
export function escribirAtomico(ruta, contenido) {
  const dir = path.dirname(ruta);
  const tmp = path.join(dir, `.${path.basename(ruta)}.${process.pid}.${Date.now()}.tmp`);
  let fd;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, contenido, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, ruta);
    let dirFd;
    try { dirFd = fs.openSync(dir, 'r'); fs.fsyncSync(dirFd); }
    catch { /* en algunos sistemas no se puede fsync un directorio; no es fatal */ }
    finally { if (dirFd !== undefined) fs.closeSync(dirFd); }
  } catch (e) {
    throw new ErrorOrquestador(claseDesdeErrno(e), `no pude escribir ${ruta}: ${e.message}`, { ruta });
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ya cerrado */ } }
    if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* se limpia sola la próxima */ } }
  }
}

/** Añade una línea NDJSON. `appendFileSync` con 'a' es atómico para escrituras cortas en POSIX. */
export function anadirLinea(ruta, objeto) {
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.appendFileSync(ruta, JSON.stringify(objeto) + '\n', 'utf8');
  } catch (e) {
    throw new ErrorOrquestador(claseDesdeErrno(e), `no pude añadir a ${ruta}: ${e.message}`, { ruta });
  }
}

/** Lee un NDJSON saltando líneas corruptas: una línea a medias por un corte no invalida el resto. */
export function leerLineas(ruta) {
  if (!fs.existsSync(ruta)) return [];
  const fuera = [];
  for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
    if (!linea.trim()) continue;
    try { fuera.push(JSON.parse(linea)); } catch { /* línea partida por un corte: se ignora */ }
  }
  return fuera;
}

export function estadoInicial() {
  return {
    version: VERSION_ESTADO,
    tarea: null,          // { id, titulo, descripcion, criterios, origen, linea }
    paso: 'OCIOSO',
    pasoDesde: null,
    intento: 0,           // ciclos programador→revisor de este planteamiento
    replanteos: 0,
    base: null,           // sha antes de construir
    historial: [],        // [{ intento, veredicto, motivos[], resumen, cuando }]
    fallosTecnicos: {},   // { [paso]: n }
    cuotaInicio: null,
    esperandoCuota: false,
    esperaDesde: null,
    apartadas: [],        // [{ id, titulo, motivo, cuando, historial }]
    // ⚙️ LAS QUE ESPERAN LA FIRMA DE IBRAHIN (1 sep 2026).
    // Están CONSTRUIDAS, PROBADAS Y GUARDADAS EN SU RAMA — y fuera de producción. No bloquean:
    // la máquina suelta la tarea y coge la siguiente. Cada una guarda su rama para poder fundirla
    // el día que él conteste, y la promesa que se le presentó, para que el «sí» signifique algo.
    // [{ id, titulo, rama, promesa, cuando, estado: 'esperando'|'en-discusion' }]
    firmasPendientes: [],
    // Pausa pedida desde Telegram. NO corta la tarea en curso: solo impide coger otra.
    // Ésa es exactamente la promesa de «para»: termina lo que hace y no coge la siguiente.
    pausado: false,
    pausadoDesde: null,
    // Cuántas órdenes de la bandeja se han aplicado ya. La bandeja es un fichero al que solo
    // se añade, así que el número de línea vale de marcador y sobrevive a un corte.
    ordenesLeidas: 0,
    subidaPendiente: false,
    ultimoFalloSubida: null,
    arrancadoEn: null,
    actualizadoEn: null,
  };
}

export class Almacen {
  constructor({ rutaEstado, rutaJournal, rutaHistorial }) {
    this.rutaEstado = rutaEstado;
    this.rutaJournal = rutaJournal;
    this.rutaHistorial = rutaHistorial;
  }

  /**
   * Carga el estado y lo reconcilia con el journal.
   * Si el journal tiene eventos posteriores a la instantánea (corte entre los dos pasos),
   * los aplica y reescribe la instantánea. Ésta es la recuperación de la que depende todo.
   */
  recuperar() {
    let estado = estadoInicial();
    let desdeInstantanea = false;

    if (fs.existsSync(this.rutaEstado)) {
      try {
        const leido = JSON.parse(fs.readFileSync(this.rutaEstado, 'utf8'));
        if (leido && leido.version === VERSION_ESTADO) { estado = leido; desdeInstantanea = true; }
      } catch { /* instantánea corrupta: se reconstruye entera desde el journal */ }
    }

    const eventos = leerLineas(this.rutaJournal);
    const seq = estado.seq || 0;
    const pendientes = eventos.filter((e) => (e.seq || 0) > seq);

    if (!desdeInstantanea && eventos.length) {
      estado = eventos.reduce((acc, e) => aplicar(acc, e), estadoInicial());
      this._guardarInstantanea(estado);
      return { estado, reconstruido: true, eventosAplicados: eventos.length };
    }
    if (pendientes.length) {
      estado = pendientes.reduce((acc, e) => aplicar(acc, e), estado);
      this._guardarInstantanea(estado);
      return { estado, reconstruido: false, eventosAplicados: pendientes.length };
    }
    return { estado, reconstruido: false, eventosAplicados: 0 };
  }

  /**
   * Lee el estado SIN escribir nada. Es lo que usa el vigía, que corre en otro proceso.
   *
   * `recuperar()` no vale para eso: cuando encuentra el journal por delante de la
   * instantánea, la reescribe — y dos procesos reescribiendo el mismo fichero acabarían
   * pisándose. Aquí se hace la misma reconciliación en memoria y se devuelve, y punto.
   * El dueño del estado en disco es UNO: el daemon.
   */
  leerEstado() {
    let estado = estadoInicial();
    let desdeInstantanea = false;
    if (fs.existsSync(this.rutaEstado)) {
      try {
        const leido = JSON.parse(fs.readFileSync(this.rutaEstado, 'utf8'));
        if (leido && leido.version === VERSION_ESTADO) { estado = leido; desdeInstantanea = true; }
      } catch { /* a medio escribir: se reconstruye desde el journal */ }
    }
    const eventos = leerLineas(this.rutaJournal);
    if (!desdeInstantanea) return eventos.length ? eventos.reduce((a, e) => aplicar(a, e), estadoInicial()) : estado;
    const seq = estado.seq || 0;
    return eventos.filter((e) => (e.seq || 0) > seq).reduce((a, e) => aplicar(a, e), estado);
  }

  /**
   * Registra una transición. Journal primero, instantánea después.
   * Devuelve el estado nuevo; el llamante no muta nada por su cuenta.
   */
  transicion(estado, evento) {
    const seq = (estado.seq || 0) + 1;
    const completo = { seq, cuando: new Date().toISOString(), ...evento };
    anadirLinea(this.rutaJournal, completo);      // 1 · la verdad
    const nuevo = aplicar({ ...estado, seq }, completo);
    this._guardarInstantanea(nuevo);              // 2 · la comodidad
    return nuevo;
  }

  _guardarInstantanea(estado) {
    escribirAtomico(this.rutaEstado, JSON.stringify({ ...estado, actualizadoEn: new Date().toISOString() }, null, 2));
  }

  /** El historial es aparte del journal: sobrevive a un borrado del estado. */
  registrarHistorial(entrada) {
    anadirLinea(this.rutaHistorial, { cuando: new Date().toISOString(), ...entrada });
  }

  leerHistorial() { return leerLineas(this.rutaHistorial); }
}

/**
 * Reductor puro: (estado, evento) → estado. Sin efectos, sin reloj, sin disco.
 * Es lo que permite reconstruir el estado desde el journal y probarlo sin nada montado.
 */
export function aplicar(estado, e) {
  const s = { ...estado, seq: e.seq ?? estado.seq };
  switch (e.tipo) {
    case 'ARRANCADO':
      return { ...s, arrancadoEn: e.cuando };
    case 'TAREA_TOMADA':
      return { ...s, esperandoCuota: false, esperaDesde: null, tarea: e.tarea, paso: 'ANALISIS', pasoDesde: e.cuando,
               intento: 1, replanteos: 0, base: null, historial: [], fallosTecnicos: {},
               cuotaInicio: e.cuota ?? null };
    case 'PASO_INICIADO':
      return { ...s, paso: e.paso, pasoDesde: e.cuando };
    case 'BASE_FIJADA':
      return { ...s, base: e.base };
    case 'FALLO_TECNICO':
      return { ...s, fallosTecnicos: { ...s.fallosTecnicos, [e.paso]: (s.fallosTecnicos[e.paso] || 0) + 1 } };
    case 'FALLOS_TECNICOS_LIMPIADOS':
      return { ...s, fallosTecnicos: { ...s.fallosTecnicos, [e.paso]: 0 } };
    case 'VEREDICTO':
      return { ...s, historial: [...s.historial,
               { intento: s.intento, veredicto: e.veredicto, motivos: e.motivos || [], resumen: e.resumen || '', cuando: e.cuando }] };
    // base a null a propósito: el intento nuevo se mide desde HEAD, así que los commits del
    // intento anterior dejan de contar y el programador tiene que entregar algo nuevo.
    case 'REINTENTO':
      return { ...s, intento: s.intento + 1, paso: 'CONSTRUCCION', pasoDesde: e.cuando,
               base: null, fallosTecnicos: {} };
    case 'REPLANTEO':
      return { ...s, replanteos: s.replanteos + 1, intento: 1, paso: 'ANALISIS',
               pasoDesde: e.cuando, base: null, fallosTecnicos: {} };
    case 'TAREA_APARTADA':
      return { ...s, apartadas: [...s.apartadas,
               { id: s.tarea?.id, titulo: s.tarea?.titulo, motivo: e.motivo, cuando: e.cuando, historial: s.historial }],
               tarea: null, paso: 'OCIOSO', pasoDesde: e.cuando, intento: 0, replanteos: 0, base: null,
               historial: [], fallosTecnicos: {} };
    // ── LA FIRMA DE IBRAHIN ───────────────────────────────────────────────────
    case 'FIRMA_PEDIDA':
      return { ...s, tarea: null, paso: 'OCIOSO', pasoDesde: e.cuando, intento: 0, replanteos: 0,
               base: null, historial: [], fallosTecnicos: {}, cuotaInicio: null,
               firmasPendientes: [...s.firmasPendientes.filter((f) => f.id !== e.id),
                 { id: e.id, titulo: e.titulo, rama: e.rama, promesa: e.promesa,
                   cuando: e.cuando, estado: 'esperando' }] };
    case 'FIRMA_EN_DISCUSION':
      // No la saca de la lista: sigue esperando, pero se sabe que hay conversación abierta. Y no
      // bloquea nada — la máquina lleva desde el primer momento con la tarea siguiente.
      return { ...s, firmasPendientes: s.firmasPendientes.map((f) =>
                 (f.id === e.id ? { ...f, estado: 'en-discusion', desde: e.cuando } : f)) };
    case 'FIRMA_RESUELTA':
      return { ...s, firmasPendientes: s.firmasPendientes.filter((f) => f.id !== e.id) };

    case 'TAREA_CERRADA':
      return { ...s, tarea: null, paso: 'OCIOSO', pasoDesde: e.cuando, intento: 0, replanteos: 0,
               base: null, historial: [], fallosTecnicos: {},
               subidaPendiente: e.subidaPendiente ?? s.subidaPendiente };
    // ── Órdenes desde Telegram ──────────────────────────────────────────────
    case 'PAUSADO':
      return { ...s, pausado: true, pausadoDesde: e.cuando };
    case 'REANUDADO':
      return { ...s, pausado: false, pausadoDesde: null };
    case 'ORDENES_LEIDAS':
      return { ...s, ordenesLeidas: e.hasta };
    case 'DESAPARTADA':
      return { ...s, apartadas: s.apartadas.filter((a) => a.id !== e.id) };
    case 'SUBIDA_PENDIENTE':
      return { ...s, subidaPendiente: true, ultimoFalloSubida: { motivo: e.motivo, cuando: e.cuando } };
    case 'SUBIDA_HECHA':
      return { ...s, subidaPendiente: false, ultimoFalloSubida: null };
    // Ojo: NO toca `paso`. El paso real tiene que sobrevivir a la espera, porque es
    // por donde se retoma cuando vuelve la cuota.
    case 'ESPERANDO_CUOTA':
      return { ...s, esperandoCuota: true, esperaDesde: s.esperaDesde || e.cuando };
    case 'CUOTA_VUELTA':
      return { ...s, esperandoCuota: false, esperaDesde: null };
    default:
      return s;
  }
}
