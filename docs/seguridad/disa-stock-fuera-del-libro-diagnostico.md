# Diagnóstico — dónde se escriben las existencias saltándose el libro

> **Paso 0 de la tarea `disa-stock-fuera-del-libro`** (BLOQUE 2 · AUD-004).
> Solo lectura: escrito **antes** de tocar una línea de código, el 3 sep 2026.
> Todo lo que va aquí está **medido contra el código y las bases de HOY**.

---

## 1. Cómo se mueve el stock cuando se hace bien

`products.stock` **no es un dato: es una caché derivada.** La verdad vive en `stock_movements`, un
libro *append-only* de deltas con signo, y `recomputeStock()` (`modules/erp/stock.js:124`) recalcula
desde él el saldo **y el coste medio (WAC)**. Es el **único** sitio del producto autorizado a escribir
`products.stock`, y lo hace siempre a partir de la suma del libro.

Para cambiar existencias a mano ya existe el servicio: **`adjustStock()`**
(`modules/erp/stock.js:182`). Hace, en este orden:

1. rechaza si el producto no existe (404) o **no es físico** (400);
2. rechaza si el producto lleva **traza por lote/serie** (400) — ajustar sin lote descuadraría el saldo;
3. exige **modo** de la lista cerrada (`set`/`add`/`sub`) y **motivo** de `ADJUST_REASONS` (400);
4. calcula el delta **contra el saldo de ese almacén**;
5. **avisa con 409** si el ajuste dejaría el almacén por debajo de lo reservado por pedidos confirmados;
6. escribe **un** movimiento `type='ajuste'`, `origin_type='manual'` y recalcula caché y WAC.

La pantalla de inventario lo usa (`modules/erp/routes/products.js:170`) — y **DISA también lo usa ya**
en su acción `adjust_stock` (`modules/disa/index.js:726`). O sea: **el camino bueno existe y DISA lo
conoce.** Lo que falla es que tiene, además, otros por los que se cuela.

---

## 2. Todos los sitios que escriben existencias, uno a uno

| Sitio | Qué hace | Veredicto |
|---|---|---|
| `modules/erp/stock.js:141` `recomputeStock` | `UPDATE products SET stock=?, average_cost=?` desde la suma del libro | ✅ **el único legítimo** |
| `modules/erp/routes/products.js:78` `createProductSvc` | INSERT con el stock inicial **y acto seguido** `recordMovement(type:'apertura')` | ✅ legítimo (queda en el libro) |
| `modules/erp/models.js:559` | migración única que convirtió `products.stock` en caché: siembra la apertura y recalcula | ✅ legítimo (histórico) |
| `modules/erp/models.js:2426` | migración de servicios→productos; nace con `stock` 0 | ✅ legítimo |
| **`modules/disa/index.js:631`** `edit_product` | **`UPDATE products SET name=?, price=?, stock=?`** | ❌ **LA AVERÍA — AUD-004** |
| **`modules/disa/index.js:695`** `edit_variant` | **`UPDATE product_variants SET … stock=?`** | ❌ **segundo caso, no estaba en la ficha** |
| **`modules/disa/index.js:673`** `create_variant` | **`INSERT INTO product_variants (… stock)`** | ❌ **tercer caso, no estaba en la ficha** |
| `modules/erp/routes/products.js:288 y :296` | alta y edición de variante desde el ERP, con `stock` a pelo | ⚠️ **mismo patrón, camino HUMANO** (ver §4) |
| `modules/store/routes.js:1072 y :1074` | descuenta stock de producto y de variante al vender | ⚠️ **Capa 2 APAGADA**: `/store` responde **404** (medido) |

**Y lo que NO existe, comprobado para no dejar el barrido a medias:** DISA **no** tiene vía genérica de
escritura —`insert/update/delete_record` se retiró en el Saneamiento 2— y `query_database` **rechaza
todo lo que no empiece por `SELECT`** (`modules/disa/index.js:111`). Los tres casos de arriba son
**todos** los caminos por los que DISA puede tocar existencias.

---

## 3. Por qué `edit_product` es peor de lo que parece

No es solo que no deje rastro. Al escribir el número a pelo **se salta las seis guardas** de
`adjustStock`, todas de una vez:

- **Escribe stock en un producto que no es físico** (un servicio, un digital) — imposible por el servicio.
- **Escribe stock en un producto TRAZADO** por lote/serie, que el servicio rechaza a propósito porque
  descuadra el saldo por lotes.
- **Se salta el aviso de reserva:** puede dejar el almacén por debajo de lo reservado por pedidos
  confirmados sin que nadie lo confirme.
- **No tiene motivo ni almacén.** El libro exige un motivo de lista cerrada y opera por almacén; esto
  escribe un total sin decir de dónde sale ni por qué.
- **No toca `average_cost`**, así que el coste medio se queda con el de antes: la valoración de
  inventario miente a partir de ese momento.
- **Y la peor, porque es intermitente:** ese número **no sobrevive**. En cuanto el producto tenga
  cualquier movimiento real —una venta, una recepción, un ajuste—, `recomputeStock` recalcula desde el
  libro y **borra el valor que escribió DISA sin avisar a nadie**. O sea, el stock que el dueño ve tras
  hablar con DISA es una cifra que se evapora en un momento imposible de predecir. Un dato que unas
  veces está y otras no es peor que un dato malo fijo.

**Un detalle que baja la probabilidad pero no cierra el agujero:** `edit_product` **no está declarada
al modelo**. En `## ACCIONES DISPONIBLES` solo se documentan `create_product`, `adjust_stock` y
`transfer_stock`; `edit_product` y las tres de variante **no aparecen**. Pero **sí están en
`EXECUTABLE_ACTIONS`**, así que si la acción llega —por un texto raro, por una inyección, o el día que
alguien la documente— **se ejecuta**. Es el mismo patrón del `/clear` de AUD-002: viva y sin puerta.

---

## 4. ⚠️ LO QUE CONTRADICE A LA FICHA, Y NO LO DECIDO YO SOLO

**La ficha dice que el problema es `edit_product`. Son TRES caminos, no uno** — y los otros dos, los de
variante, plantean una decisión que no es de construcción:

**`stock_movements` NO puede registrar el stock de una variante.** Su esquema es `product_id`, sin
`variant_id` (comprobado en la base). El libro, el kardex, el WAC y la valoración son **por producto**.
Así que «pasar la variante por el libro» **no es enchufar un servicio: es construir un libro nuevo**,
con su migración, su coste medio y sus consumidores — Pilar 3 entero otra vez.

**Y el terreno donde vive eso está congelado y vacío:**

- El **único** consumidor vivo de `product_variants.stock` es `modules/store/routes.js`, la tienda
  pública, **apagada en D1**: `/store` responde **404**, medido hoy.
- El ERP **solo lista** variantes en la ficha del producto (`SELECT *`). Ni vende, ni reserva, ni
  valora, ni cuenta variantes en ninguna analítica.
- **Hay CERO variantes en los 87 negocios** (contadas una a una). Ni una fila.
- `CLAUDE.md`: *«NADA de Capa 2 (e-commerce: productos, inventario, POS, tienda) hasta cerrar Capa 1.
  Si una petición toca eso, avísame y recuérdame que está congelado.»*

**Lo que se construye, y por qué es la única opción que no rompe una norma:** DISA **deja de aceptar
`stock`** en `create_variant` y `edit_variant` — sigue pudiendo poner nombre, precio y SKU, y **dice
que no toca existencias y por dónde se hacen**. Así se cumple *«DISA nunca escribe el número
directamente»* **sin crear el camino paralelo** que el encargo prohíbe y **sin descongelar la Capa 2**.

> **Si Ibrahin prefiere lo contrario** —que las variantes lleven libro propio— **es otra tarea**, con
> su migración y su valoración. Queda dicho aquí, antes de construir, y no se elige por la puerta de
> atrás.

**El camino humano (`routes/products.js:288/296`) NO se toca:** no es DISA, es el mismo campo congelado
de Capa 2, y el encargo pide cambios quirúrgicos. **Se apunta en el TABLERO con su motivo.**

---

## 5. El hueco del «quién», que el libro hoy no tiene

El encargo pide que el movimiento lleve *«su quién, cuándo, cantidad y motivo»*. El libro tiene
**cuándo** (`created_at`), **cantidad** (`quantity`) y **motivo** (`reason`). **No tiene quién:**
`stock_movements` no tiene ninguna columna de usuario, ni por DISA ni por la pantalla. Hoy el «quién»
vive **en otra tabla**, `activity_logs`, atado por `logActivity`.

Así que aquí sí se **amplía el servicio, una vez y en un solo sitio** (que es lo que el encargo
autoriza): columna aditiva `created_by` en `stock_movements`, que rellena `recordMovement` cuando
quien llama pasa la sesión. Aditiva, por defecto `NULL`, sin tocar ningún movimiento existente y sin
cambiar el saldo de nadie: la suma del libro no depende de esa columna.

---

## 6. Las comprobaciones, definidas ANTES de construir

1. **El fallo actual, primero en ROJO.** Se ejecuta `edit_product` con `stock` sobre un producto de un
   negocio de usar y tirar y se exige: el stock cambió **y no hay movimiento nuevo**. Con el arreglo,
   la misma llamada tiene que dejar su apunte.
2. **El apunte, completo:** tras un cambio de stock por DISA existe UN movimiento `type='ajuste'` con
   **usuario, fecha, cantidad (con signo) y motivo**, y `products.stock` es **exactamente la suma del
   libro**.
3. **El WAC cuadra** después del ajuste, y la valoración de inventario y la analítica siguen cuadrando.
4. **Las guardas del servicio se aplican también a DISA:** un producto no físico y uno trazado se
   rechazan; el ajuste por debajo de lo reservado avisa en vez de pasar en silencio.
5. **Variantes:** DISA no cambia existencias de variante por ningún camino, y **lo dice** en vez de
   callarse.
6. **Un centinela** que falle si alguien vuelve a escribir existencias a pelo **en el fichero que
   sea**, con su lista de sitios legítimos declarada y **probado poniéndolo en ROJO** reintroduciendo
   la avería original.
7. **Nada que se trague un error:** lo que no se pueda comprobar, falla y lo dice.
8. **El negocio de prueba se tira al terminar** con `tirarNegocio()`, que suelta las ataduras
   preguntando al esquema — no con una lista a mano.
