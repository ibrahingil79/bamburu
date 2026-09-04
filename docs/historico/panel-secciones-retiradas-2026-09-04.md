# Secciones retiradas del panel de Notion — 4 sep 2026

**Por qué se retiró.** Por TAMAÑO, y es la regla escrita en el propio panel: **se mantiene por
debajo de unas 45.000 letras**, porque medido el 31 ago 2026 a 62.500 la lectura ya fallaba y a
40.400 funcionaba. Una página grande revienta el chat que la abre.

**Qué se retiró.** La entrada COMPLETA más antigua que quedaba en «🚦 DÓNDE LO DEJÉ / DÓNDE SIGO»:
la rotación de la llave de cifrado de las copias del 3 sep 2026. En el panel queda un puntero a
este fichero con lo que de ella sigue vivo.

**NADA SE HA BORRADO.** Abajo va íntegra, tal y como estaba en el panel. Lo vigente de esa entrada
vive además en `TABLERO.md`, en `docs/copias/cifrado-y-vuelta-diagnostico.md` (§13-16) y en el
commit `20b9493`.

---

## 🔑 3 SEP 2026 (~19:30) — LA LLAVE DE LAS COPIAS, ROTADA. Y UN DESCUIDO MÍO, CONTADO SIN MAQUILLAR.

**Le pediste a Code que preparara el terreno y escribiera las instrucciones, y que la llave la
generaras TÚ, en tu terminal.** Eso es lo que pasó. Code borró la configuración cifrada vieja (nada
de Drive, solo ficheros locales del servidor), te dejó escrito el comando exacto en
`ROTAR-LLAVE.txt`, y **no tocó la llave en ningún momento** —ni antes, ni durante, ni al verificar
después—.

**⚠️ Y aquí va lo que no te gustará leer, pero es tuyo saberlo.** Mientras preparaba el terreno,
Code relanzó por error el mismo programa que genera la llave —creyéndolo una simple comprobación,
como lo había sido minutos antes—, y como acababa de borrar la configuración vieja, esta vez el
programa **sí generó una llave nueva de verdad**, que **nadie llegó a guardar**. Se dio cuenta al
momento y lo deshizo entero —borrando otra vez esa configuración— antes de escribirte las
instrucciones. Esa llave perdida nunca llegó a usarse para nada; la que cuenta es la que generaste
tú después, en tu terminal.

**🧪 Verificado sin ver tu llave en ningún momento.** Se lanzaron las dos copias completas: **las
dos salen CIFRADO, 16 archivos cada una.** Se descargó lo de hoy y **coincide letra por letra** con
lo que hay en el servidor. Se miró un archivo tal cual está en Drive: es binario, ilegible, sin una
palabra reconocible.

**Y la prueba más clara de todas la dio el propio programa, sin que nadie tuviera que reconstruir
nada:** con la llave nueva puesta, **la carpeta de esta mañana —la de la llave quemada— ya no se
puede ni abrir.** El propio programa dice que ese nombre de carpeta «no se puede descifrar». Es
justo lo que buscabas: esa copia vieja se queda ahí, en Drive, sin borrar —no era parte de esto—,
pero **inservible a propósito**. Desde esta noche, la única copia que cuenta es la nueva.
