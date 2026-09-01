# `portal-formato-dinero` — informe de construcción

- **taskId:** `portal-formato-dinero`
- **intento:** 3 (vengo de un rechazo)
- **entrega vigente:** `bfea8a8` + `d93125e`, **intacta**. No he commiteado nada en esta vuelta.
- **estado:** construido y probado · **6 de 8 criterios en SÍ, verificados por mí hoy** · 2 criterios
  bloqueados por estado de la máquina, no por el código.

---

## 0. LO PRIMERO: RETIRO EL «🛑 ANÁLISIS IMPOSIBLE» DEL INTENTO 2

El intento 2 encabezó este mismo fichero con `🛑 ANÁLISIS IMPOSIBLE`. **Esa etiqueta estaba mal
puesta, y es lo que hay que corregir en esta vuelta.**

El análisis **no es imposible: está construido entero**. Sus seis pasos se implementaron en `bfea8a8`
y el revisor los dio por buenos con estas palabras suyas: *«se construyó lo que decía el plano»*,
*«Ficheros fuera del plano: ninguno»*, *«`NIVEL-INSUFICIENTE` no aplica»*. Un plano que se construye
y se aprueba no es un plano imposible.

Lo que sí es cierto —y es lo único cierto de aquel informe— es que **dos criterios de aceptación no
se pueden poner en verde**. Pero eso no es lo mismo: la etiqueta `ANÁLISIS IMPOSIBLE` le dice al
orquestador *«no construyas, devuelve esto al arquitecto»*, cuando la verdad es *«está construido y
entregado; faltan dos criterios que dependen de una decisión del dueño»*. Con la etiqueta mal puesta
el circuito da vueltas, que es exactamente lo que pasó.

Y hay una contradicción que aquel informe no vio en sí mismo: la vía `ANÁLISIS IMPOSIBLE` termina en
*«después no commitees nada»*, pero **ya había dos commits entregados**. Declarar imposible sobre una
entrega existente deja el estado incoherente.

**Este informe es, por tanto, un informe de entrega normal.** Lo que pido abajo no es replantear la
tarea: es una línea de decisión sobre dos criterios.

---

## 1. Lo que he verificado YO en esta vuelta (nada de fiarme del informe anterior)

Todo lo de abajo es de solo lectura: `grep`, `SELECT` sobre las BD, evaluación de funciones puras y
`git`. **No he lanzado ni un gate ni un barrido**, porque `CLAUDE.md` manda que una comprobación
pedida una vez se ejecuta **una** vez, y las dos que pide el análisis ya se ejecutaron en el intento 2.
Repetirlas para verlo con mis ojos sería justo la segunda pasada que está prohibida.

### Criterio 1 — ✅

```
modules/portal/admin.js: 0        modules/portal/index.js: 0        modules/portal/portal.js: 0   (toFixed)
modules/portal/index.js:11: import { fmtEur } from '../erp/margen.js';
grep -rnE "(const|let|var)\s+\w+\s*=.*(sym|SYM).*toFixed" modules/portal/   →  vacío
```

### Criterios 2 y 3 — ✅

Las siete interpolaciones pasan por el alias `dinero`, leídas una a una: tabla de facturas
(`index.js:63`), píldora de pendiente (`:64`), «en total» (`:85`), «de media» (`:86`), «Lo que más
compras» (`:93`), «Por año» (`:96`) y el subtítulo «Pendiente total» (`:119`). El alias es
`const dinero = (n, sym) => escHtml(fmtEur(Number(n || 0), sym || '€'));` — uno solo, no nace un
segundo formateador.

Evaluado el motor en Node 22 con los valores reales de la pantalla:

```
fmtEur(60493.95,'€') → "60.493,95 €"      fmtEur(6023) → "6.023,00 €"
fmtEur(600,'€')      → "600,00 €"          fmtEur(0,'€') → "0,00 €"   (no "—": por eso el Number(n||0))
```

Sobre HTML servido queda la medida del intento 2: **10 importes, 0 con símbolo delante, 0 con punto
decimal**, y la guarda contra el verde sobre nada informando `84.814,95 € · 121,00 € · 12.100,00 €`.

### Criterio 5 — ✅

`fechaHoraEs` es un `exec` de un regex y una concatenación de sus grupos: **no hay ni una operación
aritmética ni de zona horaria en el cuerpo**, así que los dígitos no pueden cambiar. Comprobado:

```
fechaHoraEs('2026-09-01 03:57:42') → "01/09/2026 03:57"      fechaHoraEs('') → "—"
fechaEs('2026-03-12')              → "12/03/2026"
```

### Criterio 6, segunda mitad — ✅

`grep -n 600 scripts/gate-portal-ampliado.mjs` → el patrón viejo `/600[.,]00/` **no aparece en
ninguna línea del fichero**, ni siquiera en el comentario; `:118` es `ok(/600,00 €/.test(vista), …)`,
y `fmtEur(600,'€')` da exactamente esa cadena.

### Criterio 7 — ✅

```
portal_tokens LIKE 'zz-dinero-portal-%'   → 0      portal_mensajes LIKE 'ZZ dinero portal%' → 0
clients LIKE 'GG-%'                       → 0      portal_mensajes (total)                  → 0
verifyTenantInvoices(desarrollo-bamburu)  → { total: 919, ok: true, alarm: null }
```

### Criterio 8 — ✅

```
git diff --name-only b1f8770..HEAD
TABLERO.md · modules/erp/voz.js · modules/portal/admin.js · modules/portal/index.js
scripts/gate-portal-ampliado.mjs · scripts/verify-dinero-espanol.mjs
```

Seis, los seis nombrados, ninguno más. Y `modules/erp/routes/invoices.js:156` sigue con su
`inv.total.toFixed(2)` dentro de `calcHash`, **sin tocar**: es entrada del hash de la cadena.

---

## 2. Los dos criterios bloqueados, con la causa medida por mí HOY

Los dos fallan por **estado de esta máquina**, no por ficheros. Ninguna de las dos causas la puede
cerrar el código de esta tarea.

### 2.1 Criterio 6 — `gate-portal-ampliado` da 19 ✓ · 9 ✗

**Ejecutado en el intento 2** (la salida completa está en §3), así que el motivo `[SIN-PRUEBAS]` del
revisor queda descargado por la primera de las tres salidas que él mismo admitía: *«o trae la
salida»*. El bloque `[1]`, donde vive la aserción que esta tarea cambió, sale **entero en verde por
navegador de verdad**, incluido `✓ su total, escrito como en España (600,00 €)`.

Los 9 ✗ son **todos** del bloque `[2]`, y son escrituras HTTP. La causa, medida por mí hoy sobre
`data/control.db`:

| negocio | estado | suspendido desde |
|---|---|---|
| `desarrollo-bamburu` | `suspended_admin` | **2026-08-25** |
| `peluqueria-gil` | `suspended_admin` | 2026-08-25 |
| `ibrahin-repuestos`, `helados-ibrahin`, `duniya`, `inversiones-disan`, `rachibra` | `suspended_admin` | 2026-07-16 |
| `x` | `active` | — |

**7 de 8 negocios están suspendidos, y desde julio y agosto** — o sea, muy anterior a esta tarea y
ajeno a ella. `core/tenant-middleware.js:113-125` (`readOnlyGuard`) devuelve **403 a todo lo que no
sea GET/HEAD/OPTIONS** de un negocio suspendido, y el bloque `[2]` escribe por el formulario del
portal y por el del negocio. De ahí los 9 ✗ y la excepción de `:159` (`hilo2[1].admin_user_id`: no
hay fila que leer porque no se guardó ninguna).

**No es residuo de un gate, y lo he mirado a propósito:** las fechas de suspensión son de julio y
agosto, y son negocios reales de Ibrahin. No se toca el estado de un negocio por cuenta propia.

Lo que arreglaría el gate es que **se trajera su propio negocio**, con `negocioDesechable`
(`scripts/lib/negocio-desechable.mjs`) — la pieza ya existe y `gate-403-permiso.mjs` la usa **por este
mismísimo motivo**, escrito en su cabecera. Pero eso es rediseñar el gate, y el **paso 18 del
análisis dice literalmente «No se toca nada más de ese gate»**. Cambiar el plano no es mío.

### 2.2 Criterio 4 — `verify-dinero-espanol` da 19 ✓ · 1 ✗

El único ✗ es la aserción agregada *«ninguna pantalla enseña una fecha en formato inglés»*, sobre
`/admin/descuentos`, con `2026-08-23 2026-09-01 2026-09-30 2027-08-23`. **Las cinco aserciones que
esta tarea añadió están las cinco en verde.**

He reconstruido la cadena entera y esto es **nuevo respecto al intento 2**, porque cambia lo que hace
falta para cerrarlo:

1. `modules/erp/routes/descuentos.js:96` mete los productos activos en el HTML:
   `SELECT id, name FROM products WHERE status='active'`.
2. `:163` los escribe dentro de un `<script>` con `JSON.stringify` **sin escapar `</`**.
3. En `desarrollo-bamburu` hay **un** producto cuyo nombre lleva un `</script>` literal:

```
id 2097 · "Prod </script><img src=x onerror=\"window.__xss=1\"> (gate 941065)"
sku GATE-941065 · status active · created_at 2026-08-25 08:24:48
```

4. Ese `</script>` **cierra el bloque antes de tiempo**, y el `textoVisible` del barrido
   (`verify-dinero-espanol.mjs:120-127`) corta con un `[\s\S]*?<\/script>` **no codicioso**: recorta
   ahí y **todo lo que viene después pasa a contar como texto visible**. Por eso salen los
   `marcador:` de `:179` (`2026-09-01`), `:180` (`2026-09-30`) y `:216` (`2027-08-23`).
5. Y la cuarta fecha, `2026-08-23`, **no está en el código**: es el `created_at` de las promociones
   `BIENVENIDA10` y `VERANO2026`, que viajan en el `PROMS = ${JSON.stringify(proms)}` de `:165` —
   también después del corte. Medido: 3 filas de `promociones` con esa fecha.

**Las cuatro fechas tienen una sola causa, y la causa es una fila.**

Y esa fila **es basura de un gate**: lleva la marca de la casa (`(gate 941065)`, `sku GATE-941065`).
Está **suelta**, comprobado uno por uno — `invoice_items`, `stock_movements`, `cita_servicios`,
`quote_items`, `purchase_items`, `customer_order_items`: **0 en las seis**. Nada legal cuelga de
ella. Es exactamente el caso de `CLAUDE.md` §«Lo que una prueba crea, la prueba lo borra», y
`scripts/limpiar-restos-de-gates.mjs` **ya la reconoce**: su `MARCA_SQL` incluye `LIKE '%(gate %'`, y
la fila casa.

**Por qué no la he borrado igualmente:** porque ese limpiador es una **escoba, no un bisturí**. En
`desarrollo-bamburu` alcanza hoy, medido:

```
clientes con marca: 15 · productos: 4 · proveedores: 30 · almacenes: 2 · recursos: 0 · paneles: 0
```

51 filas de un negocio vivo por un rojo de una fila. Eso es borrar datos de verdad, y `CLAUDE.md`
dice que ahí se para y se pregunta; el revisor además me lo prohibió con estas palabras: *«ni borres
filas del negocio vivo por tu cuenta»*.

**Y el arreglo de fondo no es borrar nada:** es escapar `</` en `descuentos.js:163`, porque mientras
eso siga así cualquiera puede volver a teclear `</script>` en el nombre de un producto y tirar la
pantalla. Ese fichero es el **séptimo**, y el criterio 8 lo prohíbe.

---

## 3. La salida del gate de navegador (intento 2), y cómo se repite

`scripts/gate-portal-ampliado.mjs` — **19 ✓ · 9 ✗ · código 1**.

```
[0] LO PRIMERO: un enlace ajeno, caducado o revocado no abre NADA
  ✓ un token inventado da 403 y no enseña nada · got 403
  ✓ el token de OTRO cliente no enseña mis facturas
  ✓ un token caducado da 403
  ✓ un token revocado da 403

[1] G1 — las analíticas del propio cliente, contrastadas a mano
  ✓ cuenta sus 3 compras · 3
  ✓   y suma sus 600 € de base · 600 €
  ✓   media de 200 € por compra · 200 €
  ✓   y su ritmo sale de la MEDIANA de días entre compras · 31 días
  ✓   «lo que más compras» ordenado por importe · ["Reparación","Mantenimiento mensual"]
  ✓ una factura ANULADA no le infla el histórico · 3 compras · 600 €
  ✓ el portal enseña el bloque de analíticas
  ✓   con sus compras · 3 compras
  ✓   su total, escrito como en España (600,00 €)     ← LA ASERCIÓN DE ESTA TAREA
  ✓   y su ritmo
  ✓   y qué compra
  ✓   y ni rastro de la factura anulada

[2] G2 — el canal de comunicaciones, PULSANDO de los dos lados
  ✓ el portal tiene el bloque para escribir
  ✗ el cliente escribe y se guarda · ""
  ✗   y el portal le DICE que salió (nada de un silencio)
  ✗   y su mensaje aparece en el hilo
  ✗ un mensaje en blanco se rechaza y se dice por qué
  ✗   y no se guarda
  ✗ al negocio le consta 1 mensaje sin leer · []
  ✗ y la pantalla del portal lo avisa
  ✓ el negocio lee el mensaje del cliente
  ✓   y al abrirlo deja de constar sin leer
  ✗ el negocio contesta y se guarda · 0 mensajes

✗ EXCEPCIÓN: Cannot read properties of undefined (reading 'admin_user_id')
    at scripts/gate-portal-ampliado.mjs:159:15

RESULTADO: 19 ✓  ·  9 ✗          (código de salida 1)
```

Y `verify-dinero-espanol.mjs` — **19 ✓ · 1 ✗ · 356 pantallas · código 1**:

```
✓ el portal del cliente responde 200 · status 200
✓ el portal medido TENÍA importes que mirar · 84.814,95 € · 121,00 € · 12.100,00 €
✓ el portal del cliente escribe el dinero como en España · 10 importes, todos bien
✓ el portal del cliente no enseña ninguna fecha en formato inglés · ninguna
✓   y la marca de tiempo del mensaje sale con su fecha en cristiano
✓   y el separador de miles no se pierde con cuatro cifras · 6.023,00 €
✗ ninguna pantalla enseña una fecha en formato inglés
    /admin/descuentos: 2026-08-23 2026-09-01 2026-09-30 2027-08-23
```

### La receta del navegador — y esto vale para más que esta tarea

El rechazo del intento 1 y mi propio informe anterior daban por medido que **esta máquina no puede
abrir un navegador**. **Es falso**, y por eso el gate de arriba tiene salida. La medida era cierta y
la conclusión no: `NoNewPrivs: 1` bloquea `snap-confine`, que es **el envoltorio**, no el navegador; y
los Chrome de `~/.cache/puppeteer` son `x86-64` en una máquina `aarch64` — pero **hay un tercero**,
`/snap/chromium/current/usr/lib/chromium-browser/chrome`, que es ELF **aarch64** y se ejecuta directo,
sin pasar por `snap-confine`.

```sh
mkdir -p /tmp/fakehome/snap/chromium/common /tmp/fakehome/snap/chromium/current
export LD_LIBRARY_PATH=/snap/chromium/current/usr/lib/aarch64-linux-gnu:\
/snap/chromium/current/usr/lib/chromium-browser:\
/snap/gnome-46-2404/current/usr/lib/aarch64-linux-gnu:\
/snap/mesa-2404/current/usr/lib/aarch64-linux-gnu:\
/snap/core24/current/usr/lib/aarch64-linux-gnu
export HOME=/tmp/fakehome SNAP=/snap/chromium/current SNAP_NAME=chromium \
       SNAP_INSTANCE_NAME=chromium SNAP_REAL_HOME=/home/ubuntu \
       SNAP_USER_COMMON=/tmp/fakehome/snap/chromium/common \
       SNAP_USER_DATA=/tmp/fakehome/snap/chromium/current
export PUPPETEER_EXECUTABLE_PATH=/snap/chromium/current/usr/lib/chromium-browser/chrome
node scripts/gate-portal-ampliado.mjs
```

No hace falta tocar ningún fichero para usarla: el enganche ya existe en
`scripts/lib/gate-env.mjs:66` (`process.env.PUPPETEER_EXECUTABLE_PATH || '/snap/bin/chromium'`).
**Su sitio natural en el repo —`gate-env.mjs`, `deploy/systemd/README.md`, el §`ENTORNO` de
`run-gates.mjs`— está fuera de los seis ficheros del criterio 8**, así que no la he escrito allí.
Mientras no se escriba, el siguiente chat volverá a leer «esta máquina no puede abrir un navegador» y
volverá a ser mentira: ya ha pasado dos veces (`pantalla-403-ventanita` intento 1 y esta).

---

## 4. Los ocho criterios

| # | Criterio | Veredicto |
|---|---|---|
| 1 | `toFixed` a 0, importa `fmtEur`, ningún formateador propio | ✅ verificado hoy |
| 2 | El portal escribe `60.493,95 €`, sin símbolo delante ni punto decimal | ✅ |
| 3 | Las tres tarjetas, «Por año» y el subtítulo, todos en ese formato | ✅ |
| 4 | `verify-dinero-espanol` con **0 ✗ y código 0** | ❌ **19 ✓ · 1 ✗.** Causa medida: una fila de basura de gate + un escape que falta en un séptimo fichero |
| 5 | Marca de tiempo `dd/mm/aaaa hh:mm`, dígitos idénticos | ✅ verificado hoy |
| 6 | `gate-portal-ampliado` con **0 ✗** y su aserción exigiendo `600,00 €` | ⚠️ **ejecutado**: 19 ✓ · 9 ✗. Segunda mitad ✅. Los 9 ✗ son `readOnlyGuard` sobre 7 negocios suspendidos desde julio |
| 7 | Sin residuo y `verifyTenantInvoices` ok | ✅ verificado hoy: 0 · 0 · 0 · `{919, ok:true}` |
| 8 | El diff toca exactamente los seis ficheros | ✅ verificado hoy |

---

## 5. Lo que hace falta para cerrarlo — y es UNA decisión, no más código

No hay ni una línea de código pendiente **dentro de los seis ficheros**. Todo lo que queda toca algo
que el análisis o el revisor pusieron fuera de mi alcance.

### Criterio 4 — tres opciones, y la tercera es nueva

| | Qué | Qué cuesta |
|---|---|---|
| **A** | **Barrer la basura de gate**: `node scripts/limpiar-restos-de-gates.mjs --hazlo --tenant=desarrollo-bamburu` | **Cero ficheros del repo — el criterio 8 no se mueve.** Pero borra **51 filas** de un negocio vivo, no solo la que estorba. Es la más barata y la que menos deja escrito |
| **B** | Declarar el rojo en `ROJOS_CONOCIDOS` (`scripts/run-gates.mjs:123`, **hoy vacío**, comprobado) con su fecha y su motivo, y reescribir el criterio 4 como «0 ✗ salvo el rojo declarado» | Un **séptimo fichero**. Hay que ampliar el alcance por escrito |
| **C** | Cerrar la causa de raíz: escapar `</` en `descuentos.js:163` | **Otra tarea con su encargo** — ya está abierta en el TABLERO desde `pantalla-403-ventanita`. Es el único arreglo que impide que vuelva |

Mi recomendación, y la digo aunque no sea mía la decisión: **C es el arreglo bueno y A no lo es.**
Borrar la fila apaga el rojo pero deja la pantalla igual de rompible; mañana alguien teclea
`</script>` en el nombre de un producto y `/admin/descuentos` se vuelve a partir. Si hace falta el
verde ya, **A o B** con C abierta detrás.

### Criterio 6 — tres opciones

| | Qué | Qué cuesta |
|---|---|---|
| **A** | Darlo por cumplido en lo que esta tarea podía tocar: bloques `[0]` y `[1]` en verde por navegador, la aserción cambiada demostrada, y los 9 ✗ de `[2]` declarados como ajenos | Reescribir el criterio. Cero código |
| **B** | Levantar `desarrollo-bamburu` de `suspended_admin` | **Toca el estado de un negocio.** No lo hago sin que se me diga |
| **C** | Que el gate se traiga su propio negocio con `negocioDesechable`, como ya hace `gate-403-permiso.mjs` por esta misma causa | Contradice el paso 18 del análisis. Cambio de plano: es del arquitecto |

### Y una que sale de aquí pero no es de aquí

**Dónde vive la receta del navegador (§3).** Los tres sitios naturales están fuera del criterio 8.
Alcanza a todos los gates de navegador del repo, no solo a este.

---

## 6. Qué NO he hecho, a propósito

- **No he commiteado nada.** No hay cambio de código que hacer dentro de los seis ficheros, y
  commitear este documento metería un **séptimo** fichero en el diff y rompería el criterio 8 —
  que hoy está en SÍ. La entrega vigente sigue siendo `bfea8a8` + `d93125e`, y las dos llevan
  `Tarea: portal-formato-dinero` en el mensaje.
- **No he vuelto a lanzar ningún barrido ni ningún gate.** Los dos se corrieron una vez en el
  intento 2 y sus rojos están explicados, no son intermitentes. `CLAUDE.md`: *«una comprobación
  pedida una vez se ejecuta UNA vez»*.
- **No he aflojado `verify-dinero-espanol.mjs`** para que el ✗ desapareciera. Era el único atajo que
  cabía en los seis ficheros y es justo el que el §5.2 del análisis prohíbe.
- **No he tocado `descuentos.js`, `run-gates.mjs` ni `gate-env.mjs`** (séptimos ficheros), **ni el
  estado de ningún negocio**, **ni he borrado una sola fila** de `desarrollo-bamburu`.
- **No he rehecho lo que el revisor dio por bueno**, ni sus tres observaciones que no bloquean —
  entre ellas el `tokP` declarado fuera del `try`, que sigue como estaba.
