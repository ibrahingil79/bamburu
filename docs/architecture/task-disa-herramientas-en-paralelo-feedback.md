# Feedback — DISA se rompe cuando el modelo llama a dos herramientas a la vez

- **taskId:** `disa-herramientas-en-paralelo`
- **intento:** 1
- **veredicto:** ❌ RECHAZADO

## Qué hay que corregir

- Hay 11 línea(s) añadidas con restos que no deben quedar:
-   scripts/verify-disa-herramientas-paralelo.mjs:32  [console.log]  const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; consol
-   scripts/verify-disa-herramientas-paralelo.mjs:45  [console.log]  console.log('\n=== 1. toolUseBlocks: la lista COMPLETA de bloques, en orden, nunca solo el primero =
-   scripts/verify-disa-herramientas-paralelo.mjs:60  [console.log]  console.log('\n=== 2. la forma que rompió: `.find(...)` coge una y el turno declara dos ===\n');
-   scripts/verify-disa-herramientas-paralelo.mjs:72  [console.log]  console.log('\n=== 3. LA FORMA DE LA RESPUESTA: un tool_result por cada tool_use, mismo orden, mismo
-   scripts/verify-disa-herramientas-paralelo.mjs:93  [console.log]  console.log('\n=== 4. AISLAMIENTO DEL ERROR: el fallo de una no se lleva por delante a las demás ===
-   scripts/verify-disa-herramientas-paralelo.mjs:112  [console.log]  console.log('  · (la traza de `[error]` que sale aquí debajo es de safeError, y es lo esperado)');
-   scripts/verify-disa-herramientas-paralelo.mjs:125  [console.log]  console.log('\n=== 5. PRESUPUESTO: pasado el tope se rechaza CONTESTANDO, nunca callando ===\n');
-   scripts/verify-disa-herramientas-paralelo.mjs:143  [console.log]  console.log('\n=== 6. DE PUNTA A PUNTA por callClaude, con la API fabricada (fetchImpl) ===\n');
-   scripts/verify-disa-herramientas-paralelo.mjs:190  [console.log]  console.log('\n=== 7. GUARDIA: nadie vuelve a coger «la primera» herramienta con .find(...) ===\n');
-   scripts/verify-disa-herramientas-paralelo.mjs:225  [console.log]  console.log('\n──────────────────────────────');
-   scripts/verify-disa-herramientas-paralelo.mjs:226  [console.log]  console.log('  ' + pass + ' OK · ' + fail + ' fallos');

El texto completo del revisor está en `task-disa-herramientas-en-paralelo-review.md`.
