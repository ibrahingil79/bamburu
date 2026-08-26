# RITUAL DE TRABAJO — Bamburu

> Cómo trabajan en cada sesión el chat/orquestador y Codex como programador/ejecutor, sin horario fijo.
> La consistencia no viene del reloj — viene de repetir el mismo ritual cada vez.

---


## LA REGRESIÓN: LOS BARRIDOS SON A DEMANDA. NINGUNO AUTOMÁTICO.

> ### 📍 LA NORMA — ESTE ES EL ÚNICO SITIO DONDE ESTÁ ESCRITA ENTERA
>
> **NINGÚN BARRIDO Y NINGÚN GATE SE EJECUTA SOLO. NI EL DE LA TAREA, NI EL CORTO, NI EL COMPLETO,**
> **NI ANTES DE UN COMMIT. Se ejecutan cuando Ibrahin lo pide. Si un encargo necesita ejecutarlos,**
> **lo dice ARRIBA DEL TODO y visible, y con eso queda pedido.**
>
> Los demás sitios (CLAUDE.md, `barrido-estado.mjs`, `run-gates.mjs`) **apuntan aquí**: no la
> reescriben con sus palabras. Una norma contada dos veces son dos normas en cuanto una se retoca.

**ESTO SE HA CORREGIDO DOS VECES EL MISMO DÍA, Y LAS DOS POR EL MISMO MOTIVO.** Ibrahin dijo
«barridos a demanda». **(1)** Lo escribí como dos normas —un corto **automático** antes de cada commit
y un completo a demanda—; esa primera parte nadie la acordó. **(2)** Al corregirlo dejé otra
excepción: «el gate propio de la tarea sí se corre». **Tampoco la acordó nadie.** Es el mismo fallo
otra vez: partir una norma suya en dos y quedarme con la mitad conveniente.

**Ya no hay excepciones.** Ni el gate de la tarea. Si un encargo necesita ejecutar comprobaciones, se
dice arriba del todo del encargo y visible — y **con eso queda pedido**, sin volver a preguntar.

### 1. LOS DOS MODOS SIGUEN EXISTIENDO — lo que se retira es el automatismo

```
node scripts/run-gates.mjs --tocado       # el corto: solo los gates de lo que se ha tocado
node scripts/run-gates.mjs --all          # el completo: los 75
node scripts/run-gates.mjs --lista        # enseña QUÉ correría, sin correr nada (con cualquier modo)
```

Los dos funcionan igual que siempre y se invocan **a mano, cuando Ibrahin lo pide**. Lo que
desaparece es el disparo por iniciativa de Codex: **no hay barrido «no negociable»**, ni antes del
commit ni en ningún otro sitio.

El **corto** sale de `git diff` y de tres fuentes que se SUMAN, nunca se restan: la tabla `AFECTA`
(`scripts/lib/gates-mapa.mjs`), el **grafo de imports** —todo gate que importe un fichero cambiado,
automático y sin mantenimiento— y los gates que se hayan cambiado. **Un fichero que no cubra ninguna
regla NO se adivina:** el corto se convierte en barrido entero y dice qué fichero lo obligó. Medido:
tocar la vista del Inicio → 8 gates, **2 min 50 s**. Una ruta de compras → 22 gates. Un motor troncal
(`margen.js`, `models.js`, cualquier cosa de `core/`) → **corre todo**, que es lo correcto.

El **completo** dura **unos 7 minutos** (eran 11 min 30 s). El corto **no** sustituye al completo, y
**el veredicto que se apunta en el TABLERO y en Notion es el completo**: si no se ha corrido, se dice
que no se ha corrido — nunca se presenta el corto como si lo fuera.

### 2. AL CERRAR UNA ENTREGA SE PROPONE. NUNCA SE LANZA SOLO.

Codex **propone** el barrido diciendo tres cosas:

1. **qué se ha tocado** (ficheros y áreas),
2. **qué modo recomienda** (`--tocado` o `--all`) y por qué,
3. **desde cuándo no se corre**, con la fecha del último barrido, cuántos días y cuántos commits.

```
node scripts/barrido-estado.mjs                          # prepara el parte: qué falta y desde cuándo
node scripts/barrido-estado.mjs --registrar-pendiente    # Ibrahin ha dicho que no
```

Y entonces **espera**. Solo se lanza con un **sí explícito**: un «vale, cierra» no es un sí; un
silencio, tampoco. **Si no hay sí, no se corre** y queda registrado como **pendiente** en
`TABLERO.md`; **al abrir la siguiente sesión se vuelve a proponer diciendo desde cuándo no se corre**.

**Ese bloque de `TABLERO.md` no se edita a mano**: lo escribe el script, y **correr el barrido
completo lo registra solo** — si dependiera de acordarse, en dos semanas estaría mintiendo.

### 3. UN ENCARGO NO PUEDE EXIGIR UN BARRIDO EN SUS CRITERIOS DE VERIFICACIÓN

Un criterio de verificación **no puede pedir «barrido en verde»**, ni «regresión completa», ni nada
que obligue a correr gates para poder dar la tarea por cerrada: eso es exactamente el automatismo que
esta norma retira, colado por la puerta de atrás.

**Si una tarea necesita de verdad ejecutar gates**, se dice **ARRIBA DEL TODO y visible en el
encargo** —no enterrado en el criterio 12— para que **Ibrahin lo apruebe al leerlo**. Aprobar el
encargo es entonces aprobar el barrido; sin esa línea arriba, no hay barrido.

**Tampoco el gate de la propia tarea.** Cada tarea sigue definiendo su comprobación —eso no cambia—,
pero **escribirla no autoriza a ejecutarla**: se ejecuta cuando el encargo lo pide arriba, como todo
lo demás. Aquí estuvo escrita la excepción contraria («el gate propio de la tarea sí se corre») y se
retira: **era una excepción que Ibrahin no acordó.**

### 3. Por qué el completo va a la velocidad que va, y no más

Los gates corren varios a la vez, con topes que NO son caprichos:
- **2 con navegador a la vez**, por dos motivos y los dos medidos:
  - `index.js` frena a **600 peticiones/min por IP** y todos los gates salen de 127.0.0.1. Con 4 a la
    vez se frenaron 7 peticiones en un minuto y eso tumbó SEIS gates (un 429 en una carga de página
    deja la pantalla sin su script). Ese freno **no se toca**: es un control de seguridad. Se mide
    con `security_events` (`type = 'ratelimit:global'`): un barrido sano no añade ni uno.
  - con **3**, una pasada de cada cuatro moría con `TargetCloseError: Target.createTarget` —
    Chromium sin poder abrir pestaña con tres navegadores peleando por cuatro núcleos. El gate suelto
    pasa 6/0: no era suyo. **Un rojo que sale una vez de cada cuatro es peor que uno fijo**, porque
    enseña a desconfiar del barrido.
- **2 a la vez sobre el negocio de desarrollo**, que es de todos. Los que **empiezan de cero** (se
  traen su propio negocio con `provisionTenant`) están declarados uno a uno en `EMPIEZAN_DE_CERO` y
  no se miran entre ellos; la declaración **se comprueba contra el código en cada pasada**.
- **Los que miden un TOTAL del negocio corren SOLOS** — seis, declarados en `SOLOS` con su motivo
  escrito: los avisos, los permisos de avisos, el neto-cero de facturar horas y de rentabilidad, el
  badge de propuestas de DISA y el stock del producto vivo en devoluciones.

**LA REGLA DURA, y no se negocia:** ningún gate se elimina, ninguno se ablanda, ningún rojo se
silencia. Si al paralelizar sale un rojo que en serie no salía, **es un rojo real de concurrencia**:
se declara con su motivo en `SOLOS` (o se baja un tope) y el gate se queda **exactamente como está**.
Ajustar el gate para que deje de quejarse sería cambiar el termómetro para no tener fiebre.

Ajustes: `--jobs=N` (global) · `--jobs-navegador=N` · `--jobs-compartido=N` · `--serie` (uno detrás
de otro, como antes: sirve para comparar dos barridos cuando algo huele a concurrencia).

---

## PASO 0 DEL CIERRE — DESPLEGAR (obligatorio, antes de decir "hecho")

**Una tarea NO está hecha cuando el commit está empujado. Está hecha cuando se ve en la dirección
pública.** El 18 ago 2026 hubo tres commits empujados, los gates en verde y `peluqueria-gil.bamburu.com`
enseñando la agenda de antes: Node carga los módulos **al arrancar**, así que un fichero editado y no
reiniciado no existe para nadie.

```
node scripts/desplegar.mjs
```

Reinicia el servicio si el proceso es más viejo que el código, y **verifica contra la dirección pública
de verdad** (HTTPS, por Caddy, con sesión) que la pantalla trae el código nuevo. Si sale rojo, la tarea
no está hecha — da igual lo verdes que estén los gates.

Dos redes de seguridad más, para que esto no dependa de acordarse:
- `scripts/lib/gate-env.mjs` **aborta cualquier gate de navegador** (código 2, "no ha verificado NADA")
  si el proceso lleva levantado desde antes del último cambio en `modules/`, `core/` o `index.js`.
- `gate-agenda-visual` termina pidiendo la pantalla **a la dirección pública** y comprobando que sirve
  el código nuevo.

## Actualización — FASE DE OPTIMIZACIÓN (v2)

> Este bloque manda sobre lo que siga abajo cuando haya contradicción; el resto se conserva como
> referencia del ritual de cierre.

- Estamos en la **fase de saneamiento técnico** (CANON §4), derivada de la auditoría integral. No se
  añaden funciones nuevas hasta cerrarla y se trabaja una tarea cada vez. **Saneamientos 1 y 2 están
  cerrados; no hay una tarea posterior iniciada y el siguiente saneamiento requiere encargo oficial.** La escalera conserva el orden funcional, pero
  queda aplazada; Peldaño 9 — Belleza/estética no es la siguiente tarea.
- La **fase de optimización** (ejes UX · DISA · Seguridad) quedó **✅ CERRADA**, los tres completos. Sus
  reglas rectoras siguen vigentes (CANON §4-bis); lo que caducó es "las funciones nuevas ceden al
  pulido", porque el pulido terminó.
- **Cuándo salir al mercado lo decide el dueño.** El asistente y Code no lo recomiendan ni lo usan
  como argumento; solo ejecutan lo que el dueño prioriza.
- **Al empezar** cada sesión, lee la biblia: `CANON.md`, `TABLERO.md`, `RITUAL.md`, `CLAUDE.md` y
  `docs/contexto/`. **Fuente única de tareas: `TABLERO.md`** (empezando por el Eje A — UX). Notion es
  solo panel (KPIs, tiempo, "dónde sigo"); no dupliques tareas ni toques sus tablas.
- **Aditivo, sin DROP.** No toques huella/Verifactu, stock, permisos base ni la lógica de
  facturas/cobros/ledger salvo autorización expresa de la tarea, y siempre por su flujo con
  confirmación (nunca escritura silenciosa).
- **Simplicidad y cambios quirúrgicos.** Código/edición mínima; no "mejores" lo adyacente.
- **Verificación siempre:** cada tarea define su test/gate propio. **Ejecutarlo —ese o cualquier
  otro— se rige por LA NORMA**, que está escrita entera en la sección «La regresión» de este mismo
  fichero y **no se resume aquí**.
- **Legal/regulatorio:** verificado contra fuente oficial en la web, nunca de memoria.
- **Al terminar:** `commit` + `push` con mensaje claro y actualiza el bloque **"DÓNDE LO DEJÉ / DÓNDE
  SIGO"** de Notion. **Un tema por chat**: al cerrar, avisa para abrir chat nuevo.

---

## Al EMPEZAR cada sesión
1. Anotar la hora de inicio en `session.json` (campo "sesion_inicio").
2. Leer `CANON.md` (qué es Bamburu y qué NO) y `TABLERO.md` (qué toca).
3. Leer `session.json` para saber dónde se quedó la sesión anterior.
4. Identificar la tarea pendiente (`⬜`) que corresponda al encargo vigente. El TABLERO no tiene columnas y no se mueve ninguna tarea a "HACIENDO". Si no hay encargo del dueño, no se inicia ninguna tarea.
5. Releer su criterio de "HECHO CUANDO" y confirmarlo antes de tocar código.
6. **Mirar si el barrido está pendiente** y, si lo está, PROPONERLO diciendo desde cuándo no se
   corre: `node scripts/barrido-estado.mjs`. Se propone; **no se lanza sin un sí de Ibrahin**.

## DURANTE la sesión
6. Trabajar SOLO esa tarea. Nunca dos tareas activas a la vez.
7. Si aparece una idea nueva, pasarla por "la línea" (CANON sección 4):
   ¿ayuda al autónomo de servicios a gestionar su negocio? Si no → no se toca ahora.
   Si es buena pero no es de ahora → anotarla, no construirla.

## Al TERMINAR — rutina de cierre (siempre, en este orden)

Esta rutina se ejecuta SIEMPRE al final de la sesión. Es la única forma de que
Notion quede al día sin que el fundador toque nada. Cuatro pasos, a/b/c/d:

**a) Actualizar `TABLERO.md`**
- **El TABLERO NO tiene columnas.** No busques `🟢 HECHO` / `🟡 HACIENDO` / `🔵 POR HACER`:
  esos tres marcadores no existen en el fichero. Se organiza **por ejes** (A: UX · B: DISA ·
  C: Seguridad), y cada tarea lleva su estado **en su propia ficha**: `⬜` pendiente → `✅`
  hecha, con **fecha + commit** en la misma línea.
- Al cerrar: cambiar el `⬜` de esa tarea por `✅`, añadirle fecha y hash, y dejar en la ficha
  qué se hizo, qué se decidió y con qué test se verificó.
- Si la sesión terminó a medias, la ficha lo dice en su propio texto (no hay sitio "HACIENDO").
- **Los rótulos de sección y los punteros también son estado, y caducan.** Si esta tarea era la
  última de un eje, el rótulo del eje pasa a `✅ COMPLETO`, y el `⬅️` de "aquí es donde vamos"
  se mueve al eje que toca. Un puntero rancio manda al siguiente chat al sitio equivocado con
  toda la confianza del mundo.

**b) Actualizar `CANON.md` si se cerró una pieza**
- **CANON v2 NO tiene tabla de estado.** Son 7 secciones de estrategia (identidad, fase,
  reglas, quién decide, mapa de capas) y el estado de las piezas vive en `TABLERO.md`, que
  es la fuente única. No busques filas `❌ Falta` → `✅ Funciona`: se fueron al reescribir el
  CANON para la fase de optimización. **La mayoría de las sesiones NO tocan CANON.**
- Solo se toca si la sesión cambia la ESTRATEGIA: una decisión de producto, un hueco o una
  dependencia no prevista (§4 fase y ejes, §6 quién decide). Cerrar una tarea no es eso.
- Si no hay nada estratégico que anotar, este paso se salta y se dice: "b) CANON sin cambios".

**c) Actualizar Notion** — página "Control de Proyecto — Bamburu"
(ID `36e18b04-bb1f-812f-99ee-f96789ac2909`, token en `/etc/bamburu.env`
como `NOTION_TOKEN`).

> Los nombres de abajo son los EXACTOS de la página. Cópialos, no los reconstruyas de
> memoria: si el bloque que buscas no aparece tal cual, **es que cambió la página — para y
> mira, no lo inventes**. Esta regla nace de que durante semanas se mandó actualizar un KPI
> ("Tareas de Capa 1 completadas") que no existía: el ritual se cumplía sobre un fantasma y
> el indicador real se quedó seis días diciendo que el Pilar 3 estaba en curso cuando ya
> estaba cerrado. Un panel que miente es peor que no tener panel.

  1. **`🚦 DÓNDE LO DEJÉ / DÓNDE SIGO`** (arriba del todo, NO confundir con `📍 Dónde estoy`,
     que es un histórico más abajo y no se toca). Es una lista de citas, la más nueva primera:
     AÑADIR arriba una `> ✅ HECHO (D mes AAAA) — <código> — <resumen>. Commit <hash>.`, y que
     termine en `· SIGUIENTE TAREA: <la siguiente tarea pendiente según el orden vigente del TABLERO, o A LA ESPERA DE ENCARGO si no hay una tarea construible asignada>`.
  2. **KPIs** (sección `📊 KPIs`) — solo si la sesión mueve alguno. Los que existen:
     - **`Fase del producto`** → qué pilar está cerrado y cuál en curso. Se mueve al cerrar
       un pilar (Catálogo · Cliente · Inventario · Ventas). Espejo de él: la sección
       `🧭 Los 4 pilares` — si cambia uno, cambia el otro, o se contradicen.
     - **`Cumplimiento España (Verifactu)`** → al avanzar el envío a la AEAT o Facturae.
     - **`Código respaldado en GitHub`** · **`Clientes de pago`** · **`Ingreso recurrente
       mensual`** → hoy fijos; se mueven al lanzar, no al programar.
     - **Si la tarea no mueve ninguno, NO se inventa un KPI.** En la fase actual
       (optimización por ejes A/B/C, CANON §4) lo normal es que **ninguno se mueva**: un eje
       no es un pilar. Esa sesión solo hace los bloques 1 y 3 — y eso es correcto, no un
       descuido.
  3. **`⏱️ Registro de tiempo`** → AÑADIR una línea nueva **al FINAL** (es cronológico, el
     último es el más reciente) con `D mes AAAA · ~Xh · resumen de 1 línea`. No editar las
     previas ni reordenarlas.

**d) Commit + push** (SSH, sin tokens)
- **NO se corre ningún barrido para poder commitear.** Ni el corto ni el completo: el commit no
  depende de un barrido, y nadie lo lanza por su cuenta.
- **Al cerrar la sesión: PROPONER el barrido**, diciendo **qué se ha tocado**, **qué modo se
  recomienda** (`--tocado` o `--all`) y **desde cuándo no se corre** (`node scripts/barrido-estado.mjs`
  lo prepara). **Solo se lanza con un sí de Ibrahin.** Si es que no:
  `node scripts/barrido-estado.mjs --registrar-pendiente`, y se vuelve a proponer al abrir la
  siguiente sesión.
- `git add` los archivos de docs y código modificados.
- Mensaje claro: qué se cerró, qué commits incluye.
- `git push origin master`.

---

### Reglas que protegen el panel
- **El detalle de tareas vive SOLO en `TABLERO.md`.** En Notion va el panel
  ejecutivo (KPIs + registro de tiempo + "dónde sigo"). No duplicar la tabla
  de tareas en Notion.
- **Código + nombre, siempre.** En cualquier referencia a una tarea dentro
  de Notion (`🚦 DÓNDE LO DEJÉ / DÓNDE SIGO`, "SIGUIENTE TAREA", KPIs, entradas
  del `⏱️ Registro de tiempo`) escribir SIEMPRE el código y el nombre real:
  `A3 — Catálogo mixto de servicios`, no `A3` a secas. Esto permite que un
  chat sin contexto lea Notion y entienda qué es cada tarea sin inventar.
- **No se mide en líneas de código.** La métrica de progreso es tareas
  completadas y tiempo invertido.
- **Idempotencia.** Si la rutina se ejecuta dos veces seguidas, no debe
  duplicar nada: los KPIs se sobreescriben con el mismo valor; a
  `🚦 DÓNDE LO DEJÉ / DÓNDE SIGO` y al `⏱️ Registro de tiempo` solo se añade
  entrada cuando hay trabajo nuevo que reportar — los dos son listas que
  CRECEN, así que repetir la rutina sin trabajo nuevo duplicaría. Antes de
  añadir, comprueba si la entrada de esa tarea ya está.

---

## Reglas que protegen el proyecto
- UNA tarea activa a la vez. Terminar antes de empezar otra.
- MOTORES antes que la CARA de DISA: el núcleo debe ser fiable antes de que DISA lo accione.
- Nada de Capa 2 o 3 hasta cerrar Capa 1. Si tienta, releer CANON sección 5.
- Se puede parar a mitad de una tarea: el ritual guarda el hilo para retomarlo.
- La métrica de progreso es TAREAS COMPLETADAS, no líneas de código (engañan).

## Recordatorio para el fundador
- Una hora con la cabeza fresca vale por tres agotado. El descanso es parte de avanzar.
- Esto es una maratón de meses. Gana quien no se cae, no quien corre más rápido al principio.
