# Auditoría de seguridad — arranque del Eje C

**Fecha:** 2026-07-15 · **Tipo:** solo lectura (no se tocó, cambió ni borró código). · **Alcance:** todo el
repo (`core/`, `modules/`, `scripts/`, `index.js`), configuración legible sin `sudo` (Caddyfile, units
systemd), y `npm audit`. · **Método:** cuatro barridos paralelos por áreas + verificación directa del autor
del bug de Verifactu y de los hallazgos MEDIA que se firman aquí.

> **Postura general: BUENA.** No hay ningún agujero crítico explotable de forma anónima y remota. El
> aislamiento entre inquilinos es sólido y falla cerrado, DISA no escapa de su lista de tablas escribibles,
> los backups están montados y funcionando, y el transporte/cabeceras están casi completos. Los hallazgos
> son **una integridad legal a blindar (ALTA)**, un puñado de **refuerzos MEDIA** (XSS almacenado, una
> dependencia con CVE, el superadmin sin 2FA, fugas de error, sesiones que no se revocan) y varios BAJA.
> Cada hallazgo lleva su file:line, impacto real y esfuerzo. Lo que no se pudo verificar se marca como tal.

## Resumen (ordenado por gravedad)

| # | Sev | Hallazgo | Dónde | Esfuerzo |
|---|-----|----------|-------|----------|
| A1 | **ALTA** | Cadena Verifactu se encadena por `id` sin filtrar por NIF del emisor | `verifactu.js:98`, `verifactu-envio.js:426` | bajo |
| M1 | MEDIA | XSS ALMACENADO en varios campos de texto libre (notas, grupos, categorías, descuentos, `<option>`) | `clients.js:560,662` · `categories.js:70` · `discounts.js:166` · `products.js:555,557` · `purchases.js:201` | bajo (por caso) |
| M2 | MEDIA | Dependencia `hono` con vulnerabilidad HIGH (npm audit) | `package.json` / lockfile | bajo |
| M3 | MEDIA | Superadmin SIN 2FA (columnas TOTP muertas) | `superadmin/index.js:99-110`; `control-db.js:115-116` | medio |
| M4 | MEDIA | Fuga de errores SQL/esquema al cliente (`e.message` crudo) | `store/routes.js` · `categories.js` · `purchases.js` · `disa/index.js` (~40 sitios) | medio |
| M5 | MEDIA | Desactivar un usuario NO revoca sus sesiones vivas (ventana ≤24 h) | `core/auth.js:85-90` + `users.js:54` | bajo |
| M6 | MEDIA | `forgot-password` sin rate limit dedicado + enumeración por timing | `routes/auth.js:443,482` | medio |
| M7 | MEDIA | Log de email + estado 2FA en cada login (PII/RGPD + reconocimiento) | `routes/auth.js:204` | bajo |
| M8 | MEDIA | CSP con `'unsafe-inline'` en `script-src` (defensa en profundidad vs XSS) | `core/security-headers.js:34-35` | alto |
| B1 | BAJA | Contraseña generada impresa al provisionar (cuenta desechable) — anti-patrón recurrente | `models.js:621` | bajo |
| B2 | BAJA | `POST /users/:id/permissions` sin allowlist server-side (confía en la UI) | `routes/users.js:94-106` | bajo |
| B3 | BAJA | Reset no invalida otras sesiones/tokens; longitud mínima incoherente (8 vs 10) | `routes/auth.js:604,583` | bajo |
| B4 | BAJA | Login sin lockout por cuenta (solo por IP) | `core/rate-limit.js:23` | medio |
| B5 | BAJA | Cookie `btenant` (cliente) selecciona la BD activa sin auth | `core/tenant-middleware.js:59-65` | bajo |
| B6 | BAJA | Enumeración de emails cross-tenant en `/find-tenant` | `index.js:1187-1210` | medio |
| B7 | BAJA | Scripts de ops imprimen contraseñas por stdout | `scripts/reset-admin.js:36` · `seed-superadmin.mjs:24` · `init-dev.mjs:30` | bajo |
| B8 | BAJA | DISA loguea el SQL generado (valores de WHERE al journal) | `disa/index.js:2558` | bajo |
| B9 | BAJA | Permisos 0644 (world-readable) en 2 BD de tenant (dir padre 0700 lo protege hoy) | `data/tenants/inversiones-disan.db`, `rachibra.db` | bajo |
| B10 | BAJA | Hardening systemd mínimo (`NoNewPrivileges=false`) | `/etc/systemd/system/bamburu.service` | bajo |
| B11 | BAJA | Cookies `btenant`/`store_preview` sin `Secure` (solo dev / Capa 2 congelada) | `index.js:1236` · `store/routes.js:200` | bajo |
| B12 | BAJA | `roles`/`role_permissions`/`user_roles` sembradas pero SIN uso en la aplicación de permisos (código muerto) | `models.js:1904-2017` | bajo |

---

## ALTA

### A1 · La cadena de Verifactu se encadena por `id`, sin filtrar por el NIF del emisor
- **Qué es:** el encadenado de huellas (Tarea 1) y el del envío (Tarea 2) eligen el registro ANTERIOR de
  la cadena leyendo el último por `id`, **sin filtrar por `id_emisor`**:
  - `modules/erp/verifactu.js:98` — `SELECT huella FROM verifactu_registros ORDER BY id DESC LIMIT 1`.
  - `modules/erp/verifactu-envio.js:426` — `SELECT * FROM verifactu_registros WHERE id < ? ORDER BY id DESC LIMIT 1`.
  La tabla `verifactu_registros` SÍ tiene la columna `id_emisor` (`models.js:1221`), pero ninguna de las
  dos consultas la usa: construyen **una sola cadena por BD de tenant**, ignorando qué obligado tributario
  emitió cada registro.
- **Impacto real:** Verifactu exige **una cadena de huellas por obligado tributario (NIF)**. Hoy la
  invariante "un NIF por BD de tenant" se cumple (una BD = un negocio = un `company_config.fiscal_id`), así
  que **no se corrompe nada AHORA MISMO**. Pero la invariante **no está protegida por código**: basta con
  que el `company_config.fiscal_id` de un tenant CAMBIE tras haber emitido facturas (corrección de un NIF
  mal tecleado, reestructuración) — cosa que Ajustes permite hacer — para que los registros nuevos lleven
  otro `id_emisor` y la cadena enlace **NIF viejo → NIF nuevo**. El resultado es una cadena legal **corrupta
  y silenciosa**, y una vez enviada a la AEAT **no se puede rehacer** (la cadena es inmutable). El mismo
  problema surgiría si el modelo de colaborador social llegara a poner varios obligados en una BD. Es una
  mina de cumplimiento: coste potencial = sanción, no un bug de UI.
- **Esfuerzo:** BAJO. Añadir `AND id_emisor = ?` (el NIF del registro que se está encadenando) a ambas
  consultas, y —como cinturón— una guarda que impida cambiar `company_config.fiscal_id` si ya existen
  registros Verifactu. Conviene un gate que siembre dos NIFs en una BD y afirme que cada cadena es
  independiente.
- **Verificación:** confirmado leyendo el código directamente (no delegado).

---

## MEDIA

### M1 · XSS almacenado en varios campos de texto libre
- **Qué es:** el código escapa con `escHtml` en la mayoría de sitios, pero lo OMITE en varios
  renderizadores de listas y `<option>`, inyectando texto del usuario crudo en el HTML:
  - `modules/erp/routes/clients.js:560` — `c.notes` sin escapar (los campos hermanos SÍ usan `escHtml`).
  - `modules/erp/routes/clients.js:662` — `g.name` + `g.description` (grupos de cliente).
  - `modules/erp/routes/categories.js:70` — `c.name` + `c.description`.
  - `modules/erp/routes/discounts.js:166-169` — `a.name` + `a.condition_value`.
  - `modules/erp/routes/products.js:555,557` — `<option>` de categoría/proveedor (`'...>'+c.name+'</option>'`).
  - `modules/erp/routes/purchases.js:201` — `<option>` de proveedor sin escapar; **en la misma función el
    nombre de almacén SÍ se escapa** (`:204`), lo que evidencia la omisión.
- **Impacto real:** XSS ALMACENADO **dentro del tenant**. Como las cookies de sesión son `HttpOnly`, el
  payload no roba el token de sesión por JS, pero **sí puede leer el token CSRF del DOM y ejecutar acciones
  autenticadas** en la sesión de quien visualiza → escalada de un empleado (con `clients.edit`, o vía DISA
  `edit_client`) al dueño que abre la ficha. No es anónimo: las superficies PÚBLICAS (portal de cliente,
  reseñas, newsletter) sí están escapadas y se verificaron limpias.
- **Esfuerzo:** BAJO por caso (envolver cada campo en `escHtml`). Conviene un barrido de todos los
  `innerHTML`/plantillas server-side buscando concatenaciones sin escape.

### M2 · Dependencia `hono` con vulnerabilidad HIGH
- **Qué es:** `npm audit` reporta 1 vulnerabilidad **high** en `hono`: (a) *IP Restriction bypass for
  non-canonical IPv6* y (b) *Cookie helper no sanea `sameSite`/`priority` → Set-Cookie injection*.
- **Impacto real:** **bajo en la práctica** con el uso actual — Bamburu no usa el middleware de restricción
  por IP de hono (la auth es por sesión, y el rate-limit extrae la IP por su cuenta), y las cookies se
  emiten con `SameSite=Lax` **fijo** (no con valor del usuario), así que la inyección Set-Cookie no tiene
  vector. Aun así es una CVE HIGH viva en una dependencia de borde.
- **Esfuerzo:** BAJO. `npm update hono` a la versión parcheada + correr la regresión. (Solo 1 paquete
  afectado; el resto del árbol está limpio.)

### M3 · El superadmin no tiene 2FA
- **Qué es:** el login de superadmin es solo contraseña → sesión; no hay paso TOTP ni ruta `verify-2fa`
  (`modules/superadmin/index.js:99-110`). El esquema tiene columnas `totp_secret`/`totp_enabled`
  (`core/control-db.js:115-116`) que **nunca se leen** (0 usos de `totp` en `modules/superadmin/`).
- **Impacto real:** la cuenta **más poderosa de la plataforma** (lectura de TODOS los tenants + suspender/
  reactivar negocios + tope de gasto de IA) está protegida solo por contraseña, mientras que los admin de
  tenant SÍ tienen 2FA — asimetría al revés de lo deseable. Mitigado por rate-limit de login (8/15 min),
  cookie separada, cambio de contraseña obligatorio y panel solo en el ápex.
- **Esfuerzo:** MEDIO (cablear el TOTP que el esquema ya contempla).

### M4 · Fuga de errores SQL/esquema al cliente
- **Qué es:** muchos `catch` por-ruta devuelven `e.message` crudo, saltándose el `onError` global (que sí
  está limpio, `index.js:1459`). Los mensajes de better-sqlite3 revelan tablas/columnas/constraints
  (`UNIQUE constraint failed: admin_users.email`, `no such column: …`, `NOT NULL constraint failed: …`).
- **Dónde (representativo):** `modules/store/routes.js` (varios), `routes/categories.js:13-35`,
  `routes/purchases.js:104-128`, `modules/superadmin/{backups,integridad,salud}.js`, y ~30 mensajes de
  acción en `modules/disa/index.js`.
- **Impacto real:** no filtra secretos, pero expone el esquema interno y la estructura SQL → facilita mapear
  la BD y afinar abusos. Divulgación de información.
- **Esfuerzo:** MEDIO (centralizar el saneado del error antes de devolverlo; no pasar `e.message` de errores
  de BD al cliente).

### M5 · Desactivar un usuario no revoca sus sesiones vivas
- **Qué es:** `getAdminSession` hace `JOIN admin_users` **sin filtrar `active=1`** (`core/auth.js:85-90`), y
  `PUT /users` pone `active=0` sin destruir las sesiones del usuario (`routes/users.js:54`).
- **Impacto real:** un empleado desactivado/despedido conserva **acceso completo hasta 24 h** (la sesión
  caduca a las 24 h absolutas). No puede re-loguear —el login sí filtra `active=1`— pero la sesión abierta
  sigue válida. (El `role` sí se re-lee en cada request; `active` no.)
- **Esfuerzo:** BAJO (añadir `AND u.active=1` al JOIN, y/o llamar a `destroyAllAdminSessionsForUser` al
  desactivar).

### M6 · `forgot-password` sin rate limit dedicado + enumeración por timing
- **Qué es:** la ruta `POST /forgot-password` (`routes/auth.js:443`) solo la cubre el rate-limit global
  (600/min); no tiene un limitador propio. Además, si el email NO existe retorna de inmediato, y si existe
  hace INSERT + render + llamada de red a Resend (cientos de ms): la diferencia de latencia es un **oráculo
  de enumeración de usuarios** (`auth.js:482` vs `490-513`). El cuerpo de la respuesta SÍ es genérico (bien),
  pero el timing lo delata.
- **Impacto real:** bombardeo de emails de recuperación a una dirección conocida, y enumeración de qué
  emails son cuentas válidas (para dirigir fuerza bruta o phishing).
- **Esfuerzo:** MEDIO (rate-limit dedicado + igualar el tiempo de respuesta exista o no el email).

### M7 · Log de email + estado de 2FA en cada login correcto
- **Qué es:** `console.log('[Login] user:', email, '| totp_enabled:', …, '| has_secret:', …)`
  (`routes/auth.js:204`). El secreto TOTP NO se imprime (solo booleanos), pero sí el **email (PII/RGPD)** y
  **qué cuentas tienen o no 2FA**.
- **Impacto real:** rastro de identidades de clientes en el journal del servicio, y un dato de reconocimiento
  (qué cuentas carecen de 2FA) valioso si los logs se filtran. Es la familia de los dos incidentes previos.
- **Esfuerzo:** BAJO (quitar la línea o reducir a `userId`, sin email ni estado de 2FA).

### M8 · CSP con `'unsafe-inline'` en `script-src`
- **Qué es:** la Content-Security-Policy está presente y bien montada globalmente
  (`core/security-headers.js`, aplicada en `index.js:22`), pero `script-src`/`style-src` llevan
  `'unsafe-inline'` (`security-headers.js:34-35`).
- **Impacto real:** la CSP **no frenaría** un XSS del panel (como los de M1) porque el JS inline está
  permitido. Es la mitigación sistémica que le falta a M1. Mitigado en parte por el escapado de
  `core/escape.js` donde sí se usa.
- **Esfuerzo:** ALTO (mover el JS inline —incluida la inyección de `window.CSRF_TOKEN`— a ficheros externos,
  o usar nonces/hashes por respuesta). Es refactor, no un parche.

---

## BAJA

- **B1 · Contraseña generada impresa al provisionar** (`modules/erp/models.js:621`, bloque semilla de
  `runMigrations`). Cada alta de negocio dispara el bloque → la contraseña de `admin@bamburu.com` cae al
  journal. **Mitigado:** provisioning borra esa cuenta acto seguido (`core/tenant-provisioning.js:79`), así
  que es una credencial desechable que nunca se usa. Pero es el **anti-patrón exacto** de los dos incidentes
  previos. Esfuerzo bajo (no imprimir durante provisioning).
- **B2 · `POST /users/:id/permissions` sin allowlist server-side** (`routes/users.js:94-106`). Acepta
  `permission_ids` arbitrarios del cliente y confía en que la UI oculte los sensibles (`HIDDEN_PERMS`). Un
  owner/admin (o un empleado con `admin.manage_users`) puede conceder cualquier permiso del **catálogo**,
  saltándose la ocultación visual. Acotado: NO puede conceder `company.*`/`backup.*` (no están en el
  catálogo), ni cambiar roles, ni tocarse a sí mismo. Esfuerzo bajo (validar contra allowlist).
- **B3 · El reset no invalida otras sesiones/tokens; longitud mínima incoherente.** Tras cambiar la
  contraseña por reset no se destruyen otras sesiones ni otros tokens de reset pendientes
  (`routes/auth.js:604-608`); un atacante con sesión viva sigue dentro. Y el reset exige mínimo 8
  (`auth.js:583`) frente a 10 del cambio propio (`core/auth.js:205`). Esfuerzo bajo.
- **B4 · Login sin lockout por cuenta.** El freno es 5/15 min por **IP+tenant** (`core/rate-limit.js:23`),
  no por cuenta: un atacante con IPs rotativas no queda frenado contra UNA cuenta. El 2FA (6 dígitos +
  5/15 min) hace inviable el brute-force de 2FA, así que el riesgo se limita a contraseñas de cuentas sin
  2FA. Esfuerzo medio.
- **B5 · Cookie `btenant` selecciona la BD activa sin auth** (`core/tenant-middleware.js:59-65`). Impacto
  nulo para acceso a datos (el binding de sesión tiene precedencia y `adminAuth` revalida el token contra
  `admin_sessions` de esa misma BD → falla cerrado), pero es input de cliente alimentando la selección de
  BD; su seguridad depende del auth aguas abajo. Esfuerzo bajo.
- **B6 · Enumeración de emails cross-tenant en `/find-tenant`** (`index.js:1187-1210`). Revela si un email
  es admin y en qué negocios (abre cada .db activa en readonly). Rate-limited (10/min, 60/h). Divulgación
  menor, no rompe aislamiento. Esfuerzo medio.
- **B7 · Scripts de ops imprimen contraseñas** (`scripts/reset-admin.js:36`, `seed-superadmin.mjs:24`,
  `init-dev.mjs:30`). Uso manual, todas fuerzan cambio de contraseña; el riesgo es el scrollback/historial
  del terminal, o que se ejecuten bajo un contexto que capture stdout. Esfuerzo bajo.
- **B8 · DISA loguea el SQL generado por el modelo** (`disa/index.js:2558`). El tool bloquea las tablas
  sensibles (`admin_users`, `admin_sessions`, `password_reset_tokens`, `customer_*`, `activity_logs`), así
  que no hay secretos, pero valores de cláusulas WHERE (p. ej. el email de un cliente buscado) llegan al
  journal. Esfuerzo bajo.
- **B9 · Permisos 0644 en 2 BD de tenant** (`inversiones-disan.db`, `rachibra.db`, world-readable) frente al
  0700 del resto. El directorio padre `data/tenants/` está en 0700, así que otro usuario no-root no puede
  atravesarlo hoy; es un fallo de defensa en profundidad si esos permisos de directorio se relajaran.
  Esfuerzo bajo (`chmod 600` + revisar el umask del proceso que los creó).
- **B10 · Hardening systemd mínimo** (`bamburu.service`: `NoNewPrivileges=false`; sin `ProtectHome`,
  `PrivateDevices`, `RestrictAddressFamilies`). Ya corre no-root y en loopback, lo que acota el riesgo.
  Esfuerzo bajo (requiere sudo y probar que `data/` en `/home` sigue escribible).
- **B11 · Cookies sin `Secure` fuera del flujo de sesión** (`index.js:1236` `btenant`;
  `store/routes.js:200` `bamburu_store_preview`). `btenant` solo se emite en dev/Tailscale y lleva un slug,
  no credenciales; `store_preview` es de Capa 2 (congelada). Impacto muy bajo. Esfuerzo bajo.
- **B12 · `roles`/`role_permissions`/`user_roles` sembradas pero sin uso** (`models.js:1904-2017`). Toda la
  aplicación de permisos lee solo `user_permissions`; los roles predefinidos no conceden nada de facto.
  Código muerto, potencial confusión. Esfuerzo bajo (retirar o cablear, decisión de diseño).

---

## Verificado LIMPIO (fortalezas confirmadas — no son hallazgos)

- **Aislamiento entre inquilinos: sólido y fail-closed.** La BD se resuelve por binding de sesión
  (`asess`→tenant en control.db, con precedencia) → cookie `btenant` → subdominio; `adminAuth` revalida el
  token contra el `admin_sessions` de ESA BD, así que sin sesión válida de ese negocio se redirige a login.
  `db_filename` se lee de una columna de control.db tras un match EXACTO del slug (saneado `[a-z0-9-]`),
  nunca se concatena → **sin path traversal**. Ningún endpoint abre otra .db a partir de un id/slug del
  cliente para acceso a datos.
- **DISA nunca escribe fuera de `WRITABLE_TABLES`.** Los tres genéricos (`insert/update/delete_record`)
  validan `WRITABLE_TABLES.has(table)` (Set fijo), columnas por regex y valores parametrizados; están en
  `STRICT_ADMIN_ONLY` (solo owner/admin, gate antes de ejecutar). Sin vía de escritura genérica que se salte
  la lista.
- **Ajustes de empresa NO concedibles a un empleado.** `company.*`, `store_settings.*` y `backup.download`
  **no existen en el catálogo de `permissions`** → no se pueden insertar en `user_permissions`; solo pasan
  por el bypass owner/admin. (Matiz: además del dueño, el rol **admin** también puede — bypass `*`.)
- **Autorización en el servidor.** `requirePerm`/`can()` leen contexto server-side; ninguna ruta de escritura
  con acción privilegiada está protegida solo por sesión (las sin `requirePerm` son autoservicio acotado a
  `session.userId`, o usan `can()` inline).
- **Sin inyección SQL.** Búsquedas parametrizadas; el SQL de DISA pasa por `evaluateQueryAccess` (solo
  SELECT, tablas protegidas denegadas, allowlist para no-admin); better-sqlite3 rechaza sentencias
  múltiples. Las interpolaciones son de constantes (nombres de tabla fijos), no de input.
- **Superficies públicas escapadas.** Portal de cliente, reseñas y newsletter usan `escHtml`; las plantillas
  de email escapan los valores de los huecos (solo el cuerpo, de autoría del dueño, va crudo en un `iframe
  srcdoc` con datos de ejemplo → self-XSS de bajo impacto).
- **Sesión endurecida.** Cookie `asess` `HttpOnly; Secure; SameSite=Lax; Max-Age=86400`; caduca a 24 h
  absolutas; se revoca al cambiar contraseña y al logout. Login y `verify-2fa` con rate-limit dedicado
  (5/15 min) y registro de fallos. Token de reset de 256 bits, 1 hora, un solo uso, respuesta genérica.
- **Superadmin bien separado.** Identidad/cookie/sesiones/CSRF propios; lecturas de tenant en `{readonly,
  fileMustExist}`; única escritura a una .db de tenant es el tope de gasto de IA (sancionada). `apexGuard`
  da 404 en subdominios de negocio.
- **Transporte y cabeceras casi completos.** Caddy con TLS automático (Let's Encrypt), app solo en
  loopback, `X-Real-IP` pisada por el proxy (no falsificable). Cabeceras presentes: CSP (con la salvedad
  M8), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`,
  `Permissions-Policy`. Sin CORS permisivo.
- **Backups: montados, activos y verificados HOY.** `bamburu-backup.sh` hace snapshot consistente (SQLite
  Online Backup API) de control.db + todos los tenants + uploads → Google Drive vía rclone, con
  verificación de subida, **prueba de restore real**, retención 14 días, email y healthchecks; heartbeat
  independiente. Timers systemd enabled+active; último éxito 2026-07-15 03:36 UTC. Código en GitHub;
  `data/` y secretos fuera de git. Restauración documentada (`deploy/systemd/README.md`).
- **Subida de ficheros bien validada.** Allowlist MIME, límite 12 MB, nombre en disco aleatorio (sin path
  traversal), servido solo con sesión + `purchases.read` + `nosniff` + `no-store`.
- **Secretos:** la clave de Anthropic solo en `core/llm.js` (env → `/etc/bamburu.env`), nunca logueada; el
  token de reset ya NO se loguea; `.gitignore` cubre `.env*`, `*.db`, `data/`, certificados; sin secretos
  hardcodeados; ningún endpoint devuelve `password_hash`/`totp_secret`/token de reset.

## No verificado (fuera del alcance de una revisión de solo lectura sin `sudo`)

- **Redirección http→https efectiva** y escucha real en :80 (es el default de Caddy, no explícito en el
  Caddyfile; requiere probar el runtime).
- **Validez del remoto rclone / token de Google Drive** (`~/.config/rclone/rclone.conf`, fuera del repo).
  Nota de resiliencia (no defecto): destino único = un Google Drive personal, sin segundo proveedor.
- **Contenido de `/etc/bamburu.env`** — no leído a propósito (correctamente fuera del repo y de git).
- **Si un reverse-proxy delante loguea la URL completa** (el token de reset viaja como query param): la app
  no monta logger de acceso, pero un nginx/Caddy con logging de URL sí lo capturaría — depende de la config
  del proxy en runtime.
- **Módulos `store`/`portal` en profundidad ruta a ruta** (públicos, Capa 2 mayormente congelada): se
  revisaron las superficies clave (escapado del portal), no cada endpoint.

## Recomendación de orden de arreglo

1. **A1 (Verifactu)** — cinturón legal, esfuerzo bajo. Filtrar por `id_emisor` en las dos consultas + guarda
   contra el cambio de NIF con registros existentes + gate de dos NIFs.
2. **M2 (hono) + M7 (log de login) + M5 (sesiones al desactivar)** — todos esfuerzo bajo, riesgo real.
3. **M1 (XSS almacenado)** — barrido de escapado, caso por caso (bajo cada uno).
4. **M3 (2FA superadmin) + M4 (fuga de errores) + M6 (forgot-password)** — esfuerzo medio.
5. **M8 (CSP) y los BAJA** — refuerzo/defensa en profundidad, planificar (M8 es refactor).

> Esta auditoría es el **arranque del Eje C (Seguridad)**. No implica cambios de código: es el inventario de
> partida. Cada arreglo se abordará como tarea propia, con su verificación, cuando el dueño lo priorice.

---

## C2 — Verificación con administrador (16 jul 2026)

Verificación con permisos de administrador de los 4 puntos que la revisión de solo lectura dejó como "no
verificado". Solo comprobación (sin cambios de config ni código). **Regla cumplida:** no se imprimió el
VALOR de ningún secreto; del fichero de secretos solo se comprobó el continente; el token de reset se
manejó redactado. **Resultado: los 4 verificados OK. Ningún problema que registrar.**

### 1. Redirect http→https en runtime — ✅ VERIFICADO OK
Petición real por `:80` a Caddy (`curl -sSI --resolve <host>:80:127.0.0.1 http://<host>/`): responde **308
Permanent Redirect → `Location: https://`**, tanto para el apex (`bamburu.com`) como para un subdominio con
ruta y query (`/admin/reset-password?token=…` → `https://…?token=…`, preservando ruta y query). Es el
redirect automático de Caddy (escucha confirmada en `*:80` y `*:443`). La app solo escucha en loopback
(`127.0.0.1:3000`) → no es accesible sin pasar por Caddy/TLS.

### 2. Validez del remoto rclone y llegada real de las copias — ✅ VERIFICADO OK
`rclone listremotes` → `gdrive:`. `rclone about gdrive:` devuelve cuota (100 GiB; 16 usados) → remoto
válido, autenticado y ALCANZABLE. `rclone lsl gdrive:Bamburu-backup/daily` ordenado por fecha: la copia MÁS
RECIENTE es de **hoy 2026-07-16 03:34–03:37** — los 8 archivos (control + 6 tenants + `uploads.tar.gz`)
están en Drive. Distribución DIARIA sin huecos del 05-jul al 16-jul. El journal de `bamburu-backup.service`
confirma el ciclo completo: snapshot consistente → subida → **prueba de restore REAL (descarga +
integrity_check) de cada archivo** → retención 14 días → email OK → "backup completado correctamente (8
archivos)". No se expusieron credenciales del remoto (solo comandos de listado/estado). *(La falsa alarma
inicial —un `tail` con archivos del 03-jul— era orden no cronológico de `lsl`, no un fallo.)*

### 3. Fichero de secretos `/etc/bamburu.env` — ✅ VERIFICADO OK (solo continente)
`stat`: **modo 600, dueño `ubuntu`, grupo `ubuntu`** (635 bytes). Solo lo pueden leer el usuario del
servicio (`ubuntu`, que es quien corre `bamburu.service` vía `EnvironmentFile`) y root. **No es legible por
ningún otro usuario** (ni world- ni group-readable). Presencia de claves comprobada por NOMBRE (nunca por
valor): `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `NOTION_TOKEN`, `HEALTHCHECKS_URL`, `PUBLIC_BASE_DOMAIN`,
`VERIFACTU_PRODUCTOR_NIF`, `VERIFACTU_PRODUCTOR_NOMBRE`. El `CF_API_TOKEN` de Cloudflare que usa el Caddyfile
vive en el ENTORNO de Caddy (referencia `{env.CF_API_TOKEN}`), no en este fichero — correcto (separación
app/proxy). No se leyó ni imprimió ninguna línea de su contenido.

### 4. ¿Un proxy delante registra la URL completa con el token de reset? — ✅ VERIFICADO OK (no ocurre)
El Caddyfile **no tiene directiva `log`** → Caddy no escribe log de accesos (por defecto está desactivado);
`/var/log/caddy/` está vacío. En journald: **0** líneas con `reset-password` en `caddy` y **0** con
`reset-password?token` en `bamburu` (la app ya documentaba en `auth.js` que no lo loguea). El token de
recuperación **no acaba en ningún log**, ni del proxy ni de la app. *Nota menor (no es hallazgo, no se pide
arreglar):* el 308 preserva el token en la cabecera `Location`, y si alguien accediera al enlace por
`http://`, el token viajaría en claro en ese primer salto antes del redirect; mitigado porque los enlaces se
generan con `https` (`PUBLIC_BASE_DOMAIN`) y HSTS está activo.

**Conclusión C2:** los 4 puntos verificados OK. **No hay ningún problema que registrar como tarea nueva.**
