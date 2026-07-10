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
- CERRADA — Mostrador: aviso+permiso al vender por encima del stock (espejo de `sales.emit_over_stock`, disponible por almacén; 400 sin confirm / 403 sin permiso / emite con ambos; aviso en línea + repetido al cobrar) — `c9b68c3`.
- CERRADA — PIEZA C: recableado de los 4 lectores (KPIs, analítica, DISA, historial de cliente) a la cadena nueva vía `ventas-metrics.js` + retirada del POS viejo del admin (D3 neutralizado, enlaces muertos limpiados, gate Capa 2 aparcado) — `4bb5f71` (recableado) + `9bbd16d` (retirada). Archivado de `sales_orders` y corte de escritura de DISA → hechos en **D1** (abajo). Incluye el repunte del **aviso "Pedidos bloqueados"** de DISA `/summary` a la cadena nueva (`pedidosSinEntregar` → `customer_orders` confirmados sin entregar >3 días, **href `/admin/pedidos`**; gateado por `pedidos.read` en `35310ff`); con **aserción propia** en `verify-pieza-c-http.mjs` desde el commit de test/docs del 2026-06-25.
- CERRADA — D1: tienda pública apagada (reversible: `/store` + `/api/store` → 404) + vía vieja de escritura de DISA cortada (`create/edit/update/cancel_order` + puente `create_invoice_from_order` neutralizados → respuesta "en migración"; resuelve la fuga de stock de `cancel_order`) + `invoices.js` tolerante + **archivado** (rename → `_archived`, idempotente) de `sales_orders`, `sales_items`, `order_status_history`, `customer_accounts`, `customer_sessions`, `wishlist` — `5d181c7`. Diferido a **D2**: `product_reviews` y `newsletter_subscribers` (rutas admin vivas).
- CERRADA — D2: desmontados (comentados) los restos e-commerce — feedback, reseñas, newsletter, envíos y el editor "Tienda Online" (+ API `/settings/store` y builder por voz `/api/disa/store-message`); `clients.js syncNewsletter` → no-op; quick-links muertos de DISA/Inicio limpiados. **Archivadas** (rename → `_archived`): `feedback`, `product_reviews`, `newsletter_subscribers`, `shipping_methods` — `a190bd2`. **CONSERVADO a propósito:** `tags`/`product_tags` (función viva del catálogo) y `store_settings` (diseño de tienda, Capa 2). Pendiente: saneamiento de tests huérfanos del clúster viejo (test-disa-clientes-t5 §6 aparcado, gate-almacenes-capa2 aparcado, shoot* obsoletas).
- CERRADA — Saneamiento de tests: borradas las pruebas huérfanas del clúster retirado (`gate-almacenes-capa2.mjs` no-ejecutable, cobertura viva en `test-almacenes-capa2`; `shoot-tpv.cjs` captura del POS 404). Mixtas dejadas y señaladas (`test-disa-clientes-t5` §6, `shoot.cjs`). Regresión de lo vivo 0 fallos — `c001fd8`.
- ⬜ Pendiente del pilar: facturación recurrente, plantillas, cobro online, PDF+email de cada documento.

## Fixes recientes (fuera de pilar)
- CERRADA — Aviso + permiso al facturar un físico por más del stock (no en silencio) — `35c4f22`.
- CERRADA — Fleco visual: desplegable del buscador legible — `f23c4c1`.
- CERRADA — Fix Inventario en blanco (`stock-modal.js`: `\n\n` en template-literal partía el `<script>` y tumbaba todo el JS de Inventario; bug de la Pieza 2a, ortogonal a PIEZA C) — `8449eb9`.

## El Suelo  (admisión — comprometido, mayormente sin construir)
- CERRADA — Cumplimiento: hash encadenado + Verifactu QR + leyenda. ⬜ SII, TicketBAI.
- CERRADA — **Verifactu · Tarea 2 Fase A — envío REAL a la AEAT** (`d515242`): SOAP+mTLS contra preproducción
  (`prewww1.aeat.es`), dos registros aceptados con el FNMT del dueño. Arreglado el namespace de la `Cabecera`
  (va en `sfLR`, no en `sf`; validado con `xmllint` contra los XSD oficiales). **Hallazgo estructural: la
  ventana de 240 s** — `FechaHoraHusoGenRegistro` va dentro de la huella, y la AEAT exige ±240 s de su reloj
  al recibir (error 2004). Medido: 376 s → `AceptadoConErrores`; 0 s → `Correcto`.
- CERRADA — **Verifactu · Cola de envío automático por negocio** (`7b394c6`): al emitir, el registro sale hacia la AEAT en
  segundos (post-commit, junto a `postInvoice`: si falla, la factura se emite igual). **AGRUPA** en un sobre
  porque el control de flujo (art. 16.2 Orden HAC/1177/2024, t=60 s, un envío = un obligado) topa el envío de
  uno en uno a 1 registro/60 s. Reintentos con backoff solo para fallos de comunicación; rechazo y bloqueo por
  datos van directos a AVISO (fuente `enviosVerifactu` del motor existente). Certificado por negocio, con la
  contraseña fuera de todo fichero → **si no está en el entorno, la cola no se activa** (hoy: inactiva en los 6
  negocios; comportamiento idéntico al manual). No drena el histórico. Cerrojo por lease entre la cola en
  proceso y el barrido de systemd. Gate `verify-verifactu-cola.mjs` 62/0 + regresión 24/24.
  Detalle: `docs/verifactu/tarea2-cola-envio-automatico.md`.
  **⚠️ PRUEBA DE CONCEPTO, NO EL PRODUCTO.** Va con el certificado **personal** del dueño y demostró que la
  tubería funciona end-to-end contra la AEAT; nada más. **El producto es colaborador social** (un solo
  certificado de Bamburu + autorización de representación por negocio), decidido el 2026-07-10 →
  `decisiones.md`. "Cola hecha" **no** es "Verifactu para clientes hecho".
- ⬜ Pendiente: **Verifactu para clientes** (tarea única: colaborador social + certificado único + pantalla de
  autorización + activar + probar), anulaciones, subsanación del 2004, Facturae (firma/envío, bloqueado por
  certificado). *(La "Fase B legal" queda absorbida por la decisión del 2026-07-10: el modelo ya está elegido.)*
- CERRADA — Multiusuario: roles + `requirePerm` + permisos por usuario, **con pantalla de administración de usuarios/permisos** (`/admin/users`, `admin.manage_users`). El **cimiento** (cada ruta `/admin` y `/api/erp` con su candado, sin agujeros por URL) está hecho; **Permisos · Paso 1 FASE 2** (commit `9a2ec1f`) recableó facturas→`invoices.*` y cobros→`cobros.*` (nuevos) y limpió los permisos decorativos de la pantalla. **Paso 2** (commit `35310ff`): DISA ya respeta los permisos granulares — cada acción exige el mismo permiso que su pantalla (reutiliza `checkPermission`, bypass owner/admin) y el contexto/`/summary`/`query_database` se trocean por área (`*.read`); anular/rectificar y el genérico siguen admin-only.
- CERRADA — **DISA · límite de tema** (`b6cb605`): DISA ayuda solo con el negocio del usuario y el uso de Bamburu; ante preguntas sobre cómo está construida la plataforma por dentro (arquitectura, código, stack, infraestructura, aislamiento multi-tenant, BD/tablas, seguridad interna) **redirige con educación** a su papel. Regla por TEMA, no por lista de palabras. SOLO texto de prompt (sección `## TU ALCANCE` en el builder único de `/api/disa/message`, como sección propia del array → aplica con agentes personalizados). No sobre-bloquea negocio/fiscal/uso/datos del propio usuario; "¿están seguros mis datos?" → tranquiliza sin tripas. `/registro` (onboarding) fuera. Gate de modelo real `verify-disa-alcance.mjs` (fuera de tema 5/5 redirige, en tema 5/5 ayuda).
- CERRADA — **Contabilidad · Pieza 1** (`0ba2ab6`): cuaderno de doble cara (`ledger_entries`+`ledger_lines`, plan de cuentas PGC mínimo) como única fuente de verdad + los dos **libros registro** (ventas e ingresos / compras y gastos) como vistas derivadas + **export XLSX/CSV/PDF** en formato oficial AEAT (plantilla `LSI.xlsx` verificada; hojas `EXPEDIDAS_INGRESOS`/`RECIBIDAS_GASTOS`; XLSX sin dependencias). ADITIVO: asientos generados desde los documentos inmutables por hook+backfill idempotente, reutilizando `countsAsReceivable`/`countsAsPayable`; inmutable (corregir = reversión); anuladas neteadas, sustituidas fuera, abonos en negativo, F2→F3 una sola vez, Total=base+IVA (sin restar IRPF). Pantalla `/admin/contabilidad` (dos pestañas, un asiento por fila). Sin tocar hash/Verifactu, stock, permisos ni la lógica de los documentos. Lógica 38/38 · backfill copia real 12/12 · export 24/24 · regresión 0. Scripts `test-contabilidad`/`verify-contabilidad-backfill`/`verify-contabilidad-export`.
- CERRADA — **Contabilidad · Pieza 2 — Libro Diario y Libro Mayor** (`7f9732d`): vistas de SOLO LECTURA sobre el cuaderno de la Pieza 1 (no crean datos). Libro diario (asientos cronológicos con líneas Debe/Haber + cuadre) y libro mayor (saldo por cuenta + drill-down con saldo acumulado), dos pestañas más en `/admin/contabilidad` con filtro de periodo y export XLSX/CSV/PDF. Verificado 14/14 (diario cuadra; mayor cierra Σ saldos=0; cruce con libros registro de Pieza 1). Sin tocar hash/Verifactu, stock, permisos ni la lógica de los documentos. Script `verify-contabilidad-diario-mayor`.
- CERRADA — **Contabilidad · Pieza 3 — Libro de bienes de inversión + amortización** (`8f50ee4`): tercer libro registro (Orden HAC/773/2019, hoja BIENES-INVERSIÓN de LSI.xlsx). Tabla aditiva `investment_goods` (fuera de `WRITABLE_TABLES`; NO se vuelca al diario). Amortización lineal EN LECTURA prorrateada por días dentro de cada año natural con los días reales del año (año completo = cuota exacta, también bisiestos), tope = valor amortizable, la baja corta. Alta con compra enlazada (aporta proveedor/NIF/nº/valor), edición (rechaza puesta en func. > baja), baja con motivo, reactivar (404 si no existe; conserva motivo). Pestaña `/admin/contabilidad/bienes` + export XLSX/CSV/PDF (Ejercicio solo si el rango cae en un año natural; el libro excluye bienes posteriores al periodo). 7 correcciones de revisión multi-agente aplicadas antes del cierre. Verificado 33/33 + regresión (38/38, 24/24, 14/14). Script `test-contabilidad-bienes`.
- CERRADA — **Contabilidad · Pieza 4 — Modelos 303 (IVA) y 130 (IRPF), borradores** (`f70925f`): motor `contabilidad-modelos.js`, vistas derivadas de los libros (Piezas 1–3), SOLO LECTURA. Casillas verificadas contra instrucciones oficiales AEAT (303-2026 y 130). 303: devengado por tipo → casillas oficiales, deducible separando corrientes (28/29) de bienes de inversión (30/31) vía `investment_goods.purchase_id`, resultado 46/66/71 con compensación automática de trimestres negativos (78). 130: acumulado del año (ingresos, gastos+amortización, 20%, pagos y negativos previos encadenados, retenciones soportadas, minoración según año anterior). Pestaña "Modelos (303/130)" + export PDF/CSV. Bamburu PREPARA, nunca presenta (§0-ter); lo incierto va a 0 con AVISO. Verificado 28/28 + regresión. Script `test-contabilidad-modelos`.
- ⬜ Contabilidad — siguiente: P&G/balance, conciliación bancaria, modelos 111/115/123/349/347/390/200, cuentas anuales/legalización, acceso gestoría, subcuentas, asientos de amortización al diario. (Backlog detallado en TABLERO.md.)

## El Foso  (ventaja — comprometido, sin construir)
- DISA predictiva/agéntica, caras por oficio (CRM comercial, agenda, control horario), API/integraciones, app móvil: ⬜.

## Infraestructura / plataforma  ✅ CERRADO
- CERRADA — Producción + HTTPS (systemd + Caddy + comodín Let's Encrypt vía Cloudflare) (2026-06-19).
- CERRADA — Acceso landing → subdominio (Opción A) — `894e750`.
- CERRADA — Backup diario a Google Drive blindado — `3076f68`.
- CERRADA — Panel de superadmin (7 zonas, solo lectura) — `4b9b228`.
- CERRADA — Endurecimiento del borde público (IP real, topes de gasto, rate limits, login) + XSS facturas (A1) — `307632e`, `7eb07f6`.

> `modules/store/` (tienda pública, Capa 2): **APAGADA en D1** (montajes comentados → 404; código en el repo). Su retirada definitiva + archivado de `product_reviews`/`newsletter_subscribers` y limpieza de restos e-commerce = **D2**.
