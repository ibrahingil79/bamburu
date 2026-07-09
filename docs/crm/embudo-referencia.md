# Embudo de oportunidades — investigación contra los CRM de referencia

> Fuente de las decisiones de `modules/erp/crm.js` (etapas, estados, probabilidades, motivo de
> pérdida, origen). **Verificado en fuente oficial**, no de memoria (regla del proyecto: legal y
> estructural se comprueba en la fuente). Lo que no pudo comprobarse va marcado **NO VERIFICADO**.
>
> Fecha: 2026-07-08. Referencias del CANON §1 (copiar de los líderes: Salesforce, SAP, Odoo, Sage)
> y del competidor directo (Holded).

---

## 1. La pregunta que decide la arquitectura: ¿Ganada/Perdida es una ETAPA o un ESTADO?

| Producto | Modelo | Evidencia |
|---|---|---|
| **Salesforce** | **Etapa** — `Closed Won`/`Closed Lost` son valores de `StageName`, con flags `won`/`closed` en el picklist | [UI API · Opportunity Stage picklist values](https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_opportunity_stage_picklist_values.htm) |
| **HubSpot** | **Etapa** con *stage type* `Won`/`Lost`. Literal: *"Won and Lost are closed stages"* | [KB · Set up and customize pipelines](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines) |
| **Pipedrive** | **Estado separado** — `status ∈ {open, won, lost}`, ortogonal a `stage_id`. `lost_reason`: *"Can only be set if deal status is lost"* | [API v1 · Deals](https://developers.pipedrive.com/docs/api/v1/Deals) |
| **Holded** | **Estado separado** — Abierto / Ganado / Perdido sobre la etapa del embudo | [Gestionar el listado de oportunidades](https://help.holded.com/es/articles/7890768-gestionar-el-listado-de-oportunidades) |

**Los dos productos del segmento PYME/autónomo (Pipedrive y Holded, este último competidor directo
español) eligen estado separado.** Los dos *enterprise* lo meten como etapa, herencia de tener
*forecast categories* y *sales processes* por record type.

### Decisión de Bamburu: **estado separado**

```
status: 'activa' | 'ganada' | 'perdida'      -- terminal: ganada, perdida
stage:  etapa abierta; SE CONSERVA al cerrar
lost_reason: obligatorio si status='perdida'
```

Cinco razones, todas apoyadas en lo encontrado:

1. Es el modelo de las dos referencias del segmento.
2. `lost_reason` cuelga limpiamente del estado, no de la etapa. Pipedrive lo formaliza como
   invariante de datos (*"can only be set if deal status is lost"*).
3. **Conserva la etapa en la que se perdió.** Si "Perdida" fuese una etapa, ese dato se destruye —
   y "¿se me caen en el presupuesto o en la negociación?" es la métrica que de verdad le sirve a un
   autónomo. En Bamburu, `opportunities.stage` de una perdida **es** ese dato: sin columna extra.
4. Con etapas-desenlace acabas necesitando los flags `IsClosed`/`IsWon` de Salesforce o el
   *stage type* de HubSpot: complejidad accidental para reintroducir la dimensión que colapsaste.
5. Permite **reabrir** sin inventar una transición de etapa. (Implementado: `reopenOpportunitySvc`.)

---

## 2. Etapas por defecto de cada producto

### Salesforce — `Opportunity.StageName`
Fuente: [KB 000384457 · Default Standard Picklist Field Values](https://help.salesforce.com/s/articleView?id=000384457&language=en_US&type=1)

| # | Stage | Prob. | Tipo |
|---|---|---|---|
| 1 | Prospecting | 10% | Open |
| 2 | Qualification | 10% | Open |
| 3 | Needs Analysis | 20% | Open |
| 4 | Value Proposition | 50% | Open |
| 5 | ID Decision Makers | 60% | Open |
| 6 | Perception Analysis | 70% | Open |
| 7 | Proposal/Price Quote | 75% | Open |
| 8 | Negotiation/Review | 90% | Open |
| 9 | Closed Won | 100% | Closed Won |
| 10 | Closed Lost | 0% | Closed Lost |

Cada etapa lleva `defaultProbability`, `forecastCategoryName`, `won` y `closed` (UI API, v41.0+).
- **NO VERIFICADO:** ortografía exacta `ID Decision Makers` vs `Id. Decision Makers`.
- **NO VERIFICADO:** el mapeo por defecto etapa→forecast category. *Ninguna* fuente, oficial o no,
  lo publica completo. No se rellena de memoria.

### HubSpot — deal stages por defecto
Fuente: [KB · Set up and customize pipelines](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines)

Appointment scheduled 20% · Qualified to buy 40% · Presentation scheduled 60% ·
Decision maker bought-in 80% · Contract sent 90% · **Closed won 100%** · **Closed lost 0%**

La probabilidad se recalcula sola al mover de etapa ([default deal properties](https://knowledge.hubspot.com/properties/hubspots-default-deal-properties)).

### Pipedrive — pipeline por defecto
Qualified · Contact Made · Demo Scheduled · Proposal Made · Negotiations Started

- **PARCIALMENTE VERIFICADO.** El doc oficial confirma *"a sample five-stage pipeline"* pero **no
  enumera los nombres** ([customize pipeline stages](https://support.pipedrive.com/en/article/how-can-i-customize-my-pipeline-stages)).
  El único confirmado en doc oficial es el último: *"Negotiations started — the final stage in our
  pipeline"*. Los otros cuatro los corrobora la comunidad, no un artículo oficial.
- **Probabilidad: no hay defaults.** Es *opt-in* (stage probability y/o deal probability), y
  *"when both are enabled, the deal probability overrides the stage probability"*.

### Holded — el competidor directo
Fuente: [Crear un embudo de ventas](https://help.holded.com/es/articles/7888448-crear-un-embudo-de-ventas)

> **"Por defecto aparecerán 4 etapas."**

- **NO VERIFICADO:** los NOMBRES de esas 4 etapas. No los publica ninguna fuente (revisados los 5
  artículos de la colección ES, la guía EN y el sitio de producto).
- Nomenclatura: el módulo se llama **CRM**; la colección de ayuda, **"Embudo de ventas"**; las
  entidades son **embudos** y **oportunidades** (no "negocios" ni "deals").
- Campos confirmados: valor económico, etapa, responsable, **fecha de cierre prevista**,
  **probabilidad de éxito** (*"en función de la etapa"*), notas, actividades, historial, documentos
  de venta vinculados. **Campo "origen": NO documentado.**
- **Motivo de pérdida: existe y es configurable por embudo**, híbrido picklist + comentario libre
  ([Configurar el CRM](https://help.holded.com/es/articles/6984735-configurar-el-crm)).

---

## 3. Motivo de pérdida — el hallazgo

| Producto | `lost_reason` | ¿Trae valores por defecto? |
|---|---|---|
| Salesforce | **No existe campo estándar** (se hace custom picklist + validation rule) | No aplica |
| Pipedrive | Texto libre; picklist opcional; ambos combinables | **No** |
| HubSpot | Propiedad `Closed Lost Reason`, opciones personalizables | **No documentados** |
| Holded | "Razones de pérdida" por embudo + comentario libre | **No** |

**Ningún CRM de referencia envía una lista de motivos de pérdida por defecto.** Los cuatro la dejan
vacía y personalizable. Cualquier lista "canónica" que circule es folclore de consultoría.

→ La lista de `MOTIVOS_PERDIDA` en `crm.js` es **propuesta razonada, no dato de fuente**, y se dice
así en el código. Se copia de Pipedrive/Holded el **modelo híbrido**: picklist + texto libre
conviviendo, con `otro` exigiendo la nota.

---

## 4. Origen (`source`)

| Producto | Campo | Valores |
|---|---|---|
| **Salesforce** | `LeadSource` — StandardValueSet **compartido** por Lead, Contact, Account, Opportunity y CampaignMember | Advertisement · Employee Referral · External Referral · Partner · Public Relations · Seminar Internal · Seminar Partner · Trade Show · Web · Word of mouth · Other |
| HubSpot | No hay "Deal source". Sí `Original Traffic Source` (no editable, **heredado del contacto**) y `Record Source` | Organic search, Paid search, Email marketing… *(PARCIALMENTE VERIFICADO)* |
| Pipedrive | **NO VERIFICADO** en el objeto Deal | — |
| Holded | **No documentado** | — |

La de Salesforce es la única lista de origen **verificada en doc oficial**
([KB 000384457](https://help.salesforce.com/s/articleView?id=000384457&language=en_US&type=1)).
Aviso: la lista que suele citarse de memoria (Web, Phone Inquiry, Partner Referral, Purchased List,
Other) **no coincide** con la del KB oficial y queda **NO VERIFICADA**.

→ `ORIGENES` en `crm.js` es esa lista, podada de lo que no existe en la vida de un autónomo
(Seminar Partner, Public Relations) y con "Recomendación" fusionando *Word of mouth* + *External
Referral*, que es su canal número uno real.

---

## 5. Lo que Bamburu adopta, y por qué

| Decisión | Copiado de | Motivo |
|---|---|---|
| `status` separado de `stage` | Pipedrive + Holded | Conserva la etapa en la que se perdió; `lost_reason` cuelga del estado |
| **4** etapas abiertas | Holded (4 por defecto) | PD/HS traen 5, pero incluyen etapas de *evento de calendario* (Demo/Appointment/Presentation Scheduled): artefactos de venta SaaS con comité de compra |
| Descartar las 8 abiertas de Salesforce | — | Value Proposition, Id. Decision Makers, Perception Analysis son de venta enterprise; su gradiente 50/60/70% exige volumen histórico para calibrarse |
| "Presupuesto enviado" | SF *Proposal/Price Quote*, PD *Proposal Made*, HS *Contract sent* | Los tres nombran la etapa **por el artefacto entregado**. En Bamburu ese artefacto ya existe, con su cadena presupuesto→pedido→factura |
| "Cualificado" (participio) | PD *Qualified*, HS *Qualified to buy* | El hito superado, no el proceso en curso. Hace inequívoco el drag & drop |
| Probabilidad NO se pisa si el usuario la tocó | Pipedrive (*"deal probability overrides stage probability"*) | HubSpot la sobreescribe siempre; con ciclo corto y poco volumen eso produce previsiones basura |
| `otro` exige nota | Pipedrive + Holded (híbrido) | Un "Otro" sin explicación no es un motivo, es un agujero |

### Embudo resultante

| # | Etapa | Prob. |
|---|---|---|
| 1 | Nuevo contacto | 10% |
| 2 | Cualificado | 30% |
| 3 | Presupuesto enviado | 60% |
| 4 | Negociación | 85% |

Estados terminales: **Ganada** · **Perdida** (con motivo).

Las probabilidades 10/30/60/85 son **interpolación razonada** entre SF (10/10/20/50/60/70/75/90) y
HS (20/40/60/80/90). Es decisión de diseño, no dato de fuente, y así consta en el código.

---

## 6. Resumen de lo NO VERIFICADO

1. Encabezado literal de la 3ª columna del KB de Salesforce (`Type` vs otra cosa) — las celdas
   (Open/Closed Won/Closed Lost) descartan que sea *forecast category*.
2. Ortografía exacta `Id. Decision Makers` / `ID Decision Makers`.
3. Mapeo por defecto etapa→forecast category de Salesforce (ninguna fuente lo publica completo).
4. Que `Lead.LeadSource` traiga Web / Phone Inquiry / Partner Referral / Purchased List / Other.
   El KB oficial da otra lista.
5. Que "lost reason" no exista como campo estándar en Salesforce (evidencia solo secundaria).
6. Los 4 nombres de las etapas por defecto de **Holded** (confirmado que son 4; nombres no
   documentados en ninguna parte).
7. Existencia de campo "origen" en Holded y en el objeto Deal de Pipedrive.
8. Valores por defecto de `Closed Lost Reason` en HubSpot (probablemente no existen).
9. Nombres de las 4 primeras etapas por defecto de Pipedrive en doc oficial (solo
   `Negotiations started` está confirmado oficialmente).
10. Valores de `Original Traffic Source` de HubSpot (vía buscador, página no renderizada).
11. Nombres de campo exactos de la API de Holded (`developers.holded.com` redirige 301).

> Nota de método: `help.salesforce.com` con `type=5` y buena parte de `developer.salesforce.com` se
> renderizan por JS y no devuelven contenido a un fetch. Sí renderiza la base de conocimiento
> (`type=1`), que es de donde sale la tabla de etapas.
