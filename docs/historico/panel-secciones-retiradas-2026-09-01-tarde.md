# Secciones retiradas del panel de Notion — 1 sep 2026 (tarde)

> **Copia íntegra y byte a byte. NO SE HA BORRADO NADA.**
>
> **Por qué se retiraron: por tamaño, y está medido, no estimado.** Al añadir la entrada del cierre
> del 1 de septiembre, el panel llegó a **52.141 letras** contra un tope de **45.000**. La regla vive
> en el propio panel y en el Archivo histórico: *«a 62.500 letras la lectura ya fallaba; a 40.400
> funciona»*. Con estos dos bloques fuera, el panel queda en **35.562**.
>
> **Ni uno de los dos era información viva:**
>
> · **«MEJORAS DEL 31 AGO 2026 — YA VOLCADAS»** — el propio panel lo declaraba superado: *«Esta lista
>   ya no está pendiente de nada: se volcó el 1 de septiembre de 2026 (…) Lo vigente vive en el
>   tablero del repositorio»*. Las 43 entradas vivas están en `TABLERO.md` §TAREAS EN FORMATO DEL
>   ORQUESTADOR, contrastadas una a una contra el árbol, con su motivo y su detalle **enteros**.
>
> · **Las entradas de bitácora del 25 al 31 de agosto de 2026** — Saneamientos 1 a 6, el censo de
>   correos, las cinco auditorías y el volcado del backlog. **Todas cerradas, con su commit**, y
>   todas recogidas en `TABLERO.md`, en `CLAUDE.md` y en los informes de `docs/`.
>
> **Dónde está lo anterior a esto:** `docs/historico/panel-notion-hasta-2026-08-31.md` (el panel
> entero hasta el 31 ago) y `docs/historico/panel-secciones-retiradas-2026-09-01.md` (el inventario
> del 24 ago, retirado esa misma mañana).

---

## BLOQUE 1 — «MEJORAS DEL 31 AGO 2026 — YA VOLCADAS (1 sep 2026)»

## ✅ MEJORAS DEL 31 AGO 2026 — YA VOLCADAS (1 sep 2026)
> **Esta lista ya no está pendiente de nada: se volcó el 1 de septiembre de 2026.** Antes de volcarla se contrastaron **las 54 entradas una a una contra el programa de verdad**, y no contra lo que decía el tablero — que es de donde venían sus cifras. **43 seguían vivas** y están en la cola de la máquina con su motivo y su detalle enteros. **4 ya estaban hechas**, **4 no se pueden convertir sin una decisión tuya**, **3 no se pueden comprobar sin ejecutarlas**, y **5 cifras estaban mal contadas**.
> **Se conserva aquí tal cual como registro de lo que se propuso el 31 de agosto.** Lo vigente vive en el tablero del repositorio.
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
- [ ] Versionado · \[ \] Contrato documentado · \[ \] Validación en todas las entradas · \[ \] Autenticación por token con ámbitos y cuotas
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
- [ ] Retirar las 6 pantallas muertas · \[ \] Enlazar las 14 secciones sin acceso desde el menú · \[ \] Reducir los 65 elementos de menú · \[ \] Las 99 comprobaciones que nadie ejecuta: o entran o se retiran con motivo escrito
**SIETE QUE AÑADIÓ LA MÁQUINA AL AUDITAR — no estaban en la lista del chat**
- [ ] **Anclar la cadena de VERI\*FACTU fuera del servidor.** Quien acceda al fichero de un negocio puede reescribir importes y recalcular la cadena entera: cuadraría y nadie lo notaría. Es lo que hace que la cadena signifique algo
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

## BLOQUE 2 — Bitácora: entradas del 25 al 31 de agosto de 2026

> Saneamientos 6, 5, 1-3 · las cinco auditorías · el volcado del backlog · el ritual de Codex · el
> censo y saneamiento de los envíos de correo.

> ✅ **HECHO (31 ago 2026) — SANEAMIENTO 6 — SEGUNDA COPIA DE SEGURIDAD.** Las copias ya no dependen de una sola cuenta. Se añadió una segunda copia diaria a `gilibrahin@gmail.com` a las 03:35, detrás de la de siempre a `ibrahingil@gmail.com` de las 03:33. Un único script sirve a las dos (no se duplicó código). Primera copia real ejecutada y verificada por fuera: los 11 archivos coinciden uno a uno en tamaño con los de la cuenta principal, 22,9 MB. El vigilante de las 09:02 distingue ahora **cuál** de las dos se cae: **una caída = aviso, las dos = crítico** — antes solo avisaba si fallaban ambas, que era el fallo silencioso que costó abandonar Backblaze en junio. Llegan dos correos cada mañana, etiquetados `[principal]` y `[secundaria]`. Commit `b508253`. **Decisión de Ibrahin: Backblaze descartado, las dos copias en Google.** Pendiente y sabido: las copias **siguen sin cifrar** en dos Drive personales.
> ✅ **HECHO (31 ago 2026) — SANEAMIENTO 5 — DEFECTO FISCAL DE LOS SERVICIOS SANITARIOS.** El Saneamiento 4 dejó un defecto vivo: los 12 servicios sanitarios (fisioterapia ×3, suelo pélvico, psicología ×2, terapia de pareja, nutrición ×2, osteopatía, quiropodia, logopedia) pasaron a nacer cobrando **21 % de IVA** sobre servicios que el art. [20.Uno](http://20.Uno).3º LIVA declara exentos. Se habría cobrado al paciente, dentro de una factura firmada y encadenada, **sin aviso ni bloqueo**. Cero negocios afectados (ningún negocio sanitario dado de alta todavía); era riesgo latente, se disparaba con el alta siguiente. Ahora nacen **pendientes de confirmación**: la emisión se bloquea hasta que la persona responsable declare la causa. Los 4 servicios de bienestar siguen al 21 % **a propósito**, y el comentario lo explica con una advertencia para que nadie los «arregle». Commit `f13594e`. **Causa raíz anotada: S4 se desplegó sin ejecutar una sola comprobación funcional.**
> 🔍 **HECHO (31 ago) — CINCO AUDITORÍAS PRODUCIDAS Y GUARDADAS.** Íntegras en el repo, con resumen y puntero en 🔍 Auditorías y diagnósticos: bloqueos de base de datos · migración a PostgreSQL · arquitectura y estándares · comparativa contra Salesforce, Odoo y SAP · vectores de ataque (seguridad). **No se volcaron enteras en Notion a propósito:** cinco informes completos habrían vuelto a pasar el límite de lectura del panel, que es justo el problema con el que empezó esta sesión.
> 📌 **HECHO (31 ago) — BACKLOG NUEVO VOLCADO A **[**TABLERO.md**](http://TABLERO.md)**, SIN ORDENAR.** Sección propia al final del tablero, con puntero desde la cabecera. Copia legible más abajo en esta página («MEJORAS DEL 31 AGO»). Ni un fichero de producto tocado: todo esto es documentación.
> ✅ **HECHO (27 ago 2026) — SANEAMIENTO 4 — CLASIFICACIÓN FISCAL DE OPERACIONES EXENTAS.** Se separan tipo 0 %, exención E1–E6, no sujeción N1/N2 e inversión S2 en un snapshot fiscal inmutable por línea. Catálogo, presupuestos, pedidos, albaranes, recurrencias, facturas/rectificativas/tickets, VERI*FACTU, Facturae, PDF, contabilidad y LSI comparten esa regla; las líneas ambiguas bloquean la emisión antes de crear documento fiscal. Servicios sanitarios no nacen exentos por oficio: la persona responsable confirma la causa y condiciones. Migración solo aditiva: 0 % histórico queda pendiente, y no se alteran facturas, hashes ni registros VERI*FACTU históricos. Código servido reiniciado; no se ejecutó la verificación HTTPS del despliegue por no estar autorizada. **SIGUIENTE TAREA: delimitar un único saneamiento pendiente según TABLERO/CANON; Peldaño 9 continúa aplazado mientras exista un riesgo grave demostrado.** Commit `feb90b3`. Cero gates, barridos, tests, regresiones, pruebas de carga y comprobaciones funcionales.
> ✅ **HECHO (27 ago 2026) — SANEAMIENTO 3 — BLINDAJE ANTIAVALANCHA DEL RATE LIMITING.** Persistencia agregada, acotada y anonimizada, con contrato 429 y umbrales intactos. Commit `2d258c8`.
> ✅ **HECHO (26 ago 2026) — SANEAMIENTO 2 — BLINDAJE DE DISA.** Auditoría integral realizada; Saneamientos 1 y 2 cerrados. Se retiró la escritura genérica directa de DISA y el servidor queda limitado a acciones dedicadas con permisos reales, confirmación humana de un solo uso, trazabilidad mínima sin contenido sensible y fallos controlados del proveedor de IA. El contexto del negocio no puede ampliar capacidades ni servir como permiso o confirmación. Revisión exclusivamente estática: cero gates, barridos, tests, regresiones o comprobaciones funcionales. Desplegado y visible con el procedimiento vigente. Implementación en commits `71b135a` y `c48c83c`.
> ✅ **HECHO (26 ago 2026) — SANEAMIENTO 1 — Retirado el barrido nocturno automático.** El timer de las 03:15 estaba activo y ejecutó por última vez el 26 ago. Se ha detenido, deshabilitado y retirado junto con su servicio; systemd ya no puede arrancarlo por reloj. El script `scripts/barrido-nocturno.sh` sigue disponible únicamente para ejecución manual cuando Ibrahin lo solicite o autorice expresamente. La revisión de solo lectura de systemd y cron no encontró otro automatismo equivalente; los demás timers de Bamburu son operación normal o backups. Cero gates, barridos, tests, regresiones o comprobaciones funcionales ejecutados en este saneamiento. Commit `bff11d0`. · **CONTINUIDAD CORREGIDA EL 26 AGO: Peldaño 9 queda aplazado; la siguiente tarea oficial es Saneamiento 2 — Blindaje de DISA.**
> ✅ **HECHO (25 ago 2026) — RITUAL-CODEX — Saneamiento final del flujo de trabajo.** Codex queda como programador/ejecutor y el chat como orquestador; CANON conserva la autoridad estratégica, TABLERO el estado y las tareas, y RITUAL la rutina vigente. Retirada de las instrucciones activas la regla antigua del barrido automático; `session.json` puesto al día. El censo/saneamiento de correos del 25 ago está terminado y el Peldaño 8 quedó cerrado el 24 ago. **No hay tarea de producto iniciada.** No se ejecutaron gates, barridos, tests ni regresiones. Commit `18bcd4a`. · **CONTINUIDAD HISTÓRICA SUPERADA EL 26 AGO: Peldaño 9 queda aplazado por la fase de saneamiento activa.**
> 📧 **HECHO (25 ago 2026) — CENSO Y SANEAMIENTO DE LOS ENVÍOS DE CORREO.** Sí, la avalancha del 24 venía del trabajo de ese día. Pero al mirar los datos aparecieron dos cosas que la sospecha no preveía, y una es peor que la avalancha.
> • **La línea base real de Bamburu son 2 correos al día.** El 24 hubo **174**. De los 45 que llegaron a tu bandeja, **39 los mandaron dos comprobaciones**, y ninguna a propósito: una pedía el enlace de acceso usando «el primer admin del primer negocio activo» —que en esta máquina eres tú— dos veces por pasada, y otra pedía una migración de verdad, cuyo aviso va al buzón del equipo, que por defecto también eres tú. Cuatro correos reales por cada pasada del barrido.
> • ⚠️ **El negocio helados-ibrahin lleva ocho días sin recibir nada, y nadie se había enterado.** Tiene apuntado `igilm@gmail.com`, y **esa cuenta no existe**: Gmail responde «550-5.1.1 The email account that you tried to reach does not exist». Rebotó el 17 de agosto, Resend lo puso en su lista de supresión y desde entonces **descarta en silencio** todos sus resúmenes. La supresión está BIEN hecha y no se toca —quitarla solo provocaría otro rebote—: lo que está mal es la dirección, y cambiarla es decisión tuya y queda fuera del encargo. Lo que sí destapa es del producto: **da por enviado lo que Resend está tirando a la basura.**
> • **El 18 % de todo lo enviado en agosto rebotó** (122 de 675). 79 eran recordatorios de cita a direcciones inventadas `@t.local`, y rebotaron el 100 %. Los rebotes no son gratis: son los que llevaron a esa supresión.
> • **Seis negocios fantasma seguían activos y recibiendo su resumen diario.** Los crearon comprobaciones que se cayeron a medias; el temporizador de avisos los trataba como negocios de verdad y les mandaba correo a direcciones que no existen. Borrados.
> • Y un dato de contexto: **la cuenta de Resend no es solo de Bamburu**. «Rebobina» envía desde ella y gasta del mismo cupo.
> • **La norma, aplicada y verificada.** Ninguna comprobación escribe ya a una bandeja real, con un guardián dentro del barrido que lo vigila. Los dominios de prueba que **existen de verdad** (`ej.com`, `minegocio.com`, `x.es`) pasan a `.test`: un correo de recuperación de contraseña dirigido a `ej.com` acababa en casa de un desconocido. Y en la puerta del correo, una dirección de dominio imposible se **desvía** a simulación en vez de mandarse al vacío — eso mata la clase entera de rebotes sin confiar en que la comprobación número 33 se acuerde.
> • **El freno:** 120 envíos por hora, y el número está medido — la hora más cargada de todo agosto tuvo 38 y la mediana fue 2. Cuenta en `control.db` porque una pasada del barrido son 207 procesos y un contador en memoria vería dos correos mientras entre todos mandan cientos. Si el freno no puede contar, **deja pasar el correo** —tu negocio tiene que poder mandar facturas aunque el vigilante esté roto— pero lo grita.
> • **Verificado con dos barridos completos seguidos**, con el registro de Resend marcado antes y leído después: **12 envíos por pasada** (eran \~90), **CERO a bandejas reales** (eran 4 por pasada), **CERO rebotes** (eran 36 en el día). Veredicto: de 8 rojos a 6, y 4 de esos son el saldo de IA. Censo completo en `docs/censo-correos.md`.
> • Y una regresión que no era de nadie: `gate-citas-pantalla` llevaba cuatro barridos en verde y se puso rojo solo. Usa «hoy + 2 días», y esa fecha pasó de caer en un día libre a caer donde había dos citas puestas el 20 de agosto. El residuo estaba quieto: fue el gate el que se acercó a él. No se borran esas citas —son de clientes del negocio—; el gate ahora busca días vacíos.
> Commits `6fc3fdb`, `c602d15`, `6afaf0c`, `a4d4b32`, `08a7f4d`. Empujado y desplegado.
>
