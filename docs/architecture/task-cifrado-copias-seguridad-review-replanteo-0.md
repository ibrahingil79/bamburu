❌ RECHAZADO

# Revisión — `cifrado-copias-seguridad` (intento 3)

- **Fecha:** 1 sep 2026
- **Commits revisados:** `40fb41c`, `5834d79`, `dace8e6`, `c7ed05a` (base `173b546`)
- **Análisis pactado:** `docs/architecture/task-cifrado-copias-seguridad-analysis.md`

> **Lo primero, para que no se lea mal:** la parte construida está bien construida, y la he
> ejercitado yo, no me he fiado del informe. El motivo del rechazo **no es el código**. Es que la
> tarea existe para que 203 clientes y 922 facturas dejen de estar en claro en dos Drive personales,
> y **hoy siguen ahí**: los he listado esta mañana, 250 objetos. Además, ahora mismo **no se está
> haciendo ninguna copia**. Lo que falta son cuatro pasos de terminal que este agente no puede dar y
> que están escritos abajo, listos para ejecutar.

---

## 1. Criterios de aceptación

Los siete de `analysis.md` §6, uno por uno.

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | El script **aborta** si el destino no es un remote `crypt`: exit **1**, el log lo dice, y **sin subir ningún artefacto** | **SÍ** | Ejecutado por mí: `BACKUP_REMOTE=gdrive:Bamburu-backup/daily bash scripts/bamburu-backup.sh` → `FALLO: el destino 'gdrive:Bamburu-backup/daily' no es un remote cifrado (crypt). Copia ABORTADA.` · `EXIT=1`. El guardián está en `scripts/bamburu-backup.sh:103-107`, **antes** de `hc_ping "/start"` (:109) y antes de crear `TMPDIR` (:111): no llega a tocar un fichero. Repetido con el destino por defecto real (`gdrive_cif:daily`): mismo resultado |
| 2 | **Ningún camino da una copia por buena sin comparar huellas**: `grep -n "hashsum MD5\|se valida solo por tamaño"` vacío, y un byte alterado en `$RDIR` → exit **1** con el mensaje de MD5 | **SÍ** | `grep` → `rc=1`, **0 coincidencias**. Reproducidas por mí las tres corrupciones, con copias del script en `/tmp` y un `crypt` de usar y tirar sobre backend local: **(C)** byte alterado en el descargado → `restore: el MD5 del fichero descargado NO coincide (856813e8… / d7486709…)` · `EXIT=1`; **(D)** local alterado tras subir, **mismo tamaño** (la comprobación de tamaño pasa) → `verify: cryptcheck FALLA para control-2026-09-01.db` · `EXIT=1`; **(E)** el descargado sustituido por `data/tenants/duniya.db`, base real y válida → `PRAGMA integrity_check` sobre ella responde `ok`, y **solo el MD5 lo caza** · `EXIT=1`. La rama blanda del `else` ya no existe (`verify_uploaded`, `:121-130`) |
| 3 | Ejecución real de **cada** copia con exit **0** y 11 artefactos, **y** `rclone lsf gdrive:Bamburu-backup-cif/ -R` sin ningún nombre legible | **NO** | `rclone listremotes` → solo `gdrive:` y `gdrive_gili:`. **`gdrive_cif` y `gdrive_gili_cif` no existen.** `rclone lsf gdrive:Bamburu-backup-cif/` → `error listing: directory not found`. Las marcas de éxito (`~/.local/state/bamburu-backup/last-success{,-secondary}`) son de las **03:36 y 03:38 de hoy**, anteriores al cambio: ninguna copia ha corrido con este código. **La mitad reproducible sí la he verificado**: pasada completa contra un `crypt` local → `EXIT=0`, **11 artefactos**, y en el almacén crudo **0** nombres con `.db`, `.tar.gz` o nombre de negocio (solo base32, y el directorio también cifrado). Contra Drive, no |
| 4 | **Restauración solo con la contraseña**, con configuración temporal en `/tmp`, y `PRAGMA integrity_check` → `ok` | **NO** | No ejecutable ni ejecutado: no hay remotes `crypt`, luego no hay contraseña que custodiar ni que teclear. No hay constancia de ningún ensayo de restauración por esa vía |
| 5 | **El histórico ya no está en claro**: `cryptcheck` 0 diferencias antes de borrar, y después los dos listados en claro con **0 objetos** | **NO** | Listado por mí contra las cuentas reales hoy: `rclone lsf gdrive:Bamburu-backup/daily/` → **228 objetos**, `rclone lsf gdrive_gili:Bamburu-backup-gili/daily/` → **22 objetos**. **250 objetos siguen en claro**, con nombres legibles (`peluqueria-gil-…`, `helados-ibrahin-…`, `inversiones-disan-…`). Es exactamente el estado que describe `analysis.md` §1.1 |
| 6 | La contraseña **no está en nada versionado**, `/etc/bamburu.env` sin variables nuevas, y no aparece en el journal | **SÍ** | `git grep -nE "password *= *[A-Za-z0-9+/_-]{10,}"` fuera de `.md` → vacío; en el rango `173b546..HEAD` sobre `scripts/` y `deploy/` solo aparecen **referencias a variables y marcadores** (`password="$OBS_CLAVE"`, `password=<contraseña custodiada>`), nunca un valor. Ningún commit del rango toca `/etc/bamburu.env`; `git grep` de `RCLONE_CONFIG_PASS`/`CRYPT_PASS`/`BACKUP_CRYPT` en `deploy/` y `scripts/` → nada. Las units no ganan ninguna variable. *(Se cumple hoy también porque todavía no existe ninguna contraseña; habrá que releerlo tras el paso 1)* |
| 7 | **Documentación sincerada** en `CLAUDE.md`, `deploy/systemd/README.md`, `vectores-de-ataque.md`, **y la ficha del TABLERO cerrada con fecha y commit** | **NO** (la ficha) | La parte documental está **hecha y bien hecha** — leídos los diffs de `5834d79`: `CLAUDE.md:23` tacha «Las dos verifican MD5» con su fecha y motivo; `README.md` reescribe verificación, restauración y la tabla de secretos, y añade §«Cifrado de las copias»; `vectores-de-ataque.md` pasa el 4 a cerrado y **mantiene el 7 como PARCIAL con el motivo escrito** (falta `manifiesto-huellas-backups`); las dos auditorías se anotan con fecha en vez de reescribirse. **Lo que no se cumple es la última frase del criterio:** la ficha (`TABLERO.md:8385`) queda como `⚠️ código HECHO · operación PENDIENTE`, no cerrada |

**Resultado: 3 SÍ, 4 NO** (3, 4, 5 y la ficha del 7).

Sobre el 7, y que quede claro porque el programador merece que se le diga: **no cerrar la ficha fue lo
correcto**. Cerrarla con 250 objetos en claro en Drive sería justo el «verde que miente» que esta tarea
venía a matar. Ahí el criterio estaba mal escrito, no la entrega. Cuenta como NO porque la tarea no
está terminada, no porque el programador se equivocara.

---

## 2. ¿Se construyó lo que decía el análisis?

Sí, en la parte que el análisis asignaba al código, y sin desviarse:

| Paso del plano | Estado |
|---|---|
| 4 · destino por defecto | Hecho — `scripts/bamburu-backup.sh:41` → `gdrive_cif:daily` |
| 5 · guardián `type = crypt` | Hecho — `:103-107`, con `grep -q` (no imprime la sección) y `fail_exit` |
| 6a · `verify_uploaded` reconstruida | Hecho — `:121-130`, tamaño + `cryptcheck`, sin rama blanda |
| 6b/6c · `verify_restored` y sus dos enganches | Hecho — `:134-139`, llamada en `:162` (bases) y `:182` (uploads) |
| 6d · cabecera sincerada | Hecho — `:3-29` |
| 7 · unit de la secundaria (repo) | Hecho — `bamburu-backup-secondary.service:15` → `gdrive_gili_cif:daily` |
| 11 · documentación | Hecho |
| 1, 2, 3, 8, 9, 10 · operación | **No ejecutados** |

**No se tocó nada del producto**: ni `modules/`, ni `core/`, ni una base, ni una migración, ni una
pantalla. El riesgo 12 del análisis (VERI\*FACTU / datos de tenant) se mantiene en cero — comprobado
con `git show --stat 5834d79`. La línea 193 (retención) no se tocó, como mandaba el plano.

Dos correcciones que el programador hizo al plano y que **doy por buenas y necesarias**: que la tarea
cierra el vector 4 entero y solo la mitad del 7, y que el convenio (b) del análisis («si `rclone
config` falla es aislamiento de la herramienta, no un permiso del sistema») **era falso**. Lo he
confirmado: `sudo -n true` → `The "no new privileges" flag is set`, y escribir en
`~/.config/rclone/` devuelve `read-only file system` incluso a `rclone` (me ha salido el error al
listar Drive, que intenta reescribir el token).

Una desviación, menor, en §4.

---

## 3. Nivel de construcción

Bien. Lo digo con detalle porque el rechazo no va por aquí:

- **Respeta la capa y el patrón.** Una sola pieza para las dos copias, el destino sigue entrando por
  `BACKUP_REMOTE`, y el cambio **no añade ni un `if` que distinga principal de secundaria**. El error
  nuevo va por el `fail_exit` que ya existía, no por un camino inventado.
- **Cada pieza hace una cosa.** `verify_uploaded` mira lo subido; `verify_restored` mira lo que
  vuelve. Se pueden leer y probar por separado — de hecho las he probado por separado (C/D/E cazan
  cada una por su función).
- **Sin números ni rutas a mano** donde debería haber configuración: el destino es una variable, el
  guardián deriva el nombre del remote de la propia variable (`${REMOTE%%:*}`), y no se añade
  ninguna clave al código.
- **Repetible sin duplicar efectos:** el guardián y las verificaciones son idempotentes; la pasada
  vuelve a subir y a comprobar sin dejar residuo (`trap 'rm -rf "$TMPDIR"' EXIT`, `:112`).
- **Cierra lo que abre:** `$RDIR/$name` se borra en cada vuelta (`:165`, `:184`).
- **La contraseña no entra en el `process.env` del proceso web**, que era el punto fino: cero
  variables nuevas en las units, así que el botón «Lanzar copia ahora» de
  `modules/superadmin/backups.js:69` sigue funcionando sin tocarlo. Verificado: ningún commit del
  rango toca `backups.js` ni `/etc/bamburu.env`.

La prueba **E** merece decirse aparte: sustituir el fichero descargado por otra base real y válida
pasaba `PRAGMA integrity_check` en verde, y ahora no pasa. Eso **cierra un agujero que existía antes
de esta tarea** y que nadie había pedido cerrar. Es la parte más valiosa de la entrega.

---

## 4. Motivos del rechazo

### [CRITERIO-INCUMPLIDO] La tarea no está hecha en producción: 250 objetos siguen en claro y no hay ninguna copia corriendo

**Dónde:** `gdrive:Bamburu-backup/daily/` (228 objetos) y `gdrive_gili:Bamburu-backup-gili/daily/`
(22 objetos) · el estado lo fija `scripts/bamburu-backup.sh:41` y
`deploy/systemd/bamburu-backup-secondary.service:15`

**Qué pasa:** los criterios **3, 4 y 5** están en NO, y el 7 en NO por la ficha. Medido hoy:

- `rclone listremotes` → solo `gdrive:` y `gdrive_gili:`. **`gdrive_cif` y `gdrive_gili_cif` no
  existen**, así que el destino por defecto del script apunta a un remote inexistente.
- `rclone lsf gdrive:Bamburu-backup-cif/` → `directory not found`.
- Las dos copias **abortan**: lo he ejecutado, `EXIT=1` en las dos configuraciones (destino por
  defecto y destino de la unit instalada de la secundaria, que además **sigue apuntando a
  `gdrive_gili:Bamburu-backup-gili/daily`** porque la copia de `/etc/systemd/system/` no se ha
  actualizado).
- Última copia con éxito: **hoy a las 03:36 y 03:38**, con el código anterior.
- Y una consecuencia con fecha: `scripts/bamburu-backup-heartbeat.sh:23` tiene `MAX_AGE=48h`. Si
  nadie hace nada, **el 3 de septiembre sobre las 03:36 llega el correo
  «🚨 CRITICO Bamburu: SIN NINGUNA copia con exito en +48h»**, y será verdad.

Nada de esto es un defecto del código entregado. Es que **la mitad de operación de la tarea no se ha
ejecutado**, y sin ella la tarea no protege nada: los 203 clientes y las 922 facturas siguen
legibles para quien entre en cualquiera de las dos cuentas de Gmail, que es literalmente el vector
que la tarea venía a cerrar.

**Qué hay que hacer:** los cuatro pasos son de terminal y **los tiene que dar Ibrahin** — este agente
no puede: `~/.config/rclone` está en solo lectura por el namespace de `orquestador.service` y
`NoNewPrivileges=yes` cierra `sudo`. **No hay ninguna línea de código que cambiar.** En orden:

1. **Crear los dos remotes `crypt`**, con el bloque de `deploy/systemd/README.md`
   §«Cifrado de las copias» → «Crear los dos remotes `crypt`». **Condición de paso:**
   `rclone config show gdrive_cif | grep '^type'` tiene que responder `type = crypt`;
   `rclone config create` puede imprimir la sección y devolver 0 sin haber escrito nada.
2. **Custodiar la contraseña fuera del servidor** (`rclone reveal` de `password` y `password2`,
   comandos en la misma sección). Sin esto, el día que el servidor no arranque las copias son ruido.
3. **Instalar la unit de la secundaria y lanzar la primera copia real de cada cuenta:**
   ```bash
   sudo cp deploy/systemd/bamburu-backup-secondary.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl start bamburu-backup.service           && journalctl -u bamburu-backup -n 80 --no-pager
   sudo systemctl start bamburu-backup-secondary.service && journalctl -u bamburu-backup-secondary -n 80 --no-pager
   ```
   Se exige de cada una: **exit 0** y **11 artefactos** «subido, verificado y restore OK». → criterio 3.
4. **Migrar el histórico** (250 objetos): copiar → `cryptcheck` con **0 diferencias y código 0** →
   simulacro → borrar. Si `cryptcheck` no da 0, **no se borra y se pregunta**. → criterio 5.
   No vale dejarlo caducar: la retención **salta los nombres indescifrables** con código 0, así que
   el histórico en claro se quedaría ahí para siempre.
5. Después, **el ensayo de restauración solo con la contraseña** (criterio 4) y cerrar la ficha de
   `TABLERO.md:8385` con fecha y commit (criterio 7).

### [FUERA-DE-ALCANCE] El commit de la tarea lleva dentro un cambio del orquestador que el análisis no nombra

**Dónde:** `orchestrator/orq.js:179-190`, dentro de `5834d79`

**Qué pasa:** el commit de la tarea incluye 7 líneas que reescriben el mensaje de `orq parar` para
que diga el plazo. `analysis.md` §3 «En qué capa vive» enumera los ficheros que se tocan —
`scripts/bamburu-backup.sh`, `deploy/systemd/bamburu-backup-secondary.service`, `rclone.conf` y
documentación — y `orchestrator/` no está. El cambio pertenece al trabajo de `40fb41c` (introduce
`cfg.ciclo.plazoParadaMs`, que nace en ese commit), no a esta tarea.

**Qué hay que hacer:** no revertirlo — el mensaje viejo quedaría mintiendo después de `40fb41c`.
Basta con **declararlo**: una línea en el informe diciendo que ese hunk es continuación de `40fb41c`
y por qué viajó aquí. Es lo único que falta para que el registro cuadre.

*(Por si hay duda con el rango de commits: **`40fb41c` no es de esta tarea.** Es trabajo del
orquestador —barrido, cuota y parada—, de otra sesión, sin trailer `Tarea:`, y solo cae dentro del
rango por ser anterior. No lo he juzgado como parte de esta entrega. `dace8e6` y `c7ed05a` son la
misma línea de la ficha, reescrita por el hook.)*

---

## Observaciones (no bloquean)

1. **`cryptcheck` mete sus errores en el mismo saco** — `scripts/bamburu-backup.sh:127` descarta toda
   la salida con `>/dev/null 2>&1`, así que el log dice «cryptcheck FALLA» igual si las huellas
   difieren (corrupción real, alarmante) que si el remote no responde o rclone falla por otra cosa.
   El guardián ya descarta el caso «no es crypt», y el mensaje apunta bien, así que no bloquea; pero
   guardar la última línea de `cryptcheck` en `$LOGBUF` haría que el email de fallo se explicara solo.
2. **`--include "$name"` no escapa metacaracteres** (`:127`). Los nombres los compone el propio
   script a partir de slugs de tenant, que hoy no llevan `*`, `?`, `[` ni `{`, así que es teórico.
   Si algún día un slug los llevara, el filtro dejaría de acotar a un artefacto.
3. **`date +%s > "$LAST_OK"` (`:196`) no comprueba que se escribiera.** Es anterior a esta tarea, no
   la ha introducido el programador — lo anoto porque me salió al ejercitarlo: si esa escritura falla,
   la copia dice «completada correctamente» y el heartbeat no recibe marca. Es material para
   `retencion-backup-fallo-parcial` o para una ficha propia, no para aquí.
4. **El histórico en claro tiene basura de gates dentro**: al listar Drive aparecen
   `__gate_67cb1b_no_existe-2026-08-23.db`, `__gate_94ec4a_no_existe-…`. Se van a migrar y a cifrar
   tal cual, que es lo correcto ahora; pero conviene saber que están ahí.
5. **El informe del programador es exacto.** He comprobado sus siete afirmaciones verificables
   (A–H) y todas se sostienen; la tabla de «estado honesto» coincide con lo que he medido. Que
   entregara declarando en rojo lo que faltaba, en vez de cerrar la ficha, es lo que ha permitido que
   esta revisión sea corta.

---

## Constancia de que esta revisión no dejó residuo

Ejercité el script real contra un remote `crypt` de usar y tirar sobre backend local (sin red, sin
tocar Drive ni el `rclone.conf` de producción), con `BACKUP_SUFFIX=-revision` para no pisar las
marcas buenas. Al terminar: `/tmp/rev-cif.*` y `/tmp/rev-cif-work` borrados, ninguna marca
`last-success-revision` creada (el `$HOME` del agente es de solo lectura), `rclone.conf` de
producción intacto (`-rw------- ubuntu:ubuntu`, mtime 03:35, 2 remotes), y `git status --porcelain`
vacío. Los listados contra Drive fueron de solo lectura (`lsf`).
