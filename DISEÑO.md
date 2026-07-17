# DISEÑO.md — Bamburu

> La **fuente de verdad visual y estructural** de Bamburu. Lo que `CANON.md` es a la
> estrategia, esto es al aspecto y a *dónde vive cada cosa*. Si una pantalla contradice
> este documento, gana este documento (y se sanea, no al revés).
> Tarea de roadmap "Sistema de diseño + saneamiento visual" (TABLERO): PIEZA 1 (reglas + mapa,
> este archivo), PIEZA 2 (menú de /admin) y PIEZA 3 (saneamiento visual) **HECHAS el 2026-06-22**.
> **Dirección UX fijada el 2026-07-06** (ver §0-bis): chrome CLARO + acento AZUL `#2F6BFF` +
> menú LEAN de una capa + patrón "un-primario-y-···". Base visual para U1 (tokens).
> **APLICADO en código el 2026-07-06** (`modules/erp/layout.js`): tokens (chrome claro + azul +
> texto/bordes/chips), fuente del sistema (fuera Inter), iconos Tabler **auto-hospedados**
> (`/public/vendor/tabler`, fuera CDN), **menú = rail de iconos por área + flyout estilo Holded**
> (§3, sustituye al "lean estricto" que escondía demasiado) y **patrón por pantalla §6** (banda de
> DISA + menú `···`) en las pantallas principales. Pendiente: DISA-fija-con-contador + "Ayuda y
> soporte" al pie del rail (§3.1), y §6 en las pantallas secundarias.
> Última actualización: 2026-07-06

---

## 0. Qué es esto y qué NO es

- **Es** el manual de marca + el mapa de navegación: principios, tokens, estructura del
  menú y patrones comunes. Define **cómo se ve** y **dónde vive cada función**.
- **No es** un rediseño en código. Aquí no se toca ni una pantalla, ni el menú real
  (`modules/erp/layout.js`), ni un token del código. Este archivo fija la **dirección**;
  aplicarla es U1 (tokens) y siguientes.
- **Referencia de calidad:** **Holded**, pero **simplificado al máximo**. Tomamos su nivel de
  acabado y su calma, no su densidad de ERP. Bamburu **esconde** la complejidad; no la
  enseña. El dueño **DECIDE con DISA**, no opera un panel de contabilidad.

---

## 0-bis. Dirección UX vigente y registro de cambios (2026-07-06)

Fijamos el lenguaje visual y la navegación tomando **Holded como referencia de calidad**,
simplificado al máximo bajo el principio rector **"el iPhone del nicho"**: simple, con calma,
poco color; el dueño **decide con DISA**, no opera; la app **esconde** la complejidad, no la
enseña como un ERP.

**Dos decisiones REEMPLAZAN a decisiones anteriores de este mismo documento.** Se registran
aquí de forma visible para poder rastrearlas (no son una contradicción: son un cambio de
dirección con fecha):

| # | Antes (patrón oro 22-jun-2026) | Ahora (dirección 06-jul-2026) |
|---|---|---|
| **SUSTITUCIÓN 1 — Chrome** | Barra + menú lateral en **GRAFITO OSCURO** `#20242F`, área clara | **SIDEBAR CLARO** (blanco) sobre fondo claro; chrome y área comparten la luz |
| **SUSTITUCIÓN 2 — Acento** | Acento **grafito / slate** `#334155 / #1E293B` | Acento **AZUL** `#2F6BFF` (acción principal y enlaces) |

Cambios derivados de la nueva dirección (misma fecha, no eran decisiones separadas pero
quedan anotados): la **tipografía** pasa de *Inter* (fuente cargada) a **tipografía del
sistema**, y los **iconos** dejan de depender de *Tabler Icons* cargado por CDN. Regla nueva:
**prohibido depender de fuentes o iconos cargados de internet** (§1, §2).

El patrón oro anterior (`docs/diseno/sistema-visual-aprobado.html`, chrome grafito) queda
**superado por esta dirección** en lo relativo a chrome, acento, tipografía e iconos. La
reconciliación de los tokens del código con estos valores (tarea **U1 — tokens**) quedó
**APLICADA el 2026-07-06** en `modules/erp/layout.js` (`ROOT_TOKENS` + chrome/topbar claros +
fuente del sistema + chips), junto con el **auto-hospedaje de los iconos** y el **menú lean**.

---

## 1. Principio rector

**El iPhone del nicho** (CANON §0-bis, commit `6017a6d`). Una sola versión, fácil por
fuera y potente por dentro; la complejidad se **esconde hasta que hace falta**. Referencia de
**calidad**: Holded — pero **simplificado al máximo**. El estándar de validación de cualquier
pantalla:

- **Si una pantalla necesita manual, está mal.** La facilidad es trabajo nuestro, no del
  usuario. Cada vez que haya que explicar algo, el fallo es de diseño y se rehace.
- **El dueño DECIDE con DISA, no opera.** La app no expone la maquinaria de un ERP: la
  esconde. DISA propone; el dueño confirma. Nada de pantallas que pidan "operar".
- **Densidad — un solo botón principal por pantalla.** Una sola acción primaria,
  destacada (azul). Lo secundario va **agrupado o discreto** (menú "···"), **nunca esparcido
  "donde quepa"**. Ver el patrón por pantalla en §6.
- **Mucho aire, poca cosa a la vista. Poco color.** Jerarquía clara; lo de segundo nivel,
  oculto hasta que se pide. El color se reserva para *la* acción y *el* estado.
- **Autosuficiente y sin dependencias de red para el aspecto.** Prohibido depender de
  fuentes o iconos cargados de internet: tipografía del sistema, iconos propios/embebidos.

---

## 2. Identidad visual (tokens)

> Valores **exactos** de la dirección del 2026-07-06 (§0-bis). Estos son la base para U1.
> Donde choquen con el patrón oro grafito anterior, **manda esto** (chrome, acento,
> tipografía, iconos).

### 2.1 Luz y "chrome"

- **Todo en CLARO — sidebar y superficies claras, fondo claro.** El "chrome" (barra superior
  + menú lateral) es **BLANCO**, no oscuro. Chrome y área de trabajo comparten la misma luz.
  *(SUSTITUCIÓN 1: antes el chrome era grafito `#20242F`.)*
- **Poco color.** La superficie es tranquila; el azul aparece solo en la acción principal, los
  enlaces y el estado. Nada de bloques de color grandes.

### 2.2 Acento

- **Azul `#2F6BFF`** — acción principal (botón primario) y enlaces.
  *(SUSTITUCIÓN 2: antes el acento era grafito/slate `#334155`.)*
- **Con moderación:** si el azul aparece, es *la* acción o *el* enlace. Un solo primario por
  pantalla (§6).

### 2.3 Texto

| Token | Valor |
|---|---|
| Texto principal | `#14161B` |
| Texto secundario | `#5C616B` |
| Texto tenue | `#8A8F99` |

### 2.4 Bordes y separadores

| Token | Valor |
|---|---|
| Bordes | `#E4E6EA` |
| Separadores | `#EEEFF2` |

### 2.5 Chips de estado (fondo / texto)

| Estado | Fondo | Texto |
|---|---|---|
| Pagada | `#E4F6EA` | `#157F3B` |
| Pendiente | `#FBEED0` | `#8A5B00` |
| Vencida | `#FBE3E3` | `#C0392B` |
| Enviada | `#E4EDFF` | `#2451C7` |
| Borrador | `#ECEDF0` | `#565A62` |

### 2.6 Tipografía

- **Tipografía DEL SISTEMA:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto`.
  Jerarquía por tamaño, color y peso. *(Sustituye a Inter; ya no se carga ninguna fuente.)*
- **Prohibido depender de fuentes cargadas de internet.**

### 2.7 Esquinas · iconos

- Radios: **9px en controles**, **12px en tarjetas**.
- **Iconos:** de línea. **Prohibido depender de iconos cargados de internet.** *(Aplicado: el
  webfont de Tabler se sirve **auto-hospedado** desde `/public/vendor/tabler`, sin CDN. Migrar a
  SVG inline propio queda como mejora futura; el requisito "sin internet" ya se cumple.)*

---

## 3. Navegación — RAIL de iconos por área + submenú FLOTANTE (estilo Holded)

> **SUSTITUCIÓN 3 — modelo de menú (revisado 2026-07-06).** El **"lean estricto"** (5 entradas,
> resto solo-por-URL) **escondía demasiadas funciones**; el dueño lo descartó al verlo. Modelo
> vigente: **rail estrecho de iconos, un icono por ÁREA; al pasar/pulsar abre un flyout con TODAS
> las funciones de esa área** (como Holded). Así **ninguna función se esconde**, pero el menú
> sigue calmado (en reposo solo iconos). Registro del cambio:
> `menú por ciclo (siempre expandido)` → `lean estricto (5, resto por URL)` → **`rail + flyout`**.

### 3.1 Estructura del menú (aplicado 2026-07-06, `modules/erp/layout.js`)

- **Rail (icono por área):** **Inicio** (enlace directo, es la home de DISA) · **Ventas** ·
  **Compras y gastos** · **Contabilidad** · **Inventario** · **Catálogo**.
- **Se despliega al hover** (aplicado): en reposo solo iconos (62px); al pasar el ratón (o con un
  flyout abierto) el rail se ensancha y **muestra el nombre de cada área, con la actual resaltada**
  (así se ve "dónde estás"). Los sub-elementos siguen en el flyout a la derecha.
- **Flyout por área** (submenú flotante a la derecha, se abre al hover/click):
  - **Ventas:** Facturas · Presupuestos · Recurrentes · Pedidos · Albaranes · Cobros · TPV ·
    Portal de cliente · Clientes · Grupos · *(CRM pendiente)*.
  - **Compras y gastos:** Facturas recibidas · Compra directa · Órdenes de compra · Pagos a
    proveedores · Devoluciones · Captura de factura · Proveedores.
  - **Contabilidad:** Libros y modelos · Conciliación bancaria · Envío Verifactu (AEAT).
  - **Inventario:** Stock · Almacenes · Traslados.
  - **Catálogo:** Productos · Categorías.
- El icono del área se marca **activo** cuando la pantalla actual es una de sus funciones.
- **DISA fija arriba** (aplicado): sparkles en lo alto del rail con **insignia de contador de
  propuestas** (de `estadoAvisos`, leído de la BD del tenant); es a la vez marca e **Inicio**
  (→ `/admin`, la home de DISA). **"Ayuda y soporte"** (aplicado): al **pie del rail** (→ `/docs`).
- **Cuenta/usuario:** en el desplegable del avatar (topbar).

### 3.2 Cómo DISA reagrupa dentro de cada área (no crea menús nuevos)

| Función | Dónde vive |
|---|---|
| **Presupuestos** y **Recurrentes** | en **Ventas** (y conceptualmente cuelgan de Facturas) |
| **Conciliación** | en **Contabilidad** — y la **empuja DISA** |
| **Impuestos, modelos, libros, P&G** | en **Contabilidad** → "Libros y modelos" |
| **Analítica** | **dos puertas** (CANON §3-bis): DISA la responde desde **Inicio**, *y* tiene **panel propio alcanzable** — el constructor de analíticas. La pantalla y su enlace **se crean en el paso 4a** de la escalera; hasta entonces `/admin/analytics` sigue viva y sin enlace |

### 3.3 Regla de colocación (permanente)

Antes de añadir una función nueva, preguntar **"¿de qué área es —venta, compra/gasto,
contabilidad, inventario o catálogo?"** y meterla en el flyout de esa área. Si no encaja en
ninguna, se anota como huérfana y lo decide el dueño — **no se fuerza una sexta área**.

---

## 4. DISA

- **Protagonista — DISA ES la home** (Inicio): saludo personalizado + propuestas del día +
  cifras + lista con chips + campo para hablarle. Analítica ("¿cómo va mi negocio?") se
  responde aquí, no en un menú aparte.
- **Proactiva:** habla primero, propone (avisos del día), no espera órdenes (CANON §1, §5).
  El **contador de propuestas** del rail (§3.1) refleja lo que DISA tiene pendiente de que el
  dueño revise.
- **Presentación consistente** en toda la plataforma: la misma cara de DISA donde aparezca.
- **Cómo se muestra dentro de una pantalla:** como un **aviso calmado** (banda con tinte azul
  claro) con **UN solo enlace de acción** (p. ej. "Revisar →"), **nunca** un grupo de botones
  (§6). DISA empuja, no llena de mandos.

---

## 5. Documentos (factura, presupuesto, recibo, etc.)

- **SIEMPRE se abren DENTRO de la plataforma:** el documento dibujado a la **izquierda** +
  un **panel lateral a la derecha** con sus datos y acciones (cobrar, anular, rectificar,
  compartir, descargar PDF).
- **Descargar el PDF es UNA acción más, nunca la única forma de verlo.**
- **Todos los documentos comparten el mismo diseño** — se sienten iguales.
- **Coherente con la inmutabilidad:** la vista es de **solo lectura**; corregir crea un
  **asiento nuevo enlazado**, nunca edita el original (CANON §4 — anular / rectificar).

---

## 6. Patrón por pantalla (mata la "sopa de enlaces")

> **Aplicación (2026-07-06):** primitivas compartidas en `modules/erp/layout.js` — `disaBand()`
> / `window.disaBand` (banda azul con un enlace) y `rowMenu(items, {label})` / `window.rowMenu`
> (menú `···`, o botón con etiqueta tipo "Exportar ▾"), con su CSS `.disa-band` / `.rmenu*`.
> Aplicado a las **5 pantallas del menú lean**:
> - **Inicio** — ya cumplía el patrón (es la home de DISA: filas calmadas + un solo primario).
> - **Facturas** — banda de vencidas → "Revisar →" a Cobros; acciones de fila (Gestionar/
>   Rectificar/Anular) colapsadas en `···`, "Ver" como única acción visible.
> - **Gastos** (facturas recibidas) — banda de vencidas → "Revisar →" a Pagos; "Pago" deja de ser
>   azul (secundario), sin primario por fila.
> - **Clientes** — Editar/Archivar en `···`, "Ver" visible.
> - **Contabilidad** — la fila de 3 enlaces de export (Excel/CSV/PDF) colapsada en "Exportar ▾".
>
> **Aplicado a las pantallas secundarias (2026-07-06):** acciones de fila colapsadas en `···` y
> primarios-por-fila degradados a secundarios en **Productos**, **Categorías**, **Proveedores**,
> **Almacenes**, **Stock** y **Pagos**. Las listas de Presupuestos, Pedidos, Albaranes, Órdenes de
> compra, Traslados, Devoluciones y Compra directa **ya cumplían** (una sola acción "Ver" por fila).
> **Pendiente de §6:** reducir las **6 pestañas** de Contabilidad a máx 2-3 — decisión de IA del
> dueño, no se fuerza aquí.

La regla de densidad del §1, aterrizada en cada pantalla:

- **UN botón primario azul por pantalla.** El resto de acciones se agrupan en un menú
  **"···"**. Nunca dos primarios compitiendo.
- **Nada de filas de enlaces azules.** El azul es *la* acción o *el* enlace, no una barra de
  ellos. Si hay que separar contenido: **máx 2-3 pestañas**, nunca más.
- **DISA = aviso calmado.** Banda con **tinte azul claro** y **un solo enlace de acción**
  (p. ej. "Revisar →"). **Nunca** un grupo de botones dentro del aviso.
- **Lista, ficha, modal y tabla: misma plantilla** — superficie blanca, bordes finos
  (`#E4E6EA`), separadores (`#EEEFF2`), padding generoso, **chips de estado** del §2.5.
- **Iconos:** de línea, grosor consistente, propios/embebidos (§2.7).

---

## 7. Huérfanas — DOS destinos distintos (aquí solo se listan; NO se tocan)

> Salen del inventario del Paso 0 (TABLERO → Decisiones D1–D4). Tienen **final distinto**,
> por eso van separadas. **Cada destino es una tarea aparte con su propio encargo.** Aquí
> no se desmonta ni se archiva nada: solo queda registrado para que no se cuele en el mapa.
> *(Con el menú lean del §3, nada de esto es entrada de menú.)*

### 7.1 A ARCHIVAR / CERRAR (restos de e-commerce — D1 / D2 / D3)

| Pantalla / superficie | Ruta(s) | Decisión |
|---|---|---|
| Buzón de feedback | `/admin/feedback` | D2 |
| Newsletter / suscriptores | `/admin/newsletter` (+ `/export`) | D2 |
| Reseñas | `/admin/reviews` | D2 |
| Métodos de envío | `/admin/shipping` | D2 |
| Etiquetas / tags | `/admin/tags` *(montada, oculta del menú)* | D2 |
| Editor "Tienda Online" | `/admin/store-settings` + `/admin/settings/store` | D2 |
| Pestaña Imágenes de producto | `/admin/products/:id/images` *(oculta)* | D2 |
| Hoja "FACTURA" de pedido | `/admin/orders/:id/invoice` | D3 — no es la factura Verifactu |
| Tienda pública | `modules/store/` → `/store`, `/api/store` | D1 — cerrar con llave |

### 7.2 EN ESPERA DEL PILAR 4 (clúster `sales_orders` — funciones reales a rediseñar/decidir)

| Pantalla | Ruta(s) | Nota |
|---|---|---|
| Pedidos viejos (lista/ficha/borrador) | `/admin/orders` · `/:id` · `/draft/new` | D4 |
| Reembolsos | `/admin/orders/refunds` | D4 |
| Descuentos (cupones + automáticos) | `/admin/discounts` · `/auto` | D4 |
| Analítica → **Informes** | `/admin/analytics` (+ overview, best-sellers, exports…) | Sección REAL, **no** un resto. **Ya NO lee el clúster viejo**: PIEZA C la recableó a la cadena nueva (`analytics.js:5` importa `ventas-metrics.js`, que cuenta desde las facturas). Es el arranque de la puerta visual — escalera pasos 2-4a |

Notas de esta zona:
- **Analítica NO es basura de e-commerce:** es una sección REAL. ~~Reservada, en espera del Pilar 4,
  porque su fuente de datos es el clúster que se va a decidir.~~ **Esa espera terminó:** el Pilar 4
  cerró y **PIEZA C la recableó** a la cadena nueva (`ventas-metrics.js`, ventas contadas desde las
  facturas). Ya no espera a nadie: es el arranque de **la puerta visual** (escalera, pasos 2 → 4a).
- **Y la línea de arriba cambió de sentido (17 jul 2026).** Decía *"Analítica no es menú: DISA la
  responde desde Inicio"*. Era verdad a medias y se quedó corta: DISA es **una** puerta, no la única.
  CANON §3-bis fija ahora **las dos puertas** — la conversacional (DISA desde Inicio, §3.2 y §4, que
  **no se toca**) y la **visual** (panel propio donde el usuario **construye sus gráficos**, no elige
  entre los que alguien cerró por él). Que no hubiera puerta visual no era diseño lean: era un hueco.
- **Lo que este documento NO decide todavía**, y le toca al mini-plan del paso 4a: **dónde vive esa
  pantalla**. §3.3 dice *"no se fuerza una sexta área"* y esa regla sigue en pie — pero el panel no es
  un área de documentos (venta/compra/contabilidad/inventario/catálogo): se parece más a **Inicio** y
  **DISA**, que ya viven en el riel sin ser áreas. **Se decide al llegar al 4a, no aquí.**

---

## 8. Observaciones registradas (no se actúa sobre ellas aquí)

- **Reconciliación de tokens del código** con los valores del §2 (chrome claro, azul `#2F6BFF`,
  tipografía del sistema, iconos auto-hospedados) → tarea **U1 (tokens)**, **APLICADA el
  2026-07-06** en `modules/erp/layout.js` (+ `printableShell` para PDF/email). Verificado: render
  con el azul y sin Inter/Google Fonts, y los estáticos de `/public/vendor/tabler` servidos 200.
- **Patrón oro anterior** (`docs/diseno/sistema-visual-aprobado.html`, chrome grafito): queda
  superado por §0-bis en chrome, acento, tipografía e iconos. Si se conserva como referencia
  histórica, no manda sobre estos tokens.
- **Menú por ciclo de negocio** (Ventas/Compras/Inventario/Catálogo) del mapa anterior: queda
  superado por el menú lean del §3. Las funciones de Capa 2 no vuelven al menú; se esconden o
  quedan como huérfanas (§7).
