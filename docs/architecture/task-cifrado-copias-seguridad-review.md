✅ APROBADO

# Revisión — Cifrar las copias de seguridad (`cifrado-copias-seguridad`)

- **Análisis juzgado:** `docs/architecture/task-cifrado-copias-seguridad-analysis.md` (replanteamiento del 1 sep 2026, 8 criterios en §6)
- **Fecha de la revisión:** 1 sep 2026
- **Qué he ejercitado:** los ocho criterios, uno a uno, hoy, en dos mundos de mentira nuevos en
  `/tmp` (`RCLONE_CONFIG` y `HOME` propios, backend `local`). **No he tocado Drive, ni
  `~/.config/rclone/rclone.conf`, ni ninguna unit.** `RESEND_API_KEY` y `HEALTHCHECKS_URL` estaban
  vacíos en mi entorno, así que ninguna pasada mandó email ni ping.
- **Limpieza:** todo bajo `/tmp/rev-cif*`, borrado al terminar. `git status --porcelain` es **el
  mismo antes y después** de mis pruebas, y `/tmp` sigue con 29 G libres.

---

## Aviso previo sobre el rango de commits — léelo antes de volver a rechazar por esto

El encargo dice «Commits desde `3d43f0a`» y ahí solo hay `a11a729`, que **añade 49 líneas al
informe y nada más**. Eso no significa que no se haya construido nada: **la construcción está en
`7bfdee5`, que es ANTERIOR a `3d43f0a`**, más la corrección documental de `2b392d9`. `3d43f0a` es un
commit del orquestador (cuota y modelos por papel) que se coló en medio del hilo de la tarea y
desplazó la base de comparación.

Lo he comprobado, no lo supongo:

```
$ git show --stat 7bfdee5    → los 8 ficheros de la lista cerrada de §3, 1037 inserciones
$ git show --stat 2b392d9    → deploy/systemd/README.md + informe
$ git status --porcelain -- <los 8 ficheros de §3>   → vacío (todo comprometido)
```

**Por eso he juzgado el árbol de HEAD, no el diff de `3d43f0a..HEAD`.** Rechazar aquí «porque no hay
commits nuevos» sería rechazar por un artefacto de contabilidad del orquestador, con el trabajo hecho
y verde delante. El programador acertó al no volver a construir nada: no había nada que construir.

---

## 1. Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | **Hoy sigue habiendo copia.** Sin fichero de destinos y con `BACKUP_REMOTE` en claro, exit **0**, un artefacto por cada `.db` + `uploads-*.tar.gz`; y `grep "se valida solo por tamaño"` vacío. | **SÍ** | Pasada completa contra `fake_claro:daily`: `EXIT=0`, última línea `backup completado correctamente (45 archivos) — destino EN CLARO ⚠️`. `rclone lsf fake_claro:daily/ \| wc -l` → **45**, y en disco hay **44** bases (`control.db` + 43 tenants) + 1 tar.gz = 45. `grep -n "se valida solo por tamaño" scripts/bamburu-backup.sh` → sin salida (`rc=1`). |
| 2 | **La pasada cifrada completa funciona**, y el listado crudo no contiene `.db`, `.tar.gz` ni ningún nombre de tenant; directorios también cifrados. | **SÍ** | Con `BACKUP_DESTINOS_CONF` → `fake_cif:daily`: `EXIT=0`, `destino: fake_cif:daily — CIFRADO`, **45 archivos**, **45 líneas** `verify: cryptcheck (rc=0)`. `rclone lsf fakedrive:/tmp/rev-cif/raw -R` → 46 entradas, **0** apariciones de `.db`/`.tar.gz`; el directorio sale como `l65lnctqerp8vdhopt1qs750jg/` y los ficheros como base32. Barrí los **44** nombres derivados del disco (`basename` de cada `.db`) contra el listado crudo: **ninguna fuga**. |
| 3 | **Las dos verificaciones fallan duro**, demostrado rompiéndolas: (a) byte alterado → exit 1 por `cryptcheck` con su última línea en el log; (b) descargado sustituido por otra base válida → exit 1 por comparación byte a byte; (c) destino sin MD5 y no `crypt` → exit 1. | **SÍ** | **(a)** Control primero: destino en solo-lectura y **sin** corromper → `EXIT=0` (los snapshots son estables, así que lo que mida después es atribuible al byte). Luego `dd` de **1 byte** en `raw/…/3fmksrn78vcc…` con `touch -r` para conservar tamaño y mtime → `EXIT=1`, log: `verify: cryptcheck (rc=1) … Failed to cryptcheck: 1 differences found`. El tamaño no cambió, o sea que lo cazó `cryptcheck`, no el `stat`. **(b)** Copia mutada del script que sustituye el fichero descargado por un snapshot real de otro tenant (`PRAGMA integrity_check` = `ok`, verificado aparte) → `EXIT=1` con `restore: el fichero descargado NO es idéntico al original`, **antes** de llegar al `integrity_check`. **(c)** Destino `alias`→`crypt` (`type = alias`, sin MD5): `EXIT=1` con `verify: el destino no devuelve huellas y no es crypt: no se puede verificar`. Ningún aviso, ningún verde. |
| 4 | **El guion hace los cinco pasos en orden**: dos remotes `crypt` con la **misma** contraseña, ensayo subir-bajar-comparar, destinos en **600**, llave impresa **una** vez, ensayo borrado; y en la segunda pasada no genera clave nueva. | **SÍ** | `EXIT=0`. `b1_cif`/`b2_cif` con `type = crypt`, `filename_encryption = standard`, `directory_name_encryption = true`. `reveal` de las dos contraseñas: **coinciden**, y coinciden con la impresa (`8u/7/cuTDdQ…`). Destinos en `600` con `DESTINO_principal=b1_cif:daily` / `DESTINO_secundaria=b2_cif:daily`. `find drive1 drive2 -type f` → **0** (el ensayo se purgó). `grep -c "Contraseña :"` → **1**. Segunda pasada: «Todo puesto. Nada que hacer», `EXIT=0`, **la config queda byte a byte idéntica** (`cmp -s` contra la copia previa) y **0** apariciones de la llave. Con el fichero de destinos retirado: «Está A MEDIAS», `EXIT=1`. |
| 5 | **Si no descifra, no cambia el destino**: exit 1, el fichero de destinos **no existe**, y los `crypt` creados **ya no están**. | **SÍ** | Mundo nuevo con el backend crudo en `555` → el ensayo no puede subir. Salida: `no se pudo SUBIR el fichero de ensayo` → `EL ENSAYO HA FALLADO en 'b1_cif'. No se toca el destino de las copias.` → `DESHECHO…`, `EXIT=1`. Después: el fichero de destinos **no existe**; `rclone listremotes` devuelve solo `b1:` y `b2:` (los dos `crypt` borrados); **0** ficheros de ensayo y **0** directorios `/tmp/cif-ensayo.*`. |
| 6 | **El cerrojo no puede adelantarse a la llave**: destinos apuntando a un remote no-`crypt` → exit 1 **sin subir nada y sin crear el temporal**; borrando el fichero, vuelve a exit 0. | **SÍ** | `DESTINO_principal=fake_claro:trampa` (`type = alias`) → `FALLO: el destino 'fake_claro:trampa' viene de … pero NO es un remote crypt. Copia ABORTADA.`, `EXIT=1`. Temporales `/tmp/bamburu-backup.*`: **0 antes y 0 después**. La carpeta `trampa` **no llegó a existir** en disco (`rclone lsf` → `directory not found`, `rc=3`; `ls` → *No such file*). Sin el fichero: `EXIT=0`, `45 archivos — destino EN CLARO ⚠️`. |
| 7 | **La copia se abre partiendo solo de la llave**, con configuración temporal y **sin leer** `~/.config/rclone/rclone.conf`: `integrity_check` → `ok` y `count(*) FROM sqlite_master` **> 0**. | **SÍ** | Ejecutado con `RCLONE_CONFIG` **desactivada** y `HOME` en un directorio **sin `.config` siquiera** (`ls` → *No such file or directory*), pasando la llave por stdin y `--backend /tmp/rev-cif/raw`: lista los **44** `.db`, descarga `x-2026-09-01.db` (1 224 704 bytes), `integrity_check = ok`, **276** objetos de esquema, `✅ ENSAYO SUPERADO`, `EXIT=0`. Y no da verde de mentira: con la llave equivocada → `EXIT=1` («no se lee ningún .db»); sin contraseña por stdin → `EXIT=2`. |
| 8 | **Papeles y llave.** Las cuatro frases falsas solo aparecen **tachadas con su fecha**; la fila 4 de `vectores-de-ataque.md` dice **abierto**; `git status --porcelain` vacío y la contraseña de prueba no aparece en el repo. | **SÍ** | «Drive **CIFRADO**» y «o no hay copia»: **cero apariciones** en los cuatro ficheros. «HACE FALTA LA CONTRASEÑA» sobrevive solo en `deploy/systemd/README.md:200`, **tachada**, seguida de «⚙️ CORREGIDO EL 1 SEP 2026» y el motivo. «CÓDIGO HECHO» solo en `TABLERO.md:9304`, **tachada**, con su corrección al lado. `docs/seguridad/vectores-de-ataque.md:13` → `\| 4 \| Descargar todas las bases \| **ABIERTO** en los backups — ~~«cifrado (1 sep 2026)»~~`. Los 8 ficheros de la lista cerrada están **limpios en git**, y `git grep` de `clave-revision-rev1` / `sal-revision-rev1` no devuelve nada. Sobre el `git status --porcelain` global, ver la observación 5. |

**Ocho de ocho en SÍ.**

Los siete criterios de la ficha del TABLERO quedan cubiertos por los anteriores, y añado el que la
ficha pide en palabras propias:

- *«Una sola pieza sirve las dos copias. El script no se duplica. El fichero de destinos resuelve por
  `BACKUP_LABEL`»* — **SÍ**: el mismo `scripts/bamburu-backup.sh`, con `BACKUP_LABEL=secundaria`
  (que es justo lo que pone la unit instalada, `/etc/systemd/system/bamburu-backup-secondary.service:16`),
  lee **su** línea del mismo fichero y arranca con `destino: fake_cif:daily2 — CIFRADO`. Ni un `if
  principal/secundaria` en el código.
- *«La llave vive en el servidor con permisos 600 y no en `/etc/bamburu.env`»* — **SÍ**: vive en
  `rclone.conf`; el guion comprueba los permisos y avisa si no son `600` (lo vi dispararse con un
  `.conf` en 644). No se añadió ninguna variable a `/etc/bamburu.env` ni a ninguna unit: `git log`
  de `deploy/systemd/*.service` desde `6bd067f` está **vacío**, y la unit del repo coincide con la
  instalada.
- La receta de custodia del README, que era la que estaba rota, **la he ejecutado**: `rclone config
  show` sigue enmascarando (`password = *** ENCRYPTED ***`, lo que justifica el tachón) y la nueva,
  con `rclone config dump`, devuelve exactamente la contraseña y la sal que el guion imprimió.

---

## 2. ¿Se construyó lo que decía el análisis?

Sí, y sin desviarse de la lista cerrada de §3.

- **Ficheros tocados:** `7bfdee5` toca **exactamente** los ocho de la lista (los tres guiones,
  `deploy/systemd/README.md`, `docs/seguridad/vectores-de-ataque.md`, `CLAUDE.md`, `TABLERO.md`, el
  informe). `2b392d9` y `a11a729`, subconjuntos de esa misma lista. **Ni un hunk del orquestador
  dentro** — que fue el aviso del intento 3.
- **Nada de `modules/`, `core/`, bases, migraciones, units ni pantallas.** Confirmado por
  `git show --stat` de los tres commits.
- Las piezas del plano están donde el plano las puso: resolución del destino en `:57-64`, `es_crypt`
  en `:127`, el cerrojo en `:142-144` (después de comprobar `rclone`, **antes** de `hc_ping "/start"`
  y de crear el temporal — y lo he medido: con el cerrojo disparado no se crea ningún
  `/tmp/bamburu-backup.*`), `verify_uploaded` sin rama blanda en `:164-191`, `verify_restored` en
  `:196-198` enganchada en los **dos** sitios (`:221` y `:241`) antes del `integrity_check`/`tar -tzf`,
  y el modo en palabras en el log, el `SUMMARY` y el asunto del email.
- **Tres decisiones de construcción tomadas y declaradas** (no las traen del plano, y están bien
  tomadas y bien explicadas en el código): el `/` que ancla el filtro de `cryptcheck` a la raíz —sin
  él `--include` casa a cualquier profundidad y se llevaba también el fichero de la prueba de
  restore—; el `--one-way` de la migración, porque el destino cifrado ya tendrá las copias de noches
  anteriores; y resolver el tipo del destino **una** sola vez. Esto es exactamente lo que manda
  `CLAUDE.md`: decidir, construir y dejarlo escrito con su motivo.

---

## 3. Nivel de construcción

- **Capa y patrón:** todo en `scripts/` y documentación. El estado fuera del repo
  (`~/.config/bamburu/`) sigue el patrón que ya existía con `~/.local/state/bamburu-backup/`. El
  simulacro por defecto + `--hazlo` copia el de `limpiar-restos-de-gates.mjs`. No inventa una capa al
  lado.
- **Una pieza, una cosa:** `verify_uploaded` verifica subida, `verify_restored` compara, `es_crypt`
  responde una pregunta. El guion de encendido y el de ensayo de restauración están separados a
  propósito, y el segundo se puede correr solo.
- **Nada escrito a mano donde debería haber configuración:** los remotes, raíces y rutas del guion de
  encendido son parámetros con los valores de producción por defecto (`BASE_1`…`RAIZ_2`), y por eso
  he podido ejecutarlo entero en `/tmp` sin tocar nada real. `BACKUP_DESTINOS_CONF` es la única
  variable nueva y no entra en ninguna unit.
- **Errores distinguidos:** «no aparece en el destino» ≠ «tamaño difiere» ≠ «cryptcheck no dio 0» ≠
  «cryptcheck no confirmó 0 differences» ≠ «el destino no devuelve huellas» ≠ «el descargado no es
  idéntico». Los he visto salir por separado. Y la última línea de `cryptcheck` va al log siempre:
  en el fallo real ponía `Failed to cryptcheck: 1 differences found`, que es justo lo que hace útil
  el email de las 03:33.
- **Cierra lo que abre:** `trap 'rm -rf "$TMPDIR"' EXIT` en la copia; en el guion de encendido, un
  `limpiar()` que purga el ensayo **y** borra los remotes creados si no se llegó al final; en el
  ensayo de restauración, `trap` del directorio temporal. Medido: tras las pasadas rotas no quedó ni
  un `/tmp/cif-ensayo.*` ni un `/tmp/ensayo-restauracion.*`.
- **Repetible sin duplicar efectos:** la copia se puede correr N veces; el guion de encendido se
  **niega** a pisar y lo demuestra dejando la config byte a byte idéntica.
- **Se prueba por partes:** los tres guiones aceptan `RCLONE_CONFIG`, `HOME` y `BACKUP_DESTINOS_CONF`,
  y `ensayo-restauracion-cifrada.sh` acepta `--backend`. He ejercitado cada pieza por separado sin
  levantar nada. Esto es lo que hizo posible una revisión de verdad en vez de una lectura.
- **Sin rama blanda en ningún lado.** Es el corazón de la tarea y está cumplido: no hay un solo
  camino en el que la verificación escriba un aviso y devuelva 0.

Detalle que merece la pena decir en voz alta: el `cc_rc=$?` de `:177` está en su **propia línea**,
después de `local cc_out cc_rc` de `:165`. Si se hubiera escrito `local cc_out="$(...)"`, `$?` habría
sido el de `local` y **cryptcheck nunca habría podido fallar**. Está bien hecho, y es el sitio exacto
donde esta clase de código se rompe en silencio.

## 4. Qué se rompe

- **Datos que ya existen:** los `crypt` nacen sobre raíces **nuevas** (`Bamburu-backup-cif`), así que
  el histórico en claro no se toca. Que ese histórico ya no caduque solo está medido, declarado en
  README y TABLERO, y tiene su herramienta (`--migrar-historico`, simulacro por defecto). Bien
  resuelto: el vector 4 no se declara cerrado por haberlo ignorado.
- **VERI\*FACTU, tenants, migraciones, pantallas:** cero. El script sigue leyendo por snapshot como
  ya hacía. El botón «Lanzar copia ahora» (`modules/superadmin/backups.js:11`) lanza el **mismo**
  script como hijo del mismo usuario, así que ve el mismo fichero de destinos; no se tocó ese fichero.
- **Concurrencia:** cada pasada usa su propio `mktemp -d`; principal y secundaria escriben marcas
  distintas (`BACKUP_SUFFIX`). Si las dos coincidieran en el reloj (03:33 y 03:35) no se pisan.
- **Riesgos declarados en §5 del análisis:** los 13 están mitigados o asumidos por escrito. Los tres
  que más costaban los he visto funcionar: el 2 (re-ejecutar generaría otra clave → se niega), el 3
  (`config create` devuelve 0 sin escribir → relee y compara `reveal`) y el 4 (quedarse sin copia →
  imposible por construcción; lo he provocado y esa noche la copia sale en claro y verde).
- **El fallo que rompió el 1 de septiembre ya no tiene dónde ocurrir.** No es una promesa del
  informe: con el fichero de destinos apuntando a algo que no es `crypt`, la copia aborta **antes de
  crear el temporal**; y sin fichero, la condición ni se evalúa. Las dos mitades medidas.

---

## Observaciones (no bloquean)

1. **La contraseña ofuscada viaja por `argv` de `rclone config create`.**
   `scripts/cifrar-copias-de-seguridad.sh:204-208` y `scripts/ensayo-restauracion-cifrada.sh:66-70`.
   El `obscure` va por stdin, como manda el convenio (a) del plano — pero su resultado se pasa como
   argumento, y `/proc/<pid>/cmdline` es legible por cualquier usuario local; `rclone reveal` lo
   deshace. El plano prescribe literalmente esta línea, así que **no es una desviación**, y en un
   servidor de un solo usuario la ventana es teórica. Si algún día se quiere cerrar: las variables
   `RCLONE_CONFIG_<REMOTE>_PASSWORD` viven en `environ`, que sí está restringido al dueño.

2. **`migrar_una` no distingue «no hay nada» de «no pude listar».**
   `scripts/cifrar-copias-de-seguridad.sh:96-98`: `rclone lsf … 2>/dev/null | wc -l`, y si sale 0 dice
   «nada que migrar» y devuelve **0**. Un fallo de listado se leería como histórico vacío. No destruye
   nada (por ese camino no se borra), así que el daño es un mensaje que tranquiliza de más — pero es
   la misma familia que «un censo que dice CERO y no es cierto». `--migrar-historico` no está cubierto
   por ningún criterio, y por eso queda aquí y no arriba.

3. **`node` sin ruta absoluta** en `cifrar-copias-de-seguridad.sh:226` y
   `ensayo-restauracion-cifrada.sh:58`, mientras `bamburu-backup.sh` usa `/usr/bin/node`. Los dos
   guiones los ejecuta una persona en una terminal normal, así que el `PATH` está; solo señalo la
   asimetría por si alguno acaba en un timer.

4. **`es_crypt` mira el tipo del remote nombrado, no el de la cadena resuelta**
   (`scripts/bamburu-backup.sh:127`): un `alias` que apunte a un `crypt` se ve como no-cifrado. Lo he
   provocado y **falla por el lado seguro**: sin fichero de destinos exige MD5 y aborta ruidosamente;
   con fichero, salta el cerrojo. Ningún camino da verde de mentira, que es lo que importa.

5. **Sobre el `git status --porcelain` del criterio 8, y esto no es del programador.** El árbol tiene
   cambios sin confirmar, y **ninguno pertenece a esta tarea**: seis ficheros del orquestador, un test
   sin seguimiento, y una sección de `TABLERO.md` sobre «botones-telegram» (comprobado: su diff no
   menciona el cifrado ni una vez). Los ocho ficheros de la lista cerrada están limpios.
   Aparte de eso, hay algo que conviene que alguien mire: en el árbol,
   `docs/architecture/task-cifrado-copias-seguridad-review-intento-1.md` ha pasado de las 213 líneas
   que empezaban por un veredicto negativo a 170 que empiezan por «APROBADO» —es decir, la rotación
   del orquestador ha sobrescrito el registro histórico que `d7598c9` guardó **a propósito**, con el
   argumento de que los intentos descartados no se tiran—. El programador lo detectó, no lo tocó y lo
   dejó escrito, que era exactamente lo que tenía que hacer. Yo tampoco lo toco: no es de esta tarea.

6. **Lo que sigue pendiente, y está bien que lo esté.** Las copias van **EN CLARO**, el vector 4 sigue
   **ABIERTO** y la ficha **no se cierra**. Falta una orden de Ibrahin:
   `bash scripts/cifrar-copias-de-seguridad.sh`. El plano lo pone fuera del alcance de esta entrega
   («Anexo — NO se juzga en esta entrega») y el informe lo dice sin adornos. Cerrar la ficha aquí
   sería el verde que miente que esta tarea vino a matar; dejarla abierta con el mecanismo construido,
   probado y apagado es la respuesta correcta.
