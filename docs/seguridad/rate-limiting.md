# Rate limiting — persistencia antiavalancha

Los umbrales, las claves y el contrato HTTP viven en `core/rate-limit.js`. Un rechazo conserva el
`429`, `Retry-After` y el cuerpo JSON o HTML anterior. Lo que cambia es su observabilidad: los 429 no
crean una fila individual en `security_events`; se acumulan en `rate_limit_summaries`.

## Límites explícitos

- Cupos activos en memoria: máximo 10.000 claves. Al agotarse, una clave nueva falla cerrada con 429;
  el agotamiento nunca permite saltarse el freno.
- Resúmenes en memoria: máximo 289 claves (256 orígenes anonimizados, 32 desbordamientos por categoría
  y uno global). El origen se transforma con HMAC-SHA-256 y una sal aleatoria del proceso; nunca se
  persiste la IP completa ni el sujeto de `keyFn`.
- Periodo de agregación: cinco minutos. Cada resumen conserva inicio, fin aproximado, categoría/limitador,
  negocio, cantidad de rechazos y origen técnico anonimizado.
- Frecuencia: como máximo una escritura cada cinco segundos por resumen y cuatro operaciones por
  segundo para todo el proceso. La limpieza ya existente de los cupos vacía remanentes de forma
  limitada; no se añade ningún temporizador ni proceso.
- Retención en memoria: dos periodos y, por el barrido existente cada diez minutos, un máximo de veinte
  minutos. Retención persistida: 30 días, con limpieza de
  la tabla nueva únicamente. `security_events` y todos los registros históricos quedan intactos.

La escritura usa un `UPSERT` acumulativo para que dos procesos sumen sus lotes sin pisarse. Si
`control.db` no está disponible, el agregador conserva el lote acotado en memoria, limita el aviso a
uno cada cinco minutos y el middleware sigue respondiendo 429: el fallo de observabilidad no abre un
bypass ni rompe la respuesta.

## Comprobación aislada (no automática)

`scripts/test-rate-limit-aggregation.mjs` define una ráfaga de 5.000 rechazos y comprueba el contrato,
la ausencia de eventos individuales y el recuento agregado. Solo se ejecuta con autorización expresa
de Ibrahin, conforme a `RITUAL.md`.
