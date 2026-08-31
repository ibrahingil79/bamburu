# Auditoría de seguridad — Vectores de ataque reales

**Fecha:** 2026-08-31 · **Tipo:** solo lectura (no se tocó código, datos ni configuración).
**Método:** siete escenarios de ataque, cada uno seguido hasta el fichero, la línea y la función.

## Resumen

| # | Vector | Estado | Solidez | Coste de arreglo |
|---|---|---|---|---|
| 1 | Entrar sin credenciales | Protegido | Sólida | Bajo (2FA obligatoria) |
| 2 | Acceder a datos de otro negocio | Protegido | **Muy sólida** | Medio (`btenant`) |
| 3 | Modificar una factura enviada | Protegido | Sólida en producto | Medio (anclaje AEAT) |
| 4 | Descargar todas las bases | Protegido / **expuesto en backups** | Floja fuera del producto | **Bajo — cifrar** |
| 5 | Inyección SQL | Protegido | Sólida | — |
| 6 | Robo de sesión | Protegido | Sólida | Alto (CSP) |
| 7 | Manipular backups | **Parcial** | Floja en el histórico | Bajo |

**Patrón:** dentro de la aplicación la seguridad es seria y varias piezas están por encima de lo
habitual. **Todo lo que sale de la aplicación —los ficheros de copia— está sin proteger.**

---

## 1 · Entrar sin credenciales — PROTEGIDO, sólido

| Defensa | Dónde |
|---|---|
| Freno por IP: 5 intentos / 15 min | `modules/erp/routes/auth.js:28` — `loginLimiter` |
| Freno por cuenta, cuenta **fallos, no intentos** | `core/rate-limit.js:146-165` — `registrarFallo` / `throttlePorFallos` |
| bcrypt coste 10 (~61 ms/intento) | `core/auth.js:53` — `bcrypt.compare` · `BCRYPT_COST` |
| 2FA TOTP cuando está activado | `modules/erp/routes/auth.js:323` |

Un acierto **limpia** los fallos (`core/rate-limit.js:165`). El freno por cuenta **ralentiza, nunca
bloquea**: un bloqueo permitiría dejar fuera a un legítimo a propósito. El superadmin **ya tiene
2FA** (`modules/superadmin/index.js:150`, `/verify-2fa`), cerrando M3 de julio.

**Flojo:** el 2FA de usuarios normales es **opcional**, con mínimo de 8 caracteres. Una contraseña
filtrada en otro sitio entra directa. **Coste: bajo** — exigir 2FA a `owner`/`admin`.

## 2 · Acceder a datos de otro negocio — PROTEGIDO, muy sólido

Dos candados independientes:

1. **La sesión manda sobre todo.** `core/tenant-middleware.js:56-60`: la cookie `asess` se resuelve
   contra `tenant_sessions` y ese negocio gana. `btenant` (líneas 65-71) solo actúa **si no hay
   sesión** → no se puede saltar de negocio con una abierta.
2. **La sesión se valida contra la base del propio negocio.** `core/auth.js:85-92`,
   `getAdminSession`: el token se busca en `admin_sessions` **de la BD del tenant resuelto**. Un
   token de un negocio no existe en la base de otro → `return null`. Falla cerrado.

Además `core/auth.js:99-103` expulsa **al instante** a un usuario desactivado, en el punto de lectura
de la sesión, no en la ruta que lo desactiva.

**Flojo (asumido con fecha):** sin sesión, `btenant` elige contra qué base se valida el login. No da
datos, pero permite enumerar correos entre negocios (hallazgo B6). **Coste: medio.**

## 3 · Modificar una factura ya enviada — PROTEGIDO, sólido

Todos los `UPDATE invoices` del producto tocan solo: `status` → `'anulada'`
(`modules/erp/routes/invoices.js:413`) y `'rectificada'` (`:513`), más `project_id`, `due_date`,
`emitted_by`, `tipo_factura`. **Ninguno toca importes, líneas, fechas de emisión, NIF ni huella.**

`verifactu_registros` tiene **un solo `UPDATE`** (`modules/erp/models.js:1557`): relleno de
`id_emisor` cuando está vacío — migración, no camino de usuario.

Detector: `modules/superadmin/integridad.js:34` recorre facturas por serie y comprueba que cada
`prev_hash` enlaza con el hash anterior; si alguien borra o inserta por debajo, salta «el enlace con
la factura anterior está roto».

**Límite honesto:** protege del producto, no de quien tenga acceso al servidor. Con `sqlite3` se
pueden reescribir importes **y recalcular la cadena entera**, porque el algoritmo está en el repo.
**Lo que faltaría:** anclar la cadena fuera. El envío real a la AEAT lo resuelve solo — hoy la cola
está dormida y nunca ha remitido nada.

## 4 · Descargar todas las bases — PROTEGIDO en producto, EXPUESTO en backups

Existe una ruta que descarga la base entera del negocio:
`modules/erp/routes/users.js:242` → `api.get('/backup', requirePerm('backup.download'), …)`.
Bien defendida (permiso explícito, no basta con estar dentro) y **solo entrega la base propia**,
porque `c.get('db')` ya viene resuelto por el middleware. **No hay ninguna ruta que entregue las
nueve.**

Ficheros locales correctos: `data/` **700**, `control.db` **700**, `/etc/bamburu.env` y
`rclone.conf` **600**, todo de `ubuntu`.

**El agujero real no está en el código:** las copias de los **nueve negocios** viven **sin cifrar**
en dos Google Drive personales. Quien entre en una de esas cuentas se lleva 203 clientes, 922
facturas y —en cuanto un negocio sanitario use el producto— historiales clínicos. Cero referencias a
cifrado en `scripts/bamburu-backup.sh`.

**Coste: bajo.** `rclone crypt` sobre los dos destinos. **Es la corrección con mejor relación
coste/riesgo de toda la auditoría.**

## 5 · Inyección SQL — PROTEGIDO, sólido

Revisadas una a una las **11 consultas de producción** con interpolación en template-literal:

- `modules/portal/portal.js:136,140` → `${col}` de un ternario cerrado (`visto_negocio`/`visto_cliente`).
- `modules/erp/conciliacion.js:317` → `${tabla}` de otro ternario cerrado.
- `modules/erp/usuarios-baja.js:63` → `${tabla}` y `${col}` de una **lista escrita a mano** en el fichero.
- `modules/erp/verifactu-cola.js:159` → interpola `?,?,?` generados, no valores.

**Ninguna recibe entrada del usuario.** Todo lo demás son sentencias preparadas con parámetros.

DISA, la superficie más expuesta, tiene doble candado: `TABLE_READ_PERMS` como allowlist
(`modules/disa/index.js:61`) y —desde el Saneamiento 2— **la vía genérica de escritura retirada del
todo** (`:256`): solo acciones dedicadas, con permisos reales y confirmación humana.

## 6 · Robo de sesión — PROTEGIDO, sólido

Cookie con las tres banderas (`modules/erp/routes/auth.js:332` y `:386`):
`asess=…; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`.

CSRF real, no solo generado: `core/csrf.js:6` define `csrfProtect()`, que deja pasar
GET/HEAD/OPTIONS y **exige token en todo lo demás** (`:34`, contra `session.csrfToken`). Montado en
`modules/erp/routes/index.js:60`. El superadmin tiene el suyo en `modules/superadmin/index.js:91`.

**Flojo:** la sesión dura **24 h fijas sin renovación por actividad** (`core/auth.js:74`), y la CSP
mantiene `unsafe-inline` (8 usos en `core/security-headers.js`). Un XSS almacenado podría actuar en
nombre del usuario aunque no lea la cookie. **Coste de la CSP: alto** (hallazgo M8, abierto).

## 7 · Manipular el backup — PARCIALMENTE VULNERABLE

**Sí detecta**, en `scripts/bamburu-backup.sh`: `verify_uploaded()` (`:101`) compara **tamaño y MD5**
del fichero ya en Drive contra el local; prueba de restore real (`:133`) con `PRAGMA
integrity_check`; ante fallo, email + `exit 1` + heartbeat.

**No detecta:** esas comprobaciones **solo miran la copia de HOY**. Si alguien edita la copia de hace
cinco días, **nadie vuelve a mirarla**. No hay manifiesto de huellas históricas ni verificación
periódica de las 14 copias. Y como los backups **no están cifrados**, editarlas no exige romper nada:
basta con entrar en la cuenta de Google.

Detalle adicional: la retención (`:164`) borra por antigüedad **pase lo que pase**, incluso si la
subida del día falló.

**Coste: bajo.** Un fichero de huellas SHA-256 por copia, guardado aparte y comprobado en cada pasada
contra las 14. Más el cifrado, que vuelve inútil la manipulación.

---

## Recomendación única

Si solo se hace una cosa de esta auditoría: **cifrar los backups**. Cierra el vector 4 y el 7 a la
vez, es configuración y no programación, y hoy es la mayor exposición real del producto.
