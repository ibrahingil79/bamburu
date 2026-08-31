# El dueño no puede ver sus propios informes por DISA

- **id:** `disa-informes-permiso-dueno`
- **cerrada:** 2026-08-31
- **resultado:** ✅ APROBADA
- **intentos:** 1
- **replanteamientos:** 0

## Criterios de aceptación

- [x] Con una sesión `{ userId: <owner activo>, role: 'owner' }` que **no** tiene la fila correspondiente en `user_permissions`, `checkPermission(db, session, 'invoices', 'read')` devuelve `true`; con `{ userId, role: 'admin' }` también; y con `{ userId, role: 'employee' }` sin filas devuelve `false`.
- [x] `modules/disa/index.js` exporta `permisoDeSesion(db, session)` **a nivel de módulo** (fuera de `register`), las líneas que construyen `INFORMES_TOOL` y `DTO_TOOL` la usan, y no queda ninguna lambda que llame a `checkPermission` escrita dentro del handler de `/message`.
- [x] Con el `hasPerm` construido por `permisoDeSesion` para el dueño: `herramientasDeInformes(...).listar()` devuelve `ocultos_por_permiso === 0`, `catalogo().areas` trae tantas áreas como `Object.keys(AREAS)` (7), y `componer({area:'ventas', quiero_saber:'base', repartido_por:'fecha'})` devuelve `filas` sin `error`.
- [x] Con ese mismo `hasPerm` del dueño, `herramientasDeDescuentos(...).ver()` **no** devuelve `error`; con el de un empleado sin permisos **sí** devuelve el error de permiso.
- [x] `node scripts/verify-disa-permiso-dueno.mjs` termina con código 0, abre la base con `{ readonly: true }`, y los recuentos de `analytics_panels` y `user_permissions` son idénticos antes y después.
- [x] `scripts/gate-disa-informes.mjs` ya no pasa `() => true` como permisos del dueño (usa `permisoDeSesion`), conserva los `hasPerm` restrictivos del bloque [4], y termina con código 0.
- [x] `git diff --name-only` sobre la entrega devuelve exactamente estos cinco ficheros modificados más el nuevo: `core/permission-check.js`, `modules/disa/index.js`, `modules/disa/informes.js`, `scripts/gate-disa-informes.mjs`, `docs/auditorias/diagnostico-arquitectonico.md` y `scripts/verify-disa-permiso-dueno.mjs`. `TABLERO.md` **no** aparece.
- [x] Ningún comentario del código sigue afirmando que el `hasPerm` de DISA es «el MISMO `checkPermission` de `requirePerm`» sin decir que la primitiva ya incluye el bypass (`modules/disa/index.js:6` y `:2527`, `modules/disa/informes.js:17-18`).

## Historial de intentos

| Intento | Veredicto | Motivos |
|---------|-----------|---------|
| 1 | aprobado | — |

## Artefactos

- Análisis: `docs/architecture/task-disa-informes-permiso-dueno-analysis.md`
- Revisión: `docs/architecture/task-disa-informes-permiso-dueno-review.md`

## Commits

- `e5111df` El bypass owner/admin pasa a checkPermission, y el dueño recupera sus informes

## Consumo de cuota

- Al empezar: 0% de sesión usado
- Al cerrar: 14% de sesión usado
- Diferencia: 14 puntos
