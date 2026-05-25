import { z } from 'zod';

export function validate(schema) {
  return async (c, next) => {
    try {
      const ct = c.req.header('content-type') || '';
      let body;
      if (ct.includes('application/json')) body = await c.req.json();
      else body = await c.req.parseBody();

      const { _csrf, ...data } = body;
      const parsed = schema.parse(data);
      c.set('validated', parsed);
      return next();
    } catch (e) {
      if (e.issues) {
        const msg = e.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; ');
        if (c.req.path.startsWith('/api/')) return c.json({ error: 'Datos inválidos', detail: msg }, 400);
        return c.html(`<h1>400</h1><p>${msg}</p>`, 400);
      }
      throw e;
    }
  };
}

export const str = (max = 255) => z.string().trim().min(1).max(max);
export const strOpt = (max = 255) => z.string().trim().max(max).optional().or(z.literal(''));
export const email = z.string().trim().email().max(255);
export const price = z.coerce.number().nonnegative().max(1_000_000);
export const intPos = z.coerce.number().int().nonnegative();
export const slug = z.string().regex(/^[a-z0-9-]+$/).max(100);
