// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EL EMPLEADO DE PRUEBA, PREPARADO Y DEVUELTO COMO ESTABA.
//
// DE DÓNDE SALE (24 ago 2026). Cuatro comprobaciones de permisos daban rojo y parecían un agujero de
// seguridad: exigían un 403 y recibían 302/401. No había ningún agujero — **el empleado de prueba
// (usuario 3) estaba INACTIVO**, y a un usuario inactivo se le rechaza ANTES de mirar sus permisos,
// con un código distinto y más duro. Las cuatro se apoyaban en un dato vivo que no creaban ellas.
//
// LA CURA NO ES RELAJAR LO QUE EXIGEN —un 403 sigue siendo lo correcto— sino **preparar bien la
// precondición**: dejar al empleado activo mientras dura la comprobación y devolverlo exactamente
// como estaba al terminar, pase lo que pase.
//
//   const emp = prepararEmpleado(db);        // lo activa si hace falta y guarda cómo estaba
//   ...                                       // la comprobación hace lo suyo
//   emp.restaurar();                          // en el finally, SIEMPRE
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export function prepararEmpleado(db, userId = 3) {
  const antes = db.prepare('SELECT id, active, role FROM admin_users WHERE id=?').get(userId);
  if (!antes) {
    throw new Error('No existe el usuario de prueba #' + userId + ': esta comprobación necesita un empleado. '
      + 'No se inventa uno nuevo — crearlo cambiaría el negocio; se para y se dice.');
  }
  if (antes.role === 'owner' || antes.role === 'admin') {
    throw new Error('El usuario #' + userId + ' es ' + antes.role + ', no un empleado: pasaría por el bypass '
      + 'y la comprobación daría verde sin probar ningún permiso.');
  }
  if (!antes.active) db.prepare('UPDATE admin_users SET active=1 WHERE id=?').run(userId);
  return {
    id: userId,
    estabaInactivo: !antes.active,
    // ⚠️ ACEPTA UNA CONEXIÓN, y no es un capricho: varias de estas comprobaciones CIERRAN su `db`
    // nada más leer el estado inicial y abren otra al final. Restaurar sobre la conexión cerrada
    // fallaba **en silencio** (el try/catch se lo tragaba) y el empleado se quedaba ACTIVO — o sea,
    // la comprobación dejaba a alguien con un acceso que no tenía. Se detectó al mirarlo después.
    // Si no se pasa ninguna, se usa la de arriba; si esa está cerrada, se dice en voz alta.
    restaurar(otraDb) {
      const d = otraDb || db;
      try {
        d.prepare('UPDATE admin_users SET active=? WHERE id=?').run(antes.active, userId);
      } catch (e) {
        console.error('  ⚠️ NO SE PUDO DEVOLVER AL EMPLEADO #' + userId + ' a active=' + antes.active
          + ' (' + e.message + '). Queda como esté: revísalo.');
      }
    },
  };
}
