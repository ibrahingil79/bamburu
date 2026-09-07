# Inventario del uso de IA en Bamburu — 6 de septiembre de 2026

> **Decisión de Ibrahin, 6 sep 2026: Bamburu deja de usar IA. DISA sale del producto.**
> Este documento es el **paso 0** del apagado, hecho **en solo lectura antes de tocar nada**, y es la
> base del trabajo que viene después: primero apagar, y el borrado del código en un encargo aparte.
>
> **Apagar no es borrar.** Aquí no se propone quitar una línea: se inventaría qué hay, para que la
> decisión de qué se rehace sin IA y qué se retira se tome sobre datos y no de memoria.

---

## 1 · La puerta, y quién la cruza

Hay **una sola puerta** al proveedor: `core/llm.js` → `callClaude()` → `https://api.anthropic.com/v1/messages`.
Nadie más habla con Anthropic. Verificado sobre el árbol: no hay ningún otro `fetch` a ese dominio.

**Y solo TRES módulos de producción la cruzan:**

| Módulo | Llamadas | Qué hace |
|---|---|---|
| `modules/disa/index.js` | 2 (**una ya estaba muerta**) | El asistente: chat, hilos, agentes, consultas a la base y acciones |
| `modules/registro/index.js` | 1 | El alta por chat y el constructor de la tienda |
| `modules/erp/routes/purchases-capture.js` | 1 | Leer una factura de proveedor desde una foto o un PDF |

**⚠️ Cuatro ficheros parecían usarla y NO la usan.** `modules/superadmin/index.js`,
`core/aviso-arranque.js`, `core/stripe.js` y `modules/erp/models.js` aparecen al buscar `core/llm.js`,
pero **solo lo mencionan en comentarios** (el espejo del tope de gasto, el patrón de `fetch`, la
moneda). No importan nada y no llaman. *Conviene saberlo antes de borrar: apagarlos no hace nada.*

**⚠️ Y lo más importante de todo este inventario: `modules/erp/` NO llama al modelo. Ni un fichero.**
Todas las alertas, propuestas, reposiciones, recurrentes y clientes dormidos son **cálculo y regla**.
No hay que rehacerlas: ya funcionan sin IA.

---

## 2 · Pieza por pieza

### 2.1 · El asistente de las pantallas (DISA)

- **Qué hace.** Un chat en burbuja, presente en **todas** las pantallas del panel (se monta desde
  `modules/erp/layout.js`, que es el armazón común). El usuario escribe en lenguaje natural y DISA
  responde, consulta la base y puede ejecutar acciones.
- **Dónde se ve.** La burbuja, en todo el panel. Además una franja propia (`<div id="disaBand">`) en
  **facturas emitidas** (`routes/invoices.js`) y **facturas de proveedor** (`routes/supplier-invoices.js`).
  Y una entrada de menú propia con su botón (`disaRailBtn`).
- **Rutas.** `/admin/disa` y `/api/disa` (`modules/disa/index.js:3171-3172`): `/message`, `/threads`,
  `/threads/:id`, `/agents`, `/select-agent`, `/chips`, `/summary`, `/store-message`.
- **Tablas.** `disa_conversations`, `disa_conversation_threads`, `disa_profile`, `disa_agents`,
  `disa_agent_instructions`, `disa_quick_chips`, `disa_proposals`, `disa_action_audit`,
  `disa_usage`, `disa_spend`.
- **Qué puede ejecutar.** Una herramienta de lectura, `query_database`, y **doce acciones de
  escritura**: `create_client`, `create_product`, `create_variant`, `create_category`,
  `create_supplier`, `create_rectificativa`, `delete_product`, `delete_variant`, `delete_category`,
  `delete_supplier`, `update_company_config`, `update_profile`.
- **Motor.** Bucle de herramientas acotado a `MAX_VUELTAS = 5` llamadas a la API por mensaje.
- **⚙️ CORREGIDO AL APAGAR:** de los dos sitios que llamaban al modelo, **uno ya estaba muerto desde
  antes**. `/store-message` (el constructor de tienda por voz, D2) devuelve 404 en su primera línea
  desde que se desmontó el editor, y su cuerpo es inalcanzable. **DISA tenía UN solo camino vivo al
  modelo: `POST /api/disa/message`.**
- **Si desaparece.** Se pierde **la puerta conversacional**, no la información: CANON §3-bis dice que
  todo se alcanza por DISA **y** por la vía visual, y la vía visual está entera. Cada una de las doce
  acciones tiene su pantalla. Lo que se pierde de verdad es **hacerlo hablando**.
- **Clasificación:** 🗣️ **NECESITA LENGUAJE.** Es lenguaje de principio a fin.

### 2.2 · El alta por chat y el constructor (`modules/registro`)

- **Qué hace.** En `/registro`, `POST /api/registro/disa` conversa con quien se da de alta para
  sacarle los datos del negocio y proponerle un catálogo de arranque.
- **Dónde se ve.** La página pública de alta. `POST /api/registro/init` y `/api/registro/crear` son
  los pasos que la rodean.
- **Tablas.** Escribe en `control.db` (`tenants`) y siembra el negocio nuevo vía `provisionTenant`.
- **Si desaparece.** El alta **sigue existiendo**: `provisionTenant` no necesita el modelo, y el
  catálogo de arranque por oficio (`fijarOficio` + `sembrarCatalogo`) tampoco. Lo que se pierde es
  rellenar el formulario conversando.
- **Clasificación:** 🗣️ **NECESITA LENGUAJE** para la conversación · ⚙️ **REGLA** el alta en sí y el
  catálogo por oficio, que ya funcionan sin IA.

### 2.3 · Leer una factura de proveedor por foto o PDF (`purchases-capture`)

- **Qué hace.** Se sube una imagen o un PDF, se manda al modelo (`imageBlock` / `documentBlock`) y se
  extraen proveedor, fechas, líneas, base, IVA y total. El usuario **revisa y confirma** antes de que
  se guarde nada.
- **Dónde se ve.** `/admin/purchases/capture` y `/admin/purchases/capture/confirm`.
- **Tablas.** `supplier_invoices` y sus líneas, tras la confirmación.
- **Si desaparece.** Se pierde la captura automática; **meter la factura a mano sigue existiendo**.
  Ningún dato guardado se pierde: lo ya capturado está en las tablas y no depende del modelo.
- **Clasificación:** 🗣️ **NECESITA ENTENDER UN DOCUMENTO.** Es la única función del producto que un
  cálculo no puede sustituir: leer un papel con formato libre. Un OCR clásico + reglas cubriría parte,
  pero no es lo mismo y sería otra tarea.

### 2.4 · Propuestas, avisos y automatismos — ⚙️ **NINGUNO USA IA**

Medido: **ni un fichero de `modules/erp/` llama a `callClaude`**, y **ninguna de las cinco tareas de
reloj** importa `core/llm.js`.

| Pieza | Fichero | Qué es |
|---|---|---|
| Recordatorios de impago | `modules/erp/propuestas.js` | ⚙️ Regla: factura vencida + días |
| Reposición de stock | `modules/erp/reposicion.js` | ⚙️ Cálculo: bajo mínimo → borrador de compra |
| Facturas recurrentes | `modules/erp/recurrentes.js` | ⚙️ Regla: toca según su periodicidad |
| Clientes dormidos | `modules/erp/propuestas.js` | ⚙️ Cálculo: días desde la última compra |
| Vencimientos fiscales | `modules/erp/calendario-fiscal.js` | ⚙️ Calendario |
| Avisos por email | `scripts/bamburu-avisos.mjs` | ⚙️ Consulta + plantilla |

**Se llaman «Propuestas de DISA» y no las hace DISA.** Es solo el nombre de la bandeja
(`disa_proposals`). **Al apagar el modelo siguen funcionando exactamente igual** — pero hay que
comprobarlo, no suponerlo, y hay que decidir si la bandeja cambia de nombre. *Ninguna necesita
rehacerse sin IA: ya está hecha sin IA.*

---

## 3 · Resumen para decidir

| | Necesita lenguaje | Es cálculo o regla |
|---|---|---|
| Asistente de las pantallas | 🗣️ Sí, entero | — |
| Alta por chat | 🗣️ La conversación | ⚙️ El alta y el catálogo por oficio |
| Lectura de facturas por foto/PDF | 🗣️ Sí — es leer un documento libre | — |
| Propuestas, avisos, reposición, recurrentes, dormidos, fiscal | — | ⚙️ **Todo** |

**Tres funciones necesitan lenguaje. El resto —que es la mayor parte de lo que el dueño usa a
diario— no lo necesitaba nunca y no lo usa.**

---

## 4 · Lo que consume hoy, medido

**No hay registro por llamada ni por día.** Solo contadores mensuales: `llm_spend_global(month, eur)`
en `control.db` y `disa_spend` / `disa_usage` por negocio. `error_log` no guarda **nada** del modelo
(0 de 307 filas). Eso es la ficha `caida-ia-deja-rastro`, que sigue pendiente.

| | septiembre 2026 | agosto 2026 |
|---|---|---|
| Gasto global | **8,17 €** | 6,40 € |
| Mensajes, `desarrollo-bamburu` | 27 (1,97 €) | 68 (5,74 €) |
| Mensajes, `gate-borrado-a-38ddfe` | **41** | — |
| Mensajes, `gate-csrf-disa-bede37` | **15** (0,86 €) | — |

**56 de los 83 mensajes de septiembre (67 %) salen de negocios de gates, no de uso real.** Y los
2,83 € de los negocios no explican los 8,17 € globales: faltan **5,34 €** de sitios sin negocio
detrás (alta por chat, captura de facturas, superadmin), y **no se puede saber de cuál**.

`disa_usage` cuenta **mensajes**, no llamadas: con `MAX_VUELTAS = 5`, esos 83 mensajes son entre 83 y
415 llamadas reales.

### Quién llama desde las comprobaciones

~~**Cinco gates del barrido llaman al proveedor de verdad**, conduciendo a DISA por HTTP:
`gate-avisos-badge`, `gate-disa-adjuntar`, `gate-disa-csrf`, `gate-disa-borrado-conversaciones`,
`gate-disa-dictar-compra`.~~

**⚙️ CORREGIDO EL MISMO DÍA: ESA LISTA ESTABA MAL, Y LA DI COMO MEDIDA SIN SERLO.** Salió de un
`grep` heurístico —«¿hay un `fetch` cerca de la palabra `disa`?»— y sobre ella se tomó una decisión.
Medido de verdad contra el ÚNICO camino vivo (`POST /api/disa/message`):

| Gate | Qué hace en realidad |
|---|---|
| `gate-disa-csrf` | 🔴 **postea de verdad** |
| `gate-disa-dictar-compra` | 🔴 **postea de verdad** |
| `gate-disa-borrado-conversaciones` | **no nombra `/message`** — siembra con `INSERT INTO disa_conversations` |
| `gate-avisos-badge` | **no lo nombra.** Su cabecera ya lo decía: *«Determinista (sin modelo)»* |
| `gate-disa-adjuntar` | **no lo nombra.** Su cabecera: *«la parte que NO necesita al modelo»* |
| `gate-csp-estricta` | lo **intercepta** con `setRequestInterception`: nunca sale |
| `gate-inicio-cuadro-mando` | solo comprueba que **no** esté en la página |

**Eran DOS, no cinco.** Y los 41 mensajes del negocio `gate-borrado-a` que se atribuyeron a su gate
**no los generó él**: siembra por SQL. El contador es mensual y no guarda el origen, así que **de
dónde salieron no se puede saber**. Se deja escrito en vez de corregirse en silencio, que es lo que
manda este repositorio — y porque una cifra inventada se arrastra hasta que alguien decide sobre ella.

Fuera del barrido y a mano: `verify-llm-disa-stock`, `verify-pedidos-disa`, `verify-disa-alcance`
(declarados en `EXCLUIDOS` con el motivo escrito: *«ni determinista ni gratis, y en un barrido
nocturno el coste se multiplica por 365»*), más `verify-llm-migracion`, `verify-d5-create-product`,
`verify-albaranes-disa`, `gate-c2-captura` y `gate-disa-captura-chat`.

**Ya interceptados** (inyectan `fetchImpl` y no salen a la red): `comprobar-clave-anthropic`,
`test-llm-texto-respuesta`, `verify-disa-herramientas-paralelo`. **El mecanismo de intercepción ya
existe** (`core/llm.js:111`, `fetchImpl` inyectable): apagar los cinco del barrido es aplicarles lo
que estos tres ya hacen.

**No hay bucles ni reintentos** en `core/llm.js`. El único bucle es `MAX_VUELTAS = 5`, acotado y por
mensaje. **Ninguna tarea de reloj consume nada.**

---

## 5 · Lo que este inventario deja apuntado para el paso 2

1. **No hay que rehacer las propuestas sin IA: ya están sin IA.** Lo que hay que decidir es si la
   bandeja deja de llamarse «Propuestas de DISA».
2. **La captura de facturas es la única pérdida sin sustituto directo.** Meterlas a mano sigue ahí.
3. **Diez tablas `disa_*` con datos dentro.** Apagar no las toca; borrarlas es una decisión aparte y
   la regla permanente del repo dice **archivar, nunca destruir**.
4. **Los cuatro ficheros que solo mencionan `core/llm.js` en comentarios** no hay que tocarlos.
5. **Los negocios `gate-*`** (`gate-borrado-a-38ddfe`, `gate-borrado-b-38ddfe`, `gate-csrf-disa-bede37`)
   son de comprobaciones y están registrados en `control.db` como si fueran negocios.
