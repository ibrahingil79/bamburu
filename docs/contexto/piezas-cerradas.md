# Piezas cerradas — Bamburu

> Inventario de lo ya construido y validado. **Lo marcado CERRADA no se vuelve a tocar ni "mejorar" sin encargo explícito.**
> Una línea por pieza, con commit si está en el historial. Fuente de verdad: el repo (git log + TABLERO.md).
> Estado: **CERRADA** (committeada y validada) · **EN CURSO** (sin commit / pendiente de OK en navegador real).

## Núcleo — Pilar 1 · Catálogo  ✅ CERRADO
- CERRADA — Producto con tipo (físico/digital/servicio) + IVA por banda + catálogo único (servicios unificados) + buscador nombre/SKU + filtro categoría + paginación.

## Núcleo — Pilar 2 · Cliente  ✅ CERRADO
- CERRADA — Ficha de cliente, grupos y CRM básico; voz de DISA sobre clientes (índice T5).
- CERRADA — Ciclo de vida de factura: inmutable + anular + rectificar (R1–R5, modalidad S/I, abono) — `1fb4fd4` (A3 Fase 2).
- CERRADA — Cobros / pendiente de pago calculado en vivo (T4 Paso 1) + perfiles, próxima acción y voz de DISA (Paso 2).

## Núcleo — Pilar 3 · Inventario  🟡 EN CURSO (casi cerrado)
- CERRADA — Stock como libro append-only (`stock_movements`) + caché derivada + kardex + reversión.
- CERRADA — Multi-almacén Capa 1/2 (operar por almacén) + Capa 3 traslados (`TR-NNNN`) — `da7871e`.
- CERRADA — WAC (coste medio) + valoración de inventario.
- CERRADA — Compras: órdenes (C1a), recepciones (C1b), cierre por diferencias (C1c), facturas de proveedor, devoluciones, captura OCR (C2), gastos.
- CERRADA — Capa de dinero con proveedores: pagos + voz de DISA + motor de vencimientos + pago por cuenta — `8620f15`, `e4ed8b1`.
- ⬜ Pendiente del pilar: stock mínimo / punto de pedido, trazabilidad lote/serie (no cierra hasta su turno).

## Núcleo — Pilar 4 · Ventas  🟡 EN CURSO
- CERRADA — Verifactu Tarea 1: registros oficiales + huella encadenada + QR + leyenda — `f762139`.
- CERRADA — PIEZA 1: presupuesto + motor de conversión + email a destinatario editable — `568c05e`, `6ded928`.
- CERRADA — Pieza 2a: pedido + reserva de stock — `8526048`.
- CERRADA — Pieza 2b: albarán (entrega, salida real) — cierra presupuesto→pedido→albarán→factura — `0c37a61`.
- CERRADA — PDF real: generador Chromium compartido cableado a los 4 documentos — `45b4770`.
- CERRADA — PIEZA A: mostrador nuevo (ticket = factura simplificada F2, cobro al momento) — `fe37338`.
- CERRADA — PIEZA B: ticket → factura completa (sustitutiva F3, sin duplicar cobro) — `a655ed7`.
- CERRADA — PIEZA C: recableado de los 4 lectores (KPIs, analítica, DISA, historial de cliente) a la cadena nueva vía `ventas-metrics.js` + retirada del POS viejo del admin (D3 neutralizado, enlaces muertos limpiados, gate Capa 2 aparcado) — `4bb5f71` (recableado) + `9bbd16d` (retirada). Archivado de `sales_orders` y corte de escritura de DISA → hechos en **D1** (abajo).
- CERRADA — D1: tienda pública apagada (reversible: `/store` + `/api/store` → 404) + vía vieja de escritura de DISA cortada (`create/edit/update/cancel_order` + puente `create_invoice_from_order` neutralizados → respuesta "en migración"; resuelve la fuga de stock de `cancel_order`) + `invoices.js` tolerante + **archivado** (rename → `_archived`, idempotente) de `sales_orders`, `sales_items`, `order_status_history`, `customer_accounts`, `customer_sessions`, `wishlist` — `5d181c7`. Diferido a **D2**: `product_reviews` y `newsletter_subscribers` (rutas admin vivas).
- CERRADA — D2: desmontados (comentados) los restos e-commerce — feedback, reseñas, newsletter, envíos y el editor "Tienda Online" (+ API `/settings/store` y builder por voz `/api/disa/store-message`); `clients.js syncNewsletter` → no-op; quick-links muertos de DISA/Inicio limpiados. **Archivadas** (rename → `_archived`): `feedback`, `product_reviews`, `newsletter_subscribers`, `shipping_methods` — `a190bd2`. **CONSERVADO a propósito:** `tags`/`product_tags` (función viva del catálogo) y `store_settings` (diseño de tienda, Capa 2). Pendiente: saneamiento de tests huérfanos del clúster viejo (test-disa-clientes-t5 §6 aparcado, gate-almacenes-capa2 aparcado, shoot* obsoletas).
- ⬜ Pendiente del pilar: facturación recurrente, plantillas, cobro online, PDF+email de cada documento; **aviso+permiso de sobreventa en el mostrador** (espejo de `sales.emit_over_stock`) y reactivar el gate de Capa 2.

## Fixes recientes (fuera de pilar)
- CERRADA — Aviso + permiso al facturar un físico por más del stock (no en silencio) — `35c4f22`.
- CERRADA — Fleco visual: desplegable del buscador legible — `f23c4c1`.
- CERRADA — Fix Inventario en blanco (`stock-modal.js`: `\n\n` en template-literal partía el `<script>` y tumbaba todo el JS de Inventario; bug de la Pieza 2a, ortogonal a PIEZA C) — `8449eb9`.

## El Suelo  (admisión — comprometido, mayormente sin construir)
- CERRADA — Cumplimiento: hash encadenado + Verifactu QR + leyenda. ⬜ Envío AEAT, Facturae, SII, TicketBAI.
- CERRADA — Multiusuario parcial: roles + `requirePerm` + permisos por usuario en BD operativos. ⬜ Administración de usuarios/permisos por pantalla y por DISA.
- ⬜ Contabilidad entera (asientos → conciliación → modelos → libros → puente gestoría): sin empezar.

## El Foso  (ventaja — comprometido, sin construir)
- DISA predictiva/agéntica, caras por oficio (CRM comercial, agenda, control horario), API/integraciones, app móvil: ⬜.

## Infraestructura / plataforma  ✅ CERRADO
- CERRADA — Producción + HTTPS (systemd + Caddy + comodín Let's Encrypt vía Cloudflare) (2026-06-19).
- CERRADA — Acceso landing → subdominio (Opción A) — `894e750`.
- CERRADA — Backup diario a Google Drive blindado — `3076f68`.
- CERRADA — Panel de superadmin (7 zonas, solo lectura) — `4b9b228`.
- CERRADA — Endurecimiento del borde público (IP real, topes de gasto, rate limits, login) + XSS facturas (A1) — `307632e`, `7eb07f6`.

> `modules/store/` (tienda pública, Capa 2): **APAGADA en D1** (montajes comentados → 404; código en el repo). Su retirada definitiva + archivado de `product_reviews`/`newsletter_subscribers` y limpieza de restos e-commerce = **D2**.
