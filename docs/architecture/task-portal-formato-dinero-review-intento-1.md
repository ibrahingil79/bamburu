❌ RECHAZADO

# Revisión — `portal-formato-dinero`

- **Analizado:** `docs/architecture/task-portal-formato-dinero-analysis.md`
- **Informe del constructor:** `docs/architecture/task-portal-formato-dinero-informe.md`
- **Commits revisados:** `bfea8a8` (la entrega) · `d93125e` (el hash en el TABLERO), sobre
  `b1f8770..HEAD`
- **Fecha de la revisión:** 1 sep 2026

**Resumen en una línea:** el arreglo está bien construido —las siete escrituras a mano pasan por
`fmtEur`, no nace ningún formateador nuevo, el instrumento aprende a llegar al portal y la aserción
floja queda apretada—, pero **dos de los ocho criterios de aceptación no están cumplidos**: el
barrido sale con **1 ✗ y código 1**, y el gate de navegador **no se ha ejecutado**. Ninguno de los
dos fallos lo causa el código entregado, y eso está escrito abajo con su medida; pero un criterio en
NO es un rechazo, y aquí hay dos. Lo que hace falta para cerrarlo **no cabe dentro de los seis
ficheros que el propio criterio 8 permite tocar**, así que la vuelta siguiente empieza por una
decisión de alcance, no por más código.

---

## 1. Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | `grep -c toFixed modules/portal/index.js` = 0, importa `fmtEur` de `../erp/margen.js`, y ningún formateador propio en `modules/portal/` | **SÍ** | Ejecutado por mí: `grep -c toFixed` → `index.js` **0**, `admin.js` **0**, `portal.js` **0**. `modules/portal/index.js:11` → `import { fmtEur } from '../erp/margen.js';`. `grep -rnE "(const\|let\|var)\s+\w+\s*=.*(sym\|SYM).*toFixed" modules/portal/` → **vacío**. Grafo de módulos comprobado: `modules/erp/margen.js` no tiene ni un `import` (`grep -n "^import"` → vacío) y `voz.js:1` ya lo cargaba, así que el import nuevo no crea ciclo |
| 2 | `GET /portal/<token>` de un cliente con factura > 1.000 € escribe su total `60.493,95 €`, sin `/[€$£] ?-?\d/` ni `/-?\d+\.\d{2}\s*[€$£]/` en el texto visible | **SÍ** | Las 7 interpolaciones de dinero pasan por el alias (`index.js:63, 64, 85, 86, 93, 96, 119`) y no queda ningún literal de moneda suelto en el módulo (`grep -n "€\|sym" modules/portal/` → solo el alias, los comentarios y esas 7). Evaluado `fmtEur` en Node 22 con los valores reales: `fmtEur(60493.95,'€')` → `"60.493,95 €"`, códigos de carácter `54,48,46,52,57,51,44,57,53,32,8364` — punto de millar, coma decimal, **espacio ASCII 32** y símbolo detrás. El informe lo mide además sobre el HTML servido (§3.1): 10 importes, 0 con símbolo delante, 0 con punto decimal |
| 3 | Las tres tarjetas, la tabla «Por año» y el subtítulo, **todos** en ese formato; ninguna cifra queda fuera | **SÍ** | Cada uno por su línea: tarjeta «en total» `index.js:85`, «de media» `:86`, «Lo que más compras» `:93`, tabla «Por año» `:96`, subtítulo «Pendiente total» `:119`, tabla de facturas `:63` y píldora de pendiente `:64`. Las demás cifras de la pantalla no son dinero (`A.compras`, `dias(...)`, el `width` de la barra). Informe §3.1: `70.095,00 €`, `17.523,75 €`, `84.814,95 €`, `49.995,00 €` |
| 4 | `node scripts/verify-dinero-espanol.mjs` sale con **código 0 y 0 ✗**, con las dos aserciones nuevas y sin `NINGUNO` | **NO** | El propio informe (§3.2) declara **19 ✓ · 1 ✗ y salida 1**. Las cinco aserciones nuevas del portal están en verde, y la guarda contra el verde sobre nada informa importes reales (`84.814,95 € · 121,00 € · 12.100,00 €`), no `NINGUNO`. **Pero el criterio pide código 0 y 0 ✗, y no lo hay.** La causa la he verificado yo y es ajena: `modules/erp/routes/descuentos.js:163` mete el catálogo en un `<script>` con `JSON.stringify` sin escapar `</`, y `:179`, `:180`, `:216` son `marcador:'2026-09-01'`, `marcador:'2026-09-30'`, `marcador:'2027-08-23'` — placeholders dentro de ese bloque. El defecto está declarado en `TABLERO.md` **del commit base** (`git show b1f8770:TABLERO.md`, líneas 5971-5985), o sea es anterior a esta entrega |
| 5 | Marca de tiempo `24/08/2026 14:30` en `/portal/<token>` y en `/admin/portal/mensajes/<id>`, sin ISO, y **dígitos idénticos** a `created_at` | **SÍ** | `fechaHoraEs` (`modules/erp/voz.js:50-59`) es un `exec` de un regex y una concatenación de sus grupos: **no hay ninguna operación aritmética ni de zona horaria en el cuerpo**, así que los dígitos no pueden cambiar. Usado en `modules/portal/index.js:112` y `modules/portal/admin.js:64`. Informe §3.1: BD `2026-09-01 03:57:42` → pantalla `01/09/2026 03:57`. La tercera fecha ISO (`A.ultima`, `index.js:89`) también queda cubierta con `fechaEs` — ver §2 |
| 6 | `node scripts/gate-portal-ampliado.mjs` sale con **código 0 y 0 ✗**, y su aserción exige literalmente `600,00 €` | **NO** (la segunda mitad, SÍ) | **Segunda mitad, comprobada por mí:** `grep -n '600\[.,\]00' scripts/gate-portal-ampliado.mjs` → sin coincidencias, y `:118` es `ok(/600,00 €/.test(vista), …)`. Verificado que el literal casa con lo que produce el motor: `fmtEur(600,'€')` → `"600,00 €"` con espacio ASCII, y el gate normaliza con `\s+`→`' '`. **Primera mitad: el gate no se ha ejecutado.** Confirmada la causa, y es del entorno: `NoNewPrivs: 1` en `/proc/self/status` (bloquea el `cap_dac_override` que necesita `snap-confine`), y el Chrome de puppeteer es `ELF 64-bit … x86-64` en una máquina `aarch64` (`file ~/.cache/puppeteer/chrome/linux_arm-150.0.7871.24/chrome-linux64/chrome`, `uname -m` → `aarch64`). No hay constancia de sus ~35 aserciones |
| 7 | Sin residuo en `desarrollo-bamburu` y `verifyTenantInvoices` → `ok: true` | **SÍ** | El `finally` borra **por la marca**, no por los ids de la pasada (`verify-dinero-espanol.mjs:310-317`): `DELETE … portal_tokens WHERE token LIKE 'zz-dinero-portal-%'`, `DELETE … portal_mensajes WHERE texto LIKE 'ZZ dinero portal%'`, y restaura `visto_cliente=0` sobre la lista tomada **antes** de abrir el portal. Verificado que la restauración es la correcta: `marcarVisto(db, clientId, 'cliente')` (`portal.js:134-137`) pone `visto_cliente=1` para ese cliente, y es lo que se deshace. `noVistos` se declara con `let` fuera del `try` (`:131-133`), así que el `finally` lo ve aunque la pasada muera antes. Informe §3.3: los tres recuentos a 0 y `verifyTenantInvoices` → `{ ok: true, total: 919 }` |
| 8 | El diff toca **exactamente** los seis ficheros, y ni una línea de `modules/erp/routes/invoices.js` | **SÍ** | `git diff --name-only b1f8770..HEAD` → `TABLERO.md`, `modules/erp/voz.js`, `modules/portal/admin.js`, `modules/portal/index.js`, `scripts/gate-portal-ampliado.mjs`, `scripts/verify-dinero-espanol.mjs`. Seis, los seis nombrados, ninguno más. `modules/erp/routes/invoices.js` **no aparece**: el `toFixed(2)` de su línea 156, que es entrada del hash de la cadena, sigue intacto |

**6 de 8 en SÍ. Dos en NO: el 4 y la primera mitad del 6.** Ninguno de los dos es un fallo del
código entregado — el 4 es un defecto anterior y de otra pantalla, el 6 es que esta máquina no puede
abrir un navegador. Pero el criterio dice lo que dice, y el §6 del análisis avisa por escrito de que
**«entregar el gate sin correrlo es motivo de rechazo»**.

---

## 2. ¿Se construyó lo que decía el plano?

Sí, los seis pasos, y con dos desviaciones **declaradas** en el informe. Ninguna de las dos es motivo
de rechazo:

- **Paso 1** — `fechaHoraEs` en `modules/erp/voz.js:50-59`, al lado de `fechaEs`, con el comentario
  de deuda que el plano dictaba. `fechaEs` no se ha tocado (el diff solo añade líneas).
- **Paso 2** — el alias `dinero` está donde el plano decía (entre `denied` y `export function
  register`, `index.js:49`), escrito una sola vez, y las siete sustituciones son literalmente las de
  la tabla del §4.4 del análisis. En la 7 desaparece el `|| '€'` a mano, como se pedía, y en la 2 se
  gana el `escHtml` que faltaba.
- **Paso 3** — las dos marcas de tiempo, más una **tercera fecha ISO que el análisis no contaba**:
  `A.ultima` (`index.js:89`), que se pintaba cruda dentro de «desde la última». El informe la declara
  en su §2.1 con su motivo: sin ella, los criterios 4 y 5 —que prohíben **cualquier** `\d{4}-\d{2}-\d{2}`
  en el texto visible de esa pantalla— eran inalcanzables. Está dentro de un fichero que el plano ya
  nombra y usa el `fechaEs` que ese fichero ya importaba. **Corregir el plano por su propio criterio
  es lo correcto**, y queda escrito; no lo cuento como `FUERA-DE-ALCANCE`.
- **Paso 4** — el bloque del portal está donde el plano lo mandaba (dentro del `try`, tras el bucle
  de `/admin` y antes del bloque de correos), con la cabecera que explica los tres motivos de la
  ceguera y el aviso de que **el día que el portal lleve JavaScript esta medición deja de bastar**.
  La consulta del cliente excluye las tres marcas de gate. La limpieza va en el `finally` que ya
  existía, no en uno nuevo.
- **Paso 5** — hecho, con una segunda desviación declarada (informe §2.2): el comentario **no
  transcribe el regex viejo**, porque el criterio 6 exige que ese patrón no aparezca en el fichero y
  un comentario también es rastro. La lección se conserva entera y el propio comentario explica por
  qué no se transcribe. Es la lectura correcta del criterio.
- **Paso 6** — `TABLERO.md`: el cabo del §G queda **tachado** con su fecha y su commit (no borrado),
  la ficha del orquestador pasa a `hecha`, y entran **tres** hallazgos en Deuda técnica (los dos que
  el plano pedía más el rojo de `/admin/descuentos`). `CLAUDE.md` y `gates-mapa.mjs` no se tocan,
  como el plano instruía.

**Ficheros fuera del plano: ninguno.** El criterio 8 se cumple exactamente.

---

## 3. El nivel de construcción

No tengo reparos aquí. **`NIVEL-INSUFICIENTE` no aplica.**

- **Capa y patrón.** El formato vive donde ya vivía en el resto del producto: la vista. El motor
  (`modules/portal/portal.js`) sigue devolviendo números y no se ha tocado — lo que mantiene viva la
  comparación `r.pendiente < r.total` de `index.js:64`, que es exactamente lo que el §3.2 del
  análisis señalaba que se rompería en silencio si el motor devolviera texto.
- **Ninguna pieza nueva.** El alias `dinero` sigue el patrón ya escrito tres veces en la casa
  (`contabilidad-routes.js:33`, `avisos.js:432`, `rentabilidad.js:34`). No nace un segundo
  formateador ni en servidor ni en navegador, que era la alternativa 1 descartada.
- **Nada a mano donde debería haber configuración.** El símbolo sale de la BD
  (`invoices.currency_symbol`, `analiticaCliente.sym`), con un único `|| '€'` centralizado en el
  alias en vez de repartido.
- **Se puede repetir sin duplicar efectos.** El bloque nuevo del barrido siembra con prefijo fijo
  (`ZZ dinero portal`, `zz-dinero-portal-`) **y sufijo aleatorio por pasada**, y borra por el
  prefijo: una pasada que muera a mitad la limpia la siguiente. Es literalmente la regla de
  `CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra», y además **no escribe ni una fila de
  `invoices`**, así que no puede generar el residuo imborrable que costó 130 clientes archivados.
- **Se puede probar por partes.** `fechaHoraEs` y `fmtEur` son funciones puras verificables sueltas
  —lo he hecho—, y el bloque del portal se aísla del resto del barrido.
- **Los errores se distinguen.** El bloque tiene su guarda propia (`ok(false, 'hay un cliente con
  facturas al que abrirle el portal', 'ninguno — esto no ha medido nada')`) y la guarda contra el
  verde sobre nada, que es lo que faltó en el gate de referencia. `node --check` OK en los cinco
  ficheros de código.

---

## 4. Qué se rompe

- **La cadena de VERI\*FACTU: intacta.** El riesgo grande del §5.1 está mitigado por el camino
  correcto —no tocar el fichero—, y lo confirma el criterio 8: `modules/erp/routes/invoices.js` no
  aparece en el diff.
- **Datos existentes:** no hay migración, ni columna, ni tabla, ni `DROP`. El producto no escribe
  nada nuevo; las dos únicas escrituras son del barrido y las dos se deshacen.
- **Riesgo 5.2 (falso positivo de `SIMBOLO_DELANTE`):** no se ha materializado; el informe reporta
  0 coincidencias sobre el HTML servido, y el instrumento **no se aflojó** para conseguirlo, que era
  la forma de fallo a vigilar.
- **Riesgo 5.3 (escribir en la conversación de un cliente real):** mitigado con las tres capas del
  plan, y verificado en el código (§1, criterio 7).
- **Monedas distintas del euro:** un `$` pasaría a `1.234,56 $` — comprobado evaluando
  `fmtEur(1234.56,'$')`. Es lo que la regla quiere, y no hay ningún caso real.
- **Lo que sigue roto y no lo arregla esta tarea, con su nombre:** la hora del chat sigue en UTC
  (escrito en el código y en el TABLERO), `/admin/invoices` sigue pintando dinero inglés desde JS, y
  `/admin/descuentos` sigue poniendo el barrido en rojo. Los tres están declarados.

---

## 5. Motivos de rechazo

### [SIN-PRUEBAS] El gate `gate-portal-ampliado` no se ha ejecutado: el criterio 6 no tiene constancia

**Dónde:** `scripts/gate-portal-ampliado.mjs` (fichero entero) · criterio de aceptación 6, primera
mitad.

**Qué pasa:** la aserción cambiada está bien y la he verificado sin navegador —`/600,00 €/` casa
exactamente con lo que produce `fmtEur(600,'€')`, y del regex viejo no queda rastro en el fichero—,
pero **de las ~35 aserciones del gate no consta ni una**. El informe (§4) declara que corrió hasta
10 ✓ · 0 ✗ y murió al abrir el navegador. He confirmado la causa y es del entorno, no del producto
ni del gate: `NoNewPrivs: 1` en `/proc/self/status` impide el `cap_dac_override` que necesita
`snap-confine`, y los Chrome de `~/.cache/puppeteer/chrome/linux_arm-150.0.7871.24/` son binarios
`x86-64` en una máquina `aarch64`. Es **el mismo bloqueo que rechazó `pantalla-403-ventanita`
intento 1**, y el §6 del análisis avisa por escrito de que entregar el gate sin correrlo es motivo de
rechazo.

**Qué hay que hacer:** no vuelvas a intentarlo a ciegas en esta máquina — está medido que no puede.
Hay dos salidas y **las dos son decisión de Ibrahin, no tuya**; pídesela con estas dos opciones
puestas encima de la mesa:

1. **Una ejecución autorizada en una sesión que sí pueda abrir el navegador** (sin `NoNewPrivs`), y
   pegar su salida completa: recuento `N ✓ · M ✗` y código de salida. Avisa al pedirla de lo que tú
   mismo ya mediste: su bloque [2] escribe por el formulario del portal y los 7 negocios de esta
   máquina están en `status='suspended_admin'` con `readOnlyGuard` montado antes de la
   autenticación, así que **ese bloque caerá igual** por una causa anterior y ya declarada en el
   TABLERO — con lo que el criterio 6 tampoco se cumpliría tal y como está escrito.
2. **Declarar el gate donde la casa declara los gates que no puede correr**, con fecha y motivo:
   `scripts/run-gates.mjs` (`DEUDA` / `ROJOS_CONOCIDOS`, líneas 100-150), que es lo que lee el
   barrido. Esto **toca un fichero que el criterio 8 no permite**, así que necesita que se amplíe el
   alcance explícitamente antes de escribir una línea.

En cualquiera de los dos casos, **la entrega no puede afirmar el criterio 6**: o trae la salida, o
trae la declaración, o queda dicho que se cierra con el criterio 6 retirado por decisión del dueño.

### [CRITERIO-INCUMPLIDO] El barrido sale con 1 ✗ y código 1, y el rojo no está declarado donde el barrido lo lee

**Dónde:** `scripts/verify-dinero-espanol.mjs:332` (`process.exit(fail === 0 ? 0 : 1)`) · criterio de
aceptación 4 · causa en `modules/erp/routes/descuentos.js:163`, `:179`, `:180`, `:216`.

**Qué pasa:** el criterio pide **código 0 y 0 ✗**; la entrega da **19 ✓ · 1 ✗ y código 1**. El ✗ es
la aserción agregada *«ninguna pantalla enseña una fecha en formato inglés»*, y he verificado que la
causa es real, anterior y ajena a esta tarea: `descuentos.js:163` escribe el catálogo dentro de un
`<script>` con `JSON.stringify` **sin escapar `</`**, y `:179`, `:180`, `:216` son
`marcador:'2026-09-01'`, `marcador:'2026-09-30'` y `marcador:'2027-08-23'`, que solo pueden llegar al
texto visible si ese bloque se cierra antes de tiempo. El defecto ya estaba declarado en el
`TABLERO.md` **del commit base** (líneas 5971-5985), con su disparador: el producto `2097` de ese
negocio lleva `</script>` en el nombre desde el 25 ago 2026.

Que la causa sea ajena no cierra el criterio, y hay algo que sí está sin hacer y sí es de esta
entrega: **el rojo se ha apuntado en `TABLERO.md` §Deuda técnica, pero no en `ROJOS_CONOCIDOS`**
(`scripts/run-gates.mjs:123`), que es donde la casa declara *«el rojo de un gate que SÍ se ejecuta,
anterior y de otro tema, para que salga por su nombre en cada barrido en vez de perderse entre los
demás»*. Hoy ese diccionario está vacío, así que el próximo barrido —rápido y completo, porque este
script va en los dos— cantará `verify-dinero-espanol` en rojo **sin dueño y sin motivo**, que es
exactamente el «rojo anónimo es ruido» que ese mecanismo existe para evitar.

**Qué hay que hacer:** no toques `descuentos.js` ni borres filas del negocio vivo por tu cuenta —lo
primero lo prohíbe el criterio 8 y lo segundo obliga a parar y preguntar—. Lleva a Ibrahin estas dos
opciones y construye la que elija:

1. **Declarar el rojo donde se lee:** añadir a `ROJOS_CONOCIDOS` en `scripts/run-gates.mjs` una
   entrada `'verify-dinero-espanol'` con **su fecha (1 sep 2026) y su motivo** —los tres números de
   línea de `descuentos.js` y el producto `2097`—, siguiendo el formato de las entradas retiradas que
   siguen ahí de ejemplo. Y reescribir el criterio 4 como «0 ✗ **salvo el rojo declarado**». Ojo:
   `run-gates.mjs` **no está entre los seis ficheros del criterio 8**, así que hace falta que se
   amplíe el alcance por escrito antes.
2. **Cerrar la causa en su propia tarea:** escapar `</` en el `JSON.stringify` de `descuentos.js:163`
   y limpiar el residuo de gate del producto `2097`. Eso es **otra tarea, con su encargo** — es el
   mismo hallazgo que ya está abierto en el TABLERO desde `pantalla-403-ventanita`.

Sea cual sea, la entrega tiene que volver con **el criterio 4 en SÍ o con el criterio 4 reescrito por
decisión del dueño**, no con un ⚠️ en la tabla.

---

## Observaciones (no bloquean)

1. **`tokP` se declara y se asigna, pero el `finally` no lo usa.** `verify-dinero-espanol.mjs:133` y
   `:198`: el borrado va por `LIKE 'zz-dinero-portal-%'`, que es lo correcto (limpia también lo de
   una pasada muerta), así que la variable solo hace falta para componer la URL dentro del `try`. El
   comentario de `:131-133` dice que se declara fuera «para que el `finally` los vea», y eso solo es
   cierto de `noVistos`. Es una línea de ruido, no un defecto.
2. **`TABLERO.md` (commit `d93125e`) apunta a
   `docs/architecture/task-portal-formato-dinero-informe.md`, que no está versionado** (`git status`
   lo da como `??`). El fichero existe en disco y el registro es correcto, pero un puntero desde un
   fichero commiteado a otro que no lo está es exactamente el «puntero rancio» del que avisa
   `run-gates.mjs`. Si la costumbre es que ese doc lo commitee el orquestador, no hay nada que hacer;
   si no, conviene decirlo.
3. **La tarjeta del ritmo dice «cada hoy mismo» con `cadaDias = 0`.** Lo apunta el propio informe
   (§3.1) y hace bien en no tocarlo: es de `analiticaCliente`, anterior y de otra pieza. Merece un
   cabo en el TABLERO, que hoy no tiene.
4. **La ampliación del barrido acierta en lo que más importaba de esta tarea**, y conviene que quede
   dicho: el defecto llevaba desde antes del 23 ago con una comprobación verde encima porque el
   portal estaba **fuera de su alcance por construcción**. La cabecera del bloque nuevo deja escrito
   el aviso que lo mantiene honesto —*el día que el portal lleve JavaScript, esta medición con
   `fetch` deja de bastar*—, que es justo la clase de nota que faltó las otras dos veces que este
   repo pagó esta lección.
