import { initControlDb, getTenantBySlug } from '../core/control-db.js';
import { provisionTenant } from '../core/tenant-provisioning.js';

initControlDb();

const SLUG = 'bamburu-dev';
const existing = getTenantBySlug(SLUG);

if (existing) {
  console.log('El tenant de desarrollo ya existe. No se hace nada.');
  console.log('  Slug:    ', existing.slug);
  console.log('  Archivo: ', existing.db_filename);
  process.exit(0);
}

const DEV_PASSWORD = 'Bamburu.Dev.2026!';

const result = await provisionTenant({
  businessName: 'Bamburu Dev',
  ownerName:    'Admin Desarrollo',
  email:        'dev@bamburu.com',
  password:     DEV_PASSWORD,
  phone:        '+34 000 000 000'
});

console.log('');
console.log('✓ Tenant de desarrollo creado');
console.log('  URL:          dev.bamburu.com');
console.log('  Email:        dev@bamburu.com');
console.log('  Contraseña:   la constante DEV_PASSWORD, arriba en este mismo fichero.');
console.log('  Archivo .db:  ' + result.db_filename);
console.log('');
// C6/B7 — no se imprime. Aquí no filtra nada nuevo (la constante está en el repo), pero un secreto
// impreso es un secreto en el scrollback y en lo que capture stdout: la regla no admite excepciones
// "porque este da igual". Es justo así como se cuela el que sí importa.
console.log('Es un tenant de DESARROLLO con una contraseña conocida y publicada en el repo:');
console.log('NO ejecutes este script contra producción.');
