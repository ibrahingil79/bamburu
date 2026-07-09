# Diagnóstico del sistema de avisos / notificaciones — antes del Eje B (DISA)

> **Solo lectura.** No se ha tocado código. Fecha: 2026-07-09. Método: lectura directa del motor
> (`modules/erp/avisos.js`), de las superficies que lo consumen y de la programación del sistema
> (systemd/cron), más comprobación en las BD de tenant. Objetivo: dar base para planificar el Eje B
> — DISA con Ibrahin. Referencias como `archivo:línea` para poder saltar al código.

---

## Resumen en una frase

Existe **un motor de avisos limpio y centralizado** (`avisos.js`, patrón "colector de fuentes") con
**3 fuentes conectadas**, pero (a) **no hay pantalla central** de "todos mis avisos", (b) las superficies
**se calculan solo al cargar la página** (sin refresco en vivo → el número se queda viejo en una pestaña
abierta), y (c) **el email diario está escrito pero NO programado** (nunca se ha enviado). Además, faltan
por conectar fuentes de dinero importantes (cobros de cliente, oportunidades del CRM).

---

## 1. Inventario de avisos existentes

El motor es `modules/erp/avisos.js`: un **colector de fuentes**. Cada fuente es una `función(db, today) →
lista de avisos normalizados` `{ tipo, urgencia, titulo, detalle, ref }`. `avisosDelDia()` agrega todas y
ordena por urgencia. **Solo lee** (no escribe, no migra, no toca stock ni hash). Registro de fuentes en
`avisos.js:96` (`const SOURCES = [...]`).

### Fuentes CONECTADAS hoy (3)

| # | Aviso | Qué detecta | De dónde sale (motor/tabla) | Código |
|---|---|---|---|---|
| 1 | **Vencimiento de proveedor** | Facturas de proveedor **vencidas** o que **vencen en ≤7 días** (excluye abonos y lo ya pagado) | `openPayables()` de `pagos.js` (torre de control de pagos, solo lectura) | `avisos.js:29` |
| 2 | **Stock bajo** | Productos activos con **stock < 5 uds** | Query directa a `products` (mismo cálculo que tenía el dashboard) | `avisos.js:68` |
| 3 | **Factura recurrente en borrador** | Borradores de recurrentes **listos para revisar/emitir** | Query inline a `recurring_occurrences` (status `borrador`) | `avisos.js:81` |

Prioridad (campo `urgencia`, mayor = más arriba): vencido `1000 + días` › recurrente `200` › por-vencer
`100 − días` › stock bajo `50 − stock`. `avisosDelDia()` es robusto: si una fuente peta, se ignora esa y
siguen las demás (`avisos.js:105`).

### Fuentes NO conectadas (huecos relevantes para el Eje B)

El motor está **diseñado para crecer** ("añadir una fuente = registrar una función en `SOURCES`,
`avisos.js:94-95"), pero hoy **no** contemplan:

- **Cobros de cliente vencidos** — el motor de `cobros.js` ya calcula worklist + próxima acción por deuda,
  pero **no es una fuente de avisos**. El "te deben dinero" (probablemente la señal nº 1 del dueño) **no
  aparece en el badge**. *(Ojo al ejemplo del encargo: "una factura que ya se cobró" — las facturas de
  CLIENTE no entran hoy en el badge; solo las de PROVEEDOR.)*
- **Oportunidades del CRM** que piden acción hoy / en riesgo (`salesWorklist().pendientes`, recién hecho).
- **Pedidos** pendientes de entrega / bloqueados (DISA los lee bajo demanda, pero no son aviso).
- **Cumplimiento**: Verifactu pendiente de envío, modelos fiscales que vencen (calendario fiscal), etc.

---

## 2. Superficies donde se muestra cada aviso

Cuatro superficies consumen el motor. **Ninguna** añade fuentes propias: todas leen de `avisosDelDia()` /
`estadoAvisos()`, así que el conteo coincide entre ellas por diseño.

### 2.1 Contador del rail (junto a DISA) — en TODAS las pantallas admin
- **De dónde lee:** `estadoAvisos(db, hoy).count` en `layout.js:235` (BD del tenant, `c.get('db')`).
- **Cuándo se calcula:** **al renderizar la página, en el servidor** — en cada carga/navegación completa.
- **Render:** `.disa-pin-badge` en `layout.js:860-863` (número, o `9+`). El enlace va a `/admin` (Inicio).
- **Notas:** usa **solo `.count`**; **ignora el estado** rojo/visto → el badge del rail está **siempre en
  rojo** (`#DC2626`, `layout.js:599`) aunque ya se hayan abierto los avisos. El tooltip los llama
  "propuestas" (`layout.js:860`), no "avisos".

### 2.2 Inicio (home de DISA, `/admin` → `disaHomeHtml`)
- **De dónde lee:** `estadoAvisos(db, hoy)` en `dashboard.js:26` → pasa `alertCount` **y** `alertState`
  (rojo/visto/apagado) a `disaHomeHtml(...)`.
- **Cuándo se calcula:** al renderizar el Inicio, en el servidor.
- **Interacción (única acción sobre el badge):** al pulsarlo, `disaShowAlerts()`
  (`disaHome.html.js:644`) hace `POST /api/disa/alerts/open` (`disaHome.html.js:658`) → devuelve el
  **resumen-primero** (conteos, sin detalle, sin acciones) y **marca todo como VISTO**. El badge del Inicio
  pasa a gris **en el cliente** (`disaHome.html.js:663-664`), sin volver a pedir el número.

### 2.3 Email diario (resumen de la mañana)
- **De dónde lee:** `avisosDelDia()` + `avisosEmail()` (`avisos.js:114`), por tenant, en
  `scripts/bamburu-avisos.mjs`; envía por Resend al `company_config.email`, con idempotencia por día
  (`daily_alert_log`).
- **Cuándo se calcula:** en **segundo plano**, pensado como tarea diaria de la mañana.
- **⚠️ HALLAZGO — no está programado:** **no existe** timer ni servicio systemd de avisos
  (`/etc/systemd/system/` solo tiene `bamburu-backup*` y `bamburu.service`), **ni cron**. La cabecera del
  script apunta a `User=ibrahin` (usuario viejo; el actual es `ubuntu`). En las BD de tenant,
  `daily_alert_log` está **vacía (0 filas)** → **el email nunca se ha enviado en producción**. El canal
  está escrito y probado, pero **desconectado**.
- **Detalle menor:** el mapa `BLOQUE` del email (`avisos.js:128-131`) solo etiqueta
  `vencimiento_proveedor` y `stock_bajo`; un bloque de `factura_recurrente` saldría con el título crudo.

### 2.4 DISA por chat
- **Resumen del badge:** `POST /api/disa/alerts/open` (`disa/index.js`, router) → `marcarVistoYResumir()`
  (`avisos.js:244`, llamado en `disa/index.js:2778`). Es **determinista, sin modelo**: devuelve conteos
  ("Tienes 3 cosas que mirar: 2 facturas de proveedor…, 1 producto con stock bajo. ¿Cuál quieres ver?") y
  marca visto. Se calcula **bajo demanda** (al pulsar el badge).
- **Detalle:** el desglose de cada aviso **no** lo da el resumen; el dueño lo pide luego escribiendo
  ("enséñame los vencimientos"), y eso ya es conversación normal con el modelo. DISA además lee bajo
  demanda otras cosas (resumen de cobros, pedidos pendientes) que **no** pasan por el motor de avisos.

### Aclaración: las "bandas dentro de cada pantalla" NO son el motor de avisos
Las bandas azules de DISA y las columnas de **"próxima acción"** de cada pantalla (Cobros, Facturas, CRM…)
las calculan **motores propios de esa pantalla** (p. ej. `cobros.js`), a su carga o por `fetch` en esa
vista. **No** cuelgan del motor de avisos. El alcance del motor de avisos es: **rail + Inicio + email +
resumen de DISA**, nada más.

---

## 3. Por qué no se actualiza (refresco y "número viejo")

- **Se calcula solo al cargar la página entera.** El contador del rail y el del Inicio son
  **render de servidor en cada carga**. **No hay polling, ni `setInterval`, ni SSE/WebSocket, ni `fetch`
  de refresco** del contador (verificado en `layout.js`, `widget.js` y `disaHome.html.js`). La única
  actualización en cliente es marcar el badge del Inicio en gris al abrirlo (`disaHome.html.js:663`), y ni
  siquiera vuelve a pedir el número.
- **Consecuencia — número viejo en pestaña abierta:** `avisosDelDia()` **siempre se calcula en vivo desde
  la BD** (no hay contador persistido que "se olvide" de bajar), así que el número es correcto **en el
  momento del render**. Pero si el dueño resuelve la causa **sin recargar** — paga una factura de
  proveedor, emite un recurrente, repone stock — el badge del rail **sigue mostrando el número viejo hasta
  que navega/recarga**. Como muchas acciones se hacen por `fetch`+toast (sin recarga completa), el badge
  **no baja solo**. Ejemplo directo del encargo: pagas una factura de proveedor → sigue contada en el
  badge hasta recargar. *(Con facturas de cliente cobradas no pasa porque hoy no entran en el badge.)*
- **Incoherencia visto/rojo:** el estado `visto` se guarda en `alert_seen` (huella por tenant), pero el
  **rail ignora el estado** (siempre rojo), así que abrir los avisos **agrisa el badge del Inicio pero no
  el del rail**. Además `alert_seen` es **singleton por tenant** (`id=1`, `avisos.js:219-228`): si un
  usuario los marca vistos, quedan vistos **para todos** los usuarios del negocio (relevante en multiusuario).

---

## 4. ¿Existe una pantalla central "todos mis avisos en un sitio"?

**No. No existe.** No hay ruta `/admin/avisos` ni equivalente (verificado en `routes/index.js`). Lo más
cercano, y ninguno lo cubre:

- **Email diario** — sería el "todo junto", pero **no está programado** (§2.3): no llega.
- **Resumen-primero del Inicio** — **solo conteos**, sin detalle y **sin acciones** ("¿cuál quieres ver?").
- **Badge del rail** — solo un número.

Para **actuar** sobre un aviso hay que **saber a qué pantalla ir** (Pagos / Inventario / Recurrentes) y
buscarlo allí. No hay una lista única de avisos con enlace y acción directa. **Esto es probablemente el
hueco nº 1 para el Eje B.**

---

## 5. Implicaciones para planificar el Eje B (DISA)

Ordenado por impacto (no es plan, es materia prima para decidir con Ibrahin):

1. **Falta la pantalla central de avisos** con detalle + acción directa (§4). Hoy DISA da conteos pero
   remata "¿cuál quieres ver?" y el dueño tiene que ir a buscarlo.
2. **El email diario no llega** (§2.3): instalar el timer systemd (con `User=ubuntu`, no `ibrahin`) o
   decidir descartarlo. Bajo esfuerzo, alto valor.
3. **El badge no se refresca solo** (§3): decidir si se quiere refresco en vivo (endpoint de conteo +
   `fetch` tras cada acción, o polling ligero) para que el número baje al resolver la causa sin recargar.
4. **Faltan fuentes de dinero** (§1): cobros de cliente vencidos y oportunidades del CRM en riesgo. El
   motor las admite con "una función más en `SOURCES`" — el trabajo es de diseño (cadencia, prioridad), no
   de fontanería.
5. **Coherencia visto/rojo y multiusuario** (§3): el rail siempre rojo aunque esté visto; y `alert_seen`
   es por tenant, no por usuario.
6. **Detalle menor:** etiqueta del bloque `factura_recurrente` en el email (`avisos.js:128-131`).

---

## Anexo — mapa de archivos

| Pieza | Archivo | Referencia |
|---|---|---|
| Motor (fuentes, agregación, estado, resumen, huella) | `modules/erp/avisos.js` | `:29 :68 :81 :96 :101 :233 :244` |
| Contador del rail (todas las pantallas) | `modules/erp/layout.js` | `:235` (cálculo) · `:860-863` (render) |
| Inicio (home DISA) + estado del badge | `modules/erp/routes/dashboard.js` · `modules/erp/views/disaHome.html.js` | `dashboard:26` · `disaHome:644-664` |
| Endpoint del resumen del badge | `modules/disa/index.js` | `router.post('/alerts/open')` · `:2778` |
| Email diario (canal + plantilla) | `scripts/bamburu-avisos.mjs` · `modules/erp/avisos.js` | `avisosEmail :114` · **sin timer/cron** |
| Pantalla central de avisos | — | **no existe** |
