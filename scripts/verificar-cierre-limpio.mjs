#!/usr/bin/env node
// verificar-cierre-limpio.mjs — la REGLA DE CIERRE, hecha comprobación.
//
// DE DÓNDE SALE. RITUAL.md dice desde hace tiempo «al terminar: commit + push» y TABLERO.md se
// marca `✅ HECHA` al cerrar una ficha — pero las dos son PALABRAS: nada impedía que una ficha
// quedara escrita como hecha con el árbol de trabajo sucio o con commits sin pushear. Pasó de
// verdad el 9 sep 2026 (ficha `barrera-permisos-contamina-el-barrido`): el arreglo se escribió,
// se probó y se documentó como HECHO en una sesión — y se quedó vivo SOLO en el árbol de trabajo,
// invisible para `git log`, para el remoto y para la siguiente sesión, que leyó "hecha" sobre un
// código que no existía en ningún sitio más que ese directorio. Esta comprobación existe para que
// eso no pueda volver a pasar sin que algo lo grite.
//
// QUÉ COMPRUEBA, y nada más que eso:
//   1. El árbol de trabajo está LIMPIO — `git status --porcelain` no dice nada.
//   2. `HEAD` no va POR DELANTE de `origin/<rama>` — no hay ni un commit local sin pushear.
// Ninguna otra cosa es asunto suyo: no juzga si el trabajo está bien hecho, ni si los gates pasan
// (eso ya lo hacen `run-gates.mjs` y `verify-residuo-de-pruebas.mjs`) — solo si lo que se escribió
// existe también fuera de esta máquina, que es lo mínimo para que "hecha" signifique algo.
//
// DOS MODOS:
//   node scripts/verificar-cierre-limpio.mjs                    → INCONDICIONAL: falla si hay algo
//     sucio o sin pushear, sin mirar de qué se trata. Es el que corre dentro del barrido
//     (`--all`, grupo `infra`) y el que se propone a mano al cerrar una sesión.
//   node scripts/verificar-cierre-limpio.mjs --si-toca-tablero  → SOLO SI TABLERO.md tiene una
//     línea "✅ … HECHA" que NO existe en la versión de `origin/<rama>` — o sea, solo si HAY una
//     ficha marcada como hecha que el remoto todavía no conoce. Si no hay ninguna, sale 0 aunque el
//     árbol esté sucio (puede ser trabajo a medias, legítimo). Es el modo que usa el hook de cierre
//     de sesión (`.claude/settings.json`, evento Stop): no interrumpe cada parada del asistente,
//     solo la que de verdad pretende cerrar algo.
//
// Ninguno de los dos escribe nada: `git fetch` (para conocer el `origin` de verdad, no el que la
// máquina recordaba de la última vez) es lectura sobre el remoto, no toca el árbol local.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// maxBuffer generoso a propósito: TABLERO.md solo ya pesa 1,18 MB — más que el 1 MB por defecto de
// `execSync` — y un `git show origin/<rama>:TABLERO.md` que se corta con ENOBUFS fallaba en
// SILENCIO (el catch de `hayFichaSinPublicar` lo trataba como "nada que comparar" y dejaba pasar
// justo la ficha que debía cazar). Medido al escribir esto: casi se cuela la propia prueba en rojo
// de esta comprobación por este motivo.
const sh = (cmd) => execSync(cmd, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

function ramaActual() {
  return sh('git rev-parse --abbrev-ref HEAD').trim();
}

function estadoGit(rama) {
  const sucio = sh('git status --porcelain').split('\n').filter(Boolean);
  let adelante = [], errorRemoto = null;
  try {
    sh('git fetch origin ' + rama + ' --quiet');
    adelante = sh(`git log origin/${rama}..HEAD --oneline`).split('\n').filter(Boolean);
  } catch (e) {
    errorRemoto = (e.stderr || e.message || '').toString().trim().split('\n').pop();
  }
  return { sucio, adelante, errorRemoto };
}

// ¿Hay en TABLERO.md una marca "✅ … HECHA" que `origin/<rama>` todavía no tiene? Compara LÍNEAS,
// no el fichero entero: mover o reformatear texto de fichas ya cerradas no cuenta como "nueva".
function hayFichaSinPublicar(rama) {
  const RUTA = path.join(RAIZ, 'TABLERO.md');
  if (!existsSync(RUTA)) return { hay: false, nuevas: [] };
  const marca = (l) => /✅/.test(l) && /HECHA/i.test(l);
  let origen = '';
  // FALLA CERRADO, no abierto: para cuando llegamos aquí `git fetch` ya funcionó (si no, el propio
  // script ya salió por el error de arriba), así que `origin/<rama>` existe de verdad — un fallo
  // AQUÍ leyendo TABLERO.md de ahí es un problema de la comprobación (p. ej. un buffer que se queda
  // corto: TABLERO.md ya pesa más de 1 MB y `execSync` corta ahí por defecto — medido de verdad al
  // escribir esto), no una señal de que "no hay nada que comparar". Tratarlo como "no hay ficha
  // nueva" sería exactamente el falso verde que esta comprobación existe para no dar.
  try { origen = sh(`git show origin/${rama}:TABLERO.md`).toString(); }
  catch (e) {
    console.error('✗ CIERRE NO COMPROBADO — no se pudo leer TABLERO.md de origin/' + rama + ': ' + (e.message || e));
    process.exit(2);
  }
  // EL FICHERO EN DISCO, no una versión de git — cubre a la vez lo commiteado (HEAD) y lo que
  // todavía ni se ha añadido al índice. Si hay algo sucio, el paso 1 (árbol sucio) ya lo caza; a
  // este paso solo le importa "¿existe HOY, en lo que sea, una marca que origin no tiene?".
  const disco = readFileSync(RUTA, 'utf8');
  const enOrigen = new Set(origen.split('\n').filter(marca));
  const nuevas = disco.split('\n').filter(l => marca(l) && !enOrigen.has(l));
  return { hay: nuevas.length > 0, nuevas };
}

const modoSuave = process.argv.includes('--si-toca-tablero');
let rama;
try { rama = ramaActual(); }
catch (e) { console.error('✗ No se ha podido leer la rama actual: ' + e.message); process.exit(2); }

const { sucio, adelante, errorRemoto } = estadoGit(rama);

if (errorRemoto) {
  console.error('✗ CIERRE NO COMPROBADO — no se ha podido consultar origin: ' + errorRemoto);
  console.error('  Sin red no se puede afirmar "todo pusheado". No es un cierre limpio confirmado.');
  process.exit(2);
}

if (modoSuave) {
  const { hay, nuevas } = hayFichaSinPublicar(rama);
  if (!hay) { process.exit(0); }   // nada que cerrar hoy: el árbol sucio, si lo está, no es asunto de este modo
  console.error('🛑 Hay una ficha marcada "✅ … HECHA" en TABLERO.md que origin/' + rama + ' todavía no tiene:');
  for (const l of nuevas.slice(0, 5)) console.error('    ' + l.trim());
}

const sucioReal = sucio.length > 0;
const sinPushear = adelante.length > 0;

if (!sucioReal && !sinPushear) {
  if (modoSuave) console.error('  … pero el árbol está limpio y todo pusheado: no es esto lo que falta. Revisa qué otra cosa dejó esa marca a medias.');
  else console.log('✓ Árbol limpio y todo pusheado a origin/' + rama + '. Cierre confirmado.');
  process.exit(modoSuave ? 1 : 0);   // en modo suave, si hay marca pero NO es por esto, igual se para: algo no cuadra
}

console.error('✗ REGLA DE CIERRE — el árbol de trabajo NO está pusheado del todo. No se puede dar por hecha ninguna ficha así.');
if (sucioReal) {
  console.error('  Sin commitear (' + sucio.length + '):');
  for (const l of sucio.slice(0, 30)) console.error('    ' + l);
  if (sucio.length > 30) console.error('    … y ' + (sucio.length - 30) + ' más');
}
if (sinPushear) {
  console.error('  Commiteado pero sin pushear a origin/' + rama + ' (' + adelante.length + '):');
  for (const l of adelante) console.error('    ' + l);
  console.error('  → git push origin ' + rama);
}
process.exit(1);
