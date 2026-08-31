// telegram.js — El transporte. Envía partes y, desde el 31 ago 2026, TAMBIÉN escucha.
//
// ~~El vigía INFORMA y no recibe órdenes: no hay long-polling, ni webhook, ni comandos. Un bot
// que solo escribe no puede ser usado para mandar sobre el servidor, y eso es deliberado.~~
//
// ⚙️ CAMBIADO EL 31 ago 2026 POR ENCARGO DE IBRAHIN. El bot ahora recibe órdenes desde el
// móvil. La preocupación de la frase tachada sigue siendo la correcta, y por eso el permiso
// NO vive aquí: este fichero es tubería —mete y saca mensajes— y no decide nada. Quién puede
// mandar y QUÉ se puede mandar está en vigia/ordenes.js, en una lista cerrada:
//
//   · solo obedece al chat de Ibrahin; cualquier otro se ignora y se anota;
//   · las órdenes son un enum fijo. NO hay forma de mandar una orden libre al servidor:
//     el texto que llega nunca se ejecuta, solo se compara contra esa lista;
//   · ni el token ni ningún secreto salen por el chat (todo pasa por `tapar`).
import https from 'node:https';
import { tapar } from '../nucleo/secretos.js';

export function configurado(config, entorno = process.env) {
  const t = config.vigia.telegram;
  return Boolean(entorno[t.tokenEnv] && entorno[t.chatIdEnv]);
}

export function queFalta(config, entorno = process.env) {
  const t = config.vigia.telegram;
  const falta = [];
  if (!entorno[t.tokenEnv]) falta.push(t.tokenEnv);
  if (!entorno[t.chatIdEnv]) falta.push(t.chatIdEnv);
  return falta;
}

/** @returns { ok, motivo?, reintentable } — nunca lanza: un Telegram caído no puede tumbar nada. */
export function enviar({ texto, config, entorno = process.env }) {
  const t = config.vigia.telegram;
  const token = entorno[t.tokenEnv];
  const chatId = entorno[t.chatIdEnv];

  if (!token || !chatId) {
    return Promise.resolve({ ok: false, reintentable: true,
      motivo: `sin configurar: falta ${queFalta(config, entorno).join(' y ')}` });
  }

  const cuerpo = JSON.stringify({
    chat_id: chatId,
    text: texto.slice(0, 4096),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      timeout: t.timeoutMs,
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
        resolve({ ok: false, reintentable, motivo: `Telegram respondió ${res.statusCode}: ${desc}` });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('tiempo agotado')); });
    req.on('error', (e) => resolve({ ok: false, reintentable: true, motivo: tapar(`red: ${e.message}`) }));
    req.end(cuerpo);
  });
}


/**
 * Escucha. Long polling: la petición se queda abierta hasta `esperaS` segundos esperando a
 * que llegue algo, en vez de preguntar mil veces por segundo.
 *
 * NO interpreta nada: devuelve los mensajes tal cual llegan, con su chat y su texto en crudo.
 * Quién manda y qué se puede mandar lo decide `vigia/ordenes.js`.
 *
 * @returns { ok, mensajes:[{ updateId, chatId, texto, de, cuando }], siguienteOffset, motivo? }
 *          Nunca lanza: un Telegram caído no puede tumbar al vigía.
 */
export function recibir({ config, entorno = process.env, offset = 0, esperaS = 50 } = {}) {
  const t = config.vigia.telegram;
  const token = entorno[t.tokenEnv];
  if (!token) {
    return Promise.resolve({ ok: false, reintentable: true, mensajes: [], siguienteOffset: offset,
                             motivo: `sin configurar: falta ${t.tokenEnv}` });
  }

  const cuerpo = JSON.stringify({
    offset,
    timeout: esperaS,
    // Solo mensajes de texto. Ni fotos, ni audios, ni pulsaciones de botón: menos superficie.
    allowed_updates: ['message'],
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/getUpdates`,
      method: 'POST',
      // El margen sobre la espera larga es a propósito: si se cortara a los `timeoutMs` de un
      // envío normal, TODAS las esperas largas morirían por tiempo agotado y el vigía daría
      // vueltas en vano.
      timeout: (esperaS + 15) * 1000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(cuerpo) },
    }, (res) => {
      let datos = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { datos += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let desc = datos.slice(0, 200);
          try { desc = JSON.parse(datos).description || desc; } catch { /* se queda el crudo */ }
          return resolve({ ok: false, reintentable: res.statusCode === 429 || res.statusCode >= 500,
                           mensajes: [], siguienteOffset: offset,
                           motivo: tapar(`Telegram respondió ${res.statusCode}: ${desc}`) });
        }
        let cuerpoJson;
        try { cuerpoJson = JSON.parse(datos); }
        catch (e) { return resolve({ ok: false, reintentable: true, mensajes: [], siguienteOffset: offset,
                                     motivo: tapar(`respuesta ilegible: ${e.message}`) }); }

        const updates = Array.isArray(cuerpoJson.result) ? cuerpoJson.result : [];
        const mensajes = [];
        let mayor = offset;
        for (const u of updates) {
          const id = Number(u.update_id);
          if (Number.isFinite(id) && id >= mayor) mayor = id + 1;   // +1: Telegram da por leído hasta aquí
          const m = u.message;
          if (!m || typeof m.text !== 'string') continue;
          mensajes.push({
            updateId: id,
            chatId: String(m.chat?.id ?? ''),
            texto: m.text,
            // Solo para el registro de quién intentó qué. Nunca se usa para decidir permiso.
            de: String(m.from?.username || m.from?.id || 'desconocido'),
            cuando: new Date((Number(m.date) || 0) * 1000).toISOString(),
          });
        }
        resolve({ ok: true, mensajes, siguienteOffset: mayor });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('tiempo agotado')); });
    req.on('error', (e) => resolve({ ok: false, reintentable: true, mensajes: [], siguienteOffset: offset,
                                     motivo: tapar(`red: ${e.message}`) }));
    req.end(cuerpo);
  });
}

/** Envía a UN chat concreto (el que preguntó), no al chat del parte. */
export function responderA({ chatId, texto, config, entorno = process.env }) {
  return enviar({ texto, config, entorno: { ...entorno, [config.vigia.telegram.chatIdEnv]: chatId } });
}
