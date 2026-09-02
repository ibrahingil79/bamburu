import { Hono } from 'hono';
import { adminAuth } from '../../../core/auth.js';
import { csrfProtect } from '../../../core/csrf.js';
import { createAuthRoutes } from './auth.js';
import { createDashboardRoutes } from './dashboard.js';
import { createProductRoutes } from './products.js';
import { createCategoryRoutes } from './categories.js';
import { createClientRoutes } from './clients.js';
import { createProyectoRoutes } from './proyectos.js';   // Escalera · paso 7 — servicios profesionales · PIEZA 1
import { createTiempoRoutes } from './tiempo.js';         // Escalera · paso 7 — PIEZA 2: registro de tiempo
import { createFacturarHorasRoutes } from './facturar-horas.js'; // Escalera · paso 7 — PIEZA 3: facturar horas
import { createRentabilidadRoutes } from './rentabilidad.js';    // Escalera · paso 7 — PIEZA 4: rentabilidad por proyecto
import { createCitasRoutes, createCitasPublicRoutes } from './citas.js';   // Escalera · paso 7 — PIEZA 5: sistema de citas
import { createReservaPublicaRoutes, createReservaEnlaceRoutes, createReservaAdminRoutes } from './reserva-publica.js';   // paso 7 — PIEZA 6: puerta pública de reserva
import { createInventoryRoutes } from './inventory.js';
import { createStockRoutes } from './stock.js';
import { createAnalyticsRoutes } from './analytics.js';
import { createVigiaRoutes } from './vigia.js';   // Escalera · paso 5 — DISA predictiva · PIEZA 1: el vigía
import { createInicioRoutes } from './inicio.js';   // Escalera · paso 6 — Inicio personalizable
import { createMigracionRoutes } from './migracion.js';   // Trae tus datos: la migración la hace el equipo
import { createImportadorRoutes } from './importador.js';   // ficha H — importador de CSV (clientes y productos), DENTRO de la migración asistida
import { createListadosRoutes } from './listados.js';   // C · los tres verbos, una sola vez para los ocho listados
import { createHistorialRoutes } from './historial.js';
import { createMenuRoutes } from './menu-routes.js';   // Navegación — anclas del menú (por usuario)
import { createSettingsRoutes } from './settings.js';
import { createUserRoutes } from './users.js';
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
import { createInvoiceRoutes } from './invoices.js';
import { createDescuentosRoutes } from './descuentos.js';   // punto 11 · promociones, bonos y descuentos
import { createFichajeRoutes } from './fichaje.js';         // punto 12 · control horario (registro de jornada)
import { createCobrosRoutes } from './cobros.js';
import { createCrmRoutes } from './crm.js';
import { createSupplierInvoiceRoutes } from './supplier-invoices.js';
import { createPagosRoutes } from './pagos.js';
import { createAvisosRoutes } from './avisos.js';
import { createPropuestasRoutes } from './propuestas.js';   // D5 — Propuestas de DISA (recordatorio de impago)
import { createSecurityRoutes } from './security.js';
import { createPerfilRoutes } from './perfil.js';
import { createSuscripcionRoutes } from './suscripcion.js';   // suscripcion-plan-y-alta — lo que el negocio paga por usar Bamburu
import { createContabilidadRoutes } from './contabilidad-routes.js';
import { createVerifactuEnvioRoutes } from './verifactu-envio-routes.js';
import { createConciliacionRoutes } from './conciliacion-routes.js';
import { createRecurrentesRoutes } from './recurrentes-routes.js';
import { createPortalAdminRoutes } from '../../portal/admin.js';
import { createMapaRoutes } from './mapa.js';   // F — las teselas del mapa, servidas y cacheadas por nosotros

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
  const { api: mapaApi } = createMapaRoutes(db);
  const { api: clientApi, views: clientViews } = createClientRoutes(db);
  const { api: proyApi, views: proyViews } = createProyectoRoutes(db);   // paso 7 · proyectos
  const { api: tiempoApi, views: tiempoViews } = createTiempoRoutes(db); // paso 7 · registro de tiempo
  const { api: fhApi, views: fhViews } = createFacturarHorasRoutes(db);  // paso 7 · facturar horas
  const { api: rentApi, views: rentViews } = createRentabilidadRoutes(db); // paso 7 · rentabilidad por proyecto
  const { api: citasApi, views: citasViews } = createCitasRoutes(db);      // paso 7 · PIEZA 5 · sistema de citas
  const reservaPubApi = createReservaAdminRoutes(db);                      // paso 7 · PIEZA 6 · mandos del dueño
  const { api: invApi, views: invViews } = createInventoryRoutes(db);
  const { api: stockApi } = createStockRoutes(db);
  const { api: analytApi, views: analytViews } = createAnalyticsRoutes(db);
  const { api: vigiaApi, views: vigiaViews } = createVigiaRoutes(db);
  // El panel de arranque solo ofrece pasos cuyo destino EXISTE. En vez de mantener una lista a mano
  // —que caduca el día que alguien mueve una ruta y deja al dueño nuevo enlaces a un 404—, se le
  // pregunta a la propia aplicación por su tabla de rutas ya montadas.
  const rutaExiste = (href) => {
    const ruta = String(href || '').split('?')[0];
    return (app.routes || []).some(r => r.method === 'GET' && (r.path === ruta || r.path === ruta + '/'));
  };
  const { api: inicioApi } = createInicioRoutes(db, { rutaExiste });   // Escalera · paso 6 — Inicio personalizable
  const { api: menuApi } = createMenuRoutes(db);       // Navegación — anclas del menú (por usuario)
  const { api: migracionApi, views: migracionViews } = createMigracionRoutes(db);
  const { api: importadorApi, views: importadorViews } = createImportadorRoutes(db);
  const { api: settApi, views: settViews, storeViews: storeSettViews } = createSettingsRoutes(db);
  const { api: userApi, views: userViews, activityViews } = createUserRoutes(db);
  const changePasswordRoutes = createChangePasswordRoutes(db);
  const securityRoutes = createSecurityRoutes(db);
  const { api: perfilApi, views: perfilViews } = createPerfilRoutes(db);
  const { api: suscApi, views: suscViews } = createSuscripcionRoutes(db);   // ← plan, prueba de 15 días y alta con Stripe
  const { api: supplierApi, views: supplierViews } = createSupplierRoutes(db);
  const { api: purchaseApi, views: purchaseViews } = createPurchaseRoutes(db);
  const { api: captureApi, views: captureViews } = createPurchaseCaptureRoutes(db);
  const { api: purchaseOrderApi, views: purchaseOrderViews } = createPurchaseOrderRoutes(db);
  const { api: poReceiptApi, views: poReceiptViews } = createPurchaseOrderReceiptRoutes(db);
  const { api: supplierReturnApi, views: supplierReturnViews } = createSupplierReturnRoutes(db);
  const { api: stockTransferApi, views: stockTransferViews } = createStockTransferRoutes(db);
  const { api: warehouseApi, views: warehouseViews } = createWarehouseRoutes(db);
  const { api: invoiceApi, views: invoiceViews } = createInvoiceRoutes(db);
  const { api: dtoApi, views: dtoViews } = createDescuentosRoutes(db);
  const { api: fichajeApi, views: fichajeViews } = createFichajeRoutes(db);
  const { api: cobrosApi, views: cobrosViews } = createCobrosRoutes(db);
  const { api: crmApi, views: crmViews } = createCrmRoutes(db);
  const { api: supplierInvoiceApi, views: supplierInvoiceViews } = createSupplierInvoiceRoutes(db);
  const { api: pagosApi, views: pagosViews } = createPagosRoutes(db);
  const { api: avisosApi, views: avisosViews } = createAvisosRoutes(db);
  const { api: propuestasApi, views: propuestasViews } = createPropuestasRoutes(db);
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
  admin.route('/proyectos', proyViews);   // ← /admin/proyectos (vista con candado proyectos.read)
  admin.route('/tiempo', tiempoViews);    // ← /admin/tiempo (vista semanal, candado tiempo.read)
  admin.route('/facturar-horas', fhViews); // ← /admin/facturar-horas (candado invoices.create)
  admin.route('/rentabilidad', rentViews); // ← /admin/rentabilidad (candado proyectos.read + invoices.read)
  admin.route('/citas', citasViews);       // ← /admin/citas (agenda, cola, servicios, recursos, horarios, ajustes · candado citas.read/edit)
  // PIEZA C — POS viejo RETIRADO del admin (clúster sales_orders, sin Verifactu). Desmontado, no
  // borrado: orders.js sigue en el repo. Cae con él la falsa "FACTURA" (D3, /admin/orders/:id/invoice),
  // el POS, los borradores y los reembolsos viejos. Archivado de tablas y corte de escritura de DISA = D1.
  // admin.route('/orders', orderViews);
  admin.route('/inventory', invViews);
  // ENCARGO CUPONES (23 ago 2026) — CUPONES RETIRADOS. Desmontado, no borrado: discounts.js sigue en el repo, igual
  // que orders.js y shipping.js. Sus tablas (discount_codes, auto_discounts) quedan archivadas a
  // *_archived por la migración `migration_b_archive_discounts_2026_v1` de models.js. Motivo: ningún
  // documento vivo aplica un cupón —ni factura, ni presupuesto, ni pedido, ni mostrador—; sus únicos
  // lectores eran la tienda y el POS viejo, los dos ya apagados.
  //
  // OJO CON CÓMO SE COMPRUEBA QUE LA TIENDA ESTÁ APAGADA, porque el grep engaña de dos maneras: (1)
  // `core/loader.js` importa los módulos con una ruta CONSTRUIDA (`join(modulesDir, mod, 'index.js')`),
  // así que buscar "modules/store" no encuentra nada y parece código muerto; y (2) el arranque imprime
  // "✅ Store: Tienda pública en /store" aunque no monte nada, porque ese console.log está antes de las
  // dos líneas comentadas. Lo que de verdad la apaga son los `app.route` comentados por D1 al final de
  // `modules/store/routes.js`: /store y /api/store/* devuelven 404 (medido).
  // Con esto cae también la superficie de descuentos de DISA (modules/disa/index.js).
  // admin.route('/discounts', discViews);
  // D2 — resto e-commerce DESMONTADO (envíos): comentado, no borrado; shipping.js permanece. /admin/shipping → 404.
  // admin.route('/shipping', shipViews);
  admin.route('/analytics', analytViews);
  admin.route('/vigia', vigiaViews);     // ← DISA predictiva · el vigía (motor de detección)
  admin.route('/settings', settViews);   // ← /admin/settings (config de EMPRESA) SE QUEDA (núcleo vivo)
  admin.route('/migracion/importar', importadorViews);   // ← ficha H · el importador de CSV. VA ANTES que /migracion: montar el padre primero le daría la subruta a la asistida.
  admin.route('/migracion', migracionViews);   // ← /admin/migracion (trae tus datos · candado company.read)
  // D2 — store-builder DESMONTADO (UI): /admin/store-settings → 404. store_settings NO se archiva (se conserva el diseño, tienda Capa 2).
  // admin.route('/store-settings', storeSettViews);
  admin.route('/users', userViews);
  admin.route('/activity', activityViews);
  // D2 — restos e-commerce DESMONTADOS (newsletter, reseñas): comentados, no borrados. → 404.
  // admin.route('/newsletter', nlViews);
  // admin.route('/reviews', revViews);
  admin.route('/perfil', perfilViews);          // ← Perfil de usuario: datos + contraseña + 2FA
  admin.route('/suscripcion', suscViews);       // ← Mi suscripción: plan, prueba y tarjeta (SOLO el dueño)
  admin.route('/change-password', changePasswordRoutes);   // pantalla-cerrojo (core/auth.js), fuera del menú
  admin.route('/security', securityRoutes);     // solo redirige a /admin/perfil (2FA consolidado)
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
  admin.route('/descuentos', dtoViews);
  admin.route('/fichaje', fichajeViews);
  admin.route('/cobros', cobrosViews);
  admin.route('/crm', crmViews);                // CRM comercial: embudo (/) + cola (/cola)
  admin.route('/supplier-invoices', supplierInvoiceViews);
  admin.route('/pagos', pagosViews);
  admin.route('/avisos', avisosViews);          // pantalla central de avisos (motor: erp/avisos.js)
  admin.route('/propuestas', propuestasViews);  // D5 — Propuestas de DISA (recordatorio de impago)
  admin.route('/contabilidad', contabViews);
  admin.route('/verifactu', createVerifactuEnvioRoutes(db).views);
  admin.route('/conciliacion', createConciliacionRoutes(db).views);
  admin.route('/recurrentes', createRecurrentesRoutes(db).views);
  admin.route('/portal', createPortalAdminRoutes(db).views);
  // C · IMPRIMIR / DESCARGAR / ENVIAR. TRES rutas para los OCHO listados, no tres por listado:
  // añadir uno es declararlo en `listados.js`, no tocar nada de aquí.
  const { api: listApi, views: listViews } = createListadosRoutes(db);
  // PELDAÑO 8 · HISTORIAL CLÍNICO. Las rutas existen siempre, pero dan 404 fuera del oficio de salud
  // (primera puerta, dentro del propio módulo) y 403 sin el permiso, que NO perdona el rol admin.
  admin.route('/historial', createHistorialRoutes(db).views);
  admin.route('/listados', listViews);          // ← /admin/listados/<clave>/{imprimir,pdf}
  app.route('/admin', admin);

  // ── Protected API ──────────────────────────────────────────────
  const apiApp = new Hono();
  apiApp.use('*', auth);
  apiApp.use('*', csrf);
  apiApp.route('/products', prodApi);
  apiApp.route('/categories', catApi);
  apiApp.route('/clients', clientApi);
  apiApp.route('/mapa', mapaApi);       // ← /api/erp/mapa/tesela/:z/:x/:y (candado clients.read)
  apiApp.route('/proyectos', proyApi);   // ← /api/erp/proyectos (CRUD con proyectos.read/edit)
  apiApp.route('/tiempo', tiempoApi);    // ← /api/erp/tiempo (cronómetro + entradas, tiempo.read/edit)
  apiApp.route('/facturar-horas', fhApi); // ← /api/erp/facturar-horas (preview + emitir, invoices.create)
  apiApp.route('/rentabilidad', rentApi); // ← /api/erp/rentabilidad (panel + comparativa, proyectos.read+invoices.read)
  apiApp.route('/citas', citasApi);       // ← /api/erp/citas (agenda, huecos, citas, avisos, cola, config · citas.read/edit)
  apiApp.route('/reserva-publica', reservaPubApi);   // ← PIEZA 6 · mandos de la puerta pública (citas.read/edit)
  // PIEZA C — API del POS viejo RETIRADA (ver nota arriba). Desmontado, no borrado.
  // apiApp.route('/orders', orderApi);   // ⚠️ 24 ago 2026: orders.js RETIRADO del árbol (ver nota abajo)
  apiApp.route('/inventory', invApi);
  // ENCARGO CUPONES — API de cupones RETIRADA (ver nota arriba). Desmontada, no borrada. /api/erp/discounts/* → 404.
  // apiApp.route('/discounts', discApi);
  // D2 — API de envíos DESMONTADA: comentada, no borrada. /api/erp/shipping/* → 404.
  // apiApp.route('/shipping', shipApi);
  apiApp.route('/analytics', analytApi);
  apiApp.route('/vigia', vigiaApi);     // ← DISA predictiva · hallazgos del vigía (solo lectura)
  apiApp.route('/inicio', inicioApi);   // ← Inicio personalizable (layout por usuario/empresa/fábrica)
  apiApp.route('/migracion', migracionApi);   // ← Trae tus datos: la migración la hace el equipo, a mano
  apiApp.route('/importar', importadorApi);   // ← ficha H · analizar (no escribe) / importar (una transacción) / deshacer
  apiApp.route('/listados', listApi);        // ← POST /api/erp/listados/<clave>/enviar
  apiApp.route('/menu', menuApi);       // ← anclas del menú de CADA usuario (solo colocación, sin datos)
  apiApp.route('/perfil', perfilApi);   // ← datos personales del usuario logueado (+ su foto)
  apiApp.route('/suscripcion', suscApi);   // ← abrir el Checkout de Stripe y consultar la situación (SOLO el dueño)
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
  apiApp.route('/descuentos', dtoApi);
  apiApp.route('/fichaje', fichajeApi);
  apiApp.route('/cobros', cobrosApi);
  apiApp.route('/crm', crmApi);
  apiApp.route('/supplier-invoices', supplierInvoiceApi);
  apiApp.route('/pagos', pagosApi);
  apiApp.route('/avisos', avisosApi);
  apiApp.route('/propuestas', propuestasApi);
  apiApp.route('/contabilidad', contabApi);
  apiApp.route('/stock', stockApi);
  app.route('/api/erp', apiApp);

  // ── PIEZA 5 · ENLACE PÚBLICO DE LA CITA (1.9) ──────────────────────────────────
  // Sin /admin ni auth de panel, sin CSRF: la LLAVE (token, 256 bits) es la defensa. El tenant lo
  // resuelve tenantMiddleware por subdominio. Solo abre SU cita; confirmar / avisar de que no puede ir.
  //
  // PIEZA 6 añade en el MISMO prefijo las acciones con ventana (huecos / cambiar / anular). Son rutas
  // de DOS segmentos, así que no compiten con el `/:token` de la pieza 5, y solo actúan sobre citas
  // NACIDAS FUERA: para una cita creada en la agenda devuelven 403 y su enlace sigue como estaba.
  app.route('/cita', createReservaEnlaceRoutes(db));
  app.route('/cita', createCitasPublicRoutes(db));

  // ── PIEZA 6 · LA PUERTA PÚBLICA DE RESERVA ─────────────────────────────────────
  // https://<negocio>.bamburu.com/reservar/<handle>. Sin sesión y sin CSRF; el negocio lo resuelve el
  // subdominio (igual que el enlace de la cita) y el <handle> se comprueba contra el del tenant ya
  // resuelto. APAGADA por defecto: sin encenderla, todo esto responde 404.
  app.route('/reservar', createReservaPublicaRoutes(db));
}
