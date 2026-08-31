// maquina.js — Decide QUÉ TOCA AHORA. Función pura.
//
// No lee ficheros, no llama a nadie, no mira el reloj y no escribe nada. Se le entrega una
// situación y devuelve una acción. Ése es todo su contrato.
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

  if (libreSemana < c.minimoSemanalPct) {
    return { alcanza: false, motivo: `queda ${libreSemana.toFixed(0)}% de la ventana semanal y el mínimo es ${c.minimoSemanalPct}%` };
  }
  if (utilizable < c.minimoParaCicloPct) {
    return {
      alcanza: false,
      motivo: `queda ${libreSesion.toFixed(0)}% de sesión; reservando ${c.margenReservadoPct}% para el chat quedan ${utilizable.toFixed(0)}% y hacen falta ${c.minimoParaCicloPct}%`,
    };
  }
  return { alcanza: true, motivo: `queda ${libreSesion.toFixed(0)}% de sesión (${utilizable.toFixed(0)}% utilizable)` };
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
 * @param situacion.obs             observaciones ya calculadas por el ejecutor:
 *                                  { analisis:{existe,valido,motivos,paroArquitecto},
 *                                    codigo:{valido,motivos,hayCommits},
 *                                    revision:{existe,veredicto,motivos} }
 * @param situacion.config
 * @returns { tipo, ...datos, porque }
 */
export function decidir({ estado, cuota, tareaDisponible, pendientesEnTablero = [], obs = {}, config }) {
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
      return {
        tipo: ACCIONES.ESPERAR_CUOTA,
        esperaMs: config.cuota.esperaSinCuotaMs,
        reinicio: cuota?.reinicioSesion ?? null,
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
  const n = pendientesEnTablero.length;
  if (!n) return { tipo: ACCIONES.OCIOSO, porque: 'el tablero no ofrece ninguna tarea' };

  const nombres = pendientesEnTablero.slice(0, 5).map((t) => t.titulo || t.id);
  return {
    tipo: ACCIONES.OCIOSO,
    averia: {
      clase: 'ocioso-con-tablero-lleno',
      pendientes: n,
      nombres,
      // Se explica en castellano llano porque esto acaba en Telegram, no en un log.
      motivo: `el tablero tiene ${n} tarea(s) pendiente(s) y no consigo coger ninguna`,
    },
    porque: `AVERÍA: ${n} tarea(s) pendiente(s) en el tablero y ninguna que pueda coger`,
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
