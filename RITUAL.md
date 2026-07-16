# RITUAL DE TRABAJO — Bamburu

> Cómo se trabaja en cada sesión. Para alguien solo, con Claude Code, sin horario fijo.
> La consistencia no viene del reloj — viene de repetir el mismo ritual cada vez.

---

## Actualización — FASE DE OPTIMIZACIÓN (v2)

> Este bloque manda sobre lo que siga abajo cuando haya contradicción; el resto se conserva como
> referencia del ritual de cierre.

- Estamos en **fase de optimización** (CANON v2 §4) sobre **tres ejes: UX, DISA, Seguridad**. Las
  **funciones nuevas ceden prioridad al pulido**, salvo decisión expresa del dueño.
- **Cuándo salir al mercado lo decide el dueño.** El asistente y Code no lo recomiendan ni lo usan
  como argumento; solo ejecutan lo que el dueño prioriza.
- **Al empezar** cada sesión, lee la biblia: `CANON.md`, `TABLERO.md`, `RITUAL.md`, `CLAUDE.md` y
  `docs/contexto/`. **Fuente única de tareas: `TABLERO.md`** (empezando por el Eje A — UX). Notion es
  solo panel (KPIs, tiempo, "dónde sigo"); no dupliques tareas ni toques sus tablas.
- **Aditivo, sin DROP.** No toques huella/Verifactu, stock, permisos base ni la lógica de
  facturas/cobros/ledger salvo autorización expresa de la tarea, y siempre por su flujo con
  confirmación (nunca escritura silenciosa).
- **Simplicidad y cambios quirúrgicos.** Código/edición mínima; no "mejores" lo adyacente.
- **Verificación siempre:** cada tarea define su test/gate propio y cierra con **regresión 0** en lo vivo.
- **Legal/regulatorio:** verificado contra fuente oficial en la web, nunca de memoria.
- **Al terminar:** `commit` + `push` con mensaje claro y actualiza el bloque **"DÓNDE LO DEJÉ / DÓNDE
  SIGO"** de Notion. **Un tema por chat**: al cerrar, avisa para abrir chat nuevo.

---

## Al EMPEZAR cada sesión
1. Anotar la hora de inicio en `session.json` (campo "sesion_inicio").
2. Leer `CANON.md` (qué es Bamburu y qué NO) y `TABLERO.md` (qué toca).
3. Leer `session.json` para saber dónde se quedó la sesión anterior.
4. Coger la primera tarea de "POR HACER" en el TABLERO y moverla a "HACIENDO".
5. Releer su criterio de "HECHO CUANDO" y confirmarlo antes de tocar código.

## DURANTE la sesión
6. Trabajar SOLO esa tarea. Nunca dos en "HACIENDO" a la vez.
7. Si aparece una idea nueva, pasarla por "la línea" (CANON sección 4):
   ¿ayuda al autónomo de servicios a gestionar su negocio? Si no → no se toca ahora.
   Si es buena pero no es de ahora → anotarla, no construirla.

## Al TERMINAR — rutina de cierre (siempre, en este orden)

Esta rutina se ejecuta SIEMPRE al final de la sesión. Es la única forma de que
Notion quede al día sin que el fundador toque nada. Cuatro pasos, a/b/c/d:

**a) Actualizar `TABLERO.md`**
- Mover a `🟢 HECHO` las tareas completadas hoy (con fecha + commit).
- Si la sesión terminó en mitad de una tarea, dejar la nota en `🟡 HACIENDO`.
- La siguiente queda como primera en `🔵 POR HACER`.

**b) Actualizar `CANON.md` si se cerró una pieza**
- **CANON v2 NO tiene tabla de estado.** Son 7 secciones de estrategia (identidad, fase,
  reglas, quién decide, mapa de capas) y el estado de las piezas vive en `TABLERO.md`, que
  es la fuente única. No busques filas `❌ Falta` → `✅ Funciona`: se fueron al reescribir el
  CANON para la fase de optimización. **La mayoría de las sesiones NO tocan CANON.**
- Solo se toca si la sesión cambia la ESTRATEGIA: una decisión de producto, un hueco o una
  dependencia no prevista (§4 fase y ejes, §6 quién decide). Cerrar una tarea no es eso.
- Si no hay nada estratégico que anotar, este paso se salta y se dice: "b) CANON sin cambios".

**c) Actualizar Notion** — página "Control de Proyecto — Bamburu"
(ID `36e18b04-bb1f-812f-99ee-f96789ac2909`, token en `/etc/bamburu.env`
como `NOTION_TOKEN`).

> Los nombres de abajo son los EXACTOS de la página. Cópialos, no los reconstruyas de
> memoria: si el bloque que buscas no aparece tal cual, **es que cambió la página — para y
> mira, no lo inventes**. Esta regla nace de que durante semanas se mandó actualizar un KPI
> ("Tareas de Capa 1 completadas") que no existía: el ritual se cumplía sobre un fantasma y
> el indicador real se quedó seis días diciendo que el Pilar 3 estaba en curso cuando ya
> estaba cerrado. Un panel que miente es peor que no tener panel.

  1. **`🚦 DÓNDE LO DEJÉ / DÓNDE SIGO`** (arriba del todo, NO confundir con `📍 Dónde estoy`,
     que es un histórico más abajo y no se toca). Es una lista de citas, la más nueva primera:
     AÑADIR arriba una `> ✅ HECHO (D mes AAAA) — <código> — <resumen>. Commit <hash>.`, y que
     termine en `· SIGUIENTE TAREA: <la primera de POR HACER en el TABLERO>`.
  2. **KPIs** (sección `📊 KPIs`) — solo si la sesión mueve alguno. Los que existen:
     - **`Fase del producto`** → qué pilar está cerrado y cuál en curso. Se mueve al cerrar
       un pilar (Catálogo · Cliente · Inventario · Ventas). Espejo de él: la sección
       `🧭 Los 4 pilares` — si cambia uno, cambia el otro, o se contradicen.
     - **`Cumplimiento España (Verifactu)`** → al avanzar el envío a la AEAT o Facturae.
     - **`Código respaldado en GitHub`** · **`Clientes de pago`** · **`Ingreso recurrente
       mensual`** → hoy fijos; se mueven al lanzar, no al programar.
     - **Si la tarea no mueve ninguno, NO se inventa un KPI.** En la fase actual
       (optimización por ejes A/B/C, CANON §4) lo normal es que **ninguno se mueva**: un eje
       no es un pilar. Esa sesión solo hace los bloques 1 y 3 — y eso es correcto, no un
       descuido.
  3. **`⏱️ Registro de tiempo`** → AÑADIR una línea nueva **al FINAL** (es cronológico, el
     último es el más reciente) con `D mes AAAA · ~Xh · resumen de 1 línea`. No editar las
     previas ni reordenarlas.

**d) Commit + push** (SSH, sin tokens)
- `git add` los archivos de docs y código modificados.
- Mensaje claro: qué se cerró, qué commits incluye.
- `git push origin master`.

---

### Reglas que protegen el panel
- **El detalle de tareas vive SOLO en `TABLERO.md`.** En Notion va el panel
  ejecutivo (KPIs + registro de tiempo + "dónde sigo"). No duplicar la tabla
  de tareas en Notion.
- **Código + nombre, siempre.** En cualquier referencia a una tarea dentro
  de Notion (`🚦 DÓNDE LO DEJÉ / DÓNDE SIGO`, "SIGUIENTE TAREA", KPIs, entradas
  del `⏱️ Registro de tiempo`) escribir SIEMPRE el código y el nombre real:
  `A3 — Catálogo mixto de servicios`, no `A3` a secas. Esto permite que un
  chat sin contexto lea Notion y entienda qué es cada tarea sin inventar.
- **No se mide en líneas de código.** La métrica de progreso es tareas
  completadas y tiempo invertido.
- **Idempotencia.** Si la rutina se ejecuta dos veces seguidas, no debe
  duplicar nada: los KPIs se sobreescriben con el mismo valor; a
  `🚦 DÓNDE LO DEJÉ / DÓNDE SIGO` y al `⏱️ Registro de tiempo` solo se añade
  entrada cuando hay trabajo nuevo que reportar — los dos son listas que
  CRECEN, así que repetir la rutina sin trabajo nuevo duplicaría. Antes de
  añadir, comprueba si la entrada de esa tarea ya está.

---

## Reglas que protegen el proyecto
- UNA tarea en HACIENDO a la vez. Terminar antes de empezar.
- MOTORES antes que la CARA de DISA: el núcleo debe ser fiable antes de que DISA lo accione.
- Nada de Capa 2 o 3 hasta cerrar Capa 1. Si tienta, releer CANON sección 5.
- Se puede parar a mitad de una tarea: el ritual guarda el hilo para retomarlo.
- La métrica de progreso es TAREAS COMPLETADAS, no líneas de código (engañan).

## Recordatorio para el fundador
- Una hora con la cabeza fresca vale por tres agotado. El descanso es parte de avanzar.
- Esto es una maratón de meses. Gana quien no se cae, no quien corre más rápido al principio.
