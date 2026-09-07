# Panel de Notion — sección retirada el 8 sep 2026, por tamaño

Copia íntegra, byte a byte, de la entrada más antigua que quedaba en «🚦 DÓNDE LO DEJÉ / DÓNDE SIGO»
del panel de Notion «🧭 Control de Proyecto — Bamburu», retirada al añadir el cierre de las tres
fichas de seguridad (`barrera-de-permisos` y compañía). No se ha borrado nada: vive aquí completa.

---

🤖 **7 SEP 2026 (noche) — DISA SALE DEL PRODUCTO, PASO 2: EL CÓDIGO YA NO ESTÁ. Es el borrado que faltaba tras la entrada de arriba.**

**39 ficheros borrados, ~5.000 líneas**: el módulo entero del chat, `core/llm.js` (el interruptor de esta madrugada, y ahora ni el candado sigue: no hay puerta que abrir), y 34 comprobaciones que solo existían para vigilarlo. **12 ficheros compartidos, tocados con cuidado** — quitando solo la parte del chat, dejando el resto exactamente igual.

**🚨 Se cumplió lo que avisé anoche: la trampa de `disa_proposals` no se pisó.** 86 apuntes, contados antes de tocar nada y contados otra vez al terminar: **86 = 86.** Volcadas a fichero las 9 tablas de verdad del chat antes de archivarlas (nunca borradas: `ALTER TABLE … RENAME TO …_archived`, la regla de esta casa) — 137 tablas en 18 negocios, ninguna destruida.

**✅ Criterio corregido por ti, cumplido:** no había paquete que desinstalar (el chat hablaba por `fetch` directo). El criterio pasó a ser cero apariciones de la dirección del proveedor en todo el árbol — comprobado con un censo nuevo, `verify-sin-proveedor-ia`, probado en rojo contra el árbol real: **4 ✓ · 0 ✗.**

**🎢 Y un incidente de verdad en medio de la verificación, resuelto sin perder nada.** El negocio que usan las comprobaciones como banco de pruebas (`desarrollo-bamburu`) se corrompió de verdad bajo la carga del barrido —no por el borrado en sí— y varios cientos de gates de margen, avisos y traslados se pusieron rojos de golpe. Recuperado desde la copia cifrada de esa misma madrugada (la única con menos de 13h), con el fichero dañado archivado sin borrar y las dos únicas facturas posteriores revisadas una a una (residuo de pruebas, cero dato real). Esto destapó también **una avería real en producción, sin relación con hoy salvo la causa**: el contador de pendientes de Propuestas llevaba desde el 6 de septiembre desapareciendo en silencio cada vez que alguien reordenaba su menú, porque una copia del código se quedó comparando contra el nombre viejo del área («disa») en vez del nuevo («propuestas»). Arreglado.

**📊 Barrido completo, con todo lo de arriba ya resuelto: 163/212 pasan** (esta mañana: 176/229 — 17 menos en el total porque son, justamente, las comprobaciones del chat que se borraron con él). Cero rojos nuevos causados por el borrado. `gate-registro-alta` se queda en rojo **tal y como pediste**: sus 4 fallos son del alta pública rota, no de esto.

**🆕 Y dos hallazgos que te pedí anotar hoy, los dos:** el alta pública de Bamburu **está rota** — `/api/registro/crear` responde 409 siempre porque el formulario que sustituye al chat no existe, y nadie puede darse de alta — va **la primera de la cola**. Y los vestigios del superadmin que vigilaban el gasto de IA (marcarán cero para siempre) quedan apuntados, sin prisa.

**⚠️ Pendiente, y no es mío:** la clave `ANTHROPIC_API_KEY` sigue en `/etc/bamburu.env`, sin que nada la lea ya. Quitarla del servidor y revocarla en la web del proveedor es cosa tuya.

**Commits:** `eae5394` (código) · `4d96483` (arreglos destapados al verificar) · `071d399` (datos).
