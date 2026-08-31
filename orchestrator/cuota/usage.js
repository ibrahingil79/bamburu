// usage.js — Interpreta la salida de `/usage`. Función pura: se prueba sin gastar cuota.
//
// La salida real, medida el 31 ago 2026:
//
//   You are currently using your subscription to power your Claude Code usage
//
//   Current session: 64% used · resets Aug 31, 9:50pm (UTC)
//   Current week (all models): 10% used · resets Sep 3, 6pm (UTC)
//   Current week (Fable): 0% used

const RE_SESION = /Current session:\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s*([^\n]+?))?\s*$/im;
const RE_SEMANA = /Current week \(all models\):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s*([^\n]+?))?\s*$/im;
const RE_SUSCRIPCION = /using your subscription/i;

/**
 * @returns { fiable, sesionPct, semanaPct, reinicioSesion, reinicioSemana, motivo }
 *
 * `fiable: false` cuando no se ha podido leer. NUNCA se inventa un número: quien decide
 * arriba prefiere «no sé» y esperar, a un cero optimista que vacía la ventana de Ibrahin.
 */
export function interpretarUsage(texto) {
  const t = String(texto || '');
  const s = RE_SESION.exec(t);
  const w = RE_SEMANA.exec(t);

  if (!s) {
    return { fiable: false, sesionPct: null, semanaPct: null, reinicioSesion: null, reinicioSemana: null,
             motivo: 'no encuentro la línea «Current session: N% used» en la salida de /usage' };
  }
  const sesionPct = Number(s[1]);
  const semanaPct = w ? Number(w[1]) : null;
  if (!Number.isFinite(sesionPct)) {
    return { fiable: false, sesionPct: null, semanaPct: null, reinicioSesion: null, reinicioSemana: null,
             motivo: `el porcentaje de sesión no es un número: «${s[1]}»` };
  }
  return {
    fiable: true,
    sesionPct,
    // Sin línea semanal se asume 0 usado: es el caso de una cuenta que no la muestra, y
    // el que manda de verdad es el de sesión.
    semanaPct: Number.isFinite(semanaPct) ? semanaPct : 0,
    reinicioSesion: s[2] ? s[2].trim() : null,
    reinicioSemana: w && w[2] ? w[2].trim() : null,
    suscripcion: RE_SUSCRIPCION.test(t),
    motivo: 'leído de /usage',
  };
}
