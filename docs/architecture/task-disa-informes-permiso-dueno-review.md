✅ APROBADO

# Revisión · `disa-informes-permiso-dueno` — El dueño no puede ver sus propios informes por DISA

- **Papel:** revisor · **Fecha:** 31 ago 2026
- **Análisis juzgado:** `docs/architecture/task-disa-informes-permiso-dueno-analysis.md`
- **Diff juzgado:** `ebb8f99..e5111df` (un commit, seis ficheros)
- **Método:** verificado **leyendo el código y con `git`**. **No se ha ejecutado ni un script ni un
  gate**: el encargo de revisión no trae línea de autorización y `RITUAL.md` no la concede por
  iniciativa propia. El propio análisis lo previó (§«Nota sobre la ejecución de comprobaciones»).

---

## 1 · Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | `owner` sin fila → `checkPermission(db, s, 'invoices','read') === true`; `admin` igual; `employee` sin filas → `false` | SÍ | `core/permission-check.js:14` añade `if (session.role === 'owner' \|\| session.role === 'admin') return true;` **después** de `:13` (`if (!session?.userId) return false;`) y **antes** del `SELECT` (`:15-20`). Es el gemelo exacto de `core/auth.js:17`. Para `employee` no hay camino nuevo: cae al mismo `SELECT` de siempre y devuelve `!!row` (`:21`). Y el rol llega de verdad: `getAdminSession` (`core/auth.js:104`) devuelve `role: row.role`, y en el handler de DISA `session` es `c.get('session')` (`modules/disa/index.js:2159`) puesto por `adminAuth` (`core/auth.js:218`) |
| 2 | `permisoDeSesion(db, session)` exportada a nivel de módulo, usada por `INFORMES_TOOL` y `DTO_TOOL`, sin lambda de permisos escrita en el handler | SÍ | `modules/disa/index.js:150` — `export function permisoDeSesion(db, session)`, entre `redactarSql` (`:141`) y `export function register` (`:153`), fuera de `register`. La usan `:2541` (`const permClave = permisoDeSesion(db, session)`), `:2542` (`INFORMES_TOOL`) y `:2544` (`DTO_TOOL`). La lambda vieja ya no está en el diff. Ver la §1-bis sobre `:2525`, que sobrevive **por diseño** |
| 3 | Con ese `hasPerm` del dueño: `listar().ocultos_por_permiso === 0`, `catalogo().areas` con las 7 de `AREAS`, `componer(ventas/base/fecha)` con `filas` y sin `error` | SÍ | Cadena leída entera: `permisoDeSesion` → `checkPermission` → `true` para todo con `role:'owner'`. Con eso: `modules/disa/informes.js:87` (`visibles = todos.filter(… hasPerm(per))`) no descarta ninguno → `:96` `ocultos_por_permiso = todos.length - visibles.length = 0`. `catalogo()` llama a `areasPara(hasPerm)` (`modules/erp/constructor-analitica.js:763-767`), que solo excluye por `!hasPerm(a.perm)` → las 7 de `AREAS` (`:714`: ventas, compras, clientes, inventario, contabilidad, agenda, catalogo). `componer` → `cruzar`: los tres candados que lanzan 403 (`:859`, `:874`, `:879-881`) están todos guardados tras `!hasPerm(...)`, y `('fecha','base')` no está en el `sinSentido` de Ventas (`:254`, que solo trae `['cliente','clientes']`) |
| 4 | Con ese `hasPerm`, `herramientasDeDescuentos(...).ver()` sin `error`; con el de un empleado sin permisos, con el error de permiso | SÍ | `modules/disa/informes.js:190` — `puede = () => hasPerm('invoices.read')`. Dueño: `true` → `ver()` (`:191-208`) devuelve `{promociones_vigentes, enlace}`. Empleado sin filas: `false` → `:192` devuelve `{ error: 'No tienes permiso para ver los descuentos (hace falta el de facturas).' }` |
| 5 | `node scripts/verify-disa-permiso-dueno.mjs` termina en 0, abre en `readonly`, y los recuentos no cambian | **SIN EJECUTAR** — no es un NO, ver §1-ter | El fichero existe y hace lo que el criterio pide: `scripts/verify-disa-permiso-dueno.mjs:37` (`new Database(tenantDb(SLUG), { readonly: true })`), `:40` lo AFIRMA (`db.readonly === true`), `:42-45` y `:131-137` cuentan `analytics_panels` y `user_permissions` antes y después, `:146` `process.exit(fail ? 1 : 0)`. Importa las piezas reales (`:19-24`), no una copia. **El verde no está medido**: la autorización para correrlo no está en este encargo |
| 6 | `gate-disa-informes.mjs` sin `() => true` como permisos del dueño, con los `hasPerm` restrictivos de [4] intactos, y termina en 0 | **SIN EJECUTAR** — no es un NO, ver §1-ter | La parte comprobable por lectura está: `scripts/gate-disa-informes.mjs:19` importa `permisoDeSesion`, `:56-58` construyen `{userId, role:'owner'}` → `permDueno` → `dueno`. `grep -n TODO` sobre el fichero da **dos** líneas: su definición (`:50`) y el único uso que queda, `:84` (`porPantalla = cruzar(…, hasPerm: TODO)`), que es el bloque [3] «la vía visual». Los restrictivos de [4] siguen letra por letra: `:94` (`p => p !== 'purchases.read'`) y `:109` (`p => p !== 'invoices.read'`). **El código de salida no está medido** |
| 7 | El diff son exactamente esos cinco ficheros más el nuevo; `TABLERO.md` no aparece | SÍ | `git diff --name-only ebb8f99..HEAD` → `core/permission-check.js`, `docs/auditorias/diagnostico-arquitectonico.md`, `modules/disa/index.js`, `modules/disa/informes.js`, `scripts/gate-disa-informes.mjs`, `scripts/verify-disa-permiso-dueno.mjs`. Seis, ni uno más. `TABLERO.md` no está. `git status --porcelain` solo muestra `?? docs/architecture/` (el análisis y esta revisión) |
| 8 | Ningún comentario sigue afirmando que el `hasPerm` de DISA es «el MISMO `checkPermission` de `requirePerm`» sin decir que la primitiva ya lleva el bypass | SÍ | `modules/disa/index.js:6` añade «incluido el bypass owner/admin, desde el 31 ago 2026». `:2537-2540` sustituyen la frase vieja por «El bypass está DENTRO de `checkPermission` (core/permission-check.js), no aquí». `modules/disa/informes.js:17-27` reescriben la regla 2 y además dejan escrito qué se prometía y qué pasaba. Barrido de los demás: `grep -n checkPermission` deja `modules/disa/index.js:300`, que dice «Owner/admin pasan por bypass (igual que requirePerm). Reutiliza checkPermission» — sigue siendo **cierto** después del cambio, así que no entra en el criterio |

**Recuento: 6 criterios en SÍ, 0 en NO, 2 sin ejecutar por prohibición del RITUAL.**

### 1-bis · La lectura del criterio 2, dicha en voz alta (porque admite dos)

En el handler de `/message` sobrevive **una lambda que llama a `checkPermission`**:
`modules/disa/index.js:2525`, `hasPerm: (m, a) => checkPermission(db, session, m, a)`, dentro de
`runQueryTool`. Leído al pie de la letra, «no queda ninguna lambda que llame a `checkPermission`
escrita dentro del handler de `/message`» estaría incumplido.

No lo doy por incumplido, y digo por qué en vez de elegir la mitad que conviene:

- El **Paso 2.4** del análisis ordena explícitamente **no tocar** ese punto (`:2512` en la numeración
  del análisis, `:2521-2526` hoy).
- El **R8** del propio análisis glosa el criterio con estas palabras: *«el criterio 2 exige que en el
  punto reparado no quede ninguna lambda de permisos escrita a mano»*. El punto reparado es el de
  informes/descuentos, no `runQueryTool`.
- Además, esa lambda **no tiene la misma forma**: recibe `(module, action)` porque es lo que espera
  `evaluateQueryAccess` (`:109`), mientras que `permisoDeSesion` recibe la clave entera. Sustituirla
  exigiría cambiar la firma de una pieza que el análisis declara fuera de alcance.

Con las tres cosas, la lectura estrecha es la que el análisis pretendía. Queda escrito para que
nadie tenga que reconstruirlo.

### 1-ter · Por qué 5 y 6 no son un NO

`RITUAL.md` y `CLAUDE.md` son tajantes: ningún gate ni comprobación —**ni el propio de la tarea**— se
ejecuta por iniciativa propia; hace falta autorización expresa, visible arriba del encargo, y vale
para una sola ejecución. Este encargo de revisión no la trae. El análisis lo previó y dejó dicho qué
hacer en ese caso (§«Nota sobre la ejecución»), y el programador lo declaró en el cuerpo del commit
`e5111df` en vez de callarlo:

> *«NO EJECUTADO, y no por olvido: los criterios 5 y 6 del análisis piden correr
> verify-disa-permiso-dueno.mjs y gate-disa-informes.mjs. RITUAL.md dice que ningún gate ni
> comprobación se ejecuta por iniciativa propia […] y este encargo no la trae.»*

Marcarlos NO sería castigar el cumplimiento de la norma. Se dejan escritos como **no medidos**, que
es lo que son: **este aprobado no incluye ningún verde de ejecución.** Lo que sí hay de constancia
está en la §4.

---

## 2 · ¿Se construyó lo que decía el análisis?

Los seis pasos, comparados uno a uno con el diff:

| Paso del análisis | Entregado | Observación |
|---|---|---|
| 1 · Bypass dentro de `checkPermission` + comentario del historial | Sí, `core/permission-check.js:1-10` (comentario) y `:14` (la regla) | El texto propuesto y el escrito coinciden. El `try/catch` ya existía en el fichero; no se ha tocado |
| 2.1 · `permisoDeSesion` a nivel de módulo, exportada | Sí, `:143-151`, entre `redactarSql` y `register` | Colocación exacta la pedida |
| 2.2 · `:2528-2531` la usan, comentario corregido | Sí, `:2536-2544` | |
| 2.3 · Comentario del import `:6` | Sí | |
| 2.4 · No se toca nada más del fichero | Sí | `:300`, `:330`, `:1031`, `:1420` y `:2525` intactos. Confirmado con `git diff`: solo tres hunks en el fichero |
| 3 · Cabecera de `informes.js`, sin cambios de código | Sí, `:17-27` | Solo comentario; el diff no toca ni una línea ejecutable de ese fichero |
| 4 · `scripts/verify-disa-permiso-dueno.mjs` nuevo, read-only, sin navegador ni LLM | Sí, 146 líneas | Una desviación declarada, ver abajo |
| 5 · El gate deja de medir una copia | Sí, `:19`, `:56-58`; `TODO` conservado solo en `:84` | |
| 6 · Una línea en `diagnostico-arquitectonico.md` §4.1, sin borrar nada, y `TABLERO.md` intacto | Sí, `:232-233` | El hallazgo se conserva entero |

**Desviación, una, y está declarada:** el script nuevo imprime con `process.stdout.write` en vez de
`console.log`, y lo explica en `scripts/verify-disa-permiso-dueno.mjs:28-30`. **Comprobado que el
motivo es cierto**, no una excusa: `orchestrator/validator.js:13-16` lista `console.log` entre los
`PROHIBIDOS` y `:78-87` hace fallar la validación de código por cualquier línea **añadida** que lo
contenga, sin filtrar por tipo de fichero. La salida sigue el estilo de la casa (`✓`/`✗`, contador,
`process.exit(fail ? 1 : 0)`). Es una decisión de construcción, del tamaño que el RITUAL manda
resolver sin preguntar, y va escrita con su motivo.

**Ficheros tocados que el análisis no nombra: ninguno** (criterio 7).

---

## 3 · El nivel de construcción

- **Capa y patrón.** La regla de autorización queda en `core/`, que es la capa de ese dominio, y el
  punto de llamada sube a nivel de módulo **exportado**, que es exactamente la forma que este mismo
  fichero ya había declarado y escrito con su motivo para `evaluateQueryAccess`
  (`modules/disa/index.js:323-325`). No se inventa una capa nueva al lado.
- **Una pieza, una cosa.** `permisoDeSesion` solo parte la clave y delega; `checkPermission` solo
  decide. Ninguna de las dos hace dos cosas.
- **Nada escrito a mano donde debería haber configuración.** No aparece ni una ruta, ni un id, ni una
  clave literal nueva. Los roles (`'owner'`, `'admin'`) van como literales, igual que en
  `core/auth.js:17` y `:224-225`: es la forma que ya usa el producto, y `PERMS` (`core/auth.js:6-11`)
  confirma que la lista de roles es cerrada y de cuatro.
- **Errores distinguidos.** El `catch` de `checkPermission` (`:22-24`) traga y devuelve `false` —falla
  cerrado— y **eso ya era así antes del cambio**: no se ha ampliado el saco. En el script nuevo, un
  fallo de aserción (código 1) y un aborto por no haber dueño (código 2, `:52`) son distintos, que es
  la convención de `gate-env.mjs:23-24`.
- **Lo que abre, lo cierra.** El script abre una sola base y la cierra en el `finally` (`:141-143`).
  No hay temporizadores, ni navegador, ni procesos hijos.
- **Repetible sin duplicar efectos.** El script no escribe: la base va en `readonly` (`:37`) y él
  mismo lo AFIRMA (`:40`). Correrlo diez veces deja el negocio igual. Es la forma barata de cumplir
  «lo que una prueba crea, la prueba lo borra»: no crear nada. Y se comprueba, además, contando
  `analytics_panels` y `user_permissions` antes y después (`:42-45` / `:131-137`).
- **Probable por partes.** Es justo lo que la tarea arregla: la decisión sale de una lambda enterrada
  en un handler de 400 líneas y pasa a ser una función importable. El script nuevo no levanta
  servidor, ni navegador, ni llama al modelo; el gate pesado sigue aparte.

No encuentro nada por debajo de lo exigido.

---

## 4 · Qué se rompe

**Los otros diez puntos de llamada.** Reenumerados a mano con `grep -rn checkPermission` (no me fío
de la lista del análisis sin repetirla): `modules/disa/index.js:330`, `:1420`, `:2525`;
`modules/erp/routes/invoices.js:971`, `conciliacion-routes.js:19`, `mostrador.js:44`,
`fichaje.js:35`, `quotes.js:359`, `recurrentes-routes.js:20` y `:31`. **Los diez ya llevaban el
bypass delante** (`c.get('isAdmin') ||`, `isAdminUser(session) ||` o `role==='owner'||role==='admin'||`),
así que para owner/admin cortocircuitan antes de llegar a la primitiva y para el resto de roles nada
cambia. `evaluateQueryAccess` corta en `:113` (`if (isAdmin) return null;`) antes de usar su
`hasPerm`. **Es un no-op en los diez.**

**El empleado.** El único camino nuevo es `role === 'owner' || 'admin'`. Un `employee` o un
`readonly` recorre exactamente las mismas líneas que ayer y acaba en el mismo `SELECT`. No se ha
aflojado nada. (Medido no está, ver §1-ter; leído sí, línea a línea.)

**El historial clínico (R3, RGPD art. 9).** Verificado que **no hay camino**: `requireHistorial()`
(`core/auth.js:305`) y `puedeHistorial()` (`core/auth.js:330`) hacen su propio `SELECT` contra
`module='historial'` y solo perdonan a `owner` — **no llaman a `checkPermission`**. Un `admin` sin el
permiso concedido sigue fuera. `grep` de `historial` sobre los ficheros que usan `checkPermission`:
cero coincidencias.

**Datos, migraciones y VERI\*FACTU (R4).** El diff no contiene ni un `INSERT`, `UPDATE`, `DELETE`,
`ALTER` o `CREATE`. No toca `invoices`, ni la cadena. El script nuevo no puede escribir por
construcción. **Riesgo de pérdida de datos: cero.**

**El import del gate (R7).** Riesgo real: `scripts/gate-disa-informes.mjs` ahora importa
`modules/disa/index.js` y con él toda su cadena. Mitigado por precedente —
`scripts/verify-disa-query-permisos.mjs:16` ya importaba `evaluateQueryAccess` de ese mismo fichero— y
por lectura: `modules/disa/index.js` solo define y exporta a nivel de módulo; los efectos (migración
`ALTER TABLE`, rutas) viven dentro de `register(app, db)` (`:153`). El programador declara además
haberlo medido: *«0 handles y 0 requests activos, el proceso termina solo»* (commit `e5111df`), que
era lo que pedía el Paso 5.

**Constancia de lo ejercitado.** No es cero, pero tampoco es un verde: el programador declara
`node --check` sobre los cinco ficheros y la prueba del import. Los dos scripts que darían el verde
de verdad quedan sin correr, con motivo. Está dicho arriba y se repite aquí para que quien lea solo
esta sección no se lleve una impresión mejor de la que hay.

---

## Observaciones (no bloquean)

### O1 · El cuadro de N2 sigue diciendo lo contrario, en el mismo fichero que se ha tocado

**Dónde:** `docs/auditorias/diagnostico-arquitectonico.md:80`
**Qué pasa:** la tabla de N2 sigue con la fila `| checkPermission(db, session, m, a) | core/permission-check.js:1 | **no** |`
en la columna «Bypass owner/admin». Ciento cincuenta líneas más abajo, `:232` dice que el bypass pasó a
`core/permission-check.js`. **Las dos frases están en el mismo documento y no cuadran**, y es
exactamente la forma que `CLAUDE.md` describe en «Un titular de recuento se corrige con el cuerpo que
lo desarrolla»: se actualizó el detalle y se dejó el resumen. Un lector que abra el diagnóstico por
N2 —que es por donde se abre— leerá que la primitiva no tiene bypass.
**Por qué no bloquea:** el Paso 6 del análisis nombra **solo** §4.1 y ordena una línea; el programador
hizo exactamente eso. El hueco es del plano, no de la obra.
**Sugerencia:** una línea en la celda, al estilo del resto del repo — *«no ⚙️ desde el 31 ago 2026: sí,
por rol (`:14`)»* — tachando sin borrar, para poder reconstruir qué se creía y cuándo.

### O2 · La aserción del empleado puede dar verde sin haber medido a ningún empleado

**Dónde:** `scripts/verify-disa-permiso-dueno.mjs:59-65` y `:91-93`
**Qué pasa:** si el negocio no tiene ningún `employee` activo con cero filas, la sesión cae al
`{ userId: -1 }` y la aserción «falla cerrado» pasa contra un usuario que no existe. Es el
comportamiento que el análisis especificó, y el script **lo dice en su propia salida** («id inventado,
sin insertar»), que es lo que lo salva de ser un verde mudo. Aun así, es el escalón más débil de la
comprobación, y precisamente el que cubre el peor resultado posible de la tarea (R2).
**Sugerencia (otra tarea):** si algún día se autoriza sembrar, medirlo contra un empleado real; o al
menos subir el aviso a `✗` cuando el negocio no tenga ninguno, para que se note que ese candado no se
ha medido en vez de contarlo como aserción pasada.

### O3 · `process.exit(2)` dentro del `try` se salta el `finally`

**Dónde:** `scripts/verify-disa-permiso-dueno.mjs:52`
**Qué pasa:** `process.exit()` termina el proceso sin ejecutar `finally`, así que ese camino no llega
al `db.close()` de `:142`. En la práctica es inocuo (el proceso muere y el descriptor se cierra con
él) y el aborto es correcto en fondo y en código de salida. Se anota porque la regla de la casa es
«cierra lo que abres», y aquí hay una salida que no pasa por el cierre.

### O4 · Una clave sin punto ahora devuelve `true` para owner/admin

**Dónde:** `modules/disa/index.js:150-152`
**Qué pasa:** `permisoDeSesion('invoices')` (sin acción) parte a `m='invoices'`, `a=undefined`; antes
eso terminaba en `false` por no encontrar fila, y ahora el bypass contesta `true` antes de mirar. No
hay ningún llamante que lo haga —`areaPerm` y los mapas de `constructor-analitica.js` siempre dan la
clave entera—, así que hoy es teórico. Es el precio conocido de meter la regla en la primitiva, y va
en la misma dirección que `requirePerm`, que tampoco valida la clave.

### O5 · Los `isAdminUser(session) ||` redundantes siguen ahí, y era lo pactado

Los diez puntos de llamada enumerados en la §4 hacen ahora una comprobación que la primitiva ya hace.
El análisis lo decidió así (R8) y estoy de acuerdo: son ocho ficheros de seguridad y la limpieza no
arregla ningún fallo. Queda apuntado por si algún día se abre la tarea de unificar `requirePerm` sobre
`checkPermission` (alternativa (d) del §3 del análisis), que es donde toca barrerlos.

### O6 · Lo que sigue sin cerrarse, y el commit lo dice

N2 **no queda cerrado**: siguen vivas tres implementaciones del mismo concepto (`requirePerm`,
`checkPermission` y `filtroDeUsuario` de `modules/erp/menu.js:476`), y sigue en pie lo que anota el
propio código en `menu.js:467-469` («un empleado con CERO permisos ve el menú entero»). El análisis (R9) y el cuerpo del commit lo declaran los dos. Que esté
dicho es la mitad del trabajo bien hecha; la otra mitad es no darlo por hecho al leer el titular.

### O7 · Cuando se autorice correr los dos scripts, el gate necesita un reinicio antes

`scripts/gate-disa-informes.mjs` pasa por `launchOpts()` → `exigeCodigoServido()`
(`scripts/lib/gate-env.mjs:147-166`), que **aborta con código 2** si el fichero más nuevo de
`modules/` es posterior al arranque del proceso. Este commit toca `modules/`, así que hoy abortaría.
`sudo systemctl restart bamburu` antes de lanzarlo — no es un fallo del gate, es el gate haciendo su
trabajo, pero conviene saberlo para no leer el 2 como un rojo del producto.
