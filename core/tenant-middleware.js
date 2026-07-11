import Database from 'better-sqlite3';
import { getTenantBySlug, getSessionByToken, WAL_SIZE_LIMIT } from './control-db.js';
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
    // Que el fichero -wal se devuelva al disco al terminar cada checkpoint, en vez de quedarse para
    // siempre en su marca máxima. Mismo tope que control.db (ver WAL_SIZE_LIMIT).
    tenantDb.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT}`);
    // De qué negocio es esta conexión. La cola de envío a la AEAT lo necesita para resolver el
    // certificado del obligado (cada negocio remite con el suyo) sin arrastrar el slug por la firma
    // de media docena de funciones de facturación. Ausente = no hay tenant resuelto (scripts, tests)
    // y la cola no se activa: un gate nunca dispara una petición a la AEAT por accidente.
    tenantDb.bamburuSlug = tenant.slug;
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

  // 1) Vínculo sesión→negocio. (Resuelve el negocio aunque esté suspendido; la suspensión
  //    se aplica más abajo de forma unificada, no aquí.)
  const cookie = c.req.header('cookie') || '';
  const m = cookie.match(/asess=([A-Za-z0-9_-]+)/);
  if (m) {
    const bound = getSessionByToken(m[1]);
    if (bound && bound.tenant) tenant = bound.tenant;
  }

  // 2) Selección de negocio en curso de login (cookie `btenant`, host-only y corta): la
  //    pone /find-tenant al resolver el email→negocio, para alcanzar el negocio correcto
  //    cuando el host no lo identifica (desarrollo: un solo host). La sesión autenticada
  //    (paso 1) manda sobre esto, así que no permite saltar de negocio con sesión abierta.
  if (!tenant) {
    const bt = cookie.match(/btenant=([a-z0-9-]+)/);
    if (bt) {
      const t = getTenantBySlug(bt[1]);
      if (t) tenant = t;
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
  }

  // Suspensión (resuelto el negocio por cualquier vía). Lo fija el superadmin en control.db:
  //  - suspended_security: acceso CORTADO del todo (cuenta comprometida).
  //  - suspended_admin: deja ENTRAR pero en SOLO LECTURA (impago); el guard de escritura y el
  //    banner se encargan del resto. Nunca se le secuestran datos.
  if (tenant.status === 'suspended_security') {
    return c.html(cuentaSuspendidaPage(), 403);
  }

  const tenantDb = getTenantDb(tenant);
  c.set('db', tenantDb);
  c.set('tenant', tenant);
  c.set('tenantReadOnly', tenant.status === 'suspended_admin');

  return tenantStorage.run(tenantDb, () => next());
}

// Pantalla de corte total (cuenta suspendida por seguridad). Sin pistas de por qué.
function cuentaSuspendidaPage() {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Cuenta suspendida</title>
<style>body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070B14;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0}
.box{max-width:440px;padding:40px;text-align:center}.box h1{font-size:22px;margin:0 0 12px}.box p{color:#94a3b8;line-height:1.6}</style>
</head><body><div class="box"><h1>Cuenta suspendida</h1>
<p>El acceso a esta cuenta está suspendido. Por favor, contacta con soporte para resolverlo.</p></div></body></html>`;
}

// Guard de SOLO LECTURA para negocios suspendidos por impago (status suspended_admin):
// bloquea toda ESCRITURA del tenant; deja pasar la lectura y las rutas de sesión/cuenta para
// que el dueño pueda entrar, ver sus datos y salir. Nunca se le secuestran datos.
// (Para negocios NO suspendidos, c.get('tenantReadOnly') es falsy → no hace nada.)
export async function readOnlyGuard(c, next) {
  if (!c.get('tenantReadOnly')) return next();
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const p = c.req.path;
  const allow = ['/admin/login', '/admin/verify-2fa', '/admin/logout', '/admin/forgot-password', '/admin/reset-password', '/admin/change-password'];
  if (allow.some(a => p === a || p.startsWith(a + '/'))) return next();
  const msg = 'Tu cuenta está en modo SOLO LECTURA por regularizar. No puedes crear ni modificar nada hasta reactivarla. Tus datos están intactos.';
  if (p.startsWith('/api/')) return c.json({ error: msg }, 403);
  return c.html(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Solo lectura</title></head><body style="font-family:-apple-system,sans-serif;max-width:520px;margin:60px auto;text-align:center;color:#334155;padding:0 20px"><h2>Cuenta en solo lectura</h2><p style="line-height:1.6">${msg}</p><p style="margin-top:20px"><a href="/admin">← Volver al panel</a></p></body></html>`, 403);
}

// Devuelve la conexión cacheada para un slug, o null si aún no se ha abierto.
export function getTenantConnection(slug) {
  return tenantConnections.get(slug) ?? null;
}
