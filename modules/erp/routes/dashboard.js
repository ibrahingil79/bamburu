import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { disaHomeHtml } from '../views/disaHome.html.js';

export function createDashboardRoutes(db) {
  const r = new Hono();

  r.get('/', c => {
    const session = c.get('session');

    let userName = 'Ibrahin';
    let alertCount = 0;
    const kpis = { ventas: 0, pedidos: 0, pendiente: 0 };

    try {
      const user = db.prepare('SELECT name FROM admin_users WHERE id = ?').get(session?.userId);
      if (user?.name) userName = user.name.split(' ')[0];
    } catch {}
    try {
      const low = db.prepare("SELECT COUNT(*) as c FROM products WHERE stock < 5 AND status='active'").get();
      alertCount = low?.c || 0;
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

    return c.html(adminLayout('Dashboard', disaHomeHtml({ userName, alertCount, kpis }), 'dashboard', session?.csrfToken || '', c, true));
  });

  return r;
}
