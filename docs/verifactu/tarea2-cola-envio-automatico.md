# Verifactu · Cola de envío automático a la AEAT (por negocio)

> Encargo del dueño, a raíz del **hallazgo de los 240 s** de la Tarea 2 Fase A
> (`tarea2-fase-a-envio.md`). Aditivo y reversible. No toca la huella, el QR ni el encadenado
> (Tarea 1 sigue siendo inmutable). No envía anulaciones. No subsana el 2004.

## El problema

`FechaHoraHusoGenRegistro` va **dentro** de la huella, así que queda congelada al emitir la factura.
La AEAT exige que esa marca esté a **±240 s** de su reloj cuando recibe el registro; pasado ese
margen lo acepta, pero **con errores** (código 2004). Con el envío manual —un botón por documento—
cualquier factura que tardase más de cuatro minutos en remitirse quedaba mal registrada.

Medido contra preproducción el 2026-07-09 (negocio `ibrahin-repuestos`):

| Registro | Hueco huella → envío | Respuesta de la AEAT |
|---|---|---|
| `S2026-0001` | 376 s | `AceptadoConErrores` · error 2004 |
| `S2026-0002` | 0 s | **`Correcto`**, sin errores |

## Los dos relojes (por qué la cola AGRUPA en vez de mandar de una en una)

Hay un segundo reloj, y empuja en dirección contraria:

- **Ventana de la huella:** 240 s desde la emisión. Empuja a enviar **ya**.
- **Control de flujo** (art. 16.2 Orden HAC/1177/2024): entre envíos hay que esperar el
  `TiempoEsperaEnvio` que devolvió la AEAT (t inicial = **60 s**). Empuja a enviar **despacio**.
  Y **un envío = un obligado**: una sola `Cabecera` por sobre.

Un sobre por factura da un techo de **1 registro / 60 s**. En una ráfaga de mostrador, la sexta
factura llegaría fuera de ventana. Por eso cada vaciado manda **todo lo pendiente del negocio en UN
sobre** (1..1000 `RegistroFactura`, una Cabecera). Así:

- En calma, la factura sale **en segundos** (medido: ~1 s).
- En ráfaga, las siguientes salen **agrupadas dentro del minuto**, muy dentro de los 240 s.

`buildEnvelope` ya admitía varios registros; lo que faltaba era el orquestador (`enviarLote`).
`enviarRegistro` (el botón manual y el script de preproducción) ahora **delega en `enviarLote`** con
un lote de tamaño 1: un solo orquestador, imposible que el camino manual y el automático diverjan.

## Piezas

| Pieza | Ubicación |
|---|---|
| Cola (planificador, backoff, cerrojo) | `modules/erp/verifactu-cola.js` |
| Envío por lotes + certificado por negocio | `modules/erp/verifactu-envio.js` (`enviarLote`, `certPathForTenant`) |
| Enganche tras el commit de la emisión | `modules/erp/routes/invoices.js` (5 puntos: factura, ticket F2, sustitutiva F3, rectificativa, desde pedido) |
| Reloj del reintento | columna aditiva `verifactu_envios.next_retry_at` (`models.js`) |
| Aviso de lo que quedó en punto muerto | `modules/erp/avisos.js` (fuente `enviosVerifactu`) |
| Red de seguridad (systemd) | `scripts/bamburu-verifactu-cola.mjs` + `deploy/systemd/bamburu-verifactu-cola.{service,timer}` |
| Gate | `scripts/verify-verifactu-cola.mjs` (55/0) |

## Cómo funciona

1. Al **confirmar/emitir** una factura, su registro de alta se crea en la misma transacción (Tarea 1).
   Tras el **commit**, `encolarSiProcede` crea la fila de envío en `pendiente` con `next_retry_at=ahora`
   y arma el planificador. Va **junto a `postInvoice`**, con el mismo contrato: si algo falla, se traga
   — **la factura se emite igual**. La remisión es un proceso aparte.
2. El planificador despierta, comprueba el turno del control de flujo (leyéndolo **de la BD**, no de
   memoria) y manda en un sobre todo lo reclamado.
3. Se persiste el resultado por registro en `verifactu_envios` (estado, CSV, código y descripción de
   error, XML enviado y respuesta cruda).

### Reintentos

Solo se reintenta el **fallo de comunicación** (red caída, AEAT sin responder, SoapFault): es lo único
que puede salir bien más tarde sin que nadie toque nada.

- Backoff **5s → 15s → 45s → 135s → 300s → 300s**; agotados los 6 intentos → **estado terminal + aviso**.
- Un **rechazo** de la AEAT (`incorrecto`, p. ej. NIF no censado) **no se reintenta**: el mismo XML da
  el mismo rechazo. Va directo a aviso, para que lo corrija una persona.
- Un **bloqueo por datos** (falta el NIF del destinatario) ni sale: aviso. Nunca se inventa un dato.
- Lo **aceptado no se reenvía jamás** (idempotencia del motor, `yaAceptado`).
- Pasados los 240 s el registro ya solo puede volver `AceptadoConErrores`, pero **se sigue enviando**:
  un registro remitido tarde es mejor que uno no remitido. Subsanarlo es otra pieza.

### Multi-tenant

Cada negocio remite con **su** certificado (es el obligado quien autentica el mTLS). Resolución:

```
VERIFACTU_CERT_DIR/<slug>.p12   (o .pfx)   ·   contraseña en VERIFACTU_CERT_PASS_<SLUG>
```

Si no hay directorio, o el negocio no tiene fichero, se cae al `VERIFACTU_CERT_PATH` global (el camino
que ya usaba el script de preproducción). El slug se valida contra `[a-z0-9-]` antes de tocar el
sistema de ficheros.

**La contraseña sigue sin escribirse en ningún fichero del repo.** Vive en el entorno del servicio, y
si no está, **la cola de ese negocio no se activa**: no se inventa, no se pide por teclado (no hay
teclado) y no se lanzan intentos contra un muro. La pantalla `/admin/verifactu/envios` dice el motivo
exacto, y el botón "Enviar" manual sigue disponible.

### Concurrencia y arranque en frío

La cola vive en el proceso de la app (uno solo). El barrido de systemd la respalda por si el proceso
muere entre encolar y enviar, o durante un backoff largo. Para que nunca envíen el mismo registro dos
veces, **reclamar una fila empuja su `next_retry_at` al futuro** (lease de 120 s) dentro de una
transacción `IMMEDIATE`. El que no reclama, no envía. Si un proceso muere con el lease puesto, a los
120 s la fila vuelve a ser elegible sola.

`next_retry_at` se guarda **siempre** en ISO-8601 UTC con `Z`, nunca con `CURRENT_TIMESTAMP`:
`'AAAA-MM-DD HH:MM:SS'` y `'AAAA-MM-DDTHH:MM:SS.sssZ'` se comparan como cadenas, y el espacio (`0x20`)
ordena antes que la `T` (`0x54`) — mezclarlos rompería el `<=` del reclamo.

### El histórico NO se drena

La cola solo toca filas con `next_retry_at` no nulo, y eso solo lo pone ella. Un registro antiguo (sin
fila de envío) se queda quieto: remitirlo hoy solo devolvería `AceptadoConErrores`, porque su huella
caducó hace semanas. Encender la cola **no dispara** los 61 registros históricos de `desarrollo-bamburu`
ni reintenta el `incorrecto` de `helados-ibrahin`.

## Interruptores

| Variable | Efecto |
|---|---|
| `VERIFACTU_COLA=off` | Apaga la cola por completo (los registros esperan al botón manual). |
| `VERIFACTU_ENTORNO` | `pruebas` (por defecto) o `produccion`. Apuntar a producción es deliberado. |
| `VERIFACTU_ENDPOINT` | Válvula para bancos de pruebas/staging: apunta la cola a un simulador (sin certificado). |
| `VERIFACTU_CERT_DIR` | Directorio de certificados por negocio. |
| `VERIFACTU_CERT_PASS_<SLUG>` | Contraseña del `.p12` de ese negocio (o `VERIFACTU_CERT_PASS` global). |

## Verificación

- `node scripts/verify-verifactu-cola.mjs` → **55/0**. Cubre: encolado tras la emisión, ventana de
  240 s, agrupación en un sobre, control de flujo, idempotencia, cerrojo del reclamo, red caída +
  reintento, backoff creciente hasta el estado terminal, rechazo que no se reintenta, lote mixto (una
  factura mala no bloquea a las demás), avisos, histórico que no se drena, aislamiento entre negocios,
  y que la emisión nunca se bloquea.
- Regresión: `verify-verifactu-t1` (18/0), `verify-verifactu-t2` (17/0), `verify-verifactu-t1-http` (7/0).
- Prueba sobre **copia de la BD real** de `ibrahin-repuestos` (cadena con dos registros ya aceptados por
  la AEAT): 3 tickets emitidos → un solo sobre → 3/3 `Correcto` con hueco de **1,0 s**; el
  encadenamiento continúa desde la huella real de `S2026-0002`; los dos aceptados no se reenvían.

## Pendiente (fuera de este encargo)

- **Envío real a preproducción con la cola**: necesita el `.p12` del dueño y su contraseña en el
  entorno del servicio. Mientras no estén, la cola está inactiva para todos los negocios y el
  comportamiento es exactamente el de hoy (botón manual).
- Envío de **anulaciones** (Fase A remite solo altas).
- **Subsanación** del 2004 con un alta `Subsanacion=S`.
- **Fase B legal**: colaboración social (Convenio tipo 17), declaración responsable, elección de
  certificado (propio-por-todos vs. Anexo II por cliente).
- Bug latente de `verifactu-envio.js` (`prevRegistro` se elige por `id` sin filtrar por emisor).
- `company_config.fiscal_id` vacío (`duniya`, `rachibra`, `inversiones-disan`) haría salir la Cabecera
  con `ObligadoEmision` vacío. Hoy es teórico: esos negocios no tienen certificado, así que su cola
  nunca se activa.
