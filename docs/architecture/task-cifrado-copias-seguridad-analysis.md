# Análisis — Cifrar las copias de seguridad

- **id:** `cifrado-copias-seguridad`
- **origen:** `TABLERO.md` §TAREAS EN FORMATO DEL ORQUESTADOR → «SIGUIENTE TAREA» (línea 8385)
- **cierra:** vector 4 entero y la mitad silenciosa del vector 7 de `docs/seguridad/vectores-de-ataque.md`
- **fecha del plano:** 1 sep 2026

---

> ## ⚠️ LO QUE ESTA TAREA NECESITA EJECUTAR — ARRIBA DEL TODO, COMO PIDE `RITUAL.md` §3
>
> `RITUAL.md` §3 dice que si una tarea necesita ejecutar algo, se declara **arriba del todo y visible**,
> no enterrado en el criterio 12. Esto es lo que esta tarea necesita ejecutar, y **nada más**:
>
> 1. `rclone` contra las dos cuentas de Drive: crear dos remotes `crypt`, un ensayo en una carpeta de
>    usar y tirar, copiar el histórico y comprobarlo.
> 2. **La copia de seguridad de verdad, a mano, una vez por cuenta** (`scripts/bamburu-backup.sh`).
>    Es el mismo proceso que corre solo cada noche a las 03:33 y 03:35, y es exactamente cómo se
>    verificó S6 el 31 ago (`TABLERO.md:51`: «Primera copia real ejecutada a mano»).
> 3. Un ensayo de restauración con una configuración temporal en `/tmp`.
>
> **NO hace falta —y este plano NO autoriza— ningún barrido de `scripts/run-gates.mjs`,** ni el corto
> ni el completo, ni ningún gate de navegador. Ningún criterio de aceptación de la sección 6 los pide.
> Si Ibrahin no quiere que se ejecute ni la copia a mano, la tarea **no se puede verificar** y hay que
> pararla: cifrar sin comprobar que la copia todavía se restaura sería cambiar un riesgo por otro peor.

---

## 1. Qué está mal hoy

### 1.1 El agujero: 370 MiB de datos de nueve negocios, legibles por cualquiera que entre en un Gmail

`scripts/bamburu-backup.sh:130` sube el artefacto tal cual sale del snapshot:

```bash
"$RCLONE" copy "$snap" "$REMOTE/" 2>&1 | sed 's/^/    /' || true
```

`$REMOTE` es `gdrive:Bamburu-backup/daily` (`scripts/bamburu-backup.sh:32`) para la copia principal y
`gdrive_gili:Bamburu-backup-gili/daily` para la secundaria
(`deploy/systemd/bamburu-backup-secondary.service:15`). Los dos son remotes de **tipo `drive` puro** —
comprobado el 1 sep 2026 leyendo `~/.config/rclone/rclone.conf`: solo hay dos secciones, `[gdrive]` y
`[gdrive_gili]`, ambas `type = drive`. **No existe ningún remote `crypt` en la máquina.**

Medido contra las cuentas reales el 1 sep 2026:

| | Objetos | Tamaño | Contenido |
|---|---|---|---|
| `gdrive:Bamburu-backup/daily` | **228** | **370,3 MiB** | 14 días × 11 artefactos |
| `gdrive_gili:Bamburu-backup-gili/daily` | **22** | **45,8 MiB** | 2 días (empezó el 31 ago) |

Cada día son 11 ficheros: `control.db`, los **9** `data/tenants/*.db` y `uploads-AAAA-MM-DD.tar.gz`.
Dentro van los 203 clientes y las 922 facturas que cita el TABLERO. Un `.db` de SQLite sin cifrar se
abre con cualquier visor: no hay que romper nada.

**Y los nombres también hablan.** Hoy el listado de Drive dice literalmente
`peluqueria-gil-2026-09-01.db`, `helados-ibrahin-2026-09-01.db`, `inversiones-disan-2026-09-01.db`.
Sin abrir un solo fichero, la carpeta ya publica **cuántos negocios hay y cómo se llaman**.

### 1.2 La trampa: si se cifra sin tocar nada más, la verificación de MD5 se apaga sola y en verde

Esto es lo importante del plano, y no está escrito en ningún sitio del repo. La función que verifica
las subidas es `scripts/bamburu-backup.sh:101-112`:

```bash
105  rsize="$("$RCLONE" size "$REMOTE/$name" --json …)"
106  rmd5="$("$RCLONE" hashsum MD5 "$REMOTE/$name" 2>/dev/null | awk '{print $1}')"
…
108  [ "$lsize" = "$rsize" ] || { log "  verify: tamaño difiere …"; return 1; }
109  if [ -n "$rmd5" ]; then [ "$lmd5" = "$rmd5" ] || { log "  verify: MD5 difiere"; return 1; }
110  else log "  verify: Drive no devolvió MD5 (se valida solo por tamaño)"; fi
111  return 0
```

**Un remote `crypt` no expone hashes.** Verificado empíricamente el 1 sep 2026 con una configuración
de usar y tirar en `/tmp` (backend local, sin red, borrada después):

- `rclone hashsum MD5 crypt:fichero` → `ERROR: hash unsupported: hash type not supported`, **código de
  salida 1**, stdout vacío.
- La línea 106 se traga ese error con `2>/dev/null` → `rmd5=""` → **se toma la rama del `else` de la
  línea 110**, que escribe un aviso en el log y **devuelve 0**.
- `rclone size crypt:fichero --json` → **sí** devuelve el tamaño **en claro** (200000 de 200000, el
  fichero cifrado en el backend pesaba 200096). Así que la línea 108 **pasa**.

Resultado de cifrar sin tocar esta función: la copia se da por verificada, el email dice
«subido, verificado y restore OK», y **la comprobación de MD5 ha dejado de existir** sin que nada
falle. Es exactamente el patrón que `CLAUDE.md` tiene escrito con nombre propio:

> **un censo que dice CERO y no es cierto es peor que no tenerlo, porque cierra la pregunta.**

Y encima dejaría mintiendo a cuatro documentos que hoy son ciertos: `CLAUDE.md:23`
(«Las dos verifican MD5»), `deploy/systemd/README.md:110`, `TABLERO.md:29` y
`docs/seguridad/vectores-de-ataque.md:123`.

### 1.3 La segunda trampa: el histórico en claro se vuelve inmortal

Verificado también en la prueba de `/tmp`: cuando un fichero con nombre **sin cifrar** convive en el
directorio de un remote `crypt`, rclone lo **salta**, con un simple aviso y código de salida 0:

```
NOTICE: desarrollo-bamburu-2026-08-20.db: Skipping undecryptable file name: illegal base32 data
```

Eso pasa igual en `rclone ls` que en `rclone delete --min-age 14d`. La retención de
`scripts/bamburu-backup.sh:164` **nunca volvería a tocar los 228 objetos en claro que ya están en
Drive**: se quedarían ahí para siempre, legibles, mientras el panel y los correos dicen que todo va
cifrado. Comprobado: en la prueba, la retención borró los dos ficheros cifrados viejos y dejó el que
tenía nombre en claro.

### 1.4 Lo que hoy SÍ está bien y no se puede romper

- **Una sola pieza sirve a las dos copias** (`scripts/bamburu-backup.sh:27-49`). El TABLERO lo repite
  en mayúsculas: **no se duplica el script**.
- **Prueba de restore real** (`:133-137` y `:152-155`): descarga de vuelta y `PRAGMA integrity_check`.
  El TABLERO manda que siga en pie.
- **`fail_exit`** (`:77-89`): email + ping `/fail` + `exit 1`.
- **El heartbeat vigila cada copia por separado** (`scripts/bamburu-backup-heartbeat.sh:38-41`).
- **La pantalla del superadmin** `modules/superadmin/backups.js:69` lanza **este mismo script** como
  hijo del proceso web, con `env: process.env`. Cualquier cosa que el script necesite y el proceso web
  no tenga, rompe ese botón. Lo tengo en cuenta en la sección 3.

### 1.5 Lo que NO está mal, y por tanto NO se toca en esta tarea

- `scripts/bamburu-backup.sh:164` — la retención borra si **uno** de los artefactos falló. Es real,
  pero es **otra tarea** del TABLERO (`retencion-backup-fallo-parcial`, línea 8447).
- El manifiesto SHA-256 del histórico es **otra tarea** (`manifiesto-huellas-backups`, línea 8431), y
  `docs/auditorias/diagnostico-arquitectonico.md:348` lo dice explícitamente: «va con el cifrado, pero
  es programación y sí entra en el roadmap (C4)».
- Por eso, y para no repetir el error de titular contra cuerpo: **esta tarea cierra el vector 4 entero
  y solo la mitad del 7.** Cifrar hace que nadie pueda *editar* una copia de forma coherente sin la
  clave; **no** hace que alguien no pueda *borrarla o sustituirla por basura*. Eso lo cierra el
  manifiesto de huellas. Quien redacte la entrega tiene que decirlo así.

---

## 2. Cómo lo resuelven los que ya lo resolvieron

### Salesforce — la clave es una pieza con ciclo de vida propia, y perderla es perder los datos

Salesforce Shield Platform Encryption no guarda la clave con el dato: la deriva de un **tenant secret**
que el cliente puede generar, rotar y —en el modelo Bring Your Own Key— aportar él. Lo que importa aquí
no es el HSM, que no aplica a esta escala: es que **Salesforce trata la destrucción de la clave como un
acto explícito y avisado**, porque un dato cifrado con una clave que ya no existe no es un dato, es
ruido. Su documentación obliga a reconocerlo antes de dejarte tocar nada.

**Qué se trae:** la clave es una pieza del sistema con custodia declarada, no un campo del fichero de
configuración que aparece un día. De ahí sale el paso 4 del plan (custodia fuera del servidor) y el
criterio 4 (ensayo de restauración **solo con la contraseña**).

**Qué no se trae:** rotación automática, HSM, BYOK. Con dos destinos y un operador, montar rotación
sería configurabilidad no pedida — prohibida por `CANON.md §5`.

### Odoo — protege el *endpoint*, y delega el cifrado en la infraestructura. Aquí eso no vale

Odoo, en local, expone `/web/database/backup` protegido por la master password (`admin_passwd`), y el
`.zip` que produce **no va cifrado**: el cifrado lo pone la capa de almacenamiento de Odoo Online /
odoo.sh, que es infraestructura suya.

Ese modelo es **exactamente el que Bamburu ya tiene** en la puerta del producto:
`modules/erp/routes/users.js:242` protege la descarga con `requirePerm('backup.download')`, y la
auditoría lo da por bien defendido (`vectores-de-ataque.md:77-80`).

**Y por eso Odoo no aplica a la mitad que falla.** Su premisa es que el destino es infraestructura
gestionada por ellos. El destino de Bamburu son **dos cuentas personales de Gmail**. Odoo, en la misma
situación, tampoco estaría protegido: la lección es que *proteger el endpoint no protege el fichero
cuando el fichero se va de casa*. Es información útil, pero en negativo.

### SAP HANA — cifrado de copias y cifrado en reposo son dos interruptores distintos

HANA separa **data volume encryption** de **backup encryption**: son dos configuraciones
independientes, con su propia *root key*, y se pueden activar por separado. La clave de cifrado de
copias vive en el almacén seguro del sistema (SSFS), y la documentación de SAP es tajante en que esa
root key **hay que respaldarla aparte y guardarla fuera de la base**, porque si se pierde, las copias
no se restauran. Además, HANA mantiene su comprobación de copias (`BACKUP CHECK`) funcionando **con el
cifrado puesto**: cifrar no exime de verificar.

**Qué se trae, y son las tres cosas que más pesan en este plano:**
1. **Copias y reposo son dos interruptores.** Confirma que el orden del TABLERO es el correcto: primero
   `cifrado-copias-seguridad` (lo que sale de la máquina), después `cifrado-en-reposo-bases` (línea
   8468). No hay que juntarlas.
2. **La clave se guarda fuera de lo que protege.** → paso 4 del plan.
3. **El cifrado no come la verificación.** → toda la sección 1.2, y el criterio 2.

---

## 3. La decisión

### Qué se hace

**`rclone crypt` sobre los dos destinos, con nombres de fichero cifrados**, y la verificación de MD5
**reconstruida** para que siga midiendo algo real.

### En qué capa vive

En **ninguna capa del producto**. Esto es operación/respaldo:

- `scripts/bamburu-backup.sh` (script de sistema, ya existente)
- `deploy/systemd/bamburu-backup-secondary.service` (+ su copia instalada)
- `~/.config/rclone/rclone.conf` (secreto, **fuera del repo**)
- documentación

**No se toca `modules/`, ni `core/`, ni ninguna base, ni ninguna migración, ni VERI\*FACTU, ni ninguna
pantalla.** Ni un fichero del producto.

### Qué patrón del propio código se sigue

1. **«Una sola pieza, no dos scripts»** — el patrón de S6 (`TABLERO.md:32-36`,
   `scripts/bamburu-backup.sh:27-36`). El destino entra por `BACKUP_REMOTE` y **ya está**: el cambio de
   cifrado no añade **ni un solo `if` que distinga principal de secundaria**. Sin entorno = principal
   cifrada; la unit de la secundaria cambia una cadena.
2. **«Nada se asume: se comprueba y se NOTIFICA»** — la cabecera del propio script (`:20`). La
   verificación nueva usa el `fail_exit` que ya existe, no inventa otro camino de error.
3. **«Un censo que dice cero y no es cierto es peor que no tenerlo»** (`CLAUDE.md`) — **se elimina el
   `else` blando de la línea 110.** Si el MD5 no se puede comparar, eso es un **fallo**, no un aviso.
4. **Comprobar la credencial ANTES de instalar** — el patrón textual de S6 (`TABLERO.md:49-52`): ciclo
   suelto (subir, MD5, descargar, borrar) en una carpeta de usar y tirar antes de tocar nada vivo.
   → paso 3 del plan.
5. **Simulacro por defecto** — `scripts/limpiar-restos-de-gates.mjs`, citado en `CLAUDE.md`. La
   migración del histórico se hace con `--dry-run` primero, y el borrado va **detrás** de una
   comprobación en verde.

### Cómo se reconstruye la verificación de MD5 (el núcleo técnico)

Dos comprobaciones, las dos **gratis**, que juntas cubren más que la de hoy:

| | Qué prueba | Coste |
|---|---|---|
| **A. `rclone cryptcheck`** | que lo que hay en Drive es **exactamente el cifrado** del fichero local (compara el MD5 real del objeto de Drive contra el que resulta de cifrar el local con el nonce del propio objeto) | lee la cabecera del objeto; no descarga el fichero |
| **B. MD5 del fichero ya descargado** | que la copia **vuelve descifrada byte a byte idéntica** al original | **cero**: el script ya descarga cada artefacto para el restore-test (`:134` y `:153`) |

Verificado el 1 sep 2026 en la prueba de `/tmp`: `rclone cryptcheck` devuelve **0 con todo correcto y
1 cuando un fichero difiere** (con el fichero local alterado: `hashes differ … 5215efe3… vs 095d9fbd…`,
`exit 1`). Es utilizable como guardián de verdad.

**B es estrictamente más fuerte que lo de hoy**, y conviene decir por qué: hoy el restore-test solo
hace `PRAGMA integrity_check`, que **también responde `ok` a una base válida pero distinta**. Comparar
el MD5 del fichero descargado cierra ese hueco y además demuestra que **la clave configurada descifra**.
Verificado que el orden no importa: `PRAGMA integrity_check` **no modifica el fichero** (MD5 idéntico
antes y después, comprobado con una copia de `data/control.db`).

**Lo único que se pierde:** hoy el MD5 se pide a Drive sin descargar. Con crypt hay que descargar…
pero el script **ya descargaba**. Coste neto: cero.

### Dónde vive la contraseña, y por qué NO en `/etc/bamburu.env`

**Decisión: la contraseña vive SOLO en `~ubuntu/.config/rclone/rclone.conf`** (hoy `-rw------- ubuntu:ubuntu`),
más una copia que **custodia Ibrahin fuera del servidor**.

El motivo es concreto y verificado: `/etc/systemd/system/bamburu.service:12` tiene
`EnvironmentFile=-/etc/bamburu.env`. **Todo lo que se meta ahí acaba en el `process.env` del proceso web
expuesto a Internet**, y de ahí pasaría también al hijo que lanza `modules/superadmin/backups.js:69`
(`env: process.env`). Meter la clave de las copias en `/etc/bamburu.env` sería regalarle a la aplicación
web un secreto que **no necesita para nada**.

Con la clave dentro de `rclone.conf`:
- el proceso web nunca la ve;
- **el botón «Lanzar copia ahora» sigue funcionando sin tocar `backups.js`**, porque el hijo corre como
  `ubuntu` y rclone lee su propio fichero de configuración;
- no se añade **ninguna** variable de entorno nueva a ninguna unit.

**Lo que hay que decir en voz alta, sin adornarlo:** el campo `password` de `rclone.conf` está
**ofuscado, no cifrado**. Verificado: `rclone reveal` devuelve la contraseña original. Quien pueda leer
ese fichero tiene la clave. **Y eso no debilita nada**, porque quien pueda leer ese fichero ya tiene
`data/` entera en claro en el mismo disco (ese es el otro vector, y su tarea: `cifrado-en-reposo-bases`)
**y** los tokens de OAuth de las dos cuentas de Drive, que están en ese mismo fichero. El vector que
esta tarea cierra es **«alguien entra en la cuenta de Google»**, y contra ése la ofuscación local es
irrelevante.

**Una sola contraseña para los dos destinos.** Dos claves duplicarían la custodia sin ganar nada: no
hay ningún escenario en que un atacante tenga una y no la otra, porque las dos viven en el mismo fichero
del mismo servidor. Y el riesgo dominante aquí **no es la fuga de la clave: es perderla.**

### Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **`age` / GPG asimétrico** (el servidor solo tiene la clave pública) | Es **más seguro** —ni el servidor puede descifrar— y por eso mismo **rompe lo que el TABLERO manda conservar**: sin clave privada, la prueba de restore real (`:133-137`) no puede abrir la base y comprobar `integrity_check`. Se cambiaría una exposición por un respaldo sin verificar. Descartada por el criterio explícito de la tarea. |
| **Cifrar el artefacto en local (`gpg -c` / `openssl enc`) y subir el `.gpg`** | Sería criptografía a mano en bash, el restore-test necesitaría descifrar por su cuenta, y **los nombres de fichero seguirían en claro** — los slugs de los nueve negocios siguen publicados. Peor en todo. |
| **Cifrar `rclone.conf` con `rclone config encrypt`** | La contraseña del `.conf` tendría que llegar por `RCLONE_CONFIG_PASS` desde el entorno de la unit → vuelve a `/etc/bamburu.env` → vuelve al proceso web. Y rompería el botón del superadmin. |
| **Cambiar de proveedor a uno con cifrado gestionado (B2 + SSE)** | **Ya lo decidió Ibrahin**: `TABLERO.md:58-60` deja Backblaze medido y **descartado**, «que prefirió una segunda cuenta propia». No se reabre una decisión del dueño. |
| **Adelantar SQLCipher (`cifrado-en-reposo-bases`)** | Es otra tarea, colocada **después** a propósito (`TABLERO.md:8480`), y no cubriría `uploads-*.tar.gz`. SAP confirma que son dos interruptores distintos. |
| **Dejar que el histórico en claro caduque solo en 14 días** | No caduca: la retención **salta los nombres indescifrables** (§1.3). Y aunque caducara, serían 14 días más con 370 MiB legibles, sobre lo que la auditoría llama «la mayor exposición real del producto». |

---

## 4. El plan, paso a paso

> **Convenios que valen para todo el plan.**
> **(a) La contraseña no se imprime NUNCA.** `docs/contexto/errores-conocidos.md:15` cuenta cómo se
> filtró una clave de Anthropic por pasarla como argumento de un `sudo`. Aquí: nada de `sudo` con la
> clave, nada de `echo`, y `rclone obscure` se alimenta **por stdin** —verificado: `rclone obscure -`
> funciona y `rclone reveal` recupera el original—. Todos los `rclone config …` van con `>/dev/null`,
> porque imprimen la sección creada.
> **(b)** Si `rclone config` falla con `read-only file system` sobre `rclone.conf`, **es el aislamiento
> del entorno de la herramienta, no un permiso del sistema**: el fichero es `-rw------- ubuntu:ubuntu`.
> Hay que ejecutarlo sin ese aislamiento.

### Paso 1 — Generar la contraseña y crear los dos remotes `crypt` (una sola invocación de shell)

Todo en **un solo `bash -c`**, para que las variables no salgan nunca del proceso:

```bash
set -euo pipefail
CLAVE="$(openssl rand -base64 32)"
SAL="$(openssl rand -base64 24)"
OBS_CLAVE="$(printf '%s' "$CLAVE" | rclone obscure -)"
OBS_SAL="$(printf '%s' "$SAL" | rclone obscure -)"

rclone config create gdrive_cif crypt \
  remote=gdrive:Bamburu-backup-cif \
  password="$OBS_CLAVE" password2="$OBS_SAL" \
  filename_encryption=standard directory_name_encryption=true >/dev/null

rclone config create gdrive_gili_cif crypt \
  remote=gdrive_gili:Bamburu-backup-gili-cif \
  password="$OBS_CLAVE" password2="$OBS_SAL" \
  filename_encryption=standard directory_name_encryption=true >/dev/null

unset CLAVE SAL OBS_CLAVE OBS_SAL
```

- **La misma contraseña y la misma sal en los dos** (razonado en §3).
- `filename_encryption=standard` tapa los nombres de los negocios. Longitud comprobada: el nombre más
  largo que genera el script es `desarrollo-bamburu-2026-09-01.db` (32 caracteres) → unos 83 cifrados,
  muy por debajo del límite de Drive.
- **Raíz nueva a propósito** (`Bamburu-backup-cif`, `Bamburu-backup-gili-cif`): lo cifrado y lo antiguo
  no comparten carpeta, así no se puede confundir un listado con otro.
- Comprobar sin enseñar secretos: `rclone config show gdrive_cif | grep '^type'` → `type = crypt`.

### Paso 2 — Custodia de la contraseña: **PARADA, la hace Ibrahin**

Este paso no lo puede hacer un agente, y hasta que esté hecho **no se ejecuta el paso 8**.

Ibrahin, en su terminal, lee la contraseña y la guarda **fuera del servidor** (gestor de contraseñas o
papel en un cajón — cualquier sitio que sobreviva a que este servidor desaparezca):

```bash
rclone reveal "$(rclone config show gdrive_cif | awk -F'= ' '/^password =/{print $2}')"
```

**Por qué es una parada y no un detalle:** las copias existen para el día que el servidor no esté. Si
la única copia de la clave vive en el servidor, ese día las copias son ruido. Es la lección de SAP
sobre la root key, y la de Salesforce sobre el tenant secret.

### Paso 3 — Ensayo en una carpeta de usar y tirar (antes de tocar nada vivo)

El patrón de S6: comprobar la credencial **antes** de instalar.

```bash
head -c 300000 /dev/urandom > /tmp/ensayo-cif.bin
rclone copy /tmp/ensayo-cif.bin gdrive_cif:ensayo/
rclone size gdrive_cif:ensayo/ensayo-cif.bin --json     # tamaño EN CLARO: 300000
rclone cryptcheck /tmp gdrive_cif:ensayo --include ensayo-cif.bin   # 0 diferencias, exit 0
rclone lsf gdrive:Bamburu-backup-cif/                   # nombres ILEGIBLES en el Drive crudo
rclone copy gdrive_cif:ensayo/ensayo-cif.bin /tmp/vuelta/ && md5sum /tmp/{,vuelta/}ensayo-cif.bin
rclone purge gdrive_cif:ensayo                          # la prueba limpia lo que crea
```

Lo mismo con `gdrive_gili_cif`. **Todo lo que crea el ensayo se borra**, pase o falle
(`CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra»).

### Paso 4 — `scripts/bamburu-backup.sh`: destino por defecto

Línea **32**:

```bash
REMOTE="${BACKUP_REMOTE:-gdrive:Bamburu-backup/daily}"      # antes
REMOTE="${BACKUP_REMOTE:-gdrive_cif:daily}"                 # después
```

La copia principal no define `BACKUP_REMOTE` en su unit (comprobado en
`/etc/systemd/system/bamburu-backup.service`), así que **el valor por defecto es lo que la gobierna**.
Se conserva la forma `remote:subcarpeta` para que `"$REMOTE/$name"` (líneas 105-106, 130, 134) siga
componiendo igual: `gdrive_cif:daily/control-2026-09-02.db`.

### Paso 5 — `scripts/bamburu-backup.sh`: guardián de «el destino va cifrado»

Detrás de la comprobación de rclone (líneas 91-92), antes de `hc_ping "/start"`:

```bash
# El destino DEBE ser un remote 'crypt'. Sin esto, un BACKUP_REMOTE mal puesto
# devolvería las copias a texto claro sin que nada fallara y con los emails en verde.
REMOTE_NAME="${REMOTE%%:*}"
"$RCLONE" config show "$REMOTE_NAME" 2>/dev/null | grep -q '^type = crypt' \
  || fail_exit "el destino '$REMOTE' no es un remote cifrado (crypt). Copia ABORTADA."
```

`fail_exit` ya manda email, pingea `/fail` y sale con 1 (`:77-89`). **No** se usa `rclone config dump`
ni se imprime la sección: `grep -q` no saca nada por pantalla.

### Paso 6 — `scripts/bamburu-backup.sh`: reconstruir la verificación (el cambio que importa)

**6a. Reescribir `verify_uploaded()` (líneas 101-112).** Queda con dos comprobaciones y **sin ninguna
rama blanda**:

```bash
# Verifica lo que hay en Drive SIN descargarlo. Con un remote 'crypt' no hay MD5 que
# pedir (rclone: "hash unsupported"), así que la comparación de huellas la hace
# cryptcheck: cifra el fichero local con el nonce del propio objeto remoto y compara
# su MD5 real contra el de Drive. La segunda mitad —que la copia VUELVA descifrada
# idéntica— la hace verify_restored(), aprovechando la descarga del restore-test.
verify_uploaded(){  # $1 = ruta local, $2 = nombre remoto
  local local_path="$1" name="$2" lsize rsize
  lsize="$(stat -c%s "$local_path")"
  rsize="$("$RCLONE" size "$REMOTE/$name" --json 2>/dev/null | "$NODE" -e '…igual que hoy…')"
  [ -n "$rsize" ] || { log "  verify: el archivo NO aparece en Drive"; return 1; }
  [ "$lsize" = "$rsize" ] || { log "  verify: tamaño difiere (local $lsize / drive $rsize)"; return 1; }
  "$RCLONE" cryptcheck "$(dirname "$local_path")" "$REMOTE" --include "$name" >/dev/null 2>&1 \
    || { log "  verify: cryptcheck FALLA para $name (lo que hay en Drive no es el cifrado de este fichero)"; return 1; }
  return 0
}
```

- La línea `rmd5=…` y **las líneas 109-110 enteras desaparecen**. Ya no existe ningún camino en el que
  un artefacto se dé por bueno sin comparar huellas.
- `rclone size` a través de crypt devuelve el tamaño **en claro** — verificado —, así que la
  comparación con `stat -c%s` del local sigue siendo válida y **no hay que restar overhead**.
- `--include "$name"` acota `cryptcheck` al artefacto de esta vuelta; `dirname` es `$TMPDIR`, donde
  están los snapshots.

**6b. Añadir `verify_restored()`**, justo debajo:

```bash
# La copia tiene que VOLVER descifrada byte a byte. integrity_check solo dice que la
# base es válida — también lo diría de una base válida pero DISTINTA.
verify_restored(){  # $1 = ruta local original, $2 = ruta del fichero descargado
  local a b
  a="$(md5sum "$1" | awk '{print $1}')"; b="$(md5sum "$2" | awk '{print $1}')"
  [ "$a" = "$b" ] || { log "  restore: el MD5 del fichero descargado NO coincide ($a / $b)"; return 1; }
  return 0
}
```

**6c. Enganchar `verify_restored` en los dos sitios**, entre la descarga y la comprobación de apertura:

- Bases de datos, entre las líneas **134 y 135**:
  ```bash
  "$RCLONE" copy "$REMOTE/$name" "$RDIR/" 2>/dev/null || fail_exit "descarga de restore de $name"
  verify_restored "$snap" "$RDIR/$name" || fail_exit "el restore de $name no coincide con el original (MD5)"
  ic="$(sqlite3 "$RDIR/$name" 'PRAGMA integrity_check;' 2>&1)"
  ```
- Uploads, entre las líneas **153 y 154**: igual, con `verify_restored "$utar" "$RDIR/$uname"`.

Verificado que `PRAGMA integrity_check` no altera el fichero, así que el orden es indiferente; se pone
antes por claridad.

**6d. Sincerar la cabecera del script** (líneas 3-15), que enumera lo que hace: añadir el cifrado, y
cambiar el punto 3 («tamaño + MD5 del archivo YA en Drive») por lo que de verdad se hace ahora.

**No se toca la línea 164** (retención). Es la tarea `retencion-backup-fallo-parcial`.

### Paso 7 — La copia secundaria: una cadena, en dos sitios

`deploy/systemd/bamburu-backup-secondary.service:15`:

```ini
Environment=BACKUP_REMOTE=gdrive_gili:Bamburu-backup-gili/daily   # antes
Environment=BACKUP_REMOTE=gdrive_gili_cif:daily                   # después
```

Y **la copia instalada**, que es la que manda:

```bash
sudo cp deploy/systemd/bamburu-backup-secondary.service /etc/systemd/system/
sudo systemctl daemon-reload
```

*(Nota al margen, no se arregla aquí: la copia instalada de `bamburu-backup.service` no tiene la línea
`Documentation=` que sí está en el repo. No afecta a nada.)*

### Paso 8 — Primera copia real de cada cuenta, a mano

**Requiere el paso 2 hecho.**

```bash
sudo systemctl start bamburu-backup.service           && journalctl -u bamburu-backup -n 80 --no-pager
sudo systemctl start bamburu-backup-secondary.service && journalctl -u bamburu-backup-secondary -n 80 --no-pager
```

Se exige de cada una: **exit 0**, los **11 artefactos** con «subido, verificado y restore OK», y el
email `✅ Backup Bamburu [principal|secundaria] OK`. Después:

```bash
rclone lsf gdrive:Bamburu-backup-cif/ --recursive     # nombres ilegibles
rclone lsf gdrive_cif:daily/                          # los 11 nombres normales, a través de la clave
```

### Paso 9 — Ensayo de restauración **solo con la contraseña**

Demuestra que la clave custodiada basta para recuperar, sin depender de `rclone.conf`:

```bash
T=$(mktemp -d); export RCLONE_CONFIG="$T/rclone.conf"
# se teclea la contraseña, no se lee del .conf de producción
rclone config create tmp_drive drive …                       # autorización de Drive (la hace Ibrahin)
rclone config create tmp_cif crypt remote=tmp_drive:Bamburu-backup-cif password=… password2=…
rclone copy tmp_cif:daily/desarrollo-bamburu-$(date +%F).db "$T/"
sqlite3 "$T/desarrollo-bamburu-$(date +%F).db" 'PRAGMA integrity_check;'   # -> ok
rm -rf "$T"
```

*(La autorización de Drive de esta configuración temporal la hace Ibrahin, como en S6; el objetivo es
probar que la contraseña sola descifra.)*

### Paso 10 — Migrar el histórico y retirar el texto claro

**El orden no es negociable: copiar → comprobar → y solo entonces retirar.**

```bash
# 10.1 copiar (conserva las fechas de modificación, así la retención sigue contando igual)
rclone copy gdrive:Bamburu-backup/daily/ gdrive_cif:daily/ --progress
rclone copy gdrive_gili:Bamburu-backup-gili/daily/ gdrive_gili_cif:daily/ --progress

# 10.2 comprobar: tiene que decir 0 diferencias y salir con 0
rclone cryptcheck gdrive:Bamburu-backup/daily gdrive_cif:daily; echo "rc=$?"
rclone cryptcheck gdrive_gili:Bamburu-backup-gili/daily gdrive_gili_cif:daily; echo "rc=$?"

# 10.3 SOLO si 10.2 salió 0 en las dos — primero en simulacro
rclone delete gdrive:Bamburu-backup/daily/ --dry-run
rclone delete gdrive:Bamburu-backup/daily/
rclone delete gdrive_gili:Bamburu-backup-gili/daily/ --dry-run
rclone delete gdrive_gili:Bamburu-backup-gili/daily/
```

**Por qué esto NO choca con «nunca destruir datos» de `CLAUDE.md`.** No es una destrucción: es un
traslado. Los mismos 250 objetos siguen existiendo, en la misma cuenta, verificados uno a uno por
`cryptcheck` como idénticos, dentro del contenedor cifrado. **Si `cryptcheck` no da 0 en las dos
cuentas, el paso 10.3 no se ejecuta y la tarea se para y pregunta.**

### Paso 11 — Sincerar la documentación

`CLAUDE.md` obliga: cuando cambia el titular, se revisa el cuerpo. Ficheros y líneas exactas:

| Fichero | Qué dice hoy y hay que corregir |
|---|---|
| `CLAUDE.md:23` | «Las dos verifican MD5 y hacen prueba de restore real» → añadir que van **cifradas**, y describir la verificación real (cryptcheck + MD5 del restaurado). Añadir dónde vive la clave y que hay copia fuera del servidor. |
| `deploy/systemd/README.md:110` | «compara tamaño + MD5 del archivo YA en Drive» — deja de ser cierto. |
| `deploy/systemd/README.md:150` | `rclone ls gdrive:Bamburu-backup/daily/` — ese listado ya no existe. |
| `deploy/systemd/README.md:157-161` | **Restauración**: hay que restaurar por el remote `crypt`, y **hace falta la contraseña**. Es la sección que alguien leerá con prisa un día malo: tiene que decir dónde está la clave. |
| `deploy/systemd/README.md:180` | La tabla de variables de S6: los dos `BACKUP_REMOTE` cambian. |
| `deploy/systemd/README.md:244` | `rclone ls gdrive_gili:Bamburu-backup-gili/daily/` — igual. |
| `docs/seguridad/vectores-de-ataque.md:13,16` | Tabla: el 4 pasa a protegido; el **7 sigue PARCIAL** (falta el manifiesto). |
| `docs/seguridad/vectores-de-ataque.md:85-91` | «viven **sin cifrar**… Cero referencias a cifrado» — ya no. |
| `docs/seguridad/vectores-de-ataque.md:121-136` | §7: la manipulación silenciosa se cierra; el histórico sin vigilar **no**. |
| `docs/seguridad/vectores-de-ataque.md:142` | «Si solo se hace una cosa: cifrar los backups» → hecho, con fecha. |
| `TABLERO.md:8385-8406` | Ficha de la tarea → `✅` con fecha y commit, qué se decidió y cómo se verificó. |
| `TABLERO.md:9058` | El `- [ ]` del backlog → `- [x]`. |
| `TABLERO.md:29` | «las dos verifican tamaño y MD5 contra el fichero ya subido» (bloque S6): **es historia fechada, se deja como está**, pero la ficha nueva tiene que decir que esa frase describe el estado anterior. |

También `docs/auditorias/arquitectura-y-estandares.md:43-44` y
`docs/auditorias/comparativa-referentes.md:21-22` afirman «backups sin cifrar». Son **auditorías
fechadas**: no se reescriben, se anota la corrección con su fecha, que es el método del repo.

---

## 5. Riesgos

| # | Riesgo | Cómo se mitiga |
|---|---|---|
| 1 | **Se pierde la contraseña → las copias son ruido.** Es el riesgo dominante, muy por encima de que alguien la robe. | Paso 2 es una **parada**: custodia fuera del servidor antes del paso 8. Paso 9 lo demuestra restaurando **solo con la contraseña**. Criterio 4. |
| 2 | **La verificación se apaga sola y en verde** (§1.2), el fallo más probable de esta tarea. | Paso 6: se **borra** la rama blanda de las líneas 109-110 y se sustituye por `cryptcheck` + MD5 del restaurado. Criterio 2 lo mide con un fallo provocado, no leyendo el código. |
| 3 | **Alguien devuelve `BACKUP_REMOTE` a un destino en claro** y las copias vuelven a texto plano sin que nada chille. | Paso 5: el guardián `type = crypt`; sin él la copia **aborta** con email. Criterio 1. |
| 4 | **El histórico en claro se queda inmortal** porque la retención salta los nombres indescifrables (§1.3, verificado). | Paso 10: se migra y se retira explícitamente. Criterio 5. |
| 5 | **Se pierden copias al migrar el histórico** (250 objetos, 416 MiB entre las dos cuentas). | Orden estricto copiar → `cryptcheck` 0 diferencias → simulacro → borrar. Si `cryptcheck` no da 0, **no se borra y se pregunta**. |
| 6 | **Ventana sin respaldo durante la migración.** | No existe: el histórico en claro sigue en su sitio hasta el paso 10, que va **después** de que las copias cifradas del paso 8 estén verificadas. Si el paso 8 falla, `fail_exit` avisa por email y no se ha destruido nada. |
| 7 | **El botón «Lanzar copia ahora» del superadmin** (`modules/superadmin/backups.js:69`) deja de funcionar. | **Imposible por diseño**: no se añade ninguna variable de entorno, así que el hijo no necesita nada que el proceso web no tenga. Es la razón principal de no meter la clave en `/etc/bamburu.env`. `backups.js` **no se toca**. |
| 8 | **El heartbeat empieza a mentir** (`bamburu-backup-heartbeat.sh`). | No se toca: `BACKUP_SUFFIX` y las marcas `last-success{,-secondary}` (líneas 40-41 del script de backup) no cambian. Si la copia cifrada falla, no escribe marca y el heartbeat avisa a las 48 h como siempre. |
| 9 | **La contraseña se filtra en un log, en el journal o en la transcripción del agente.** | Nada de `sudo` con la clave (`docs/contexto/errores-conocidos.md:15`), `rclone obscure` **por stdin** (verificado), todos los `rclone config` con `>/dev/null`, y el paso 2 lo ejecuta Ibrahin en su terminal. Criterio 6. |
| 10 | **Cuota de Drive durante la migración**, con el histórico duplicado. | Medido: principal 10,38 GiB usados + 370 MiB temporales; secundaria 5,38 GiB + 46 MiB. Holgado. |
| 11 | **Nombres de fichero demasiado largos** al cifrarlos. | Medido: el más largo es de 32 caracteres → ~83 cifrados, contra el límite de 255 de Drive. |
| 12 | **VERI\*FACTU / datos de tenant / migraciones.** | **Riesgo cero, y conviene dejarlo escrito:** esta tarea no toca ninguna base, ninguna tabla, ninguna migración, ni `modules/`, ni `core/`, ni una sola pantalla. Solo lee las bases (snapshot) igual que ya hacía. |
| 13 | **`rclone cryptcheck` con origen remoto** (paso 10.2) solo está verificado por mí con origen local. | El paso 3 (ensayo) y el 10.2 se ejecutan y se mira el código de salida antes de borrar nada. Si `cryptcheck` no admitiera ese uso, la alternativa es `rclone check --download` entre las dos rutas; en ningún caso se borra sin una comprobación en verde. |

---

## 6. Criterios de aceptación

- [ ] `scripts/bamburu-backup.sh` **aborta** si el destino no es un remote `crypt`: con `BACKUP_REMOTE=gdrive:Bamburu-backup/daily` el script sale con código **1** y el log dice que el destino no es cifrado, sin subir ningún artefacto.
- [ ] **No queda ningún camino que dé una copia por buena sin comparar huellas:** `grep -n "hashsum MD5\|se valida solo por tamaño" scripts/bamburu-backup.sh` no devuelve nada, y alterando un byte del artefacto descargado en `$RDIR` la pasada termina con código **1** y el mensaje de MD5 que no coincide.
- [ ] Una ejecución real de **cada** copia (`bamburu-backup.service` y `bamburu-backup-secondary.service`) termina con código **0** y **11 artefactos** «subido, verificado y restore OK»; y `rclone lsf gdrive:Bamburu-backup-cif/ --recursive` no devuelve **ningún** nombre que contenga `.db`, `.tar.gz` ni el nombre de un negocio (`peluqueria-gil`, `helados-ibrahin`, `inversiones-disan`, …).
- [ ] **Ensayo de restauración solo con la contraseña:** con una configuración temporal en `/tmp` creada tecleando la contraseña custodiada (sin usar `~/.config/rclone/rclone.conf`), se descarga un `.db` de tenant del día y `sqlite3 … 'PRAGMA integrity_check;'` responde exactamente `ok`.
- [ ] **El histórico ya no está en claro:** `rclone cryptcheck` devolvió 0 diferencias y código 0 en las dos cuentas **antes** del borrado, y después `rclone lsf gdrive:Bamburu-backup/daily/` y `rclone lsf gdrive_gili:Bamburu-backup-gili/daily/` devuelven **0 objetos**, mientras `rclone lsf gdrive_cif:daily/` y `rclone lsf gdrive_gili_cif:daily/` devuelven los 250 originales.
- [ ] **La contraseña no está en ningún sitio versionado ni compartido:** `git grep` de la contraseña en el árbol y en el historial no la encuentra, `/etc/bamburu.env` no tiene ninguna variable nueva, y `journalctl -u bamburu-backup -u bamburu-backup-secondary --since today` no la contiene.
- [ ] **Documentación sincerada:** ni `CLAUDE.md:23`, ni `deploy/systemd/README.md` (puntos 110, 150, 157-161, 180, 244), ni `docs/seguridad/vectores-de-ataque.md` (tabla y §4) siguen afirmando que las copias van en claro o que se compara el MD5 contra Drive; el vector 7 sigue declarado **PARCIAL** con el motivo escrito (falta `manifiesto-huellas-backups`); y la ficha del TABLERO (líneas 8385-8406 y el `- [ ]` de la 9058) queda cerrada con fecha y commit.
