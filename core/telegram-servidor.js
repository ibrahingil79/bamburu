// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MANDAR UN TELEGRAM DESDE EL SERVIDOR — el único sitio, para el arranque y para las copias.
//
// DE DÓNDE SALE. El cierre 7 (AUD-007) construyó esto dentro de `core/aviso-arranque.js` para avisar
// de un arranque roto. El cierre 8 (AUD-008) necesita lo mismo para avisar de una copia de seguridad
// que falla. **Copiarlo habría sido un camino paralelo**: dos sitios que leen credenciales, dos
// plazos, dos formas de fallar, y el día que cambie el nombre de una variable, uno de los dos deja
// de avisar sin que nadie se entere. Así que se extrae aquí y los dos lo usan.
//
// DE DÓNDE SALEN LAS CREDENCIALES. El token y el chat viven en `/etc/orquestador.env`
// (`ORQUESTADOR_TELEGRAM_TOKEN` / `..._CHAT_ID`) y los servicios de Bamburu cargan
// `/etc/bamburu.env`, que no los tiene. Los dos ficheros son `0600 ubuntu:ubuntu` y los servicios
// corren como `ubuntu`, así que se leen del disco cuando no están en el entorno. **No se duplica el
// secreto** ni hace falta tocar `/etc` ni ninguna unit.
//
// ⚠️ LA REGLA QUE MANDA: **esto nunca lanza y nunca se queda colgado.** Quien avisa de una avería no
// puede convertirse en la avería. Devuelve `{ ok, motivo }` y el que llama decide qué hacer — pero
// lo que NO puede hacer nunca es impedir que el fallo del que avisa siga su curso.
//
// Y NO enciende el orquestador, que sigue parado por decisión de Ibrahin: se reutilizan su tubería
// (una librería que no lanza) y su canal (un chat).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enviar } from '../orchestrator/vigia/telegram.js';

const ENV_ORQUESTADOR = '/etc/orquestador.env';
const CONFIG_ORQUESTADOR = 'orchestrator/orquestador.config.json';

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
 * Los NOMBRES de las variables salen de la configuración del orquestador, no se teclean aquí: si
 * alguien las renombra allí, esto lo sigue. Si el fichero no se puede leer, `null`.
 */
export function configDeTelegram(raiz) {
  try {
    const c = JSON.parse(readFileSync(join(raiz, CONFIG_ORQUESTADOR), 'utf8'));
    const t = c?.vigia?.telegram;
    if (!t?.tokenEnv || !t?.chatIdEnv) return null;
    return { vigia: { telegram: { ...t, timeoutMs: PLAZO_MS } } };
  } catch { return null; }
}

/** @returns { ok:boolean, motivo:string } — nunca lanza, nunca tarda más de PLAZO_MS. */
export async function mandarTelegram({ texto, raiz = process.cwd() }) {
  const config = configDeTelegram(raiz);
  if (!config) return { ok: false, motivo: 'sin configuración de Telegram (' + CONFIG_ORQUESTADOR + ' ilegible)' };

  // El entorno del proceso manda; el fichero del orquestador es el respaldo.
  const entorno = { ...leerEnvDeDisco(ENV_ORQUESTADOR), ...process.env };

  let r;
  try {
    // Doble cinturón: `enviar` ya trae su propio plazo, pero si algo lo dejara colgado, quien avisa
    // NO puede quedarse esperando.
    r = await Promise.race([
      enviar({ texto, config, entorno }),
      new Promise((res) => setTimeout(() => res({ ok: false, motivo: 'plazo agotado esperando a Telegram' }), PLAZO_MS + 500)),
    ]);
  } catch (e) { r = { ok: false, motivo: 'el envío falló: ' + (e?.message || e) }; }

  return r?.ok ? { ok: true, motivo: 'avisado por Telegram' } : { ok: false, motivo: r?.motivo || 'no se pudo avisar' };
}
