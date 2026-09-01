# CLAUDE.md — Contexto técnico acumulado de Bamburu

> Codex lee este archivo al empezar cada sesión como contexto técnico acumulado. `AGENTS.md` define su
> papel; `CANON.md` manda en estrategia, `TABLERO.md` en estado y tareas, y `RITUAL.md` en la rutina
> vigente. Si una regla histórica de este fichero contradice a cualquiera de esas autoridades, no
> concede permiso: se aplica la autoridad superior y se conserva aquí solo como historia útil.

---

## Fase actual: SANEAMIENTO TÉCNICO (CANON §4)

- La auditoría integral está realizada y la fase de saneamiento general está **ACTIVA**. No se añaden
  funciones nuevas hasta cerrarla; una tarea cada vez. **Saneamientos 1 a 6 están cerrados:**
  S1 barrido nocturno retirado · S2 blindaje de DISA · S3 antiavalancha del rate limiting ·
  S4 clasificación fiscal por línea (`feb90b3`) · S5 los servicios sanitarios nacen `pending` y no
  `taxable` (`f13594e`) · S6 segunda copia de seguridad a la cuenta `gilibrahin` de Drive.
  ~~**La siguiente tarea oficial es el aislamiento de bloqueos SQLite**~~ — **⚙️ CORREGIDO EL
  31 ago 2026 POR DECISIÓN DE IBRAHIN.** El aislamiento de bloqueos SQLite **sigue pendiente y sin
  delimitar**, pero **ya no es la siguiente**: manda la lista de cinco tareas de `TABLERO.md`
  §«TAREAS EN FORMATO DEL ORQUESTADOR», y la siguiente es la primera de esa lista. Se tacha en vez
  de borrarse para poder reconstruir qué se creía y cuándo.
- **Backups: hay DOS copias diarias, en dos cuentas distintas** (principal 03:33 → `ibrahingil`,
  secundaria 03:35 → `gilibrahin`). Una sola pieza las sirve: `scripts/bamburu-backup.sh` sin entorno
  es la principal; la unit de la secundaria sobreescribe `BACKUP_REMOTE`/`LABEL`/`SUFFIX`/`HC_URL`.
  **No la dupliques.** El heartbeat avisa si cae UNA (aviso) y es crítico si caen las DOS. Detalle en
  `deploy/systemd/README.md`.
  ~~Las dos verifican MD5 y hacen prueba de restore real.~~ **⚙️ CORREGIDO EL 1 SEP 2026 (tarea
  `cifrado-copias-seguridad`).** Esa frase describe el estado anterior y se tacha en vez de borrarse.
  Ahora: **el destino va CIFRADO y el script ABORTA si no lo es** (`BACKUP_REMOTE` tiene que ser un
  remote `crypt`; si no, email de fallo y `exit 1` sin subir nada). Un remote `crypt` **no expone
  huellas**, así que pedírselas y creerse el silencio habría apagado la verificación en verde: la
  comparación de huellas la hace ahora `rclone cryptcheck` sobre lo subido, **más** el MD5 del
  fichero ya descargado en la prueba de restore —que además cierra el hueco de que
  `PRAGMA integrity_check` responde `ok` a una base válida pero DISTINTA—. **No queda ninguna rama
  blanda:** si una huella no se puede comparar, es un fallo, no un aviso.
  **La contraseña de cifrado vive SOLO en `~ubuntu/.config/rclone/rclone.conf`, nunca en
  `/etc/bamburu.env`** (ese fichero entra entero en el `process.env` del proceso web), **más una copia
  fuera del servidor en custodia de Ibrahin**: sin ella las copias son ruido.
  **⚠️ Estado al 1 sep 2026: el código está puesto y probado; los remotes `crypt` los crea Ibrahin**
  (necesita escribir en `~/.config/rclone`, fuera del alcance del orquestador). Hasta que existan,
  las dos copias abortan con email — a propósito. Cómo crearlos: `deploy/systemd/README.md`
  §«Cifrado de las copias».
- El Peldaño 9 — Belleza/estética sigue pendiente en el roadmap funcional, pero está aplazado y no es
  la siguiente tarea.

- La escalera sigue siendo el **roadmap funcional aplazado** (CANON §4), donde cada peldaño se apoya en el anterior:
  sincerar → margen → informes → **constructor de analíticas (la puerta visual)** → DISA predictiva →
  dashboards → oficios → el resto. **No hay lista de "espera" ni capa aparte**; el detalle y la
  colocación de cada módulo están en `TABLERO.md` (§LA ESCALERA). **No se inicia un paso sin encargo.**
- La **fase de optimización** (tres ejes: UX, DISA, Seguridad) quedó **✅ CERRADA** — los tres completos.
  Sus reglas rectoras siguen vigentes (CANON §4-bis) y se aplican a lo que se construya; lo que caducó
  es su prioridad ("las funciones nuevas ceden al pulido"), porque el pulido terminó.
- **Las dos puertas** (CANON §3-bis): toda información de negocio se alcanza por DISA **y** por la vía
  visual; ninguna sustituye a la otra, y **las dos respetan los mismos permisos**.
- **Cuándo salir al mercado lo decide el dueño.** El asistente y Code no lo recomiendan ni lo usan como
  argumento; solo ejecutan lo que el dueño prioriza.
- **Fuente única de tareas: `TABLERO.md`.** Notion es solo panel; no dupliques tareas ni toques sus tablas.

## Lo PRIMERO en cada sesión

1. Lee `CANON.md` — qué es Bamburu, qué entra y qué NO (la estrategia).
2. Lee `TABLERO.md` — identifica la tarea que corresponda al encargo vigente; si no hay encargo del dueño, no inicies ninguna.
3. Lee `RITUAL.md` — el flujo de trabajo de la sesión, y síguelo.
4. Lee `session.json` — dónde se quedó la sesión anterior.

No empieces a tocar código sin haber leído CANON y TABLERO.

## Biblia de contexto (docs/contexto/)

Existe una biblia de contexto en `docs/contexto/` (7 documentos). Antes de empezar cualquier
tarea, lee al menos `piezas-cerradas.md` y `errores-conocidos.md`. Respeta las **Reglas de oro**
de `flujo-de-trabajo.md`.

---

## Qué es Bamburu (resumen — el detalle está en CANON.md)

Software de gestión para autónomos de servicios, con una IA proactiva (DISA) como
forma principal de uso. MVP (Capa 1) = facturar + cobrar + gastos + panel + catálogo
de servicios, con cumplimiento legal de España (Verifactu). Diferencial: IA proactiva
(no reactiva) + ejecución impecable.

**La regla de oro del producto:** los motores (facturación, cobros, gastos) deben ser
fiables ANTES de que DISA los accione. Una factura mal hecha por DISA es una multa,
no un bug.

---

## Stack técnico

- **Runtime:** Node.js v22 (`/usr/bin/node`, usuario del sistema `ubuntu`)
- **Framework:** Hono 4 (ESM). Usa `c.req`, `c.get('session')`, `c.html()`, `c.redirect()`
- **Base de datos:** SQLite con better-sqlite3 (SÍNCRONO — no uses await en queries)
- **Arquitectura:** multi-tenant por subdominio. BD central de routing (`data/control.db`)
  + una BD por negocio (`data/tenants/<slug>.db`). Aislamiento a nivel de archivo.
- **Auth:** `admin_users` está en cada BD de tenant, NO en control.db. bcrypt + 2FA TOTP.
- **Emails:** Resend SDK → devuelve `{ data, error }`, NO lanza excepciones (hay que checkear `error`).
- **Secretos:** en `/etc/bamburu.env` (fuera del repo). NUNCA hardcodear claves ni subirlas.
- **Frontend:** HTML/JS inline servido desde rutas (sin SPA, sin framework de front).

## Estructura del proyecto

- `modules/erp/` — panel de administración
- `modules/store/` — tienda pública (CAPA 2, congelada — no trabajar aquí ahora)
- `modules/disa/` — la IA (DISA)
- `modules/registro/` — onboarding/alta de tenants
- `core/` — auth, CSRF, validación, TOTP, Resend
- `data/` — bases de datos SQLite (NO se versionan, están en .gitignore)

## Cómo levantar/reiniciar el servidor

El servicio corre bajo **systemd** como `bamburu.service` (unit en
`/etc/systemd/system/bamburu.service`), ejecutando
`/usr/bin/node /home/ubuntu/bamburu/index.js` (WorkingDirectory `/home/ubuntu/bamburu`, `User=ubuntu`).

- Reiniciar tras un cambio: `sudo systemctl restart bamburu`
- Estado: `systemctl status bamburu --no-pager`
- Logs en vivo: `sudo journalctl -u bamburu -f`
- Últimas 50 líneas: `sudo journalctl -u bamburu -n 50 --no-pager`

NO usar PM2: hay una entrada "bamburu" antigua en `pm2 list` que está en
estado `errored` y no es la instancia productiva — ignorarla.

---

## Convenciones (de CONTEXT_ENGINEERING.md)

- Migraciones: lazy, vía `runMigrations(db)` en tenant-middleware.
- **REGLA PERMANENTE — nunca destruir datos de un tenant.** Cualquier migración que toque
  datos de un tenant **archiva, no borra**: renombra la tabla (p. ej. `tabla` → `tabla_archived`),
  **NUNCA** hace `DROP TABLE` (ni `DROP COLUMN` con datos). Aunque el TABLERO (u otra tarea) diga
  "eliminar", **eliminar = sacarlo del sistema vivo** (desmontar rutas/UI, dejar de leerlo), **no
  destruir los datos**. Si una tarea pide explícitamente borrar datos de verdad, se para y se pregunta.
- Estados de pedido en ESPAÑOL (NO en inglés — fue causa de bugs de analítica). El pedido VIVO es el
  documento del Pilar 4, tabla `customer_orders`: **borrador, confirmado, anulado, entregado** (enum real
  del esquema). Los estados viejos `en_preparacion/enviado/completado/cancelado/reembolsado` eran de la
  tabla `orders`/POS, **archivada en D1**; ya no se usan.
- better-sqlite3 version mismatch se arregla con:
  `sudo bash -c "PYTHON=/usr/bin/python3.11 npm rebuild better-sqlite3"` (ejecutar desde `/home/ubuntu/bamburu`)

---

## Reglas de trabajo (de RITUAL.md)

- 📍 **BARRIDOS, GATES, TESTS Y COMPROBACIONES: MANDA `RITUAL.md`.** Ninguno se ejecuta por iniciativa
  propia —ni el propio de la tarea, ni el corto, ni el completo, ni antes de commit— y un criterio de
  HECHO no concede permiso. Solo se ejecutan si Ibrahin lo pide expresamente o si el encargo lo
  autoriza arriba del todo de forma visible; una autorización vale para una sola ejecución.
  La antigua regla del 24 ago sobre un completo automático nocturno queda como historia en
  `TABLERO.md`, pero **no es una instrucción activa y no autoriza a Codex a lanzarlo ni programarlo**.
- 🛑 **CUÁNDO SE PARA Y SE PREGUNTA — y cuándo NO.** Palabras de Ibrahin (24 ago 2026):
  > «La máquina para y pregunta SOLO cuando la duda cambia lo que el producto le promete al cliente.
  > Si la duda es de cómo construirlo —qué tabla, qué formato, dónde colgar un botón, qué reutilizar—
  > decide, construye, y lo deja escrito en la entrega con su motivo. Traer al dueño una duda de
  > construcción cuesta un día y no mejora el producto.»

  Se para: cuando la respuesta cambia lo que el cliente puede hacer, lo que ve, lo que se le promete,
  lo que se le cobra o lo que la ley le exige. **No se para** por una decisión de construcción: se
  toma, se construye y se explica en la entrega.

- 🚩 **SI UNA NORMA DE IBRAHIN ADMITE DOS LECTURAS, NO ELIJAS UNA: PREGUNTA.** Van dos veces que
  parto una norma suya en dos y me quedo con la mitad conveniente — su «barridos a demanda» acabó
  siendo «corto automático + completo a demanda», y al corregirlo, «gate propio automático +
  regresión a demanda». Las dos veces la mitad inventada era la que me daba permiso para algo.
  **Cuando el texto que escribo crece más que lo que él dijo, lo que sobra es mío**: va marcado como
  propuesta, o se pregunta. Preguntar cuesta diez segundos; una norma inventada se ejecuta sola
  durante semanas.
- UNA tarea del TABLERO en curso a la vez. Terminar antes de empezar otra.
- MOTORES antes que la cara de DISA.
- NADA de Capa 2 (e-commerce: productos, inventario, POS, tienda) ni Capa 3 hasta
  cerrar Capa 1. Si una petición toca eso, avísame y recuérdame que está congelado.
- Si aparece una idea nueva, pásala por "la línea" (CANON sección 4) antes de construir.
- Prohibido justificar omitir, aplazar o simplificar una función por ser el cliente un autónomo o negocio pequeño. El alcance se decide por momento/orden de construcción, nunca por tamaño de cliente. Si la palabra "autónomo" hace algún trabajo en el argumento, el argumento está mal: rehacerlo.
- La métrica de progreso es TAREAS COMPLETADAS, no líneas de código.
- Al terminar la sesión, sigue el paso de cierre del RITUAL (resumen + actualizar Notion).

## Una comprobación pedida una vez se ejecuta UNA vez

> **Una comprobación pedida una vez se ejecuta UNA vez. Si crees que hacen falta más pasadas, paras y
> preguntas. Repetir un barrido para perseguir un rojo intermitente está prohibido: se declara el
> rojo con su motivo y se pregunta. El 22 de agosto, ocho barridos encadenados llenaron el disco al
> 100% y dejaron el motor de citas en 0 bytes.**

## Gates de pantalla — cómo se da una pantalla por sana

> **Una pantalla solo se da por sana mirando el HTML tal y como sale del SERVIDOR. No vale escuchar
> errores de consola (un error de sintaxis no avisa) ni compilar lo que ve el navegador (el navegador
> recorta el trozo roto y lo que queda funciona). Todo gate de pantalla que se apoye en una de esas
> dos vías está mal escrito.**

De dónde sale (22 ago 2026): dos pantallas —facturas y «Registrar recepción»— estuvieron **muertas**
sin que nadie se enterara, y las tres primeras versiones del gate que debía cazarlas **daban verde
con la pantalla rota**. Lo destapó la prueba de reversión, no el razonamiento. El caso de referencia
está en `scripts/gate-pantallas-documento.mjs`.

Dos avisos que van con la norma:
- **Que la respuesta sea 200 no significa que sea la pantalla pedida:** media docena de pantallas que
  cuelgan de un documento **redirigen** cuando el documento no está en el estado que necesitan, y una
  redirección también responde 200. Hay que exigir que la **URL final** sea la que se pidió.
- **Antes de meter una pantalla en un gate, comprobar que su ruta existe** (montaje + handler). Una
  ruta inventada da verde sobre nada.

## Lo que solo ve un navegador

> **Nada se da por bueno llamando al motor por dentro. Si el usuario pulsa un botón, la comprobación
> pulsa ESE botón. Se prueba también cuando el usuario dice que no —cancelar, dejar un campo vacío,
> escribir solo espacios—. Si algo depende de una ventanita del navegador, se prueba además con las
> ventanitas silenciadas. Y se MIRA la captura de la pantalla terminada, no solo el código.**

De dónde sale (23 ago 2026): **dos fallos el mismo día que ninguna aserción vio**.

1. **Un `\n` dentro de una plantilla del servidor.** Escrito en una cadena de JavaScript, la plantilla
   se come el escape y llega al navegador como un salto de línea de verdad → cadena sin cerrar → **la
   página entera muerta**. Había seis. `node --check` daba OK (el fichero del servidor es válido) y
   `lint-plantillas.mjs` tampoco lo caza.
2. **Guardar un informe no funcionaba, y el gate daba 97 ✓ · 0 ✗.** El guardado pedía el nombre con
   `prompt()` y confirmaba con `confirm()`, encadenados. Chrome ofrece la casilla «Impedir que esta
   página cree cuadros de diálogo adicionales» en el **segundo** diálogo seguido; en cuanto se marca,
   `prompt` devuelve null y `confirm` false **sin enseñar nada**. El botón quedaba muerto: ni ventana,
   ni petición, ni aviso. El gate no lo vio porque **comprobaba el guardado llamando a la API con un
   cuerpo JSON escrito por mí**: probaba que el servidor guarda, y se saltaba entero el tramo donde
   estaba la avería. En el mismo gate sí se pulsaba el botón de Borrar, y esa reversión fue la que más
   dijo. Los verdes eran ciertos sobre lo que medían y no cubrían lo que el dueño hace.

Las cuatro reglas, en concreto:

1. **Nada por dentro.** Si hay un botón, se pulsa el botón. Llamar al endpoint mide el motor, no el
   mando — y el mando es donde se rompen las cosas.
2. **También cuando el usuario dice que no.** Cancelar, campo vacío, solo espacios. Los tres eran
   caminos muertos y silenciosos en la misma pantalla, y ninguno estaba probado.
> ## CERO CUADROS DE DIÁLOGO DEL NAVEGADOR EN TODO EL PRODUCTO
>
> **Ni `prompt()`, ni `confirm()`, ni `alert()`. En ninguna pantalla, por ningún motivo.** Se pregunta
> DENTRO de la página con `window.pedirDatos()` y `window.confirmarEnPagina()` (`layout.js`), o con
> `window.saConfirmar()` en el superadmin.
>
> **El motivo, medido:** ante el SEGUNDO diálogo seguido, Chrome ofrece la casilla «Impedir que esta
> página cree cuadros de diálogo adicionales». En cuanto alguien la marca, `prompt()` devuelve `null`
> y `confirm()` devuelve `false` **sin enseñar nada**: el botón se queda muerto —ni ventana, ni
> petición, ni aviso— y el usuario no tiene forma de saber por qué. No es una preferencia de estilo:
> es un botón que deja de funcionar en silencio.
>
> **Lo vigila `node scripts/censo-ventanitas.mjs`**, que sale con código 1 si aparece una y va en el
> barrido. El 24 ago 2026 ese censo decía CERO y había una viva: confundía el `accept="…,*/*"` de una
> pantalla con el principio de un comentario y **se quedaba ciego hasta el final de tres ficheros**.
> Ahora lee el fichero como lo lee JavaScript. De ahí sale la segunda mitad de la regla: **un censo
> que dice cero y no es cierto es peor que no tenerlo, porque cierra la pregunta.**

3. **Con las ventanitas silenciadas.** Si algo depende de `prompt`/`confirm`, se neutralizan
   (`window.prompt = () => null`) y se exige que el producto **siga funcionando**, no que se disculpe.
   ~~*(Quedan 81 ventanitas en otras pantallas del producto…)*~~ ~~**Ya no queda ninguna: el 23 ago
   2026 (noche) se migraron las 80 vivas al panel compartido, y el censo da CERO.**~~
   **⚙️ CORREGIDO EL 24 AGO 2026: QUEDA UNA, y el CERO era del instrumento, no del producto.** La
   migración de esa noche fue real y se sostiene; lo que fallaba era el censo, que se creía dentro de
   un comentario desde la línea 84 de la pantalla de conciliación —donde hay un filtro de ficheros
   `accept="…,*/*"`— y **se quedaba ciego hasta el final de tres ficheros**. Arreglado (ahora lee el
   fichero como lo lee JavaScript) y **la que aparece es real**: el botón «Deshacer» de
   `/admin/conciliacion`. Apuntada en `TABLERO.md` §Deuda técnica y declarada en `ROJOS_CONOCIDOS`.
   **La lección que queda escrita: un censo que dice CERO y no es cierto es peor que no tenerlo,
   porque cierra la pregunta.** La regla se queda
   igual de vigente, porque lo que impide que vuelvan es la comprobación, no la buena intención:
   **`node scripts/censo-ventanitas.mjs` sale con código 1 si aparece una**, y `gate-sin-ventanitas`
   lo mide además PULSANDO. **Un `prompt()` o un `confirm()` nuevo en este producto es un rojo.**
   Lo que se usa en su lugar ya existe y es compartido: `window.pedirDatos()` y
   `window.confirmarEnPagina()` en `layout.js` (y `window.saConfirmar()` en el superadmin).
4. **Se mira la captura.** Se hace una de la pantalla terminada y se mira. El aviso tapado por la
   burbuja de DISA (se leía «Informe guar») y el índice con el nombre pegado a la derecha llevaban
   horas ahí, y **ninguna de 97 aserciones los vio, porque ninguna miraba**. Donde se pueda, se afirma
   sobre píxeles o sobre posiciones (`getBoundingClientRect`), no de oídas.

6. **El JavaScript de una pantalla se comprueba COMO LLEGA AL NAVEGADOR.** `node --check` valida el
   fichero del SERVIDOR, donde ese JS es solo texto dentro de una plantilla: para él no hay ningún
   `await`, hay una cadena. Y un error de sintaxis **mata el bloque entero**, no la función: la
   pantalla se queda muerta y no dice nada.
   **`node scripts/lint-js-servido.mjs`** pide cada pantalla, saca sus `<script>` y los valida uno a
   uno. Es el único sitio donde ese JS es JS.
   De dónde sale (24 ago 2026): al quitar las ventanitas convertí un `confirm()` en
   `await window.confirmarEnPagina(...)` dentro de una función que **no era `async`**, y **la
   pantalla del importador estuvo muerta varias horas**. No lo cazó `node --check`, ni el lint de
   plantillas, ni el barrido de pantallas — porque ese barrido recorría **las 47 entradas del menú**
   y el importador cuelga de `/admin/migracion/importar`, que es una subruta. **Recorrer «todas las
   pantallas» y recorrer «todo el menú» no es lo mismo**, y esa diferencia es por donde se coló.
   **Y volvió a colarse el 24 ago 2026** por el mismo sitio, con la lista de subrutas ya escrita a
   mano: `/admin/settings/plantillas` estaba MUERTA (un regex cuyas barras se comió la plantilla) y la
   herramienta decía «todas válidas». Ahora, además de la lista, **sigue los enlaces `/admin/...` del
   HTML de las pantallas que visita** — un nivel, tirando los href que son cadenas de JS a medio
   construir. Pasó de 66 pantallas a 324 y de 318 bloques a 1426, y en la primera pasada destapó una
   ficha de orden de compra que daba 500 desde junio y un enlace muerto. **Una lista a mano de rutas
   siempre se queda corta: si añades una pantalla, comprueba que el rastreo llega a ella.**

5. **La pantalla se juzga MIRÁNDOLA CON DATOS REALES.** Antes de dar algo por terminado se abre con
   los datos del negocio y se mira el resultado, no solo que no falle. **Un gráfico con sesenta
   etiquetas encimadas no da error, y está mal.** La pregunta no es «¿responde?» sino **«¿esto sirve
   para algo?»**.
   De dónde sale (23 ago 2026, el mismo día): entregué la pantalla de informes con 59 ✓ · 0 ✗ y el
   dueño la abrió y se encontró **ejes con 90 nombres**, la mitad de ellos *«GATE Tardío 1787050812»*
   y *«ZZ Dormido (gate b3708e)»*; un informe de Contabilidad que salía con **cuarenta barras a cero**
   porque no había forma de decir «este año»; y un grupo con fecha del **año 2000**. Ninguna aserción
   falló, porque ninguna preguntaba si aquello se podía leer.

Y la regla que las une: **una comprobación mide lo que mide.** Cuando dé verde, la pregunta no es
«¿ha pasado?» sino **«¿ha pasado por donde pasa el dueño?»** — y después, **«¿y lo que ve le sirve?»**.

## Lo que una prueba crea, la prueba lo borra

> **Una comprobación limpia SIEMPRE lo que ha creado: pase, falle o reviente. Lo que siembre va con
> una marca reconocible y se borra en el `finally`, por esa marca y no por las variables de la pasada.
> Un negocio no puede quedarse con basura de una prueba.**

De dónde sale (23 ago 2026): el dueño abrió sus informes y los ejes estaban llenos de *«GATE Tardío
1787050812»*, *«GATE FH Cliente»* y *«ZZ Dormido (gate b3708e)»*. Al medirlo: **200 de sus 239
clientes eran restos de mis gates — el 84 %**. También 13 productos, 4 almacenes y un recurso.

Y la parte cara, que es la lección de verdad: **no todo se pudo borrar.** 130 de esos 200 clientes
tenían facturas, y **154 de esas facturas ya estaban en la cadena de VERI\*FACTU**. Borrarlos habría
exigido borrar facturas de la cadena legal, que es exactamente lo que no se puede hacer. Hubo que
**archivarlos** (`active=0`) y dejar dicho que sus nombres siguen apareciendo en el área de Ventas,
porque la factura guarda el nombre del cliente por dentro. **La basura que una prueba deja hoy puede
volverse imborrable mañana**: en cuanto se enreda con un documento legal, ya no hay marcha atrás.

En concreto:
- Todo lo que un gate cree lleva **prefijo reconocible** (`GATE …`, `ZZ …`, `… (gate <rid>)`) **y un
  sufijo aleatorio por pasada**, para que no se enganche a lo que dejó la anterior.
- La limpieza va en el **`finally`**, y **por la marca**, no por los ids de esa pasada: si el gate
  muere a mitad, lo suyo se va igual.
- Un gate que **no pueda** borrar lo que creó (porque quedó atado a una factura, a la contabilidad o a
  la cadena) **no debe crearlo en ese negocio**: que se traiga su propio negocio (`EMPIEZAN_DE_CERO`).
- Para el residuo que ya existe: `node scripts/limpiar-restos-de-gates.mjs` (simulacro por defecto).

## Un titular de recuento se corrige con el cuerpo que lo desarrolla

> **Cuando se actualiza una cifra que resume algo —un recuento, un total, un «X de Y hechos»—, en la
> MISMA entrega se revisa el cuerpo que la desarrolla: los desgloses, las listas de «cuáles son» y
> las frases que nombran el estado de una pieza concreta. Cambiar el titular y dejar el detalle es
> dejar escrita una contradicción, y el detalle es justo lo que se lee cuando alguien quiere el
> porqué de la cifra.**

De dónde sale (23 ago 2026): al listar el bloque «CORRECCIONES DEL DUEÑO» aparecieron **cuatro líneas
que llevaban un día contradiciendo a su propio titular**, tres renglones más abajo. El titular decía
«39 hechos · 26 pendientes» y el cuerpo seguía diciendo «27 HECHOS», «C sigue entero y pendiente» y
«quedan 37 pendientes» — y una cuarta, «los pendientes suben de 37 a 38», ya se contradecía con esa
tercera **el día en que se escribió**. Nadie mintió: se cerró C, se subió el titular y no se bajó a
tocar los bullets.

Cómo se aplica, en concreto:
- Al cerrar una tarea, `grep` la cifra vieja en el fichero antes de dar la entrega por terminada.
- Las cifras que se contradicen **se tachan con su motivo y su fecha, no se borran** (el método que ya
  usaba la ficha C): el registro existe para poder reconstruir qué se creía y cuándo.
- **Si dos cifras del mismo documento no cuadran, se dice; no se elige la que conviene.**

## Seguridad (importante)

- NUNCA subir secretos, claves o bases de datos a Git/GitHub.
- NUNCA hardcodear claves en el código; leerlas de `/etc/bamburu.env`.
- En cualquier acción con dinero o valor legal (facturas), DISA propone y el usuario
  confirma. Nunca ejecución silenciosa.
