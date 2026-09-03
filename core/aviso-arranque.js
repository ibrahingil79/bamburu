// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL AVISO DE UN ARRANQUE ROTO — a Telegram, y sin poder impedir jamás que el proceso muera.
//
// DE DÓNDE SALE (AUD-007, 3 sep 2026). Hasta hoy, que un módulo no cargara dejaba UNA línea de
// `console.warn` en el journal y nada más. Medido en esta máquina: pasó CINCO veces en 30 días y
// tres de ellas se llevaron el panel de administración entero, con Bamburu diciendo «listo» y
// respondiendo a todo lo demás. Las cuatro duraron poco **porque había una persona desplegando**,
// no porque nada avisara.
//
// ⚠️ LA REGLA QUE MANDA AQUÍ, y está por encima de mandar el aviso: **este fichero NO PUEDE
// IMPEDIR QUE EL ARRANQUE FALLE.** Si Telegram no contesta, si falta el token, si el fichero de
// credenciales no se puede leer — da igual: se devuelve el motivo y el que llama sigue su camino,
// que es morirse. Un aviso que se traga un fallo de arranque es peor que no tener aviso.
// Por eso nada de aquí lanza nunca, y todo tiene un plazo.
//
// DE DÓNDE SALEN LAS CREDENCIALES, que era el obstáculo real. El token y el chat viven en
// `/etc/orquestador.env` (`ORQUESTADOR_TELEGRAM_TOKEN` / `..._CHAT_ID`), y `bamburu.service` carga
// `/etc/bamburu.env`, que NO los tiene: hoy el proceso de Bamburu no podía mandar un Telegram
// aunque quisiera. Los dos ficheros son `0600 ubuntu:ubuntu` y el servicio corre como `ubuntu`, así
// que se leen del disco cuando no están en el entorno — el mismo respaldo que ya usa `core/llm.js`.
// **No se duplica el secreto en un segundo fichero** y no hace falta tocar `/etc` ni la unit.
//
// Y NO, esto no enciende el orquestador: se reutiliza su TRANSPORTE (una librería que no lanza) y
// su CANAL (un chat). El orquestador sigue parado, que es lo que decidió Ibrahin el 2 sep.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mandarTelegram } from './telegram-servidor.js';

// ⚙️ 3 SEP 2026 (AUD-008) — EL TRANSPORTE SE MUDÓ. Leer las credenciales, montar la configuración y
// enviar con plazo vivía aquí dentro. La tarea de las copias necesitaba exactamente lo mismo para
// avisar de una copia fallida, y copiarlo habría sido un camino paralelo: dos sitios que leen el
// mismo secreto y dos formas distintas de dejar de funcionar. Está en `core/telegram-servidor.js`.
// Aquí se queda lo que SÍ es del arranque: el freno de repetición y el texto del aviso.

// EL FRENO DEL BUCLE DE AVISOS. `systemctl show bamburu` dice hoy: Restart=on-failure, RestartSec=3,
// StartLimitBurst=5 en StartLimitIntervalUSec=10s. O sea que **el bucle de arranques ya lo acota
// systemd** —a los 5 intentos el servicio queda en `failed` y para—, pero sin este freno serían
// hasta CINCO Telegram idénticos en diez segundos. Diez minutos es holgado sobre esa ventana de
// 10 s y sigue siendo corto para que un fallo distinto se cuente enseguida.
const VENTANA_AVISO_MS = 10 * 60 * 1000;
const ESTADO = 'data/estado-arranque.json';   // junto a `tiempos-gates.json`: `data/` ya es el sitio del estado



/** ¿Toca avisar, o este mismo fallo ya se avisó hace nada? Ante la duda, SE AVISA. */
function tocaAvisar(raiz, clave, ahora) {
  try {
    const est = JSON.parse(readFileSync(join(raiz, ESTADO), 'utf8'));
    const ultimo = est?.avisos?.[clave];
    if (typeof ultimo === 'number' && ahora - ultimo < VENTANA_AVISO_MS) return false;
  } catch { /* sin fichero, o ilegible: se avisa */ }
  return true;
}

function anotarAviso(raiz, clave, ahora) {
  try {
    let est = {};
    try { est = JSON.parse(readFileSync(join(raiz, ESTADO), 'utf8')); } catch { /* nace ahora */ }
    est.avisos = est.avisos || {};
    est.avisos[clave] = ahora;
    // Se poda lo viejo para que el fichero no crezca sin fin con fallos de hace semanas.
    for (const [k, v] of Object.entries(est.avisos)) if (ahora - v > 7 * 24 * 3600 * 1000) delete est.avisos[k];
    mkdirSync(join(raiz, 'data'), { recursive: true });
    writeFileSync(join(raiz, ESTADO), JSON.stringify(est, null, 2));
  } catch { /* no poder anotar significa avisar de más, nunca de menos */ }
}

/**
 * EL TEXTO DEL AVISO, aparte y exportado **para poder comprobar qué dice sin mandar nada**. El
 * criterio de esta tarea pide que el aviso lleve el módulo Y el motivo; si el texto se construyera
 * dentro del envío, comprobarlo exigiría o mandar un Telegram de verdad en cada pasada o creerse
 * una copia escrita a mano en la prueba. Ninguna de las dos cosas vale.
 *
 * Los `<>&` del motivo se sustituyen por espacios porque el mensaje va en HTML de Telegram: un
 * error de sintaxis del estilo `Unexpected token '<'` rompería el `parse_mode` y **el aviso no
 * saldría justo el día que hace falta**.
 */
export function textoDeAviso({ modulo, esencial, error }) {
  const detalle = String(error?.message || error || 'sin mensaje');
  return (esencial ? '🛑 <b>BAMBURU NO ARRANCA</b>' : '⚠️ <b>Bamburu arrancó SIN una parte</b>')
    + '\nMódulo: <b>' + modulo + '</b> (' + (esencial ? 'esencial' : 'opcional') + ')'
    + '\nMotivo: <code>' + detalle.slice(0, 500).replace(/[<>&]/g, ' ') + '</code>'
    + (esencial ? '\n\nEl servicio está caído hasta que alguien lo arregle.' : '\n\nEl resto sigue en pie.');
}

/**
 * Manda el aviso. **Nunca lanza y nunca tarda más de PLAZO_MS.**
 *
 * @returns { enviado:boolean, motivo:string } — el motivo se imprime SIEMPRE, tanto si salió como
 *          si no: que el aviso no saliera es en sí mismo una noticia, y callarla sería el mismo
 *          fallo que esta tarea viene a arreglar.
 */
export async function avisarArranqueRoto({ modulo, esencial, error, raiz = process.cwd(), ahora = Date.now() }) {
  const detalle = String(error?.message || error || 'sin mensaje');
  const clave = modulo + '|' + detalle.slice(0, 120);

  if (!tocaAvisar(raiz, clave, ahora)) {
    return { enviado: false, motivo: 'no se repite: el mismo fallo ya se avisó hace menos de ' + (VENTANA_AVISO_MS / 60000) + ' min' };
  }

  const r = await mandarTelegram({ tema: 'arranque', texto: textoDeAviso({ modulo, esencial, error }) });
  if (r.ok) { anotarAviso(raiz, clave, ahora); return { enviado: true, motivo: r.motivo }; }
  return { enviado: false, motivo: r.motivo };
}
