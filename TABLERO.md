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

### ▶ P3. Unificar catálogo (absorber los servicios de A3) — SIGUIENTE
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

## Pendientes técnicos (deuda rastreable)
- **DISA `create_product`: exigir banda de IVA.** Hoy hace `INSERT INTO products` directo (NO vía API) sin banda → el producto nace en **General/21 por el DEFAULT de la columna, sin elección explícita**. La API ya lo exige; DISA no. **Cerrar al reenfocar DISA** (no se parchea ahora: esa acción se reescribe entonces y el parche se tiraría). Ref: `modules/disa/index.js`, acción `create_product`.

---

## Notas
- Una tarea "EN CURSO" a la vez (RITUAL). Producto: P1+P2 y refinamientos (P2.1, P2.2) hechos; sigue **P3**.
- Este orden y alcances no son sagrados (CANON §3): si al construir algo no cuadra, se cambia.
