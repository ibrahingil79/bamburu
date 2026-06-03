# TABLERO — Bamburu

> Plan de trabajo. La estrategia manda desde CANON.md; el ritual desde RITUAL.md.
> Estructura: 4 pilares en ORDEN DE CONSTRUCCIÓN — Producto → Cliente → Inventario → Ventas
> (Ventas necesita los otros tres ya hechos; ver CANON §3).
> REGLA DE ORO: una sola tarea "EN CURSO" a la vez. Terminar antes de empezar otra.
> Última actualización: 2026-06-03

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
- Verificado con test de integración (18/18): búsqueda nombre/SKU, filtro categoría, combinado, paginación con navegación que conserva filtros, y mensaje sin resultados. Commit `__COMMIT__`.

**Con P4 cerrado, el PILAR 1 — PRODUCTO queda completo.**

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
- **A3 absorbido en P3 (hecho):** los servicios son ahora productos de tipo "servicio"; su tabla/pantalla/API se eliminaron.
- **Lo que quedaba pendiente de esa era no se pierde, se reubica en el PILAR 4 (Ventas):** PDF real de la factura, envío por email y Verifactu (QR + leyenda).

---

## Pendientes técnicos (deuda rastreable)
- **DISA `create_product`: exigir banda de IVA.** Hoy hace `INSERT INTO products` directo (NO vía API) sin banda → el producto nace en **General/21 por el DEFAULT de la columna, sin elección explícita**. La API ya lo exige; DISA no. **Cerrar al reenfocar DISA** (no se parchea ahora: esa acción se reescribe entonces y el parche se tiraría). Ref: `modules/disa/index.js`, acción `create_product`.

---

## Notas
- Una tarea "EN CURSO" a la vez (RITUAL). **Pilar 1 — Producto: CERRADO** (P1+P2, P2.1, P2.2, P3 y P4 hechos). Siguiente: arrancar **Pilar 2 — Cliente** (por detallar).
- Este orden y alcances no son sagrados (CANON §3): si al construir algo no cuadra, se cambia.
