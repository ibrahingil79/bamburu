// core/llm.js — helper ÚNICO para llamar a Claude (Anthropic Messages API).
//
// Centraliza: lectura de la API key (env + fallback /etc/bamburu.env), URL,
// cabeceras y el manejo de errores. Admite `content` de cada mensaje como string
// O como array de bloques ({type:'text'|'image'|'document', ...}) — necesario para
// mandar fotos/PDF al modelo (visión), que el camino actual (content string) no hace.
//
// USO: hoy SOLO lo usa el código nuevo de C2 (captura de factura de proveedor).
// Las 3 llamadas existentes (DISA asistente, store builder, onboarding) NO se
// migran en esta tarea — queda anotado como pendiente técnico en TABLERO.md.

import { readFileSync } from 'fs';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// API key: variable de entorno primero; fallback a /etc/bamburu.env (producción).
// Mismo patrón que las 3 llamadas actuales, aquí en un único sitio.
export function getAnthropicKey() {
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    try {
      const env = readFileSync('/etc/bamburu.env', 'utf8');
      const match = env.match(/ANTHROPIC_API_KEY=(.+)/);
      if (match) apiKey = match[1].trim();
    } catch { /* sin fichero: queda sin key */ }
  }
  return apiKey || null;
}

// Bloque de imagen base64 para el array `content` de un mensaje de usuario.
// mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'.
export function imageBlock(base64, mediaType) {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
}

// Bloque de documento (PDF) base64.
export function documentBlock(base64, mediaType = 'application/pdf') {
  return { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } };
}

// Llama a Claude y devuelve la respuesta JSON cruda de la API (con .content, etc.).
// opts: { model, system?, messages, max_tokens?, tools?, apiKey?, fetchImpl? }
// - messages: [{ role, content }] donde content es string o array de bloques.
// - Lanza Error con .status si no hay key (500) o si la API responde error (502).
// - fetchImpl: inyectable para tests (por defecto, fetch global).
export async function callClaude(opts = {}) {
  const { model, system, messages, max_tokens = 1500, tools } = opts;
  if (!model) { const e = new Error('Falta el modelo'); e.status = 500; throw e; }
  if (!Array.isArray(messages) || !messages.length) { const e = new Error('Faltan mensajes'); e.status = 500; throw e; }

  const apiKey = opts.apiKey || getAnthropicKey();
  if (!apiKey) { const e = new Error('La IA no está configurada (falta ANTHROPIC_API_KEY)'); e.status = 500; throw e; }

  const doFetch = opts.fetchImpl || fetch;
  const body = { model, max_tokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;

  let resp;
  try {
    resp = await doFetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const e = new Error('No se pudo contactar con la IA: ' + (err.message || err)); e.status = 502; throw e;
  }

  if (!resp.ok) {
    let detail = '';
    try { const j = await resp.json(); detail = j?.error?.message || JSON.stringify(j); } catch { detail = 'HTTP ' + resp.status; }
    const e = new Error('La IA devolvió un error: ' + detail); e.status = 502; throw e;
  }
  return resp.json();
}

// Atajo: concatena el texto de los bloques `text` de la respuesta (ignora tool_use).
export function textFromResponse(apijson) {
  if (!apijson || !Array.isArray(apijson.content)) return '';
  return apijson.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}
