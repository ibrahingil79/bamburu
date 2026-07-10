# D0 — Auditoría de solo lectura de DISA (Eje B)

> Fecha: 2026-07-10. Tipo: **diagnóstico de solo lectura**. No se tocó lógica ni se arregló nada.
> Este documento es el mapa de partida del Eje B (DISA). Las referencias son `fichero:línea` sobre
> el árbol en el commit de esta auditoría.

## TL;DR

- **1 hallazgo de SEGURIDAD, prioridad alta:** la herramienta de consulta de DISA (`query_database`)
  **falla abierto**. Comprueba permisos solo para 32 tablas de una lista; las **38 tablas de negocio
  que no están en esa lista pasan sin exigir ningún permiso**. Un empleado sin `crm.read` puede pedirle
  a DISA las oportunidades del CRM; sin `invoices.read`, la contabilidad entera (`ledger_lines`, 381
  filas). Es la **misma forma** que la fuga de la campana de avisos del 9-jul: un camino de lectura que
  no comprueba permiso. **No se toca sin encargo aparte** (§2).
- **El patrón "pedidos" (acción anunciada pero rota) NO reaparece en escritura.** Tras la retirada del
  10-jul, ninguna acción viva de DISA escribe contra una tabla archivada. Sí quedan **restos menores**:
  16 acciones que existen y tienen permiso pero **no se le anuncian al modelo**, y referencias colgadas
  de `reset_stock` (§1).
- **1 desajuste de nombres real y latente:** DISA marca los productos borrados como `status='inactive'`,
  un valor que **no existe** en el enum del esquema (`active/draft/archived`) (§4).
- **La paridad de permisos de ESCRITURA está bien hecha:** `ACTION_PERMS` refleja el `requirePerm` de
  cada pantalla hermana. El agujero es solo de lectura (§2).
- **Proactividad:** bien gobernada por permiso en general; dos asimetrías (KPIs del Inicio sin filtrar,
  correo diario sin filtrar —este por diseño) (§3).

---

## 1. Inventario de acciones de DISA

DISA ejecuta acciones desde el chat vía `executeAction` (`modules/disa/index.js:265`), siempre
**confirm-first** (el usuario responde "sí" antes de cualquier mutación) y bajo `actionAllowed`
(`:190`). Hay **37 acciones** implementadas (`case` en el switch).

### 1.1 Tabla de acciones (por módulo)

| Acción | Módulo | Lee/Escribe | Permiso exigido | Estado |
|---|---|---|---|---|
| `insert_record` / `update_record` / `delete_record` | genérico (whitelist `WRITABLE_TABLES`) | Escribe | **owner/admin** (`STRICT_ADMIN_ONLY`) | Vivo |
| `query_database` (herramienta, no `case`) | genérico lectura | Lee (SELECT) | **por tabla, con FUGA** (ver §2) | Vivo |
| `anular_invoice` | Facturas | Escribe (servicio legal) | owner/admin | Vivo |
| `create_rectificativa` | Facturas | Escribe (servicio legal) | owner/admin | Vivo |
| `create_product` | Catálogo | Escribe (servicio validado) | `products.create` | Vivo |
| `edit_product` | Catálogo | Escribe | `products.edit` | Vivo · **no anunciado** |
| `delete_product` | Catálogo | Escribe (`status='inactive'`) | `products.delete` | Vivo · **no anunciado · off-enum (§4)** |
| `deactivate_product` / `activate_product` | Catálogo | Escribe (`status='inactive'`/`'active'`) | `products.edit` | Vivo · **no anunciado · off-enum (§4)** |
| `create_variant` / `edit_variant` / `delete_variant` | Catálogo | Escribe | `products.edit` | Vivo · **no anunciado** |
| `create_category` / `edit_category` / `delete_category` | Catálogo | Escribe | `categories.*` | Vivo · **no anunciado** |
| `create_discount` / `edit_discount` / `delete_discount` | Descuentos | Escribe | `discounts.*` | Vivo · **no anunciado** |
| `adjust_stock` | Inventario | Escribe (servicio validado) | `inventory.edit` | Vivo |
| `transfer_stock` | Inventario | Escribe (servicio validado) | `inventory.edit` | Vivo |
| `dictar_compra` | Compras | HANDOFF (prepara y enruta a pantalla) | `purchases.create` | Vivo |
| `register_supplier_payment` | Compras | Escribe | `purchases.create` | Vivo |
| `create_client` / `edit_client` / `deactivate_client` / `activate_client` | Clientes | Escribe (servicio validado) | `clients.create`/`clients.edit` | Vivo |
| `create_supplier` / `edit_supplier` / `delete_supplier` | Proveedores | Escribe | `suppliers.*` | Vivo · **no anunciado** |
| `register_collection_action` | Cobros | Escribe | `cobros.manage` | Vivo |
| `register_account_action` | Cobros | Escribe | `cobros.manage` | Vivo |
| `update_profile` | Perfil DISA | Escribe | owner/admin | Vivo |
| `update_company_config` | Config empresa | Escribe | owner/admin | Vivo |
| `check_2fa_status` | Seguridad | Lee | autoservicio / admin p/ terceros | Vivo |
| `disable_2fa_user` | Seguridad | Escribe | owner/admin | Vivo |
| `list_users_security` | Seguridad | Lee | owner/admin | Vivo |

### 1.2 Restos del patrón "pedidos" (acción muerta/a medias)

Se buscó específicamente el patrón que se encontró en pedidos: acciones que apuntan a tablas
archivadas, endpoints muertos, o mensajes "en migración" que nadie retiró.

- ✅ **En ESCRITURA no reaparece.** Barrido de `INSERT/UPDATE/DELETE/FROM` sobre `*_archived`,
  `*_legacy`, `sales_orders`, `order_status_history`, `customer_accounts`: **cero** en código vivo. La
  retirada de pedidos del 10-jul (`501ab96`) dejó limpio ese frente.
- ⚠️ **16 acciones vivas NO se anuncian al modelo.** `edit_product`, `delete_product`,
  `deactivate_product`, `activate_product`, `create_variant`, `edit_variant`, `delete_variant`,
  `create_category`, `edit_category`, `delete_category`, `create_discount`, `edit_discount`,
  `delete_discount`, `create_supplier`, `edit_supplier`, `delete_supplier`. Tienen `case` y permiso,
  pero el prompt solo declara `create_product` (`:2327-2335`) y ninguna de las otras. **Es el reverso
  del bug de pedidos:** allí se anunciaba algo que no existía; aquí existe algo que no se anuncia. El
  modelo puede emitirlas si las deduce del patrón, pero no está informado de su contrato → disparo
  poco fiable. *No es un fallo de seguridad* (tienen permiso), sí una inconsistencia de diseño.
- ⚠️ **`reset_stock` colgando.** Aparece en `ADMIN_ONLY_ACTIONS` (`:151`) y en `ACTION_PERMS` (`:175`),
  pero su `case` está **comentado** (`:663-667`, "OBSOLETO, comentado no borrado"). Referencias muertas
  en dos conjuntos; inocuo, pero sucio.
- ⚠️ **`/api/disa/summary` (`:1392`) sin consumidor vivo.** Produce alertas accionables (stock bajo,
  pedidos bloqueados…) con `href` y `action`. No se encontró ninguna llamada viva en `modules/` (el
  `/summary` que sí se usa en `clients.js:577` es del CRM, no de DISA). Probable código legado.
- ⚠️ **`store-message` (`:2022`) devuelve 404** (builder de tienda desmontado, D2) — correcto —, **pero
  la tarjeta "Construir mi tienda web"** del Inicio (`disaHome.html.js:554-583`) todavía **empuja** ese
  prompt. Superficie proactiva que apunta a una capacidad retirada.
- ✅ `ADMIN_ONLY_ACTIONS` (`:149`) **no se usa en ningún sitio**: el gate real es `STRICT_ADMIN_ONLY` +
  `ACTION_PERMS`. Conjunto declarado y nunca leído (deuda cosmética).

---

## 2. Paridad de permisos

### 2.1 Escritura — BIEN

`ACTION_PERMS` (`modules/disa/index.js:168-178`) asigna a cada acción dedicada el permiso
`modulo.accion` **exacto** de su ruta hermana, y `actionAllowed` (`:190`) lo comprueba con
`checkPermission` — el **mismo motor** que `requirePerm` de las pantallas, sin lógica paralela. Se
verificó acción por acción contra el `requirePerm` de cada `routes/*.js`: coinciden
(`products.create/edit/delete`, `categories.*`, `discounts.*`, `suppliers.*`, `clients.create/edit`,
`inventory.edit`, `purchases.create`, `cobros.manage`). Documentos legales y seguridad van a
`STRICT_ADMIN_ONLY` (owner/admin), más estricto que la pantalla, a propósito. **Sin discrepancias.**

### 2.2 Lectura — 🔴 FUGA (SEGURIDAD, PRIORIDAD ALTA)

`query_database` (herramienta SELECT-only, `:2494`) se ofrece a **cualquier sesión**, no solo admin.
Su guarda (`:2470-2504`):

1. exige que la consulta sea `SELECT`;
2. deniega si toca una `PROTECTED_TABLES` (9 tablas: usuarios, sesiones, logs…);
3. deniega si toca una tabla de `TABLE_READ_PERMS` (32 tablas) sin su `*.read`.

**El defecto:** el paso 3 solo mira las tablas que **están** en el mapa. Una tabla de negocio que no
esté ni protegida ni mapeada **pasa sin comprobar nada**. Es un diseño *denylist-por-omisión* donde
debería ser *allowlist*. Simulada la guarda con las cadenas reales:

```
SELECT * FROM opportunities        → PASA SIN NINGÚN PERMISO   (pantalla /admin/crm exige crm.read)
SELECT * FROM ledger_lines         → PASA SIN NINGÚN PERMISO   (pantalla contabilidad exige invoices.read)
SELECT importe FROM collection_actions → PASA SIN NINGÚN PERMISO
SELECT * FROM verifactu_envios     → PASA SIN NINGÚN PERMISO
```

**38 tablas de negocio** quedan fuera del mapa. Las sensibles y su permiso-espejo (el que exige su
pantalla):

| Tabla(s) | Filas (negocio demo) | Debería exigir |
|---|---|---|
| `opportunities`, `client_activities` | 3 + 3 | `crm.read` |
| `ledger_entries`, `ledger_lines`, `ledger_accounts` | 132 + 381 + 20 | `invoices.read` (pantalla de contabilidad) |
| `bank_movements`, `investment_goods` | 0 | contabilidad |
| `stock_transfers`, `stock_transfer_items` | 3 + 10 | `inventory.read` |
| `verifactu_envios` | 2 | `invoices.read` |
| `invoice_anulaciones`, `refunds` | 18 + 0 | `invoices.read` |
| `collection_actions` | 0 | `cobros.read` |
| `recurring_templates`, `recurring_occurrences` | 0 | `recurrentes.read` |
| `purchase_order_receipts`, `purchase_order_receipt_items`, `supplier_invoice_items` | 11 + 9 + 6 | `purchases.read` |
| `roles`, `permissions`, `role_permissions`, `user_permissions`, `user_roles` | — | seguridad (revelan la estructura de permisos) |

**Es la misma clase de bug que la campana de avisos (9-jul):** un endpoint de lectura que no filtraba
por permiso. Aquí, además, `query_database` es potente (SQL libre acotado a SELECT), así que un
empleado con cualquier permiso puede leerse áreas que su panel le niega, con solo pedírselo a DISA en
lenguaje natural. **Anotado con prioridad; no se toca en esta tarea (encargo aparte).**

### 2.3 Asimetrías de lectura en superficies proactivas

- **KPIs del Inicio sin filtrar por permiso.** `dashboard.js:42-44` calcula "Ventas del mes",
  "Pedidos" y "Pendientes" **siempre**, sin `can(...)`, y `disaHome.html.js:479-488` los pinta a
  cualquier rol (la ruta `/` no tiene `requirePerm`, `dashboard.js:10`). Un empleado sin
  `invoices.read` ve la cifra total facturada del mes en la home. El chat de DISA sí trocea esas mismas
  cifras por permiso (`buildBusinessContext`, `:1034`), así que la home es **menos estricta** que el
  chat. Severidad media (una cifra agregada, no el detalle).
- **Correo diario sin filtrar por usuario** (`scripts/bamburu-avisos.mjs:58`, todas las fuentes). Es
  **por diseño**: el correo va al negocio (`company_config.email`), no a una persona. Documentado en
  `avisos.js:461`. No es un defecto; se anota para que no sorprenda.

---

## 3. Cuánto de proactiva es DISA hoy

La proactividad cuelga casi toda de **un motor**: `modules/erp/avisos.js`, con seis fuentes
normalizadas y ordenadas por urgencia, **bien gobernadas por permiso** (`PERM_POR_FUENTE`, cada fuente
exige el `*.read` de su pantalla; `avisosDelDia` solo ejecuta las permitidas — *falla cerrado*). Lo
consumen cuatro superficies que "cuentan lo mismo que tú puedes ver".

### Superficies que EMPUJAN (proactivas)

| Superficie | Dónde | Disparo | ¿Filtra permiso? | ¿Solo informa / ofrece acción? |
|---|---|---|---|---|
| Motor de avisos | `avisos.js` | biblioteca (la invocan las 4 superficies) | Sí (`PERM_POR_FUENTE`) | — |
| Campana del topbar | `layout.js:940-1116` | render + **sondeo 60 s** + `visibilitychange` + tras cada mutación (`bellTrasCambio`) | Sí (`fuentesPermitidas`) | Informa + navega; marca "visto" |
| Pantalla `/admin/avisos` | `routes/avisos.js` | carga + refresco tras acción | Cada **acción** gateada por permiso | **Ofrece acción** (modales validados) |
| Inicio: tarjeta DISA + KPIs + fila de avisos | `disaHome.html.js`, `dashboard.js` | carga de `/admin` | Avisos sí; **KPIs no** (§2.3) | Informa + navega |
| Onboarding "primeros pasos" | `dashboard.js:48-63`, `disaHome.html.js:19-77` | carga de `/admin` (solo owner/admin) | rol | Ofrece (enlaces a pantallas) |
| Correo diario | `scripts/bamburu-avisos.mjs` | **cron systemd 08:00** | No (por diseño, §2.3) | Solo informa |
| Tarjeta "¿Qué requiere mi atención?" | `disaHome.html.js:562`, `disa/index.js:2681` | click del usuario (semi-proactivo) | Sí | Solo informa (resumen de conteos) |
| Bandas `disaBand` en Facturas / Fras. proveedor / CRM | `invoices.js:1100`, `supplier-invoices.js:512`, `crm.js:420` | carga de la lista | La pantalla ya gatea | Informa + navega |
| Contexto de negocio inyectado en el prompt | `disa/index.js:1018-1388` | **solo al escribir** (canal reactivo) | Sí (troceado por área) | Munición para el chat |
| Onboarding de registro (saludo DISA) | `modules/registro/index.js:23` | carga de `/registro` | n/a (sin cuenta) | Guía conversacional |

### Lo REACTIVO (solo si el usuario escribe)

Todo `executeAction` (las 37 acciones), `query_database`, adjuntar factura (`/attach`), artifacts
visuales (kpi_dashboard, action_list — read-only), gestión de hilos y chips. Nada se ejecuta sin
petición, y las mutaciones son confirm-first.

### Lectura de la distancia a "el dueño no opera, decide"

- **No hay push en vivo real** (ni WebSocket, ni SSE, ni notificaciones de navegador). La única
  proactividad "en tiempo real" es el **sondeo de la campana cada 60 s**; el resto es render de página
  y el cron del correo. El prompt prohíbe explícitamente SMS/llamadas (`disa/index.js:2216`).
- **DISA avisa bien, pero no propone la acción proactivamente.** El motor de avisos *informa* y navega;
  la ejecución la ofrece la pantalla `/admin/avisos`, y siempre la dispara el usuario. DISA nunca
  *inicia* una acción por su cuenta (correcto para valor legal, pero es la brecha real hacia
  "proactiva": hoy es un **tablón de avisos muy bueno**, no un agente que proponga "¿reclamo yo este
  cobro?").
- La proactividad es **hoy uniforme por negocio, personalizada por permiso**: cada usuario ve lo suyo.

---

## 4. Consistencia de nombres (más allá de `activity_logs`, ya corregido)

El desajuste de `activity_logs` (plural/singular) se cerró el 10-jul con `core/activity-entities.js`.
Se buscó el mismo patrón (DISA teclea un literal que el resto escribe de otra forma) en estados,
confirmaciones y vocabulario de documentos.

### 4.1 Hallazgo real — estado de producto `'inactive'` (off-enum, latente)

`delete_product` (`:494`) y `deactivate_product` (`:502`) hacen
`UPDATE products SET status='inactive'`. Pero el enum del esquema es
`z.enum(['active','draft','archived'])` (`schemas.js:24`): **`'inactive'` no existe**. Verificado:
el literal `'inactive'` **solo** aparece en `disa/index.js`, en ningún otro punto de `modules/erp`
ni `core`.

Consecuencias (hoy **latentes** — 0 productos en ese estado, y las acciones no se anuncian al modelo):
- la lista de productos filtra por `status='active'` → un producto en `'inactive'` **desaparece** pero
  **no** figura como "archivado";
- el badge de estado (`products.js:310`) no conoce `'inactive'` → pinta el texto crudo;
- el desplegable de estado del formulario no tiene esa opción → al editarlo, no la encuentra;
- no hay ruta de restauración por pantalla (solo DISA con `activate_product` → `'active'`).
- Incoherencia interna extra: `delete_record` genérico sobre `products` hace **borrado duro** (`:338`),
  igual que la pantalla; el `delete_product` dedicado hace soft-delete off-enum. Mismo verbo, dos
  efectos y dos valores.

**Causa raíz idéntica a `activity_logs`:** aquí DISA **teclea el estado a mano** en vez de delegar en
un servicio validado. El contraste lo confirma: para clientes, DISA llama a `archiveClientSvc`
(`:736`) y **no** puede divergir.

### 4.2 Lo que SÍ coincide (sin falsa alarma)

- **Facturas** (`emitida`/`anulada`/`rectificada`), **pedidos** (`borrador`/`confirmado`/`anulado`/
  `entregado`), **traslados** (`confirmada`/`anulada`, vía servicio compartido): DISA == esquema ==
  pantallas.
- **Vocabulario de documentos** (presupuesto, pedido, albarán, factura, rectificativa, abono, traslado,
  compra, recepción, devolución): coincide con `docs/contexto/glosario.md` y las pantallas. DISA incluso
  distingue "Pedido" (customer_orders) de "Albarán" y del TPV viejo.
- **Claves de permiso** citadas en el prompt: todas existen en la semilla `permissions`. Ninguna
  inventada.

### 4.3 Documental (no es DISA↔pantalla)

- **`CLAUDE.md` lista estados de pedido OBSOLETOS**: "borrador, en_preparacion, enviado, completado,
  cancelado, reembolsado" son los de la tabla `orders`/POS **archivada**. El pedido vivo
  (`customer_orders`) usa `borrador/confirmado/anulado/entregado`. DISA usa los nuevos; la documentación
  es la que quedó atrás.

---

## 5. Mapa del código de DISA

### Ficheros

| Fichero | Líneas | Qué es |
|---|---|---|
| `modules/disa/index.js` | 2745 | **El motor entero**: router, acciones, prompts, herramientas, permisos |
| `modules/disa/widget.js` | 192 | Widget flotante de chat |
| `modules/erp/views/disaHome.html.js` | 1065 | La "casa" de DISA (`/admin`): onboarding, KPIs, tarjetas, chat |
| `modules/erp/avisos.js` | 525 | Motor proactivo de avisos (fuera del módulo DISA, pero es su cerebro proactivo) |
| `modules/erp/routes/avisos.js` | 314 | Pantalla `/admin/avisos` + endpoints del contador |
| `modules/registro/index.js` | 507 | Onboarding conversacional de alta (DISA pre-cuenta) |

### Anatomía de `modules/disa/index.js`

| Zona | Línea | Qué |
|---|---|---|
| Imports (incl. `checkPermission`, servicios validados) | 1-30 | Reutiliza motores del ERP, no reimplementa |
| `HANDOFF_ACTIONS` / `ADMIN_ONLY_ACTIONS` | 147-159 | Conjuntos de acciones (el 2º, sin uso) |
| `ACTION_PERMS` / `STRICT_ADMIN_ONLY` / `actionAllowed` | 168-197 | **Gate de escritura** (bien) |
| `TABLE_READ_PERMS` | 202-214 | **Gate de lectura** (con fuga, §2.2) |
| `executeAction` (switch de 37 `case`) | 265-1016 | Ejecución de acciones |
| `buildBusinessContext` | 1018-1388 | Contexto de negocio inyectado, troceado por permiso |
| `/summary` (huérfano) | 1392-1482 | Métricas + alertas accionables sin consumidor |
| Ensamblado del system prompt + `## ACCIONES DISPONIBLES` | 2035, 2151-2440 | Lo que el modelo "sabe" que puede hacer |
| `query_database` (herramienta) + `PROTECTED_TABLES` + `runQueryTool` | 2464-2504 | Consulta SELECT-only |
| Bucle de tool-use / mensajes | 2494-2660 | Orquestación con el modelo |
| Router `/api/disa` (endpoints) | `.route('/api/disa')` | `/message`, `/attach`, `/threads`, `/chips`, `/clear`, `/select-agent`, `/summary`, `/store-message`(404), `/agents`, `/` |

### Notas de referencia (factuales, no hallazgos)

- **Modelos LLM (actualizado D4, 2026-07-10):** el chat de DISA y el DISA de onboarding usan
  **`claude-sonnet-5`** (antes `claude-sonnet-4-6`); el auto-título/store usa `claude-haiku-4-5-20251001`.
  La **extracción de facturas por visión** (`purchases-capture.js`, `EXTRACTION_MODEL`) sigue en
  `claude-sonnet-4-6` a propósito: no es chat, y migrar el modelo de visión es una decisión con sus
  propias implicaciones de OCR, fuera de D4. Su tarifa se conserva en `core/llm.js`.
- **Registro de coste:** `disa_usage` (contador mensual) + `billDb` en cada llamada. Los topes de gasto
  viven en el borde (Anthropic, por negocio) — fuera de este fichero.
- **Confirm-first y HANDOFF:** las mutaciones piden "sí" en el chat; `dictar_compra` es HANDOFF (no
  confirma de palabra, enruta a la pantalla de captura donde está el control visual).

---

## 6. Próximos pasos recomendados (D1…Dn) — para decidir el orden en planificación

> Propuesta, **no ejecutada**. El orden lo decide el chat de planificación del Eje B.

- **D1 — [SEGURIDAD] Cerrar la fuga de `query_database`.** Convertir el gate en *allowlist*: una tabla
  de negocio que no esté explícitamente mapeada a un `*.read` se **deniega** (falla cerrado, como el
  motor de avisos). Mapear las 38 tablas huérfanas (ledger→invoices.read, opportunities→crm.read, etc.).
  Gate de regresión con un empleado sin permisos. **Es lo más urgente.**
- **D2 — Paridad de lectura en el Inicio.** Filtrar los KPIs de `dashboard.js` por permiso, como ya hace
  el chat. Cierra la última asimetría de exposición de la §2.3.
- **D3 — Saneamiento del catálogo de acciones.** (a) Corregir `status='inactive'` → delegar en el
  servicio de productos o usar `'archived'` (§4.1); (b) decidir las 16 acciones no anunciadas: o se
  declaran en el prompt o se retiran; (c) limpiar `reset_stock` colgado, `ADMIN_ONLY_ACTIONS` sin uso,
  `/summary` huérfano y la tarjeta "Construir tienda" que empuja a un 404.
- **D4 — Actualizar documentación desincronizada.** Estados de pedido en `CLAUDE.md`; ID de modelo LLM
  si se decide migrar.
- **D5 — Diseño de proactividad real (el corazón del Eje B).** Hoy DISA es un tablón de avisos excelente
  pero no *propone* acciones ni actúa en vivo (sondeo de 60 s como único push). Decidir hasta dónde
  llega "el dueño no opera, decide": ¿DISA propone "¿reclamo este cobro por ti?" desde la campana?
  ¿push en vivo (SSE)? ¿confirm-first en un clic desde el aviso? Esto es tarea de diseño, no de arreglo.

**Prioridad de seguridad:** D1 se anota como **alta** y **no se toca sin encargo aparte**, según lo
acordado.
