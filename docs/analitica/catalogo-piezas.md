# Catálogo de piezas de analítica — las 5 áreas

> **Qué es esto.** Las piezas con las que el **constructor del peldaño 4** dejará al dueño montar
> cualquier informe: **dimensiones** (sobre qué mirar) · **medidas** (qué medir) · **filtros** (por qué
> acotar). Modelo aprobado por el dueño (17 jul 2026). Escalera: `CANON.md` §4 · peldaño 3.
>
> **Estado: 91 piezas · 85 con dato hoy · 4 a habilitar · 2 con la columna vacía.**
>
> **Ninguna pieza sin dato se descarta** — se marca *a habilitar* con lo que haría falta.

## Cómo se lee

| Marca | Significa |
|---|---|
| **✓** | El dato existe hoy. La pieza es construible ya. |
| **⚠** | **A habilitar** — hoy no se guarda. Se dice qué haría falta. |
| **○** | La columna existe pero **está vacía**. No es un problema de esquema: es de captura. |

## Las reglas que mandan sobre todas las piezas

1. **El dinero, siempre sin IVA.** Se opera sobre la BASE. El IVA no es del negocio: es de Hacienda.
   Meterlo inflaría cualquier cifra con dinero que se va a devolver.
2. **Fuente única, sin duplicar la regla de conteo.** Lo que cuenta como venta lo decide
   `countingSalesInvoices` (`ventas-metrics.js`): **anuladas fuera · tickets sustituidos fuera ·
   rectificativas netean**. Ninguna pieza reimplementa esa regla con matices propios — si lo hiciera,
   dos informes darían cifras distintas y las dos parecerían ciertas.
3. **El beneficio reutiliza el coste congelado del peldaño 2** (`invoice_items.unit_cost`). No se
   recalcula el WAC. Lo que no tiene coste conocido **no es margen del 100 %**: se aparta.
4. **Mismos permisos por las dos puertas** (CANON §3-bis). Cada área va tras el permiso de su
   pantalla. **Una pieza que cruza áreas exige TODOS los permisos que toca.** Quien no ve un área por
   pantalla, no la saca por informe — si no, el informe sería la puerta de atrás del candado.

---

## VENTAS · 20/21 ✓
**Permiso:** `invoices.read` · **Fuente:** `ventas-metrics.js`

### Mirar por (dimensiones)
| Pieza | | De dónde sale |
|---|---|---|
| Cliente | ✓ | `invoices.client_id` (+ `client_name`, congelado al emitir) |
| Producto | ✓ | `invoice_items.product_id` — **lo trajo el peldaño 2**; antes la línea no sabía qué vendía |
| Categoría | ✓ | `products.category_id` vía `product_id` |
| Fecha (día/mes/trimestre/año) | ✓ | `invoices.issue_date` |
| **Vendedor / usuario** | **⚠** | Ningún documento guarda quién lo tecleó — ver *Piezas a habilitar* |
| Responsable | ✓ | **Nuevo (17 jul)** — cascada de tres, `ventasPorResponsable()` |
| Forma de pago | ✓ | `invoice_payments.payment_method` |
| Zona / provincia | **○** | `invoices.client_province` (congelada) · `clients.province` — **vacía en 15 de 15** |
| Tipo de cliente | ✓ | `clients.client_type` (particular/empresa) |
| Serie de factura | ✓ | `invoices.series` |

### Medir
| Pieza | | De dónde sale |
|---|---|---|
| Importe facturado (sin IVA) | ✓ | `invoices.subtotal` |
| Nº de facturas · unidades · ticket medio | ✓ | derivados de la misma fuente |
| **Beneficio / margen** | ✓ | `margenResumen()` — coste congelado del peldaño 2 |
| Importe cobrado | ✓ | `invoice_payments.amount` |
| Importe pendiente de cobro | ✓ | `cobros.js:openDebts()` |

### Filtrar por
Rango de fechas ✓ · estado pagada/pendiente/vencida ✓ (`status` + `due_date` + pagos) · tipo de
cliente ✓ · producto o categoría ✓ · forma de pago ✓ · **responsable, incluido "sin asignar"** ✓

---

## COMPRAS · 14/17 ✓
**Permiso:** `purchases.read` · **Fuente:** `pagos.js` (`openPayables`), `purchases`, `purchase_orders`

### Mirar por
| Pieza | | De dónde sale |
|---|---|---|
| Proveedor · fecha | ✓ | `supplier_id` · `invoice_date` / `date` |
| Producto / categoría | **parcial** | ✓ en `purchase_items.product_id` y `purchase_order_items`. **✗ en `supplier_invoice_items`**, que solo tiene `concepto` (texto libre) |
| Almacén de destino | ✓ | `purchases.warehouse_id` · recepciones de orden |
| **Usuario que compró** | **⚠** | igual que ventas: no existe |

> **Sobre el "parcial": no es una carencia, es el dominio.** Una factura de **gasto puro** no tiene
> producto por naturaleza — un alquiler no es un artículo. La pieza funciona donde tiene sentido (las
> compras de mercancía, que sí van por `purchase_items`). Documentarlo como agujero sería mentir.

### Medir
Importe comprado sin IVA ✓ (`supplier_invoices.base`) · nº de facturas/órdenes ✓ · unidades ✓ ·
coste medio de compra ✓ (`purchase_items.unit_cost` / `products.average_cost`) · pendiente de pago ✓
(`openPayables`) · **gasto por categoría** ✓ (`supplier_invoices.expense_category`, ya poblada:
Servicios profesionales · Alquiler · Software y herramientas)

### Filtrar por
Rango de fechas ✓ · estado ✓ · proveedor ✓ · producto o categoría (parcial, ver arriba) ·
**tipo mercancía / gasto puro** ✓ (`entity_type`: `purchase` · `po_receipt` · `supplier_return` ·
`null` = gasto)

---

## INVENTARIO · 17/17 ✓ — **completo**
**Permiso:** `inventory.read` · **Fuente:** `stock.js` + el libro `stock_movements`

**Mirar por:** producto ✓ · categoría ✓ · almacén ✓ · **proveedor habitual** ✓ (`products.supplier_id`
— D5f arregló que persistiera) · **lote / nº de serie** ✓ (`stock_lots` + `stock_movements.lot_id`)

**Medir:** stock actual ✓ · **valor del stock a coste (WAC)** ✓ (`products.average_cost`) · unidades
entradas/salidas ✓ (el libro) · **rotación** ✓ (derivable del libro) · **unidades bajo mínimo** ✓
(`stock_levels.min_qty`) · coste medio por producto ✓

**Filtrar por:** almacén ✓ · categoría ✓ · estado de stock ✓ · **caducidad próxima** ✓
(`stock_lots.expiry`) · producto o proveedor ✓

---

## CONTABILIDAD · 16/17 ✓
**Permiso:** el de Contabilidad · **Fuente:** `ledger_entries` / `ledger_lines`,
`contabilidad-pyg.js`, `contabilidad-modelos.js`

**Mirar por:** cuenta contable ✓ (`ledger_lines.account_code`) · tipo de documento ✓
(`entry_type`/`origin_type`) · periodo ✓ · cliente o proveedor ✓ (vía `origin_id`) · tipo de IVA ✓
(`ledger_lines.tax_rate`)

**Medir:** total ingresos ✓ · total gastos ✓ · resultado ✓ · IVA repercutido ✓ · IVA soportado ✓ ·
base imponible por tipo ✓

| **Retenciones (IRPF)** | **parcial ⚠** | ✓ **repercutido** (`invoices.irpf_rate` / `irpf_amount`) · **✗ soportado**: `supplier_invoices` **no guarda retención, por decisión explícita del código**. Es lo que bloquea el modelo 111 (`TABLERO.md`, Backlog · Contabilidad) |

**Filtrar por:** rango de fechas ✓ · trimestre fiscal ✓ · cuenta o grupo ✓ (`ledger_accounts.account_group`) ·
tipo de IVA ✓ · tipo de documento ✓

---

## CLIENTES · 18/19 ✓
**Permiso:** `clients.read` · **Fuente:** `ventas-metrics.js`, `crm.js`

**Mirar por:** cliente ✓ · tipo ✓ · **zona/provincia ○** (misma que ventas) · forma de pago ✓
(`clients.payment_method`) · **perfil de cobro** ✓ (`collections_profile`) · antigüedad ✓
(`created_at`) · **responsable** ✓ *(nuevo, `clientesPorResponsable()`)*

**Medir:** nº de clientes ✓ · facturación por cliente ✓ (`clientVentas`) · nº de compras ✓ · ticket
medio ✓ · **última compra** ✓ · deuda pendiente ✓ (`clientDebt`) · **frecuencia de compra** ✓
(`umbralDormido` ya la calcula, con el ritmo aprendido por cliente)

**Filtrar por:** con compra en los últimos X días ✓ · **dormidos** ✓ (`clientesDormidos` — hueco
mediano × 2, suelo de 30 días, respaldo de 90 para el de una sola compra) · con deuda vencida ✓ ·
tipo ✓ · zona ○ · perfil de cobro ✓ · **responsable / sin asignar** ✓

---

## Piezas a habilitar — ninguna era "barata y directa"

### 1. Usuario en los documentos (ventas + compras) — **⚠ su propio peldaño**
Es **UNA pieza, no dos**: ni `invoices`, ni `purchases`, ni `purchase_orders`, ni `supplier_invoices`
guardan quién los hizo.
- **Ya resuelto a medias (17 jul):** el **mostrador** guarda `invoices.emitted_by`, y el histórico se
  recuperó de `activity_logs` (41 de 42 tickets).
- **Lo que falta:** quién *tecleó* una factura con cliente. Exige pasar la sesión por **5 puntos de
  emisión**, y uno es un **cron** (recurrentes) — una factura recurrente no tiene vendedor, tiene
  "automático". **Eso es una decisión de producto, no una columna.**
- *El histórico sería rellenable*: `activity_logs` registra "Creó factura" (26), "Emitió ticket" (52),
  "Creó rectificativa" (1) con su `user_id`.

### 2. Producto / categoría en facturas de gasto — **no es carencia**
Ver COMPRAS. Un gasto puro no tiene producto por naturaleza. Se documenta así y no se fuerza.

### 3. IRPF soportado en compras — **⚠ ya tiene peldaño**
Decisión explícita del código. Vive en el Backlog · Contabilidad (modelo 111). No se toca aquí.

### 4. ○ Zona / provincia — **el caso que hay que no confundir**
**La columna existe** (la trajo Facturae) y está **vacía en 15 de 15 clientes**. No es una pieza a
habilitar: es **captura de datos**. La dimensión funcionará el día que alguien rellene direcciones;
hoy devolvería un único grupo "(sin provincia)". **Marcarla como "existe" engañaría al constructor
del peldaño 4** — por eso lleva su propia marca.

---

## El responsable de la venta — la cascada de tres

Fuente única: `ventas-metrics.js` (`responsableDeVenta`, `ventasPorResponsable`,
`clientesPorResponsable`). Decisión del dueño, 17 jul 2026.

1. **Hay cliente** → el responsable del cliente (`clients.responsable_user_id`), **derivado EN VIVO**.
2. **No hay cliente pero sí `emitted_by`** → quien cobró, **congelado** (mostrador anónimo).
3. **Ni lo uno ni lo otro** → **sin asignar**.

**Por qué (1) se deriva y (2) se congela — la asimetría es el diseño.** El **coste** (peldaño 2) se
congela porque es un **hecho** del día de la venta: lo que te costó entonces no puede cambiar. El
**responsable** se deriva porque es una **relación viva**: quién lleva a este cliente **hoy**. Si
reasignas un cliente, su histórico **debe** reatribuirse — es lo que hace un CRM. Congelar el (1)
rompería eso; derivar el (2) es imposible (no hay cliente del que derivar).

**Es seguro derivar:** los clientes se **archivan** (`active=0`), nunca se borran, y hay **0 facturas
con un `client_id` inexistente** (verificado 17-jul).

**La rama 3 no estaba en el encargo, y existe:** hay **4 facturas de serie F, sin cliente y sin tipo**
(junio) que no son mostrador **ni** tienen cliente. La cascada de dos las dejaba fuera; la de tres las
recoge en "sin asignar" y cierra el modelo ante cualquier caso futuro.

**"Sin asignar" es una fila más, nunca se esconde:** ocultarla haría que la suma por responsable no
cuadrase con el total de Ventas, y nadie sabría por qué.

**Un responsable desactivado** cae en "sin asignar" **sin perder el dato** (el id sigue en la ficha):
su cartera vuelve sola al reactivarlo.

---

> **Verificado:** `verify-responsable` 27/0 · `gate-margen-pantalla` 33/0 (navegador) ·
> `verify-margen` 38/0. Grupo `margen` del runner. Donde este documento dice "verificado" es contra el
> código y los datos del **17 jul 2026**; los números de línea derivan en cuanto otro commit los toque.
