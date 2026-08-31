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
import { leerTablero, buscarSiguienteTarea, commitsDesde } from './reader.js';
import { cabeza } from './cierre/git.js';
import { escribirRegistroTarea, marcarEnTablero, confirmarCierre, subirTrabajo } from './cierre/cierre.js';
import { escribirAtomico } from './nucleo/almacen.js';
import { sanear } from './tablero/saneador.js';
import { confirmar, anadir } from './cierre/git.js';

export class Ciclo {
  constructor({ config, almacen, vigilante, logger, invocador = invocar }) {
    this.config = config;
    this.almacen = almacen;
    this.vigilante = vigilante;
    this.log = logger;
    this.invocador = invocador;
    this.cancelables = new Set();
  }

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
      const v = validarAnalisis(rutas.analisis);
      obs.analisis = { existe: fs.existsSync(rutas.analisis), valido: v.ok, motivos: v.motivos,
                       paroArquitecto: !!v.paroArquitecto, criterios: v.criterios || [] };
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
    let tareaDisponible = null;
    try {
      // El formato del tablero lo arregla el sistema, no Ibrahin. Antes de leer nada, se sanea.
      const texto = this.sanearTablero();
      tareaDisponible = buscarSiguienteTarea(texto);
    } catch (e) {
      this.log.error(`No pude leer el tablero: ${e.message}`);
      return { estado, espera: this.config.ciclo.intervaloVueltaMs };
    }

    const necesitaCuota = !!estado.tarea || !!tareaDisponible;
    // En espera se fuerza la consulta: si no, la caché y la espera se solaparían y
    // estaríamos mirando siempre una respuesta vieja.
    const cuota = necesitaCuota ? await this.vigilante.consultar({ forzar: estado.esperandoCuota }) : null;
    const obs = this.observar(estado);
    const accion = decidir({ estado, cuota, tareaDisponible, obs, config: this.config });

    if (estado.esperandoCuota && accion.tipo !== ACCIONES.ESPERAR_CUOTA) {
      const rato = estado.esperaDesde ? Math.round((Date.now() - new Date(estado.esperaDesde).getTime()) / 60000) : 0;
      this.log.exito(`▶ Vuelve a haber cuota tras ${rato} min. Retomo en el paso ${estado.paso}.`);
      estado = this.almacen.transicion(estado, { tipo: 'CUOTA_VUELTA' });
    }
    this.log.info(`Decisión: ${accion.tipo} — ${accion.porque}`);
    return this.ejecutar({ estado, accion, cuota, tareaDisponible });
  }

  async ejecutar({ estado, accion, cuota, tareaDisponible }) {
    const cfg = this.config.ciclo;

    switch (accion.tipo) {
      case ACCIONES.OCIOSO:
        return { estado, espera: cfg.intervaloVueltaMs };

      case ACCIONES.SALTAR: {
        this.log.info(`Salto al paso ${accion.paso}: ${accion.porque}`);
        estado = this.almacen.transicion(estado, { tipo: 'PASO_INICIADO', paso: accion.paso });
        return { estado, espera: 0 };
      }

      case ACCIONES.ESPERAR_CUOTA: {
        if (!estado.esperandoCuota) {
          this.log.aviso(`⏸ Espero: ${accion.porque}`);
          if (accion.reinicio) this.log.info(`La ventana se reinicia: ${accion.reinicio}`);
          if (estado.tarea) this.log.info(`La tarea queda intacta en el paso ${estado.paso}.`);
          estado = this.almacen.transicion(estado, { tipo: 'ESPERANDO_CUOTA', motivo: accion.porque });
        }
        return { estado, espera: accion.esperaMs };
      }

      case ACCIONES.TOMAR_TAREA: {
        this.log.exito(`Tomo «${accion.tarea.titulo}» (${accion.tarea.id}).`);
        estado = this.almacen.transicion(estado, {
          tipo: 'TAREA_TOMADA', tarea: accion.tarea, cuota: cuota?.sesionPct ?? null,
        });
        return { estado, espera: 0 };
      }

      case ACCIONES.EJECUTAR:
        return this.ejecutarPapel({ estado, accion });

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

      case ACCIONES.CERRAR:
        return this.cerrar({ estado, cuota });

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

  /** Lanza un papel y avanza al paso de validación correspondiente. */
  async ejecutarPapel({ estado, accion }) {
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

    this.log.paso(accion.paso, `${accion.papel.toUpperCase()} — ${accion.porque}`);
    const r = await this.invocador({
      prompt,
      herramientas: this.config.cli.herramientasPorPapel[accion.papel] || [],
      cwd: this.config.repo.raiz,
      config: this.config,
      alSalir: (cancelar) => this.cancelables.add(cancelar),
    });

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

    this.almacen.registrarHistorial({
      id: tarea.id, titulo: tarea.titulo, resultado: 'apartada', motivo: accion.motivo,
      intentos: estado.historial.length, replanteos: estado.replanteos, decisionDeProducto: !!accion.decisionDeProducto,
    });

    const apartada = { tarea, motivo: accion.motivo, historial: estado.historial };
    estado = this.almacen.transicion(estado, { tipo: 'TAREA_APARTADA', motivo: accion.motivo, detalle: accion.detalle || [] });
    return { estado, espera: 0, apartada };
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
