# DISEÑO.md — Bamburu

> La **fuente de verdad visual y estructural** de Bamburu. Lo que `CANON.md` es a la
> estrategia, esto es al aspecto y a *dónde vive cada cosa*. Si una pantalla contradice
> este documento, gana este documento (y se sanea, no al revés).
> Tarea de roadmap "Sistema de diseño + saneamiento visual" (TABLERO): PIEZA 1 (reglas + mapa,
> este archivo), PIEZA 2 (menú de /admin) y PIEZA 3 (saneamiento visual) **HECHAS el 2026-06-22**.
> El **patrón oro visual aprobado** es `docs/diseno/sistema-visual-aprobado.html` y está aplicado a
> toda la plataforma vía `modules/erp/layout.js` (chrome grafito `#20242F`, área clara, slate, cero teal).
> Última actualización: 2026-06-22

---

## 0. Qué es esto y qué NO es

- **Es** el manual de marca + el mapa de navegación: principios, tokens, estructura del
  menú y patrones comunes. Define **cómo se ve** y **dónde vive cada función**.
- **No es** un rediseño. Aquí no se toca ni una pantalla, ni el menú real
  (`modules/erp/layout.js`), ni un token del código. Eso es la PIEZA 2.
- **Nota de realidad:** el patrón oro visual (`docs/diseno/sistema-visual-aprobado.html`) está
  aplicado a toda la plataforma vía las piezas compartidas de `modules/erp/layout.js` (chrome
  GRAFITO OSCURO `#20242F`, área de trabajo clara, acento slate `#334155`, cero teal). El acento
  ya NO es teal y el área de trabajo ya NO es oscura. Este archivo y el patrón oro **coinciden**;
  si una pantalla se desvía, se sanea hacia el patrón oro, no al revés.

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

> **Fuente de verdad visual = `docs/diseno/sistema-visual-aprobado.html`** (patrón oro aprobado
> por Ibrahin el 22-jun-2026; sustituye al anterior `mockup-aprobado.html`). Los valores de abajo
> se leen de ese archivo carácter por carácter. Si algo choca, manda el patrón oro en lo visual.

### 2.1 Luz y "chrome"

- **Área de trabajo SIEMPRE en CLARO.** Fondo de aplicación `#F5F6F8`; superficies blancas `#FFFFFF`.
- **"Chrome" (barra superior + menú lateral) en GRAFITO AZUL OSCURO** (`#20242F`). Sobre ese fondo:
  texto inactivo `#9AA3B3`, texto activo `#FFFFFF`, icono inactivo `#727B8C`, título de grupo
  `#5B6475`, item activo = fondo `rgba(255,255,255,.10)` + texto blanco, divisor `rgba(255,255,255,.07)`.
  La marca (sparkles) va en blanco arriba del rail. El slate `#334155` es el **acento** del área de
  trabajo (botón primario, DISA), nunca el fondo del chrome.
- **Cero teal** en toda la app.

### 2.2 Fondos y superficies

| Token | Valor |
|---|---|
| Fondo de aplicación | `#F5F6F8` |
| Superficies / tarjetas / chrome / paneles | `#FFFFFF` |
| Subsuperficie (search, hover, sutil) | `#F1F3F5` |
| Borde fino interno (hairline 0.5px) | `#ECEEF1` |
| Borde exterior | `#E4E6EA` |
| Borde tarjeta de DISA | `#D6DCE4` |
| Divisor de fila en lista | `#F3F4F6` |

### 2.3 Texto

| Token | Valor |
|---|---|
| Texto principal | `#1A1D21` |
| Texto fuerte / activo | `#1E293B` |
| Texto cuerpo | `#374151` |
| Texto secundario | `#6B7280` |
| Texto terciario / etiquetas | `#9097A1` |
| Título de grupo de menú | `#A0A6B0` |
| Texto de item de menú | `#3F454F` |
| Icono de menú (inactivo) | `#8A909B` |

### 2.4 Acento (grafito azulado / slate)

Familia **`#334155` / `#1E293B`**. Es el acento (logo, borde izquierdo de la tarjeta de DISA,
botón primario, item de menú **activo** → fondo `#EDF0F4` + texto `#1E293B` + icono `#334155`,
aro del avatar `rgba(51,65,85,0.16)`). Con moderación: si aparece, es *la* acción o *el*
protagonista. **No hay teal.**

### 2.5 Colores de estado (píldoras del mockup)

| Estado | Fondo | Texto |
|---|---|---|
| Vencida / error | `#FEE2E2` | `#A32D2D` |
| Por vencer / aviso | `#FAEEDA` | `#854F0B` |
| Al día / neutro | `#EDF0F4` | `#1E293B` |

Iconos de acento de estado: alerta/peligro `#DC2626`, ámbar `#BA7517`, neutro `#6B7280`.
*(El mockup no define un verde de "éxito"; cuando haga falta —p. ej. "cobrada"— se usa un
verde sobrio de estado, coherente y discreto, sin teal.)*

### 2.6 Tipografía

- **Inter**, pesos **400 / 500 / 600** (como el mockup). Títulos, valores y logo a **600**;
  item activo y etiquetas a **500**; cuerpo a **400**. Jerarquía por tamaño, color y peso.

### 2.7 Esquinas y espacio · iconos

- Esquinas: **contenedor 14px**, **tarjetas/paneles 12px**, **controles/menú 9px**, **píldoras 20px**.
- Bordes **hairline 0.5px**. Padding de contenido del mockup ~20–22px.
- **Iconos: Tabler Icons** (línea, `ti ti-*`), como el mockup.

---

## 3. Estructura — el "ritual": cada cosa en su sitio

### 3.1 Reglas del menú y chrome (como el mockup)

- **Barra superior GRAFITO OSCURO** (`#20242F`) con: buscador, campana de avisos y **avatar**
  (`#3A4357`, arriba a la derecha). La marca va en el rail, no en la barra.
- **Menú lateral GRAFITO OSCURO** (`#20242F`), **colapsable**: por defecto iconos; al pasar el ratón
  se despliega y muestra las etiquetas. Marca (sparkles, blanca) arriba. Item activo = fondo
  `rgba(255,255,255,.10)` + texto blanco + icono blanco.
- **DISA es la HOME** (vive dentro de `/admin`): la pantalla de inicio ES DISA (saludo, propuesta de
  DISA, cifras del día, lista con píldoras y campo para hablarle). **No** es una entrada fija aparte.
- **Cuenta/Ajustes NO en el lateral:** en el **desplegable del avatar** — *Mi cuenta · Ajustes ·
  Datos del negocio · Documentación (`/docs`) · Cerrar sesión* (mapeados a las rutas reales).
- El **panel de superadmin** va por su **rol aparte**, fuera de este menú (`bamburu.com/superadmin`).

### 3.2 Mapa del menú (grupos → enlaces)

> Cada entrada apunta a su(s) **ruta(s) real(es)** del código (auditoría del Paso 0).
> Agrupado por el **ciclo del negocio**, no por "operación / datos". **Sin etiquetas de
> zona:** solo cuatro grupos (Ventas, Compras, Inventario, Catálogo), con **DISA fija
> arriba** e **Inicio** justo debajo. El cliente vive donde se vende (Ventas) y el
> proveedor donde se compra (Compras).

**· Inicio = DISA** (la home: saludo, propuesta de DISA, cifras del día, lista con píldoras y
campo para hablarle) → `/admin`. *(La conversación a pantalla completa sigue en `/admin/disa`,
accesible desde la home; ya no es una entrada fija del menú.)*

**VENTAS**
- Facturas → `/admin/invoices`
- Cobros → `/admin/cobros`
- TPV → `/admin/orders/pos`  · *(⚠ hoy corre sobre el clúster viejo `sales_orders` (D4);
  se mapea aquí, pero su destino real se decide en el Pilar 4)*
- Clientes → `/admin/clients`
- Grupos → `/admin/clients/groups`  *(función viva — el cliente y su agrupación son la
  materia de la venta)*
- *Reservados deshabilitados (existen hoy, sin ruta): **Albaranes** · **CRM**.
  Presupuestos y Pedidos no existen como ítems → no se muestran.*

**COMPRAS**
- Órdenes de compra → `/admin/purchase-orders`
- Compra directa → `/admin/purchases`
- Facturas recibidas → `/admin/supplier-invoices`
- Pagos a proveedores → `/admin/pagos`
- Devoluciones → `/admin/supplier-returns`
- Captura de factura → `/admin/purchases/capture`
- Proveedores → `/admin/suppliers`  *(la contraparte de la compra)*
- *(Recepciones no es entrada de menú: se crean desde la Orden de compra,
  `/admin/purchase-order-receipts/:id`.)*

**INVENTARIO**
- Stock → `/admin/inventory`  · *(Movimientos / kardex = **modal dentro de Stock**,
  `views/stock-modal.js`; no es entrada de menú)*
- Almacenes → `/admin/warehouses`
- Traslados → `/admin/stock-transfers`

**CATÁLOGO**
- Productos → `/admin/products`
- Categorías → `/admin/categories`

**Fuera del menú — bajo el avatar (Cuenta / Ajustes):**
- Empresa / Ajustes → `/admin/settings`
- Usuarios admin → `/admin/users`
- Seguridad / 2FA → `/admin/security`
- Cambiar contraseña → `/admin/change-password`
- Actividad (log) → `/admin/activity`  *(deja de colgar de "General")*

**Fuera de todo lo anterior:** Panel de **superadmin** (rol aparte) → `bamburu.com/superadmin`.

### 3.3 Regla de colocación (permanente)

Antes de añadir cualquier función nueva, preguntar: **"¿de qué parte del ciclo es —venta,
compra, inventario o catálogo?"** y colocarla en ese grupo. **Si no encaja en ninguno, NO
se fuerza:** se anota en "huérfanas / a decidir" y se deja para que lo decida el dueño.
**Nunca crear un grupo nuevo "donde quepa".**

---

## 4. DISA

- **Protagonista — DISA ES la home** (`/admin`): saludo personalizado + tarjeta de DISA
  proponiendo acciones del día + cifras + lista con píldoras + campo para hablarle.
- **Proactiva:** habla primero, propone (avisos del día), no espera órdenes (CANON §1, §5).
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
