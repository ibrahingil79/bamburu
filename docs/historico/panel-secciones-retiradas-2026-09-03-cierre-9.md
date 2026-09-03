# Panel de Notion — entrada retirada el 3 sep 2026 (cierre 9), por tamaño

> **Por qué se retira.** Al añadir la entrada del cierre 9 el panel volvió a pasar de su tope de
> **45.000 letras** (por encima, el chat que lo abre revienta). Sale la entrada del **cierre 7**, que
> era la más antigua de las que quedaban vivas. **Íntegra aquí y sin borrar nada.** En la página se
> quedan los cierres **8 y 9**, y un puntero con lo que de esta sigue vivo.
>
> Las anteriores del mismo día están en `panel-secciones-retiradas-2026-09-03-cierre-6.md`,
> `-cierre-7.md` y `-cierre-8.md`.

---

## Cierre 7 — Bamburu ya no arranca a medias fingiendo que todo va bien

> 🚦 **3 SEP 2026 (cierre 7) — BAMBURU YA NO ARRANCA A MEDIAS FINGIENDO QUE TODO VA BIEN.**
> **Séptima del BLOQUE 2, hecha.** Bamburu se monta por partes —el panel de administración, DISA, el portal de tus clientes, la tienda—. Si una **no cargaba**, escribía un aviso en un registro que no lee nadie **y arrancaba igual**, diciendo `Bamburu listo`. Para el sistema que vigila el servicio, el arranque había sido un éxito.
> **⚠️ Y esto no es un riesgo teórico: ha pasado CINCO VECES EN 30 DÍAS, y en TRES se cayó el panel de administración entero.** Los días 19, 23 y 24 de agosto, `/admin` devolviendo «no existe» mientras el programa contestaba tan tranquilo a todo lo demás. Duraron entre 17 y 89 segundos — **y fueron cortas porque había una persona desplegando en ese momento, no porque nada avisara.** A las tres de la mañana no se habría enterado nadie.
> **🔍 Y al mirarlo apareció un tercer agujero que no estaba ni en la ficha:** si una parte se cargaba bien pero **no traía la función de montarse**, no se montaba **y no se escribía absolutamente nada**. Ni el aviso. No había línea que buscar: no existía.
> **✅ Lo decidiste tú, y así ha quedado: esencial es SOLO el panel de administración.** Sin él Bamburu **no arranca**: el proceso muere diciendo qué parte falta, por qué, y con el error de origen —no un «algo ha ido mal»—. DISA, el portal y la tienda **sí dejan arrancar**, pero **nunca en silencio**: quedan escritos y avisan. Está en un solo sitio, **con el motivo de cada uno**, y una comprobación salta si alguien añade una parte nueva y se olvida de clasificarla.
> **📱 El aviso te llega al móvil, y el obstáculo no era el código.** La llave del bot vivía en un fichero que el programa **no leía**: podía querer avisarte y no tenía con qué. Ahora la lee de donde está, **sin copiar el secreto a ningún sitio nuevo**. Y una regla por encima de todas: **el aviso jamás puede impedir que el arranque falle** — si Telegram no contesta, el proceso se muere igual y queda escrito que el aviso no salió, porque eso también es una noticia.
> **🔁 Sin lluvia de mensajes.** El sistema reintenta el arranque unas cuantas veces antes de rendirse; sin freno habrías recibido cinco mensajes idénticos en diez segundos. Ahora se avisa una vez cada diez minutos por cada fallo distinto.
> **🧪 Probado EN EL SERVIDOR DE VERDAD, no solo en pruebas.** Rompí el panel a propósito y reinicié: **el servicio no levantó**, el sitio dejó de responder, quedó escrito qué parte y por qué, **y el aviso llegó**. El freno funcionó a la primera: **8 intentos, 1 mensaje, 7 frenados**. Restaurado exacto y arrancando limpio. El corte duró unos 40 segundos y fue a propósito.
> **39 comprobaciones en verde**, que **miran si el proceso está vivo o muerto de verdad** —no lo que diga un registro—, y **probadas en rojo cinco veces** rompiendo cada defensa a mano. Y con todo presente, el arranque escribe **las mismas líneas y en el mismo orden** que antes.
> **📝 Apuntado y no arreglado:** la tienda, que está **apagada a propósito desde hace meses**, sigue cantando dos líneas verdes en cada arranque como si estuviera en pie. No monta ni una página. No entraba en esta tarea; queda escrito.
> **🔧 Y una corrección de lo de antes, mía:** cerré la tarea anterior sin la marca que el orquestador necesita para darla por cerrada, así que seguía ofreciéndola como «siguiente» y contaba una pendiente de más. Arreglado, y la regla queda escrita para que no vuelva a pasar.
