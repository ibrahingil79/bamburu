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
export function marcarEnTablero({ config, tarea, commits, registro, logger, apartada = null, premisaFalsa = null }) {
  const shas = commits?.map((c) => `\`${c.corto}\``).join(', ') || '(ninguno)';
  // ⚙️ TRES MARCAS, NO DOS (1 sep 2026). La tercera es la premisa falsa: una tarea escrita sobre
  // algo que no es cierto NO está «apartada esperando decisión» —no hay nada que decidir— ni está
  // «hecha» —no se construyó nada—. Está cerrada porque sobraba, y **la prueba se escribe aquí**,
  // que es donde alguien la va a leer dentro de seis meses preguntándose por qué se cerró.
  const nota = premisaFalsa
    ? [
      '',
      `> **✅ CERRADA SOLA por el orquestador el ${hoy()}: lo que pedía NO ERA CIERTO.**`,
      '>',
      `> Motivo: ${premisaFalsa.motivo}`,
      `> **Prueba:** ${premisaFalsa.prueba}`,
      '>',
      '> No subió al móvil de Ibrahin: no era una decisión suya, era una entrada caducada del tablero.',
      `> Registro: \`${path.relative(config.repo.raiz, registro)}\``,
      '',
    ].join('\n')
    : apartada
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
    escribirAtomico(destino, `# ${tarea.titulo} — ${premisaFalsa ? 'CERRADA (PREMISA FALSA)' : apartada ? 'APARTADA' : 'HECHA'} (${hoy()})\n\nPega esto en ${config.repo.tablero}, línea ${tarea.linea}:\n${nota}\n`);
    logger?.aviso(`El tablero está en prosa: no lo reescribo. Texto para pegar en ${path.relative(config.repo.raiz, destino)}`);
    return { escrito: false, motivo: 'tablero-en-prosa', destino };
  }

  const texto = fs.readFileSync(config.tableroAbs, 'utf8');
  const pos = texto.indexOf(tarea.bruto);
  if (pos === -1) {
    // Cambió mientras trabajábamos. El cuerpo NO se toca —puede haberlo reescrito el
    // programador con razón— pero la nota de cierre sí se deja: sin ella, el bloque se queda
    // sin sus commits y sin enlace a su registro, y eso es justo lo que se lee después.
    return anotarCierreEnBloqueCambiado({ config, tarea, nota, apartada, logger });
  }

  const lineas = tarea.bruto.split('\n');
  lineas[0] = lineas[0].replace(/^(#{1,6})\s+.*$/, (_, h) => (premisaFalsa
    ? `${h} ✅ CERRADA — PREMISA FALSA (${hoy()}) — ${tarea.titulo}`
    : apartada
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
 * Localiza el bloque de una tarea por su `id`, que es lo ÚNICO estable: el título se retoca,
 * el cuerpo se reescribe, pero el identificador no cambia (por eso el formato lo exige).
 * @returns { ini, fin, nivel, titulo } o null
 */
function bloquePorId(lineas, id) {
  const candidatos = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lineas[i]);
    if (!m) continue;
    const nivel = m[1].length;
    let fin = lineas.length;
    let encontrado = false;
    for (let j = i + 1; j < lineas.length; j++) {
      const n = /^(#{1,6})\s+/.exec(lineas[j]);
      if (n && n[1].length <= nivel) { fin = j; break; }
      const d = /^\s*(?:[-*+]\s*)?[*_]*\s*id\s*[*_]*\s*:\s*[*_]*\s*([^\s*_`]+)/i.exec(lineas[j]);
      if (d && d[1] === id) encontrado = true;
    }
    if (encontrado) candidatos.push({ ini: i, fin, nivel });
  }
  if (!candidatos.length) return null;

  // GANA EL MÁS PEQUEÑO. Es la sección de la tarea, no el capítulo que la contiene ni el
  // documento entero. Sin esto, «# Tablero» sale elegido —contiene el id, como todo lo
  // demás— y el bloque pasa a ser el fichero completo: el titular se reescribe y TODOS los
  // `estado: pendiente` del documento se ponen en «hecha». Lo cazó su prueba en el sitio.
  // (Es la misma regla que reader.buscarTareaPorId, y por el mismo motivo.)
  const b = candidatos.sort((x, y) => (x.fin - x.ini) - (y.fin - y.ini))[0];
  const titulo = lineas[b.ini].replace(/^#{1,6}\s+/, '')
    .replace(/^(✅\s*HECHA|⛔\s*APARTADA)\s*\([^)]*\)\s*[—–\-:·|]?\s*/i, '')
    .replace(/^\s*tareas?\s*[—–\-:·|]\s*/i, '')
    .replace(/\s*·\s*`[0-9a-f, `]+`\s*$/i, '')
    .trim();
  return { ...b, titulo };
}

/**
 * Deja la nota de cierre en un bloque que YA no es el que cogimos.
 *
 * De dónde sale (1 sep 2026): al cerrar `portal-formato-dinero`, el programador había
 * reescrito ese mismo bloque durante su trabajo. `marcarEnTablero` hizo bien en no pisarlo
 * —esa protección existe por algo— pero se rindió del todo, y el bloque se quedó **sin la
 * nota de cierre**: sin sus commits y sin el enlace a su registro. Los otros tres la tienen.
 * Rendirse entero era demasiado: el cuerpo no se toca, pero el rastro se deja.
 */
function anotarCierreEnBloqueCambiado({ config, tarea, nota, apartada, logger }) {
  const texto = fs.readFileSync(config.tableroAbs, 'utf8');
  const lineas = texto.split('\n');
  const b = bloquePorId(lineas, tarea.id);
  if (!b) return { escrito: false, motivo: 'bloque-cambiado' };

  // Si la nota ya está (un cierre repetido), no se duplica.
  const cuerpo = lineas.slice(b.ini, b.fin).join('\n');
  if (cuerpo.includes(`docs/orquestador/tareas/${tarea.id}.md`)) {
    logger?.info(`El bloque de «${tarea.titulo}» ya tenía su nota de cierre. Lo dejo como está.`);
    return { escrito: false, motivo: 'ya-anotado' };
  }

  const nuevas = [...lineas.slice(b.ini, b.fin)];
  // El titular y el `estado:` solo se tocan si nadie los puso ya: lo que escribió otro manda.
  if (!/^#{1,6}\s+(✅\s*HECHA|⛔\s*APARTADA)/i.test(nuevas[0])) {
    nuevas[0] = `${'#'.repeat(b.nivel)} ${apartada ? '⛔ APARTADA' : '✅ HECHA'} (${hoy()}) — ${b.titulo}`;
  }
  for (let k = 1; k < nuevas.length; k++) {
    nuevas[k] = nuevas[k].replace(
      /^(\s*(?:[-*+]\s*)?[*_]*\s*estado\s*[*_]*\s*:\s*[*_]*\s*)(pendiente|en-curso|en curso)([*_]*\s*)$/i,
      `$1${apartada ? 'apartada' : 'hecha'}$3`);
  }

  const bloque = nuevas.join('\n').replace(/\s*$/, '') + '\n' + nota;
  escribirAtomico(config.tableroAbs, [...lineas.slice(0, b.ini), bloque, ...lineas.slice(b.fin)].join('\n'));
  logger?.aviso(`El bloque de «${tarea.titulo}» lo había cambiado otro. No lo piso: solo le dejo la nota de cierre.`);
  return { escrito: true, motivo: 'bloque-cambiado-nota-anadida' };
}

/**
 * Deshace la marca de APARTADA: el bloque vuelve a «## TAREA — …» con `estado: pendiente`,
 * y se le quita la nota de apartada. Es lo que pide «desapartar» desde Telegram.
 *
 * Se deja escrito CUÁNDO y POR QUÉ volvió, en vez de borrar el rastro: la tarea se apartó
 * por algo, y quien la lea dentro de un mes tiene que poder reconstruir qué pasó.
 *
 * @returns { ok, motivo? }
 */
export function desmarcarEnTablero({ config, id, logger }) {
  const texto = fs.readFileSync(config.tableroAbs, 'utf8');
  const lineas = texto.split('\n');

  // El bloque: su encabezado dice «⛔ APARTADA» y su `id:` es el que se pide.
  let ini = -1;
  let fin = lineas.length;
  let nivel = 0;
  for (let i = 0; i < lineas.length && ini === -1; i++) {
    const m = /^(#{1,6})\s+⛔\s*APARTADA\b.*$/.exec(lineas[i]);
    if (!m) continue;
    for (let j = i + 1; j < lineas.length; j++) {
      const n = /^(#{1,6})\s+/.exec(lineas[j]);
      if (n && n[1].length <= m[1].length) break;
      const d = /^\s*(?:[-*+]\s*)?[*_]*\s*id\s*[*_]*\s*:\s*[*_]*\s*([^\s*_`]+)/i.exec(lineas[j]);
      if (d && d[1] === id) { ini = i; nivel = m[1].length; break; }
    }
  }
  if (ini === -1) return { ok: false, motivo: `no encuentro ninguna tarea apartada con el id «${id}» en el tablero` };

  for (let j = ini + 1; j < lineas.length; j++) {
    const n = /^(#{1,6})\s+/.exec(lineas[j]);
    if (n && n[1].length <= nivel) { fin = j; break; }
  }

  const titulo = lineas[ini].replace(/^#{1,6}\s+⛔\s*APARTADA\s*\([^)]*\)\s*[—–\-:·|]?\s*/, '').trim();
  const nuevas = lineas.slice(ini, fin)
    .map((l, k) => (k === 0 ? `${'#'.repeat(nivel)} TAREA — ${titulo}` : l))
    .map((l) => l.replace(/^(\s*(?:[-*+]\s*)?[*_]*\s*estado\s*[*_]*\s*:\s*[*_]*\s*)(.+?)([*_]*\s*)$/i, '$1pendiente$3'))
    // La nota de apartada se va, pero no en silencio: se sustituye por el rastro de la vuelta.
    .filter((l) => !/^>\s*\*\*Apartada por el orquestador/.test(l)
                && !/^>\s*Motivo:/.test(l)
                && !/^>\s*Registro:/.test(l));

  const rastro = ['', `> **Desapartada el ${hoy()} a petición de Ibrahin desde Telegram.** Vuelve a estar pendiente.`, ''];
  const bloque = nuevas.join('\n').replace(/\s*$/, '') + '\n' + rastro.join('\n');

  escribirAtomico(config.tableroAbs, [...lineas.slice(0, ini), bloque, ...lineas.slice(fin)].join('\n'));
  logger?.exito(`${config.repo.tablero} actualizado: «${titulo}» vuelve a estar pendiente.`);
  return { ok: true, titulo };
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
