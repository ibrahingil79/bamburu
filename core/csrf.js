// CSRF protection middleware for admin routes.
// Strategy: token delivered via x-csrf-token header (all fetch calls) or
// _csrf hidden field in forms (application/x-www-form-urlencoded).
// Hono v4 caches the parsed body, so double-parsing is safe.

export function csrfProtect() {
  return async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const session = c.get('session');
    if (!session) {
      return c.json({ error: 'No autorizado' }, 401);
    }

    // Try header first (fetch calls)
    let token = c.req.header('x-csrf-token');

    if (!token) {
      const ct = c.req.header('content-type') || '';
      if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
        const body = await c.req.parseBody();
        token = body._csrf;
      } else if (ct.includes('application/json')) {
        try {
          const body = await c.req.json();
          token = body._csrf;
        } catch (_) {}
      }
    }

    if (!token || token !== session.csrfToken) {
      if (c.req.path.startsWith('/api/')) {
        return c.json({ error: 'Token CSRF inválido o ausente' }, 403);
      }
      return c.html('<html><body style="font-family:sans-serif;max-width:500px;margin:50px auto;text-align:center"><h1>403 — Token CSRF inválido</h1><p>Recarga la página y vuelve a intentarlo.</p></body></html>', 403);
    }

    return next();
  };
}
