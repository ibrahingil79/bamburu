# Análisis · `disa-herramientas-en-paralelo` — DISA se rompe cuando el modelo llama a dos herramientas a la vez

- **Papel:** arquitecto · **Fecha:** 31 ago 2026
- **Origen:** `docs/auditorias/diagnostico-arquitectonico.md` §4.2 · `TABLERO.md:8074`
- **Fase:** SANEAMIENTO TÉCNICO (CANON §4). No añade funciones nuevas: repara el contrato de una que
  ya está prometida y hoy falla de forma no determinista.
- **Método:** verificado **leyendo el código**. No se ha ejecutado nada —ni gate, ni barrido, ni
  llamada al modelo— porque el RITUAL lo prohíbe sin encargo expreso. Todas las líneas citadas están
  leídas, no supuestas.
- **No se para.** Repasado el listado de motivos de parada: no contradice CANON ni RITUAL, no toca
  Capa 2 ni Capa 3 (DISA es Capa 1), cabe en una entrega, no está hecho (la línea rota sigue ahí), y
  **no exige ninguna decisión de Ibrahin**: las siete herramientas declaradas son de SOLO LECTURA, así
  que nada de esto cambia lo que se le promete al cliente, lo que se le cobra ni lo que exige la ley.

---

## 1 · Qué está mal hoy

### 1.0 Antes de nada: dos correcciones al enunciado de la tarea

El TABLERO y el diagnóstico dicen `modules/disa/index.js:2570`. **Hoy la línea rota es la 2583**;
la 2570 es el cierre de la llamada a `callClaude`. El código se movió 13 líneas desde que se escribió
el diagnóstico. Lo apunto porque el constructor va a buscar por número de línea y no lo va a
encontrar donde se le dice.

Y una segunda, que cambia el tamaño del riesgo pero no su existencia. El TABLERO dice:

> «con las 20 acciones más las herramientas de informes y descuentos **declaradas juntas**, que el
> modelo pida dos en un turno no es un caso raro»

**Las acciones no son herramientas de la API.** Las 31 capacidades de `EXECUTABLE_ACTIONS`
(`modules/disa/index.js:281-292`) viajan como texto, en un bloque `[ACCION:{…}]` dentro de la
respuesta, y las parsea `extractActionBlock` en la línea 2662. Al parámetro `tools` de la API van
**siete** herramientas, y las siete son de lectura (`modules/disa/index.js:2546`):

| Herramienta | Declarada en | Escribe |
|---|---|---|
| `listar_informes`, `abrir_informe`, `catalogo_informes`, `componer_informe` | `modules/disa/informes.js:39-70` | no |
| `ver_descuentos`, `calcular_descuento` | `modules/disa/informes.js:166-186` | no |
| `query_database` | `modules/disa/index.js:2547-2556` | no (`evaluateQueryAccess`, `index.js:109`) |

La cifra del TABLERO está mal, y no la corrijo a la baja para minimizar el fallo: la corrijo porque
**el argumento bueno es otro y es más fuerte**. Las descripciones de esas siete herramientas están
escritas para encadenarse — `catalogo_informes` dice literalmente *«Usala ANTES de componer_informe»*
(`informes.js:52`) y `abrir_informe` dice *«Primero usa listar_informes»* (`informes.js:47`). Un
modelo al que se le describen dos herramientas como pareja **va a pedir la pareja**. El caso no es
raro por el número de herramientas: es probable por cómo están descritas.

### 1.1 La línea rota, y lo que pasa exactamente

`modules/disa/index.js:2582-2597`, dentro del handler de `router.post('/message', …)`:

```js
if (data.stop_reason === 'tool_use') {
  const toolUse = data.content.find(b => b.type === 'tool_use');   // :2583 ← LA PRIMERA, SOLO
  if (!toolUse) break;
  const inp = toolUse.input || {};
  const result = NOMBRES_INFORMES.has(toolUse.name) ? INFORMES_TOOL.ejecutar(toolUse.name, inp)
    : NOMBRES_DESCUENTOS.has(toolUse.name) ? DTO_TOOL.ejecutar(toolUse.name, inp)
    : runQueryTool(inp.sql || '');
  console.log('[DISA] herramienta:', toolUse.name, result.error ? 'rechazada' : 'completada');
  apiMessages.push({ role: 'assistant', content: data.content });  // :2592 ← EMPUJA TODAS
  apiMessages.push({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }]   // :2595 ← UN SOLO RESULTADO
  });
  toolCalls++;
}
```

El uso de herramientas en paralelo está **activo por defecto** en la Messages API: una respuesta
puede traer varios bloques `tool_use` en el mismo `content`. Y el contrato de la API es que el
mensaje `user` que sigue a un turno de asistente con `tool_use` tiene que traer **un `tool_result`
por cada `tool_use` de ese turno**, referenciado por su `tool_use_id`. Con dos bloques, la línea
2592 declara dos peticiones y la 2595 contesta una.

La secuencia real, con el modelo pidiendo `catalogo_informes` + `componer_informe` en un turno:

| Paso | Qué pasa |
|---|---|
| 1 | `find` coge `catalogo_informes`. Se ejecuta. |
| 2 | **`componer_informe` no se ejecuta nunca.** No hay error, no hay traza: desaparece. |
| 3 | `apiMessages` recibe el turno del asistente **entero**, con los dos `tool_use`. |
| 4 | `apiMessages` recibe **un** `tool_result`. El de `componer_informe` falta. |
| 5 | Siguiente vuelta del `while`: la API rechaza la petición con **400**. |
| 6 | `core/llm.js:156-166` no distingue 400 de 503: cualquier `!resp.ok` que no hable de saldo sale como `llm_provider_error` con `status` 502. |
| 7 | `modules/disa/index.js:2579` → el usuario lee ***«No se pudo contactar con DISA. No se ha ejecutado ninguna acción; inténtalo de nuevo.»*** |

**Un fallo de contrato disfrazado de fallo de red.** El log (`index.js:2572`) imprime
`[DISA] API error: llm_provider_error` y nada más — ni el cuerpo del 400, ni qué herramientas se
pidieron. Desde ese mensaje el fallo es imposible de perseguir, y como depende de lo que decida el
modelo en cada turno, no se reproduce a voluntad.

La frase *«No se ha ejecutado ninguna acción»* es cierta en lo que importa —las acciones con valor
son los bloques `[ACCION:]`, y ninguna se ejecuta por este camino— pero es falsa sobre las
herramientas: la primera **sí** se ejecutó. Como las siete son de lectura, no hay daño; conviene
saberlo igual antes de dar por buena la frase.

### 1.2 El segundo agujero del mismo bucle: la respuesta vacía

`modules/disa/index.js:2560-2604`:

```js
let reply = '';
let toolCalls = 0;
while (toolCalls <= 4) { … }
```

La condición permite cinco vueltas (`toolCalls` = 0,1,2,3,4). Si las cinco son turnos de herramienta,
la quinta deja `toolCalls` en 5, la condición falla y **se sale del bucle con `reply === ''`**. Lo
mismo pasa por el `if (!toolUse) break` de la línea 2584.

Aguas abajo, `reply=''` recorre entero el bloque 2635-2696 sin encajar en nada y sale por la línea
2720 como `{ reply: "" }` con **HTTP 200**. El usuario ve una burbuja vacía. Es exactamente la clase
de avería del 15 ago 2026 que documenta `scripts/test-llm-texto-respuesta.mjs:4-9` —*«la ruta devolvía
HTTP 200 con la respuesta VACÍA … sin error en el log, sin nada en pantalla»*— y sigue viva en el
mismo fichero, dos agujeros más allá.

Entra en esta tarea porque **el arreglo cambia cómo se cuenta el presupuesto del bucle**: no se puede
tocar el contador sin decidir qué pasa cuando se agota, y hoy lo que pasa es una burbuja vacía.

### 1.3 El mismo defecto, copiado en dos comprobaciones

- `scripts/verify-llm-disa-stock.mjs:90` — `data.content.find(b => b.type === 'tool_use')`, y un solo
  `tool_result` en la línea 94.
- `scripts/verify-llm-migracion.mjs:67` — igual, con el mismo par 73-74. Este es peor que un
  descuido: el fichero se llama a sí mismo la demostración del bucle de herramientas, así que
  **documenta el contrato mal**.

No son producción, pero si el arreglo no llega hasta ahí, la guardia que impide la recaída (§4.3) no
puede ser de repositorio entero, y una guardia con excepciones es la que un día deja pasar la real
—que es literalmente la lección del censo de ventanitas escrita en `CLAUDE.md`.

### 1.4 Lo que NO entra, y dónde está apuntado

El §4.2 del diagnóstico enumera cuatro problemas más de `core/llm.js` en el mismo párrafo: sin
reintentos, sin streaming, sin mirar `stop_reason === 'max_tokens'`, sin caché de prompt, y el
contador de gasto que falla abierto (`core/llm.js:31-37`, un modelo fuera de `PRICING` cuenta 0 €).
**Ninguno entra aquí.** Son otras tantas tareas, cada una con su decisión —la del gasto toca el tope
de 5 €/mes, que es dinero del cliente y no la decide el arquitecto— y el RITUAL manda una tarea cada
vez. Quedan donde ya están: `docs/auditorias/diagnostico-arquitectonico.md:281-298`.

---

## 2 · Cómo lo resuelven los que ya lo resolvieron

El problema, despojado del LLM, es viejo y tiene nombre: **una petición compuesta tiene que recibir
una respuesta compuesta con la misma forma, elemento por elemento y emparejada por identificador.**
Los tres lo tienen resuelto, cada uno a su manera, y los tres dicen algo distinto.

### Salesforce — el emparejamiento lo garantiza el runtime, no quien llama

En Agentforce, el planificador propone acciones de un catálogo declarado (una *topic* con sus
*Actions*), y **es la plataforma la que las despacha y devuelve un resultado por cada una**, con sus
permisos evaluados por acción. Debajo, el framework de acciones invocables de la plataforma tiene la
misma propiedad desde mucho antes de la IA: se invocan en lote y la respuesta trae **una entrada por
invocación**, en el mismo orden, aunque alguna haya fallado — un error en una no borra el resultado
de las otras.

**Lo que se trae:** la invariante «una respuesta por petición, emparejada por id, y el fallo de una no
se lleva por delante a las demás» **no puede estar en el sitio donde se llama**, porque ahí se olvida.
Tiene que estar en una pieza que no se pueda saltar. Es, otra vez, el síntoma N2 del propio
diagnóstico —*la regla no está en la primitiva, así que se olvida en un punto de llamada*— y es lo
que se acaba de arreglar en la tarea anterior metiendo el bypass dentro de `checkPermission`.

**Lo que NO se trae:** el planificador gestionado. Bamburu tiene una regla explícita en
`core/llm.js:3-11` —un solo fichero conoce la clave y el transporte— y meter un orquestador de
terceros la rompe entera.

### Odoo — el peer directo, y el que más se parece

Odoo es el comparable honesto: ERP para PYME, autoalojado, ORM **síncrono**, módulos por dominio. Dos
cosas suyas aplican tal cual:

1. **El despacho es por nombre contra un registro, nunca por posición.** `call_kw` recibe el nombre
   del método y lo busca en el registro del modelo; un nombre desconocido devuelve un error
   nombrado, no se cae al método de al lado. El código de Bamburu hace hoy lo contrario en
   `index.js:2586-2588`: la cadena de ternarios acaba en `runQueryTool(inp.sql || '')`, así que
   **cualquier nombre de herramienta que el modelo se invente se ejecuta como una consulta SQL vacía**
   y el `console.log` de la línea 2590 lo apunta con el nombre inventado. Falla cerrado por
   casualidad (`evaluateQueryAccess` rechaza la cadena vacía), no por diseño.
2. **El lote responde a todos sus elementos.** Las llamadas RPC agrupadas de Odoo devuelven una
   respuesta posicional por cada llamada del lote; ninguna se contesta a medias.

Y una tercera que es una advertencia, no una técnica: **con un ORM síncrono, «en paralelo» es un
bucle `for`.** Odoo no finge concurrencia donde no la hay. Aquí manda igual: better-sqlite3 es
síncrono (`CLAUDE.md`, sección de stack: *«SÍNCRONO — no uses await en queries»*), así que ejecutar
las herramientas «en paralelo» con `Promise.all` no ganaría un milisegundo y añadiría un camino de
error nuevo. **Se ejecutan en orden, en un bucle.**

### SAP — el envoltorio de la respuesta refleja el de la petición, parte por parte

El `$batch` de OData tiene la regla escrita y es exactamente la que aquí falta: una petición con *n*
partes recibe una respuesta con *n* partes, en el mismo orden, y cada parte lleva su propio estado.
Un `$batch` al que le falta una parte de respuesta es una respuesta malformada, no una respuesta
incompleta — igual que aquí.

**Lo que se trae:** que la comprobación no mire si «funciona», sino si **la respuesta tiene la misma
forma que la petición**. Eso es un sí/no comprobable sin opinión, y de ahí salen los criterios 2 y 3.

**Lo que NO se trae, y esto importa:** el *changeset* de SAP es **todo o nada** — si una operación del
grupo falla, se deshacen todas. **Aquí sería peor que el defecto actual.** Las siete herramientas son
de lectura: no hay nada que deshacer, y hacer que un `componer_informe` sin permiso (que devuelve
`{error}` por el `seguro()` de `informes.js:138-141`) anulase el `catalogo_informes` que sí funcionó
dejaría al modelo sin ninguno de los dos datos y al usuario sin respuesta. La atomicidad es la
respuesta correcta cuando se escribe; aquí no se escribe. **Cada herramienta contesta lo suyo, y un
error es un resultado, no una excepción.**

---

## 3 · La decisión

### 3.1 Qué se hace

**Se contestan TODAS las llamadas a herramienta del turno: un `tool_result` por cada `tool_use`, en
el mismo orden y con su `tool_use_id`.** No se desactiva el paralelismo: se cumple el contrato.

Con un presupuesto explícito, porque un bucle sin tope sobre la base de datos no se deja abierto:

- `MAX_VUELTAS = 5` — vueltas del bucle, es decir **llamadas a la API**. Es lo mismo que hoy permite
  `toolCalls <= 4`; el coste por mensaje no sube. Lo que cambia es qué cuenta el contador: **vueltas,
  no herramientas**.
- `MAX_HERRAMIENTAS_POR_MENSAJE = 8` — ejecuciones de herramienta en todo el mensaje, sumando
  vueltas. Hoy el techo real son 5. Ocho lecturas acotadas por mensaje es holgado para el caso real
  (dos) y sigue siendo un número.
- **Pasado el presupuesto, el bloque sigue recibiendo su `tool_result`** — con
  `{ error: 'Has consultado demasiadas cosas en un solo mensaje…' }` y `is_error: true`, sin
  ejecutarse. Ésta es la pieza que no se puede saltar: descartar un bloque sin contestarlo es
  volver al 400 por otro camino. **Se rechaza contestando, nunca callando.**

Y el agujero de §1.2: al salir del bucle, si no hay texto, **nunca se devuelve la burbuja vacía**. Se
usa el texto que traiga la última respuesta y, si no hay ninguno, una frase que dice lo que pasó.

### 3.2 En qué capa vive cada parte, y qué patrón sigue

Se parte en dos por responsabilidad, porque son dos cosas distintas:

| Pieza | Dónde | Por qué ahí |
|---|---|---|
| `toolUseBlocks(apijson)` → **todos** los bloques `tool_use`, en orden | `core/llm.js`, junto a `textFromResponse` | La forma de una respuesta de la Messages API es **transporte**, y `core/llm.js:3-11` dice que este fichero es el único que conoce la versión y el formato de la API. `textFromResponse` ya es exactamente este helper para el texto, y su comentario en `index.js:2599-2600` dice el porqué: *«un solo sitio decide cómo se saca el texto de una respuesta, para que no vuelva a haber tres formas distintas»*. Hoy hay tres formas de sacar las herramientas, en tres ficheros. |
| `resultadosDeHerramientas(bloques, ejecutar, { presupuesto })` → el mensaje `user` con los `tool_result` | Nivel de módulo de `modules/disa/index.js`, **exportado** | Es la política de DISA (cuántas, en qué orden, qué se rechaza), no del transporte. Y va a nivel de módulo y exportada **por el patrón que este repo ya ha aplicado dos veces**: `evaluateQueryAccess` (`index.js:109`) —*«A nivel de módulo y EXPORTADO para que el gate lo pruebe con los mapas REALES (no una copia)»*— y `permisoDeSesion`, subida ahí mismo en el commit `e5111df` de anoche por el mismo motivo. Una función pura, sin BD y sin red, es la única forma de que la comprobación mida **el cableado real y no una copia escrita para la prueba**. |

Los dos patrones que sigue por dentro ya están en la casa:

- **`seguro()` de `modules/disa/informes.js:138-141`** — *«todas devuelven lo mismo: un resultado, o
  `{ error }`»*. `resultadosDeHerramientas` no lanza nunca: si `ejecutar` revienta, eso se convierte
  en un `tool_result` con `is_error: true`. Una excepción a mitad de un lote dejaría el mensaje
  malformado, que es el fallo original con otro disfraz.
- **La guardia de barrido de `scripts/test-llm-texto-respuesta.mjs:76-106`** — *«El bug no se arregla
  solo con el helper: se arregla si NADIE vuelve a escribir `content[0].text`»*. Se replica igual
  para `.find(… 'tool_use')`.

### 3.3 Alternativas descartadas

1. **`tool_choice: { type: 'auto', disable_parallel_tool_use: true }` y nada más.** Es una línea y
   apaga el síntoma. Tres motivos para no quedarse ahí. (a) **Cuesta dinero contra el tope que más
   duele**: obliga a una vuelta por herramienta, y cada vuelta reenvía el *system prompt* entero —del
   orden de 20 KB, según el propio diagnóstico— contra un tope de **5 €/mes por negocio**; contestar
   dos herramientas en una vuelta es literalmente la mitad de prompt reenviado. (b) **Deja el código
   mintiendo**: el bucle seguiría escrito como si «la primera» fuera la única, sostenido por un flag
   en el cuerpo de la petición que nadie ve al leer el bucle. El día que alguien lo quite, o que la
   API traiga un bloque de herramienta de servidor, vuelve el 400. (c) Es la mitad conveniente de una
   norma: arregla lo que se ve y no lo que está mal. *Se puede añadir el flag además, y no lo
   propongo: sin él, la comprobación mide el caso que de verdad ocurre.*
2. **Ejecutar solo la primera y recortar el mensaje del asistente a ese bloque.** También deja la
   petición válida, y es peor: se le reescribe al modelo lo que dijo, y la segunda herramienta
   desaparece igual que hoy. Corrompe la transcripción para tapar un fallo.
3. **`Promise.all` sobre las herramientas.** better-sqlite3 es síncrono. No hay paralelismo que ganar
   y sí un camino de error nuevo. Un bucle `for` (la lección de Odoo, §2).
4. **Migrar a `@anthropic-ai/sdk`, que trae reintentos y esto resuelto.** Es una tarea grande, toca
   la regla de `core/llm.js` sobre el transporte único, y arrastra los otros cuatro puntos de §1.4.
   Fuera del alcance: **es una propuesta, no parte de esta entrega**, y la decide Ibrahin.
5. **Atomicidad estilo *changeset* de SAP.** Descartada con motivo en §2: aquí no se escribe, y
   anular un resultado bueno por un error ajeno deja al usuario con menos.

---

## 4 · El plan, paso a paso

### 4.1 · `core/llm.js` — el helper de transporte

1. Añadir, **inmediatamente debajo de `textFromResponse` (línea 205)**, la función exportada:

   ```js
   // Atajo hermano de textFromResponse: TODOS los bloques `tool_use` de la respuesta, en su orden.
   // Existe por lo mismo que aquél: un solo sitio decide cómo se lee la forma de una respuesta.
   // TODOS, no el primero: el uso de herramientas en paralelo está activo por defecto en la API y
   // cada `tool_use` exige su `tool_result`; quedarse con `.find(...)` es el 400 del 31 ago 2026.
   export function toolUseBlocks(apijson) {
     if (!apijson || !Array.isArray(apijson.content)) return [];
     return apijson.content.filter(b => b && b.type === 'tool_use' && b.id);
   }
   ```

   El filtro por `b.id` es deliberado: un bloque sin `id` no se puede contestar, así que tampoco se
   ejecuta. Mismo criterio de tolerancia que `textFromResponse` (nunca lanza, siempre devuelve algo
   del tipo esperado).
2. No se toca nada más de este fichero. En particular **no** se tocan `PRICING`, ni el manejo de
   errores de `!resp.ok`, ni `max_tokens` (§1.4).

### 4.2 · `modules/disa/index.js` — la política y el bucle

3. **Constantes**, a nivel de módulo, junto a las que ya viven ahí (`QUERY_PROTECTED_TABLES`, línea
   43 y siguientes):

   ```js
   export const MAX_VUELTAS = 5;                    // llamadas a la API por mensaje (lo mismo que hoy)
   export const MAX_HERRAMIENTAS_POR_MENSAJE = 8;   // ejecuciones de herramienta en todo el mensaje
   export const MSG_PRESUPUESTO_HERRAMIENTAS =
     'Has consultado demasiadas cosas en un solo mensaje. Contesta con lo que ya tienes.';
   ```

4. **La función pura**, a nivel de módulo y **exportada**, al lado de `evaluateQueryAccess` (línea
   109). Firma exacta:

   ```js
   // bloques  : los `tool_use` de un turno (los que devuelve toolUseBlocks)
   // ejecutar : (nombre, input) => resultado  — puede devolver { error } y puede lanzar
   // presupuesto: cuántas se pueden EJECUTAR de verdad; el resto se rechazan CONTESTANDO
   // → { mensaje, ejecutadas, rechazadas, traza }
   export function resultadosDeHerramientas(bloques, ejecutar, { presupuesto = Infinity } = {})
   ```

   Reglas que tiene que cumplir, todas comprobables:
   - Devuelve `{ role: 'user', content: [...] }` con **exactamente un `tool_result` por bloque
     recibido**, en el mismo orden y con el mismo `tool_use_id`.
   - Si un `tool_use_id` se repite en `bloques`, solo el primero recibe resultado (dos `tool_result`
     con el mismo id es otro 400). Es defensivo; no debería pasar.
   - Cada resultado es `{ type: 'tool_result', tool_use_id, content: JSON.stringify(r) }`, y lleva
     además `is_error: true` cuando `r.error` es verdadero. *(Decisión de construcción: `is_error` es
     el canal que la propia API tiene para eso, hoy no se usa, y hace el fallo legible para el modelo
     sin cambiar el `content`. No altera el emparejamiento, que es lo que arregla la avería.)*
   - Los bloques a partir del `presupuesto` **no se ejecutan** y reciben
     `{ error: MSG_PRESUPUESTO_HERRAMIENTAS }` con `is_error: true`.
   - **No lanza nunca.** `try/catch` alrededor de cada `ejecutar`; una excepción se convierte en
     `{ error: safeError(e) }`. Es el patrón `seguro()` de `informes.js:138`.
   - Devuelve `traza`: `[{ nombre, estado }]` con `estado` ∈ `'completada' | 'rechazada' | 'sin
     presupuesto'`. **Solo nombre y estado** — la línea 2589 ya avisa: *«Nunca SQL, argumentos ni
     PII»*, y esa regla no se toca.

5. **El despachador con nombre**, dentro del handler, sustituyendo la cadena de ternarios de las
   líneas 2586-2588 (la lección de Odoo, §2):

   ```js
   const ejecutarHerramienta = (nombre, input) => {
     if (NOMBRES_INFORMES.has(nombre))   return INFORMES_TOOL.ejecutar(nombre, input);
     if (NOMBRES_DESCUENTOS.has(nombre)) return DTO_TOOL.ejecutar(nombre, input);
     if (nombre === 'query_database')    return runQueryTool(input.sql || '');
     return { error: 'No conozco la herramienta "' + nombre + '".' };
   };
   ```

   Un nombre inventado deja de caer en `runQueryTool` con SQL vacío.

6. **Reescribir el cuerpo del bucle, líneas 2560-2604.** El `try/catch` de `callClaude`
   (2566-2580) se queda **exactamente igual**: no se toca ni un mensaje de error ni un código HTTP.
   Cambia solo lo de dentro del `if (data.stop_reason === 'tool_use')` y el contador:

   ```js
   let reply = '';
   let vueltas = 0;
   let gastadas = 0;               // herramientas EJECUTADAS en todo el mensaje

   while (vueltas < MAX_VUELTAS) {
     vueltas++;
     let data;
     try { data = await callClaude({ … tal cual … }); }
     catch (e) { … tal cual, sin tocar … }

     const bloques = toolUseBlocks(data);
     if (data.stop_reason !== 'tool_use' || bloques.length === 0) {
       reply = textFromResponse(data);
       break;
     }

     const r = resultadosDeHerramientas(bloques, ejecutarHerramienta, {
       presupuesto: Math.max(0, MAX_HERRAMIENTAS_POR_MENSAJE - gastadas),
     });
     gastadas += r.ejecutadas;
     for (const t of r.traza) console.log('[DISA] herramienta:', t.nombre, t.estado);

     apiMessages.push({ role: 'assistant', content: data.content });
     apiMessages.push(r.mensaje);
   }

   // NUNCA una burbuja vacía con HTTP 200 (§1.2): si el presupuesto se agotó a mitad, se dice.
   if (!reply) reply = 'He consultado varias cosas y no he conseguido cerrar la respuesta. '
                     + 'Vuelve a preguntármelo, si puedes más concreto.';
   ```

   Nota para quien lo escriba: `if (data.stop_reason !== 'tool_use' || bloques.length === 0)` cubre
   de una vez el `else` y el `if (!toolUse) break` de la línea 2584, y en los dos casos **saca el
   texto** en vez de dejar `reply` vacío.

7. **Actualizar los comentarios que dejan de ser ciertos.** El de las líneas 2563-2565 dice *«el
   bucle de tool-use queda intacto»*; deja de serlo. Escribir en su lugar qué contrato cumple ahora y
   por qué (todas, emparejadas por id), citando la fecha. Es la norma de `CLAUDE.md` sobre corregir el
   cuerpo cuando cambia el titular.

### 4.3 · `scripts/verify-disa-herramientas-paralelo.mjs` — nuevo, determinista y sin gasto

8. Crear el fichero, calcado en forma y en cabecera a `scripts/test-llm-texto-respuesta.mjs`: **sin
   red, sin clave, sin BD, sin puppeteer**, con la respuesta de la API fabricada a mano y `fetchImpl`
   inyectado en `callClaude`. Motivo, dicho en la cabecera: los verificadores que usan el modelo de
   verdad (`verify-llm-disa-stock`, `verify-llm-migracion`) son lentos, cuestan dinero y fallan por
   motivos ajenos, así que su rojo se tolera — y un rojo que se tolera no protege nada. Bloques:

   1. `toolUseBlocks` — cero bloques, uno, dos, dos con `thinking` y `text` delante, un bloque sin
      `id` (se descarta), respuesta rara/`null` (devuelve `[]`, no lanza).
   2. **La forma de la respuesta** (la invariante de SAP, §2): para 1, 2 y 3 bloques,
      `mensaje.content.length === bloques.length`, los `tool_use_id` **en el mismo orden**, y el
      conjunto de ids del mensaje `user` **idéntico** al del turno del asistente. Éste es el criterio
      que habría estado rojo el día que se escribió el fallo.
   3. **Aislamiento del error**: con un `ejecutar` que devuelve `{error}` para la segunda herramienta
      y datos buenos para la primera, la primera conserva su resultado y solo la segunda lleva
      `is_error: true`. Y con un `ejecutar` que **lanza**, `resultadosDeHerramientas` no propaga: sale
      un `tool_result` con `is_error`.
   4. **Presupuesto**: con `presupuesto: 1` y 3 bloques, se ejecuta 1 y salen **3** `tool_result`; los
      dos sobrantes traen `MSG_PRESUPUESTO_HERRAMIENTAS` y `ejecutar` **no** fue llamado para ellos
      (contador de llamadas del doble).
   5. **De punta a punta por `callClaude`** con `fetchImpl`: una respuesta fabricada con dos
      `tool_use`, la segunda vuelta devuelve texto; se comprueba que el `apiMessages` construido
      cumple el emparejamiento. *(Construcción: si extraer el bucle a una función pura para esto
      resultara desproporcionado, basta con ejercitar `toolUseBlocks` + `resultadosDeHerramientas`
      sobre la misma respuesta fabricada — que es donde vive la avería. El criterio 3 se puede
      responder por cualquiera de los dos caminos.)*
   6. **La guardia de recaída**, calcada de `test-llm-texto-respuesta.mjs:76-106`: barrido de
      `modules/`, `core/` y `scripts/` buscando
      `/\.find\s*\(\s*[^)]*type\s*===\s*['"]tool_use['"]/` en líneas que **no** sean comentario,
      excluyendo este mismo fichero (que fabrica el patrón para demostrarlo). Cero culpables.
   7. Salida `pass/fail` y `process.exit(fail ? 1 : 0)`, como el resto de la casa.

   **No siembra nada en ninguna base de datos**, así que la norma *«lo que una prueba crea, la prueba
   lo borra»* se cumple por construcción: no crea. Que no toque BD es a propósito y es comprobable.

### 4.4 · Las dos copias del defecto

9. `scripts/verify-llm-disa-stock.mjs` — línea 90: `const tu = toolUseBlocks(data)[0]` no vale, es el
   mismo fallo. Usar `toolUseBlocks` + `resultadosDeHerramientas` (importadas, no reescritas) para
   construir el mensaje de la línea 94. Ajustar el `import` de la línea de cabecera.
10. `scripts/verify-llm-migracion.mjs` — líneas 67 y 73-74: lo mismo. Este además **documenta** el
    contrato, así que su comentario de la línea 71 (*«devolvemos un tool_result»*) pasa a decir «uno
    por cada `tool_use`».

    Sin estos dos pasos, la guardia del punto 8.6 no puede cubrir `scripts/` — y una guardia con
    excepciones es la que un día deja pasar la real.

### 4.5 · Registro

11. `docs/auditorias/diagnostico-arquitectonico.md` §4.2 — marcar el primer párrafo como cerrado con
    su commit, **conservando el texto tachado, no borrándolo** (norma de `CLAUDE.md`: se tacha con su
    motivo y su fecha). Los cinco puntos de `core/llm.js` de las líneas 281-298 **siguen abiertos y se
    quedan tal cual**. Corregir ahí también la referencia `index.js:2570` → línea real.
12. **`TABLERO.md` NO se toca.** Lo cierra el orquestador, como en `disa-informes-permiso-dueno`.

---

## 5 · Riesgos

| # | Riesgo | Por qué es real | Cómo se mitiga |
|---|---|---|---|
| 1 | **Romper el camino de una sola herramienta**, que es el que funciona hoy y el 90 % del uso | Se reescribe el bucle entero, no una línea | Con un bloque, el código nuevo tiene que hacer *exactamente* lo mismo que el viejo: un `tool_result` con su id. Es el criterio 2, y el verificador lo prueba con 1, 2 y 3 bloques. `MAX_VUELTAS = 5` conserva el número de llamadas a la API |
| 2 | **Más lecturas por mensaje**: de 5 a 8 como techo | Son consultas síncronas de better-sqlite3 dentro de una petición HTTP; el aislamiento de bloqueos SQLite es una tarea abierta del propio TABLERO | Las ocho son de **solo lectura**: `evaluateQueryAccess` (`index.js:109`) sigue rechazando todo lo que no sea `SELECT`, y las de informes/descuentos no escriben (`informes.js:29-32`: *«`analytics_panels` sigue FUERA de WRITABLE_TABLES»*). Lectores concurrentes en SQLite no se bloquean entre sí. El techo de vueltas **no sube**, así que el gasto de IA tampoco. Si aun así se quiere ser conservador, `MAX_HERRAMIENTAS_POR_MENSAJE` es una constante exportada y bajarla a 6 es un número |
| 3 | **Permisos**: ejecutar varias herramientas de golpe podría saltarse un candado | Es la promesa de CANON §3-bis: las dos puertas, los mismos permisos | **No se toca ni una línea de permisos.** Cada herramienta se ejecuta por el mismo `ejecutar` de siempre, con el mismo `hasPerm` que construye `permisoDeSesion` (`index.js:2541`, arreglado anoche en `e5111df`). Ejecutar dos no relaja ninguna: cada una evalúa el suyo. Criterio 5 |
| 4 | **Datos ya existentes / migraciones** | — | **No hay ninguna.** `apiMessages` es una variable local de la petición (`index.js:2558`); no se persiste. Lo que sí se guarda (`disa_conversations`, línea 2706) son `{role, content}` de texto y no cambia de forma. Cero SQL nuevo, cero `runMigrations` |
| 5 | **La cadena de VERI\*FACTU** | — | **Intacta.** Ninguna de las siete herramientas escribe, y las acciones con valor legal (`anular_invoice`, `create_rectificativa`) van por el camino de `[ACCION:]` + confirmación del usuario, que no se toca. El diff no entra en `modules/erp/routes/invoices.js` ni en nada de Verifactu — comprobable con `git diff --name-only`, criterio 7 |
| 6 | **Pantallas que dependen de esto** | El chat vive en `modules/disa/widget.js` y en la burbuja de `layout.js` | El contrato HTTP de `/message` **no cambia**: mismas claves de respuesta (`reply`, `artifact`, `thread_id`, `usage`, `limit`, `action_executed`, `capture_url`) y mismos códigos. El único cambio visible es que `reply` deja de poder venir vacío, que es una mejora estricta. No se toca ningún fichero de pantalla, así que las normas de gate de pantalla y de captura no aplican a esta entrega |
| 7 | **La frase «No se ha ejecutado ninguna acción» sigue apareciendo** tras un error de proveedor, y una herramienta sí puede haberse ejecutado | Ya pasa hoy (§1.1) | Se deja como está **a propósito**: la frase habla de *acciones* (los `[ACCION:]`, lo que mueve dinero o datos), y de ésas sigue siendo cierta. Cambiar el texto que lee el usuario en un error es una decisión de producto, no de construcción. Queda dicho aquí y no se toca |
| 8 | **Concurrencia** | — | Nada nuevo: un bucle `for` síncrono dentro de una petición, sin `Promise.all` (§3.3, punto 3). El orden de ejecución es el orden de los bloques, y es determinista |
| 9 | **El verificador nuevo se vuelve un adorno** si se escribe contra una copia de la lógica | Es exactamente el fallo que hizo que `gate-disa-informes` diera verde sobre la avería de anoche | Por eso `resultadosDeHerramientas` y `toolUseBlocks` son **exportadas y puras**: la comprobación importa y ejecuta el cableado real. Criterios 1 y 3 lo exigen por nombre |

---

## 6 · Criterios de aceptación

- [ ] `core/llm.js` exporta `toolUseBlocks(apijson)` y devuelve **todos** los bloques `type === 'tool_use'` en orden: con una respuesta fabricada de `[thinking, text, tool_use A, tool_use B]` devuelve `[A, B]` (longitud 2, ids `['A','B']`); con `[]`, con `{}` y con `null` devuelve `[]` sin lanzar; un bloque `tool_use` sin `id` no aparece en la salida.
- [ ] `modules/disa/index.js` exporta `resultadosDeHerramientas` **a nivel de módulo** (fuera de `register`), y para un array de N bloques devuelve un mensaje con `content.length === N`, con los `tool_use_id` **en el mismo orden que los bloques** y con el mismo conjunto de ids que el turno del asistente — comprobado para N = 1, N = 2 y N = 3.
- [ ] `node scripts/verify-disa-herramientas-paralelo.mjs` termina con código 0, no abre ninguna base de datos ni hace ninguna petición de red real (usa `fetchImpl` inyectado), y entre sus aserciones están: un `ejecutar` que **lanza** produce un `tool_result` con `is_error: true` en vez de propagar la excepción; y con `presupuesto: 1` sobre 3 bloques salen **3** `tool_result`, `ejecutar` se llamó **1** vez, y los 2 restantes traen `MSG_PRESUPUESTO_HERRAMIENTAS`.
- [ ] Un barrido de `modules/`, `core/` y `scripts/` sobre líneas que no sean comentario no encuentra ninguna coincidencia de `.find(` … `type === 'tool_use'` — es decir, `modules/disa/index.js:2583`, `scripts/verify-llm-disa-stock.mjs:90` y `scripts/verify-llm-migracion.mjs:67` están migrados a `toolUseBlocks`. El barrido va dentro de `scripts/verify-disa-herramientas-paralelo.mjs` y pone el fichero en rojo si aparece una.
- [ ] En el bucle de `/message` no queda ninguna llamada a `INFORMES_TOOL.ejecutar`, `DTO_TOOL.ejecutar` ni `runQueryTool` fuera del despachador `ejecutarHerramienta`, y ese despachador devuelve `{ error }` para un nombre desconocido en vez de caer en `runQueryTool('')`. Los mapas de permisos (`ACTION_PERMS`, `STRICT_ADMIN_ONLY`, `QUERY_PROTECTED_TABLES`, `QUERY_TABLE_READ_PERMS`), `permisoDeSesion` y `evaluateQueryAccess` quedan **byte a byte iguales**.
- [ ] El handler de `/message` no puede devolver `reply: ''`: al salir del bucle sin texto —presupuesto de vueltas agotado, o `stop_reason: 'tool_use'` sin bloques utilizables— `reply` es una cadena no vacía. El `try/catch` de `callClaude` (`index.js:2571-2580`) conserva sus cinco ramas con los mismos códigos HTTP (429, 503, 504, 502, 502) y los mismos textos.
- [ ] `git diff --name-only` sobre la entrega devuelve exactamente estos seis ficheros: `core/llm.js`, `modules/disa/index.js`, `scripts/verify-llm-disa-stock.mjs`, `scripts/verify-llm-migracion.mjs`, `docs/auditorias/diagnostico-arquitectonico.md` y el nuevo `scripts/verify-disa-herramientas-paralelo.mjs`. **`TABLERO.md` no aparece**, y no aparece ningún fichero de `modules/erp/`.
- [ ] `node --check modules/disa/index.js` y `node --check core/llm.js` pasan, y ningún comentario del código sigue afirmando que «el bucle de tool-use queda intacto» (`modules/disa/index.js:2563-2565`) ni citando la línea 2570 como la del fallo (`docs/auditorias/diagnostico-arquitectonico.md:261`).

---

> **Nota de método para quien construya:** el RITUAL manda. Los criterios de arriba **no conceden
> permiso para ejecutar nada**. `node scripts/verify-disa-herramientas-paralelo.mjs` es offline,
> determinista y sin coste, y aun así solo se lanza si el encargo lo autoriza expresamente y **una
> sola vez**. Si sale rojo, se declara el rojo con su motivo y se pregunta; no se repite la pasada.
