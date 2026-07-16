import { recordSecurityEvent } from './control-db.js';

const buckets = new Map();

export function getClientIp(c) {
  // La IP real del cliente la PISA Caddy en X-Real-IP ({remote_host}); lo que mande el
  // cliente se descarta. Pero solo nos fiamos de esa cabecera si la conexión llega desde
  // loopback (= viene de Caddy en 127.0.0.1/::1). Si la conexión NO es de loopback, la
  // cabecera podría venir directa del cliente → la ignoramos y usamos la IP del socket.
  const addr = c.env?.incoming?.socket?.remoteAddress || '';
  const isLoopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  if (isLoopback) {
    const realIp = c.req.header('x-real-ip');
    if (realIp) return realIp.trim();
  }
  return addr || 'unknown';
}

// keyFn (opcional) — limita por algo que NO es la IP. Recibe el contexto y devuelve el sujeto del
// cupo (p. ej. el email del formulario); si devuelve null/'' no hay a quién limitar y pasa de largo.
// Sirve para el caso IP + cuenta a la vez: se encadenan dos limitadores con keyPrefix distinto, uno
// por IP y otro por sujeto, y así una botnet repartida por mil IPs no puede machacar UNA cuenta.
// Sin keyFn el comportamiento es el de siempre: por IP.
//
// OJO con la PII: el sujeto solo se usa como clave EN MEMORIA. El evento de vigilancia que se
// registra al frenar lleva la IP y el keyPrefix, nunca el sujeto — un email en la tabla de eventos
// sería la misma fuga de PII que se cerró en C3/M7 sacando el email de los logs de login.
export function rateLimit({ windowMs, max, keyPrefix, message = 'Demasiados intentos. Inténtalo más tarde.', keyFn = null }) {
  return async (c, next) => {
    const ip = getClientIp(c);
    const slug = c.get('tenant')?.slug || 'global';
    const subject = keyFn ? await keyFn(c) : ip;
    if (!subject) return next();
    const key = `${keyPrefix}:${slug}:${subject}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    let arr = buckets.get(key) || [];
    arr = arr.filter(ts => ts > windowStart);

    if (arr.length >= max) {
      const oldest = arr[0];
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      // Vigilancia: la petición frenada queda registrada para el panel de superadmin.
      recordSecurityEvent('ratelimit:' + keyPrefix, ip, slug, c.req.method + ' ' + c.req.path);
      // Responde en el idioma del cliente. Antes solo miraba el prefijo /api/, así que un
      // endpoint JSON fuera de /api/ (POST /find-tenant) recibía una PÁGINA HTML: el `await
      // r.json()` del navegador reventaba y el usuario leía "Error de conexión" en vez del
      // motivo real. Una navegación normal manda Accept: text/html → sigue recibiendo la página.
      const esperaJson = c.req.path.startsWith('/api/')
        || (c.req.header('content-type') || '').includes('application/json')
        || (c.req.header('accept') || '').includes('application/json');
      if (esperaJson) {
        return c.json({ error: message, retry_after_seconds: retryAfter }, 429);
      }
      return c.html(`<html><body style="font-family:sans-serif;max-width:500px;margin:50px auto;text-align:center"><h1>429 — Demasiadas peticiones</h1><p>${message}</p><p>Inténtalo de nuevo en ${retryAfter} segundos.</p></body></html>`, 429);
    }

    arr.push(now);
    buckets.set(key, arr);

    return next();
  };
}

// ── C6/B4 · Freno por CUENTA en el login: ralentizar, nunca bloquear ─────────────────────────
//
// EL HUECO. El freno de login es por IP+negocio: un atacante con IPs rotativas nunca lo toca, así
// que contra UNA cuenta podía probar sin límite. Y B6 le daba la lista de cuentas.
//
// POR QUÉ NO ES UN rateLimit MÁS. Un freno por cuenta que RECHACE es un arma: cualquiera falla cinco
// veces contra tu email y te deja fuera de tu propio negocio hasta que se le pase. Habríamos cambiado
// "te pueden probar contraseñas" por "te pueden echar", y lo segundo es peor: pasa a la primera y no
// hace falta acertar nada. Por eso esto RALENTIZA y jamás dice que no: el legítimo siempre entra,
// solo que a veces espera unos segundos. El atacante paga esos segundos por intento, y a 10 s por
// prueba, probar deja de tener sentido.
//
// SE CUENTAN FALLOS, NO INTENTOS. Si contara intentos, quien entra bien seis veces en una mañana se
// comería la espera sin haber hecho nada. Un acierto BORRA el historial: fallar dos veces y entrar
// no deja penalización ninguna.
//
// NO ES UN ORÁCULO. El sujeto es el email TECLEADO, exista o no, así que un email desconocido se
// frena igual que uno real: el reloj no dice si la cuenta existe. Es lo mismo que se cuidó en el
// forgot-password de C5, y sería tonto abrir por aquí lo que se cerró por allí.
const fallos = new Map();

const claveFallo = (keyPrefix, slug, subject) => `${keyPrefix}:${slug}:${subject}`;

export function registrarFallo(keyPrefix, subject, slug = 'global') {
  if (!subject) return;
  const key = claveFallo(keyPrefix, slug, subject);
  const arr = fallos.get(key) || [];
  arr.push(Date.now());
  fallos.set(key, arr);
}

// Un acierto limpia la cuenta: quien demuestra que es él no arrastra los fallos de nadie.
export function limpiarFallos(keyPrefix, subject, slug = 'global') {
  if (!subject) return;
  fallos.delete(claveFallo(keyPrefix, slug, subject));
}

// after  = fallos gratis antes de empezar a cobrar (los dedos se equivocan)
// stepMs = lo que crece la espera por cada fallo de más
// maxMs  = techo: la espera está ACOTADA a propósito. Sin techo, esto sería un bloqueo con otro
//          nombre — y además cada petición retenida ocupa un socket.
export function throttlePorFallos({ windowMs, after, stepMs, maxMs, keyPrefix, keyFn }) {
  return async (c, next) => {
    const subject = keyFn ? await keyFn(c) : null;
    if (!subject) return next();
    const slug = c.get('tenant')?.slug || 'global';
    const key = claveFallo(keyPrefix, slug, subject);
    const now = Date.now();
    const arr = (fallos.get(key) || []).filter(ts => ts > now - windowMs);
    if (arr.length) fallos.set(key, arr); else fallos.delete(key);

    const exceso = arr.length - after;
    if (exceso > 0) {
      const espera = Math.min(exceso * stepMs, maxMs);
      // Vigilancia: la IP sí, el email NUNCA (PII — la lección de C3/M7).
      recordSecurityEvent('throttle:' + keyPrefix, getClientIp(c), slug, `espera ${espera} ms`);
      await new Promise(r => setTimeout(r, espera));
    }
    return next();
  };
}

export function cleanupFallos() {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000;
  for (const [key, arr] of fallos.entries()) {
    const vivos = arr.filter(ts => ts > now - maxAge);
    if (vivos.length === 0) fallos.delete(key); else if (vivos.length !== arr.length) fallos.set(key, vivos);
  }
}

export function cleanupRateLimitBuckets() {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000;
  for (const [key, arr] of buckets.entries()) {
    const filtered = arr.filter(ts => ts > now - maxAge);
    if (filtered.length === 0) {
      buckets.delete(key);
    } else if (filtered.length !== arr.length) {
      buckets.set(key, filtered);
    }
  }
}
