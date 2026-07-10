# Estado del certificado digital — verificado el 2026-07-10

> Registro de hechos, no de decisiones. Se escribe para que el dueño decida con datos delante.
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

## La decisión abierta (la toma el dueño)

Activar el envío automático **exige** que el `.p12` viva permanentemente en el servidor y que su
contraseña esté escrita en `/etc/bamburu.env`. Eso es exactamente lo contrario de lo que se hizo el
día 9 a propósito. No es un trámite: es un cambio de postura de seguridad.

- **Seguir en manual** — el certificado solo existe mientras se usa, la contraseña se teclea sin eco,
  nada queda en disco. Coste: alguien tiene que pulsar el botón, y ahí muerde la ventana de 240 s.
- **Pasar a automático** — la cola agrupa y remite sola dentro de ventana. Coste: la identidad digital
  del dueño reside en el servidor a tiempo completo.

Mientras no se decida, hay dos cosas que se pueden hacer sin tocar la postura: **instalar el timer**
(inocuo sin certificado) y **subsanar el 2004**.
