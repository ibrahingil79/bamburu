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
 * Las que necesitan al orquestador para aplicarse: se le dejan anotadas y las recoge cuando
 * termina el paso que tiene entre manos. Las demás las contesta el vigía él solo.
 */
export const VAN_AL_ORQUESTADOR = Object.freeze([ORDENES.PARAR, ORDENES.ARRANCAR, ORDENES.SALTAR, ORDENES.DESAPARTAR,
  // Las tres de firma tocan git (fundir una rama, devolver una tarea a la cola): las aplica el
  // orquestador cuando termina el paso que tenga entre manos, nunca el vigía a mitad de nada.
  ORDENES.APROBAR, ORDENES.RECHAZAR, ORDENES.HABLAR]);


