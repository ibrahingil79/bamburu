❌ RECHAZADO

# Revisión — Manifiesto de huellas del histórico de copias

- **taskId:** `manifiesto-huellas-backups`
- **fecha:** 2026-09-02
- **papel:** revisor
- **intento:** 3
- **analizado:** `docs/architecture/task-manifiesto-huellas-backups-analysis.md`
- **commits revisados:** `21356b8..HEAD` → `6dff180` («El manifiesto re-ancla, no compara, cuando el
  destino cambia de mundo»), sobre la construcción entera de `66c9ab7` + `21356b8`

> **Los ocho criterios de aceptación siguen en SÍ, y los he vuelto a medir yo, ejecutando las piezas
> en laboratorios propios y no reutilizando la revisión anterior.** El arreglo que pedía el intento 2
> está hecho y está bien hecho: el re-anclaje funciona en las dos direcciones, incluida la excepción
> fina de continuidad de contenido en la vuelta cifrado → claro, que he reproducido en verde y en
> rojo.
>
> **El rechazo es por el nivel de construcción**, y es el mismo defecto de raíz del intento 2 en su
> otra mitad: se arregló el caso «el destino cambió de mundo **y el histórico se migró con él**», y
> queda abierto el caso «el destino cambió de mundo **y el histórico se quedó donde estaba**» — que
> es el camino **por defecto** del guion de cifrado, porque `--migrar-historico` es un paso aparte y
> opcional («*Lo que queda, cuando quieras*», `scripts/cifrar-copias-de-seguridad.sh:314-323`). En
> ese camino, medido, el manifiesto declara **borrados** 3 de 3 objetos que están intactos en Drive,
> salta la retención y manda 🚨, **todas las noches** — y el README nuevo promete por escrito lo
> contrario. Reproducido abajo con su salida.

---

## 1 · Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | `node scripts/test-manifiesto-copias.mjs` sale 0 y ejecuta el `bamburu-backup.sh` **real** contra un remote local en claro y contra un `crypt` local, cubriendo (a)–(g) en los dos mundos | **SÍ** | Ejecutado hoy: `87 OK · 0 fallos`, `EXIT=0`, 31 s. Las siete etiquetas `(a)`…`(g)` salen bajo `MUNDO: CLARO` **y** bajo `MUNDO: CIFRADO`, más el escenario 4 `(h)` nuevo. Que ejecuta el script de verdad: `scripts/test-manifiesto-copias.mjs:123` (`spawnSync('bash', [BACKUP_SH])`); el `crypt` local se crea en `:109-111`; nada toca `gdrive:` (`RCLONE_CONFIG` a `/tmp`, `:86`) |
| 2 | Una línea por artefacto subido, cada una con `sha256` de 64 hex y `prev`/`hash` enlazados; fichero en `600`; `verificar-cadena` sale 0 | **SÍ** | Laboratorio propio (3 artefactos + 1 preexistente): `n=1 control-2026-09-02.db origen=subido sha256=a643a9cc… len(hash)=64 prev=(vacío)` · `n=2 … prev=ac318546` · `n=3 … prev=81fb229c` · `n=4 viejo-2026-08-27.db origen=observado prev=4b6856c2`. `stat` → **600** en `manifiesto.jsonl` **y** en `manifiesto.estado.json`. `node scripts/lib/manifiesto-copias.mjs verificar-cadena` → `líneas: 4 · cabeza: d929068b…`, `exit=0` |
| 3 | Alterar un objeto del histórico **o** borrar uno con edad < `RETENTION_DAYS − 1` → la pasada siguiente sale **1** y **nombra el fichero**; borrar uno de más de `RETENTION_DAYS` días **no** alarma | **SÍ** | Test, casos (c)/(d)/(e) en los dos mundos, los ocho `✓`. Verificado además en laboratorio propio: manipulando `negocio-2026-09-02.db` en el destino, `exit=1` y `ALARMA: "negocio-2026-09-02.db": la huella cambió respecto a lo registrado — ¿manipulado?`. Reglas en `scripts/lib/manifiesto-copias.mjs:494` (edad) y `:538` (huella) |
| 4 | Con alarma del histórico, `rclone delete --min-age` **no** se ejecuta (un objeto de +`RETENTION_DAYS` sigue ahí) y **sí** se escribe `last-success` | **SÍ** | Test: `(c) la retención NO se ejecutó: el objeto de +RETENTION_DAYS sigue en el destino` y `(criterio 4) last-success queda reciente pese a la alarma`, en claro y en cifrado. En laboratorio propio, la pasada con manipulación imprime `ALARMA del manifiesto: retención saltada, copia de hoy marcada como hecha.`; en el código, `date +%s > "$LAST_OK"` va **antes** del `exit 1` y el bloque de retención va **después** (`scripts/bamburu-backup.sh:301-319`) |
| 5 | Primera pasada sobre destino con objetos previos y sin manifiesto: **sin alarma**, quedan `"origen":"observado"` y el resumen dice cuántos son | **SÍ** | Laboratorio propio: `Manifiesto: 0 objetos comprobados · 0 alarmas · 0 descargas · cabeza d929068b…` seguido de `1 objetos que esta copia no subió (registrados por primera vez)`, y la línea `n=4 viejo-2026-08-27.db origen=observado`. Código: `:453-477` |
| 6 | La pasada imprime el recuento de comprobados y **`0 descargas`**; en claro la verificación del histórico hace **una sola** invocación de `rclone` (`lsjson … --hash --hash-type sha256`) | **SÍ** | Laboratorio propio con `RCLONE_BIN` apuntando a un contador: el fichero de llamadas del ayudante tiene **una** línea, exactamente `lsjson lbase:…/destino --hash --hash-type sha256 --files-only`. La cadena `0 descargas` sale en el resumen (`:305`) |
| 7 | El cuerpo del correo diario de éxito incluye el **SHA-256 de cada artefacto** y la **cabeza de la cadena** | **SÍ** | `curl` interceptado en laboratorio (sin red, sin Resend). Cuerpo real: tres líneas `• <artefacto> (…) — subido, verificado y restore OK — sha256 <64 hex>` y `Manifiesto: 0 objetos comprobados · 0 alarmas · 0 descargas · cabeza d929068b70748ddf932b1899e195d211126029637d38ec184aec3a2603e75455` — la cabeza va **entera**. La línea nueva de re-anclaje también llega al correo: verificado en la transición, `1 objetos re-anclados porque el destino cambió de EN CLARO a CIFRADO` |
| 8 | `bash scripts/bamburu-backup-heartbeat.sh` avisa si el `manifiesto*.estado.json` de una copia esperada no existe, tiene más de 48 h, o su último resultado trae alarmas | **SÍ** | Ejecutado en los cuatro casos con el `curl` interceptado. Sano (dos estados frescos): `[heartbeat] MANIFIESTO: histórico vigilado, sin alarmas, en 2 copia(s)` y **0 correos**. Sin estado: `· principal: el manifiesto de huellas nunca ha registrado un estado`. `touch -d '72 hours ago'`: `· principal: la verificación del histórico lleva más de 48h sin correr`. Con alarmas dentro del estado: el correo **repite la alarma literal** (`ALARMA: "duniya-2026-08-28.db": la huella cambió respecto a lo registrado — ¿manipulado?`) |

**Ningún criterio en NO.** El rechazo no viene de aquí.

---

## 2 · ¿Se construyó lo que decía el análisis?

**Sí, y el encargo del intento 2 está cumplido punto por punto.** `6dff180` toca cuatro ficheros y
los cuatro están nombrados en el §4 del análisis: `scripts/lib/manifiesto-copias.mjs`,
`scripts/bamburu-backup.sh`, `scripts/test-manifiesto-copias.mjs` y `deploy/systemd/README.md`. Ni
un fichero de `modules/`, ni migración, ni ruta nueva: los riesgos 9, 10 y 11 del análisis se
respetan.

Los cuatro puntos que pedía el rechazo anterior, comprobados:

1. **Decidir si el descriptor guardado sigue sirviendo antes de usarlo** — hecho, con la función
   `mismoMundoQueRegistro()` (`:379-384`), usada tanto en el filtro `nuevos` (`:396`) como en
   `destinoDe` (`:413`).
2. **No comparar huellas de mundos distintos, re-anclar** — hecho (`:499-537`), con `origen`
   propio `"reanclado"`. **Y la excepción fina que pedía el texto —comparar el `sha256` en claro en
   la vuelta cifrado → claro— está puesta (`:509`) y funciona.** Es el punto que más me costó
   alcanzar y lo he medido en los dos sentidos, montando un laboratorio donde un tenant desaparece
   para que su objeto de la etapa cifrada quede como registro viejo:
   `CASO A — contenido intacto: exit=0, 0 alarmas, 1 objetos re-anclados porque el destino cambió de
   CIFRADO a EN CLARO`; `CASO B — mismo montaje con el objeto manipulado: exit=1, ALARMA:
   "negocio-2026-09-02.db": la huella cambió respecto a lo registrado — ¿manipulado?`. La
   continuidad de contenido no se perdió al re-anclar.
3. **Decirlo en el resumen y en el correo** — hecho (`:307-311` en el ayudante, `:295-299` en el
   bash), y verificado dentro del cuerpo del correo real.
4. **Caso (h) en el test, en las dos direcciones** — hecho (`escenario4`,
   `scripts/test-manifiesto-copias.mjs:307-373`): 12 `✓`, incluida `la retención SÍ se ejecuta tras
   el re-anclaje` y `el manifiesto sigue creciendo`.

Y la línea del README §«Manifiesto de huellas del histórico» está escrita
(`deploy/systemd/README.md:156-163`).

**Desviación:** ninguna en el reparto de ficheros. Lo que falta no es un fichero, es un caso.

---

## 3 · El nivel de construcción

Lo bueno se mantiene y crece: una sola `canonizar()` para escribir y verificar; `rclone` siempre por
`execFileSync`; sin rama blanda en ningún sitio; escritura `tmp`+`rename`+`chmod 600`; el mismo
`$SUFFIX` que `last-success`; comparación contra el **registro más reciente** por nombre. El
re-anclaje nuevo está escrito con la doctrina correcta (TOFU de operación, contado con palabras y con
su número) y con un comentario que explica el *porqué*, no el *qué*.

**Y hay un fallo de construcción que impide aprobar**, en la pregunta que esta sección hace
literalmente — *«¿distingue los errores entre sí, o los mete todos en el mismo saco?»*. La pieza
decide «esto es el mismo mundo» con dos campos (`destino.modo` y, en cifrado, `destino.base`) que
**no identifican el mundo lo suficiente**, y **todo lo que esa decisión clasifica mal sale por el
mismo desagüe: `¿borrado?`**. Detalle abajo.

---

## 4 · Qué se rompe

- **La cadena de VERI\*FACTU:** intacta. No se toca `modules/`, ni `calcHash`, ni ninguna tabla.
- **Datos de tenant:** intactos. Las bases se leen en `readonly` vía `db-snapshot.mjs`, sin cambios.
- **Pantallas:** ninguna. Sin rutas nuevas ni ventanitas; el censo no cambia.
- **La copia diaria (riesgo 1, el grande):** mitigado y comprobado. En las cinco pasadas con alarma
  que he ejecutado hoy, la copia de hoy quedó subida, verificada y con `last-success` fresco.
- **Riesgos 2, 3, 4, 6, 7, 8, 13:** mitigados; los he visto funcionar.
- **Riesgo 5 — el cambio de mundo:** mitigado **solo si el histórico viaja con el destino**. Si se
  queda en el destino anterior —el camino por defecto del guion de cifrado— el fallo del intento 2
  vuelve entero.

---

## Motivos de rechazo

### [NIVEL-INSUFICIENTE] «El destino cambió y el histórico se quedó atrás» sale por la misma boca que «alguien borró tus copias» — y el README promete lo contrario

**Dónde:** `scripts/lib/manifiesto-copias.mjs:379-384` (`mismoMundoQueRegistro`), `:491-498` (la rama
`!actual`) y `deploy/systemd/README.md:156-163`.

**Qué pasa.** `mismoMundoQueRegistro()` responde «mismo mundo» comparando `modo` y, solo en cifrado,
`destino.base`. Cuando esa respuesta es *sí* pero el objeto ya no está donde dice su registro,
`destinoDe()` devuelve `null` y el objeto cae en la rama de ausencia (`:491`), que solo sabe decir
una cosa: `falta "X" en el destino (edad Nd, retención 14d) — ¿borrado?`, con `exit 1`, **retención
saltada** y correo 🚨. Y cuando la respuesta es *no* pero el objeto tampoco está en el destino nuevo,
cae en la misma rama, porque el re-anclaje (`:499`) va **después** de la comprobación de ausencia y
nunca llega a ejecutarse.

Eso ocurre en **el camino por defecto del cifrado**. `scripts/cifrar-copias-de-seguridad.sh` escribe
el fichero de destinos —y con eso las copias pasan al `crypt`— y deja la migración del histórico como
un paso **aparte y opcional**, con estas palabras suyas (`:314-323`):

```
Lo que queda, cuando quieras:
  2) El histórico que ya está en claro en Drive NO caduca solo […] Para retirarlo:
       bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico
```

Reproducido hoy en laboratorio local (sin Drive, sin red): noche 1 en claro con tres objetos de 3, 5
y 7 días; después se crea el `crypt` y se escribe `backup-destinos.conf` **sin migrar nada**, que es
literalmente lo que pasa si Ibrahin ejecuta el guion y se va a dormir:

```
NOCHE1 claro exit=0
NOCHE2 cifrada SIN migrar exit=1
[bamburu-backup] Manifiesto: 5 objetos comprobados · 3 alarmas · 0 descargas
ALARMA: falta "historico-2026-08-26.db" en el destino (edad 7d, retención 14d) — ¿borrado?
ALARMA: falta "historico-2026-08-28.db" en el destino (edad 5d, retención 14d) — ¿borrado?
ALARMA: falta "historico-2026-08-30.db" en el destino (edad 3d, retención 14d) — ¿borrado?
[bamburu-backup] ALARMA del manifiesto: retención saltada, copia de hoy marcada como hecha.
NOCHE3 exit=1  (las mismas tres alarmas, otra vez)
objetos que siguen en el destino EN CLARO: control-2026-09-02.db, historico-2026-08-26.db,
                                           historico-2026-08-28.db, historico-2026-08-30.db, …
```

**Los tres ficheros están en Drive, intactos, en la última línea de esa misma salida.** Nadie los
borró. Y esto no es una noche: se repite **cada noche** mientras su edad siga por debajo de
`RETENCION − 1`, o sea ~13 noches, sin retención en el destino nuevo. Con las cifras que mide el
propio análisis (§1.2: 14 días, 283 objetos en la principal), eso es un correo 🚨 con del orden de
**260 líneas diciendo «¿borrado?»** sobre copias que están donde tienen que estar. Es la definición
de la alarma que el análisis quería evitar: *«una alarma que grita todos los días es una alarma
apagada»*.

**Y la parte que lo convierte en rechazo y no en observación:** el README nuevo dice, en el sitio
donde el dueño va a mirar esa misma noche (`deploy/systemd/README.md:156-163`):

> **La noche en que el destino cambia de mundo** (se ejecuta
> `scripts/cifrar-copias-de-seguridad.sh`, o se apaga borrando el fichero de destinos): […] cada
> objeto del histórico se **re-ancla** (no se compara, no alarma) […]

Ejecutar `scripts/cifrar-copias-de-seguridad.sh` es exactamente el gesto que nombra esa frase, y lo
medido es lo contrario: no re-ancla, alarma, y para la retención. Es el *«censo que dice CERO y no es
cierto»* de `CLAUDE.md`, en el documento que se lee cuando ya no hay tiempo de leer código.

**La misma raíz, medida en un segundo sitio.** Los comentarios de `:375` y `:501` afirman los dos que
el re-anclaje también cubre *«o rotó la clave»*. No lo cubre: con la clave rotada, `modo` y
`destino.base` no cambian, así que `mismoMundoQueRegistro()` dice «mismo mundo», `destinoDe()`
reutiliza la ruta cifrada vieja —que ya no existe, porque el nombre se cifra con la clave nueva— y
sale esto (laboratorio propio, mismo `crypt`, misma raíz, clave nueva):

```
NOCHE2 (clave 2, mismo base y misma ruta) exit=1
ALARMA: "control-2026-09-02.db" se subió esta noche pero no aparece en el destino
ALARMA: "uploads-2026-09-02.tar.gz" se subió esta noche pero no aparece en el destino
ALARMA: falta "control-2026-09-02.db" en el destino (edad 0d, retención 14d) — ¿borrado?
ALARMA: falta "historico-2026-08-29.db" en el destino (edad 4d, retención 14d) — ¿borrado?
el objeto SIGUE legible: control-2026-09-02.db, historico-2026-08-29.db, uploads-2026-09-02.tar.gz
```

Fíjate en la tercera línea: `control-2026-09-02.db` **se acababa de subir, verificar por `cryptcheck`
y comparar byte a byte cinco segundos antes**, y el manifiesto lo da por borrado. La ruta guardada se
cree por delante del destino vivo. La rotación de clave no es hoy una operación soportada por el
guion de cifrado —por eso esto no bloquea por sí solo—, pero el comentario dice dos veces que sí lo
está, y ahí sí hay que elegir: o lo cubre, o deja de decirlo.

**Qué hay que hacer** — tres cosas, todas dentro de `cmdPasada` y del README:

1. **Distinguir la ausencia por cambio de mundo de la ausencia a secas.** En la rama `!actual`
   (`:491`), preguntar primero por `mismoMundoQueRegistro(registro)`. Si el registro es de **otro**
   mundo y el objeto no aparece en el destino de hoy, **no es un borrado**: es histórico que se quedó
   en el destino anterior. Sale con sus propias palabras y su propio recuento, junto a la línea de
   re-anclajes — p. ej. *«N objetos del histórico se quedaron en el destino anterior (EN CLARO); no
   se han borrado — para retirarlos: `bash scripts/cifrar-copias-de-seguridad.sh
   --migrar-historico`»*—, y **no debe dejar la retención parada 13 noches**. Si el arquitecto
   decide que además tiene que ser alarma, que lo sea; lo que no puede es salir con la palabra
   `¿borrado?` ni compartir desagüe con la manipulación, que es lo que este fichero existe para
   distinguir.
2. **Que «el mismo mundo» se decida por lo que de verdad identifica el mundo.** Hoy en claro no se
   compara `destino.base` en absoluto (`:381-383`), así que un `BACKUP_REMOTE` distinto en claro cae
   en el mismo agujero que el cifrado sin migrar. La comparación uniforme
   `reg.destino.base !== (modo === 'cifrado' ? infoCifrado.base : remote)` cierra los dos de una vez
   —y funciona bien con la excepción de continuidad de `:509`, que sigue comparando el `sha256` en
   claro cuando lo hay—. Para la clave rotada, o se detecta (la ruta cifrada registrada ya no existe
   **y** el nombre sí aparece en el `lsf` del crypt ⇒ mundo distinto, re-anclar) o se quitan las dos
   menciones a *«o rotó la clave»* de `:375` y `:501`. Las dos salidas valen; dejar el comentario
   como está, no.
3. **Corregir el README y probarlo.** `deploy/systemd/README.md:156-163` tiene que decir qué pasa en
   **los dos** caminos —migrando y sin migrar—, y si la frase actual se queda, se tacha con su motivo
   y su fecha, no se borra (regla del repo). Y un caso `(i)` en `scripts/test-manifiesto-copias.mjs`,
   junto al `escenario4` que ya existe y que sirve casi entero: **misma transición pero sin el
   `rclone copy` de migración**, exigiendo que la salida **no** contenga `¿borrado?`, que nombre los
   objetos que se quedaron atrás con su recuento, y lo que se decida sobre la retención. Sin ese
   caso, esto se vuelve a romper: el `escenario4` de hoy pasa en verde **porque migra**, y por eso no
   vio nada.

---

## Observaciones (no bloquean)

1. **`comprobados` cuenta como comprobado lo que no se comprobó.** `scripts/lib/manifiesto-copias.mjs:490`
   incrementa el contador antes de saber qué pasa con el objeto, así que un re-anclado (que no se
   compara) y un ausente (que no está) suman igual que uno verificado. Medido: la noche de la
   transición imprime `3 objetos comprobados · 0 alarmas` con 1 de esos 3 re-anclado sin comparar. No
   engaña del todo, porque la línea de re-anclajes va justo debajo con su número; pero el titular
   dice más de lo que hizo.

2. **`reanclados` se escribe en el estado y no se lee nunca.** El campo entra en
   `manifiesto$SUFFIX.estado.json` (`:546`) pero `cmdEstado` (`:577`) no lo imprime, así que el
   heartbeat —el único consumidor de ese subcomando— no lo ve. Además, las tres salidas tempranas
   (`:338-342`, `:353-357`, `:401-405`) escriben el estado **sin** ese campo, con lo que el JSON no
   tiene una forma única. Una clave más en la línea de `cmdEstado` y `reanclados: 0` en las tres
   salidas tempranas lo dejan coherente.

3. **Re-anclar hacia el mundo cifrado tira un `sha256` en claro que ya se conocía.** `:522` guarda
   `sha256: null` cuando `modo === 'cifrado'`, aunque el registro anterior traía la huella del
   contenido, que **no depende del mundo**. Consecuencia medida en el laboratorio de ida y vuelta: al
   apagar el cifrado, ese objeto se re-ancla otra vez sin poder comparar nada, cuando su huella en
   claro estaba a mano. Arrastrar `registro.sha256` en el re-anclaje hacia cifrado conserva la
   continuidad y ayuda además a quien restaure (riesgo 12 del análisis).

4. **La excepción de continuidad de `:509` no la cubre ninguna prueba automática.** Funciona —la he
   medido en verde y en rojo—, pero el `escenario4` no la ejerce: el objeto que cruza en su
   laboratorio llega a la vuelta con `sha256: null` (por la observación 3), así que la comparación
   nunca se intenta. Para alcanzarla hay que dejar un registro `origen:"subido"` de la etapa cifrada
   sin re-subir esa noche —en mi laboratorio, borrando la BD del tenant antes de la vuelta—. Es la
   única comprobación **real** que sobrevive a un cambio de mundo: conviene que tenga su `✓`.

5. **Carryover del intento 2, sigue vigente:** el heartbeat mide la edad del estado por `mtime`
   (`scripts/bamburu-backup-heartbeat.sh:107`) y no por el `ts` de dentro, que es lo que pedía §4.3;
   `scripts/test-manifiesto-copias.mjs` no está en `scripts/lib/gates-mapa.mjs`, así que no entrará
   en ningún barrido; y `codificarRutas` (`:261`) construiría `/nombre` con un `REMOTE` sin subruta.

6. **El §Resumen de `docs/seguridad/vectores-de-ataque.md:16` da el vector 7 por «Protegido».**
   Mientras el punto de rechazo siga abierto, ese «Sólida en el histórico» deja de ser cierto la
   noche en que se encienda el cifrado — que es la misma noche en que alguien abrirá ese documento.
