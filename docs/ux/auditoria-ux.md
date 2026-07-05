# Auditoría UX global (U0) — Bamburu

> Fase de optimización · Eje A — UX · tarea **U0** (solo lectura, 2026-07-05). Inventario real de las
> pantallas del admin y del portal para alimentar U1–U6 con datos, sin cambiar nada todavía.
> Método: lectura de `modules/erp/layout.js` (sistema visual + navegación), de las vistas en
> `modules/erp/routes/` y del portal `modules/portal/`, más conteos con grep. Cada hallazgo apunta a
> la tarea (U1–U6) que lo resolverá.

## Resumen ejecutivo (lo prioritario)
1. **El sistema visual existe pero se lo salta casi todo (U1).** `layout.js` define **~40 tokens CSS**
   (`--text`, `--card`, `--accent`, `--ok/--danger/--warn`, `--radius`…), pero las vistas usan **542
   colores hex hardcodeados** en 21 archivos y **cientos de estilos inline** (contabilidad 126,
   purchase-orders 106, orders 99, invoices 90…). Los tokens no son la única fuente → incoherencia.
2. **Estados vacíos y de carga desiguales (U2).** Solo **7 vistas** tienen estado vacío cuidado; muchas
   listas no lo tienen. Los estados de carga solo aparecen en pantallas con fetch cliente (~10), no hay
   patrón común.
3. **Errores crudos al usuario (U3).** **16** handlers POST devuelven `c.text(e.message)` — texto plano
   sin maquetar, sin la voz de Bamburu — más 1 error 500 genérico.
4. **Flujos "propuesta lista" ya buenos; formularios en blanco a recortar (U4).** Conciliar, emitir
   recurrente y enviar enlace del portal son de **~2 clics** (alineado con CANON). Registrar cobro y
   crear plantilla/factura parten de **formulario en blanco** → candidatos a recorte.
5. **Móvil sin verificar y tablas anchas (U5).** `layout.js` tiene 2 breakpoints (980/768px), pero las
   tablas de datos (contabilidad, conciliación, facturas: 8–11 columnas) no tienen envoltorio de
   scroll horizontal → probable rotura en móvil.

---

## 1. Inventario de pantallas

### Admin — menú lateral (por sección)
| Sección | Pantalla | Ruta | Tipo |
|---|---|---|---|
| Inicio | Inicio (dashboard) | `/admin` | panel |
| Ventas | Presupuestos · Pedidos · Albaranes · Facturas · **Recurrentes** · Cobros · **Portal de cliente** · TPV (mostrador) · Clientes · Grupos | `/admin/{quotes,pedidos,albaranes,invoices,recurrentes,cobros,portal,mostrador,clients,clients/groups}` | listas + docs |
| Compras | Órdenes de compra · Compra directa · Facturas recibidas · Pagos a proveedores · Devoluciones · Captura de factura · Proveedores | `/admin/{purchase-orders,purchases,supplier-invoices,pagos,supplier-returns,purchases/capture,suppliers}` | listas + docs |
| Contabilidad | Libros registro (6 pestañas: ventas/compras/diario/mayor/bienes/modelos + P&G) · Envío Verifactu (AEAT) · Conciliación bancaria | `/admin/{contabilidad,verifactu/envios,conciliacion}` | tablas |
| Inventario | Stock · Almacenes · Traslados | `/admin/{inventory,warehouses,stock-transfers}` | listas |
| Catálogo | Productos · Categorías | `/admin/{products,categories}` | listas |
| Barra de cuenta | Mi cuenta · Ajustes · Datos del negocio · Usuarios · Seguridad · Actividad | `/admin/{change-password,settings,settings/company,users,security,activity}` | formularios/paneles |

**~30 pantallas de admin** (varias con sub-vistas: contabilidad son 7 pestañas; conciliación 2 tipos).

### Portal de cliente (público)
- `/portal/<token>` — lista de facturas del cliente + estado de pago + datos de transferencia.
- `/portal/<token>/factura/<id>/pdf` — descarga del PDF.
- **Shell propio** (`modules/portal/index.js`), NO comparte el sistema visual del admin.

---

## 2. Incoherencias visuales  → **U1**
- **Tokens vs. hardcode.** Existen los tokens (`layout.js`), pero:
  - **542 colores hex** repetidos en 21 vistas. Los colores de estado (verde `#15803d`, rojo `#b91c1c`,
    ámbar `#92400e`/`#d97706`) se reescriben a mano en cada módulo en vez de usar `--ok/--danger/--warn`.
  - Cientos de **estilos inline** (top: contabilidad-routes 126, purchase-orders 106, orders 99).
- **Badges de estado: 3+ implementaciones distintas.** Contabilidad (spans con hex inline),
  conciliación (`ESTADO_BADGE` propio), recurrentes/verifactu (otro map). No hay un componente único.
- **Botones con nomenclatura mezclada.** Módulos viejos usan `.btn-primary/.btn-secondary/.btn-sm`
  (invoices, orders, supplier-invoices); los nuevos usan `.btn/.btn-ghost` (contabilidad, conciliación,
  recurrentes, portal). Dos vocabularios de botón conviviendo.
- **Cajas de aviso duplicadas.** `avisosBox` (contabilidad), el bloque de aviso de conciliación y el
  flash de portal-admin son tres cajas con el mismo propósito y estilos distintos.
- **El portal no usa el sistema del admin.** Estética separada (su propio `<style>`), lo que rompe la
  coherencia de marca de cara al cliente final.
> **U1**: extraer color/estado/espaciado/badge/botón/aviso a tokens+componentes en `layout.js` y que
> las vistas de más uso (facturas, cobros, contabilidad, conciliación, recurrentes) los consuman.

## 3. Estados vacíos y de carga  → **U2**
- **Con estado vacío cuidado (7):** recurrentes, clients, verifactu-envios, contabilidad, supplier-invoices,
  conciliación, invoices (patrón `… || 'Sin …'`).
- **Sin estado vacío claro (a revisar):** pagos, purchase-orders, supplier-returns, stock-transfers,
  warehouses, categories, quotes/pedidos/albaranes (confirmar en U2 pantalla a pantalla).
- **Carga:** solo pantallas con fetch cliente (~10: analytics, products, users, mostrador…) muestran
  algo; las server-rendered (contabilidad, conciliación, recurrentes, portal) no necesitan spinner pero
  no hay un patrón común de "cargando" para las que sí hacen fetch.
> **U2**: cubrir las listas sin estado vacío con "qué es esto + primera acción"; unificar el "cargando".

## 4. Mensajes de error  → **U3**
- **16 `c.text(e.message, …)`** en handlers POST (recurrentes, conciliación, bienes, portal-admin…):
  ante un fallo el usuario recibe **texto plano crudo** (p. ej. "El pago (X) supera lo pendiente (Y)")
  fuera de la maqueta y sin la voz de Bamburu. Algunos son claros pero se ven como un volcado.
- **1 error 500 genérico** (`c.text('...', 500)`).
- Hay un **toast global** (`layout.js`) para el éxito en pantallas con fetch, pero los POST con
  redirect devuelven el error como página de texto → dos UX de feedback distintas.
> **U3**: encauzar los errores por un patrón común (mensaje claro + qué hacer, en la maqueta/voz),
> reaprovechando el toast/flash ya existente en vez de `c.text` crudo.

## 5. Flujos clave y nº de clics  → **U4**
| Flujo | Clics (medido leyendo la ruta) | Estado |
|---|---|---|
| **Conciliar un abono** (Conciliación → botón de la sugerencia) | ~2 | ✅ "propuesta lista" |
| **Emitir factura recurrente** (Recurrentes → "Emitir factura" en el borrador) | ~2 | ✅ "propuesta lista" |
| **Enviar enlace del portal** (Portal → "Enviar enlace") | ~2 | ✅ |
| **Registrar cobro manual** (Cobros → modal → importe/fecha/método → Guardar) | ~3 + formulario | ⚠️ precargar importe pendiente + fecha hoy |
| **Crear plantilla recurrente** (Recurrentes → "+ Nueva" → cliente/cadencia/fecha/3 líneas) | formulario en blanco largo | ⚠️ menos campos / valores por defecto |
| **Emitir factura desde cero** (Facturas → nueva → líneas/cliente/impuestos) | formulario largo | ⚠️ candidato a plantilla/propuesta |
> **U4**: los flujos ya "de propuesta" (conciliar, emitir recurrente) son el modelo; llevar registrar
> cobro y crear plantilla/factura hacia menos formulario en blanco (precargas, defaults).

## 6. Móvil / responsive  → **U5**
- `layout.js`: 2 breakpoints reales (`max-width:980px` y `768px`) + `@media print`. El menú lateral
  colapsa, pero **las tablas de datos anchas** (contabilidad 8–11 columnas, conciliación, facturas) no
  tienen envoltorio `overflow-x` → probable desbordamiento horizontal en móvil.
- Formularios en rejilla (`grid-template-columns:1fr 1fr 1fr` en recurrentes, bienes) no bajan a 1
  columna en móvil → campos apretados.
> **U5**: verificar a ancho móvil las pantallas de uso frecuente; envolver tablas anchas en scroll
> horizontal y colapsar rejillas de formulario a 1 columna.

## 7. Onboarding  → **U6**
- Existe alta conversacional (`modules/registro/`) para crear el negocio, pero **no hay un recorrido de
  primeros pasos** dentro del admin que lleve al dueño a su primera acción útil (crear producto/cliente,
  emitir la primera factura) de la mano de DISA.
> **U6**: diseñar el recorrido de primer valor (enlaza con Eje B — DISA).

---

## Priorización sugerida (de esta auditoría salen U1–U6)
1. **U1 — tokens/componentes** (mayor incoherencia medida: 542 hex + inline en todos los módulos nuevos).
2. **U3 — errores** (16 volcados crudos; barato y muy visible).
3. **U2 — estados vacíos** (listas sin "qué hacer").
4. **U5 — móvil** (tablas anchas sin scroll).
5. **U4 — clics** (registrar cobro y crear plantilla).
6. **U6 — onboarding** (junto con Eje B).
