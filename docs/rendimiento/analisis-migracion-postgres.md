# Análisis — Migración SQLite → PostgreSQL

**Fecha:** 2026-08-31 · **Tipo:** solo lectura, con medición directa sobre el árbol.
**Encargo:** medir de verdad el coste, no estimarlo.

## 1 · Cuánto código habla con SQLite

`new Database(` aparece **313 veces en 240 ficheros**, pero ese número mezcla producción con gates.
Separado:

| Zona | Ficheros | Líneas | `new Database` | `.prepare(` | `.transaction(` |
|---|---|---|---|---|---|
| `index.js` | 1 | 1.600 | 1 | 5 | 0 |
| `core/` | 27 | 2.859 | 5 | 100 | 4 |
| `modules/` | 142 | 66.334 | 6 | 1.540 | 92 |
| **Producción** | **170** | **70.793** | **12** | **1.645** | **96** |
| `scripts/` (gates y tests) | 267 | 49.602 | 301 | 2.758 | 17 |

**125 de los 170 ficheros de producción tocan la base**, con **2.012 líneas** que contienen una
llamada a la BD.

## 2 · Qué cambios habría que hacer

**El coste no está en el SQL. Está en que `better-sqlite3` es síncrono y cualquier driver de
Postgres es asíncrono.**

Hoy `db.prepare(sql).get(id)` devuelve en la línea siguiente. Con Postgres es `await`, y eso
**contagia hacia arriba** por toda la cadena de llamadas.

Medido: producción tiene **5.467 funciones y solo 401 son `async`**. De los 125 ficheros que tocan
la BD, **57 no tienen una sola línea `async`** (conversión completa) y 68 la tienen a medias.

**Dialecto SQL — el problema pequeño:**

| Patrón SQLite | Usos | En Postgres |
|---|---|---|
| `lastInsertRowid` | 90 | `RETURNING id` |
| `INSERT OR IGNORE/REPLACE` | 49 | `ON CONFLICT` |
| `AUTOINCREMENT` / `INTEGER PRIMARY KEY` | 222 | `GENERATED AS IDENTITY` |
| `CURRENT_TIMESTAMP` | 152 | igual, distinto tipo |
| `.changes` | 23 | `rowCount` |
| `PRAGMA` | 13 | no existe |
| `datetime('now')`, `strftime`, `substr` | 24 | `now()`, `to_char`, `substring` |

Más los placeholders `?` → `$1, $2`. Mecánico y buscable.

**Los tres patrones de Bamburu que se rompen de verdad:**

1. **Un fichero por negocio deja de existir.** `core/tenant-middleware.js` abre
   `data/tenants/<slug>.db`. En Postgres: base o esquema por negocio, `SET search_path` por petición
   y pool de conexiones. **El aislamiento deja de ser del sistema de ficheros y pasa a ser una línea
   de código que se puede olvidar.** Hoy un fallo de aislamiento es imposible; después es un bug.
2. **Las transacciones cambian de naturaleza.** Hay **96 `db.transaction(...)`**, hoy síncronas y
   atómicas por construcción. Pasan a `BEGIN/COMMIT` sobre una conexión del pool con `await` dentro;
   equivocarse de conexión parte la transacción. Emitir factura (inserción + líneas + registro
   VERI*FACTU) es exactamente esto.
3. **Las migraciones.** **221 sentencias DDL** que hoy corren perezosamente al abrir cada negocio.

**Esquema a portar:** 134 tablas + 147 índices + 1 trigger por negocio; 14 tablas en `control.db`.

## 3 · Tiempo real

Reparto de los 125 ficheros por peso medido:

| Bucket | Ficheros | Horas/fichero | Total |
|---|---|---|---|
| Muy pesados (50+ consultas) | 7 | 12–20 h | 84–140 h |
| Pesados (20–49) | 18 | 6–10 h | 108–180 h |
| Medios (5–19) | 49 | 2–4 h | 98–196 h |
| Ligeros (<5) | 51 | 0,5–1 h | 26–51 h |
| **Subtotal código** | **125** | | **316–567 h** |

Los siete muy pesados: `models.js` (363 consultas), `disa/index.js` (102), `invoices.js` (90),
`citas.js` (83), `control-db.js` (78), `store/routes.js` (57), `quotes.js` (54).

| Pieza adicional | Horas |
|---|---|
| Arquitectura: pool, esquemas, `search_path`, aislamiento | 40–70 |
| Esquema + 221 DDL a herramienta de migración | 30–50 |
| Migración de datos y reconciliación de 9 negocios | 25–40 |
| **267 scripts de gates y tests** | 120–200 |
| Carga, comparación y despliegue con vuelta atrás | 40–60 |
| **TOTAL** | **571–987 h** |

**14–25 semanas** de una persona a jornada completa. Con VERI*FACTU y libros contables de por medio
—donde un error no es aceptable— la parte alta es la realista. **«Semanas» era optimista: es medio
año.**

Coste no listado: el 100 % del sistema de comprobaciones (267 scripts) se apoya en abrir ficheros
SQLite en memoria. Migrarlo o tirarlo es el segundo bloque más grande del proyecto.

## 4 · Cómo lo hacen los referentes

**Odoo — una base de datos por cliente.** PostgreSQL, una base entera por tenant, enrutado por
`dbfilter`, **PgBouncer** para el pooling. Es **el mismo modelo que Bamburu tiene hoy**, cambiando
fichero por base. El aislamiento sigue siendo estructural.

**Salesforce — lo contrario: una sola base compartida.** Miles de organizaciones por instancia en
**tablas comunes**, separadas por `OrgID`. Los objetos de cada cliente son metadatos en un
diccionario universal (UDD) sobre columnas *flex*. Diseñado para cientos de miles de tenants; el
precio es complejidad enorme y un aislamiento que depende de no olvidar nunca el filtro.

**Para Bamburu el patrón correcto es el de Odoo.** El de Salesforce resuelve un problema que no
tiene y sacrifica justo lo que hoy sale gratis.

## Conclusión

**Postgres NO es lo que arregla el congelamiento.** Lo que lo arregla es sacar la base del hilo
principal; Postgres lo consigue de rebote, y se paga medio año por ello.

Estado medido: 9 negocios, **cero incidentes de bloqueo desde junio**, capacidad sobrada por dos
órdenes de magnitud. Migrar hoy es pagar 600–1.000 h por un problema que no ha ocurrido nunca, y
**cambiar la mejor propiedad del producto (aislamiento estructural) por la peor de Salesforce**.

**Orden recomendado:** (1) temporizadores en solo lectura · (2) `busy_timeout` bajo · (3) un solo
escritor · (4) opción B, varios procesos con afinidad · (5) Postgres, cuando el número de negocios
lo justifique.

**Sin medir todavía, y merece su propio análisis:** `worker_threads` con better-sqlite3 — saca las
consultas del hilo principal manteniendo SQLite y el aislamiento por fichero. Es la opción C sin el
coste de cambiar de motor.
