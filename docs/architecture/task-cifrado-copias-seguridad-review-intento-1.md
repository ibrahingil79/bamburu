✅ APROBADO

# Revisión — Cifrar las copias de seguridad (intento 5, `2b392d9`)

- **revisado:** `git diff 7bfdee5..HEAD` (1 commit, 2 ficheros) — la ronda de corrección del rechazo
  del intento anterior. Los tres guiones quedan **byte a byte como en `7bfdee5`** (comprobado:
  `git diff --stat 7bfdee5..HEAD -- scripts/` no devuelve nada).
- **plano:** `docs/architecture/task-cifrado-copias-seguridad-analysis.md` (♻️ REPLANTEAMIENTO)
- **cómo lo he juzgado:** **no me he fiado de la revisión anterior.** He vuelto a ejecutar los ocho
  criterios yo mismo, en mi propio mundo de mentira (`/tmp/rev2-cif`, `/tmp/rev2-guion`,
  `/tmp/rev2-guion-roto`, `/tmp/rev2-migra`; backend `local`, `RCLONE_CONFIG` y `HOME` propios,
  `BACKUP_HC_URL=""`, `RESEND_API_KEY` y `HEALTHCHECKS_URL` vacíos — comprobado antes de empezar).
  **Ni una orden contra Drive.** Al terminar: `~/.config/rclone/rclone.conf` intacto (mtime 10:27,
  **0** remotes `crypt`), `~/.config/bamburu` **sigue sin existir** (las copias siguen EN CLARO),
  **0** restos en `/tmp` (`rev2-*`, `bamburu-backup.*`, `cif-ensayo.*`, `ensayo-restauracion.*`),
  y `git status` idéntico a como estaba.

**Los dos puntos del rechazo anterior están corregidos, y las dos observaciones no bloqueantes
también.** Lo he medido contra el sistema real, no leyendo el informe: la fila de `BACKUP_REMOTE`
del README dice ahora exactamente lo que dicen `scripts/bamburu-backup.sh:64` y la unit **instalada**
en `/etc/systemd/system/`, y el bloque de instalación de la segunda copia ya no manda ejecutar
órdenes contra un remote que no existe. Los ocho criterios pasan.

---

## 1. Criterios de aceptación

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | **Hoy sigue habiendo copia.** Sin fichero de destinos y con `BACKUP_REMOTE` en claro → exit 0, un artefacto por base + `control.db` + `uploads`; y sin la rama blanda | SÍ | Ejecutado: `BACKUP_REMOTE=fake_claro:daily` → **exit=0**, log `destino: fake_claro:daily — EN CLARO ⚠️` y `backup completado correctamente (27 archivos)`. `rclone lsf fake_claro:daily/ --files-only \| wc -l` → **27**, que es el número que toca hoy: `ls data/tenants/*.db \| wc -l` = **25**, +`control.db` +`uploads-2026-09-01.tar.gz` = 27 (el «23» del plano se midió con 21 tenants; ver observación 1). `grep -n "se valida solo por tamaño" scripts/bamburu-backup.sh` → **rc=1, 0 líneas** |
| 2 | **La pasada cifrada completa funciona**, y en crudo no se lee nada | SÍ | Ejecutado con `BACKUP_DESTINOS_CONF` → **exit=0**, `destino: fake_cif:daily — CIFRADO`, **27** artefactos a través de la llave. Listado **crudo** (`rclone lsf fakedrive:…/raw -R`, 28 líneas): **0** `.db`, **0** `.tar.gz`; un solo directorio, `f72kfkqikfb66b525d7k0l1a4s/` (cifrado también), y dentro solo base32. Fuga de nombres **0**, comprobado recorriendo `data/tenants/*.db` + `control.db` **del disco** y buscando cada nombre en el listado crudo, no contra una lista escrita a mano. **Precedencia verificada:** la pasada llevaba `BACKUP_REMOTE=fake_claro:daily` puesto y aun así fue al cifrado (`scripts/bamburu-backup.sh:59-64`) |
| 3 | **Las dos verificaciones fallan duro, y se demuestra rompiéndolas** | SÍ | **(a)** Control primero: destino crudo en solo lectura y **sin** corromper → **exit=0** (el montaje no rompe nada por sí solo). Después, localizado el objeto crudo de `control-2026-09-01.db` con `rclone cryptdecode --reverse` y alterado **un byte** (`dd seek=100000 conv=notrunc`; tamaño **266352 → 266352**, idéntico) → **exit=1**, log `verify: cryptcheck (rc=1) NOTICE: Failed to cryptcheck: 1 differences found` + `verify: cryptcheck NO dio 0`; esa línea entra en `$LOGBUF` vía `log` (`:180`), o sea llega al email de fallo. **(b)** Sustituido el fichero **descargado** por `helados-ibrahin.db` (real, `integrity_check`=**ok**, 282 objetos, **exactamente los mismos 1.261.568 bytes** que `duniya.db`): `restore: el fichero descargado NO es idéntico al original` → **exit=1**, y en esa misma pasada `verify: cryptcheck (rc=0)` había dado OK — **lo cazó solo la comparación byte a byte**. *(Esta es la única prueba que no puede correr sobre el guion sin tocar: sustituir lo ya descargado exige interceptar entre la descarga y el `cmp`. Lo hice con una copia del script en `/tmp` con **una** línea inyectada justo después de `:220`, todo lo demás idéntico — 265 vs 266 líneas.)* **(c)** Destino en claro sin MD5 (`alias` sobre un `crypt`: `type = alias`, `rclone hashsum MD5` → `hash type not supported`, rc=1) → `verify: el destino no devuelve huellas y no es crypt` → **exit=1**, nunca un aviso |
| 4 | **El guion hace los cinco pasos en orden**, y la segunda vez no genera clave | SÍ | Ejecutado entero en `/tmp/rev2-guion` → **exit=0**. Después: `destinos.conf` en **600** con las dos líneas (`DESTINO_principal` / `DESTINO_secundaria`); `cif1` y `cif2` con `type = crypt`; los dos `reveal` **coinciden entre sí y con la clave impresa** (44 caracteres, comparados sin volver a imprimirlos); `Contraseña :` aparece **1** vez; **0** objetos de ensayo en las dos raíces y **0** dirs `/tmp/cif-ensayo.*`. **Segunda ejecución:** «El cifrado ya está creado: este guion NO vuelve a generar ninguna clave», imprime el estado, **exit=0**, `Contraseña :` aparece **0** veces, y verificado que **la clave no cambió** |
| 5 | **Si no descifra, no cambia el destino** | SÍ | Roto el ensayo (raíz cruda sin escritura) **en los dos sitios**. **Caso A** (falla `cif1`) y **caso B** (`cif1` bien, falla `cif2`): los dos dan **exit=1**, «EL ENSAYO HA FALLADO … DESHECHO», el fichero de destinos **NO existe**, `rclone listremotes` vuelve a `base1: base2:` (los dos `crypt` borrados), **0** restos del ensayo en la raíz del remote que sí había funcionado, **0** dirs `/tmp/cif-ensayo.*`, y la llave **no se imprimió ninguna de las dos veces** |
| 6 | **El cerrojo no puede adelantarse a la llave** | SÍ | Fichero de destinos apuntando a un remote que **no** es `crypt` → **exit=1** con `el destino 'fake_claro6:daily' viene de /tmp/rev2-cif/dest6.conf pero NO es un remote crypt. Copia ABORTADA.`; **0** líneas `snapshot consistente`, **0** objetos en el destino, **0** temporales `/tmp/bamburu-backup.*` (el cerrojo va en `:142`, antes del `hc_ping "/start"` de `:148` y del `mktemp` de `:150`). Borrado ese fichero, la misma copia → **exit=0** con **27** artefactos |
| 7 | **La copia se abre partiendo solo de la llave** | SÍ | `scripts/ensayo-restauracion-cifrada.sh --backend /tmp/rev2-cif/raw`, llave por **stdin**, con el **`HOME` real** y sin `RCLONE_CONFIG` heredado (`env -u`): `✅ ENSAYO SUPERADO`, `x-2026-09-01.db` (1224704 bytes), `integrity_check ok`, **276** objetos de esquema. Que la llave sale del stdin y de ningún otro sitio está medido: `grep -c '^type = crypt' ~/.config/rclone/rclone.conf` → **0** (solo `gdrive` y `gdrive_gili`), y con la **contraseña equivocada** el mismo ensayo da **exit=1** («no se lee ningún .db…»). **0** dirs `/tmp/ensayo-restauracion.*` al terminar |
| 8 | **Papeles y llave** — las cuatro frases falsas de §1.4, la fila 4 en «abierto», y el árbol limpio | SÍ | `grep -rn` en `deploy/systemd/README.md`, `docs/seguridad/`, `CLAUDE.md`, `TABLERO.md`: «Sube cada artefacto a Drive **CIFRADO**» → **0** (`README.md:108` dice ahora «con nombre fechado»); «o no hay copia» → **0**; «HACE FALTA LA CONTRASEÑA» → solo `README.md:200`, **dentro de `~~ ~~`** y con su corrección fechada debajo; «CÓDIGO HECHO» y «exige destino» → solo `TABLERO.md:9230`, **dentro de `~~ ~~`**. `docs/seguridad/vectores-de-ataque.md:13` → fila 4 = **`**ABIERTO**` en los backups — ~~«cifrado (1 sep 2026)»~~**; fila 7 = **Parcial**. `git grep` de mi contraseña de pruebas → **nada**, y `git status` sin un solo residuo mío |

---

## 2. Se construyó lo que decía el plano

**Alcance: limpio, en las dos rondas.**

- `2b392d9` toca **2 ficheros**: `deploy/systemd/README.md` y el informe. Los dos están en la lista
  cerrada de §3 del plano. Trailer `Tarea: cifrado-copias-seguridad` presente.
- El commit base `7bfdee5` tocaba **8 ficheros** y los 8 están en esa misma lista
  (`git show --stat 7bfdee5`): los tres guiones, el README de systemd, los vectores de ataque,
  `CLAUDE.md`, `TABLERO.md` y el informe. Ni `modules/`, ni `core/`, ni `orchestrator/`, ni bases,
  ni migraciones, ni units.
- Los ficheros de `orchestrator/*` que aparecen modificados en `git status` **no están en ninguno de
  los dos commits** (`git diff 7bfdee5..HEAD --name-only` → solo README + informe) y su contenido es
  mantenimiento del propio orquestador (un `StringDecoder` para la lectura de `/usage`), ajeno a esta
  tarea. No cuenta como alcance de esta entrega.

**Los dos puntos del rechazo anterior, verificados uno a uno contra el sistema, no contra el informe:**

1. `deploy/systemd/README.md:413` — la fila dice ahora
   `| BACKUP_REMOTE | *(no se pone)* → gdrive:Bamburu-backup/daily | gdrive_gili:Bamburu-backup-gili/daily |`.
   **Medido:** `scripts/bamburu-backup.sh:64` tiene ese default, y
   `/etc/systemd/system/bamburu-backup-secondary.service:15` **y** la del repo dicen las dos
   `Environment=BACKUP_REMOTE=gdrive_gili:Bamburu-backup-gili/daily`. Coinciden. Y debajo (`:418-421`)
   se dice **quién manda de verdad**, con la referencia correcta (`scripts/bamburu-backup.sh:57-64`).
   Lo viejo va tachado con fecha y motivo (`:423`), que es el método del repo.
2. `deploy/systemd/README.md:486-495` — el bloque se ha partido en **`# EN CLARO (lo que corre hoy)`**
   (`rclone ls gdrive_gili:Bamburu-backup-gili/daily/`, que sí existe) y **`# CIFRADAS (solo después
   de ejecutar el guion de cifrado)`**. Es el mismo patrón que §«Comprobaciones» (`:183-190`).
3. El `grep` del plano, pasado por mí: las **9** apariciones de `gdrive_cif`/`gdrive_gili_cif` en el
   README caen exactamente en las líneas que el informe clasifica (189, 200, 202, 208, 219, 328, 338,
   423, 494) y he leído el contexto de cada una: **tres tachadas**, **cuatro condicionadas** a
   «después de ejecutar el guion», **dos ciertas** (son las que explican por qué las anteriores eran
   falsas). `CLAUDE.md:34` y `TABLERO.md:8424` narran la avería **en pasado**. Ninguna afirma que esos
   remotes existan hoy.

**Las dos observaciones no bloqueantes del intento anterior, hechas también** (y las dos dentro del
README, que está en la lista cerrada, así que no abren alcance):

- El cerrojo **por copia y no por fichero** está ahora escrito junto al cerrojo (`:120-124`), con el
  aviso de que el guion escribe las dos líneas y quien las edite a mano puede degradar una.
- El banner de §S6 «PREPARADA, NO INSTALADA» está tachado con fecha (`:396-404`). **Verificado que la
  corrección es cierta:** `systemctl list-timers` da `bamburu-backup-secondary.timer` con LAST
  `2026-09-01 03:35:00` y NEXT `2026-09-02 03:35:00`, y las dos units están en
  `/etc/systemd/system/`.

**Desvíos declarados:** los tres del informe (`--include "/$name"` anclado, `cryptcheck --one-way` en
la migración, `DESTINO_ES_CRYPT` calculado una vez) siguen siendo los únicos, y los tres son
correctos. El anclado lo he ejercitado sin querer en el criterio 3(b): el `restore/` del temporal
está en el mismo árbol que cryptcheck recorre, y sin la barra inicial el filtro se lo lleva.

## 3. El nivel de construcción

Por encima del mínimo, y lo digo con lo que he mirado ejecutándolo:

- **Capa y patrón.** Estado de máquina fuera de git, al lado de `~/.local/state/bamburu-backup/`, que
  ya era el patrón del propio script (`:73`). El destino se resuelve por `BACKUP_LABEL`, que ya
  existía: **ni un `if principal/secundaria`** en todo el diff. Simulacro por defecto + `--hazlo`,
  igual que `limpiar-restos-de-gates.mjs`. Todo error nuevo sale por `fail_exit`.
- **El fichero de estado no se hace `source`:** se parsea con un patrón estricto (`:60`). Un fichero
  de estado no ejecuta código.
- **Una pieza no hace dos cosas.** `verify_uploaded` verifica, `verify_restored` compara,
  `es_crypt` decide el tipo, el guion enciende y `--migrar-historico` migra. El cerrojo son tres
  líneas colocadas en el único sitio donde valen: antes del ping y antes del temporal.
- **Errores distinguidos, no en el mismo saco.** «no aparece en el destino» / «tamaño difiere» /
  «cryptcheck NO dio 0» / «cryptcheck no confirmó 0 differences» / «el destino no devuelve huellas» /
  «el descargado no es idéntico» son seis mensajes distintos, y el de `cryptcheck` arrastra su última
  línea al log. Los he visto salir en cuatro corridas rojas diferentes.
- **Nada escrito a mano donde debería haber configuración.** Los remotes, las raíces, el fichero de
  destinos, el `RCLONE_CONFIG` y el `HOME` son parámetros de entorno en los tres guiones. Es
  precisamente lo que me ha permitido revisar esto **ejecutándolo** en vez de leerlo.
- **Cierra lo que abre.** `trap 'rm -rf "$TMPDIR"' EXIT` en la copia; `trap limpiar EXIT` en el guion,
  que además hace `purge` del ensayo y `config delete` de lo que creó si no llegó al final; `trap` en
  el ensayo de restauración. Medido tras **~15 ejecuciones**: **0** temporales vivos de las cuatro
  familias.
- **Repetible sin duplicar efectos.** El guion se niega a pisar (paso 1) y la segunda pasada informa
  sin generar clave — verificado que la clave no cambia. La copia es idempotente como siempre.
- **La llave.** `openssl rand`, ofuscada **por stdin** (nunca por `argv`), impresa **una** vez,
  `unset` después, y en ningún fichero ni log. Verificado contando apariciones en la salida.

## 4. Qué se rompe

- **VERI\*FACTU, datos de tenant, migraciones, pantallas: cero.** El script sigue leyendo las bases
  solo por snapshot (`db-snapshot.mjs`), como ya hacía. Ninguna base, ninguna migración, ninguna ruta.
- **El botón «Lanzar copia ahora» del superadmin** (riesgo 11 del plano): comprobado.
  `modules/superadmin/backups.js:69` lanza el script con `env: process.env`, y el proceso web corre
  con `HOME=/home/ubuntu` (leído de `/proc/<MainPID>/environ`), así que el hijo lee el mismo fichero
  de destinos y el mismo `rclone.conf`. Ese fichero no se toca.
- **La migración del histórico**, que es la única pieza capaz de borrar: la ejercité entera, con una
  copia «de esta noche» ya puesta en el destino para que `--one-way` tuviera sentido. Simulacro → los
  3 objetos siguen ahí. `--hazlo` → copia, `cryptcheck --one-way` con `0 differences found` y `3
  matching files`, recuento independiente (4 ≥ 3), `--dry-run`, y solo entonces borra: quedan **0** en
  claro y **4** legibles a través de la llave. **Nada se destruyó: los mismos objetos existen dentro
  del contenedor cifrado.** Con el destino sin escritura: `la copia FALLÓ: no se ha borrado nada`,
  **exit=1**, y los **2** objetos en claro siguen intactos. El orden está en el código, no en la prosa.
- **La retención sobre `crypt`** sigue funcionando a través de la llave (la pasada cifrada llegó a
  ella y salió 0).
- **Riesgos del plano:** el 4 («quedarse sin copia») está mitigado por construcción y demostrado por
  el criterio 6; el 5 («el fichero de destinos se pierde») queda declarado y **ya escrito en el
  README**; el 6 (el histórico que no caduca solo) tiene su herramienta y está dicho en los papeles
  que sin ese paso el vector 4 no está cerrado. **Sigue sin encenderse el cifrado, y está bien:**
  `~/.config/bamburu` no existe, las copias van EN CLARO y el correo lo dice.

---

## Observaciones (no bloquean)

1. **El «23» del plano son hoy 27, y el motivo merece una mirada de otro.** `data/tenants/` tiene
   **25** bases, de las cuales **17** son restos de gates (`gate-albaranes-*`, `gate-mostrador-*`,
   `gate-pedidos-*`, `gate-presupuestos-*`, `gate-visual-*`, `__gate_7b9b90_no_existe`,
   `negocio-vecino-1788262439019`). El criterio dice «un artefacto por cada `data/tenants/*.db`» y eso
   se cumple exactamente; no es un fallo de esta entrega. Pero significa que **cada noche se suben,
   verifican, descargan y restauran 17 bases de basura de pruebas**, y a partir del cifrado también se
   cryptcheckean. Es la deuda de `CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra», no de esta
   tarea; lo dejo apuntado porque la cifra del plano se queda vieja sola.

2. **El nombre del remote en el fichero de destinos no admite guiones.** El patrón de
   `scripts/bamburu-backup.sh:60` acepta `[A-Za-z0-9_]+:` en la parte del remote. Con los valores por
   defecto (`gdrive_cif`, `gdrive_gili_cif`) no hay problema, pero si alguien ejecutase el guion con
   `CIF_1=gdrive-cif`, el guion escribiría una línea que la copia **ignoraría en silencio** y esa copia
   se iría en claro. No queda mudo (el correo dice `EN CLARO ⚠️`) y hace falta salirse de los valores
   por defecto para provocarlo, así que es observación y no defecto. Si se toca alguna vez, basta con
   añadir `-` a esa clase de caracteres.

3. **En modo cifrado cada artefacto viaja dos veces de vuelta:** una para `cryptcheck` (que baja el
   objeto remoto para hashearlo con su nonce) y otra para la prueba de restore. Es el precio de no
   tener rama blanda y está bien pagado, pero conviene saberlo antes de la primera noche cifrada
   contra Drive de verdad: la ventana de la copia se alarga.

4. **La ficha sigue abierta, y está bien que lo esté.** El vector 4 no se cierra hasta que Ibrahin
   ejecute `bash scripts/cifrar-copias-de-seguridad.sh`. Los papeles lo dicen en los cuatro sitios y
   la entrega no se ha puesto ni una medalla que no tenga.
