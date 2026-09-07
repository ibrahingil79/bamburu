# Panel de Notion — sección retirada el 7 sep 2026 (noche), por tamaño

Copia íntegra, byte a byte, de la entrada más antigua que quedaba en «🚦 DÓNDE LO DEJÉ / DÓNDE SIGO»
del panel de Notion «🧭 Control de Proyecto — Bamburu», retirada al añadir el cierre de
`arreglar-alta-publica`. No se ha borrado nada: vive aquí completa.

---

🔌 **7 SEP 2026 (madrugada) — BAMBURU YA CIERRA LAS BASES QUE ABRE. Y AHORA UN BARRIDO SE PUEDE CREER.**

**Esto arregla lo que ayer te dejé escrito como «no puedo afirmar nada».** Bamburu abría la base de datos de cada negocio y **no la cerraba nunca**. En una sola pasada de las comprobaciones el servidor se quedaba con **92 conexiones a bases que ya no existen**, y eso fue lo que **tumbó el acceso al panel entero** la tarde del 6.

**📊 Antes y después, medido en el servidor, con la misma pasada completa de comprobaciones:**

**Antes: 35 bases abiertas** — 30 apuntando a ficheros borrados, 2 «rancias» y 3 sanas. **Después: 3 bases abiertas, las 3 sanas. Cero y cero.**

**Y las comprobaciones pasan de 141 de 228 a 176 de 229**, sin tocar ni una línea del producto. Lo único que ha cambiado es que el servidor ya no se estropea mientras se le mide.

**🧹 Qué hace ahora, en cristiano:** si borras un negocio, suelta su base **en el acto**; si una base lleva **veinte minutos** sin usarse, la cierra sola y la reabre cuando haga falta (no cuesta nada); tiene un tope de 200 abiertas a la vez como red de seguridad; y al parar el servicio las cierra ordenadamente. **Y sabe decirte en cualquier momento cuántas tiene abiertas y en qué estado** — sin eso no se podía demostrar nada.

**🧪 Probado quitándolo a propósito, por los dos lados:** se desactiva el cierre y la comprobación cae; se desactiva la detección y vuelve a caer, diciendo cuál. Una comprobación que no ha fallado nunca no vale.

**⚠️ Y apareció algo que no buscábamos, y es peor de lo que creíamos.** Ayer te dije que una conexión huérfana **deja de ver** lo que escriben los demás. Midiéndolo resultó que además **DESTRUYE**: mientras esa conexión siga abierta, lo que escriban otros procesos en esa base **se pierde para siempre**. **Tus datos no han sufrido** — lo que escribía la propia conexión sí se guarda al cerrarla, y eso se comprobó antes de reiniciar—, pero explica por qué esto no podía esperar.

**🔍 Los 39 rojos que quedaban sin dueño, ya tienen dueño.** Era la condición para cerrar esto. **31 eran del fantasma** (se pusieron verdes solos). **3 son secuela de apagar la IA** y van al encargo de retirada. **Y 5 son defectos de verdad**, con nombre y síntoma, apuntados en el tablero — el más serio: en el negocio de desarrollo hay **dos apuntes contables sin documento**.

**📝 Y una corrección de ayer:** de las tres comprobaciones que dije que «caen por diseño», **una no cae** — pasa perfectamente. Lo di por hecho sin comprobarlo. Corregido.

**📌 Apuntado y NO construido:** los navegadores colgados (ya van **23**, eran 13 — crecen en cada pasada), que Bamburu no atienda la señal de apagado, y **que no exista forma de dar de baja un negocio y borrar sus datos**: hoy no molesta porque todos son de prueba, pero con clientes de pago **es una obligación legal**.

**Commit:** `d03f7e6`.
