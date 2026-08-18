// NAVEGACIÓN · LO PROPIO DE CADA USUARIO — la puerta de datos del menú personal.
//
// Lo ÚNICO que se guarda aquí es COLOCACIÓN: qué atajos quiere este usuario arriba del rail (C) y en
// qué orden quiere sus áreas y las entradas de cada desplegable (D). Ni rutas, ni permisos, ni datos
// de negocio. La preferencia es POR USUARIO —cada uno tiene sus permisos y su trabajo—, nunca por
// negocio: el dueño no le coloca el menú a nadie, y quien no toca nada ve el menú de fábrica.
//
// DÓNDE VIVE: en `dashboard_layouts` con ámbito `menu:usuario:<id>` — la tabla de preferencias por
// usuario que nació con el Inicio personalizable (peldaño 6), con sus propias funciones. No se crea un
// segundo sistema de preferencias y la migración no añade ni una tabla: la que hace falta ya existe.
//
// LOS TRES ENDPOINTS DEVUELVEN EL RAIL YA PINTADO por el renderizador del layout. Es a propósito: un
// área anclada arrastra su desplegable entero y las entradas se reordenan dentro de su bloque, así que
// si el navegador se fabricase el HTML por su cuenta habría DOS renderizadores del mismo rail — y el
// día que cambie uno, el otro se queda viejo en silencio.
import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import {
  menuDeUsuario, anclablesPorClave, anclasDeUsuario, getAnclas, setAnclas,
  setOrden, borrarPref, tienePref, leerPref, MAX_ANCLAS,
} from '../menu.js';
import { railHTML, can } from '../layout.js';
import { contarPropuestasPendientes, tiposVisiblesPara } from '../propuestas.js';

export function createMenuRoutes(db) {
  const api = new Hono();
  const quien = c => ({ role: c.get('session')?.role || '', perms: c.get('userPerms') || [], userId: c.get('session')?.userId });

  // El rail de este usuario, tal y como lo pintaría una carga de página. `activa` es la pantalla en la
  // que está (solo se compara, para marcar lo actual). El badge de DISA se recalcula igual que en el
  // layout: si no, al repintar se perdería el número hasta la siguiente recarga.
  function railDe(c, userId, activa) {
    const menu = menuDeUsuario(db, quien(c));
    const anclas = anclasDeUsuario(db, userId, menu);
    let pend = 0;
    try {
      const tipos = tiposVisiblesPara(c, can);
      if (tipos.length) pend = contarPropuestasPendientes(db, tipos);
    } catch { pend = 0; }
    const verPropuestas = menu.areas.some(a => a.id === 'disa' && a.todos.some(i => i.key === 'propuestas'));
    const disaBadge = verPropuestas
      ? `<span class="rail-count" id="propCount"${pend ? '' : ' style="display:none"'}>${pend || ''}</span>`
      : '';
    const ctx = { active: typeof activa === 'string' ? activa : '', anclado: new Set(anclas.map(a => a.key)), disaBadge };
    const fijaPie = menu.fijas.find(f => f.sitio === 'pie') || { href: '/docs', label: 'Ayuda y soporte', icon: 'ti-lifebuoy' };
    return { rail: railHTML(menu, anclas, ctx, fijaPie, tienePref(db, userId)) };
  }

  const usuario = c => {
    const userId = c.get('session')?.userId;
    if (!userId) { const e = new Error('No autorizado'); e.status = 401; throw e; }
    return userId;
  };

  // Mis anclas, tal y como están guardadas (sin resolver). La pantalla no la necesita —el rail viene
  // pintado del servidor—, pero es la forma de comprobar la persistencia sin leer la BD por fuera.
  api.get('/anclas', c => {
    try { return c.json({ anclas: getAnclas(db, usuario(c)), max: MAX_ANCLAS }); }
    catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // (C) Guardar MIS anclas (la lista entera, en orden). Lista vacía = quitarlas todas.
  api.put('/anclas', async c => {
    try {
      const userId = usuario(c);
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
      const r = setAnclas(db, userId, claves);
      return c.json({ ok: true, anclas: r.anclas, ...railDe(c, userId, body.activa) });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // (D) Guardar MI ORDEN. `areas` = ids de área en su orden. `entradas` = { areaId: {diario, ajustes} }.
  // Se manda solo lo que cambia; lo que no venga se queda como estaba.
  //
  // NO SE VALIDA QUE LA LISTA ESTÉ COMPLETA, y es a propósito: el orden guardado es una lista de claves
  // que envejece, y lo que no esté en ella se coloca detrás en el orden de fábrica (`aplicarOrden`).
  // Exigir completitud aquí rompería el menú de todo el que personalizó antes de que existiera una
  // función nueva. Lo que SÍ se comprueba es que las claves sean del menú de este usuario.
  api.put('/orden', async c => {
    try {
      const userId = usuario(c);
      const body = await c.req.json().catch(() => ({}));
      const menu = menuDeUsuario(db, quien(c));
      const idsArea = new Set(menu.areas.map(a => a.id));
      const clavesArea = new Map(menu.areas.map(a => [a.id, new Set(a.todos.map(i => i.key))]));

      let areas;
      if (body.areas !== undefined) {
        if (!Array.isArray(body.areas)) { const e = new Error('Orden de áreas inválido'); e.status = 400; throw e; }
        for (const id of body.areas) if (!idsArea.has(id)) { const e = new Error('Esa área no está en tu menú'); e.status = 403; throw e; }
        areas = body.areas;
      }
      let entradas;
      if (body.entradas !== undefined) {
        if (!body.entradas || typeof body.entradas !== 'object') { const e = new Error('Orden de entradas inválido'); e.status = 400; throw e; }
        entradas = {};
        for (const [areaId, o] of Object.entries(body.entradas)) {
          const suyas = clavesArea.get(areaId);
          if (!suyas) { const e = new Error('Esa área no está en tu menú'); e.status = 403; throw e; }
          const lista = k => (Array.isArray(k) ? k : []);
          for (const k of lista(o?.diario).concat(lista(o?.ajustes))) {
            // Ni entre áreas: una entrada solo se ordena DENTRO de la suya.
            if (!suyas.has(k)) { const e = new Error('Esa entrada no es de esa área'); e.status = 403; throw e; }
          }
          entradas[areaId] = { diario: lista(o?.diario), ajustes: lista(o?.ajustes) };
        }
        // Lo que no venga en el cuerpo se conserva: la pantalla manda UN área cada vez.
        entradas = { ...leerPref(db, userId).entradas, ...entradas };
      }
      const r = setOrden(db, userId, { areas, entradas });
      return c.json({ ok: true, anclas: getAnclas(db, userId), areas: r.areas, ...railDe(c, userId, body.activa) });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // (D) RESTABLECER: el menú vuelve a ser el de fábrica, anclas y orden. Se borra la fila entera —
  // la ausencia de fila ES el defecto, así que no queda rastro de que se personalizó.
  api.delete('/orden', async c => {
    try {
      const userId = usuario(c);
      const body = await c.req.json().catch(() => ({}));
      borrarPref(db, userId);
      return c.json({ ok: true, anclas: [], ...railDe(c, userId, body.activa) });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  return { api };
}
