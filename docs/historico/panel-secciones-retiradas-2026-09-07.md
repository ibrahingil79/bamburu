# Secciones retiradas del panel de Notion — 7 de septiembre de 2026

**Por qué: por TAMAÑO, y está medido.** El panel estaba en **38.935 letras** y la entrada del apagado
de la IA ocupa unas 4.200: habría quedado a menos de 1.900 del tope de **45.000**, demasiado cerca.
Se retiran las **dos entradas más antiguas** de la bitácora viva —el blindaje del panel contra código
colado, del 5 y el 4 de septiembre—, **6086 letras**.

**No se ha borrado nada.** Copia íntegra y byte a byte de lo que salió del panel.

**⚠️ Y lo que NO se retiró, a propósito:** los punteros `🗂️` que hay debajo de esas entradas. Son el
ÍNDICE del archivo —dicen dónde está cada cosa retirada antes— y quitarlos habría dejado el histórico
sin camino de vuelta. La primera versión de este podado se los llevaba por delante; se corrigió antes
de publicar.

---

> 🏁 **5 SEP 2026 (14:00–17:30, \~3h30) — EL PANEL ENTERO. LAS 336 PANTALLAS, LIMPIAS.**
> **Ya no queda ni un trozo de código suelto en el panel.** De las 50 pantallas que quedaban esta mañana a **cero**: contabilidad entera, la agenda entera, cobros, pagos, inventario, propuestas, proyectos, proveedores, categorías, almacenes, usuarios, tiempo, clientes, productos, facturas emitidas y recibidas, la captura de facturas y los ajustes. **336 de 336 blindadas.**
> **🧠 Y el parte que te di ayer estaba MAL, y conviene que lo sepas:** la medida contaba **cuántas veces salía** cada botón, no **cuántos sitios** había que tocar. Los «83 de clientes» eran **8**; los «70 de productos», **12**; los «283 de cobros», **3**. Las tres pantallas que iban para gordas no lo eran, y por eso cupo todo lo que quedaba en una tarde.
> **🧹 Y limpié lo que autorizaste:** los tres clientes con una trampa de atacante por nombre. Salían inofensivos —escapados— pero ensuciaban tus desplegables. Borrados con copia previa; el cuarto, que tiene 25 facturas en la cadena de Hacienda, **no se toca**.
>
> ⚠️ **TRES FALLOS MÍOS, Y TE LOS CUENTO ENTEROS.**
> **1) Tumbé Bamburu un minuto.** Subí un fichero con un error de escritura y además **silencié el aviso** que lo habría dicho. Ya está arreglado —y ahora el programa de subida **comprueba que todo compila ANTES de reiniciar**: si algo no, no reinicia y dice cuál. Probado provocando el fallo: Bamburu ni se enteró.
> **2) Descarté 18 propuestas de DISA de verdad.** Mi comprobación pulsaba «Descartar» dando por hecho que preguntaba antes. **No pregunta.** Las 18 están **repuestas**, con copia previa de la base, y la comprobación ya no toca nada: finge la pulsación. **La lección: antes de pulsar un botón en una prueba hay que leer qué hace. «Pregunta antes» era una suposición mía, no una medida.**
> **3) Rompí la página que abre tu cliente con el enlace de su cita** —daba error del servidor— y **la comprobación dio verde encima**, porque miraba la cabecera y no si la página abría. Arreglado, y ahora **una pantalla rota es un fallo, no algo que se salta**; además la comprobación **se hace sola la lista** de qué vigilar, así que una pantalla nueva no puede quedarse sin vigilancia.
>
> **▶️ QUEDA UN SOLO PASO, y no lo doy a ciegas:** quitar del todo el permiso viejo. Hoy la lista dice qué se blinda; al quitarlo, **se blinda todo lo que responda el servidor**, también la tienda pública y las páginas de error. La tienda **no está encendida** en tu negocio de pruebas, así que ahí no se puede medir — y el modo de fallo es el de siempre: lo que se rompa **no falla al cargar, falla al pulsar**. Necesito medirlo con la tienda encendida, y tu visto bueno.
> **Commits:** `3b58c17`, `6682416`, `d527c39`, `8e20f24`, `067345e`, `9f683a8`, `c42f9ed`, `29f0d62`, `975f393`, `5ac3077`, `d8401d1`, `d719b90`.
>
> 🧱 **4 SEP 2026 (16:45–18:35, \~1h50) — TERMINADA LA LISTA DE PANTALLAS QUE HABÍAMOS APUNTADO. Y APARECIÓ CÓDIGO QUE NINGUNA MEDIDA PODÍA VER.**
> **Nueve pantallas más blindadas, y con eso se acabó la cola:** presupuestos, órdenes de compra y compras (las tres enteras: ficha, alta y edición), servicios de agenda, mostrador, avisos, las dos del CRM y la agenda. **289 pantallas blindadas de 339 — y ya no queda ni una pantalla limpia sin blindar.**
> **⚠️ Lo importante de hoy, y no es agradable: había un buscador MUDO en producción y no lo sabíamos.** En «albarán nuevo» y «pedido nuevo», el campo para buscar productos del catálogo **llevaba desde ayer sin ofrecer nada**. Ni error, ni aviso: escribías y no pasaba nada.
> **Por qué se escapó.** Hasta hoy medíamos lo que el servidor MANDA. Pero ese buscador **se dibuja después, ya en tu navegador**, así que en lo que manda el servidor no aparecía: la medida decía «limpia» y ayer se blindó. **Arreglado hoy**, y con él otras dos piezas de la misma familia que aún no habían roto nada pero lo habrían roto en la siguiente pantalla: el menú «···» de las filas y el botón de las pantallas vacías.
> **🧭 La regla que sale de aquí, y manda desde hoy:** *una pantalla no está medida hasta que un navegador de verdad la abre, pulsa y escribe.* La comprobación automática ahora teclea en ese buscador y exige que salgan sugerencias.
> **👆 Todo probado pulsando, incluido lo que da miedo tocar:** las ventanas de cobrar, pagar y ajustar existencias se abren y se cierran **sin registrar nada**; en el mostrador se mete un producto en el ticket, se cambia la cantidad y se quita; en el CRM se arrastra una tarjeta; en la agenda se pulsa **una casilla de la rejilla**, que es lo que se repinta cada vez. **Cinco averías provocadas a propósito**, cada una sobre el botón exacto: las cinco cayeron.
> **🧪 Y dos cosas que aprendí de mis propias comprobaciones, porque casi me engañan:**
> **Una comprobación que se ROMPE no dice «ha fallado», dice «no he podido probarlo»** — y eso se lee como verde. Al provocar una avería, la prueba del mostrador reventó entera y **no dio ni un veredicto**. Ya no puede.
> **Contar cuántas cosas funcionan permite que UNA esté muerta.** La prueba de avisos decía «al menos dos ventanas abren» y **la avería provocada siguió en verde**. Ahora exige que **ninguno** de los botones que hay en pantalla se quede mudo.
> **📊 Cómo queda:** de 580 trozos de código suelto a **332**, y de 49 bloques a **43**. La comprobación grande pasa de 65 a **141 puntos, todos en verde**.
> **▶️ Quedan 50 pantallas**, casi todas de una o dos piezas. Las tres gordas del final: proyectos (43), productos (70) y clientes (83).
> **📌 Tres cosas que vi y NO he tocado, apuntadas en la lista:** el buscador de «albarán nuevo» **tampoco funcionaba antes** por otro motivo distinto (le falta un dato al programa) — es anterior y no es de esta tarea; dos comprobaciones de citas llevan fallos **de antes** (lo medí con y sin mis cambios: idénticos); y **un cliente de tu negocio de pruebas se llama con una trampa de las que usan los atacantes** — sale inofensiva, escapada, pero ensucia los desplegables.
> **Commits:** `e85e076`, `0052e98`, `4b70ece`, `223c51b`, `44cd2ab`.
>
