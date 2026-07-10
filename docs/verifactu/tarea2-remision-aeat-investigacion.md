# Verifactu · Tarea 2 — Investigación técnica de la remisión a la AEAT (2026-07-04)

> Investigación previa a construir (regla de la nota de pausa: especificaciones verificadas en la web
> oficial, no de memoria). Fuentes oficiales: sede AEAT, portal de desarrolladores, WSDL/XSD oficiales,
> PDF "Veri-Factu_Descripcion_SWeb.pdf" v1.0.3 (101 págs.) y FAQ de desarrolladores (04-12-2025).
> Estado verificado a julio de 2026.

## Lo esencial para construir la Fase A

- **Protocolo:** SOAP 1.1 document/literal, HTTPS con **mTLS** (certificado cualificado en transporte).
  El XML NO se firma en modalidad Veri*factu. UTF-8. Respuesta síncrona. Un solo mensaje
  `RegFactuSistemaFacturacion` para altas y anulaciones (1..1000 `RegistroFactura` por envío).
- **Endpoints (del WSDL oficial `SistemaFacturacion.wsdl`):**
  - Producción: `https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
  - Producción (certificado de sello): `https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
  - **Pruebas:** `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
  - Pruebas (sello): `https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
- **WSDL/XSD oficiales:** `https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/`
  (SistemaFacturacion.wsdl, SuministroLR.xsd, SuministroInformacion.xsd, RespuestaSuministro.xsd,
  ConsultaLR.xsd, EventosSIF.xsd…). OJO: los **namespaces** del XML son los canónicos
  `https://www2.agenciatributaria.gob.es/static_files/.../tike/cont/ws/SuministroLR.xsd` (sin "V1.0");
  no cambian según el entorno.
- **Mensaje:** `Cabecera` (`ObligadoEmision` NombreRazon+NIF; `Representante` opcional; `RemisionVoluntaria`
  con `FechaFinVeriFactu`/`Incidencia`) + N `RegistroFactura` (cada uno `RegistroAlta` o `RegistroAnulacion`).
- **RegistroAlta** (obligatorios, en orden): IDVersion="1.0" · IDFactura (IDEmisorFactura NIF + NumSerieFactura +
  FechaExpedicionFactura **dd-mm-aaaa**; terna = clave única) · NombreRazonEmisor · TipoFactura (F1/F2/F3/R1–R5) ·
  DescripcionOperacion · Desglose (1–12 DetalleDesglose: Impuesto 01=IVA, ClaveRegimen, CalificacionOperacion
  S1/S2/N1/N2 u OperacionExenta, TipoImpositivo, BaseImponibleOimporteNoSujeto, CuotaRepercutida) · CuotaTotal ·
  ImporteTotal · Encadenamiento (PrimerRegistro="S" o RegistroAnterior con la huella n-1) · SistemaInformatico ·
  FechaHoraHusoGenRegistro (ISO-8601 con huso) · TipoHuella=01 (SHA-256) · Huella. Opcionales clave: Subsanacion,
  RechazoPrevio, TipoRectificativa + FacturasRectificadas/Sustituidas + ImporteRectificacion, Destinatarios
  (obligatorio de facto salvo F2), EmitidaPorTerceroODestinatario.
- **SistemaInformatico** (en cada registro): NombreRazon+NIF del PRODUCTOR del software ·
  NombreSistemaInformatico · IdSistemaInformatico (2 posiciones, lo asigna el productor) · Version ·
  NumeroInstalacion (única por instalación/instancia) · TipoUsoPosibleSoloVerifactu S/N ·
  TipoUsoPosibleMultiOT S/N · IndicadorMultiplesOT S/N. SaaS multi-tenant típico: MultiOT=S, IndicadorMultiplesOT=S.
- **Control de flujo (art. 16.2 Orden HAC/1177/2024):** t inicial = 60 s; cada respuesta devuelve
  `<sf:TiempoEsperaEnvio>` actualizado. Siguiente envío cuando pasen t segundos O se acumulen 1.000 registros.
  **Un envío = UN obligado** (una sola Cabecera) → multi-tenant = una cola + un timer POR TENANT.
- **Respuestas** (RespuestaSuministro.xsd): EstadoEnvio Correcto/ParcialmenteCorrecto/Incorrecto; por registro
  Correcto / AceptadoConErrores (registrado, subsanar con alta Subsanacion=S) / Incorrecto (rechazado; corregir y
  reenviar con Subsanacion=S y RechazoPrevio si toca) + CodigoErrorRegistro + CSV del envío. XML inválido → SoapFault
  (reenviar tal cual; IDFactura protege de duplicados). AEAT caída → encolar con flag Incidencia.

## Certificados y multi-tenant (Fase B, legal)

> **✅ Elegido el 2026-07-10:** de las vías que investiga esta sección, Bamburu va con la de **colaborador
> social** (Convenio tipo 17, un único certificado propio + Anexo II por cliente). Ver
> `../contexto/decisiones.md`.

- Puede remitir: el obligado, su apoderado o un **colaborador social** — cualquiera con certificado
  cualificado. **Vía diseñada para SaaS: colaboración social, Convenio tipo 17** (empresas de software
  Veri*factu; también valen 001/002). Bamburu firmaría el convenio y enviaría TODO con su propio certificado.
- Cada cliente otorga la representación con el **modelo del Anexo II** (Resolución 18-12-2024, BOE 31-12-2024).
  La AEAT admite capturarlo por **formulario/pop-up dentro del propio SaaS** al alta; se conserva y solo se
  exhibe ante requerimiento. (FAQ desarrolladores §16.)
- **No hay registro del software ante la AEAT** (no es TicketBAI): el cumplimiento se acredita con la
  **declaración responsable** (art. 13 RD 1007/2023 + art. 12 y anexo Orden HAC/1177/2024) por producto y
  versión, incorporada al propio SIF y visible al usuario. IdSistemaInformatico/Version/NumeroInstalacion
  deben ser coherentes con ella.

## Entorno de pruebas — DESBLOQUEO de la nota de pausa

- Portal de Pruebas Externas: https://preportal.aeat.es (sección VERI*FACTU) + cliente web genérico para
  lanzar XML a mano.
- **NO existen "certificados de prueba" de la AEAT: el preentorno se usa con un certificado cualificado REAL**
  (autentica contra censo real; los envíos no tienen efectos tributarios). Es decir: el certificado FNMT de
  persona física del propio Ibrahin (autónomo) bastaría para arrancar la Fase A contra prewww1.

## Calendario legal (confirmado a jul-2026)

- RDL 15/2025 (BOE 03-12-2025) aplazó un año el RD 254/2025: **Sociedades → antes del 01-01-2027;
  IRPF/autónomos → antes del 01-07-2027.** Hoy la remisión es voluntaria (con permanencia hasta fin de año
  natural si se activa; renuncia vía FechaFinVeriFactu). Desde 29-07-2025 solo se pueden comercializar SIF
  adaptados (obligación del productor, NO aplazada).

## Fuentes

- Índice técnico: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html
- Descripción del SW (v1.0.3): https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf
- FAQ desarrolladores: https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf
- WSDL: https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SistemaFacturacion.wsdl
- Validaciones y errores: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/documento-validaciones-errores.html
- Nota de aplazamiento: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/nota-informativa-ampliacion-plazo-adaptacion-facturacion.html
- Declaración responsable (ejemplo): https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/ejemplo-declaracion-responsable.html

## Sin confirmar (verificar al construir)

- Semántica exacta de los puertos "Sello" (www10/prewww10): inferida del naming + convención SII.
- Validar la implementación directamente contra los XSD descargados (los diagramas del PDF son imágenes).
- Lista completa de códigos de error (documento enlazado, no volcado aquí).
