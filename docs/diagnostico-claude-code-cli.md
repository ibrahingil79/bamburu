# Diagnóstico: ¿se puede disparar Claude Code desde un script?

**Fecha:** 31 ago 2026 · **Servidor:** este mismo (`ubuntu@`, Linux 6.17, Node v22.23.0)
**Método:** todo lo que sigue está **ejecutado y comprobado en esta máquina**, no deducido.
Lo que sale de la documentación oficial va marcado como `[doc]`; lo demás lleva su prueba real.

---

## Veredicto en una línea

**Sí, existe el CLI y sí se puede disparar no-interactivo desde Node.** El comando es
`claude -p`. Funciona, consume cuota de tu suscripción (no dinero aparte), y tiene **una trampa
grave**: si le falta un permiso,
**no falla — devuelve exit 0 y no hace el trabajo**. Eso está detallado en §5 y §6.

---

## 0. Entorno verificado

| Cosa | Valor comprobado |
|---|---|
| Binario | `/home/ubuntu/.local/bin/claude` |
| Versión | `2.1.251 (Claude Code)` |
| Instalado con | `curl -fsSL https://claude.ai/install.sh \| bash` (línea 25 del `.bash_history`) |
| Autenticación | `claude.ai`, suscripción **max**, cuenta `ibrahingil@gmail.com` |
| Credenciales | `/home/ubuntu/.claude/.credentials.json` (600) |
| `ANTHROPIC_API_KEY` | **NO definida** ← importante, ver §6.2 |
| Node | v22.23.0 |

Comprobación de auth (`claude auth status`):

```json
{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
  "subscriptionType": "max", "email": "ibrahingil@gmail.com" }
```

**Cómo se usa hoy en este servidor:** siempre **a mano y en interactivo**, desde
`~/bamburu`, casi siempre con `claude --dangerously-skip-permissions` (unas 15 veces en el
historial). **No hay ni un solo script que invoque a Claude Code**: el `grep` sobre
`bamburu/scripts/` y `package.json` no devuelve nada. Lo de este documento sería el primer uso
automatizado.

---

## 1. ¿Claude Code tiene un CLI? ¿Cuál es el comando exacto?

**Sí.** El comando es:

```bash
claude
```

Ruta absoluta (la que hay que usar en cron/systemd, donde el `PATH` es otro):

```
/home/ubuntu/.local/bin/claude
```

Por defecto abre sesión interactiva. Para **no abrir sesión** hay que añadir `-p` (`--print`):
*"Print response and exit (useful for pipes)"* — texto literal del `--help`.

**Prueba real:**

```console
$ claude -p "Responde solo con la palabra PONG"
PONG
        (exit 0, 5,1 s)
```

---

## 2. ¿Se puede disparar no-interactivo desde un script Node? (sin abrir sesión)

**Sí.** Comprobado con `child_process.spawn`. No abre TUI, no pide nada, termina solo.

Script ejecutado de verdad:

```js
import { spawn } from 'node:child_process';

const p = spawn('claude', ['-p', '--output-format', 'json'], {
  cwd: '/home/ubuntu',
  stdio: ['pipe', 'pipe', 'pipe'],
});
let out = '';
p.stdout.on('data', d => out += d);
p.stdin.write('Responde solo con la palabra NODE_OK');
p.stdin.end();
p.on('close', code => {
  const j = JSON.parse(out);
  console.log(code, j.result, j.total_cost_usd);
});
```

**Salida real:**

```
exit code: 0 | ms: 5026
result: "NODE_OK"
is_error: false | cost_usd: 0.0645685 | num_turns: 1
session_id: 29839844-641c-4e5d-8bcb-a125b23e7ec7
```

### Y funciona también con el entorno pelado de un cron

Ésta era la duda real, porque las credenciales podrían depender de variables de sesión.
**No dependen: basta con `HOME`.** Probado con `env -i` (entorno completamente vacío):

```console
$ env -i HOME=/home/ubuntu PATH=/home/ubuntu/.local/bin:/usr/bin:/bin \
    /home/ubuntu/.local/bin/claude -p "Responde solo CRON_OK"
CRON_OK
        (exit 0)
```

**Conclusión: sirve para cron, systemd timer o un `spawn` desde el servidor Node.**
Requisito único: `HOME=/home/ubuntu`, para que encuentre `.credentials.json`.

---

## 3. ¿Cómo se pasa un prompt al CLI?

Hay **dos vías**, y la diferencia entre ellas importa (el tamaño máximo cambia 80 veces):

### a) Como argumento

```bash
claude -p "tu prompt aquí"
```

### b) Por stdin (tubería o redirección) ← la recomendada

```bash
cat build-error.txt | claude -p 'explica la causa raíz de este error'
claude -p < prompt.txt
```

### c) Las dos a la vez — el patrón más útil

Los datos por la tubería, la instrucción como argumento:

```bash
git diff main | claude -p "eres un corrector de erratas. Reporta fichero:línea de cada errata."
```

**Cuál usar:** **stdin siempre que el contenido sea variable o largo.** Ver §5 para el porqué
numérico. Como argumento, además, hay que pelear con el escapado del shell; por stdin no.

---

## 4. ¿Cómo se captura el output en un archivo?

Redirección normal de Unix. **El stdout sale limpio** — esto lo comprobé expresamente porque
en esta máquina el CLI escupe avisos sobre reglas de permisos de
`.claude/settings.local.json`, y hacía falta saber por dónde salen:

```console
$ claude -p "Di solo OK" 2>/dev/null
OK                          ← stdout: SOLO la respuesta

$ claude -p "Di solo OK" 2>&1 >/dev/null | head -1
Permission allow rule (.claude/settings.local.json): Bash(cp data/tenants/...
                            ← stderr: los avisos, el ruido
```

**Los avisos van a stderr. El stdout es limpio.** Por tanto:

```bash
# texto plano a fichero, ruido descartado
claude -p "resume el proyecto" > salida.txt 2>/dev/null

# texto plano, guardando el ruido aparte (mejor: así se puede diagnosticar)
claude -p "resume el proyecto" > salida.txt 2> salida.err

# JSON con metadatos
claude -p --output-format json "resume el proyecto" > salida.json 2>/dev/null

# extraer solo el texto con jq
claude -p --output-format json "resume" 2>/dev/null | jq -r '.result'
```

### Formatos disponibles (`--output-format`)

| Formato | Qué da |
|---|---|
| `text` (por defecto) | la respuesta en crudo |
| `json` | un objeto con la respuesta **y los metadatos** |
| `stream-json` | NDJSON en tiempo real (necesita `--verbose`) |

**Campos reales que devuelve `json`** (verificado, no copiado de la doc):

```
duration_api_ms, stop_reason, session_id, total_cost_usd, usage, modelUsage,
permission_denials, terminal_reason, is_error, num_turns, subtype,
api_error_status, result, ttft_ms, type, duration_ms, uuid, queued_turn_count
```

Los cuatro que hay que mirar sí o sí en un script: **`result`** (la respuesta),
**`is_error`**, **`permission_denials`** (§6.1) y **`total_cost_usd`**.

### Salida con esquema fijo

Si se quiere un JSON con forma garantizada en vez de prosa, existe `--json-schema` `[doc]`;
el resultado aparece en el campo `structured_output`:

```bash
claude -p "Extrae los nombres de función de auth.js" --output-format json \
  --json-schema '{"type":"object","properties":{"funcs":{"type":"array","items":{"type":"string"}}},"required":["funcs"]}'
```

---

## 5. Limitaciones

### 5.1 Tamaño del prompt — medido en esta máquina

| Vía | Tope | Prueba |
|---|---|---|
| **Argumento** | **~128 KB** | 200 000 bytes → `Argument list too long`. 120 000 bytes → funciona |
| **stdin (tubería)** | **10 MB** | 1 MB → `STDIN_1MB_OK` en 21 s. 12 MB → `Error: piped stdin input exceeds 10MB.` (exit 1) |

El tope del argumento es del kernel Linux (`MAX_ARG_STRLEN`, 128 KB por argumento suelto),
no de Claude — el `ARG_MAX` global de esta máquina es 2 MB, pero **un solo argumento no puede
pasar de 128 KB**. El de 10 MB sí es de Claude Code, con mensaje propio y salida no-cero.

> **Regla práctica: pasa el contenido por stdin, o mejor aún, dale la RUTA del fichero en el
> prompt y deja que lo lea él.** Es lo que recomienda el propio mensaje de error.

### 5.2 Timeouts

**No hay ningún timeout de reloj para la ejecución en sí.** No existe flag `--timeout` en
`-p` (`claude --help | grep -i timeout` → **0 resultados**). Una tarea larga puede correr
indefinidamente.

**Consecuencia: el timeout lo tienes que poner tú.** En bash con `timeout`, en Node con
`AbortSignal` o matando el proceso.

Los únicos plazos que sí existen:

| Plazo | Valor | Ámbito |
|---|---|---|
| `MCP_TIMEOUT` | 30 s | arranque de servidores MCP `[doc]` |
| Espera de subagentes en background | 10 min | ajustable con `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` `[doc]` |
| Tareas Bash en background al terminar | ~5 s de gracia y se matan | `[doc]` |
| Drenado del stream al salir | máx. 30 s | solo `stream-json` `[doc]` |
| `ultrareview` | 30 min | otro comando distinto `[doc]` |

### 5.3 Códigos de salida

| Código | Significado |
|---|---|
| `0` | La ejecución terminó — **ojo: NO significa que hiciera el trabajo**, ver §6.1 |
| distinto de 0 | Fallo del arranque: flag inválido, stdin >10 MB, sin login |
| `143` | Lo mataron con SIGTERM `[doc]`; la tarea en curso queda a medias y sin resultado |

Un fallo *dentro* de la ejecución (p. ej. autenticación) **se imprime como resultado en
stdout**, no como error del shell `[doc]`.

### 5.4 Consumo — NO es dinero, es cuota de la suscripción

> **⚙️ CORREGIDO EL 31 AGO 2026.** La primera versión de esta sección decía «cada llamada cuesta»
> y «un bucle de 100 llamadas son ~6 $». **Eso era falso para esta cuenta.** El campo
> `total_cost_usd` que devuelve el CLI es **una estimación local calculada a precio de tarifa
> API**, no un cargo. Este servidor se autentica con una **suscripción Max**, y la documentación
> lo dice con todas las letras `[doc]`:
>
> > *«Claude Max and Pro subscribers have usage included in their subscription, so the session
> > cost figure isn't relevant for billing purposes.»*
>
> Comprobado además en la propia máquina con `/usage`:
> *«You are currently using your subscription to power your Claude Code usage.»*
> **No hay cargo aparte por invocar `claude -p`.**

**Lo que sí se gasta es cuota**, y la cuota tiene dos ventanas `[doc]`:

| Ventana | Qué es |
|---|---|
| **Sesión** | ventana móvil de **5 horas** |
| **Semanal** | ventana de 7 días, todos los modelos |

Ambas son **compartidas con Claude chat y Cowork**: lo que gaste un cron se lo quita a tu sesión
interactiva.

**Para qué sirve entonces `total_cost_usd`:** como **medidor relativo de consumo**, que es
exactamente lo que hace falta para dimensionar un script. Las cifras medidas siguen siendo
válidas en proporción:

| Invocación | `total_cost_usd` (estimación) | Lectura correcta |
|---|---|---|
| "responde PONG", cwd neutro | 0,064 | línea base |
| "di OK" desde `~/bamburu` | 0,201 | **~3x** la base, solo por cargar `CLAUDE.md` |
| script de 500 líneas | 0,978 | **~15x** la base |

Una invocación trivial no es gratis: el consumo se lo lleva el contexto de entrada (5 693 tokens
de creación de caché + 12 933 de lectura, para 8 tokens de salida).

**`--max-budget-usd <n>`** sigue siendo útil como freno de emergencia `[doc]`, pero mide contra esa
misma estimación local, no contra una factura.

### 5.5 Contexto que arrastra sin pedirlo

Sin `--bare`, `claude -p` **carga lo mismo que una sesión interactiva** `[doc]`: `CLAUDE.md`,
hooks, skills, plugins, MCP, memoria automática. Aquí eso significa que **cada llamada
lanzada desde `~/bamburu` se traga los 337 líneas de `CLAUDE.md`** más `.claude/settings.local.json`.

Y un aviso de seguridad de la propia documentación: sin `--bare`, una sesión `-p`
**ejecuta los hooks de `.claude/settings.json` del proyecto y conecta los servidores de su
`.mcp.json` aunque sea una carpeta en la que nunca has confiado**, sin diálogo de confianza
ni aprobación por servidor.

### 5.6 Turnos

`--max-turns <n>` limita los turnos agénticos (solo en modo `-p`) y **sale con error al llegar
al límite** `[doc]`. Curiosidad verificada: **no aparece en `claude --help` de la 2.1.251, pero
funciona** (`claude -p --max-turns 1 "di OK"` → `OK`).

---

## 6. Las tres trampas — esto es lo que de verdad hay que saber

### 6.1 🔴 Sin permisos, DENIEGA EN SILENCIO Y DEVUELVE EXIT 0

La más grave, y la que rompería cualquier script escrito de forma ingenua.

En modo `-p`, el modo de permisos de partida es **Manual en todos los planes** `[doc]`.
Sin TTY nadie puede aprobar nada, así que **la herramienta se rechaza y la ejecución sigue
como si tal cosa**.

**Prueba real** — pedí crear un fichero, sin flags de permiso:

```console
$ claude -p --output-format json "Crea prueba.txt con el texto HOLA"
exit: 0
is_error: false
permission_denials: [{"tool_name":"Write", ... "file_path":".../prueba.txt"}]
$ ls
        (vacío — el fichero NO existe)
```

**Exit 0. `is_error: false`. Y el trabajo sin hacer.** Un script que solo mire `$?` da por
bueno un trabajo que no ocurrió.

**Las dos formas de arreglarlo, las dos comprobadas:**

```bash
# a) lista blanca de herramientas — la recomendada, es la de menor privilegio
claude -p --allowedTools Write "Crea prueba.txt con HOLA"
#    → denials: 0, fichero creado ✅

# b) barra libre — solo para tareas de confianza
claude -p --permission-mode bypassPermissions "Crea prueba.txt con HOLA"
#    → denials: 0, fichero creado ✅
```

`--allowedTools` admite sintaxis de reglas con prefijo: `--allowedTools "Bash(git diff *),Read,Edit"`.
**El espacio antes del `*` importa**: `Bash(git diff*)` también casaría con `git diff-index` `[doc]`.

> **Regla para cualquier script que se escriba aquí: comprobar SIEMPRE
> `permission_denials.length === 0`, además del exit code.** El exit code por sí solo miente.

### 6.2 🔴 `--bare` NO funciona en este servidor

La documentación recomienda `--bare` para scripts y CI (*"is the recommended mode for scripted
and SDK calls"*), porque arranca más rápido y no carga hooks ni `CLAUDE.md`. **Aquí no sirve**,
y conviene saberlo antes de escribirlo en un cron:

```console
$ env -u ANTHROPIC_API_KEY claude --bare -p "di OK"
Not logged in · Please run /login
        (exit 1)
```

**El motivo:** en modo `--bare` Claude Code **nunca lee las credenciales OAuth ni el llavero**
`[doc]`. Exige `ANTHROPIC_API_KEY`. Este servidor se autentica con la **suscripción Max** y
**no tiene esa variable**.

Es decir: **o suscripción sin `--bare`, o `--bare` con una clave de API de pago aparte.** Las
dos cosas no van juntas. Para lo que se necesita aquí, lo correcto es **no usar `--bare`**.

### 6.3 🟡 El stderr viene lleno de ruido que no es un error

Este servidor arrastra reglas mal escritas en `bamburu/.claude/settings.local.json` (comodines
colocados antes del final del comando) y el CLI avisa de ellas en stderr. **No impiden nada.**

**⚙️ CORREGIDO EL 31 AGO 2026:** en la primera pasada conté ~12 avisos y escribí que salían "en cada
invocación". **Al medirlo en serie, el número NO es estable:** una invocación dio 0 avisos y tres
seguidas dieron 1 (siempre la misma regla). Así que el ruido está, pero **ni el conteo ni su
presencia sirven para detectar nada**. Detalle en `docs/diagnostico-claude-cli-limitaciones.md` §4.2.

Un script que trate "stderr no vacío" como fallo dará **falsos rojos**. O se ignora stderr, o se
filtra (`grep -v "Permission allow rule"`), o se arreglan esas reglas.

---

## 7. Receta lista para copiar

### Bash

```bash
#!/usr/bin/env bash
set -euo pipefail

SALIDA=/tmp/claude-salida.json

# timeout PROPIO (el CLI no trae ninguno); permisos explícitos; JSON para poder verificar
timeout 600 /home/ubuntu/.local/bin/claude \
  -p --output-format json \
  --allowedTools "Read,Grep" \
  --max-turns 10 \
  "Analiza X y responde Y" \
  > "$SALIDA" 2>/dev/null

# NO basta con $? — hay que mirar los rechazos de permiso
node -e '
  const j = require(process.argv[1]);
  if (j.is_error) { console.error("ERROR:", j.result); process.exit(1); }
  if (j.permission_denials.length) {
    console.error("PERMISOS DENEGADOS:", j.permission_denials.map(d => d.tool_name).join(", "));
    process.exit(1);
  }
  console.log(j.result);
' "$SALIDA"
```

### Node

```js
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

export function lanzarClaude(prompt, {
  cwd = '/home/ubuntu/bamburu',
  herramientas = [],          // p.ej. ['Read', 'Grep']
  timeoutMs = 600_000,        // OBLIGATORIO: el CLI no trae timeout propio
} = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json'];
    if (herramientas.length) args.push('--allowedTools', herramientas.join(','));

    const p = spawn('/home/ubuntu/.local/bin/claude', args, {
      cwd,
      env: { HOME: '/home/ubuntu', PATH: process.env.PATH },  // HOME es lo único imprescindible
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);   // ruido esperable, ver §6.3

    const reloj = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('timeout')); }, timeoutMs);

    p.on('close', code => {
      clearTimeout(reloj);
      if (code !== 0) return reject(new Error(`claude salió con ${code}: ${out || err}`));
      let j;
      try { j = JSON.parse(out); } catch { return reject(new Error('salida no es JSON: ' + out.slice(0, 300))); }
      if (j.is_error) return reject(new Error('claude falló: ' + j.result));
      // LA COMPROBACIÓN QUE NO SE PUEDE OLVIDAR (§6.1)
      if (j.permission_denials?.length) {
        return reject(new Error('permisos denegados: ' + j.permission_denials.map(d => d.tool_name).join(', ')));
      }
      resolve({ texto: j.result, coste: j.total_cost_usd, sesion: j.session_id });
    });

    p.stdin.end(prompt);   // por stdin: hasta 10 MB, y sin problemas de escapado
  });
}
```

### Encadenar varias llamadas

```bash
# guardar el id de sesión y continuar la misma conversación
sid=$(claude -p --output-format json "Empieza una revisión" 2>/dev/null | jq -r '.session_id')
claude -p --resume "$sid" "Ahora céntrate en las consultas SQL"
```

---

## 8. La alternativa: el Agent SDK

Si en vez de invocar un binario se prefiere una librería, existe y está publicada:

```
@anthropic-ai/claude-agent-sdk  →  versión 0.3.251   (comprobado con npm view)
```

*"SDK for building AI agents with Claude Code's capabilities."* Trae salidas estructuradas,
callbacks de aprobación de herramientas y objetos de mensaje nativos, en TypeScript y Python.
**No está instalado en `bamburu`** (`node_modules/@anthropic-ai/` no existe).

**Recomendación:** para lo que hace falta aquí —disparar una tarea y recoger su salida— el
`spawn` de `claude -p` sobra y evita meter una dependencia nueva en el proyecto. El SDK solo
compensa si se necesitan callbacks de permisos en caliente o control fino del bucle del agente.

---

## 9. Resumen ejecutable

| Pregunta | Respuesta |
|---|---|
| ¿Hay CLI? | **Sí**: `claude` → `/home/ubuntu/.local/bin/claude`, v2.1.251 |
| ¿No-interactivo desde Node? | **Sí**: `spawn('claude', ['-p', ...])`. Funciona incluso con entorno vacío + `HOME` |
| ¿Cómo se pasa el prompt? | Argumento (≤128 KB) o **stdin (≤10 MB, preferible)**; o los dos a la vez |
| ¿Cómo se captura? | `> fichero`. stdout limpio, avisos en stderr. `--output-format json` para metadatos |
| Límite de prompt | 128 KB argumento · 10 MB stdin |
| Timeout | **Ninguno propio — hay que ponerlo tú** (`timeout` o `setTimeout` + `kill`) |
| Coste | **Ninguno aparte: va incluido en la suscripción Max.** Lo que se gasta es cuota (ventana de 5 h + semanal). `total_cost_usd` es una estimación local, no un cargo |
| Trampa nº1 | **Sin `--allowedTools`, deniega en silencio con exit 0.** Mirar `permission_denials` |
| Trampa nº2 | **`--bare` no funciona aquí** (exige API key; este servidor va con suscripción Max) |
| Trampa nº3 | stderr trae avisos de permisos en cada llamada; no son errores |

---

## 10. Qué NO he verificado

> **⚙️ ACTUALIZADO EL 31 AGO 2026 (misma tarde).** Los tres puntos de abajo estaban abiertos cuando
> se escribió este documento; **los tres se midieron después** en
> `docs/diagnostico-claude-cli-limitaciones.md`. Se dejan tachados con su resultado en vez de
> borrarlos, para que se pueda reconstruir qué se sabía y cuándo.

- ~~**Concurrencia y límites de la suscripción Max:** no he probado a lanzar N invocaciones en
  paralelo.~~ **MEDIDO: 2, 3 y 5 en paralelo → 0 fallos de 15 invocaciones, sesiones separadas,
  paralelismo real.** Sigue sin conocerse el techo por encima de 5.
- ~~**Comportamiento en tareas largas de verdad** (>10 min): las pruebas de aquí son de segundos.~~
  **MEDIDO: una tarea de 13 min 32 s terminó con exit 0 y `terminal_reason: completed`. No hay
  timeout.** Lo que sí apareció es peor: **matar un `claude -p` a medias deja el fichero de salida
  VACÍO**, no parcial (salvo con `stream-json`).
- ~~**Hooks del proyecto bajo `-p`:** `bamburu/.claude/` tiene hooks y comandos propios
  (`commands/stop-hook.sh`); no he comprobado cómo se comportan en modo `-p`.~~
  **CORREGIDO: la premisa era falsa. `bamburu/.claude/` NO tiene ningún hook** — solo permisos y
  comandos. `commands/stop-hook.sh` se llama "hook" pero está en `commands/`, no está registrado en
  ninguna parte, y además apunta a `/home/bamburu/bamburu`, que no existe. Lo que sí quedó
  comprobado con un directorio de control es que **un hook, si lo hubiera, SÍ se ejecutaría bajo
  `-p`**.
