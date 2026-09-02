# Auditoría de seguridad — Vectores de ataque reales

**Fecha:** 2026-08-31 · **Tipo:** solo lectura (no se tocó código, datos ni configuración).
**Método:** siete escenarios de ataque, cada uno seguido hasta el fichero, la línea y la función.

## Resumen

| # | Vector | Estado | Solidez | Coste de arreglo |
|---|---|---|---|---|
| 1 | Entrar sin credenciales | Protegido | Sólida | Bajo (2FA obligatoria) |
| 2 | Acceder a datos de otro negocio | Protegido | **Muy sólida** | Medio (`btenant`) |
| 3 | Modificar una factura enviada | Protegido | Sólida en producto | Medio (anclaje AEAT) |
| 4 | Descargar todas las bases | **ABIERTO** en los backups — ~~«cifrado (1 sep 2026)»~~ (ver §4) | Floja fuera de la app | Bajo — **una orden** |
| 5 | Inyección SQL | Protegido | Sólida | — |
| 6 | Robo de sesión | Protegido | Sólida | Alto (CSP) |
| 7 | Manipular backups | ~~**Parcial** — y la mitad que le tocaba a esta tarea sigue sin encender~~ **⚙️ CERRADO EL 2 SEP 2026 (`manifiesto-huellas-backups`): Protegido — detecta, no impide** | Sólida en el histórico (ver §7) | — (hecho) |

**Patrón:** dentro de la aplicación la seguridad es seria y varias piezas están por encima de lo
habitual. **Todo lo que sale de la aplicación —los ficheros de copia— está sin proteger.**
(Esa frase se tachó el 1 sep 2026 por creerla resuelta; **se destacha el mismo día**, porque no lo
estaba y sigue sin estarlo.)

> ~~**⚙️ CORREGIDO EL 1 SEP 2026.** Las copias van ahora a un remote `rclone crypt` … **El 4 queda
> cerrado.** … Hasta que existan los remotes, las copias abortan con email — a propósito.~~
>
> **⚙️ ESO SE REVIRTIÓ EL MISMO DÍA, Y LA FRASE DE ARRIBA SIGUE SIENDO LA VERDADERA.** Se tacha en
> vez de borrarse, que es el método de este repo: el registro existe para reconstruir qué se creía y
> cuándo. **Todo lo que sale de la aplicación —los ficheros de copia— sigue sin proteger**: los
> remotes `crypt` nunca existieron, la contraseña nunca se generó, y con aquel guardián puesto las
> dos copias de la madrugada habrían abortado. Ibrahin devolvió el destino a claro porque *quedarse
> sin copia es un riesgo mayor que una noche más en claro*.
>
> **Estado a día de hoy (1 sep 2026, tarde):** el mecanismo está **construido y probado**, y se
> enciende con **una orden** de Ibrahin —`bash scripts/cifrar-copias-de-seguridad.sh`—, que crea la
> llave, comprueba que descifra y solo entonces cambia el destino. **Mientras no la ejecute, el
> vector 4 está ABIERTO** y el correo diario de la copia lo dice en palabras: `EN CLARO ⚠️`.
>
> **El 7 sigue PARCIAL, y el motivo importa:** cifrar impide *editar* una copia de forma coherente
> sin la clave, pero **no** impide *borrarla o sustituirla por basura*. Eso lo cierra el manifiesto
> de huellas del histórico, que es **otra tarea** (`manifiesto-huellas-backups`).

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

~~**⚙️ CORREGIDO EL 1 SEP 2026.** Se hizo lo que decía el párrafo tachado … `scripts/bamburu-backup.sh`
**exige** que `BACKUP_REMOTE` sea un remote `crypt` y **aborta con email** si no lo es.~~

**⚙️ ESO NO ERA CIERTO, Y SE CORRIGE EL MISMO 1 SEP 2026.** Se tacha en vez de borrarse, que es el
método de este repo: el registro existe para reconstruir qué se creía y cuándo. Lo que pasó, en
orden: el guardián se puso en el código, pero **los remotes `crypt` nunca llegaron a existir y la
contraseña nunca se generó**, así que las dos copias de la madrugada siguiente **habrían abortado**.
Ibrahin revirtió el guardián —*«los datos actuales son de prueba y que vayan en claro una noche más
no expone nada real; quedarme sin copia sí es riesgo»*— y **hoy las copias van EN CLARO**.

**ESTADO REAL: el vector 4 sigue ABIERTO.** El mecanismo está **construido y probado** (el script
sabe funcionar cifrado y en claro, sin rama blanda en ninguno de los dos; hay un guion que genera la
llave, crea los destinos, **comprueba que descifra** y solo entonces enciende el cifrado; y un
ensayo que abre la copia partiendo solo de la llave). **Falta la orden que lo enciende**, y la da
Ibrahin: `bash scripts/cifrar-copias-de-seguridad.sh`. Hasta entonces, 203 clientes y 922 facturas
siguen viajando en claro a dos Drive personales.

**Y los nombres también hablan.** El listado de Drive dice literalmente
`peluqueria-gil-AAAA-MM-DD.db`, `helados-ibrahin-…`, `inversiones-disan-…`: sin abrir un fichero, la
carpeta publica cuántos negocios hay y cómo se llaman. Por eso el cifrado va con
`filename_encryption=standard` y `directory_name_encryption=true`, no solo sobre el contenido.
**Medido en una pasada completa contra un destino cifrado de laboratorio** (1 sep 2026): en el
destino crudo no aparece **ningún** nombre de negocio, ni `.db`, ni `.tar.gz` — solo cadenas base32,
con los directorios también cifrados. En producción eso será cierto **el día que se ejecute el
guion**, no antes.

**Y el histórico no caduca solo.** Medido: un fichero con nombre sin cifrar dentro de la raíz de un
remote `crypt` se **salta** con código de salida 0, al listar **y al borrar**. En cuanto el destino
pase a `crypt`, la retención de 14 días no volverá a tocar nunca los objetos que ya están en claro:
o se migran (`--migrar-historico`) o se quedan ahí para siempre. Sin ese paso, el vector 4 **no está
cerrado** aunque las copias nuevas vayan cifradas.

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

## 7 · Manipular el backup — ~~PARCIALMENTE VULNERABLE~~ HISTÓRICO VIGILADO (2 sep 2026); el cifrado (§4) sigue sin encender

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

~~**No detecta:** esas comprobaciones **solo miran la copia de HOY**. Si alguien edita la copia de
hace cinco días, **nadie vuelve a mirarla**. No hay manifiesto de huellas históricas ni verificación
periódica de las 14 copias. Y como los backups **no están cifrados**, editarlas no exige romper nada:
basta con entrar en la cuenta de Google.~~

~~**Desde el 1 sep 2026 sí están cifradas**, así que editar una copia de forma coherente exige la
clave.~~ **⚙️ CORREGIDO EL 2 SEP 2026: esa frase era falsa el día en que se escribió.** Se tacha en
vez de borrarse, que es el método de este repo. No hay remotes `crypt` (comprobado el 2 sep 2026:
`rclone listremotes` sigue devolviendo exactamente `gdrive:` y `gdrive_gili:`) y **las copias siguen
yendo EN CLARO** — el correo diario lo dice en palabras (`EN CLARO ⚠️`). El §4 de este mismo documento
ya lo tenía bien; esta frase del §7 se había quedado desincronizada con él.

**⚙️ CERRADO EL 2 SEP 2026 (`manifiesto-huellas-backups`) — SÍ DETECTA, en el histórico entero, no
solo hoy.** `scripts/lib/manifiesto-copias.mjs`, llamado desde `scripts/bamburu-backup.sh` tras subir
y verificar y **antes** de la retención, anota cada artefacto en un fichero de huellas SHA-256
encadenado por hash —guardado aparte, en `~/.local/state/bamburu-backup/`, no dentro de la copia— y
**recorre TODA la ventana de retención en cada pasada, sin descargar nada**: pregunta al destino la
huella que él mismo calculó (funciona igual en claro y en cifrado, así que el día en que Ibrahin
encienda el cifrado esto no se queda ciego). Si un objeto del histórico cambió, o falta con menos de
`RETENTION_DAYS-1` días de edad, la pasada de esa noche **no ejecuta la retención** (no se borra la
evidencia por antigüedad) y el correo pasa a 🚨.

**Y la vigilancia no se pierde cuando el destino cambia** (se enciende el cifrado sin migrar el
histórico, por ejemplo): un objeto que se queda en el destino ANTERIOR no se declara huérfano ni
dispara una alarma falsa — se sigue comprobando **donde está**, contra ese mismo destino, mientras
siga dentro de la ventana de retención, y si alguien lo manipula allí la alarma salta igual, con su
nombre. Si el destino anterior deja de contestar (se retira el remote), tampoco es alarma ni
silencio: queda dicho en el correo como «sin vigilar». Detalle en `deploy/systemd/README.md`
§«Manifiesto de huellas del histórico».

**Y lo que sigue sin cubrir, dicho sin adornarlo:** el manifiesto vive en **este mismo servidor**, así
que quien controle el servidor puede reescribirlo entero. Contra eso está el ancla del correo diario
—la cabeza de la cadena y el SHA-256 de cada artefacto de hoy viajan también ahí, a un buzón que el
servidor no puede reescribir—, que es defensa **contra la cuenta de Drive comprometida** (el vector
que este apartado audita) y prueba forense contra el servidor comprometido, pero no impide una
reescritura hecha con acceso al servidor. **El manifiesto detecta manipulación y borrado; no los
impide.** Y sigue sin cubrir lo que nunca fue su trabajo: un servidor comprometido puede seguir
borrando `data/` entera sin que esto avise (eso es lo que vigilan las copias en sí, no este fichero).

Detalle adicional: la retención (`:164`) borra por antigüedad **pase lo que pase**, incluso si la
subida del día falló. Sigue sin arreglarse aquí — es la tarea `retencion-backup-fallo-parcial`.

~~**Coste: bajo.** Un fichero de huellas SHA-256 por copia, guardado aparte y comprobado en cada
pasada contra las 14. Más el cifrado, que vuelve inútil la manipulación.~~ **Hecho el 2 sep 2026.** Lo
que queda de este vector, y no es poco, es el cifrado (§4): sin él, manipular o vaciar una copia
reciente ya se detecta, pero **leerla** sigue sin exigir nada más que la cuenta de Google.

---

## Recomendación única

~~Si solo se hace una cosa de esta auditoría: **cifrar los backups**. Cierra el vector 4 y el 7 a la
vez, es configuración y no programación, y hoy es la mayor exposición real del producto.~~

~~**✅ HECHO EL 1 SEP 2026 — tarea `cifrado-copias-seguridad`.**~~

> ## ⛔ NO ESTÁ HECHO. LOS VECTORES 4 Y 7 SIGUEN ABIERTOS.
>
> **Corregido el 1 sep 2026, unas horas después de escribir el ✅ de arriba.** Se tacha en vez de
> borrarse. Los hechos, en orden:
>
> - La tarea `cifrado-copias-seguridad` **quedó APARTADA**, no cerrada («el arquitecto declaró la
>   tarea mal planteada»). El mensaje del commit de cierre dice «cierra» porque el gancho usa la
>   misma palabra para cerrar y para apartar — **ese ✅ salió de leer el commit en vez del historial**.
> - El código sí se quedó puesto y vivo, pero **los remotes `crypt` nunca se crearon y la contraseña
>   nunca se generó**. Con el guardián activo, las dos copias de la madrugada siguiente **habrían
>   abortado**: ni cifraba ni copiaba.
> - **Decisión de Ibrahin:** devolver el destino al de siempre para no quedarse sin copia. Las copias
>   van **EN CLARO**, comprobadas a mano ese día (16 archivos en cada una de las dos cuentas, exit 0).
>
> **Sigue siendo la mayor exposición real del producto**, y la recomendación única del texto tachado
> sigue en pie. La tarea se reescribe entera y vuelve a la cola.
>
> **Actualización del 1 sep 2026 (tarde) — replanteamiento construido, NO encendido.** El mecanismo
> ya existe y está probado de punta a punta contra un destino cifrado de laboratorio: la copia sabe
> funcionar en claro y cifrada **sin rama blanda en ninguno de los dos modos**, hay un guion que
> genera la llave, crea los destinos, **comprueba que descifra** y solo entonces cambia el destino
> (si el descifrado falla, deshace y esa noche la copia sale en claro y en verde), y hay un ensayo
> que abre la copia **partiendo solo de la llave custodiada**.
> **Lo que falta es una orden, y la da Ibrahin:** `bash scripts/cifrar-copias-de-seguridad.sh`.
> **Hasta que la ejecute, este ⛔ es la verdad: los vectores 4 y 7 siguen abiertos.**

Lo que sí queda aprendido de aquel intento, y hay que meterlo en la tarea nueva —la auditoría se
pasó de optimista en dos cosas:

1. **No cierra «el 4 y el 7 a la vez»: cierra el 4 entero y solo la mitad del 7.** Cifrar impide
   editar una copia de forma coherente sin la clave; no impide borrarla ni sustituirla por basura.
   La otra mitad es `manifiesto-huellas-backups`.
2. **No era «configuración y no programación».** Cifrar sin tocar el código habría **apagado la
   verificación de huellas dejándola en verde**: un remote `crypt` no expone MD5, la función que lo
   pedía se tragaba el error y devolvía OK con un aviso en el log. Es el patrón que `CLAUDE.md` tiene
   escrito con nombre propio —*un censo que dice CERO y no es cierto es peor que no tenerlo, porque
   cierra la pregunta*—. Hubo que reconstruir la verificación entera.
