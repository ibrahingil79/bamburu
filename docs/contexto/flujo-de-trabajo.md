# Flujo de trabajo — Bamburu

> Cómo se hace un cambio, cuándo está "terminado" y cómo se cierra. Fuente: RITUAL.md + práctica del repo.

## ⛔ Reglas de oro antes de tocar nada

1. **Antes de cualquier cambio, lee `docs/contexto/piezas-cerradas.md` y `docs/contexto/errores-conocidos.md`.**
2. **Lo marcado como cerrado / intocable no se toca ni se "mejora" sin un encargo explícito que lo pida.** Si crees que hay que tocarlo, párate y pregunta antes.
3. **Nada está "terminado" hasta verse pintado en un navegador real.** La verificación headless/lógica es necesaria pero NO suficiente. El cierre es siempre en dos pasos: Code presenta la verificación literal y se para → Ibrahin valida en navegador real → entonces commit.

## Al empezar
1. Leer `CANON.md` (qué es / qué NO) y `TABLERO.md` (qué toca). Leer `session.json` (dónde se quedó).
2. Coger la **primera** tarea de "POR HACER" → moverla a "EN CURSO". **Una sola tarea en curso a la vez.**
3. Releer su criterio de "HECHO CUANDO" antes de tocar código.

## Durante
4. Trabajar solo esa tarea. Motores antes que la cara de DISA. Nada de Capa 2/3 hasta cerrar Capa 1.
5. Cirugía: un cambio cada vez, reutilizando lo que ya existe (no duplicar reglas).
6. Idea nueva → pasarla por "la línea" (CANON): si no es de ahora, se anota, no se construye.

## Cierre en DOS PASOS (regla del proyecto)
1. **Claude Code verifica y PARA.** Hace la verificación (lógica + headless + la prueba real de la pieza), presenta la salida literal y **se detiene**. **No** hace commit, **no** publica en Notion, **no** reinicia con cambios sin permiso.
2. **Ibrahin valida en navegador real.** Da el OK explícito.
3. **Solo entonces** Claude Code cierra: `commit` + `push` + actualizar `TABLERO.md` + actualizar el panel/espejo de Notion.

> **La verificación headless es NECESARIA pero NO SUFICIENTE.** Que parsee, que el servidor responda 200 o que un test headless pase **no** significa "terminado". Nada está terminado hasta **verse pintado en un navegador real** (el bug del Inventario en blanco pasó dos chequeos server-side: el `<script>` no parseaba en el navegador y los datos sí estaban). El OK final en navegador real es de Ibrahin, siempre.

## Checklist de "terminado"
- [ ] Cumple el criterio "HECHO CUANDO" de la tarea, sin recortes.
- [ ] No rompe reglas permanentes (sin DROP/borrado; facturas inmutables; `requirePerm`; salida escapada; estados en español).
- [ ] Verificación de lógica (test temporal) + headless (`verify-*`/`gate-*`) en verde.
- [ ] **Visto pintado en navegador real** (consola limpia, la pieza se ve y funciona) — OK de Ibrahin.
- [ ] `TABLERO.md` actualizado (pieza → HECHO con fecha + commit; siguiente en POR HACER).
- [ ] Espejo de Notion al día si se tocó documentación (ver REGLA DE ORO).

## Deploy
- El servicio corre bajo **systemd `bamburu.service`** (`User=ubuntu`, `/home/ubuntu/bamburu`).
- Reiniciar tras un cambio: `sudo systemctl restart bamburu`; estado `systemctl status bamburu`; logs `journalctl -u bamburu -f`.
- Cada negocio entra por `https://<slug>.bamburu.com/admin/login` (Caddy + HTTPS comodín).
- Push: rama `master`, remoto SSH (`git push origin master`).

## REGLA DE ORO — espejo de `docs/contexto/` en Notion (anti-desfase)
- El repo es la **única fuente de verdad** de los 7 documentos de `docs/contexto/`. Notion es un **espejo de solo lectura**.
- **Cada vez que se modifica un documento de `docs/contexto/` en el repo, en el MISMO cierre se reescribe su subpágina espejo en Notion. Nunca uno sin el otro.** El espejo se **sobreescribe** (no se acumulan versiones).
- No duplicar `TABLERO.md` ni ninguna tabla del tablero en Notion: el tablero vive solo en `TABLERO.md`.

## Archivo de auditorías (Notion)
- Todo informe de **diagnóstico o auditoría de solo lectura** que se produzca (p. ej. el mapa de C.0, el diagnóstico del Inventario en blanco) se vuelca **íntegro** a la página "🔍 Auditorías y diagnósticos" del panel, con fecha y título, **antes de cerrar** la tarea que lo originó. Es el registro que de otro modo se perdería entre chats.
