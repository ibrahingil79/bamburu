// telegram.js — El transporte. Solo envía; no escucha nada.
//
// El vigía INFORMA y no recibe órdenes: no hay long-polling, ni webhook, ni comandos. Un bot
// que solo escribe no puede ser usado para mandar sobre el servidor, y eso es deliberado.
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
