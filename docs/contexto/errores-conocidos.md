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
- **13 gates apuntan a una ruta MUERTA `/home/ibrahin/bamburu/...`** (el proyecto vive en `/home/ubuntu/bamburu`): `gate-pagos-proveedor`, `gate-pago-cuenta`, `gate-abono-proveedor`, `gate-gasto-proveedor`, `gate-devoluciones-proveedor`, `gate-orden-compra-c1a`, `gate-pago-voz-avisos`, `gate-almacenes`, `gate-recepciones-c1b`, `gate-c1c-diferencias-cierre`, `gate-c2-captura`, `gate-disa-captura-chat`, `gate-disa-dictar-compra`. Mueren al arrancar (`Cannot open database because the directory does not exist`) y **salen con exit 0 sin imprimir nada**: en un bucle de regresión pasan por verdes sin haber ejecutado UNA sola aserción. Detectado el 11-jul-2026; **preexistente en HEAD**, no lo introdujo esa sesión. *Lección:* en un barrido de gates, comprobar el **exit code Y que haya salida**, no solo la ausencia de "✗".
- **El Chromium que trae puppeteer NO arranca en este servidor (ARM)**: `chrome-linux64/chrome: Syntax error: newline unexpected`. Los gates que SÍ funcionan pasan `executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium'`. Copiar ese patrón siempre.
- **`page.setCookie()` escribe en el tarro de cookies COMPARTIDO del contexto**: abrir una segunda sesión pisa la cookie `asess` de la primera y las páginas ya abiertas cambian de usuario en silencio (una prueba de permisos se sabotea sola y "demuestra" lo contrario de lo que cree). Para varios usuarios a la vez: **un `browser.createBrowserContext()` por usuario**.

## Resend / email
- El SDK de Resend devuelve `{ data, error }` y **no lanza excepción**: hay que comprobar `error` explícitamente.

## [PENDIENTE]
- `BUGS_DISA.md` documenta bugs #1–#3 resueltos; [PENDIENTE: revisar si hay entradas más abajo del #3 no recogidas aquí].
