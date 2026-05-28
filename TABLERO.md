# TABLERO — Bamburu (Capa 1)

> Tablero de trabajo. Fuente de verdad de estrategia: CANON.md. Ritual: RITUAL.md.
> REGLA DE ORO: solo UNA tarea en "Haciendo" a la vez. Terminar antes de empezar otra.
> Orden de las tareas: los MOTORES antes que la CARA de DISA (ver CANON sección 9).

---

## 🔵 POR HACER (en orden — coger siempre la de más arriba)

### Bloque A — Motor de facturación (el corazón, lo más urgente)

**A3. Catálogo mixto de servicios**
- Decidir primero: ¿reutilizar tabla de productos (filtrando tipo "servicio") o tabla nueva? (decisión técnica).
- HECHO CUANDO: puedo guardar servicios repetidos (nombre+precio+IVA+IRPF) y elegirlos al facturar, Y escribir una línea libre suelta sin guardarla.

**A4. Generar PDF real de la factura**
- Hoy solo hay HTML imprimible del navegador.
- HECHO CUANDO: la factura se descarga como PDF bien formado.

**A5. QR + leyenda VERI*FACTU en la factura**
- El hash encadenado ya existe; faltan el QR y la leyenda.
- HECHO CUANDO: la factura impresa/PDF muestra la leyenda VERI*FACTU y un QR verificable.

**A6. Enviar factura por email al cliente**
- Resend ya está configurado; falta endpoint + acción.
- HECHO CUANDO: desde una factura puedo enviarla por email al cliente con el PDF adjunto.

### Bloque B — Las otras piezas del núcleo

**B1. Gastos**
- No existe. (Las "compras a proveedores" son coste de mercancía, no gastos del autónomo.)
- HECHO CUANDO: puedo registrar un gasto (concepto, importe, fecha, categoría) y verlo en una lista.

**B2. Cobros (qué me deben)**
- No hay estado de cobro de las facturas.
- HECHO CUANDO: cada factura tiene estado (pendiente/cobrada/vencida) y hay una vista de "qué me deben".

**B3. Panel "cómo va mi negocio"**
- HECHO CUANDO: una pantalla muestra cuánto llevo facturado, qué me deben y mis gastos del periodo.

### Bloque C — La cara de DISA (SOLO cuando A y B funcionen)

**C1. Enfocar DISA en el núcleo del autónomo**
- DISA hoy opera sobre el ERP-tienda. Reorientarla a facturar/cobrar/gastos/panel.
- HECHO CUANDO: puedo decirle a DISA "factúrale 300€ a María por la sesión" y propone la factura correcta para que yo confirme.

**C2. DISA proactiva (avisos)**
- HECHO CUANDO: DISA avisa sola de al menos: cobros vencidos, trimestre de IVA cercano, y caída de facturación respecto al mes anterior.

### Bloque D — Settings del autónomo (NO urgente, va al final)

**D1. Settings del autónomo**
- Hoy `/admin/settings` está pensado para una empresa con tienda online (currency_symbol, document_name, country deshabilitado…). Hay que orientarlo al autónomo de servicios.
- HECHO CUANDO: el autónomo puede ajustar desde una pantalla simple: datos del negocio (nombre, NIF, dirección), logo, IVA por defecto, IRPF por defecto (si ES), y preferencias de impresora (tamaño, márgenes, copias). Cambios efectivos inmediatamente en las facturas nuevas.

---

## 🟡 HACIENDO (máximo UNA)

_(vacío — coger la primera de POR HACER)_

---

## 🟢 HECHO

- **A1. Desacoplar la factura del pedido** — 2026-05-28
  - Se puede crear factura sin pedido desde `/admin/invoices/new` (cliente obligatorio, líneas libres, fecha editable).
  - Numeración correlativa (F2026-NNNN) y hash SHA-256 encadenado funcionando.
  - `POST /api/erp/invoices` con permiso `invoices.create`.
  - `generateInvoice` (flujo POS) intacto, sin regresión.
  - Commit `6f26587`.

- **A2. Líneas de factura con IVA múltiple + IRPF** — 2026-05-28
  - Dropdown IVA por línea (21/10/4/Exento) en `/admin/invoices/new`, dropdown IRPF global (0/7/15) solo si `country='ES'`.
  - Motor único `computeTotals(lines, irpfRate)` (helper puro exportado) + endpoint `POST /api/erp/invoices/compute-totals` para preview en vivo (debounce 300 ms).
  - Vista imprimible con desglose por tasa, "Exento de IVA", IRPF como deducción, badge "Emitida el …" y botón "Volver al listado".
  - Fixes incluidos: DISA emite con `verifactu_hash` intacto (delega en `generateInvoice`); listado `/admin/invoices` ya muestra facturas (bug pre-A1 con `o.reference`).
  - POS intacto, cadena de hashes intacta.
  - Commit `143176e`.

---

## Notas
- Las piezas ya funcionando (multi-tenant, auth, clientes, numeración+hash) NO están aquí: ya están hechas.
- Capa 2 (e-commerce) y Capa 3 (DISA 3 cerebros, Telegram…) NO entran aquí. Congeladas. Ver CANON sección 5.
