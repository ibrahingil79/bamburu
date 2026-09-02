# Panel de Notion — las tres tareas de suscripción, archivadas el 2 sep 2026 (cierre 3)

> **Copia ÍNTEGRA de lo retirado del panel «Control de Proyecto — Bamburu». No se ha borrado nada:**
> en el panel queda una nota corta que apunta aquí, y la entrada del cierre del bloque las resume.
>
> **Por qué: por tamaño.** El panel estaba a 44.160 letras de un tope de 45.000, y la entrada del
> cierre del bloque de suscripción no cabía. Se retiran las **tres entradas de las tareas de
> suscripción ya cerradas** —el alta con el plan y la prueba, el cobro del día 5, y el impago con su
> corte—, elegidas porque **la entrada del cierre del bloque las resume a las tres**: es una entrada
> en lugar de tres, no información perdida.
>
> **Índice de lo que hay aquí, por orden de aparición:**
>   1. **✂️ El impago y el corte** (`suscripcion-impago-y-corte`) — cinco avisos distintos, corte a
>      los 30 días, y desde cortado siempre se puede pagar.
>   2. **🗓️ El cobro del día 5** (`suscripcion-cobro-mensual`) — con su aviso una semana antes.
>   3. **💳 El plan y el alta** (`suscripcion-plan-y-alta`) — 9,90 € + IVA, 15 días de prueba sin
>      tarjeta y el prorrateo hasta el día 5.
>
> **Lo que de las tres SIGUE VIVO, y por eso se dice aquí arriba en vez de dejarlo enterrado:**
>   · **Todo sigue en MODO DE PRUEBA de Stripe.** Nada cobra dinero real hasta que Ibrahin ejecute
>     `bash scripts/configurar-stripe.sh --modo-real`. Es un cerrojo en el código, no una promesa.
>   · **Los reintentos inteligentes de Stripe siguen sin activar**, y no hace falta: son una casilla
>     de su panel (*Billing → Manage failed payments*) que no se puede tocar por API, y el calendario
>     de avisos y el corte son nuestros y no dependen de ella.
>   · **Queda apuntado como acabado, sin prisa:** el título de las pantallas se pega a la franja roja
>     de «SOLO LECTURA», sin aire entre las dos.
>   · **Y la lección que se repitió en las cuatro tareas del bloque:** los fallos que quedaban no los
>     cazaba ninguna aserción, porque cada frase era correcta por separado y solo se contradecían
>     juntas. **Los vio una persona mirando la pantalla.**
>
> El detalle vivo de cada tarea, con sus criterios y sus pruebas, está en `TABLERO.md`.

---

> ✂️ **2 SEP 2026 (cierre) — QUÉ PASA CUANDO UN CLIENTE NO PAGA. Ya no se corta de golpe ni en silencio.**
> **Tercera tarea de tu lista, hecha.** Si un cobro falla, empieza una cadena de **cinco avisos distintos** —no el mismo repetido— y **a los 30 días se corta**. El día del fallo: *«no hemos podido cobrar, lo intentaremos otra vez»*, sin alarmar, porque lo normal es que se resuelva solo. El día 7: *«seguimos sin poder cobrar»*, ya con la fecha del corte. El 20: *«quedan 10 días»*. El 27: *«quedan 3»*. El 30: el corte. **Todos con enlace directo para pagar, y ninguno ofrece descuentos**: un solo precio, sin excepciones.
> **El corte no borra absolutamente nada.** La cuenta pasa a SOLO LECTURA: el cliente entra igual, ve y descarga todo —clientes, facturas, citas— y no puede crear ni modificar. Medido de la única forma honesta: **contando todas las tablas del negocio antes y después del corte**, exigiendo que no cambie ni una fila.
> **🫀 Y lo que era el corazón de esta tarea: desde una cuenta cortada SIEMPRE se puede pagar.** Es el fallo que apareció esta mañana —al negocio al que se le pedía regularizar se le quitaba la única forma de hacerlo—. Verificado **no leyendo el código, sino pidiendo la ruta desde una cuenta cortada con un navegador**: contesta y abre el pago. Y queda una comprobación permanente vigilándolo.
> **Dentro del programa se ve, sin depender del correo:** una franja mientras hay impago, con la fecha en que pasaría a solo lectura, y otra distinta cuando ya está cortado, que dice **qué hacer para volver** y lleva botón. **Si paga, todo vuelve solo**: cesan los avisos, desaparece la franja y la cuenta se reactiva.
> **Los caminos de vuelta, que son los que nadie prueba, también medidos:** paga tras el primer aviso → no llega ninguno más · paga la víspera → no se corta · el reintento cobra solo → ningún aviso de más · el servidor estuvo apagado un día → sale el aviso vencido y **solo uno**, no tres de golpe · y **pagar no levanta una suspensión que pusieras tú por otro motivo**.
> **⚠️ DOS CONTRADICCIONES QUE SOLO SE VIERON MIRANDO LA CAPTURA**, buscadas a propósito porque las dos tareas anteriores dejaron fallos así: la cuenta estaba **cortada** y la pantalla decía *«tienes un pago pendiente, vuelve a intentarlo»*, como si aún funcionara; y decía *«se te cobrará ahora 1,16 €»* **cuando lo que se debía eran 11,98 €** — un importe equivocado en la pantalla de quien va a pagar. **Ninguna comprobación falló con ninguna de las dos**: cada frase era correcta por separado.
> **Una cosa que puedes encender tú, y no hace falta:** los reintentos inteligentes de Stripe **no se pueden activar desde el código** —está medido—, son una casilla de su panel (*Billing → Manage failed payments*). Por eso el calendario y el corte son **nuestros** y no dependen de ella: enciéndela si quieres recuperar más cobros solos, pero **todo funciona igual sin tocarla**.
> **200 comprobaciones en verde**, con el tiempo avanzado de verdad y con navegador. **🔒 Todo sigue en modo de prueba.**
>
> 🗓️ **2 SEP 2026 (noche, 2) — EL COBRO DEL DÍA 5 SALE SOLO, Y NUNCA POR SORPRESA.**
> **Segunda tarea de tu lista, hecha.** Un negocio con tarjeta guardada **se cobra solo el día 5 de cada mes**, y **una semana antes le llega un aviso** con lo que se le va a cobrar, desglosado, y los cuatro últimos dígitos de su tarjeta. Cada cobro deja **su factura descargable**. Si el cobro sale bien, **no se le escribe nada más**. Y puede **cambiar la tarjeta él solo**, desde su pantalla.
> **Cobra Stripe, no nosotros, y es una decisión.** El día 5 lo mantiene el mecanismo propio de Stripe, que **resuelve solo los meses cortos** —febrero incluido—; un calendario escrito a mano falla una vez al año y siempre en el peor momento. La factura la emite Stripe con su numeración y **con la base y el IVA desglosados**, como exige la ley: por eso el IVA va aparte y no metido en el precio.
> **⚠️ El aviso NO depende de una casilla del panel de Stripe.** Stripe tiene un aviso propio, pero **su plazo no se puede fijar desde el código** —está medido—: es un ajuste que alguien tendría que ir a marcar a mano en otra web. Tu criterio dice *una semana antes*, así que hay **un segundo disparador nuestro** que sí controla el plazo exacto. Los dos entran por la misma puerta: **un aviso por cobro**, nunca dos.
> **COMPROBADO AVANZANDO EL TIEMPO DE VERDAD**, con los relojes de prueba de Stripe: se adelanta el calendario, se ve que **no** avisa a 14, 8 ni 6 días y **sí** a 7 exactos; se llega al día 5, **se cobra**, y la factura sale por 11,98 € con base 9,90 e IVA 2,08, con número y PDF. Y el cambio de tarjeta, con navegador: se cambia una visa por una mastercard, la pantalla lo dice, la nueva pasa a ser la que se cobra y **la anterior se retira sola**.
> **⚠️ CINCO FALLOS APARECIERON CONSTRUYENDO, y ninguno se habría visto sin avanzar el reloj.** El peor: **un negocio habría pasado un mes entero sin que se le facturara nada** — el primer cobro se anclaba al mes siguiente por un cálculo de un día. Los otros: la misma llave de seguridad anti-cobros-duplicados que falló por la mañana volvió a fallar (ahora la regla vive en un solo sitio, no en cada sitio que la usa); **leer un correo llegaba a migrar una base de datos** y podía dejar en memoria una copia vacía del negocio real; un fallo de correo mataba la pasada entera a mitad de la lista; y la pasada **no avisaba casi ningún día**, porque se salía antes de llegar a los avisos.
> **Y uno que solo se vio MIRANDO LA CAPTURA:** la pantalla enseñaba *«se te cobrará ahora 0,96 €»* justo al lado de *«tu próximo cobro automático, 11,98 €»*. **Ninguna comprobación falló**: las dos cajas eran correctas por separado y se contradecían juntas. Es, otra vez, la lección del día.
> **🔒 Sigue todo en modo de prueba.** No se ha tocado el cerrojo: nada cobra dinero real hasta que lo ordenes tú.
>
> 💳 **2 SEP 2026 (noche) — BAMBURU YA PUEDE COBRAR. Y de camino se han cerrado dos cosas que llevaban semanas enredando.**
> **Lo primero, porque es lo que desbloquea todo lo demás: la primera tarea de tu lista está HECHA.** Un negocio nuevo entra con **15 días de prueba y sin que se le pida tarjeta**, ve en su pantalla en qué situación está, y cuando deja una tarjeta se le cobra **la parte proporcional hasta el día 5**. Comprobado de punta a punta con un navegador de verdad y la tarjeta de prueba: se pulsa el botón, se teclea la tarjeta en la pantalla de Stripe y vuelve guardada. **Y el dinero se mueve:** un cobro real en modo prueba de 1,16 € por 3 de 31 días, con el desglose de IVA en el concepto que le llega al extracto del cliente.
> **Tu decisión del precio, aplicada tal cual:** se anuncia **9,90 €/mes + IVA** —como hace Holded y el sector entero— y se cobran **11,98 €**, con base e IVA desglosados como manda la ley. **El precio vive en un solo sitio** y hay una comprobación que falla si alguien lo escribe a mano en cualquier otra pantalla.
> **🔒 Y NO SE PUEDE COBRAR DINERO DE VERDAD SIN UNA ORDEN TUYA.** No es una promesa: es un cerrojo en el código. Todo está en **modo de prueba** de Stripe, y una clave de producción **no cobra a nadie** mientras no ejecutes tú `bash scripts/configurar-stripe.sh --modo-real`, que te obliga a escribir «COBRAR DE VERDAD» por teclado. Si alguien pusiera una clave real por descuido, no pasaría nada.
> **⚠️ AL PULSAR EL BOTÓN SALIERON TRES FALLOS QUE NINGUNA PRUEBA HABÍA VISTO**, y los tres dejaban el alta muerta. Lo destapaste tú probándolo, no las 53 comprobaciones que había — porque todas medían lo que el programa *decide* y esto era lo que el programa *hace*.
> • **Stripe rechazaba el alta**: activa por defecto una función nueva en las cuentas recientes que es incompatible con guardar una tarjeta sin cobrar. **Arreglado por código, sin que tengas que tocar nada en tu panel de Stripe** — ni tú ni ningún cliente futuro.
> • **El negocio al que se le pedía regularizar era el único que NO podía regularizar.** La pantalla le decía «no puedes hacer nada hasta reactivar tu cuenta» y **le bloqueaba justo el botón de pagar**. No es un caso raro: es exactamente el estado al que lleva el impago, que es la tarea de dentro de dos. Sin esto, «qué hay que hacer para volver» no tenía respuesta posible.
> • **Un identificador de seguridad anti-cobros-duplicados** se rompía en cuanto cambiaba un dato, y dejaba el alta caída 24 h.
> **Y el cuarto, el que apuntaste como acabado y no lo era:** la ventanita «Vas a dejar una tarjeta» **salía vacía**. Al medirlo no era diseño sino una palabra mal escrita del mismo día: de las **67** ventanitas del producto, **66 estaban bien** y la única mal era la nueva. Arreglada con la frase que pediste. **La lección, la de siempre: el panel abría, los botones funcionaban y el alta se completaba — así que ninguna comprobación falló. Lo vio una persona mirando la pantalla.**
> **Lo que sí queda apuntado como acabado**, sin prisa: el título de las pantallas se pega a la franja roja de «SOLO LECTURA», sin aire entre las dos.
>
