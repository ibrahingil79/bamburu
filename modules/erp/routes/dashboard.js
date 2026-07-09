import { Hono } from 'hono';
import { adminLayout } from '../layout.js';
import { disaHomeHtml } from '../views/disaHome.html.js';
import { estadoAvisos } from '../avisos.js';
import { ventasResumen, pedidosResumen } from '../ventas-metrics.js';   // PIEZA C: ventas desde la cadena nueva (facturas), pedidos desde customer_orders

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
    // Paso (d) — el badge sale ENTERO del motor de avisos (fuentes: vencimientos de proveedor,
    // cobros de cliente vencidos, stock bajo, recurrentes en borrador). count = total de avisos;
    // estado = rojo (algo nuevo PARA ESTE USUARIO) / visto / apagado (Opción C). Una sola fuente
    // de verdad → el número del badge, el del resumen-primero y el de /admin/avisos coinciden.
    try {
      const est = estadoAvisos(db, new Date().toISOString().slice(0, 10), session?.userId);
      alertCount = est.count;
      alertState = est.estado;
    } catch {}
    try {
      const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
      kpis.sym = sym;
      // PIEZA C — ventas del mes desde la cadena NUEVA (facturas: F1 ordinaria + F2 ticket + F3
      // sustitutiva, neteando rectificativas, sin anuladas ni tickets sustituidos). Titular = total
      // facturado con IVA. Pedidos/pendientes desde customer_orders (alineado con la 2a).
      const monthStart = new Date().toISOString().slice(0, 7) + '-01';
      kpis.ventas = Math.round(ventasResumen(db, { from: monthStart }).total);
      const ped = pedidosResumen(db);
      kpis.pedidos = ped.confirmadosMes;
      kpis.pendiente = ped.pendientes;
    } catch {}

    // U6 — Onboarding / primeros pasos. Estado de los 3 pasos DERIVADO del estado real del negocio
    // (solo lectura, sin flags que mantener a mano): datos de empresa (NIF puesto), ≥1 cliente,
    // ≥1 factura. Solo para el dueño/admin (es la bienvenida del dueño). Si los 3 están hechos,
    // onboarding=null → el Inicio queda como el home normal de DISA (el checklist se retira solo).
    let onboarding = null;
    try {
      const role = session?.role;
      if (role === 'owner' || role === 'admin') {
        const cc = db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get() || {};
        const companyDone = !!(cc.fiscal_id && String(cc.fiscal_id).trim());
        const clientDone = (db.prepare('SELECT COUNT(*) AS n FROM clients').get()?.n || 0) > 0;
        const invoiceDone = (db.prepare('SELECT COUNT(*) AS n FROM invoices').get()?.n || 0) > 0;
        const done = [companyDone, clientDone, invoiceDone].filter(Boolean).length;
        if (done < 3) onboarding = { companyDone, clientDone, invoiceDone, done };
      }
    } catch {}

    return c.html(adminLayout('Dashboard', disaHomeHtml({ userName, alertCount, alertState, kpis, onboarding }), 'dashboard', session?.csrfToken || '', c, true));
  });

  return r;
}
