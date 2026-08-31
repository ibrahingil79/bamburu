// Validación: criterios de aceptación obligatorios, veredicto legible, motivos cerrados.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validarAnalisis, validarRevision, extraerCriterios, criteriosCubiertos, MOTIVOS_RECHAZO } from '../validacion/validador.js';
import { interpretarUsage } from '../cuota/usage.js';
import { clasificar } from '../ejecucion/cli.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-val-'));
const escribir = (n, t) => { const p = path.join(dir, n); fs.writeFileSync(p, t, 'utf8'); return p; };
const RELLENO = 'Se toca la capa de rutas siguiendo el patrón de validación que ya usa quotes.js. '.repeat(20);

test('un análisis SIN criterios de aceptación se rechaza', () => {
  const p = escribir('a1.md', `# Análisis\n\n${RELLENO}\n\nNo hay casillas aquí.\n`);
  const v = validarAnalisis(p);
  assert.equal(v.ok, false);
  assert.ok(v.motivos.some((m) => /CRITERIOS DE ACEPTACIÓN/.test(m)));
});

test('un análisis con criterios pasa', () => {
  const p = escribir('a2.md', `# Análisis\n\n${RELLENO}\n\n## Criterios de aceptación\n\n- [ ] Existe la funcion suma y devuelve el total\n- [ ] Con entrada no numerica lanza error claro\n- [ ] Hay una prueba que cubre ambos casos\n`);
  const v = validarAnalisis(p);
  assert.equal(v.ok, true, v.motivos?.join('; '));
  assert.equal(v.criterios.length, 3);
});

test('con menos de 3 criterios no pasa', () => {
  const p = escribir('a3.md', `# Análisis\n\n${RELLENO}\n\n## Criterios de aceptación\n\n- [ ] Solo uno y bastante largo para contar\n`);
  assert.equal(validarAnalisis(p).ok, false);
});

test('el arquitecto puede parar y eso NO es un fallo suyo', () => {
  const p = escribir('a4.md', `🛑 TAREA MAL PLANTEADA\n\nToca Capa 2, que está congelada por CANON.\n`);
  const v = validarAnalisis(p);
  assert.equal(v.ok, false);
  assert.equal(v.paroArquitecto, true);
  assert.match(v.motivos[0], /Capa 2/);
});

test('una revisión con los dos veredictos es ambigua y se tira', () => {
  const p = escribir('r1.md', '✅ APROBADO\n\nPero en realidad ❌ RECHAZADO\n');
  const v = validarRevision(p);
  assert.equal(v.ok, false);
  assert.match(v.resumen, /ambigua/);
});

test('una revisión sin veredicto no vale', () => {
  const p = escribir('r2.md', 'Pues está bastante bien, APROBADO sin el icono.\n');
  const v = validarRevision(p);
  assert.equal(v.ok, false);
  assert.ok(v.motivos.some((m) => /sin el ✅/.test(m)));
});

test('un rechazo SIN etiqueta de la lista cerrada no vale', () => {
  const p = escribir('r3.md', '❌ RECHAZADO\n\nNo me gusta.\n');
  const v = validarRevision(p);
  assert.equal(v.ok, false);
  assert.match(v.motivos[0], /CRITERIO-INCUMPLIDO/);
});

test('un rechazo con etiqueta vale y extrae los puntos', () => {
  const p = escribir('r4.md', `❌ RECHAZADO

### CRITERIO-INCUMPLIDO Falta validar la entrada

**Dónde:** suma.js:12
**Qué pasa:** no comprueba el tipo.
`);
  const v = validarRevision(p);
  assert.equal(v.ok, true);
  assert.equal(v.veredicto, 'rechazado');
  assert.deepEqual(v.etiquetas, ['CRITERIO-INCUMPLIDO']);
  assert.match(v.motivos[0], /suma\.js:12/);
});

test('un aprobado que se salta criterios NO pasa', () => {
  const criterios = [{ texto: 'Con una entrada que no sea numero lanza un error claro' },
                     { texto: 'Existe documentacion actualizada del modulo nuevo' }];
  const p = escribir('r5.md', '✅ APROBADO\n\n| 1 | entrada que no sea numero lanza error claro | SÍ | suma.js:12 |\n');
  const v = validarRevision(p, { criterios });
  assert.equal(v.ok, false);
  assert.match(v.motivos[0], /no se pronuncia sobre 1 criterio/);
});

test('interpreta /usage de verdad', () => {
  const real = `You are currently using your subscription to power your Claude Code usage

Current session: 64% used · resets Aug 31, 9:50pm (UTC)
Current week (all models): 10% used · resets Sep 3, 6pm (UTC)
Current week (Fable): 0% used`;
  const u = interpretarUsage(real);
  assert.equal(u.fiable, true);
  assert.equal(u.sesionPct, 64);
  assert.equal(u.semanaPct, 10);
  assert.match(u.reinicioSesion, /Aug 31/);
});

test('si /usage no se puede leer, NO se inventa un número', () => {
  const u = interpretarUsage('cualquier cosa que no es un usage');
  assert.equal(u.fiable, false);
  assert.equal(u.sesionPct, null);
});

test('permisos denegados SIN entrega son un fallo', () => {
  const salida = JSON.stringify({ is_error: false, result: '', permission_denials: [{ tool_name: 'Write' }] });
  const r = clasificar({ codigo: 0, salida, errores: '', vencido: false, cortado: false, timeoutMs: 1000, t0: Date.now() });
  assert.equal(r.ok, false);
  assert.equal(r.error.clase, 'PERMISOS_DENEGADOS');
});

test('permisos denegados CON entrega son un aviso, no un fallo: manda el artefacto', () => {
  // Medido en el laboratorio: al arquitecto le denegaron Bash y escribió igualmente un
  // análisis válido de 18 KB. Tirarlo habría costado otra llamada para nada.
  const salida = JSON.stringify({ is_error: false, result: 'análisis escrito', permission_denials: [{ tool_name: 'Bash' }] });
  const r = clasificar({ codigo: 0, salida, errores: '', vencido: false, cortado: false, timeoutMs: 1000, t0: Date.now() });
  assert.equal(r.ok, true);
  assert.deepEqual(r.denegadas, ['Bash'], 'la denegación se avisa igual');
});

test('un fallo por cuota se clasifica como espera, no como error definitivo', () => {
  const r = clasificar({ codigo: 1, salida: "You've hit your session limit", errores: '', vencido: false, cortado: false, timeoutMs: 1000, t0: Date.now() });
  assert.equal(r.error.clase, 'CUOTA_AGOTADA');
  assert.equal(r.error.esperaCuota, true);
});

test('un fallo que no se reconoce se trata como cuota: se espera, no se descarta', () => {
  const r = clasificar({ codigo: 1, salida: JSON.stringify({ is_error: true, result: 'algo raro' }), errores: '', vencido: false, cortado: false, timeoutMs: 1000, t0: Date.now() });
  assert.equal(r.error.clase, 'DESCONOCIDO');
  assert.equal(r.error.esperaCuota, true, 'el encargo manda esperar ante lo desconocido');
});

test('la palabra «límite» dentro de un prompt no se confunde con falta de cuota', () => {
  const salida = JSON.stringify({ is_error: false, result: 'He revisado los casos límite y el rate limit de la API interna.' });
  const r = clasificar({ codigo: 0, salida, errores: '', vencido: false, cortado: false, timeoutMs: 1000, t0: Date.now() });
  assert.equal(r.ok, true, 'una respuesta correcta que HABLA de límites no puede leerse como sin cuota');
});

test('una llamada que vence se clasifica como tiempo agotado', () => {
  const r = clasificar({ codigo: null, salida: '', errores: '', vencido: true, cortado: false, timeoutMs: 60000, t0: Date.now() });
  assert.equal(r.error.clase, 'TIEMPO_AGOTADO');
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
