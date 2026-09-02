// ordenes.js — QUIÉN puede mandar y QUÉ se puede mandar. La puerta del servidor.
//
// LA LÍNEA QUE NO SE CRUZA
// ───────────────────────
// El texto que llega por Telegram NUNCA se ejecuta. Se compara contra la lista cerrada de
// abajo y se traduce a una de sus entradas, o a AYUDA. No hay orden libre, no hay «pásame
// esto a bash», no hay nada que dependa de lo que el mensaje diga literalmente. Un mensaje
// que no encaje con nada NO es un error: es una persona preguntando, y se le enseña la lista.
//
// El identificador de una tarea es el único dato que viaja del mensaje a la acción, y va
// filtrado a [a-z0-9-] y comprobado contra la lista real de apartadas antes de valer nada.
//
// Esto es PURO: entra texto, sale una decisión. Se prueba entero sin red y sin daemon.

import { normalizar } from '../reader.js';

/** Las órdenes. No hay más. Cualquier cosa fuera de aquí no existe. */
export const ORDENES = Object.freeze({
  PARTE: 'PARTE',
  ESTADO: 'ESTADO',
  CUOTA: 'CUOTA',
  TAREAS: 'TAREAS',
  PARAR: 'PARAR',
  ARRANCAR: 'ARRANCAR',
  PARAR_YA: 'PARAR_YA',
  SALTAR: 'SALTAR',
  DESAPARTAR: 'DESAPARTAR',
  // ── LAS TRES RESPUESTAS A UNA FIRMA (1 sep 2026) ────────────────────────────
  // Una tarea que inventa una promesa al cliente se queda terminada y fuera de producción hasta
  // que Ibrahin conteste una de estas tres. Ninguna bloquea: la máquina sigue con la siguiente
  // desde el primer momento.
  APROBAR: 'APROBAR',      // entra en producción
  RECHAZAR: 'RECHAZAR',    // vuelve a la cola con su motivo
  HABLAR: 'HABLAR',        // abre conversación y la deja esperando
  // ── LO QUE ESPERA POR IBRAHIN (1 sep 2026) ──────────────────────────────────
  // Nueve decisiones paradas y nueve firmas por venir viven hoy en el tablero, y **el tablero no
  // lo lee nadie salvo que se pregunte por él**. Si no se acuerda de que algo espera por él, se
  // queda colgado indefinidamente. Esto es la forma de preguntarlo desde el móvil.
  PREGUNTAS: 'PREGUNTAS',
  // Y contestar una, ahí mismo: «1: que se le obligue». El número sale del listado de arriba —
  // NUNCA un identificador técnico, que es lo que nadie va a teclear de pie en la calle.
  RESPONDER: 'RESPONDER',
  AYUDA: 'AYUDA',
  SI: 'SI',
  NO: 'NO',
});

/**
 * Las que hay que confirmar antes de hacer, porque pueden dejar algo a medias.
 * Las otras no rompen nada: se hacen y ya.
 */
export const PIDEN_CONFIRMACION = Object.freeze([ORDENES.PARAR_YA, ORDENES.SALTAR, ORDENES.DESAPARTAR]);

/**
 * Las que necesitan al orquestador para aplicarse: se le dejan anotadas y las recoge cuando
 * termina el paso que tiene entre manos. Las demás las contesta el vigía él solo.
 */
export const VAN_AL_ORQUESTADOR = Object.freeze([ORDENES.PARAR, ORDENES.ARRANCAR, ORDENES.SALTAR, ORDENES.DESAPARTAR,
  // Las tres de firma tocan git (fundir una rama, devolver una tarea a la cola): las aplica el
  // orquestador cuando termina el paso que tenga entre manos, nunca el vigía a mitad de nada.
  ORDENES.APROBAR, ORDENES.RECHAZAR, ORDENES.HABLAR]);

/**
 * Cada entrada: cómo se dice en castellano y qué significa.
 * El orden importa: se prueba de arriba abajo y gana la primera que encaje, así que las más
 * específicas van antes («parar ya» antes que «parar»).
 */
const VOCABULARIO = [
  { orden: ORDENES.PARAR_YA, es: /\b(parar?|para)\s+(ya|de\s+golpe|en\s+seco)\b|\bparada\s+de\s+emergencia\b|\bcorta\s+ya\b/ },
  { orden: ORDENES.SALTAR, es: /\b(saltar|salta|saltate|saltarse|omitir|omite|deja)\b.*\b(tarea|esta|esa|la)\b|\bsaltar\b|\bsalta\b|\bsaltate\b/ },
  { orden: ORDENES.DESAPARTAR, es: /\bdesapartar?\b|\bdesaparta\b|\brecuperar?\s+(la\s+)?tarea\b|\bvuelve\s+a\s+intentar\b|\breabrir?\b/ },
  // ── LAS TRES RESPUESTAS A UNA FIRMA ─────────────────────────────────────────
  // Van ANTES que las demás porque son conversación, no mando: cuando Ibrahin contesta a un
  // aviso de firma escribe como habla («adelante», «no me convence», «hablemos de eso»), y esas
  // palabras no deben caer en AYUDA. RECHAZAR va antes que APROBAR: «no lo apruebes» lleva las
  // dos palabras y significa una sola cosa.
  // ── LO QUE ESPERA POR IBRAHIN ───────────────────────────────────────────────
  // Va ANTES que TAREAS: «qué tengo pendiente» es esto, no la cola de trabajo de la máquina.
  // ⚙️ SE EXIGE LA PRIMERA PERSONA (1 sep 2026), y no es un capricho.
  //
  // La primera versión cazaba «qué falta» y «qué queda» a secas, y **ésas ya eran la cola de
  // trabajo** («📋 Lo que queda»). Lo cazaron dos pruebas que ya existían. Y tienen razón: «qué
  // queda» pregunta por lo que le falta a la MÁQUINA; «qué me falta» pregunta por lo que espera
  // por ÉL. Son dos preguntas distintas y la diferencia está en el «me».
  //
  // Todos los ejemplos del encargo llevaban esa marca —«qué ME falta», «qué espera por MÍ», «qué
  // TENGO pendiente»—, así que se exige: `me`, `mi` o `tengo`. Y «preguntas» a secas, que no es
  // ambiguo con nada.
  { orden: ORDENES.PREGUNTAS, es: /\bpreguntas?\b|\bque\s+me\s+(falta|queda)\b|\bque\s+espera\s+por\s+mi\b|\bque\s+tengo\s+pendiente\b|\bque\s+esperas?\s+de\s+mi\b|\bque\s+necesitas\s+de\s+mi\b|\bque\s+hay\s+para\s+mi\b|\bque\s+espera\s+por\s+mi\b/ },
  // Contestar una del listado: **empieza por el número** y sigue algo.
  //
  // ⚙️ Se compara contra el texto YA LIMPIO, y `interpretar` le quita la puntuación antes: «7.» y
  // «2:» llegan aquí como «7 » y «2 ». Por eso no se puede exigir el punto ni los dos puntos — la
  // primera versión lo hacía y «7. treinta días» acababa en la ayuda. Basta con el número al
  // principio: **ningún otro comando de la lista empieza por un dígito**, y el `\s+` de después
  // impide cazar cosas como «2fa obligatoria».
  { orden: ORDENES.RESPONDER, es: /^(la\s+)?(numero\s+)?[1-9][0-9]?\s+\S/ },
  { orden: ORDENES.RECHAZAR, es: /\bno\s+(lo\s+)?(apruebo|apruebes|me\s+vale|me\s+convence|lo\s+quiero)\b|\brechaza[rl]?o?\b|\brechazo\b|\bque\s+no\b|\bmarcha\s+atras\b/ },
  { orden: ORDENES.APROBAR, es: /\bapruebo\b|\baprueba[rl]?o?\b|\baprobad[oa]\b|\badelante\b|\bfirmo\b|\bfirmad[oa]\b|\btira\s+p?a?\s*lante\b|\bque\s+entre\b|\bdale\b/ },
  { orden: ORDENES.HABLAR, es: /\bhablemos\b|\bhablamos\b|\bdiscut\w*\b|\bexplicame\b|\bcuentame\b|\btengo\s+dudas?\b|\bno\s+lo\s+tengo\s+claro\b|\bespera\b/ },
  // Va antes que TAREAS a propósito: «no cojas más tareas» es una orden de parar, no una
  // pregunta por la cola. Lo cazó la prueba del vocabulario.
  { orden: ORDENES.PARAR, es: /\bno\s+cojas\s+mas\b|\bno\s+empieces\s+mas\b/ },
  { orden: ORDENES.PARTE, es: /\bparte\b|\binforme\b|\bresumen\b|\bcomo\s+va\s+todo\b/ },
  { orden: ORDENES.CUOTA, es: /\bcuota\b|\bsaldo\b|\bcuanto\s+queda\b|\bse\s+reinicia\b/ },
  { orden: ORDENES.TAREAS, es: /\btareas?\b|\bcola\b|\bpendientes?\b|\bque\s+queda\b|\bque\s+falta\b/ },
  // `^que hace$` va ANCLADO Y EXACTO, y es el texto del botón «Qué hace» (1 sep 2026). Suelto
  // sería `\bque\s+hace\b`, y entonces «¿qué hace falta para cerrar esto?» —que es una pregunta
  // por la COLA, no por el paso en curso— caería aquí. Un botón manda un texto fijo: no necesita
  // un patrón generoso, necesita uno que no se lleve por delante nada más.
  { orden: ORDENES.ESTADO, es: /\bestado\b|\bque\s+(estas\s+)?haciendo\b|\bque\s+haces\b|^que\s+hace$|\ben\s+que\s+vas\b|\bcomo\s+vas\b/ },
  { orden: ORDENES.ARRANCAR, es: /\barrancar?\b|\barranca\b|\bsigue\b|\bseguir\b|\bcontinua\b|\bcontinuar\b|\breanudar?\b|\bvuelve\s+a\s+empezar\b/ },
  // ⚙️ «para» Y «parar» VAN ANCLADOS AL PRINCIPIO (1 sep 2026), y el resto no hace falta.
  //
  // Antes era `\bpara\b` suelto, y **«para» es la preposición más común del castellano**: «esto es
  // para el cliente», «una papelera para recuperar», «2FA obligatoria para el dueño» — las tres se
  // leían como «deja de coger tareas» y **paraban el orquestador**. Se destapó al montar las
  // respuestas por Telegram, y ahí deja de ser una curiosidad: desde hoy Ibrahin contesta preguntas
  // EN PROSA desde el móvil, y una respuesta como «que se le obligue para poder facturar» habría
  // parado la fábrica sin que él se enterara.
  //
  // Un imperativo va al principio del mensaje; una preposición, casi nunca. Y «para qué…» se
  // excluye a mano porque es pregunta, no orden. Las palabras que NO son ambiguas —«párate»,
  // «pausa», «detente»— se quedan libres, que para eso no se parecen a nada.
  { orden: ORDENES.PARAR, es: /^para(?!\s+qu[eé]\b)r?\b|\bparate\b|\bparalo\b|\bpausa\b|\bpausar\b|\bdetente\b|\bdescansa\b|\bno\s+cojas\s+mas\b/ },
  { orden: ORDENES.SI, es: /^(si|s|vale|ok|adelante|confirmo|hazlo|dale|correcto|afirmativo)$/ },
  { orden: ORDENES.NO, es: /^(no|n|cancela|cancelar|deja|dejalo|mejor\s+no|anula)$/ },
];

/** El identificador de una tarea, si el mensaje trae uno. Filtrado, no interpretado. */
function idEnElMensaje(texto) {
  // Se busca una palabra con pinta de identificador: minúsculas, números y guiones, con al
  // menos un guion (los ids del tablero son «disa-herramientas-en-paralelo»). El filtro es lo
  // que garantiza que de aquí no sale nada que pueda significar otra cosa en otro sitio.
  const m = /\b([a-z0-9]+(?:-[a-z0-9]+){1,8})\b/.exec(normalizar(texto));
  return m ? m[1].slice(0, 60) : null;
}

/**
 * Traduce un mensaje a una orden de la lista. Nunca devuelve nada que no esté en ORDENES.
 * @returns { orden, id? }
 */
export function interpretar(texto) {
  const limpio = normalizar(String(texto ?? ''))
    .replace(/^\/+/, '')          // «/parte» y «parte» son lo mismo: nadie escribe barras en el móvil
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!limpio) return { orden: ORDENES.AYUDA };

  for (const v of VOCABULARIO) {
    if (!v.es.test(limpio)) continue;
    if (v.orden === ORDENES.DESAPARTAR) return { orden: v.orden, id: idEnElMensaje(limpio) };
    // Las tres de firma llevan el id de la tarea, y el rechazo además el motivo — que es lo que
    // vuelve con ella a la cola para que el siguiente intento sepa qué corregir.
    if (v.orden === ORDENES.APROBAR || v.orden === ORDENES.RECHAZAR || v.orden === ORDENES.HABLAR) {
      return { orden: v.orden, id: idEnElMensaje(limpio), texto: String(texto ?? '').trim().slice(0, 500) };
    }
    if (v.orden === ORDENES.RESPONDER) {
      // El número y la respuesta, separados. La respuesta se guarda TAL CUAL la escribió él:
      // es lo que va a leer el arquitecto para replantear la tarea, y resumirla la estropea.
      const bruto = String(texto ?? '').trim();
      const m = /^\s*(?:la\s+)?(?:n[uú]mero\s+)?([1-9][0-9]?)\s*(?:[:.\-)]|\s)\s*([\s\S]+)$/i.exec(bruto);
      return { orden: v.orden, numero: m ? Number(m[1]) : null,
               respuesta: m ? m[2].trim().slice(0, 1000) : null };
    }
    return { orden: v.orden };
  }
  return { orden: ORDENES.AYUDA };
}

/**
 * La lista de lo que se puede pedir, escrita para una persona.
 * Se enseña ante cualquier mensaje que no encaje, que es lo que pasa la primera vez.
 */
export function ayuda() {
  return [
    '<b>🤖 Esto es lo que puedes pedirme</b>',
    '',
    'Escríbeme como hablas. No hace falta ningún formato.',
    '',
    '<b>⭐ Lo que espera por ti</b>',
    '• <b>preguntas</b> — todo lo que está parado esperando que decidas tú',
    '   <i>(también vale «qué me falta» o «qué tengo pendiente»)</i>',
    '• <b>3: treinta días</b> — contestar una, con su número y tu respuesta',
    '• <b>adelante</b> / <b>no me convence</b> / <b>hablemos</b> — para lo que espera tu visto bueno',
    '',
    '<b>Para saber cómo va</b>',
    '• <b>parte</b> — el resumen entero, ahora, sin esperar a las 3 horas',
    '• <b>qué estás haciendo</b> — en qué tarea va y desde cuándo',
    '• <b>cuota</b> — cuánta queda y cuándo se reinicia',
    '• <b>qué tareas quedan</b> — la lista de lo que hay pendiente',
    '',
    '<b>Para mandarle</b>',
    '• <b>para</b> — termina lo que está haciendo y no coge la siguiente',
    '• <b>arranca</b> — que vuelva a coger tareas',
    '',
    '<b>Esto te lo pregunto antes de hacerlo</b>',
    '• <b>para ya</b> — corta a mitad; puede dejar algo sin terminar',
    '• <b>salta esta tarea</b> — la deja y pasa a la siguiente',
    '• <b>desapartar</b> — devuelve al montón una que se quedó apartada',
    '',
    '',
    '<i>Sigo mandándote el parte cada 3 horas aunque no me pidas nada.</i>',
    '<i>De producto no discuto: te enseño lo que espera y apunto lo que decidas. Lo demás, en un chat.</i>',
  ].join('\n');
}

/** El texto con el que se pide confirmación. Dice qué va a pasar, no «¿confirmas?» a secas. */
export function pedirConfirmacion(orden, { id = null, tarea = null } = {}) {
  const que = {
    [ORDENES.PARAR_YA]: [
      '<b>⚠️ ¿Paro de golpe?</b>',
      '',
      tarea ? `Está en «${tarea}».` : 'No tiene ninguna tarea entre manos.',
      'Corto la llamada a mitad. <b>Puede quedar algo sin terminar</b>, y al volver retomo desde el último paso guardado.',
      '',
      'Si lo que quieres es que acabe lo suyo y no coja más, eso es <b>para</b> (sin el «ya»).',
    ],
    [ORDENES.SALTAR]: [
      '<b>⚠️ ¿Salto la tarea que tiene entre manos?</b>',
      '',
      tarea ? `Dejaría «${tarea}» sin terminar` : 'No tiene ninguna tarea entre manos',
      'y pasaría a la siguiente del tablero. Lo que lleve construido se queda como está.',
    ],
    [ORDENES.DESAPARTAR]: [
      '<b>⚠️ ¿Devuelvo esta tarea al montón?</b>',
      '',
      `«${tarea || id}» volvería a estar pendiente y el orquestador la cogería cuando le toque.`,
      'Se apartó por algo: si el motivo sigue ahí, volverá a apartarse.',
    ],
  }[orden] || ['<b>⚠️ ¿Lo hago?</b>'];

  return [...que, '', 'Contéstame <b>sí</b> o <b>no</b>. Si no dices nada, lo dejo estar.'].join('\n');
}

/** Lo que se contesta a quien no es Ibrahin: nada útil. */
export const NO_ERES_QUIEN = 'No te conozco.';

/**
 * ¿PROMETE CADA BOTÓN LO QUE DE VERDAD MANDA?
 *
 * ⚙️ POR QUÉ ESTO EXISTE (1 sep 2026, al montar los botones). Un botón manda un TEXTO, y ese
 * texto pasa por `interpretar()` como cualquier otro mensaje. Así que un botón que ponga
 * «Qué hace» y un intérprete que no reconozca esa frase dan un botón que **no hace nada** y
 * que además parece que funciona, porque contesta con la ayuda. Pasó a la primera: de los
 * seis del encargo, cinco caían bien y «Qué hace» se iba a AYUDA, porque el vocabulario tenía
 * «qué haces» y no «qué hace». Un botón mudo es peor que no tener botón: el de al lado sí va,
 * así que uno se cree que el bot le ha entendido.
 *
 * Es exactamente el fallo del que Ibrahin avisó en el encargo —«preguntas» se dio por
 * verificada y no funcionaba—, y por eso no se comprueba mirando: se comprueba con el mismo
 * intérprete que va a leer el mensaje de verdad.
 *
 * Y NO deja pasar las que piden confirmación: «parar ya», «saltar» y «desapartar» pueden dejar
 * algo a medias, y un botón se toca sin querer con el móvil en el bolsillo.
 *
 * @returns { ok, filas, fallos } — `filas` son los textos, listos para el transporte.
 */
export function revisarTeclado(teclado) {
  const fallos = [];
  if (!Array.isArray(teclado) || !teclado.length) {
    return { ok: false, filas: [], fallos: ['no hay teclado definido en vigia.teclado'] };
  }
  const filas = [];
  for (const fila of teclado) {
    if (!Array.isArray(fila) || !fila.length) { fallos.push('hay una fila vacía'); continue; }
    const textos = [];
    for (const b of fila) {
      const texto = String(b?.texto ?? '').trim();
      const prometida = String(b?.orden ?? '').trim();
      if (!texto || !prometida) { fallos.push(`botón sin texto o sin orden: ${JSON.stringify(b)}`); continue; }
      if (!(prometida in ORDENES)) { fallos.push(`«${texto}» dice mandar «${prometida}», que no es ninguna orden`); continue; }
      if (PIDEN_CONFIRMACION.includes(prometida)) {
        fallos.push(`«${texto}» manda «${prometida}», que pide confirmación: ésas se escriben a mano, no van en un botón`);
        continue;
      }
      const real = interpretar(texto).orden;
      if (real !== prometida) { fallos.push(`«${texto}» promete «${prometida}» pero el intérprete lo lee como «${real}»`); continue; }
      textos.push(texto);
    }
    if (textos.length) filas.push(textos);
  }
  return { ok: !fallos.length && filas.length > 0, filas, fallos };
}
