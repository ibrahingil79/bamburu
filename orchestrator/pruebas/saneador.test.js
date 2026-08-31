// El sistema arregla el formato del tablero solo. Nunca se lo pasa a Ibrahin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticar, sanear, REGLAS } from '../tablero/saneador.js';
import { buscarSiguienteTarea } from '../reader.js';

const DOS_SIGUIENTES = `# Tablero

## SIGUIENTE TAREA — La primera

- **id:** la-primera

Texto de la primera.

## SIGUIENTE TAREA — La segunda

- **id:** la-segunda

Texto de la segunda.
`;

test('R1 · con dos rótulos de siguiente, gana el primero del documento', () => {
  const d = diagnosticar(DOS_SIGUIENTES);
  assert.equal(d.problemas.filter((p) => p.regla === 'R1').length, 1);

  const r = sanear(DOS_SIGUIENTES);
  assert.equal(r.cambiado, true);
  assert.match(r.texto, /## SIGUIENTE TAREA — La primera/);
  assert.match(r.texto, /## TAREA — La segunda/);
  assert.ok(!/## SIGUIENTE TAREA — La segunda/.test(r.texto));
  // Y el lector coge la que toca.
  assert.equal(buscarSiguienteTarea(r.texto).id, 'la-primera');
});

test('R1 · el arreglo se explica en castellano llano', () => {
  const { arreglos } = sanear(DOS_SIGUIENTES);
  assert.match(arreglos[0].que, /La segunda/);
  assert.match(arreglos[0].comoQueda, /sigue pendiente/);
  assert.ok(!/regex|parse|null|undefined/i.test(arreglos[0].que + arreglos[0].comoQueda));
});

test('R3 · una tarea sin identificador recibe uno sacado de su título', () => {
  const sin = `# T\n\n## SIGUIENTE TAREA — Arreglar el portal del cliente\n\nTexto.\n`;
  assert.equal(diagnosticar(sin).problemas.filter((p) => p.regla === 'R3').length, 1);
  const r = sanear(sin);
  assert.match(r.texto, /- \*\*id:\*\* arreglar-el-portal-del-cliente/);
  assert.equal(buscarSiguienteTarea(r.texto).id, 'arreglar-el-portal-del-cliente');
});

test('R4 · dos tareas con el mismo identificador se separan', () => {
  const dup = `# T

## SIGUIENTE TAREA — Una

- **id:** repetida

## TAREA — Otra

- **id:** repetida
`;
  assert.equal(diagnosticar(dup).problemas.filter((p) => p.regla === 'R4').length, 1);
  const r = sanear(dup);
  assert.match(r.texto, /- \*\*id:\*\* repetida\n/);
  assert.match(r.texto, /- \*\*id:\*\* repetida-2/);
});

test('R5 · un rótulo sin título se completa con el texto del propio bloque', () => {
  const vacio = `# T\n\n## SIGUIENTE TAREA\n\n- **id:** x\n\nHay que separar los bloqueos de la base.\n`;
  const r = sanear(vacio);
  assert.match(r.texto, /## SIGUIENTE TAREA — Hay que separar los bloqueos de la base\./);
});

test('R6 · «A LA ESPERA DE ENCARGO» no se coge como tarea: se anota', () => {
  const t = `# T

> SIGUIENTE TAREA OFICIAL: A LA ESPERA DE ENCARGO para delimitar el siguiente saneamiento.

## SIGUIENTE TAREA — La de verdad

- **id:** la-de-verdad
`;
  const r = sanear(t);
  assert.equal(r.cambiado, false, 'la prosa NO se reescribe');
  assert.equal(r.anotados.length, 1);
  assert.equal(r.anotados[0].regla, 'R6');
  assert.equal(buscarSiguienteTarea(r.texto).id, 'la-de-verdad');
});

test('R2 · prosa con rótulo habiendo encabezado: se deja y se anota', () => {
  const t = `# T\n\n> SIGUIENTE TAREA OFICIAL: aislar los bloqueos SQLite\n\n## SIGUIENTE TAREA — Otra cosa\n\n- **id:** otra-cosa\n`;
  const r = sanear(t);
  assert.equal(r.cambiado, false);
  assert.equal(r.anotados[0].regla, 'R2');
  assert.match(r.anotados[0].comoQueda, /manda el encabezado/);
});

test('un tablero ya sano no se toca', () => {
  const sano = `# T\n\n## SIGUIENTE TAREA — Una\n\n- **id:** una\n\nTexto.\n`;
  const r = sanear(sano);
  assert.equal(r.cambiado, false);
  assert.equal(r.texto, sano, 'ni un byte distinto');
  assert.equal(diagnosticar(sano).problemas.length, 0);
});

test('sanear es idempotente: pasarlo dos veces da lo mismo', () => {
  const una = sanear(DOS_SIGUIENTES).texto;
  const dos = sanear(una);
  assert.equal(dos.cambiado, false);
  assert.equal(dos.texto, una);
});

test('cada regla lleva escrito qué hace y por qué', () => {
  assert.ok(REGLAS.length >= 6);
  for (const r of REGLAS) {
    assert.ok(r.que && r.hace && r.porque, `la regla ${r.id} está incompleta`);
    assert.ok(r.porque.length > 40, `la regla ${r.id} no explica el motivo`);
  }
});

test('la prosa partida en dos líneas se cose antes de juzgarla', async () => {
  // Es el caso REAL del TABLERO: la línea acaba en «: A» y sigue abajo con «LA ESPERA…».
  const partido = `# T

> Fase de saneamiento aún ACTIVA. **SIGUIENTE TAREA OFICIAL: A
> LA ESPERA DE ENCARGO para delimitar el siguiente saneamiento.**

## SIGUIENTE TAREA — La de verdad

- **id:** la-de-verdad
`;
  const r = sanear(partido);
  assert.equal(r.anotados[0].regla, 'R6', 'cosida, se ve que NO es una tarea');
  assert.match(r.anotados[0].que, /A LA ESPERA DE ENCARGO/);
  assert.equal(r.cambiado, false);
});

test('sin ningún encabezado, el lector NO coge una frase que no es tarea', async () => {
  const { buscarSiguienteTarea } = await import('../reader.js');
  const soloProsa = `# T\n\n> **SIGUIENTE TAREA OFICIAL: A\n> LA ESPERA DE ENCARGO para delimitar el siguiente saneamiento.**\n`;
  assert.equal(buscarSiguienteTarea(soloProsa), null, 'mejor ocioso que trabajar sobre una frase');
});

test('sin encabezado pero con una tarea de verdad en prosa, sí la coge', async () => {
  const { buscarSiguienteTarea } = await import('../reader.js');
  const t = `# T\n\n> SIGUIENTE TAREA OFICIAL: aislamiento de bloqueos SQLite — a delimitar.\n`;
  const x = buscarSiguienteTarea(t);
  assert.ok(x, 'no se ha vuelto ciego para lo que sí es una tarea');
  assert.match(x.titulo, /aislamiento de bloqueos SQLite/);
});
