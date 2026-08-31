// token-monitor.js — ¿hay saldo para trabajar? Con caché de 5 minutos.
//
// LÉEME ANTES DE CAMBIAR NADA AQUÍ
// ────────────────────────────────
// La API de Anthropic NO tiene ningún endpoint que devuelva «créditos restantes».
// La Admin API cubre miembros, workspaces, claves, límites de tasa e informes de
// uso y coste; ninguno da un saldo. Así que aquí no se consulta un saldo: se
// PREGUNTA A LA PUERTA. Se lanza la petición más barata posible y se mira qué
// contesta, que es la única señal real de si se puede trabajar ahora mismo:
//
//   200            → hay saldo.
//   429            → agotado por límite de tasa; `retry-after` dice cuándo vuelve.
//   400 de crédito → agotado por saldo; no vuelve solo, hace falta una persona.
//   401 / 403      → problema de configuración, no de saldo.
//   5xx / red      → NO SE SABE. Ojo: «no se sabe» no es «no hay saldo».
//
// `remaining` sale de las cabeceras de límite de tasa cuando vienen, y vale
// `null` cuando no. Es preferible un null honesto a un número inventado.
import https from 'node:https';
import { execFile } from 'node:child_process';

const CACHE_MS = Number(process.env.ORCHESTRATOR_BALANCE_CACHE || 5 * 60 * 1000);
const MODELO = process.env.ORCHESTRATOR_PROBE_MODEL || 'claude-opus-5';
const BIN_CLAUDE = process.env.ORCHESTRATOR_CLAUDE_BIN || 'claude';

// Frases con las que una puerta cerrada se anuncia, en la API y en la CLI.
//
// Van como FRASES, no como palabras sueltas, y el motivo es una cicatriz: con
// «límite» a secas, el prompt de revisión —que pide mirar los «casos límite»—
// hacía creer al daemon que la cuenta se había quedado sin saldo.
const SIN_SALDO = /credit balance|insufficient (?:credit|funds|quota)|billing|usage limit|rate.?limit|limit reached|quota exceeded|too many requests|out of credits|resets? at|l[ií]mite (?:de uso|de tasa|alcanzado)|sin (?:saldo|cr[eé]dito)|upgrade to/i;

let cache = null;

/** ¿Este texto de salida huele a puerta cerrada por límite o por saldo? */
export function pareceSinSaldo(texto) { return SIN_SALDO.test(String(texto || '')); }

export function limpiarCache() { cache = null; }

function estadoDe(estado, extra = {}) {
  return {
    hasBalance: estado === 'ok',
    remaining: extra.remaining ?? null,
    reset_date: extra.reset_date ?? null,
    estado,                       // ok | sin-saldo | desconocido | configuracion
    fuente: extra.fuente ?? null, // api | claude-cli | despacho | ninguna
    motivo: extra.motivo ?? '',
    limites: extra.limites ?? {},
  };
}

/**
 * Guarda en la caché lo que acaba de pasar de verdad.
 * Un despacho que ha funcionado prueba que hay saldo mejor que cualquier sonda,
 * y encima sale gratis. Un despacho que murió por límite ahorra la sonda siguiente.
 */
export function registrarResultado(estado, motivo = '', extra = {}) {
  cache = { valor: estadoDe(estado, { fuente: 'despacho', motivo, ...extra }), ts: Date.now() };
  return cache.valor;
}

export async function consultarSaldo({ forzar = false } = {}) {
  if (!forzar && cache && Date.now() - cache.ts < CACHE_MS) {
    return { ...cache.valor, edadCache: Math.round((Date.now() - cache.ts) / 1000) };
  }
  const valor = process.env.ANTHROPIC_API_KEY ? await sondaApi() : await sondaCli();
  cache = { valor, ts: Date.now() };
  return { ...valor, edadCache: 0 };
}

// ── Sonda contra la API ──────────────────────────────────────────────────────

function leerLimites(cabeceras) {
  const limites = {};
  for (const [clave, valor] of Object.entries(cabeceras)) {
    const m = /^(?:x-|anthropic-)?ratelimit-(remaining|limit|reset)-(.+)$/i.exec(clave);
    if (m) limites[`${m[1].toLowerCase()}-${m[2].toLowerCase()}`] = String(valor);
  }
  if (cabeceras['retry-after']) limites['retry-after'] = String(cabeceras['retry-after']);
  return limites;
}

function restantesYReinicio(limites) {
  const numeros = Object.entries(limites)
    .filter(([k]) => k.startsWith('remaining-') && k.includes('token'))
    .map(([, v]) => Number(v))
    .filter((n) => Number.isFinite(n));
  const peticiones = Number(limites['remaining-requests']);
  const remaining = numeros.length ? Math.min(...numeros)
    : (Number.isFinite(peticiones) ? peticiones : null);

  let reset_date = null;
  const espera = Number(limites['retry-after']);
  if (Number.isFinite(espera)) reset_date = new Date(Date.now() + espera * 1000).toISOString();
  else {
    const marca = Object.entries(limites).find(([k]) => k.startsWith('reset-'));
    if (marca) { const d = new Date(marca[1]); if (!Number.isNaN(d.getTime())) reset_date = d.toISOString(); }
  }
  return { remaining, reset_date };
}

function interpretarApi(codigo, cabeceras, cuerpo) {
  const limites = leerLimites(cabeceras);
  const { remaining, reset_date } = restantesYReinicio(limites);
  const base = { fuente: 'api', limites, remaining, reset_date };

  let mensaje = '';
  try { mensaje = JSON.parse(cuerpo)?.error?.message || ''; } catch { mensaje = String(cuerpo).slice(0, 200); }

  if (codigo === 200) return estadoDe('ok', { ...base, motivo: 'la API responde' });
  if (codigo === 429) return estadoDe('sin-saldo', { ...base, motivo: `429 límite de tasa: ${mensaje || 'sin detalle'}` });
  if (codigo === 400 && SIN_SALDO.test(mensaje)) {
    return estadoDe('sin-saldo', { ...base, reset_date: null, motivo: `400 crédito: ${mensaje}` });
  }
  if (codigo === 400) return estadoDe('configuracion', { ...base, motivo: `400 petición inválida (fallo de la sonda, no del saldo): ${mensaje}` });
  if (codigo === 401 || codigo === 403) return estadoDe('configuracion', { ...base, motivo: `${codigo}: ${mensaje || 'clave inválida o sin permiso'}` });
  return estadoDe('desconocido', { ...base, motivo: `HTTP ${codigo}: ${mensaje || 'sin detalle'}` });
}

function sondaApi() {
  const cuerpo = JSON.stringify({ model: MODELO, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', timeout: 20000,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(cuerpo),
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let datos = '';
      res.setEncoding('utf8');
      res.on('data', (t) => { datos += t; });
      res.on('end', () => resolve(interpretarApi(res.statusCode, res.headers, datos)));
    });
    req.on('timeout', () => req.destroy(new Error('tiempo agotado')));
    req.on('error', (e) => resolve(estadoDe('desconocido', { fuente: 'api', motivo: `red: ${e.message}` })));
    req.end(cuerpo);
  });
}

// ── Sonda contra la CLI de Claude Code ───────────────────────────────────────
// Sin ANTHROPIC_API_KEY, quien hace el trabajo es la CLI con la sesión de Ibrahin,
// así que preguntarle a ella es preguntarle a la cuenta correcta. Cuesta unos
// pocos tokens; la caché de 5 min lo deja en 12 sondas por hora como mucho.

function sondaCli() {
  return new Promise((resolve) => {
    execFile(BIN_CLAUDE, ['-p', 'ok', '--model', MODELO],
      { timeout: 120000, maxBuffer: 4 * 1024 * 1024, cwd: process.cwd() },
      (err, salida, errores) => {
        const texto = `${salida || ''}\n${errores || ''}`.trim();
        if (!err) return resolve(estadoDe('ok', { fuente: 'claude-cli', motivo: 'la CLI responde' }));
        if (err.code === 'ENOENT') {
          return resolve(estadoDe('configuracion', { fuente: 'claude-cli', motivo: `no encuentro el binario «${BIN_CLAUDE}»` }));
        }
        if (SIN_SALDO.test(texto)) {
          const m = /resets? at ([^\n.]+)/i.exec(texto);
          return resolve(estadoDe('sin-saldo', {
            fuente: 'claude-cli',
            reset_date: m ? m[1].trim() : null,
            motivo: `la CLI dice que no hay saldo: ${texto.slice(0, 200)}`,
          }));
        }
        resolve(estadoDe('desconocido', { fuente: 'claude-cli', motivo: `la CLI falló sin hablar de límites: ${texto.slice(0, 200)}` }));
      });
  });
}
