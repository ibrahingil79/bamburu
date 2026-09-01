// ciclo.js — El ejecutor. Traduce las decisiones de la máquina en acciones reales.
//
// Reparto de responsabilidades, y no se mezclan:
//   · nucleo/maquina.js  decide QUÉ toca        (puro)
//   · este fichero       lo HACE                (efectos)
//   · nucleo/almacen.js  lo GUARDA              (disco)
//
// Todo lo que aquí ocurre pasa por una transición registrada en el journal ANTES de que
// cambie nada más. Si se va la luz en cualquier punto, `recuperar()` sabe dónde estaba.
import fs from 'node:fs';
import path from 'node:path';
import { decidir, ACCIONES, PASOS, pasoTrasEjecutar } from './nucleo/maquina.js';
import { ErrorOrquestador, CLASES } from './nucleo/errores.js';
import { invocar } from './ejecucion/cli.js';
import { componer } from './ejecucion/papeles.js';
import { validarAnalisis, validarRevision, validarCodigo, detectarAnalisisImposible } from './validacion/validador.js';
import { leerTablero, buscarSiguienteTarea, tareasPendientes, commitsDesde } from './reader.js';
import { cabeza, abrirRama, volverA, fundirRama, ramaDeTarea } from './cierre/git.js';
import { escribirRegistroTarea, marcarEnTablero, desmarcarEnTablero, confirmarCierre, subirTrabajo } from './cierre/cierre.js';
import { escribirAtomico, leerLineas } from './nucleo/almacen.js';
import { ORDENES } from './vigia/ordenes.js';
import { sanear } from './tablero/saneador.js';
import { confirmar, anadir } from './cierre/git.js';

// Los avisos de este fichero acaban en Telegram como HTML, igual que los de `vigia/parte.js`.
// Un título de tarea con un `<` dentro rompería el mensaje entero, así que se escapa aquí también.
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Ciclo {
  constructor({ config, almacen, vigilante, logger, invocador = invocar, reloj = () => Date.now() }) {
    this.config = config;
    this.almacen = almacen;
    this.vigilante = vigilante;
    this.log = logger;
    this.invocador = invocador;
    // El reloj se inyecta por lo mismo que en `maquina.js`: la avería del 1 sep 2026 fue
    // llegar tarde, y eso no se prueba sin poder mover las agujas.
    this.reloj = reloj;
    this.cancelables = new Set();
  }

  ahora() { return this.reloj(); }

  /**
   * Arregla el formato del tablero y devuelve el texto ya bueno.
   *
   * Nada de lo que se arregla aquí sube a Ibrahin: son problemas de cómo está ESCRITO el
   * documento, no de qué se construye. Queda anotado en el registro y en el parte.
   * Las reglas, con su motivo, están en tablero/saneador.js.
   */
  sanearTablero() {
    const texto = leerTablero(this.config.tableroAbs);
    const r = sanear(texto);

    if (!r.cambiado) {
      // Lo anotado (prosa con rótulo) no cambia el fichero, pero se dice UNA vez por arranque
      // para que no llene el registro en cada vuelta.
      if (r.anotados.length && !this._anotadoDicho) {
        this._anotadoDicho = true;
        for (const a of r.anotados) this.log.info(`Tablero · ${a.que} → ${a.comoQueda}`);
      }
      return texto;
    }

    this.log.aviso(`El tablero tenía ${r.arreglos.length} problema(s) de formato. Los arreglo yo.`);
    for (const a of r.arreglos) this.log.info(`  · ${a.que} → ${a.comoQueda} (línea ${a.linea})`);

    escribirAtomico(this.config.tableroAbs, r.texto);
    this.almacen.registrarHistorial({
      resultado: 'tablero-saneado',
      arreglos: r.arreglos.map((a) => ({ regla: a.regla, que: a.que, comoQueda: a.comoQueda, linea: a.linea })),
    });
    this.confirmarSaneo(r.arreglos);
    return r.texto;
  }

  /** El arreglo del formato se confirma solo: si no, se quedaría suelto en el árbol. */
  confirmarSaneo(arreglos) {
    const rel = path.relative(this.config.repo.raiz, this.config.tableroAbs);
    const cuerpo = arreglos.map((a) => `- ${a.que} → ${a.comoQueda} (línea ${a.linea}, regla ${a.regla})`).join('\n');
    try {
      anadir({ cwd: this.config.repo.raiz, ficheros: [rel] });
      const sha = confirmar({
        cwd: this.config.repo.raiz,
        mensaje: `Tablero — arreglo de formato automático (${arreglos.length})\n\n${cuerpo}\n\nLo arregla el orquestador con las reglas de orchestrator/tablero/saneador.js.\nNo es una decisión de producto: no sube a Ibrahin.`,
        ficheros: [rel],
      });
      this.log.exito(`Arreglo del tablero confirmado: ${sha}`);
    } catch (e) {
      // El fichero YA está arreglado en disco. Que git falle no puede parar el ciclo.
      this.log.aviso(`No pude confirmar el arreglo del tablero: ${e.message}. El fichero ya está bien.`);
    }
  }

  rutasDe(tarea) {
    const d = this.config.rutasAbs.artefactos;
    return {
      analisis: path.join(d, `task-${tarea.id}-analysis.md`),
      review: path.join(d, `task-${tarea.id}-review.md`),
      feedback: path.join(d, `task-${tarea.id}-feedback.md`),
      informe: path.join(d, `task-${tarea.id}-informe.md`),
    };
  }

  /** Todo lo que la máquina necesita saber del mundo, calculado antes de decidir. */
  observar(estado) {
    if (!estado.tarea) return {};
    const rutas = this.rutasDe(estado.tarea);
    const obs = {};

    if (estado.paso === PASOS.VALIDAR_ANALISIS || estado.paso === PASOS.ANALISIS) {
      const v = validarAnalisis(rutas.analisis, { firma: estado.tarea?.firma || '' });
      // ⚙️ `clase`, `prueba` y `pregunta` SE COPIAN (1 sep 2026). Sin ellas, la máquina no puede
      // distinguir una premisa falsa de una decisión de Ibrahin y todo acaba en el mismo cajón.
      // Y es el MISMO fallo que el 4.1 de ese encargo, en otro punto de la misma cadena: el dato
      // existía —el validador lo devolvía— y quien lo tenía en la mano no lo pasaba al siguiente.
      // Lo cazó la prueba de punta a punta, no la de la máquina: cada mitad estaba bien por su
      // lado, y lo que estaba roto era la junta. Un doble por cada mitad no ve una junta rota.
      obs.analisis = { existe: fs.existsSync(rutas.analisis), valido: v.ok, motivos: v.motivos,
                       paroArquitecto: !!v.paroArquitecto, criterios: v.criterios || [],
                       clase: v.clase || null, prueba: v.prueba || null, pregunta: v.pregunta || null };
    }
    if ((estado.paso === PASOS.VALIDAR_CODIGO || estado.paso === PASOS.CONSTRUCCION) && estado.base) {
      const imposible = detectarAnalisisImposible(rutas.informe);
      if (imposible) {
        obs.codigo = { valido: false, motivos: [`el programador dice que el análisis es imposible: ${imposible.motivo}`] };
      } else {
        const v = validarCodigo({ base: estado.base, taskId: estado.tarea.id, cwd: this.config.repo.raiz });
        obs.codigo = { valido: v.ok, motivos: v.ok ? [] : [v.resumen, ...(v.detalles || [])] };
      }
    }
    if (estado.paso === PASOS.VALIDAR_REVISION || estado.paso === PASOS.REVISION) {
      const criterios = this.criteriosDelAnalisis(rutas.analisis);
      const v = validarRevision(rutas.review, { criterios });
      obs.revision = { existe: fs.existsSync(rutas.review), veredicto: v.veredicto || null,
                       motivos: v.motivos || [], resumen: v.resumen };
    }
    return obs;
  }

  criteriosDelAnalisis(ruta) {
    const v = validarAnalisis(ruta);
    return v.criterios || [];
  }

  /**
   * Una vuelta: observar → decidir → ejecutar. Devuelve el estado nuevo y cuánto esperar.
   * No lanza: cualquier desastre se convierte en un fallo técnico registrado.
   */
  async unPaso(estado) {
    // Lo primero de la vuelta: las órdenes que Ibrahin haya dejado desde el móvil. Van antes
    // de decidir nada, porque una pausa o un salto cambian lo que toca hacer AHORA.
    const ord = await this.aplicarOrdenes(estado);
    estado = ord.estado;

    let tareaDisponible = null;
    let pendientesEnTablero = [];
    try {
      // El formato del tablero lo arregla el sistema, no Ibrahin. Antes de leer nada, se sanea.
      const texto = this.sanearTablero();
      // Una tarea apartada NO se vuelve a coger: está esperando decisión de Ibrahin. En el
      // tablero queda marcada (ver `apartar`), y esto es el cinturón por si esa marca falló.
      const vetadas = (estado.apartadas || []).map((a) => a.id).filter(Boolean);
      pendientesEnTablero = tareasPendientes(texto);
      tareaDisponible = buscarSiguienteTarea(texto, { excluir: vetadas });
    } catch (e) {
      this.log.error(`No pude leer el tablero: ${e.message}`);
      return { estado, espera: this.config.ciclo.intervaloVueltaMs };
    }

    // ⚙️ LA FIRMA SE REFRESCA DESDE EL TABLERO EN CADA VUELTA (1 sep 2026).
    //
    // Sin esto, una tarea que ya estaba en curso cuando se marcó `firma:` **se cerraría sola**: su
    // copia en el estado se guardó antes de que el campo existiera, y ahí se queda. Se vio en vivo
    // el día que se puso la regla — el daemon tenía `anclar-verifactu-fuera` a medias, sin firma en
    // su estado y sin rama, y al aprobarla habría subido a producción sin pasar por Ibrahin.
    //
    // **Una regla que se salta por llegar tarde no es una regla.** El tablero manda sobre la copia:
    // si allí dice que la firma él, la firma él, aunque la tarea se cogiera ayer.
    if (estado.tarea) {
      const enTablero = pendientesEnTablero.find((t) => t.id === estado.tarea.id);
      const firmaAhora = enTablero?.firma || '';
      if (firmaAhora !== (estado.tarea.firma || '')) {
        this.log.aviso(`«${estado.tarea.id}»: el tablero dice ahora «firma: ${firmaAhora || '(ninguna)'}». Lo aplico a la tarea en curso.`);
        estado = { ...estado, tarea: { ...estado.tarea, firma: firmaAhora } };
      }
    }

    const necesitaCuota = !!estado.tarea || !!tareaDisponible;
    // En espera se fuerza la consulta: si no, la caché y la espera se solaparían y
    // estaríamos mirando siempre una respuesta vieja.
    const cuota = necesitaCuota ? await this.vigilante.consultar({ forzar: estado.esperandoCuota }) : null;
    const obs = this.observar(estado);
    const accion = decidir({ estado, cuota, tareaDisponible, pendientesEnTablero, obs, config: this.config, ahora: this.ahora() });

    if (estado.esperandoCuota && accion.tipo !== ACCIONES.ESPERAR_CUOTA) {
      const rato = estado.esperaDesde ? Math.round((Date.now() - new Date(estado.esperaDesde).getTime()) / 60000) : 0;
      this.log.exito(`▶ Vuelve a haber cuota tras ${rato} min. Retomo en el paso ${estado.paso}.`);
      estado = this.almacen.transicion(estado, { tipo: 'CUOTA_VUELTA' });
    }
    // Tirar con la última lectura buena se anuncia SIEMPRE y antes de la decisión, porque es
    // lo que explica por qué se gastó cuota sin haberla comprobado en ese momento.
    if (accion.cuotaACiegas) this.log.aviso(`⚠️ Cuota sin leer: ${accion.avisoCuota}`);
    this.log.info(`Decisión: ${accion.tipo} — ${accion.porque}`);
    const r = await this.ejecutar({ estado, accion, cuota, tareaDisponible });
    return ord.avisos.length ? { ...r, avisos: [...ord.avisos, ...(r.avisos || [])] } : r;
  }

  /**
   * Vacía la bandeja de órdenes que deja el vigía y las aplica.
   *
   * La bandeja es un fichero al que SOLO se añade, y el marcador es el número de líneas ya
   * leídas: así una orden no se aplica dos veces aunque se vaya la luz entre aplicarla y
   * guardar el estado, y el vigía no necesita hablar con este proceso por ningún socket.
   *
   * Lo que llega aquí YA está autorizado y validado por vigia/ordenes.js: aquí no se
   * interpreta texto de nadie, solo se ejecutan entradas de una lista cerrada.
   *
   * @returns { estado, avisos } — los avisos los manda el daemon por Telegram.
   */
  async aplicarOrdenes(estado) {
    const avisos = [];
    let lineas;
    try { lineas = leerLineas(this.config.rutasAbs.ordenes); }
    catch (e) { this.log.aviso(`No pude leer la bandeja de órdenes: ${e.message}`); return { estado, avisos }; }

    const leidas = estado.ordenesLeidas || 0;
    if (lineas.length <= leidas) return { estado, avisos };

    for (const o of lineas.slice(leidas)) {
      try {
        const r = await this.aplicarUnaOrden(estado, o);
        estado = r.estado;
        if (r.aviso) avisos.push(r.aviso);
      } catch (e) {
        // Una orden que revienta no puede llevarse el ciclo ni bloquear la bandeja.
        this.log.error(`La orden «${o?.orden}» reventó: ${e.message}`);
        avisos.push(`⚠️ No pude aplicar «${o?.orden}»: ${e.message}`);
      }
    }
    estado = this.almacen.transicion(estado, { tipo: 'ORDENES_LEIDAS', hasta: lineas.length });
    return { estado, avisos };
  }

  async aplicarUnaOrden(estado, o) {
    switch (o?.orden) {
      case ORDENES.PARAR: {
        if (estado.pausado) return { estado, aviso: 'Ya estaba parado: no cojo tareas nuevas.' };
        this.log.aviso('Orden desde Telegram: PARAR. Termino lo que tengo y no cojo más.');
        estado = this.almacen.transicion(estado, { tipo: 'PAUSADO', de: o.de || 'telegram' });
        return { estado, aviso: estado.tarea
          ? `⏸ Vale. Termino «${estado.tarea.titulo}» y no cojo ninguna más hasta que me digas «arranca».`
          : '⏸ Vale. No cojo ninguna tarea hasta que me digas «arranca».' };
      }
      case ORDENES.ARRANCAR: {
        if (!estado.pausado) return { estado, aviso: '▶️ Ya estaba en marcha.' };
        this.log.exito('Orden desde Telegram: ARRANCAR. Vuelvo a coger tareas.');
        estado = this.almacen.transicion(estado, { tipo: 'REANUDADO', de: o.de || 'telegram' });
        return { estado, aviso: '▶️ En marcha. Vuelvo a coger tareas del tablero.' };
      }
      case ORDENES.SALTAR: {
        if (!estado.tarea) return { estado, aviso: 'No tengo ninguna tarea entre manos: no hay nada que saltar.' };
        const { titulo, id } = estado.tarea;
        this.log.aviso(`Orden desde Telegram: SALTAR «${titulo}».`);
        // Se aparta, no se borra: si no quedara marcada en el tablero, la volvería a coger
        // en la vuelta siguiente y estaríamos en un bucle. Y así se puede desapartar luego.
        const r = await this.apartar({
          estado,
          accion: { motivo: 'la saltaste tú desde Telegram', detalle: [], decisionDeProducto: true },
        });
        return { estado: r.estado, aviso: `⏭ Saltada «${titulo}». Queda apartada por si la quieres recuperar («desapartar ${id}»). Sigo con la siguiente.` };
      }
      case ORDENES.DESAPARTAR: {
        const ap = (estado.apartadas || []).find((a) => a.id === o.id);
        if (!ap) return { estado, aviso: `No tengo ninguna tarea apartada que se llame «${o.id}».` };
        const r = desmarcarEnTablero({ config: this.config, id: o.id, logger: this.log });
        if (!r.ok) return { estado, aviso: `No pude devolverla al montón: ${r.motivo}` };
        confirmarCierre({
          config: this.config, tarea: { id: o.id, titulo: ap.titulo || o.id },
          ficheros: [this.config.tableroAbs], logger: this.log,
        });
        estado = this.almacen.transicion(estado, { tipo: 'DESAPARTADA', id: o.id, de: o.de || 'telegram' });
        this.log.exito(`Orden desde Telegram: DESAPARTAR «${o.id}». Vuelve a estar pendiente.`);
        return { estado, aviso: `↩️ «${ap.titulo || o.id}» vuelve a estar pendiente. La cogeré cuando le toque.` };
      }
      // ── LAS TRES RESPUESTAS A UNA FIRMA (1 sep 2026) ──────────────────────
      case ORDENES.APROBAR:
      case ORDENES.RECHAZAR:
      case ORDENES.HABLAR:
        return this.responderFirma(estado, o);

      default:
        return { estado, aviso: null };
    }
  }

  /**
   * Ibrahin contesta a una tarea que esperaba su firma. Tres respuestas y solo tres.
   *
   * NINGUNA BLOQUEA NADA: la tarea se soltó al pedir la firma, así que la máquina lleva desde
   * entonces con la siguiente. Esto solo decide qué pasa con una rama que ya está terminada.
   */
  async responderFirma(estado, o) {
    const pendientes = estado.firmasPendientes || [];
    if (!pendientes.length) return { estado, aviso: 'No hay ninguna tarea esperando tu firma ahora mismo.' };

    // Sin id, solo vale si hay UNA esperando. Con varias se pregunta: aprobar la que no era es
    // meter en producción una promesa que no se quería.
    let f = o.id ? pendientes.find((x) => x.id === o.id) : (pendientes.length === 1 ? pendientes[0] : null);
    if (!f) {
      const lista = pendientes.map((x) => `• ${x.titulo}\n  <i>${o.orden.toLowerCase()} ${x.id}</i>`).join('\n');
      return { estado, aviso: o.id
        ? `No tengo ninguna tarea esperando firma que se llame «${o.id}». Están esperando:\n\n${lista}`
        : `Hay ${pendientes.length} esperando tu firma. ¿Cuál?\n\n${lista}` };
    }

    if (o.orden === ORDENES.HABLAR) {
      this.log.info(`Ibrahin quiere hablar de «${f.id}» antes de firmarla.`);
      estado = this.almacen.transicion(estado, { tipo: 'FIRMA_EN_DISCUSION', id: f.id });
      return { estado, aviso: `💬 Vale, «${esc(f.titulo)}» se queda esperando y hablamos.\n\n`
        + `Lo que se te propuso:\n<i>${esc((f.promesa || 'el arquitecto no dejó escrita la promesa').slice(0, 600))}</i>\n\n`
        + `No bloquea nada: sigo con lo siguiente. Cuando lo tengas, dime «apruebo ${f.id}» o «rechazo ${f.id}».` };
    }

    if (o.orden === ORDENES.RECHAZAR) {
      const motivo = (o.texto || '').replace(/\s+/g, ' ').trim() || 'sin motivo escrito';
      this.log.aviso(`Ibrahin RECHAZA «${f.id}»: ${motivo}`);
      // La rama NO se borra: lo construido sigue ahí para el siguiente intento. Lo que se hace es
      // devolver la tarea a la cola con el motivo delante, que es como vuelve un rechazo del revisor.
      const r = desmarcarEnTablero({ config: this.config, id: f.id, logger: this.log });
      estado = this.almacen.transicion(estado, { tipo: 'FIRMA_RESUELTA', id: f.id });
      this.almacen.registrarHistorial({ id: f.id, titulo: f.titulo, resultado: 'firma-rechazada', motivo });
      return { estado, aviso: `↩️ «${esc(f.titulo)}» vuelve a la cola con tu motivo delante.\n\n`
        + `<i>${esc(motivo)}</i>\n\n`
        + `Lo construido no se tira: sigue en la rama <code>${esc(f.rama)}</code>${r.ok ? '' : ' (ojo: no pude desmarcarla del tablero)'}. `
        + `Y NO está en producción — nunca llegó a estarlo.` };
    }

    // ── APROBAR: es lo ÚNICO que mete algo en producción ──────────────────────
    this.log.exito(`Ibrahin APRUEBA «${f.id}». Fundo ${f.rama} en ${this.config.repo.ramaPrincipal}.`);
    const fus = fundirRama({ cwd: this.config.repo.raiz, id: f.id, ramaDestino: this.config.repo.ramaPrincipal });
    if (!fus.ok) {
      this.log.error(`No pude fundir «${f.rama}»: ${fus.motivo}`);
      return { estado, aviso: `⚠️ Dijiste que sí, pero no he podido meterla en producción:\n\n<i>${esc(fus.motivo)}</i>\n\n`
        + `La tarea sigue esperando y NADA ha cambiado en producción. Hace falta una persona para esto.` };
    }
    const sub = subirTrabajo({ config: this.config, logger: this.log });
    estado = this.almacen.transicion(estado, { tipo: 'FIRMA_RESUELTA', id: f.id });
    this.almacen.registrarHistorial({ id: f.id, titulo: f.titulo, resultado: 'firmada-y-cerrada', rama: f.rama, subida: sub.ok });
    if (!sub.ok && !sub.omitida) estado = this.almacen.transicion(estado, { tipo: 'SUBIDA_PENDIENTE', motivo: sub.motivo });
    return { estado, aviso: `✅ Firmada y en producción: <b>${esc(f.titulo)}</b>.\n\n`
      + `${sub.ok ? 'Subida a GitHub.' : 'Queda por subir a GitHub, lo reintento solo.'}` };
  }

  async ejecutar({ estado, accion, cuota, tareaDisponible }) {
    const cfg = this.config.ciclo;

    switch (accion.tipo) {
      case ACCIONES.OCIOSO: {
        // Ocioso con el tablero lleno NO es ocioso: es una avería.
        //   · `averia`     → manda el aviso suelto. Sale UNA vez por avería distinta; si no,
        //                    serían 60 mensajes de Telegram por hora.
        //   · `averiaViva` → va en cada vuelta, y en el parte de las 3 h mientras siga rota.
        //                    Vale `null` cuando se arregla, y así el parte deja de decirlo.
        if (!accion.averia) {
          this._averiaAvisada = null;
          return { estado, espera: cfg.intervaloVueltaMs, averiaViva: null };
        }
        const a = accion.averia;
        this.log.error(`🚨 AVERÍA: ${a.motivo}`);
        for (const n of a.nombres) this.log.error(`   · sin coger: ${n}`);

        const firma = `${a.clase}:${a.pendientes}:${a.nombres.join('|')}`;
        const yaAvisada = this._averiaAvisada === firma;
        this._averiaAvisada = firma;
        return { estado, espera: cfg.intervaloVueltaMs, averiaViva: a, averia: yaAvisada ? null : a };
      }

      case ACCIONES.SALTAR: {
        this.log.info(`Salto al paso ${accion.paso}: ${accion.porque}`);
        estado = this.almacen.transicion(estado, { tipo: 'PASO_INICIADO', paso: accion.paso });
        return { estado, espera: 0 };
      }

      case ACCIONES.ESPERAR_CUOTA: {
        if (!estado.esperandoCuota) {
          this.log.aviso(`⏸ Espero: ${accion.porque}`);
          if (estado.tarea) this.log.info(`La tarea queda intacta en el paso ${estado.paso}.`);
          estado = this.almacen.transicion(estado, { tipo: 'ESPERANDO_CUOTA', motivo: accion.porque });
        }
        // CUÁNTO se va a dormir, en cada vuelta y no solo en la primera. Antes se anunciaba la
        // hora del reinicio UNA vez, al empezar a esperar, y luego el registro callaba: quien
        // lo miraba a mitad no tenía forma de saber si el daemon iba a despertarse a tiempo.
        this.log.info(this.comoEspera(accion));
        return { estado, espera: accion.esperaMs };
      }

      case ACCIONES.TOMAR_TAREA: {
        this.log.exito(`Tomo «${accion.tarea.titulo}» (${accion.tarea.id}).`);
        // ⚙️ SI LA FIRMA IBRAHIN, SE TRABAJA EN SU PROPIA RAMA (1 sep 2026). Master no se toca.
        //
        // No es una preferencia de git: es lo que impide repetir lo del cifrado. El programador
        // commitea en CONSTRUCCIÓN, dos pasos antes del cierre, y master **es** el producto — los
        // tres servicios de copia ejecutan de cero cada noche desde `/home/ubuntu/bamburu/scripts/`.
        // Aquel día la tarea se apartó y su código se quedó en master igual: las copias de esa
        // noche iban a abortar. Con la rama, lo que espera firma no está en producción.
        if (accion.tarea.firma) {
          try {
            const r = abrirRama({ cwd: this.config.repo.raiz, id: accion.tarea.id, desde: this.config.repo.ramaPrincipal });
            this.log.info(`Esta tarea la firma ${accion.tarea.firma}: trabajo en «${r.rama}». ${this.config.repo.ramaPrincipal} no se toca.`);
          } catch (e) {
            // Sin rama NO se coge la tarea: trabajarla en master sería justo lo que esto impide.
            this.log.error(`No pude abrir la rama de «${accion.tarea.id}»: ${e.message}. No la cojo.`);
            return { estado, espera: this.config.ciclo.intervaloVueltaMs };
          }
        }
        estado = this.almacen.transicion(estado, {
          tipo: 'TAREA_TOMADA', tarea: accion.tarea, cuota: cuota?.sesionPct ?? null,
        });
        return { estado, espera: 0 };
      }

      case ACCIONES.EJECUTAR:
        // La cuota ya leída en esta vuelta entra como marca de salida del contador del papel:
        // así medir un paso no cuesta una consulta de más al empezarlo.
        return this.ejecutarPapel({ estado, accion, cuota });

      case ACCIONES.REINTENTAR: {
        this.log.aviso(`Rechazado. Vuelvo al programador (intento ${accion.intentoSiguiente}).`);
        estado = this.almacen.transicion(estado, { tipo: 'VEREDICTO', veredicto: 'rechazado', motivos: accion.motivos, resumen: accion.resumen });
        this.escribirFeedback(estado, accion.motivos);
        this.archivar(estado, 'review', `-intento-${estado.intento}`);
        estado = this.almacen.transicion(estado, { tipo: 'REINTENTO' });
        return { estado, espera: 0 };
      }

      case ACCIONES.REPLANTEAR: {
        this.log.aviso('Tres rechazos: no repito. Mando replantear la tarea desde cero.');
        estado = this.almacen.transicion(estado, { tipo: 'VEREDICTO', veredicto: 'rechazado', motivos: accion.motivos, resumen: accion.resumen });
        this.escribirFeedback(estado, accion.motivos);
        // El análisis anterior se aparta: si se queda, el arquitecto lo daría por bueno y
        // el paso se saltaría, que es justo lo contrario de replantear.
        this.archivar(estado, 'analisis', `-replanteo-${estado.replanteos}`);
        this.archivar(estado, 'review', `-replanteo-${estado.replanteos}`);
        estado = this.almacen.transicion(estado, { tipo: 'REPLANTEO' });
        return { estado, espera: 0 };
      }

      case ACCIONES.APARTAR:
        return this.apartar({ estado, accion, cuota });

      case ACCIONES.CERRAR_PREMISA_FALSA:
        return this.cerrarPorPremisaFalsa({ estado, accion, cuota });

      case ACCIONES.CERRAR:
        return this.cerrar({ estado, cuota });

      case ACCIONES.PEDIR_FIRMA:
        return this.pedirFirma({ estado, accion, cuota });

      case ACCIONES.REINTENTAR_SUBIDA: {
        const r = subirTrabajo({ config: this.config, logger: this.log });
        if (r.ok) estado = this.almacen.transicion(estado, { tipo: 'SUBIDA_HECHA' });
        else if (r.conflicto) this.log.error('El conflicto sigue. No lo vuelvo a intentar hasta que alguien lo arregle.');
        return { estado, espera: r.ok || r.conflicto ? 0 : this.config.subida.esperaBaseMs };
      }

      default:
        this.log.error(`Acción que no sé ejecutar: ${accion.tipo}`);
        return { estado, espera: cfg.intervaloVueltaMs };
    }
  }

  /**
   * Cómo se cuenta una espera de cuota en el registro. En castellano y con las dos cosas que
   * hacen falta para juzgarla desde fuera: qué ventana manda y cuándo se vuelve a mirar.
   */
  comoEspera(accion) {
    const min = Math.max(1, Math.round(accion.esperaMs / 60000));
    const seg = Math.max(1, Math.round(accion.esperaMs / 1000));
    const cual = accion.ventana === 'semanal' ? 'la ventana SEMANAL' : 'la ventana de sesión';
    // ⚙️ NO SABERLA NO ES NO TENERLA (1 sep 2026). Esta espera decía siempre «manda la ventana
    // de sesión», también cuando lo que pasaba era que la LECTURA había fallado. Es una frase
    // falsa en el peor momento: quien mira el registro entiende «se acabó la cuota» y se va
    // tranquilo, cuando lo que hay es un instrumento roto y un 32 % sin usar.
    if (accion.desconocida) {
      const espera = accion.esperaMs < 60000 ? `${seg} s` : `${min} min`;
      return `No es que no quede: es que no la he podido LEER. Vuelvo a intentarlo en ${espera}.`;
    }
    if (!accion.reinicio) {
      return `Manda ${cual}. No sé a qué hora se reinicia, así que vuelvo a mirar en ${min} min.`;
    }
    // TRES CASOS, no dos, y el tercero se añadió a los diez minutos de escribir los dos primeros
    // (1 sep 2026, verificando esto en vivo): con el reinicio a tres horas y media, el registro
    // decía «Sep 1, 1pm (UTC), que YA PASÓ» a las 09:23. No había pasado — solo estaba más lejos
    // que el sondeo. Colapsar «lejos» y «caducado» en la misma frase es exactamente la clase de
    // afirmación falsa que este encargo vino a quitar, y la escribí yo arreglándolo.
    const falta = Number.isFinite(accion.reinicioMs) ? accion.reinicioMs - this.ahora() : null;
    if (falta === null || falta <= 0) {
      return `Manda ${cual} y dice reiniciarse ${accion.reinicio}, que ya pasó o no sé leer: vuelvo a mirar en ${min} min.`;
    }
    if (accion.esperaMs < this.config.cuota.esperaSinCuotaMs) {
      return `Manda ${cual} y se reinicia ${accion.reinicio}: me despierto entonces, en ${min} min.`;
    }
    const h = (falta / 3600000).toFixed(1);
    return `Manda ${cual} y se reinicia ${accion.reinicio}, dentro de ${h} h. Es más de lo que duermo de una vez: vuelvo a mirar en ${min} min.`;
  }

  /**
   * QUÉ SE HA GASTADO ESTE PAPEL. Se apunta al terminar cada llamada.
   *
   * ⚙️ POR QUÉ HACEN FALTA DOS NÚMEROS Y NO UNO (1 sep 2026). Se guardan los dos porque miden
   * cosas distintas y ninguno vale solo:
   *
   *   · **Puntos de ventana** es la moneda en la que duele —es lo que deja al daemon parado y
   *     lo que se le come a Ibrahin el chat—, pero la ventana es DESLIZANTE: mientras un papel
   *     trabaja, gasto viejo va caducando, así que la resta puede salir corta e incluso
   *     negativa. Sirve para el orden de magnitud, no para sumar con precisión.
   *   · **`total_cost_usd`** lo da el CLI por llamada, es aditivo y no se mueve solo. Es el que
   *     permite comparar de verdad el antes y el después de cambiar el modelo de un papel.
   *
   * Preguntar la cuota al terminar cuesta CERO tokens (medido el 1 sep 2026: 21 lecturas de
   * `/usage`, 0 turnos, 0 tokens, 0 $). Si costara, esta medición no se podría permitir.
   */
  async medirPapel({ estado, papel, modelo, r, cuotaAntes }) {
    let puntos = null;
    try {
      const antes = cuotaAntes?.fiable ? cuotaAntes.sesionPct : null;
      const despues = this.vigilante ? (await this.vigilante.consultar({ forzar: true })) : null;
      if (Number.isFinite(antes) && despues?.fiable) puntos = despues.sesionPct - antes;
    } catch { /* medir no puede tumbar un paso: el desglose se queda sin ese dato y ya está */ }

    const g = this.almacen.transicion(estado, {
      tipo: 'PAPEL_MEDIDO', papel, modelo, ms: r.ms || 0,
      costeUsd: Number.isFinite(r.coste) ? r.coste : 0, puntos,
    });
    const t = g.gastoPorPapel[papel];
    this.log.info(`Gasto de ${papel} (${modelo}): ${puntos == null ? 'puntos ?' : `${puntos.toFixed(0)} pts`}`
      + ` · ${(r.coste ?? 0).toFixed(4)} $ · ${Math.round((r.ms || 0) / 1000)} s`
      + `  ‹acumulado de la tarea: ${t.puntos.toFixed(0)} pts · ${t.costeUsd.toFixed(4)} $ en ${t.llamadas} llamada(s)›`);
    return g;
  }

  /** Lanza un papel y avanza al paso de validación correspondiente. */
  async ejecutarPapel({ estado, accion, cuota = null }) {
    const cfg = this.config.ciclo;
    const tarea = estado.tarea;
    const rutas = this.rutasDe(tarea);
    fs.mkdirSync(path.dirname(rutas.analisis), { recursive: true });

    if (accion.fijarBase && !estado.base) {
      const base = cabeza(this.config.repo.raiz);
      estado = this.almacen.transicion(estado, { tipo: 'BASE_FIJADA', base });
      this.log.info(`Referencia para contar commits: ${base.slice(0, 7)}`);
    }
    if (estado.paso !== accion.paso) {
      estado = this.almacen.transicion(estado, { tipo: 'PASO_INICIADO', paso: accion.paso });
    }

    const commits = estado.base ? commitsDesde(estado.base, this.config.repo.raiz) : [];
    const prompt = componer({
      papel: accion.papel,
      rutaPapel: this.config.rolesAbs[accion.papel],
      tarea, rutas, estado,
      extra: { motivos: accion.motivos, rehacer: accion.rehacer, base: estado.base, commits },
    });
    escribirAtomico(path.join(this.config.rutasAbs.logs, `prompt-${tarea.id}-${accion.papel}.txt`), prompt);

    // ⚙️ EL MODELO DE CADA PAPEL SALE EN EL REGISTRO (1 sep 2026). No es adorno: desde que cada
    // papel lleva el suyo, «qué modelo atendió este paso» es un dato que hace falta para juzgar
    // un rechazo. Si el revisor empieza a rechazar más de la cuenta, lo primero que hay que poder
    // mirar es con qué construyó el programador, y eso tiene que estar en la línea del paso.
    const modelo = this.config.cli.modeloPorPapel[accion.papel];
    this.log.paso(accion.paso, `${accion.papel.toUpperCase()} (${modelo}) — ${accion.porque}`);
    // El cancelador se APUNTA al empezar y se BORRA al terminar. Antes solo se apuntaba, así que
    // el conjunto crecía una entrada por llamada y `cancelarTodo()` acababa mandando SIGTERM al
    // grupo de procesos de llamadas muertas hace horas — y un pid se reutiliza.
    let miCancelador = null;
    const r = await this.invocador({
      prompt,
      herramientas: this.config.cli.herramientasPorPapel[accion.papel] || [],
      cwd: this.config.repo.raiz,
      config: this.config,
      modelo,
      alSalir: (cancelar) => { miCancelador = cancelar; this.cancelables.add(cancelar); },
    }).finally(() => { if (miCancelador) this.cancelables.delete(miCancelador); });

    // Se mide SIEMPRE, haya salido bien o mal: una llamada que falla a los 20 minutos también
    // se ha gastado la cuota, y dejarla fuera del recuento haría que el desglose por papel
    // mintiera justo en los días malos.
    estado = await this.medirPapel({ estado, papel: accion.papel, modelo, r, cuotaAntes: cuota });
    if (r.ok && r.modeloServido?.length && !r.modeloServido.some((m) => m.includes(modelo.replace(/^claude-/, '')))) {
      this.log.aviso(`⚠️ Pedí «${modelo}» y atendió «${r.modeloServido.join(', ')}». Míralo antes de fiarte de la comparación de gasto.`);
    }

    if (r.ok) {
      this.log.exito(`${accion.papel} terminó en ${Math.round(r.ms / 1000)} s.`);
      if (r.denegadas?.length) {
        this.log.aviso(`Le denegaron ${r.denegadas.join(', ')}, pero entregó igual. Lo juzga la validación.`);
      }
      if (estado.fallosTecnicos[accion.paso]) {
        estado = this.almacen.transicion(estado, { tipo: 'FALLOS_TECNICOS_LIMPIADOS', paso: accion.paso });
      }
      estado = this.almacen.transicion(estado, { tipo: 'PASO_INICIADO', paso: pasoTrasEjecutar(accion.paso) });
      return { estado, espera: 0 };
    }

    // Falló. Aquí se distingue lo que el encargo manda distinguir.
    const err = r.error || new ErrorOrquestador(CLASES.DESCONOCIDO, 'fallo sin detalle');
    this.log.error(`${accion.papel} falló: ${err.humano} — ${err.message}`);

    if (err.esperaCuota) {
      // No cuenta como intento: no falló el trabajo, faltó el combustible.
      this.vigilante.marcarSinCuota(err.message);
      estado = this.almacen.transicion(estado, { tipo: 'ESPERANDO_CUOTA', motivo: err.message });
      this.log.info(`La tarea queda intacta en el paso ${estado.paso}: se retoma ahí.`);
      return { estado, espera: this.config.cuota.esperaSinCuotaMs };
    }
    if (err.clase === CLASES.LLAMADA_CORTADA) {
      // La cortamos nosotros al parar: no es un fallo del papel y NO gasta intento. Mismo
      // criterio que la cuota. Si contara, tres `systemctl restart` seguidos apartarían una
      // tarea que nunca falló (1 sep 2026, al verificar la parada).
      this.log.info(`La llamada se cortó al parar. La tarea sigue en el paso ${estado.paso}, intacta.`);
      return { estado, espera: 0 };
    }
    if (!err.reintentable) {
      this.log.error('Esto no se arregla reintentando: es configuración o disco.');
      return { estado, espera: this.config.cuota.esperaSinCuotaMs };
    }

    estado = this.almacen.transicion(estado, { tipo: 'FALLO_TECNICO', paso: accion.paso, clase: err.clase, mensaje: err.message });
    const n = estado.fallosTecnicos[accion.paso] || 0;
    if (n >= cfg.maxFallosTecnicosPorPaso) {
      return this.apartar({ estado, accion: { motivo: `${accion.papel} falló ${n} veces seguidas (${err.humano})`, detalle: [err.message], decisionDeProducto: false } });
    }
    this.log.aviso(`Fallo técnico ${n} de ${cfg.maxFallosTecnicosPorPaso}: reintento el mismo paso.`);
    return { estado, espera: cfg.esperaTrasFalloTecnicoMs };
  }

  /**
   * La tarea está TERMINADA y PROBADA, y espera a que Ibrahin diga si esa promesa se hace.
   *
   * ⚙️ LA REGLA QUE MANDA AQUÍ: **lo que se presenta a firmar está terminado o no está.** Nada de
   * dejarlo a medias en producción esperando el «sí» — que es exactamente lo que pasó con el
   * cifrado de las copias el 1 sep 2026 y estuvo a unas horas de dejar a Ibrahin sin copia en las
   * dos cuentas. Por eso, lo último que hace este paso es **volver a la rama principal**: el árbol
   * de trabajo ES el producto, y el trabajo sin firmar se queda en su rama.
   *
   * Y NO BLOQUEA: suelta la tarea. La máquina coge la siguiente en la vuelta de dentro de nada.
   */
  async pedirFirma({ estado, accion, cuota = null }) {
    const tarea = estado.tarea;
    const rutas = this.rutasDe(tarea);
    const rama = ramaDeTarea(tarea.id);
    this.log.exito(`✍️ «${tarea.titulo}» está terminada y espera la firma de ${accion.quien}.`);

    const commits = estado.base ? commitsDesde(estado.base, this.config.repo.raiz) : [];
    const criterios = this.criteriosDelAnalisis(rutas.analisis);
    const promesa = this.promesaDelAnalisis(rutas.analisis);

    // El registro y la marca del tablero se escriben EN LA RAMA, con lo demás. Si Ibrahin aprueba,
    // vienen con el merge; si rechaza, se van con la rama. No queda rastro suelto en master.
    const registro = escribirRegistroTarea({
      config: this.config, tarea, estado, rutas, commits, criterios, consumo: cuota,
      esperandoFirma: { quien: accion.quien, rama, promesa },
    });
    const ficheros = [registro, rutas.analisis, rutas.review].filter((f) => fs.existsSync(f));
    confirmarCierre({ config: this.config, tarea, ficheros, logger: this.log });

    // ── Y AQUÍ ESTÁ LA LÍNEA QUE IMPIDE EL FALLO DEL CIFRADO ──────────────────
    let volvio = null;
    try {
      volvio = volverA({ cwd: this.config.repo.raiz, rama: this.config.repo.ramaPrincipal });
      this.log.info(`Vuelvo a ${this.config.repo.ramaPrincipal}: lo de «${tarea.id}» queda en «${rama}», fuera de producción.`);
    } catch (e) {
      // ── LO MÁS GRAVE QUE PUEDE PASAR AQUÍ, Y SE PORTA COMO TAL ───────────────
      // Si no se puede volver, el árbol de trabajo —que ES el producto— se queda con código que
      // Ibrahin no ha firmado. No basta con escribirlo en un registro que nadie mira: se manda
      // AVERÍA al momento y **se deja de coger tareas**, porque cada tarea nueva encima de una
      // rama sin firmar empeora el enredo.
      //
      // Esto salió de la propia prueba de punta a punta, que reventó aquí por un motivo tonto
      // (el repo de usar y tirar no ignoraba lo que ignora el de verdad). El motivo era tonto;
      // la consecuencia no, y el camino existe.
      this.log.error(`🚨 NO PUDE VOLVER A ${this.config.repo.ramaPrincipal}: ${e.message}`);
      this.log.error(`   El árbol se queda en «${rama}» y ESO ES CÓDIGO SIN FIRMAR EN PRODUCCIÓN.`);
      estado = this.almacen.transicion(estado, { tipo: 'PAUSADO', de: 'rama sin firmar en producción' });
      return { estado, espera: this.config.ciclo.intervaloVueltaMs,
        averia: { clase: 'rama-sin-firmar-en-produccion', pendientes: 0, nombres: [tarea.titulo],
          motivo: `«${tarea.titulo}» está terminada pero NO HE PODIDO sacarla de producción: el árbol `
            + `se ha quedado en la rama «${rama}» y ahí hay código que no has firmado. `
            + `Me paro y no cojo más tareas hasta que alguien lo mire. El motivo de git fue: ${e.message}` } };
    }

    this.almacen.registrarHistorial({
      id: tarea.id, titulo: tarea.titulo, resultado: 'esperando-firma', rama,
      intentos: estado.historial.length, replanteos: estado.replanteos,
      commits: commits.length, cuotaFin: cuota?.sesionPct ?? null, cuotaIni: estado.cuotaInicio,
      gastoPorPapel: estado.gastoPorPapel || {},
    });
    estado = this.almacen.transicion(estado, {
      tipo: 'FIRMA_PEDIDA', id: tarea.id, titulo: tarea.titulo, rama, promesa,
    });
    return { estado, espera: 0,
             firmaPedida: { tarea, quien: accion.quien, rama, promesa, criterios, commits: commits.length,
                            volvioAPrincipal: !!volvio } };
  }

  /**
   * La promesa que el arquitecto escribió para Ibrahin. NO describe el código: describe qué cambia
   * para quien usa Bamburu. Es lo único de todo el análisis que va a leer una persona en un móvil.
   */
  promesaDelAnalisis(ruta) {
    // Se lee por líneas, no con una expresión regular. La primera versión usaba `\Z` para decir
    // «hasta el final», que es de otro lenguaje: en JavaScript `\Z` es una «Z» literal, así que
    // la promesa solo se encontraba si detrás había una Z suelta. Lo cazó la prueba de punta a
    // punta. Por líneas se lee peor y se entiende mejor, y aquí manda entenderlo.
    try {
      const lineas = fs.readFileSync(ruta, 'utf8').split('\n');
      const i = lineas.findIndex((l) => /^#{1,4}[ \t]*LA PROMESA[ \t]*$/i.test(l));
      if (i === -1) return null;
      const fuera = [];
      for (const l of lineas.slice(i + 1)) {
        // Termina en el siguiente título, o en el bloque de criterios, que suele ir detrás.
        if (/^#{1,4}[ \t]/.test(l) || /^\s*\*\*criterios/i.test(l)) break;
        fuera.push(l);
      }
      const t = fuera.join('\n').trim();
      return t || null;
    } catch { return null; }
  }

  async cerrar({ estado, cuota }) {
    const tarea = estado.tarea;
    const rutas = this.rutasDe(tarea);
    if (estado.paso !== PASOS.CIERRE) {
      estado = this.almacen.transicion(estado, { tipo: 'PASO_INICIADO', paso: PASOS.CIERRE });
    }
    estado = this.almacen.transicion(estado, { tipo: 'VEREDICTO', veredicto: 'aprobado', motivos: [], resumen: 'aprobado por el revisor' });

    const commits = estado.base ? commitsDesde(estado.base, this.config.repo.raiz) : [];
    const criterios = this.criteriosDelAnalisis(rutas.analisis);
    // Todo lo que va al disco, primero. Después, un único commit.
    const registro = escribirRegistroTarea({ config: this.config, tarea, estado, rutas, commits, criterios, consumo: cuota });
    const tab = marcarEnTablero({ config: this.config, tarea, commits, registro, logger: this.log });

    const ficheros = [registro, rutas.analisis, rutas.review].filter((f) => fs.existsSync(f));
    if (tab.escrito) ficheros.push(this.config.tableroAbs);
    if (tab.destino) ficheros.push(tab.destino);

    const conf = confirmarCierre({ config: this.config, tarea, ficheros, logger: this.log });
    const sub = conf.ok ? subirTrabajo({ config: this.config, logger: this.log }) : { ok: false, motivo: 'no hubo commit que subir' };

    this.almacen.registrarHistorial({
      id: tarea.id, titulo: tarea.titulo, resultado: 'cerrada',
      intentos: estado.historial.length, replanteos: estado.replanteos,
      commits: commits.length, subida: sub.ok, cuotaFin: cuota?.sesionPct ?? null, cuotaIni: estado.cuotaInicio,
      gastoPorPapel: estado.gastoPorPapel || {},
    });

    if (!sub.ok && !sub.omitida) {
      estado = this.almacen.transicion(estado, { tipo: 'SUBIDA_PENDIENTE', motivo: sub.motivo });
    } else if (sub.ok) {
      estado = this.almacen.transicion(estado, { tipo: 'SUBIDA_HECHA' });
    }

    this.log.exito(`✅ «${tarea.titulo}» cerrada.`);
    estado = this.almacen.transicion(estado, { tipo: 'TAREA_CERRADA', id: tarea.id });
    return { estado, espera: 0, cerrada: tarea };
  }

  async apartar({ estado, accion, cuota = null }) {
    const tarea = estado.tarea;
    const rutas = this.rutasDe(tarea);
    this.log.error(`⛔ Aparto «${tarea.titulo}»: ${accion.motivo}`);
    // Una tarea apartada TAMBIÉN deja su registro, aunque no haya código que subir.
    const registro = escribirRegistroTarea({
      config: this.config, tarea, estado, rutas,
      commits: estado.base ? commitsDesde(estado.base, this.config.repo.raiz) : [],
      criterios: this.criteriosDelAnalisis(rutas.analisis), consumo: cuota, apartada: accion.motivo,
    });
    this.log.info(`Registro de la tarea apartada: ${path.relative(this.config.repo.raiz, registro)}`);

    // El tablero tiene que enterarse. Si no, la tarea sigue diciendo «pendiente» y el lector
    // —que desde el 31 ago 2026 coge por `estado:`— la volvería a coger en la vuelta siguiente,
    // y en la siguiente, sin fin. La marca es lo que rompe ese bucle.
    const tab = marcarEnTablero({
      config: this.config, tarea, commits: [], registro, logger: this.log, apartada: accion.motivo,
    });
    const ficheros = [registro].concat(tab.escrito ? [this.config.tableroAbs] : []).concat(tab.destino ? [tab.destino] : []);
    confirmarCierre({ config: this.config, tarea, ficheros: ficheros.filter((f) => fs.existsSync(f)), logger: this.log });

    this.almacen.registrarHistorial({
      id: tarea.id, titulo: tarea.titulo, resultado: 'apartada', motivo: accion.motivo,
      intentos: estado.historial.length, replanteos: estado.replanteos, decisionDeProducto: !!accion.decisionDeProducto,
      // Una tarea APARTADA es la que más caro sale: tres intentos pagados y nada entregado.
      // Dejarla fuera del desglose haría que el coste medio por papel pareciera más barato de
      // lo que es, y justo en el caso que hay que vigilar al bajar de modelo.
      gastoPorPapel: estado.gastoPorPapel || {},
    });

    const apartada = { tarea, motivo: accion.motivo, historial: estado.historial,
                       clase: accion.clase || 'sin-clasificar', pregunta: accion.pregunta || null,
                       detalle: accion.detalle || [] };
    estado = this.almacen.transicion(estado, { tipo: 'TAREA_APARTADA', motivo: accion.motivo, detalle: accion.detalle || [] });
    return { estado, espera: 0, apartada };
  }

  /**
   * Cierra una tarea cuya premisa el arquitecto demostró FALSA. No sube a Ibrahin.
   *
   * ⚙️ POR QUÉ EXISTE (1 sep 2026). Ese día le llegaron DOS avisos al móvil pidiéndole una
   * decisión, y ninguno lo era: las seis pantallas muertas llevaban **ocho días borradas** —se
   * retiraron el 24 ago, el mismo día en que se escribió la deuda que decía que seguían ahí— y el
   * cifrado de las copias estaba mal redactado. **Los dos avisos decían la misma frase: «No es un
   * error técnico: es una decisión de producto». Las dos veces era falso.**
   *
   * Una entrada podrida del tablero no es una decisión de nadie: es basura, y cada una le costaba
   * a Ibrahin una interrupción y una decisión que no existía. Se cierra sola **con la prueba
   * escrita en el tablero**, y sale en el parte de las tres horas como información, no como alarma.
   */
  async cerrarPorPremisaFalsa({ estado, accion, cuota = null }) {
    const tarea = estado.tarea;
    const rutas = this.rutasDe(tarea);
    this.log.exito(`✅ Cierro «${tarea.titulo}» sola: su premisa es falsa y está demostrado.`);
    this.log.info(`   Motivo: ${accion.motivo}`);
    this.log.info(`   Prueba: ${accion.prueba}`);
    this.log.info('   NO sube al móvil: no es una decisión de Ibrahin, es una entrada caducada.');

    const registro = escribirRegistroTarea({
      config: this.config, tarea, estado, rutas,
      commits: estado.base ? commitsDesde(estado.base, this.config.repo.raiz) : [],
      criterios: this.criteriosDelAnalisis(rutas.analisis), consumo: cuota,
      apartada: `PREMISA FALSA — ${accion.motivo} · Prueba: ${accion.prueba}`,
    });
    const tab = marcarEnTablero({
      config: this.config, tarea, commits: [], registro, logger: this.log,
      premisaFalsa: { motivo: accion.motivo, prueba: accion.prueba },
    });
    const ficheros = [registro].concat(tab.escrito ? [this.config.tableroAbs] : []).concat(tab.destino ? [tab.destino] : []);
    confirmarCierre({ config: this.config, tarea, ficheros: ficheros.filter((f) => fs.existsSync(f)), logger: this.log });

    this.almacen.registrarHistorial({
      id: tarea.id, titulo: tarea.titulo, resultado: 'cerrada-premisa-falsa', motivo: accion.motivo,
      prueba: accion.prueba, intentos: estado.historial.length, replanteos: estado.replanteos,
      decisionDeProducto: false, gastoPorPapel: estado.gastoPorPapel || {},
    });
    // Se APARTA en el estado (es la transición que suelta la tarea sin darla por construida), pero
    // NO se devuelve `apartada`: eso es lo que dispara el aviso al móvil, y aquí no hay que avisar.
    estado = this.almacen.transicion(estado, { tipo: 'TAREA_APARTADA', motivo: `premisa falsa: ${accion.motivo}`, detalle: [accion.prueba] });
    estado = this.almacen.transicion(estado, { tipo: 'DESAPARTADA', id: tarea.id, de: 'premisa falsa demostrada' });
    return { estado, espera: 0, cerradaPorPremisaFalsa: { tarea, motivo: accion.motivo, prueba: accion.prueba } };
  }

  escribirFeedback(estado, motivos) {
    const rutas = this.rutasDe(estado.tarea);
    const texto = `# Feedback — ${estado.tarea.titulo}

- **taskId:** \`${estado.tarea.id}\`
- **intento:** ${estado.intento}
- **veredicto:** ❌ RECHAZADO

## Qué hay que corregir

${(motivos || []).map((m) => `- ${m}`).join('\n') || '- (el revisor no dejó motivos legibles)'}

El texto completo del revisor está en \`${path.basename(rutas.review)}\`.
`;
    escribirAtomico(rutas.feedback, texto);
  }

  /**
   * Aparta un artefacto del intento anterior, sin borrarlo.
   * Es lo que impide que la idempotencia («manda el artefacto») dé por bueno el trabajo de
   * un intento ya rechazado y deje al papel sin entrar.
   */
  archivar(estado, cual, sufijo) {
    const rutas = this.rutasDe(estado.tarea);
    const ruta = rutas[cual];
    if (!ruta || !fs.existsSync(ruta)) return;
    const destino = ruta.replace(/\.md$/, `${sufijo}.md`);
    try { fs.renameSync(ruta, destino); this.log.info(`Archivado ${path.basename(ruta)} → ${path.basename(destino)}`); }
    catch (e) { this.log.aviso(`No pude archivar ${path.basename(ruta)}: ${e.message}`); }
  }

  /** Cierra lo que haya abierto. Ni un proceso huérfano. */
  cancelarTodo() {
    for (const c of this.cancelables) { try { c(); } catch { /* ya estaba muerto */ } }
    this.cancelables.clear();
  }
}
