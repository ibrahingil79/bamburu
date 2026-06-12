import Database from 'better-sqlite3';
import { getTenantBySlug, getSessionByToken } from './control-db.js';
import { tenantStorage } from './db.js';
import { runMigrations } from '../modules/erp/models.js';

// Caché de conexiones abiertas: slug → instancia de Database
const tenantConnections = new Map();

// Abre (o reutiliza) la BD de un tenant ya resuelto. Compartida por el middleware y por
// el auto-login del apex, para no duplicar la apertura/migración ni la caché.
export function getTenantDb(tenant) {
  let tenantDb = tenantConnections.get(tenant.slug);
  if (!tenantDb) {
    tenantDb = new Database(tenant.db_filename);
    tenantDb.pragma('journal_mode = WAL');
    tenantDb.pragma('foreign_keys = ON');
    runMigrations(tenantDb);
    tenantConnections.set(tenant.slug, tenantDb);
  }
  return tenantDb;
}

// Middleware de Hono: resuelve a qué negocio pertenece la petición, abre su BD y la
// inyecta en el contexto (c.get('db') / c.get('tenant')) y en tenantStorage.
//
// Resolución en dos caminos, sin romper el aislamiento:
//  1) VÍNCULO DE SESIÓN (control.db `tenant_sessions`): si la cookie `asess` está atada a
//     un negocio, ese negocio manda. Es el camino que hace falta cuando el host NO
//     identifica al tenant (desarrollo: un solo host para todos). En producción la cookie
//     `asess` es host-only, así que coincide con el subdominio → no rompe el aislamiento.
//  2) SUBDOMINIO (camino primario en producción; fallback en desarrollo): primera etiqueta
//     del host → slug del negocio. Es lo que había y se mantiene intacto.
export async function tenantMiddleware(c, next) {
  if (c.req.path === '/registro' || c.req.path === '/') return next();

  let tenant = null;

  // 1) Vínculo sesión→negocio.
  const cookie = c.req.header('cookie') || '';
  const m = cookie.match(/asess=([A-Za-z0-9_-]+)/);
  if (m) {
    const bound = getSessionByToken(m[1]);
    if (bound && bound.tenant && bound.tenant.status === 'active') tenant = bound.tenant;
  }

  // 2) Selección de negocio en curso de login (cookie `btenant`, host-only y corta): la
  //    pone /find-tenant al resolver el email→negocio, para alcanzar el negocio correcto
  //    cuando el host no lo identifica (desarrollo: un solo host). La sesión autenticada
  //    (paso 1) manda sobre esto, así que no permite saltar de negocio con sesión abierta.
  if (!tenant) {
    const bt = cookie.match(/btenant=([a-z0-9-]+)/);
    if (bt) {
      const t = getTenantBySlug(bt[1]);
      if (t && t.status === 'active') tenant = t;
    }
  }

  // 3) Subdominio (camino primario en producción; fallback en desarrollo).
  if (!tenant) {
    const host = c.req.header('host') ?? '';
    const dotIndex = host.indexOf('.');
    const slug = dotIndex !== -1 ? host.slice(0, dotIndex) : null;
    if (!slug) return c.json({ error: 'Tenant no identificado' }, 404);

    tenant = getTenantBySlug(slug);
    if (!tenant) return c.json({ error: 'Negocio no encontrado' }, 404);
    if (tenant.status !== 'active') return c.json({ error: 'Negocio inactivo' }, 403);
  }

  const tenantDb = getTenantDb(tenant);
  c.set('db', tenantDb);
  c.set('tenant', tenant);

  return tenantStorage.run(tenantDb, () => next());
}

// Devuelve la conexión cacheada para un slug, o null si aún no se ha abierto.
export function getTenantConnection(slug) {
  return tenantConnections.get(slug) ?? null;
}
