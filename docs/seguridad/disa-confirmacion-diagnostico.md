# Diagnóstico — ¿sigue vivo el hallazgo de la confirmación permisiva?

> **Paso 0 de la tarea `disa-confirmacion-textual-estricta`** (BLOQUE 2 · AUD-015).
> Solo lectura: escrito **antes** de tocar una línea de código, el 3 sep 2026.
> La ficha decía: *«NO se ha comprobado si sigue vivo»*. Esto es esa comprobación.

---

## VEREDICTO: **NO ESTÁ VIVO.** La confirmación de DISA ya es estricta y determinista.

Y no está vivo por cuatro cerrojos distintos, cada uno tapando un agujero diferente. Lo que sigue es
**lo que se probó y con qué frases**, no un resumen de lo que dice el código.

---

## 1. Quién decide, y no es la IA

`modules/disa/index.js:2913-2924`. La decisión la toma **el servidor**, con una expresión regular
**anclada** (`^…$`) contra una **lista cerrada**:

```js
isConfirming = /^(sí|si|confirmo|adelante|ok|dale|hazlo|procede|yes|correcto|exacto)[.!]?$/i
  .test(message.trim());
```

**La IA nunca juzga si algo «sonaba a sí».** El modelo solo puede **proponer** —emitiendo un bloque
`[ACCION:{…}]`—, y si vuelve a emitirlo en el turno siguiente eso **crea una propuesta nueva**, no
ejecuta la anterior. No existe ningún camino por el que el texto del modelo dispare una ejecución.
*(La única acción que se ejecuta sin «¿confirmas?» es el handoff — §5.)*

---

## 2. Las frases ambiguas: probadas una a una contra el regex vivo

Ejecutado el 3 sep 2026 con la expresión copiada literalmente del fichero:

| Lo que escribe el usuario | Qué pasa |
|---|---|
| `sí, pero espera` | **cancela** ✓ |
| `sí a lo de antes` | **cancela** ✓ |
| `vale, ¿y si mejor no?` | **cancela** ✓ |
| `sí, aunque mejor no lo hagas` | **cancela** ✓ |
| `creo que sí` | **cancela** ✓ |
| `sí pero antes dime el precio` | **cancela** ✓ |
| `ok pero cambia la fecha` | **cancela** ✓ |
| `sí?` | **cancela** ✓ *(el `?` no está entre los signos admitidos; solo `.` y `!`)* |
| `si te parece bien hazlo tú` | **cancela** ✓ |
| `exactamente eso, pero con 20 unidades` | **cancela** ✓ |
| `no` / `no, déjalo` | **cancela** ✓ |

**Las once cancelan.** El ancla `^…$` es lo que las para: **un «sí» dentro de una frase no cuenta**,
solo un «sí» que sea la frase entera.

Y los que **sí** deben ejecutar siguen ejecutando —`sí`, `si`, `Sí`, `SÍ`, `sí.`, `sí!`, `confirmo`,
`adelante`, `ok`, `dale`, `hazlo`, `procede`, `yes`, `correcto`, `exacto`, y con espacios alrededor—,
porque `[.!]?`, la bandera `i` y el `.trim()` cubren mayúsculas, tildes y puntuación normal.

---

## 3. El «sí» tardío: la propuesta CADUCA sola

Era la parte que más podía sorprender, y se probó simulando el historial completo:

| Escenario | Resultado |
|---|---|
| **[A]** propuesta → `sí` | **ejecuta** ✓ (es lo que debe pasar) |
| **[B]** propuesta → *«¿cuántos clientes tengo?»* → respuesta → `sí` | **NO ejecuta** ✓ |
| **[D]** sin ninguna propuesta pendiente → `sí` | **NO ejecuta** ✓ |

**Por qué caduca, y es elegante:** la propuesta se lee de
`history.slice().reverse().find(m => m.role === 'assistant').pending_action`, o sea **solo del ÚLTIMO
mensaje del asistente**. Y `pending_action` **se adjunta únicamente cuando se propone algo nuevo**
(`modules/disa/index.js:3008-3011`): cualquier otra respuesta de DISA va sin él. Así que en cuanto el
usuario dice **cualquier otra cosa** entre medias, la propuesta deja de existir. **No hay que
acordarse de caducarla: no sobrevive.**

**Y un cerrojo más, en la base:** `claimConfirmation` hace
`UPDATE … SET status='confirmed' WHERE action_id=? AND action_type=? AND user_id=? AND status='proposed'`
y exige `changes === 1`. O sea que una propuesta **solo se puede confirmar UNA vez**, y **solo por el
mismo usuario que la recibió** — dos envíos, un reintento o un doble clic no la ejecutan dos veces.

---

## 4. Las acciones de seguridad piden una frase exacta, no un «sí»

`disable_2fa_user` no se confirma con «sí»: exige escribir **literalmente**
`CONFIRMAR DESACTIVAR 2FA`, comparado con `===` sobre el texto recortado. Probado:

| Respuesta | Qué pasa |
|---|---|
| `sí` / `confirmo` | **cancela** ✓ |
| `confirmar desactivar 2fa` (minúsculas) | **cancela** ✓ |
| `CONFIRMAR DESACTIVAR 2FA por favor` | **cancela** ✓ |
| `CONFIRMAR DESACTIVAR 2FA` | ejecuta ✓ |

---

## 5. Lo único que se ejecuta sin «¿confirmas?», y por qué NO es un agujero

`dictar_compra` está declarada como **handoff** (`HANDOFF_ACTIONS`) y se ejecuta en cuanto se detecta.
Se miró de cerca porque el encargo pide apuntar cualquier acción que cambie datos sin confirmación:

- **Lo que escribe:** una fila de `attachments` con la lectura de la compra — un **borrador**.
- **Lo que NO hace:** no crea la compra, **no mueve stock, no toca dinero, no emite nada**. Devuelve
  un enlace a `/admin/purchases/capture?attachment=…`, **donde está el confirm de verdad**, con el
  control visual y los datos editables delante.

O sea: el confirm no desaparece, **se muda a la pantalla**, que es donde el dueño puede ver lo que va
a guardar. **Es coherente con la ficha y no se toca** — además, qué acciones piden confirmación es
decisión de producto y el encargo lo deja explícitamente fuera. Se apunta en el TABLERO por
transparencia, no como defecto.

---

## 6. ¿Contradice algo del tablero?

**No.** La ficha no afirmaba que el hallazgo estuviera vivo: decía *«No se ha comprobado si sigue
vivo»* y *«La tarea empieza por comprobarlo. Si ya está bien, se cierra con la prueba escrita»*.
Eso es exactamente lo que ocurre. **Su criterio 4 —«Si el hallazgo ya no existe, se cierra con la
prueba y no se toca nada»— es el que aplica**, y por eso **no se cambia una sola línea de
comportamiento**.

---

## 7. Lo que sí se construye: la comprobación que impide que vuelva

El hallazgo no está vivo **hoy**. Lo que hace falta es que no pueda volver mañana con un retoque
inocente —quitar el ancla, añadir «quizá» a la lista, cambiar el `test` por un `includes`, o dejar
que el modelo decida—. Así que se añade `scripts/censo-disa-confirmacion.mjs`, que:

1. **Saca la expresión regular DEL FICHERO y la EJECUTA** contra la tabla de frases de §2. No es una
   copia: si alguien relaja la del producto, el censo prueba la relajada y se pone rojo. *(Un censo
   que valida su propia copia es el que dice cero sin ser cierto.)*
2. Exige que siga **anclada** (`^…$`) y que la lista sea **exactamente** la de hoy: una palabra de
   más o de menos es rojo, con su nombre.
3. Exige que la decisión **no dependa del modelo** y que las acciones de seguridad sigan comparando
   con **igualdad estricta**.
4. Exige que `claimConfirmation` siga siendo **de un solo uso** (`status='proposed'` en su `WHERE`).
5. **Se prueba a sí mismo** en cada pasada y **se demuestra en rojo** relajando la lista a propósito.
