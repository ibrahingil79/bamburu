// BLOQUES 2 y 3 del encargo del 2 sep 2026, y los cuatro cabos de la auditoría.
// Todo lo que se prueba aquí salió de algo que pasó de verdad, con su fecha.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { esGuionDeComprobacion } from '../validator.js';
import { validarAnalisis, pasosQuePidenPersona } from '../validacion/validador.js';
import { decidir, ACCIONES, PASOS } from '../nucleo/maquina.js';
import { estadoInicial, aplicar, Almacen } from '../nucleo/almacen.js';
import { cargarConfig } from '../nucleo/config.js';

const cfg = cargarConfig({ raiz: '/tmp', entorno: {} });
const RELLENO = 'Se toca la capa de rutas siguiendo el patrón de validación que ya existe. '.repeat(20);
function analisis(cuerpo, criterios) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-plano-'));
  const r = path.join(d, 'a.md');
  fs.writeFileSync(r, `# Análisis\n\n${RELLENO}\n\n${cuerpo}\n\n## Criterios de aceptación\n\n`
    + criterios.map((c) => `- [ ] ${c}`).join('\n') + '\n');
  return r;
}

// ── BLOQUE 2 · el portero deja de tirar trabajo bueno ───────────────────────
test('BLOQUE 2 · los tres ficheros por los que tumbó entregas quedan exentos', () => {
  const p = cfg.cli.guionesDeComprobacion;
  assert.equal(esGuionDeComprobacion('scripts/verify-disa-herramientas-paralelo.mjs', p), true);
  assert.equal(esGuionDeComprobacion('scripts/verify-verifactu-anclaje.mjs', p), true);
  assert.equal(esGuionDeComprobacion('orchestrator/pruebas/ciclo.test.js', p), true);
  assert.equal(esGuionDeComprobacion('scripts/gate-403-permiso.mjs', p), true);
});

test('BLOQUE 2 · en el PRODUCTO la regla se queda exactamente como estaba', () => {
  const p = cfg.cli.guionesDeComprobacion;
  for (const f of ['modules/erp/routes/invoices.js', 'core/llm.js', 'modules/disa/index.js',
                   'scripts/bamburu-backup.sh', 'scripts/lib/manifiesto-copias.mjs']) {
    assert.equal(esGuionDeComprobacion(f, p), false, `${f} es producto: la regla le aplica`);
  }
});

// ── BLOQUE 3 · el plano se comprueba contra sí mismo ────────────────────────
test('BLOQUE 3 · EL CASO REAL: un plano con «para y dime» dentro no pasa', () => {
  // Es la frase literal que tenía «Cifrar las copias de seguridad», y con la que el programador
  // se atascó dos veces con seis minutos de diferencia sin tocar un fichero.
  const v = validarAnalisis(analisis('Paso 3: **para y dime lo que has encontrado antes de seguir**.',
    ['Uno bien claro', 'Dos bien claro', 'Tres bien claro']), {});
  assert.equal(v.ok, false);
  assert.match(v.motivos.join(' '), /EXIGE HABLAR CON UNA PERSONA A MITAD/);
});

test('BLOQUE 3 · hablar de la firma de Ibrahin al final NO es una parada a mitad', () => {
  // El rojo falso aquí costaría una vuelta entera, que es justo lo que se está quitando.
  assert.deepEqual(pasosQuePidenPersona(
    'Esta tarea la firma Ibrahin: cuando esté terminada se le presenta la promesa y él decide. '
    + 'El orquestador sigue con la siguiente tarea mientras tanto.'), []);
});

test('BLOQUE 3 · un plano que añade trabajo de más se rechaza; los de Ibrahin no cuentan', () => {
  const tablero = [{ hecho: false, aMedias: false, texto: 'El portal escribe el dinero como en España' }];
  const propios = ['Se pasa el barrido entero', 'Se documenta en el README', 'Se añade un gate nuevo',
                   'Se revisa la capa de rutas', 'Se sanea el menú'];
  const v = validarAnalisis(analisis('Nada raro.', [tablero[0].texto, ...propios]),
    { criteriosTablero: tablero, maxCriteriosPropios: 3 });
  assert.equal(v.ok, false);
  assert.match(v.motivos.join(' '), /AÑADES 5 criterios tuyos/);

  const bien = validarAnalisis(analisis('Nada raro.', [tablero[0].texto, ...propios.slice(0, 3)]),
    { criteriosTablero: tablero, maxCriteriosPropios: 3 });
  assert.equal(bien.ok, true, bien.motivos?.join(' · '));
});

test('BLOQUE 3 · «el plano no se puede construir» va al ARQUITECTO y no gasta intento del programador', () => {
  const estado = { ...estadoInicial(), paso: PASOS.VALIDAR_CODIGO, intento: 1, replanteos: 0,
                   base: 'abc', tarea: { id: 't', titulo: 'T', criterios: [] } };
  const d = decidir({ estado, cuota: { fiable: true, sesionPct: 5, semanaPct: 5 },
    obs: { codigo: { valido: false, planoImposible: true, motivos: ['el criterio 2 contradice al 8'] } },
    config: cfg });
  assert.equal(d.tipo, ACCIONES.REPLANTEAR, 'lo replantea el arquitecto, no lo repite el programador');
  assert.match(d.motivos.join(' '), /contradice/, 'y el motivo VIAJA al plano nuevo');
});

test('BLOQUE 3 · sin replanteamientos disponibles, un plano imposible se aparta y sube a Ibrahin', () => {
  const estado = { ...estadoInicial(), paso: PASOS.VALIDAR_CODIGO, intento: 1,
                   replanteos: cfg.ciclo.maxReplanteos, base: 'abc', tarea: { id: 't', titulo: 'T', criterios: [] } };
  const d = decidir({ estado, cuota: { fiable: true, sesionPct: 5, semanaPct: 5 },
    obs: { codigo: { valido: false, planoImposible: true, motivos: ['sigue sin poder construirse'] } },
    config: cfg });
  assert.equal(d.tipo, ACCIONES.APARTAR, 'no da vueltas para siempre');
});

test('BLOQUE 3 · un código malo de verdad SIGUE volviendo al programador', () => {
  const estado = { ...estadoInicial(), paso: PASOS.VALIDAR_CODIGO, intento: 1,
                   base: 'abc', tarea: { id: 't', titulo: 'T', criterios: [] } };
  const d = decidir({ estado, cuota: { fiable: true, sesionPct: 5, semanaPct: 5 },
    obs: { codigo: { valido: false, motivos: ['no hay ningún commit nuevo'] } }, config: cfg });
  assert.equal(d.tipo, ACCIONES.REINTENTAR);
});

// ── Los cuatro cabos de la auditoría ────────────────────────────────────────
test('AUDITORÍA · una llamada que vence apunta «no lo sé», no cero', () => {
  let e = aplicar(estadoInicial(), { tipo: 'PAPEL_MEDIDO', papel: 'programador', modelo: 'm',
                                     ms: 1800000, costeUsd: null, puntos: 11 });
  assert.equal(e.gastoPorPapel.programador.sinCoste, 1, 'se cuenta aparte');
  assert.equal(e.gastoPorPapel.programador.costeUsd, 0, 'y no se inventa un número');
  e = aplicar(e, { tipo: 'PAPEL_MEDIDO', papel: 'programador', modelo: 'm', ms: 1000, costeUsd: 2, puntos: 1 });
  assert.equal(e.gastoPorPapel.programador.costeUsd, 2);
  assert.equal(e.gastoPorPapel.programador.sinCoste, 1, 'una buena no borra la desconocida');
});

test('AUDITORÍA · el historial no devuelve la basura de un bucle, pero conserva los sucesos reales', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-hist-'));
  const r = path.join(d, 'h.ndjson');
  const filas = [];
  // Un cierre de verdad, un bucle de 200 vueltas a una por minuto, y otro cierre 4 h después.
  filas.push({ cuando: '2026-09-01T14:18:00.000Z', id: 'x', resultado: 'cerrada' });
  for (let i = 0; i < 200; i++) {
    filas.push({ cuando: new Date(Date.parse('2026-09-01T15:00:00.000Z') + i * 60000).toISOString(),
                 id: 'y', resultado: 'esperando-firma' });
  }
  filas.push({ cuando: '2026-09-01T18:21:00.000Z', id: 'x', resultado: 'cerrada' });
  fs.writeFileSync(r, filas.map((f) => JSON.stringify(f)).join('\n') + '\n');

  const alm = new Almacen({ rutaEstado: path.join(d, 'e.json'), rutaJournal: path.join(d, 'j.ndjson'), rutaHistorial: r });
  assert.equal(alm.leerHistorial({ enBruto: true }).length, 202, 'el fichero NO se toca');
  const limpio = alm.leerHistorial();
  assert.equal(limpio.length, 3, 'el bucle de 200 queda en una');
  assert.equal(limpio.filter((f) => f.id === 'x').length, 2, 'los dos cierres reales se conservan');
});
