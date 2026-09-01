❌ RECHAZADO

# Revisión — `pantalla-403-ventanita`

- **Analizado:** `docs/architecture/task-pantalla-403-ventanita-analysis.md`
- **Commits revisados:** `6453f12` (la tarea). En el rango `645fcaf..HEAD` hay otros dos —`3af7c53` y
  `7d67409`— que son del orquestador (`orchestrator/bucle.js`, `orchestrator/pruebas/`) y no de esta
  tarea; se comprueba solo que no tocan nada suyo, y no lo tocan (ver §2).
- **Fecha de la revisión:** 1 sep 2026

**Resumen en una línea:** el arreglo está bien construido y **todo lo que se puede medir sin
navegador da verde** —lo he medido yo, 36 aserciones propias—, pero la pieza central del Bloque D
del plano, `scripts/gate-403-permiso.mjs`, **no se ha ejecutado ni una sola vez**, ni por el
programador ni por mí, y la captura que la norma obliga a mirar no existe. Dos criterios de
aceptación de ocho quedan sin constancia. Se rechaza por eso y solo por eso.

---

## 1. Los criterios de aceptación, uno por uno

| # | Criterio | ¿Cumple? | Prueba |
|---|----------|----------|--------|
| 1 | `core/auth.js`, `settings.js` y `permission-check.js` sin `alert(`/`prompt(`/`confirm(` fuera de comentarios, y ninguno aparece en la salida del censo | **SÍ** | `grep -n "alert(\|prompt(\|confirm(" core/auth.js core/permission-check.js modules/erp/routes/settings.js` → 2 líneas, ambas comentario (`core/auth.js:21` y `:26`). Ejecutado `node scripts/censo-ventanitas.mjs`: los 4 ficheros que lista son `routes/citas.js`, `superadmin/index.js`, `store/routes.js` y `superadmin/integridad.js`; ninguno de los tres |
| 2 | Empleado sin `invoices.read` en `/admin/contabilidad` → 403, URL final sin redirección, HTML con `ERR.PERM` y enlace visible a `/admin` | **SÍ** | Ejercitado `requirePerm('invoices.read')` a través de un router Hono real (`app.request('/admin/contabilidad')`, sesión `role:'employee'`, `user_permissions` vacía): **403**, `content-type: text/html; charset=UTF-8`, cuerpo con el texto de `ERR.PERM`, `<a class="e-act" href="/admin">Volver al panel →` (`display:inline-block;padding:.5rem 1rem` → caja no nula), `<title>No tienes permiso para ver esta página</title>`. Sin redirección: la respuesta es 403 con cuerpo, no 3xx, y sin `Location`. Comprobado además que en el producto real esa ruta es `views.get('/', requirePerm('invoices.read'), …)` (`modules/erp/routes/contabilidad-routes.js:208`), y que su `c.redirect` va **después** del permiso, así que un denegado no llega a él |
| 3 | La misma pantalla con `alert`/`prompt`/`confirm` neutralizados: el texto aparece en `document.body.innerText`, contador de diálogos **0**, consola sin errores de JS | **NO** | **No se ha ejecutado en ningún navegador.** Lo único que consta es estructural, medido sobre el HTML servido: el documento **no contiene ni un `<script>`** (`ok(!/<script/i.test(navH))` ✓), luego no hay código que pueda llamar a un diálogo ni producir un error de consola. Es deducción, no medición — y la §«Lo que solo ve un navegador» de `CLAUDE.md` existe justo porque esa deducción ha fallado antes |
| 4 | Empleado sin `company.update`: `DELETE /api/erp/settings/email-templates/recordatorio/unico` → 403 `application/json` con clave `error`; y sin `company.read` ni secciones, `/admin/settings` → 403 **en HTML** | **SÍ** | Montado `createSettingsRoutes(db,{})` de verdad (`views` en `/admin/settings`, `api` en `/api/erp/settings`) con sesión `employee` y `userPerms:['clients.read']`: `GET /admin/settings` → **403**, HTML, con `ERR.PERM`, con `<a class="e-act" href="/admin">` y sin un solo `<script>` — cierra `settings.js:489`. `DELETE /api/erp/settings/email-templates/recordatorio/unico` → **403**, `content-type: application/json`, cuerpo `{"error":"No tienes permiso para esta acción…"}` `JSON.parse`-able. La ruta existe y está guardada: `settings.js:449` `api.delete('/email-templates/:tipo/:tono', requirePerm('company.update'), …)` |
| 5 | Un `admin` **sin** `historial.read` en `/admin/historial/<id>` sigue recibiendo 403 con el mensaje de datos de salud, no el genérico | **SÍ** | Ejercitado `requireHistorial()` en router real con `role:'admin'`: **403**, el cuerpo contiene «datos de salud», **no** contiene `ERR.PERM`, y trae su salida `<a class="e-act" href="/admin">`. Comprobado además que la **decisión** no se tocó: un `admin` sí pasa `requirePerm` (200) y **no** pasa `requireHistorial` (403) — `denegarPermiso` solo dibuja. Y por el canal API, `/api/erp/historial/1` → 403 `application/json` |
| 6 | `node scripts/gate-403-permiso.mjs` sale con código 0 y **0 ✗**, y no queda ningún usuario ni sesión con la marca `GATE403-` | **NO** | **El gate no se ha ejecutado nunca.** Lo dice el propio commit («NO SE HA PODIDO EJECUTAR») y lo he confirmado: `/snap/bin/chromium` muere en `snap-confine` («required permitted capability cap_dac_override not found»), y las dos versiones de Chrome que tiene puppeteer en `~/.cache/puppeteer/chrome/linux_arm-*` son **binarios x86-64 en una máquina `aarch64`** (`file …/chrome-linux64/chrome` → *ELF 64-bit, x86-64*). El fichero es sintácticamente válido (`node --check` ✓) y he leído sus 262 líneas, pero eso no dice si pasa |
| 7 | El censo recorre `modules/` **y** `core/`, cuenta `alert`, imprime `SIN DECLARAR: 0`, sale 0; y `gate-sin-ventanitas` sigue con 0 ✗ | **NO** (la primera mitad SÍ) | Censo ejecutado: `VENTANITAS VIVAS: 12 (0 prompt · 0 confirm · 12 alert)`, `SIN DECLARAR: 0`, `RESULTADO: 1 ✓ · 0 ✗`, **exit 0**. Verificados además sus dos caminos rojos con copias manipuladas: subiendo `citas.js` de 4 a 5 → `DECLARACIONES RANCIAS: 1`, exit **1**; bajándolo a 3 → `SIN DECLARAR: 4` (no perdona ninguna del fichero), exit **1**. `barrer(RAIZ/core)` está en `censo-ventanitas.mjs:166`. **La segunda mitad no:** `gate-sin-ventanitas` es de navegador y no se ha ejecutado |
| 8 | `node scripts/lint-js-servido.mjs` sale con código 0, y `/admin/login`, `/admin/settings` y `/admin/portal` responden 200 con esa misma URL final | **NO** | **No ejecutado, y ejecutarlo ahora daría un verde falso:** `lint-js-servido` pide las pantallas al servidor vivo por HTTPS y **no pasa por `exigeCodigoServido()`**; el servicio arrancó el `2026-08-31 13:19:06` (`systemctl show bamburu`) y el commit es de las `23:38:32`, así que el proceso sirve **código viejo**. No se puede reiniciar desde aquí (`sudo` bloqueado por «no new privileges»). Lo que sí he medido, en proceso: `/admin/login` y `/admin/forgot-password` renderizados desde `createAuthRoutes(db)` → **200** y `:root{ … --accent: #2F6BFF`  dentro de su `<style>`; y que `layout.js` sigue exportando `ROOT_TOKENS, ERR, cleanErrMsg, errorPage, errorShell` |

**5 de 8 en SÍ. Tres en NO (3, 6, 8) y la segunda mitad del 7.** Ninguno de los tres NO es un fallo
del código: los tres son ausencia de ejecución.

---

## 2. ¿Se construyó lo que decía el plano?

Sí, paso por paso, y sin desviarse a nada que el plano no nombre.

- **Bloque A (pasos 1-3) — el movimiento es literal, y lo he verificado mecánicamente.**
  `diff` de las líneas 15-79 del `layout.js` anterior contra `tokens.js:8-72` → **idéntico**; líneas
  147-216 contra `pagina-error.js:12-81` → **idéntico**. Y al reconstruir el `layout.js` viejo
  quitándole esos dos bloques y compararlo con el nuevo, la **única** diferencia son las tres líneas
  de import/reexport, su comentario y una línea en blanco. No hay lógica nueva escondida en la mudanza.
- El ciclo queda deshecho de verdad: `pagina-error.js` importa solo `./tokens.js` y `tokens.js` no
  importa nada — **cierre transitivo de 2 ficheros**, como exigía §5.3. `import('./core/auth.js')`
  resuelve y expone `denegarPermiso`; `import('./modules/erp/layout.js')` expone las cinco piezas.
- **Bloque B (pasos 4-6):** las cuatro copias desaparecen. `core/auth.js:28` y `:318-325`,
  `settings.js:489` y `permission-check.js:31` llaman ya a `denegarPermiso`. El texto del historial
  se pasa explícito y no se generalizó (§5.4 mitigado, criterio 5 en SÍ).
- **Bloque C (paso 7-8):** censo y `gate-sin-ventanitas` como pedía el plano, incluida la deuda por
  recuento exacto y los dos rojos (nueva y rancia).
- **Bloque D (pasos 9-10):** gate escrito y registrado en el grupo `pantallas`
  (`gates-mapa.mjs:236`, dentro del grupo que abre en la línea 218 — la colocación es la pedida).
- **Bloque E (paso 11):** `TABLERO.md` abre `alert-pendientes` con el desglose por fichero y apunta
  las dos candidatas sin construir (SU53 y las dos 403 de `core/`). El **cierre** de la tarea se deja
  al orquestador, con su motivo escrito en el commit; es lo mismo que se hizo con
  `disa-informes-permiso-dueno` y `disa-herramientas-en-paralelo`, cuyas fichas dicen literalmente
  «Cerrada por el orquestador». No lo cuento como desviación.
- **`showAccessDenied` y `#accessDeniedModal` siguen vivos** (`layout.js:665` y `:1702`), como
  mandaba §3.5. La mitad que funcionaba no se tocó.
- **Nada fuera de alcance.** Los 11 ficheros de `6453f12` están todos nombrados en el plano. Los otros
  dos commits del rango tocan `orchestrator/` y `docs/`, no rozan ninguno de estos ficheros.

---

## 3. El nivel de construcción

Está por encima del mínimo. Lo que he mirado:

- **Capa y patrón:** `denegarPermiso` vive donde ya viven sus seis hermanos de reparto por canal
  (`core/auth.js:215`, `:238`, `csrf.js`, `tenant-middleware.js`, `validate.js`, `rate-limit.js`).
  No inventa un patrón al lado: adopta el que `requirePerm` era el único en no seguir.
- **Una pieza, una cosa:** `denegarPermiso` solo dibuja. La decisión de quién entra se queda en
  `requirePerm`/`requireHistorial`, y lo he comprobado ejecutándolo (un `admin` pasa el primero y no
  el segundo).
- **Nada escrito a mano donde debería haber fuente única:** el texto sale de `ERR.PERM`, los colores
  de `ROOT_TOKENS`, la maqueta de `errorShell`. El gate **importa** `ERR` en vez de teclear el
  mensaje (`gate-403-permiso.mjs:47`), que es lo correcto: un gate que copia el texto deja de medir
  el producto en cuanto alguien lo cambia en un sitio.
- **Distingue errores:** JSON para `/api/`, página para la navegación, y el historial conserva su
  mensaje propio. No los mete todos en el mismo saco — es justo lo contrario de lo que había.
- **Repetible sin efectos duplicados:** el censo es lectura pura; el gate limpia **por la marca** y en
  el `finally`, no por los ids de la pasada, y lanza el navegador **antes** de sembrar porque
  `launchOpts()` puede hacer `process.exit(2)` y saltarse el `finally` (`gate-403-permiso.mjs:106-109`).
  Ese razonamiento está bien visto y bien escrito.
- **Se puede probar por partes:** he podido ejercitar `requirePerm`, `requireHistorial`,
  `permissionMiddleware` y el router de ajustes cada uno por su lado, sin levantar el producto.
  Eso es consecuencia directa de haber extraído los dos ficheros hoja.
- **Los comentarios explican el porqué, no el qué**, y cada cifra lleva fecha. El bloque de
  `censo-ventanitas.mjs` sobre el recuento exacto es de los que evitan la siguiente avería.

No tengo ningún reparo de nivel. **`NIVEL-INSUFICIENTE` no aplica.**

---

## 4. Qué se rompe

- **Las 298 respuestas de API pasan de HTML a JSON (riesgo §5.2).** Comprobado que nadie las leía como
  HTML: no existe **ni un** `fetch('/admin…')` en `modules/` ni en `core/`, y ningún gate de
  `scripts/` afirma sobre `text/html` o `DOCTYPE` en una respuesta 403. `window.api()`
  (`layout.js:646-647`) sigue cortando en 403 antes de leer el cuerpo. El cambio va hacia mejor.
- **El portal (`modules/portal/admin.js`) usa `requirePerm` cinco veces** y su enlace de salida es
  `/admin`. No es un problema: ese router **se monta bajo `/admin`** (es el panel del dueño, no la
  cara pública del cliente), así que la salida apunta donde debe.
- **La mudanza de `ROOT_TOKENS` (riesgo §5.1, «el riesgo grande»)**: mitigado y verificado. Diff
  literal, reexportación completa, los tres módulos que fallaban al importarse solo fallaban por
  `RESEND_API_KEY` ausente en mi shell (con una clave ficticia cargan los cuatro), y `/admin/login` y
  `/admin/forgot-password` renderizan con los tokens dentro de su `<style>`.
- **Datos, migraciones, concurrencia, VERI\*FACTU:** ninguno. No se toca esquema ni se escribe en
  ninguna BD. El único que escribe es el gate, y solo `admin_users`, `user_permissions` y
  `admin_sessions`, todo con marca y borrado en el `finally` — nada que pueda quedar atado a una
  factura.
- **La única página nueva no es nueva:** `errorShell` ya se sirve en producción desde 46 puntos de 12
  ficheros de rutas, dos de ellos ya para un 403 de permiso (`conciliacion-routes.js:200` y `:216`).
  Eso baja mucho el riesgo de que se vea mal — pero no lo cierra, porque nadie ha mirado **esta**.

---

## 5. Motivo del rechazo

### [SIN-PRUEBAS] El gate del Bloque D no se ha ejecutado nunca, ni se ha mirado su captura

**Dónde:** `scripts/gate-403-permiso.mjs` (fichero entero) · criterios de aceptación 6, 3 y la
segunda mitad del 7.

**Qué pasa:** el gate se entrega **sin haberse corrido una sola vez**. `node --check` pasa y el código
se lee bien, pero eso no dice si pasa: no consta que sus 20 aserciones se cumplan, ni que la siembra
y la limpieza por la marca funcionen contra la BD real, ni que la neutralización de `alert`/`prompt`/
`confirm` en `evaluateOnNewDocument` devuelva 0 diálogos, ni que el enlace de salida tenga caja
visible. La captura `/tmp/gate-403-permiso.png` **no existe**, así que la regla de `CLAUDE.md`
«se mira la captura» no se ha cumplido en una tarea cuyo entregable **es una pantalla**.

Esto ya pasó en este mismo repo y está escrito en `TABLERO.md` §H: *«SU GATE SE HABÍA ENTREGADO SIN
CORRER, y al correrlo NO PASABA»* — y al correrlo salió, además, un defecto de producto de verdad.
Por eso no basta con que el gate esté bien escrito.

He confirmado que el impedimento es real y que **es del shell del agente, no del servidor**:
`sudo` está bloqueado por «no new privileges», `/snap/bin/chromium` muere en `snap-confine` por la
misma causa (`cap_dac_override` no concedida), y las dos copias de Chrome de puppeteer
(`~/.cache/puppeteer/chrome/linux_arm-149…` y `linux_arm-150…`) son **binarios x86-64 en una máquina
aarch64**. El servicio `bamburu` corre con normalidad bajo systemd: desde una sesión SSH normal esas
tres barreras no existen.

**Qué hay que hacer** — es una ejecución, no una reescritura. Desde una sesión normal (no la del
agente), en este orden:

1. `sudo systemctl restart bamburu` — sin esto el proceso sirve el código de las 13:19 y cualquier
   comprobación contra el servidor mide la versión anterior.
2. `node scripts/gate-403-permiso.mjs` → tiene que salir **0 ✗ y código 0**. Si falla, arreglar lo que
   señale (gate o producto, según lo que diga) y volver a correrlo.
3. **Abrir `/tmp/gate-403-permiso.png` y mirarla**, y decir en la entrega qué se ve. No vale con
   generarla.
4. `node scripts/gate-sin-ventanitas.mjs` → 0 ✗ (cierra la segunda mitad del criterio 7).
5. `node scripts/lint-js-servido.mjs` → código 0, y comprobar que `/admin/login`, `/admin/settings` y
   `/admin/portal` responden 200 **con esa misma URL final** (criterio 8). Este es el que más falta
   hace de los cinco: la tarea ha sacado 146 líneas de `layout.js`, que es exactamente la clase de
   cambio para la que se escribió esa herramienta.

Pegar la salida de los cinco en la entrega. Si alguno se cae por deuda ajena, declararlo con su
motivo en vez de darlo por bueno.

---

## Observaciones (no bloquean)

1. **La descripción del censo en `gates-mapa.mjs:53` se quedó vieja.** Dice *«un prompt() o un
   confirm() nuevo deja un botón muerto sin avisar»*, y desde este commit también caza `alert()` y
   mira `core/`. Lo mismo en el comentario de `gates-mapa.mjs:291`. Es un caso pequeño de la regla
   «un titular se corrige con el cuerpo que lo desarrolla»: quien lea el mapa para saber qué cubre el
   rápido leerá menos de lo que cubre.

2. **`gate-403-permiso` levanta un negocio extra y no está declarado en `TENANT_EXTRA`.** Usa
   `negocioDesechable()` para el bloque [5], que por dentro llama a `provisionTenant`. El detector de
   `run-gates.mjs:392` mira `src.includes('provisionTenant')` sobre el fichero del gate, así que no lo
   ve y **no canta desajuste** — pero eso es una ceguera del detector, no una declaración correcta:
   `gate-historial-clinico` está en el mismo caso y ya lleva tiempo así. Declararlo en `TENANT_EXTRA`
   con su motivo (o enseñarle al detector a reconocer `negocioDesechable`) mantiene la lista
   diciendo la verdad, que es lo que su propia cabecera pide.

3. **Dos páginas de 403 siguen escritas a mano** (`core/csrf.js:38`, `core/tenant-middleware.js:124`).
   El plano las dejó fuera a propósito y `TABLERO.md` ya las apunta como candidatas. Solo lo repito
   aquí porque ahora cuestan literalmente una línea cada una: `errorShell` ya es importable desde
   `core/` sin cerrar ningún ciclo.

4. **Todo lo que he podido medir sin navegador da verde**, y lo dejo dicho para que no se rehaga
   trabajo: 21 aserciones sobre `requirePerm` / `requireHistorial` / `permissionMiddleware` en
   routers Hono reales, 8 sobre el router de ajustes y su API, 4 sobre `/admin/login` y
   `/admin/forgot-password` con los tokens, y 3 pasadas del censo (verde, rojo por nueva, rojo por
   rancia). El rechazo **no pone en duda el arreglo**: pone en duda que se haya visto funcionar donde
   lo ve el dueño.
