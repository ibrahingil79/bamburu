// El orquestador recoge las órdenes de la bandeja y las aplica. Integración, con repo real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Almacen, anadirLinea, leerLineas } from '../nucleo/almacen.js';
import { Ciclo } from '../ciclo.js';
import { ORDENES } from '../vigia/ordenes.js';
import { tareasPendientes } from '../reader.js';
import { repoTemporal, limpiar, configDe, registroMudo, vigilanteFalso, invocadorFalso, respuestaOk } from './ayuda.js';

const RELLENO = 'Se toca la capa de rutas siguiendo el patrón de validación que ya existe. '.repeat(20);
const CRIT = ['Existe la funcion y devuelve el resultado correcto', 'Con entrada no numerica lanza un error claro', 'Hay una prueba que cubre los dos casos'];

const TABLERO_DOS = `# Tablero de pruebas

## TAREA — La primera

- **id:** la-primera
- **estado:** pendiente

Hace falta una funcion que sume dos numeros y valide sus entradas.

## TAREA — La segunda

- **id:** la-segunda
- **estado:** pendiente

Hace falta una funcion que reste dos numeros y valide sus entradas.
`;

function guionDe(raiz, cfg, id, n) {
  const art = (s) => path.join(cfg.rutasAbs.artefactos, `task-${id}-${s}.md`);
  return [
    () => {
      fs.mkdirSync(cfg.rutasAbs.artefactos, { recursive: true });
      fs.writeFileSync(art('analysis'), `# Análisis\n\n${RELLENO}\n\n## Criterios de aceptación\n\n${CRIT.map((c) => `- [ ] ${c}`).join('\n')}\n`);
      return respuestaOk('análisis');
    },
    () => {
      fs.writeFileSync(path.join(raiz, `f${n}.js`), `export const f${n} = () => ${n};\n`);
      execFileSync('git', ['add', '-A'], { cwd: raiz });
      execFileSync('git', ['commit', '-qm', `Hace ${id}\n\nTarea: ${id}`], { cwd: raiz });
      return respuestaOk('construido');
    },
    () => {
      fs.writeFileSync(art('review'), `✅ APROBADO\n\n| # | Criterio | ¿Cumple? | Prueba |\n|---|---|---|---|\n${CRIT.map((c, i) => `| ${i + 1} | ${c} | SÍ | f${n}.js:1 |`).join('\n')}\n`);
      return respuestaOk('revisado');
    },
  ];
}

function montar(raiz, guion) {
  const cfg = configDe(raiz);
  const almacen = new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal, rutaHistorial: cfg.rutasAbs.historial });
  const ciclo = new Ciclo({ config: cfg, almacen, vigilante: vigilanteFalso(), logger: registroMudo(), invocador: invocadorFalso(guion) });
  return { cfg, almacen, ciclo };
}

const ordenar = (cfg, orden, id = null) =>
  anadirLinea(cfg.rutasAbs.ordenes, { cuando: new Date().toISOString(), orden, id, de: 'telegram' });

async function vueltas(ciclo, almacen, n, alPaso = () => {}) {
  let estado = almacen.recuperar().estado;
  const todo = [];
  for (let i = 0; i < n; i++) {
    const r = await ciclo.unPaso(estado);
    estado = r.estado;
    todo.push(r);
    if (alPaso(r, estado, i) === 'basta') break;
  }
  return { estado, todo };
}

test('«para» termina la tarea en curso y NO coge la siguiente', async () => {
  const raiz = repoTemporal({ tablero: TABLERO_DOS });
  try {
    const { cfg, almacen, ciclo } = montar(raiz, [...guionDe(raiz, cfg0(raiz), 'la-primera', 1), ...guionDe(raiz, cfg0(raiz), 'la-segunda', 2)]);
    // Se pide parar en cuanto ha cogido la primera: la promesa es que la TERMINA.
    let pedido = false;
    const { estado, todo } = await vueltas(ciclo, almacen, 40, (r, e) => {
      if (!pedido && e.tarea) { ordenar(cfg, ORDENES.PARAR); pedido = true; }
    });

    const cerradas = todo.filter((r) => r.cerrada).map((r) => r.cerrada.id);
    assert.deepEqual(cerradas, ['la-primera'], 'termina la que tenía entre manos');
    assert.equal(estado.pausado, true);
    assert.equal(estado.tarea, null);
    // Y con la segunda ahí delante, no la coge.
    const tab = fs.readFileSync(cfg.tableroAbs, 'utf8');
    assert.ok(tareasPendientes(tab).some((t) => t.id === 'la-segunda'), 'la segunda sigue pendiente');
    assert.ok(todo.some((r) => (r.avisos || []).some((a) => /Termino/.test(a))), 'y te lo dice');
  } finally { limpiar(raiz); }
});

function cfg0(raiz) { return configDe(raiz); }

test('«arranca» la vuelve a poner en marcha', async () => {
  const raiz = repoTemporal({ tablero: TABLERO_DOS });
  try {
    const { cfg, almacen, ciclo } = montar(raiz, [...guionDe(raiz, cfg0(raiz), 'la-primera', 1), ...guionDe(raiz, cfg0(raiz), 'la-segunda', 2)]);
    let estado = almacen.recuperar().estado;
    estado = almacen.transicion(estado, { tipo: 'PAUSADO' });

    // Pausado: no coge nada por muchas vueltas que dé.
    let r = await ciclo.unPaso(estado);
    assert.equal(r.estado.tarea, null, 'pausado no coge tarea');
    assert.equal(r.averia, undefined, 'y pausado NO es una avería: se lo pidió él');

    ordenar(cfg, ORDENES.ARRANCAR);
    r = await ciclo.unPaso(r.estado);
    assert.equal(r.estado.pausado, false);
    assert.ok(r.estado.tarea, 'en cuanto arranca, coge la primera');
    assert.equal(r.estado.tarea.id, 'la-primera');
  } finally { limpiar(raiz); }
});

test('«saltar» suelta la tarea, la deja recuperable y sigue con la siguiente', async () => {
  const raiz = repoTemporal({ tablero: TABLERO_DOS });
  try {
    const { cfg, almacen, ciclo } = montar(raiz, [...guionDe(raiz, cfg0(raiz), 'la-segunda', 2)]);
    let estado = almacen.recuperar().estado;

    // Coge la primera…
    let r = await ciclo.unPaso(estado);
    assert.equal(r.estado.tarea.id, 'la-primera');

    // …y se la saltamos. En la MISMA vuelta la suelta y coge la siguiente: eso es
    // exactamente lo que promete «salta esta tarea».
    ordenar(cfg, ORDENES.SALTAR);
    r = await ciclo.unPaso(r.estado);
    assert.ok(r.avisos.some((a) => /Saltada/.test(a)));
    assert.deepEqual(r.estado.apartadas.map((a) => a.id), ['la-primera'], 'queda recuperable, no perdida');
    assert.equal(r.estado.tarea.id, 'la-segunda', 'y sigue con la siguiente sin que nadie se lo diga');

    // En el tablero queda marcada: si no, la volvería a coger en la vuelta siguiente.
    const tab = fs.readFileSync(cfg.tableroAbs, 'utf8');
    assert.match(tab, /⛔ APARTADA/);
    assert.ok(!tareasPendientes(tab).some((t) => t.id === 'la-primera'));
  } finally { limpiar(raiz); }
});

test('«desapartar» la devuelve al montón y se vuelve a coger', async () => {
  const raiz = repoTemporal({ tablero: TABLERO_DOS });
  try {
    const { cfg, almacen, ciclo } = montar(raiz, guionDe(raiz, cfg0(raiz), 'la-segunda', 2));
    let estado = almacen.recuperar().estado;

    let r = await ciclo.unPaso(estado);          // coge la primera
    ordenar(cfg, ORDENES.SALTAR);
    r = await ciclo.unPaso(r.estado);            // la salta → apartada, y coge la segunda
    assert.deepEqual(r.estado.apartadas.map((a) => a.id), ['la-primera']);

    ordenar(cfg, ORDENES.DESAPARTAR, 'la-primera');
    r = await ciclo.unPaso(r.estado);
    assert.ok(r.avisos.some((a) => /vuelve a estar pendiente/.test(a)));
    assert.deepEqual(r.estado.apartadas, [], 'ya no está apartada');

    const tab = fs.readFileSync(cfg.tableroAbs, 'utf8');
    assert.ok(!/⛔ APARTADA/.test(tab), 'la marca se fue del tablero');
    assert.match(tab, /## TAREA — La primera/, 'y el encabezado volvió a lo que era');
    assert.match(tab, /Desapartada el .* a petición de Ibrahin/, 'con el rastro de por qué volvió');
    assert.ok(tareasPendientes(tab).some((t) => t.id === 'la-primera'), 'vuelve a estar pendiente');
  } finally { limpiar(raiz); }
});

test('una orden se aplica UNA vez, aunque el daemon dé mil vueltas', async () => {
  const raiz = repoTemporal({ tablero: TABLERO_DOS });
  try {
    const { cfg, almacen, ciclo } = montar(raiz, []);
    let estado = almacen.recuperar().estado;
    ordenar(cfg, ORDENES.PARAR);

    let avisos = 0;
    for (let i = 0; i < 5; i++) {
      const r = await ciclo.unPaso(estado);
      estado = r.estado;
      avisos += (r.avisos || []).length;
    }
    assert.equal(avisos, 1, 'la orden se contesta una sola vez');
    assert.equal(estado.ordenesLeidas, 1);
  } finally { limpiar(raiz); }
});

test('una orden que revienta no se lleva por delante el ciclo', async () => {
  const raiz = repoTemporal({ tablero: TABLERO_DOS });
  try {
    const { cfg, almacen, ciclo } = montar(raiz, [...guionDe(raiz, cfg0(raiz), 'la-primera', 1)]);
    // Una orden con un id que no existe: no puede tumbar nada.
    ordenar(cfg, ORDENES.DESAPARTAR, 'no-existe-esta');
    const estado = almacen.recuperar().estado;
    const r = await ciclo.unPaso(estado);
    assert.ok(r.avisos.some((a) => /No tengo ninguna tarea apartada/.test(a)));
    assert.ok(r.estado.tarea, 'y la vuelta sigue: coge tarea igual');
  } finally { limpiar(raiz); }
});
