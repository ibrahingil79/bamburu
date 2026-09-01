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
