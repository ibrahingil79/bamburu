# Errores conocidos / gotchas — Bamburu

> Trampas reales detectadas en código, tests, comentarios y BUGS_DISA.md. Fuente de verdad: el repo.

## Entorno y rutas
- **Path del proyecto:** es `/home/ubuntu/bamburu` (systemd `User=ubuntu`). **`CLAUDE.md` y varios `scripts/gate-*.mjs` aún dicen `/home/ibrahin/bamburu`** — está desactualizado; usar `/home/ubuntu`.
- **`node -e` con SQL entre comillas se rompe** (las comillas dobles se vuelven identificadores SQLite, las simples cierran la cadena del shell). Usar heredoc: `node --input-type=module <<'EOF' … EOF` desde la raíz del repo (para que resuelva `node_modules`; `NODE_PATH` no sirve para ESM).

## Puppeteer / Chromium (verificación headless)
- **Puppeteer 25 quitó `browser.isConnected()`** → es la propiedad `browser.connected` (hay un helper `browserAlive()` en `core/pdf.js`).
- **El Chrome que trae Puppeteer es x86-64**; el host es ARM64 → solo funciona **`/snap/bin/chromium`** (`executablePath`).
- **El snap de Chromium falla bajo systemd con `NoNewPrivileges=true`** → la unit usa `NoNewPrivileges=false` (infra, fuera de git).

## Migraciones / BD
- **Migración lazy:** una columna nueva no existe en la `.db` viva hasta que **una request a ese tenant** dispara `runMigrations`. En pruebas, "calentar" el tenant con un `curl` (cookie `btenant`) antes de leer el archivo.
- **better-sqlite3 version mismatch:** reconstruir con `PYTHON=/usr/bin/python3.11 npm rebuild better-sqlite3` desde la raíz.
- **Regla anti-pérdida:** nunca DROP/borrado en duro de datos de tenant; archivar renombrando (`_legacy`/`_archived`).

## Render / front (HTML+JS en línea)
- **`\n` dentro de un template-literal que se EMITE a otro `<script>`:** se resuelve a salto de línea real y **parte una cadena entre comillas** del script servido → `SyntaxError: Invalid or unexpected token` → muere TODO el bloque (no solo esa función). Fue el **Inventario en blanco** (bug de la Pieza 2a en `stock-modal.js`): hay que escapar `\\n`. *Lección:* el servidor responde 200 con datos correctos y aun así la pantalla queda en blanco — solo el navegador real lo revela.
- **`innerText` de un elemento oculto (modal) devuelve ''**; usar `textContent` para leer DOM no visible en pruebas headless.
- **Escapar la salida con `escHtml`** o hay XSS almacenado (fue el bug A1 en facturas).

## DISA (de BUGS_DISA.md)
- **Contexto fijo y agregado** dejaba a DISA sin datos para consultas concretas → se añadió `query_database` (SELECT en vivo, tablas de sistema protegidas, máx. 4/mensaje). El contexto de negocio se arma en el chat, no en la carga de página.
- **`case` hardcodeado por entidad** → DISA rechazaba entidades nuevas; se sustituyó por `insert/update/delete_record` sobre `WRITABLE_TABLES`.
- **Filtro de estado inconsistente:** `status='completado'` daba 0 ventas cuando había pedidos `en_preparacion`/`enviado`; usar `NOT IN ('cancelado','reembolsado','borrador')`. Raíz: **estados en inglés** rompieron analítica → estados siempre en español.

## Gates de navegador (puppeteer)

- **RESUELTO (11-jul-2026, commit del runner): 14 gates llevaban ~3 semanas MUERTOS y nadie lo sabía.** Guardaban la ruta de la BD a mano (`/home/ibrahin/bamburu/...`); al migrar el servidor a `/home/ubuntu` murieron todos, y además el Chromium que trae puppeteer no arranca en este ARM. Los que alguien tocó por otra razón (p. ej. `gate-avisos-badge`, 9-jul) se curaron de rebote; los 14 que nadie volvió a tocar siguieron ciegos. **Arreglo:** `scripts/lib/gate-env.mjs` — la ruta se RESUELVE desde la ubicación del script (nunca a mano) y, si falta la BD o el Chromium, el gate **aborta con código 2** y un mensaje que dice que no ha verificado nada.
- ⚠️ **CORRECCIÓN de lo que decía esta ficha el 11-jul por la mañana:** se afirmó que los gates rotos "salen con exit 0 sin imprimir nada". **Es FALSO.** Salían con **exit 1** y una traza en stderr — señalaban su fallo correctamente. El falso verde no lo produjo el gate: lo produjo un **bucle de shell improvisado** que decidía "aprobado" buscando la cadena `✗` en la SALIDA en vez de mirar el **código de salida**. Como la traza no contenía ningún `✗`, los daba por buenos. *La lección real no es "los gates mienten", es "no juzgues un test por lo que imprime".* Ese mismo bucle **saltaba en silencio** `test-transfers` porque asumía extensión `.mjs` y el fichero es `.js`.
- **NO improvises el barrido de regresión: usa `node scripts/run-gates.mjs`** (grupos: `pagos`, `disa`, `inventario`, `avisos`, o `--all`). Manda el **código de salida**, no la salida. Un gate que sale 0 pero no imprime resumen se marca **SOSPECHOSO y cuenta como fallo** (un aprobado se demuestra, no se presume del silencio). Un gate pedido que no existe es error, no un "no pasa nada". Y al final imprime **siempre** la DEUDA: los gates rotos que no se están ejecutando.
- **El Chromium que trae puppeteer NO arranca en este servidor (ARM)**: `chrome-linux64/chrome: Syntax error: newline unexpected`. Usa `launchOpts()` de `lib/gate-env.mjs` (apunta a `/snap/bin/chromium`; se puede forzar otro con `PUPPETEER_EXECUTABLE_PATH`).
- **`page.setCookie()` escribe en el tarro de cookies COMPARTIDO del contexto**: abrir una segunda sesión pisa la cookie `asess` de la primera y las páginas ya abiertas cambian de usuario en silencio (una prueba de permisos se sabotea sola y "demuestra" lo contrario de lo que cree). Para varios usuarios a la vez: **un `browser.createBrowserContext()` por usuario**.
- **No busques un texto en `page.content()` / `body.innerHTML` para saber si algo se pintó**: el `<script>` en línea de la página también está ahí, así que el texto de un botón —o de un `toast()`— casa **aunque no se haya pintado ni ejecutado nada**. Mordió a `gate-recepciones-c1b` (esperaba "Recepción anulada", que vive dentro de su propio script → la espera nunca esperaba). Lee el **DOM renderizado** (`querySelectorAll`, `innerText` del contenedor).
- **Un gate que muta la BD viva tiene que limpiar SIEMPRE, incluso al fallar** (`finally`). `gate-almacenes` no lo hace: crea un almacén en cada pasada, no lo borra, y en la siguiente tropieza con el anterior — sus fallos **cambian de una ejecución a otra**. Los gates de compras dejan órdenes/recepciones si mueren a mitad.
- ⚠️ **La limpieza de los gates borra el DOCUMENTO pero NO su ASIENTO CONTABLE.** Descubierto el 11-jul-2026: el libro (`ledger_entries`) acumulaba apuntes de facturas y pagos **que ya no existen** — 73 asientos huérfanos, de las pasadas del 9, 10 y 11 de julio. Un asiento sin documento no es un dato, es basura contable. **CADA pasada de la regresión de compras deja residuo nuevo** (órdenes, recepciones, asientos huérfanos): tras un barrido, correr **`node scripts/limpiar-residuo-gates.mjs`** (en seco) y **`--hazlo`** para borrarlo. Ese script sigue el GRAFO de dependencias (nunca borra "todo lo de hoy"), recalcula el stock desde el libro y comprueba que cuadra. *El arreglo de fondo —que los gates reviertan su asiento al limpiar— sigue pendiente.*

## Resend / email
- El SDK de Resend devuelve `{ data, error }` y **no lanza excepción**: hay que comprobar `error` explícitamente.

## [PENDIENTE]
- `BUGS_DISA.md` documenta bugs #1–#3 resueltos; [PENDIENTE: revisar si hay entradas más abajo del #3 no recogidas aquí].
