#!/usr/bin/env node
// verify-sin-proveedor-ia.mjs — que la dirección del proveedor de IA no vuelva a aparecer.
//
// Sustituye a `censo-ia-apagada.mjs` (retirado el 7 sep 2026, `sacar-disa-paso-2-borrado`). Aquel
// censo tenía que EJECUTAR código y poner un centinela en las cinco puertas de red, porque
// `core/llm.js` EXISTÍA, apagado por una constante, y una constante se puede volver a encender con
// una línea. **Ahora ese fichero no existe.** No hay código que reencender, así que el criterio se
// simplifica al que dio Ibrahin el 7 sep 2026 al corregir el encargo: **cero apariciones de la
// dirección del proveedor en todo el árbol**, código y comprobaciones — ni un paquete del proveedor
// (`package.json`/`package-lock.json` no tienen ninguna dependencia con "anthropic" u "openai" en
// el nombre; `core/llm.js` hablaba por `fetch` directo, sin SDK, así que nunca hubo paquete que
// desinstalar).
//
// La dirección se compone en dos trozos y nunca se escribe entera en este fichero, a propósito:
// si se escribiera literal, este mismo censo se cazaría a sí mismo al leerse (ya le pasó una vez a
// otro censo de esta casa, buscando su propio nombre). No es ofuscación, es no repetir ese error.
//
// Estático, <1 s. Si algún día se reconstruye la lectura de facturas con Textract o Parseur (la
// ficha `captura-facturas-sin-ia`, con la firma de Ibrahin), ese proveedor tendrá su propia
// dirección y este censo seguirá diciendo la verdad sobre Anthropic sin tocarlo.
//
//   node scripts/verify-sin-proveedor-ia.mjs

import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';

const RAIZ = '/home/ubuntu/bamburu';
// Fuera de alcance a propósito: `.claude/` es configuración de la herramienta, no del producto;
// `orchestrator/` es la fábrica, y no se toca en este encargo (frontera de todas las tareas de
// hoy); este propio fichero, para no cazarse a sí mismo por describir lo que busca.
const IGNORAR_DIRS = new Set(['node_modules', '.git', 'data', 'logs', 'docs', '.claude', 'orchestrator']);
const IGNORAR_FICHEROS = new Set(['scripts/verify-sin-proveedor-ia.mjs']);
const AGUJA = 'api.' + 'anthropic.com';

let pass = 0, fail = 0;
const ok = (c, t, d = '') => { if (c) { pass++; console.log(`  ✓ ${t}`); } else { fail++; console.log(`  ✗ ${t}${d ? ' — ' + d : ''}`); } };

function barrer(dir, raizRelativa, hallazgos) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    const rel = relative(raizRelativa, p);
    if (IGNORAR_FICHEROS.has(rel)) continue;
    if (e.isDirectory()) { barrer(p, raizRelativa, hallazgos); continue; }
    if (!/\.(js|mjs|cjs|json)$/.test(e.name)) continue;
    const src = readFileSync(p, 'utf8');
    const i = src.indexOf(AGUJA);
    if (i !== -1) {
      const linea = src.slice(0, i).split('\n').length;
      hallazgos.push(`${rel}:${linea}`);
    }
  }
  return hallazgos;
}

console.log('\n[1] la dirección del proveedor no aparece en ningún fichero del árbol');
{
  const hallazgos = barrer(RAIZ, RAIZ, []);
  ok(hallazgos.length === 0, `cero apariciones de "${AGUJA}"`, hallazgos.join(', '));
}

console.log('\n[2] no hay paquete del proveedor que desinstalar');
{
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const sospechosos = deps.filter(d => /anthropic|openai/i.test(d));
  ok(sospechosos.length === 0, 'ninguna dependencia con "anthropic" u "openai" en el nombre', sospechosos.join(', '));
  // No debe haber quedado instalado tampoco (por si se instaló a mano y se olvidó del package.json).
  let enDisco = false;
  try { readdirSync(join(RAIZ, 'node_modules', '@anthropic-ai')); enDisco = true; } catch { /* no existe: bien */ }
  ok(!enDisco, 'y no está instalado en node_modules (@anthropic-ai)');
}

console.log('\n[3] ROJO PROVOCADO — el detector no está ciego');
{
  const tmp = mkdtempSync(join(tmpdir(), 'verify-sin-proveedor-ia-'));
  writeFileSync(join(tmp, 'sospechoso.js'), "const URL = 'https://" + AGUJA + "/v1/messages';\n");
  const hallazgos = barrer(tmp, tmp, []);
  ok(hallazgos.length === 1, 'sobre un fichero CON la dirección, el detector la caza', hallazgos.join(', '));
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nRESULTADO: ${pass} ✓ · ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
