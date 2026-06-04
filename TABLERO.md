# TABLERO — Bamburu

> Plan de trabajo. La estrategia manda desde CANON.md; el ritual desde RITUAL.md.
> Estructura: 4 pilares en ORDEN DE CONSTRUCCIÓN — Producto → Cliente → Inventario → Ventas
> (Ventas necesita los otros tres ya hechos; ver CANON §3).
> REGLA DE ORO: una sola tarea "EN CURSO" a la vez. Terminar antes de empezar otra.
> Última actualización: 2026-06-04

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

## PILAR 2 — CLIENTE — 🟡 EN CURSO (EN PAUSA durante el adelanto fiscal)

A quién vendes (CANON §2). Se construye sobre lo que ya existe (auditoría hecha 2026-06-03):
el cliente está bien enganchado a pedidos/facturas, pero arrastra herencia e-commerce, no
cumple las reglas de diseño aplicadas a Productos, borraba en duro, y le falta la pieza
nuclear para un autónomo (cobros / pendiente de pago). Desglose en 5 tareas:

- **T1 — Sanear el módulo. ✅ HECHO (2026-06-03).** Archivar en vez de borrar (soft-delete + lista `active=1`; selector de cliente en factura/POS/borrador no ofrece archivados); quitado el opt-in de newsletter del formulario (solo UI; columna y `newsletter_subscribers` intactas); ocultado el % de descuento de grupos (solo UI; columna `discount_pct` y join de analítica intactos); NIF de cliente único (helper reutilizable `fiscalIdConflict` en API POST/PUT y DISA create/edit_client, normaliza trim+UPPER, vacío no bloquea). + Regla de integridad "sin duplicados" añadida a CANON §5. Verificado: lógica (1 y 4) por test 13/13 + SQL; visuales (2 y 3) en navegador.
- **T2 — Lista con buscador + filtro + paginación. ✅ HECHO (2026-06-03).** Lista de `/admin/clients` server-rendered (espejo de P4): `?q=&archivados=&page=`, `LIKE` sobre **nombre y `fiscal_id`**, `COUNT` aparte + `LIMIT/OFFSET`, 25/pág con Anterior/Siguiente y mensaje "No se encontraron clientes". Filtro de **estado** (Activos por defecto / Archivados, auto-submit al cambiar) en vez del filtrado client-side. En filas archivadas, botón **Restaurar** → ruta nueva `POST /api/erp/clients/:id/restore` con guarda de NIF (reutiliza `fiscalIdConflict` de T1: bloquea si ya hay un activo con ese NIF — archivar libera el NIF). Ajustes mínimos al quitar el array en memoria: editar por fetch, `location.reload()` tras guardar/archivar/restaurar, opciones de Grupo server-render. Sin tocar Productos, POS, facturación ni los selectores de cliente. Verificado: test de lógica 11/11 (búsqueda nombre/NIF, paginación 26–50, filtro archivados, restaurar + guarda) + navegador.
- **T3 — Campos de gestión del cliente. ✅ HECHO (2026-06-03).** 4 columnas nuevas en `clients` vía `addCol` (patrón de `active`, corre por tenant): `client_type` (particular|empresa, default particular), `irpf_rate` (REAL, default 0), `payment_term_days` (INTEGER, default 0 = contado), `payment_method` (transferencia|efectivo|tarjeta|domiciliacion, default ''). Filas antiguas → particular/0/0/'' (seguro, nunca retención por sorpresa). Sección "Gestión / Datos fiscales" en formulario y ficha; **Particular oculta y fuerza IRPF a 0**, Empresa lo muestra editable. API POST/PUT y DISA create/edit_client guardan los campos con esa regla; **solo se guarda el dato — el cálculo de IRPF es de Ventas**. Limpieza e-commerce (solo UI, columnas intactas): quitado `total_spent` de la ficha y de la lista (ahora ordena por `name`). Guarda de NIF único (T1) intacta. Verificado: test de lógica 8/8 + migración en BD real (8/8 filas) + navegador.
- **T4 — Ficha útil con facturas reales / motor de cobros.**
  - **Paso 1 — Motor de cobros + las 3 pantallas que lo leen. ✅ HECHO (2026-06-04).** Tabla nueva `invoice_payments` (cobros totales/parciales; una factura, varios cobros) + columna `invoices.due_date` **guardada** al emitir (= emisión + `payment_term_days` del cliente; backfill una vez; fuera del hash). Motor `modules/erp/cobros.js` con **estado de cobro siempre en vivo** (cobrado=Σcobros, pendiente=total−cobrado, estado pendiente/parcial/cobrada/vencida + días vencida y tramo 0-30/30-60/+60), regla fiscal **de qué cuenta como deuda** (`countsAsReceivable`/`isCobrable`: anulada no; rectificada por **sustitución** no, por **diferencias** sí; abono negativo resta) y agregados por cliente (`clientDebt`) y global (`openDebts`). **Tres ubicaciones** que registran cobro con un **único endpoint** `POST /api/erp/invoices/:id/payments` y un **modal compartido** `views/cobro-modal.js` (patrón line-search): (a) **factura** (listado, modal Cobrado/Pendiente + historial + alta), (b) **sección "Cobros"** nueva en el menú (torre de control: "Te deben X €" + deudas vivas de todos los clientes ordenadas por más vencida), (c) **ficha de cliente** (su tabla de facturas con estado + "Te debe X" + deuda más antigua). Doble seguro: backend rechaza cobrar anulada/sustituida/abono (400); el botón usa el mismo flag `isCobrable`. El **PDF de la factura no lleva nada de cobros**. Verificado: migración sobre BD real (facturas intactas), lógica 14/14, sección Cobros 10/10, tres-sitios 11/11, `node --check`, navegador.
  - **Paso 2 — pendiente (tarea posterior):** perfiles de cobro + próxima acción + voz de DISA sobre cobros. (Fuera del Paso 1.)
- **T5 — DISA sobre clientes** (que sus acciones de cliente pasen por la API validada en vez de INSERT/UPDATE directo; añadir consulta/búsqueda de clientes; enlazar `client_id` en los pedidos que crea DISA — hoy quedan huérfanos de cliente). Mismo antipatrón ya fichado para `create_product`.

## PILAR 3 — INVENTARIO
_(por detallar)_ — Compras, Stock, Proveedores, Devoluciones, Descuentos. Qué tienes y de dónde sale. Incluye **multi-almacén** como pieza de peso (CANON §6): se aborda al construir Stock, no antes.

## PILAR 4 — VENTAS
_(por detallar)_ — Pedido → Albarán / nota de entrega → Factura. Usa los tres pilares anteriores. Aquí entran: **PDF real de la factura**, **enviar factura por email** y **sello Verifactu (QR + leyenda)**.

---

## Contexto heredado (era anterior — código que SE QUEDA)

La era previa ("facturación de servicios") dejó código que funciona y no se tira; solo se retira su plan:
- **Hecho y vivo:** crear factura sin pedido (A1), IVA múltiple por línea + IRPF (A2), y el catálogo de servicios suelto (A3).
- **A3 absorbido en P3 (hecho):** los servicios son ahora productos de tipo "servicio"; su tabla/pantalla/API se eliminaron.
- **Lo que quedaba pendiente de esa era no se pierde, se reubica en el PILAR 4 (Ventas):** PDF real de la factura, envío por email y Verifactu (QR + leyenda).

---

## Pendientes técnicos (deuda rastreable)
- **DISA `create_product`: exigir banda de IVA.** Hoy hace `INSERT INTO products` directo (NO vía API) sin banda → el producto nace en **General/21 por el DEFAULT de la columna, sin elección explícita**. La API ya lo exige; DISA no. **Cerrar al reenfocar DISA** (no se parchea ahora: esa acción se reescribe entonces y el parche se tiraría). Ref: `modules/disa/index.js`, acción `create_product`.

---

## Notas
- Una tarea "EN CURSO" a la vez (RITUAL). **Pilar 1 — Producto: CERRADO** (P1+P2, P2.1, P2.2, P3 y P4 hechos). Hecha además la **corrección transversal de buscadores/filtros** (2026-06-03). **Pilar 2 — Cliente: EN CURSO** — T1 (saneamiento) ✅, T2 (lista) ✅, T3 (campos de gestión) ✅ y **T4 Paso 1 (motor de cobros + sección Cobros + ficha de cliente)** ✅ hechas; siguiente: **T4 Paso 2** (perfiles de cobro + próxima acción + voz de DISA) o **T5 — DISA sobre clientes**.
- Este orden y alcances no son sagrados (CANON §3): si al construir algo no cuadra, se cambia.
