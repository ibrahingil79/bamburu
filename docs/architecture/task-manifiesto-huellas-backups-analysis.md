♻️ REPLANTEAMIENTO

# Análisis — Manifiesto de huellas del histórico de copias

- **taskId:** `manifiesto-huellas-backups`
- **fecha:** 2026-09-02
- **papel:** arquitecto
- **intento:** 4 (replanteamiento tras 3 rechazos)
- **construcción existente:** `66c9ab7` + `21356b8` + `6dff180` — **no se tira, se corrige**

---

## 0 · Qué se intentó, por qué falló cada vez, y qué cambia en el enfoque

### Los tres intentos

| # | Qué se rechazó | Raíz |
|---|---|---|
| 1 | 21 `console.log(` en `scripts/lib/manifiesto-copias.mjs` y su test | Mecánico. Arreglado en `21356b8` (`imprimir()`, `:93`). No vuelve a aparecer. |
| 2 | «El manifiesto confunde "cambió el mundo del destino" con "manipularon el histórico"» | `destinoDe()` reutilizaba `previo.destino.ruta` sabiendo solo que el nombre estaba registrado. |
| 3 | «"El destino cambió y el histórico se quedó atrás" sale por la misma boca que "alguien borró tus copias"» | El arreglo del 2 cubrió *el destino cambió **y el histórico viajó con él***, y dejó abierto *el destino cambió **y el histórico se quedó***. |

### El patrón que hay que ver, porque es lo que hace falta romper

Los intentos 2 y 3 respondieron **la misma pregunta** —*«¿la huella que guardé es comparable con la de
hoy?»*— añadiendo cada vez un predicado más al mismo `if`. El intento 2 lo decidió por `destino.modo`;
el 3 le sumó `destino.base`, y solo en cifrado (`scripts/lib/manifiesto-copias.mjs:379-384`). Cada
afinado dejó fuera un caso distinto:

- un `BACKUP_REMOTE` distinto **en claro** (`base` no se compara en claro: `:381-383`);
- la **clave rotada** (ni `modo` ni `base` cambian, y los comentarios de `:375` y `:501` afirman dos
  veces que sí está cubierto);
- el **histórico que no viaja** — el camino **por defecto** de `scripts/cifrar-copias-de-seguridad.sh`,
  porque `--migrar-historico` es un paso aparte y opcional (`:314-323`).

**Un predicado de "mundo" nunca va a estar completo, porque intenta adivinar desde la configuración de
hoy algo que el propio registro ya sabe escrito.** Cada línea del manifiesto lleva `destino.base` y
`destino.ruta`: el sitio exacto donde estaba ese objeto cuando se anotó. Los tres intentos ignoraron
ese dato para verificar y solo lo usaron para reutilizar una ruta — que es justo el uso que provoca el
fallo de la clave rotada, donde *la ruta guardada se cree por delante del destino vivo*.

### El cambio de enfoque

**Se borra el concepto de «mundo».** `mismoMundoQueRegistro()` desaparece. La pasada deja de
clasificar configuraciones y pasa a **mirar dos sitios**:

1. **¿Sigue el objeto donde su propio registro dice que vive?** (`lsjson` de `reg.destino.base`,
   buscando `reg.destino.ruta` — la función `leerMapaBase()` que ya existe, sin plomería nueva.)
2. **¿Está en el destino de esta noche?** (calculado **solo** con lo que devuelve el destino de hoy,
   sin reutilizar ninguna ruta registrada.)

Con esas dos respuestas, la clasificación es una tabla exhaustiva de cuatro casillas más una excepción,
y **cada casilla tiene su propio desagüe**. Ninguna se alcanza «por caerse» de otra — que es lo que
pasa hoy, donde todo lo mal clasificado sale por `¿borrado?` (`:491-497`).

### Por qué esta vez sí

- El caso que tumbó al intento 3 **deja de ser un caso especial**: es la casilla «el objeto sigue donde
  dice su registro», resuelta **mirando**, no adivinando. Y con eso el histórico rezagado **se sigue
  vigilando de verdad** en vez de solo dejar de gritar — que es la diferencia entre callar una alarma y
  resolver el problema.
- La clave rotada **se cubre sin escribir código para ella**: su objeto sigue en el mismo `base` bajo la
  ruta antigua, y ahí es donde se le busca. El comentario de `:375`/`:501` pasa a ser cierto.
- **No se toca el formato de línea** (`canonizar()`, `:52-72`), así que la cadena que se cree esta
  madrugada no se invalida al desplegar esto. Ver §5, riesgo 1.
- Y las cuatro observaciones no bloqueantes del revisor entran en el mismo plan, porque tres de ellas
  son la misma raíz: contadores y mensajes que no se corresponden con lo que la pieza hizo.

---

## 1 · Qué está mal hoy

### 1.1 · El fallo que rechazó el intento 3, trazado en el código

Traza, línea a línea, de la noche en que Ibrahin ejecuta `bash scripts/cifrar-copias-de-seguridad.sh`
y se va a dormir (el histórico en claro se queda en `gdrive:Bamburu-backup/daily`):

1. `scripts/lib/manifiesto-copias.mjs:396` — `nuevos` se construye filtrando **`nombresEnDestino`**, o
   sea solo lo que hay en el destino de ESTA noche (el `crypt`). El histórico que se quedó en el remote
   en claro no está en esa lista, así que **no se codifica su ruta**.
2. `:413` — `destinoDe(nombre)`: `mismoMundoQueRegistro(previo)` es `false` (el registro es `claro`, la
   pasada es `cifrado`), así que se busca en `mapaCodificado`, que no lo tiene → `ruta` es `undefined`
   → **`return null`**.
3. `:491` — `if (!actual)`: cae en la rama de ausencia, que solo sabe decir una cosa:
   `` `falta "${nombre}" en el destino (edad ${edadDias}d, retención ${retencionDias}d) — ¿borrado?` ``
   (`:495`).
4. `scripts/bamburu-backup.sh:301` — `MANIF_OK != 0` → **la retención NO se ejecuta** y sale el correo
   🚨 «ALARMA en el histórico».
5. El re-anclaje (`:499-537`), que es lo que debería haber pasado, va **después** de la comprobación de
   ausencia y **nunca llega a ejecutarse**.

Y se repite **cada noche** mientras la edad del objeto sea menor que `retención − 1` (`:494`): unas 13
noches. Con las cifras medidas hoy contra Drive —**284 objetos** en la cuenta principal (ver §1.7)—, eso
es un correo 🚨 con del orden de **260 líneas diciendo «¿borrado?»** sobre copias que están intactas.

> Medido por el revisor hoy, en laboratorio local sin red (`task-manifiesto-huellas-backups-review-replanteo-0.md:141-152`):
> `NOCHE2 cifrada SIN migrar exit=1` · `3 alarmas` · las tres `¿borrado?` · y en la última línea de la
> misma salida, **los tres ficheros seguían en el destino en claro**.

### 1.2 · «El mismo mundo» se decide con campos que no identifican el mundo

`scripts/lib/manifiesto-copias.mjs:379-384`:

```js
function mismoMundoQueRegistro(reg) {
  if (!reg) return false;
  if (reg.destino.modo !== modo) return false;
  if (modo === 'cifrado' && reg.destino.base !== infoCifrado.base) return false;
  return true;
}
```

**En claro no se compara `base` en absoluto.** Cambiar `BACKUP_REMOTE` en la unit (o que el fichero de
destinos apunte a otra carpeta) da «mismo mundo» sobre un destino distinto: mismo agujero que §1.1, y
esta vez sin que nadie haya encendido el cifrado.

### 1.3 · La ruta registrada se usa para encontrar el objeto de HOY

`:413` — `const ruta = mismoMundoQueRegistro(previo) ? previo.destino.ruta : mapaCodificado.get(nombre);`

Con la clave del `crypt` rotada, `modo` y `base` no cambian → «mismo mundo» → se busca por la ruta
cifrada **vieja**, que ya no existe porque el nombre se cifra con la clave nueva. Medido por el revisor
(`review-replanteo-0.md:179-186`): `control-2026-09-02.db` **recién subido, verificado por `cryptcheck`
y comparado byte a byte cinco segundos antes**, declarado `¿borrado?`.

Y los comentarios de `:375` y `:501` afirman los dos que el re-anclaje cubre *«o rotó la clave»*. **No
lo cubre.** Un comentario que promete cobertura que no existe es la misma avería que *«un censo que dice
CERO y no es cierto»* de `CLAUDE.md`.

### 1.4 · El titular cuenta como comprobado lo que no se comprobó

`:490` — `comprobados += 1;` se ejecuta **antes** de saber qué pasa con el objeto. Un ausente (que no
está) y un re-anclado (que no se compara) suman igual que uno verificado.

### 1.5 · El estado no tiene una forma única, y lo que sí escribe no se lee

- `:546` escribe `reanclados` en `manifiesto$SUFFIX.estado.json`, y `cmdEstado` (`:577`) **no lo
  imprime** — así que el heartbeat, único consumidor de ese subcomando, no lo ve nunca.
- Las tres salidas tempranas (`:338-342`, `:353-357`, `:401-405`) escriben el estado **sin** ese campo:
  el JSON no tiene una forma única y quien lo lea tiene que adivinar.

### 1.6 · Re-anclar hacia cifrado tira una huella de contenido que ya se conocía

`:522` — `sha256: modo === 'cifrado' ? null : actual.sha256`. El `sha256` de nivel superior es la huella
del **contenido en claro**, que no depende del destino; al re-anclar hacia cifrado se pone a `null`
aunque el registro anterior la traía. Consecuencia: al apagar el cifrado, ese objeto se re-ancla otra vez
**sin poder comparar nada**, teniendo su huella a mano.

### 1.7 · bash conoce por su texto cada línea que imprime el ayudante

`scripts/bamburu-backup.sh:291-299` construye `$MANIF_BLOQUE` con **tres `grep` distintos**, uno por
frase (`'^Manifiesto: '`, `'objetos que esta copia no subió'`, `'objetos re-anclados porque el destino
cambió de'`). Cualquier línea nueva del ayudante **no llega al correo** hasta que alguien se acuerde de
añadir su `grep`. Es una lista a mano, y las listas a mano de este repo siempre se quedan cortas.

### 1.8 · El heartbeat mide la edad del estado por el `mtime`, no por su `ts`

`scripts/bamburu-backup-heartbeat.sh:107` — `stat -c%Y "$archivo_estado"`. Un `touch` (o cualquier cosa
que toque el fichero sin que la pasada haya corrido) rejuvenece la vigilancia. El campo `ts` está dentro
del estado y `cmdEstado` ya lo imprime.

### 1.9 · `codificarRutas` construye `/nombre` si el remote no trae subruta

`:261` — `` `${subpath}/${n}` ``. El patrón que acepta bash permite un destino sin ruta
(`^DESTINO_x=[A-Za-z0-9_]+:[A-Za-z0-9_./-]*$`, `bamburu-backup.sh:82`), y con `subpath` vacío sale
`/nombre`, que no es la ruta que cifra rclone.

### 1.10 · El README promete por escrito lo contrario de lo que hace

`deploy/systemd/README.md:156-163` dice que la noche en que se ejecuta
`scripts/cifrar-copias-de-seguridad.sh` *«cada objeto del histórico se re-ancla (no se compara, no
alarma)»*. Ejecutar ese guion es exactamente el gesto que nombra la frase, y lo medido es lo contrario.
Está escrito en el documento que se lee cuando ya no hay tiempo de leer código.

### 1.11 · La comprobación no entra en ningún barrido

`scripts/lib/gates-mapa.mjs` no contiene `test-manifiesto-copias` (grep vacío hoy). El fichero existe,
tarda 31 s, ejecuta el script de backup real… y **nadie lo lanza nunca**.

### 1.12 · Estado de la máquina HOY, medido (importa para el plan y para los riesgos)

| Qué | Medido con | Resultado |
|---|---|---|
| ¿Hay manifiesto en producción? | `ls ~/.local/state/bamburu-backup/` | **No.** Solo `last-success` y `last-success-secondary` (03:55 de hoy). |
| ¿Cuándo corre por primera vez? | `systemctl list-timers` | `bamburu-backup.timer` → **jue 3 sep 03:31 UTC**; la secundaria 03:35. |
| ¿Por qué no ha corrido? | `git log -1 --format=%ci 66c9ab7` | Se commiteó a las **05:58 de hoy**, después de la copia de las 03:32. |
| ¿En qué mundo va el destino? | `ls ~/.config/bamburu/` | No existe → **EN CLARO**. |
| ¿Cuántos objetos hay sin vigilar? | `rclone lsf gdrive:Bamburu-backup/daily --files-only \| wc -l` | **284** (incluye residuo `__gate_*` de gates antiguos). |
| ¿Drive da SHA-256 de verdad? | `rclone lsjson … --hash --hash-type sha256` | **Sí**, con `rclone v1.74.3`. Verificado sobre el destino real. |

Y una consecuencia que conviene dejar escrita para que nadie la persiga como un fallo nuevo:
**`bamburu-backup-heartbeat.timer` dispara hoy a las 09:02 UTC**, con el bloque del manifiesto ya
desplegado (`6dff180`, 06:21) y sin que el manifiesto haya podido correr todavía. Va a salir un ⚠️ que
dice *«el manifiesto de huellas nunca ha registrado un estado»* (`heartbeat:102-105`). **Es cierto, no
es un fallo, y se cura solo con la copia de esta madrugada.**

---

## 2 · Cómo lo resuelven los que ya lo resolvieron

La pregunta concreta de este replanteamiento no es «cómo se verifica un histórico» (eso lo resolvió el
intento 1 y sigue en pie), sino **cómo se distingue «cambió dónde guardo» de «alguien tocó lo
guardado»**.

### SAP — **es el mismo problema, y su respuesta es exactamente el enfoque nuevo**

SAP HANA no verifica «lo que hay en el destino de hoy»: verifica **entradas de un catálogo de copias**.
Cada entrada del *backup catalog* guarda, además del identificador, **dónde está esa copia** (tipo de
destino —FILE o BACKINT— y ruta/identificador externo), y las herramientas de comprobación
(`hdbbackupcheck`, `BACKUP CHECK`) validan **una copia concreta en la ubicación que dice su entrada**.
Cuando el destino de las copias nuevas cambia, las entradas viejas **siguen apuntando a donde están**, y
el sistema distingue *«no encontrada en la ubicación registrada»* de *«encontrada y corrupta»*: son dos
estados distintos, con dos mensajes distintos, y la retención razona por entrada, no por carpeta.

**Lo que se trae, literal:** la unidad de verificación es **la entrada del catálogo con su ubicación**,
no la carpeta actual. Es lo que aquí hace `destino.base` + `destino.ruta`, que ya está escrito en cada
línea del manifiesto y que hoy no se usa para verificar.

### Salesforce — **aplica a medias, y la mitad que aplica es la que faltaba**

Salesforce **no tiene este problema tal cual**: no le cambias el bucket por debajo, porque el
almacenamiento no es tuyo. Esa mitad **no aplica** y decirlo es información: cualquier «cópialo de
Salesforce» que hable de destinos de copia aquí sería inventado.

La mitad que sí aplica es su separación entre **rastro de configuración** y **rastro de datos**: el
*Setup Audit Trail* registra los cambios de configuración de la organización como eventos de primera
clase, con su propio vocabulario, separados del historial de campos de un registro. Cuando algo se ve
raro en los datos, la explicación *«es que alguien cambió la configuración el martes»* está **escrita en
otro sitio y con otras palabras**, no mezclada con las anomalías.

**Lo que se trae:** un cambio de destino tiene que salir por su propia boca, con su propio recuento y su
propia frase — nunca compartiendo desagüe con la manipulación. Es exactamente lo que pide el rechazo, y
es lo que hace la tabla de §3.

### Odoo — **aplica como contraejemplo, y su valor está en el precio del silencio**

El camino habitual de Odoo (el módulo comunitario `auto_backup` y equivalentes) vuelca la base a un
destino externo y **borra por antigüedad**, sin volver a mirar jamás un volcado anterior. Si cambias el
destino, los volcados viejos simplemente **se olvidan**: no hay alarma falsa porque **no hay vigilancia
ninguna**.

Ese contraejemplo mide el precio de las dos salidas fáciles que este replanteamiento descarta: la de hoy
(gritar `¿borrado?` 13 noches seguidas) es **peor que Odoo**, porque una alarma que grita todas las
noches se apaga sola en la cabeza de quien la lee; y la de «no digo nada del histórico rezagado» es
**exactamente Odoo**, y deja sin vigilar justo lo que esta tarea existe para vigilar.

---

## 3 · La decisión

### Qué se hace

Se sustituye el predicado de «mundo» por una **tabla de decisión exhaustiva** que se resuelve con dos
lecturas del destino, no con una clasificación de la configuración. Para cada nombre con registro previo:

- `hoy` = el objeto **en el destino de esta noche**, encontrado **solo** con lo que el destino de hoy
  devuelve (nunca reutilizando una ruta registrada).
- `suyo` = el objeto **en el sitio que dice su propio registro**: `mapaDe(reg.destino.base).get(reg.destino.ruta)`.

| # | Situación | Qué se hace | ¿Alarma? | ¿Línea nueva en el manifiesto? |
|---|---|---|---|---|
| 1 | `hoy` existe **y en la misma casilla** que el registro (`base` y `ruta` iguales) | Comparar `hoy.sha256` con `reg.destino.sha256` | **Sí si difieren**: *«la huella cambió respecto a lo registrado — ¿manipulado?»* | No |
| 2 | `hoy` existe **en otra casilla** (cambió el destino, se migró el histórico, o rotó la clave y se re-subió) | **Re-anclar** al destino de hoy. Si el registro trae huella de **contenido** y hoy también es contenido (destino en claro), **se exige que cuadre** | Solo si esa continuidad de contenido no cuadra | **Sí**, `origen: "reanclado"` |
| 3 | `hoy` no existe, pero **`suyo` sí**: el objeto sigue donde su registro dice | Comparar `suyo.sha256` con `reg.destino.sha256` | **Sí si difieren** (detección real, en el destino donde vive) | No |
| 4 | Ni `hoy` ni `suyo` | Ausencia: `edad < retención − 1` → alarma; si no, caducado | **Sí**: *«falta … — ¿borrado?»* | No |
| 5 | `suyo` no se puede saber porque **la base del registro no se deja leer** | Ni alarma ni silencio: línea propia y recuento propio | **No** | No |

Las casillas 3 y 5 solo se evalúan mientras el objeto esté **dentro de la ventana de retención**
(misma regla de edad que la 4): pasada esa edad, el registro **se apaga solo** y deja de contarse, igual
que hoy se apaga una ausencia caducada. Así la línea nueva **no se vuelve ruido permanente**: decae a
cero en ≤ `RETENTION_DAYS` noches, o antes si Ibrahin migra el histórico (y entonces esos objetos pasan
a la casilla 2 y quedan re-anclados).

**Lo que esto significa la noche del cifrado sin migrar** (el caso del rechazo): los 284 objetos en
claro caen en la casilla **3**, se comparan **donde están**, salen **verificados**, `exit 0`, **la
retención se ejecuta**, el correo es ✅ y lleva una línea que dice:

> `N objetos del histórico siguen en el destino anterior (EN CLARO, gdrive:Bamburu-backup/daily), verificados allí — para retirarlos: bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico`

Y si alguien **altera** uno de esos objetos rezagados, **salta la alarma con su nombre** (casilla 3 con
huellas distintas). La vigilancia no se pierde al cambiar de destino: se sigue al objeto.

### En qué capa vive

**Capa de operación** (`scripts/`), fuera del producto. No se toca `modules/`, ni `core/`, ni ninguna
ruta Hono, ni ninguna tabla SQLite, ni ninguna migración. El único consumidor sigue siendo
`scripts/bamburu-backup.sh` (más el heartbeat, que solo lee el estado).

### Qué patrón del propio código sigue

1. **`modules/superadmin/integridad.js`** — `verifyTenantInvoices()` (`:16`) verifica sin tocar y usa
   **exactamente** el mismo `calcHash` que la emisión (`:8`). Aquí ya se aplica con `canonizar()`
   (`manifiesto-copias.mjs:52`), y este cambio **no la toca**: una sola forma de calcular al escribir y
   al comprobar, ahora también entre versiones del código.
2. **`scripts/bamburu-backup.sh` §«dos mundos, y el fichero de estado manda»** (`:57-85`) — la pieza no
   decide en qué mundo está: se lo dice un estado externo. La versión de esto en el manifiesto es más
   fuerte todavía: **cada línea lleva su propio estado escrito**, así que la pasada no tiene que
   deducirlo.
3. **`scripts/cifrar-copias-de-seguridad.sh:273-277`** — escritura atómica `tmp` + `rename` + `600`, ya
   copiada en `escribirAtomico()` (`:139`). No cambia.
4. **Sin rama blanda** (la lección del MD5/`cryptcheck`): «no puedo comprobarlo» **nunca** es «está
   bien». La casilla 5 respeta esto: no dice que esté bien, dice **«queda sin vigilar»**, con su
   recuento, en el correo y en el estado que lee el heartbeat.

### Alternativas descartadas

- **Añadir un campo `destino.id`** (huella del destino: `base` + subruta + una sonda de la clave
  obtenida con `rclone backend encode` de un nombre fijo). Es más elegante de leer, y **está
  descartado**: `destino.id` tendría que entrar en `canonizar()`, y entonces **cada línea escrita antes
  del despliegue deja de cuadrar con su propio hash** → la pasada siguiente diría *«el manifiesto fue
  editado»*, saltaría 🚨 y no añadiría nada. Esta madrugada nace el primer manifiesto de producción
  (§1.12): el formato de línea **ya no es libre**. Además, la sonda es innecesaria: la casilla 3 detecta
  la clave rotada sin campo nuevo, porque el objeto sigue bajo su ruta antigua en la misma base.
- **Afinar más el predicado de mundo** (comparar `base` también en claro, añadir la sonda de clave).
  Cierra los dos agujeros conocidos y **es el error de los intentos 2 y 3**: sigue adivinando desde la
  configuración de hoy lo que el registro ya tiene escrito, y el siguiente caso no previsto vuelve a
  caer por el mismo desagüe.
- **No vigilar el destino anterior y limitarse a decir «se quedaron atrás»** (lo mínimo que pedía el
  rechazo). Quita el grito, pero deja **284 copias sin vigilar** — que es literalmente el enunciado de
  esta tarea. Es la solución Odoo (§2).
- **Alarmar por el histórico rezagado.** Sería un 🚨 cada noche por hacer exactamente lo que el guion de
  cifrado ofrece hacer, y pararía la retención 13 noches. *Una alarma que grita todos los días es una
  alarma apagada.*
- **Que la retención borre también el destino anterior.** Destruye datos por iniciativa propia y sin
  que nadie lo pida: prohibido por `CLAUDE.md` (§«nunca destruir datos»). Retirarlos es una orden
  explícita de Ibrahin (`--migrar-historico --hazlo`), que ya existe y ya verifica antes de borrar.
- **Re-anclar sin comparar en la casilla 2, siempre.** Descartado: cuando el destino de hoy es en claro
  y el registro trae huella de contenido, esa comparación **sí** es válida y es la única que sobrevive a
  un cambio de destino. Se mantiene (hoy está en `:509`) y por fin se prueba (§4.4).

---

## 4 · El plan, paso a paso

### 4.1 · `scripts/lib/manifiesto-copias.mjs` — MODIFICAR (el grueso)

**No se toca `canonizar()` (`:52-72`). Ni una clave, ni el orden.** Es un requisito, no una preferencia
(§5, riesgo 1).

1. **Borrar `mismoMundoQueRegistro()` (`:379-384`) entera.** Y con ella, el concepto.

2. **`normBase(s)`** — nueva utilidad de una línea: `String(s).replace(/\/+$/, '')`. Toda comparación de
   bases pasa por ella (un `/` final no es otro destino).

3. **`baseHoy`** — se calcula una vez, tras leer el destino: `normBase(remote)` en claro,
   `normBase(infoCifrado.base)` en cifrado.

4. **`mapaHoyPorNombre`: `nombre → { ruta, bytes, sha256 }`** — la única fuente de «dónde está el objeto
   esta noche». Sustituye a `destinoDe()` (`:410-417`), que se borra.
   - **Claro:** de `leerDestinoClaro(remote)` (`:179`, sin cambios), con `ruta = nombre`.
   - **Cifrado:** se codifican **TODOS** los nombres que devuelve `lsf` (`infoCifrado.nombresEnClaro`),
     no solo los «nuevos». Es una sola llamada a `rclone backend encode` igual que hoy, con más
     argumentos (≈284 nombres ≈ 20 KB de línea de órdenes, muy por debajo de `ARG_MAX`). Luego
     `mapaBase.get(rutaCodificada)` da bytes y huella.
   - **Se elimina el filtro `nuevos` de `:396`**: reutilizar la ruta registrada para encontrar el objeto
     de hoy es la causa directa de §1.3.

5. **`codificarRutas` (`:259-275`)**: arreglar el `subpath` vacío (§1.9) →
   `const rutasPedidas = nombres.map((n) => (subpath ? `${subpath}/${n}` : n));`

6. **`mapaDeBase(base)`** — nueva, con memoria (`Map` de base → resultado), que devuelve
   `{ mapa, error }`:
   - si `normBase(base) === baseHoy`, devuelve el mapa ya leído (en claro, el de `leerDestinoClaro`
     con clave = nombre, que coincide con `ruta`; en cifrado, `mapaBase`) — **sin llamar a rclone otra
     vez**;
   - si no, `leerMapaBase(base)` (`:234`, **se reutiliza tal cual**, ya usa `-R --hash sha256`) dentro
     de `try/catch`: si falla, se guarda `{ mapa: null, error: e.message }` y **no se lanza**.
   - Asimetría deliberada y hay que escribirla en un comentario: **el destino de hoy es una
     precondición** (si no se puede leer donde acabas de subir, es fallo, y eso sigue igual en `:399-408`);
     **un destino ANTERIOR que ya no contesta es un final esperado** (lo retiró el dueño) y no puede
     convertirse en un 🚨 cada noche. No se dice que esté bien: se dice que queda sin vigilar.

7. **Reescribir el bucle de verificación del histórico (`:487-541`)** con la tabla de §3, en este orden
   exacto (el orden ES el arreglo):

```js
const edadDias = Math.floor((hoyMs - epochDeFecha(extraerFecha(nombre) || registro.fecha)) / 86400000);
const dentroDeVentana = edadDias < retencionDias - 1;
const hoy = mapaHoyPorNombre.get(nombre) || null;
const mismaCasilla = hoy
  && normBase(registro.destino.base) === baseHoy
  && registro.destino.ruta === hoy.ruta;

if (mismaCasilla) {                       // casilla 1
  comprobados += 1;
  if (hoy.sha256 !== registro.destino.sha256) alarmas.push(`"${nombre}": la huella cambió respecto a lo registrado — ¿manipulado?`);
} else if (hoy) {                         // casilla 2 — re-anclar
  // continuidad de contenido: sigue tal y como está hoy en :509
} else {
  const { mapa, error } = mapaDeBase(registro.destino.base);
  const suyo = mapa ? mapa.get(registro.destino.ruta) : null;
  if (suyo) {                             // casilla 3
    comprobados += 1; rezagados += 1;
    if (suyo.sha256 !== registro.destino.sha256) alarmas.push(`"${nombre}": la huella cambió respecto a lo registrado — ¿manipulado?`);
  } else if (error) {                     // casilla 5
    if (dentroDeVentana) { sinVigilar += 1; /* agrupar por base y motivo */ }
  } else if (dentroDeVentana) {           // casilla 4
    alarmas.push(`falta "${nombre}" en el destino (edad ${edadDias}d, retención ${retencionDias}d) — ¿borrado?`);
  }
}
```

   - **Casilla 2 (re-anclaje):** se conserva el cuerpo de `:516-536` con **dos cambios**:
     (a) `sha256: modo === 'cifrado' ? (registro.sha256 ?? null) : actual.sha256` — arrastra la huella
     de contenido en vez de tirarla (§1.6); (b) el motivo se construye con una función
     `descripcionDeCasilla(registro)` que distingue **destino distinto** (*«de EN CLARO a CIFRADO»*,
     *«de CIFRADO a EN CLARO»*, *«de `<base vieja>` a `<base nueva>`»*) de **misma base y otra ruta**
     (*«de la llave anterior a la actual»*). Hoy `:516` solo sabe decir claro/cifrado y mentiría en la
     rotación de clave.
   - **Invariante que hay que dejar escrito en la cabecera del fichero** (hoy es cierto y no está
     dicho): **`sha256` de nivel superior = huella del CONTENIDO en claro, o `null` si no se conoce;
     `destino.sha256` = huella de lo que el destino guarda.** Todo lo demás se apoya en eso.

8. **Contadores honestos (§1.4).** `comprobados` **solo** en las casillas 1 y 3. Nuevos:
   `reanclados` (2), `rezagados` (3), `sinVigilar` (5). `observadosNuevos` sigue igual.

9. **Un solo `escribirEstadoPasada()`** que construye siempre la misma forma —
   `{ ts, etiqueta, modo, cabeza, registros, comprobados, observados_nuevos, reanclados, rezagados, sin_vigilar, alarmas }`
   con ceros por defecto— y que usan **las cuatro** salidas (`:338`, `:353`, `:401`, `:544`). Arregla
   §1.5.

10. **`imprimirResumen()` (`:304-314`)** añade, tras la línea de re-anclajes:
    - por cada base rezagada: `` `${n} objetos del histórico siguen en el destino anterior (${desc}), verificados allí — para retirarlos: bash scripts/cifrar-copias-de-seguridad.sh --migrar-historico` `` y debajo `  · nombre1, nombre2, … (y N más)` con **un máximo de 5 nombres**;
    - por cada base ilegible: `` `${n} objetos registrados en ${base} no se han podido comprobar allí (${motivo}): quedan SIN VIGILAR` ``, con la misma lista acotada.
    - Las `ALARMA:` siguen yendo **al final**, siempre (lo necesita §4.2).

11. **`cmdEstado` (`:563-580`)** imprime también `reanclados`, `rezagados` y `sin_vigilar`.

12. **Comentarios `:373-378` y `:500-503`**: reescribirlos contando lo que la pieza hace ahora. La
    mención a *«o rotó la clave»* **se queda**, porque ahora es cierta, y se explica por qué (el objeto
    sigue bajo su ruta antigua en la misma base, y ahí se le busca).

### 4.2 · `scripts/bamburu-backup.sh` — MODIFICAR (poco, y para siempre)

13. Sustituir los tres `grep` de `:291-299` por **una sola regla de rango**:

```bash
MANIF_BLOQUE="$(printf '%s\n' "$MANIF_SALIDA" | awk '/^Manifiesto: /{f=1} /^ALARMA: /{f=0} f')"
```

    Todo lo que el ayudante diga entre el titular y la primera alarma llega al correo **sin que bash
    tenga que conocer su texto**. Se borran `MANIF_LINEA`, `MANIF_OBS_LINEA` y `MANIF_REANCLADOS`. El
    correo 🚨 no cambia: ya lleva `$MANIF_SALIDA` entero (`:314`).
14. Actualizar el comentario de `:295-297` (habla de una línea concreta) y la cabecera `:33-48` para
    nombrar la vigilancia del destino anterior.
15. **No se toca nada más**: ni el orden manifiesto→retención, ni `date +%s > "$LAST_OK"` antes del
    `exit 1` (`:306`), ni `fail_exit` (no hay ninguno en este bloque, y no se añade).

### 4.3 · `scripts/bamburu-backup-heartbeat.sh` — MODIFICAR

16. Reordenar `:99-117`: primero `salida_estado="$("$NODE" "$MANIFHELPER" estado …)"` y su código de
    salida; después la edad, **leída del `ts` que imprime esa salida**:
    `ts_estado="$(printf '%s\n' "$salida_estado" | sed -n 's/.*ts=\([0-9]\+\).*/\1/p' | head -1)"`.
    Si `ts_estado` viene vacío → aviso propio (*«no se ha podido leer la fecha del estado»*). Se elimina
    el `stat -c%Y` de `:107`. Arregla §1.8.

### 4.4 · `scripts/test-manifiesto-copias.mjs` — MODIFICAR

17. **`escenario5()` — caso (i): el destino cambia de mundo y el histórico SE QUEDA ATRÁS.** Es el caso
    que tumbó al intento 3 y el que garantiza que no vuelve. Monta el destino en claro sobre **un remote
    propio** (`lviejo`, creado con `rclone config create`, para poder retirarlo después), y:
    - **(i-1)** noche 1 en claro con un `historico-<hace 5 días>.db` sembrado → verde.
    - **(i-2)** se crea el `crypt` sobre una raíz nueva y se escribe `backup-destinos.conf`, **sin copiar
      nada** (es literalmente lo que hace `cifrar-copias-de-seguridad.sh` y luego irse a dormir). La
      pasada de esa noche: `status === 0`; la salida **no contiene `¿borrado?`**; contiene
      `objetos del histórico siguen en el destino anterior` con recuento ≥ 1 y **nombra** el fichero.
    - **(i-3)** se siembra un objeto de 20 días en el destino **nuevo** y se corre otra vez: **la
      retención se ejecuta** (ese objeto desaparece del destino).
    - **(i-4)** se **altera** el objeto que se quedó en el destino anterior (subiendo otro contenido al
      mismo nombre en `lviejo`) → la pasada siguiente sale **1** y la alarma **nombra ese fichero**.
    - **(i-5)** se retira el remote viejo (`rclone config delete lviejo`) → la pasada siguiente sale
      **0**, la salida dice `quedan SIN VIGILAR` y **no dice `¿borrado?`**.
    - **(i-6) el correo:** en la pasada (i-2), con un `curl` falso al principio del `PATH` del
      laboratorio (escribe su `--data` a un fichero) y `RESEND_API_KEY` definida, el cuerpo del correo
      ✅ **contiene la línea de los rezagados**. Es la comprobación de que el paso 13 funciona sin que
      bash conozca la frase. (`BACKUP_HC_URL=''` ya evita el ping, `montarLab:89`.)
18. **`escenario6()` — caso (j): rotación de la clave del `crypt`.** Lab cifrado, noche 1 verde con un
    histórico viejo sembrado; se reescribe el `crypt` con otra `password` sobre **la misma raíz**; la
    noche 2: `status === 0`, **sin `¿borrado?`**, el artefacto de hoy queda registrado con su ruta
    **nueva**, y el histórico viejo sale como comprobado donde está. Es lo que hoy declara `¿borrado?`
    sobre un fichero subido cinco segundos antes (§1.3).
19. **`escenario4()` se queda tal cual** (cubre migrar de verdad) y se le añade **la excepción de
    continuidad de contenido, que hoy no ejerce nadie** (observación 4 del revisor): en la vuelta
    cifrado → claro, dejar un registro `origen:"subido"` de la etapa cifrada que **no** se re-suba esa
    noche (borrando la BD de ese negocio antes de la vuelta) y exigir **verde** con el contenido intacto
    y **rojo con su nombre** si se altera.
20. Registrar `escenario5` y `escenario6` en el arranque (`:403-411`), con el mismo `try/catch` que
    `escenario4`, y **la limpieza sigue en el `finally` que ya existe** (`:412-414`).

### 4.5 · `scripts/lib/gates-mapa.mjs` — MODIFICAR

21. Añadir `'test-manifiesto-copias'` al grupo **`infra`** (`:279`). No va al `RÁPIDO`: tarda 31 s y
    monta laboratorios. Arregla §1.11.

### 4.6 · Documentación

22. **`deploy/systemd/README.md:156-163`** — reescribir el párrafo para que diga **los dos caminos**. La
    frase actual **se tacha con su motivo y su fecha, no se borra** (regla del repo). Tiene que decir:
    qué pasa si el histórico viaja (re-anclaje), qué pasa si se queda (se sigue comprobando **donde
    está**, sin alarma, con su línea y su orden para retirarlo), que esa línea **se apaga sola** al
    salir de la ventana de retención, qué pasa si el destino anterior ya no se deja leer (**sin
    vigilar**, dicho en el correo) y **qué NO cubre**: si alguien borra un objeto del destino anterior
    *la misma noche* del cambio y además retira el remote, eso sale como «sin vigilar», no como
    «borrado».
23. **`docs/seguridad/vectores-de-ataque.md`** — §7: la vigilancia del histórico cubre también el
    destino anterior mientras esté en la ventana de retención. **No se toca el §Resumen `:16`** para
    decir que el vector 4 está protegido: las copias siguen yendo **en claro** hasta que Ibrahin ejecute
    el guion de cifrado.
24. **`TABLERO.md`** — actualizar la ficha `manifiesto-huellas-backups` (~`:8761-8772`) con lo que se
    construye aquí y con el número real de aserciones del test; y en §Deuda técnica, la línea `:9410`.
    Las cifras viejas **se tachan**, no se borran.

---

## 5 · Riesgos

1. **La cadena de producción nace esta madrugada (03:31), con el código de `6dff180`. Si esto cambia el
   formato de línea, mañana el manifiesto dirá «fue editado» y saltará 🚨 sobre un servidor sano.**
   *Mitigación:* `canonizar()` **no se toca** — el plan entero está diseñado para no necesitar ningún
   campo nuevo (por eso se descartó `destino.id`). Criterio de aceptación 4: `git diff 6dff180 --
   scripts/lib/manifiesto-copias.mjs` no muestra **ningún** cambio dentro de esa función.
2. **La copia de esta noche corre con lo que haya en el árbol** (`ExecStart=/home/ubuntu/bamburu/scripts/bamburu-backup.sh`,
   verificado con `systemctl cat`): editar el repo **ya despliega**. Un estado a medias a las 03:31 es
   una copia rota. *Mitigación:* no se commitea el ayudante sin su bash y sin su test; el test ejecuta
   `bamburu-backup.sh` **entero** en los dos mundos, así que un `.sh` roto no llega a verde.
3. **La primera pasada real registrará ~284 objetos como `observado` de golpe**, incluido residuo
   `__gate_*` de gates viejos. Es lo correcto (TOFU: la primera noche todo es nuevo) y no alarma, pero
   el correo de mañana traerá una línea con ese número. *Mitigación:* ninguna en código; queda escrito
   aquí y en el README para que nadie lo lea como un incidente. (Limpiar el residuo de gates de Drive
   es otra tarea: `scripts/limpiar-restos-de-gates.mjs` no toca Drive.)
4. **Codificar 284 nombres en cada pasada cifrada** en vez de solo los nuevos. *Mitigación:* sigue
   siendo **una sola** llamada a `rclone backend encode`, local y sin red; el propio helper ya valida
   que devuelve tantas líneas como nombres pidió (`:269-271`). Si algún día el número de objetos creciera
   hasta rozar `ARG_MAX`, se parte en lotes; con 14 días de retención no ocurre.
5. **Una llamada más a `rclone` por cada destino anterior distinto** que aparezca en la ventana. En la
   práctica es **cero** (destino estable) o **una** (la noche del cifrado y las ~13 siguientes).
   *Mitigación:* memoria por base dentro de la pasada, y el destino de hoy **no** se relee.
6. **La casilla 5 no alarma.** Si el destino anterior deja de contestar, sus objetos quedan sin vigilar
   sin que salte nada. *Mitigación:* nunca es silencio — línea propia, recuento propio, en el correo y
   en el estado que lee el heartbeat; y decae sola en ≤ `RETENTION_DAYS`. Es la única forma de no gritar
   por hacer justo lo que el guion de cifrado ofrece.
7. **Ventana de encubrimiento real, y hay que decirla:** un borrado hecho **la misma noche** en que el
   destino cambia y además desaparece el remote anterior sale como «sin vigilar», no como «borrado».
   *Mitigación:* documentarlo en el README (paso 22); el registro anterior sigue en la cadena, y
   `--migrar-historico` verifica con `cryptcheck --one-way` **antes** de borrar nada
   (`cifrar-copias-de-seguridad.sh:108-115`), que es el ancla de esa transición.
8. **El histórico rezagado deja de nombrarse al salir de la ventana**, aunque los ficheros en claro
   sigan en Drive. *Mitigación:* es deliberado (si no, ruido permanente) y está dicho en el README; la
   retirada del histórico en claro ya la reclama `cifrar-copias-de-seguridad.sh:314-323` y es parte de
   la tarea de cifrado, no de esta.
9. **La cadena de VERI\*FACTU:** no se toca. Ni `modules/`, ni `calcHash`, ni ninguna tabla. Las bases se
   leen en `readonly` vía `db-snapshot.mjs`, sin cambios.
10. **Pantallas y datos de tenant:** ninguna ruta nueva, ninguna migración, ninguna ventanita. El censo
    y los gates de pantalla no cambian.
11. **El test crea objetos y remotes**: todo vive bajo `mkdtemp` y `RCLONE_CONFIG` apuntando a `/tmp`
    (`test-manifiesto-copias.mjs:86`), y **jamás toca `gdrive:`**. El `finally` de `:412-414` borra los
    laboratorios pase lo que pase; los remotes nuevos (`lviejo`) viven en ese `RCLONE_CONFIG` desechable
    y se van con él.
12. **Concurrencia:** las dos copias (03:31 y 03:35) escriben ficheros distintos por `$SUFFIX`
    (`bamburu-backup.sh:92-93`) y no comparten estado. Sin cambios.
13. **El ⚠️ del heartbeat de hoy a las 09:02** (§1.12) llegará antes de que esto se construya. No es un
    fallo y no hay que perseguirlo: se cura con la copia de esta madrugada.

---

## 6 · Criterios de aceptación

> El encargo dice expresamente que **el tablero no trae criterios de Ibrahin** para esta tarea, así que
> estos ocho son míos. Los ocho del intento anterior **siguen vigentes**: el criterio 1 los mantiene
> atados, porque miden lo mismo que el test que exige.

- [ ] `node scripts/test-manifiesto-copias.mjs` sale con código **0**, ejecutando el
      `scripts/bamburu-backup.sh` **real** contra remotes locales (nunca `gdrive:`), y su recuento de
      aserciones **no baja de las 87** que midió el revisor hoy.
- [ ] **Caso (i), cifrado sin migrar:** tras escribir el fichero de destinos y **no copiar nada**, la
      pasada de esa noche y la siguiente salen con código **0**, su salida **no contiene la cadena
      `¿borrado?`**, contiene `objetos del histórico siguen en el destino anterior` con su recuento y
      **nombra** al menos un fichero, y **la retención SÍ se ejecuta** (un objeto de más de
      `RETENTION_DAYS` días sembrado en el destino nuevo desaparece de él).
- [ ] **La vigilancia no se pierde al cambiar de destino:** en ese mismo caso (i), alterar el contenido
      de un objeto que se quedó en el destino anterior hace que la pasada siguiente salga con código
      **1** y que la alarma **nombre ese fichero**.
- [ ] **El formato de línea no cambia:** `git diff 6dff180 -- scripts/lib/manifiesto-copias.mjs` no
      muestra ningún cambio dentro de la función `canonizar()`, y
      `node scripts/lib/manifiesto-copias.mjs verificar-cadena --manifiesto <manifiesto escrito antes del cambio>`
      sale con **0**.
- [ ] **Clave rotada (caso j):** con el `crypt` reescrito con otra contraseña sobre la misma raíz, la
      pasada siguiente sale con código **0**, no dice `¿borrado?` de ningún fichero, y el artefacto
      subido esa noche queda registrado con su ruta cifrada **nueva**.
- [ ] **Contadores honestos:** `manifiesto$SUFFIX.estado.json` tiene **siempre** las mismas claves
      —incluidas `reanclados`, `rezagados` y `sin_vigilar`— en las cuatro salidas de `pasada`;
      `node scripts/lib/manifiesto-copias.mjs estado --estado <ruta>` las imprime todas; y `comprobados`
      cuenta **solo** objetos cuya huella se comparó de verdad (un re-anclado o un ausente no suman).
- [ ] **El correo no depende de que bash conozca las frases:** `scripts/bamburu-backup.sh` construye
      `$MANIF_BLOQUE` con **una sola** regla de rango (de `Manifiesto: ` a la primera `ALARMA:`) y **no
      contiene ningún `grep` del texto de una línea concreta del ayudante**; y con el `curl` interceptado
      en el laboratorio, el cuerpo del correo ✅ del caso (i) **incluye la línea de los rezagados**.
- [ ] **Entra en el barrido y el heartbeat mide bien:** `test-manifiesto-copias` está en
      `scripts/lib/gates-mapa.mjs` y `node scripts/run-gates.mjs test-manifiesto-copias` lo ejecuta y
      sale con **0**; y `scripts/bamburu-backup-heartbeat.sh` calcula la edad del estado con el campo
      `ts` de su contenido (ya no hay `stat -c%Y` sobre `manifiesto*.estado.json`), avisando si pasa de
      48 h.
