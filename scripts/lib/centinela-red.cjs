// ═════════════════════════════════════════════════════════════════════════════════════════════════
// centinela-red.cjs — MIDE, de verdad, si algo intenta salir hacia el proveedor de IA.
//
// **Decisión de Ibrahin, 6 sep 2026: Bamburu deja de usar IA.** Y su palabra sobre cómo se comprueba:
// *«que ninguna comprobación del barrido consiga una llamada saliente al proveedor, medido de verdad,
// no por nombres ni por búsqueda de texto»*.
//
// POR QUÉ NO VALE BUSCAR TEXTO. Un censo que busca `api.anthropic.com` en el árbol se engaña
// escribiendo la URL partida en dos, o metiéndola en una variable, o leyéndola de un fichero. Y peor:
// da verde sobre un árbol limpio aunque una dependencia llame por su cuenta. Lo único que no se puede
// disimular es **el intento de salir**, así que es ahí donde se mide.
//
// CÓMO. Se carga con `--require` (o `NODE_OPTIONS`), así que entra en el proceso ANTES que el
// programa — y **`NODE_OPTIONS` lo heredan los procesos hijos**, que es lo que permite medir un
// barrido entero de 230 comprobaciones sin tocar ni una de ellas. Dentro, se envuelven las CINCO
// puertas por las que Node puede salir a la red:
//
//     fetch · https.request · http.request · net.connect/tls.connect · dns.lookup
//
// Se envuelve `dns.lookup` a propósito aunque parezca de más: es la señal MÁS TEMPRANA. Un intento
// que muera resolviendo el nombre no llega a abrir socket, y sin esto no se vería.
//
// QUÉ HACE AL PILLAR UNO. Dos cosas, y las dos importan:
//   1. Lo **APUNTA** en el fichero que diga `BAMBURU_CENTINELA_RED` — con la hora, el pid, qué guion
//      era y la traza. Eso es la medida: si el fichero acaba vacío, no salió ni una.
//   2. Lo **CORTA**, lanzando. Un centinela que solo mira deja pasar lo que venía a medir.
//
// NO ESTORBA A LO DEMÁS. Solo mira el proveedor de IA. Stripe, Resend, Drive y las peticiones de los
// gates a `127.0.0.1` pasan intactas: se comparan hosts, y solo se actúa sobre los de la lista.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');

// Los hosts del proveedor. Se compara el host EXACTO o un subdominio suyo — nunca por «incluye»,
// que casaría con `no-es-api.anthropic.com.attacker.net`.
const HOSTS = ['api.anthropic.com', 'anthropic.com'];

const DESTINO = process.env.BAMBURU_CENTINELA_RED || '';

function esDelProveedor(host) {
  if (!host) return false;
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '').split(':')[0];
  return HOSTS.some(x => h === x || h.endsWith('.' + x));
}

function hostDe(algo) {
  if (!algo) return '';
  if (typeof algo === 'string') {
    try { return new URL(algo).hostname; } catch { return algo; }
  }
  if (typeof algo === 'object') {
    if (algo.hostname) return algo.hostname;
    if (algo.host) return algo.host;
    if (algo.href) { try { return new URL(algo.href).hostname; } catch { /* sigue */ } }
    if (algo.url) return hostDe(algo.url);
  }
  return '';
}

let cazados = 0;

function cazar(via, host) {
  cazados++;
  const linea = JSON.stringify({
    ts: new Date().toISOString(),
    pid: process.pid,
    via,
    host,
    guion: (process.argv[1] || '').split('/').pop() || '(sin guion)',
    pila: new Error('salida al proveedor de IA').stack.split('\n').slice(2, 7).map(s => s.trim()),
  });
  if (DESTINO) { try { fs.appendFileSync(DESTINO, linea + '\n'); } catch { /* nunca romper por el registro */ } }
  else { try { process.stderr.write('[CENTINELA-RED] ' + linea + '\n'); } catch {} }

  const e = new Error(
    'CENTINELA DE RED: se ha intentado salir hacia el proveedor de IA (' + host + ', vía ' + via + '). '
    + 'Bamburu no usa IA desde el 6 sep 2026 — ver core/llm.js y docs/disa/inventario-uso-de-ia.md.');
  e.code = 'centinela_red';
  throw e;
}

/** Cuántos intentos ha visto este proceso. Lo usa el guardián para afirmar sobre un número. */
module.exports = { get cazados() { return cazados; }, esDelProveedor, HOSTS };

// ── 1 · fetch ────────────────────────────────────────────────────────────────────────────────────
if (typeof globalThis.fetch === 'function') {
  const original = globalThis.fetch;
  globalThis.fetch = function (recurso, opciones) {
    const host = hostDe(recurso && recurso.url ? recurso.url : recurso);
    if (esDelProveedor(host)) cazar('fetch', host);
    return original.apply(this, arguments);
  };
}

// ── 2 · https.request / http.request ─────────────────────────────────────────────────────────────
for (const mod of ['https', 'http']) {
  let m;
  try { m = require(mod); } catch { continue; }
  for (const fn of ['request', 'get']) {
    const original = m[fn];
    if (typeof original !== 'function') continue;
    m[fn] = function (a, b, c) {
      const host = hostDe(typeof a === 'string' || a instanceof URL ? a : a) || hostDe(b);
      if (esDelProveedor(host)) cazar(mod + '.' + fn, host);
      return original.apply(this, arguments);
    };
  }
}

// ── 3 · net.connect / tls.connect ────────────────────────────────────────────────────────────────
for (const mod of ['net', 'tls']) {
  let m;
  try { m = require(mod); } catch { continue; }
  for (const fn of ['connect', 'createConnection']) {
    const original = m[fn];
    if (typeof original !== 'function') continue;
    m[fn] = function (a) {
      const host = typeof a === 'object' ? hostDe(a) : '';
      if (esDelProveedor(host)) cazar(mod + '.' + fn, host);
      return original.apply(this, arguments);
    };
  }
}

// ── 4 · dns.lookup — la señal más temprana ───────────────────────────────────────────────────────
try {
  const dns = require('dns');
  const original = dns.lookup;
  dns.lookup = function (nombre) {
    if (esDelProveedor(nombre)) cazar('dns.lookup', nombre);
    return original.apply(this, arguments);
  };
  if (dns.promises && typeof dns.promises.lookup === 'function') {
    const orig2 = dns.promises.lookup;
    dns.promises.lookup = function (nombre) {
      if (esDelProveedor(nombre)) cazar('dns.promises.lookup', nombre);
      return orig2.apply(this, arguments);
    };
  }
} catch { /* sin dns: nada que envolver */ }
