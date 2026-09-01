♻️ REPLANTEAMIENTO

# Análisis — Anclar la cadena de VERI*FACTU fuera del servidor

- **id:** `anclar-verifactu-fuera`
- **origen:** `TABLERO.md:8625` · descongelada el 1 sep 2026
- **replanteo nº:** 1 (intentos previos: 3, todos rechazados)
- **lleva `firma: Ibrahin`** → este análisis incluye el apartado obligatorio **`## LA PROMESA`**, al
  final. La tarea se construye entera en `tarea/anclar-verifactu-fuera`, se prueba entera y **no se
  cierra sola**.
- **fecha del plano:** 1 sep 2026 (tarde). Todo lo que digo «medido» lo he medido **hoy**, en esta
  sesión, con una TSA de mentira y una base de usar y tirar en `/tmp/arq-anclaje`, ya borrada.
  **No he tocado ninguna base de negocio**: las dos consultas que hago sobre `data/tenants/` van con
  `sqlite3 -readonly`.

---

> ## ⚠️ LO QUE ESTA TAREA NECESITA EJECUTAR — ARRIBA DEL TODO, COMO PIDE `RITUAL.md` §3
>
> **Este plano NO pide, y NO autoriza, ningún `scripts/run-gates.mjs`** — ni el corto, ni el
> completo, ni ningún gate de navegador. Ninguno de los criterios de §6 lo necesita.
>
> Lo que sí hay que ejecutar, y es **cómo se construye la pieza**, no un barrido:
>
> 1. **La TSA local de usar y tirar** que ya levanta `scripts/verify-verifactu-anclaje.mjs` (CA +
>    firmante con `openssl`, servidor RFC-3161 con `openssl ts -reply`). Sin red, sin secretos.
> 2. **`node scripts/verify-verifactu-anclaje.mjs`**, el gate propio de la tarea, contra esa TSA
>    local. **UNA pasada** por entrega, como manda la norma de la casa.
> 3. **NO hace falta salir a Internet.** La ida y vuelta contra una TSA pública ya se hizo y salió
>    bien (revisión del intento 2, `freetsa.org`, token de 4.642 bytes). **No se repite.**
>
> **Escribir el gate no autoriza a ejecutarlo** (`RITUAL.md` §3).

---

## 0. Qué se intentó, por qué falló, y qué cambio yo

| Intento | Por qué se rechazó |
|---|---|
| **1** | Restos mecánicos (`console.log`, `TODO`) en 19 líneas añadidas. Lo tumbó el validador, no una lectura de fondo. |
| **2** | Tres puntos. El grave: `verificarAnclajes` hacía `if (caPath && f.token)`. **Sin la variable `VERIFACTU_ANCLAJE_TSA_CA`, no verificaba ni un token y contestaba `ok: true`.** |
| **3** | Un punto. `verificarAnclajes` ya distinguía «no hay CA», pero la condición exterior seguía siendo `if (f.token)`: **una fila `sellado` con `token` NULL no se verifica, no se cuenta, y el bucle sale con `ok: true`.** |

Los intentos 2 y 3 fallaron **en la misma función y en la misma línea**, por las dos mitades del
mismo `if`. Eso ya no es un problema de ejecución: **es la forma del plano.**

**Qué estaba mal en mi plano anterior.** El §4.2.5 especificaba `verificarAnclajes` como *una lista
de comprobaciones* («exige que la raíz cuadre; si no, alarma. Exige que enlace; si no, alarma…»), y
el §6 especificaba los criterios como *una lista de ataques* («cambiar un importe se caza», «borrar
un anclaje del medio se caza»). **Las dos listas son listas negras.** Todo lo que no esté enumerado
sale en verde, y el verde es el valor por defecto del bucle. Por eso cada revisión encontró un caso
nuevo: no porque el programador fuera descuidado, sino porque **la única forma de acabar una lista
negra es agotar la imaginación del atacante, y eso no se acaba nunca.** El revisor del intento 3 me
dio la solución concreta (un `if` de tres salidas) y **habría vuelto a fallar por el cuarto caso**.

**Lo que cambio, en una frase:** *el juez deja de buscar motivos para dar la alarma y pasa a exigir
prueba positiva de cada fila; el verde se calcula CONTANDO, no por ausencia de rojo.* Y el gate deja
de ser una lista de ataques imaginados y pasa a ser un **barrido combinatorio por columnas** que se
queja solo si mañana alguien añade una columna que nadie ha clasificado.

**Por qué esta vez sí:** porque la propiedad que pido es *cerrada*. «Ningún camino devuelve `cuadra`
sin que `verificados === sellados`» se comprueba **leyendo una línea** (§6.1) y se mide **mutando
todas las columnas de la tabla, no las que se me ocurran** (§6.3). Las ocho filtraciones que mido
abajo en §1.2 —siete de las cuales nadie había visto todavía— caen **todas a la vez** con el mismo
cambio, y no porque las haya enumerado: porque ninguna consigue prueba positiva.

---

## 1. Qué está mal hoy

El diagnóstico del problema de fondo (la cadena se puede reescribir desde `sqlite3`, el verificador
propio solo sabe decir «cuadra consigo misma») **sigue siendo válido y no lo repito**: está en
`docs/seguridad/vectores-de-ataque.md:90-93` y en el análisis anterior, que queda en la rama como
`task-anclar-verifactu-fuera-analysis-replanteo-0.md`. Lo que está mal **hoy, en la rama** es la
pieza que contesta la pregunta.

### 1.1 `verificarAnclajes` es una lista negra: el verde es su valor por defecto

`modules/erp/verifactu-anclaje.js:224-289`. La forma del código es:

```js
let alarma = null;
for (const f of filas) {
  if (…) { alarma = …; break; }        // :245
  if (…) { alarma = …; break; }        // :249
  if (…) { alarma = …; break; }        // :253
  if (f.token) { … }                   // :257  ← si no hay token, no pasa nada
}
if (alarma) return { ok: false, … };   // :284
if (sinComprobar > 0) return { ok: null, … };
return { ok: true, … };                // :288  ← el final del bucle ES el verde
```

**Llegar al final del bucle vale como prueba.** No hace falta haber verificado nada: basta con no
haber tropezado. Los rechazos de los intentos 2 y 3 son dos formas de no tropezar.

Tres agujeros más de la misma familia que nadie ha señalado todavía y que se leen en el propio
código:

- **`:283-284` y `:288`** — con `opts.limite` (que es lo que usa el botón de la pantalla,
  `verifactu-anclaje-routes.js:94`), `total` es el `COUNT(*)` de **todos** los sellados y
  `comprobados` es como mucho `limite`. **Y devuelve `ok: true` igual.** El juez contesta en verde
  sobre filas que no ha abierto.
- **`:227-228`** — el `SELECT` lleva `WHERE estado='sellado'`. Una fila con cualquier otro `estado`
  **no existe** para el juez. Cambiar `estado` es esconder un anclaje sin borrarlo.
- **`:274-281`** — la frescura se mide con `created_at`, que es **nuestro reloj**, escrito por
  nosotros en la misma fila que el atacante puede editar. La única hora que no se puede falsificar
  —la que va dentro del token de la TSA— no se lee nunca.

### 1.2 Medido hoy: ocho mutaciones dañinas, ocho verdes

Sonda propia en `/tmp/arq-anclaje` (ya borrada): base de usar y tirar con tres facturas y **tres
anclajes con tokens RFC-3161 de verdad**, sellados por una CA local, y `VERIFACTU_ANCLAJE_TSA_CA`
**puesta** — o sea, sin ninguna de las dos excusas de los intentos 2 y 3. Cada fila es una copia
limpia del fichero, una sola mutación, y `verificarAnclajes(db, { caPath })`:

```
[0] intacto (control)                                  -> ok=true  total=3 comprobados=3
[A] token del anclaje 2 a NULL                         -> ok=true  total=3 comprobados=3   ← rechazo del intento 3
[B] anclajes 2 y 3 marcados estado='fallo'             -> ok=true  total=1 comprobados=1
[C] intacto, pero con limite=1 (lo que usa el botón)   -> ok=true  total=3 comprobados=1
[D] borrado el anclaje 1 (el más viejo) + limite=2     -> ok=true  total=2 comprobados=2
[E] n_facturas del anclaje 2 cambiado a 999            -> ok=true  total=3 comprobados=3
[F] sellado_at del anclaje 2 movido al año 2020        -> ok=true  total=3 comprobados=3
[G] tsa_url cambiada                                   -> ok=true  total=3 comprobados=3
[H] cadena_ok de 0 a 1 (borra la alarma de origen)     -> ok=true  total=3 comprobados=3
[I] CONTROL: token del 2 corrompido                    -> ok=false  "el sello no es válido"
[J] CONTROL: borrado el anclaje del MEDIO              -> ok=false  "falta un anclaje…"
```

Los controles `[I]` y `[J]` en rojo dicen que el instrumento funciona. **Las ocho mutaciones de
enmedio son dañinas y las ocho salen en verde.** Y no son de laboratorio:

- `[B]` es **truncar la cadena por el final sin borrar nada**: dos sellos desaparecen y el juez ni
  siquiera dice que había tres. `total` baja a 1 y nadie lo nota.
- `[D]` es **borrar el sello más antiguo**: como el botón va acotado, ninguna comprobación viva del
  producto vuelve a mirar nunca los anclajes viejos.
- `[E]`, `[F]`, `[G]`, `[H]` son las cuatro columnas que la pantalla **pinta**
  (`verifactu-anclaje-routes.js:61-68`) y que el correo diario **manda por escrito**
  (`bamburu-anclaje-verifactu.mjs:111-116`): número de facturas cubiertas, fecha del sello, quién
  selló y si la cadena cuadraba al sellar. Se pueden cambiar todas y el producto dice «cuadra».

`[F]` merece un renglón aparte: la mitad de LA PROMESA es **cuándo** se selló. Esa hora está dentro
del token, firmada, y **el producto no la mira**: se fía de una columna suya.

### 1.3 Lo que sí está bien y no se toca

Lo digo para que no se rehaga por inercia, porque el revisor del intento 3 lo pidió expresamente:

- **El cerrojo de estado del servidor** (`motivoAnclajeInactivo:50-62`): dos variables en
  `/etc/bamburu.env`, donde el orquestador no escribe, más un timer que no puede instalar. Es la
  lección del cifrado de las copias del 1 sep, bien aplicada.
- **`sellar()` (`:93-148`)**: verifica el token **antes** de devolverlo y no guarda lo que no
  verifica. Ahí no hay nada roto.
- **El corte por `MAX(id)` en una sola transacción** (`anclar:179-184`).
- **Que solo se lea**: esta tarea no escribe en `invoices`, `invoice_anulaciones` ni
  `verifactu_registros`, y no abre `invoices.js`, `verifactu.js`, `verifactu-envio.js` ni
  `verifactu-cola.js`.
- **El bloque [7] del gate**, que mide sobre los bytes que salen a la red y no sobre la intención.

### 1.4 Y una cosa que hace que todo esto sea barato de arreglar

**No hay ni un solo anclaje en producción.** Medido hoy, `sqlite3 -readonly` sobre las 41 bases de
`data/tenants/`: ningún negocio tiene filas en `verifactu_anclajes`. Y `git ls-tree master` no
devuelve ni un fichero de esta familia. **El formato de la raíz todavía se puede cambiar sin
invalidar nada.** Dentro de un mes, no.

---

## 2. Cómo lo resuelven los que ya lo resolvieron

El análisis anterior comparó *el anclaje*. Aquí comparo lo que ha fallado tres veces: **cómo
contesta un ERP la pregunta «¿está íntegro?» sin mentir.**

### Odoo — la respuesta no es un booleano, y dice qué ha mirado

El informe **Check Hash Integrity** de Odoo (el de la cadena `inalterable_hash` de la NF525
francesa, que es `integridad.js` con otro nombre) **no devuelve sí/no**. Devuelve, por diario, un
**estado de un conjunto cerrado** —verificado / corrompido / *sin datos que verificar*— y, junto al
estado, **el rango que ha cubierto**: primer y último asiento, sus fechas y sus hashes. Un diario sin
asientos encadenados no sale «correcto»: sale «aquí no hay nada que comprobar», que es otra cosa.

**Qué me traigo, y es el núcleo de este replanteo:** *(a)* el veredicto es **un valor de un conjunto
cerrado, no un booleano* —porque «no he podido mirar» necesita su propio nombre, y un booleano
siempre acaba prestándole el `true` a alguien—; y *(b)* **el veredicto va acompañado siempre de la
cobertura**, así que «cuadra» nunca puede querer decir «cuadran los que me dio tiempo a mirar». Los
agujeros `[C]` y `[D]` de §1.2 son exactamente eso.

### SAP — el sello lo comprueba quien no lo emitió, y un hueco en el contador es una alarma

En Alemania, la KassenSichV obliga a SAP a apoyarse en una **TSE** de un tercero (fiskaly, Deutsche
Fiskal, Swissbit). Lo interesante para esta tarea no es el sello: es **quién juzga**. La verificación
oficial **no la hace la pantalla de SAP**: se hace sobre una **exportación** (DSFinV-K) con las
herramientas del auditor, fuera del sistema auditado. Y el **contador monótono** de transacciones de
la TSE convierte cualquier hueco en una alarma **por sí solo**, sin que nadie tenga que acordarse de
comprobarlo.

**Qué me traigo:** *(a)* **la pantalla no es la prueba** — la prueba es el `.tsr` que sale del
servidor cada día por correo; la pantalla es una comodidad, y el documento lo tiene que decir con
esas palabras; *(b)* el censo por estados de §3, que hace que una fila «escondida» (el agujero
`[B]`) sea una alarma **por existir**, no por haber sido buscada.

### Salesforce — aquí NO aplica, y decirlo es información

Salesforce nunca ha tenido que contestar esta pregunta, porque **en Salesforce el cliente no tiene
acceso a la base de datos**. El atacante de esta tarea —«quien tenga el fichero `.db`»— no existe en
su modelo: `FieldHistoryArchive` es inmutable porque vive en el dominio del operador de la
plataforma, no porque nadie lo compruebe. **Su verificador no tiene que ser honesto sobre lo que no
ha mirado, porque no hay nada que mirar.**

Y hay un motivo por el que copiar su modelo aquí sería un error, que ya dije y sostengo: **en
Bamburu el operador somos nosotros.** Cualquier «archivo inalterable» nuestro lo firma la misma mano
que edita el `.db`. De ahí la exigencia dura de §3: lo único que vale es un tercero de verdad, y lo
único que el producto puede afirmar por su cuenta es **qué ha comprobado y qué no**.

---

## 3. La decisión

### Qué se hace

**El juez cambia de forma.** `verificarAnclajes` deja de ser un bucle que busca motivos de alarma y
pasa a ser un **clasificador**: cada fila de `verifactu_anclajes` —**todas**, no solo las
`sellado`— cae en **exactamente un cubo**, y el veredicto se calcula **de los contadores de los
cubos**, no de la ausencia de alarma. El valor por defecto de la variable del veredicto es
`'alarma'`, y `'cuadra'` **se gana**.

Y para que se pueda ganar barato, **la raíz pasa a tener dos niveles** (§4.2):

- una **raíz fiscal**, que resume el material fiscal hasta el corte — cara de recomponer, `O(facturas)`;
- una **raíz** = huella de *(la cabecera de la propia fila + la raíz fiscal)*, que es lo que sella la
  TSA — barata de recomponer, `O(1)`, porque solo necesita las columnas de esa misma fila.

Con eso, **todas las columnas que la pantalla pinta y el correo manda quedan dentro de lo que firma
el tercero** (cierra `[E]`, `[G]`, `[H]`), y comprobarlas cuesta un SHA-256 por fila. Y la raíz
fiscal solo hay que recomponerla **para el último anclaje**, porque *la raíz fiscal del último
anclaje es función de todas las filas fiscales selladas*: tocar cualquiera de ellas la cambia. Eso
no es «mirar menos»: es **una prueba que cubre todas las filas**, y el criterio 6 de §6 la mide
tocando una factura que solo cubre el anclaje **más viejo**.

La hora se lee **del token**, no de nuestra columna (cierra `[F]` y `created_at`). El botón acotado
pasa a devolver un veredicto **`parcial`**, que nunca es verde (cierra `[C]`). Y **alguien recorre la
cadena entera una vez al día**: el barrido, que ya abre cada negocio, guarda el veredicto completo
con su hora, y la pantalla lo enseña **con su antigüedad** y lo caduca (cierra `[D]`).

### En qué capa vive

La misma que ya tiene: **`modules/erp/`**, junto a `verifactu.js`, `verifactu-envio.js` y
`verifactu-cola.js`. **No se mueve nada de sitio.** Este replanteo no toca la arquitectura del
anclaje: toca la del juez.

### Qué patrón del propio código sigue

1. **Fail-closed: hay que encontrar la prueba para pasar** — `requirePerm` (`core/auth.js:46-60`).
   Ese middleware no busca motivos para denegar: **exige encontrar la fila del permiso**, y si no la
   encuentra, no pasa. El silencio no abre la puerta. `verificarAnclajes` pasa a tener exactamente
   esa forma: el silencio no da verde.
2. **La puerta única que dice el motivo de estar apagada** — `motivoColaInactiva`
   (`verifactu-cola.js:74-89`), ya copiada en `motivoAnclajeInactivo`. Se mantiene tal cual.
3. **El veredicto guardado con su fecha — y su enfermedad, curada** — `integrity_checks` +
   `listIntegrityResults` (`modules/superadmin/integridad.js:46-48`). Es el patrón correcto para
   sacar el trabajo caro de la petición HTTP, y **es exactamente la avería que denuncié en el §1.3
   del plano anterior**: un verde del 23 de agosto seguía en pantalla nueve días y 91 facturas
   después. Copio el patrón **y le pongo la caducidad que le falta**: la pantalla enseña la
   antigüedad del veredicto y lo pinta en ámbar cuando pasa de `2 × latido`. Un veredicto guardado
   sin fecha de caducidad es un censo que dice CERO.
4. **La tabla aditiva de solo-añadir** — `verifactu_registros`, `invoice_anulaciones`. La tabla de
   auditorías nace igual: `CREATE TABLE IF NOT EXISTS`, ningún `DROP`, ninguna columna tocada.
5. **El censo que no se puede quedar ciego** — `scripts/censo-ventanitas.mjs` y su lección escrita en
   `CLAUDE.md`: *un censo que dice CERO y no es cierto es peor que no tenerlo, porque cierra la
   pregunta*. El barrido por columnas del gate (§4.6) **falla si aparece una columna que nadie ha
   clasificado**, que es la única forma de que un censo no envejezca mintiendo.

### Qué se descarta, y por qué

| Descartado | Por qué |
|---|---|
| **Hacer lo que pedía el revisor del intento 3 y parar ahí** (partir `if (f.token)` en tres salidas) | Es correcto y **se hace** —cae dentro del clasificador—, pero **no basta**: arregla `[A]` y deja vivos `[B]`…`[H]`, que he medido hoy. Tres intentos dicen que tapar el agujero que se ve no cierra la clase. |
| **Seguir con `ok: true / null / false`** | Un booleano con tres valores es una trampa en el sitio que llama: `if (r.ok)` trata `null` como `false` por suerte, no por diseño, y el día que alguien escriba `if (r.ok !== false)` vuelve el verde. Veredicto de **conjunto cerrado y con nombre**, y **se quita el campo `ok`** para que cualquier sitio que se quedara sin migrar reviente en vez de mentir. |
| **Recomponer la raíz fiscal de TODOS los anclajes en cada auditoría** | Es `O(anclajes × facturas)`: medido, 6,2 ms por anclaje sobre los datos reales de `desarrollo-bamburu` → 31 s con 5.000 anclajes, y creciendo con el cuadrado. Es lo que congeló la pantalla en el intento 2. Con la raíz de dos niveles, el mismo resultado sale en `O(anclajes)` + una sola recomposición. |
| **Meter la auditoría completa dentro de la petición HTTP** | `better-sqlite3` es síncrono y `execFileSync` bloquea el bucle de eventos; `index.js` sirve **todos** los negocios desde un `serve({ port: 3000 })`. Medido hoy: `openssl ts -verify` 5,7 ms + `openssl ts -reply -text` 4,8 ms = **~11 ms por anclaje**. Con 1.000 anclajes son 11 s con el producto entero parado. La auditoría completa vive en el barrido `oneshot`, que tiene su propio proceso. |
| **Guardar el veredicto y ya está** | Es la enfermedad de `integrity_checks`. Se guarda **y caduca**. |
| **Firmar el veredicto guardado, o sacarlo a otro sitio nuestro** | Quien puede escribir la tabla de auditorías puede escribir la firma. El único dato que sale de la mano que puede mentir es **el `.tsr` que va por correo**, y eso ya está construido. Se dice en el documento en vez de fingir que la pantalla es una prueba. |
| **Aprovechar y arreglar `verifyTenantInvoices`** | Su SHA es línea base de `scripts/gate-cadena-integridad.mjs`. No se toca. |
| **Cambiar la TSA, el timer, el correo o el menú** | Funcionan y están revisados. Este replanteo **no los abre**. |

---

## 4. El plan, paso a paso

> **Punto de partida:** la rama `tarea/anclar-verifactu-fuera` en `e381d1b`. **No se rehace nada**:
> se cambian el juez, el formato de la raíz, la pantalla y el gate. Los diez pasos del plano anterior
> siguen construidos y en pie.

### 1 · `modules/erp/models.js` — una columna y una tabla, las dos aditivas

**1.1** En el bloque de `verifactu_anclajes` (`:1611-1633`), añadir la columna de la raíz fiscal al
`CREATE TABLE` y, justo debajo del `CREATE UNIQUE INDEX` de `:1632`, la línea para las bases que ya
tengan la tabla creada (patrón `addCol`, `models.js:9-12`):

```js
addCol(db, 'verifactu_anclajes', 'raiz_fiscal', 'TEXT');
```

En el `CREATE TABLE`, además: `raiz_fiscal TEXT` y **quitar el `DEFAULT 'pendiente'` de `estado`**
(ningún camino lo escribe nunca — lo señaló la revisión del intento 2 — y con el censo del paso 3.1
un `estado` que nadie escribe pasa a ser una alarma).

**1.2** Tabla nueva, a continuación:

```sql
CREATE TABLE IF NOT EXISTS verifactu_anclajes_auditorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corrida_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- cuándo se recorrió la cadena ENTERA
  veredicto TEXT NOT NULL,                        -- cuadra | parcial | sin-comprobar | alarma | sin-sellos
  total_filas INTEGER NOT NULL,                   -- COUNT(*) de verifactu_anclajes, TODAS
  sellados INTEGER NOT NULL,
  verificados INTEGER NOT NULL,                   -- con prueba criptográfica positiva
  sin_comprobar INTEGER NOT NULL,
  fuera_de_ventana INTEGER NOT NULL,
  alarmadas INTEGER NOT NULL,
  alarma_secuencia INTEGER,
  alarma_motivo TEXT
);
```

De solo-añadir, una fila por pasada diaria y negocio (365 al año). Ningún `DROP`, ninguna columna
tocada en ninguna tabla existente.

### 2 · `modules/erp/verifactu-anclaje.js` — la raíz de dos niveles

**2.1 · `raizFiscal(db, { hastaInvoiceId, hastaAnulacionId, hastaRegistroId })`** — NUEVA. Es el
cuerpo de la `raizCanonica` de hoy (`:67-90`) **sin la línea `raiz_anterior=`**, con la cabecera
cambiada a `bamburu-anclaje-fiscal-v2`. Devuelve
`{ raizFiscal, n_facturas, n_anulaciones, n_registros }`. Las tres consultas, el orden por `id ASC`
y los topes por `id` **no se tocan**: son lo que hace que la raíz de ayer verifique hoy.

**2.2 · `raizCanonica(db, cabecera)`** — se reescribe como la composición de los dos niveles. Recibe
`{ hastaInvoiceId, hastaAnulacionId, hastaRegistroId, raizAnterior, cadenaOk, cadenaDetalle, tsaUrl }`,
llama a `raizFiscal(...)` y devuelve `{ raiz, raizFiscal, n_facturas, n_anulaciones, n_registros }`,
donde `raiz` es el SHA-256 en hexadecimal MAYÚSCULAS de este texto **exacto**, líneas separadas por
`\n`:

```
bamburu-anclaje-v2
raiz_anterior=<raiz del anclaje anterior, o vacío>
hasta_invoice_id=<n>
hasta_anulacion_id=<n>
hasta_registro_id=<n>
n_facturas=<n>
n_anulaciones=<n>
n_registros=<n>
cadena_ok=<0|1>
cadena_detalle_sha=<SHA-256 MAYÚSCULAS del texto de la alarma, o vacío si no hay>
tsa_url=<url>
raiz_fiscal=<raizFiscal>
```

**2.3 · `cabeceraDeFila(fila)`** — NUEVA, exportada. Recompone **ese mismo texto** a partir de una
fila ya guardada de `verifactu_anclajes` (usando su `raiz_fiscal` almacenada) y devuelve el SHA-256.
Es lo que permite comprobar en `O(1)` que las columnas de una fila son las que se sellaron.
**Tiene que compartir la implementación con 2.2** —una sola función que construye el texto, dos
llamadas— para que no puedan divergir.

Cuatro cosas que el programador **no puede cambiar sin invalidar todos los anclajes anteriores**, y
que por eso van dichas aquí: la cabecera literal `bamburu-anclaje-v2`, el **orden** de las líneas,
los topes por `id`, y que `cadena_detalle` entre por su SHA (para que un salto de línea en el texto
de una alarma no parta el formato).

**2.4 · `sellar()`** — **no se toca** (`:93-148`). Añadir solo la lectura de la hora dentro del
mismo directorio temporal ya existente, que ya se hace en `:135-140`.

**2.5 · `verificarToken(raiz, token, caPath)`** — devuelve ahora
`{ ok, detalle, horaToken }`. Sobre el mismo fichero temporal que ya escribe, después del
`openssl ts -verify`, ejecuta `openssl ts -reply -in resp.tsr -text` y saca la línea `Time stamp:`.
**Medido hoy: 5,7 ms el verify + 4,8 ms la hora.** Además, el `detalle` que devuelve se recorta a
**la primera línea** de la salida de `openssl` (el resto, al registro): hoy el motivo entero
—incluido un volcado de `asn1_d2i_read_bio`— acaba en la URL y en la pantalla del dueño.

**2.6 · `anclar()`** — cambios mínimos (`:167-218`):
- pasa `cadenaOk`, `cadenaDetalle` y `tsaUrl` a `raizCanonica` (ya los tiene calculados en `:197-198`);
- guarda `raiz_fiscal` en el `INSERT` de `:208-215`;
- todo lo demás —la transacción del corte, el latido, la regla `secuencia = 0` para los fallos— **no
  se toca**.

### 3 · `modules/erp/verifactu-anclaje.js` — el juez, reescrito como clasificador

Sustituye entera a `verificarAnclajes` (`:224-289`). Firma:
`verificarAnclajes(db, { limite, caPath, latidoH, ahoraMs })`.

> **`opts.ahoraMs` es nuevo y obligatorio** (lo pidió la revisión del intento 2): sin él, el aviso de
> «el último sello tiene N horas» no se puede probar sin esperar un día.

**3.1 · Censo de TODAS las filas.** `SELECT` sin `WHERE estado`. Cada fila cae en un cubo:

| Fila | Cubo |
|---|---|
| `estado='sellado'` | entra en la cadena (paso 3.2) |
| `estado='fallo'` **y** `secuencia = 0` **y** `token IS NULL` **y** `error IS NOT NULL` | `fallidas` — legítima, no es un hueco |
| `estado='fallo'` con secuencia, o con sello, o sin error | **ALARMA**: «una fila marcada como fallo lleva número de orden y sello: alguien ha escondido un anclaje» |
| cualquier otro `estado` | **ALARMA**: «hay una fila con un estado que este producto no escribe nunca» |

Esto cierra `[B]`: esconder un anclaje cambiándole el estado es ahora una alarma **por existir la
fila**, sin que nadie tenga que ir a buscarla.

**3.2 · Recorrido de los sellados**, `ORDER BY secuencia ASC`. Si hay `limite`, la ventana son los
últimos N y **los `sellados - N` restantes van al cubo `fueraDeVentana`** (no desaparecen de la
cuenta: eso es `[C]`). Por cada fila de la ventana, en este orden, y **cada fallo manda la fila al
cubo `alarmadas` con su motivo**:

1. `estado='sellado'` con `error IS NOT NULL` → alarma.
2. `raiz_fiscal IS NULL` → cubo `sinComprobar`, motivo «anclaje en formato v1, anterior a este
   cambio: no se puede comprobar» *(hoy no existe ninguno — §1.4 — pero fail-closed no adivina)*.
3. `cabeceraDeFila(fila) !== fila.raiz` → alarma «se han cambiado los datos del anclaje después de
   sellarlo». *(Cierra `[E]`, `[G]`, `[H]` y cualquier columna futura de la cabecera.)*
4. `secuencia` distinta de la esperada → alarma «hueco en la numeración». Con `limite`, la esperada
   arranca en la de la primera fila de la ventana.
5. `raiz_anterior` distinta de la `raiz` de la fila anterior → alarma «falta un anclaje». Con
   `limite`, la primera fila de la ventana **no tiene contra qué contrastar**: eso ya la deja en
   `fueraDeVentana`, no en verde.
6. `token IS NULL` → **alarma** «dice sellada y no tiene sello». *(El rechazo del intento 3.)*
7. Sin `caPath` → cubo `sinComprobar`, motivo «falta el certificado raíz de la TSA».
8. `verificarToken(...)` → si no da `Verification: OK`, alarma «el sello no es válido».
9. `sellado_at` presente y **distinta de la hora que dice el token** (comparadas al segundo) →
   alarma «la fecha del sello no es la que firmó la TSA». Si `sellado_at` es `NULL`, se usa la del
   token y no es alarma: `sellar()` lo permite a propósito (`:133-140`). *(Cierra `[F]`.)*
10. Si sobrevive a todo lo anterior → **`verificados++`**. Es el único sitio del fichero donde ese
    contador sube.

**3.3 · La raíz fiscal, una sola vez.** Para la **última** fila de la ventana: recomponer
`raizFiscal` con sus topes y exigir que sea igual a su `raiz_fiscal`. Si no → alarma «se ha tocado
material fiscal ya sellado». **Solo entonces**, y solo si todo lo demás está limpio, se hace una
**búsqueda binaria** sobre los anclajes recomponiendo su raíz fiscal, para poder decir *«la primera
prueba de que se tocó es el anclaje 47, sellado el 3 de septiembre»*. Son `log₂(n)` recomposiciones
—**7 con mil anclajes**— y solo se pagan cuando ya hay alarma.

> **Por qué basta con la última** (y esto va también en el documento, porque es la pieza que un
> revisor tiene que poder juzgar sin fiarse de mí): la raíz fiscal del último anclaje se calcula
> sobre **todas** las filas de `invoices`, `invoice_anulaciones` y `verifactu_registros` hasta su
> corte, **con la identidad y la huella de cada una**. Cambiar, borrar o reordenar cualquiera de
> ellas la cambia. Las filas posteriores al corte no están selladas por nadie —y no se puede fingir
> que lo estén—. El criterio 6 de §6 lo mide tocando una factura que **solo** cubre el anclaje más
> viejo.

**3.4 · Frescura, con el reloj del tercero.** La edad del último sello se mide con `sellado_at` (o la
hora del token), **nunca con `created_at`**. Si pasa de `2 × latido` → alarma. Así `created_at` deja
de ser una columna con la que se pueda mentir.

**3.5 · El veredicto, por conteo.** Al final, y en este orden literal:

```js
const cuadranLosCubos =
  verificados + sinComprobar + alarmadas + fueraDeVentana + fallidas === totalFilas;

let veredicto = 'alarma';                       // ← el valor por defecto, y hay que ganarse otro
if (!cuadranLosCubos) veredicto = 'alarma';     // el caso imposible también es rojo
else if (sellados === 0)         veredicto = 'sin-sellos';
else if (alarmadas > 0)          veredicto = 'alarma';
else if (fueraDeVentana > 0)     veredicto = 'parcial';
else if (sinComprobar > 0)       veredicto = 'sin-comprobar';
else if (verificados === sellados) veredicto = 'cuadra';
```

**El literal `'cuadra'` aparece UNA sola vez en todo el fichero, y en esa línea.** Es el criterio 1
de §6 y se comprueba con un `grep`.

Devuelve `{ veredicto, totalFilas, sellados, fallidas, verificados, sinComprobar, fueraDeVentana,
alarmadas, alarma, ultimo }`. **Sin campo `ok`**: cualquier sitio que se quede sin migrar tiene que
reventar, no heredar un verde.

**3.6 · `textoVeredicto(r)`** — NUEVA, exportada. Traduce el veredicto a la frase que ve una persona,
**con la cobertura dentro** («cuadra: 512 de 512 anclajes comprobados uno a uno»; «comprobados los
últimos 25 de 512 — de los otros 487 no se dice nada»). **La usan los tres sitios** —pantalla, botón
y correo—, para que no puedan discrepar. Es el mismo principio que `motivoAnclajeInactivo`.

### 4 · `scripts/bamburu-anclaje-verifactu.mjs` — alguien recorre la cadena entera

Dos cambios, dentro de `mandarCorreoDiario()` (`:85-141`), que ya abre cada negocio una vez al día:

**4.1** Antes de componer la fila de cada negocio, `verificarAnclajes(db)` **sin límite** (proceso
`oneshot`, no comparte bucle de eventos con nadie) y guardar el resultado en
`verifactu_anclajes_auditorias`. Ojo: hoy ese bucle abre la base en `readonly` (`:97`) — para escribir
la auditoría hay que abrirla en lectura/escritura, o hacer la auditoría en el bucle de `procesar()`.
**Decide el programador y lo explica en la entrega**; la restricción es que **la auditoría completa
no puede correr dentro de una petición HTTP**.

**4.2** La fila del correo incorpora `textoVeredicto(...)`, y el asunto lleva **`⚠️ ALARMA`** si algún
negocio sale en `alarma` (hoy solo lleva `⚠️ sin sellar`). El `.tsr` adjunto se queda igual: es la
única prueba que sale del servidor.

**4.3** Envolver cada negocio del bucle en su propio `try/catch`, como ya hace `procesar()`: hoy un
`.db` raro deja **sin correo a todos los negocios** (lo señaló la revisión del intento 2).

### 5 · `modules/erp/routes/verifactu-anclaje-routes.js` — la pantalla

**5.1 · `GET /anclajes`** — el cartel de arriba y la tabla **no se tocan** (`:30-48`, `:61-72`): son
`SELECT` acotados y baratos, y así se quedan. Se añade debajo del cartel el **bloque de la última
auditoría completa**, leído de `verifactu_anclajes_auditorias ORDER BY id DESC LIMIT 1`:

- si no hay ninguna → «**Nunca se ha recorrido la cadena de sellos entera.**» en ámbar;
- si la hay y `corrida_at` tiene más de `2 × latido` → **ámbar**, con la antigüedad en horas y la
  frase «este resultado ya no vale: es de hace N h»;
- si es fresca → el `textoVeredicto` que corresponda, y **verde solo con `cuadra`**.

**5.2 · `POST /anclajes/comprobar`** (`:93-106`) — sigue acotado, pero:
- la constante por defecto baja de 100 a **25** (`ANCLAJE_COMPROBAR_LIMITE`): con los 11 ms por
  anclaje medidos hoy son ~0,3 s de proceso bloqueado en vez de 1,1 s;
- el `redirect` deja de llevar `ok=1|0|sc` y lleva **`v=<veredicto>`** más `n` y `total`;
- el texto del *flash* sale de `textoVeredicto`. **Con `limite < total` el veredicto es `parcial` por
  construcción, así que este botón no puede decir «cuadra».** Es el criterio 4.
- el botón se etiqueta **«Comprobar los últimos N»**, no «Comprobar ahora»: la etiqueta también es
  parte de no mentir.

**5.3** Nada de `confirm()`/`prompt()`/`alert()`, aquí ni en ningún sitio.

### 6 · `scripts/verify-verifactu-anclaje.mjs` — el gate deja de adivinar ataques

Los ocho bloques de hoy **se quedan**. Se añaden dos, y son el corazón de este replanteo.

**6.1 · Bloque [9] · Barrido por columnas.** Sobre una base con **tres anclajes sellados de verdad,
al menos una anulación y al menos un registro oficial** (para que las mutaciones de los topes sean
significativas), y con la CA puesta. En el script, una **tabla declarada**:

```js
const MUTACIONES = [
  { col: 'secuencia',          sql: `UPDATE … SET secuencia=9 WHERE secuencia=2`,           caza: true },
  { col: 'raiz',               sql: `UPDATE … SET raiz='DEADBEEF' WHERE secuencia=2`,        caza: true },
  { col: 'raiz_fiscal',        …, caza: true },
  { col: 'raiz_anterior',      …, caza: true },
  { col: 'hasta_invoice_id',   …, caza: true },
  { col: 'hasta_anulacion_id', …, caza: true },
  { col: 'hasta_registro_id',  …, caza: true },
  { col: 'n_facturas',         …, caza: true },
  { col: 'n_anulaciones',      …, caza: true },
  { col: 'n_registros',        …, caza: true },
  { col: 'cadena_ok',          …, caza: true },
  { col: 'cadena_detalle',     …, caza: true },
  { col: 'tsa_url',            …, caza: true },
  { col: 'token',              …, caza: true },   // a NULL y corrompido: dos entradas
  { col: 'sellado_at',         …, caza: true },
  { col: 'estado',             …, caza: true },
  { col: 'error',              …, caza: true },
  { col: 'id',         caza: false, motivo: 'clave interna de la fila: no entra en lo que firma la TSA ni en nada que se enseñe.' },
  { col: 'created_at', caza: false, motivo: 'hora de nuestro reloj, solo informativa: la hora que vale es la que va dentro del sello, y esa sí se comprueba.' },
];
```

Y tres reglas, que son lo que hace que esto no envejezca:

1. **`PRAGMA table_info(verifactu_anclajes)` contra la tabla declarada.** Si aparece una columna que
   no está en `MUTACIONES`, **el gate falla** con «hay una columna nueva que nadie ha clasificado».
   Esa es la lección del censo de ventanitas: la lista no puede quedarse ciega en silencio.
2. Cada entrada con `caza: true` se aplica **sobre una copia limpia del fichero** y se exige
   `veredicto !== 'cuadra'`.
3. Cada entrada con `caza: false` se aplica igual y se exige `veredicto === 'cuadra'` —una exención
   que en realidad sí se caza también está mal declarada— y su **`motivo` tiene que aparecer,
   literal, en `docs/verifactu/anclaje-externo.md` §«Qué NO prueba»**. El gate lo comprueba leyendo
   el fichero. Así el documento no puede quedarse desactualizado sin que se note.

**6.2 · Bloque [10] · Las mutaciones de fila y de ventana.** Cada una sobre una copia limpia,
exigiendo `veredicto !== 'cuadra'`: borrar el anclaje **más viejo**, borrar el del **medio**, borrar
el **último**, `estado='fallo'` sobre los dos últimos, comprobar con `limite=1` habiendo 3, y
—criterio 6— **cambiar una factura que solo cubre el anclaje más viejo y recalcular la cadena
propietaria con `calcHash`**, exigiendo que `verifyTenantInvoices` siga en verde y el juez no.

**6.3** La regla de salida del intento 2 se queda: `fail === 0 && (sinVerificar === 0 ||
ANCLAJE_GATE_ADMITE_SIN_VERIFICAR === '1')` (`:398-408`). Y la limpieza en el `finally`, por marca y
no por ids, sobre `negocioDesechable()`.

### 7 · `docs/verifactu/anclaje-externo.md`

- **El formato de la raíz v2**, los dos niveles, con el texto exacto — para poder verificar dentro de
  cinco años sin este código.
- **§«Qué NO prueba»**, ampliada y con los `motivo` de las exenciones del gate **literales**:
  - que `id` y `created_at` se pueden cambiar sin que nadie lo note, y por qué da igual;
  - que **borrar los últimos anclajes** no se ve hasta que pasan `2 × latido`, y que la red contra
    eso es el `.tsr` que sale por correo cada día;
  - que **el anclaje no dice nada de lo que pasara antes del primer sello**;
  - que **la pantalla no es la prueba**: la prueba es el `.tsr` fuera del servidor, y quien pueda
    escribir el `.db` puede escribir también la tabla de auditorías.
- **Los tres veredictos que no son verdes** (`parcial`, `sin-comprobar`, `alarma`), qué significa
  cada uno y qué hay que hacer con él.
- **`ANCLAJE_COMPROBAR_LIMITE` = 25** por defecto, con el porqué medido.

### 8 · Lo que NO se toca en este replanteo

`sellar()`, `motivoAnclajeInactivo()`, la decisión de anclar y su transacción, las unidades de
systemd, el menú (`menu.js:53,262`), el montaje (`routes/index.js:53`), la columna «Sellado» del
superadmin (`integridad.js:16-24,67,85`), y **ninguno de los cuatro ficheros de la familia
Verifactu**.

---

## 5. Riesgos

**1 · El formato de la raíz cambia (v1 → v2) e invalida los anclajes que existan.**
*Mitigación:* medido hoy, `sqlite3 -readonly` sobre las 41 bases de `data/tenants/`: **no hay ni un
anclaje en ningún negocio**, y `git ls-tree master` no tiene ni un fichero de esta familia. Es ahora
o nunca. Y aun así, fail-closed: una fila con `raiz_fiscal` nulo (un anclaje v1) **no sale verde**,
sale en `sin-comprobar` con su motivo escrito (paso 3.2.2).

**2 · Que el clasificador dé falsas alarmas y el dueño vea rojo sin motivo.** Es el riesgo real de
apretar un juez: un rojo que no significa nada enseña a ignorar los rojos.
*Mitigación:* cada regla nueva se ata a algo que **el producto no escribe nunca**. `anclar()` pone
`estado` y `token` bajo la **misma** condición `sello.ok` (`:214`), así que un `sellado` sin token no
lo produce el producto; los fallos van siempre con `secuencia=0` y `error` (`:206`, `:215`); la
cabecera se sella con los mismos valores que se guardan (paso 2.6). El único hueco legítimo previsto
—`sellado_at` nulo porque no se pudo leer la hora (`:133-140`)— está tratado a mano en el paso 3.2.9.
Y el bloque [0] del gate (la base intacta) exige `cuadra` en cada pasada: si alguna regla nueva
chilla de más, el gate se pone rojo antes que un cliente.

**3 · El coste de la auditoría completa crece con los anclajes.** 11 ms por anclaje, medidos
(`ts -verify` 5,7 + `ts -reply -text` 4,8): 365 anclajes ≈ 4 s, 5.000 ≈ 55 s.
*Mitigación:* corre en el barrido `oneshot`, **en su propio proceso**, una vez al día. En la petición
HTTP solo queda la ventana acotada de 25 (~0,3 s) y lecturas baratas. Es lineal, no cuadrática: eso
es lo que arregla la raíz de dos niveles.

**4 · La búsqueda binaria del paso 3.3 puede señalar al anclaje equivocado** si alguien ha tocado
además las raíces guardadas, porque entonces la propiedad deja de ser monótona.
*Mitigación:* solo se ejecuta **cuando el encadenado y todos los tokens están limpios**; en ese caso
las raíces guardadas están firmadas y la monotonía se sostiene. Y es un texto de diagnóstico: el
veredicto ya es `alarma` antes de buscar. Va dicho en el documento.

**5 · Romper la cadena de VERI\*FACTU.** 926 facturas y 1.234 registros.
*Mitigación:* esta tarea sigue sin escribir en ninguna tabla existente y sin abrir los cuatro
ficheros de la familia. El criterio 7 lo mide con el SHA-256 de las tres tablas antes y después de
una pasada completa **que sí ancle** (si no ancla, la prueba no prueba nada).

**6 · Escribir la auditoría desde el barrido choca con la app.** El bucle del correo abre hoy en
`readonly` (`bamburu-anclaje-verifactu.mjs:97`) y ahora tiene que escribir.
*Mitigación:* sigue habiendo **un solo escritor** (el barrido `oneshot`, que no se solapa consigo
mismo) y la tabla es de solo-añadir; la pantalla solo lee. Si el fichero está bloqueado, se registra
y se sigue con el negocio siguiente — el `try/catch` por negocio del paso 4.3.

**7 · Que la tabla de auditorías se confunda con una prueba.** Quien puede escribir el `.db` puede
escribirla.
*Mitigación:* no se firma ni se presume: el documento dice **con esas palabras** que la prueba es el
`.tsr` que sale por correo, y la pantalla caduca su propio verde a las `2 × latido`.

**8 · Que la pieza se encienda sola al fusionar** — la avería del cifrado del 1 sep.
*Mitigación:* intacta y sin tocar: `motivoAnclajeInactivo` exige dos variables de `/etc/bamburu.env`,
donde el orquestador no escribe, y el timer no está instalado. Con esto en `master`, no llama a nadie
ni escribe una fila.

**9 · Pantallas que dependen de esto.** `/admin/verifactu/anclajes` (cambia) y
`/superadmin/integridad` (no se toca). El criterio 8 exige que las dos respondan **200 con su URL
final**, porque media docena de pantallas de este producto redirigen y una redirección también
responde 200.

**10 · Basura de la prueba.** El gate crea negocio, facturas, anulaciones y anclajes, y ahora además
docenas de copias del `.db`.
*Mitigación:* `negocioDesechable()`, prefijo reconocible, y limpieza en el `finally` **por la marca
y no por los ids de la pasada**. Las copias van todas a un único directorio temporal que se borra
entero. Toda mutación, **sobre copias**: una factura tocada no se puede «destocar» si entra en la
cadena.

---

## 6. Criterios de aceptación

- [ ] **El verde se gana:** el literal `'cuadra'` aparece **una sola vez** en `modules/erp/verifactu-anclaje.js`, en la asignación final del veredicto, precedida en el mismo bloque por las comprobaciones de `cuadranLosCubos`, `alarmadas === 0`, `fueraDeVentana === 0`, `sinComprobar === 0` y `verificados === sellados`; la variable del veredicto se inicializa a `'alarma'`; y `verificarAnclajes` **no devuelve ningún campo `ok`**.
- [ ] **Las ocho mutaciones que hoy salen verdes salen rojas:** con la CA puesta y tokens válidos, ninguna de estas devuelve `veredicto === 'cuadra'` — `token` a NULL · `estado='fallo'` sobre un anclaje con secuencia y sello · `n_facturas` cambiado · `sellado_at` cambiado · `tsa_url` cambiada · `cadena_ok` volteado · borrar el anclaje **más viejo** · comprobar con `limite` menor que el total. Y la base **intacta** sí devuelve `'cuadra'`.
- [ ] **El barrido por columnas es exhaustivo:** `scripts/verify-verifactu-anclaje.mjs` recorre `PRAGMA table_info(verifactu_anclajes)`, aplica una mutación declarada por columna sobre una copia, **sale con código 1 si alguna columna de la tabla no está declarada** (comprobado añadiendo una columna de mentira en una copia), y el `motivo` de cada columna declarada como no-cazable aparece **literal** en `docs/verifactu/anclaje-externo.md`.
- [ ] **El botón no puede decir «cuadra»:** con más anclajes que `ANCLAJE_COMPROBAR_LIMITE`, `POST /admin/verifactu/anclajes/comprobar` redirige con `v=parcial` y la pantalla dice cuántos de cuántos ha comprobado; la palabra «cuadra» no aparece en esa respuesta.
- [ ] **Alguien recorre la cadena entera, y su verde caduca:** una pasada de `scripts/bamburu-anclaje-verifactu.mjs` escribe una fila en `verifactu_anclajes_auditorias` con veredicto y cobertura; `/admin/verifactu/anclajes` la muestra con su antigüedad; y con esa fila fechada hace más de `2 × ANCLAJE_LATIDO_H` horas, la pantalla **no** la pinta en verde aunque diga `cuadra`.
- [ ] **El último anclaje cubre todo lo sellado:** sobre una copia con tres anclajes, cambiar una factura que solo cubre el **más viejo** y recalcular toda la cadena con `calcHash` deja `verifyTenantInvoices` en `ok: true` y `verificarAnclajes` en `veredicto === 'alarma'`, nombrando el anclaje y la fecha del sello.
- [ ] **No toca la cadena:** el SHA-256 de todas las columnas de `invoices`, `invoice_anulaciones` y `verifactu_registros` es **idéntico** antes y después de una pasada completa del barrido **que sí haya anclado**; y `git diff --name-only master..HEAD` no incluye `modules/erp/routes/invoices.js`, `modules/erp/verifactu.js`, `modules/erp/verifactu-envio.js` ni `modules/erp/verifactu-cola.js`.
- [ ] **Se ve sin abrir el código:** `/admin/verifactu/anclajes` y `/superadmin/integridad` responden **200 con su URL final**, la primera muestra el veredicto de la última auditoría completa en palabras, y el correo diario lleva ese veredicto con su cobertura, el `.tsr` adjunto y **`⚠️ ALARMA` en el asunto** si algún negocio sale en alarma.

---

## LA PROMESA

Cada factura que emitas queda **sellada por un tercero de fuera** a los pocos minutos: un servicio
independiente de sellado de tiempo, que no somos nosotros y que no controlamos. Si mañana alguien con
acceso al servidor cambiara un importe, **se podría demostrar desde fuera que se tocó**. Hoy no se
podría: la cadena se recalcula sola y vuelve a cuadrar.

Fuera del servidor solo sale una huella ilegible. **Ni un nombre, ni un NIF, ni un importe, ni un
dato de tus clientes** sale de aquí.

Y una cosa más, que es lo que he cambiado en esta versión: **cuando el programa no pueda comprobarlo,
te lo dirá en lugar de decirte que todo está bien.** Ni «he mirado unos cuantos», ni «no he podido
mirar» disfrazado de «correcto». Solo dice que tus facturas están intactas cuando ha comprobado
**todos** los sellos, uno a uno, y te dice cuántos ha mirado y cuándo.

Si el sellado falla, la factura se emite igual y el sello se reintenta: **nunca te impide facturar.**
Esto no sustituye a mandarle las facturas a Hacienda: es lo que las protege mientras ese envío está
apagado, y también protege a las antiguas, que no van a ir nunca.
