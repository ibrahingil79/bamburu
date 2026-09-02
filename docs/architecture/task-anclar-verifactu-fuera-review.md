✅ APROBADO

# Revisión — Anclar la cadena de VERI*FACTU fuera del servidor

- **taskId:** `anclar-verifactu-fuera`
- **rama revisada:** `tarea/anclar-verifactu-fuera` · punta `6ece435` (el último commit **de código** es
  `76517c8`; `6ece435` solo mueve documentos)
- **base del diff que se me dio:** `14cc4e6` → los commits de código posteriores son `76517c8`
- **análisis pactado:** replanteo nº1, `docs/architecture/task-anclar-verifactu-fuera-analysis.md`
  **de la rama** (689 líneas, cabecera `♻️ REPLANTEAMIENTO`). Ojo: ese fichero **no existe en el árbol
  de `master`**; en `master` solo está el archivado `…-analysis-replanteo-0.md`, que es el plano
  ANTERIOR. Lo he sacado con `git show tarea/anclar-verifactu-fuera:docs/architecture/task-anclar-verifactu-fuera-analysis.md`.
- **fecha:** 1 sep 2026 (noche)

## Cómo he mirado, y con qué permiso

| Qué | Autorización / motivo |
|---|---|
| `git worktree add /tmp/rev-anclaje tarea/anclar-verifactu-fuera` + `node_modules` enlazado + `data/` propio y vacío | El código de esta tarea **no está en `master`** y el árbol de trabajo de `master` tiene cambios sin commitear de otra tarea: no se puede cambiar de rama ahí. El worktree es de solo lectura para el repo y se retira al terminar. |
| `node scripts/verify-verifactu-anclaje.mjs` — **UNA** pasada | La caja de arriba del análisis, §«LO QUE ESTA TAREA NECESITA EJECUTAR», punto 2. Una sola vez, como manda la casa. |
| Una **sonda propia** de usar y tirar (`/tmp/rev-anclaje-sonda.mjs`): negocio desechable + TSA local levantada por mí + las rutas REALES de la rama montadas en un Hono aparte, en mi propio proceso | Los cinco puntos que el gate deja en `⚠ NO VERIFICADO` son justo los que miden los criterios 4, la segunda mitad del 5 y el 8. Sin medirlos yo, no podría firmar esos tres. |

**No he reiniciado `bamburu.service`.** El proceso vivo sirve código de `master`; reiniciarlo con esta
rama montada la metería en producción, y el análisis lo prohíbe expresamente (la tarea se queda fuera
hasta que Ibrahin firme). **No he lanzado ningún `scripts/run-gates.mjs`**, ni corto ni completo: el
plano dice que esta tarea no lo pide ni lo autoriza. **No he salido a Internet** (la ida y vuelta
contra una TSA pública ya se hizo en el intento 2 y no se repite).

**Residuo, medido al terminar:** `data/control.db` real → `tenants LIKE '%gate-anclaje%' OR '%rev-sonda%'`
= **0** (56 negocios, los mismos de antes) · `data/tenants/` del worktree vacío · `/tmp/gate-tsa-*` y
`/tmp/sonda-tsa-*` → **0**. Ninguna base de negocio real se abrió ni en lectura ni en escritura.

**Resultados en crudo:**

```
gate propio  : RESULTADO: 112 ✓  ·  0 ✗  ·  5 ⚠ NO VERIFICADO      EXIT=1
sonda propia : SONDA: 22 ✓ · 0 ✗                                    EXIT=0
```

Los 5 `⚠` son `[1b]`, `[2b]`, `[6b]`, `[11]` y el bloque final de superadmin: **los únicos que piden
una pantalla servida por el proceso en marcha**. El gate los declara sin verificar en vez de darlos
por buenos, sale con código 1 y exige una variable firmada a mano para ponerse verde: eso es lo
correcto y **no debe tocarse**. Los he medido yo por otra vía y salen bien; queda escrito abajo.

---

## 1. Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | **El verde se gana:** `'cuadra'` una sola vez en `verifactu-anclaje.js`, en la asignación final, precedida de `cuadranLosCubos`, `alarmadas`, `fueraDeVentana`, `sinComprobar` y `verificados === sellados`; veredicto inicializado a `'alarma'`; sin campo `ok` | **SÍ** | `grep -c "'cuadra'" modules/erp/verifactu-anclaje.js` → **1**, en `:462` (`else if (verificados === sellados) veredicto = 'cuadra';`). `let veredicto = 'alarma'` en `:456`. La escalera `:454-462` está en el orden literal del plano §3.5. El `return` de `:464-467` devuelve `{veredicto, totalFilas, sellados, fallidas, verificados, sinComprobar, fueraDeVentana, alarmadas, alarma, ultimo}` — **ningún `ok`**; `grep -rn` confirma que ni las rutas ni el barrido leen `.ok` del juez. Gate bloque `[0]`: 5 ✓ |
| 2 | **Las ocho mutaciones salen rojas**, y la base intacta sí da verde | **SÍ** | Gate `[9]` y `[10]`, cada una sobre **copia limpia** del `.db`, con CA puesta y tokens válidos: `token` a NULL → `alarma` («dice sellada y no tiene sello») · `estado='fallo'` sobre uno con secuencia y sello → `alarma` («alguien ha escondido un anclaje») · `n_facturas` → `alarma` («se han cambiado los datos del anclaje después de sellarlo») · `sellado_at` → `alarma` («la fecha del sello no es la que firmó la TSA») · `tsa_url` → `alarma` · `cadena_ok` → `alarma` · **borrar el más viejo** → `alarma` («hueco en la numeración: falta el anclaje 1»), **y también con `limite = ANCLAJE_COMPROBAR_LIMITE ≥ sellados`**, que era el agujero del rechazo anterior · `limite=1` con 5 sellados → `parcial`, `fueraDeVentana=4`. Base intacta: `[2c]` → `{"veredicto":"cuadra","verificados":1,"sellados":1}` y `[6-audit]` → `cuadra` con `verificados === sellados` |
| 3 | **El barrido por columnas es exhaustivo:** `PRAGMA table_info`, una mutación declarada por columna, código 1 si falta alguna, y los `motivo` de las exentas literales en el documento | **SÍ** | Gate `[9]`: «todas las columnas de `verifactu_anclajes` están clasificadas en MUTACIONES · id, secuencia, raiz, raiz_fiscal, raiz_anterior, hasta_invoice_id, hasta_anulacion_id, hasta_registro_id, n_facturas, n_anulaciones, n_registros, …» (19 columnas, 20 mutaciones — `token` va dos veces: a NULL y corrompido). **Autotest**: sobre una copia se hace `ALTER TABLE … ADD COLUMN columna_de_mentira` y el censo la detecta como sin clasificar (`verify-verifactu-anclaje.mjs:483-489`); si eso pasara en la tabla de verdad, `ok(noDeclaradas.length === 0, …)` en `:479` suma `fail` y el proceso sale con 1 (`:641`). Los dos `motivo` exentos (`id`, `created_at`) se comprueban **literales** contra `docs/verifactu/anclaje-externo.md` y salen ✓; los he leído allí, líneas del §«Qué NO prueba» |
| 4 | **El botón no puede decir «cuadra»:** con más anclajes que el límite, el POST redirige con `v=parcial`, la pantalla dice cuántos de cuántos, y «cuadra» no aparece en esa respuesta | **SÍ** | Gate `[11]` en directo: 28 sellados > 25, `verificarAnclajes(db,{limite:25})` → `{"veredicto":"parcial", "verificados":25, …}`. La parte servida la mide mi sonda con las rutas reales montadas (`ANCLAJE_COMPROBAR_LIMITE=2`, 3 anclajes): `POST /admin/verifactu/anclajes/comprobar` → **302** con `Location: /admin/verifactu/anclajes?comprobado=1&v=parcial&n=2&total=3&msg=comprobados+los+últimos+2+de+3+anclajes+—+de+los+otros+1+no+se+dice+nada.` · la palabra «cuadra» **no aparece** en esa respuesta · el aviso de la pantalla de destino sale `<div style="…var(--warn)…">Comprobado ahora: comprobados los últimos 2 de 3 anclajes — de los otros 1 no se dice nada.</div>`: **ni «cuadra» ni verde**. Etiqueta del botón: «Comprobar los últimos 2» |
| 5 | **Alguien recorre la cadena entera, y su verde caduca** | **SÍ** | *Parte 1 (el barrido escribe):* gate `[6]`+`[6-audit]` — se lanza `scripts/bamburu-anclaje-verifactu.mjs` de verdad (proceso aparte) y `verifactu_anclajes_auditorias` pasa de **0 → 1** fila: `{"corrida_at":"2026-09-01 23:18:49","veredicto":"cuadra","total_filas":5,"sellados":4,"verificados":4,…}` — cobertura completa, no un tramo. *Parte 2 (la pantalla la enseña y la caduca):* mi sonda — fresca, el bloque sale `<div …var(--ok)…><b>Última auditoría completa</b> (…): 3 de 3 anclajes comprobados uno a uno, todos en orden.</div>`; envejecida a mano a **49 h** (>2×24), el mismo bloque pasa a `var(--warn)`, dice «**este resultado ya no vale: es de hace 49 h (más de 48 h)**» y **deja de tener `var(--ok)`**, aunque el veredicto guardado siga siendo el verde |
| 6 | **El último anclaje cubre todo lo sellado:** tocar una factura que solo cubre el más viejo deja `verifyTenantInvoices` en verde y el juez en `alarma`, nombrando anclaje y fecha | **SÍ** | Gate `[4]`, sobre copia: se cambia el total de F1 y se **recalcula toda la cadena propietaria con `calcHash`** (lo que haría el atacante). `verifyTenantInvoices` → `{"total":3,"ok":true,"alarm":null}`. `verificarAnclajes` → `alarma` con `{"secuencia":1,"sellado_at":"2026-09-01T23:18:48.000Z","motivo":"se ha tocado material fiscal ya sellado (la primera prueba de ello es este anclaje)"}` — y la búsqueda binaria señala al **anclaje 1**, el único que cubre esa factura, no al último |
| 7 | **No toca la cadena:** SHA-256 idéntico antes/después de una pasada que sí ancle, y los 4 ficheros de la familia fuera del diff | **SÍ** | Gate `[6]`: la pasada **sí ancló** (`4 → 5` anclajes, condición previa exigida por el propio bloque) y el SHA-256 de `invoices` + `invoice_anulaciones` + `verifactu_registros` sale `909a6b0a5e54a7b8…` **antes y después**. Y `git diff --name-only master..tarea/anclar-verifactu-fuera` no incluye `routes/invoices.js`, `verifactu.js`, `verifactu-envio.js` ni `verifactu-cola.js` (comprobado por el gate y por mí con `git diff --stat`: 15 ficheros, ninguno de esos cuatro) |
| 8 | **Se ve sin abrir el código:** las dos pantallas 200 con su URL final, la primera con el veredicto en palabras, y el correo con veredicto + cobertura + `.tsr` + `⚠️ ALARMA` | **SÍ** | Mi sonda, rutas reales: `GET /admin/verifactu/anclajes` → **200 sin `Location`**, contiene «Sellado externo» y el veredicto **en palabras con su cobertura** («3 de 3 anclajes comprobados uno a uno, todos en orden.»). `GET /superadmin/integridad` → **200 sin `Location`**, «Integridad de facturas», `<th>Sellado</th>` presente y la fila del negocio con anclajes muestra su fecha de sello (no «sin anclar»). Correo: `bamburu-anclaje-verifactu.mjs:122` mete `textoVeredicto(veredicto)` por negocio, `:124` adjunta el `.tsr` del último anclaje, `:135-136` compone el asunto con `⚠️ ALARMA` cuando `algunaAlarma`; gate `[12]` comprueba además que esa bandera se enciende leyendo `veredicto.veredicto === 'alarma'` y no una suposición |

**8 de 8 en SÍ.**

---

## 2. ¿Se construyó lo que decía el análisis?

Sí, y con una precisión poco común. Los commits del replanteo (`e381d1b..76517c8`) tocan **seis
ficheros, exactamente los seis que nombra el plano** en sus pasos 1 a 7:

```
docs/verifactu/anclaje-externo.md                  (paso 7)
modules/erp/models.js                              (paso 1)
modules/erp/routes/verifactu-anclaje-routes.js     (paso 5)
modules/erp/verifactu-anclaje.js                   (pasos 2 y 3)
scripts/bamburu-anclaje-verifactu.mjs              (paso 4)
scripts/verify-verifactu-anclaje.mjs               (paso 6)
```

**Ni uno de más.** El §8 («lo que NO se toca en este replanteo») se respeta al pie: `menu.js`,
`routes/index.js`, `integridad.js` y las unidades de systemd no aparecen en `e381d1b..HEAD`
—están en el diff contra `master` porque vienen de los commits anteriores de la rama, no de este
replanteo—, y `sellar()` (`:151-206`), `motivoAnclajeInactivo()` (`:59-71`) y la transacción del
corte (`:255-260`) están intactas.

Punto por punto: la raíz de dos niveles (§4.2) sale con `textoCabecera()` como **una sola función**
compartida por `raizCanonica()` y `cabeceraDeFila()` —que era la exigencia literal del 2.3, «para
que no puedan divergir»—, con la cabecera `bamburu-anclaje-v2`, el orden de líneas y el
`cadena_detalle_sha` tal cual se pidieron, y el documento los recoge **carácter a carácter** (los he
comparado línea a línea con `textoCabecera`). El clasificador (§3.2) tiene los diez pasos en el
orden exacto del plano. El veredicto por conteo (§3.5) es el bloque del plano, literal. La auditoría
diaria se hace en el barrido `oneshot` con la base en lectura/escritura y **cada negocio en su
propio `try/catch`** (§4.3, que venía del rechazo del intento 2). La decisión que el plano dejaba
abierta —«abrir en r/w o auditar en `procesar()`: decide el programador»— se tomó por la primera y
está explicada en el comentario de `:82-88`.

**Una desviación, y no la firmó:** el §6.2 del plano lista «borrar el **último**» entre las
mutaciones que deben exigir `veredicto !== 'cuadra'`, y el gate afirma justo lo contrario
(`verify-verifactu-anclaje.mjs:527`: `v10b.veredicto === 'cuadra'`). Miro el fondo antes de
apuntarlo como incumplimiento: **el propio plano se contradice**, porque su §7 obliga a escribir en
el documento que «borrar los últimos anclajes no se ve hasta que pasan `2 × latido`, y la red contra
eso es el `.tsr` que sale por correo». Las dos cosas no pueden ser verdad a la vez, y la que es
técnicamente cierta es la del §7: una cadena a la que le falta la cola sigue siendo internamente
consistente. El programador siguió esa, y la dejó escrita en el documento
(§«Qué NO prueba» → «Que borrar los ÚLTIMOS anclajes se vea de inmediato») y en el texto de la
propia aserción. Lo que le falta es decir **en la entrega** que se apartaba del §6.2 y por qué; eso
va como observación, no como motivo para devolverlo: replantear es del arquitecto, y aquí el plano
es el que no cuadra consigo mismo.

---

## 3. El nivel de construcción

**La capa y el patrón.** Nada nuevo al lado: el juez vive donde ya vivía (`modules/erp/`), la puerta
única copia `motivoColaInactiva` de `verifactu-cola.js`, el barrido calca el esqueleto de
`bamburu-verifactu-cola.mjs`, las rutas calcan `verifactu-envio-routes.js`, y la forma «hay que
encontrar la prueba para pasar» es la de `requirePerm` (`core/auth.js:46-60`), como pedía el plano.
Las dos tablas nuevas son **aditivas**: `CREATE TABLE IF NOT EXISTS` + `addCol`, ningún `DROP`,
ninguna columna tocada en tablas existentes.

**Una pieza, una cosa.** `raizFiscal` (caro, `O(facturas)`) y `textoCabecera` (barato, `O(1)`) están
separados de verdad, y esa separación es lo que arregla la avería del intento 2 (la pantalla
recalculando toda la cadena en cada carga). `clasificarFilaVentana` clasifica **una** fila y devuelve
un cubo; `verificarAnclajes` solo cuenta cubos; `textoVeredicto` solo redacta. Los tres sitios que
hablan del estado —pantalla, botón y correo— pasan por `textoVeredicto`, así que **no pueden
discrepar**; lo he comprobado en la sonda: la frase de la pantalla y la del `msg=` del redirect son
la misma función.

**Números a mano.** `ANCLAJE_COMPROBAR_LIMITE` y `ANCLAJE_LATIDO_H` son configurables por entorno
con su porqué medido en comentario. Queda una constante a pelo, `HORAS_FRESCO = 48` en
`verifactu-anclaje-routes.js:21` — apuntada abajo.

**Errores distinguidos.** Cada cubo trae su motivo propio y distinto: «dice sellada y no tiene
sello», «alguien ha escondido un anclaje», «un estado que este producto no escribe nunca», «la fecha
del sello no es la que firmó la TSA», «se ha tocado material fiscal ya sellado». Y una distinción
que suele faltar y aquí está: **`sin-comprobar` no es `alarma` ni es verde** — «no he podido mirar»
tiene nombre propio, que es justo lo que se le promete al dueño. El detalle de `openssl` se recorta
a la primera línea (`:233-235`) para que un volcado de `asn1_d2i_read_bio` no acabe en una URL.

**Cierra lo que abre.** `sellar()` y `verificarToken()` borran su directorio temporal en `finally`
(`:203-205`, `:237-239`). El barrido cierra la base en `finally` en los dos bucles (`:76-78`,
`:128-130`). `ultimoAnclajeDe` cierra en `finally` (`integridad.js:20`). El gate cierra cada copia,
apaga su TSA, borra `.db`/`-wal`/`-shm` y tira el negocio desechable en el `finally` — medido: cero
residuo tras mi pasada.

**Se repite sin duplicar efectos.** `runMigrations` es idempotente; `anclar()` con nada nuevo y sin
latido cumplido devuelve «nada nuevo que anclar» sin escribir (gate `[8]`); el correo diario lleva
marca por fecha en `control.db`; la tabla de auditorías es de solo-añadir.

**Se prueba por partes.** El juez es una función pura sobre una conexión: se prueba con una copia del
`.db` y nada más — por eso el barrido por columnas puede hacer 20 mutaciones en 20 copias sin
levantar el producto. Las pantallas necesitan las rutas montadas, y se dejan montar en un Hono
aparte sin tocar nada: mi sonda lo hizo en 20 líneas.

**Lo que sí es sobresaliente**, y conviene decirlo porque es la lección que costó tres intentos: el
verde ya no es alcanzable por omisión. `cuadranLosCubos` exige que
`verificados + sinComprobar + alarmadas + fueraDeVentana + fallidas === totalFilas`, así que **una
fila que no encaje en ningún cubo tira el veredicto a rojo por sí sola**, sin que nadie haya tenido
que imaginarse el ataque. Es una propiedad cerrada, no una lista negra, y eso es lo que hace que el
barrido por columnas del gate no envejezca.

---

## 4. Qué se rompe

- **La cadena de VERI\*FACTU:** no se toca. Medido con el SHA-256 de las tres tablas antes y después
  de una pasada que sí ancló (criterio 7), y por lectura: el módulo solo hace `SELECT` sobre
  `invoices`, `invoice_anulaciones` y `verifactu_registros`. Los cuatro ficheros de la familia están
  fuera del diff.
- **Datos que ya existen:** ninguno. `verifactu_anclajes` no existe hoy en ninguna base de negocio
  (esta rama nunca ha estado en `master`), así que el paso de v1 a v2 no invalida nada real. Y aun
  así, fail-closed: una fila con `raiz_fiscal` nulo cae en `sin-comprobar` con su motivo escrito
  (`:312-314`), no en verde.
- **Concurrencia:** el único escritor de la auditoría es el barrido `oneshot`, que no se solapa
  consigo mismo; la pantalla solo lee la última fila; si un `.db` está bloqueado, el `try/catch` por
  negocio deja el correo salir con los demás. El riesgo 6 del plano queda mitigado y probado en la
  pasada real del gate.
- **Pantallas que dependen de esto:** `/admin/verifactu/anclajes` y `/superadmin/integridad`, las dos
  200 con su URL final (medidas). El `GET` de la primera ya **no** llama a `verificarAnclajes` —era
  la avería del intento 2— y sigue acotado sin traer el BLOB `token`.
- **Que la pieza se encienda sola al fusionar:** no puede. `motivoAnclajeInactivo` exige
  `VERIFACTU_ANCLAJE_TSA` **y** `VERIFACTU_ANCLAJE_TSA_CA` en `/etc/bamburu.env`, donde el
  orquestador no escribe, y el timer no está instalado (`deploy/systemd/README.md` lo marca **NO
  INSTALADA**). Con esto en `master` no llama a nadie ni escribe una fila. El cerrojo es el mismo que
  se acabó poniendo en las copias de seguridad, y aquí está bien puesto.
- **Basura de la prueba:** cero, medido. Todo va sobre `negocioDesechable()` y copias en un
  directorio temporal que se borra entero.

Los diez riesgos declarados en §5 del plano están mitigados y las mitigaciones son comprobables; los
que se podían medir (1, 2, 3, 5, 6, 8, 9, 10) los he medido.

---

## Observaciones (no bloquean)

1. **Una aserción del gate no puede fallar nunca, y el commit dice que sí mide.**
   `scripts/verify-verifactu-anclaje.mjs:587` afirma «el aviso del botón no dice «cuadra» **ni se
   pinta en verde**» con `!/var\(--ok\)/.test(flashBoton)`, pero `flashBoton` se recorta con
   `/Comprobado ahora:[\s\S]*?<\/div>/` (`:585`), que **empieza después** del `<div style="…">`
   donde vive el color. El fragmento capturado nunca contiene `var(--ok)`, así que esa mitad de la
   aserción es verde por construcción. Lo mismo le pasa al recorte de `:406`, aunque allí no se
   afirma nada sobre color. El comportamiento **es correcto** —lo he medido yo con el `<div>`
   entero: el aviso sale en `var(--warn)`, y el bloque de auditoría caducada también—, así que no
   hay defecto de producto; lo que hay es un instrumento que cierra una pregunta sin haberla hecho,
   que es la avería del censo de ventanitas del 24 ago. Arreglo de una línea: cambiar los dos
   recortes por `/<div[^>]*>(?=Comprobado ahora:)[\s\S]*?<\/div>/` y
   `/<div[^>]*>(?=<b>Última auditoría completa)[\s\S]*?<\/div>/`, que es lo que usé en mi sonda.
   Y añadir en `[6b]` la aserción de color que el criterio 5 sí pide (`!/var\(--ok\)/` sobre el
   bloque envejecido).
2. **La desviación del §6.2 («borrar el último») no está declarada en la entrega.** El fondo es
   correcto y está documentado (ver §2 de esta revisión), pero el plano y el gate dicen cosas
   opuestas y el único sitio donde eso se explica es el texto de una aserción. Que quede escrito
   aquí para que el arquitecto lo arregle en el plano: **el §6.2 y el §7 del análisis se
   contradicen**, y manda el §7.
3. **`HORAS_FRESCO = 48` a mano** (`verifactu-anclaje-routes.js:21`), justo al lado de un
   `ANCLAJE_LATIDO_H * 2` que vale lo mismo por defecto pero se mueve con el entorno. Si alguien baja
   el latido a 6 h, el cartel de arriba seguirá midiendo con 48 y el bloque de auditoría con 12: dos
   ideas de «fresco» en la misma pantalla. Viene de antes del replanteo y el plano decía «el cartel
   de arriba no se toca», por eso no es incumplimiento.
4. **Una alarma guardada pierde su fecha al enseñarse.** `veredictoDeAuditoria`
   (`verifactu-anclaje-routes.js:31`) pone `sellado_at: null` porque
   `verifactu_anclajes_auditorias` no guarda esa columna; con un veredicto de alarma, la pantalla
   dirá «ALARMA en el anclaje 47 (sellado **fecha desconocida**)». Ningún criterio lo pide, pero es
   media frase menos justo donde más se necesita. Se cierra con una columna más en la tabla, que es
   aditiva.
5. **El documento nunca nombra el veredicto verde.** La tabla de `anclaje-externo.md:52-60` lo lista
   como *«(el verde)»*; quien mire la columna `veredicto` de la base verá `cuadra` y no lo
   encontrará en el documento. Sí está en el comentario de `models.js`. Es coherente con la regla del
   literal único, pero al documento no le aplica esa regla.
6. **`limite` negativo revienta.** Con `opts.limite < 0`, `ventana` sale vacía, `fueraDeVentana > 0`
   y `verifactu-anclaje.js:432` hace `ventana[0].raiz_anterior` sobre `undefined`. Hoy es
   inalcanzable —`ANCLAJE_COMPROBAR_LIMITE` está guardado con `> 0 ? … : 25` y nadie más pasa
   `limite`—, así que es higiene, no un fallo.
7. **El gate sale con código 1 y así debe seguir.** Los 5 `⚠ NO VERIFICADO` no son un fallo del
   trabajo: son la consecuencia honesta de que el proceso vivo sirve `master` y esta sesión no puede
   (ni debe) reiniciarlo. Que quede dicho para el próximo que lo lea: **`ANCLAJE_GATE_ADMITE_SIN_VERIFICAR=1`
   no es la forma de ponerlo en verde**; la forma es `sudo systemctl restart bamburu` **el día que
   esta rama entre en producción**, y no antes.
8. **Recordatorio de estado, no del trabajo:** la pieza está entera, probada y **apagada**. Falta lo
   que solo puede hacer una persona: las dos variables en `/etc/bamburu.env` y la instalación del
   timer. Hasta entonces no sella nada, y la pantalla, la columna del superadmin y el correo diario
   existen justo para que eso no se confunda nunca con estar protegido.
