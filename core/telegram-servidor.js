// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MANDAR UN TELEGRAM DESDE EL SERVIDOR — el único sitio, para el arranque y para las copias.
//
// DE DÓNDE SALE. El cierre 7 (AUD-007) construyó esto dentro de `core/aviso-arranque.js` para avisar
// de un arranque roto. El cierre 8 (AUD-008) necesita lo mismo para avisar de una copia de seguridad
// que falla. **Copiarlo habría sido un camino paralelo**: dos sitios que leen credenciales, dos
// plazos, dos formas de fallar, y el día que cambie el nombre de una variable, uno de los dos deja
// de avisar sin que nadie se entere. Así que se extrae aquí y los dos lo usan.
//
// DE DÓNDE SALEN LAS CREDENCIALES. ~~El token y el chat viven en `/etc/orquestador.env`
// (`ORQUESTADOR_TELEGRAM_TOKEN` / `..._CHAT_ID`)...~~
//
// ⚙️ CAMBIADO EL 3 SEP 2026 — DECISIÓN DE IBRAHIN: **este bot es EXCLUSIVO de los avisos de
// Bamburu.** La fábrica/orquestador no puede usarlo. Hasta hoy el token vivía en el fichero de
// entorno DE LA FÁBRICA y los nombres de las variables salían de la configuración DE LA FÁBRICA:
// Bamburu avisaba con prestado. Ahora el bot es suyo y vive en su casa:
//
//   `/etc/bamburu.env` → `BAMBURU_TELEGRAM_TOKEN` y `BAMBURU_TELEGRAM_CHAT_ID`
//
// que es el `EnvironmentFile` que ya cargan `bamburu.service` y sus temporizadores, así que en
// producción llegan por `process.env` sin leer ningún disco. El respaldo de leer el fichero está
// para los guiones que corren a mano.
//
// ⚙️ CERRADO EL 3 SEP 2026 (remate de la decisión). La TUBERÍA (`enviar`, aquí debajo) ya no se
// importa de la carpeta de la fábrica: vive al lado, en `./telegram-transporte.js`. Se puede
// borrar `orchestrator/` entero y los avisos de Bamburu siguen saliendo — probado de verdad
// apartando la carpeta y lanzando un aviso. Lo vigila `scripts/censo-avisos-sin-fabrica.mjs`.
//
// ⚠️ LA REGLA QUE MANDA: **esto nunca lanza y nunca se queda colgado.** Quien avisa de una avería no
// puede convertirse en la avería. Devuelve `{ ok, motivo }` y el que llama decide qué hacer — pero
// lo que NO puede hacer nunca es impedir que el fallo del que avisa siga su curso.
//
// Y NO enciende el orquestador, que sigue parado por decisión de Ibrahin: se reutilizan su tubería
// (una librería que no lanza) y su canal (un chat).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { enviar } from './telegram-transporte.js';

const ENV_BAMBURU = '/etc/bamburu.env';

// Los nombres, aquí y no en un JSON de otro subsistema. Son dos cadenas: un fichero de
// configuración ajeno para guardarlas era justo el hilo que ataba los avisos de Bamburu a la fábrica.
export const VAR_TOKEN = 'BAMBURU_TELEGRAM_TOKEN';
export const VAR_CHAT = 'BAMBURU_TELEGRAM_CHAT_ID';

// Plazo corto a propósito: esto corre mientras algo se está muriendo (un arranque, una copia) y
// nadie debe esperar veinte segundos a que Telegram conteste. El orquestador usa 20 s porque allí
// no hay ningún proceso esperando.
export const PLAZO_MS = 5000;

/** Lee un fichero de entorno del disco. Nunca lanza y NUNCA devuelve el valor a ningún registro. */
export function leerEnvDeDisco(ruta) {
  const out = {};
  let texto;
  try { texto = readFileSync(ruta, 'utf8'); } catch { return out; }
  for (const linea of texto.split('\n')) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i <= 0) continue;
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[l.slice(0, i).trim()] = v;
  }
  return out;
}

/**
 * La configuración que espera el transporte, construida aquí con los nombres de Bamburu. Ya no se
 * lee de ningún fichero de la fábrica: **antes bastaba con que alguien tocara aquel bloque para
 * dejar a Bamburu mudo sin que nadie se enterara.**
 */
export function configDeTelegram() {
  return { vigia: { telegram: { tokenEnv: VAR_TOKEN, chatIdEnv: VAR_CHAT, timeoutMs: PLAZO_MS } } };
}

/**
 * LA CABECERA: quién habla y de qué. **3 sep 2026, encargo de Ibrahin:** «todo aviso de Bamburu
 * debe empezar identificando origen y tema, para saber quién habla sin abrir el mensaje».
 *
 * Se estampa AQUÍ, en la puerta, y no en cada sitio que avisa. El motivo es el de siempre en este
 * repo: lo que depende de que alguien se acuerde, un día se olvida — y el aviso que se olvide será
 * justo el del día raro. Sin `tema` no se manda: **es preferible un aviso que no sale y lo dice a
 * un aviso anónimo**, porque ahora este bot es de Bamburu y solo suyo.
 */
export function conCabecera(tema, texto) {
  return '<b>BAMBURU — ' + String(tema).trim() + '</b>\n' + texto;
}

/**
 * @param tema  de qué va, en una o dos palabras: «arranque», «copias»…
 * @returns { ok:boolean, motivo:string } — nunca lanza, nunca tarda más de PLAZO_MS.
 */
export async function mandarTelegram({ texto, tema }) {
  if (!tema || !String(tema).trim()) {
    return { ok: false, motivo: 'aviso sin tema: no se manda nada anónimo por el bot de Bamburu' };
  }
  const config = configDeTelegram();

  // El entorno del proceso manda —en producción las trae `EnvironmentFile=/etc/bamburu.env`— y
  // leer el fichero es el respaldo para los guiones que se lanzan a mano.
  const entorno = { ...leerEnvDeDisco(ENV_BAMBURU), ...process.env };
  if (!entorno[VAR_TOKEN] || !entorno[VAR_CHAT]) {
    return { ok: false, motivo: 'sin credenciales del bot de Bamburu (' + VAR_TOKEN + ' / ' + VAR_CHAT + ')' };
  }

  let r;
  try {
    // Doble cinturón: `enviar` ya trae su propio plazo, pero si algo lo dejara colgado, quien avisa
    // NO puede quedarse esperando.
    r = await Promise.race([
      enviar({ texto: conCabecera(tema, texto), config, entorno }),
      new Promise((res) => setTimeout(() => res({ ok: false, motivo: 'plazo agotado esperando a Telegram' }), PLAZO_MS + 500)),
    ]);
  } catch (e) { r = { ok: false, motivo: 'el envío falló: ' + (e?.message || e) }; }

  return r?.ok ? { ok: true, motivo: 'avisado por Telegram' } : { ok: false, motivo: r?.motivo || 'no se pudo avisar' };
}
