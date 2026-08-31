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
export const VAN_AL_ORQUESTADOR = Object.freeze([ORDENES.PARAR, ORDENES.ARRANCAR, ORDENES.SALTAR, ORDENES.DESAPARTAR]);

/**
 * Cada entrada: cómo se dice en castellano y qué significa.
 * El orden importa: se prueba de arriba abajo y gana la primera que encaje, así que las más
 * específicas van antes («parar ya» antes que «parar»).
 */
const VOCABULARIO = [
  { orden: ORDENES.PARAR_YA, es: /\b(parar?|para)\s+(ya|de\s+golpe|en\s+seco)\b|\bparada\s+de\s+emergencia\b|\bcorta\s+ya\b/ },
  { orden: ORDENES.SALTAR, es: /\b(saltar|salta|saltate|saltarse|omitir|omite|deja)\b.*\b(tarea|esta|esa|la)\b|\bsaltar\b|\bsalta\b|\bsaltate\b/ },
  { orden: ORDENES.DESAPARTAR, es: /\bdesapartar?\b|\bdesaparta\b|\brecuperar?\s+(la\s+)?tarea\b|\bvuelve\s+a\s+intentar\b|\breabrir?\b/ },
  // Va antes que TAREAS a propósito: «no cojas más tareas» es una orden de parar, no una
  // pregunta por la cola. Lo cazó la prueba del vocabulario.
  { orden: ORDENES.PARAR, es: /\bno\s+cojas\s+mas\b|\bno\s+empieces\s+mas\b/ },
  { orden: ORDENES.PARTE, es: /\bparte\b|\binforme\b|\bresumen\b|\bcomo\s+va\s+todo\b/ },
  { orden: ORDENES.CUOTA, es: /\bcuota\b|\bsaldo\b|\bcuanto\s+queda\b|\bse\s+reinicia\b/ },
  { orden: ORDENES.TAREAS, es: /\btareas?\b|\bcola\b|\bpendientes?\b|\bque\s+queda\b|\bque\s+falta\b/ },
  { orden: ORDENES.ESTADO, es: /\bestado\b|\bque\s+(estas\s+)?haciendo\b|\bque\s+haces\b|\ben\s+que\s+vas\b|\bcomo\s+vas\b/ },
  { orden: ORDENES.ARRANCAR, es: /\barrancar?\b|\barranca\b|\bsigue\b|\bseguir\b|\bcontinua\b|\bcontinuar\b|\breanudar?\b|\bvuelve\s+a\s+empezar\b/ },
  { orden: ORDENES.PARAR, es: /\bparar?\b|\bpara\b|\bparate\b|\bparalo\b|\bpausa\b|\bpausar\b|\bdetente\b|\bdetente?\b|\bdescansa\b|\bno\s+cojas\s+mas\b/ },
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
    '<i>Sigo mandándote el parte cada 3 horas aunque no me pidas nada.</i>',
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
