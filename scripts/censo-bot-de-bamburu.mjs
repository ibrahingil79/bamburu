#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DEL BOT DE TELEGRAM — que la fábrica no tenga NADA con qué hablar, y que la tubería de
// Bamburu no sepa escuchar.
//
// LA DECISIÓN QUE VIGILA. Ibrahin, 3 sep 2026: el bot queda dedicado en exclusiva a los avisos de
// Bamburu. Ibrahin, 4 sep 2026: «quita todo lo que tenía que ver con el antiguo bot».
//
// ⚙️ QUÉ CAMBIÓ EL 4 SEP 2026, Y POR QUÉ ESTE CENSO MIDE OTRA COSA. Hasta hoy la fábrica CONSERVABA
// todo su código de Telegram —escuchar, contestar, botones— y lo que impedía que hablara era un
// CERROJO (`vigia/bot-retirado.js`) al principio de cada camino. Este censo vigilaba que ese cerrojo
// siguiera puesto. Hoy el código se ha BORRADO: se fueron `vigia/escucha.js` entero, `interpretar`,
// el teclado, `recibir`, `responderA`, el servicio del vigía y los tres comandos de Telegram de la
// línea de órdenes. Con las manos cortadas de raíz, el cerrojo sobraba y también se fue.
//
// La propiedad que se vigila ahora es MÁS FUERTE y más fácil de comprobar: **en la fábrica no queda
// ni una línea que sepa hablar con Telegram**, y **la tubería de Bamburu solo sabe enviar**. Un
// cerrojo se quita con dos teclas; devolverle la voz a la fábrica exige escribir otra vez todo lo
// que se ha borrado, y eso ya no es un descuido: es una decisión.
//
//   node scripts/censo-bot-de-bamburu.mjs
//   node scripts/censo-bot-de-bamburu.mjs --autoprueba   (se rompe a sí mismo y exige ponerse rojo)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

// Lo que NINGÚN fichero de la fábrica puede volver a nombrar. Es la lista corta a propósito: cada
// entrada es algo que, por sí solo, basta para hablar o escuchar por un bot.
const PROHIBIDO_EN_LA_FABRICA = [
  { re: /api\.telegram\.org/i,                    que: 'la dirección de la API de Telegram' },
  { re: /\bsendMessage\b|\bgetUpdates\b/,          que: 'una llamada de la API de Telegram' },
  { re: /TELEGRAM_(TOKEN|CHAT_ID)/,                que: 'el nombre de una credencial del bot' },
  { re: /telegram-transporte|telegram-servidor/,   que: 'la tubería de avisos de Bamburu' },
  { re: /reply_markup|is_persistent/,              que: 'los botones del mando antiguo' },
];

// Lo que la tubería de Bamburu NO puede volver a saber hacer. Enviar sí; oír, no.
const PROHIBIDO_EN_LA_TUBERIA = [
  { re: /\bgetUpdates\b/,           que: 'sondear mensajes (era `recibir`)' },
  { re: /export function recibir/,  que: 'la función que escuchaba' },
  { re: /export function responderA/, que: 'contestar a un chat cualquiera' },
  { re: /marcaTeclado|reply_markup/, que: 'los botones fijos' },
];

function ficherosDe(dir) {
  const out = [];
  const anda = (d) => {
    for (const e of fs.readdirSync(path.join(RAIZ, d), { withFileTypes: true })) {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules') anda(rel); continue; }
      if (/\.(js|mjs|json|sh)$/.test(e.name)) out.push(rel);
    }
  };
  anda(dir);
  return out;
}

// Los comentarios se quitan ANTES de buscar: este mismo repo aprendió el 24 ago 2026 que un censo
// que confunde una explicación con código «dice CERO y no es cierto, que es peor que no tenerlo».
// Aquí importa lo que el programa PUEDE HACER, no lo que un comentario cuenta que se hizo.
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function censar() {
  const fallos = [];
  const nota = (m, d) => fallos.push({ m, d });

  // ── 1 · La fábrica no tiene con qué hablar ─────────────────────────────────────────────────────
  let mirados = 0;
  for (const f of ficherosDe('orchestrator')) {
    if (f.includes('/pruebas/')) continue;        // las pruebas nombran lo que prueban
    let s;
    try { s = sinComentarios(leer(f)); } catch { continue; }
    mirados++;
    for (const { re, que } of PROHIBIDO_EN_LA_FABRICA) {
      if (re.test(s)) nota(`${f} vuelve a tener ${que}`, 'la fábrica no puede hablar por el bot de Bamburu');
    }
  }
  if (!mirados) nota('no he podido leer ni un fichero de orchestrator/', 'un censo que no lee nada no afirma nada');

  // ── 2 · Las piezas del bot antiguo siguen sin existir ──────────────────────────────────────────
  for (const f of ['orchestrator/vigia/escucha.js', 'deploy/systemd/orquestador-vigia.service']) {
    if (fs.existsSync(path.join(RAIZ, f))) nota(`ha vuelto ${f}`, 'era el que escuchaba órdenes por el bot');
  }

  // ── 3 · La tubería de Bamburu solo sabe enviar ─────────────────────────────────────────────────
  let tuberia = '';
  try { tuberia = sinComentarios(leer('core/telegram-transporte.js')); }
  catch { nota('no existe core/telegram-transporte.js', 'sin tubería no hay avisos de Bamburu'); }
  if (tuberia) {
    for (const { re, que } of PROHIBIDO_EN_LA_TUBERIA) {
      if (re.test(tuberia)) nota(`la tubería vuelve a saber ${que}`, 'debe poder hablar y NO poder oír');
    }
    if (!/export function enviar/.test(tuberia)) {
      nota('la tubería ya no exporta `enviar`', 'sin ella Bamburu se queda sin avisos');
    }
  }

  // ── 4 · La configuración de la fábrica no nombra el bot ────────────────────────────────────────
  try {
    const c = JSON.parse(leer('orchestrator/orquestador.config.json'));
    const v = c?.vigia || {};
    for (const k of ['telegram', 'escucha', 'teclado']) {
      if (v[k]) nota(`la configuración de la fábrica vuelve a tener «vigia.${k}»`, 'ahí vivía el bot');
    }
  } catch (e) { nota('no se puede leer la configuración de la fábrica', String(e.message).slice(0, 80)); }

  // ── 5 · Las credenciales, solo en casa de Bamburu ──────────────────────────────────────────────
  try {
    const s = leer('core/telegram-servidor.js');
    if (!/BAMBURU_TELEGRAM_TOKEN/.test(s) || !/\/etc\/bamburu\.env/.test(s)) {
      nota('la puerta común ya no lee las credenciales de /etc/bamburu.env', 'el bot es de Bamburu y vive en su casa');
    }
  } catch { nota('no existe core/telegram-servidor.js', 'es la única puerta de los avisos'); }

  return fallos;
}

// ── AUTOPRUEBA ───────────────────────────────────────────────────────────────────────────────────
// Un censo que da verde sin poder ponerse rojo no vale nada. Se le siembra cada avería, una a una,
// sobre una COPIA del fichero, y se exige que la cace. Lo que siembra se deshace siempre.
if (process.argv.includes('--autoprueba')) {
  const CASOS = [
    ['la fábrica recupera la dirección de Telegram', 'orchestrator/bucle.js',
      (s) => s + '\nconst zz = "https://api.telegram.org/bot";\n'],
    ['la fábrica recupera el nombre de una credencial', 'orchestrator/ciclo.js',
      (s) => s + '\nconst zz = process.env.ORQUESTADOR_TELEGRAM_TOKEN;\n'],
    ['la fábrica vuelve a importar la tubería de Bamburu', 'orchestrator/orq.js',
      (s) => s + "\nimport { enviar } from '../core/telegram-transporte.js';\n"],
    ['la tubería vuelve a saber escuchar', 'core/telegram-transporte.js',
      (s) => s + '\nexport function recibir() { return fetch("/getUpdates"); }\n'],
    ['la tubería vuelve a montar botones', 'core/telegram-transporte.js',
      (s) => s + '\nconst zz = { reply_markup: 1 };\n'],
  ];
  let bien = 0;
  say('\nAUTOPRUEBA — se siembra cada avería y se exige que el censo la cace:\n');
  for (const [nombre, fichero, romper] of CASOS) {
    const abs = path.join(RAIZ, fichero);
    const original = fs.readFileSync(abs, 'utf8');
    let caza = false;
    try {
      fs.writeFileSync(abs, romper(original));
      caza = censar().length > 0;
    } finally { fs.writeFileSync(abs, original); }
    say(`  ${caza ? '✓' : '✗ NO LA CAZA —'} ${nombre}`);
    if (caza) bien++;
  }
  say(`\nAUTOPRUEBA: ${bien}/${CASOS.length} averías cazadas`);
  process.exit(bien === CASOS.length ? 0 : 1);
}

const fallos = censar();

// ── 6 · LA TUBERÍA CARGA DE VERDAD, no solo «parece bien escrita» ────────────────────────────────
// DE DÓNDE SALE, y es del mismo día: al quitar una función de este fichero quedó una `e` suelta en
// medio. `node --check` la dio por BUENA —una `e` sola es una expresión válida— y la tubería
// reventaba al importarla. Bamburu estuvo sin poder avisar y ningún verde lo dijo: el gate de las
// copias corre en seco y no la importa. Leer el texto de un fichero no es lo mismo que ejecutarlo.
try {
  const m = await import('../core/telegram-transporte.js');
  if (typeof m.enviar !== 'function') {
    fallos.push({ m: 'la tubería carga pero no trae `enviar`', d: 'sin ella no sale ningún aviso' });
  }
  const sobran = Object.keys(m).filter((k) => k !== 'enviar');
  if (sobran.length) {
    fallos.push({ m: 'la tubería exporta de más: ' + sobran.join(', '), d: 'solo debe saber enviar' });
  }
} catch (e) {
  fallos.push({ m: 'la tubería NO SE PUEDE IMPORTAR', d: String(e?.message || e).slice(0, 120) });
}

say('');
if (fallos.length) {
  say('✗ EL BOT ANTIGUO ESTÁ VOLVIENDO:');
  for (const { m, d } of fallos) say(`  · ${m}\n    ${d}`);
  say('');
  say('La decisión de Ibrahin: el bot es SOLO de los avisos de Bamburu, y la fábrica no tiene');
  say('código para hablar con él. Lo que se borró el 4 sep 2026 no debe volver.');
  say(`RESULTADO: 0 ✓  ·  ${fallos.length} ✗`);
  process.exit(1);
}
say('✓ LA FÁBRICA NO TIENE CON QUÉ HABLAR: ni dirección, ni credenciales, ni tubería, ni botones.');
say('✓ LA TUBERÍA DE BAMBURU SOLO SABE ENVIAR: no puede oír aunque alguien quisiera.');
say('  (Ibrahin, 3 y 4 sep 2026 · el código del bot antiguo se BORRÓ, no se desactivó)');
say('✓ Y LA TUBERÍA CARGA: comprobado importándola, no leyéndola.');
say('RESULTADO: 3 ✓  ·  0 ✗');
