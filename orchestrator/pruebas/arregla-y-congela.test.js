// Las dos reglas que Ibrahin pidió el 2 sep 2026 para tapar el agujero de las 33 tareas SIN
// criterios suyos, más la lista dentro del aviso de firma para las 9 que sí firma él.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validarRevision, validarAnalisis } from '../validacion/validador.js';
import { estadoInicial, aplicar } from '../nucleo/almacen.js';
import { redactarFirma } from '../vigia/parte.js';

const ARREGLA = '## ¿ARREGLA LO QUE LA TAREA DECÍA?\n\n'
  + '**Lo que decía la tarea que estaba mal:** las copias van en claro.\n'
  + '**¿Sigue siendo cierto hoy?:** NO — el destino es un remote crypt, comprobado.\n\n';
const TABLA = '| # | Criterio | ¿Cumple? | Prueba |\n|---|---|---|---|\n'
  + '| 1 | Las copias suben cifradas de verdad | SÍ | rclone cryptcheck |\n';

function rev(texto) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-rv-'));
  const r = path.join(d, 'r.md'); fs.writeFileSync(r, texto); return r;
}
const RELLENO = 'Se toca la capa de rutas siguiendo el patrón de validación que ya existe. '.repeat(20);
function ana(criterios) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-an-'));
  const r = path.join(d, 'a.md');
  fs.writeFileSync(r, `# Análisis\n\n${RELLENO}\n\n## Criterios de aceptación\n\n`
    + criterios.map((c) => `- [ ] ${c}`).join('\n') + '\n');
  return r;
}

// ── OPCIÓN 1 · ¿arregla lo que la tarea decía? ──────────────────────────────
test('OPCIÓN 1 · un aprobado que no contesta «¿arregla lo que la tarea decía?» NO vale', () => {
  const v = validarRevision(rev('✅ APROBADO\n\n' + TABLA), { criterios: [], exigeArregla: true });
  assert.equal(v.ok, false);
  assert.match(v.resumen, /si arregla lo que la tarea decía/);
});

test('OPCIÓN 1 · con el apartado puesto, el aprobado vale', () => {
  const v = validarRevision(rev('✅ APROBADO\n\n' + ARREGLA + TABLA), { criterios: [], exigeArregla: true });
  assert.equal(v.ok, true, v.motivos?.join(' · '));
  assert.equal(v.veredicto, 'aprobado');
});

test('OPCIÓN 1 · un RECHAZO no necesita el apartado: ya está diciendo que no', () => {
  const v = validarRevision(rev('❌ RECHAZADO\n\n### [CRITERIO-INCUMPLIDO] Falta la validación\n\n'
    + '**Dónde:** suma.js:3\n**Qué pasa:** no comprueba el tipo.\n'), { criterios: [], exigeArregla: true });
  assert.equal(v.veredicto, 'rechazado');
  assert.equal(v.ok, true);
});

test('OPCIÓN 1 · EL CASO REAL: la revisión que aprobó el cifrado hoy NO valdría', () => {
  // Es el fichero de verdad, el que se aprobó el 1 sep. No contesta la pregunta porque nadie
  // se la hacía, y el enunciado de la tarea sigue siendo cierto hoy.
  const real = '/home/ubuntu/bamburu/docs/architecture/task-cifrado-copias-seguridad-review.md';
  if (!fs.existsSync(real)) return;   // el árbol puede haber cambiado; la prueba no inventa
  const v = validarRevision(real, { criterios: [], exigeArregla: true });
  assert.equal(v.ok, false, 'aquella revisión no contesta la pregunta que ahora es obligatoria');
  assert.match(v.resumen, /si arregla lo que la tarea decía/);
});

// ── OPCIÓN 2 · la lista aceptada se congela ────────────────────────────────
test('OPCIÓN 2 · un replanteamiento que REESCRIBE los criterios aceptados se rechaza', () => {
  const fijados = [{ texto: 'Las dos copias suben cifradas, con nombres y contenido cifrados' },
                   { texto: 'La llave vive en el servidor con permisos 600' }];
  const v = validarAnalisis(ana(['Hoy sigue habiendo copia sin cifrar',
                                 'La llave vive en el servidor con permisos 600',
                                 'Otro criterio cualquiera']), { criteriosFijados: fijados });
  assert.equal(v.ok, false);
  assert.match(v.motivos.join(' '), /CAMBIAS 1 CRITERIO\(S\) QUE YA SE ACEPTARON/);
  assert.match(v.motivos.join(' '), /Las dos copias suben cifradas/);
});

test('OPCIÓN 2 · replantear el ENFOQUE conservando la lista sí pasa', () => {
  const fijados = [{ texto: 'Las dos copias suben cifradas, con nombres y contenido cifrados' }];
  const v = validarAnalisis(ana(['Las dos copias suben cifradas, con nombres y contenido cifrados',
                                 'Se hace con un remote crypt en vez de con GPG',
                                 'Hay una prueba que lo ejercita']), { criteriosFijados: fijados });
  assert.equal(v.ok, true, v.motivos?.join(' · '));
});

test('OPCIÓN 2 · la lista se fija UNA vez y no se pisa después', () => {
  let e = aplicar(estadoInicial(), { tipo: 'CRITERIOS_FIJADOS', criterios: [{ texto: 'el bueno' }] });
  e = aplicar(e, { tipo: 'CRITERIOS_FIJADOS', criterios: [{ texto: 'el rebajado' }] });
  assert.equal(e.criteriosAceptados.length, 1);
  assert.equal(e.criteriosAceptados[0].texto, 'el bueno', 'el segundo intento NO la pisa: ése es el punto');
});

test('OPCIÓN 2 · y se suelta con la tarea, no se hereda a la siguiente', () => {
  let e = aplicar(estadoInicial(), { tipo: 'CRITERIOS_FIJADOS', criterios: [{ texto: 'de la tarea vieja' }] });
  e = aplicar(e, { tipo: 'TAREA_TOMADA', tarea: { id: 'nueva', titulo: 'N' }, cuando: 'c', cuota: 5 });
  assert.deepEqual(e.criteriosAceptados, []);
});

// ── OPCIÓN 3 · el aviso de firma trae la lista, sin un aviso nuevo ──────────
test('OPCIÓN 3 · el aviso de firma enseña contra qué se juzgó', () => {
  const t = redactarFirma({ tarea: { id: 'x', titulo: 'Anclar la cadena' }, quien: 'Ibrahin',
    rama: 'tarea/x', promesa: 'Un tercero puede demostrar que tu factura no se ha tocado.', commits: 6,
    criterios: [{ texto: 'El sello se guarda fuera del servidor' }, { texto: 'Un sello sin token no cuenta' }] });
  assert.match(t, /Contra qué se ha juzgado/);
  assert.match(t, /El sello se guarda fuera del servidor/);
  assert.match(t, /Un sello sin token no cuenta/);
  assert.match(t, /si esto no es lo que tú pedías/);
});

test('OPCIÓN 3 · sin criterios, el aviso sale igual y no dice nada raro', () => {
  const t = redactarFirma({ tarea: { id: 'x', titulo: 'T' }, quien: 'Ibrahin', rama: 'r', promesa: 'p', commits: 1 });
  assert.doesNotMatch(t, /Contra qué se ha juzgado/);
  assert.match(t, /esperando tu firma/);
});
