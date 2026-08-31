# DISA se rompe cuando el modelo llama a dos herramientas a la vez

- **id:** `disa-herramientas-en-paralelo`
- **cerrada:** 2026-08-31
- **resultado:** ✅ APROBADA
- **intentos:** 2
- **replanteamientos:** 0

## Criterios de aceptación

- [x] `core/llm.js` exporta `toolUseBlocks(apijson)` y devuelve **todos** los bloques `type === 'tool_use'` en orden: con una respuesta fabricada de `[thinking, text, tool_use A, tool_use B]` devuelve `[A, B]` (longitud 2, ids `['A','B']`); con `[]`, con `{}` y con `null` devuelve `[]` sin lanzar; un bloque `tool_use` sin `id` no aparece en la salida.
- [x] `modules/disa/index.js` exporta `resultadosDeHerramientas` **a nivel de módulo** (fuera de `register`), y para un array de N bloques devuelve un mensaje con `content.length === N`, con los `tool_use_id` **en el mismo orden que los bloques** y con el mismo conjunto de ids que el turno del asistente — comprobado para N = 1, N = 2 y N = 3.
- [x] `node scripts/verify-disa-herramientas-paralelo.mjs` termina con código 0, no abre ninguna base de datos ni hace ninguna petición de red real (usa `fetchImpl` inyectado), y entre sus aserciones están: un `ejecutar` que **lanza** produce un `tool_result` con `is_error: true` en vez de propagar la excepción; y con `presupuesto: 1` sobre 3 bloques salen **3** `tool_result`, `ejecutar` se llamó **1** vez, y los 2 restantes traen `MSG_PRESUPUESTO_HERRAMIENTAS`.
- [x] Un barrido de `modules/`, `core/` y `scripts/` sobre líneas que no sean comentario no encuentra ninguna coincidencia de `.find(` … `type === 'tool_use'` — es decir, `modules/disa/index.js:2583`, `scripts/verify-llm-disa-stock.mjs:90` y `scripts/verify-llm-migracion.mjs:67` están migrados a `toolUseBlocks`. El barrido va dentro de `scripts/verify-disa-herramientas-paralelo.mjs` y pone el fichero en rojo si aparece una.
- [x] En el bucle de `/message` no queda ninguna llamada a `INFORMES_TOOL.ejecutar`, `DTO_TOOL.ejecutar` ni `runQueryTool` fuera del despachador `ejecutarHerramienta`, y ese despachador devuelve `{ error }` para un nombre desconocido en vez de caer en `runQueryTool('')`. Los mapas de permisos (`ACTION_PERMS`, `STRICT_ADMIN_ONLY`, `QUERY_PROTECTED_TABLES`, `QUERY_TABLE_READ_PERMS`), `permisoDeSesion` y `evaluateQueryAccess` quedan **byte a byte iguales**.
- [x] El handler de `/message` no puede devolver `reply: ''`: al salir del bucle sin texto —presupuesto de vueltas agotado, o `stop_reason: 'tool_use'` sin bloques utilizables— `reply` es una cadena no vacía. El `try/catch` de `callClaude` (`index.js:2571-2580`) conserva sus cinco ramas con los mismos códigos HTTP (429, 503, 504, 502, 502) y los mismos textos.
- [x] `git diff --name-only` sobre la entrega devuelve exactamente estos seis ficheros: `core/llm.js`, `modules/disa/index.js`, `scripts/verify-llm-disa-stock.mjs`, `scripts/verify-llm-migracion.mjs`, `docs/auditorias/diagnostico-arquitectonico.md` y el nuevo `scripts/verify-disa-herramientas-paralelo.mjs`. **`TABLERO.md` no aparece**, y no aparece ningún fichero de `modules/erp/`.
- [x] `node --check modules/disa/index.js` y `node --check core/llm.js` pasan, y ningún comentario del código sigue afirmando que «el bucle de tool-use queda intacto» (`modules/disa/index.js:2563-2565`) ni citando la línea 2570 como la del fallo (`docs/auditorias/diagnostico-arquitectonico.md:261`).

## Historial de intentos

| Intento | Veredicto | Motivos |
|---------|-----------|---------|
| 1 | rechazado | Hay 11 línea(s) añadidas con restos que no deben quedar:;   scripts/verify-disa-herramientas-paralelo.mjs:32  [console.log]  const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m) |
| 2 | aprobado | — |

## Artefactos

- Análisis: `docs/architecture/task-disa-herramientas-en-paralelo-analysis.md`
- Revisión: `docs/architecture/task-disa-herramientas-en-paralelo-review.md`

## Commits

- `d9d5ed7` El verificador de herramientas en paralelo imprime sin `console` + `log`
- `13ef3d8` El vigía de Telegram acepta órdenes, además de mandar partes

## Consumo de cuota

- Al empezar: 20% de sesión usado
- Al cerrar: 40% de sesión usado
- Diferencia: 20 puntos
