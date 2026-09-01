# Análisis — `retirar-pantallas-muertas`

🛑 TAREA MAL PLANTEADA

**Motivo: lo que pide ya está hecho.** Los seis ficheros se borraron del árbol el **24 ago 2026**, en
el commit **`fe6bef0`** («Lo invisible, saneado: la BD abierta, la última ventanita, el POS muerto y
los libros descuadrados»), junto con sus 12 líneas de importación. No queda nada que retirar.

El encargo no está mal escrito ni mal delimitado: está **caducado**. Se generó el 31 ago 2026 a
partir de una entrada de inventario que nadie bajó a tachar cuando el trabajo se entregó, siete días
antes. El propio `TABLERO.md` contiene hoy las dos afirmaciones, vivas y contradictorias, a 2.079
líneas de distancia.

No hay nada que construir. Lo que queda es una corrección documental, y va en la sección 4.

---

## 1. Qué está mal hoy

Lo que está mal **no es el código: es el registro**. El código está correcto y completo.

### 1.a Los seis ficheros no existen — comprobado, no supuesto

`git ls-files | grep -E '(orders|discounts|shipping|feedback|reviews|newsletter)'` devuelve
exactamente una línea, y es `modules/erp/routes/purchase-orders.js`, que es una pantalla **viva** y
sin relación (órdenes de compra, montada en `modules/erp/routes/index.js:175` y `:247`).

Los seis desaparecieron en el mismo commit. Las líneas que tenían **inmediatamente antes** de ser
borrados coinciden al dígito con las que declara el encargo:

| Fichero (ruta previa al borrado) | Líneas en `fe6bef0^` | Declaradas en el encargo |
|---|---|---|
| `modules/erp/routes/orders.js` | 1061 | 1061 |
| `modules/erp/routes/discounts.js` | 191 | 191 |
| `modules/erp/routes/shipping.js` | 107 | 107 |
| `modules/erp/routes/feedback.js` | 84 | 84 |
| `modules/erp/routes/reviews.js` | 81 | 81 |
| `modules/erp/routes/newsletter.js` | 60 | 60 |
| **Total** | **1.584** | **1.584** |

La coincidencia exacta de las seis cifras descarta que el encargo hable de otros ficheros
homónimos en otra parte del árbol. Es el mismo trabajo, medido sobre el mismo estado.

### 1.b Las 12 líneas de importación tampoco están

`modules/erp/routes/index.js` no conserva ningún `import` vivo de los seis. La única línea `import`
que casa con el patrón es la 31, `import { createPurchaseOrderRoutes } from './purchase-orders.js';`
— otra pieza. Y `grep -rE "create(Order|Discount|Shipping|Feedback|Review|Newsletter)(Routes|Views|Api)"`
sobre todo el repo (excluido `node_modules`) **no devuelve ni una ocurrencia**: no quedan
constructores huérfanos ni referencias colgando.

Lo que sí queda en `index.js` son **comentarios** que documentan el desmontaje —líneas 135-138,
140-154, 165-167, 180-181, 224-229, 240-242, 252-253—. No son código muerto: son la explicación de
por qué esas rutas dan 404 y de por qué no deben volver. Se quedan.

### 1.c El fichero que sí está mal: `TABLERO.md`, y se contradice a sí mismo

Este es el defecto real, y es exactamente el fallo que `CLAUDE.md` ya tiene documentado bajo
«Un titular de recuento se corrige con el cuerpo que lo desarrolla»:

- **`TABLERO.md:8036`** (bloque de entrega de `fe6bef0`) — *«**Las seis pantallas retiradas,
  retiradas de verdad** (1.584 líneas) y sus 12 líneas de importación. Rutas registradas 642 → 603:
  **39 muertas fuera, ninguna viva perdida**.»* ✅ Cierto.
- **`TABLERO.md:5957`** (§Deuda técnica) — *«⬜ **SEIS FICHEROS DE PANTALLA DESMONTADOS SIGUEN EN EL
  ÁRBOL (24 ago 2026): 1.584 líneas.**»* ❌ Falso desde el 24 ago 2026.
- **`TABLERO.md:8435`** (§Backlog, Limpieza) — *«⬜ Retirar las 6 pantallas muertas (1.584 líneas ya
  sin montar).»* ❌ Falso, misma causa.

La entrada 5957 se escribió el **mismo día** que el commit que la invalida. El 31 ago 2026 se la
convirtió mecánicamente a formato de orquestador (`TABLERO.md:5961` y `:8333-8347`, **estado:
pendiente**) sin comprobar contra el árbol si seguía viva. De ahí sale este encargo.

**El daño no es teórico:** esa conversión metió una tarea vacía en la lista de cinco que hoy manda el
orden de trabajo (`CLAUDE.md` §Fase actual). Un constructor que reciba este plano abriría el repo,
no encontraría los ficheros, y o bien informaría de un fallo inexistente o —peor— buscaría algo que
borrar hasta encontrarlo.

---

## 2. Cómo lo resuelven los que ya lo resolvieron

La pregunta útil aquí **no** es «cómo borran los grandes su código muerto» —eso ya está hecho y bien
hecho—, sino **cómo evitan que un elemento de trabajo cerrado se reabra solo**. Ahí sí los tres
tienen algo que decir, y uno de ellos no aplica.

- **Salesforce — el estado lo lleva el elemento, no el documento que lo menciona.** En su modelo de
  trabajo un ítem tiene un `Status` único y las vistas son *consultas* sobre él; ningún panel guarda
  su propia copia del estado. Traer aquí: **el estado de una tarea debe vivir en un solo sitio del
  `TABLERO.md`**, y las demás menciones han de ser referencias, no afirmaciones independientes. Hoy
  la línea 5957, la 8435 y el bloque 8333 sostienen cada una su propia verdad sobre el mismo trabajo,
  y las tres se pueden desincronizar por separado — que es justo lo que pasó.

- **Odoo — la migración lleva su propia marca de aplicada.** Odoo registra cada script de migración
  como ejecutado y no lo vuelve a lanzar; el criterio no es «¿parece pendiente?» sino «¿consta
  aplicado?». Traer aquí, y es lo más aprovechable: **antes de convertir una entrada de deuda técnica
  en tarea, se comprueba contra el árbol, no contra el texto de la entrada.** Una comprobación de dos
  órdenes —`git ls-files` y un `grep` de imports— habría cerrado esta tarea el 31 de agosto sin
  gastar un turno de arquitectura.

- **SAP — no aplica, y merece decirse por qué.** El mecanismo equivalente de SAP es el retiro de
  objetos por *deprecation* con órdenes de transporte: el objeto se marca obsoleto, se propaga por
  DEV→QA→PRD y queda auditado por sistema. Ese aparato existe porque en SAP el código vive **dentro**
  de la base de datos y no hay un `git` que responda «¿está o no está?». Bamburu tiene el árbol en
  Git y una sola instancia productiva: la pregunta se responde con un comando, y montar un registro
  de retirada aparte sería inventar un segundo sitio donde el estado puede volver a mentir — es
  decir, más de la misma enfermedad que causó este encargo.

**Lo que se trae, en una línea:** el patrón de Odoo (verificar contra el sistema, no contra el
registro) al paso de conversión de tareas; el de Salesforce (un solo dueño del estado) a cómo se
tacha. El de SAP se descarta con motivo.

---

## 3. La decisión

**Decisión: la tarea se cierra sin trabajo de producción, y se corrige el registro que la generó.**

- **Capa:** ninguna del producto. Esto vive **solo en documentación** (`TABLERO.md`). No se toca
  `modules/`, ni `core/`, ni `scripts/`, ni ninguna migración.
- **Patrón del propio código que se sigue:** el de **tachado con motivo y fecha** que el repo ya usa
  en todas partes — `CLAUDE.md` §Fase actual (`~~La siguiente tarea oficial es el aislamiento de
  bloqueos SQLite~~` + «⚙️ CORREGIDO EL 31 ago 2026»), y `TABLERO.md:5950-5956`, que es el caso de
  libro: una entrada de deuda que caducó, tachada entera y con las tres líneas que explican qué se
  midió y cuándo. **Ese es exactamente el molde**, y está a siete líneas de la entrada que hay que
  corregir. La regla que lo manda es de `CLAUDE.md`: *«Las cifras que se contradicen se tachan con su
  motivo y su fecha, no se borran: el registro existe para poder reconstruir qué se creía y cuándo»*.

**Alternativas descartadas:**

1. **Escribir un plan de retirada «por si acaso» y dejar que el constructor descubra que no hay
   nada.** Descartada: es maquillar una tarea muerta, que es justo lo que el papel de arquitecto
   prohíbe. Además arriesga que alguien «encuentre» algo que borrar para justificar el encargo.
2. **Borrar las entradas 5957 y 8435 del `TABLERO.md`.** Descartada por norma explícita de
   `CLAUDE.md`: se tacha, no se borra. Borrar destruye la posibilidad de reconstruir por qué esta
   tarea llegó a existir — que es la única lección que deja.
3. **Revivir las seis pantallas** (la otra mitad del «retirar o revivir» de `TABLERO.md:8344`).
   Descartada, y no es decisión de arquitectura: las seis son **Capa 2** (e-commerce: pedidos POS,
   cupones, envíos, newsletter, reseñas), congelada por `CLAUDE.md` hasta cerrar Capa 1. Revivirlas
   requeriría encargo expreso de Ibrahin, y además `orders.js` traía de vuelta el documento de PEDIDO
   titulado «FACTURA» que `fe6bef0` retiró por riesgo legal.
4. **Añadir una comprobación automática que valide el backlog contra el árbol.** Descartada *en esta
   tarea*: es una pieza nueva, y la fase de saneamiento no admite funciones nuevas sin encargo
   (`CLAUDE.md` §Fase actual). Se deja **propuesta, marcada como propuesta**, en la sección 5.

---

## 4. El plan, paso a paso

Todo el trabajo está en **un solo fichero**: `TABLERO.md`. No hay cambios de producción.

1. **`TABLERO.md:5957-5961`** — tachar la entrada de deuda técnica. Cambiar el `⬜` por `✅` y envolver
   el texto vigente en `~~…~~`, siguiendo literalmente el molde de las líneas 5950-5956 justo encima.
   Debajo, sin tachar, añadir la corrección:

   > **⚙️ CORREGIDO EL 1 sep 2026.** Los seis ficheros **ya no están en el árbol**: se borraron el
   > 24 ago 2026 en `fe6bef0`, con sus 12 líneas de importación, el **mismo día** en que se escribió
   > esta entrada. La entrega está registrada en este mismo fichero, línea 8036. Medido el 1 sep
   > 2026: `git ls-files` no devuelve ninguno de los seis, y no queda ningún `import` ni constructor
   > (`createOrderRoutes` y sus cinco hermanos) en todo el repo.

2. **`TABLERO.md:8435`** (§Backlog → Limpieza) — marcar la casilla como hecha y tachar, con el hash:
   `- [x] ~~Retirar las 6 pantallas muertas (1.584 líneas ya sin montar).~~ ✅ **Ya estaba hecho: `fe6bef0`, 24 ago 2026.** La conversión del 31 ago 2026 (id `retirar-pantallas-muertas`) se hizo sobre un registro caducado.`

3. **`TABLERO.md:8333-8347`** (§TAREAS EN FORMATO DEL ORQUESTADOR) — cambiar `**estado:** pendiente`
   por `**estado:** cerrada sin trabajo — ya estaba hecha (`fe6bef0`, 24 ago 2026)`, y añadir bajo la
   descripción un párrafo que diga que el encargo se generó desde `TABLERO.md:5957`, entrada que
   llevaba siete días caducada, y remitir a este análisis. **No borrar el bloque:** es el rastro de
   por qué la lista de cinco tenía una tarea vacía.

4. **Comprobar que no queda una tercera copia del estado.** Ejecutar
   `grep -nE "1\.584|1584|seis pantallas|6 pantallas" TABLERO.md` y revisar cada resultado: cualquier
   línea que siga afirmando que los ficheros están en el árbol se tacha con el mismo motivo. Es el
   paso que se saltó el 24 de agosto y por el que existe esta tarea — la regla de `CLAUDE.md` es
   `grep` de la cifra vieja **antes** de dar la entrega por terminada.

5. **No tocar nada más.** En concreto, **se dejan intactos**:
   - Los comentarios de desmontaje de `modules/erp/routes/index.js` (135-138, 140-154, 165-167,
     180-181, 224-229, 240-242, 252-253) y los de `modules/disa/index.js:2537-2538`.
   - Los tres gates que afirman **en negativo** que estas rutas no existen —
     `scripts/gate-cupones-desmontados.mjs` (líneas 79, 88, 137, 138),
     `scripts/gate-margen-pantalla.mjs:467` y `scripts/gate-migracion-puerta.mjs:169`. Son la red que
     impide que las pantallas vuelvan; tocarlas sería el único modo de convertir esta tarea
     documental en una avería.

6. **No ejecutar barridos, gates ni tests.** `RITUAL.md` y `CLAUDE.md` los reservan a petición
   expresa de Ibrahin, y este encargo no los autoriza. Las comprobaciones de la sección 6 son
   lecturas de `git` y `grep` sobre el árbol, no ejecuciones del producto.

**Nota de alcance, fuera de esta tarea pero medida:** la línea inmediatamente siguiente del mismo
bloque, `TABLERO.md:8436` («Enlazar las 14 secciones sin acceso desde el menú»), parece tener el
mismo problema — `TABLERO.md:8030` la da por entregada en ese mismo commit («Las 14 pantallas
escondidas, al menú»). **No la toco**: no es mi encargo y no la he verificado contra el código. Queda
dicho para que Ibrahin decida si la lista de cinco necesita la misma revisión.

---

## 5. Riesgos

El riesgo de producción de esta tarea es **cero**: no se modifica ningún fichero ejecutable. Los
riesgos que quedan son de registro y de proceso.

| Riesgo | Cómo se mitiga |
|---|---|
| **Que un constructor lea el encargo original y «retire» algo para justificarlo** — el peligro real: los nombres se parecen a piezas vivas (`purchase-orders.js`, `pedidos.js`, `descuentos.js`). Borrar `pedidos.js` tumbaría el Pilar 4 (`customer_orders`). | El paso 5 lista explícitamente qué **no** se toca, y el criterio 6 exige que las piezas vivas sigan montadas. El propio `fe6bef0` ya dejó comprobado que el «Pedido» que se imprime cuelga de `pedidos.js`, no de `orders.js`. |
| **Perder el rastro de por qué existió esta tarea**, y que dentro de un mes se vuelva a convertir la misma entrada caducada en encargo. | Se tacha con motivo y fecha en los tres sitios (pasos 1-3) en vez de borrar, y el bloque del orquestador se conserva entero. |
| **Que quede una cuarta mención sin corregir** y el `TABLERO.md` siga contradiciéndose. | Paso 4: `grep` de la cifra por todo el fichero antes de cerrar, que es la regla de `CLAUDE.md`. Criterio 5. |
| **Que alguien retire los gates negativos** al ver que apuntan a rutas inexistentes. | Paso 5 y criterio 7. Esos gates son correctos **precisamente porque** las rutas no existen: verifican que siguen dando 404. |
| **VERI\*FACTU y datos de negocio.** | **Sin exposición.** No hay migración, no se toca ninguna tabla y no se borra ni un dato. Las tablas asociadas (`discount_codes`, `auto_discounts`) ya quedaron **archivadas** a `*_archived` por `migration_b_archive_discounts_2026_v1`, conforme a la regla permanente de no destruir datos. El documento de PEDIDO titulado «FACTURA» que cayó con `orders.js` nunca compartió la numeración legal (serie `DEV-2026-NNN`). |
| **Pantallas que dependan de esto.** | Ninguna. Las 39 rutas que cayeron estaban medidas como muertas (404 con sesión de dueño) antes del borrado, y el recuento fue 642 → 603 sin perder ninguna viva. |

**Propuesta — marcada como propuesta, no la ejecutes sin encargo.** El agujero que produjo esta
tarea es de proceso: se convirtió una entrada de deuda en encargo **sin contrastarla con el árbol**.
Una comprobación que, dada una tarea del orquestador, verifique que los ficheros que nombra existen
antes de admitirla, habría costado segundos y ahorrado este ciclo entero. **No la incluyo en el
plan** porque es pieza nueva y la fase de saneamiento no las admite sin encargo. Es decisión de
Ibrahin si merece una tarea propia.

---

## 6. Criterios de aceptación

- [ ] `git ls-files | grep -E 'modules/erp/routes/(orders|discounts|shipping|feedback|reviews|newsletter)\.js$'` no devuelve ninguna línea.
- [ ] `grep -nE "^\s*import .*'\./(orders|discounts|shipping|feedback|reviews|newsletter)\.js'" modules/erp/routes/index.js` no devuelve ninguna línea, y `grep -rnE "create(Order|Discount|Shipping|Feedback|Review|Newsletter)(Routes|Views|Api)" --include=*.js --exclude-dir=node_modules .` tampoco.
- [ ] La entrada de `TABLERO.md:5957` aparece **tachada** (`~~…~~`), no borrada, y su corrección cita el hash `fe6bef0` y la fecha 24 ago 2026.
- [ ] La casilla de `TABLERO.md:8435` está marcada `[x]` y su bloque de tarea del orquestador (`TABLERO.md:8333`) ya no dice `**estado:** pendiente`.
- [ ] `grep -nE "1\.584|1584" TABLERO.md` no devuelve ninguna línea **viva** (fuera de `~~…~~` o de un bloque de entrega histórica) que afirme que los seis ficheros siguen en el árbol.
- [ ] `modules/erp/routes/index.js` sigue montando las piezas vivas de nombre parecido: existen sin comentar `admin.route('/purchase-orders', purchaseOrderViews)` (línea 175) y `apiApp.route('/purchase-orders', purchaseOrderApi)` (línea 247), y `modules/erp/routes/pedidos.js` y `descuentos.js` siguen en `git ls-files`.
- [ ] `scripts/gate-cupones-desmontados.mjs`, `scripts/gate-margen-pantalla.mjs` y `scripts/gate-migracion-puerta.mjs` no aparecen en `git diff --name-only` de esta entrega.
- [ ] `git diff --name-only` de esta entrega contiene **únicamente** `TABLERO.md` (y este análisis): ni un fichero de `modules/`, `core/` o `scripts/`.
