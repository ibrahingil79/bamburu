✅ APROBADO

# Revisión — Anclar la cadena de VERI*FACTU fuera del servidor

- **taskId:** `anclar-verifactu-fuera`
- **intento:** 5 (replanteo nº1 del arquitecto)
- **rama:** `tarea/anclar-verifactu-fuera` · commit `76517c8`
- **base del diff:** `14cc4e6`
- **fecha:** 1 sep 2026 (noche)

Lo que he ejecutado para escribir esto, y con qué permiso:

| Qué | Autorización |
|---|---|
| `node scripts/verify-verifactu-anclaje.mjs` — **UNA** pasada | La caja de arriba del análisis, §«LO QUE ESTA TAREA NECESITA EJECUTAR», punto 2 |
| Cuatro sondas propias de usar y tirar (negocio desechable + TSA local levantada por mí + las rutas montadas en un Hono aparte, en mi propio proceso): pantalla del anclaje, correo diario extremo a extremo con un Resend de mentira, colores del HTML servido, y una sonda de reproducción del `disk I/O error` | Necesarias para juzgar los criterios 4, 5, 8 y el punto de `SIN-PRUEBAS` del intento anterior: el proceso `bamburu.service` arrancó a las **03:56** y los ficheros son de las **20:39/20:41**, así que sirve código anterior a este cambio. La revisión del intento 4 dejó dicho expresamente que, si el servicio no se puede reiniciar, esas pantallas se miden fuera del proceso |

**No he reiniciado `bamburu.service`** — la tarea se queda fuera de producción hasta que Ibrahin firme.
**No he lanzado ningún `scripts/run-gates.mjs`**, ni corto ni completo: el análisis dice expresamente
que esta tarea no lo pide ni lo autoriza. **No he tocado ninguna base de negocio**: todo va sobre
negocios desechables y ficheros temporales, ya tirados. No he repetido la ida y vuelta contra una TSA
pública. **Un único apunte de escritura en `control.db`** —la marca `verifactu_anclaje_email_<hoy>`
que escribe el barrido cuando el correo sale bien— **borrada por la propia sonda y comprobada a
cero al salir**. Residuo tras todo: `tenants LIKE '%gate-anclaje%' / '%rev-anclaje%' / '%rev-color%'`
→ 0 filas · `data/tenants/` sin `.db` sueltos · `superadmin_sessions LIKE 'gate-anclaje-%'` → 0.

---

## 1. Criterios de aceptación (§6 del análisis)

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | **El verde se gana:** `'cuadra'` una sola vez, precedido de `cuadranLosCubos`/`alarmadas`/`fueraDeVentana`/`sinComprobar`/`verificados===sellados`; la variable se inicializa a `'alarma'`; sin campo `ok` | **SÍ** | `grep -n "'cuadra'" modules/erp/verifactu-anclaje.js` → **una** ocurrencia, `:462`. `let veredicto = 'alarma'` en `:456`; las cinco comprobaciones en `:454-462`, en ese orden. El `return` de `:464-467` no lleva `ok`, y `grep -n "ok:"` sobre el fichero solo devuelve `:172-202` (dentro de `sellar()`) y `:272` (el objeto de `verifyTenantInvoices`), ninguno en el juez. `grep -rn "verificarAnclajes"` sobre todo el repo: los 4 sitios que la llaman (`bamburu-anclaje-verifactu.mjs:111`, `verifactu-anclaje-routes.js:128`, y el gate) leen `.veredicto`, ninguno `.ok`. Gate bloque [0], mi pasada: 5 ✓ · 0 ✗ |
| 2 | **Las ocho mutaciones que hoy salen verdes salen rojas**, y la base intacta sí devuelve `'cuadra'` | **SÍ** | Las ocho, cada una sobre copia limpia y con la CA puesta, en mi pasada del gate: `token`→NULL → `«dice sellada y no tiene sello»` ([9]) · `estado='fallo'` con secuencia y sello → `«una fila marcada como fallo lleva número de orden y sello: alguien ha escondido un anclaje»` ([9] y [10c]) · `n_facturas`, `tsa_url`, `cadena_ok` → `«se han cambiado los datos del anclaje después de sellarlo»` ([9]) · `sellado_at` → `«la fecha del sello no es la que firmó la TSA»` ([9]) · **borrar el anclaje MÁS VIEJO** → `alarma` **en las DOS formas**: sin límite (`«hueco en la numeración: falta el anclaje 1»`) y **con `limite: ANCLAJE_COMPROBAR_LIMITE` sobre una copia de 4 sellados** (`{"veredicto":"alarma",…,"fueraDeVentana":0,"alarmadas":1}`), que es el agujero del rechazo anterior ([10a], `:509-519`) · `limite=1` habiendo 5 → `parcial` con `fueraDeVentana=4` ([10d]). Base intacta → `cuadra` ([2c]) |
| 3 | **El barrido por columnas es exhaustivo:** recorre `PRAGMA table_info`, una mutación declarada por columna, sale con 1 si aparece una sin clasificar, y los `motivo` de las exenciones son literales en el doc | **SÍ** | Gate [9], mi pasada: las **19** columnas de `table_info(verifactu_anclajes)` están en `MUTACIONES` (`id, secuencia, raiz, raiz_fiscal, raiz_anterior, hasta_invoice_id, hasta_anulacion_id, hasta_registro_id, n_facturas, n_anulaciones, n_registros, cadena_ok, cadena_detalle, tsa_url, token, sellado_at, estado, error, created_at`), con **20** entradas (`token` va dos veces: a NULL y corrompido). Autotest: `ALTER TABLE … ADD COLUMN columna_de_mentira` sobre una copia → la detecta como sin clasificar; esa aserción alimenta `fail++` → `process.exit(1)` (`:641`). Los dos `motivo` aparecen literales en `docs/verifactu/anclaje-externo.md:82` y `:83` (comprobado por el propio gate leyendo el fichero, y por mí con `grep`) |
| 4 | **El botón no puede decir «cuadra»:** con más anclajes que `ANCLAJE_COMPROBAR_LIMITE`, `POST /anclajes/comprobar` redirige con `v=parcial`, la pantalla dice cuántos de cuántos, y la palabra «cuadra» no aparece en esa respuesta | **SÍ** | Sonda propia, **botón PULSADO de verdad** sobre 28 anclajes sellados contra mi TSA local, con el código nuevo montado fuera del servicio: `302 → /admin/verifactu/anclajes?comprobado=1&v=parcial&n=25&total=28&msg=comprobados+los+últimos+25+de+28+anclajes+—+de+los+otros+3+no+se+dice+nada.`; el aviso de la pantalla es `Comprobado ahora: comprobados los últimos 25 de 28 anclajes — de los otros 3 no se dice nada.`, **sin la palabra «cuadra»** y **pintado en `var(--warn)`**, no en verde (medido con el recorte que sí incluye el `<div style=…>`). En directo, gate [11]: `{"veredicto":"parcial","sellados":28,"verificados":25,"fueraDeVentana":3}`. *La lectura literal del criterio («no aparece en esa respuesta») es insatisfacible —`layout.js:622` mete «…un formato que no cuadra.» en TODAS las pantallas del admin—; la revisión del intento 4 ya prescribió anclarlo al aviso del botón, y eso es lo que mido* |
| 5 | **Alguien recorre la cadena entera, y su verde caduca:** el barrido escribe fila en `verifactu_anclajes_auditorias`; la pantalla la muestra con su antigüedad; con más de `2 × ANCLAJE_LATIDO_H`, no la pinta en verde | **SÍ** | Gate [6-audit], mi pasada: auditorías `0 → 1`, fila `{"veredicto":"cuadra","total_filas":5,"sellados":4,"verificados":4}` — cobertura total, no un tramo. Sonda propia sobre el barrido de verdad (`spawn` de `bamburu-anclaje-verifactu.mjs`): fila `{"veredicto":"alarma","total_filas":3,"sellados":3,"verificados":2,"alarmadas":1,"alarma_secuencia":2}`. Pantalla, sonda propia con 28 anclajes: fresca → `<div … border-left:3px solid var(--ok) …><b>Última auditoría completa</b> (1/9/2026, 23:04:17): 28 de 28 anclajes comprobados uno a uno, todos en orden.` · envejecida a 49 h → `var(--warn)`, **nunca `var(--ok)`**, con el texto `Este resultado ya no vale: es de hace 49 h (más de 48 h)` · con veredicto `alarma` → `var(--danger)` |
| 6 | **El último anclaje cubre todo lo sellado:** tocar una factura que solo cubre el más viejo deja `verifyTenantInvoices` en `ok:true` y el juez en `alarma`, nombrando anclaje y fecha | **SÍ** | Gate [4], mi pasada, sobre copia: `verifyTenantInvoices` → `{"total":3,"ok":true,"alarm":null}` (la cadena propietaria, recalculada entera con `calcHash` como haría el atacante, cuadra consigo misma) y `verificarAnclajes` → `{"secuencia":1,"sellado_at":"2026-09-01T23:02:27.000Z","motivo":"se ha tocado material fiscal ya sellado (la primera prueba de ello es este anclaje)"}`. La búsqueda binaria señala el **1**, que es el único que cubre esa factura, no el último |
| 7 | **No toca la cadena:** SHA-256 de las tres tablas idéntico antes/después de una pasada que **sí ancle**; y el diff no incluye los 4 ficheros de la familia Verifactu | **SÍ** | Gate [6], mi pasada: anclajes `4 → 5` (sí ancló) y `f0f756bd83d29e2d… vs f0f756bd83d29e2d…`. `git diff --name-only master..HEAD` → 13 ficheros; ninguno es `routes/invoices.js`, `verifactu.js`, `verifactu-envio.js` ni `verifactu-cola.js` (lo comprueba también el propio gate, `:380-383`). Este commit toca **2** ficheros, los dos nombrados en el §4 del plano |
| 8 | **Se ve sin abrir el código:** las dos pantallas responden 200 con su URL final, la primera muestra el veredicto de la última auditoría en palabras, y el correo lleva ese veredicto con su cobertura, el `.tsr` y `⚠️ ALARMA` en el asunto | **SÍ** | `/admin/verifactu/anclajes`, sonda propia con el código nuevo: `status=200`, `location=null`, 161.905 bytes, con el bloque `Última auditoría completa … 28 de 28 anclajes comprobados uno a uno, todos en orden.` `/superadmin/integridad`, sonda propia (el fichero es de las 18:44, también posterior al arranque del servicio): `status=200`, `location=null`, `Integridad de facturas`, `<th>Sellado</th>` y **27 filas** de negocios reales, cada una diciendo «sin anclar». **Correo, ejercitado EXTREMO A EXTREMO** (Resend de mentira vía `RESEND_BASE_URL`, negocio desechable con una alarma real): asunto `Sellado externo Verifactu — 2026-09-02 · ⚠️ ALARMA`, cuerpo `· rev-anclaje-correo-…: ALARMA en el anclaje 2 (sellado 1/9/2026, 23:06:52): se han cambiado los datos del anclaje después de sellarlo`, y **un adjunto**: `rev-anclaje-correo-…-anclaje-3.tsr`. La rama `⚠️ ALARMA` que la revisión anterior dejó solo leída ya está medida |

**Ocho de ocho en SÍ.**

---

## 2. ¿Se construyó lo que decía el análisis?

Sí, y sin salirse. Este commit hace **exactamente** los dos arreglos que pedía la revisión del intento
4, y nada más: 2 ficheros, 33 líneas añadidas, 12 quitadas.

| Punto del rechazo anterior | Qué se hizo |
|---|---|
| La condición para relajar el arranque de la cadena era `limite`, no «queda algo sin mirar» | `verifactu-anclaje.js:432-433`: `fueraDeVentana > 0 ? … : …`, calculado antes en `:418`. Es literalmente el arreglo que se pidió, con el comentario `:422-431` explicando por qué la condición es esa y no `limite` |
| El gate no medía ese caso | `verify-verifactu-anclaje.mjs:513-519`: la misma mutación con `{ caPath, limite: ANCLAJE_COMPROBAR_LIMITE }`, **más una aserción previa de que la copia tiene menos sellados que el límite** (`:516-517`) — sin ella la prueba se degradaría en silencio el día que el fixture crezca. Buen detalle |
| Dos aserciones de pantalla medían el layout compartido y estaban garantizadas en rojo | `:406-407` y `:585-588`: ancladas al `<div>` de la auditoría y al `<div>` del aviso, con un `!!bloque` / `!!flash` delante para que un recorte vacío no pase por verde. Eso último es lo correcto: sin el `!!`, un regex que no casa daría `''` y la aserción saldría en verde sobre nada |

El resto de los ocho pasos del §4 sigue en pie tal como lo verificó la revisión anterior; lo he
recorrido y no hay desviaciones. Lo que el §8 dice que no se toca (`sellar()`, `motivoAnclajeInactivo`,
la transacción del corte, systemd, menú, montaje, superadmin, los cuatro ficheros Verifactu) **no está
en el diff de este commit**.

---

## 3. El nivel de construcción

- **Fail-closed de verdad, y ahora sin la puerta lateral.** El arreglo no tapa un caso: **quita una
  condición que no medía lo que decía medir**. `limite` es «¿se pidió un recorrido acotado?»;
  `fueraDeVentana > 0` es «¿queda algo sin mirar?». La segunda es la pregunta que justifica relajar el
  arranque, y ahora es la que se hace. Es el cambio pequeño y correcto, no el parche.
- **Una sola función construye el texto de la cabecera** (`textoCabecera:106`), llamada desde
  `raizCanonica:128` y `cabeceraDeFila:142`: no pueden divergir, que era el requisito duro del §2.3.
- **Los errores se distinguen:** ocho motivos distintos, cada uno con su frase; el `detalle` de
  `openssl` se recorta a la primera línea (`:235`) para que un volcado de `asn1_d2i_read_bio` no acabe
  en la pantalla del dueño.
- **Se cierra lo que se abre:** los dos directorios temporales de `sellar()` y `verificarToken()` van en
  `finally` (`:203-205`, `:237-239`); las copias del gate se borran por lista en su `finally`
  (`:625`), y el negocio se tira entero. Comprobado: cero residuo tras mi pasada.
- **Se puede probar por partes:** `clasificarFilaVentana` y `localizarPrimerTocado` son funciones puras
  sobre una fila y un `db`; `opts.ahoraMs` permite probar la frescura sin esperar un día; y el veredicto
  se calcula de contadores que se devuelven enteros, así que una prueba puede afirmar sobre la
  cobertura y no solo sobre el color.
- **Sin números a mano donde debe haber configuración:** `ANCLAJE_COMPROBAR_LIMITE` y `ANCLAJE_LATIDO_H`
  salen del entorno con valor por defecto. *(Queda `HORAS_FRESCO = 48` fijo en
  `verifactu-anclaje-routes.js:21`, que es el cartel de arriba —no el bloque de auditoría, que sí usa
  `ANCLAJE_LATIDO_H * 2`—; ver observaciones.)*
- **Repetible sin duplicar efectos:** la tabla de auditorías es de solo-añadir y la escribe un único
  proceso `oneshot`; `verificarAnclajes` solo lee.

---

## 4. Qué se rompe

- **La cadena de VERI\*FACTU: no se toca.** Medido (criterio 7) con una pasada que **sí ancló**.
- **Datos que ya existen:** no hay ni un anclaje en producción (§1.4 del análisis; y mi sonda del
  superadmin lo confirma de otra manera: las 27 filas dicen «sin anclar»). El cambio de este commit no
  toca el formato de la raíz, así que ni siquiera reabre ese riesgo.
- **Falsas alarmas por el arreglo (riesgo 2 del análisis):** la regla nueva solo se aprieta cuando
  `fueraDeVentana === 0`, es decir, cuando la ventana cubre **todos** los sellados — y entonces exigir
  `secuencia = 1` y `raiz_anterior` vacía es exactamente lo que el producto escribe (`anclar():282`).
  El bloque [0]/[2c] del gate exige `cuadra` sobre la base intacta en cada pasada y lo dio.
- **Un `ventana[0]` sin guardia** (`:432-433`): con `fueraDeVentana > 0` la ventana nunca está vacía
  mientras `limite ≥ 1`, y `ANCLAJE_COMPROBAR_LIMITE` está guardado con `> 0`. Un `limite` negativo o
  cero pasado a mano reventaría; no hay ningún camino del producto que lo haga.
- **Que la pieza se encienda sola al fusionar (riesgo 8):** intacta. `motivoAnclajeInactivo` sigue
  exigiendo dos variables de `/etc/bamburu.env` y `systemctl list-timers` confirma que el timer del
  anclaje **no está instalado**.

---

## Observaciones (no bloquean)

Ninguna de estas impide aprobar. Las dos primeras son nuevas; las demás vienen de la revisión anterior
y siguen vivas — las repito porque siguen siendo ciertas, no para volver a contarlas.

1. **La mitad del color de la aserción del botón es inerte: nunca puede fallar.**
   `scripts/verify-verifactu-anclaje.mjs:585,587`. El recorte
   `htmlTrasBoton.match(/Comprobado ahora:[\s\S]*?<\/div>/)` empieza **después** del `<div style=…>`,
   que es donde vive el color. Medido con un flash pintado a propósito en `var(--ok)`: el recorte es
   `"Comprobado ahora: todo en orden</div>"` y `!/var\(--ok\)/.test(flash)` da **`true`** — pasa. El
   texto del mensaje («ni se pinta en verde») promete algo que no mide, y eso es justo la forma que
   `CLAUDE.md` llama *un censo que dice CERO y no es cierto*. **No bloquea** por dos motivos medidos:
   *(a)* el producto pinta bien (`parcial → var(--warn)`, `alarma → var(--danger)`,
   `cuadra → var(--ok)`, y la auditoría caducada en `var(--warn)` aunque el veredicto guardado diga
   `cuadra`), y *(b)* la regresión que el criterio 4 vigila la caza otra aserción del mismo bloque, la
   de `destino.includes('v=parcial')` (`:576`), que sí es real. Se arregla metiendo el `<div>` en el
   recorte: `/<div[^>]*>Comprobado ahora:[\s\S]*?<\/div>/`. Lo mismo aplica a `:406` si algún día se
   quiere afirmar el color del bloque de auditoría.
2. **El `disk I/O error` del gate ha vuelto, en la pasada siguiente.** En mi bloque [11], el anclaje
   28 quedó con `cadena_ok: 0` y `cadena_detalle: "factura —: error al leer las facturas: disk I/O
   error"` — el mismo síntoma que reportó la revisión anterior. **No es intermitente: son dos pasadas
   consecutivas**, así que no cae bajo la prohibición de perseguir rojos repitiendo barridos; es
   reproducible y se puede acorralar de una vez. No es disco lleno (35 % usado) ni descriptores
   (`ulimit -n` = 524288), y **no se reproduce** con solo un escritor abierto y 40 llamadas seguidas a
   `verifyTenantInvoices` sobre el mismo fichero (lo he probado). El disparador está en algo que hace
   el propio gate antes (las ~24 copias abiertas y cerradas del bloque [9]/[10], o el
   `wal_checkpoint(TRUNCATE)` de `:440`). Importa porque en producción ese mismo camino
   —`anclar()` → `verifyTenantInvoices(db.name)`, `verifactu-anclaje.js:271`— dejaría una alarma de
   origen **falsa** dentro de la cabecera sellada, y la pantalla la pintaría como «sellado · alarma en
   origen» para el dueño, sin forma de deshacerlo.
3. **`textoVeredicto` sigue devolviendo la frase verde por caída al final** (`verifactu-anclaje.js:490-492`).
   La pantalla la llama con un veredicto **leído del `.db`** (`verifactu-anclaje-routes.js:75`), que es
   escribible por el mismo atacante del modelo de amenazas: un `veredicto` desconocido produce «N de M
   anclajes comprobados uno a uno, todos en orden». El color sí sería ámbar (`:79` solo pinta verde con
   el literal exacto), así que el daño está acotado, pero la frase miente. Un
   `if (r.veredicto === 'cuadra')` explícito y un `return 'veredicto desconocido: …'` al final lo cierran.
4. **La alarma guardada pierde su fecha en la pantalla** (`verifactu-anclaje-routes.js:31`):
   `veredictoDeAuditoria` pone `sellado_at: null` porque `verifactu_anclajes_auditorias` no guarda esa
   columna → «ALARMA en el anclaje 7 (sellado **fecha desconocida**)». Medido en mi sonda. **El correo
   NO tiene este problema** (llama a `textoVeredicto` sobre el resultado vivo: mi sonda leyó
   «ALARMA en el anclaje 2 (sellado 1/9/2026, 23:06:52)»), así que es solo la pantalla. Una columna
   `alarma_sellado_at` más en la tabla nueva —que aún no existe en ninguna base— lo arregla.
5. **El correo diario perdió el «por qué está apagado»** (`bamburu-anclaje-verifactu.mjs:122`): un
   negocio sin anclajes sale como «nunca se ha sellado nada: no hay ningún anclaje que comprobar.», sin
   el `motivoAnclajeInactivo`. Con el anclaje apagado —que es el estado de hoy y el que va a durar hasta
   que Ibrahin firme— esa línea es **lo único** que se va a leer, y ya no dice qué hay que encender. La
   función sigue importada y usada en `procesar()`; basta con concatenarla también aquí.
6. **El botón trae a memoria todos los tokens, incluidos los que no va a mirar**
   (`verifactu-anclaje.js:393`, `SELECT *` sobre la tabla entera antes de recortar la ventana).
   Contradice en pequeño la mitigación del riesgo 3 («en la petición HTTP solo queda la ventana acotada
   de 25 y lecturas baratas»). Dos consultas —un censo sin `token` para clasificar, y el `SELECT` con
   `token` solo para la ventana— lo dejan plano.
7. **`HORAS_FRESCO = 48` sigue fijo** (`verifactu-anclaje-routes.js:21`) mientras el bloque de auditoría
   de la misma pantalla usa `ANCLAJE_LATIDO_H * 2`. Si alguien cambia el latido por entorno, el cartel
   de arriba y el bloque de abajo dirán cosas distintas sobre la misma pantalla. Es el cartel viejo, no
   lo que este replanteo tocó, pero conviene atarlo a la misma constante.
8. **El bloque [10b] afirma un verde después de una mutación destructiva** (`:527`): borrar el ÚLTIMO
   anclaje deja `cuadra`. Es correcto y está declarado en `docs/verifactu/anclaje-externo.md`
   §«Qué NO prueba», pero es el único sitio del gate donde se exige verde tras romper algo; merece que
   el comentario enlace ese párrafo para que nadie lo lea como un descuido y lo «arregle».

---

## Lo que falta para ponerlo delante de un cliente (no es del programador)

Lo dejo escrito porque el aprobado no es un «ya está en producción»:

- **El gate sale con código 1** y `112 ✓ · 0 ✗ · 5 ⚠ NO VERIFICADO` — reproduzco exactamente lo que
  reportó el programador. Los cinco ⚠ son los bloques que necesitan el servidor sirviendo código
  fresco, y **esta sesión no tiene `sudo`**. Los he cerrado yo, uno a uno, fuera del proceso (criterios
  4, 5.2 y 8 de la tabla). Tras `sudo systemctl restart bamburu`, **una** pasada más debería dar
  `0 ✗ · 0 ⚠` — y ese reinicio pone la rama en producción, así que **no se hace hasta que Ibrahin
  firme**, que es lo que esta tarea pide.
- **La tarea lleva `firma: Ibrahin`.** Se queda en `tarea/anclar-verifactu-fuera`, construida y
  probada, hasta que él conteste. **Y el mecanismo no se enciende solo aunque se fusione:**
  `motivoAnclajeInactivo` exige `VERIFACTU_ANCLAJE_TSA` y `VERIFACTU_ANCLAJE_TSA_CA` en
  `/etc/bamburu.env` —donde el orquestador no escribe— y el timer no está instalado (comprobado con
  `systemctl list-timers`). Con esto en `master` no se llama a nadie ni se escribe una fila.
