# `pantalla-403-ventanita` — La pantalla de «no tienes permiso» abre una ventanita sobre una página en blanco

- **id:** `pantalla-403-ventanita`
- **origen:** `docs/auditorias/diagnostico-arquitectonico.md` §4.3 · `TABLERO.md` §TAREAS EN FORMATO DEL ORQUESTADOR
- **fecha del plano:** 31 ago 2026
- **fase:** SANEAMIENTO TÉCNICO (CANON §4). No añade función nueva: arregla una que está rota.

---

## 1. Qué está mal hoy

### 1.1 El fallo, en una línea

`core/auth.js:28` — la respuesta 403 de `requirePerm`:

```js
return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>window.addEventListener('DOMContentLoaded',function(){if(typeof showAccessDenied==='function')showAccessDenied();else alert('Acceso no permitido');});<\/script></body></html>`, 403);
```

Ese documento tiene **un solo `<script>` y ningún otro recurso**. `showAccessDenied` se define en
`modules/erp/layout.js:793` (`window.showAccessDenied=function(){…}`), dentro del `<script>` que
`adminLayout()` inyecta en las páginas del panel. El documento de la línea 28 **no llama a
`adminLayout()` ni carga nada de `layout.js`**, así que `typeof showAccessDenied` es siempre
`'undefined'` y la condición **siempre** cae al `else`.

Y el modal que ese `else` pretendía abrir (`#accessDeniedModal`, `modules/erp/layout.js:1827-1834`)
tampoco está en el documento: lo pinta `adminLayout()`, tres líneas antes de `</body>`. Aunque la
función existiera, `document.getElementById('accessDeniedModal')` devolvería `null` y
`showAccessDenied` (layout.js:794-795) no haría nada, porque está escrita como `if(m)…`.

**Resultado:** cada denegación de permiso por navegación es un `alert()` del navegador sobre una
página en blanco. Y si el usuario ya marcó «Impedir que esta página cree cuadros de diálogo
adicionales» —la casilla que es el motivo entero de la norma de CERO ventanitas de `CLAUDE.md`—,
`alert()` no enseña nada: **queda la página en blanco y punto**. Ni ventana, ni aviso, ni
explicación, ni forma de volver.

### 1.2 Cuánto producto cuelga de esa línea

`requirePerm` se usa **433 veces** en `modules/` (medido: `grep -rn "requirePerm(" --include=*.js modules | wc -l`):

| Dónde | Cuántas | Qué recibe hoy | Qué debería recibir |
|---|---|---|---|
| Routers `api.*` (montados en `/api/erp`, `modules/erp/routes/index.js:269`) | **298** | Un documento HTML con un `<script>` | JSON `{ error }` |
| Vistas HTML (`views.get` 108 · `views.post` 20 · portal 5 · otros) | **135** | El mismo documento roto | Una página de error de verdad |

Las 298 de `/api/…` no revientan **de casualidad**: `window.api()` (`modules/erp/layout.js:774-775`)
corta en `r.status===403` y lanza `window.ERR.PERM` **antes** de intentar `r.json()`. Es decir, el
front sobrevive porque nunca lee el cuerpo — pero el servidor está devolviendo `text/html` a
llamadas JSON, y cualquier `fetch` que no pase por ese helper y haga `await r.json()` se come una
excepción de parseo en vez del motivo.

### 1.3 No es una copia: son cuatro

1. `core/auth.js:28` — `requirePerm`. La original.
2. `modules/erp/routes/settings.js:489` — `puedeVerAjustes`. **Copia literal**, con comillas dobles
   en vez de simples.
3. `core/permission-check.js:31` — `permissionMiddleware`:
   `c.html('<p style="color:red;padding:2rem">No tienes permiso para realizar esta acción.</p>', 403)`.
   Sin `<!DOCTYPE>`, sin `charset` (los acentos salen mojibake), sin salida. **Hoy no la llama
   nadie** (comprobado: única aparición en todo el repo es su propia definición), pero está exportada
   y a un `import` de resucitar.
4. `core/tenant-middleware.js:124` y `core/csrf.js:38` — no son de permisos, pero son dos páginas de
   error 403 más, cada una con su propio maquetado a mano. Quedan **fuera de esta tarea** (§5.6).

### 1.4 Y la pieza del mismo fichero que YA lo hace bien

`requireHistorial()`, en **el mismo `core/auth.js`, 290 líneas más abajo** (`:305`):

```js
const esApi = c.req.path.startsWith('/api/');
if (esApi) return c.json({ error: 'No tienes acceso al historial clínico.' }, 403);
return c.html('<!doctype html><meta charset="utf-8"><title>Sin acceso">…<a href="/admin">Volver</a>…', 403);
```

Reparte por canal, contesta JSON a la API y sirve una **página de verdad, con texto y con salida**,
a la navegación. Es exactamente la forma correcta, escrita por la misma mano, en el mismo fichero, y
`requirePerm` no la sigue. (Su HTML está maquetado a mano y sin tokens, cosa que este plano también
arregla — §4.)

Ese reparto por canal ya es **el patrón establecido de `core/`**, con cinco precedentes:
`core/auth.js:215` · `core/auth.js:238` · `core/auth.js:318` · `core/csrf.js:35` ·
`core/tenant-middleware.js:123` · `core/validate.js:18` · `core/rate-limit.js:117`.
`requirePerm` es la única excepción.

### 1.5 Por qué nadie lo cazó, y por qué eso también hay que arreglarlo

`scripts/censo-ventanitas.mjs` es la herramienta que existe para que esto no pase, y **no puede
verlo**, por dos motivos independientes:

- **Su patrón no incluye `alert`.** Línea 27: `const RE = /(?<![\w.$])(prompt|confirm)\s*\(/g`.
  Pero la norma de `CLAUDE.md` dice literalmente *«Ni `prompt()`, ni `confirm()`, ni `alert()`»*.
- **`core/` está fuera de su alcance.** Línea 136: `barrer(path.join(RAIZ, 'modules'));` — y nada más.

Vuelve a cumplirse la frase que ya está escrita en `CLAUDE.md`: *un censo que dice CERO y no es
cierto es peor que no tenerlo, porque cierra la pregunta*. Medido con una copia del censo parcheada
en `/tmp` (patrón + `core/`): **14 `alert()` vivos**, de los cuales 2 son los de esta tarea.

### 1.6 Que esto se pisa a diario, no en teoría

`modules/erp/menu.js:468` lo deja escrito: *«un empleado con CERO permisos ve el menú entero»*. Y
`menu.js:98` cuenta el caso ya vivido: *«Un empleado sin ese permiso VEÍA "Libros y modelos" y se
comía un 403 al pulsar»*. La pantalla rota no es un rincón: es lo que ve cualquier empleado que
pulse una entrada del rail que no le toca.

---

## 2. Cómo lo resuelven los que ya lo resolvieron

### Salesforce — el reparto por canal, y la página como red de seguridad

Salesforce resuelve **una sola** decisión de autorización (perfiles + permission sets, en servidor) y
la **presenta de dos formas según el canal**: una navegación denegada acaba en la página completa
*«Insufficient Privileges»* (renderizada por el servidor, con su cabecera y un camino de vuelta),
mientras que la API REST/SOAP y los métodos `@AuraEnabled` devuelven un error estructurado
(`INSUFFICIENT_ACCESS_OR_READONLY`) con 403, que el cliente ya cargado convierte en un aviso dentro
de la página.

**Qué se trae:** las tres cosas. (a) La decisión vive en un sitio y la **presentación** se elige por
canal — que es justo lo que `requirePerm` no hace y `requireHistorial` sí. (b) La navegación denegada
es una **página completa**, nunca un diálogo sobre nada. (c) El texto dice qué hacer a
continuación («contacta con tu administrador»), no solo que no. Bamburu ya tiene ese texto escrito:
`ERR.PERM` (`modules/erp/layout.js:156`) — *«…pídeselo al dueño o a un administrador del negocio»*.

También aplica su segunda mitad: Salesforce **esconde** los accesos que no puedes usar, así que la
página de denegación es el respaldo, no la experiencia normal. Bamburu ya lo hace (`NAV_PERMS` en
`modules/erp/menu.js:21` y `can()` en `layout.js:227`) — pero con el agujero conocido de
`menu.js:468`, que es otra tarea y no esta.

### Odoo — el mismo error, y el motivo exacto por el que su solución NO se puede copiar

Odoo lanza `AccessError` **en el ORM**, un punto único, y el cliente web lo pinta como un diálogo
*dentro* de la aplicación ya cargada. Eso funciona porque Odoo es una SPA: cuando llega la
denegación, el armazón está en pantalla. Para las rutas HTTP directas (`http_routing`), donde no hay
armazón cargado, Odoo **no** usa el diálogo: renderiza una plantilla de error 403 en servidor.

**Qué se trae:** el punto único de lanzamiento → para Bamburu, una sola función de denegación que
usen `requirePerm`, `requireHistorial` y `permissionMiddleware`.

**Qué NO aplica, y por qué:** el diálogo del cliente. Bamburu es deliberadamente **no-SPA**
(`CLAUDE.md` §Stack: *«HTML/JS inline servido desde rutas (sin SPA, sin framework de front)»*). Y
aquí está el diagnóstico fino de este bug: **`core/auth.js:28` es el patrón de Odoo copiado sin su
premisa**. Intenta abrir un modal del armazón en un documento que no tiene armazón. Bamburu ya tiene
su equivalente correcto del diálogo de Odoo, y funciona: `window.api()` (`layout.js:774`) llama a
`showAccessDenied()` cuando la denegación llega por `fetch` **con la página ya cargada**. Esa mitad
no se toca. La rota es la otra.

### SAP — la denegación se registra, no solo se muestra

Dos piezas. En **Fiori/S4HANA**, el launchpad no enseña las apps para las que no tienes rol PFCG, una
navegación directa a una app no autorizada aterriza en una página de error con acción «Home», y los
servicios OData devuelven 403 con carga de error. En **SAP GUI clásico**, además del mensaje, el
fallo de autorización queda **registrado** y el administrador lo recupera con la transacción `SU53`
para ver exactamente qué objeto de autorización faltó y concederlo.

**Qué se trae ahora:** las dos primeras (ya cubiertas por el reparto por canal + `NAV_PERMS`).

**Qué NO se trae, y por qué:** el `SU53`. Es la mejor idea de las tres y Bamburu tiene dónde
colgarla (`logActivity`, `core/auth.js:251`, y la pantalla `/admin/activity`), pero un `logActivity`
en `requirePerm` escribe una fila **por petición denegada**, sin control de volumen: un rastreador o
un bucle de `fetch` llena `activity_logs` del negocio. Hacerlo bien exige agregar por
(usuario, permiso, día) y decidir qué se le enseña al dueño — es una función nueva, con su propia
pantalla, y esta fase no admite funciones nuevas (CANON §4). **Se apunta como candidata en
`TABLERO.md`; no se construye aquí.**

---

## 3. La decisión

### 3.1 Qué se hace

**Una sola función de denegación en `core/`, que reparte por canal y, para la navegación, sirve la
página de error maquetada que el producto ya tiene.**

```js
// core/auth.js — junto a requirePerm
export function denegarPermiso(c, { titulo, mensaje, accion, href } = {}) {
  const msg = mensaje || ERR.PERM;
  if (c.req.path.startsWith('/api/')) return c.json({ error: msg }, 403);
  return c.html(errorShell(titulo || 'No tienes permiso para ver esta página', msg,
                           { action: accion || 'Volver al panel', href: href || '/admin' }), 403);
}
```

La usan `requirePerm` (`core/auth.js:28`), `requireHistorial` (`core/auth.js:318-325`, con su texto
propio de datos de salud), `puedeVerAjustes` (`modules/erp/routes/settings.js:489`) y
`permissionMiddleware` (`core/permission-check.js:31`). Las cuatro copias desaparecen.

### 3.2 En qué capa vive

En **`core/`**, junto a `requirePerm`, porque el reparto por canal es plumbing de autorización, no de
presentación — y porque es donde ya viven sus cinco precedentes (§1.4). La **presentación** se
importa: `core/` no dibuja nada nuevo.

### 3.3 Qué patrón del propio código sigue

Tres, todos existentes y nombrados:

1. **El reparto por canal**: `requireHistorial` (`core/auth.js:318`) y sus cinco hermanos de §1.4.
   El criterio `c.req.path.startsWith('/api/')` es exacto para este producto: los routers `api.*`
   cuelgan de `/api/erp` (`modules/erp/routes/index.js:269`) y DISA de `/api/disa`
   (`modules/disa/index.js:2900`); y **no existe un solo `fetch` a una ruta `/admin/…`** en todo
   `modules/` (comprobado). Navegación y XHR están limpiamente separadas por prefijo.
2. **La página de error**: `errorShell` (`modules/erp/layout.js:193`), que ya existe, ya usa
   `ROOT_TOKENS`, ya es standalone («no depende de sesión ni permisos», dice su propio comentario) y
   **ya se usa para un 403 de permiso** en `modules/erp/routes/conciliacion-routes.js:200` y `:216`:
   `errorShell('No tienes permiso', ERR.PERM, {…})`. Ese es el precedente exacto; se generaliza.
3. **El texto**: `ERR.PERM` (`modules/erp/layout.js:156`), la fuente única del mensaje de permiso, ya
   compartida entre el modal, `window.api()` y las dos denegaciones de conciliación.

### 3.4 El obstáculo real, y cómo se resuelve

`core/auth.js` **no puede importar `modules/erp/layout.js`**: se cierra un ciclo. Medido:

```
modules/erp/layout.js → avisos.js → reposicion.js → routes/purchase-orders.js → core/auth.js
```

Y no es un camino aislado: **nueve** ficheros dentro del cierre transitivo de `layout.js` importan
`core/auth.js` (`routes/citas.js`, `invoices.js`, `products.js`, `tiempo.js`, `listados.js`,
`warehouses.js`, `purchase-orders.js`, `purchase-order-receipts.js`, `stock-transfers.js`).
Desenredar eso es otra tarea, mucho mayor.

**La decisión:** extraer a dos ficheros **hoja** (sin importaciones, o solo entre ellos) las piezas
que `core/` necesita, y **reexportarlas desde `layout.js`** para que ningún importador actual cambie
de ruta:

- `modules/erp/tokens.js` → `ROOT_TOKENS` (hoy `layout.js:15`). Cero imports.
- `modules/erp/pagina-error.js` → `ERR`, `DUP_MSG`, `cleanErrMsg`, `errorShell`, `errorPage`
  (hoy `layout.js:151-216`). Importa solo `./tokens.js`.

Es un **movimiento puro**: ni una línea de lógica cambia. `core/auth.js` importa de
`modules/erp/pagina-error.js`, cuyo cierre transitivo es {`pagina-error.js`, `tokens.js`} — **no
puede haber ciclo**. La dirección `core/ → modules/erp/` ya tiene precedente
(`core/tenant-middleware.js:6`, `core/tenant-provisioning.js:6,13,14`).

### 3.5 Qué se conserva tal cual

**`window.showAccessDenied()` (`layout.js:793`) y `#accessDeniedModal` (`layout.js:1827`) se
QUEDAN.** No son el fallo. Son la mitad que funciona: el aviso en página cuando una mutación por
`fetch` se deniega **con el armazón ya cargado** (`layout.js:774`). Es el equivalente correcto del
diálogo de Odoo. Lo roto era pretender usarlos desde un documento que no los tiene.

### 3.6 Alternativas descartadas

| Alternativa | Por qué se descarta |
|---|---|
| **Que la página 403 cargue `layout.js` para que `showAccessDenied` exista.** | Multiplica el problema: haría falta sesión, menú, permisos y todo `adminLayout()` para decir «no». Y seguiría siendo un diálogo sobre una página que no es una página. |
| **`await import('../modules/erp/layout.js')` dinámico dentro de la rama de denegación.** | Funcionaría (hay precedente: `core/loader.js:9`, `index.js:1231`) y cuesta una línea, pero **esconde** el ciclo en vez de quitarlo: ningún análisis estático lo ve, y deja la puerta cerrada a que `core/csrf.js` y `core/tenant-middleware.js` reutilicen `errorShell` mañana (§5.6). Cambia un problema de arquitectura por un truco. |
| **Duplicar un mini-`errorShell` dentro de `core/`.** | Sería la **quinta** copia de una página de error. El fallo de hoy es exactamente eso: copias. |
| **Pasar el renderizador como argumento a `requirePerm`.** | 433 puntos de llamada. |
| **Redirigir a `/admin` con un toast.** | Pierde el 403 (una redirección responde 200 — el aviso que `CLAUDE.md` deja escrito en §Gates de pantalla), pierde la URL que el usuario pidió, y no dice por qué. Salesforce y Fiori sirven página, no redirección. |
| **Arreglar los 14 `alert()` del producto de una vez.** | Tres están en `modules/store/` (**Capa 2, congelada** — `CLAUDE.md`) y no se pueden tocar. Los otros nueve son otra tarea. Aquí se arreglan los **dos** de la ruta de permisos, y los **doce** restantes se declaran con fecha en el censo y se apuntan en `TABLERO.md`. |
| **Añadir `alert` al censo y dejar el barrido en rojo.** | `censo-ventanitas` está en el grupo `lint` y en el grupo `RAPIDO` de `scripts/lib/gates-mapa.mjs:53,291`. Dejarlo rojo por deuda ajena hace que se ignore, y entonces deja de avisar cuando el grito es de verdad — la lección que ya está escrita en `run-gates.mjs:518`. |

---

## 4. El plan, paso a paso

> Ninguno de estos pasos ejecuta un barrido, un gate ni un test. **Los pasos 12 y 13 solo se ejecutan
> si Ibrahin lo autoriza expresamente** (`RITUAL.md` / `CLAUDE.md` §BARRIDOS). Escribir el gate del
> paso 9 es parte del trabajo; lanzarlo, no.

### Bloque A — deshacer el ciclo (movimiento puro, sin lógica nueva)

1. **CREAR `modules/erp/tokens.js`.** Mover ahí, **tal cual y con su comentario de cabecera**, el
   bloque `ROOT_TOKENS` de `modules/erp/layout.js` — **líneas 15 a 79**, desde
   `export const ROOT_TOKENS = ` hasta la línea `    }` + backtick + `;` inclusive.
   El fichero no importa nada.

2. **CREAR `modules/erp/pagina-error.js`.** Mover ahí, **tal cual y con sus comentarios**, de
   `modules/erp/layout.js`:
   - `export const ERR = {…}` con su cabecera «Mensajes de ERROR compartidos (U3)» (líneas **147-162**),
   - `const DUP_MSG = {…}` y `export function cleanErrMsg(msg)` con su comentario (líneas **164-186**),
   - `export function errorShell(title, message, opts)` con su cabecera «Página de ERROR maquetada (U3)» (líneas **188-210**),
   - `export function errorPage(c, status, title, message, opts)` con su comentario (líneas **212-216**).

   Única línea nueva del fichero: `import { ROOT_TOKENS } from './tokens.js';`.
   Cabecera de comentario obligatoria, explicando **por qué** es hoja: *«Hoja a propósito: `core/auth.js`
   la importa para la página de 403 de `requirePerm`, y `layout.js` cierra un ciclo con `core/auth.js`
   por nueve rutas (`avisos.js → reposicion.js → routes/purchase-orders.js → core/auth.js`, entre
   otras). Si algún día este fichero importa algo de `modules/erp/`, el ciclo vuelve.»*

3. **EDITAR `modules/erp/layout.js`.** Borrar los cinco bloques movidos y, en su sitio, dejar:
   ```js
   import { ROOT_TOKENS } from './tokens.js';
   import { ERR, cleanErrMsg, errorShell, errorPage } from './pagina-error.js';
   export { ROOT_TOKENS, ERR, cleanErrMsg, errorShell, errorPage };
   ```
   `ROOT_TOKENS` y `ERR` se siguen usando dentro de `layout.js` (`:200` dentro de `errorShell` —que
   se va—, `:1160` en `adminLayout`, `:1831` en el modal), así que hay que **importarlos**, no solo
   reexportarlos. **Ni un solo importador externo cambia de ruta**: `modules/portal/index.js:6`,
   `modules/erp/routes/auth.js:14` y los ~10 ficheros que importan `errorShell`/`ERR`/`cleanErrMsg`
   de `../layout.js` siguen funcionando igual.

### Bloque B — la función única de denegación

4. **EDITAR `core/auth.js`.**
   - Añadir arriba: `import { ERR, errorShell } from '../modules/erp/pagina-error.js';`
   - Añadir, justo **encima** de `requirePerm` (línea 13), la función exportada `denegarPermiso(c, opts)`
     tal como está en §3.1, con un comentario que diga qué arregla y por qué reparte por canal
     (citando `core/auth.js:318` como el hermano que ya lo hacía).
   - Sustituir la línea 28 entera por:
     ```js
     return denegarPermiso(c);
     ```
   - Sustituir las líneas 318-325 (`requireHistorial`) por:
     ```js
     return denegarPermiso(c, {
       titulo: 'No tienes acceso al historial clínico',
       mensaje: 'Son datos de salud, y solo los ve el profesional que atiende al paciente. '
              + 'Si necesitas acceso, pídeselo a la persona dueña del negocio.',
       accion: 'Volver al panel', href: '/admin',
     });
     ```
     **El mensaje del historial no se toca ni se generaliza**: es el único permiso que no perdona el
     rol (el bloque de comentario de `core/auth.js:289-304` explica por qué), y su texto tiene que
     seguir diciendo que son datos de salud. Lo que cambia es solo quién lo pinta.

5. **EDITAR `modules/erp/routes/settings.js`.** Importar `denegarPermiso` de `'../../../core/auth.js'`
   (la línea 8 ya importa `requirePerm` de ahí: añadirlo a esa misma llave) y sustituir la línea 489
   por `return denegarPermiso(c);`.

6. **EDITAR `core/permission-check.js`.** Importar `denegarPermiso` de `'./auth.js'` y sustituir la
   línea 31 por `return denegarPermiso(c);`. (Sí, hoy no la llama nadie —comprobado—; se arregla
   igual para que no resucite la cuarta copia. No se borra la función: eso sería otra decisión.)

### Bloque C — que el instrumento vuelva a ver

7. **EDITAR `scripts/censo-ventanitas.mjs`.**
   - Línea 27: `const RE = /(?<![\w.$])(prompt|confirm|alert)\s*\(/g;`
   - Después de `barrer(path.join(RAIZ, 'modules'));` (línea 136), añadir
     `barrer(path.join(RAIZ, 'core'));` con el motivo en comentario: *«`core/` estaba fuera del
     alcance, y ahí vivía la denegación de permiso de todo el producto (`core/auth.js:28`). Un censo
     que no mira donde está el fallo dice CERO y cierra la pregunta.»*
   - Añadir un tercer contador `nA` (alert) al resumen (hoy solo hay `nP` y `nC`, y `const c = hs.length - p`
     de la línea ~147 daría «confirm» a los `alert`: hay que corregirlo).
   - **DEUDA DECLARADA.** Añadir un mapa, con fecha y motivo por entrada (la costumbre de
     `ROJOS_CONOCIDOS` en `run-gates.mjs:123`), con el **recuento exacto por fichero** de los
     `alert()` preexistentes que esta tarea no toca:

     | fichero | alert | motivo |
     |---|---|---|
     | `modules/erp/routes/citas.js` | 4 | 31 ago 2026 · errores del calendario; tarea aparte |
     | `modules/superadmin/index.js` | 4 | 31 ago 2026 · superadmin; **dos encadenadas** (`:352+353`, `:371+375`) — es el caso que mata |
     | `modules/store/routes.js` | 3 | 31 ago 2026 · **Capa 2, congelada** (`CLAUDE.md`): no se toca |
     | `modules/superadmin/integridad.js` | 1 | 31 ago 2026 · superadmin; tarea aparte |

     La comparación es por **recuento exacto**, no por «al menos»: si un fichero declarado sube de 4
     a 5, el censo sale en rojo; si baja a 3, sale en rojo por **declaración rancia** (la misma regla
     que `run-gates.mjs:136-141` aplica a los rojos conocidos). Ninguna otra aparición se perdona.
   - **La salida no puede mentir.** El titular sigue diciendo la verdad —cuenta las 12— y se añade
     una línea nueva que es la que decide el código de salida:
     ```
     VENTANITAS VIVAS: 12  (0 prompt · 0 confirm · 12 alert)
     DECLARADAS COMO DEUDA: 12   (ver TABLERO.md §Deuda técnica · alert-pendientes)
     SIN DECLARAR: 0
     ```
     `process.exit(sinDeclarar ? 1 : 0)`. La línea `RESULTADO: … ✓ · … ✗` que lee
     `scripts/run-gates.mjs` pasa a contar **las sin declarar**.

8. **EDITAR `scripts/gate-sin-ventanitas.mjs`.** Su línea 65 lee `VENTANITAS VIVAS: (\d+)` y exige 0;
   con el cambio del paso 7 ese número pasa a ser 12 y el gate se caería por deuda ajena. Sustituir
   por **dos** aserciones:
   - `SIN DECLARAR: (\d+)` === 0 → «ni un `prompt()`, `confirm()` o `alert()` nuevo, en `modules/` ni en `core/`»
   - la de `ENCADENADAS` se conserva, pero pasa a exigir que **no crezcan**: hoy son 2, las dos en
     `modules/superadmin/index.js`, y son preexistentes y declaradas (paso 7). Se compara contra 2 con
     su comentario y su fecha, no contra 0.

### Bloque D — la comprobación de lo que ve el usuario

9. **CREAR `scripts/gate-403-permiso.mjs`.** Gate de navegador, en el molde de
   `scripts/gate-propuestas-pagos-permisos.mjs` (usuario de prueba con permisos a medida + sesión
   sembrada en la BD + `puppeteer`, `scripts/lib/gate-env.mjs` para `tenantDb`/`launchOpts`).
   Marca `GATE403-<rid>`, prefijo `ZZ ` en los nombres, limpieza en el **`finally` y por la marca**
   (`CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra»). Crea **solo usuarios, permisos y
   sesiones**: nada que pueda quedar atado a una factura o a la cadena de VERI\*FACTU.

   Lo que afirma:
   1. Un empleado sin `invoices.read` navega a `/admin/contabilidad` → status **403**, y
      `page.url()` **sigue siendo** `/admin/contabilidad` (no hay redirección — el aviso de
      `CLAUDE.md` §Gates de pantalla).
   2. El `document.body.innerText` de esa página contiene el texto de `ERR.PERM` y hay un enlace
      cuyo `href` es `/admin`, **visible** (`getBoundingClientRect().height > 0`).
   3. **Con `alert`, `prompt` y `confirm` neutralizados** en `evaluateOnNewDocument` (devolviendo
      `null`/`false` y **apuntando cada llamada**): la página sigue mostrando el texto, y el contador
      de diálogos es **0**. Es la comprobación que mide el fallo de verdad: hoy, con las ventanitas
      silenciadas, esa página está en blanco.
   4. Sin errores de JS en consola en esa página.
   5. **Canal API:** el mismo empleado hace `DELETE /api/erp/settings/email-templates/recordatorio/unico`
      (guardado por `requirePerm('company.update')`, `settings.js:449`) → 403 con `content-type`
      que contiene `application/json` y cuerpo `JSON.parse`-able con clave `error`.
   6. **Vista de ajustes:** un empleado sin `company.read` y sin ninguna sección de config visible
      navega a `/admin/settings` → 403 en HTML con el mismo texto (cierra `settings.js:489`).
   7. **Historial:** un empleado con rol `admin` **sin** `historial.read` navega a
      `/admin/historial/<id>` → 403 y el texto sigue siendo el de datos de salud, **no** el genérico
      (que la unificación no haya aplanado la única excepción del producto).
   8. **Captura.** `page.screenshot()` de la pantalla 403 terminada, guardada en `/tmp`, y se
      **mira** antes de dar la tarea por hecha (`CLAUDE.md` §«Se mira la captura»).

10. **EDITAR `scripts/lib/gates-mapa.mjs`.** Registrar `'gate-403-permiso'` en el grupo `pantallas`,
    junto a `'gate-sin-ventanitas'` (línea 235), con su comentario de una línea. Sin esto, el censo de
    gates de `run-gates.mjs:528` lo cantará como **gate invisible**.

### Bloque E — dejarlo escrito

11. **EDITAR `TABLERO.md`.**
    - Cerrar la tarea `pantalla-403-ventanita` en el formato de las dos anteriores (§«Cerrada por el
      orquestador», commits, registro en `docs/orquestador/tareas/`).
    - **Abrir** en §Deuda técnica la entrada `alert-pendientes`: *«12 `alert()` vivos, declarados en
      `scripts/censo-ventanitas.mjs` el 31 ago 2026: 4 en `routes/citas.js`, 4 en `superadmin/index.js`
      (dos encadenadas), 1 en `superadmin/integridad.js` y 3 en `store/routes.js` —estas últimas
      **Capa 2, congelada**, no se tocan hasta descongelar—. Dos de ellas, las encadenadas del
      superadmin, son el caso que mata.»*
    - Apuntar como candidata, **sin construir**: el registro de denegaciones estilo `SU53` (§2, SAP).

12. *(Solo con autorización expresa)* `node scripts/censo-ventanitas.mjs`,
    `node scripts/lint-js-servido.mjs`, `node scripts/lint-plantillas.mjs`.

13. *(Solo con autorización expresa)* `node scripts/gate-403-permiso.mjs` y
    `node scripts/gate-sin-ventanitas.mjs`.

---

## 5. Riesgos

### 5.1 Mover `ROOT_TOKENS` y `ERR` rompe una pantalla en silencio — **el riesgo grande**

`ROOT_TOKENS` lo importan `modules/portal/index.js:6` y `modules/erp/routes/auth.js:14` (que lo mete
en **seis** plantillas: `:76, :213, :422, :473, :532, :626` — login, 2FA, recuperación de contraseña).
`ERR` y `cleanErrMsg` los importan una decena de rutas. Si falta un `export` en la reexportación, la
pantalla de **login** se queda sin estilos o el módulo no arranca.

**Mitigación:** (a) es un movimiento **literal**, sin reescribir nada; (b) la reexportación de
`layout.js` (paso 3) mantiene **todas** las rutas de importación actuales, así que no se toca ni un
importador; (c) un `export` que falte revienta al **arrancar**, no en producción silenciosa
—`systemctl status bamburu` lo canta—; (d) el criterio 8 exige que `/admin/login`, `/admin/settings`
y `/admin/portal` respondan 200 con esa misma URL final, que son los tres consumidores de
`ROOT_TOKENS`; (e) `lint-js-servido.mjs` recorre 324 pantallas y compila su JS servido.

### 5.2 Las 298 rutas de API pasan de HTML a JSON

Cambia el `content-type` de 298 respuestas 403. **No es una regresión para el producto**:
`window.api()` (`layout.js:774-775`) corta en 403 antes de leer el cuerpo, y **no existe ni un
`fetch` a `/admin/…`** en `modules/` (comprobado), así que ninguna llamada XHR cae por el lado HTML.
Cualquier `fetch` suelto que hoy hiciera `await r.json()` sobre esas respuestas fallaba; ahora
funciona. El cambio va estrictamente hacia mejor.

**Sí puede mover gates:** varios (`gate-propuestas-pagos-permisos`, `gate-historial-clinico`,
`gate-disa-informes`, `test-c6-acceso`…) afirman sobre 403 de rutas de API. El **status no cambia**
(sigue 403), pero uno que hoy espere que `r.json()` reviente cambiaría de camino.
**Mitigación:** el paso 13 incluye los gates de permisos; si alguno afirma sobre el cuerpo HTML de un
403, se corrige **el gate**, no el producto, y se anota el motivo.

### 5.3 El ciclo de importación

Es el riesgo que la decisión existe para eliminar. **Mitigación:** `modules/erp/pagina-error.js` solo
puede importar `./tokens.js`, y `tokens.js` nada. La cabecera del paso 2 lo deja escrito para el
siguiente que lo abra. Comprobación mecánica: el cierre transitivo de `pagina-error.js` tiene que
tener **2 ficheros**.

### 5.4 Aplanar la excepción del historial clínico

`requireHistorial` es **la única excepción de autorización del producto** (`core/auth.js:289-304`).
Al pasarla por la función común, la tentación es que herede el texto genérico y deje de decir que son
datos de salud.
**Mitigación:** el paso 4 pasa el mensaje explícito, y el criterio 5 lo comprueba en el navegador.
**Lo que NO se toca en ningún caso:** la lógica de quién entra (`owner` sí por rol, `admin` **no**).
`denegarPermiso` solo dibuja; no decide.

### 5.5 Datos, concurrencia, migraciones y VERI\*FACTU

**Ninguno.** Esta tarea no toca esquema, ni escribe en ninguna base de datos, ni ejecuta migraciones,
ni roza `verifactu_registros` ni la cadena de huellas. El único código que escribe algo es el gate
del paso 9, y solo crea usuarios/permisos/sesiones de prueba —nada que pueda quedar atado a una
factura, que es la trampa documentada en `CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra»—
y los borra en el `finally` por su marca.

### 5.6 Lo que queda fuera a propósito (y por qué)

- **`core/csrf.js:38` y `core/tenant-middleware.js:124`**: dos páginas 403 más, maquetadas a mano.
  No son de permisos y no entran aquí. Pero después de este plano `errorShell` es importable desde
  `core/` sin ciclo, así que unificarlas es una tarea de una línea cada una. Se apunta en `TABLERO.md`.
- **Los 12 `alert()` restantes**: §4 paso 7 y 11. Tres son Capa 2 congelada.
- **El registro de denegaciones estilo `SU53`**: §2 (SAP). Función nueva; fase equivocada.
- **El agujero de `menu.js:468`** (empleado con cero permisos ve el menú entero): ya declarado ahí
  como otra tarea. Este plano **no** lo cierra; lo que hace es que, cuando ese empleado pulse, vea
  una explicación en vez de una página en blanco.

---

## 6. Criterios de aceptación

- [ ] `core/auth.js`, `modules/erp/routes/settings.js` y `core/permission-check.js` no contienen ninguna llamada a `alert(`, `prompt(` ni `confirm(` fuera de comentarios, y ninguno de los tres aparece en la salida de `node scripts/censo-ventanitas.mjs`.
- [ ] Un empleado sin `invoices.read` que navega a `/admin/contabilidad` recibe status **403**, su **URL final sigue siendo `/admin/contabilidad`** (sin redirección), y el HTML servido contiene el texto de `ERR.PERM` y un enlace visible a `/admin`.
- [ ] Cargando esa misma pantalla con `window.alert`, `window.prompt` y `window.confirm` neutralizados antes del documento, el texto de la denegación aparece en `document.body.innerText`, el contador de diálogos interceptados es **0** y la consola no registra ningún error de JS.
- [ ] Un empleado sin `company.update` que hace `DELETE /api/erp/settings/email-templates/recordatorio/unico` recibe 403 con `content-type` que contiene `application/json` y un cuerpo `JSON.parse`-able con clave `error`; y ese mismo empleado, sin `company.read` ni ninguna sección de configuración visible, recibe 403 **en HTML** al navegar a `/admin/settings`.
- [ ] Un usuario con rol `admin` **sin** el permiso `historial.read` que navega a `/admin/historial/<id>` sigue recibiendo 403 con el mensaje de datos de salud (contiene «datos de salud»), **no** el genérico de permiso.
- [ ] `node scripts/gate-403-permiso.mjs` sale con código 0 y **0 ✗**, y al terminar no queda en la BD del tenant ningún usuario ni sesión con la marca `GATE403-`.
- [ ] `node scripts/censo-ventanitas.mjs` recorre `modules/` **y** `core/`, cuenta `alert` además de `prompt`/`confirm`, imprime `SIN DECLARAR: 0` y sale con código 0; y `node scripts/gate-sin-ventanitas.mjs` sigue con 0 ✗.
- [ ] `node scripts/lint-js-servido.mjs` sale con código 0, y `/admin/login`, `/admin/settings` y `/admin/portal` —los tres consumidores de `ROOT_TOKENS`— responden 200 con esa misma URL final.
