// LINT — el backtick que cierra una plantilla desde dentro de un comentario.
//
// NACE DE LA MISMA TRAMPA, TRES VECES EN UN DÍA. Casi todo el HTML/JS de Bamburu se sirve desde
// template literals, y dentro de esas plantillas van comentarios que explican el JS que va a correr
// en el navegador. Si uno de esos comentarios lleva un backtick sin escapar —// usa `popstate`—,
// ese backtick CIERRA la plantilla ahí mismo. A veces revienta al arrancar (ruidoso, un minuto de
// arreglo) y a veces no: el fichero parsea y la página sirve HTML basura en silencio.
//
//   node scripts/lint-plantillas.mjs
//
// CÓMO DISTINGUE el caso malo del inocente. Recorre el fichero con dos modos —código y texto de
// plantilla— y respeta el anidamiento de ${...}. Dentro del TEXTO de una plantilla marca solo las
// líneas que empiezan por // (un comentario del JS que se va a emitir) y que llevan un backtick SIN
// escapar. Así no confunde:
//   · https://${host}/algo   → no es comentario: el // no abre línea.
//   · // usa \`title\`       → backtick ESCAPADO: es correcto y no rompe nada.
//   · // usa `popstate`      → ESTO es el fallo, y es lo único que se marca.
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['modules', 'core'];
let malos = 0, mirados = 0;

// ¿Hay un backtick SIN escapar en este trozo?
function backtickCrudo(txt) {
  for (let i = 0; i < txt.length; i++) {
    if (txt[i] === '\\') { i++; continue; }
    if (txt[i] === '`') return true;
  }
  return false;
}

function revisa(ruta) {
  const s = readFileSync(ruta, 'utf8');
  mirados++;
  const rel = ruta.replace(APP + '/', '');
  // pila: 'tpl' = dentro del texto de una plantilla · 'code' = dentro de ${...} o fuera de todo
  const pila = ['code'];
  let i = 0, linea = 1;
  const modo = () => pila[pila.length - 1];
  const avisa = (t) => { malos++; console.error('  ✗ ' + rel + ':' + linea + '  ' + t.trim().slice(0, 78)); };

  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '\n') { linea++; i++; continue; }

    if (modo() === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && d === '{') { pila.push('code'); i += 2; continue; }
      if (c === '`') { pila.pop(); i++; continue; }
      // ¿Arranca aquí una línea de comentario del JS emitido?
      if (c === '/' && d === '/' && /(^|\n)[ \t]*$/.test(s.slice(Math.max(0, i - 200), i))) {
        const fin = s.indexOf('\n', i);
        const cuerpo = s.slice(i, fin === -1 ? s.length : fin);
        if (backtickCrudo(cuerpo)) avisa(cuerpo);
        // NO se salta la línea: el backtick crudo cierra la plantilla de verdad, y el autómata
        // tiene que hacer lo mismo que el motor para no desincronizarse a partir de aquí.
      }
      i++;
      continue;
    }

    // ── modo código ──
    if (c === '\\') { i += 2; continue; }
    if (c === '/' && d === '/') { const f = s.indexOf('\n', i); i = f === -1 ? s.length : f; continue; }
    if (c === '/' && d === '*') {
      const f = s.indexOf('*/', i + 2);
      linea += (s.slice(i, f === -1 ? s.length : f).match(/\n/g) || []).length;
      i = f === -1 ? s.length : f + 2; continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; else if (s[i] === '\n') break; i++; }
      i++; continue;
    }
    if (c === '`') { pila.push('tpl'); i++; continue; }
    if (c === '}' && pila.length > 1) { pila.pop(); i++; continue; }
    i++;
  }
}

function anda(ruta) {
  const st = statSync(ruta);
  if (st.isDirectory()) { for (const f of readdirSync(ruta)) anda(join(ruta, f)); return; }
  if (/\.(js|mjs)$/.test(ruta)) revisa(ruta);
}

for (const d of DIRS) anda(join(APP, d));
console.log(malos
  ? '\n✗ ' + malos + ' backtick(s) sin escapar en un comentario dentro de una plantilla, en ' + mirados + ' ficheros.\n'
    + '  Ese backtick CIERRA la plantilla. Escápalo (\\`) o quítalo ANTES de reiniciar.'
  : '✓ ' + mirados + ' ficheros: ningún backtick suelto en comentario dentro de plantilla.');
process.exit(malos ? 1 : 0);
