# Auditoría de seguridad — Vectores de ataque reales

**Fecha:** 2026-08-31 · **Tipo:** solo lectura (no se tocó código, datos ni configuración).
**Método:** siete escenarios de ataque, cada uno seguido hasta el fichero, la línea y la función.

## Resumen

| # | Vector | Estado | Solidez | Coste de arreglo |
|---|---|---|---|---|
| 1 | Entrar sin credenciales | Protegido | Sólida | Bajo (2FA obligatoria) |
| 2 | Acceder a datos de otro negocio | Protegido | **Muy sólida** | Medio (`btenant`) |
| 3 | Modificar una factura enviada | Protegido | Sólida en producto | Medio (anclaje AEAT) |
| 4 | Descargar todas las bases | Protegido — ~~expuesto en backups~~ **cifrado (1 sep 2026)** | Sólida | Hecho |
| 5 | Inyección SQL | Protegido | Sólida | — |
| 6 | Robo de sesión | Protegido | Sólida | Alto (CSP) |
| 7 | Manipular backups | **Parcial** (mejora el 1 sep 2026; sigue parcial) | Floja en el histórico | Bajo |

**Patrón:** dentro de la aplicación la seguridad es seria y varias piezas están por encima de lo
habitual. ~~**Todo lo que sale de la aplicación —los ficheros de copia— está sin proteger.**~~

> **⚙️ CORREGIDO EL 1 SEP 2026 — tarea `cifrado-copias-seguridad`.** Se tacha en vez de borrarse, que
> es el método de este repo: el registro existe para reconstruir qué se creía y cuándo.
> Las copias van ahora a un remote **`rclone crypt`** —contenido y **nombres** de fichero y de
> carpeta—, y `scripts/bamburu-backup.sh` **aborta** si el destino no es cifrado.
> **El 4 queda cerrado. El 7 sigue PARCIAL, y el motivo importa:** cifrar impide *editar* una copia
> de forma coherente sin la clave, pero **no** impide *borrarla o sustituirla por basura*. Eso lo
> cierra el manifiesto de huellas del histórico, que es **otra tarea** (`manifiesto-huellas-backups`).
> **Estado operativo:** el código está puesto y probado; crear los dos remotes `crypt` y migrar el
> histórico son pasos de terminal que hace Ibrahin (`deploy/systemd/README.md` §«Cifrado de las
> copias»). Hasta que existan los remotes, las copias abortan con email — a propósito.

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

~~**El agujero real no está en el código:** las copias de los **nueve negocios** viven **sin cifrar**
en dos Google Drive personales. Quien entre en una de esas cuentas se lleva 203 clientes, 922
facturas y —en cuanto un negocio sanitario use el producto— historiales clínicos. Cero referencias a
cifrado en `scripts/bamburu-backup.sh`.~~

~~**Coste: bajo.** `rclone crypt` sobre los dos destinos. **Es la corrección con mejor relación
coste/riesgo de toda la auditoría.**~~

**⚙️ CORREGIDO EL 1 SEP 2026 — tarea `cifrado-copias-seguridad`.** Se hizo lo que decía el párrafo
tachado: `rclone crypt` sobre los dos destinos. Ahora `scripts/bamburu-backup.sh` **exige** que
`BACKUP_REMOTE` sea un remote `crypt` y **aborta con email** si no lo es, así que no hay camino por
el que las copias vuelvan a texto claro en silencio.

**Y los nombres también hablaban.** El listado de Drive decía literalmente
`peluqueria-gil-AAAA-MM-DD.db`, `helados-ibrahin-…`, `inversiones-disan-…`: sin abrir un fichero, la
carpeta publicaba cuántos negocios hay y cómo se llaman. Por eso el cifrado va con
`filename_encryption=standard` y `directory_name_encryption=true`, no solo sobre el contenido.
Medido tras el cambio: en el destino crudo no aparece **ningún** nombre de negocio, ni `.db`, ni
`.tar.gz` — solo cadenas base32.

**Dónde vive la clave:** en `~ubuntu/.config/rclone/rclone.conf`, **no** en `/etc/bamburu.env`, porque
ese fichero entra entero en el `process.env` del proceso web expuesto a Internet y la aplicación no
necesita ese secreto para nada. Más una copia **fuera del servidor** en custodia de Ibrahin: el
riesgo dominante aquí no es que la clave se filtre, es **perderla**. Detalle en
`deploy/systemd/README.md` §«Cifrado de las copias».

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

**Sí detecta**, en `scripts/bamburu-backup.sh`: ~~`verify_uploaded()` (`:101`) compara **tamaño y MD5**
del fichero ya en Drive contra el local~~; prueba de restore real (`:133`) con `PRAGMA
integrity_check`; ante fallo, email + `exit 1` + heartbeat.

> **⚙️ ACTUALIZADO EL 1 SEP 2026 — tarea `cifrado-copias-seguridad`.** `verify_uploaded()` ya no pide
> el MD5 a Drive: un remote `crypt` **no expone huellas**, y pedírselas y creerse el silencio habría
> apagado la verificación **en verde** (era el fallo más probable de aquella tarea, y estaba medido:
> la rama blanda del `else` devolvía 0). Ahora compara tamaño y luego `rclone cryptcheck`, y se añade
> `verify_restored()`, que exige que el fichero **descargado y descifrado** tenga el mismo MD5 que el
> original. Esa segunda mitad es **más fuerte que lo de antes**: `PRAGMA integrity_check` responde
> `ok` también a una base válida pero **distinta** —comprobado sustituyendo el fichero descargado por
> otra base real: `integrity_check` decía `ok` y solo el MD5 lo cazó—.

**No detecta:** esas comprobaciones **solo miran la copia de HOY**. Si alguien edita la copia de hace
cinco días, **nadie vuelve a mirarla**. No hay manifiesto de huellas históricas ni verificación
periódica de las 14 copias. ~~Y como los backups **no están cifrados**, editarlas no exige romper
nada: basta con entrar en la cuenta de Google.~~ **Desde el 1 sep 2026 sí están cifradas**, así que
editar una copia de forma coherente exige la clave. **Pero el vector sigue PARCIAL**, y hay que
decirlo así: cifrar no impide **borrar** una copia ni **sustituirla por basura**, y eso seguiría sin
detectarse. Lo cierra el manifiesto de huellas (`manifiesto-huellas-backups`), que sigue pendiente.

Detalle adicional: la retención (`:164`) borra por antigüedad **pase lo que pase**, incluso si la
subida del día falló.

**Coste: bajo.** Un fichero de huellas SHA-256 por copia, guardado aparte y comprobado en cada pasada
contra las 14. ~~Más el cifrado, que vuelve inútil la manipulación.~~ **El cifrado ya está (1 sep
2026); lo que falta de este vector es exactamente el manifiesto.**

---

## Recomendación única

~~Si solo se hace una cosa de esta auditoría: **cifrar los backups**. Cierra el vector 4 y el 7 a la
vez, es configuración y no programación, y hoy es la mayor exposición real del producto.~~

**✅ HECHO EL 1 SEP 2026 — tarea `cifrado-copias-seguridad`.** Y con una corrección al texto tachado,
porque la auditoría se pasó de optimista en dos cosas:

1. **No cierra «el 4 y el 7 a la vez»: cierra el 4 entero y solo la mitad del 7.** Cifrar impide
   editar una copia de forma coherente sin la clave; no impide borrarla ni sustituirla por basura.
   La otra mitad es `manifiesto-huellas-backups`.
2. **No era «configuración y no programación».** Cifrar sin tocar el código habría **apagado la
   verificación de huellas dejándola en verde**: un remote `crypt` no expone MD5, la función que lo
   pedía se tragaba el error y devolvía OK con un aviso en el log. Es el patrón que `CLAUDE.md` tiene
   escrito con nombre propio —*un censo que dice CERO y no es cierto es peor que no tenerlo, porque
   cierra la pregunta*—. Hubo que reconstruir la verificación entera.
