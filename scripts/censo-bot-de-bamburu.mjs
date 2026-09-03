#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO DEL BOT DE TELEGRAM — que siga siendo EXCLUSIVO de Bamburu.
//
// LA DECISIÓN QUE VIGILA (Ibrahin, 3 sep 2026): el bot de Telegram queda dedicado en exclusiva a
// los avisos de Bamburu —arranque, copias y lo que se sume—. **La fábrica/orquestador no puede
// usarlo.** No se crea uno nuevo para la fábrica: está parada, y se creará el día que se encienda.
//
// POR QUÉ HACE FALTA VIGILARLO. Porque lo que se desengancha se vuelve a enganchar sin querer: dos
// líneas en un fichero de entorno «para probar», o un `enviar(...)` nuevo en un fichero de la
// fábrica, y el bot de Ibrahin vuelve a tener dos dueños. Y ya pasó algo peor: el 3 sep 2026, con
// la fábrica PARADA desde el día anterior, **su vigía llevaba 30 horas escuchando órdenes por este
// bot** con `Restart=always` — y ejecutándolas en el servidor.
//
//   node scripts/censo-bot-de-bamburu.mjs
//   node scripts/censo-bot-de-bamburu.mjs --autoprueba   (se rompe a sí mismo y exige ponerse rojo)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

// Los ficheros de la fábrica que hablaban o escuchaban por el bot. Cada uno tiene que llamar al
// cerrojo; si alguno deja de hacerlo, es que alguien le devolvió la voz.
const LLAMANTES = [
  { f: 'orchestrator/vigia/parte.js',   que: 'el parte de cada tres horas' },
  { f: 'orchestrator/vigia/escucha.js', que: 'la escucha de órdenes por Telegram' },
  { f: 'orchestrator/orq.js',           que: 'la prueba de aviso de la línea de órdenes' },
];

// Lo que NO puede volver a aparecer en ninguna pieza de la fábrica.
const PROHIBIDO = [
  { re: /ORQUESTADOR_TELEGRAM_(TOKEN|CHAT_ID)\s*=/, que: 'una credencial del bot escrita en un fichero' },
];

const fallos = [];
const nota = (m, d) => fallos.push({ m, d });

// ── 1 · El cerrojo existe y dice de qué va ───────────────────────────────────────────────────────
let cerrojo = '';
try { cerrojo = leer('orchestrator/vigia/bot-retirado.js'); }
catch { nota('no existe orchestrator/vigia/bot-retirado.js', 'sin cerrojo no hay nada que vigilar'); }
if (cerrojo && !/EXCLUSIVO de los avisos de Bamburu/i.test(cerrojo)) {
  nota('el cerrojo ya no dice cuál es la decisión', 'un cerrojo sin motivo escrito se quita sin pensar');
}

// ── 2 · Cada llamante de la fábrica pasa por el cerrojo ──────────────────────────────────────────
for (const { f, que } of LLAMANTES) {
  let s = '';
  try { s = leer(f); } catch { nota(f + ' no existe', 'el censo no puede afirmar sobre lo que no lee'); continue; }
  if (!/bot-retirado\.js/.test(s)) nota(f + ' ya no importa el cerrojo', que + ' podría volver a hablar por el bot');
  else if (!/botRetirado\(|escuchaRetirada\(/.test(s)) nota(f + ' importa el cerrojo pero no lo llama', que);
}

// ── 3 · La configuración de la fábrica no nombra el bot ──────────────────────────────────────────
try {
  const c = JSON.parse(leer('orchestrator/orquestador.config.json'));
  const t = c?.vigia?.telegram || {};
  if (t.tokenEnv || t.chatIdEnv) {
    nota('la configuración de la fábrica vuelve a nombrar variables del bot',
         'tokenEnv=' + JSON.stringify(t.tokenEnv) + ' chatIdEnv=' + JSON.stringify(t.chatIdEnv));
  }
  if (c?.vigia?.activo === true) nota('el vigía de la fábrica figura como ACTIVO en su configuración', 'debe quedar apagado');
} catch (e) { nota('no se puede leer la configuración del orquestador', String(e.message).slice(0, 60)); }

// ── 4 · Ninguna pieza de la fábrica escribe una credencial del bot ───────────────────────────────
const andar = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) andar(p, out);
    else if (/\.(js|mjs|json|sh|service|env)$/.test(e.name)) out.push(p);
  }
  return out;
};
for (const p of andar(path.join(RAIZ, 'orchestrator'))) {
  if (/\/pruebas\//.test(p)) continue;   // las pruebas del tapado de secretos usan el nombre a propósito
  const s = fs.readFileSync(p, 'utf8');
  for (const { re, que } of PROHIBIDO) {
    if (re.test(s)) nota(path.relative(RAIZ, p) + ': ' + que, 'la fábrica no puede tener credenciales de este bot');
  }
}

// ── 5 · La puerta de Bamburu sigue siendo una, y estampa quién habla ─────────────────────────────
try {
  const puerta = leer('core/telegram-servidor.js');
  if (!/BAMBURU_TELEGRAM_TOKEN/.test(puerta)) nota('la puerta de Bamburu ya no usa sus propias credenciales', 'volvería a depender de la fábrica');
  if (!/BAMBURU — /.test(puerta)) nota('la puerta ya no estampa «BAMBURU — <tema>»', 'un aviso anónimo no dice quién habla');
  if (!/aviso sin tema/.test(puerta)) nota('la puerta ya no exige tema', 'lo que depende de acordarse, un día se olvida');
} catch { nota('no existe core/telegram-servidor.js', 'es la única puerta de avisos de Bamburu'); }

// ── AUTOPRUEBA ───────────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--autoprueba')) {
  const casos = [
    ['la configuración vuelve a nombrar el bot', 'orchestrator/orquestador.config.json', (s) => s.replace('"tokenEnv": ""', '"tokenEnv": "ORQUESTADOR_TELEGRAM_TOKEN"')],
    ['un llamante deja de usar el cerrojo', 'orchestrator/vigia/parte.js', (s) => s.replace(/bot-retirado\.js/g, 'zzz.js').replace(/botRetirado\(/g, 'zzz(')],
    ['la puerta deja de exigir tema', 'core/telegram-servidor.js', (s) => s.replace('aviso sin tema', 'zzz')],
  ];
  let mal = 0;
  for (const [nombre, fichero, romper] of casos) {
    const orig = leer(fichero);
    fs.writeFileSync(path.join(RAIZ, fichero), romper(orig));
    // Se ejecuta el censo como PROCESO APARTE: es la única forma honesta de medir su código de
    // salida, que es lo que mira el barrido. Comprobarlo por dentro sería medir otra cosa.
    const { spawnSync } = await import('node:child_process');
    const p = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/censo-bot-de-bamburu.mjs')], { encoding: 'utf8' });
    fs.writeFileSync(path.join(RAIZ, fichero), orig);
    if (p.status === 0) { mal++; say('✗ NO caza: ' + nombre); }
    else say('✓ caza: ' + nombre);
  }
  say(mal ? '\n✗ LA AUTOPRUEBA FALLA: el censo no ve lo que dice ver.' : '\n✓ autoprueba: el censo se pone rojo con cada defensa quitada.');
  process.exit(mal ? 1 : 0);
}

if (!fallos.length) {
  say('✓ EL BOT SIGUE SIENDO EXCLUSIVO DE BAMBURU: la fábrica no lo nombra, no lo llama y no tiene sus llaves.');
  say('  (decisión de Ibrahin, 3 sep 2026 · cerrojo en orchestrator/vigia/bot-retirado.js)');
  say('RESULTADO: 5 ✓  ·  0 ✗');
  process.exit(0);
}
say('✗ LA FÁBRICA VUELVE A TENER MANO EN EL BOT DE BAMBURU — ' + fallos.length + ' hallazgo(s):\n');
for (const f of fallos) { say('  · ' + f.m); say('    ' + f.d + '\n'); }
say('La decisión de Ibrahin (3 sep 2026) es que este bot es SOLO de los avisos de Bamburu.');
say('RESULTADO: ' + (5 - fallos.length) + ' ✓  ·  ' + fallos.length + ' ✗');
process.exit(1);
