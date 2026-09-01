# Panel de Bamburu — secciones retiradas el 1 sep 2026

> Copia ÍNTEGRA y byte a byte de dos secciones que se retiraron del panel
> «Control de Proyecto — Bamburu» el 1 de septiembre de 2026. **No se ha borrado nada:**
> se sacaron de la página para que no pasara de 45.000 letras (la regla escrita en el
> Archivo histórico: a 62.500 la lectura falla).
>
> **Por qué dejaron de tener sentido en el panel, las dos:**
>
> 1. **«MEJORAS DEL 31 AGO 2026 — pendientes de volcar a TABLERO.md»** — ya están volcadas.
>    El 1 sep 2026 se contrastaron las 54 entradas contra el código y las 43 vivas pasaron a
>    formato de orquestador en TABLERO.md. Su motivo de existir se acabó.
>
> 2. **«TODO LO QUE QUEDA POR HACER (inventario completo, 24 ago 2026)»** — quedó superado
>    por ese mismo contraste, que demostró que varias de sus cifras estaban caducadas: las
>    seis pantallas muertas llevaban ocho días borradas, las 14 secciones sin enlazar estaban
>    enlazadas desde el 24 ago, y las 99 comprobaciones sin clasificar eran cero.
>
> Lo vigente vive en TABLERO.md, en el repo.

---

## 🆕 MEJORAS DEL 31 AGO 2026 — pendientes de volcar a [TABLERO.md](http://TABLERO.md)
> De dónde salen: de comparar Bamburu con Salesforce, Odoo y SAP, y de auditar el código. **Ninguna está priorizada ni descartada.** El orden lo decide Ibrahin. **Regla vigente: no se recorta nada de esta lista alegando que el cliente es pequeño.**
**SEGURIDAD Y DATOS**
- [ ] Cifrar las copias de seguridad — hoy van en claro a dos Drive personales, con 203 clientes y 922 facturas dentro. Es configuración, no programación. **Es la mayor exposición abierta hoy.**
- [ ] Cifrado de las bases de negocio en el disco
- [ ] Cerrar el Permisos Paso 1: **600 de 1.025 rutas** sin comprobación visible de permisos
- [ ] Roles heredados — hoy son permisos casilla por casilla, persona por persona (55 filas para 9 usuarios). Ingobernable con 500 negocios de 5 empleados
- [ ] RGPD como función del producto: exportar, borrar y anonimizar los datos de un cliente. Hay que decidir antes cómo convive con la inmutabilidad fiscal
- [ ] Ensayo de recuperación completo, cronometrado, con tiempo objetivo escrito. Hoy se sabe que los ficheros abren; no cuánto se tarda en volver
**ARQUITECTURA**
- [ ] Los cuatro temporizadores que abren todas las bases **en escritura cada hora**, que abran en solo lectura donde solo leen
- [ ] Bajar la espera de bloqueo de 5 segundos a una fracción
- [ ] Un solo escritor: que los temporizadores pidan el trabajo al servidor en vez de abrir la base por su cuenta
- [ ] Varios procesos con reparto de negocios
- [ ] Medir `worker_threads` como alternativa a Postgres — mantiene SQLite y el aislamiento por fichero
- [ ] PostgreSQL con el patrón de Odoo (una base por negocio), **cuando el número de negocios lo justifique, no antes**
**OBSERVABILIDAD**
- [ ] Integración continua que ejecute las comprobaciones en cada subida. **Hoy hay 267 comprobaciones y ningún automatismo que las dispare**
- [ ] Registro estructurado (hoy: 22 avisos sueltos por consola)
- [ ] Métricas básicas: cuántas peticiones, cuánto tardan, cuál va lenta
**API**
- [ ] Versionado · \\[ \\] Contrato documentado · \\[ \\] Validación en todas las entradas · \\[ \\] Autenticación por token con ámbitos y cuotas
**PRODUCTO — de la comparativa con los líderes**
- [ ] Datos de ejemplo borrables al crear un negocio (hoy nace sin un solo cliente ni factura: es donde más gente abandona)
- [ ] Que el oficio traiga también serie de facturas, IVA y recordatorios, no solo el catálogo
- [ ] Papelera con recuperación por el propio dueño (Salesforce: 15 días + 15 de la organización)
- [ ] Historial de cambios **visible para el cliente** — hoy el registro es inmutable pero solo lo ve Bamburu. Es lo que permite vender a una clínica
- [ ] Exportación completa de sus datos (la ley lo exige y además convence al que duda de entrar)
- [ ] Modo de pruebas por negocio (Salesforce da una copia entera para trastear)
- [ ] Entrada como cliente para soporte, **con motivo obligatorio y registro con IP** (así lo hace Odoo)
- [ ] Página de estado pública
- [ ] Límites visibles antes de chocar contra ellos (hoy: 120 correos/hora y el cliente no lo sabe)
- [ ] Importación asistida con mapeo de columnas — **es la barrera número uno para que alguien se cambie desde Holded**, y la migración gratuita ya está prometida en el precio
- [ ] Ciclo completo de suscripción: alta, cobro, tarjeta caducada, cancelación, recuperación de cuenta
**PRODUCTO — operativo**
- [ ] Corregir errores de semanas atrás en documentos **no** fiscales
- [ ] Deshacer una importación entera
- [ ] Fusionar clientes duplicados
- [ ] Búsqueda global (escribes un NIF y sale el cliente, sus facturas, sus citas)
- [ ] Aviso cuando dos personas editan lo mismo — hoy gana el último que guarda, sin decir nada
- [ ] Que el dueño vea la actividad de sus empleados
- [ ] Acceso de gestoría sin consumir usuario
- [ ] Canal de aviso desde dentro del programa
- [ ] Modo mantenimiento (hoy el cliente vería un error, no un aviso)
- [ ] Acciones en bloque (marcar 20 facturas como cobradas, recordatorio a todos los morosos)
- [ ] Exportar cualquier lista a Excel — su gestoría lo pedirá cada trimestre
- [ ] Adjuntar documentos a clientes, pedidos y facturas
- [ ] Buscar dentro de los documentos adjuntos
**LIMPIEZA**
- [ ] Retirar las 6 pantallas muertas · \\[ \\] Enlazar las 14 secciones sin acceso desde el menú · \\[ \\] Reducir los 65 elementos de menú · \\[ \\] Las 99 comprobaciones que nadie ejecuta: o entran o se retiran con motivo escrito
**SIETE QUE AÑADIÓ LA MÁQUINA AL AUDITAR — no estaban en la lista del chat**
- [ ] **Anclar la cadena de VERI\\*FACTU fuera del servidor.** Quien acceda al fichero de un negocio puede reescribir importes y recalcular la cadena entera: cuadraría y nadie lo notaría. Es lo que hace que la cadena signifique algo
- [ ] **La retención del backup borra aunque la subida haya fallado.** Es exactamente lo que mató a Backblaze en junio: días fallando en silencio mientras se borran las copias buenas por antigüedad. Sigue vivo en el script de hoy
- [ ] **Manifiesto de huellas del histórico de copias.** Se verifica la copia del día; una de hace cinco días se puede editar y nadie vuelve a mirarla
- [ ] Segundo factor obligatorio para dueño y administradores
- [ ] Sesión de 24 h fijas, sin renovarse por actividad
- [ ] Retirar `unsafe-inline` de la CSP (8 usos)
- [ ] 2 vulnerabilidades moderadas en dependencias
**DECISIONES TOMADAS EL 31 AGO**
- Segunda copia en Google Drive (`gilibrahin@gmail.com`). **Backblaze descartado.**
- Avisos de copia: una caída = aviso, las dos = crítico
- **Todo lo que hay hoy en Bamburu es de prueba** hasta que Ibrahin diga lo contrario
- Postgres no se descarta, pero **no va primero**
- **No perseguir amplitud** (multi-moneda, nóminas, fabricación): es el terreno donde se pierde contra SAP y aleja de lo único que no pueden replicar
---
**Para retomar mañana, en un chat nuevo, pega esto:**
\"Seguimos con Bamburu. Mira mi panel en Notion. ¿Cuál es la siguiente tarea y cómo la planifico para pasársela a Claude Code?\"
**Para trabajar con Claude Code, ábrelo y di:**
\"Lee [CLAUDE.md](http://CLAUDE.md) y [TABLERO.md](http://TABLERO.md). ¿Cuál es la siguiente tarea pendiente? Vamos con ella.\"
---
## 📌 TODO LO QUE QUEDA POR HACER (inventario completo, 24 ago 2026)
> **LAS TRES COSAS QUE HAY QUE SABER ANTES DE LEER NADA MÁS:**
> **1.** Las correcciones que diste el 21 de agosto —de la A a la M— **están cerradas**. No queda ni una tarea que programar. Lo que sigue vivo ahí son tres cosas que no son tareas: el «etc» del portal, que dejaste abierto a propósito, y dos que están bloqueadas fuera del código.
> **2.** **La «propuesta fiscal de DISA» está construida desde el 15 de julio.** Este panel llevaba cinco semanas diciendo que era «lo único pendiente» y que «esperaba tu decisión». Se hizo al día siguiente de escribirse esa línea y nadie volvió a tacharla. Hoy funciona: declaras tu situación en Ajustes y DISA te avisa de cada modelo que te toca presentar, con su fecha.
> **3.** **Te espera UNA sola decisión: el historial clínico del oficio de salud.** Está al final, con las tres opciones escritas enteras.
---
### EL RECUENTO
**51 cosas pendientes**, repartidas así:
- **24** — lo que le falta al producto
- **12** — lo que falta antes del primer cliente real (el suelo legal y contable)
- **10** — deuda técnica (no se ve, pero se paga)
- **4** — bloqueado, y no por falta de trabajo
- **1** — decisiones que te esperan
Esto fusiona **once listas** que hasta hoy vivían separadas: las correcciones del dueño, las funciones apuntadas sin encargo, la cola de mejoras visuales, lo anotado del tercer peldaño, el suelo legal y contable, el portal y las ventas, el inventario, los permisos, los riesgos abiertos, la deuda técnica y la escalera. **Lo que aparecía en dos sitios va una sola vez**, y se dice de dónde venía.
---
### A · LO QUE LE FALTA AL PRODUCTO — 24
**LA ESCALERA — los oficios y los módulos que aún no existen**
1. **Salud y bienestar, el oficio entero.** Hoy solo está la cara: la agenda habla su idioma y trae el catálogo de servicios cargado. Falta lo propio del sector. · *Cuando esté: un fisio abre Bamburu y encuentra su forma de trabajar montada, no una agenda genérica con otras palabras.*
2. **Belleza y estética.** Agenda y caja del día. · *Cuando esté: un salón cierra el día y ve lo que ha entrado, sin sacar cuentas aparte.*
3. **Proyectos con tablero, partes de horas y servicio de campo.** Incluye el parte de obra. Es distinto del CRM: son tareas internas, no oportunidades de venta. · *Cuando esté: arrastras una tarea de «pendiente» a «hecha» y el parte de horas sale solo.*
4. **Terminal de punto de venta completo.** · *Cuando esté: cobras en mostrador con cajón, ticket y cierre de caja.*
5. **Cobro recurrente y domiciliación bancaria.** · *Cuando esté: una cuota mensual se cobra sola del banco del cliente, sin perseguirla.*
6. **Telegram como canal de DISA.** · *Cuando esté: le preguntas a DISA desde el móvil sin abrir el programa.*
7. **Mapas — la parte que falta.** El mapa de la ficha de cliente **ya está** (23 ago). Falta llevarlo a donde tenga sentido: rutas, zonas de reparto. · *Cuando esté: ves en un mapa dónde están tus clientes, no solo uno a uno.*
8. **Aplicación de móvil de verdad.** · *Cuando esté: Bamburu se instala en el móvil y funciona sin navegador.*
9. **Puerta para que otros programas se conecten.** · *Cuando esté: tu gestoría o tu tienda leen tus datos sin que tú los copies.*
10. **Integraciones y catálogo de conectores.** *(Una parte se descartó a propósito el 9 de julio: el escaparate de asesorías, que es un canal de captación y no una función de gestión.)* · *Cuando esté: enlazas Bamburu con lo que ya usas eligiéndolo de una lista.*
11. **Documentos: una suite ofimática ligera.** · *Cuando esté: redactas un presupuesto largo o un contrato dentro de Bamburu.*
12. **Varias empresas, varias monedas, fabricación, firma digital y atención al cliente.** Aquí entra también **personal**: ficha de empleado, nóminas y organigrama. *(El control horario sí está hecho: es del oficio, no de plantilla.)* · *Cuando esté: llevas dos sociedades desde la misma cuenta y firmas un presupuesto sin imprimirlo.*
**EL PORTAL DEL CLIENTE**
1. **Ver y copiar el enlace del portal desde el panel.** Hoy solo sale por correo. · *Cuando esté: copias el enlace de un cliente y se lo mandas por donde quieras.* *(Venía de la lista de ventas y portal.)*
2. **Que el cliente acepte presupuestos y haga pedidos con carrito.** · *Cuando esté: un cliente aprueba tu presupuesto él mismo y te llega avisado.*
3. **El «etc» que dejaste abierto.** No es una tarea: es el hueco que reservaste en tu corrección G para lo que quieras añadir al portal. · *Cuando lo digas, se convierte en tarea.* *(Venía de tus correcciones del 21 de agosto.)*
**DOCUMENTOS Y ENVÍOS**
1. **Emitir una factura recurrente sin revisarla.** Hoy siempre te deja un borrador para que lo mires y lo emitas con un clic. Falta el interruptor de «esta te fías, emítela sola». · *Cuando esté: la cuota mensual se emite sin que la toques, si tú lo has autorizado para esa plantilla.*
2. **Mandar el PDF por correo de cualquier documento.** Hoy solo el presupuesto. · *Cuando esté: cualquier documento se manda al cliente desde su propia pantalla.*
3. **Plantillas de documento a tu gusto.** · *Cuando esté: cambias cómo se ve una factura sin pedírselo a nadie.*
**LO DEMÁS**
1. **La interfaz en otro idioma.** Hoy el usuario elige idioma, se le guarda, y todo sigue en español — y la pantalla se lo confiesa. No hay motor de traducción de ningún tipo. · *Cuando esté: eliges inglés y el programa está en inglés.* *(Venía de la cola de mejoras visuales y de la auditoría de julio, donde ya estaba marcada como petición tuya aparcada.)*
2. **Sincerar los textos que aún mienten.** De catorce textos obsoletos detectados en julio se corrigieron tres. · *Cuando esté: ningún texto del programa promete algo que no hace.*
3. **Las cuatro piezas del catálogo de analítica sin habilitar:** el usuario que teclea, el producto en un gasto suelto, el IRPF soportado y la provincia sin rellenar. · *Cuando esté: puedes cruzar por esas cuatro cosas como por las demás.* *(Venía de lo anotado del tercer peldaño.)*
4. **Que DISA reparta el trabajo y asigne responsables.** **Hoy NO, por decisión tuya.** Queda apuntado por si cambias de idea. · *Cuando esté: le dices «reparte las visitas de mañana» y las reparte.*
5. **Sincronizar con tiendas online** (Shopify, Woo, Prestashop). Es de la capa de comercio, congelada. · *Cuando esté: lo que vendes en la web descuenta stock aquí.*
6. **Que DISA administre los permisos hablando.** Va en **dos pasos y en orden**: primero repasar que cada acción del programa exige el permiso correcto y no solo estar dentro; después, que tú digas «este empleado solo ve stock y compras» y DISA lo aplique. **El segundo paso no arranca sin el primero cerrado.** · *Cuando esté: das de alta a un empleado hablando, y ves en pantalla qué le has concedido.* *(Venía de la lista de permisos y del apartado de pendientes apuntados.)*
---
### B · LO QUE FALTA ANTES DEL PRIMER CLIENTE REAL — 12
Esto es **el suelo**: lo que hace falta para que un negocio de verdad pueda usar Bamburu sin tener un problema con Hacienda o con su gestoría. No es la ventaja competitiva; es el permiso para jugar.
1. **Subsanar el aviso de la factura de prueba que llegó tarde a Hacienda.** Está identificado y se puede hacer en cualquier momento, sin depender de nada. · *Cuando esté: el registro de esa factura queda limpio, sin la advertencia.* *(Venía marcado como petición tuya aparcada desde julio.)*
2. **El otro formato de factura electrónica que exige la ley** para quien no use la vía pública. · *Cuando esté: puedes mandarle la factura a una administración o a una empresa grande en el formato que te exijan.*
3. **El balance de situación.** Necesita antes una pieza que hoy no existe: los saldos con los que arranca el negocio y el valor de lo que ya tiene. Requiere datos tuyos. · *Cuando esté: ves cuánto vale tu negocio, no solo cuánto ha entrado y salido.*
4. **Cuentas anuales y legalización de libros.** · *Cuando esté: sacas del programa lo que hay que presentar al cierre del año.*
5. **Plan de cuentas con subcuentas.** · *Cuando esté: tu gestoría reconoce tu contabilidad sin traducirla.*
6. **Llevar la amortización al diario.** Hoy se calcula al mirarla, pero no queda escrita como apunte. · *Cuando esté: el desgaste de lo que compraste aparece en el diario, como cualquier otro apunte.*
7. **Los modelos de Hacienda que faltan:** retenciones, operaciones intracomunitarias, operaciones con terceros, resumen anual de IVA y los de sociedades. *(Los dos trimestrales que más se usan ya están.)* · *Cuando esté: cada trimestre y cada cierre, el programa te da el modelo ya calculado.*
8. **El IRPF de lo que compras.** Hoy solo se contempla en lo que vendes. · *Cuando esté: la retención de la factura de tu abogado se refleja bien.*
9. **Acceso para la gestoría.** · *Cuando esté: le das a tu gestor una entrada propia que solo ve la contabilidad.*
10. **Que la pantalla de libros se pueda usar de verdad:** pinchar una línea y llegar al documento, buscar por número o por NIF, filtrar por tipo de IVA y por estado, un resumen por tipo de IVA, y bloquear un trimestre ya presentado para que nadie lo toque. · *Cuando esté: encuentras un apunte en cinco segundos en vez de bajando con la rueda.*
11. **Importar el extracto del banco desde un fichero.** · *Cuando esté: subes lo que te descarga tu banco y Bamburu lo cruza con tus cobros.*
12. **Conexión automática con el banco.** · *Cuando esté: los movimientos entran solos cada mañana.*
---
### C · DEUDA TÉCNICA — 10 · **cifras medidas hoy, 24 ago 2026**
1. **99 comprobaciones de 216 no las ejecuta nadie.** El repaso completo corre 111 y hay 9 declaradas fuera con su motivo. Las otras 99 ni corren ni consta que no corran: **son invisibles**. Una comprobación que nadie ejecuta acaba mintiendo. *(La lista de referencia decía 97, del 20 de agosto; hoy son 99.)* · *Cuando esté: cada comprobación o entra en el repaso o está escrito por qué no.*
2. **14 pantallas no tienen enlace en el menú.** Son secciones de verdad —los siete apartados de contabilidad, tres de ajustes, dos del CRM, el importador de ficheros y la pantalla de avisos— a las que solo se llega desde dentro de otra pantalla o escribiendo la dirección. *(La de avisos sí se alcanza desde la campana; las otras trece, no.)* *(Aparte hay 19 fichas de detalle y de alta sin enlace, y eso es normal: se llega a ellas desde su lista. No cuentan.)* · ⚠️ **CORREGIDO respecto de lo que te dije esta mañana: son 14 y 19, no 16 y 17. Recontadas una a una.** · *Cuando esté: todo lo que es una sección se alcanza desde el menú.*
3. **Queda UNA ventanita del navegador viva**, en conciliación bancaria: el botón de deshacer abre un cuadro de diálogo del navegador. Es la trampa conocida — el navegador los silencia y el botón se queda muerto sin decir nada. · ⚠️ **El censo decía CERO y no era cierto.** Se ha arreglado hoy: confundía el filtro de ficheros de una pantalla con el principio de un comentario y se quedaba ciego desde ahí hasta el final de tres ficheros. · *Cuando esté: ese botón pregunta dentro de la página, como los demás.*
4. **Seis pantallas retiradas siguen en el árbol**, sin montar y sin poder abrirse: el punto de venta viejo, los cupones viejos, las opiniones, el boletín, los envíos y las sugerencias. Son 1.584 líneas que ya no ejecuta nadie. *(La lista de deuda solo nombraba una de las seis.)* · *Cuando esté: o se retiran o se reviven, pero no se quedan a medias.*
5. **El portal del cliente escribe el dinero a la inglesa.** Todo el resto del producto ya lo escribe como en España. · *Cuando esté: un cliente ve «6.023,00 €» en su portal, como en su factura.* *(Venía apuntado al cerrar la ampliación del portal.)*
6. **Hay un documento de pedido titulado «FACTURA» que no es la factura legal.** Quedó neutralizado al retirar el punto de venta viejo; falta confirmar que ya no se alcanza y decidir si se renombra o se retira. Es un riesgo legal, no estético. · *Cuando esté: ningún papel que salga de Bamburu se llama factura sin serlo.*
7. **Posible agujero en las páginas públicas de la tienda:** texto guardado desde el panel que se pinta sin limpiar. La tienda está apagada, así que hoy no expone nada; **hay que revisarlo antes de volver a encenderla.** · *Cuando esté: la tienda se puede encender sin dudar.*
8. **DISA no sabe crear un pedido de varias líneas.** Es una limitación heredada. El camino humano sí lo hace. · *Cuando esté: le dictas un pedido de cinco líneas y lo crea entero.*
9. **Dos mejoras de rendimiento, paradas a propósito:** repartir los negocios entre varios procesos, y sacar la base de datos del hilo principal. **Condicionadas por ti a que el número de negocios lo justifique.** · *Cuando esté: con muchos negocios a la vez, ninguno nota a los demás.*
10. **A este panel le faltan las entradas del 10 al 14 de julio** en el registro de tiempo. Son reconstruibles. · *Cuando esté: el registro no tiene huecos.* *(Venía marcado como deuda del propio proceso de cierre de sesión.)*
---
### D · BLOQUEADO, Y POR QUIÉN — 4
Ninguna de estas cuatro es trabajo de programación parado por pereza: **está parado porque falta algo de fuera.**
1. **Pagar la factura desde el portal, con tarjeta.** · **Lo bloquea: tú.** Hace falta contratar una pasarela de pago —alta, credenciales y comisiones—, y eso es una decisión de negocio. Lo que ya está listo para el día que llegue: la factura, su estado y los datos de transferencia ya viven en el portal. *(Y sigue vigente tu norma de julio: no se dejan ganchos preparados para una pasarela que no existe. No se ha dejado ninguno.)* · *Cuando esté: el cliente ve su factura y paga sin salir del enlace.*
2. **Traer los datos desde Holded y desde Quipu automáticamente.** · **Lo bloquea: ellos.** Hace falta acceso a sus datos. Mientras tanto funciona la migración asistida: el cliente sube su fichero y lo recibe el equipo. · *Cuando esté: el que viene de Holded aprieta un botón y aparece todo.*
3. **Que Bamburu mande las facturas de tus clientes a Hacienda en su nombre.** · **Lo bloquea: tú**, y es un trámite legal externo: darse de alta ante la AEAT como colaborador social, con un certificado propio de Bamburu, y una pantalla donde cada dueño firme que te autoriza. **Es una tarea única: se hace entera o no se empieza**, porque media tarea deja registros fiscales a medio camino. Sin urgencia hasta el 1 de enero de 2027. **Es la pieza más grande que falta del suelo.** · *Cuando esté: tus clientes cumplen con Hacienda sin sacarse un certificado cada uno.*
4. **Firmar y enviar el otro formato de factura electrónica.** · **Lo bloquea: un certificado** que hay que obtener. El motor que genera el documento ya está hecho desde el 8 de julio. · *Cuando esté: la factura sale firmada y llega sola a donde tenga que llegar.*
---
### E · LA DECISIÓN QUE TE ESPERA — 1
**EL HISTORIAL CLÍNICO DEL OFICIO DE SALUD.**
Son **datos de salud**, la categoría más protegida que existe en la ley de protección de datos (artículo 9). Guardarlos exige decisiones que **no están escritas en ningún sitio de este proyecto**. Meter un campo de «notas clínicas» sin resolverlas sería lo peor de los dos mundos: el dato dentro y la protección fuera.
Lo que sí está puesto: **la fecha de nacimiento**, porque la edad cambia la pauta de un tratamiento y es lo primero que se pregunta en una primera visita. El campo solo se pinta en el oficio que lo pide, para no llenar de huecos la ficha de un taller.
**Las tres opciones, para que elijas:**
1. **No guardarlos nunca.** El historial vive fuera de Bamburu. Cero riesgo, y el oficio queda cojo para quien lo esperaba.
2. **Guardarlos con acceso restringido al profesional que atiende**, con registro de quién los abre y un aviso de consentimiento al dar de alta al paciente. Es lo que hace el sector, y exige decidir **cuántos años se conservan** y **quién puede exportarlos**.
3. **Solo una nota libre, avisando de que no es un historial clínico** y que no se metan diagnósticos. Barato, y se incumple el primer día.
*La recomendación es la 2, pero no es una decisión de programación y no la toma quien programa.*
---
### F · LO QUE ESTABA MAL APUNTADO — ⚠️ CORREGIDO HOY
Seis cosas figuraban como pendientes y no lo estaban, o al revés. Todas quedan corregidas en el tablero **tachando lo viejo con su fecha y su motivo, sin borrarlo**, porque el registro sirve para saber qué se creía y cuándo.
1. **«Quedan 11 pendientes de tus correcciones (E, G, I)».** ⚠️ **Falso desde hace un día.** La cabecera se escribió el 23 de agosto a las 15:59 y esos tres se cerraron esa misma noche, entre las 20:56 y las 21:28. Nadie volvió a subir a corregir la cabecera. **Quedan cero.**
2. **«Funciones nuevas apuntadas sin encargo: pendiente».** ⚠️ **El título decía pendiente con las siete líneas de debajo tachadas y marcadas como hechas.** Las siete se cerraron el 23 de agosto, cada una con su comprobación: el área de agenda, el control horario, la agenda del CRM, las ventanitas del navegador de todo el producto, los productos parados, DISA y los informes por chat, y los descuentos y promociones.
3. **«El constructor de analíticas: falta por hacer cuatro áreas».** ⚠️ **Era cierto el 17 de julio.** Hoy tiene **siete**: ventas, compras, clientes, inventario, contabilidad, agenda y catálogo. Las dos últimas nacieron el 23 de agosto y nadie volvió a esa línea.
4. **«Sigue pendiente solo la propuesta fiscal de DISA, y espera tu decisión».** ⚠️ **Lleva cinco semanas siendo falso.** Se construyó el 15 de julio, al día siguiente de escribirse.
5. **«El censo dice que no queda ninguna ventanita del navegador».** ⚠️ **Queda una.** El censo estaba ciego en tres ficheros. **Arreglado hoy**, y probado volviendo a meter el caso a mano: el censo de antes decía cero sobre él y el de ahora lo encuentra.
6. **«El siguiente paso del orden acordado son las funciones nuevas».** ⚠️ El puntero se quedó en el paso 3, que está cerrado. **El siguiente es el peldaño 8, salud y bienestar.**
Y dos que estaban apuntadas como pendientes y **ya estaban hechas** cuando se revisaron: los códigos de rescate para cuando se pierde el móvil del segundo factor, y las tres pantallas sin enlace que arrastraba la auditoría de julio.
---
