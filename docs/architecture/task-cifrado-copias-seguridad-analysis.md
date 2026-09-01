♻️ REPLANTEAMIENTO

# Análisis — Cifrar las copias de seguridad

- **id:** `cifrado-copias-seguridad`
- **origen:** `TABLERO.md:8405` (ficha **REESCRITA el 1 sep 2026**, con las decisiones de Ibrahin dentro)
- **cierra:** el **vector 4 entero** y **la mitad** del **vector 7** de `docs/seguridad/vectores-de-ataque.md`
  (la otra mitad es `manifiesto-huellas-backups`)
- **fecha del plano:** 1 sep 2026 · todo lo que digo «medido» lo he medido **hoy**, en esta sesión,
  contra el árbol y contra un mundo de mentira en `/tmp`. **No he tocado Drive ni el `rclone.conf`
  de producción** (comprobado: `~/.config/rclone` me responde `Read-only file system`).
- **sin `firma:`** — esta tarea no inventa ninguna promesa nueva: construye una decisión que Ibrahin
  ya tomó y dejó escrita en la ficha. No lleva apartado `LA PROMESA`.

---

> ## ⚠️ LO QUE ESTA TAREA NECESITA EJECUTAR — ARRIBA DEL TODO, COMO PIDE `RITUAL.md` §78
>
> Esto es lo único que hay que ejecutar, y **es cómo se construyen estas piezas**, no un barrido:
>
> 1. `rclone` contra un **mundo de mentira en `/tmp`** (`RCLONE_CONFIG` propio, backend `local`).
>    Ni una orden contra Drive, ni de lectura.
> 2. **`scripts/bamburu-backup.sh` de punta a punta contra ese mundo**, con `HOME` falso en `/tmp`,
>    dos veces: una en claro y otra cifrada. Es la única forma de comprobar el criterio 1 y el 2.
> 3. Los dos guiones nuevos, contra ese mismo mundo.
>
> **Esto NO autoriza —y este plano no pide— ningún `scripts/run-gates.mjs`,** ni el corto, ni el
> completo, ni ningún gate de navegador. Ningún criterio de §6 los necesita.
>
> **Seguro medido para esa ejecución:** en el entorno del agente `RESEND_API_KEY` y
> `HEALTHCHECKS_URL` están **vacíos** (comprobado hoy), así que el script **no manda ningún email ni
> ningún ping**. Con `HOME` en `/tmp` tampoco pisa las marcas de éxito reales, así que el heartbeat
> no se entera. `data/` ocupa **106 MB** y quedan **29 GB** libres: una pasada completa gasta ~320 MB
> de temporal y los borra en su `trap`.

---

## Por qué esto es un replanteamiento, y qué cambia

| Intento | Qué pasó | Por qué falló |
|---|---|---|
| 1 y 2 | «El análisis es imposible». **Cero commits.** | La ficha vieja llevaba dentro un paso —*«para y dime lo que has encontrado antes de seguir»*— que solo funciona con una persona delante. El orquestador no tiene con quién parar. |
| 3 (`5834d79`) | **Construyó bien**: guardián `crypt`, `verify_uploaded` con `cryptcheck`, `verify_restored` con MD5, documentación sincerada. El revisor lo ejercitó pieza a pieza y lo dio por bueno. | **Rechazado igual.** 4 de los 7 criterios del plano solo los podía cumplir Ibrahin a mano, y no se cumplieron. Peor: **el código se quedó puesto y vivo con la tarea apartada**, exigiendo unos remotes `crypt` que nunca existieron → **las dos copias de la madrugada siguiente habrían abortado.** |
| replanteo 0 (`…-analysis-replanteo-0.md`) | Declaró 🛑 TAREA MAL PLANTEADA y propuso partirla en dos fichas, **manteniendo el guardián duro puesto** mientras tanto (su «alternativa 2 descartada» era, literalmente, devolver el destino a texto claro). | Lo revirtió el dueño. Ibrahin devolvió el destino a claro (`6bd067f`) con este argumento: *«los datos actuales son de prueba y que vayan en claro una noche más no expone nada real; quedarme sin copia sí es riesgo»*. Aquel plano optimizaba el criterio y **se dejaba fuera la copia**. |

**Qué cambio del enfoque, en una frase:** los tres intentos anteriores trataban el cifrado como un
**interruptor en el código** que alguien tenía que ir a acompañar a mano con la configuración. Este
plano lo trata como un **estado del servidor**: el código sabe funcionar en los dos mundos, y el que
crea el mundo cifrado es el mismo que lo enciende, **en la misma pasada y solo después de haber
descifrado un fichero de verdad**. El instante peligroso —«el código exige cifrado y el cifrado no
existe»— deja de ser una ventana de horas para dejar de existir: no hay ninguna línea de este plano
en la que pueda ocurrir.

**Por qué esta vez sí:**

1. **Ya no hay decisiones abiertas.** La ficha reescrita trae dónde vive la llave, que hay copia por
   pantalla y que la comprobación nocturna descifra. No queda nada que preguntar → nada donde
   atascarse.
2. **Ya no hay criterios que dependan de las manos de Ibrahin.** Los ocho de §6 se comprueban en
   `/tmp` sin red, sin `sudo` y sin `rclone.conf`. Lo de Ibrahin es una orden al final, no un criterio.
3. **El fallo del intento 3 está convertido en criterio** (el 6): con la configuración de hoy las dos
   copias tienen que seguir dando **exit 0**, y hay que demostrarlo borrando un fichero.

---

## 1. Qué está mal hoy

### 1.1 La verificación de subida tiene una rama blanda, y cifrar la dispara

`scripts/bamburu-backup.sh:109-110`:

```bash
if [ -n "$rmd5" ]; then [ "$lmd5" = "$rmd5" ] || { log "  verify: MD5 difiere"; return 1; }
else log "  verify: Drive no devolvió MD5 (se valida solo por tamaño)"; fi
```

Si Drive no devuelve MD5, la función **escribe un aviso y devuelve 0**. Y `rmd5` sale vacío
justamente cuando el destino es `crypt`. **Medido hoy** en un crypt local:

```
$ rclone hashsum MD5 fake_cif:daily/prueba-2026-09-01.db
ERROR : prueba-2026-09-01.db: hash unsupported: hash type not supported     ← rc=1, stdout vacío
```

y `:106` se traga ese error con `2>/dev/null`. Es decir: **cifrar sin tocar esta función apagaría la
verificación dejándola en verde**, con el correo diciendo «subido, verificado y restore OK». Es el
patrón que `CLAUDE.md` tiene escrito con nombre propio — *un censo que dice CERO y no es cierto es
peor que no tenerlo, porque cierra la pregunta*.

### 1.2 La prueba de restauración no compara el fichero: solo pregunta si abre

`scripts/bamburu-backup.sh:135-136` descarga el artefacto y lo único que exige es
`PRAGMA integrity_check == ok`. **`integrity_check` responde `ok` a cualquier base válida, aunque sea
otra**: el intento 3 lo midió sustituyendo el fichero descargado por `data/tenants/duniya.db`, y
pasaba en verde. Hoy no hay ninguna comparación entre lo que subió y lo que bajó.

### 1.3 Las copias van en claro, y los nombres hablan sin abrir un fichero

`scripts/bamburu-backup.sh:32` → `gdrive:Bamburu-backup/daily`, y
`deploy/systemd/bamburu-backup-secondary.service:15` → `gdrive_gili:Bamburu-backup-gili/daily`. Los
dos son remotes `drive` normales (`rclone listremotes` hoy: **solo `gdrive:` y `gdrive_gili:`**). El
listado publica `peluqueria-gil-…`, `helados-ibrahin-…`, `inversiones-disan-…`: cuántos negocios hay
y cómo se llaman. Hoy son **23 artefactos por copia** (21 `data/tenants/*.db` + `control.db` +
`uploads-*.tar.gz`), con 203 clientes y 922 facturas dentro.

### 1.4 Los papeles siguen afirmando que el cifrado está puesto. En cuatro sitios

La reversión de `6bd067f` corrigió `CLAUDE.md` y puso un aviso en dos sitios, pero **el cuerpo se
quedó atrás** — que es exactamente lo que `CLAUDE.md` §«Un titular de recuento se corrige con el
cuerpo que lo desarrolla» prohíbe:

| Dónde | Qué dice hoy, y es falso |
|---|---|
| `deploy/systemd/README.md:107-119` | «Sube cada artefacto a Drive **CIFRADO**», «El destino tiene que ser `crypt` o no hay copia», «compara el tamaño y luego `rclone cryptcheck`», «el MD5 del fichero **descifrado**». Ninguna de las cuatro es cierta. |
| `deploy/systemd/README.md:159-160` (§Comprobaciones) | Manda listar `gdrive_cif:daily/` y `gdrive:Bamburu-backup-cif/`, un remote y una carpeta que **no existen**. |
| `deploy/systemd/README.md:165-170` (§Restauración) | **«HACE FALTA LA CONTRASEÑA DE CIFRADO»**, y dice dónde está. No existe. Es el documento que se lee el día peor. |
| `docs/seguridad/vectores-de-ataque.md:13,16` y `:104-120` | La fila 4 del resumen dice «**cifrado (1 sep 2026)**» y coste «Hecho»; el cuerpo de §4 dice «Se hizo lo que decía el párrafo tachado». Solo la §«Recomendación única` (`:189`) tiene el ⛔ corrigiéndolo. Dos afirmaciones del mismo documento se contradicen. |
| `TABLERO.md:9210` | «**CÓDIGO HECHO EL 1 SEP 2026** · El script exige destino `crypt` y **aborta** si no lo es». El script de hoy no exige nada. |

### 1.5 La receta de custodia que hay escrita no funciona

`deploy/systemd/README.md:266-269` dice sacar la contraseña así:

```bash
rclone reveal "$(rclone config show gdrive_cif | awk -F'= ' '/^password =/{print $2}')"
```

**Medido hoy:** `rclone config show` **enmascara** el campo (`password = *** ENCRYPTED ***`), así que
ese `reveal` falla con `base64 decode failed … is it obscured?`. La receta que existe para el día en
que haya que recuperar la llave **está rota**. (La que sí funciona: `rclone config dump`, que **no**
enmascara — verificado.)

### 1.6 Y el detalle que hace irreversible dejarlo a medias

**Medido hoy:** un fichero con nombre sin cifrar dentro de la raíz de un remote `crypt` se **salta**
con **código de salida 0**, tanto al listar como al borrar:

```
NOTICE: intruso-en-claro.db: Skipping undecryptable file name: illegal base32 data at input byte 7
$ rclone delete fake_cif:daily/ --min-age 0s   → rc=0, y el intruso sigue ahí
```

Consecuencia: en cuanto el destino pase a `crypt`, **la retención de 14 días no volverá a tocar
nunca el histórico en claro**. No caduca solo. O se migra, o se queda ahí para siempre mientras los
correos dicen que todo va cifrado.

### 1.7 Lo que está bien y NO se toca

Una sola pieza sirve las dos copias, parametrizada por entorno (`:27-35` + la unit secundaria
`:13-20`); el fallo se notifica y no se muere mudo (`fail_exit`, `:77-89`); el snapshot es
consistente y nunca copia un `.db` en crudo (`:127`); el `trap … EXIT` limpia el temporal (`:97`); la
secundaria no pingea el healthcheck de la principal (`:45-49`). Todo eso se queda como está.

---

## 2. Cómo lo resuelven los que ya lo resolvieron

### Salesforce — la clave existe ANTES de que nada la exija, y el sistema lo impone

Shield Platform Encryption no deja activar el cifrado de un campo hasta que existe el *tenant
secret*: primero se genera la clave, y solo entonces la casilla de cifrar se puede marcar. **El orden
no es una recomendación del manual: es el producto el que se niega.** Y en «Bring Your Own Key»
Salesforce dice sin rodeos que si pierdes el material de clave los datos son irrecuperables, y no
guarda una copia de rescate.

**Lo que se trae:** el orden **generar → verificar → encender** metido en el código, no en un runbook.
Es literalmente el fallo del 1 de septiembre visto desde el otro lado, y es lo que la ficha pide en
sus pasos 3 y 4. También se trae la honestidad sobre la pérdida de la llave: el riesgo dominante aquí
no es que la roben, es perderla.

### Odoo — no aplica en el mecanismo, y decirlo también es información

Odoo **no cifra las copias**. Un `pg_dump` de Odoo self-hosted sale en claro, y la respuesta oficial
es «tu cron y tu GPG». Lo que sí aporta es una idea trasladable: `/web/database/backup` exige la
**master password**, que es un secreto **distinto** del que usa la aplicación para funcionar. Bamburu
ya está en esa línea por decisión de Ibrahin —la llave **no** va a `/etc/bamburu.env`, porque ese
fichero entra entero en el `process.env` del proceso web—, y conviene dejar dicho que coincide con lo
que hace el producto grande del sector.

Y una lección por omisión, que es la que Bamburu está viviendo: cuando el producto no trae cifrado,
todo el mundo lo apaña en un cron **y casi nadie prueba la restauración**. El foro de Odoo está lleno
de copias cifradas que nadie abrió nunca. Por eso el criterio 7 de §6 no es un adorno.

### SAP HANA — la llave se guarda aparte de lo que protege, y el ensayo de restauración es obligatorio

HANA cifra las copias con una *backup encryption root key* que vive en el almacén seguro (SSFS),
**separada del backup**, y la documentación es tajante: si la root key no se ha guardado aparte, los
backups cifrados **no se pueden restaurar**, y punto. Además el catálogo se puede listar sin la
clave, pero los datos no se leen — igual que aquí, donde se ve que hay objetos pero no qué son.

**Lo que se trae:** dos cosas. (a) La llave en el servidor **y** una copia fuera, que es exactamente
lo que Ibrahin decidió y por el mismo motivo. (b) El **ensayo de restauración partiendo solo de la
llave** como pieza de primera —en HANA es un procedimiento con nombre, no un «ya lo probaremos»—:
aquí es `scripts/ensayo-restauracion-cifrada.sh` y el criterio 7.

---

## 3. La decisión

### Qué se hace

`rclone crypt` sobre los dos destinos, con `filename_encryption=standard` y
`directory_name_encryption=true` — eso no cambia respecto al intento 3, está medido y es correcto.
**Lo que cambia es cuándo y cómo se enciende:**

1. **`scripts/bamburu-backup.sh` aprende a funcionar en los dos mundos**, y en los dos **sin rama
   blanda**: si el destino es `crypt`, verifica con `rclone cryptcheck`; si no lo es, exige el MD5 de
   Drive y **falla si no lo hay** (hoy Drive sí lo da). En los dos casos la prueba de restauración
   descarga el artefacto y lo compara **byte a byte** con el original.
2. **El destino cifrado no vive en el código ni en las units: vive en un fichero de estado**,
   `~/.config/bamburu/backup-destinos.conf` (modo `600`), que **solo escribe el guion** y **solo
   después de haber subido, bajado y comparado byte a byte un fichero de prueba**. Mientras ese
   fichero no existe, las dos copias se comportan **exactamente como hoy**.
3. **Ese mismo fichero es el cerrojo.** Si existe, el destino **tiene que ser** `crypt`; si no lo es,
   la copia aborta antes de subir nada. Así el cerrojo **no puede adelantarse a la llave**: nace en
   la misma escritura que nombra el destino cifrado, y esa escritura ocurre después del descifrado
   de prueba. Es la regla de la ficha —*«nunca puede existir un momento en que el código exija
   cifrado y el destino cifrado no exista»*— convertida en una imposibilidad, no en una advertencia.
4. **El guion de un solo uso** hace los cinco pasos de la ficha en una pasada: genera → crea los dos
   `crypt` → **comprueba que descifra** → escribe el fichero de destinos → enseña la llave una vez.
   Si el paso 3 falla, borra lo que creó y **no llega al 4**.

**Sobre el histórico en claro.** La ficha describe cinco pasos y no menciona la migración, pero la
tarea dice «cierra el vector 4 **entero**» y §1.6 mide que esos 250 objetos **ya no caducan solos** en
cuanto se cifre. Dejarlos sería cerrar el vector en el papel y no en Drive. **Lo meto, pero fuera de
la pasada principal**: el guion acepta `--migrar-historico`, que por defecto es **simulacro** y solo
borra con `--hazlo`. Así la pasada de los cinco pasos sigue siendo exactamente la que Ibrahin
escribió. Lo declaro aquí porque es lo único de este plano que va más allá de la letra de la ficha.

### En qué capa vive

**Solo `scripts/` y documentación.** Ni `modules/`, ni `core/`, ni una base, ni una migración, ni una
pantalla, ni una unit nueva, ni una variable en `/etc/bamburu.env`. Lista **cerrada** de ficheros que
esta entrega puede tocar — cualquier otro es fuera de alcance, y el intento 3 se llevó un aviso por
colar un hunk del orquestador:

```
scripts/bamburu-backup.sh                        (modificado)
scripts/cifrar-copias-de-seguridad.sh            (nuevo)
scripts/ensayo-restauracion-cifrada.sh           (nuevo)
deploy/systemd/README.md
docs/seguridad/vectores-de-ataque.md
CLAUDE.md
TABLERO.md
docs/architecture/task-cifrado-copias-seguridad-informe.md
```

### Qué patrón del propio código se sigue

| Pieza | Patrón que ya existe en Bamburu |
|---|---|
| Fichero de destinos en `~/.config/bamburu/` | `scripts/bamburu-backup.sh:40-41` ya guarda estado fuera del repo (`$HOME/.local/state/bamburu-backup/last-success`) y `scripts/bamburu-backup-heartbeat.sh` lo lee. Estado de máquina fuera de git: patrón existente, no invención. |
| Una sola pieza para las dos copias | `scripts/bamburu-backup.sh:27-35` + `bamburu-backup-secondary.service:13-20`. El fichero de destinos resuelve **por `BACKUP_LABEL`**, que ya existe: no se añade ningún `if principal/secundaria`. |
| Simulacro por defecto, `--hazlo` para ejecutar | `scripts/limpiar-restos-de-gates.mjs:29`. Lo copia `--migrar-historico`. |
| Ensayo antes de tocar nada vivo, y la prueba borra lo que crea | El patrón de S6 en `deploy/systemd/README.md` §«Ensayo antes de tocar nada vivo»: comprobar la credencial **antes** de instalar, y `rclone purge` del ensayo. |
| Fallar notificando, nunca mudo | `fail_exit` (`:77-89`). Todo error nuevo sale por ahí; no se inventa ningún camino de error. |
| Nada de rama blanda | `CLAUDE.md` §«un censo que dice CERO y no es cierto…». |

### Alternativas descartadas

1. **Repetir el intento 3: guardián duro desde el commit.** Es lo que Ibrahin revirtió y lo que la
   ficha prohíbe con nombre y apellidos. Descartada por decisión del dueño, no por gusto mío.
2. **Cambiar el destino editando las units + `sudo cp` + `daemon-reload`.** Descartada: es justo la
   avería del 1 sep —`deploy/systemd/bamburu-backup-secondary.service` apuntaba al destino cifrado
   mientras la copia **instalada** en `/etc/systemd/system/` seguía con el viejo—, y además metería
   `sudo` (con su posible petición de contraseña) dentro de un guion que la ficha quiere «de un
   tirón, sin preguntas encadenadas».
3. **Que el remote `crypt` herede el nombre `gdrive`** (renombrar el de Drive a `gdrive_raw`), para
   no tocar ni el script ni las units. Elegante y **descartada por riesgo**: `rclone` 1.74.3 **no
   tiene** `config rename` (comprobado en `rclone config --help`), así que habría que recrear el
   remote copiando a mano el token de OAuth y **borrar el original**. Si el guion muere entre esas
   dos órdenes, el servidor se queda sin credencial de Drive y sin copia.
4. **Definir el remote `crypt` por variables de entorno** (`RCLONE_CONFIG_GDRIVE_CIF_*`). Descartada:
   esas variables tendrían que vivir **o** en la unit (`/etc/systemd/…`, necesita `sudo`), **o** en
   `/etc/bamburu.env` —que entra entero en el `process.env` del proceso web, justo lo que la ficha
   prohíbe—, **o** en el repo, que está versionado. Los tres caminos cerrados.
5. **Cifrar en el propio script con `age`/`gpg`/`openssl`.** Descartada, y es la que más cuesta
   descartar: mataría la prueba de restauración diaria. Para comprobar que la copia vuelve y abre
   hace falta **descifrarla**, y eso exige la clave privada en el servidor; el único sitio donde el
   agente puede escribir es el repo, que se empuja a GitHub. O se pierde la verificación —la joya de
   este sistema de copias— o se filtra la clave. Además cambiaría la restauración por un
   procedimiento casero de `openssl` el día peor. `rclone crypt` es implementación mantenida y trae
   `cryptcheck`.
6. **Cifrar el propio `rclone.conf`** (`rclone config encryption set`). Descartada: pediría
   contraseña en cada pasada nocturna y adiós a la copia desatendida. La ficha ya decidió que la
   llave vive en `rclone.conf` en `600`, ofuscada; el README ya explica honestamente que ofuscado no
   es cifrado y por qué contra este vector da igual.

---

## 4. El plan, paso a paso

> **Convenios que valen para todo el plan.**
> **(a) La contraseña no se imprime nunca**, salvo en el único sitio donde imprimirla es el objetivo
> (§4.3, paso 8). Nada de `sudo` con la clave —`docs/contexto/errores-conocidos.md:15` cuenta cómo se
> filtró una por ahí—, `rclone obscure` **por stdin**, nunca por `argv` (se ve en `ps`), y todo
> `rclone config create` con `>/dev/null` porque imprime la sección creada.
> **(b) Nada se ejecuta contra Drive ni contra `~/.config/rclone/rclone.conf`.** Todo contra el mundo
> de mentira de §4.1. Ni una orden de lectura contra Drive: no hace falta ninguna.
> **(c) `rclone config create` devuelve 0 aunque NO haya escrito nada.** Medido hoy con el config en
> un sistema de solo lectura: `ERROR: Failed to save config after 10 tries…` por stderr y **`rc=0`**,
> fichero vacío. **Todo lo que cree un remote tiene que releerlo después.**
> **(d) `rclone config show` NO devuelve el `type` por código de salida.** Con un remote inexistente
> imprime `# couldn't find type of fs` y sale con **0** (medido). La existencia se comprueba con
> `grep -q '^type = crypt'`, nunca con `$?`.
> **(e) `rclone obscure` no es determinista** (medido: dos obscures de la misma clave dan cadenas
> distintas, y los dos `reveal` coinciden). Para comparar dos contraseñas hay que comparar `reveal`,
> en memoria, sin imprimirlo.
> **(f) `rclone config show` enmascara `password`** (§1.5). Para leerla del fichero: `rclone config
> dump` (JSON, no enmascara) + `rclone reveal`.

### 4.1 Paso 0 — el mundo de mentira (esto no es un barrido: es cómo se construye la pieza)

Verificado por mí hoy, funciona tal cual y **no toca Drive ni el `rclone.conf` de producción**:

```bash
W=/tmp/cif-mundo; rm -rf "$W"; mkdir -p "$W/raw" "$W/claro" "$W/home"
export RCLONE_CONFIG="$W/conf.conf" HOME="$W/home"
rclone config create fakedrive local >/dev/null
rclone config create fake_claro alias remote="fakedrive:$W/claro" >/dev/null
rclone config create fake_cif crypt remote="fakedrive:$W/raw" \
  password="$(printf 'clave' | rclone obscure -)" password2="$(printf 'sal' | rclone obscure -)" \
  filename_encryption=standard directory_name_encryption=true >/dev/null
```

Comprobado en ese mundo: `type = crypt`; el listado crudo da solo base32
(`n2jlftqqth2…/2s0k0j1vl6jr…`) y a través de la llave el nombre original; `rclone size` sobre el
crypt devuelve el tamaño **en claro** (200000 = el del fichero original), así que la comprobación de
tamaño del script sigue sirviendo; `cryptcheck` dice «0 differences found» con `rc=0`; y el fichero
bajado es **idéntico byte a byte** al subido.

**Reglas de higiene, de `CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra»:** todo bajo
`/tmp/cif-*`, `HOME` falso, `trap 'rm -rf …' EXIT` pase, falle o reviente, y al terminar
`git status --porcelain` **vacío**.

### 4.2 `scripts/bamburu-backup.sh` — los cambios, uno a uno

**1. Cabecera (`:3-29`).** Sincerar: la copia funciona en dos modos, el modo lo fija el fichero de
destinos, y ese fichero es también el cerrojo. Sin promesas de cifrado que no dependan del estado.

**2. Resolución del destino (sustituye a `:32`).** Añadir, sin quitar nada de lo que hay:

```bash
LABEL="${BACKUP_LABEL:-principal}"
DESTINOS="${BACKUP_DESTINOS_CONF:-$HOME/.config/bamburu/backup-destinos.conf}"
REMOTE_CIF=""
if [ -r "$DESTINOS" ]; then
  REMOTE_CIF="$(grep -E "^DESTINO_${LABEL}=[A-Za-z0-9_]+:[A-Za-z0-9_./-]*$" "$DESTINOS" \
                | tail -1 | cut -d= -f2-)"
fi
if [ -n "$REMOTE_CIF" ]; then REMOTE="$REMOTE_CIF"; EXIGE_CRYPT=1
else                          REMOTE="${BACKUP_REMOTE:-gdrive:Bamburu-backup/daily}"; EXIGE_CRYPT=0; fi
```

- Se **parsea con un patrón estricto**, no se hace `source`: un fichero de estado no ejecuta código.
- `BACKUP_DESTINOS_CONF` existe **solo** para poder probarlo desde el orquestador, que tiene el
  `$HOME` en solo lectura. Es la única variable nueva, y no va en ninguna unit.
- Precedencia: **fichero de destinos > `BACKUP_REMOTE` de la unit > el de siempre.** Va explicada en
  la cabecera, porque invierte lo habitual a propósito: el fichero es el estado «ya está cifrado», y
  ese estado manda sobre el valor heredado de la unit. Es lo que permite que las **dos** copias
  cambien de destino con **una sola escritura** y sin `sudo`.

**3. `es_crypt()` — función nueva, tres líneas.**

```bash
es_crypt(){ "$RCLONE" config show "${1%%:*}" 2>/dev/null | grep -q '^type = crypt'; }
```

Convenio (d): se decide por el `grep`, nunca por `$?` de `config show`.

**4. El cerrojo**, justo después de comprobar que `rclone` existe (`:92`) y **antes** de
`hc_ping "/start"` (`:94`) y de crear `TMPDIR` (`:96`) — la misma colocación que el revisor validó en
el intento 3, para que no llegue a tocar un fichero:

```bash
if [ "$EXIGE_CRYPT" = 1 ] && ! es_crypt "$REMOTE"; then
  fail_exit "el destino '$REMOTE' viene de $DESTINOS pero NO es un remote crypt. Copia ABORTADA."
fi
```

**No hay ninguna otra condición que exija `crypt`.** Sin fichero de destinos, este `if` no se evalúa
nunca.

**5. `verify_uploaded` (`:101-112`) — se rehace, y la rama blanda desaparece.** Tamaño igual que hoy
(sigue valiendo: `rclone size` sobre crypt da el tamaño en claro, medido). Después, dos ramas y las
dos **duras**:

- **Destino `crypt`:** `rclone cryptcheck "$(dirname "$local_path")" "$REMOTE" --include "$name"`,
  capturando la salida. Exige `rc == 0` **y** que la salida contenga `0 differences found`. **La
  última línea de `cryptcheck` se mete en `$LOGBUF`** (`log`), para que el correo de fallo distinga
  «las huellas difieren» de «el remote no respondió» — era la observación 1 del revisor y cuesta una
  línea.
- **Destino normal:** `rmd5` **tiene que venir no vacío y coincidir**. Si viene vacío → `return 1`
  con «el destino no devuelve huellas y no es `crypt`: no se puede verificar».

`grep -n "se valida solo por tamaño" scripts/bamburu-backup.sh` tiene que quedar **vacío**.

**6. `verify_restored()` — función nueva.** Compara el fichero descargado con el original **byte a
byte** (`cmp -s`, o `md5sum` de los dos; `cmp` es más directo y no necesita `awk`):

```bash
verify_restored(){  # $1 = original local, $2 = descargado
  cmp -s "$1" "$2" || { log "  restore: el fichero descargado NO es idéntico al original ($2)"; return 1; }
}
```

Se engancha en los **dos** sitios, después de la descarga y **antes** del `integrity_check` / `tar -tzf`:
- bases: entre `:134` y `:135`.
- uploads: entre `:153` y `:154`.

`integrity_check` y `tar -tzf` **se quedan**: siguen valiendo para comprobar que el snapshot que
subimos es una base sana, que es otra cosa.

**7. El modo se dice en palabras, cada día.** En el `SUMMARY`, en el asunto o cuerpo del email de OK
y en el `log`: `Destino: <remote> — CIFRADO` o `Destino: <remote> — EN CLARO ⚠️`. Sin cerrojo previo
a la llave, **la honestidad diaria es la que impide un cifrado que se apaga en silencio**: si un día
el fichero de destinos desaparece, el correo lo dice esa misma mañana.

**8. Lo que NO se toca:** la retención (`:162-164`), las marcas (`:167`), el ping, el email, el
snapshot, el `trap`, la parametrización por entorno, ni el reparto principal/secundaria.

### 4.3 `scripts/cifrar-copias-de-seguridad.sh` — NUEVO. El guion de un solo uso

`set -euo pipefail`. Lo ejecuta **Ibrahin**, en una terminal normal. Parámetros por entorno con los
valores de producción por defecto (`BASE_1=gdrive`, `CIF_1=gdrive_cif`, `RAIZ_1=Bamburu-backup-cif`,
y los `_2` para `gdrive_gili` / `gdrive_gili_cif` / `Bamburu-backup-gili-cif`), y respeta
`RCLONE_CONFIG`, `HOME` y `BACKUP_DESTINOS_CONF` — **por eso se puede probar entero en `/tmp`**.

En una pasada, sin una sola pregunta encadenada:

1. **Se niega a pisar.** Si `CIF_1` o `CIF_2` ya son `crypt` (convenio (d)), **no genera nada**:
   imprime el estado (remotes, fichero de destinos, modo de la última copia) y sale **0** si está
   todo puesto, **1** si está a medias. Motivo: volver a crearlos generaría **otra** contraseña y
   dejaría **ilegible lo ya subido**. Este modo es además la respuesta a «¿esto está hecho?».
2. **Comprueba los prerrequisitos**: `BASE_1`/`BASE_2` existen; `~/.config/rclone/rclone.conf` existe
   y es escribible. Si no, sale con 1 **antes** de generar ninguna clave.
3. **Genera** la contraseña y la sal: `openssl rand -base64 32` y `-base64 24`, en variables, **una
   sola vez y la misma para los dos destinos** (dos claves duplicarían la custodia sin ganar nada:
   viven en el mismo fichero del mismo servidor).
4. **Crea los dos `crypt`** con `rclone config create … password="$(printf %s "$CLAVE" | rclone
   obscure -)" … filename_encryption=standard directory_name_encryption=true >/dev/null`, sobre
   **raíces nuevas** (`Bamburu-backup-cif`, `Bamburu-backup-gili-cif`) — nunca sobre las carpetas que
   ya tienen ficheros en claro (§1.6).
5. **Los relee** (convenio (c)): `type = crypt` en los dos, y `reveal` de los dos `password`
   **coincide en memoria** (convenio (e)), sin imprimir nada.
6. **Ensayo real, por cuenta** — este es el paso 3 de la ficha y el que impide repetir el 1 de
   septiembre: siembra `head -c 300000 /dev/urandom`, lo sube al `crypt`, **lo baja**, `cmp -s`
   contra el original, comprueba que `rclone lsf <BASE>:<RAIZ>/ -R` **no contiene el nombre del
   fichero de prueba** ni `.bin`, y `rclone cryptcheck` da `0 differences` con `rc 0`. Al final,
   `rclone purge <CIF>:ensayo` **pase lo que pase** (`trap`).
7. **Si el ensayo falla en cualquier punto: deshace.** `rclone config delete` de los remotes que haya
   creado él, mensaje de por qué, `exit 1`. **No llega al paso 8, así que el fichero de destinos no
   se escribe y las copias siguen funcionando en claro esa noche.**
8. **Solo entonces**, cambia el destino: escribe `~/.config/bamburu/backup-destinos.conf` de forma
   atómica (`umask 077`, fichero temporal en el mismo directorio + `mv`), con dos líneas
   —`DESTINO_principal=gdrive_cif:daily` y `DESTINO_secundaria=gdrive_gili_cif:daily`— y `chmod 600`.
   Verifica después que el fichero se lee y que los permisos son `600`. Comprueba también que
   `rclone.conf` está en `600` (hoy lo está: `-rw------- ubuntu:ubuntu`, verificado).
9. **Enseña la llave UNA vez por pantalla**, con el aviso de guardarla en el gestor de contraseñas y
   de que **sin ella las copias son ruido**. No la escribe en ningún fichero, ni en el `log`, ni la
   vuelve a imprimir en ninguna otra ejecución.
10. **Dice qué queda**: lanzar las dos copias a mano para ver la primera cifrada, y el
    `--migrar-historico`. Sin ejecutarlo por su cuenta.

**`--migrar-historico`** (invocación aparte; **simulacro por defecto**, `--hazlo` para borrar). Por
cuenta, y si la primera falla **no toca la segunda**: contar `N` en claro → `rclone copy` a la ruta
cifrada → `cryptcheck` exigiendo `rc 0` **y** `0 differences` (imprimiendo siempre las últimas líneas)
→ segunda comprobación independiente `rclone lsf <cif> | wc -l >= N` → `rclone delete --dry-run` y lo
imprime → **solo con `--hazlo` y solo si todo lo anterior pasó**, borrar y exigir recuento 0. Si algo
falla: **no borra**, `exit 1`, «no se ha borrado nada; se para y se pregunta». En la cabecera, escrito:
esto **no** choca con «nunca destruir datos de un tenant» — es un traslado dentro de la misma cuenta,
verificado objeto a objeto, no una destrucción.

### 4.4 `scripts/ensayo-restauracion-cifrada.sh` — NUEVO. Abrir la copia partiendo solo de la llave

El instrumento del criterio 7 y, después, el ensayo periódico que HANA tiene con nombre propio.

1. Lee la contraseña y la sal **por stdin** (nunca por `argv`: se ven en `ps`).
2. Construye una configuración **temporal** con `mktemp -d` (modo `700`) y `RCLONE_CONFIG` apuntando
   dentro. **No lee `~/.config/rclone/rclone.conf` en ningún momento** — eso es lo que hace que el
   ensayo valga: demuestra que con la llave custodiada se abre la copia aunque este servidor no
   exista.
3. Toma por parámetro el backend crudo (`--backend fakedrive:/tmp/cif-mundo/raw` en pruebas;
   `gdrive:Bamburu-backup-cif` en producción, donde sí hace falta el token de Drive — se dice
   explícitamente en la cabecera: la llave sustituye al `crypt`, no a la credencial de la cuenta).
4. Lista, descarga **un** `.db`, y exige: `PRAGMA integrity_check` → `ok` **y**
   `SELECT count(*) FROM sqlite_master` **> 0** (una base vacía también pasa `integrity_check`).
5. `trap` que borra el directorio temporal pase lo que pase. No escribe nada fuera de él.

### 4.5 `deploy/systemd/README.md`

- **§«Qué hace, cada día» (`:107-119`)**: reescribir los cuatro puntos falsos de §1.4 para que
  describan los dos modos y el fichero de destinos. Se conserva el porqué que ya está bien escrito
  (dónde vive la clave y por qué no en `/etc/bamburu.env`, una sola contraseña, raíz nueva a
  propósito).
- **§«Comprobaciones» (`:159-160`)** y **§«Restauración» (`:163-186`)**: hoy dan por hecho el cifrado
  y nombran un remote que no existe. Pasan a decir la verdad **en los dos estados**, y la restauración
  gana `scripts/ensayo-restauracion-cifrada.sh`.
- **§«Custodiar la contraseña» (`:261-269`)**: la receta está rota (§1.5). Se **tacha con su motivo y
  su fecha** —`rclone config show` enmascara— y se pone la que funciona, con `rclone config dump`.
- **§«Cifrado de las copias» (`:189-317`)**: se conserva entero el porqué y se **sustituyen los tres
  bloques de comandos a mano por el guion**. El aviso «⚠️ NO ESTÁ PUESTO» se sustituye por el estado
  real cuando la entrega esté hecha: *construido y probado; se enciende ejecutando el guion*.

### 4.6 `docs/seguridad/vectores-de-ataque.md`

- **Fila 4 y fila 7 del resumen (`:13`, `:16`)** y **cuerpo de §4 (`:104-120`)**: dicen que el cifrado
  está hecho. **Tachar con motivo y fecha** (método del repo, nunca borrar) y dejar el estado real:
  el vector 4 sigue **ABIERTO** hasta que se ejecute el guion; el mecanismo está construido y probado.
  El ⛔ de `:189` deja de contradecir al resumen.
- El vector 7 sigue **PARCIAL** con su motivo (falta `manifiesto-huellas-backups`). No cambia.

### 4.7 `CLAUDE.md` y `TABLERO.md`

- **`CLAUDE.md`**: el bloque de backups ya es honesto tras la reversión; gana **una** frase con el
  nombre del guion y qué hace. Sin declarar cerrado nada que no lo esté.
- **`TABLERO.md:9210`**: dice «CÓDIGO HECHO … El script exige destino `crypt` y aborta si no lo es».
  Falso hoy. Se corrige **tachando con fecha**, y se explica el cambio de enfoque en una línea.
- **`TABLERO.md:8405`** (la ficha): se marca lo construido y se deja escrito, con las casillas de la
  ficha una a una, qué queda: **una orden de Ibrahin**. **La ficha NO se cierra** mientras las copias
  vayan en claro — cerrarla sería el «verde que miente» que esta tarea viene a matar, y el revisor
  del intento 3 ya dijo que no cerrarla fue lo correcto.
- **Regla del titular y el cuerpo:** antes de dar la entrega por terminada, `grep` de
  `"exige destino"`, `"CÓDIGO HECHO"`, `"gdrive_cif"` y `"HACE FALTA LA CONTRASEÑA"` en `TABLERO.md`,
  `CLAUDE.md`, `deploy/systemd/README.md` y `docs/seguridad/`, y comprobar que lo que quede es cierto.

### 4.8 El informe de la entrega

Además de lo suyo: la salida real de las dos pasadas completas (en claro y cifrada) con su código de
salida y su recuento de artefactos, el listado crudo demostrando que no hay nombres legibles, y
`git show --stat` del commit para enseñar que **no toca ningún fichero fuera de la lista de §3**.
Si algo queda en rojo, se declara en rojo: el intento 3 fue rechazado, pero su informe honesto es lo
que hizo corta la revisión.

### 4.9 Commit

Uno solo, con `Tarea: cifrado-copias-seguridad` en el trailer. **Nada del orquestador dentro.**

---

## 5. Riesgos

| # | Riesgo | Cómo se mitiga |
|---|---|---|
| 1 | **Se pierde la llave → las copias son ruido.** Es el riesgo dominante, por encima de que la roben. | Vive en `rclone.conf` (`600`) **y** se enseña una vez por pantalla para custodia fuera del servidor (decisión de Ibrahin). El criterio 7 exige demostrar que con esa llave sola se abre la copia. |
| 2 | **Re-ejecutar el guion generaría otra clave** y dejaría ilegible lo ya subido. | Paso 1 de §4.3: si el remote ya es `crypt`, no genera nada y sale informando. |
| 3 | **`rclone config create` devuelve 0 sin haber escrito** → remotes fantasma y una clave que se cree creada. | Convenio (c), medido hoy. Paso 5 de §4.3: se relee siempre y se compara `reveal` en memoria. |
| 4 | **Quedarse sin copia** (lo que pasó el 1 sep). | Imposible por construcción: el cerrojo nace **dentro** de la escritura que nombra el destino cifrado, y esa escritura es posterior al descifrado de prueba. Si el ensayo falla, el guion deshace y esa noche la copia sale **en claro y verde**. Criterio 6. |
| 5 | **El fichero de destinos se pierde** (`$HOME` recreado, disco) → se vuelve a claro en silencio. | Fallo abierto y asumido: preferimos «copia en claro» a «sin copia». No queda en silencio: el correo diario y el log dicen **EN CLARO ⚠️** en palabras (§4.2.7). |
| 6 | **El histórico en claro no caduca solo.** Medido (§1.6): rclone salta los nombres indescifrables con `rc 0`, al listar **y al borrar**. | `--migrar-historico`, y queda dicho en el informe y en el README que sin ese paso el vector 4 no está cerrado. |
| 7 | **La migración destruye la única copia del histórico** (250 objetos). | Orden en código, no en prosa: copiar → `cryptcheck` `0 differences` y `rc 0` → recuento independiente → simulacro → borrar. Sin `--hazlo` no borra. Si algo falla, no borra y sale con 1. |
| 8 | **La prueba llena el disco** (la lección del 22 ago: ocho barridos al 100%). | Medido: `data/` son **106 MB** y hay **29 GB** libres; una pasada gasta ~320 MB. `trap 'rm -rf' EXIT` y todo bajo `/tmp/cif-*`. Y **una comprobación pedida una vez se ejecuta una vez**: si sale rojo intermitente, se declara y se pregunta. |
| 9 | **La prueba manda emails o pings reales, o pisa las marcas del heartbeat.** | Medido: `RESEND_API_KEY` y `HEALTHCHECKS_URL` están **vacíos** en el entorno del agente → `send_email` sale por su `WARN` y `hc_ping` no hace nada. Además, `HOME` falso en `/tmp` y `BACKUP_HC_URL=` explícito. |
| 10 | **VERI\*FACTU, datos de tenant, migraciones, pantallas.** | **Cero**: la lista cerrada de §3 no incluye `modules/`, `core/` ni ninguna base. El script sigue **solo leyendo** las bases por snapshot, como ya hacía. No hay ninguna migración. |
| 11 | **El botón «Lanzar copia ahora» del superadmin** (`modules/superadmin/backups.js:11`) deja de funcionar. | No se le añade ninguna variable de entorno ni se toca ese fichero. El hijo corre como `ubuntu`, con el mismo `$HOME`, así que lee el mismo fichero de destinos y el mismo `rclone.conf`. |
| 12 | **Nombres cifrados demasiado largos** para Drive. | El nombre más largo de hoy son 32 caracteres → ~83 cifrados, contra 255 que admite Drive. Margen de sobra. |
| 13 | **Basura de prueba que se queda.** | Todo bajo `/tmp/cif-*` con marca reconocible, borrado en el `finally`/`trap` **por la marca** y no por las variables de la pasada, y `git status --porcelain` vacío al terminar. |

---

## 6. Criterios de aceptación

> Los ocho se comprueban **sin red, sin `sudo` y sin tocar `~/.config/rclone/rclone.conf`**, en el
> mundo de mentira de §4.1. Ninguno depende de que Ibrahin haga nada: fue exactamente el error que
> costó tres intentos.

- [ ] **Hoy sigue habiendo copia.** Sin fichero de destinos y con `BACKUP_REMOTE` apuntando a un
      destino **en claro** de usar y tirar, `bash scripts/bamburu-backup.sh` termina con **exit 0** y
      sube un artefacto por cada `data/tenants/*.db` más `control.db` más `uploads-*.tar.gz` (hoy,
      **23**); y `grep -n "se valida solo por tamaño" scripts/bamburu-backup.sh` no devuelve nada.
- [ ] **La pasada cifrada completa funciona.** Con el fichero de destinos apuntando a un `crypt` de
      usar y tirar sobre backend local, la misma orden termina con **exit 0**, y
      `rclone lsf <backend crudo> -R` **no contiene** `.db`, ni `.tar.gz`, ni ningún nombre de
      `data/tenants/*.db` (derivado del disco, no escrito a mano) — solo base32, con los directorios
      también cifrados.
- [ ] **Las dos verificaciones fallan duro, y se demuestra rompiéndolas.** En el mundo cifrado:
      (a) alterar un byte del objeto subido → **exit 1** con el mensaje de `cryptcheck`, y el log
      incluye su última línea; (b) sustituir el fichero descargado por **otra base real y válida**
      (que pasa `PRAGMA integrity_check`) → **exit 1** por la comparación byte a byte. En el mundo en
      claro: (c) un destino que no devuelve MD5 → **exit 1**, nunca un aviso.
- [ ] **El guion hace los cinco pasos en orden.** `bash scripts/cifrar-copias-de-seguridad.sh` con
      `RCLONE_CONFIG`, `HOME` y `BACKUP_DESTINOS_CONF` en `/tmp` crea los dos remotes con
      `type = crypt` y la **misma** contraseña (`reveal` de los dos coincide), pasa su ensayo de
      subir-bajar-comparar, deja el fichero de destinos con permisos **`600`**, imprime la llave
      **una** vez, y borra el ensayo. Ejecutado por segunda vez **no genera ninguna clave nueva** y
      sale informando del estado.
- [ ] **Si no descifra, no cambia el destino.** Rompiendo el ensayo del paso 6 (por ejemplo, dejando
      el backend crudo sin escritura), el guion sale con **1**, **el fichero de destinos NO existe**,
      y los remotes `crypt` que había creado **ya no están** en la configuración.
- [ ] **El cerrojo no puede adelantarse a la llave.** Con el fichero de destinos apuntando a un remote
      que **no** es `crypt`, la copia sale con **1 sin subir ningún artefacto** (el temporal ni se
      crea); borrando ese fichero, la misma copia vuelve a salir **0** contra el destino en claro.
- [ ] **La copia se abre partiendo solo de la llave.** `scripts/ensayo-restauracion-cifrada.sh`, con
      la contraseña por stdin y una configuración temporal en `/tmp` —**sin leer
      `~/.config/rclone/rclone.conf`**—, descarga un `.db` de la pasada cifrada y obtiene
      `PRAGMA integrity_check` → `ok` y `count(*) FROM sqlite_master` **> 0**.
- [ ] **Papeles y llave.** Buscando en `deploy/systemd/README.md`, `docs/seguridad/vectores-de-ataque.md`,
      `CLAUDE.md` y `TABLERO.md` las cuatro frases falsas de §1.4 —«Drive **CIFRADO**», «o no hay
      copia», «HACE FALTA LA CONTRASEÑA», «CÓDIGO HECHO»— lo único que aparece es texto **tachado con
      su fecha**; la fila 4 de `docs/seguridad/vectores-de-ataque.md:13` dice **abierto**; y tras
      todas las pruebas `git status --porcelain` está **vacío** y `git grep` de la contraseña usada
      en el mundo de mentira no devuelve nada.

---

## Anexo — Lo que le queda a Ibrahin (NO se juzga en esta entrega)

Una orden, cuando le venga bien, desde `/home/ubuntu/bamburu` en una terminal normal:

```bash
bash scripts/cifrar-copias-de-seguridad.sh
#   → guarda la llave que te enseñe, en el gestor de contraseñas, ANTES de cerrar la terminal
```

Con eso las dos copias de esa noche ya salen cifradas: no hay que instalar units, ni recargar
systemd, ni tocar el script. Después, cuando quiera, para que el histórico deje de estar en claro:

```bash
bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico            # simulacro: no borra nada
bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico --hazlo    # solo si el simulacro salió limpio
```

**Y mientras no ejecute nada, no pasa nada malo:** las copias siguen saliendo cada noche, en claro,
verificadas, y el correo diario dice **EN CLARO ⚠️** para que no se olvide.
