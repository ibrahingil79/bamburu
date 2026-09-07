| Método | Ruta | Exige | Dónde está |
|---|---|---|---|
| GET | `/` | — **nada** | `index.js:62` |
| GET | `/acceso` | — **nada** | `index.js:1360` |
| GET | `/acceso/entrar` | — **nada** | `index.js:1298` |
| GET | `/admin` | solo sesión | `modules/erp/routes/dashboard.js:24` |
| GET | `/admin/activity` | `admin.manage_users` | `modules/erp/routes/users.js:515` |
| GET | `/admin/albaranes` | `albaranes.read` | `modules/erp/routes/albaranes.js:352` |
| GET | `/admin/albaranes/:id` | `albaranes.read` | `modules/erp/routes/albaranes.js:550` |
| GET | `/admin/albaranes/:id/pdf` | `albaranes.read` | `modules/erp/routes/albaranes.js:609` |
| GET | `/admin/albaranes/new` | `albaranes.create` | `modules/erp/routes/albaranes.js:406` |
| GET | `/admin/analytics` | `analytics.read` | `modules/erp/routes/analytics.js:366` |
| GET | `/admin/autologin` | — **nada** | `index.js:1482` |
| GET | `/admin/avisos` | solo sesión | `modules/erp/routes/avisos.js:153` |
| GET | `/admin/categories` | `categories.read` | `modules/erp/routes/categories.js:39` |
| GET | `/admin/change-password` | solo sesión | `modules/erp/routes/change-password.js:16` |
| POST | `/admin/change-password` | solo sesión | `modules/erp/routes/change-password.js:52` |
| GET | `/admin/citas` | `citas.read` | `modules/erp/routes/citas.js:1030` |
| GET | `/admin/citas/ajustes` | `citas.edit` | `modules/erp/routes/citas.js:1035` |
| GET | `/admin/citas/cola` | `citas.read` | `modules/erp/routes/citas.js:1031` |
| GET | `/admin/citas/horarios` | `citas.read` | `modules/erp/routes/citas.js:1034` |
| GET | `/admin/citas/publica` | `citas.edit` | `modules/erp/routes/citas.js:1037` |
| GET | `/admin/citas/recursos` | `citas.read` | `modules/erp/routes/citas.js:1033` |
| GET | `/admin/citas/servicios` | `citas.read` | `modules/erp/routes/citas.js:1032` |
| GET | `/admin/clients` | `clients.read` | `modules/erp/routes/clients.js:523` |
| GET | `/admin/clients/:id{[0-9]+}` | `clients.read` | `modules/erp/routes/clients.js:1012` |
| GET | `/admin/clients/groups` | `clients.read` | `modules/erp/routes/clients.js:1101` |
| GET | `/admin/cobros` | `cobros.read` | `modules/erp/routes/cobros.js:26` |
| GET | `/admin/conciliacion` | `conciliacion.read` | `modules/erp/routes/conciliacion-routes.js:57` |
| POST | `/admin/conciliacion/:id/conciliar-cobro` | `conciliacion.manage` | `modules/erp/routes/conciliacion-routes.js:196` |
| POST | `/admin/conciliacion/:id/conciliar-factura` | `conciliacion.manage` | `modules/erp/routes/conciliacion-routes.js:202` |
| POST | `/admin/conciliacion/:id/conciliar-gasto` | `conciliacion.manage` | `modules/erp/routes/conciliacion-routes.js:218` |
| POST | `/admin/conciliacion/:id/conciliar-pago` | `conciliacion.manage` | `modules/erp/routes/conciliacion-routes.js:212` |
| POST | `/admin/conciliacion/:id/deshacer` | `conciliacion.manage` | `modules/erp/routes/conciliacion-routes.js:234` |
| POST | `/admin/conciliacion/:id/ignorar` | `conciliacion.manage` | `modules/erp/routes/conciliacion-routes.js:228` |
| GET | `/admin/conciliacion/export.csv` | `conciliacion.read` | `modules/erp/routes/conciliacion-routes.js:244` |
| GET | `/admin/conciliacion/export.xlsx` | `conciliacion.read` | `modules/erp/routes/conciliacion-routes.js:240` |
| POST | `/admin/conciliacion/import` | `conciliacion.manage` | `modules/erp/routes/conciliacion-routes.js:185` |
| POST | `/admin/confirm-2fa` | solo sesión | `modules/erp/routes/auth.js:409` |
| GET | `/admin/contabilidad` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:208` |
| GET | `/admin/contabilidad/bienes` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:332` |
| POST | `/admin/contabilidad/bienes` | `invoices.create` | `modules/erp/routes/contabilidad-routes.js:402` |
| GET | `/admin/contabilidad/bienes.csv` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:411` |
| GET | `/admin/contabilidad/bienes.pdf` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:418` |
| GET | `/admin/contabilidad/bienes.xlsx` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:407` |
| POST | `/admin/contabilidad/bienes/:id` | `invoices.create` | `modules/erp/routes/contabilidad-routes.js:403` |
| POST | `/admin/contabilidad/bienes/:id/baja` | `invoices.create` | `modules/erp/routes/contabilidad-routes.js:404` |
| POST | `/admin/contabilidad/bienes/:id/reactivar` | `invoices.create` | `modules/erp/routes/contabilidad-routes.js:405` |
| GET | `/admin/contabilidad/compras` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:221` |
| GET | `/admin/contabilidad/compras.csv` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:255` |
| GET | `/admin/contabilidad/compras.pdf` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:262` |
| GET | `/admin/contabilidad/compras.xlsx` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:251` |
| GET | `/admin/contabilidad/diario` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:270` |
| GET | `/admin/contabilidad/diario.csv` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:300` |
| GET | `/admin/contabilidad/diario.pdf` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:307` |
| GET | `/admin/contabilidad/diario.xlsx` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:296` |
| GET | `/admin/contabilidad/mayor` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:282` |
| GET | `/admin/contabilidad/mayor.csv` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:317` |
| GET | `/admin/contabilidad/mayor.pdf` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:324` |
| GET | `/admin/contabilidad/mayor.xlsx` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:313` |
| GET | `/admin/contabilidad/modelos` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:466` |
| GET | `/admin/contabilidad/modelos.csv` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:501` |
| GET | `/admin/contabilidad/modelos.pdf` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:495` |
| GET | `/admin/contabilidad/pyg` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:427` |
| GET | `/admin/contabilidad/pyg.csv` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:443` |
| GET | `/admin/contabilidad/pyg.pdf` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:450` |
| GET | `/admin/contabilidad/pyg.xlsx` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:439` |
| GET | `/admin/contabilidad/ventas` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:210` |
| GET | `/admin/contabilidad/ventas.csv` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:238` |
| GET | `/admin/contabilidad/ventas.pdf` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:245` |
| GET | `/admin/contabilidad/ventas.xlsx` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:234` |
| GET | `/admin/crm` | `crm.read` | `modules/erp/routes/crm.js:639` |
| GET | `/admin/crm/cola` | `crm.read` | `modules/erp/routes/crm.js:820` |
| GET | `/admin/crm/tareas` | `crm.read` | `modules/erp/routes/crm.js:921` |
| GET | `/admin/descuentos` | `invoices.read` | `modules/erp/routes/descuentos.js:91` |
| GET | `/admin/disa` | solo sesión | `modules/disa/index.js:1717` |
| GET | `/admin/disa/agents` | solo sesión | `modules/disa/index.js:2232` |
| POST | `/admin/disa/alerts/open` | solo sesión | `modules/disa/index.js:3096` |
| POST | `/admin/disa/attach` | `purchases.create` | `modules/disa/index.js:3117` |
| GET | `/admin/disa/chips` | solo sesión | `modules/disa/index.js:2387` |
| POST | `/admin/disa/chips` | solo sesión | `modules/disa/index.js:2396` |
| POST | `/admin/disa/clear` | solo sesión | `modules/disa/index.js:3085` |
| POST | `/admin/disa/message` | por dentro: checkPermission | `modules/disa/index.js:2410` |
| POST | `/admin/disa/select-agent` | solo sesión | `modules/disa/index.js:2221` |
| POST | `/admin/disa/store-message` | solo sesión | `modules/disa/index.js:2318` |
| GET | `/admin/disa/summary` | por dentro: checkPermission | `modules/disa/index.js:1623` |
| GET | `/admin/disa/threads` | solo sesión | `modules/disa/index.js:2247` |
| POST | `/admin/disa/threads` | solo sesión | `modules/disa/index.js:2272` |
| DELETE | `/admin/disa/threads/:id` | solo sesión | `modules/disa/index.js:2287` |
| GET | `/admin/disa/threads/:id` | solo sesión | `modules/disa/index.js:2258` |
| POST | `/admin/disa/threads/:id/pin` | solo sesión | `modules/disa/index.js:2307` |
| POST | `/admin/disa/threads/:id/title` | solo sesión | `modules/disa/index.js:2296` |
| POST | `/admin/disable-2fa` | solo sesión | `modules/erp/routes/auth.js:410` |
| GET | `/admin/facturar-horas` | `invoices.create` | `modules/erp/routes/facturar-horas.js:191` |
| GET | `/admin/fichaje` | solo sesión | `modules/erp/routes/fichaje.js:87` |
| GET | `/admin/forgot-password` | solo sesión | `modules/erp/routes/auth.js:415` |
| POST | `/admin/forgot-password` | solo sesión | `modules/erp/routes/auth.js:460` |
| GET | `/admin/historial/:id{[0-9]+}` | `historial.read` | `modules/erp/routes/historial.js:43` |
| POST | `/admin/historial/:id{[0-9]+}/antecedentes` | `historial.read` | `modules/erp/routes/historial.js:169` |
| POST | `/admin/historial/:id{[0-9]+}/borrar` | `historial.read` | `modules/erp/routes/historial.js:210` |
| POST | `/admin/historial/:id{[0-9]+}/consentimiento` | `historial.read` | `modules/erp/routes/historial.js:159` |
| POST | `/admin/historial/:id{[0-9]+}/consentimiento/revocar` | `historial.read` | `modules/erp/routes/historial.js:164` |
| GET | `/admin/historial/:id{[0-9]+}/copia` | `historial.read` | `modules/erp/routes/historial.js:181` |
| POST | `/admin/historial/:id{[0-9]+}/nota` | `historial.read` | `modules/erp/routes/historial.js:174` |
| GET | `/admin/historial/accesos` | `historial.read` | `modules/erp/routes/historial.js:235` |
| GET | `/admin/inventory` | `inventory.read` | `modules/erp/routes/inventory.js:16` |
| GET | `/admin/invoices` | `invoices.read` | `modules/erp/routes/invoices.js:1213` |
| GET | `/admin/invoices/:id` | `invoices.read` | `modules/erp/routes/invoices.js:2034` |
| GET | `/admin/invoices/:id/facturae.xml` | `invoices.read` | `modules/erp/routes/invoices.js:2227` |
| GET | `/admin/invoices/:id/pdf` | `invoices.read` | `modules/erp/routes/invoices.js:2210` |
| GET | `/admin/invoices/:id/rectificativa/new` | `invoices.create` | `modules/erp/routes/invoices.js:1756` |
| GET | `/admin/invoices/new` | `invoices.create` | `modules/erp/routes/invoices.js:1372` |
| GET | `/admin/listados/:clave/imprimir` | solo sesión | `modules/erp/routes/listados.js:128` |
| GET | `/admin/listados/:clave/pdf` | solo sesión | `modules/erp/routes/listados.js:139` |
| GET | `/admin/login` | solo sesión | `modules/erp/routes/auth.js:201` |
| POST | `/admin/login` | solo sesión | `modules/erp/routes/auth.js:276` |
| GET | `/admin/logout` | solo sesión | `modules/erp/routes/auth.js:655` |
| GET | `/admin/migracion` | `company.read` | `modules/erp/routes/migracion.js:197` |
| GET | `/admin/migracion/importar` | `company.read` | `modules/erp/routes/importador.js:119` |
| GET | `/admin/mostrador` | `invoices.create` | `modules/erp/routes/mostrador.js:57` |
| GET | `/admin/mostrador/:id/pdf` | `invoices.read` | `modules/erp/routes/mostrador.js:303` |
| GET | `/admin/pagos` | `purchases.read` | `modules/erp/routes/pagos.js:25` |
| GET | `/admin/pedidos` | `pedidos.read` | `modules/erp/routes/pedidos.js:375` |
| GET | `/admin/pedidos/:id` | `pedidos.read` | `modules/erp/routes/pedidos.js:584` |
| GET | `/admin/pedidos/:id/edit` | `pedidos.edit` | `modules/erp/routes/pedidos.js:576` |
| GET | `/admin/pedidos/:id/pdf` | `pedidos.read` | `modules/erp/routes/pedidos.js:702` |
| GET | `/admin/pedidos/new` | `pedidos.create` | `modules/erp/routes/pedidos.js:575` |
| GET | `/admin/perfil` | solo sesión | `modules/erp/routes/perfil.js:140` |
| POST | `/admin/perfil/confirm-2fa` | solo sesión | `modules/erp/routes/perfil.js:460` |
| POST | `/admin/perfil/disable-2fa` | solo sesión | `modules/erp/routes/perfil.js:515` |
| POST | `/admin/perfil/password` | solo sesión | `modules/erp/routes/perfil.js:442` |
| POST | `/admin/perfil/regenerar-rescate` | solo sesión | `modules/erp/routes/perfil.js:490` |
| GET | `/admin/portal` | `invoices.read` | `modules/portal/admin.js:15` |
| POST | `/admin/portal/enviar/:id` | `invoices.read` | `modules/portal/admin.js:99` |
| POST | `/admin/portal/iban` | `invoices.read` | `modules/portal/admin.js:92` |
| GET | `/admin/portal/mensajes/:id` | `invoices.read` | `modules/portal/admin.js:54` |
| POST | `/admin/portal/mensajes/:id` | `invoices.read` | `modules/portal/admin.js:81` |
| GET | `/admin/products` | `products.read` | `modules/erp/routes/products.js:329` |
| GET | `/admin/propuestas` | solo sesión | `modules/erp/routes/propuestas.js:344` |
| GET | `/admin/proyectos` | `proyectos.read` | `modules/erp/routes/proyectos.js:140` |
| GET | `/admin/purchase-order-receipts/:id` | `purchases.read` | `modules/erp/routes/purchase-order-receipts.js:226` |
| GET | `/admin/purchase-orders` | `purchases.read` | `modules/erp/routes/purchase-orders.js:445` |
| GET | `/admin/purchase-orders/:id` | `purchases.read` | `modules/erp/routes/purchase-orders.js:948` |
| GET | `/admin/purchase-orders/:id{[0-9]+}/pdf` | `purchases.read` | `modules/erp/routes/purchase-orders.js:933` |
| GET | `/admin/purchase-orders/:id/edit` | `purchases.edit` | `modules/erp/routes/purchase-orders.js:745` |
| GET | `/admin/purchase-orders/:id/receipts/new` | `purchases.create` | `modules/erp/routes/purchase-orders.js:756` |
| GET | `/admin/purchase-orders/new` | `purchases.create` | `modules/erp/routes/purchase-orders.js:743` |
| GET | `/admin/purchases` | `purchases.read` | `modules/erp/routes/purchases.js:143` |
| GET | `/admin/purchases/:id` | `purchases.read` | `modules/erp/routes/purchases.js:399` |
| GET | `/admin/purchases/capture` | `purchases.create` | `modules/erp/routes/purchases-capture.js:467` |
| GET | `/admin/purchases/new` | `purchases.create` | `modules/erp/routes/purchases.js:183` |
| GET | `/admin/quotes` | `quotes.read` | `modules/erp/routes/quotes.js:484` |
| GET | `/admin/quotes/:id` | `quotes.read` | `modules/erp/routes/quotes.js:685` |
| GET | `/admin/quotes/:id/edit` | `quotes.edit` | `modules/erp/routes/quotes.js:677` |
| GET | `/admin/quotes/:id/pdf` | `quotes.read` | `modules/erp/routes/quotes.js:815` |
| GET | `/admin/quotes/new` | `quotes.create` | `modules/erp/routes/quotes.js:676` |
| GET | `/admin/recurrentes` | `recurrentes.read` | `modules/erp/routes/recurrentes-routes.js:25` |
| POST | `/admin/recurrentes` | `recurrentes.manage` | `modules/erp/routes/recurrentes-routes.js:102` |
| POST | `/admin/recurrentes/:id/activar` | `recurrentes.manage` | `modules/erp/routes/recurrentes-routes.js:113` |
| POST | `/admin/recurrentes/:id/pausar` | `recurrentes.manage` | `modules/erp/routes/recurrentes-routes.js:112` |
| POST | `/admin/recurrentes/borrador/:id/emitir` | `invoices.create` | `modules/erp/routes/recurrentes-routes.js:116` |
| POST | `/admin/recurrentes/borrador/:id/omitir` | `recurrentes.manage` | `modules/erp/routes/recurrentes-routes.js:121` |
| GET | `/admin/rentabilidad` | `invoices.read` + `proyectos.read` | `modules/erp/routes/rentabilidad.js:30` |
| GET | `/admin/reset-password` | solo sesión | `modules/erp/routes/auth.js:522` |
| POST | `/admin/reset-password` | solo sesión | `modules/erp/routes/auth.js:573` |
| GET | `/admin/security` | solo sesión | `modules/erp/routes/security.js:25` |
| GET | `/admin/settings` | solo sesión | `modules/erp/routes/settings.js:495` |
| GET | `/admin/settings/avisos` | solo sesión | `modules/erp/routes/settings.js:1019` |
| GET | `/admin/settings/plantillas` | `company.read` | `modules/erp/routes/settings.js:786` |
| GET | `/admin/settings/situacion-fiscal` | `company.read` | `modules/erp/routes/settings.js:1250` |
| GET | `/admin/setup-2fa` | solo sesión | `modules/erp/routes/auth.js:407` |
| POST | `/admin/setup-2fa` | solo sesión | `modules/erp/routes/auth.js:408` |
| GET | `/admin/stock-transfers` | `inventory.read` | `modules/erp/routes/stock-transfers.js:221` |
| GET | `/admin/stock-transfers/:id` | `inventory.read` | `modules/erp/routes/stock-transfers.js:481` |
| GET | `/admin/stock-transfers/new` | `inventory.edit` | `modules/erp/routes/stock-transfers.js:296` |
| GET | `/admin/supplier-invoices` | `purchases.read` | `modules/erp/routes/supplier-invoices.js:492` |
| GET | `/admin/supplier-invoices/:id` | `purchases.read` | `modules/erp/routes/supplier-invoices.js:876` |
| GET | `/admin/supplier-invoices/new` | `purchases.create` | `modules/erp/routes/supplier-invoices.js:620` |
| GET | `/admin/supplier-returns` | `purchases.read` | `modules/erp/routes/supplier-returns.js:276` |
| GET | `/admin/supplier-returns/:id` | `purchases.read` | `modules/erp/routes/supplier-returns.js:484` |
| GET | `/admin/supplier-returns/new` | `purchases.create` | `modules/erp/routes/supplier-returns.js:352` |
| GET | `/admin/suppliers` | `suppliers.read` | `modules/erp/routes/suppliers.js:157` |
| GET | `/admin/suscripcion` | por dentro: soloDueno | `modules/erp/routes/suscripcion.js:68` |
| GET | `/admin/suscripcion/cancelado` | por dentro: soloDueno | `modules/erp/routes/suscripcion.js:656` |
| GET | `/admin/suscripcion/descargar` | por dentro: soloDueno | `modules/erp/routes/suscripcion.js:631` |
| GET | `/admin/suscripcion/vuelta` | por dentro: soloDueno | `modules/erp/routes/suscripcion.js:547` |
| GET | `/admin/tags` | `tags.read` | `modules/erp/routes/products.js:888` |
| GET | `/admin/tiempo` | `tiempo.read` | `modules/erp/routes/tiempo.js:210` |
| GET | `/admin/users` | `admin.manage_users` | `modules/erp/routes/users.js:253` |
| POST | `/admin/verifactu/enviar/:id` | `invoices.create` | `modules/erp/routes/verifactu-envio-routes.js:85` |
| GET | `/admin/verifactu/envios` | `invoices.read` | `modules/erp/routes/verifactu-envio-routes.js:29` |
| POST | `/admin/verify-2fa` | solo sesión | `modules/erp/routes/auth.js:337` |
| GET | `/admin/vigia` | `analytics.read` | `modules/erp/routes/vigia.js:83` |
| GET | `/admin/warehouses` | `inventory.read` | `modules/erp/routes/warehouses.js:238` |
| GET | `/api/disa` | solo sesión | `modules/disa/index.js:1717` |
| GET | `/api/disa/agents` | solo sesión | `modules/disa/index.js:2232` |
| POST | `/api/disa/alerts/open` | solo sesión | `modules/disa/index.js:3096` |
| POST | `/api/disa/attach` | `purchases.create` | `modules/disa/index.js:3117` |
| GET | `/api/disa/chips` | solo sesión | `modules/disa/index.js:2387` |
| POST | `/api/disa/chips` | solo sesión | `modules/disa/index.js:2396` |
| POST | `/api/disa/clear` | solo sesión | `modules/disa/index.js:3085` |
| POST | `/api/disa/message` | por dentro: checkPermission | `modules/disa/index.js:2410` |
| POST | `/api/disa/select-agent` | solo sesión | `modules/disa/index.js:2221` |
| POST | `/api/disa/store-message` | solo sesión | `modules/disa/index.js:2318` |
| GET | `/api/disa/summary` | por dentro: checkPermission | `modules/disa/index.js:1623` |
| GET | `/api/disa/threads` | solo sesión | `modules/disa/index.js:2247` |
| POST | `/api/disa/threads` | solo sesión | `modules/disa/index.js:2272` |
| DELETE | `/api/disa/threads/:id` | solo sesión | `modules/disa/index.js:2287` |
| GET | `/api/disa/threads/:id` | solo sesión | `modules/disa/index.js:2258` |
| POST | `/api/disa/threads/:id/pin` | solo sesión | `modules/disa/index.js:2307` |
| POST | `/api/disa/threads/:id/title` | solo sesión | `modules/disa/index.js:2296` |
| POST | `/api/erp/albaranes` | `albaranes.create` | `modules/erp/routes/albaranes.js:326` |
| GET | `/api/erp/albaranes/:id` | `albaranes.read` | `modules/erp/routes/albaranes.js:318` |
| POST | `/api/erp/albaranes/:id/anular` | `albaranes.edit` | `modules/erp/routes/albaranes.js:334` |
| POST | `/api/erp/albaranes/:id/factura` | `albaranes.edit` | `modules/erp/routes/albaranes.js:342` |
| GET | `/api/erp/analytics/best-sellers` | `analytics.read` | `modules/erp/routes/analytics.js:47` |
| GET | `/api/erp/analytics/constructor/areas` | `analytics.read` | `modules/erp/routes/analytics.js:176` |
| GET | `/api/erp/analytics/constructor/campos` | `analytics.read` | `modules/erp/routes/analytics.js:201` |
| GET | `/api/erp/analytics/constructor/comparables` | `analytics.read` | `modules/erp/routes/analytics.js:220` |
| POST | `/api/erp/analytics/constructor/comparar` | `analytics.read` | `modules/erp/routes/analytics.js:224` |
| POST | `/api/erp/analytics/constructor/cruzar` | `analytics.read` | `modules/erp/routes/analytics.js:209` |
| GET | `/api/erp/analytics/constructor/medidas` | `analytics.read` | `modules/erp/routes/analytics.js:183` |
| POST | `/api/erp/analytics/constructor/medidas` | `analytics.read` | `modules/erp/routes/analytics.js:187` |
| DELETE | `/api/erp/analytics/constructor/medidas/:id` | `analytics.read` | `modules/erp/routes/analytics.js:195` |
| GET | `/api/erp/analytics/constructor/paneles` | `analytics.read` | `modules/erp/routes/analytics.js:234` |
| POST | `/api/erp/analytics/constructor/paneles` | `analytics.read` | `modules/erp/routes/analytics.js:243` |
| DELETE | `/api/erp/analytics/constructor/paneles/:id` | `analytics.read` | `modules/erp/routes/analytics.js:256` |
| GET | `/api/erp/analytics/export/clients` | `analytics.read` | `modules/erp/routes/analytics.js:356` |
| GET | `/api/erp/analytics/export/informes` | `analytics.read` | `modules/erp/routes/analytics.js:304` |
| GET | `/api/erp/analytics/export/margen` | `analytics.read` | `modules/erp/routes/analytics.js:285` |
| GET | `/api/erp/analytics/export/products` | `analytics.read` | `modules/erp/routes/analytics.js:346` |
| GET | `/api/erp/analytics/export/sales` | `analytics.read` | `modules/erp/routes/analytics.js:270` |
| GET | `/api/erp/analytics/informes` | `analytics.read` | `modules/erp/routes/analytics.js:93` |
| GET | `/api/erp/analytics/margen` | `analytics.read` | `modules/erp/routes/analytics.js:58` |
| GET | `/api/erp/analytics/overview` | `analytics.read` | `modules/erp/routes/analytics.js:25` |
| GET | `/api/erp/analytics/plan` | `analytics.read` | `modules/erp/routes/analytics.js:145` |
| POST | `/api/erp/analytics/plan` | `analytics.read` | `modules/erp/routes/analytics.js:153` |
| GET | `/api/erp/analytics/responsable` | `analytics.read` | `modules/erp/routes/analytics.js:74` |
| GET | `/api/erp/analytics/sales-by-period` | `analytics.read` | `modules/erp/routes/analytics.js:40` |
| GET | `/api/erp/analytics/stock-report` | `analytics.read` | `modules/erp/routes/analytics.js:263` |
| GET | `/api/erp/avisos` | solo sesión | `modules/erp/routes/avisos.js:107` |
| GET | `/api/erp/avisos/contador` | solo sesión | `modules/erp/routes/avisos.js:120` |
| POST | `/api/erp/avisos/no-visto` | solo sesión | `modules/erp/routes/avisos.js:141` |
| POST | `/api/erp/avisos/visto` | solo sesión | `modules/erp/routes/avisos.js:131` |
| GET | `/api/erp/categories` | `categories.read` | `modules/erp/routes/categories.js:12` |
| POST | `/api/erp/categories` | `categories.create` | `modules/erp/routes/categories.js:17` |
| DELETE | `/api/erp/categories/:id` | `categories.delete` | `modules/erp/routes/categories.js:34` |
| PUT | `/api/erp/categories/:id` | `categories.edit` | `modules/erp/routes/categories.js:26` |
| GET | `/api/erp/citas` | `citas.read` | `modules/erp/routes/citas.js:708` |
| POST | `/api/erp/citas` | `citas.edit` | `modules/erp/routes/citas.js:733` |
| DELETE | `/api/erp/citas/:id{[0-9]+}` | `citas.edit` | `modules/erp/routes/citas.js:787` |
| GET | `/api/erp/citas/:id{[0-9]+}` | `citas.read` | `modules/erp/routes/citas.js:685` |
| PUT | `/api/erp/citas/:id{[0-9]+}` | `citas.edit` | `modules/erp/routes/citas.js:746` |
| POST | `/api/erp/citas/:id/atender` | `citas.edit` | `modules/erp/routes/citas.js:779` |
| POST | `/api/erp/citas/:id/aviso` | `citas.edit` | `modules/erp/routes/citas.js:820` |
| GET | `/api/erp/citas/:id/aviso-links` | `citas.read` | `modules/erp/routes/citas.js:799` |
| POST | `/api/erp/citas/:id/estado` | `citas.edit` | `modules/erp/routes/citas.js:762` |
| POST | `/api/erp/citas/:id/mover` | `citas.edit` | `modules/erp/routes/citas.js:754` |
| GET | `/api/erp/citas/agenda` | `citas.read` | `modules/erp/routes/citas.js:523` |
| POST | `/api/erp/citas/ajustes` | `citas.edit` | `modules/erp/routes/citas.js:1015` |
| POST | `/api/erp/citas/bloqueo` | `citas.edit` | `modules/erp/routes/citas.js:999` |
| DELETE | `/api/erp/citas/bloqueo/:id` | `citas.edit` | `modules/erp/routes/citas.js:1009` |
| GET | `/api/erp/citas/cola/data` | `citas.read` | `modules/erp/routes/citas.js:851` |
| POST | `/api/erp/citas/excepcion` | `citas.edit` | `modules/erp/routes/citas.js:981` |
| DELETE | `/api/erp/citas/excepcion/:id` | `citas.edit` | `modules/erp/routes/citas.js:993` |
| GET | `/api/erp/citas/horario` | `citas.read` | `modules/erp/routes/citas.js:950` |
| POST | `/api/erp/citas/horario` | `citas.edit` | `modules/erp/routes/citas.js:963` |
| GET | `/api/erp/citas/huecos` | `citas.read` | `modules/erp/routes/citas.js:503` |
| GET | `/api/erp/citas/mes` | `citas.read` | `modules/erp/routes/citas.js:574` |
| GET | `/api/erp/citas/meta` | `citas.read` | `modules/erp/routes/citas.js:487` |
| POST | `/api/erp/citas/recursos` | `citas.edit` | `modules/erp/routes/citas.js:866` |
| DELETE | `/api/erp/citas/recursos/:id` | `citas.edit` | `modules/erp/routes/citas.js:881` |
| PUT | `/api/erp/citas/recursos/:id` | `citas.edit` | `modules/erp/routes/citas.js:874` |
| GET | `/api/erp/citas/recursos/list` | `citas.read` | `modules/erp/routes/citas.js:862` |
| POST | `/api/erp/citas/serie` | `citas.edit` | `modules/erp/routes/citas.js:723` |
| POST | `/api/erp/citas/servicios` | `citas.edit` | `modules/erp/routes/citas.js:905` |
| PUT | `/api/erp/citas/servicios/:id` | `citas.edit` | `modules/erp/routes/citas.js:924` |
| GET | `/api/erp/citas/servicios/list` | `citas.read` | `modules/erp/routes/citas.js:887` |
| GET | `/api/erp/citas/sugerir` | `citas.read` | `modules/erp/routes/citas.js:665` |
| GET | `/api/erp/clients` | `clients.read` | `modules/erp/routes/clients.js:155` |
| POST | `/api/erp/clients` | `clients.create` | `modules/erp/routes/clients.js:392` |
| DELETE | `/api/erp/clients/:id` | `clients.edit` | `modules/erp/routes/clients.js:408` |
| GET | `/api/erp/clients/:id` | `clients.read` | `modules/erp/routes/clients.js:379` |
| PUT | `/api/erp/clients/:id` | `clients.edit` | `modules/erp/routes/clients.js:400` |
| GET | `/api/erp/clients/:id{[0-9]+}/contactos` | `clients.read` | `modules/erp/routes/clients.js:293` |
| POST | `/api/erp/clients/:id{[0-9]+}/contactos` | `clients.edit` | `modules/erp/routes/clients.js:309` |
| GET | `/api/erp/clients/:id/360` | `clients.read` | `modules/erp/routes/clients.js:178` |
| GET | `/api/erp/clients/:id/360/tarjeta/:clave` | `clients.read` | `modules/erp/routes/clients.js:223` |
| GET | `/api/erp/clients/:id/360/timeline` | `clients.read` | `modules/erp/routes/clients.js:238` |
| POST | `/api/erp/clients/:id/account-actions` | `cobros.manage` | `modules/erp/routes/clients.js:471` |
| GET | `/api/erp/clients/:id/account-email-preview` | `clients.read` | `modules/erp/routes/clients.js:455` |
| GET | `/api/erp/clients/:id/account-summary` | `clients.read` | `modules/erp/routes/clients.js:447` |
| GET | `/api/erp/clients/:id/invoices` | `clients.read` | `modules/erp/routes/clients.js:425` |
| GET | `/api/erp/clients/:id/notas` | `clients.read` | `modules/erp/routes/clients.js:330` |
| POST | `/api/erp/clients/:id/notas` | `clients.edit` | `modules/erp/routes/clients.js:337` |
| DELETE | `/api/erp/clients/:id/notas/:nid` | `clients.edit` | `modules/erp/routes/clients.js:365` |
| PUT | `/api/erp/clients/:id/notas/:nid` | `clients.edit` | `modules/erp/routes/clients.js:350` |
| GET | `/api/erp/clients/:id/orders` | `clients.read` | `modules/erp/routes/clients.js:416` |
| POST | `/api/erp/clients/:id/restore` | `clients.edit` | `modules/erp/routes/clients.js:487` |
| PUT | `/api/erp/clients/chips-ficha` | `clients.edit` | `modules/erp/routes/clients.js:281` |
| DELETE | `/api/erp/clients/groups/:id` | `clients.edit` | `modules/erp/routes/clients.js:517` |
| PUT | `/api/erp/clients/groups/:id` | `clients.edit` | `modules/erp/routes/clients.js:509` |
| GET | `/api/erp/clients/groups/all` | `clients.read` | `modules/erp/routes/clients.js:496` |
| POST | `/api/erp/clients/groups/create` | `clients.create` | `modules/erp/routes/clients.js:501` |
| PUT | `/api/erp/clients/periodo-ficha` | `clients.read` | `modules/erp/routes/clients.js:269` |
| GET | `/api/erp/clients/search` | `clients.read` | `modules/erp/routes/clients.js:162` |
| GET | `/api/erp/cobros` | `cobros.read` | `modules/erp/routes/cobros.js:19` |
| GET | `/api/erp/contabilidad/libros` | `invoices.read` | `modules/erp/routes/contabilidad-routes.js:203` |
| GET | `/api/erp/crm` | `crm.read` | `modules/erp/routes/crm.js:48` |
| POST | `/api/erp/crm` | `crm.manage` | `modules/erp/routes/crm.js:150` |
| DELETE | `/api/erp/crm/:id` | `crm.manage` | `modules/erp/routes/crm.js:197` |
| GET | `/api/erp/crm/:id` | `crm.read` | `modules/erp/routes/crm.js:123` |
| PUT | `/api/erp/crm/:id` | `crm.manage` | `modules/erp/routes/crm.js:158` |
| POST | `/api/erp/crm/:id/close` | `crm.manage` | `modules/erp/routes/crm.js:178` |
| GET | `/api/erp/crm/:id/email-preview` | `crm.read` | `modules/erp/routes/crm.js:137` |
| POST | `/api/erp/crm/:id/reopen` | `crm.manage` | `modules/erp/routes/crm.js:188` |
| POST | `/api/erp/crm/:id/restore` | `crm.manage` | `modules/erp/routes/crm.js:204` |
| POST | `/api/erp/crm/:id/stage` | `crm.manage` | `modules/erp/routes/crm.js:168` |
| POST | `/api/erp/crm/clients/:cid/activities` | `crm.manage` | `modules/erp/routes/crm.js:214` |
| GET | `/api/erp/crm/clients/:cid/summary` | `crm.read` | `modules/erp/routes/crm.js:78` |
| GET | `/api/erp/crm/clients/:cid/timeline` | `crm.read` | `modules/erp/routes/crm.js:64` |
| GET | `/api/erp/crm/tareas` | `crm.read` | `modules/erp/routes/crm.js:85` |
| POST | `/api/erp/crm/tareas` | `crm.manage` | `modules/erp/routes/crm.js:94` |
| DELETE | `/api/erp/crm/tareas/:id` | `crm.manage` | `modules/erp/routes/crm.js:115` |
| POST | `/api/erp/crm/tareas/:id/hecha` | `crm.manage` | `modules/erp/routes/crm.js:102` |
| POST | `/api/erp/crm/tareas/:id/reprogramar` | `crm.manage` | `modules/erp/routes/crm.js:110` |
| GET | `/api/erp/crm/worklist` | `crm.read` | `modules/erp/routes/crm.js:54` |
| POST | `/api/erp/descuentos/bonos` | `invoices.edit` | `modules/erp/routes/descuentos.js:67` |
| GET | `/api/erp/descuentos/bonos/:clientId` | `invoices.read` | `modules/erp/routes/descuentos.js:65` |
| POST | `/api/erp/descuentos/bonos/:id/consumir` | `invoices.edit` | `modules/erp/routes/descuentos.js:75` |
| GET | `/api/erp/descuentos/bonos/:id/consumos` | `invoices.read` | `modules/erp/routes/descuentos.js:87` |
| DELETE | `/api/erp/descuentos/consumos/:id` | `invoices.edit` | `modules/erp/routes/descuentos.js:83` |
| GET | `/api/erp/descuentos/promociones` | `invoices.read` | `modules/erp/routes/descuentos.js:48` |
| POST | `/api/erp/descuentos/promociones` | `invoices.edit` | `modules/erp/routes/descuentos.js:49` |
| DELETE | `/api/erp/descuentos/promociones/:id` | `invoices.edit` | `modules/erp/routes/descuentos.js:57` |
| POST | `/api/erp/descuentos/proponer` | `invoices.read` | `modules/erp/routes/descuentos.js:35` |
| POST | `/api/erp/facturar-horas` | `invoices.create` | `modules/erp/routes/facturar-horas.js:182` |
| GET | `/api/erp/facturar-horas/preview` | `invoices.create` | `modules/erp/routes/facturar-horas.js:175` |
| POST | `/api/erp/fichaje` | solo sesión | `modules/erp/routes/fichaje.js:40` |
| POST | `/api/erp/fichaje/corregir` | `tiempo.edit` | `modules/erp/routes/fichaje.js:54` |
| GET | `/api/erp/fichaje/de/:userId` | `tiempo.read` | `modules/erp/routes/fichaje.js:75` |
| GET | `/api/erp/fichaje/dentro` | `tiempo.read` | `modules/erp/routes/fichaje.js:79` |
| GET | `/api/erp/fichaje/estado` | solo sesión | `modules/erp/routes/fichaje.js:64` |
| GET | `/api/erp/fichaje/historial/:userId/:fecha` | solo sesión | `modules/erp/routes/fichaje.js:80` |
| GET | `/api/erp/fichaje/mio` | solo sesión | `modules/erp/routes/fichaje.js:69` |
| POST | `/api/erp/importar/:id/deshacer` | solo sesión | `modules/erp/routes/importador.js:100` |
| POST | `/api/erp/importar/analizar` | solo sesión | `modules/erp/routes/importador.js:68` |
| GET | `/api/erp/importar/historial` | `company.read` | `modules/erp/routes/importador.js:113` |
| POST | `/api/erp/importar/importar` | solo sesión | `modules/erp/routes/importador.js:81` |
| GET | `/api/erp/inicio/arranque` | solo sesión | `modules/erp/routes/inicio.js:132` |
| PUT | `/api/erp/inicio/arranque/plegado` | solo sesión | `modules/erp/routes/inicio.js:144` |
| GET | `/api/erp/inicio/bloques` | solo sesión | `modules/erp/routes/inicio.js:56` |
| GET | `/api/erp/inicio/cuadro` | solo sesión | `modules/erp/routes/inicio.js:74` |
| GET | `/api/erp/inicio/cuadro/:seccion` | solo sesión | `modules/erp/routes/inicio.js:115` |
| DELETE | `/api/erp/inicio/cuadro/orden` | solo sesión | `modules/erp/routes/inicio.js:103` |
| GET | `/api/erp/inicio/cuadro/orden` | solo sesión | `modules/erp/routes/inicio.js:88` |
| PUT | `/api/erp/inicio/cuadro/orden` | solo sesión | `modules/erp/routes/inicio.js:94` |
| GET | `/api/erp/inicio/datos` | solo sesión | `modules/erp/routes/inicio.js:62` |
| DELETE | `/api/erp/inicio/empresa` | solo sesión | `modules/erp/routes/inicio.js:183` |
| PUT | `/api/erp/inicio/empresa` | solo sesión | `modules/erp/routes/inicio.js:165` |
| DELETE | `/api/erp/inicio/layout` | solo sesión | `modules/erp/routes/inicio.js:177` |
| GET | `/api/erp/inicio/layout` | solo sesión | `modules/erp/routes/inicio.js:36` |
| PUT | `/api/erp/inicio/layout` | solo sesión | `modules/erp/routes/inicio.js:154` |
| GET | `/api/erp/invoices` | `invoices.read` | `modules/erp/routes/invoices.js:974` |
| POST | `/api/erp/invoices` | `invoices.create` | `modules/erp/routes/invoices.js:1064` |
| GET | `/api/erp/invoices/:id` | `invoices.read` | `modules/erp/routes/invoices.js:1005` |
| POST | `/api/erp/invoices/:id/anular` | `invoices.create` | `modules/erp/routes/invoices.js:1090` |
| POST | `/api/erp/invoices/:id/collection-actions` | `cobros.manage` | `modules/erp/routes/invoices.js:1198` |
| GET | `/api/erp/invoices/:id/collection-email-preview` | `cobros.read` | `modules/erp/routes/invoices.js:1179` |
| POST | `/api/erp/invoices/:id/payments` | `cobros.manage` | `modules/erp/routes/invoices.js:1143` |
| DELETE | `/api/erp/invoices/:id/payments/:pid` | `cobros.manage` | `modules/erp/routes/invoices.js:1164` |
| POST | `/api/erp/invoices/:id/proyecto` | `invoices.create` | `modules/erp/routes/invoices.js:1105` |
| POST | `/api/erp/invoices/:id/rectificativa` | `invoices.create` | `modules/erp/routes/invoices.js:1120` |
| POST | `/api/erp/invoices/:id/sustitutiva` | `invoices.create` | `modules/erp/routes/invoices.js:1134` |
| POST | `/api/erp/invoices/compute-totals` | `invoices.create` | `modules/erp/routes/invoices.js:1051` |
| POST | `/api/erp/invoices/from-order/:orderId` | `invoices.create` | `modules/erp/routes/invoices.js:1036` |
| POST | `/api/erp/listados/:clave/enviar` | solo sesión | `modules/erp/routes/listados.js:169` |
| GET | `/api/erp/mapa/sugerencias` | `clients.read` | `modules/erp/routes/mapa.js:56` |
| GET | `/api/erp/mapa/tesela/:z/:x/:y` | `clients.read` | `modules/erp/routes/mapa.js:28` |
| GET | `/api/erp/menu/anclas` | solo sesión | `modules/erp/routes/menu-routes.js:59` |
| PUT | `/api/erp/menu/anclas` | solo sesión | `modules/erp/routes/menu-routes.js:65` |
| DELETE | `/api/erp/menu/orden` | solo sesión | `modules/erp/routes/menu-routes.js:134` |
| PUT | `/api/erp/menu/orden` | solo sesión | `modules/erp/routes/menu-routes.js:96` |
| GET | `/api/erp/migracion` | `company.read` | `modules/erp/routes/migracion.js:188` |
| POST | `/api/erp/migracion` | `company.update` | `modules/erp/routes/migracion.js:73` |
| POST | `/api/erp/mostrador/sale` | `invoices.create` | `modules/erp/routes/mostrador.js:30` |
| GET | `/api/erp/pagos` | `purchases.read` | `modules/erp/routes/pagos.js:18` |
| POST | `/api/erp/pedidos` | `pedidos.create` | `modules/erp/routes/pedidos.js:322` |
| GET | `/api/erp/pedidos/:id` | `pedidos.read` | `modules/erp/routes/pedidos.js:304` |
| PUT | `/api/erp/pedidos/:id` | `pedidos.edit` | `modules/erp/routes/pedidos.js:330` |
| POST | `/api/erp/pedidos/:id/anular` | `pedidos.edit` | `modules/erp/routes/pedidos.js:346` |
| POST | `/api/erp/pedidos/:id/anular-y-rehacer` | `pedidos.create` | `modules/erp/routes/pedidos.js:363` |
| POST | `/api/erp/pedidos/:id/confirmar` | `pedidos.edit` | `modules/erp/routes/pedidos.js:338` |
| POST | `/api/erp/pedidos/:id/factura` | `pedidos.edit` | `modules/erp/routes/pedidos.js:355` |
| POST | `/api/erp/pedidos/compute-totals` | `pedidos.read` | `modules/erp/routes/pedidos.js:313` |
| PUT | `/api/erp/perfil` | solo sesión | `modules/erp/routes/perfil.js:526` |
| DELETE | `/api/erp/perfil/foto` | solo sesión | `modules/erp/routes/perfil.js:587` |
| POST | `/api/erp/perfil/foto` | solo sesión | `modules/erp/routes/perfil.js:559` |
| GET | `/api/erp/perfil/foto/:id` | solo sesión | `modules/erp/routes/perfil.js:597` |
| GET | `/api/erp/products` | `products.read` | `modules/erp/routes/products.js:100` |
| POST | `/api/erp/products` | `products.create` | `modules/erp/routes/products.js:132` |
| DELETE | `/api/erp/products/:id` | `products.delete` | `modules/erp/routes/products.js:253` |
| GET | `/api/erp/products/:id` | `products.read` | `modules/erp/routes/products.js:121` |
| PUT | `/api/erp/products/:id` | `products.edit` | `modules/erp/routes/products.js:178` |
| GET | `/api/erp/products/:id/images` | `products.read` | `modules/erp/routes/products.js:263` |
| POST | `/api/erp/products/:id/images` | `products.edit` | `modules/erp/routes/products.js:268` |
| DELETE | `/api/erp/products/:id/images/:imgId` | `products.edit` | `modules/erp/routes/products.js:276` |
| GET | `/api/erp/products/:id/lotes` | `products.read` | `modules/erp/routes/products.js:244` |
| GET | `/api/erp/products/:id/niveles` | `products.read` | `modules/erp/routes/products.js:219` |
| PUT | `/api/erp/products/:id/niveles` | `products.edit` | `modules/erp/routes/products.js:228` |
| GET | `/api/erp/products/:id/stock` | `products.read` | `modules/erp/routes/products.js:143` |
| POST | `/api/erp/products/:id/stock/adjust` | `inventory.edit` | `modules/erp/routes/products.js:166` |
| GET | `/api/erp/products/:id/variants` | `products.read` | `modules/erp/routes/products.js:282` |
| POST | `/api/erp/products/:id/variants` | `products.edit` | `modules/erp/routes/products.js:287` |
| DELETE | `/api/erp/products/:id/variants/:vid` | `products.edit` | `modules/erp/routes/products.js:303` |
| PUT | `/api/erp/products/:id/variants/:vid` | `products.edit` | `modules/erp/routes/products.js:295` |
| GET | `/api/erp/products/search` | `products.read` | `modules/erp/routes/products.js:115` |
| DELETE | `/api/erp/products/tags/:id` | `tags.delete` | `modules/erp/routes/products.js:323` |
| GET | `/api/erp/products/tags/all` | `tags.read` | `modules/erp/routes/products.js:309` |
| POST | `/api/erp/products/tags/create` | `tags.create` | `modules/erp/routes/products.js:314` |
| GET | `/api/erp/propuestas` | solo sesión | `modules/erp/routes/propuestas.js:98` |
| POST | `/api/erp/propuestas/:id/aprobar` | solo sesión | `modules/erp/routes/propuestas.js:117` |
| POST | `/api/erp/propuestas/:id/descartar` | solo sesión | `modules/erp/routes/propuestas.js:311` |
| POST | `/api/erp/propuestas/:id/emitir` | solo sesión | `modules/erp/routes/propuestas.js:181` |
| POST | `/api/erp/propuestas/:id/enviar` | solo sesión | `modules/erp/routes/propuestas.js:228` |
| POST | `/api/erp/propuestas/:id/preparar` | solo sesión | `modules/erp/routes/propuestas.js:267` |
| POST | `/api/erp/propuestas/:id/preparar-compra` | solo sesión | `modules/erp/routes/propuestas.js:294` |
| POST | `/api/erp/propuestas/:id/redactar` | solo sesión | `modules/erp/routes/propuestas.js:210` |
| POST | `/api/erp/propuestas/:id/registrado` | solo sesión | `modules/erp/routes/propuestas.js:153` |
| GET | `/api/erp/propuestas/contador` | solo sesión | `modules/erp/routes/propuestas.js:106` |
| POST | `/api/erp/propuestas/generar` | solo sesión | `modules/erp/routes/propuestas.js:328` |
| GET | `/api/erp/proyectos` | `proyectos.read` | `modules/erp/routes/proyectos.js:88` |
| POST | `/api/erp/proyectos` | `proyectos.edit` | `modules/erp/routes/proyectos.js:107` |
| DELETE | `/api/erp/proyectos/:id` | `proyectos.edit` | `modules/erp/routes/proyectos.js:123` |
| GET | `/api/erp/proyectos/:id` | `proyectos.read` | `modules/erp/routes/proyectos.js:98` |
| PUT | `/api/erp/proyectos/:id` | `proyectos.edit` | `modules/erp/routes/proyectos.js:115` |
| POST | `/api/erp/proyectos/:id/restore` | `proyectos.edit` | `modules/erp/routes/proyectos.js:131` |
| GET | `/api/erp/purchase-order-receipts/:id` | `purchases.read` | `modules/erp/routes/purchase-order-receipts.js:207` |
| POST | `/api/erp/purchase-order-receipts/:id/cancel` | `purchases.edit` | `modules/erp/routes/purchase-order-receipts.js:215` |
| POST | `/api/erp/purchase-orders` | `purchases.create` | `modules/erp/routes/purchase-orders.js:362` |
| GET | `/api/erp/purchase-orders/:id` | `purchases.read` | `modules/erp/routes/purchase-orders.js:352` |
| PUT | `/api/erp/purchase-orders/:id` | `purchases.edit` | `modules/erp/routes/purchase-orders.js:370` |
| POST | `/api/erp/purchase-orders/:id/anular` | `purchases.edit` | `modules/erp/routes/purchase-orders.js:423` |
| POST | `/api/erp/purchase-orders/:id/anular-y-rehacer` | `purchases.create` | `modules/erp/routes/purchase-orders.js:432` |
| POST | `/api/erp/purchase-orders/:id/close` | `purchases.edit` | `modules/erp/routes/purchase-orders.js:414` |
| POST | `/api/erp/purchase-orders/:id/email` | `purchases.edit` | `modules/erp/routes/purchase-orders.js:386` |
| POST | `/api/erp/purchase-orders/:id/enviar` | `purchases.edit` | `modules/erp/routes/purchase-orders.js:378` |
| GET | `/api/erp/purchase-orders/:id/receipts` | `purchases.read` | `modules/erp/routes/purchase-orders.js:405` |
| POST | `/api/erp/purchase-orders/:id/receipts` | `purchases.create` | `modules/erp/routes/purchase-orders.js:396` |
| GET | `/api/erp/purchases` | `purchases.read` | `modules/erp/routes/purchases.js:105` |
| POST | `/api/erp/purchases` | `purchases.create` | `modules/erp/routes/purchases.js:122` |
| GET | `/api/erp/purchases/:id` | `purchases.read` | `modules/erp/routes/purchases.js:112` |
| POST | `/api/erp/purchases/:id/cancel` | `purchases.create` | `modules/erp/routes/purchases.js:136` |
| POST | `/api/erp/purchases/:id/receive` | `purchases.create` | `modules/erp/routes/purchases.js:129` |
| POST | `/api/erp/purchases/capture` | `purchases.create` | `modules/erp/routes/purchases-capture.js:400` |
| POST | `/api/erp/purchases/capture/confirm` | `purchases.create` | `modules/erp/routes/purchases-capture.js:458` |
| GET | `/api/erp/purchases/capture/file/:id` | `purchases.read` | `modules/erp/routes/purchases-capture.js:439` |
| GET | `/api/erp/purchases/capture/supplier-orders` | `purchases.read` | `modules/erp/routes/purchases-capture.js:430` |
| POST | `/api/erp/quotes` | `quotes.create` | `modules/erp/routes/quotes.js:397` |
| GET | `/api/erp/quotes/:id` | `quotes.read` | `modules/erp/routes/quotes.js:379` |
| PUT | `/api/erp/quotes/:id` | `quotes.edit` | `modules/erp/routes/quotes.js:405` |
| POST | `/api/erp/quotes/:id/anular` | `quotes.edit` | `modules/erp/routes/quotes.js:437` |
| POST | `/api/erp/quotes/:id/anular-y-rehacer` | `quotes.create` | `modules/erp/routes/quotes.js:445` |
| POST | `/api/erp/quotes/:id/convert` | `quotes.edit` | `modules/erp/routes/quotes.js:455` |
| POST | `/api/erp/quotes/:id/email` | `quotes.edit` | `modules/erp/routes/quotes.js:421` |
| POST | `/api/erp/quotes/:id/emitir` | `quotes.edit` | `modules/erp/routes/quotes.js:413` |
| POST | `/api/erp/quotes/:id/follow` | `quotes.edit` | `modules/erp/routes/quotes.js:429` |
| POST | `/api/erp/quotes/compute-totals` | `quotes.read` | `modules/erp/routes/quotes.js:388` |
| GET | `/api/erp/rentabilidad/comparativa` | `invoices.read` + `proyectos.read` | `modules/erp/routes/rentabilidad.js:24` |
| GET | `/api/erp/rentabilidad/proyecto/:id` | `invoices.read` + `proyectos.read` | `modules/erp/routes/rentabilidad.js:20` |
| GET | `/api/erp/reserva-publica/ajustes` | `citas.read` | `modules/erp/routes/reserva-publica.js:233` |
| POST | `/api/erp/reserva-publica/ajustes` | `citas.edit` | `modules/erp/routes/reserva-publica.js:255` |
| POST | `/api/erp/reserva-publica/aviso-encendido/apagar` | `citas.edit` | `modules/erp/routes/reserva-publica.js:294` |
| POST | `/api/erp/reserva-publica/aviso-encendido/vale` | `citas.edit` | `modules/erp/routes/reserva-publica.js:301` |
| POST | `/api/erp/reserva-publica/caducar` | `citas.edit` | `modules/erp/routes/reserva-publica.js:359` |
| POST | `/api/erp/reserva-publica/servicio/:id` | `citas.edit` | `modules/erp/routes/reserva-publica.js:308` |
| GET | `/api/erp/reserva-publica/solicitudes` | `citas.read` | `modules/erp/routes/reserva-publica.js:323` |
| POST | `/api/erp/reserva-publica/solicitudes/:id/aprobar` | `citas.edit` | `modules/erp/routes/reserva-publica.js:344` |
| POST | `/api/erp/reserva-publica/solicitudes/:id/rechazar` | `citas.edit` | `modules/erp/routes/reserva-publica.js:351` |
| GET | `/api/erp/settings/avisos/correos` | `company.read` | `modules/erp/routes/settings.js:370` |
| PUT | `/api/erp/settings/avisos/correos/:tipo` | `company.update` | `modules/erp/routes/settings.js:386` |
| POST | `/api/erp/settings/avisos/correos/:tipo/prueba` | `company.read` | `modules/erp/routes/settings.js:398` |
| GET | `/api/erp/settings/avisos/mi-parte` | solo sesión | `modules/erp/routes/settings.js:358` |
| GET | `/api/erp/settings/avisos/mias` | solo sesión | `modules/erp/routes/settings.js:327` |
| PUT | `/api/erp/settings/avisos/mias` | solo sesión | `modules/erp/routes/settings.js:346` |
| GET | `/api/erp/settings/company` | `company.read` | `modules/erp/routes/settings.js:40` |
| PUT | `/api/erp/settings/company` | `company.update` | `modules/erp/routes/settings.js:168` |
| GET | `/api/erp/settings/email-templates` | `company.read` | `modules/erp/routes/settings.js:255` |
| DELETE | `/api/erp/settings/email-templates/:tipo/:tono` | `company.update` | `modules/erp/routes/settings.js:449` |
| GET | `/api/erp/settings/email-templates/:tipo/:tono` | `company.read` | `modules/erp/routes/settings.js:274` |
| PUT | `/api/erp/settings/email-templates/:tipo/:tono` | `company.update` | `modules/erp/routes/settings.js:426` |
| POST | `/api/erp/settings/email-templates/:tipo/:tono/preview` | `company.read` | `modules/erp/routes/settings.js:293` |
| GET | `/api/erp/settings/fiscal-profile` | `company.read` | `modules/erp/routes/settings.js:198` |
| PUT | `/api/erp/settings/fiscal-profile` | `company.update` | `modules/erp/routes/settings.js:203` |
| DELETE | `/api/erp/settings/logo` | `company.update` | `modules/erp/routes/settings.js:163` |
| POST | `/api/erp/settings/logo` | `company.update` | `modules/erp/routes/settings.js:118` |
| GET | `/api/erp/settings/logo/:id` | `company.read` | `modules/erp/routes/settings.js:144` |
| GET | `/api/erp/settings/margen` | `company.read` | `modules/erp/routes/settings.js:87` |
| PUT | `/api/erp/settings/margen` | `company.update` | `modules/erp/routes/settings.js:104` |
| POST | `/api/erp/settings/margen/alta` | `company.update` | `modules/erp/routes/settings.js:94` |
| GET | `/api/erp/settings/oficio` | `company.read` | `modules/erp/routes/settings.js:48` |
| PUT | `/api/erp/settings/oficio` | `company.update` | `modules/erp/routes/settings.js:61` |
| POST | `/api/erp/settings/oficio/sembrar` | `company.update` | `modules/erp/routes/settings.js:72` |
| GET | `/api/erp/settings/store` | `store_settings.read` | `modules/erp/routes/settings.js:226` |
| PUT | `/api/erp/settings/store` | `store_settings.update` | `modules/erp/routes/settings.js:232` |
| POST | `/api/erp/stock-transfers` | `inventory.edit` | `modules/erp/routes/stock-transfers.js:201` |
| GET | `/api/erp/stock-transfers/:id` | `inventory.read` | `modules/erp/routes/stock-transfers.js:193` |
| POST | `/api/erp/stock-transfers/:id/cancel` | `inventory.edit` | `modules/erp/routes/stock-transfers.js:209` |
| POST | `/api/erp/stock/movements/:id/reverse` | `inventory.edit` | `modules/erp/routes/stock.js:14` |
| GET | `/api/erp/supplier-invoices` | `purchases.read` | `modules/erp/routes/supplier-invoices.js:376` |
| POST | `/api/erp/supplier-invoices` | `purchases.create` | `modules/erp/routes/supplier-invoices.js:420` |
| GET | `/api/erp/supplier-invoices/:id` | `purchases.read` | `modules/erp/routes/supplier-invoices.js:411` |
| POST | `/api/erp/supplier-invoices/:id/anular` | `purchases.create` | `modules/erp/routes/supplier-invoices.js:429` |
| POST | `/api/erp/supplier-invoices/:id/payments` | `purchases.create` | `modules/erp/routes/supplier-invoices.js:455` |
| DELETE | `/api/erp/supplier-invoices/:id/payments/:pid` | `purchases.create` | `modules/erp/routes/supplier-invoices.js:466` |
| POST | `/api/erp/supplier-invoices/:id/proyecto` | `purchases.create` | `modules/erp/routes/supplier-invoices.js:440` |
| POST | `/api/erp/supplier-invoices/:id/refunds` | `purchases.create` | `modules/erp/routes/supplier-invoices.js:478` |
| GET | `/api/erp/supplier-invoices/eligible-origins` | `purchases.read` | `modules/erp/routes/supplier-invoices.js:393` |
| GET | `/api/erp/supplier-invoices/supplier-debt` | `purchases.read` | `modules/erp/routes/supplier-invoices.js:402` |
| POST | `/api/erp/supplier-returns` | `purchases.create` | `modules/erp/routes/supplier-returns.js:256` |
| GET | `/api/erp/supplier-returns/:id` | `purchases.read` | `modules/erp/routes/supplier-returns.js:248` |
| POST | `/api/erp/supplier-returns/:id/cancel` | `purchases.edit` | `modules/erp/routes/supplier-returns.js:264` |
| GET | `/api/erp/supplier-returns/returnable` | `purchases.read` | `modules/erp/routes/supplier-returns.js:234` |
| GET | `/api/erp/suppliers` | `suppliers.read` | `modules/erp/routes/suppliers.js:68` |
| POST | `/api/erp/suppliers` | `suppliers.create` | `modules/erp/routes/suppliers.js:108` |
| DELETE | `/api/erp/suppliers/:id` | `suppliers.delete` | `modules/erp/routes/suppliers.js:132` |
| PUT | `/api/erp/suppliers/:id` | `suppliers.edit` | `modules/erp/routes/suppliers.js:116` |
| POST | `/api/erp/suppliers/:id/account-payments` | `purchases.create` | `modules/erp/routes/suppliers.js:98` |
| GET | `/api/erp/suppliers/:id/account-summary` | `purchases.read` | `modules/erp/routes/suppliers.js:84` |
| POST | `/api/erp/suppliers/:id/restore` | `suppliers.edit` | `modules/erp/routes/suppliers.js:145` |
| GET | `/api/erp/suppliers/search` | `suppliers.read` | `modules/erp/routes/suppliers.js:76` |
| POST | `/api/erp/suscripcion/alta` | por dentro: isOwner | `modules/erp/routes/suscripcion.js:662` |
| POST | `/api/erp/suscripcion/descarga/preparar` | por dentro: isOwner | `modules/erp/routes/suscripcion.js:712` |
| POST | `/api/erp/suscripcion/rescatar` | por dentro: isOwner | `modules/erp/routes/suscripcion.js:755` |
| GET | `/api/erp/suscripcion/situacion` | por dentro: isOwner | `modules/erp/routes/suscripcion.js:772` |
| GET | `/api/erp/tiempo` | `tiempo.read` | `modules/erp/routes/tiempo.js:162` |
| POST | `/api/erp/tiempo` | `tiempo.edit` | `modules/erp/routes/tiempo.js:187` |
| DELETE | `/api/erp/tiempo/:id` | `tiempo.edit` | `modules/erp/routes/tiempo.js:201` |
| PUT | `/api/erp/tiempo/:id` | `tiempo.edit` | `modules/erp/routes/tiempo.js:194` |
| GET | `/api/erp/tiempo/activo` | `tiempo.read` | `modules/erp/routes/tiempo.js:158` |
| GET | `/api/erp/tiempo/proyecto/:id` | `tiempo.read` | `modules/erp/routes/tiempo.js:169` |
| POST | `/api/erp/tiempo/start` | `tiempo.edit` | `modules/erp/routes/tiempo.js:173` |
| POST | `/api/erp/tiempo/stop` | `tiempo.edit` | `modules/erp/routes/tiempo.js:180` |
| GET | `/api/erp/users` | `admin.manage_users` | `modules/erp/routes/users.js:45` |
| POST | `/api/erp/users` | `admin.manage_users` | `modules/erp/routes/users.js:50` |
| DELETE | `/api/erp/users/:id` | `admin.manage_users` | `modules/erp/routes/users.js:147` |
| PUT | `/api/erp/users/:id` | `admin.manage_users` | `modules/erp/routes/users.js:64` |
| GET | `/api/erp/users/:id/baja` | `admin.manage_users` | `modules/erp/routes/users.js:118` |
| GET | `/api/erp/users/:id/permissions` | `admin.manage_users` | `modules/erp/routes/users.js:163` |
| POST | `/api/erp/users/:id/permissions` | `admin.manage_users` | `modules/erp/routes/users.js:175` |
| POST | `/api/erp/users/:id/recuperar` | `admin.manage_users` | `modules/erp/routes/users.js:131` |
| GET | `/api/erp/users/activity` | `admin.manage_users` | `modules/erp/routes/users.js:223` |
| GET | `/api/erp/users/backup` | `backup.download` | `modules/erp/routes/users.js:242` |
| GET | `/api/erp/vigia/avisos` | `analytics.read` | `modules/erp/routes/vigia.js:56` |
| GET | `/api/erp/vigia/detectores` | `analytics.read` | `modules/erp/routes/vigia.js:35` |
| GET | `/api/erp/vigia/hallazgos` | `analytics.read` | `modules/erp/routes/vigia.js:42` |
| GET | `/api/erp/warehouses` | `inventory.read` | `modules/erp/routes/warehouses.js:182` |
| POST | `/api/erp/warehouses` | `inventory.edit` | `modules/erp/routes/warehouses.js:197` |
| DELETE | `/api/erp/warehouses/:id` | `inventory.edit` | `modules/erp/routes/warehouses.js:221` |
| PUT | `/api/erp/warehouses/:id` | `inventory.edit` | `modules/erp/routes/warehouses.js:205` |
| POST | `/api/erp/warehouses/:id/default` | `inventory.edit` | `modules/erp/routes/warehouses.js:213` |
| POST | `/api/erp/warehouses/:id/restore` | `inventory.edit` | `modules/erp/routes/warehouses.js:229` |
| GET | `/api/erp/warehouses/:id/stock` | `inventory.read` | `modules/erp/routes/warehouses.js:191` |
| POST | `/api/registro/crear` | — **nada** | `modules/registro/index.js:233` |
| POST | `/api/registro/disa` | — **nada** | `modules/registro/index.js:91` |
| POST | `/api/registro/init` | — **nada** | `modules/registro/index.js:78` |
| GET | `/cita/:token` | solo sesión | `modules/erp/routes/citas.js:1069` |
| POST | `/cita/:token/anular` | solo sesión | `modules/erp/routes/reserva-publica.js:215` |
| POST | `/cita/:token/avisar` | solo sesión | `modules/erp/routes/citas.js:1082` |
| POST | `/cita/:token/cambiar` | solo sesión | `modules/erp/routes/reserva-publica.js:202` |
| POST | `/cita/:token/confirmar` | solo sesión | `modules/erp/routes/citas.js:1075` |
| GET | `/cita/:token/huecos` | solo sesión | `modules/erp/routes/reserva-publica.js:187` |
| GET | `/docs` | — **nada** | `index.js:1471` |
| GET | `/favicon.ico` | — **nada** | `index.js:56` |
| GET | `/favicon.svg` | — **nada** | `index.js:56` |
| POST | `/find-tenant` | — **nada** | `index.js:1229` |
| GET | `/portal` | solo sesión | `modules/portal/index.js:90` |
| GET | `/portal/:token` | solo sesión | `modules/portal/index.js:70` |
| GET | `/portal/factura/:id/pdf` | solo sesión | `modules/portal/index.js:185` |
| POST | `/portal/mensaje` | solo sesión | `modules/portal/index.js:173` |
| GET | `/registro` | — **nada** | `modules/registro/index.js:73` |
| GET | `/reservar` | solo sesión | `modules/erp/routes/reserva-publica.js:80` |
| GET | `/reservar/:handle` | solo sesión | `modules/erp/routes/reserva-publica.js:86` |
| GET | `/reservar/:handle/huecos` | solo sesión | `modules/erp/routes/reserva-publica.js:103` |
| GET | `/reservar/:handle/personas` | solo sesión | `modules/erp/routes/reserva-publica.js:94` |
| POST | `/reservar/:handle/reservar` | solo sesión | `modules/erp/routes/reserva-publica.js:118` |
| POST | `/stripe/webhook` | — **nada** | `index.js:1518` |
| GET | `/superadmin` | solo sesión | `modules/superadmin/index.js:209` |
| GET | `/superadmin/2fa` | solo sesión | `modules/superadmin/index.js:226` |
| POST | `/superadmin/2fa/activar` | solo sesión | `modules/superadmin/index.js:240` |
| POST | `/superadmin/2fa/desactivar` | solo sesión | `modules/superadmin/index.js:278` |
| POST | `/superadmin/2fa/regenerar` | solo sesión | `modules/superadmin/index.js:262` |
| GET | `/superadmin/avance` | solo sesión | `modules/superadmin/avance.js:51` |
| GET | `/superadmin/backups` | solo sesión | `modules/superadmin/backups.js:24` |
| POST | `/superadmin/backups/run` | solo sesión | `modules/superadmin/backups.js:65` |
| GET | `/superadmin/change-password` | solo sesión | `modules/superadmin/index.js:212` |
| POST | `/superadmin/change-password` | solo sesión | `modules/superadmin/index.js:216` |
| GET | `/superadmin/errores` | solo sesión | `modules/superadmin/errores.js:8` |
| GET | `/superadmin/integridad` | solo sesión | `modules/superadmin/integridad.js:46` |
| POST | `/superadmin/integridad/run` | solo sesión | `modules/superadmin/integridad.js:79` |
| GET | `/superadmin/login` | — **nada** | `modules/superadmin/index.js:123` |
| POST | `/superadmin/login` | solo sesión | `modules/superadmin/index.js:127` |
| POST | `/superadmin/logout` | solo sesión | `modules/superadmin/index.js:202` |
| GET | `/superadmin/migraciones` | solo sesión | `modules/superadmin/migraciones.js:53` |
| GET | `/superadmin/migraciones/:slug/:id/fichero` | solo sesión | `modules/superadmin/migraciones.js:106` |
| GET | `/superadmin/negocios` | solo sesión | `modules/superadmin/index.js:294` |
| POST | `/superadmin/negocios/:id/cap` | solo sesión | `modules/superadmin/index.js:381` |
| POST | `/superadmin/negocios/:id/reactivate` | solo sesión | `modules/superadmin/index.js:401` |
| POST | `/superadmin/negocios/:id/suspend` | solo sesión | `modules/superadmin/index.js:391` |
| GET | `/superadmin/salud` | solo sesión | `modules/superadmin/salud.js:67` |
| GET | `/superadmin/seguridad` | solo sesión | `modules/superadmin/seguridad.js:29` |
| POST | `/superadmin/verify-2fa` | solo sesión | `modules/superadmin/index.js:150` |
