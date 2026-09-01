# Análisis — Anclar la cadena de VERI*FACTU fuera del servidor

- **id:** `anclar-verifactu-fuera`
- **origen:** `TABLERO.md:8625` · descongelada el 1 sep 2026 («Descongelo el anclaje de VERI\*FACTU.
  Que lo construya.»)
- **cierra:** el **límite honesto** del vector 3 de `docs/seguridad/vectores-de-ataque.md:90-93`
  («protege del producto, no de quien tenga acceso al servidor»)
- **fecha del plano:** 1 sep 2026. Todo lo que digo «medido» lo he medido **hoy**, en esta sesión,
  contra el árbol y contra un mundo de mentira en `/tmp` que ya he borrado. **No he tocado ninguna
  base de negocio en escritura**: todas las consultas de este documento van con `sqlite3 -readonly`.
- **lleva `firma: Ibrahin`** → este análisis incluye el apartado obligatorio **`## LA PROMESA`**, al
  final. La tarea se construye entera en `tarea/anclar-verifactu-fuera`, se prueba entera y **no se
  cierra sola**.

---

> ## ⚠️ LO QUE ESTA TAREA NECESITA EJECUTAR — ARRIBA DEL TODO, COMO PIDE `RITUAL.md` §3
>
> **Este plano NO pide, y NO autoriza, ningún `scripts/run-gates.mjs`** — ni el corto, ni el
> completo, ni ningún gate de navegador. Ninguno de los criterios de §6 lo necesita.
>
> Lo que sí hay que ejecutar es **cómo se construye esta pieza**, no un barrido:
>
> 1. **Una TSA local de usar y tirar en `/tmp`** (CA + firmante generados con `openssl req`/`x509`,
>    servidor RFC-3161 servido con `openssl ts -reply`). Sin red, sin secretos, sin tocar nada del
>    servidor. **Ya lo he probado hoy y funciona** — la prueba está en §2 y §4.
> 2. **Una ida y vuelta real contra una TSA pública**, UNA vez, con la huella de una cadena de
>    prueba aleatoria — **nunca con datos de un negocio**. Es lo único que sale a la red y lo único
>    que demuestra que el camino existe de verdad y no solo en el laboratorio.
> 3. **`scripts/verify-verifactu-anclaje.mjs`**, el gate propio de la tarea, contra la TSA local.
>
> **Escribir el gate no autoriza a ejecutarlo** (`RITUAL.md` §3). Si el encargo de construcción
> quiere que se corra, tiene que decirlo arriba del todo y visible, como esta caja.

---

## 1. Qué está mal hoy

### 1.1 La cadena se puede reescribir entera desde `sqlite3`, y el algoritmo está en el repo

`modules/erp/routes/invoices.js:155-156` es la cadena propietaria:

```js
export function calcHash(inv) {
  const data = [inv.invoice_number, inv.issue_date, inv.company_fiscal_id, inv.client_fiscal_id || '', inv.total.toFixed(2), inv.prev_hash].join('|');
```

y `modules/erp/verifactu.js:126-148` (`recordVerifactuAlta`) es la oficial. Las dos son funciones
**puras y deterministas** sobre datos que están en el mismo fichero `.db`. Quien tenga el fichero
tiene todo lo necesario para cambiar un importe y regenerar la cadena desde ese punto: no le falta
ninguna clave, ningún secreto y ninguna pieza. No es una debilidad del algoritmo — es que **no hay
nada fuera contra lo que contrastar**.

### 1.2 El único verificador que existe solo sabe decir «cuadra consigo misma»

`modules/superadmin/integridad.js:16-42` (`verifyTenantInvoices`) recorre `invoices` por
(serie, año) y comprueba dos cosas: que `calcHash(inv) === inv.verifactu_hash` y que
`prev_hash` enlaza con el hash anterior. **Las dos las satisface un atacante que recalcule.** El
propio `docs/seguridad/vectores-de-ataque.md:90-93` lo dice sin adornos, y tiene razón.

### 1.3 Y ese verificador ni siquiera está mirando: su verde lleva 9 días parado y 91 facturas de retraso

Medido hoy sobre `data/control.db`, tabla `integrity_checks`:

| tenant | total que dice la fila | fecha de la fila | facturas que hay HOY |
|---|---|---|---|
| `desarrollo-bamburu` | **832** | **2026-08-23 20:35** | **923** |

La pantalla `modules/superadmin/integridad.js:46-48` **no ejecuta el chequeo**: pinta
`listIntegrityResults()`, o sea la última fila guardada. Ejecutarlo solo ocurre si alguien pulsa el
botón (`:79`, `POST /superadmin/integridad/run`), y `saveIntegrityResult` no se llama desde ningún
otro sitio del árbol (comprobado: `git grep saveIntegrityResult` → solo `core/control-db.js:626`
donde se define y `modules/superadmin/integridad.js:9` donde se importa). **No hay timer
instalado que lo lance** (`systemctl list-timers`: `bamburu-avisos`, `bamburu-backup`,
`bamburu-backup-secondary`, `bamburu-backup-heartbeat`, `bamburu-caducar-reservas`,
`bamburu-propuestas`, `bamburu-recordatorios-cita`; ninguno de integridad).

Es exactamente la avería que ya está escrita en `scripts/gate-cadena-integridad.mjs:14-18` («una
fila del 20 de JUNIO decía 20 facturas con 833 en la base»). **Ha vuelto**, con otras cifras.

### 1.4 Nadie recorre la cadena OFICIAL

`verifyTenantInvoices` solo lee `invoices`. **`verifactu_registros.prev_huella` no lo comprueba
ninguna pieza del producto**: los únicos sitios que lo recorren son gates
(`scripts/gate-informes-legibles.mjs:131-134`, `scripts/gate-cadena-integridad.mjs:90`), y los gates
no corren solos. Son **1.231 registros** en `desarrollo-bamburu`, medidos hoy, sin verificador vivo.

### 1.5 La vía que lo resolvería sola está construida y apagada por un trámite de fuera

`modules/erp/verifactu-envio.js` + `modules/erp/verifactu-cola.js` remiten a la AEAT, y una vez
remitido **la Agencia tiene su copia y la cadena deja de depender de esta máquina**. Pero
`motivoColaInactiva` (`verifactu-cola.js:74-89`) la apaga en todos los negocios por falta de
certificado, y la decisión de `docs/contexto/decisiones.md:11-24` es hacerlo como **colaborador
social con un único certificado de Bamburu**, cuyo alta es *«legal y externo, y solo la puede
iniciar el dueño»*. Traducido: **el ancla que ya está construida no depende de programar, depende
de un trámite**, y mientras tanto no hay ninguna.

### 1.6 Y aunque se encendiera, no cubriría lo que ya existe

La cadena oficial **arranca limpia en la implantación** (`modules/erp/verifactu.js:8-12`): las
facturas anteriores no se registran retroactivamente, a propósito y con buen criterio. Así que
**las facturas que no van a ir nunca a la AEAT no las protege el envío ni aunque se encienda
mañana**. Medido hoy en los ocho negocios reales: 926 facturas (`desarrollo-bamburu` 923,
`ibrahin-repuestos` 2, `helados-ibrahin` 1), 308 anulaciones y 1.234 registros oficiales.

*(La ficha del tablero dice «922 facturas». Hoy son 923 en ese negocio. La cifra no está mal
planteada, está viva: sube cada vez que alguien factura.)*

### 1.7 Lo que NO está mal, y no se toca

`modules/erp/routes/invoices.js:156` — ese `toFixed(2)` **es entrada del hash**. El tablero lo marca
como intocable y este plano lo respeta: **esta tarea no escribe ni una línea en `invoices.js`, ni en
`verifactu.js`, ni en `verifactu-envio.js`, ni en `verifactu-cola.js`.** Solo lee.

---

## 2. Cómo lo resuelven los que ya lo resolvieron

### Odoo — el que más se le parece, y confirma el diagnóstico

Odoo tiene exactamente el mismo mecanismo y el mismo agujero. Su cadena de inalterabilidad
(`account.move.inalterable_hash`, nacida de la certificación francesa NF525 / *loi anti-fraude*) es
un SHA encadenado sobre los asientos publicados, y su verificador se llama **«Check Hash
Integrity»**: un informe que recorre la cadena y dice si cuadra. **Es `integridad.js`, línea por
línea, con otro nombre.** Y tiene el mismo límite: quien pueda escribir en PostgreSQL puede
recalcular y el informe sale verde.

La respuesta de Odoo a ese límite **no es un sello propio: es el Estado**. Para cada país enchufa el
canal de la autoridad —SdI en Italia, ATCUD/AT en Portugal, TicketBAI y `l10n_es_edi_verifactu` en
España— y ahí es donde la prueba sale de la máquina.

**Qué se trae:** la confirmación de que el envío a la AEAT es la vía canónica del sector, y de que
**el hueco entre «tengo cadena» y «la tiene alguien más» es un hueco reconocido, no una manía
nuestra.** Y una pieza concreta: su informe de integridad se puede **lanzar solo**; el nuestro
depende de un botón que lleva 9 días sin pulsarse (§1.3).

### SAP — el que ya vive obligado a hacer justo esto, y enseña el diseño

SAP resuelve la remisión con **Document and Reporting Compliance (DRC)**, otra vez «que lo tenga la
autoridad». Pero en Alemania SAP integra algo mucho más parecido a esta tarea: la **TSE**
(*Technische Sicherheitseinrichtung*) que exige la KassenSichV. Cada operación se firma con un
módulo de seguridad certificado —de un tercero: fiskaly, Deutsche Fiskal, Swissbit— **que el
operador del sistema no controla**, y que aporta tres cosas:

1. una **firma con reloj propio**, ajena a la máquina que factura;
2. un **contador monótono**, de forma que **un hueco se ve** aunque el atacante borre limpiamente;
3. el sello **viaja con el documento**, para que lo pueda comprobar quien no es el emisor.

**Qué se trae:** las tres, tal cual. (1) es el sello RFC-3161. (2) es la razón por la que abajo los
anclajes van **encadenados entre sí y numerados**, y no sueltos: borrar el último tiene que doler.
(3) es la razón por la que el sello se guarda entero (el token, no solo un «ok»), y por la que se
manda una copia fuera cada día.

### Salesforce — el que NO aplica del todo, y merece la pena decir por qué

Salesforce no tiene cadena fiscal. Su equivalente es **Field Audit Trail**: el histórico de cambios
vive en `FieldHistoryArchive`, retenido hasta 10 años, y **el administrador del cliente no lo puede
reescribir** — no porque esté cifrado, sino porque está en un dominio de confianza distinto: el del
operador de la plataforma. La lección de fondo es buena y la adopto: **la prueba tiene que vivir en
un dominio de confianza distinto del dato.**

Pero el modelo **no se puede copiar aquí**, y por un motivo que hay que decir en voz alta: en
Salesforce el operador es un tercero respecto del cliente; **en Bamburu el operador somos nosotros**.
El atacante del que habla esta tarea —«quien tenga acceso al fichero `.db`»— es precisamente quien
tendría acceso a nuestro «archivo inalterable». Poner las huellas en otra tabla, en otro fichero, en
otro Drive nuestro o en un repositorio nuestro **no cambia nada**: sigue siendo la misma mano.
De ahí sale la exigencia dura del §3: **el tercero tiene que ser un tercero de verdad.**

### El estándar que usan los tres por debajo

RFC-3161 (*Time-Stamp Protocol*) y su versión con valor legal en Europa, el **sello de tiempo
cualificado** de eIDAS. Es lo que hay debajo de la firma longeva de facturas (XAdES-T), de los
archivos notariales digitales y de las TSE alemanas. Se le manda **una huella** —32 bytes, nada
más— y devuelve un **token firmado** que dice «esta huella existía a esta hora», con la firma de
alguien que no somos nosotros.

**Comprobado hoy en esta máquina, no leído:** `OpenSSL 3.0.13` con el subcomando `ts` presente; CA y
firmante de mentira generados en `/tmp`; `openssl ts -query -digest <raíz> -sha256 -cert` produce una
petición de **69 bytes**; `openssl ts -reply` devuelve un token de **2.285 bytes**;
`openssl ts -verify -digest <raíz>` da `Verification: OK`, y **con la raíz alterada un solo bit da
`message imprint mismatch` → `Verification: FAILED`**. Salida a Internet hasta una TSA pública:
`freetsa.org:443` abierto desde este servidor. El directorio de la prueba ya está borrado.

---

## 3. La decisión

### Qué se hace

Cada poco tiempo, y por negocio, se calcula **una sola huella («la raíz») que resume todo el material
fiscal de ese negocio hasta un punto exacto**, se le pide a una **autoridad de sellado de tiempo
externa (RFC-3161)** que la selle, **se verifica el sello antes de guardarlo** y se guarda entero.
Los anclajes van **numerados y encadenados entre sí**. Una vez al día sale una **copia fuera** con
las raíces y sus sellos.

Con eso, la pregunta «¿alguien ha tocado una factura?» deja de contestarse con «la cadena cuadra
consigo misma» y pasa a contestarse con **«esta raíz la selló un tercero el día X, y hoy la raíz no
sale igual»** — que es una afirmación que se sostiene fuera de esta máquina.

### En qué capa vive

En la **capa de módulos del ERP**, `modules/erp/`, al lado de sus hermanas: `verifactu.js` (la
cadena), `verifactu-envio.js` (el sobre a la AEAT), `verifactu-cola.js` (el reloj). El anclaje es la
cuarta pieza de esa familia y no toca a ninguna de las tres: **solo hace `SELECT`.**

### Qué patrón del propio código sigue

Cuatro, y ninguno es nuevo:

1. **La puerta única que dice el motivo de estar apagada** — `motivoColaInactiva`
   (`verifactu-cola.js:74-89`). Devuelve el **motivo** de que no funcione, o `null`. Lo usan a la vez
   el motor y la pantalla (`verifactu-envio-routes.js:33,45-47`), así que **el producto y su cartel
   nunca discrepan**. El anclaje copia esto tal cual con `motivoAnclajeInactivo(slug)`.
   *Y es además el seguro contra la avería del cifrado del 1 sep:* como la puerta exige variables que
   solo se escriben en `/etc/bamburu.env` —fuera del alcance del orquestador—, **el código puede
   estar en el árbol sin que ancle nada**. No hay interruptor que se quede encendido por descuido.
2. **La escotilla del simulador** — `VERIFACTU_ENDPOINT` (`verifactu-cola.js:65-68`): si apunta a un
   simulador, todo el motor habla con él y no hace falta certificado. Es lo que permite probar de
   verdad sin red. El anclaje hace lo mismo con la URL de la TSA.
3. **El barrido oneshot de systemd que itera negocios** — `scripts/bamburu-verifactu-cola.mjs` y
   `scripts/bamburu-avisos.mjs`: abren cada `data/tenants/*.db`, llaman a `runMigrations(db)` porque
   no pasan por el middleware, y siguen con el siguiente si uno no aplica.
4. **La tabla aditiva de solo-añadir** — `verifactu_registros` (`models.js:1530`), `stock_movements`,
   `invoice_anulaciones` (`models.js:1508`). `CREATE TABLE IF NOT EXISTS`, ningún `DROP`, ninguna
   columna tocada en tablas existentes.

Y un quinto de fuera del ERP: el **interruptor de hombre muerto** de las copias
(`scripts/bamburu-backup.sh:15`, ping a healthchecks.io). Si el trabajo deja de correr, avisa alguien
de fuera. Aquí es opcional y por variable de entorno, pero el hueco queda hecho.

### Qué se descarta, y por qué

| Descartado | Por qué |
|---|---|
| **Esperar al envío a la AEAT** | Es la mejor ancla y ya está construida, pero depende de un **trámite legal externo** que solo puede iniciar el dueño (`decisiones.md:11-24`). Además **no cubriría las 926 facturas ya emitidas**, porque la cadena oficial arranca limpia (§1.6). No compiten: cuando el envío se encienda, el anclaje sigue valiendo para lo que la AEAT no verá. |
| **Publicar las huellas en un sitio nuestro** (otro Drive, un repo, otra tabla) | No es un tercero. Quien tiene el `.db` tiene el `rclone.conf` y el repo. Es la trampa de Salesforce del §2. |
| **Firmar las huellas con un certificado nuestro** | El auditado firmando su propia auditoría. Y no aporta **hora** creíble, que es la mitad del problema. |
| **Blockchain / OpenTimestamps** | Sí es un tercero real y es gratis. Pero la confirmación tarda **horas**, no minutos; para verificar hace falta un nodo o… un tercero; y explicar «tu factura está en Bitcoin» a un autónomo es una promesa que no quiero tener que defender. RFC-3161 es el estándar que ya usan las facturas europeas. |
| **Anclar factura a factura, dentro de la emisión** | Metería una llamada de red **dentro de la transacción fiscal**. `verifactu-cola.js:26-27` ya estableció la regla de la casa: la remisión se encola DESPUÉS del commit y **nunca tumba una emisión**. Anclar por lotes cada pocos minutos respeta eso. |
| **Escribir el cliente RFC-3161 en JavaScript** | Construir el DER se puede; **verificar la firma CMS del token, no** — es criptografía de la que uno no debe escribir su propia versión. Se invoca `openssl ts`, que está en la máquina (3.0.13, comprobado). Es además `CANON.md` §5: el código mínimo que resuelve el problema. |
| **Elegir hoy una TSA concreta y cablearla** | La URL y su certificado raíz son **configuración**, no código. Así se puede pasar de una TSA gratuita a una **cualificada eIDAS** (FNMT, ACCV, Camerfirma…) sin tocar una línea el día que Bamburu quiera valor legal pleno — y esa decisión, que cuesta dinero, no la tomo yo. |

---

## 4. El plan, paso a paso

### 1 · `modules/erp/models.js` — tabla nueva, justo después del bloque de `verifactu_envios` (tras la línea 1602)

```sql
CREATE TABLE IF NOT EXISTS verifactu_anclajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  secuencia INTEGER NOT NULL,              -- 1,2,3… sin huecos. El contador monótono de la TSE alemana.
  raiz TEXT NOT NULL,                      -- SHA-256 hex MAYÚSCULAS de lo de abajo
  raiz_anterior TEXT NOT NULL DEFAULT '',  -- raiz del anclaje secuencia-1 ('' en el primero)
  hasta_invoice_id INTEGER NOT NULL,       -- MAX(id) de invoices en el momento del corte
  hasta_anulacion_id INTEGER NOT NULL,
  hasta_registro_id INTEGER NOT NULL,
  n_facturas INTEGER NOT NULL,
  n_anulaciones INTEGER NOT NULL,
  n_registros INTEGER NOT NULL,
  cadena_ok INTEGER NOT NULL,              -- ¿la cadena cuadraba consigo misma al anclar?
  cadena_detalle TEXT,                     -- la alarma, si no cuadraba
  tsa_url TEXT NOT NULL,
  token BLOB,                              -- el .tsr entero, ~2 KB. NULL si el sello falló.
  sellado_at TEXT,                         -- hora que dice la TSA (no la nuestra), ISO-8601
  estado TEXT NOT NULL DEFAULT 'pendiente',-- 'sellado' | 'fallo'
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Parcial a propósito: los intentos fallidos se guardan con secuencia = 0 y no compiten (paso 2.4.6).
CREATE UNIQUE INDEX IF NOT EXISTS idx_verifactu_anclajes_sec
  ON verifactu_anclajes(secuencia) WHERE secuencia > 0;
```

Aditiva e idempotente. **No se toca ninguna tabla existente ni se añade ninguna columna a ninguna.**

### 2 · `modules/erp/verifactu-anclaje.js` — NUEVO. El motor. Cinco funciones exportadas

**2.1 · `motivoAnclajeInactivo(slug)`** — calcada de `motivoColaInactiva`. Devuelve el motivo, o
`null` si se puede anclar. Comprueba, en este orden:
- `process.env.VERIFACTU_ANCLAJE === 'off'` → apagado a mano.
- sin `slug` → «solo corre con el negocio resuelto».
- sin `process.env.VERIFACTU_ANCLAJE_TSA` → **«no hay ninguna autoridad de sellado configurada: las
  facturas se encadenan, pero nadie de fuera las está sellando»**. *Este es el estado de hoy y el que
  tendrá `master` al fusionar: sin esa variable en `/etc/bamburu.env`, la pieza está viva y quieta.*
- sin `process.env.VERIFACTU_ANCLAJE_TSA_CA`, o el fichero no existe → sin certificado raíz no se
  puede verificar lo que devuelva la TSA, y **un sello sin verificar no se guarda**.
- `openssl` no ejecutable → se dice, no se adivina.

**2.2 · `raizCanonica(db, { hastaInvoiceId, hastaAnulacionId, hastaRegistroId, raizAnterior })`** —
devuelve `{ raiz, n_facturas, n_anulaciones, n_registros }`. Construye un texto con esta forma
**exacta** (líneas separadas por `\n`, sin espacios sobrantes) y le aplica SHA-256 → hex
**MAYÚSCULAS**, igual que `sha256Upper` de `verifactu.js:25`:

```
bamburu-anclaje-v1
raiz_anterior=<raizAnterior o vacío>
invoices=<n>
<id>|<series>|<year>|<sequence>|<invoice_number>|<verifactu_hash>      ← ORDER BY id ASC, id <= hastaInvoiceId
...
anulaciones=<n>
<id>|<invoice_id>|<invoice_number>|<verifactu_hash>                    ← ORDER BY id ASC, id <= hastaAnulacionId
...
registros=<n>
<id>|<record_type>|<num_serie>|<huella>                                ← ORDER BY id ASC, id <= hastaRegistroId
```

Tres cosas que el programador **no puede cambiar sin romper todos los anclajes anteriores**, y que
por eso van dichas aquí:
- **Los topes por `id` son lo que hace que la raíz sea estable.** Una factura emitida después del
  corte no entra, así que el anclaje de ayer sigue verificando hoy. Sin topes, cada venta invalidaría
  todos los sellos anteriores.
- **La raíz incluye la identidad de cada fila, no solo su hash.** Así, borrar una fila o reordenar
  cambia la raíz aunque los hashes que queden sean coherentes entre sí.
- **`raiz_anterior` encadena los anclajes.** Es el contador monótono de §2: quitar un anclaje del
  medio deja el siguiente sin poder reproducirse.

**2.3 · `sellar(raiz, { tsaUrl, caPath, timeoutMs })`** — la ida y vuelta RFC-3161, en tres tiempos y
sobre un directorio temporal que se borra en `finally`:
1. `openssl ts -query -digest <raiz en minúsculas> -sha256 -cert -out req.tsq`
   *(`-cert` pide que el token incluya el certificado firmante: sin él, el token no se puede
   verificar dentro de unos años.)*
2. `POST` con `fetch` de los bytes de `req.tsq`, `Content-Type: application/timestamp-query`,
   `Accept: application/timestamp-reply`, con `AbortSignal.timeout(timeoutMs)`.
3. `openssl ts -verify -digest <raiz> -in resp.tsr -CAfile <caPath>` →
   **si no da `Verification: OK`, se devuelve fallo y el token NO se guarda.** Un sello que no
   verifica es peor que ninguno: cierra la pregunta (la lección del censo de ventanitas).
   La hora se saca de `openssl ts -reply -in resp.tsr -text` (línea `Time stamp:`).

Devuelve `{ ok, token: Buffer, selladoAt, error }`. **No lanza nunca.**

**2.4 · `anclar(db, opts)`** — una pasada para un negocio:
1. Si hay motivo de inactividad → devuelve `{ anclado: false, motivo }` y no escribe nada.
2. Lee en **una transacción**: los tres `MAX(id)`, el último anclaje y su `raiz`.
3. **Decide si toca**: sí cuando algún tope ha subido respecto del último anclaje, **o** cuando han
   pasado más de `ANCLAJE_LATIDO_H` horas (por defecto 24) desde el último. Lo segundo es el latido:
   un anclaje diario aunque no se facture, para que **un hueco en la sucesión se vea**.
   Si `n_facturas` y `n_registros` son 0 → no toca nunca (no hay material fiscal que anclar; esto es
   además lo que impide gastar sellos en las **41 bases de gates** que hay hoy en `data/tenants/`).
4. Llama a `verifyTenantInvoices` (importada de `modules/superadmin/integridad.js`, ya exportada) →
   `cadena_ok` / `cadena_detalle`. **Si la cadena está rota se ancla igual**, dejando la alarma
   escrita: congelar la prueba de un estado roto vale más que no congelar nada.
5. `raizCanonica(...)` → `sellar(...)`.
6. `INSERT` de la fila. **La regla de la numeración, que es lo que hace que un hueco signifique algo:**
   - un anclaje que se sella va con `estado='sellado'` y `secuencia = (última secuencia sellada) + 1`;
   - un intento que falla va con `estado='fallo'`, su `error`, **sin token** y con **`secuencia = 0`**.
   Es decir: **solo los sellos buenos entran en la sucesión, y la sucesión no tiene huecos legítimos
   nunca.** Un `1, 2, 4` solo puede significar que alguien borró el 3. Las filas de fallo quedan
   fuera —para el registro y para el correo— y por eso el índice único va sobre `secuencia` con las
   de fallo compartiendo el 0: **el índice tiene que ser `UNIQUE … WHERE secuencia > 0`** (índice
   parcial de SQLite), o varias filas de fallo chocarían entre sí. Corregir el `CREATE INDEX` del
   paso 1 en consecuencia.

**2.5 · `verificarAnclajes(db)`** — el juez. Recorre los anclajes `estado='sellado'` por `secuencia`
y por cada uno:
- recompone `raizCanonica` con **los topes guardados** y exige que salga igual → si no,
  **«se ha tocado material fiscal ya sellado»**, diciendo el anclaje y la fecha;
- exige que `raiz_anterior` sea la `raiz` del anclaje anterior → si no, **«falta un anclaje»**;
- `openssl ts -verify` del token contra la raíz guardada → si no, **«el sello no es válido»**;
- comprueba que no haya hueco de secuencia y que el último no sea más viejo de `2 × latido`.

Devuelve `{ ok, total, ultimo, alarma }`. **Solo lee.** Es la función que contesta la pregunta de
verdad, y es la que usan la pantalla y el gate.

### 3 · `scripts/bamburu-anclaje-verifactu.mjs` — NUEVO. El barrido

Calcado de `scripts/bamburu-verifactu-cola.mjs` (mismo esqueleto: `readdirSync` de
`data/tenants/*.db`, `db.bamburuSlug = slug`, `runMigrations(db)`, `try/finally` con `db.close()`,
`--dry-run`, `process.exit(fallos ? 1 : 0)`).

Por cada negocio: `anclar(db)`. Al terminar:
- **el correo diario**, con `sendEmail` de `core/mailer.js` (única puerta a Resend, con freno
  incorporado), a `process.env.BAMBURU_ANCLAJE_MAILTO || 'ibrahingil@gmail.com'` — el mismo
  destinatario y el mismo patrón que `scripts/bamburu-backup.sh:75`. Se manda **una vez al día**
  (marca en la tabla `settings` de `control.db`, para que un barrido cada 15 min no mande 96
  correos). Lleva, por negocio: fecha, nº de facturas, **la raíz**, la hora del sello y la TSA; y
  **adjunta el `.tsr` del día** (2 KB) para que la prueba exista fuera del servidor.
  Si algún negocio no está anclado, el asunto lo dice: `⚠️ sin sellar`.
- **ping opcional** a `process.env.ANCLAJE_HC_URL` si está definido (interruptor de hombre muerto,
  igual que las copias). Sin la variable, no se llama a nadie.

### 4 · `deploy/systemd/bamburu-anclaje-verifactu.{service,timer}` — NUEVOS

Copia de los de la cola. `Type=oneshot`, `User=ubuntu`, `WorkingDirectory=/home/ubuntu/bamburu`,
`EnvironmentFile=/etc/bamburu.env`, `ExecStart=/usr/bin/node …/scripts/bamburu-anclaje-verifactu.mjs`.
Timer: `OnBootSec=5min`, `OnUnitActiveSec=15min`, `AccuracySec=1min`, sin `Persistent`.

> **⚠️ EL ORQUESTADOR NO PUEDE INSTALARLOS.** `orquestador.service` corre con `NoNewPrivileges=yes` y
> `ReadWritePaths` limitado al repo: no hay `sudo` ni escritura en `/etc/systemd`. Los ficheros
> quedan en el repo —igual que `bamburu-verifactu-cola.{service,timer}`, que llevan ahí desde julio
> sin instalar— y **hasta que una persona ejecute `sudo systemctl enable --now
> bamburu-anclaje-verifactu.timer`, esta pieza no ancla nada.** Que eso no se pueda confundir con
> estar protegido es responsabilidad del punto 5.

### 5 · `modules/erp/routes/verifactu-anclaje-routes.js` — NUEVO. La pantalla

`GET /admin/verifactu/anclajes`, `requirePerm('invoices.read')`. Estructura calcada de
`verifactu-envio-routes.js`:
- **Cartel de estado arriba**, con el mismo lenguaje de `colaAviso` (`verifactu-envio-routes.js:45`):
  verde si `motivoAnclajeInactivo(slug) === null` **y** hay un sello de menos de 48 h; ámbar/rojo con
  **el motivo escrito en palabras** en cualquier otro caso. Si nunca se ha anclado, lo dice así:
  *«Nunca se ha sellado nada. Tus facturas se encadenan entre sí, pero **hoy nadie de fuera puede
  demostrar que no se han tocado**.»*
- **Tabla de anclajes**: secuencia, fecha del sello (la de la TSA), nº de facturas cubiertas, raíz
  (abreviada, con la entera en `title`), estado, TSA.
- **Botón «Comprobar ahora»** → `POST /admin/verifactu/anclajes/comprobar`, que llama a
  `verificarAnclajes(db)` y **solo lee**: no ancla, no escribe, no llama a la TSA por red.
  *(Anclar tiene un único escritor —el barrido de systemd, que es `oneshot` y no se solapa consigo
  mismo—, y por eso no hace falta ningún cerrojo entre procesos como el lease de la cola.)*
- **Nada de `confirm()`/`prompt()`/`alert()`**: si hiciera falta confirmar algo, `window.confirmarEnPagina()`.

### 6 · `modules/erp/routes/index.js:196` — montaje

Una línea junto a la existente:
```js
admin.route('/verifactu', createVerifactuAnclajeRoutes(db).views);
```
*(Hono admite dos `route` sobre el mismo prefijo; los caminos no chocan: `/envios` vs `/anclajes`.
Si al construir se comprueba que no compone bien, se monta dentro de `createVerifactuEnvioRoutes`
como segundo `views.get`. La decisión es del programador y se explica en la entrega.)*

### 7 · `modules/erp/menu.js` — dos líneas

- En el mapa de permisos, junto a `'verifactu-envio': 'invoices.read'` (`:52`):
  `'verifactu-anclaje': 'invoices.read',`
- En el área de Ventas, tras la entrada de Envío Verifactu (`:260`):
  `{ href: '/admin/verifactu/anclajes', label: 'Sellado externo', key: 'verifactu-anclaje', icon: 'ti-lock-check' },`

### 8 · `modules/superadmin/integridad.js` — una columna más, y no más

La pantalla que hoy da un verde de hace 9 días (§1.3) gana **una columna «Sellado»** por negocio:
la fecha del último anclaje o **«sin anclar»**. Se lee abriendo cada `.db` en `readonly` —igual que
ya hace `verifyTenantInvoices` (`:19`)— desde el mismo bucle que ya recorre los tenants.
**No se toca `verifyTenantInvoices`**: su SHA está congelado como línea base en
`scripts/gate-cadena-integridad.mjs` y modificarlo tumbaría ese gate con razón.

### 9 · `scripts/verify-verifactu-anclaje.mjs` — NUEVO. El gate propio

Mismo esqueleto que `scripts/verify-verifactu-cola.mjs`: contadores `ok()`, base temporal en
`tmpdir()`, negocio propio creado desde cero, limpieza en `finally`. **La TSA es local y de mentira**
—el equivalente al simulador SOAP de la cola— y se levanta así (probado hoy, funciona):

1. `openssl req -x509 -newkey rsa:2048 -keyout ca.key -out ca.pem -days 2 -nodes -subj "/CN=GATE TSA CA"`
2. firmante con **`extendedKeyUsage = critical,timeStamping`** en un `-extfile` — *sin eso el token
   no verifica y se pierde media hora buscando por qué*.
3. un `openssl.cnf` con sección `[tsa]` (`serial`, `signer_cert`, `certs`, `signer_key`,
   `signer_digest = sha256`, `default_policy`, `digests = sha256`, `accuracy`, `ordering = yes`).
   `openssl ts -reply` **exige** esa sección; sin ella no arranca.
4. un `http.createServer` que recibe el `.tsq`, lo pasa por `openssl ts -reply -config …` y devuelve
   el `.tsr` con `Content-Type: application/timestamp-reply`.

Bloques que ejercita, en este orden:

1. **Inactivo por defecto**: sin `VERIFACTU_ANCLAJE_TSA`, `motivoAnclajeInactivo` devuelve motivo,
   `anclar` no escribe ni una fila, y emitir una factura sigue funcionando.
2. **Ida y vuelta real** contra la TSA local: se ancla, se verifica y se guarda; el token guardado
   verifica con `openssl ts -verify`.
3. **Token corrupto**: se altera un byte del `.tsr` que devuelve el simulador → `anclar` **no
   persiste el token** y deja `estado='fallo'`.
4. **Manipulación**: sobre una **copia** de la base, se cambia un céntimo en una factura ya anclada
   **y se recalcula la cadena entera** con `calcHash` (o sea, se hace lo que haría el atacante) →
   `verifyTenantInvoices` da verde y **`verificarAnclajes` da ROJO**. Es el bloque que justifica la
   tarea entera.
5. **Borrado**: se elimina el anclaje del medio → `verificarAnclajes` da ROJO por hueco de secuencia.
6. **No toca nada**: SHA-256 de todas las columnas de `invoices`, `invoice_anulaciones` y
   `verifactu_registros` **antes y después** de una pasada completa → idénticos.
7. **Solo sale una huella**: se capturan los bytes que recibe el servidor de mentira y se comprueba
   que **no contienen** el NIF, ni el número de factura, ni el nombre del cliente, ni el importe.
8. **Latido**: sin material nuevo y con el reloj adelantado 25 h (inyectado, no esperado), se ancla
   igual; a las 2 h, no.

### 10 · Documentación

- `docs/verifactu/anclaje-externo.md` — NUEVO: qué es, qué prueba y **qué no prueba**, el formato
  exacto de la raíz (para poder verificar dentro de cinco años sin este código), y las **dos órdenes
  de encendido** que solo puede dar una persona.
- `deploy/systemd/README.md` — se añade la unidad nueva a la lista, marcada **NO INSTALADA**.

---

## 5. Riesgos

**1 · Que el código se quede vivo en producción sin firma — la avería del cifrado del 1 sep.**
El programador commitea antes del cierre, y `master` **es** el producto.
*Mitigación:* (a) la rama `tarea/anclar-verifactu-fuera`, que es la regla nueva del tablero;
(b) y sobre todo, **la pieza no puede encenderse sola**: `motivoAnclajeInactivo` exige
`VERIFACTU_ANCLAJE_TSA` en `/etc/bamburu.env`, donde el orquestador no escribe, **y** un timer de
systemd que no puede instalar. Aunque esto se fusionara hoy por error, no llamaría a nadie ni
escribiría una fila. *Es el mismo cerrojo que se acabó poniendo en las copias: el estado del
servidor manda sobre el código, y no al revés.*

**2 · Romper la cadena de VERI\*FACTU.** Es el riesgo caro: 926 facturas y 1.234 registros.
*Mitigación:* esta tarea **no escribe en ninguna tabla existente y no toca ninguno de los cuatro
ficheros de la familia Verifactu** — solo `SELECT`. El criterio 5 de §6 lo mide comparando el SHA de
todas las columnas antes y después. Y `invoices.js:156` no se abre.

**3 · Que el anclaje corte a mitad de una emisión.** El barrido lee `MAX(id)` mientras la app
factura.
*Mitigación:* los tres topes se leen en **una sola transacción** de better-sqlite3 (síncrono), y lo
que entre después simplemente pertenece al anclaje siguiente. No hay estado a medias posible: la
raíz es una foto de un prefijo cerrado.

**4 · Dos anclajes a la vez.** *Mitigación:* hay **un solo escritor por diseño** — el barrido
`oneshot` de systemd, que no se solapa consigo mismo — y el botón de la pantalla **solo verifica**.
Además el índice único sobre `secuencia` es la última red.

**5 · Que la TSA se caiga, cambie de URL o caduque su certificado.** *Mitigación:* el fallo se
guarda con su motivo, no se reintenta en bucle (el siguiente barrido lo vuelve a intentar a los 15
min), **no bloquea nada** —ni la emisión, ni la cola de la AEAT, ni la pantalla— y sale en el correo
diario. La TSA es configuración: cambiarla es editar una variable y dejar un `.pem`.

**6 · Que dentro de unos años el token ya no se pueda verificar** porque el certificado de la TSA
caducó. Es un problema real y conocido de RFC-3161.
*Mitigación parcial y declarada:* el token se pide con `-cert`, así que lleva dentro su cadena, y el
raíz de confianza va en el repo. **La conservación a muy largo plazo (re-sellado periódico,
ArchiveTimeStamp de RFC-4998) queda FUERA de esta tarea y se dice en `anclaje-externo.md`.** No lo
resuelvo a medias ni finjo que no existe.

**7 · Que salgan datos de clientes a un tercero.** *Mitigación:* lo único que se transmite es una
petición RFC-3161 de ~69 bytes que contiene **un digest SHA-256 y nada más** — ni nombres, ni NIF,
ni importes. El criterio 6 de §6 lo comprueba **sobre los bytes enviados**, no sobre la intención.

**8 · Que el timer no se instale y esto parezca protegido sin serlo.** Es el riesgo que más me
preocupa, porque es exactamente *«un censo que dice CERO y no es cierto»*.
*Mitigación:* la pantalla dice **«Nunca se ha sellado nada»** en rojo mientras no haya anclajes; la
pantalla de integridad del superadmin gana la columna «sin anclar»; y el correo diario lleva
`⚠️ sin sellar` en el asunto. **Tres sitios distintos tienen que mentir a la vez** para que esto
pase por bueno. Y el ping opcional de hombre muerto avisa desde fuera si el trabajo deja de correr.

**9 · Lo que el anclaje NO puede prometer, y hay que decirlo antes de que alguien lo suponga:**
sella el estado **desde el primer sello en adelante**. **No demuestra nada sobre lo que pasara antes
de ese primer sello.** Si una factura de julio ya estaba alterada, el primer anclaje certifica la
versión alterada. *Mitigación:* ninguna posible —el tiempo no se ancla hacia atrás—, así que va
escrito en `anclaje-externo.md` y no aparece en LA PROMESA, que habla en futuro a propósito.

**10 · Pantallas que dependen de esto.** Ninguna existe hoy. Las que se tocan son
`/admin/verifactu/envios` (no se modifica; solo se le añade una hermana) y `/superadmin/integridad`
(una columna). El criterio 1 de §6 exige que las dos sigan respondiendo 200 **con su URL final**,
porque media docena de pantallas de este producto redirigen y una redirección también responde 200.

**11 · Basura de la prueba.** El gate crea negocio, facturas y anclajes.
*Mitigación:* negocio propio desde cero (`negocioDesechable()`), prefijo reconocible, limpieza en el
`finally` **por la marca y no por los ids de la pasada**, y la manipulación del bloque 4 **sobre una
copia del fichero**, nunca sobre un negocio vivo — que además es lo único admisible: una factura
tocada no se puede «destocar» si entra en la cadena.

---

## 6. Criterios de aceptación

- [ ] **Apagado por defecto y sincero:** sin `VERIFACTU_ANCLAJE_TSA` definida, `motivoAnclajeInactivo()` devuelve un motivo en texto, `anclar()` no inserta ninguna fila en `verifactu_anclajes`, emitir una factura sigue funcionando, y `/admin/verifactu/anclajes` responde **200 con URL final `/admin/verifactu/anclajes`** mostrando ese mismo motivo en pantalla.
- [ ] **El sello se verifica ANTES de guardarse:** con un token al que se le ha alterado un byte, la fila queda `estado='fallo'` con su error y **`token` a NULL**; con el token bueno queda `estado='sellado'` y `openssl ts -verify -digest <raiz> -in <token> -CAfile <ca>` sobre lo guardado devuelve `Verification: OK`.
- [ ] **Caza al atacante:** sobre una **copia** de una base con anclajes, cambiar el `total` de una factura ya sellada **y recalcular toda la cadena con `calcHash`** deja `verifyTenantInvoices` en `ok: true` y hace que `verificarAnclajes()` devuelva `ok: false` nombrando el anclaje y la fecha del sello.
- [ ] **Un hueco se ve:** borrar una fila de `verifactu_anclajes` que no sea la última hace que `verificarAnclajes()` devuelva `ok: false` por rotura de `raiz_anterior` o de la sucesión de `secuencia`.
- [ ] **No toca la cadena:** el SHA-256 de todas las columnas de `invoices`, `invoice_anulaciones` y `verifactu_registros` es **idéntico** antes y después de una pasada completa de `scripts/bamburu-anclaje-verifactu.mjs`; y `git diff` de la rama no incluye `modules/erp/routes/invoices.js`, `modules/erp/verifactu.js`, `modules/erp/verifactu-envio.js` ni `modules/erp/verifactu-cola.js`.
- [ ] **Solo sale una huella:** los bytes del cuerpo `application/timestamp-query` que recibe la TSA no contienen el NIF del emisor, ni el número de factura, ni el nombre del cliente, ni el importe (comprobado sobre el buffer recibido, no sobre el código que lo construye).
- [ ] **`scripts/verify-verifactu-anclaje.mjs` existe, levanta su propia TSA local, ejercita los ocho bloques de §4.9 y sale con código 0**; con el token manipulado o la factura alterada sale con **código 1**.
- [ ] **El estado se ve sin abrir el código:** `/admin/verifactu/anclajes` dice en palabras «último sello: `<fecha>`» o «Nunca se ha sellado nada», `/superadmin/integridad` responde 200 con su URL final y muestra la columna «Sellado» por negocio, y el correo diario lleva la raíz, la hora del sello y el `.tsr` adjunto — con `⚠️ sin sellar` en el asunto si algún negocio con facturas no tiene anclaje.

---

## LA PROMESA

Cada factura que emitas queda **sellada por un tercero de fuera** a los pocos minutos de emitirla: un
servicio independiente de sellado de tiempo, que no somos nosotros y que no controlamos. Si mañana
alguien con acceso al servidor cambiara un importe, **se podría demostrar desde fuera que se tocó**.
Hoy no se podría: la cadena se recalcula sola y vuelve a cuadrar.

Fuera del servidor solo sale una huella ilegible. **Ni un nombre, ni un NIF, ni un importe, ni un
dato de tus clientes** sale de aquí.

Si el sellado falla, la factura se emite igual y el sello se reintenta: **nunca te impide facturar.**
Y no puede fallar en silencio — el día que se deje de sellar, se avisa.

Esto **no sustituye a mandarle las facturas a Hacienda**: es lo que las protege mientras ese envío
está apagado, y también protege a las antiguas, que no van a ir nunca.
