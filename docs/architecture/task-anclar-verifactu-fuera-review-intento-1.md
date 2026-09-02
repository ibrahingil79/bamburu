❌ RECHAZADO

# Revisión — Anclar la cadena de VERI*FACTU fuera del servidor

- **taskId:** `anclar-verifactu-fuera`
- **intento:** 4 (replanteo nº1 del arquitecto)
- **rama:** `tarea/anclar-verifactu-fuera` · commit `14cc4e6`
- **base del diff:** `e381d1b`
- **fecha:** 1 sep 2026

Lo que he ejecutado para escribir esto, y con qué permiso:

| Qué | Autorización |
|---|---|
| `node scripts/verify-verifactu-anclaje.mjs` — **UNA** pasada | La caja de arriba del análisis, §«LO QUE ESTA TAREA NECESITA EJECUTAR», punto 2 |
| Tres sondas propias en `/tmp` (BD de usar y tirar creada con `runMigrations`, facturas escritas a mano, TSA local de usar y tirar levantada por mí): una llama a `verificarAnclajes` con anclajes reales, otra monta `createVerifactuAnclajeRoutes` en un Hono pelado y **pulsa el botón de verdad**, otra mide lo que trae a memoria el `SELECT` del juez | Necesarias para juzgar los criterios 2, 4, 5 y 8 con el código NUEVO: el proceso `bamburu` arrancó a las **03:56** y los ficheros son de las **20:20**, así que sirve código anterior a este cambio. Ya borradas |

**No he reiniciado `bamburu.service`** — la tarea tiene que quedarse fuera de producción hasta que
Ibrahin firme. **No he lanzado ningún `scripts/run-gates.mjs`**, ni corto ni completo: el análisis dice
expresamente que esta tarea no lo pide ni lo autoriza. **No he tocado ninguna base de negocio**: todo
va sobre ficheros nuevos en `/tmp`, ya borrados. No he repetido la ida y vuelta contra una TSA
pública. El gate no dejó restos: `SELECT slug FROM tenants WHERE slug LIKE '%gate-anclaje%'` → 0 filas.

---

## 1. Criterios de aceptación (§6 del análisis)

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | **El verde se gana:** `'cuadra'` una sola vez, precedido de `cuadranLosCubos`/`alarmadas`/`fueraDeVentana`/`sinComprobar`/`verificados===sellados`; la variable se inicializa a `'alarma'`; sin campo `ok` | **SÍ** | `grep -n "'cuadra'" modules/erp/verifactu-anclaje.js` → **una** ocurrencia, `:460`. `let veredicto = 'alarma'` en `:454`; las cinco comprobaciones en `:452-460`, en ese orden; el `return` de `:462-465` no lleva `ok`. Gate bloque [0], mi pasada: 5 ✓ · 0 ✗ |
| 2 | **Las ocho mutaciones que hoy salen verdes salen rojas**, y la base intacta sí devuelve `'cuadra'` | **NO** | **Siete de las ocho, sí** (gate [9] y [10] de mi pasada, cada una sobre copia limpia y con la CA puesta): `token`→NULL «dice sellada y no tiene sello» · `estado='fallo'` con secuencia y sello «alguien ha escondido un anclaje» · `n_facturas`, `tsa_url`, `cadena_ok` → «se han cambiado los datos del anclaje después de sellarlo» · `sellado_at` → «la fecha del sello no es la que firmó la TSA» · `limite=1` habiendo 5 → `parcial` con `fueraDeVentana=4`. Base intacta → `cuadra` (bloque [2c]). **La octava, «borrar el anclaje más viejo», NO**: solo se caza si el recorrido va SIN límite. Medido por mí con tres anclajes sellados de verdad y `DELETE … WHERE secuencia=1`: `verificarAnclajes(db, {caPath})` → `alarma`, pero `verificarAnclajes(db, {caPath, limite:25})` → **`veredicto=cuadra`, «2 de 2 anclajes comprobados uno a uno, todos en orden»**. Y `limite:25` es exactamente lo que usa el botón. Ver punto 1 del rechazo |
| 3 | **El barrido por columnas es exhaustivo:** recorre `PRAGMA table_info`, una mutación declarada por columna, falla si aparece una sin clasificar, y los `motivo` de las exenciones son literales en el doc | **SÍ** | Gate [9], mi pasada: las 20 columnas de `table_info(verifactu_anclajes)` están en `MUTACIONES` (`id, secuencia, raiz, raiz_fiscal, raiz_anterior, hasta_invoice_id, hasta_anulacion_id, hasta_registro_id, n_facturas, n_anulaciones, n_registros, cadena_ok, cadena_detalle, tsa_url, token, sellado_at, estado, error, created_at`). Autotest: `ALTER TABLE … ADD COLUMN columna_de_mentira` sobre una copia → la detecta como sin clasificar (y esa aserción es la que alimenta `fail++` → `process.exit(1)`, `:622`). Los dos `motivo` aparecen literales en `docs/verifactu/anclaje-externo.md:82` y `:83` |
| 4 | **El botón no puede decir «cuadra»:** con más anclajes que `ANCLAJE_COMPROBAR_LIMITE`, `POST /anclajes/comprobar` redirige con `v=parcial`, la pantalla dice cuántos de cuántos, y **la palabra «cuadra» no aparece en esa respuesta** | **NO** | Las dos primeras mitades, **sí**, medidas pulsando el botón de verdad sobre 30 anclajes sellados (sonda propia, código nuevo, fuera del servicio): `302` → `location: /admin/verifactu/anclajes?comprobado=1&v=parcial&n=25&total=30&msg=comprobados+los+últimos+25+de+30+anclajes+—+de+los+otros+5+no+se+dice+nada.` y el flash de la pantalla lo repite. **La tercera, no:** «cuadra» aparece **dos veces** en esa respuesta, y en cualquier pantalla del admin, porque viene del layout compartido — `modules/erp/layout.js:622` (`'…un formato que no cuadra.'`) y `:1428` (`descuadrando`). Medido: `2 ocurrencias` en la pantalla **sin un solo anclaje**. La aserción del gate que mide esto (`verify-verifactu-anclaje.mjs:568`) está por tanto garantizada en rojo y nunca se ha ejecutado. Ver punto 2 del rechazo |
| 5 | **Alguien recorre la cadena entera, y su verde caduca:** una pasada del barrido escribe fila en `verifactu_anclajes_auditorias`; la pantalla la muestra con su antigüedad; con más de `2 × ANCLAJE_LATIDO_H`, no la pinta en verde | **SÍ** | Gate [6-audit], mi pasada: auditorías `0 → 1`, fila `{"veredicto":"cuadra","total_filas":5,"sellados":4,"verificados":4}` — cobertura total, no un tramo. Pantalla, sonda propia con 30 anclajes: fresca → `<div … var(--ok)…><b>Última auditoría completa</b> (…): 30 de 30 anclajes comprobados uno a uno, todos en orden.` Envejecida a 49 h → `<div … var(--warn)…><b>Última auditoría completa: 30/8/2026, 19:31:34.</b> Este resultado ya no vale: es de hace 49 h (más de 48 h).` Deja de ser verde |
| 6 | **El último anclaje cubre todo lo sellado:** tocar una factura que solo cubre el más viejo deja `verifyTenantInvoices` en `ok:true` y el juez en `alarma`, nombrando anclaje y fecha | **SÍ** | Gate [4], mi pasada, sobre copia: `verifyTenantInvoices` → `{"total":3,"ok":true,"alarm":null}` (la cadena propietaria, recalculada entera con `calcHash`, cuadra consigo misma) y `verificarAnclajes` → `{"secuencia":1,"sellado_at":"2026-09-01T20:32:45.000Z","motivo":"se ha tocado material fiscal ya sellado (la primera prueba de ello es este anclaje)"}`. La búsqueda binaria señala el **1**, que es el único que cubre esa factura, no el último |
| 7 | **No toca la cadena:** SHA-256 de las tres tablas idéntico antes/después de una pasada que **sí ancle**; y el diff no incluye los 4 ficheros de la familia Verifactu | **SÍ** | Gate [6], mi pasada: anclajes `4 → 5` (sí ancló) y `f0f756bd83d29e2d… vs f0f756bd83d29e2d…`. `git diff --name-only master..HEAD` → 13 ficheros; ninguno es `routes/invoices.js`, `verifactu.js`, `verifactu-envio.js` ni `verifactu-cola.js`. Este commit toca 6 ficheros, todos nombrados en el §4 del plano |
| 8 | **Se ve sin abrir el código:** las dos pantallas responden 200 con su URL final, la primera muestra el veredicto de la última auditoría en palabras, y el correo lleva ese veredicto con su cobertura, el `.tsr` y `⚠️ ALARMA` en el asunto | **SÍ** | `/admin/verifactu/anclajes`, sonda propia con el código nuevo: `status=200`, `location=null`, 161.693 bytes, contiene «Sellado externo», «Última auditoría completa» y «anclajes comprobados uno a uno». `/superadmin/integridad`: **no lo he vuelto a medir** — `modules/superadmin/integridad.js` no está en `git diff e381d1b..HEAD`, sigue igual que cuando la revisión del intento 3 lo midió (`status=200`, `location=null`, `<th>Sellado</th>`). Correo: `bamburu-anclaje-verifactu.mjs:122` mete `textoVeredicto(veredicto)` (que siempre lleva la cobertura dentro), `:124` adjunta el `.tsr`, `:135-136` pone `⚠️ ALARMA` cuando `algunaAlarma`, y `:119` enciende esa bandera leyendo `veredicto.veredicto === 'alarma'`. Gate [12] lo comprueba estático (3 ✓). **Aviso honesto: la rama `⚠️ ALARMA` no se ha ejercitado extremo a extremo**, solo leída y comprobada estáticamente |

**Dos criterios en NO.**

---

## 2. ¿Se construyó lo que decía el análisis?

Sí, y sin salirse del alcance. Los ocho pasos del §4 están:

| Paso del plano | Estado |
|---|---|
| 1 · columna `raiz_fiscal` + tabla `verifactu_anclajes_auditorias` | `models.js:1611` (`CREATE TABLE`) + `addCol(db,'verifactu_anclajes','raiz_fiscal','TEXT')` en `:1633`; tabla nueva en `:1640-1653`. Las dos aditivas: ningún `DROP`, ninguna columna tocada. `DEFAULT 'pendiente'` retirado de `estado` |
| 2 · raíz de dos niveles | `raizFiscal:76`, `textoCabecera:107` (**una sola** función que construye el texto), `raizCanonica:126`, `cabeceraDeFila:140`. El formato es literalmente el del §2.2 del plano, y está escrito en `docs/verifactu/anclaje-externo.md` para poder verificar sin este código |
| 3 · el juez, clasificador | `verificarAnclajes:386-466`. Censo de TODAS las filas (`:393`, `SELECT` sin `WHERE estado`), cubos, veredicto por conteo. Los diez pasos de la clasificación en `clasificarFilaVentana:318-352`, en el orden del §3.2. Búsqueda binaria en `localizarPrimerTocado:361` |
| 4 · el barrido recorre la cadena entera | `bamburu-anclaje-verifactu.mjs:111-118` (auditoría sin límite + `INSERT`), `:135-136` (asunto), `:103-129` (`try/catch` por negocio). La decisión de abrir en lectura/escritura en vez de `readonly` está explicada en el comentario `:82-88`, como pedía el §4.1 |
| 5 · la pantalla | `verifactu-anclaje-routes.js:68-82` (bloque de auditoría con caducidad), `:84-90` (flash desde `v`+`msg`), `:113` (botón «Comprobar los últimos 25»), `:128` (`POST` acotado). Sin `confirm()`/`prompt()`/`alert()` |
| 6 · el gate | `verify-verifactu-anclaje.mjs`, bloques [9] y [10] nuevos, tabla `MUTACIONES` declarada, autotest del censo, regla de salida del intento 2 intacta (`:622`), limpieza en el `finally` por marca (`:603-610`) |
| 7 · documentación | `docs/verifactu/anclaje-externo.md`: los cinco veredictos con qué hacer con cada uno, el formato v2 de los dos niveles con el texto exacto, §«Qué NO prueba» ampliada con las cuatro cosas que pedía el plano |
| 8 · lo que no se toca | `sellar()` sin cambios de fondo, `motivoAnclajeInactivo` intacto, systemd/menú/montaje/superadmin fuera del diff, `verifyTenantInvoices` sin tocar |

**Lo que el plano dejó a criterio del programador y decidió bien:** el `estado` sin `DEFAULT` solo
afecta a bases nuevas (las viejas conservan el suyo en el esquema), pero como ningún camino inserta sin
`estado` explícito y el clasificador alarma con cualquier valor que no sea `sellado`/`fallo`, no queda
hueco. Y la corrección que el programador encontró él solo —que el recorrido **sin** límite tampoco
podía aceptar como «principio de la cadena» lo que trajera la primera fila superviviente— es real y
está bien hecha (`:422-425`, medida en gate [10a]). El problema es que se quedó a medias: ver abajo.

---

## 3. Por qué se rechaza

Dos puntos. El primero impide aprobar por sí solo.

### [CRITERIO-INCUMPLIDO] Borrar el anclaje más viejo sale VERDE por el botón: el arreglo se aplicó a la mitad del `if`

**Dónde:** `modules/erp/verifactu-anclaje.js:430-431`

```js
let raizAnteriorEsperada = limite && ventana.length ? (ventana[0].raiz_anterior || '') : '';
let secuenciaEsperada    = limite && ventana.length ? ventana[0].secuencia          : 1;
```

**Qué pasa:** la condición para relajar el arranque de la cadena es **`limite`**, no «hay algo fuera de
la ventana». Cuando `limite >= sellados` —o sea, cuando la ventana ya cubre TODOS los sellados— el
juez sigue aceptando como principio de la cadena lo que traiga la primera fila superviviente, pero
ahora `fueraDeVentana` vale **0**, así que no hay nada que impida el verde. El comentario de `:426-429`
lo dice él mismo: *«el veredicto no puede salir en verde de todos modos **mientras haya algo fuera de
la ventana**»* — y cuando no lo hay, sí puede.

Medido por mí, tres anclajes sellados de verdad contra una TSA local, con la CA puesta, `DELETE FROM
verifactu_anclajes WHERE secuencia=1` sobre una copia limpia:

```
sin limite  → veredicto=alarma  sellados=2 verificados=1 alarmadas=1
              "ALARMA en el anclaje 2: hueco en la numeración: falta el anclaje 1"
limite=25   → veredicto=cuadra  sellados=2 verificados=2 alarmadas=0 fueraDeVentana=0
              "2 de 2 anclajes comprobados uno a uno, todos en orden."
```

Y por el botón de verdad, con el código nuevo montado en un Hono pelado:

```
POST /admin/verifactu/anclajes/comprobar
  → 302 /admin/verifactu/anclajes?comprobado=1&v=cuadra&n=2&total=2&msg=2 de 2 anclajes comprobados uno a uno, todos en orden.
  → el flash se pinta con var(--ok): VERDE
```

Borrando los DOS más viejos, lo mismo: `1 de 1 anclajes comprobados uno a uno, todos en orden`.

`limite` es `ANCLAJE_COMPROBAR_LIMITE` = **25**, así que esto no es un caso de laboratorio: es el
estado de **todo negocio durante sus primeros 25 anclajes**, y el botón es la única comprobación que el
dueño puede lanzar él. Es el agujero `[D]` del §1.2 del análisis —el que el propio arquitecto midió y
puso como criterio— vivo en el camino que usa la persona. Rompe además LA PROMESA tal y como está
escrita: *«Solo dice que tus facturas están intactas cuando ha comprobado todos los sellos, uno a uno»*.

**Qué hay que hacer:** partir el cálculo de la ventana de la decisión de relajar el arranque. Calcular
`fueraDeVentana` primero y usar **eso** como condición:

```js
const fueraDeVentana = sellados - ventana.length;
let raizAnteriorEsperada = fueraDeVentana > 0 ? (ventana[0].raiz_anterior || '') : '';
let secuenciaEsperada    = fueraDeVentana > 0 ? ventana[0].secuencia          : 1;
```

Con eso, `limite=25` sobre 3 anclajes exige `secuencia=1` y `raiz_anterior` vacía igual que el
recorrido completo, y solo se relaja cuando de verdad hay sellados que no se han mirado —que es cuando
`fueraDeVentana > 0` ya impide el verde por su cuenta. **Y añadir el caso al gate:** el bloque [10a]
(`verify-verifactu-anclaje.mjs:505-507`) solo prueba `verificarAnclajes(db10a, { caPath })`; hay que
repetir la misma mutación con `{ caPath, limite: ANCLAJE_COMPROBAR_LIMITE }` sobre una copia con
**menos de 25** anclajes sellados y exigir `veredicto !== 'cuadra'`. Sin esa segunda llamada el gate
seguiría en verde con el agujero abierto, que es justo lo que ha pasado.

### [SIN-PRUEBAS] Los cinco bloques que miden las pantallas nunca se han ejecutado, y dos de sus aserciones están garantizadas en rojo

**Dónde:** `scripts/verify-verifactu-anclaje.mjs:403` y `:568`

**Qué pasa:** mi pasada del gate reproduce exactamente la del programador — `RESULTADO: 110 ✓ · 0 ✗ ·
5 ⚠ NO VERIFICADO`, `EXIT=1`. Los cinco ⚠ son los bloques [1b], [2b], [6b], [11] y el final de
superadmin: los únicos que tocan una pantalla servida, y los únicos que miden los criterios 4, la
segunda mitad del 5 y el 8. Que no se hayan podido correr sin `sudo` está previsto por el plano y no es
culpa del programador. **Lo que sí es un defecto es lo que hay escrito dentro de ellos**, porque nunca
se ha ejecutado y no funciona:

- `:403` — `ok(!htmlFresca.includes('ya no vale'), 'y, fresca, NO dice que el resultado ya no vale')`.
  La cadena `ya no vale` está en **`modules/erp/layout.js:1567`** (`// lo cacheado ya no vale`), dentro
  del JS que el layout inyecta en **todas** las pantallas del admin. Medido con mi render: la pantalla
  con la auditoría **fresca** contiene «ya no vale». Esta aserción sale ✗ siempre.
- `:568` — `ok(!htmlTrasBoton.includes('cuadra'), 'la palabra «cuadra» NO aparece en la respuesta')`.
  «cuadra» está en **`layout.js:622`** (`'…un formato que no cuadra.'`) y en **`:1428`**
  (`descuadrando`). Medido: 2 ocurrencias en la pantalla del anclaje **sin un solo anclaje**. Esta
  aserción sale ✗ siempre, y es la que pone el criterio 4 en NO.

Las dos aserciones **miden el layout compartido, no la pantalla que juzgan**. Es el defecto que
`CLAUDE.md` describe al revés: aquí no es un verde que no se ha ganado, es un rojo que no se ha
descubierto porque nadie llegó a correr el bloque. Y significa que la frase de la entrega —«los cinco
⚠ solo dependen de reiniciar el servicio»— **no es cierta**: en cuanto se reinicie, el gate se pone en
`2 ✗` por motivos que no tienen nada que ver con esta tarea.

**Qué hay que hacer:** anclar las dos aserciones al trozo de HTML que de verdad juzgan, no al documento
entero. El bloque de la auditoría y el flash son dos `<div>` identificables:

```js
const bloqueAud = htmlFresca.match(/<b>Última auditoría completa[\s\S]*?<\/div>/)?.[0] || '';
ok(!bloqueAud.includes('ya no vale'), 'y, fresca, NO dice que el resultado ya no vale');

const flash = htmlTrasBoton.match(/Comprobado ahora:[\s\S]*?<\/div>/)?.[0] || '';
ok(!!flash, 'la pantalla trae el aviso del botón');
ok(!flash.includes('cuadra') && !/var\(--ok\)/.test(flash), 'el aviso del botón no dice que todo está en orden ni se pinta en verde');
```

(La segunda mitad —`var(--ok)`— es la que de verdad interesa: el criterio quiere que el botón no
tranquilice, y el color es tan parte del mensaje como la palabra.) Con eso, hay que **volver a correr
el gate** —una pasada— para que esos cinco bloques dejen de estar sin ejercitar; si el servicio sigue
sin poder reiniciarse, hay que decirlo y medir esas pantallas fuera del proceso, como he hecho yo, y
dejarlo escrito en la entrega.

---

## Observaciones (no bloquean)

- **`textoVeredicto` devuelve la frase verde por caída al final** (`verifactu-anclaje.js:488-490`): si
  `r.veredicto` no es ninguno de los cuatro que compara, sale «N de M anclajes comprobados uno a uno,
  todos en orden». Hoy el conjunto es cerrado y no se alcanza, pero la pantalla llama a esta función
  con un veredicto **leído del `.db`** (`verifactu-anclaje-routes.js:75`, vía `veredictoDeAuditoria`),
  que es escribible por el mismo atacante del modelo de amenazas. Es la misma forma que el replanteo
  vino a matar en el juez: el verde como valor por defecto de una caída. Un `if (r.veredicto ===
  'cuadra')` explícito y un `return 'veredicto desconocido: …'` al final lo cierran. *(No lo cuento
  como incumplimiento porque el criterio 1 acota el literal `'cuadra'` a `verificarAnclajes`, y ahí
  está bien.)*
- **El correo diario perdió el «por qué está apagado»** (`bamburu-anclaje-verifactu.mjs:122`): antes,
  un negocio sin anclajes salía como «Nunca se ha sellado nada. (No hay ninguna autoridad de sellado
  configurada…)»; ahora sale «nunca se ha sellado nada: no hay ningún anclaje que comprobar.», sin el
  `motivoAnclajeInactivo`. Con el anclaje apagado en producción —que es el estado de hoy— esa línea es
  **lo único** que el dueño va a leer, y ya no dice qué hay que encender. La función sigue importada y
  usada en `procesar()`; basta con concatenarla también aquí.
- **La alarma guardada pierde su fecha** (`verifactu-anclaje-routes.js:31`): `veredictoDeAuditoria`
  pone `sellado_at: null` porque `verifactu_anclajes_auditorias` no guarda esa columna, así que una
  alarma vista desde la pantalla dice «ALARMA en el anclaje 7 (sellado **fecha desconocida**)». Una
  columna `alarma_sellado_at` más en la tabla nueva (que aún no existe en ninguna base) lo arregla.
- **El botón trae a memoria todos los tokens, incluidos los que no va a mirar**
  (`verifactu-anclaje.js:393`, `SELECT *` sobre la tabla entera antes de recortar la ventana). Medido
  por mí con 5.000 anclajes de 2.400 B: **11,4 MB de BLOB y 67 ms** de bucle de eventos bloqueado solo
  en la lectura, frente a **19 ms** del mismo censo sin la columna `token`. No es grave al lado de los
  ~300 ms de `openssl` que el plano ya acepta, pero contradice la mitigación del riesgo 3 («en la
  petición HTTP solo queda la ventana acotada de 25 y **lecturas baratas**») y reabre en pequeño lo que
  tumbó al intento 2. Dos consultas —un censo sin `token` para clasificar, y el `SELECT` con `token`
  solo para la ventana— lo dejan plano.
- **Un `disk I/O error` dentro del gate**: en el bloque [11] de mi pasada, uno de los anclajes de
  relleno quedó con `cadena_ok=0` y `cadena_detalle: "factura —: error al leer las facturas: disk I/O
  error"`. El producto se comportó como debe (ancla igual, con la alarma escrita), pero es la BD del
  propio gate fallando bajo las 25 vueltas de relleno + copias; conviene mirarlo antes de que se
  convierta en un rojo intermitente, que es justo lo que la norma de la casa prohíbe perseguir a
  base de repetir pasadas.
- **El bloque [10b] afirma un verde después de una mutación destructiva** (`:515`): borrar el ÚLTIMO
  anclaje deja `cuadra`. Es correcto y está declarado en `docs/verifactu/anclaje-externo.md`
  §«Qué NO prueba» —la red contra eso es el `.tsr` del correo, no el `.db`—, pero es el único sitio del
  gate donde se exige verde tras romper algo; merece que el comentario del bloque enlace explícitamente
  ese párrafo del documento, para que nadie lo lea como un descuido y lo «arregle».
