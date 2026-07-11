import { initControlDb, getTenantBySlug, createTenant } from '../core/control-db.js';

initControlDb();

const existing = getTenantBySlug('staging');
if (existing) {
  console.log('El tenant staging ya existe:', existing);
  process.exit(0);
}

// La BD de un negocio vive SIEMPRE en data/tenants/<slug>.db. Este script apuntaba a
// 'data/bamburu.db', fuera de esa carpeta: de ahí salió el fichero huérfano de 327 KB que quedó
// suelto en data/ (borrado el 11-jul-2026, nunca lo usó ningún tenant). Ahora sigue la convención.
const tenant = createTenant({
  name:        'Bamburu Staging',
  slug:        'staging',
  db_filename: 'data/tenants/staging.db',
  plan:        'starter'
});

console.log('✓ Tenant staging registrado:', tenant);
