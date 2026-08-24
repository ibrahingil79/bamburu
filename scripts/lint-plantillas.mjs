// LINT — las dos formas de que una plantilla de servidor te rompa la pantalla en silencio.
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
//
// (2) EL ESCAPE DE REGEX QUE LA PLANTILLA SE COME. Dentro de una plantilla, \* no es "asterisco
// literal": el motor se queda con el asterisco y TIRA la barra. Un /\*\*(.+?)\*\*/g escrito en el
// servidor le llega al navegador como /**(.+?)**/g — que NO es un regex, es un comentario de bloque
// seguido de una `g` suelta. La página muere con «g is not defined» y el resto del bloque no corre.
// Me pasó el 19-ago-2026 y dejó la capa de visitas en blanco con el endpoint devolviendo 200.
// Se marcan los escapes que solo tienen sentido en un regex y que la plantilla destruye: hay que
// doblar la barra (\\*) o quitar el regex.
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
  // Cada marco de código lleva su PROFUNDIDAD DE LLAVES. Sin ella, el `}` de cualquier objeto o
  // función dentro de un ${...} cerraba el marco antes de tiempo y el autómata se creía fuera de la
  // plantilla a partir de ahí — que es de donde salían los falsos positivos.
  const pila = [{ modo: 'code', llaves: 0 }];
  let i = 0, linea = 1;
  const marco = () => pila[pila.length - 1];
  const modo = () => marco().modo;
  const avisa = (t) => { malos++; console.error('  ✗ ' + rel + ':' + linea + '  backtick: ' + t.trim().slice(0, 70)); };
  const vistos = new Set();
  const avisaEscape = (t) => {
    const k = rel + ':' + linea;
    if (vistos.has(k)) return; vistos.add(k);
    malos++; console.error('  ✗ ' + rel + ':' + linea + '  escape comido por la plantilla: ' + t.trim().slice(0, 70));
  };

  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '\n') { linea++; i++; continue; }

    if (modo() === 'tpl') {
      if (c === '\\') {
        // Escapes que la plantilla se COME. En texto de plantilla no hay ninguna razón legítima para
        // escribir \d o \* : el motor tira la barra y lo que llega al navegador ya no es lo escrito.
        // `\\/` queda fuera: `<\\/script>` es un idioma legítimo y deliberado, no un despiste.
        // LA COMILLA ESCAPADA ENTRA EN LA LISTA, y es la que más caro ha salido: el 21 ago 2026 dejó
        // MUERTAS dos pantallas (facturas y «Registrar recepción»). Cuando dentro de la plantilla se
        // escribe una cadena de JS **del navegador**, la plantilla se come la barra, llega un
        // apóstrofo pelado que CIERRA la cadena y el bloque entero deja de ejecutarse: los botones no
        // responden y no sale ni un error. En texto de plantilla una comilla NO necesita escape, así
        // que un `\'` aquí es siempre un despiste. El `\\'` bien escrito no llega hasta aquí: el
        // bucle consume los pares de barras antes.
        // LA COMILLA SE MIDE POR LA RACHA DE BARRAS, no por «hay una barra». Sale mal solo cuando la
        // racha es de UNA: la plantilla se la come y llega un apóstrofo pelado que CIERRA la cadena
        // de JS del navegador. Con dos o más, al menos una sobrevive y el escape llega entero, que es
        // como está escrito `<button onclick="x(\\\'…')">` en varios sitios y es CORRECTO.
        let barras = 0;
        while (s[i + barras] === '\\') barras++;
        const tras = s[i + barras];
        const esComilla = tras === "'" || tras === '"';
        if (!marco().raw && esComilla && barras === 1) {
          const l0 = s.lastIndexOf('\n', i) + 1;
          const l1 = s.indexOf('\n', i);
          avisaEscape(s.slice(l0, l1 === -1 ? s.length : l1));
          i += barras + 1; continue;
        }
        if (esComilla) { i += barras + 1; continue; }
        // LA BARRA DE UN REGEX (`\/`) TAMBIÉN SE LA COME, y esta lista la dejaba pasar entera
        // porque `<\/script>` es un idioma legítimo. Se distingue por lo que va DELANTE: si la
        // barra invertida viene tras un `<`, es el cierre de una etiqueta y está bien; en cualquier
        // otro sitio es el delimitador de un regex y la plantilla lo destruye. El 24 ago 2026 esto
        // dejó MUERTA la pantalla de plantillas de correo: un `/^https?:\/\/.+/` llegó al navegador
        // como `/^https?://.+/` y el script entero de la pantalla no arrancó — ni una plantilla
        // pintada, y este lint decía «limpias».
        const barraDeRegex = d === '/' && s[i - 1] !== '<';
        if (!marco().raw && (barraDeRegex || '*.+?()[]{}|^sdwbSDWB'.includes(d))) {
          const l0 = s.lastIndexOf('\n', i) + 1;
          const l1 = s.indexOf('\n', i);
          avisaEscape(s.slice(l0, l1 === -1 ? s.length : l1));
        }
        i += 2; continue;
      }
      if (c === '$' && d === '{') { pila.push({ modo: 'code', llaves: 0 }); i += 2; continue; }
      if (c === '`') { pila.pop(); i++; continue; }
      // ¿Arranca aquí un comentario del JS/CSS emitido? Se marcan LOS DOS tipos: la primera versión
      // de este lint solo miraba los de //, y un /* ... */ con un backtick dentro se le coló y me
      // rompió el fichero igual. La trampa es la misma; la forma del comentario, un detalle.
      if (c === '/' && (d === '/' || d === '*') && /(^|\n)[ \t]*$/.test(s.slice(Math.max(0, i - 200), i))) {
        const cierre = d === '/' ? '\n' : '*/';
        const fin = s.indexOf(cierre, i + 2);
        const cuerpo = s.slice(i, fin === -1 ? s.length : fin + (d === '/' ? 0 : 2));
        if (backtickCrudo(cuerpo)) avisa(cuerpo.split('\n').find(l => backtickCrudo(l)) || cuerpo);
        // NO se salta el comentario: el backtick crudo cierra la plantilla de verdad, y el autómata
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
    // LOS REGEX SE SALTAN ENTEROS. Sin esto, un /^```json/ o un /^✓\s*/ metían backticks y barras en
    // el autómata, lo desincronizaban, y el lint acusaba de estar «dentro de una plantilla» a código
    // que no lo estaba. Un lint que grita en falso se acaba ignorando, y entonces no sirve de nada.
    // Solo se trata como regex si la barra está en POSICIÓN de regex (tras un operador o apertura):
    // si no, es una división o el principio de un comentario, que ya se miraron arriba.
    if (c === '/') {
      let k = i - 1;
      while (k >= 0 && ' \t\n\r'.includes(s[k])) k--;
      const ant = k >= 0 ? s[k] : '(';
      const palabra = /[A-Za-z0-9_$)\]]/.test(ant) ? s.slice(Math.max(0, k - 6), k + 1) : '';
      const esRegex = !/[A-Za-z0-9_$)\]]/.test(ant) || /\b(return|typeof|case|in|of)$/.test(palabra);
      if (esRegex) {
        let j = i + 1, clase = false, cerrado = false;
        while (j < s.length && s[j] !== '\n') {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '[') clase = true;
          else if (s[j] === ']') clase = false;
          else if (s[j] === '/' && !clase) { cerrado = true; j++; break; }
          j++;
        }
        if (cerrado) { i = j; continue; }
      }
    }
    if (c === '`') {
      // ¿PLANTILLA ETIQUETADA? `String.raw` (que es justo el remedio a la trampa de los escapes: con
      // él, \\s llega intacto) y cualquier otra etiqueta reciben el texto CRUDO, así que dentro de una
      // etiquetada el escape NO se come y no hay nada que marcar. El backtick suelto sí sigue
      // cerrándola, así que esa regla se mantiene igual.
      let k = i - 1;
      while (k >= 0 && ' \t\n\r'.includes(s[k])) k--;
      // Cuidado con las PALABRAS CLAVE: `return \`…\`` no es una plantilla etiquetada, y darla por
      // etiquetada dejaría sin vigilar justo los ficheros que devuelven JS de navegador — que son
      // todos los de este proyecto. (Me pasó: el lint se quedó mudo sobre mi propio fallo.)
      const CLAVES = /\b(return|typeof|case|in|of|do|else|yield|await|new|delete|void|instanceof)$/;
      const antes = s.slice(Math.max(0, k - 11), k + 1);
      const etiquetada = k >= 0 && /[A-Za-z0-9_$.\)\]]/.test(s[k]) && !CLAVES.test(antes);
      pila.push({ modo: 'tpl', raw: etiquetada });
      i++; continue;
    }
    if (c === '{') { marco().llaves++; i++; continue; }
    if (c === '}') {
      if (marco().llaves > 0) marco().llaves--;
      else if (pila.length > 1) pila.pop();
      i++; continue;
    }
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
  ? '\n✗ ' + malos + ' problema(s) en plantillas, en ' + mirados + ' ficheros. Arréglalos ANTES de reiniciar.\n'
    + '  · backtick: cierra la plantilla ahí mismo → escápalo (\\`) o quítalo.\n'
    + '  · escape comido: la plantilla tira la barra → dóblala (\\\\*) o quita el regex.'
  : '✓ ' + mirados + ' ficheros: plantillas limpias (ni backticks sueltos ni escapes comidos).');
// El pie que el barrido sabe leer (ver scripts/run-gates.mjs · RESUMEN). Sin él, esto entra al barrido
// y sale SOSPECHOSO: «salió 0 pero no imprimió resumen».
console.log('RESULTADO: ' + (mirados - malos) + ' ✓  ·  ' + malos + ' ✗');
process.exit(malos ? 1 : 0);
