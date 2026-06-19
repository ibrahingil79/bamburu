const buckets = new Map();

function getClientIp(c) {
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

export function rateLimit({ windowMs, max, keyPrefix, message = 'Demasiados intentos. Inténtalo más tarde.' }) {
  return async (c, next) => {
    const ip = getClientIp(c);
    const slug = c.get('tenant')?.slug || 'global';
    const key = `${keyPrefix}:${slug}:${ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    let arr = buckets.get(key) || [];
    arr = arr.filter(ts => ts > windowStart);

    if (arr.length >= max) {
      const oldest = arr[0];
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      if (c.req.path.startsWith('/api/')) {
        return c.json({ error: message, retry_after_seconds: retryAfter }, 429);
      }
      return c.html(`<html><body style="font-family:sans-serif;max-width:500px;margin:50px auto;text-align:center"><h1>429 — Demasiadas peticiones</h1><p>${message}</p><p>Inténtalo de nuevo en ${retryAfter} segundos.</p></body></html>`, 429);
    }

    arr.push(now);
    buckets.set(key, arr);

    return next();
  };
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
