const buckets = new Map();

function getClientIp(c) {
  // X-Real-IP is injected by local Nginx — not forgeable by the client
  const realIp = c.req.header('x-real-ip');
  if (realIp) return realIp.trim();
  // Direct connection fallback (Hono Node adapter exposes socket via c.env.incoming)
  const addr = c.env?.incoming?.socket?.remoteAddress;
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
