# DISEÑO.md — Bamburu

> La **fuente de verdad visual y estructural** de Bamburu. Lo que `CANON.md` es a la
> estrategia, esto es al aspecto y a *dónde vive cada cosa*. Si una pantalla contradice
> este documento, gana este documento (y se sanea, no al revés).
> Esto es la **PIEZA 1** de la tarea de roadmap "Sistema de diseño + saneamiento visual"
> (TABLERO): las **reglas + el mapa**. La PIEZA 2 (rediseñar/sanear las pantallas por
> dentro) es otra tarea y **no se toca aquí**.
> Última actualización: 2026-06-22

---

## 0. Qué es esto y qué NO es

- **Es** el manual de marca + el mapa de navegación: principios, tokens, estructura del
  menú y patrones comunes. Define **cómo se ve** y **dónde vive cada función**.
- **No es** un rediseño. Aquí no se toca ni una pantalla, ni el menú real
  (`modules/erp/layout.js`), ni un token del código. Eso es la PIEZA 2.
- **Nota de realidad (deuda, no objetivo):** la UI de hoy todavía NO cumple este
  documento — el área de trabajo es oscura y el acento es *teal*. Esa divergencia ES la
  deuda que la PIEZA 2 vendrá a saldar. Este archivo describe el **destino**, no el estado
  actual.

---

## 1. Principio rector

**El iPhone del nicho** (CANON §0-bis, commit `6017a6d`). Una sola versión, fácil por
fuera y potente por dentro; la complejidad se **esconde hasta que hace falta**. El
estándar de validación de cualquier pantalla:

- **Si una pantalla necesita manual, está mal.** La facilidad es trabajo nuestro, no del
  usuario. Cada vez que haya que explicar algo, el fallo es de diseño y se rehace.
- **Densidad — un solo botón principal por pantalla.** Una sola acción primaria,
  destacada. Lo secundario va **agrupado o discreto** (menú "…", segundo nivel,
  expandibles), **nunca esparcido "donde quepa"**.
- **Mucho aire, poca cosa a la vista.** Jerarquía clara; lo de segundo nivel, oculto hasta
  que se pide. Referencia de estilo: minimalismo tipo **Claude / iOS**.

---

## 2. Identidad visual (tokens)

### 2.1 Luz y "chrome"

- **El área de trabajo SIEMPRE en claro.** Nunca tema oscuro en el contenido.
- **"Chrome"** (barra superior + menú lateral) en **grafito profundo `#20242F`**.
  Divisores sobre el chrome: **blanco al 6–8 % de opacidad**.

### 2.2 Fondos y superficies

| Token | Valor |
|---|---|
| Fondo de contenido | `#F8FAFC` |
| Superficies / tarjetas | `#FFFFFF` |
| Borde fino (tarjetas) | `#EDEFF2` |
| Borde exterior | `#E7E9ED` |

### 2.3 Texto

| Token | Valor |
|---|---|
| Texto principal | `#23262C` |
| Texto secundario | `#828B9B` |
| Sobre el chrome — inactivo | `#9AA3B3` |
| Sobre el chrome — activo | `#FFFFFF` |
| Sobre el chrome — iconos inactivos | `#727B8C` |

### 2.4 Acento de marca (grafito azulado)

Familia **`#3A4150` / `#20242F`**. Se usa **con MUCHA moderación**: el botón principal, la
barra de DISA y algún icono clave. No es un color decorativo: si aparece, es porque algo
es *la* acción o *el* protagonista.

> **Observación (no actuar):** el TABLERO (§ "Sistema de diseño") registraba un acento
> *teal `#0D9488`* como token previo. Este DISEÑO.md lo **sustituye** por la familia
> grafito azulado. No se cambia ningún token del código aquí; se reconciliará en la
> PIEZA 2.

### 2.5 Colores de estado (independientes del acento)

| Estado | Fondo | Texto |
|---|---|---|
| Vencido | `#FBEDEC` | `#A6453F` |
| Por vencer | `#FAF2E2` | `#8A6018` |
| Al día / neutro | `#EFF1F4` | `#3F4A5C` |

### 2.6 Tipografía

- **Inter**, y **solo pesos 400 y 500** (nada de 600/700).
- La jerarquía se hace con **tamaño y color**, no con negritas pesadas.

### 2.7 Esquinas y espacio

- Esquinas: **tarjetas 13px**, **controles 9–10px**, **píldoras 7px**.
- **Mucho aire:** rejilla de **4px**, padding de contenido **~24px**.

---

## 3. Estructura — el "ritual": cada cosa en su sitio

### 3.1 Reglas del menú

- **Menú lateral COLAPSABLE:** por defecto **solo iconos** (centrados); al pasar el ratón
  se despliega y muestra las etiquetas.
- **Sin logo** en la barra superior.
- **Cuenta y Ajustes NO son una sección del menú:** viven dentro del **menú del usuario**
  (avatar, arriba a la derecha).
- **DISA va FIJA y destacada ARRIBA del menú**, encima de la zona OPERACIÓN, **siempre
  visible** — es el protagonista, no una entrada más (ver §4).
- El **panel de superadmin** va por su **rol aparte**, fuera de este menú
  (`bamburu.com/superadmin`).

### 3.2 Mapa COMPLETO sección → submenú

> Cada entrada apunta a su(s) **ruta(s) real(es)** del código (auditoría del Paso 0). Los
> "huecos reservados" son del **Pilar 4 (Ventas)** y aún no existen como ruta.

**▸ DISA** *(entrada fija y destacada, arriba del todo — siempre visible)*
- Asistente IA → `/admin/disa`

**OPERACIÓN**
- **Inicio** (panel + DISA proactiva) → `/admin`
- **Ventas**
  - Facturas → `/admin/invoices`
  - Cobros → `/admin/cobros`
  - TPV → `/admin/orders/pos`  · *(⚠ hoy corre sobre el clúster viejo `sales_orders`
    (D4); se mapea aquí, pero su destino real se decide en el Pilar 4)*
  - *Huecos reservados (Pilar 4): Presupuestos · Pedidos · Albaranes*
- **Compras**
  - Órdenes de compra → `/admin/purchase-orders`
  - Recepciones → `/admin/purchase-order-receipts` *(se crean desde la orden)*
  - Compra directa → `/admin/purchases`
  - Facturas recibidas → `/admin/supplier-invoices`
  - Pagos a proveedores → `/admin/pagos`
  - Devoluciones → `/admin/supplier-returns`
  - Captura de factura → `/admin/purchases/capture`
- **Inventario**
  - Stock → `/admin/inventory`  · *(Movimientos / kardex = **modal dentro de Stock**,
    `views/stock-modal.js`; no es entrada de submenú)*
  - Almacenes → `/admin/warehouses`
  - Traslados → `/admin/stock-transfers`

**DATOS**
- **Catálogo**
  - Productos → `/admin/products`
  - Categorías → `/admin/categories`
- **Clientes** → `/admin/clients`  *(Grupos → `/admin/clients/groups`)*
  - *Hueco reservado (futuro): CRM*
- **Proveedores** → `/admin/suppliers`

**Fuera del menú — bajo el avatar (Cuenta / Ajustes):**
- Empresa / Ajustes → `/admin/settings`
- Usuarios admin → `/admin/users`
- Seguridad / 2FA → `/admin/security`
- Cambiar contraseña → `/admin/change-password`
- Actividad (log) → `/admin/activity`  *(deja de colgar de "General")*

**Fuera de todo lo anterior:** Panel de **superadmin** (rol aparte) → `bamburu.com/superadmin`.

### 3.3 Regla de colocación (permanente)

Antes de añadir cualquier función nueva, preguntar: **"¿esto es operar o es un dato?"** y
colocarla en su zona/submenú. **Si no encaja, NO se fuerza:** se anota en "huérfanas / a
decidir" y se deja para que lo decida el dueño. **Nunca crear un cajón nuevo "donde
quepa".**

---

## 4. DISA

- **Protagonista.** Entrada fija y destacada arriba del menú (§3.1), siempre visible.
- **Proactiva en el panel de Inicio:** habla primero, propone (avisos del día), no espera
  órdenes (CANON §1, §5).
- **Presentación consistente** en toda la plataforma: la misma cara de DISA donde aparezca
  (Inicio, su sección, y donde se invoque).

---

## 5. Documentos (factura, presupuesto, albarán, orden de compra, recepción, etc.)

- **SIEMPRE se abren DENTRO de la plataforma:** el documento dibujado a la **izquierda** +
  un **panel lateral a la derecha** con sus datos y acciones (cobrar, anular, rectificar,
  compartir, descargar PDF).
- **Descargar el PDF es UNA acción más, nunca la única forma de verlo.**
- **Todos los documentos comparten el mismo diseño** — se sienten iguales.
- **Coherente con la inmutabilidad:** la vista es de **solo lectura**; corregir crea un
  **asiento nuevo enlazado**, nunca edita el original (CANON §4 — anular / rectificar; la
  misma filosofía que el libro de stock).

---

## 6. Patrones comunes

- **Lista, ficha, modal y tabla: misma plantilla** — superficie blanca, bordes finos,
  padding generoso, **píldoras con los colores de estado** del §2.5.
- **Iconos:** estilo de **línea**, grosor consistente, **centrados** cuando el menú está
  colapsado.

---

## 7. Huérfanas — DOS destinos distintos (aquí solo se listan; NO se tocan)

> Salen del inventario del Paso 0 (TABLERO → Decisiones D1–D4). Tienen **final distinto**,
> por eso van separadas. **Cada destino es una tarea aparte con su propio encargo.** Aquí
> no se desmonta ni se archiva nada: solo queda registrado para que no se cuele en el mapa.

### 7.1 A ARCHIVAR / CERRAR (restos de e-commerce — D1 / D2 / D3)

| Pantalla / superficie | Ruta(s) | Decisión |
|---|---|---|
| Buzón de feedback | `/admin/feedback` | D2 |
| Newsletter / suscriptores | `/admin/newsletter` (+ `/export`) | D2 |
| Reseñas | `/admin/reviews` | D2 |
| Métodos de envío | `/admin/shipping` | D2 |
| Etiquetas / tags | `/admin/tags` *(montada, oculta del menú)* | D2 |
| Editor "Tienda Online" | `/admin/store-settings` + `/admin/settings/store` | D2 |
| Pestaña Imágenes de producto | `/admin/products/:id/images` *(oculta)* | D2 |
| Hoja "FACTURA" de pedido | `/admin/orders/:id/invoice` | D3 — no es la factura Verifactu |
| Tienda pública | `modules/store/` → `/store`, `/api/store` | D1 — cerrar con llave |

### 7.2 EN ESPERA DEL PILAR 4 (clúster `sales_orders` — funciones reales a rediseñar/decidir)

| Pantalla | Ruta(s) | Nota |
|---|---|---|
| Pedidos viejos (lista/ficha/borrador) | `/admin/orders` · `/:id` · `/draft/new` | D4 |
| Reembolsos | `/admin/orders/refunds` | D4 |
| Descuentos (cupones + automáticos) | `/admin/discounts` · `/auto` | D4 |
| Analítica → **Informes** | `/admin/analytics` (+ overview, best-sellers, exports…) | Sección REAL, **no** un resto; hoy lee el clúster viejo (D4) |

Notas de esta zona:
- **TPV** corre hoy sobre este mismo clúster, pero **se mapea en Ventas › TPV** (§3.2) con
  su aviso. Aquí se anota para no perder el dato.
- **Analítica NO es basura de e-commerce:** es una sección reservada — **Informes, en
  espera del Pilar 4** — porque su fuente de datos es el clúster que se va a decidir. No se
  le inventa un cajón activo ahora, pero queda claramente distinguida de lo que se archiva.

---

## 8. Observaciones registradas (no se actúa sobre ellas aquí)

- **Casa futura de Descuentos = VENTAS**, no Inventario. CANON §2 lo tiene hoy bajo
  Inventario por herencia; **no se corrige ahora** (sería un cambio de CANON aparte). Queda
  anotado para cuando se diseñe el Pilar 4.
- **Acento de marca:** sustituye al *teal* previo del TABLERO (ver §2.4). Reconciliación de
  tokens del código → PIEZA 2.
- **Movimientos / kardex** es un modal, no una ruta; si algún día se quiere como pantalla
  propia, pasa por la regla de colocación del §3.3 (¿operar o dato?).
