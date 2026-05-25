# Mapa Funcional — Bamburu ERP/Store

> Generado el 2026-05-14. Refleja el estado actual del código.

---

## PRODUCTOS

**Qué hace:**
- Gestión del catálogo de productos con soporte de variantes, galería de imágenes, categorías y etiquetas.

**Endpoints:**
- `GET /api/erp/products` → listar todos los productos con nombre de categoría
- `GET /api/erp/products/:id` → detalle con imágenes, variantes y tags
- `POST /api/erp/products` → crear producto
- `PUT /api/erp/products/:id` → actualizar producto
- `DELETE /api/erp/products/:id` → eliminar producto
- `GET /api/erp/products/:id/images` → listar imágenes del producto
- `POST /api/erp/products/:id/images` → añadir imagen a la galería
- `DELETE /api/erp/products/:id/images/:imgId` → eliminar imagen
- `GET /api/erp/products/:id/variants` → listar variantes
- `POST /api/erp/products/:id/variants` → crear variante
- `PUT /api/erp/products/:id/variants/:vid` → actualizar variante
- `DELETE /api/erp/products/:id/variants/:vid` → eliminar variante
- `GET /api/erp/products/tags/all` → listar todas las etiquetas
- `POST /api/erp/products/tags/create` → crear etiqueta
- `DELETE /api/erp/products/tags/:id` → eliminar etiqueta

**Campos importantes en la BD:**
- `products`: id, name, slug (UNIQUE, generado automáticamente), sku, description, price, compare_price, stock, image_url, category_id, status [active|draft|archived], type [physical|digital], digital_file_url, featured, created_at
- `product_images`: id, product_id, url, alt, position, created_at
- `product_variants`: id, product_id, name, option1_name, option1_value, option2_name, option2_value, sku, price (NULL = usa precio base), stock, created_at
- `product_tags`: product_id, tag_id (tabla puente many-to-many)
- `tags`: id, name (UNIQUE), created_at
- `categories`: id, name (UNIQUE), description, created_at

**Funcionalidades implementadas:**
- ✓ CRUD completo de productos
- ✓ Campo `compare_price` para mostrar precio tachado (precio de oferta)
- ✓ Galería de imágenes múltiples por producto con campo `position` para ordenar
- ✓ Variantes con hasta 2 opciones (ej: talla, color), precio independiente y stock independiente
- ✓ Etiquetas (tags) con relación many-to-many
- ✓ Categorías con conteo de productos asociados
- ✓ Tipo de producto: `physical` o `digital` (digital incluye `digital_file_url`)
- ✓ Estado del producto: `active`, `draft`, `archived`
- ✓ Flag `featured` para marcar productos destacados
- ✓ Slug único autogenerado a partir del nombre + timestamp
- ✓ SKU por producto y por variante
- ✓ Exportación CSV de productos

**Funcionalidades parciales o incompletas:**
- ⚠️ El stock se gestiona a nivel de `products.stock`, pero el campo `product_variants.stock` existe y no se descuenta en pedidos; si usas variantes, el stock global y el de variante se desincronizarán.
- ⚠️ El slug se genera como `nombre-timestamp`; si el nombre es idéntico entre dos productos, la inserción fallará por constraint UNIQUE antes de llegar a la segunda.
- ⚠️ El precio `NULL` en variantes significa "usar precio base", pero la interfaz no lo comunica explícitamente al usuario.

**Pantallas admin:**
- `GET /admin/products` — listado con buscador, modal de creación/edición, gestión de galería, variantes y tags en una sola pantalla
- `GET /admin/categories` — CRUD de categorías
- `GET /admin/tags` — CRUD de etiquetas

**Pantallas tienda pública:**
- `GET /store/catalog` — catálogo completo con filtros
- `GET /store/product/:id` — detalle de producto con galería, selector de variante, reseñas

---

## PEDIDOS

**Qué hace:**
- Gestión del ciclo de vida completo de pedidos: creación, estados, tracking, notas, devoluciones y reembolsos. Los pedidos pueden originarse desde la tienda online o desde el POS.

**Endpoints:**
- `POST /api/erp/orders/sales` → crear venta desde POS
- `GET /api/erp/orders` → listar pedidos (query opcional: `?status=...`)
- `GET /api/erp/orders/:id` → detalle con líneas, historial de estados, reembolsos
- `POST /api/erp/orders/:id/status` → cambiar estado con comentario
- `POST /api/erp/orders/:id/notes` → guardar notas de administrador
- `POST /api/erp/orders/:id/tracking` → añadir número de seguimiento
- `POST /api/erp/orders/:id/refund` → registrar reembolso con importe y motivo

**Campos importantes en la BD:**
- `sales_orders`: id, order_number (UNIQUE), client_id, shipping_method_id, discount_code_id, subtotal, shipping_cost, discount_amount, tax_amount, total, status [pending|processing|shipped|delivered|completed|cancelled|refunded], source [pos|online], customer_notes, admin_notes, tracking_number, created_at
- `sales_items`: id, order_id, product_id, variant_id, product_name, quantity, unit_price, total
- `order_status_history`: id, order_id, status, comment, user_name, created_at
- `refunds`: id, order_id, amount, reason, status, created_at

**Funcionalidades implementadas:**
- ✓ Listado de pedidos filtrable por estado
- ✓ Detalle de pedido con líneas de producto, importes desglosados (subtotal, envío, descuento, IVA, total)
- ✓ Ciclo de estados: `pending → processing → shipped → delivered → completed` y terminales `cancelled`, `refunded`
- ✓ Historial completo de cambios de estado con fecha, comentario y nombre del usuario que hizo el cambio
- ✓ Campo de tracking number editable
- ✓ Notas de cliente (introducidas en el checkout) y notas de administrador (editables desde el panel)
- ✓ Registro de reembolsos con importe parcial o total y motivo
- ✓ Descuento del stock al crear pedido online (transaccional, con rollback si hay rotura de stock)
- ✓ Creación/actualización automática de cliente al procesar checkout online
- ✓ Página de factura/albarán imprimible por pedido
- ✓ Identificación de origen: `source='pos'` vs `source='online'`
- ✓ Exportación CSV de ventas

**Funcionalidades parciales o incompletas:**
- ⚠️ `sales_items.variant_id` existe pero no se rellena; el checkout y el POS solo guardan `product_id`.
- ⚠️ El reembolso solo registra el importe en la tabla `refunds`; no revierte automáticamente el stock ni actualiza `total_spent` del cliente.
- ⚠️ No hay envío de email de confirmación al cliente tras el pedido.
- ⚠️ La factura (`/admin/orders/:id/invoice`) es una vista HTML imprimible, no genera PDF de forma nativa.

**Pantallas admin:**
- `GET /admin/orders` — listado con filtro de estado y buscador
- `GET /admin/orders/:id` — detalle completo del pedido
- `GET /admin/orders/:id/invoice` — vista imprimible de la factura
- `GET /admin/orders/refunds` — listado de todos los reembolsos con totales

**Pantallas tienda pública:**
- `GET /store/checkout` — proceso de compra
- `GET /store/order-confirmation/:orderNum` — confirmación tras comprar

---

## CLIENTES

**Qué hace:**
- Base de datos de clientes con historial de compras, grupos con descuento automático y sincronización con cuentas registradas de la tienda.

**Endpoints:**
- `GET /api/erp/clients` → listar clientes ordenados por `total_spent`
- `GET /api/erp/clients/:id` → detalle con historial de pedidos
- `POST /api/erp/clients` → crear cliente (sincroniza suscripción newsletter)
- `PUT /api/erp/clients/:id` → actualizar cliente (sincroniza suscripción newsletter)
- `DELETE /api/erp/clients/:id` → eliminar cliente
- `GET /api/erp/clients/:id/orders` → pedidos del cliente
- `GET /api/erp/clients/groups/all` → listar grupos con conteo de miembros
- `POST /api/erp/clients/groups/create` → crear grupo
- `PUT /api/erp/clients/groups/:id` → actualizar grupo
- `DELETE /api/erp/clients/groups/:id` → eliminar grupo

**Campos importantes en la BD:**
- `clients`: id, name, fiscal_id, email, phone, address, city, country, group_id, notes, total_spent, accepts_newsletter, created_at
- `client_groups`: id, name (UNIQUE), description, discount_pct, created_at
- `customer_accounts`: id, client_id (FK UNIQUE), email (UNIQUE), password_hash, active, created_at

**Funcionalidades implementadas:**
- ✓ CRUD completo de clientes
- ✓ Campos fiscales: NIF/CIF (`fiscal_id`)
- ✓ Dirección completa: dirección, ciudad, país
- ✓ Notas internas por cliente
- ✓ Acumulación automática de `total_spent` al procesar pedidos online
- ✓ Flag `accepts_newsletter` sincronizado con la tabla `newsletter_subscribers`
- ✓ Grupos de clientes con porcentaje de descuento (`discount_pct`)
- ✓ Historial de pedidos del cliente visible desde el panel admin
- ✓ Creación automática de cliente al realizar checkout (si hay email)
- ✓ Vinculación entre `clients` y `customer_accounts` (cuenta registrada en la tienda)
- ✓ Exportación CSV de clientes

**Funcionalidades parciales o incompletas:**
- ⚠️ El `discount_pct` del grupo de clientes existe en la BD pero no se aplica automáticamente al checkout online ni al POS; es solo informativo.
- ⚠️ No hay sistema de puntos ni programa de fidelización más allá del campo `total_spent`.
- ⚠️ `total_spent` solo se actualiza en pedidos online; los pedidos POS no lo actualizan.

**Pantallas admin:**
- `GET /admin/clients` — listado con buscador y modal de detalle/edición con historial de pedidos
- `GET /admin/clients/groups` — CRUD de grupos de clientes

**Pantallas tienda pública:**
- (La cuenta del cliente en la tienda se documenta en el módulo CUENTA DEL CLIENTE)

---

## INVENTARIO / STOCK

**Qué hace:**
- Seguimiento de niveles de stock, ajustes manuales y registro de movimientos con auditoría completa.

**Endpoints:**
- `GET /api/erp/inventory/movements` → últimos 100 movimientos con nombre de producto
- `POST /api/erp/inventory/movements` → registrar movimiento (entrada/salida/ajuste exacto)

**Campos importantes en la BD:**
- `products`: stock (campo actualizado en tiempo real)
- `inventory_movements`: id, product_id, variant_id, type [in|out|adjust], quantity, reason, created_at

**Funcionalidades implementadas:**
- ✓ Tres tipos de movimiento: `in` (suma), `out` (resta), `adjust` (fija stock exacto)
- ✓ Campo `reason` para documentar el motivo del ajuste
- ✓ KPIs en la pantalla: total de productos, productos con stock bajo (<5), productos sin stock, valor total del inventario (precio × stock)
- ✓ Búsqueda en tiempo real dentro del listado de existencias
- ✓ Botón de ajuste rápido desde la fila de cada producto
- ✓ Tabla de movimientos recientes visible en la misma pantalla

**Funcionalidades parciales o incompletas:**
- ⚠️ `inventory_movements.variant_id` existe pero nunca se rellena; los movimientos no distinguen variantes.
- ⚠️ El stock se descuenta al crear un pedido online, pero ese descuento no genera un registro en `inventory_movements`; el log de movimientos solo refleja ajustes manuales.
- ⚠️ No hay alertas automáticas ni notificaciones cuando el stock cae por debajo del umbral.

**Pantallas admin:**
- `GET /admin/inventory` — existencias actuales con KPIs, buscador y tabla de movimientos recientes

---

## DESCUENTOS Y CUPONES

**Qué hace:**
- Gestión de códigos de cupón aplicables en checkout y validación de descuentos automáticos por condición de pedido.

**Endpoints:**
- `GET /api/erp/discounts` → listar códigos de cupón
- `POST /api/erp/discounts` → crear código
- `PUT /api/erp/discounts/:id` → actualizar código
- `DELETE /api/erp/discounts/:id` → eliminar código
- `GET /api/erp/discounts/auto` → listar descuentos automáticos
- `POST /api/erp/discounts/auto` → crear descuento automático
- `DELETE /api/erp/discounts/auto/:id` → eliminar descuento automático

**Campos importantes en la BD:**
- `discount_codes`: id, code (UNIQUE), type [percentage|fixed], value, min_order, max_uses (NULL = sin límite), uses_count, active, expires_at, created_at
- `auto_discounts`: id, name, type [percentage|fixed], value, condition_type [min_order|category], condition_value, active, created_at

**Funcionalidades implementadas:**
- ✓ Códigos de cupón de tipo porcentaje o importe fijo
- ✓ Importe mínimo de pedido para activar el cupón
- ✓ Límite máximo de usos (con contador automático)
- ✓ Fecha de expiración
- ✓ Activar/desactivar código
- ✓ Validación del cupón en checkout online con mensaje de error descriptivo
- ✓ Aplicación del cupón en POS
- ✓ Contador `uses_count` incrementado automáticamente al completar un pedido
- ✓ CRUD completo de descuentos automáticos (UI con condición `min_order` o `category`)

**Funcionalidades parciales o incompletas:**
- ⚠️ Los descuentos automáticos (`auto_discounts`) tienen CRUD completo pero **no se aplican en ningún checkout**; el código de validación del carrito solo consulta `discount_codes`.
- ⚠️ No existe `PUT /api/erp/discounts/auto/:id`; los descuentos automáticos solo se pueden crear o eliminar, no editar.
- ⚠️ La condición `category` en `auto_discounts.condition_type` no tiene lógica de aplicación implementada.

**Pantallas admin:**
- `GET /admin/discounts` — dos pestañas: códigos de cupón y descuentos automáticos

---

## ENVÍOS

**Qué hace:**
- Configuración de métodos de envío con precio, umbral de envío gratuito y plazo estimado.

**Endpoints:**
- `GET /api/erp/shipping` → listar métodos de envío
- `POST /api/erp/shipping` → crear método
- `PUT /api/erp/shipping/:id` → actualizar método
- `DELETE /api/erp/shipping/:id` → eliminar método

**Campos importantes en la BD:**
- `shipping_methods`: id, name, description, price, free_from (NULL = nunca gratuito), estimated_days, active, created_at

**Funcionalidades implementadas:**
- ✓ CRUD completo de métodos de envío
- ✓ Activar/desactivar método
- ✓ Precio de envío por método
- ✓ Umbral de pedido para envío gratuito (`free_from`)
- ✓ Texto de plazo estimado (libre, ej: "2-3 días hábiles")
- ✓ Los métodos activos se muestran en el checkout de la tienda
- ✓ El coste se calcula automáticamente en checkout (respetando el umbral de gratuidad)
- ✓ El coste se aplica también en el POS

**Pantallas admin:**
- `GET /admin/shipping` — CRUD de métodos de envío

**Pantallas tienda pública:**
- `GET /store/checkout` — selector de método de envío con cálculo de coste en tiempo real

---

## CONFIGURACIÓN DE EMPRESA

**Qué hace:**
- Almacena los datos fiscales y de contacto de la empresa, usados en facturas y documentos del sistema.

**Endpoints:**
- `GET /api/erp/settings/company` → leer configuración
- `PUT /api/erp/settings/company` → guardar configuración

**Campos importantes en la BD:**
- `company_config`: id (siempre 1), company_name, fiscal_id, tax_rate, logo_url, address, phone, email, website

**Funcionalidades implementadas:**
- ✓ Nombre de empresa
- ✓ NIF/CIF fiscal
- ✓ Tipo de IVA por defecto (`tax_rate`, en porcentaje) — aplicado globalmente en el checkout
- ✓ Email, teléfono y web de contacto
- ✓ Dirección fiscal
- ✓ URL del logo de empresa (distinto del logo de tienda)

**Funcionalidades parciales o incompletas:**
- ⚠️ No hay soporte para múltiples tipos de IVA (todos los productos aplican el mismo `tax_rate`).
- ⚠️ Los datos de empresa se usan en la factura HTML pero no en ninguna plantilla de email.

**Pantallas admin:**
- `GET /admin/settings` — formulario de configuración de empresa

---

## CONFIGURACIÓN DE TIENDA

**Qué hace:**
- Personalización visual de la tienda pública: nombre, colores, logotipo, redes sociales, textos legales y metadatos SEO.

**Endpoints:**
- `GET /api/erp/settings/store` → leer configuración
- `PUT /api/erp/settings/store` → guardar configuración

**Campos importantes en la BD:**
- `store_settings`: id (siempre 1), store_name, tagline, logo_url, banner_url, primary_color, announcement, facebook_url, instagram_url, twitter_url, terms_html, privacy_html, returns_html, seo_title, seo_description

**Funcionalidades implementadas:**
- ✓ Nombre de la tienda
- ✓ Eslogan visible en la homepage
- ✓ URL del logotipo (se muestra en la cabecera de la tienda)
- ✓ URL del banner principal de la homepage
- ✓ Color principal en hexadecimal (aplicado vía CSS variable `--p` en toda la tienda)
- ✓ Barra de anuncio en la parte superior de la tienda (texto libre)
- ✓ URLs de redes sociales: Facebook, Instagram, Twitter/X (aparecen en el footer)
- ✓ Páginas legales en HTML: Términos, Privacidad, Devoluciones (se sirven como `/store/legal/:page`)
- ✓ Meta title y meta description para SEO
- ✓ Todos los cambios se reflejan en la tienda inmediatamente al recargar

**Pantallas admin:**
- `GET /admin/store-settings` — cuatro pestañas: Apariencia, Redes sociales, Páginas legales, SEO

---

## USUARIOS Y ROLES

**Qué hace:**
- Gestión de los administradores del sistema con control de acceso basado en roles y descarga de backup de la base de datos.

**Endpoints:**
- `GET /api/erp/users` → listar usuarios admin
- `POST /api/erp/users` → crear usuario
- `PUT /api/erp/users/:id` → actualizar usuario
- `DELETE /api/erp/users/:id` → eliminar usuario
- `GET /api/erp/users/activity` → registro de actividad (últimos 200 eventos)
- `GET /api/erp/users/backup` → descarga del archivo `.db` completo

**Campos importantes en la BD:**
- `admin_users`: id, name, email (UNIQUE), password_hash, role [owner|admin|employee|readonly], active, created_at, must_change_password, totp_secret TEXT DEFAULT NULL, totp_enabled INTEGER DEFAULT 0
- `admin_sessions`: token, user_id, created_at, expires_at, csrf_token
- `activity_logs`: id, user_id, user_name, action, entity, entity_id, details, created_at
- `password_reset_tokens`: id, admin_user_id, token (UNIQUE), expires_at, used INTEGER DEFAULT 0, created_at

**Roles y permisos:**
- `owner` — acceso total; único que puede crear/editar/eliminar usuarios owner y admin
- `admin` — acceso a todo excepto configuración de empresa, gestión de usuarios y backup
- `employee` — acceso a productos, pedidos, clientes, inventario, envíos
- `readonly` — acceso de solo lectura; sin acceso a descuentos, analítica

**Funcionalidades implementadas:**
- ✓ CRUD de usuarios con control de roles
- ✓ Un owner no puede ser eliminado
- ✓ No se puede eliminar el último usuario activo
- ✓ Un usuario no puede cambiar su propio rol
- ✓ Admin no puede elevar roles a owner/admin ni editar usuarios de esos roles
- ✓ Contraseña hasheada con bcrypt; rehash automático al verificar si el algoritmo ha mejorado
- ✓ Forzar cambio de contraseña en el primer login (`must_change_password=1`)
- ✓ Activar/desactivar usuarios
- ✓ Descarga del backup completo de la BD en formato `.db`
- ✓ Registro de actividad: creación/edición/borrado de productos, clientes, pedidos, reembolsos, cambios de contraseña
- ✓ Navegación del admin filtrada por rol (los items no permitidos no se muestran en el menú)

**Funcionalidades implementadas (seguridad adicional):**
- ✓ Recuperación de contraseña por email (token 1h, Resend, `password_reset_tokens`)
- ✓ 2FA TOTP (Google Authenticator / Authy) para todos los usuarios admin
- ✓ QR code de setup generado en servidor con `qrcode` + `core/totp.js` (implementación RFC 6238 custom)
- ✓ Estado 2FA por usuario: `totp_enabled=1` intercepta el login y exige código de 6 dígitos
- ✓ Página unificada `/admin/security` (contraseña + 2FA) visible para todos los roles
- ✓ Tras cambio de contraseña forzado → nudge para activar 2FA si no está activo

**Funcionalidades parciales o incompletas:**
- ⚠️ La sesión tiene `expires_at` pero la limpieza es periódica (cada hora); sesiones caducadas pueden persistir brevemente.

**Rutas de autenticación (`modules/erp/routes/auth.js`):**
- `GET /admin/login` / `POST /admin/login` — login con 2FA interceptor
- `GET /admin/verify-2fa` / `POST /admin/verify-2fa` — verificación TOTP en login
- `GET /admin/forgot-password` / `POST /admin/forgot-password` — envío de link de reset
- `GET /admin/reset-password` / `POST /admin/reset-password` — validación de token y cambio

**Pantallas admin:**
- `GET /admin/users` — CRUD de usuarios y botón de descarga de backup
- `GET /admin/activity` — registro de actividad del sistema
- `GET /admin/security` — contraseña y 2FA (pestañas `?tab=password` / `?tab=2fa`)
- `POST /admin/security/change-password` — cambiar contraseña (invalida otras sesiones)
- `POST /admin/security/confirm-2fa` — activar 2FA con código verificado
- `POST /admin/security/disable-2fa` — desactivar 2FA

---

## RESEÑAS

**Qué hace:**
- Moderación de reseñas de productos enviadas por clientes de la tienda.

**Endpoints:**
- `GET /api/erp/reviews` → listar reseñas (query opcional: `?status=pending|approved|rejected`)
- `PUT /api/erp/reviews/:id` → cambiar estado
- `DELETE /api/erp/reviews/:id` → eliminar reseña

**Campos importantes en la BD:**
- `product_reviews`: id, product_id, client_id, customer_name, rating (1-5), comment, status [pending|approved|rejected], created_at

**Funcionalidades implementadas:**
- ✓ Listado filtratable por estado (todas / pendientes / aprobadas / rechazadas)
- ✓ Contador de reseñas pendientes visible en el filtro
- ✓ Aprobación y rechazo de reseñas con un click
- ✓ Solo las reseñas `approved` son visibles en la tienda pública
- ✓ Media de valoración calculada y mostrada en el detalle de producto de la tienda
- ✓ Eliminación definitiva de reseñas

**Funcionalidades parciales o incompletas:**
- ⚠️ `product_reviews.client_id` existe pero nunca se rellena; las reseñas de la tienda son anónimas (solo `customer_name` de texto libre).

**Pantallas admin:**
- `GET /admin/reviews` — listado con filtro y acciones de moderación

**Pantallas tienda pública:**
- `GET /store/product/:id` — muestra reseñas aprobadas y formulario de envío de nueva reseña

---

## NEWSLETTER

**Qué hace:**
- Gestión de suscriptores de newsletter con sincronización con clientes.

**Endpoints (ERP):**
- `GET /api/erp/newsletter` → listar suscriptores
- `DELETE /api/erp/newsletter/:id` → eliminar suscriptor
- `GET /api/erp/newsletter/export` → exportar CSV de suscriptores

**Endpoints (Tienda):**
- `POST /api/store/newsletter/subscribe` → suscribirse (rate limit: 5/hora)

**Campos importantes en la BD:**
- `newsletter_subscribers`: id, email (UNIQUE), name, active, created_at

**Funcionalidades implementadas:**
- ✓ Suscripción desde la homepage de la tienda
- ✓ `INSERT OR IGNORE` para no duplicar emails ya registrados
- ✓ Sincronización bidireccional: al crear/actualizar un cliente en el admin con `accepts_newsletter=true`, se inserta en `newsletter_subscribers`; si `accepts_newsletter=false`, se elimina
- ✓ Listado de suscriptores en el admin con fecha de alta
- ✓ Exportación CSV de suscriptores
- ✓ Eliminación de suscriptores desde el admin

**Funcionalidades parciales o incompletas:**
- ⚠️ El campo `active` en `newsletter_subscribers` existe pero la suscripción siempre inserta activo; no hay forma de desactivar un suscriptor sin eliminarlo.
- ⚠️ No hay integración con ninguna plataforma de envío de emails (Mailchimp, Brevo, etc.); es solo un listado de contactos.

**Pantallas admin:**
- `GET /admin/newsletter` — listado de suscriptores y botón de exportar CSV

**Pantallas tienda pública:**
- `GET /store` — formulario de suscripción en la sección inferior de la homepage

---

## PUNTO DE VENTA (POS)

**Qué hace:**
- Terminal de venta presencial para crear pedidos directamente desde el panel admin, sin necesidad de que el cliente pase por el checkout de la tienda.

**Endpoints:**
- `POST /api/erp/orders/sales` → crear venta POS (transaccional, descuenta stock, estado automático `completed`)

**Funcionalidades implementadas:**
- ✓ Búsqueda de productos en tiempo real mientras se escribe
- ✓ Añadir múltiples líneas al ticket con cantidades
- ✓ Selección de cliente existente (opcional)
- ✓ Selección de método de envío (opcional)
- ✓ Aplicación de código de descuento
- ✓ Cálculo en tiempo real de subtotal, descuento, IVA y total
- ✓ El pedido se crea con `source='pos'` y estado directamente `completed`
- ✓ El stock se descuenta al confirmar la venta (en una transacción)
- ✓ Validación de stock disponible antes de confirmar

**Funcionalidades parciales o incompletas:**
- ⚠️ `total_spent` del cliente no se actualiza al crear una venta POS.
- ⚠️ No imprime ticket ni genera documento desde el POS; hay que ir al detalle del pedido para la factura.

**Pantallas admin:**
- `GET /admin/orders/pos` — interfaz de punto de venta

---

## ANALÍTICA / DASHBOARD

**Qué hace:**
- KPIs de negocio, gráficas de ventas por período, productos más vendidos, reporte de stock y exportaciones CSV.

**Endpoints:**
- `GET /api/erp/analytics/overview` → KPIs: ingresos totales, nº pedidos, ticket medio, nº clientes, nº productos, stock bajo
- `GET /api/erp/analytics/sales-by-period` → ventas agrupadas por fecha (query: `?days=7|30|90`)
- `GET /api/erp/analytics/best-sellers` → top productos por ingresos (query: `?limit=10`)
- `GET /api/erp/analytics/stock-report` → lista de productos con stock y valor de inventario
- `GET /api/erp/analytics/export/sales` → CSV de todas las ventas
- `GET /api/erp/analytics/export/products` → CSV de todos los productos
- `GET /api/erp/analytics/export/clients` → CSV de todos los clientes

**Funcionalidades implementadas:**
- ✓ KPI: ingresos totales (suma de `total` en pedidos no cancelados/reembolsados)
- ✓ KPI: número de pedidos
- ✓ KPI: ticket medio
- ✓ KPI: total de clientes
- ✓ KPI: total de productos
- ✓ KPI: productos con stock bajo (<5 unidades)
- ✓ Gráfica de ventas por período (7, 30 o 90 días)
- ✓ Gráfica de productos más vendidos por ingresos
- ✓ Tabla de reporte de stock con valor de inventario por producto
- ✓ Exportación CSV: ventas, productos, clientes

**Funcionalidades parciales o incompletas:**
- ⚠️ No hay gráficas de evolución de clientes nuevos, tasa de conversión ni métricas de tienda.

**Pantallas admin:**
- `GET /admin/analytics` — pantalla con KPIs, gráficas (usando Chart.js via CDN) y exportaciones

---

## FACTURACIÓN

**Qué hace:**
- Generación de albarán/factura HTML imprimible por pedido. No es un módulo independiente; es una vista dentro de pedidos.

**Endpoints:**
- (ninguno de API; es una vista HTML)

**Funcionalidades implementadas:**
- ✓ Vista imprimible accesible desde el detalle de cada pedido
- ✓ Incluye datos de la empresa (de `company_config`), número de pedido, cliente, líneas de producto, importes desglosados y estado

**Funcionalidades parciales o incompletas:**
- ⚠️ Solo es HTML imprimible; no genera PDF de forma nativa (el usuario puede imprimir a PDF desde el navegador).
- ⚠️ No hay numeración correlativa de facturas (se usa el `order_number` del pedido como referencia).
- ⚠️ No hay módulo de facturas separado de pedidos ni soporte para facturas rectificativas.

**Pantallas admin:**
- `GET /admin/orders/:id/invoice` — vista de factura/albarán imprimible

---

## TIENDA PÚBLICA

**Qué hace:**
- Catálogo público de productos con búsqueda, filtros, carrito y proceso de checkout completo.

**Endpoints (API pública):**
- `GET /api/store/products` → productos activos (queries: `category`, `tag`, `q` búsqueda, `featured=1`)
- `GET /api/store/products/:idOrSlug` → detalle por ID o slug con imágenes, variantes, reseñas aprobadas, rating medio, tags
- `GET /api/store/categories` → listado de categorías
- `GET /api/store/shipping` → métodos de envío activos
- `POST /api/store/validate-coupon` → validar código de descuento
- `POST /api/store/checkout` → crear pedido online (rate limit: 10/hora)

**Funcionalidades implementadas:**
- ✓ Homepage con banner configurable, productos destacados y formulario de newsletter
- ✓ Catálogo con filtro por categoría, búsqueda por nombre y ordenación (defecto, precio asc/desc, nombre A-Z)
- ✓ Detalle de producto con galería (imagen principal + thumbnails clicables), selector de variante con precio actualizable, cantidad y botón añadir al carrito
- ✓ Badge de "Oferta" cuando hay `compare_price`, badge de "Destacado" para featured
- ✓ Carrito en `localStorage` (persiste entre sesiones sin login), con ajuste de cantidad y eliminación por línea
- ✓ Checkout con prefill de datos si el cliente tiene sesión activa
- ✓ Selector de método de envío con cálculo de coste en tiempo real (respeta umbral de envío gratuito)
- ✓ Aplicación de cupón de descuento con validación en tiempo real
- ✓ Resumen de pedido con subtotal, descuento, envío y total
- ✓ Verificación de stock disponible antes de confirmar (transaccional)
- ✓ Creación/actualización automática del cliente si proporciona email
- ✓ Página de confirmación con número de pedido
- ✓ Color principal configurable vía `store_settings.primary_color` (variable CSS `--p`)
- ✓ Barra de anuncio configurable en la parte superior
- ✓ Footer con redes sociales y links a páginas legales
- ✓ Páginas legales dinámicas: Términos, Privacidad, Devoluciones
- ✓ Reseñas visibles en el detalle de producto con media de valoración
- ✓ Formulario de envío de reseñas (van a moderación)

**Funcionalidades parciales o incompletas:**
- ⚠️ No hay filtro por tag en la UI del catálogo (el endpoint `/api/store/products?tag=X` existe pero no hay selector en la página).
- ⚠️ No hay paginación en el catálogo; todos los productos activos se cargan de una vez.
- ⚠️ No hay página de búsqueda dedicada; el buscador vive solo en el catálogo.
- ⚠️ El carrito no verifica stock en tiempo real mientras se navega; solo se valida al hacer checkout.

**Pantallas tienda pública:**
- `GET /store` — homepage
- `GET /store/catalog` — catálogo completo con filtros
- `GET /store/product/:id` — detalle de producto
- `GET /store/cart` — carrito
- `GET /store/checkout` — proceso de compra
- `GET /store/order-confirmation/:orderNum` — confirmación de pedido
- `GET /store/legal/:page` — páginas legales (terms, privacy, returns)

---

## CUENTA DEL CLIENTE (Tienda)

**Qué hace:**
- Registro, login y zona privada del cliente en la tienda, con historial de pedidos y lista de deseos.

**Endpoints:**
- `POST /api/store/account/register` → registro (rate limit: 3/hora)
- `POST /api/store/account/login` → login (rate limit: 5/15min)
- `POST /api/store/account/logout` → cerrar sesión
- `GET /api/store/account/orders` → historial de pedidos del cliente autenticado
- `GET /api/store/account/wishlist` → lista de deseos
- `POST /api/store/account/wishlist` → añadir producto a la lista de deseos
- `DELETE /api/store/account/wishlist/:pid` → eliminar de la lista de deseos

**Campos importantes en la BD:**
- `customer_accounts`: id, client_id, email (UNIQUE), password_hash, active, created_at
- `customer_sessions`: token, account_id, created_at, expires_at
- `wishlist`: id, customer_id, product_id, created_at

**Funcionalidades implementadas:**
- ✓ Registro con nombre, email y contraseña (mínimo 8 caracteres)
- ✓ Si ya existe un `client` con ese email, se vincula al registro en lugar de duplicar
- ✓ Login con cookie de sesión `csess` (duración 7 días)
- ✓ Cerrar sesión
- ✓ Zona privada con historial de pedidos propios (con estado y total)
- ✓ Lista de deseos: añadir, visualizar y eliminar productos
- ✓ Prefill automático de datos en el checkout si hay sesión activa
- ✓ Rehash de contraseña automático al hacer login si el algoritmo ha mejorado

**Funcionalidades parciales o incompletas:**
- ⚠️ No hay recuperación de contraseña por email.
- ⚠️ No hay edición de datos del perfil del cliente desde la tienda.
- ⚠️ `customer_sessions.expires_at` existe pero no hay lógica de expiración activa en el lado del servidor para sesiones de cliente.
- ⚠️ No hay verificación de email tras el registro.

**Pantallas tienda pública:**
- `GET /store/account` — zona privada con historial de pedidos y lista de deseos
- `GET /store/account/login` — formulario de login
- `GET /store/account/register` — formulario de registro

---

## OBSERVACIONES TÉCNICAS

### Inconsistencias entre módulos

- **`total_spent` solo actualizado en checkout online.** Los pedidos creados desde el POS no actualizan `clients.total_spent`. Si un negocio usa ambos canales, la cifra es incorrecta.
- **Stock no se descuenta por variante.** `product_variants.stock` y `inventory_movements.variant_id` existen, pero checkout, POS y movimientos de inventario siempre operan sobre `products.stock`. Las dos columnas de stock viven en paralelo sin coordinación.
- **Registro de movimientos de inventario incompleto.** Los descuentos de stock al crear pedidos (tanto online como POS) no generan registros en `inventory_movements`. La tabla solo refleja ajustes manuales.
- **Nombres inconsistentes de FK en la tabla `wishlist`.** La FK se llama `customer_id` (referencia a `customer_accounts.id`), mientras que en el resto del código la columna equivalente se llama `account_id`.

### Tablas que existen pero están infrautilizadas

- **`auto_discounts`** — tabla completa con CRUD y UI, pero nunca se consulta en el proceso de checkout; es datos inertes.
- **`product_reviews.client_id`** — columna presente pero siempre NULL; las reseñas son anónimas en la práctica.
- **`sales_items.variant_id`** — columna presente pero siempre NULL; el checkout y el POS no registran qué variante se vendió.
- **`newsletter_subscribers.active`** — columna presente; siempre se inserta como activo; no hay UI ni lógica para desactivar sin eliminar.
- **`client_groups.discount_pct`** — columna presente; nunca se aplica en ningún cálculo de precio.

### Endpoints que existen pero no tienen flujo completo

- **`PUT /api/erp/discounts/auto/:id` no existe.** Los descuentos automáticos solo se pueden crear o eliminar, no editar.
- **`GET /api/store/products?tag=X`** funciona en la API pero no hay ningún elemento UI en el catálogo que lo use.
- **`sales_items.variant_id`** se podría usar para diferenciar variantes en el historial, pero ningún endpoint lo rellena.

### Otras observaciones

- **Facturas sin numeración correlativa.** Las facturas usan `order_number` como referencia (ej: `WEB-1715000000000`). No hay un contador correlativo de facturas que cumpla con requisitos fiscales de algunas jurisdicciones.
- **HTML de páginas legales sin sanitizar.** El contenido de `terms_html`, `privacy_html` y `returns_html` se sirve como HTML crudo sin escape. Es intencional (el admin controla el contenido), pero es un vector de XSS si un usuario con acceso al admin no es de confianza.
- **Emails transaccionales parciales.** Integración con Resend (`noreply@bamburu.com`) para recuperación de contraseña de admins. No hay emails de confirmación de pedido, registro de cliente ni cambio de contraseña de cliente.
- **El módulo de analítica usa Chart.js desde CDN (jsdelivr.net).** El resto de la aplicación no tiene dependencias de CDN externas; esta es la única excepción activa.
- **`core/totp.js`** — implementación TOTP RFC 6238 propia (HMAC-SHA1 + base32), sin dependencias externas. Se eligió así porque `otplib` v12 ESM no exporta el preset `authenticator` ni admite el plugin de crypto de Node.js sin configuración adicional.
- **Todas las vistas del admin son SSR con `<script>` inline.** No hay bundler ni archivos JS externos; todo el JavaScript del cliente está embebido en las respuestas HTML. Esto es funcional y coherente, pero significa que `'unsafe-inline'` en el CSP es estructuralmente necesario.
