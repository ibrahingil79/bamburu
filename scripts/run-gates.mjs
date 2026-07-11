#!/usr/bin/env node
//
// run-gates.mjs — el barrido de regresión. Corre gates y dice la VERDAD sobre cada uno.
//
// POR QUÉ EXISTE. No había runner: la regresión se corría a mano, con bucles de shell improvisados.
// El 11-jul-2026 uno de esos bucles decidía "aprobado" buscando la cadena "✗" en la SALIDA del gate.
// Catorce gates que morían al arrancar —sin imprimir ni una aserción— no contenían ningún "✗", así
// que el bucle los dio por VERDES. Llevaban tres semanas muertos. El fallo no estaba en los gates
// (salían con código != 0, como debe ser): estaba en quien los miraba.
//
// Reglas de este runner, para que eso no pueda repetirse:
//   1. Manda el CÓDIGO DE SALIDA, no lo que el gate imprima. 0 = pasa. Cualquier otra cosa = falla.
//   2. Un gate que sale 0 pero NO imprime un resumen reconocible ("N OK") es SOSPECHOSO, y cuenta
//      como FALLO. Un aprobado tiene que demostrarse, no presumirse del silencio.
//   3. El código 2 (lo usa lib/gate-env.mjs) se reporta aparte, como ABORTADO: el gate no pudo ni
//      arrancar. No es "falla un test": es "no se ha probado nada". Se distingue a propósito.
//   4. El runner sale != 0 si algo falla o aborta. Si se mete en un CI, el CI se entera.
//
//   node scripts/run-gates.mjs pagos        # un grupo
//   node scripts/run-gates.mjs disa motor   # varios grupos
//   node scripts/run-gates.mjs --all
//   node scripts/run-gates.mjs gate-pagos-proveedor verify-propuestas-pagos   # gates sueltos
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 300000;

// Grupos. Un gate puede estar en varios (la regresión de Pagos incluye los de compras/proveedor).
const GRUPOS = {
  pagos: [
    'test-pagos-proveedor', 'gate-pagos-proveedor', 'gate-pago-cuenta', 'gate-abono-proveedor',
    'gate-gasto-proveedor', 'test-devoluciones-proveedor', 'test-compras-motor',
    'test-suppliers-saneamiento', 'test-orden-compra-c1a', 'test-recepciones-c1b',
    'gate-c1c-diferencias-cierre', 'test-c1c-diferencias-cierre',
    'verify-propuestas-pagos', 'gate-propuestas-pagos-permisos',
  ],
  disa: [
    'verify-propuestas-d5', 'verify-propuestas-pagos', 'gate-propuestas-pagos-permisos',
    'verify-disa-query-permisos', 'verify-disa-sin-pedidos', 'verify-actividad-etiquetas',
    'gate-nav-inicio-disa', 'gate-disa-dictar-compra',
  ],
  inventario: ['test-transfers', 'verify-traslado-auditoria'],
  avisos: ['verify-avisos-permisos', 'gate-avisos-badge'],
};

// ── Gates que NO entran en el barrido, y POR QUÉ ────────────────────────────────────────────────
// Se imprimen SIEMPRE al final, con su motivo. Un gate que no se corre tiene que VERSE: desaparecer
// en silencio es exactamente el pecado que originó este runner.
//
// DEUDA: los cuatro `gate-*` de abajo están CADUCADOS —el producto cambió y el gate no— y además
// tienen efectos secundarios (ensucian el tenant, mandan email real). No se corren para no hacer
// daño en cada pasada, pero SIGUEN SIENDO TRABAJO PENDIENTE: el runner lo grita al terminar.
// Descubiertos el 11-jul-2026, al resucitarlos tras tres semanas muertos por la ruta rota.
const DEUDA = {
  'gate-recepciones-c1b':
    'CADUCADO: anula una recepción del producto 1, que hoy tiene TRASLADOS ACTIVOS → el motor lo bloquea (409) y hace BIEN. '
    + 'La regla de multi-almacén es POSTERIOR al gate. El motor está cubierto y verde en test-recepciones-c1b.',
  'gate-devoluciones-proveedor':
    'CADUCADO: misma raíz — cancela una compra del producto 1, bloqueada por el mismo guardián de traslados.',
  'gate-orden-compra-c1a':
    'CADUCADO: espera un alert() del navegador y la UI ya usa toast(). Además ENVÍA UN EMAIL REAL en cada pasada.',
  'gate-almacenes':
    'ROTO: no es idempotente — crea un "Almacén Norte (gate)" nuevo en cada pasada y NO lo limpia; '
    + 'en la siguiente tropieza con el anterior y los fallos cambian de una vez a otra. Correrlo ENSUCIA el tenant.',
  'gate-c2-captura':
    'CADUCADO: espera un selector #step2 que la pantalla ya no tiene (1 OK y muere). También deja almacenes de prueba sin limpiar.',
  'gate-disa-captura-chat':
    'CADUCADO: revienta leyendo una respuesta del chat que ya no tiene la forma que espera (5 OK y muere).',
  'gate-registro-tailscale':
    'NO CORRE aquí: el alta por Tailscale necesita un entorno que este servidor no tiene (0 OK). Revisar si sigue teniendo sentido.',
};

// Excluidos por naturaleza, no por estar rotos: no son deuda, simplemente no van en un barrido.
const EXCLUIDOS = {
  'verify-disa-pedidos-modelo-real': 'llama al MODELO REAL: ni determinista ni gratis. A mano.',
  'gate-pago-voz-avisos': 'llama al MODELO REAL (misma familia). A mano y a conciencia.',
  'verify-avisos-crm-riesgo': 'EN ROJO desde antes (datos de riesgo ya en la BD viva). Otro tema.',
  'gate-avisos-pantalla': 'EN ROJO desde antes (1 aserción). Otro tema.',
  'verify-pieza-c-http': 'gate FRÁGIL preexistente (redondeo de céntimos). Otro tema.',
};

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Uso: node scripts/run-gates.mjs <grupo|gate>...  |  --all');
  console.log('Grupos: ' + Object.keys(GRUPOS).join(', '));
  process.exit(64);
}

// Resolver qué se corre.
let objetivo = [];
if (args.includes('--all')) {
  objetivo = [...new Set(Object.values(GRUPOS).flat())];
} else {
  for (const a of args) objetivo.push(...(GRUPOS[a] || [a]));
  objetivo = [...new Set(objetivo)];
}

// Resuelve el fichero del gate: unos son .mjs y otros .js. Un bucle de shell que asumía .mjs saltaba
// test-transfers EN SILENCIO — el mismo pecado que este runner existe para impedir.
function ficheroDe(gate) {
  for (const ext of ['.mjs', '.js']) {
    const p = join(APP_DIR, 'scripts', gate + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

// Un gate que se pide y NO existe es un FALLO, no un "no pasa nada". Si se llama distinto de lo que
// cree quien lo invoca, lo que hay que hacer es gritar, no seguir como si tal cosa.
const inexistentes = objetivo.filter(g => !ficheroDe(g));
if (inexistentes.length) {
  console.error('✗ Estos gates NO EXISTEN (¿nombre mal escrito, o extensión distinta?): ' + inexistentes.join(', '));
  process.exit(64);
}

// Un "resumen" que demuestre que el gate corrió aserciones. Los gates de este repo no siguen UN solo
// formato: hay "22 OK", "PASS: 30   FAIL: 0", "48 OK, 0 fallos", "=== RESULTADO: 44 OK / 0 FALLOS ===".
// Si aquí falta un formato, el gate sale SOSPECHOSO — molesto, pero es el error seguro: prefiere
// desconfiar de un gate bueno antes que dar por bueno uno que no probó nada.
const RESUMEN = /\d+\s+OK\b|\bOK[,:]\s*\d+|\bPASS:\s*\d+/i;

function correr(gate) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn('node', [ficheroDe(gate)], { cwd: APP_DIR });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    const kill = setTimeout(() => { p.kill('SIGKILL'); }, TIMEOUT_MS);
    p.on('close', code => {
      clearTimeout(kill);
      const segs = ((Date.now() - t0) / 1000).toFixed(0);
      const m = out.match(RESUMEN);
      const resumen = m ? (m[0].trim()) : null;
      let estado;
      if (code === 2) estado = 'ABORTADO';                        // no pudo ni arrancar
      else if (code !== 0) estado = 'FALLA';
      else if (!resumen) estado = 'SOSPECHOSO';                   // salió 0 pero no demostró nada
      else estado = 'PASA';
      resolve({ gate, estado, code, resumen, segs, out });
    });
  });
}

const resultados = [];
for (const g of objetivo) {
  const r = await correr(g);
  const icono = { PASA: '✅', FALLA: '❌', ABORTADO: '🛑', SOSPECHOSO: '⚠️' }[r.estado];
  const detalle = r.estado === 'PASA' ? r.resumen
    : r.estado === 'ABORTADO' ? 'no pudo arrancar: NO ha verificado nada'
    : r.estado === 'SOSPECHOSO' ? 'salió 0 pero no imprimió resumen — no demuestra nada'
    : 'exit ' + r.code + (r.resumen ? ' · ' + r.resumen : '');
  console.log(`${icono} ${r.gate.padEnd(36)} ${detalle}  (${r.segs}s)`);
  resultados.push(r);
}

// Detalle de lo que no pasó: sin esto habría que re-ejecutar a mano para saber qué pasó.
const malos = resultados.filter(r => r.estado !== 'PASA');
for (const r of malos) {
  console.log('\n──── ' + r.gate + ' (' + r.estado + ', exit ' + r.code + ') ────');
  const lineas = r.out.split('\n').filter(l => /✗|Error|error:/i.test(l)).slice(0, 6);
  console.log((lineas.length ? lineas : r.out.split('\n').slice(-6)).join('\n'));
}

console.log('\nNO ejecutados, por su naturaleza (no son deuda):');
for (const [g, motivo] of Object.entries(EXCLUIDOS)) console.log('  · ' + g.padEnd(32) + motivo);

// La deuda va la ÚLTIMA y con banderita: es lo que el runner NO puede prometer. Un barrido "verde"
// que calle esto valdría lo mismo que el falso verde que lo hizo nacer.
console.log('\n🚧 DEUDA — ' + Object.keys(DEUDA).length + ' gates de navegador ROTOS o CADUCADOS, NO se están ejecutando:');
for (const [g, motivo] of Object.entries(DEUDA)) console.log('  · ' + g + '\n      ' + motivo);
console.log('  → Mientras sigan aquí, ESTAS PANTALLAS NO ESTÁN CUBIERTAS EN NAVEGADOR. Arreglarlos es tarea aparte.');

const pasa = resultados.filter(r => r.estado === 'PASA').length;
console.log('\n' + '═'.repeat(70));
console.log(`${pasa}/${resultados.length} pasan` + (malos.length ? `  ·  ${malos.length} NO: ` + malos.map(r => r.gate).join(', ') : ''));
console.log(`(y ${Object.keys(DEUDA).length} gates en DEUDA, sin ejecutar — arriba)`);
process.exit(malos.length ? 1 : 0);
