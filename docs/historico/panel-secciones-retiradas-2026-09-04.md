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

---

# SEGUNDA RETIRADA DEL MISMO DÍA — el ⏱️ Registro de tiempo del 3 sep 2026

**Por qué.** Al añadir la entrada de `adjuntos-validados-por-contenido` el panel volvió a acercarse
a su tope de 45.000 letras. El «Registro de tiempo» se había convertido en la sección más pesada
después de «Dónde lo dejé»: **once líneas, nueve de ellas del 3 de septiembre**, todas cerradas y
todas con su commit. Se retiran las nueve del 3 sep y **se quedan en el panel las del 4 sep**.

**NADA SE HA BORRADO.** Van íntegras abajo, y lo vigente de cada una vive en `TABLERO.md`.

---

- 3 sep 2026 (~19:30) · ~45min · **Rotada la llave de cifrado de las copias** — la que encendió el cifrado se dio por quemada al haber pasado por una sesión de Claude Code. Regla que lo mandó todo: **Code no ejecuta el paso que genera o muestra la llave**; eso lo hizo Ibrahin, en su terminal, con el comando de `ROTAR-LLAVE.txt`. Code solo preparó el terreno (sin tocar Drive) y verificó después sin ver la llave. **Incidente propio, contado sin maquillar:** al comprobar el estado tras preparar el terreno, se relanzó por error el activador completo, que generó una llave que nadie guardó; detectado y deshecho en el acto, antes de escribir las instrucciones. Verificación final: las dos copias salen CIFRADO (16 archivos cada una), lo descargado coincide byte a byte, y **la carpeta vieja ya no se puede ni listar con la llave nueva** —ilegible a propósito—. Commit `20b9493`.
- 3 sep 2026 (remate) · ~1h · **La tubería de Telegram se muda a `core/`** — lo que quedaba apuntado del cierre 9: la función de envío vivía en `orchestrator/vigia/telegram.js` y se movió a `core/telegram-transporte.js`, recableados los 7 sitios que la usaban. Único ajuste real: el redactor del token, que dependía de un fichero de la fábrica, se quedó dentro del fichero movido en su forma mínima. **Criterio de cierre probado de verdad: se apartó `orchestrator/` entera del árbol y el aviso salió igual.** `censo-avisos-sin-fabrica` 1 OK con autoprueba (se cazó a sí mismo en la primera pasada; corregido). 246/246 pruebas de la fábrica en verde. Commit `c24813d`.
- 3 sep 2026 (cierre 9) · ~1h · **Bot de Telegram exclusivo de Bamburu** (decisión de Ibrahin) — al censar apareció que **el vigía de la fábrica llevaba 30 h escuchando y ejecutando órdenes por ese bot** pese a estar la fábrica parada; parado y deshabilitado. Credenciales fuera de `/etc/orquestador.env` (queda vacío) y en `/etc/bamburu.env` como `BAMBURU_TELEGRAM_*`; el bloque de configuración de la fábrica, sin nombres; cerrojo en `orchestrator/vigia/bot-retirado.js`; y retiradas **55 líneas de `orq.js` que pedían el token y lo escribían en disco**. Todo aviso empieza por `BAMBURU — <tema>`, estampado por **la puerta común**, y sin tema no sale. `censo-bot-de-bamburu` 5 OK con autoprueba; 246/246 pruebas de la fábrica en verde (10 reescritas, ninguna silenciada). Commit `2b34356`.
- 3 sep 2026 (cierre 8) · ~2h · `copias-cifradas-con-entorno-y-certificados` (AUD-008) — **cifrado ENCENDIDO** por orden de Ibrahin; el activador hizo su ensayo real en las dos cuentas y solo entonces cambió el destino. Las dos copias: **16 artefactos cada una, CIFRADO**, con `cryptcheck` y `cmp` de cada uno. Nuevo `entorno-<fecha>.tar.gz` con `/etc/bamburu.env` + certificados, **que solo viaja si el destino es crypt** (ese fichero guarda Stripe, la IA, Resend y Notion). Aviso de fallo por Telegram reutilizando el transporte del cierre 7, extraído a `core/telegram-servidor.js`. **Vuelta probada en el servidor:** restaurado un negocio con 212 clientes y 928 facturas, **Bamburu levantó** y sirvió `/admin/login` con 200 — y el primer intento no arrancó por faltarle el entorno, que es la ficha demostrada sin querer. Rojos sobre el Drive real: llave equivocada → 0 ficheros; objeto en crudo → binario sin una palabra legible. 28 comprobaciones + probado en rojo 4 veces. Abierto y esperando orden: 319 copias viejas en claro, y si rotar la llave. Commit `2cf81b2`.
- 3 sep 2026 (cierre 7) · ~1,5h · `arranque-no-tolera-modulo-ausente` (AUD-007) — el cargador se tragaba el fallo de cualquier parte y arrancaba igual **con código de salida 0**, así que para systemd el arranque era un éxito. Medido en el journal: **5 veces en 30 días, 3 con el ERP entero caído**. Apareció un tercer modo de fallo mudo (módulo sin `register`). Esencial = solo el ERP (decisión de Ibrahin); el resto arranca pero avisa. Aviso a Telegram leyendo la llave de donde ya vive, sin duplicar el secreto, y con freno de 10 min. **Comprobado en vivo en el servidor: no levantó y el aviso llegó (8 intentos → 1 mensaje).** 39 comprobaciones + probado en rojo 5 veces. Commit `3b78130`.
- 3 sep 2026 (cierre 6) · ~2h · `disa-prompt-injection-defensas` (AUD-016) — censadas las cuatro vías por las que llega texto que no escribió el usuario; lo que volvía de una consulta o un informe viajaba **en crudo** y ahora va marcado, desde un solo sitio. La pieza central es una **batería de ataques** (41 comprobaciones) que siembra órdenes maliciosas dentro de los datos y **mide la base, no la respuesta del modelo**; después da la IA por engañada y prueba los cerrojos uno a uno. Probada rompiendo cada defensa a propósito. Hallazgo: una comprobación decía probar guardas de permiso que **no probaba**. Hueco declarado y abierto: `dictar_compra` sin confirmación. Commit `e03b4bc`.
- 3 sep 2026 (cierre 5) · ~1h · `disa-confirmacion-textual-estricta` (AUD-015) — **cerrada CON PRUEBA: el hallazgo no estaba vivo**, así que cero cambios en el programa. Las once frases ambiguas cancelan, la propuesta caduca sola al hablar de otra cosa y solo se confirma una vez. Añadido un guardián que **coge la comparación del propio código y la prueba**, no una copia — probado en rojo cuatro veces. 16 comprobaciones. Commit `1951722`.
- 3 sep 2026 (cierre 4) · ~1h · `disa-rutas-sin-csrf` (AUD-006) — las rutas de DISA no heredaban la protección anti-CSRF común: nueve escrituras abiertas a que una página ajena mandara en tu nombre. Ahora entran por una puerta calcada del ERP, así que una ruta nueva nace protegida. 25 comprobaciones, con navegador sobre las pantallas reales, + centinela. Commit `ff89439`.
- 3 sep 2026 (cierre 3) · ~1,5h · `disa-sql-sin-limite-ni-timeout` (AUD-005) — las consultas de DISA no tenían tope de filas ni plazo, y el tope se le pedía a la IA. Ahora 200 filas y 5 s impuestos por el servidor, con el plazo matando un hilo aparte (antes una consulta lenta paraba el programa para todos los negocios). El recorte se anuncia, y había un segundo sitio que lo callaba. Registrada la ficha de variantes. 23 comprobaciones + centinela. Commit `a024c98`.
- 3 sep 2026 (cierre 2) · ~1,5h · `disa-stock-fuera-del-libro` (AUD-004) — DISA escribía las existencias a pelo saltándose el libro de movimientos, y eran TRES puertas, no una (también las variantes). Ahora pasa por el mismo servicio que la pantalla y deja su apunte con quién, cuándo, cuánto y por qué. Añadido el autor al libro. 21 comprobaciones en verde + centinela. Commit `c7528f6`.
- 3 sep 2026 (cierre) · ~2h · Barrido completo (tres pasadas): de 150/210 a 169/210. Destapada y arreglada una fuga que metía 43 negocios fantasma por pasada en la base de enrutado; 125 retirados. Dos comprobaciones que medían otra cosa, arregladas. Decisión del borrado por persona escrita con fecha y autor, y saldo de la IA corregido en todos los documentos. Commit `e4b8f08`.
- 3 sep 2026 · ~2h · `disa-borrado-global-conversaciones` (AUD-002) — el borrado de conversaciones de DISA deja de vaciar el negocio entero y pasa a ser real y por persona; la papelera borraba nada y ahora borra; confirmación previa en las dos acciones. De paso, arreglada la lista de conversaciones, que daba error en 86 de 87 negocios. Commits `ebcce96` + `f677a6f`.
