// LA LISTA DEL TABLERO MANDA. Sale del peor fallo que ha tenido la fábrica (2 sep 2026): el
// revisor juzgaba los criterios que escribe el arquitecto, no los de Ibrahin, y nadie comparaba
// las dos listas. En «Cifrar las copias de seguridad» el criterio 1 de Ibrahin era «las dos
// copias suben cifradas» y el que se juzgó fue «hoy sigue habiendo copia» — requisitos OPUESTOS.
// La tarea consta hecha, se subió dos veces, y las copias siguen en claro.
//
// Los textos de estas pruebas son los REALES de aquel día, no inventados.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validarAnalisis, validarRevision, criteriosDelTableroQueFaltan } from '../validacion/validador.js';
import { tareasPendientes } from '../reader.js';
import { decidir, ACCIONES, PASOS } from '../nucleo/maquina.js';
import { estadoInicial } from '../nucleo/almacen.js';

const CRITERIO_IBRAHIN = 'Las dos copias suben **cifradas**, con **contenido y nombres** (de fichero y de carpeta) cifrados.';
const CRITERIO_REBAJADO = '**Hoy sigue habiendo copia.** Sin fichero de destinos y con `BACKUP_REMOTE` en claro, exit 0.';
const TABLERO = [{ hecho: false, aMedias: false, texto: CRITERIO_IBRAHIN },
                 { hecho: false, aMedias: false, texto: 'La llave vive en el servidor con permisos `600`.' }];

const RELLENO = 'Se toca la capa de rutas siguiendo el patrón de validación que ya existe. '.repeat(20);
function analisisCon(criterios) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-crit-'));
  const r = path.join(d, 'a.md');
  fs.writeFileSync(r, `# Análisis\n\n${RELLENO}\n\n## Criterios de aceptación\n\n`
    + criterios.map((c) => `- [ ] ${c}`).join('\n') + '\n');
  return r;
}
function revisionCon(texto) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-rev-'));
  const r = path.join(d, 'r.md');
  fs.writeFileSync(r, texto);
  return r;
}

// ── El cambiazo, parado antes de gastar una construcción ─────────────────────
test('EL CASO REAL: un análisis que sustituye el criterio de Ibrahin por uno más flojo se RECHAZA', () => {
  const v = validarAnalisis(analisisCon([CRITERIO_REBAJADO, 'La llave vive en el servidor con permisos `600`.', 'Otro técnico']),
    { criteriosTablero: TABLERO });
  assert.equal(v.ok, false);
  assert.match(v.motivos.join(' '), /FALTAN 1 CRITERIO\(S\) DEL TABLERO/);
  assert.match(v.motivos.join(' '), /Las dos copias suben/, 'y dice CUÁL falta, literal');
});

test('copiarlos tal cual SÍ pasa, y el arquitecto puede añadir los suyos debajo', () => {
  const v = validarAnalisis(analisisCon([
    CRITERIO_IBRAHIN,
    'La llave vive en el servidor con permisos `600`.',
    'El script no se duplica: una sola pieza sirve las dos copias.',   // añadido del arquitecto
  ]), { criteriosTablero: TABLERO });
  assert.equal(v.ok, true, v.motivos?.join(' · '));
  assert.equal(v.criterios.length, 3, 'los tres viajan al revisor');
});

test('el énfasis de markdown no provoca un rojo falso, pero cambiar lo que se pide sí', () => {
  const sinAsteriscos = 'Las dos copias suben cifradas, con contenido y nombres (de fichero y de carpeta) cifrados.';
  assert.deepEqual(criteriosDelTableroQueFaltan(`- [ ] ${sinAsteriscos}`, [TABLERO[0]]), [],
    'mismo requisito escrito sin negritas: vale');
  assert.equal(criteriosDelTableroQueFaltan(`- [ ] ${CRITERIO_REBAJADO}`, [TABLERO[0]]).length, 1,
    'otro requisito: no vale');
});

// ── El revisor se pronuncia sobre los de Ibrahin, uno a uno ──────────────────
test('un APROBADO que no dice nada de un criterio de Ibrahin no vale', () => {
  const r = revisionCon('✅ APROBADO\n\n| # | Criterio | ¿Cumple? | Prueba |\n|---|---|---|---|\n'
    + '| 1 | La llave vive en el servidor con permisos 600 | SÍ | rclone.conf |\n');
  const v = validarRevision(r, { criterios: [], criteriosTablero: TABLERO });
  assert.equal(v.ok, false);
  assert.match(v.resumen, /cada criterio DEL TABLERO/);
  assert.match(v.motivos.join(' '), /copias suben/);
});

test('si los juzga todos, el aprobado vale', () => {
  const r = revisionCon('✅ APROBADO\n\n| # | Criterio | ¿Cumple? | Prueba |\n|---|---|---|---|\n'
    + `| 1 | ${CRITERIO_IBRAHIN} | SÍ | cryptcheck |\n`
    + '| 2 | La llave vive en el servidor con permisos `600`. | SÍ | ls -l |\n');
  const v = validarRevision(r, { criterios: [], criteriosTablero: TABLERO });
  assert.equal(v.ok, true, v.motivos?.join(' · '));
  assert.equal(v.veredicto, 'aprobado');
});

// ── Un criterio a medias no se puede cerrar ──────────────────────────────────
test('EL CASO REAL: con un criterio `[~]` en el tablero, un aprobado NO cierra la tarea', () => {
  const estado = { ...estadoInicial(), paso: PASOS.VALIDAR_REVISION, intento: 1,
    tarea: { id: 't', titulo: 'T', criterios: [{ hecho: false, aMedias: true, texto: CRITERIO_IBRAHIN }] } };
  const d = decidir({ estado, cuota: { fiable: true, sesionPct: 5, semanaPct: 5 },
    obs: { revision: { existe: true, veredicto: 'aprobado', motivos: [] } },
    config: { cuota: { minimoParaCicloPct: 15, margenReservadoPct: 10, minimoSemanalPct: 10, esperaSinCuotaMs: 900000 },
              ciclo: { maxIntentosRevision: 3, maxReplanteos: 1, maxFallosTecnicosPorPaso: 3, intervaloVueltaMs: 60000 } } });
  assert.notEqual(d.tipo, ACCIONES.CERRAR, 'no puede cerrarse con un criterio a medias');
  assert.match(JSON.stringify(d.motivos || []), /CRITERIO A MEDIAS EN EL TABLERO/);
});

test('sin criterios a medias, el mismo aprobado sí cierra', () => {
  const estado = { ...estadoInicial(), paso: PASOS.VALIDAR_REVISION, intento: 1,
    tarea: { id: 't', titulo: 'T', criterios: [{ hecho: false, aMedias: false, texto: CRITERIO_IBRAHIN }] } };
  const d = decidir({ estado, cuota: { fiable: true, sesionPct: 5, semanaPct: 5 },
    obs: { revision: { existe: true, veredicto: 'aprobado', motivos: [] } },
    config: { cuota: { minimoParaCicloPct: 15, margenReservadoPct: 10, minimoSemanalPct: 10, esperaSinCuotaMs: 900000 },
              ciclo: { maxIntentosRevision: 3, maxReplanteos: 1, maxFallosTecnicosPorPaso: 3, intervaloVueltaMs: 60000 } } });
  assert.equal(d.tipo, ACCIONES.CERRAR);
});

// ── Y que el `[~]` se vea, que es donde empezó todo ──────────────────────────
test('el lector VE un criterio a medias en vez de tragárselo', () => {
  const tab = '## TAREA — Prueba\n\n- **id:** p\n- **estado:** pendiente\n\n'
    + 'Algo que hacer.\n\n**Criterios de aceptación**\n\n'
    + '- [~] Las dos copias suben cifradas\n- [x] La llave vive en el servidor\n- [ ] Hay una prueba\n';
  const t = tareasPendientes(tab).find((x) => x.id === 'p');
  assert.equal(t.criterios.length, 3, 'el `[~]` NO desaparece de la lista');
  assert.equal(t.criterios[0].aMedias, true);
  assert.equal(t.criterios[0].hecho, false);
  assert.equal(t.criterios[1].hecho, true);
  assert.equal(t.criterios[2].aMedias, false);
});
