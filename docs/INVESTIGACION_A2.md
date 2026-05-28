# INVESTIGACIÓN — Arquitectura actual de IVA + IRPF (para A2)

> Fecha: 2026-05-28. Solo lectura, código no modificado durante la investigación.
> Auditado contra `modules/erp/{models.js, schemas.js, routes/invoices.js, routes/orders.js, routes/purchases.js, routes/settings.js, routes/analytics.js}`, `modules/store/routes.js`, `modules/disa/index.js`, `core/{control-db.js, tenant-provisioning.js}` y verificado contra `data/tenants/desarrollo-bamburu.db` + `data/control.db`.

---

## 1. Diagrama del flujo de impuestos hoy

```
                  ┌─────────────────────────┐
                  │   company_config        │  (tenant DB)
                  │   tax_rate REAL = 21    │  ← UNA tasa global
                  │   tax_name TEXT = 'IVA' │  ← UN nombre
                  └─────────┬───────────────┘
                            │
                ┌───────────┴────────────┐
                ▼                        ▼

      [POS / Checkout]               [Factura]
      ───────────────                ────────

      subtotal = Σ(qty·price)       generateInvoice:        createInvoice (A1):
      base = subt − descuento       subt = total/(1+iva)    base = Σ(qty·price)
             + envío                tax  = total − subt     tax  = base·(iva/100)
      tax  = base · (iva/100)        ← back-calc desde       total = base + tax
      total = base + tax              order.total              (sin envío ni desc.)
              │                              │                       │
              ▼                              ▼                       ▼
        sales_orders.tax_amount      invoices.tax_rate    invoices.tax_rate
        sales_orders.tax_rate ─?─    invoices.tax_amount  invoices.tax_amount
        (¡no se guarda la tasa!)     (UNA tasa)           (UNA tasa)
              │
              ▼
        invoices (auto)


  ┌─────────────────────┐
  │ invoice_items       │  ← NO tiene tax_rate, NO tiene tax_amount
  │ description         │     Las líneas son ciegas a impuestos.
  │ quantity            │
  │ unit_price          │
  │ total_price = q·p   │  ← suma SIN IVA
  └─────────────────────┘

  ┌─────────────────────┐
  │  IRPF               │  ✗ NO existe. Cero referencias en todo el repo.
  └─────────────────────┘

  ┌─────────────────────┐
  │  country_configs    │  (control.db)
  │  ES: '21,10,4'      │  ← CSV en TEXT, no expuesto en UI hoy
  │  MX: '16,8,0'       │
  │  CO: '19,5,0'       │
  └─────────────────────┘
```

**Resumen de una línea:** hoy todo el sistema asume **UNA tasa** de impuesto y **CERO retenciones**. La tasa vive en `company_config`, se replica en `invoices` como snapshot, y nunca llega a `invoice_items`.

---

## 2. Respuestas numeradas

### 1) Estado actual de IVA en `invoices` e `invoice_items`

- `invoices.tax_rate`, `invoices.tax_amount`, `invoices.tax_name` son **globales** (una sola tasa para toda la factura, snapshoteada desde `company_config` en el momento de emisión).
- **`invoice_items` NO tiene columnas de impuesto.** Solo `description, quantity, unit_price, total_price` — y `total_price = quantity * unit_price` **sin IVA**.
- **No hay plan B en el código.** No hay `tax_breakdown` JSON, no hay tabla `invoice_taxes`, no hay nada que permita múltiples tasas. La UI tampoco lo prevé.
- **Cálculo del total**:
  - `createInvoice` (A1): `total = subtotal + tax_amount` donde `tax_amount = subtotal × (tax_rate/100)` y `subtotal = Σ(qty × unit_price)` sumados de las líneas. **Sin IRPF, sin envío, sin descuentos.**
  - `generateInvoice` (POS auto): `subtotal = order.total / (1+iva/100)`, `tax_amount = order.total − subtotal`. Es **back-calculation** desde el total bruto que ya calculó el POS.
  - POS / Checkout: `total = (subtotal − descuento + envío) × (1 + iva/100)`. Aquí el descuento y el envío están **dentro** de la base imponible.

### 2) IRPF: ¿existe en el modelo?

| Lugar | IRPF presente |
|---|---|
| `invoices` | ❌ No |
| `invoice_items` | ❌ No |
| `sales_orders` | ❌ No |
| `sales_items` | ❌ No |
| `purchases` | ❌ No |
| `purchase_items` | ❌ No |
| `company_config` | ❌ No |
| `country_configs` (control.db) | ❌ No |
| Schemas Zod | ❌ No |
| Vistas / printable | ❌ No |
| DISA (system prompt y actions) | ❌ No |

**Cero referencias en TODO el código** (`grep -rniE "irpf|retencion|withhold|retenci"` devuelve nada). Para A2, IRPF son **columnas nuevas puras** sin compatibilidad histórica que romper.

### 3) Cálculo de impuestos en el flujo actual

**Hay 6 lugares distintos donde se calcula IVA hoy** (un montón de duplicación):

| # | Archivo:línea | Fórmula | Nota |
|---|---|---|---|
| 1 | `modules/erp/routes/orders.js:43-70` (POS) | `total = (subtotal − descuento + envío) × (1+iva/100)` | UNA tasa desde `company_config`. Incluye envío y descuento en la base. |
| 2 | `modules/store/routes.js:1013-1037` (checkout) | **Idéntico** a POS | Código copiado, no compartido. |
| 3 | `modules/erp/routes/invoices.js:41-44` (`generateInvoice`) | `subtotal = total/(1+iva/100); tax = total − subtotal` | **Back-calculation**. Necesaria para preservar exactamente el total del pedido. |
| 4 | `modules/erp/routes/invoices.js:114-120` (`createInvoice`, A1) | `tax = subtotal × (iva/100); total = subtotal + tax` | Pre-tax simple. **Sin envío ni descuento** porque las facturas directas no tienen. |
| 5 | `modules/erp/routes/invoices.js:330-380` (UI form A1) | Igual que #4, en JS del navegador | Recálculo en vivo cliente-side. Lee `tax_rate` de `/api/erp/settings/company`. |
| 6 | `modules/disa/index.js:328-355` (DISA `create_invoice_from_order`) | **Copia** de `order.tax_amount` directamente | **No recalcula nada**; toma lo que ya tiene el pedido. Y **no calcula hash** — los inserts no incluyen `verifactu_hash` ni `prev_hash`, dependen del DEFAULT `''` de la columna. **Esto es un bug existente.** |

**Redondeos:** todos usan el mismo patrón `parseFloat(x.toFixed(2))` — redondeo a 2 decimales con la regla por defecto de JavaScript (banker's rounding NO, es "half away from zero" en `toFixed`). No hay sistema bancario ni configuración de moneda. Para EUR es aceptable. Para JPY (sin decimales) o BHD (3 decimales) sería incorrecto, pero hoy solo soportamos EUR/MXN/COP — todas con 2 decimales.

### 4) Vistas / reportes de impuestos

**Vista imprimible de factura** (`modules/erp/routes/invoices.js:172-503`, líneas críticas 482-491):

```html
<table>
  <thead><tr><th>Descripción</th><th>Cant.</th><th>P. unitario</th><th>Total</th></tr></thead>
  <tbody>${rows}</tbody>            <!-- líneas SIN IVA por línea -->
</table>
<table class="totals">
  <tr><td>Base imponible</td>             <td>${sym}${inv.subtotal}</td></tr>
  <tr><td>${inv.tax_name} (${inv.tax_rate}%)</td><td>${sym}${inv.tax_amount}</td></tr>
  <tr class="grand"><td>TOTAL</td>        <td>${sym}${inv.total}</td></tr>
</table>
```

- **Sin desglose por tasa.** Una sola línea de IVA al final.
- **Sin IRPF** (no existe).
- **Reportes fiscales: NO HAY.** No existe ninguna vista de "desglose IVA por tasa", "modelo 303", "resumen trimestral", ni nada parecido.
- DISA sí muestra un agregado de IVA cobrado total (suma de `invoices.tax_amount`) cuando se le pregunta cuánto IVA recaudó — referencia en su system prompt: `index.js:1700` "IVA = impuesto recaudado (tax_amount)". Pero es un total simple, no un desglose por tipo.

### 5) Configuración de tasas (`company_config` y `country_configs`)

**Por tenant** (`company_config`, una sola fila con `id=1`):
- `tax_rate REAL DEFAULT 21.0` — la tasa **por defecto** y única.
- `tax_name TEXT DEFAULT 'IVA'` — el nombre que se muestra en la factura.
- `country TEXT DEFAULT 'ES'` — ISO 2 letras.

**A nivel plataforma** (`control.db.country_configs`):
- Es **una tabla** con 3 filas hoy (ES/MX/CO).
- `tax_rates TEXT` es un **CSV** (no JSON, no tabla relacional): `'21,10,4'` para ES, `'16,8,0'` para MX, `'19,5,0'` para CO.
- `tax_default REAL` es la tasa a usar por defecto al crear un tenant.
- **Acceso desde código:** `getCountryConfig(code)` en `core/control-db.js:141`. Solo se usa en `tenant-provisioning.js:43-62` durante el alta de un tenant (copia `tax_default` → `company_config.tax_rate`).
- **El CSV `tax_rates` NUNCA se lee en ningún lugar del código tras el provisioning** (verificado: cero hits a `tax_rates` fuera de la propia definición). **Es datos muertos.**
- **UI:** `/admin/settings` muestra **un input numérico libre** "Impuesto por defecto (%)". El país aparece como `disabled` (no se puede cambiar tras el provisioning). **No hay UI para configurar tasas múltiples.**

### 6) Validaciones y restricciones

- **Zod sobre IVA: NINGUNA.** `tax_rate` no aparece en `schemas.js`. El endpoint `PUT /api/erp/settings/company` usa `companySchema = z.object({}).passthrough()` — acepta cualquier objeto sin validar — y luego hace `parseFloat(d.tax_rate)||0`. Puedes meter `tax_rate=-50` o `tax_rate=9999` y se guardará.
- **No se valida que una línea solo pueda tener una tasa** (las líneas no tienen tasa en absoluto).
- **No se checkea que IRPF + IVA no excedan el total** (IRPF no existe).
- **No hay restricciones por país.** El sistema asume IVA universal. Cuando llegue IRPF habrá que decidir si solo se permite cuando `country='ES'` o si se permite en todos (Colombia tiene retención también, México sí, Argentina sí — distintas reglas).

### 7) Deuda técnica relacionada con impuestos

1. **6 lugares de cálculo duplicados** (ya listados en pregunta 3). Si A2 cambia la fórmula, hay que tocarlos todos para mantener consistencia, o **convertirlos en uno solo** (lo más limpio).
2. **`country_configs.tax_rates` (CSV) es código muerto.** Está poblado pero nunca leído tras el provisioning. Si A2 quiere ofrecer un selector de tasas válidas por país, hay que **conectarlo por primera vez**.
3. **DISA escribe facturas sin hash.** `modules/disa/index.js:338-353` inserta en `invoices` sin pasar por `generateInvoice` ni `createInvoice` — omite `verifactu_hash` y `prev_hash`, que quedan vacíos por DEFAULT. **Esto rompe la cadena Verifactu silenciosamente.** No es bloqueante para A2 pero es un bug latente.
4. **`sales_orders` no guarda `tax_rate`, solo `tax_amount`.** Si en POS se cambia la tasa en `company_config` después de cerrar el pedido pero antes de generar la factura, el back-calc de `generateInvoice` usaría la tasa nueva sobre el total viejo → inconsistencia. Edge case real.
5. **`companySchema = passthrough()`** acepta cualquier campo sin validación. Si A2 añade más config (p. ej. `irpf_default`, `tax_rates_enabled`), no hay barrera. Riesgo de tipos sueltos.
6. **Asimetría de fórmulas POS vs A1:** POS suma `subtotal + IVA` sobre `(subtotal − descuento + envío)`; A1 suma `subtotal + IVA` sobre `subtotal` puro. Las facturas directas no tienen ni descuento ni envío (no aplica), así que no hay regresión, pero **la fórmula no es la misma** y eso conviene saberlo si algún día se unifican.
7. **Sin comentarios TODO sobre impuestos** (`grep -ni "TODO.*tax\|TODO.*iva\|FIXME.*tax"` devuelve cero hits). El código no anticipa nada sobre IVA múltiple ni IRPF.
8. **El IVA en `analytics.js` es CERO** (no hay reportes fiscales). El único agregado de IVA es el que hace DISA preguntando a la BD. **Ningún cliente humano hoy puede ver "cuánto IVA debo en este trimestre".** Es un hueco enorme pero queda fuera de A2 (cae en B3 / panel).

---

## 3. Tabla de columnas relevantes

| Tabla | Columna | Existe | Tipo | Notas |
|---|---|---|---|---|
| `invoices` | `tax_rate` | ✅ | REAL DEFAULT 21 | **Global**, una sola por factura. Snapshot al emitir. |
| `invoices` | `tax_amount` | ✅ | REAL DEFAULT 0 | **Global**, suma total de IVA. |
| `invoices` | `tax_name` | ✅ | TEXT DEFAULT 'IVA' | Solo decorativo (se muestra en la factura). |
| `invoices` | `irpf_rate` | ❌ | — | No existe. |
| `invoices` | `irpf_amount` | ❌ | — | No existe. |
| `invoice_items` | `tax_rate` | ❌ | — | **Aquí está el cuello de botella para múltiple IVA.** |
| `invoice_items` | `tax_amount` | ❌ | — | No existe. |
| `invoice_items` | `irpf_rate` | ❌ | — | No existe. |
| `sales_orders` | `tax_amount` | ✅ | REAL DEFAULT 0 | Global. **No guarda `tax_rate`** — punto débil. |
| `sales_orders` | `tax_rate` | ❌ | — | No se guarda; se asume `company_config.tax_rate` actual. |
| `sales_items` | `tax_rate` | ❌ | — | No existe. |
| `purchases` | (cualquier tax) | ❌ | — | Compras NO modelan impuestos en absoluto. |
| `company_config` | `tax_rate` | ✅ | REAL DEFAULT 21.0 | **Tasa por defecto del tenant** (única). |
| `company_config` | `tax_name` | ✅ | TEXT DEFAULT 'IVA' | Nombre fiscal del impuesto. |
| `company_config` | `irpf_default` | ❌ | — | No existe. |
| `country_configs` | `tax_rates` | ✅ | TEXT (CSV) | `'21,10,4'` etc. **Nunca leído por el código** tras el provisioning. |
| `country_configs` | `tax_default` | ✅ | REAL | Usado solo en provisioning. |
| `country_configs` | `irpf_rates` | ❌ | — | No existe. |

---

## 4. Hallazgos sorpresa

1. **`country_configs.tax_rates` ya tiene `'21,10,4'` para ES, pero el código lo ignora.** Llevas la infraestructura de datos para múltiples tasas, no la has conectado nunca.
2. **DISA emite facturas sin pasar por `createInvoice`/`generateInvoice`** y omite `verifactu_hash`/`prev_hash`. La cadena se rompe silenciosamente cuando DISA factura.
3. **El POS no guarda `tax_rate` por pedido.** Si cambias la tasa en settings tras crear un pedido pero antes de facturarlo, `generateInvoice` aplicaría la tasa nueva al back-calculo del total viejo.
4. **Cero validación Zod sobre tasas** (`companySchema = passthrough()`). Cualquier número se guarda como `tax_rate`.
5. **La UI de settings esconde el país** (`disabled`). Para A2 con desglose por país (España permite IRPF, otros no), hay que decidir cuándo se exhibe el campo IRPF.
6. **Cero reportes fiscales.** Ni el panel "cómo va mi negocio" (B3 del tablero) ni analytics tienen un desglose de IVA por trimestre.
7. **El campo `tax_name` se snapshotea por factura** (en `invoices`), pero **no por línea** (en `invoice_items`). Para "IVA al 21%" y "IVA al 10%" en la misma factura, vas a necesitar `tax_name` por línea o asumir que es un solo nombre con distintos rates.
8. **No existe el concepto de "exento"** en código. La columna `tax_rate REAL` permite 0, pero no distingue "exento art. 20" de "tipo 0%" — semánticamente son cosas distintas en Verifactu.

---

## 5. Recomendación

### Para múltiple IVA (sin romper lo actual)

**Añadir 2 columnas a `invoice_items`:**
- `tax_rate REAL NOT NULL DEFAULT 0` — la tasa de IVA de ESTA línea.
- `tax_amount REAL NOT NULL DEFAULT 0` — el IVA de ESTA línea (precalculado y guardado para inmutabilidad).

**Mantener las columnas globales en `invoices`** (`tax_rate`, `tax_amount`) **como agregados**, pero recomputadas:
- `invoices.tax_amount = Σ(invoice_items.tax_amount)` — suma de IVAs de todas las líneas.
- `invoices.tax_rate` deja de tener sentido como número único cuando hay tasas mixtas. **Opciones:**
  - (a) Dejarla como "tasa principal" (la mayoritaria por importe) — semánticamente turbio, pero no rompe nada.
  - (b) Vaciarla cuando haya múltiples (`NULL` o `0`) y dejar que la vista lo detecte.
  - (c) Convertirla en "tasa única" cuando las líneas tienen todas la misma tasa, y guardar 0/null cuando son mixtas, así Verifactu y la vista pueden distinguir.
  - **Mi voto: (c)**, mejor preservación del caso 99% (una sola tasa, factura del autónomo típico) y semántica clara cuando hay mezcla.

**Refactor de cálculo en UN solo lugar:**
- Crear una helper en `modules/erp/routes/invoices.js` (ya está el más cargado de lógica fiscal): `function computeTotals(lines, irpfRate=0)` que devuelva `{subtotal, tax_breakdown: [{rate, base, amount}], tax_amount, irpf_base, irpf_amount, total}`.
- Llamarla desde `createInvoice` (A1) y desde la UI en JS (replicada). Se acepta la duplicación cliente/servidor por simplicidad, pero **mismo algoritmo, ambos lugares**.
- **No tocar `generateInvoice`** (POS) ni el cálculo del POS/checkout (`orders.js`, `store/routes.js`): siguen siendo un IVA único, no soportan mixtos. Capa 2 está congelada (CANON sección 5), no le añadimos complejidad.

**UI:**
- En el form `/admin/invoices/new`: añadir columna "IVA" en la tabla de líneas, dropdown con las tasas válidas del país (leídas de `country_configs.tax_rates` por primera vez en la historia — resolver el "código muerto"). Por defecto la mayoritaria del país (`tax_default`).
- En la vista imprimible: añadir bloque "Desglose IVA" listando cada tasa, base y amount. Si solo hay una tasa, mantener el resumen actual (`IVA 21%: 57.75 €`).

### Para IRPF, hay que decidir si es global o por línea

**Mi recomendación: GLOBAL.**
- En la práctica del autónomo de servicios español, **el IRPF se aplica al total de la factura** (a la base imponible global), no por línea. Para "servicios profesionales" suele ser 15 % (o 7 % los primeros 3 años) sobre la suma de bases.
- En contabilidad y modelos AEAT (130, 111), el IRPF aparece como **una retención por factura**, no por concepto.
- Decisión técnica simple: 2 columnas en `invoices` (`irpf_rate REAL DEFAULT 0`, `irpf_amount REAL DEFAULT 0`), nada en `invoice_items`. Cálculo: `irpf_amount = subtotal × (irpf_rate/100)` (la retención se calcula sobre la base imponible, no sobre el total con IVA). Total final: `total = subtotal + tax_amount − irpf_amount`.
- En la UI: un solo campo "IRPF (%)" con dropdown sugerido (`0, 7, 15` para ES) + input libre. Solo se muestra si `country='ES'` (por ahora; cuando entren otros países, ampliar).

### Reglas de cálculo claras para A2

```
Por línea i:
  line_base_i     = quantity_i × unit_price_i        (lo que ya guardamos en total_price)
  line_tax_amt_i  = round2(line_base_i × tax_rate_i / 100)

Agregados:
  subtotal        = Σ line_base_i
  tax_amount      = Σ line_tax_amt_i                 (se guarda también en invoices.tax_amount)
  irpf_amount     = round2(subtotal × irpf_rate / 100)
  total           = subtotal + tax_amount − irpf_amount
```

Importante: **redondear por línea, luego sumar** (Verifactu-friendly) y **no** redondear el total agregado. Si redondeas el total y vuelves a calcular las líneas, los números no cuadran.

---

## 6. Bloqueos / dependencias

**Antes de meter mano a A2, hay que decidir 3 cosas:**

1. **¿Tabla `invoice_items` lleva las nuevas columnas obligatorias o opcionales con default 0?**
   - **Recomendación: con DEFAULT 0**, para que las facturas viejas (que tienen líneas sin tasa registrada) sigan abriéndose sin error. La factura vieja se interpretará como "todas las líneas al 0%" globalmente, pero como `invoices.tax_amount` global está intacto, el total imprime correctamente. **Cero regresión.**
2. **¿Migración de líneas existentes?**
   - Hay 3 facturas de smoke test en `desarrollo-bamburu.db` y posiblemente facturas reales en otros tenants. Lo simple: dejar las líneas existentes con `tax_rate = 0, tax_amount = 0` (vienen del default). El total de la factura sigue cuadrando porque el IVA estaba en `invoices.tax_amount`. **No rellenar retroactivamente** — sería tocar histórico fiscal.
3. **¿IRPF se expone solo a tenants con `country='ES'`?**
   - **Recomendación: sí, por ahora.** Cuando entre MX/CO real, evaluamos. Mantenerlo enchufable. En la UI: si país != ES, ocultar el campo IRPF. En backend: si país != ES, ignorar `irpf_rate` aunque venga en el payload (no fallar, simplemente trato como 0).

**No bloqueante pero conviene resolver dentro de A2 (decisión de scope):**

- **El bug de DISA escribiendo facturas sin hash** (`disa/index.js:338-355`). Es independiente, pero si A2 toca el contrato de "qué es una factura válida", conviene aprovechar y migrar DISA a llamar `createInvoice` en vez de hacer INSERT a pelo. **Sin esto, una factura emitida por DISA puede aparecer con desglose de IVA pero sin hash Verifactu — riesgo real cuando IVA múltiple llegue al PDF/QR de A4-A5.**

**Bloqueador potencial (pero pequeño):**

- `companySchema = z.object({}).passthrough()` permite que `tax_rate` viaje sin validación. Para A2 conviene **endurecer el schema** con `z.coerce.number().min(0).max(50)` o similar. Es un cambio de 3 líneas pero importante para que el IVA mixto no admita valores raros.

**Dependencia conceptual:**

- A2 no necesita A3 (catálogo de servicios). Las dos son independientes.
- A2 SÍ habilita A4 (PDF) y A5 (QR Verifactu) — sin desglose por tasa, el QR oficial Verifactu queda incompleto. **A2 antes de A4-A5, como el TABLERO ya indica.**

---

## TL;DR

- **IRPF** = columnas nuevas en `invoices`, global por factura, solo ES por ahora.
- **IVA múltiple** = 2 columnas nuevas en `invoice_items` (`tax_rate`, `tax_amount`) + cálculo agregado en `invoices`.
- **No tocar POS ni checkout** (Capa 2 congelada, IVA único intacto).
- **Centralizar el cálculo** en una helper para que UI y backend hagan lo mismo, sin duplicar fórmulas.
- **Conectar por primera vez `country_configs.tax_rates`** para el dropdown del form.
- **Arreglar el bug latente de DISA escribiendo facturas sin hash** mientras estamos en zona — coste marginal bajo, beneficio fiscal alto.
