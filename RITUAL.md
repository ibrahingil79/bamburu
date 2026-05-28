# RITUAL DE TRABAJO — Bamburu

> Cómo se trabaja en cada sesión. Para alguien solo, con Claude Code, sin horario fijo.
> La consistencia no viene del reloj — viene de repetir el mismo ritual cada vez.

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
- En la tabla de estado (sección 9), cambiar la fila de `❌ Falta` a `✅ Funciona`.
- Si se descubrió algo no previsto del producto (decisión, hueco, dependencia),
  añadirlo al CANON antes de cerrar.

**c) Actualizar Notion** — página "Control de Proyecto — Bamburu"
(ID `36e18b04-bb1f-812f-99ee-f96789ac2909`, token en `/etc/bamburu.env`
como `NOTION_TOKEN`). Tres bloques:

  1. **"Dónde lo dejé / Dónde sigo"** (sección `📍 Dónde estoy`):
     - "Hecho y funcionando" → última tarea terminada (más las anteriores).
     - "Siguiente tarea" → la primera de POR HACER en el TABLERO.
  2. **KPI "Tareas de Capa 1 completadas"** → `X / 11`.
  3. **"Registro de tiempo"** → AÑADIR una línea nueva con
     `AAAA-MM-DD · ~Xh · resumen de 1 línea`. (No editar líneas previas.)

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
  de Notion (KPI, "Hecho y funcionando", "Siguiente tarea", entradas del
  Registro de tiempo) escribir SIEMPRE el código y el nombre real:
  `A3 — Catálogo mixto de servicios`, no `A3` a secas. Esto permite que un
  chat sin contexto lea Notion y entienda qué es cada tarea sin inventar.
- **No se mide en líneas de código.** La métrica de progreso es tareas
  completadas y tiempo invertido.
- **Idempotencia.** Si la rutina se ejecuta dos veces seguidas, no debe
  duplicar nada: el bloque "Dónde estoy" y el KPI se sobreescriben con el
  mismo valor; al Registro de tiempo solo se añade entrada cuando hay
  trabajo nuevo que reportar.

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
