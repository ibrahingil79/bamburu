# La pantalla de «no tienes permiso» abre una ventanita sobre una página en blanco

- **id:** `pantalla-403-ventanita`
- **cerrada:** 2026-09-01
- **resultado:** ✅ APROBADA
- **intentos:** 2
- **replanteamientos:** 0

## Criterios de aceptación

- [x] `core/auth.js`, `modules/erp/routes/settings.js` y `core/permission-check.js` no contienen ninguna llamada a `alert(`, `prompt(` ni `confirm(` fuera de comentarios, y ninguno de los tres aparece en la salida de `node scripts/censo-ventanitas.mjs`.
- [x] Un empleado sin `invoices.read` que navega a `/admin/contabilidad` recibe status **403**, su **URL final sigue siendo `/admin/contabilidad`** (sin redirección), y el HTML servido contiene el texto de `ERR.PERM` y un enlace visible a `/admin`.
- [x] Cargando esa misma pantalla con `window.alert`, `window.prompt` y `window.confirm` neutralizados antes del documento, el texto de la denegación aparece en `document.body.innerText`, el contador de diálogos interceptados es **0** y la consola no registra ningún error de JS.
- [x] Un empleado sin `company.update` que hace `DELETE /api/erp/settings/email-templates/recordatorio/unico` recibe 403 con `content-type` que contiene `application/json` y un cuerpo `JSON.parse`-able con clave `error`; y ese mismo empleado, sin `company.read` ni ninguna sección de configuración visible, recibe 403 **en HTML** al navegar a `/admin/settings`.
- [x] Un usuario con rol `admin` **sin** el permiso `historial.read` que navega a `/admin/historial/<id>` sigue recibiendo 403 con el mensaje de datos de salud (contiene «datos de salud»), **no** el genérico de permiso.
- [x] `node scripts/gate-403-permiso.mjs` sale con código 0 y **0 ✗**, y al terminar no queda en la BD del tenant ningún usuario ni sesión con la marca `GATE403-`.
- [x] `node scripts/censo-ventanitas.mjs` recorre `modules/` **y** `core/`, cuenta `alert` además de `prompt`/`confirm`, imprime `SIN DECLARAR: 0` y sale con código 0; y `node scripts/gate-sin-ventanitas.mjs` sigue con 0 ✗.
- [x] `node scripts/lint-js-servido.mjs` sale con código 0, y `/admin/login`, `/admin/settings` y `/admin/portal` —los tres consumidores de `ROOT_TOKENS`— responden 200 con esa misma URL final.

## Historial de intentos

| Intento | Veredicto | Motivos |
|---------|-----------|---------|
| 1 | rechazado | No tengo ningún reparo de nivel. **`NIVEL-INSUFICIENTE` no aplica.** — ---; [SIN-PRUEBAS] El gate del Bloque D no se ha ejecutado nunca, ni se ha mirado su captura — **Dónde:** `scripts/gate-403-permi |
| 2 | aprobado | — |

## Artefactos

- Análisis: `docs/architecture/task-pantalla-403-ventanita-analysis.md`
- Revisión: `docs/architecture/task-pantalla-403-ventanita-review.md`

## Commits

- `52d4529` El gate de la pantalla de 403 se ha CORRIDO, y al correrlo medía la puerta equivocada

## Consumo de cuota

- Al empezar: 40% de sesión usado
- Al cerrar: 21% de sesión usado
- Diferencia: -19 puntos
