// core/llm.js — helper ÚNICO para llamar a Claude (Anthropic Messages API).
//
// REGLA (resultante de la migración del 2026-06-12): este archivo es el ÚNICO punto
// del código que conoce la clave API de Anthropic y el transporte (URL, cabeceras,
// versión de la API). NINGUNA otra parte del código puede:
//   - llamar a la API de Anthropic directamente (fetch a api.anthropic.com), ni
//   - leer ANTHROPIC_API_KEY ni /etc/bamburu.env para obtener la clave.
// Si necesitas hablar con Claude, hazlo SIEMPRE por callClaude(). El nombre del
// modelo lo elige y lo pasa quien llama (cada caso de uso usa el suyo); la clave y
// el transporte viven SOLO aquí. Para saber si la IA está configurada sin tocar la
// clave, usa hasAnthropicKey().
//
// Centraliza: lectura de la API key (env + fallback /etc/bamburu.env), URL,
// cabeceras y el manejo de errores. Admite `content` de cada mensaje como string
// O como array de bloques ({type:'text'|'image'|'document', ...}) — necesario para
// mandar fotos/PDF al modelo (visión).
//
// USO: la captura de factura (C2) y las 3 llamadas de conversación — DISA asistente
// (/message), store builder (/store-message) y onboarding/registro — pasan TODAS por
// callClaude(). (Migración del 2026-06-12.)

import { readFileSync } from 'fs';
import { getGlobalLlmSpend, addGlobalLlmSpend, markGlobalLlmAlerted } from './control-db.js';
import { sendEmail } from './mailer.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// ── Freno de gasto de Anthropic ────────────────────────────────────────────
// Precios verificado 19 jun 2026, fuente Anthropic ($ por millón de tokens, in/out).
const PRICING = {
  'claude-sonnet-5':           { in: 3,  out: 15 },   // chat de DISA (D4). Tarifa estándar $3/$15 por millón
  'claude-sonnet-4-6':         { in: 3,  out: 15 },   // se conserva: la extracción de facturas (visión) sigue en 4-6
  'claude-haiku-4-5-20251001': { in: 1,  out: 5  },
};
// OJO: un modelo que no esté en esta tabla cuenta como coste 0 (eurCost → 0), así que dejaría de
// contar para el tope de gasto. Al cambiar el modelo del chat hay que añadir su tarifa AQUÍ.
// Topes por MES NATURAL. 1 USD = 1 EUR a propósito (sobreestima → corta un pelín antes, lado seguro).
const TENANT_CAP_EUR   = 5;    // por negocio
const GLOBAL_CAP_EUR   = 50;   // suma de todos
const GLOBAL_ALERT_EUR = 40;   // aviso por email a Ibrahin al 80%

function currentMonth() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'

// Coste en € de una respuesta a partir de su `usage`. Cuenta TODO lo de entrada (incluida
// la caché) al precio de input → sobreestima (lado seguro). Modelo desconocido → 0.
function eurCost(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return 0;
  const inTok = (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
  const outTok = usage.output_tokens || 0;
  return inTok / 1e6 * p.in + outTok / 1e6 * p.out;
}

// Gasto por-negocio (tabla disa_spend de la BD del tenant). Tolerante a fallos de BD.
function tenantSpendEur(db, month) {
  try { return db.prepare('SELECT eur FROM disa_spend WHERE month=?').get(month)?.eur || 0; }
  catch { return 0; }
}
// Tope por-negocio: el que fije el superadmin en platform_limits, o el default TENANT_CAP_EUR.
function tenantCapEur(db) {
  try {
    const v = db.prepare("SELECT value FROM platform_limits WHERE key='ai_cap_eur'").get()?.value;
    return (typeof v === 'number' && v >= 0) ? v : TENANT_CAP_EUR;
  } catch { return TENANT_CAP_EUR; }
}
function addTenantSpendEur(db, month, eur) {
  try {
    db.prepare(`INSERT INTO disa_spend (month, eur) VALUES (?, ?)
                ON CONFLICT(month) DO UPDATE SET eur = eur + excluded.eur`).run(month, eur);
  } catch { /* el registro nunca rompe la llamada */ }
}

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

// ¿Hay clave configurada? Permite a las rutas mostrar su mensaje de "IA no
// configurada" sin leer ni conocer la clave (que vive solo aquí).
export function hasAnthropicKey() {
  return !!getAnthropicKey();
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
  const { model, system, messages, max_tokens = 1500, tools, timeoutMs = 30000 } = opts;
  if (!model) { const e = new Error('Falta el modelo'); e.status = 500; throw e; }
  if (!Array.isArray(messages) || !messages.length) { const e = new Error('Faltan mensajes'); e.status = 500; throw e; }

  const apiKey = opts.apiKey || getAnthropicKey();
  if (!apiKey) { const e = new Error('La IA no está configurada (falta ANTHROPIC_API_KEY)'); e.status = 500; throw e; }

  // ── Freno PREVENTIVO de gasto: si ya se superó el tope, NO se llama a la API. ──
  // opts.billDb = BD del tenant (factura por-negocio + tope 5 €). Si no se pasa, solo cuenta al global.
  const billDb = opts.billDb || null;
  const month = currentMonth();
  let globalBefore = null;
  try { globalBefore = getGlobalLlmSpend(month); } catch { /* sin control.db legible: no bloquea */ }
  if (globalBefore && globalBefore.eur >= GLOBAL_CAP_EUR) {
    const e = new Error('DISA ha llegado al límite de uso de este mes. Inténtalo de nuevo el mes que viene.');
    e.status = 429; e.code = 'llm_global_cap'; throw e;
  }
  if (billDb && tenantSpendEur(billDb, month) >= tenantCapEur(billDb)) {
    const e = new Error('DISA ha llegado a su límite de uso de este mes para tu negocio.');
    e.status = 429; e.code = 'llm_tenant_cap'; throw e;
  }

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
      signal: AbortSignal.timeout(Math.max(1000, Math.min(Number(timeoutMs) || 30000, 120000))),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const e = new Error(timedOut ? 'La IA tardó demasiado en responder.' : 'No se pudo contactar con la IA.');
    e.status = timedOut ? 504 : 502;
    e.code = timedOut ? 'llm_timeout' : 'llm_transport';
    throw e;
  }

  if (!resp.ok) {
    let detail = '';
    try { const j = await resp.json(); detail = j?.error?.message || JSON.stringify(j); } catch { detail = 'HTTP ' + resp.status; }
    const noBalance = /credit balance|billing|payment/i.test(detail);
    const e = new Error(noBalance
      ? 'El proveedor de IA no tiene saldo disponible.'
      : 'El proveedor de IA rechazó temporalmente la solicitud.');
    e.status = noBalance ? 503 : 502;
    e.code = noBalance ? 'llm_provider_balance' : 'llm_provider_error';
    throw e;
  }
  let data;
  try { data = await resp.json(); }
  catch {
    const e = new Error('El proveedor de IA devolvió una respuesta inválida.');
    e.status = 502; e.code = 'llm_invalid_response'; throw e;
  }
  if (!data || !Array.isArray(data.content) || typeof data.stop_reason !== 'string') {
    const e = new Error('El proveedor de IA devolvió una respuesta incompleta.');
    e.status = 502; e.code = 'llm_incomplete_response'; throw e;
  }

  // ── Registro de gasto (después de gastar). Nunca rompe la respuesta. ──
  try {
    const eur = eurCost(data.model || model, data.usage);
    if (eur > 0) {
      addGlobalLlmSpend(month, eur);
      if (billDb) addTenantSpendEur(billDb, month, eur);
      const after = getGlobalLlmSpend(month);
      if (after.eur >= GLOBAL_ALERT_EUR && !after.alerted_80) {
        markGlobalLlmAlerted(month);   // marca antes de enviar → no se repite el aviso
        sendEmail({
          from: 'Bamburu <noreply@bamburu.com>',
          to: 'ibrahingil@gmail.com',
          subject: `⚠️ Gasto Anthropic al 80% (${month})`,
          text: `El gasto global de Anthropic este mes (${month}) va por ${after.eur.toFixed(2)} €.\n`
            + `Umbral de aviso: ${GLOBAL_ALERT_EUR} € (80%). DISA se pausa automáticamente al llegar a ${GLOBAL_CAP_EUR} €.`,
        }).catch(() => {});
      }
    }
  } catch { /* el registro de gasto nunca rompe la respuesta */ }

  return data;
}

// Atajo: concatena el texto de los bloques `text` de la respuesta (ignora tool_use).
export function textFromResponse(apijson) {
  if (!apijson || !Array.isArray(apijson.content)) return '';
  return apijson.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}
