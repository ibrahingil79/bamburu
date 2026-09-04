// telegram-transporte.js — El transporte. Envía partes y, desde el 31 ago 2026, TAMBIÉN escucha.
//
// ~~El vigía INFORMA y no recibe órdenes: no hay long-polling, ni webhook, ni comandos. Un bot
// que solo escribe no puede ser usado para mandar sobre el servidor, y eso es deliberado.~~
//
// ⚙️ CAMBIADO EL 31 ago 2026 POR ENCARGO DE IBRAHIN. El bot ahora recibe órdenes desde el
// móvil. La preocupación de la frase tachada sigue siendo la correcta, y por eso el permiso
// NO vive aquí: este fichero es tubería —mete y saca mensajes— y no decide nada. Quién puede
// mandar y QUÉ se puede mandar estaba en vigia/ordenes.js, en una lista cerrada — y ese permiso
// ya no aplica: ver el aviso de más abajo.
//
//   · las órdenes eran un enum fijo. NO había forma de mandar una orden libre al servidor:
//     el texto que llegaba nunca se ejecutaba, solo se comparaba contra esa lista;
//   · ni el token ni ningún secreto salían por el chat (todo pasaba por `tapar`, aquí abajo).
//
// ⚙️ MOVIDO EL 3 SEP 2026 (remate de la decisión del bot exclusivo de Bamburu, Ibrahin) — de
// `orchestrator/vigia/telegram.js` A AQUÍ. El bot ya es solo de los avisos de Bamburu: la tubería
// que lo habla tiene que vivir en territorio de Bamburu, no importarse desde la carpeta de la
// fábrica. **La fábrica, si algún día revive con bot propio, importará ESTE fichero — no al
// revés.** Cambio quirúrgico: mover y recablear, sin tocar el comportamiento de una sola línea de
// `enviar`, `recibir`, `postear` o `responderA`.
//
// Lo único que exigió un ajuste real fue `tapar()`: vivía en `orchestrator/nucleo/secretos.js`,
// que sigue siendo de la fábrica (lo usan `escucha.js` y `orq.js` para más cosas que Telegram, así
// que no se mueve entero). Traerlo tal cual habría vuelto a importar desde la fábrica; copiarlo
// entero habría duplicado una lista de secretos que no le corresponde a este fichero. Se queda,
// aquí abajo, SOLO la parte que este transporte de verdad usa: tapar un token de Telegram POR SU
// FORMA en las respuestas de la API y en los errores de red — que es exactamente lo que las cuatro
// llamadas a `tapar(...)` de este fichero hacían, ni más ni menos.
// ⚙️ 4 SEP 2026 — ESTA TUBERÍA YA SOLO SABE HABLAR. Encargo de Ibrahin: «quita todo lo que tenía
// que ver con el antiguo bot». Aquí vivían además `recibir` (el sondeo de mensajes), `responderA`
// (contestar a un chat) y `marcaTeclado` (los botones fijos). Eran las manos y los oídos del vigía
// de la fábrica, retirado el 3 de septiembre.
//
// NO SE HAN COMENTADO NI DESACTIVADO: SE HAN BORRADO. Un cerrojo se quita por descuido —bastaba con
// volver a llamar a `recibir` desde cualquier sitio— y el 3 de septiembre se midió lo que eso cuesta:
// el vigía llevaba 30 horas escuchando y EJECUTANDO órdenes con la fábrica parada. Lo que no existe
// no se vuelve a encender sin escribirlo entero otra vez, y eso ya no es un descuido: es una decisión.
//
// Queda lo que Bamburu usa de verdad: `enviar`. Sin `teclado`, porque los botones eran el mando de
// la fábrica y no hay ningún aviso de Bamburu que se pulse.

import https from 'node:https';

// Un token de bot de Telegram tiene esta forma: 8+ dígitos, dos puntos, 20+ caracteres. Bastaba
// con la forma (no con el VALOR de una variable de entorno) porque lo que aquí se tapa es lo que
// *Telegram* o la red devuelven, nunca texto arbitrario del negocio — y Telegram no repite hacia
// atrás ningún otro secreto de Bamburu.
const FORMA_TOKEN_TELEGRAM = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g;
function tapar(texto) { return String(texto ?? '').replace(FORMA_TOKEN_TELEGRAM, '«token tapado»'); }

/** Qué falta por poner para poder avisar. Interno: lo usa `enviar` para explicarse. */
function queFalta(config, entorno = process.env) {
  const t = config.vigia.telegram;
  const falta = [];
  if (!entorno[t.tokenEnv]) falta.push(t.tokenEnv);
  if (!entorno[t.chatIdEnv]) falta.push(t.chatIdEnv);
  return falta;
}

/**
 * El teclado fijo, en el formato de Telegram.
 *
 * ⚙️ NI `one_time_keyboard` NI NADA QUE LO ESCONDA (1 sep 2026). El encargo dice «el teclado se
 * queda fijo, no desaparece al usarlo», y eso es exactamente lo contrario de `one_time_keyboard`,
 * que lo pliega en cuanto tocas un botón. `is_persistent` pide que siga ahí aunque Telegram
 * enseñe el teclado normal, y `resize_keyboard` lo deja de la altura de dos filas en vez de
 * comerse media pantalla del móvil.
 *
 * Y NO se pone `selective`: el chat es de una sola persona y ese campo solo complica.
 */

/**
 * @param teclado filas de textos YA COMPROBADAS por `ordenes.revisarTeclado`, o `null`.
 *                Aquí no se valida nada: este fichero es tubería y no sabe qué es una orden.
 * @param poster  quién hace el POST. Se inyecta SOLO para poder probar el respaldo de abajo.
 *
 * ⚙️ POR QUÉ EL RESPALDO SE PRUEBA CON UN DOBLE Y NO CONTRA TELEGRAM (1 sep 2026). Se intentó
 * provocarlo de verdad, mandando un botón con el texto vacío para que Telegram devolviera 400.
 * **No lo devolvió: lo aceptó**, y dejó el chat de Ibrahin con un teclado de un solo botón en
 * blanco (se repuso en el acto). O sea que no hay forma fiable de provocar ese 400 desde fuera
 * sin estropearle el móvil, y un respaldo que no se puede ejercitar es un respaldo que no se
 * sabe si existe. Se inyecta el transporte y se prueba el camino entero, que es lo único
 * honesto que queda. Lo que sí quedó medido: **Telegram no valida el teclado por nosotros**,
 * así que quien tiene que rechazar un botón vacío es `revisarTeclado`, y lo hace.
 * @returns { ok, motivo?, reintentable } — nunca lanza: un Telegram caído no puede tumbar nada.
 */
export function enviar({ texto, config, entorno = process.env, poster = postear }) {
  const t = config.vigia.telegram;
  const token = entorno[t.tokenEnv];
  const chatId = entorno[t.chatIdEnv];

  if (!token || !chatId) {
    return Promise.resolve({ ok: false, reintentable: true,
      motivo: `sin configurar: falta ${queFalta(config, entorno).join(' y ')}` });
  }

  // ⚙️ 4 SEP 2026 — AQUÍ HABÍA UN `teclado` Y UN REINTENTO. El teclado eran los botones fijos del
  // mando de la fábrica, y el reintento existía porque `reply_markup` viaja DENTRO del mismo envío:
  // un teclado que Telegram rechazara devolvía 400 y se llevaba por delante el mensaje entero. Sin
  // botones no hay nada que pueda tumbar el mensaje, así que el reintento tampoco hace falta. Un
  // camino menos por el que un aviso puede no salir.
  return poster({
    token,
    cuerpo: JSON.stringify({
      chat_id: chatId,
      text: texto.slice(0, 4096),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    timeoutMs: t.timeoutMs,
  });
}
function postear({ token, cuerpo, timeoutMs }) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(cuerpo) },
    }, (res) => {
      let datos = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { datos += d; });
      res.on('end', () => {
        if (res.statusCode === 200) return resolve({ ok: true });
        let desc = datos.slice(0, 200);
        try { desc = JSON.parse(datos).description || desc; } catch { /* se queda el crudo */ }
        desc = tapar(desc);   // la respuesta viene de fuera: no se escribe sin tapar
        // 4xx que no sea 429 es configuración: reintentarlo no arregla un token malo.
        const reintentable = res.statusCode === 429 || res.statusCode >= 500;
        resolve({ ok: false, reintentable, codigo: res.statusCode, motivo: `Telegram respondió ${res.statusCode}: ${desc}` });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('tiempo agotado')); });
    req.on('error', (e) => resolve({ ok: false, reintentable: true, motivo: tapar(`red: ${e.message}`) }));
    req.end(cuerpo);
  });
}

