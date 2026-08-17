// NAVEGACIÓN · (C) ANCLAR Y ORDENAR LO PROPIO — la puerta de datos de las anclas del menú.
//
// Lo ÚNICO que se guarda aquí es una lista ordenada de CLAVES del menú: qué atajos quiere ver este
// usuario arriba del rail y en qué orden. Ni rutas, ni permisos, ni datos de negocio. La preferencia
// es POR USUARIO (cada uno tiene sus permisos y su trabajo), nunca por negocio: el dueño no le coloca
// los atajos a nadie, y quien no ancla nada ve exactamente el menú de hoy.
//
// DÓNDE VIVE: en `dashboard_layouts` con ámbito `menu:usuario:<id>` — la tabla de preferencias por
// usuario que nació con el Inicio personalizable (peldaño 6), con sus propias funciones. No se crea un
// segundo sistema de preferencias y la migración no añade ni una tabla: la que hace falta ya existe.
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { menuDeUsuario, anclablesPorClave, getAnclas, setAnclas, MAX_ANCLAS } from '../menu.js';

export function createMenuRoutes(db) {
  const api = new Hono();
  const quien = c => ({ role: c.get('session')?.role || '', perms: c.get('userPerms') || [] });

  // Mis anclas, tal y como están guardadas (sin resolver). La pantalla no la necesita —el rail viene
  // pintado del servidor—, pero es la forma de comprobar la persistencia sin leer la BD por fuera.
  api.get('/anclas', c => {
    try {
      const userId = c.get('session')?.userId;
      if (!userId) { const e = new Error('No autorizado'); e.status = 401; throw e; }
      return c.json({ anclas: getAnclas(db, userId), max: MAX_ANCLAS });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // Guardar MIS anclas (la lista entera, en orden). Lista vacía = quitarlas todas → se borra la fila y
  // el menú vuelve a ser el de fábrica, sin rastro.
  api.put('/anclas', async c => {
    try {
      const userId = c.get('session')?.userId;
      if (!userId) { const e = new Error('No autorizado'); e.status = 401; throw e; }
      const body = await c.req.json().catch(() => ({}));
      const claves = Array.isArray(body.claves) ? body.claves : null;
      if (!claves) { const e = new Error('Falta la lista de anclas'); e.status = 400; throw e; }
      if (claves.length > MAX_ANCLAS) {
        const e = new Error('Puedes tener ' + MAX_ANCLAS + ' anclados como mucho'); e.status = 400; throw e;
      }
      // Defensa en profundidad, mismo criterio que `chequearPaneles` del Inicio: solo se ancla lo que
      // este usuario VE hoy en su menú. Un ancla no abre ninguna puerta —solo pinta un enlace, y la
      // pantalla de destino conserva su propio candado—, pero guardar un atajo a algo que no ve no
      // tiene sentido y valdría de sonda. OJO: esto es la comprobación al GUARDAR. Si mañana le
      // retiran el permiso, el ancla NO se borra ni da error: calla al pintarse y vuelve sola el día
      // que se lo devuelvan (`anclasDeUsuario`).
      const anclables = anclablesPorClave(menuDeUsuario(db, quien(c)));
      for (const k of claves) {
        if (!anclables.has(k)) { const e = new Error('Esa entrada no está en tu menú'); e.status = 403; throw e; }
      }
      return c.json(setAnclas(db, userId, claves));
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  return { api };
}
