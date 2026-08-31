# Análisis · `disa-informes-permiso-dueno` — El dueño no puede ver sus propios informes por DISA

- **Papel:** arquitecto · **Fecha:** 31 ago 2026
- **Origen:** `docs/auditorias/diagnostico-arquitectonico.md` §4.1 (síntoma **N2**) · `TABLERO.md:8047`
- **Fase:** SANEAMIENTO TÉCNICO (CANON §4). No añade funciones nuevas: repara una que ya está prometida.
- **Método:** verificado **leyendo el código**. No se ha reproducido ni ejecutado nada (RITUAL: barridos,
  gates y comprobaciones solo a petición expresa). Todas las líneas citadas están leídas, no supuestas.

---

## 1 · Qué está mal hoy

### 1.1 La línea rota

`modules/disa/index.js:2528`, dentro del handler de `router.post('/message', …)`:

```js
const permClave = clave => { const [m, a] = String(clave).split('.'); return checkPermission(db, session, m, a); };
const INFORMES_TOOL = herramientasDeInformes(db, { userId: session?.userId || null, hasPerm: permClave });  // :2529
const DTO_TOOL      = herramientasDeDescuentos(db, { hasPerm: permClave });                                 // :2531
```

`core/permission-check.js:1-14` es, entero:

```js
export function checkPermission(db, session, module, action) {
  if (!session?.userId) return false;
  const row = db.prepare(`SELECT 1 FROM user_permissions up JOIN permissions p …`).get(session.userId, module, action);
  return !!row;
}
```

**No mira `session.role`.** Solo mira filas en `user_permissions`.

### 1.2 Por qué eso deja fuera precisamente al dueño

`core/auth.js:13-30` (`requirePerm`, el candado de las pantallas) hace la **misma consulta** pero con una
línea más, la 17:

```js
if (s.role === 'owner' || s.role === 'admin') return next();   // core/auth.js:17
```

Y a un `owner` **nadie le siembra filas**: el único `INSERT INTO user_permissions` del producto está en
`modules/erp/routes/users.js:202`, dentro del POST que edita permisos de otro usuario a mano (y que
además impide editarse a uno mismo, `users.js:179`). Su acceso vive **entero** en ese bypass por rol.

Luego, para el dueño: `permClave('invoices.read')` → `false`. Y `false` en `hasPerm` significa:

| Dónde | Qué le pasa al dueño |
|---|---|
| `modules/disa/informes.js:81` | `listarPaneles` devuelve sus informes y el filtro los tira todos → `informes: []` |
| `modules/disa/informes.js:90` | `ocultos_por_permiso: N` — DISA le dice cuántos informes suyos no le enseña |
| `modules/disa/informes.js:96` y `:121` | `cruzar()` **lanza 403** (`constructor-analitica.js:859`) al abrir o componer |
| `modules/disa/informes.js:103-108` | `catalogo()` le devuelve las áreas y medidas ya filtradas: el modelo ni sabe que existen |
| `modules/disa/informes.js:186` y `:204` | descuentos y bonos: *«No tienes permiso para ver los descuentos»* |

### 1.3 La asimetría exacta entre las dos puertas

Las dos puertas construyen su `hasPerm` de forma distinta, y esa es toda la avería:

| Puerta | Cómo construye `hasPerm` | ¿Bypass de rol? |
|---|---|---|
| Visual — `modules/erp/routes/analytics.js:169` | `const permDe = c => (p) => can(c, p)` → `modules/erp/layout.js:227-231` | **sí** (`isOwner` / `isAdmin`) |
| DISA — `modules/disa/index.js:2528` | `checkPermission` a secas | **no** |

El mismo fichero de DISA sí se acuerda del bypass en los otros tres sitios donde consulta permisos:

- `:314` — `actionAllowed` empieza con `if (isAdminUser(session)) return true;`
- `:1409` — `const can = (m, a) => isAdminUser(session) || checkPermission(db, session, m, a);`
- `:2512` — le pasa `isAdmin: isAdminUser(session)` a `evaluateQueryAccess`, que corta en `:113`
- `:1031` — `const canRead = (perm) => isAdminUser(session) || _userPerms.includes(perm);`

**Cuatro copias del bypass escritas a mano, y una quinta que se olvidó.** Eso es N2 en una línea: la regla
de autorización no está en la primitiva, así que se pierde en un punto de llamada.

### 1.4 Dos comentarios que hoy afirman algo falso

- `modules/disa/index.js:2527`: *«es el MISMO `checkPermission` de `requirePerm`»*. La **primitiva** es la
  misma; lo que falta es la mitad que `requirePerm` tiene en la línea de al lado. Un comentario que cierra
  la pregunta es peor que no tenerlo (misma lección que el censo de ventanitas, `CLAUDE.md`).
- `modules/disa/index.js:6`: *«MISMO motor que requirePerm (sin lógica paralela)»*. Idem.
- `modules/disa/informes.js:17-18`: *«El `hasPerm` que se le pasa es el mismo `checkPermission` que usa
  `requirePerm`»*. Ese comentario es correcto en lo que dice y **falso en lo que promete** (regla 2 del
  propio fichero: «MISMOS PERMISOS QUE LA PANTALLA»).

### 1.5 Y el instrumento que dio verde sobre la avería

`scripts/gate-disa-informes.mjs:49-50`:

```js
const TODO = () => true;
const dueno = herramientasDeInformes(db, { userId: owner.id, hasPerm: TODO });
```

El gate del Punto 10 prueba `modules/disa/informes.js` con **un `hasPerm` escrito para la prueba**, no con
el que corre en producción. Mide el motor y **se salta entero el tramo donde está la avería** — el mismo
patrón exacto del fallo del 23 ago con `prompt()`/`confirm()` («comprobaba el guardado llamando a la API
con un cuerpo JSON escrito por mí»). Su cabecera dice *«Se prueban LAS FUNCIONES QUE CORRE DISA, no una
copia escrita para la prueba»*: eso vale para `informes.js`, y **no vale para el cableado**, que es lo que
está roto. Reparar el código sin reparar el instrumento deja el mismo agujero abierto para la próxima.

**Causa raíz, en una frase:** el bypass owner/admin es una **convención replicada en cada punto de
llamada** en vez de una regla dentro de la primitiva, y el único punto de llamada que la olvidó no era
comprobable porque vive en una lambda dentro de un handler.

---

## 2 · Cómo lo resuelven los que ya lo resolvieron

### Salesforce — el bypass vive DENTRO del motor de sharing, y el llamante declara intención

Los permisos «View All Data» / «Modify All Data» y el perfil System Administrator no se comprueban en cada
clase: se evalúan **dentro** de la capa de sharing, la misma que aplica OWD, roles y sharing rules. En
Apex, el programador no escribe la excepción del administrador: **declara la intención de la clase**
(`with sharing` / `without sharing` / `inherited sharing`), y el motor decide. Igual con
`WITH SECURITY_ENFORCED` y `Security.stripInaccessible()`: se pide «filtra por lo que este usuario puede
ver» y el motor ya sabe quién lo salta.

**Qué se trae:** la forma. El llamante pregunta *«¿puede esta sesión?»*; **no** compone la respuesta
sumando *«¿es admin?»* + *«¿tiene la fila?»*. Bamburu tiene hoy el modelo contrario, y por eso falla.

### Odoo — una sola `check_access` en el ORM, y dos clientes del mismo modelo

Odoo evalúa `ir.model.access` y las record rules en el ORM. El superusuario (`SUPERUSER_ID`) y `sudo()`
cortocircuitan **dentro** de esa comprobación, no en cada módulo. La consecuencia estructural es la que
importa aquí: el cliente web, el XML-RPC y los módulos de terceros son **tres clientes del mismo modelo**,
así que **es imposible que uno sea más estricto que otro**, porque ninguno reimplementa la decisión.

**Qué se trae:** es literalmente el CANON §3-bis («las dos puertas respetan los mismos permisos»)
implementado como mecanismo y no como promesa. Bamburu tiene las dos puertas y **dos evaluaciones
distintas** (`layout.can` y `checkPermission`), que es exactamente lo que Odoo evita.

### SAP — aplica como CONTRAEJEMPLO, y por eso es el más útil de los tres

SAP hace lo contrario y le pasa lo mismo: `AUTHORITY-CHECK OBJECT …` es una **sentencia que el programador
tiene que escribir en cada programa**. Un `AUTHORITY-CHECK` olvidado es un agujero, y es una de las
familias de hallazgo más repetidas en las auditorías de ABAP. SAP no lo arregla con una primitiva mejor:
lo arregla con **aparato de vigilancia** (SU53, trazas ST01, SUIM, GRC), que es caro y llega tarde.

Y su bypass, `SAP_ALL`, es la **otra** alternativa de diseño: un perfil que se **concede como dato** —el
administrador sí tiene las filas—. Se descarta en §3 con su motivo.

**Qué se trae:** dos cosas concretas. (a) La confirmación de que «acordarse en cada punto de llamada» no
escala — Bamburu ya tiene la cifra: **600 de 1.025 definiciones de ruta sin `requirePerm` en la línea**
(diagnóstico §N2). (b) Que si la regla no se puede meter en la primitiva, hace falta un **instrumento que
enumere los puntos de llamada**; aquí sí se puede meter en la primitiva, así que el instrumento se reduce
a una comprobación pequeña.

---

## 3 · La decisión

### Qué se hace

**La regla se mete en la primitiva, y el punto de llamada se saca de la lambda para que se pueda medir.**
Dos movimientos, ninguno más:

1. **`core/permission-check.js` (capa `core/`, la del dominio de autorización).** `checkPermission` pasa a
   ser el **gemelo programático exacto** de `requirePerm` (`core/auth.js:13-30`): primero el bypass por
   rol, después la fila. Deja de haber una primitiva que se llama «comprobar permiso» y contesta a otra
   pregunta.

2. **`modules/disa/index.js` (capa de módulo).** La lambda `permClave` sale del handler y sube a **nivel de
   módulo, exportada**, como `permisoDeSesion(db, session)`. No es un adorno: es lo que permite que una
   comprobación llame **al cableado real** en lugar de a un `() => true` escrito para la prueba.

### Qué patrón del propio código sigue

El patrón está **en este mismo fichero, doce líneas más arriba de la avería**, y está escrito con su
motivo (`modules/disa/index.js:323-325`):

> *«El control de acceso de query_database (allowlist) vive a nivel de MÓDULO y exportado
> (`evaluateQueryAccess` + `QUERY_TABLE_READ_PERMS` + `QUERY_PROTECTED_TABLES`), **para que el gate lo
> pruebe con los mapas reales**. Aquí `runQueryTool` solo delega.»*

`evaluateQueryAccess` (`:109`) es exactamente la pieza hermana: decisión pura, a nivel de módulo,
exportada, con su comprobación real (`scripts/verify-disa-query-permisos.mjs`, que usa el motor de verdad
y no una copia). El acceso a los informes se pone **en esa misma forma**. No se inventa arquitectura:
se aplica la que este fichero ya declaró y de la que se saltó un caso.

Precedente adicional de que en Bamburu la excepción de rol se resuelve **con una función nombrada**, no
con una bandera suelta: `requireHistorial()` / `puedeHistorial()` (`core/auth.js:305` y `:330`), el único
permiso del producto que no perdona el rol. Ese caso **no usa `checkPermission`**, lo cual es la prueba de
que meter el bypass en `checkPermission` no atropella la excepción existente.

### Alternativas descartadas

| Alternativa | Por qué se descarta |
|---|---|
| **(a) Parchear solo la línea 2528**: `isAdminUser(session) \|\| checkPermission(…)` | Es la **quinta copia a mano** del bypass. Arregla el síntoma y deja intacta la causa (N2). El sexto punto de llamada volverá a olvidarlo, y esta vez ya sabemos que nadie se entera. |
| **(b) Sembrar filas de `user_permissions` al `owner`** (modelo `SAP_ALL`) | Exige una migración que **escribe en las 9 bases de tenant** y en toda alta futura; hay que re-sembrar cada vez que nazca un permiso nuevo (56 hoy); y **el bypass por rol de `requirePerm` seguiría existiendo**, así que habría dos verdades sobre lo mismo. Además, `users.js:201` borra y reinserta el juego entero al editar permisos: un despiste dejaría al dueño sin nada. Escribir datos para arreglar una regla es exactamente lo que el canon evita. |
| **(c) Usar `can(c, perm)` de `modules/erp/layout.js:227`** | Es tentador (misma función que la pantalla, y toma la clave entera), pero mete a **DISA a depender de la capa de presentación** y del contexto de Hono: la regla acabaría viviendo en un módulo de layout. Y no se puede comprobar sin fabricar un `c` falso — vuelve el problema de medir una copia. |
| **(d) Unificar `requirePerm` sobre `checkPermission`** (colapsar dos de las tres implementaciones de N2) | Es la dirección correcta y **hay que hacerla**, pero cambia el middleware de ~600 definiciones de ruta y convierte un error de BD de 500 a 403 (`checkPermission` traga la excepción, `requirePerm` no). Es otra tarea, con su propio análisis y su propia regresión. **Fuera de alcance aquí**, y anotado en §5 como lo que le queda vivo a N2. |
| **(e) Añadir un tercer helper `puedeSesion(...)` y dejar `checkPermission` como está** | Sería una cuarta implementación paralela del mismo concepto en un producto que el diagnóstico ya señala por tener tres. Menos piezas, no más. |

### Lo que esta decisión NO cambia

- No toca `modules/erp/layout.js:227` (`can`): sigue resolviendo por el array precargado `userPerms` que
  deja `adminAuth` (`core/auth.js:224-229`), sin consulta por llamada. Cambiarlo sería una regresión de
  rendimiento sin ganancia.
- No toca `requirePerm`. No toca el historial clínico. No toca `menu.js`.
- **No amplía lo que ve un empleado.** El camino de «falla cerrado» queda igual, letra por letra.

---

## 4 · El plan, paso a paso

### Paso 1 — `core/permission-check.js`: la regla, dentro de la primitiva

Sustituir el cuerpo de `checkPermission` (líneas 1-14) por:

```js
// El bypass owner/admin vive AQUÍ, no en cada punto de llamada. Es la mitad que `requirePerm`
// (core/auth.js:17) tiene y esta función no tenía: la primitiva contestaba «¿tiene la fila?» mientras
// que quien la llama pregunta «¿puede esta sesión?». Donde alguien se olvidaba de añadir el rol, el
// comportamiento cambiaba en silencio — y pasó: modules/disa/index.js:2528 dejó al DUEÑO sin sus
// propios informes (diagnóstico arquitectónico §4.1).
//
// LA ÚNICA EXCEPCIÓN DEL PRODUCTO no pasa por aquí y sigue sin pasar: el historial clínico
// (`requireHistorial` / `puedeHistorial`, core/auth.js:305 y :330) exige el permiso concedido incluso a
// un `admin`, y por eso tiene su propia función. Si algún día hace falta otra excepción así, se escribe
// su función con su nombre y su motivo — no se le quita el bypass a esta.
export function checkPermission(db, session, module, action) {
  try {
    if (!session?.userId) return false;
    if (session.role === 'owner' || session.role === 'admin') return true;
    const row = db.prepare(`
      SELECT 1 FROM user_permissions up
      JOIN permissions p ON up.permission_id = p.id
      WHERE up.admin_user_id = ? AND p.module = ? AND p.action = ?
      LIMIT 1
    `).get(session.userId, module, action);
    return !!row;
  } catch {
    return false;
  }
}
```

Reglas de este paso:
- El orden importa: `!session?.userId` **antes** que el rol. Sin sesión no hay nada, ni con rol pegado.
- `permissionMiddleware` (`:16-24`) hereda el bypass y **se deja como está**: no lo usa ni una ruta del
  producto (`grep` de `permissionMiddleware` da **una sola línea**, su propia definición). Retirarlo es
  otra tarea; aquí no se borra nada.

### Paso 2 — `modules/disa/index.js`: sacar el cableado de la lambda

**2.1** Añadir, **a nivel de módulo**, entre el cierre de `redactarSql` (línea 141) y
`export function register(app, db)` (línea 143):

```js
// El comprobador de permisos que usan las herramientas de INFORMES y de DESCUENTOS. Toma la clave
// entera ('invoices.read'), que es la forma que espera `hasPerm` en constructor-analitica.js.
//
// VIVE AQUÍ, A NIVEL DE MÓDULO Y EXPORTADO, por el mismo motivo que `evaluateQueryAccess` (arriba):
// para que la comprobación pueda llamar AL CABLEADO REAL. Cuando era una lambda dentro del handler,
// el gate no podía alcanzarla, le pasaba `() => true` a las herramientas, daba verde — y el dueño no
// veía sus informes (diagnóstico arquitectónico §4.1).
export function permisoDeSesion(db, session) {
  return clave => { const [m, a] = String(clave).split('.'); return checkPermission(db, session, m, a); };
}
```

**2.2** En `:2525-2531`, sustituir la lambda por la función y **corregir el comentario que hoy afirma algo
falso**:

```js
// ── PUNTO 10 · LOS INFORMES, POR CHAT ────────────────────────────────────────────────────
// Mismo motor y mismos permisos que la pantalla; el detalle y el porqué, en `informes.js`.
// `permisoDeSesion` toma la clave entera y decide como `requirePerm`: primero el rol (owner/admin
// pasan) y después la fila de `user_permissions`. El bypass está DENTRO de `checkPermission`
// (core/permission-check.js), no aquí — si volviera a escribirse a mano, volvería a olvidarse.
const permClave = permisoDeSesion(db, session);
const INFORMES_TOOL = herramientasDeInformes(db, { userId: session?.userId || null, hasPerm: permClave });
const DTO_TOOL = herramientasDeDescuentos(db, { hasPerm: permClave });
```

**2.3** Corregir el comentario del import, `:6`, que dice «MISMO motor que requirePerm (sin lógica
paralela)» → añadir «(incluido el bypass owner/admin, desde el 31 ago 2026)».

**2.4** No se toca nada más del fichero. En concreto **no** se tocan `:314`, `:1031`, `:1409` ni `:2512`:
sus `isAdminUser(session) ||` quedan redundantes pero **inofensivos** (mismo resultado), y quitarlos
metería ocho ediciones de seguridad en una tarea que arregla una. Se anota en §5.

### Paso 3 — `modules/disa/informes.js`: la promesa, al día

Sin cambios de código. Ajustar la regla 2 de la cabecera (`:17-21`), que hoy dice *«El `hasPerm` que se le
pasa es el mismo `checkPermission` que usa `requirePerm`»*, para que diga que ese `hasPerm` lo construye
`permisoDeSesion` y que **incluye el bypass de owner/admin igual que la pantalla**. Es la regla del
«titular y su cuerpo» de `CLAUDE.md`: el fichero que promete «mismos permisos que la pantalla» es el que
tiene que decir por qué ahora sí.

### Paso 4 — `scripts/verify-disa-permiso-dueno.mjs` (NUEVO): la comprobación que faltaba

Script pequeño, **sin puppeteer, sin servidor vivo y sin una sola llamada al modelo** (es una decisión de
construcción: la avería es determinista y no necesita ni navegador ni LLM; así se puede correr en
segundos y no gasta cuota).

- Abre la BD del tenant `desarrollo-bamburu` vía `tenantDb(slug)` de `scripts/lib/gate-env.mjs`, **en modo
  `{ readonly: true }`**. Así **no puede escribir aunque quisiera**, y por eso no hay nada que limpiar
  (regla «lo que una prueba crea, la prueba lo borra» — la mejor forma de cumplirla es no crear nada).
- Importa **las piezas reales**: `permisoDeSesion` de `modules/disa/index.js`, `herramientasDeInformes` y
  `herramientasDeDescuentos` de `modules/disa/informes.js`, y `AREAS` de
  `modules/erp/constructor-analitica.js`. **Ninguna copia escrita para la prueba.**
- Sesiones, sin escribir en la base:
  - **dueño:** `{ userId: <id del owner activo>, role: 'owner' }` leído con
    `SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1`.
  - **admin:** el primer `role='admin'` activo; si no hay ninguno, `{ userId: <id del owner>, role: 'admin' }`
    (la decisión que se mide es la del rol, no la de la fila).
  - **empleado sin permisos:** el primer `employee` activo con **cero** filas en `user_permissions`; si no
    existe ninguno, `{ userId: -1, role: 'employee' }`. En los dos casos **no se inserta nada**.
- Afirmaciones:
  1. Se elige una clave **que el dueño NO tiene concedida** (una de `permissions` que no esté en sus filas;
     si no tiene ninguna fila, vale `invoices.read`) y se exige `permisoDeSesion(db, dueño)(clave) === true`.
     Se imprime cuántas filas tiene el dueño en `user_permissions` — el dato que explica la avería.
  2. Lo mismo para el admin: `true`.
  3. Para el empleado sin permisos: `false` en `invoices.read` (**falla cerrado**, no se ha ablandado nada).
  4. `herramientasDeInformes(db, { userId: dueño.userId, hasPerm: permisoDeSesion(db, dueño) }).listar()`
     → `ocultos_por_permiso === 0`.
  5. `.catalogo()` del dueño → `Object.keys(areas).length === Object.keys(AREAS).length` (las 7).
  6. `.componer({ area:'ventas', quiero_saber:'base', repartido_por:'fecha' })` del dueño → **sin** `error`
     y con `filas` array.
  7. `herramientasDeDescuentos(db, { hasPerm: permisoDeSesion(db, dueño) }).ver()` → **sin** `error`; con la
     sesión del empleado sin permisos → **con** `error` (la frase «No tienes permiso»).
  8. Al terminar, vuelve a contar filas de `analytics_panels` y `user_permissions` y exige que no hayan
     cambiado.
- Salida al estilo de la casa (`✓` / `✗`, contador, `process.exit(fail ? 1 : 0)`).

### Paso 5 — `scripts/gate-disa-informes.mjs`: que deje de medir una copia

- **Eliminar** el uso de `const TODO = () => true` como permisos del dueño en `:49-50`. En su lugar:

  ```js
  import { permisoDeSesion } from '../modules/disa/index.js';
  const sesionDueno = { userId: owner.id, role: 'owner' };
  const permDueno = permisoDeSesion(db, sesionDueno);
  const dueno = herramientasDeInformes(db, { userId: owner.id, hasPerm: permDueno });
  ```

  Con esto, los bloques **[2]**, **[3]** y **[5]** pasan a medir **el cableado real**: hoy, con el código
  roto, `[2]` daría lista vacía y `[3]` no tendría filas que comparar. Es la diferencia entre un verde
  cierto y un verde sobre nada.
- `TODO` se **conserva** solo donde representa a la pantalla en el bloque **[3]**
  (`porPantalla = cruzar(db, { …, hasPerm: TODO })`) — ahí significa «la vía visual, que al dueño se lo
  enseña todo», y es contra eso contra lo que se compara el chat.
- Los `hasPerm` restrictivos del bloque **[4]** (`p => p !== 'purchases.read'`,
  `p => p !== 'invoices.read'`) **se quedan tal cual**: no son un atajo, son la simulación deliberada de un
  empleado, y siguen midiendo el filtrado de `informes.js`. Lo que los hace legítimos es que los bloques
  [2]/[3]/[5] ya usan el cableado real.
- **Comprobar que el import de `modules/disa/index.js` en un script no arranca nada**: ese fichero solo
  define y exporta a nivel de módulo (`export function register(app, db)`, `:143`), así que importarlo no
  registra rutas ni abre bases. Si al ejecutarlo apareciera cualquier efecto de importación, se para y se
  dice — no se «arregla» moviendo la función a otro sitio sin decirlo.

### Paso 6 — Dejar escrito lo que se creía y cuándo

`docs/auditorias/diagnostico-arquitectonico.md` §4.1: **no se reescribe el hallazgo ni se borra**. Se añade
**una línea** bajo el encabezado, al estilo del resto del repo:

```
> ⚙️ RESUELTO el 31 ago 2026 por la tarea `disa-informes-permiso-dueno`: el bypass owner/admin pasó a
> `core/permission-check.js`. El hallazgo se conserva entero para poder reconstruir qué se creía y cuándo.
```

**`TABLERO.md` NO se toca.** El propio encargo del orquestador lo dice
(`docs/orquestador/paso-0-diagnostico.md` §2): *«Mientras el tablero siga como está, el orquestador lo lee
y trabaja, pero al cerrar no lo reescribe»*. El `estado:` de la tarea es cosa suya, no del programador.

### Resumen de ficheros

| # | Fichero | Qué se hace |
|---|---|---|
| 1 | `core/permission-check.js` | Bypass owner/admin **dentro** de `checkPermission` (+ comentario del porqué y de la excepción del historial) |
| 2 | `modules/disa/index.js` | Nueva `permisoDeSesion(db, session)` exportada a nivel de módulo; `:2528-2531` la usan; comentarios `:6` y `:2527` corregidos |
| 3 | `modules/disa/informes.js` | Solo cabecera: la regla 2 dice cómo se construye ahora ese `hasPerm` |
| 4 | `scripts/verify-disa-permiso-dueno.mjs` | **Nuevo.** Read-only, sin navegador ni LLM, sobre las piezas reales |
| 5 | `scripts/gate-disa-informes.mjs` | El dueño deja de medirse con `() => true` |
| 6 | `docs/auditorias/diagnostico-arquitectonico.md` | Una línea: §4.1 resuelto, con fecha. Sin borrar nada |

---

## 5 · Riesgos

### R1 · Ampliar una primitiva de seguridad usada en 11 sitios de producción

**El riesgo:** meter el bypass en `checkPermission` cambia, en teoría, todas sus llamadas.

**La mitigación es la enumeración, y está hecha.** Todos los puntos de llamada del producto, leídos uno a
uno:

| # | Punto de llamada | ¿Ya llevaba el bypass? | Efecto del cambio |
|---|---|---|---|
| 1 | `modules/disa/index.js:319` (`actionAllowed`) | Sí — `:314` corta antes con `isAdminUser` | **Ninguno** |
| 2 | `modules/disa/index.js:1409` (`/summary`) | Sí — `isAdminUser(session) \|\|` | **Ninguno** |
| 3 | `modules/disa/index.js:2514` (`runQueryTool`) | Sí — `evaluateQueryAccess` corta en `:113` con `isAdmin` antes de llamar a `hasPerm` | **Ninguno** |
| 4 | `modules/disa/index.js:2528` | **NO** | **Es la avería que se repara** |
| 5 | `modules/erp/routes/invoices.js:971` | Sí — `c.get('isAdmin') \|\|` | **Ninguno** |
| 6 | `modules/erp/routes/conciliacion-routes.js:19` | Sí — `role owner/admin \|\|` | **Ninguno** |
| 7 | `modules/erp/routes/mostrador.js:44` | Sí — `c.get('isAdmin') \|\|` | **Ninguno** |
| 8 | `modules/erp/routes/fichaje.js:35` | Sí — `!!c.get('isAdmin') \|\|` | **Ninguno** |
| 9 | `modules/erp/routes/quotes.js:359` | Sí — `c.get('isAdmin') \|\|` | **Ninguno** |
| 10 | `modules/erp/routes/recurrentes-routes.js:20` | Sí — `role owner/admin \|\|` | **Ninguno** |
| 11 | `modules/erp/routes/recurrentes-routes.js:31` | Sí — `role owner/admin \|\|` | **Ninguno** |

Y los dos que no son de producción:

- `core/permission-check.js:19` (`permissionMiddleware`): **no lo usa nadie** — su única aparición en todo
  el repo es su definición. Hereda el bypass y no afecta a ninguna ruta.
- `scripts/verify-disa-query-permisos.mjs:39`: fabrica `{ userId, role: isAdmin ? 'owner' : 'employee' }`.
  Con `isAdmin: true`, `evaluateQueryAccess` corta en `:113` y nunca llama a `hasPerm`; con `false`, el rol
  es `employee` y no hay bypass. **Sus aserciones no cambian.**

**Conclusión: el cambio es un no-op en los 10 sitios que no son la avería.** No es una opinión: es la lista.
Un criterio de aceptación lo vuelve a exigir.

### R2 · Que un empleado gane acceso que no tenía

**El riesgo:** el peor resultado posible de esta tarea sería aflojar el candado del empleado.

**Mitigación:** el único camino nuevo es `session.role === 'owner' || 'admin'`. Un `employee` o `readonly`
recorre exactamente las mismas líneas que hoy. `PERMS` (`core/auth.js:6-11`) confirma que solo hay cuatro
roles y que `employee`/`readonly` no tienen nada. El criterio 3 lo exige explícitamente (falla cerrado), y
`scripts/verify-permisos-disa.mjs` —que ya prueba el candado del empleado sobre servidor vivo— sigue
siendo válido sin tocarlo.

### R3 · La excepción del historial clínico (RGPD art. 9)

**El riesgo:** que un `admin` gane acceso a datos de salud por el bypass nuevo.

**Mitigación: no hay camino.** `requireHistorial()` (`core/auth.js:305`) y `puedeHistorial()` (`:330`)
**no llaman a `checkPermission`**: hacen su propia consulta y solo perdonan a `owner`. El cambio no las
toca. Queda escrito en el comentario del Paso 1 para que nadie las «unifique» sin leer el porqué.

### R4 · Datos, migraciones y VERI\*FACTU

**Ninguno.** No hay migración, ni cambio de esquema, ni `ALTER`, ni `INSERT`. No se toca `invoices`, ni
`verifactu_registros`, ni `verifactu_hash`, ni la cadena. `modules/disa/informes.js` **no escribe** (el
propio gate lo afirma en su bloque [5]) y `analytics_panels` sigue fuera de `WRITABLE_TABLES`. El script
nuevo abre la base en `readonly`. **Riesgo de pérdida de datos: cero, por construcción.**

### R5 · Concurrencia y bloqueos SQLite

`checkPermission` es una lectura de una fila. El cambio **quita** consultas (el owner/admin ya no consulta
`user_permissions`), no las añade. Va en la dirección correcta del diagnóstico de bloqueos, aunque el
efecto sea pequeño y **no se reclama como mejora medida**.

### R6 · Pantallas que dependen de esto

`/admin/analytics` y el resto del panel resuelven por `can(c, ·)` (`modules/erp/layout.js:227`) y por
`requirePerm`, **ninguno de los dos tocado**. El cambio solo puede **ampliar** lo que devuelve DISA, nunca
recortar una pantalla. Aun así, el criterio 7 acota el diff a cinco ficheros para que esto sea comprobable
sin razonar.

### R7 · Que el gate corregido rompa por el import

Al importar `modules/disa/index.js` desde un script entra en juego toda su cadena de imports (ERP, `core`,
`hono`). Es la misma cadena que ya carga `scripts/verify-disa-query-permisos.mjs`, que importa
`evaluateQueryAccess` **de ese mismo fichero**, así que está probado que se puede. Si aun así apareciera un
efecto de importación, **se para y se dice**; no se mueve la función a otro fichero para esquivarlo sin
dejarlo escrito.

### R8 · Los `isAdminUser(session) ||` que quedan redundantes

Tras el Paso 1, los puntos 1/2/5/6/7/8/9/10/11 hacen una comprobación que la primitiva ya hace. **Se dejan
a propósito**: son ocho ficheros de seguridad, la limpieza no arregla ningún fallo y esta fase es de una
tarea cada vez. Riesgo de dejarlos: que alguien los lea como «aquí hace falta escribirlo a mano» y lo
copie en un sitio nuevo. Mitigación: el comentario del Paso 1 dice dónde vive la regla, y el criterio 2
exige que en el punto reparado **no quede ninguna lambda de permisos escrita a mano**.

### R9 · Lo que esta tarea NO cierra, y hay que decirlo

**N2 sigue vivo.** Quedan **tres** implementaciones del mismo concepto: `requirePerm` (`core/auth.js:13`,
con su SQL propio), `checkPermission` (`core/permission-check.js:1`) y `filtroDeUsuario`
(`modules/erp/menu.js:475`, con dos reglas distintas dentro). Esta tarea repara **una línea rota y su
instrumento**; no unifica las tres (alternativa (d) de §3). Y sigue en pie lo que anota el propio código:
*«un empleado con CERO permisos ve el menú entero»* (`modules/erp/menu.js:466`). **No se declara N2
cerrado.**

---

## 6 · Criterios de aceptación

- [ ] Con una sesión `{ userId: <owner activo>, role: 'owner' }` que **no** tiene la fila correspondiente en `user_permissions`, `checkPermission(db, session, 'invoices', 'read')` devuelve `true`; con `{ userId, role: 'admin' }` también; y con `{ userId, role: 'employee' }` sin filas devuelve `false`.
- [ ] `modules/disa/index.js` exporta `permisoDeSesion(db, session)` **a nivel de módulo** (fuera de `register`), las líneas que construyen `INFORMES_TOOL` y `DTO_TOOL` la usan, y no queda ninguna lambda que llame a `checkPermission` escrita dentro del handler de `/message`.
- [ ] Con el `hasPerm` construido por `permisoDeSesion` para el dueño: `herramientasDeInformes(...).listar()` devuelve `ocultos_por_permiso === 0`, `catalogo().areas` trae tantas áreas como `Object.keys(AREAS)` (7), y `componer({area:'ventas', quiero_saber:'base', repartido_por:'fecha'})` devuelve `filas` sin `error`.
- [ ] Con ese mismo `hasPerm` del dueño, `herramientasDeDescuentos(...).ver()` **no** devuelve `error`; con el de un empleado sin permisos **sí** devuelve el error de permiso.
- [ ] `node scripts/verify-disa-permiso-dueno.mjs` termina con código 0, abre la base con `{ readonly: true }`, y los recuentos de `analytics_panels` y `user_permissions` son idénticos antes y después.
- [ ] `scripts/gate-disa-informes.mjs` ya no pasa `() => true` como permisos del dueño (usa `permisoDeSesion`), conserva los `hasPerm` restrictivos del bloque [4], y termina con código 0.
- [ ] `git diff --name-only` sobre la entrega devuelve exactamente estos cinco ficheros modificados más el nuevo: `core/permission-check.js`, `modules/disa/index.js`, `modules/disa/informes.js`, `scripts/gate-disa-informes.mjs`, `docs/auditorias/diagnostico-arquitectonico.md` y `scripts/verify-disa-permiso-dueno.mjs`. `TABLERO.md` **no** aparece.
- [ ] Ningún comentario del código sigue afirmando que el `hasPerm` de DISA es «el MISMO `checkPermission` de `requirePerm`» sin decir que la primitiva ya incluye el bypass (`modules/disa/index.js:6` y `:2527`, `modules/disa/informes.js:17-18`).

---

## Nota sobre la ejecución de comprobaciones (RITUAL)

Este análisis **no ha ejecutado nada**: ni gates, ni scripts, ni consultas a las bases. Los criterios 5 y 6
nombran dos scripts que hay que correr; **correrlos exige autorización expresa de Ibrahin**, arriba del
todo del encargo y para una sola ejecución (`CLAUDE.md`, `RITUAL.md`). Si el encargo no la trae, el
programador **construye y lo dice**, y el revisor juzga los criterios 1-4, 7 y 8 leyendo el código —
que son comprobables así— dejando escrito que 5 y 6 quedan sin correr y por qué. **No se ejecutan por
iniciativa propia, y no se repiten para perseguir un rojo.**
