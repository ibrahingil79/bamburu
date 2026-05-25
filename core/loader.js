import { join } from 'path';

const MODULE_ORDER = ['erp', 'store', 'disa'];

export async function loadModules(app, db) {
  const modulesDir = join(process.cwd(), 'modules');
  for (const mod of MODULE_ORDER) {
    try {
      const { register } = await import(join(modulesDir, mod, 'index.js'));
      if (typeof register === 'function') { register(app, db); console.log('✅ Módulo cargado: ' + mod); }
    } catch (e) { console.warn('⚠️ Módulo ' + mod + ' error: ' + e.message); }
  }
}
