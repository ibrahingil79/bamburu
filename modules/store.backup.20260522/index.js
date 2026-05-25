import { createRoutes } from './routes.js';

export function register(app, db) {
  console.log('🛍️  Cargando módulo Store...');
  createRoutes(app, db);
  console.log('✅ Store: Tienda pública en /store');
}
