❌ RECHAZADO

# Revisión — Cifrar las copias de seguridad (intento 4, `7bfdee5`)

- **revisado:** `git diff f9e320ac797a4365e48346d6d9de14e7d1d037fa..HEAD` (1 commit, 8 ficheros)
- **plano:** `docs/architecture/task-cifrado-copias-seguridad-analysis.md` (♻️ REPLANTEAMIENTO)
- **cómo lo he juzgado:** ejecutando los ocho criterios yo mismo, en mi propio mundo de mentira
  (`/tmp/rev-cif`, `/tmp/rev-guion*`, backend `local`, `RCLONE_CONFIG` y `HOME` propios,
  `BACKUP_HC_URL=""`, `RESEND_API_KEY` vacío). Sin tocar Drive ni `~/.config/rclone/rclone.conf`.
  Todo borrado al terminar: `git status --porcelain` sin residuos, 0 temporales vivos.

**Los ocho criterios pasan, y los he pasado yo, no los he leído.** El mecanismo está bien
construido: es lo mejor que ha traído esta tarea en cuatro intentos. **Lo que lo tumba es una sola
cosa, y cuesta tres líneas arreglarla:** el plano mandaba, antes de dar la entrega por terminada,
`grep` de `"gdrive_cif"` en `deploy/systemd/README.md` «y comprobar que lo que quede es cierto»
(§4.7, último punto). Ese grep no se pasó: **quedan dos afirmaciones falsas en el README**, en el
mismo fichero que esta entrega venía a sincerar, y una de ellas invita a repetir la avería del 1 de
septiembre.

---

## 1. Criterios de aceptación

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | Hoy sigue habiendo copia (sin fichero de destinos, destino en claro → exit 0 y 23 artefactos; sin la rama blanda) | SÍ | Ejecutado: `BACKUP_REMOTE=fake_claro:daily` → `exit=0`, log `destino: fake_claro:daily — EN CLARO ⚠️` y `backup completado correctamente (23 archivos)`; `rclone lsf fake_claro:daily/ --files-only \| wc -l` → **23** (21 `data/tenants/*.db` + `control.db` + `uploads`). `grep -n "se valida solo por tamaño" scripts/bamburu-backup.sh` → **rc=1, 0 líneas** |
| 2 | La pasada cifrada completa funciona, y en crudo no se lee nada | SÍ | Ejecutado con `BACKUP_DESTINOS_CONF` → `exit=0`, `destino: fake_cif:daily — CIFRADO`, **23** a través de la llave. Listado crudo (`lsf fakedrive:…/raw -R`, 24 líneas): **0** `.db`, **0** `.tar.gz`, **0** nombres de negocio (comprobados recorriendo `data/tenants/*.db` del disco, no una lista a mano); el único directorio es `s4d4s5q9c8mi4r76jonujotb78/`. **Precedencia verificada:** la pasada llevaba `BACKUP_REMOTE=fake_claro:daily` puesto y aun así fue al cifrado (`scripts/bamburu-backup.sh:59-64`) |
| 3 | Las dos verificaciones fallan duro, demostrado rompiéndolas | SÍ | **(a)** Control con destino de solo lectura y sin corromper → `exit=0`. Después, un byte (`dd seek=100000 conv=notrunc`, tamaño idéntico 266352→266352) → `exit=1`, log `verify: cryptcheck (rc=1) … 1 differences found` + `cryptcheck NO dio 0`; la última línea de `cryptcheck` entra en `$LOGBUF` (`:180`), o sea llega al email de fallo. **(b)** Sustituido el fichero **descargado** por `duniya.db` (real, `integrity_check=ok`, 282 objetos de esquema) justo antes de `verify_restored`: la misma pasada dio `cryptcheck (rc=0) … 1 matching files` y luego `restore: el fichero descargado NO es idéntico al original` → `exit=1`. Lo cazó **solo** la comparación byte a byte. **(c)** Destino en claro sin MD5 (`alias` sobre `crypt`, `type = alias`, `hashsum MD5` → `hash type not supported`) → `verify: el destino no devuelve huellas y no es crypt` → `exit=1`, nunca un aviso |
| 4 | El guion hace los cinco pasos en orden, y la 2ª vez no genera clave | SÍ | Ejecutado entero en `/tmp/rev-guion` → `exit=0`. Después: `destinos.conf` en **600** con las dos líneas; `cif1` y `cif2` con `type = crypt`; los dos `reveal` **coinciden** y coinciden con la clave impresa (44 caracteres); `Contraseña :` aparece **1** vez; **0** objetos de ensayo en las raíces y **0** dirs `/tmp/cif-ensayo.*`. Segunda ejecución: «El cifrado ya está creado… NO vuelve a generar ninguna clave», estado, `exit=0`, y **la clave no cambió** |
| 5 | Si no descifra, no cambia el destino | SÍ | Roto el ensayo con el backend crudo sin escritura, **en los dos sitios**: fallando en `cif1` y fallando en `cif2` (con `cif1` ya bueno). Los dos casos: `exit=1`, «DESHECHO…», el fichero de destinos **no existe**, `listremotes` vuelve a `fakedrive: fakedrive2:` (los dos `crypt` borrados), **0** restos del ensayo del remote que sí funcionó, y la llave **no se imprimió** |
| 6 | El cerrojo no puede adelantarse a la llave | SÍ | Fichero de destinos → remote que no es `crypt`: `exit=1` con `el destino '…' viene de … pero NO es un remote crypt. Copia ABORTADA.`; **0** temporales `/tmp/bamburu-backup.*` creados, **0** líneas de snapshot, **0** objetos en el destino. Borrado ese fichero, la misma copia → `exit=0` con **23** artefactos |
| 7 | La copia se abre partiendo solo de la llave | SÍ | `ensayo-restauracion-cifrada.sh` con **HOME real** y llave por stdin, tres formas: backend como ruta local → `ENSAYO SUPERADO` (`x-2026-09-01.db`, 1224704 bytes, `integrity_check ok`, 276 objetos); con `RCLONE_CONFIG_ORIGEN` heredando **solo** la sección del backend → igual; con la **contraseña equivocada** → `exit=1`. El `rclone.conf` real tiene **0** remotes `crypt`, así que la llave sale del stdin y de ningún otro sitio |
| 8 | Papeles y llave — las cuatro frases falsas de §1.4 | SÍ | `grep -rn` en `deploy/systemd/README.md`, `docs/seguridad/`, `CLAUDE.md`, `TABLERO.md`: «a Drive **CIFRADO**» y «o no hay copia» → **0 apariciones**; «HACE FALTA LA CONTRASEÑA» → solo `README.md:195` **dentro de `~~ ~~`** con su fecha; «CÓDIGO HECHO» → solo `TABLERO.md:9230` **dentro de `~~ ~~`**. `vectores-de-ataque.md:13` dice **ABIERTO**. `git status --porcelain` sin residuos y `git grep` de mis claves de prueba → nada |

---

## 2. Motivo de rechazo

### [FUERA-DE-ALCANCE] Quedan dos afirmaciones falsas en `deploy/systemd/README.md`, y el plano mandaba cazarlas

**Dónde:** `deploy/systemd/README.md:402` y `deploy/systemd/README.md:466-467`

**Qué pasa:**

`:402`, en la tabla de §«Por qué una sola pieza y no dos scripts», dice hoy:

```
| `BACKUP_REMOTE` | `gdrive_cif:daily` | `gdrive_gili_cif:daily` |
```

Las dos celdas son falsas. Medido: el valor por defecto del script es
`gdrive:Bamburu-backup/daily` (`scripts/bamburu-backup.sh:64`) y la unit secundaria pone
`Environment=BACKUP_REMOTE=gdrive_gili:Bamburu-backup-gili/daily` — igual en el repo
(`deploy/systemd/bamburu-backup-secondary.service:15`) que en la instalada
(`/etc/systemd/system/bamburu-backup-secondary.service:15`). Los remotes `gdrive_cif` y
`gdrive_gili_cif` **no existen**.

`:466-467`, dentro del bloque §«Instalación (después de tener el remote)» de la segunda copia, manda
ejecutar sin ninguna condición:

```bash
rclone ls gdrive_gili_cif:daily/                    # a través de la clave
rclone lsf gdrive_gili:Bamburu-backup-gili-cif/ -R  # sin la clave: nombres ilegibles
```

Ese remote y esa carpeta tampoco existen: quien siga el bloque se lleva un error.

Las dos líneas son restos del intento 3 (`git show f9e320a:deploy/systemd/README.md`, líneas 332 y
396) que la reversión de `6bd067f` no tocó, y esta entrega tampoco. No es un descuido cualquiera:
**el plano lo pedía por su nombre.** §4.7, último punto: *«antes de dar la entrega por terminada,
`grep` de "exige destino", "CÓDIGO HECHO", "gdrive_cif" y "HACE FALTA LA CONTRASEÑA" en `TABLERO.md`,
`CLAUDE.md`, `deploy/systemd/README.md` y `docs/seguridad/`, y comprobar que lo que quede es
cierto»*. Ese grep, pasado hoy, saca ocho apariciones de `gdrive_cif` en el README: seis son
correctas (tachadas, o dentro de un bloque explícitamente condicionado a «solo después de ejecutar
el guion de cifrado») y estas dos no.

Y el daño no es cosmético, que es lo que lo hace bloqueante: el README es lo que se lee para operar.
Un lector que se crea la tabla de `:402` puede poner `BACKUP_REMOTE=gdrive_cif:daily` en una unit
antes de ejecutar el guion; como sin fichero de destinos `EXIGE_CRYPT=0`, el cerrojo no salta, y la
copia se va cada noche contra un remote que no existe. Es la avería del 1 de septiembre otra vez,
invitada por nuestro propio documento. Y es exactamente el patrón que `CLAUDE.md` §«Un titular de
recuento se corrige con el cuerpo que lo desarrolla» tiene prohibido con nombre propio: el titular
del README ya dice la verdad (`:110-131`, `:190-214`, `:234-255`), y el cuerpo de §S6 sigue diciendo
lo contrario.

**Qué hay que hacer:**

1. `:402` — sustituir la fila por lo que de verdad hay, y decir quién manda:

   ```
   | `BACKUP_REMOTE` | *(no se pone)* → `gdrive:Bamburu-backup/daily` | `gdrive_gili:Bamburu-backup-gili/daily` |
   ```

   y una línea debajo de la tabla: si existe `~/.config/bamburu/backup-destinos.conf`, **manda ese
   fichero** y `BACKUP_REMOTE` se ignora (`scripts/bamburu-backup.sh:57-64`) — que es justo lo que
   permite cambiar las dos copias con una sola escritura y sin tocar ninguna unit.

2. `:466-467` — poner primero la comprobación que sirve hoy y dejar la cifrada condicionada, como ya
   está hecho en §«Comprobaciones» (`:180-186`), que es el patrón correcto y está en el mismo
   fichero:

   ```bash
   # EN CLARO (lo que corre hoy):
   rclone ls gdrive_gili:Bamburu-backup-gili/daily/

   # CIFRADAS (solo después de ejecutar el guion de cifrado):
   rclone ls  gdrive_gili_cif:daily/                    # a través de la clave
   rclone lsf gdrive_gili:Bamburu-backup-gili-cif/ -R   # sin la clave: nombres ilegibles
   ```

3. Antes de volver a entregar, pasar el grep del plano de verdad y dejar su salida en el informe:
   `grep -rn "gdrive_cif\|gdrive_gili_cif" deploy/systemd/README.md docs/seguridad/ CLAUDE.md TABLERO.md`,
   y para cada aparición decir si está tachada, condicionada o es cierta.

**Nada más bloquea.** Los ocho criterios están verificados arriba ejecutándolos; no hay que repetir
ninguno.

---

## 3. Se construyó lo que decía el plano

**Alcance: limpio.** El commit toca **8 ficheros y los 8 están en la lista cerrada de §3** del plano
(`scripts/bamburu-backup.sh`, los dos guiones nuevos, `deploy/systemd/README.md`,
`docs/seguridad/vectores-de-ataque.md`, `CLAUDE.md`, `TABLERO.md`, el informe). Nada de `modules/`,
`core/`, `orchestrator/`, bases, migraciones ni units — comprobado con `git show --stat 7bfdee5`.
Trailer `Tarea: cifrado-copias-seguridad` presente. Los cuatro `docs/architecture/task-cifrado-*`
que aparecen en `git status` venían de antes y no están en el commit: confirmado.

**Desvíos, los tres declarados y ninguno más.** Los busqué en el diff:

1. `--include "/$name"` anclado en vez de sin anclar (`:176`). **Correcto y necesario**, y el comentario
   de `:172-175` explica por qué. Sin la barra, `cryptcheck` se lleva también `$RDIR/$name`.
2. `cryptcheck --one-way` en la migración (`cifrar-copias-de-seguridad.sh:109`). **Correcto**: el
   destino cifrado ya tendrá las copias de las noches anteriores. Verificado en mi mundo: 3 objetos
   viejos → `0 differences found` con `3 matching files`.
3. `DESTINO_ES_CRYPT` calculado una vez (`:135-136`) en lugar de llamar a `es_crypt` dentro del
   cerrojo. **Mejor que el plano**: una sola llamada a `rclone`, y las dos decisiones (rama de
   `verify_uploaded` y modo que se dice en palabras) no pueden discrepar.

Los dos retoques menores que declara (`(tamaño/huella)` en vez de `(tamaño/MD5)`, y `lsf --files-only`
en los recuentos) están en el diff y son ciertos.

## 4. El nivel de construcción

Por encima de lo exigido, y lo digo con lo que he mirado:

- **Capa y patrón.** Estado de máquina fuera de git, junto a `~/.local/state/bamburu-backup/`, que ya
  era el patrón (`:73`). Resolución por `BACKUP_LABEL`, que ya existía: **ni un `if
  principal/secundaria`**. Simulacro por defecto + `--hazlo`, como `limpiar-restos-de-gates.mjs`.
  Todo error nuevo sale por `fail_exit`, no se inventa un camino de error.
- **El fichero de estado no se hace `source`**: se parsea con un patrón estricto (`:60`). Un fichero
  de estado no ejecuta código. Bien visto.
- **Errores distinguidos, no metidos en el mismo saco.** «no aparece en el destino» / «tamaño difiere»
  / «cryptcheck no dio 0» / «cryptcheck no confirmó 0 differences» / «el destino no devuelve huellas»
  / «el descargado no es idéntico» son seis mensajes distintos, y el de `cryptcheck` lleva su última
  línea al `$LOGBUF`. Lo comprobé leyendo el email de fallo que se habría enviado.
- **Cierra lo que abre.** `trap 'rm -rf "$TMPDIR"' EXIT` en la copia; `trap limpiar EXIT` en el guion,
  que además de borrar el temporal hace `purge` del ensayo y `config delete` de lo que creó si no
  llegó al final; `trap` en el ensayo de restauración. Medido: 0 restos tras 12 ejecuciones.
- **Repetible sin duplicar efectos.** El guion se niega a pisar (paso 1) y la segunda pasada sale
  informando sin generar clave — verificado que la clave no cambió.
- **Probable por partes.** `BACKUP_DESTINOS_CONF`, `RCLONE_CONFIG`, `HOME`, `BASE_*`/`CIF_*`/`RAIZ_*`,
  `VIEJO_*`: pude ejercitar cada pieza por separado sin levantar nada ni tocar producción. Es la razón
  de que esta revisión haya podido ser una revisión y no una lectura.
- **La llave.** Generada con `openssl rand`, ofuscada **por stdin** y nunca por `argv`, impresa una
  sola vez, `unset` después, y en ningún fichero ni log. Verificado que solo aparece una vez en la
  salida.

## 5. Qué se rompe

Busqué y no encontré nada que rompa:

- **VERI\*FACTU, datos de tenant, migraciones, pantallas: cero.** El script sigue leyendo las bases
  solo por snapshot. Ninguna base, ninguna migración, ninguna ruta.
- **El botón «Lanzar copia ahora» del superadmin** (riesgo 11 del plano): comprobado de verdad, no de
  oídas. `modules/superadmin/backups.js:69` lanza el script con `env: process.env`, y el proceso web
  tiene `HOME=/home/ubuntu` (leído de `/proc/<pid>/environ`), así que el hijo lee el mismo fichero de
  destinos y el mismo `rclone.conf`. Ese fichero no se toca.
- **La migración del histórico**, que es la única pieza que puede borrar: la ejercité entera. Simulacro
  → no borra nada (3 objetos siguen ahí). `--hazlo` → copia, `cryptcheck --one-way` con `0 differences`,
  recuento independiente, borra y exige 0. Con el destino sin escritura → «la copia FALLÓ: no se ha
  borrado nada», `exit 1`, **y los 2 objetos siguen en claro**. El orden está en el código, no en la
  prosa.
- **La retención sobre `crypt`** sigue funcionando a través de la llave (la pasada cifrada completa
  llegó a ella y salió 0).

---

## Observaciones (no bloquean)

1. **El cerrojo es por etiqueta, no por fichero.** Si el fichero de destinos existe pero su línea
   `DESTINO_<label>` falta o está malformada, `REMOTE_CIF` queda vacío, `EXIGE_CRYPT=0` y esa copia
   se va **en claro** sin abortar (`scripts/bamburu-backup.sh:59-64`). Es el diseño del plano
   (riesgo 5: «preferimos copia en claro a sin copia») y no queda en silencio —el correo dice
   `EN CLARO ⚠️`—, pero conviene que esté escrito en el README junto al cerrojo, porque el guion
   escribe las dos líneas y quien las edite a mano puede degradar una copia sin enterarse.

2. **El banner de §S6 está caducado, y no es de esta tarea.** `deploy/systemd/README.md:392-395` dice
   «**ESTADO: PREPARADA, NO INSTALADA**… Hasta que exista el remote `gdrive_gili`, nada de esto está
   activo». Es falso desde hace tiempo: `bamburu-backup-secondary.timer` corrió hoy a las 03:35 y
   tiene próxima ejecución mañana (`systemctl list-timers`), y `CLAUDE.md` da S6 por cerrado. No lo
   cuento en el rechazo porque el plano no lo nombra por ningún lado; si se toca el punto 1 del
   rechazo, que está a diez líneas, sale gratis arreglarlo también.

3. **El valor ofuscado de la contraseña sí viaja por `argv`** en `rclone config create`
   (`cifrar-copias-de-seguridad.sh:204-208`), y `rclone reveal` lo deshace. Es lo que el plano
   escribió (§4.3, paso 4) y no hay forma de evitarlo con el CLI de `rclone`; además, quien pueda
   leer `ps` en esta máquina es el mismo usuario que puede leer `rclone.conf` y `data/` enteros —el
   argumento que el propio README ya hace en `:270-273`. Se queda como observación, no como defecto.

4. **La ficha sigue abierta, y está bien que lo esté.** El vector 4 no se cierra hasta que Ibrahin
   ejecute `bash scripts/cifrar-copias-de-seguridad.sh`, y los papeles lo dicen así en los cuatro
   sitios. La entrega no se ha puesto ni una medalla que no tenga.
