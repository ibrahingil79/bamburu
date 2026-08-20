// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL INICIO (/admin) — la ruta. Sirve el CUADRO DE MANDO DEL DÍA.
//
// AQUÍ YA NO SE CALCULA NINGUNA CIFRA. Antes esta ruta sacaba las ventas del mes, los pedidos y los
// pendientes para pintarlos en el HTML, y encima el motor de avisos. Ahora las cifras las pide la
// pantalla a /api/erp/inicio/cuadro, que es UNA sola puerta con UNA sola lista de permisos: sin ella
// había dos sitios calculando lo mismo con dos filtros distintos, y el día que uno cambiara el otro
// se quedaría viejo en silencio.
//
// LO ÚNICO QUE SE HACE AQUÍ, y por un motivo concreto: una pasada del motor de avisos por carga de
// /admin, dejada en el contexto para que `adminLayout` pinte la campana sin repetir el escaneo (que
// es caro). No se pinta ninguna cifra con ella.
//
// `hideDisaSidebar = true` se conserva: el Inicio no lleva el chat de DISA, ni en línea ni flotando.
// DISA no se pierde — está en su entrada del menú y en /admin/disa, que es a donde lleva.
import { Hono } from 'hono';
import { adminLayout, fuentesPermitidas } from '../layout.js';
import { disaHomeHtml } from '../views/disaHome.html.js';
import { estadoAvisos, hoyLocal } from '../avisos.js';

export function createDashboardRoutes(db) {
  const r = new Hono();

  r.get('/', c => {
    const session = c.get('session');

    let userName = 'Ibrahin';
    try {
      const user = db.prepare('SELECT name FROM admin_users WHERE id = ?').get(session?.userId);
      if (user?.name) userName = user.name.split(' ')[0];
    } catch {}

    // Una sola pasada del motor de avisos por carga de /admin: se deja en el contexto y adminLayout
    // la reutiliza para la campana en vez de recalcular lo mismo con los mismos argumentos. Solo las
    // fuentes que este usuario puede ver.
    try {
      c.set('avisosEstado', estadoAvisos(db, hoyLocal(), session?.userId, fuentesPermitidas(c)));
    } catch {}

    const simbolo = db.prepare('SELECT currency_symbol s FROM company_config WHERE id=1').get()?.s || '€';
    return c.html(adminLayout('Inicio', disaHomeHtml({ userName, simbolo }), 'dashboard',
                              session?.csrfToken || '', c, true));
  });

  return r;
}
