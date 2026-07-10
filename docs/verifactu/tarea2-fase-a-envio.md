# Verifactu · Tarea 2 (Fase A) — Envío a la AEAT (entorno de PRUEBAS)

> Implementación de la remisión SOAP de los registros de facturación (huella congelada por la Tarea 1)
> al entorno de **preproducción** de la AEAT. Construido y probado contra un **simulador local**; el
> envío real se dispara con un comando en cuanto exista el certificado. Endpoints/XSD verificados
> contra el WSDL oficial en vivo (2026-07-05).

## Qué hace
- Reconstruye el `RegistroAlta` (SOAP `RegFactuSistemaFacturacion`) desde `verifactu_registros`
  (huella, `FechaHoraHusoGenRegistro`, `CuotaTotal`, `ImporteTotal` **exactos, congelados**) + la
  factura + `invoice_items` (desglose por tipo de IVA). **No toca la huella/QR/encadenado (Tarea 1).**
- Envía por **SOAP 1.1 con mTLS** (el XML no se firma en modalidad Veri*factu) y guarda la respuesta
  de la AEAT por documento: estado, CSV, código/descripción de error, `TiempoEsperaEnvio`, XML enviado
  y respuesta cruda. **Idempotente**: no reenvía lo ya aceptado.
- Lo que no se puede determinar con certeza → **AVISO**, nunca inventado (estado `bloqueado_datos`).

## Piezas
- `modules/erp/verifactu-envio.js` — config, certificado, XML (`buildRegistroAlta`/`buildEnvelope`),
  cliente SOAP (`sendSoap`), parser (`parseRespuesta`), orquestación idempotente (`enviarRegistro`).
- `modules/erp/models.js` — tabla aditiva `verifactu_envios` (estado de envío 1:1 por registro).
- `modules/erp/routes/verifactu-envio-routes.js` — pantalla consultable `/admin/verifactu/envios`
  + acción "Enviar a pruebas" (permiso `invoices.read` para ver, `invoices.create` para enviar).
- `scripts/verify-verifactu-t2.mjs` — gate contra simulador (camino feliz + error + idempotencia + bloqueo).
- `scripts/verifactu-enviar-preproduccion.mjs` — **envío real** (paso de cierre, ver abajo).

## Endpoints (WSDL oficial)
- Pruebas: `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
- Producción: `https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
- Namespaces canónicos (targetNamespace): `www2.agenciatributaria.gob.es/.../tike/cont/ws/SuministroLR.xsd`
  y `.../SuministroInformacion.xsd` (no cambian entre entornos).

## Configuración (fuera del repo)
| Variable | Qué es | Dónde vive |
|---|---|---|
| `VERIFACTU_CERT_PATH` | Ruta al `.p12`/`.pfx` del **FNMT** (persona física del dueño) | en el comando; el archivo, en `~/.secrets` con `chmod 600` |
| `VERIFACTU_CERT_PASS` | Contraseña del `.p12` | **en ningún fichero.** El script la pide por teclado **sin eco**; o se pasa en el entorno de ese único comando |
| `VERIFACTU_PRODUCTOR_NOMBRE` | NombreRazón del productor del software (SistemaInformatico) | `/etc/bamburu.env` (no es secreto) |
| `VERIFACTU_PRODUCTOR_NIF` | NIF del productor del software | `/etc/bamburu.env` (no es secreto) |
| `VERIFACTU_ID_SIF` | IdSistemaInformatico (2 pos.) — por defecto `BM` | opcional |
| `VERIFACTU_NOMBRE_SIF` | NombreSistemaInformatico — por defecto `Bamburu` | opcional |
| `VERIFACTU_VERSION_SIF` | Version — por defecto `1.0` | opcional |
| `VERIFACTU_NUM_INSTALACION` | NumeroInstalacion — por defecto `1` | opcional |

Sin certificado, el motor funciona contra simulador y el envío real **avisa y no rompe**. Sin
`VERIFACTU_PRODUCTOR_*`, el script **para en seco**: el motor marcaría cada registro como
`bloqueado_datos` y no saldría ni una petición (antes solo avisaba, y el aviso engañaba).

**El `.p12` nunca entra al repo** (`.gitignore` cubre `*.p12 *.pfx *.pem *.key *.jks *.crt`).

### El `.p12` del Llavero de macOS no lo abre Node
Exportado desde macOS, el `.p12` cifra los certificados con `pbeWithSHA1And40BitRC2-CBC`. OpenSSL 3
movió RC2 al proveedor *legacy*, que no se carga por defecto → Node falla con
`Unsupported PKCS12 PFX data` **antes de tocar la red**. Se reconvierte a PKCS#12 moderno (la clave
privada nunca toca el disco: viaja por la tubería):

```bash
cd ~/.secrets && umask 077
read -rsp 'Contraseña del .p12: ' P12PASS; echo; export P12PASS
openssl pkcs12 -legacy -in verifactu.p12 -passin env:P12PASS -nodes \
  | openssl pkcs12 -export -out verifactu-node.p12 -passout env:P12PASS \
      -keypbe aes-256-cbc -certpbe aes-256-cbc -macalg sha256
unset P12PASS; chmod 600 verifactu-node.p12
```

Se descarta el flag `node --openssl-legacy-provider`: habría que ponerlo también en
`bamburu.service` (la pantalla `/admin/verifactu/envios` también envía) y reactivaría RC2/RC4/DES
en todo el proceso de producción.

## Disparar el envío REAL
```
node scripts/verifactu-enviar-preproduccion.mjs <slug>        # todos los altas pendientes
node scripts/verifactu-enviar-preproduccion.mjs <slug> 12     # solo el registro 12
```
Criterio de éxito #1: un RegistroAlta llega a preproducción y vuelve respuesta parseada y guardada.

## ✅ ENVÍO REAL CONSEGUIDO (2026-07-09, preproducción `prewww1.aeat.es`)

Negocio `ibrahin-repuestos`, obligado `13334347M` (FNMT persona física del dueño), tickets F2 de 0,48 €.

| # | Registro | Cadena | Respuesta de la AEAT | CSV |
|---|---|---|---|---|
| 1 | `S2026-0001` | `PrimerRegistro=S` | `AceptadoConErrores` · error **2004** | `A-FA5DXLJ5HSC2ZU` |
| 2 | `S2026-0002` | `PrimerRegistro=N` + `RegistroAnterior`→#1 | **`Correcto`**, sin errores | `A-5LE89B7EUFZ7ER` |

La AEAT devuelve el obligado en su Cabecera → el certificado autentica y está autorizado. El
segundo envío valida el **encadenamiento real** contra un registro que la Agencia ya tenía.

### Tres muros por el camino (ninguno era el motor)
1. **`Unsupported PKCS12 PFX data`** — el `.p12` de macOS usa RC2-40 (arriba).
2. **`Codigo[4102] … Falta informar campo obligatorio.: Cabecera`** — `Cabecera` se declara LOCAL en
   `SuministroLR.xsd` (con `elementFormDefault="qualified"`), así que va en el namespace **`sfLR`**,
   no en `sf`, aunque su TIPO (`sf:CabeceraType`) venga del otro esquema. `Cabecera` ni siquiera
   existe en `SuministroInformacion.xsd`. Sus HIJOS sí son de `sf`. Corregido en `buildEnvelope`.
3. **`error 1239 … El NIF no está identificado en el censo de la AEAT`** — el destinatario de la
   factura de prueba era un NIF ficticio. En preproducción el censo es el REAL. Se rodeó con una
   **F2 (simplificada)**, que no lleva bloque `Destinatarios` (`minOccurs="0"` en el XSD).

### ⚠️ Hallazgo estructural: la ventana de 240 s
`FechaHoraHusoGenRegistro` va **dentro de la huella** → queda congelada al emitir. La AEAT exige que
esté a ±240 s de SU reloj **cuando recibe** (error 2004). Medido: 376 s de hueco → `AceptadoConErrores`;
0 s de hueco → `Correcto`. Reloj del servidor verificado contra la AEAT: **+1 s**, NTP sincronizado.

**Consecuencia:** cualquier remisión que ocurra más de ~4 minutos después de emitir devolverá SIEMPRE
`AceptadoConErrores`. La **cola + timer por tenant** deja de ser una mejora y pasa a ser un requisito
para remitir en verde. Va en su propio encargo.

### Validación contra los XSD oficiales
`xmllint --schema SuministroLR.xsd` sobre el sobre generado. Reproduce el 4102 con el namespace malo
y pasa con el bueno. Cierra el "sin confirmar" de `tarea2-remision-aeat-investigacion.md`.

## Defaults documentados del RegistroAlta (derivados, no inventados)
- `CalificacionOperacion` = `S1` (sujeta y no exenta) · `ClaveRegimen` = `01` (general) · `Impuesto` = `01` (IVA).
- Desglose por tipo desde `invoice_items` (`tax_rate`/`tax_amount`), con fallback de cabecera (legacy).
- `Destinatarios` = NIF + nombre del cliente en F1/F3/R*; ausente en F2 (simplificada).
- `DescripcionOperacion` = concepto de la 1ª línea (o nombre del documento).
- Falta de NIF en F1, desglose que no cuadra con los importes congelados, o productor sin configurar
  → `bloqueado_datos` con AVISO (no se envía).

## Fase B (legal) — el MODELO ya está decidido; queda el trámite
> **Ojo al leer esta página:** lo de aquí abajo se remitió con el **certificado personal del dueño**. Es una
> **prueba de concepto** — demostró que la tubería llega a la AEAT —, **no el producto**. Ver `estado-certificado.md`.

- **DECIDIDO el 2026-07-10: colaborador social**, con **un único certificado de Bamburu** para todos los
  negocios y una **autorización de representación** firmada por cada dueño dentro de la plataforma (el
  **modelo del Anexo II**, capturado por formulario en el propio SaaS). **Descartado:** que cada negocio
  aporte su propio certificado. Detalle y porqué en `../contexto/decisiones.md`.
- Queda **el trámite**: alta como envío autorizado (Convenio tipo 17) y declaración responsable (art. 13 RD
  1007/2023). Es legal y externo, **solo lo puede iniciar el dueño**. Contexto en
  `tarea2-remision-aeat-investigacion.md` §Certificados y multi-tenant.
- Ampliaciones técnicas anotadas: envío de **anulaciones** (hoy solo altas) · **cola + timer por
  tenant** (ya no opcional: sin ella, todo envío llega fuera de los 240 s → `AceptadoConErrores`) ·
  **subsanación** del 2004 con un alta `Subsanacion=S` · y el bug de `verifactu-envio.js:347`, que
  elige el registro anterior de la cadena por id **sin filtrar por emisor** (latente: `company_config`
  es singleton, un obligado por BD; solo mordería si un negocio cambiase de NIF con registros ya hechos).
- Validación contra los XSD descargados: **hecha** (ver arriba).
