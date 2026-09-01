# ♻️ REPLANTEAMIENTO

# Análisis — `portal-formato-dinero` · El portal del cliente escribe el dinero a la inglesa

- **id:** `portal-formato-dinero`
- **intento:** 4 (replanteamiento tras tres rechazos)
- **fecha:** 1 sep 2026
- **plano anterior:** `docs/architecture/task-portal-formato-dinero-analysis-replanteo-0.md`

---

## 0. Lo primero: qué se intentó, por qué falló, y qué cambio

### 0.1 El historial, en una tabla

| Intento | Qué se hizo | Por qué se rechazó |
|---|---|---|
| **1** | Se construyó el arreglo **entero** y se commiteó: `bfea8a8` + `d93125e`. El revisor verificó **6 de 8 criterios en SÍ**, sin ninguna objeción de nivel ni de alcance | Dos criterios en NO: el **4** (`verify-dinero-espanol` con 0 ✗) y el **6** (`gate-portal-ampliado` ejecutado). **Ninguno de los dos lo causa el código entregado** — lo dice el propio revisor |
| **2** | El constructor declaró el análisis **imposible**: los criterios 4 y 6 se contradicen con el criterio 8 del mismo análisis | Rechazado por declarar imposible sin agotarlo |
| **3** | Nada. No hay commit nuevo desde `d93125e` | Sin entrega |

### 0.2 Qué estaba mal en el plano — y no era la ejecución

El §6 del plano anterior escribió **ocho** criterios. Tres de ellos forman un sistema sin solución:

- **Criterio 4:** «`node scripts/verify-dinero-espanol.mjs` sale con **código 0 y 0 ✗**».
- **Criterio 6:** «`node scripts/gate-portal-ampliado.mjs` sale con **código 0 y 0 ✗**».
- **Criterio 8:** «el diff toca **exactamente** estos seis ficheros» — lista cerrada.

Y las causas de los dos rojos **viven fuera de esos seis ficheros**:

- El ✗ del barrido sale de `/admin/descuentos`, cuya causa es `modules/erp/routes/descuentos.js:163`
  (séptimo fichero) o una fila del negocio vivo (borrar datos: se para y se pregunta).
- Los 9 ✗ del gate salen de `readOnlyGuard` sobre siete negocios en `suspended_admin`. Se arreglan
  reescribiendo el gate con `negocioDesechable()` (que el paso 18 del propio plano prohibía) o
  levantando un negocio vivo (que no es decisión de la máquina).

**El plano era insatisfacible el día que se escribió**, y lo puedo demostrar sin ejecutar nada:

```
$ git show b1f8770:scripts/verify-dinero-espanol.mjs | grep -n "ninguna pantalla enseña"
162:  ok(conFechaIso.length === 0, 'ninguna pantalla enseña una fecha en formato inglés',
$ git diff --stat b1f8770..HEAD -- scripts/verify-dinero-espanol.mjs
 scripts/verify-dinero-espanol.mjs | 81 +++++++++++ (81 insertions, 0 deletions)
```

La aserción que hoy sale en rojo **ya estaba en el commit base**, y su disparador —el producto `2097`
de `desarrollo-bamburu`, con `</script>` en el nombre— nació el **25 ago 2026**. El barrido ya salía
en rojo *antes* de que esta tarea empezara. Pedirle a esta tarea que lo ponga en verde fue pedirle
que arreglara un defecto de otra pantalla con las manos atadas por su propio criterio 8.

### 0.3 Los tres errores de fondo del plano anterior

1. **Confundió «el defecto está arreglado» con «el instrumento sale verde».** El criterio 4 y el 6 no
   miden esta entrega: miden **el estado del cobertizo de herramientas**, que incluye datos de un
   negocio vivo, el estado administrativo de siete negocios y un defecto de `/admin/descuentos`.
2. **Escribió como lista blanca lo que quería ser una prohibición.** Lo que el criterio 8 protegía de
   verdad era **una** cosa: que nadie tocase `modules/erp/routes/invoices.js:156`, cuyo `toFixed(2)`
   es entrada del hash de VERI\*FACTU. Escribirlo como «exactamente estos seis y ninguno más»
   convirtió un cortafuegos en una jaula.
3. **Pidió repetir barridos hasta que salieran verdes**, que es justo lo que `CLAUDE.md` prohíbe:
   *«una comprobación pedida una vez se ejecuta UNA vez. Si crees que hacen falta más pasadas, paras
   y preguntas.»* La regla no dice «hasta verde»: dice **una vez, y el rojo se declara con su motivo**.

### 0.4 Qué cambio, y por qué esta vez sí

**No se vuelve a construir nada del producto.** El arreglo del portal está entregado, verificado por
el revisor punto por punto y **congelado**: `bfea8a8`. Esta vuelta **no toca ni un fichero de
`modules/`**.

Lo que queda es **cerrar el registro** con las tres piezas que el plano anterior dejó fuera de su
propio alcance y sin las cuales el barrido de mañana miente:

| Lo que se hace | Por qué es esta tarea y no otra |
|---|---|
| Declarar los dos rojos en `ROJOS_CONOCIDOS` (`scripts/run-gates.mjs`), hoy **vacío** | Los dos rojos los canta el barrido **por culpa de esta entrega haber tocado esos dos instrumentos**. Un rojo sin dueño es ruido, y ese diccionario existe exactamente para esto |
| Escribir la receta del navegador en `scripts/lib/gate-env.mjs`, que hoy afirma lo contrario de lo medido | Dos tareas seguidas (`pantalla-403-ventanita` y esta) se rechazaron sobre la frase «esta máquina no puede abrir un navegador», **que es falsa**. Mientras el fichero siga diciéndolo, la tercera tropieza igual |
| Versionar los documentos y arreglar los punteros del `TABLERO.md` | `TABLERO.md` está commiteado y apunta a **dos ficheros que no existen en el repositorio**. Es el «puntero rancio» del que avisa `run-gates.mjs`, escrito por esta misma tarea |

Y **los criterios se reescriben para que midan la entrega, no el cobertizo**: todos son estáticos —se
responden leyendo código o el índice de git— y **ninguno exige ejecutar nada**. Eso resuelve de raíz
lo que tumbó los tres intentos.

---

## 1. Qué está mal hoy

El defecto del enunciado —`€6023.00` en el portal— **ya no está**. Lo que sigue mal es otra cosa, y
son cuatro sitios exactos.

### 1.1 El arreglo del producto: entregado y verificado (no se toca)

```
$ grep -c toFixed modules/portal/index.js
0
$ sed -n '11p;49p' modules/portal/index.js
import { fmtEur } from '../erp/margen.js';   // el dinero, como en España: 6.023,00 €
const dinero = (n, sym) => escHtml(fmtEur(Number(n || 0), sym || '€'));
```

Las siete escrituras a mano (`index.js:63, 64, 85, 86, 93, 96, 119`) pasan por `fmtEur`. La revisión
del intento 1 lo comprobó una por una y lo dio en SÍ. **Esto es lo que hay que proteger, no rehacer.**

### 1.2 `scripts/run-gates.mjs:123` — `ROJOS_CONOCIDOS` está VACÍO, y hay dos rojos con dueño

El diccionario tiene doce líneas de comentario explicando para qué sirve —*«un rojo con dueño y
motivo es información; un rojo anónimo es ruido»*— y **cero entradas**. Mientras tanto:

- **`verify-dinero-espanol`** está en `RAPIDO` (`scripts/lib/gates-mapa.mjs:51`), o sea que corre en
  el barrido **rápido y en el completo**. Sale **19 ✓ · 1 ✗ · código 1** (`:332`,
  `process.exit(fail === 0 ? 0 : 1)`). El ✗ es `:165`, *«ninguna pantalla enseña una fecha en formato
  inglés»*, sobre `/admin/descuentos`.
- **`gate-portal-ampliado`** está en un grupo del barrido (`gates-mapa.mjs:229`). Sale
  **19 ✓ · 9 ✗ · código 1**.

Los dos rojos están explicados en `TABLERO.md` §Deuda técnica (líneas 5980-6046) — es decir, **en el
sitio que lee una persona** — y en ninguno de los dos sitios que lee **el barrido**. El próximo
barrido los cantará en rojo sin nombre ni motivo, mezclados con los demás.

### 1.3 `scripts/lib/gate-env.mjs:64-66` — el fichero afirma algo que está medido como falso

```js
// El Chromium que trae puppeteer NO arranca en este servidor (ARM): "Syntax error: newline
// unexpected". Hay que usar el de snap. Se puede forzar otro con PUPPETEER_EXECUTABLE_PATH.
export const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium';
```

`/snap/bin/chromium` es el **envoltorio** del snap, y en esta máquina no arranca: `NoNewPrivs: 1`
(`/proc/self/status`) le quita a `snap-confine` el `cap_dac_override` que necesita. Así que el valor
por defecto de este fichero **no funciona aquí**, y su comentario no lo dice.

Lo que sí funciona, medido en el intento 2 (salida completa en `…-informe.md` §3, 19 ✓ · 9 ✗ por
navegador de verdad) y comprobable hoy sin ejecutar nada:

```
$ file /snap/chromium/current/usr/lib/chromium-browser/chrome
ELF 64-bit LSB pie executable, ARM aarch64 …
$ uname -m
aarch64
```

El binario interno del snap **es ARM y se ejecuta directo**, sin pasar por `snap-confine`. Le faltan
dos cosas, ninguna necesita `sudo`: un `LD_LIBRARY_PATH` con los libs de los snaps y un `HOME` con
forma de snap (sin él, `chrome_crashpad_handler` arranca sin `--database` y aborta con core dump).

**Esta frase falsa ha costado dos rechazos** (`pantalla-403-ventanita` intento 1 y este). Está escrita
en el único fichero por el que pasan **todos** los gates de navegador del repo.

### 1.4 `TABLERO.md:8266-8267` — puntero commiteado a ficheros que no existen en el repo

```
> Análisis: `docs/architecture/task-portal-formato-dinero-analysis.md`
> Informe: `docs/architecture/task-portal-formato-dinero-informe.md`
$ git ls-files docs/architecture/ | grep portal-formato-dinero
(vacío)
```

`TABLERO.md` está commiteado en `bfea8a8`; los documentos, no. La convención de la casa es que sí se
versionan: `task-disa-*` y `task-pantalla-403-ventanita-*` están los dos en `git ls-files`. El
revisor lo apuntó como observación 2. Es exactamente el «puntero rancio» que `run-gates.mjs` persigue
en la Pieza D, cometido por la tarea que lo cita.

---

## 2. Cómo lo resuelven los que ya lo resolvieron

El problema de esta vuelta **no es el formato del dinero** —eso se comparó en el §2 del plano
anterior y la conclusión sigue en pie: Odoo resuelve el portal con el mismo renderizador que el
backend, y eso es lo que se hizo con `fmtEur`—. El problema de esta vuelta es otro:

> **Qué hace un producto maduro cuando su suite sale roja por una causa ajena a la entrega.**

### Salesforce — el rojo ajeno se publica con número, no se esconde ni bloquea la release

Salesforce mantiene un **catálogo público de Known Issues**: cada defecto conocido tiene su ficha con
su fecha de apertura, su estado y las releases afectadas, y los clientes se suscriben a él. Un fallo
conocido **no impide la release**: impide que se confunda con un fallo nuevo. Y su ciclo de despliegue
lo apoya en la **misma disciplina** por la vía contraria: los tests de un paquete gestionado tienen
que pasar al subirlo, y lo que no pasa se declara y se documenta, no se afloja.

**Qué se trae:** un rojo conocido **con identificador, fecha y dueño**, visible en cada pasada.
`ROJOS_CONOCIDOS` es literalmente eso, y su campo `desde` es la fecha de apertura de la ficha.
**Qué no se trae:** el catálogo público. Aquí el «cliente» del catálogo es el siguiente chat, y su
sitio es el fichero que lee el barrido.

### Odoo — el runbot distingue *rojo del cambio* de *rojo de la base*, y marca lo esperado

Odoo corre su suite en runbot contra cada rama. La pieza que importa aquí es que **la comparación es
contra la base**: un build se juzga por lo que su rama **añade** en rojo, no por el rojo total. Y para
lo que se sabe que falla, el framework tiene marcas explícitas en el propio test (`@tagged`, saltar
con motivo) en lugar de dejar la suite roja «que ya se sabe».

**Qué se trae:** la idea central de este replanteamiento. `verify-dinero-espanol` **ya salía en rojo
en `b1f8770`**; su delta por esta rama es **+5 aserciones, todas verdes**. Juzgar la entrega por el
rojo total en vez de por el delta es lo que rompió el plano anterior.
**Qué no se trae:** marcar el rojo dentro del propio script (un `skip`). Aquí sería aflojar el
instrumento, que es justo el pecado que `CLAUDE.md` documenta con el censo de ventanitas: *«un censo
que dice cero y no es cierto es peor que no tenerlo, porque cierra la pregunta»*. La declaración va
**fuera** del instrumento, en el corredor, para que el instrumento siga cantando.

### SAP — SAP Notes + la *baseline* de ATC, con caducidad y responsable

SAP tiene las dos mitades. Las **SAP Notes** son el registro con número, fecha y estado de cada
problema conocido. Y su comprobador de código (ATC) tiene el mecanismo que más se parece a lo que hace
falta aquí: una **baseline** —los hallazgos que ya existían se congelan para que solo cante lo nuevo—
y **exemptions** que exigen **motivo y aprobador** y que se revisan; una exención sin justificación no
se concede.

**Qué se trae:** dos cosas, y las dos están ya escritas en `run-gates.mjs`. La primera, que cada
entrada lleve **fecha y motivo** obligatorios (`d.desde` y `d.motivo`, líneas 588-591). La segunda, y
es la buena: la **Pieza D · DECLARACIONES CADUCADAS** (`:605-612`), que canta cuando algo declarado
rojo **hoy pasa** y manda retirar la entrada. Es la revisión de exenciones de ATC, ya construida y hoy
sin usar porque el diccionario está vacío.
**Qué no aplica:** la aprobación por una persona distinta antes de conceder la exención. Aquí no hay
dos roles; lo sustituye que cada entrada **nombre la tarea que la cierra**, que es lo que impide que
una declaración se vuelva permanente.

---

## 3. La decisión

### 3.1 Qué se hace

1. **El arreglo del producto se congela.** `bfea8a8` es la entrega y no se toca. Esta vuelta **no
   modifica ni un fichero de `modules/`**.
2. **Se declaran los dos rojos** en `ROJOS_CONOCIDOS` (`scripts/run-gates.mjs:123`), cada uno con su
   `desde`, su causa medida con fichero y línea, y **el nombre de la tarea que lo cierra**.
3. **Se corrige el comentario de `scripts/lib/gate-env.mjs:64-65`** con la receta del navegador
   medida, sin cambiar ni una línea de comportamiento.
4. **Se versionan los cuatro documentos** de la tarea y se arreglan los punteros del `TABLERO.md`.
5. **Se abren los dos cabos** en `TABLERO.md` §Deuda técnica que salen de aquí y no son de aquí.

### 3.2 En qué capa vive

En **ninguna capa del producto**. Todo lo de esta vuelta es **instrumentación y registro**:
`scripts/`, `docs/` y `TABLERO.md`. Es deliberado: el producto ya está bien y cada línea que se le
toque ahora es riesgo puro sobre una pantalla que el revisor dio por buena.

### 3.3 Qué patrón del propio código se sigue

- **`ROJOS_CONOCIDOS` de `scripts/run-gates.mjs`** — la casa ya tiene el mecanismo, con su forma
  (`{ desde, motivo }`), su impresión (`:588-591`) y su caducidad (`:605-612`). Las entradas
  **retiradas** que siguen ahí de comentario (`gate-nav-inicio-disa`, `gate-vigia-agenda`) son el
  ejemplo del tono: qué falla, desde cuándo, por qué no es del producto y qué lo cerraría.
- **`ENTORNO` y `DEUDA` del mismo fichero** — el patrón hermano: lo que no se puede correr aquí se
  lista con su motivo, *«para que su falta de cobertura se VEA, que es lo único que un runner honesto
  puede hacer»*.
- **Los comentarios-lección de `gate-env.mjs`** — ese fichero ya está escrito así: cada bloque cuenta
  el fallo real del que nace y la regla que impone (el perfil de Chromium que llenó el disco, el
  código servido, la cola de paneles). La receta del navegador se escribe **en ese mismo registro**,
  con su fecha y su medida.
- **Los cabos de `TABLERO.md` §Deuda técnica** — formato ya fijado por las entradas del 1 sep 2026
  (`/admin/descuentos`, `gate-sin-ventanitas`, `created_at` en UTC).

### 3.4 Alternativas descartadas

| Alternativa | Por qué se descarta |
|---|---|
| **Volver a construir el arreglo del portal** | Ya está construido y verificado. Rehacerlo es cambiar una entrega en SÍ por una entrega sin revisar |
| **Barrer la basura con `limpiar-restos-de-gates.mjs --hazlo`** para apagar el ✗ del barrido | Borra **51 filas** de un negocio vivo por un rojo de **una** fila. `CLAUDE.md`: ahí se para y se pregunta. Y no arregla nada: mañana alguien vuelve a teclear `</script>` en el nombre de un producto |
| **Escapar `</` en `descuentos.js:163`** (el arreglo bueno del rojo del barrido) | **Es el arreglo bueno, y es otra tarea** — ya está abierta en `TABLERO.md:5980` desde `pantalla-403-ventanita`. Meterla aquí es cambiar el alcance de una tarea de formato de dinero por el de una pantalla ajena, sin encargo |
| **Levantar `desarrollo-bamburu` de `suspended_admin`** para que el gate salga verde | Toca el **estado administrativo de un negocio vivo**. No es decisión de la máquina. Además dejaría el gate igual de frágil: sigue apoyándose en datos ajenos |
| **Reescribir `gate-portal-ampliado` con `negocioDesechable()`** | **Es el arreglo bueno del gate**, y es tarea aparte: rehace su bootstrap entero (clientes, facturas con hash de cadena, sesión de admin). El `TABLERO` ya declara exactamente esto para `gate-sin-ventanitas`, por la misma causa y con la misma conclusión: *«eso es tocar ese gate: tarea aparte, con encargo»*. Se abre el cabo |
| **Marcar el rojo dentro de los propios scripts** (un `skip`, una excepción en el regex) | Aflojar el instrumento. Es el único atajo que cabía en el alcance anterior y es exactamente el que `CLAUDE.md` prohíbe |
| **Automatizar la receta del navegador dentro de `gate-env.mjs`** (detectar el binario ARM y montar el `HOME` falso) | Es tentador y probablemente valioso: hoy **ningún** gate de navegador arranca en esta máquina con la configuración por defecto. Pero cambia el comportamiento de **los 40+ gates de navegador del repo** y necesita su propia verificación. Se **escribe la receta** y se **propone la automatización como tarea**, no se cuela aquí |

---

## 4. El plan, paso a paso

> **Antes de empezar:** esta entrega **no ejecuta ningún gate, barrido ni comprobación**. Ni el
> propio, ni el corto, ni el completo (`RITUAL.md`). Las dos ejecuciones que hacían falta ya se
> hicieron **una vez** en el intento 2 y sus salidas completas están en
> `docs/architecture/task-portal-formato-dinero-informe.md` §3. `CLAUDE.md`: *«una comprobación
> pedida una vez se ejecuta UNA vez»*. Todos los criterios del §6 se responden leyendo código o el
> índice de git.

### Paso 1 — `scripts/run-gates.mjs`: declarar los dos rojos

En el objeto `ROJOS_CONOCIDOS` (empieza en `:123`, hoy sin ninguna entrada; **no se toca ni se borra
ninguno de sus comentarios**, que son el registro de las declaraciones retiradas), añadir **dos**
entradas con la forma que el propio fichero consume en `:588-591` (`d.desde` y `d.motivo`):

```js
  'verify-dinero-espanol': {
    desde: '1 sep 2026',
    motivo:
      'ROJO ANTERIOR A LA ENTREGA QUE LO DESTAPÓ, y comprobado: la aserción ya estaba en el commit '
      + 'base (`git show b1f8770:scripts/verify-dinero-espanol.mjs`, línea 162) y el rojo también. '
      + 'Sale 19 ✓ · 1 ✗ sobre 356 pantallas; el único ✗ es «ninguna pantalla enseña una fecha en '
      + 'formato inglés» y señala /admin/descuentos con 2026-08-23 2026-09-01 2026-09-30 2027-08-23. '
      + 'NO son fechas de datos: son los marcadores de sus formularios (descuentos.js:179, :180, '
      + ':216), que viven dentro de un <script>. Llegan al texto visible porque el bloque se cierra '
      + 'antes de tiempo: descuentos.js:163 mete el catálogo con JSON.stringify SIN escapar `</`, y '
      + 'el producto 2097 de desarrollo-bamburu lleva un `</script>` en el nombre desde el 25 ago '
      + '2026 (residuo de gate: «(gate 941065)»). UN defecto, dos instrumentos cantándolo — el otro '
      + 'es lint-js-servido. LO CIERRA la tarea de `/admin/descuentos` ya abierta en TABLERO.md '
      + '§Deuda técnica (escapar `</` en descuentos.js:163), no esta declaración. Las 5 aserciones '
      + 'que portal-formato-dinero añadió a este script están las 5 en verde.',
  },
  'gate-portal-ampliado': {
    desde: '1 sep 2026',
    motivo:
      'NO ES DEL PRODUCTO NI DEL GATE: es el estado administrativo de los negocios de esta máquina. '
      + 'Sale 19 ✓ · 9 ✗. Los bloques [0] (tokens ajenos/caducados/revocados) y [1] (analíticas del '
      + 'cliente, con la aserción del dinero español `600,00 €`) pasan ENTEROS por navegador de '
      + 'verdad. Los 9 ✗ son todos del bloque [2], que escribe por formulario: 7 de los 8 negocios '
      + 'de data/control.db están en status=suspended_admin (desarrollo-bamburu desde el 25 ago '
      + '2026, los demás desde el 16 jul) y readOnlyGuard (core/tenant-middleware.js) devuelve 403 a '
      + 'todo lo que no sea GET/HEAD/OPTIONS, montado en index.js con app.use(\'*\') ANTES de la '
      + 'autenticación. La excepción de :159 («admin_user_id» de undefined) es aguas abajo del mismo '
      + '403: no hay fila que leer porque no se guardó ninguna. NO se cambia el estado de un negocio '
      + 'vivo para poner un gate en verde. LO CIERRA que el gate se traiga su propio negocio con '
      + 'negocioDesechable() —como ya hacen gate-403-permiso y gate-historial-clinico por esta misma '
      + 'causa—: tarea aparte, abierta en TABLERO.md §Deuda técnica.',
  },
```

Notas para quien lo escriba:

- **No se toca nada más del fichero.** Ni `DEUDA`, ni `ENTORNO`, ni `EXCLUIDOS`, ni la impresión.
- La Pieza D (`:605-612`) empezará a vigilar estas dos entradas sola: el día que cualquiera de las
  dos pase, el barrido pedirá que se retire. **Es el comportamiento que se quiere**, no un efecto
  secundario.
- `node --check scripts/run-gates.mjs` tiene que pasar.

### Paso 2 — `scripts/lib/gate-env.mjs`: la receta del navegador, donde se lee

Sustituir el comentario de `:64-65` (las dos líneas que hoy dicen *«El Chromium que trae puppeteer NO
arranca en este servidor (ARM)… Hay que usar el de snap»*) por un bloque en el registro que ya usa
ese fichero: el fallo real, la medida y la regla. **La línea `:66` (`export const CHROMIUM = …`) se
deja EXACTAMENTE como está** — esto no cambia comportamiento.

El bloque tiene que contener, como mínimo:

1. **Que el valor por defecto no funciona en esta máquina y por qué.** `/snap/bin/chromium` es el
   envoltorio; `NoNewPrivs: 1` le quita a `snap-confine` el `cap_dac_override` que necesita.
2. **Que los Chrome de `~/.cache/puppeteer` son `x86-64` en una máquina `aarch64`** — cierto, y no es
   toda la verdad.
3. **Que hay un tercero que sí arranca:**
   `/snap/chromium/current/usr/lib/chromium-browser/chrome`, ELF **ARM aarch64**, ejecutable directo
   sin pasar por `snap-confine`. Con la orden que lo comprueba (`file …`) para que no haya que
   creérselo.
4. **La receta, entera y copiable** (medida el 1 sep 2026; `gate-portal-ampliado` corrió con ella:
   19 ✓ · 9 ✗, salida completa en `docs/architecture/task-portal-formato-dinero-informe.md` §3):

   ```sh
   mkdir -p /tmp/fakehome/snap/chromium/common /tmp/fakehome/snap/chromium/current
   export LD_LIBRARY_PATH=/snap/chromium/current/usr/lib/aarch64-linux-gnu:\
   /snap/chromium/current/usr/lib/chromium-browser:\
   /snap/gnome-46-2404/current/usr/lib/aarch64-linux-gnu:\
   /snap/mesa-2404/current/usr/lib/aarch64-linux-gnu:\
   /snap/core24/current/usr/lib/aarch64-linux-gnu
   export HOME=/tmp/fakehome SNAP=/snap/chromium/current SNAP_NAME=chromium \
          SNAP_INSTANCE_NAME=chromium SNAP_REAL_HOME=/home/ubuntu \
          SNAP_USER_COMMON=/tmp/fakehome/snap/chromium/common \
          SNAP_USER_DATA=/tmp/fakehome/snap/chromium/current
   export PUPPETEER_EXECUTABLE_PATH=/snap/chromium/current/usr/lib/chromium-browser/chrome
   ```

5. **Por qué hace falta el `HOME` con forma de snap:** sin él, Chromium lanza
   `chrome_crashpad_handler` sin `--database` y **aborta con core dump**. No es adorno.
6. **El aviso de disco, que aquí cambia de forma:** el sumidero de `/tmp/snap-private-tmp/…` que
   llenó el disco el 22 y el 24 ago **solo existe al pasar por `snap-confine`**. Por esta vía `/tmp`
   no se remapea, así que ese sumidero no aparece — pero `perfilDesechable` sigue siendo obligatorio
   y **se mira el disco al terminar**.
7. **La lección, escrita como lección:** *dos tareas seguidas se rechazaron sobre «esta máquina no
   puede abrir un navegador», y las dos medidas que sostenían esa frase eran ciertas; la conclusión
   no. Una medida cierta sobre el envoltorio no dice nada del navegador.*

`node --check scripts/lib/gate-env.mjs` tiene que pasar.

### Paso 3 — `TABLERO.md`: los dos cabos nuevos

En §Deuda técnica, junto a las entradas del 1 sep 2026, **añadir dos** con el formato de sus vecinas
(⬜, titular en negrita con fecha, causa medida, qué lo cierra):

1. **«`gate-portal-ampliado` sale 19 ✓ · 9 ✗ por `readOnlyGuard`, y el arreglo es que se traiga su
   propio negocio (1 sep 2026).»** Causa: los 7 negocios en `suspended_admin`; el bloque `[2]`
   escribe por formulario. Arreglo: `negocioDesechable()`, como `gate-403-permiso`. **Es la misma
   avería y el mismo arreglo que el cabo de `gate-sin-ventanitas`**, y conviene decirlo: son dos
   gates de una lista que va a crecer. Declarado en `ROJOS_CONOCIDOS`.
2. **«La receta para abrir un navegador en este servidor está escrita en `gate-env.mjs`, pero ningún
   gate la aplica solo (1 sep 2026).»** Hoy `launchOpts()` apunta a `/snap/bin/chromium`, que aquí no
   arranca: **cualquier gate de navegador lanzado sin las variables de entorno de la receta muere**.
   Propuesta —**no construida, es candidata**—: que `gate-env.mjs` detecte el binario ARM interno y
   monte el `HOME` con forma de snap por su cuenta. Alcanza a los 40+ gates de navegador del repo,
   así que **necesita su propio encargo y su propia verificación**.

Y **completar** la entrada existente de `verify-dinero-espanol` (`TABLERO.md:6034-6046`) con una línea:
el rojo queda además declarado en `ROJOS_CONOCIDOS` de `scripts/run-gates.mjs` desde el 1 sep 2026,
para que salga por su nombre en cada barrido.

**No se borra ni se reescribe ninguna cifra existente.** Si alguna hay que corregir, se **tacha con su
motivo y su fecha** (`CLAUDE.md` §«Un titular de recuento se corrige con el cuerpo que lo desarrolla»).

### Paso 4 — `TABLERO.md`: cerrar los punteros y el registro de la tarea

En la ficha `## ✅ HECHA (2026-09-01) — El portal del cliente escribe el dinero a la inglesa`
(`:8251-8275`):

- Los dos punteros de `:8266-8267` (`…-analysis.md`, `…-informe.md`) tienen que apuntar a ficheros
  **versionados**. Lo resuelve el paso 5; aquí solo hay que verificar que los nombres coinciden.
- Añadir bajo el registro existente, **sin borrar nada**, una línea con los commits de esta vuelta y
  la frase que hace falta para que no se relea mal dentro de seis meses: *el arreglo del producto es
  `bfea8a8`; esta vuelta no toca `modules/` y solo cierra el registro: dos rojos declarados, la
  receta del navegador escrita y los documentos versionados.*

### Paso 5 — versionar los documentos de la tarea

`git add` de los cuatro, que hoy están en `??`:

```
docs/architecture/task-portal-formato-dinero-analysis.md              ← este fichero
docs/architecture/task-portal-formato-dinero-analysis-replanteo-0.md  ← el plano que falló, se conserva
docs/architecture/task-portal-formato-dinero-informe.md
docs/architecture/task-portal-formato-dinero-review-intento-1.md
docs/architecture/task-portal-formato-dinero-feedback.md
```

El plano anterior **se conserva, no se borra**: es el registro de qué se creía y cuándo, que es la
regla de la casa para todo lo que se corrige.

### Paso 6 — el commit

Un solo commit, con `Tarea: portal-formato-dinero` en el mensaje. El mensaje tiene que decir, sin
adornos, que **el arreglo del producto es `bfea8a8` y aquí no se toca**, y qué cierra esta vuelta.

**Antes de commitear: no se lanza ningún barrido.** `RITUAL.md` — ni el de «antes de commit». Si
Ibrahin quiere una pasada, es una autorización expresa y vale para **una**; y conviene saber de
antemano que **seguirá saliendo roja por las dos causas declaradas**, que es precisamente lo que las
declaraciones dejan escrito.

---

## 5. Riesgos

### 5.1 🔴 Que alguien «aproveche» para retocar el producto

**Qué se rompe:** el arreglo del portal está en SÍ en los seis criterios que lo miden. Cualquier línea
nueva en `modules/` lo devuelve a sin revisar — y `modules/erp/routes/invoices.js:156` sigue siendo
entrada del hash de la cadena de VERI\*FACTU sobre 919 facturas emitidas.
**Mitigación:** el criterio 4 del §6 lo mide con `git diff --name-only d93125e..HEAD -- modules/`, que
tiene que salir **vacío**. Es binario y no admite interpretación.

### 5.2 Que declarar un rojo se convierta en la forma barata de no arreglarlo

**Qué se rompe:** el mecanismo entero. Un `ROJOS_CONOCIDOS` que crece sin que nadie cierre nada es un
verde falso con más pasos.
**Mitigación, y son tres capas ya construidas:** (a) cada `motivo` **nombra la tarea que lo cierra**, y
las dos están abiertas en el TABLERO; (b) el `desde` permite ver a simple vista una declaración vieja;
(c) la **Pieza D** (`run-gates.mjs:605-612`) canta sola cuando algo declarado rojo pasa y manda
retirarlo. Es la revisión de exenciones de ATC, que ya existe y hoy no vigila nada porque el
diccionario está vacío.

### 5.3 Que la declaración se vuelva rancia — el fallo que la Pieza D existe para cazar

**Qué se rompe:** si `descuentos.js:163` se arregla en su tarea, o si alguien borra el producto `2097`,
`verify-dinero-espanol` pasará a verde y la entrada quedará anunciando un rojo que no existe. Ya pasó
dos veces en tres días (`gate-vigia-agenda`, `gate-nav-inicio-disa`).
**Mitigación:** exactamente la Pieza D, que ya lo hace. Y el `motivo` dice qué tarea lo cierra, así
que quien la cierre sabe que tiene que venir aquí a retirar la entrada.

### 5.4 Que la receta del navegador caduque con una actualización del snap

**Qué se rompe:** una versión nueva de `chromium`, `gnome-46-2404`, `mesa-2404` o `core24` puede mover
las rutas y dejar el bloque nuevo de `gate-env.mjs` mintiendo — que es el mismo pecado que se está
corrigiendo, en el mismo fichero.
**Mitigación:** el comentario no puede ser solo una lista de rutas. Lleva **el razonamiento** (buscar
el ELF `aarch64` dentro del snap, no el envoltorio) y **la orden que lo comprueba** (`file …`), de
forma que quien la encuentre rota pueda rehacerla en un minuto. Y lleva **su fecha**, como todas las
declaraciones de la casa.

### 5.5 Concurrencia, migraciones, datos existentes y la cadena de VERI\*FACTU

**Ninguno aplica, y es a propósito:** esta vuelta no escribe en ninguna base de datos, no añade ni
quita columnas, no toca `runMigrations`, no crea ni borra una sola fila de un negocio y no ejecuta
nada. Los tres ficheros que se editan son un corredor de gates, un módulo de utilidades de gates y
documentación. La cadena de VERI\*FACTU queda donde el intento 1 la dejó: verificada, 919 facturas,
`ok: true`, sin residuo.

### 5.6 Pantallas que dependen de esto

**Ninguna.** No se sirve ni una línea distinta al usuario. `/portal/<token>` y
`/admin/portal/mensajes/<id>` siguen exactamente como en `bfea8a8`. No hace falta
`sudo systemctl restart bamburu`.

### 5.7 Lo que sigue roto después de esta entrega, con su nombre

Se dice aquí para que nadie lea el cierre como «ya no queda nada»:

- **`/admin/descuentos` sigue partiéndose** por `descuentos.js:163`. Su tarea está abierta.
- **`gate-portal-ampliado` seguirá dando 9 ✗** hasta que se traiga su propio negocio. Cabo abierto.
- **`gate-sin-ventanitas` sigue con 3 ✗** por la misma causa. Ya estaba abierto.
- **La hora del chat sigue en UTC.** Ya estaba abierto.
- **`/admin/invoices` sigue pintando dinero inglés desde JavaScript**, y el barrido no puede verlo
  porque mide lo servido. Ya estaba abierto.
- **Los gates de navegador siguen sin arrancar solos** en esta máquina: la receta queda escrita, no
  automatizada. Cabo nuevo (paso 3.2).

---

## 6. Criterios de aceptación

> **Los ocho son estáticos: se responden leyendo código o el índice de git, sin ejecutar ni un gate,
> ni un barrido, ni el producto.** Es el cambio central de este replanteamiento: el plano anterior
> hacía depender el veredicto de que dos instrumentos salieran verdes, y sus rojos tienen causas que
> esta tarea no puede tocar. `node --check` no cuenta como ejecución de una comprobación: es
> validación de sintaxis, y va en el criterio 3.

- [ ] `scripts/run-gates.mjs` tiene dentro de `ROJOS_CONOCIDOS` **exactamente dos** entradas, con las claves `'verify-dinero-espanol'` y `'gate-portal-ampliado'`; cada una es un objeto con `desde: '1 sep 2026'` y `motivo`, y cada `motivo` nombra su causa con fichero y línea (`descuentos.js:163` y el producto `2097` en la primera; `readOnlyGuard` / `core/tenant-middleware.js` y `suspended_admin` en la segunda) **y** la tarea que lo cierra.
- [ ] El cambio en `scripts/run-gates.mjs` es **solo aditivo**: `git diff d93125e..HEAD -- scripts/run-gates.mjs` no contiene **ninguna** línea que empiece por `-` (aparte de la cabecera `--- a/…`). Es decir: los comentarios de las declaraciones retiradas (`gate-nav-inicio-disa`, `gate-vigia-agenda`) siguen íntegros y `DEUDA`, `ENTORNO` y `EXCLUIDOS` no se han tocado.
- [ ] `node --check scripts/run-gates.mjs` y `node --check scripts/lib/gate-env.mjs` terminan con código 0 y sin salida.
- [ ] `git diff --name-only d93125e..HEAD -- modules/` está **vacío**, y `modules/erp/routes/invoices.js` no aparece en `git diff --name-only d93125e..HEAD`.
- [ ] `git diff d93125e..HEAD -- scripts/verify-dinero-espanol.mjs scripts/gate-portal-ampliado.mjs` está **vacío** (ningún instrumento se afloja para conseguir un verde), y en `modules/portal/index.js` siguen `grep -c toFixed` = **0** y el `import { fmtEur } from '../erp/margen.js';`.
- [ ] El comentario de `scripts/lib/gate-env.mjs` inmediatamente anterior a `export const CHROMIUM` contiene la ruta literal `/snap/chromium/current/usr/lib/chromium-browser/chrome`, la palabra `aarch64`, la variable `SNAP_USER_COMMON` y la fecha `1 sep 2026`; **ya no** contiene la afirmación de que en este servidor no arranca un navegador; y la línea `export const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium';` es **idéntica** a la de `d93125e`.
- [ ] `git ls-files docs/architecture/` lista los cinco documentos de la tarea (`…-analysis.md`, `…-analysis-replanteo-0.md`, `…-informe.md`, `…-review-intento-1.md`, `…-feedback.md`), y las dos rutas citadas en `TABLERO.md:8266-8267` existen en esa lista.
- [ ] `TABLERO.md` §Deuda técnica contiene los dos cabos nuevos con fecha `1 sep 2026` —el de `gate-portal-ampliado` / `negocioDesechable()` y el de la receta del navegador sin automatizar— y la entrada existente de `verify-dinero-espanol` (`:6034`) dice que el rojo queda declarado en `ROJOS_CONOCIDOS`.

---

## 7. Lo que NO decide esta máquina

Dos cosas quedan encima de la mesa de Ibrahin. **Ninguna bloquea esta entrega** —el plan de arriba se
construye entero sin ellas—, pero las dos cambian el trabajo de después:

1. **Levantar `desarrollo-bamburu` de `suspended_admin`.** Es el estado administrativo de un negocio
   real, suspendido el 25 ago 2026. Ponerlo `active` haría pasar el bloque `[2]` de
   `gate-portal-ampliado` y probablemente los 3 ✗ de `gate-sin-ventanitas`. **No se toca sin que se
   diga**, y el arreglo bueno no es ese: es que cada gate se traiga su negocio.
2. **Automatizar la receta del navegador en `gate-env.mjs`.** Hoy **ningún** gate de navegador
   arranca en esta máquina con la configuración por defecto del repo, y eso es cobertura que se está
   perdiendo en silencio en cada barrido. Se propone como tarea, con su encargo; aquí solo se escribe
   la receta para que la próxima vuelta no vuelva a creerse que no se puede.
