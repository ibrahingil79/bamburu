# Censo de envíos de correo de Bamburu

**Medido el 25 ago 2026** sobre el registro real de Resend (675 envíos de agosto descargados por API)
y sobre las tablas del propio producto. **Ninguna cifra de este documento está estimada.**

---

## 1 · Resumen para el dueño

Sí: **la avalancha del 24 de agosto venía del trabajo de ese día**, no de un fallo del producto.
Llegaron **45 correos** a `ibrahingil@gmail.com` y **39 de ellos los provocaron tres comprobaciones**
que se disparan en cada pasada del barrido. Los otros 6 son legítimos (los tres partes del barrido,
el backup y uno de otro producto).

Pero al mirar los datos aparecieron **dos cosas que el encargo no preveía, y una es peor que la
avalancha**:

> ⚠️ **Un negocio real lleva 8 días sin recibir su correo, y nadie se había enterado — porque tiene
> la dirección mal escrita.**
> El negocio **helados-ibrahin** tiene apuntado `igilm@gmail.com`, y **esa cuenta no existe**. Lo dice
> Gmail con todas las letras: `550-5.1.1 The email account that you tried to reach does not exist`.
> Fue un rebote **permanente** el 17 ago 2026 a las 16:21, y desde entonces Resend lo puso en su lista
> de supresión y **descarta en silencio** todos sus resúmenes: 19, 20, 21, 22, 23, 24 y 25 de agosto.
>
> **La supresión de Resend está bien hecha: no hay que quitarla.** Quitarla solo provocaría otro
> rebote y más daño a la reputación. Lo que hay que arreglar es **la dirección apuntada en el negocio**
> — y eso es una decisión tuya (cuál es la buena), además de quedar fuera del alcance de este encargo,
> que dice expresamente que no se cambia a quién le llega el resumen diario.
>
> Lo que sí deja claro este hallazgo: **el producto da por enviado lo que Resend está tirando a la
> basura.** Nadie se entera de que un cliente no recibe nada. Eso sí es del producto, y no tiene
> arreglo hoy en el código: hace falta leer los rebotes de vuelta, que no se hace.

> ⚠️ **El 18 % de todo lo que se envía rebota.** 122 rebotes de 675 envíos en agosto. **79 son
> recordatorios de cita** a direcciones inventadas por las comprobaciones (`@t.local`), y **rebotaron
> el 100 %**. Los rebotes son lo que quema la reputación del dominio — y son la causa de que esa
> dirección real acabara suprimida.

Y un dato de contexto que conviene tener presente: **la cuenta de Resend no es solo de Bamburu**.
Otro producto, **Rebobina** (`hola@send.ibrahingil.com`, dominio verificado el 24 ago), envía desde la
misma cuenta y gasta del mismo cupo: 12 envíos entre el 24 y el 25 de agosto, a 9 direcciones reales.

---

## 2 · Los números

### Envíos por día (agosto 2026 · registro de Resend)

| Día | Envíos | |
|---|---:|---|
| 1 al 14 ago | **2/día** | línea base: solo el resumen diario |
| 15 ago | 10 | |
| 16 ago | 2 | |
| 17 ago | 24 | ← **el rebote que suprime a `igilm@gmail.com`** |
| 18 ago | 16 | |
| 19 ago | 42 | |
| 20 ago | 81 | |
| 21 ago | 121 | |
| 22 ago | 139 | |
| 23 ago | 14 | |
| **24 ago** | **174** | ← la avalancha |
| 25 ago (hasta las 07:00) | 24 | |
| **Total agosto** | **675** | |

La línea base real del producto son **2 correos al día**. Todo lo que pasa de ahí lo genera el trabajo
de construcción.

### El 24 de agosto, por destinatario

| Destinatario | Envíos | Qué es |
|---|---:|---|
| `delivered@resend.dev` | 74 | simulación · **correcto, no toca reputación** |
| `ibrahingil@gmail.com` | 45 | la bandeja del dueño |
| direcciones `@t.local` / `@bamburu.test` | 22 | inventadas por comprobaciones · **rebotan todas** |
| 8 direcciones reales de terceros | 8 | del producto **Rebobina**, no de Bamburu |
| `hola@bamburu.com` | 2 | buzón del equipo · **rebota** (dominio solo de envío) |
| `gilibrahin@gmail.com` | 2 | dueño de negocio real · resumen diario |
| `igilm@gmail.com` | 1 | dueño de negocio real · **suprimido, no llegó** |

**Estado final de los 174:** 129 entregados · **36 rebotados** · 8 retrasados · 1 suprimido.

### Los 45 que llegaron a la bandeja del dueño

| Asunto | Cuántos | Origen | ¿Legítimo? |
|---|---:|---|---|
| Tu enlace para entrar en Bamburu | 16 | `verify-tenant-lookup-readonly` + `gate-registro-alta` | **no** — comprobación |
| Hemos recibido tus datos para la migración | 12 | `gate-inicio-arranque` | **no** — comprobación |
| Migración pedida · Talleres RecambiAuto SL | 11 | `gate-inicio-arranque` | **no** — comprobación |
| Parte del barrido nocturno (3 variantes) | 3 | `barrido-nocturno.sh` | sí, histórico; automatismo retirado el 26 ago |
| ✅ Backup Bamburu OK | 1 | `bamburu-backup.sh` | sí |
| [PRUEBA] Orden de compra OC-0031 | 1 | `gate-orden-compra-c1a` | **no** — comprobación |
| Confirma tu correo · Rebobina | 1 | otro producto | sí (ajeno) |

**39 de 45 son de comprobaciones.** El patrón es exacto y se ve en las marcas de tiempo: **cada pasada
del barrido manda 4 correos reales al dueño** — 2 enlaces de acceso y la pareja de la migración.
Ocho pasadas ese día ≈ 32, más los ensayos sueltos.

### Cupo del plan

El API de Resend **no expone el plan ni el cupo consumido** (`/usage`, `/plan` y `/billing` responden
404/405). Lo único que publica es el límite de peticiones: **10 por segundo**.

Lo que sí se puede afirmar con datos: **ningún envío se quedó fuera por cupo el 24 de agosto.** Los
174 aparecen en el registro con su evento de entrega, así que Resend los aceptó todos; el tope diario
de este plan está por encima de 174. Con 675 en agosto, tampoco hay riesgo cercano en el tope mensual
de ningún plan de pago.

**Sí se quedó fuera un envío real, pero por otro motivo:** el resumen diario de `igilm@gmail.com`, que
Resend descarta por supresión. Y lleva ocho días seguidos.

---

## 3 · Censo completo: todo lo que puede enviar un correo

La única puerta a Resend es `core/mailer.js` → `sendEmail()`. Todo lo demás pasa por ahí.

### A · El producto (envíos reales · **no se tocan**)

| Qué | Lo dispara | A quién escribe |
|---|---|---|
| Enlace de acceso | el visitante pide entrar (`POST /find-tenant`) | quien lo pide |
| Recordatorio de cobro | el dueño pulsa «reclamar» (`cobros.js`) | el cliente |
| Recordatorio de cita | el motor de citas (`citas-avisos.js`) | el cliente |
| «Hace tiempo que no coincidimos» | CRM, clientes dormidos (`crm.js`) | el cliente |
| Presupuesto por correo | el dueño lo envía (`quotes.js`) | el cliente |
| Listado / informe por correo | el dueño lo envía (`listados.js`) | quien él diga |
| Orden de compra | el dueño la envía (`purchase-orders.js`) | el proveedor |
| Prueba de plantilla | el dueño pulsa «probar» (`settings.js`) | él mismo |
| Migración: acuse | el visitante pide migrar (`migracion.js`) | quien lo pide |
| Migración: aviso al equipo | lo mismo | buzón del equipo |
| Gasto de IA al 80 % | el propio consumo (`core/llm.js`) | `ibrahingil@gmail.com` |

### B · Temporizadores del sistema (6 activos, de los que 4 envían; 1 retirado)

| Unidad | Cuándo | Envía | A quién |
|---|---|---|---|
| `bamburu-avisos` | **cada hora** | resumen diario del negocio | dueño de cada negocio |
| `bamburu-recordatorios-cita` | 09:00 | recordatorios de cita | clientes |
| `bamburu-backup` | 03:30 | parte del backup | `ibrahingil@gmail.com` |
| `bamburu-backup-heartbeat` | 09:00 | aviso si no hay backup en 48 h | `ibrahingil@gmail.com` |
| `bamburu-barrido-nocturno` | **RETIRADO 26 ago 2026** | ya no se ejecuta ni envía automáticamente | — |
| `bamburu-caducar-reservas` | cada hora | — | — |
| `bamburu-propuestas` | 07:45 | — (genera propuestas) | — |

### C · Comprobaciones automáticas

De las 205 del barrido:

- **Las que ya usan simulación:** 413 de los 675 envíos de agosto (61 %) fueron a
  `delivered@resend.dev`. Eso está bien y no toca la reputación.
- **Las que escriben a una bandeja REAL (3):** `verify-tenant-lookup-readonly` y `gate-registro-alta`
  (enlace de acceso a `ibrahingil@gmail.com`), y `gate-inicio-arranque` (la pareja de la migración).
  **Estas tres son el 87 % de la avalancha.**
- **Las que escriben a dominios inventados (32 usan `@t.local`):** no llegan a nadie, pero **cada una
  es un rebote** contra `bamburu.com`.
- `gate-migracion-al-equipo` comprueba, precisamente, que el buzón del equipo **no** sea
  `hola@bamburu.com` — porque esa dirección rebota. Es la única que ya vigilaba esto.

---

## 4 · Lo que hay que decidir

1. **Lo urgente, y no es la avalancha:** corregir la dirección del negocio **helados-ibrahin**.
   `igilm@gmail.com` no existe (rebote permanente de Gmail). **No se toca la lista de supresión** —
   está bien puesta. Y decidir si el producto debe enterarse de los rebotes en vez de dar por enviado
   lo que no llega.
2. **Los rebotes:** mientras las comprobaciones escriban a `@t.local` desde `bamburu.com`, la
   reputación del dominio sigue bajando y volverá a haber supresiones.
3. **La cuenta compartida con Rebobina:** conviene saberlo antes de mirar cupos o reputación, porque
   lo que haga un producto le pasa factura al otro.

---

## 5 · Verificación (25 ago 2026, después de aplicar la norma)

Dos barridos completos seguidos, de 207 comprobaciones cada uno, con el registro de Resend marcado
antes y leído después:

| | 24 ago (antes) | 25 ago (después) |
|---|---:|---:|
| Envíos por pasada del barrido | ~90 | **12** |
| A la bandeja del dueño | 4 por pasada | **0** |
| Rebotes | 36 en el día | **0** |
| Veredicto del barrido | 8 rojos | **6 rojos** (4 son el saldo de IA) |

Los 12 envíos que quedan van todos a direcciones de simulación, y cada uno lleva su etiqueta para
saber quién lo mandó: `delivered+c6-find-tenant-…`, `delivered+migracion-acuse@…`,
`delivered+migracion-equipo@…`. Se comprueban exactamente las mismas cosas que antes; lo único que
cambia es que no acaban en la bandeja de nadie.

**El freno**, medido en el mismo barrido: 30 envíos apuntados, **0 frenados** — muy por debajo del
tope de 120 por hora, que es lo que se esperaba.

### Y de paso: seis negocios fantasma que recibían correo

Al medir salieron **seis negocios creados por comprobaciones que se cayeron a medias** y que se
quedaron dados de alta y **activos**: `gos-9fd944-clinica`, tres `gate-sustitutiva-*`,
`gate-presupuestos-c96f9a` y `gate-xss-941065`. No eran solo basura en una tabla: el temporizador de
avisos los trataba como negocios de verdad y **les mandaba su resumen diario** —cada uno tenía ya dos
envíos apuntados— a direcciones que no existen. Borrados (con copia previa de `control.db`), quedan
los 7 negocios reales.

Uno de ellos, `gate-xss-941065`, tenía el fichero declarado como
`data/tenants/__gate_941065_no_existe.db`: borrarlo por el nombre del negocio no lo habría quitado.
Se borran por `db_filename`, que es lo único que dice dónde está de verdad.
