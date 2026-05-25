import { mountRoutes } from './routes/index.js';

export function register(app, db) {
  console.log('🏗️  Cargando módulo ERP...');
  mountRoutes(app, db);
  console.log('✅ ERP: Panel admin en /admin · API en /api/erp');
}
