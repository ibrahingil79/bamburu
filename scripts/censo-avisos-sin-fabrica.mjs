#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CENSO — que Bamburu no vuelva a importar nada de la carpeta de la fábrica.
//
// LA DECISIÓN QUE VIGILA (Ibrahin, 3 sep 2026, remate del bot exclusivo): el bot de Telegram es de
// Bamburu, así que TODO el código que Bamburu usa para avisar tiene que vivir en territorio de
// Bamburu. La tubería (`core/telegram-transporte.js`) se movió aquí desde
// `orchestrator/vigia/telegram.js` el mismo día — este censo es lo que impide que un `import`
// nuevo, escrito sin pensarlo, la vuelva a atar a `orchestrator/`.
//
// EL CRITERIO DE CIERRE DE LA TAREA, y es lo que este censo defiende para siempre: **se puede
// borrar o mover la carpeta `orchestrator/` entera y los avisos de Bamburu siguen saliendo.**
// Probado de verdad el 3 sep 2026 apartando la carpeta y lanzando un aviso.
//
// QUÉ MIRA: cada fichero bajo `core/` y `scripts/` (el territorio de Bamburu que puede avisar) en
// busca de un `import`/`require`/`import()` cuya ruta apunte a `orchestrator/`. NO mira dentro de
// `orchestrator/` — ahí SÍ puede haber, y hay, imports hacia `core/` (es la dirección correcta:
// la fábrica pide prestado de Bamburu, no al revés).
//
//   node scripts/censo-avisos-sin-fabrica.mjs
//   node scripts/censo-avisos-sin-fabrica.mjs --autoprueba   (se rompe a sí mismo y exige el rojo)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

const say = (s) => process.stdout.write(s + '\n');
const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);

// El patrón: cualquier especificador de import/require que contenga 'orchestrator' en su ruta.
// Se busca por RUTA, no por la palabra suelta: así un comentario que solo NOMBRE la carpeta
// («ver orchestrator/…») no cuenta como import, y sí cuenta un `import(...)` dinámico.
const RE_IMPORT = /\b(?:from\s+['"]|import\(\s*['"]|require\(\s*['"])((?:\.\.?\/)+orchestrator\/[^'"]*)['"]/g;

function andar(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) andar(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function censar() {
  const hallazgos = [];
  for (const raizVigilada of ['core', 'scripts']) {
    for (const f of andar(path.join(RAIZ, raizVigilada))) {
      const rel = path.relative(RAIZ, f);
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(RE_IMPORT)) {
        hallazgos.push({ f: rel, ruta: m[1] });
      }
    }
  }
  return hallazgos;
}

if (process.argv.includes('--autoprueba')) {
  // Se siembra, en un fichero temporal de mentira dentro de core/, un import hacia orchestrator/,
  // y se exige que el censo —ejecutado como proceso aparte, para medir su código de salida real—
  // lo cace. Si no lo caza, el censo dice CERO sin ser cierto, que es peor que no tenerlo.
  // Construido por partes A PROPÓSITO: si el import señuelo se escribiera aquí como texto
  // literal contiguo, ESTE MISMO fichero —que vive en scripts/, territorio vigilado— haría que
  // el censo se cazara a sí mismo (su propio código fuente contendría el patrón). Concatenando,
  // el patrón solo existe en el fichero de mentira que se escribe, no en el censo.
  const señuelo = path.join(RAIZ, 'core', '__zz_señuelo_avisos_sin_fabrica.mjs');
  const rutaSeñuelo = '..' + '/orchestrator/vigia/telegram.js';
  fs.writeFileSync(señuelo, "import { enviar } from '" + rutaSeñuelo + "';\nexport const x = enviar;\n");
  let mal = 0;
  try {
    const { spawnSync } = await import('node:child_process');
    const p = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/censo-avisos-sin-fabrica.mjs')], { encoding: 'utf8' });
    if (p.status === 0) { mal = 1; say('✗ NO caza un import de core/ hacia orchestrator/'); }
    else say('✓ caza un import de core/ hacia orchestrator/');
  } finally {
    fs.unlinkSync(señuelo);
  }
  say(mal ? '\n✗ LA AUTOPRUEBA FALLA: el censo no ve lo que dice ver.' : '\n✓ autoprueba: el censo se pone rojo con el import señuelo.');
  process.exit(mal ? 1 : 0);
}

const hallazgos = censar();
if (!hallazgos.length) {
  say('✓ NINGÚN fichero de Bamburu (core/, scripts/) importa nada de orchestrator/.');
  say('  (se puede borrar orchestrator/ entero y los avisos de Bamburu siguen saliendo — probado el 3 sep 2026)');
  say('RESULTADO: 1 ✓  ·  0 ✗');
  process.exit(0);
}
say('✗ BAMBURU VUELVE A DEPENDER DE LA CARPETA DE LA FÁBRICA — ' + hallazgos.length + ' import(s):\n');
for (const h of hallazgos) { say('  · ' + h.f + '  →  ' + h.ruta); }
say('\nLa decisión de Ibrahin (3 sep 2026) es que Bamburu no importa nada de orchestrator/.');
say('RESULTADO: 0 ✓  ·  1 ✗');
process.exit(1);
