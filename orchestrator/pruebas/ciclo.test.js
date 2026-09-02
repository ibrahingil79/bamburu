// Integración: el ciclo entero contra un repo de usar y tirar y un modelo falso.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Almacen } from '../nucleo/almacen.js';
import { Ciclo } from '../ciclo.js';
import { PASOS } from '../nucleo/maquina.js';
import { repoTemporal, limpiar, configDe, registroMudo, vigilanteFalso, invocadorFalso, respuestaOk, TABLERO_BLOQUE } from './ayuda.js';

const RELLENO = 'Se toca la capa de rutas siguiendo el patrón de validación que ya existe. '.repeat(20);
const ANALISIS_BUENO = `# Análisis

${RELLENO}

## Criterios de aceptación

- [ ] Existe una funcion suma que devuelve la suma de dos numeros
- [ ] Con una entrada que no sea numero lanza un error claro
- [ ] Hay una prueba que ejercita los dos casos
- [ ] La funcion vive en su modulo y no en la capa de rutas
`;
const REVISION_OK = `✅ APROBADO

## ¿ARREGLA LO QUE LA TAREA DECÍA?

**Lo que decía la tarea que estaba mal:** lo que el enunciado daba por roto.
**¿Sigue siendo cierto hoy?:** NO — comprobado sobre el árbol.

| # | Criterio | ¿Cumple? | Prueba |
|---|---|---|---|
| 1 | Existe una funcion suma que devuelve la suma de dos numeros | SÍ | suma.js |
| 2 | Con una entrada que no sea numero lanza un error claro | SÍ | suma.js |
| 3 | Hay una prueba que ejercita los dos casos | SÍ | suma.js |
| 4 | La funcion vive en su modulo y no en la capa de rutas | SÍ | suma.js:1 |
`;
const REVISION_NO = `❌ RECHAZADO\n\n### CRITERIO-INCUMPLIDO Falta la validacion\n\n**Dónde:** suma.js:3\n**Qué pasa:** no comprueba el tipo.\n`;

function montar(raiz, guion, encima = {}) {
  const cfg = configDe(raiz, encima);
  const almacen = new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal, rutaHistorial: cfg.rutasAbs.historial });
  const inv = invocadorFalso(guion);
  const ciclo = new Ciclo({ config: cfg, almacen, vigilante: vigilanteFalso(), logger: registroMudo(), invocador: inv });
  return { cfg, almacen, ciclo, inv };
}

/** Guion: el arquitecto escribe análisis; el programador commitea; el revisor escribe veredicto. */
function guionCompleto(raiz, cfg, { revision = REVISION_OK, analisis = ANALISIS_BUENO } = {}) {
  const art = (n) => path.join(cfg.rutasAbs.artefactos, n);
  return [
    () => { fs.mkdirSync(cfg.rutasAbs.artefactos, { recursive: true }); fs.writeFileSync(art('task-sumar-dos-numeros-analysis.md'), analisis); return respuestaOk('análisis escrito'); },
    () => {
      fs.writeFileSync(path.join(raiz, 'suma.js'), 'export const suma = (a, b) => a + b;\n');
      execFileSync('git', ['add', '-A'], { cwd: raiz });
      execFileSync('git', ['commit', '-qm', 'Añade suma\n\nTarea: sumar-dos-numeros'], { cwd: raiz });
      return respuestaOk('construido');
    },
    () => { fs.writeFileSync(art('task-sumar-dos-numeros-review.md'), revision); return respuestaOk('revisado'); },
  ];
}

async function correr(ciclo, almacen, vueltas = 12) {
  let estado = almacen.recuperar().estado;
  const eventos = [];
  for (let i = 0; i < vueltas; i++) {
    const r = await ciclo.unPaso(estado);
    estado = r.estado;
    if (r.cerrada) eventos.push({ tipo: 'cerrada', tarea: r.cerrada });
    if (r.apartada) eventos.push({ tipo: 'apartada', ...r.apartada });
    if (!estado.tarea && (r.cerrada || r.apartada)) break;
  }
  return { estado, eventos };
}

test('completa una tarea entera sin intervención humana', async () => {
  const raiz = repoTemporal();
  try {
    const cfg0 = configDe(raiz);
    const { almacen, ciclo, cfg } = montar(raiz, guionCompleto(raiz, cfg0));
    const { estado, eventos } = await correr(ciclo, almacen);

    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].tipo, 'cerrada');
    assert.equal(estado.tarea, null, 'queda libre para la siguiente');

    // El tablero quedó marcado.
    const tablero = fs.readFileSync(cfg.tableroAbs, 'utf8');
    assert.match(tablero, /✅ HECHA/);
    assert.match(tablero, /\[x\] Existe una funcion suma/);
    // El titular y el cuerpo tienen que decir lo mismo: nada de «HECHA» arriba y
    // «pendiente» tres líneas más abajo.
    assert.match(tablero, /\*\*estado:\*\* hecha/);
    assert.ok(!/\*\*estado:\*\* pendiente/.test(tablero), 'no queda ninguna contradicción en el bloque');

    // Hay registro de la tarea.
    const reg = path.join(cfg.rutasAbs.registrosTarea, 'sumar-dos-numeros.md');
    assert.ok(fs.existsSync(reg));
    assert.match(fs.readFileSync(reg, 'utf8'), /✅ APROBADA/);

    // Y está confirmado en git.
    const log = execFileSync('git', ['log', '--oneline'], { cwd: raiz, encoding: 'utf8' });
    assert.match(log, /cierra «Sumar dos numeros»/);

    // Historial.
    const h = almacen.leerHistorial();
    assert.equal(h.at(-1).resultado, 'cerrada');
  } finally { limpiar(raiz); }
});

test('un análisis sin criterios se rechaza y se REPITE', async () => {
  const raiz = repoTemporal();
  try {
    const cfg0 = configDe(raiz);
    const art = path.join(cfg0.rutasAbs.artefactos, 'task-sumar-dos-numeros-analysis.md');
    const guion = [
      () => { fs.mkdirSync(path.dirname(art), { recursive: true }); fs.writeFileSync(art, `# Análisis\n\n${RELLENO}\n`); return respuestaOk('sin criterios'); },
      () => { fs.writeFileSync(art, ANALISIS_BUENO); return respuestaOk('ahora sí'); },
      ...guionCompleto(raiz, cfg0).slice(1),
    ];
    const { almacen, ciclo, inv } = montar(raiz, guion);
    const { eventos } = await correr(ciclo, almacen);

    assert.equal(eventos[0]?.tipo, 'cerrada');
    // El arquitecto fue llamado DOS veces, y la segunda con el motivo delante.
    const arq = inv.llamadas.filter((l) => l.prompt.includes('Papel: ARQUITECTO'));
    assert.equal(arq.length, 2);
    assert.match(arq[1].prompt, /NO TRAE CRITERIOS DE ACEPTACIÓN/);
  } finally { limpiar(raiz); }
});

test('tres rechazos disparan REPLANTEAMIENTO, no un cuarto intento igual', async () => {
  const raiz = repoTemporal();
  try {
    const cfg0 = configDe(raiz);
    const art = (n) => path.join(cfg0.rutasAbs.artefactos, n);
    const escribeAnalisis = () => { fs.mkdirSync(cfg0.rutasAbs.artefactos, { recursive: true }); fs.writeFileSync(art('task-sumar-dos-numeros-analysis.md'), ANALISIS_BUENO); return respuestaOk('análisis'); };
    let n = 0;
    const construye = () => {
      fs.writeFileSync(path.join(raiz, `f${++n}.js`), `export const x${n} = ${n};\n`);
      execFileSync('git', ['add', '-A'], { cwd: raiz });
      execFileSync('git', ['commit', '-qm', `Intento ${n}\n\nTarea: sumar-dos-numeros`], { cwd: raiz });
      return respuestaOk('construido');
    };
    const rechaza = () => { fs.writeFileSync(art('task-sumar-dos-numeros-review.md'), REVISION_NO); return respuestaOk('rechazado'); };

    const guion = [escribeAnalisis, construye, rechaza, construye, rechaza, construye, rechaza,
                   escribeAnalisis, construye, rechaza, construye, rechaza, construye, rechaza];
    const { almacen, ciclo, inv } = montar(raiz, guion);
    const { eventos, estado } = await correr(ciclo, almacen, 40);

    const arq = inv.llamadas.filter((l) => l.prompt.includes('Papel: ARQUITECTO'));
    assert.equal(arq.length, 2, 'el arquitecto vuelve a entrar: eso es el replanteamiento');
    assert.match(arq[1].prompt, /ESTO ES UN REPLANTEAMIENTO/);
    assert.match(arq[1].prompt, /Lo que ya se intentó/);

    assert.equal(eventos.at(-1)?.tipo, 'apartada', 'replanteada y sigue fallando: se aparta');
    assert.equal(estado.tarea, null, 'y el sistema queda libre para la siguiente');
    assert.equal(estado.apartadas.length, 1);
  } finally { limpiar(raiz); }
});

test('lo RECHAZADO no se sube nunca', async () => {
  const raiz = repoTemporal();
  try {
    const cfg0 = configDe(raiz, { subida: { activa: true } });
    const art = (n) => path.join(cfg0.rutasAbs.artefactos, n);
    let n = 0;
    const analiza = () => { fs.mkdirSync(cfg0.rutasAbs.artefactos, { recursive: true }); fs.writeFileSync(art('task-sumar-dos-numeros-analysis.md'), ANALISIS_BUENO); return respuestaOk(); };
    const construye = () => { fs.writeFileSync(path.join(raiz, `g${++n}.js`), `export const y${n}=${n};\n`); execFileSync('git', ['add', '-A'], { cwd: raiz }); execFileSync('git', ['commit', '-qm', `I${n}\n\nTarea: sumar-dos-numeros`], { cwd: raiz }); return respuestaOk(); };
    const rechaza = () => { fs.writeFileSync(art('task-sumar-dos-numeros-review.md'), REVISION_NO); return respuestaOk(); };
    // 3 rechazos → replanteo → 3 rechazos más → apartada. Nunca hay aprobación.
    const guion = [analiza, construye, rechaza, construye, rechaza, construye, rechaza,
                   analiza, construye, rechaza, construye, rechaza, construye, rechaza];
    const { almacen, ciclo } = montar(raiz, guion, { subida: { activa: true } });
    const { eventos } = await correr(ciclo, almacen, 40);

    assert.equal(eventos.at(-1)?.tipo, 'apartada');
    // El repo no tiene remoto: si hubiera intentado subir, habría fallado y quedaría constancia.
    // Lo que se comprueba es que ni siquiera lo intentó, porque nunca hubo aprobación.
    assert.equal(almacen.recuperar().estado.subidaPendiente, false, 'no hay nada pendiente de subir: no se aprobó nada');
  } finally { limpiar(raiz); }
});

test('una subida fallida se registra, se avisa y el ciclo SIGUE', async () => {
  const raiz = repoTemporal();
  try {
    const cfg0 = configDe(raiz, { subida: { activa: true } });
    // Sin remoto configurado, el push falla. Es exactamente el caso "sin red".
    const { almacen, ciclo } = montar(raiz, guionCompleto(raiz, cfg0), { subida: { activa: true } });
    const { estado, eventos } = await correr(ciclo, almacen);

    assert.equal(eventos[0]?.tipo, 'cerrada', 'la tarea se cierra igual');
    assert.equal(estado.subidaPendiente, true, 'queda constancia de que falta subir');
    assert.ok(estado.ultimoFalloSubida?.motivo, 'y con su motivo escrito');
    assert.equal(estado.tarea, null, 'el ciclo sigue libre para la siguiente');
    const h = almacen.leerHistorial().at(-1);
    assert.equal(h.subida, false);
  } finally { limpiar(raiz); }
});

test('si el tablero cambia mientras corre, no se pisa lo que no es suyo', async () => {
  const raiz = repoTemporal();
  try {
    const cfg0 = configDe(raiz);
    const guion = guionCompleto(raiz, cfg0);
    // El revisor aprueba, pero justo antes alguien reescribe el tablero.
    const original = guion[2];
    guion[2] = (o, l) => {
      fs.writeFileSync(path.join(raiz, 'TABLERO.md'), '# Tablero\n\n## SIGUIENTE TAREA — Otra cosa distinta\n\n- **id:** otra-cosa\n');
      return original(o, l);
    };
    const { almacen, ciclo, cfg } = montar(raiz, guion);
    const { eventos } = await correr(ciclo, almacen);

    assert.equal(eventos[0]?.tipo, 'cerrada', 'la tarea se cierra igual: el trabajo estaba hecho');
    const tablero = fs.readFileSync(cfg.tableroAbs, 'utf8');
    assert.match(tablero, /Otra cosa distinta/, 'lo que escribió el humano sigue ahí');
    assert.ok(!/✅ HECHA/.test(tablero), 'y NO se ha pisado con la marca de hecha');
  } finally { limpiar(raiz); }
});

test('sin cuota a mitad: espera, y al volver retoma en el MISMO paso', async () => {
  const raiz = repoTemporal();
  try {
    const cfg0 = configDe(raiz);
    const { almacen, ciclo } = montar(raiz, guionCompleto(raiz, cfg0));
    let estado = almacen.recuperar().estado;

    estado = (await ciclo.unPaso(estado)).estado;   // toma tarea
    estado = (await ciclo.unPaso(estado)).estado;   // arquitecto
    estado = (await ciclo.unPaso(estado)).estado;   // valida → pasa a CONSTRUCCION
    const pasoAntes = estado.paso;
    const baseAntes = estado.base;

    ciclo.vigilante.valor = { fiable: true, sesionPct: 99, semanaPct: 5 };   // se agota
    const r = await ciclo.unPaso(estado);
    assert.equal(r.estado.esperandoCuota, true, 'queda marcado como en espera');
    assert.equal(r.estado.paso, pasoAntes, 'y el PASO REAL no se machaca: es por donde se retoma');
    assert.equal(r.estado.base, baseAntes);
    assert.ok(r.espera > 0);

    ciclo.vigilante.valor = { fiable: true, sesionPct: 10, semanaPct: 5 };   // vuelve
    const r2 = await ciclo.unPaso(r.estado);
    assert.equal(r2.estado.esperandoCuota, false, 'deja de esperar');
    assert.equal(r2.estado.base, baseAntes, 'no se perdió la referencia de commits');
  } finally { limpiar(raiz); }
});
