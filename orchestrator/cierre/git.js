// git.js — Todo lo que toca git. Nadie más ejecuta git fuera de aquí y de reader.js.
import { execFileSync } from 'node:child_process';
import { ErrorOrquestador, CLASES } from '../nucleo/errores.js';

// Plazos de git. Se pueden ajustar por entorno; a fuego en el código no se queda nada.
const TIEMPO_GIT = Number(process.env.ORQUESTADOR_GIT_TIMEOUT_MS || 120000);
const TIEMPO_PUSH = Number(process.env.ORQUESTADOR_PUSH_TIMEOUT_MS || 180000);
const MAX_SALIDA_GIT = 64 * 1024 * 1024;

function git(args, cwd, { permitirFallo = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_SALIDA_GIT, timeout: TIEMPO_GIT });
  } catch (e) {
    if (permitirFallo) return null;
    const salida = `${e.stdout || ''}${e.stderr || ''}`.trim();
    throw new ErrorOrquestador(CLASES.GIT, `git ${args[0]} falló: ${salida.split('\n')[0] || e.message}`,
      { args, salida: salida.slice(0, 1000) });
  }
}

export const cabeza = (cwd) => git(['rev-parse', 'HEAD'], cwd).trim();
export const rama = (cwd) => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
export const hayCambios = (cwd) => git(['status', '--porcelain'], cwd).trim().length > 0;

/**
 * LA RAMA DE UNA TAREA QUE ESPERA FIRMA.
 *
 * ⚙️ POR QUÉ EXISTE, Y ES LA PIEZA QUE IMPIDE REPETIR LO DEL CIFRADO (1 sep 2026).
 * Hasta hoy el programador commiteaba **directo a master**, en CONSTRUCCIÓN, dos pasos antes del
 * cierre. Y master es de donde vive el producto: `bamburu-backup.service`,
 * `bamburu-backup-secondary.service` y el heartbeat ejecutan **de cero cada noche**
 * `/home/ubuntu/bamburu/scripts/…`. No hace falta reiniciar nada ni cerrar la tarea: **en cuanto el
 * fichero cambia, la siguiente ejecución usa el código nuevo.**
 *
 * Eso fue exactamente el cifrado de las copias: el programador commiteó `bamburu-backup.sh`, la
 * tarea se APARTÓ después… y el timer de las 03:31 iba a ejecutar ese fichero igual. Las dos copias
 * habrían abortado. **La tarea nunca llegó a cerrarse y el código estaba en producción de todos
 * modos.**
 *
 * Con la rama, master no se toca hasta que Ibrahin aprueba. «Lo que se presenta a firmar está
 * terminado o no está.»
 */
export function ramaDeTarea(id) { return `tarea/${id}`; }

/** Crea la rama de la tarea (o se pone en ella si ya existía) y devuelve de dónde partió. */
export function abrirRama({ cwd, id, desde }) {
  const rama = ramaDeTarea(id);
  const existe = git(['rev-parse', '--verify', '--quiet', rama], cwd, { permitirFallo: true });
  if (existe) git(['checkout', rama], cwd);
  else git(['checkout', '-b', rama, desde], cwd);
  return { rama, desde };
}

/** Vuelve a la rama principal. Se llama SIEMPRE al soltar una tarea: el árbol es el producto. */
export function volverA({ cwd, rama }) {
  const actual = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
  if (actual === rama) return { ok: true, yaEstaba: true };
  git(['checkout', rama], cwd);
  return { ok: true, desde: actual };
}

/**
 * Funde la rama de una tarea aprobada en la principal. Sin `--no-ff`: el historial de la tarea se
 * conserva tal cual, con sus commits, que es lo que luego se lee para saber qué se aprobó.
 */
export function fundirRama({ cwd, id, ramaDestino }) {
  const rama = ramaDeTarea(id);
  if (!git(['rev-parse', '--verify', '--quiet', rama], cwd, { permitirFallo: true })) {
    return { ok: false, motivo: `no existe la rama ${rama}: no hay nada que aprobar` };
  }
  volverA({ cwd, rama: ramaDestino });
  try {
    git(['merge', '--no-ff', '-m', `Aprobado por Ibrahin — ${id}`, rama], cwd);
  } catch (e) {
    // Un conflicto NO se resuelve solo: se deshace el intento y se avisa. Fundir a medias es
    // justo lo que esta pieza existe para impedir.
    git(['merge', '--abort'], cwd, { permitirFallo: true });
    return { ok: false, conflicto: true, motivo: `la rama ${rama} no funde limpia: ${e.message}` };
  }
  return { ok: true, rama };
}

export function confirmar({ cwd, mensaje, ficheros = null }) {
  const args = ['commit', '-m', mensaje];
  if (ficheros?.length) args.push('--only', '--', ...ficheros);
  else args.push('-a');
  git(args, cwd);
  return git(['rev-parse', '--short', 'HEAD'], cwd).trim();
}

export function anadir({ cwd, ficheros }) {
  if (ficheros?.length) git(['add', '--', ...ficheros], cwd);
}

/**
 * Sube. NUNCA fuerza: si hay divergencia con lo que ya está en GitHub, se para y avisa.
 * Distingue los tres casos que importan y que se tratan distinto:
 *   · sin red        → se reintenta luego
 *   · con conflicto  → NO se reintenta: hace falta una persona
 *   · ok
 */
export function subir({ cwd, remoto, ramaDestino }) {
  const actual = rama(cwd);
  if (actual !== ramaDestino) {
    return { ok: false, conflicto: true,
             motivo: `estoy en la rama «${actual}» y la subida es a «${ramaDestino}»: no cambio de rama solo` };
  }
  try {
    execFileSync('git', ['push', remoto, ramaDestino], { cwd, encoding: 'utf8', timeout: TIEMPO_PUSH });
    return { ok: true };
  } catch (e) {
    const salida = `${e.stdout || ''}${e.stderr || ''}`.trim();
    const conflicto = /non-fast-forward|rejected|fetch first|behind|diverged/i.test(salida);
    const red = /could not resolve host|unable to access|connection|timed out|network|ssh:/i.test(salida);
    return {
      ok: false,
      conflicto,
      red: red && !conflicto,
      motivo: conflicto
        ? `GitHub rechazó la subida por divergencia: ${primeraLinea(salida)}`
        : `no pude subir: ${primeraLinea(salida)}`,
      salida: salida.slice(0, 1500),
    };
  }
}

const primeraLinea = (s) => String(s).split('\n').find((l) => l.trim()) || 'sin detalle';
