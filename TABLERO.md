# TABLERO — Fase de optimización

## Eje A: UX (activo)
Objetivo: acercar cada pantalla y flujo a "el dueño no opera, decide". Método: auditoría primero, luego ejecución en piezas pequeñas. Cada tarea define cómo se verifica y cierra con regresión 0.

### U0 — Auditoría UX global  ⬅️ EMPEZAR AQUÍ
Recorre TODAS las pantallas del admin y del portal y produce un inventario real, sin cambiar nada: pantallas y su estado; incoherencias visuales (tipografía, espaciado, colores, componentes repetidos distintos); flujos clave y nº de clics de cada uno; pantallas sin estado vacío / sin estado de carga; mensajes de error genéricos; qué se rompe en móvil.
Hecho cuando: existe docs/ux/auditoria-ux.md con la lista concreta priorizada, y de ahí salen U1–U6 con datos reales.

### U1 — Sistema visual coherente (design tokens)
Unificar tipografía, escala de espaciado, colores y componentes base desde un único sitio (tokens), a partir de layout.js. Sin rediseñar: dar consistencia.
Hecho cuando: los valores visuales salen de un único origen y las pantallas de mayor uso los usan; captura antes/después.

### U2 — Estados vacíos y de carga
Toda pantalla con datos tiene estado vacío útil (qué es, qué hacer) y estado de carga.
Hecho cuando: las pantallas marcadas en U0 quedan cubiertas; revisión en navegador.

### U3 — Mensajes de error claros y accionables
Sustituir errores genéricos por mensajes que dicen qué pasó y qué hacer, en la voz de Bamburu.
Hecho cuando: los casos de U0 muestran mensaje claro; test que dispara los errores y comprueba el texto.

### U4 — Reducir clics en flujos clave
Tomar los flujos medidos en U0 (emitir factura, registrar cobro, conciliar, crear recurrente…) y recortar pasos/formularios en blanco.
Hecho cuando: cada flujo baja de nº de clics medido; antes/después documentado.

### U5 — Móvil / responsive
Que las pantallas de uso frecuente funcionen bien en móvil (lo que U0 marque como roto).
Hecho cuando: esas pantallas se usan sin romperse en ancho móvil; revisión a ese ancho.

### U6 — Onboarding / primeros pasos
Recorrido que lleve al dueño nuevo al primer valor sin fricción (idealmente de la mano de DISA, enlaza con Eje B).
Hecho cuando: un dueño nuevo llega a su primera acción útil sin bloquearse; recorrido probado.

## Eje B: DISA (pendiente de planificar)
## Eje C: Seguridad (pendiente de planificar)

---

> **Fase actual: OPTIMIZACIÓN** (CANON v2 §4) sobre tres ejes — UX, DISA, Seguridad. Las funciones
> nuevas ceden prioridad al pulido salvo decisión del dueño. **Cuándo salir al mercado lo decide el
> dueño**; el asistente y Code no lo recomiendan.
> **Fuente única de tareas: este archivo.** Notion es solo panel (KPIs, tiempo, "dónde sigo").
> **Histórico de lo ya construido** (piezas cerradas, decisiones D1–D6, estructura NÚCLEO/SUELO/FOSO):
> `docs/contexto/piezas-cerradas.md` y el resto de `docs/contexto/`, más el TABLERO anterior en `git log`.

## Backlog / otras capas
Todas las tareas pendientes anteriores, **conservadas**. No se inician sin encargo del dueño; en la
fase actual ceden prioridad a la optimización (Ejes A/B/C).

### Contabilidad y cumplimiento fiscal
- **Verifactu — envío real a la AEAT:** la Fase A (motor SOAP+mTLS, probado contra simulador) está hecha; falta disparar el envío real a preproducción/producción cuando el dueño aporte su **certificado FNMT** (`VERIFACTU_CERT_PATH`/`VERIFACTU_CERT_PASS` + NIF/NombreRazón del productor). Comando: `scripts/verifactu-enviar-preproduccion.mjs`.
- **Verifactu — Fase B (legal):** colaboración social (Convenio tipo 17), declaración responsable, y elección de certificado (propio-por-todos vs por-cliente, modelo del Anexo II). Ampliaciones técnicas: envío de **anulaciones** (hoy solo altas), **cola + timer por tenant** (control de flujo `TiempoEsperaEnvio`), validación XSD formal.
- **Factura electrónica B2B (Facturae):** obligación separada de Verifactu; después según calendario legal.
- **Balance de Situación:** requiere pieza previa de **saldos de apertura + capital + capitalización de inmovilizado** (escritura de apuntes); decisiones de datos del dueño.
- **Cuentas anuales y legalización de libros.**
- **Plan de cuentas con subcuentas.**
- **Asientos de amortización al diario:** la Pieza 3 (bienes de inversión) calcula la amortización en lectura; volcarla al diario como asiento es pieza aparte.
- **Modelos AEAT siguientes:** 111/115/123 (retenciones), 349 (intracomunitario), 347 (operaciones con terceros), 390 (resumen anual IVA), 200/202 (Sociedades). *(303/130 ✅, Pieza 4.)*
- **IRPF en compras:** hoy solo se modela el IRPF soportado en ventas.
- **Acceso de la gestoría:** compartir la contabilidad por permisos de rol.
- **Mejoras de la pantalla de libros:** drill-down al documento/asiento de origen al pinchar una fila; buscar (nº factura/NIF) y filtrar por tipo de IVA, cliente/proveedor y estado de cobro/pago; cuadro-resumen por tipo de IVA; bloqueo de periodo presentado (estado borrador/presentado); asiento resumen para tickets del mismo día y tipo.
- **Conciliación bancaria:** **CSV genérico** de extracto (añadido barato); **PSD2 / Enable Banking** como fuente automática futura (la costura ingesta↔cruce ya lo prevé).

### Ventas, portal y recurrentes
- **Portal de cliente — pago online (tarjeta):** pasarela (Stripe u otro); necesita decisión de proveedor y coste del dueño. **Único paso que falta del portal.**
- **Portal de cliente — acceso admin al enlace:** mostrar/copiar el enlace del portal desde el admin (hoy solo se envía por email).
- **Portal de cliente completo (roadmap):** que el cliente vea y **acepte presupuestos** y haga **pedidos B2B con carrito**.
- **Facturas recurrentes — auto-emisión sin revisar:** interruptor opcional por-plantilla (hoy siempre genera **borrador** para revisar y emitir con un clic).
- **PDF + email de cada documento:** hoy solo el presupuesto envía PDF por email.
- **Plantillas de documento personalizables.**

### Inventario (Pilar 3 — pulido)
- **Stock mínimo / punto de pedido.**
- **Trazabilidad por lote / nº de serie.**
- **Sync e-commerce** (Shopify / Woo / Prestashop) — Capa 2.

### Multiusuario / permisos
- **Administración de permisos por DISA (registrada, 2 pasos EN ORDEN).** *Paso 1 — Fundamento:* repasar TODAS las rutas/servicios de los pilares y confirmar que cada acción exige el permiso correcto (`requirePerm`), no solo sesión, con un modelo de permisos limpio agrupado por áreas. *Paso 2 — DISA administra hablando:* el dueño gestiona usuarios/accesos por conversación y DISA lo traduce vía servicio validado (DISA nunca escribe permisos directo; patrón T5/cobros). El Paso 2 no arranca sin el Paso 1 cerrado.

### Riesgos / decisiones abiertas
- **D3 · [riesgo legal a resolver] Documento de pedido titulado "FACTURA" que no es la factura Verifactu** (`routes/orders.js:442`). Quedó neutralizado al desmontar `orders.js` en PIEZA C; verificar que ya no es alcanzable y decidir renombrar/retirar/aclarar. *Estado: revisar.*
- **D6 · [a verificar] XSS en páginas públicas de la tienda** (HTML guardado por admin sin escapar). La tienda está apagada de forma reversible (D1); revisar antes de reabrir en Capa 2. *(El bug de fuga de stock de `cancel_order` ya quedó resuelto al archivar `sales_orders`, D4.)*

### Deuda técnica
- **Arreglar `scripts/gate-avisos-badge.mjs`:** falla por una ruta de BD fija inexistente en el checkout actual (ambiental, ajeno a la lógica); reescribirlo para usar BD temporal como el resto de gates.
- **DISA `create_order` multi-línea:** limitación heredada de la base e-commerce; los pedidos multi-línea entran con el flujo pedido→albarán→factura.

### Roadmap futuro — módulos (decisión del dueño, NO iniciar sin encargo)
DISA como producto proactivo · **Citas / Agenda** (🔺 prioritaria) · CRM comercial (embudo/oportunidades, agenda/calendario) · Control horario (registro de jornada) · TPV / POS módulo completo · Parte de obra · Cobro recurrente + domiciliación SEPA · Telegram como canal · Mapas (OpenStreetMap) · Documentos / suite ofimática ligera · App móvil nativa · API pública / webhooks · Integraciones / marketplace · Dashboards personalizables · Multiempresa · Fabricación · Multi-moneda · Firma digital de documentos · Previsión de caja 3/6/12 meses · Proyectos / rentabilidad · Partes de horas · Servicio de campo / órdenes de trabajo · Helpdesk.

---

> El detalle completo de cada módulo del roadmap, de las decisiones registradas (D1–D6) y de todas las
> piezas ya cerradas se conserva en `docs/contexto/` y en el historial de `git` (TABLERO anterior).
