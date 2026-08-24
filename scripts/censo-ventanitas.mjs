#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DE VENTANITAS DEL NAVEGADOR — `prompt()` y `confirm()` que quedan vivos en el producto.
//
// POR QUÉ EXISTE (23 ago 2026): Chrome ofrece la casilla «Impedir que esta página cree cuadros de
// diálogo adicionales» en el SEGUNDO diálogo seguido. En cuanto alguien la marca, `prompt` devuelve
// null y `confirm` devuelve false SIN ENSEÑAR NADA: el botón queda muerto, sin ventana, sin petición
// y sin aviso. Las pantallas que encadenan DOS son las que rompen del todo; las de una sola «solo»
// se silencian. La cura ya existe y es compartida: `window.pedirDatos()` y
// `window.confirmarEnPagina()` en `layout.js`.
//
// NO CUENTA lo que está en un comentario: la mitad de las apariciones son las notas que explican
// esta misma avería, y contarlas daría un número inflado que nunca llegaría a cero.
//
//   node scripts/censo-ventanitas.mjs              → resumen por fichero
//   node scripts/censo-ventanitas.mjs --detalle    → cada línea, con su texto
//   node scripts/censo-ventanitas.mjs --json
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DETALLE = process.argv.includes('--detalle');
const JSON_OUT = process.argv.includes('--json');

// Una llamada de verdad: `prompt(` o `confirm(` que no vaya precedida de punto ni de letra
// (`window.confirm` sí cuenta; `confirmarEnPagina` no) y que no esté dentro de un comentario.
const RE = /(?<![\w.$])(prompt|confirm)\s*\(/g;

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
function soloCodigo(src) {
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
function sinComentariosHtml(src) {
  return src.replace(/<!--[\s\S]*?-->/g, t => t.replace(/[^\n]/g, ' '));
}

// El comentario de una sola línea, en los DOS niveles: el del servidor y el del JavaScript que va
// dentro de la plantilla. Se corta en el primer `//` que no sea el de una dirección (`https://`).
// Es una regla de brocha gorda a propósito: lo único que puede perderse por ella es un `confirm(`
// escrito DETRÁS de un comentario en la misma línea, que no existe en este producto — y a cambio
// caza las notas que explican esta misma avería, que son la mayoría de las apariciones.
function sinComentariosDeLinea(linea) {
  const i = linea.search(/(^|[^:'"`\\])\/\//);
  return i === -1 ? linea : linea.slice(0, i + 1);
}

const hallazgos = [];
const barrer = d => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data'].includes(f.name)) continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) { barrer(p); continue; }
    if (!f.name.endsWith('.js')) continue;
    const bruto = fs.readFileSync(p, 'utf8');
    const limpio = sinComentariosHtml(soloCodigo(bruto));
    const originales = bruto.split('\n');
    limpio.split('\n').forEach((linea, i) => {
      const l = sinComentariosDeLinea(linea);
      for (const m of l.matchAll(RE)) {
        hallazgos.push({ fichero: path.relative(RAIZ, p), linea: i + 1, tipo: m[1],
                         texto: (originales[i] || '').trim().slice(0, 100) });
      }
    });
  }
};

barrer(path.join(RAIZ, 'modules'));

if (JSON_OUT) { console.log(JSON.stringify(hallazgos, null, 1)); process.exit(0); }

const porFichero = {};
for (const h of hallazgos) (porFichero[h.fichero] ||= []).push(h);
const nP = hallazgos.filter(h => h.tipo === 'prompt').length;
const nC = hallazgos.filter(h => h.tipo === 'confirm').length;

console.log(`\nVENTANITAS VIVAS: ${hallazgos.length}  (${nP} prompt · ${nC} confirm)  en ${Object.keys(porFichero).length} ficheros`);
console.log('(no se cuentan las que aparecen en comentarios: son las notas que explican la avería)\n');
for (const [f, hs] of Object.entries(porFichero).sort((a, b) => b[1].length - a[1].length)) {
  const p = hs.filter(h => h.tipo === 'prompt').length, c = hs.length - p;
  console.log(`${String(hs.length).padStart(3)}  ${f}   (prompt ${p}, confirm ${c})`);
  if (DETALLE) for (const h of hs) console.log(`       :${String(h.linea).padEnd(5)} ${h.texto}`);
}
// LAS QUE MATAN: dos diálogos en la misma función. Es el caso exacto de la casilla de Chrome.
const encadenadas = [];
for (const [f, hs] of Object.entries(porFichero)) {
  const ord = [...hs].sort((a, b) => a.linea - b.linea);
  for (let i = 1; i < ord.length; i++) if (ord[i].linea - ord[i - 1].linea <= 6)
    encadenadas.push(f + ':' + ord[i - 1].linea + '+' + ord[i].linea);
}
console.log(`\nENCADENADAS (dos a menos de 6 líneas — el caso que mata): ${encadenadas.length}`);
for (const e of encadenadas) console.log('  · ' + e);
// El pie que el barrido sabe leer (ver scripts/run-gates.mjs · RESUMEN).
console.log('RESULTADO: ' + (hallazgos.length ? 0 : 1) + ' ✓  ·  ' + hallazgos.length + ' ✗');
process.exit(hallazgos.length ? 1 : 0);
