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
