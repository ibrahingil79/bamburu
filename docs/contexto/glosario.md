# Glosario — Bamburu

> Términos del dominio y entidades, tal como aparecen en código y documentos del repo.

## Producto y marco estratégico
- **DISA** — la IA del producto (`modules/disa/`). Forma principal de uso: el dueño le habla y ella prepara/propone; el humano valida lo que tiene consecuencia.
- **Los 4 pilares (el Núcleo):** **Catálogo** ✅ · **Cliente** ✅ · **Inventario** 🟡 · **Ventas** (Pilar 4). Orden por dependencia técnica.
- **El Núcleo / El Suelo** — las dos capas que quedan (**CANON §7**). Núcleo = lo ya construido (Pilares 1–4). Suelo = umbral de admisión al mercado (cumplimiento, contabilidad, multiusuario). *(Este puntero decía "CANON §2-bis", que no existe: el mapa de capas vive en §7.)*
- **La escalera** — el orden vigente (**CANON §4**), una secuencia numerada donde cada peldaño se apoya en el anterior; el detalle y la colocación de cada módulo, en `TABLERO.md`. **Sustituye a "El Foso"**, que no era una capa sino una lista de espera sin orden: la ventaja que prometía (DISA predictiva, caras por oficio, API, móvil) sigue entera, pero repartida en peldaños con número.
- **Tipo de producto** — `físico` (ciclo completo con stock), `servicio` (se factura, sin stock), `digital` (se entrega, sin stock físico).
- **Tenant / slug** — un negocio y su identificador; cada uno tiene su `data/tenants/<slug>.db`.

## Ventas y facturación
- **Cadena documental nueva:** **presupuesto** (quote, `PRE-`) → **pedido** (`customer_orders`, `PED-`, reserva stock) → **albarán / nota de entrega** (`delivery_notes`, `DEL-`, salida real de stock) → **factura** (`invoices`).
- **Mostrador / TPV / POS** — punto de venta. El mostrador nuevo emite **factura simplificada**; el POS viejo (`sales_orders`/`sales_items`) sigue vivo solo por URL.
- **TipoFactura (Verifactu, lista L2):** **F1** ordinaria · **F2** simplificada (ticket) · **F3** sustitución de simplificadas · **R1–R5** rectificativas.
- **Series:** `F` ordinaria · `S` simplificada (ticket) · `R` rectificativa. Numeración y cadena de hash propias por serie.
- **Sustitutiva (canje)** — factura completa F3 que reemplaza a un ticket simplificado; hereda su cobro, no lo duplica (`invoices.substitutes_invoice_id`).
- **Rectificativa** — único mecanismo legal de corrección en ES (serie `R`). **Tipo R1–R5**; **modalidad** sustitución (`S`) o diferencias (`I`); admite **abono** (importe negativo).
- **Anular** — asiento nuevo (`invoice_anulaciones`) enlazado al hash de la original; la original pasa a `status='anulada'`.

## Cobros / dinero
- **Cobro** — estado calculado en vivo (`cobros.js`): pendiente / cobrada en parte / cobrada / vencida (+ días y tramo 0–30/30–60/+60). `invoice_payments` = pagos; `due_date` = emisión + plazo del cliente.
- **`countsAsReceivable`** — predicado único que decide si una factura cuenta como deuda/venta real.
- **Compras por pagar / cobros por cuenta** — deuda con proveedores vs deuda de clientes (espejo).

## Fiscal
- **Verifactu** — sistema antifraude AEAT: **huella SHA-256 en mayúsculas, encadenada** por documento + **QR de cotejo** + leyenda. (`modules/erp/verifactu.js`.)
- **Banda de IVA** — selección del tipo porcentual (ES: 21 / 10 / 4 / 0); no determina por sí sola si la operación está exenta. La naturaleza jurídica se guarda aparte con la clasificación fiscal por línea.
- **IRPF / retención** — depende de quién factura (régimen) y a quién (cliente); se decide en settings + factura, no en el producto.
- **Facturae / SII / TicketBAI** — obligaciones B2B/territoriales aún no construidas.

## Inventario
- **Kardex** — historial de movimientos de stock de un producto.
- **`stock_movements`** — libro append-only (delta con signo); `products.stock` es su caché derivada.
- **WAC** — coste medio ponderado (valoración de inventario a coste).
- **Reservado / disponible** — reservado = pedidos de venta confirmados; disponible = stock − reservado.

## Plataforma
- **control.db** — BD central de enrutado de tenants + superadmin + topes + errores.
- **`requirePerm('modulo.accion')`** — guard de permisos por endpoint/vista.
- **Superadmin** — panel del dueño en el apex (`/superadmin`), 7 zonas, solo lectura.
- **`register(app, db)`** — contrato de carga de cada módulo (`core/loader.js`).
