// Encadenado: al terminar una tarea, el sistema coge la siguiente SOLO.
//
// De dónde sale (31 ago 2026): el orquestador cerró `disa-informes-permiso-dueno` y se quedó
// 19 vueltas diciendo «el tablero no ofrece ninguna tarea» con CUATRO pendientes escritas y
// bien escritas. Esperaba un rótulo «SIGUIENTE TAREA» que nadie le ponía: al cerrar una tarea
// se le quitaba, y no se le daba a nadie. Estas pruebas cubren las tres piezas del arreglo:
//   1 · el lector coge por `estado:`, no por la etiqueta;
//   2 · ocioso con el tablero lleno es una AVERÍA y se avisa;
//   3 · una apartada se marca en el tablero, o se cogería en bucle infinito.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buscarSiguienteTarea, tareasPendientes } from '../reader.js';
import { decidir, ACCIONES } from '../nucleo/maquina.js';
import { redactar, redactarAveria } from '../vigia/parte.js';
import { Almacen } from '../nucleo/almacen.js';
import { Ciclo } from '../ciclo.js';
import { repoTemporal, limpiar, configDe, registroMudo, vigilanteFalso, invocadorFalso, respuestaOk } from './ayuda.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1 · El lector: manda `estado:`, no la etiqueta
// ─────────────────────────────────────────────────────────────────────────────

const TRES_SIN_ROTULO = `# Tablero

## ✅ HECHA (2026-08-31) — La que ya se hizo · \`e5111df\`

- **id:** la-que-ya-se-hizo
- **estado:** hecha

Texto de la que ya se hizo.

## TAREA — La primera que queda

- **id:** la-primera-que-queda
- **estado:** pendiente

Texto de la primera que queda.

## TAREA — La segunda que queda

- **id:** la-segunda-que-queda
- **estado:** pendiente

Texto de la segunda que queda.
`;

test('coge la primera pendiente aunque NINGUNA lleve el rótulo de siguiente', () => {
  // Ésta es la avería del 31 ago en una línea: antes esto devolvía null.
  const t = buscarSiguienteTarea(TRES_SIN_ROTULO);
  assert.ok(t, 'el tablero tiene trabajo: no puede devolver null');
  assert.equal(t.id, 'la-primera-que-queda');
});

test('no coge una que ya está hecha', () => {
  const ids = tareasPendientes(TRES_SIN_ROTULO).map((t) => t.id);
  assert.deepEqual(ids, ['la-primera-que-queda', 'la-segunda-que-queda']);
  assert.ok(!ids.includes('la-que-ya-se-hizo'));
});

test('no coge una apartada: está esperando decisión, no libre', () => {
  const texto = TRES_SIN_ROTULO.replace('- **estado:** pendiente\n\nTexto de la primera', '- **estado:** apartada\n\nTexto de la primera');
  assert.equal(buscarSiguienteTarea(texto).id, 'la-segunda-que-queda');
});

test('el rótulo SIGUIENTE TAREA sigue mandando: es como se salta el orden natural', () => {
  const texto = TRES_SIN_ROTULO.replace('## TAREA — La segunda que queda', '## SIGUIENTE TAREA — La segunda que queda');
  assert.equal(buscarSiguienteTarea(texto).id, 'la-segunda-que-queda',
    'con rótulo se salta el orden del documento, que es justo para lo que sirve');
});

test('el capítulo que contiene las tareas no se confunde con una tarea', () => {
  const texto = `# Tablero\n\n# 📌 TAREAS EN FORMATO DEL ORQUESTADOR — convertidas hoy\n\nUn párrafo que explica la lista.\n\n## TAREA — La de verdad\n\n- **id:** la-de-verdad\n- **estado:** pendiente\n\nTexto.\n`;
  assert.deepEqual(tareasPendientes(texto).map((t) => t.id), ['la-de-verdad']);
});

test('sin `estado:` escrito se da por pendiente: mejor ofrecer de más que callarse de menos', () => {
  const texto = '# Tablero\n\n## TAREA — Sin estado\n\n- **id:** sin-estado\n\nTexto.\n';
  assert.equal(buscarSiguienteTarea(texto).id, 'sin-estado');
});

test('`excluir` deja fuera las apartadas de esta sesión', () => {
  const t = buscarSiguienteTarea(TRES_SIN_ROTULO, { excluir: ['la-primera-que-queda'] });
  assert.equal(t.id, 'la-segunda-que-queda');
});

test('con el tablero de verdad vacío sigue devolviendo null', () => {
  assert.equal(buscarSiguienteTarea('# Tablero\n\nNada que hacer.\n'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · La máquina: ocioso con el tablero lleno es una AVERÍA
// ─────────────────────────────────────────────────────────────────────────────

const CFG = { ciclo: { maxIntentosRevision: 3, maxReplanteos: 1, maxFallosTecnicosPorPaso: 3 }, cuota: { esperaSinCuotaMs: 1 } };
const LIBRE = { version: 1, tarea: null, paso: 'OCIOSO', intento: 0, replanteos: 0, historial: [], fallosTecnicos: {}, apartadas: [], subidaPendiente: false };

test('ocioso con el tablero VACÍO es ocioso de verdad: sin avería', () => {
  const d = decidir({ estado: LIBRE, cuota: null, tareaDisponible: null, pendientesEnTablero: [], config: CFG });
  assert.equal(d.tipo, ACCIONES.OCIOSO);
  assert.equal(d.averia, undefined);
});

test('ocioso TENIENDO tareas pendientes NO es ocioso: es avería', () => {
  const d = decidir({
    estado: LIBRE, cuota: null, tareaDisponible: null,
    pendientesEnTablero: [{ id: 'a', titulo: 'Dos herramientas a la vez' }, { id: 'b', titulo: 'Pantalla 403' }],
    config: CFG,
  });
  assert.equal(d.tipo, ACCIONES.OCIOSO);
  assert.ok(d.averia, 'tiene que traer la avería');
  assert.equal(d.averia.pendientes, 2);
  assert.deepEqual(d.averia.nombres, ['Dos herramientas a la vez', 'Pantalla 403']);
  assert.match(d.porque, /AVER[ÍI]A/i);
});

test('la avería se explica en castellano llano, sin jerga', () => {
  const d = decidir({ estado: LIBRE, cuota: null, tareaDisponible: null,
    pendientesEnTablero: [{ id: 'a', titulo: 'Algo' }], config: CFG });
  assert.match(d.averia.motivo, /pendiente/);
  assert.ok(!/null|undefined|regex|parse/i.test(d.averia.motivo));
});

test('si hay tarea que coger no hay avería, aunque falte cuota', () => {
  const d = decidir({
    estado: LIBRE, cuota: { fiable: false }, tareaDisponible: { id: 'a', titulo: 'Algo' },
    pendientesEnTablero: [{ id: 'a', titulo: 'Algo' }], config: CFG,
  });
  assert.equal(d.tipo, ACCIONES.ESPERAR_CUOTA, 'esperar cuota es normal, no una avería');
  assert.equal(d.averia, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · El parte: la avería se dice, y «no hay nada» deja de mentir
// ─────────────────────────────────────────────────────────────────────────────

const CFG_PARTE = { vigia: { intervaloParteMs: 10800000 } };

test('la avería sale ARRIBA DEL TODO del parte', () => {
  const texto = redactar({
    estado: LIBRE, cuota: { fiable: true, sesionPct: 10, semanaPct: 5 }, historialReciente: [],
    tareaEnTablero: null, pendientesEnTablero: [{ id: 'a', titulo: 'Pantalla 403' }],
    averia: { clase: 'ocioso-con-tablero-lleno', pendientes: 1, nombres: ['Pantalla 403'], motivo: 'el tablero tiene 1 tarea(s) pendiente(s) y no consigo coger ninguna' },
    config: CFG_PARTE,
  });
  const lineas = texto.split('\n');
  const iAveria = lineas.findIndex((l) => /AVER[ÍI]A/.test(l));
  const iHecho = lineas.findIndex((l) => /Terminado/.test(l));
  assert.ok(iAveria > -1, 'la avería tiene que salir en el parte');
  assert.ok(iAveria < iHecho, 'y antes que lo terminado: es la única noticia que importa');
  assert.match(texto, /Pantalla 403/);
});

test('el parte NO dice «no ofrece ninguna tarea» habiendo pendientes', () => {
  const texto = redactar({
    estado: LIBRE, cuota: { fiable: true, sesionPct: 10, semanaPct: 5 }, historialReciente: [],
    tareaEnTablero: null, pendientesEnTablero: [{ id: 'a', titulo: 'X' }, { id: 'b', titulo: 'Y' }],
    averia: null, config: CFG_PARTE,
  });
  assert.ok(!/no ofrece ninguna tarea/.test(texto), 'ésa era la frase falsa del 31 ago');
  assert.match(texto, /2 pendiente/);
});

test('con el tablero de verdad vacío el parte lo puede decir tranquilo', () => {
  const texto = redactar({
    estado: LIBRE, cuota: { fiable: true, sesionPct: 10, semanaPct: 5 }, historialReciente: [],
    tareaEnTablero: null, pendientesEnTablero: [], averia: null, config: CFG_PARTE,
  });
  assert.match(texto, /no ofrece ninguna tarea/);
});

test('el aviso suelto de avería dice qué pasa y qué no se está cogiendo', () => {
  const t = redactarAveria({ motivo: 'el tablero tiene 4 tarea(s) pendiente(s) y no consigo coger ninguna', nombres: ['Una', 'Otra'], pendientes: 4 });
  assert.match(t, /parado, no ocioso/);
  assert.match(t, /Una/);
  assert.match(t, /y 2 más/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · La prueba de verdad: tres tareas encadenadas sin tocar nada
// ─────────────────────────────────────────────────────────────────────────────

const RELLENO = 'Se toca la capa de rutas siguiendo el patrón de validación que ya existe. '.repeat(20);

const TABLERO_TRES = `# Tablero de pruebas

## TAREA — Primera del encadenado

- **id:** primera-del-encadenado
- **estado:** pendiente

Hace falta una funcion que sume dos numeros y valide sus entradas.

## TAREA — Segunda del encadenado

- **id:** segunda-del-encadenado
- **estado:** pendiente

Hace falta una funcion que reste dos numeros y valide sus entradas.

## TAREA — Tercera del encadenado

- **id:** tercera-del-encadenado
- **estado:** pendiente

Hace falta una funcion que multiplique dos numeros y valide sus entradas.
`;

/** El guion de UNA tarea: análisis válido, un commit de verdad, veredicto aprobado. */
function guionDe(raiz, cfg, id, n) {
  const art = (s) => path.join(cfg.rutasAbs.artefactos, `task-${id}-${s}.md`);
  const criterios = ['Existe la funcion y devuelve el resultado correcto', 'Con entrada no numerica lanza un error claro', 'Hay una prueba que cubre los dos casos'];
  return [
    () => {
      fs.mkdirSync(cfg.rutasAbs.artefactos, { recursive: true });
      fs.writeFileSync(art('analysis'), `# Análisis\n\n${RELLENO}\n\n## Criterios de aceptación\n\n${criterios.map((c) => `- [ ] ${c}`).join('\n')}\n`);
      return respuestaOk('análisis escrito');
    },
    () => {
      fs.writeFileSync(path.join(raiz, `op${n}.js`), `export const op${n} = (a, b) => a + b;\n`);
      execFileSync('git', ['add', '-A'], { cwd: raiz });
      execFileSync('git', ['commit', '-qm', `Añade op${n}\n\nTarea: ${id}`], { cwd: raiz });
      return respuestaOk('construido');
    },
    () => {
      fs.writeFileSync(art('review'), `✅ APROBADO\n\n| # | Criterio | ¿Cumple? | Prueba |\n|---|---|---|---|\n${criterios.map((c, i) => `| ${i + 1} | ${c} | SÍ | op${n}.js:1 |`).join('\n')}\n`);
      return respuestaOk('revisado');
    },
  ];
}

test('cierra las TRES seguidas sin que nadie mueva ningún rótulo', async () => {
  const raiz = repoTemporal({ tablero: TABLERO_TRES });
  try {
    const cfg = configDe(raiz);
    const ids = ['primera-del-encadenado', 'segunda-del-encadenado', 'tercera-del-encadenado'];
    const guion = ids.flatMap((id, i) => guionDe(raiz, cfg, id, i + 1));

    const almacen = new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal, rutaHistorial: cfg.rutasAbs.historial });
    const ciclo = new Ciclo({ config: cfg, almacen, vigilante: vigilanteFalso(), logger: registroMudo(), invocador: invocadorFalso(guion) });

    let estado = almacen.recuperar().estado;
    const cerradas = [];
    const averias = [];
    for (let i = 0; i < 60 && cerradas.length < 3; i++) {
      const r = await ciclo.unPaso(estado);
      estado = r.estado;
      if (r.cerrada) cerradas.push(r.cerrada.id);
      if (r.averia) averias.push(r.averia);
    }

    assert.deepEqual(cerradas, ids, 'las tres, en el orden del documento, sin intervención');
    assert.deepEqual(averias, [], 'y sin dar ninguna falsa alarma por el camino');

    // El tablero quedó coherente: tres HECHA, ninguna pendiente, ningún titular que
    // diga una cosa y su cuerpo otra.
    const tablero = fs.readFileSync(cfg.tableroAbs, 'utf8');
    assert.equal((tablero.match(/✅ HECHA/g) || []).length, 3);
    assert.equal((tablero.match(/\*\*estado:\*\* hecha/g) || []).length, 3);
    assert.ok(!/\*\*estado:\*\* pendiente/.test(tablero));

    // Y ahora sí: el tablero está vacío de verdad, así que ocioso es ocioso.
    assert.equal(buscarSiguienteTarea(tablero), null);
    assert.deepEqual(tareasPendientes(tablero), []);
  } finally { limpiar(raiz); }
});

test('una tarea apartada se marca en el tablero y NO se vuelve a coger', async () => {
  // Sin esto, el arreglo del lector crea un bucle infinito: la apartada sigue diciendo
  // «pendiente» y se cogería en cada vuelta, para siempre.
  const raiz = repoTemporal({ tablero: TABLERO_TRES });
  try {
    const cfg = configDe(raiz);
    const almacen = new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal, rutaHistorial: cfg.rutasAbs.historial });
    // El arquitecto declara la primera mal planteada: se aparta sin gastar más ciclos.
    const guion = [
      () => {
        fs.mkdirSync(cfg.rutasAbs.artefactos, { recursive: true });
        fs.writeFileSync(path.join(cfg.rutasAbs.artefactos, 'task-primera-del-encadenado-analysis.md'),
          `# Análisis\n\n🛑 TAREA MAL PLANTEADA\n\nNo se puede hacer sin decidir antes qué promete al cliente.\n\n${RELLENO}\n`);
        return respuestaOk('paro');
      },
      ...guionDe(raiz, cfg, 'segunda-del-encadenado', 2),
    ];
    const ciclo = new Ciclo({ config: cfg, almacen, vigilante: vigilanteFalso(), logger: registroMudo(), invocador: invocadorFalso(guion) });

    let estado = almacen.recuperar().estado;
    const apartadas = [];
    const cerradas = [];
    for (let i = 0; i < 40 && cerradas.length < 1; i++) {
      const r = await ciclo.unPaso(estado);
      estado = r.estado;
      if (r.apartada) apartadas.push(r.apartada.tarea.id);
      if (r.cerrada) cerradas.push(r.cerrada.id);
    }

    assert.deepEqual(apartadas, ['primera-del-encadenado']);
    assert.deepEqual(cerradas, ['segunda-del-encadenado'], 'sigue con la siguiente, no se atasca en la apartada');

    const tablero = fs.readFileSync(cfg.tableroAbs, 'utf8');
    assert.match(tablero, /⛔ APARTADA/);
    assert.match(tablero, /\*\*estado:\*\* apartada/);
    // Y el lector ya no la ve: si la viera, volvería a cogerla en la vuelta siguiente.
    assert.ok(!tareasPendientes(tablero).some((t) => t.id === 'primera-del-encadenado'));
  } finally { limpiar(raiz); }
});

test('con el tablero lleno y el lector ciego, el ciclo AVISA en vez de callarse', async () => {
  // Se fuerza el desacuerdo a mano: todas las pendientes vetadas. Antes esto era
  // indistinguible de un tablero vacío, y ése fue exactamente el fallo del 31 ago.
  const raiz = repoTemporal({ tablero: TABLERO_TRES });
  try {
    const cfg = configDe(raiz);
    const almacen = new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal, rutaHistorial: cfg.rutasAbs.historial });
    const ciclo = new Ciclo({ config: cfg, almacen, vigilante: vigilanteFalso(), logger: registroMudo(), invocador: invocadorFalso([]) });

    let estado = almacen.recuperar().estado;
    estado.apartadas = [
      { id: 'primera-del-encadenado', titulo: 'Primera' },
      { id: 'segunda-del-encadenado', titulo: 'Segunda' },
      { id: 'tercera-del-encadenado', titulo: 'Tercera' },
    ];

    const r1 = await ciclo.unPaso(estado);
    assert.ok(r1.averia, 'la primera vuelta avisa');
    assert.equal(r1.averia.pendientes, 3);

    // Y NO repite el aviso cada minuto: sería un mensaje de Telegram por vuelta.
    const r2 = await ciclo.unPaso(r1.estado);
    assert.equal(r2.averia, null, 'no vuelve a avisar de lo mismo');
    assert.ok(r2.averiaViva, 'pero sigue constando como rota, para que salga en el parte');
  } finally { limpiar(raiz); }
});
