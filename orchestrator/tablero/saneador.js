// saneador.js — Arregla el FORMATO del tablero. Nunca decide qué se construye.
//
// LA LÍNEA QUE NO SE CRUZA
// ───────────────────────
// Un problema de FORMATO —dos rótulos de «siguiente», una tarea sin identificador, un rótulo
// a medias— lo arregla el sistema, solo, con la regla escrita de abajo, y lo cuenta en el
// parte. NUNCA se le pasa a Ibrahin: él decide qué se construye y para qué sirve, no cómo
// está escrito el documento.
//
// Un problema de CONTENIDO —la tarea está mal planteada, contradice el CANON, no se puede
// hacer— NO se toca aquí. Eso lo dice el arquitecto cuando le toque, y sí sube a Ibrahin
// como decisión de producto.
//
// `diagnosticar` y `sanear` son PURAS: entra texto, sale texto y una lista de arreglos. Se
// prueban sin disco.

import { slug, normalizar } from '../reader.js';

/** Frases que aparecen tras un rótulo de «siguiente tarea» y NO son una tarea. */
const NO_ES_TAREA = /^(a la espera|sin decidir|pendiente de (encargo|decidir)|ninguna|por decidir|—|-)\b/i;

/**
 * Lo que sigue al rótulo, cosiendo la línea siguiente.
 *
 * El tablero está escrito a 100 columnas, así que una frase larga se parte. La línea 197 del
 * TABLERO real acaba justo en «SIGUIENTE TAREA OFICIAL: A» y sigue en la de abajo con «LA ESPERA
 * DE ENCARGO». Sin coser, se clasificaría como una tarea llamada «A».
 */
export function restoTrasRotulo(lineas, i) {
  const m = /siguiente\s+tarea(?:\s+oficial)?\s*:\s*(.*)$/i.exec(lineas[i]);
  if (!m) return null;
  let resto = m[1];
  const sigue = lineas[i + 1];
  if (sigue !== undefined && resto.trim().length < 60) {
    const cont = sigue.replace(/^\s*>?\s*/, '');
    if (cont && !RE_ENCABEZADO.test(sigue)) resto = `${resto.trim()} ${cont}`;
  }
  return resto.replace(/\*+\s*$/, '').trim();
}

const RE_ENCABEZADO = /^(#{1,6})\s+(.*)$/;
const esSiguiente = (titulo) => /siguiente\s+tarea/.test(normalizar(titulo));
const esTareaConvertida = (titulo) => /^\s*tareas?\s*[—–\-:·|]/i.test(titulo) || esSiguiente(titulo);

/**
 * LAS REGLAS. Están aquí, escritas, y no repartidas por el código a propósito: si alguien
 * quiere saber qué se arregla solo y con qué criterio, este es el único sitio que hay que leer.
 */
export const REGLAS = Object.freeze([
  { id: 'R1', que: 'Dos o más encabezados con el rótulo «SIGUIENTE TAREA»',
    hace: 'Gana el PRIMERO en orden del documento; a los demás se les quita el rótulo y quedan como «TAREA —».',
    porque: 'El orden del documento es lo que lee una persona de arriba abajo. Elegir por cualquier otro criterio sería inventarse una prioridad que nadie escribió.' },
  { id: 'R2', que: 'Un rótulo de «siguiente tarea» suelto en prosa, existiendo ya un encabezado',
    hace: 'Se deja la prosa intacta y se anota en el parte. El encabezado manda.',
    porque: 'Reescribir prosa a ciegas en un documento de 8.000 líneas es justo lo que no se puede automatizar. Y no hace falta: el lector ya prefiere el encabezado.' },
  { id: 'R3', que: 'Una tarea con encabezado pero SIN identificador',
    hace: 'Se le escribe uno derivado de su título.',
    porque: 'Sin identificador no hay forma de seguir sus commits ni de reabrirla. Derivarlo del título es reproducible y no inventa nada.' },
  { id: 'R4', que: 'Dos tareas con el mismo identificador',
    hace: 'La primera lo conserva; a las siguientes se les añade -2, -3…',
    porque: 'Un identificador repetido hace que el orquestador trabaje sobre la tarea equivocada sin enterarse.' },
  { id: 'R5', que: 'Un rótulo «SIGUIENTE TAREA» sin título detrás',
    hace: 'Se completa con la primera línea con contenido de su bloque.',
    porque: 'Un título vacío deja el parte y el commit sin nombre que enseñar.' },
  { id: 'R6', que: 'Un rótulo de «siguiente» que no señala a una tarea («A LA ESPERA DE ENCARGO»)',
    hace: 'No se coge como tarea. Se anota y el orquestador sigue ocioso.',
    porque: 'Eso no es una tarea: es la ausencia de una. Cogerla haría trabajar al sistema sobre una frase.' },
]);

/** Los bloques con pinta de tarea que hay en el documento. */
function bloques(lineas) {
  const fuera = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = RE_ENCABEZADO.exec(lineas[i]);
    if (!m) continue;
    const titulo = m[2].trim();
    if (!esTareaConvertida(titulo)) continue;
    // Fin del bloque: el siguiente encabezado de nivel igual o superior.
    const nivel = m[1].length;
    let fin = lineas.length;
    for (let j = i + 1; j < lineas.length; j++) {
      const n = RE_ENCABEZADO.exec(lineas[j]);
      if (n && n[1].length <= nivel) { fin = j; break; }
    }
    fuera.push({ i, fin, nivel, marcas: m[1], titulo, siguiente: esSiguiente(titulo) });
  }
  return fuera;
}

/** El identificador escrito dentro del bloque, si lo hay. */
function idDeclarado(lineas, b) {
  for (let j = b.i + 1; j < b.fin; j++) {
    if (RE_ENCABEZADO.test(lineas[j])) break;
    const m = /^\s*(?:[-*+]\s*)?[*_]*\s*id\s*[*_]*\s*:\s*[*_]*\s*([^\s*_`]+)/i.exec(lineas[j]);
    if (m) return { id: m[1], linea: j };
  }
  return null;
}

/** El título limpio, sin el rótulo. */
function tituloSinRotulo(titulo) {
  return titulo
    .replace(/siguiente\s+tarea(\s+oficial)?/i, '')
    .replace(/^\s*tareas?\s*(?=[—–\-:·|])/i, '')
    .replace(/^[\s—–\-:·|]+/, '')
    .trim();
}

/**
 * Mira el documento y dice qué está mal de FORMATO. No cambia nada.
 * @returns { problemas: [{ regla, linea, detalle }] }
 */
export function diagnosticar(texto) {
  const lineas = String(texto).split('\n');
  const bs = bloques(lineas);
  const problemas = [];

  const conRotulo = bs.filter((b) => b.siguiente);
  if (conRotulo.length > 1) {
    for (const b of conRotulo.slice(1)) {
      problemas.push({ regla: 'R1', linea: b.i + 1,
        detalle: `«${tituloSinRotulo(b.titulo) || b.titulo}» también llevaba el rótulo de siguiente` });
    }
  }

  // R2 · prosa con rótulo, habiendo encabezado
  if (bs.length) {
    for (let i = 0; i < lineas.length; i++) {
      if (RE_ENCABEZADO.test(lineas[i])) continue;
      const resto = restoTrasRotulo(lineas, i);
      if (!resto) continue;
      problemas.push({ regla: NO_ES_TAREA.test(resto) ? 'R6' : 'R2', linea: i + 1,
        detalle: `prosa con rótulo de siguiente: «${resto.slice(0, 70)}»` });
    }
  }

  const vistos = new Map();
  for (const b of bs) {
    const decl = idDeclarado(lineas, b);
    const limpio = tituloSinRotulo(b.titulo);

    if (b.siguiente && !limpio) {
      problemas.push({ regla: 'R5', linea: b.i + 1, detalle: 'el rótulo de siguiente no lleva título detrás' });
    }
    if (!decl) {
      problemas.push({ regla: 'R3', linea: b.i + 1,
        detalle: `«${limpio || b.titulo}» no tiene identificador escrito` });
    } else {
      const n = (vistos.get(decl.id) || 0) + 1;
      vistos.set(decl.id, n);
      if (n > 1) {
        problemas.push({ regla: 'R4', linea: decl.linea + 1,
          detalle: `el identificador «${decl.id}» ya lo usaba otra tarea` });
      }
    }
  }
  return { problemas, tareas: bs.length };
}

/**
 * Arregla lo que se puede arreglar. PURA: devuelve texto nuevo y lo que hizo.
 * @returns { texto, arreglos: [{ regla, linea, que, comoQueda }], anotados: [...] }
 */
export function sanear(texto, { fecha = new Date().toISOString().slice(0, 10) } = {}) {
  const lineas = String(texto).split('\n');
  const arreglos = [];
  const anotados = [];

  const bs = bloques(lineas);

  // ── R1 · un solo rótulo de siguiente: gana el primero ──
  const conRotulo = bs.filter((b) => b.siguiente);
  for (const b of conRotulo.slice(1)) {
    const limpio = tituloSinRotulo(b.titulo) || 'sin título';
    lineas[b.i] = `${b.marcas} TAREA — ${limpio}`;
    arreglos.push({ regla: 'R1', linea: b.i + 1, que: `«${limpio}» llevaba también el rótulo de siguiente`,
                    comoQueda: 'le he quitado el rótulo; sigue pendiente como las demás' });
  }

  // ── R5 · rótulo sin título ──
  for (const b of bs) {
    if (!b.siguiente || tituloSinRotulo(b.titulo)) continue;
    let prestado = '';
    for (let j = b.i + 1; j < b.fin && !prestado; j++) {
      const l = lineas[j].trim();
      if (l && !RE_ENCABEZADO.test(l) && !/^[->*+#]/.test(l)) prestado = l.slice(0, 70);
    }
    if (prestado) {
      lineas[b.i] = `${b.marcas} SIGUIENTE TAREA — ${prestado}`;
      arreglos.push({ regla: 'R5', linea: b.i + 1, que: 'el rótulo de siguiente no tenía título',
                      comoQueda: `le he puesto «${prestado}», sacado de su propio texto` });
    }
  }

  // ── R3 y R4 · identificadores. Se recalculan los bloques: R1/R5 movieron títulos ──
  const bs2 = bloques(lineas);
  const vistos = new Map();
  // De atrás hacia delante: insertar líneas no desplaza los bloques que quedan por mirar.
  for (const b of [...bs2].reverse()) {
    const limpio = tituloSinRotulo(b.titulo) || 'tarea';
    const decl = idDeclarado(lineas, b);
    if (!decl) {
      const nuevo = slug(limpio) || 'tarea-sin-nombre';
      lineas.splice(b.i + 1, 0, '', `- **id:** ${nuevo}`);
      arreglos.push({ regla: 'R3', linea: b.i + 1, que: `«${limpio}» no tenía identificador`,
                      comoQueda: `le he puesto «${nuevo}», sacado de su título` });
    }
  }
  // Duplicados, ya en orden natural.
  const bs3 = bloques(lineas);
  for (const b of bs3) {
    const decl = idDeclarado(lineas, b);
    if (!decl) continue;
    const n = (vistos.get(decl.id) || 0) + 1;
    vistos.set(decl.id, n);
    if (n === 1) continue;
    const nuevo = `${decl.id}-${n}`;
    lineas[decl.linea] = lineas[decl.linea].replace(decl.id, nuevo);
    vistos.set(nuevo, 1);
    arreglos.push({ regla: 'R4', linea: decl.linea + 1, que: `el identificador «${decl.id}» estaba repetido`,
                    comoQueda: `esta pasa a llamarse «${nuevo}»` });
  }

  // ── R2 y R6 · prosa: NO se reescribe, se anota ──
  if (bs3.length) {
    for (let i = 0; i < lineas.length; i++) {
      if (RE_ENCABEZADO.test(lineas[i])) continue;
      const resto = restoTrasRotulo(lineas, i);
      if (!resto) continue;
      anotados.push({ regla: NO_ES_TAREA.test(resto) ? 'R6' : 'R2', linea: i + 1,
        que: `hay una línea de prosa con rótulo de siguiente: «${resto.slice(0, 60)}»`,
        comoQueda: 'la dejo tal cual y no la cojo como tarea: manda el encabezado' });
    }
  }

  return { texto: lineas.join('\n'), arreglos, anotados, cambiado: arreglos.length > 0 };
}

/** Para el parte y el registro, en castellano llano. */
export function contar(arreglos, anotados = []) {
  if (!arreglos.length && !anotados.length) return null;
  const l = [];
  for (const a of arreglos) l.push(`${a.que} → ${a.comoQueda} (línea ${a.linea})`);
  for (const a of anotados) l.push(`${a.que} → ${a.comoQueda} (línea ${a.linea})`);
  return l;
}
