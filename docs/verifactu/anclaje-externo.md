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

## El formato exacto de la raíz

Para poder verificar un sello **dentro de cinco años, sin este código**, hace falta reproducir
exactamente la cadena de entrada. Es SHA-256, en UTF-8, hex en **MAYÚSCULAS**, sobre un texto con
líneas separadas por `\n` (sin espacios sobrantes), en este orden:

```
bamburu-anclaje-v1
raiz_anterior=<raíz del anclaje anterior, o vacío si es el primero>
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

Los tres topes (`hasta_invoice_id`, `hasta_anulacion_id`, `hasta_registro_id`) se guardan en la
propia fila de `verifactu_anclajes`: son lo que hace que la raíz de ayer siga verificando hoy, aunque
el negocio siga facturando. **Este formato es estable a propósito**: tocarlo invalida todos los
anclajes anteriores, así que un cambio aquí es un cambio de plan, no un retoque de programador.

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
  fue el último sello, y deja comprobar la cadena de sellos ahora mismo (solo lee, no ancla, no llama
  a la TSA por red: `openssl ts -verify` es una comprobación local contra el certificado ya guardado).
  Ni la carga de la pantalla ni el botón «Comprobar ahora» recorren la sucesión completa: cada anclaje
  son 3 `SELECT` + un `openssl ts -verify` (~10 ms), y con miles de anclajes eso congelaría el proceso
  entero (better-sqlite3 es síncrono). La tabla se pinta con los últimos `ANCLAJE_COMPROBAR_LIMITE`
  anclajes (por defecto **100**, ≈ 1 s) y «Comprobar ahora» audita ese mismo tramo — el resto de la
  sucesión sigue viva en la base y la audita el gate, o una pasada sin acotar si hiciera falta. Sin
  certificado raíz (`VERIFACTU_ANCLAJE_TSA_CA`), la comprobación no dice «cuadra»: dice explícitamente
  que no se ha podido comprobar el sello criptográfico, en ámbar, nunca en verde.
- **`/superadmin/integridad`** — columna «Sellado» junto al chequeo de la cadena propietaria: la
  fecha del último anclaje de cada negocio, o «sin anclar».
- **El correo diario** (`BAMBURU_ANCLAJE_MAILTO`, por defecto `ibrahingil@gmail.com`) — raíz, hora del
  sello y TSA por negocio, con el `.tsr` del día adjunto. Si algún negocio con facturas no tiene
  anclaje, el asunto lo dice: `⚠️ sin sellar`.

## Qué se descartó, en una frase (el detalle está en el análisis, §3)

Esperar solo al envío a la AEAT (depende de un trámite externo y no cubre lo ya emitido) · publicar
las huellas en un Drive/repo nuestro (no es un tercero: quien tiene el `.db` tiene el `rclone.conf`) ·
firmar con un certificado nuestro (el auditado firmando su propia auditoría) · blockchain /
OpenTimestamps (confirmación de horas, no de minutos) · anclar factura a factura (metería una llamada
de red dentro de la transacción fiscal) · escribir el cliente RFC-3161 a mano (verificar CMS es
criptografía que no hay que reinventar: se invoca `openssl ts`).
