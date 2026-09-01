# Informe de entrega — Cifrar las copias de seguridad

- **id:** `cifrado-copias-seguridad`
- **intento:** 4 (primero del replanteamiento)
- **fecha:** 1 sep 2026
- **plano seguido:** `task-cifrado-copias-seguridad-analysis.md` (♻️ REPLANTEAMIENTO)

---

## Lo primero, porque es lo que más importa

**Las copias siguen yendo EN CLARO, y eso es a propósito.** Esta entrega **construye** el mecanismo
de cifrado y lo deja probado; **no lo enciende**. Lo enciende Ibrahin con una orden:

```bash
bash scripts/cifrar-copias-de-seguridad.sh
```

**El vector 4 sigue ABIERTO** hasta que esa orden se ejecute, y así está escrito en
`docs/seguridad/vectores-de-ataque.md` y en `TABLERO.md`. **La ficha NO se cierra.** Cerrarla sería
el verde que miente que esta tarea viene a matar.

Y mientras no la ejecute, **no pasa nada malo**: las copias salen cada noche, en claro, verificadas
—ahora mejor que antes— y el correo diario dice **`EN CLARO ⚠️`** en el asunto para que no se olvide.

---

## Lo que se ha construido

| Fichero | Qué |
|---|---|
| `scripts/bamburu-backup.sh` | modificado: dos modos, cerrojo, verificación sin rama blanda, restore byte a byte |
| `scripts/cifrar-copias-de-seguridad.sh` | **nuevo**: el guion de un solo uso + `--migrar-historico` |
| `scripts/ensayo-restauracion-cifrada.sh` | **nuevo**: abrir la copia partiendo solo de la llave |
| `deploy/systemd/README.md` | sincerado (4 afirmaciones falsas + una receta rota) |
| `docs/seguridad/vectores-de-ataque.md` | fila 4, fila 7 y cuerpo de §4: estado real |
| `CLAUDE.md`, `TABLERO.md` | titular y cuerpo, tachando con fecha y motivo |

**El cambio de enfoque, en una frase:** el cifrado deja de ser un *interruptor en el código* que
alguien tiene que ir a acompañar a mano, y pasa a ser un **estado del servidor**. El fichero
`~/.config/bamburu/backup-destinos.conf` (`600`) dice en qué mundo vive la copia, y **lo escribe el
mismo guion que crea los destinos cifrados, en la misma pasada y solo después de haber descifrado un
fichero de verdad**. Como ese fichero es a la vez el cerrojo, el instante peligroso del 1 de
septiembre —*el código exige cifrado y el cifrado no existe*— **no tiene ninguna línea en la que
poder ocurrir**.

---

## Criterios de aceptación, uno a uno

Los ocho se comprobaron **sin red, sin `sudo` y sin tocar `~/.config/rclone/rclone.conf`**, contra el
mundo de mentira de §4.1 (backend `local`, `RCLONE_CONFIG` y `HOME` propios en `/tmp`).

### 1. ✅ Hoy sigue habiendo copia

```
[bamburu-backup] destino: fake_claro:daily — EN CLARO ⚠️
[bamburu-backup] backup completado correctamente (23 archivos) — destino EN CLARO ⚠️.
exit=0        objetos subidos: 23
```

23 = 21 `data/tenants/*.db` + `control.db` + `uploads-*.tar.gz`, el número que predice el plano.
Y `grep -n "se valida solo por tamaño" scripts/bamburu-backup.sh` → **0 líneas**.

### 2. ✅ La pasada cifrada completa funciona

```
[bamburu-backup] destino: fake_cif:daily — CIFRADO
[bamburu-backup]   verify: cryptcheck (rc=0) NOTICE: Encrypted drive 'fake_cif:daily': 1 matching files
[bamburu-backup] backup completado correctamente (23 archivos) — destino CIFRADO.
exit=0        a través de la llave: 23
```

Listado **crudo**, sin la llave (los directorios también van cifrados):

```
f3pei8no6a84kjjoea3pcs9rjk/
f3pei8no6a84kjjoea3pcs9rjk/9aii1qqrqfja09gvo2cmjv329l780bgsnd0fpmsmave48p87taog
f3pei8no6a84kjjoea3pcs9rjk/9js075cdjp1n92flr2ovr2cu1g
```

Contando sobre ese listado: **0** apariciones de `.db`, **0** de `.tar.gz`, y **0** nombres de
negocio — comprobado recorriendo `data/tenants/*.db` del disco, no una lista escrita a mano.

**Nota de precedencia, medida:** esa pasada se lanzó con `BACKUP_REMOTE=fake_claro:daily` **puesto**,
y aun así fue al destino cifrado. Es la precedencia que pide el plano (fichero de destinos > unit),
y es lo que permite que las **dos** copias cambien de destino con **una sola escritura** y sin `sudo`.

### 3. ✅ Las dos verificaciones fallan duro, y se demostró rompiéndolas

**(a) Un byte alterado en el objeto subido.** Para llegar a `cryptcheck` sin que la subida
sobreescribiera la corrupción, se dejó el destino en solo lectura. **Control primero, sin corromper:**
la pasada entera da **exit 0** — o sea, el montaje no rompe nada por sí solo. Después, un byte:

```
tam antes=266352 despues=266352   (idéntico: solo cambia el contenido)
[bamburu-backup]   verify: cryptcheck (rc=1) NOTICE: Failed to cryptcheck: 1 differences found
[bamburu-backup]   verify: cryptcheck NO dio 0
[bamburu-backup] FALLO: verificación de subida de control-2026-09-01.db (tamaño/huella)
exit=1
```

La última línea de `cryptcheck` va al log, como pedía el plano: el email de fallo distingue «las
huellas difieren» de «el remote no respondió».

**(b) El fichero descargado sustituido por otra base real y válida.** Se usaron `duniya.db` y
`helados-ibrahin.db`, dos bases **reales, distintas y de exactamente 1.261.568 bytes las dos**. La
sustituta pasa `PRAGMA integrity_check` → `ok` con 282 objetos de esquema: con el código viejo habría
pasado en verde.

```
[bamburu-backup]   restore: el fichero descargado NO es idéntico al original (…/restore/duniya-2026-09-01.db)
[bamburu-backup] FALLO: el restore de duniya-2026-09-01.db no es idéntico al original
exit=1
```

Y el tamaño y `cryptcheck` de esa misma pasada dieron **OK**: lo cazó la comparación byte a byte y
nada más, que es justo lo que había que demostrar.

**(c) Destino en claro que no devuelve MD5.** Como fixture, un remote `alias` sobre un `crypt`: es
`type = alias` (no es `crypt`) y no puede dar MD5.

```
[bamburu-backup] destino: fake_sinmd5:daily — EN CLARO ⚠️
[bamburu-backup]   verify: el destino no devuelve huellas y no es crypt: no se puede verificar
exit=1
```

Antes de esta entrega, ese mismo caso escribía un aviso y **devolvía 0**.

### 4. ✅ El guion hace los cinco pasos en orden

Ejecutado entero en `/tmp`. Salida real (la llave, recortada aquí, se imprimió una vez):

```
Prerrequisitos OK: … y /tmp/cif-guion/conf.conf es escribible.
Los dos remotes están escritos como crypt, con la MISMA contraseña.
Ensayo real (subir, bajar, comparar byte a byte, y mirar el destino en crudo)…
 · cif1   sube, baja, coincide byte a byte, y en crudo no se lee el nombre.
 · cif2   sube, baja, coincide byte a byte, y en crudo no se lee el nombre.
Destino cambiado. Las dos copias de esta noche saldrán CIFRADAS:
   DESTINO_principal=cif1:daily
   DESTINO_secundaria=cif2:daily
exit=0
```

Comprobado después: fichero de destinos en **`600`**; los dos remotes `type = crypt`; los dos
`reveal` **coinciden** (44 caracteres, comparados sin imprimirlos); **0 objetos** de ensayo y **0**
directorios `/tmp/cif-ensayo.*` (la prueba borró lo que creó).

**Segunda ejecución:** «El cifrado ya está creado: este guion NO vuelve a generar ninguna clave»,
imprime el estado, **exit 0**, y se verificó que **la clave no había cambiado**.

### 5. ✅ Si no descifra, no cambia el destino

Rompiendo el ensayo (backend crudo sin permiso de escritura):

```
 · cif1   no se pudo SUBIR el fichero de ensayo
EL ENSAYO HA FALLADO en 'cif1'. No se toca el destino de las copias.
DESHECHO: se han borrado los remotes que este guion había creado.
El destino de las copias NO se ha cambiado: esta noche saldrán EN CLARO, y en verde.
exit=1
```

Después: el fichero de destinos **no existe**, y `rclone listremotes` solo devuelve `fakedrive:` —
los `crypt` a medias **ya no están**.

### 6. ✅ El cerrojo no puede adelantarse a la llave

Con el fichero de destinos apuntando a un remote que **no** es `crypt`:

```
[bamburu-backup] FALLO: el destino 'fake_claro:daily' viene de …/destinos.conf pero NO es un remote crypt. Copia ABORTADA.
exit=1
temporales vivos: 0 · líneas de snapshot: 0 · objetos en el destino: 0
```

No llegó a crear el temporal ni a tocar un fichero. **Borrando ese fichero**, la misma copia vuelve a
**exit 0** con 23 artefactos contra el destino en claro.

### 7. ✅ La copia se abre partiendo solo de la llave

`scripts/ensayo-restauracion-cifrada.sh`, con la contraseña por **stdin**, configuración temporal en
`/tmp` y **sin leer `~/.config/rclone/rclone.conf`** — se ejecutó con el `HOME` **real** para que la
prueba fuera exigente:

```
✅ ENSAYO SUPERADO
   fichero ............ x-2026-09-01.db (1224704 bytes)
   integrity_check .... ok
   objetos del esquema. 276
```

**La prueba de que la llave viene del stdin y no del servidor:** el `rclone.conf` real tiene **0**
remotes `crypt` (solo `gdrive:` y `gdrive_gili:`), y con la **contraseña equivocada** el mismo
ensayo sale con **exit 1** («no se lee ningún .db: o la llave no es la buena…»).

### 8. ✅ Papeles y llave

Las cuatro frases falsas del plano §1.4 ya no afirman nada: «Drive **CIFRADO**» y «o no hay copia»
**no aparecen**; «HACE FALTA LA CONTRASEÑA» y «CÓDIGO HECHO» solo aparecen **dentro de `~~ ~~`**, con
su fecha y su motivo. La fila 4 de `docs/seguridad/vectores-de-ataque.md:13` dice **ABIERTO**.
`git grep` de la contraseña del mundo de mentira **no devuelve nada**, y `git status --porcelain` no
tiene ningún residuo de las pruebas.

**También se destachó una frase**, que es el caso raro: `vectores-de-ataque.md:19` tenía tachado
«todo lo que sale de la aplicación está sin proteger» por creerlo resuelto. **No lo estaba**, así que
vuelve a estar en pie, con la nota de por qué.

**Y la receta de custodia estaba rota** (§1.5 del plano). Se tachó con su motivo y se puso la que
funciona, **después de ejecutar las dos**: la vieja da `base64 decode failed … is it obscured?`
porque `rclone config show` **enmascara** el campo; la nueva usa `rclone config dump` y devolvió
exactamente la llave que el guion había impreso.

---

## Tres cosas que decidí yo, y por qué

Ninguna cambia lo que el producto le promete a nadie; las tres son de construcción, así que se
deciden, se construyen y se explican aquí — pero las escribo porque el revisor las verá en el diff.

**1. `--include "/$name"` en vez de `--include "$name"`.** El plano escribía el filtro sin anclar.
**Medido: no vale.** `--include` casa a **cualquier profundidad**, así que `cryptcheck` se llevaba
también el `restore/$name` de la prueba de restauración y comparaba dos ficheros locales contra uno
remoto. Lo destapó el propio criterio 3(b), que falló por el sitio equivocado. Con la `/` inicial el
filtro se ancla a la raíz de cada lado y compara exactamente `<dir>/$name` contra `$REMOTE/$name`.
En la operación normal las dos formas coinciden (a la hora de verificar, `restore/` está vacío); la
anclada es la que no depende de eso.

**2. `cryptcheck --one-way` en la migración del histórico.** Sin él, la migración **no habría pasado
nunca en producción**: cuando Ibrahin la ejecute, el destino cifrado ya tendrá las copias de las
noches anteriores, y `cryptcheck` cuenta esas sobrantes como diferencia. Medido: **23 «errors while
checking»** por ese motivo exacto, con la orden tal y como estaba escrita a mano en el README. Con
`--one-way` se exige lo que de verdad hace falta —que **todo lo viejo** esté en el destino y
coincida— y dio `0 differences found` con `2 matching files`. (El recuento independiente del plano ya
usaba `>=` y no `==`, lo cual encaja: el plano anticipó que el destino tendría más objetos.)

**3. `DESTINO_ES_CRYPT` calculado una vez.** El plano llamaba a `es_crypt "$REMOTE"` dentro del
cerrojo. Es la misma comprobación, hecha una sola vez al arrancar, porque hace falta **dos** veces
más: para elegir la rama de `verify_uploaded` y para decir el modo en palabras. Se ahorra una llamada
a `rclone` por artefacto y no hay forma de que las dos decisiones discrepen.

Además, dos retoques menores dentro de los mismos ficheros: el mensaje de `fail_exit` decía
`(tamaño/MD5)` y ahora dice `(tamaño/huella)`, porque en el modo cifrado no hay MD5; y los recuentos
de la migración usan `lsf --files-only`, porque `lsf` a secas cuenta también entradas de directorio y
el mensaje dice «objetos».

---

## Lo que NO se ha hecho, y hay que saberlo

1. **Las copias van en claro.** Ver arriba. Es la orden que falta.
2. **El histórico de Drive sigue en claro** — 250 objetos según la revisión del intento 3. Y hay un
   detalle medido que lo hace urgente el día que se encienda el cifrado: un fichero con nombre sin
   cifrar dentro de la raíz de un `crypt` se **salta con código de salida 0**, al listar **y al
   borrar**. Es decir, **la retención de 14 días no volverá a tocarlo nunca**: no caduca solo. Para
   eso está `--migrar-historico`, y está dicho en el README y en el vector 4 que **sin ese paso el
   vector 4 no está cerrado**.
3. **Nada se ha ejecutado contra Drive ni contra `~/.config/rclone/rclone.conf`.** Ni una orden de
   lectura. El `$HOME` del orquestador está en solo lectura (`Read-only file system`, comprobado), y
   el plano no lo pedía.
4. **La segunda copia no se probó como unit.** Se probó lo que decide su destino —la resolución por
   `BACKUP_LABEL`— y el guion escribe las dos líneas, `DESTINO_principal` y `DESTINO_secundaria`.
   Instalar o recargar units necesita `sudo` y está fuera del plano.
5. **No se ha ejecutado ningún `scripts/run-gates.mjs`**, ni corto ni completo, ni ningún gate de
   navegador: el plano lo prohíbe explícitamente arriba del todo y ningún criterio los necesita.

---

## Higiene de las pruebas

Todo bajo `/tmp/cif-*` con `HOME` falso, `BACKUP_HC_URL=""` explícito y `RESEND_API_KEY` vacío en el
entorno (comprobado): **no se envió ningún email, no se hizo ningún ping y no se pisó ninguna marca
de éxito del heartbeat**. Los temporales del propio script se borran en su `trap`. Al terminar,
`git status --porcelain` solo contiene los ficheros de esta entrega, y la contraseña del mundo de
mentira no aparece en el árbol.

## Alcance

Los siete ficheros tocados están **dentro de la lista cerrada** de §3 del plano. No se ha tocado
`modules/`, ni `core/`, ni `orchestrator/`, ni ninguna base, ni ninguna migración, ni ninguna unit,
ni `/etc/bamburu.env`. Los cuatro `docs/architecture/task-cifrado-*` que aparecen modificados en
`git status` **venían así de antes** de empezar esta sesión y **no se incluyen en el commit**.

---

# Ronda 2 — corrección del rechazo (1 sep 2026)

- **veredicto anterior:** ❌ RECHAZADO (`task-cifrado-copias-seguridad-review-intento-1.md`)
- **motivo:** `[FUERA-DE-ALCANCE]` — quedaban **dos afirmaciones falsas** en
  `deploy/systemd/README.md` (`:402` y `:466-467`), y el plano mandaba cazarlas con el `grep` de
  §4.7. **Ese `grep` no se pasó.** Los ocho criterios de aceptación los verificó el revisor
  ejecutándolos y **ninguno se toca**: esta ronda no modifica ni una línea de código.

## Lo que se ha corregido

### 1. `:402` — la tabla de §«Por qué una sola pieza y no dos scripts» (BLOQUEANTE)

Decía `| BACKUP_REMOTE | gdrive_cif:daily | gdrive_gili_cif:daily |`. **Las dos celdas eran falsas**,
y no de forma inocente: quien copiara la tabla a una unit dejaría las copias yendo cada noche contra
un remote inexistente —la avería del 1 de septiembre, invitada por nuestro propio documento— porque
sin fichero de destinos `EXIGE_CRYPT=0` y el cerrojo no salta.

Medido antes de escribir los valores nuevos:

```
scripts/bamburu-backup.sh:64 → REMOTE="${BACKUP_REMOTE:-gdrive:Bamburu-backup/daily}"
deploy/systemd/bamburu-backup-secondary.service:15 → Environment=BACKUP_REMOTE=gdrive_gili:Bamburu-backup-gili/daily
/etc/systemd/system/bamburu-backup-secondary.service:15 → idéntico
rclone listremotes → gdrive:  gdrive_gili:      (no hay ningún remote *_cif)
```

La fila pasa a los valores reales, se añade debajo la línea que dice **quién manda de verdad** (si
existe `~/.config/bamburu/backup-destinos.conf`, manda ese fichero y `BACKUP_REMOTE` se ignora,
`scripts/bamburu-backup.sh:57-64`), y lo viejo **se tacha con su fecha y su motivo**, que es el
método de este repo.

### 2. `:466-467` — el bloque de instalación de la segunda copia (BLOQUEANTE)

Mandaba ejecutar, **sin ninguna condición**, `rclone ls gdrive_gili_cif:daily/` y
`rclone lsf gdrive_gili:Bamburu-backup-gili-cif/ -R`. Ese remote y esa carpeta no existen: quien
siguiera el bloque se llevaba un error. Se separa en **EN CLARO (lo que corre hoy)** y **CIFRADAS
(solo después de ejecutar el guion)**, exactamente el patrón que ya estaba bien resuelto en
§«Comprobaciones» del mismo fichero.

### 3. El `grep` del plano, pasado de verdad, con cada aparición clasificada

```
$ grep -rn "gdrive_cif\|gdrive_gili_cif" deploy/systemd/README.md docs/seguridad/ CLAUDE.md TABLERO.md
```

| Dónde | Estado | Por qué es cierto |
|---|---|---|
| `README.md:189` | **condicionada** | dentro de `# CIFRADAS (solo después de ejecutar el guion de cifrado):` |
| `README.md:200` | **tachada** | `~~ ~~` con su fecha (la vieja «HACE FALTA LA CONTRASEÑA») |
| `README.md:202` | **cierta** | es el texto que *explica* por qué la anterior era falsa |
| `README.md:208` | **condicionada** | abre con «**Cuando estén cifradas** (es decir, cuando exista el fichero de destinos)» |
| `README.md:219` | **condicionada** | dentro de `# --- SI VAN CIFRADAS ---` |
| `README.md:328` | **tachada** | la receta rota de `config show`, `~~ ~~` con fecha y motivo |
| `README.md:338` | **cierta** | la receta que sí funciona (`config dump`), verificada en el intento anterior |
| `README.md:423` | **tachada** | la nota nueva que tacha la fila de la tabla arreglada en el punto 1 |
| `README.md:494` | **condicionada** | ahora bajo `# CIFRADAS (solo después de ejecutar el guion de cifrado):` — el punto 2 |
| `CLAUDE.md:34` | **cierta** | narra en pasado la avería del 1 sep («el script **apuntaba a**…») |
| `TABLERO.md:8424` | **cierta** | igual, en pasado («**apuntaba a**… se quedó puesto y vivo») |

Y el mismo barrido sobre las **carpetas** cifradas, que el patrón del plano no cubría:

```
$ grep -rn "Bamburu-backup-cif\|Bamburu-backup-gili-cif" deploy/systemd/README.md docs/seguridad/ CLAUDE.md TABLERO.md
```

7 apariciones: `README.md:190,219→224,232` dentro de bloques `SI VAN CIFRADAS` / `CIFRADAS (solo
después…)`; `:301-302` describiendo lo que **creará** el guion; `:357` el ensayo de restauración, que
por definición es del mundo cifrado; y `:495`, la corregida en el punto 2. **Ninguna afirma que
existan hoy.**

## Las dos observaciones del revisor, también hechas — y por qué

El revisor las marcó **no bloqueantes**. Las hago igualmente porque son la **misma clase de defecto**
por el que esta entrega fue rechazada —una frase falsa en el fichero que la tarea venía a
sincerar— y porque las dos caen dentro de `deploy/systemd/README.md`, que sí está en la lista cerrada
de §3 del plano. **Ninguna toca código.** Van declaradas aquí para que se vean en la revisión.

**Observación 1 — el cerrojo es por copia, no por fichero.** Si el fichero de destinos existe pero
falta o está malformada la línea `DESTINO_<etiqueta>`, esa copia se va en claro sin abortar. Es el
diseño del plano (riesgo 5: «preferimos copia en claro a sin copia») y no queda en silencio, pero no
estaba escrito. Ahora está, junto al cerrojo, con el aviso de que el guion escribe **las dos** líneas
y quien las edite a mano puede degradar una copia sin darse cuenta.

**Observación 2 — el banner de §S6 llevaba meses caducado.** Decía «**ESTADO: PREPARADA, NO
INSTALADA** … Hasta que exista el remote `gdrive_gili`, nada de esto está activo». Medido hoy:

```
rclone listremotes                → gdrive:  gdrive_gili:
ls /etc/systemd/system/bamburu-backup-secondary.{service,timer} → los dos instalados
systemctl list-timers 'bamburu-backup*'
   bamburu-backup-secondary.timer  LAST Tue 2026-09-01 03:35:00 UTC  NEXT Wed 2026-09-02 03:35:00
```

Se **tacha con fecha y motivo** y se deja dicho que el resto de la sección es historia útil — así el
titular corregido no entra en contradicción con el cuerpo que sigue (§«Paso que falta»), que es
justo el error que `CLAUDE.md` §«Un titular de recuento se corrige con el cuerpo que lo desarrolla»
prohíbe.

## Cómo está probado

Esta ronda es **documentación, no código**, así que la prueba es la **medición de cada afirmación**
contra el sistema real, no una ejecución:

- Los cuatro valores nuevos de la tabla, leídos del script, de la unit del repo **y** de la unit
  instalada en `/etc/systemd/system/` (coinciden), más `rclone listremotes`.
- El estado de S6, leído de `systemctl list-timers` y de `/etc/systemd/system/`.
- El `grep` del plano, pasado y clasificado aparición por aparición (arriba).
- `git diff --stat` sobre lo que se commitea: **`deploy/systemd/README.md` y este informe**, nada más.
- **Cero órdenes contra Drive** (`rclone listremotes` y `rclone config` leen el `.conf` local; ni una
  llamada de red) y **cero escrituras** en `~/.config/rclone/rclone.conf`.
- `scripts/bamburu-backup.sh`, `scripts/cifrar-copias-de-seguridad.sh` y
  `scripts/ensayo-restauracion-cifrada.sh` quedan **byte a byte como en `7bfdee5`**: los ocho
  criterios que el revisor ejecutó siguen valiendo sin repetirlos.

## Lo que sigue sin cambiar

**Las copias siguen yendo EN CLARO**, el vector 4 sigue **ABIERTO**, y **la ficha no se cierra**.
Falta la orden de Ibrahin: `bash scripts/cifrar-copias-de-seguridad.sh`.

---

## Ronda posterior (1 sep 2026, después de `3d43f0a`) — no hay nada nuevo que construir

**Motivo por el que se me vuelve a asignar esta tarea:** el revisor rechazó con «no hay ningún
commit nuevo desde `3d43f0a`» y «el programador no ha confirmado nada, o lo dejó sin confirmar en
el árbol de trabajo».

**Lo que he comprobado antes de tocar nada**, siguiendo la regla de este papel de no construir por
libre: los siete ficheros de la lista cerrada del plano (§3) —los tres guiones, el README de
systemd, los vectores de ataque, `CLAUDE.md` y `TABLERO.md`— están **ya construidos y comprometidos**
en `5834d79` → `7bfdee5` → `2b392d9` → `f26d9dd` → `d7598c9`, y coinciden con el plano punto por
punto. No es un supuesto: he vuelto a ejecutar los criterios 1 y 2 en fresco, hoy, en un mundo de
mentira nuevo en `/tmp` (backend `local`, `RCLONE_CONFIG`/`HOME` propios, sin tocar Drive ni
`~/.config/rclone/rclone.conf`):

```
PASADA 1 (EN CLARO, BACKUP_REMOTE=fake_claro:daily):  exit=0 — 45 archivos
PASADA 2 (CIFRADA, fichero de destinos -> fake_cif:daily): exit=0 — 45 archivos, verify: cryptcheck (rc=0) en cada uno
Listado crudo (fakedrive:.../raw -R): 0 apariciones de ".db" o ".tar.gz"; solo nombres base32
```

(El recuento subió de 23 a **45** porque hoy hay más tenants de prueba en `data/tenants/` que el 1 de
septiembre por la mañana — no es una regresión del script, es el disco de hoy.) Los criterios 3 a 8
no dependen de ninguna línea que haya cambiado desde la última revisión aprobada (`git diff --stat
7bfdee5..HEAD -- scripts/` sigue sin devolver nada) y no los repito: «una comprobación pedida una vez
se ejecuta una vez».

**Conclusión: no hay ningún fichero de la lista cerrada que necesite un cambio nuevo.** Lo único que
falta es la orden manual de Ibrahin, y el propio plano la pone fuera del alcance de esta entrega
(«Anexo — Lo que le queda a Ibrahin, NO se juzga en esta entrega»). Construir algo nuevo aquí sería
exactamente lo que la regla 1 de este papel prohíbe: «ya que estaba, aproveché para…».

**Aviso sobre el árbol de trabajo, que no es mío y no toco:** al empezar esta ronda había cambios sin
confirmar ajenos a esta tarea —`orchestrator/orq.js`, `orchestrator/orquestador.config.json`,
`orchestrator/vigia/escucha.js`, `orchestrator/vigia/ordenes.js`, `orchestrator/vigia/parte.js`,
`orchestrator/vigia/telegram.js`, `orchestrator/pruebas/teclado.test.js` (sin seguimiento) y una
sección de `TABLERO.md` sobre «botones-telegram»— y **una edición sin confirmar** que sustituye el
contenido archivado (`❌ RECHAZADO`, el registro histórico que `d7598c9` dejó a propósito) de
`docs/architecture/task-cifrado-copias-seguridad-review-intento-1.md` por un veredicto
`✅ APROBADO`, junto con el **borrado sin confirmar** de
`docs/architecture/task-cifrado-copias-seguridad-review.md` (el veredicto que de verdad cerró la
tarea). Eso contradice la regla que el propio `d7598c9` puso por escrito —los intentos descartados
no se tiran— y no está en la lista cerrada de esta tarea, así que **lo dejo tal cual lo encontré, sin
tocarlo**, y lo señalo aquí en vez de resolverlo por mi cuenta.

**Recomendación:** no reasignar esta tarea a un programador mientras el motivo de rechazo no señale
un fichero, criterio o comportamiento concreto que falle. Lo único pendiente es la orden de Ibrahin.
