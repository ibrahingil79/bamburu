# El portal del cliente escribe el dinero a la inglesa

- **id:** `portal-formato-dinero`
- **cerrada:** 2026-09-01
- **resultado:** ✅ APROBADA
- **intentos:** 4
- **replanteamientos:** 1

## Criterios de aceptación

- [x] `scripts/run-gates.mjs` tiene dentro de `ROJOS_CONOCIDOS` **exactamente dos** entradas, con las claves `'verify-dinero-espanol'` y `'gate-portal-ampliado'`; cada una es un objeto con `desde: '1 sep 2026'` y `motivo`, y cada `motivo` nombra su causa con fichero y línea (`descuentos.js:163` y el producto `2097` en la primera; `readOnlyGuard` / `core/tenant-middleware.js` y `suspended_admin` en la segunda) **y** la tarea que lo cierra.
- [x] El cambio en `scripts/run-gates.mjs` es **solo aditivo**: `git diff d93125e..HEAD -- scripts/run-gates.mjs` no contiene **ninguna** línea que empiece por `-` (aparte de la cabecera `--- a/…`). Es decir: los comentarios de las declaraciones retiradas (`gate-nav-inicio-disa`, `gate-vigia-agenda`) siguen íntegros y `DEUDA`, `ENTORNO` y `EXCLUIDOS` no se han tocado.
- [x] `node --check scripts/run-gates.mjs` y `node --check scripts/lib/gate-env.mjs` terminan con código 0 y sin salida.
- [x] `git diff --name-only d93125e..HEAD -- modules/` está **vacío**, y `modules/erp/routes/invoices.js` no aparece en `git diff --name-only d93125e..HEAD`.
- [x] `git diff d93125e..HEAD -- scripts/verify-dinero-espanol.mjs scripts/gate-portal-ampliado.mjs` está **vacío** (ningún instrumento se afloja para conseguir un verde), y en `modules/portal/index.js` siguen `grep -c toFixed` = **0** y el `import { fmtEur } from '../erp/margen.js';`.
- [x] El comentario de `scripts/lib/gate-env.mjs` inmediatamente anterior a `export const CHROMIUM` contiene la ruta literal `/snap/chromium/current/usr/lib/chromium-browser/chrome`, la palabra `aarch64`, la variable `SNAP_USER_COMMON` y la fecha `1 sep 2026`; **ya no** contiene la afirmación de que en este servidor no arranca un navegador; y la línea `export const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium';` es **idéntica** a la de `d93125e`.
- [x] `git ls-files docs/architecture/` lista los cinco documentos de la tarea (`…-analysis.md`, `…-analysis-replanteo-0.md`, `…-informe.md`, `…-review-intento-1.md`, `…-feedback.md`), y las dos rutas citadas en `TABLERO.md:8266-8267` existen en esa lista.
- [x] `TABLERO.md` §Deuda técnica contiene los dos cabos nuevos con fecha `1 sep 2026` —el de `gate-portal-ampliado` / `negocioDesechable()` y el de la receta del navegador sin automatizar— y la entrada existente de `verify-dinero-espanol` (`:6034`) dice que el rojo queda declarado en `ROJOS_CONOCIDOS`.

## Historial de intentos

| Intento | Veredicto | Motivos |
|---------|-----------|---------|
| 1 | rechazado | es lo correcto**, y queda escrito; no lo cuento como `FUERA-DE-ALCANCE`. — - **Paso 4** — el bloque del portal está donde el plano lo mandaba (dentro del `try`, tras el bucle de `/admin` y antes del b |
| 2 | rechazado | el programador dice que el análisis es imposible: - **taskId:** `portal-formato-dinero`
- **intento:** 2 (vengo de un rechazo)
- **entrega vigente:** `bfea8a8` + `d93125e`, **sin tocar** — no he commi |
| 3 | rechazado | No hay ningún commit nuevo desde d93125e.; El programador no ha confirmado nada, o lo dejó sin confirmar en el árbol de trabajo. |
| 1 | aprobado | — |

## Artefactos

- Análisis: `docs/architecture/task-portal-formato-dinero-analysis.md`
- Revisión: `docs/architecture/task-portal-formato-dinero-review.md`

## Commits

- `da78a89` Los dos rojos del barrido, declarados con dueño; y la receta del navegador, escrita donde se lee

## Consumo de cuota

- Al empezar: 21% de sesión usado
- Al cerrar: 61% de sesión usado
- Diferencia: 40 puntos
