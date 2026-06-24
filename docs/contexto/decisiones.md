# Decisiones técnicas — Bamburu

> Decisiones detectadas en código, comentarios y commits, con su porqué y lo descartado.
> Fuente de verdad: el repo (CANON.md, código, historial).

## Producto / arquitectura
- **DISA opera, el dueño decide** (CANON §0). Toda función se construye para que la IA la accione, no solo el humano. *Descartado:* el ERP-archivador clásico que el usuario opera a mano.
- **Un solo motor de venta, varias caras** (CANON §0-bis). Mostrador, agenda y tablero comparten cliente/catálogo/stock/factura; DISA enciende la cara según el negocio. *Descartado:* versiones "fácil" y "pro" separadas.
- **Multi-tenant por archivo** (una `.db` por negocio + `control.db` de enrutado). *Descartado:* BD compartida con columna `tenant_id` (aislamiento más débil).
- **Multi-país como "enchufes":** gestión universal + capa fiscal por país. **España/Verifactu se hace 100% en casa; LATAM vía proveedor externo certificado.** *Descartado:* construir cada fiscalidad a mano.

## Datos / motores
- **Stock = libro de movimientos append-only** (`stock_movements`, delta con signo), `products.stock` es caché derivada. Un movimiento es inmutable: para corregir se **revierte**, no se edita. *Descartado:* guardar y pisar el stock.
- **Factura emitida inmutable.** Solo dos operaciones legales: **anular** (`invoice_anulaciones`) y **rectificar** (serie `R`, tipos R1–R5, modalidad sustitución `S`/diferencias `I`, admite abono negativo). En España **no existen notas de crédito/débito** (eso es LATAM). *Descartado:* editar/borrar la factura.
- **Estado de cobro calculado en vivo** (`cobros.js` desde `invoice_payments` + `due_date`), nunca guardado. Qué cuenta como deuda: anulada no; rectificada por sustitución no, por diferencias sí; abono resta. *Descartado:* un campo `pagada` que se desincroniza.
- **IVA vs IRPF modelados aparte:** IVA depende del **producto + país** (banda legal en `vat-bands.js`, no un número tecleado); IRPF depende de **quién factura y a quién** (settings + factura, en Ventas). *Descartado:* mezclar ambos en el producto.
- **Verifactu:** huella SHA-256 **en mayúsculas, encadenada**, tipo-agnóstica sobre `TipoFactura` (F1 ordinaria, F2 simplificada, F3 sustitución, R1–R5 rectificativas), + QR de cotejo y leyenda. Envío a la AEAT aún pendiente.
- **Mostrador = factura simplificada (serie propia `S`, tipo F2), cobro al momento.** El ticket puede canjearse por factura completa = **sustitutiva F3** (hereda el cobro, no duplica). El POS viejo (`sales_orders`) queda vivo solo por URL; su retirada es trabajo aparte (PIEZA C).
- **Migraciones lazy, idempotentes y aditivas; archivar, nunca DROP** (rename a `_legacy`/`_archived`, flags en `settings`).

## DISA
- **`query_database` (SELECT arbitrario, tablas de sistema protegidas, máx. 4 llamadas/mensaje)** + esquema de BD inyectado, para responder consultas fuera del resumen. *Descartado:* un resumen fijo agregado (BUG #1).
- **Operaciones genéricas `insert/update/delete_record` sobre una whitelist `WRITABLE_TABLES`.** *Descartado:* un `case` hardcodeado por entidad (BUG #2).

## Plataforma / proceso
- **PDF real con un generador Chromium compartido** (`core/pdf.js`) cableado a los 4 documentos. *Descartado:* un generador por documento.
- **Superadmin separado del admin de negocio** (rol propio en control.db, solo lectura sobre las `.db`).
- **`NODE_ENV` sin definir a propósito** en producción (decisión del dueño: DISA sin tope de mensajes en beta).
- **Cierre en dos pasos:** Claude Code verifica y para → Ibrahin valida en navegador real → commit. Headless no basta (ver flujo-de-trabajo.md).

## [PENDIENTE]
- No hay `CONTEXT_ENGINEERING.md` en el repo aunque `CLAUDE.md` lo cita: [PENDIENTE: confirmar si se renombró o se perdió en la migración].
