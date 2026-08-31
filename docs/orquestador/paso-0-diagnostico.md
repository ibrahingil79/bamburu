# Paso 0 — Diagnóstico en solo lectura

**Fecha:** 31 ago 2026 · **Alcance:** solo el orquestador. No se ha tocado ningún fichero de producto.

---

## 1. Qué hay hoy en `orchestrator/` y qué se hace con ello

7 ficheros, 1 622 líneas, sin versionar (`?? orchestrator/`). Revisado uno a uno.

| Fichero | Qué hace | Decisión | Motivo |
|---|---|---|---|
| `reader.js` | Lee `TABLERO.md` y el estado de git. Parser de encabezados, campos, criterios; helpers de git (`commitsDesde`, `lineasAnadidas`, `resolver`) | **SE REUTILIZA CASI ENTERO** | Es la pieza más sólida. El parser de markdown y los helpers de git están bien hechos y probados contra el tablero real. Se le añade solo la lectura del nuevo formato de tarea |
| `validator.js` | Valida análisis, commits y veredicto | **SE REUTILIZA Y SE AMPLÍA** | La lógica de commits y el veredicto están bien. Le falta lo que ahora es obligatorio: **validar que el análisis trae criterios de aceptación**, y que el revisor se pronuncia sobre cada uno |
| `token-monitor.js` | Sonda de saldo | **SE RETIRA LA SONDA, SE CONSERVA LA TAXONOMÍA** | Ver §2. Su sonda es **binaria** y **gasta cuota para preguntar si queda cuota**. Se sustituye por lectura de `/usage`. Su clasificación de estados (`ok`/`sin-saldo`/`desconocido`/`configuracion`) es buena y se conserva |
| `dispatcher.js` | Registro + invocación de `claude -p` + los tres prompts | **SE PARTE EN TRES** | Ver §3. Hace tres cosas a la vez, y el encargo prohíbe eso explícitamente |
| `updater.js` | Escribe análisis vacío, marca HECHA, escribe feedback | **SE REUTILIZA LA LÓGICA, SE CAMBIA EL CIERRE** | Su prudencia con el tablero en prosa es correcta y se mantiene. Le falta todo el cierre nuevo: registro de tarea, commit y subida |
| `daemon.js` | Bucle, pausa, reanudación, aparcado | **SE REESCRIBE SOBRE MÁQUINA DE ESTADOS** | Ver §4. Su estado vive **en memoria** (`Map` de intentos y atascadas): un reinicio lo pierde entero. Eso incumple el criterio de "un corte no deja nada a medias" |
| `index.js` | Punto de entrada y recorrido de 9 pasos | **SE REESCRIBE** | El recorrido es correcto pero es **lineal y sin estado**: si muere en el paso 6, al volver empieza por el 1 y repite el análisis. No hay reanudación posible |

### Lo que se retira, con motivo escrito

1. **La sonda de saldo de `token-monitor.js`** (`sondaCli`). Lanza `claude -p ok` para averiguar si hay saldo: **gasta cuota para preguntar por la cuota**, y solo devuelve sí/no. No puede responder «me queda un 12 %, no me da para un ciclo entero», que es justo lo que el encargo pide. Se sustituye por `/usage`, que da los porcentajes de las dos ventanas. Se conserva `pareceSinSaldo()` como **red de seguridad secundaria** para clasificar la salida de una llamada que muere.

2. **La invocación con salida de texto** de `despacharConClaude`. Usa la salida por defecto, así que **no puede leer `permission_denials`** — el fallo silencioso con exit 0 que está medido en `docs/diagnostico-claude-cli-limitaciones.md`. Se sustituye por `--output-format json` con comprobación explícita de los tres campos.

3. **El modo `manual`** (pausas con `readline` esperando ENTER). El encargo pide un daemon que corra solo bajo systemd; una pausa interactiva ahí es un cuelgue garantizado. Se retira del camino del daemon. *(Se conserva como modo de depuración explícito, no como valor por defecto.)*

4. **El estado en memoria del daemon.** `Map` de intentos y de tareas atascadas: se pierde en cada reinicio, y systemd reinicia. Va a disco.

---

## 2. El tablero: hoy NO se puede escribir de forma fiable

Medido sobre el fichero real:

```
TABLERO.md   8 111 líneas   681 615 bytes
```

| Comprobación | Resultado |
|---|---|
| ¿Hay un encabezado `## SIGUIENTE TAREA`? | **No** |
| ¿Hay línea de prosa `SIGUIENTE TAREA OFICIAL:`? | **Sí, en la línea 9 — y otra en la 190** |
| Qué detecta el `reader` hoy | `id: aislamiento-de-bloqueos-sqlite` · `origen: **prosa**` · `criterios: **0**` |

**Se puede LEER. No se puede ESCRIBIR.** Tres motivos, y los tres son bloqueantes:

1. **La tarea vive dentro de una cita en prosa** (`> SIGUIENTE TAREA OFICIAL: ...`), no en un bloque con principio y fin. Reescribir prosa a ciegas en un fichero de 681 KB es exactamente lo que `updater.marcarHecha` se niega a hacer, y hace bien.
2. **Hay dos líneas que casan** (9 y 190). Cualquier reescritura automática tiene que elegir, y elegir mal corrompe el documento.
3. **No hay criterios de aceptación.** Sin ellos el revisor no puede juzgar nada, y el encargo exige rechazar un análisis que no los traiga.

### Formato mínimo que necesita el orquestador

**La conversión del tablero NO entra en este encargo** (así lo dice el encargo). Queda definido aquí para cuando se decida hacerla. Es deliberadamente pequeño:

```markdown
## SIGUIENTE TAREA — Aislar los bloqueos de SQLite

- **id:** aislar-bloqueos-sqlite
- **estado:** pendiente

Descripción en prosa, un párrafo. Qué se quiere y por qué.

**Criterios de aceptación**

- [ ] Primer criterio, comprobable
- [ ] Segundo criterio, comprobable
```

Requisitos, y solo estos:

| Requisito | Por qué |
|---|---|
| Un **encabezado markdown** (`##`) que empiece por `SIGUIENTE TAREA` | Da principio y fin al bloque: se puede reescribir sin tocar nada más |
| Campo **`id`** explícito | El id derivado del título cambia si alguien retoca el título, y entonces se pierde el rastro de los commits |
| Campo **`estado`** | `pendiente` / `en-curso` / `hecha` / `apartada`. Sin esto no hay forma de saber qué queda |
| Bloque **`Criterios de aceptación`** con casillas | Es lo que el revisor juzga uno a uno |
| **Un solo** encabezado `SIGUIENTE TAREA` en todo el fichero | Si hay dos, el orquestador se planta y avisa en vez de elegir |

**Mientras el tablero siga como está**, el orquestador lo lee y trabaja, pero **al cerrar no lo reescribe**: deja el texto en un fichero aparte para pegarlo a mano, y lo dice en el parte. Es el comportamiento actual de `updater.js` y se conserva a propósito.

---

## 3. Qué patrones se toman de los sistemas serios, y cuáles se descartan

Revisados Temporal, Airflow, GitHub Actions y Sidekiq. Para cada pregunta del encargo, qué se aplica y qué no.

### 3.1 Cómo se guarda el estado para que un corte no deje nada corrupto

**Se aplica — escritura atómica por `rename()` (de todos ellos).**
Se escribe a un temporal en el mismo sistema de ficheros, `fsync`, y `rename()` encima del bueno. `rename()` es atómico en POSIX: o está el fichero viejo entero o el nuevo entero, nunca medio. Un corte de luz a mitad de escritura deja el estado anterior intacto.

**Se aplica — journal append-only (Temporal: event sourcing).**
Cada transición se **añade** a `journal.ndjson` antes de tocar el snapshot. Añadir al final es la operación más difícil de corromper que hay. El snapshot es una comodidad para leer rápido; **la verdad es el journal**, y se puede reconstruir el estado entero desde él.

**Se descarta — event sourcing puro con reproducción determinista (Temporal).**
Temporal reproduce el workflow entero desde los eventos, y para eso exige que el código sea determinista. **Aquí es imposible: los pasos son llamadas a un modelo de lenguaje, que no da la misma salida dos veces.** Reproducir no sirve. Lo que se hace en su lugar es **guardar el resultado de cada paso como artefacto en disco** y, al reanudar, reutilizarlo en vez de recalcularlo.

**Se descarta — base de datos para el estado (Airflow usa PostgreSQL).**
Un daemon de una sola tarea a la vez, en una máquina, no necesita un motor de base de datos. Ficheros con escritura atómica dan la misma garantía sin una dependencia nueva. Se revisará si algún día hay varios trabajadores.

### 3.2 Cómo se reintenta sin repetir trabajo ni duplicar efectos

**Se aplica — clave de idempotencia por paso (Sidekiq, Stripe).**
Cada paso tiene una clave determinista: `<taskId>/<intento>/<paso>`. Antes de ejecutar, se mira si ya hay artefacto válido para esa clave. Si lo hay, **se salta el paso**. Reanudar tras un corte no vuelve a pagar el análisis que ya estaba escrito.

**Se aplica — separar "el trabajo falló" de "no había combustible" (Sidekiq: `Sidekiq::Limiter`).**
Un rechazo de la revisión y una cuota agotada son cosas distintas y se tratan distinto: el rechazo **cuenta como intento**, la cuota agotada **no**. Ya está bien resuelto en el `daemon.js` actual (código de salida 3) y se conserva la idea.

**Se aplica — cola de muertos (Sidekiq: Dead Set).**
Tras replanteamiento fallido, la tarea se **aparta** con su historial. No se reintenta y no bloquea: el sistema sigue con la siguiente.

**Se descarta — reintento con retroceso exponencial y jitter para los fallos de modelo.**
El retroceso exponencial sirve cuando el fallo es de saturación y esperar ayuda. Aquí, si el revisor rechaza, esperar más **no cambia nada**: lo que cambia el resultado es **pasarle el motivo del rechazo**. Así que el reintento es inmediato y con información nueva, no con espera. El retroceso sí se usa para lo único donde tiene sentido: **la subida a GitHub** y la **espera de cuota**.

**Se descarta — reintento a nivel de paso para el paso del programador.**
Reintentar al programador sin cambiarle nada produce el mismo commit dos veces. Un fallo suyo sube al ciclo, que le da el motivo y vuelve a bajar.

### 3.3 Cómo se separa decidir / ejecutar / guardar

**Se aplica — planificador puro, ejecutor con efectos, almacén aparte (Airflow: scheduler/executor; Temporal: workflow/activity).**
Tres piezas que no se mezclan:

| Pieza | Qué hace | Efectos |
|---|---|---|
| **`nucleo/maquina.js`** | Dada una situación, dice **qué toca ahora**. Función pura | **Ninguno.** No lee ficheros, no llama a nadie, no mira el reloj |
| **`ejecucion/*`** | Hace lo que le digan: llama al CLI, escribe artefactos, commitea | Todos |
| **`nucleo/almacen.js`** | Guarda y recupera el estado | Solo disco |

El motivo de que la máquina sea pura es que **es lo único que se puede probar exhaustivamente**: se le pasa una situación inventada y se comprueba la decisión, sin CLI, sin red y sin reloj. Todas las pruebas de "tres rechazos disparan replanteamiento" son pruebas de esa función, y corren en milisegundos.

**Se descarta — DAG declarativo (Airflow).**
El ciclo es una secuencia fija de siete pasos con un bucle de reintento. Un motor de grafos aquí sería andamiaje sin obra. Si algún día hay ramas de verdad, se revisa.

**Se descarta — separar planificador y trabajador en procesos distintos (Airflow, Temporal).**
Existe para escalar a muchos trabajadores. El encargo dice **una tarea a la vez, nada en paralelo**. Meter esa separación sería complejidad pagada sin nada a cambio.

### 3.4 Cómo se recupera una ejecución interrumpida sabiendo en qué paso iba

**Se aplica — estado explícito por paso con marca de comienzo (GitHub Actions: pasos con su estado).**
El estado guarda `paso` y `pasoDesde`. Al arrancar, si encuentra un paso `EN_CURSO`, sabe exactamente dónde murió.

**Se aplica — clasificar cada paso por si se puede repetir (Temporal: idempotencia de actividades).**
No todos los pasos se recuperan igual, y tratarlos igual es lo que corrompe las cosas:

| Paso | Al reanudar |
|---|---|
| Arquitecto | **Se repite** si no hay análisis válido; **se salta** si lo hay. El artefacto manda |
| Programador | **NUNCA se repite a ciegas.** Se mira git: si ya hay commits que citan la tarea, el paso está hecho. Repetirlo duplicaría trabajo |
| Revisor | **Se repite** si no hay veredicto legible. Es una lectura, no tiene efectos |
| Cierre | **Se repite entero.** Es idempotente por construcción: marcar HECHA lo que ya está HECHA no cambia nada |

**Se descarta — heartbeats de actividad (Temporal).**
Sirven para detectar un trabajador colgado en un clúster. Aquí el timeout por llamada ya cubre el caso, y systemd cubre el proceso entero.

---

## 4. Decisiones de construcción que se derivan de todo lo anterior

1. **El estado va a disco en cada transición**, con journal y snapshot atómico.
2. **La máquina de estados es una función pura** y es donde se concentran las pruebas.
3. **La cuota se lee con `/usage`**, no sondeando. Dos umbrales configurables: mínimo para empezar un ciclo, y margen reservado para el chat de Ibrahin.
4. **Toda llamada al CLI usa `--output-format json`** y comprueba `is_error`, código de salida **y** `permission_denials`.
5. **Los tres papeles viven en `orchestrator/roles/*.md`**, versionados, y se cargan en tiempo de ejecución.
6. **Nada de números mágicos**: todo umbral, ruta y plazo sale de `orquestador.config.json`.
7. **La prueba de laboratorio corre sobre un repo de usar y tirar**, no sobre bamburu: el encargo prohíbe tocar ficheros de producto, y además ejecutar desde `~/bamburu` consume ~3x.
