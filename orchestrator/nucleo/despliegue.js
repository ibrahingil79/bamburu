// despliegue.js — ¿Corre cada proceso el código que hay escrito, o uno de antes?
//
// ⚙️ DE DÓNDE SALE, Y ES UNA AVERÍA REAL DEL 1 SEP 2026. Ibrahin escribió «Preguntas» al bot a las
// 12:56 y le contestó con la ayuda, porque la orden no existía… en el proceso que estaba corriendo.
// El vigía llevaba desde las **06:58** en marcha y la orden se escribió a las **12:51**: casi seis
// horas con código viejo en memoria. Node lee el fichero al arrancar y **no lo vuelve a leer nunca**.
//
// Y LO QUE HACE QUE ESTO MEREZCA UN MÓDULO: yo mismo había verificado la orden «por el camino de
// Telegram entero»… **en un proceso nuevo**, que lee del disco. Verifiqué el código, no el
// despliegue. Desde fuera, un proceso desfasado y uno al día son idénticos: los dos dicen `active`.
//
// Al medirlo aparecieron DOS, no uno: el vigía (352 min de retraso) y **el propio producto**
// (`bamburu`, arrancado a las 03:56, con un commit de las 04:03 sin cargar). Ése es peor: el
// orquestador cerró esa tarea, la marcó HECHA y la subió — **y el cliente no la ha visto**.
//
// POR QUÉ SE MIRA LA FECHA DEL FICHERO Y NO EL COMMIT: lo que Node leyó es el fichero del disco.
// Un `git checkout` cambia ficheros sin hacer commit, y un commit no cambia lo que ya se leyó. La
// pregunta es «¿hay algún fuente más nuevo que el arranque de este proceso?», y eso es mtime.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Qué fuentes mira cada servicio. Lo que no esté aquí no se vigila, y se dice. */
export const VIGILADOS = Object.freeze({
  'orquestador': ['orchestrator'],
  'orquestador-vigia': ['orchestrator'],
  'bamburu': ['index.js', 'core', 'modules'],
});

function arranqueDe(unidad) {
  try {
    const pid = Number(execFileSync('systemctl', ['show', unidad, '-p', 'MainPID', '--value'],
      { encoding: 'utf8', timeout: 10000 }).trim());
    if (!pid) return null;
    return fs.statSync(`/proc/${pid}`).mtimeMs;   // cuándo arrancó ESE proceso
  } catch { return null; }
}

/** El fuente más nuevo bajo esas rutas, en milisegundos. */
function masNuevo(raiz, rutas) {
  let max = 0, cual = null;
  const mirar = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      // `node_modules` y `pruebas` no cambian lo que sirve el proceso.
      if (/node_modules|pruebas|_retirado/.test(p)) return;
      for (const n of fs.readdirSync(p)) mirar(path.join(p, n));
      return;
    }
    if (!/\.(js|mjs|json)$/.test(p)) return;
    if (st.mtimeMs > max) { max = st.mtimeMs; cual = p; }
  };
  for (const r of rutas) mirar(path.join(raiz, r));
  return { ms: max, fichero: cual };
}

/**
 * @returns [{ unidad, activo, desfasado, minutos, fichero }] — uno por servicio vigilado.
 *          `desfasado: null` cuando no se ha podido saber (no está corriendo, o no hay /proc).
 */
export function estadoDelDespliegue(raiz) {
  return Object.entries(VIGILADOS).map(([unidad, rutas]) => {
    let activo = false;
    try {
      activo = execFileSync('systemctl', ['is-active', unidad], { encoding: 'utf8', timeout: 10000 }).trim() === 'active';
    } catch { activo = false; }
    const arranque = activo ? arranqueDe(unidad) : null;
    if (!arranque) return { unidad, activo, desfasado: null, minutos: 0, fichero: null };
    const n = masNuevo(raiz, rutas);
    const desfasado = n.ms > arranque;
    return { unidad, activo, desfasado, minutos: desfasado ? Math.round((n.ms - arranque) / 60000) : 0,
             fichero: desfasado ? path.relative(raiz, n.fichero) : null };
  });
}

/** Los que corren código viejo. Vacío = todos al día. */
export const desfasados = (raiz) => estadoDelDespliegue(raiz).filter((s) => s.desfasado === true);
