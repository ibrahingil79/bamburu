// El bypass owner/admin vive AQUÍ, no en cada punto de llamada. Es la mitad que `requirePerm`
// (core/auth.js:17) tiene y esta función no tenía: la primitiva contestaba «¿tiene la fila?» mientras
// que quien la llama pregunta «¿puede esta sesión?». Donde alguien se olvidaba de añadir el rol, el
// comportamiento cambiaba en silencio — y pasó: modules/disa/index.js:2528 dejó al DUEÑO sin sus
// propios informes (diagnóstico arquitectónico §4.1).
//
// LA ÚNICA EXCEPCIÓN DEL PRODUCTO no pasa por aquí y sigue sin pasar: el historial clínico
// (`requireHistorial` / `puedeHistorial`, core/auth.js:305 y :330) exige el permiso concedido incluso a
// un `admin`, y por eso tiene su propia función. Si algún día hace falta otra excepción así, se escribe
// su función con su nombre y su motivo — no se le quita el bypass a esta.
export function checkPermission(db, session, module, action) {
  try {
    if (!session?.userId) return false;
    if (session.role === 'owner' || session.role === 'admin') return true;
    const row = db.prepare(`
      SELECT 1 FROM user_permissions up
      JOIN permissions p ON up.permission_id = p.id
      WHERE up.admin_user_id = ? AND p.module = ? AND p.action = ?
      LIMIT 1
    `).get(session.userId, module, action);
    return !!row;
  } catch {
    return false;
  }
}

export function permissionMiddleware(db, module, action) {
  return async (c, next) => {
    const session = c.get('session');
    if (!checkPermission(db, session, module, action)) {
      return c.html('<p style="color:red;padding:2rem">No tienes permiso para realizar esta acción.</p>', 403);
    }
    return next();
  };
}
