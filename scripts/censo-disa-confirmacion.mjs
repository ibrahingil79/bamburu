#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DE LA CONFIRMACIÓN DE DISA — que decidirla no vuelva a depender de interpretar el texto.
//
// DE DÓNDE SALE (AUD-015, comprobado el 3 sep 2026). Codex apuntó que la confirmación previa a una
// acción «se da por buena con un texto demasiado permisivo», y la ficha decía que **NO se había
// comprobado**. Se comprobó: **NO estaba vivo**. La decisión ya es del servidor, con una expresión
// anclada contra una lista cerrada, y las once frases ambiguas de la prueba cancelan todas.
//
// ENTONCES, ¿PARA QUÉ ESTE CENSO? Para que no vuelva. Lo que hoy protege al dueño es un ancla `^…$`
// y una lista de diez palabras: **quitar el ancla, añadir «quizá», cambiar el `test` por un
// `includes` o dejar que el modelo juzgue son retoques de una línea**, y ninguno se ve raro al
// leerlo. Ejecutar de más es irreversible; por eso la cerradura se vigila aunque hoy esté echada.
//
// ⚠️ LO QUE HACE DISTINTO, Y ES EL PUNTO: **saca la expresión regular DEL FICHERO y la EJECUTA**
// contra la tabla de frases. No comprueba una copia suya — si alguien relaja la del producto, este
// censo prueba **la relajada** y se pone rojo. Un censo que valida su propia copia es exactamente el
// que dice CERO sin ser cierto, que es la lección que este repo tiene escrita con fecha.
//
//   node scripts/censo-disa-confirmacion.mjs
//   node scripts/censo-disa-confirmacion.mjs --detalle
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { soloCodigo, sinComentariosHtml, sinComentariosDeLinea } from './lib/solo-codigo.mjs';

const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const DETALLE = process.argv.includes('--detalle');
const FICHERO = 'modules/disa/index.js';

const limpiar = (src) =>
  sinComentariosHtml(soloCodigo(src)).split('\n').map(sinComentariosDeLinea).join('\n');

// ── LO QUE DEBE SEGUIR SIENDO CIERTO ─────────────────────────────────────────────────────────────
// La lista cerrada de HOY, palabra por palabra. Se compara EXACTA: una de más es una puerta nueva;
// una de menos es que alguien tocó esto y no actualizó el censo — y entonces no se sabe cuál falta.
const LISTA = ['sí', 'si', 'confirmo', 'adelante', 'ok', 'dale', 'hazlo', 'procede', 'yes', 'correcto', 'exacto'];

// Las frases que NUNCA pueden ejecutar. Salen del Paso 0 de la tarea, probadas el 3 sep 2026.
const AMBIGUAS = [
  'sí, pero espera', 'sí a lo de antes', 'vale, ¿y si mejor no?', 'sí, aunque mejor no lo hagas',
  'creo que sí', 'sí pero antes dime el precio', 'ok pero cambia la fecha', 'sí?',
  'si te parece bien hazlo tú', 'exactamente eso, pero con 20 unidades', 'no', 'no, déjalo',
];
// Y las que SÍ deben seguir ejecutando: una cerradura que no deja pasar a nadie tampoco vale.
const LIMPIAS = ['sí', 'si', 'Sí', 'SÍ', 'sí.', 'sí!', ' sí ', 'confirmo', 'adelante', 'ok', 'OK', 'dale', 'hazlo', 'procede', 'yes', 'correcto', 'exacto'];

/** Saca del código la expresión que decide la confirmación. Devuelve { re, fuente } o { error }. */
function extraerRegex(codigo) {
  const m = /isConfirming\s*=\s*\/([^\n]*?)\/([a-z]*)\s*\n?\s*\.test\(/.exec(codigo);
  if (!m) return { error: 'no encuentro la expresión que decide la confirmación (isConfirming = /…/.test(…))' };
  try { return { re: new RegExp(m[1], m[2]), fuente: '/' + m[1] + '/' + m[2] }; }
  catch (e) { return { error: 'la expresión no compila: ' + e.message }; }
}

function juzgar(codigo) {
  const fallos = [];
  const { re, fuente, error } = extraerRegex(codigo);
  if (error) return { fallos: [error], fuente: null };

  // 1 · Anclada por los dos lados. Sin esto, un «sí» DENTRO de una frase confirmaría.
  if (!/^\^/.test(fuente.slice(1)) || !/\$\/[a-z]*$/.test(fuente))
    fallos.push('la expresión ya no está anclada (^…$): un «sí» dentro de una frase confirmaría');

  // 2 · La lista, exacta.
  const grupo = /\(([^)]*)\)/.exec(fuente);
  const palabras = grupo ? grupo[1].split('|').map(s => s.trim()).filter(Boolean) : [];
  const sobran = palabras.filter(p => !LISTA.includes(p));
  const faltan = LISTA.filter(p => !palabras.includes(p));
  if (sobran.length) fallos.push('la lista se ha ABIERTO con: ' + sobran.join(', ') + ' — cada palabra nueva es una puerta');
  if (faltan.length) fallos.push('la lista ha perdido: ' + faltan.join(', ') + ' — actualiza el censo si el cambio es a propósito');

  // 3 · Lo que de verdad importa: SE EJECUTA la expresión del producto contra las frases.
  const ejecutan = AMBIGUAS.filter(f => re.test(f.trim()));
  if (ejecutan.length) fallos.push('AHORA EJECUTAN frases ambiguas: ' + ejecutan.map(f => JSON.stringify(f)).join(', '));
  const noEjecutan = LIMPIAS.filter(f => !re.test(f.trim()));
  if (noEjecutan.length) fallos.push('un «sí» limpio ya NO ejecuta: ' + noEjecutan.map(f => JSON.stringify(f)).join(', ')
    + ' — la cerradura no puede estorbar el uso normal');

  // 4 · La decisión no puede volver a depender del modelo.
  const bloque = /let isConfirming[\s\S]{0,700}?\n\s*}\s*\n/.exec(codigo);
  if (bloque && /\b(reply|data\.content|callClaude|textFromResponse)\b/.test(bloque[0]))
    fallos.push('la decisión de confirmar mira la respuesta del MODELO: eso es interpretación, no una cerradura');

  // 5 · Las acciones de seguridad, con igualdad estricta a su frase.
  if (!/_securityPhrase[\s\S]{0,200}?message\.trim\(\)\s*===\s*sec\w*/.test(codigo))
    fallos.push('las acciones de seguridad ya no comparan su frase con igualdad estricta (===)');

  // 6 · Una propuesta se confirma UNA vez, y solo por quien la recibió.
  if (!/status='confirmed'[\s\S]{0,240}?WHERE action_id=\?[\s\S]{0,120}?status='proposed'/.test(codigo))
    fallos.push('`claimConfirmation` ya no es de un solo uso: una propuesta podría confirmarse dos veces');
  if (!/pending_action[\s\S]{0,400}?role === 'assistant'|role === 'assistant'[\s\S]{0,200}?pending_action/.test(codigo))
    fallos.push('la propuesta ya no se lee del ÚLTIMO mensaje del asistente: podría no caducar al hablar de otra cosa');

  return { fallos, fuente, palabras };
}

// ── AUTOPRUEBA: se ejecuta SIEMPRE, antes de mirar el producto ────────────────────────────────────
const BASE = `
  let isConfirming = false;
  if (pendingAction) {
    if (SECURITY_ACTIONS.has(pendingAction.type)) {
      const secPhrase = pendingAction._securityPhrase || '';
      isConfirming = secPhrase.length > 0 && message.trim() === secPhrase;
    } else {
      isConfirming = /^(sí|si|confirmo|adelante|ok|dale|hazlo|procede|yes|correcto|exacto)[.!]?$/i
        .test(message.trim());
    }
  }
  const p = history.slice().reverse().find(m => m.role === 'assistant').pending_action;
  db.prepare("UPDATE x SET status='confirmed', confirmed_at=CURRENT_TIMESTAMP WHERE action_id=? AND action_type=? AND user_id=? AND status='proposed'");
`;
const MUESTRAS = [
  { ok: true,  nombre: 'la cerradura tal y como está hoy', src: BASE },
  { ok: false, nombre: 'sin el ancla (un «sí» dentro de una frase valdría)',
    src: BASE.replace('/^(sí|si', '/(sí|si').replace(')[.!]?$/i', ')[.!]?/i') },
  { ok: false, nombre: 'la lista abierta con «quizá»',
    src: BASE.replace('|exacto)', '|exacto|quizá)') },
  { ok: false, nombre: 'la lista recortada (falta «confirmo»)',
    src: BASE.replace('|confirmo', '') },
  { ok: false, nombre: 'las acciones de seguridad ya no comparan con ===',
    src: BASE.replace('message.trim() === secPhrase', 'message.trim().includes(secPhrase)') },
  { ok: false, nombre: '`claimConfirmation` deja de ser de un solo uso',
    src: BASE.replace("AND status='proposed'", '') },
];
let autofallos = 0;
for (const m of MUESTRAS) {
  const r = juzgar(limpiar(m.src));
  const verde = r.fallos.length === 0;
  if (verde !== m.ok) {
    autofallos++;
    say('  ✗ AUTOPRUEBA «' + m.nombre + '»: se esperaba ' + (m.ok ? 'VERDE' : 'ROJO')
        + ' y salió ' + (verde ? 'verde' : 'rojo · ' + r.fallos[0]));
  }
}
if (autofallos) {
  say('\n✗ EL CENSO NO SE FÍA DE SÍ MISMO: ' + autofallos + ' de ' + MUESTRAS.length + ' muestras mal juzgadas.');
  say('  No ha mirado el producto. Un censo ciego que dice CERO es peor que no tenerlo.');
  say('RESULTADO: 0 ✓  ·  1 ✗');
  process.exit(1);
}

// ── EL PRODUCTO ──────────────────────────────────────────────────────────────────────────────────
const ruta = path.join(RAIZ, FICHERO);
if (!fs.existsSync(ruta)) {
  say('\n✗ NO EXISTE ' + FICHERO + ': el censo no ha comprobado NADA. Esto NO es un aprobado.');
  say('RESULTADO: 0 ✓  ·  1 ✗');
  process.exit(1);
}
const r = juzgar(limpiar(fs.readFileSync(ruta, 'utf8')));

say('\nAUTOPRUEBA: ' + MUESTRAS.length + '/' + MUESTRAS.length + ' muestras bien juzgadas (1 buena respetada, 5 relajaciones cazadas)');
say('LA EXPRESIÓN QUE DECIDE, sacada del fichero: ' + (r.fuente || '(no encontrada)'));
if (r.palabras) say('LISTA CERRADA: ' + r.palabras.length + ' respuestas — ' + r.palabras.join(', '));
say('PROBADA CONTRA: ' + AMBIGUAS.length + ' frases ambiguas (deben cancelar) y ' + LIMPIAS.length + ' sí limpios (deben ejecutar)');
if (DETALLE && r.fuente) {
  const { re } = extraerRegex(limpiar(fs.readFileSync(ruta, 'utf8')));
  for (const f of AMBIGUAS) say('   ' + (re.test(f.trim()) ? 'EJECUTA ✗' : 'cancela  ·') + '  ' + JSON.stringify(f));
}

if (r.fallos.length) {
  say('\n✗ LA CONFIRMACIÓN SE HA RELAJADO: ' + r.fallos.length);
  for (const f of r.fallos) say('  · ' + f);
  say('\n  En la duda NUNCA se ejecuta: cancelar de más es molesto, ejecutar de más es irreversible.');
  say('  El porqué de cada regla, en docs/seguridad/disa-confirmacion-diagnostico.md');
} else {
  say('\n✓ La cerradura sigue echada: decide el servidor, con lista cerrada y anclada; la propuesta');
  say('  caduca al hablar de otra cosa y solo se confirma una vez.');
}
say('\nRESULTADO: ' + (r.fallos.length ? 0 : 1) + ' ✓  ·  ' + r.fallos.length + ' ✗');
process.exit(r.fallos.length ? 1 : 0);
