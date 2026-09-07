# Secciones retiradas del panel de Notion — 7 sep 2026 (madrugada, segunda poda)

> **Por qué.** El panel «🧭 Control de Proyecto — Bamburu» tiene un tope escrito de **45.000 letras**
> (regla medida, no estimada: a 62.500 la lectura fallaba; a 40.400 funciona). Al añadir la entrada
> de `conexiones-que-no-se-cierran` volvía a acercarse, así que se retiran las **dos entradas vivas
> más antiguas** de «🚦 DÓNDE LO DEJÉ / DÓNDE SIGO» y la línea de registro de tiempo que las acompaña.
>
> **Las dos estaban cerradas y con su commit**, y lo vigente de cada una vive en `TABLERO.md`.
> **No se ha borrado nada.**

---

## 🔒 6 SEP 2026 (15:20–16:10, ~50min) — TUS BASES DE DATOS YA ESTÁN CIFRADAS EN EL DISCO DEL SERVIDOR.

**Qué cambia, en una frase:** hasta hoy, quien se llevara el disco del servidor podía abrir tus once negocios y leerlo todo —nombres, NIF, facturas, teléfonos— con un programa gratuito y en dos minutos. **Ahora no puede leer ni una letra sin tu llave.**

**🔑 La llave es tuya y solo tuya.** La generaste tú en tu terminal: la máquina llegó a ese punto, **se paró y te la pidió**, y no la ha escrito nunca en ningún sitio suyo. Vive en un fichero del servidor que solo tú y el programa podéis leer; **no está en el repositorio, no viaja dentro de las copias y no aparece en ningún registro ni en ningún mensaje de error**. La guardaste fuera del servidor, en dos sitios. **Si se pierde, no hay quien recupere las bases** — ni yo, ni nadie. Eso ya lo decidiste el 1 de septiembre con estas palabras: *«si se pierde la llave se pierde el negocio vivo, no solo las copias».*

**⚠️ Y una consecuencia nueva que decidiste HOY:** las copias de seguridad de ahora en adelante **también van cifradas con esa llave**, así que para restaurar hacen falta **las dos** (esta y la de las copias). Se eligió así porque la otra opción era dejar, cada madrugada durante unos ocho minutos, una copia entera y perfectamente legible de tus once negocios en el mismo disco del que esto protege.

**🧯 Si falta la llave o es la que no es, Bamburu NO arranca a medias:** se para y dice por qué, sin enseñar la llave ni dónde viven las bases. Arrancar «a medias» habría servido pantallas vacías, como si tus negocios no tuvieran datos dentro — que es la peor forma de fallar, porque parece que funciona.

**📦 No se ha borrado nada.** Las doce bases antiguas sin cifrar están **apartadas** en una carpeta fuera de los negocios, con su nota y la huella de cada fichero, igual que se hizo con las bases fantasma. **Y decidiste apartar también 49 MB de copias viejas** que seguían sin cifrar en ese mismo disco: eran fotos de seguridad de limpiezas antiguas, con los mismos clientes y las mismas facturas dentro. Borrarlas de verdad sigue siendo decisión tuya.

**🐛 Dos cosas que iban a salir mal y se cazaron construyendo, no después:** la copia de cada noche sacaba de una base cifrada **una copia SIN cifrar** —o sea, a las 3:33 de la mañana el cifrado no habría servido de nada—; y tres piezas preguntaban «¿esta base abre bien?» a una herramienta que no conoce tu llave, y habrían dado por rota una copia perfectamente buena, cada noche.

**👆 Comprobado en tu Bamburu de verdad, abriendo y PULSANDO:** el panel (con tus 3.000 € del mes y tus 141 facturas vivas), la ficha de un cliente, la agenda (cambia de día y pinta a tus cuatro empleados), el mostrador —**pulsé un producto y cayó en el ticket**: 36,00 € + IVA = 43,56 €— y el portal del cliente por su enlace. Además **la copia de seguridad real completa**, con sus 14 archivos, descargando y comparando como siempre y **descifrando de verdad** lo que baja de Drive. Y **dos de tus cinco tareas de reloj, ejecutadas de verdad**, no supuestas.

**🧪 La comprobación nueva se pone ROJA a sí misma tres veces** —sin llave, con llave equivocada, y con una base devuelta a claro— y va en el barrido rápido. El motivo: **una base sin cifrar no se nota usando Bamburu**, funciona exactamente igual de bien. Solo se ve mirando el fichero. Y esa comprobación se cazó a sí misma en la primera pasada, por buscar un nombre en vez de lo que importaba; corregida.

**📌 Apuntado y NO arreglado, porque no es de esta tarea:** al parar el servicio, el sistema tuvo que matarlo a la fuerza tras 90 segundos — Bamburu no atiende la señal de apagado. Viene de antes y significa que **cada reinicio corta en seco**; las doce bases quedaron sanas, y eso se comprobó una a una.

**Commits:** `6e2041f` y `ef99996`.

**▶️ LA SIGUIENTE TAREA:** dejar escrito qué permiso exige cada pantalla (`permisos-paso-1-censo-rutas`). Del bloque «que sea seguro de verdad» van **17 de 18**.

---

## ✅ 5 SEP 2026 (17:30–19:00, ~1h30) — HECHO. EL PERMISO VIEJO YA NO EXISTE EN NINGUNA PARTE DE BAMBURU.

**Esto cierra la tarea entera**, la que llevaba desde el 4 de septiembre. `unsafe-inline` —el permiso que dejaba ejecutar código suelto dentro de tus páginas— **ya no está en ninguna respuesta**: ni en el panel, ni en la página de entrada, ni en el portal de tus clientes, ni en la de la cita, ni en la página pública, ni siquiera en las pantallas de error. Si alguien logra colar texto suyo en un nombre o en una nota, **el navegador ya no lo ejecuta**.

**🔍 Qué medí antes de quitarlo, porque esto no se hace a ojo:**

**La tienda.** No estaba apagada «por negocio»: está apagada **entera**, por una decisión tuya de hace semanas. Así que no la encendí en producción: la monté **un rato en una copia de pruebas**, mientras tu Bamburu seguía sirviendo la versión apagada. Tenía 19 trozos de código suelto: **migrados y probados pulsando** (buscar en el catálogo, subir cantidad en el carrito, quitar una línea, entrar). **La tienda vuelve apagada** — pero el día que la enciendas, ya cumple.

**Las pantallas de error y los papeles** (PDF, CSV, Excel, respuestas técnicas): limpias, y comprobado que **se siguen descargando** igual.

**👆 Y lo comprobé en tu Bamburu de verdad, abriendo y pulsando:** panel, ficha de cliente, agenda, entrada, portal del cliente, página de la cita y página pública. **Todas abren, todo responde, cero avisos del navegador, cero errores.**

**🧪 Y la avería provocada final, en sus dos formas:** devolví un trozo de código suelto a una pantalla y **la comprobación cayó y dijo cuál era**; y cuando lo puse **en lugar** del enganche bueno —que es la regresión de verdad, la que deja un botón muerto— **cayeron las dos comprobaciones**.

**📌 Dos cosas apuntadas, que NO son de esta tarea:** el **constructor de tienda** sigue sin migrar, pero su pantalla no se sirve (queda ficha para el día que se monte); y al medir la tienda salieron **dos roturas anteriores**: el **pago da error** (le falta una tabla archivada, ya lo decía tu propia nota) y **la ficha de producto siempre redirige** al catálogo. Las dos, apuntadas.

**▶️ LA SIGUIENTE TAREA:** el **cifrado en reposo de las bases** de cada negocio. Del bloque «que sea seguro de verdad» van **16 de 18**. Esa lleva **tu firma**: montar el cifrado es técnico, **guardar la llave no** — si se pierde, no se pierde una copia: se pierde el negocio en marcha.

**Commits:** `ed34c74` y los doce de la tarde.

---

## ⏱️ Y la línea de registro de tiempo que las acompañaba

- 6 sep 2026 (15:20–16:10) · ~50min · `cifrado-en-reposo-bases` — las 12 bases vivas (control + 11 negocios) pasan a estar **cifradas en el disco**. Llave generada por Ibrahin en su terminal y custodiada por él fuera del servidor. El punto único de apertura es `core/sqlite-bamburu/`, que **suplanta al paquete `better-sqlite3`** para que las 345 aperturas del árbol no cambien ni una línea y para que olvidar la llave sea imposible. Migración base a base con censo, copia previa verificada y comparación de contenido tabla a tabla (23.704 filas en el negocio de desarrollo); originales apartadas con sus huellas, y con ellas 49 MB de copias viejas en claro. Gate nuevo con tres rojos provocados (24 ✓ · 0 ✗), restauración completa en verde con la copia ya cifrada (21 ✓ · 0 ✗), copia real de 14 archivos con los 12 restore-test descifrando, dos tareas de reloj por systemd, y 23 ✓ · 0 ✗ pulsando en panel, ficha, agenda, mostrador y portal. Commits `6e2041f` + `ef99996`.
