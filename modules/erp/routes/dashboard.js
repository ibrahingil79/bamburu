import { Hono } from 'hono';
import { adminLayout, fuentesPermitidas, can } from '../layout.js';
import { disaHomeHtml } from '../views/disaHome.html.js';
import { estadoAvisos, hoyLocal } from '../avisos.js';
import { ventasResumen, pedidosResumen } from '../ventas-metrics.js';   // PIEZA C: ventas desde la cadena nueva (facturas), pedidos desde customer_orders
import { modoYaPreguntado } from '../margen.js';   // G4: el paso del margen del alta
import { oficioDe } from '../oficios.js';          // para que DISA PROPONGA (nunca marque)

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
      // Una sola pasada del motor por carga de /admin: se deja en el contexto y adminLayout la
      // reutiliza para la campana en vez de recalcular lo mismo con los mismos argumentos.
      // Solo las fuentes que este usuario puede ver.
      const est = estadoAvisos(db, hoyLocal(), session?.userId, fuentesPermitidas(c));
      c.set('avisosEstado', est);
      alertCount = est.count;
      alertState = est.estado;
    } catch {}
    try {
      const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
      kpis.sym = sym;
      // D2 — los KPIs se filtran por permiso, IGUAL que el chat: "Ventas del mes" (facturado) exige
      // invoices.read y "Pedidos"/"Pendientes" exigen pedidos.read (mismos permisos que gatea
      // buildBusinessContext en disa/index.js). Antes se calculaban SIEMPRE, así que un empleado sin
      // invoices.read veía la cifra total facturada en la home. `verVentas`/`verPedidos` distinguen
      // "sin permiso" (la vista pinta "—") de un cero legítimo (pinta 0). Owner/admin: can() hace bypass.
      kpis.verVentas = can(c, 'invoices.read');
      kpis.verPedidos = can(c, 'pedidos.read');
      if (kpis.verVentas) {
        // PIEZA C — ventas del mes desde la cadena NUEVA (facturas: F1 ordinaria + F2 ticket + F3
        // sustitutiva, neteando rectificativas, sin anuladas ni tickets sustituidos). Titular = total
        // facturado con IVA.
        const monthStart = new Date().toISOString().slice(0, 7) + '-01';
        kpis.ventas = Math.round(ventasResumen(db, { from: monthStart }).total);
      }
      if (kpis.verPedidos) {
        const ped = pedidosResumen(db);   // pedidos/pendientes desde customer_orders
        kpis.pedidos = ped.confirmadosMes;
        kpis.pendiente = ped.pendientes;
      }
    } catch {}

    // U6 — Onboarding / primeros pasos. Estado DERIVADO del estado real del negocio (solo lectura,
    // sin flags que mantener a mano): datos de empresa (NIF puesto), ≥1 cliente, ≥1 factura y —G4—
    // haber contestado (o saltado) cómo cuenta su margen. Solo para el dueño/admin (es la bienvenida
    // del dueño). Con todos hechos, onboarding=null → el Inicio queda como el home normal de DISA y
    // el checklist se retira solo.
    //
    // AÑADIR UN PASO son DOS cosas y ninguna más: un booleano aquí y una entrada en `onbSteps`
    // (disaHome.html.js). El total ya no está escrito a mano en ningún sitio.
    let onboarding = null;
    try {
      const role = session?.role;
      if (role === 'owner' || role === 'admin') {
        const cc = db.prepare('SELECT fiscal_id FROM company_config WHERE id=1').get() || {};
        const companyDone = !!(cc.fiscal_id && String(cc.fiscal_id).trim());
        const clientDone = (db.prepare('SELECT COUNT(*) AS n FROM clients').get()?.n || 0) > 0;
        const invoiceDone = (db.prepare('SELECT COUNT(*) AS n FROM invoices').get()?.n || 0) > 0;
        // Hecho = contestado O saltado. Saltar TERMINA el paso: no puede quedarse pinchado para
        // siempre en la pantalla de alguien que ya dijo que ahora no.
        const margenDone = modoYaPreguntado(db);
        const pasos = [companyDone, clientDone, invoiceDone, margenDone];
        const done = pasos.filter(Boolean).length;
        if (done < pasos.length) {
          // DISA PROPONE según el oficio, NUNCA marca (CANON). Quien compra material para
          // revenderlo —taller, estética— suele hablar de markup ("le meto un 40 %"); quien vende
          // sobre todo su tiempo, de margen sobre la venta. Es UNA FRASE en la guía de DISA y nada
          // más: ninguna de las dos opciones queda premarcada, en ningún oficio.
          let margenSugerido = null;
          try {
            const of = oficioDe(db);
            const id = typeof of === 'string' ? of : (of?.id || '');
            if (['taller', 'estetica'].includes(id)) margenSugerido = 'coste';
          } catch {}
          onboarding = { companyDone, clientDone, invoiceDone, margenDone, done, margenSugerido };
        }
      }
    } catch {}

    const simbolo = db.prepare('SELECT currency_symbol s FROM company_config WHERE id=1').get()?.s || '€';
    return c.html(adminLayout('Dashboard', disaHomeHtml({ userName, alertCount, alertState, kpis, onboarding, simbolo }), 'dashboard', session?.csrfToken || '', c, true));
  });

  return r;
}
