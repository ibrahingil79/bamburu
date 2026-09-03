# Diagnóstico — qué límites tiene hoy una consulta de DISA

> **Paso 0 de la tarea `disa-sql-sin-limite-ni-timeout`** (BLOQUE 2 · AUD-005).
> Solo lectura: escrito **antes** de tocar una línea de código, el 3 sep 2026.
> Todo lo que va aquí está **medido contra el código y las bases de HOY**.

---

## 1. Todos los caminos por los que DISA acaba consultando datos

No es solo `query_database`. Al mirar el despacho de herramientas (`ejecutarHerramienta`) hay **tres
familias**, más el contexto que se inyecta en cada mensaje:

| Camino | Qué ejecuta | Tope de filas | Plazo | Qué viaja al proveedor |
|---|---|---|---|---|
| **`query_database`** | **SQL libre escrito por el modelo**, `db.prepare(sql).all()` | ❌ **ninguno** | ❌ **ninguno** | ❌ **el resultado ENTERO** |
| Informes (`abrir`, `componer`) | recetas fijas por `cruzar()` | ✅ 30 filas (servidor) | ❌ ninguno | las 30 filas |
| Descuentos | consultas fijas por `id` | ✅ por diseño (una fila) | ❌ ninguno | poco |
| Contexto del mensaje | ~19 consultas fijas | ✅ `LIMIT` escrito en cada una | ❌ ninguno | el bloque de contexto |

**El agujero grande está en `query_database`, y es el único donde el SQL lo escribe el modelo.** Los
otros tres ejecutan consultas que están escritas en el repo: su forma no la decide nadie de fuera.

---

## 2. El tope de filas se le PIDE al modelo, que es como no tenerlo

La descripción de la herramienta que se le manda a la IA termina así, literal:

> *«Solo lectura. Usa LIMIT 20 como maximo.»*

Y el servidor ejecuta lo que venga:

```js
const rows = db.prepare(sql).all();
return { rows, count: rows.length };
```

**Un ruego, no un tope.** Si el modelo se olvida, alucina, o alguien le mete texto por una factura
adjunta para que escriba otra cosa, no hay nada detrás que lo pare. Y no es teórico: **el resultado
entero se serializa con `JSON.stringify` y viaja al proveedor de IA** dentro del `tool_result`.

**Medido en `desarrollo-bamburu` (el negocio real más grande), en KB de JSON que saldrían por la red:**

| Consulta | Filas | JSON al proveedor |
|---|---|---|
| `SELECT * FROM invoices` | 928 | **1.098 KB** (más de 1 MB) |
| `SELECT * FROM ledger_lines` | 5.585 | 595 KB |
| `SELECT * FROM clients` | 212 | 117 KB |
| `SELECT * FROM products` | 176 | 105 KB |

Un solo mensaje puede gastar **8 herramientas** (`MAX_HERRAMIENTAS_POR_MENSAJE`), así que el techo de
hoy es del orden de **8 MB de datos del negocio** enviados al proveedor por un mensaje de chat. Con
el añadido de que ahí van **los datos de los clientes del cliente**: nombres, NIF, direcciones,
importes.

---

## 3. El plazo no existe — y el problema es peor que la espera

`better-sqlite3` es **síncrono**. Una consulta lenta no solo tarda: **bloquea el bucle de eventos de
Node**, o sea **el servidor entero, para TODOS los negocios**. Mientras corre, ningún otro cliente
recibe respuesta.

**Medido hoy** sobre `desarrollo-bamburu`, con un cruce de `ledger_lines` consigo misma:

- `SELECT a.id FROM ledger_lines a, ledger_lines b` → produce filas enseguida; **se puede cortar**
  entre filas (se cortó a los 501 ms tras 567.234 filas).
- `SELECT a.id FROM … ORDER BY (a.id * b.id)` → SQLite **tiene que ordenarlo todo antes de dar la
  primera fila**: **10.623 ms hasta la primera fila**.

**Ese segundo caso es el que decide el diseño**, y conviene decirlo claro:

> **Un reloj «entre filas» NO sirve.** Si la consulta tarda diez segundos en producir la primera
> fila, un contador que se mira en cada fila **no llega a mirarse ni una vez**. Y `better-sqlite3`
> **no expone `interrupt()`** (comprobado: `typeof db.interrupt === 'undefined'`), así que desde el
> mismo hilo no hay forma de abortarla.

**La única manera de cancelar DE VERDAD —y de que el negocio siga respondiendo mientras tanto, que es
lo que pide el encargo— es ejecutar la consulta en otro hilo y matarlo al vencer el plazo.**

---

## 4. El recorte silencioso, que además ya existe en otro sitio

`cruzar()` (`modules/erp/constructor-analitica.js:978`) **sí** recorta y **sí** devuelve la bandera:

```js
filas: filas.slice(0, limit), truncado: filas.length > limit
```

…pero las herramientas de informes de DISA **se la comen**: `abrir()` y `componer()` devuelven
`{ filas, total_filas }` y **tiran `r.truncado`**. Resultado: DISA recibe 30 filas y **ninguna señal
de que había más**, así que puede contestar «tus cinco mejores clientes son…» sobre una lista
recortada y darla por completa.

**No estaba en la ficha, es el mismo defecto que el criterio 3 describe, y se arregla aquí.**

---

## 5. Lo que NO está roto, y no se toca

- **La allowlist de permisos funciona y se queda igual.** `evaluateQueryAccess` es pura, está
  exportada y probada: exige `SELECT`, bloquea tablas protegidas y, salvo owner/admin, exige permiso
  por cada tabla referida. **Esta tarea añade tope y reloj; no rehace eso.**
- **El saneado del SQL para el registro** (`redactarSql`) ya existe y va después del control de
  acceso, que es el orden correcto.
- Los otros tres caminos ya tienen su tope escrito en el repo. Lo que les falta es el **plazo** y, en
  informes, **decir que recortó**.

---

## 6. Lo que NO contradice al tablero, y una cosa que lo amplía

La ficha dice *«se ejecuta `db.prepare(sql).all()` sin LIMIT y sin plazo»*: **es exacto**. Lo que la
ficha no dice, y sale de mirar:

1. **El recorte silencioso de las herramientas de informes** (§4) — mismo criterio 3, otro sitio.
2. **Que una consulta lenta bloquea el servidor para todos los negocios**, no solo para quien
   pregunta. Eso cambia el diseño: no basta con dejar de esperar.

Ninguna de las dos contradice al tablero; las dos lo amplían, y las dos se resuelven aquí.

---

## 7. Los valores, decididos con criterio y en un solo sitio

Van a vivir juntos, con su motivo escrito, en `modules/disa/limites-consulta.js` — la lección de la
llave del cobro: *una regla repartida a mano por el código vuelve en cuanto alguien la olvida.*

- **`MAX_FILAS = 200`.** El techo de lo que sirve para responder por chat. La herramienta le pide al
  modelo 20 y las respuestas útiles caben ahí; 200 deja margen para un listado de verdad
  —«mis clientes de Madrid»— sin acercarse a los 1.098 KB que hoy se irían con una tabla entera.
  Con 200 filas de la tabla más gorda medida, el envío queda en ~240 KB.
- **`PLAZO_MS = 5000`.** Cinco segundos. Una consulta de chat que tarda más ya no sirve para
  conversar, y el modelo tiene su propio plazo por encima. Es holgado para cualquier consulta
  legítima sobre estas bases (la más lenta medida sin cruce artificial no llega a 100 ms) y corta en
  seco las que solo pueden venir de un error o de un abuso.

---

## 8. Las comprobaciones, definidas ANTES de construir

1. **El fallo actual, primero en ROJO:** con la vía vieja, una consulta sin `LIMIT` sobre una tabla
   sembrada por encima del tope se trae **todas** las filas, y una consulta lenta **no la corta
   nadie**. Es la línea base.
2. **Con el arreglo:** la misma consulta vuelve con **exactamente `MAX_FILAS`**, y **el aviso de
   recorte está en el resultado** que ve DISA **y en el registro**.
3. **El tope lo impone el servidor:** una consulta que pide `LIMIT 5000` vuelve igualmente recortada.
   No depende de lo que escriba el modelo.
4. **La consulta lenta se cancela de verdad** al cumplirse el plazo, el error **se maneja** (no se
   traga), queda **anotado**, y **el servidor sigue respondiendo mientras tanto** — se comprueba
   pidiendo otra cosa por HTTP durante la consulta lenta.
5. **Informes: el recorte se anuncia.** Un panel con más filas que el tope devuelve su aviso.
6. **La allowlist sigue igual:** las mismas consultas que se denegaban antes se deniegan ahora.
7. **Un centinela** que falle si alguien añade un camino de consulta de DISA sin tope o sin reloj,
   **probado poniéndolo en rojo primero**.
8. **Nada que se trague un error**, y el negocio de prueba se tira con `tirarNegocio()`.
9. Se usa la **costura `executeAction`** de la tarea anterior: nada depende de que el proveedor de IA
   conteste.
