# Clasificación fiscal por línea (Saneamiento 4)

Fuente técnica de verdad: `core/fiscal-classification.js`. La tasa de IVA y la naturaleza jurídica
son datos independientes: un 0 % puede ser `S1`; una exención exige `E1`–`E6`; una no sujeción exige
`N1` o `N2`; la inversión del sujeto pasivo se traduce a `S2`.

Cada línea nueva conserva un snapshot aditivo (`fiscal_treatment`, causas, inversión y texto legal).
Productos históricos con tasa positiva conservan su conducta sujeta/no exenta. Los de tasa cero y
todas las líneas históricas quedan `pending`: no se les atribuye retrospectivamente una causa legal,
no se modifican facturas, huellas ni registros VERI*FACTU existentes.

La emisión valida antes de abrir la transacción. Un pendiente bloquea la emisión con un mensaje
corregible; el borrador permanece. Catálogo, documentos previos, factura, VERI*FACTU, Facturae,
PDF, contabilidad y LSI consumen la misma clasificación congelada. Cada formato tiene adaptador
propio: no se copian claves AEAT dentro de Facturae.

Servicios sanitarios: Bamburu no presume la exención por oficio, nombre o tasa. El responsable
humano confirma que concurren la condición profesional y la finalidad sanitaria real, y selecciona
la causa aplicable. DISA solo puede dejar una propuesta pendiente.

Fuentes oficiales contrastadas el 27-08-2026:

- AEAT, descripción de los servicios web VERI*FACTU v1.0.3 y XSD de Suministro de Información.
- AEAT, formato electrónico común de libros registro (LSI) e instrucciones vigentes.
- Portal oficial Facturae, esquema y descripción de campos 3.2.2.

Limitación histórica deliberada: las facturas emitidas antes de este saneamiento no se reclasifican.
Sus salidas que necesiten una causa explícita se bloquean en vez de caer silenciosamente en `S1` o
inventar `E1`.
