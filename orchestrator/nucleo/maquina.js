// maquina.js — Decide QUÉ TOCA AHORA. Función pura.
//
// No lee ficheros, no llama a nadie, no mira el reloj y no escribe nada. Se le entrega una
// situación —el reloj incluido, por `ahora`— y devuelve una acción. Ése es todo su contrato.
//
// ⚙️ EL RELOJ ENTRA POR LA PUERTA (1 sep 2026, avería 2). `ahora` se pasa desde fuera en vez de
// llamar a `Date.now()` aquí, y no es una manía: la avería de ese día fue LLEGAR TARDE, y una
// prueba no puede afirmar nada sobre llegar tarde si no puede mover el reloj. Con el reloj
// dentro, «se despierta cuando se reinicia la ventana» era literalmente indemostrable.
//
// El motivo de que sea pura no es estético: es que TODAS las reglas difíciles del encargo
// —tres rechazos disparan replanteamiento, un replanteo fallido aparta, sin cuota no se
// empieza— viven aquí y se pueden probar con objetos inventados, en milisegundos, sin CLI,
// sin red y sin repositorio.

export const PASOS = Object.freeze({
  OCIOSO: 'OCIOSO',
  ANALISIS: 'ANALISIS',
  VALIDAR_ANALISIS: 'VALIDAR_ANALISIS',
  CONSTRUCCION: 'CONSTRUCCION',
  VALIDAR_CODIGO: 'VALIDAR_CODIGO',
  REVISION: 'REVISION',
  VALIDAR_REVISION: 'VALIDAR_REVISION',
  CIERRE: 'CIERRE',
  ESPERANDO_CUOTA: 'ESPERANDO_CUOTA',
});

export const ACCIONES = Object.freeze({
  ESPERAR_CUOTA: 'ESPERAR_CUOTA',
  OCIOSO: 'OCIOSO',
  TOMAR_TAREA: 'TOMAR_TAREA',
  EJECUTAR: 'EJECUTAR',
  REINTENTAR: 'REINTENTAR',
  REPLANTEAR: 'REPLANTEAR',
  APARTAR: 'APARTAR',
  CERRAR: 'CERRAR',
  REINTENTAR_SUBIDA: 'REINTENTAR_SUBIDA',
  SALTAR: 'SALTAR',
});

/** El papel que hace falta en cada paso de trabajo. */
const PAPEL_DE = {
  [PASOS.ANALISIS]: 'arquitecto',
  [PASOS.CONSTRUCCION]: 'programador',
  [PASOS.REVISION]: 'revisor',
};

/**
 * ¿Alcanza la cuota para meterse en un ciclo entero?
 *
 * Dos condiciones, y las dos tienen que cumplirse:
 *   · queda al menos `minimoParaCicloPct` de la ventana de sesión;
 *   · lo que queda por encima del margen reservado a Ibrahin da para ese mínimo.
 *
 * El margen reservado es la razón de ser de esta función: el daemon NO puede vaciar la
 * ventana, porque la comparte con el chat de Ibrahin.
 */
export function alcanzaParaCiclo(cuota, config) {
  const c = config.cuota;
  if (!cuota || !cuota.fiable) {
    return { alcanza: false, motivo: 'no sé cuánta cuota queda: no arranco a ciegas', desconocida: true };
  }
  const libreSesion = 100 - cuota.sesionPct;
  const libreSemana = 100 - cuota.semanaPct;
  const utilizable = libreSesion - c.margenReservadoPct;

  // CUÁL DE LAS DOS VENTANAS CORTA, y se dice, porque cada una se reinicia a su hora.
  // Hasta el 1 sep 2026 esto no se devolvía y quien esperaba anunciaba SIEMPRE la hora de la
  // ventana de sesión, aunque la que le estuviera frenando fuese la semanal. Prometer un
  // reinicio a las 8 de la mañana cuando el que manda es el del jueves es mentir con precisión.
  if (libreSemana < c.minimoSemanalPct) {
    return { alcanza: false, ventana: 'semanal',
             motivo: `queda ${libreSemana.toFixed(0)}% de la ventana semanal y el mínimo es ${c.minimoSemanalPct}%` };
  }
  if (utilizable < c.minimoParaCicloPct) {
    return {
      alcanza: false, ventana: 'sesion',
      motivo: `queda ${libreSesion.toFixed(0)}% de sesión; reservando ${c.margenReservadoPct}% para el chat quedan ${utilizable.toFixed(0)}% y hacen falta ${c.minimoParaCicloPct}%`,
    };
  }
  return { alcanza: true, ventana: null, motivo: `queda ${libreSesion.toFixed(0)}% de sesión (${utilizable.toFixed(0)}% utilizable)` };
}

/**
 * Cuánto se duerme esperando cuota: hasta que se reinicie la ventana que está cortando, y si
 * no se sabe cuándo, el sondeo de siempre.
 *
 * DE DÓNDE SALE (1 sep 2026). `/usage` DICE a qué hora se reinicia. El orquestador lo escribía
 * en el registro y se dormía igualmente sus 15 minutos planos, así que llegaba tarde hasta un
 * cuarto de hora a cada reinicio — diez minutos medidos ese día, con 43 tareas esperando.
 *
 * Tres reglas, y las tres tienen motivo:
 *   · NUNCA se duerme MÁS que el sondeo de siempre. La hora del reinicio es una promesa ajena;
 *     si falla, el sondeo la corrige.
 *   · Si el reinicio ya pasó y seguimos sin cuota, la promesa era falsa: se vuelve al sondeo
 *     completo. Sin esto, un reinicio caducado dejaría al daemon preguntando cada minuto, y
 *     preguntar `/usage` TAMBIÉN gasta cuota.
 *   · Se le suma un margen. La ventana no se reinicia con el segundero, y la lectura tampoco es
 *     instantánea: despertarse un pelo antes cuesta una consulta entera para nada.
 */
export function esperaHastaLaCuota({ reinicioMs, ahora, config }) {
  const c = config.cuota;
  const plano = c.esperaSinCuotaMs;
  if (!Number.isFinite(reinicioMs) || !Number.isFinite(ahora)) return plano;
  const falta = reinicioMs - ahora;
  if (falta <= 0) return plano;
  return Math.min(plano, falta + (c.margenTrasReinicioMs ?? 60000));
}

/**
 * La decisión.
 *
 * @param situacion.estado          estado persistido (ver almacen.estadoInicial)
 * @param situacion.cuota           { sesionPct, semanaPct, fiable, reinicioSesion } o null
 * @param situacion.tareaDisponible tarea del tablero, o null
 * @param situacion.pendientesEnTablero  todas las tareas que el tablero da por pendientes.
 *                                  Sirve para una sola cosa, y es importante: distinguir
 *                                  «no hay trabajo» de «hay trabajo y no lo veo» (avería).
 * @param situacion.ahora           el reloj, inyectado. Sirve para UNA cosa: saber cuánto falta
 *                                  para que se reinicie la ventana y dormir justo eso.
 * @param situacion.obs             observaciones ya calculadas por el ejecutor:
 *                                  { analisis:{existe,valido,motivos,paroArquitecto},
 *                                    codigo:{valido,motivos,hayCommits},
 *                                    revision:{existe,veredicto,motivos} }
 * @param situacion.config
 * @returns { tipo, ...datos, porque }
 */
export function decidir({ estado, cuota, tareaDisponible, pendientesEnTablero = [], obs = {}, config, ahora = Date.now() }) {
  // ── 0 · La subida pendiente se reintenta ANTES de coger trabajo nuevo ───────
  // Va aquí y no al final a propósito: si GitHub volvió, lo primero es dejar de
  // deber trabajo aprobado. Y no depende de la cuota: git no gasta modelo.
  if (estado.subidaPendiente && !estado.tarea) {
    return { tipo: ACCIONES.REINTENTAR_SUBIDA, porque: 'hay trabajo aprobado sin subir de una tarea anterior' };
  }

  const decision = decidirSinMirarCuota({ estado, tareaDisponible, pendientesEnTablero, obs, config });

  // ── La puerta de cuota ──────────────────────────────────────────────────────
  // Se aplica a la DECISIÓN, no al paso en el que estamos. Un paso de validación no
  // gasta modelo, pero puede decidir ejecutar un papel: si se mirase solo el paso
  // actual, esa llamada se colaría sin comprobar nada. (Lo cazó una prueba.)
  const gastaModelo = decision.tipo === ACCIONES.EJECUTAR || decision.tipo === ACCIONES.TOMAR_TAREA;
  if (gastaModelo) {
    const v = alcanzaParaCiclo(cuota, config);
    if (!v.alcanza) {
      // La hora que se anuncia y la que se duerme son la de LA VENTANA QUE CORTA, no siempre
      // la de sesión. Si corta la semanal, la de sesión se reiniciará esta noche sin cambiar
      // nada, y despertarse entonces sería despertarse para volver a dormirse.
      const semanal = v.ventana === 'semanal';
      const reinicio = (semanal ? cuota?.reinicioSemana : cuota?.reinicioSesion) ?? null;
      const reinicioMs = (semanal ? cuota?.reinicioSemanaMs : cuota?.reinicioSesionMs) ?? null;
      return {
        tipo: ACCIONES.ESPERAR_CUOTA,
        esperaMs: esperaHastaLaCuota({ reinicioMs, ahora, config }),
        ventana: v.ventana ?? null,
        reinicio,
        reinicioMs,
        porque: v.motivo,
        desconocida: !!v.desconocida,
      };
    }
  }
  return decision;
}

/** La decisión sin mirar el combustible. Separada para que la puerta de cuota sea una sola. */
function decidirSinMirarCuota({ estado, tareaDisponible, pendientesEnTablero = [], obs, config }) {
  const cfg = config.ciclo;

  // ── 2 · Sin tarea en curso: coger una, o descansar ──────────────────────────
  if (!estado.tarea) {
    // Pausa pedida desde Telegram. Va ANTES de mirar el tablero y DESPUÉS de terminar la
    // tarea en curso (por eso está aquí y no arriba del todo): «para» promete que acaba lo
    // que tiene entre manos y no coge la siguiente, no que lo suelte todo.
    // Y pausado NO es avería: no hay nada roto, se lo ha pedido él.
    if (estado.pausado) {
      return { tipo: ACCIONES.OCIOSO, pausado: true,
               porque: 'en pausa porque Ibrahin la pidió: no cojo tareas hasta que diga «arranca»' };
    }
    if (!tareaDisponible) return ocioso(pendientesEnTablero);
    return { tipo: ACCIONES.TOMAR_TAREA, tarea: tareaDisponible, porque: 'hay tarea y hay cuota' };
  }

  // ── 3 · Con tarea en curso: qué toca según el paso ──────────────────────────
  switch (estado.paso) {
    case PASOS.ANALISIS:
      // Idempotencia: si ya hay análisis válido en disco (de un corte, o de una llamada que
      // entregó pese a un aviso de permisos), NO se vuelve a pagar. Manda el artefacto.
      if (obs.analisis?.valido) {
        return { tipo: ACCIONES.SALTAR, paso: PASOS.VALIDAR_ANALISIS,
                 porque: 'ya hay un análisis válido escrito: no lo repito' };
      }
      return { tipo: ACCIONES.EJECUTAR, papel: 'arquitecto', paso: PASOS.ANALISIS,
               replanteo: estado.replanteos > 0,
               porque: estado.replanteos > 0 ? 'replanteando la tarea desde cero' : 'hace falta el análisis' };

    case PASOS.VALIDAR_ANALISIS: {
      const a = obs.analisis || {};
      // El arquitecto tiene derecho a decir que la tarea está mal planteada. No es un fallo
      // suyo: es un resultado, y aparta la tarea sin gastar más ciclos.
      if (a.paroArquitecto) {
        return { tipo: ACCIONES.APARTAR, motivo: 'el arquitecto declaró la tarea mal planteada',
                 detalle: a.motivos || [], decisionDeProducto: true,
                 porque: 'el arquitecto paró: no es un fallo técnico' };
      }
      if (!a.valido) {
        // Un análisis inválido (sin criterios, corto, sin arquitectura) se repite: el
        // arquitecto vuelve a intentarlo con el motivo delante.
        const n = (estado.fallosTecnicos[PASOS.ANALISIS] || 0);
        if (n >= cfg.maxFallosTecnicosPorPaso) {
          return { tipo: ACCIONES.APARTAR, motivo: `el análisis no sale válido tras ${n} intentos`,
                   detalle: a.motivos || [], decisionDeProducto: true,
                   porque: 'el arquitecto no consigue escribir un análisis aceptable' };
        }
        return { tipo: ACCIONES.EJECUTAR, papel: 'arquitecto', paso: PASOS.ANALISIS,
                 rehacer: true, motivos: a.motivos || [],
                 porque: 'el análisis no vale y se repite con el motivo delante' };
      }
      return { tipo: ACCIONES.EJECUTAR, papel: 'programador', paso: PASOS.CONSTRUCCION,
               fijarBase: true, porque: 'análisis válido: a construir' };
    }

    case PASOS.CONSTRUCCION:
      // El programador NUNCA se repite a ciegas: si ya hay commits válidos de este intento,
      // repetirlo duplicaría trabajo. Se comprueba contra git, que es la verdad.
      if (obs.codigo?.valido) {
        return { tipo: ACCIONES.SALTAR, paso: PASOS.VALIDAR_CODIGO,
                 porque: 'ya hay commits válidos de este intento: no vuelvo a construir' };
      }
      return { tipo: ACCIONES.EJECUTAR, papel: 'programador', paso: PASOS.CONSTRUCCION,
               fijarBase: !estado.base,
               motivos: ultimoRechazo(estado)?.motivos || [],
               porque: 'hace falta construir' };

    case PASOS.VALIDAR_CODIGO: {
      const c = obs.codigo || {};
      if (!c.valido) {
        // Sin commits válidos no hay nada que revisar. Cuenta como intento del ciclo,
        // porque el programador ya tuvo su oportunidad con el análisis delante.
        return decidirTrasRechazo(estado, cfg, {
          motivos: c.motivos || ['no hay commits válidos que revisar'],
          resumen: 'el código no pasó la comprobación previa a la revisión',
        });
      }
      return { tipo: ACCIONES.EJECUTAR, papel: 'revisor', paso: PASOS.REVISION,
               porque: 'código válido: a revisar' };
    }

    case PASOS.REVISION:
      if (obs.revision?.veredicto) {
        return { tipo: ACCIONES.SALTAR, paso: PASOS.VALIDAR_REVISION,
                 porque: 'ya hay un veredicto legible escrito: no lo repito' };
      }
      return { tipo: ACCIONES.EJECUTAR, papel: 'revisor', paso: PASOS.REVISION, porque: 'hace falta el veredicto' };

    case PASOS.VALIDAR_REVISION: {
      const r = obs.revision || {};
      if (r.veredicto === 'aprobado') {
        return { tipo: ACCIONES.CERRAR, porque: 'el revisor aprobó' };
      }
      if (r.veredicto === 'rechazado') {
        return decidirTrasRechazo(estado, cfg, { motivos: r.motivos || [], resumen: r.resumen || 'rechazado por el revisor' });
      }
      // Ni aprobado ni rechazado: la revisión es ilegible. Es un fallo técnico del paso,
      // no un rechazo, y por eso NO consume intento del ciclo.
      const n = (estado.fallosTecnicos[PASOS.REVISION] || 0);
      if (n >= cfg.maxFallosTecnicosPorPaso) {
        return { tipo: ACCIONES.APARTAR, motivo: `la revisión salió ilegible ${n} veces seguidas`,
                 detalle: r.motivos || [], decisionDeProducto: true,
                 porque: 'no consigo un veredicto legible' };
      }
      return { tipo: ACCIONES.EJECUTAR, papel: 'revisor', paso: PASOS.REVISION,
               rehacer: true, motivos: r.motivos || [],
               porque: 'la revisión no dice ni aprobado ni rechazado' };
    }

    case PASOS.CIERRE:
      return { tipo: ACCIONES.CERRAR, porque: 'quedó a medio cerrar y el cierre se puede repetir entero' };

    default:
      return { tipo: ACCIONES.OCIOSO, porque: `paso desconocido «${estado.paso}»` };
  }
}

/**
 * Descansar… o dar la alarma.
 *
 * LA REGLA (31 ago 2026): estar ocioso TENIENDO tareas pendientes en el tablero NO es estar
 * ocioso, es una AVERÍA. El 31 de agosto el sistema cerró una tarea y se quedó diciendo «el
 * tablero no ofrece ninguna tarea» durante horas, con cuatro pendientes escritas y en su
 * formato. Se calló porque ocioso y averiado eran, para él, exactamente lo mismo.
 *
 * Ahora se distinguen: si el tablero ofrece trabajo y aquí no llega, se dice.
 */
function ocioso(pendientesEnTablero = []) {
  const averia = averiaOciosoConTablero(pendientesEnTablero);
  if (!averia) return { tipo: ACCIONES.OCIOSO, porque: 'el tablero no ofrece ninguna tarea' };
  return { tipo: ACCIONES.OCIOSO, averia, porque: `AVERÍA: ${averia.motivo}` };
}

/**
 * La avería, en un solo sitio. La usan el ciclo (que la avisa por Telegram) y `orq parte`
 * y `orq estado` (que la enseñan a mano): si cada uno se la escribiera por su cuenta, el
 * día que cambie la regla cambiaría en uno y no en los otros.
 *
 * @returns la avería, o null si no la hay.
 */
export function averiaOciosoConTablero(pendientesEnTablero = []) {
  const n = pendientesEnTablero.length;
  if (!n) return null;
  return {
    clase: 'ocioso-con-tablero-lleno',
    pendientes: n,
    nombres: pendientesEnTablero.slice(0, 5).map((t) => t.titulo || t.id),
    // Se explica en castellano llano porque esto acaba en Telegram, no en un log.
    motivo: `el tablero tiene ${n} tarea(s) pendiente(s) y no consigo coger ninguna`,
  };
}

/**
 * La regla del encargo, en un solo sitio:
 *   · hasta `maxIntentosRevision` vueltas al programador con el motivo;
 *   · al agotarlas, NO un cuarto intento igual: replanteamiento del arquitecto;
 *   · si ya se replanteó y vuelve a fallar, la tarea se aparta y el sistema sigue.
 */
function decidirTrasRechazo(estado, cfg, { motivos, resumen }) {
  if (estado.intento < cfg.maxIntentosRevision) {
    return { tipo: ACCIONES.REINTENTAR, motivos, resumen,
             intentoSiguiente: estado.intento + 1,
             porque: `rechazo ${estado.intento} de ${cfg.maxIntentosRevision}: vuelve al programador con el motivo` };
  }
  if (estado.replanteos < cfg.maxReplanteos) {
    return { tipo: ACCIONES.REPLANTEAR, motivos, resumen,
             porque: `${estado.intento} rechazos: no repito el mismo intento, replanteo la tarea` };
  }
  return { tipo: ACCIONES.APARTAR,
           motivo: `${estado.intento} rechazos tras ${estado.replanteos} replanteamiento(s)`,
           detalle: motivos, decisionDeProducto: true,
           porque: 'replanteada y sigue sin salir: la aparto y sigo con la siguiente' };
}

export function ultimoRechazo(estado) {
  for (let i = estado.historial.length - 1; i >= 0; i--) {
    if (estado.historial[i].veredicto === 'rechazado') return estado.historial[i];
  }
  return null;
}

/** El paso al que se pasa después de ejecutar un papel. */
export function pasoTrasEjecutar(paso) {
  return { [PASOS.ANALISIS]: PASOS.VALIDAR_ANALISIS,
           [PASOS.CONSTRUCCION]: PASOS.VALIDAR_CODIGO,
           [PASOS.REVISION]: PASOS.VALIDAR_REVISION }[paso] || paso;
}
