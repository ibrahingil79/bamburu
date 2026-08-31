# Diagnóstico: límites de `claude -p` — tareas largas, hooks y concurrencia

**Fecha:** 31 ago 2026 · **Servidor:** este mismo · **Versión:** `claude` 2.1.251
**Encargo:** probar en esta máquina tres cosas concretas: tareas largas, hooks de bamburu y concurrencia.
**Método:** todo ejecutado aquí. Cada afirmación lleva su medición. Lo que sale de la documentación
va marcado `[doc]`. Continúa a `docs/diagnostico-claude-code-cli.md`.

---

## Resumen de los tres puntos

| # | Pregunta | Respuesta corta |
|---|---|---|
| 1 | Tareas largas | **No hay timeout.** 500 líneas = 263 s, completó entero. Una de 13 min 32 s también. Nada especial a los 10 min |
| 2 | Hooks de bamburu | **No existen.** bamburu no tiene ni un hook configurado. Pero los hooks **sí se ejecutarían** bajo `-p` si los hubiera — comprobado con un control |
| 3 | Concurrencia | **Funciona.** 2, 3 y 5 en paralelo: 0 fallos, sesiones separadas, paralelismo real |
| + | ¿Se paga aparte? | **No.** Todo va en la suscripción Max; `total_cost_usd` es una estimación local, no un cargo. Lo que se gasta es **cuota** (ventana de 5 h) — **§7** |

Y tres hallazgos que no estaban en el encargo pero que rompen scripts:

- 🔴 `--allowedTools` **se traga el prompt** si lo pones detrás. Exit 1.
- 🔴 Si matas un `claude -p` a media ejecución, el fichero de salida queda **vacío**, no parcial.
- 🟡 El `CLAUDE.md` de bamburu **triplica el consumo** de cada invocación (estimación 0,064 → 0,20).
  Ojo: eso es **cuota de la suscripción, no dinero** — ver §7.

---

# 1. TAREAS LARGAS

## 1.1 La prueba pedida

```bash
claude -p --output-format json "Escribe un script de 500 líneas" > output.json
```

Lanzado desde un directorio neutro (scratchpad), a las 17:44:20.

**Resultado — completó entero, sin truncar:**

| Medida | Valor |
|---|---|
| **Wall clock** | **263,07 s (4 min 23 s)** |
| Exit code | **0** |
| `is_error` | `false` |
| `stop_reason` | `end_turn` ← terminó porque acabó, no por un tope |
| `terminal_reason` | `completed` |
| `num_turns` | 3 |
| Salida | 30 979 caracteres, **759 líneas** |
| `output_tokens` | 27 551 (1 808 de razonamiento) |
| Consumo (`total_cost_usd`) | **0,978** ← ~15x una invocación trivial. **Estimación de cuota, no un cargo** (§7) |
| stderr | 0 bytes |

**No hubo truncado, ni aviso, ni degradación.** Pidió 500 líneas y entregó 759.

## 1.2 ¿Qué pasa a los 10 minutos?

**Nada. No existe ningún timeout de reloj para la ejecución de `claude -p`.**

El "10 minutos" que circula es otra cosa: es el tope de **espera ociosa por subagentes en
background** (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) `[doc]`, no un límite del turno. No aplica a
una tarea normal.

Como la tarea de 500 líneas se quedó en 4 min 23 s, monté una que pasara de los 13 minutos a
propósito, para verlo de verdad y no deducirlo:

**Prueba deliberada de 13 minutos** (dos llamadas Bash encadenadas de ~400 s cada una,
prompt por stdin, `--allowedTools Bash`), lanzada a las 18:05:38:

| Medida | Valor |
|---|---|
| **Wall clock** | **811,73 s = 13 min 32 s** ← cruzó los 10 minutos |
| Exit code | **0** |
| `is_error` | `false` |
| `stop_reason` | `end_turn` |
| `terminal_reason` | **`completed`** |
| Respuesta | `"LARGO_OK"` — hizo exactamente lo pedido |
| `num_turns` | 3 |
| `duration_ms` | 808 256 |
| `duration_api_ms` | **8 807** ← solo 8,8 s de API; el resto fue espera |
| Consumo (`total_cost_usd`) | 0,1597 |
| stderr | vacío |

**A los 10 minutos no pasó absolutamente nada.** Ni aviso, ni corte, ni degradación: el proceso
siguió y terminó limpio a los 13 min 32 s.

Fíjate en la diferencia entre `duration_ms` (808 s) y `duration_api_ms` (8,8 s): **el reloj de pared
no es el consumo**. Una tarea puede estar trece minutos viva y consumir 0,16 si se pasa el rato
esperando; y otra consumir 0,98 en cuatro minutos si está generando texto sin parar (§1.1).
Para dimensionar sirve `total_cost_usd`, no el tiempo.

## 1.3 🔴 La salida NO se escribe hasta el final (y matarlo deja el fichero VACÍO)

Esto es lo más importante de este bloque para cualquier script, y no lo esperaba.

Con `--output-format json` **y también con el formato texto por defecto**, el fichero de salida se
queda a **0 bytes durante toda la ejecución** y se escribe de golpe al terminar. Medido en la tarea
de 500 líneas:

```
 60s  output.json = 0 bytes
120s  output.json = 0 bytes
180s  output.json = 65901 bytes   ← apareció todo de golpe
```

Y con formato texto, una tarea de 200 líneas vigilada cada 5 segundos:

```
  5s  output.txt = 0 bytes
 ...          (40 muestras, todas 0)
200s  output.txt = 0 bytes
```

**Consecuencia grave:** ese proceso lo maté a los 5 minutos (SIGTERM). El fichero quedó en
**0 bytes**. No hay salida parcial que rescatar: **o termina, o no tienes nada.**

Un script con un `timeout` demasiado corto no obtiene "la mitad del trabajo": obtiene un fichero
vacío y ha pagado los tokens igual.

### La única forma de tener salida progresiva: `stream-json`

Comprobado, mismo tipo de tarea, vigilando cada 10 s:

```
 10s  stream.jsonl =      0 bytes    0 líneas
 20s  stream.jsonl =   8 424 bytes    9 líneas
 40s  stream.jsonl =  25 464 bytes   47 líneas
 80s  stream.jsonl =  57 069 bytes  111 líneas
120s  stream.jsonl =  69 159 bytes  163 líneas
fin   stream.jsonl = 379 187 bytes  566 líneas
```

**Sí escribe progresivamente.** Si necesitas ver avance, o poder rescatar trabajo si algo se corta,
la forma es:

```bash
claude -p --output-format stream-json --verbose --include-partial-messages "..." > salida.jsonl
```

La última línea del stream es el mensaje `result` con el texto final y los metadatos `[doc]`.

## 1.4 Lo que sí corta una ejecución: `--max-turns`

A diferencia de los permisos (que fallan en silencio), agotar los turnos **sí falla limpio**:

```console
$ claude -p --output-format json --allowedTools Read --max-turns 1 < prompt.txt
EXIT=1
```
```
subtype: error_max_turns | is_error: true | stop_reason: tool_use
terminal_reason: max_turns | num_turns: 2
```

**Exit 1 y `subtype: error_max_turns`.** Detectable sin ambigüedad. Nota: `--max-turns` **no aparece
en `claude --help`** de la 2.1.251, pero funciona.

---

# 2. HOOKS

## 2.1 Primero, el instrumento: ¿se ejecutan los hooks bajo `-p`?

Antes de mirar bamburu monté un **directorio de control** con hooks de verdad, porque un "cero"
que sale de un instrumento roto es peor que no medir (la lección del censo de ventanitas).

Control: un directorio nuevo con `.claude/settings.json` con dos hooks que escriben en un testigo,
y un `CLAUDE.md` que ordena responder una frase concreta.

```json
{ "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "echo HOOK_SESSIONSTART... >> testigo.log" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "echo HOOK_STOP... >> testigo.log" }] }] } }
```

```console
$ claude -p "test"          # desde ese directorio
CONTEXTO_HOOKTEST_CARGADO   ← el CLAUDE.md se cargó
$ cat testigo.log
HOOK_SESSIONSTART_EJECUTADO
HOOK_STOP_EJECUTADO         ← los DOS hooks se ejecutaron
```

**Conclusión: bajo `-p` los hooks SÍ se ejecutan, y el `CLAUDE.md` SÍ se carga**, en un directorio
en el que nunca se ha confiado y sin ningún diálogo de confianza. El instrumento funciona.

## 2.2 Ahora bamburu: no hay ni un hook

Censo completo de las cuatro fuentes de configuración:

| Fuente | Hooks |
|---|---|
| `/home/ubuntu/bamburu/.claude/settings.local.json` | **ninguno** — solo `permissions` (242 reglas `allow`) |
| `/home/ubuntu/bamburu/.claude/settings.json` | **no existe el fichero** |
| `/home/ubuntu/.claude/settings.json` | **ninguno** — `effortLevel`, `tui`, `theme`… |
| `/home/ubuntu/.claude/settings.local.json` | **ninguno** — solo `permissions` |
| `/etc/claude-code/managed-settings.json` | **no existe** |
| `/home/ubuntu/bamburu/.mcp.json` | **no existe** |

**En bamburu no hay ningún hook configurado. No se ejecuta nada y no interfieren con `-p`.**

### La trampa del nombre: `stop-hook.sh` NO es un hook

En `.claude/commands/` hay dos ficheros que parecen hooks y no lo son:

```
.claude/commands/plan-sprint.sh
.claude/commands/stop-hook.sh     ← se llama "hook" pero está en commands/
```

`commands/` es el directorio de **comandos de barra**, no de hooks. Un hook se registra en la clave
`hooks` de un `settings.json`, y `stop-hook.sh` **no está referenciado en ninguna parte** (el único
sitio que lo nombra es `.claude/SPRINT1_SUMMARY.md`, que es documentación).

**Y por si alguien lo cablea alguna vez: está roto.** Su segunda línea es

```bash
cd /home/bamburu/bamburu || exit 1
```

y `/home/bamburu` **no existe** en esta máquina (es `/home/ubuntu/bamburu`). Saldría con código 1
antes de llegar al `npm test`. Además ejecuta `npm test` y llama a `dev.bamburu.com`, así que si se
llegara a activar dispararía la suite de tests en cada parada — justo lo que `RITUAL.md` prohíbe.

## 2.3 Desde otro directorio: lo que cambia es el CONTEXTO y el COSTE

Misma pregunta, dos directorios:

```console
$ cd /home/ubuntu/bamburu && claude -p "¿tienes cargado un CLAUDE.md? cita su cabecera"
Sí, tengo cargado `/home/ubuntu/bamburu/CLAUDE.md`, y su primera cabecera es
textualmente: «# CLAUDE.md — Contexto técnico acumulado de Bamburu».

$ cd /tmp/.../scratchpad && claude -p "¿tienes cargado un CLAUDE.md? cita su cabecera"
No, no tengo cargado ningún CLAUDE.md de proyecto en este contexto.
```

Y el efecto en el consumo de cuota, con el **mismo prompt trivial**:

| cwd | `total_cost_usd` (estimación) | `cache_creation` |
|---|---|---|
| `/home/ubuntu` (neutro) | **0,064** | ~5 700 tokens |
| `/home/ubuntu/bamburu` | **0,201** | ~19 500 tokens |

**Ejecutar desde bamburu multiplica por ~3,1 el consumo de cada llamada**, aunque el prompt sea
"di OK", porque arrastra los 23 KB de `CLAUDE.md`. En un cron que se dispare a menudo, eso es
lo que más cuota se come.

Otro efecto verificado: al lanzarlo desde bamburu, la respuesta obedece las reglas del proyecto
—contestó *«No inicio ninguna tarea sin encargo tuyo»*—, cosa que desde un directorio neutro no pasa.

## 2.4 Lo que sí bloqueó algo (y no era un hook)

Durante las pruebas, un `sleep 240` fue rechazado con:

```
Blocked: standalone sleep 240. To wait for a condition, use Monitor with an
until-loop. [...] Do not chain shorter sleeps to work around this block.
```

**Esto NO es un hook de bamburu ni de nadie: es una guarda interna del propio Claude Code** contra
esperas largas en primer plano. Comprobado: con `--settings` vacío y `--setting-sources ""`
(sin cargar ninguna configuración), un `sleep 5` se ejecuta sin problema y un `sleep` largo no.

Lo anoto porque al verlo por primera vez parecía contradecir el censo de hooks, y no lo hacía.

---

# 3. CONCURRENCIA

## 3.1 Método

Un script Node lanza N `spawn('claude', ['-p','--output-format','json', ...])` a la vez con
`Promise.all`, cada uno pidiendo un número distinto, y compara: exit codes, `session_id`, y la suma
de tiempos individuales contra el wall clock (para distinguir paralelismo real de serialización).

## 3.2 Resultados

| N | cwd | wall | fallos | `session_id` únicos | ¿paralelo real? | consumo total |
|---|---|---|---|---|---|---|
| 2 | `/home/ubuntu` | 4 879 ms | **0 / 2** | **2 de 2** | **Sí** (Σ 9 753 ms) | 0,1288 $ |
| 3 | `/home/ubuntu` | 5 243 ms | **0 / 3** | **3 de 3** | **Sí** (Σ 13 395 ms) | 0,1617 $ |
| 5 | `/home/ubuntu` | 5 983 ms | **0 / 5** | **5 de 5** | **Sí** (Σ 29 027 ms) | 0,3220 $ |
| 5 | `/home/ubuntu/bamburu` | 6 370 ms | **0 / 5** | **5 de 5** | **Sí** (Σ 30 329 ms) | **0,9998 $** |

**Respondiendo literalmente a lo preguntado:**

- **¿Fallan?** No. **0 fallos de 15 invocaciones** en total. Todas exit 0, `is_error: false`,
  `stop_reason: end_turn`, `api_error_status: null`. Ningún `rate_limit`.
- **¿Se bloquean?** No. Con N=5, el wall fue de 6,0 s mientras la suma de tiempos individuales era
  de 29,0 s: **corren de verdad en paralelo**, no se serializan. Pasar de 1 a 5 procesos costó
  +1 segundo de wall (5,0 s → 6,0 s).
- **¿Comparten sesión?** **No.** Cada proceso obtuvo su propio `session_id` — 5 de 5 distintos.
  Cada invocación es una sesión independiente, con su historial aparte. No hay estado compartido
  ni interferencia entre ellas.

## 3.3 El límite real de la concurrencia es la CUOTA, no el CLI ni el dinero

> **⚙️ CORREGIDO EL 31 AGO 2026.** Este apartado decía «el límite es el dinero» y «cinco
> invocaciones costaron 1,00 $». **No hay dinero de por medio**: esta cuenta va con suscripción
> Max y las llamadas del CLI están incluidas (§7). Lo que consumen es cuota.

**Cinco invocaciones triviales desde bamburu consumieron ~1,00 de estimación**, que es ~15 veces
una invocación neutra. El CLI aguanta la concurrencia sin despeinarse; lo que se agota es la
**ventana de 5 horas**, compartida con tu sesión interactiva y con Claude chat `[doc]`.

Y no es teórico: **las pruebas de este documento dejaron la ventana de sesión al 62 %**, y el
propio `/usage` señala que *«26 % of your usage was while 4+ sessions ran in parallel»* — es decir,
el test de concurrencia de §3.2. Un fan-out grande no te llega una factura: **te deja sin sesión
interactiva** hasta que la ventana se reinicie.

**No hay un tope documentado de procesos en paralelo** y no llegué a tocar ningún límite con N=5,
así que **no sé dónde está el techo**: para un fan-out grande hay que medirlo antes.

---

# 4. Hallazgos fuera del encargo que rompen scripts

## 4.1 🔴 `--allowedTools` se traga el prompt

Los flags variádicos (`<tools...>`) consumen **todos** los argumentos que les siguen, incluido el
prompt posicional. Esto falló de verdad durante las pruebas:

```console
$ claude -p --output-format json --allowedTools Bash "Ejecuta sleep 240..."
Error: Input must be provided either through stdin or as a prompt argument when using --print
        (exit 1)
```

El prompt se interpretó como un nombre de herramienta más. Afecta a todos los flags variádicos:
`--allowedTools`, `--disallowedTools`, `--tools`, `--mcp-config`, `--plugin-dir`, `--file`, `--betas`.

**Las tres soluciones, las tres comprobadas:**

```bash
claude -p "di OK" --allowedTools Bash        # a) prompt ANTES del flag      → OK
claude -p --allowedTools Bash -- "di OK"     # b) separador --               → OK
echo "di OK" | claude -p --allowedTools Bash # c) prompt por stdin (la mejor) → OK
```

Al menos falla ruidosamente (exit 1), a diferencia de los permisos.

## 4.2 🟡 Los avisos de stderr son intermitentes

En el diagnóstico anterior anoté ~12 avisos de `Permission allow rule` por invocación. **Midiéndolo
en serie el número varía**: una invocación dio 0 y tres seguidas dieron 1 (siempre la misma regla).
No es estable, así que **no sirve ni para contar ni para detectar fallos**. Siguen sin ser errores.

---

# 5. Recomendaciones para automatizar esto en bamburu

1. **Lanza desde un directorio neutro, no desde `~/bamburu`**, salvo que necesites el contexto del
   proyecto. Ahorra ~2/3 del consumo de cuota por llamada.
2. **Pasa el prompt por stdin.** Evita el problema de §4.1 y el escapado del shell.
3. **Usa `stream-json` si la tarea es larga.** Es la única forma de tener avance y de no perderlo
   todo si hay que cortar (§1.3).
4. **Pon un `timeout` generoso, no ajustado.** No hay timeout propio, y quedarse corto no da
   trabajo parcial: da un fichero vacío y la cuota gastada igual.
5. **Comprueba tres cosas, no una**: exit code, `is_error` **y** `permission_denials.length`.
   Añade `subtype === 'error_max_turns'` si usas `--max-turns`.
6. **Dimensiona por cuota, no por dinero** (§7). Estimación: ~0,064 por llamada trivial neutra,
   ~0,20 desde bamburu, ~1 una tarea de 500 líneas. Antes de programar un cron, mira `/usage` y
   calcula cuánta ventana de 5 horas te va a comer. `--max-budget-usd` sirve de freno de
   emergencia, pero mide contra esa misma estimación local.
7. **Si algún día se cablea un hook en bamburu, se ejecutará también en modo `-p`** (§2.1). Y antes
   de cablear `stop-hook.sh`, arreglar su `cd /home/bamburu/bamburu` y decidir si de verdad se
   quiere `npm test` en cada parada — `RITUAL.md` dice que no.

---

# 6. Qué NO he verificado

- **El techo de la concurrencia.** Probé hasta 5 sin un fallo. No sé a partir de cuántos procesos
  aparece un `rate_limit`, y no lo he forzado.
- **Concurrencia con tareas largas.** Los 15 casos en paralelo eran triviales (5-6 s). Cinco tareas
  de 4 minutos a la vez es otro escenario y no está medido.
- **Hooks de bamburu en ejecución real:** no existen, así que no hay nada que medir. Lo que está
  comprobado es el mecanismo (§2.1) y el censo (§2.2).

---

# 7. ¿Se paga aparte por `claude -p`? NO — va en la suscripción

**Verificado el 31 ago 2026 en esta máquina.** Esta sección corrige el marco con el que se
escribieron §1, §3 y el diagnóstico anterior: **las cifras `total_cost_usd` no son cargos.**

## 7.1 Lo que dice la máquina

`claude auth status`:

```json
{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
  "subscriptionType": "max", "email": "ibrahingil@gmail.com" }
```

Y `/usage` (funciona en modo `-p`, comprobado) responde con la frase literal:

> **«You are currently using your subscription to power your Claude Code usage»**

Estado en el momento de medir, **después** de todas las pruebas de este documento:

```
Current session:            62% used · resets Aug 31, 9:50pm (UTC)
Current week (all models):  10% used · resets Sep 3, 6pm (UTC)
Current week (Fable):        0% used

Last 24h · 508 requests · 71 sessions
  74% of your usage was at >150k context
  26% of your usage was while 4+ sessions ran in parallel
```

**No aparece ninguna fila de créditos de uso**, lo que según la documentación significa que los
créditos de uso están **apagados** `[doc]`. Sin créditos de uso no hay gasto por encima del plan:
al llegar al límite **se bloquea, no se cobra**.

## 7.2 No existe ninguna vía de facturación aparte en este servidor

Comprobado uno por uno:

| Vía de cobro | Estado |
|---|---|
| `ANTHROPIC_API_KEY` | **no definida** |
| `apiKeyHelper` en algún `settings.json` | **ninguno** (el único match era una regla de permiso que nombra la variable dentro de un `sed`) |
| Bedrock / Vertex / Foundry | **ninguna variable de entorno** |
| Créditos de uso | **apagados** (sin fila en `/usage`) |
| `apiProvider` | `firstParty` con `authMethod: claude.ai` |

**Conclusión: todas las llamadas de `claude -p` de este servidor van contra la suscripción Max.
No hay cargo aparte y no puede haberlo mientras no se active una clave de API o los créditos de uso.**

## 7.3 Entonces, ¿qué es `total_cost_usd`?

Una **estimación local**, calculada por el CLI a partir del recuento de tokens **a precio de tarifa
API**. La documentación es explícita `[doc]`:

> *«The Session block in `/usage` shows API token usage and is intended for API users. Claude Max
> and Pro subscribers have usage included in their subscription, so the session cost figure isn't
> relevant for billing purposes.»*

> *«Claude Code computes the dollar figure locally from token counts at list price […] The figure
> is an estimate.»*

**Sirve como medidor relativo de consumo, no como factura.** Todas las proporciones medidas en este
documento siguen siendo válidas y útiles para dimensionar: desde bamburu se consume ~3x, una tarea
de 500 líneas ~15x. Lo que hay que dejar de leer como dólares es la unidad.

## 7.4 Lo que SÍ es un riesgo real

No es el dinero. Es que **un cron se coma tu ventana de 5 horas**, que es compartida con tu sesión
interactiva de Claude Code y con Claude chat `[doc]`.

Las pruebas de este documento —una tarea de 500 líneas, otra de 13 minutos, 15 invocaciones
concurrentes y un puñado de sueltas— dejaron la **sesión al 62 %** y la semana al 10 %. Es decir:
**una tarde de pruebas de diagnóstico consumió casi dos tercios de una ventana.** Un cron que
dispare `claude -p` desde `~/bamburu` cada pocos minutos puede dejarte sin poder trabajar.

Antes de programar cualquier automatización:

1. Mira `/usage` para saber de dónde partes.
2. Calcula el consumo por disparo (§2.3: ~3x más si corre desde `~/bamburu`).
3. Multiplica por la frecuencia y comprueba que cabe en la ventana de 5 horas **dejando sitio para
   tu trabajo interactivo**.

## 7.5 Lo que NO he verificado de esto

- **No he visto tu factura ni tu panel de `claude.ai/settings/usage`.** No tengo acceso al
  navegador autenticado; todo lo de arriba sale del CLI y de la documentación. Si quieres
  confirmarlo con la fuente de facturación, el sitio es
  **[claude.ai/settings/usage](https://claude.ai/settings/usage)** → sección *Usage credits*.
- **Qué devuelve exactamente `claude -p` al agotar la cuota** (código de salida y texto): no lo he
  provocado. La documentación nombra los mensajes *«You've hit your session limit»* y *«You've hit
  your weekly limit»* `[doc]`, pero no documenta el código de salida en modo `-p`. **Si vas a montar
  un cron, ese caso conviene provocarlo y medirlo**, porque es el fallo que te vas a encontrar.
