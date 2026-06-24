# Convenciones — Bamburu

> Fuente de verdad: el repo. Patrones observados en el código, no preferencias inventadas.

## Lenguaje y estilo
- **ESM** en todo. `import`/`export` con rutas relativas explícitas (`.js` incluido).
- **better-sqlite3 es síncrono:** nunca `await` en una query. `db.prepare(...).get()/.all()/.run()`.
- **Estados de pedido en ESPAÑOL:** `borrador, en_preparacion, enviado, completado, cancelado, reembolsado`. (Mezclar inglés fue causa de bugs de analítica — prohibido.)
- HTML/JS **en línea** dentro de las rutas (template literals). No hay framework de front.
- Comentarios densos y en español que explican el *porqué* (regla de negocio), no el *qué*. Mantener ese estilo al editar.

## Patrones usados
- **Módulo = `register(app, db)`** montado por `core/loader.js`.
- **Servicios compartidos** con sufijo `Svc` (`emitTicketSvc`, `createClientSvc`, `emitSustitutivaSvc`): una sola implementación que usan tanto la ruta HTTP como DISA. La ruta solo añade permisos, log y código HTTP.
- **Un único punto de escritura** para operaciones con valor (p. ej. cobros: `POST /api/erp/invoices/:id/payments` con guard `isCobrable`).
- **Fuente única de una regla:** si una clasificación ya existe (p. ej. `countsAsReceivable` en `cobros.js`), se **reutiliza**, no se duplica con matices distintos (ver `ventas-metrics.js`).
- **Permisos:** `requirePerm('modulo.accion')` en cada endpoint y en vistas que renderizan datos.
- **Validación:** `validate(zodSchema)` (zod 4) antes del handler; el servicio revalida.
- **CSRF:** token por header `x-csrf-token` (fetch) o campo `_csrf` (forms), comparado con `session.csrfToken`.
- **Escapar SIEMPRE la salida** con `escHtml` (`core/escape.js`) — XSS almacenado fue un bug real (A1).
- **Migraciones lazy e idempotentes** (`runMigrations` en tenant-middleware): `CREATE TABLE IF NOT EXISTS` + helper que hace `ALTER TABLE ADD COLUMN` solo si falta; flags de migración en `settings`.

## Prohibido
- **Nunca DROP ni borrado en duro de datos de tenant.** Migrar = **archivar**: renombrar tabla (`x` → `x_legacy`/`x_archived`). "Eliminar" del TABLERO = desmontar rutas/UI y dejar de leer, **no** destruir datos. Si una tarea pide borrar de verdad, parar y preguntar.
- **No editar ni borrar una factura emitida** (rompe la cadena de hash, es infracción): solo anular o rectificar (asientos nuevos enlazados).
- No `await` en queries; no recortar funciones "porque el cliente es pequeño" (CANON §0).
- No tocar Capa 2 (`store/`) ni Capa 3 hasta cerrar Capa 1.

## Tests / verificación
Tres familias en `scripts/` (patrón común: contador `ok(cond,msg)` con `pass/fail` y `process.exit(fail?1:0)`):
- **`test-*.mjs`** — lógica pura sobre **BD temporal** (`tmpdir`), determinista.
- **`gate-*.mjs`** — contra el **servidor real** (tenant `desarrollo`) en navegador (Puppeteer), pensados como puerta CI; **limpian tras de sí** (borran sesión/artefactos creados).
- **`verify-*.mjs`** — verificación de una pieza; variantes `-browser` (headless real), `-http` (endpoints) y `-disa` (vía la IA).
- **Headless es necesario pero NO suficiente:** nada está "terminado" hasta verse pintado en navegador real (ver flujo-de-trabajo.md).

## Commits
- Prefijos observados: **`Pilar N · PIEZA X — …`** para código de pieza; **`docs(tablero): …`** para el registro que la acompaña; `feat(area): …`, `fix(area): …` para arreglos puntuales. Cada commit de código suele ir seguido de un `docs(tablero)` que lo registra con su hash.
- Rama **`master`**, remoto SSH `origin` (GitHub). Push: `git push origin master`.
- El mensaje dice **qué se cerró y qué commits incluye**; las referencias a tareas llevan **código + nombre** (`A3 — Catálogo mixto`, no `A3`).
