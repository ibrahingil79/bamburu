# TABLERO — Bamburu (Capa 1)

> Tablero de trabajo. Fuente de verdad de estrategia: CANON.md. Ritual: RITUAL.md.
> REGLA DE ORO: solo UNA tarea en "Haciendo" a la vez. Terminar antes de empezar otra.
> Orden de las tareas: los MOTORES antes que la CARA de DISA (ver CANON sección 9).

---

## 🔵 POR HACER (en orden — coger siempre la de más arriba)

### Bloque A — Motor de facturación (el corazón, lo más urgente)

**A2. Líneas de factura con IVA múltiple + IRPF**
- Hoy hay un solo tipo de IVA y no hay IRPF.
- HECHO CUANDO: una factura puede tener líneas con distinto IVA, aplica retención de IRPF, y el total se calcula correcto.

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

---

## Notas
- Las piezas ya funcionando (multi-tenant, auth, clientes, numeración+hash) NO están aquí: ya están hechas.
- Capa 2 (e-commerce) y Capa 3 (DISA 3 cerebros, Telegram…) NO entran aquí. Congeladas. Ver CANON sección 5.
