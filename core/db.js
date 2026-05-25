import { AsyncLocalStorage } from 'async_hooks';

// Almacén del tenant activo para la petición en curso.
// El tenant-middleware lo rellena con tenantStorage.run(tenantDb, next).
export const tenantStorage = new AsyncLocalStorage();

// Proxy que redirige cada acceso a la BD del tenant activo.
// Fuera de una petición (sin tenant en contexto) lanza un error claro.
export const db = new Proxy({}, {
  get(_, prop) {
    const store = tenantStorage.getStore();
    if (!store) {
      throw new Error(
        `[Bamburu] db.${String(prop)} usado fuera de contexto de tenant. ` +
        `¿Falta el tenant-middleware o se llama desde un script?`
      );
    }
    const value = store[prop];
    return typeof value === 'function' ? value.bind(store) : value;
  }
});

// getSetting y setSetting operan sobre la BD del tenant activo.
// Solo llamarlas dentro de una petición.
export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(key, value);
}
