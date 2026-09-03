# Diagnóstico — dónde viven las conversaciones de DISA y qué pasa al borrarlas

> **Paso 0 de la tarea `disa-borrado-global-conversaciones`** (BLOQUE 2 · AUD-002).
> Solo lectura: escrito **antes** de tocar una línea de código, el 3 sep 2026.
> Todo lo que va aquí está **medido contra el código y las bases de HOY**, no recordado.

---

## 1. Dónde viven las conversaciones

**En la base de datos del negocio, y en ningún sitio más.** No hay caché en memoria, ni fichero, ni
copia fuera de la `.db`: `grep` de `cache`/`Map()`/`memo` en `modules/disa/index.js` da **cero**.
El aislamiento entre negocios es **de fichero**: `data/tenants/<slug>.db`, una base por negocio.

Dos tablas, y la relación entre ellas es la única forma de saber de quién es una conversación:

| Tabla | Qué guarda | Columnas que importan |
|---|---|---|
| `disa_conversation_threads` | la conversación como objeto: título, dueño, si está a la vista | `id`, `user_id`, `is_active`, `pinned` |
| `disa_conversations` | **el texto de los mensajes**, en JSON | `id`, `messages`, `thread_id`, `agent_id` |

> ⚠️ **`disa_conversations` NO tiene `user_id`.** El dueño de un mensaje solo se sabe siguiendo
> `thread_id → disa_conversation_threads.user_id`. Cualquier borrado por usuario tiene que pasar por
> ese salto: no hay atajo, y un `DELETE` "por usuario" escrito de memoria sobre `disa_conversations`
> **no compila contra el esquema**. `disa_conversations` tampoco tiene índice por `thread_id`
> (`sqlite_master` da cero índices sobre esa tabla).

**Lo medido en las bases de hoy** (`data/tenants/`):

| Negocio | `disa_conversations` | `disa_conversation_threads` |
|---|---|---|
| `desarrollo-bamburu` | **105** (96 KB de texto) | 60 |
| `duniya` | 1 | 1 |
| `peluqueria-gil` | 0 | 0 |

---

## 2. Cómo se borra hoy una conversación, una a una

**Se puede pulsar, y no borra nada.** El icono de papelera de cada conversación
(`modules/disa/index.js:1816` → `dtDelete`) llama a `DELETE /api/disa/threads/:id`, y el servidor
(`modules/disa/index.js:2084`) hace:

```js
db.prepare('UPDATE disa_conversation_threads SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?')
```

Es decir: **marca el hilo como oculto y deja los mensajes intactos** en `disa_conversations`.

- El filtro por `user_id` **sí está** y es correcto: nadie oculta el hilo de otro.
- **No hay ninguna confirmación.** Un clic en la papelera y la conversación desaparece de la lista,
  sin preguntar nada.
- **La prueba de que el ocultado no borra, en la base de verdad:** en `desarrollo-bamburu`,
  **62 de las 105** filas de `disa_conversations` cuelgan de hilos ya "borrados" (`is_active=0`).
  El dueño (usuario 2) tiene **58 hilos, TODOS ocultos, y sus 61 conversaciones siguen enteras** en
  la base. Para él ese botón ya se pulsó 58 veces y no borró ni un mensaje.

**Y la avería que da nombre a la tarea** (`modules/disa/index.js:2827`):

```js
router.post('/clear', adminAuth(db), c => {
  db.prepare('DELETE FROM disa_conversations').run();     // ← sin WHERE
  return c.json({ ok: true });
});
```

Tres cosas, y las tres cuentan:

1. **Sin filtro por usuario ni por hilo:** una sola llamada de cualquier usuario con sesión —también
   un empleado— vacía el historial de conversación **del negocio entero**.
2. **Es el ÚNICO `DELETE FROM` sin `WHERE` de todo el producto.** Comprobado con un barrido de
   `modules/` y `core/`: no hay ningún otro. La avería está en un solo sitio.
3. **No la llama nadie.** `grep` de `disa/clear` en todo el repo: **cero llamadas**. No hay botón, no
   hay pantalla, no hay script. Es una ruta viva por HTTP y muerta en el producto — lo que la hace
   peor, no mejor: nadie la echaría de menos y nadie se enteraría de que se usó.

El router se monta **dos veces** (`app.route('/admin/disa', router)` y `app.route('/api/disa', router)`),
así que cada ruta tiene **dos direcciones**: `/api/disa/clear` y `/admin/disa/clear`. Cualquier arreglo
tiene que valer para las dos — al ser el mismo handler, vale.

---

## 3. Qué quedaría huérfano tras un borrado global

Recorrido tabla por tabla, con la decisión que se toma sobre cada una:

| Pieza | ¿La toca un borrado? | Decisión y por qué |
|---|---|---|
| `disa_conversation_threads` | **Sí, se borra la fila** | Hoy `/clear` deja los hilos vivos y se lleva los mensajes: quedan 60 conversaciones vacías en la lista, con su título, sin nada dentro. Es el huérfano principal de la avería actual. |
| `disa_usage` (cuota de IA del mes) | **NO se toca** | Es el contador mensual de mensajes. Si borrar la conversación lo reseteara, borrar sería la forma de saltarse el tope de IA. Se deja quieto **a propósito**. |
| `disa_spend` (gasto en €) | **NO se toca** | Mismo motivo: es el freno de gasto del negocio, no un dato de la conversación. |
| `disa_action_audit` | **NO se toca** | Es el registro de qué decidió DISA y con qué resultado. No guarda prompts ni datos del negocio (lo dice su propio comentario): es **rastro del negocio**, de la misma familia que la `HUELLA` de `usuarios-baja.js`. Borrar el chat no puede borrar la constancia de que se ejecutó una acción. *(Hoy la tabla no existe todavía en ninguna base: se crea al vuelo con la primera acción.)* |
| `activity_logs` | **NO se toca** | Registro de actividad del negocio. Igual que el anterior. |
| `attachments` (facturas subidas por el chat) | **NO se toca, y no quedan huérfanas** | El adjunto del chat NO cuelga de la conversación: `/attach` lo enlaza a la compra o recepción (`entity_type`). Es un documento del negocio, no un mensaje. |
| `analytics_panels` (informes guardados) | **NO se toca** | Cuelgan del usuario, no del hilo. |
| `disa_quick_chips` | **NO se toca** | Ajuste de la persona, no una conversación. |
| Exportación de 90 días | **NO se toca** | `exportacion.js` exporta **todas** las tablas menos tres de credenciales, así que `disa_conversations` va dentro. Tras un borrado real esas filas ya no saldrán en la copia — que es lo correcto y lo esperado. **No se modifica ese fichero.** |

**Referencias que se quedan colgando y hay que mirar de frente:**

- `/select-agent` y `/agents` (`modules/disa/index.js:2031` y `:2044`) leen el agente elegido con
  `MIN(id)` y `ORDER BY id ASC LIMIT 1` **sobre toda la tabla, sin filtrar por usuario**. Al borrar
  filas ese puntero cambia de dueño. Está envuelto en `try/catch` con `1` por defecto, así que no
  rompe nada, pero **es una fuga entre usuarios que ya existe hoy** (el agente que elige un empleado
  se lo lleva el dueño y al revés). **No es esta tarea** — queda escrito aquí y va al TABLERO.
- **`ejecutarBaja` de `modules/erp/usuarios-baja.js:117` deja mensajes huérfanos para siempre.** Al
  borrar del todo a una persona sin rastro en el negocio, la lista `SUYO` borra sus
  `disa_conversation_threads`… y **nadie borra sus `disa_conversations`**, que no tiene `user_id` por
  el que engancharla. Sus mensajes se quedan en la base, sin dueño y sin forma de llegar a ellos.
  **Es un hallazgo real de este diagnóstico y NO se arregla aquí**: `usuarios-baja` es pieza cerrada
  y el encargo pide cambios quirúrgicos. Va al TABLERO como deuda con su motivo.

---

## 4. Lo que hay que respetar sí o sí

- **CSRF.** El router de DISA **no** hereda `csrfProtect()` (es la tarea `disa-rutas-sin-csrf`, otra
  distinta). El front ya manda la cabecera `x-csrf-token`, pero **hoy nadie la comprueba**. Convertir
  el borrado en real y definitivo sobre una ruta sin CSRF sería **agravar un agujero que ya existe**:
  una página ajena podría destruir el historial del usuario que la visite. Por eso las rutas que
  borran de verdad —y solo esas— llevan `csrfProtect()`. **No sustituye a la tarea general**, que
  sigue teniendo que cubrir todas las rutas de escritura de DISA.
- **Cero ventanitas del navegador** (CLAUDE.md): la confirmación va con `window.confirmarEnPagina()`,
  nunca con `confirm()`.
- **Aislamiento entre negocios:** es por fichero (`data/tenants/<slug>.db`), resuelto por el
  middleware de tenant. Un borrado no puede alcanzar otra base — pero hay que **demostrarlo contando**,
  no darlo por sabido.

---

## 5. La contradicción del encargo, dicha en voz alta

El encargo dice *«implementa el borrado global»* y también *«los criterios del TABLERO mandan tal
cual»*. Y el segundo criterio del TABLERO dice literalmente:

> *No queda ninguna ruta capaz de vaciar `disa_conversations` de golpe.*

Las dos frases solo caben juntas de una forma, y es la que se construye:

**«Global» es global PARA QUIEN LO PIDE, no para el negocio.** Un botón de *«borrar todas mis
conversaciones»* que se lleva las del usuario que pulsa —todas, de una vez, de verdad y sin vuelta
atrás— cumple los tres criterios del TABLERO **y** los tres mínimos del encargo (confirmación previa,
borrado real en la base, y jamás fuera de su negocio). La otra lectura —un botón que vacía el
historial del negocio entero— **incumpliría el criterio 2 del TABLERO**, que el encargo declara
intocable. No se elige la mitad conveniente: se elige la única que no rebaja nada.

---

## 6. Las comprobaciones, definidas ANTES de construir

1. **Borrado real, contando en la base.** Negocio de prueba propio con **dos** usuarios y
   conversaciones sembradas para los dos, más **un segundo negocio** también sembrado. Tras el
   borrado del usuario A: sus filas de `disa_conversations` y `disa_conversation_threads` a **cero**,
   las de B **intactas al número exacto**, y el otro negocio **intacto al número exacto**. Después
   borra B → el negocio queda a **cero conversaciones**, y el otro negocio **sigue intacto**.
2. **Se lleva también lo ya oculto.** Un hilo con `is_active=0` (de los 62 que hoy sobreviven a la
   papelera) tiene que desaparecer de verdad: si no, "borrado real" sería mentira.
3. **Lo que NO se borra sigue ahí:** `disa_usage`, `disa_action_audit`, `activity_logs` y los
   adjuntos, con su recuento exacto antes y después.
4. **La ruta sin filtro ya no existe.** `POST /clear` con la sesión de A no puede tocar ni una fila
   de B — se pide de verdad, por HTTP, y se cuenta.
5. **La confirmación funciona, en un navegador de verdad.** Se pulsa el botón, se lee el panel, y:
   - diciendo **«no»** → no se borra **nada** (contado en la base);
   - diciendo **«sí»** → se borra, y la pantalla lo refleja;
   - con las ventanitas del navegador **silenciadas** (`prompt`/`confirm` neutralizados) el botón
     tiene que **seguir funcionando**;
   - y se **mira la captura** de la pantalla terminada.
6. **El centinela que sale en ROJO.** Una comprobación que lee el código fuente y falla si vuelve a
   aparecer un borrado sin filtro sobre estas tablas. **Y se demuestra que sabe ponerse rojo**,
   dándole de comer un borrado malo a propósito: un censo que dice cero sin ser cierto es peor que no
   tenerlo, porque cierra la pregunta (CLAUDE.md).
