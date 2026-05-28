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

## Al TERMINAR (aunque la tarea quede a medias)
8. Actualizar `TABLERO.md`: mover a HECHO, o anotar en HACIENDO dónde quedó.
9. Si se terminó una pieza, actualizar la tabla de estado del `CANON.md` (sección 9).
10. Anotar en `session.json` dónde se quedó, para la próxima sesión.
11. **Cierre de sesión** — pegar a Claude Code este encargo:

    > Cierra la sesión de hoy:
    > 1. Calcula cuánto duró: hora actual menos "sesion_inicio" de session.json.
    > 2. Resume en 2-4 líneas qué hicimos hoy y qué tareas del TABLERO se completaron.
    > 3. Actualiza mi Notion: en la página "Control de Proyecto — Bamburu", añade una
    >    fila a la tabla "Registro de tiempo" con fecha, horas y el resumen. Y actualiza
    >    el KPI "Tareas de Capa 1 completadas" con el número nuevo.
    > NO midas líneas de código (métrica engañosa). Mide tareas completadas y tiempo.

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
