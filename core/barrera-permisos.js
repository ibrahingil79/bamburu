// core/barrera-permisos.js — EL PORTERO. Convierte el censo de permisos (foto) en una barrera
// (impide que empeore).
//
// DE DÓNDE SALE (tarea `barrera-de-permisos`, 8 sep 2026). El censo del 7 sep (`permisos-paso-1-
// censo-rutas`) mide qué permiso exige cada ruta HOY, y se regenera solo en menos de un segundo —
// pero es una foto: dice cómo están las cosas, no impide que empeoren. Así lo hacen las
// plataformas serias: no revisan más a mano, hacen que el error sea imposible.
//
// QUÉ HACE, EN TRES REGLAS — y son las tres, ni una más:
//   1. Ruta NUEVA que no está en la declaración → NO ARRANCA. Toda ruta nueva es una decisión, no
//      un descuido — igual que `gate-permisos-por-ruta` ya vigila para las 14 públicas.
//   2. Ruta que hoy pide MENOS que lo declarado (bajó de tier) → NO ARRANCA. Es la regresión que
//      esto existe para impedir: alguien quita un `requirePerm` sin querer y la ruta se abre.
//   3. Ruta que hoy pide MÁS que lo declarado (subió de tier) → arranca, y lo dice. Añadir
//      seguridad nunca debe bloquear un despliegue.
//
// «TIER» — LOS CUATRO VEREDICTOS, EN UNA ESCALA. `sin guarda` (0) < `solo sesion` (1) <
// {`por dentro`, `permiso`} (2, la misma banda: los dos son una comprobación real, solo cambia
// DÓNDE vive en el código — `core/mapa-rutas.js` lo explica). Comparar el NOMBRE exacto del
// permiso (p. ej. `ventas.ver` → `ventas.editar`) no es esta tarea: eso es una decisión de negocio,
// no una regresión de seguridad, y forzarlo aquí pararía despliegues legítimos.
//
// LA PARTE CARA SE QUEDA FUERA. `clasificarRutas(app)` sin `sitio` no toca el inspector de Node:
// lee `fn.bamburuGuarda`, una propiedad de la función — pero `clasificarRutas` también llama
// `Function.prototype.toString` sobre cada eslabón de cada ruta para mirar si NIEGA_EL_PASO o
// POR_DENTRO, y eso sí tiene coste real. Medido el 8 sep 2026, cinco pasadas seguidas sobre las
// 573 rutas de hoy: **34-49 ms**. Frente a los 653 ms que ya cuesta montar la app (`loadModules`),
// es un 5-7 % más — no lo que se dijo la primera vez («<5 ms», sin medir la parte del `toString`).
// Sigue sin ser un problema para un arranque, que no es un camino caliente.
//
// DECLARAR NO ES APROBAR: la declaración (`docs/seguridad/permisos-declarados.json`) la escribe un
// humano a mano, ejecutando `node scripts/censo-permisos-rutas.mjs --declarar <fichero>` DESPUÉS de
// mirar lo que cambió y decidir que está bien. El arranque nunca la regenera ni la toca.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clasificarRutas } from './mapa-rutas.js';

export const DECLARACION_PATH = 'docs/seguridad/permisos-declarados.json';

const NIVEL = { 'sin guarda': 0, 'solo sesion': 1, 'por dentro': 2, 'permiso': 2 };

/** Lee la declaración del disco. Lanza si no existe o no se puede parsear — sin declaración, la
 *  barrera no tiene con qué comparar, y arrancar sin comparar sería fingir que la barrera existe. */
function leerDeclaracion(raiz) {
  const ruta = join(raiz, DECLARACION_PATH);
  let texto;
  try { texto = readFileSync(ruta, 'utf8'); }
  catch (e) { throw new Error('no se pudo leer la declaración (' + DECLARACION_PATH + '): ' + e.message); }
  try { return JSON.parse(texto); }
  catch (e) { throw new Error('la declaración (' + DECLARACION_PATH + ') no es JSON válido: ' + e.message); }
}

/**
 * Compara la app real contra la declaración. Devuelve:
 *   { ok:true,  avisos:[...] }                              — arranca, con 0+ avisos de "pide más"
 *   { ok:false, motivo, detalle, mensaje }                   — no arranca
 * `mensaje` está en español llano, pensado para Ibrahin: qué pantalla, qué se esperaba, qué hay,
 * y qué hacer — no una traza de JavaScript.
 */
export function compararConDeclaracion(app, { raiz = process.cwd() } = {}) {
  let declaracion;
  try { declaracion = leerDeclaracion(raiz); }
  catch (e) {
    return {
      ok: false, motivo: 'sin-declaracion', detalle: e.message,
      mensaje: 'La barrera de permisos no encuentra su declaración (' + DECLARACION_PATH + ').\n'
        + 'Motivo: ' + e.message + '\n'
        + 'Qué hacer: node scripts/censo-permisos-rutas.mjs --declarar ' + DECLARACION_PATH,
    };
  }

  const real = clasificarRutas(app);   // sin `sitio`: no toca el inspector, coste ~nulo
  const nuevas = [];
  const bajadas = [];
  const subidas = [];

  for (const r of real.rutas) {
    const clave = r.metodo + ' ' + r.camino;
    const declarada = declaracion.rutas?.[clave];
    if (!declarada) { nuevas.push(clave); continue; }
    const nivelReal = NIVEL[r.veredicto] ?? 0;
    const nivelDeclarado = NIVEL[declarada.veredicto] ?? 0;
    if (nivelReal < nivelDeclarado) {
      bajadas.push({ ruta: clave, declarado: declarada.veredicto, ahora: r.veredicto });
    } else if (nivelReal > nivelDeclarado) {
      subidas.push({ ruta: clave, declarado: declarada.veredicto, ahora: r.veredicto });
    }
  }

  if (nuevas.length) {
    return {
      ok: false, motivo: 'ruta-sin-declarar', detalle: nuevas,
      mensaje: 'Bamburu no arranca: hay ' + nuevas.length + ' ruta(s) nueva(s) que nadie ha declarado.\n'
        + nuevas.map(r => '  · ' + r).join('\n') + '\n\n'
        + 'Qué se esperaba: toda ruta tiene que estar en ' + DECLARACION_PATH + ' antes de servirla —'
        + ' que una ruta nueva no pida nada tiene que ser una decisión, no un descuido.\n'
        + 'Qué hay: la(s) ruta(s) de arriba responden de verdad pero no están en la declaración.\n'
        + 'Qué hacer: si es a propósito, revisa qué permiso debe exigir y ejecuta '
        + 'node scripts/censo-permisos-rutas.mjs --declarar ' + DECLARACION_PATH + ' — si no lo es, revierte el cambio.',
    };
  }

  if (bajadas.length) {
    return {
      ok: false, motivo: 'permiso-rebajado', detalle: bajadas,
      mensaje: 'Bamburu no arranca: ' + bajadas.length + ' ruta(s) piden AHORA MENOS de lo declarado.\n'
        + bajadas.map(b => '  · ' + b.ruta + ' — declarado «' + b.declarado + '», ahora «' + b.ahora + '»').join('\n') + '\n\n'
        + 'Qué se esperaba: que siguieran exigiendo, como mínimo, lo mismo que el ' + (declaracion.generado_en || '').slice(0, 10) + '.\n'
        + 'Qué hay: alguna guarda (`requirePerm`, una comprobación por dentro…) se ha quitado o se ha aflojado.\n'
        + 'Qué hacer: si es un descuido, devuelve la guarda a su sitio. Si es a propósito, deja escrito el '
        + 'motivo (RITUAL.md, REGLA DE SEGURIDAD) y ejecuta '
        + 'node scripts/censo-permisos-rutas.mjs --declarar ' + DECLARACION_PATH + '.',
    };
  }

  return { ok: true, avisos: subidas };
}
