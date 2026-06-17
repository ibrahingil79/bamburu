import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { disaHomeHtml } from '../views/disaHome.html.js';
import { estadoAvisos } from '../avisos.js';

export function createDashboardRoutes(db) {
  const r = new Hono();

  r.get('/', c => {
    const session = c.get('session');

    let userName = 'Ibrahin';
    let alertCount = 0;
    let alertState = 'apagado';
    const kpis = { ventas: 0, pedidos: 0, pendiente: 0 };

    try {
      const user = db.prepare('SELECT name FROM admin_users WHERE id = ?').get(session?.userId);
      if (user?.name) userName = user.name.split(' ')[0];
    } catch {}
    // Paso (d) — el badge sale ENTERO del motor de avisos (fuentes: vencimientos de proveedor +
    // stock bajo). count = total de avisos; estado = rojo (algo nuevo) / visto / apagado (Opción C).
    // Una sola fuente de verdad → el número del badge y el del resumen-primero coinciden siempre.
    try {
      const est = estadoAvisos(db, new Date().toISOString().slice(0, 10));
      alertCount = est.count;
      alertState = est.estado;
    } catch {}
    try {
      const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
      kpis.sym = sym;
      const ventasRow = db.prepare(`SELECT COALESCE(SUM(total),0) as total FROM sales_orders WHERE status != 'cancelado' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`).get();
      kpis.ventas = Math.round(ventasRow?.total || 0);
      const pedidosRow = db.prepare(`SELECT COUNT(*) as c FROM sales_orders WHERE status != 'cancelado' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`).get();
      kpis.pedidos = pedidosRow?.c || 0;
      const pendienteRow = db.prepare(`SELECT COUNT(*) as c FROM sales_orders WHERE status IN ('borrador','en_preparacion','enviado')`).get();
      kpis.pendiente = pendienteRow?.c || 0;
    } catch {}

    return c.html(adminLayout('Dashboard', disaHomeHtml({ userName, alertCount, alertState, kpis }), 'dashboard', session?.csrfToken || '', c, true));
  });

  return r;
}
