# TABLERO — Bamburu

> Plan de trabajo. La estrategia manda desde CANON.md; el ritual desde RITUAL.md.
> Estructura: 4 pilares en ORDEN DE CONSTRUCCIÓN — Producto → Cliente → Inventario → Ventas
> (Ventas necesita los otros tres ya hechos; ver CANON §3).
> REGLA DE ORO: una sola tarea "EN CURSO" a la vez. Terminar antes de empezar otra.
> Última actualización: 2026-05-29

---

## PILAR 1 — PRODUCTO (Catálogo) — 🟢 EN CURSO

El producto es la raíz de la que parte todo (CANON §2). Objetivo de este pilar: dejar el
catálogo en su versión mínima sólida. Fuera de este primer paso (más adelante): variantes,
galería de imágenes, SEO, coste/margen, unidad por hora/sesión.

### ▶ P1+P2. Tipo "servicio" en el producto + IVA por producto — SIGUIENTE (se hacen juntas)
- **Hoy:** el producto solo puede ser físico/digital y NO guarda su propio IVA (el IVA se decide fuera).
- **Qué se hace:** el tipo de producto pasa a ser físico / digital / **servicio**, y cada producto guarda su **IVA propio**.
- **HECHO CUANDO:** puedo crear un producto de tipo "servicio" con su IVA, y los productos que ya existían siguen funcionando igual — sin romper POS, pedidos ni facturas.

### P3. Unificar catálogo (absorber los servicios de A3)
- **Hoy:** los servicios viven en una tabla/pantalla/API aparte (`services`, `/admin/services`), separada de los productos.
- **Qué se hace:** migrar esos servicios a productos de tipo "servicio" y **eliminar** la tabla, la pantalla y la API de servicios sueltos. El autofill al facturar pasa a leer del catálogo de productos.
- **HECHO CUANDO:** hay un único catálogo; los servicios viejos aparecen como productos tipo "servicio" y nada en el código apunta ya a `services`.

### P4. Buscador y filtros en la lista de productos
- **Hoy:** solo hay un buscador en el navegador por nombre/código, sin filtros y cargando todos los productos de golpe.
- **Qué se hace:** búsqueda por nombre y código, filtro por categoría y paginación.
- **HECHO CUANDO:** encuentro un producto por nombre o código, filtro por categoría, y la lista no carga todo de una vez.

---

## PILAR 2 — CLIENTE
_(por detallar)_ — Clientes, Grupos, CRM. A quién vendes.

## PILAR 3 — INVENTARIO
_(por detallar)_ — Compras, Stock, Proveedores, Devoluciones, Descuentos. Qué tienes y de dónde sale. Incluye **multi-almacén** como pieza de peso (CANON §6): se aborda al construir Stock, no antes.

## PILAR 4 — VENTAS
_(por detallar)_ — Pedido → Albarán / nota de entrega → Factura. Usa los tres pilares anteriores. Aquí entran: **PDF real de la factura**, **enviar factura por email** y **sello Verifactu (QR + leyenda)**.

---

## Contexto heredado (era anterior — código que SE QUEDA)

La era previa ("facturación de servicios") dejó código que funciona y no se tira; solo se retira su plan:
- **Hecho y vivo:** crear factura sin pedido (A1), IVA múltiple por línea + IRPF (A2), y el catálogo de servicios suelto (A3).
- **A3 será absorbido por P3:** los servicios pasan a ser un tipo de producto; su tabla/pantalla/API se eliminan.
- **Lo que quedaba pendiente de esa era no se pierde, se reubica en el PILAR 4 (Ventas):** PDF real de la factura, envío por email y Verifactu (QR + leyenda).

---

## Notas
- Una tarea "EN CURSO" a la vez (RITUAL). Ahora arranca P1+P2 del Pilar 1.
- Este orden y alcances no son sagrados (CANON §3): si al construir algo no cuadra, se cambia.
