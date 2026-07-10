# Decisiones técnicas — Bamburu

> Decisiones detectadas en código, comentarios y commits, con su porqué y lo descartado.
> Fuente de verdad: el repo (CANON.md, código, historial).

## Producto / arquitectura
- **DISA opera, el dueño decide** (CANON §0). Toda función se construye para que la IA la accione, no solo el humano. *Descartado:* el ERP-archivador clásico que el usuario opera a mano.
- **Un solo motor de venta, varias caras** (CANON §0-bis). Mostrador, agenda y tablero comparten cliente/catálogo/stock/factura; DISA enciende la cara según el negocio. *Descartado:* versiones "fácil" y "pro" separadas.
- **Multi-tenant por archivo** (una `.db` por negocio + `control.db` de enrutado). *Descartado:* BD compartida con columna `tenant_id` (aislamiento más débil).
- **Multi-país como "enchufes":** gestión universal + capa fiscal por país. **España/Verifactu se hace 100% en casa; LATAM vía proveedor externo certificado.** *Descartado:* construir cada fiscalidad a mano.
- **Verifactu multiusuario = COLABORADOR SOCIAL, con UN solo certificado de Bamburu** (decisión de Ibrahin,
  **2026-07-10**). Bamburu se registra ante la AEAT como **envío autorizado** (convenio de colaboración social
  para empresas de sistemas informáticos de facturación, **«Tipo 17»**) y remite los registros de **todos** los
  negocios con **un único certificado propio**. Cada dueño de negocio firma **dentro de Bamburu** una
  **autorización de representación**, que debe quedar **guardada y ser acreditable ante la AEAT**: un "acepto
  los términos" **no basta**. **Ningún usuario final instala certificado.** El motor ya construido (cola,
  agrupación por obligado en un sobre, reintentos, encadenamiento) **se reutiliza tal cual**: solo cambia el
  certificado firmante y se añade el flujo de autorización del cliente. *Descartado:* que **cada negocio
  aporte su propio certificado** (un `.p12` por tenant, como en la prueba de concepto) — pide al cliente un
  trámite que no sabe hacer. **Ojo, el Anexo II no es la alternativa descartada:** es el **modelo de la
  autorización de representación** (Resolución 18-12-2024, BOE 31-12-2024) que se usa **dentro** de este
  modelo, y la AEAT admite capturarlo por formulario dentro del propio SaaS
  (`../verifactu/tarea2-remision-aeat-investigacion.md` §Certificados y multi-tenant).
  *Trámite:* el alta como colaborador social es **legal y externo**, y **solo la puede iniciar el dueño**; se
  hará con la plataforma al 100 %, antes del lanzamiento. **Sin urgencia:** el envío es voluntario hasta la
  obligación general del **1 ene 2027**. Tarea única (no trocear) en `TABLERO.md` → Backlog · Contabilidad.

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
