// ─────────────────────────────────────────────────────────────────────────────────────────────────
// LEER UN FICHERO COMO LO LEE JAVASCRIPT — el código, con los comentarios fuera.
//
// Vivía dentro de `scripts/censo-ventanitas.mjs`, que lo estrenó y le pagó el precio del bug del
// 24 ago 2026 (abajo). Sale a esta pieza compartida el 3 sep 2026, al necesitarlo un segundo censo
// (`censo-borrado-sin-filtro.mjs`). **Se mueve, no se copia**, y por el motivo de siempre en este
// repo: dos copias de la misma regla son dos reglas en cuanto alguien retoca una — y la que se
// quedara sin el arreglo del `*/*` volvería a decir CERO sin ser cierto.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// ── POR QUÉ ESTO SE LEE CARÁCTER A CARÁCTER Y NO A GOLPE DE `indexOf` ──────────────────────────
// 24 ago 2026. La versión anterior decidía «esta línea va dentro de un comentario» comparando
// `lastIndexOf('/*')` con `lastIndexOf('*/')`. Y en `modules/erp/routes/conciliacion-routes.js`
// hay esta línea, que es HTML dentro de una plantilla:
//
//     <input type="file" name="file" accept=".q43,.n43,.txt,.043,*/*" required>
//
// El `*/*` del filtro de ficheros contiene un `/*` DESPUÉS de un `*/`, así que el censo se creyó
// dentro de un comentario **desde ahí hasta el final del fichero** — y se comió una ventanita VIVA:
// el botón «Deshacer» de Conciliación bancaria, que abre un `confirm()` de verdad. El censo decía
// CERO y había una. **Un censo que dice cero y no es cierto es peor que no tenerlo**, porque cierra
// la pregunta.
//
// La cura no es otro parche sobre el mismo truco: es leer el fichero como lo lee JavaScript. Este
// recorrido conoce las cinco cosas donde un `/*` NO abre un comentario —comilla simple, comilla
// doble, plantilla (con sus `${}` anidados), expresión regular y el propio comentario— y devuelve el
// código con los comentarios ya fuera, conservando los saltos de línea para no descolocar los
// números. Los comentarios de HTML (`<!-- -->`) se quitan después, sobre lo que quede.
export function soloCodigo(src) {
  let out = '', i = 0;
  const n = src.length;
  const hueco = t => t.replace(/[^\n]/g, ' ');   // se sustituye por espacios: la línea no se mueve
  // ¿un `/` aquí abre una expresión regular o es una división? Se mira el último carácter con
  // significado: tras `(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `}`, `;` o principio, es regex.
  const abreRegex = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      const c = out[k];
      if (/\s/.test(c)) continue;
      return '(,=:[!&|?{};+-*%^~<>'.includes(c);
    }
    return true;
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    // El `//` NO se toca aquí. Se quita después, línea a línea, porque la mitad de los comentarios
    // de este producto viven DENTRO de una plantilla (son el JavaScript que se sirve al navegador),
    // y para este recorrido una plantilla es una cadena: si los quitara aquí, no los vería.
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); const fin = j === -1 ? n : j + 2; out += hueco(src.slice(i, fin)); i = fin; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, Math.min(j + 1, n)); i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, prof = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { prof++; j += 2; continue; }
        if (prof > 0 && src[j] === '}') { prof--; j++; continue; }
        if (prof === 0 && src[j] === '`') break;
        j++;
      }
      out += src.slice(i, Math.min(j + 1, n)); i = j + 1; continue;
    }
    if (c === '/' && abreRegex()) {
      let j = i + 1, clase = false, ok = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') clase = true;
        else if (src[j] === ']') clase = false;
        else if (src[j] === '/' && !clase) { ok = true; break; }
        j++;
      }
      if (ok) { out += src.slice(i, j + 1); i = j + 1; continue; }
    }
    out += c; i++;
  }
  return out;
}

// Y los comentarios de HTML dentro de las plantillas, que también son comentarios: la nota que
// explica por qué una pantalla ya NO usa confirm() no puede contar como un confirm() vivo.
export function sinComentariosHtml(src) {
  return src.replace(/<!--[\s\S]*?-->/g, t => t.replace(/[^\n]/g, ' '));
}

// El comentario de una sola línea, en los DOS niveles: el del servidor y el del JavaScript que va
// dentro de la plantilla. Se corta en el primer `//` que no sea el de una dirección (`https://`).
// Es una regla de brocha gorda a propósito: lo único que puede perderse por ella es un `confirm(`
// escrito DETRÁS de un comentario en la misma línea, que no existe en este producto — y a cambio
// caza las notas que explican esta misma avería, que son la mayoría de las apariciones.
export function sinComentariosDeLinea(linea) {
  const i = linea.search(/(^|[^:'"`\\])\/\//);
  return i === -1 ? linea : linea.slice(0, i + 1);
}
