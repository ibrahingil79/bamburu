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

function sinComentarios(linea) {
  // Corta en el primer `//` que no vaya dentro de una URL (`://`) ni de una cadena obvia.
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
    const lineas = fs.readFileSync(p, 'utf8').split('\n');
    let enBloque = false, enHtml = false;
    lineas.forEach((l, i) => {
      // Comentario de bloque de JS: se lleva la línea entera mientras esté abierto.
      const abre = l.lastIndexOf('/*'), cierra = l.lastIndexOf('*/');
      const dentro = enBloque;
      if (abre > cierra) enBloque = true; else if (cierra > abre) enBloque = false;
      if (dentro) return;
      // Y los comentarios de HTML dentro de las plantillas, que también son comentarios: la nota que
      // explica por qué una pantalla ya NO usa confirm() no puede contar como un confirm() vivo.
      const abreH = l.lastIndexOf('<!--'), cierraH = l.lastIndexOf('-->');
      const dentroH = enHtml;
      if (abreH > cierraH) enHtml = true; else if (cierraH > abreH) enHtml = false;
      if (dentroH || (abreH !== -1 && cierraH === -1) || (abreH !== -1 && cierraH > abreH)) {
        // línea que abre, contiene o cierra un comentario HTML: se mira solo lo que queda fuera
        const fuera = (cierraH > abreH && abreH !== -1) ? l.slice(0, abreH) + l.slice(cierraH + 3)
                    : (abreH !== -1 ? l.slice(0, abreH) : (cierraH !== -1 ? l.slice(cierraH + 3) : ''));
        for (const m of sinComentarios(fuera).matchAll(RE))
          hallazgos.push({ fichero: path.relative(RAIZ, p), linea: i + 1, tipo: m[1], texto: l.trim().slice(0, 100) });
        return;
      }
      const util = sinComentarios(l);
      for (const m of util.matchAll(RE)) {
        hallazgos.push({ fichero: path.relative(RAIZ, p), linea: i + 1, tipo: m[1], texto: l.trim().slice(0, 100) });
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
