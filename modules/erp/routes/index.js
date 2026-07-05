import { Hono } from 'hono';
import { adminAuth } from '../../../core/auth.js';
import { csrfProtect } from '../../../core/csrf.js';
import { createAuthRoutes } from './auth.js';
import { createDashboardRoutes } from './dashboard.js';
import { createProductRoutes } from './products.js';
import { createCategoryRoutes } from './categories.js';
import { createClientRoutes } from './clients.js';
import { createOrderRoutes } from './orders.js';
import { createInventoryRoutes } from './inventory.js';
import { createStockRoutes } from './stock.js';
import { createDiscountRoutes } from './discounts.js';
import { createShippingRoutes } from './shipping.js';
import { createAnalyticsRoutes } from './analytics.js';
import { createSettingsRoutes } from './settings.js';
import { createUserRoutes } from './users.js';
import { createNewsletterRoutes } from './newsletter.js';
import { createReviewRoutes } from './reviews.js';
import { createChangePasswordRoutes } from './change-password.js';
import { createSupplierRoutes } from './suppliers.js';
import { createPurchaseRoutes } from './purchases.js';
import { createPurchaseCaptureRoutes } from './purchases-capture.js';
import { createPurchaseOrderRoutes } from './purchase-orders.js';
import { createQuoteRoutes } from './quotes.js';
import { createPedidoRoutes } from './pedidos.js';
import { createAlbaranRoutes } from './albaranes.js';
import { createMostradorRoutes } from './mostrador.js';
import { createPurchaseOrderReceiptRoutes } from './purchase-order-receipts.js';
import { createSupplierReturnRoutes } from './supplier-returns.js';
import { createStockTransferRoutes } from './stock-transfers.js';
import { createWarehouseRoutes } from './warehouses.js';
import { createFeedbackRoutes } from './feedback.js';
import { createInvoiceRoutes } from './invoices.js';
import { createCobrosRoutes } from './cobros.js';
import { createSupplierInvoiceRoutes } from './supplier-invoices.js';
import { createPagosRoutes } from './pagos.js';
import { createSecurityRoutes } from './security.js';
import { createContabilidadRoutes } from './contabilidad-routes.js';
import { createVerifactuEnvioRoutes } from './verifactu-envio-routes.js';
import { createConciliacionRoutes } from './conciliacion-routes.js';
import { createRecurrentesRoutes } from './recurrentes-routes.js';

export function mountRoutes(app, db) {
  const auth = adminAuth(db);
  const csrf = csrfProtect();

  // ── Public auth routes ─────────────────────────────────────────
  const authRoutes = createAuthRoutes(db);
  app.route('/admin', authRoutes);

  // ── Build all route handlers ───────────────────────────────────
  const dashboard = createDashboardRoutes(db);
  const { api: prodApi, views: prodViews, tagsViews } = createProductRoutes(db);
  const { api: catApi, views: catViews } = createCategoryRoutes(db);
  const { api: clientApi, views: clientViews } = createClientRoutes(db);
  const { api: orderApi, views: orderViews } = createOrderRoutes(db);
  const { api: invApi, views: invViews } = createInventoryRoutes(db);
  const { api: stockApi } = createStockRoutes(db);
  const { api: discApi, views: discViews } = createDiscountRoutes(db);
  const { api: shipApi, views: shipViews } = createShippingRoutes(db);
  const { api: analytApi, views: analytViews } = createAnalyticsRoutes(db);
  const { api: settApi, views: settViews, storeViews: storeSettViews } = createSettingsRoutes(db);
  const { api: userApi, views: userViews, activityViews } = createUserRoutes(db);
  const { api: nlApi, views: nlViews } = createNewsletterRoutes(db);
  const { api: revApi, views: revViews } = createReviewRoutes(db);
  const changePasswordRoutes = createChangePasswordRoutes(db);
  const securityRoutes = createSecurityRoutes(db);
  const { api: supplierApi, views: supplierViews } = createSupplierRoutes(db);
  const { api: purchaseApi, views: purchaseViews } = createPurchaseRoutes(db);
  const { api: captureApi, views: captureViews } = createPurchaseCaptureRoutes(db);
  const { api: purchaseOrderApi, views: purchaseOrderViews } = createPurchaseOrderRoutes(db);
  const { api: poReceiptApi, views: poReceiptViews } = createPurchaseOrderReceiptRoutes(db);
  const { api: supplierReturnApi, views: supplierReturnViews } = createSupplierReturnRoutes(db);
  const { api: stockTransferApi, views: stockTransferViews } = createStockTransferRoutes(db);
  const { api: warehouseApi, views: warehouseViews } = createWarehouseRoutes(db);
  const { api: feedbackApi, views: feedbackViews } = createFeedbackRoutes(db);
  const { api: invoiceApi, views: invoiceViews } = createInvoiceRoutes(db);
  const { api: cobrosApi, views: cobrosViews } = createCobrosRoutes(db);
  const { api: supplierInvoiceApi, views: supplierInvoiceViews } = createSupplierInvoiceRoutes(db);
  const { api: pagosApi, views: pagosViews } = createPagosRoutes(db);
  const { api: quoteApi, views: quoteViews } = createQuoteRoutes(db);
  const { api: pedidoApi, views: pedidoViews } = createPedidoRoutes(db);
  const { api: albaranApi, views: albaranViews } = createAlbaranRoutes(db);
  const { api: mostradorApi, views: mostradorViews } = createMostradorRoutes(db);
  const { api: contabApi, views: contabViews } = createContabilidadRoutes(db);

  // ── Protected admin views ──────────────────────────────────────
  const admin = new Hono();
  admin.use('*', auth);
  admin.use('*', csrf);
  admin.route('/', dashboard);
  admin.route('/products', prodViews);
  admin.route('/tags', tagsViews);
  admin.route('/categories', catViews);
  admin.route('/clients', clientViews);
  // PIEZA C — POS viejo RETIRADO del admin (clúster sales_orders, sin Verifactu). Desmontado, no
  // borrado: orders.js sigue en el repo. Cae con él la falsa "FACTURA" (D3, /admin/orders/:id/invoice),
  // el POS, los borradores y los reembolsos viejos. Archivado de tablas y corte de escritura de DISA = D1.
  // admin.route('/orders', orderViews);
  admin.route('/inventory', invViews);
  admin.route('/discounts', discViews);
  // D2 — resto e-commerce DESMONTADO (envíos): comentado, no borrado; shipping.js permanece. /admin/shipping → 404.
  // admin.route('/shipping', shipViews);
  admin.route('/analytics', analytViews);
  admin.route('/settings', settViews);   // ← /admin/settings (config de EMPRESA) SE QUEDA (núcleo vivo)
  // D2 — store-builder DESMONTADO (UI): /admin/store-settings → 404. store_settings NO se archiva (se conserva el diseño, tienda Capa 2).
  // admin.route('/store-settings', storeSettViews);
  admin.route('/users', userViews);
  admin.route('/activity', activityViews);
  // D2 — restos e-commerce DESMONTADOS (newsletter, reseñas): comentados, no borrados. → 404.
  // admin.route('/newsletter', nlViews);
  // admin.route('/reviews', revViews);
  admin.route('/change-password', changePasswordRoutes);
  admin.route('/security', securityRoutes);
  admin.route('/suppliers', supplierViews);
  // C2 — captura ANTES que /purchases para que /purchases/capture no lo capture /purchases/:id.
  admin.route('/purchases/capture', captureViews);
  admin.route('/purchases', purchaseViews);
  admin.route('/purchase-orders', purchaseOrderViews);
  admin.route('/purchase-order-receipts', poReceiptViews);
  admin.route('/supplier-returns', supplierReturnViews);
  admin.route('/stock-transfers', stockTransferViews);
  admin.route('/warehouses', warehouseViews);
  // D2 — buzón de feedback DESMONTADO: comentado, no borrado. /admin/feedback → 404.
  // admin.route('/feedback', feedbackViews);
  admin.route('/quotes', quoteViews);
  admin.route('/pedidos', pedidoViews);
  admin.route('/albaranes', albaranViews);
  admin.route('/mostrador', mostradorViews);
  admin.route('/invoices', invoiceViews);
  admin.route('/cobros', cobrosViews);
  admin.route('/supplier-invoices', supplierInvoiceViews);
  admin.route('/pagos', pagosViews);
  admin.route('/contabilidad', contabViews);
  admin.route('/verifactu', createVerifactuEnvioRoutes(db).views);
  admin.route('/conciliacion', createConciliacionRoutes(db).views);
  admin.route('/recurrentes', createRecurrentesRoutes(db).views);
  app.route('/admin', admin);

  // ── Protected API ──────────────────────────────────────────────
  const apiApp = new Hono();
  apiApp.use('*', auth);
  apiApp.use('*', csrf);
  apiApp.route('/products', prodApi);
  apiApp.route('/categories', catApi);
  apiApp.route('/clients', clientApi);
  // PIEZA C — API del POS viejo RETIRADA (ver nota arriba). Desmontado, no borrado.
  // apiApp.route('/orders', orderApi);
  apiApp.route('/inventory', invApi);
  apiApp.route('/discounts', discApi);
  // D2 — API de envíos DESMONTADA: comentada, no borrada. /api/erp/shipping/* → 404.
  // apiApp.route('/shipping', shipApi);
  apiApp.route('/analytics', analytApi);
  apiApp.route('/settings', settApi);   // ← /api/erp/settings SE QUEDA (config de empresa); solo /settings/store se neutraliza en settings.js
  apiApp.route('/users', userApi);
  // D2 — API de newsletter y reseñas DESMONTADAS: comentadas, no borradas. → 404.
  // apiApp.route('/newsletter', nlApi);
  // apiApp.route('/reviews', revApi);
  apiApp.route('/suppliers', supplierApi);
  // C2 — captura ANTES que /purchases (mismo motivo de prioridad de rutas).
  apiApp.route('/purchases/capture', captureApi);
  apiApp.route('/purchases', purchaseApi);
  apiApp.route('/purchase-orders', purchaseOrderApi);
  apiApp.route('/purchase-order-receipts', poReceiptApi);
  apiApp.route('/supplier-returns', supplierReturnApi);
  apiApp.route('/stock-transfers', stockTransferApi);
  apiApp.route('/warehouses', warehouseApi);
  // D2 — API del buzón de feedback DESMONTADA: comentada, no borrada. /api/erp/feedback → 404.
  // apiApp.route('/feedback', feedbackApi);
  apiApp.route('/quotes', quoteApi);
  apiApp.route('/pedidos', pedidoApi);
  apiApp.route('/albaranes', albaranApi);
  apiApp.route('/mostrador', mostradorApi);
  apiApp.route('/invoices', invoiceApi);
  apiApp.route('/cobros', cobrosApi);
  apiApp.route('/supplier-invoices', supplierInvoiceApi);
  apiApp.route('/pagos', pagosApi);
  apiApp.route('/contabilidad', contabApi);
  apiApp.route('/stock', stockApi);
  app.route('/api/erp', apiApp);
}
