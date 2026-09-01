// usage.js — Interpreta la salida de `/usage`. Función pura: se prueba sin gastar cuota.
//
// La salida real, medida el 1 sep 2026 (la del 31 ago traía las mismas tres líneas de arriba;
// desde entonces el CLI añade debajo un bloque «What's contributing…» que aquí no estorba
// porque cada patrón está anclado a SU rótulo):
//
//   You are currently using your subscription to power your Claude Code usage
//
//   Current session: 7% used · resets Sep 1, 12:59pm (UTC)
//   Current week (all models): 25% used · resets Sep 3, 6pm (UTC)
//   Current week (Fable): 0% used
//
// ⚙️ POR QUÉ LA HORA DEL REINICIO SE CONVIERTE EN UN INSTANTE (1 sep 2026, avería 2). Antes esto
// devolvía `reinicioSesion` como el texto suelto «Sep 1, 8am (UTC)». El orquestador lo IMPRIMÍA
// —«La ventana se reinicia: Sep 1, 8am (UTC)»— y acto seguido se dormía 15 minutos a ciegas,
// porque nadie en todo el árbol convertía esa cadena en un momento. Resultado medido ese día:
// la ventana se reinició a las 08:00, el daemon volvió a mirar a las 08:09:59, y durante esos
// diez minutos la pantalla de Ibrahin decía 0% usado mientras la última línea del registro
// seguía diciendo 12%. No leía mal el número: lo miraba tarde.

const RE_SESION = /Current session:\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s*([^\n]+?))?\s*$/im;
const RE_SEMANA = /Current week \(all models\):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s*([^\n]+?))?\s*$/im;
const RE_SUSCRIPCION = /using your subscription/i;

const MESES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
                jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * «Sep 1, 12:59pm (UTC)» → el instante en milisegundos. `null` si no se entiende.
 *
 * NO SE INVENTA NADA, que es la misma regla que el resto del fichero: ante un formato que no
 * reconoce devuelve `null`, y quien decide arriba vuelve a su sondeo de siempre. Un `null` cuesta
 * unos minutos de espera de más; una hora inventada manda al daemon a mirar cuando no toca.
 *
 * El año no viene en el texto. Se toma el de `ahora` y, si eso deja el reinicio más de un día en
 * el pasado, se prueba el siguiente: es el salto de fin de año (31 dic → 1 ene), y sin esto el
 * orquestador se pasaría la Nochevieja creyendo que el reinicio fue hace once meses.
 */
export function momentoDeReinicio(texto, ahora = Date.now()) {
  const m = /^(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(UTC\))?$/i
    .exec(String(texto || '').trim());
  if (!m) return null;

  const [, mes, dia, hh, mm, ampm] = m;
  const mesN = mes ? MESES[mes.toLowerCase()] : null;
  if (mes && mesN === undefined) return null;

  let hora = Number(hh) % 12;                       // 12am = 0, 12pm = 12
  if (ampm.toLowerCase() === 'pm') hora += 12;
  const min = mm ? Number(mm) : 0;
  if (hora > 23 || min > 59) return null;

  const base = new Date(ahora);
  const año = base.getUTCFullYear();
  const armar = (a) => (mes
    ? Date.UTC(a, mesN, Number(dia), hora, min)
    : Date.UTC(a, base.getUTCMonth(), base.getUTCDate(), hora, min));

  let t = armar(año);
  if (!Number.isFinite(t)) return null;
  // Más de un día atrás con fecha explícita = es del año que viene (31 dic → 1 ene).
  if (mes && t < ahora - 86400000) t = armar(año + 1);
  return t;
}

/**
 * @returns { fiable, sesionPct, semanaPct, reinicioSesion, reinicioSemana,
 *            reinicioSesionMs, reinicioSemanaMs, motivo }
 *
 * `fiable: false` cuando no se ha podido leer. NUNCA se inventa un número: quien decide
 * arriba prefiere «no sé» y esperar, a un cero optimista que vacía la ventana de Ibrahin.
 */
export function interpretarUsage(texto, ahora = Date.now()) {
  const t = String(texto || '');
  const s = RE_SESION.exec(t);
  const w = RE_SEMANA.exec(t);

  if (!s) {
    return { fiable: false, sesionPct: null, semanaPct: null, reinicioSesion: null, reinicioSemana: null,
             reinicioSesionMs: null, reinicioSemanaMs: null,
             motivo: 'no encuentro la línea «Current session: N% used» en la salida de /usage' };
  }
  const sesionPct = Number(s[1]);
  const semanaPct = w ? Number(w[1]) : null;
  if (!Number.isFinite(sesionPct)) {
    return { fiable: false, sesionPct: null, semanaPct: null, reinicioSesion: null, reinicioSemana: null,
             reinicioSesionMs: null, reinicioSemanaMs: null,
             motivo: `el porcentaje de sesión no es un número: «${s[1]}»` };
  }
  const reinicioSesion = s[2] ? s[2].trim() : null;
  const reinicioSemana = w && w[2] ? w[2].trim() : null;
  return {
    fiable: true,
    sesionPct,
    // Sin línea semanal se asume 0 usado: es el caso de una cuenta que no la muestra, y
    // el que manda de verdad es el de sesión.
    semanaPct: Number.isFinite(semanaPct) ? semanaPct : 0,
    reinicioSesion,
    reinicioSemana,
    reinicioSesionMs: momentoDeReinicio(reinicioSesion, ahora),
    reinicioSemanaMs: momentoDeReinicio(reinicioSemana, ahora),
    suscripcion: RE_SUSCRIPCION.test(t),
    motivo: 'leído de /usage',
  };
}
