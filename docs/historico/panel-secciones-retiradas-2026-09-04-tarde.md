# Secciones retiradas del panel de Notion — 4 sep 2026 (tarde)

**Por qué.** Por TAMAÑO, la regla escrita en el propio panel: se mantiene por debajo de unas
**45.000 letras**, porque a 62.500 la lectura falla y a 40.400 funciona. El 4 de septiembre se
cerraron **siete** trabajos y cada uno dejó su entrada; al añadir la de la CSP, el panel volvía a
acercarse al tope.

**Qué se retira.** Las **tres entradas más antiguas del 4 de septiembre**, todas cerradas y con su
commit. En el panel queda un puntero con lo que de ellas sigue vivo.

**NADA SE HA BORRADO.** Van íntegras abajo. Lo vigente de cada una vive en `TABLERO.md`.

---

## 🚀 4 SEP 2026 (05:43–06:05, ~1h20) — YA SE PUEDE LEVANTAR BAMBURU ENTERO DESDE UNA COPIA. TARDA 82 SEGUNDOS.

**Novena del BLOQUE 2, hecha.** Hasta hoy la copia se comprobaba bien —se bajaba, se comparaba letra
por letra, se abría cada base— pero **nadie había comprobado que con eso se pueda volver a tener el
negocio en pie**. Y no es lo mismo: el 3 de septiembre, con los datos restaurados pero sin la
configuración, **Bamburu no arrancó**. Tener los datos no es tener el negocio.

**🧪 Ahora hay una prueba que hace el camino entero, y se corrió contra la copia de verdad:** coge la
copia cifrada más reciente, baja los 16 archivos, comprueba una a una que las bases abren y no están
vacías (una base recién creada también dice que está «bien»: que abra no es que sirva), restaura
también la configuración, **arranca Bamburu con todo eso** y **abre la pantalla de entrada de un
negocio real**.

**El resultado, medido y no estimado: 13 negocios restaurados, pantalla de entrada respondiendo,
82,6 segundos** desde «no tengo nada» hasta «Bamburu sirviendo».

**🔒 Y no toca producción.** La prueba levanta su propio Bamburu en un puerto aparte y con sus
propios datos. Para eso hicieron falta **dos líneas** del arranque que estaban clavadas (el puerto
siempre 3000, y la carpeta de datos siempre la del servidor); **si no se les dice nada, producción se
comporta exactamente igual que siempre**.

**🔴 Lo que de verdad vigila esto son los rojos:** sin la configuración, sin el índice de negocios,
sin ningún negocio, con una base corrupta, y con la copia vacía. En los cinco casos la prueba tiene
que pararse y **decir QUÉ falta**, no solo fallar. Y el propio guardián cazó un fallo de siembra que
hacía pasar dos rojos en verde.

Commit `54ca748`.

---

## 🔐 4 SEP 2026 (06:05–06:40, ~35min) — EL ENLACE DEL PORTAL YA NO LLEVA LA LLAVE A LA VISTA.

**Décima del BLOQUE 2, hecha.** Cuando le mandabas a un cliente su enlace del portal, la llave iba
**dentro de la dirección**: quedaba en el **historial de su navegador**, en los **registros de
cualquier intermediario**, y se filtraba en la cabecera que los navegadores mandan al pinchar
cualquier enlace desde esa página. Y servía 14 días: cualquiera de esas copias abría su portal
completo.

**✅ El correo que recibe el cliente NO cambia.** Mismo enlace, mismo clic. Lo que cambia es lo que
pasa al abrirlo: **se canjea una sola vez** y el navegador salta a una dirección **limpia**. La llave
queda en el navegador de forma que **ningún código de la página puede leerla** y que **nunca se manda
a la zona de administración**.

**🔑 El enlace queda gastado.** Copiarlo del historial y abrirlo después **no entra**. **⏳ El acceso
caduca y ahora se ve**, con fecha concreta. **🚫 Y revocar cierra las dos puertas.**

**29 comprobaciones en verde y probadas en rojo cinco veces.** Y **una de esas pruebas en rojo se
quedó verde**, que es lo que más enseña: se había tocado una comprobación que acompaña, no la que
sostiene el «un solo uso». Repetida sobre la pieza correcta, cayó. **Una reversión que no pone rojo
no prueba nada.**

Commit `0213d2d`.

---

## 📎 4 SEP 2026 (06:40–07:25, ~45min) — UN ARCHIVO QUE SUBE ALGUIEN YA NO ES LO QUE DICE SER, SINO LO QUE ES.

**Undécima del BLOQUE 2.** Dos agujeros de la misma familia, y **los dos estaban vivos**.

**📁 El primero: el programa se creía la etiqueta.** El tipo del archivo se decidía por **lo que
dijera el navegador**. Un **ejecutable llamado `factura.png` entraba tan tranquilo**, se guardaba con
extensión de imagen y después Bamburu lo servía diciendo «esto es una imagen». Al quitar la defensa
para comprobarlo, **entró con la puerta abierta** y dejó seis archivos en la carpeta del negocio.

**🔓 El segundo, peor: la carpeta de archivos no era una frontera, era una costumbre.** Al quitar esa
defensa, **el fichero de contraseñas del servidor se sirvió ENTERO por internet** a quien pidiera la
foto de un perfil.

**✅ Ahora mandan los bytes.** Y si dice ser una cosa y es otra —un PDF de verdad que dice ser PNG—
tampoco: lo que se rechaza no es el tipo, es **la mentira**.

**43 comprobaciones**, probadas en rojo dos veces. **Y cuatro fallos cazados al probar en rojo:** la
comprobación imprimía un trozo del archivo que intentaba robar (y uno era el de las contraseñas);
dos ataques apuntaban a ficheros inexistentes —**atacaban al vacío, y el vacío siempre se defiende
solo**—; la comparación buscaba algo que no podía aparecer nunca; y uno mío, silencioso, que habría
hecho **desaparecer el logo de todas las facturas y PDF sin un solo aviso**.

Commit `b341845`.
