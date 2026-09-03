// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL BOT DE TELEGRAM YA NO ES DE LA FÁBRICA — decisión de Ibrahin, 3 de septiembre de 2026.
//
// LA DECISIÓN, en sus términos: **el bot de Telegram queda dedicado en exclusiva a los avisos de
// Bamburu** (arranque, copias y lo que se sume). El orquestador —la fábrica— **no puede usarlo**.
// Y no se crea uno nuevo para la fábrica: está parada, y se creará el día que se encienda.
//
// POR QUÉ HACE FALTA UN CERROJO Y NO BASTA CON QUITARLE EL TOKEN. Porque quitar credenciales es
// reversible por descuido: cualquiera que mañana copie dos líneas a un fichero de entorno «para
// probar» tendría a la fábrica hablando otra vez por el bot de Ibrahin. Y no era teórico: el
// 3 sep 2026, con el orquestador PARADO desde el día 2, **su vigía llevaba 30 horas escuchando
// órdenes por este bot con `Restart=always`** — y no solo hablando: ejecutando órdenes en el
// servidor (fue quien recibió el «PARAR» que paró la fábrica). Las manos se cortaron; esto es
// para que no vuelvan a crecer solas.
//
// DÓNDE VA: al principio de CADA camino de la fábrica que hablaba o escuchaba por el bot
// (`vigia/parte.js`, `vigia/escucha.js`, `orq.js`). NO va dentro de `vigia/telegram.js`, que es
// tubería compartida: Bamburu manda sus avisos por ahí y este cerrojo lo dejaría mudo también.
// `scripts/censo-bot-de-bamburu.mjs` se pone rojo si alguna pieza de la fábrica vuelve a llamar
// al transporte sin pasar por aquí.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export const MOTIVO =
  'El bot de Telegram es EXCLUSIVO de los avisos de Bamburu desde el 3 sep 2026 (decisión de '
  + 'Ibrahin). La fábrica no habla ni escucha por él. Si algún día se enciende, tendrá su propio bot.';

/**
 * Contesta lo mismo que contestaría el transporte si no hubiera podido enviar, para que quien
 * llame no reviente: la fábrica está parada y esto no debe ser lo que la tire el día que arranque.
 * **Nunca lanza.** Lo que hace es NO HABLAR.
 */
export function botRetirado(quien) {
  const linea = '[bot retirado] ' + quien + ': ' + MOTIVO;
  try { console.warn(linea); } catch { /* sin consola, da igual: lo que importa es no enviar */ }
  return { ok: false, reintentable: false, motivo: MOTIVO };
}

/** Para los caminos que ESCUCHAN: la misma forma que devuelve `recibir`, pero sin nada dentro. */
export function escuchaRetirada(quien) {
  botRetirado(quien);
  return { ok: false, mensajes: [], siguienteOffset: 0, motivo: MOTIVO };
}
