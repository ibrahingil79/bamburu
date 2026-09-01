✅ APROBADO

# Revisión — `portal-formato-dinero` · El portal del cliente escribe el dinero a la inglesa

- **id:** `portal-formato-dinero`
- **intento revisado:** 4 (replanteamiento)
- **fecha:** 1 sep 2026
- **análisis pactado:** `docs/architecture/task-portal-formato-dinero-analysis.md`
- **rango:** `d93125e8508933c330d68563528753258e144825..HEAD` — un commit: `da78a89`
- **ficheros tocados:** `TABLERO.md`, `scripts/run-gates.mjs`, `scripts/lib/gate-env.mjs` y los
  cinco documentos de `docs/architecture/`. **Cero ficheros de `modules/`.**

> **Nota de método:** el §6 del análisis declara que los ocho criterios son **estáticos** y que
> ninguno exige ejecutar un gate. Esta revisión los ha comprobado así: leyendo código, el índice de
> git y el diff. **No he lanzado ningún barrido, gate ni comprobación** (`RITUAL.md`). Lo único que
> he ejecutado son los dos `node --check` que el propio criterio 3 nombra, lecturas de sólo lectura
> de `data/control.db` y `grep`/`git diff`.

---

## 1. Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | `ROJOS_CONOCIDOS` tiene **exactamente dos** entradas, `'verify-dinero-espanol'` y `'gate-portal-ampliado'`, cada una `{ desde: '1 sep 2026', motivo }`, con causa por fichero y línea y la tarea que la cierra | **SÍ** | Extraído el literal de `scripts/run-gates.mjs:123` y evaluado en aislado: `claves: ["verify-dinero-espanol","gate-portal-ampliado"] total: 2`; ambas con `claves= desde,motivo` y `desde= "1 sep 2026"`. Contenido del `motivo` comprobado por subcadena: la primera contiene `descuentos.js:163`, `2097` y `TABLERO.md` (todas `true`); la segunda `readOnlyGuard`, `core/tenant-middleware.js`, `suspended_admin`, `negocioDesechable` y `TABLERO.md` (todas `true`). Entradas en `run-gates.mjs:149-177` |
| 2 | El cambio en `run-gates.mjs` es **solo aditivo**: ninguna línea `-` salvo la cabecera | **SÍ** | `git diff d93125e..HEAD -- scripts/run-gates.mjs \| grep -c '^-'` → **1**, y esa única línea es `--- a/scripts/run-gates.mjs`. Los comentarios de las declaraciones retiradas (`gate-nav-inicio-disa` :133-141, `gate-vigia-agenda` :142-148) siguen íntegros; `DEUDA`, `ENTORNO` y `EXCLUIDOS` no aparecen en el diff |
| 3 | `node --check` sobre `run-gates.mjs` y `gate-env.mjs`: código 0 y sin salida | **SÍ** | `node --check scripts/run-gates.mjs` → `exit=0`, sin salida. `node --check scripts/lib/gate-env.mjs` → `exit=0`, sin salida. (Relevante porque el segundo `motivo` lleva comillas escapadas: `app.use(\'*\')`) |
| 4 | `git diff --name-only d93125e..HEAD -- modules/` **vacío**, e `invoices.js` fuera del diff | **SÍ** | El comando devuelve **vacío**. La lista completa del rango es: `TABLERO.md`, los cinco `docs/architecture/task-portal-formato-dinero-*.md`, `scripts/lib/gate-env.mjs`, `scripts/run-gates.mjs`. `modules/erp/routes/invoices.js` no aparece — el `toFixed(2)` que alimenta el hash de VERI\*FACTU queda intacto |
| 5 | Diff vacío en `verify-dinero-espanol.mjs` y `gate-portal-ampliado.mjs`; en `modules/portal/index.js`, `toFixed` = 0 y el `import { fmtEur }` presente | **SÍ** | `git diff d93125e..HEAD -- scripts/verify-dinero-espanol.mjs scripts/gate-portal-ampliado.mjs` → **vacío**: ningún instrumento se ha aflojado. `grep -c toFixed modules/portal/index.js` → **0**. `modules/portal/index.js:11` → `import { fmtEur } from '../erp/margen.js';   // el dinero, como en España: 6.023,00 €` |
| 6 | El comentario anterior a `export const CHROMIUM` contiene la ruta del binario del snap, `aarch64`, `SNAP_USER_COMMON` y `1 sep 2026`; ya no afirma que aquí no arranca un navegador; y la línea `export const CHROMIUM = …` es idéntica a la de `d93125e` | **SÍ** | Bloque `gate-env.mjs:64-112`. Recuentos en él: `/snap/chromium/current/usr/lib/chromium-browser/chrome` **3**, `aarch64` **7**, `SNAP_USER_COMMON` **2**, `1 sep 2026` **2**. La frase falsa ya no se afirma: aparece una sola vez, entrecomillada dentro del bloque `LA LECCIÓN`, para decir que **la conclusión era falsa** — que es literalmente lo que pedía el paso 2.7 del plan. La línea es byte a byte la misma: `git show d93125e:…` la da en `:66` y el fichero actual en `:113`, ambas `export const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH \|\| '/snap/bin/chromium';` |
| 7 | `git ls-files docs/architecture/` lista los cinco documentos, y las dos rutas citadas en la ficha del `TABLERO` existen en esa lista | **SÍ** | `git ls-files docs/architecture/ \| grep portal-formato-dinero` devuelve los cinco: `…-analysis-replanteo-0.md`, `…-analysis.md`, `…-feedback.md`, `…-informe.md`, `…-review-intento-1.md`. Los dos punteros de la ficha (hoy en `TABLERO.md:8306-8307`, desplazados por el crecimiento del fichero) citan `…-analysis.md` y `…-informe.md`: los dos están en esa lista. El puntero rancio queda cerrado |
| 8 | `TABLERO.md` §Deuda técnica trae los dos cabos nuevos con fecha `1 sep 2026`, y la entrada de `verify-dinero-espanol` dice que el rojo queda declarado en `ROJOS_CONOCIDOS` | **SÍ** | Diff de `TABLERO.md`, bloque `@@ -6044,6 +6044,45 @@`: (a) cinco líneas añadidas a la entrada existente de `verify-dinero-espanol` — *«Desde el 1 sep 2026 el rojo queda además declarado en `ROJOS_CONOCIDOS`…»*—, sin borrar ni reescribir nada de lo anterior; (b) cabo ⬜ *«`gate-portal-ampliado` SALE 19 ✓ · 9 ✗ POR `readOnlyGuard`… (1 sep 2026)»*; (c) cabo ⬜ *«LA RECETA PARA ABRIR UN NAVEGADOR… PERO NINGÚN GATE LA APLICA SOLO (1 sep 2026)»*, marcado 💡 como propuesta no construida |

**8 de 8 en SÍ.**

---

## 2. Que se haya construido lo que decía el análisis

Los seis pasos del §4, uno por uno:

| Paso | Qué pedía | Estado |
|---|---|---|
| 1 | Dos entradas en `ROJOS_CONOCIDOS`, sin tocar nada más del fichero | ✅ `run-gates.mjs:149-177`. El texto entregado es el del plano, sin recortes. Diff puramente aditivo (criterio 2) |
| 2 | Reescribir el comentario `:64-65` con los siete puntos, dejando `:66` intacta | ✅ Los siete están: valor por defecto y `NoNewPrivs`, los Chrome `x86-64` en `aarch64`, el binario interno con su `file …`, la receta entera copiable, el porqué del `HOME` con forma de snap y el `chrome_crashpad_handler`, el aviso de disco reformulado con `perfilDesechable` obligatorio, y la lección. Cero cambios de comportamiento |
| 3 | Dos cabos nuevos en §Deuda técnica + completar la entrada de `verify-dinero-espanol` | ✅ Criterio 8. El cabo de `gate-portal-ampliado` dice además, como pedía el plano, que es **la misma avería y el mismo arreglo** que el de `gate-sin-ventanitas` |
| 4 | Línea de registro en la ficha, sin borrar nada | ✅ `TABLERO.md:8315-8328`. Añade el párrafo *«Registro cerrado el 2026-09-01, en una segunda vuelta que NO toca `modules/`»* debajo del registro existente, que queda intacto |
| 5 | Versionar los cinco documentos | ✅ Criterio 7. El plano que falló (`…-replanteo-0.md`) se conserva, como mandaba |
| 6 | Un solo commit, con `Tarea: portal-formato-dinero`, diciendo que el arreglo es `bfea8a8` | ✅ `da78a89`, único commit del rango. Lleva la línea `Tarea: portal-formato-dinero` y abre con *«El arreglo del producto es bfea8a8 y AQUÍ NO SE TOCA»*. Declara además explícitamente que no se lanzó ningún barrido |

**Sin desvíos.** No se ha tocado ningún fichero que el análisis no nombre: los ocho del rango están
todos en el §4. No falta ninguno de los que sí nombra.

Verificado también lo que el plan **prohibía**: no hay `skip` ni excepción de regex metida en los
instrumentos (criterio 5), no se ha cambiado el `status` de ningún negocio (`data/control.db` sigue
con 7 `suspended_admin` + 1 `active`), y no se ha ejecutado `limpiar-restos-de-gates.mjs --hazlo`.

---

## 3. El nivel de construcción

**Sigue el patrón de la casa, no inventa uno al lado.** Las entradas tienen exactamente la forma que
el fichero ya consume: `run-gates.mjs:623` lee `d.desde` y `d.motivo` y no espera nada más; ambas
entradas tienen esas dos claves y ninguna otra. El tono es el de las declaraciones retiradas que
sirven de modelo: qué falla, desde cuándo, por qué no es del producto y qué lo cerraría.

**La declaración no afloja el instrumento — comprobado, no supuesto.** Es la pregunta que más importa
aquí, porque el atajo evidente era que declarar un rojo lo apagara. No lo hace:

- El código de salida se calcula en `run-gates.mjs:689` con `process.exit(malos.length ? 1 : 0)`, y
  `malos` sale de los resultados sin consultar `ROJOS_CONOCIDOS`. El barrido **seguirá saliendo 1**.
- El recuento `pasa/resultados.length` (`:667`) tampoco lo consulta.
- El diccionario solo se usa en tres sitios: imprimir (`:621-624`, con el rótulo explícito *«el gate
  SÍ se ejecuta»*), el censo (`:553`) y la Pieza D (`:637`).

**Las claves enganchan de verdad con el mecanismo.** Los nombres son los reales del corredor:
`gates-mapa.mjs:51` (`verify-dinero-espanol`, en `RAPIDO`) y `:229` (`gate-portal-ampliado`), y la
Pieza D compara con `r.gate`, que se rellena con ese mismo nombre en `:410`. Una clave mal escrita
habría dejado dos declaraciones muertas que nunca se imprimen y una Pieza D que nunca caduca; no es
el caso.

**No debilita el censo.** Añadir las dos claves a `declaradosAqui` (`:553`) las saca de `invisibles`,
pero las dos ya estaban en grupos del mapa, así que nunca fueron invisibles: el efecto neto sobre la
cobertura declarada es **cero**. No se ha escondido ningún gate por la puerta de atrás.

**Repetible, sin efectos que cerrar.** Es dato declarativo y comentarios: no abre ficheros, no lanza
procesos, no crea temporizadores, no escribe en ninguna base de datos ni migra nada. Se puede leer y
juzgar por partes sin levantar el producto — que es justo lo que ha permitido revisarlo sin ejecutar
un solo gate.

**Los errores se distinguen entre sí.** Los dos rojos no van al mismo saco: el primero se declara
como *rojo anterior a la entrega, de otra pantalla*; el segundo como *estado administrativo de la
máquina, no del producto ni del gate*. Cada uno con su causa medida y su tarea de cierre distinta.

**Y las declaraciones son ciertas.** Un `ROJOS_CONOCIDOS` con un motivo falso sería peor que uno
vacío —es la lección del censo de ventanitas—, así que he verificado los hechos que afirman:

- `modules/erp/routes/descuentos.js:163` es `const CATS=${JSON.stringify(cats)}, PRODS=…`, dentro de
  un `<script>` abierto en `:161`, sin escapar `</`. ✔
- La aserción *«ninguna pantalla enseña una fecha en formato inglés»* está en
  `git show b1f8770:scripts/verify-dinero-espanol.mjs` línea 162. ✔ El rojo es anterior a la entrega.
- `core/tenant-middleware.js:115` `readOnlyGuard` devuelve 403 a todo lo que no sea
  `GET`/`HEAD`/`OPTIONS`, y está montado en `index.js:1492` con `app.use('*', readOnlyGuard)`. ✔
- `data/control.db`: 7 `suspended_admin` y 1 `active`, con `desarrollo-bamburu` entre los suspendidos. ✔
- `gate-403-permiso.mjs` y `gate-historial-clinico.mjs` usan `negocioDesechable`. ✔
- La salida citada (19 ✓ · 9 ✗, con el bloque `[1]` verde incluida la aserción `600,00 €`) está
  transcrita en `…-informe.md` §3, líneas 195-250. ✔ El puntero del comentario no es rancio.

---

## 4. Qué se rompe

**Nada del producto.** No se sirve una línea distinta al usuario: `/portal/<token>` y
`/admin/portal/mensajes/<id>` quedan como en `bfea8a8`. No hace falta reiniciar el servicio.

**La cadena de VERI\*FACTU no se toca.** El riesgo 5.1 del análisis (que alguien «aprovechara» para
retocar `modules/`) está mitigado y **medido**: el diff de `modules/` es vacío e
`invoices.js:156` no aparece en el rango.

**Los riesgos declarados, uno por uno:**

- **5.2 — que declarar se vuelva la forma barata de no arreglar.** Mitigado con las tres capas que
  el plano prometía, y las tres existen: cada `motivo` nombra su tarea de cierre, el `desde` deja ver
  una declaración vieja, y la Pieza D (`:637-645`) ya vigila estas dos entradas —hasta hoy no
  vigilaba nada porque el diccionario estaba vacío—.
- **5.3 — declaración rancia.** Cubierto por la misma Pieza D. Y el cierre está anclado en los dos
  sentidos: la entrada de `run-gates.mjs` nombra el cabo del `TABLERO`, y el cabo del `TABLERO`
  nombra la entrada de `ROJOS_CONOCIDOS`. Quien cierre `descuentos.js:163` se encontrará el aviso.
- **5.4 — que la receta caduque con una actualización del snap.** Mitigado como se prometió: el
  comentario no es solo rutas, lleva la regla para rederivarlas (*«buscar el ELF `aarch64` DENTRO del
  snap, nunca el envoltorio de `/snap/bin`»*), la orden que lo comprueba y su fecha.
- **5.5 y 5.6 — concurrencia, migraciones, datos existentes, pantallas.** No aplican, y ahora está
  verificado que no aplican: el diff no toca ni una consulta, ni un `runMigrations`, ni una pantalla.

**Efecto en la próxima pasada del barrido, dicho sin adornos:** seguirá saliendo en rojo por las dos
mismas causas y con el mismo código 1. Lo que cambia es que los dos rojos saldrán **con nombre, fecha
y dueño** en vez de anónimos. El commit y el `TABLERO` lo dicen los dos, así que nadie leerá esto
como «ya no queda nada».

---

## Observaciones (no bloquean)

1. **Los `motivo` se imprimen en una sola línea larguísima.** `run-gates.mjs:623` hace
   `console.log('  · ' + g + '  (declarado el ' + d.desde + ')\n      ' + d.motivo)`: el `motivo` de
   `verify-dinero-espanol` son ~900 caracteres seguidos sin un solo salto, así que en el terminal
   saldrá como un párrafo envuelto a lo bruto, sin la sangría de las demás líneas. Las declaraciones
   retiradas que sirven de modelo son **comentarios**, y por eso se leen bien: iban plegadas a mano.
   El contenido es el correcto y ningún criterio habla de formato — pero si alguna vez se tocan estas
   líneas, plegar el `motivo` en el sitio de impresión (o guardarlo con `\n      ` intercalados) haría
   legible justo lo que existe para ser leído en cada pasada.

2. **La receta sigue siendo un comentario, y un comentario no se verifica solo.** Es exactamente el
   fallo que esta entrega corrige, en el mismo fichero: la frase anterior también era un comentario y
   llevaba meses mintiendo. Aquí está bien mitigado (regla de rederivación + `file …` + fecha + cabo
   abierto), y el análisis descartó la automatización con motivo suficiente —alcanza a 40+ gates—.
   Pero conviene que quede dicho: **la mitigación depende de que alguien lo lea**, y el arreglo de
   verdad es el cabo nuevo. Mientras no se construya, ningún gate de navegador arranca solo aquí.

3. **El `Informe:` de la ficha apunta a un documento de la vuelta anterior.** `…-informe.md` es el
   informe del intento 2/3: su §5 sigue titulándose *«Lo que hace falta para cerrarlo — y es UNA
   decisión, no más código»*, que ya no describe el estado de la tarea. Se conserva a propósito, como
   el plano `…-replanteo-0.md`, y el párrafo nuevo de la ficha (`TABLERO.md:8315`) explica la segunda
   vuelta — así que quien lea en orden no se confunde. Aun así, el puntero de la ficha nombra ese
   documento a secas; una coletilla del tipo *«(informe del intento 2; el cierre está en el párrafo de
   abajo)»* ahorraría una relectura dentro de seis meses.

4. **Las líneas que el criterio 7 cita como `TABLERO.md:8266-8267` viven hoy en `:8306-8307`.** El
   fichero creció 53 líneas con esta misma entrega. No es un defecto —he verificado por contenido, no
   por número—, pero es el recordatorio de siempre: un criterio anclado a un número de línea de un
   fichero que la propia tarea va a hacer crecer se queda desalineado antes de poder comprobarse.
