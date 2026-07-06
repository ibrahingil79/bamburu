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
> (`/public/vendor/tabler`, fuera CDN) y **menú lean estricto de 5 entradas**. Pendiente: patrón
> por pantalla §6 (refactor por-vista) y la barra DISA-fija-con-contador + "Ayuda y soporte" §3.1.
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

## 3. Navegación — menú LEAN de UNA sola capa

> **Nueva dirección (2026-07-06).** Menú de **una capa, máx 5-6 entradas, SIN sub-enlaces ni
> tercer nivel.** Esto **supera** el mapa anterior por ciclo de negocio (Ventas / Compras /
> Inventario / Catálogo): aquello arrastraba superficie de Capa 2 y densidad de ERP. Aquí se
> esconde la complejidad, no se despliega.

### 3.1 Estructura del menú

- **Entradas (una capa, sin sub-enlaces):**
  **Inicio · Facturas · Gastos · Clientes · Contabilidad.**
  *(Aplicado 2026-07-06, lean estricto: estas 5 y nada más en el menú; el resto de rutas siguen
  montadas y accesibles solo por URL. "Gastos" → `/admin/supplier-invoices` — el libro de
  "Compras y gastos". DISA fija-con-contador y "Ayuda y soporte" del §3.1 quedan pendientes.)*
- **DISA fija arriba**, con **contador de propuestas**.
- **Abajo del rail:** **Ayuda y soporte** + **usuario** (bajo el usuario: Mi cuenta · Ajustes ·
  Datos del negocio · Cerrar sesión).

### 3.2 Dónde vive lo que deja de ser menú propio

Nada de lo anterior desaparece: se **esconde dentro** de una de las cinco entradas.

| Lo que antes era su propio menú | Dónde vive ahora |
|---|---|
| **Presupuestos** y **Recurrentes** | dentro de **Facturas** (pestaña o filtro) |
| **Conciliación** | dentro de **Gastos/cobros** — y la **empuja DISA** |
| **Impuestos, modelos, libros, P&G** | dentro de **Contabilidad** |
| **Analítica** | **no es menú**: DISA responde "¿cómo va mi negocio?" desde **Inicio** |

### 3.3 Regla de colocación (permanente)

Antes de añadir cualquier función nueva, preguntar: **"¿en cuál de las cinco entradas cabe?"**
y esconderla dentro (pestaña, filtro, o empujada por DISA). **Nunca crear una sexta entrada
"donde quepa"** ni abrir un segundo/tercer nivel. Si no cabe en ninguna, se anota como
huérfana y lo decide el dueño — no se fuerza el menú.

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
| Analítica → **Informes** | `/admin/analytics` (+ overview, best-sellers, exports…) | Sección REAL, **no** un resto; hoy lee el clúster viejo (D4) |

Notas de esta zona:
- **Analítica NO es basura de e-commerce:** es una sección reservada — **Informes, en
  espera del Pilar 4** — porque su fuente de datos es el clúster que se va a decidir. En el
  menú lean del día a día, "¿cómo va mi negocio?" lo responde **DISA desde Inicio** (§3.2, §4);
  los Informes de detalle quedan para cuando se decida el Pilar 4.

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
