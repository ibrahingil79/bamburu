# VERI*FACTU · Anclaje externo — la cadena, sellada por un tercero fuera del servidor

> Tarea `anclar-verifactu-fuera`. Cierra el límite honesto del vector 3 de
> `docs/seguridad/vectores-de-ataque.md:90-93` («protege del producto, no de quien tenga acceso al
> servidor»). Construida entera y **APAGADA POR DEFECTO**: en `master`, sin tocar nada más, no ancla
> nada. Ver el análisis completo en
> `docs/architecture/task-anclar-verifactu-fuera-analysis.md`.

## Qué es

`invoices.verifactu_hash` (la cadena propietaria) y `verifactu_registros.huella` (la oficial de la
AEAT) son funciones puras sobre datos que están en el mismo fichero `.db`. Quien tenga el fichero
puede recalcular la cadena entera y el verificador propio (`verifyTenantInvoices`) sale verde igual —
porque no hay nada FUERA contra lo que contrastar.

El anclaje resuelve exactamente eso: cada cierto tiempo, `anclar()` (`modules/erp/verifactu-anclaje.js`)
calcula **una raíz** (SHA-256) que resume todo el material fiscal del negocio hasta un corte exacto, y
se la manda a una **autoridad de sellado de tiempo externa** (TSA, RFC-3161) para que la selle. El
sello vuelve **firmado por alguien que no somos nosotros**, se verifica antes de guardarlo, y se
guarda entero. Los sellos van **numerados y encadenados entre sí** (`raiz_anterior`), así que borrar
uno del medio se ve.

## Qué prueba

- Que un trozo de material fiscal (facturas, sus anulaciones y los registros oficiales VERI*FACTU),
  **hasta el momento del sello**, no se ha tocado desde entonces — porque un tercero, con su propio
  reloj, firmó una huella que solo coincide con esos datos exactos.
- Que **nadie ha borrado un sello del medio**: la numeración y el encadenado de raíces hacen que
  quitar uno rompa la cadena de los siguientes.
- Que **el trabajo de anclar sigue vivo**: el latido diario (`ANCLAJE_LATIDO_H`, 24 h por defecto)
  produce un sello aunque no haya facturas nuevas, así que un hueco de más de `2 × ANCLAJE_LATIDO_H`
  horas también es una alarma.
- Que **ninguna columna de la fila del anclaje se ha tocado después de sellarla** — número de
  facturas, fecha del sello, TSA, si la cadena propia cuadraba al sellar… todo lo que la pantalla
  pinta y el correo manda está dentro de lo que firma el tercero (raíz de dos niveles, más abajo).

## Cómo se juzga: `verificarAnclajes` es un CLASIFICADOR, no una lista de sospechas

Hasta el 1 de septiembre de 2026, el juez era una lista de comprobaciones que, si no encontraban
motivo de alarma, terminaban en verde: **el verde era su valor por defecto**. Tres intentos de cerrar
esta tarea fallaron por esa forma — cada revisión encontraba un caso nuevo que la lista no había
previsto (`docs/architecture/task-anclar-verifactu-fuera-analysis.md §0`).

Desde entonces, cada fila de `verifactu_anclajes` —**todas, no solo las `sellado`**— cae en
exactamente uno de cinco cubos: `verificados` (prueba criptográfica positiva), `sinComprobar` (no se
ha podido comprobar — falta el certificado, o el anclaje es de un formato anterior), `alarmadas`,
`fueraDeVentana` (sellados que quedaron fuera del tramo comprobado) y `fallidas` (intentos de sello que
no llegaron a cuadrar, y no compiten con la numeración). El veredicto se calcula **contando**, y el
literal que dice que todo está en orden **se gana**: solo sale cuando `verificados` iguala a TODOS los
sellados, sin nada fuera de ventana, sin nada sin comprobar y sin ninguna alarma.

### Los cinco veredictos, y qué hacer con cada uno

| Veredicto | Qué significa | Qué hacer |
|---|---|---|
| *(el verde)* | Todos los sellados, uno a uno, comprobados y en orden. | Nada: es el estado bueno. |
| `parcial` | Se comprobó solo un tramo (p. ej. el botón, acotado a `ANCLAJE_COMPROBAR_LIMITE`); del resto **no se dice nada**. | No es una alarma, pero tampoco tranquiliza sobre lo que queda fuera. Esperar al recorrido completo diario, o lanzarlo sin límite. |
| `sin-comprobar` | La numeración y el encadenado están en orden, pero falta el certificado raíz de la TSA (o el anclaje es del formato v1, anterior a este cambio) y no se pudo comprobar la firma. | Poner `VERIFACTU_ANCLAJE_TSA_CA`. |
| `sin-sellos` | Nunca se ha sellado nada todavía. | Encender el anclaje (ver «Las dos órdenes de encendido»). |
| `alarma` | Alguna fila no ha podido demostrar que está intacta: dato tocado, sello inválido, hueco en la cadena, fila escondida cambiando su `estado`… | Parar y mirar el motivo que trae la alarma — nombra la fila y, si aplica, el primer anclaje donde se ve el problema. |

## Qué NO prueba (y no hay forma de que lo haga)

- **Nada sobre lo que pasara ANTES del primer sello.** El anclaje no puede sellar hacia atrás. Si una
  factura de julio ya estaba alterada cuando se instaló esto, el primer anclaje certifica la versión
  alterada. Esto es estructural, no una limitación de esta versión.
- **Que el timer esté instalado.** El código puede vivir en el árbol sin sellar nada (ver «Las dos
  órdenes de encendido»). La pantalla (`/admin/verifactu/anclajes`), la columna «Sellado» de
  `/superadmin/integridad` y el correo diario existen justo para que eso nunca se confunda con estar
  protegido.
- **Conservación a muy largo plazo.** El token RFC-3161 se pide con `-cert` (lleva su cadena de
  certificación dentro), pero si dentro de muchos años el certificado de la TSA ya no es verificable
  por nadie, el sello envejece con él. El re-sellado periódico (ArchiveTimeStamp, RFC-4998) queda
  **fuera** de esta tarea.
- **Que la AEAT tenga esta factura.** El anclaje no es el envío a Hacienda (`verifactu-envio.js` /
  `verifactu-cola.js`). Cuando ese envío se encienda —depende de un trámite legal externo que solo
  puede iniciar el dueño (`docs/contexto/decisiones.md:11-24`)— es la mejor ancla que existe. Pero no
  compite con esta: la cadena oficial arranca limpia en la implantación, así que **las facturas
  anteriores a esa fecha no van a ir nunca a la AEAT**, y el anclaje sigue siendo lo único que las
  protege.
- **Que `id` y `created_at` se puedan cambiar sin que nadie lo note.** Es cierto, y es a propósito.
  `id`: *clave interna de la fila: no entra en lo que firma la TSA ni en nada que se enseñe.*
  `created_at`: *hora de nuestro reloj, solo informativa: la hora que vale es la que va dentro del sello, y esa sí se comprueba.*
  Ninguna de las dos columnas participa en la raíz que sella el tercero ni en la frescura del último
  sello, que se mide con `sellado_at` (o la hora que trae el propio token) — nunca con `created_at`.
- **Que borrar los ÚLTIMOS anclajes se vea de inmediato.** Hasta que pasan `2 × ANCLAJE_LATIDO_H`
  horas sin un sello nuevo, la cadena guardada en el `.db` sigue siendo internamente consistente
  (no hay un anclaje siguiente que reclame el que falta). La red contra esto no vive en el `.db`: es
  el `.tsr` que sale por correo cada día, fuera del servidor, con la raíz y la fecha de ese anclaje —
  quien tenga acceso al servidor puede borrar filas de `verifactu_anclajes`, pero no puede borrar el
  correo ya entregado.
- **Que la pantalla sea la prueba.** La pantalla y la tabla de auditorías (`verifactu_anclajes_auditorias`)
  viven en el mismo `.db` que el resto: quien pueda escribir uno puede escribir el otro. La prueba de
  verdad es el `.tsr` que sale del servidor cada día por correo — la pantalla es una comodidad para
  no tener que abrir un terminal, y este documento lo dice con esas palabras.

## El formato exacto de la raíz — dos niveles

Desde el replanteo del 1 de septiembre de 2026, la raíz que sella la TSA tiene **dos niveles**, para
que comprobar una fila cueste un solo SHA-256 (`O(1)`) y no exija releer todo el material fiscal cada
vez (`O(facturas)`), que fue lo que congeló la pantalla en un intento anterior.

**Nivel 1 — la raíz FISCAL** (`raizFiscal`, cara de recomponer): resume ENTERO el material fiscal del
negocio hasta el corte. Es SHA-256, en UTF-8, hex en **MAYÚSCULAS**, sobre un texto con líneas
separadas por `\n` (sin espacios sobrantes), en este orden:

```
bamburu-anclaje-fiscal-v2
invoices=<n>
<id>|<series>|<year>|<sequence>|<invoice_number>|<verifactu_hash>      ← una línea por factura,
...                                                                       ORDER BY id ASC, id <= hasta_invoice_id
anulaciones=<n>
<id>|<invoice_id>|<invoice_number>|<verifactu_hash>                    ← ídem invoice_anulaciones,
...                                                                       id <= hasta_anulacion_id
registros=<n>
<id>|<record_type>|<num_serie>|<huella>                                ← ídem verifactu_registros,
...                                                                       id <= hasta_registro_id
```

**Nivel 2 — la raíz** (`raiz`, barata de recomponer: es la que sella la TSA): SHA-256, mismas reglas,
de la cabecera de la propia fila — sus columnas más la raíz fiscal de arriba:

```
bamburu-anclaje-v2
raiz_anterior=<raíz del anclaje anterior, o vacío si es el primero>
hasta_invoice_id=<n>
hasta_anulacion_id=<n>
hasta_registro_id=<n>
n_facturas=<n>
n_anulaciones=<n>
n_registros=<n>
cadena_ok=<0|1>
cadena_detalle_sha=<SHA-256 MAYÚSCULAS del texto de la alarma de la cadena propia, o vacío si no hay>
tsa_url=<url>
raiz_fiscal=<la raíz fiscal del nivel 1>
```

Los tres topes (`hasta_invoice_id`, `hasta_anulacion_id`, `hasta_registro_id`) se guardan en la
propia fila de `verifactu_anclajes`: son lo que hace que la raíz de ayer siga verificando hoy, aunque
el negocio siga facturando. **Comprobar que una fila no se ha tocado es recomponer su cabecera (nivel
2) con la `raiz_fiscal` que tiene guardada** — un solo SHA-256, sin releer ninguna factura. Recomponer
también el nivel 1 (releer todo el material fiscal) solo hace falta **una vez por auditoría completa,
para el ÚLTIMO anclaje**: su raíz fiscal es función de todas las filas fiscales selladas, así que
tocar cualquiera de ellas la cambia.

**Este formato es estable a propósito**: tocarlo invalida todos los anclajes anteriores, así que un
cambio aquí es un cambio de plan, no un retoque de programador. La versión anterior (`bamburu-anclaje-v1`,
un solo nivel) se descartó **antes de que existiera ningún anclaje en producción** — medido, ninguna de
las 41 bases de `data/tenants/` tenía una sola fila en `verifactu_anclajes` el día del cambio — así que
no invalidó nada real.

Con la raíz reconstruida, verificar el sello es una orden de `openssl`, sin nada de Bamburu:

```bash
openssl ts -verify -digest <raiz en minúsculas> -in <el .tsr guardado o el del correo diario> -CAfile <certificado raíz de la TSA de aquel momento>
```

## Las DOS órdenes de encendido — y por qué las dos las da una persona

El código puede fusionarse a `master` sin encender nada, y de eso depende la tarea entera (ver «Qué
NO prueba»). Encenderlo de verdad exige dos pasos, y ninguno de los dos puede darlo el orquestador:

**1 · Elegir la TSA y escribir sus dos variables en `/etc/bamburu.env`** (fuera del repo; el
orquestador tiene el `$HOME` en solo lectura y no escribe ahí):

```bash
VERIFACTU_ANCLAJE_TSA=https://freetsa.org/tsr        # o una TSA cualificada eIDAS el día que se quiera valor legal pleno
VERIFACTU_ANCLAJE_TSA_CA=/home/ubuntu/bamburu/certs/freetsa-ca.pem   # el certificado raíz de ESA TSA
```

Elegir la TSA es una decisión de producto, no de construcción: pasar de una gratuita a una
**cualificada eIDAS** (FNMT, ACCV, Camerfirma…) es la diferencia entre «un tercero independiente lo
dice» y «tiene valor legal pleno», y esa decisión —que además cuesta dinero— la toma el dueño.

**2 · Instalar y arrancar el timer de systemd** (necesita `sudo`, que el orquestador no tiene):

```bash
cd /home/ubuntu/bamburu
sudo cp deploy/systemd/bamburu-anclaje-verifactu.service /etc/systemd/system/
sudo cp deploy/systemd/bamburu-anclaje-verifactu.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bamburu-anclaje-verifactu.timer

# Comprobar sin sellar nada:
node scripts/bamburu-anclaje-verifactu.mjs --dry-run
journalctl -u bamburu-anclaje-verifactu -n 40 --no-pager
```

Con solo UNO de los dos pasos dado, `motivoAnclajeInactivo()` sigue devolviendo un motivo y no se
sella nada: hacen falta los dos. Para apagarlo otra vez sin desinstalar nada: `VERIFACTU_ANCLAJE=off`
en `/etc/bamburu.env`.

## Qué se ve, y dónde

- **`/admin/verifactu/anclajes`** — la pantalla del negocio. Dice en palabras si está activo, cuándo
  fue el último sello, y deja comprobar la cadena de sellos ahora mismo con el botón «Comprobar los
  últimos N» (solo lee, no ancla, no llama a la TSA por red: `openssl ts -verify` es una comprobación
  local contra el certificado ya guardado). Ni la carga de la pantalla ni ese botón recorren la
  sucesión completa: cada anclaje son un `openssl ts -verify` + un `openssl ts -reply -text` (medido,
  ~11 ms), y con miles de anclajes eso congelaría el proceso entero (better-sqlite3 es síncrono). La
  tabla se pinta con los últimos `ANCLAJE_COMPROBAR_LIMITE` anclajes (por defecto **25** — bajado
  desde 100: con los 11 ms medidos, 25 son ≈ 0,3 s de proceso bloqueado en vez de 1,1 s) y el botón
  audita ese mismo tramo. Con menos anclajes comprobados que el total, el veredicto es **siempre**
  `parcial`: el botón no puede decir que todo está en orden sobre lo que no ha mirado.

  Debajo del cartel, la pantalla muestra además el resultado de la **última auditoría COMPLETA**
  (`verifactu_anclajes_auditorias`), la que recorre la sucesión entera sin límite — la hace, una vez
  al día, el barrido de systemd, nunca una petición HTTP. Ese resultado **caduca**: si tiene más de
  `2 × ANCLAJE_LATIDO_H` horas, la pantalla lo pinta en ámbar y dice «este resultado ya no vale»,
  aunque el veredicto guardado dijera que todo estaba en orden. Un veredicto guardado sin fecha de
  caducidad es un censo que dice CERO (`CLAUDE.md`).
- **`/superadmin/integridad`** — columna «Sellado» junto al chequeo de la cadena propietaria: la
  fecha del último anclaje de cada negocio, o «sin anclar».
- **El correo diario** (`BAMBURU_ANCLAJE_MAILTO`, por defecto `ibrahingil@gmail.com`) — el veredicto de
  la auditoría completa de cada negocio, con su cobertura (`textoVeredicto`), y el `.tsr` del último
  sello adjunto. Si algún negocio sale en `alarma`, el asunto lo dice: `⚠️ ALARMA`. Si alguno nunca ha
  sellado nada, `⚠️ sin sellar`.

## Qué se descartó, en una frase (el detalle está en el análisis, §3)

Esperar solo al envío a la AEAT (depende de un trámite externo y no cubre lo ya emitido) · publicar
las huellas en un Drive/repo nuestro (no es un tercero: quien tiene el `.db` tiene el `rclone.conf`) ·
firmar con un certificado nuestro (el auditado firmando su propia auditoría) · blockchain /
OpenTimestamps (confirmación de horas, no de minutos) · anclar factura a factura (metería una llamada
de red dentro de la transacción fiscal) · escribir el cliente RFC-3161 a mano (verificar CMS es
criptografía que no hay que reinventar: se invoca `openssl ts`).
