✅ APROBADO

# Revisión — `disa-herramientas-en-paralelo` · DISA se rompe cuando el modelo llama a dos herramientas a la vez

- **Papel:** revisor · **Fecha:** 31 ago 2026 · **Intento:** 2
- **Entregable juzgado:** `5699aaf..HEAD` (`d61c434` la construcción + `d9d5ed7` la corrección del
  rechazo del intento 1). El rango que traía el encargo (`d61c434..HEAD`) solo contiene la segunda,
  así que se ha revisado el trabajo **entero**, no la corrección suelta: el intento 1 se rechazó y lo
  rechazado vuelve a juicio completo.
- **Análisis pactado:** `docs/architecture/task-disa-herramientas-en-paralelo-analysis.md`
- **Qué se ha ejecutado:** `node scripts/verify-disa-herramientas-paralelo.mjs` **una sola vez**
  (offline, sin red, sin BD de negocio, sin gasto), `node --check` sobre los tres ficheros de código,
  y comparaciones de texto contra `5699aaf`. Nada más. No se ha lanzado ningún barrido ni gate.

---

## 1 · Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | `core/llm.js` exporta `toolUseBlocks(apijson)`: `[thinking, text, A, B]` → `[A,B]`; `[]`, `{}` y `null` → `[]` sin lanzar; un `tool_use` sin `id` no sale | SÍ | `core/llm.js:207-216` (`export function toolUseBlocks`, `filter(b => b && b.type === 'tool_use' && b.id)`, guarda `!Array.isArray(apijson.content) → []`). Ejercitado: bloque 1 del verificador, 5 ✓ — *«[thinking, text, tool_use A, tool_use B] → [A, B] (longitud 2, en orden)»*, *«respuesta vacía / rara / null → [] sin lanzar»*, *«un tool_use SIN id se descarta»* |
| 2 | `modules/disa/index.js` exporta `resultadosDeHerramientas` **a nivel de módulo**; N bloques → `content.length === N`, ids en el mismo orden y mismo conjunto, para N = 1, 2 y 3 | SÍ | `modules/disa/index.js:180` — `export function resultadosDeHerramientas(...)`, en la línea 180, **antes** de `export function register` (línea 223): está fuera del `register`, importable sin app ni BD. Lo demuestra que el verificador la importa y la ejecuta (`scripts/verify-disa-herramientas-paralelo.mjs:27`). Ejercitado: bloque 3, 18 ✓ — seis aserciones × N=1,2,3, incluidas *«los tool_use_id van EN EL MISMO ORDEN que los bloques»* y *«el conjunto de ids del mensaje `user` es IDÉNTICO al del turno del asistente»* |
| 3 | `node scripts/verify-disa-herramientas-paralelo.mjs` termina con código 0, sin BD ni red real (`fetchImpl`), y entre sus aserciones: `ejecutar` que lanza → `tool_result` con `is_error`; `presupuesto: 1` sobre 3 bloques → **3** `tool_result`, `ejecutar` llamado **1** vez, los 2 restantes con `MSG_PRESUPUESTO_HERRAMIENTAS` | SÍ (con un matiz declarado, abajo) | Ejecutado una vez: **`50 OK · 0 fallos`, `EXIT=0`**. Bloque 4: *«un `ejecutar` que LANZA no propaga: sale un tool_result con is_error»* ✓, y *«el detalle técnico de la excepción no viaja en el tool_result (safeError)»* ✓. Bloque 5: *«con presupuesto 1 y 3 bloques salen 3 tool_result»* ✓, *«`ejecutar` se llamó UNA vez»* ✓, *«los 2 sobrantes traen MSG_PRESUPUESTO_HERRAMIENTAS con is_error: true»* ✓. Red: `fetchImpl` inyectado (`:151-156`), la corrida no sale a la red. BD: `ls -la data/` antes y después → **todos los mtimes idénticos**; no se abre ninguna BD de negocio ni se siembra nada. *Matiz:* importar `core/llm.js` abre `data/control.db` como efecto de módulo (`core/control-db.js:22`, `new Database(...)` en el cuerpo). Es **inevitable con el diseño que manda el propio análisis** (§4.3 punto 8: `fetchImpl` inyectado en `callClaude`), lo tiene igual el fichero que el análisis puso de modelo (`scripts/test-llm-texto-respuesta.mjs:20`), no escribe nada, y **el constructor lo declara en la cabecera** (`verify-disa-herramientas-paralelo.mjs:20-22`) en vez de callarlo. Lo cuento como cumplido y lo dejo escrito como observación |
| 4 | Barrido de `modules/`, `core/` y `scripts/` sobre líneas que no son comentario: ninguna coincidencia de `.find(` … `type === 'tool_use'`; las tres copias migradas; el barrido va dentro del verificador y lo pone en rojo | SÍ | Bloque 7 del verificador (`:195-225`), 1 ✓ — *«ningún fichero de modules/, core/ ni scripts/ coge la primera herramienta con .find»*. Contrastado a mano: `grep -rn "type\s*===\s*['\"]tool_use['\"]" modules/ core/ scripts/` devuelve 4 líneas y ninguna es un `.find` de producción — `core/llm.js:215` (el `filter` del helper), `verify-…-paralelo.mjs:70` (el patrón viejo fabricado a propósito, bloque 2), `:184` (un `filter`) y `:198` (comentario). `modules/disa/index.js:2583`, `verify-llm-disa-stock.mjs:90` y `verify-llm-migracion.mjs:67` ya no existen como tales |
| 5 | En el bucle no queda ninguna llamada a `INFORMES_TOOL.ejecutar`, `DTO_TOOL.ejecutar` ni `runQueryTool` fuera de `ejecutarHerramienta`; nombre desconocido → `{ error }`; mapas de permisos, `permisoDeSesion` y `evaluateQueryAccess` **byte a byte iguales** | SÍ | `grep -n "INFORMES_TOOL.ejecutar\|DTO_TOOL.ejecutar\|runQueryTool"` sobre `modules/disa/index.js` → 5 aciertos: la definición (`:2590`), dos comentarios (`:406`, `:2629`) y las **tres únicas llamadas**, las tres dentro de `ejecutarHerramienta` (`:2633-2635`). El nombre desconocido cae en `:2636` → `{ error: 'No conozco la herramienta "…".' }`. Permisos: comparación de cada definición entre `5699aaf` y `HEAD` → `ACTION_PERMS` IDÉNTICO (32 líneas), `STRICT_ADMIN_ONLY` IDÉNTICO (18), `QUERY_PROTECTED_TABLES` IDÉNTICO (57), `QUERY_TABLE_READ_PERMS` IDÉNTICO (35), `evaluateQueryAccess` IDÉNTICO, `permisoDeSesion` IDÉNTICO. Y `git diff` sobre el fichero trae **solo tres hunks** (la línea de `import`, el bloque nuevo de nivel de módulo y el bucle): ninguno entra en esas zonas |
| 6 | `/message` no puede devolver `reply: ''`; el `try/catch` de `callClaude` conserva sus cinco ramas con los mismos códigos y textos | SÍ | `modules/disa/index.js:2693-2694` — `if (!reply) reply = 'He consultado varias cosas…'`, después del bucle y antes de cualquier uso (el primero es `:2709`). Los dos caminos de salida sin texto quedan cubiertos: `:2673` saca el texto con `textFromResponse` y `:2644` agota `MAX_VUELTAS` hasta ese `if`. Catch: `diff` del bloque `[DISA] API error` … entre `5699aaf` y `HEAD` → **vacío, CATCH IDÉNTICO**; siguen las cinco ramas 429 / 503 / 504 / 502 / 502 (`:2658-2665`) con sus textos. Verificado además de punta a punta: bloque 6, *«y `reply` nunca sale vacía del bucle»* ✓ |
| 7 | `git diff --name-only` devuelve exactamente esos seis ficheros; sin `TABLERO.md` y sin nada de `modules/erp/` | SÍ | `git diff --name-only 5699aaf..HEAD` → `core/llm.js`, `docs/auditorias/diagnostico-arquitectonico.md`, `modules/disa/index.js`, `scripts/verify-disa-herramientas-paralelo.mjs`, `scripts/verify-llm-disa-stock.mjs`, `scripts/verify-llm-migracion.mjs`. Seis, los seis pactados. Ni `TABLERO.md` ni `modules/erp/` ni nada de Verifactu |
| 8 | `node --check` pasa en los dos ficheros; ningún comentario sigue diciendo «el bucle de tool-use queda intacto» ni citando la 2570 como la línea del fallo | SÍ | `node --check modules/disa/index.js` → OK; `node --check core/llm.js` → OK; añado `node --check scripts/verify-disa-herramientas-paralelo.mjs` → OK. `grep -rn "bucle de tool-use queda intacto" modules/ core/ scripts/ docs/` → solo aparece en el propio análisis citándose; **en el código no queda** (sustituido en `modules/disa/index.js:2646-2651` por el contrato nuevo con su fecha). `docs/auditorias/diagnostico-arquitectonico.md:272-273` conserva el `~~2570~~` **tachado** con la corrección a la 2583 y el motivo, que es exactamente lo que pedía §4.5 punto 11 |

**8 de 8 en SÍ.**

---

## 2 · ¿Se construyó lo que decía el análisis?

Sí, y con dos desvíos, los dos **declarados por escrito** por el constructor en el mensaje de commit
antes de que nadie preguntara:

- `console.info` en vez de `console.log` para la traza operativa (`modules/disa/index.js:2683`),
  porque el validador del orquestador rechaza esa marca en líneas añadidas. Mismo stdout, misma línea
  en `journalctl`.
- El cierre de §4.2 del diagnóstico se marca con el **id de la tarea** y no con el hash del commit
  —imposible de conocer antes de commitear—, igual que ya se hizo en §4.1.

Ninguno cambia el comportamiento ni el alcance. Los pasos 1 a 12 del plan están todos: helper en
`core/llm.js` justo debajo de `textFromResponse`; las tres constantes exportadas; la función pura
exportada a nivel de módulo con la firma exacta pactada; el despachador por nombre; el bucle
reescrito con `vueltas`/`gastadas`; los comentarios corregidos; el verificador nuevo con sus siete
bloques; las dos copias del defecto migradas **importando** las piezas reales en vez de recalcarlas
(`verify-llm-disa-stock.mjs:12`, `verify-llm-migracion.mjs:5`); el registro en el diagnóstico
conservando el texto viejo tachado; y `TABLERO.md` sin tocar.

No se tocó ningún fichero que el análisis no nombre. Los seis del criterio 7 son los seis del plan.

## 3 · El nivel de construcción

- **Capa y patrón.** La partición respeta la regla de `core/llm.js:3-11`: la *forma* de una respuesta
  de la API queda en el transporte (`toolUseBlocks`, hermano literal de `textFromResponse`), y la
  *política* —cuántas, en qué orden, qué se rechaza— en DISA. `resultadosDeHerramientas` sigue el
  patrón ya usado dos veces en la casa (`evaluateQueryAccess`, `permisoDeSesion`): nivel de módulo,
  exportada y pura, para que la comprobación mida el cableado real. Y lo mide: las dos verificaciones
  con modelo real ahora **importan** esas funciones en vez de reescribirlas, así que el fallo del
  `gate-disa-informes` —dar verde sobre una copia— no puede repetirse aquí.
- **Una pieza, una cosa.** `resultadosDeHerramientas` construye el mensaje y nada más: no ejecuta
  herramientas (recibe `ejecutar`), no toca BD, no toca sesión, no imprime. La traza sale fuera
  (`:2683`), a partir del `traza` que devuelve.
- **Números escritos a mano.** No queda ninguno: `MAX_VUELTAS`, `MAX_HERRAMIENTAS_POR_MENSAJE` y
  `MSG_PRESUPUESTO_HERRAMIENTAS` son constantes exportadas, y el verificador afirma sobre ellas
  (`:144`) en vez de sobre literales.
- **Errores distinguidos.** Tres estados separados y visibles en la traza —`completada`, `rechazada`,
  `sin presupuesto`— y `is_error: true` solo donde toca. El error de una herramienta **no** anula el
  resultado de las otras (bloque 4 lo prueba), que es la decisión razonada de §2 frente al *changeset*
  de SAP. El detalle técnico de una excepción no viaja al modelo: pasa por `safeError`
  (`:206`), comprobado en `:124`.
- **Nada que cerrar.** Sin ficheros, sin procesos, sin temporizadores. El bucle está acotado por dos
  topes explícitos, no por casualidad.
- **Repetible.** La función es pura y sin estado; `apiMessages` es local a la petición.
- **Probable por partes.** Es lo mejor de la entrega: 50 aserciones deterministas, offline y en
  milisegundos, sin levantar servidor ni BD de negocio, sin sembrar nada — así que la norma «lo que
  una prueba crea, la prueba lo borra» se cumple porque no crea.
- **La regresión donde importa.** El camino de UNA herramienta —el 90 % del uso, el riesgo 1 del
  análisis— está probado explícitamente (`N=1` en el bloque 3, y `toolUseBlocks({content:[TOOL]})` en
  el 1), y `MAX_VUELTAS = 5` conserva el número de llamadas a la API, así que el gasto no sube.

## 4 · Qué se rompe

- **VERI\*FACTU:** intacta. `git diff --name-only` no toca `modules/erp/` ni nada de la cadena; las
  siete herramientas siguen siendo de lectura y las acciones con valor legal siguen yendo por
  `[ACCION:]` + confirmación, camino que no se ha tocado.
- **Datos existentes / migraciones:** ninguna. Cero SQL nuevo, cero `runMigrations`. `apiMessages` no
  se persiste; `disa_conversations` guarda lo mismo que antes.
- **Permisos (CANON §3-bis):** ni una línea. Verificado definición a definición (criterio 5). Cada
  herramienta se sigue ejecutando por su `ejecutar` con el mismo `hasPerm`; ejecutar dos no relaja
  ninguna.
- **Pantallas:** el contrato HTTP de `/message` no cambia —mismas claves, mismos códigos—; el único
  cambio visible es que `reply` deja de poder venir vacía. No se tocó ningún fichero de pantalla, así
  que los gates de pantalla y la norma de la captura no aplican a esta entrega.
- **Concurrencia:** un `for` síncrono, sin `Promise.all`, orden determinista. El techo de lecturas
  sube de 5 a 8 por mensaje, todas `SELECT`; lectores concurrentes de SQLite no se bloquean entre sí.
- **Casos límite mirados:** respuesta `null`/sin `content` (antes `data.content.find(...)` habría
  lanzado; ahora `toolUseBlocks` devuelve `[]`), `stop_reason: 'tool_use'` sin bloques utilizables
  (saca el texto en vez de dejar `reply` vacía), `presupuesto: 0` (contesta igual sin ejecutar),
  `ejecutar` que lanza, `tool_use_id` repetido, resultado no serializable (`JSON.stringify` circular
  cae en el `catch`).

Los nueve riesgos declarados en §5 del análisis están mitigados como decía, y los que se dejaban a
propósito (el 7, la frase «No se ha ejecutado ninguna acción») siguen exactamente donde se dijo que
se quedaban.

---

## Observaciones (no bloquean)

1. **El turno del asistente se empuja entero, y el emparejador puede saltarse bloques.**
   `modules/disa/index.js:2685` manda `data.content` tal cual, mientras `resultadosDeHerramientas`
   descarta los `tool_use` sin `id` y los de `id` repetido (`:196`). Si la API llegara a mandar uno de
   esos dos —hoy no lo hace, y por eso ambos filtros son defensivos y están pactados en el análisis—,
   el turno declararía más `tool_use` que `tool_result` y volvería el 400 por la puerta de atrás.
   Cerrarlo cuesta una línea: afirmar `r.mensaje.content.length === bloques.length`, o construir el
   turno del asistente a partir de lo contestado. No es motivo de rechazo (es exactamente lo que el
   análisis mandó construir), pero es el único hueco por el que el fallo original podría volver.
2. **`console.info` es el único de su especie en el fichero.** El resto de `modules/disa/index.js`
   usa `console.log`/`console.error`. El desvío está justificado y declarado, pero conviene que el
   validador del orquestador y el estilo de la casa dejen de decir cosas distintas, o esto se repetirá
   en cada entrega.
3. **El criterio 3 pedía algo que su propio análisis hace imposible.** «No abre ninguna base de datos»
   es incompatible con «`fetchImpl` inyectado en `callClaude`», porque importar `core/llm.js` arrastra
   `core/control-db.js`, que abre `data/control.db` al cargarse. El fichero que el análisis puso de
   modelo tiene el mismo efecto. Para la próxima vez que se escriba un criterio así: lo comprobable es
   *«no abre ninguna BD de negocio y no escribe nada»*, y eso sí se cumple (mtimes de `data/`
   idénticos antes y después de la corrida).
4. **`cleanReply` todavía puede salir vacía por otra puerta.** `modules/disa/index.js:2766`, en la rama
   de *handoff*: si el modelo contesta solo con el bloque `[ACCION:]` y `executionResult.message` viene
   vacío, `cleanReply` —que es lo que se devuelve en `:2810`, no `reply`— queda en `''`. Es
   **anterior a esta tarea** y está fuera de su alcance (el criterio 6 habla de `reply` al salir del
   bucle, y eso sí quedó cerrado), pero la avería del 15 ago 2026 que esta entrega ha tapado sigue
   teniendo este otro camino abierto. Merece ficha propia en `TABLERO.md` §Deuda técnica.
5. **La guardia se excluye a sí misma por nombre de fichero, no por línea.** `:210` salta el
   verificador entero, así que un `.find(… 'tool_use')` escrito ahí dentro en el futuro no se vería.
   Es lo que pedía el análisis y el fichero explica por qué; una marca por línea (`// guardia:ignorar`)
   sería más estrecha.
