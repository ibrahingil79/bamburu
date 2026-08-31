// updater.js — Lo único que escribe en el repo: el análisis vacío, el TABLERO y el feedback.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MARCA_INICIO, MARCA_FIN } from './validator.js';
import { marcaTiempo } from './dispatcher.js';

const hoy = () => new Date().toISOString().slice(0, 10);

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Deja el fichero de análisis creado y vacío de contenido propio.
 * Si ya tiene trabajo escrito, no lo pisa: se avisa y se sigue.
 */
export function crearAnalisisVacio({ ruta, tarea, dryRun, registro }) {
  if (fs.existsSync(ruta) && fs.readFileSync(ruta, 'utf8').trim().length > 0) {
    registro.aviso(`Ya existía ${path.relative(process.cwd(), ruta)}: no lo piso.`);
    return false;
  }
  if (dryRun) {
    registro.info(`[simulacro] crearía ${ruta}`);
    return true;
  }

  const criterios = tarea.criterios.length
    ? tarea.criterios.map((c) => `- [${c.hecho ? 'x' : ' '}] ${c.texto}`).join('\n')
    : '- (el tablero no lista criterios)';

  const contenido = `# Análisis — ${tarea.titulo}

${MARCA_INICIO}
> **Plantilla del orquestador.** Todo lo que hay entre estas dos marcas NO cuenta como
> análisis: bórralo o déjalo, da igual, pero escribe tu trabajo fuera de aquí.
>
> - **taskId:** \`${tarea.id}\`
> - **Origen:** TABLERO.md, línea ${tarea.linea}
> - **Descripción:** ${tarea.descripcion}
>
> **Criterios de aceptación**
>
${criterios.split('\n').map((l) => '> ' + l).join('\n')}
>
> **Mínimos para pasar la comprobación:** más de 500 caracteres propios y que aparezca
> alguna de «capa», «patrón», «validación», «arquitectura».
>
> **Secciones que se esperan:** 1) qué falla hoy y dónde · 2) capa y patrón · 3) decisión y
> alternativas descartadas · 4) qué se toca, fichero a fichero · 5) qué queda fuera ·
> 6) cómo se comprueba.
${MARCA_FIN}

`;
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido, 'utf8');
  return true;
}

/**
 * Marca la tarea como HECHA en TABLERO.md.
 *
 * Solo reescribe cuando la tarea venía de un bloque «## SIGUIENTE TAREA», que tiene
 * principio y fin claros. Si venía de una línea de prosa dentro de una cita, NO se toca
 * el documento: reescribir prosa a ciegas en un fichero de 680 KB no es automatizable.
 * En ese caso se deja el texto escrito aparte para pegarlo a mano.
 */
export function marcarHecha({ rutaTablero, tarea, commits, rutas, dirLogs, dryRun, hacerCommit, registro, cwd }) {
  const shas = commits.map((c) => `\`${c.corto}\``).join(', ') || '(ninguno)';
  const rel = (p) => path.relative(cwd, p);

  const registroTarea = [
    '',
    `> **Cerrada por el orquestador el ${hoy()}.**`,
    `> Commits: ${shas}`,
    `> Análisis: \`${rel(rutas.analisis)}\``,
    `> Revisión: \`${rel(rutas.review)}\` — ✅ APROBADO`,
    '',
  ].join('\n');

  if (tarea.origen === 'prosa') {
    const destino = path.join(path.dirname(rutas.analisis), `task-${tarea.id}-HECHA.md`);
    registro.aviso('La tarea venía de una línea de prosa, no de un bloque «## SIGUIENTE TAREA».');
    registro.aviso('No reescribo TABLERO.md a ciegas. Te dejo el texto para pegarlo tú.');
    if (!dryRun) {
      fs.writeFileSync(
        destino,
        `# ${tarea.titulo} — HECHA (${hoy()})\n\nPega esto en TABLERO.md, línea ${tarea.linea}:\n${registroTarea}\n`,
        'utf8',
      );
      registro.info(`Texto en: ${rel(destino)}`);
    }
    return { escrito: false, motivo: 'origen-prosa' };
  }

  const texto = fs.readFileSync(rutaTablero, 'utf8');
  const pos = texto.indexOf(tarea.bruto);
  if (pos === -1) {
    registro.error('El bloque de la tarea ya no está tal cual en TABLERO.md (alguien lo editó durante la ejecución).');
    registro.error('No lo reescribo: podría machacar ese cambio. Ciérralo a mano.');
    return { escrito: false, motivo: 'bloque-cambiado' };
  }

  const lineas = tarea.bruto.split('\n');
  lineas[0] = lineas[0]
    .replace(/^(#{1,6})\s+.*$/, (_, h) => `${h} ✅ HECHA (${hoy()}) — ${tarea.titulo} · ${shas}`);
  const nuevoBloque = lineas
    .map((l) => l.replace(/^(\s*[-*+]\s*)\[ \]/, '$1[x]'))
    .join('\n')
    .replace(/\s*$/, '') + '\n' + registroTarea;

  const nuevoTexto = texto.slice(0, pos) + nuevoBloque + texto.slice(pos + tarea.bruto.length);

  if (dryRun) {
    registro.info('[simulacro] TABLERO.md quedaría así en ese bloque:');
    registro.detalle(nuevoBloque.split('\n').map((l) => '      │ ' + l).join('\n'));
    return { escrito: false, motivo: 'simulacro' };
  }

  fs.mkdirSync(dirLogs, { recursive: true });
  const copia = path.join(dirLogs, `TABLERO-antes-de-${tarea.id}-${marcaTiempo()}.md`);
  fs.copyFileSync(rutaTablero, copia);
  registro.info(`Copia previa del tablero: ${rel(copia)}`);

  fs.writeFileSync(rutaTablero, nuevoTexto, 'utf8');
  registro.exito(`TABLERO.md actualizado: «${tarea.titulo}» queda HECHA.`);

  if (!hacerCommit) {
    registro.info('Sin commit (--sin-commit). Para confirmarlo tú:');
    registro.info(`    git commit -m "TABLERO — ${tarea.titulo} queda HECHA (${tarea.id})" --only -- TABLERO.md`);
    return { escrito: true };
  }

  try {
    const mensaje = `TABLERO — ${tarea.titulo} queda HECHA (${tarea.id})`;
    git(['commit', '-m', mensaje, '--only', '--', 'TABLERO.md'], cwd);
    registro.exito(`Commit del tablero hecho: ${git(['rev-parse', '--short', 'HEAD'], cwd).trim()}`);
  } catch (e) {
    registro.aviso(`No se pudo confirmar el tablero: ${String(e.message).split('\n')[0]}`);
    registro.aviso('El fichero YA está actualizado en el árbol de trabajo. Confírmalo a mano.');
  }
  return { escrito: true };
}

/** Cuando la revisión rechaza: el feedback, entero y sin resumir, en un fichero. */
export function escribirFeedback({ ruta, tarea, revision, base, dryRun, registro, cwd }) {
  const contenido = `# Feedback — ${tarea.titulo}

- **taskId:** \`${tarea.id}\`
- **Fecha:** ${hoy()}
- **Veredicto:** ❌ RECHAZADO

## Qué dijo la revisión

${revision.trim()}

## Qué toca ahora

1. Corregir lo de arriba, punto por punto.
2. Confirmar con un commit cuyo mensaje contenga \`${tarea.id}\`.
3. Volver a lanzar, contando los commits desde antes de los arreglos:
   \`npm run orchestrate -- --task=${tarea.id} --desde=${(base || 'HEAD').slice(0, 7)}\`

El análisis pactado sigue siendo el bueno mientras nadie lo cambie.
`;
  if (dryRun) {
    registro.info(`[simulacro] escribiría el feedback en ${ruta}`);
    return;
  }
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido, 'utf8');
  registro.info(`Feedback en: ${path.relative(cwd, ruta)}`);
}
