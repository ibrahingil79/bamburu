# TABLERO — Bamburu

> Plan de trabajo. La estrategia manda desde CANON.md; el ritual desde RITUAL.md.
> Estructura: 4 pilares en ORDEN DE CONSTRUCCIÓN — Producto → Cliente → Inventario → Ventas
> (Ventas necesita los otros tres ya hechos; ver CANON §3).
> REGLA DE ORO: una sola tarea "EN CURSO" a la vez. Terminar antes de empezar otra.
> Última actualización: 2026-06-08

---

## PILAR 1 — PRODUCTO (Catálogo) — ✅ CERRADO (2026-06-03)

El producto es la raíz de la que parte todo (CANON §2). Objetivo de este pilar: dejar el
catálogo en su versión mínima sólida. Fuera de este primer paso (más adelante): variantes,
galería de imágenes, SEO, coste/margen, unidad por hora/sesión.

### ✅ P1+P2. Tipo "servicio" en el producto + IVA por producto — HECHO (2026-05-29)
- El tipo de producto es físico / digital / **servicio**, y cada producto guarda su **IVA propio** (`products.tax_rate`).
- Al elegir "servicio" se oculta el Stock (CANON §2) y el servidor lo fuerza a 0.
- Migración aditiva: productos previos quedaron con el IVA por defecto del negocio; `type` intacto; POS/pedidos/factura sin tocar.
- Verificado con test de integración (12/12). Commit `679aa63`.

### ✅ P2.1. IVA por bandas legales + multi-país + stock digital + ayuda — HECHO (2026-05-29)
- IVA por **banda** (general/reducido/superreducido/exento), no número libre. El producto guarda `tax_band`; el % lo resuelve el servidor desde `core/vat-bands.js` (bandas por país; hoy ES). Añadir país = añadir su entrada, sin tocar el producto.
- Stock oculto/forzado a 0 también para **digital** (antes solo servicio).
- Selector con etiqueta+%+ejemplo, enlace a la AEAT y nota "¿Dudas? Pregunta a DISA" (sin lógica de DISA).
- CANON §4 ampliado con el modelo fiscal (IVA producto×país; IRPF en Settings/Ventas; responsabilidad del usuario).
- Aditivo (IRPF/POS/pedidos/factura intactos). Verificado (15/15). Commit `6efa619`.

### ✅ P2.2. IVA obligatorio (formulario + API) + ficha de producto orientada a gestión — HECHO (2026-05-29)
- Campos obligatorios (con * y validación): **Tipo, Nombre, SKU, Precio, Tipo de IVA**. SKU obligatorio también en el servidor.
- "IVA (banda)" → **"Tipo de IVA"**; el selector muestra solo el monto (21/10/4/0%) y arranca en blanco (elección explícita).
- **API endurecida**: crear/editar un producto sin banda válida → 400. Sin "General" por defecto silencioso (el IVA es dato fiscal).
- Ficha limpiada (ocultos, sin borrar código): pestañas **Imágenes** y **Avanzado/SEO**; campos Descripción, Etiquetas, Precio antes, Producto destacado, URL archivo digital, URL imagen principal. Reordenada (Tipo, Nombre, SKU primero). **Variantes se mantiene**.
- Menú: ocultada **"Etiquetas"** de Catálogo (e-commerce); ruta `/admin/tags` intacta. Catálogo queda con Productos · Categorías.
- Verificado con tests de integración/render. Commits del día (último `8540e5d`).

### ✅ P3. Unificar catálogo (absorber los servicios de A3) — HECHO (2026-05-29)
- Migración guardada: las filas de `services` pasan a productos de tipo "servicio" (precio, IVA→banda legal, SKU autogenerado `SVC-NNNN`, stock 0) y se hace `DROP TABLE services`. El IRPF del servicio se descarta (CANON). Idempotente.
- Eliminado el módulo de servicios sueltos: `routes/services.js`, `serviceSchema`, mounts `/admin/services` y `/api/erp/services`, permisos `services.*` y restos de nav.
- El autofill al facturar (`/admin/invoices/new`) lee ahora productos tipo "servicio" (precio + IVA); ya no fija el IRPF (se elige a mano). Línea libre intacta.
- Hay un único catálogo y nada en el código operativo apunta ya a `services`. Verificado (14/14). Commit `5147cc6`.

### ✅ P4. Buscador y filtros en la lista de productos — HECHO (2026-06-03)
- La lista de productos (`/admin/products`) pasa de cargar todo en el navegador a **renderizarse en el servidor** con parámetros en la URL (GET): `?q=...&categoria=...&page=...`. La búsqueda/filtro/página se mantienen al recargar y al navegar.
- **Búsqueda** por nombre **o** SKU (LIKE `%q%`, insensible a mayúsculas), **filtro por categoría** (poblado desde categorías existentes; opción "Todas") y **paginación de 25/pág** con "← Anterior / Siguiente →" + indicador "Página X de Y · N productos". Búsqueda y categoría **se combinan**.
- SQL: `WHERE` con LIKE sobre nombre/SKU + filtro de categoría, `LIMIT/OFFSET` para la página y `COUNT(*)` aparte para el total de páginas. Sin resultados → "No se encontraron productos" (no rompe).
- Cambio quirúrgico, solo `modules/erp/routes/products.js`: el modal de crear/editar y la API quedan intactos; tras guardar/eliminar la lista se refresca con `location.reload()` (conserva filtros). **POS y facturación NO se tocan** (consumen la API `/api/erp/products`, sin cambios).
- Verificado con test de integración (18/18): búsqueda nombre/SKU, filtro categoría, combinado, paginación con navegación que conserva filtros, y mensaje sin resultados. Commit `7860637`.

**Con P4 cerrado, el PILAR 1 — PRODUCTO queda completo.**

---

## CORRECCIÓN TRANSVERSAL — Buscadores y filtros en lo ya construido (2026-06-03)

No es un pilar nuevo: es **corrección de lo construido** (CANON §5) aplicando las dos reglas
de diseño permanentes que se añadieron al CANON (toda lista lleva filtro de búsqueda; todo
proceso que añade un producto a un documento lleva buscador de producto que rellena la línea).
Solo se tocó lo que ya existía y funcionaba; lo inexistente (Albaranes) NO se tocó.

### ✅ Filtro de búsqueda añadido a las listas que no lo tenían — HECHO (2026-06-03)
- **Categorías**, **Grupos de clientes**, **Compras (registro)** y **Descuentos** (cupones y
  automáticos, una caja por tabla): filtro cliente sobre el array ya cargado, mismo patrón que
  stock/proveedores/facturas.
- **Devoluciones**: la lista es server-rendered → filtro DOM sobre las filas (`tr.frow`).
- (Ya tenían buscador y se dejan intactos: Productos, Pedidos, Facturas, Clientes, Stock, Proveedores.)

### ✅ Buscador de producto en creación de documento — HECHO (2026-06-03)
- **Factura** (`/admin/invoices/new`): se elimina el doble campo (select de servicios + input).
  Ahora **un solo campo** de línea que es buscador del **catálogo completo** (físico/digital/servicio,
  por nombre o SKU) o texto libre. Al elegir un producto rellena descripción, precio e **IVA según
  su BANDA** (`p.tax_rate`, resuelto desde `core/vat-bands.js`); cantidad e IRPF quedan editables (CANON).
- **Compra** (`/admin/purchases/new`): el `<select>` de producto pasa a **buscador-autocompletado**
  que rellena la línea (y el coste con el precio del producto). La línea de compra siempre es un
  producto del catálogo (mueve stock): no hay línea libre. Refactor a alta/baja por fila (append-only)
  para no resetear líneas previas; el cuerpo del POST (`product_id`/`quantity`/`unit_cost`) y el
  movimiento de stock quedan idénticos.

### ✅ Pedido (Borrador) = mismo campo que la factura + componente compartido — HECHO (2026-06-03)
- **Corrige una afirmación falsa de esta misma corrección:** se había dado por hecho que "Pedido/POS
  ya tenía buscador". El **POS** sí (tiles que filtran el catálogo, se deja intacto), pero el
  **Borrador de pedido** (`/admin/orders/draft/new`) usaba un `<select>` desplegable de todos los
  productos — no el campo único de la factura.
- Ahora el Borrador usa el **mismo campo único** que la factura: buscar en el catálogo completo
  (físico/digital/servicio, por nombre o SKU) y, al elegir, rellena nombre + precio + `product_id`
  oculto + selector de variante. Cantidad editable. "Solo buscador": cada línea debe resolver a un
  producto real (el pedido exige `product_id` y mueve stock); no hay línea libre.
- **Componente compartido nuevo** `modules/erp/views/line-search.js` (`lineSearchCellHtml` +
  `lineSearchScript` + punto de extensión `applyLinePick`): factura y pedido usan el MISMO buscador,
  sin dos implementaciones. La factura se refactorizó a este componente **sin cambiar comportamiento**
  (búsqueda, autorrelleno de IVA por banda, línea libre y totales idénticos — regresión verificada).
- **No se tocó** `posItemSchema`, `/api/erp/orders/draft`, totales ni el movimiento de stock del pedido.
- (Albarán no existe → se hará con su pilar.)

Archivos: `CANON.md`, `views/line-search.js`, `routes/{invoices,purchases,categories,clients,orders,discounts}.js`.

---

## ADELANTO FISCAL (fuera del orden de pilares) — Ciclo de vida de la factura: ANULAR y RECTIFICAR — ✅ HECHO (2026-06-04)

Adelanto fiscal necesario: en España no se puede vender software de facturación si una
factura emitida no se puede ni anular ni corregir (bloqueo legal). No entra en el orden de
pilares; Cliente/Pilar 2 (T4) y Cobros quedan en pausa. El flujo pedido→albarán→factura es
Ventas/Pilar 4 y NO entra aquí. En España el único mecanismo legal de corrección es la
**FACTURA RECTIFICATIVA** (nada de notas de crédito/débito: eso es LATAM, vía proveedor externo).

**Regla de oro fiscal respetada:** una factura emitida NUNCA se edita ni se borra (rompería la
cadena de hash). Anular y rectificar son **asientos nuevos enlazados** en la cadena; la original
solo cambia su `status` (campo fuera del hash, así que marcarla no altera su `verifactu_hash`).
Núcleo del hash (`calcHash`/`getPrevHash`/`getNextSeq`) intacto: solo se añaden asientos.

- **ANULAR** (factura que nunca debió existir): asiento nuevo en tabla `invoice_anulaciones`,
  hash-enlazado al hash de la original (`prev_hash = original.verifactu_hash`); pide motivo; marca
  la original `anulada`. No consume número de factura. La fila original queda intacta.
- **RECTIFICATIVA** (operación real con datos/importes mal): factura NUEVA en **serie propia 'R'**
  (`company_config.rectificative_series`, R2026-NNNN) con su propia numeración y cadena de hash, que
  referencia a la original (`rectifies_invoice_id`) y registra **tipo R1–R5** + **modalidad S/I**.
  Marca la original `rectificada`. **Soporta importes negativos (abono)** para devoluciones.
- **UI**: en listado y ficha, botones **Anular** (pide motivo) y **Crear rectificativa**; el
  formulario de rectificativa va precargado desde la original (líneas, tipo R, modalidad, botón
  "invertir signos" para abono) con numeración propia; estado (emitida/rectificada/anulada) visible.
- **Fuera de alcance (Verifactu, tarea aparte pendiente):** QR + leyenda VERI*FACTU y envío a la AEAT.
  Aquí solo lógica local de documentos + estados + enlace en la cadena de hash.
- Verificado: migración aditiva sobre BD real (12 facturas intactas, filas previas `record_type='alta'`),
  `node --check`, reinicio + logs limpios, y **test de lógica 25/25** (anular: original byte-idéntica salvo
  status + cadena válida + no re-anulable; rectificativa por diferencias: serie R, referencia, original
  rectificada; abono negativo: −300/−63/−363; nada borrado). Gate de navegador ✅. Commit `37609f7`.

Archivos: `models.js`, `schemas.js`, `routes/invoices.js`, `CANON.md`, `TABLERO.md`.

---

## PILAR 2 — CLIENTE — ✅ CERRADO (2026-06-08)

A quién vendes (CANON §2). Se construye sobre lo que ya existe (auditoría hecha 2026-06-03):
el cliente está bien enganchado a pedidos/facturas, pero arrastra herencia e-commerce, no
cumple las reglas de diseño aplicadas a Productos, borraba en duro, y le falta la pieza
nuclear para un autónomo (cobros / pendiente de pago). Desglose en 5 tareas:

- **T1 — Sanear el módulo. ✅ HECHO (2026-06-03).** Archivar en vez de borrar (soft-delete + lista `active=1`; selector de cliente en factura/POS/borrador no ofrece archivados); quitado el opt-in de newsletter del formulario (solo UI; columna y `newsletter_subscribers` intactas); ocultado el % de descuento de grupos (solo UI; columna `discount_pct` y join de analítica intactos); NIF de cliente único (helper reutilizable `fiscalIdConflict` en API POST/PUT y DISA create/edit_client, normaliza trim+UPPER, vacío no bloquea). + Regla de integridad "sin duplicados" añadida a CANON §5. Verificado: lógica (1 y 4) por test 13/13 + SQL; visuales (2 y 3) en navegador.
- **T2 — Lista con buscador + filtro + paginación. ✅ HECHO (2026-06-03).** Lista de `/admin/clients` server-rendered (espejo de P4): `?q=&archivados=&page=`, `LIKE` sobre **nombre y `fiscal_id`**, `COUNT` aparte + `LIMIT/OFFSET`, 25/pág con Anterior/Siguiente y mensaje "No se encontraron clientes". Filtro de **estado** (Activos por defecto / Archivados, auto-submit al cambiar) en vez del filtrado client-side. En filas archivadas, botón **Restaurar** → ruta nueva `POST /api/erp/clients/:id/restore` con guarda de NIF (reutiliza `fiscalIdConflict` de T1: bloquea si ya hay un activo con ese NIF — archivar libera el NIF). Ajustes mínimos al quitar el array en memoria: editar por fetch, `location.reload()` tras guardar/archivar/restaurar, opciones de Grupo server-render. Sin tocar Productos, POS, facturación ni los selectores de cliente. Verificado: test de lógica 11/11 (búsqueda nombre/NIF, paginación 26–50, filtro archivados, restaurar + guarda) + navegador.
- **T3 — Campos de gestión del cliente. ✅ HECHO (2026-06-03).** 4 columnas nuevas en `clients` vía `addCol` (patrón de `active`, corre por tenant): `client_type` (particular|empresa, default particular), `irpf_rate` (REAL, default 0), `payment_term_days` (INTEGER, default 0 = contado), `payment_method` (transferencia|efectivo|tarjeta|domiciliacion, default ''). Filas antiguas → particular/0/0/'' (seguro, nunca retención por sorpresa). Sección "Gestión / Datos fiscales" en formulario y ficha; **Particular oculta y fuerza IRPF a 0**, Empresa lo muestra editable. API POST/PUT y DISA create/edit_client guardan los campos con esa regla; **solo se guarda el dato — el cálculo de IRPF es de Ventas**. Limpieza e-commerce (solo UI, columnas intactas): quitado `total_spent` de la ficha y de la lista (ahora ordena por `name`). Guarda de NIF único (T1) intacta. Verificado: test de lógica 8/8 + migración en BD real (8/8 filas) + navegador.
- **T4 — Ficha útil con facturas reales / motor de cobros.**
  - **Paso 1 — Motor de cobros + las 3 pantallas que lo leen. ✅ HECHO (2026-06-04).** Tabla nueva `invoice_payments` (cobros totales/parciales; una factura, varios cobros) + columna `invoices.due_date` **guardada** al emitir (= emisión + `payment_term_days` del cliente; backfill una vez; fuera del hash). Motor `modules/erp/cobros.js` con **estado de cobro siempre en vivo** (cobrado=Σcobros, pendiente=total−cobrado, estado pendiente/parcial/cobrada/vencida + días vencida y tramo 0-30/30-60/+60), regla fiscal **de qué cuenta como deuda** (`countsAsReceivable`/`isCobrable`: anulada no; rectificada por **sustitución** no, por **diferencias** sí; abono negativo resta) y agregados por cliente (`clientDebt`) y global (`openDebts`). **Tres ubicaciones** que registran cobro con un **único endpoint** `POST /api/erp/invoices/:id/payments` y un **modal compartido** `views/cobro-modal.js` (patrón line-search): (a) **factura** (listado, modal Cobrado/Pendiente + historial + alta), (b) **sección "Cobros"** nueva en el menú (torre de control: "Te deben X €" + deudas vivas de todos los clientes ordenadas por más vencida), (c) **ficha de cliente** (su tabla de facturas con estado + "Te debe X" + deuda más antigua). Doble seguro: backend rechaza cobrar anulada/sustituida/abono (400); el botón usa el mismo flag `isCobrable`. El **PDF de la factura no lleva nada de cobros**. Verificado: migración sobre BD real (facturas intactas), lógica 14/14, sección Cobros 10/10, tres-sitios 11/11, `node --check`, navegador. Commit `069d56f`.
  - **Paso 2 — Perfiles de cobro + próxima acción + voz de DISA. ✅ HECHO (2026-06-08).** Columna `clients.collections_profile` (suave/estandar/firme/manual, default estandar, aditiva) + tabla nueva `collection_actions` por tenant (recordatorio_email/contacto_manual/promesa_pago, con etapa, nota, promised_date, soft-delete `active`). Motor ampliado en `cobros.js`: **cadencias fijas por perfil** (días tras vencimiento), `calcularProximaAccion` (cobrada→null, manual→informa, promesa viva pospone, promesa incumplida reanuda y sube el tono, resto = siguiente paso de cadencia pendiente), `priorizarCobros` (en_riesgo>firme>r2>r1>promesa>por_vencer → días vencida → importe, con motivo explicable) y `collectionsWorklist`. **Plantillas de email por tono** (amable/firme-medio/formal/última) server-side vía **Resend** (`core/mailer.js`), precargadas y **editables** en el modal (confirm-first, cero envío automático). Endpoint nuevo `POST /api/erp/invoices/:id/collection-actions` (servicio único `registerCollectionAction`, reusa el doble seguro `isCobrable` → 400 sobre factura no viva). **Tres superficies** con la misma próxima acción y el mismo componente (modal "Gestión de cobro" en `cobro-modal.js` extendido): Cobros como **pipeline priorizado**, ficha de cliente con próxima acción + historial + **selector de perfil**, listado de facturas con badge de etapa. **DISA**: lee el worklist priorizado en su contexto y ejecuta `register_collection_action` por el endpoint validado (no INSERT directo, confirm-first). Verificado: lógica 47/47, migración sobre BD real (13 facturas/3 cobros intactos, 8 clientes→estandar), `node --check`, navegador. Commit `c36c377`.
  - **Paso 2.1 — Gestión de cobro a nivel de CUENTA del cliente. ✅ HECHO (2026-06-08).** Además del "Gestionar" por factura, **"Gestionar cuenta"** actúa sobre TODAS las facturas vivas a la vez. Sin tabla nueva (columna aditiva opcional `account_batch_id` en `invoice_payments` y `collection_actions` para trazar el lote). Motor: `resumenCuentaCliente` (deuda total + facturas vivas priorizadas; etapa/próxima acción **heredadas de la factura más grave**; perfil = el del cliente), `repartoAutomatico` (más antigua primero; sobrante sin asignar si se salda todo), `validarRepartoManual` (suma == importe al céntimo, ninguna por encima de su deuda), `registerAccountAction` (recordatorio = **UN** email con total+desglose + 1 acción por factura; promesa pospone todas; cobro materializa un `invoice_payment` por factura según reparto, en transacción; reusa `isCobrable`). Endpoint `POST /api/erp/clients/:id/account-actions` (+ GET account-summary / account-email-preview). UI: mismo modal compartido en **modo cuenta** (recordatorio editable, promesa, cobro a cuenta Auto o Manual con contador "asignado X / total Y" que no deja enviar hasta cuadrar). DISA: contexto "COBROS POR CUENTA" + `register_account_action` por el mismo servicio (confirm-first). Verificado: lógica 46/46 (incl. caso límite de descuadre y conservación al céntimo) + regresión Paso 2 47/47, migración aditiva sobre BD real (datos intactos), `node --check`, navegador. Commit `c36c377`.
- **T5 — DISA sobre clientes. ✅ HECHO (2026-06-08).** Las acciones de cliente de DISA pasan por un **servicio validado compartido** (`createClientSvc`/`updateClientSvc`/`archiveClientSvc`/`restoreClientSvc` en `clients.js`) que usan TAMBIÉN las rutas del formulario: una sola fuente de verdad, misma validación `clientSchema` y misma guarda de NIF único (T1). **Cero escritura directa de DISA a la base**: `clients` fuera de `WRITABLE_TABLES` (no se puede escribir por el genérico `insert_record`), y las 4 acciones en `ADMIN_ONLY_ACTIONS`. **Búsqueda/identificación** (`searchClients` + `GET /api/erp/clients/search`): índice de clientes inyectado en el contexto de DISA → responde consultas ("clientes en Madrid", "ficha de X") y, antes de cualquier acción, **resuelve el nombre a un `client_id`** (uno→sigue / varios→pregunta / ninguno→ofrece crear confirm-first y continúa). **Pedidos con cliente**: `create_order` exige y enlaza `client_id` (sin cliente identificado, NO se crea el pedido → cero huérfanos). **Valores de lista cerrada** (`client_type`, `payment_method`) inyectados desde el propio `clientSchema` (`clientFieldOptions`, fuente única) con instrucción de no inventar y dejar en blanco si no encaja (p. ej. "contado" = plazo, no forma de pago). Sin migración (cero columnas nuevas). Verificado: lógica 32/32 (servicio, búsqueda, paridad de edición parcial, enlace de pedido, lista cerrada + caso "contado"), regresión Paso 2 47/47 y Paso 2.1 46/46, `node --check`, navegador. Fuera de alcance (respetado): refactor de numeración `Math.random` de `create_order` y `create_product` (banda de IVA) — ambos de otro pilar. Commit `85ed44d`.

**Con T5 cerrado, el PILAR 2 — CLIENTE queda completo (T1–T5).**

## PILAR 3 — INVENTARIO — 🟡 EN CURSO (2026-06-08)
Compras, Stock, Proveedores, Devoluciones, Descuentos. Qué tienes y de dónde sale. Incluye **multi-almacén** como pieza de peso (CANON §6): preparado en datos, UI más adelante.

- **Paso 1 — Cimiento de stock unificado (versión D). ✅ HECHO (2026-06-08).** El stock deja de ser un número que se pisa: pasa a ser la **SUMA de un libro append-only** `stock_movements` (con signo); `products.stock` queda como **caché derivada** (siempre = suma, vía `recomputeStock`) para que el POS siga rápido. Un movimiento es **inmutable**: para corregir un error manual se crea otro que lo **revierte** (mismo type, signo opuesto, `reverses_movement_id`; "revertido" se deriva por consulta). Motor `modules/erp/stock.js` (vocabulario cerrado: tipos apertura/entrada/salida/ajuste/transferencia, motivos de ajuste, orígenes opening/order/purchase/manual/reversal/legacy). **Migración unificadora** (aditiva, idempotente): tabla `warehouses` (+ "Almacén principal"), `stock_movements`, import de las 9 filas de `inventory_movements` con signo, **aperturas baseline** (= stock heredado − Σ legacy) para que SUMA(libro)==`products.stock` el día 1, y la tabla vieja **archivada** a `inventory_movements_legacy` (no se borra). **Reenrutados los escritores vivos** (autorizado): POS, reserva/cancelación de borrador, cancelación de pedido (origin `order`) y recepción de compra (origin `purchase`) → al libro; crear producto físico con stock inicial → `apertura`. Quitados todos los `UPDATE products SET stock` directos. **Endpoints** (único camino de escritura): `POST /api/erp/products/:id/stock/adjust` (400 si no físico), `GET /api/erp/products/:id/stock` (kardex), `POST /api/erp/stock/movements/:id/reverse` (400 si ya revertido), doble seguro en backend. **Superficies** (componente compartido `views/stock-modal.js`): `/admin/inventory` reescrito (físicos + stock + Ajustar/Kardex) y sección Stock en la ficha de producto físico (kardex con saldo + origen + revertir); service/digital sin stock. Solo `'apertura'`/`'ajuste'`/reversiones se crean en este paso (`'entrada'`/`'salida'` ya en uso por el reenrutado; `'transferencia'` definido sin uso). Verificado: lógica 34/34, migración sobre copia real con **cuadre producto a producto** (7 físicos: heredado==libro==caché; 9 legacy archivadas; 7 aperturas), smoke de reenrutado (venta/cancelación/compra cuadran), `node --check`, navegador (incl. POS reintegrado al menú). Commit `e9b7732`.
- **Paso 2 — Saneamiento de Proveedor (espejo del T1 de Clientes). ✅ HECHO (2026-06-09).** `suppliers` gana `fiscal_id` (NIF/CIF), `address`, `city` y `active` (addCol). **Archivar en vez de borrar** (soft-delete + lista con filtro Activos/Archivados + Restaurar); el selector de proveedor (Compras, ficha de producto) solo muestra activos. **Guarda de NIF único GLOBAL** (`supplierFiscalIdConflict`): un proveedor archivado **sigue reservando su NIF** (al crear/editar con el NIF de un archivado → bloquea y sugiere restaurar). `requirePerm` en todas las rutas (read/create/edit/delete + restore). CANON §5 corregido: "proveedor→NIF/CIF" (antes "→nombre"). Verificado: lógica 18/18 + migración real (datos intactos) + navegador.
- **Paso 3 — Código interno autogenerado (Cliente · Proveedor · Producto). ✅ HECHO (2026-06-09).** Identificación interna `CLI-/PROV-/PROD-NNNN` (4 cifras, crece a 5+ sin romper) — **no** es guarda de duplicados (eso es NIF/SKU). Motor `modules/erp/codes.js` (contador por tipo y por tenant, transaccional). Migración: tabla `code_counters` + addCol `client_code`/`supplier_code`/`product_code` + **backfill** idempotente en orden de id. Asignado al crear (cliente vía `createClientSvc`, proveedor y producto en su POST, y en las altas de DISA), **no editable**; el SKU del producto queda intacto. Mostrado en solo lectura en listado y ficha de los tres. Verificado: lógica 25/25 + migración real (10/3/9 filas codificadas, contadores cuadran, datos intactos) + navegador.
- **Paso 4 — Motor de Compras (recibir mercancía mueve el stock). ✅ HECHO (2026-06-09).** Estado **pendiente → recibida**: al recibir, el stock sube en el libro (`entrada +`, origen compra). **Cancelar** una recibida → movimiento **inverso** (`salida −`, mismo origen; la compra queda `cancelled`, no se borra); cancelar una pendiente solo cambia estado. Servicios testables `receivePurchaseSvc`/`cancelPurchaseSvc` + endpoints `POST /api/erp/purchases/:id/receive` y `/cancel`; botones Recibir/Cancelar en la ficha. Almacén siempre el por defecto (multi-almacén llega después). **Limpieza** de las 4 compras rotas heredadas (sin líneas): columna aditiva `purchases.archived` + filtro `archived=0` (no se borran). Fuera de alcance respetado: coste/valoración intacto. Verificado: lógica 29/29 + cuadre sobre copia real (4 rotas archivadas, recibir/cancelar cuadran producto a producto, datos intactos) + navegador.
- **Paso 5 — Coste medio ponderado (WAC) + valoración de inventario. ✅ HECHO (2026-06-09).** El inventario gana **coste**: hasta ahora el único coste real era `purchase_items.unit_cost` y nunca llegaba al producto. Ahora `stock_movements` gana `unit_cost` (REAL NULL = coste de las unidades de ESE movimiento; entrada de compra → coste de la línea; salidas/aperturas/legacy/ajustes/reversiones → NULL, que el WAC cuenta como **coste 0**) y `products` gana `average_cost` (REAL, **caché derivada** como `stock`, nunca a mano). `recomputeStock` (mismo punto único que mantiene `products.stock`) recalcula además el **coste medio ponderado** releyendo el libro en orden: entrada con coste → `avg=(qty·avg+mov·coste)/(qty+mov)`; entrada sin coste → cuenta como 0; salida → el medio NO cambia; al vaciar (qty≤0) → el medio vuelve a 0. Como va dentro de `recordMovement`, **todos** los escritores quedan cubiertos sin tocarlos uno a uno. **Recepción de compra** (`receivePurchaseSvc` + alta directa) propaga el `unit_cost` de la línea; **cancelación** revierte solo la cantidad (salida con coste NULL; el medio se reajusta solo). **El coste NO se introduce a mano** (sin input en el formulario de producto): se gana desde las compras. **Migración aditiva** (`migration_inventory_cost_2026_v1`, idempotente, una vez por tenant): backfill del `unit_cost` de las entradas de compra existentes desde `purchase_items` (media ponderada por cantidad si varias líneas del mismo producto/compra) + recálculo de `average_cost` de todos los productos; las compras guardadas **no se tocan**. **Autorrelleno** de la línea de compra corregido: "Coste unitario" se rellena con el **último coste de compra** del producto (en blanco si nunca se compró), **nunca** el precio de venta. **Mostrar**: "Coste medio" en solo lectura en la ficha del producto físico; `/admin/inventory` con coste medio + valor (stock×coste medio) por producto y total **"Valor del almacén"** = Σ(stock×coste medio) — valoración a **coste**, no a precio de venta. **Bug latente de CSS arreglado de paso**: el desplegable del buscador de la línea de compra (`position:absolute`) lo recortaba `.table-wrap{overflow-x:auto}` (que computa `overflow-y:auto`) → `overflow:visible` en esa tabla concreta (no en la clase global); diagnóstico y arreglo **verificados en Chromium real** (`elementFromPoint`: no clicable → clicable). Margen por venta queda fuera (es de Pilar 4). Verificado: lógica WAC 19/19, regresión stock 34/34 y compras 29/29, migración sobre copia de la BD real (columnas, datos intactos, backfill, `average_cost` recalculado, "Valor del almacén" cuadrado a mano), navegador real (Puppeteer) para el desplegable + gate visual.
### PILAR 3 · COMPRAS — pendientes en orden (tras coste/valoración):

```
[ ] C1 · Orden de compra → recepción con diferencias
    - Orden de compra OPCIONAL (la recepción sigue siendo el evento base;
      se puede comprar directo sin orden).
    - Estados: orden enviada al proveedor → recepción real.
    - La recepción puede diferir de la orden en cantidad y/o precio; se
      registra lo realmente recibido (eso es lo que mueve stock y fija coste).
    - Encaja sobre el motor de compras actual (pendiente→recibida ya existe).

[ ] C2 · Captura de factura de proveedor por foto/PDF (DISA)
    - Subir foto o PDF; DISA extrae proveedor, líneas e importes.
    - Cuadre con catálogo y proveedor existentes; confirmar/corregir antes
      de guardar (confirm-first, nunca insert directo).
    - Aterriza creando/rellenando una recepción (depende de C1).
```

- **Siguiente (resto, por detallar):** reservado vs. disponible, multi-almacén en UI + transferencias, devoluciones, y voz de DISA sobre stock/compras.

## PILAR 4 — VENTAS
_(por detallar)_ — Pedido → Albarán / nota de entrega → Factura. Usa los tres pilares anteriores. Aquí entran: **PDF real de la factura**, **enviar factura por email** y **sello Verifactu (QR + leyenda)**.
- **Pedidos multi-línea (DISA `create_order`).** Hoy `create_order` solo admite **un producto por pedido** (limitación heredada de la base de e-commerce). Los pedidos multi-línea entran al construir Ventas, junto con el flujo pedido→albarán→factura. No se tocó en T5 (allí solo se enlazó `client_id`). Ref: `modules/disa/index.js`, acción `create_order`.

---

## TRANSVERSAL (fuera del orden de pilares) — SISTEMA DE DISEÑO + SANEAMIENTO VISUAL — 🔵 REGISTRADA (no iniciar hasta indicación)

> Tarea PROPIA del roadmap (no un pendiente suelto menor), por su impacto en el **diferencial** del
> producto. Registrada ahora; **no se construye nada todavía** — seguimos a mitad del Pilar 2. Se aborda
> cuando se indique. La pieza 1 manda sobre la 2 (ver REGLA).

**Problema (palabras del dueño del producto).** La UI ha crecido "metiendo cada función donde cabía", sin
criterio estético: pantallas recargadas, sin jerarquía, que "se ven feas" y poco profesionales. Choca
directamente con la estrella polar de CANON ("si no se siente fácil, está mal diseñado aunque funcione").
**No es un retoque cosmético: es deuda contra el diferencial del producto.**

**Referencia de estilo.** Minimalismo tipo **Claude / iOS**: pocos elementos a la vista, jerarquía clara,
mucho aire, lo secundario oculto hasta que se necesita.

**Enfoque en dos piezas, EN ESTE ORDEN:**

1) **CREAR `DISEÑO.md`** en el repo = la **fuente de verdad visual** de Bamburu, equivalente a lo que
   `CANON.md` es para la estrategia. Debe definir, como mínimo:
   - **Principios:** minimalismo, jerarquía visual, espacio en blanco, ocultar lo secundario.
   - **Botones:** UN solo botón primario por pantalla; las acciones secundarias agrupadas/ocultas (menú
     "…" o similar), nunca esparcidas "donde quepan".
   - **Densidad:** límite de cuánta información se muestra de golpe por pantalla; lo demás, progresivo
     (expandibles, secciones, segundo nivel).
   - **FONDO CLARO como estándar** (decisión del dueño): el fondo oscuro actual no se considera profesional
     para un software de gestión/facturación → se cambia a fondo claro y aireado. Mantener
     accesibilidad/contraste.
   - **Tokens ya definidos del proyecto:** tipografía **Inter**; acento **teal #0D9488**; fondos claros;
     esquinas redondeadas suaves; escala de espaciado de **4px**.
   - **Consistencia entre pantallas:** mismos patrones de lista, ficha, modal y tabla en todo el ERP.

2) **PASADA DE SANEAMIENTO VISUAL** de lo ya construido aplicando ese `DISEÑO.md`, empezando por las
   pantallas más recargadas (**ficha de cliente** y **sección Cobros**). Es el equivalente visual al
   saneamiento de datos que fue T1. **Solo presentación:** no cambiar lógica, datos, endpoints ni
   comportamiento.

**REGLA:** la pieza 1 manda. Sin las reglas escritas, el saneamiento (pieza 2) vuelve a salir a ojo y
desigual. **No empezar por la 2.**

---

## Contexto heredado (era anterior — código que SE QUEDA)

La era previa ("facturación de servicios") dejó código que funciona y no se tira; solo se retira su plan:
- **Hecho y vivo:** crear factura sin pedido (A1), IVA múltiple por línea + IRPF (A2), y el catálogo de servicios suelto (A3).
- **A3 absorbido en P3 (hecho):** los servicios son ahora productos de tipo "servicio"; su tabla/pantalla/API se eliminaron.
- **Lo que quedaba pendiente de esa era no se pierde, se reubica en el PILAR 4 (Ventas):** PDF real de la factura, envío por email y Verifactu (QR + leyenda).

---

## Pendientes técnicos (deuda rastreable)
- **DISA `create_product`: exigir banda de IVA.** Hoy hace `INSERT INTO products` directo (NO vía API) sin banda → el producto nace en **General/21 por el DEFAULT de la columna, sin elección explícita**. La API ya lo exige; DISA no. **Cerrar al reenfocar DISA** (no se parchea ahora: esa acción se reescribe entonces y el parche se tiraría). Ref: `modules/disa/index.js`, acción `create_product`.
- **DISA `create_order`: un solo producto por pedido.** Limitación heredada de la base de e-commerce; los pedidos multi-línea entran con **Pilar 4 — Ventas** (flujo pedido→albarán→factura). En T5 solo se enlazó `client_id`. Ref: `modules/disa/index.js`, acción `create_order`.

---

## Notas
- Una tarea "EN CURSO" a la vez (RITUAL). **Pilar 1 — Producto: CERRADO** (P1+P2, P2.1, P2.2, P3 y P4 hechos). Hecha además la **corrección transversal de buscadores/filtros** (2026-06-03). **Pilar 2 — Cliente: CERRADO (2026-06-08)** — T1 (saneamiento) ✅, T2 (lista) ✅, T3 (campos de gestión) ✅, **T4** (Paso 1 motor de cobros, Paso 2 perfiles+próxima acción+DISA, Paso 2.1 gestión de cuenta) ✅ y **T5** (DISA sobre clientes por servicio validado + identificación + pedidos con cliente) ✅. **Siguiente: Pilar 3 — Inventario** (por detallar). Pendiente transversal registrado pero NO iniciado: **Sistema de diseño + saneamiento visual**.
- Este orden y alcances no son sagrados (CANON §3): si al construir algo no cuadra, se cambia.
