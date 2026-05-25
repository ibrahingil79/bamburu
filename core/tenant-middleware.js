import Database from 'better-sqlite3';
import { getTenantBySlug } from './control-db.js';
import { tenantStorage } from './db.js';
import { runMigrations } from '../modules/erp/models.js';

// Caché de conexiones abiertas: slug → instancia de Database
const tenantConnections = new Map();

// Middleware de Hono: resuelve el subdominio al tenant correspondiente,
// abre (o reutiliza) su BD y lo inyecta en el contexto como c.get('db') / c.get('tenant').
export async function tenantMiddleware(c, next) {
  if (c.req.path === '/registro' || c.req.path === '/') return next();
  const host = c.req.header('host') ?? '';
  const dotIndex = host.indexOf('.');
  const slug = dotIndex !== -1 ? host.slice(0, dotIndex) : null;

  if (!slug) {
    return c.json({ error: 'Tenant no identificado' }, 404);
  }

  const tenant = getTenantBySlug(slug);
  if (!tenant) {
    return c.json({ error: 'Negocio no encontrado' }, 404);
  }
  if (tenant.status !== 'active') {
    return c.json({ error: 'Negocio inactivo' }, 403);
  }

  let tenantDb = tenantConnections.get(tenant.slug);
  if (!tenantDb) {
    tenantDb = new Database(tenant.db_filename);
    tenantDb.pragma('journal_mode = WAL');
    tenantDb.pragma('foreign_keys = ON');
    runMigrations(tenantDb);
    tenantConnections.set(tenant.slug, tenantDb);
  }

  c.set('db', tenantDb);
  c.set('tenant', tenant);

  return tenantStorage.run(tenantDb, () => next());
}

// Devuelve la conexión cacheada para un slug, o null si aún no se ha abierto.
export function getTenantConnection(slug) {
  return tenantConnections.get(slug) ?? null;
}
