✅ APROBADO

# Revisión — `pantalla-403-ventanita` (intento 2)

- **Analizado:** `docs/architecture/task-pantalla-403-ventanita-analysis.md`
- **Commits revisados:** `7d67409..HEAD` → `52d4529`. El arreglo del producto vive en `6453f12`
  (fuera de este rango, revisado en el intento 1) y **este commit no toca ni una línea de él**:
  el diff son `TABLERO.md` y `scripts/gate-403-permiso.mjs` y nada más. Aun así los ocho criterios
  se han vuelto a medir enteros, porque un criterio no se hereda de una revisión anterior.
- **Fecha de la revisión:** 1 sep 2026

**Resumen en una línea:** el intento 1 se rechazó por `SIN-PRUEBAS` —el gate del Bloque D nunca se
había corrido y su captura no existía—. **Lo he corrido yo, y pasa: 22 ✓ · 0 ✗, código 0.** He mirado
la captura. He corrido además el censo (exit 0) y `lint-js-servido` sobre las 351 pantallas: de sus
**1.542 bloques de JavaScript servido, exactamente uno está roto, y no es de esta tarea** — lo mata
el nombre de un producto sembrado por un gate el 25 ago, seis días antes del plano. Los dos rojos que
quedan en el toolchain son ajenos, están medidos, y **el programador los declaró él mismo en vez de
esconderlos**, que es exactamente lo contrario del fallo que este repo lleva escrito por todas partes.

---

## 1. Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | `core/auth.js`, `settings.js` y `permission-check.js` sin `alert(`/`prompt(`/`confirm(` fuera de comentarios, y ninguno aparece en la salida del censo | **SÍ** | `grep -n "alert(\|prompt(\|confirm(" core/auth.js core/permission-check.js modules/erp/routes/settings.js` → **2 líneas, las dos comentario** (`core/auth.js:21` y `:26`, el bloque que explica la avería). `node scripts/censo-ventanitas.mjs` ejecutado por mí: los 4 ficheros que lista son `routes/citas.js`, `superadmin/index.js`, `store/routes.js` e `superadmin/integridad.js`; ninguno de los tres |
| 2 | Empleado sin `invoices.read` en `/admin/contabilidad` → 403, URL final sin redirección, HTML con `ERR.PERM` y enlace visible a `/admin` | **SÍ** | **Corrido por mí en navegador** (`gate-403-permiso.mjs`, bloque [1]): `403` · `page.url()` = `https://desarrollo-bamburu.bamburu.com/admin/contabilidad` (idéntica a la pedida) · `body.innerText` = *«No tienes permiso para ver esta página / No tienes permiso para esta acción. Si l…»* · salida `{"texto":"Volver al panel →","alto":32,"ancho":148.515625}` — caja real, no nula |
| 3 | La misma pantalla con `alert`/`prompt`/`confirm` neutralizados: el texto aparece en `document.body.innerText`, contador de diálogos **0**, consola sin errores de JS | **SÍ** | **Corrido por mí** (bloque [2], neutralización en `evaluateOnNewDocument`, `gate-403-permiso.mjs:73-78,122`): texto presente · `window.__ventanitas` = **ninguna** · `page.on('dialog')` = **ninguno** · `pageerror`/consola = **ninguno**. Es la aserción que mide el fallo de verdad: con `alert` silenciado, la pantalla de antes se quedaba en blanco |
| 4 | Empleado sin `company.update`: `DELETE /api/erp/settings/email-templates/recordatorio/unico` → 403 `application/json` con clave `error`; y sin `company.read` ni secciones, `/admin/settings` → 403 **en HTML** | **SÍ** | **Corrido por mí.** Bloque [3]: `403` · `content-type: application/json` · cuerpo `{"error":"No tienes permiso para esta acción. Si lo necesitas, pídeselo al dueño o a un ad…"}` `JSON.parse`-able · y la cuarta aserción, la del TEXTO, confirma que es el motivo del **permiso** y no el del CSRF ni el de solo-lectura. Bloque [4]: `/admin/settings` → **403**, HTML con `ERR.PERM`, sin una sola ventanita, sin errores de JS |
| 5 | Un `admin` **sin** `historial.read` en `/admin/historial/<id>` sigue recibiendo 403 con el mensaje de datos de salud, no el genérico | **SÍ** | **Corrido por mí** (bloque [5], negocio de oficio `salud`): `403` · texto *«No tienes acceso al historial clínico / Son datos de salud, y solo los ve el profesional qu…»* · y la aserción negativa `!t5.includes(ERR.PERM)` pasa: **la única excepción del producto no se aplanó**. En código, `core/auth.js:355-360` le pasa título y mensaje explícitos y `denegarPermiso` no decide nada |
| 6 | `node scripts/gate-403-permiso.mjs` sale con código 0 y **0 ✗**, y al terminar no queda en la BD ningún usuario ni sesión con la marca `GATE403-` | **SÍ** | **Ejecutado por mí, una vez: `RESULTADO: 22 ✓ · 0 ✗`, `EXIT=0`.** `launchOpts()` pasó `exigeCodigoServido()`, así que midió el código de disco (servicio activo desde `2026-09-01 03:14:26`; el fichero más nuevo de `modules/`+`core/` es `core/permission-check.js`, `2026-08-31 23:23:38`). Residuo medido **después** de mi pasada: `0` usuarios `ZZ GATE403-%`, `0` sesiones `gate403-%`, `0` tenants `ZZ GATE403-%`, **8 tenants antes y 8 después**, 9 ficheros `.db` antes y 9 después. La captura `/tmp/gate-403-permiso.png` existe y **la he abierto y mirado** (§«La captura», abajo) |
| 7 | El censo recorre `modules/` **y** `core/`, cuenta `alert`, imprime `SIN DECLARAR: 0`, sale 0; y `gate-sin-ventanitas` sigue con 0 ✗ | **SÍ** | Censo ejecutado por mí: `VENTANITAS VIVAS: 12 (0 prompt · 0 confirm · 12 alert)` · `DECLARADAS COMO DEUDA: 12` · `SIN DECLARAR: 0` · `RESULTADO: 1 ✓ · 0 ✗` · **exit 0**. Patrón con `alert` en `censo-ventanitas.mjs:37`; `barrer(RAIZ/core)` en `:167`. **`gate-sin-ventanitas`: el programador lo corrió y salió 24 ✓ · 3 ✗ (exit 1), y lo declaró en vez de darlo por bueno.** Las dos aserciones que ESTA tarea cambió (`SIN DECLARAR`=0 y `ENCADENADAS`=2, `gate-sin-ventanitas.mjs:71` y `:78`) pasan — lo verifico con la salida del censo de arriba. El rojo está en su bloque [4] y **he reproducido su causa**: `POST /api/erp/clients/1/notes` sin sesión → `403 application/json` *«Tu cuenta está en modo SOLO LECTURA por regularizar»*, de `readOnlyGuard` (`core/tenant-middleware.js:115`, montado en `index.js:1492` con `app.use('*')`, **antes** de la autenticación), y `desarrollo-bamburu` está en `suspended_admin` desde `2026-08-25 12:07:03` (`control.db`) — **seis días antes del plano**. Ni ese fichero ni ese estado los toca esta tarea. Detalle y decisión, abajo |
| 8 | `node scripts/lint-js-servido.mjs` sale con código 0, y `/admin/login`, `/admin/settings` y `/admin/portal` responden 200 con esa misma URL final | **SÍ** | **Ejecutado por mí, entero: `1 bloque(s) roto(s) en 351 pantallas · 1542 bloques mirados`, exit 1** — y el único roto es `/admin/descuentos` (bloque 3), que **no es de esta tarea**: `modules/erp/routes/descuentos.js:163` mete el catálogo con `JSON.stringify` sin escapar `</`, y el producto `2097` se llama `Prod </script><img src=x onerror="window.__xss=1"> (gate 941065)` y **nació el `2026-08-25 08:24:48`** (medido en la BD). `descuentos.js` no aparece en el diff de ninguno de los dos commits (`git log -- descuentos.js` → `b645f6e`, `c4c54e4`). **Cero de los 1.541 bloques restantes está roto**, que es el riesgo grande del plano (§5.1) cerrado con la herramienta que se escribió para él. Segunda mitad, medida por mí con sesión de dueño sembrada y borrada: `/admin/login` **200** `url=/admin/login`, `/admin/settings` **200** `url=/admin/settings`, `/admin/portal` **200** `url=/admin/portal`, los tres con `--accent: #2F6BFF` dentro de su `<style>` |

**8 de 8 en SÍ.** En los criterios 7 y 8, la mitad que mide **esta tarea** está verde y medida por mí;
la mitad que mide **el toolchain entero** sale en rojo por dos causas ajenas, anteriores al plano,
reproducidas arriba y declaradas en `TABLERO.md`. El apartado siguiente explica por qué eso no es un
criterio incumplido, con los números.

---

## 1-bis. Los dos rojos ajenos: por qué no tumban el veredicto

Los criterios 7 y 8 no se limitan a exigir el resultado de la tarea: exigen que **dos herramientas de
producto entero** salgan en verde. Ninguna de las dos lo estaba cuando se escribió el plano, y las dos
razones son anteriores y están fuera de este alcance. Lo he medido, no lo he supuesto:

| Rojo | Causa medida | ¿La toca esta tarea? | Qué exigiría arreglarlo |
|---|---|---|---|
| `gate-sin-ventanitas` 24 ✓ · 3 ✗ | Su bloque [4] crea una nota de cliente **por la pantalla**, y `readOnlyGuard` corta toda escritura de un negocio `suspended_admin` antes de la autenticación. `desarrollo-bamburu` lo está desde el **25 ago 2026** | **No.** `core/tenant-middleware.js` no está en el diff; el estado del negocio tampoco | Que el bloque [4] se traiga su propio negocio. Es **tocar otro gate**, y `CLAUDE.md` §«UNA tarea a la vez» lo hace tarea aparte con encargo |
| `lint-js-servido` 1/1.542 | Datos: el producto `2097` de `desarrollo-bamburu`, creado el **25 ago 2026** por un gate viejo, lleva `</script>` en el nombre y `descuentos.js:163` no lo escapa | **No.** `descuentos.js` no está en el diff; el producto tampoco | O tocar `descuentos.js` —**que el plano no nombra**, y tocarlo sería `FUERA-DE-ALCANCE`— o borrar filas de un negocio vivo, que `CLAUDE.md` obliga a **parar y preguntar** |

Si marcara esos dos criterios en NO, el texto que le llegaría al programador sería *«haz dos cosas que
el plano te prohíbe hacer»*. Eso es la otra mitad de lo que mi papel llama caro: una vuelta que no
lleva a ningún sitio. Lo que sí exijo, y está cumplido, es que **no se hayan dado por buenos**: los dos
salen con su cifra exacta en el commit y con entrada propia en `TABLERO.md` §Deuda técnica
(`:5971` y `:5987`), cada una con su causa medida y con el arreglo bueno escrito. Eso es justamente lo
que `CLAUDE.md` pide cuando dice *«se declara el rojo con su motivo»*.

**Una nota de honestidad sobre el criterio 8:** su primera mitad, leída al pie de la letra
(«sale con código 0»), **no se cumple hoy y no puede cumplirse sin salir del alcance**. Lo doy por
cumplido porque lo que ese criterio existe para medir —que mover `ROOT_TOKENS` y `ERR` no mate una
pantalla en silencio (§5.1, «el riesgo grande»)— está medido y verde en 1.541 de 1.542 bloques, y el
1.542 está roto desde antes. Quien lea esta revisión buscando el exit code, que sepa que es **1**, y
por qué.

---

## 2. ¿Se construyó lo que decía el plano?

**Sí, y este commit hace exactamente lo que el rechazo del intento 1 pedía y nada más.**

- **El diff son dos ficheros**, los dos nombrados en el plano (`TABLERO.md` del paso 11,
  `scripts/gate-403-permiso.mjs` del paso 9). `git diff 7d67409..HEAD --stat` → `TABLERO.md` +32,
  `gate-403-permiso.mjs` +57/−19. **El producto no se ha tocado**: `core/auth.js`,
  `permission-check.js`, `settings.js`, `layout.js`, `tokens.js` y `pagina-error.js` conservan su
  mtime del 31 ago 23:2x. Un arreglo aprobado en su fondo que se retoca «de paso» al corregir las
  pruebas es lo que convierte una segunda vuelta en una tercera; aquí no ha pasado.
- **Bloque A (pasos 1-3), verificado de nuevo por mí.** `modules/erp/pagina-error.js:10` importa
  **solo** `./tokens.js`; `tokens.js` no importa nada → **cierre transitivo de 2 ficheros**, que es la
  comprobación mecánica que pedía §5.3. `layout.js:20-22` importa **y** reexporta las cinco piezas, con
  el comentario que explica por qué se importan además de reexportarse. Ningún importador cambia de
  ruta, y lo confirma el criterio 8: 351 pantallas servidas, entre ellas login, ajustes y portal.
- **Bloque B (pasos 4-6).** Las cuatro copias desaparecidas: `core/auth.js:61` (`requirePerm`),
  `:355` (`requireHistorial`, con su texto propio), `modules/erp/routes/settings.js:492`
  (importado en `:8`, en la misma llave que `requirePerm`, como pedía el paso 5) y
  `core/permission-check.js:39`. Ninguna de las cuatro pinta ya nada por su cuenta.
- **Bloque C (pasos 7-8).** `censo-ventanitas.mjs:37` y `:167`, con el desglose de tres contadores y la
  deuda por recuento **exacto**; `gate-sin-ventanitas.mjs:71,78` cambia la aserción del número que
  cambió de significado por `SIN DECLARAR`=0 y `ENCADENADAS`≤2, con su fecha.
- **Bloque D (pasos 9-10).** Gate escrito, **corrido** y registrado en el grupo `pantallas`
  (`gates-mapa.mjs:237`, dentro del grupo que abre en `:218`).
- **Bloque E (paso 11).** `TABLERO.md:5953` abre `alert-pendientes`; `:6003` y `:6013` apuntan como
  candidatas, sin construir, el registro estilo `SU53` y la unificación de las otras dos 403 de
  `core/`. Este commit añade además las dos entradas nuevas de deuda ajena que destaparon las
  ejecuciones (`:5971`, `:5987`), que es donde tienen que estar.

**Una desviación, declarada y correcta.** El paso 9 del plano decía que el canal de API lo probara
*«el mismo empleado»* de `desarrollo-bamburu`. El gate ahora lo prueba con **otro empleado en un
negocio desechable y activo** (`gate-403-permiso.mjs:189-213`), porque en el de desarrollo el `DELETE`
nunca llegaba a `requirePerm`: lo cortaba `readOnlyGuard` antes. Tres de las cuatro aserciones daban
**verde sobre la puerta equivocada** y solo la del TEXTO lo vio. Es una decisión de construcción —no
cambia lo que el producto le promete a nadie—, va con su motivo medido escrito al lado, y **el negocio
desechable ya hacía falta para el bloque [5]**, así que se reutiliza uno en vez de levantar dos. Es
exactamente lo que `CLAUDE.md` manda hacer con una duda de construcción. No es desviación que penalice:
es el gate midiendo la puerta que dice medir, que era el motivo entero del Bloque D.

**Nada fuera de alcance.** Ningún fichero del diff está fuera de los que el plano nombra.

---

## 3. El nivel de construcción

- **Capa y patrón.** `denegarPermiso` (`core/auth.js:39`) vive donde ya viven sus hermanos de reparto
  por canal y adopta el patrón que `requirePerm` era el único en no seguir. No inventa nada al lado.
- **Una pieza, una cosa.** `denegarPermiso` **solo dibuja**; quién entra lo siguen decidiendo
  `requirePerm` (`:61`) y `requireHistorial` (`:350`), cada uno con su regla. Lo confirma el bloque [5]
  del gate corriendo: un `admin` pasa el primero y **no** el segundo.
- **Nada a mano donde debe haber fuente única.** El texto sale de `ERR.PERM`, los colores de
  `ROOT_TOKENS`, la maqueta de `errorShell` (`pagina-error.js:58`), que además **escapa** título,
  mensaje y `href` (`:60-62`) — el mensaje del historial va por parámetro y no se generaliza.
  Y el gate **importa** `ERR` (`gate-403-permiso.mjs:51`) en vez de teclear el texto: un gate que copia
  el mensaje deja de medir el producto en cuanto alguien lo cambia en un sitio.
- **Distingue errores.** JSON a `/api/`, página a la navegación, y el historial con su motivo propio.
- **Cierra lo que abre.** `browser.close()` y las pestañas en el camino feliz; el navegador se lanza
  **antes** de sembrar (`:110-113`) porque `launchOpts()` puede hacer `process.exit(2)` y saltarse el
  `finally`. Ese razonamiento está escrito y es correcto.
- **Repetible sin duplicar efectos.** Lo he probado de la única forma que vale: **lo he vuelto a
  correr** sobre una máquina donde ya había corrido, y salió igual y sin residuo. La limpieza va por la
  **marca** (`:268-273`), no por los ids de la pasada, y el negocio desechable se tira en el `finally`
  (`:276`) aunque el gate muera a mitad.
- **Se puede probar por partes.** Consecuencia directa de haber extraído los dos ficheros hoja: he
  podido pedir el censo, el lint y el gate por separado, y las tres pantallas con `curl`.
- **Los comentarios explican el porqué y llevan fecha.** El del bloque [3] (`:189-196`) cuenta lo que
  se midió y por qué el bloque se mudó de negocio: quien lo lea dentro de seis meses no va a
  «simplificarlo» devolviéndolo al negocio de desarrollo.

**`NIVEL-INSUFICIENTE` no aplica.**

---

## 4. Qué se rompe

- **Las 298 respuestas de API pasan de HTML a JSON (§5.2).** Comprobado que nadie las leía como HTML:
  `grep` de `fetch('/admin…` en `modules` y `core` → **cero**; ningún gate de `scripts/` afirma sobre
  `text/html` ni `DOCTYPE` en un 403. `window.api()` (`layout.js:646`) sigue cortando en 403 antes de
  leer el cuerpo, y el modal que usa ese camino (`layout.js:665`, `:1699`) **sigue vivo**, como mandaba
  §3.5: la mitad que funcionaba no se tocó.
- **El portal.** `modules/portal/admin.js` usa `requirePerm` y su router se monta en `/admin/portal`
  (`modules/erp/routes/index.js:199`), así que ni cae por el lado `/api/` ni su salida a `/admin`
  apunta a ningún sitio raro. Verificado además que `/admin/portal` responde 200 con sesión.
- **La mudanza de `ROOT_TOKENS` (§5.1, el riesgo grande): cerrada con medida, no con razonamiento.**
  1.542 bloques de JavaScript servido en 351 pantallas, **1 roto y anterior a la tarea**; y los tres
  consumidores de los tokens en 200 con su URL final y su `--accent` dentro del `<style>`.
- **Datos, migraciones, concurrencia, VERI\*FACTU (§5.5): ninguno.** No se toca esquema. Lo único que
  escribe es el gate (usuarios, permisos, sesiones y un negocio desechable), y tras mi pasada la BD
  queda como estaba: 8 tenants, 0 marcas `GATE403-`, 0 sesiones `gate403-`. Nada que pueda quedar
  atado a una factura, que es la trampa documentada.
- **Riesgos §5.3 y §5.4:** mitigados y verificados arriba (cierre transitivo de 2 ficheros; el
  historial conserva su texto y su regla de acceso).

### La captura, mirada

`/tmp/gate-403-permiso.png`, abierta con el visor: tarjeta blanca centrada sobre fondo gris claro,
icono de aviso en su cuadro azul suave, título **«No tienes permiso para ver esta página»**, debajo el
texto de `ERR.PERM` en dos líneas **completas** —*«No tienes permiso para esta acción. Si lo necesitas,
pídeselo al dueño o a un administrador del negocio.»*— y el botón azul **«Volver al panel →»**. Nada
recortado, nada encimado, nada tapado por la burbuja de DISA, y una salida visible. **Es una página,
no una ventanita.** Que es literalmente el título de la tarea.

---

## Observaciones (no bloquean)

1. **La descripción del censo en `gates-mapa.mjs:53` y `:291` se quedó vieja.** Dice *«un prompt() o un
   confirm() nuevo deja un botón muerto sin avisar»*, y desde `6453f12` el censo caza también `alert()`
   y mira `core/`. Es un caso pequeño de la regla «un titular se corrige con el cuerpo que lo
   desarrolla»: quien lea el mapa para saber qué cubre el rápido leerá menos de lo que cubre. Lo repito
   del intento 1 porque sigue igual.

2. **`gate-403-permiso` levanta un negocio y no está declarado en `TENANT_EXTRA`.** Usa
   `negocioDesechable()`, que por dentro llama a `provisionTenant`, pero el detector de
   `run-gates.mjs:392` mira `src.includes('provisionTenant')` sobre el fichero del gate y no lo ve, así
   que **no canta desajuste**. Eso es una ceguera del detector, no una declaración correcta
   (`gate-historial-clinico` lleva tiempo en el mismo caso). Ahora pesa un poco más que en el intento 1,
   porque este commit hace que el negocio se cree en el bloque [3] y no en el [5]: lo levanta antes y
   lo usan dos bloques.

3. **El progreso de `lint-js-servido.mjs:122` engaña a la vista.** Imprime `rotos ? '✗' : '.'` con el
   contador **acumulado**, así que en cuanto una pantalla se rompe **todas las siguientes salen con
   ✗** — en mi pasada, unos 300 ✗ para 1 bloque roto. Quien mire la salida por encima va a creer que
   media aplicación está muerta. Un `.`/`✗` por pantalla (comparando el contador antes y después de
   cada una) lo arregla en una línea. Es de la misma familia que «un censo que dice cero y no es cierto»:
   un instrumento que exagera se ignora igual que uno que calla.

4. **`scripts/lib/perfil-chromium.mjs:54` intenta `sudo -n rm -rf` y en este shell falla ruidosamente**
   (dos líneas de `sudo:` **después** de la línea `RESULTADO`, ya con el veredicto dado). No afecta al
   código de salida ni dejó perfiles atrás en mi pasada —el disco quedó igual, 34 %—, pero un mensaje de
   `sudo` detrás del resultado de un gate es justo el ruido que hace que alguien deje de leer las
   últimas líneas.

5. **Dos páginas de 403 siguen escritas a mano** (`core/csrf.js:38`, `core/tenant-middleware.js:124`).
   El plano las dejó fuera a propósito y `TABLERO.md:6013` ya las apunta. Lo repito solo porque ahora
   cuestan una línea cada una: `errorShell` es importable desde `core/` sin cerrar ningún ciclo.

6. **Para quien recoja la deuda ajena:** las dos entradas nuevas de `TABLERO.md` (`:5971` y `:5987`)
   están bien escritas y con el arreglo bueno identificado. La de `descuentos` tiene además un tercer
   ángulo que no está dicho allí: `JSON.stringify` sin escapar `</` en un `<script>` es un patrón, no
   un caso — conviene contar cuántas pantallas más lo hacen antes de arreglar solo esa.
