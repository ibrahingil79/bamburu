❌ RECHAZADO

# Revisión — Anclar la cadena de VERI*FACTU fuera del servidor

- **taskId:** `anclar-verifactu-fuera`
- **intento:** 2
- **rama:** `tarea/anclar-verifactu-fuera` · commits `e3bfd1f` + `5e3d957`
- **base del diff:** `4d90cad` (el intento 1 lo tumbó el validador automático por `console.log`, no
  una revisión de criterios: esta es la primera lectura de fondo, así que juzgo el trabajo entero,
  no solo el delta de `5e3d957`).
- **fecha:** 1 sep 2026

Lo que he ejecutado para escribir esto, y con qué permiso:

| Qué | Autorización |
|---|---|
| `node scripts/verify-verifactu-anclaje.mjs` (una pasada) | La caja de arriba del análisis, §«LO QUE ESTA TAREA NECESITA EJECUTAR», punto 3 |
| Una ida y vuelta real contra `freetsa.org` con una raíz **aleatoria** | La misma caja, punto 2 («UNA vez… nunca con datos de un negocio») |
| Render de `/admin/verifactu/anclajes` y `/superadmin/integridad` en un proceso aparte, con BD de usar y tirar en `/tmp` | Necesario para juzgar los criterios 1 y 8: el proceso `bamburu` en marcha arrancó a las 03:56 y sirve código anterior a este cambio. **No he reiniciado el servicio**, porque esta tarea tiene que quedarse fuera de producción hasta que Ibrahin firme |
| El correo diario contra un sumidero HTTP local (`RESEND_BASE_URL`) | Necesario para el criterio 8. **No ha salido ningún correo real.** He borrado después las 3 filas de `correo_envios` y la marca de `settings` que crearon mis pruebas |

**No he lanzado ningún `scripts/run-gates.mjs`** — ni el corto ni el completo. El análisis dice
expresamente que esta tarea no lo pide ni lo autoriza.

---

## 1. Criterios de aceptación (§6 del análisis)

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | Apagado por defecto y sincero: sin `VERIFACTU_ANCLAJE_TSA`, `motivoAnclajeInactivo()` devuelve motivo en texto, `anclar()` no inserta fila, emitir factura sigue funcionando, y `/admin/verifactu/anclajes` responde 200 con URL final mostrando ese mismo motivo | **SÍ** | Gate bloque [1]: `motivoAnclajeInactivo` → «No hay ninguna autoridad de sellado configurada…»; `createInvoice` emite `F2026-0001`; `SELECT COUNT(*) FROM verifactu_anclajes` = 0. Pantalla, renderizada por mí fuera del servicio: `STATUS=200`, `REDIRECT-LOC=(ninguna)`, HTML de 151.068 bytes que contiene «Sellado externo», «Nunca se ha sellado nada» y el motivo literal. `/admin/verifactu/envios` sigue dando 200 bajo el mismo prefijo, así que el doble `admin.route('/verifactu', …)` de `routes/index.js:197-198` compone |
| 2 | El sello se verifica ANTES de guardarse: token con un byte alterado → `estado='fallo'`, error, `token` NULL; token bueno → `estado='sellado'` y `openssl ts -verify` sobre lo guardado da `Verification: OK` | **SÍ** | Gate bloque [3]: la TSA de mentira voltea el último byte (la firma RSA del CMS, `verify-verifactu-anclaje.mjs:134`) → `r3.anclado===false`, fila con `secuencia=0` y `token===null`, y sigue habiendo un único sellado. Bloque [2]: `openssl ts -verify -digest <raiz> -in <token guardado> -CAfile <ca>` → `Verification: OK` |
| 3 | Caza al atacante: sobre una copia, cambiar el `total` y recalcular toda la cadena con `calcHash` deja `verifyTenantInvoices` en `ok:true` y `verificarAnclajes()` en `ok:false` nombrando anclaje y fecha | **SÍ** | Gate bloque [4], sobre `copia-manipulada.db`: `verifyTenantInvoices` → `{"total":3,"ok":true,"alarm":null}`; `verificarAnclajes` → `{"secuencia":1,"sellado_at":"2026-09-01T19:18:58.000Z","motivo":"se ha tocado material fiscal ya sellado"}`. La mutación es real (UPDATE + recálculo de la cadena entera por serie/año), no simulada |
| 4 | Un hueco se ve: borrar una fila de `verifactu_anclajes` que no sea la última → `ok:false` por rotura de `raiz_anterior` o de la sucesión | **SÍ** | Gate bloque [5], sobre `copia-borrado.db` con 3 anclajes: `DELETE … WHERE secuencia=2` → `{"secuencia":3,…,"motivo":"falta un anclaje: la cadena de raíces está rota"}` |
| 5 | No toca la cadena: SHA-256 de `invoices` + `invoice_anulaciones` + `verifactu_registros` idéntico antes y después de una pasada completa; y el `git diff` de la rama no incluye los cuatro ficheros de la familia Verifactu | **SÍ** | Gate bloque [6]: pasada real del barrido con `spawn` → anclajes 4→5 (**sí ancló algo**, si no la prueba no probaría nada) y `af8310f5961d41ae… vs af8310f5961d41ae…`. `git diff --stat 4d90cad..HEAD`: 13 ficheros, ninguno es `invoices.js`, `verifactu.js`, `verifactu-envio.js` ni `verifactu-cola.js` |
| 6 | Solo sale una huella: los bytes del `application/timestamp-query` que recibe la TSA no llevan NIF, número de factura, nombre de cliente ni importe | **SÍ** | Gate bloque [7], sobre los **buffers capturados** por el servidor de mentira (5 peticiones × 7 agujas = 35 aserciones): ninguna contiene `B87654321`, `B12340000`, `Cliente Secreto Anclaje`, `F2026-0001`, `1234.56`, `1234,56` ni `Servicio secreto` |
| 7 | El gate existe, levanta su propia TSA local, ejercita los ocho bloques de §4.9 y sale con código 0; con el token manipulado o la factura alterada sale con código 1 | **SÍ** | Pasada de esta revisión: los ocho bloques corren y `RESULTADO: 63 ✓ · 0 ✗`, `EXIT=0`. La segunda mitad la cumple por construcción: los bloques [3] y [4] **mutan de verdad** (byte de la firma CMS, importe + recálculo de cadena) y afirman que el producto lo nota; si dejara de notarlo, esos `ok(...)` fallarían y el `process.exit` daría 1. *(Sobre el 0 con `⚠ NO VERIFICADO` presentes, ver el punto 3 del rechazo: es un defecto del instrumento, no de este criterio)* |
| 8 | El estado se ve sin abrir el código: la pantalla dice «último sello: `<fecha>`» o «Nunca se ha sellado nada»; `/superadmin/integridad` responde 200 con su URL final y muestra la columna «Sellado»; el correo diario lleva la raíz, la hora del sello y el `.tsr` adjunto, con `⚠️ sin sellar` en el asunto si algún negocio con facturas no tiene anclaje | **SÍ** | Pantalla, las dos ramas renderizadas por mí: sin anclajes → «Nunca se ha sellado nada»; con anclaje fresco y TSA configurada → `<b>Sellado externo activo.</b> Último sello: 1/9/2026, 19:25:28 (secuencia 1)…`. Superadmin: `STATUS=200`, `LOC=(ninguna)`, `<th>Sellado</th>` presente y celda «sin anclar». Correo, capturado en un sumidero local: con anclaje → asunto `Sellado externo Verifactu — 2026-09-01`, cuerpo `1 factura(s) · sello 2026-09-01T19:30:00.000Z · raíz RAIZDEPRUEBA… · TSA https://tsa.ejemplo/tsr`, `attachments:[{filename:"rev-correo-anclaje-1.tsr"}]`; sin anclaje → asunto `Sellado externo Verifactu — 2026-09-01 · ⚠️ sin sellar` |

**Los ocho criterios en SÍ.** El rechazo no viene de aquí.

---

## 2. ¿Se construyó lo que decía el análisis?

Sí, y sin desvíos de alcance. Los diez pasos del §4 están, uno por uno:

| Paso del plano | Estado |
|---|---|
| 1 · tabla `verifactu_anclajes` + índice parcial | `models.js:1604-1633`, aditiva, `CREATE TABLE IF NOT EXISTS`, ningún `DROP`, ninguna columna añadida a tabla existente. El índice es `UNIQUE … WHERE secuencia > 0`, como corregía §4.2.4.6 |
| 2 · `verifactu-anclaje.js` con las cinco funciones | `motivoAnclajeInactivo:45`, `raizCanonica:62`, `sellar:88`, `anclar:162`, `verificarAnclajes:216`. El formato de la raíz es literalmente el del §2.2 (cabecera `bamburu-anclaje-v1`, `raiz_anterior=`, topes por `id`, identidad de cada fila) |
| 3 · `scripts/bamburu-anclaje-verifactu.mjs` | Esqueleto de `bamburu-verifactu-cola.mjs`, `--dry-run`, correo diario con marca en `settings`, ping opcional a `ANCLAJE_HC_URL` |
| 4 · unidades systemd | `.service` + `.timer` (`OnBootSec=5min`, `OnUnitActiveSec=15min`, `AccuracySec=1min`, sin `Persistent`), y el README las marca **NO INSTALADA** |
| 5 · pantalla | `verifactu-anclaje-routes.js`, `requirePerm('invoices.read')`, sin `confirm()`/`prompt()`/`alert()` |
| 6 · montaje | `routes/index.js:198`, la opción A del plano; verificado que compone |
| 7 · menú | `menu.js:53` y `:262` |
| 8 · columna «Sellado» en integridad | `integridad.js:16-24` (`ultimoAnclajeDe`, readonly, `try/catch` para BD sin migrar) y `:75`/`:85`. **`verifyTenantInvoices` no se ha tocado** — su SHA sigue siendo línea base de `gate-cadena-integridad.mjs` |
| 9 · gate propio | `verify-verifactu-anclaje.mjs`, TSA local completa con `extendedKeyUsage=critical,timeStamping` y sección `[tsa]`, ocho bloques |
| 10 · documentación | `docs/verifactu/anclaje-externo.md` con «Qué prueba», «Qué NO prueba», «El formato exacto de la raíz» y «Las DOS órdenes de encendido»; README de systemd actualizado |

**Ficheros tocados:** exactamente los que el análisis nombra. Ni uno más.
**Fuera de producción:** `git ls-tree master | grep anclaje` → 0. Los dos commits solo viven en
`tarea/anclar-verifactu-fuera`. Correcto.

Y algo que el plano pedía ejecutar y de lo que no había constancia, así que lo he hecho yo:
**la ida y vuelta contra una TSA pública de verdad**. `sellar()` contra `https://freetsa.org/tsr`
con una raíz aleatoria (`DCA7C422…`) → `ok=true`, token de **4.642 bytes**, `selladoAt` puesto por
el reloj de la TSA (`2026-09-01T19:25:49.000Z`), verificado contra el raíz de FreeTSA. **El camino
existe fuera del laboratorio**, no solo contra el `openssl ts -reply` de mentira. Eso es una buena
noticia y la dejo escrita.

---

## 3. Por qué se rechaza

Tres puntos, todos de nivel de construcción. Ordenados por gravedad.

### [NIVEL-INSUFICIENTE] La pantalla reverifica TODA la cadena de sellos en cada carga, y congela el servidor entero

**Dónde:** `modules/erp/routes/verifactu-anclaje-routes.js:26` (y `:22`)

**Qué pasa:** el `GET /admin/verifactu/anclajes` llama a `verificarAnclajes(db)` en cada render. Esa
función (`verifactu-anclaje.js:225-251`) hace, **por cada anclaje sellado**: tres `SELECT` completos
de `invoices`, `invoice_anulaciones` y `verifactu_registros` hasta el corte (`raizCanonica`), más un
`mkdtemp` + `execFileSync('openssl', ['ts','-verify',…])` + `rm` (`verificarToken`).

Medido en esta máquina, sobre los datos reales de `desarrollo-bamburu` (923 facturas, 308
anulaciones, 1.231 registros — contados con `sqlite3 -readonly`):

- `raizCanonica` sobre ese material: **6,2 ms** (media de 50 pasadas)
- `mkdtemp` + `openssl ts -verify` + `rm`: **3,9 ms** (media de 50 pasadas)
- **10,1 ms por anclaje y por carga de pantalla**

Y eso multiplicado por cuántos anclajes habrá:

| Anclajes | Segundos por carga de pantalla |
|---|---|
| 100 | 1,0 s |
| 365 (**el suelo**: solo el latido diario de §4.2.3, 24 h) | 3,7 s |
| 1.000 | 10,1 s |
| 5.000 | 50,6 s |

365 al año es el **mínimo teórico**, el del negocio que no factura nunca. Con el timer cada 15 min
y `subioAlgo` disparando con cualquier factura, anulación o registro nuevo (`verifactu-anclaje.js:184`),
un negocio que factura durante el día genera decenas de anclajes diarios.

Lo que lo convierte en un problema de producto y no de rendimiento: **better-sqlite3 es síncrono y
`execFileSync` bloquea el bucle de eventos**, y `index.js:1530` sirve todos los negocios, la tienda y
DISA desde un único `serve({ port: 3000 })`. No es que la pantalla vaya lenta: es que **mientras esa
pantalla se pinta, el producto entero está parado** para todo el mundo. Un usuario con el dedo en F5
es una caída.

Encima, `:22` hace `SELECT *` sin `LIMIT`, así que trae a memoria el BLOB `token` de **todos** los
anclajes (2.285 bytes con la TSA local, 4.642 contra freetsa.org — medidos los dos) para pintar una
tabla sin paginar que a los mil anclajes ya no se puede leer. Y `verificarAnclajes` vuelve a hacer el
mismo `SELECT *` por su cuenta.

Esto además **no es lo que decía el plano**. El §4.5 pone `verificarAnclajes` detrás del botón
«Comprobar ahora» (`POST /anclajes/comprobar`), y el cartel de estado lo calcula con
`motivoAnclajeInactivo` + la antigüedad del último sello — que es justo lo que hacen `:21` y `:28-29`,
sin necesitar nada más.

**Qué hay que hacer:**
1. Quitar la llamada a `verificarAnclajes(db)` de `:26`. El bloque `auditoria` de `:41-43` sale de
   ahí: se pinta solo tras pulsar el botón (ya existe el `flash` de `:45-50` para eso). El cartel de
   `:31-39` no la necesita.
2. En `:22`, no traer el token y acotar la tabla:
   `SELECT id, secuencia, raiz, raiz_anterior, sellado_at, created_at, n_facturas, cadena_ok, cadena_detalle, tsa_url FROM verifactu_anclajes WHERE estado='sellado' ORDER BY secuencia DESC LIMIT ?`
   (más un `COUNT(*)` aparte para el total). Ojo: el `SELECT *` de `verificarAnclajes:217` **sí**
   necesita el token; el de la pantalla, no.
3. Acotar también el `POST /anclajes/comprobar` de `:79`, o hereda el mismo bloqueo de 10 s: verificar
   los últimos N anclajes (N configurable, con el valor por defecto escrito en
   `docs/verifactu/anclaje-externo.md`) y decir en pantalla cuántos se han comprobado, o recorrerlos
   por lotes. Un botón que congela el servidor 50 s no se puede pulsar.

### [NIVEL-INSUFICIENTE] Sin `VERIFACTU_ANCLAJE_TSA_CA`, el juez se salta la criptografía y contesta «cuadra»

**Dónde:** `modules/erp/verifactu-anclaje.js:242`

**Qué pasa:** `if (caPath && f.token) { … }`. Si la variable de entorno no está puesta, **no se
verifica ni un solo token** y el bucle sale con `ok: true`.

Medido, con una BD de usar y tirar y un anclaje cuya `raiz` es la correcta (o sea, el material fiscal
está intacto) pero cuyo `token` es la cadena ASCII `"ESTO NO ES UN TOKEN RFC-3161"`:

```
SIN CA          -> ok=true
CON un CA real  -> ok=false · el sello no es válido: Verification: FAILED
```

Y lo que ve el dueño con la variable ausente:

- la pantalla imprime, **en verde**: «Comprobación de la cadena de sellos: **cuadra** (1 anclaje(s),
  sin huecos).» (`verifactu-anclaje-routes.js:42`)
- «Comprobar ahora» redirige a `?comprobado=1&ok=1` → «Comprobado ahora: la cadena de sellos cuadra.»

Es «un censo que dice CERO y no es cierto» de `CLAUDE.md`, y cae sobre la única función que sostiene
LA PROMESA. El propio módulo se escribe la regla en `:116` — *«Un sello que no verifica es peor que
ninguno: cierra la pregunta»* — y luego la pantalla cierra la pregunta con un verde que nadie ha
medido. El cartel de arriba estará en ámbar por `motivoAnclajeInactivo`, sí, pero el renglón de
debajo afirma en verde algo que no se ha comprobado, y es el renglón que contesta la pregunta.

No es un caso de laboratorio: la variable **no está** en `/etc/bamburu.env` hoy, y basta con que un
negocio llegue a tener anclajes y luego se pierda la variable (una edición mala del fichero de
entorno, una restauración, un servidor nuevo) para caer justo aquí. Nótese que si la variable está
puesta y el **fichero** falta, sí salta la alarma: el agujero es exactamente «variable ausente».

**Qué hay que hacer:** cuando haya filas `estado='sellado'` y no haya `caPath`, `verificarAnclajes`
no puede devolver `ok: true`. O devuelve alarma («no se puede comprobar el sello: falta
`VERIFACTU_ANCLAJE_TSA_CA`»), o devuelve un tercer estado explícito —`{ ok: null, sinComprobar: n }`—
que la pantalla pinte en ámbar como «sin comprobar» y que el `POST` de `:79` no traduzca a `ok=1`.
Verde, en ningún caso.

### [NIVEL-INSUFICIENTE] El gate sale con código 0 con criterios sin verificar

**Dónde:** `scripts/verify-verifactu-anclaje.mjs:383`

**Qué pasa:** `process.exit(fail === 0 ? 0 : 1)`. `sinVerificar` no entra en la cuenta. En la pasada
de esta revisión:

```
RESULTADO: 63 ✓  ·  0 ✗  ·  3 ⚠ NO VERIFICADO
⚠️  Hay criterios NO VERIFICADOS en esta pasada — no cuentan como pasados.
EXIT=0
```

Las tres saltadas son las que tocan pantalla servida ([1b], [2b] y `/superadmin/integridad`), porque
`servidorSirveCodigoFresco()` detecta que el proceso arrancó a las 03:56 y el código es de las 18:xx.
El script lo dice en palabras y acto seguido devuelve verde. Quien lo lea por su código de salida
—el validador del orquestador, un barrido, el próximo revisor— **no puede distinguir «los 63
comprobados» de «tres criterios no llegaron a ejecutarse»**. Es el mismo mecanismo del censo de
ventanitas: el instrumento cierra la pregunta sin haberla contestado.

La decisión de **no** abortar el gate entero (razonada en `:49-55`) es buena y se queda: tumbar los
bloques 2 a 8, que no necesitan el servidor, sería peor. Lo que no se puede quedar es el verde.

**Qué hay que hacer:** `process.exit(fail === 0 && sinVerificar === 0 ? 0 : 1)`. Si hace falta poder
correrlo sin sudo y aun así darlo por bueno, que sea una variable explícita
(`ANCLAJE_GATE_ADMITE_SIN_VERIFICAR=1`) que quede impresa en la salida: entonces el verde lo firma
quien la puso, no el instrumento.

---

## Observaciones (no bloquean)

- **Truncar la sucesión por el final no se ve hasta pasadas 48 h.** Borrar el anclaje del medio sí lo
  caza (criterio 4, probado), pero borrar los últimos deja `1, 2` sin hueco ni rotura de
  `raiz_anterior`, y la única red es `edadH > latidoH * 2` (`verifactu-anclaje.js:257`). Es el ataque
  clásico contra un registro de solo-añadir. La mitigación real ya existe y está bien pensada —el
  `.tsr` sale cada día por correo, así que hay copia fuera—, pero conviene que
  `docs/verifactu/anclaje-externo.md` lo diga con esas palabras en «Qué NO prueba», junto al límite
  del §5.9 que ya está escrito.
- **`estado TEXT NOT NULL DEFAULT 'pendiente'`** (`models.js:1620`): ningún camino escribe nunca
  `'pendiente'` — `anclar` siempre pone `'sellado'` o `'fallo'`. O se usa (fila insertada antes de
  llamar a la TSA, para que un corte a mitad deje rastro) o sobra el valor por defecto.
- **`mandarCorreoDiario` puede morir entero por un `.db` raro.** El bucle de
  `bamburu-anclaje-verifactu.mjs:95-120` no envuelve cada negocio en su propio `try`: si un fichero
  de `data/tenants/` no tiene la tabla (porque `runMigrations` falló antes para ese negocio en
  `procesar`), el `db.prepare` lanza y **no sale el correo de ningún negocio**. Queda un renglón en el
  log, pero el correo es una de las tres cosas que el §5.8 del análisis dice que tendrían que mentir a
  la vez. Un `try/catch` por negocio, como el que ya hay en `procesar`, lo cierra.
- **`verificarAnclajes` usa `Date.now()` para la frescura** (`:256`) mientras `anclar` acepta
  `opts.ahoraMs` (`:167`). Por eso el bloque [8] del gate puede probar el latido inyectando el reloj y
  nadie puede probar el aviso de «el último sello tiene N h» sin esperar. Aceptar `opts.ahoraMs`
  también aquí lo haría comprobable.
- **La marca del correo crece una fila por día para siempre** en `settings` de `control.db`
  (`verifactu_anclaje_email_<fecha>`). Son bytes, pero una sola clave con la fecha dentro del valor
  hace el mismo trabajo.
- **Buena decisión, y que se note:** el cerrojo de estado del servidor (`motivoAnclajeInactivo`
  exigiendo dos variables de `/etc/bamburu.env`, más un timer que el orquestador no puede instalar) es
  exactamente la lección del cifrado de esta mañana, bien aplicada. Con esto fusionado, `master` no
  llama a nadie ni escribe una fila. Eso está bien resuelto y no lo toques al arreglar lo de arriba.
