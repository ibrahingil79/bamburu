# Auditoría de backlog — inventario de lo pendiente y lo prometido

> **Solo lectura.** No se tocó ni un archivo de programa, ni un dato, ni un arreglo. El único archivo
> escrito es este. Fecha: **2026-07-17**. Estado del árbol al auditar: `master` de `cdde2d8` a
> **`0e7092d`** — C5-ter se commiteó y pusheó *durante* la auditoría (17-jul 08:07); este documento
> refleja el árbol **después** de ese commit.
>
> **Para qué sirve.** El chat de planificación solo ve Notion, y Notion es panel: KPIs, tiempo y
> "dónde sigo". La fuente de verdad es el repo. Esto es la foto real de todo lo que se pidió, se
> prometió o se dejó escrito como futuro y **aún no está hecho** — con el acento en las **peticiones
> expresas que quedaron aparcadas y ya nadie menciona**.
>
> **Regla aplicada:** cada ítem cita dónde está escrito. Lo que no tiene fuente, no entra.

## Cómo se lee

Cada ítem lleva su **estado real detectable**, no el que dice el TABLERO:

- **PARADO** — backlog por orden de construcción. Correcto que no esté hecho.
- **PLANIFICADO-NO-HECHO** — hay plan escrito, cero código.
- **A MEDIAS** — empezado y sin cerrar.
- **YA RESUELTO** — el texto lo declara futuro, pero está hecho. Texto viejo que engaña.

**⚑ = petición expresa de Ibrahin que quedó aparcada** (no backlog natural). Son los que se están
perdiendo de vista.

**Fuentes rastreadas:** `TABLERO.md` (1.489 líneas, entero) · `CANON.md` · `RITUAL.md` · `CLAUDE.md` ·
`session.json` · árbol de trabajo (`git status`/`git diff`) · comentarios de todo el código
(`index.js`, `modules/`, `core/`, `scripts/`, `docs.html.js`) · los 22 `.md` de `docs/` · raíz
(`BUGS_DISA.md`, `DISEÑO.md`, `MAPA_FUNCIONAL.md`, `TAREAS.md`, `PROYECTO.txt`) · los 264 mensajes de
commit (25-may → 16-jul).

---

## 0. Lo que hay que mirar primero

Tres cosas que no salen en ningún sitio y cambian lo que toca hacer:

1. **Cinco cabeceras del código declaran "fuera de alcance" cosas que ese mismo fichero ya hace.**
   Una de ellas **se lo dice al cliente en pantalla**: Conciliación anuncia que no cruza gastos
   cuando el cruce existe y está verificado. Ver §8 — son minutos de trabajo y están en el sitio
   donde alguien va a buscar la verdad.
2. **"COMPLETO" no quiere decir "sin nada dentro".** El **Eje C** se cerró con **B10 (systemd)**
   aplazado por escrito, y el **Pilar 3** se cerró con **cuatro flujos que fallan cerrado** ante un
   producto con lote/serie (compra directa, ajuste, traslado, devolución a proveedor). Ninguna de las
   dos cosas es un error — están decididas, con dueño y por escrito — pero un rótulo ✅ leído desde
   Notion no lo transmite, y es justo lo que un chat de planificación a ciegas va a dar por hecho.
3. **El texto viejo se genera más rápido de lo que se limpia, y esta misma auditoría lo vio pasar en
   directo.** C5-ter se cerró a las 08:07 de hoy, mientras se escribía esto — y su cierre dejó al
   instante un texto obsoleto: la ficha de C6 (`TABLERO.md:995-998`) sigue diciendo que el email en
   `security_events` está *"anotado sin arreglar… Decidir a conciencia"*, cuando T2 acaba de
   arreglarlo. No es un descuido de nadie: es el coste normal de cerrar una tarea. Por eso §8 no es
   una lista de reproches, es mantenimiento recurrente.

---

## 1. NÚCLEO (Pilares 1–4: Catálogo · Cliente · Inventario · Ventas)

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| Convertir un presupuesto en ticket de mostrador: el destino está registrado y el botón existe deshabilitado, pero nadie lo construyó | `modules/erp/routes/quotes.js:185,191,734` · `modules/erp/schemas.js:219` | **A MEDIAS** — y la excusa caducó: el 501 dice *"se construye con la pieza de TPV"*, y el TPV **ya existe** (`invoices.js:660`, `verify-mostrador.mjs`) |
| Convertir solo una parte de un documento (hoy o entero o nada); el esquema ya lo admite | `modules/erp/models.js:1461` · `quotes.js:186` | PARADO |
| Cuatro flujos no saben manejar productos con lote/serie y se niegan en seco: compra directa, ajuste manual, traslado y devolución a proveedor | `modules/erp/trazabilidad.js:20-25` · `stock.js:186-188` · `supplier-returns.js:9` · `TABLERO.md` §Inventario (l.1430) | PARADO — recorte deliberado, pero el Pilar 3 se declara CERRADO con esto dentro |
| Recibir una compra en varias entregas (el flujo nuevo de orden de compra sí lo hace; el camino viejo no) | `modules/erp/routes/purchases.js:16` | PARADO — acotado al camino legacy |
| Guardar el IBAN y los datos bancarios del proveedor | `modules/erp/models.js:679` (*"queda en cola"*) | PARADO |
| Emitir las facturas recurrentes solas, sin que nadie las revise (interruptor por plantilla) | `modules/erp/recurrentes.js:7` · `TABLERO.md` §Backlog (l.1406) | PARADO — choca con confirm-first, es decisión de producto |
| Mandar el PDF por email de cada documento (hoy solo el presupuesto) | `TABLERO.md` §Backlog (l.1407) · `docs/contexto/piezas-cerradas.md` §Pilar 4 | PARADO |
| Que el dueño personalice las plantillas de sus documentos (facturas, albaranes…) | `TABLERO.md` §Backlog (l.1408) | PARADO |
| Cobrar con tarjeta desde el portal del cliente — el único paso que le falta al portal | `TABLERO.md` §Backlog (l.1403) · `modules/portal/portal.js:5` · `modules/portal/admin.js:29` | PARADO — espera decisión de proveedor y coste del dueño |
| Ver y copiar el enlace del portal desde el admin (hoy solo se manda por email) | `TABLERO.md` §Backlog (l.1404) | PARADO |
| Que el cliente acepte presupuestos y haga pedidos B2B con carrito desde el portal | `TABLERO.md` §Backlog (l.1405) | PARADO |
| Subir productos en bloque desde un CSV — **prometido al usuario en la ayuda pública** | `docs.html.js:630` (*"está en el roadmap"*) | PARADO — es la única promesa hecha de cara al cliente |
| Que el dueño configure cada cuánto se reclama un cobro (hoy las cadencias van fijas) | `modules/erp/cobros.js:159` (*"Las cadencias van FIJAS en MVP"*) | PARADO |
| Enseñar en el panel las facturas impagadas cuyo cliente no tiene email (el dato ya se calcula, solo falta pintarlo) | `modules/erp/propuestas.js:64` | PARADO — fruta madura |
| Sincronizar con Shopify / Woo / Prestashop | `TABLERO.md` §Inventario (l.1434) | PARADO — Capa 2 congelada |

---

## 2. EL SUELO (Verifactu · motor contable · multiusuario y permisos)

### Verifactu

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| ⚑ **Verifactu para clientes de verdad**: registrarse como colaborador social, un certificado único de Bamburu, pantalla de autorización de representación, activar y probar. **Tarea única, no trocear** | `TABLERO.md` §Backlog (l.1306-1326) · `docs/contexto/decisiones.md` (2026-07-10) | PARADO — *"A ejecutar cuando Ibrahin lo indique"*. Trámite legal externo, solo lo inicia él. Sin urgencia hasta el 1-ene-2027 |
| El temporizador que vacía la cola de envíos a Hacienda **no está instalado en el servidor** | `docs/verifactu/estado-certificado.md` §Estado (l.39-42) | PARADO — **verificado**: `deploy/systemd/bamburu-verifactu-cola.{service,timer}` existen en el repo, no en `/etc/systemd/system/`. El doc dice *"instalarlo es inocuo"* |
| ⚑ Comunicar a Hacienda las facturas **anuladas** (hoy solo se comunican las altas) | `TABLERO.md` l.1335, l.1086, l.1149 · `docs/verifactu/tarea2-cola-envio-automatico.md` §Pendiente | PARADO — *"para encargos propios"* |
| ⚑ Subsanar el aviso 2004 de la factura de prueba que llegó tarde | `TABLERO.md` l.1148 · `docs/verifactu/estado-certificado.md` l.81 | PARADO — el doc subraya que *"se puede hacer en cualquier momento, sin depender de nada"* |
| Tres negocios (`duniya`, `rachibra`, `inversiones-disan`) no tienen NIF configurado: su cabecera saldría vacía ante la AEAT | `TABLERO.md` l.1088 · `docs/verifactu/estado-certificado.md` §Cabos sueltos (l.52-55) | PARADO — hoy teórico (su cola no arranca); real el día que se active. C1 puso candado al *cambio* de NIF, no al NIF *vacío* |
| Revisar la seguridad de `verifactu-cola.js` y sus unidades systemd **antes** de activarla | `TABLERO.md` §Auditoría del 9-jul (l.1014) · commit `14b6c1e` | PARADO — prerequisito explícito de la tarea de arriba |
| Validación XSD formal integrada en el motor | `TABLERO.md` l.1335 | PARADO — matiz: la validación *puntual* con `xmllint` contra los XSD oficiales sí se hizo en Fase A |
| El bug de encadenado: elegir el registro anterior por `id` sin filtrar por emisor | `TABLERO.md` l.1087 (*"sigue vivo"*) y l.1145 (*"Latente"*) | **YA RESUELTO** — lo cerró **C1** el 15-jul (`2fdc9bf`, gate 18/0, `TABLERO.md:589`). Las dos listas de "fuera de alcance" no se actualizaron |
| Probar la cola con envío real a preproducción usando el `.p12` del dueño | `docs/verifactu/tarea2-cola-envio-automatico.md` §Pendiente (l.143-157) | **YA RESUELTO** (superado) — `estado-certificado.md` decide: *"No hay que activar nada con el `.p12` personal"*; la activación llega con el certificado de Bamburu |
| Semántica de los puertos "Sello" de la AEAT · lista completa de códigos de error | `docs/verifactu/tarea2-remision-aeat-investigacion.md` §Sin confirmar (l.87-91) | PARADO — sin confirmar, no se usan hoy |

### Facturae

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| Firmar la factura electrónica con validez legal (XAdES-EPES) y mandarla a FACe | `TABLERO.md` l.1377-1385 · `docs/facturae/investigacion.md` §7 (l.350-357) | PARADO — bloqueado por certificado |
| **Construir y probar la firma entera con un certificado autofirmado, que se puede hacer YA sin el FNMT** | `docs/facturae/investigacion.md` §7 punto 8 (l.347-348) | **PLANIFICADO-NO-HECHO** — el propio doc lo clasifica como *"se puede construir hoy, entero y probado (sin certificado)"*. Es el más accionable de los bloqueados |
| Guardar el `.xsig` firmado byte a byte (no se puede regenerar) | `docs/facturae/investigacion.md` §6 (l.316-322) | PARADO — depende de la firma; sitio ya previsto (`attachments.js`) |
| El segundo formato de factura (UBL) que el RD 238/2026 obligará a mandar en paralelo | `TABLERO.md` l.1386 · `modules/erp/facturae/facturae322.js:4` · `routes/invoices.js:18` | PARADO — la arquitectura ya se hizo para esto |
| Traducir la forma de pago (texto libre) al código oficial `PaymentMeans` | `docs/facturae/investigacion.md` §7 punto 6 (l.343) | PARADO |
| Los tres códigos DIR3 que exige la Administración en `BuyerParty` | `docs/facturae/investigacion.md` §5 (l.249-250) | PARADO — los aporta el cliente, Bamburu no puede inventarlos |
| Confirmar contra qué versión de XAdES valida FACe · cuadrar las huellas `.sha1`/`.sha2` de la política de firma · límites de tamaño · calendario Peppol/FACeB2B | `TABLERO.md` l.1385 · `docs/facturae/investigacion.md` §9 (l.383-394) | PARADO — sin confirmar; las huellas bloquean la firma |
| 8 facturas viejas con desglose de IVA roto que no pueden convertirse a Facturae | `TABLERO.md` l.1374 | PARADO — decisión tomada: bloquear con mensaje propio, no inventar el reparto |
| Decidir y documentar el mapeo R1–R5 → `ReasonCode` + `CorrectionMethod` | `docs/facturae/investigacion.md` §7 punto 7 / §9 | **YA RESUELTO** — está decidido y escrito en `TABLERO.md:1352` |

### Contabilidad

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| **Balance de Situación** — necesita antes saldos de apertura + capital + capitalización de inmovilizado | `TABLERO.md` l.1392 · `modules/erp/routes/contabilidad-routes.js:32` (*"sitio previsto para el futuro Balance"*) | PARADO — hay hueco de UI reservado desde el 6-jul |
| Volcar la amortización al diario como asiento — hoy la cuenta de resultados no la incluye **y lo avisa en pantalla** | `TABLERO.md` l.1395 · `modules/erp/contabilidad-pyg.js:106` | PARADO — mismo racimo que el Balance |
| Los modelos de Hacienda que faltan: 111/115/123, 349, 347, 390, 200/202 | `TABLERO.md` l.1396 · `docs/ESTRATEGIA-NICHOS.md` §Ampliaciones D1 | PARADO — 303/130 ✅ |
| Calcular el importe de 111/115 y anuales: hoy DISA avisa de la fecha y no inventa cifra | `modules/erp/routes/propuestas.js:262,285` · `modules/erp/propuestas.js:332` | PARADO — depende del punto anterior |
| Cuentas anuales y legalización de libros | `TABLERO.md` l.1393 | PARADO |
| Plan de cuentas con subcuentas | `TABLERO.md` l.1394 | PARADO |
| IRPF en las compras (hoy solo se modela el soportado en ventas) | `TABLERO.md` l.1397 | PARADO |
| Que la gestoría entre a la contabilidad con su propio permiso | `TABLERO.md` l.1398 | PARADO |
| Mejoras de la pantalla de libros: ir al documento de origen, buscar, filtrar, resumen por tipo de IVA, bloqueo de periodo presentado, asiento resumen de tickets | `TABLERO.md` l.1399 | PARADO |
| Conciliación: importar extracto en **CSV genérico** (hoy solo Norma 43) | `TABLERO.md` l.1400 · commit `c3fa320` | PARADO — *"añadido barato"* |
| Conciliación automática vía **PSD2 / Enable Banking** | `TABLERO.md` l.1400 | PARADO — la costura ya lo prevé |
| El IVA se calcula en 6 sitios copiados y pegados | `docs/INVESTIGACION_A2.md` §7.1 (l.152) | PARADO — parte se evaporó al archivar el POS/checkout (Capa 2) |
| **"0 %" y "exento por ley" son la misma cosa en el código, y en Verifactu no lo son** | `docs/INVESTIGACION_A2.md` §4.8 (l.197) · `modules/erp/schemas.js:539` | PARADO — riesgo de cumplimiento, no cosmético |
| El IRPF solo se aplica a negocios españoles; los demás lo ignoran **en silencio** | `modules/erp/routes/invoices.js:215` | PARADO — el "en silencio" es lo que huele |
| Las bandas de IVA solo están pobladas para España | `core/vat-bands.js:5,20` | PARADO — degrada de forma controlada |
| `companySchema` acepta cualquier campo sin validar (`passthrough()`) | `docs/INVESTIGACION_A2.md` §7.5 (l.156) | PARADO — el doc dice *"un cambio de 3 líneas pero importante"*; conviene confirmar contra el código de hoy |
| Nadie puede ver cuánto IVA debe este trimestre | `docs/INVESTIGACION_A2.md` §7.8 | **YA RESUELTO** — Contabilidad Pieza 4 (modelos 303/130) |
| Los tipos de IVA por país están en la BD y nadie los lee | `docs/INVESTIGACION_A2.md` §7.2 | **YA RESUELTO** — `routes/invoices.js:1189,1491` ya hacen `getCountryConfig()` |
| DISA emite facturas saltándose la cadena legal de hashes | `docs/INVESTIGACION_A2.md` §7.3 / §4.2 | **YA RESUELTO** — las acciones de pedido de DISA se retiraron (10-jul) |
| `sales_orders` no guarda el tipo de IVA, solo el importe | `docs/INVESTIGACION_A2.md` §7.4 | **YA RESUELTO** — la tabla se archivó en D1 |
| El cruce de gastos de la conciliación es "una pieza posterior" | `modules/erp/conciliacion.js:187,293` | **YA RESUELTO** — es la Pieza 2, `conciliacion.js:324` + `verify-conciliacion-gastos.mjs` |

### Multiusuario y permisos

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| **Paso 1** — repasar TODAS las rutas y confirmar que cada acción exige su permiso, no solo sesión | `TABLERO.md` §Multiusuario (l.1437) | PARADO — **el Paso 2 no arranca sin esto** |
| **Paso 2** — que el dueño gestione usuarios y accesos hablando con DISA | `TABLERO.md` §Multiusuario (l.1437) | PARADO — depende del Paso 1 |

---

## 3. EL FOSO (CRM · API · móvil · interfaces por profesión)

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| Que DISA hable sobre el embudo de oportunidades | `TABLERO.md` §CRM (l.1268) | PARADO — se registró como fuera de alcance del encargo de CRM |
| Registrar actividad de un cliente desde su propia ficha (hoy solo desde `/admin/crm`) | `TABLERO.md` §CRM (l.1269) | PARADO |
| **Agenda / calendario** — marcada 🔺 prioritaria en el roadmap | `TABLERO.md` §CRM (l.1269) y §Roadmap (l.1471) | PARADO |
| Lo NO VERIFICABLE del benchmark de CRM (11 puntos: nombres de etapas de Holded, API, encabezados de Salesforce…) | `docs/crm/embudo-referencia.md` §6 (l.171-187) | PARADO — probablemente no se pueda verificar nunca; consta a propósito |
| Las probabilidades 10/30/60/85 y la lista de motivos de pérdida son **propuesta razonada, no dato de fuente** | `docs/crm/embudo-referencia.md` §3 (l.117), §5 (l.166) | PARADO — nota de método, para que no se lea como verificado |
| **Interfaces por profesión**: qué ve cada oficio, la ventaja real por nicho, el catálogo de funciones "para ser el mejor" | `docs/ESTRATEGIA-NICHOS.md` §1-3 (*"Pendiente de desarrollar"*) | **PLANIFICADO-NO-HECHO** — el documento entero es un esqueleto; es una pata de El Foso en CANON §7 |
| Tableros de proyecto (Kanban / Gantt) + rentabilidad por proyecto + cronómetro de horas | `docs/ESTRATEGIA-NICHOS.md` §Ampliaciones D2 · `TABLERO.md` §Holded (l.1479) | PARADO |
| **API pública / webhooks** · **app móvil nativa** — dos patas de El Foso en CANON §7 | `CANON.md` §7 · `TABLERO.md` §Roadmap (l.1471) · `docs/contexto/piezas-cerradas.md` §El Foso | PARADO — verificado: no hay módulo de API ni webhooks |
| El resto del roadmap: Control horario · TPV/POS completo · Parte de obra · SEPA · Telegram · Mapas · Documentos · Integraciones/marketplace · Dashboards personalizables · Multiempresa · Fabricación · Multi-moneda · Firma digital · Previsión de caja · Proyectos · Partes de horas · Servicio de campo · Helpdesk | `TABLERO.md` §Roadmap futuro (l.1471) | PARADO — no iniciar sin encargo |
| De la auditoría vs Holded: **RRHH** (ficha de empleado, nóminas, organigrama) · **Analítica** (informes por área + plan financiero) · importar contactos en bloque · buzón de email para tickets de gasto · búsqueda global · creación rápida universal · sidebar personalizable | `TABLERO.md` §Holded (l.1473-1484) | PARADO — solo documentación, sin fecha |
| SII · TicketBAI | `docs/contexto/arquitectura.md` §"Qué NO existe" (l.43-44) | PARADO |

---

## 4. DISA

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| **DISA sabe hacer 16 cosas que nadie le ha contado al modelo** (editar/borrar productos, variantes, categorías, descuentos, proveedores): tienen `case` y permiso, pero el prompt solo declara `create_product` | `docs/disa/auditoria-disa-d0.md` §1.2 (l.71-78) y §6/D3 · `TABLERO.md` l.268 (*"no se tocaron; es decisión de D5"*) | PARADO — **verificado**: el bloque `## ACCIONES DISPONIBLES` (`modules/disa/index.js:2341`) sigue sin anunciarlas, con 37 `case` vivos en el fichero |
| Una lista de acciones "solo para jefes" declarada y que **no lee nadie** | `docs/disa/auditoria-disa-d0.md` §1.2 (l.88-89) | PARADO — **verificado**: `ADMIN_ONLY_ACTIONS` aparece **1 sola vez** en `modules/disa/index.js` (su declaración, l.236) |
| Avisar en vivo (SSE) en vez de preguntar cada 60 segundos | `TABLERO.md` l.471 · `docs/disa/auditoria-disa-d0.md` §6/D5 y §3 | PARADO — el resto del diseño de D5 |
| Que DISA proponga desde la propia campana ("¿reclamo este cobro por ti?") | `TABLERO.md` l.471 · `docs/disa/auditoria-disa-d0.md` §6/D5 | PARADO |
| Séptimo tipo de propuesta: subsanación de Verifactu | `TABLERO.md` l.470 | PARADO |
| Propuestas de pago para facturas de proveedor **ya vencidas** (D5b solo cubre las que están a punto de vencer) | `TABLERO.md` §D5b (l.290) · commit `c0e449f` | PARADO — recorte deliberado de la pieza |
| El **calendario fiscal como fuente de la campana** de avisos | `TABLERO.md` §Avisos (l.260) · `docs/disa/diagnostico-avisos.md` §1 | PARADO — **matiz importante**: el motor `modules/erp/calendario-fiscal.js` **ya existe** (lo construyó D5e) y alimenta las propuestas; lo que falta es enchufarlo a la campana (`avisos.js` tiene 6 fuentes y ninguna fiscal) |
| Que DISA cree devoluciones y hable de stock/compras | `modules/disa/index.js:201` | PARADO |
| Que DISA escriba sobre pedidos y albaranes (hoy solo lee) | `modules/disa/index.js:207` | PARADO |
| `create_order` multi-línea | `TABLERO.md` §Deuda técnica (l.1466) | PARADO — limitación heredada |
| La campana no baja sola al resolver algo en Cobros/Pagos sin navegar | `TABLERO.md` §Avisos (l.1232) · `docs/disa/diagnostico-avisos.md` §3 | PARADO — hoy es un `fetch` por pantalla (`window.bellSync` ya existe) |
| `estadoAvisos()` cuesta 4 ms en **cada** página del panel y crece con el nº de facturas | `TABLERO.md` §Avisos (l.1234) | PARADO |
| Mensajes de depuración de DISA en producción (`[DISA] Usando BD:`, `[DISA THREADS] userId:`…) | `BUGS_DISA.md` §PENDIENTE (l.101-118) | PARADO — **verificado que siguen** (`modules/disa/index.js:1085,1087,1089,2026`). **`TAREAS.md:69` afirma "[x] Logs debug DISA eliminados": es falso** |
| El correo diario no filtra por usuario | `docs/disa/auditoria-disa-d0.md` §2.3 (l.154-156) | **No es tarea** — es por diseño (va al negocio, no a una persona). Consta para que no se relea como olvido |
| La marca `🟡` de D5 y *"Dos piezas HECHAS"* | `TABLERO.md` l.271 | **YA RESUELTO** — hay **seis** piezas (D5, D5b–D5f) y el rótulo del eje dice ✅ COMPLETO. El marcador interno no se actualizó |

---

## 5. SEGURIDAD (Eje C)

> **Cerrado durante esta auditoría (17-jul 08:07, `0e7092d`):** **C5-ter**, sus dos mitades — el
> cerrojo "he guardado mis códigos" del superadmin (T1) y sacar el email de `security_events` (T2).
> Eran los dos cabos que el Eje C dejó anotados el 16-jul. Ya no son pendientes; salen del inventario
> y su rastro queda en §8, porque su cierre dejó texto viejo detrás.

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| ⚑ **B10 · Endurecer el arranque del servicio (systemd)** — el único de los doce BAJA que puede tirar el servicio | `TABLERO.md` §C6 (l.957-959) · `docs/seguridad/auditoria-ejeC.md` §C6 (l.409-413) · commit `b7148ac` | PARADO — aplazado **con protocolo escrito**: solo, nunca mezclado, con verificación en vivo. El Eje C se declaró CERRADO con esto fuera |
| **B5** · Una cookie del navegador elige a qué base de datos se apunta | `TABLERO.md` §C6 (l.952) · `docs/seguridad/auditoria-ejeC.md` §C6 (l.388-393) | PARADO — riesgo asumido con dueño y fecha. Reabrir si alguna ruta llegase a leer `c.get('db')` sin pasar por `adminAuth` |
| **B11-tienda** · La cookie de la tienda viaja sin `Secure` | `TABLERO.md` §C6 (l.952) | PARADO — riesgo asumido; entra **con** la reactivación de la tienda, no antes |
| ⚑ **B12** · Tres tablas de roles sembradas que no conceden permiso a nadie | `TABLERO.md` §C6 (l.952) · `docs/seguridad/auditoria-ejeC.md` §C6 (l.399-405) | PARADO — *"retirar o cablear no es higiene: es una decisión de diseño del modelo de permisos, que le toca al dueño y merece tarea propia"* |
| **C4b-3** · CSP estricta en la tienda (20 handlers) | `TABLERO.md` §C4b-3 (l.802-807) | PARADO — decidido NO mientras esté apagada; entra con la reactivación |
| **C4b-4** · CSP estricta en el ERP + DISA (489 handlers) | `TABLERO.md` §C4b-4 (l.809-834) | PARADO — deuda aceptada, con dueño y por escrito. Si se hace: por pantalla, con `CSP_PROBE=1`, pulsando los ~470 botones uno a uno |
| `style-src` se queda con `unsafe-inline` (2.027 `style="..."`) | `TABLERO.md` §C4b (l.836-838) | PARADO — a propósito y por escrito; es inyección de estilo, no de código |
| Las copias de seguridad van a **un único Google Drive personal**, sin segundo proveedor | `docs/seguridad/auditoria-ejeC.md` §"No verificado" (l.285-286) | PARADO — C2 verificó que el remoto funciona, no añadió redundancia. Sin tarea en el TABLERO |
| `otplib` está en `dependencies` y en producción no lo importa nadie | `TABLERO.md` §C5 (l.877-879) | PARADO — **verificado**: sigue en `dependencies` (`package.json:16`) |
| El login del superadmin comprueba la contraseña pero ignora `needsRehash`: esa contraseña no migrará nunca | `TABLERO.md` §Rendimiento (l.1189) | PARADO — **verificado**: `modules/superadmin/index.js:131` (el informe decía `:94`; la línea derivó) |
| Cada respuesta 429 hace un INSERT en `control.db`: una petición bloqueada cuesta más que una servida | `TABLERO.md` §Rendimiento (l.1191) · `docs/rendimiento/diagnostico-carga.md` §Hallazgo 2 (l.45) | PARADO — **verificado**: `core/rate-limit.js:46,122` |
| Separar el cupo del freno **por persona** dentro de un mismo negocio (hoy los compañeros de una oficina comparten cubo por IP) | `TABLERO.md` §Rendimiento (l.1188) · `index.js:39` | PARADO |
| ~14 ficheros definen su propio `esc` — es `core/escape.js` duplicado | `TABLERO.md` §C4a-bis (l.713-716) | PARADO — **verificado: son 20**. No es un agujero, es la causa de que los agujeros se repitan |
| Escapes parciales fuera del inventario de M1 | `TABLERO.md` §C4a-bis (l.715) → `modules/erp/layout.js:111,186,300` · `email-templates.js:28` · `contabilidad-export.js:136` | PARADO — verificados los tres de `layout.js`; el último es escape XML (otro contexto) |
| **D3** · Un documento de pedido titulado "FACTURA" que no es la factura Verifactu | `TABLERO.md` §Riesgos (l.1440) · `routes/orders.js:442` | PARADO — *"verificar que ya no es alcanzable y decidir renombrar/retirar/aclarar"* |
| **D6** · XSS en las páginas públicas de la tienda | `TABLERO.md` §Riesgos (l.1441) | PARADO — a verificar **antes** de reabrir Capa 2 |
| El superadmin muestra errores crudos con `alert(e.message)` | `docs/ux/u3-textos-errores.md` §4 (l.200-209) | PARADO — quedó fuera del encargo de U3; es el único de los cuatro con impacto real (los otros son código muerto/congelado) |
| **Códigos de recuperación del 2FA**: *"ninguna de las implementaciones los tuvo nunca… necesario antes de empujar el 2FA a los clientes"* | `TABLERO.md` §Cola del Eje A (l.245-247) · `scripts/reset-admin.js:38` (*"los admin de negocio no tienen códigos de rescate… para los dueños es tarea aparte"*) | **YA RESUELTO** — C5 los dio al superadmin y **C5-bis a los dueños** (`core/recovery-codes.js`, tabla `admin_recovery_codes`, `core/auth.js:131-150`). **Los dos textos están viejos** |
| La contraseña pedía mínimo 8 en un sitio y 10 en otro | `docs/ux/u3-textos-errores.md` §2.I (l.183) | **YA RESUELTO** — cerrado como **B3** en C6 (mínimo 10 en servidor y pantalla) |
| Los 4 puntos que la auditoría no pudo verificar sin administrador | `docs/seguridad/auditoria-ejeC.md` §"No verificado" (l.281-292) | **YA RESUELTO** — C2 los verificó los cuatro: ningún problema, ninguna tarea nueva |

---

## 6. UX (Eje A)

> Bloque añadido a la clasificación pedida: el Eje A produjo material propio que no encaja en los
> otros cinco y se perdería.

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| ⚑ **Motor de traducción (i18n)**: el usuario elige idioma, se le guarda, y la interfaz sigue en español — la pantalla se lo confiesa | `TABLERO.md` §Cola del Eje A (l.242-244) · `modules/erp/paises-telefono.js:89-92` · `models.js:2240-2242` | PARADO — **verificado**: no hay i18n de ningún tipo; `lang="es"` a mano en los 5 módulos. `admin_users.idioma` es decorativa |
| ⚑ **Tres pantallas vivas que no están en ningún menú**: `/admin/analytics`, `/admin/discounts`, `/admin/tags` | `TABLERO.md` §Cola del Eje A (l.248) y §U7 (l.156-158) — *"decisión del dueño: se abordarán luego"* | PARADO — **verificado**: las tres siguen montadas (`routes/index.js:102,110,113`) y no aparecen en el menú; `navPerms.analytics` sigue existiendo sin item que lo use |
| **U1b** — los colores translúcidos de DISA (~8 alfas) y el `printableShell` con su `:root` propio, fuera del sistema de tokens | `docs/ux/u1-diagnostico-tokens.md` §5.bis (l.153) y §5.ter (l.177-178) | **PLANIFICADO-NO-HECHO** — **verificado: "U1b" no existe en el TABLERO**. Se prometió dos veces en un doc y nunca llegó a ser tarea |
| Cuando un formulario falla, decir **qué campo** falla y no solo "revisa el formulario" | `docs/ux/u3-textos-errores.md` §2.A4 (l.78) | PARADO — *"requiere plumbing, fuera del alcance de U3"*; nunca llegó al TABLERO |
| Traducir el rechazo de Hacienda a español antes del código técnico | `docs/ux/u3-textos-errores.md` §2.F (l.160) | PARADO — aplazado a *"pieza aparte"*; nunca llegó al TABLERO |
| Si se te caduca el 2FA te dice "las credenciales no son correctas", que es mentira | `docs/ux/u3-textos-errores.md` §2.I (l.182) | PARADO — *"lógica de presentación, fuera del solo-texto de U3"*; nunca llegó al TABLERO |
| ⚑ **DISA fija con contador en el rail** + **"Ayuda y soporte" al pie** — las dos piezas del diseño aprobado que no se construyeron | `DISEÑO.md` cabecera (l.14-15) y §3.1 | PARADO — el resto de la cabecera (§6 en pantallas secundarias) sí se aplicó el 6-jul |
| El alta de negocio (`/registro`) no usa el sistema de diseño | `modules/registro/index.js:245` (*"el rediseño visual llegará con el sistema de diseño"*) | PARADO |
| Los colores de las gráficas van a mano (Chart.js pinta en canvas y no entiende tokens) | `docs/ux/u1-diagnostico-tokens.md` §5.bis (l.151) | PARADO — fuera de alcance declarado, con su motivo |
| Los 73 colores del selector de tema de la tienda | `docs/ux/u1-diagnostico-tokens.md` §5.bis (l.150) | PARADO — excluido a propósito: son **datos**, tocarlos corrompería la config |
| Reducir las 6 pestañas de Contabilidad a 2-3 | `DISEÑO.md` §6 (l.236-237) | **YA RESUELTO** — U1 las reagrupó de 7 → **3** de primer nivel (`TABLERO.md:38`, commit `788e690`) |
| Las 5 decisiones de color abiertas "para Ibrahin" | `docs/ux/u1-diagnostico-tokens.md` §4 (l.102-116) | **YA RESUELTO** — §5.bis las recoge aplicadas |
| Confirmar pantalla a pantalla cuáles no tienen estado vacío | `docs/ux/auditoria-ux.md` §3 (l.70-71) | **YA RESUELTO** — U2 (6-jul), ~27 pantallas cubiertas |

---

## 7. INFRA (servidor · pruebas · proceso)

| Qué es | Dónde está escrito | Estado |
|---|---|---|
| ⚑ **Rendimiento Opción B** — varios procesos con afinidad estricta por negocio | `TABLERO.md` §Rendimiento (l.1156, l.1192) · `docs/rendimiento/diagnostico-carga.md` §B (l.53-60) | PARADO — *"quedan sin tocar, tal como pidió el dueño"*. Condicionada: *"B cuando el número de negocios lo justifique"* |
| ⚑ **Rendimiento Opción C** — sacar la BD del hilo principal (workers o Postgres) | `TABLERO.md` §Rendimiento (l.1156) · `docs/rendimiento/diagnostico-carga.md` §C (l.62) | PARADO — *"no hacer hasta que A y B se queden cortas"* |
| **Un negocio con la BD bloqueada congela a los demás 5 segundos** — el aislamiento por archivo protege los datos, no la disponibilidad | `TABLERO.md` §Rendimiento (l.1192) · `docs/rendimiento/diagnostico-carga.md` §Hallazgo 1 (l.35-43) | PARADO — *"una mina para escalar a varios procesos"*: bloquea de hecho la Opción B |
| La primera visita de cada negocio tras un reinicio paga las 125 migraciones (16,7 ms vs 1,3 ms) | `docs/rendimiento/diagnostico-carga.md` §Hallazgo 2 (l.47) | PARADO — anotado como menor |
| **Tres gates en rojo** (`verify-propuestas-dormidos`, `gate-recepciones-c1b`, `gate-c1c-diferencias-cierre`) | `TABLERO.md` §C3 (l.616-620) y §C4a-bis (l.703-705) | **A MEDIAS** — la deuda de gates se declaró **saldada el 14-jul** (*"barrido 33/33, deuda a cero"*), y el 16-jul el barrido da **45/48**. Se descartan como *"pre-existentes por datos vivos, NO de esta tarea"* y nadie los ha tocado desde entonces |
| `verify-pieza-c-http` es un gate frágil: compara redondeos y alterna según los céntimos | `TABLERO.md` §Verifactu-cola (l.1091-1093) | PARADO — *"Estado: arreglar el gate"* |
| `verify-mostrador-overstock` emite tickets contra el negocio **vivo** y no limpia sus registros Verifactu | `TABLERO.md` §C1 (l.602-603) | PARADO — **verificado**: borra productos y movimientos (l.84-86), no toca `verifactu_registros`. *"Anotable como BAJA del Eje C"* |
| Que los gates **reviertan su asiento contable** al limpiar — hoy hay parche (`limpiar-residuo-gates.mjs`), no arreglo | `docs/contexto/errores-conocidos.md` §Gates (l.50) | PARADO — *"un asiento sin documento no es un dato, es basura contable"* |
| La extracción real por IA no entra en el barrido: depende del saldo de la cuenta | `TABLERO.md` §Verificación (l.530-531) · `scripts/gate-c2-revision.mjs:19` | PARADO — entorno: tope de IA agotado (5,089 € de 5 €) |
| `gate-registro-tailscale` solo corre donde haya Tailscale | `TABLERO.md` §Verificación (l.532) | PARADO — entorno; el runner lo grita en cada pasada |
| Chromium arm64 no-snap para el PDF (hoy `--no-sandbox`) | commit `45b4770` (*"Alternativa futura"*) · `core/pdf.js:20,62-63` | PARADO |
| Limpiar los datos de prueba basura de la BD | commit `c7fa716` (*"queda como tarea aparte"*) | PARADO — no se tocan datos sin encargo |
| ⚑ **Notion: el Registro de tiempo no tiene entradas del 10 al 15 de julio** | `session.json` §`donde_sigo` (*"PENDIENTE aparte… reconstruibles desde git"*) | PARADO — deuda de proceso del RITUAL paso c) |
| `CLAUDE.md` cita `CONTEXT_ENGINEERING.md`, que no existe | `docs/contexto/decisiones.md` §[PENDIENTE] (l.47-48) | PARADO — **verificado**: no está en el repo, y `CLAUDE.md` sigue diciendo *"## Convenciones (de CONTEXT_ENGINEERING.md)"* |
| Revisar si `BUGS_DISA.md` tiene entradas por debajo del #3 sin recoger | `docs/contexto/errores-conocidos.md` §[PENDIENTE] (l.55-56) | PARADO — **verificado que sí**: hay #4, #5 y un bloque PENDIENTE que `errores-conocidos.md` no recoge |
| `gate-almacenes` se envenena solo y sus fallos cambian entre pasadas | `docs/contexto/errores-conocidos.md` (l.49) | **YA RESUELTO** — se arregló el 14-jul (10→20, nombre único por pasada, borra lo suyo al salir, verificado con dos pasadas). La ficha no se actualizó |
| El limitador de peticiones está mal colocado y amplifica la carga | `docs/rendimiento/diagnostico-carga.md` §Hallazgo 2 (l.45) | **YA RESUELTO** — Opción A (9-jul): tope 100→600/min, freno propio en `/find-tenant`, 429 en JSON |

---

## 8. Textos viejos que engañan (arreglo de minutos, riesgo real)

Todos verificados contra el código de hoy. **No son tareas de producto: son mentiras en el sitio donde
alguien va a buscar la verdad.**

| Dónde | Qué dice | La realidad |
|---|---|---|
| 🆕 `TABLERO.md:995-998` (ficha de C6) | *"Hallazgo nuevo, anotado sin arreglar: el email SÍ entra en `security_events`… **Decidir a conciencia**"* | **Lo arregló C5-ter/T2 hoy** (`0e7092d`). Texto viejo con **horas** de antigüedad: se quedó rancio en el mismo commit que lo resolvía, en otra ficha del mismo archivo |
| 🔴 `modules/erp/routes/conciliacion-routes.js:142` | *"los cargos (gastos) se listan pero **su cruce es una pieza posterior**"* — **y esto lo lee el cliente en pantalla** | El cruce de gastos **existe y está verificado**: `conciliacion.js:324` (Pieza 2), `sugerenciasGasto()`, `verify-conciliacion-gastos.mjs`. Es el único texto obsoleto que engaña al usuario final, no al desarrollador |
| `modules/erp/cobros.js:5` | *"Fuera de alcance (Paso 2): perfiles de cobro, próxima acción, DISA"* | El mismo fichero: `CADENCIAS` (l.160), `calcularProximaAccion` (l.224), `collectionsWorklist` (l.317) |
| `modules/erp/pagos.js:7` | *"Fuera de alcance (pendientes b–e): gasto puro, devoluciones, DISA proactiva y el pago por cuenta"* | Todo hecho, casi todo en el propio fichero: `isRefundable` (l.39), pago a cuenta (l.148), `vencimientosProveedor` en `avisos.js:48`, voz de DISA vía `supplierAccountsSummary` |
| `modules/erp/routes/cobros.js:11` | *"Fuera de alcance: perfiles, próxima acción, DISA"* | Seis líneas más abajo (l.16-17) sirve el pipeline priorizado con su próxima acción |
| `modules/erp/routes/pagos.js:11` | *"Fuera de alcance: DISA proactiva"* | Existe (`avisos.js:48`, `gate-pago-voz-avisos.mjs`), y el fichero ya importa `pagoCuentaModalHtml` |
| `scripts/reset-admin.js:38` | *"los admin de negocio no tienen códigos de rescate… para los dueños es tarea aparte"* | C5-bis se los dio ayer (`admin_recovery_codes`) |
| `modules/erp/models.js:1646` | *"arranca solo con `recordatorio_impago`"* | Hay **seis** tipos de propuesta |
| `TABLERO.md` l.1087 y l.1145 | El bug de encadenado por `id` *"sigue vivo"* / *"Latente"* | Lo cerró **C1** el 15-jul (`2fdc9bf`) |
| `TABLERO.md` l.271 | `🟡 D5 — Dos piezas HECHAS` | Son seis (D5, D5b–D5f) |
| `TAREAS.md:69` | *"[x] Logs debug DISA eliminados"* | Siguen ahí (`disa/index.js:1085,1087,1089,2026`) |
| `docs/contexto/piezas-cerradas.md` §Pilar 3 | *"⬜ Pendiente: stock mínimo / punto de pedido, trazabilidad lote/serie"* | Cerrado el 15-jul; el TABLERO lo marca ✅ y la ficha sigue 🟡 |
| `docs/contexto/arquitectura.md` §"Qué NO existe" | Lista contabilidad, envío Verifactu, Facturae, recurrentes y CRM como no construidos | Los cinco existen. Lo que sí sigue sin existir de esa lista: SII, TicketBAI, cobro online, plantillas, RRHH, proyectos, app móvil, API, multiempresa, fabricación |
| `MAPA_FUNCIONAL.md:297` | *"No hay soporte para múltiples tipos de IVA"* | A2 lo resolvió. El documento entero es anterior a D1/D2/A2 — candidato a marcarse HISTÓRICO, como ya se hizo con `TAREAS.md` |

---

## 9. Recuento

Contados los ítems del inventario (§1–§7), uno por fila:

| Estado | Nº |
|---|---|
| **PARADO** (backlog por orden de construcción) | **110** |
| **PLANIFICADO-NO-HECHO** (hay plan, cero código) | **3** |
| **A MEDIAS** (empezado y sin cerrar) | **2** |
| **YA RESUELTO pese a estar escrito como futuro** | **17** |
| *(no es tarea: el correo diario sin filtrar, por diseño)* | 1 |
| **Total inventariado (§1–§7)** | **133** |

Reparto por bloque: Núcleo 15 · El Suelo 42 · El Foso 11 · DISA 15 · Seguridad 20 · UX 13 · Infra 17.

A esos 17 YA RESUELTO se suman, en **§8**, los textos obsoletos que **no son tarea sino texto**: 14
sitios donde el repo declara futuro algo que ya existe (4 de ellos coinciden con filas del
inventario; los otros 10 son solo texto). **Total de textos desactualizados: 14.**

**Marcados ⚑ (petición expresa de Ibrahin, aparcada): 10**

1. Verifactu para clientes — colaborador social *(a ejecutar cuando lo indique)*
2. Verifactu — envío de anulaciones *(para encargo propio)*
3. Verifactu — subsanación del 2004 *(para encargo propio)*
4. B10 — endurecer systemd *(aplazado con protocolo)*
5. B12 — las tablas de roles muertas *(decisión de diseño que le toca al dueño)*
6. Motor de traducción (i18n) *(Cola del Eje A: fuera de encargo, NO descartada)*
7. Las tres pantallas sin enlace *("se abordarán luego")*
8. DISA fija con contador + "Ayuda y soporte" al pie del rail *(DISEÑO.md, diseño aprobado)*
9. Rendimiento Opción B *(sin tocar, tal como pidió)*
10. Rendimiento Opción C *(sin tocar, tal como pidió)*

*(Eran 12 al empezar la auditoría: **C5-ter** y **el email en `security_events`** se cerraron a media
mañana, hoy.)*

**Los 2 A MEDIAS:**

1. **Presupuesto → ticket** — el destino está en el enum, el enlace lo admite y el botón existe
   deshabilitado; el creador nunca se hizo. Y la excusa escrita en el 501 ya no vale: decía *"se
   construye con la pieza de TPV"*, y el TPV existe desde hace semanas.
2. **Los tres gates en rojo** — la deuda de gates se declaró **a cero el 14-jul** y el barrido del
   16-jul da 45/48. Se descartan como *"pre-existentes por datos vivos"*, que puede ser cierto, pero
   nadie ha vuelto a mirarlos.

---

## 10. Candidatos a siguiente, según dependencias

**No es una recomendación de prioridad — es lo que las dependencias dejan hacer hoy.** La prioridad
la decide el dueño (CANON §6).

### Cierran algo ya empezado (deuda que ya está pagada a medias)

1. **Los textos obsoletos de §8**, empezando por `conciliacion-routes.js:142`. Minutos de trabajo, y
   uno de ellos le está diciendo al cliente que no tiene una función que sí tiene. Los otros cuatro
   engañan a quien vaya a programar encima. Es la tarea con mejor relación valor/esfuerzo del
   inventario, y no depende de nada.
2. **Presupuesto → ticket**, si se quiere cerrar lo que está a medias: el andamio está puesto y el
   bloqueo declarado (el TPV) desapareció hace semanas.

### Nada las bloquea y el motor ya existe

3. **El calendario fiscal como fuente de la campana.** `calendario-fiscal.js` ya está construido y
   probado (D5e); es enchufar una fuente más en `avisos.js`, que tiene seis.
4. **El panel de impagados sin email** (`propuestas.js:64`): el dato ya se calcula, solo falta
   pintarlo.
5. **Instalar el timer de la cola de Verifactu.** El doc dice literal *"instalarlo es inocuo"*: sin
   certificado el barrido no hace nada. Hoy es la única unidad de `deploy/systemd/` que no está en
   `/etc/systemd/system/`.
6. **Firma Facturae contra certificado autofirmado.** El propio informe la clasifica como *"se puede
   construir hoy, entero y probado, sin el FNMT"* — es la mitad del trabajo de F-1 hecho por
   adelantado, sin esperar al certificado.
7. **Las tres pantallas sin enlace** ⚑ y **U1b**: pequeñas, cerradas, y llevan aparcadas desde el 8 y
   el 5 de julio.

### Desbloquean a otras (hacerlas primero cambia el orden de lo demás)

8. **Permisos Paso 1** (auditar `requirePerm` ruta por ruta). El Paso 2 —DISA administrando permisos
   hablando— **no arranca sin él**, y es una pieza grande de El Foso.
9. **Decidir las 16 acciones de DISA no anunciadas** (anunciarlas o retirarlas). Hoy el modelo puede
   dispararlas a ciegas; es el hallazgo más antiguo de D0 que sigue vivo, y era *"decisión de D5"*
   con D5 ya cerrado en seis piezas.
10. **Revisión de seguridad de `verifactu-cola.js`** — prerequisito escrito de la tarea de
    colaborador social. Hacerla antes evita que la tarea única se pare a mitad.
11. **Balance de Situación** ← necesita saldos de apertura + capital + capitalización, y esa pieza
    necesita **decisiones de datos del dueño**. Es la dependencia más larga de contabilidad y no se
    puede acortar programando.

### Bloqueadas de verdad (no se pueden hacer aunque se quiera)

- **Verifactu colaborador social** ⚑ — trámite legal externo, solo lo inicia Ibrahin.
- **Facturae firma y envío real** — falta el certificado, y antes las huellas `.sha1`/`.sha2` de la
  política de firma (dan 404) y confirmar el XAdES de FACe (tras WAF).
- **Rendimiento B** ⚑ — el hallazgo de la BD bloqueada (5 s) es *"una mina para escalar a varios
  procesos"*: hay que matarlo antes.
- **Rendimiento C** ⚑ — *"no hacer hasta que A y B se queden cortas"*.
- **Todo lo de Capa 2** (tienda, sync e-commerce, D6, C4b-3, B11-tienda) — congelada; su
  endurecimiento entra **con** la reactivación, por decisión escrita.

---

> **Método.** Inventario de solo lectura. Cada ítem cita archivo + sección o línea. Donde pone
> "verificado" es que se comprobó contra el código de hoy, no contra el informe que lo escribió —
> la lección de C6: *"un número de línea caduca; el hallazgo, no"*. Los números de línea de este
> documento derivarán en cuanto otro commit toque esos ficheros.
