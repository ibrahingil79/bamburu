// cierre.js — Cerrar una tarea aprobada: registro, tablero, commit y subida.
//
// Regla que manda: ENTERO O NADA. Se escribe primero todo lo que va al disco, y solo cuando
// está entero se confirma en un único commit. Si la subida falla, el commit YA está hecho
// y queda pendiente de subir: eso no es "a medias", es "hecho y sin publicar", que es un
// estado legítimo del que se sale reintentando.
import fs from 'node:fs';
import path from 'node:path';
import { escribirAtomico } from '../nucleo/almacen.js';
import { confirmar, anadir, subir } from './git.js';

const hoy = () => new Date().toISOString().slice(0, 10);
const ahora = () => new Date().toISOString();

/** El registro de la tarea: qué se pidió, qué se hizo, cuánto costó. Se escribe siempre. */
export function escribirRegistroTarea({ config, tarea, estado, rutas, commits, criterios, consumo, apartada = null }) {
  const dir = config.rutasAbs.registrosTarea;
  const ruta = path.join(dir, `${tarea.id}.md`);
  const rel = (p) => path.relative(config.repo.raiz, p);

  const historial = estado.historial.length
    ? estado.historial.map((h) => `| ${h.intento} | ${h.veredicto} | ${(h.motivos || []).join('; ').slice(0, 200) || '—'} |`).join('\n')
    : '| 1 | aprobado a la primera | — |';

  const texto = `# ${tarea.titulo}

- **id:** \`${tarea.id}\`
- **cerrada:** ${hoy()}
- **resultado:** ${apartada ? `⛔ APARTADA — ${apartada}` : '✅ APROBADA'}
- **intentos:** ${estado.historial.length || 1}
- **replanteamientos:** ${estado.replanteos}

## Criterios de aceptación

${criterios?.length ? criterios.map((c) => `- [${apartada ? ' ' : 'x'}] ${c.texto}`).join('\n') : '(el análisis no dejó criterios)'}

## Historial de intentos

| Intento | Veredicto | Motivos |
|---------|-----------|---------|
${historial}

## Artefactos

- Análisis: \`${rel(rutas.analisis)}\`
- Revisión: \`${rel(rutas.review)}\`

## Commits

${commits?.length ? commits.map((c) => `- \`${c.corto}\` ${c.asunto}`).join('\n') : '(ninguno)'}

## Consumo de cuota

- Al empezar: ${estado.cuotaInicio != null ? `${estado.cuotaInicio}% de sesión usado` : 'no registrado'}
- Al cerrar: ${consumo?.sesionPct != null ? `${consumo.sesionPct}% de sesión usado` : 'no registrado'}
- Diferencia: ${consumo?.sesionPct != null && estado.cuotaInicio != null ? `${(consumo.sesionPct - estado.cuotaInicio).toFixed(0)} puntos` : '—'}
`;
  fs.mkdirSync(dir, { recursive: true });
  escribirAtomico(ruta, texto);
  return ruta;
}

/**
 * Marca la tarea en el tablero. Solo reescribe si la tarea venía de un bloque con principio
 * y fin. Con el tablero en prosa (que es el caso hoy) deja el texto aparte y lo dice: NO se
 * reescribe a ciegas un fichero de 681 KB.
 *
 * Dos desenlaces, y los dos se escriben: ✅ HECHA y ⛔ APARTADA. La apartada NO es cosmética:
 * desde que el lector coge tareas por `estado:` (31 ago 2026), una apartada que siguiera
 * diciendo «pendiente» se volvería a coger en cada vuelta, para siempre.
 */
export function marcarEnTablero({ config, tarea, commits, registro, logger, apartada = null }) {
  const shas = commits?.map((c) => `\`${c.corto}\``).join(', ') || '(ninguno)';
  const nota = apartada
    ? [
      '',
      `> **Apartada por el orquestador el ${hoy()}.** Esperando decisión de Ibrahin.`,
      `> Motivo: ${apartada}`,
      `> Registro: \`${path.relative(config.repo.raiz, registro)}\``,
      '',
    ].join('\n')
    : [
      '',
      `> **Cerrada por el orquestador el ${hoy()}.**`,
      `> Commits: ${shas}`,
      `> Registro: \`${path.relative(config.repo.raiz, registro)}\``,
      '',
    ].join('\n');

  if (tarea.origen !== 'bloque') {
    const destino = path.join(config.rutasAbs.registrosTarea, `${tarea.id}-PEGAR-EN-TABLERO.md`);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    escribirAtomico(destino, `# ${tarea.titulo} — ${apartada ? 'APARTADA' : 'HECHA'} (${hoy()})\n\nPega esto en ${config.repo.tablero}, línea ${tarea.linea}:\n${nota}\n`);
    logger?.aviso(`El tablero está en prosa: no lo reescribo. Texto para pegar en ${path.relative(config.repo.raiz, destino)}`);
    return { escrito: false, motivo: 'tablero-en-prosa', destino };
  }

  const texto = fs.readFileSync(config.tableroAbs, 'utf8');
  const pos = texto.indexOf(tarea.bruto);
  if (pos === -1) {
    logger?.error('El bloque de la tarea cambió en el tablero mientras trabajábamos. No lo piso.');
    return { escrito: false, motivo: 'bloque-cambiado' };
  }

  const lineas = tarea.bruto.split('\n');
  lineas[0] = lineas[0].replace(/^(#{1,6})\s+.*$/, (_, h) => (apartada
    ? `${h} ⛔ APARTADA (${hoy()}) — ${tarea.titulo}`
    : `${h} ✅ HECHA (${hoy()}) — ${tarea.titulo} · ${shas}`));
  const bloque = lineas
    // Una apartada no ha cumplido nada: sus casillas se quedan como estaban.
    .map((l) => (apartada ? l : l.replace(/^(\s*[-*+]\s*)\[ \]/, '$1[x]')))
    // El campo `estado` se actualiza con el titular. Dejarlo en «pendiente» bajo un
    // encabezado que dice HECHA es dejar escrita una contradicción, y el detalle es justo
    // lo que se lee cuando alguien quiere el porqué de la cifra (CLAUDE.md).
    // Cubre las tres formas que aparecen en los tableros: «estado: x»,
    // «**estado**: x» y «- **estado:** x» (los dos puntos DENTRO de los asteriscos).
    .map((l) => l.replace(/^(\s*(?:[-*+]\s*)?[*_]*\s*estado\s*[*_]*\s*:\s*[*_]*\s*)(.+?)([*_]*\s*)$/i, `$1${apartada ? 'apartada' : 'hecha'}$3`))
    .join('\n').replace(/\s*$/, '') + '\n' + nota;

  escribirAtomico(config.tableroAbs, texto.slice(0, pos) + bloque + texto.slice(pos + tarea.bruto.length));
  logger?.exito(`${config.repo.tablero} actualizado: «${tarea.titulo}» queda ${apartada ? 'APARTADA' : 'HECHA'}.`);
  return { escrito: true };
}

/**
 * El commit del cierre. Un solo commit con todo lo del cierre: registro + tablero.
 * El código del programador ya está confirmado por él; esto cierra el expediente.
 */
export function confirmarCierre({ config, tarea, ficheros, logger }) {
  const rel = ficheros.map((f) => path.relative(config.repo.raiz, f));
  try {
    anadir({ cwd: config.repo.raiz, ficheros: rel });
    const sha = confirmar({
      cwd: config.repo.raiz,
      mensaje: `Orquestador — cierra «${tarea.titulo}» (${tarea.id})\n\nTarea: ${tarea.id}`,
      ficheros: rel,
    });
    logger?.exito(`Cierre confirmado: ${sha}`);
    return { ok: true, sha };
  } catch (e) {
    logger?.error(`No pude confirmar el cierre: ${e.message}`);
    return { ok: false, error: e };
  }
}

/** La subida, con su política: solo lo aprobado, nunca a la fuerza, y el conflicto no se reintenta. */
export function subirTrabajo({ config, logger }) {
  if (!config.subida.activa) {
    logger?.info('Subida desactivada por configuración: no subo.');
    return { ok: true, omitida: true };
  }
  const r = subir({ cwd: config.repo.raiz, remoto: config.repo.remoto, ramaDestino: config.repo.ramaPrincipal });
  if (r.ok) { logger?.exito(`Subido a ${config.repo.remoto}/${config.repo.ramaPrincipal}.`); return r; }
  if (r.conflicto) {
    logger?.error(`CONFLICTO con GitHub: ${r.motivo}`);
    logger?.error('No lo resuelvo solo y no vuelvo a intentarlo. Hace falta una persona.');
  } else {
    logger?.aviso(`Subida fallida (se reintentará): ${r.motivo}`);
  }
  return r;
}
