# U3 — Mensajes de error claros y accionables (propuesta de textos)

> Fase de optimización · Eje A — UX · tarea **U3**. **Solo lectura y propuesta**: aquí NO se
> toca código, lógica de negocio, validaciones, permisos ni la causa de los errores — solo se
> propone **cómo se presenta el texto al usuario**, para que Ibrahin lo apruebe en bloque (igual
> que los ~25 textos de U2).
> Método: barrido completo de admin + portal público (4 clusters), trazando cada `e.message`
> hasta el string real del servidor. Voz de **DISA** en el admin; voz **neutra** en el portal de
> cliente (misma decisión del dueño que en U2). Fecha: 2026-07-07.

---

## 0. Reconciliación con U0 (¿siguen los 16 casos? ¿hay más?)

U0 contó **16 `c.text(e.message)` + 1 error 500 genérico**. Siguen ahí, pero eran la punta del
iceberg: la superficie real de "error crudo al usuario" es bastante mayor y usa **cinco
mecanismos** distintos, no uno:

| Mecanismo | Qué ve el usuario | Nº aprox. |
|---|---|---|
| `c.text(e.message)` / `c.text('…', code)` | **Página de texto plano fuera de la maqueta** | ~22 con `e.message` + ~15 de `404/403` |
| `alert(e.message)` | Cuadro nativo del navegador con el string del servidor | ~30 (admin) |
| `toast(e.message,'err')` | Toast rojo con el string del servidor | ~55 |
| `c.json({error})` → `alert`/`toast` | El **contenido** real que vuelcan los dos de arriba | ~240 respuestas |
| Banner en el DOM (`?err=`, `textContent`) | Portal-admin, seguridad, login, alta | ~20 |

**Conclusión:** los 16 de U0 siguen vigentes y hay **muchos más no vistos entonces** (todo el
front `alert`/`toast`, el `onError` 500 global, el `404` por defecto de Hono, y sobre todo las
**fugas técnicas** de abajo). La buena noticia: gran parte de los ~240 mensajes **ya están en
lenguaje llano** (reglas de negocio tipo "Solo se puede anular una factura emitida"); esos solo
necesitan **presentarse dentro de la maqueta**, no reescribirse. Lo que sí hay que arreglar de
texto es lo **técnico, genérico o filtrado**.

---

## 1. Plantillas reutilizables (el 80 % del arreglo)

Como en U2 (una pieza compartida servía a ~27 pantallas), casi todos los casos se cubren con
**11 textos plantilla**. Aprobando estos 11 se resuelve la mayoría de pantallas de golpe.

| # | Cuándo | Texto propuesto (voz DISA / admin) |
|---|---|---|
| **T1** | Fallo inesperado / 500 / catch sin mensaje ("Error", toast en blanco) | **"No hemos podido completar la acción. Vuelve a intentarlo en un momento; si sigue pasando, escríbenos a soporte."** (versión toast corta: "No se pudo completar. Inténtalo de nuevo.") |
| **T2** | Sin conexión / fallo de red | **"Parece que se perdió la conexión. Revisa tu internet y vuelve a intentarlo."** |
| **T3** | No se pudo cargar una lista / datos | **"No hemos podido cargar los datos. Recarga la página; si sigue igual, inténtalo en un momento."** |
| **T4** | Sin permiso (403) — reemplaza "Acceso no permitido" y los códigos de permiso crudos | **"No tienes permiso para esta acción. Si lo necesitas, pídeselo al dueño o a un administrador del negocio."** |
| **T5** | Datos del formulario inválidos — reemplaza "Datos inválidos" | **"Revisa el formulario: hay algún campo incompleto o con un formato que no cuadra."** |
| **T6** | Duplicado (reemplaza `UNIQUE constraint failed: …`) | Patrón contextual: **"Ya existe [X] con ese/a [dato]. Usa otro/a."** (textos concretos en §2.A5) |
| **T7** | No se pudo generar el PDF (reemplaza `"No se pudo generar el PDF: " + e.message`) | **"No hemos podido generar el PDF ahora mismo. Vuelve a intentarlo en un momento; si persiste, avísanos."** |
| **T8** | No se pudo enviar el email (reemplaza `"No se pudo enviar el email: " + JSON.stringify(error)`) | **"No hemos podido enviar el email. Comprueba la dirección del destinatario e inténtalo más tarde."** *(Corregido 2026-07-07: la propuesta original apuntaba a "Ajustes → Datos del negocio", pero esa pantalla solo guarda el email de contacto del negocio; el envío se habilita por `RESEND_API_KEY` (entorno), no desde una pantalla. Se deja el texto genérico para no señalar un sitio que no resuelve el problema.)* |
| **T9** | Documento no encontrado (reemplaza páginas `c.text('… no encontrada', 404)`) | **"No encontramos [este documento]. Puede que se haya anulado o que el enlace ya no sea válido. Vuelve al listado."** |
| **T10** | Error 500 global (`onError`) — reemplaza la página `"Error interno del servidor"` | **"Algo ha ido mal por nuestro lado. Vuelve atrás e inténtalo de nuevo; si se repite, escríbenos a soporte."** (sin volcar el detalle interno) |
| **T11** | Ruta inexistente (reemplaza el `"404 Not Found"` por defecto de Hono) | **"No encontramos esta página. Puede que el enlace haya cambiado. Vuelve al inicio."** |

---

## 2. Casos por componente / pantalla (pantalla → error actual → texto propuesto)

### A) Transversales (mayor impacto — un arreglo, muchas pantallas)

**A1 · Error 500 global** — cualquier excepción no controlada.
- *Dónde:* todo el admin (`index.js` `onError`, l.1437).
- *Actual:* página de texto plano **"Error interno del servidor"** (y puede haber registrado el `e.message`/stack por dentro).
- *Propuesto:* **T10**.

**A2 · Página inexistente (404 de ruta)** — teclear una URL retirada (p. ej. `/admin/orders`).
- *Actual:* **"404 Not Found"** (texto plano por defecto de Hono; no hay handler propio).
- *Propuesto:* **T11**.

**A3 · Sin permiso (403)** — cualquier acción sin el permiso requerido.
- *Dónde:* modal global (`layout.js:735`) + toast `"Acceso no permitido"` (l.359-360); y **dos casos que filtran el código crudo**: conciliación → *"Registrar el cobro requiere permiso de cobros **(cobros.manage)**."* y *"…requiere permiso de compras **(purchases.create)**."*
- *Actual (modal):* **"No tienes permisos para realizar esta acción."**
- *Propuesto:* **T4** en los tres sitios (fuera el código `cobros.manage`/`purchases.create`).

**A4 · "Datos inválidos"** — cualquier formulario que falla la validación de esquema.
- *Dónde:* alta de OC, factura recibida, compra, proveedor, cliente, producto, etc. (`core/validate.js:18`).
- *Actual:* **"Datos inválidos"** (el detalle campo-a-campo se descarta; en rutas no-API sale una página `400` con la jerga de validación en inglés).
- *Propuesto:* **T5**. *(Mejora opcional futura: nombrar el campo concreto — requiere plumbing, fuera del alcance de U3.)*

**A5 · Fugas de base de datos (`UNIQUE constraint failed`)** — al crear algo con un valor ya usado.
- *Actual (crudo, jerga de tabla/columna):*
  - Categorías: `"UNIQUE constraint failed: categories.name"`
  - Usuarios: `"UNIQUE constraint failed: admin_users.email"`
  - Descuentos: `"UNIQUE constraint failed: discount_codes.code"`
  - Productos (SKU): `"UNIQUE constraint failed: products.sku"` (potencial)
- *Propuesto (T6 contextual):*
  - **"Ya existe una categoría con ese nombre. Usa otro."**
  - **"Ya hay un usuario con ese email."**
  - **"Ese código de descuento ya está en uso. Prueba con otro."**
  - **"Ya existe un producto con ese SKU. Usa una referencia distinta."**

**A6 · Fallo genérico / catch sin fallback** — muchos CRUD hacen `catch(e){toast(e.message,'err')}` **sin** `|| 'Error…'`, y las fichas `catch(e){alert(e.message)}` con fallback `'Error'`.
- *Dónde:* Productos, Categorías, Descuentos, Clientes, Grupos, Usuarios, Ajustes, Proveedores, Almacenes, Inventario, Traslados; fichas de Presupuesto/Pedido/Albarán/Factura/Orden.
- *Actual:* vuelca `e.message` crudo (que ante un 500 es un error SQLite/interno) o un toast en blanco.
- *Propuesto:* **T1** como red de seguridad. *(Los mensajes de regla de negocio ya en llano se conservan — ver §3.)*

**A7 · PDF no generado** — descargar/enviar PDF de presupuesto, pedido, albarán, factura o ticket.
- *Actual:* página **"No se pudo generar el PDF: " + `<e.message>`** (vuelca error interno de Chromium).
- *Propuesto:* **T7**. (Variante neutra para el portal en §2.G.)

**A8 · Email no enviado** — enviar presupuesto/orden por email, recordatorio de cobro.
- *Actual:* **"No se pudo enviar el email: " + `JSON.stringify(error)`** (vuelca el objeto de error de Resend).
- *Propuesto:* **T8**.

**A9 · Documento no encontrado (páginas 404)** — abrir la ficha/PDF de algo anulado o inexistente.
- *Actual:* páginas de texto plano: `"Factura no encontrada"`, `"Presupuesto no encontrado"`, `"Pedido no encontrado"`, `"Albarán no encontrado"`, `"Orden no encontrada"`, `"Ticket no encontrado"`.
- *Propuesto:* **T9** ("…No encontramos esta factura…", etc.), dentro de la maqueta y con enlace al listado.

**A10 · Tokens internos filtrados en mensajes** — aparecen paréntesis técnicos que el usuario no entiende.
- *Actual → Propuesto (limpiar el token, mantener el aviso):*
  - Exceso de stock al facturar/vender: *"…confírmalo explícitamente **(confirm_excess)**."* → **"…Confírmalo para facturar igualmente."** / **"…para vender igualmente."**
  - Entrega de albarán: *"…confírmalo **(confirm_over)**."* → **"…Confírmalo para entregar igualmente."**
  - Ajuste de stock bajo reserva: *"…igualmente **(confirm_below_reserved)**."* → **"…Confírmalo para ajustar igualmente."**
  - Rectificativa: *"Tipo de rectificativa inválido **(R1–R5)**"* / *"Modalidad inválida **(S o I)**"* → **"El tipo de rectificativa no es válido."** / **"La modalidad no es válida."** *(los códigos se eligen en el formulario, no hace falta enseñarlos en el error.)*
  - IDs internos crudos: *"La línea **5** no pertenece…"*, *"**producto 7** no existe"*, *"La factura **12** no es deuda viva…"* → sustituir el número por el **nombre** de la línea/producto/factura, o redacción sin ID: **"Una de las líneas no corresponde a este documento."**

---

### B) Modales compartidos (se reutilizan en varias pantallas)

**B1 · Modal de COBRO** (`cobro-modal.js`) — aparece en Facturas, sección Cobros y ficha de Cliente.
- *Errores actuales:* casi todo `toast(e.message)` (vuelca crudo) con fallbacks tipo `"Error registrando el cobro"`, `"Error enviando"`, `"Error deshaciendo el cobro"`. Textos ya llanos que se conservan: *"El cliente no tiene email. Usa «Registrar contacto»."*, *"Importe inválido"*, *"Indica una fecha"*.
- *Propuesto:*
  - Validaciones ya llanas → **conservar**.
  - Fallos internos → **T1** ("No se pudo registrar el cobro. Inténtalo de nuevo.").
  - Envío de recordatorio fallido → **T8**.
  - *"El cliente no tiene deuda viva que gestionar"* → **"Este cliente no tiene deuda pendiente que gestionar."**
  - *"La factura 12 no admite cobro"* (ID crudo) → **"Una de las facturas seleccionadas ya no admite cobro (anulada o sustituida)."**

**B2 · Modal de PAGO** (`pago-modal.js`) — Facturas recibidas, Pagos a proveedores, deuda del proveedor.
- *Errores actuales:* como B1, `toast(e.message)` + fallbacks `"Error registrando el pago/reembolso"`. Ya llanos y se conservan: *"El pago (X) supera lo pendiente (Y)"*, *"El importe debe ser mayor que 0"*, *"El proveedor no tiene deuda viva que pagar"*.
- *Propuesto:*
  - Validaciones e importes ya llanos → **conservar** (solo pasarlos por toast, no como volcado).
  - Fallos internos → **T1**.
  - *"La factura 12 no es deuda viva de este proveedor"* / *"La factura N recibe más que su deuda pendiente"* (ID crudo) → redacción con el número de factura real o **"Una de las facturas del reparto ya no es deuda viva de este proveedor."**

**B3 · Modal de AJUSTE DE STOCK** (`stock-modal.js`) — ficha de producto, Inventario.
- *Actual:* fallbacks `"Error ajustando"`, `"Error revirtiendo"`; validación *"Cantidad no válida"* (se conserva); y el aviso con token `(confirm_below_reserved)` (ver A10).
- *Propuesto:* fallos internos → **T1**; aviso de reserva → texto de A10; validaciones → conservar.

---

### C) Conciliación bancaria (`conciliacion-routes.js`)
- *Actual:* todo por **página de texto plano** (`c.text`). Incluye los permisos crudos (A3), y **"Error importando: " + `e.message`** (vuelca el parser Norma43). Ya llanos y se conservan: *"Fichero vacío o ilegible"*, *"El pago (X) supera lo pendiente (Y)"*, *"El movimiento ya tiene un estado de conciliación; deshaz primero."*
- *Propuesto:*
  - Permisos → **T4**.
  - Import fallido → **"No hemos podido leer el extracto. Revisa que sea un fichero Norma 43 (.n43) válido y vuelve a subirlo."** (fuera el `e.message` del parser).
  - Resto de fallos → conservar el texto llano, pero **presentarlo dentro de la maqueta** (banner/toast), no como página cruda.

### D) Facturas recurrentes (`recurrentes-routes.js`)
- *Actual:* **páginas de texto plano** `c.text(e.message)`. Los mensajes ya son llanos: *"Fecha de inicio inválida"*, *"Añade al menos una línea"*, *"Este borrador ya se emitió o se omitió"*, *"La plantilla no tiene líneas"*.
- *Propuesto:* **conservar el texto**; solo **presentarlo dentro de la maqueta** (no como volcado de página). Fallo inesperado → **T1**.

### E) Contabilidad — Bienes de inversión (`contabilidad-routes.js` + `contabilidad-bienes.js`)
- *Actual:* **páginas de texto plano** `c.text(e.message)`. Mensajes ya llanos: *"La descripción del bien es obligatoria"*, *"El valor de adquisición debe ser mayor que 0"*, *"La fecha de baja no puede ser anterior a la puesta en funcionamiento"*, etc.
- *Propuesto:* **conservar el texto**; presentar en la maqueta (no página cruda). Fallo inesperado → **T1**.

### F) Envío Verifactu (AEAT) (`verifactu-envio-routes.js`)
- *Actual:* el error de envío **no se muestra como mensaje** (el `catch` es silencioso); el usuario depende del **badge** de estado y de la columna "Detalle", que enseña el **código + descripción crudos de la AEAT** (jerga externa). Aviso sin certificado ya bastante claro.
- *Propuesto (nota, no bloqueante para U3):* mantener los badges (ya en español) y anteponer en "Detalle" una línea llana antes del código técnico, p. ej. **"La AEAT ha rechazado el envío. Detalle técnico: [código] · [descripción]."** El código AEAT se conserva por trazabilidad legal. *(Requiere tocar presentación de esa columna; se puede dejar para una pieza aparte.)*

---

### G) Portal público de cliente (VOZ NEUTRA — sin DISA)
Igual que en U2, el portal mantiene su propio shell y voz neutra. Los textos actuales **ya son
neutros y buenos**; solo se pulen dos:
- *Actual:* **"Enlace no válido o caducado" / "Este enlace ya no funciona. Pide a tu proveedor uno nuevo."** → **conservar** (correcto y neutro).
- *Actual:* PDF → **"No se pudo generar el PDF"** → **"No hemos podido preparar el PDF. Vuelve a intentarlo en un momento."** (neutro).
- *Actual:* factura ajena/inexistente → **"No encontrada"** → **"No encontramos esta factura."** (neutro).

### H) Alta / onboarding conversacional (VOZ DISA — aún no es cliente)
- *Actual → Propuesto:*
  - **"Servicio no disponible. Contacta con soporte."** → **"Ahora mismo no puedo seguir con el alta. Inténtalo en unos minutos o escríbenos a soporte."**
  - **"Error al conectar con DISA."** → **"He tenido un problema para responderte. Inténtalo de nuevo en un momento."**
  - **"Error interno. Inténtalo de nuevo."** (fallback del chat) → **"Algo ha fallado por mi lado. Vuelve a intentarlo."**
  - Ya buenos, se conservan: *"Demasiados intentos. Inténtalo más tarde."*, *"Ya existe una cuenta con ese email. ¿Quieres usar otro?"*, *"Aún no hemos terminado de preparar tu negocio. Vuelve al chat y completa los datos."*, *"Error de conexión. Inténtalo de nuevo."*.

### I) Acceso / Login / 2FA / Contraseña (VOZ NEUTRA de producto)
Los mensajes **ya son claros y accionables** (pantallas de seguridad); se conservan. Solo dos
**avisos de coherencia** (no son cambios de texto de U3, son de lógica — se anotan para que el
dueño decida, no se tocan aquí):
- **Mismatch:** un token 2FA caducado redirige a login y muestra *"Las credenciales no son correctas…"* (no dice "sesión expirada"). Es un tema de **lógica de presentación**, fuera del "solo texto" de U3.
- **Inconsistencia de política:** el reset por email exige **mínimo 8** caracteres y el cambio forzado/Seguridad exigen **mínimo 10**. Es **validación**, fuera del alcance de U3 (se anota para Eje C — Seguridad).

---

## 3. Mensajes que ya están bien (conservar wording; solo presentación)

Gran parte del catálogo ya habla en llano y **no hay que reescribirlo**; solo asegurar que se
muestre dentro de la maqueta (toast/banner), no como página cruda ni alert nativo. Ejemplos:
*"Solo se puede anular un presupuesto emitido"*, *"El pedido no tiene líneas"*, *"Este pedido
tiene albaranes (entregas) confirmados: anúlalos primero…"*, *"Este albarán está facturado en X.
Anula o rectifica antes esa factura por su vía legal."*, *"Ya existe un cliente con ese NIF"*,
*"No se puede archivar el almacén principal: marca antes otro como principal"*, *"El envío de
email no está configurado"*, etc. **Recomendación:** conservarlos tal cual y aplicarles solo el
cambio de mecanismo (dejar de ser `c.text`/`alert` crudos).

---

## 4. Fuera de alcance (no se tocan en U3)

- **`modules/superadmin/`** — consola interna de operaciones (no es el admin del cliente ni el
  portal); tiene `alert(e.message)` pero queda fuera del encargo "admin + portal público".
- **`modules/store/`** — Capa 2 congelada (D1).
- **`feedback.js`** — buzón **desmontado** (rutas comentadas en `routes/index.js`); sus errores no
  son alcanzables hoy.
- **Restos del editor de tienda** en `settings.js` (`"Editor de tienda desmontado (D2)"`, chat del
  store-builder) — código muerto de Capa 2.
- **Causa de los errores, validaciones, permisos y lógica** — no se tocan; U3 es solo presentación.

---

## 5. Cómo se verifica (para cuando se apruebe e implemente)
- `node --check` de los archivos tocados (regresión 0, como en U2).
- Smoke: disparar una muestra de cada plantilla (403 sin permiso, duplicado, PDF forzado a fallar,
  formulario inválido, 404 de ruta) y comprobar que sale el texto nuevo dentro de la maqueta.
- Sin cambios en endpoints, datos ni permisos: **solo texto y mecanismo de presentación**.
