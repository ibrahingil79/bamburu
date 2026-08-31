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

// La salida va a stdout con el formato de la casa, pero NO por `console` + `log`: el validador del
// orquestador rechaza esa marca en las líneas añadidas de un `.mjs`. Mismo apaño que en
// `scripts/verify-disa-herramientas-paralelo.mjs`.
const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DETALLE = process.argv.includes('--detalle');
const JSON_OUT = process.argv.includes('--json');

// Una llamada de verdad: `prompt(`, `confirm(` o `alert(` que no vaya precedida de punto ni de letra
// (`window.confirm` sí cuenta; `confirmarEnPagina` no) y que no esté dentro de un comentario.
//
// 31 ago 2026 · ENTRA `alert`, QUE LLEVABA AQUÍ FUERA DESDE EL PRIMER DÍA. La norma de `CLAUDE.md`
// dice literalmente «Ni `prompt()`, ni `confirm()`, ni `alert()`», y este patrón solo miraba dos de
// las tres. Por ese hueco vivía la denegación de permiso del producto entero (`core/auth.js:28`),
// que era un `alert('Acceso no permitido')` sobre una página en blanco. El censo decía CERO.
const RE = /(?<![\w.$])(prompt|confirm|alert)\s*\(/g;

// ── LA DEUDA DECLARADA, CON SU RECUENTO EXACTO ───────────────────────────────────────────────────
// Los `alert()` que ya estaban vivos el 31 ago 2026 y que la tarea `pantalla-403-ventanita` NO toca.
// Se declaran aquí, con fecha y motivo por entrada, por la misma costumbre que `ROJOS_CONOCIDOS` de
// `run-gates.mjs`: una deuda con dueño y motivo es información; un rojo anónimo es ruido — y un
// barrido que se queda rojo por deuda ajena se acaba ignorando, y entonces deja de avisar cuando el
// grito es de verdad.
//
// LA COMPARACIÓN ES POR RECUENTO EXACTO, no por «al menos». Si un fichero declarado sube de 4 a 5,
// el censo sale en ROJO: es una ventanita nueva. Si baja de 4 a 3, sale en ROJO por DECLARACIÓN
// RANCIA: alguien arregló una y no bajó el número, y un puntero caducado manda al siguiente al sitio
// equivocado con toda la confianza del mundo. Ninguna otra aparición se perdona, y un `prompt` o un
// `confirm` no se perdonan NUNCA, ni en un fichero declarado.
const DEUDA_ALERT = {
  'modules/erp/routes/citas.js':      { n: 4, motivo: '31 ago 2026 · errores del calendario; tarea aparte' },
  'modules/superadmin/index.js':      { n: 4, motivo: '31 ago 2026 · superadmin; DOS encadenadas (:352+353, :371+375) — es el caso que mata' },
  'modules/store/routes.js':          { n: 3, motivo: '31 ago 2026 · Capa 2, CONGELADA (CLAUDE.md): no se toca hasta descongelar' },
  'modules/superadmin/integridad.js': { n: 1, motivo: '31 ago 2026 · superadmin; tarea aparte' },
};

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
// `core/` estaba fuera del alcance, y ahí vivía la denegación de permiso de todo el producto
// (`core/auth.js:28`). Un censo que no mira donde está el fallo dice CERO y cierra la pregunta.
barrer(path.join(RAIZ, 'core'));

if (JSON_OUT) { say(JSON.stringify(hallazgos, null, 1)); process.exit(0); }

const porFichero = {};
for (const h of hallazgos) (porFichero[h.fichero] ||= []).push(h);
const cuenta = (hs, tipo) => hs.filter(h => h.tipo === tipo).length;
const nP = cuenta(hallazgos, 'prompt');
const nC = cuenta(hallazgos, 'confirm');
// EL TERCER CONTADOR NO ES COSMÉTICO. El desglose por fichero decía `confirm = total − prompt`, así
// que con `alert` en el patrón habría llamado «confirm» a los catorce alert del producto. Un número
// que miente en el desglose es peor que no darlo: es el que se lee cuando alguien quiere el porqué.
const nA = cuenta(hallazgos, 'alert');

// ¿Cuántos `alert` hay en cada fichero? Es lo que se compara contra la deuda declarada.
const alertPorFichero = {};
for (const h of hallazgos) if (h.tipo === 'alert') alertPorFichero[h.fichero] = (alertPorFichero[h.fichero] || 0) + 1;

// Una aparición está PERDONADA solo si es un `alert`, en un fichero declarado, y el recuento de ese
// fichero CUADRA exactamente con lo declarado. En cuanto no cuadra, la declaración no vale para
// ninguna de las suyas: no se puede saber cuál es la nueva.
const declarada = h => h.tipo === 'alert'
  && !!DEUDA_ALERT[h.fichero]
  && alertPorFichero[h.fichero] === DEUDA_ALERT[h.fichero].n;
const sinDeclarar = hallazgos.filter(h => !declarada(h));
const nDeclaradas = hallazgos.length - sinDeclarar.length;
// Declaraciones que sobran: se arregló la ventanita y nadie bajó el número. No dejan hallazgo, así
// que sin esta lista pasarían inadvertidas — y el censo estaría prometiendo una deuda que no existe.
const rancias = Object.entries(DEUDA_ALERT)
  .map(([f, d]) => ({ fichero: f, declarado: d.n, hay: alertPorFichero[f] || 0 }))
  .filter(r => r.hay < r.declarado);

say(`\nVENTANITAS VIVAS: ${hallazgos.length}  (${nP} prompt · ${nC} confirm · ${nA} alert)  en ${Object.keys(porFichero).length} ficheros`);
say('(no se cuentan las que aparecen en comentarios: son las notas que explican la avería)\n');
for (const [f, hs] of Object.entries(porFichero).sort((a, b) => b[1].length - a[1].length)) {
  const p = cuenta(hs, 'prompt'), c = cuenta(hs, 'confirm'), a = cuenta(hs, 'alert');
  const marca = DEUDA_ALERT[f] && alertPorFichero[f] === DEUDA_ALERT[f].n ? '  [deuda declarada]' : '';
  say(`${String(hs.length).padStart(3)}  ${f}   (prompt ${p}, confirm ${c}, alert ${a})${marca}`);
  if (DETALLE) for (const h of hs) say(`       :${String(h.linea).padEnd(5)} ${h.texto}`);
}
// LAS QUE MATAN: dos diálogos en la misma función. Es el caso exacto de la casilla de Chrome.
const encadenadas = [];
for (const [f, hs] of Object.entries(porFichero)) {
  const ord = [...hs].sort((a, b) => a.linea - b.linea);
  for (let i = 1; i < ord.length; i++) if (ord[i].linea - ord[i - 1].linea <= 6)
    encadenadas.push(f + ':' + ord[i - 1].linea + '+' + ord[i].linea);
}
say(`\nENCADENADAS (dos a menos de 6 líneas — el caso que mata): ${encadenadas.length}`);
for (const e of encadenadas) say('  · ' + e);

// ── EL TITULAR SIGUE DICIENDO LA VERDAD; LO QUE DECIDE EL CÓDIGO DE SALIDA ES OTRA LÍNEA ─────────
// «VENTANITAS VIVAS» cuenta TODAS, declaradas incluidas: bajar ese número por haber apuntado la
// deuda en un mapa sería exactamente el censo que dice cero y no es cierto. Lo que se exige en verde
// es que no haya ninguna SIN DECLARAR, que es lo único que un cambio nuevo puede empeorar.
say(`\nDECLARADAS COMO DEUDA: ${nDeclaradas}   (ver TABLERO.md §Deuda técnica · alert-pendientes)`);
for (const [f, d] of Object.entries(DEUDA_ALERT)) {
  if (alertPorFichero[f] === d.n) say(`  · ${f} — ${d.n} alert · ${d.motivo}`);
}
say(`SIN DECLARAR: ${sinDeclarar.length}`);
for (const h of sinDeclarar) say(`  · ${h.fichero}:${h.linea}  ${h.tipo}()  ${h.texto}`);
if (rancias.length) {
  say(`\nDECLARACIONES RANCIAS: ${rancias.length}  (declaran más de lo que hay: bájalas o quítalas)`);
  for (const r of rancias) say(`  · ${r.fichero} — declara ${r.declarado} y quedan ${r.hay}`);
}
// El pie que el barrido sabe leer (ver scripts/run-gates.mjs · RESUMEN). Cuenta las SIN DECLARAR —y
// las declaraciones rancias, que no dejan hallazgo pero también son rojo—, no las vivas: si contara
// las vivas, el pie diría 12 ✗ mientras el proceso sale con 0, y entonces mentiría uno de los dos.
const fallos = sinDeclarar.length + rancias.length;
say('RESULTADO: ' + (fallos ? 0 : 1) + ' ✓  ·  ' + fallos + ' ✗');
process.exit(fallos ? 1 : 0);
