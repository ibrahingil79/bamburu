❌ RECHAZADO

# Revisión — Anclar la cadena de VERI*FACTU fuera del servidor

- **taskId:** `anclar-verifactu-fuera`
- **intento:** 3
- **rama:** `tarea/anclar-verifactu-fuera` · commits `e3bfd1f` + `5e3d957` + `e381d1b`
- **base del diff pedida:** `5e3d957` (o sea, el delta de `e381d1b`, que es el arreglo de los tres
  puntos del intento 2). Juzgo el delta **y** vuelvo a medir los ocho criterios sobre el trabajo
  entero, porque el delta toca justo la función que sostiene LA PROMESA.
- **fecha:** 1 sep 2026

Lo que he ejecutado para escribir esto, y con qué permiso:

| Qué | Autorización |
|---|---|
| `node scripts/verify-verifactu-anclaje.mjs` — **UNA** pasada | La caja de arriba del análisis, §«LO QUE ESTA TAREA NECESITA EJECUTAR», punto 3 |
| Dos sondas propias en `/tmp/rev-anclaje/` (BD de usar y tirar creada desde cero con `runMigrations`, dos facturas escritas a mano): una monta `createVerifactuAnclajeRoutes` en un Hono pelado y pide la pantalla, otra llama a `verificarAnclajes` con anclajes fabricados | Necesarias para juzgar los criterios 1, 2 y 8 con el código NUEVO: el proceso `bamburu` en marcha arrancó a las **03:56** y los ficheros son de las **19:32**, así que sirve código anterior a este cambio |
| Render de `/superadmin/integridad` en proceso aparte, **solo GET** | Criterio 8. **No he lanzado `POST /superadmin/integridad/run`**: eso escribe en `control.db` y no hace falta para ver la columna |

**No he reiniciado `bamburu.service`** — esta tarea tiene que quedarse fuera de producción hasta que
Ibrahin firme. **No he lanzado ningún `scripts/run-gates.mjs`**, ni corto ni completo: el análisis
dice expresamente que esta tarea no lo pide ni lo autoriza. **No he tocado ninguna base de negocio**:
las sondas van sobre ficheros nuevos en `/tmp`, ya borrados. No he repetido la ida y vuelta contra una
TSA pública: se hizo una vez en el intento 2 y salió bien; el análisis autoriza **una**.

---

## 1. Criterios de aceptación (§6 del análisis)

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | Apagado por defecto y sincero: sin `VERIFACTU_ANCLAJE_TSA`, `motivoAnclajeInactivo()` devuelve motivo en texto, `anclar()` no inserta fila, emitir factura sigue funcionando, y `/admin/verifactu/anclajes` responde 200 con URL final mostrando ese mismo motivo | **SÍ** | Gate bloque [1] (`✓` los cuatro): motivo «No hay ninguna autoridad de sellado configurada…», factura emitida, `COUNT(*) verifactu_anclajes` = 0. Pantalla con el código NUEVO, renderizada por mí: `status=200`, `location=null` (sin redirección), 151.047 bytes, contiene «Sellado externo», «Nunca se ha sellado nada» **y el motivo literal** |
| 2 | El sello se verifica ANTES de guardarse: token con un byte alterado → `estado='fallo'`, error y `token` NULL; token bueno → `estado='sellado'` y `openssl ts -verify` sobre lo guardado da `Verification: OK` | **SÍ** | Gate bloque [3]: `r3.anclado===false`, fila `secuencia=0` con `token===null`, y sigue habiendo un único sellado. Bloque [2]: `openssl ts -verify -digest <raiz> -in <token guardado> -CAfile <ca>` → `Verification: OK`. Sin cambios en `sellar()` en este intento (`git diff 5e3d957..HEAD` no toca las líneas 93-148) |
| 3 | Caza al atacante: sobre una copia, cambiar el `total` y recalcular toda la cadena con `calcHash` deja `verifyTenantInvoices` en `ok:true` y `verificarAnclajes()` en `ok:false` nombrando anclaje y fecha | **SÍ** | Gate bloque [4], `0 ✗`: la cadena propietaria recalculada da verde y `verificarAnclajes` da ROJO con «se ha tocado material fiscal ya sellado», con `secuencia` y `sellado_at`. *(Ojo: el criterio se cumple **tal y como está escrito**; el atacante que además borra los tokens NO se caza — ver el punto de rechazo)* |
| 4 | Un hueco se ve: borrar una fila que no sea la última → `ok:false` por rotura de `raiz_anterior` o de la sucesión | **SÍ** | Gate bloque [5]: `DELETE … WHERE secuencia=2` sobre la copia → `ok:false`, motivo «falta un anclaje: la cadena de raíces está rota» |
| 5 | No toca la cadena: SHA-256 de `invoices` + `invoice_anulaciones` + `verifactu_registros` idéntico antes y después de una pasada completa; y el `git diff` de la rama no incluye los 4 ficheros de la familia Verifactu | **SÍ** | Gate bloque [6]: pasada real del barrido (`spawn`) que **sí ancló** (4→5 anclajes) y `c0d48728ec44e2a6… vs c0d48728ec44e2a6…`. `git diff --name-only master..HEAD` = 13 ficheros: ninguno es `invoices.js`, `verifactu.js`, `verifactu-envio.js` ni `verifactu-cola.js` |
| 6 | Solo sale una huella: los bytes del `application/timestamp-query` que recibe la TSA no llevan NIF, número de factura, nombre de cliente ni importe | **SÍ** | Gate bloque [7], sobre los **buffers capturados** por el servidor de mentira: 5 peticiones × 7 agujas = 35 `✓`. Ninguna contiene `B87654321`, `B12340000`, `Cliente Secreto Anclaje`, `F2026-0001`, `1234.56`, `1234,56` ni `Servicio secreto` |
| 7 | El gate existe, levanta su propia TSA local, ejercita los ocho bloques y sale con código 0; con el token manipulado o la factura alterada sale con código 1 | **SÍ** | Pasada de esta revisión: los ocho bloques (más [2c] y [8b], nuevos) corren contra la TSA local y dan **`69 ✓ · 0 ✗`**. `EXIT=1`, y el motivo NO es una aserción caída: son los **3 ⚠ NO VERIFICADO** de las pantallas servidas, que exigen reiniciar el servicio —lo que esta tarea no puede hacer— y que la regla de salida exigida en el intento 2 ahora sí cuenta. Esos tres puntos los he verificado yo mismo fuera del servicio (criterios 1 y 8 de esta tabla), así que **no queda nada del gate sin ejercitar**. La segunda mitad la cumple por construcción: los bloques [3] y [4] mutan de verdad y afirman que el producto lo nota |
| 8 | El estado se ve sin abrir el código: la pantalla dice «último sello: `<fecha>`» o «Nunca se ha sellado nada»; `/superadmin/integridad` responde 200 con su URL final y muestra la columna «Sellado»; el correo diario lleva raíz, hora y `.tsr` adjunto, con `⚠️ sin sellar` si algún negocio con facturas no tiene anclaje | **SÍ** | Pantalla nueva, mis dos renders: sin anclajes → «Nunca se ha sellado nada»; con anclaje fresco y TSA puesta → «**Sellado externo activo.** Último sello: … (secuencia 1)» y ya no dice lo otro. Superadmin renderizado por mí: `status=200`, `location=null`, `<th>Sellado</th>` presente y **27 filas con «sin anclar»** (correcto: hoy no hay ni un anclaje en producción). Correo: `bamburu-anclaje-verifactu.mjs:120-145` compone raíz + `sellado_at` + `tsa_url`, adjunta `ultimo.token` como `.tsr` y pone `· ⚠️ sin sellar` en el asunto; verificado por lectura y por la pasada del gate (`correo diario: NO enviado: API key is invalid`, o sea llegó hasta Resend con la clave falsa de la prueba) |

**Los ocho criterios en SÍ.** El rechazo no viene de la tabla: viene de un agujero en la única función
que contesta la pregunta de la tarea, que la tabla no mide porque nadie lo escribió como criterio.

---

## 2. ¿Se arregló lo que decía el intento 2? ¿Se desvió algo?

Los tres puntos del intento 2, medidos:

| Punto del rechazo anterior | Estado |
|---|---|
| La pantalla reverificaba toda la cadena en cada carga | **ARREGLADO, y medido.** El `GET` ya no llama a `verificarAnclajes` (`verifactu-anclaje-routes.js:50-51`), el `SELECT` ya no trae el BLOB `token` y va acotado (`:31-34`). Con **105 anclajes** en mi sonda: **GET en 13 ms**, 100 filas pintadas y la nota «Mostrando los últimos 100 de 105». Con el código del intento 2 eso eran ~1,0 s de proceso bloqueado |
| El botón «Comprobar ahora» heredaba el mismo bloqueo | **ARREGLADO.** `POST` va con `{ limite: ANCLAJE_COMPROBAR_LIMITE }` (`:94`), límite configurable por entorno (`verifactu-anclaje.js:39`) y escrito en `docs/verifactu/anclaje-externo.md:122-129`. Medido con 105 anclajes: **POST en 9 ms** |
| Sin `VERIFACTU_ANCLAJE_TSA_CA` el juez decía «cuadra» | **ARREGLADO para el caso que se pidió.** Tercer estado explícito `ok: null` + `sinComprobar` (`verifactu-anclaje.js:264-268, 287`) y la pantalla lo pinta en **ámbar**, nunca en verde. Verificado por mí extremo a extremo: `POST` sin CA → `?comprobado=1&ok=sc&n=1&sc=1` → el HTML contiene «NO se ha podido comprobar» y **no** contiene `<b>cuadra</b>` |
| El gate salía en verde con criterios sin verificar | **ARREGLADO.** `process.exit(fail === 0 && (sinVerificar === 0 \|\| admiteSinVerificar) ? 0 : 1)` (`verify-verifactu-anclaje.mjs:408`), con la variable explícita e impresa. Medido: `3 ⚠` → `EXIT=1` |

**Alcance:** los 13 ficheros de `git diff --name-only master..HEAD` son exactamente los que el análisis
nombra. `verifyTenantInvoices` **no se ha tocado** (su SHA sigue siendo línea base de
`gate-cadena-integridad.mjs`). `git ls-tree master | grep anclaje` → **0**: la pieza sigue fuera de
producción, como manda la ficha. Sin `confirm()`/`prompt()`/`alert()` en los ficheros nuevos.

---

## 3. Por qué se rechaza

Un solo punto, y es el mismo defecto de familia que ya tumbó el intento 2 — pero por la otra mitad
del mismo `if`, que se quedó sin mirar al arreglarlo.

### [NIVEL-INSUFICIENTE] Un anclaje `sellado` **sin token** pasa por verificado: el juez dice «cuadra» sobre una cadena de sellos que no existe

**Dónde:** `modules/erp/verifactu-anclaje.js:257` (`if (f.token) {`), con su consecuencia en `:287-288`

**Qué pasa:** el intento 2 arregló *«no hay CA para comprobar el token»* → `ok: null`. Pero la
condición exterior sigue siendo `if (f.token)`: si la fila **no tiene token**, no se verifica nada,
**no se cuenta como `sinComprobar`** y el bucle sale con `ok: true`. «No hay sello» y «el sello está
comprobado y es válido» contestan lo mismo, en verde.

Medido hoy, sobre una BD de usar y tirar y con `VERIFACTU_ANCLAJE_TSA_CA` **puesta** (o sea, sin la
excusa de la variable ausente):

```
A) token BASURA presente, CA puesta   -> ok=false · "el sello no es válido: Verification: FAILED"
B) MISMO anclaje con token = NULL     -> ok=true  · sinComprobar=0 · alarma=null
```

Y el ataque completo, que es lo que lo hace grave. Todo lo que necesita quien tenga el fichero `.db`
—ninguna clave, ningún secreto, todo el algoritmo está en el repo—:

```
C0) 2 anclajes, material intacto, tokens presentes     -> ok=false (los tokens de la sonda son basura)
    · cambia el total de la factura 1 y su verifactu_hash / prev_hash
    · recalcula la raíz de los 2 anclajes con raizCanonica() y re-encadena raiz_anterior
    · UPDATE verifactu_anclajes SET token = NULL
C)  DESPUÉS del ataque                                  -> ok=true · comprobados=2 · sinComprobar=0
```

Es exactamente lo que la tarea existe para impedir, y sale **verde por los tres sitios a la vez** que
el §5.8 del análisis presenta como la red de seguridad: la pantalla pinta «**Sellado externo
activo.** Último sello: …» (el cartel solo mira frescura, `verifactu-anclaje-routes.js:38-42`), el
botón «Comprobar ahora» contesta «la cadena de sellos **cuadra** (2 anclaje(s) comprobado(s), sin
huecos)» y `/superadmin/integridad` enseña la fecha del último anclaje en su columna. Los tres mienten
a la vez porque los tres preguntan a la misma función.

Y no es equivalente a borrar el anclaje, que sí está cubierto: si el atacante **borra** la fila, salta
el hueco de secuencia (criterio 4) o el cartel pasa a «Nunca se ha sellado nada». Si le **vacía el
token**, no salta nada. Esa asimetría es el agujero.

Es el mismo párrafo que el propio módulo se escribe en `:121` —*«Un sello que no verifica es peor que
ninguno: cierra la pregunta»*— y la lección del censo de ventanitas de `CLAUDE.md`: *un censo que dice
CERO y no es cierto es peor que no tenerlo, porque cierra la pregunta*.

**Qué hay que hacer:** en `verificarAnclajes`, una fila con `estado='sellado'` y `token` nulo es una
**alarma**, no un paso limpio. Concretamente, sustituir `if (f.token) { … }` por algo con las tres
salidas distinguidas:

1. `if (!f.token)` → `alarma = { secuencia: f.secuencia, sellado_at: f.sellado_at, motivo: 'la fila dice sellada y no tiene sello: el token no está' }` y `break`.
2. `else if (hayCa)` → lo que ya hace (verifica, y alarma si falla).
3. `else` → `sinComprobar++`, como ya hace.

No hay falsos positivos posibles: `anclar()` escribe `estado='sellado'` y `token` bajo **la misma**
condición `sello.ok` (`verifactu-anclaje.js:214`), y `sellar()` solo devuelve `ok:true` con el buffer
de la respuesta, así que un `sellado` sin token **no lo produce nunca el producto**: solo lo produce
alguien tocando la base, que es justo el atacante de esta tarea.

Añade además un bloque al gate junto al [2c] que ya hiciste —mismo patrón, cuatro líneas—: sobre una
copia, `UPDATE verifactu_anclajes SET token=NULL` y exigir `ok === false`. Y si quieres cerrar el caso
entero de una vez, el [4] del gate gana valor si el atacante, además de recalcular `calcHash`,
recalcula las raíces y borra los tokens: eso es lo que haría de verdad.

---

## 4. Qué se rompe (lo que he mirado y no bloquea)

- **La cadena de VERI\*FACTU:** intacta. Criterio 5 medido con SHA antes/después de una pasada que sí
  ancló, y ninguno de los cuatro ficheros intocables está en el diff.
- **Datos que ya existen:** la tabla es aditiva (`CREATE TABLE IF NOT EXISTS`, índice parcial), y
  `ultimoAnclajeDe` (`integridad.js:16-24`) abre en `readonly` con `try/catch` para las BD que aún no
  han migrado — las 27 filas del superadmin salen «sin anclar» sin un solo error.
- **Concurrencia:** un solo escritor (el barrido `oneshot`), la pantalla solo lee, el índice único
  sobre `secuencia > 0` como última red. El `POST /anclajes/comprobar` no escribe nada: comprobado
  sobre el `location` de la respuesta y sobre el contenido de la tabla tras pulsarlo.
- **Que la pieza se encienda sola al fusionar:** no puede. `motivoAnclajeInactivo` exige dos variables
  de `/etc/bamburu.env` y el timer no está instalado. `master` no tiene ni un fichero de esto.

---

## Observaciones (no bloquean)

- **Nada en el producto audita nunca los anclajes viejos.** El único camino vivo es el botón, y va
  siempre con `limite: 100`; en modo acotado la primera fila del lote se acepta tal cual
  (`verifactu-anclaje.js:235-236`), así que **borrar un anclaje anterior a la ventana no se ve jamás**.
  Acotar el botón es correcto y es lo que pedía el intento 2 — lo que falta es que **alguien** recorra
  la sucesión entera alguna vez. El sitio natural y gratis ya existe: `mandarCorreoDiario()` ya abre
  cada negocio una vez al día y fuera de la ruta HTTP; un `verificarAnclajes(db)` sin límite ahí, con
  su resultado en el correo, cierra el hueco sin volver a poner nada pesado delante de una pantalla.
  (Y de paso evita repetir en esta pieza la avería que el §1.3 del análisis le reprocha a
  `integridad.js`: un verificador que existe y no mira nunca.)
- **El motivo que va en la URL es la salida cruda de `openssl`.** Con un token malo, el `redirect`
  lleva `motivo=anclaje 1: el sello no es válido: Verification: FAILED%0AUsing configuration from
  /usr/lib/ssl/openssl.cnf%0A20F02C…:error:0680008E:asn1 encoding routines…`. Se pinta escapado, así
  que no rompe nada, pero al dueño de un negocio se le enseña un volcado de `asn1_d2i_read_bio`.
  Basta con quedarse la primera línea para la pantalla y dejar el resto en el registro.
- **`ANCLAJE_COMPROBAR_LIMITE` hace dos trabajos:** cuántos anclajes se auditan y cuántas filas se
  pintan. Hoy coinciden por casualidad; el día que alguien quiera auditar 500 y pintar 50 tendrá que
  partirlo. Dos constantes al lado cuestan una línea.
- **Sigue en pie lo que ya se dijo en el intento 2 y no se ha tocado** (todas menores): truncar la
  sucesión por el final no se ve hasta pasadas 48 h y conviene decirlo en «Qué NO prueba»;
  `estado DEFAULT 'pendiente'` no lo escribe ningún camino; `mandarCorreoDiario` no envuelve cada
  negocio en su propio `try` (un `.db` raro deja sin correo a todos); `verificarAnclajes` no acepta
  `opts.ahoraMs` y por eso el aviso de frescura no se puede probar sin esperar; y la marca del correo
  crece una fila por día en `settings`.
- **Lo que está bien resuelto y no conviene tocar al arreglar lo de arriba:** el cerrojo de estado del
  servidor (dos variables en `/etc/bamburu.env` + un timer que el orquestador no puede instalar), que
  es la lección del cifrado del 1 sep bien aplicada; el corte por `MAX(id)` en una sola transacción; y
  el bloque [7] del gate, que mide sobre los bytes que salen y no sobre la intención del código.
