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

## Configuración (en `/etc/bamburu.env`, fuera del repo)
| Variable | Qué es | Estado |
|---|---|---|
| `VERIFACTU_CERT_PATH` | Ruta al `.p12`/`.pfx` del **FNMT** (persona física del dueño) | **falta** (lo aporta el dueño) |
| `VERIFACTU_CERT_PASS` | Contraseña del `.p12` | **falta** |
| `VERIFACTU_PRODUCTOR_NOMBRE` | NombreRazón del productor del software (SistemaInformatico) | **falta** (se rellena con el cert) |
| `VERIFACTU_PRODUCTOR_NIF` | NIF del productor del software | **falta** |
| `VERIFACTU_ID_SIF` | IdSistemaInformatico (2 pos.) — por defecto `BM` | opcional |
| `VERIFACTU_NOMBRE_SIF` | NombreSistemaInformatico — por defecto `Bamburu` | opcional |
| `VERIFACTU_VERSION_SIF` | Version — por defecto `1.0` | opcional |
| `VERIFACTU_NUM_INSTALACION` | NumeroInstalacion — por defecto `1` | opcional |

Sin certificado, el motor funciona contra simulador y el envío real **avisa y no rompe**.

## Disparar el envío REAL (paso de cierre, cuando exista el certificado)
```
node scripts/verifactu-enviar-preproduccion.mjs desarrollo-bamburu        # todos los altas pendientes
node scripts/verifactu-enviar-preproduccion.mjs desarrollo-bamburu 12     # solo el registro 12
```
Criterio de éxito #1: un RegistroAlta llega a preproducción y vuelve respuesta parseada y guardada.

## Defaults documentados del RegistroAlta (derivados, no inventados)
- `CalificacionOperacion` = `S1` (sujeta y no exenta) · `ClaveRegimen` = `01` (general) · `Impuesto` = `01` (IVA).
- Desglose por tipo desde `invoice_items` (`tax_rate`/`tax_amount`), con fallback de cabecera (legacy).
- `Destinatarios` = NIF + nombre del cliente en F1/F3/R*; ausente en F2 (simplificada).
- `DescripcionOperacion` = concepto de la 1ª línea (o nombre del documento).
- Falta de NIF en F1, desglose que no cuadra con los importes congelados, o productor sin configurar
  → `bloqueado_datos` con AVISO (no se envía).

## Fase B (legal) — PENDIENTE, fuera de esta tarea
- Colaboración social (Convenio tipo 17), declaración responsable (art. 13 RD 1007/2023), y la elección
  de certificado (propio-por-todos vs. por-cliente con modelo del Anexo II). Ver
  `tarea2-remision-aeat-investigacion.md` §Certificados y multi-tenant.
- Ampliaciones técnicas anotadas: envío de **anulaciones** (hoy solo altas), **cola + timer por tenant**
  (control de flujo `TiempoEsperaEnvio`), y validación directa contra los XSD descargados.
