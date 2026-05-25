export function checkPermission(db, session, module, action) {
  try {
    if (!session?.userId) return false;
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
