# Estado del certificado digital — verificado el 2026-07-10

> Registro de hechos. Se escribió para que el dueño decidiera con datos delante — y **ese mismo día
> decidió**: ver §"La decisión" al final, y `../contexto/decisiones.md`.
> Todo lo de aquí se comprobó **en la máquina** ese día (BD, `/etc/bamburu.env`, systemd, disco),
> no se copió de otro documento. El envío en sí está contado en `tarea2-fase-a-envio.md`.

## Qué se hizo el 2026-07-09

Se remitieron **dos registros reales** a la **preproducción** de la AEAT
(`prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`), negocio `ibrahin-repuestos`,
obligado `13334347M`. Constan en `verifactu_envios` de su BD, con el sobre y la respuesta guardados:

| # | Serie | Generado | Sellado por la AEAT | Estado | CSV |
|---|-------|----------|---------------------|--------|-----|
| 1 | `S2026-0001` | 19:10:25 +02:00 | 19:16:41 +02:00 | `AceptadoConErrores` · error **2004** | `A-FA5DXLJ5HSC2ZU` |
| 2 | `S2026-0002` | 19:28:04 +02:00 | 19:28:04 +02:00 | **`Correcto`** | `A-5LE89B7EUFZ7ER` |

El #1 tardó **376 s** entre generarse y llegar: por encima del margen de 240 s de
`FechaHoraHusoGenRegistro`. Ese es el hallazgo que obligó a construir la cola, y se ve en los datos.
El #2 encadenó contra el #1 (`RegistroAnterior` con su huella) y salió limpio: la cadena real, contra
un registro que la Agencia ya tenía guardado, funciona.

**Después del envío se borró el `.p12` del servidor.** Es lo que mandaba la regla de la Fase A (la
contraseña se teclea sin eco, nada de identidad digital en disco), así que su ausencia es la política
cumpliéndose, no un descuido. Conviene dejarlo escrito porque el estado "no hay certificado" se lee
igual desde fuera tanto si fue deliberado como si se olvidó.

## Estado a día de hoy (2026-07-10)

- **No hay ningún certificado en el servidor.** Barrido de `*.p12 *.pfx *.pem *.key *.crt` por
  `/home/ubuntu`: cero resultados.
- **`/etc/bamburu.env`** (permisos `600 ubuntu:ubuntu`) tiene `VERIFACTU_PRODUCTOR_NOMBRE` y
  `VERIFACTU_PRODUCTOR_NIF`, y **ninguna** variable `VERIFACTU_CERT_*`.
- Por tanto `motivoColaInactiva` (`modules/erp/verifactu-cola.js:72`) **apaga la cola en los 6
  negocios**. El comportamiento vivo es el de siempre: botón manual en `/admin/verifactu/envios`, o
  `scripts/verifactu-enviar-preproduccion.mjs`. Nada quedó atascado esperando: los 2 registros de
  `ibrahin-repuestos` tienen su fila de envío, ninguno pendiente.
- **El timer de la cola NO está instalado**, y esto es independiente del certificado.
  `deploy/systemd/bamburu-verifactu-cola.{service,timer}` existen en el repo, pero systemd solo
  conoce `bamburu.service`, `bamburu-avisos.*`, `bamburu-backup.*` y `bamburu-backup-heartbeat.*`.
  Instalarlo es inocuo: sin certificado el barrido no hace nada.
- **El código multi-tenant del certificado sí está completo** (se auditó, no se supuso):
  `certPathForTenant` (`verifactu-envio.js:101`) resuelve `VERIFACTU_CERT_DIR/<slug>.p12|.pfx` con
  caída al `VERIFACTU_CERT_PATH` global, y `certPassForTenant` (:114) distingue contraseña *sin
  definir* de contraseña *vacía*.

## Cabos sueltos que el certificado deja a la vista

- **El 2004 de `S2026-0001` sigue sin subsanar** (alta con `Subsanacion=S`). Es preproducción, así que
  no tiene consecuencia legal, pero está ahí.
- **`company_config.fiscal_id` vacío** en `duniya`, `rachibra` e `inversiones-disan` (consultadas hoy).
  Hoy es teórico — sin certificado su cola no arranca —, pero el día que alguno tenga certificado su
  Cabecera saldría con `ObligadoEmision` vacío. `ibrahin-repuestos` y `helados-ibrahin` van con
  `13334347M`; `desarrollo-bamburu` con `89890001K`.
- **Facturae no firma.** `modules/erp/facturae/` genera el XML (`modelo.js`, `facturae322.js`,
  `iso-paises.js`) pero no hay XAdES-EPES ni ninguna dependencia de firma en `package.json`. Y son
  **dos certificados distintos**: el que firma la factura (el FNMT de persona física del dueño sirve)
  y el que autentica el webservice de FACe, que hay que dar de alta en su portal de proveedores.

## La decisión — TOMADA el 2026-07-10

La disyuntiva que planteaba este documento (dejar el `.p12` personal del dueño en el servidor para
activar el automático, o seguir en manual) **queda superada**: no se va a resolver, se cambia de
modelo. Verifactu para los clientes se hará como **colaborador social**, con **un único certificado de
Bamburu** que remite por todos los negocios y una **autorización de representación** firmada por cada
dueño dentro de la plataforma. Ningún cliente instala certificado. Decisión completa, con lo
descartado, en `../contexto/decisiones.md`; la tarea, entera y sin trocear, en `TABLERO.md`.

Consecuencias para lo que cuenta este documento:

- **La cola del 9-jul es una prueba de concepto**, no el producto. Demostró que la tubería llega a la
  AEAT de punta a punta con el certificado personal del dueño. El motor se reutiliza tal cual: solo
  cambia el certificado firmante y se añade el flujo de autorización.
- **No hay que activar nada con el `.p12` personal.** El certificado siguió y sigue fuera del servidor,
  y la postura de seguridad de la Fase A no se toca. El envío manual queda como está.
- **Sigue habiendo prisa cero.** El envío es voluntario hasta la obligación general del **1 ene 2027**,
  y el alta como colaborador social es un trámite legal y externo que solo puede iniciar el dueño,
  cuando la plataforma esté al 100 %.

Lo que se puede hacer en cualquier momento, sin depender de nada de lo anterior: **subsanar el 2004**.
Instalar el timer de la cola es inocuo (sin certificado no hace nada), pero ya no es un paso previo a
activar: la activación real vendrá con el certificado de Bamburu.
