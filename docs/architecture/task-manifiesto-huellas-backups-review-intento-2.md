❌ RECHAZADO

# Revisión — Manifiesto de huellas del histórico de copias

- **taskId:** `manifiesto-huellas-backups`
- **fecha:** 2026-09-02
- **papel:** revisor
- **analizado:** `docs/architecture/task-manifiesto-huellas-backups-analysis.md`
- **commits:** `66c9ab7` (la construcción entera) + `21356b8` (retirada de `console.log`, corrección del intento 1)

> **Los ocho criterios de aceptación están en SÍ, y lo he comprobado uno a uno ejecutando las
> piezas, no leyéndolas.** El rechazo NO es por un criterio incumplido: es por el nivel de
> construcción (sección 3), y por una cosa concreta que el propio análisis puso como condición de
> diseño y que la construcción no cumple — **«el manifiesto tiene que funcionar en claro *y*
> cifrado desde el primer día, porque el día que Ibrahin ejecute `scripts/cifrar-copias-de-seguridad.sh`
> el destino cambia sin avisar a nadie»**. Medido: la noche en que se ejecute esa orden —que es la
> orden que está pendiente ahora mismo— el manifiesto declara **borrados** objetos que están en el
> destino, salta la retención y manda un 🚨 falso. Está reproducido abajo con su salida.

---

## 1 · Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | `node scripts/test-manifiesto-copias.mjs` sale 0, ejecuta el `bamburu-backup.sh` **real** contra un remote local en claro y contra un `crypt` local, cubriendo (a)–(g) en los dos mundos | **SÍ** | Ejecutado hoy: `75 OK · 0 fallos`, `EXIT=0`. En la salida aparecen las siete etiquetas `(a)`…`(g)` bajo `MUNDO: CLARO` **y** bajo `MUNDO: CIFRADO`. Que ejecuta el script de verdad: `scripts/test-manifiesto-copias.mjs:123` (`spawnSync('bash', [BACKUP_SH])`); el `crypt` local se crea en `:109-111`; nada toca `gdrive:` (`RCLONE_CONFIG` a `/tmp` en `:86`) |
| 2 | Una línea por artefacto subido, cada una con `sha256` de 64 hex y `prev`/`hash` enlazados; fichero en `600`; `verificar-cadena` sale 0 | **SÍ** | Laboratorio propio, 3 artefactos subidos + 1 histórico: `n=1 control-2026-09-02.db origen=subido sha256=6616a9f4… prev=(vacío) hash=d8ec39b28953 len=64` · `n=2 … prev=d8ec39b28953` · `n=3 … prev=c809e5fd9a0f` · `n=4 viejo-2026-08-29.db origen=observado prev=901b0b86fabc`. `stat -c%a` → `600` en `manifiesto.jsonl` **y** en `manifiesto.estado.json`. `node scripts/lib/manifiesto-copias.mjs verificar-cadena` → `líneas: 4 · cabeza: 4cf2239f…`, `exit=0` |
| 3 | Alterar un objeto del histórico **o** borrar uno con edad < `RETENTION_DAYS − 1` → la pasada siguiente sale **1** y **nombra el fichero**; borrar uno de más de `RETENTION_DAYS` días **no** alarma | **SÍ** | Test, casos (c)/(d)/(e) en los dos mundos: `(c) pasada con manipulación sale 1` · `(c) la salida nombra "reciente-2026-08-28.db"` · `(d) pasada con borrado (edad < retención) sale 1` · `(e) la ausencia de un objeto caducado no alarma: sale 0`. La regla está en `scripts/lib/manifiesto-copias.mjs:472` (`edadDias < retencionDias - 1`) y `:477` (huella distinta) |
| 4 | Con alarma del histórico, `rclone delete --min-age` **no se ejecuta** (un objeto de +`RETENTION_DAYS` sigue ahí) y **sí** se escribe `last-success` | **SÍ** | Test: `(c) la retención NO se ejecutó: el objeto de +RETENTION_DAYS sigue en el destino` y `(criterio 4) last-success queda reciente pese a la alarma`, en claro y en cifrado. En el código, el `exit 1` va **antes** del bloque de retención y después de `date +%s > "$LAST_OK"` (`scripts/bamburu-backup.sh:296-315`) |
| 5 | Primera pasada sobre destino con objetos previos y sin manifiesto: **sin alarma**, quedan `"origen":"observado"` y el resumen dice cuántos son | **SÍ** | Laboratorio propio: log de la pasada → `Manifiesto: 0 objetos comprobados · 0 alarmas · 0 descargas · cabeza 37359c57…` seguido de `1 objetos que esta copia no subió (registrados por primera vez)`, y la línea `n=4 viejo-2026-08-29.db origen=observado`. Código: `:433-457` |
| 6 | La pasada imprime el recuento de comprobados y **`0 descargas`**; en claro la verificación del histórico hace **una sola** invocación de `rclone` (`lsjson … --hash --hash-type sha256`) | **SÍ** | Laboratorio propio, con `RCLONE_BIN` apuntando a un contador: el fichero de llamadas del ayudante tiene **una** línea, exactamente `lsjson lbase:…/destino --hash --hash-type sha256 --files-only`. La cadena `0 descargas` sale en el resumen (`:305`) |
| 7 | El cuerpo del correo diario de éxito incluye el **SHA-256 de cada artefacto** y la **cabeza de la cadena** | **SÍ** | Interceptado el `curl` de `send_email` en un laboratorio (sin red, sin Resend). Cuerpo real: `• control-2026-09-02.db (8.0K) — subido, verificado y restore OK — sha256 41ba60f2ba25bbfd…` (una línea por artefacto, tres) y `Manifiesto: 0 objetos comprobados · 0 alarmas · 0 descargas · cabeza e2c34464b0d4224d7449bf43bfbd947246d959d77b7f1226424a543e758f7d2d` — la cabeza va **entera**, no acortada |
| 8 | `bash scripts/bamburu-backup-heartbeat.sh` avisa si el `manifiesto*.estado.json` de una copia esperada no existe, tiene más de 48 h, o su último resultado trae alarmas | **SÍ** | Ejecutado en los cuatro casos, con el `curl` interceptado. Sano: `[heartbeat] MANIFIESTO: histórico vigilado, sin alarmas, en 2 copia(s)` y **0 correos**. Falta el estado: `1 aviso(s)` + correo `· secundaria: el manifiesto de huellas nunca ha registrado un estado`. `touch -d '72 hours ago'`: correo `· principal: la verificación del histórico lleva más de 48h sin correr`. Con alarmas dentro del estado: el correo **repite la alarma literal** (`ALARMA: "duniya-2026-08-28.db": la huella cambió respecto a lo registrado — ¿manipulado?`) |

---

## 2 · ¿Se construyó lo que decía el análisis?

**Sí, y sin desviarse en el reparto de ficheros.** Los siete ficheros de `66c9ab7` son exactamente
los que nombra el §4 del análisis: `scripts/lib/manifiesto-copias.mjs` (nuevo, paso 4.1),
`scripts/bamburu-backup.sh` (pasos 6–12), `scripts/bamburu-backup-heartbeat.sh` (paso 13),
`scripts/test-manifiesto-copias.mjs` (paso 14), `deploy/systemd/README.md` (16),
`docs/seguridad/vectores-de-ataque.md` (17) y `TABLERO.md` (18). **Ni un fichero de `modules/`, ni
una migración, ni una ruta nueva** — los riesgos 9, 10 y 11 del análisis se respetan al pie de la
letra. Comprobado con `git show --stat 66c9ab7`.

Las tres piezas de doctrina que el análisis marcaba como innegociables están donde tenían que estar:
el bloque va **entre** `[ "$uploaded" -gt 0 ]` y la retención (`scripts/bamburu-backup.sh:275-315`),
**no hay ningún `fail_exit` dentro de él** (riesgo 1), y la corrección de la frase falsa del §7 de
`vectores-de-ataque.md` («Desde el 1 sep 2026 sí están cifradas») se hizo **tachando con motivo y
fecha**, no borrando, como manda el repo.

Desviaciones menores respecto al plano, ninguna de ellas motivo de rechazo, todas en Observaciones:
el heartbeat mide la edad por `mtime` y no por el `ts` de dentro del estado (§4.3 decía `ts`), y la
impresión usa un ayudante `imprimir()` en vez de `console.log` (consecuencia del rechazo del
intento 1, no una decisión libre).

---

## 3 · El nivel de construcción

Lo bueno, y es la mayor parte: **una sola `canonizar()` sirve para escribir y para verificar**
(`:52-72`), que era la lección de `verifyTenantInvoices` y está bien copiada; `rclone` siempre por
`execFileSync`, nunca por shell (`:172-174`); **sin rama blanda en ningún sitio** — un objeto sin
`sha256` lanza (`:195`, `:250`), un `backend encode` que devuelve menos líneas de las pedidas lanza
(`:269-271`), y no leer el destino es alarma y no cero (`:379-388`); escritura por `tmp` + `rename`
+ `chmod 600` explícito; el manifiesto y el estado llevan el **mismo `$SUFFIX`** que `last-success`,
así que las dos copias no comparten fichero (riesgo 13); y el detalle fino de comparar contra el
**registro más reciente** por nombre (`:359`, `:466`) hace que la re-subida del mismo día salga
verde de verdad, no por casualidad.

**Y hay un fallo de construcción que impide aprobar**, detallado abajo: la pieza guarda en cada
línea el mundo del destino (`destino.modo`) y **nunca lo vuelve a mirar**, así que un cambio de
configuración se le presenta al dueño con las mismas palabras que un ataque.

---

## 4 · Qué se rompe

- **La cadena de VERI\*FACTU:** intacta. No se toca `modules/`, ni `calcHash`, ni ninguna tabla.
- **Datos de tenant:** intactos. Las bases se leen en `readonly` vía `db-snapshot.mjs`, que no cambia.
- **Pantallas:** ninguna. Sin rutas nuevas, sin ventanitas: el censo no cambia.
- **La copia diaria (riesgo 1, el grande):** mitigado y comprobado. En las tres pasadas con alarma
  que ejecuté, la copia de hoy quedó subida y verificada y `last-success` fresco.
- **Riesgos 2, 3, 4, 6, 7, 8, 13:** mitigados; los he visto funcionar (TOFU, re-subida, borde de
  retención, `0 descargas`, una llamada, separación de señales, ficheros por sufijo).
- **Riesgo 5 — el cambio de mundo: NO mitigado en la dirección que importa.** El análisis lo declara
  como riesgo y además lo eleva a condición de diseño. La construcción evita el «se queda ciego y en
  VERDE», pero cae en el fallo simétrico: **grita en rojo por algo que no pasó, y deja de vigilar**.

---

## Motivos de rechazo

### [NIVEL-INSUFICIENTE] El manifiesto confunde «cambió el mundo del destino» con «manipularon el histórico», y deja de vigilar mientras grita

**Dónde:** `scripts/lib/manifiesto-copias.mjs:390-397` (`destinoDe`) y `:376` (el filtro `nuevos`).

**Qué pasa:** cada línea guarda el mundo en que se escribió (`destino.modo`, `destino.base`,
`destino.ruta`) y **la verificación no vuelve a mirar ese campo nunca**. `destinoDe()` reutiliza
`previo.destino.ruta` con solo saber que el nombre ya está registrado, sin comprobar que el registro
sea del mismo mundo que la pasada de esta noche. Y `nuevos` (`:376`) excluye de `codificarRutas` a
todo nombre ya registrado, así que su ruta cifrada **no se calcula nunca**. Resultado: el día en que
Ibrahin ejecute `bash scripts/cifrar-copias-de-seguridad.sh` —la orden que está pendiente ahora
mismo, y que CLAUDE.md da por inminente— el destino pasa a `crypt` y **todo lo registrado hasta esa
noche se busca por su nombre en claro dentro de un mapa de rutas cifradas**, que nunca casa.

Reproducido hoy en laboratorio local (sin Drive, sin red), montando la transición tal y como la hace
`cifrar-copias-de-seguridad.sh`: noche 1 en claro; luego se crea el `crypt`, **se migra el histórico
dentro** y se escribe `backup-destinos.conf`:

```
objetos ya dentro del crypt:
control-2026-09-02.db
historico-2026-08-30.db
noche 2 (primera CIFRADA) exit=1
[bamburu-backup] destino: lcripto:daily — CIFRADO
[bamburu-backup] Manifiesto: 2 objetos comprobados · 3 alarmas · 0 descargas
[bamburu-backup] ALARMA del manifiesto: retención saltada, copia de hoy marcada como hecha.
ALARMA: "control-2026-09-02.db" se subió esta noche pero no aparece en el destino
ALARMA: falta "control-2026-09-02.db" en el destino (edad 0d, retención 14d) — ¿borrado?
ALARMA: falta "historico-2026-08-30.db" en el destino (edad 3d, retención 14d) — ¿borrado?
```

Los dos ficheros **están en el destino** (`rclone lsf lcripto:daily` los lista, ahí arriba) y
`control-2026-09-02.db` acababa de subirse, verificarse por `cryptcheck` y compararse byte a byte
por el propio bash cinco segundos antes. Las tres alarmas son falsas, y no son un ruido inocuo:

- **La retención no se ejecuta** — y no volverá a ejecutarse mientras dure la avería.
- **El manifiesto deja de registrar.** Como cada artefacto se va por el `continue` de `:410`, no se
  añade ninguna línea; y los objetos del destino ya registrados se saltan en el bucle de
  `observado` (`:436`). Medido en noches 3 y 4 del mismo laboratorio: `exit=1`, `alarmas: 3`,
  `lineas=2` — el fichero se quedó clavado en las 2 líneas de la etapa en claro. **La pieza sigue
  encendida, con las luces rojas puestas, y ya no vigila nada.** Es la avería que esta tarea venía a
  matar, con el signo cambiado.
- En producción, con la transición en un día distinto al de los últimos registros, los artefactos de
  esa noche sí se registran (nombre nuevo → sí pasa por `codificarRutas`), pero **todo nombre
  registrado antes del cambio** resuelve a `null` y sale como *«¿borrado?»* mientras su edad sea
  `< RETENCION − 1`: por la propia cuenta del análisis, del orden de **250 objetos**, con 🚨 cada
  noche y sin retención, hasta que caduquen ellos solos ~13 noches después.

**La avería es simétrica, y la vuelta también está medida.** El script contempla a propósito volver
a claro («si el fichero desaparece, se vuelve a claro»). Ahí `destinoDe` sí encuentra el objeto —en
claro busca por nombre en el mapa vivo— pero `:477` compara la huella **del contenido en claro**
contra el `destino.sha256` guardado, que era **la huella del texto cifrado**. Reproducido con un
objeto histórico presente y migrado:

```
noche 2 (vuelta a CLARO) exit=1
[bamburu-backup] Manifiesto: 2 objetos comprobados · 1 alarmas · 0 descargas
ALARMA: "historico-2026-08-30.db": la huella cambió respecto a lo registrado — ¿manipulado?
```

Esto no es un caso límite rebuscado: es **la condición de diseño que el propio análisis escribió**
(«Los dos mundos sin rama blanda … el manifiesto tiene que funcionar en claro **y** cifrado desde el
primer día, porque el día que Ibrahin ejecute `scripts/cifrar-copias-de-seguridad.sh` el destino
cambia sin avisar a nadie»), y es el riesgo 5 de su propia tabla. El test lo pasa por alto porque
monta cada mundo **desde cero** (`scripts/test-manifiesto-copias.mjs:74-120`, dos laboratorios
independientes) y nunca cruza de uno al otro.

**Qué hay que hacer** — cuatro cosas concretas, todas dentro de `cmdPasada`:

1. **Decidir si el descriptor guardado sigue sirviendo, antes de usarlo.** En `destinoDe`
   (`:390-397`), reutilizar `previo.destino.ruta` **solo si** `previo.destino.modo === modo` y —en
   cifrado— `previo.destino.base === infoCifrado.base`. Si no, tratar ese nombre como si no tuviera
   ruta: incluirlo en `nuevos` (`:376`) para que `codificarRutas` calcule su ruta cifrada actual, y
   que `destinoDe` caiga en `mapaCodificado.get(nombre)`.
2. **No comparar huellas de mundos distintos.** En `:477`, cuando `registro.destino.modo !== modo`,
   el `destino.sha256` guardado no es comparable (texto en claro contra texto cifrado) y **no debe
   producir alarma**. En su lugar, **re-anclar**: añadir una línea nueva para ese nombre con el
   descriptor del mundo de hoy —origen propio, p. ej. `"reanclado"`, para que se distinga de
   `subido` y de `observado`—, y a partir de esa noche verificarlo como a todos los demás. Es la
   misma doctrina TOFU que ya está escrita en el análisis para el objeto desconocido: un cambio de
   configuración es un suceso de operación, no un ataque, y **se cuenta con palabras en vez de
   callarse o gritar**.
   Con un matiz que sí es una comprobación de verdad y conviene no perder: en la vuelta
   **cifrado → claro**, el registro viejo tiene `sha256` **en claro** no nulo, así que ahí sí se
   puede y se debe comparar `mapaDestinoClaro.get(nombre).sha256` contra `registro.sha256` — eso es
   continuidad de contenido real, no una excepción.
3. **Decirlo en el resumen y en el correo.** Una línea propia, con su número, junto a la de
   `observado`s: *«N objetos re-anclados porque el destino cambió de EN CLARO a CIFRADO»*. Sin
   número y sin palabras vuelve a ser un cambio silencioso, que es justo lo que este fichero existe
   para impedir.
4. **Un caso (h) en `scripts/test-manifiesto-copias.mjs`, en las dos direcciones**, porque un arreglo
   sin prueba aquí se vuelve a romper: pasada en claro → crear el `crypt`, migrar el destino y
   escribir `backup-destinos.conf` → **exigir `exit 0`, cero alarmas, que el resumen nombre el
   re-anclaje con su recuento, que la retención SÍ se ejecute y que el manifiesto siga creciendo**;
   y el camino inverso, borrando el fichero de destinos. El laboratorio ya está escrito casi entero:
   `montarLab('claro')` y `montarLab('cifrado')` comparten `lbase`, así que basta con crear el
   `crypt` sobre el mismo `tmp` y mover el destino.

Y una línea en `deploy/systemd/README.md` §«Manifiesto de huellas del histórico» diciendo qué pasa
la noche en que se enciende el cifrado — hoy el README no lo menciona, y es la única noche en la que
el dueño va a estar mirando.

---

## Observaciones (no bloquean)

1. **El heartbeat mide la edad por `mtime`, no por el `ts` del estado.**
   `scripts/bamburu-backup-heartbeat.sh:107` usa `stat -c%Y`, mientras que el análisis §4.3 pedía
   *«su `ts` tiene más de 48 h»*. Funciona —lo he comprobado con `touch -d '72 hours ago'`— y el `ts`
   real está dentro del fichero y ya se imprime. La diferencia importa poco, salvo que un `touch`
   (o una restauración del directorio de estado) rejuvenece el fichero sin rejuvenecer la
   comprobación. Cambiarlo a leer el `ts` del JSON cuesta una línea y cierra el hueco.

2. **Borrar `manifiesto$SUFFIX.estado.json` desarma la detección de truncado.**
   La comprobación de cabeza contra la pasada anterior (`scripts/lib/manifiesto-copias.mjs:345-355`)
   solo se aplica `if (estadoAnterior …)`; sin estado, no hay comparación. Los dos ficheros viven en
   el mismo directorio y con los mismos permisos, así que quien pueda editar uno puede borrar el
   otro. Lo tapa a medias el heartbeat, que sí grita *«nunca ha registrado un estado»* — y el
   análisis ya declara el servidor comprometido fuera de alcance—, pero conviene que quede escrito
   donde se lee: hoy el README no lo dice.

3. **`imprimir()` en vez de `console.log` se aparta del patrón del resto de `scripts/`.**
   `scripts/lib/manifiesto-copias.mjs:93` y `scripts/test-manifiesto-copias.mjs:28`. En este repo
   **todos** los `scripts/*.mjs` imprimen con `console.log` (incluidos `db-snapshot.mjs` y los
   noventa y tantos gates), así que aquí hay un patrón nuevo al lado del que ya había. Dicho esto:
   **viene del rechazo del intento 1**, que marcó esos `console.log` como restos de depuración, y el
   cambio es honesto —mismo texto, mismo destino, con su comentario explicando el porqué— y no
   esconde comportamiento. Lo apunto para que conste de dónde sale la excepción, no como reproche.
   `console.error` sigue usándose en `:528` y `:531`, que es lo correcto para el uso y el fallo.

4. **`scripts/test-manifiesto-copias.mjs` no está en `scripts/lib/gates-mapa.mjs`.**
   El censo de `run-gates.mjs` solo vigila los `gate-*`, así que nadie va a avisar de que falta; el
   efecto es que esta prueba solo corre a mano y no entrará en ningún barrido. El análisis no lo
   pedía, así que no es incumplimiento. El sitio natural es el grupo `infra`, donde ya están
   `verify-wal-acotado` y `gate-conciliacion-deshacer`.

5. **`codificarRutas` con un `REMOTE` sin subruta.** `scripts/lib/manifiesto-copias.mjs:261`
   construye `${subpath}/${nombre}`; con un destino tipo `gdrive_cif:` (sin carpeta) saldría
   `/nombre`, con barra inicial. Producción usa `…:Bamburu-backup/daily`, así que hoy no ocurre.

6. **El §Resumen de `docs/seguridad/vectores-de-ataque.md:16` pasa el vector 7 a «Protegido».**
   Se apoya en un matiz correcto y bien explicado en el cuerpo («detecta, no impide»), y el análisis
   dejaba la redacción abierta (*«pasa a lo que sea cierto ese día»*). Lo dejo como observación
   porque, mientras el arreglo del cambio de mundo no esté, ese «Sólida en el histórico» de la
   tabla deja de ser cierto la noche en que se encienda el cifrado — o sea, la misma noche en que
   alguien va a abrir ese documento.
