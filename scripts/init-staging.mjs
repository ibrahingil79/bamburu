import { initControlDb, getTenantBySlug, createTenant } from '../core/control-db.js';

initControlDb();

const existing = getTenantBySlug('staging');
if (existing) {
  console.log('El tenant staging ya existe:', existing);
  process.exit(0);
}

const tenant = createTenant({
  name:        'Bamburu Staging',
  slug:        'staging',
  db_filename: 'data/bamburu.db',
  plan:        'starter'
});

console.log('✓ Tenant staging registrado:', tenant);
