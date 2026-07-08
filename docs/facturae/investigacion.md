# Facturae — Investigación técnica previa a construir (2026-07-08)

> Investigación previa a construir (misma regla que Verifactu: **especificaciones verificadas en la fuente
> oficial, no de memoria**). Aquí no se ha tocado código de Bamburu. Todo lo que se afirma sobre la
> estructura sale de **parsear el XSD oficial descargado** (`Facturaev3_2_2.xml`, 190.062 bytes); lo legal,
> del **texto consolidado del BOE**; los endpoints, de **descargar el WSDL en vivo**. Lo que no pude
> verificar está en la sección final, marcado como tal.
>
> Además se levantó un **prototipo desechable** (fuera del repo) que genera un Facturae 3.2.2 desde una
> factura real de `desarrollo-bamburu` y lo **valida contra el XSD oficial con `xmllint`**: valida. Eso es
> lo que respalda el "se puede construir ya" del final.

---

## 1. Versión vigente y XSD oficial

- **Facturae 3.2.2 es la versión vigente.** Confirmado en `facturae.gob.es/formato/ultima-version` y en
  el BOE (Resolución de 24-08-2017, `BOE-A-2017-9982`, que publica la versión 3.2.2). En vigor en FACe
  desde marzo de 2018.
- **XSD oficial** (descargado y parseado, 190 KB):
  `https://www.facturae.gob.es/content/dam/facturae/formato/versiones/Facturaev3_2_2.xml`
  (ojo: la extensión publicada es `.xml`, no `.xsd`. La ruta "bonita" `/formato/Versiones/Facturaev3_2_2.xsd` da **404**.)
- **`targetNamespace` = `http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml`**
  Es un identificador, no una URL descargable — **no intentes resolverla, devuelve 404**. Es un error
  clásico de implementación.
- El esquema importa `http://www.w3.org/2000/09/xmldsig#` desde
  `http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd`. Para validar sin red hay que cachear ese XSD.
- `SchemaVersionType` es una enumeración con **un solo valor: `3.2.2`**. El propio esquema no admite otra cosa.

---

## 2. Estructura obligatoria (extraída del XSD, no de un tutorial)

Raíz `Facturae`: `FileHeader` [1..1] · `Parties` [1..1] · `Invoices` [1..1] · `Extensions` [0..1] · `ds:Signature` [0..1].

**Nota crítica:** la firma es **`minOccurs="0"` en el esquema**. Es decir, un Facturae sin firmar **valida
contra el XSD**. La obligación de firmar no viene del esquema, viene de la ley y de FACe. No confundas
"valida" con "presentable".

| Bloque | Hijos obligatorios (según XSD) |
|---|---|
| `FileHeader` | `SchemaVersion` · `Modality` (I/L) · `InvoiceIssuerType` (EM/RE/TE) · `Batch` |
| `Batch` | `BatchIdentifier` · `InvoicesCount` · `TotalInvoicesAmount` · `TotalOutstandingAmount` · `TotalExecutableAmount` · `InvoiceCurrencyCode` |
| `Parties` | `SellerParty` · `BuyerParty` (ambos `BusinessType`) |
| `BusinessType` | `TaxIdentification` + **choice**: `LegalEntity` \| `Individual` |
| `TaxIdentification` | `PersonTypeCode` (F/J) · `ResidenceTypeCode` (R/U/E) · `TaxIdentificationNumber` (min 3 car.) |
| `LegalEntity` | `CorporateName` + **choice**: `AddressInSpain` \| `OverseasAddress` |
| `Individual` | `Name` · `FirstSurname` + **choice**: `AddressInSpain` \| `OverseasAddress` |
| `AddressType` | `Address` · **`PostCode`** · **`Town`** · **`Province`** · **`CountryCode`** (ISO 3166-1 **alpha-3**: `ESP`) |
| `Invoice` | `InvoiceHeader` · `InvoiceIssueData` · `TaxesOutputs` · `InvoiceTotals` · `Items` |
| `InvoiceHeader` | `InvoiceNumber` (máx 20) · `InvoiceDocumentType` (FC/FA/AF) · `InvoiceClass` (OO/OR/OC/CO/CR/CC) |
| `InvoiceIssueData` | `IssueDate` · `InvoiceCurrencyCode` · `TaxCurrencyCode` · `LanguageName` |
| `TaxesOutputs` | 1..N `Tax`: `TaxTypeCode` · `TaxRate` · `TaxableBase` (`TaxAmount` es opcional) |
| `InvoiceTotals` | `TotalGrossAmount` · `TotalGrossAmountBeforeTaxes` · `TotalTaxOutputs` · `TotalTaxesWithheld` · `InvoiceTotal` · `TotalOutstandingAmount` · `TotalExecutableAmount` |
| `Items` | 1..N `InvoiceLine` |
| `InvoiceLine` | `ItemDescription` · `Quantity` · `UnitPriceWithoutTax` · `TotalCost` · `GrossAmount` · `TaxesOutputs` |
| `Corrective` (si `InvoiceClass=OR`) | `ReasonCode` · `ReasonDescription` · `TaxPeriod` · `CorrectionMethod` · `CorrectionMethodDescription` |

**`UnitOfMeasure` es OPCIONAL** (`[0..1]`). La pregunta del encargo sobre el código de unidad de medida
se responde sola: **no es un hueco bloqueante**. Si se informa, el catálogo tiene 36 valores
(`01` Units, `02` Hours-HUR, `03` Kilograms-KGM, …, `36` KWh). Para servicios, `01` o `02`.

Códigos que importan (del XSD):
- `TaxTypeCode`: **`01` = IVA**, **`04` = IRPF**, `03` = IGIC, `02` = IPSI… (29 valores).
- `PaymentMeans`: 19 valores (`01` efectivo, `02` domiciliación, `04` transferencia, `19` tarjeta…).
- `ReasonCode` (rectificativas): `01`–`16` + `80`–`85`. `CorrectionMethod`: `01` íntegra, `02` solo
  conceptos corregidos, `03` global por periodo, `04` autorizada por la AEAT.

---

## 3. Mapeo con lo que Bamburu guarda hoy

### 3.1 Encaja directo

| Facturae | Bamburu | Nota |
|---|---|---|
| `InvoiceNumber` | `invoices.invoice_number` | Máx 20 car.; el máximo real hoy es 10 (`F2026-0005`). |
| `IssueDate` | `invoices.issue_date` | `xs:date`, ya en ISO. |
| `InvoiceCurrencyCode` / `TaxCurrencyCode` | `invoices.currency` | |
| `InvoiceClass` | `invoices.record_type` | `alta`→`OO`, `rectificativa`→`OR`. |
| `TaxesOutputs/Tax` (desglose IVA) | `invoice_items.tax_rate` + `tax_amount` | Agrupar por tipo. **Ya hay facturas multi-tipo** (la id=5 tiene 3 tipos distintos). |
| `TaxesWithheld/Tax` (`TaxTypeCode=04`) | `invoices.irpf_rate` / `irpf_amount` | 3 facturas con IRPF hoy. |
| `InvoiceLine.*` | `invoice_items.description/quantity/unit_price/total_price` | `TotalCost` = `GrossAmount` cuando no hay descuentos de línea (Bamburu no los tiene). |
| `SellerParty` nombre/NIF | `invoices.company_name/company_fiscal_id` | Snapshot en la factura: bien pensado, preserva el histórico. |
| `BuyerParty` nombre | `invoices.client_name` | Snapshot. |
| `PaymentDetails` (opcional) | `invoices.due_date` + `invoice_payments.payment_method` | Requiere tabla de traducción a `PaymentMeans` (hoy son texto libre: `efectivo`, `tarjeta`, `''`). |

### 3.2 Falta — huecos de ESQUEMA

| Facturae exige | Bamburu | Gravedad |
|---|---|---|
| `PersonTypeCode` (F/J) | **no existe** | Bloqueante. Emisor y receptor. |
| `ResidenceTypeCode` (R/U/E) | **no existe** | Bloqueante. |
| `PostCode` (5 dígitos) | **no existe** | Bloqueante. Ni en `company_config` ni en `clients`. |
| `Town` (municipio) | `clients.city` ✔ / `company_config` **✘** | Parcial. |
| `Province` | **no existe** | Bloqueante. |
| `CountryCode` ISO **alpha-3** (`ESP`) | `country` guarda **alpha-2** (`ES`) | Conversión trivial, pero conversión. |
| `Individual` vs `LegalEntity` | `clients.name` es un campo único | Un autónomo receptor exige `Name` + `FirstSurname` separados. Enlaza con el mismo problema que resolvimos en U8: **no partir un nombre por el primer espacio**. |
| DIR3 (`AdministrativeCentres`) | **no existe** | Bloqueante **para FACe** (§5). |

### 3.3 Falta — huecos de DATOS (peor que los de esquema)

Barrido sobre las 72 facturas reales de `desarrollo-bamburu`:

| Campo | Facturas sin dato |
|---|---|
| `client_fiscal_id` (NIF del receptor) | **72 / 72** |
| `client_address` | **72 / 72** |
| `company_address` | **72 / 72** |
| `company_fiscal_id` (NIF emisor, snapshot) | **20 / 72** |

Los cuatro son **obligatorios** en Facturae. `TaxIdentificationNumber` tiene `minLength=3`: una cadena
vacía **rompe la validación** (comprobado: es el primer error que soltó `xmllint`). Añadir columnas no
arregla esto; hay que **capturar el dato**. Y las facturas ya emitidas no se pueden reescribir.

### 3.4 El mapeo que NO es 1:1: F1/F2/F3 y R1–R5

Esto merece párrafo aparte porque el encargo lo pregunta y la respuesta es incómoda.

- **F1/F2/F3 y R1–R5 son de la AEAT (Verifactu, lista L2). Facturae no los conoce.** Son taxonomías
  distintas, no dialectos de la misma.
- Facturae usa `InvoiceDocumentType` (FC completa / FA abreviada / AF autofactura) + `InvoiceClass`
  (OO original / OR rectificativa / OC recapitulativa / CO-CR-CC copias). Correspondencia razonable:
  **F1 → FC + OO**, **F2 (simplificada/ticket) → FA + OO**, **R1–R5 → FC + OR**.
- **`tipo_factura` NO se persiste.** `verifactu.js:117` lo deriva: si no llega explícito, es `F1`
  (o el `R*` de `rectification_type`). El mostrador pasa `'F2'` en caliente, pero **no queda en la BD**.
  Consecuencia: **hoy no se puede distinguir a posteriori una F1 de una F2**. Para Facturae da igual en
  B2G (una simplificada no puede ir a FACe: no tiene receptor identificado), pero es un hueco real si se
  quiere generar Facturae de cualquier factura.
- **R1–R5 no mapean a `ReasonCode`.** R1–R5 son las causas del art. 80 LIVA; el `ReasonCode` de Facturae
  es otra lista (`01`–`16`, `80`–`85`) sobre *qué campo se corrige*. **No hay tabla de equivalencia
  oficial.** Hay que decidirla y documentarla. Lo que sí mapea limpio es el **modo**:
  `rectification_mode` `'S'` (sustitución) → `CorrectionMethod=01`; `'I'` (diferencias) → `CorrectionMethod=02`.
- Además `Corrective` exige `ReasonDescription`, `CorrectionMethodDescription` y `TaxPeriod`
  (inicio y fin) — **ninguno de los tres existe hoy**.

### 3.5 Una trampa semántica que el XSD no caza

`invoices.total` en Bamburu es **base + IVA − IRPF** (verificado: id=5 → `1191.50` = `1364.00 − 172.50`).

> ⚠️ **CORRECCIÓN (2026-07-08, al construir el motor).** Lo que decía esta sección era **falso**. Se
> escribió por analogía, sin leer las anotaciones del XSD ni el esquema oficial castellano. Lo correcto,
> literal del XSD (`<xs:documentation xml:lang="es">`) y del PDF de descripción de campos §3.1.5:
>
> - `InvoiceTotal` = `TotalGrossAmountBeforeTaxes` + `TotalTaxOutputs` **− `TotalTaxesWithheld`**
>   → **SÍ descuenta la retención**.
> - `TotalOutstandingAmount` = `InvoiceTotal` − (subvenciones + anticipos).
> - `TotalExecutableAmount` = `TotalOutstandingAmount` − `AmountsWithheld` − pago en especie
>   + suplidos + gastos financieros.
>
> `TotalTaxesWithheld` es la retención **fiscal** (IRPF). `AmountsWithheld` es otra cosa: «cantidades
> que retiene el pagador hasta el buen fin de la operación» (retención de garantía). Confundirlas fue
> el origen del error.
>
> Como Bamburu no tiene subvenciones, anticipos, retención de garantía, pago en especie, suplidos ni
> gastos financieros, **los tres totales coinciden** y valen exactamente `invoices.total`
> (= base + IVA − IRPF). No hay que recalcular nada.
>
> La lección de fondo **sigue en pie, y se ha aplicado**: el XSD comprueba tipos, no aritmética. Un
> primer prototipo con los totales al revés **validó igualmente**. Por eso el motor lleva tests de
> importe propios (`facturaeStatus` bloquea cualquier factura cuyas líneas no reconstruyan el total
> guardado) además de la validación de esquema.
>
> **Otra corrección de la misma tanda:** §3.4 afirmaba que `tipo_factura` «NO se persiste». Falso:
> se guarda en `verifactu_registros.tipo_factura` (F1=22, F2=29, F3=1 en desarrollo). Solo las 20
> facturas anteriores a Verifactu no lo tienen. La columna `invoices.tipo_factura` que añade el motor
> se rellenó por **backfill desde ahí**, sin perder nada.
>
> Y una tercera, encontrada por el propio XSD al validar: `ReasonDescription` y
> `CorrectionMethodDescription` **no son texto libre, son enumeraciones** con literales exactos
> alineados por posición con `ReasonCode` / `CorrectionMethod`. El código AEAT (R1–R5) se conserva en
> `AdditionalReasonDescription`, que sí es libre.

---

## 4. Firma: XAdES-EPES, y qué certificado sirve

Fuente: **PDF oficial "Política de firma (versión 3.1) formato Facturae"**, descargado y extraído.

- **Perfil exigido: XAdES-EPES** (básico + información de política de firma), sobre XMLDSig
  **enveloped** (`http://www.w3.org/2000/09/xmldsig#enveloped-signature`). La política también define un
  perfil de larga duración, **XAdES-XL**, para evidencias de validez frente a terceros.
- `SignaturePolicyIdentifier` → `SigPolicyId/Identifier` debe llevar **la URL literal de la política**:
  `http://www.facturae.es/politica_de_firma_formato_facturae/politica_de_firma_formato_facturae_v3_1.pdf`
  (ojo: `.es`, no `.gob.es`, tal y como aparece en el propio documento), y `SigPolicyHash` con la huella
  del PDF. Del fichero que descargué (45.735 bytes):
  `SHA-1 = 7ff2cf405a4c73f85afb5749f98e72d7538f5673` ·
  `SHA-256 = d752352f10640ef5292f066a7f63c70e695044cdafa5fdedd8183490a38303c7`
  (**verificar contra los `.sha1`/`.sha2` publicados antes de usarlos**: no logré descargarlos, dan 404.)
- `ds:KeyInfo` debe contener **al menos el certificado firmante en base64, y esa información va firmada**.
- `xades:SignerRole/ClaimedRole`, si se usa, con **uno** de: `supplier`/`emisor`, `customer`/`receptor`,
  `third party`/`tercero`.
- **Versión de XAdES: cuidado.** La política v3.1 se redacta sobre **XAdES 1.2.2**
  (`http://uri.etsi.org/01903/v1.2.2#`), pero FACe declara hacer **validación estricta contra
  XAdES 1.3.2** (ETSI TS 101 903 v1.3.2). En la práctica las implementaciones usan el namespace
  `http://uri.etsi.org/01903/v1.3.2#`. **Confirmar contra el entorno de pruebas antes de dar por buena
  una firma.**

### ¿Qué certificado? — la respuesta importa y es buena

El apartado 4 de la política dice, literal:

> «Se consideran válidos para ejecutar la firma conforme a la presente política, todos aquellos
> certificados que cumplan con lo indicado en los apartados a) ó c) del artículo 18 del Reglamento por el
> que se regulan las obligaciones de facturación y que está recogido en el R. D. 1496/2003.»

**No exige certificado de persona jurídica ni sello de empresa.** Exige un certificado válido para firma
electrónica avanzada. Si el emisor de la factura es **el propio autónomo**, su **certificado FNMT de
persona física sirve** — es exactamente la misma conclusión a la que llegamos en Verifactu (el preentorno
de la AEAT se usa con certificado real de persona física).

**Pero hay dos certificados distintos en juego, y conviene no mezclarlos:**

1. **El que firma la factura** (XAdES dentro del `.xsig`): el del emisor. FNMT persona física del dueño → vale.
2. **El que autentica el webservice contra FACe**: FACe obliga a **dar de alta previamente** el certificado
   con el que se firmarán las comunicaciones del webservice, en el portal de proveedores. Si Bamburu envía
   por cuenta de sus clientes, ese es el certificado **de Bamburu**, no el del cliente. (Por el portal web
   no hace falta alta: basta un certificado electrónico para presentar.)

> **RD 1496/2003 está derogado** (lo sustituyó el RD 1619/2012). La política no se ha actualizado. La
> remisión hay que leerla hoy contra el art. 10 del RD 1619/2012. No cambia la conclusión práctica, pero
> conviene saberlo antes de citar la norma ante nadie.

---

## 5. Envío a FACe

- **Formato del fichero: `.xsig`** (el XML Facturae firmado). El manual de proveedores es explícito:
  *«La extensión del archivo de la factura ha de ser del tipo .xsig, de otra manera la aplicación devolverá
  un error al subir el archivo. Además la estructura, tiene que ser la de facturae 3.2».*
- **Webservice SOAP.** WSDL descargado **en vivo** (ambos responden 200 y exponen las mismas operaciones):
  - Producción: `https://webservice.face.gob.es/facturasspp?wsdl`
  - **Pruebas (staging)**: `https://se-face-webservice.redsara.es/facturasspp?wsdl`
  - Operaciones: `enviarFactura` · `consultarFactura` · `anularFactura` · `consultarEstados` ·
    `consultarUnidades` · `consultarNIFs` · `consultarAdministraciones` ·
    `consultarUnidadesPorAdministracion` · `consultarNIFsPorAdministracion` · `consultarListadoFacturas`
  - `enviarFactura` lleva `factura` (fichero `nombre` + `mime` + contenido), `correo` y `anexos` (array).
- **Portal web** alternativo: `https://face.gob.es`. No requiere alta previa; sí certificado.
- **DIR3 obligatorio.** Dentro del `.xsig`, en `BuyerParty/AdministrativeCentres`, con tres centros
  obligatorios (el manual los tabula así):

  | Rol | `RoleTypeCode` | Significado | Obligatorio |
  |---|---|---|---|
  | Fiscal | `01` | Oficina Contable | Sí |
  | Receptor | `02` | Órgano Gestor | Sí |
  | Pagador | `03` | Unidad Tramitadora | Sí |
  | Comprador | `04` | Órgano proponente | No |

  El `CentreCode` es el código de la unidad en el **Directorio Común DIR3**. Bamburu **no guarda nada de
  esto** y no puede inventarlo: lo tiene que aportar el cliente de la Administración.

### El umbral de 5.000 € — verificado en el BOE, y matizado

Texto consolidado de la **Ley 25/2013, art. 4** (`BOE-A-2013-13722`), literal:

> «1. Todos los proveedores que hayan entregado bienes o prestado servicios a la Administración Pública
> **podrán** expedir y remitir factura electrónica. En todo caso, **estarán obligadas** al uso de la factura
> electrónica […] las entidades siguientes: a) Sociedades anónimas; b) Sociedades de responsabilidad
> limitada; c) Personas jurídicas y entidades sin personalidad jurídica que carezcan de nacionalidad
> española; d) Establecimientos permanentes y sucursales de entidades no residentes […]; e) Uniones
> temporales de empresas; f) Agrupación de interés económico […]»
>
> «No obstante, las Administraciones Públicas **podrán excluir reglamentariamente** de esta obligación […]
> a las facturas cuyo importe sea de **hasta 5.000 euros** […]»

Dos cosas que corrigen el planteamiento del encargo:

1. **El umbral de 5.000 € sigue vigente, pero no es lo que suele contarse.** No es una exención
   automática ni un mínimo para poder facturar electrónicamente: es una **facultad** de cada Administración
   para excluir por reglamento. Hay que mirar administración por administración. Y quien quiera enviar
   electrónicamente por debajo de ese importe, **puede** (apartado 1: «podrán»).
2. **Un autónomo (persona física) NO está en la lista de obligados a)–f).** Los obligados son sociedades y
   entes. Para el público objetivo de Bamburu (CANON: *autónomos de servicios*), la factura electrónica a
   la Administración es un **derecho, no un deber** — salvo que la Administración concreta lo exija.
   Entra en vigor el 15-01-2015 (disp. final octava), eso sí es correcto.

   **Esto no quita valor a construir Facturae** (un autónomo que factura al Ayuntamiento lo necesita
   igual, y muchas administraciones exigen FACe por pliego), pero sí cambia el argumento: no es
   "obligatorio para nuestros clientes", es "imprescindible para el que factura a la Administración".

### Y el contexto que sí obliga: RD 238/2026 (B2B)

Verificado en el BOE (`BOE-A-2026-7295`, «BOE» núm. 79 de **31/03/2026**, en vigor **20/04/2026**):

- Desarrolla la factura electrónica **obligatoria entre empresarios y profesionales** (Ley 18/2022).
- Sintaxis admitidas para plataformas privadas: **a) CII · b) UBL · c) EDIFACT · d) Mensaje Facturae**,
  todas ajustadas al modelo semántico **EN16931**. Facturae entra *«dado su amplio grado de conocimiento en
  la economía española por su consolidado uso en la facturación a las administraciones públicas»*.
- **Pero la sintaxis de referencia de la solución pública es UBL.** Y, literal: quien no use la solución
  pública para emitir *«estará obligado a remitir simultáneamente a su emisión una copia electrónica fiel
  de cada factura en la sintaxis UBL […] a la solución pública»*.
- Los plazos (12 meses si factura > 8 M€, 24 meses el resto) **no han empezado a correr**: arrancan con la
  publicación de la **orden ministerial** que desarrolle la solución pública.

**Implicación estratégica, no técnica:** construir el motor Facturae cubre B2G (FACe) y una de las cuatro
sintaxis B2B, pero **no** cubre por sí solo la obligación de la copia UBL a la solución pública. Conviene
que el diseño interno separe **modelo de factura → serializador**, para que UBL sea otro serializador y no
otro proyecto.

---

## 6. ¿On-demand como el PDF, o hay que congelar algo como en Verifactu?

**El XML se genera on-demand. La firma, no.**

- Facturae **no tiene encadenamiento de huellas**. No hay un `prev_hash` que dependa del instante de
  emisión. Nada obliga a calcular nada *en el momento de emitir*, al contrario que Verifactu.
- Todo el contenido del XML se deriva de datos ya guardados. Y Bamburu ya hace lo correcto: `invoices`
  guarda **snapshot** de `company_name`, `company_fiscal_id`, `company_address`, `client_name`,
  `client_fiscal_id`, `client_address`. Regenerar el XML años después da el mismo contenido aunque el
  cliente haya cambiado de razón social.
- **Salvedad importante:** los campos que faltan (código postal, municipio, provincia) tendrían que
  guardarse **también como snapshot en `invoices`**, no leerse de `clients` al vuelo. Si se leen de
  `clients`, el Facturae regenerado en 2028 llevará la dirección de 2028 sobre una factura de 2026, y eso
  es falsear un documento con valor legal. Ese es el error a evitar en el diseño.
- **Lo que sí hay que persistir es el `.xsig` firmado**, byte a byte, en cuanto se firma:
  - `xades:SigningTime` es un instante; la firma **no es reproducible** al regenerar.
  - El registro de FACe se hace sobre **esos bytes exactos**; el número de registro devuelto se refiere a
    ellos.
  - Conclusión: el XML es derivado (como el PDF); **el `.xsig` es un artefacto, y va archivado** —
    junto con el número de registro de FACe y el estado. Hay sitio natural: `attachments.js`
    (`kind='facturae_xsig'`), que ya guarda ficheros por tenant en `data/uploads/<slug>/`.

---

## 7. Qué se puede construir YA, y qué queda bloqueado

### Se puede construir hoy, entero y probado (sin certificado)

1. **Serializador Facturae 3.2.2** a partir del modelo de factura de Bamburu.
   *Ya está demostrado:* un prototipo desechable generó el XML de la factura real `F2026-0005`
   (3 líneas, **3 tipos de IVA distintos**, IRPF del 15 %) y **`xmllint --schema Facturaev3_2_2.xsd`
   lo da por válido**.
2. **Validación contra el XSD oficial** en los tests (cachear el XSD + `xmldsig-core-schema.xsd`).
3. **Tests de aritmética**, que es donde el XSD no protege: `InvoiceTotal` vs `TotalExecutableAmount`
   (§3.5), desglose multi-tipo, `TotalTaxesWithheld` con IRPF, cuadre de `Batch` con `Invoices`.
4. **Migración aditiva** de los huecos de esquema (§3.2), con el patrón `addCol` de siempre:
   `postal_code`, `province`, `person_type` (F/J), `residence_type` (R/U/E) en `clients` y en
   `company_config`; los mismos **como snapshot en `invoices`**; y `dir3_oficina_contable`,
   `dir3_organo_gestor`, `dir3_unidad_tramitadora` en `clients` (solo para clientes AAPP).
5. **Persistir `tipo_factura`** en `invoices` (hoy es transitorio, §3.4). Barato y arregla un hueco que
   también afecta a Verifactu.
6. **Tabla de traducción** `payment_method` (texto libre) → `PaymentMeans` (01/02/04/19…).
7. **Decidir y documentar** el mapeo R1–R5 → `ReasonCode` + `CorrectionMethod`. No hay tabla oficial;
   es una decisión del producto y debe quedar escrita.
8. **Firma XAdES-EPES contra un certificado autofirmado de pruebas.** La firma se puede implementar y
   verificar entera (estructura, `SignaturePolicyIdentifier`, `SigningCertificate`, canonicalización,
   enveloped) sin el FNMT. Lo único que un autofirmado no da es que FACe lo acepte.

### Bloqueado hasta que el dueño aporte el certificado FNMT

- **Firma con validez legal** (el `.xsig` real). Certificado: **FNMT de persona física del dueño sirve**
  para firmar sus propias facturas (§4). *Esto es una buena noticia: no hace falta certificado de persona
  jurídica ni sello de empresa.*
- **Alta del certificado en el portal de proveedores de FACe** para poder usar el webservice.
- **Envío real a FACe**, incluso contra staging (`se-face-webservice.redsara.es`): FACe valida la firma
  y la cadena de confianza; un autofirmado se rechaza.

### Bloqueado por falta de DATOS, no de certificado (y esto no lo desbloquea nadie desde fuera)

- **72/72 facturas sin NIF de cliente y sin direcciones** (§3.3). Ninguna de ellas puede convertirse en un
  Facturae válido, ni hoy ni con certificado. La UI tiene que empezar a pedir esos datos **antes** de que
  el motor sirva de algo. Es la dependencia más dura de todo el encargo, y no es técnica.
- **DIR3**: lo aporta el cliente de la Administración. Sin los tres códigos, FACe rechaza.

---

## 8. Fuentes (todas consultadas, no citadas de memoria)

- Última versión y XSD: https://www.facturae.gob.es/formato/ultima-version
- **XSD 3.2.2** (descargado y parseado): https://www.facturae.gob.es/content/dam/facturae/formato/versiones/Facturaev3_2_2.xml
- Publicación de la 3.2.2 en BOE: https://www.boe.es/diario_boe/txt.php?id=BOE-A-2017-9982
- Políticas de firma: https://www.facturae.gob.es/formato/Paginas/politicas-firma-electronica.aspx
- **Política de firma v3.1** (PDF descargado, texto extraído): https://www.facturae.gob.es/politica_de_firma_formato_facturae/politica_de_firma_formato_facturae_v3_1.pdf
- Manual de proveedores de FACe v1.2 (PDF descargado): https://administracionelectronica.gob.es/pae_Home/dam/jcr:41ab5850-9e1f-46b3-899e-c07458da1d46/FACe-Manual_de_Proveedores_1_2.pdf
- **WSDL de FACe** (descargado en vivo, prod y staging): https://webservice.face.gob.es/facturasspp?wsdl · https://se-face-webservice.redsara.es/facturasspp?wsdl
- Ley 25/2013, texto consolidado: https://www.boe.es/buscar/act.php?id=BOE-A-2013-13722
- **RD 238/2026** (B2B), texto consolidado: https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295
- Integración y recomendaciones de uso en FACe: https://administracionelectronica.gob.es/PAe/FACE/recomendaciontecnica

## 9. Sin confirmar (verificar al construir)

- **La afirmación de que FACe valida contra XAdES 1.3.2** procede de la página "Integración y
  recomendaciones de uso en FACe", que está **protegida por WAF** y no pude leer directamente: la obtuve
  del índice del buscador. Es coherente con la práctica del sector, pero **no la he leído en la fuente**.
  Hay que confirmarlo antes de fijar el namespace de XAdES.
- **Huellas publicadas de la política de firma** (`.sha1`/`.sha2`): los enlaces que probé dan 404. Las
  huellas de §4 son las del fichero que yo descargué. Hay que cuadrarlas con las oficiales.
- **Límites de tamaño** de factura y anexos en FACe: no aparecen en el manual de proveedores v1.2 y no
  encontré fuente oficial. Sin verificar.
- **Peppol BIS / FACeB2B**: el RD 238/2026 dice que FACeB2B será sustituido por la solución pública. No he
  investigado el calendario ni la interoperabilidad Peppol.
- **Tabla de equivalencia R1–R5 → `ReasonCode`**: he confirmado que **no existe** de forma oficial en el
  XSD ni en el manual de FACe. Si existe en alguna guía de la AEAT, no la he encontrado.
- No he validado ninguna firma real contra el validador de FACe (requiere certificado).
