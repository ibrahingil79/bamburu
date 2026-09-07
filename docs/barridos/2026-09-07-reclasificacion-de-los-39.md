# Los 39 rojos sin atribuir — reclasificados (7 sep 2026)

> **Por qué existe este fichero.** Al cerrar `apagar-disa-paso-1` el 7 sep de madrugada quedaron
> **39 rojos sin atribuir**: no se podía decir cuáles eran defectos del producto y cuáles los causaba
> el propio servidor deteriorándose durante la medición (las conexiones fantasma). Repartirlos a ojo
> habría sido inventar. Se dejaron colgando con la condición de reclasificarlos **sobre un servidor
> que no se estropee mientras se le mide**, y eso es lo que se hizo hoy, tras arreglar
> `conexiones-que-no-se-cierran`.

## Las dos pasadas

| | Pasan | En rojo | Tiempo | Conexiones al terminar |
|---|---|---|---|---|
| **6 sep** (con el fallo) | 141/228 | **87** | 945 s | 35 bases · 30 muertas · 2 rancias |
| **7 sep** (con el arreglo) | 176/229 | **53** | 1.388 s | **3 bases · 0 muertas · 0 rancias** |

**34 comprobaciones pasaron de rojo a verde** sin tocar ni una línea de producto: lo único que cambió
entre las dos pasadas es que el servidor ya no se envenena a sí mismo. (La 229ª es
`gate-conexiones-que-se-cierran`, nueva, en verde.)

> ⚠️ **UNA LIMITACIÓN QUE HAY QUE DECIR, PORQUE AFECTA A LA PRECISIÓN DE ESTA LISTA.** La salida del
> barrido del 6 sep **no se guardó** —solo su contador— así que **no existe la lista nominal de
> aquellos 87**. La reclasificación se ha hecho contra la única línea base guardada
> (`docs/barridos/2026-09-01-los-113-rojos.md`) y **ejecutando uno a uno** los rojos de hoy que no
> están en ella. Eso da la atribución de los que SIGUEN rojos con total seguridad; el reparto exacto
> gate a gate de los 34 que se pusieron verdes **no es reconstruible**, y no se finge que lo sea.
> La salida de hoy sí está guardada: `docs/barridos/2026-09-07-salida-completa.log`.

## Los 53 rojos de hoy, repartidos

### 44 ya venían rojos del 1 de septiembre — NO son de esta tarea

Cruzados por nombre contra los 85 rojos «de verdad» catalogados el 1 sep. Son la deuda vieja, la que
Ibrahin mandó no tocar. Están en `docs/barridos/2026-09-07-salida-completa.log`.

### 9 NO estaban en esa línea base — ejecutados uno a uno, con su motivo medido

| Comprobación | Qué dice al caer | Veredicto |
|---|---|---|
| `test-llm-texto-respuesta` | «La IA está apagada en Bamburu» | **Por diseño** — ya nombrada el 7 sep |
| `gate-adjuntos-por-contenido` | «por la puerta de compras… RECHAZADO · HTTP 503» | **Por diseño** — el 503 es el apagado de la captura de facturas |
| `gate-disa-adjuntar` | `TimeoutError: Waiting for selector #step2` | **Por diseño** — el widget de DISA ya no abre ese paso |
| `test-disa-captura-chat` | excepción: «Ese archivo no es una imagen ni un PDF» | **Por diseño** — prueba la captura por chat, retirada |
| `gate-c5bis-rescate-duenyo` | «al marcar "he guardado", se desbloquea — el JS corre» | **PRODUCTO DE VERDAD** |
| `gate-csp-estricta` | «la rejilla pintó sus celdas · 40» (259 OK · 1 ✗) | **PRODUCTO DE VERDAD** |
| `test-manifiesto-copias` | «(criterio 7) cada bloque de subida anota "sha256 $sha" — 3» | **PRODUCTO DE VERDAD** (deuda anterior, commit `2cf81b2` del 3 sep) |
| `verify-libro-sin-huerfanos` | «desarrollo-bamburu: 2 asientos sin documento (supplier_payment×2)» | **PRODUCTO DE VERDAD** |
| `gate-impresion` | «los OCHO ofrecen imprimir, descargar y enviar — 2/15» (74 OK · 1 ✗) | **PRODUCTO DE VERDAD** |

## Y una corrección: de los «3 que caen por diseño», uno NO cae

Se dejaron nombrados el 7 sep: `gate-nav-inicio-disa`, `gate-registro-alta` y
`test-llm-texto-respuesta`. Medido hoy uno a uno:

- **`gate-nav-inicio-disa` → 34 OK, PASA.** No cae. La afirmación de ayer era falsa: se dio por hecho
  que caería porque prueba el riel de DISA en el Inicio, y **no se comprobó**. Corregido aquí.
- `gate-registro-alta` sigue rojo, pero **ya venía rojo del 1 sep**, así que no se puede atribuir su
  rojo al apagado de la IA sin más.
- `test-llm-texto-respuesta` sí cae por diseño, y su motivo lo dice con todas las letras.

**Los tres siguen esperando su encargo de retirada, y no se han tocado.**

## Lo que queda escrito, que es lo que pedía el criterio

- **De los 39 sin atribuir: 31 eran del fantasma** — se pusieron verdes solos al arreglar las
  conexiones, sin tocar una línea de producto. **Ese 31 sale de RESTAR** (39 − los 8 de abajo), no de
  una lista nominal, porque la lista nominal del 6 sep no se guardó; ver la limitación de arriba.
  Lo que sí es nominal y medido uno a uno son los 8 que siguen rojos.
- **8 siguen rojos y ya tienen dueño:** 3 son secuela del apagado de la IA y van al encargo de
  retirada (`gate-adjuntos-por-contenido`, `gate-disa-adjuntar`, `test-disa-captura-chat`); y
  **5 son defectos de producto de verdad**, que pasan a deuda técnica con su nombre y su síntoma:
  `gate-c5bis-rescate-duenyo`, `gate-csp-estricta`, `gate-impresion`, `test-manifiesto-copias` y
  `verify-libro-sin-huerfanos`.

## Cómo se midió cada uno, para que se pueda repetir

Los nueve se ejecutaron **de uno en uno, sobre el servidor ya arreglado**, no dentro del barrido:
`node scripts/<nombre>.mjs`. Dos (`gate-csp-estricta` y `gate-impresion`) son de navegador y en la
primera pasada se quedaron **sin veredicto** porque mi propio `timeout` de 120 s los cortó antes de
terminar; se repitieron con 420 s. **Un corte por tiempo no es un rojo**, y contarlo como tal habría
metido dos defectos inventados en esta lista.
