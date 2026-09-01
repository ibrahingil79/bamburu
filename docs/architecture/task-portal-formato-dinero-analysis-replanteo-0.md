# `portal-formato-dinero` — El portal del cliente escribe el dinero a la inglesa

- **taskId:** `portal-formato-dinero`
- **origen:** `TABLERO.md:1833` (cabo menor apuntado el 23 ago 2026) → `TABLERO.md:8207` (formato de orquestador, 31 ago 2026)
- **intento:** 1 (no es un replanteamiento)
- **veredicto del arquitecto:** la tarea está bien planteada. Se construye.

> **Nada de este análisis se ha ejecutado.** Ni un gate, ni un barrido, ni el servidor. `RITUAL.md`
> manda: ninguna comprobación se lanza por iniciativa propia. Todo lo que se afirma aquí está
> **leído del código y del esquema** (y de tres `SELECT` de solo lectura sobre las BD de los
> tenants, que se citan con su medida). Lo que hay que **correr** está en §6 y necesita
> autorización expresa de Ibrahin en el encargo del constructor.

---

## 1. Qué está mal hoy

### 1.1 Los siete sitios exactos

Todo el defecto vive en **un solo fichero**: `modules/portal/index.js`. Son **7 llamadas a
`toFixed(2)`** con el símbolo pegado delante, y **son las 7 que hay en todo el módulo**
(`modules/portal/admin.js` y `modules/portal/portal.js` tienen cero):

| # | Línea | Lo que hay escrito | Lo que sale en pantalla |
|---|---|---|---|
| 1 | `modules/portal/index.js:54` | `${escHtml(r.currency_symbol)}${Number(r.total).toFixed(2)}` | `€60493.95` — columna «Total» de cada factura |
| 2 | `modules/portal/index.js:55` | `' · ' + r.currency_symbol + r.pendiente.toFixed(2)` | `Pendiente · €1210.00` — la píldora de estado |
| 3 | `modules/portal/index.js:72` | `${escHtml(A.sym)}${A.total.toFixed(2)}` | `€6023.00` — «en total (sin IVA)» |
| 4 | `modules/portal/index.js:73` | `${escHtml(A.sym)}${A.media.toFixed(2)}` | `€1505.75` — «de media por compra» |
| 5 | `modules/portal/index.js:80` | `${escHtml(A.sym)}${Number(l.importe).toFixed(2)}` | `€2400.00` — «Lo que más compras» |
| 6 | `modules/portal/index.js:83` | `${escHtml(A.sym)}${x.importe.toFixed(2)}` | `€3011.50` — la tabla «Por año» |
| 7 | `modules/portal/index.js:106` | `${escHtml(rows[0]?.currency_symbol \|\| '€')}${totalPendiente.toFixed(2)}` | `Pendiente total: €1210.00` — el subtítulo |

Los tres defectos son los mismos en las siete: **símbolo delante**, **punto decimal** y **sin
separador de miles**.

De paso, dos asimetrías reales dentro de esa misma lista: la línea 55 interpola
`r.currency_symbol` **sin `escHtml`** mientras la 54, tres caracteres antes, sí lo escapa; y la 106
lleva su propio `|| '€'` a mano en vez del que ya trae el motor. Son consecuencia de haber escrito
el formato siete veces: siete copias divergen, una función no.

### 1.2 Y una fecha inglesa en la misma pantalla

`modules/portal/index.js:98` pinta la marca de tiempo de cada mensaje del chat así:

```js
${escHtml(String(m.created_at || '').slice(0, 16))}     // → «2026-08-24 14:30»
```

`modules/portal/admin.js:63` hace exactamente lo mismo del lado del negocio. **No es dinero**, pero
es la misma enfermedad en la misma plantilla, y —esto es lo que importa para el plan— es la
**segunda regla que mide el mismo instrumento** que hay que ampliar (§1.5). Se trata en el paso 3
del plan, marcado como separable.

### 1.3 Lo que el mismo cliente recibe dos centímetros más abajo, bien escrito

El portal ofrece el PDF de cada factura en `modules/portal/index.js:130-144`, que llama a
`buildInvoicePaper` (`modules/erp/routes/invoices.js:588`). Ese papel **ya escribe el dinero en
español**: usa `dineroEs` (= `fmtEur`) en las líneas `607`, `608`, `659`, `660`, `663`, `666`,
`668`, `671`, `674` y `677`.

O sea: **la misma factura, para el mismo cliente, en la misma sesión**, dice `€60493.95` en la
tabla y `60.493,95 €` en el PDF que se descarga desde esa tabla. No es una inconsistencia de
estilo entre pantallas lejanas: es la misma cifra escrita de dos formas a un centímetro de
distancia.

### 1.4 El formateador único ya existe, y el portal no lo usa

`modules/erp/margen.js:161`:

```js
const NUM = (n, d) => Number(n).toLocaleString('es-ES',
  { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });

export function fmtEur(n, sym = '€') {
  if (n == null) return '—';
  return NUM(n, 2) + ' ' + sym;
}
```

`useGrouping:'always'` está ahí a propósito y con su motivo escrito (`margen.js:143-145`): el
`es-ES` por defecto **deja los números de cuatro cifras sin punto de millar**, y eso descuadra una
columna. Es exactamente el caso del titular de esta tarea: `6023` → `6.023,00 €`, no `6023,00 €`.

El portal **ya importa de `modules/erp/`**: `layout.js` (línea 6), `routes/invoices.js` (7) y
`voz.js` (10). Y `voz.js` a su vez importa `fmtEur` de `margen.js` en su línea 1 — así que
`margen.js` **ya está en el grafo de módulos del portal**. Añadir el `import` no crea ningún ciclo
nuevo: comprobado, `modules/erp/margen.js` **no tiene ni un `import`**.

### 1.5 Por qué nadie lo cazó — y esto es la mitad de la tarea

Existe una comprobación dedicada exactamente a esta regla:
**`scripts/verify-dinero-espanol.mjs`**. Está en el barrido, y además en el **rápido**
(`scripts/lib/gates-mapa.mjs:51`: *«el dinero y las fechas, en pantalla y en papel»*). Mide sobre
lo **servido**, no sobre el código, y prohíbe las tres formas del defecto
(`verify-dinero-espanol.mjs:49-58`).

Nunca ha mirado el portal, **y no puede**. Su lista de rutas se construye así:

- `verify-dinero-espanol.mjs:71` — `const meter = h => { if (h && h.startsWith('/admin') …`
- `:74` — semilla: `MENU`, `CONFIG_NEGOCIO`, `FIJAS`, `CUENTA` de `modules/erp/menu.js`
- `:108` — el rastreo: `html.matchAll(/href="(\/admin[^"#?]*)"/g)`

Todo lo que no empiece por `/admin` está fuera por construcción. Y el portal:

1. **vive en `/portal/<token>`** (`modules/portal/index.js:45`), no bajo `/admin`;
2. **no cuelga de ningún enlace**: la pantalla `/admin/portal` manda el enlace **por correo**
   (`admin.js:98-108`), no lo pinta;
3. **no tiene sesión**: se entra con un token en la URL, así que la cookie `asess` que usa la
   comprobación no abre nada.

No es que la comprobación fallara. Es que **el portal está fuera de su alcance**, y por eso el
defecto lleva desde antes del 23 de agosto en producción con una comprobación verde encima. Es la
misma lección que este repo ya pagó dos veces y tiene escrita en `CLAUDE.md`: *«recorrer todas las
pantallas y recorrer todo el menú no es lo mismo»* y *«una lista a mano de rutas siempre se queda
corta»*. El rastreo por enlaces se añadió justo para arreglar eso — y sigue sin alcanzar la única
pantalla del producto a la que no lleva ningún enlace.

**Y hay una segunda ceguera, esta con nombre y línea.** El gate que sí abre el portal,
`scripts/gate-portal-ampliado.mjs`, tenía la aserción delante y la escribió lo bastante floja como
para no verla:

```js
:113   ok(/600[.,]00/.test(vista), '  su total');
```

`[.,]` acepta **las dos formas**. Ese gate se corrió, dio 35 ✓ · 0 ✗, y pasó por encima de
`€600.00` sin inmutarse. Un verde cierto sobre lo que medía, y lo que medía era «que salga el
número», no «que esté bien escrito».

### 1.6 Que esto se ve con datos reales, no en teoría

Medido con `SELECT` de solo lectura sobre `data/tenants/desarrollo-bamburu.db`: **919 facturas,
202 clientes**, y el cliente `id=1` tiene 4 facturas con un máximo de **60.493,95 €**. Con el
código de hoy, su portal escribe `€60493.95` — cinco cifras enteras sin un solo separador.

Y sobre las nueve BD de tenants: **las 922 facturas del sistema tienen `currency_symbol = '€'`**.
No hay ni un caso de otra moneda. Importa para §5.

---

## 2. Cómo lo resuelven los que ya lo resolvieron

### Salesforce — el formato es propiedad del TIPO, y el portal público no hereda nada

En Salesforce el dinero no es un número que cada pantalla decide cómo pintar: es un **tipo de
campo** (Currency), y el formateo ocurre en el borde de renderizado, no en el código de negocio —
`<apex:outputField>`, `lightning-formatted-number` con `format-style="currency"`. Un desarrollador
que escribe la cifra a mano se sale del carril y lo nota enseguida, porque el carril existe y es
único.

Lo que se trae, y es lo importante: **su superficie sin sesión es donde esto se rompe**.
Experience Cloud (el portal de cliente, el análogo exacto del `/portal/<token>` de Bamburu) sirve
a un *guest user*, y el fallo clásico documentado es que ese usuario invitado **no hereda** la
configuración regional que sí tiene la aplicación autenticada: hay que dárasela explícitamente al
perfil invitado. Es la misma forma de avería que aquí — **la pantalla sin sesión se cae del carril
del resto del producto** —, solo que allí se cae de la configuración y aquí se cayó del
formateador y del instrumento que lo vigila.

Lo que **no** se trae: Salesforce deriva el formato del **locale del que mira**. Bamburu no puede
y no debe. El mismo cliente se descarga el PDF —español, `fmtEur`— y lee la tabla; si la tabla
siguiera al `Accept-Language` del navegador, la misma cifra tendría dos formas para la misma
persona en la misma pantalla. La regla de Bamburu es **una sola forma en todo el producto**, y ya
está escrita en `scripts/verify-dinero-espanol.mjs:5`.

### Odoo — el portal de cliente usa el MISMO renderizador que el backend, y su fallo típico es este exacto

Odoo modela la moneda en `res.currency` (`symbol`, `position` `before`/`after`, `decimal_places`) y
los separadores en `res.lang` (`decimal_point`, `thousands_sep`, `grouping`). En las plantillas
QWeb el dinero se pinta con `t-field … widget="monetary"`, que baja a `format_amount`/`formatLang`.

Lo relevante: **su portal de cliente (`/my/invoices`) usa esas mismas plantillas QWeb monetarias
que el backend.** No hay un segundo camino de renderizado para la parte pública. Y su modo de
fallo conocido es exactamente el que tenemos delante: en cuanto alguien escribe `"%.2f" % amount`
en una plantilla en vez de pasar por `format_amount`, la cifra sale en inglés pase lo que pase con
el idioma. `modules/portal/index.js:54` **es literalmente eso**, con `toFixed(2)` en lugar de
`%.2f`. Odoo no lo resuelve con una regla nueva: lo resuelve porque la única forma cómoda de
escribir dinero en una plantilla es la buena.

Lo que **no** se trae: el modelo de datos. `position`, `decimal_point` y `grouping` por moneda y
por idioma son una tabla de i18n completa. Bamburu es de locale único por decisión de producto
(CANON: cumplimiento legal de **España**), `fmtEur` ya fija «importe, espacio, símbolo» para todo
el producto, y —medido— **las 922 facturas del sistema son en euros**. Una columna `position` sería
un mando con un solo valor legal que nadie tocaría nunca.

### SAP — separar el dato guardado del dato escrito, y que los decimales los mande la moneda

En SAP los importes son campos `CURR` atados a una clave de moneda `CUKY`; los separadores salen
de la notación decimal del usuario (`USR01-DCPFM`) al escribir (`WRITE … CURRENCY`), y el número de
decimales sale de la moneda (`TCURX`), no de la pantalla — por eso el yen no lleva decimales y el
código que fija «2» a mano es una clase de bug con nombre propio allí.

Lo que se trae, y Bamburu **ya lo hace bien**: la separación absoluta entre lo guardado y lo
escrito. `clientInvoices` (`modules/portal/portal.js:145-160`) y `analiticaCliente` (`:59-102`)
devuelven **números**, no cadenas; el formato ocurre solo al pintar. Eso es lo que hace que este
arreglo sea de una capa y de un fichero, y hay que conservarlo tal cual (§3.2).

Lo que **no** se trae: `DCPFM` es otra vez «el formato lo decide quien mira», ya rechazado arriba.
Y `TCURX` señala una limitación real de `fmtEur` —**fija 2 decimales para toda moneda**— que aquí
no se toca: no hay ninguna factura en el sistema que no sea en euros, cambiarlo tocaría las 40+
pantallas que llaman a `fmtEur`, y sería una tarea distinta con su propio riesgo.

---

## 3. La decisión

### 3.1 Qué se hace

Cuatro cosas, en este orden de importancia:

1. Las **7 llamadas** de `modules/portal/index.js` pasan por **`fmtEur`**, el formateador que ya
   existe. **No nace un segundo formateador**, ni en el servidor ni en el navegador.
   Esto cumple el matiz que el TABLERO marca como innegociable (`TABLERO.md:8216-8219`): **las
   siete de una vez**, no solo las del bloque G1 (`:72`, `:73`, `:80`, `:83`), porque dejar la tabla
   de facturas (`:54`, `:55`) y el subtítulo (`:106`) en inglés pondría **dos formatos en la misma
   pantalla**, que es peor que el defecto de hoy.
2. **`scripts/verify-dinero-espanol.mjs` aprende a llegar al portal.** Es la mitad que impide que
   vuelva: sin esto, mañana alguien escribe el octavo `toFixed` y el barrido sigue verde.
3. Las **2 marcas de tiempo ISO** (`index.js:98`, `admin.js:63`) pasan a `24/08/2026 14:30`.
   **Paso separable** — ver §3.5.
4. Se **aprieta** la aserción floja de `gate-portal-ampliado.mjs:113`, que tenía el defecto delante
   y lo dejó pasar.

### 3.2 En qué capa vive

En la **capa de vista del módulo `portal`** — `modules/portal/index.js`, y nada más.

**`modules/portal/portal.js` no se toca.** El motor sigue devolviendo números
(`total`, `pendiente`, `totalPendiente`, `A.total`, `A.media`, `l.importe`, `x.importe`) y el
formato se aplica donde se pinta. No es una preferencia: `modules/portal/index.js:55` **hace
aritmética** con esos valores (`r.pendiente < r.total`) mientras los pinta. Si el motor devolviera
texto ya formateado, esa comparación se rompería en silencio y la píldora «Pendiente · …» dejaría
de aparecer cuando toca.

No hay migración, no hay columna nueva, no hay tabla nueva, no hay cambio de API.

### 3.3 Qué patrón del propio código se sigue

El del alias local atado al símbolo de la pantalla, que ya está escrito tres veces en Bamburu:

- `modules/erp/routes/contabilidad-routes.js:33` → `const money = (sym, n) => fmtEur(Number(n || 0), sym);`
  (con el comentario *«Una sola forma en todo el producto: fmtEur»*)
- `modules/erp/avisos.js:432` → `const dinero = n => fmtEur(Number(n || 0), sym);`
- `modules/erp/routes/rentabilidad.js:34` → idéntico

Y para la fecha, el patrón es `fechaEs` de `modules/erp/voz.js:45`, que el portal **ya importa**
(`index.js:10`). La versión con hora se escribe **al lado**, en el mismo fichero, siguiendo su
misma regla escrita: *«se formatea lo que llega, no se recalcula ni se reinterpreta»*
(`voz.js:43-44`).

### 3.4 Por qué se amplía el instrumento que existe en vez de escribir uno nuevo

Una regla, un instrumento. `verify-dinero-espanol.mjs` **es** el instrumento de esta regla, está en
el rápido y en el completo, y su único defecto es no alcanzar una pantalla. Un
`gate-portal-dinero.mjs` nuevo sería una segunda lista de rutas que mantener a mano y que se
quedará corta igual —la lección de `CLAUDE.md` es literalmente esa—, y partiría en dos la respuesta
a «¿el producto escribe el dinero en español?».

**El portal se mide con `fetch`, sin navegador, y a propósito:** su `shell()`
(`modules/portal/index.js:12-37`) no sirve **ni un `<script>`** — es una decisión de producto
registrada en `TABLERO.md` §G2 y repetida en el comentario de `index.js:114` (*«el portal no lleva
JavaScript y no se le va a meter uno solo para esto»*). Lo servido **es** lo que lee la persona, y
la regla de `CLAUDE.md` sobre juzgar el HTML tal y como sale del servidor se cumple sin trampa. Eso
tiene que quedar escrito en el propio código, porque **el día que el portal lleve JS, esta medición
deja de bastar**.

### 3.5 El paso 3 (las fechas) es separable, y por qué se propone incluirlo

El encargo dice «dinero». La fecha ISO no es dinero. Se propone incluirla por un motivo concreto,
no por afán de limpieza: **`verify-dinero-espanol.mjs` mide las dos reglas en la misma pasada**
(dinero en `:154`, fechas en `:162`). Meter el portal en él y dejarle dentro una fecha inglesa
obliga a enseñarle a **mirar hacia otro lado en esa ruta** — que es exactamente la avería que
estamos arreglando, replantada en sitio nuevo. Y `/admin/portal/mensajes/<id>` **ya lo visita hoy**
(sale del rastreo de enlaces desde `/admin/portal`): hoy pasa solo porque el tenant de desarrollo
tiene **0 filas en `portal_mensajes`** (medido) y la pantalla no tiene ninguna fecha que enseñar.
Es un verde por ausencia de datos, y se vuelve rojo el día que un cliente escriba.

**Aviso que va con el paso 3 y no se puede perder:** `created_at` es `CURRENT_TIMESTAMP`, o sea
**UTC**, y el lector está en Europe/Madrid. La hora que se muestra **ya está desfasada 1-2 h hoy**,
y este cambio **no lo arregla**: reordena los dígitos, no los toca. Es un defecto distinto, anterior
y de alcance mucho mayor (todo `created_at` del producto), y convertirlo en `24/08/2026 14:30` lo
deja *más creíble sin ser más cierto*. Por eso: (a) va escrito en el comentario del código, (b) va
al TABLERO como hallazgo medido, y (c) el criterio 5 de §6 exige que los dígitos de la hora sean
**idénticos** a los guardados, para que quede demostrado que aquí no se ha hecho ninguna cuenta.

Si Ibrahin prefiere alcance estricto, **se cae el paso 3 del plan y su criterio 5**, y el resto se
sostiene entero: el paso 4 se implementa entonces midiendo solo la regla del dinero en `/portal`, y
la fecha del portal va al TABLERO como cabo con su línea.

### 3.6 Alternativas descartadas

1. **Un ayudante propio del portal** (`const eur = n => …` escrito allí). Descartada: es la
   enfermedad que se curó el 24 ago, cuando había **quince** formateadores repartidos. Tan
   descartada que `verify-dinero-espanol.mjs:189` lleva un regex que **caza justo esa forma**
   (`… sym + Number(…).toFixed(2)`) y falla si aparece.
2. **Formatear en el navegador con `window.eur`** (`modules/erp/layout.js:563`). Descartada dos
   veces: rompe la decisión de que el portal no lleve JavaScript, y —peor— **esconde el dinero
   detrás de JS**, donde `verify-dinero-espanol` (que lee lo servido) no puede verlo. Sería cambiar
   un defecto visible por un punto ciego. Ese punto ciego ya existe en otra pantalla y está
   apuntado como hallazgo en §5.7.
3. **Que el motor devuelva texto ya formateado** (`totalTxt`, al estilo de `desgloseDe` en
   `margen.js:176`). No es ajeno al código, pero se descarta: `index.js:55` compara `pendiente` con
   `total` mientras pinta, y además haría que el motor del portal cargara con la presentación de
   una sola pantalla.
4. **Un gate nuevo `gate-portal-dinero.mjs`.** Descartada: §3.4.
5. **Formato según el `Accept-Language` del que mira** (lo que hacen Salesforce y SAP).
   Descartada: §2, primer apartado.
6. **Barrer `toFixed(2)` de todo el producto con un `sed`.** Descartada y **prohibida**: hay
   `toFixed(2)` que no son pantalla y romperlos sí es un fallo — el más grave,
   `modules/erp/routes/invoices.js:156`, que es **entrada del hash de la cadena**. Ver §5.1.

---

## 4. El plan, paso a paso

> **Nada de esto ejecuta una comprobación.** Los pasos 1-6 son código y documentación. Lo que hay
> que **correr** está en §6 y **solo se ejecuta si el encargo del constructor lo autoriza
> expresamente y de forma visible** (`RITUAL.md` / `CLAUDE.md` §BARRIDOS). Una autorización vale
> para una ejecución.

### Paso 1 — `modules/erp/voz.js`: la hora, en cristiano *(solo si se hace el paso 3)*

1. Justo después de `fechaEs` (termina en la línea 48), añadir su gemela, con el comentario que
   deja escrito lo que **no** hace:

```js
// Y UNA MARCA DE TIEMPO ENTERA. `2026-08-24 14:30` es como se guarda; en pantalla va
// `24/08/2026 14:30`. IGUAL QUE `fechaEs`: SOLO REORDENA. No convierte zona horaria, no suma, no
// resta — el número que sale es EXACTAMENTE el que entró.
// ⚠️ OJO, Y ESTO ES DEUDA CONOCIDA, NO UN DESCUIDO: `created_at` se guarda con CURRENT_TIMESTAMP,
// que es UTC, y quien lo lee está en Europe/Madrid. La hora que se enseña YA venía desfasada 1-2 h
// y esta función NO lo arregla: solo deja de escribirla en inglés. Apuntado en TABLERO.md.
export function fechaHoraEs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(iso || ''));
  if (m) return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5];
  return fechaEs(iso);          // solo fecha, o lo que llegue: se devuelve tal cual, no se inventa
}
```

**No se toca `fechaEs`.** Lo importan diez ficheros (`avisos.js`, `vigia.js`, `contabilidad.js`,
`cuadro-mando.js`, `citas-avisos.js`, cuatro rutas y el propio portal) y no hay motivo para
moverlo.

### Paso 2 — `modules/portal/index.js`: el dinero *(el arreglo)*

2. Añadir el import, junto al de `voz.js` (línea 10):

```js
import { fmtEur } from '../erp/margen.js';   // el dinero, como en España: 6.023,00 €
```

   Sin ciclo: `margen.js` no tiene ni un `import`, y `voz.js` —que el portal ya importa— ya lo
   carga.

3. Añadir el alias **una sola vez**, entre `denied` (línea 39-40) y `export function register`
   (línea 42):

```js
// El dinero, como en el resto del producto: `6.023,00 €` — miles con punto, decimales con coma, y
// el símbolo DETRÁS y separado. NO nace aquí un formateador: se usa el único que hay
// (`fmtEur`, modules/erp/margen.js:161), igual que `money` en contabilidad-routes.js:33 y `dinero`
// en avisos.js:432. Antes esto se escribía a mano SIETE veces y salía `€6023.00`.
// Se escapa el resultado porque el símbolo sale de la BD (`invoices.currency_symbol`): `fmtEur`
// compone TEXTO, no HTML, y escaparlo aquí quita la asimetría que había entre las líneas 54 y 55.
const dinero = (n, sym) => escHtml(fmtEur(Number(n || 0), sym || '€'));
```

4. Sustituir las siete, una por una (izquierda: lo que hay hoy; derecha: lo que queda):

   | # | Línea | Antes | Después |
   |---|---|---|---|
   | 1 | 54 | `${escHtml(r.currency_symbol)}${Number(r.total).toFixed(2)}` | `${dinero(r.total, r.currency_symbol)}` |
   | 2 | 55 | `' · ' + r.currency_symbol + r.pendiente.toFixed(2)` | `' · ' + dinero(r.pendiente, r.currency_symbol)` |
   | 3 | 72 | `${escHtml(A.sym)}${A.total.toFixed(2)}` | `${dinero(A.total, A.sym)}` |
   | 4 | 73 | `${escHtml(A.sym)}${A.media.toFixed(2)}` | `${dinero(A.media, A.sym)}` |
   | 5 | 80 | `${escHtml(A.sym)}${Number(l.importe).toFixed(2)}` | `${dinero(l.importe, A.sym)}` |
   | 6 | 83 | `${escHtml(A.sym)}${x.importe.toFixed(2)}` | `${dinero(x.importe, A.sym)}` |
   | 7 | 106 | `${escHtml(rows[0]?.currency_symbol \|\| '€')}${totalPendiente.toFixed(2)}` | `${dinero(totalPendiente, rows[0]?.currency_symbol)}` |

   En la 7 desaparece el `|| '€'` a mano: ya lo hace el alias.

5. Comprobación de que no queda ninguna: `grep -c toFixed modules/portal/index.js` tiene que dar
   **0** (hoy da 7). `modules/portal/admin.js` y `modules/portal/portal.js` dan 0 desde antes y
   siguen a 0.

### Paso 3 — las dos marcas de tiempo *(separable; ver §3.5)*

6. `modules/portal/index.js:10` — ampliar el import:
   `import { fechaEs, fechaHoraEs } from '../erp/voz.js';`

7. `modules/portal/index.js:98` — sustituir
   `${escHtml(String(m.created_at || '').slice(0, 16))}`
   por `${escHtml(fechaHoraEs(m.created_at))}`.

8. `modules/portal/admin.js` — añadir `import { fechaHoraEs } from '../erp/voz.js';` (el fichero
   hoy no importa de `voz.js`) y sustituir en la línea 63
   `${escHtml(String(m.created_at || '').slice(0, 16))}`
   por `${escHtml(fechaHoraEs(m.created_at))}`.

### Paso 4 — `scripts/verify-dinero-espanol.mjs`: que el instrumento llegue al portal

9. **Dónde va:** dentro del `try` que abre en la línea 131, **después** del bucle de pantallas
   `/admin` (termina en `:152`) y **antes** del bloque «LOS CORREOS Y LA VOZ DE DISA» (`:166`). La
   limpieza va en el **`finally` que ya existe** (`:235-238`), no en uno nuevo.

10. **Elegir el cliente, sin depender de datos ajenos y sin pisar a otro gate.** Se toma el cliente
    con la factura más alta que **no** sea de otro gate (las marcas de la casa: `GG-`, `GATE `,
    `ZZ `), porque una factura grande es la que demuestra el separador de miles:

```js
const cliPortal = db.prepare(
  `SELECT i.client_id AS id, MAX(i.total) AS mx
     FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE i.status != 'anulada'
      AND c.name NOT LIKE 'GG-%' AND c.name NOT LIKE 'GATE %' AND c.name NOT LIKE 'ZZ %'
    GROUP BY i.client_id ORDER BY mx DESC LIMIT 1`).get();
```

11. **Sembrar lo mínimo, con marca de la casa y sufijo por pasada.** Solo dos filas, y **ninguna
    toca `invoices`**:

```js
const MARCA_P = 'ZZ dinero portal';                       // el PREFIJO por el que se borra
const rid     = randomBytes(3).toString('hex');           // el sufijo de ESTA pasada
const tokP    = 'zz-dinero-portal-' + randomBytes(24).toString('hex');
// Lo que ya estaba sin ver, para devolverlo como estaba: abrir el portal marca como visto
// (modules/portal/index.js:89 → marcarVisto). El gate no puede cambiarle el contador al negocio.
const noVistos = db.prepare('SELECT id FROM portal_mensajes WHERE client_id=? AND visto_cliente=0')
                   .all(cliPortal.id).map(r => r.id);
db.prepare('INSERT INTO portal_tokens (client_id, token, expires_at) VALUES (?,?,?)')
  .run(cliPortal.id, tokP, ahora + 900);                  // 15 min, como la sesión de arriba
db.prepare(`INSERT INTO portal_mensajes (client_id, autor, texto, visto_negocio, visto_cliente)
            VALUES (?, 'negocio', ?, 1, 0)`)
  .run(cliPortal.id, MARCA_P + ' ' + rid + ' — comprobación de formato');
```

    El mensaje se siembra **para que haya una marca de tiempo en pantalla que mirar**. Si se hace
    solo el alcance estricto (sin el paso 3), esta fila y la aserción de la fecha no se siembran.

12. **Pedir la pantalla y aplicarle las MISMAS reglas**, reutilizando `textoVisible` (`:120`) y los
    regex `SIMBOLO_DELANTE` / `PUNTO_DECIMAL` / `PCT_PUNTO` que ya están declarados arriba. Sin
    cookie: el portal no la usa.

```js
const rP    = await fetch(BASE + '/portal/' + tokP);
const htmlP = await rP.text();
const txtP  = textoVisible(htmlP);
ok(rP.status === 200, 'el portal del cliente responde 200', 'status ' + rP.status);

// LA GUARDA CONTRA EL VERDE SOBRE NADA: si el portal no tenía ni un importe, esto no ha medido
// nada. `CLAUDE.md`: una ruta que no enseña lo que se quiere medir da verde sobre nada.
const BIEN = /-?\d{1,3}(?:\.\d{3})*,\d{2}\s[€$£]/g;
const importes = [...txtP.matchAll(BIEN)].map(m => m[0]);
ok(importes.length > 0, 'el portal medido TENÍA importes que mirar (si no, esto no mide nada)',
   importes.slice(0, 3).join(' · ') || 'NINGUNO — cliente ' + cliPortal.id);

const malP = [...[...txtP.matchAll(SIMBOLO_DELANTE)], ...[...txtP.matchAll(PUNTO_DECIMAL)],
              ...[...txtP.matchAll(PCT_PUNTO)]].map(m => m[0].trim());
ok(malP.length === 0, 'el portal del cliente escribe el dinero como en España',
   [...new Set(malP)].slice(0, 4).join(' · ') || importes.length + ' importes, todos bien');
```

13. **La fecha del portal** *(solo con el paso 3)*:

```js
const fechasP = [...new Set(txtP.match(/(?<![\w-])\d{4}-\d{2}-\d{2}(?![\w-])/g) || [])];
ok(fechasP.length === 0, 'el portal del cliente no enseña ninguna fecha en formato inglés',
   fechasP.slice(0, 3).join(' · ') || 'ninguna');
ok(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(txtP),
   '  y la marca de tiempo del mensaje sale con su fecha en cristiano');
```

14. **La cabecera del bloque**, que es donde se explica por qué está escrito aparte y qué lo
    invalidaría (el texto está en §3.4 de este documento; en concreto tiene que decir: el portal no
    cuelga de `/admin`, no lo alcanza ningún `href`, no lleva sesión, **no lleva JavaScript** — y
    que **si algún día lo lleva, esta medición con `fetch` deja de bastar**).

15. **Fijar el caso de cuatro cifras** junto a las aserciones de `dinero(…)` que ya hay en `:170`,
    porque es exactamente la forma del defecto que se está cerrando:

```js
const { fmtEur } = await import('../modules/erp/margen.js');
ok(fmtEur(6023) === '6.023,00 €', '  y el separador de miles no se pierde con cuatro cifras', fmtEur(6023));
```

16. **Ampliar el `finally` que ya existe** (`:235`), borrando **por la marca**, no por los ids de la
    pasada — así una pasada que muriera a mitad la limpia la siguiente:

```js
try { db.prepare("DELETE FROM portal_tokens WHERE token LIKE 'zz-dinero-portal-%'").run(); } catch {}
try { db.prepare("DELETE FROM portal_mensajes WHERE texto LIKE 'ZZ dinero portal%'").run(); } catch {}
try { if (noVistos.length) db.prepare(
        `UPDATE portal_mensajes SET visto_cliente=0 WHERE id IN (${noVistos.map(() => '?').join(',')})`)
        .run(...noVistos); } catch {}
```

    `noVistos` y `tokP` se declaran con `let` **antes** del `try` de la línea 131 para que el
    `finally` los vea.

### Paso 5 — `scripts/gate-portal-ampliado.mjs`: apretar la aserción que dejó pasar el defecto

17. Línea 113, sustituir

```js
ok(/600[.,]00/.test(vista), '  su total');
```
    por
```js
// 1 sep 2026 · Antes esto decía /600[.,]00/ y aceptaba LAS DOS FORMAS: por eso este gate dio
// 35 ✓ · 0 ✗ con la pantalla escribiendo «€600.00». La coma no es un detalle: es la aserción.
ok(/600,00 €/.test(vista), '  su total, escrito como en España (600,00 €)');
```

    `A.total` de este gate vale 600 (`:90`), así que `fmtEur(600, '€')` da exactamente `600,00 €`.
    **Esta línea va en el mismo commit que el paso 2**: sin ella el gate se pone rojo, con ella
    demuestra el arreglo.

18. **No se toca nada más de ese gate.** La aserción `:116` (`!/9999/`) no depende del formato.

### Paso 6 — dejarlo escrito

19. `TABLERO.md:1833-1839` — el «CABO MENOR APUNTADO (no tocado)» pasa a **cerrado**, con su fecha
    y su commit. **Se tacha, no se borra**, que es la costumbre de la casa.
20. `TABLERO.md:8207-8219` — la ficha del orquestador: `estado: pendiente` → `hecha`, con commit y
    registro, igual que la de `pantalla-403-ventanita` (`TABLERO.md:8203-8205`).
21. `TABLERO.md` §Deuda técnica — **dos hallazgos nuevos, medidos y NO arreglados** (§5.7):
    - `created_at` se guarda en **UTC** y se enseña sin convertir a Europe/Madrid: la hora del chat
      del portal va desfasada 1-2 h. Sitios: `modules/portal/index.js:98`,
      `modules/portal/admin.js:63`, y todo lo demás que pinte un `created_at`.
    - `/admin/invoices` pinta el dinero **con JavaScript** y en inglés:
      `modules/erp/routes/invoices.js:1286`, `:1322` y `:1328`
      (`'${sym}'+Number(r.pendiente||0).toFixed(2)`), más la fecha ISO en `:1327`.
      `verify-dinero-espanol` no puede verlo porque mide lo servido y eso lo pinta el navegador
      después. **Es la misma enfermedad en otra pantalla y con otro punto ciego**; no entra en esta
      tarea.
22. `CLAUDE.md` — **no se toca.** Aquí no hay regla nueva: la regla del dinero español ya está
    escrita. Lo que había era una pantalla fuera del alcance del instrumento, y eso se arregla en el
    instrumento.
23. `scripts/lib/gates-mapa.mjs` — **no se toca, y esto es una instrucción, no un olvido.**
    `modules/portal/` no casa con ninguna regla de `AFECTA` y cae en el `.*` final
    (`gates-mapa.mjs:610`, `grupos: null` = *«corre todo»*). Añadirle una regla propia **reduciría**
    la cobertura de `--tocado`, porque en `AFECTA` **manda la primera regla que casa** y una nueva
    **sustituye**, no suma — está avisado en el comentario de `gates-mapa.mjs:536-541`.

---

## 5. Riesgos

### 5.1 🔴 El riesgo grande: un `toFixed(2)` que NO es pantalla y sí es la cadena de VERI\*FACTU

`modules/erp/routes/invoices.js:156`:

```js
const data = [inv.invoice_number, inv.issue_date, inv.company_fiscal_id,
              inv.client_fiscal_id || '', inv.total.toFixed(2), inv.prev_hash].join('|');
```

Eso es **entrada del hash encadenado**. Cambiarlo a `fmtEur` —o a cualquier otra cosa— haría que
**todas las facturas ya emitidas dejaran de verificar**: la cadena propietaria se rompe entera y
`verifyTenantInvoices` cantaría alarma en las 919 facturas de desarrollo y en las de los tenants
vivos. Es irreversible en el sentido que importa: la cadena legal no se recalcula.

**Mitigación, y es una prohibición explícita para quien construya:** este arreglo toca **un solo
fichero de producto** —`modules/portal/index.js`— más dos líneas de marca de tiempo en el paso 3.
**Nada de barridos de `toFixed` por el árbol.** `scripts/gate-portal-ampliado.mjs:170` ya verifica
la cadena entera al terminar y el criterio 7 de §6 lo exige explícitamente.

### 5.2 El regex `SIMBOLO_DELANTE` puede marcar un importe BIEN escrito

`verify-dinero-espanol.mjs:49` es `/[€$£] ?-?\d[\d.,]*\d/g`: admite **un** espacio entre símbolo y
número. Con el dinero bien escrito, el símbolo queda al final (`60.493,95 €`) y si la siguiente
celda empieza por un dígito, el texto visible podría leerse como «€ 1.210,00» y **marcarse en
falso**.

Leído el HTML del portal, no debería pasar: `textoVisible` (`:122`) sustituye **cada etiqueta por
un espacio**, y entre dos celdas hay al menos `</td><td>` → dos espacios. El propio comentario del
script (`:45-48`) explica que ese es el motivo de admitir uno y no dos. Los seis sitios se han
mirado uno a uno y todos tienen dos o más etiquetas entre el símbolo y el número siguiente.

**Mitigación:** el criterio 4 de §6 exige correrlo y que salga **0 ✗**. Y si apareciera un falso
positivo, **se arregla el espaciado de la plantilla, no se afloja el regex**: aflojar el
instrumento para que pase el producto es la forma de fallo que este repo tiene escrita tres veces.

### 5.3 La comprobación escribe en la conversación de un cliente real

Siembra un `portal_mensajes` en el hilo de un cliente vivo, y **abrir el portal marca como visto**
lo que el negocio le había escrito (`modules/portal/index.js:89` → `marcarVisto`). Sin cuidado, el
gate le apagaría al cliente un contador que no era suyo.

**Mitigación, triple:** (a) se guarda la lista de mensajes con `visto_cliente=0` **antes** y se
restaura en el `finally` (paso 4.11 y 4.16); (b) lo sembrado lleva **marca de la casa con prefijo
fijo y sufijo por pasada**, y se borra **por el prefijo**, así que una pasada muerta la limpia la
siguiente; (c) el token vive **15 minutos** y se borra igual. Medido: hoy hay **0 filas** en
`portal_mensajes` de `desarrollo-bamburu`, así que en la primera pasada no hay nada que restaurar.

**Y lo que NO hace, que es lo importante:** no crea ni una factura, ni un cliente, ni un asiento.
`CLAUDE.md` avisa de que la basura de un gate se vuelve **imborrable** en cuanto se engancha a un
documento legal —130 de 200 clientes de gate acabaron archivados por eso—. Aquí el gate **lee**
`invoices` y no escribe ni una fila: el residuo posible son dos filas, las dos borrables.

### 5.4 Cruce con `gate-portal-ampliado` si corren a la vez

`gate-portal-ampliado` **crea y borra facturas** (`GGATE`) y clientes `GG-…`. Si
`verify-dinero-espanol` eligiera justo ese cliente y el otro gate lo borrara a mitad, saldría un
403 o un fallo de clave foránea disfrazado de «el portal escribe mal».

**Mitigación:** la consulta del paso 4.10 **excluye las tres marcas de gate** (`GG-`, `GATE `,
`ZZ `). Además `gate-portal-ampliado` ya está declarado en `gates-mapa.mjs:421` como gate que
**corre solo**, precisamente porque verifica la cadena entera.

### 5.5 Datos que ya existen, migraciones y concurrencia

- **Datos existentes:** ninguno se toca. No hay migración, no hay columna nueva, no hay `DROP` de
  nada. La regla permanente de no destruir datos de un tenant no entra en juego porque no se escribe
  ni una fila de negocio.
- **Concurrencia:** el cambio es formateo puro dentro del renderizado de una petición. No hay estado
  compartido, no hay transacción, no hay bloqueo SQLite nuevo. Las dos únicas escrituras nuevas son
  del gate, no del producto.
- **`fmtEur(null)` devuelve `'—'`**, no `'NaN €'`: por eso el alias hace `Number(n || 0)` antes,
  igual que `avisos.js:432` y `contabilidad-routes.js:33`, y una fila sin total sigue diciendo
  `0,00 €` como hoy en vez de convertirse en un guion.

### 5.6 Monedas que no son el euro

`fmtEur` compone **siempre** «importe, espacio, símbolo». Un tenant con `currency_symbol = '$'`
pasaría de `$1234.56` a `1.234,56 $`. Es lo que quiere la regla (`verify-dinero-espanol.mjs:40`
prohíbe `$99.90` explícitamente) y es lo que ya hacen las otras 40 pantallas del producto.

**Medido para no discutir de teoría:** de las nueve BD de `data/tenants/`, **las 922 facturas
existentes tienen `currency_symbol = '€'`**. No hay ni un caso afectado hoy.

### 5.7 Lo que queda fuera a propósito, con su medida

- **`/admin/invoices` escribe el dinero en inglés desde JavaScript** —
  `modules/erp/routes/invoices.js:1286`, `:1322`, `:1328` (`'${sym}'+…toFixed(2)`) y la fecha ISO en
  `:1327`. `verify-dinero-espanol` **no puede verlo**: mide lo servido y esa tabla la pinta el
  navegador. El propio script conoce el agujero (`:196-201`) pero su remedio solo persigue
  porcentajes y horas, no dinero. Es otra pantalla y otra clase de punto ciego: **va al TABLERO
  (paso 6.21), no a esta tarea**.
- **La zona horaria de `created_at`** — §3.5. Va al TABLERO.
- **Los 2 decimales fijos de `fmtEur`** — §2, apartado SAP. No hay caso real y tocarlo movería 40+
  pantallas.
- **Pantallas que dependen de esto:** `/portal/<token>` (las tres tarjetas, la tabla y el
  subtítulo), y con el paso 3 también `/admin/portal/mensajes/:id`. El PDF
  (`/portal/<token>/factura/<id>/pdf`) **no se toca**: ya estaba bien. `modules/portal/portal.js`
  no se toca: no tiene ni un `toFixed`.

---

## 6. Criterios de aceptación

> Los criterios 4, 6 y 7 exigen **ejecutar** una comprobación. `RITUAL.md` manda: solo se ejecutan
> si Ibrahin lo autoriza **expresamente y de forma visible arriba del encargo**, y una autorización
> vale para **una** ejecución. Sin esa autorización la tarea no se puede dar por hecha, y **entregar
> el gate sin correrlo es motivo de rechazo** — pasó en `pantalla-403-ventanita`.
>
> Si Ibrahin opta por el **alcance estricto** (sin el paso 3, §3.5), se retira el **criterio 5** y
> los otros siete se mantienen tal cual.

- [ ] `grep -c toFixed modules/portal/index.js` devuelve **0** (hoy devuelve 7), `modules/portal/index.js` importa `fmtEur` de `../erp/margen.js`, y en todo `modules/portal/` no aparece ninguna definición de formateador propio (`grep -nE "(const|let|var)\s+\w+\s*=.*(sym|SYM).*toFixed" modules/portal/` no devuelve nada).
- [ ] Pedido `GET /portal/<token>` de un cliente con al menos una factura de más de 1.000 €, el HTML servido contiene su total escrito como `60.493,95 €` (punto de millar, coma decimal, símbolo detrás y separado por un espacio) y **no** contiene ninguna coincidencia de `/[€$£] ?-?\d/` ni de `/-?\d+\.\d{2}\s*[€$£]/` en su texto visible.
- [ ] La misma respuesta contiene los importes de las tres tarjetas de «Tu histórico» («en total», «de media», «Lo que más compras»), de la tabla «Por año» y del subtítulo «Pendiente total» **todos** en ese formato — es decir, el número de coincidencias de `/-?\d{1,3}(?:\.\d{3})*,\d{2}\s[€$£]/` en el texto visible es **mayor que 0** y ninguna cifra de la pantalla queda fuera de él.
- [ ] `node scripts/verify-dinero-espanol.mjs` sale con **código 0 y 0 ✗**, su salida incluye la aserción `el portal del cliente escribe el dinero como en España` **y** la aserción `el portal medido TENÍA importes que mirar`, y esta última **no** informa `NINGUNO`.
- [ ] La marca de tiempo del chat se lee `24/08/2026 14:30` en `/portal/<token>` y en `/admin/portal/mensajes/<id>`, ninguna de las dos pantallas contiene `/(?<![\w-])\d{4}-\d{2}-\d{2}(?![\w-])/` en su texto visible, y **los dígitos de la hora mostrada son idénticos a los de `created_at` en la BD** (el cambio es solo de escritura: no se ha convertido ninguna zona horaria).
- [ ] `node scripts/gate-portal-ampliado.mjs` sale con **código 0 y 0 ✗**, y su aserción del total exige literalmente `600,00 €` (el regex `/600[.,]00/` ya no aparece en el fichero).
- [ ] Tras esa ejecución, la BD `data/tenants/desarrollo-bamburu.db` **no contiene residuo**: `SELECT COUNT(*) FROM portal_tokens WHERE token LIKE 'zz-dinero-portal-%'` = 0, `SELECT COUNT(*) FROM portal_mensajes WHERE texto LIKE 'ZZ dinero portal%'` = 0, y `verifyTenantInvoices` sobre ese tenant devuelve `ok: true`.
- [ ] `git diff --name-only` de la entrega toca **exactamente**: `modules/portal/index.js`, `modules/portal/admin.js`, `modules/erp/voz.js`, `scripts/verify-dinero-espanol.mjs`, `scripts/gate-portal-ampliado.mjs` y `TABLERO.md` — y **ni una línea de `modules/erp/routes/invoices.js`** (el `toFixed(2)` de su línea 156 es entrada del hash de VERI\*FACTU, §5.1).
