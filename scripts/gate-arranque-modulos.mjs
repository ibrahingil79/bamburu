#!/usr/bin/env node
//
// gate-arranque-modulos.mjs — AUD-007: que Bamburu no arranque a medias, y que si lo hace, se oiga.
//
// ⚠️ QUÉ MIDE, Y CÓMO. **El estado real de un proceso**: lanza `node` de verdad, con el cargador de
// verdad, y mira el CÓDIGO DE SALIDA y lo que escribió. No se cree ningún registro ni ninguna
// variable: un cargador que dice «me muero» y no se muere es exactamente el fallo de esta tarea.
//
// POR QUÉ NO ARRANCA `index.js` ENTERO. Porque para romper un módulo habría que estropear el árbol
// vivo del repositorio —el mismo que sirve a los 8 negocios— durante la prueba, y si la prueba muere
// a mitad se queda roto. En su lugar el hijo hace EXACTAMENTE lo que hace `index.js` con el mismo
// cargador (`await loadModules(...)` en el nivel de arriba) sobre un `modules/` de mentira, y aparte
// se comprueba que la llamada de `index.js` sigue siendo esa y que nadie se traga la excepción.
// Lo que esto NO puede probar —que el servicio real no levanta— se probó A MANO en el servidor y
// está escrito en `docs/arranque/modulos-diagnostico.md`.
//
//   node scripts/gate-arranque-modulos.mjs
import { execFileSync, execFileSync as _e } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODULOS, ESENCIALES_POR_IMPORT_ESTATICO } from '../core/loader.js';
import { textoDeAviso } from '../core/aviso-arranque.js';

const RAIZ = path.resolve(new URL('..', import.meta.url).pathname);
let pass = 0, fail = 0;
const ok = (c, m, det) => {
  if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); }
  else { fail++; console.error('  ✗ FALLO: ' + m + (det ? ' · ' + det : '')); }
};

// ── El banco de pruebas: un `modules/` de mentira y un hijo que imita a index.js ─────────────────
const BANCO = mkdtempSync(path.join(tmpdir(), 'gate-arranque-'));

/** Escribe un módulo de mentira con la avería pedida. */
function sembrar(nombre, averia) {
  const dir = path.join(BANCO, 'modules', nombre);
  mkdirSync(dir, { recursive: true });
  const cuerpo = {
    sano:            "export function register(){ console.log('MONTADO ' + " + JSON.stringify(nombre) + "); }",
    revienta_import: "throw new Error('ZZ fallo al importar: dependencia que no existe');",
    sin_register:    "export const otraCosa = 1;",
    revienta_register: "export function register(){ throw new Error('ZZ fallo DENTRO de register'); }",
  }[averia];
  writeFileSync(path.join(dir, 'index.js'), cuerpo + '\n');
}

/**
 * Lanza un hijo que hace lo mismo que `index.js`: `await loadModules(app, db)` arriba del todo.
 * Devuelve el estado REAL del proceso.
 */
function arrancar() {
  const guion = path.join(BANCO, 'arranque.mjs');
  writeFileSync(guion,
    "import { loadModules } from " + JSON.stringify(path.join(RAIZ, 'core/loader.js')) + ";\n" +
    "await loadModules({}, {});\n" +
    "console.log('LLEGO_AL_FINAL');\n");
  const r = spawnSync(process.execPath, [guion], { cwd: BANCO, encoding: 'utf8', timeout: 30000 });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
}

try {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] LA CLASIFICACIÓN ESTÁ ESCRITA, EN UN SOLO SITIO Y CON SU MOTIVO');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  ok(Array.isArray(MODULOS) && MODULOS.length > 0, 'el cargador declara la lista de módulos', MODULOS.length + ' módulos');
  ok(MODULOS.every(m => typeof m.esencial === 'boolean'), 'cada módulo dice si es esencial o no — no hay terceros estados');
  ok(MODULOS.every(m => typeof m.porque === 'string' && m.porque.length > 40),
     'cada uno lleva su MOTIVO escrito, no solo la etiqueta');
  const esenciales = MODULOS.filter(m => m.esencial).map(m => m.nombre);
  ok(esenciales.length === 1 && esenciales[0] === 'erp',
     'esencial es SOLO el erp (decisión de Ibrahin, 3 sep 2026)', esenciales.join(', ') || 'ninguno');
  ok(ESENCIALES_POR_IMPORT_ESTATICO.includes('registro') && ESENCIALES_POR_IMPORT_ESTATICO.includes('superadmin'),
     'y queda escrito que registro y superadmin ya son esenciales por import estático');
  // Que la lista no se quede corta: los módulos del disco tienen que estar todos contemplados.
  const enDisco = execFileSync('ls', ['-1', path.join(RAIZ, 'modules')], { encoding: 'utf8' }).trim().split('\n');
  const contemplados = new Set([...MODULOS.map(m => m.nombre), ...ESENCIALES_POR_IMPORT_ESTATICO]);
  const huerfanos = enDisco.filter(m => !contemplados.has(m));
  ok(huerfanos.length === 0, 'NINGÚN módulo del disco se queda sin clasificar',
     huerfanos.length ? 'sin clasificar: ' + huerfanos.join(', ') : enDisco.length + ' módulos, todos contemplados');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] UN MÓDULO ESENCIAL CAÍDO → EL PROCESO NO QUEDA VIVO. Los TRES modos de fallo.');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  for (const averia of ['revienta_import', 'sin_register', 'revienta_register']) {
    rmSync(path.join(BANCO, 'modules'), { recursive: true, force: true });
    sembrar('erp', averia);
    for (const otro of ['store', 'disa', 'portal']) sembrar(otro, 'sano');
    const r = arrancar();
    ok(r.codigo !== 0 && r.codigo !== null, '[' + averia + '] el proceso MUERE, no sigue vivo', 'código de salida ' + r.codigo);
    ok(!r.salida.includes('LLEGO_AL_FINAL'), '  y no llega a arrancar nada de lo que venía después');
    ok(/módulo esencial «erp»/i.test(r.salida), '  dice QUÉ módulo ha sido');
    ok(/ZZ fallo|NO exporta una función/.test(r.salida), '  y el motivo DE ORIGEN, no uno genérico');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] UN MÓDULO OPCIONAL CAÍDO → ARRANCA, PERO NUNCA EN SILENCIO');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rmSync(path.join(BANCO, 'modules'), { recursive: true, force: true });
  sembrar('erp', 'sano');
  sembrar('store', 'sano');
  sembrar('disa', 'sin_register');        // el modo que ANTES no imprimía absolutamente nada
  sembrar('portal', 'revienta_import');
  const opc = arrancar();
  ok(opc.codigo === 0, 'con solo módulos opcionales caídos, Bamburu SÍ arranca', 'código ' + opc.codigo);
  ok(opc.salida.includes('LLEGO_AL_FINAL'), '  y llega a lo que venía después');
  ok(/Módulo opcional caído: disa/.test(opc.salida),
     'el módulo SIN register ya no es mudo — era el agujero que no estaba ni en la ficha');
  ok(/NO exporta una función `register`/.test(opc.salida), '  y explica exactamente qué le pasa');
  ok(/Módulo opcional caído: portal/.test(opc.salida), 'el que revienta al importar también se oye');
  ok(/Aviso a Telegram: /.test(opc.salida), 'y de cada uno se dice si el aviso salió o no salió');
  ok(opc.salida.includes('MONTADO erp'), 'el módulo sano SIGUE montándose: un opcional roto no arrastra a los demás');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] CON TODO PRESENTE, ARRANCA IGUAL QUE ANTES');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rmSync(path.join(BANCO, 'modules'), { recursive: true, force: true });
  for (const m of MODULOS) sembrar(m.nombre, 'sano');
  const sano = arrancar();
  ok(sano.codigo === 0, 'con los cuatro módulos sanos, el proceso termina bien', 'código ' + sano.codigo);
  for (const m of MODULOS) {
    ok(sano.salida.includes('✅ Módulo cargado: ' + m.nombre),
       '  ' + m.nombre + ' se monta y lo dice con la MISMA línea de siempre');
  }
  ok(!/FALLO|caído|Aviso a Telegram/.test(sano.salida), '  y no se inventa ni un aviso cuando no hay nada roto');
  // El orden importa: `erp` monta /admin y los demás cuelgan de eso.
  const orden = MODULOS.map(m => sano.salida.indexOf('✅ Módulo cargado: ' + m.nombre));
  ok(orden.every((v, i) => i === 0 || v > orden[i - 1]), '  y en el mismo ORDEN que antes', MODULOS.map(m => m.nombre).join(' → '));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] EL AVISO LLEVA EL MÓDULO Y EL MOTIVO');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const t = textoDeAviso({ modulo: 'erp', esencial: true, error: new Error('ZZ Unexpected reserved word') });
  ok(t.includes('erp'), 'el aviso nombra el módulo');
  ok(t.includes('ZZ Unexpected reserved word'), 'y lleva el motivo de origen');
  ok(/NO ARRANCA/.test(t), 'y dice que el servicio está caído, no un «algo ha ido mal»');
  const t2 = textoDeAviso({ modulo: 'disa', esencial: false, error: new Error('ZZ otro') });
  ok(/SIN una parte/.test(t2) && /El resto sigue en pie/.test(t2),
     'y el de un opcional dice otra cosa: sin él se arranca, y eso el aviso lo distingue');
  ok(!textoDeAviso({ modulo: 'erp', esencial: true, error: new Error("Unexpected token '<'") }).includes('<code>Unexpected token \'<\''),
     'un motivo con < > no rompe el HTML del mensaje: el aviso saldría igual el día que haga falta');

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] NADIE SE TRAGA LA EXCEPCIÓN EN index.js');
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const idx = readFileSync(path.join(RAIZ, 'index.js'), 'utf8');
  ok(/^await loadModules\(app, db\);$/m.test(idx),
     'la llamada sigue siendo un `await` pelado en el nivel de arriba, sin try alrededor');
  ok(!/process\.on\((['"])(unhandledRejection|uncaughtException)\1/.test(idx),
     'y no hay ningún manejador global que convierta el fallo en un aviso y siga');

} catch (e) {
  fail++;
  console.error('  ✗ EXCEPCIÓN: ' + (e?.stack || e?.message || e));
} finally {
  rmSync(BANCO, { recursive: true, force: true });
}

console.log('\n═════════ RESULTADO: ' + pass + ' ✓ · ' + fail + ' ✗ ═════════');
process.exit(fail ? 1 : 0);
