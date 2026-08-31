# Paso 0 — Por qué el orquestador se quedó ocioso con cuatro tareas pendientes

**Fecha:** 31 ago 2026 · **Alcance:** solo lectura. Escrito ANTES de tocar ningún fichero.

---

## El hecho

A las `22:17:44` el orquestador cerró `disa-informes-permiso-dueno`, subió a `origin/master` y
desde entonces da vueltas cada 60 s diciendo lo mismo:

```
22:17:44 [  OK] ✅ «El dueño no puede ver sus propios informes por DISA» cerrada.
22:17:44 [INFO] Decisión: OCIOSO — el tablero no ofrece ninguna tarea
22:18:44 [INFO] Decisión: OCIOSO — el tablero no ofrece ninguna tarea
…  (19 vueltas idénticas, y sumando)
```

El daemon está vivo (`pid 2376478`, 2 h 11 min en pie). No se ha caído, no está sin cuota, no
está atascado. **Cree de verdad que no hay trabajo.**

## Las tres preguntas del encargo, contestadas

### 1 · ¿Siguen las cuatro escritas en el formato bueno? — **SÍ**

Comprobado contra el fichero real con el propio lector del orquestador:

```
disa-herramientas-en-paralelo → SÍ, línea 8074
pantalla-403-ventanita        → SÍ, línea 8094
portal-formato-dinero         → SÍ, línea 8116
retirar-pantallas-muertas     → SÍ, línea 8130
```

`buscarTareaPorId` las encuentra las cuatro, con su `id`, su `estado: pendiente` y su bloque
completo. **El formato no es el problema. El tablero está bien escrito.**

### 2 · ¿Las ve el lector? — **NO**

```
buscarSiguienteTarea(TABLERO.md) → null
```

`reader.js:buscarSiguienteTarea` busca **una sola cosa**: un encabezado cuyo título case con
`siguiente tarea`. Si no lo hay, repliega a una línea de prosa `SIGUIENTE TAREA OFICIAL:`. Si
tampoco, devuelve `null`.

Las cuatro que quedan están escritas `## TAREA — …`. **Ninguna lleva el rótulo**, y así estaba
decidido a propósito: el propio tablero lo dice en su cabecera —

> «Solo la primera lleva el rótulo «SIGUIENTE TAREA»: es la única que el orquestador cogerá si
> se le suelta.»

La primera era `disa-informes-permiso-dueno`. Ya está hecha.

### 3 · ¿Qué decide al terminar una tarea? — **Nada. No hay ese paso.**

Recorrido del cierre, fichero a fichero:

| Paso | Dónde | Qué hace con el rótulo |
|---|---|---|
| `cerrar()` | `ciclo.js:295` | escribe el registro y llama a `marcarEnTablero` |
| `marcarEnTablero()` | `cierre/cierre.js:78` | cambia el encabezado a `✅ HECHA (fecha) — …` y `estado:` a `hecha` **en el bloque cerrado, y solo en ése** |
| `TAREA_CERRADA` | `almacen.js:184` | `tarea: null`, `paso: 'OCIOSO'` |
| vuelta siguiente | `ciclo.js:unPaso` | `buscarSiguienteTarea` → `null` → `OCIOSO` |

**El rótulo se retira de la que se acaba y no se le pone a nadie.** No hay código que promocione
la siguiente, ni en el cierre, ni en el saneador, ni en la máquina. El saneador tiene la regla R1
para *quitar* rótulos de más (`saneador.js:REGLAS`), pero **ninguna regla que ponga uno cuando
faltan todos**.

## La avería, en una frase

> **El sistema espera un rótulo que nadie pone.** Encadena mientras una persona vaya moviendo a
> mano la etiqueta «SIGUIENTE TAREA» de bloque en bloque. En cuanto la persona no está, se para
> con el tablero lleno.

Es exactamente el diagnóstico que el encargo apuntaba, y es de diseño, no de escritura del
tablero: el lector confunde **«no hay tarea señalada»** con **«no hay tarea»**.

## La segunda avería, que tapa a la primera

Cuando `tareaDisponible` es `null`, `maquina.js:decidirSinMirarCuota` devuelve:

```js
if (!tareaDisponible) return { tipo: ACCIONES.OCIOSO, porque: 'el tablero no ofrece ninguna tarea' };
```

y `ciclo.js` se limita a esperar 60 s. **Ocioso y averiado son indistinguibles**: la misma línea de
registro, el mismo silencio en Telegram. El parte de las 3 h llega a decir «El tablero no ofrece
ninguna tarea más», que es una afirmación **falsa** dicha con toda tranquilidad. Sin esta segunda
avería, la primera se habría visto en cuanto se paró.

## Una tercera cosa que hay que arreglar a la vez

`ciclo.js:apartar()` **no marca el tablero** (a diferencia de `cerrar()`). Hoy da igual: sin
rótulo, una tarea apartada nunca se vuelve a coger. En cuanto el lector empiece a coger tareas por
`estado: pendiente`, una apartada seguiría diciendo `pendiente` y **el orquestador la cogería otra
vez, en bucle infinito**. Arreglar solo lo primero crearía este fallo, así que entra en el mismo
arreglo.

## Qué se va a cambiar

1. **`reader.js`** — el lector coge la primera tarea **pendiente en orden de documento**. El rótulo
   `SIGUIENTE TAREA` deja de ser obligatorio y pasa a ser lo que siempre quiso ser: **la forma de
   que Ibrahin salte el orden natural**. Manda `estado:`, no la etiqueta.
2. **`maquina.js`** — ocioso **con** pendientes en el tablero deja de ser ocioso: es avería.
3. **`vigia/`** — la avería se avisa por Telegram al momento (una vez, no cada minuto) y sale en el
   parte.
4. **`cierre.js` + `ciclo.js`** — una tarea apartada se marca `⛔ APARTADA` en el tablero, para que
   no se vuelva a coger.

Nada de esto decide QUÉ se construye ni en qué orden: el orden sigue siendo el que Ibrahin escribió
en el documento (CANON §6).
