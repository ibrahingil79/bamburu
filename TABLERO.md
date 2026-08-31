# TABLERO — Fase activa de saneamiento técnico

> **ORDEN VIGENTE — DECISIÓN DE IBRAHIN (26 ago 2026).** La auditoría integral está realizada y,
> antes de continuar el roadmap funcional, Bamburu entra en una fase de saneamiento técnico. **No se
> añaden funciones nuevas hasta cerrarla.** La finalidad es elevar seguridad, robustez, calidad de
> código, coherencia operativa, recuperación, escalabilidad y mantenibilidad hasta el nivel de un
> producto profesional comparable con los líderes del mercado. Se mantiene una sola tarea activa cada
> vez. **Saneamientos 1, 2, 3, 4, 5 y 6 están cerrados. Fase de saneamiento general: ACTIVA.
> El aislamiento de bloqueos SQLite sigue PENDIENTE y SIN DELIMITAR: hay que acotarlo antes de
> iniciarlo.**
>
> ⚙️ **DECISIÓN DE IBRAHIN (31 ago 2026): esta tarea DEJA DE SER LA SIGUIENTE.** Manda la lista de cinco
> de §«TAREAS EN FORMATO DEL ORQUESTADOR». El motivo: era un candidato que este mismo tablero ya
> había descalificado —está sin delimitar y no se puede iniciar—. **No se descarta: se queda
> pendiente, como las demás.** El rótulo se retira aquí para que solo haya una siguiente tarea en
> todo el documento.
> **Peldaño 9 — Belleza/estética queda pendiente y aplazado; no es la siguiente tarea mientras
> exista un riesgo técnico grave demostrado.**
>
> 🗃️ **Backlog de mejoras del 31 ago 2026 (54 ítems, SIN ORDEN DECIDIDO): al final de este
> documento.** Sale de cinco auditorías cuyos informes íntegros viven en `docs/` — no aquí.

> **SANEAMIENTO 6 ✅ HECHO (31 ago 2026): SEGUNDA COPIA DE SEGURIDAD EN GOOGLE DRIVE (cuenta
> `gilibrahin@gmail.com`).**
>
> **Resultado.** Ya hay **dos copias diarias verificadas en dos cuentas distintas**. La principal sale
> a las 03:33 a `ibrahingil@gmail.com`; la secundaria a las 03:35 a `gilibrahin@gmail.com`. Las dos
> copian los mismos 11 artefactos —`control.db`, las 9 bases de tenant y `data/uploads` en `tar.gz`—,
> las dos verifican tamaño y MD5 contra el fichero ya subido, las dos hacen prueba de restore real y
> las dos conservan 14 días.
>
> **Una sola pieza, no dos scripts.** `scripts/bamburu-backup.sh` sirve a las dos copias: sin
> variables de entorno se comporta exactamente como antes, y la unit de la secundaria sobreescribe
> `BACKUP_REMOTE`, `BACKUP_LABEL`, `BACKUP_SUFFIX` y `BACKUP_HC_URL`. Se parametrizó en vez de
> duplicar porque dos copias de las mismas reglas se separan en cuanto alguien arregla una sola.
> Comprobado que sin entorno los valores efectivos son idénticos a los de antes del cambio.
>
> **El dead-man's-switch NO se comparte.** `BACKUP_HC_URL` va vacío a propósito en la secundaria: si
> pingease el mismo check de healthchecks.io que la principal, una principal caída seguiría viéndose
> verde en el monitor externo.
>
> **Avisos: una caída avisa, dos son críticas.** El heartbeat vigila cada copia por separado, con
> marcas distintas (`last-success` y `last-success-secondary`). Una copia sin éxito en +48 h manda
> AVISO (queda respaldo, se perdió la redundancia); las dos, CRÍTICO. Vigilar solo «que fallen las
> dos» habría reintroducido el fallo silencioso que costó el cambio desde Backblaze: una secundaria
> rota durante un mes, con la principal en verde, no avisaría a nadie. La secundaria solo se vigila si
> su timer está instalado, para no dar falsas alarmas antes de existir. Probado en 7 escenarios.
>
> **Verificado en producción.** Credencial comprobada ANTES de instalar: `gdrive_gili` responde y es
> otra cuenta (10,38 GiB usados frente a 5,38; papelera 0 frente a 516 MiB). Ciclo suelto probado
> —subir, MD5, descargar, borrar— antes de tocar systemd. Primera copia real ejecutada a mano el
> 31 ago, 14:16→14:20 UTC: **11 archivos, exit 0**, cada uno con su restore-test, email
> `[secundaria] OK` enviado. Contrastado por fuera contra la cuenta principal: **11 de 11 idénticos
> en tamaño, 0 discrepancias**. Heartbeat en `OK 2/2`.
>
> **Límite conocido, y no es un descuido.** Las dos copias viven en el MISMO proveedor. Protege contra
> borrado accidental y contra que una cuenta se llene; **no protege** contra que la identidad de
> Google se suspenda o se comprometa, que probablemente se llevaría las dos. Backblaze B2 quedó
> medido como alternativa (10 GB gratis, sin tarjeta, el backup ocupa 320 MB = 3 % del cupo) y
> **descartado por decisión de Ibrahin**, que prefirió una segunda cuenta propia.
>
> **Fuera.** Cifrado de las copias; tercer destino; ensayo de restauración completa de un negocio; y
> cualquier cambio en la copia principal más allá de la parametrización.

> **SANEAMIENTO 5 ✅ HECHO (31 ago 2026 · `f13594e`): DEFECTO FISCAL DE SERVICIOS SANITARIOS — NACEN
> `pending`, NO `taxable`.**
>
> **Causa.** S4 (`feb90b3`) pasó los 12 servicios de asistencia sanitaria de la precarga de oficios de
> banda `exento` (0 %) a `general` (21 %) con `fiscal_treatment: 'taxable'`. La decisión de no nacer
> exentos era correcta —la exención del art. 20.Uno.3.º LIVA exige profesional titulado Y finalidad
> terapéutica, y el software no puede saber ninguna de las dos—, pero el aterrizaje dejaba al próximo
> negocio de salud arrancando con un catálogo que **cobra un 21 % que la ley no permite repercutir**,
> sin aviso, sin bloqueo y firmado en VERI*FACTU.
>
> **Alcance medido.** Cero negocios afectados: ningún tenant de salud tenía catálogo sembrado. Riesgo
> **latente**, que se disparaba en la próxima alta de un negocio sanitario.
>
> **Arreglo.** Los 12 nacen `pending`, estado que **bloquea la emisión**
> (`core/fiscal-classification.js:25`) hasta que una persona responsable confirme causa y condiciones
> línea a línea. `fiscal_treatment` pasa a ser **por servicio** (`s.fiscal || 'taxable'`) en vez de una
> constante para los seis oficios: ponerlo global habría dejado sin facturar a peluquerías, estéticas,
> talleres y asesorías, cuyos 25 servicios no tienen ninguna duda fiscal. Los 4 de bienestar (masaje no
> terapéutico, entrenamiento personal, pilates, plan de adelgazamiento) siguen `taxable` al 21 %.
>
> **Sincerados los comentarios**, que describían el comportamiento anterior a S4 («Nace 'exento' para
> no arrancar cobrando un 21%»), y `CLAUDE.md`, que daba S4 por «no iniciada» con S4 ya en HEAD.
>
> **Verificación.** Estática, sin gates ni barridos (no autorizados en el encargo): `node --check` OK
> y evaluación del módulo → **12 `pending` · 4 `taxable`**, y los otros cinco oficios con 0 `pending`.
> Desplegado el 31 ago a las 13:19 UTC reiniciando el servicio; comprobado que el proceso arrancó
> DESPUÉS del cambio y que sirve el código de S5.

> **SANEAMIENTO 4 ✅ HECHO (27 ago 2026 · implementación fiscal aditiva): CLASIFICACIÓN FISCAL DE
> OPERACIONES EXENTAS.**
>
> **Resultado.** La tasa y la naturaleza jurídica ya no son el mismo dato. La fuente única
> `core/fiscal-classification.js` valida por línea `taxable` (S1 o S2), `exempt` (E1–E6),
> `non_subject` (N1/N2) o `pending`, con porcentaje, inversión y literal legal separados. Una tasa
> 0 % puede ser S1; no se convierte en exenta por defecto. La emisión bloquea una línea pendiente
> antes de abrir su transacción, conservando el borrador y sin generar una factura ni alta VERI*FACTU
> parcial.
>
> Catálogo y documentos previos conservan el snapshot completo; presupuestos, pedidos, albaranes,
> recurrencias, facturas, rectificativas, tickets y sustituciones lo arrastran. Factura/PDF, VERI*FACTU,
> Facturae, contabilidad y LSI lo proyectan con su adaptador propio. VERI*FACTU deja de usar S1 por
> defecto: emite S1/S2, `OperacionExenta` E1–E6 o N1/N2 según el snapshot. Facturae usa su evento
> fiscal especial y literales legales, sin inventar claves AEAT en su XML.
>
> La migración es solo aditiva. Productos históricos con tasa positiva conservan el tratamiento
> sujeto/no exento; los de 0 % y las líneas históricas quedan pendientes, sin deducirles una causa.
> No se reescriben facturas, hashes ni registros VERI*FACTU históricos. DISA solo prepara productos
> con fiscalidad pendiente; un responsable humano selecciona y confirma una exención. Los servicios
> sanitarios ya no nacen exentos por oficio, nombre ni tasa.
>
> **Revisión y despliegue.** Revisión exclusivamente estática del diff y de las rutas de creación,
> conversión y salida fiscal. No se ejecutó ningún gate, barrido, test, regresión, prueba de carga ni
> comprobación funcional por orden expresa de Ibrahin. Código servido desplegado mediante reinicio del
> servicio; no se lanzó el script de despliegue porque su verificación HTTPS funcional no está autorizada.
> Documentación técnica: `docs/contexto/clasificacion-fiscal-lineas.md`.
>
> **Causa corregida.** Antes Bamburu modelaba una operación exenta únicamente como `tax_rate = 0`. Al emitir
> el documento pierde que ese cero significa **exención**, su causa legal y la diferencia frente a
> una operación sujeta al tipo 0 o no sujeta. Por tanto, importes iguales pueden recibir un tratamiento
> fiscal distinto y el dato necesario ya no existe cuando Verifactu o los libros oficiales lo leen.
>
> **Evidencia histórica que lo confirmó.** `core/vat-bands.js:7-14` definía literalmente `0 = exento` y solo
> devuelve banda+tasa; `modules/erp/oficios.js:90-116` precarga doce servicios sanitarios con banda
> `exento`, por lo que el caso ya es parte del producto vivo. Sin embargo, `invoice_items` solo conserva
> `tax_rate` y `tax_amount` (`modules/erp/models.js:1190-1204`) y `createInvoice` inserta únicamente esos
> números (`modules/erp/routes/invoices.js:328-338`). Al remitir, `buildRegistroAlta` agrupa solo por
> tasa y usa por defecto `CalificacionOperacion=S1`, sujeta y no exenta, para todas las líneas
> (`modules/erp/verifactu-envio.js:198-219,251-254`). El export oficial reconoce las columnas
> “Calificación de la Operación” y “Operación Exenta (E1–E6/N1–N2)”, pero las declara pendientes y las
> deja vacías (`modules/erp/contabilidad-export.js:78-93`). El hallazgo histórico de
> `docs/INVESTIGACION_A2.md` §4.8 sigue, por tanto, confirmado por el código actual.
>
> **Consecuencias posibles.** Una factura sanitaria puede verse como “exenta” en Bamburu y, al mismo
> tiempo, quedar preparada para Hacienda como “sujeta y no exenta” al 0 %, sin causa de exención. Eso
> puede producir registros Verifactu o libros fiscales incorrectos, bloqueos/rechazos al activar la
> remisión real y una trazabilidad insuficiente para justificar por qué no se repercutió IVA. Afecta a
> cualquier negocio que facture servicios exentos, no a una pantalla aislada.
>
> **Alcance aplicado.** Se diseñó una clasificación fiscal cerrada por línea —sujeta no
> exenta, exenta con causa y no sujeta cuando proceda— separada del porcentaje; añadir snapshots
> aditivos e inmutables a catálogo y líneas de documentos; hacer que todos los caminos de creación y
> conversión conserven esa clasificación; proyectarla correctamente en factura/PDF, Verifactu,
> Facturae, contabilidad y export LSI; y bloquear de forma explícita cualquier remisión cuyo tratamiento
> no pueda determinarse sin inventar. La migración deberá ser aditiva, compatible y sin `DROP`.
>
> **Se conserva intacto.** Bandas 21/10/4, IRPF, numeración, estados,
> permisos, contratos HTTP, cadena y huellas Verifactu, documentos ya emitidos y todos los datos
> históricos. Una factura emitida no se reescribe ni se reclasifica por inferencia. Los casos históricos
> ambiguos no se inventan: se identifican y se bloquean para revisión, pero no se transforman.
>
> **Criterios de cierre cumplidos.** (1) Todo documento nuevo congela tratamiento, tasa y causa por línea; (2)
> “exento” nunca se deriva solo de que la tasa sea cero; (3) Verifactu genera la calificación/causa que
> corresponde o falla cerrado antes de enviar; (4) PDF, Facturae, contabilidad y LSI leen el mismo
> snapshot; (5) todos los flujos de factura reutilizan una única regla; (6) documentos/huellas históricos
> permanecen byte a byte y el cambio es aditivo; (7) queda definida una comprobación aislada para una
> factura mixta y cada causa admitida, ejecutable solo con autorización expresa conforme a RITUAL.
>
> **Fuera.** Cambiar porcentajes o política fiscal; corregir o reenviar facturas históricas; activar la
> cola real de Verifactu; colaborador social/certificados; subsanaciones o anulaciones AEAT; nuevos
> modelos fiscales; rediseñar documentos; Facturae completo; Peldaño 9; cualquier otro saneamiento.
>
> **Por qué va antes.** Es un riesgo vivo de cumplimiento sobre documentos fiscales inmutables: cada
> nueva factura exenta puede congelar información insuficiente y el daño no se arregla reescribiendo el
> pasado. Va antes que la segunda copia de backup —el backup actual está verificado y restaurable—, que
> el aislamiento de bloqueos SQLite —riesgo de disponibilidad acotado a espera, no corrupción—, que las
> opciones B/C de escalado —condicionadas al crecimiento— y que CSP/tienda —riesgos aceptados o superficie
> apagada—. Es una única costura fiscal transversal, aditiva y delimitable sin iniciar producto nuevo.

> **SANEAMIENTO 3 ✅ HECHO (27 ago 2026 · `2d258c8`): BLINDAJE ANTIAVALANCHA DEL RATE
> LIMITING.** La causa exacta eran los **50.738 rechazos 429 en 20 segundos**, cada uno con un `INSERT`
> síncrono individual en `security_events` de la base central compartida `control.db`.
>
> Todos los usos vivos del `rateLimit` compartido —global, login, alta, `/find-tenant`, DISA, avisos y
> rutas públicas— conservan umbrales, claves funcionales, cuerpos JSON/HTML, `Retry-After` y contrato
> 429. Los rechazos se acumulan ahora en la tabla aditiva `rate_limit_summaries`; el panel suma esos
> contadores y muestra periodo, limitador, negocio, magnitud y origen técnico anonimizado. Los eventos
> históricos permanecen intactos.
>
> **Límites:** 10.000 claves de cupo en memoria, con fallo cerrado para claves nuevas si se agota el
> techo; 289 claves de resumen; ventanas de cinco minutos; máximo una escritura cada cinco segundos
> por resumen y cuatro operaciones por segundo por proceso; memoria hasta veinte minutos mediante el
> barrido ya existente; persistencia rodada 30 días, solo sobre la tabla nueva. No se guarda IP completa,
> sujeto de `keyFn`, contenido, credenciales, tokens ni cookies. El origen usa HMAC-SHA-256 con sal
> efímera. El `UPSERT` suma lotes concurrentes sin pisarlos.
>
> Si `control.db` falla, el lote permanece dentro del límite de memoria, stderr avisa como máximo una
> vez cada cinco minutos y el 429 sigue respondiéndose: no hay bypass ni recursión. No se añadió ningún
> temporizador ni proceso. La comprobación aislada `scripts/test-rate-limit-aggregation.mjs` quedó
> definida pero **no ejecutada**: por orden expresa de Ibrahin no se ejecutó ningún gate, barrido, test,
> regresión, prueba de carga ni comprobación funcional.
>
> Servicio reiniciado y activo. No se lanzó `scripts/desplegar.mjs` porque incluye una comprobación
> HTTPS funcional no autorizada. Fase de saneamiento general aún ACTIVA. **SIGUIENTE TAREA OFICIAL: A
> LA ESPERA DE ENCARGO para delimitar el siguiente saneamiento.** Peldaño 9 permanece aplazado.

> **SANEAMIENTO 2 ✅ HECHO (26 ago 2026): BLINDAJE DE DISA.** Se retiró la vía genérica
> `insert_record`/`update_record`/`delete_record`, que escribía tablas directamente y podía eludir
> servicios e invariantes del producto. El servidor acepta ahora solo una lista cerrada de acciones
> dedicadas, valida la envolvente y sus límites, vuelve a comprobar los permisos reales y conserva la
> confirmación humana. Cada propuesta con consecuencias recibe un identificador de un solo uso: evita
> duplicados por reintento y deja una traza mínima de propuesta, confirmación y resultado sin guardar
> parámetros, prompts ni datos sensibles. El contexto de negocio queda marcado como dato no confiable;
> la traza interna no es consultable por DISA. El proveedor de IA tiene timeout y errores controlados
> para falta de saldo, transporte y respuestas inválidas/incompletas. Se retiraron logs de depuración
> con valores o errores completos. La lectura ya era fail-closed por tabla/permiso y el estado de
> producto `archived` ya estaba corregido antes de este saneamiento. Revisión exclusivamente estática:
> por orden expresa de Ibrahin no se ejecutó ningún gate, barrido, test, regresión ni comprobación
> funcional. Desplegado y visible con el procedimiento vigente. Implementación en commits `71b135a`
> y `c48c83c`.

> **SANEAMIENTO 1 ✅ HECHO (26 ago 2026): RETIRADO EL BARRIDO NOCTURNO AUTOMÁTICO.** El timer
> `bamburu-barrido-nocturno.timer` estaba activo y ejecutó por última vez el barrido completo el
> 26 ago a las 03:15. Se detuvo, deshabilitó y retiró junto con su unidad `.service`; systemd ya no
> puede arrancarlo por reloj. `scripts/barrido-nocturno.sh` se conserva como herramienta manual,
> únicamente para cuando Ibrahin lo pida o autorice expresamente. Revisión de solo lectura de los
> demás timers/cron: no apareció otro automatismo de gates, tests, regresiones o comprobaciones
> funcionales; los demás timers Bamburu son operación normal (avisos, recordatorios, propuestas,
> caducidad de reservas, Verifactu y backups). Cero gates/tests/barridos ejecutados en este saneamiento.
> Cambio y cierre documentados en commit `bff11d0`.
>
> **ENCARGO SUELTO ✅ HECHO (25 ago 2026): CENSO Y SANEAMIENTO DE LOS ENVÍOS DE CORREO.** Sí, la
> avalancha del 24 (174 correos contra una línea base de **2 al día**) vino del trabajo de ese día:
> **39 de los 45** que llegaron a la bandeja del dueño los mandaron dos comprobaciones, sin querer —
> una cogía «el primer admin del primer negocio activo» y la otra pedía una migración de verdad, cuyo
> aviso va al buzón del equipo. Censo completo y medido en `docs/censo-correos.md`. **Ahora: 12 envíos
> por pasada del barrido, CERO a bandejas reales, CERO rebotes** (dos barridos seguidos, con el
> registro de Resend marcado antes y leído después). Los envíos reales del producto no se han tocado.
> Hay freno: si en una hora se pasa de 120 envíos, para y avisa una vez — el número está medido, la
> hora más cargada de todo agosto tuvo 38. Y **dos hallazgos que el encargo no preveía**: (1) el
> negocio **helados-ibrahin** lleva ocho días sin recibir nada porque tiene apuntado
> `igilm@gmail.com`, una cuenta que **no existe** (Gmail: «550-5.1.1 does not exist»); Resend lo
> suprimió el 17 ago y desde entonces lo tira todo en silencio — **el producto lo da por enviado**;
> corregir la dirección es decisión del dueño y queda fuera del encargo; (2) seis negocios fantasma
> de comprobaciones caídas seguían **activos y recibiendo su resumen diario** a direcciones
> inexistentes: borrados.
> **DÓNDE ESTAMOS HOY (2026-07-16).** Eje A (UX) **completo**. Multi-almacén **cerrado** (las tres capas;
> los traslados se verificaron el 10-jul: el valor del inventario no cambia al mover stock). Módulo de
> **Avisos al 100 %** (contador en vivo + fuente "cliente en riesgo"; el bucle de la campana, arreglado).
> **Verifactu para clientes NO es "activar la cola"**: el plan es **colaborador social** (un único
> certificado de Bamburu + autorización de representación del cliente), y está **aparcado** hasta tener la
> plataforma al 100 % — ver `docs/contexto/decisiones.md` (2026-07-10).
>
> **EJE C — SEGURIDAD: ✅ COMPLETO (C1–C6, 16 jul) + C5-bis (rescate de los dueños) + C5-ter (cerrojo del
> superadmin y email fuera de los eventos, 17 jul).** Los tres ejes de la fase de optimización quedan
> cerrados (A: UX · B: DISA · C: Seguridad), y no queda ningún cabo anotado del Eje C.
>
> **ORDEN VIGENTE (17 jul 2026): LA ESCALERA — ver la sección `## LA ESCALERA` al final, y CANON §4.**
> La fase de optimización quedó cerrada y la sucede una **escalera numerada** donde cada peldaño se
> apoya en el anterior: **1 sincerar → 2 margen → 3 informes → 4a/4b constructor de analíticas (la
> puerta visual) → 5 DISA predictiva → 6 dashboards → 7-9 oficios → 10-19 el resto.** **Se acabaron
> "El Foso" y el "Roadmap futuro"**: cada módulo tiene número. **Pasos 1 (sincerar), 2 (margen) y 3
> (catálogo de las 5 áreas + responsable + informes por área + plan financiero) HECHOS (17 jul).**
> **HECHO el constructor completo: 4a (ventas) + 4a-bis (compras/clientes/inventario) + 4b (cálculos
> propios, combinar fuentes, compartir paneles).** **Contabilidad sigue FUERA, pendiente de tu decisión.**
> **PASO 7 (servicios profesionales · 1er oficio) ✅ CERRADO el 28 jul 2026** con la pieza 6 (puerta
> pública de reserva): las 6 piezas entregadas y verificadas. **El puntero de la escalera está en el
> PELDAÑO 8 (Salud / bienestar · 2º oficio), a la espera de encargo.**
> Pasos 5 (DISA predictiva: vigía + voz + dibujo + priorización/Inicio) y 6 (Inicio personalizable)
> HECHOS y VALIDADOS por Ibrahim en pantalla (21 jul 2026). **Paso 7 CERRADO (28 jul 2026):** piezas 1
> (proyecto), 2 (registro de tiempo) y 3 (facturar horas) VALIDADAS por Ibrahim en pantalla (21 jul;
> «Proyectos» ya es área propia del rail); pieza 4 completa (rentabilidad contable + coste de las horas,
> 22 jul); pieza 5 (sistema de citas: motor + agenda interna) + Agenda sencilla (27 jul); **pieza 6
> (puerta pública de reserva, 28 jul) — la que cierra el peldaño.**
> **PELDAÑO 8 EN CURSO: PIEZA 1 (perfil de oficio en la agenda) ✅ ENTREGADA el 15 ago 2026.** Al crear
> el negocio se elige entre SEIS oficios y la agenda habla su idioma desde el primer minuto: cambia las
> palabras de pantalla y precarga el catálogo de servicios (duraciones reales de España, con fuente
> anotada). Nada más: no toca el motor, no enciende ni apaga funciones, no quita nada. Los negocios que
> ya existen quedan en «Otro» y no cambian. **El peldaño 8 sigue ABIERTO.** No se inicia nada sin tu encargo.
> **PELDAÑO 8 · PIEZA 3 ✅ ENTREGADA (17 ago 2026): EL VIGÍA APRENDE DE AGENDA.** Cuatro detectores
> nuevos —hueco que se va a perder, cliente fuera de su ritmo, se fue sin próxima cita, y ausencias
> (el estado `no_show` existía de verdad)— leyendo del motor de citas, sin cifras propias y sin
> escribir nada. El PASO 0 tumbó el método que pedía el encargo: `huecos()` **no puede** dar ocupación
> ni horas libres. **El peldaño 8 sigue ABIERTO.**
> **ENCARGO SUELTO ✅ HECHO (17 ago 2026): AVISOS Y CORREOS.** El resumen por correo deja de ser una
> tarea fija de las 8:00 al correo del negocio y pasa a ser **de cada persona**: se apaga, se cambia de
> hora, se recorta por fuente, **filtra por permisos** y cuenta **un parte en frases** en vez de «233
> avisos». Y cada correo automático o de botón que sale hacia los clientes gana su interruptor (con la
> confirmación de reserva **bloqueada** mientras la puerta pública esté encendida). Ver su ficha en
> «Función por encargo del dueño». Descubrimiento del PASO 0: **`company_config.email` estaba vacío en
> 6 de 7 negocios**, así que el correo diario solo llegaba a uno.
> **TAREA TRANSVERSAL DE PRESENTACIÓN ✅ HECHA (17 ago 2026): NAVEGACIÓN — MENOS RUIDO SIN PERDER NADA.**
> Como la «Agenda sencilla», **no es pieza de ningún peldaño** y no mueve el puntero de la escalera.
> Cada desplegable se parte en dos bloques (día a día arriba · «Ajustes de \<Área\>» abajo) **sin plegar
> nada**; el buscador del topbar —que era decorado, sin `input` ni destino— pasa a navegar por el menú
> con Ctrl/⌘+K; y cada uno **se ancla sus atajos** arriba del rail (máx. 8, **por usuario**) **y mueve
> de orden lo que quiera** —las áreas del rail y las entradas de cada desplegable, arrastrando—, con un
> botón para volver al menú de fábrica. **N antes = N después = 50 puertas**, pulsadas una a una.
> **AMPLIADA EL 18 AGO 2026 (decisión de producto de Ibrahin):** en Agenda solo vive lo que se usa
> atendiendo clientes — se queda con 2 entradas y las otras 6 se mudan, renombradas, a una sección
> propia de la configuración del negocio, **con su permiso exacto cada una** y sin heredar el candado
> de la pantalla que las aloja. Los puestos nacen ocultos y aparecen solos; la página de reservas se
> enciende sola cuando hay horario y precios. **Siguen siendo 50 puertas**, ahora en dos superficies.
> Del PASO 0: la tabla de preferencias que el encargo mandaba
> reutilizar **no servía** (se reutiliza `dashboard_layouts`, cero tablas nuevas), y las etiquetas del
> menú **se pintaban sin escapar** con texto libre del dueño dentro. El **Backlog** de abajo NO
> compite con la escalera: es lo que le falta a El Suelo (el umbral) más la deuda. Plan del Eje C
> cargado desde la auditoría del 15 jul (ver la
> sección "Eje C: Seguridad"). **C1 (Verifactu, ALTA), C2 (verificación con administrador), C3 (tres
> victorias rápidas), C4a + C4a-bis HECHOS** → **M1 (XSS almacenado) CERRADO ENTERO**. **C4b: hechos
> C4b-0 (nonce + sonda), C4b-1 (registro y superadmin ya sirven `script-src` SIN `'unsafe-inline'`) y
> C4b-2 (los 4 scripts de CDN, autoalojados)**. **C4b-3 (store) y C4b-4 (ERP): DECIDIDOS el 16 jul —
> NO se les aplica la CSP; deuda consciente, con dueño y por escrito** (ver sus fichas). **C5 HECHO
> (16 jul)**: sesiones revocadas al desactivar, freno + enumeración cerrada en `forgot-password`, y 2FA
> con códigos de rescate en el superadmin. Siguiente tarea real: **C6** (los 12 hallazgos BAJA), con
> **C5-bis** (códigos de rescate para los dueños) anotada como producto. Eje A (UX) y Eje B (DISA, seis
> propuestas de proactividad) completos; Pilar 3 (inventario) cerrado.
>
> **Inventario (Pilar 3) CERRADO (15 jul 2026):** multi-almacén (`da7871e`/`3af928f`), stock mínimo /
> punto de pedido (`8b4fbe4`) y trazabilidad por lote / nº de serie (`f56ad84`). Ver el Backlog.

<!-- BARRIDO:INICIO -->
## 🔁 EL BARRIDO — A DEMANDA

> **Este bloque lo mantiene `scripts/barrido-estado.mjs`. No se edita a mano.**
> **Ningún barrido y ningún gate se ejecuta solo. Ni el de la tarea.** Se ejecutan cuando Ibrahin
> lo pide. La norma, entera y sin resumir, está en **RITUAL.md · «LA REGRESIÓN»**; aquí solo se
> apunta. Al cerrar una entrega **se propone** —qué se ha tocado, qué modo se recomienda y desde
> cuándo no se corre— y se espera un sí. Si dice que no, queda pendiente aquí y se vuelve a
> proponer al abrir la siguiente sesión.

- **Último barrido completo:** 2026-08-26 · `18bcd4a` · **153/207** · 1273 s
- **Estado:** ✅ al día

<!-- BARRIDO:FIN -->

## CORRECCIONES DEL DUEÑO — 21 AGO 2026 (registro completo, no trocear sin marcar aquí)

> **POR QUÉ EXISTE ESTE BLOQUE.** Al trocear tareas se pierden requisitos por el camino. Aquí quedan
> los **once puntos (A–K)** del dueño, **enteros, literales y en un solo sitio**, ANTES de construir
> nada. **Esta tarea no construyó ni una línea de producto.**
>
> **AJUSTE (23 ago 2026): hoy el bloque tiene CATORCE fichas, no once.** A los once del dueño se
> sumaron tres nacidas después y con el mismo rango: **C-0** (Paso 0 de C, 21 ago), **L** (cola de
> envíos, 21 ago) y **M** (lo que se dictó de viva voz, 21 ago). El recuento vigente cuenta las
> catorce; la frase «los once puntos (A–K)» describe **el origen del bloque**, no su contenido de hoy.
>
> **CÓMO SE USA.** Cada ítem lleva su estado — **PENDIENTE / EN CURSO / HECHO + hash**. Cuando una
> tarea se cierre **se marca AQUÍ**; la línea **no se borra**. Ningún trozo de A–K se da por
> entregado si no está marcado en este bloque.
>
> **SE AÑADE, NO SUSTITUYE.** Lo que ya había en el TABLERO (Verifactu, Peldaño 8, contabilidad,
> deuda de comprobaciones, TAREA 3) sigue vivo y sin tocar.
>
> **LAS MARCAS ⚙️ CORREGIDO** salen del PASO 0 de esta sesión (auditoría de **solo lectura**,
> 21 ago 2026, sobre el código de hoy — `76a22a8`). El texto del dueño se copia **entero** y el dato
> real va **debajo**, marcado. No se ha reescrito ni una palabra suya, y nada falso queda escrito
> como si fuera cierto.

**RECUENTO — al registrarse (21 ago 2026): 11 ítems (A–K) · 46 subpuntos.**
`A 8 · B 3 · C 11 · D 5 · E 4 · F 4 · G 5 · H 3 · I 3 · J 0 · K 0` = **46**.
(J y K son ítems bloqueados sin subpuntos: su texto es una sola afirmación.)

**RECUENTO VIGENTE — 24 ago 2026: 65 subpuntos vivos · 65 resueltos · 0 PENDIENTES CONSTRUIBLES.**
**De A a M no queda nada que programar.** Lo que sigue vivo son tres cosas que NO son tareas:
**G5** (el «etc» del dueño, abierto a propósito por decisión suya) y **J y K**, bloqueados fuera del
código. Los 4 retirados siguen retirados, con su motivo en su sitio.

> ~~**RECUENTO VIGENTE — 23 ago 2026 (cierre de la ficha D): 65 subpuntos vivos · 54 hechos ·
> 11 pendientes.** Pendientes: **E 4 · G 4 · I 3** = 11.~~
> **⚙️ CADUCADO Y CORREGIDO EL 24 AGO 2026.** No se borra: es el registro de qué se creía y cuándo.
> **El motivo, medido:** esta cabecera se escribió el 23 ago a las **15:59** (commit `2bee917`), y
> esa misma noche se cerraron los tres que declaraba pendientes — **G a las 20:56** (`1ccc49c`),
> **E a las 20:58** (`28ac712`) y **I a las 21:28** (`9e43ce0`)—. Nadie volvió a subir a la cabecera.
> Es EXACTAMENTE la avería contra la que se escribió la regla de `CLAUDE.md` («Un titular de recuento
> se corrige con el cuerpo que lo desarrolla»), esta vez **al revés**: el cuerpo se actualizó y el
> titular se quedó atrás. Una cifra vieja en la primera línea de un registro hace creer que quedan
> once tareas donde no queda ninguna, y manda al siguiente chat a trabajar sobre humo.
>
> **La prueba de cada cierre, para que no haya que fiarse de esta línea:**
> · **E — 4 de 4.** Commit `c3b2d6a`, comprobación `gate-inicio-widgets` (30 ✓), dentro del barrido.
> · **G — G1 y G2 hechos.** `gate-portal-ampliado` (35 ✓), dentro del barrido. G3 estaba retirado
>   desde el 21 ago por estar ya hecho; **G4 no es de G: es la ficha J**, bloqueada por falta de
>   pasarela; **G5 queda abierto a propósito**, no es construible.
> · **I — 3 de 3.** `gate-tarjeta-unica` (24 ✓), dentro del barrido.

*(**la ficha D entra entera, 5 de 5** — D1 y D4 eran la misma pieza y se cerraron con el área de
agenda; D2, D3 y D5 completos. 49 + 5 = 54 hechos · 16 − 5 = 11 pendientes.
~~Pendientes: **E 4 · G 4 · I 3** = 11.~~ — **caducada esa misma noche: 0, ver arriba.**
Vivos siguen siendo 65.)*
*(**la ficha F entra entera, 4 de 4** — el mapa lo escribió otra sesión y quedó sin commitear;
se revisó, se ejecutó su gate por primera vez y se cerró. 45 + 4 = 49 hechos · 20 − 4 = 16
pendientes. ~~Pendientes: **D 5 · E 4 · G 4 · I 3** = 16.~~ — **caducada el mismo 23 ago al cerrarse
la ficha D: 11, sin D.** Vivos siguen siendo 65.)*
*(**H1 se cierra por decisión del dueño esa noche**: las facturas NO entran por CSV y se quedan en la
migración asistida. Con eso **H queda entera, 3 de 3**, y sale de la lista de pendientes.
44 + 1 = 45 hechos · 21 − 1 = 20 pendientes. ~~Pendientes: **D 5 · E 4 · F 4 · G 4 · I 3** = 20.~~
— **caducada ese mismo cierre al entrar F: 16, sin F.**)*
*(**rehecho entre las dos entregas del 23 ago**, como pedía el aviso de más abajo: la sesión del
importador de CSV lo dejó en 41/24 sumando H2 y H3, y **la ficha B entera —B1, B2 y B3— suma 3 más**.
41 + 3 = 44 hechos · 24 − 3 = 21 pendientes. ~~Pendientes: **D 5 · E 4 · F 4 · G 4 · H 1 · I 3** =
21.~~ — **caducada esa misma noche al cerrarse H1: 20, sin H.**)*
*(el 22 ago iba por 39 hechos · 26 pendientes; **H2 y H3** entran hoy con el importador de CSV.
~~**H1 NO se cuenta como hecho**: clientes y productos están, las facturas quedaron paradas a la
espera de la decisión del dueño, y media entrega no es una entrega.~~ — **la decisión llegó esa misma
noche y H1 se cierra**: las facturas se quedan en la asistida. La línea se tacha, no se borra: era
cierta mientras la decisión no existía, y es el registro de que se paró antes de construir.)*
*(el 21 ago iba por 31 hechos · 34 pendientes; **C entera** suma sus 8 restantes)*
`A 6 · C 12 · C-0 4 · B 3 · D 5 · E 4 · F 4 · G 4 · H 3 · I 3 · J 0 · K 0 · L 8 · M 9` = **65**.
- **C pasa de 11 a 12** con **C10-f**, que Ibrahin añadió el 21 ago tras cerrar C-0. ~~Los pendientes
  suben de 37 a 38~~ — **línea caducada, corregida el 23 ago 2026:** ~~los pendientes de hoy son
  **26**~~ **→ 24 tras el importador de CSV, esa misma tarde**; y esta cifra ya se contradecía con la de dos líneas más abajo («quedan 37 pendientes») el mismo día
  en que se escribió. Lo que sigue siendo cierto y por eso no se borra: **el subpunto es nuevo, no
  estaba antes sin marcar.**
- **4 RETIRADOS**, con su motivo escrito en su sitio y **sin borrar la línea**: **A3** y **A6**
  (premisas falsas, las tumbó la auditoría del encargo 0), **G3** (ya estaba hecho) y **L1** (la
  pantalla ya traía el armazón del panel: lo tumbó el Paso 0 de la tarea L).
- ~~**27 HECHOS:** los 6 de **A** · los 9 de **M** (las dos entregas que se dictaron de viva voz) · los
  8 vivos de **L** · y los **4 de C-0**. Todos del 21 ago 2026.~~ — **línea caducada, corregida el
  23 ago 2026:** se quedó sin **los 12 de C**, cerrada el 22 ago. ~~**Son 39 HECHOS:** los 6 de **A** ·
  los **12 de C** (22 ago) · los **4 de C-0** · los 8 vivos de **L** · los 9 de **M**~~ — **corregida
  otra vez el 23 ago por la tarde: son 41 HECHOS**, los mismos de antes **+ H2 y H3** (importador de
  CSV)~~ — **y otra vez esa noche: son 45**, sumando **los 3 de B** (otra sesión) **y H1**, cerrado
  por decisión del dueño. Los cuatro grupos del final, del 21 ago 2026.
- **C-0 no estaba en el encargo original** y nace del Paso 0 de **C**: sanear los documentos antes de
  construir el motor de listados encima. ~~**C sigue entero y pendiente**~~ — **línea caducada,
  corregida el 23 ago 2026: C quedó CERRADA el 22 ago, 12 de 12** (commits `575e333`, `c3302f5`,
  `5e05738`). Lo que sigue siendo cierto: C-0 le quitó el andamio podrido de debajo, no le hizo el
  trabajo.
- ~~Quedan **37 pendientes** —los de B a I—~~ ~~**quedan 26 pendientes** (B 3 · D 5 · E 4 · F 4 ·
  G 4 · H 3 · I 3)~~ y **2 bloqueados** (J y K), que no dependen de Ibrahin. **Corregida otra vez el
  23 ago 2026 por la tarde, al entregar el importador de CSV: quedan 24 pendientes**, y siguen siendo
  «los de B a I» — **B 3 · D 5 · E 4 · F 4 · G 4 · H 1 · I 3**. H baja de 3 a 1: se cierran H2 y H3,
  y el único que queda vivo es **H1, solo en su parte de facturas**~~ — **y esa noche también se
  cierra: quedan 20, D 5 · E 4 · F 4 · G 4 · I 3. H sale de la lista.** Los bloqueados siguen siendo 2.
  ~~⚠️ **Si otra sesión cierra B el mismo día, este recuento hay que rehacerlo entre las dos
  entregas.**~~ — **pasó, y está rehecho (23 ago, tarde): B se cerró entera esa misma tarde en otra
  sesión, así que quedan 21 pendientes — D 5 · E 4 · F 4 · G 4 · H 1 · I 3.** B sale de la lista.
  El aviso cumplió su función y por eso se tacha en vez de borrarse.
  ~~**Y una tercera vez esa misma noche, que es el día que más manos ha tenido este tablero: cerrada
  H1 y cerrada F, quedan 16 — D 5 · E 4 · G 4 · I 3.**~~ Tres sesiones distintas movieron el recuento
  el 23 de agosto; cada una lo rehízo sobre lo que encontró, en vez de sobre lo que recordaba.
  **⚙️ Y UNA CUARTA, EL 24 AGO 2026: quedan CERO.** La cifra de 16 —y la de 11 que la sustituyó tres
  horas después— caducaron esa misma noche, cuando **una cuarta sesión cerró D, E, G e I** y no subió
  a rehacer la cabecera. **Hoy A–M no tiene ni un pendiente construible:** queda **G5**, abierto a
  propósito por el dueño, y **J y K**, bloqueados fuera del código. Los tres cierres, con su prueba,
  están en el recuadro del principio de este bloque.
- **A1, A4 y A7 fueron REESCRITOS** por el dueño antes de construirse; el recuento no cambia por eso
  (siguen siendo los mismos subpuntos), solo cambia lo que piden.
- **L nace con 9 subpuntos y se queda con 8 vivos** (L1 retirado). **M nace con 9, los 9 hechos.**

**⚙️ SANEAMIENTO DE ESTA CABECERA — 23 ago 2026 · commit `9a6fc0f`. Cero código de producto.**
Salió de una lectura del tablero pedida por Ibrahin, no de un fallo del producto. **El titular
—«65 vivos · 39 hechos · 26 pendientes»— estaba bien; lo que estaba mal era el cuerpo que lo
desarrolla**: cuatro bullets se quedaron sin actualizar cuando C se cerró el 22 ago, y llevaban un día
contradiciendo a su propio titular tres renglones más arriba. Los cuatro quedan **tachados con su
motivo y su fecha, nunca borrados** (el método de la ficha C). Se ajustó además «los once puntos
(A–K)» a las **catorce fichas** que hay hoy. Y de aquí sale una **regla permanente en `CLAUDE.md`**
(«Un titular de recuento se corrige con el cuerpo que lo desarrolla»): al cambiar una cifra que
resume, en la misma entrega se revisa el detalle que la explica.

---

### PASO 0 — AUDITORÍA DE SOLO LECTURA (21 ago 2026). Cero código tocado.

#### 0.1 · La migración asistida

- **(a) ¿Dónde vive?** Pantalla: **`/admin/migracion`** — `modules/erp/routes/migracion.js`, montada en
  `modules/erp/routes/index.js:148`. API: **`/api/erp/migracion`** (`GET` listar, `POST` pedir),
  montada en `index.js:210`. Tabla **`migracion_peticiones`**, aditiva y **fuera de
  `WRITABLE_TABLES`**. El `POST` guarda la petición, manda correo al equipo con el adjunto (máx.
  12 MB) y acusa recibo en pantalla y por correo — **y guarda aunque el correo falle** (`email_ok`).
  Todo lo que decía el encargo sobre esta pieza es **cierto**.
- **(b) ¿Tiene entrada en el menú? ¿En qué área?** **NO.** No hay ni una entrada en `MENU`
  (`modules/erp/menu.js`) que apunte a `/admin/migracion`, y la clave `migracion` **tampoco existe en
  `NAV_PERMS`**. Como el buscador (Ctrl/⌘+K) y las anclas del rail comen de esa misma lista, la
  migración **no se puede buscar ni anclar**. Tampoco está en las URLs permitidas de DISA
  (`DISA_ALLOWED_URLS`, `modules/disa/index.js:2513`), así que **DISA no puede enlazarla** en un
  artifact aunque se lo pidas.
- **(c) Caminos reales que existen HOY — son DOS, y los dos tienen pega:**
  1. **Panel «Pon en marcha tu negocio»** en el Inicio (`/admin`) — paso *«Trae tus datos del programa
     anterior»*, CTA *«Pedir la migración»* (`modules/erp/arranque.js:97`). **Pegas:** el panel
     **nace plegado** en cuanto el negocio tiene actividad real (una factura o una cita —
     `hayActividad`), así que hay que desplegarlo; y **el paso deja de ser un enlace en cuanto está
     hecho**: un paso `done` se pinta como `div`, no como `<a>`
     (`modules/erp/views/disaHome.html.js:964`). O sea: **pides la migración una vez y la puerta se
     cierra sola.**
  2. **Ajustes → Configuración Empresa** (`/admin/settings`), tarjeta *«Trae tus datos del programa
     anterior»*, botón *«Pedir la migración»* (`modules/erp/routes/settings.js:546`). Es la puerta
     **fija**, y se creó justamente porque la otra se plegaba. **Pega:** vive dentro de
     `bloqueEmpresa`, que **solo se pinta con `company.read`**, y la entrada «Ajustes» del rail está
     además limitada a `owner` por `ROLE_FILTERS`.
  - **No hay ningún tercer camino.** Barrido de todo el repo: las únicas referencias a
    `/admin/migracion` fuera de esos dos sitios están en dos gates (`gate-inicio-cuadro-mando.mjs`,
    `gate-inicio-arranque.mjs`), que no son producto.
- **(d) ¿Qué permiso exige? ¿Llega un dueño nuevo sin que le pasen la dirección?**
  La **vista** exige **`company.read`** (`migracion.js:167`); el **envío** exige **`company.update`**
  (`migracion.js:60`). Un **dueño** (`owner`) los tiene los dos, así que **SÍ llega solo** — pero solo
  por los dos caminos de arriba, y **solo mientras no haya pedido la migración ya**: hecho el paso,
  le queda únicamente la tarjeta de Ajustes. Un **empleado sin `company.read`** no llega por ninguno.

#### 0.2 · Las «tres pantallas sin enlace»

Son las de **U7 (8 jul 2026)**: **`/admin/analytics`**, **`/admin/discounts`** y **`/admin/tags`**
(TABLERO §U7 y §«Cola del Eje A»; `docs/backlog-auditoria.md:315`, marcada ⚑ *«se abordarán luego»*).

- ⚙️ **CORREGIDO: hoy ya no son tres, son DOS.** **`/admin/analytics` se reenganchó al menú el
  17 jul 2026** (área «Analítica» → «Informes», `menu.js:209`; consta en el propio TABLERO).
  ~~**Siguen sin enlace `/admin/discounts` y `/admin/tags`** (montadas en `routes/index.js:129` y `:142`,
  ausentes de `MENU`). Las dos solo aparecen en la lista blanca de URLs de DISA, que no es un enlace
  de la interfaz.~~ **⚠️ ESTO ERA CIERTO EL 21-AGO Y DEJÓ DE SERLO EL 23-AGO. Hoy no queda ninguna:**
  `/admin/tags` se enganchó al menú (B2) y `/admin/discounts` se **DESMONTÓ** (encargo CUPONES, `9e77f2b`) —
  ya no está montada en `routes/index.js`, y **se retiró también de la lista blanca de URLs de DISA**,
  junto con su lectura, su escritura y sus tres acciones.
- **La migración es una CUARTA, no una de esas tres.** No estaba en la lista de U7 porque **no
  existía** entonces: se construyó el **19 ago 2026**.
- **Y hay más pantallas fuera del menú, pero por diseño y con camino propio** — no son huérfanas:
  `/admin/avisos` (se llega desde la campana, `layout.js:1400`), `/admin/purchase-order-receipts`
  (desde órdenes de compra), `/admin/change-password` (pantalla-cerrojo), `/admin/security` (solo
  redirige a `/admin/perfil`) y las subpantallas de Ajustes (`/plantillas`, `/avisos`,
  `/situacion-fiscal`). **Se dejan anotadas para que B2 no las confunda con el problema.**

#### 0.3 · Impresión y PDF

- **(a) ¿Motor de plantillas reutilizable, o cada PDF cableado?** **Las dos cosas, a medias.**
  - **Lo que SÍ es reutilizable y único:** **`core/pdf.js` → `renderPdfFromHtml()`** es el **único
    punto de la plataforma que produce un PDF** (Chromium en singleton) y es *document-agnostic*; y
    **`printableShell(bodyHtml,{title})`** (`modules/erp/layout.js:1611`) le pone el envoltorio A4 con
    la maquetación de pantalla. Eso ya es una **fuente única de RENDERIZADO**.
  - **Lo que está CABLEADO:** el **cuerpo** de cada documento es una función propia por documento —
    `quoteDocumentBodyHtml`, `orderDocumentBodyHtml`, `albaranDocumentBodyHtml`, `buildInvoicePaper` —
    y los informes contables tienen las suyas (`libroHtml`, `diarioHtml`, `mayorHtml`). **No existe
    ninguna abstracción de LISTADO** (columnas, cabecera, filtros aplicados, totales, paginación) ni
    ningún concepto de «plantilla de documento» configurable.
  - **Prior art para C10:** sí hay un motor de plantillas **de correo** con huecos `{{asi}}`,
    editable por el dueño (`modules/erp/email-templates.js`, U9). Es de EMAIL, no de documento, pero
    es el patrón «plantilla = dato, no código» que C10 pide.
- **(b) ¿Se puede HOY imprimir o descargar un LISTADO?** **Parcialmente, y en ningún sitio con los
  tres verbos.**
  - **PDF real de listado — SÍ, solo en Contabilidad** (`/admin/contabilidad`,
    `modules/erp/routes/contabilidad-routes.js`): **libro de ventas, libro de compras, diario y
    mayor**, cada uno en **XLSX + CSV + PDF**. Cada informe con **su HTML escrito a mano** — que es
    exactamente lo que C10 viene a matar.
  - **CSV sin PDF — Analítica** (`/admin/analytics`): `ventas.csv`, `rentabilidad.csv`,
    `informes.csv`, `productos.csv`, `clientes.csv`. Y **Conciliación**: `export.xlsx` / `export.csv`.
  - **NADA en:** clientes, productos, compras, gastos y **kardex**. El kardex existe **solo como
    modal por producto** (`modules/erp/views/stock-modal.js`, motor `stock.js:170`) y **no se
    imprime ni se descarga**.
  - **Imprimir (`window.print()`) — solo en DOCUMENTOS**, nunca en un listado: factura,
    presupuesto, pedido, albarán, orden de compra y ticket. Y el `@media print` del layout
    (`layout.js:1173`) está escrito **para `.docpaper`**: en una pantalla de listado, un Ctrl+P
    imprime la tabla en crudo, sin plantilla, sin cabecera y sin pie.
  - **Enviar por correo** existe **por documento** (factura, presupuesto, orden de compra, enlace del
    portal), **nunca para un listado**.
  - ⚙️ **CORREGIDO de paso:** la descarga de `/admin/users` **no es un listado**: es el **backup de
    la base de datos** del negocio (`routes/users.js:198`, permiso `backup.download`).

---

### LOS ONCE ÍTEMS — texto literal del dueño

## GRUPO 1 — DEFECTOS DE LO YA CONSTRUIDO

#### A. CALENDARIO — VISTA MES · ✅ **HECHO (21 ago 2026)** · commit `fcf07db`

> **⚠️ EL ENCARGO DEL 21 AGO SUSTITUYÓ PARTE DE ESTE ÍTEM.** Con la auditoría del encargo 0 delante
> (`f6c864c`), Ibrahin **reescribió A1, A4 y A7** y **RETIRÓ A3 y A6**. Abajo va el texto VIGENTE,
> literal. El original no se borra: queda debajo, en «lo que decía antes», porque el registro sirve
> justo para que no se pierda por el camino lo que se dijo.

> **A. CALENDARIO — VISTA MES.**
> **A1 — EL PIE DICE SU BASE (sustituye al A1 original).** El número 168 es CORRECTO: 720 min (8:00–20:00) × 14 personas = 10.080 min = 168 h. Comprobado. NO se toca el cálculo. Lo que falla es que el dueño no puede saber que está leyendo capacidad de equipo y no horario del día. Regla, la misma que CANON ya impone a los márgenes: TODA CIFRA DEBE DECLARAR SU BASE. · Negocio de UNA persona → «sin citas · 12 h libres» · Negocio CON EQUIPO → la ocupación manda y la capacidad va detrás, explícita: «sin citas · 0 % ocupado (168 h libres entre 14 personas)» · Día CERRADO → «Cerrado». Nunca «0 h libre». El texto exacto lo eliges tú según el espacio real, pero la BASE debe ser legible sin abrir nada. Prohibido dejar un número desnudo. La segunda mitad del A1 original (que huecos() ya dice «sin hueco libre») está HECHA. No la rehagas.
> **A2 — UN SOLO SELECTOR DE VISTA.** Se queda el grupo de botones Día/Semana/Mes de arriba (patrón de Google Calendar, Outlook y Fresha). Desaparece el desplegable duplicado de la barra de abajo. «Por puesto» y «Ver todo el equipo» SE QUEDAN: no son duplicados.
> **A3 — RETIRADO.** Premisa falsa del encargo original: ese pie NO es un resto de la vista Día colándose en Mes; es el pie PROPIO de la vista Mes, y la vista Día ni siquiera tiene uno. Se queda donde está. NO lo quites.
> **A4 — EL GRIS DEJA DE SIGNIFICAR TRES COSAS (sustituye al A4 original).** No hay «regla de negrita» que borrar: el negro es lo que queda cuando el gris se lleva el resto. El defecto real es que hoy el MISMO gris dice tres cosas y el dueño no las distingue: (a) día de otro mes · (b) fin de semana · (c) día cerrado. Deja los tres estados VISUALMENTE DISTINTOS entre sí, y distinguibles también en blanco y negro (no confíes solo en el color): (a) fuera del mes → el más apagado, y no acepta citas · (b) fin de semana ABIERTO → se lee como día normal. Hoy se pinta gris y eso es MENTIRA: una peluquería que abre sábado tiene ahí su mejor día · (c) cerrado → marca propia e inequívoca (fondo o trama), NO el mismo gris que (a). Un día cerrado debe leerse «cerrado», no «no es de este mes». HOY sigue siendo el único destacado. El círculo rojo actual vale.
> **A5 — LAS FILAS REPARTEN EL ALTO.** Hoy las filas de semana tienen alto fijo y un mes casi vacío es una pared en blanco. Un mes de 5 semanas pinta 5 filas y reparte el alto disponible entre ellas. Un mes de 6 semanas pinta 6. Nada de fila muerta.
> **A6 — RETIRADO.** El sombreado de la celda del día 19 NO se reproduce desde el código. No lo persigas y NO inventes un arreglo. Si vuelve a aparecer, se abre tarea propia con captura.
> **A7 — SOLO LA MITAD QUE FALTA (reducido).** YA ESTÁ HECHO: hora, cliente, punto de estado y tope de 3 citas por celda. No lo rehagas. FALTA y hay que construir: · El SERVICIO junto al cliente. Si no cabe entero, se recorta el nombre del SERVICIO antes que el del cliente. · «+N más» debe ABRIR EL DÍA al pulsarlo. Hoy no hace nada.
> **A8 — CREAR DESDE LA VISTA MES.** Pasar por encima de una celda ofrece «+ Nueva cita», con ratón y con teclado, y al pulsar abre la cita con ESE día ya puesto. Igual que ya funciona en la vista Día. En días CERRADOS y en días FUERA DEL MES no se ofrece.

**QUÉ SE ENTREGÓ, PIEZA A PIEZA** — todo en `modules/erp/routes/citas.js`:

- **A1 · el número no cambia; ahora dice de dónde sale.** El cálculo (`Σ personas (tramosPersona −
  ocupacionPersona)`) queda **intacto**. Lo que viaja además son las dos cifras que lo explican
  —`capacidad_min` y `personas_abiertas`—, sacadas **del mismo bucle** que ya calculaba los huecos,
  así que no hay una segunda fuente que pueda desviarse. La pantalla decide qué decir:
  una persona → «**9 h libres**» · con equipo → «**0 % ocupado (168 h libres entre 14 personas)**» ·
  cerrado → «**Cerrado**», y la cadena «0 h» no aparece en ningún sitio. Con **una sola** persona
  **no se declara base**: «entre 1 personas» sería ruido, no información.
- **A2 · un mando, no dos.** Fuera el `<select>` de «Filtros». La vista deja de vivir en el `value`
  de un elemento del DOM y pasa a ser **estado** (`AG_VISTA`), que es lo que era. Se guarda en
  `agPrefs` con **la misma clave que antes**, así que a nadie se le pierde su preferencia.
  «Por puesto» y «Ver todo el equipo» siguen donde estaban.
- **A4 · tres estados, tres caras, y ninguna depende solo del color.** Fuera del mes = tinta plana
  apagada · **cerrado = trama diagonal** (se distingue en escala de grises y con daltonismo) ·
  **fin de semana abierto = un día normal**, sin apagar. El `finde` desaparece como estado visual:
  lo que decide la cara de un día es **si está abierto**. HOY sigue siendo el único destacado.
- **A5 · la rejilla tiene alto total y las filas se lo reparten.** `grid-template-rows:repeat(N,1fr)`
  con N = semanas reales. Medido: 6 semanas → 6 filas de 90 px · 5 semanas → 5 filas de **108 px**,
  y los dos meses ocupan **540 px exactos**. Ya no hay pared en blanco ni fila muerta.
- **A7 · el servicio, de la misma función que lo escribe en la vista Día** (`serviciosDeCita`): no
  hay un segundo texto del servicio que pueda decir otra cosa. Y **cuando no cabe cede el servicio,
  no el cliente** — el cliente toma su ancho (`flex:0 1 auto`) y el servicio vive de lo que sobra
  (`flex:1 1 0`). El **«+N más» abre el día** al pulsarlo.
- **A8 · crear desde el mes**, con ratón y con teclado, heredando el día de la casilla. No se ofrece
  en días cerrados ni en días de otro mes, y **no existe en el DOM** para ellos: no hay nada que
  esconder.

**LO QUE EL PROPIO GATE DESTAPÓ, Y ERA MÍO.** La primera versión de A8 tapaba la casilla **entera**
(`inset:0`). Con el ratón encima, ese panel **se tragaba todos los clics de la casilla**: dejaba de
poderse pulsar «+N más», seleccionar el día y abrirlo con dos clics. Un botón nuevo no puede comerse
los que ya había. Ahora es una **pastilla en la esquina de arriba a la derecha** —la única que
siempre está libre, porque el número vive a la izquierda—, como en Google Calendar.

**VERIFICACIÓN — `gate-citas-mes`: 56 aserciones, 0 fallos, 19 s, contra `https://<slug>.bamburu.com`.**
Ni barrido corto ni completo: el encargo pedía **este gate y solo este**.
- **PRUEBA DE REVERSIÓN, las seis piezas por separado** (deshacer → desplegar → repasar → restaurar).
  Cada una tumba lo suyo, y **ninguna aserción sobrevivió a que le quitaran el producto de debajo**:
  **sin A1 → 9 rojos · sin A2 → 2 · sin A4 → 2 · sin A5 → 3 · sin A7 → 4 · sin A8 → 7.**
- **Y la reversión arregló dos aserciones mías, no el producto:** al quitar A7 y A8 el gate **moría
  con una excepción** en vez de dar rojo, y una excepción se lleva por delante todos los bloques que
  vienen detrás — o sea que habría tapado regresiones ajenas al fallo. Endurecidas con guardas: hoy
  las dos reversiones dan **rojo limpio y el gate llega al final** (52+4 y 49+7 de 56).

**⚠️ DOS GATES AJENOS TOCADOS, Y SIN REEJECUTAR.** `gate-agenda-calendario` y `gate-agenda-visual`
leían y escribían `document.getElementById('agVista').value`, que **A2 retira**: se han pasado a
`vistaActual()` / `setVista()`, sin cambiar ni una aserción. Y en `gate-agenda-visual` se ha
**reescrito una aserción que A4 deja falsa** —exigía que el fin de semana fuera marcado, y ahora un
sábado abierto tiene que leerse como un día normal—; pasa a exigir lo que sí se distingue: otro mes y
cerrado. **Los dos están en el barrido y NO se han vuelto a correr** (el encargo autorizaba un solo
gate): su estado hoy es **sin verificar**, y hay que pasarlos en el próximo barrido.

**⚠️ ANOTADO Y NO ARREGLADO — «permiso sobre agenda ajena» NO EXISTE en el producto.** La
comprobación 17 del encargo lo daba por supuesto. Hoy la agenda tiene **un solo candado, `citas.read`**
(más `citas.edit` para escribir): quien lo tiene ve las citas de todo el mundo. El gate verifica, en
la **respuesta del servidor**, las dos cosas que sí existen — sin `citas.read` el servidor devuelve
**403 y ni un nombre de cliente**, y el filtro por eje **se aplica en el servidor** (la cita de quien
no trabaja ese día no viaja, y con «ver todo el equipo» sí). **No se ha inventado un permiso nuevo:**
el encargo prohíbe expresamente tocar el sistema de permisos. Queda para decidir.

**⚠️ ANOTADO Y NO ARREGLADO — UN DÍA CERRADO ESCONDE LAS CITAS QUE SÍ TIENE.** Salió al mirar la
pantalla real del tenant de desarrollo, no de una aserción. **Medido en la respuesta del servidor**
(`/api/erp/citas/mes?ym=2026-08`, día 26, que está cerrado y tiene dos citas):
`verTodo=0` → `citas: 0` · `verTodo=1` → `citas: 2`. La causa es el filtro por eje, que en Mes deja
pasar solo a quien **trabaja** ese día (`personasQueTrabajan`) — y en un día cerrado **no trabaja
nadie**, así que se caen todas. **Es PREEXISTENTE** (el filtro se hereda de la vista Día y esta
entrega no lo toca) **pero ahora se nota más**, porque la casilla dice «Cerrado» con su trama encima
de dos citas reales. **Y las dos vistas no coinciden:** la vista Día, cuando no hay nadie trabajando,
cae a `META.personas` («nunca dejar la agenda sin columnas»), así que **allí sí se ven**.
**No se arregla aquí**: el PASO 2 del encargo deja el filtro y la vista Día fuera de alcance. Tarea
propia, y hay que decidir qué manda — que un día cerrado no enseñe nada, o que una cita se vea
siempre esté el negocio abierto o no.

**FICHA DE `gate-citas-mes` — DECLARADO, QUE NO ES LO MISMO QUE EJECUTADO.**
Se declara **el mismo día que nace** y no «cuando toque»: un gate fuera de `GRUPOS` **no lo ejecuta
nadie**, y cuatro comprobaciones de agenda llevaban semanas invisibles justo por eso. Entrar en el
mapa **no lo engancha a ningún disparador**: significa que el barrido lo alcanzará **cuando Ibrahin
lo pida**. Ningún barrido corre solo — ni corto, ni completo, ni antes de un commit.

| | |
|---|---|
| **Nombre** | `scripts/gate-citas-mes.mjs` |
| **Alcance** | Ya no es solo la vista Mes: cubre **el módulo de citas por la cara del dueño** (Mes, la barra de la agenda, los permisos y la pantalla de horarios). El nombre se conserva porque es el que está declarado en el mapa; renombrarlo es otra tarea. |
| **Aserciones** | **130** (0 fallos el 21 ago 2026; nació con 56 y creció con cada ronda de correcciones sobre pantalla) |
| **Duración** | **~55 s** |
| **Clase** | **propio** (`EMPIEZAN_DE_CERO`) — levanta **dos negocios suyos** con `provisionTenant` (uno de 1 persona, otro de 14) y los borra al salir. No toca el negocio compartido, así que **puede correr en paralelo**: no necesita ir solo. |
| **Grupo** | `clientes` — el barrido pasa de **78 a 79** comprobaciones |
| **Qué vigila además** | El rótulo del «Alto», la ventana de colores, el aire del pie y de las iniciales, el arrastre en Mes (ratón **y** dedo, comprobado en la BASE), el salto de fecha por meses y años, el candado `citas.ver_todas` en las cuatro puertas, y **la pantalla «Cuándo abro» entera** (atajos, interruptor por día, memoria de horas, copiar, el resumen en una frase y que aplicar no escriba en la base). |
| **Contra** | `https://<slug>.bamburu.com` (la dirección pública, no `:3000`) |
| **Depende del reloj** | **No.** La vista Mes no llama a `huecos()` (que descarta lo anterior a «ahora») sino a `tramosPersona`/`ocupacionPersona`, que no miran la hora. Da lo mismo a las 9:00 que a las 23:00. |
| **Cuota de IA** | No la usa. |

**TABLA `AFECTA` — qué lo despierta en modo corto.** No hace falta regla nueva: la que ya existe,
`/^modules\/erp\/(routes\/(dashboard|inicio|clients|crm|cobros|citas|menu-routes|migracion|vigia)|views\/)/ → clientes`,
cubre `modules/erp/routes/citas.js`, que es donde vive **todo** lo que este gate mide (el endpoint
`/api/erp/citas/mes`, el CSS del mes y `renderMes`). Se comprobó ejecutando la regla contra la ruta
real, no leyéndola. La segunda red —el grafo de imports— también lo alcanza por `citas-engine.js` y
`citas-avisos.js`.

<details><summary><b>Lo que decía antes (encargo del 21 ago, versión original — se conserva)</b></summary>

> **A1** El pie del día dice "168 h libre" en un día suelto. 168 = 7x24. Las horas libres deben calcularse sobre el HORARIO DE APERTURA DEL NEGOCIO de ESE día. Si cierra, dice "Cerrado", no "0 h libre".
> **A3** El pie de la vista Dia no debe pintarse en vista Mes.
> **A4** Dias 7, 14, 20 y 28 en negrita sin criterio. Regla unica: fuera de mes en gris claro; dias del mes en normal; HOY unico destacado; dias con citas se distinguen por sus citas, NO por el numero en negrita.
> **A6** La celda del 19 sale sombreada sin motivo. Reproducir antes de arreglar; si no se reproduce, decirlo y NO inventar arreglo.
> **A7** Cada cita de la celda debe mostrar HORA + CLIENTE + SERVICIO con color de estado. Tope 3 por celda y marcador "+N mas" que abre el dia.

**Por qué cambiaron:** la auditoría del encargo 0 midió que el 168 era correcto (14 personas × 12 h,
no 7×24), que no existe ninguna regla de negrita (era contraste), que el pie es de la propia vista
Mes y que media A7 ya estaba construida. El dueño reescribió el encargo con ese dato delante.

</details>

---

---

#### A-bis. LA VISTA MES, CORREGIDA SOBRE PANTALLA · ✅ **HECHO (21 ago 2026)** · commit `3200899`

> **Siete correcciones de Ibrahin mirando la entrega ya desplegada**, más los cabos que la propia
> entrega había dejado anotados. Sigue siendo TAREA TRANSVERSAL: el puntero del Peldaño 8 no se mueve.
> Se deja fuera **solo el barrido**, por orden expresa suya.

**1 · «HAY BOTONES S, M, L Y NO ENTIENDO QUÉ SON».** Eran tres letras sueltas pegadas al selector de
vista: parecían un segundo selector. **No se quitan** (regla del menú: no se esconde ni se quita
nada), se **explican**: ahora se lee «**Alto** S M L», con su nombre delante, y en la vista Mes
desaparece el grupo entero — el alto de la hora ahí no significa nada.

**2 · «EL BOTÓN INFORMATIVO SERÍA MEJOR QUE SALGA UNA VENTANA».** Hecho. La (i) abría una **tira de
puntos encima de la agenda**: empujaba el calendario hacia abajo y no cabía una palabra de
explicación. Ahora abre **la misma ventana que usa el resto del panel**, con sitio para decir qué es
cada estado y no solo cómo se llama, más el día cerrado y el de otro mes. Los colores siguen saliendo
de `ESTADOS_COLOR`, la fuente única.

**3 · «LOS DÍAS MARCADOS NO SON CONSISTENTES, HAY ERROR».** ⚙️ **Tenías razón, y el error NO estaba en
la pantalla: estaba en los DATOS.** El rayado significa «cerrado», y tu negocio de desarrollo solo
abre viernes y sábado — por eso hay tanto. Pero el **20 de agosto (jueves) salía abierto**, y eso no
cuadra con nada. Al mirar la base apareció el motivo, y es peor de lo que parecía:

- Había una **excepción de horario con motivo «GATE agenda sencilla»** puesta sobre el 20 de agosto:
  basura que dejó una comprobación automática y que **nadie limpió**.
- Y tirando del hilo: **de las 14 personas «activas» del negocio de desarrollo, 10 eran fantasmas de
  gates** (`Gate dormidos` ×6, `Gate FH Worker` ×2, `GATE Ana`, `GATE Berta`). Personas de verdad: **4**.
- **Eso es lo que había detrás de las «168 h libres».** La cifra era correcta sobre datos falsos —
  12 h × 14 personas—, que es la peor clase de cifra: nadie la duda. Con las cuatro personas reales
  son **48 h**.
- **POR QUÉ SE ACUMULA:** un gate que muere por `process.exit` —el aborto de `gate-env`, un timeout,
  un kill— **no ejecuta su `finally`**, así que se deja su empleado y su excepción. Y **ningún paso
  de `limpiar-residuo-gates.mjs` miraba `admin_users`**: el residuo de personas no lo limpiaba nadie.
- **ARREGLADO EN LOS DOS SITIOS:** limpiado el negocio de desarrollo (las personas **desactivadas**,
  `active=0`, no borradas — tienen citas y facturas detrás; las excepciones de horario **sí** se
  borran, que son reglas de calendario y no datos con historia), y **añadido el paso 3c a
  `limpiar-residuo-gates.mjs`** para que no se vuelva a acumular. Reconoce el residuo por su correo
  de laboratorio o su nombre de gate — **nunca por fecha**.

**4 · «EL DÍA, EL PORCENTAJE Y ABRIR DÍA, MUY PEGADO DEL MARGEN INFERIOR».** Hecho. El pie tenía
`padding-top` y nada más: el texto rozaba el filo de la tarjeta. Ahora respira por los cuatro lados
(15 px por abajo) y se apoya en un fondo propio, que lo separa de la rejilla sin necesidad de raya.

**5 · «EL CALENDARIO NO ES INTERACTIVO, NO PUEDO ARRASTRAR CITAS».** ⚙️ **Medido antes de tocar, y
son DOS cosas distintas:**
- En **Día y Semana el arrastre YA EXISTÍA** y funciona (medido en la pantalla real: 2 citas
  arrastrables, 364 zonas donde soltarlas, más el asa de estirar por abajo).
- En **Mes no existía NADA**: ni una cita se podía coger ni había dónde soltarla. **Construido**: se
  coge una cita de su casilla y se suelta en otro día — **cambia de día y conserva la hora** (una
  casilla de mes no tiene hora que imponer). El día de destino se marca mientras arrastras.
- **Y EL AGUJERO DE VERDAD, que explica por qué te parecía que no funcionaba en ningún sitio: el
  arrastre de HTML5 es un invento de RATÓN. Con el dedo no dispara NADA** — ni un evento, ni un
  error. En tableta o móvil la agenda parecía no dejar mover nada, y desde un ordenador funcionaba
  perfectamente. **Construido el camino del dedo** para las tres vistas: se **mantiene pulsado** (350
  ms, como en Google Calendar) y se arrastra. Empezar al primer roce obligaría a bloquear el scroll
  sobre cada cita, y entonces por una agenda llena no se podría bajar con el dedo.
- **Un solo camino de guardado** para el ratón y para el dedo, en las tres vistas: `onDrop` tenía su
  propia copia del cuerpo de la petición y ahora llama a la misma función. Dos copias de lo mismo se
  separan en cuanto alguien toca una.
- **Las iniciales L M X J V S D**: de 10,5 px pegadas al filo a **12,8 px con 13,6 px de aire arriba**.

**6 · «AL SELECCIONAR UN MES, LA NORMA ES QUE SALGAN MESES; SI PRESIONAS AÑO, LOS AÑOS».** Hecho.
Pulsar «Agosto 2026» abría **un campo de fecha del navegador**: para ver septiembre había que teclear
un día concreto de septiembre, que es justo lo que no se está buscando. Ahora pulsas y salen **los
doce meses**; pulsas el año de esa hoja y salen **los años, de doce en doce**; eliges y bajas otra
vez a meses. Se navega, no se teclea. El campo de fecha sigue existiendo **oculto**, porque es donde
vive el dato y de ahí lo leen la agenda y sus comprobaciones.

**7 · LOS CABOS QUE LA ENTREGA ANTERIOR DEJÓ ANOTADOS:**
- ✅ **Un día cerrado ya no esconde sus citas.** Se caían en el filtro por persona, que en un día
  cerrado no deja pasar a nadie. Ahora, cuando no trabaja nadie, no se filtra — igual que ya hacía la
  vista Día. La casilla dice las dos cosas: «**1 cita · Cerrado**». Y **un día cerrado con citas se
  puede abrir** (antes era una casilla muerta: se veían las citas y no había forma de llegar a
  ellas). Lo que sigue sin ofrecerse ahí es **crear**.
- ✅ **Los dos gates ajenos, REEJECUTADOS** (24 ago 2026). `gate-agenda-calendario` y
  `gate-agenda-visual` entraron en el barrido completo de esa noche. El primero pasó a la primera;
  el segundo estaba rojo **por el reloj, no por el código**: exigía que la agenda apareciera
  desplazada al abrir, y a primera hora del día del negocio no hay nada que subir (medido a las
  01:39, con la línea de «ahora» al 11 % del alto). Ya contemplaba el tope de abajo; ahora también
  el de arriba, y pasa. Su estado ya no es «sin verificar».
- ✅ **EL PERMISO DE «AGENDA AJENA», CONSTRUIDO** — preguntado y decidido por Ibrahin el 21 ago 2026:
  *«sí, cada uno ve solo la suya»*. Nace **`citas.ver_todas`**. Sin él, el servidor devuelve
  **únicamente las citas propias**, y **también las horas libres se calculan solo sobre las suyas**:
  decirle a alguien «168 h libres entre 14 personas» cuando no puede ver la agenda de esas catorce
  sería la misma fuga contada de otra manera. El candado se aplica en **cuatro puertas** —el mes, el
  día/semana, las **columnas** (un nombre de compañero en una cabecera ya dice quién trabaja hoy) y
  **la ficha por su número**, que responde 404 y no 403 (un 403 confirmaría que esa cita existe)—.
  Y se filtra **en el SQL**, no al pintar: lo que no se puede ver no sale de la base. **El dueño y
  los administradores lo tienen por bypass de rol**, así que a ellos no les cambia nada.
  **⚠️ AVISO PARA EL DESPLIEGUE:** a partir de ahora un **empleado** que no tenga ese permiso deja de
  ver la agenda de sus compañeros. Es lo pedido, pero **hay que avisar al equipo**, y se concede
  desde la pantalla de usuarios como cualquier otro permiso.

**VERIFICACIÓN — `gate-citas-mes` pasa de 56 a 103 aserciones, 0 fallos.**
- **Reversión de las NUEVE piezas nuevas por separado** (deshacer → desplegar → repasar → restaurar):
  sin la ventana de colores → 3 rojos · sin el aire del pie → 2 · sin las iniciales → 2 · sin el
  arrastre en Mes → 2 · sin el arrastre con el dedo → 3 · sin el salto de fecha → 1 · sin el rótulo
  «Alto» → 1 · sin el arreglo del día cerrado → 4 · **sin el candado de agenda ajena → 3, y uno de
  ellos es la fuga entera: la cita del compañero volvía a viajar y las horas pasaban a ser las de 15
  personas**.
- **Y el gate volvió a cazarme lo mismo que la vez anterior:** al deshacer la ventana de colores el
  gate **moría con una excepción** en vez de dar rojo. Tercera vez que aparece este patrón; los dos
  bloques nuevos que podían caer en él (la ventana y el salto de fecha) van ya con guarda.
- **Y una aserción mía estaba mal, no el producto:** esperaba 3 citas arrastrables en una casilla y
  hay 2, porque la tercera está **atendida** y una cita atendida no se mueve. Corregida, y la que no
  se puede coger tiene ahora su propia comprobación en vez de esconderse dentro de un número.

---

#### A-ter. «CUÁNDO ABRO», REHECHA · ✅ **HECHO (21 ago 2026)** · commit `b1094e7`

> Ibrahin, al llegar a la pantalla de horarios desde la vista Mes: *«aquí debes mejorar la visual,
> está hecha de muy mala calidad, también agregar cosas automáticas como abrir de lunes a viernes y
> no tener que marcar día a día, horario corrido, así como lo hace WhatsApp Business»*.

**LO QUE HABÍA.** Siete bloques iguales con un par de campos de hora sueltos y un «+ tramo». Para
decir «abro de lunes a viernes de 9 a 2» había que **repetir la misma operación cinco veces**. No
había forma de **cerrar un día** sin borrarle los campos a mano, ni de saber **de un vistazo** qué
horario tenía el negocio. Nada de eso era un fallo: era una pantalla **sin terminar**.

**LO QUE HAY AHORA:**

- **«PONLO DE UNA VEZ».** Atajos de un clic —**Lunes a viernes · Lunes a sábado · Todos los días ·
  Sábado y domingo**—, los siete días como chips por si quieres una combinación tuya, **horario
  corrido o mañana y tarde**, las horas UNA vez, y **«Aplicar a los días elegidos»**. Antes de
  aplicar se lee lo que va a quedar. Es el patrón de WhatsApp Business y de cualquier ficha de
  negocio (Google, Fresha).
- **APLICAR NO ES GUARDAR**, y es deliberado: los atajos rellenan el formulario y ya está; lo que
  escribe en la base sigue siendo el botón, y la pantalla **avisa mientras haya cambios sin
  guardar** (y al salir). Un atajo que escribiera solo convertiría un clic de más en un horario
  cambiado sin querer.
- **UN INTERRUPTOR POR DÍA.** Cerrar un martes deja de ser «bórrale los campos» y pasa a ser un
  clic. Y **cerrar no borra**: las horas se recuerdan y se le devuelven si lo vuelves a abrir —
  un interruptor que además borra castiga por probar.
- **«COPIAR AL RESTO»** en cada día. Lleva ese horario a los demás días **que abren**; no abre los
  que estaban cerrados, porque copiar un horario no es abrir un día.
- **EL RESUMEN EN UNA FRASE**, arriba del todo: *«Abres lunes a viernes de 9:00 a 14:00 y de 17:00 a
  20:00. Cierras sábado y domingo.»* Agrupa los días con el mismo horario y los nombra por su rango
  cuando son seguidos, como lo diría una persona. **Esto es lo que más faltaba**: la pantalla
  enseñaba catorce campos de hora y en ninguna parte decía, en un renglón, qué horario tienes.
- **LA VISUAL**, rehecha con los tokens del panel: tarjetas con cabecera, filas de día alineadas con
  su nombre y sus tramos, un interruptor propio (**no había ninguno en todo el panel**), botones
  pequeños con jerarquía, y las excepciones con nombres en cristiano («Cierro todo el día» / «Abro a
  otras horas») en vez de «cerrado / horario».
- **VALIDACIÓN EN PANTALLA:** un tramo que termina antes de empezar, o una tarde que empieza antes
  de acabar la mañana, se dicen **antes** de mandar nada al servidor.

**⚙️ UN DETALLE QUE SALIÓ AL MIRAR LA PANTALLA, NO DE UNA ASERCIÓN:** el control segmentado
(«Horario corrido / Mañana y tarde») **se veía sin estilo**, como texto suelto con un borde raro. El
CSS de `.segmented` vive en la hoja de la AGENDA, que esta pantalla no carga. Traído aquí, con las
mismas reglas, para que un segmentado se vea igual en todo el panel.

**VERIFICACIÓN — `gate-citas-mes` pasa de 103 a 130 aserciones, 0 fallos.** Bloque [27], con lo que
importa comprobado **contra la base**: que aplicar no escribe, que guardar sí, que reabrir un día le
devuelve sus horas, que copiar no abre días cerrados y que un tramo imposible no llega a la base.
- **Reversión de cinco piezas, una a una:** sin atajos → 6 rojos · sin interruptor → 5 · sin el
  resumen → 3 · sin «aplicar» → 4 · sin la memoria de horas → 2.
- **Y DOS ASERCIONES MÍAS ESTABAN MAL, las dos verdes por el motivo equivocado:**
  1. Comprobaba solo el PRIMER tramo del martes para decir que el tramo imposible no se guardó — y
     ordenados por hora, un 23:00 habría quedado el SEGUNDO y habría pasado igual. Ahora se exige
     que no esté en **ninguna** posición, y que ningún tramo de la base termine antes de empezar.
  2. Miraba si el tramo de tarde tenía el atributo `hidden`, **no si se veía**. Y no se veía… se
     VEÍA: `display:flex` le gana a `[hidden]`, que solo trae el `display:none` del navegador y con
     menos peso. **Lo cazó una captura, no el gate.** Arreglados los dos: el CSS y la aserción, que
     ahora mide la pantalla (`offsetParent`) y comprueba **las dos direcciones** del interruptor.
- **Y una tercera vez el patrón de siempre:** al deshacer los atajos y el interruptor, el gate moría
  con excepción al pulsar un botón que ya no existe. Esta vez no se parchea el sitio: nace el
  ayudante **`clic(page, sel)`**, que devuelve `false` en vez de tumbar la pasada, y se usa en todos
  los clics del gate.

#### B. MIGRACIÓN ASISTIDA SIN ACCESO VISIBLE · ✅ **HECHO (23 ago 2026)** · commit `b7b6706` · **3 de 3**

> **HECHOS (23 ago 2026): B1 · B2 · B3.** Solo la puerta: la migración **por dentro no se ha tocado**
> (`modules/erp/routes/migracion.js`, sin un solo cambio).
> - **B1 — ENTRADA PERMANENTE.** «Trae tus datos» es ahora una entrada **fija del rail**, al pie,
>   encima de «Ayuda y soporte» (`menu.js` → `FIJAS`). No es de un área porque no es del día a día de
>   ninguna: es lo PRIMERO que hace quien viene de otro programa. Sus dos puertas anteriores **siguen
>   donde estaban y ninguna depende de esta**: el paso del panel «Pon en marcha tu negocio» (que se
>   pliega con la primera factura) y la tarjeta de «Datos del negocio». Son **tres**, no una que
>   sustituye a dos.
> - **B1-bis — EL BUSCADOR, GRATIS Y NO TANTO.** El buscador rápido se alimenta de la MISMA lista que
>   el menú, así que la entrada aparece sola. Lo que **no** era gratis: `destinosBuscador` mandaba las
>   entradas fijas con `alias: []` **cableado**, de modo que solo se habrían encontrado tecleando su
>   nombre exacto. Ahora los alias viajan, y se busca por **Holded, Quipu, Excel, importar, migrar**…
>   que es como lo teclea un dueño.
> - **B2 — ETIQUETAS, REENGANCHADA.** `/admin/tags` llevaba viva y sin enlace desde U7 (8 jul).
>   Entra en **Catálogo**, junto a Categorías, marcada como ajuste. `NAV_PERMS.tags` ya estaba
>   declarado sin ningún item que lo usara — el mismo caso exacto que tuvo `analytics`.
>   **`/admin/discounts` NO se ha enlazado**, y es decisión de Ibrahin de hoy: ver el punto de abajo.
> - **B3 — DISA YA PUEDE LLEVARTE.** Hacían falta **las dos mitades** y solo con una no funciona:
>   `DISA_ALLOWED_URLS` (el sanitizador, que si no le borra el enlace) **y** la lista de URLs del
>   **prompt** (que es lo que le dice a DISA que la pantalla existe). Mismo candado que la pantalla.
>
> **⚠️ DOS COSAS QUE ESTABAN MAL Y NO SE VEÍAN, destapadas al construir esto:**
> - **El rail se habría comido la entrada nueva sin decir nada.** `railHTML` cogía la entrada del pie
>   con un `find`: con dos, la segunda **no se pinta jamás**, y sin error ninguno. Ahora pinta todas.
> - **Las entradas fijas NO pasaban por el filtro de permisos.** El propio código lo avisaba —«si
>   algún día se añade a esta lista una pantalla con candado, HAY QUE FILTRARLA»— y ese día era hoy:
>   la migración exige `company.read`. **Ya se filtran.** Medido con un empleado real: sin ese permiso
>   no la ve en el rail, no la encuentra en el buscador y recibe 403 si fuerza la dirección. Inicio y
>   la ayuda no cambian: sus claves no exigen nada.
>
> **~~⬜ APUNTADO, NO DECIDIDO~~ → ✅ RESUELTO EL 23 AGO 2026 (encargo CUPONES, `9e77f2b`) — `/admin/discounts`
> (cupones y descuentos automáticos).** Se escribió aquí como «tercera pantalla huérfana que se queda
> fuera del menú a propósito, candidata a DESMONTAR en su propio encargo». **Ese encargo llegó y está
> hecho: la pantalla y su API están DESMONTADAS y sus tablas archivadas.** Y el motivo que se dio aquí
> —«solo las leen la tienda y el POS viejo»— **estaba incompleto: faltaba DISA, que además escribía**.
> Ver la ficha «ENCARGO CUPONES» en «Función por encargo del dueño».
>
> **VERIFICADO:** `gate-migracion-puerta` (nuevo, **25 comprobaciones**, negocio creado de cero, en
> `GRUPOS.clientes` y en `EMPIEZAN_DE_CERO`) y `gate-menu-navegacion`, cuyo inventario **sube de 50 a
> 52 puertas** a propósito: **155 OK · 0 fallos**. **Seis reversiones, y las seis tumban.**

> **B. MIGRACION ASISTIDA SIN ACCESO VISIBLE.**
> Palabras del dueño: "la migracion de datos de otras plataformas no se ha construido o esta a medias". Dato real: la migracion ASISTIDA esta construida; el importador AUTOMATICO no existe. El defecto es que no hay acceso visual a la asistida.
> **B1** Dar entrada visible y estable a la migracion asistida en el menu.
> **B2** Resolver tambien las otras pantallas sin enlace localizadas en el Paso 0.
> **B3** Un dueño de negocio nuevo debe poder llegar sin que nadie le pase la direccion a mano.

**⚙️ CONFIRMADO por el Paso 0**, con dos precisiones:
- El encabezado del ítem es **correcto**: la asistida está construida (`0.1a`) y el importador
  automático **no existe** — lo único que importa ficheros hoy es la **conciliación bancaria
  (Norma 43)**, que es otra cosa.
- **B2 son DOS pantallas, no tres:** `/admin/discounts` y `/admin/tags` (`0.2`). Y **no se confundan
  con** las que están fuera del menú **a propósito y con camino propio** (avisos, recepciones,
  cerrojo de contraseña, subpantallas de Ajustes) — están listadas en `0.2`.
- **B3 hoy falla por un motivo concreto y arreglable:** el paso del onboarding **deja de ser enlace
  en cuanto se marca hecho**, así que la puerta se cierra sola tras la primera petición (`0.1c`).

---

## GRUPO 2 — FUNCIONES NUEVAS (solo codigo, sin dependencias externas)

#### C. IMPRESIÓN Y DESCARGA EN PDF DE LISTADOS Y DOCUMENTOS · ✅ **C QUEDA CERRADA — 12 de 12** (los 11 del registro + C10-f)

> **HECHOS (tanda 1, 21 ago): C1 · C4 · C5 · C7.** · **HECHOS (22 ago, commits `575e333` + `c3302f5`): C2 catálogo · C3 kardex · C6 compras · C8 gastos.** 
> **HECHOS (22 ago, commit `5e05738`): C10-e** (los SIETE informes contables, no cuatro) **· C9 · C10 · C10-f · C11.**
> ~~SIGUEN PENDIENTES, y son cinco: C2, C3, C6, C8 y C10-e~~ — **línea caducada, corregida el 22 ago:** se quedó
> nombrando como pendientes cuatro subpuntos que ya estaban marcados hechos arriba. **No queda ninguno.**
> **C9** se cierra porque los tres verbos están en los QUINCE listados, no en ocho. **C10**, porque ya no hay ni un
> generador propio: los seis que quedaban se han borrado. **C11**, porque añadir un listado sigue siendo escribir una
> declaración — los siete informes entraron sin tocar las rutas.

> **C. IMPRESION Y DESCARGA EN PDF DE LISTADOS Y DOCUMENTOS.**
> Palabras del dueño: "debemos ser capaces de imprimir informes como, lista de precios bajo plantilla claro, envio de catalogo de productos y servicios, informes de kardex, listado de clientes productos, compras, facturas, gastos, etc"
> **C1** Lista de precios, bajo plantilla.
> **C2** Catalogo de productos y servicios, preparado para ENVIAR al cliente.
> **C3** Informe de kardex (movimientos de stock).
> **C4** Listado de clientes.
> **C5** Listado de productos.
> **C6** Listado de compras.
> **C7** Listado de facturas.
> **C8** Listado de gastos.
> **C9** Los tres verbos en todos: IMPRIMIR, DESCARGAR EN PDF y ENVIAR POR CORREO.
> **C10** Motor de plantillas UNICO y reutilizable. Prohibido cablear cada listado a su propio generador: es la regla de fuente unica.
> **C11** El "etc" del dueño NO se interpreta como cerrado: al construir, dejar el motor abierto a listados nuevos sin reescribirlo.
>
> **AMPLIACIÓN DE IBRAHIN (21 ago 2026), tras cerrar C-0:**
> **C10-f** EL MEMBRETE DE LOS LISTADOS ES EL MISMO que el de los documentos, con su logo incluido. No se construye un segundo membrete para listados: C-0 dejó uno solo y esa es la fuente. Si al llegar aquí hiciera falta un campo que el membrete de documentos no tiene, PÁRATE y dilo — se amplía el único, no se crea otro.

**⚙️ CONFIRMADO por el Paso 0 (`0.3`), con el punto de partida ya medido:**
- **Se parte de medio motor, no de cero:** `renderPdfFromHtml` + `printableShell` ya son la fuente
  única de **renderizado**. Lo que falta es la capa de **listado** (columnas, cabecera del negocio,
  filtros aplicados, totales, paginación) y la de **plantilla como dato**.
- **Hay un precedente que C10 tiene que absorber, no ignorar:** los **cuatro informes contables** ya
  descargan PDF **con su propio HTML a mano**. Si el motor único nace y esos cuatro se quedan fuera,
  C10 queda incumplido el mismo día.
- **Nada de C1–C8 existe hoy** salvo exportaciones **CSV/XLSX** sueltas en Analítica y Conciliación,
  que **no son ninguno de los tres verbos de C9**.

---

---

#### C · TANDA 1 — CUATRO LISTADOS: C4 clientes · C5 productos · C7 facturas · C1 lista de precios · ✅ **HECHO (21 ago 2026)** · commit `04657ea`

> **C4** Listado de clientes. **C5** Listado de productos. **C7** Listado de facturas. **C1** Lista de precios bajo plantilla.
> Cada uno cerrado ENTERO: consulta compartida con su pantalla, declaración de la base, los tres verbos (imprimir · descargar PDF · enviar por correo) y aserciones propias.

**⚙️ LO QUE SE CONSTRUYÓ**

- **`modules/erp/impresion.js` — el motor.** Un listado no trae generador: declara columnas, filtros
  y totales. El membrete, la paginación, la cabecera repetida, el «Página X de Y», la fecha, quién lo
  generó y los filtros aplicados los pone el motor. **C10-f cumplido sin ampliar nada:** el membrete
  es el de `documentos.js`, con su logo, tal cual lo dejó C-0.
- **`modules/erp/listados.js` — el registro.** Una entrada por listado. Añadir uno nuevo **no toca el
  motor ni las rutas** (C11).
- **`modules/erp/routes/listados.js` — TRES rutas para los ocho listados**, no tres por listado. El
  candado es el de la pantalla de cada uno, resuelto en caliente: **quien no puede ver un listado
  tampoco puede imprimirlo ni mandárselo a nadie** (403 medido, y en esa respuesta no viaja ni un dato).

**⚙️ LO QUE MIDIÓ EL GATE, Y LO QUE CORRIGIÓ**

- **La consulta es la de la pantalla, sin `LIMIT`.** Al revertirlo (dándole al PDF su propio recorte
  de 25) caen **cuatro** aserciones, entre ellas «manda el listado ENTERO, no la página que se ve».
- **DOS FALLOS DE PRODUCTO que solo aparecieron al medir**, no al mirar el código:
  1. **Al correo le faltaba el remitente.** Resend no lanza: devuelve el fallo dentro (`Missing from
     field`), así que sin mirar el `error` un envío que no sale pasa por bueno.
  2. **Los importes salían sin separador de miles** (`1234,56` en vez de `1.234,56`): en español
     moderno `toLocaleString` no agrupa los números de cuatro cifras salvo que se pida. Se pide.
     El producto ya usaba `useGrouping: 'always'` en 10 sitios (Analítica, DISA, CRM, margen); el
     papel se alinea con esos. **Queda uno solo sin alinear, `modules/erp/parte-diario.js:30`** — es
     de antes, está fuera de esta tanda y se anota aquí para no perderlo.
- **TRES ASERCIONES MÍAS ESTABAN MAL, no el producto** (y una llevaba verde por el motivo equivocado):
  1. «un listado sin filtro dice Todos» se probaba con **clientes**, que SIEMPRE declara su estado y
     por tanto nunca puede quedarse sin filtros. Se prueba con productos.
  2. La tabla de actividad se llama `activity_logs`, no `activity_log`.
  3. **La del envío que falla estaba verde por el motivo equivocado:** usaba un dominio inexistente,
     y a eso Resend le dice que **sí** (el rebote llega después). Fallaba… porque faltaba el
     remitente. Se sondeó la API y se cambió a `x@a.b`, que pasa nuestra validación y **Resend
     rechaza de verdad en la llamada**. Ahora exige 502 y cero registros.
- **El total impreso se compara AL CÉNTIMO, no por su tipografía.** La aserción reescribía el formato
  por su cuenta y se puso roja al añadir el separador de miles **con el producto correcto**. Ahora
  saca el número del papel y lo compara con la suma cruda de la pantalla.

**⚙️ LA PRUEBA DE REVERSIÓN — Y LA QUE NO TUMBÓ NADA**

| Se rompe a propósito | Aserciones que caen |
|---|---|
| El listado se pinta su **propio membrete** en vez del de `documentos.js` | 2 |
| El papel **deja de declarar** con qué filtros se hizo | 4 |
| El PDF se trae **su propio `LIMIT`** en vez de la consulta de la pantalla | 4 |
| `thead` **pisado** con `table-row-group` | 1 |

> **LA REVERSIÓN QUE NO TUMBÓ NADA, Y POR QUÉ NO ERA CULPA DE LA ASERCIÓN.** La primera versión de la
> prueba **quitaba** la línea `thead{display:table-header-group}` y el gate seguía **verde**. La regla
> dice que entonces la aserción está mal — pero al medirlo resultó que **la línea es el valor por
> defecto de un `<thead>`**: quitarla no cambia nada (3 hojas de 3 siguen con cabecera). No era una
> reversión, era un no-op. Pisada con `table-row-group` la cabecera baja a **1 hoja de 3** y el gate
> cae. **La aserción sí vigilaba el mecanismo; la reversión era la equivocada.** La línea se deja
> escrita, con el motivo en el código, para que nadie la «limpie» por redundante.
>
> Al medir esto salió **otra aserción que sí estaba mal**: buscaba `/CLIENTE/i` para dar por repetida
> la cabecera, y esa palabra está en el título del papel **y dentro de los datos** — no podía fallar
> nunca. Ahora busca la secuencia de los seis rótulos y exige `pdftotext -layout`, porque sin él la
> fila de cabecera sale partida por bloques de columnas.

**⚙️ EL GATE, DECLARADO** — `gate-impresion`, **43 aserciones, verde**. Grupo propio `impresion` en
`GRUPOS` (que sin eso **no lo ejecutaría nadie**) y en `EMPIEZAN_DE_CERO`: se trae dos negocios nuevos,
uno con 240 clientes para ver paginar de verdad y el vecino para probar que su PDF no trae ni un dato
del primero.

> **`AFECTA`: AÑADIR, NUNCA SUSTITUIR — la lección de C-0, comprobada esta vez con una prueba.** Las
> reglas que ya existían (`documentos.js`, `routes/invoices.js`, `routes/settings.js`) llevan sus
> grupos de siempre **más** `impresion`. Se barrieron **los 373 ficheros del repo** comparando el mapa
> nuevo contra el anterior: **ningún fichero pierde un gate** y 75 ganan `gate-impresion`.
> - **`listados.js` corre TODOS los gates**, no solo el suyo: parece del motor, pero dentro viven las
>   consultas de **tres pantallas** del producto. Con `['impresion']`, tocar la consulta de facturas
>   habría dejado de despertar a `margen` y `clientes`. Es exactamente la trampa de C-0.
> - **`routes/products.js` se deja SIN regla a propósito:** hoy cae en el comodín final y corre todo.
>   Escribirle `['impresion']` sería cambiar «todo» por «uno»: menos cobertura disfrazada de más.

---

#### C10-e · LOS SIETE INFORMES CONTABLES, POR EL MOTOR · ✅ **HECHO (22 ago 2026)** · commit `5e05738`

> Con esto **C QUEDA CERRADA: 12 de 12.** Quince listados, todos con los tres verbos y todos por la
> misma pieza. No queda ni un papel que se pinte por su cuenta.

**⚙️ EL PASO 0 CORRIGIÓ DOS COSAS, Y UNA ERA DE ESTE MISMO ENCARGO**

- **«Son 4 subpuntos de 12: C10-e es uno de ellos» — NO.** C10-e **no es uno de los doce**: vive dentro
  de C10. Los cuatro que quedaban eran **C9, C10, C10-f y C11**, y C10-e era el trabajo pendiente
  dentro de C10. Manda el TABLERO, como pide el propio encargo.
- **Y una línea del TABLERO estaba caducada por mi culpa:** seguía diciendo «siguen pendientes, y son
  cinco: C2, C3, C6, C8…» cuando esos cuatro ya estaban marcados hechos justo encima. Corregida sin
  borrarla.

**⚙️ LO QUE SE HA HECHO**

- **Desaparecen los SEIS generadores de HTML a mano** —`libroHtml`, `diarioHtml`, `mayorHtml`,
  `bienesHtml`, `pygHtml` y `modelosBorradorHtml`, 87 líneas—. El papel de los siete lo compone la
  misma pieza que los otros ocho listados, y con ella ganan membrete, cabecera repetida en cada hoja,
  «Página X de Y» y periodo declarado.
- **Y los tres verbos.** Hasta hoy un libro **solo se podía descargar**: no había forma de mandárselo
  a la gestoría sin bajarlo y adjuntarlo a mano.
- **Ninguno necesitó una cuarta pieza del motor**, que era lo que el Paso 0 mandaba comprobar antes de
  construir: los cinco de tabla ya cabían, el P&G con los subtotales intercalados y los modelos con
  las secciones. Sí nació un **formato de celda** (`dinero0`), y por un motivo medido, no estético.

**⚙️ LA COMPROBACIÓN QUE MANDA: NI UNA CIFRA SE HA MOVIDO**

Los siete papeles de antes se capturaron **antes de tocar nada** y se compararon valor a valor:
**idénticos los siete**, sin faltar ni sobrar ninguno. Dos diferencias reales que cazó esa comparación:

- **El diario pintaba un `0,00` donde el viejo dejaba la celda EN BLANCO.** En un libro contable eso
  importa: vacío dice «esta línea no toca esta columna» y cero dice «toca, y vale cero».
- **El mayor SÍ pinta sus ceros** —usaba `m()` y no `numOrBlank`, y tenía seis—. Al ponerle el mismo
  formato que al diario, desapareció uno.

**⚙️ EL ARCHIVO OFICIAL, INTACTO** · `ventas.csv`, `ventas.xlsx`, `compras.csv` y `compras.xlsx` salen
**byte a byte iguales** que antes. Sus 36 columnas en el orden de la AEAT son requisito legal: el
papel usa las legibles y el archivo las suyas. Dos salidas del mismo dato, a propósito.

**⚙️ PAPELES LARGOS** · el libro diario hace **78 hojas**, así que **avisa antes de bajarlo** y sale
ENTERO si se confirma — nunca recortado. El listón está medido sobre papeles reales (**30 filas por
hoja**: ventas 183/7, diario 2401/78, clientes 131/4); mi primera versión puso 60 «a ojo» y el diario
no avisaba. *(La URL histórica `/admin/contabilidad/*.pdf` sigue bajando directo, sin preguntar: es la
dirección que la gestoría ya tiene guardada y romperla sería peor que el aviso.)*

**⚙️ EL GATE: 59 → 75 ASERCIONES, LOS QUINCE LISTADOS · REVERSIÓN INFORME A INFORME**

| Se rompe a propósito | Rojos |
|---|---|
| Reaparece un generador de HTML propio | 1 |
| El P&G deja de marcar sus subtotales intercalados | 1 |
| Los borradores pierden la tabla del 130 | 2 |
| El libro de ventas se trae una sola fila | 1 |
| Desaparece el aviso de los papeles de más de 50 hojas | 2 |

> **TRES FALLOS MÍOS QUE DESTAPÓ ESA REVERSIÓN, y ninguno era del producto.** La comprobación del
> aviso decía «si avisa, entonces…», así que al quitarle el aviso al producto **no comprobaba nada**;
> el negocio del gate no tenía ningún papel de más de 50 hojas con el que medirlo (ahora se trae un
> artículo con 1.700 movimientos); y la de «el libro trae todas sus líneas» **le preguntaba a la misma
> función que alimenta el papel**, así que al recortarla se recortaban las dos a la vez. Una
> comprobación que se pregunta a sí misma no comprueba nada: el testigo es ahora el archivo oficial.

**⚙️ MAPA Y BARRIDO** · contabilidad despierta también a `impresion`, con sus grupos de siempre. 377
ficheros comparados: **ninguno pierde un gate**. Barrido completo, **una pasada: 84/84**.

---

#### C · CUATRO LISTADOS MÁS Y EL MOTOR AMPLIADO · ✅ **HECHO (22 ago 2026)** · commits `575e333` + `c3302f5`

> **C2** Catálogo para enviar al cliente. **C3** Kardex. **C6** Compras. **C8** Gastos.
> Los tres verbos en los cuatro, con la misma consulta que su pantalla. **C va de 4 a 8 de 12.**

**⚙️ LO QUE TUMBÓ EL PASO 0 — DOS PREMISAS, Y UNA ERA DEL PROPIO TABLERO**

- **NO SON CUATRO INFORMES CONTABLES: SON SIETE.** Ventas, compras, diario, mayor, bienes de
  inversión, P&G y borradores de modelos, con **seis generadores de HTML propios**
  (`contabilidad-routes.js`, siete rutas `.pdf`). El texto de C10-e dice «los cuatro» y es falso; se
  corrige aquí sin reescribir el original.
- **EL KARDEX SÍ CABE EN EL MOTOR**, al revés de lo que sugería el encargo. Su saldo **no lo acumula
  la vista**: viene resuelto fila a fila desde el servidor (`stock.js:175`), así que es una columna
  más. Medido antes de construir, que era justo lo que el Paso 0 mandaba.
- **QUÉ ES «GASTOS», que el TABLERO solo dice «C8 Listado de gastos»:** en Bamburu un gasto ES una
  factura recibida. El producto ya lo distingue por dentro (`supplier-invoices.js:99`: «sin origen de
  stock → factura de GASTO»). Medido: de 270 facturas recibidas, **197 son gasto puro y 73 traen
  mercancía**. Se resuelve por la regla dura —el papel usa la consulta de SU pantalla—, así que C6
  sale de `/admin/purchases` y C8 de `/admin/supplier-invoices`.

**⚙️ EL MOTOR, AMPLIADO CON TRES PIEZAS — DECLARATIVAS Y ADITIVAS**

Dos de los siete informes **no son tablas planas**: el P&G lleva subtotales **intercalados** y un
bloque de avisos, y los modelos son **un papel con dos tablas** (303 y 130), cada una con su título y
su aviso. La alternativa era un segundo motor, que es lo que C10 prohíbe. Se añaden: **(a)** una fila
puede declararse subtotal y se pinta destacada **en su sitio**; **(b)** un papel puede llevar varias
**secciones**; **(c)** un bloque de **notas** al pie. Quien no las declara sale igual que antes —
comprobado: los cuatro listados de la tanda 1 siguen en **43 OK · 0 fallos** sin tocarles una línea.

**⚙️ EL GATE: 43 → 59 ASERCIONES · REVERSIÓN PIEZA A PIEZA**

| Se rompe a propósito | Rojos |
|---|---|
| El catálogo se cuela el **stock** (dato de dentro, y el papel va a un cliente) | 1 |
| El kardex se trae **su propio recorte** en vez de la lista entera | 1 |
| El total de gastos vuelve a **contar las anuladas** | 1 |
| La pantalla deja de ofrecer **los tres verbos** del catálogo | 1 |
| El motor deja de marcar los **subtotales intercalados** | 1 |

> **DOS FALLOS MÍOS QUE DESTAPÓ ESA REVERSIÓN, y los dos eran verdes por no medir.** La aserción de
> las anuladas **no tenía ni una factura anulada** con la que medir en el negocio del gate; y las
> tres piezas nuevas del motor **no las miraba nadie**, porque hoy ningún listado las declara —
> las usará C10-e. Ahora el gate se trae su gasto anulado y prueba las tres piezas contra el
> contrato del motor. (De paso: sembrarla reventó el gate, porque el estado válido es `vigente` y no
> `pendiente`.)

**⚙️ MAPA Y BARRIDO** · cada regla lleva sus grupos de siempre **más** `impresion`, nunca en su
lugar: barridos los **377 ficheros** contra el mapa anterior, **ninguno pierde un gate** y 17 ganan
éste. Barrido completo, **una pasada**: **84/84**.

**🔴 LO QUE QUEDA DE C, CON FICHERO Y LÍNEA — C10-e, ENTERO**

Los **siete** informes contables siguen bajando PDF con su HTML a mano. **No se ha empezado**, para
no dejarlo a medias:

| Informe | Ruta | Generador |
|---|---|---|
| Libro de ventas e ingresos | `contabilidad-routes.js:225` | `libroHtml` (`contabilidad-export.js:171`) |
| Libro de compras y gastos | `:238` | `libroHtml` |
| Libro diario | `:279` | `diarioHtml` (`:210`) |
| Libro mayor | `:292` | `mayorHtml` (`:221`) |
| Libro de bienes de inversión | `:372` | `bienesHtml` (`:268`) |
| Cuenta de pérdidas y ganancias | `:400` | `pygHtml` (`:294`) — necesita **subtotales + notas** |
| Borradores de modelos 303/130 | `:454` | `modelosBorradorHtml` (`:438`) — necesita **secciones + notas** |

> **UN AVISO PARA QUIEN LO HAGA:** el CSV/XLSX de esos libros usa **36 columnas** (formato oficial
> AEAT) y el PDF usa las legibles. **No son la misma tabla y no se pueden intercambiar**: reutilizar
> la matriz del CSV para el papel lo dejaría ilegible en A4, que es empeorar el resultado visible.
> Las columnas del papel están en `libroHtml` (`contabilidad-export.js:173-175`).

---

#### ✅ FASE 0 CERRADA DE VERDAD — EL DIFF, IDÉNTICO (22 ago 2026)

**EL DIFF DE LA SERIE, UNA PASADA, PUBLICADO**

| | comprobaciones | veredicto |
|---|---|---|
| Serie · **día** (negocio a las 16:39) | 84 | **84/84** · 16,9 min |
| Serie · **madrugada** (negocio a las 06:58) | 84 | **84/84** · 16,9 min |
| `diff` gate por gate | 84 vs 84 | **IDÉNTICOS** |

> **Por qué en serie sí y en paralelo no.** En paralelo quedaba un ruido de ~1 gate por pasada, de
> una lista rotatoria: gates que se pisan en el único negocio que comparten los 84. En serie no hay
> con quién chocar, así que el veredicto es determinista y el `diff` significa algo. El paralelo
> sigue siendo el modo normal del barrido; su ruido está medido y con nombre.

**EL CUARTO ROJO, ARREGLADO POR LA CAUSA — NO CON `SOLOS`**

- **`gate-propuestas-pagos-permisos` no tenía problema de datos:** ya filtraba por SU factura y SU
  propuesta. Dormía **1.500 ms fijos** tras pulsar «Registrar pago» y bajo carga leía la base antes
  de que el servidor terminara — las tres aserciones caían de golpe. Ahora **espera a la condición**
  (a que el pago exista, a que la propuesta se cierre y a que la tarjeta desaparezca del panel), no
  al reloj. **Sale de `SOLOS`.**
- **`gate-oficio-pantalla` apagaba a todas las personas del negocio compartido** para probar el caso
  «una sola persona». Ahora **levanta su propio negocio**, que nace con una: no hay nada que apagar y
  no toca a nadie. Los pasos [2] y [6] corren allí y el negocio se borra al salir.

> **⚠️ CORRIJO UNA CIFRA QUE DI MAL.** Dije que `SOLOS` había pasado «de 9 a 11». **Eran 10** antes de
> que yo tocara nada. `gate-oficio-pantalla` **ya estaba declarado** desde antes por mover
> `company_config`, así que mi entrada era un **duplicado** — y un `Map` con la clave repetida no
> crece, por eso leí 10 y creí que había subido de 9. El único que añadí de verdad fue el de pagos.
>
> **`SOLOS`: 10 → 10.** No he podido bajarlo del número original: `gate-oficio-pantalla` sigue dentro
> por su **otra** causa, anterior y distinta —cambia el oficio y el nombre de los puestos en
> `company_config` del negocio—, que este encargo no tocaba. Lo digo en vez de dejarlo insinuado.

**EL DISCO, ANTES Y DESPUÉS** · antes de arrancar: **34 %** usado (66 % libre, muy por encima del
umbral) · durante las dos series: estable en 35 % · al terminar: **37 %**. Cero perfiles residuales
de Chromium, confirmado con el gate vivo (1) y tras `SIGTERM` (0).

**ESTADO REAL DE LA FASE 0: CERRADA.** El termómetro da el mismo veredicto en las dos franjas, el
lint está en 0 avisos con su clase vigilada, las declaraciones caducadas fuera, y la norma de «una
comprobación pedida una vez se ejecuta una vez» escrita en `CLAUDE.md` con su motivo.

---

#### 🔁 CIERRE REAL DE LA FASE 0 — LOS CUATRO CABOS (22 ago 2026)

**CABO 1 · EL DIFF DE VERDAD — NO ERA IDÉNTICO, Y SIGUE SIN SERLO. LA FASE NO ESTÁ CERRADA.**

Ibrahin tenía razón: comparé dos pasadas de **82** —las dos anteriores a los gates nuevos— y luego
las publiqué junto a un 84/84 de día como si el `diff` las cubriera. No las cubría. Rehecho con 84,
y con los rojos arreglados entre medias, sale esto:

| ronda | día | madrugada | quién cayó |
|---|---|---|---|
| A | 84/84 | 82/84 | `gate-oficio-pantalla`, `gate-recepciones-c1b` |
| B | 83/84 | 84/84 | `gate-oficio-pantalla` |
| C | 84/84 | 83/84 | `gate-propuestas-pagos-permisos` |

> **LO QUE DICEN ESOS NÚMEROS, Y NO ES LO QUE YO ESPERABA.** El rojo **cambia de franja**: cae de día
> y pasa de noche, y al revés. O sea que **la hora ya no tiene nada que ver** —eso quedó resuelto— y
> lo que queda es **la compañía**. Los cuatro rojos son distintos, y **los cuatro pasan en solitario**.
> El barrido en paralelo tiene un **ruido de fondo de ~1 gate por pasada**, de una lista rotatoria de
> gates que se pisan en el único negocio de desarrollo que comparten los 84.
>
> **ESO NO SE ARREGLA GATE A GATE**, y esta ronda lo demuestra: arreglé tres y salió un cuarto. Lo que
> se ha hecho es lo que el propio punto 0.1 manda —**declararlos**, con su motivo escrito— y `SOLOS`
> pasa de 9 a **11**. Pero declarar no elimina el ruido: lo acota.

**CABO 2 · LAS OTRAS DOCE PANTALLAS — COMPROBADAS UNA A UNA, NINGUNA MÁS INVENTADA**

Las trece tienen **montaje y handler** en el código, y las doce con dato responden **HTTP 200 sin
redirigir** contra la dirección pública (`desarrollo-bamburu.bamburu.com`). La decimotercera
(`/admin/quotes/:id/edit`) solo existe con un presupuesto en borrador, que el gate se trae y limpia.

**CABO 3 · LA FACTURA F2026-0973 — DÓNDE PASÓ**

- **Negocio: `desarrollo-bamburu`** («Desarrollo Bamburu», control.db id 20, plan starter, país ES).
  Es **el negocio de desarrollo del proyecto**, el que comparten los 84 gates. **No es de un cliente.**
- **Serie y correlativo: año 2026, secuencia 973**, número `F2026-0973`. El correlativo **queda
  consumido**: la numeración siguió (hay F2026-0975 y F2026-0976 posteriores).
- **Sí entró en la cadena de huellas.** Dos registros en `verifactu_registros`: `alta` (id 1256) y
  `anulacion` (id 1257), encadenados por `prev_huella`. La anulación por el camino del producto
  generó su propio registro, así que **la cadena queda íntegra y cerrada**, no rota.
- **NO salió hacia la AEAT.** `verifactu_envios` tiene dos filas en total, de los registros 53 y 54,
  ambas en estado `bloqueado_datos` y con `entorno`, `endpoint` y `http_status` a `null` — nunca hubo
  llamada. **Los registros de esta factura no tienen ninguna fila de envío.**

**CABO 4 · NORMA EN `CLAUDE.md`, Y QUIÉN NO LA CUMPLE HOY**

La norma está escrita literal, en su propia sección. Y el repaso que pedía, **sin arreglar nada**:

- **27 gates afirman «cero errores JS» escuchando `pageerror`/consola.** Matiz que importa y que no
  conviene inflar: esa vía **sí** caza los errores de EJECUCIÓN (un `ReferenceError` al pulsar); lo
  que **no** caza es el **error de sintaxis** que mata el bloque entero. Su aserción no es falsa, es
  **incompleta**, y ninguno de los 27 cubre la clase que dejó dos pantallas muertas.
- **Ninguno compila scripts del DOM** (la segunda vía prohibida). El único que compila el HTML crudo
  es `gate-pantallas-documento`.

---

#### ✅ TANDA COMPLETA · FASE 0 — SANEAR LAS COMPROBACIONES · **HECHA (22 ago 2026)**

> Va primera y no última por su motivo: con un termómetro que daba 81/82 de día y 74/82 de
> madrugada, los verdes de las fases siguientes no significarían nada.

**0.1 · LA FAMILIA HORARIA Y DE CONCURRENCIA — CUMPLIDO Y DEMOSTRADO CON `diff`**

- El arreglo de raíz se aplicó el 21-ago a la familia entera (17 gates). Aquí se ha **verificado**:
  **82/82 con el reloj del negocio a las 11:30 y 82/82 con el reloj a la 01:42**, y el `diff` gate por
  gate de los dos veredictos sale **idéntico**.
- **CÓMO SE PUSO EL RELOJ EN MADRUGADA SIN ESPERAR DOCE HORAS**, porque el método importa: no hay
  `libfaketime` en la máquina y mover el reloj del sistema es tocar todo. Se desplazó **la zona del
  negocio** (`ZONA_NEGOCIO`, `citas-engine.js` y `avisos.js`) a una donde en ese momento era la
  01:42, se desplegó, se barrió y se restauró. Eso pone al **producto** en franja nocturna dejando
  los gates en la hora del proceso, que es exactamente el peor caso.

**0.2 · LOS ONCE AVISOS — LA PREMISA CAYÓ, Y LA DEFENSA ES OTRA** · commit `44dc525`

- **PREMISA CORREGIDA:** el subpunto pedía comprobarlos «en pantalla, pulsando de verdad». **No hay
  pantalla que pulsar:** los once están en `/admin/orders` y `/admin/store-settings`, cuyo montaje
  está **comentado** (`index.js:141` y `:151`) y responden 302. **Diez eran bugs reales** —el template
  literal abre en `settings.js:1295` y no cierra hasta pasada la 1603— y se arreglaron; **el undécimo
  ya estaba bien escrito** y era falso positivo de la heurística.
- **EL LINT, AMPLIADO Y PRECISO: 0 avisos.** La regla no es «hay una barra» sino **la racha**: con
  una, la plantilla se la come y llega un apóstrofo pelado que cierra la cadena; con dos o más, al
  menos una sobrevive. Demostrado que caza: devolviéndole la barra al escape que mató la pantalla de
  facturas, salta.
- **GATE NUEVO — `gate-pantallas-documento` (16 aserciones).** Abre las **13 pantallas que cuelgan de
  un documento** —las que no están en el menú y por eso no vigilaba nadie— y exige que **todos sus
  scripts compilen**. Es el hueco por el que se coló la pantalla de recepción muerta.

> **TRES MECANISMOS PROBADOS, DOS DESCARTADOS — Y LOS DESCARTÓ LA REVERSIÓN, NO EL RAZONAMIENTO.**
> **(1)** Escuchar `pageerror`/`console` **no sirve**: un SyntaxError de un `<script>` inline **no
> emite ningún evento**; con la pantalla rota, el único evento era el 404 del favicon. **(2)**
> Compilar lo que hay en el DOM **tampoco**: el parser **trunca** el script en el error —2.380
> caracteres en vez de 4.888— y el trozo que queda **compila**. **(3)** Lo único que ve el fallo es
> compilar el **HTML crudo**. Y un cuarto fallo, mío: la consulta elegía una orden ya recibida, el
> servidor **redirigía** y el gate medía otra pantalla dando verde — ahora exige que la URL final sea
> la pedida. **Sin la prueba de reversión, las tres primeras versiones habrían sido un verde falso
> permanente.**

> **⚠️ UN ERROR MÍO CON COSTE, dicho entero.** Para probar una pantalla `/admin/invoices/:id/edit`
> **que me inventé al inventariar** (no existe), creé una «factura en borrador». En Bamburu las
> facturas **nacen emitidas**. Fabriqué la factura real **F2026-0973** (9,08 €). **No se ha borrado**
> —una emitida está en la cadena de huellas y esa no se toca— sino **anulado por el camino del
> producto**, con su motivo escrito y su documento de anulación (id 184).

**0.3 · DECLARACIONES CADUCADAS — TRES RETIRADAS O CORREGIDAS** · commit siguiente

- **`gate-nav-inicio-disa`** estaba declarado ROJO CONOCIDO desde el 20-ago y **hoy pasa**: se retira
  la nota, el gate no se toca. Segunda declaración rancia retirada en tres días.
- **`verify-avisos-crm-riesgo`** estaba EXCLUIDO por «EN ROJO desde antes» y **hoy pasa limpio**: la
  exclusión escondía una comprobación buena. **Entra al barrido.**
- **`gate-avisos-pantalla`** sigue rojo, pero su ficha decía «1 aserción» y son **TRES**: una cifra
  vieja hace creer que el agujero es menor de lo que es. `verify-pieza-c-http` sigue rojo por lo suyo.

**⚙️ CIERRE DE FASE — EL NÚMERO ANTES Y DESPUÉS**

| | antes (21 ago) | después (22 ago) |
|---|---|---|
| Barrido de día | 81/82 | **84/84** |
| Barrido de madrugada | 74/82 | **82/82** (idéntico al de día por `diff`) |
| Comprobaciones | 82 | **84** (+`gate-pantallas-documento`, +`verify-avisos-crm-riesgo`) |
| Avisos del lint | 11 sin verificar | **0**, y la clase vigilada |

---

#### 🔧 SANEADO DE LOS ROJOS DEL BARRIDO (21–22 ago 2026) — **de 60/82 a 81/82**

> Encargo de Ibrahin: «soluciona los problemas que encontraste». Se atacaron **los 16 rojos** del
> barrido, uno a uno, midiendo cada uno antes de tocarlo. **17 gates arreglados y TRES fallos de
> producto**, dos de ellos con una pantalla muerta que nadie había notado.

**🔴 LOS TRES FALLOS DE PRODUCTO — pantallas que no funcionaban**

1. **La pantalla «Registrar recepción» estaba MUERTA** (`purchase-orders.js`, commit `c516948`). El JS
   del navegador de esa pantalla parte los números de serie por saltos de línea. Está escrito dentro
   de una plantilla del servidor, y la plantilla **se comía una capa de escape**: la cadena quedaba
   partida, el bloque entero era un error de sintaxis y **ninguna de sus funciones existía**.
   Confirmar una recepción no hacía nada. Sin error a la vista, sin aviso.
2. **La pantalla de facturas moría al cargar** (`invoices.js`, commit `b1b8eae`) — misma clase de
   fallo, encontrada horas antes.
3. **El zoom S/M/L se enseñaba en la vista Mes** (`citas.js`, commit `cbae0d9`), donde no hace nada.
   Es justo lo que preguntó Ibrahin al ver la barra.

> **LA CLASE DE FALLO MÁS CARA DE ESTE REPO, y hoy costó dos pantallas.** Cuando dentro de una
> plantilla del servidor se escribe una cadena de JS **del navegador**, la plantilla se come una capa
> de escape y la cadena se parte. El bloque deja de ejecutarse entero: los botones no responden y no
> hay ni un error visible. **Volví a caer en ella dentro del comentario que la explicaba.**
> Se probó ampliar `lint-plantillas.mjs` para cazarla en el fuente y **se descartó tras medirlo**:
> dentro de una plantilla las comillas suelen ser atributos HTML y no cadenas JS, así que la
> heurística daba falsos positivos, y un lint que grita en falso se acaba ignorando. **La defensa
> buena es medir la pantalla, no adivinar el fuente**: `gate-recepciones-c1b` engancha ahora los
> errores de JS y los DICE. Queda pendiente extenderlo a las demás pantallas que cuelgan de un
> documento y que hoy no vigila nadie (`gate-menu-navegacion` solo recorre las del menú).

**🟠 LO QUE DE VERDAD PASABA EN LOS OTROS 14: NINGUNO ERA DEL PRODUCTO**

- **Precondiciones ajenas que el reseed se llevó por delante.** `seed-taller.mjs` archiva **todos**
  los proveedores y productos genéricos al resembrar el negocio. Con ellos se fueron «Aromas del Sur
  SL» —del que dependen **diez gates** que no lo crean— y las «Vela …», que buscaban tres más.
  Arreglo aplicado donde era barato (que el gate **se traiga lo suyo**) y, donde no, reactivando el
  dato. **El arreglo de raíz sigue pendiente para el resto: cada gate con su proveedor y su producto.**
- **Gates que medían la HORA DEL DÍA, no el producto.** Cinco: sembraban citas a horas fijas, pedían
  huecos para hoy con el negocio ya cerrado, o exigían que la línea de «ahora» quedara a un tercio
  del alto cuando ya no queda día que desplazar. **Verdes por la mañana y rojos por la tarde.**
- **Gates que medían el TENANT ENTERO** (todos los movimientos de stock, todos los almacenes) en un
  barrido donde corren veinte a la vez: fallaban con rojos **ajenos**.
- **Gates caducados por cambios deliberados del producto**: la leyenda de la agenda pasó a ser una
  ventana y el chat de DISA **se fue del Inicio a propósito** (está escrito en el propio código). Los
  pasos que medían esas superficies **se retiran con su motivo**, no se apuntan a otra pantalla para
  salvarlos.
- **Un catálogo que creció**: `verify-plantillas-email` exigía 8 tipos de correo y el producto va por
  10 desde que entraron las citas y el resumen de avisos. Ahora se declara **por nombre**, para que
  añadir uno obligue a decidir a qué familia va.

**⚠️ LO QUE QUEDA, DICHO CON DATOS Y NO CON UNA IMPRESIÓN**

> **EL BARRIDO DA 81/82 DE DÍA Y 74/82 DE MADRUGADA.** Medido la misma noche, con el mismo código:
> 81/82 a las 17:00 · 81/82 a las 22:00 · **74/82 a la 01:00**. Y los nombres **cambian en cada
> pasada**: `gate-cliente-360`, `gate-citas-pantalla`, `gate-cola-envios`, `gate-vigia-agenda`,
> `gate-propuestas-pagos-permisos`, `verify-wal-acotado`… No es azar y no es el producto: es que
> **una familia entera de gates está escrita dando por hecho que se ejecuta de día y a solas**.
>
> **NO SE SIGUIÓ ARREGLANDO UNO A UNO A PROPÓSITO.** Cada pasada destapa una combinación distinta de
> la misma causa, así que perseguirlos de noche es una carrera sin final y sin aprendizaje nuevo.
> **El arreglo de raíz es de encargo propio y tiene dos patas, las dos ya probadas hoy en pequeño:**
> **(a)** la fecha y la hora se toman SIEMPRE de `ahoraLocal()` —la del negocio—, nunca del proceso,
> que va en UTC y a partir de las 22:00 está **en otro día**; **(b)** un gate no mide nunca totales
> del negocio ni siembra en «hoy»: mide lo suyo y siembra en un día que ha comprobado libre.

---

#### 🔁 EL BARRIDO COMPLETO DEL 21 AGO 2026 — **60/82 → 66/82** · commit `b1b8eae`

> Autorizado por Ibrahin al cerrar la tanda 1. Se corrió entero, se investigó rojo por rojo y **se
> separó lo mío de lo de antes con una prueba, no con una opinión**: volviendo el árbol al commit
> anterior a la tanda (`078d054`) y reejecutando los mismos gates en serie.

**⚙️ LOS SEIS QUE SUBIERON, Y DE QUIÉN ERA CADA UNO**

- **CUATRO GATES MÍOS ESTABAN VERDES Y EL BARRIDO LOS DABA POR NO PASADOS.** `run-gates.mjs` decide
  PASA/SOSPECHOSO buscando un resumen reconocible («N OK», «PASS: n», «N comprobaciones»). Los cuatro
  gates nuevos —`gate-citas-mes`, `gate-cola-envios`, `gate-documentos`, `gate-impresion`— cerraban
  con un formato **que me inventé** («43 pasan · 0 fallan») y que el runner no sabe leer: salían
  **SOSPECHOSOS y contaban como no-pasa**. Es la hermana del fallo de estar fuera de `GRUPOS`: allí no
  los ejecutaba nadie, aquí sí los ejecuta pero no sabía leer lo que contestaban. Commit `3868560`.
- **UN FALLO DE PRODUCTO, MÍO, QUE SOLO VIO EL BARRIDO** (`gate-menu-navegacion`, commit `b1b8eae`):
  la pantalla de facturas moría con **«Unexpected identifier facturas»**. El botón de enviar el
  listado se pinta desde JS del navegador escrito **dentro de una plantilla del servidor**, y la
  plantilla **se come una capa de escape**: llegaba un apóstrofo pelado que cerraba la cadena. Con el
  código anterior a la tanda ese gate pasaba y con el mío fallaba — así quedó demostrado que era mío.
- **DOS ROJOS AJENOS QUE ERAN UNA PRECONDICIÓN DEL TENANT, NO DEL CÓDIGO** (`gate-gasto-proveedor` y
  `gate-pagos-proveedor`). **`seed-taller.mjs:98` archiva TODOS los proveedores genéricos** al
  resembrar el negocio de desarrollo (`UPDATE suppliers SET active=0 WHERE active=1`), y con ellos se
  llevó **«Aromas del Sur SL»** — del que dependen **diez gates** que **no lo crean ellos**. Se
  reactivó el proveedor (dato de desarrollo archivado en masa, no borrado) y volvieron dos.
  **El arreglo bueno sigue pendiente y es otro:** que cada gate se traiga su propio proveedor, como
  los de compras se traen su producto. Es la misma fragilidad ya declarada en `gate-nav-inicio-disa`.

**⚙️ LO QUE SIGUE ROJO — 16, y ninguno es de la tanda 1**

- **CATORCE SON DE ANTES, DEMOSTRADO:** fallan **igual** con el código de `078d054`, anterior a esta
  tanda: `gate-agenda-visual`, `gate-inicio-cuadro-mando`, `gate-oficio-pantalla`,
  `gate-reserva-publica-pantalla`, `gate-c1c-diferencias-cierre`, `gate-orden-compra-c1a`,
  `gate-recepciones-c1b`, `gate-c2-revision`, `verify-propuestas-dormidos`,
  `verify-propuestas-fiscales`, `gate-disa-dictar-compra`, `gate-disa-adjuntar`,
  `verify-plantillas-email`, `gate-plantillas-email`.
- **DOS SON INESTABLES EN PARALELO, NO ROJOS:** `gate-abono-proveedor` y `gate-almacenes` salen rojos
  en el barrido y **verdes al correrlos solos, en 12 segundos**. Aparecen y desaparecen entre pasadas.
  Es la fragilidad conocida del paralelismo, no un fallo del producto — pero **es deuda, no ruido**.

**⚙️ DEUDA ANOTADA, MEDIDA HOY Y NO TOCADA (no hay encargo y es otra área)**

> **`lint-plantillas.mjs` no caza la clase de fallo que me acaba de morder.** Vigila los escapes de
> **regex** que la plantilla destruye (`\d`, `\*`), no los de **comilla**. Ampliarlo a `\'` y `\"`
> saca **11 avisos más, los 11 preexistentes y los 11 en la pantalla de plantillas de email de
> Ajustes** (`modules/erp/routes/settings.js`, líneas 1603, 1702, 1706, 1711, 1726, 1727, 1729, 1738,
> 1739, 1741). Mismo mecanismo que el mío, pero con una diferencia que importa: **el mío rompía al
> CARGAR y esos rompen al PULSAR**, y por eso ningún gate los ve — es exactamente la lección de C4b
> («los handlers no se delatan al cargar, solo al pulsar»). **No están verificados como rotos**: está
> medido el escape, no el síntoma. Merece encargo propio, con el lint ampliado al final y no al
> principio, para no dejarlo en rojo permanente mientras se arregla.

---

#### C-0. SANEAR LOS DOCUMENTOS ANTES DE CONSTRUIR EL MOTOR · ✅ **HECHO (21 ago 2026)** · commit `b026022`

> **C0-1** UNA SOLA docParties. Es una REGLA DE NEGOCIO —cuándo manda la foto congelada del documento y cuándo la configuración en vivo—, no maquetación. Vive en un solo sitio y todos la llaman. Si el Paso 0 confirma que la de compras es legítimamente distinta, se admite UNA excepción, escrita y con su motivo en el código. Una, no dos.
> **C0-2** UN SOLO DIALECTO. Presupuesto, pedido y albarán pasan a las clases .doc-* que ya usa la factura. Los estilos escritos a mano en cada etiqueta desaparecen. No se inventa un dialecto nuevo: se usa el que hay.
> **C0-3** EL LOGO SALE. company_config.logo_url se pinta en el membrete de TODOS los papeles, en pantalla y en impresión. · Sin logo → el membrete se pinta igual de bien, sin hueco ni icono roto. · Con logo → tamaño acotado. · Documento ya emitido: manda la foto congelada.
> **C0-4** EL RESULTADO VISIBLE NO EMPEORA. Salvo el logo, los seis papeles salen igual o mejor.

**⚙️ EL PASO 0, CERRADO — Y LO QUE CORRIGIÓ:**

- **NO SON SEIS PAPELES, SON NUEVE**, y la diferencia importa. Con **membrete**: factura, presupuesto,
  pedido, albarán, ticket de mostrador y orden de compra — **seis**. Con **papel en pantalla pero sin
  membrete**: compra directa, factura recibida, devolución a proveedor y recepción — **cuatro más**, y
  es correcto que no lo lleven: en una compra el emisor es el proveedor. El **portal** no es un papel
  aparte: reusa `buildInvoicePaper`. *(El «cinco» del informe anterior era un fallo del comando con
  el que busqué, no un dato del código: escribí cinco ficheros a mano y dejé fuera la orden de compra.)*
- **LA DE COMPRAS ERA LEGÍTIMAMENTE DISTINTA, PERO NO ENTERA.** Devuelve `proveedor` en vez de
  `cliente`, lee de `suppliers` y compone la dirección juntando `address + city` (un proveedor guarda
  la ciudad aparte). **Pero el emisor sigue siendo tu negocio**: una orden de compra **la emites tú**.
  El matiz de Ibrahin —«el proveedor emite, tú recibes»— vale para la **factura recibida**, que ni
  siquiera lleva membrete. Así que **no hacía falta una excepción**: la contraparte es un PARÁMETRO y
  la regla es una sola. **Cero excepciones, no una.**
- **EL TICKET NO USABA `docParties`… Y LA FACTURA TAMPOCO.** Iban por un **tercer camino**: leían
  `inv.company_name` a pelo. Así que la misma regla vivía escrita de **tres formas**, no en cuatro
  copias.
- **EL LOGO ERA UNA URL ESCRITA A MANO.** Campo de texto «URL Logo empresa», sin subida, **sin
  validación, sin tope y sin comprobar formato**. No lo tenía ningún negocio. *(Y una hipótesis mía
  intermedia era falsa y se comprobó antes de escribirla: `logo_url` no está declarado en
  `companySchema`, pero éste es `.passthrough()`, así que sí se guardaba.)*

**EL HALLAZGO COMPLETO, ANOTADO AUNQUE QUEDE ARREGLADO** — porque el registro es la memoria del
proyecto, no la lista de lo que falta:

1. **Dos dialectos para pintar lo mismo.** La factura usaba las clases `.doc-*` de `layout.js`; el
   presupuesto, el pedido, el albarán y la orden de compra repetían el mismo HTML con
   `style="font-size:11px;text-transform:uppercase;…"` **copiado en cada etiqueta**.
2. **Una regla de negocio en tres formas y cuatro copias.** `docParties` definida en `quotes.js`,
   `pedidos.js`, `albaranes.js` y `purchase-orders.js` — las tres de venta **idénticas carácter por
   carácter**, 14 líneas— más el tercer camino de la factura y el ticket.
3. **Un logo prometido y no cumplido.** El panel «Pon en marcha tu negocio» dice literalmente *«Tu
   logo… cambia que tu cliente reciba algo con tu cara en vez de un papel anónimo»*. El dueño lo
   subía y **no salía en ningún documento**: el único sitio del producto que lo pintaba era la
   tienda, que está congelada.

**QUÉ SE ENTREGÓ:**

- **C0-1 · `modules/erp/documentos.js`, y `partesDe` definida UNA vez** en todo el producto
  (comprobado contando definiciones). Los seis papeles la llaman, la factura y el ticket incluidos.
- **C0-2 · un solo dialecto:** los cuatro papeles que iban a mano pasan a `membreteHtml`, que usa las
  clases `.doc-*` que ya existían. **No nace un dialecto nuevo.**
- **C0-3 · el logo sale, y por el único camino que no compromete nada.** Deja de ser una URL: se
  **sube** (PNG/JPG/WebP, **2 MB**), se valida **por los primeros bytes y no por la extensión** —un
  `.exe` renombrado a `.png` se rechaza—, se guarda como adjunto del propio negocio y **se incrusta**
  en el papel (`data:`). **Ni una petición saliente**: enlazarlo habría hecho que cada PDF llamara al
  host que dijera quien editó ese campo —SSRF de manual— y habría atado tus facturas a un servidor de
  terceros. Congelado como el resto del membrete (`company_logo_id` en los cinco documentos): cambiar
  el logo hoy **no reescribe una factura de marzo**.
- **Y la orden de compra gana PDF**, que era el único de los seis sin descarga: mismo camino que los
  otros cinco, ni un generador nuevo.

**⚠️ C0-4 · LO QUE SÍ CAMBIA A LA VISTA, DICHO ANTES DE COMMITEAR.** Unificar el dialecto mueve tres
cosas, y son exactamente lo que significa unificar: el rótulo «Emisor / Cliente» pasa de **peso 600 a
500 con un pelo de espaciado**, la separación entre columnas de **32 a 28 px** y el margen inferior de
**24 a 26 px**. Los cuatro papeles pasan a verse **igual que la factura**. **El contenido no cambia**:
cada papel sigue pintando SUS campos.

**DOS FALLOS MÍOS QUE CAZÓ EL PROPIO GATE, Y LOS DOS ERAN GORDOS:**

1. **Puse la migración del logo ANTES de que existieran las tablas.** Un negocio nuevo moría en el
   alta con «no such table: invoices». **El alta de negocios estuvo rota** hasta que el gate levantó
   su primer negocio de cero — que es exactamente para lo que los gates levantan negocios de cero.
   Movida al final de `runMigrations`, y comprobado creando una base desde cero.
2. **Rompí un INSERT ajeno.** Al añadir la columna a los cinco INSERT de facturas con una sustitución
   por patrón, amplié **seis** `VALUES` y solo había cinco: el sexto era `invoice_anulaciones`, que se
   quedó con un `?` de más. Cazado contando marcadores contra columnas **en todos los INSERT de los
   cinco ficheros**, no a ojo.

**VERIFICACIÓN — `gate-documentos`: 55 aserciones, 0 fallos, contra la dirección pública.**

**⚙️ CORREGIDO EL 21 AGO, DESPUÉS DE ENTREGAR: EL GATE VIGILABA CUATRO PAPELES, NO SEIS.** La entrega
afirmó «el logo sale en los seis» y lo comprobado eran **cuatro** — faltaban el **albarán** y el
**ticket de mostrador**. Medido al revisarlo: **el producto estaba bien, el logo salía en los seis**;
lo que iba por detrás era la verificación, que es peor que un fallo, porque una afirmación sin
comprobar detrás se cree. Ampliado: los seis **en pantalla** y los seis **dentro del PDF** (contando
las imágenes incrustadas: un papel con logo trae una y uno sin logo, ninguna). El ticket no tiene
pantalla —solo PDF—, así que su papel se mide llamando al mismo constructor que usa esa ruta, y su
congelado, en la base.
- **Reversión de C0-1, C0-2 y C0-3** por separado: **sin C0-1 → 2 rojos** (vuelven a ser dos
  definiciones de la regla) · **sin C0-2 → 2** (reaparece el estilo a mano en el presupuesto) ·
  **sin C0-3 → 1, y es el gordo**: el logo desaparece de **los cuatro** papeles a la vez. El gate
  llegó al final en las tres.
- **Y CUATRO ASERCIONES MÍAS ESTABAN MAL, no el producto:** tres buscaban «hay un `data:`» para decir
  «hay logo» — **y el QR de Veri*Factu también es un `data:image/png`**, así que daban por puesto un
  logo que no estaba. El `<img>` del logo lleva ahora **marca propia** (`data-membrete="logo"`) y la
  comprobación dice lo que cree decir. La cuarta usaba `""` dentro de un SQL, que en SQLite es un
  **identificador y no una cadena**.
- **Y otra cosa que me cacé al declarar el gate:** mi primera regla `AFECTA` ponía
  `routes/(quotes|invoices|…) → ['documentos']` **delante**, y como manda la primera regla que casa,
  un cambio en facturas habría dejado de despertar a `margen` y `clientes`. **Menos cobertura
  disfrazada de más.** Ahora cada regla lleva sus grupos de siempre **más** `documentos`, y está
  comprobado fichero a fichero que no se pierde ninguno.

**LO QUE C-0 LE DEJA SERVIDO A C.** `membreteHtml()` **es ya la fuente única del membrete**, y eso
convierte **C10-f** en algo que se hereda en vez de construirse: el motor de listados no necesita su
propio membrete, usa éste. Si al llegar a C hiciera falta un campo que el membrete de documentos no
tiene, **se amplía el único** — y eso se para y se dice antes, no se resuelve creando el segundo.

**FICHA DE `gate-documentos` — DECLARADO, QUE NO ES EJECUTADO.**

| | |
|---|---|
| **Nombre** | `scripts/gate-documentos.mjs` |
| **Aserciones** | **55** (0 fallos el 21 ago 2026) |
| **Duración** | **~90 s** (genera PDF de verdad, que es lo que más cuesta) |
| **Clase** | **propio** (`EMPIEZAN_DE_CERO`) — levanta **dos** negocios suyos: uno con logo y otro sin él, y el segundo sirve además para probar que un negocio no ve el logo del otro. |
| **Grupo** | **`documentos`**, propio y no dentro de `ventas`: lo que vigila cruza venta y compra y además Ajustes. El barrido pasa de **80 a 81** comprobaciones |
| **Contra** | `https://<slug>.bamburu.com` |
| **Depende del reloj** | **No.** Fecha los documentos con el día de hoy calculado en el momento. |

**TABLA `AFECTA`.** Cinco reglas nuevas, cada una **sumando** `documentos` a los grupos que ese
fichero ya despertaba: `documentos.js` y `attachments.js` · `quotes|pedidos|invoices|mostrador` ·
`albaranes` · `purchase-orders` · `settings`. Comprobado **ejecutándolas** contra las siete rutas
reales y verificando que **ningún grupo anterior se pierde**.

#### D. ANALÍTICAS — INFORMES A MEDIDA · ✅ **HECHO (23 ago 2026)** · commits `e16bd01` + `fb5db14` + `bcd826c` · **5 de 5**

> **D. ANALITICAS — INFORMES A MEDIDA.**
> Palabras del dueño: "en analiticas lo principal es que el cliente pueda elaborar informes segun su requerimiento y no mostrar una serie de datos donde el mismo se pierde".
> **D1** El cliente compone SU informe: elige que mide, por que lo agrupa y en que periodo.
> **D2** Dejar de volcar un muro de datos por defecto.
> **D3** Guardar informes compuestos para reutilizarlos.
> **D4** Pendiente conocido de antes: el constructor de analiticas no sabe expresar datos de agenda (los avisos de agenda no tienen grafico que los acompañe). Entra aqui.
> **D5** Enlaza con C: un informe compuesto debe poder imprimirse y descargarse.

**⚙️ ESTO ERA EL ESTADO ANTES DE LA ENTREGA DEL 23 AGO. Se conserva porque es el registro de lo que
se creía, y se corrige EN EL SITIO lo que no era exacto.** El **constructor de analíticas**
(`modules/erp/constructor-analitica.js`, escalera pasos 4a/4a-bis/4b) ya dejaba **elegir medida,
dimensión y periodo** sobre **cinco áreas** (Ventas · Compras · Clientes · Inventario ·
Contabilidad), con cálculos propios y paneles **guardados y compartibles** (`listarPaneles`).
- **D1 → lo que falta es el ÁREA DE AGENDA**, que es exactamente **D4**. **D1 y D4 son la misma
  pieza**, no dos. → **Era CIERTO, y el 23 ago se comprobó contra el código**: `dibujo.js` declaraba
  los cuatro avisos de agenda «sin gráfico» con el motivo escrito. **Hecho: el área existe.**
- **D2 sigue entero:** `/admin/analytics` abre con **4 KPIs + gráficos fijos** por defecto
  (~~`modules/erp/routes/analytics.js:334-364`~~ — **referencia derivada, corregida el 23 ago: los
  KPIs estaban en `:347-352` y los gráficos en `:354-364`; hoy ninguna de las dos existe, la fila de
  KPIs se retiró**) — el muro que el dueño describe. **Hecho.**
- ~~**D5 sigue entero:** hoy un informe compuesto solo sale en **CSV** (`informes.csv`); **no hay PDF
  ni impresión**.~~ **⚠️ ESTA FRASE ERA FALSA y se tacha con su motivo (23 ago 2026).** `informes.csv`
  **no tiene nada que ver con un informe compuesto**: exporta los DIEZ informes fijos de la pestaña
  «Informes por área» (`routes/analytics.js`, `/export/informes`). Un informe compuesto **no salía de
  la pantalla de ninguna forma** — la tarjeta «Construye tu gráfico» no tenía ni un botón de
  exportar. El alcance real de D5 era mayor que lo que decía esta línea. **Hecho: los tres verbos.**
- **D3 estaba a medias y aquí no se decía:** se podía guardar y **no se podía deshacer** — ni borrar
  (el endpoint existía y no lo llamaba nadie), ni renombrar, ni descompartir, y cada «Guardar» dejaba
  un duplicado. **Hecho.**

---

#### E. PANTALLA DE INICIO — FICHAS COMO WIDGETS · ✅ **HECHO (23 ago 2026)** · commit `c3b2d6a` · **4 de 4**

> **E. PANTALLA DE INICIO — FICHAS COMO WIDGETS.**
> Palabras del dueño: "la pantalla de inicio deberia permitir organizar cada ficha como widgets, bien sea de posicion".
> **E1** Cada bloque del Inicio se puede mover de posicion.
> **E2** La colocacion se guarda por usuario.
> **E3** Poder ocultar y volver a mostrar un bloque.
> **E4** Volver a la colocacion de fabrica en un clic.

**⚙️ CORREGIDO: E1–E4 ya existen… pero solo para UNA PARTE del Inicio.** El Inicio personalizable es
el **peldaño 6** de la escalera (`modules/erp/inicio-layout.js`): rejilla arrastrable, paleta de
bloques, quitar bloque, «Personalizar», «Volver al de fábrica», guardado **por usuario** con cascada
`usuario > empresa > fábrica` (`routes/inicio.js:122-155`).
- **Lo que NO se puede mover, ocultar ni reordenar hoy** es justo lo que ocupa la mayor parte de la
  pantalla: **las 10 secciones fijas del CUADRO DE MANDO** (`modules/erp/cuadro-mando.js:120` —
  hoy · ventas · cobro · margen · clientes · gráfico · productos · mejores · oportunidades · decide)
  y el **panel «Pon en marcha tu negocio»** (que solo se pliega). La rejilla personalizable **queda
  debajo** y de fábrica trae **un solo bloque** («Avisos pendientes»).
- **La tarea E, por tanto, es EXTENDER lo que ya existe al cuadro de mando** — no construirlo de
  cero. Y la tabla ya está: `dashboard_layouts`. **Cero tablas nuevas.**
- **⚙️ LO QUE LE DEJA LA FICHA D (23 ago 2026), para que E no se lo encuentre de sorpresa.** La ficha
  D **no ha tocado el Inicio** ni `inicio-layout.js`, y se comprobó en el gate que `/admin` sigue
  respondiendo. Pero le cambia el terreno en dos cosas, las dos a favor:
  **(1)** la rejilla del Inicio ya sabía pintar un informe del constructor como widget (`tipo:'panel'`,
  `inicio-layout.js:148`), y ahora **hay un área más** (Agenda): un informe de agenda se puede anclar
  al Inicio sin escribir una línea, porque `permDeBloque` resuelve el permiso por el área de la receta.
  **(2)** los informes guardados **ya se pueden borrar y renombrar**, así que E tiene que contar con
  que un widget puede quedarse apuntando a un informe que ya no existe — eso ya estaba previsto
  (`permDeBloque` devuelve `__inexistente__` y el bloque **cae cerrado**), pero antes no podía pasar
  nunca y ahora sí. **Merece una comprobación propia cuando se aborde E.**

**LO ENTREGADO (23 ago 2026, noche · punto 2 del encargo nocturno) · gate
`scripts/gate-inicio-widgets.mjs` · 30 ✓ · 0 ✗**

- **LA UNIDAD ES LA TARJETA QUE SE VE, no la sección del motor.** `cuadro-mando.js` tiene **diez**
  secciones y la pantalla las agrupa en **SIETE tarjetas** (ventas + cobro + margen + clientes son
  «Tus números»; productos + mejores son «Tu negocio en cifras»). **Mover media tarjeta no significa
  nada**, así que la rejilla trabaja sobre las siete: `hoy · numeros · grafico · cifras · oport ·
  decide · arranque`.
- **E1 · cada ficha se mueve.** Arrastrando —**el MISMO Sortable de la rejilla de abajo**, no una
  segunda librería— y con botones **subir/bajar**, porque arrastrar no funciona con el teclado y en un
  móvil pequeño es incómodo. **Las dos vías escriben lo mismo.**
- **E2 · se guarda por usuario.** Misma tabla `dashboard_layouts` y la misma cascada del peldaño 6:
  **CERO TABLAS NUEVAS**, como decía este registro. Medido **RECARGANDO**, que es la única forma de
  saber que se guardó de verdad y no solo en la pantalla de esa sesión; y comprobado que **otro
  usuario NO hereda** la colocación ajena.
- **E3 · esconder y volver a mostrar.** Lo escondido **se LISTA** en una barra («Escondidas: El
  gráfico del mes · volver a mostrar»): **esconder no puede ser perder**, o el dueño se queda sin
  media pantalla y sin saber por qué.
- **E4 · volver a fábrica en un clic**, y el servidor **borra** la colocación propia en vez de
  sobreescribirla con una copia de la de fábrica: así, si mañana se añade una tarjeta nueva, la ve.
- **El modo colocar arranca APAGADO** y no se queda pegado entre visitas: quien no quiera tocar nada
  ve la pantalla **exactamente igual que antes**, sin un solo mando a la vista. Comprobado.
- **`sanearCuadro` tira los ids inventados y los duplicados, y añade al final las tarjetas nuevas**
  que no estuvieran en la colocación guardada. Una colocación vieja nunca puede esconder una tarjeta
  que aún no existía cuando se guardó.
- **EL AÑADIDO, que es el aviso que dejó la ficha D tres párrafos más arriba:** se creó un informe, se
  ancló a la rejilla como widget y **se borró el informe**. El bloque **desaparece** y el resto de la
  rejilla sigue vivo — no queda un hueco mudo. La primera pasada del gate lo daba por bueno **por el
  motivo equivocado** (`1 bloque` de partida, no 2): el fixture estaba mal escrito —un bloque nativo
  lleva su clave en `tipo`, no en un campo `ref`—, **no el producto**.

---

#### F. MAPA EN LA FICHA DE CLIENTE · ✅ **HECHO (23 ago 2026)** · commits `27b0de4` + `d467b66` · **4 de 4**
> **SEGUNDA ENTREGA (23 ago, `d467b66`) — DOS CORRECCIONES DEL DUEÑO SOBRE LA F YA ENTREGADA.**
> Registrada aquí el mismo día por la sesión que hizo el cierre: **el commit se hizo y no se empujó,
> y su gate ampliado se había quedado sin ejecutar.** Se ejecutó — **54 OK · 0 fallos** — y se empujó.
> - **La dirección se escribía a ciegas.** Ibrahin guardó «Cuesta de San Francisco 8, Getafe» y no
>   salió mapa: **esa calle no existe en Getafe** (está en Las Rozas) y el buscador devolvía vacío.
>   Ahora **se escribe, se elige de una lista, y el punto que se guarda es EL ELEGIDO** — no se
>   vuelve a buscar, así que el mapa no puede acabar en otro sitio.
> - **El buscador del tecleo es PHOTON, no Nominatim, y no es preferencia:** la política de la OSM
>   Foundation lo prohíbe con todas las letras (*«Auto-complete search: … you must not implement such
>   a service»*). Montarlo contra Nominatim arriesga que **bloqueen la IP del servidor, y con ella el
>   mapa entero**. Pasa por nuestro servidor con caché, como las teselas.
> - **Dos defectos que las aserciones en verde no vieron y la captura sí:** las farmacias españolas
>   se registran en OSM con el nombre de su titular, y salía **la persona delante de la dirección**;
>   y cuando el resultado ES la calle, el nombre y la calle **salían dos veces**. La etiqueta se
>   compone ahora solo con la dirección.
> - **La PROVINCIA no se rellena a propósito:** Photon devuelve la comunidad autónoma («Comunidad de
>   Madrid»), no la provincia («Madrid»), y ponerla mal **rompería el Facturae de ese cliente**.
> - **El mapa, también en el resumen de la ventana del cliente** (150 px; 130 en móvil), entre los
>   contadores y «Qué te compra». **No se ha copiado:** el pintor sale al componente compartido
>   (`BF.pintaMapa`) y lo llaman las **tres** superficies.
> - **Y una aserción suya llevaba un `|| true`** — habría dado verde con la puerta abierta. La
>   sustituyó por una que puede fallar de verdad: sin sesión, `/api/erp/mapa/sugerencias` da **401**.

> **HECHOS (23 ago 2026): F1 · F2 · F3 · F4.**
> **⚠️ AUTORÍA, y conviene que conste: el código lo escribió OTRA SESIÓN** que trabajaba en paralelo
> en este mismo árbol y lo dejó **terminado pero sin commitear y sin ejecutar su gate ni una vez**.
> La sesión que cerró B lo revisó, corrió su gate por primera vez y lo entregó **sin cambiar ni una
> línea de su código**.
> - **F1 · OpenStreetMap, no Google.** Leaflet 1.9.4 vendorizado (BSD-2-Clause, con su LICENSE) en
>   `public/vendor/leaflet`.
> - **F2 · El mapa, con el punto del cliente.** El punto vive en **`client_geo`, tabla propia: NO se
>   toca `clients`**. Lleva la **huella** de la dirección que se resolvió, así que un cliente que se
>   muda **deja de enseñar la chincheta de su casa anterior** en vez de enseñarla con aplomo.
> - **F3 · «Cómo llegar»** con el punto del cliente.
> - **F4 · Sin dirección no se pinta nada:** la caja queda oculta y **a cero de alto**, no un mapa
>   del océano. Igual para el que se mudó y para el que no se pudo resolver.
> - **Cuándo se resuelve:** AL GUARDAR, una vez, y desde `createClientSvc` — así sale igual si el
>   alta la hace una persona o la dicta DISA. **Sin `await`:** que un buscador de fuera no conteste
>   no puede tumbar el alta de un cliente.
>
> **VERIFICADO: `gate-mapa-cliente`, ejecutado por primera vez, 38 OK · 0 fallos.** Comprueba lo que
> importa: **el navegador NO habla con ningún dominio ajeno** y las teselas se le piden a Bamburu
> (12 por `/api/erp/mapa/tesela/`); el nombre con carga **XSS** no se ejecuta; y la ruta de teselas
> rechaza zoom inexistente, coordenada negativa, coordenada decimal y el intento de **salir de la
> carpeta**. **Las reversiones de esta ficha NO las hizo quien la entregó:** su gate es el que hay.
>
> **✅ YA DECIDIDO POR IBRAHIN, y no queda nada que preguntar aquí.** El aviso de abajo pedía
> confirmar con él lo de *«sin dependencias externas»* **al abrir F**, y se hizo: se le plantearon las
> opciones para las teselas y **eligió «por nuestro servidor, con caché»** — Bamburu se las pide a OSM
> **una vez** y las guarda en disco; a partir de ahí salen de nuestro disco. Su frase del encargo,
> *«para no depender de un servicio ajeno cada vez que se abre un cliente»*, dice lo mismo: **lo que
> descartó es la dependencia POR VISITA**, no que el servidor consulte una vez.
> **⚠️ ESTA LÍNEA ESTUVO MAL UNAS HORAS Y SE CORRIGE AQUÍ (23 ago, cierre).** Al cerrar F desde otra
> sesión se escribió como «pendiente de decidir», porque quien cerraba **no tenía delante esa
> conversación**. Lo avisó la sesión que construyó F. Se deja escrito en vez de borrarlo porque el
> daño de un pendiente falso es concreto: **manda al siguiente chat a preguntar otra vez algo ya
> resuelto**, que es justo lo que este bloque existe para evitar.

> **F. MAPA EN LA FICHA DE CLIENTE.**
> Palabras del dueño: "se puede mejorar la ficha de cliente incluyendo google maps o open maps".
> **F1** DECISION TECNICA TOMADA: OpenStreetMap. Google Maps obliga a cuenta de facturacion y clave y cobra por vista. NO se usa Google.
> **F2** Mapa en la ficha con la direccion del cliente.
> **F3** Enlace para abrir la ruta en la aplicacion de mapas del movil.
> **F4** Si el cliente no tiene direccion, el bloque no se pinta. No enseñar un mapa del oceano.

**⚙️ CONFIRMADO: no existe ningún mapa en la plataforma.** Cero referencias a OpenStreetMap,
Leaflet o Google Maps en todo el código. La ficha de cliente ya tiene el campo `direccion`
(`ficha-cliente-ui.js:923`), así que F4 se puede resolver con el dato que ya hay.
**Aviso para cuando toque:** el enunciado dice *«sin dependencias externas»* (GRUPO 2) y un mapa
**carga teselas de un servidor ajeno**; hay además una CSP por superficie en el proyecto. **Es una
decisión a confirmar con Ibrahin al abrir F**, no aquí.

---

#### G. PORTAL DEL CLIENTE — AMPLIACIÓN · ✅ **HECHO lo construible (23 ago 2026)** · **G1 y G2 cerrados · G3 ya estaba · G4 bloqueado fuera · G5 abierto a propósito**

> **G. PORTAL DEL CLIENTE — AMPLIACION.**
> Palabras del dueño: "el portal del cliente hoy solamente dice las facturas pendientes, este portal es una ventaja que ofrecemos, tambien debe ofrecer funciones como analiticas, manejo de comunicaciones, pago de facturas etc".
> **G1** Analiticas propias del cliente (que compra, cuanto, cada cuanto).
> **G2** Canal de comunicaciones entre el negocio y su cliente.
> **G3** ~~Historial completo de documentos con descarga en PDF (enlaza con C).~~ **RETIRADO (21 ago 2026):** el portal ya lista TODAS las facturas y ya baja el PDF de cada una.
> **G4** El pago de facturas va al GRUPO 4: necesita pasarela contratada.
> **G5** El "etc" del dueño NO se da por cerrado.

**⚙️ CORREGIDO: el portal enseña algo más que las pendientes.** Hoy (`modules/portal/index.js:31`)
lista **TODAS las facturas del cliente** —pagadas y pendientes, con su estado derivado de
cobros/conciliación, nunca de lo que diga el cliente—, el **total pendiente**, los **datos de
transferencia (IBAN)** y **descarga en PDF de cada factura** (`/portal/:token/factura/:id/pdf`).
Acceso por **enlace mágico con token temporal**, solo lectura.
- **G3 · RETIRADO el 21 ago 2026 por decisión de Ibrahin**, por estar ya hecho: el portal **lista
  todas las facturas** (no solo las pendientes) y **baja el PDF de cada una**. *Queda anotado, sin
  ser subpunto de G:* presupuestos, pedidos y albaranes no bajan del portal — eso entra con **C**,
  que es donde vive el motor de documentos.
- ~~**G1 y G2 no existen** en absoluto.~~ **Desmentido el 23 ago 2026 (noche): construidos los dos.**
- **Ojo al puntero caducado:** el Backlog de este TABLERO (§Ventas, portal y recurrentes) dice que el
  pago con tarjeta es *«el único paso que falta del portal»*. **Con G eso deja de ser cierto** y esa
  línea queda desmentida por este registro. **Y con G1 y G2 ya hechos, vuelve a ser casi cierto: hoy
  el pago con tarjeta SÍ es lo único que le falta al portal, y está fuera por falta de pasarela.**

**LO ENTREGADO (23 ago 2026, noche) · gate `scripts/gate-portal-ampliado.mjs` · 35 ✓ · 0 ✗**

- **G1 · «Tu histórico con ‹empresa›».** Cinco cifras —compras, total sin IVA, media por compra,
  **cada cuánto compra** y cuánto hace de la última—, **qué compra** (sus ocho líneas más caras, con
  barra) y **por año**. Todo del propio cliente y de nadie más.
  - **Se calcula con el MISMO criterio que su lista de facturas** (`countsAsReceivable`): una factura
    anulada no le infla el histórico. Si las dos cifras no cuadraran a dos centímetros de distancia
    en la misma pantalla, el portal estaría mintiendo; el gate lo comprueba metiendo una anulada.
  - **«Cada cuánto» es la MEDIANA de los días entre compras, no la media.** Una compra grande y rara
    dispara el promedio y le diría a un cliente mensual que compra cada tres meses.
- **G2 · «Hablar con ‹empresa›».** Un hilo por cliente, en las dos direcciones, tabla
  `portal_mensajes` (aditiva). El cliente escribe desde su portal —**formulario normal: el portal no
  lleva JavaScript y no se le mete uno para esto**— y el negocio desde `/admin/portal/mensajes/:id`,
  con contador de **sin leer** por cliente y aviso en la portada del portal. **No hay borrado:** una
  conversación con un cliente es registro.
  - Del lado del negocio se guarda y se enseña **quién contestó** («lo contestó Marta»). **Al cliente
    no se le enseña**: para él el interlocutor es la empresa. El gate mide las dos cosas.
  - Un mensaje en blanco o de solo espacios **se rechaza y se dice por qué**; no hay silencio.
- **Lo primero que mide el gate no es que funcione, sino que no se abre lo ajeno:** el portal es la
  única pantalla del producto sin sesión. Token inventado, token de OTRO cliente, caducado y
  revocado: los cuatro comprobados.
- **Las facturas que siembra el gate entran en la cadena propietaria con su hash bien calculado.**
  Meterlas en blanco dejaría la pantalla de Integridad en ALARMA mientras corre —y para siempre si el
  gate muriera antes de limpiar—, que es justo la avería que se recompuso esa misma tarde. El gate
  verifica la cadena al final: **836 facturas, cuadra**.
- **Corrido dos veces, y se dice por qué:** la primera pasada (32 ✓ · 1 ✗) destapó que `mensajesDe`
  no leía la columna `admin_user_id` que sí se estaba guardando —el dato existía y no lo veía nadie—.
  Arreglado eso y enseñado en la pantalla del negocio, la segunda pasada dio 35 ✓ · 0 ✗.
- **Sin residuo:** 0 clientes, 0 facturas, 0 mensajes y 0 sesiones del gate en `desarrollo-bamburu`
  al terminar, medido.

**LO QUE NO ENTRA, Y POR QUÉ**
- **G4 · pago de facturas con tarjeta: BLOQUEADO FUERA DEL CÓDIGO.** Necesita una **pasarela
  contratada** (Stripe/Redsys: alta, credenciales, comisiones) y eso es una decisión de negocio de
  Ibrahin, no una tarea de construcción. Sigue en el **GRUPO 4**, donde ya tiene ficha propia: es
  exactamente la **ficha J**. Lo que sí está listo para cuando llegue: la factura, su estado derivado
  y el IBAN ya viven en el portal. **Y sigue vigente la norma del 28 jul 2026 que prohíbe dejar
  ganchos preparados para la pasarela**: no se ha dejado ninguno.
- **G5 · el «etc» del dueño no se da por cerrado**, por decisión suya. No es un subpunto construible:
  queda abierto a propósito para lo que él quiera añadir.

**CABO MENOR APUNTADO (no tocado):** el portal escribe el dinero a la inglesa —`€6023.00`, sin
separador de miles y con punto decimal—. **No es de G1: la tabla de facturas ya lo hacía antes**, y
cambiar solo el bloque nuevo dejaría dos formatos en la misma pantalla. Se arregla el portal entero
de una vez, cuando toque.
>
> ↪️ **Convertida a formato de orquestador el 31 ago 2026** — id `portal-formato-dinero`,
> en §«TAREAS EN FORMATO DEL ORQUESTADOR». Esta prosa se conserva tal cual.

---

#### H. IMPORTADOR DE CSV GENÉRICO · ✅ **HECHO (23 ago 2026)** · commit `d55dd8b` · **3 de 3**
> **⚠️ AÑADIDO DESPUÉS (23 ago, cierre) · commit `cb4a347`. SU GATE SE HABÍA ENTREGADO SIN CORRER, y
> al correrlo NO PASABA.** `session.json` lo dejó apuntado como pendiente y bien: el gate moría en el
> bloque [4] esperando la vista previa.
> - **La causa no era el producto: era el nombre del fichero de prueba del propio gate.** Se llamaba
>   `.gate-imp-XXXX.csv`, **con punto delante**. El confinamiento del snap de Chromium concede
>   `$HOME/[^.]**` — todo **menos lo oculto** —, así que el navegador **ve** el fichero y da bien su
>   `size`, pero al leerlo devuelve `NotReadableError`. Ya estaba fuera de `/tmp` por la lección
>   anterior; **la regla real es más amplia que `/tmp`**. Quitado el punto, pasa.
> - **Y al diagnosticarlo salió un defecto de verdad, este sí del producto:** cuando el `FileReader`
>   falla, el manejador dejaba el botón **deshabilitado en «Leyendo…» PARA SIEMPRE**. Se veía el
>   aviso y detrás quedaba **un mando muerto**, sin más salida que recargar. Arreglado: `leeFichero`
>   acepta un tercer argumento para el fallo y el botón vuelve a su sitio.
> - **El rojo queda convertido en cobertura:** dos aserciones nuevas suben un fichero
>   **deliberadamente ilegible** —oculto, el mismo truco— y exigen que el botón se recupere y que no
>   se abra una vista previa vacía. **Provocado de verdad, no simulado.**
> - **`gate-importador-csv`: 53 aserciones, todas en verde.** Reversión hecha: al quitar la
>   recuperación del botón, cae con «Leyendo… · DESHABILITADO».

> **H. IMPORTADOR DE CSV GENERICO.**
> **H1** ~~Clientes, productos y facturas desde CSV.~~ ✅ **Clientes y productos por CSV. LAS FACTURAS NO, POR DECISIÓN DEL DUEÑO (23 ago 2026): se quedan en la migración asistida.**
> **H2** ✅ Previsualizacion antes de importar y posibilidad de deshacer.
> **H3** ✅ Complementa la migracion asistida, NO la sustituye ni la retira.

**⚙️ CONFIRMADO AL EMPEZAR: no existía.** Lo único que importaba ficheros era la **conciliación
bancaria (Norma 43)** (`modules/erp/routes/conciliacion-routes.js`), que no es un importador de datos
de negocio.

**QUÉ HAY AHORA.** `modules/erp/importador.js` (el motor) + `modules/erp/routes/importador.js` (la
pantalla y la API), colgando de **`/admin/migracion/importar`** — dentro de la migración asistida, no
al lado. Tres pasos: subir → revisar → confirmar.

- **H1 · CLIENTES Y PRODUCTOS.** 13 campos de cliente y 9 de producto, con automapeo por el nombre de
  la columna (dos pasadas: exacta primero, para que «Precio» no se lo lleve «Precio anterior») y
  corrección a mano de cualquier columna. Lector de CSV propio: comillas, comas y saltos de línea
  DENTRO del campo, BOM de Excel, separador adivinado (`;` `,` tab `|`) y **juego de caracteres
  detectado** (UTF-8 y, si aparece el carácter de reemplazo, Windows-1252 — que es lo que escribe
  Excel en español). Números a la española: `1.234,56 €` → `1234.56`.
- **NO HAY UN SEGUNDO CAMINO DE ALTA.** Escribe por `createClientSvc` / `createProductSvc`, los
  servicios compartidos del patrón T5. Aquí no hay ni un `INSERT INTO clients`.
- **LA VISTA PREVIA VALIDA CON EL VALIDADOR DE VERDAD** (`clientSchema` / `productSchema`,
  `fiscalIdConflict`, las bandas de `core/vat-bands.js`), no con una segunda copia de las reglas. Los
  mensajes de Zod se traducen al castellano para que digan **qué columna** y **qué pasa**.
- **EL IVA NO CAE A UN DEFECTO SILENCIOSO.** `tax_band` es obligatoria en el formulario y aquí
  también. Si el fichero no trae columna de IVA, el dueño **elige** la banda para todo el fichero en
  la propia pantalla: eso es una decisión visible antes de confirmar, no un 21% puesto a su espalda.
- **H2 · LA VISTA PREVIA NO ESCRIBE NADA.** Medido contando filas en la base antes y después de tres
  análisis (uno remapeado): la tabla no se mueve. Cancelar no deja rastro porque no hay rastro.
- **H2 · DESHACER ARCHIVA, NO BORRA.** Tablas `importaciones` + `importacion_items` (aditivas, sin
  DROP, fuera de WRITABLE_TABLES). Deshacer pone `active=0` / `status='archived'`, que es lo que hace
  el botón de archivar de cada pantalla. Se dice en pantalla con esas palabras, y se dice también qué
  NO deshace: una factura hecha a un cliente importado se queda, y su movimiento de stock también.
- **O ENTRA TODO O NO ENTRA NADA**, y no de palabra: una transacción de SQLite. Comprobado
  **provocando** un fallo en la tercera fila con un disparador — no quedan ni las dos anteriores, ni
  el lote a medias, ni el contador de códigos internos gastado.
- **H3 · LA ASISTIDA NO SE TOCA.** Sigue entera, sigue ofreciéndose **primero** en su pantalla y
  sigue siendo la **única** vía para facturas. El importador es una tarjeta debajo. Un solo retoque
  de texto en la asistida: decía «ni pelearse con ningún importador», que dejaba de ser verdad con
  uno nuestro tres centímetros más abajo.

**⛔→✅ H1 · LAS FACTURAS: SE PARÓ ANTES DE CONSTRUIR, SE PREGUNTÓ, Y EL DUEÑO DECIDIÓ.**

> **DECISIÓN DE IBRAHIN, 23 ago 2026:** *las facturas no entran por CSV; se quedan en la migración
> asistida, que es lo que ya hacía.* Con eso **H1 queda cerrado con su alcance acotado**: el
> importador trae clientes y productos, y las facturas las sigue pasando una persona del equipo.
> **No es una función pendiente: es una función que no se hace, y por este motivo.**

Se le presentaron tres caminos y eligió el primero. Los otros dos quedan escritos **por si algún día
se reabre**, no como deuda: (b) un **archivo histórico de solo lectura** —entidad nueva, fuera de
`invoices`, fuera de la cadena y fuera de la AEAT, conservando número y fecha originales, con la
pregunta abierta de si cuenta en Analítica y en el Libro de ventas—; y (c) **emitirlas de verdad**,
que es lo que haría `createInvoice` hoy y **duplicaría la declaración**. La (c) no se recomendó.

**EL PORQUÉ, QUE ES LO QUE NO CADUCA.** Meterlas exigía un
**camino de emisión nuevo**, y eso no se abre sin decisión del dueño. El único camino vivo es
`createInvoice` (`routes/invoices.js`; `generateInvoice` está retirado con un 410) y hace **siempre**
tres cosas que una factura importada no tolera:

| | Qué hace `createInvoice` | Por qué rompe una factura importada |
|---|---|---|
| 1 | Correlativo NUEVO del año EN CURSO (`getNextSeq`) | La `FAC-2024-0012` de Holded se convierte en `F2026-00NN`. El número es lo que la identifica ante Hacienda y ante el cliente que ya la recibió. |
| 2 | Registra el ALTA en la cadena legal (`recordVerifactuAlta`) con la marca de tiempo de AHORA (`genTimestampMadrid`) | `verifactu.js:12` ya lo dejó escrito: las facturas anteriores **no** se registran retroactivamente, porque no tenemos su `FechaHoraHusoGenRegistro` real y backdatearla **falsearía la huella**. |
| 3 | La encola para remitirla a la AEAT (`encolarSiProcede`) | Declararía **por segunda vez** facturas que el programa anterior ya declaró. |

Saltarse cualquiera de los tres es abrir una segunda puerta de emisión al lado de la única que hay.
**El tipo «facturas» no existe en el importador y se rechaza con un 400**, y el gate lo comprueba —
así que el día que alguien lo añada, esto se pone rojo y le obliga a leer este bloque antes de seguir.
**Ojo con K:** los importadores de Holded y Quipu siguen BLOQUEADOS y, cuando lleguen sus ficheros
reales, se toparán con esta misma pared en cuanto traigan facturas. La decisión de hoy es la respuesta
por adelantado.

**COMPROBACIÓN PROPIA:** `scripts/gate-importador-csv.mjs` — 11 bloques, negocio propio
(`EMPIEZAN_DE_CERO`), declarado en `GRUPOS.clientes`. **ESCRITO Y NO EJECUTADO**: la norma de
`RITUAL.md` §LA REGRESIÓN dice que ni el gate de la propia tarea se corre sin que Ibrahin lo pida, y
este encargo no lo pedía arriba. Lo que SÍ se ha hecho es ejercitar el código escrito (motor contra
una BD nueva, API y pantalla contra el servidor vivo, y el recorrido del encargo en un navegador de
verdad): 60 aserciones en verde, ninguna de ellas un gate registrado ni un barrido.

---

## GRUPO 3 — BARRIDO

#### I. MEJORA VISUAL GENERAL DE BAMBURU · ✅ **HECHO (23 ago 2026)** · **3 de 3** · *llegó al final, como debía*

> **I. MEJORA VISUAL GENERAL DE BAMBURU.**
> Palabras del dueño: "mejora visual de bamburu en general".
> **I1** Aplicar el componente de tarjeta nuevo al resto de pantallas (ya estaba anotado como aplazado).
> **I2** VA DELIBERADAMENTE AL FINAL: si se hace antes que C, D, E, F y G, hay que repetirlo entero cuando lleguen esas pantallas.
> **I3** Al llegar aqui, listar pantalla por pantalla y no dar por hecho ninguna.

**⚙️ CORREGIDO (parcial): el componente existe, pero el aplazamiento NO consta por escrito.** El
componente de tarjeta nuevo es **`.bf-card`**, de la ficha de cliente
(`modules/erp/ficha-cliente-ui.js`, entregado el **19 ago 2026** como «estética de tarjetas»).
**No hay en `TABLERO.md` ni en `docs/` ninguna nota que diga «aplicar al resto de pantallas,
aplazado»** — se buscó y no aparece. Si el acuerdo se tomó de viva voz, **queda registrado aquí
por primera vez y con esa advertencia**, no como si constara de antes.
*(La lección del 19 ago sigue aplicando a I3: aquel gate medía solo `.bf-card` y no la pantalla que
lo rodea, y se comieron 17 sitios con el texto pegado al borde.)*

**LO ENTREGADO (23 ago 2026, noche · punto 4 del encargo nocturno) · gate
`scripts/gate-tarjeta-unica.mjs` · 24 ✓ · 0 ✗**

**I2 · SE CUMPLIÓ EL «AL FINAL».** I no se abrió hasta que C, D, E, F y G estuvieron cerradas —las
cinco lo están— así que no hay nada que repetir. Era la única condición del subpunto, y era una
condición de orden, no una tarea.

**I3 · LAS 56 PANTALLAS, MEDIDAS UNA A UNA — y una premisa que se cayó.** Se escribió
`scripts/inventario-tarjetas.mjs`, que **no lee el código: abre cada pantalla en un navegador con
sesión de dueño y mide sobre píxeles**. Recorre las 47 entradas del menú **más las 9 pantallas de
detalle**, que no cuelgan de él y son justo donde vivía el componente. Lo que salió:
- **El producto tenía CUATRO tarjetas de cifra distintas, no una y «el resto»:** `.bf-card` (8, solo
  en la ficha de cliente), `.kpi` (10, en Stock · Informes · Boletín · Devoluciones), `.cm-num` (4,
  en el Inicio) y `.ig-kpi-*` (4, dentro de un bloque de la rejilla del Inicio). Casi idénticas y
  ninguna sabía de la otra.
- **52 de las 56 pantallas NO tienen ninguna tarjeta de cifras, y no les falta.** Son listas de
  documentos y formularios. **«Aplicar el componente al resto» no podía significar inventarle un
  resumen a 52 pantallas**: significa que las que ya lo tenían usen la misma. Queda dicho para que
  nadie lea el ✅ como «hay tarjetas en todas partes».
- **Productos, proyectos y proveedores NO tienen pantalla de detalle** (se editan en ventana desde su
  lista). Pedirlas daba 404 y contarlo como «pantalla rota» habría sido un rojo inventado.

**I1 · AHORA HAY UNA, Y VIVE EN EL ESTILO GLOBAL.** El componente subió de
`ficha-cliente-ui.js` a `layout.js`, que es donde debe estar lo que usan seis pantallas.
- Convertidas: **Stock (4), Informes (4), Boletín (1), Devoluciones (1)** desde `.kpi`; **el Inicio
  (4)** desde `.cm-num`, con un modificador `.bf-card.grande` que le conserva su escala de titular;
  y **las cifras dentro de un bloque de la rejilla**, que pasan a la tipografía del componente **sin
  su caja** —van dentro de un bloque que ya es una caja, y una tarjeta dentro de otra es un marco de
  más—. **Quedan cero `.kpi`, cero `.cm-num` y cero `.ig-kpi-*` en todo el código**, medido.
- **A la ficha de cliente se le quitó su copia**, incluidos dos cortes de pantalla estrecha (640 y
  400 px) que pisaban a los globales **solo en esa pantalla**: un componente con dos juegos de
  cortes se ve distinto según dónde. La ficha quedó **idéntica al píxel**, comprobado con captura
  antes y después.
- **El color solo donde dice algo.** En Stock, «Stock bajo» iba siempre en ámbar y «Sin stock»
  siempre en rojo, **incluso valiendo 0**. Un cero en rojo asusta por nada y, si todo va pintado, deja
  de destacar lo que importa. Ahora se encienden cuando hay algo que mirar.

**EL TEXTO PEGADO AL BORDE — la lección del 19 ago, esta vez medida.** El barrido encontró **8 cajas
en 2 pantallas** con la prosa y los campos contra el marco: **«Mi página de reservas» (7)** —donde se
veía a simple vista: los títulos de sección tocando el borde izquierdo y los desplegables llegando al
derecho— y **«Cómo se piden las citas» (1)**. Arregladas con `.bf-caja` y separadas entre sí, que
además se tocaban. **Quedan 0.**
- **Dos falsos positivos que NO se arreglaron porque no estaban rotos**, y el instrumento aprendió a
  distinguirlos: (1) una `.card` que solo envuelve una **tabla** debe ir a borde —las celdas traen su
  relleno—; (2) la rejilla de la **agenda** declara `padding:0` a propósito. El script los cuenta
  aparte y **lo dice en voz alta**, para que nadie confunda «no aparece» con «no existe».

**LA REVERSIÓN DEL GATE.** Se apaga el componente en el navegador y se exige que la medida **caiga**:
un gate que comprobara la clase y no el estilo daría verde con el CSS borrado. Y las tarjetas de
Informes, que nacen escondidas tras un desplegable, **se prueban PULSANDO**; contarlas en el DOM y
darlas por buenas habría sido el verde por el motivo equivocado.

**⬜ LO QUE I DESTAPÓ Y NO ARREGLA — EL DINERO ESTÁ ESCRITO EN INGLÉS EN MEDIO PRODUCTO.** Conviven
`117.087,43 €` (Inicio, ficha de cliente, Informes) y **`€117087.43`** (Cobros, Stock, Rentabilidad,
y las columnas de casi todas las tablas): símbolo delante, punto decimal y sin separador de miles.
También `€-1461.93`, con el signo detrás del símbolo. **Medido: 269 `toFixed(2)` en `modules/erp`**, y
ya existe un formateador central sin usar (`fmtEur`, `margen.js:154`) y la norma escrita en el código
(*«Español de verdad: 1.234,50 €. Un €1234.5 no es una cifra de esta casa»*). **No entra en I**: I1
pedía unificar la TARJETA, y esto es un barrido de 269 sitios con riesgo real de romper cifras que se
vuelven a leer. **Merece encargo propio, y es probablemente el defecto visual más visible que queda.**

---

## GRUPO 4 — DEPENDE DE ALGO EXTERNO A IBRAHIN

#### J. PAGO DE FACTURAS EN EL PORTAL DEL CLIENTE · **BLOQUEADO** (no es PENDIENTE: no depende de nosotros)

> **J. PAGO DE FACTURAS EN EL PORTAL DEL CLIENTE. Bloqueado: requiere pasarela de pago contratada. Ya constaba fuera de alcance en el tablero.**

**⚙️ CONFIRMADO.** Consta ya en dos sitios: `TABLERO.md` §Backlog → *«Portal de cliente — pago online
(tarjeta): pasarela (Stripe u otro); necesita decisión de proveedor y coste del dueño»*, y en el
propio código (`modules/portal/portal.js:5`: *«Pago online (tarjeta) fuera de alcance»*). Además hay
una norma vigente del **28 jul 2026** que **prohíbe dejar ganchos** preparados para la pasarela.

---

#### K. IMPORTADORES DE HOLDED Y QUIPU · **BLOQUEADO** (no es PENDIENTE: no depende de nosotros)

> **K. IMPORTADORES DE HOLDED Y QUIPU. Bloqueado: hacen falta ficheros de exportacion reales de esas plataformas para construir y probar contra algo cierto. La promesa publica de migracion no se anuncia hasta tener esto.**

**⚙️ CONFIRMADO y con un matiz útil.** `Holded` y `Quipu` **ya son opciones de origen** en la
migración asistida (`ORIGENES`, `modules/erp/routes/migracion.js:37`), así que **el hueco donde
enchufar el importador ya existe** y hoy lo cubre el equipo a mano. Lo que falta son **los ficheros
de exportación reales** para construir y probar contra algo cierto.

---

---

#### L. LA COLA DE ENVÍOS: DEVOLVERLA AL PANEL Y VESTIRLA · ✅ **HECHO (21 ago 2026)** · commit `3296c1f`

> **L. LA COLA DE ENVÍOS: DEVOLVERLA AL PANEL Y VESTIRLA.**
> **L1** ~~VUELVE AL PANEL. Menú lateral, barra superior y buscador, como el resto de pantallas. El botón «← Agenda» se queda: volver al sitio de donde vienes es útil, pero no puede ser la ÚNICA salida.~~ **RETIRADO: ya estaba hecho** (ver ⚙️ abajo). El «← Agenda» se queda, y ya no es la única salida.
> **L2** ENTRADA PROPIA. Clave en NAV_PERMS, alcanzable por menú y por Ctrl+K, y enlazable por DISA. Va dentro del área de Agenda (es de uso diario).
> **L3** CONTENEDOR CON AIRE. Hoy las tarjetas van de borde a borde de la pantalla. Mismo contenedor y mismos márgenes que el resto del panel, con ancho máximo: en pantalla ancha el texto no se estira de lado a lado.
> **L4** TÍTULO DE PÁGINA DE VERDAD. «Cola de envíos» es hoy texto plano pequeño. Misma jerarquía que «Agosto 2026» en la agenda.
> **L5** EL MURO DE TEXTO, FUERA. Ese párrafo de tres líneas a ancho completo, en gris y con negritas dentro, no lo lee nadie. Se queda UNA frase visible y el resto va detrás de la (i), en la misma ventana que usa el resto del panel. Lo que NO se pierde, porque es honestidad y no adorno: que «marcado como enviado» significa que se pulsó el botón, NO que el mensaje llegó.
> **L6** HOY ANTES QUE MAÑANA. Lo urgente primero.
> **L7** TARJETAS SEPARADAS ENTRE SÍ y con la cabecera de tarjeta del sistema visual, no negrita pequeña suelta.
> **L8** ESTADO VACÍO QUE ENSEÑA. Hoy dice «No hay nada pendiente.» y ya. Debe decir QUÉ aparecería ahí y CUÁNDO — «Aquí aparecerán las citas de mañana a las que aún no has mandado recordatorio». Con su icono. Un estado vacío es la primera pantalla que ve un negocio nuevo: si no explica nada, la pantalla parece rota.
> **L9** DECIR CUÁNTAS SON. La cabecera de cada bloque lleva su número («Hoy — 3 pendientes de confirmación»). Si es 0, el estado vacío ya lo dice.

**⚙️ CORREGIDO POR EL PASO 0 — DOS DE LAS NUEVE PREMISAS ERAN FALSAS, y se paró antes de construir:**

- **L1 · EL ARMAZÓN YA ESTABA.** Medido en la dirección pública a 1920 px: `sidebar: true`,
  `topbar: true`, buscador `true`. En el código, `vistaCola` termina en `adminLayout(...)`, **como
  todas**. No era otra plantilla, ni estaba fuera del layout, ni se le había quitado. **Lo que la
  hacía parecer desnuda era el INTERIOR**, y eso sí era real: tarjeta de **1814 px en una ventana de
  1920** (margen izq. 84 / der. 22), **cero separación** entre las dos, título de **16,8 px / peso
  500** y el párrafo a ese mismo ancho. Es decir: **L3, L4, L5 y L7 describían bien el síntoma y mal
  la causa.**
- **L2 · YA TENÍA ENTRADA PROPIA, y desde el 18 de agosto.** Clave `'citas-cola': 'citas.read'` en
  `NAV_PERMS`; entrada **en el área Agenda** —justo donde el encargo la pide— con el nombre
  **«Recordatorios a clientes»**, su icono, **alias «Cola de envíos»** para el buscador y **contador
  de pendientes** al lado. Ctrl+K la encuentra **por los dos nombres**. **Lo único cierto de L2 era
  lo de DISA**, y eso sí se ha construido.
- **NO es una pantalla huérfana** ni la quinta: tiene menú, permiso, alias y contador. ~~Las huérfanas
  siguen siendo dos (`/admin/discounts` y `/admin/tags`) más la migración.~~ **⚠️ CADUCADO: ya no queda
  ninguna de esas dos.** `/admin/tags` se enganchó al menú en B2 y `/admin/discounts` se DESMONTÓ en el
  encargo CUPONES (23 ago 2026, `9e77f2b`). La migración sí tiene entrada desde B1.
- **El orden Mañana→Hoy NO era deliberado:** ni un comentario ni una nota lo justificaban. Era el
  orden en que se escribieron los dos bloques. **L6 es correcto.**

**QUÉ SE ENTREGÓ:**

- **L2 (la parte viva) · DISA YA PUEDE ENLAZARLA.** `/admin/citas` y `/admin/citas/cola` entran en su
  lista de destinos permitidos. Leer la agenda ya estaba permitido y DISA la nombraba; lo que no
  podía era **llevarte**, así que decía «ve a la Agenda» sin poder abrirla. **No abre ninguna puerta
  nueva** —son destinos de solo lectura con el candado de su pantalla—: quita un callejón sin salida.
- **L3 · CONTENEDOR CON TOPE.** `max-width: 1080px`. En un monitor de 1920 la tabla se estiraba 1814
  px y las seis columnas quedaban separadas por medio metro de vacío.
- **L4 · TÍTULO DE VERDAD**, con la misma jerarquía que el «Agosto 2026» de la agenda (1,5 rem / 700).
  Y **pasa a llamarse «Recordatorios a clientes»**, que es como se llama en el menú y en la pestaña
  del navegador desde el 18 de agosto: **no es un cambio de nombre, es terminar aquel**, que dejó
  este `h2` sin tocar — el menú te llevaba a un sitio y la pantalla se presentaba con otro nombre.
  El nombre viejo se sigue encontrando en el buscador, que es donde hace falta.
- **L5 · EL MURO, DETRÁS DE LA (i).** Arriba se queda **una frase**; el resto vive en la ventana del
  panel, **con la advertencia entera y en su propio recuadro**: «marcado como enviado» **no** es
  «entregado». No se ha suavizado ni una palabra, y el gate la exige **por texto**.
- **L6 · HOY PRIMERO**, en el HTML **y** al pedir los datos: si el servidor tarda, lo primero que se
  pinta es lo de hoy.
- **L7 · TARJETAS SEPARADAS** (16 px) y con la **cabecera de tarjeta del sistema** (`card-head`), no
  una negrita suelta.
- **L8 · EL VACÍO ENSEÑA**, con el bloque de vacío del panel (`emptyState`, U2) y su icono:
  *«Aquí aparecerán las citas de hoy a las que aún no has pedido confirmación.»*
- **L9 · EL NÚMERO EN LA CABECERA, Y CUENTA LO QUE HAY QUE CONTAR.** Dice las **pendientes**, no las
  filas: el motor trae **todas** las citas del día —las ya avisadas también, con su estado—, así que
  contar filas habría dado un número que no es el que se busca. Medido: 3 citas hoy con una ya
  marcada → «**Hoy — 2 pendientes de confirmación**», con las 3 filas a la vista. Singular cuando es
  una. Con 0 filas, la cabecera no inventa un cero: lo dice el estado vacío.

**⚠️ ANOTADO Y NO ARREGLADO — el menú no filtra a quien no tiene NINGÚN permiso propio.** Salió al
escribir la comprobación 4. `hasCustomPerms` exige `perms.length > 0`: un empleado con **cero**
permisos ve el menú entero. **La puerta sigue cerrada** (403 al pulsar, comprobado), pero enseña
puertas que no se abren. **Es preexistente, es general** —vale para todas las entradas, no para ésta—
y **ya estaba anotado en este TABLERO desde el 17-jul-2026**. El PASO 2 de este encargo deja los
permisos fuera de alcance, así que el gate mide el caso que sí se puede exigir hoy: **un empleado con
permisos propios no ve esta entrada**, y sí ve las suyas.

**VERIFICACIÓN — `gate-cola-envios`: 38 aserciones, 0 fallos, contra la dirección pública.**
- **Reversión de las siete piezas, una a una:** sin L1 → 7 rojos · sin L2 → 3 · sin L3 → 2 ·
  sin L5 → 2 · sin L6 → 1 · sin L8 → 4 · sin L9 → 2. Ninguna aserción sobrevivió a que le quitaran
  el producto de debajo, y **el gate llegó al final en las siete** — ni una murió por excepción.
- **L4 y L7 no venían en la lista de comprobaciones del encargo, y se les añadió la suya:** un punto
  sin aserción no está verificado por muy a la vista que quede en una captura. Medido: título de
  **24 px / peso 700** y las **dos cabeceras de tarjeta del sistema**.
- **Y dos aserciones mías estaban mal, no el producto:** una daba por hecho que el menú filtra a
  quien no tiene ningún permiso (no lo hace: fallo preexistente, arriba), y otra esperaba a que la
  agenda arrancara su JavaScript para dar por bueno el botón «← Agenda» — lo que ahí se comprueba es
  **a dónde lleva el botón**, no cuánto tarda la otra pantalla en despertar. Corregidas las dos.

**FICHA DE `gate-cola-envios` — DECLARADO, QUE NO ES EJECUTADO.**

| | |
|---|---|
| **Nombre** | `scripts/gate-cola-envios.mjs` |
| **Aserciones** | **38** (0 fallos el 21 ago 2026) |
| **Duración** | **~30 s** |
| **Clase** | **propio** (`EMPIEZAN_DE_CERO`) — levanta **su** negocio con `provisionTenant` y lo borra al salir. No toca el negocio compartido: **puede correr en paralelo**. |
| **Grupo** | `clientes` — el barrido pasa de **79 a 80** comprobaciones |
| **Contra** | `https://<slug>.bamburu.com` |
| **Depende del reloj** | **No.** Siembra sus citas con las fechas de hoy y mañana calculadas en el momento; no mira la hora. |

**TABLA `AFECTA`.** No hace falta regla nueva: las que ya existen cubren los dos ficheros que este
gate mira — `modules/erp/routes/citas.js` (la pantalla) y `modules/erp/menu.js` (la entrada y su
contador), **los dos → `clientes`**. Comprobado **ejecutando las reglas** contra las rutas reales, no
leyéndolas. **Declarar no es ejecutar:** entra en el mapa para que el barrido lo alcance cuando
Ibrahin lo pida; no se ha enganchado a ningún disparador.

---

#### M. LO QUE SE DICTÓ DE VIVA VOZ Y NO PASÓ POR EL REGISTRO · ✅ **HECHO (21 ago 2026)**

> **Por qué está aquí.** El registro existe para que no se pierda nada al trocear, y **eso vale
> también para lo que el dueño dicta mirando la pantalla**. Estas dos entregas del 21 de agosto se
> ejecutaron sin pasar por este bloque: quedan escritas ahora, con su hash, para que dentro de un mes
> se pueda saber qué se pidió y qué se hizo sin reconstruirlo de un chat.

**M-a · LAS SIETE CORRECCIONES SOBRE LA VISTA MES** — commits `3200899` · `36de1a8` · `b1567d2`.
Ver la ficha **A-bis** para el detalle.
> **M1** Los botones S, M, L no se entienden: explicarlos sin quitarlos.
> **M2** El botón informativo de los colores, mejor en una ventana.
> **M3** Los días marcados no son consistentes: hay error.
> **M4** El día, el porcentaje y «abrir día», muy pegados al margen inferior: baja calidad.
> **M5** El calendario no es interactivo: no se pueden arrastrar citas ni de horas ni de días, en ningún formato.
> **M6** Las letras identificadoras de día, muy pegadas al margen superior y muy pequeñas.
> **M7** Al seleccionar un mes deben salir meses; al pulsar año, los años. No un cuadro para teclear fechas.

**M-b · LA PANTALLA «CUÁNDO ABRO»** — commits `b1094e7` · `f65e352`.
Ver la ficha **A-ter** para el detalle.
> **M8** La visual está hecha de muy mala calidad.
> **M9** Faltan automatismos: abrir de lunes a viernes sin marcar día a día, horario corrido, como lo hace WhatsApp Business.

**LO QUE M3 DESTAPÓ, Y ES LO MÁS IMPORTANTE DE LAS DOS ENTREGAS:** los días marcados sin criterio no
eran un fallo de la pantalla sino **basura de comprobaciones automáticas en la base**. De las **14
personas «activas»** del negocio de desarrollo, **10 eran fantasmas de gates**. Reales: **4**. Y de
ahí salían las famosas «168 h libres»: **una cifra correcta sobre datos falsos**, que es la peor
clase de cifra porque nadie la duda. Limpiado, y ampliado `limpiar-residuo-gates.mjs`, que **no
miraba `admin_users`**.

**Y EL PERMISO `citas.ver_todas`**, que no venía en ninguna lista: salió de una pregunta al dueño
—*«¿cada uno ve solo su agenda?»*— y se construyó con su respuesta. Detalle en **A-bis**.

### LO QUE NO TOCÓ EL ENCARGO 0 — EL DEL REGISTRO (21 ago 2026, `f6c864c`)

> Esto describe **la tarea que creó este bloque**, no las que vengan después. La tarea **A** sí tocó
> código, y lo que hizo está en su ficha.

- **Cero código de producto.** `git diff` vacío sobre `modules/`, `core/`, `scripts/`, `public/`.
- **La migración NO se ha enlazado.** Eso es **B**, y B está **PENDIENTE**.
- **No se tocó** la lista de pendientes que ya existía (Verifactu, Peldaño 8, contabilidad, deuda de
  comprobaciones, TAREA 3) ni ninguna ficha histórica.
- **No se corrió** ningún barrido ni ningún gate: el encargo lo dijo arriba del todo.


## 🧭 ORDEN DE TRABAJO ACORDADO (20 ago 2026) — subordinado al saneamiento activo desde el 26 ago

> **Sesión de decisión: cero código, cero commits de producto.** Aquí queda el orden que se acordó y
> el detalle de cada tarea. Ninguna se inicia sin encargo. **En la sesión del 20 ago el puntero del
> Peldaño 8 no se movía**, porque las tres tareas eran transversales o previas. Su estado posterior se
> refleja en el orden actualizado de abajo.

**EL ORDEN:** (1) sanear las comprobaciones automáticas ✅ · (2) cerrar los cabos sueltos de la Agenda,
como **UNA sola tarea entera** ✅ · (3) funciones nuevas ✅ **(las siete, 23 ago 2026)** ·
(4) **Peldaño 8 — Salud/bienestar ✅ HECHO (24 ago 2026)** ·
(5) **Peldaño 9 — Belleza/estética** — pendiente en la escalera, **APLAZADO hasta cerrar la fase de saneamiento**.
> ⚙️ *El puntero «← AQUÍ» estaba en la (3) y se corrigió el 24 ago 2026 al cerrarse la (3): el siguiente paso era entonces el Peldaño 8.*
> ⚙️ *Actualización 25 ago 2026, ya histórica: al cerrar el Peldaño 8, el siguiente era el Peldaño 9.*
> **Actualización vigente 26 ago 2026:** Ibrahin aplaza el roadmap funcional hasta cerrar la fase de
> saneamiento derivada de la auditoría integral. **Saneamiento 2 — Blindaje de DISA quedó cerrado el
> 26 ago 2026. No se inicia ninguna tarea posterior en este encargo.**

### ✅ TAREA 1 — Sanear las comprobaciones automáticas  ✅ HECHA (2026-08-20) — ver su ficha abajo

Tres piezas. **Dos de ellas cambiaron al auditarlas el 20 ago**, y se dejan escritas como están de
verdad y no como se suponía — que es justo el problema que esta tarea viene a resolver.

- **(a) `gate-vigia-agenda` YA NO FALLA.** ⚙️ *Corregido en el Paso 0.* Se daba por «falla siempre,
  1 de 41». **Hoy pasa 41/41**, comprobado tres veces: suelto, y en los dos barridos completos del día
  (serie y paralelo). Lo arregló **de rebote el rediseño del Inicio**: la aserción que estaba en rojo
  era que *los hallazgos de agenda no asomaban en el bloque del vigía del Inicio*, y ahora asoman en
  «DISA decide». **Lo que queda no es arreglar el gate: es RETIRAR la declaración caducada** de
  `ROJOS_CONOCIDOS` en `run-gates.mjs`, que sigue anunciando en cada pasada un rojo que ya no existe.
  Un puntero rancio manda al siguiente chat al sitio equivocado con toda la confianza del mundo.
- **(b) Quitar la dependencia de la HORA DEL DÍA** a `gate-agenda-sencilla` y `gate-oficio-pantalla`:
  con el mismo código dan resultado distinto por la tarde. Un gate que depende del reloj no es un
  gate, es una moneda al aire. *(Observación de Ibrahin; no reproducida en esta sesión.)*
- **(c) Las comprobaciones de agenda y menú entran en el barrido.** ⚙️ *Corregido en el Paso 0:* de
  las seis, **DOS YA ESTÁN DENTRO** desde el 19 ago (`gate-agenda-visual` y `gate-menu-navegacion`,
  en el grupo `clientes`). **Quedan CUATRO fuera** — `gate-agenda-sencilla`, `gate-agenda-calendario`,
  `gate-citas-pantalla` y `gate-oficio-pantalla` — y **ni siquiera están declaradas** como excluidas
  ni como deuda: cero menciones en el runner, o sea **invisibles para el barrido**. Decisión de
  Ibrahin: **esas cuatro entran**. Se aparcaron el 18 ago porque alargaban la revisión; desde que el
  barrido corre **en paralelo y en dos modos** ese argumento ya no pesa, y una comprobación que nadie
  ejecuta acaba mintiendo.

### ✅ TAREA 2 — Cabos sueltos de la Agenda  ✅ HECHA (2026-08-20) — ver su ficha abajo

**Va ENTERA, no en trozos.** Cinco cabos:
- Dos citas **a la misma hora** se pintan una encima de otra.
- **No se puede estirar una cita** por el borde.
- En **móvil** solo se cambia de mes en vertical: falta el gesto horizontal.
- Las citas **no guardan quién las anuló**. `anulada_at` dice *cuándo*, no *si fue el cliente o el
  negocio* — y sin eso **no se puede separar el plantón del cierre del negocio**, que son dos cosas
  distintas y una de ellas es un dato de negocio.
- Desde la **ficha del cliente**, sus citas se abren **sin filtrar por él**.

### ✅ TAREA 3 — Funciones nuevas  (apuntadas, sin encargo) · **LAS SIETE, HECHAS (23 ago 2026)**

> ~~⬜~~ **⚙️ EL TÍTULO ESTABA CADUCADO, CORREGIDO EL 24 AGO 2026.** Seguía diciendo «pendiente» con
> **las siete líneas de debajo tachadas y marcadas ✅**. Un apartado que se anuncia pendiente y por
> dentro está entero manda a leerlo al que venga detrás, y peor: hace creer que quedan tareas donde
> no queda ninguna. Las siete y su prueba: área de agenda en el constructor (`e16bd01`) · control
> horario (41 ✓) · agenda del CRM (38 ✓) · las ventanitas del navegador (36 ✓ — **ojo: el 24 ago,
> al arreglar la ceguera del censo, apareció UNA que se le había escapado; ver Deuda técnica**) · productos
> parados (23 ✓) · DISA y los informes por chat (28 ✓) · descuentos, promociones y bonos (60 ✓).
> **El cuerpo no se toca:** cada línea conserva su tachado y su registro de cómo estaba antes.


- ~~**Área de agenda en el constructor de analítica.** Sin ella, los cuatro avisos de agenda de DISA
  **no pueden llevar gráfico**.~~ **✅ HECHA el 23 ago 2026 en la ficha D (D1+D4, `e16bd01`)**: el área
  existe con seis dimensiones y nueve medidas, y los cuatro avisos ya llevan su gráfico.
- ~~**Control horario (fichaje).**~~ **✅ HECHO el 23 ago 2026 (noche · punto 12) · gate
  `scripts/gate-control-horario.mjs` · 41 ✓ · 0 ✗.** Ficha al final del documento.
- ~~**Agenda del CRM.**~~ **✅ HECHO el 23 ago 2026 (noche · punto 13) · gate
  `scripts/gate-crm-tareas.mjs` · 38 ✓ · 0 ✗.** Ficha al final del documento.
- ~~**⬜ LAS VENTANITAS DEL NAVEGADOR DEL RESTO DEL PRODUCTO — 81, y son LA MISMA TRAMPA.**~~
  **✅ HECHO el 23 ago 2026 (noche · punto 7) · gate `scripts/gate-sin-ventanitas.mjs` · 36 ✓ · 0 ✗.**
  **El censo da CERO**: `node scripts/censo-ventanitas.mjs`. Ver la ficha completa al final de este
  documento. Lo que sigue es el registro de cómo estaba antes, que se conserva.
  **⬜ LO DE ANTES (para el registro):**
  *(Censadas el 23 ago 2026 en la ficha D-bis, que arregló las 12 de Analíticas. **No se tocan hasta
  que haya encargo.**)* En el producto hay **93** (29 `prompt` + 64 `confirm`, 42 ficheros; **86 en
  pantallas vivas**). La avería que costó esta ficha es que **Chrome silencia los diálogos** en cuanto
  el usuario marca la casilla que aparece en el SEGUNDO seguido, y el botón queda muerto sin decir
  nada. **Cinco pantallas encadenan dos y son las que rompen exactamente igual**: Presupuestos
  (`anularYRehacer`), Pedidos (ídem), Órdenes de compra (tres sitios) y Mostrador (pide concepto y
  luego importe). El resto son de una sola y fallan «solo» silenciándose.
  Las diez peores por número: Presupuestos 7 · Órdenes de compra 6 · Agenda 5 · Albaranes 4 ·
  Pedidos 4 · Propuestas 4 · Facturas 3 · Traslados 3 · Ficha de cliente 2 · Mostrador 2.
  **Cuando se aborde no hay que inventar nada:** `window.pedirDatos()` y `window.confirmarEnPagina()`
  ya están en `layout.js`, son compartidos y se usan en Analíticas. Es cambiar la llamada.
- ~~**⬜ QUE «QUÉ PRODUCTOS ESTÁN PARADOS» SE PUEDA CONTESTAR.**~~ **✅ HECHO el 23 ago 2026 (noche ·
  punto 9) · gate `scripts/gate-productos-parados.mjs` · 23 ✓ · 0 ✗.** Área nueva **Catálogo**, cuya
  fila es el PRODUCTO. Ficha completa al final del documento. Registro de cómo estaba:
  **⬜ LO DE ANTES:** *(Apuntada el 23 ago 2026: es la
  duodécima pregunta frecuente, que quedó fuera de la ficha D-bis.)* El área de Inventario mide
  **movimientos**, así que un producto sin ninguno no produce fila y **no puede salir en un gráfico**.
  Medido: 121 productos físicos, 76 con movimiento, **45 invisibles**. Hace falta que el área pueda
  **partir de los productos** y colgarles sus movimientos, para que un parado aparezca con cero. Es el
  mismo cambio de grano que hizo falta en la agenda para las horas libres.
- ~~**⬜ DISA Y LOS INFORMES — que se puedan crear y abrir por chat.**~~ **✅ HECHO el 23 ago 2026
  (noche · punto 10) · gate `scripts/gate-disa-informes.mjs` · 28 ✓ · 0 ✗.** Ficha al final del
  documento. Registro de cómo estaba:
  **⬜ LO DE ANTES:** *(Apuntada por Ibrahin el 23 ago
  2026 al encargar la ficha D, **y excluida expresamente de ella**: «DISA no entra aquí».)*
  **Responde al principio de LAS DOS PUERTAS de CANON §3-bis:** toda información de negocio se alcanza
  por DISA **y** por la vía visual, y ninguna sustituye a la otra. Hoy la puerta visual está entera
  (crear, guardar, reabrir, compartir, renombrar, borrar, imprimir, PDF y correo) y **la de DISA no
  existe**: `analytics_panels` no está en su mapa de lectura —un empleado que los pida por chat recibe
  «no consultable con tu permiso»— ni en `WRITABLE_TABLES`, y no hay ninguna acción dedicada. Un
  dueño/admin puede leer la tabla en crudo por `query_database`, que es SQL, no una puerta.
  **Cuando se aborde, las dos mitades tienen que respetar los MISMOS permisos** (CANON §3-bis), y el
  área de una receta es la que manda: exactamente el candado que ya usa el papel.
- ~~**⬜ DESCUENTOS Y PROMOCIONES — rehacer la función ENTERA y BIEN**~~ **✅ HECHO el 23 ago 2026
  (noche · punto 11) · gate `scripts/gate-descuentos.mjs` · 60 ✓ · 0 ✗.** Ficha al final. Registro:
  **⬜ LO DE ANTES:** (bonos, promociones, descuento por
  cliente), **operable por DISA**. *(Apuntada por Ibrahin el 23 ago 2026 al cerrar el encargo INTEGRIDAD.
  **No se ha construido nada hoy**: queda registrada, sin encargo.)*
  **Ojo con leer mal la retirada del 23 de agosto:** la pantalla vieja `/admin/discounts` se desmontó ese
  día **por estar MUERTA** —ningún documento vivo aplicaba un cupón: ni factura, ni presupuesto, ni pedido,
  ni mostrador; solo la leían la tienda congelada y el TPV viejo—, **no porque la función sobre**. **La
  función sí hace falta**, y se quiere más ancha que aquella: aquella eran cupones y descuentos
  automáticos de e-commerce, y esto son **bonos, promociones y descuento por cliente**, con DISA pudiendo
  operarlos. Cuando se aborde: las tablas viejas siguen ahí, archivadas y legibles
  (`discount_codes_archived`, `auto_discounts_archived`), y los permisos `discounts.*` **nunca se
  borraron** — están asignables y sin pantalla que abrir, listos para reengancharse.



## Eje A: UX  ✅ COMPLETO (U0–U9)
Objetivo: acercar cada pantalla y flujo a "el dueño no opera, decide". Método: auditoría primero, luego ejecución en piezas pequeñas. Cada tarea define cómo se verifica y cierra con regresión 0.

### U0 — Auditoría UX global  ✅ HECHO (2026-07-05) — `006cf6a`
Recorre TODAS las pantallas del admin y del portal y produce un inventario real, sin cambiar nada: pantallas y su estado; incoherencias visuales (tipografía, espaciado, colores, componentes repetidos distintos); flujos clave y nº de clics de cada uno; pantallas sin estado vacío / sin estado de carga; mensajes de error genéricos; qué se rompe en móvil.
Hecho cuando: existe docs/ux/auditoria-ux.md con la lista concreta priorizada, y de ahí salen U1–U6 con datos reales.

### U1 — Sistema visual coherente (design tokens)  ✅ HECHO (2026-07-05) — `4332be4`
Unificar tipografía, escala de espaciado, colores y componentes base desde un único sitio (tokens), a partir de layout.js. Sin rediseñar: dar consistencia.
Hecho cuando: los valores visuales salen de un único origen y las pantallas de mayor uso los usan; captura antes/después.
- Avance (2026-07-06): componente de pestañas unificado en estilo FICHA (`.tabs`/`.tab`) — aplicado a Contabilidad, Seguridad, Productos/Descuentos y a los filtros de estado de los listados. Contabilidad reagrupada de 7→3 pestañas de primer nivel (Libros oficiales · Impuestos · Resultados), con 2º nivel de fichas para las 5 vistas legales. Solo navegación/presentación: regresión 0, exports/permisos/datos/rutas intactos.

### U2 — Estados vacíos y de carga  ✅ HECHO (2026-07-06)
Toda pantalla con datos tiene estado vacío útil (qué es, qué hacer) y estado de carga.
Hecho cuando: las pantallas marcadas en U0 quedan cubiertas; revisión en navegador.
- Hecho (2026-07-06): dos piezas compartidas en `layout.js` (un solo sitio) — **`emptyState`/`emptyRow`**
  con voz de DISA (icono ✦ sobre `--accent-soft` + una frase + acción opcional; reutiliza la banda azul
  de U1 y los tokens; variante `tone:'ok'` para los vacíos "buenos" con check verde y `icon:'ti-search'`
  para búsqueda sin resultados) y **`skeletonRows`** (shimmer atenuado; respeta `prefers-reduced-motion`),
  con sus espejos `window.*` para las listas fetch. Montadas sobre ~27 pantallas: vacíos con voz de DISA
  (con acción donde toca, sin botón en los "buenos" como Cobros/Pagos, contextual sin botón forzado en los
  derivados como Inventario/Verifactu/Contabilidad-por-periodo), y **skeleton** en todas las listas fetch,
  incluidas las 4 que daban pantallazo en blanco (Inventario, Grupos, Descuentos, TPV). El **portal público**
  del cliente lleva un vacío NEUTRO (sin DISA, su propio shell), decisión del dueño. Solo presentación,
  aditivo y reversible: **regresión 0** (28 archivos `node --check`, smoke headless 0 errores JS y ninguna
  pantalla en blanco; sin tocar lógica, datos, endpoints ni permisos).

### U3 — Mensajes de error claros y accionables  ✅ HECHO (2026-07-07)
Sustituir errores genéricos por mensajes que dicen qué pasó y qué hacer, en la voz de Bamburu.
Hecho cuando: los casos de U0 muestran mensaje claro; test que dispara los errores y comprueba el texto.
- Propuesta (2026-07-07): barrido completo de admin + portal (más allá de los 16 de U0: la superficie
  real usa **5 mecanismos** — `c.text` planos, `alert`, `toast`, `c.json`→toast y banners DOM). Lista
  aprobada en bloque por el dueño en `docs/ux/u3-textos-errores.md` (11 plantillas T1–T11 + casos A–I).
- Hecho (2026-07-07): pieza compartida en `layout.js` (un solo sitio, como U2) — **`ERR`** (textos
  T1–T11), **`cleanErrMsg()`** (traduce lo crudo a llano: UNIQUE SQLite→duplicado contextual, errores
  internos→genérico, `Datos inválidos`→accionable, y **quita** tokens `confirm_*`/códigos de permiso
  `cobros.manage`/`(R1–R5)`/`(D1)` conservando las palabras que el front necesita) y **`errorShell()`**
  (página de error maquetada con el visual de U2), con espejos `window.*`. El chokepoint **`api()`** limpia
  todos los toast/alert de golpe (403→T4, red→T2). `onError`(T10)+`notFound`(T11) propios con rama JSON para
  `/api/`. Aplicado a ~20 ficheros: `alert`→`toast`, páginas `c.text` planas→maqueta (fichas 404, PDF,
  conciliación, recurrentes, bienes), vertidos de Resend e IDs internos crudos→texto llano. El **portal
  público** mantiene su shell NEUTRO (sin DISA). **Fuera:** los 2 avisos de 2FA/contraseña (lógica) y el
  caso F de Verifactu. Solo presentación, aditivo y reversible: **regresión 0** (20 archivos `node --check`,
  smoke headless `scripts/verify-u3-errores.mjs` **13/13 OK · 0 errores JS**, forzando un caso de cada
  mecanismo en vivo; sin tocar lógica, validaciones, permisos ni la causa de los errores).

### U4 — Reducir clics en flujos clave  ✅ HECHO (2026-07-07)
Tomar los flujos medidos en U0 (emitir factura, registrar cobro, conciliar, crear recurrente…) y recortar pasos/formularios en blanco.
Hecho cuando: cada flujo baja de nº de clics medido; antes/después documentado.
- Hecho (2026-07-07): mismo principio que los flujos "propuesta lista" (conciliar/emitir recurrente/enviar
  enlace) llevado a los de más fricción del U0. **Registrar cobro**: la acción frecuente estaba detrás de
  "Gestionar" (centro de reclamación) → 3 clics; ahora la fila de **Cobros** y la **ficha de cliente**
  llevan **"Registrar cobro" directo** (abre el formulario ya precargado: importe pendiente + fecha hoy) +
  "Gestionar" a un clic → **3→2 clics**, como el espejo de Pagos ("Pagar" directo). **Modal de cobro**:
  precarga la **"Forma"** con el último valor usado (forma del último cobro de la factura y, si no, la
  registrada del cliente) — el API expone `payment_method_default` (aditivo), espejo del modal de pago a
  proveedores. **Crear plantilla recurrente**: **fecha de inicio precargada a hoy** (único obligatorio en
  blanco) y avanzados (fin, nº de ocurrencias, IRPF) plegados en **"Más opciones"** → menos campos a la
  vista sin quitar nada (siguen en el form con sus defaults). Solo presentación/precarga, aditivo y
  reversible: **regresión 0** (motores recurrentes 15/0 · cobros-paso2 47/0 · cobros-paso2-1 46/0; smoke
  navegador real 10/0, 0 errores JS; sin tocar endpoints de escritura, validaciones, permisos ni cálculo).
  5 ficheros: `cobros.js`, `clients.js`, `cobro-modal.js`, `invoices.js`, `recurrentes-routes.js`.

### U5 — Móvil / responsive  ✅ HECHO (2026-07-07)
Que las pantallas de uso frecuente funcionen bien en móvil (lo que U0 marque como roto).
Hecho cuando: esas pantallas se usan sin romperse en ancho móvil; revisión a ese ancho.
- Diagnóstico (móvil 390px táctil): **nav inaccesible** (el rail se iba fuera de pantalla sin hamburguesa; solo
  se abría con hover, que en táctil no existe), **tablas anchas desbordaban** arrastrando el scroll horizontal de
  toda la página (cobros 898px, contabilidad 1101px, facturas 1102px), **rejillas de formulario** inline seguían
  en 3–4 columnas, **modales** medio fuera de pantalla, y **DISA** en móvil (widget flotante de 400px + chat).
- Hecho (2026-07-07): arreglado **una sola vez en piezas compartidas**, todo `@media(max-width:768/900px)` o tras
  `matchMedia` → **regresión 0 en escritorio**. `layout.js`: rail→**drawer** con hamburguesa en el topbar (submenús
  en acordeón), **tablas** con scroll propio en móvil (la página ya no se desplaza), **rejillas de formulario a 1
  columna**, **modales** como hoja inferior alcanzable con el pulgar, alturas en **`dvh`** (no `vh`, que en móvil
  incluye la zona bajo la barra del navegador) y buscador del topbar a 1 línea. **DISA**: el botón flotante (móvil)
  lleva a la **conversación a pantalla completa** (`/admin/disa`) en vez de la ventanita de escritorio; esa pantalla
  pasó a una sola columna con la lista de conversaciones como **drawer estilo IA** (Claude/ChatGPT: ancho + fondo
  oscurecido + cierre al tocar fuera), y el contenedor del chat **rellena con flexbox** el hueco bajo el topbar (sin
  altura fija) → el compositor queda a la vista sin scroll en cualquier móvil. `disaHome.html.js`: cuadrado el
  margen para no desbordar. **Verificado** en navegador a varios anchos (360–414 + escritorio): 0 scroll horizontal,
  chat cabe entero, 0 errores JS; sin tocar lógica, datos, endpoints ni permisos. 4 ficheros: `layout.js`,
  `disa/index.js`, `disa/widget.js`, `disaHome.html.js`.

### U6 — Onboarding / primeros pasos  ✅ HECHO (2026-07-07)  ← CIERRA EL EJE A (UX)
Recorrido que lleve al dueño nuevo al primer valor sin fricción (idealmente de la mano de DISA, enlaza con Eje B).
Hecho cuando: un dueño nuevo llega a su primera acción útil sin bloquearse; recorrido probado.
- Diagnóstico (solo lectura): el dueño aterriza en `/admin` (dashboard → `disaHomeHtml`) tras el alta. `provisionTenant`
  NO fija los datos fiscales → estado "vacío" = `company_name='Mi Empresa'`, `fiscal_id=''`, 0 clientes, 0 facturas.
  Cada paso se deriva del estado real (sin flags): empresa = `fiscal_id` no vacío · cliente = `≥1 en clientes` ·
  factura = `≥1 en invoices`. Destinos existentes: `/admin/settings` · `/admin/clients?nuevo=1` · `/admin/invoices/new`.
- Hecho (2026-07-07): panel **"Configura tu negocio"** en el Inicio (nivel Stripe/Shopify/Holded), SOLO para dueño/admin
  y solo mientras falte algún paso. Lleva **anillo de progreso** (SVG), **timeline** de 3 pasos con iconos y estado
  (verde=hecho · azul=actual · gris=luego), **tiempo estimado** por paso, y el **paso actual desplegado** con la guía de
  DISA (qué·por qué·cómo, en su voz) + CTA directo a la pantalla preparada; los hechos con "Hecho", los futuros plegados
  y alcanzables. Bienvenida de DISA con momentum según avance; motion sutil (`prefers-reduced-motion` respetado). Cada
  paso se marca **solo** (derivado del estado); con los 3 hechos el dashboard NO pasa `onboarding` → el panel **se retira
  solo** y el Inicio vuelve al home normal. Reutiliza pantallas/acciones existentes (empresa, clientes, facturas); `?nuevo=1`
  abre directo el alta de cliente. Solo presentación + lectura de estado: sin tocar lógica/datos/permisos de
  empresa/clientes/facturas. **Verificado** en navegador con un tenant nuevo provisionado y **eliminado** al terminar:
  0/3→1/3→2/3→panel retirado (completando cada paso real, factura vía `createInvoice`); negocio configurado (desarrollo)
  **sin panel** → regresión 0; 0 errores JS. 3 ficheros: `dashboard.js`, `disaHome.html.js`, `clients.js`.
### U7 — Enlaces rotos e inconsistencias de navegación  ✅ HECHO (2026-07-08)
Encargo del dueño: revisar enlaces que no llevan a ningún sitio e incoherencias del menú.
- Auditoría: se enumeraron las **98 rutas GET reales** del admin (montando `mountRoutes` e inspeccionando
  `app.routes`) y los **288 destinos de navegación** del código (`href=`, `href:`, `location.href`, `redirect()`);
  cruzados entre sí y **verificados en vivo** los 33 destinos del menú con sesión de owner.
- Arreglado (3 ficheros: `layout.js`, `change-password.js`, `security.js`):
  1. **404 real**: el menú de la cuenta tenía "Datos del negocio" → `/admin/settings/company`, que solo existe
     como API (`/api/erp/settings/company`). Además "Ajustes" → `/admin/settings` era **la misma pantalla**
     ("Configuración Empresa"), y ambas compartían `key: 'settings'` → marcaba dos items activos. Fusionadas
     en una sola entrada: **Datos del negocio → `/admin/settings`**.
  2. **"Mi cuenta" era la pantalla-cerrojo**: `/admin/change-password` es donde `core/auth.js` encierra al
     usuario con `must_change_password=1`, y mostraba "debes cambiar tu contraseña antes de continuar" también
     al entrar por el menú. Ahora ese aviso **solo sale cuando hay cerrojo**; la pantalla es "Mi cuenta"
     (identidad: nombre · email · rol + cambiar contraseña) y el cambio voluntario vuelve a ella con confirmación.
  3. **La contraseña se cambiaba en dos sitios** con dos implementaciones: `POST /admin/change-password` y
     `POST /admin/security/change-password`; la de Seguridad **no registraba en Actividad**. Retirada esa
     segunda. Reparto (decisión del dueño: separadas): **Mi cuenta = contraseña** (todos los roles) ·
     **Seguridad = 2FA** (owner/admin en el menú). Necesario porque Seguridad está gateada a owner/admin y un
     empleado se quedaba sin forma de cambiar su contraseña.
  4. `logActivity` en el cambio de contraseña usaba mal la firma (frase en `entity`, `action='password_change'`);
     alineado con la convención del resto (`action` = frase humana, `entity` = tipo, `entityId` = id).
- **Verificado** end-to-end con un usuario `employee` de prueba creado y **eliminado** al terminar: cerrojo
  redirige y muestra el aviso · cambio forzado → 2FA · cambio voluntario → vuelta a Mi cuenta · ambos registrados
  en Actividad · Seguridad sin formulario de contraseña · `POST /admin/security/change-password` → 404 y sin
  efecto · menú del owner con las 5 entradas correctas. Barrido final: **0 enlaces rotos**.
- Encontrado y NO tocado (sin encargo): **`/admin/security` no tiene `requirePerm` en el GET** — solo se oculta
  del menú vía `roleFilters` (owner/admin), así que un empleado llega escribiendo la URL. → **Eje C (Seguridad)**.
- Encontrado y NO tocado (decisión del dueño: "se abordarán luego"): tres pantallas vivas (200) sin enlace en
  ningún menú → `/admin/analytics` ("Analítica"), `/admin/discounts` ("Descuentos"), `/admin/tags` ("Etiquetas").
  `navPerms.analytics` (`layout.js`) existe sin item que lo use.
- Nota: el reparto del punto 3 (Mi cuenta = contraseña · Seguridad = 2FA) quedó **superado por U8**, que
  consolida datos + contraseña + 2FA en la pantalla nueva `/admin/perfil`.

### U8 — Pantalla "Perfil de usuario"  ✅ HECHO (2026-07-08)
Encargo del dueño: datos personales del usuario logueado, separados de "Datos del negocio" (empresa).
- **Nuevo**: `modules/erp/routes/perfil.js` (`/admin/perfil` + `/api/erp/perfil`) y `modules/erp/paises-telefono.js`
  (74 prefijos E.164 + 9 idiomas). Estructura de 3 tarjetas: Datos personales · Contraseña · Verificación en
  dos pasos, con el patrón `card`/`form-row`/`form-group` de `/admin/settings` y los tokens de U1.
- **Migración aditiva** (`addCol`, sin `DROP`): `apellidos` (`''`), `telefono` (`''`), `pais_telefono` (`'+34'`),
  `idioma` (`'es'`), `foto_url`. **`apellidos` NUNCA se deriva de `name`**: partir un campo libre por el primer
  espacio inventa apellidos falsos ("María del Carmen Pérez" → "del"). Arranca vacío, lo rellena el usuario.
- **Contraseña**: extraída a `core/auth.js` → **`changeOwnPassword()`, fuente única** (bcrypt 12, cierre de las
  demás sesiones, registro en Actividad). La consumen `/admin/perfil` y la pantalla-cerrojo. No se reimplementa.
- **Foto**: sube por `attachments.js` con `kind='user_photo'`; la sirve `GET /api/erp/perfil/foto/:id`, que
  **filtra por ese `kind`** — si no, sería una puerta trasera para leer adjuntos de facturas de proveedor pasando
  otro id. La foto anterior no se destruye, solo deja de referenciarse. El avatar del sidebar la usa.
- **`idioma` GUARDA la preferencia pero HOY NO TRADUCE NADA**; la pantalla se lo dice al usuario. El motor de
  i18n real es tarea aparte (ver cola abajo).
- **2FA consolidado**: único sitio, Perfil. Hallazgo que corrigió el supuesto del encargo: **no había dos estados
  que migrar**. Los dos `pendingTOTPStore` son `Map()` en memoria (secreto pendiente durante el alta); ambas
  implementaciones escribían las MISMAS columnas (`totp_secret`/`totp_enabled`), que es lo que lee el login.
  Consolidar fue mover UI. `/admin/security` → **302 a `/admin/perfil`** (no 404: `disa/index.js` le dice al
  usuario "ve a /admin/security"). Retirada la tarjeta 2FA de "Datos del negocio" (`settings.js`).
- **Menú de cuenta**: Perfil · Datos del negocio · Usuarios · Actividad. `/admin/change-password` sigue viva
  como **pantalla-cerrojo** de `core/auth.js:156` (fuera del menú); sin cerrojo redirige a Perfil.
- **Verificado 70/70** con usuario `employee` de prueba creado y eliminado: migración y defaults · `apellidos`
  vacío al alta · guardado campo a campo · rechazo de nombre vacío, prefijo inventado, idioma inválido, teléfono
  con letras y PUT sin CSRF (403) · foto (sube, sirve con sesión, no sin ella, rechaza PDF, no sirve adjuntos de
  otro `kind`, no destruye el adjunto al quitarla) · contraseña (bcrypt, cierra otras sesiones, conserva la
  actual, queda en Actividad) · 2FA (código malo rechazado, bueno activa y persiste, desactivar limpia secreto) ·
  **el 2FA ya activo del owner sobrevive** (secreto intacto y sigue validando códigos; Perfil lo muestra como
  Activada sin ofrecer QR nuevo) · **cerrojo intacto**. Headless: 4 pantallas 200, sin scroll horizontal a 390px,
  **0 errores JS**. `node --check` en los 9 ficheros.
- Incluye el fix del 404 de `/admin/settings/company` (U7).
- Encontrado y NO tocado: **`/admin/setup-2fa`** (`routes/auth.js`) queda huérfana y se monta **fuera del
  middleware CSRF**; sus formularios no llevan `_csrf`. Riesgo práctico mitigado por la cookie `SameSite=Lax`,
  pero es un hueco de defensa en profundidad. → **Eje C (Seguridad)**.

> **EJE A (UX) COMPLETO**: U0 (auditoría) · U1 (tokens) · U2 (vacíos/carga) · U3 (errores) · U4 (clics) · U5 (móvil) ·
> U6 (onboarding) · U7 (enlaces rotos e inconsistencias de navegación) · U8 (perfil de usuario).
> Siguiente: planificar **Eje B — DISA** (empieza por aquí en la próxima sesión).
> *(U7 dejó "Datos del negocio" del menú de cuenta apuntando a `/admin/settings`; U8 lo consolidó en
> `9cf2e46`. Reverificado en navegador el 10-jul: HTTP 200 en los tres negocios, y ninguno de los 34
> enlaces del chrome del panel da 4xx.)*

### U9 — Plantillas de email editables (TODAS)  ✅ HECHO (2026-07-14) — `cdda13c`
Nueva sección en Ajustes (`/admin/settings/plantillas`): el dueño reescribe **con su voz** todos los correos
que su negocio envía, sin tocar código. **NO se creó un segundo sistema de plantillas:** los textos ya existían
—repartidos entre 4 constructores (`collectionEmail`, `accountEmail`, `opportunityEmail`, `avisosEmail`) y
**4 HTML escritos a mano dentro de las rutas** (presupuesto, orden de compra, recuperar contraseña, portal)—
y se recogen en un catálogo único (`email-templates.js`). La ruta de envío no cambia: mismo Resend, mismo historial.
- **La decisión que lo sostiene:** una plantilla de fábrica deja de ser código que concatena cadenas y pasa a ser
  **DATO** (texto con huecos `{{asi}}`). Los constructores de siempre quedan como envoltorios que lo renderizan
  (misma firma, misma salida). Y como la de fábrica ya es un texto con huecos, **la editable ES la misma cosa**:
  no hay dos versiones del texto que puedan desincronizarse — que era el riesgo real de la tarea.
- **El catálogo se recorrió DESDE EL CÓDIGO, no de memoria** — y corrigió tres suposiciones del encargo:
  el recordatorio de pago tiene **CUATRO** tonos (no 3); **NO existe email de "envío de factura"** (las facturas
  llegan al cliente **por el portal**, y ese es el correo que sí existe y se expone); y **no existen** invitación
  de empleado, verificación de cuenta ni avisos de seguridad por email — **no se inventan**.
  **8 tipos · 18 variantes editables.**
- **Red de seguridad, distinta por familia:** *cliente* → quitar un hueco necesario **avisa** pero deja guardar
  (es su voz); *sistema* → quitar el **elemento crítico** (el enlace de acción) **BLOQUEA** el guardado. Un
  "recupera tu contraseña" sin enlace deja a una persona fuera de su cuenta y nadie se entera hasta que pasa.
  El crítico sale **de la plantilla de fábrica**, no de una lista inventada.
- 🔒 **AGUJERO DE SEGURIDAD REAL, CERRADO de paso:** `auth.js` imprimía el **enlace de recuperación de contraseña
  en el log del servidor** (`console.log('[Resend] Reset link:', resetLink)`). Ese enlace lleva el **token**:
  cualquiera con acceso a los logs podía **secuestrar una cuenta**. Mismo pecado que la clave de Anthropic en el
  log de `sudo` (11-jul). Ya no se registra.
- Editor **visual** (negrita, cursiva, enlaces, listas): el usuario no ve una etiqueta. HTML crudo disponible pero
  **plegado**. Los huecos se **insertan con un clic**, nunca se teclean (un `{{factrua}}` mal escrito saldría vacío).
  Vista previa con datos de **ejemplo** (nunca de un cliente real). **"Volver al original" = borrar la fila**: la de
  fábrica vive en el código y **no se puede perder**.
- **Permisos: los mismos de Ajustes.** Comprobado en la BD, no supuesto: el módulo `company` **no existe** en la
  tabla `permissions`, así que Ajustes es **de facto del dueño/admin** — el candado más estricto que hay. **No se
  afloja para los de sistema.** `email_templates` **FUERA de WRITABLE_TABLES**.
- Verificado: `verify-plantillas-email` **49/0** (lo guardado es lo que se **envía**, no el código; los huecos se
  rellenan con datos reales; los valores se **escapan** —un cliente llamado `<script>` no inyecta nada—; cliente
  avisa y guarda; sistema **bloquea** en password **y** portal; volver al original devuelve la de fábrica carácter
  a carácter) + `gate-plantillas-email` **41/0** (navegador; **envío REAL por Resend al buzón sumidero**,
  comprobando que sale **mi** texto y **ninguno** de los cuatro de fábrica — **cero correos a personas**).
  Barrido **39/39**.

### Cola del Eje A (fuera de encargo, NO descartadas — decisión del dueño)
- **Motor de traducción (i18n) real.** Hoy `admin_users.idioma` guarda la preferencia y la interfaz sigue en
  español (`lang="es"` hardcodeado; no hay i18n de ningún tipo en el proyecto). U8 avisa al usuario de ello en
  la propia pantalla. Cuando exista el motor, `idioma` es el campo que lo alimenta.
- **Códigos de recuperación de 2FA.** Ninguna de las implementaciones los tuvo nunca: si el usuario pierde el
  móvil, no hay salida por producto (hoy solo por intervención en BD). Necesario antes de empujar el 2FA a los
  clientes.
- ~~**Tres pantallas vivas sin enlace** (U7): `/admin/analytics`, `/admin/discounts`, `/admin/tags`.~~
  **⚠️ CADUCADO, las tres resueltas:** `/admin/analytics` se enganchó al menú el 17-jul (escalera paso 2),
  `/admin/tags` en B2 (23 ago) y `/admin/discounts` **no se enlazó: se DESMONTÓ** en el encargo CUPONES
  (23 ago 2026, `9e77f2b`), con sus tablas archivadas. Ya no hay ninguna pantalla viva sin enlace de U7.

## Eje B: DISA  ✅ COMPLETO (D0–D5f)
- **Diagnóstico de avisos/notificaciones (solo lectura, 9 jul 2026):** `docs/disa/diagnostico-avisos.md`.
  Es la **foto ANTES** del encargo de avisos; se conserva tal cual (documento fechado), pero ya no describe
  el estado actual.
- **Módulo de Avisos: CERRADO al 100 % (2026-07-10).** Los seis hallazgos del diagnóstico están cerrados.
  Los dos que seguían abiertos se cerraron en `b441cf0`: el **contador en vivo** en todas las pantallas del
  panel (sondeo de 60 s + refresco al volver a la pestaña + tras cualquier mutación, enganchado en `api()`)
  y la fuente **"cliente en riesgo"** del CRM (permiso `crm.read`, criterio prestado de `salesWorklist`).
  La fuente de **cumplimiento** ya existía (`envio_verifactu`). El bucle infinito de la campana (abrirla
  disparaba ~120 peticiones hasta el 429) se arregló en `fc7b323`; venía de `14b6c1e`, no del contador.
  *Queda fuera, sin encargo:* el **calendario fiscal** como fuente de avisos.
- **Auditoría D0 (10 jul 2026):** `docs/disa/auditoria-disa-d0.md` — radiografía completa de DISA
  (acciones, permisos, proactividad, nombres, mapa del código). De ella salieron D1…D5:
  - ✅ **D1 — fuga de lectura de `query_database` cerrada** (`d1d0c84`): de denylist a allowlist; lo no
    mapeado se deniega. Cada tabla al `*.read` de su pantalla. 43/0.
  - ✅ **D2 — KPIs del Inicio filtrados por permiso** (`d1d0c84`): sin permiso, "—" en vez de la cifra.
  - ✅ **D3 — saneamiento del catálogo** (`4a4beb1`): `delete_product` escribe `archived` (antes el
    `inactive` off-enum); `reset_stock` muerto retirado; tarjeta "Construir tienda" (404) oculta.
    `/summary` investigado y CONSERVADO (lo usan dos gates, no era huérfano). Las 16 acciones sin
    anunciar **no se tocaron** (es decisión de D5).
  - ✅ **D4 — docs y modelo** (`4a4beb1`): estados de pedido de `CLAUDE.md` al enum vivo; chat de DISA
    y onboarding a **`claude-sonnet-5`** (extracción por visión se queda en 4-6). Tarifa nueva en `llm.js`.
  - 🟡 **D5 — PROACTIVIDAD REAL DE DISA. Dos piezas HECHAS** (`742920a`, + esta sesión): **recordatorio
    de impago** y **pago a proveedor por vencer**.
    Cuando una factura de venta lleva vencida más días que el umbral del negocio (`company_config.
    dias_recordatorio_impago`, por defecto 7, editable en Ajustes), un cron diario prepara un borrador
    de email de recordatorio (plantilla `collectionEmail`, no LLM) y lo deja en el panel nuevo
    **"Propuestas de DISA"** (`/admin/propuestas`, badge en el topbar). El dueño **aprueba y envía**
    (reutiliza `registerCollectionAction` → Resend), edita o descarta. **NUNCA se autoenvía.** Tabla
    `disa_proposals` genérica (para más tipos), idempotencia por índice único (factura,tipo). Permisos:
    ver → invoices.read/cobros.read; aprobar → cobros.manage (anti-backdoor). Verificado: gate 22/0 +
    navegador 8/0 + envío REAL por HTTP a la dirección del dueño. `verify-propuestas-d5.mjs`.
    - ✅ **CRON INSTALADO (11 jul 2026):** `bamburu-propuestas.timer` copiado a `/etc/systemd/system`,
      `enable --now`. Diario 07:45 Europe/Madrid, antes del resumen de avisos (08:00). Verificado que
      **corre solo** bajo systemd y que **no duplica** aunque el panel ya haya generado ese día (20
      propuestas antes → 20 después; el índice único hace el trabajo). Documentado en
      `deploy/systemd/README.md`. **Un solo timer para los dos tipos** — D5b lo reutiliza.
    - ✅ **D5b — PAGO A PROVEEDOR POR VENCER (11 jul 2026).** El espejo de D5, invertido en el tiempo:
      en vez de cobros ya vencidos, pagos que están A PUNTO de vencer. Factura de compra con importe
      pendiente cuyo vencimiento cae dentro de los próximos `company_config.dias_aviso_pago` (Ajustes,
      7 por defecto, campo hermano del de impago). **No incluye lo ya vencido** (fuera de esta pieza).
      La propuesta muestra proveedor, nº de factura, importe pendiente, vencimiento y días que faltan.
      **La acción NO es un email** — a un proveedor no se le avisa de que se le va a pagar: es un ATAJO
      A PAGAR. "Aprobar y registrar pago" abre el **MISMO modal** del botón "Pagar" de `/admin/pagos`
      (`views/pago-modal.js`), precargado con lo pendiente, y escribe por el **ÚNICO** endpoint de pagos
      (`POST /api/erp/supplier-invoices/:id/payments`); editar = lo que ese modal ya permite (importe,
      fecha, forma, nota). Descartar → no se repite. **Mismo candado que "Pagar": `purchases.create`
      para aprobar, `purchases.read` para ver — ningún permiso nuevo.** El badge y la lista se filtran
      POR TIPO según permiso: quien no tiene compras no ve —ni cuenta— las propuestas de pago.
      Esquema **aditivo**: `disa_proposals.supplier_invoice_id`/`supplier_id` + índice único
      `(supplier_invoice_id, type)`; NO se sobrecarga `invoice_id` (las facturas de venta y las de
      compra son espacios de ids distintos). Verificado: `verify-propuestas-pagos.mjs` 48/0 +
      `gate-propuestas-pagos-permisos.mjs` 32/0 (navegador, permisos reales, E2E: aprobar → pago real
      en `supplier_payments` → propuesta cerrada) + punta a punta con factura de compra REAL (FRP-0005,
      121,00 €, vence en 3 días). Regresión de DISA y Pagos en verde.
    - ✅ **D5c — EMITIR LA FACTURA RECURRENTE QUE TOCA (14 jul 2026, `2b8927d`).** Tercer tipo de
      propuesta (`emitir_recurrente`). DISA detecta las **igualas/cuotas que tocan este ciclo y siguen
      sin emitir** —las ocurrencias en `borrador`, vía `borradoresPendientes()`— y las deja en el panel
      con cliente, concepto, importe y el día que toca. **Aprobar = EMITIR, un clic. No manda ningún email.**
      El **motor de recurrentes ya existía entero** (plantillas, ocurrencias, cron, pantalla): lo que
      faltaba era que DISA lo pusiera DELANTE en vez de esperar a que entres a mirar — el mismo salto
      que dio D5 (de avisar, a preparar).
      **NO nace una segunda forma de emitir una factura:** "Aprobar" llama a `emitirOcurrencia`, **el
      MISMO servicio** que hay detrás del botón de `/admin/recurrentes` (→ `createInvoice` → huella
      Verifactu), y exige **`invoices.create`, el mismo permiso que ese POST** — si no, sería un camino
      más flojo de emitir. El guardián de la doble emisión sigue en el motor (409), no en el panel.
      **Importe SIEMPRE en vivo** desde la plantilla: si le subes el precio a la iguala después de que
      DISA la proponga, se emite —y se enseña— el precio de HOY (probado a propósito: 121 → 242).
      Esquema **aditivo**: `disa_proposals.occurrence_id` + índice único `(occurrence_id, type)`, hermano
      de los otros dos; conviven porque en SQLite los NULL de un índice único son todos distintos entre sí.
      Descartar → no se re-propone. **Candado a propósito MÁS estricto que el de sus hermanos:
      `recurrentes.read` Y `invoices.create`** (la tarjeta enseña datos de la plantilla; emitir cuesta
      `invoices.create`). Quien no puede emitir **no la ve**: ni lista, ni badge, ni se le genera. Falla
      cerrado; **ningún permiso nuevo**. Enganchado en `generarTodo()` → corre en el timer de las 07:45,
      **sin segundo cron**.
      **PRUEBAS — decisión importante:** el camino feliz (aprobar → factura emitida de verdad) se corre
      sobre una **COPIA desechable** de la BD real, **NO en el negocio vivo**. No es pereza: **una factura
      emitida es INMUTABLE** (CANON), y borrarla al terminar el gate para "dejar el tenant como estaba"
      **rompería la cadena de huellas Verifactu**. Así que la emisión se prueba **entera y por la RUTA
      REAL** sobre la copia (`verify-propuestas-recurrentes.mjs` **55/0**: emite con número y huella, la
      ocurrencia queda emitida, la propuesta resuelta, y deja de proponerse sola), y el gate de navegador
      prueba **pantalla + candado** contra el servidor vivo cerrando por **Descartar**, que no emite nada
      (`gate-propuestas-recurrentes.mjs` **28/0**). Que el negocio queda con **cero facturas nuevas** es
      una aserción del gate, no una promesa. (La cola de envío a la AEAT está **inactiva** en desarrollo
      por falta de certificado FNMT: emitir ahí no mandaría nada a Hacienda — pero la factura quedaría.)
      Barrido completo **35/35**.
    - **Navegación HECHA (10 jul, `3b54cf8`):** el riel izquierdo ahora abre con **Inicio** (icono casa
      → `/admin`) y **DISA** como 2º icono, un flyout con el MISMO patrón que las áreas: **Propuestas**
      (`/admin/propuestas`) y **Hablar con DISA** (abre el widget flotante existente vía `disaOpen()`;
      si la pantalla lo oculta cae a `/admin/disa` — nunca crea hilo nuevo). El **badge de pendientes se
      mudó del topbar al icono de DISA** (mismo `contarPropuestasPendientes`, `propBadgeSync` retargeteado;
      se retiró `#tbProps`). Solo navegación/vista; gateado igual (invoices.read/cobros.read). Verificado:
      `gate-nav-inicio-disa.mjs` 34/0.
    - ✅ **D5d — CLIENTES DORMIDOS · reenganche (14 jul 2026, `a30009a`).** Cuarto tipo de propuesta
      (`cliente_dormido`). DISA detecta al cliente **que te compraba y dejó de hacerlo**, y te propone
      reengancharlo. Mismo panel, mismo cron de las 07:45, misma tabla.
      **EL RITMO SE APRENDE, NO SE IMPONE.** Un cliente que compra cada semana lleva dormido a los 30
      días; uno que compra cada trimestre, no — medirlos con la misma vara es lo que convierte un aviso
      útil en ruido que se ignora. Con **2+ compras**: hueco **MEDIANO** (no la media: una compra rara no
      debe torcer el ritmo de un año) **× 2**, con **suelo de 30 días**. Con **1 compra**: **respaldo de
      90**. El que **NUNCA compró NO entra** (no está dormido: nunca despertó). Regla de venta =
      `countsAsReceivable`, la misma que cobros. Las **ventas de mostrador SIN cliente no ensucian a
      nadie**, y no por un filtro: se agrupa por `client_id`, así que una venta que no es de nadie no
      puede dormir a nadie. Ajustables anotados en `ventas-metrics.js`.
      **APROBAR NO ENVÍA NADA** (opción C): aprobar = **DISA REDACTA** y te lo enseña; **enviarlo es un
      segundo clic, tuyo, después de leerlo**. La propuesta sigue *pendiente* tras redactar — aprobar la
      **prepara**, no la resuelve.
      **NO nace un segundo camino de email.** `registerCollectionAction` (el de los recordatorios) está
      **atado a una factura**, y un cliente dormido no tiene ninguna que colgar — *de eso va*. Se usa la
      vía que YA existe para escribir a un cliente sin factura: **`registerClientActivitySvc`
      (type=email) → `core/mailer.sendEmail`**, el único envoltorio de Resend del proyecto ("el mismo
      que cobros"), y **queda registrado en `client_activities`** como si lo hubieras escrito tú.
      **Tono `reenganche` NUEVO** en `opportunityEmail` (aditivo): reutilizar `seguimiento` escribía
      *"Retomo el hilo de TU SOLICITUD"* a alguien que no ha pedido nada — un email sutilmente falso a un
      cliente que ya se fue es **peor que no escribirle**. Sin marketing, sin culpa.
      **REAPARICIÓN:** índice único **PARCIAL** `(client_id, type) WHERE status='pendiente'` → no se
      repite el pendiente, pero el **historial convive sin reescribirse**. El **descanso de 90 días** lo
      aplica el generador, y **cuenta también tras ENVIAR**, no solo tras descartar: si no, al mandar el
      email la propuesta se cerraría, el índice dejaría de bloquear, y a la mañana siguiente le
      escribirías **otra vez** — una máquina de spam en dos líneas.
      `disa_proposals` y `client_activities` **FUERA de WRITABLE_TABLES** (afirmado en el gate).
      **Candado: `clients.read` Y `crm.manage`**. Sin permisos nuevos.
      **DOS BUGS REALES cazados por el camino:** (1) **el badge MENTÍA** — la lista de "qué tipos ve este
      usuario" estaba escrita DOS VECES (rutas y layout del riel), y al añadir D5c solo se actualizó una:
      el badge llevaba el día sin contar las recurrentes. Ahora la regla es **única** (`tiposVisiblesPara`)
      y una aserción la vigila. (2) **el ritmo se medía en FACTURAS, no en días** — lo destapó una clienta
      real con **tres facturas del MISMO día** (una visita, tres documentos): salían "dos huecos de 0
      días" → ritmo 0 → dormida a los 30, explicado con el disparate de *"compra cada 0 días"*. Tres
      facturas de una visita son **UNA compra**; ahora se mide en días distintos.
      Verificado: `verify-propuestas-dormidos.mjs` **92/0** (copias desechables) + `gate-propuestas-
      dormidos.mjs` **39/0** (navegador; el clic de enviar va por **Resend de verdad al buzón sumidero**
      `delivered@resend.dev` — **cero correos a personas**). Barrido **37/37**.
      - ✅ **El fantasma del mostrador, AFIRMADO (14 jul 2026, `c95c95c`).** Verificación pedida aparte,
        sobre el punto ciego que más podía doler. **Las tres pasan con el producto TAL CUAL: no se tocó
        ni una línea de producto.** (1) Una venta de mostrador **ANÓNIMA nunca genera propuesta** —sin
        ficha no hay a quién escribir—: se siembran 3 (una de hace 400 días, que podría "dormir" a
        alguien, y una de ayer, que podría "despertarlo") y se afirma 0 propuestas nuevas, mismo conjunto
        de clientes, ninguna con `client_id` NULL. (2) **LA INVARIANTE:** no se compara el flojo "¿sigue
        dormido?", sino **la ficha ENTERA de sueño** (días, ritmo, umbral, nº de compras, última compra)
        de **seis clientes de ritmos distintos**, byte a byte, **con y sin** las ventas anónimas — y en
        **los dos sentidos** (quitarlas tampoco mueve nada). Si el fantasma se colara por cualquier
        rendija, uno de esos números se movería. (3) **El mostrador ATRIBUIDO SÍ cuenta:** un cliente que
        pasó por el mostrador y la venta quedó pegada a su ficha — sin contar el ticket saldría DORMIDO
        (facturas de hace 200 y 150 días, umbral 100); con el ticket de hace 10 días **no lo está y no se
        te propone**. *Nota de proceso:* la primera versión de (1) falló, y **NO era del producto: era del
        gate** —generaba la línea base DESPUÉS de sembrar los fantasmas—. Se comprobó en aislamiento
        antes de tocar nada; el orden correcto queda escrito en el propio gate.
    - ✅ **D5e — VENCIMIENTOS FISCALES (15 jul 2026, `413bde1`).** Quinto tipo de propuesta
      (`vencimiento_fiscal`) y el primero que **no cuelga de un documento** (factura/ocurrencia) ni de un
      cliente: cuelga de la **FICHA FISCAL del tenant** (qué presenta) y del **CALENDARIO** (cuándo vence).
      Mismo panel, mismo cron, misma tabla.
      **BAMBURU PREPARA, NUNCA PRESENTA (CANON §0-ter).** "Marcar como preparado" cierra el recordatorio y
      —para 303/130— te lleva al borrador en Impuestos; **presentar es tuyo, en la sede de la AEAT**. Aquí
      no nace ningún camino de presentación.
      **SOLO SE PROPONE LO DECLARADO.** `fiscal_profile` (singleton, **FUERA de WRITABLE_TABLES**: DISA no
      se escribe a sí misma qué presentas) es la fuente de verdad; **nunca se asume 303+130 para todos**
      —callarse el 111 de quien tiene un empleado es peor que no avisar—. Sin declarar (`configured_at`
      NULL) no se propone nada, ni con actividad que lo alimentaría. Se declara en **Ajustes › Situación
      fiscal**, en lenguaje llano (sin ver números de modelo si no quieres).
      **LAS FECHAS SON APROXIMADAS A PROPÓSITO** (`calendario-fiscal.js`, lógica PURA): el plazo real se
      corre por fin de semana/festivo, así que se da la fecha NOMINAL con **margen de 10 días** y **gracia
      de 3** (el plazo real suele correrse HACIA DELANTE), y cada propuesta lleva la línea `NOTA_AEAT`. Una
      **regla en código**, no una tabla de fechas a mano que se quedaría vieja en silencio.
      **303/130 traen importe estimado** del motor de contabilidad (casilla 71 / c19), marcado como
      estimación y recalculado EN VIVO; **111/115 y anuales avisan de la fecha y NO inventan cifra**
      (importe null). Si dejas de declarar un modelo, su pendiente pasa a `viva=false` y el panel lo avisa,
      en vez de empujarte a presentar lo que ya no te toca.
      **Idempotencia:** índice único `(fiscal_model, fiscal_year, fiscal_period, type)` → una sola propuesta
      por vencimiento para siempre; el periodo siguiente es otra clave. **El cron genera el 5º tipo:** un
      solo timer para los cinco. **Candado `invoices.read`** (el mismo que la pantalla de modelos): quien no
      ve los modelos no ve sus vencimientos, ni en la lista, ni en el badge, ni se le generan. Falla cerrado.
      Verificado: `verify-propuestas-fiscales.mjs` **62/0** (copias desechables + clon limpio). De paso, el
      gate de dormidos afirmaba `tipos===4`; con el quinto tipo pasó a **5**.
    - ✅ **D5f — REPOSICIÓN DE STOCK (15 jul 2026, `8b4fbe4` + `ff98547`).** Sexto tipo (`reposicion_stock`)
      y cierre del **stock mínimo / punto de pedido** del Pilar 3 (ver Backlog › Inventario). Se ancla al
      PROVEEDOR habitual del producto (reutiliza `supplier_id`). Tres piezas: **NIVELES** por (producto,
      almacén) —tabla `stock_levels`, mínimo+objetivo, apagados por defecto, solo físicos, FUERA de
      WRITABLE_TABLES, editables en la ficha—; **AVISO** "bajo mínimo" en campana+correo, que **reemplaza la
      heurística fija stock<5** (una sola línea en `stockBajo`) y se mide contra el DISPONIBLE por almacén
      (físico − reservado); y la **PROPUESTA** que AGRUPA por proveedor → un borrador de orden de compra con
      todos sus productos bajo mínimo (cantidad = objetivo − disponible; coste = `lastKnownCost`; reutiliza
      `createPurchaseOrderSvc`). **Aprobar CREA el borrador y lleva a la vista para revisarlo; NO lo envía**
      (2º clic del dueño). Un producto sin proveedor habitual **avisa pero no se propone** (pide asignarle
      uno, no lo inventa). Candado **`purchases.create`**. **NO DUPLICAR:** una viva por proveedor (índice
      único parcial); descartada no reaparece con la misma huella; no se apila sobre un borrador vivo;
      recuperación + re-caída se re-propone. **Bug arreglado de paso:** `products.supplier_id` no se
      guardaba (faltaba en `productSchema`, Zod lo stripeaba) → el "proveedor habitual" ya persiste.
      Verificado: `verify-propuestas-reposicion.mjs` **46/0** (copias + clon limpio) + `gate-propuestas-
      reposicion.mjs` **16/0** (navegador, servidor real, limpia por id). Los gates de dormidos/fiscal
      pasaron a **6 tipos**.
    - 📋 **Diagnóstico SOLO LECTURA (14 jul 2026) — terreno para 3 propuestas nuevas.** Se pidieron tres;
      el diagnóstico **dio la vuelta a lo que se esperaba**. Veredicto de cada una:
      - 🟢 **Facturas recurrentes por emitir → VERDE.** El motor **ya existía entero**; no había que
        deducir cadencias de nada. **CONSTRUIDA: es D5c, arriba.**
      - ✅ **Clientes dormidos → CONSTRUIDA: es D5d, arriba** (era ÁMBAR; las dos decisiones se tomaron:
        descanso de 90 días —también tras enviar— y los que nunca compraron quedan FUERA). El punto ciego
        del mostrador se resolvió por diseño: se agrupa por cliente, así que una venta sin cliente no
        duerme a nadie. *(Diagnóstico original, para el registro:)* La última
        compra por cliente sale directa (`MAX(issue_date)`), y `ventas-metrics.js:clientesInactivos()`
        ya hace el cálculo — pero **solo devuelve un número**, hay que extenderlo a filas. El umbral
        encaja igual que sus hermanos (`dias_cliente_dormido` en `company_config` + input en Ajustes).
        **PUNTO CIEGO REAL:** las **ventas de mostrador van sin cliente** (serie S, `client_id=NULL` — 35
        de 72 facturas vivas), así que **quien te compra en el mostrador parecería dormido**. Eso no lo
        arregla el código: es un dato que no está. **DECISIONES PENDIENTES:** (a) cada cuánto se puede
        **re-proponer** un cliente — a diferencia de una factura, que se paga y muere, un cliente **puede
        volver a dormirse**, y el "una propuesta por (cliente,tipo) para siempre" del modelo actual no
        vale tal cual; (b) qué hacer con los clientes que **NUNCA compraron** (¿dormidos, o nunca
        despertaron?). Ojo: eso sí exigiría una **clave de deduplicación genérica** (`(type, periodo)`),
        que **NO se construyó** en D5c a propósito.
      - 🟢 **Vencimientos fiscales (IVA/IRPF) → CONSTRUIDA: es D5e, arriba.** *(Era VERDE y esperaba tu decisión; se tomó y se construyó.)* *(La sorpresa:
        se esperaba que fuera la bloqueada por el motor contable.)* **El motor contable NO está a medias:
        está CERRADO** (Piezas 1–4), y **`modelo303(db,year,q)` y `modelo130(db,year,q)` ya calculan** las
        casillas oficiales del trimestre — **ejecutados en solo lectura sobre T3-2026 y responden**. Lo que
        falta **no es motor**: es el **calendario fiscal** (20-abr / 20-jul / 20-oct / 30-ene, con día hábil
        y corte de domiciliación), que **este TABLERO declara "fuera, sin encargo"** (línea 210). **Requiere
        decisión del dueño para desbloquearse.** Salvedades para cuando se construya: **CANON §0-ter —
        Bamburu PREPARA, nunca presenta**; hay que **propagar los `warnings`** de los modelos (IVA sin
        desglosar, etc.), no esconderlos tras una cifra limpia; y "IRPF del trimestre" es el **130** (pago
        fraccionado) — el **111 no se puede hacer**: `supplier_invoices` no guarda retención, por decisión
        explícita del código.
    - **Siguientes piezas de proactividad (sin encargo, para planificar):** más tipos de propuesta
      (subsanación Verifactu, etc.); push en vivo (SSE) en vez del sondeo de 60 s; que DISA proponga
      desde la propia campana. Es el resto del diseño de D5.
- **Lo que queda del Eje B es diseñar/construir MÁS proactividad.** De las tres propuestas del
  diagnóstico, **las TRES están HECHAS** (D5c recurrentes, D5d dormidos, D5e vencimientos fiscales).
  La última exigía tu decisión sobre el calendario fiscal (estaba "fuera, sin encargo"): se tomó, se
  construyó y se verificó (62/0 + clon limpio). Siguiente proactividad, sin encargo: subsanación
  Verifactu, push en vivo (SSE), proponer desde la campana.

## Verificación (transversal)

- ✅ **HECHO (11 jul 2026) — RESUCITADOS LOS GATES DE NAVEGADOR MUERTOS + runner de regresión.**
  **14** gates guardaban la ruta de la BD a mano (`/home/ibrahin/bamburu/...`); al migrar el servidor a
  `/home/ubuntu` (~19 jun) murieron TODOS y llevaban **tres semanas sin probar nada**. Además, el
  Chromium que trae puppeteer no arranca en este ARM. **Arreglo:** `scripts/lib/gate-env.mjs` resuelve
  la ruta desde la ubicación del script (nunca a mano) y **aborta con código 2** si falta la BD o el
  Chromium — un gate que no arranca ya no puede disfrazarse de aprobado.
  **`scripts/run-gates.mjs`** (nuevo): el barrido que faltaba. Manda el **código de salida**, no lo que
  el gate imprima; un gate que sale 0 sin resumen es SOSPECHOSO y cuenta como fallo; un gate pedido que
  no existe es error; e imprime SIEMPRE la deuda. Grupos: `pagos`, `disa`, `inventario`, `avisos`, `--all`.
  **Resultado real: 23/23 en verde**, con la regresión de Pagos en navegador cubriendo otra vez
  (`gate-pagos-proveedor` 15, `gate-pago-cuenta` 12, `gate-abono-proveedor` 16, `gate-gasto-proveedor` 18,
  `gate-c1c-diferencias-cierre` 20, `gate-disa-dictar-compra` 20). **Ningún bug de producto salió del
  falso verde.**
- ✅ **HECHO (14 jul 2026) — SALDADA LA DEUDA DE LOS 7 GATES DE NAVEGADOR. Barrido 33/33, deuda a cero.**
  `9a36232`. Diagnosticados uno a uno **ejecutándolos**, antes de tocar nada: **ninguno era un bug del
  producto**, y **no se ha tocado una línea de producto**. Pero solo 4 estaban caducados — el diagnóstico
  que había apuntado aquí el 11-jul **acertaba en 4 y fallaba en 3**:
  - **CADUCADOS de verdad (4), arreglados y dentro del barrido:**
    - `gate-recepciones-c1b` (16→**32**) y `gate-devoluciones-proveedor` (17→**32**) — confirmado: el
      guardián de traslados bloquea con 409 **y hace bien**. Su dato era **prestado** (el producto 1, que
      otros mueven). Ahora cada uno **se trae su propio producto** (recién nacido, sin traslados) para el
      camino feliz **y además AFIRMA el bloqueo** sobre un producto sí trasladado: se prueban los **dos**
      caminos, no uno en vez del otro.
    - `gate-orden-compra-c1a` (24→**30**) — `alert()` → `toast()`, confirmado. Y el `alert` fantasma
      **envenenaba la cola de diálogos**: el `prompt()` siguiente se comía la respuesta sobrante y anulaba
      con motivo vacío → moría en un timeout ajeno a la causa. El email real ya no va al dueño: se sigue
      probando **contra Resend de verdad**, pero a su buzón sumidero (`delivered@resend.dev`).
    - `gate-almacenes` (10→**20**) — se envenenaba solo: se buscaba **por nombre** y enganchaba el almacén
      rancio de la pasada anterior. Nombre único por pasada + **borra lo suyo** al salir (idempotente,
      verificado con dos pasadas seguidas).
  - **NO estaban caducados: les faltaba ENTORNO (3).** Aquí el diagnóstico anterior **era falso**:
    - `gate-c2-captura` y `gate-disa-captura-chat` — **`#step2` sí existe**. La causa real era un **429**:
      el tenant agotó su **tope de gasto de IA del mes (5,089 € de 5 €)** y el freno de `core/llm.js` corta
      antes de llamar a la API — funcionando **como debe**. Una prueba que depende del saldo de una cuenta
      no puede vivir en un barrido → **partidas en dos**: la extracción con modelo real se corre **a mano**
      (y **aborta con código 2 si no hay cuota**, en vez de morir con una traza engañosa), y **la pantalla
      entra al barrido** sembrando el adjunto en BD, sin modelo: **`gate-c2-revision` (28)** y
      **`gate-disa-adjuntar` (18)**, ambos nuevos. Esas pantallas pasan de **cero cobertura** a cubiertas.
    - `gate-registro-tailscale` — necesita la red de Tailscale, que aquí no resuelve. Apuntarlo a localhost
      dejaría de probar lo que existe para probar → **aborta (código 2)** y se declara **ENTORNO** en el
      runner: su falta de cobertura **se ve** en cada pasada.
  - **Dos falsos verdes cazados de paso:** una aserción **tautológica** (`x === x`, no podía fallar) y un
    control de acceso que **no probaba nada** (daba por hecho que el empleado 3 no tenía permiso de compras
    — **sí lo tiene**, así que el 403 nunca se comprobó). El empleado sin permiso ahora **se crea a propósito**.
  - Las **seis** pruebas de navegador **limpian lo suyo por ID** y dejan el tenant como lo encontraron
    (stock cuadrado con el libro incluido). `scripts/lib/gate-fixtures.mjs` (nuevo) es el andamio común.
  - **El barrido sigue siendo honesto**, verificado a propósito: una prueba que sale 0 **sin demostrar nada**
    sigue contando como **FALLO** (`SOSPECHOSO`).
- 🌍 **Sin entorno aquí (anotado, no oculto).** No son deuda ni bugs; el runner los grita en cada pasada:
  - **Tope de IA agotado** en el tenant de desarrollo este mes → `gate-c2-captura` y `gate-disa-captura-chat`
    no se pueden correr **ni a mano** hasta que se renueve el mes o se suba `platform_limits.ai_cap_eur`.
  - **Tailscale no está** en este servidor → `gate-registro-tailscale` solo corre donde lo haya (`tailscale up`).
  - `gate-pago-voz-avisos` y `verify-disa-pedidos-modelo-real` llaman al **modelo real**: fuera del barrido
    por naturaleza, a mano y a conciencia.

## Sala de máquinas (servidor / BD)

- ✅ **HECHO (11 jul 2026) — cerrados los 3 hallazgos del diagnóstico del 10 jul.**
  1. **Superadmin ya no escribe por una conexión propia.** `setTenantAiCap` abría su `new Database()`
     de escritura a la `.db` del negocio, fuera de la caché. Dos escritores contra el mismo fichero
     SQLite se serializan: una escritura atascada dejaba al negocio esperando (`busy_timeout` 5 s).
     Ahora escribe por `getTenantDb()` — **la misma conexión cacheada que usa el panel del negocio**.
     Las demás aperturas de superadmin son `readonly: true` (un lector no compite por el bloqueo).
     `arquitectura.md` decía "solo lectura" y era falso: corregido, ahora nombra la excepción.
     Gate nuevo `verify-superadmin-escrituras` (10/0): se pone rojo si alguien reintroduce una
     escritura fuera de la caché. Probado además por HTTP real (tope 5,00 € → 12,50 €).
  2. **`data/bamburu.db` (327 KB) borrado.** El grep encontró una referencia —`init-staging.mjs` lo
     usaba de `db_filename`— pero **ningún tenant apuntaba ahí** y el fichero era una BD de semilla
     del 19-jun jamás usada (1 usuario, 0 clientes, 0 facturas, esquema viejo con `sales_orders`).
     Borrado con respaldo. `init-staging.mjs` corregido a `data/tenants/staging.db` (la convención),
     para que el huérfano no pueda volver a nacer.
  3. **El WAL, acotado — y el diagnóstico estaba EQUIVOCADO en este punto.** No era que "no hiciera
     checkpoint": un `wal_checkpoint(PASSIVE)` a mano devolvía `busy=0` y copiaba TODAS las páginas.
     Los 4,1 MB eran exactamente el umbral de `wal_autocheckpoint` (1000 páginas × 4096 B). Lo que
     pasa es que SQLite **no encoge el fichero** tras un checkpoint: lo reutiliza en el sitio y se
     queda en su marca máxima. El arreglo no es un cron, es **`journal_size_limit = 4 MiB`**
     (`WAL_SIZE_LIMIT`), puesto en `core/control-db.js` y en la caché de `tenant-middleware`. Gate
     nuevo `verify-wal-acotado` (9/0), A/B con la misma carga sobre dos copias: **sin tope deja
     12,74 MB, con tope 4,00 MB**. Tras la regresión completa, ningún `-wal` vivo pasa de 4 MiB.
  - Regresión completa **26/26**. Grupo nuevo del runner: `node scripts/run-gates.mjs infra`.
- ✅ **HECHO (11 jul 2026) — la búsqueda por email ya no abre la BD de nadie en escritura.**
  El hermano del hallazgo 1: `getTenantByEmail` y `getTenantsByEmail` (las usan el **alta** y el
  **login por email**) recorren la `.db` de CADA negocio activo y las abrían en **lectura+escritura**
  solo para un `SELECT`. Dos pegas: una conexión de escritura de más que se serializa con la del
  propio negocio, y —peor— si el fichero **no existía, SQLite lo CREABA vacío** en el intento: una
  `.db` fantasma por cada tenant descuadrado, nacida de una simple búsqueda. Ahora las dos comparten
  un helper que abre con `{ readonly: true, fileMustExist: true }`. Gate nuevo
  `verify-tenant-lookup-readonly` (17/0), que además **demuestra el bug viejo** (sin esos flags,
  SQLite crea el fichero). Probados los dos flujos reales: `/find-tenant` por HTTP y `emailTaken`.
  Regresión **27/27**.
- ✅ **HECHO (11 jul 2026) — auditoría de la clave de Anthropic + rotación.** La clave **nunca** se
  había filtrado: 0 en el árbol, 0 en los **5.967 objetos de git** (incl. sueltos), 0 en los `.service`
  (todos usan `EnvironmentFile`), 0 en los logs rotados, `.gitignore` correcto, fichero `0600`.
  **La filtré yo al auditar**, con un `sudo grep -F "$CLAVE"` — `sudo` registra la línea de comando
  entera. Limpiado `auth.log`; clave **rotada** y verificada con una llamada real a DISA. La lección
  (nunca un secreto en `argv`) queda en `errores-conocidos.md`.

## Eje C: Seguridad  ✅ COMPLETO (C1–C6)

> Origen: **auditoría de seguridad de SOLO LECTURA del 15 jul 2026** (`docs/seguridad/auditoria-ejeC.md`,
> commit `24dbf2a`). Postura general **buena** (aislamiento entre negocios sólido y fail-closed, DISA no se
> sale de `WRITABLE_TABLES`, backups montados y verificados, transporte/cabeceras casi completos). Cada
> tarea referencia su(s) **código(s) de hallazgo del informe** con file:line — no descripciones de memoria.
> Orden = por gravedad y reversibilidad. **Estado (16 jul): CERRADO — C1 a C6 hechas.** Lo que NO se
> arregló (B5, B11-tienda, B12 como riesgo asumido; B10 aplazado; C4b-3/C4b-4 descartadas) está por escrito
> con dueño y fecha en sus fichas y en el informe. El estado vivo de cada tarea está en su ficha, abajo —
> esta línea no lo duplica.

- ✅ **C1 — [A1 · ALTA] Cadena legal de Verifactu encadenada por NIF del emisor (15 jul 2026, `2fdc9bf`).**
  Lo que quedaba sin proteger: el encadenado elegía el previo por `id` GLOBAL, así que un cambio de NIF en
  Ajustes cruzaría dos cadenas legales en silencio (irreparable una vez enviado a la AEAT). **PASO 0 (solo
  lectura):** `id_emisor` estaba POBLADO en los 3 tenants con registros y coincidía con el NIF de cada
  empresa (0 vacíos) → sin relleno; las 2 facturas enviadas a la AEAT, intactas. **Arreglo:** (a) filtro por
  `id_emisor` en los dos sitios — `verifactu.js` (`lastHuella(db, idEmisor)`) y `verifactu-envio.js` (previo
  del envío `AND id_emisor=?`); (b) **candado** en Ajustes: bloquea el cambio de `company_config.fiscal_id`
  si ya hay registros Verifactu (409); (c) **guarda** en `recordVerifactuAlta/Anulacion`: detiene la emisión
  (409) si la base ya tiene registros de otro NIF; (d) **cinturón** idempotente (migración por bandera) que
  completa `id_emisor` vacío con el NIF de la empresa (0 filas hoy; no toca la huella). Para un solo NIF las
  cadenas quedan IDÉNTICAS (sin cambio de comportamiento). Verificado: `verify-verifactu-cadena-nif.mjs`
  **18/0** (reproduce el fallo global≠per-NIF, guarda, candado, cinturón, datos intactos) + comprobación en
  navegador de que emitir una factura sigue funcionando y encadena bien. Regresión verde (t1 18/0, t2 17/0,
  mostrador 24/0, cola 62/0). *(De paso, hallazgo nuevo: `verify-mostrador-overstock.mjs` emite tickets al
  tenant VIVO y no limpia sus registros Verifactu — higiene de gate a arreglar; anotable como BAJA del Eje C.)*

- ✅ **C2 — Verificación con administrador de los 4 puntos "no verificados" (16 jul 2026).** VERIFICACIÓN
  (sin cambios de config/código), regla de oro cumplida (ningún valor de secreto impreso). **Los 4 salieron
  OK — ningún problema, ninguna tarea nueva.** (1) Redirect http→https en runtime: petición real por `:80` →
  **308 → https://** (apex y subdominio con query). (2) Remoto rclone `gdrive:` válido y alcanzable, con la
  copia MÁS RECIENTE de HOY (8 archivos en Drive, diaria sin huecos, restore-test real en el journal). (3)
  `/etc/bamburu.env` = **600 ubuntu:ubuntu**, no legible por terceros; claves presentes por nombre (sin
  valores); el CF_API_TOKEN va en el entorno de Caddy, no aquí. (4) Caddy **sin directiva `log`** y
  `/var/log/caddy/` vacío; **0** líneas con el token de reset en journald (Caddy y bamburu) → el token no
  acaba en ningún log. Detalle en `docs/seguridad/auditoria-ejeC.md` § "C2 — verificación con administrador".

- ✅ **C3 — Victorias rápidas (tres arreglos, 16 jul 2026).** VERIFICADO: `npm audit` sin la CVE de `hono`;
  barrido oficial `run-gates --all` **43/46** — los 3 rojos (`verify-propuestas-dormidos`, `gate-recepciones-c1b`,
  `gate-c1c-diferencias-cierre`) son **pre-existentes por datos vivos, NO C3**: `dormidos` confirmado por `git stash`
  (falla igual en el código previo) y los dos de navegador fallan por precondición de datos (`stock 309→309`, el
  `confirmReceipt is not defined` cae en cascada al aterrizar en la página equivocada) — el diff de esos ficheros es
  solo server-side y sus gemelos (`gate-propuestas-dormidos`, `gate-orden-compra-c1a`) pasan. App arranca y responde igual.
  - **[M2] `hono` 4.12.18 → 4.12.30** (parchea la CVE HIGH de restricción por IP). Sin cambios incompatibles con el
    uso actual; regresión en verde. `package.json` a `^4.12.30`, `npm audit` = 0 vulnerabilidades.
  - **[M7] El login ya no registra email ni estado de 2FA** — `modules/erp/routes/auth.js`
    (`console.log('[Login] user:', email, '| totp_enabled:', …)` → `console.log('[Login] ok userId:', user.id)`).
    Comprobado en vivo: provocado un login real, el journal muestra `[Login] ok userId: N` y CERO email/totp/2FA.
  - **[M4] Ningún `e.message` de SQL viaja al cliente** — helper central `core/errors.js` `safeError(e)`: un 4xx
    intencional muestra su mensaje; SQL/inesperado → mensaje genérico y el detalle va SOLO al log del servidor.
    Aplicado a 236 `catch` en 38 ficheros. Gate `verify-safe-error` (15/0) añadido al grupo `infra` del barrido.
    Comprobado en vivo: categoría duplicada → el cliente ve "Ha ocurrido un error, inténtalo de nuevo." y el
    `[error] SqliteError: UNIQUE constraint failed: categories.name` queda en el log del servidor, nunca en el cliente.

> **C4 SE PARTIÓ EN TRES (16 jul 2026, decisión del dueño).** El informe daba M1 como «BAJO por caso, 6
> sitios»; el barrido de verdad encontró **67 puntos** (58 abiertos tras C4a). Y M8 (la CSP) resultó ser un
> refactor de todo el admin —**414 `onclick` + 109 handlers + 81 `<script>` inline**, y los nonces NO cubren
> los handlers de atributo—, no una tarea de sesión. Empaquetarlos juntos habría dejado el XSS real esperando
> semanas a la CSP. C4a (hecho) · C4a-bis (los 58) · C4b (la CSP).

- ✅ **C4a — [M1] Saneado del XSS almacenado: los 6 del informe + una clase de fallo que el informe no vio
  (16 jul 2026).** Los 6 listados, envueltos en `escHtml` respetando la convención de cada fichero
  (`escHtml` a pelo en `clients.js`/`products.js`, `window.escHtml` en `categories.js`/`discounts.js`):
  notas de cliente, grupos, categorías, descuentos automáticos (`a.name` + `a.condition_value`) y los dos
  `<option>` del editor de producto. Más el `<option>` server-rendered de proveedor (`purchases.js`, que no
  importaba `escHtml`) y el escape PARCIAL del almacén (`replace(/</g,'&lt;')` → `escHtml`).
  - **HALLAZGO NUEVO — ruptura de `</script>`, peor que los seis:** `purchases.js` inyectaba el catálogo en
    un `<script>` con `var PRODUCTS=${productsJson}`. Un producto llamado `</script><img src=x onerror=…>`
    cerraba la etiqueta y el resto se parseaba como HTML. **`escHtml` NO lo arregla** (dentro de un
    `<script>` no se decodifican entidades). Defensa: **`jsonForScript()` en `core/escape.js`** (helper
    central, un solo sitio, como `safeError()` en C3). El código ya conocía el vector en UN sitio
    (`store/routes.js:1444`) y no en su gemelo — la misma evidencia de omisión que el almacén.
  - **LOS 3 MÁS GRAVES DEL BARRIDO, arreglados aquí** (el resto → C4a-bis):
    - **`superadmin/index.js:177,189` — ANÓNIMO → SESIÓN DE SUPERADMIN.** Cadena verificada entera:
      `/api/registro/crear` es **público** (rate-limit, sin auth) · `businessName` se valida con `str(120)`
      = `z.string().trim().min(1).max(120)`, **sin filtro de HTML** · la lista de Negocios escapa bien
      (`:156-157`) **pero** `saCap()`/`saSuspend()` leen `tr.dataset.name`, que el navegador devuelve
      **DECODIFICADO**, y lo reinyectan por `innerHTML`. Un desconocido se da de alta con un nombre-payload
      y ejecuta código en la sesión del superadmin **en cuanto se pulsa un botón de su fila**. El `escHtml`
      del atributo es justo lo que lo escondía. Arreglo: `saEsc()` en `superadmin/layout.js`, junto al
      `saOpenModal` que hace el `innerHTML`. **Matiza el titular del informe** («ningún agujero crítico
      explotable de forma anónima»): plantarlo es anónimo; ejecutarlo depende de un clic del superadmin.
    - **`invoices.js` — datos de empresa sin escapar en TODA factura** (`document_name`, `invoice_number`,
      `company_name`, `company_fiscal_id`, `company_address`, `tax_name` ×3, `notes`, `it.description`).
    - **`stock-modal.js:50` + `inventory.js:50` — `WAREHOUSES` (Clase B).** El gate demostró que arreglar
      solo el componente compartido NO bastaba: `inventory.js` declara **su propia** const `WAREHOUSES`
      duplicada en la misma página (la del componente vive dentro de un IIFE, por eso conviven). El
      `</script>` rompía el `<script>` entero y se llevaba por delante hasta el IIFE ya arreglado.
  - **Verificado:** `verify-xss-escape` **14/0** + `gate-xss-escape` **23/0** (navegador, 4 pantallas:
    Categorías · Nueva compra · Inventario · Superadmin), ambos en el grupo `infra` del barrido. **El gate
    REPRODUCE el fallo**: con `git stash` sobre el código anterior da **18 rojos** — `/admin/purchases/new`
    moría con `SyntaxError` y `PRODUCTS` a `undefined`, y en Superadmin el payload **sí** ponía
    `window.__xss` tras pulsar «Tope IA». Limpia tras de sí, también en `control.db`.
  - **Lo que NO se pudo probar en vivo, y por qué:** el papel de la factura lee `inv.company_name` etc. de
    la **fila de `invoices`** (snapshot congelado al emitir), no de la config viva. Plantar un payload ahí
    exigiría **mutar una factura ya emitida** —documento legal con huella Verifactu—, que el ritual prohíbe.
    Ese arreglo queda verificado por revisión + regresión, no por payload. Anotado a conciencia.

- ✅ **C4a-bis — [M1] Cerrado el resto del XSS almacenado: 44 puntos (16 jul 2026).** Con esto, **M1 queda
  cerrado entero**: no queda ni un sink de Clase B con datos de usuario, ni un escape parcial de los
  inventariados. Misma solución central que C4a, sin mecanismos nuevos: `escHtml` (`core/escape.js` y su
  espejo `window.escHtml`) para HTML, `jsonForScript` para todo lo que aterriza en un `<script>`.
  - **ERA 44, NO 58 — y el error era mío, del TABLERO.** El "58" era el recuento del barrido **anterior** a
    los 3 arreglos graves de C4a, y esos 3 se llevaron 15 puntos por delante (las 10 líneas de `invoices.js`,
    las 2 de superadmin, las 2 de `WAREHOUSES` y el parcial de `inventory.js:21`). El inventario real, ya
    verificado contra el código: **43 abiertos** + **1 hallado al verificar** (`orders.js:932`, `PRODUCTS` con
    `JSON.stringify` crudo — Clase B, no estaba en la lista). Lección: un inventario con `~` y `…` no es una
    lista cerrada; hay que fijarlo con `file:line` verificado o no sirve para acotar alcance.
  - **Reparto de los 44:** 9 de Clase B (`albaranes.js` `linesJson` · `purchase-orders.js` `catalog`+`SEED` ·
    `stock-transfers.js` `catalog` · `supplier-returns.js` `ORIGINS` · `quotes.js`/`pedidos.js` `PRELOAD` ·
    `invoices.js` `SEED_LINES` · `orders.js` `PRODUCTS`) · 8 de Clase A servidor (papel de compra ×6 +
    `store/routes.js` ×2) · 18 de Clase A cliente · 9 escapes parciales completados.
  - **12 de los 44 están en CÓDIGO MUERTO, y hay que saberlo:** `/admin/orders` y `/admin/shipping` dan
    **404** — sus `admin.route(...)` están comentados (`routes/index.js:108,112`) y `shipping_methods` está
    archivada; es el clúster de e-commerce que desmontó D1. Son `orders.js` (9 puntos) y `shipping.js` (3).
    Se arreglan igual —red por si se remontan— pero **no eran vulnerabilidades vivas** y **no se pueden
    verificar en navegador**: la pantalla no existe.
  - **`store/routes.js` (2, Capa 2 congelada) — tocado CON permiso expreso del dueño.** Es el único XSS del
    inventario que alcanza a un CLIENTE FINAL, no al panel: `<img src="${p.image_url}">` rompía el atributo,
    y en `:1380` además `onclick="setMainImg(${JSON.stringify(img)},this)"` metía comillas dobles dentro de
    un `onclick="..."`. Se usa `escHtml` y NO `safeUrl` a propósito: la CSP permite `data:` y `blob:` en
    `img-src`, y `safeUrl` los rechazaría — rompería imágenes que hoy funcionan.
  - **Verificado:** `verify-xss-escape` **49/0** · `gate-xss-escape` **29/0** (navegador). **Ambos DEMUESTRAN
    el fallo** contra el código previo (`git stash` de solo `modules/`, para no revertir los propios gates):
    **9 rojos** en el guardián estático y **6 rojos** en navegador, con `ReferenceError: catalog is not
    defined` — el `</script>` mataba el script entero. Barrido `run-gates --all` **45/48**: los 3 rojos son
    los MISMOS pre-existentes por datos vivos (`verify-propuestas-dormidos`, `gate-recepciones-c1b`,
    `gate-c1c-diferencias-cierre`), NO de esta tarea.
  - **Por qué parte del gate es ESTÁTICA (`verify-xss-escape` [5]/[6]) y no de navegador:** cada sink que
    falta vive en una pantalla que exige un DOCUMENTO montado (un albarán nace de un pedido confirmado;
    `PRELOAD`, de un presupuesto guardado; `ORIGINS`, de una compra recibida). Montar esos fixtures cuesta
    más que el arreglo y mete escrituras de documentos —algunos con valor legal— dentro de un gate de
    seguridad. Lo que sí se afirma sin ambigüedad es la REGLA: si el dato lo escribe el usuario y aterriza
    en un `<script>`, se serializa con `jsonForScript`. Los sinks alcanzables (catálogo ×2, inventario,
    nueva compra, categorías, superadmin) se prueban de verdad en navegador.
  - **Deuda de fondo, NO cerrada aquí (no estaba en el alcance):** ~14 ficheros definen su propio `esc` local
    — es `core/escape.js` duplicado 14 veces. No es un agujero (los inventariados ya se completaron), pero es
    la causa de que estos fallos se repitan. Quedan parciales fuera del inventario en `layout.js:111,186,300`,
    `email-templates.js:28` y `contabilidad-export.js:136` (este último es escape XML, otro contexto).

- 🟡 **C4b — [M8] Quitar `'unsafe-inline'` de `script-src`. C4b-0, C4b-1 y C4b-2 HECHOS (16 jul 2026).
  Falta decidir C4b-3 (store) y C4b-4 (ERP) — AHORA CON DATOS MEDIDOS.**

  > **EL DATO QUE DECIDE C4b-4, ya no es una opinión: `CSP_PROBE=1` sobre las 23 pantallas del ERP da
  > 108 violaciones, TODAS `script-src-elem` (bloques `<script>`) y CERO de handlers. Porque los
  > `onclick` NO violan al cargar: solo al PULSARLOS.** Comprobado en `/admin/categories`: 5 violaciones
  > al cargar, **25 botones con `onclick` en el DOM sin delatar ni una**, y al primer clic aparece
  > `script-src-attr`. Traducido: **una pantalla del ERP puede parecer perfecta y tener 25 botones
  > muertos.** Verificar C4b-4 exige PULSAR los ~470, uno a uno. Ese es el coste real, y ahora está medido.

  > **La premisa que lo cambia todo: la CSP es una cabecera POR RESPUESTA.** No hay que migrar los 522
  > handlers para empezar a proteger — se puede endurecer superficie a superficie. Y **las superficies
  > críticas son diminutas: registro 2 handlers, superadmin 11.** El 90% del problema (470) está en el ERP,
  > que es justo donde menos urge. Esto convierte "refactor de todo el admin" en "13 handlers y dos
  > superficies", con el ERP como decisión aparte y con datos.

  **Regla técnica que manda el diseño:** en cuanto una respuesta lleva un **nonce** en `script-src`, el
  navegador **IGNORA `'unsafe-inline'`** en esa respuesta. No existe migración parcial DENTRO de una página:
  es todo-o-nada **por respuesta**. Por eso el corte es por superficie, y por eso no se puede "ir soltando"
  el `unsafe-inline` poco a poco en la misma página.

  **Medido el 16 jul (no de memoria):**
  - **522** handlers son **atributo HTML** (`on…="…"`) → los bloquea la CSP. Otros **8** son asignaciones JS
    (`el.onclick = fn`) y **NO** las bloquea: el número real es **522**, no 530.
  - Reparto: **registro 2** · **superadmin 11** · **store 20** · **disa 19** · **ERP 470**.
  - **DISA NO es superficie separable:** su widget se inyecta en `adminLayout` (`layout.js:1178`) → comparte
    respuesta, y por tanto CSP, con el ERP. Van juntos (489).
  - **83** `<script>` inline (68 en el ERP) y solo **2** externos.
  - `base-uri 'self'` y `object-src 'none'` **ya están puestos**, y no hay `'unsafe-eval'`: de M8 solo queda
    el `'unsafe-inline'`.

  ### ✅ C4b-0 — Fontanería + instrumento de medida — HECHO
  Nonce por petición en `core/security-headers.js` (se genera ANTES de `next()`, va a `c.set('cspNonce')`
  y la política se elige DESPUÉS según `SUPERFICIES_ESTRICTAS`). Y la sonda: **`CSP_PROBE=1`** añade la
  política estricta en `Content-Security-Policy-Report-Only` a las superficies NO endurecidas — no bloquea
  nada, solo apunta. Apagada por defecto: producción no la ve.
  **Resultado de medir el ERP (23 pantallas): 108 violaciones, todas `script-src-elem`.** O sea, los
  bloques `<script>` (4-5 por pantalla, porque casi todas comparten `adminLayout`), NO los 470 handlers
  — esos solo se delatan al pulsar. La sonda mide media montaña; la otra media exige clics.
  *(Para correrla: `set -a; . /etc/bamburu.env; set +a` y arrancar una instancia con `CSP_PROBE=1` en otro
  puerto. Sin las variables de entorno el módulo ERP no carga y todo da 404 — parece que no hay
  violaciones cuando lo que pasa es que no hay app.)*

  ### ✅ C4b-1 — registro (2) + superadmin (11) — HECHO. Las dos superficies que más duelen
  `/registro` es **público y anónimo**; superadmin es **la cuenta que ve todos los negocios** — donde C4a
  encontró el peor agujero del proyecto. **Ambas sirven ya `script-src 'self' 'nonce-…'`, SIN
  `'unsafe-inline'`.** El ERP conserva la política de siempre, a propósito.
  - **Cómo se migró cada tipo de handler** (respetando el idioma de cada fichero, sin inventar un
    framework): los botones de FILA de superadmin → **delegación** sobre `tbody` leyendo `data-act` (la
    fila ya tenía `data-id`); los botones de MODAL (los que nacen del `innerHTML` de `saOpenModal`) →
    `id` + `.onclick=`, que es **el idioma que ese fichero YA usaba** en `susAdmin`/`susSec`; registro →
    `addEventListener` en el script.
  - **Nonce**: uno por petición (`randomBytes(16)`), pasado a `saLayout(...,nonce)`, a
    `changePasswordPage(sess,nonce)` y a `onboardingHtml(nonce)`; las vistas con `<script>` propio lo
    leen de `c.get('cspNonce')`.
  - **DOS FALLOS QUE CAZÓ EL GATE, y que son la lección de C4b:** (1) el enganche de registro quedó dentro
    de `showCreateButton()`, que solo corre al final del alta → los 2 botones **muertos al cargar**, sin
    error y sin violación de CSP; (2) al moverlo arriba, `ReferenceError`: `togglePw`/`crear` son
    `window.x = function(){}` (asignaciones, **no** declaraciones), así que no se hoistean → se enganchan
    con una función flecha para que la búsqueda ocurra al PULSAR. **Ninguno de los dos se ve al cargar la
    página.** Esto es exactamente lo que pasaría ×470 en el ERP.
  - **Verificado:** `gate-csp-estricta` **19/0** (en el grupo `infra`). Comprueba la cabecera, que el nonce
    CAMBIA en cada petición, que el ERP NO se ha endurecido de rebote, y **pulsa los botones** de verdad
    («Mostrar» cambia a «Ocultar»; «Tope IA» abre su modal por delegación; «Cancelar» lo cierra), con CERO
    violaciones. **Demuestra el fallo**: contra el código previo (`git stash` de solo `modules/ core/`) da
    **8 rojos limpios**, sin reventar.

  ### ✅ C4b-2 — Los scripts de CDN, autoalojados — HECHO. **Eran 4, no 2**
  El plan decía 2 porque el `grep` miró en `modules/` y **no en `index.js`**: la **landing pública** cargaba
  además **gsap + ScrollTrigger** (`index.js:343-344`), también sin `integrity=`. Los 4 iban a pelo desde
  `cdn.jsdelivr.net`: comprometer ese CDN = **JS arbitrario en el panel Y en la landing**, y eso no lo tapa
  ningún escapado.
  - Ahora se sirven desde `'self'` en `public/vendor/` (misma convención que `tabler`, que ya estaba
    autoalojado): `gsap/` (gsap 3.12.5 + ScrollTrigger), `chartjs/` (chart.js **4.5.1**), `sortablejs/`
    (1.15.0). **Bajados con `npm pack`, NO con curl del CDN**: así la integridad la verifica el registro de
    npm y no el mismo CDN del que se desconfía.
  - **`cdn.jsdelivr.net` fuera de `script-src`, `style-src` y `font-src`.** `fonts.googleapis/gstatic` SE
    QUEDAN: los usan la tienda, la landing y `public/bamburu.css`.
  - De paso se **congela la versión**: `chart.js@4` flotaba a la última 4.x sola, en cada carga.
  - **Verificado en navegador:** landing (`window.gsap` + `ScrollTrigger`) y Analítica (`window.Chart`, 2
    gráficos pintando) — 200, sin errores JS, sin violaciones. **Sortable NO se pudo probar: vive en
    `/admin/store-settings`, que da 404** (constructor de tienda desmontado por D2, `routes/index.js:115`).
    Cuarta vez que aparece código muerto en este eje.

  ### 🔒 C4b-3 — store (20 handlers) — DECIDIDO (16 jul 2026): NO, mientras esté apagada
  **Decisión del dueño. La tienda NO se endurece mientras esté apagada/desmontada.** Endurecer una
  superficie que hoy no sirve a nadie es pagar el riesgo de romperla sin cobrar la protección: no hay
  usuario al que proteger porque no hay tienda encendida. **Si algún día se reactiva como producto, el
  endurecimiento entra CON esa reactivación** — no después y no como tarea suelta: forma parte de volver a
  encenderla, igual que volver a probarla. Esto es deuda **consciente y con dueño**, no un olvido.

  ### 🔒 C4b-4 — ERP + DISA (489) — DECIDIDO (16 jul 2026): NO se le aplica la CSP
  **Decisión del dueño, con los datos de la sonda ya medidos (abajo).** El panel de gestión (470 botones)
  se queda con `'unsafe-inline'`. Las tres razones, en orden:
  1. **El XSS ya está cerrado y con tests** (M1 completo: C4a + C4a-bis, 44 puntos saneados con gate). Aquí
     la CSP sería cinturón contra un XSS **futuro**, no contra uno vivo.
  2. **El precio es romper botones EN SILENCIO.** Un `onclick=` bajo CSP estricta no da error: simplemente
     no hace nada. Y la sonda demostró que **no se delatan al cargar, solo al pulsarlos** (25 botones en
     `/admin/categories` y CERO violaciones hasta el primer clic). Verificar exige pulsar ~470 a mano.
  3. **El 90% del valor ya está cobrado por el 2% del trabajo:** las dos superficies donde un XSS dolía de
     verdad —registro (anónimo) y superadmin (ve todos los negocios)— ya van con CSP estricta (C4b-1/2).
  **Deuda aceptada, con dueño y por escrito.** Si algún día se hace: por pantalla, con `CSP_PROBE=1` y
  pulsando todo. Terminar en "deuda anotada" es el resultado honesto, no un fracaso.

  #### Los datos que sostienen la decisión de C4b-4 (medidos, no estimados)
  470 + 19 handlers, 39 ficheros, 68 `<script>`. Las piezas compartidas cubren poco (~43 vía
  `rowMenu`/`emptyRow`/`cta:onclick`): el resto son **~470 ediciones a mano**.
  - **Lo que dice la sonda (medido, no estimado):** 23 pantallas, **108 violaciones al cargar, todas
    `script-src-elem`** — o sea, los BLOQUES `<script>` (4-5 por pantalla, casi todos de `adminLayout`).
    Esa parte es **barata**: marcar con nonce ~68 etiquetas.
  - **Lo que la sonda NO puede medir, y es el problema:** en `/admin/categories` hay **25 botones con
    `onclick` en el DOM y CERO violaciones al cargar**; al primer clic aparece `script-src-attr`. Los
    handlers **solo se delatan al pulsarlos**. Verificar los 470 exige pulsarlos uno a uno; los gates
    cubren ~49 escenarios, no 470 botones.
  - **Y el valor, dicho honesto:** M1 está CERRADO y con gate. Aquí la CSP es cinturón contra un XSS
    **futuro**, no contra uno vivo. Las dos superficies donde un XSS de verdad dolía (registro anónimo y
    superadmin) **ya están protegidas** — que era el 90% del valor por el 2% del trabajo.

  ### NO entra en C4b: `style-src`
  Son **2027** `style="..."` y el valor es muy inferior (inyección de ESTILO, no ejecución de código). Se
  queda `'unsafe-inline'` en `style-src`, a propósito y por escrito.

- ✅ **C5 — Endurecer el acceso (16 jul 2026).** Los tres entregables cerrados. **PASO 0 (solo lectura):**
  las sesiones son store en SERVIDOR (`admin_sessions` por tenant, cookie `asess`; el superadmin aparte en
  `control.db` + cookie `sadm`) → revocar es borrar una fila, no hay JWT que esperar a que caduque. Dos
  sorpresas, las dos a favor: el flujo de `forgot-password` YA existía con caducidad (1 h) y un solo uso
  (`used=0/1`) — de los tres puntos de M6 solo faltaba el freno; y el TOTP ya estaba escrito y probado en
  `core/totp.js` (M3 era cablearlo, no construirlo).
  - ✅ **[M5] Revocar las sesiones al desactivar un usuario.** El gate se puso en `getAdminSession`
    (`core/auth.js`), no en la ruta: así expulsa venga la desactivación de donde venga (panel, script, UPDATE
    a mano), y la sesión muerta se borra al detectarla. `PUT /users` además corta sus sesiones y su espejo en
    `control.db` (higiene, no el candado). Verificado: `test-c5-sesiones.mjs` **10/0** (rojo 4/10 antes).
  - ✅ **[M6] Freno en `forgot-password` + enumeración cerrada.** Dos limitadores encadenados: por **IP**
    (5/15 min, contra el barrido de una lista) y por **email** (3/15 min, contra inundar UN buzón desde mil
    IPs) — el de IP solo no cubre lo segundo. Para eso `rateLimit` acepta ahora `keyFn` (aditivo; sin ella se
    comporta igual que siempre). El **email nunca entra en `security_events`**: PII, misma lección que C3/M7.
    La enumeración tenía DOS fugas, no una: (a) si Resend fallaba salía un **500**, que solo podía verse con
    un email registrado — el error era la confirmación; (b) el reloj. Medido antes de tocar nada: **6,8 ms
    con cuenta real vs 0,7 ms sin ella — 10,4× y SIN SOLAPAMIENTO**, o sea que UNA medición clasificaba un
    email. El primer intento de arreglo (llamar sin esperar) **no bastó**: el cuerpo de una función `async`
    corre síncrono hasta su primer `await`, y el INSERT y `renderEmail` son de better-sqlite3 = síncronos.
    Con `setImmediate`: **1,01×, ramas indistinguibles**. Verificado: `test-c5-forgot.mjs` **24/0** (rojo
    9 fallos antes) + medición de 40 muestras por rama + comprobación contra el servidor vivo (freno real
    5→429; cuenta real vs inventada = misma huella de cuerpo).
  - ✅ **[M3] 2FA (TOTP) para el superadmin, con códigos de rescate.** Decisión del dueño: app de
    autenticación, no email. Alta con QR + secreto y **exigiendo un código válido** (activar a ciegas =
    cerrar con la llave dentro); 10 códigos de rescate mostrados UNA vez, guardados con bcrypt, de un solo
    uso (`used_at`, no borrado: deja rastro de cuándo). Regenerar y desactivar **piden el código**: si
    bastara la sesión, el 2FA no protegería del robo de sesión. Usar un rescate levanta evento en la zona
    Seguridad. Migración aditiva (`superadmin_recovery_codes`). Último recurso documentado:
    `scripts/superadmin-2fa-off.mjs <email>`. Verificado: `test-c5-2fa-superadmin.mjs` **39/0** (control.db
    desechable; los códigos TOTP los genera **otplib**, librería independiente → prueba de que una app real
    entra) + `gate-c5-2fa-superadmin.mjs` **18/0** en navegador real contra la CSP estricta, con cuenta
    desechable (activar el 2FA de la cuenta real desde un script es el bloqueo que C5 evita).
  - ✅ **Extra decidido por el dueño (salida de emergencia):** `scripts/reset-admin.js` ya limpia
    `totp_secret`/`totp_enabled`. **No era un extra: sin esto el script no rescataba a nadie con 2FA** — la
    persona entraba con la contraseña nueva y chocaba contra la pantalla del código, fuera para siempre.
    Hoy no había nadie en riesgo (`totp_enabled=0` en los 6 negocios), pero era un bloqueo permanente
    esperando al primer dueño que activara el 2FA.
  - *Hallazgo de paso:* `otplib` está en **`dependencies`** y no lo importa nadie en producción (el TOTP es
    `core/totp.js`, escrito a mano). Ahora solo lo usan el test y el gate → le tocaría `devDependencies`.
    Anotado, no tocado (fuera del alcance de C5).

- ✅ **C5-bis — Códigos de rescate para los DUEÑOS de negocio (16 jul 2026).** El dueño que active el 2FA
  y pierda el móvil ya NO se queda fuera: entra con un código de rescate, sin depender de que alguien
  entre por SSH un domingo. Reflejo del mecanismo del superadmin (C5), sin tocarlo.
  - **PASO 0 — lo que decidió el diseño:** `core/recovery-codes.js` **ya era el helper compartido**
    (genérico, no sabe nada del superadmin) → se reutiliza sin tocar una línea. La otra mitad —guardar y
    consumir— **no se puede compartir**: la del superadmin vive en `control.db` con `superadmin_id`; la del
    dueño, en la BD de cada negocio con `admin_user_id`. Bases distintas, ciclos distintos: se refleja
    (`enableAdminTotp`/`disableAdminTotp`/… en `core/auth.js`, reciben `db`), no se fuerza un helper común.
  - ✅ **Activar exige código y entrega 10 códigos** (`/admin/perfil/confirm-2fa`), en transacción: activar
    sin dar rescate es cerrar con la llave dentro. Se enseñan **una vez** (se renderizan, no se redirige:
    un redirect los perdería), con copiar y descargar, y el **"Terminar" nace BLOQUEADO** hasta marcar "he
    guardado". El modo de fallo real no es que los roben: es cerrar la pestaña sin guardarlos.
  - ✅ **En el login, el mismo campo acepta app o rescate** (`auth.js`, `POST /admin/verify-2fa`): primero
    TOTP, luego rescate; de un solo uso y atómico. Usarlo queda en **su Actividad** (con cuántos quedan) y
    levanta evento `login_2fa_rescate`. El código NUNCA se registra: sería publicar la llave usada.
  - ✅ **Regenerar exige código** (app o rescate) e invalida el juego anterior; el Perfil muestra cuántos
    quedan y cambia de tono si quedan pocos o ninguno. **Desactivar borra los códigos** (llave bajo el
    felpudo). Migración aditiva e idempotente por tenant: `admin_recovery_codes`.
  - ✅ **DISA no los toca:** añadida a `QUERY_PROTECTED_TABLES` — no bastaba con dejarla fuera del mapa de
    lectura, porque owner/admin hacen **bypass** de ese mapa y podría pedírselos por chat. (Escribir ya era
    imposible: `WRITABLE_TABLES` es allowlist.)
  - ✅ **Puerta trasera cerrada (decisión del dueño).** `/admin/setup-2fa`, `/admin/confirm-2fa` y
    `/admin/disable-2fa` seguían **montadas y funcionando** pese a que U8 consolidó el 2FA en el Perfil:
    activaban 2FA **sin códigos de rescate** — el mismo bloqueo, por detrás. Retiradas con **302 al Perfil**
    (patrón de U8 con `/admin/security`: "un 302 no rompe a nadie; un 404 sí"). De paso cierra lo que
    `security.js:15-18` dejó anotado como pendiente del Eje C: se montaban **fuera del middleware CSRF**.
    Ahora el 2FA del dueño tiene UNA puerta, y es la que entrega códigos.
  - Verificado: `test-c5bis-rescate-duenyo` **52/0** (tenant desechable; los TOTP los genera **otplib** →
    prueba de que una app real entra) + `gate-c5bis-rescate-duenyo` **19/0** en navegador real, de punta a
    punta: activa, ve los 10, cierra sesión, entra con un rescate y ese código ya falla al reutilizarlo.
    Regresión verde: **2FA del superadmin intacto** (gate 18/0, test 44/0), login sin 2FA sin cambios,
    forgot 25/0, sesiones 10/0, C6 32/0 + 28/0, registro 26/0, CSP 19/0.

- ✅ **C5-ter — Dos cabos del Eje C (17 jul 2026).** Coherencia con lo hecho en C5-bis y C6; sin producto
  nuevo. Los dos salían del "Dónde lo dejé" del 16-jul.
  - ✅ **T1 · El cerrojo "he guardado mis códigos", ahora también en el superadmin.** Era un **enlace
    normal** que se pasaba de largo sin leer, mientras el cliente sí tenía cerrojo desde C5-bis: la cuenta
    MÁS poderosa de la plataforma era la única sin él. Es el estándar del sector (GitHub, Google, AWS,
    Stripe no te dejan salir de la pantalla de códigos sin una acción afirmativa). **Mecanismo reutilizado,
    no inventado:** la misma casilla + `pointer-events` de `perfil.js`. Detalle que condicionaba:
    `/superadmin` va con **CSP estricta**, así que el JS vive dentro de los `<script nonce>` que ya
    existían (`cerrojoCodigosJs` devuelve el CUERPO, no la etiqueta, para que el nonce lo ponga quien
    inserta y no se le pueda olvidar). Un `onclick` de atributo ahí habría muerto en silencio.
  - ✅ **T2 · El email fuera de la tabla de eventos de seguridad.** Era **la contradicción del Eje C**: en
    C6 cerramos que nadie pudiera sonsacar por HTTP "¿existe este email?" y la tabla lo guardaba **en
    claro**, con la lista de los probados y cuáles existían. **Un solo punto de escritura** de los 11 que
    hay (`routes/auth.js`, dentro de `fallar()`); los otros 10 ya eran seguros. Minimización de datos:
    cuenta conocida → `usuario #<id>` (la referencia estable que ya usa el resto del sistema); email
    desconocido → **no se guarda** (solo "cuenta desconocida", que es la señal útil —alguien barriendo—
    sin el dato personal). **Sin hash:** nada correlaciona por `detail` (solo se PINTA en el panel;
    `securityCounts` agrupa por `type`), así que habría sido mecanismo nuevo sin nadie que lo use.
    Sin migración: la tabla no cambia de forma. La vigilancia no pierde nada — sigue la IP, el negocio, y
    si el intento iba contra una cuenta real o inventada.
  - ✅ **Y el comentario que mentía.** `auth.js` enunciaba desde C3/M7 que "NO se registra el email": era
    cierto de la línea de debajo (el `console.log`) y **falso como regla** —15 líneas más arriba sí iba a
    la tabla—. Un comentario que enuncia una regla que el propio fichero incumple es peor que no tenerlo:
    deja tranquilo a quien lo lee. Ahora es cierto, y lo dice.
  - **Filas viejas:** solo 2 (6-jul y 16-jul), residuo de pruebas, en una tabla **rodante** (se autopoda a
    ~1000 filas) → se van solas. No se tocan, por instrucción del dueño: hoy no hay clientes reales, así
    que no hay histórico que rascar. Lo que importa es que las nuevas nazcan sin email, y nacen.
  - Verificado: `test-c5ter-sin-email` **16/0** + `gate-c5ter-cerrojo-superadmin` **15/0** en navegador real
    con cuenta desechable (no se puede terminar sin marcar, se pulsa de verdad y no lleva a ninguna parte;
    marcar desbloquea; y un código de rescate vale una sola vez). Comprobado además **contra el servidor
    vivo**: un login fallido con la cuenta real deja `usuario #2`, no el email. Regresión verde (C5-bis
    52/0 + 19/0, superadmin 44/0 + 18/0, C6 32/0 + 28/0, forgot 25/0, sesiones 10/0, registro 26/0,
    CSP 19/0).
  - *Papercut de gates arreglado de paso:* los gates comparten la IP de loopback y el freno del login de
    superadmin son 8/15 min, así que **encadenar la suite ponía rojo al siguiente gate** por un fallo que
    no era suyo (me pasó y lo perseguí: el freno de C6 haciendo su trabajo). El gate nuevo declara IP
    propia, como ya hacía el de C5-bis. Verificado encadenando los dos gates de superadmin dos veces: 4/4
    en verde.

- ✅ **C6 — Los 12 hallazgos BAJA (16 jul 2026).** **8 arreglados · 3 asumidos por escrito · 1 aplazado con
  aviso.** Cierra el Eje C. El detalle, las decisiones y el porqué de cada "no", en
  `docs/seguridad/auditoria-ejeC.md` § "C6 — Los 12 hallazgos BAJA: cierre".
  - **Trabajado contra el código de HOY, no contra el informe:** 5 de los 12 `file:line` estaban rancios
    (C3/C4a/C4b/C5 movieron el código desde el 15-jul). Se localizó cada uno antes de tocar nada.
  - ✅ **[B3] El reset de contraseña ya EXPULSA** — era el peor de los doce y el único donde el sistema
    prometía algo que no cumplía: resetear no echaba a nadie, así que el intruso seguía dentro ≤24 h con la
    contraseña ya cambiada. Ahora cierra todas las sesiones y quema los enlaces pendientes. Mínimo a 10
    (servidor y pantalla), igual que el cambio propio: un mínimo es el más flojo de sus caminos.
  - ✅ **[B2] Allowlist de permisos en servidor** — la lista de ocultos vivía DENTRO del handler de la
    pantalla y solo servía para no pintarlos; la API los aceptaba. La seguridad era que el checkbox no
    estuviera dibujado. Ahora es fuente única (`HIDDEN_PERMS`) y la aplica la API. Falla entero (400 al lote)
    y queda en Actividad.
  - ✅ **[B4] Freno por CUENTA en el login, como ralentización** — decisión del dueño y bien traída: un freno
    por cuenta que RECHACE es un arma (cualquiera falla 5 veces contra tu email y te deja fuera). Ralentiza
    hasta 10 s y **nunca bloquea**; cuenta fallos, no intentos; un acierto los borra. Reutiliza el `keyFn` de
    C5. Un email inexistente se frena igual → el reloj no chiva.
  - ✅ **[B6] `/find-tenant` ya no chiva** — no se podía arreglar solo el texto: el flujo NECESITA contestar
    para redirigir, así que si contesta, delata. Cambiado a **enlace por correo** (patrón Slack "Find your
    workspaces", y el mismo de C5: la respuesta, fuera de banda). Token de un solo uso, 30 min, tabla
    aditiva `tenant_access_links`. La respuesta HTTP es `{"mode":"sent"}` exista o no el email. `/acceso` se
    simplifica: ya no ramifica (cada rama era, ella sola, la respuesta a "¿existe y dónde?").
  - ✅ **[B1] + [B7] Ningún secreto se imprime** — el alta ya no vuelca la contraseña semilla en cada negocio
    nuevo, y los 3 scripts de ops la piden por teclado sin eco (`scripts/lib/prompt-secret.mjs`). Sin TTY
    **abortan** en vez de degradarse: un script de credenciales que se apaña solo cuando lo capturan es el
    fallo que se evita.
  - ✅ **[B8] DISA no loguea los valores del WHERE** — `redactarSql()` conserva la forma (tablas, joins,
    cláusula) y pierde los valores. Eran los datos del dueño: "la factura de Juan Pérez" acababa en el journal.
  - ✅ **[B9] Las BD nacen privadas** — arreglados los 6 ficheros abiertos (los `-wal`/`-shm` también llevan
    datos, y el informe solo citaba los `.db`) **y la causa**: `chmod` explícito al crear y al abrir
    (`core/db-file-perms.js`), no umask — un umask solo protege a quien lo tenga puesto.
  - 🔒 **[B5] · [B11 tienda] · [B12] — riesgo ASUMIDO, con dueño y fecha.** B5 falla cerrado y tocar la
    selección de BD arriesga el aislamiento a cambio de nada; la cookie de la tienda no se endurece mientras
    esté apagada (misma decisión que C4b-3: si se reactiva, entra con ella); B12 es código muerto que no
    concede permisos, y retirarlo o cablearlo es decisión de diseño, no higiene. *(La otra mitad de B11, la
    cookie `btenant`, SÍ se cerró: sale con `Secure`.)*
  - ⏸️ **[B10] systemd — aplazado y con aviso.** Es el único que puede **tirar el servicio**: `ProtectHome`
    con las BD en `/home/ubuntu` es exactamente cómo se rompe. Si entra: solo, nunca mezclado, con
    verificación en vivo.
  - Verificado: `test-c6-acceso` **32/0** · `test-c6-secretos` **28/0** · `gate-c6-find-tenant` **22/0** (en
    el servidor real). Regresión verde: forgot 25/0, sesiones 10/0, 2FA 44/0, registro 26/0, CSP 19/0, gate
    2FA 18/0.
  - *Hallazgo nuevo, anotado sin arreglar (no estaba en el encargo):* el email SÍ entra en `security_events`
    (`routes/auth.js`, los dos caminos de fallo del login). C3/M7 lo sacó del `console.log` y dejó la tabla,
    aunque el comentario de al lado diga lo contrario. Defendible como telemetría del operador, incoherente
    con la regla que el propio código enuncia. **Decidir a conciencia.**

---

## Función por encargo del dueño (fuera de los ejes A/B/C)

### Auditoría de código del 9 jul — los 11 hallazgos, cerrados  ✅ HECHO (2026-07-09)
`/code-review` a nivel `xhigh` sobre `cc5bec3`, `021f5df` y `d515242`: 19 candidatos, **11 confirmados**
por un verificador independiente (1 refutado). Se cierran todos, en orden de gravedad.

**CRÍTICO 1 — fuga de permisos.** `GET /api/erp/avisos` no exigía permiso, y la campana lo llama en
TODA página admin: un empleado sin `cobros.read` leía *"María García López · F2026-0017 · Te deben
€15,61, vencida hace 12 días"*, más los nombres de proveedores y lo que se les debe. Sus hermanas sí lo
exigían (`cobros.js:17`, `pagos.js:16`, `inventory.js:15`). Ahora cada fuente declara el permiso de su
pantalla de origen (`PERM_POR_FUENTE`) y el motor **ni siquiera ejecuta** las que no puedes ver — cierra
la fuga y ahorra el escaneo caro. **Falla cerrado**: fuente sin permiso declarado, fuente que no se
sirve. *Consecuencia:* el conteo pasa a ser **por usuario**; el invariante deja de ser "todas las
superficies cuentan lo mismo" y pasa a "lo mismo QUE TÚ PUEDES VER". El correo diario va al negocio (sin
usuario) y sigue contándolas todas.

**CRÍTICO 2 — freno propio.** El tope general subió a 600/min por IP en el mismo commit que añadió este
endpoint caro (`openDebts`, O(clientes × facturas), y el POST lo corría dos veces). 600 escaneos/min
tumbaban el panel del negocio. Freno propio de **120/min con clave negocio+IP** (va detrás de
`tenantMiddleware`): una oficina no se come el cupo de otra. Verificado: `200×120 · 429×10`, el negocio
B intacto, y un token de A contra el Host de B → `401`.

**Corrección.** `marcarVistoYResumir` pisaba la huella entera y borraba los "no visto" puestos a mano;
**fusionar no lo arreglaba** (volver a añadir la clave que quitaste la marca igual), así que pasa a
`resumirAvisos`: **un resumen de conteos no descarta nada**. `hoyLocal()` con `Europe/Madrid` — en UTC,
entre las 00:00 y las 02:00 de España una factura recién vencida desaparecía. `bellSync` invalida su
caché y repinta si el panel está abierto (antes la campana seguía ofreciendo la factura ya cobrada); y
DISA deja de apagar el punto a mano, que era mentir sobre el servidor.

**Eficiencia y limpieza.** El motor se ejecutaba **dos veces** por carga de `/admin` (badge + campana) y
**dos veces** por marcado: ahora una sola pasada, compartida por el contexto. Los **tres formateadores**
de detalle (motor, email, pantalla) son uno solo, `detalleAviso()`; para las fuentes de dinero, el
`detalle` del motor se calculaba solo para que la pantalla lo pisara.

**Documentado, no revertido:** la clave `fr:` de los recurrentes cambió (antes era un JSON con comillas,
inseguro dentro de un `data-key`), así que los borradores ya descartados **reaparecen una vez** tras el
despliegue. Está escrito en `avisoKey()`.

**Verificación:** `node --check` en 10 ficheros · 6 módulos importan · motor **47 OK** · cobros paso 2
**47 OK** · cobros 2.1 **46 OK** · gate de estado **25 OK** · gate de acciones **23 OK** · permisos en
**dos negocios 16 OK** (`scripts/verify-avisos-permisos.mjs`, nuevo) · navegador real: el usuario
limitado ve *"No tienes nada pendiente"* y **ni una cifra**; el dueño ve sus 8 items. El usuario de
prueba queda **archivado** (`active=0`), nunca borrado.

**Fuera de alcance (no tocado):** `verifactu-cola.js`, sus scripts y sus unidades systemd — necesita su
propia revisión antes de activarse, precisamente porque mete registros fiscales en esta zona.

### Verifactu · Cola de envío automático por negocio  ✅ HECHO (2026-07-09) — `7b394c6`
Encargo expreso del dueño, a raíz del **hallazgo de los 240 s** de la Tarea 2 Fase A: el envío dejó de
ser manual. Al emitir una factura, su registro sale hacia la AEAT **en segundos**. Aditivo y reversible.
No toca huella/QR/encadenado (Tarea 1) ni subsana el 2004. ~~no envía anulaciones~~ → **las anulaciones YA se
remiten** (23-ago-2026, `1fb0221`), siempre **detrás de su alta**. Detalle completo en
`docs/verifactu/tarea2-cola-envio-automatico.md`.

> **⚠️ ESTO ES UNA PRUEBA DE CONCEPTO, NO EL PRODUCTO FINAL.** Lo construido y lo remitido el 9-jul va con
> el **certificado personal del dueño** (FNMT de persona física). Demostró que la tubería funciona de punta
> a punta contra la AEAT — y eso es exactamente todo lo que demostró. **La versión de producto es la de
> colaborador social:** un único certificado de Bamburu para todos los negocios + autorización de
> representación firmada por cada dueño (decisión del 2026-07-10, ver `docs/contexto/decisiones.md`).
> **No leer "cola hecha" como "Verifactu para clientes hecho".** La tarea de producto, entera y sin trocear,
> está en el Backlog · Contabilidad y cumplimiento fiscal.

- **⚠️ Hay DOS relojes, y empujan en contra.** Además de la ventana de 240 s de la huella, el **control
  de flujo** (art. 16.2 Orden HAC/1177/2024) obliga a esperar el `TiempoEsperaEnvio` devuelto (t inicial
  = 60 s) entre envíos, y **un envío = un obligado** (una Cabecera). Un sobre por factura da un techo de
  **1 registro/60 s**: en una ráfaga de mostrador la 6ª factura llegaría fuera de ventana. Por eso la
  cola **AGRUPA** todo lo pendiente del negocio en UN sobre (1..1000 `RegistroFactura`). En calma la
  factura sale en ~1 s; en ráfaga salen juntas dentro del minuto. **El envío "inmediato por factura" del
  encargo no era implementable tal cual**; el objetivo sí se cumple.

- **`enviarLote` es ahora el único orquestador.** `buildEnvelope` ya admitía N registros; faltaba quien
  los agrupara. `enviarRegistro` (botón manual + script de preproducción) **delega** en un lote de 1:
  imposible que el camino manual y el automático diverjan. El gate de T2 (17/17) valida el lote a N=1.

- **Reintentos.** Solo el fallo de COMUNICACIÓN se reintenta (backoff 5→15→45→135→300→300 s; agotados
  los 6 intentos → terminal + aviso). Un **rechazo** de la AEAT no se reintenta (el mismo XML da el mismo
  rechazo) y un **bloqueo por datos** ni sale: los dos van directos a aviso. Lo aceptado no se reenvía
  jamás (idempotencia del motor). Pasados los 240 s se sigue enviando: remitido tarde > no remitido.

- **Multi-tenant.** Cada negocio remite con SU certificado: `VERIFACTU_CERT_DIR/<slug>.p12` + contraseña
  en `VERIFACTU_CERT_PASS_<SLUG>`, con caída al `VERIFACTU_CERT_PATH` global. **La contraseña sigue sin
  escribirse en ningún fichero del repo** (decisión de la Fase A, intacta): si no está en el entorno del
  servicio, la cola de ese negocio **no se activa** y la pantalla dice el motivo exacto. Hoy, por tanto,
  **la cola está inactiva en los 6 negocios** y el comportamiento es el de siempre (botón manual).

- **Concurrencia.** Cola en proceso + barrido de systemd (`bamburu-verifactu-cola.timer`, cada 2 min) como
  red de seguridad para reinicios y caídas largas. Cerrojo entre procesos: reclamar una fila empuja su
  `next_retry_at` al futuro (lease 120 s) en una transacción `IMMEDIATE`. El reloj del control de flujo se
  deriva de la BD, no de memoria, para que sobreviva a un reinicio. `next_retry_at` va **siempre** en ISO-Z:
  `CURRENT_TIMESTAMP` ('AAAA-MM-DD HH:MM:SS') y `toISOString()` no se comparan bien como cadenas (`0x20` < `'T'`).

- **El histórico NO se drena.** La cola solo toca filas con `next_retry_at` no nulo, y eso solo lo pone
  ella. Los 85 registros antiguos de `desarrollo-bamburu` y el `incorrecto` (1239) de `helados-ibrahin` se
  quedan quietos: remitirlos hoy solo devolvería `AceptadoConErrores`.

- **Avisos** (fuente `enviosVerifactu` en el motor existente, sin crear uno nuevo): solo lo que quedó en
  punto muerto — rechazado, bloqueado por datos, o comunicación agotada. Lo que se reintenta solo NO avisa.
  **Urgencia 2000** (por encima de las facturas vencidas, cuya urgencia crece con los días): un registro
  fiscal sin remitir es lo más grave del panel y no debe quedar sepultado. *Decisión del dueño, 2026-07-09.*
  Sin botón de acción directa, como las recurrentes: reenviar tiene valor legal → se revisa antes
  (`gate-avisos-pantalla` amplía su excepción "confirm-first" a Recurrente **y** Verifactu). *Decisión del dueño.*

- **Corregido de mi propia pieza:** al agrupar, cada fila de auditoría guardaba el sobre ENTERO → coste
  cuadrático (50 tickets en hora punta ≈ 3 MB por vaciado, sin techo). Ahora, en lotes de varios, cada
  fila guarda **lo suyo**: su `<RegistroAlta>` y su `<RespuestaLinea>` (emparejada por serie exacta, no
  por subcadena: `F2026-1000` es subcadena de `F2026-10000`). CSV y `EstadoEnvio` ya vivían en columnas.

- **Verificación.** Gate nuevo `verify-verifactu-cola.mjs` **62/0** (encolado, ventana de 240 s, agrupación,
  control de flujo, idempotencia, cerrojo, red caída + reintento, backoff hasta terminal, rechazo que no se
  reintenta, lote mixto, avisos, histórico intacto, aislamiento entre negocios, emisión nunca bloqueada).
  **Regresión 24/24 gates, 0 fallos** (T1 18/0, T2 17/0, T1-http 7/0, mostrador, pedidos, contabilidad ×5, CRM…).
  **3 facturas reales** sobre COPIA de la BD de `ibrahin-repuestos`: un solo sobre, 3/3 `Correcto`, hueco
  huella→envío **1,2 s**, la cadena continúa desde la huella real de `S2026-0002`, los 2 aceptados no se reenvían.

- **Fuera de alcance, para encargos propios:**
  - **Envío real a preproducción CON la cola**: falta el `.p12` del dueño y su contraseña en el entorno del
    servicio. Hasta entonces la cola está inactiva (comportamiento idéntico al actual).
  - ~~Envío de **anulaciones**~~ **HECHO** (23-ago-2026, `1fb0221`) · **subsanación** del 2004 · ~~**Fase B legal**~~ (resuelta el 2026-07-10).
  - Bug latente de `verifactu-envio.js` (`prevRegistro` por `id` sin filtrar por emisor) — sigue vivo, es encadenado.
  - **`company_config.fiscal_id` vacío** en `duniya`, `rachibra` e `inversiones-disan`: la Cabecera saldría con
    `ObligadoEmision` vacío. Hoy teórico (sin certificado, su cola no arranca). El gate de T2 no lo detectaba
    porque `runMigrations` siembra `fiscal_id=''` y su `INSERT OR IGNORE` no lo pisa.
  - **`verify-pieza-c-http` es un gate FRÁGIL preexistente** (no roto por esta pieza): compara
    `round(round(S)+t)` con `round(S+t)` sobre "Ventas del mes", así que alterna según los céntimos
    acumulados. Demostrado: falla igual con el código anterior a esta tarea. *Estado: arreglar el gate.*

### Verifactu · Tarea 2 (Fase A) — ENVÍO REAL a la AEAT conseguido  ✅ HECHO (2026-07-09)
Encargo expreso del dueño. El motor (`verifactu-envio.js`) y el script ya estaban probados contra el
simulador (17/17); faltaba conectar el certificado FNMT real y remitir a **preproducción**
(`prewww1.aeat.es`). Nunca contra producción. Detalle completo en `docs/verifactu/tarea2-fase-a-envio.md`.

- **Dos registros aceptados por la AEAT**, negocio `ibrahin-repuestos`, obligado `13334347M` (FNMT de
  persona física del dueño), tickets F2 de 0,48 €:

  | # | Registro | Cadena | Respuesta | CSV |
  |---|---|---|---|---|
  | 1 | `S2026-0001` | `PrimerRegistro=S` | `AceptadoConErrores` · error 2004 | `A-FA5DXLJ5HSC2ZU` |
  | 2 | `S2026-0002` | `PrimerRegistro=N` + `RegistroAnterior`→#1 | **`Correcto`**, sin errores | `A-5LE89B7EUFZ7ER` |

  La AEAT devuelve el obligado en su Cabecera: el certificado **autentica y está autorizado**. El
  segundo envío valida el **encadenamiento real** contra un registro que la Agencia ya tenía guardado.

- **Arreglo del namespace de la Cabecera** (`buildEnvelope`). `SuministroLR.xsd` declara `Cabecera`
  como elemento LOCAL con `elementFormDefault="qualified"` → vive en el namespace **`sfLR`**, aunque su
  TIPO (`sf:CabeceraType`) venga del otro esquema; de hecho `Cabecera` **no existe** en
  `SuministroInformacion.xsd`. Enviarla como `<sf:Cabecera>` provocaba
  `Codigo[4102].El XML no cumple el esquema. Falta informar campo obligatorio.: Cabecera`.
  **Validado con `xmllint` contra los XSD oficiales descargados**: reproduce el 4102 con el namespace
  malo y pasa con el bueno. (Cierra el "sin confirmar" de `tarea2-remision-aeat-investigacion.md`.)

- **Seguridad del certificado.** `.gitignore` cubre ahora `*.p12 *.pfx *.pem *.key *.jks *.crt`: antes
  un `git add -A` habría commiteado la identidad digital del dueño. La **contraseña no se escribe en
  ningún fichero**: el script la pide por teclado **sin eco** (ni historial, ni `ps`, ni
  `/etc/bamburu.env`). Y si falta `VERIFACTU_PRODUCTOR_*` el script **para en seco** en vez de avisar:
  el motor marcaba cada registro `bloqueado_datos` y no salía ni una petición — el aviso engañaba.

- **El `.p12` del Llavero de macOS no lo abre Node**: cifra los certificados con RC2-40, que OpenSSL 3
  dejó en el proveedor *legacy* → `Unsupported PKCS12 PFX data`, antes de tocar la red. Se reconvierte a
  PKCS#12 moderno (AES-256 + MAC SHA-256). Se descarta `node --openssl-legacy-provider`: habría que
  ponerlo también en `bamburu.service` y reactivaría RC2/RC4/DES en todo el proceso de producción.

- **⚠️ Hallazgo estructural — la ventana de 240 s.** `FechaHoraHusoGenRegistro` va DENTRO de la huella,
  así que queda congelada al emitir; la AEAT exige que esté a ±240 s de SU reloj cuando recibe (error
  2004). Medido: 376 s de hueco → `AceptadoConErrores`; 0 s → `Correcto`. Reloj del servidor verificado
  contra la AEAT (**+1 s**, NTP sincronizado): no era un desvío. **Consecuencia: la cola + timer por
  negocio deja de ser una mejora y pasa a ser un requisito** para remitir en verde.

- **Fuera de alcance, para encargos propios:**
  - **Fase B legal** — colaboración social (Convenio tipo 17), declaración responsable (art. 13 RD
    1007/2023), elección de certificado (propio-por-todos vs. Anexo II por cliente).
    **→ DECIDIDO el 2026-07-10: colaborador social, un único certificado de Bamburu**; descartado que cada
    negocio aporte el suyo. (El Anexo II **no** era la alternativa: es el modelo de la autorización de
    representación, que se usa dentro de este modelo.) Queda solo el trámite. Ver
    `docs/contexto/decisiones.md` y la tarea única del Backlog.
  - **Cola + timer de envío automático por negocio** — confirmado NECESARIO por el hallazgo de los 240 s.
  - **Bug de selección de cadena por id** (`verifactu-envio.js:347`): elige el registro anterior por id
    sin filtrar por emisor. **Latente**: `company_config` es singleton (un obligado por BD) y se verificó
    sobre los 61 registros reales (0 desajustes, 0 cruces). Solo mordería si un negocio cambiase de NIF
    teniendo ya registros.
  - **Subsanación del 2004** con un alta `Subsanacion=S` sobre `S2026-0001`.
  - ~~Envío de **anulaciones** (hoy Fase A solo remite altas)~~ **HECHO** (23-ago-2026, `1fb0221`): se encolan
    detrás de su alta y nunca salen antes que ella. Ver la ficha «Verifactu · REMISIÓN DE ANULACIONES».

- **Evidencia que se conserva:** `helados-ibrahin` guarda su registro 1 en `incorrecto` con el error
  1239 (NIF de destinatario ficticio, no identificado en el censo real de preproducción). No se toca.

### Verifactu · REMISIÓN DE ANULACIONES a la AEAT  ✅ HECHO (2026-08-23) — `1fb0221`
Encargo expreso del dueño. La anulación ya se **registraba y encadenaba** en local desde la Tarea 1
(y por NIF: `lastHuella(db, idEmisor)` filtra por `id_emisor`, con `assertUnSoloEmisor` de cinturón).
Lo que faltaba era su **remisión**: el motor la bloqueaba a propósito («Fase A solo remite altas») y
la cola no la miraba. **Queda dormida, igual que la cola: se construye entera, no se enciende.**

- **`buildRegistroAnulacion`** (`modules/erp/verifactu-envio.js`) — pieza nueva, no sale de la del alta:
  `RegistroFacturacionAnulacionType` es **otra secuencia** (sin `Desglose`, sin `CuotaTotal`/`ImporteTotal`,
  sin `TipoFactura`, sin `Destinatarios`, sin `NombreRazonEmisor`) y su `IDFactura` usa **nombres propios**
  (`IDEmisorFacturaAnulada` / `NumSerieFacturaAnulada` / `FechaExpedicionFacturaAnulada`).
  Los **cuatro datos identificativos** se exigen **sin excepción** —NIF del emisor, serie+número anulados,
  su fecha de emisión, y la fecha en que se anula (`FechaHoraHusoGenRegistro`)—: si falta uno, el envío
  se para en `bloqueado_datos` con su aviso. Nunca se inventa un dato.
- **PRECEDENCIA — una anulación NUNCA sale antes que su alta** (`verifactu-cola.js`). Se comprueba **dentro
  del SQL del reclamo**, no con un paso de liberación posterior: un paso así hay que acordarse de llamarlo
  desde todos los sitios donde un alta pasa a aceptada, y el día que aparezca uno nuevo la anulación se
  queda dormida para siempre. Así la fila está en la cola desde el primer día y simplemente **nadie se la
  lleva** hasta que su alta consta aceptada; en cuanto lo está, la ven solos el `programar` de cada aterrizaje
  y el barrido de systemd.
- **Los cuatro casos** (`encolarAnulacionSiProcede`, `CASO_ANULACION`): alta **aceptada** → se encola normal ·
  alta **sin enviar** → se encola **detrás** · alta **rechazada** → se **anota** (`bloqueado_datos`, `next_retry_at`
  nulo) y **no se encola** · **ya anulada** → ya lo cortaba `anularInvoice` exigiendo `status='emitida'`; no se
  construyó nada, se **demuestra**. Quinto caso encontrado al medir: factura **sin registro de alta** (anterior a
  la implantación de la Tarea 1) → se anota igual que la rechazada.
- **La pantalla** `/admin/verifactu/envios` lista ya **altas y anulaciones**, con columna «Operación».

**EL CASO NORMAL NO ERA EL QUE PARECÍA.** Censo del 23-ago-2026 sobre las **28 BD** de tenants:
**299 facturas anuladas, 0 con su alta remitida y aceptada.** En todo el sistema hay **5** filas en
`verifactu_envios` (2 `bloqueado_datos`, 1 `incorrecto`, 1 `correcto`, 1 `aceptado_con_errores`) y ninguna
de esas facturas está anulada. Así que «alta nunca enviada» **no es la esquina rara: es la carretera**, y ahí
es donde está puesto el cuidado. *(De las 299: 218 con registro de anulación; **62** con alta pero sin
anulación y sin fila en `invoice_anulaciones` — son del `UPDATE` masivo de `scripts/seed-taller.mjs:107`, no
pasaron por el producto; 19 sin registro ninguno, anteriores a la Tarea 1 — **⚠️ esas 19 YA NO EXISTEN: las borró el encargo CUPONES el 23-ago-2026 (`9e77f2b`); este censo queda como estaba EL DÍA QUE SE MIDIÓ**. **Un gate no puede coger «una
anulada cualquiera» de ese tenant**: 81 de las 299 no sirven para medir.)*

**DOS COSAS QUE NO ESTABAN EN EL ENCARGO Y SALIERON AL LEER EL ESQUEMA OFICIAL:**

1. **El emparejamiento de respuestas cruzaba altas con anulaciones.** `enviarLote` casaba cada
   `RespuestaLinea` con su registro por `NumSerieFactura` **a secas**, y una anulación lleva **el mismo número
   de serie que su alta**: con las dos en un sobre, el `Map` colisionaba y cada fila se quedaba con el estado
   de la otra. El desempate es `Operacion/TipoOperacion` (`Alta`|`Anulacion`), que `RespuestaSuministro.xsd`
   trae justo para esto. Si la respuesta no lo informa, solo se empareja cuando **no hay ambigüedad**.
2. **EL AVISO DEL FORMATO DE FECHA ERA FALSO, Y DEL REVÉS — y aplicarlo habría roto todas las anulaciones.**
   Ver el bloque de abajo.

#### El aviso del formato de fecha: por qué era falso (para que no se repita)
Llegó como aviso de fabricantes: *«en el alta Hacienda admite dos formatos de fecha, pero en la anulación
solo el internacional (año-mes-día), y si no se cumple la rechaza»*. **El dueño pidió expresamente que no se
diera por cierto y se midiera contra el esquema oficial.** Se descargó en vivo (`SuministroInformacion.xsd`,
HTTP 200, 49.540 bytes) y dice, literal:

```xml
<simpleType name="fecha">
  <restriction base="string">
    <length value="10"/>
    <pattern value="\d{2,2}-\d{2,2}-\d{4,4}"/>
  </restriction>
</simpleType>
```

Ese tipo `sf:fecha` lo usan **por igual** `FechaExpedicionFactura` (alta, línea 71) y
`FechaExpedicionFacturaAnulada` (anulación, línea 93). **Las dos mitades del aviso son falsas:** el alta
**no** admite dos formatos (admite uno, `DD-MM-YYYY`) y la anulación **no** exige el ISO (exige el mismo
`DD-MM-YYYY`). Y lo que importa: **haber normalizado a ISO habría provocado el rechazo que el aviso decía
evitar** — `2026-08-23` pasa el `<length 10>` pero **falla el `<pattern>`**, y la AEAT devuelve el **4102**
(«El XML no cumple el esquema») en **cada** anulación.

De dónde viene probablemente el runrún: **`FechaHoraHusoGenRegistro` sí es formato internacional**
(`type="dateTime"`, ISO-8601 con huso) — pero lo es **en el alta y en la anulación por igual**, y ya lo
producía bien `genTimestampMadrid()` desde la Tarea 1.

Por eso lo que entra es una **GUARDA, no una conversión**: se comprueba `\d{2}-\d{2}-\d{4}` antes de enviar
y, si algún día no cuadra, **se para el envío** (`bloqueado_datos` + aviso que nombra el formato y el 4102) en
vez de mandar un XML que ya sabemos rechazado. Comprobado también contra los datos: **1.067 registros** en
todos los tenants, **0** fuera del patrón.

**La lección, que es la que vale para la próxima:** un aviso de formato de un tercero **se mide contra el
esquema, no se aplica**. Este venía con la forma exacta de un consejo útil —concreto, plausible, con síntoma
y remedio— y el remedio era el fallo. **Si se hubiera hecho caso, habría roto en producción justo la pieza
que decía proteger, y el gate lo habría cazado** (reversión R5, abajo).

**Decisión del dueño (23-ago-2026): `SinRegistroPrevio` NO se usa.** El XSD ofrece ese campo (`S`/`N`) para
anular una factura cuyo alta no se va a remitir nunca. En Bamburu el alta **siempre acaba remitiéndose**, así
que la anulación espera detrás de la suya y las dos se comunican en orden. **No se introduce ni se deja
preparado**; el gate comprueba que el XML **no** lo lleva.

**Comprobación propia: `scripts/verify-verifactu-anulaciones.mjs` — 66 aserciones, 66 en verde**, contra un
simulador SOAP local (sin red a la AEAT, sin certificado, BD temporal). Cubre: la cola dormida fuera del
simulador · el caso normal con su puerta de precedencia (y que se abre sola al aceptarse el alta) · los cuatro
datos identificativos · la huella **recalculada** y su encadenado por NIF · **la cadena de altas idéntica antes
y después** · los cuatro casos · el orden exacto de la secuencia del XSD y los campos que **no** debe llevar ·
la guarda de fecha por las dos caras · y el choque de alta+anulación en un mismo sobre.

**Verificada por REVERSIÓN** (que es lo que separa medir el mecanismo de medir el resultado). Cinco reversiones,
las cinco en rojo: **R1** quitar la precedencia → 2 rojos · **R2** volver a emparejar por serie sola → 1 rojo ·
**R3** quitar la guarda de fecha → 2 rojos · **R4** quitar el encolado tras el commit → 2 rojos ·
**R5 aplicar el aviso falso (normalizar a ISO) → 2 rojos**. Restaurado: 66/66.

**Fuera del barrido, como toda la familia Verifactu.** Este gate **no** se ha metido en `GRUPOS`
(`scripts/lib/gates-mapa.mjs`): los otros cinco de Verifactu tampoco están, y `docs/comprobaciones-fuera-del-barrido.md`
dice expresamente que meter las 97 invisibles **es material para que decida Ibrahin, no una tarea**. Se corre a
mano: `node scripts/verify-verifactu-anulaciones.mjs`. **Queda propuesto meterlo — decisión pendiente del dueño.**

**Lo que NO se ha tocado:** la cadena de altas (comprobado campo a campo, idéntica), las huellas ya calculadas,
el QR, las rectificativas, los permisos y ninguna factura existente. **Cero borrados.** `avisos.js` sigue
filtrando por `record_type='alta'` **a propósito**: abrirlo generaría avisos visibles, y eso es encender algo.

### FICHA D-ter — Los informes dejan de ser una chapuza  ✅ HECHO (2026-08-23) — `0107a63`
Sale de que el dueño abrió sus informes con **sus datos** y se encontró una chapuza. Siete partes, una
entrega. **La causa de fondo era mía y es la lección de la ficha:** de sus 239 clientes, **200 eran
restos de mis propios gates** — el 84 % del eje.

**PARTE 6 · LAS PRUEBAS DEJAN DE ENSUCIAR EL NEGOCIO.** Borrados **64 clientes, 11 productos, 3
almacenes y 1 recurso**. Archivados **130 clientes y 2 productos**.
> **NO SE PUDO BORRAR TODO, y esto es lo que hay que recordar:** 130 de esos clientes tenían factura y
> **154 de esas facturas ya están en la cadena de VERI\*FACTU**. Borrarlos habría exigido romper la
> cadena que se recompuso esa misma tarde. Se **archivan** (`active=0`), y sus nombres siguen
> apareciendo en el área de Ventas porque la factura guarda el nombre del cliente por dentro. **La
> basura que una prueba deja hoy se vuelve imborrable en cuanto se enreda con un documento legal.**
> Y los **7 movimientos con fecha 2000-01-01 NO se tocan**: son el stock de **apertura** de productos
> reales (Vela Lavanda, Aceite Bergamota…) y borrarlos cambiaría el stock. El grupo «2000» desaparece
> de los informes **por el filtro de periodo**, no destruyendo el dato.
Quedan **24 clientes activos, todos de verdad, y 0 con marca de gate**. Script:
`scripts/limpiar-restos-de-gates.mjs` (simulacro por defecto, copia previa).

**PARTE 1 · FUERA LA CAJA DE FÓRMULAS.** Un dueño no escribe cuentas. Las que se piden a diario pasan a
ser **medidas con nombre, ya calculadas**: ticket medio y nº de facturas (Ventas) · % pendiente de pago
(Compras) · facturación media y deuda media por cliente (Clientes) · % de ausencias y duración media de
la cita (Agenda) · margen sobre ingresos (Contabilidad). Y para la suya, **«Mis medidas»**: se
construye **eligiendo** de dos listas y una operación, se le pone nombre, y aparece en «quiero saber»
con su cuenta escrita **en palabras** debajo. No se guarda texto libre sino las **tres piezas**, así que
no hay expresión que interpretar. **Ni un nombre interno en pantalla**, comprobado uno a uno.

**PARTE 2 · EL PERIODO, QUE NO EXISTÍA.** Sexto hueco en la frase, seis rangos, y **por defecto los
últimos 12 meses — nunca el histórico**. Es lo que convertía Contabilidad en cuarenta barras a cero:
**medido, pasa de 26 grupos a 12**. Los rangos se calculan **en el servidor**, para que el reloj del
navegador no pueda dar un informe distinto del papel. Y **el periodo se escribe en la cabecera del
papel** al imprimir.

**PARTE 3 · UN NÚMERO TAMBIÉN ES UN INFORME.** «Y verlo en» ofrece número · tabla · barras · línea ·
quesito, más **«lo que mejor se lea»**, que es el arranque y decide por el resultado: **un solo valor →
el número grande y solo** con su periodo debajo · **hasta 12 → barras** · **más de 12 → tabla**. El
usuario lo cambia siempre.

**PARTE 4 · NADA ILEGIBLE Y NADA SIN SENTIDO.** Más de 12 grupos en un dibujo: **los 12 mayores y el
resto sumado en «Otros»**, con su línea y un **enlace para verlo entero en tabla** — la tabla las lleva
todas. «Contar clientes repartidos por cliente» **sale de la lista** (se buscaron las 33 dimensiones ×
sus medidas **ejecutando cada par**: es la única con esa forma) y si alguien la fuerza por la API se
explica por qué no dice nada. Y **un grupo vacío no se pinta**, salvo que lo estén todos — «todo a
cero» sí es una respuesta.

**PARTE 5 · LA AYUDA QUE MENTÍA.** Los textos de debajo de cada hueco se quedaban **congelados en la
primera área**. Ahora se recalculan al cambiar de área, de medida o de reparto: comprobado **mirando**,
«un grupo por cada cliente» pasa a «un grupo por cada proveedor».

**PARTE 7 · QUINTA REGLA** en CLAUDE.md («Lo que solo ve un navegador»): **la pantalla se juzga
mirándola con datos reales.** Un gráfico con sesenta etiquetas encimadas no da error, y está mal. Más
una norma nueva aparte: **«Lo que una prueba crea, la prueba lo borra»**.

**NADA SE PIERDE, contado:** **33 dimensiones** (las mismas) y **31 medidas → 39**. Las **once
preguntas** siguen funcionando, ahora con periodo y con la forma que les toca.

**VERIFICADO — `scripts/gate-informes-legibles.mjs`, 52 ✓ · 0 ✗, EJECUTADO** contra la dirección
pública. **Mide el RESULTADO, no solo el mecanismo**, que es la quinta regla: cuántos grupos entran en
el eje (13 con «Otros», no 33), si el periodo recorta de verdad, si el número sale cuando toca, y si
queda **un solo nombre de gate** en pantalla. Tres capturas en `~/informes-shots/dter-*.png`.

**No mueve el recuento**: no es un subpunto A–M.

### FICHA D-bis — La pantalla de informes se hace entender  ✅ HECHO (2026-08-23) — `541b303`
Sale de un fallo que el dueño encontró usando la pantalla: **guardar un informe no funcionaba**. El
diagnóstico está en su encargo de solo lectura del mismo día; esta ficha es el arreglo, en cinco
partes y una entrega.

**LA AVERÍA, Y POR QUÉ MI GATE ANTERIOR NO LA VIO.** Guardar pedía el nombre con `prompt()` y
confirmaba con `confirm()`, **encadenados**. Chrome ofrece la casilla «Impedir que esta página cree
cuadros de diálogo adicionales» en el **segundo** diálogo seguido; en cuanto se marca, `prompt`
devuelve null y `confirm` false **sin enseñar nada**, y el botón queda muerto hasta recargar: ni
ventana, ni petición, ni aviso. **El gate de la ficha D dio 97 ✓ · 0 ✗ sobre esto** porque comprobaba
el guardado **llamando a la API con un cuerpo JSON escrito por mí**: medía el motor y se saltaba
entero el tramo donde estaba el fallo. De ahí sale la norma nueva de CLAUDE.md.

**PASO 0 — el censo:** **93 ventanitas** en el producto (29 `prompt` + 64 `confirm`, 42 ficheros),
**86 en pantallas vivas**. Se arreglan **las 12 de Analíticas**; ~~**las 81 restantes quedan
apuntadas**~~ → **hechas el 23 ago 2026 (noche, punto 7): quedan CERO en todo el producto.** Y se
**reutiliza** el modal que ya existía
(`.modal-overlay` + `openModal`, `layout.js:1245`): no se inventa uno.

**PARTE 1 — se acaban las ventanitas.** Guardar es un panel dentro de la página: nombre **ya
propuesto** («Agenda por fecha · 2026»), con el foco puesto y el texto seleccionado; casilla de
compartir con su explicación; Guardar y Cancelar. **Nombre vacío o solo espacios → lo dice ahí, en
rojo, y no se cierra.** Si el guardado falla, sale el motivo y el botón vuelve a estar vivo
(rehabilitarlo va en los dos caminos, no solo en el feliz — fallo de clase ya pagado en este repo).
**Caen las doce, no solo la de guardar:** el Plan financiero eran **cinco ventanitas seguidas**
pidiendo palabras clave a mano («facturacion o beneficio», «mes, trimestre o anio», el número de
usuario del responsable) y ahora es un formulario con listas. **Escape y clic fuera** se añaden al
componente **compartido**: ningún modal del producto los tenía.

**PARTE 2 — que se vea que ha guardado.** La página **sube** hasta «Mis informes guardados» y resalta
el recién guardado dos segundos: la prueba es el informe en la lista, no un mensajito. El aviso deja
de salir debajo de la burbuja de DISA — **medido**: los dos en `bottom/right: 24px` y el aviso con
**menos** z-index (9999 contra 99999), por eso se leía «Informe guar». Se arregla por los dos lados
(88 px de alto **y** z-index 100000), porque la burbuja **se puede arrastrar** y el hueco solo no
basta. Y el índice se maqueta bien: `.inf-v` llevaba `grid-row` pero **no** `grid-column`, así que la
colocación automática metía la flechita en la columna 1 y empujaba el nombre a la derecha.

**PARTE 3 — se lee como una frase.** *«De [Ventas] quiero saber [cuánto he facturado], repartido por
[cliente], [mes a mes], y verlo en [barras].»* Los cinco desplegables de siempre, **cada uno con su
línea de ayuda debajo**. Renombrados: «Mirar por» → **«Repartido por»** · «Medir» → **«Quiero saber»**
· «Beneficio (margen)» → **«Beneficio en euros»** · «Margen sobre lo que te costó» → **«Margen en %»**
(su base no se pierde: baja a la ayuda) · «Área» → **«De»**. La fórmula se va a **«Opciones
avanzadas»**, plegada, y **su ayuda enseña las palabras del usuario**: la traducción a los nombres del
motor la hace la pantalla, sustituyendo primero la etiqueta más larga para que una corta no rompa otra
por dentro.

**PARTE 4 — se empieza por una pregunta.** **ONCE** tarjetas con nombre de negocio, agrupadas y
**filtradas por el permiso de su área** (un negocio sin agenda no ve las tres de agenda). Abren el
constructor con la frase **ya completada** y el gráfico dibujado; sin datos, el gráfico vacío con una
línea que lo explica, no un error.

> **DE LAS DOCE DEL ENCARGO, TRES NO SE PODÍAN MONTAR. Se probaron una a una contra el motor antes de
> construir nada, y se paró a preguntar.** Dos se arreglaron **de raíz**, no maquillándolas:
> - **«¿Quién me debe dinero?»** — el área de Clientes tenía la medida «deuda» y **ninguna forma de
>   repartirla por cliente**: solo por provincia, tipo, forma de pago, perfil y responsable. Se añade
>   la **dimensión «Cliente»** (las filas ya traían el nombre).
> - **«¿Cuántas horas trabajo frente a las que tengo abiertas?»** — lleva un «frente a» dentro: son dos
>   series. **El motor ya devolvía varias medidas; `dibujar()` se quedaba con la primera.** Ahora pinta
>   todas, lo que además sirve para cualquier comparación futura dentro de un área.
> - **⬜ «¿Qué productos se mueven y cuáles están PARADOS?» QUEDA FUERA, y es lo honesto.** El área de
>   Inventario mide **movimientos**, así que un producto parado **no produce ninguna fila y no puede
>   aparecer**. Medido: **121 productos físicos · 76 con algún movimiento · 45 invisibles**. Enseñar
>   solo los que se mueven y titularlo «y cuáles están parados» sería mentir en la tarjeta. **Para que
>   entre hace falta que Inventario pueda partir de los productos y no de los movimientos** — el mismo
>   cambio de grano que la agenda. **PENDIENTE DE IBRAHIN.**

**NADA SE PIERDE, contado antes y después:** **32 dimensiones → 33** (la nueva) y **31 medidas → 31**.
Los 8 informes de fábrica y los 10 subinformes de «Informes por área», intactos.

**PARTE 5 — norma nueva en CLAUDE.md**, «Lo que solo ve un navegador», con las cuatro reglas y los dos
fallos del mismo día de los que nacen.

**VERIFICADO — `scripts/gate-informes-se-entienden.mjs`, 59 ✓ · 0 ✗, EJECUTADO** contra la dirección
**pública**. Aplica las cuatro reglas nuevas: **pulsa los botones** (ni una aserción de guardado llama
a la API), prueba **cancelar / vacío / solo espacios / Escape / clic fuera**, prueba **con las
ventanitas silenciadas** —que es la avería exacta— y **mira la captura sobre píxeles**: que el aviso
no toque la burbuja y que el nombre del índice esté a la izquierda del chevron (**x=108 contra
x=1387**). Las once preguntas **se pulsan una a una** y las once contestan. Captura en
`~/informes-shots/ficha-d-bis*.png`.

**No mueve el recuento**: no es un subpunto A–M.

### FICHA D — Analíticas: informes a medida  ✅ HECHO (2026-08-23) — `e16bd01` + `fb5db14` + `bcd826c` · **5 de 5**
Las cinco en una entrega. Palabras del dueño en el encargo original: *«en analíticas lo principal es
que el cliente pueda elaborar informes según su requerimiento y no mostrar una serie de datos donde
él mismo se pierde»*.

**EL PASO 0 CAMBIÓ EL ALCANCE Y SE PARÓ A PREGUNTAR, antes de construir.** Dos cosas:
1. **Las siete medidas de agenda no caben en un solo grano.** «Horas libres» y «% de ocupación» son
   del **día y la persona**: una hora libre no tiene cliente, ni servicio, ni sala. Y **un día entero
   sin citas está 100 % libre y no produce ninguna fila**, así que contándolas sobre las citas
   saldrían siempre de menos. **Decisión de Ibrahin: «ofrecerlas solo donde son ciertas».**
2. **«Horas ocupadas» tenía dos valores verdaderos.** Medido en la agenda real: el lunes 27-jul hay
   una cita de 30 min a las 16:00 y el negocio cierra a las 14:00 → **0,5 h reservadas · 0 h ocupadas
   del horario**. El recorte al horario no es un fallo (sin él, una cita fuera de hora haría pasar la
   ocupación del 100 %). **Decisión de Ibrahin: las dos, con nombres distintos.**

**D1 + D4 · EL ÁREA DE AGENDA (la sexta).** Colgada del **motor de citas** (`tramosPersona` +
`ocupacionPersona`), no de una consulta propia: así no puede contradecir a la agenda ni al Inicio.
- **Seis dimensiones:** fecha · cliente · **servicio principal** · quién la atiende · puesto o sala ·
  estado. Se llama «servicio **principal**» porque una cita con tres servicios no puede contarse tres
  veces.
- **Cinco medidas de grano CITA** (valen con las seis dimensiones): nº de citas, horas reservadas,
  ingresos facturados sin IVA, citas anuladas y ausencias.
- **Cuatro medidas de grano DÍA×PERSONA** (solo por fecha o por persona): horas abiertas, horas
  ocupadas del horario, horas libres y % de ocupación. Fuera de esas dos dimensiones **no se enseñan**
  en el desplegable, y si alguien las fuerza por la API `cruzar` responde **400 diciendo por qué y con
  qué dimensión sí se puede**. El desplegable es cortesía; el candado está en el servidor.
- **Las horas abiertas salen del horario REAL** con sus excepciones, no de un 24×7.
- **Detalles que se ven en el código:** una factura se cuenta **una vez por grupo** aunque la paguen
  dos citas; las anuladas **no** suman horas reservadas (mismo criterio que `ocupacionPersona`) pero
  una **ausencia sí**, porque el hueco estuvo bloqueado; y **la ventana recorrida se DECLARA** en la
  respuesta y en la cabecera del papel — unas horas libres sin decir de qué periodo son es una cifra
  sin base.
- **LOS CUATRO AVISOS DEL VIGÍA YA LLEVAN GRÁFICO** y se retira el cartel «el constructor todavía no
  tiene un área de agenda». `hueco_perdido` es **exacto** (su cifra y la medida salen de las mismas
  primitivas); los otros tres pintan el ritmo de citas del cliente, con su `gap` avisando de que el
  filtro añade el permiso de Clientes.

**D2 · SE ACABÓ EL MURO.** `/admin/analytics` **no dibuja ni un gráfico al abrir**. Arriba el botón
«Crear un informe», debajo «Mis informes guardados», debajo «Informes disponibles» como lista de
nombres con una línea cada uno, y cada uno se dibuja **solo al pulsarlo**. **De doce peticiones al
abrir se pasa a DOS.** Fuera la fila de cuatro indicadores.
**NO SE PERDIÓ NI UN INFORME, contados antes y después: 9 tarjetas antes** (8 informes + el
constructor) **= 8 entradas del índice + el constructor detrás de su botón**. «Informes por área»
conserva sus tres pestañas y sus diez informes. El índice se filtra por el permiso del **área** de
cada informe (owner y admin lo ven todo). *Lo que esto NO es: los endpoints siguen exigiendo
`analytics.read` y filtrando su contenido por área, como estaban — aquí se cierra la puerta de la
lista, no se reescriben los permisos del producto.*

**D3 · SE ACABÓ EL GUARDAR SIN DESHACER.** Borrar (**el endpoint existía desde el paso 4b y no lo
llamaba nadie**), renombrar, dejar de compartir y volver a compartir, y **«Guardar cambios» distinto
de «Guardar como nuevo»** — hasta hoy el front nunca mandaba el `id`, así que cada guardado dejaba un
duplicado. Solo quien lo creó, **y el dueño**; a propósito **el admin no**: ver las cifras de todos no
es poder borrarle el trabajo a nadie. La confirmación dice **con esas palabras** que se borra la
receta y **no un dato del negocio**.

**D5 · IMPRIMIR, PDF Y CORREO, POR EL MOTOR ÚNICO DE LA FICHA C.** El informe compuesto es **una
entrada más de `LISTADOS`** y sale por las **mismas tres rutas** de los quince listados, con membrete,
«Página X de Y» y una cabecera que declara la base: área, por qué se agrupa, qué se mide, los filtros
y la ventana medida. **El papel lleva las dos cosas: el dibujo arriba y la tabla completa debajo.**
- **El dibujo se genera en SVG DENTRO del motor** (`impresion.js`), no con el Chart.js de la pantalla,
  y por dos motivos medidos: el PDF se hace con `page.setContent`, que **no tiene dirección base**
  (habría que incrustar la librería entera en cada papel), y además habría que esperar a que
  terminara de animar. En SVG no hay librería ni espera. **No es un segundo origen de cifras:** recibe
  los mismos pares (etiqueta, valor) que la tabla.
- **Fontanería:** `titulo`, `columnas` y `perm` de un listado ya pueden ser **función de (q, db)**,
  como `totales`/`notas`/`secciones` ya podían. **Los quince listados existentes no cambian ni un
  carácter de su papel** (comprobado).
- **El `panel_id` es lo único que viaja por la URL:** la receta se lee de la base, nunca de la
  dirección, y el permiso se comprueba sobre el **área de esa receta** (un informe de Agenda exige
  `citas.read`; uno de Ventas, `invoices.read`).

**VERIFICADO — `scripts/gate-informes-a-medida.mjs`, 97 ✓ · 0 ✗, EJECUTADO.**
- **Se trae sus propias citas**, porque con las cuatro reales no se podía medir la mitad: ninguna
  facturada, ninguna con ausencia, ninguna con puesto. Crea cinco (facturada · ausencia · anulada ·
  normal · **una fuera de horario**), mide y las borra. La de fuera de horario es la que separa las
  dos medidas de horas: **0,50 h exactas**, y sin ella coincidirían por casualidad.
- **Cada medida contada a mano** por otro camino. Capacidad contrastada contra `ocupacionDia` sumado
  día a día: **88 h abiertas / 3 h ocupadas**, iguales por los dos caminos.
- **La pantalla en un navegador de verdad**, porque lo que cambia D2 es *qué se dibuja al abrir* y eso
  **no se ve en el HTML** (las tarjetas están, ocultas): se mide que **ningún canvas tiene un píxel
  pintado** y que **no ha salido ni una petición de cruce**, con su control positivo de que al pulsar
  sí se dibujan.
- **Los botones se pulsan**, no se buscan: borrar de verdad, contando la base antes y después.
- **El papel comparado con la pantalla valor a valor: 5/5 idénticas.**
- **Cuatro reversiones, las cuatro tumban:** quitar el área (9 rojos) · volver a dibujarlo todo al
  abrir (3) · quitar el dibujo del papel (3) · **desenganchar el botón de Borrar (1 rojo, y es el más
  parecido al fallo real: el botón sigue ahí y no hace nada)**. Restaurado: 97 ✓ · 0 ✗.
- El gate no deja residuo: la base vuelve a 833 facturas, 4 citas y 0 paneles.

**Fuera del barrido.** No se ha metido en `GRUPOS`; se corre a mano. **NINGÚN BARRIDO CORRIDO.**

**UN FALLO PROPIO QUE MERECE QUEDAR ESCRITO:** dentro de una plantilla del servidor, un `\n` escrito
en una cadena de JavaScript **se lo come la plantilla** y llega al navegador como un salto de línea de
verdad → cadena sin cerrar → la página **entera** muerta. Había **seis**, en los `confirm()` de borrar,
del papel largo y del correo. **`node --check` daba OK** (el fichero del servidor es válido) y **el
lint tampoco lo caza**. Lo único que lo vio fue abrir la página en un navegador. Es hermano del
backtick en un comentario, que también apareció dos veces en esta entrega.

### ENCARGO INTEGRIDAD — Recomponer la cadena propietaria de `invoices`  ✅ HECHO (2026-08-23) — `351f5f4`
Sale del pendiente que dejó el encargo CUPONES. Palabras de Ibrahin: **«una alarma siempre encendida es
una alarma muerta: hay que apagarla arreglando la causa, no silenciándola»**.

**QUÉ ESTABA ROTO — y eran DOS puntos, no uno.** Solo `desarrollo-bamburu`; los otros 7 negocios con
facturas cuadraban. En la serie **F|2026** había **dos** eslabones rotos: `F2026-0012` (seq 12) y
`F2026-0020` (seq 20), que son exactamente las dos que iban **detrás de una factura borrada** el mismo
día (la 11 y la 19). `integridad.js` solo enseñaba la primera **porque corta al primer fallo**, así que
el parte de la entrega anterior se quedó corto sin mentir.

**Y lo que NO estaba roto, que importa igual:** los **833 sellos cuadraban con sus propios datos** (0
fallos de `calcHash`). Nadie había alterado una factura. Lo único roto eran los **enlaces**.

**QUÉ SE HA RECOMPUESTO: 857 sellos.**
- **711 facturas** de la serie F — el efecto cascada desde seq 12 hasta seq 1037.
- **146 registros de `invoice_anulaciones`**, y no es alcance de más: esa tabla guarda `prev_hash` = el
  sello de SU factura, y su hash sale de `calcAnulacionHash`, que el propio código describe como
  **«familia del `calcHash` de facturas»**. Es la MISMA cadena propietaria — `models.js:1466` dice
  expresamente que la oficial de Verifactu va «SEPARADA de la cadena propietaria». Los 218 registros
  enlazaban bien antes; recomponer solo las facturas habría dejado **146 apuntando a sellos que ya no
  existen**, que es la referencia colgando que el encargo anterior prohibía.
- **Serie S|2026: 0 cambios.** Nunca estuvo rota, y recalculada de principio a fin devuelve sus **122
  sellos idénticos**. Es el **control positivo** de toda la tarea: demuestra que el cálculo *reproduce*
  el original en vez de inventar uno nuevo. Si la S se moviera, el verde de la F no valdría nada.
- Serie R|2026: vacía desde el borrado de las 19.

**LA CADENA DE VERIFACTU NO SE HA TOCADO, y se demuestra comparando.** SHA-256 de los 1050 registros y
sus 2 envíos: **`4583329b…` antes y después**. Y no participa en el cálculo: `calcHash` usa seis campos
—`invoice_number | issue_date | company_fiscal_id | client_fiscal_id | total | prev_hash`— y **ninguno es
de Verifactu**; a la inversa, la huella oficial (`verifactu.js:40-60`) usa `idEmisor, numSerie, fecha,
tipo, cuota, importe, prevHuella, huso` y **nunca lee `invoices.verifactu_hash`**. El script solo abre
`verifactu_registros` en **lectura**, y para una única cosa: sacar ese SHA de prueba.

**EL NEGOCIO NO SE MOVIÓ NI UN CÉNTIMO** (medido antes y después, no afirmado):
- Ventas **553 documentos · 414.016,40 €** · base 342.165,51 € · IVA 71.850,89 €.
- Cobros **575 · 1.212.609,67 €**. Contabilidad **4625 líneas · 1709 asientos · debe = haber = 917.336,23 €**.
- Y un cinturón más fino, porque hacía falta: un **SHA de TODOS los campos de las facturas MENOS los dos
  del sello**. Cambiar un `total` también hace cuadrar un hash, y eso sería «arreglar» la cadena
  **falsificando el negocio**. Ese SHA es idéntico: ni un campo de ninguna factura ha cambiado.

**`integridad.js` NO SE HA TOCADO, y no es una promesa: su SHA-256 está congelado en la línea base y el
gate lo compara.** Cero excepciones, cero listas blancas, cero «ignorar este negocio».

**⚠️ HALLAZGO DEL PASO 0 — el panel no estaba en rojo: estaba en VERDE RANCIO.** La pantalla de
Integridad **no ejecuta el chequeo**: pinta la última fila guardada en `integrity_checks` (control.db).
Y la última era del **20 de junio**: `desarrollo-bamburu · ok=1 · 20 facturas · «cadena íntegra»`, con
**833 facturas** en la base. Llevaba dos meses diciendo que todo iba bien sobre una foto de otro mundo,
y la ALARMA solo aparecía si alguien pulsaba «Lanzar chequeo ahora». Por eso el gate **lanza el chequeo
por su endpoint REAL** (sesión de superadmin + CSRF) y exige que la fila guardada sea **de hace un
momento** y con el número de facturas de hoy. *(La pantalla pinta lo guardado a propósito —el chequeo
recorre todas las BD—, así que esto no es un fallo a arreglar aquí; es algo que hay que saber para no
volver a leer un verde caducado como si fuera de hoy.)*

**NO SE HA CREADO NINGUNA FUNCIÓN DE RECALCULAR SELLOS.** `scripts/recomponer-cadena-propietaria.mjs` es
puntual: simulacro por defecto, copia de seguridad antes de escribir, y una **lista explícita**
(`NEGOCIOS_DE_PRUEBAS`) — si el negocio no está en ella, **se niega y sale con error**. Ni pantalla, ni
botón, ni endpoint, ni permiso, ni tarea programada. En un negocio real, recalcular sellos es justo lo
que un sistema honesto **no debe permitir**: la cadena existe para delatar que alguien tocó una factura,
y una función que la recalcula convierte la delación en un botón. Queda escrito en la cabecera del script.

**VERIFICADO — `scripts/gate-cadena-integridad.mjs`, 34 ✓ · 0 ✗, EJECUTADO.** Comprueba los 8 negocios
con facturas (no solo el arreglado), el SHA de `integridad.js`, el SHA de Verifactu, la foto del negocio,
el enlace de las 218 anulaciones, el control de la serie S, y **el panel de punta a punta**.
**Tres reversiones, las tres tumban:**
- **A — añadirle a `integridad.js` justo lo que el encargo prohíbe** (`if (absPath.includes('desarrollo-bamburu')) continue`):
  3 rojos. Y esto es lo que hay que mirar: **el verificador saboteado devolvía `{ok:true}`** — un verde
  perfecto y completamente falso. Lo único que lo cazó fue el SHA del fichero.
- **B — romper un eslabón en los datos** (`prev_hash` de `F2026-0500` a ceros): 7 rojos.
- **C — falsificar el negocio para hacer cuadrar la cadena** (subir 100 € el total de `S2026-0001` y
  recalcularle el sello para que cuadre): **10 rojos**, cazado por cuatro vías independientes — el SHA de
  los datos de factura, el control de la serie S, el enlace de las anulaciones y la propia cadena.
Restaurado tras cada una: **34 ✓ · 0 ✗**.

**Fuera del barrido.** No se ha metido en `GRUPOS`; se corre a mano. **NINGÚN BARRIDO CORRIDO.**

**No mueve el recuento** de «CORRECCIONES DEL DUEÑO» (65 vivos · 49 hechos · 16 pendientes): no es uno de
los subpuntos A–M.

### ENCARGO CUPONES — Retirar los cupones y limpiar las 19 facturas de prueba  ✅ HECHO (2026-08-23) — `9e77f2b`
> **⚠️ NO CONFUNDIR CON «LA FICHA B»**, que es otra cosa y se cerró el MISMO día: la puerta de la
> migración asistida (B1/B2/B3, `b7b6706`). Este encargo NACE de su punto **B2-bis**, donde
> `/admin/discounts` quedó «apuntada como candidata a desmontar, en su propio encargo». Este es ese
> encargo. *(La bandera de migración se llama `migration_b_archive_discounts_2026_v1` y **se queda
> así**: ya está puesta en las BD y renombrarla recrearía `discount_codes` vacía.)*
Encargo del dueño, entrega única, las dos mitades juntas. **El PASO 0 encontró dos cosas que el encargo
no preveía y que cambiaron el trabajo**; las dos están abajo, porque son lo que hay que recordar.

**MITAD 1 — CUPONES DESMONTADOS.** `/admin/discounts` y `/api/erp/discounts` dejan de montarse
(comentados, **no borrados**: `discounts.js` sigue en el repo, igual que `orders.js` y `shipping.js`).
Sus tablas se archivan a `discount_codes_archived` / `auto_discounts_archived` con el patrón
idempotente de D1/D2 (bandera en `settings` + los `CREATE` guardados con `if (!bArchived)`, para que
no reaparezcan vacías en el arranque siguiente). **NUNCA DROP:** los 3 cupones que había siguen
legibles. Los **permisos `discounts.*` NO se tocan** (el encargo lo prohíbe): quedan asignables y sin
pantalla que abrir, igual que los de las áreas que apagaron D1 y D2.

> **🔴 EL CONSUMIDOR VIVO QUE NO ESTABA PREVISTO: DISA.** El encargo daba por hecho que los únicos
> lectores eran «la tienda congelada y el TPV viejo». **No era cierto, y no era solo lectura: DISA
> ESCRIBÍA.** Un dueño podía decirle por chat «créame un cupón del 10 %» y se creaba. Cinco
> superficies, todas retiradas: las **3 acciones dedicadas** (`create/edit/delete_discount`), las dos
> tablas en **`WRITABLE_TABLES`** (vía genérica `insert/update/delete_record`), las dos en el **mapa de
> lectura** `QUERY_TABLE_READ_PERMS`, el **contexto de página**, y `/admin/discounts` en la **lista
> blanca de URLs** (las DOS mitades: el sanitizador y el prompt — con una sola no basta, lección de B3).
> Sin este corte, archivar la tabla dejaba a DISA apuntando a una tabla inexistente: **es exactamente
> el fallo que D2 dejó vivo y que sigue vivo hoy con `shipping_methods`**, que se archivó y se quedó
> en `WRITABLE_TABLES`.

**Y un agujero de al lado, que había que tapar para que el archivado sirviese de algo:** `getDbSchema`
enumeraba `sqlite_master` con una lista de exclusión **por nombre exacto**, así que las tablas recién
archivadas **volvían al prompt del modelo por la puerta de atrás** con su nombre `_archived`. Ahora
filtra `_(archived|legacy)$`. De paso deja de enseñarle `sales_orders_archived`, `feedback_archived`
e `inventory_movements_legacy`, que llevaban meses colándose.

**Cómo se comprueba que la tienda está apagada, porque el grep engaña DOS veces** (me equivoqué en el
PASO 0 y lo corregí midiendo): (1) `core/loader.js` importa los módulos con una ruta **construida**
(`join(modulesDir, mod, 'index.js')`), así que `grep "modules/store"` no encuentra **nada** y parece
código muerto — pero el módulo **sí se carga**; y (2) el arranque imprime `✅ Store: Tienda pública en
/store` **aunque no monte nada**, porque ese `console.log` está antes de las dos líneas comentadas.
Lo que de verdad la apaga son los `app.route` comentados por D1 al final de `modules/store/routes.js`.
**Medido: `/store` y `/api/store/*` → 404.**

**MITAD 2 — LAS 19 FACTURAS, BORRADAS DE VERDAD.** Todas en **`desarrollo-bamburu`** (negocio de
pruebas: datos de `seed-taller.mjs`, clientes con payload XSS, usuarios `@bamburu.test`). Series F
(18) y R (1), del 28-may al 20-jun-2026, **4.234,02 € base · 4.751,24 € total**, las 19 `anulada` y
sin **ninguna** fila en `verifactu_registros`. Se fueron enteras, con **28 líneas, 3 cobros, 1 registro
de anulación, 9 propuestas de DISA, 63 apuntes de actividad y 3 asientos con sus 6 líneas**. Cero
huérfanos, `foreign_key_check` limpio. Por **script puntual** (`scripts/limpiar-facturas-prueba-sin-verifactu.mjs`,
simulacro por defecto, copia de seguridad antes de tocar): **no se añade pantalla, ni botón, ni
endpoint, ni permiso. Una factura emitida no se borra: se anula.**

**El negocio cuadra después, y se demuestra con cifras, no con adjetivos:**
- **Ventas: IDÉNTICAS** — 553 documentos, 414.016,40 €, antes y después. Las 19 estaban anuladas y
  nunca contaron. Si esta cifra se hubiera movido, se habría borrado algo que sí contaba.
- **Contabilidad:** el libro baja **exactamente 231,40 €** (los 3 asientos de cobro de esas facturas)
  y sigue cuadrado: debe 917.336,23 € = haber 917.336,23 €.
- **Cobros:** 575, tres menos que los 578 de partida. Ni uno más.
- **Cadena de VERIFACTU: IDÉNTICA.** SHA-256 de los **1050 registros + sus envíos**, `4583329b…`
  antes y después. **Comparado, no afirmado** — y con el SHA, no con el recuento: 1050 filas alteradas
  siguen siendo 1050 filas. La línea base está congelada en `docs/encargo-cupones/linea-base.json`.

> **🔴 LO SEGUNDO QUE EL ENCARGO NO PREVEÍA, Y HAY QUE SABERLO: HAY DOS CADENAS DE HUELLAS, NO UNA.**
> Además de la de Verifactu (`verifactu_registros.prev_huella`, intacta), `invoices` tiene la suya
> **propietaria** (`verifactu_hash`/`prev_hash`), la que recorre `superadmin/integridad.js` y vigila
> `verify-verifactu-t1.mjs`. **Las 19 SÍ estaban en esa, y encadenadas.** Antes: `{total:852, ok:true}`.
> Después: **ALARMA en `F2026-0012`**, «el enlace con la factura anterior está roto (¿borrada/insertada?)».
> **No hay forma de borrar la cabecera de una serie sin eso:** `verifyTenantInvoices` arranca cada grupo
> (serie, año) con `prevStored=''` y exige que la primera factura tenga `prev_hash` vacío. Borrar las
> 20 tampoco lo arregla (la alarma se muda a `F2026-0020`, que sí tiene registro Verifactu). Recomponerla
> exigiría **reescribir hashes de 700+ facturas**, que es justo lo que «la cadena no se toca» prohíbe.
> **No se ha tocado ni la cadena ni `integridad.js`.** ~~El chequeo del superadmin quedará en **ALARMA para
> `desarrollo-bamburu`** hasta que Ibrahin decida qué hacer.~~ **⬜ PENDIENTE DE IBRAHIN.**
> **→ ✅ RESUELTO EL MISMO 23 AGO 2026 (encargo INTEGRIDAD, `351f5f4`):** Ibrahin encargó apagar la alarma
> **arreglando la causa, no callándola**. La cadena propietaria se recompuso entera (857 sellos) y el
> chequeo da VERDE **sin tocarle una línea a `integridad.js`**. Ver su ficha abajo.

> ~~**⬜ TAMBIÉN PENDIENTE — LA FACTURA Nº 20, `F2026-0012` (id 12).**~~ **✅ RESUELTA el 23 ago 2026
> (noche, punto 1 del encargo nocturno) · commit `757667d`.** Se deja el motivo original, que sigue
> siendo cierto y explica por qué no se fue con las otras 19: es del mismo lote y también estaba sin
> registro Verifactu, pero está `rectificada`, no `anulada`, y **sí contaba como venta real (53,01 €)**
> — borrarla movía los totales del negocio, y eso no se hace sin decirlo. El «19» del censo salió de
> mirar solo las 299 anuladas; el lote real eran 20 (ids 1-20).
>
> **LO QUE SE HIZO, con la decisión de Ibrahin encima de la mesa:**
> - **Qué colgaba de ella:** 3 líneas, 1 propuesta de DISA, 2 apuntes de actividad y 1 asiento con sus
>   7 líneas. **Cero cobros, cero anulaciones, cero registros Verifactu**, y nadie la rectificaba ni la
>   sustituía.
> - **Qué cifras se mueven — y se dicen porque se mueven A PROPÓSITO:** ventas **553 → 552 documentos**
>   y **414.016,40 → 413.963,39 €** (−53,01); libro **917.336,23 → 917.283,22 €**, cuadrado; facturas
>   **833 → 832**.
> - **La cadena propietaria, recompuesta** como en `351f5f4`: **856 sellos** (710 facturas de la serie F
>   y 146 registros de anulación). El chequeo de Integridad pasa de **ALARMA en `F2026-0020`** a
>   **CUADRA**, y se refresca de verdad **por su endpoint real**: 27 filas guardadas, 0 en rojo.
> - **VERI\*FACTU idéntica:** mismo SHA-256 de los 1050 registros antes y después. Cero huérfanos.
>   `foreign_key_check` limpio.
> - **Dos fallos de mis propios scripts, encontrados al usarlos por segunda vez:** `VACUUM INTO` **se
>   niega a escribir sobre un fichero que ya existe**, así que la segunda pasada de `limpiar-facturas`
>   y de `recomponer-cadena` moría con *«output file already exists»* — y moría **después de anunciar
>   lo que iba a hacer**, que es la peor forma de fallar. Ahora borran la copia anterior primero.
> - **La bandera `--incluir-rectificadas` es nueva** y existe para que borrar una factura **que cuenta**
>   no pueda pasar por descuido: hay que pedirlo expresamente.
> - Línea base del gate rehecha (833/553 caducaron al borrarla) **conservando lo que esa línea base
>   existe para vigilar**: el SHA de la cadena de Verifactu. Gate `gate-cadena-integridad.mjs`:
>   **34 ✓ · 0 ✗**, ejecutado.

**Huecos de numeración:** serie F 2026 pierde las secuencias **1-11 y 13-19** (18 números), y queda
`F2026-0012` sola antes de `F2026-0020`. Serie R 2026 queda **vacía**. **No hay reutilización de
números**: el siguiente sale de `invoice_sequences` (contador propio: F=1041, R=1), no de `MAX(sequence)`.

**Un huérfano que NO es mío y que el gate destapó:** 11 filas de `activity_logs` con `entity='invoice'`
apuntando a facturas inexistentes (ids 145-155, del **15-jul-2026**). Son muy anteriores a este encargo.
El gate exige que **no crezcan**, no que sean cero: limpiarlas no es de esta tarea. Anotado, sin tocar.

**VERIFICADO — `scripts/gate-cupones-desmontados.mjs`, 48 ✓ · 0 ✗, EJECUTADO** (no solo escrito).
Pide las rutas **con sesión válida de DUEÑO**: sin sesión `/admin/*` da 302 y `/api/erp/*` da 401, y
los daría igual si la pantalla siguiera montada — medir eso habría sido un verde por el motivo
equivocado. Lleva control positivo (`/admin/inventory` → 200) para que un 404 por servidor caído no se
disfrace de aprobado. **Tres reversiones, las tres tumban:** **A** volver a montar la pantalla → `got 200`
(1 rojo) · **B** resucitar `F2026-0001` desde la copia → 3 rojos · **C** tocar **una** huella en una copia
de la BD → el SHA cambia (`4583329b…` → `394f0781…`) con las mismas 1050 filas. Restaurado: 48 ✓ · 0 ✗.

**Fuera del barrido**, como toda la familia Verifactu: no se ha metido en `GRUPOS`. Se corre a mano.

**NINGÚN BARRIDO CORRIDO** — el encargo lo prohibía expresamente.

**⚠️ LA FUNCIÓN VUELVE, Y NO ES UNA CONTRADICCIÓN.** El 23 ago 2026, al cerrar el encargo INTEGRIDAD,
Ibrahin apuntó **«Descuentos y promociones — rehacer la función entera y bien (bonos, promociones,
descuento por cliente), operable por DISA»** (ver «TAREA 3 — Funciones nuevas», **hecha el 23 ago 2026**). Lo que se retiró
aquí fue **una pantalla muerta**, no la necesidad: nada la aplicaba. Quien lea esta ficha dentro de
seis meses tiene que ver las dos cosas juntas, o creerá que los descuentos están descartados.

**NO MUEVE EL RECUENTO** de «CORRECCIONES DEL DUEÑO» (65 vivos · 49 hechos · 16 pendientes): esto no
es uno de los subpuntos A–M. Nace del **B2-bis** de la ficha B, que era una nota dentro de una ficha
ya contada como hecha, no un subpunto propio. Pendientes siguen siendo **D 5 · E 4 · G 4 · I 3**.

### Rendimiento · Opción A — coste de bcrypt y frenos de peticiones  ✅ HECHO (2026-07-09)
Encargo expreso del dueño a partir de `docs/rendimiento/diagnostico-carga.md` (que se guarda aquí con
este commit: no estaba en el repo). **Solo la opción A.** Las opciones B (varios procesos con afinidad)
y C (sacar la BD del hilo principal) quedan sin tocar, tal como pidió el dueño.

- **bcrypt de coste 12 → 10** (`core/auth.js`, constante `BCRYPT_COST`, fuente única). Medido en el banco
  aislado: el login pasa de **3,9 a 15,8 req/s** (p50 259 → 63 ms) a concurrencia 1, y de **15,3 a 59,8
  req/s** (p50 1010 → 263 ms) a concurrencia 16. **~4×**, justo lo que predecía el informe ("50-60
  logins/s"). Sigue por encima del mínimo de OWASP.
- **Migración al vuelo, sin resetear nada.** `verifyPassword` solo marcaba `needsRehash` para los hashes
  del sistema viejo (sha256): un hash bcrypt devolvía SIEMPRE `false`, así que bajar la constante no
  habría migrado a nadie. Ahora lee el coste del propio hash (`bcrypt.getRounds`) y renueva si difiere del
  vigente — vale para subir y para bajar. Verificado: 50 dueños a `$2b$12$` acabaron en `$2b$10$` tras un
  login; una contraseña **incorrecta** no renueva nada; el sha256 legado sigue migrando.
  - El coste estaba además escrito a mano en `models.js` (admin de arranque) y `scripts/reset-admin.js`,
    ambos creando contraseñas nuevas. Los dos leen ya `BCRYPT_COST`. Un negocio nuevo nace a `$2b$10$`.
- **Freno general: NO se mueve, sube el tope de 100 → 600/min por IP.** Ponerlo detrás de
  `tenantMiddleware` (para tener clave negocio+IP) dejaría `/`, `/acceso`, `/docs`, `POST /find-tenant` y
  `GET /admin/autologin` **sin freno ninguno** — y `/find-tenant` es justo la que hay que blindar. El 600
  sale de medir: una carga de página del admin cuenta **2,8 peticiones** (5 la más pesada,
  `/admin/analytics`), y una oficina de 5 empleados tras un NAT genera 133 req/min — con el tope de 100
  disparaba **21 respuestas 429 con tráfico normal**. Con 600: 0 con 5 empleados, 0 con 10, y una
  avalancha de 4.467 req/min sigue cortada (599 servidas, 1.633 bloqueadas).
  - *(Nota: el informe decía "~9 llamadas a `/api/` por página". Hoy son 2,8 de media.)*
- **`POST /find-tenant` estrena freno propio** (10/min + 60/hora por IP). Es una ruta sin autenticar que
  resuelve email → negocio y distingue acierto de fallo (404): oráculo de enumeración. Y es cara:
  `getTenantsByEmail` **abre la BD de cada negocio activo** (57-67 ms con 50). De 99 sondas/min a 10.
- **El freno respondía HTML a un endpoint JSON.** `/find-tenant` se llama por `fetch` + `await r.json()`;
  el 429 salía como página y el usuario leía *"Error de conexión"*. `core/rate-limit.js` responde ahora
  JSON a quien manda JSON (o pide `Accept: application/json`); una navegación normal sigue recibiendo la
  página. No se ha tocado ningún límite de los frenos que ya iban bien (login, DISA, tienda, alta).
- **Banco de pruebas** (`:3999`, `data/` propia, 50 negocios, snapshot restaurado y reinicio entre
  escenarios, **nunca contra producción**). Reprodujo la línea base del informe antes de tocar nada (3,9
  req/s · p50 259 ms frente a los 3,9 · 261 publicados), así que la mejora es del cambio, no del medidor.
- **Fuera** (registrado): separar el cupo **por persona** dentro de un mismo negocio (hoy la clave del
  freno general es solo la IP; los compañeros de una oficina comparten cubo) · `superadmin/index.js:94`
  usa `verifyPassword` pero **ignora `needsRehash`**, así que esa contraseña no migrará nunca · cada 429
  hace un INSERT en `control.db` (`recordSecurityEvent`): una petición bloqueada cuesta más que una
  servida · hallazgo 1 del informe (un negocio con la BD bloqueada congela a los demás 5 s) · opciones B y C.

### Avisos — pantalla central, cobros vencidos, visto por usuario y correo diario  ✅ HECHO (2026-07-09)
Encargo expreso del dueño a partir de `docs/disa/diagnostico-avisos.md`. **Aditivo y reversible**: no se
toca el hash de facturas, ni el stock, ni la lógica de los motores que ya calculan cada aviso
(`pagos.js` / `cobros.js` / `recurrentes.js`). Este encargo los concentra y los muestra bien.

- **Pantalla central `/admin/avisos`** (`routes/avisos.js`). Se sirve vacía y pide `/api/erp/avisos` al
  abrirse → **recalcula en vivo**, nunca hay un número guardado que se quede viejo. **Se RESUELVE aquí**:
  cada fila abre el MISMO modal compartido que su pantalla de origen (`cobro-modal` / `pago-modal` /
  `stock-modal`), que pega al único endpoint validado. Cero lógica de negocio duplicada. Al guardar, el
  aviso desaparece y el contador baja sin recargar. Botones **gateados por permiso**
  (`cobros.manage` · `purchases.create` · `inventory.edit`); sin permiso, enlace de solo lectura.
  - **Excepción deliberada:** el borrador recurrente NO se emite desde una fila (crea una factura con
    valor legal + cadena de hash) → enlaza a `/admin/recurrentes` a revisarlo. Confirm-first.
- **Fuente nueva `cobrosVencidos`** (`avisos.js`), una función más en `SOURCES`. Se apoya en `openDebts()`
  de `cobros.js` — ese motor ya decide qué factura cuenta como deuda y cuál está vencida; aquí solo se
  filtra y se normaliza. Aparece en pantalla, campana, Inicio y correo. Etiqueta del bloque
  `factura_recurrente` en el email, que faltaba (§6 del diagnóstico).
- **"Visto" por USUARIO, no por negocio** (`alert_seen` era singleton `CHECK (id=1)`: si uno los abría,
  quedaban vistos para todos). Tabla nueva `alert_seen_user (user_id PK, fingerprint, seen_at)`, sembrada
  una vez desde la huella vieja para que nadie vea el badge en rojo de golpe. **`alert_seen` NO se toca ni
  se borra**: revertir el código restaura el comportamiento anterior con su estado.
  - **Visto POR AVISO**: cada fila (y cada item del panel) se marca/desmarca por separado; también
    "marcar todos". Abrir la pantalla NO marca nada: el visto lo decide el usuario.
- **Señales consolidadas: de 7 sitios a 2.** Se retiran el contador del pin de DISA y el badge flotante
  "N alertas". Queda **la campana del topbar** — que ahora **abre un panel** de notificaciones con su
  "Visto" por aviso y su "marcar todos" (antes era un `<div>` decorativo, sin destino y con el punto rojo
  encendido siempre) — y **la tarjeta "Avisos" del Inicio**, ahora clicable (era un `<div>` muerto).
  El punto de la campana cuelga del **estado**, no del conteo: rojo = algo sin ver · gris = pendientes ya
  vistos · ausente = nada.
- **Correo diario, de verdad.** Existía `scripts/bamburu-avisos.mjs` pero **nunca se programó** y apuntaba a
  `User=ibrahin`. Timer systemd instalado y activo (`User=ubuntu`, `OnCalendar=*-*-* 08:00:00 Europe/Madrid`
  — la zona va explícita porque el servidor corre en UTC). **Causa raíz que el diagnóstico no vio:**
  `company_config.email` estaba **vacío en los cinco tenants** → el script salía con código 0, `fallos=0` y
  **0 correos**. Verificado con envío real: fila en `daily_alert_log` + correo recibido; segunda ejecución
  no reenvía (idempotencia por día).
- **Gates** (94 aserciones, navegador real): `test-pago-voz-avisos.mjs` (47) · `gate-avisos-badge.mjs` (24,
  señal única + estado + aislamiento por usuario) · `gate-avisos-pantalla.mjs` (23, **pulsa los botones**:
  registra un cobro y lo deshace, marca visto por aviso, abre el panel de la campana).
- **Fuera** (registrado): la campana **no baja sola** al resolver algo en Cobros/Pagos sin navegar (§3 del
  diagnóstico; ahora que existe `window.bellSync` es un `fetch` por pantalla) · fuente de **CRM** en riesgo ·
  coste de `estadoAvisos()` en cada render (4,05 ms con 72 facturas, de los que 3,06 ms son `openDebts()`;
  es lineal en nº de facturas y `layout.js` lo llama en TODA página admin).

### Avisos y correos — que el dueño mande sobre su bandeja de entrada  ✅ HECHO (2026-08-17)
Encargo expreso del dueño. Cierra los dos cabos que dejó abiertos el correo diario del 9-jul y las
plantillas editables del 14-jul: **el resumen no se podía apagar, ni mover de hora, ni recortar, ni
filtraba por permisos** (iba al correo del NEGOCIO), y **ningún correo automático tenía interruptor**.
Aditivo: tres tablas nuevas, ni un DROP, ninguna columna renombrada.

- **EL PASO 0 TUMBÓ CUATRO SUPOSICIONES DEL ENCARGO, y las cuatro cambiaron el plan:**
  1. **No existe una fuente de «vencimientos fiscales».** Las 7 fuentes reales son `envio_verifactu`,
     `vencimiento_proveedor`, `cobro_vencido`, `cliente_en_riesgo`, `stock_bajo`, `factura_recurrente`
     y `reserva_publica`. La séptima que se creía fiscal es **Verifactu**, y no avisa de plazos con
     Hacienda: avisa de que **un envío concreto a la AEAT falló**. Avisos de plazos fiscales **no
     existen** y serían función nueva.
  2. **El correo vacío ya no salía.** `bamburu-avisos.mjs:59` ya cortaba con cero avisos —comprobado
     ejecutándolo, no leyéndolo—. Lo que faltaba era **constancia de que se evaluó**: un día sin avisos
     y un día en que el cron no llegó a correr se veían **exactamente igual** desde fuera.
  3. **`fuentesPermitidas(c)` NO era reutilizable «tal cual»**: lee del CONTEXTO de Hono y el cron no
     tiene contexto. Se extrajo el cálculo a `fuentesDe({role, perms})` + `permisosDeUsuario(db, id)`
     en `avisos.js`, y `layout.js` **delega**. Un solo sistema de permisos, no dos.
  4. **No son 8 tipos / 18 variantes: son 10 / 20** (la pieza 5 añadió confirmación y recordatorio de
     cita). Y la «variante» es **el tono del mismo correo** (amable/firme/formal/última), que elige
     quien envía → **el interruptor va por TIPO**, como se pedía.
- **EL HALLAZGO QUE MÁS CAMBIÓ LA TAREA: `company_config.email` está VACÍO en 6 de los 7 negocios.**
  El correo diario solo podía llegar a **uno**. `admin_users.email` es la identidad de login y existe
  en el **100 %** de los usuarios. Así que el destinatario **se invierte**: va a la dirección personal
  siempre, y el correo del negocio queda como respaldo **solo del dueño** y **se reporta** cuando se
  usa. Al encender esto, `helados-ibrahin` recibió su primer parte: llevaba meses con avisos que no
  veía nadie.
- **BLOQUE 1 · lo que Bamburu te cuenta a ti** (`avisos_pref_usuario`, **la ausencia de fila es el
  defecto**: activado, cada día, 8:00, todas las fuentes → nadie deja de recibir por la migración).
  Interruptor maestro, diaria/semanal con día, hora, y casillas por fuente **de las que puede ver**.
  El filtro es una **intersección** con el permiso VIVO: una casilla marcada de algo que ya no puede
  ver no se le manda.
- **EL CONTENIDO PASA DE RECUENTO A PARTE** (`parte-diario.js`). Decía «233 avisos que requieren tu
  atención» —que no es información, es el tamaño del montón—; ahora dice *«Te deben 1.240,00 €, de los
  que 380,00 € están vencidos. 2 personas esperan que apruebes su reserva»*, con **enlace directo a
  cada cosa**. Las cifras salen del **mismo `avisosDelDia`** que la campana: cero criterios nuevos.
  Dos frases NO son avisos —**la agenda del día y la deuda total**— y se leen de `citas` y de
  `openDebts()`, **solo lectura, autorizado por el dueño**: sin ellas «380 € vencidos» es media noticia.
  **Y el asunto lleva la noticia** (`Tu negocio hoy · 6 citas hoy · 380,00 € vencidos`): es lo único
  que se lee en la notificación del móvil sin abrir nada.
- **EL TEMPORIZADOR PASA A HORARIO**, sin planificador nuevo. Y no pregunta «¿es tu hora exacta?» sino
  **«¿tu hora ya pasó y aún no te he escrito hoy?»**: con `Persistent=true`, un servidor apagado siete
  horas provoca **UNA** pasada de recuperación, no siete, y con la igualdad se quedaba fuera todo el
  que tuviera una hora intermedia. La idempotencia (`resumen_envios`, UNIQUE por fecha+persona) impide
  el duplicado. `daily_alert_log` **no se toca**: su clave primaria es `fecha` a secas y ampliarla
  habría exigido recrear la tabla.
- **BLOQUE 2 · lo que Bamburu envía a tus clientes** (`email_tipo_pref`, otra vez ausencia = encendido).
  Interruptor en los **2 automáticos** y en los **5 de botón** (decisión del dueño). Los **2
  transaccionales** (recuperar contraseña, portal) **no lo llevan y se explica por qué**: apagar el de
  la contraseña deja a alguien fuera de su cuenta, que es lo mismo que el editor de plantillas **ya
  bloquea**. Botón **«Mándame una prueba a mí»**: a la dirección **de la sesión**, nunca del body, y con
  datos de ejemplo.
  - **DOS CHOQUES RESUELTOS SIN CREAR UN SEGUNDO MANDO:** (a) `recordatorio_cita` **ya tenía**
    interruptor (`cita_modo_recordatorio`, que **nace apagado**); el nuevo **lo refleja**, porque uno
    nuevo «encendido por defecto» habría empezado a mandar recordatorios que hoy no se mandan. (b) la
    **confirmación de reserva** queda **bloqueada** mientras la puerta pública esté encendida —lo
    prometido en la pieza 6: la política de cancelación se repite en ese correo— y el **servidor
    devuelve 409**, no solo la pantalla.
- **Una sola pantalla, `/admin/settings/avisos`, y SIN `requirePerm` en el bloque 1 — a propósito.**
  El resto de Ajustes exige `company.read`, que en la práctica es dueño o admin (`company` ni siquiera
  está en la tabla `permissions`). Con ese candado, **un empleado no podría apagar su propio correo**
  ni usar el enlace del pie. El bloque 2 sí lo lleva. Cada endpoint toma el id **de la sesión**: nadie
  puede leer ni cambiar la preferencia de otro.
- **Deuda saldada:** `test-pago-voz-avisos` llevaba en rojo desde el 14-jul porque el asunto decía
  «1 avisos» y la prueba esperaba «1 aviso». Como este encargo reescribe el asunto, **entraba**: 50/0.
- **Verificado:** `gate-avisos-correos` **45/0** — negocio **creado desde cero** y borrado al final,
  correos **enviados de verdad** al buzón sumidero de Resend (cero correos a personas): apagar → no
  llega · encender a otra hora → llega a esa hora y **con los datos reales del negocio** · sin nada que
  contar → no se envía **pero consta** · dos usuarios, misma pasada, **la de cobros prohibido no recibe
  ni una cifra de deuda** · dos pasadas seguidas → **un solo correo** · recordatorio de cita apagado →
  no sale, encendido → sale · confirmación **bloqueada con la puerta pública** (409) · cobro apagado →
  el envío se niega con el motivo · móvil 390×844 y escritorio, **0 errores JS**.
- **Regresión VERDE en su número exacto**: gate-plantillas-email 41/0, gate-agenda-sencilla 11/0,
  test-reserva-publica 130/0, gate-registro-alta 34/0, test-oficio 94/0, test-oficio-alta 52/0,
  gate-oficio-pantalla 28/0, verify-disa-query-permisos 43/0, **test-pago-voz-avisos 50/0** (era 46/1).
- **Anotado, no tocado:** `verify-plantillas-email` sigue en rojo previo (cuenta 8 tipos/18 variantes;
  la pieza 5 los dejó en 10/20 y no lo actualizó). El guardián vigente es `gate-plantillas-email`, 41/0.

### Reorganizar el menú: Agenda se queda con lo que se usa atendiendo clientes  ✅ HECHO (2026-08-18)

**DECISIÓN DE PRODUCTO DE IBRAHIN, y es la regla que decide todo lo demás:** *en Agenda solo vive lo
que se usa atendiendo clientes; todo lo que se monta una vez y se olvida vive en la configuración del
negocio*. **No se eliminó ninguna función**: seis entradas se mudan de sitio y se renombran.

**AGENDA SE QUEDA CON DOS:** «Agenda» y «Recordatorios a clientes» (era «Cola de envíos» — mismo sitio,
mismo contador al lado cuando hay pendientes). Con 0 entradas de ajuste el desplegable **va de una
pieza solo**: lo decide `MIN_AJUSTES` (3), que ya existía. No se tocó ningún umbral.

**LAS SEIS MUDADAS**, en el orden en que se monta un negocio, dentro de la sección «Cómo funciona mi
agenda» de `/admin/settings`: **Cuándo abro** (Horarios) · **Cuánto dura cada servicio** (Servicios
reservables) · **Mi equipo** (Quién atiende, sin el atajo de Agenda) · **Cómo se piden las citas**
(Ajustes de citas) · **Mi página de reservas** (Reservas por Internet) · **los puestos** (nombre del
oficio: Sillas/Cabinas/Salas/Boxes). **Las rutas NO cambian** y **los permisos NO cambian.**

**CORRECCIÓN DE IBRAHIN (18 ago 2026):** la sección de la agenda va **AL FINAL** de la pantalla, detrás
de los datos del negocio, avisos, plantillas y situación fiscal. Estaba la primera y no debía: esta
pantalla es la configuración DEL NEGOCIO, y lo de la agenda es una sección suya, no su portada. El
orden INTERNO de las seis no cambia (sigue siendo el orden en que se monta un negocio).

**UNA SOLA LISTA, NO DOS.** La sección **no** se escribe a mano en `routes/settings.js`: vive en
`CONFIG_NEGOCIO` (`modules/erp/menu.js`), la misma mesa de la que comen el rail, el buscador y las
anclas, y la pinta `configNegocioHTML()` en `layout.js`. Escribirla en la pantalla habría creado la
segunda lista que la cabecera de `menu.js` lleva meses prohibiendo.

**CORRECCIÓN DE IBRAHIN sobre el hallazgo de la auditoría previa, y es el corazón de la pieza: LA
SECCIÓN NO HEREDA EL CANDADO DE LA PÁGINA QUE LA CONTIENE.** `/admin/settings` exigía `company.read`
en seco; con eso, mudar habría **cerrado** seis puertas a quien tiene `citas.read` y no es dueño. Ahora
entra quien tenga **algo** que ver ahí y ve **exactamente eso**: cada entrada conserva su permiso
exacto (`citas.read`, `citas.edit`, `admin.manage_users`), y el bloque de empresa —y su `<script>`—
solo se pinta con `company.read`, con las APIs negando igual que antes. Ni se abre ni se cierra nada.

**«SILLAS Y APARATOS» NACE OCULTA.** Es la única entrada condicional del menú: aparece sola cuando hay
un puesto de alta **o** algún servicio exige uno. Para el negocio que la necesita y aún no lo sabe, la
puerta está **dentro de «Cuánto dura cada servicio»**: al marcar que un servicio necesita un sitio, se
da de alta ahí mismo, **sin recargar y sin cerrar el modal**, y la entrada aparece.

**LA PÁGINA DE RESERVAS SE ENCIENDE SOLA** cuando el negocio tiene (a) horario propio y (b) al menos un
servicio con precio ≠ 0 y con duración. **No antes**, y por un motivo concreto: los servicios sembrados
nacen a 0 € y el horario de fábrica es 8:00–21:00 los siete días — encenderla antes publicaría precios
en blanco y domingos que el negocio no cumple. Al encenderse **avisa al dueño por los canales que ya
hay** (campana, pantalla de avisos, Inicio, correo diario) con el enlace, qué se ve y **un interruptor
para apagarla en un clic**. Es de **una sola vez** (`cita_pub_auto`): si el automatismo pudiera volver a
encenderla, el interruptor de apagado sería mentira. Y **solo se publica lo que tiene precio y
duración** (`SQL_PUBLICABLE`, en un solo sitio para que la lista pública y la validación de cada reserva
no puedan discrepar).

**EL BUSCADOR ENCUENTRA LAS 8 POR SU NOMBRE NUEVO Y POR EL VIEJO** (`alias`): quien lleva un año
tecleando «Cola de envíos» u «Horarios» sigue llegando, y ve en el resultado el nombre nuevo. Un alias
nunca crea un destino ni salta un permiso.

**VERIFICACIÓN — `gate-menu-navegacion` 154/0** (era 105/0). **N ANTES = N DESPUÉS = 50 puertas**,
comprobadas **una a una por identidad** sumando las dos superficies (36 del rail + 6 de la
configuración + 2 fijas + 6 de cuenta); en un negocio recién creado son 49, porque la de puestos es
condicional, y la 50ª se comprueba al darla de alta. Las seis responden **200 desde su sitio nuevo y
desde su ruta vieja**. Un segundo usuario con `citas.read` y **sin** `company.read` entra, ve solo sus
dos, pulsa y recibe 200, y no ve —ni encuentra— nada más de esa pantalla (sus APIs, 403).
Además: `test-textos-citas` 27/0 · `gate-agenda-calendario` 38/0 · `gate-agenda-sencilla` 14/0 ·
`gate-agenda-visual` 68/0 · `gate-citas-pantalla` 25/0.

**DOS COMPROBACIONES CAMBIARON DE SITIO, y se dice para que no parezcan perdidas:**
- *Arrastrar una entrada al bloque de ajustes* se hacía en Agenda, la única área que llegaba al umbral.
  Ya no se parte ninguna de fábrica, así que el escenario se **fabrica con la preferencia de orden del
  propio usuario** (que es lo que hoy puede partir un desplegable). Bajar `MIN_AJUSTES` para que la
  prueba siguiera valiendo habría sido cambiar el producto para que el gate no se queje.
- *El nombre del puesto en el menú* (`test-textos-citas`) se comprobaba en el rail. Ahora se comprueba
  en la sección — **y mirando la fila concreta**, porque buscar el texto en la página daba verde con el
  cambio deshecho: esa pantalla también pinta el rail. Pasaba por el motivo equivocado.

**VALIDADO DESHACIENDO EL ARREGLO** (regla de `session.json`): con el producto en `HEAD` y los gates
nuevos, `gate-menu-navegacion` cae a **78/20** y `gate-agenda-calendario` a **37/1**. `test-textos-citas`
daba **27/0 igual** hasta apretar la aserción; ahora cae a **26/1**.

**Regresión completa:** `run-gates.mjs --all` 50/63. **Los 13 rojos son previos**: los mismos 13, por
nombre, con el árbol revertido a `HEAD` (comprobado con copia del árbol y `diff -q` al restaurar).
Causa del más cercano a lo tocado, `gate-avisos-badge`: **gate caducado** — busca `a.disa-fig-link` en
el Inicio y esa clase ya no la usa ningún elemento (solo queda su CSS), así que la tarjeta no se
encuentra; no es un fallo del producto. **Anotado, no arreglado** (otro tema).

**HALLAZGO, no tocado:** ninguno de los seis gates de agenda/menú está en los grupos de
`run-gates.mjs`, así que **no entran en `--all`**. Hoy se corren a mano. Si se quiere que la regresión
completa los cubra, hay que meterlos en un grupo — decisión del dueño, porque alarga el barrido.

**Capturas:** `/home/ubuntu/menu-shots/` (Agenda con sus dos entradas · la sección en su sitio · sin
puestos frente a con un puesto). **Desplegado y verificado por HTTPS** en `peluqueria-gil.bamburu.com`:
Agenda con 2 entradas, la sección con sus 5, y las 7 rutas viejas a 200.

### ENCARGO — Cerrar lo que quedó abierto (la norma sin excepciones · la puerta pública)  ✅ HECHO (2026-08-20)

**Cero código de producto. El puntero del Peldaño 8 no se mueve.** Barrido **75 → 78** comprobaciones,
**66/78**.

---

#### PARTE A — la norma no tiene excepciones

**EL MISMO FALLO, DOS VECES EL MISMO DÍA.** Al corregir el automatismo del barrido dejé escrito: *«El
gate propio de la tarea sí se corre: lo que no se da por supuesto es la regresión»*. **Eso tampoco lo
acordó Ibrahin.** Primera vez: su «barridos a demanda» acabó siendo *corto automático + completo a
demanda*. Segunda: *gate propio automático + regresión a demanda*. **Las dos veces la mitad inventada
era la que me daba permiso para ejecutar algo.**

**La norma pasa a estar escrita ENTERA en un solo sitio** — `RITUAL.md` § «LA REGRESIÓN»:

> **NINGÚN BARRIDO Y NINGÚN GATE SE EJECUTA SOLO. NI EL DE LA TAREA, NI EL CORTO, NI EL COMPLETO, NI
> ANTES DE UN COMMIT. Se ejecutan cuando Ibrahin lo pide. Si un encargo necesita ejecutarlos, lo dice
> ARRIBA DEL TODO y visible, y con eso queda pedido.**

`CLAUDE.md`, `barrido-estado.mjs` y `run-gates.mjs` **apuntan ahí y ya no la reescriben**. No es
puntillismo: la primera versión inventada sobrevivió a la primera corrección **precisamente por estar
copiada en cuatro sitios**. Una norma contada dos veces son dos normas en cuanto una se retoca.

**Y la regla de método, en `CLAUDE.md`:** *si una norma de Ibrahin admite dos lecturas, no se elige
una — se pregunta*. Cuando el texto que escribo crece más que lo que él dijo, **lo que sobra es mío**.

---

#### PARTE B — la puerta pública entra en el barrido

**PASO 0 · Los 2 rojos eran SOLO el conteo.** `test-reserva-publica` exigía **10** columnas
`cita_pub_*` y hay **12**: `921bbe1` (18 ago) añadió `cita_pub_auto` (pestillo de una sola vez del
encendido automático) y `cita_pub_auto_visto` (el dueño ya vio el aviso) sin actualizar la cuenta. Lo
que la aserción quería demostrar **sigue siendo cierto**, comprobado: `runMigrations` ×3 → **12·12·12**
(idempotente) y la tabla `citas` **intacta**. Cuenta actualizada a 12, mismo listón. **131/133 → 133/133.**

**Las tres, dentro, con su clase declarada:**
| Comprobación | Qué cubre | Tarda | Clase |
|---|---|---|---|
| `test-reserva-publica` | 133 aserciones sin servidor: nace apagada, handle malo = mismo 404, reserva completa, hueco pisado → 409, antelación **en servidor**, «yo apruebo» retiene y caduca solo, cliente existente se enlaza y no se duplica | 38-60 s | compartida |
| `test-neto-cero-reserva` | 21: **reservar no es vender** (ni factura, ni Verifactu, ni diario, ni P&G) y cuando sí se vende, Ventas y P&G vuelven al valor exacto | 5 s | compartida |
| `gate-reserva-publica-pantalla` | 52 de navegador: apagada da 404, los mandos del dueño, reservar en móvil y escritorio, política y consentimiento, **cero fuga**, la cita entra en la agenda | 17 s | **SOLA** |

**Por qué la de navegador va SOLA:** reescribe la configuración pública del negocio **entero**
(`cita_pub_*`: la apaga, la enciende, le cambia handle, ventana y política) y sus aserciones de cero
fuga **enumeran todos los clientes y todos los usuarios activos** en ese instante. Con otro gate
escribiendo a la vez, ni la configuración ni el censo son estables. Misma familia que
`gate-oficio-pantalla`.

**Tabla `AFECTA`:** `modules/erp/reserva-publica*` y `modules/erp/routes/reserva-publica*` → grupo
`reserva` + `clientes`. Antes **`routes/reserva-publica.js` no lo cubría ninguna regla**, así que
tocarlo mandaba el corto a correr los 75: prudente, pero a ciegas.

**🔧 LA PRUEBA DE REVERSIÓN DESTAPÓ UNA ASERCIÓN QUE DABA VERDE POR EL MOTIVO EQUIVOCADO.** *«Con la
puerta apagada, la dirección responde 404»*: el 404 llegaba porque **el handle todavía no coincidía**
—el gate lo escribía después, en el paso [2]—, no porque la puerta estuviera apagada. Con el guardián
`exigirPuerta` saboteado, el gate **seguía en 52/52**. Ahora el handle se pone **antes** de apagar, y
el sabotaje la tumba (`200` en vez de `404`). **Segunda vez hoy** que un sabotaje destapa esto: la
otra fue el «volver al mes anterior» del calendario.

**🔧 Y el runner no reconocía su resumen.** Las dos de lógica dicen *«133 comprobaciones, 0 fallos»* y
`RESUMEN` no conocía ese formato: salían **SOSPECHOSAS** pasando 133/133 y 21/21. Añadido
`\d+\s+comprobaciones` — **el listón no baja**: sigue exigiendo que la comprobación DIGA cuántas
aserciones corrió. Lo causó la propia incorporación, por eso se arregla aquí.

---

#### 🔎 EL HALLAZGO GORDO: 97 COMPROBACIONES QUE NADIE EJECUTA

**Van dos zonas enteras invisibles en el mismo día** (la agenda por la mañana, la puerta pública por
la tarde), así que se barrió el repositorio entero comparando los ficheros que existen contra las dos
listas que gobiernan el barrido. **De 182 ficheros de comprobación, 78 están dentro, 9 declarados
fuera con motivo, y 97 no están en ninguna de las dos: ni corren, ni consta que no corran.**

**91 de las 97 llevan sin tocarse desde junio o julio.** El inventario completo, con coste estimado y
zona, está en **`docs/comprobaciones-fuera-del-barrido.md`**. **NO se ha metido ninguna**: es material
para que Ibrahin decida, y meterlas de golpe puede destapar decenas de rojos caducados a la vez.

---

#### VERIFICACIÓN

1. **Cero excepciones escritas.** El grep en `RITUAL.md`, `CLAUDE.md`, `barrido-estado.mjs` y
   `run-gates.mjs` solo devuelve **el texto que declara la excepción retirada**.
2. **La norma entera aparece en UN sitio**: `RITUAL.md:13`. Los demás apuntan.
3. **Un commit no dispara nada** (`data/tiempos-gates.json` con la misma marca antes y después).
4. **`test-reserva-publica` 131/133 → 133/133.**
5. **Las tres salen por nombre en el veredicto de `--all`:** `test-reserva-publica` 133 ·
   `test-neto-cero-reserva` 21 · `gate-reserva-publica-pantalla` 52 OK. **75 → 78 · 66/78.**
6. **`--tocado` las selecciona:** tocando `reserva-publica.js` → 15 de 78 · `reserva-publica-config.js`
   → 53 de 78 (arrastra el grafo de imports) · `routes/reserva-publica.js` → 15 de 78. Las tres salen
   en las tres sondas.
7. **Reversión de las tres:** la puerta deja de nacer apagada → `test-reserva-publica` **1 fallo** ·
   la cita reservada cuelga de una factura → `test-neto-cero-reserva` **1 fallo** · se quita el
   guardián de la puerta → `gate-reserva-publica-pantalla` **1 fallo**.
8. El inventario de las 97, entregado en `docs/comprobaciones-fuera-del-barrido.md`.
9. **Aserciones: 133+21+52 = 206 entran al barrido.** Antes → después: `test-reserva-publica`
   131/133 → **133/133** · `test-neto-cero-reserva` 21 → **21** · `gate-reserva-publica-pantalla`
   52 → **52**. **Ninguna eliminada, ninguna ablandada** — una reforzada.

**⚠️ TRES BARRIDOS COMPLETOS, Y HAY QUE DECIR POR QUÉ.** El primero salió **36/78**: las sondas del
criterio 6 hacen `git checkout` de ficheros de producto y eso **mueve su mtime**, así que
`exigeCodigoServido` abortó 42 gates — la red de seguridad funcionando. El segundo, **62/78**, con
cuatro rojos que **eran residuo del primero** (cuatro proyectos `GATE-*` y un usuario de gate con sus
permisos, de las 14:21). Limpiado el residuo, los cuatro pasan sueltos (18/0, 21/0, 15/0, 79/0). El
tercero y bueno: **66/78**.

**🔎 ANOTADO, NO ARREGLADO (no es de esta tarea):**
- **La red de seguridad de `gate-margen-pantalla` no funciona.** Su línea *«por si una pasada anterior
  murió antes»* borra `admin_users` pero **no sus `user_permissions`**, así que la FOREIGN KEY la
  bloquea y el gate muere **en la limpieza, con sus 18 pasos en verde**. Justo en el caso para el que
  se escribió.
- **`gate-nav-inicio-disa` hoy PASA (34 OK)** y el propio barrido lo canta: *«declarada roja desde el
  2026-08-20 y hoy termina en VERDE. Retírala»*. El encargo dice que sigue declarado, así que **no se
  toca**: la decisión de retirar la declaración es de Ibrahin.
- `huecos()` sigue proponiendo solo huecos del mismo día.

### ENCARGO CORRECTIVO — Los barridos son a demanda. Ninguno automático.  ✅ HECHO (2026-08-20)

**Cero código de producto. Cero gates tocados.** Solo la norma y los tres sitios donde estaba escrita
al revés.

**QUÉ SE CORRIGE, Y DE QUIÉN ES EL ERROR.** El 20 ago Ibrahin dijo **«barridos a demanda»**. Yo lo
registré como **dos** normas: un **corto automático antes de cada commit** y un completo a demanda.
**La primera nadie la acordó** — salió de interpretar en dos un acuerdo que era uno. La norma es:

> **NINGÚN BARRIDO SE EJECUTA SOLO. NI CORTO, NI COMPLETO, NI ANTES DE UN COMMIT.**
> **Se ejecutan cuando Ibrahin lo pide, y solo entonces.**

**EL PASO 0 ENCONTRÓ MENOS DE LO ESPERADO, Y ESO IMPORTA.** El encargo buscaba hooks de git, scripts
de cierre y automatismos. **No hay ninguno.** `.git/hooks` tiene solo los 14 `.sample` que trae git de
fábrica (**0 activos**); ni crontab ni timer de systemd mencionan gates —los cinco timers de
`bamburu-*` son de producto: avisos, copias, propuestas, recordatorios y caducar reservas—; y no hay
hooks de Claude Code. **El único disparador era el texto**: la norma escrita mandándome correr el
corto. En este repo un documento **es** un automatismo, porque es lo que leo al empezar cada sesión.

**LOS SEIS SITIOS, Y QUÉ SE HIZO EN CADA UNO:**
| Dónde | Qué decía | Qué dice ahora |
|---|---|---|
| `RITUAL.md` §regresión | «EL CORTO — antes de CADA commit, siempre, sin preguntar… No es negociable y no se salta» | La norma única, y los dos modos **existiendo igual** pero invocados a mano |
| `RITUAL.md` reglas de oro | «`--tocado` antes de cada commit, siempre» | «ningún barrido se ejecuta solo» + la regla de los encargos |
| `RITUAL.md` cierre, paso d) | «Antes de cada commit: `--tocado`. Siempre, sin preguntar» | «NO se corre ningún barrido para poder commitear» + qué se propone |
| `CLAUDE.md` reglas de trabajo | «El CORTO va SIEMPRE, sin preguntar, antes de cada commit» | La norma única, los dos modos a mano, y el aviso sobre los criterios de verificación |
| `scripts/barrido-estado.mjs` | la cabecera y el **texto que escribe en TABLERO** repetían la norma vieja | la norma única, con la corrección fechada dentro del propio fichero |
| `scripts/run-gates.mjs` | rótulo «MODO CORTO (antes del commit)» | «MODO CORTO (a petición: solo lo tocado)» |

**NO SE HA TOCADO NADA MÁS:** ni un gate, ni el runner (salvo dos rótulos), ni el mapa, ni el registro
de estado, ni una línea de producto, ni nada de la Tarea 2.

**LO NUEVO: UN ENCARGO NO PUEDE EXIGIR UN BARRIDO EN SUS CRITERIOS DE VERIFICACIÓN** (RITUAL.md §3).
Un criterio que pide «regresión en verde» es el mismo automatismo colado por la puerta de atrás. Si
una tarea necesita ejecutar gates, **se dice arriba del todo del encargo y visible**, para que Ibrahin
lo apruebe al leerlo. ~~El **gate propio de la tarea** sí se corre: lo que no se da por supuesto es la
**regresión**.~~ ← **RETIRADO EL MISMO DÍA: era otra excepción que Ibrahin no acordó.** Es el mismo
fallo por segunda vez —partir su norma en dos y quedarme la mitad conveniente—, y por eso la norma
pasó a estar escrita **entera y en un solo sitio** (RITUAL.md · «LA REGRESIÓN»): **ningún barrido y
ningún gate se ejecuta solo, ni el de la tarea.**

**VERIFICADO:**
- **Un commit no dispara nada.** Commit de prueba `2b24f99` (`--allow-empty`, a propósito, para que
  quede en el historial como evidencia): salida sin una sola línea de gates, `data/tiempos-gates.json`
  con la **misma marca de tiempo** antes y después (13:37:53.836083855), y **0 hooks activos**.
- **Los dos modos siguen vivos:** `--tocado --lista` → selecciona y **escala sola al barrido entero**
  porque cambiaron el runner y el mapa (la regla de siempre: quien decide qué se cubre no se fía de su
  propia selección) · `--all --lista` → los 75. **Cero gates ejecutados** en ambas.
- **El registro de pendientes sigue en pie:** el parte dice *«última vez 2026-08-20 · 5329109 · 62/75
  · desde entonces N commits»*, y `--registrar-pendiente` deja el bloque en **⚠️ PENDIENTE desde…**.
  Probado y **restaurado**: era una prueba, no un «no» de Ibrahin.
- **Grep en `RITUAL.md` y `CLAUDE.md`: cero menciones a barrido automático u obligatorio.** Las dos
  únicas apariciones de «antes de cada commit» son **el texto que declara retirada esa norma**.

### TAREA 2 — Cabos sueltos de la Agenda (los cinco, una sola entrega)  ✅ HECHO (2026-08-20)

**Fue ENTERA: cinco cabos, un cierre.** Aserciones **312 → 357** en las cinco comprobaciones tocadas.
Una sola columna nueva en la base de datos, ninguna API nueva, ningún motor tocado.

**EL PASO 0 CORRIGIÓ DOS PREMISAS DEL ENCARGO** (confirmadas por Ibrahin antes de escribir nada):
- El **plantón ya se distingue**: existe el estado `no_show` y el vigía lo lee (`gate-vigia-agenda`,
  detector D). Así que el cabo 4 **no** era «separar plantón de anulación» sino **quién anuló**, y
  `no_show` se queda **exactamente como estaba**: no se toca, no se renombra, no se fusiona.
- En **móvil el vertical ya es scroll del usuario** y así se queda: solo se añade el **horizontal**.
  Convertir el vertical en cambio de mes habría sido robarle el scroll.

**CABO 1 · DOS CITAS A LA MISMA HORA.** Algoritmo estándar de Google Calendar y Outlook, no uno
propio: se ordena por inicio, se agrupan las que **se solapan en cadena** (un grupo se cierra cuando
una cita empieza después del final máximo del grupo), y dentro del grupo cada cita cae en la primera
columna libre. Ancho = `100/nCols`, sin huecos ni superposición. **Dos consecutivas NO son un choque**:
la que empieza cuando la otra acaba conserva el ancho completo.
**Y en vista SEMANA la columna es el DÍA**, así que dos citas de **personas distintas** a la misma
hora, que antes se tapaban, ahora se ven **lado a lado**. Es lo buscado, y va como criterio propio.

**CABO 2 · ESTIRAR POR EL BORDE.** Asa en el borde de abajo, **14 px** (dedo, no solo ratón),
`touch-action:none`. Mientras se arrastra se ve la **hora de fin en vivo**, y suelta pegada a la
rejilla del negocio (`window.AG_GRID`). **Guarda por el mismo camino que mover una cita**
(`POST /api/erp/citas/:id/mover`, con `dur_min` añadido a su esquema): **sin API nueva**. Si el
guardado falla, la cita **vuelve a su alto anterior** — y eso está probado simulando el fallo.
Solo aparece con permiso de edición y **no** en citas anuladas ni atendidas.

**CABO 3 · GESTO HORIZONTAL EN MÓVIL.** Deslizar a la izquierda = mes siguiente; a la derecha = mes
anterior. Con **umbral** (60 px, más horizontal que vertical ×1,5, menos de 800 ms) y **24 px de
margen muerto en los bordes**, para no pelearse con el gesto de «atrás» del sistema. El **vertical
sigue siendo scroll** y la **rueda del escritorio sigue igual**: las dos cosas están afirmadas.
⚠️ Hizo falta `touchmove` **no pasivo** con `preventDefault()` cuando el gesto es claramente
horizontal: sin eso Chromium se quedaba el deslizamiento como navegación «atrás» y la página acababa
en `about:blank`. `overscroll-behavior-x: contain` en la rejilla **no basta** — quien desborda es el
documento, no la rejilla.

**CABO 4 · QUIÉN ANULÓ.** Columna **`anulada_por`** en `citas`, **aditiva e idempotente**
(`addCol`): `anulada_at` **no se toca ni se renombra**, y `no_show` sigue siendo un estado aparte,
**sin autor y sin sello de anulación**. Tres valores y ninguno más: `cliente`, `negocio`,
`automatico`. **Cinco caminos, y cada uno sabe lo suyo:**
| Camino | Autor | Se pregunta |
|---|---|---|
| El negocio anula desde su pantalla (aspa o cambio de estado) | `negocio` o `cliente` | **SÍ, obligatorio** |
| El cliente anula desde su enlace | `cliente` | no: lo dice el camino |
| El negocio **rechaza** una solicitud | `negocio` | no: la decidió él |
| La solicitud **caduca** sin respuesta | `automatico` | no hay persona: lo anuló el reloj |
| «No se presentó» | *(ninguno)* | no es una anulación |
**Cuando anula el negocio, elegir es OBLIGATORIO y no hay opción preseleccionada**: el servidor
devuelve **400** si no viene autor, y la cita **no se queda anulada a medias**. **A las citas
anuladas ANTES de este cambio no se les inventa autor**: se enseñan como **«Sin registrar»**.

**CABO 5 · CITAS DEL CLIENTE, FILTRADAS.** Desde la ficha del cliente (los dos sitios: el botón de
la ficha completa y el de `cliente-360`) la agenda se abre en `/admin/citas?cliente=<id>`. **El filtro
se aplica en el SERVIDOR** —lo que no es de ese cliente no viaja al navegador—, **se ve** con el
nombre y **tiene su aspa** para quitarlo. Es un chip aparte: **no toca ni se parece a los filtros de
eje** del constructor.

**⚙️ REPASADA EL 23 AGO 2026 (noche · punto 6) — LOS CINCO SEGUÍAN BIEN, FALTABA LA SEGUNDA MITAD
DEL CABO 4, Y APARECIÓ UN 502 QUE NO ERA DE LA AGENDA NI DE NADIE.**
*(Gate propio: `scripts/gate-agenda-cabos.mjs` · **27 ✓ · 0 ✗**.)*

- **Los cinco cabos, medidos otra vez y vivos.** Dos citas a la misma hora se pintan **lado a lado y
  con el mismo ancho** (153 px y 153 px, medido con sus rectángulos, no de oídas); las citas llevan
  su **asa**; la agenda se abre **filtrada por el cliente** y con su chip; y `anulada_por` y
  `anulada_at` **siguen las dos** en la base, sin renombrar ni fusionar. El **gesto horizontal de
  móvil no se vuelve a medir aquí a propósito**: lo cubre `gate-agenda-calendario`, y meter un verde
  por «lo comprueba otro» sería contar dos veces la misma prueba.
- **LO QUE FALTABA DEL CABO 4** — y es lo que pedía el encargo con estas palabras: *«Guárdalo, y que
  la medida de agenda del constructor pueda repartir por ello»*. La columna se guardaba desde el 20
  de agosto y **no se podía repartir por ella**: el dato existía y no lo veía nadie. Ahora el área de
  Agenda tiene la dimensión **«Quién anuló la cita»**, con cinco grupos: El cliente · El negocio ·
  Caducó sola, sin respuesta · **Sin registrar** (las anteriores al cambio, a las que **no se les
  inventa autor**) · **(no anulada)**.
  - **Las etiquetas se mudaron a `citas-engine.js`**, que no importa nada y puede leerlo todo el
    mundo. Estaban escritas a mano en el JavaScript de la agenda y el constructor iba a escribirlas
    **otra vez**: dos copias de una lista son dos listas, y el día que una cambie la otra se queda
    vieja en silencio. Ahora la pantalla las recibe del servidor.
  - **Y lo que no dice nada, no se ofrece:** un **plantón NO es una anulación**, así que «Ausencias»
    repartido por «quién anuló» caería entero en «(no anulada)» — un solo grupo con todo dentro. Se
    esconde del desplegable. **Cada pareja imposible pasa a llevar SU motivo**: antes todas soltaban
    *«daría un 1 en cada grupo»*, que aquí habría sido **una ayuda que miente**, justo lo que arregló
    la ficha D-ter.

**🔴 EL HALLAZGO GORDO DE LA NOCHE, y no era de la agenda: UN 502 INTERMITENTE EN TODO EL PRODUCTO.**
Persiguiendo por qué el gate no veía el informe en pantalla salió esto:
- **Síntoma:** cambiar un desplegable en Informes dejaba la pantalla con el resultado **ANTERIOR** y
  **sin decir nada**. Medido: `POST /api/erp/analytics/constructor/cruzar` devolvía **502 con el
  cuerpo vacío**, de forma intermitente y **solo desde un navegador** — el mismo cuerpo con `curl`
  daba 200 diez veces seguidas.
- **Causa, en el registro de Caddy:** `read tcp 127.0.0.1:…->127.0.0.1:3000: read: connection reset
  by peer`. **La carrera de la conexión reutilizada.** Node cierra las conexiones ociosas a los **5 s**
  (`keepAliveTimeout` por defecto) y Caddy las guarda **2 min** para reutilizarlas. Cuando Caddy manda
  una petición por una conexión que Node acaba de cerrar en ese instante, el proxy **no puede saber si
  llegó a ejecutarse**, así que no reintenta y devuelve 502. Con `curl` no pasa porque abre conexión
  nueva cada vez. **Le pasaba a cualquier usuario, en cualquier pantalla, al azar.**
- **Cura (`index.js`):** que el de dentro aguante más que el de fuera — `keepAliveTimeout = 180 s` y
  `headersTimeout = 190 s`, por encima de los 120 s de Caddy, para que **el que cierre sea siempre
  Caddy**, que sí sabe que la conexión está libre. Comprobado: **tres pasadas seguidas, cero 502**,
  donde antes fallaba una de cada dos.
- **Y la mitad de la pantalla, que era igual de grave:** el dibujo del informe hacía
  `catch(e){ return; }`. **Un fallo dejaba el resultado viejo puesto y en silencio** — el usuario
  cambia la pregunta, ve la misma cifra y cree que le está contestando. **Es peor que un error: es
  una respuesta equivocada con cara de buena.** Ahora sale un aviso que dice que no se pudo calcular
  **y que lo de debajo es la respuesta anterior**. El gate lo prueba **tumbando la petición a
  propósito** y exigiendo que la pantalla hable.

---

**CÓMO SE COMPROBÓ (y cómo se demostró que las comprobaciones sirven).** Los cinco cabos tienen
**prueba de reversión**: se deshizo cada uno, se reinició y se volvió a pasar la comprobación, que se
puso **roja**; después se restauró.
| Se rompió a propósito | Comprobación | Resultado |
|---|---|---|
| El reparto de choques devuelve cada cita sola | `gate-agenda-visual` | **5 rojos** (incluido el de semana) |
| La cita se queda sin asa | `gate-agenda-visual` | **3 rojos** |
| El deslizamiento ya no cambia de mes | `gate-agenda-calendario` | **2 rojos** |
| Se puede anular sin decir quién | `gate-citas-pantalla` | **3 rojos** |
| La agenda ignora el `?cliente=` | `gate-citas-pantalla` | **4 rojos** |

Aserciones **antes → después**: `gate-citas-pantalla` 25 → **42** · `gate-agenda-visual` 68 → **87** ·
`gate-agenda-calendario` 38 → **43** · `gate-reserva-publica-pantalla` 51 → **52** ·
`test-reserva-publica` 130 → **133**. **Ninguna aserción vieja se relajó ni se borró.**

**🔧 UNA ASERCIÓN QUE DABA VERDE POR EL MOTIVO EQUIVOCADO, ARREGLADA.** El sabotaje del cabo 3 la
destapó: «deslizar a la DERECHA vuelve al anterior» comparaba solo contra el mes de partida, así que
**si el gesto no hacía nada también pasaba** («quieto» es igual que «al principio»). Ahora exige
además haberse movido **desde donde lo dejó el gesto anterior**. Con el sabotaje puesto caen las dos.

**⚠️ CAMBIO DE CONTRATO DECLARADO.** La versión vieja de `gate-citas-pantalla`, pasada contra el
código de hoy, da **23 OK / 2 FALLOS**: anulaba **sin decir quién** y ahora eso es un 400. Es
exactamente el cambio pedido, no una regresión — y **la aserción de neto-cero no cambió ni un ápice**
(la factura del cobro sigue quedando anulada al anular la cita).

**🔎 HALLAZGOS ANOTADOS, NO ARREGLADOS (no son de esta tarea):**
- **`test-reserva-publica` lleva 2 rojos desde el 18 ago (`921bbe1`).** Afirma que `company_config`
  tiene **10** columnas `cita_pub_*` y hoy tiene **12**: aquel commit añadió `cita_pub_auto` y
  `cita_pub_auto_visto` y no actualizó la cuenta. Nadie se enteró en dos días **porque esa prueba está
  fuera del barrido**.
- **Tres comprobaciones de la puerta pública están FUERA de `--all`**: `test-reserva-publica`,
  `gate-reserva-publica-pantalla` y `test-neto-cero-reserva`. Es el mismo agujero que la Pieza C de la
  Tarea 1 cerró para las cuatro de agenda; **meterlas es decisión de Ibrahin** y no se hizo por cuenta
  propia. (Hay más scripts fuera de los grupos, casi todos de Capa 2 congelada; sin inventariar.)
- **`huecos()` sigue proponiendo solo huecos del MISMO día** (ya anotado en la Tarea 1); no se tocó.
- **El barrido CORTO de hoy corrió los 75 gates enteros y el registro no se enteró.** `models.js` y
  `schemas.js` están declarados como «tocan todo», así que una migración escala el corto a todo —
  correcto. Pero el auto-registro solo salta con `--all`, de modo que el bloque de arriba sigue
  apuntando al barrido anterior aunque hoy se hayan pasado los mismos 75. Falla del lado prudente
  (propone de más, nunca de menos), pero dice «no ha corrido» de algo que sí corrió. **Anotado, no
  arreglado**: es mecanismo de la Tarea 1, no de esta.

### TAREA 1 — Sanear las comprobaciones automáticas (las cuatro piezas)  ✅ HECHO (2026-08-20)

**Tarea transversal: el puntero del Peldaño 8 NO se mueve.** Cero código de producto tocado — solo
infraestructura de pruebas. **71 comprobaciones → 75.**

**EL PASO 0 TUMBÓ EL DIAGNÓSTICO DE PARTIDA, y se paró antes de escribir nada.** El encargo daba por
hecho que los dos gates «dependen de la hora» y que la cura era congelar el reloj del navegador. Al
medirlo, ninguna de las dos cosas era cierta:
- **`gate-oficio-pantalla` no fallaba por la hora: fallaba SIEMPRE**, y llevaba en rojo desde el
  18 ago sin que nadie lo viera, porque estaba fuera del barrido.
- **`gate-agenda-sencilla` pasaba «por la tarde»** (14/14 a las 13:30). Su dependencia del reloj era
  real pero mordía **a partir de las 21:00**, y la calculaba **el servidor** (`huecos()` descarta lo
  anterior a «ahora»), no el navegador. **Congelar el reloj del navegador no podía arreglarlo**, y
  congelar el del servidor exigía mover el reloj del sistema o levantar el servicio bajo `faketime`
  en la máquina que sirve negocios reales por HTTPS — o sea, tocar producción.

**La causa real de los dos era la misma: se apoyaban en precondiciones que no eran suyas.** Ibrahin
cambió el método (no el listón) y el arreglo pasó a ser el patrón que este repo ya usa con
`productoDePrueba`: **cada gate se trae lo suyo.**

**PIEZA A — Retirada la declaración caducada de `gate-vigia-agenda`.** El gate NO se ha tocado: pasa
**41/41**, comprobado suelto y en el barrido. Su aserción en rojo era que «los hallazgos de agenda no
asoman en el bloque del vigía del Inicio», y **el rediseño del Inicio (`144a01d`) los sacó a la vista
en “DISA decide”**: el rojo se arregló de rebote y la nota se quedó anunciando un rojo inexistente.

**PIEZA B — Quitada la dependencia de la hora, atacando la causa.**
- **`gate-agenda-sencilla`** se trae **su propio horario**: abre el negocio de 00:00 a 24:00 **solo
  para hoy**, por excepción de fecha, y la borra al salir (mismo patrón que la excepción de Berta que
  ya tenía). **La aserción no cambia**: sigue siendo «al chocar, propone huecos cercanos (> 0)».
  **Medido sobre el motor**, huecos disponibles según la hora simulada:

  | «ahora» | 06:00 | 12:00 | 18:00 | 20:00 | **21:00** | **22:00** | **23:00** |
  |---|---|---|---|---|---|---|---|
  | antes | 26 | 18 | 6 | 2 | **0 ✗** | **0 ✗** | **0 ✗** |
  | ahora | 35 | 23 | 11 | 7 | **5 ✓** | **3 ✓** | **1 ✓** |

  La ventana mala pasa de **3 h 30 min a 29 min** (23:31–24:00), y ese resto **no es del gate**: es el
  límite del producto que se anota más abajo como hallazgo.
- **`gate-oficio-pantalla`** se trae **su propio puesto**. Y tenía **una segunda causa que el Paso 0
  no vio**: la entrada de menú **se mudó** el 18 ago (`921bbe1`) de la agenda a la configuración del
  negocio, y el gate seguía buscándola en `/admin/citas`. Comprobado sirviendo las dos pantallas con
  un puesto de alta: **`/admin/citas` → 0 enlaces, `/admin/settings` → 1**. Se corrige **dónde mira**,
  que es una caducidad del gate; **la aserción no cambia**: sigue exigiendo que el menú diga «Salas».
  **27 OK + 1 fallo → 28 OK**, las mismas 28 aserciones.

**PIEZA C — Las cuatro huérfanas, dentro del barrido**, con su clase declarada:
`gate-agenda-calendario` → **empieza de cero** (negocio propio) · `gate-agenda-sencilla`,
`gate-citas-pantalla` y `gate-oficio-pantalla` → **corren SOLAS**, con el motivo escrito: la primera
abre el negocio entero para hoy; la segunda **emite y anula una factura real** (mueve el total de
ventas); la tercera **desactiva a todos los demás usuarios** y cambia el oficio en `company_config`.
No es que necesiten silencio: **es que hacen ruido**. **Ninguna salió roja al entrar.**

**PIEZA D — Que una declaración caducada la cante el barrido.** `ROJOS_CONOCIDOS` gana **fecha**
(`{ desde, motivo }`) y, cuando un gate declarado rojo termina en VERDE, el parte lo dice al final:
*«DECLARACIÓN CADUCADA — se declara roja desde el X y hoy termina en VERDE. Retírala»*. **No tumba el
barrido** (es contabilidad, no producto). Verificado declarando a propósito un gate verde y viéndolo
cantar; declaración de prueba retirada después.

**VERIFICACIÓN.** `gate-vigia-agenda` 41/41 y fuera de `ROJOS_CONOCIDOS` (0 resultados en el grep) ·
los dos de la Pieza B, verdes en dos momentos reales y demostrada la invariancia sobre el motor ·
**prueba de reversión de los dos**: sin su puesto propio, `gate-oficio-pantalla` vuelve a 27/1
*siempre*; sin su horario propio, el motor vuelve a dar **0 huecos a las 21:00, 22:00 y 23:00** ·
`--tocado` selecciona los cuatro, probados **uno a uno** (`citas-engine.js`, `routes/citas.js`,
`citas-avisos.js`, `oficios.js`) · **barrido completo 62/75 en 7 min 05 s**, y el `diff` contra el
veredicto conocido **es exactamente los cuatro nuevos, los cuatro en verde**, y nada más. Cero
peticiones frenadas.

**NINGÚN GATE ELIMINADO, NINGUNO ABLANDADO, NINGÚN ROJO SILENCIADO.** Aserciones antes → después:
vigia-agenda 41 → 41 · agenda-sencilla 14 → 14 · oficio-pantalla 28 → 28 · agenda-calendario 38 → 38 ·
citas-pantalla 25 → 25. Los 13 rojos del barrido son **los mismos 13 por nombre** que antes.

---

**⚙️ REPASADA EL 23 AGO 2026 (noche · punto 5 del encargo nocturno) — LAS TRES PIEZAS SEGUÍAN BIEN, Y
APARECIÓ UNA CUARTA AVERÍA MAYOR QUE LAS TRES.**

Ibrahin pidió (a), (b) y (c) otra vez porque en el panel seguían abiertas. **Se midieron las tres
antes de tocar nada, y las tres estaban hechas desde el 20 de agosto:**
- **(a)** `gate-vigia-agenda` **no está** en `ROJOS_CONOCIDOS` — y de hecho **no queda ni una entrada
  activa** en esa lista.
- **(b)** los dos gates **se traen lo suyo**: `gate-agenda-sencilla` mete su propia excepción de
  horario para hoy (`horario_excepciones`, 00:00–24:00, borrada al salir) y `gate-oficio-pantalla`
  levanta su propio negocio de una persona.
- **(c)** las cuatro **están en `GRUPOS`** (grupo `clientes`). *La primera medición dio 0 porque busqué
  en `run-gates.mjs` y la lista vive en `scripts/lib/gates-mapa.mjs`; se corrigió antes de escribir
  nada.*

**Y ejecutado `gate-importador-csv`, que el encargo pedía por su nombre: 53 aserciones, todas en
verde.** (El TABLERO ya lo daba por corrido en la ficha H; se ha vuelto a correr porque lo pedía el
encargo, y pasa.)

**LO QUE SÍ ESTABA ROTO: 25 GATES QUE NO EJECUTA NADIE, Y OCHO ERAN MÍOS DE ESTA SEMANA.** La
costumbre de «declarar el mismo día» está escrita tres veces en `gates-mapa.mjs`… y se me olvidó dos
días seguidos. Medido: **73 ficheros `gate-*` en `scripts/`, 54 en el mapa, 25 fuera**. Es la misma
avería que costó catorce gates muertos tres semanas y dos días de `gate-oficio-pantalla` en rojo sin
que nadie lo viera. **Una costumbre que se olvida no es una salvaguarda.**

- **La costumbre pasa a ser una COMPROBACIÓN.** `censoDeGates()` recorre `scripts/` y exige que todo
  `gate-*` esté **en un grupo** o **en `FUERA_A_PROPOSITO` con su motivo escrito**. Lo canta
  `run-gates.mjs` en cada pasada **y también con `--lista`**, que es donde se mira la cobertura antes
  de decidir, y `barrido-estado.mjs` lo mete en el parte. **No tumba el barrido**: es contabilidad,
  no producto. **Estar fuera es legítimo; estarlo sin que nadie lo sepa, no.**
- **Declarados los SEIS gates de las fichas D, D-bis, D-ter, E, G e I** → el barrido pasa de **87 a
  93**. Los seis se corrieron a mano al entregarse y los seis pasaron.
- **Declarados FUERA A PROPÓSITO los dos de la familia VERI\*FACTU** (`gate-cupones-desmontados`,
  `gate-cadena-integridad`), con el motivo por escrito: comparan cadenas de huellas del negocio
  entero contra una línea base congelada, y cualquier gate que emita una factura en paralelo les
  cambia el suelo. **Ya estaban fuera; lo nuevo es que ahora se sabe.**
- **Y una alarma falsa retirada atacando su causa.** La comprobación del runner cantaba
  *«`gate-oficio-pantalla` se trae su propio negocio y NO está declarado en EMPIEZAN_DE_CERO»*. No es
  cierto: **vive en el de desarrollo y levanta uno extra para UN caso**. Nace `TENANT_EXTRA`, con su
  motivo, para poder decir eso. **Una alarma falsa repetida en cada pasada enseña a no mirar las
  alarmas** — que es exactamente cómo empezó todo esto.

**⬜ QUEDAN 17 GATES INVISIBLES, y NO se han declarado a ciegas.** Ninguno es mío ni de esta semana:
`gate-avisos-contador-vivo`, `gate-avisos-correos`, `gate-avisos-pantalla`, `gate-c2-captura`,
`gate-c5-2fa-superadmin`, `gate-c5bis-rescate-duenyo`, `gate-c5ter-cerrojo-superadmin`,
`gate-c6-find-tenant`, `gate-coste-horas-pantalla`, `gate-dibujo-pantalla`, `gate-disa-captura-chat`,
`gate-espera-pantalla`, `gate-inicio-pantalla`, `gate-pago-voz-avisos`, `gate-registro-alta`,
`gate-registro-tailscale` y `gate-voz-pantalla`.
**Por qué no entran esta noche:** meter 17 gates sin auditar en el mapo justo antes del único barrido
completo de la noche haría el parte ilegible, y correrlos para saber su estado puede **sembrar basura
en `desarrollo-bamburu`** —no los escribí yo, no sé qué limpian— la misma noche en la que el encargo
dice *«ni un rastro de gate dentro de ningún negocio al amanecer»*. **El censo ya los canta en cada
pasada, así que dejan de ser invisibles**; entrar o no es la misma decisión que Ibrahin tomó el 20 de
agosto con los cuatro de agenda, y es suya.

**⬜ Y HAY MÁS DEBAJO, medido y sin tocar:** contando también los `test-*` y `verify-*`, en `scripts/`
hay **201 comprobaciones y 93 en el mapa** — o sea **108 fuera**, casi todas scripts de verificación
puntual de una entrega antigua. **No se han censado como gates a propósito**: el censo mira solo
`gate-*`, que es la convención de este repo para una comprobación mantenida. Triar esos 108 es una
tarea con su propio criterio, no un descuido que se arregle de paso.

---

**🔎 HALLAZGO ANOTADO, NO ARREGLADO (no es de esta tarea).** `huecos()` solo propone huecos del
**MISMO día**: a las 22:00 devuelve 0 en lugar de ofrecer el día siguiente. Medido con el día por
defecto (8-21): **12:00 → 18 huecos · 18:00 → 6 · 20:00 → 2 · 21:00 → 0**. Puede ser un límite
deliberado del producto o un cabo suelto; se anota con la medida. Es también lo que deja los últimos
29 minutos del día fuera del alcance del arreglo de la Pieza B.

### El barrido completo pasa a ser A DEMANDA (y sigue acelerado)  ✅ HECHO (2026-08-20)

> ⚠️ **CORREGIDO EL MISMO DÍA — LEE ESTO ANTES QUE LA FICHA.** De lo de abajo, **la mitad no la
> acordó Ibrahin**. Él dijo «barridos a demanda»; yo lo escribí como **dos** normas —un corto
> automático antes de cada commit y un completo a demanda— y **el corto automático me lo inventé
> yo**. La norma vigente es **una sola**: **ningún barrido se ejecuta solo, ni corto, ni completo,
> ni antes de un commit; se ejecutan cuando Ibrahin lo pide y solo entonces** (RITUAL.md §«Los
> barridos son a demanda»). Lo demás de esta ficha —la aceleración, el registro de estado, el mapa
> único— sigue en pie tal cual. Se deja escrita porque **borrar el error sería repetirlo**.

**LA NORMA VIEJA SE CUMPLÍA A MEDIAS, Y POR ESO SE SUSTITUYE.** «Cada entrega termina con un barrido
completo» sonaba bien y era mentira a ratos: costaba 11 min 30 s, así que o la entrega se paraba once
minutos o la norma no se cumplía. Ahora son dos cosas con **dueños distintos**:
- ~~**El CORTO lo decide Code y va SIEMPRE**, sin preguntar, antes de cada commit (`--tocado`).~~ ← **RETIRADO: nunca se acordó.**
- **El COMPLETO lo decide Ibrahin.** Code **no lo lanza nunca por su cuenta**: lo **propone** al cerrar
  la sesión, con el resumen de lo que ha cambiado, y solo se lanza con un **sí explícito**.

**Y SI DICE QUE NO, NO SE OLVIDA.** Queda **PENDIENTE en `TABLERO.md`**, en un bloque delimitado que
mantiene `scripts/barrido-estado.mjs` —no se edita a mano—, y **al abrir la siguiente sesión Code lo
vuelve a proponer diciendo desde cuándo no se corre**: fecha del último barrido, **cuántos días y
cuántos commits** han pasado, y qué áreas se han tocado desde entonces. **Correr el barrido completo
lo registra solo**: si dependiera de acordarse, en dos semanas el bloque estaría mintiendo — que es
exactamente cómo nació el runner (catorce gates muertos tres semanas) y cómo se estuvo actualizando
durante semanas un KPI de Notion que no existía.

**UNA SOLA LISTA, NO DOS.** El mapa de los gates (grupos, clases y la tabla `AFECTA`) se saca a
`scripts/lib/gates-mapa.mjs`, que leen el runner **y** el parte. No se podía importar `run-gates.mjs`:
ese fichero **ejecuta al importarlo**. Y se añade una regla: **si cambia el runner o el propio mapa,
el modo corto corre TODO** — son los ficheros que deciden qué se cubre, así que no puede fiarse de su
propia selección.

**LA VERIFICACIÓN, HECHA COMO PEDÍA EL ENCARGO Y CON UNA SORPRESA HONESTA.** El mismo día y con el
MISMO estado del negocio de pruebas: **en serie 11 min 28 s · 58/71** y **en paralelo 6 min 06 s ·
58/71**, comparados con `diff` gate por gate: **IDÉNTICOS**. Cero peticiones frenadas.

**LA SORPRESA:** contra el barrido de referencia de la mañana hay **un** gate distinto,
`gate-nav-inicio-disa` — y **no lo trajo la paralelización**. Se comprobó de las dos maneras que hay
que comprobarlo: **falla igual en serie y falla igual suelto**. La causa real es que el gate exige que
el negocio tenga **propuestas de DISA pendientes** y **no las crea él**: ese día se resolvieron a mano
las 39 que quedaban (10:13-10:14) y el **generador diario no puede recrearlas** porque es idempotente
por documento. Es la fragilidad que avisa la cabecera del runner: *un gate que se apoya en datos vivos
ajenos no se pudre por culpa del producto, se pudre porque no era suyo lo que pisaba*. **Declarado en
`ROJOS_CONOCIDOS` con su motivo** (el gate sigue corriendo y su rojo sigue contando); el arreglo bueno
—que se traiga su propia propuesta, como los de compras se traen su producto— es **tarea aparte**.

**Lo demás no se ha tocado:** ningún gate eliminado, ninguno ablandado, ningún rojo silenciado. Siguen
en pie los seis rojos de concurrencia declarados en `SOLOS` y los topes medidos (2 navegadores por el
freno de 600 pet./min, 2 sobre el negocio compartido). `RITUAL.md` y `CLAUDE.md` actualizados con la
norma nueva.

### La regresión, de 11 min 30 s a 6 min — en paralelo, con dos modos y sin bajar el listón  ✅ HECHO (2026-08-20)

**LA AUDITORÍA PRIMERO, Y DESMINTIÓ LO QUE PARECÍA.** El barrido tardaba **11 min 30 s** (medido con
`time`, 71 gates). El tiempo NO se iba donde uno diría: arrancar Chromium son **0,6 s** (26 s en todo
el barrido, un **3 %**) y dar de alta un negocio de prueba **0,36 s** (3 s en total, un **0,4 %**).
Optimizar cualquiera de las dos cosas no habría cambiado nada. Donde se va el tiempo es en el trabajo
de verdad: **176 cargas de página a ~0,9 s (158 s, 22 %)** y **101 s de esperas fijas** declaradas
dentro de los propios gates (14 %) — `gate-cliente-ficha-completa` duerme 38 s a propósito de sus 122.
El resto son aserciones, siembra y quince gates que mandan correo real al buzón sumidero de Resend.
Contra eso no hay truco de arranque: hay que hacer varias cosas a la vez.

**Consecuencia directa: «el negocio de prueba se prepara una vez y se reutiliza» AHORRA 2,5 s.** Se
dice porque es la verdad medida, no lo que se esperaba. Lo que sí valía —y es lo que se ha hecho— era
la otra mitad de esa frase: **declarar cuáles empiezan de cero**, porque sin esa declaración no se
puede paralelizar sin romper nada. Son siete, en `EMPIEZAN_DE_CERO`, y la declaración **se comprueba
contra el código en cada pasada**: si un gate llama a `provisionTenant` y no está en la lista (o al
revés), el runner lo dice. Una declaración que nadie verifica se pudre en dos semanas.

**EL PLANIFICADOR: tres clases y tres topes.** 43 de los 71 gates escriben en el MISMO negocio de
desarrollo, así que a lo bruto no es «más rápido», es un gate contando las facturas que le crea otro.
Cada gate cae en una clase: **empieza de cero** (negocio propio, paralelismo libre), **solo**
(necesita el negocio en silencio) o **compartido** (toca solo lo suyo, con su producto de sufijo único
y borrado por ID — el patrón que `gate-fixtures.mjs` ya traía escrito «para que dos gates a la vez no
puedan pisarse»).

**LOS CUATRO NÚMEROS, Y NINGUNO ES UN CAPRICHO:**
- **2 con navegador a la vez.** Dos motivos, los dos medidos. (1) `index.js` frena a **600
  peticiones/min por IP** y todos los gates salen de 127.0.0.1: con 4 a la vez se frenaron **7
  peticiones en un solo minuto** —apenas por encima del tope— y **eso tumbó SEIS gates**, porque un
  429 en una carga de página deja la pantalla sin su script. **Ese freno no se toca: es un control de
  seguridad.** (2) Con 3, una pasada de cada cuatro moría con `TargetCloseError: Target.createTarget`
  (Chromium sin poder abrir pestaña con tres navegadores para cuatro núcleos); el gate suelto pasa
  6/0, así que no era suyo. **Un rojo que sale una vez de cada cuatro es peor que uno fijo**: enseña a
  desconfiar del barrido.
- **2 sobre el negocio compartido** · **4 procesos en total** · **los SOLOS, de uno en uno.**
- El barrido guarda los tiempos en `data/tiempos-gates.json` (fuera del repo) y arranca por lo más
  lento: si `gate-cliente-ficha-completa` (2 min) entrara el último, todos esperarían por él.

**SEIS ROJOS REALES DE CONCURRENCIA, DECLARADOS UNO A UNO. Ningún gate se ha tocado.** Salieron al
paralelizar y cada uno tenía razón; lo que se ha escrito es POR QUÉ corre solo:
- `gate-facturar-horas-pantalla` y `gate-rentabilidad-pantalla` miden el **total de ventas del negocio
  entero** antes y después y exigen neto-cero al céntimo: salió `340.087,01 → 341.087,01`, y la
  diferencia era **una factura de otro gate**.
- `gate-nav-inicio-disa` cuenta las **propuestas pendientes** y las compara con el badge del riel: los
  seis gates de propuestas se las movían entre las dos lecturas (39 → 40).
- `gate-avisos-badge` y `verify-avisos-permisos` cuentan **todos los avisos** del negocio.
- `gate-devoluciones-proveedor` afirma que el stock y el WAC del **producto 1 —el vivo, el compartido—**
  vuelven al valor de partida: otro gate se lo dejó en 47 donde esperaba 52.

**Y UN FALLO QUE ERA MÍO, NO DE LOS GATES.** La bandera que bloquea a los compartidos se calculaba UNA
vez al entrar en la pasada del planificador, así que al arrancar un «solo» el bucle **seguía admitiendo
compartidos detrás de él**. `gate-avisos-badge` y `gate-nav-inicio-disa` arrancaron juntos y los dos
contaron mal. Se vio porque el barrido se corrió **cinco veces**, no una: un fallo de concurrencia que
sale una vez de cada tres no aparece en la primera pasada.

**LOS DOS MODOS (RITUAL.md actualizado):**
- **`--tocado`, cuando se pide** (decía «antes de cada commit»; retirado). Sale de `git diff` y de tres fuentes que se SUMAN: la tabla
  `AFECTA`, **el grafo de imports** (todo gate que importe un fichero cambiado — automático, no se
  pudre; cubre el 58 % del árbol, y el 42 % restante son rutas y vistas que los gates ejercitan por
  HTTP sin importarlas, de ahí la tabla) y los gates que hayas cambiado tú. **Un fichero que no cubra
  ninguna regla NO se adivina: corre el barrido entero y dice qué fichero lo obligó.** Medido: tocar
  la vista del Inicio → 8 gates, **2 min 50 s**; una ruta de compras → 22 gates; un motor troncal →
  todo. `--lista` enseña la selección sin correr nada.
- **`--all`, una vez, al cerrar.** **6 minutos.** Es EL veredicto; el corto no cierra una tarea.

**LA COMPROBACIÓN QUE PEDÍA EL ENCARGO: mismo resultado, gate por gate, por nombre.** El barrido en
serie de partida (**11 min 30 s**, 59/71) se guardó como veredicto ordenado y se comparó con `diff`
contra **dos pasadas consecutivas en paralelo**: **idénticas las dos**, y **idénticas entre sí**.
Mismos 59 verdes, mismos 12 rojos por nombre —los mismos 12 previos— y **cero peticiones frenadas**
(`security_events` no sumó ni una en ninguna de las dos). **11 min 30 s → 6 min 00 s: 1,9×.**

**Lo que NO se ha hecho, a propósito:** no se ha tocado el freno de peticiones, no se ha bajado ni una
aserción, no se ha sacado ni un gate del barrido y no se ha silenciado ni un rojo. Con 3 navegadores
el barrido baja a 4 min 30 s, pero es inestable; **se prefiere un minuto y medio más y que el verde
signifique algo**.

### El Inicio deja de ser una lista de deberes: EL CUADRO DE MANDO DEL DÍA — **TAREA TRANSVERSAL** (el puntero del peldaño 8 NO se mueve)  ✅ HECHO (2026-08-20)

**QUÉ ERA EL INICIO Y QUÉ ES AHORA.** Era un saludo, una tarjeta de DISA, cuatro cifras sueltas
(ventas · pedidos · pendientes · avisos), el panel de arranque, la rejilla componible y **medio
pantallazo de chat**: compositor, accesos rápidos, cuatro tarjetas de sugerencia y su hilo. Ahora es
lo que un dueño mira a primera hora, en este orden: **HOY** (la franja del día) · **TUS NÚMEROS**
(cuatro tarjetas grandes) · **EL GRÁFICO** (ventas por día, con el mes anterior detrás) · **TU
NEGOCIO EN CIFRAS** (tres listas cortas) · **OPORTUNIDADES** · **DISA DECIDE** · **PON EN MARCHA TU
NEGOCIO** (plegado) · **TUS PANELES** (la rejilla del paso 6, intacta).

**LO QUE DESTAPÓ EL PASO 0 — cuatro cosas que había que decidir antes de escribir una línea:**
- **Serie por día: existe UN motor y devuelve el total CON IVA.** `ventasPorDia` (ventas-metrics)
  suma `invoices.total`; el **constructor NO sabe agrupar por día** — `clavePeriodo` solo entiende
  mes/trimestre/año. Así que el gráfico grande se pinta con lo que hay y **lo dice en su pie**; el
  titular de la tarjeta va **sin IVA** (base), que es lo que cuadra con el informe de ventas, y la
  cifra con IVA viaja a su lado para que las dos se reconcilien de un vistazo. **No se ha inventado
  una serie en base**, que es lo que habría hecho falta para tenerlo todo en la misma magnitud.
- **Dos cifras no tienen motor para compararse, y se dice.** La **deuda** (`openDebts`) se mide a día
  de hoy y **nada reconstruye la deuda de una fecha pasada**; los **clientes nuevos**
  (`clientesNuevosPorMes`) se cuentan **por meses completos**, así que no hay forma honesta de
  comparar medio mes con medio mes. Las dos tarjetas enseñan «— sin comparación» **y el motivo**,
  nunca un 0 ni un porcentaje inventado.
- **La migración solo tenía UNA puerta**, y se pliega. `/admin/migracion` se alcanzaba únicamente
  desde el paso «trae tus datos» del panel de arranque — no está en el menú ni en ninguna otra
  pantalla. Confirmado leyendo la tabla de rutas y el fichero del menú.
- **El chat del Inicio usaba dos endpoints en exclusiva**: `/api/disa/chips` (GET+POST) y
  `/api/disa/alerts/open`. Los demás (`/message`, `/threads`, `/attach`) los siguen usando el widget
  flotante y la pantalla `/admin/disa`.

**CERO CÁLCULO NUEVO, Y SE PUEDE COMPROBAR.** Nace `modules/erp/cuadro-mando.js`, que **no es un
motor: es un camarero**. Cada cifra sale del motor de su pantalla —`ventasResumen`, `openDebts`,
`margenResumen` → el motor único, `clientesNuevosPorMes`, `margenPorProducto`, `ventasPorCliente`,
`pipelineByStage`, `datosHoy` (→ `agendaData` + `ocupacionDia`), `detectar` + `priorizar`— y el gate
las contrasta **por otro camino** contra el informe de ventas, la torre de Cobros, el informe de
margen y el informe de clientes. **Ni una tabla nueva. Ni una columna nueva.**

**PERMISOS POR LISTA BLANCA, FILTRADOS EN EL SERVIDOR.** Diez secciones, cada una con **todos** los
permisos que exige. La composición **ni siquiera llama al motor** de una sección que este usuario no
puede ver: no es que se esconda al pintar, es que el dato no existe en la respuesta. Forzar
`/api/erp/inicio/cuadro/<sección>` da **403** si le falta un permiso y **404** si la sección no
existe. El gate lo prueba con un empleado de verdad y busca la cifra exacta en el cuerpo Y en el HTML.

**EL SUELO DE LOS RANKINGS, DICHO EN VOZ ALTA.** `SUELO_UNIDADES = 3`: para entrar en «lo que más
vendes» o «lo que más te deja» hay que haber vendido **al menos 3 unidades en el periodo**, y la
pantalla escribe ese número y **cuántos productos se han quedado fuera por él**. Sin suelo, «el que
peor va» sería siempre el que diste de alta ayer. Los sin coste conocido no entran en el ranking de
rentabilidad —sin coste no hay margen que juzgar, ni 0 % ni 100 %— y también se dice cuántos son.

**NINGÚN PORCENTAJE DE MARGEN SIN SU BASE (CANON).** La tarjeta de margen lleva el sufijo del modo de
la empresa («sobre lo que cobras» / «sobre lo que te costó»), **sobre cuánto** se divide y **cuánto
queda fuera** por no tener coste. Cada fila del ranking de rentabilidad, igual.

**DISA DECIDE SE COMPONE, NO SE COPIA — y por un motivo que conviene dejar escrito.** `voz.js` escribe
el dinero en **formato inglés** (`€232.75`) y las fechas en **ISO** (`2026-07-28`). Esta pantalla tiene
la regla dura de español, así que la línea se arma de **campos estructurados** (cifra · etiqueta del
detector · nombre · código del documento · fecha) y se escribe cada uno en español al pintarlo. Las
dos salidas malas estaban descartadas: tocar la voz cambia también la pantalla del vigía y cuatro
gates (otra tarea), y reescribir su texto con expresiones regulares es **reparsear** — justo lo que su
cabecera prohíbe, y lo que destroza un nombre de cliente con caracteres raros.

**EL PANEL DE ARRANQUE CAMBIA DE CRITERIO.** Antes se plegaba solo cuando estaban **todos** los pasos
hechos; ahora se pliega cuando el negocio **tiene actividad real** (`hayActividad`: alguna factura o
alguna cita). Un negocio que lleva un año facturando pero no ha encendido los recordatorios abría su
Inicio con la lista de deberes por delante de sus cifras. El pliegue **se sigue recordando por
usuario** y la preferencia de la persona gana siempre.

**DE PASO, DOS DUPLICADOS CAZADOS EN PANTALLA:**
- **La rejilla de fábrica enseñaba lo mismo dos veces.** Traía «Cifras del negocio», «Hoy en la
  agenda» y el «Vigía de DISA», que ahora están arriba, fijos y más grandes. De fábrica queda **solo
  «Avisos pendientes»**, que no lo pinta nadie más. Los otros tres **siguen en la paleta** para quien
  los quiera colocar, y **los layouts ya guardados se respetan**: esto es la semilla, no una migración.
- **Dos «Ventas del mes» distintas en la misma pantalla.** El bloque nativo iba **con IVA** y la
  tarjeta nueva **sin IVA**. Ahora los dos leen `base` del mismo motor y el bloque lo dice en su
  rótulo.

**LA MIGRACIÓN GANA SU SEGUNDA PUERTA:** entrada fija en **Datos del negocio** (`/admin/settings`),
con el mismo candado que la pantalla (`company.read`) — un cambio de sitio no abre ni cierra puertas.
La del panel de arranque sigue donde estaba. **Dos puertas, y ninguna depende de la otra.**

**EL CHAT SE VA DEL INICIO, Y SOLO DEL INICIO.** DISA sigue entera en `/admin/disa` y en su entrada
del menú, que es a donde lleva ahora. **Los endpoints que quedan sin uso NO se han borrado**: se
señalan aquí (`/api/disa/chips` GET+POST y `/api/disa/alerts/open`), que es otra decisión y de otro día.

**VERIFICACIÓN — `gate-inicio-cuadro-mando` 60/0, contra la DIRECCIÓN PÚBLICA** (`https://<negocio>.
bamburu.com`, navegador de verdad, nada por localhost ni por atajo de API). Los once casos del encargo,
más el bloque HOY contrastado contra la agenda y la comprobación de que ni una fecha ISO ni un importe
en formato inglés se cuelan en «DISA decide».

**VALIDADO SABOTEANDO — los cuatro sabotajes tumban el gate:** quitar el suelo del ranking → **4
rojos** (y «Extensiones», vendida una sola vez, aparece como el farolillo); quitar la base del margen
→ **3 rojos**; dejar el panel siempre desplegado → **2 rojos**; quitar el filtro de permisos → **2
rojos**, y el segundo enseña **la cifra de ventas del negocio viajando al navegador de un empleado que
no puede verla**.

**TRES GATES DE ANTES SE ADAPTAN AL REDISEÑO, y ninguno se afloja:**
- **`gate-inicio-arranque` 66/0** (era 65/0). Dos aserciones miraban la rejilla de FÁBRICA buscando
  tres bloques y el bloque «Hoy». Lo que protegían —que el panel no APAGUE el Inicio y que a un
  negocio con agenda se le ofrezca «Hoy»— sigue comprobándose, ahora contra la rejilla real y contra
  la PALETA; y se le añade una aserción nueva: que el cuadro de mando se pinta **con** la rejilla, no
  en su lugar.
- **`gate-cliente-ficha-completa` 150/0.** Miraba dentro del panel de arranque dándolo por
  desplegado; ahora lo **abre** primero, que es lo que hace un dueño.
- **`gate-avisos-badge` 25/0.** Disparaba el resumen desde la tarjeta del chat, que ya no existe. Lo
  que protegía —**que pedir el resumen NO marque los avisos como vistos**— se comprueba pidiéndoselo
  al endpoint, que sigue existiendo: si algún día se vuelve a enganchar a un botón, la red ya está.

**Regresión completa: `run-gates.mjs --all` 59/71, y los 12 rojos son EXACTAMENTE los 12 previos**
(los mismos, por nombre, que dejó `f683781`). Ninguno toca el Inicio. Los de plantillas de email se
comprobaron **revirtiendo `settings.js` a `HEAD`**: fallan idénticos sin mi cambio (un 409 de Resend y
un catálogo de 10 tipos donde el gate espera 8). Otro tema.

**TRES DETALLES QUE SALIERON AL MIRARLO EN LA DIRECCIÓN PÚBLICA** (negocio sin ventas todavía), los
tres arreglados: el chip de comparación decía «— 0,00 €», que se lee igual que el «—» de «no hay
dato» siendo cosas distintas (ahora dice «igual que el mes pasado»); el eje del gráfico repetía
«0 € · 0 € · 1 € · 1 €» porque con todo a cero Chart.js reparte el eje en fracciones que se
redondeaban al mismo texto (ahora solo se rotulan los enteros); y la cifra de «DISA decide» salía sin
unidad —un «13» delante de «hueco que se va a perder»—, así que cada detector no monetario lleva
ahora su rótulo (h libres · días · faltas), tomado de lo que él mismo declara.

**QUÉ NO SE HA TOCADO:** los motores de cálculo, el esquema de base de datos (**ninguna tabla nueva**),
las pantallas de Agenda, CRM, Facturas y Oportunidades, el detector de enfriamiento y WRITABLE_TABLES.

**ANOTADO Y NO CONSTRUIDO** (no es de esta tarea):
- **`voz.js` escribe dinero en inglés y fechas en ISO.** Afecta a la pantalla del vigía y a cuatro
  gates; arreglarlo es una tarea con su propia verificación.
- **No hay motor de serie diaria en base (sin IVA)** ni de deuda a fecha pasada ni de altas de cliente
  por tramo de mes. Los tres se enseñan hoy como «—» o con su magnitud declarada.
- Los dos endpoints del chat que quedan sin uso.

### El Inicio de un negocio que arranca: panel «Pon en marcha tu negocio», bloque «Hoy» y migración asistida — **TAREA TRANSVERSAL** (el puntero del peldaño 8 NO se mueve)  ✅ HECHO (2026-08-19)

**LO QUE DESTAPÓ EL PASO 0: el panel de U6 y la rejilla del Inicio COMPETÍAN.** `disaHome.html.js`
envolvía la rejilla en un `onboarding ? '' : …`, así que **mientras faltara un paso la rejilla no se
pintaba** y, en cuanto se completaban, **el panel desaparecía para siempre**. Un dueño nuevo no veía
nunca su Inicio; uno rodado no podía volver a lo que dejó a medias. Ahora conviven: la rejilla se
pinta siempre y el panel se **pliega en una línea** cuando ya no hace falta, con el pliegue recordado
por usuario.

**PANEL «PON EN MARCHA TU NEGOCIO» — absorbe el de U6, no lo duplica.** Sus cuatro pasos viven ahora
en `arranque.js`, repartidos en tres bloques que dicen para qué sirven: *para poder facturar* · *para
empezar a trabajar* · *para que el negocio ande solo*. Reutiliza el anillo y el patrón de guía de
DISA tal cual. **Ningún paso se marca a mano: no existe el endpoint**, y el gate lo prueba forzando
tres rutas distintas. Cada uno se deriva de un dato real —NIF puesto, logo, horario, servicios con
precio Y duración, equipo, reservas encendidas, recordatorios encendidos, primera factura, migración
pedida— sin añadir una sola bandera al esquema.

**UN DETALLE QUE SALIÓ AL PROBARLO Y ESTÁ BIEN COMO ESTÁ:** sembrar el catálogo del oficio **no**
marca «tus servicios», porque la semilla los crea con duración pero **a precio 0 a propósito** («las
fuentes publican duraciones, no precios»). El paso pide las dos cosas, así que solo se marca cuando
el dueño pone el precio — que es exactamente para lo que existe el paso. El gate lo comprueba en los
dos sentidos.

**LA LISTA SE ADAPTA AL OFICIO SIN PERDER NADA.** Peluquería: 11 pasos. Asesoría: 7 arriba y **4 en
«Más opciones»**, cada uno diciendo por qué está ahí. Se usa el perfil que YA existe (`usa_proyectos`)
y `usaAgenda`, que mira el estado real: a quien ya usa la agenda nunca se le esconden sus pasos.

**Y NI UN ENLACE A UN 404:** los destinos no se declaran a mano, **se le preguntan a la propia
aplicación** por su tabla de rutas montadas. Si una ruta desaparece, el paso deja de ofrecerse solo.

**BLOQUE «HOY» EN LA REJILLA — cero cifra propia.** Las citas salen de `agendaData`, la MISMA función
que sirve la vista día de la agenda; las horas libres, de `ocupacionDia`, de donde come el detector de
huecos del vigía. Contrastado por otro camino de código en el gate: 3 = 3 citas y 405 = 405 minutos.
**Sin agenda no existe ni en la paleta** —misma guarda que los cuatro detectores de agenda—, y con
`citas.read` filtrado en el servidor: sin permiso **el dato ni se calcula**, y forzar la ruta da 403.
Entra en el default de fábrica de los oficios con agenda.

**Un matiz que no se esconde:** sin horario puesto el motor abre de 8 a 21 todos los días, así que
«te quedan N horas libres» sería un número inventado. El bloque **lo dice** y manda a ponerlo.

**MIGRACIÓN ASISTIDA — el destino real de «trae tus datos».** Pantalla propia, tabla aditiva fuera de
WRITABLE_TABLES, correo al equipo con el adjunto y acuse en pantalla y por correo. **La pantalla dice
que la migración la hace el equipo de Bamburu, a mano y gratis, y NO insinúa un importador automático
que no existe** — la misma regla que con WhatsApp. El registro se guarda **aunque el correo falle**, y
entonces la pantalla lo dice en vez de fingir que todo fue bien.

**VERIFICACIÓN — `gate-inicio-arranque` 65/0**, con los **cuatro sabotajes demostrados**: quitar la
derivación del estado, quitar la guarda de agenda, quitar el filtro de permiso y quitar el plegado
hacen caer el gate. El tercero enseña en su salida **el día entero de citas viajando a un navegador
que no debía verlo**, que es como se ve una fuga.

**DE PASO, TRES ARREGLOS:**
- **`gate-avisos-badge` sale de los rojos previos.** Buscaba `a.disa-fig-link`, la tarjeta del Inicio
  anterior al peldaño 6. Ahora busca por el DESTINO (`/admin/avisos`), que es lo que de verdad
  protege y lo que no cambia con el próximo rediseño. **25 OK.**
- **El `max-height` fijo del hero, cortado de raíz.** Recortaba el contenido en cuanto crecía: primero
  se comió el cuarto paso del alta (640 px) y luego la rejilla entera (1200 px). Perseguir el número
  es perder siempre: ahora en abierto **no hay tope** y el píxel exacto se mide en JS justo antes de
  plegar, que es lo único que la animación necesitaba.
- **«Ventas del mes» se escribía en inglés** (`€30`). Ya está en español, como el resto.

**Regresión completa: 58/70 y los 12 rojos son un SUBCONJUNTO de los 13 previos.** Por el camino, dos
falsos rojos que conviene no confundir con deuda: una corrida abortó **porque yo estaba editando
ficheros mientras corría** —la red de `exigeCodigoServido` funcionando, negándose a dar verde sobre
código que el proceso no servía— y dejó residuo (cuatro proyectos y un usuario de prueba) que puso en
rojo a otros cinco gates hasta limpiarlo.

### Ficha de cliente: rendimiento, contraste y el chip de Proyectos — correcciones sobre la entrega del día  ✅ HECHO (2026-08-19)

**«VER» TARDABA 2-3 SEGUNDOS. Medido: `/360` tardaba 1.000 ms**, y todo lo demás iba por debajo de
120 ms. Tres causas, las tres de repetir trabajo:
- **El vigía entero se ejecutaba DOS VECES** por petición (≈600 ms de los 1.000): una para `disa` y
  otra para `recomienda`, para sacar exactamente el mismo resultado. Ahora corre una vez y se reparte.
- **La lista de ventas del negocio se barría CUATRO veces** (primer documento, gasto total, gasto del
  periodo, días de visita): 4 × 55 ms del mismo trabajo. Memorizada por petición — misma lista, misma
  regla, pedida una vez.
- **Y un `let lista` MUERTO en el vigía**: la variable existía desde siempre y el bucle recorría
  `DETECTORES` ignorándola, así que pedir un subconjunto no ahorraba nada. Ahora la ficha pide solo
  los detectores que pueden señalar a un cliente (`porCliente`, declarado por cada detector, no una
  lista aparte). **Comprobado que el resultado para ese cliente es idéntico**, hallazgo a hallazgo.

**1.000 ms → 280 ms**, y del clic a las ocho tarjetas pintadas: **356 ms**.

**«VER FICHA COMPLETA» pedía `/360` OTRA VEZ** para lo mismo que la ventana ya tenía. Ahora recibe
esos datos. **Del clic a la tabla de facturas: 42 ms.**

**CONTRASTE.** Color donde dice algo, no de adorno: **la deuda viva en rojo y el margen en verde**
(rojo si es negativo). El resto se queda en negro — si se colorea todo, no destaca nada. Y el
subtítulo del porcentaje sube de contraste: era el dato que acompaña al titular y se leía en gris
claro sobre blanco.

**EL CHIP DE PROYECTOS EN DESARROLLO: aparecía por dos motivos, los dos correctos.** El oficio de ese
negocio es **«otro»**, que mantiene `usa_proyectos` en **true a propósito** (los negocios que ya
existían no pierden nada de su pantalla por una migración); y además **el negocio tiene 4 proyectos
vivos**. Se refina la regla para que diga lo que F1 dice de verdad: *«se ocultan si el negocio NO USA
esa función»* — y **tener proyectos ES usarla**, así que el chip se enseña aunque el oficio no lo
traiga. Esconder un chip que lleva a datos reales sería esconderle al dueño lo suyo. Comprobado:
oficio taller **con** proyectos → visible; taller **sin** proyectos → oculto (y encendible en «Más
opciones»).

**DOS GATES MÁS AL BARRIDO, Y LO QUE DESTAPARON.** `gate-vigia-pantalla` y `gate-vigia-agenda`
tampoco estaban. Al meterlos:
- `gate-vigia-agenda` sale **rojo en 1 aserción de 41**, y está **demostrado que es previo** (idéntico
  con `vigia.js` revertido a HEAD). Se declara en `ROJOS_CONOCIDOS` del runner **con su motivo**, para
  que salga por su nombre en cada barrido: un rojo con dueño es información, uno anónimo es ruido.
- `gate-nav-inicio-disa` se puso rojo por **cruce entre gates**: comprobaba el orden de fábrica del
  menú y heredaba **una preferencia de reordenación que yo dejé en el tenant compartido** probando a
  mano la tarea de navegación. Arreglado en el gate (retira la preferencia del usuario que mira antes
  de medir): un gate que comprueba el orden de fábrica no puede depender de lo que haya en la base.

**Regresión completa: 55/69**, con los 13 rojos de siempre más `gate-vigia-agenda`, declarado.

### Ficha de cliente completa: la ficha entera en la ventana, registro de contactos y estética de tarjetas — **TAREA TRANSVERSAL** (el puntero de la escalera NO se mueve)  ✅ HECHO (2026-08-19)

**LO QUE EL PASO 0 DESTAPÓ, Y ERA CULPA MÍA.** La entrega anterior dejó las tarjetas bien y **la
pantalla que las rodea mal**. Medido: en Bamburu `.card` **no lleva padding** —vive en `.card-body`—
y yo había escrito el contenido dentro de `.card` a pelo, así que **17 sitios de la ficha completa
tenían el texto pegado al borde**, en los cuatro anchos. Y a 390 px las celdas de la tabla de
facturas se pintaban **44 px fuera de su caja**, sin llegar a hacer scroll.

**POR QUÉ NO LO CACÉ:** mi gate medía **solo `.bf-card`** —el componente que yo había construido— y
no midió nunca la pantalla que lo contiene. El mismo error de siempre: verificar mi pieza en vez de
lo que el usuario ve. El gate nuevo mide **todo elemento con texto de las dos superficies**, cae
también si el texto solo *toca* el borde, y **abre los desplegables antes de medir**.

**LA VENTANA YA NO TE ECHA.** «Ver ficha completa» abría otra página: se perdía el sitio, el filtro y
la lista, y volver era un viaje. Ahora es **una capa más de la misma ventana**, con su flecha. La
página entera queda para cuando alguien recarga la dirección o la comparte — que es justo cuando sí
se quiere una página. Las dos superficies llaman al **mismo renderizador**: no hay una segunda copia
del HTML en ninguna parte.

**LAS TARJETAS, EN ORDEN DE URGENCIA** — te debe · margen · gasto · **periodo elegible** · ticket ·
última visita · **último contacto** · cada cuánto viene. **«Cliente desde» sale de las tarjetas**: no
pide ninguna acción, así que baja a los datos del cliente junto al NIF y el teléfono. No se pierde.
**Cada tarjeta abre lo que EXPLICA su cifra**, no todas a facturas: las tres del tiempo abren el
registro de contactos, la del margen su desglose documento a documento, la de la deuda la gestión de
cobro. Y **«Últimos 12 meses» dejó de ser una decisión nuestra**: 3, 6, 12 meses, este año o fechas
propias, elegido dentro de la tarjeta, con el título cambiando y **recordado por usuario** en la
tabla de preferencias que ya existía.

**EL REGISTRO DE CONTACTOS (entidad nueva) Y LA REGLA QUE PROTEGE A DISA.** `client_contacts`, fuera
de WRITABLE_TABLES. Se apuntan **solos** —factura, cita atendida, cancelada o plantón, correo del CRM,
y lo que manda Bamburu **marcado como automático**— y **a mano en dos clics** el teléfono, el
presencial y el WhatsApp. **WhatsApp no está conectado a Bamburu y la pantalla lo dice**: no se finge
una integración que no existe.

La trampa evidente habría sido juntarlo todo en «última vez que supimos de él». Sería un desastre:
**tres recordatorios automáticos harían parecer vivo a un cliente que lleva 18 meses sin aparecer**, y
el detector de enfriamiento dejaría de avisar justo de los que se están yendo. Por eso hay **dos
cosas y dos tarjetas**: contacto (todo) y visita (*pisó el negocio o compró*). **El detector sigue
leyendo exactamente la misma consulta que ayer**, sin una coma cambiada. El gate lo comprueba con un
cliente real: 4 visitas, 18 meses parado, tres correos automáticos y una llamada — **sigue dormido,
su ritmo no se mueve un día, y las dos tarjetas dan fechas distintas**.

**LOS CHIPS, POR LO QUE EL NEGOCIO USA, NUNCA POR VALER 0.** Se lee el perfil de oficio que YA existe
(`usa_proyectos`) y `usaAgenda`, sin inventar otro sistema. Taller sin Proyectos; negocio sin agenda
sin Citas; **asesoría con 0 proyectos SÍ los ve** — es su trabajo, y ese 0 le enseña que puede
empezar. Y **nada se elimina**: lo oculto vive en «Más opciones» y se enciende de un clic.

**VERIFICACIÓN — `gate-cliente-ficha-completa` 150/0.** Los cuatro sabotajes están demostrados:
hacer que un correo automático cuente como visita, quitarle el aire a las cajas, devolver «Ver ficha
completa» a otra página y ocultar los chips por valer 0 **hacen caer el gate**, comprobado deshaciendo
cada cambio y volviéndolo a poner.

**LA HERRAMIENTA APRENDIÓ TRES TRAMPAS MÁS.** `scripts/lint-plantillas.mjs` ahora caza también:
el backtick en un comentario **de bloque** (`/* */`, que se me coló y me rompió el fichero igual que
los de `//`); y **el escape que la plantilla se come** — `\s` dentro de un regex escrito en una
plantilla llega al navegador como `s`, y `/\*\*…\*\*/g` llega como `/**…**/g`, que el navegador lee
como comentario. Eso último dejó la capa de visitas **en blanco con el endpoint devolviendo 200**. El
remedio ya estaba en el propio proyecto y yo no lo usaba: **`String.raw`**, como `JS_AGENDA` en
citas.js. De paso el lint aprendió a saltarse los regex y a contar llaves, porque su primera versión
acusaba en falso a cuatro ficheros — y **un lint que grita en falso se acaba ignorando**.

**Y DOS FALLOS DE CSRF DEL MISMO TIPO:** el paso del alta y el selector de periodo llamaban con
`fetch` a pelo, sin el token. El servidor respondía 403 y el botón **parecía no hacer nada**. Ahora el
token va dentro del helper compartido, no en cada llamada.

**Y DOS COSAS QUE DESTAPÓ LA REGRESIÓN, LAS DOS MÍAS.**
- **`gate-propuestas-dormidos` se puso rojo** —verde en HEAD, rojo con mi árbol: mío sin discusión—.
  Sus 39 comprobaciones pasaban; lo que fallaba era su **limpieza**: al borrar el cliente de prueba,
  la clave foránea de `client_contacts` lo impedía. El producto **nunca borra un cliente** (archiva
  con `active=0`), así que no es un fallo de uso real, pero seis gates lo hacen. Arreglado donde toca
  y no gate a gate: un **trigger** que se lleva los contactos con el cliente, que es lo que habría
  hecho un `ON DELETE CASCADE` de haberlo escrito al crear la tabla. Aditivo e idempotente.
- **CUATRO GATES MÍOS NO ESTABAN EN EL BARRIDO.** `gate-cliente-360`, `gate-menu-navegacion`,
  `gate-agenda-visual` y el de esta tarea: los corría a mano al entregarlos y `--all` **no los
  ejecutaba nunca**. Es literalmente la historia que cuenta la cabecera de `run-gates.mjs` (catorce
  gates muertos tres semanas sin que nadie se enterara), y la estaba repitiendo. Grupo `clientes`
  nuevo, y la regresión pasa de 63 a **67 gates**.
- Al meterlos, `gate-cliente-360` cayó y destapó **una fuga de permisos que era mía**: el «cada
  cuánto viene» leía la agenda **sin comprobar `citas.read`**, así que quien no puede ver citas
  obtenía fechas sacadas de ellas. Ahora cada fuente pide su permiso: sin citas, el ritmo sale solo
  de los documentos que sí puede ver.

**REGRESIÓN COMPLETA: 54/67, y los 13 rojos son los MISMOS de siempre** (demostrado en la entrega
anterior revirtiendo el árbol, y confirmado aquí porque el rojo nuevo desapareció al arreglarlo).

**ANOTADO Y NO CONSTRUIDO:** el eje de los gráficos del constructor sigue rotulando el dinero en
formato inglés (viene del ayudante de gráficos compartido); el registro de contactos **nace vacío** y
se llena con lo que pase desde hoy — lo histórico se sigue leyendo de las facturas y de la agenda, y
no se ha reescrito ni un dato (R4).

### Ficha de cliente (ventana flotante + tarjetas + DISA que recomienda) y **los dos márgenes en toda la plataforma** — **TAREA TRANSVERSAL** (el puntero de la escalera NO se mueve)  ✅ HECHO (2026-08-19)

**EL FALLO QUE DESTAPÓ EL PASO 0, Y ERA PEOR DE LO QUE PARECÍA.** Ibrahin vio «36,3 % de margen» en un
cliente con **4.018 € de venta** y **1.577 € de coste** y no encontró ninguna cuenta que lo diera:
898/4018 = 22,3 %, 898/1577 = 56,9 %. Ninguna de las dos. **El divisor era un tercer número que no
estaba en pantalla:** 2.475 €, la parte de la venta cuyas líneas tienen coste conocido. Los otros
1.543 € (el 38,4 % de lo que ese cliente compró) quedaban fuera del cálculo entero, sin decirlo.

La regla en sí es defendible —dividir 898 € entre 4.018 € hundiría el margen con una venta que no
participó—, pero **el número publicado no era ni «sobre la venta» ni «sobre el coste»: era un tercero
sin nombre**. Y no era un caso raro: en el mismo negocio, **«Mostrador» enseñaba un 40,0 %** sobre una
venta de 151.095 € de la que solo **45 €** tenían coste. Un porcentaje calculado sobre el 0,03 % de la
venta, presentado como el margen del conjunto. **Cinco pantallas hacían lo mismo y ninguna lo decía.**

**LO DEMÁS DEL PASO 0**
- **«Cada cuánto viene: con 0 visitas todavía»** en un cliente con 21 facturas. «Visita» era, y solo
  era, *cita de agenda atendida*: en un negocio que factura sin agenda la frase era falsa. Ahora **si
  el negocio lleva agenda manda la agenda** (idéntico al vigía, que es donde opera) **y si no, mandan
  sus documentos**. Ese cliente pasó de «0 visitas» a «cada 26 días, 21 visitas».
- **El texto no se salía por «alto fijo»** —no había ninguno—: la rejilla daba columnas de 150 px
  donde una frase de 60 caracteres ocupaba cuatro líneas y estiraba **las ocho tarjetas a 120 px**.
  Donde **sí** se cortaba texto era en la ventana: la tabla de facturas medía **1.071 px dentro de un
  modal de 1.047** y partía el botón «Gestionar» por el borde. Medido, no mirado.
- **«Actividad y embudo»** se llamaba «Actividad y oportunidades» y su pie decía `tl.length > 15`:
  miraba el largo del **timeline**, no si había oportunidades. Con **0 oportunidades y 21 facturas**
  el enlace «Ver todo en Oportunidades» salía igual, colgando de una lista de facturas y llevando a
  un embudo vacío. Verificado en el DOM antes de tocarlo.
- **El alta (U6) no era ampliable:** el `3` estaba escrito **a mano en cinco sitios**. Añadir un paso
  sin cazarlos todos dejaba el anillo en 4/3 y el checklist no se retiraba nunca. Ahora todo sale de
  `onbSteps.length` y añadir un paso son **dos** cosas: una entrada en el array y su booleano.
- Y el dinero se imprimía **en inglés**: `€4018.00` en vez de `4.018,00 €`, con el formato español
  correcto ya escrito en otro fichero del propio proyecto.

**EL MOTOR ÚNICO DE MARGEN** (`modules/erp/margen.js`) devuelve **siempre las dos cifras** sobre el
**mismo conjunto de líneas** —las que tienen coste—, que es la única pareja donde el importe en euros
es **idéntico** en los dos modos. **Las siete superficies pasan por él**: ficha de cliente,
constructor, informes (resumen y por producto), rentabilidad por proyecto, plan financiero y avisos.
Cero fórmulas sueltas. **Ni un número cambió de valor** al conectarlas.

**AJUSTE DE EMPRESA «Cómo calculo mi margen»**, de fábrica *sobre la venta*. Decide el **titular** en
todas las pantallas a la vez. **R1: Contabilidad y P&G no obedecen** —ahí manda «sobre la venta»
elija lo que elija el dueño, y la pantalla lo dice—. **R2: las empresas que ya existen no cambian ni
un número**: la ausencia del ajuste ya vale «sobre la venta», así que **no hubo migración de datos**.

**LA VENTANA FLOTANTE** con dirección propia (`/admin/clients/<id>`): se copia, se comparte y al
recargar abre la ficha completa, que es una página de verdad. Atrás cierra y devuelve a la lista **con
su filtro y su página**. Se navega **en capas** (resumen → detalle → volver), nunca ventanas apiladas.
En móvil, hoja inferior arrastrable. **Las ocho tarjetas se abren** y enseñan de dónde sale su cifra —
la de margen lista **factura a factura** con la base y lo que queda fuera, que es la respuesta física
al 36,3 %. **«Te debe» abre la gestión de cobro**, no una lista muerta.

**DISA RECOMIENDA, NO INFORMA.** Mueren los seis avisos idénticos en fila («Factura F2026-0184 de Ana
Suárez Campos vencida», y otras cinco iguales). En su lugar, **una línea por familia con la decisión
tomada**: «Tiene 6 facturas vencidas por 1.255,30 €. La más antigua lleva 737 días. Te recomiendo
gestionar el cobro de la cuenta entera», con sus botones. **Cero cálculo nuevo**: la cifra es la suma
de lo que el vigía ya publicó. Sin nada que recomendar, **el bloque no aparece** — ni una frase vacía.

**NADA DESAPARECE.** La tabla larga de facturas salió de la ventana (que es el resumen) y está entera
en la ficha completa, con sus botones de cobro; la historia, las notas y el ranking siguen donde
estaban. El chip de «Deuda» sí desaparece: ya es una tarjeta, y decirlo dos veces no es informar.

**VERIFICACIÓN — `gate-cliente-ficha-margen` 125/0** sobre un negocio creado desde cero (1.200 € con
coste, 840 € de coste, 400 € sin coste conocido → 360 €, 30,0 % / 42,9 %). Incluye el **barrido que
cierra el fallo de origen**: recorre las pantallas buscando un % de margen huérfano y **cae si
encuentra uno**, aunque el cálculo sea perfecto. Y **el sabotaje está demostrado**: deshacer el sufijo
de la base, igualar los dos porcentajes, volver a listar un aviso por documento o quitarle el recorte
a la tarjeta **hacen caer el gate** — comprobado revirtiendo cada cambio y volviéndolo a poner.

**UN AGUJERO DEL PROPIO GATE, ENCONTRADO Y TAPADO.** La primera versión medía solo el *resultado*
(«¿se sale el texto?») y con textos cortos daba verde **sobre un componente ya roto**: le quité el
recorte y no se enteró. Ahora mide **el mecanismo** —que las tres líneas siguen siendo nowrap +
ellipsis + overflow:hidden y que el valor entero sigue en `title`— y además hay un cliente de prueba
con nombre de 92 caracteres. El primer nombre largo de un cliente real lo habría destapado en
producción, no aquí.

**RED NUEVA CONTRA UNA TRAMPA DEL PROYECTO** — `scripts/lint-plantillas.mjs`. Un backtick dentro de un
comentario que va dentro de una plantilla **cierra la plantilla**; me pasó **tres veces en esta misma
tarea**. El lint lo caza antes del reinicio, distinguiendo el caso malo del inocente (`https://` no es
un comentario; un backtick escapado es correcto). La cuarta vez la cazó él, no un arranque roto.

**ANOTADO Y NO CONSTRUIDO:** el eje de los gráficos del constructor sigue rotulando el dinero en
formato inglés (`€0.9`) — viene del ayudante de gráficos compartido, no de estas pantallas; y el
ranking «Qué te compra» agrupa por descripción de línea, así que dos productos con el mismo nombre se
suman (era así antes y sigue igual).

### Ficha de cliente 360 — **TAREA TRANSVERSAL** (el puntero de la escalera NO se mueve)  ✅ HECHO (2026-08-19)

**NO es pieza del peldaño 8.** La ficha era una **ficha de cobros**: deuda, facturas y poco más. Ahora
cuenta la historia del cliente.

**LO QUE DESTAPÓ EL PASO 0**
- **La ficha no existía como pantalla:** era un **modal** dentro de la lista. Sin dirección propia no
  se podía enlazar, ni pasar a un empleado, ni volver con el botón atrás, ni recibir los enlaces de
  los avisos de DISA. Por eso ahora es también una **página**.
- **Ya había una línea de tiempo** en el CRM, con troceo por permisos y una nota escrita en el propio
  código: *«ver CRM no puede ser la llave maestra que revele facturas y cobros»*. **Se extendió esa**,
  no se escribió una segunda.
- **El «cada cuánto viene» ya estaba calculado** por el detector de enfriamiento (mediana de días
  entre visitas atendidas, y con menos de 3 visitas **no se inventa ritmo**). Se reutiliza; no se
  recalcula.
- **Las horas no tienen cliente:** cuelgan del proyecto. Se leen **a través del proyecto** — decisión
  de Ibrahin: no se añade cliente a las entradas de tiempo.
- **De diez tablas implicadas, solo DOS tenían índice por cliente.** La ficha hace ocho o diez
  consultas por cliente en una pantalla: los siete que faltaban entran en la migración.
- Y una que ahorró trabajo: **las ventas de mostrador con cliente ya son facturas**, así que no son
  una fuente aparte. Las de mostrador **sin** cliente no son de nadie — y eso hay que **no** romperlo.

**LO CONSTRUIDO** — (A) cabecera de siete cifras, cada una de su motor. (B) línea de tiempo única,
**paginada y con filtro por tipo**, con las cuatro fuentes nuevas: agenda (incluidas canceladas y
plantones), proyectos, horas y notas. (C) **notas con autor, fecha e historial** en tabla propia,
fuera de las que DISA puede escribir — y **el campo de texto libre de siempre sigue intacto**, sin
migrar ni pisar. (D) contadores que abren su lista, **incluidos los que están a 0**. (E) qué compra,
últimos 12 meses. (F) los avisos que el vigía ya calcula para ese cliente.

**«CLIENTE DESDE» = SU PRIMER DOCUMENTO REAL** (factura que cuenta como venta o **cita atendida**), no
la fecha de alta: en una peluquería el primer contacto es una cita, y contarla desde el alta diría que
un cliente de dos años es de ayer. **Nunca en blanco:** sin documentos dice «Aún no te ha comprado», y
la fecha de alta sigue visible donde estaba.

**EL MODAL NO PIERDE NADA.** Sigue abriéndose desde la lista con su deuda, sus facturas y su
«Registrar cobro» a los mismos clics. Gana **una** cosa: el enlace «Ver ficha completa». Todo lo del
360 vive **solo** en la página — dos sitios pintando lo mismo acaban discrepando.

**PERMISOS: el filtro es del SERVIDOR.** Lo que un usuario no puede ver **no viaja**; no se pinta en
gris ni se esconde con CSS. Y pedirlo a mano da 403.

**VERIFICACIÓN — `gate-cliente-360` 47/0** sobre un negocio creado desde cero. La deuda cuadra **al
céntimo** con el motor de cobros y el gasto con el informe de ventas por cliente; el ritmo es el mismo
número que usa el vigía para avisar (contrastado por **otro camino de código**); sin coste el margen
sale **«—», nunca 0 ni 100 %**; la factura anulada **sigue en la línea de tiempo, marcada, y ya no
suma**; la venta de mostrador sin cliente no aparece en la ficha de nadie; un cliente vacío **no deja
la pantalla en blanco**; los avisos de la ficha son **los mismos cuatro** que los del vigía; neto-cero
comprobado (ni una factura, ni un hash, ni una línea cambian al abrirla); y a 390 px **sin scroll
horizontal** y sin errores de JS.
**REGRESIÓN COMPLETA VERDE.**

**DE PASO, un gate deja de depender del reloj** —la tercera vez con la misma trampa—:
`gate-agenda-visual` comprobaba la línea de ahora contra un horario de 9–18 mientras el navegador va
en UTC, así que a las 8:50 medía el reloj y no el producto.

**ANOTADO Y NO CONSTRUIDO:** enganchar los avisos de DISA y las demás pantallas a la ficha completa
(hoy siguen abriendo lo que abrían); los contadores de Citas y Oportunidades llevan a su lista **sin
filtrar por cliente** porque esas pantallas todavía no aceptan ese filtro.

### El despliegue entra en la entrega: «empujado» ≠ «se ve»  ✅ HECHO (2026-08-18)

**EL FALLO, con nombre:** tres commits empujados (`3f051b0`, `21e62bc`, `083657a`), los gates en verde,
y `peluqueria-gil.bamburu.com` enseñando la agenda de antes. **Node carga los módulos AL ARRANCAR**, así
que un fichero editado y no reiniciado **no existe para nadie**.

**LO QUE SE COMPROBÓ, en este orden:**
- El servicio corre desde `/home/ubuntu/bamburu` (`WorkingDirectory` del unit) y hay **UN solo proceso**
  de la aplicación en `127.0.0.1:3000`. **Caddy** escucha en 80/443 con `reverse_proxy 127.0.0.1:3000`,
  y `peluqueria-gil.bamburu.com` resuelve a la IP de **esta** máquina. **No hay caché intermedia**: se
  pidió lo mismo al proceso y por HTTPS y el cuerpo es idéntico.
- El proceso había arrancado a las **11:16:12** y `citas.js` estaba tocado a las **11:16:13** — un
  segundo después. **Ahí estaba la carrera.**
- Se reinició y se verificó **contra la dirección pública** que sirve el código nuevo (los seis
  marcadores del lienzo y del mes presentes; el segundo título del mes, ausente).

**RESPUESTA A LA PREGUNTA DE LOS GATES (punto 3): SÍ prueban contra el proceso que atiende al público.**
Todos apuntan a `:3000`, que es el que Caddy proxya; **ninguno levanta una instancia aparte**. Pero eso
**no bastaba**, y conviene que quede escrito: el gate prueba **el proceso**, no **el código de disco**.
Editar sin reiniciar da un verde sobre el código VIEJO, y ese verde se apunta en un commit que contiene
código que nadie ha ejecutado. **Ese era el agujero real.**

**LAS TRES REDES QUE LO CIERRAN**
1. `scripts/lib/gate-env.mjs` — **ABORTA cualquier gate de navegador** (código 2, «no ha verificado
   NADA») si el proceso lleva levantado desde antes del último cambio en `modules/`, `core/` o
   `index.js`. Pasa por `launchOpts()`, así que **ningún gate se la puede saltar**. Probado: tocando un
   fichero sin reiniciar, el gate corta en seco.
2. `gate-agenda-visual` termina **saliendo a la calle**: pide `/admin/citas` por **HTTPS a
   `peluqueria-gil.bamburu.com`** con sesión y comprueba que trae el código nuevo. 68/0.
3. `scripts/desplegar.mjs` — **el último paso de toda tarea que toque código servido.** Reinicia si hace
   falta y verifica contra la dirección pública. Si sale rojo, la tarea no está hecha. Añadido al
   `RITUAL.md` como paso 0 del cierre.

**DE PASO, dos gates dejan de depender del reloj** — la misma trampa de ayer: `gate-agenda-visual` y
`gate-agenda-calendario` apuntaban con el ratón a un punto del lienzo que, por la tarde, queda fuera de
vista o debajo de la cabecera fija (el lienzo arranca desplazado a la hora actual). Ahora llevan el
elemento al centro antes de tocarlo.

**REGRESIÓN 15/15 VERDE** con la guarda nueva activa.

### Agenda · corrección 2 (P1 alta de cita · P2 cambiar de mes · P3 layout del mes)  ✅ HECHO (2026-08-18)

**P1 — EL ALTA DE CITA. Reproducido en navegador antes de tocar nada.** De los tres caminos del
encargo, **los tres funcionaban**: (a) hueco → cliente que ya existe ✓ · (b) hueco → cliente nuevo al
vuelo ✓ · (c) botón «Nueva cita» ✓. **El que fallaba era un cuarto** que no estaba en la lista y que se
hace a diario: **elegir el cliente y después seguir escribiendo** —añadir el apellido, corregir una
letra—. Mensaje exacto: **«Elige o crea un cliente»**, y la cita no se creaba. Y un segundo fallo con el
mismo síntoma: un cliente dado de alta **después** de cargar la pantalla **no aparecía en el buscador**,
que desde fuera se lee igual de mal.
- **NO ES REGRESIÓN DE `3f051b0` NI DE LA CORRECCIÓN 1, y se demuestra:** `git diff 3550e48 da5a73b --
  routes/citas.js` está **vacío** (la tanda de navegación no tocó el fichero), y con `citas.js`
  revertido a `3550e48` el fallo **se reproduce idéntico**. Viene de antes de esta semana.
- **Causas:** `cFiltra()` corría en cada tecla y **borraba** el cliente elegido; ahora solo lo suelta
  cuando el texto deja de ser el nombre elegido, y aun así **el nombre escrito ya no se pierde**
  (`cResuelveCliente()` lo recoge al guardar: si es clavado el de un cliente de la ficha se usa ESE, si
  no entra como cliente nuevo). Y `META` se pedía **una** vez y se guardaba para siempre: ahora se
  refresca al abrir el panel, y si la red falla se sigue con lo que había.
- **EL GATE ESTABA VERDE SOBRE UNA FUNCIÓN ROTA, y era por dónde probaba:** metía el valor en el input
  y llamaba a `cFiltra()` a mano, o sea saltándose lo que hace una persona. Ahora **teclea de verdad**
  (`p.type`) y añade las dos comprobaciones que faltaban. **Probado que prueban: con el arreglo
  deshecho el gate da 11 OK / 3 FALLOS; con él, 14 OK / 0.**

**P2 — CAMBIAR DE MES. Respuesta a la pregunta: las flechas SÍ respondían** (pulsar ‹ pasaba de agosto
a julio). Lo que pasaba es que estaban **a 624 px del título**, en el otro extremo de la barra, así que
no había forma de saber que servían para eso. Ahora van **pegadas al título** junto a «Hoy» (166 px), y
se añade **rueda del ratón / gesto vertical** sobre la rejilla: un mes por gesto, **con freno** de
450 ms —un trackpad manda decenas de eventos por gesto—. En Día y Semana la rueda **sigue desplazando
el lienzo** y no cambia de fecha. El título ya abría el selector y «Hoy» ya volvía al mes actual: se
comprueban igualmente.

**P3 — EL LAYOUT DEL MES.** Rejilla de verdad: casillas con separador de 0.5px y **línea entre semanas
más marcada** (antes no había ni una línea), **altura mínima 84 px**, el **número arriba a la izquierda
a 12 px** (no centrado), hasta **3 citas escritas** por día con su punto de estado y **«+N más»**, los
días sin citas **callados**, **fuera el segundo «Agosto 2026»** de dentro de la tarjeta, el **zoom
S/M/L solo en Día y Semana**, y fin de semana y días de otro mes con número gris y fondo apagado.

**UN FALLO PROPIO QUE DESTAPÓ LA REGRESIÓN, y que afectaba al usuario:** desde que la agenda es un
lienzo con scroll propio, **colocarse en la hora actual cerraba solo el desplegable del menú lateral**.
El listener de `layout.js` iba con `capture:true` y veía **todos** los scrolls, no solo el de la página.
Ahora solo cierra con el scroll de la página. `gate-menu-navegacion` lo cazó (104 OK · 1 fallo) y
vuelve a 105/0.

**VERIFICACIÓN — `gate-agenda-visual` 65/0** (era 47/0) con las comprobaciones nuevas de P2 y P3, y
`gate-agenda-sencilla` **14/0** (era 11/0) con las de P1. **Probado que las nuevas prueban:** con P2 y
P3 deshechos el gate da **57 OK / 8 FALLOS**; con ellos, 65/0. **Datos de prueba de verdad:** 11 citas,
**6 días distintos** y **5 en un mismo día** — un mes vacío no demuestra nada.
**REGRESIÓN 15/15 VERDE, cero rojos nuevos.**

**UNA ASERCIÓN ACTUALIZADA, y se dice:** `gate-agenda-calendario` leía el título del mes por `.mes-tit`,
el segundo título que P3 manda quitar; pasa a leer el grande de la cabecera. **Misma exigencia:** sigue
teniendo que decir «Mes AAAA».

### Agenda: acabado visual (día, semana y mes) — **TAREA TRANSVERSAL de presentación**  ✅ HECHO (2026-08-18)
**NO es pieza del peldaño 8** y **no mueve el puntero de la escalera**: es presentación, como la
«Agenda sencilla» y como la navegación de ayer. **No se tocó el motor**: ni `huecos()`, ni
`tramosPersona`/`ocupacionPersona`, ni la guarda de solape (409), ni el horario con excepciones, ni los
permisos, ni la puerta pública, ni los avisos, ni el alta en 3 toques.

**LO QUE DESTAPÓ EL PASO 0, y decidió cómo se construyó**
- **La rejilla era una `<table>` de filas de 30 min** (`citas.js`, bucle `for(t=START;t<END;t+=STEP)`),
  con las celdas a 27 px y la cita colgada de la media hora anterior — por eso una cita de más de 30
  min se desbordaba de su `<td>`. Ahora es un **lienzo**: cada cita se coloca por sus **minutos
  reales**. Una cita a las 9:10 se dibuja a las 9:10 (medido: 12 px con la hora a 72 px).
- **Tres gates dependían de esa tabla.** Se avisó ANTES de construir y se acordó con Ibrahin:
  · Las **zonas de clic siguen siendo de 30 min** (`.agcell.libre` con su `data-col`/`data-min`), y van
    **por DEBAJO** de las citas en el apilado (z-index 1 frente a 3). Si quedaran encima, pulsar una
    cita abriría el alta de una nueva y arrastrar para mover dejaría de funcionar. **Va en el gate.**
  · Las cabeceras llevan clase **estable `.agcol-head`** con su `data-col`, y `gate-agenda-sencilla`
    lee por ahí en vez de por `#agenda thead th`. **La aserción no se debilita.**
  · Y lo que la `<table>` daba gratis y hubo que pedir a mano: **cabeceras fijas arriba y columna de
    horas fija a la izquierda** al hacer scroll. También va en el gate.
- **El color de estado estaba DUPLICADO** —`COLORS` en el servidor para la leyenda y `var COLOR` en el
  cliente para los bloques, los mismos cuatro valores copiados—. Ahora hay **UNA tabla**
  (`ESTADOS_COLOR`) de la que salen los **tres tonos** (suave = fondo · fuerte = barra y punto ·
  oscuro = texto), y el cliente la recibe serializada. **Los cuatro estados conservan nombre y
  familia**: pedida gris · confirmada verde · atendida azul · no se presentó rojo. Los valores
  «fuerte» son los DE SIEMPRE: cambia cómo se expresan, no lo que significan.
- **La vista Mes no tenía de dónde sacar las citas**: `/api/erp/citas/mes` devolvía solo el número.
  Se amplió, acotado como pidió Ibrahin: **4 citas por día como mucho**, ordenadas por hora, y **tres
  campos** (hora, cliente, estado). Y **hereda los mismos filtros que Día**: quien no tiene columna en
  Día tampoco sale en Mes. El candado sigue siendo `citas.read`, intacto.
- El «globo flotante» del mes **no era un globo**: era el `title=` nativo del navegador más un pie que
  seguía al ratón. Fuera los dos; el pie es del día **seleccionado**.

**LO CONSTRUIDO** — (1) lienzo con `--alto-hora` y **zoom de 3 pasos** (48/72/96) recordado por usuario
en `agPrefs`, rasantes de hora y media hora, columna de horas de 44 px con **etiqueta solo en punto** y
formato «9:00», **línea de ahora** en rojo con su punto y su pastilla que se recoloca sola cada minuto,
**scroll de apertura** con la hora actual a un tercio, y **fuera de horario atenuado pero clicable**.
(2) La cita como **bloque**: fondo suave, barra de 3 px, esquinas 0/6 px, texto en el tono oscuro y
**degradación por altura** sin cortar palabras (≥60 px tres líneas · 40-59 dos · 22-39 solo el cliente,
con el servicio al `title`). El tramo de espera, gris y **sin barra**. (3) Cabecera con el **mes en
grande** (mes negro, año gris; el selector de fecha lo abre el título), «Hoy» en rojo, **tira de 7
días** en vista Día, el aviso de sin-horario **cerrable y recordado**, la leyenda replegada tras una
(i), y un solo primario. (4) Mes con **hasta 3 citas escritas** y «+N más», días sin citas en silencio,
días de otros meses en gris claro, y **un clic selecciona / dos abren**.

**VERIFICACIÓN — `gate-agenda-visual` 47/0**, negocio creado desde cero, con las 10 del encargo y las
**3 que pidió Ibrahin**: pulsar encima de una cita alcanza y abre ESA cita (no el alta) · cabeceras y
columna de horas fijas al hacer scroll · el mes respeta los filtros (con «ver todo el equipo» aparece
la cita de quien libra; sin él, no) y no viaja más de 4 citas por día.
**PRUEBA DE HUMO de extremo a extremo, en navegador:** negocio nuevo → horario 9:00-18:00 → cita a las
**9:10** → se ve en **Día** (top 12 px), **Semana** (idéntica) y **Mes** («9:10 · Marta Gómez», sin
globo) → se cambia el estado y **la barra pasa de gris a verde**. 0 errores de JS.
**REGRESIÓN 15/15 VERDE, cero rojos nuevos:** `gate-agenda-sencilla` 11/0, `gate-citas-pantalla` 25/0,
`test-textos-citas` 24/0, `test-citas` 39/0, `test-enlace-cita` 14/0, `test-avisos-cita` 20/0,
`test-neto-cero-cita` 8/0, `gate-menu-navegacion` 105/0, `gate-agenda-calendario` 38/0,
`gate-reserva-publica-pantalla` 51/0, `gate-vigia-agenda` 41/0, `gate-inicio-pantalla` 19/0,
`gate-xss-escape` 29/0, `gate-csp-estricta` 19/0.

**DOS ASERCIONES ACTUALIZADAS, y se dice en vez de darlo por hecho.** No son rojos maquillados: son
conductas que este encargo cambia a propósito.
- `gate-agenda-sencilla`: leía las columnas por `#agenda thead th`. Sin `<table>` ese selector no
  existe; pasa a `.agcol-head`. **Mismo enunciado, misma exigencia.**
- `gate-agenda-calendario`: exigía que **un** clic en el mes abriera el día. El encargo pide que un
  clic **seleccione** y dos abran. La prueba ahora comprueba las dos cosas (que un clic no se salga
  del mes, y que dos abran ESE día), así que exige **más** que antes, no menos.

**ANOTADO Y NO CONSTRUIDO:** arrastrar para REDIMENSIONAR una cita por su borde (hoy se arrastra para
mover, que ya existía y sigue igual); y el solape de dos citas a la misma hora en la misma columna, que
se sigue pintando una encima de otra como hasta ahora — el encargo no lo pedía.

### Navegación: menos ruido sin perder nada — **TAREA TRANSVERSAL de presentación**  ✅ HECHO (2026-08-17)
**NO es pieza del peldaño 8** — es capa de presentación que cruza toda la app, como en su día la
**Agenda sencilla**. El puntero de la escalera NO se mueve: el peldaño 8 sigue ABIERTO donde estaba.

**La regla que mandó en toda la tarea:** no se elimina, no se esconde y no se aplaza NI UNA función.
En julio se probó un menú "lean" que escondía funciones y se revirtió a propósito (U1, `494d2ab`). El
objetivo era que se vieran menos cosas A LA VEZ, no que hubiera menos cosas.

**EL PASO 0 TUMBÓ DOS SUPOSICIONES DEL ENCARGO Y DESTAPÓ DOS AGUJEROS**
- **No existe la tabla de preferencias por usuario reutilizable que pedía usar.** `avisos_pref_usuario`
  (`299a15d`) es una tabla TIPADA de un solo propósito (activo/frecuencia/día/hora/fuentes): no cabe en
  ella una lista ordenada de anclas sin añadirle una columna que no pinta nada ahí. Lo reutilizable es
  el patrón del **peldaño 6**: `dashboard_layouts` (`scope` TEXT como clave, JSON dentro, **ausencia de
  fila = fábrica**) con sus `getLayout/setLayout/delLayout`, que aceptan cualquier ámbito. Decisión del
  dueño: **reutilizarla tal cual**, con ámbito `menu:usuario:<id>`. **Cero tablas nuevas, cero
  migración.** Queda escrito en los dos ficheros que **nadie puede borrar por prefijo** en esa tabla.
- **La "caja de búsqueda que ya existe" no era una caja de búsqueda.** Era decorado: un `<div>` con un
  `<span>` de texto fijo, sin `input`, sin JS y sin destino — y su reclamo prometía *«Buscar cliente,
  factura, producto…»*, o sea DATOS. No se le podía "añadir" navegación: había que hacerla real.
  Decisión del dueño: se hace real **para el menú** y el reclamo pasa a decir la verdad («Buscar en el
  menú… ⌘K»). **ANOTADO Y NO CONSTRUIDO: la búsqueda de datos** (clientes, facturas, productos).
- **AGUJERO 1 (anotado, NO arreglado, por orden del encargo):** `contabilidad` es la única de las 40
  claves del rail SIN entrada en `navPerms`, mientras `/admin/contabilidad` exige `invoices.read`. Un
  empleado con permisos propios y sin ese permiso **ve «Libros y modelos» y se come un 403 al pulsar**.
  El buscador lo hereda igual —ni mejor ni peor— para que los dos se arreglen a la vez.
- **AGUJERO 2 (arreglado de paso, decisión del dueño):** las etiquetas del menú se pintaban SIN escapar,
  y una de ellas es texto libre del dueño (`cita_puesto_plural` → la entrada «Puestos»). Un dueño que
  escribiera `<img onerror=…>` dejaba **XSS almacenado en todas las pantallas de todos sus empleados**.
  Caía en la línea exacta que había que reescribir. Comprobado con carga real: sale como texto.

**LO QUE SE CONSTRUYÓ — tres cosas y UN SOLO SITIO.** La definición del menú sale de `adminLayout` a
**`modules/erp/menu.js`**, y de ahí comen las tres caras: el rail, el buscador y las anclas. **No hay
una segunda lista de destinos** — se quedaría vieja y acabaría enseñando puertas que el menú esconde.
- **(A) Jerarquía dentro de cada área.** El desplegable se parte en dos bloques —arriba y sin rótulo lo
  del día a día; abajo, bajo «Ajustes de \<Área\>», la configuración y los maestros— **pero solo donde
  merece la pena**. **Es SEPARAR, no plegar:** todo sigue visible en la misma pantalla y al mismo número
  de clics. Ante la duda, ARRIBA (por eso «Envío Verifactu» se queda arriba).
  **CORRECCIÓN 4 DE IBRAHIN (18 ago 2026): «en el desplegable de Clientes hay como dos secciones,
  quiero una sola».** Tenía razón: con 3 entradas arriba y 1 abajo, dos rótulos son más cartel que
  menú. Se añade un umbral (`MIN_AJUSTES = 3`): por debajo de tres entradas de ajuste el área va de
  **UNA pieza**, con sus ajustes al final y **sin rótulo**. Hoy solo **Agenda** se parte (6 de sus 8
  entradas son de configurar, que es donde se ganaba algo); **Clientes, Compras y gastos, Inventario y
  Catálogo van enteros**. La marca `ajustes: true` de cada entrada NO se toca: dice lo que la entrada
  ES, y el día que un área junte tres ajustes su bloque aparece solo. **No se pierde nada:** las cuatro
  entradas afectadas (Grupos, Proveedores, Almacenes, Categorías) siguen ahí, las últimas de su lista,
  y el gate lo comprueba una a una.
- **(D) MOVER DE ORDEN — CORRECCIÓN 2 DE IBRAHIN, y CAMBIA UNA REGLA DEL ENCARGO.** El encargo decía
  «las áreas de fábrica **NO se reordenan**»; Ibrahin pidió que **sí**, y que también se ordenen las
  entradas de cada desplegable. Queda así: **se arrastra todo** —las áreas del rail, las entradas
  dentro de su área y los anclados entre ellos—, con la marca de si se suelta antes o después según por
  qué mitad se entre. **La línea de «Ajustes de \<Área\>» es un destino de verdad:** soltar una entrada
  encima la pasa a ajustes y soltarla arriba la devuelve al día a día; en las áreas que hoy no tienen
  ajustes la línea **aparece al arrastrar** (si no, vaciar ese bloque sería un viaje sin vuelta).
  **Lo que NO cambia:** nada se esconde, nada se quita, y **ninguna entrada se muda a otra área** (el
  servidor da 403 si se fuerza). Botón **«Restablecer mi menú»** al pie del rail, que solo aparece si
  hay algo que restablecer y devuelve el menú de fábrica borrando la fila entera.
  **LA REGLA QUE PROTEGE EL INVENTARIO:** un orden guardado es una lista de claves, y una lista de
  claves **envejece** —mañana hay una función nueva que nadie tenía guardada—. Por eso lo que no está
  en la lista **no desaparece: se coloca detrás, en su orden de fábrica.** Un menú personalizado en
  agosto tiene que seguir enseñando la función que se construya en septiembre, sin tocar nada.
- **(B) Buscador que navega.** Coincidencia **por nombre**, sin sinónimos ni difusa; solo se normalizan
  mayúsculas y tildes («almacen» encuentra «Almacenes»). Atajo Ctrl/⌘+K, flechas y Enter. Se alimenta
  del menú YA filtrado, así que por construcción no puede enseñar lo que el rail esconde. **«Cerrar
  sesión» queda fuera del buscador a propósito**: un destino que se dispara con Enter no puede ser el
  que te echa. Sigue exactamente donde estaba.
- **(C) Anclar y ordenar lo propio.** Frontera de Salesforce: la casa viene ordenada y el usuario pone
  sus atajos ENCIMA. Chincheta en cada entrada, bloque propio arriba del rail, se reordenan
  arrastrando, **máximo 8**, **por usuario** (nunca por negocio). Las áreas de fábrica no se reordenan,
  no se renombran y no se quitan; **anclar no saca la entrada de su área**. Quien no ancla nada ve el
  menú de hoy, byte por byte. Si una entrada anclada deja de estar permitida, **el ancla calla**: no se
  pinta, no se borra y vuelve sola al devolverle el permiso.
  **CORRECCIÓN 1 DE IBRAHIN:** la primera entrega solo ponía chincheta en las entradas de
  los desplegables, y «cualquier entrada del menú» incluye **las ÁREAS**. Ahora se ancla **también un
  menú principal**: su atajo aparece arriba y **abre el MISMO desplegable, con sus dos bloques**; el
  área sigue en su sitio, en su orden y con su nombre. Los dos tipos se **reordenan mezclados** en el
  mismo bloque. Para que no hubiera dos HTML del rail (uno en el servidor y otro en el navegador), el
  pintado se extrajo a un **renderizador único** (`anclasBloqueHTML`) y el endpoint devuelve el bloque
  **ya pintado**. De paso, tres arreglos de colocación que salieron al probarlo en pantalla: el rail
  desplegado pasa de 216 a **240 px** (con 216 la chincheta partía «Compras y gastos»); en el cajón del
  móvil la chincheta de un área se iba **al centro del acordeón abierto** (el `.navg` crece con el
  submenú inline); y la de una entrada anclada se colgaba del `.sidebar` y **saltaba a la esquina**
  (el `<a>` no era `position:relative`).

**CORRECCIÓN 3 DE IBRAHIN (18 ago 2026) — «Portal de cliente» se muda de Ventas a CLIENTES.** Cambia
otra regla del encargo («no se mueve ninguna entrada de área»), y por eso se anota. Es la puerta por la
que un CLIENTE entra a ver sus facturas, y desde ella se le manda su enlace: pertenece a «a quién le
vendes», no a los documentos de venta. **El inventario NO encoge: siguen siendo 42 entradas de rail y
50 puertas**, una de ellas en otra área — el gate lo comprueba igual. **Su candado NO cambia:** sigue
exigiendo `invoices.read`, el de su pantalla, no el de Clientes; mover una entrada de sitio no puede
abrir ni cerrar una puerta de tapadillo. Y a quien ya la tuviera colocada a mano en Ventas **no se le
rompe nada**: la clave vieja se ignora y la entrada aparece en Clientes, en su sitio de fábrica (es la
misma regla del orden que envejece).

**NO SE TOCÓ:** ni una ruta, ni un endpoint de datos, ni un permiso, ni un dato. Ningún área nueva. Los endpoints nuevos (`GET/PUT /api/erp/menu/anclas`,
`PUT/DELETE /api/erp/menu/orden`) guardan **colocación**, no datos de negocio, y **cero tablas nuevas**:
una fila por usuario en `dashboard_layouts` con todo lo suyo del menú (`{anclas, areas, entradas}`).

**VERIFICACIÓN — `gate-menu-navegacion` 105/0** (línea base actualizada: «Portal de cliente» cuenta ya
en Clientes, y el total sigue siendo 50), en navegador real, sobre un negocio **creado desde
cero** (oficio «peluquería»), entrando por el formulario de login y pulsando como pulsaría el dueño:
- **LA PRUEBA QUE MANDA — no amputación: N ANTES = N DESPUÉS = 50 puertas** (42 en el rail + Inicio +
  Ayuda + 6 de cuenta), identidad comprobada UNA A UNA contra el inventario del PASO 0, y **las 41 con
  pantalla pulsadas de verdad: todas HTTP 200**. Agenda enseña sus 8 entradas **a la vez** (8/8
  visibles): separar, no plegar. La etiqueta del oficio sigue llegando al menú («Sillas» en peluquería).
- Buscar «presupuesto», «almacen» y «conciliaci» → las tres rutas correctas con Enter; flecha+Enter va
  al 2º resultado; Ctrl+K enfoca.
- **CADA ÁREA tiene su chincheta** (10 de 10). Anclar tres entradas **y un área entera**: el área llega
  arriba con su nombre, **trae su desplegable de 7 entradas** y lo abre igual; las áreas de fábrica
  siguen en su orden y el rail sigue con sus 42 entradas — es un atajo, no un traslado.
- Reordenar (área y entradas **mezcladas**), **cerrar sesión pulsando y volver a entrar**: siguen
  ancladas y en su orden. Quitarlas todas → menú **idéntico al de fábrica**, bloque **vacío y sin
  ocupar un píxel**, y **sin fila** en la tabla. El servidor rechaza la 9ª.
- **(D) ARRASTRANDO DE VERDAD** (arrastre real del navegador, no una llamada a la API): un **área** se
  mueve de sitio en el rail y no se pierde ni una de las 42 entradas; una **entrada** se mueve dentro
  de su desplegable y su área sigue completa; soltar una entrada **sobre la línea** la pasa al bloque de
  ajustes **sin perderla** —y esa línea, en un área que no tiene ajustes, **aparece al arrastrar**—.
  Un orden guardado **incompleto** (una sola entrada listada) **no amputa**: lo listado va delante y el
  resto detrás, en orden de fábrica. El orden **sobrevive a cerrar sesión**, y **restablecer** devuelve
  áreas y entradas a fábrica, hace desaparecer el botón y **borra la fila**.
- Segundo usuario con MENOS permisos (9 de 42 entradas): **el buscador no enseña ni una puerta que no
  esté en su menú**; sus anclas son suyas; anclar lo que no ve → **403**.
- Móvil a 390 px: cajón, ancladas arriba, acordeón con su rótulo, ninguna entrada se sale, buscador
  usable, **0 errores de JS**.
- **Regresión en su número exacto, CERO rojos nuevos: 21/23.** Verde: `gate-nav-inicio-disa` 34/0,
  `gate-inicio-pantalla`, `gate-citas-pantalla`, `gate-agenda-sencilla` 11/0, `gate-agenda-calendario`,
  `gate-oficio-pantalla` 28/0, `gate-vigia-agenda` 41/0, `gate-vigia-pantalla`, `gate-espera-pantalla`,
  `gate-proyectos/tiempo/facturar-horas/rentabilidad/coste-horas/margen-pantalla`,
  `gate-reserva-publica-pantalla` 51/0, `gate-avisos-contador-vivo`, `gate-xss-escape` 29/0,
  `verify-xss-escape` 49/0, `gate-csp-estricta` 19/0.
- **Los rojos son PREVIOS/AJENOS, demostrado y con su CAUSA** (revertidos los ficheros a HEAD,
  reiniciado y reejecutado: salida IDÉNTICA; restaurado y verificado con `diff -q`):
  · `gate-avisos-badge` (4 fallos, 12 OK) — **CADUCADO**: busca `a.disa-fig-link` y `.disa-row`, que son
    del Inicio FIJO anterior al peldaño 6 (`7fda12a`). El dato sigue estando, ahora en el bloque «Avisos
    pendientes» de la rejilla.
  · `gate-avisos-pantalla` (3 fallos, 1 OK) — **dato de partida caducado**: apunta a la factura
    `F2026-0017`, que tras resembrar el tenant quedó **anulada**, así que no genera aviso de cobro ni
    tiene botón «Registrar cobro».
  · `gate-agenda-sencilla` y `gate-oficio-pantalla` — **DEPENDEN DE LA HORA DEL DÍA, y no se sabía.**
    (2 fallos / 9 OK y 2 fallos / 26 OK por la noche; **11/0 y 28/0 a la mañana siguiente**, con el
    código ya cerrado: el diagnóstico quedó confirmado.) Los dos pasaron VERDES dos veces esta misma sesión y se pusieron
    rojos por la tarde con el MISMO código (y siguen rojos con los ficheros revertidos a HEAD). Causa
    medida, no supuesta: sin horario configurado el día abre 8:00–21:00 (`DEFAULT_OPEN`) y el motor
    **descarta los huecos ya pasados** (`citas-engine.js:222`); la zona del negocio es Madrid, así que
    a las **20:40** quedaban **0 huecos hoy** para cualquier duración —a las 09:00 habrían sido 24—, y
    sus dos aserciones piden justamente que el motor **proponga un hueco de hoy**. **Anotado: son
    gates de ventana horaria**; correrlos de día, o fijarles la fecha de prueba a mañana.

**ANOTADO Y NO CONSTRUIDO:** el **orden por defecto del menú según el oficio del negocio** · la
**búsqueda de datos** en el buscador del topbar · el **candado de `contabilidad`** (AGUJERO 1).

**HALLAZGO SUELTO, DE OTRO MÓDULO (anotado, NO tocado aquí):** en un negocio **recién creado**,
`GET /api/disa/threads` responde **500** — `SqliteError: no such column: t.pinned`
(`modules/disa/index.js:2051`). La columna la añade un `ALTER TABLE` en `modules/disa/index.js:127`
que en un tenant nuevo **aún no ha corrido** cuando la pantalla ya pregunta. Salió a la luz porque
`gate-menu-navegacion` crea negocios de cero; no es de esta tarea y no se ha tocado nada de DISA.

### CRM comercial — embudo de oportunidades + actividad de cliente  ✅ HECHO (2026-07-09)
Encargo expreso del dueño (estaba en el roadmap futuro). **Motor primero, DISA después** (RITUAL): esta
tanda cierra el motor y las pantallas; la voz de DISA queda para el Eje B.

- **Investigación en fuente oficial** (`docs/crm/embudo-referencia.md`, verificada, no de memoria; lo no
  comprobable va marcado NO VERIFICADO): Salesforce, HubSpot, Pipedrive, Holded (competidor directo ES).
  Decisiones que salen de ahí:
  - **Estado separado de la etapa** (`status ∈ activa|ganada|perdida`, ortogonal a `stage`), como Pipedrive
    y Holded. Ganada/Perdida NO son etapas → al cerrar se **conserva la etapa** en la que se cayó (métrica
    real para un autónomo), sin columna extra. Reabrir existe (un drop por error no es callejón sin salida).
  - **4 etapas abiertas** 10/30/60/85 % (Nuevo contacto · Cualificado · Presupuesto enviado · Negociación).
    Interpolación razonada entre SF y HS; se descartan las etapas "evento de calendario" de PD/HS (venta SaaS).
  - **Motivo de pérdida híbrido** (picklist + texto libre; «Otro» exige nota). Hallazgo: ningún CRM trae
    lista por defecto → la nuestra es propuesta razonada, y así consta en el código.
  - **Origen** anclado en `LeadSource` de Salesforce (única lista verificable en doc oficial), podado.
- **Migración aditiva, sin DROP** (`models.js`): dos tablas nuevas `opportunities` + `client_activities`
  (hermana de `collection_actions`, sin `invoice_id`). `stage` sin CHECK a propósito (cambiarlo obligaría a
  recrear=DROP); la lista cerrada la validan zod + servicio (fuente única en `crm.js`). Permisos propios
  **`crm.read` / `crm.manage`** (no se reutiliza `clients.*`): a Admin y Seller; owner/admin hacen bypass.
- **Motor** (`modules/erp/crm.js`, espejo de `cobros.js`): próxima acción por **silencio vs cadencia de la
  etapa**; **compromiso** pospone (espejo de la promesa de pago); **en_riesgo** si venció el cierre previsto;
  priorización explicable (cada fila con su `motivo`); worklist + embudo con **previsión ponderada** (Σ
  valor×prob); **timeline unificado** (oportunidades + actividad + cadena documental + cobros); email de
  seguimiento por Resend (mismo mailer, `replyTo` al dueño, confirm-first). Todo por **servicio validado**
  (la única vía de escritura, la que usará DISA).
- **Pantallas** (`routes/crm.js`, `/admin/crm`, menú "Oportunidades"): **Embudo** (Kanban con drag&drop
  nativo; soltar en Ganar/Perder abre el cierre, que exige motivo) y **Cola de trabajo** (lo más urgente
  arriba, con su porqué). Reutiliza tokens/U2/U3; cero azules nuevos.
- **Ficha de cliente**: nueva sección **"Actividad y oportunidades"** (summary + timeline) que da superficie
  a dos endpoints que quedaban colgantes. El timeline llega **troceado por permisos** desde el servidor
  (`crm.read` NO revela facturas/cobros sin su llave — se cerró esa puerta trasera en la ruta).
- **Fuera** (registrado): la **voz de DISA** sobre el embudo (Eje B) · registrar actividad desde la propia
  ficha (hoy se gestiona en `/admin/crm`) · agenda/calendario del roadmap.
- **Verificado**: motor `scripts/verify-crm.mjs` **44/0** (crear/mover/cerrar ganada+perdida+motivo/reabrir,
  cadencia, compromiso, en_riesgo, worklist/ponderado, actividad, timeline+troceo por permisos, archivar,
  migración idempotente) + **smoke navegador real** (embudo, cola, ficha) con la oportunidad creada por el
  API real: 4 columnas, KPIs, tarjeta, cola priorizada y la sección de la ficha con su línea de tiempo,
  **0 errores JS** (solo el 404 de `/favicon.ico`, ajeno y de toda la app). Aditivo y reversible.
- **Arreglo (2026-07-09, tras prueba del dueño)**: el selector de cliente del modal de oportunidad no dejaba
  ni **elegir clientes ya registrados** ni **avanzar si el cliente no existía**. Dos causas y sus arreglos:
  - Era **buscar-y-solo-al-teclear-≥2**: si no tecleabas, no veías a nadie que elegir. Ahora es un
    **combobox**: al **enfocar** el campo muestra tus clientes para elegir; teclear filtra. La selección va
    en **`mousedown` + preventDefault** (se elige antes de perder el foco: inmune al cierre-por-blur que no
    aparece en pruebas headless) y **cierra al salir** del campo (no tapa el resto del formulario).
  - Era **buscar-o-nada**: si el cliente no existía, callejón sin salida. Ahora **crea el cliente en línea**
    (nombre + email/teléfono + tipo → `POST /api/erp/clients`, permiso `clients.create`); el desplegable
    ofrece "Crear «X»" siempre y en el vacío.
  - El modal se **unificó** en un solo sitio (`oppModalHtml`, antes duplicado en las dos vistas). Nombres de
    cliente **escapados** (`escHtml`) en el desplegable (hay filas de prueba con payloads XSS en el tenant
    dev: se pintan como texto, no ejecutan).
  - **Verificado** en navegador real: selector 17/0 (elegir registrado + crear nuevo, **escritorio y móvil
    390px**) + combobox 7/0 (enfocar muestra lista · mousedown elige · teclear filtra · blur cierra). 0
    errores JS.

---

> **Fase actual: OPTIMIZACIÓN** (CANON v2 §4) sobre tres ejes — UX, DISA, Seguridad. Las funciones
> nuevas ceden prioridad al pulido salvo decisión del dueño. **Cuándo salir al mercado lo decide el
> dueño**; el asistente y Code no lo recomiendan.
> **Fuente única de tareas: este archivo.** Notion es solo panel (KPIs, tiempo, "dónde sigo").
> **Histórico de lo ya construido** (piezas cerradas, decisiones D1–D6, estructura NÚCLEO/SUELO/FOSO):
> `docs/contexto/piezas-cerradas.md` y el resto de `docs/contexto/`, más el TABLERO anterior en `git log`.

## Backlog — El Suelo y deuda (NO es la escalera)
Todas las tareas pendientes anteriores, **conservadas**. No se inician sin encargo del dueño.
**Esto NO es una lista de espera rival de la escalera:** es lo que le falta a **El Suelo** (el umbral de
admisión al mercado — Verifactu, contabilidad, permisos) más la deuda técnica y los riesgos abiertos.
La escalera (§LA ESCALERA, CANON §4) es **la ventaja**; esto es **el suelo bajo los pies**. Son cosas
distintas y por eso viven en sitios distintos.

### Contabilidad y cumplimiento fiscal

#### ⬜ Verifactu para clientes — colaborador social  ·  TAREA ÚNICA, NO TROCEAR
**A ejecutar cuando Ibrahin lo indique.** Se hace entera o no se empieza: media tarea deja registros
fiscales a medio camino. Decisión que la fija: `docs/contexto/decisiones.md` (2026-07-10).

> **Verifactu clientes = registro colaborador social + certificado único Bamburu + pantalla de
> autorización de representación + activar + probar.**

- **Modelo.** Bamburu se registra ante la AEAT como **envío autorizado** (convenio de colaboración social
  para empresas de sistemas informáticos de facturación, **«Tipo 17»**) y remite los registros de **todos**
  los negocios con **un único certificado propio**. **Ningún cliente instala certificado.**
- **Autorización de representación.** Cada dueño la firma **dentro de Bamburu**, con el **modelo del Anexo II**
  (Resolución 18-12-2024, BOE 31-12-2024); la AEAT admite capturarlo por formulario dentro del propio SaaS.
  Debe quedar **guardada y ser acreditable ante la AEAT**: un "acepto los términos" **no basta**. Es pantalla
  + persistencia, no un checkbox.
- **El motor no se reescribe.** Cola, agrupación por obligado en un sobre, reintentos y encadenamiento se
  reutilizan **tal cual**. Solo cambian (a) el certificado firmante y (b) el flujo de autorización.
- **Requisito ya confirmado contra fuente oficial AEAT:** *un lote = un solo obligado tributario*, envíos
  separados por negocio. **Ya cumplido** por la cola actual (una Cabecera por sobre).
- **El alta es un trámite legal y externo, y solo lo puede iniciar Ibrahin.** Se hará con la plataforma al
  100 %, antes del lanzamiento. **Sin urgencia:** envío voluntario hasta la obligación general del
  **1 ene 2027**.

- **Verifactu — lo que existe hoy es una PRUEBA DE CONCEPTO:** ✅ Fase A (motor SOAP+mTLS, dos registros
  aceptados en preproducción) y ✅ cola de envío automático por negocio (2026-07-09), ambas con el
  **certificado personal del dueño**. Demostraron que la tubería llega a la AEAT de punta a punta. **No son
  el producto.** El `.p12` se borró del servidor tras el envío del 9-jul (regla de la Fase A) y el timer de
  la cola sigue sin instalar; **ya no hace falta activar nada con el certificado personal** — la activación
  real llega con el de Bamburu. Hoy vive solo el envío manual: `/admin/verifactu/envios` o
  `scripts/verifactu-enviar-preproduccion.mjs`. Estado verificado en `docs/verifactu/estado-certificado.md`.
- **Verifactu — ampliaciones técnicas pendientes:** ~~envío de **anulaciones** (hoy solo altas)~~ **HECHO**
  (23-ago-2026, `1fb0221`), **subsanación**
  del aviso 2004, validación XSD formal. *(La ~~Fase B legal~~ queda resuelta por la decisión del 2026-07-10:
  el modelo de certificado ya está elegido — colaborador social, un único certificado de Bamburu. Queda solo
  el trámite, dentro de la tarea única de arriba. La ~~cola + timer por tenant~~ ya está hecha.)*
- **Facturae — motor de generación del XML ✅ HECHO (2026-07-08).** Ver `docs/facturae/investigacion.md`.
  - **Investigación** verificada en fuente oficial (XSD 3.2.2 descargado y parseado, política de firma v3.1
    extraída del PDF, WSDL de FACe descargado en vivo, BOE consolidado). Vigente: **Facturae 3.2.2**.
  - **Motor** (nuevo, `modules/erp/facturae/`): `modelo.js` (modelo NEUTRO de factura, sin XML) →
    `facturae322.js` (serializador) + `iso-paises.js`. La separación existe porque el **RD 238/2026**
    (BOE 31-03-2026) obliga a remitir una copia en **UBL** a la solución pública: UBL será otro
    serializador sobre el mismo modelo, no un proyecto nuevo.
  - **Migración aditiva**: `clients.postal_code/province` · `company_config.postal_code/city/province`
    (faltaban: sin dirección del EMISOR ninguna factura podía ser válida) · snapshot en `invoices` de
    CP/municipio/provincia/país de ambas partes · `invoices.tipo_factura`.
  - **Mapeo decidido** (no hay tabla oficial): F1→`FC`+`OO` · F2→`FA`+`OO` (bloqueada igual: sin
    destinatario identificado) · **F3→`FC`+`OO`, NO `OC`** (una recapitulativa agrupa varias operaciones
    de un periodo; la F3 sustituye un único ticket) · R1–R5→`FC`+`OR`+`Corrective`. `ReasonCode`:
    R1/R4/R5→`16`, R2/R3→`85`. `CorrectionMethod`: `S`→`01`, `I`→`02`. El código AEAT se conserva en
    `AdditionalReasonDescription`. `PersonTypeCode` se DERIVA del NIF (sin columna nueva, sin snapshot
    que se desincronice); `ResidenceTypeCode` del país; el NIF solo se prefija con el país en
    intracomunitarias. `UnitOfMeasure` se omite (es `[0..1]`).
  - **UI**: bloque plegado "Añadir dirección fiscal completa" en la ficha de cliente (opcional, no toca
    el alta normal) · CP/municipio/provincia en Datos del negocio · botón **"Generar Facturae"** en la
    ficha de factura con tres estados: congelado → normal; sin snapshot pero cliente completo hoy →
    genera **con aviso visible**; datos incompletos → sin botón, dice qué falta y enlaza a arreglarlo.
    XML sin firmar, descargable, archivado vía `attachments.js` (`kind='facturae_xml'`).
  - **Tres supuestos del encargo resultaron falsos** y se corrigieron: (a) `tipo_factura` NO era
    transitorio — ya se persistía en `verifactu_registros`; se hizo **backfill** en vez de perderlo.
    (b) `InvoiceTotal` **SÍ descuenta la retención** (el XSD lo dice literal); `TotalTaxesWithheld`
    (IRPF) ≠ `AmountsWithheld` (retención de garantía) → los tres totales coinciden y valen
    `invoices.total`. (c) `company_config` no tenía dirección estructurada.
  - **El XSD cazó un bug del serializador**: `ReasonDescription` y `CorrectionMethodDescription` son
    **enumeraciones**, no texto libre.
  - **Verificado**: 55/55 (lógica + validación contra el XSD oficial con `xmllint`, sobre una COPIA de la
    BD) y 26/26 (HTTP + navegador). Tres facturas reales validadas: F1 con snapshot (2 tipos de IVA +
    IRPF; cambiar la dirección del cliente después NO contamina el XML), factura vieja sin snapshot con
    cliente completado hoy (genera + aviso), cliente incompleto (bloqueo + 409). Aritmética:
    1.100 + 220 − 165 = **1.155,00** en los tres totales. Rectificativa con `Corrective`. Ticket F2
    bloqueado. Total manipulado → se niega a generar. **0 errores JS**. BD real intacta.
  - **Hallazgo**: 8 facturas (las anteriores a Verifactu) tienen `invoice_items.tax_rate=0` mientras la
    cabecera declara 21%. Se **bloquean con mensaje propio**: reconstruir el desglose desde la cabecera
    sería inventarse el reparto por tipos en un documento con valor legal.
- **Facturae — firma y envío (BLOQUEADO por certificado).** Firma **XAdES-EPES** enveloped, política v3.1
  (`SigPolicyId` con la URL literal `.es`, no `.gob.es`). **Buena noticia verificada: NO exige certificado
  de persona jurídica ni sello de empresa** — el FNMT de persona física del dueño sirve para firmar sus
  propias facturas. Ojo: son DOS certificados distintos — el que firma la factura (del emisor) y el que
  autentica el webservice de FACe (hay que darlo de alta en el portal de proveedores). Extensión `.xsig`.
  FACe exige además **tres códigos DIR3** en `BuyerParty` (oficina contable · órgano gestor · unidad
  tramitadora) que aporta el cliente de la Administración. Endpoints (WSDL descargado en vivo):
  prod `https://webservice.face.gob.es/facturasspp?wsdl` · pruebas `https://se-face-webservice.redsara.es/facturasspp?wsdl`.
  **Sin confirmar**: que FACe valide contra XAdES 1.3.2 (la página está tras WAF; no la leí en fuente).
- **Facturae — serializador UBL (pendiente).** RD 238/2026: quien no use la solución pública debe remitir
  «una copia electrónica fiel de cada factura en la sintaxis UBL». La arquitectura ya lo deja preparado.
- **Contexto legal verificado (BOE):** el umbral de **5.000 €** de la Ley 25/2013 art. 4 sigue vigente, pero
  es una **facultad** de cada Administración para excluir por reglamento, no una exención automática. Y un
  **autónomo (persona física) NO está en la lista de obligados** a)–f): para el público de Bamburu la
  e-factura a la Administración es un derecho, no un deber (salvo que la Administración concreta la exija).
- **Balance de Situación:** requiere pieza previa de **saldos de apertura + capital + capitalización de inmovilizado** (escritura de apuntes); decisiones de datos del dueño.
- **Cuentas anuales y legalización de libros.**
- **Plan de cuentas con subcuentas.**
- **Asientos de amortización al diario:** la Pieza 3 (bienes de inversión) calcula la amortización en lectura; volcarla al diario como asiento es pieza aparte.
- **Modelos AEAT siguientes:** 111/115/123 (retenciones), 349 (intracomunitario), 347 (operaciones con terceros), 390 (resumen anual IVA), 200/202 (Sociedades). *(303/130 ✅, Pieza 4.)*
- **IRPF en compras:** hoy solo se modela el IRPF soportado en ventas.
- **Acceso de la gestoría:** compartir la contabilidad por permisos de rol.
- **Mejoras de la pantalla de libros:** drill-down al documento/asiento de origen al pinchar una fila; buscar (nº factura/NIF) y filtrar por tipo de IVA, cliente/proveedor y estado de cobro/pago; cuadro-resumen por tipo de IVA; bloqueo de periodo presentado (estado borrador/presentado); asiento resumen para tickets del mismo día y tipo.
- **Conciliación bancaria:** **CSV genérico** de extracto (añadido barato); **PSD2 / Enable Banking** como fuente automática futura (la costura ingesta↔cruce ya lo prevé).

### Ventas, portal y recurrentes
- ⬜ **FACTURA PROFORMA — construida bien y desde cero.** *(Apuntada por Ibrahin el 24 ago 2026, al
  retirar el POS viejo.)* Es un documento normal en cualquier negocio: una previsión de importe que se
  manda antes de emitir la factura de verdad. **NO se resucita la del POS viejo**, que apuntaba a una
  tabla archivada y se titulaba «FACTURA» a secas — esa se retiró entera ese mismo día. Cuando se
  aborde: título con la palabra **PROFORMA** visible, la línea «Este documento no tiene validez
  fiscal», y **serie propia**, nunca la de las facturas legales. Es cuestión de orden, no de si toca.
- **Portal de cliente — pago online (tarjeta):** pasarela (Stripe u otro); necesita decisión de proveedor y coste del dueño. **Único paso que falta del portal.**
- **Portal de cliente — acceso admin al enlace:** mostrar/copiar el enlace del portal desde el admin (hoy solo se envía por email).
- **Portal de cliente completo (roadmap):** que el cliente vea y **acepte presupuestos** y haga **pedidos B2B con carrito**.
- **Facturas recurrentes — auto-emisión sin revisar:** interruptor opcional por-plantilla (hoy siempre genera **borrador** para revisar y emitir con un clic).
- **PDF + email de cada documento:** hoy solo el presupuesto envía PDF por email.
- **Plantillas de documento personalizables.**

### Inventario (Pilar 3 — ✅ CERRADO 15 jul 2026)
El pilar queda completo: multi-almacén + stock mínimo/punto de pedido + trazabilidad por lote/serie.
- ✅ **Multi-almacén CERRADO** — las tres capas. Capa 1/2 (operar por almacén) `da7871e` · Capa 3
  (**traslados** `TR-NNNN`) `3af928f`. Verificado el 2026-07-10 sobre copia de BD real: el traslado valida
  stock en origen, es atómico, y **el valor total del inventario no cambia** al mover mercancía (solo cambia
  dónde está). DISA ya los ejecuta. Gates: `test-transfers` 30/0 · `verify-traslado-auditoria` 13/0.
- ✅ **Stock mínimo / punto de pedido — CERRADO (15 jul 2026, `8b4fbe4` + `ff98547`).** Nivel MÍNIMO y
  OBJETIVO por (producto, almacén) —tabla `stock_levels`, apagados por defecto, solo físicos, editables en
  la ficha del producto—. El disparo se mide contra el DISPONIBLE del almacén (físico − reservado). AVISO
  "bajo mínimo" en campana + correo (reemplaza la heurística fija stock<5). Y la 6ª propuesta de DISA
  (**D5f**, `reposicion_stock`): agrupa por proveedor → borrador de orden de compra hasta el objetivo;
  aprobar lo CREA (no lo envía). Detalle en la sección de propuestas (Eje B). Gates: `verify-propuestas-
  reposicion` 46/0 + `gate-propuestas-reposicion` 16/0 (navegador).
- ✅ **Trazabilidad por lote / nº de serie — CERRADO (15 jul 2026, `f56ad84` + `13a61df`).** Un producto
  físico se marca `lot` (lotes con caducidad) o `serial` (nº de serie único). Modelo UNIFICADO: lote y
  serie son una "unidad de traza" (`stock_lots`) con `code` único por producto; la serie es un lote de
  capacidad 1. El saldo por lote se **deriva del libro** (`stock_movements.lot_id`), sin segunda fuente de
  verdad. **Red de seguridad:** `tracking='none'` (el defecto) no se toca — todo igual que hoy. ENTRA por
  recepción de compra (captura lote+caducidad o nº de serie); SALE por mostrador y albarán con **FEFO**
  (antes caduca, primero sale; un trazado no se sobrevende); anular reingresa a SU lote. **Guardas:** un
  trazado no se mueve por ajuste/traslado/devolución a proveedor/compra directa (con lote, más adelante).
  UI: flag en la ficha, captura por línea en la recepción, informe de lotes/series (saldo + caducidad).
  Núcleo `trazabilidad.js`. Invariante afirmada: **∑ saldos de lotes == stock**. Gates: `verify-trazabilidad`
  30/0 + `verify-trazabilidad-flujos` 20/0 (servicios reales) + `gate-trazabilidad` 6/0 (navegador).
- ⬜ **Sync e-commerce** (Shopify / Woo / Prestashop) — Capa 2 (congelada).

### Multiusuario / permisos
- **Administración de permisos por DISA (registrada, 2 pasos EN ORDEN).** *Paso 1 — Fundamento:* repasar TODAS las rutas/servicios de los pilares y confirmar que cada acción exige el permiso correcto (`requirePerm`), no solo sesión, con un modelo de permisos limpio agrupado por áreas. *Paso 2 — DISA administra hablando:* el dueño gestiona usuarios/accesos por conversación y DISA lo traduce vía servicio validado (DISA nunca escribe permisos directo; patrón T5/cobros). El Paso 2 no arranca sin el Paso 1 cerrado.

### Riesgos / decisiones abiertas
- **D3 · [riesgo legal a resolver] Documento de pedido titulado "FACTURA" que no es la factura Verifactu** (`routes/orders.js:442`). Quedó neutralizado al desmontar `orders.js` en PIEZA C; verificar que ya no es alcanzable y decidir renombrar/retirar/aclarar. *Estado: revisar.*
- **D6 · [a verificar] XSS en páginas públicas de la tienda** (HTML guardado por admin sin escapar). La tienda está apagada de forma reversible (D1); revisar antes de reabrir en Capa 2. *(El bug de fuga de stock de `cancel_order` ya quedó resuelto al archivar `sales_orders`, D4.)*

### Deuda técnica
- ✅ **Etiquetas de `activity_logs`: CERRADO (2026-07-10).** DISA y las rutas nombraban distinto la misma
  cosa (`invoices`/`invoice`, `products`/`product`, `clients`/`client`, `suppliers`/`supplier`,
  `admin_users`/`admin_user`), y la vía genérica de DISA escribía el **nombre de la tabla**. Ahora las
  **26 entidades viven en `core/activity-entities.js`** y las importan los dos lados: 110 sustituciones,
  cero literales tecleados. La pantalla `/admin/activity` estrena **filtro por entidad y buscador** (antes
  no tenía ninguno de los dos). El histórico **no se reescribe**: las filas viejas conservan su etiqueta y
  el desplegable las sigue ofreciendo. Gate: `verify-actividad-etiquetas.mjs` (32/0).
  *(Ojo: `logActivity` de DISA es un helper LOCAL con firma distinta a la de `core/auth.js` — no copiar el
  orden de argumentos.)*
- ✅ **DISA: acciones de PEDIDO RETIRADAS (2026-07-10).** Eran cinco (`create_order`, `edit_order`,
  `update_order_status`, `cancel_order` y el puente `create_invoice_from_order`) y escribían contra
  `sales_orders` / `sales_items` / `order_status_history`, las tres **archivadas por D1**: reventaban con
  "no such table". D1 las había neutralizado con una guarda que respondía "en migración", pero dejó los
  `case` y su declaración en el prompt, así que **DISA seguía anunciando una función que no existía**.
  Retiradas del todo: guarda, `case`, prompt, permisos, el import de `generateInvoice` y la sección §6 de
  `test-disa-clientes-t5` (un test aparcado que no probaba nada). **El flujo humano no se tocó.** Gates:
  `verify-disa-sin-pedidos` (32/0, estructural) y `verify-disa-pedidos-modelo-real` (10/0, contra el modelo
  de verdad: pide crear/cancelar/facturar un pedido y DISA declina y redirige a `/admin/pedidos`).
- ⬜ **`modules/erp/routes/orders.js` está desmontado** (POS viejo, `routes/index.js:106` y `:159`) pero
  sigue en el árbol, con 6 `logActivity` que nunca se ejecutan. Retirarlo o revivirlo, no dejarlo a medias.
  *(Sus hermanos ya cayeron: `generateInvoice` de `invoices.js` sigue neutralizada desde D1 —lanza 410— y su
  ruta `/from-order/:orderId` tampoco se usa. Van juntos en el mismo encargo.)*
- ⬜ **QUEDA UNA VENTANITA DEL NAVEGADOR VIVA, y el censo decía CERO (24 ago 2026).** El botón
  **«Deshacer»** de `/admin/conciliacion` abre un `confirm()` de verdad
  (`routes/conciliacion-routes.js:120`), y es la trampa conocida: el navegador los silencia y el
  botón queda muerto sin decir nada.
  - **Por qué no se veía.** `censo-ventanitas.mjs` decidía si una línea iba dentro de un comentario
    comparando `lastIndexOf('/*')` con `lastIndexOf('*/')`. En esa pantalla hay un filtro de ficheros
    `accept=".q43,.n43,.txt,.043,*/*"`, y el `/*` del comodín le hizo creer que se abría un comentario
    que no se cerraba nunca: **se quedó ciego desde la línea 84 hasta el final**, y lo mismo en
    `routes/index.js` y en `store/routes.js`. **Un censo que dice cero y no es cierto es peor que no
    tenerlo**, porque cierra la pregunta.
  - **ARREGLADO el 24 ago 2026.** El censo lee ahora el fichero como lo lee JavaScript —conoce las
    cadenas, las plantillas con sus `${}`, las expresiones regulares y los dos tipos de comentario— y
    sigue quitando los `//` línea a línea, porque la mitad de los comentarios de este producto viven
    DENTRO de una plantilla (son el JS que se sirve al navegador) y para el recorrido eso es una
    cadena. **Probado con un caso a mano: el censo de antes daba CERO sobre él y el de ahora lo caza.**
  - **La ventanita NO se ha tocado**: arreglarla es código de producto y el encargo del inventario lo
    prohíbe. Queda declarada en `ROJOS_CONOCIDOS` con su motivo, para que el barrido la nombre en vez
    de que su rojo parezca ruido. **Es tarea aparte, con encargo.**
- ⬜ **SEIS FICHEROS DE PANTALLA DESMONTADOS SIGUEN EN EL ÁRBOL (24 ago 2026): 1.584 líneas.** Este
  registro solo nombraba `orders.js`, y son seis: `orders.js` (1061), `discounts.js` (191),
  `shipping.js` (107), `feedback.js` (84), `reviews.js` (81) y `newsletter.js` (60). Ninguno está
  montado. Mismo criterio para los seis: retirar o revivir, no dejarlos a medias.
  ↪️ **Convertida a formato de orquestador el 31 ago 2026** — id `retirar-pantallas-muertas`.
- **DISA `create_order` multi-línea:** limitación heredada de la base e-commerce; los pedidos multi-línea entran con el flujo pedido→albarán→factura.
- ~~Arreglar `scripts/gate-avisos-badge.mjs`~~ — **ya no reproduce**: ejecutado el 2026-07-10 pasa **25 OK**.
  Si vuelve a fallar por la ruta de BD fija, reabrir con la salida del fallo.

## LA ESCALERA — el orden vigente (CANON §4)

> **Sustituye al "Roadmap futuro — módulos" y a la lista de la auditoría vs Holded.** No se ha perdido
> nada: **cada módulo de las dos listas está colocado abajo, en el peldaño que le toca por dependencia
> técnica**. El orden vive en `CANON.md` §4; aquí vive el detalle y la colocación.
>
> **Ya no hay "roadmap", ni "espera", ni capa aparte.** Lo que no está hecho está en un peldaño. Un
> módulo sin número no existe — y si aparece uno nuevo, se le busca peldaño, no una lista.
>
> **Sigue mandando la regla de siempre: no se inicia un paso sin encargo del dueño** (CANON §6). La
> escalera dice en qué ORDEN se apoyan las cosas, no que se construyan solas.
>
> *(Lo pendiente de **El Suelo** —Verifactu colaborador social, Balance, modelos AEAT, permisos Paso
> 1/2, conciliación…— NO está en la escalera: sigue en el Backlog de abajo. El Suelo es el umbral de
> admisión al mercado, no un peldaño de la ventaja.)*

### ⬜ 1 — Sincerar
Que los textos digan la verdad sobre lo construido. **HECHO en este encargo (17 jul 2026)**: la promesa
falsa de margen en la ayuda pública, el "Analítica lee el clúster viejo" de `DISEÑO.md` y el "Chart.js
desde CDN" de `MAPA_FUNCIONAL.md`. Origen: `docs/backlog-auditoria.md` (§8, 14 textos obsoletos) — el
resto de esa lista sigue ahí y se salda cuando toque.

### ✅ 2 — Margen  ·  HECHO (2026-07-17)
El dueño ve **cuánto gana**, no solo cuánto factura. Sin pedirle ni un dato nuevo: usa el WAC que
Bamburu ya calcula solo desde las compras.
- **PASO 0 (solo lectura) — el hallazgo que cambió la forma de la tarea:** la línea de venta no
  guardaba el coste… **ni siquiera de qué producto era**. `createInvoice` *recibía* el `product_id`
  (`schemas.js:196`) y lo **tiraba** al insertar, así que la analítica agrupaba por descripción
  (`ventas-metrics.js` lo confesaba en un comentario). No se puede congelar el WAC sin saber de quién
  es → el snapshot son **dos columnas**, no una.
- **Migración aditiva** (`models.js`, tras los addCol de A2): `invoice_items.product_id` ·
  `unit_cost` (WAC congelado) · `cost_source` (`'snapshot'` vs `'backfill'`) + índice. **Backfill una
  sola vez por bandera** (`migration_invoice_items_coste_backfill_2026_v1`), casando por descripción
  —el único puente que existía— con el WAC de HOY, **marcado `backfill`** porque no es el del día de
  la venta. Reversible: las columnas son aditivas y nada se reescribe.
- **Los 4 caminos vivos congelan** (`invoices.js`, helper único `snapshotCoste`): `createInvoice`
  (embudo de recurrentes/presupuestos/albaranes/pedidos), `createRectificativa`, `emitTicketSvc`
  (mostrador) y `emitSustitutivaSvc`. El muerto (`generateInvoice`, 410 por D1) se deja.
  **La F3 HEREDA el coste congelado del ticket** en vez de re-fotografiar: la venta ocurrió al emitir
  el ticket, y es el mismo hecho económico con otro papel.
  **No toca la huella:** `calcHash` come número, fecha, NIF, total y huella previa — nunca las líneas.
- **`NULL` no es cero, y esa es toda la tarea.** Servicio, digital, línea libre o físico nunca
  comprado → `unit_cost = NULL` = *"no lo sé"*. Se apartan como **"sin coste registrado"**: no entran
  en el beneficio y el informe **dice qué parte de las ventas queda fuera**. El margen % se calcula
  **solo sobre lo que tiene coste**, nunca sobre el total. Sin esto, este tenant declararía 985.106 €
  de beneficio al 93,5 % — una cifra preciosa y falsa.
- **Motor en `ventas-metrics.js`** (`margenResumen` · `margenPorProducto`), sobre el MISMO
  `countingSalesInvoices` que el resto: el ingreso del informe y el de la home no pueden discrepar.
  IVA fuera (se opera sobre `total_price`, la base). Los abonos **netean solos** (cantidad negativa →
  ingreso y coste restan a la vez).
- **Pantalla + export**: informe de Rentabilidad en `/admin/analytics` (beneficio, margen %, ingresos
  con coste, coste, aviso de lo que queda fuera, y desglose por producto con "—" donde no se sabe).
  **CSV**, con su fila TOTAL — *el encargo decía "XLSX/CSV/PDF", pero la Analítica **solo exporta
  CSV** (XLSX/PDF es de Contabilidad); añadirlos habría sido inventar el formato nuevo que el propio
  encargo prohibía.* Candado **`analytics.read`, el que ya existía**: sin permiso, 403 en vista,
  API y export — el export no es la puerta de atrás del permiso (CANON §3-bis, las dos puertas).
- **Verificado:** `verify-margen` **38/0** (BD desechable: IVA fuera, coste congelado, WAC que se
  mueve después y NO reescribe el pasado, los tres casos sin coste apartados, cuadre total vs. suma
  por producto, abono que netea, mostrador, idempotencia ×2, huella intacta) + `gate-margen-pantalla`
  **16/0** (navegador real, empleado sin permiso creado y borrado, idempotente en dos pasadas).
  Grupo nuevo del runner: `node scripts/run-gates.mjs margen`. Barrido `--all` **45/50**: los 5 rojos
  son ajenos — 3 pre-existentes por datos vivos y 2 por **precondición de datos** (0 propuestas
  pendientes en el tenant); `gate-nav-inicio-disa` **demostrado con `git stash`**: falla idéntico
  (32 OK, 2 fallos) con el código anterior, y `gate-propuestas-dormidos` pasa **39/0** al correrlo solo.
- **Cabos anotados, no descubiertos tarde:** (a) un **abono** congela el WAC de hoy, así que si el
  coste se movió entre la venta y la devolución, el neteo lo arrastra; (b) el backfill casa por
  nombre y **hay 25 productos homónimos** ("Difusor de bambú artesanal premium") → elige uno
  arbitrario; por eso va marcado `backfill`; (c) un negocio **solo de servicios** no tendrá margen:
  todo su ingreso caerá en "sin coste registrado" — correcto, pero hay que decidir qué se le enseña.
- **Realidad medida en el tenant de pruebas:** 113 líneas · base 985.106,95 € · **con coste solo
  63.460,90 € (6,4 %)**. *(El PASO 0 dijo 159 líneas: mi `LEFT JOIN` por nombre multiplicaba las de
  los 25 homónimos. El ratio aguantaba; el conteo no.)*
- ✅ **Reenganchada al menú (17 jul 2026).** La Analítica llevaba **viva y sin enlace desde U7
  (8-jul)**: respondía 200 y no había forma de llegar salvo tecleando la URL — por eso el informe no
  se encontraba. Área nueva **"Analítica" → "Informes"** (`/admin/analytics`), la **casa de los pasos
  3 y 4**. Usa `navPerms.analytics`, que **ya estaba declarado sin item que lo usara** (hallazgo de U7,
  ahora saldado). **Es un área y no un enlace directo por una razón de seguridad:** la rama `g.home`
  del riel **no pasa por `navFilter`**, así que la entrada se vería sin permiso y solo fallaría al
  pulsar; queda avisado en el código para quien la use algún día. **No se reenganchó nada más**:
  ~~`/admin/discounts` y `/admin/tags` siguen fuera por decisión del dueño (U7)~~ **⚠️ eso valía el
  17-jul; el 23-ago-2026 dejó de valer: `/admin/tags` se enganchó (B2) y `/admin/discounts` se
  DESMONTÓ (encargo CUPONES, `9e77f2b`)** — y `/admin/orders` y
  `/admin/shipping` siguen desmontados (404, D1/D2) — el gate lo afirma. **Verificado antes de
  enganchar:** la Analítica no lee **ni una tabla** del clúster viejo.
  Solo navegación: sin tocar el cálculo. Gate ampliado a **26/0**.
- **Dos hallazgos del reenganche, anotados y NO tocados (preexistentes, ajenos a este paso):**
  1. **Un empleado con CERO permisos ve el menú entero.** El filtro es
     `hasCustomPerms = !isAdmin && !isOwner && perms.length > 0`: sin permisos propios no se filtra
     nada. La puerta sigue cerrada (403 al pulsar), pero el menú enseña puertas que no se abren. Vale
     para TODAS las entradas, no solo esta.
  2. **`DISEÑO.md` §3.3 decía "no se fuerza una sexta área"** — y esta es la sexta. Decisión expresa
     del dueño (17-jul) y coherente con CANON §3-bis (las dos puertas): la puerta visual necesita
     puerta. El §3.3 se queda como regla para lo que venga; esta excepción está por escrito.

### ✅ 3 — Informes por área + plan financiero · **COMPLETO (17 jul 2026)**
Catálogo de las 5 áreas · Responsable de cliente · Bloque 1 (informes) · Bloque 2 (plan financiero).

#### ✅ Catálogo de piezas de las 5 áreas — **91 piezas inventariadas**
Con qué podrá montar informes el constructor del paso 4. Cada pieza, con su fuente y su permiso.
**Ninguna pieza sin dato se descartó**: se marcó "a habilitar" con lo que haría falta.
- **VENTAS 20/21** (`invoices.read` · fuente `ventas-metrics.js`) — todo existe salvo **vendedor**.
  *Producto y categoría solo son posibles gracias al paso 2* (`invoice_items.product_id`).
- **COMPRAS 14/17** (`purchases.read`) — falta **usuario que compró**; producto/categoría **parcial**:
  `supplier_invoice_items` solo tiene `concepto` libre — pero **un gasto puro no tiene producto por
  naturaleza** (un alquiler no es un artículo). No es carencia: es el dominio.
- **INVENTARIO 17/17** (`inventory.read`) — completo, lote/serie y bajo mínimo incluidos.
- **CONTABILIDAD 16/17** — completo salvo **IRPF soportado en compras**: `supplier_invoices` no guarda
  retención **por decisión explícita del código**, y es lo que bloquea el modelo 111 (ya en el Backlog).
- **CLIENTES 18/19** (`clients.read`) — completo; `clientesDormidos`/`umbralDormido` ya dan frecuencia
  y última compra.
- **○ Zona/provincia (ventas y clientes): el caso a no confundir.** La columna **existe** (la trajo
  Facturae) y está **vacía en 15 de 15**. No es pieza a habilitar: es captura de datos. Marcarla como
  "existe" engañaría al constructor del paso 4; hoy daría un único grupo "(sin provincia)".

#### 📋 Piezas a habilitar — su propio peldaño, ninguna era "barata y directa"
1. **Usuario en los documentos (ventas + compras).** Es UNA pieza, no dos: ningún documento guardaba
   quién lo hizo. **Resuelta a medias por el responsable, abajo** — el mostrador ya guarda quién cobra.
   Lo que queda (¿quién *tecleó* una factura con cliente?) exige pasar la sesión por 5 puntos de
   emisión, y uno es un **cron** (recurrentes: no tiene vendedor, tiene "automático"). Decisión de
   producto, no columna.
2. **Producto/categoría en facturas de gasto** — ver arriba: es el dominio, no una carencia.
3. **IRPF soportado en compras** — ya tiene sitio en el Backlog (modelo 111).

#### ✅ CRM — RESPONSABLE DE CLIENTE + atribución de la venta (17 jul 2026)
Función nueva de CRM que la analítica del paso 4 aprovechará. **Asignación solo a mano** (ni reparto
automático ni DISA — anotado como peldaño futuro por si algún día se quiere).
- **LA CASCADA DE TRES** (decisión del dueño), fuente única en `ventas-metrics.js`:
  **(1)** hay cliente → responsable del cliente, **derivado EN VIVO** · **(2)** si no, `emitted_by` →
  quien cobró, **congelado** (solo mostrador) · **(3)** si no → **sin asignar**.
- **La asimetría es el diseño, no un descuido.** El coste (paso 2) se congela porque es un HECHO del
  día de la venta; el responsable se deriva porque es una RELACIÓN VIVA: reasignar un cliente
  **reatribuye su histórico**, que es lo que un CRM debe hacer. Verificado que derivar es seguro: los
  clientes se **archivan**, nunca se borran, y hay **0 facturas con un `client_id` inexistente**.
- **La rama 3 salió del PASO 0, y el encargo no la preveía:** hay **4 facturas de serie F sin cliente
  y sin tipo** (junio) que no son mostrador **ni** tienen cliente — no las cubría ninguna de las dos
  reglas. Caen en "sin asignar" y el modelo queda cerrado ante cualquier caso futuro.
- **Migración aditiva**: `clients.responsable_user_id` + `invoices.emitted_by` + índices. Los clientes
  **nacen sin asignar** a propósito; la analítica se llena a medida que el dueño reparte.
- **Backfill del histórico del mostrador**: el dato ya existía en `activity_logs` ("Emitió ticket de
  mostrador" con `user_id`). **41 de 42 tickets** recuperados (1 sin log) — no nace vacío. Los 4 raros,
  correctamente sin emisor. No toca la huella: `emitted_by` no entra en `calcHash`.
- **Dimensión + filtro** en Analítica (Ventas y Clientes), con **"Sin asignar" como fila más**:
  esconderla descuadraría el total contra Ventas y nadie sabría por qué.
- **Dos puertas, dos candados:** ventas por responsable exige `analytics.read` **Y** `invoices.read`;
  clientes por responsable, `analytics.read` **Y** `clients.read`. Una pieza que cruza áreas exige
  **todos** los permisos que toca (CANON §3-bis), y si falta uno **se dice cuál** en vez de pintar un
  hueco mudo que se lea como "no hay datos".
- **Un responsable desactivado** cae en "sin asignar" sin perder el dato (el id sigue en la ficha) y su
  cartera vuelve sola al reactivarlo.
- Verificado: `verify-responsable` **27/0** (BD desechable, usuarios propios: asignar atribuye ·
  reasignar reatribuye el histórico · mostrador congelado que NO se mueve al cambiar el cliente · rama
  3 · cuadre Σ por responsable == total · desactivar/reactivar · idempotencia · huella y margen
  intactos) + `gate-margen-pantalla` ampliado a **33/0** (navegador: tarjeta, filtro, ficha con su
  desplegable, y el 403 cruzando áreas). Grupo `margen` del runner: **3/3**.

#### ⬜ Anotado como peldaño FUTURO (decisión del dueño: hoy NO)
- **Reparto automático de clientes / que DISA asigne el responsable.** La asignación es **solo a mano**
  a propósito. Si algún día se quiere, encaja aquí: el dato y la cascada ya existen, y DISA tendría que
  pasar por el servicio validado (`updateClientSvc`), nunca escribir la columna directa — patrón T5.
- **Usuario que TECLEA una factura con cliente** (el "vendedor" del catálogo, pieza ⚠ 1). Distinto del
  responsable: uno es *quién la hizo*, el otro *de quién es el cliente*. Exige decidir qué es una
  factura recurrente emitida por un cron ("automático") antes de tocar código.

#### ✅ BLOQUE 1 — Informes por área (17 jul 2026)
**Once informes** en `/admin/analytics` (los 10 nuevos + el de responsable, ya construido), en tres
pestañas, con **CSV único** y cada área tras `analytics.read` **+ el permiso de su área**.
- **Ventas**: por periodo (mes/trimestre/año, con su evolución) · por cliente · por responsable ·
  cobrado vs. pendiente. **Compras**: por proveedor · gasto por categoría (`expense_category`, ya
  poblada) · pendiente de pago por vencimiento. **Clientes**: ranking · dormidos (con su ritmo
  aprendido) · deuda vencida · nuevos por mes.
- **INVENTARIO y CONTABILIDAD, fuera a propósito**: ya se ven en Stock y en Libros y modelos.
  Duplicarlos crearía dos sitios que dicen lo mismo, y el día que discrepasen nadie sabría cuál creer.
- **Fuente única, ni una regla nueva**: todo se apoya en `countingSalesInvoices` (ventas),
  `countsAsPayable`/`openPayables` (compras) y `openDebts` (deuda). `ventasPorMes()` **no se tocó** —lo
  consume DISA y suma con IVA—: se le dio un hermano, `ventasPorPeriodo()`, que agrega por
  mes/trimestre/año, filtra por responsable y devuelve la **base sin IVA**.
- **Hallazgo del camino:** los tramos de vencimiento son los DEL MOTOR (`0-30`/`30-60`/`+60`, leídos de
  `pagos.js:69`), no unos inventados. Y **los abonos van en su propio tramo**: `openPayables` los
  incluye con importe NEGATIVO para que Σ cuadre, y `pagoState` les deja `tramo=null` porque **un abono
  no vence** — sin esa rama caían en "aún no vencida", una etiqueta falsa (no es un pago que no toca:
  es dinero que te deben) que además restaba y descuadraba el tramo.
- Verificado: `verify-informes` **27/0** — el gate no comprueba que "responda", comprueba que **CUADRE**:
  Σ por periodo == Σ por cliente == Σ por responsable == `ventasResumen.base`; mes/trimestre/año suman
  igual y agrupan distinto; el IVA fuera; la anulada no cuenta; Σ tramos == `openPayables.total`;
  y lo que no tiene dueño ni categoría **no se esconde** (o el total dejaría de cuadrar).

#### ✅ BLOQUE 2 — Plan financiero: objetivos vs. real (17 jul 2026)
El dueño fija metas de **facturación** y **beneficio**, por **mes/trimestre/año**, **globales o por
responsable**; la pantalla compara contra lo real y da la desviación en importe y en %.
- **LA DECISIÓN QUE LO SOSTIENE — beneficio = MARGEN, no el P&G.** El PASO 0 destapó que el encargo
  pedía las dos cosas y **son números distintos**: `cuentaPyG` resta TODOS los gastos (alquiler,
  software, sueldos); el margen solo el coste de lo vendido. Se eligió el margen (decisión del dueño)
  porque **(a)** cuadra en los tres alcances —global = Σ responsables + sin asignar— y el P&G **no
  puede**: el libro contable no sabe de responsables (un asiento de alquiler no es de nadie); y **(b)**
  es lo que un comercial puede mover. **El P&G se queda en Contabilidad como única verdad del resultado
  del negocio.** Con el mismo aviso de Rentabilidad: el margen solo juzga lo que tiene coste.
- **Migración aditiva**: `financial_targets` (tipo · periodo · clave · alcance · user_id · valor) con
  índice único por `(tipo, periodo, clave, alcance, COALESCE(user_id,0))` — el `COALESCE` porque en
  SQLite dos NULL son distintos y sin él "global" admitiría filas repetidas. Fijar dos veces
  **sustituye**; valor 0 **quita** la meta (sin botón aparte ni un estado "meta a cero" ilegible).
- **La clave habla la MISMA gramática que `clavePeriodo()`** (`2026-07` · `2026-T3` · `2026`) y su forma
  se valida al fijar. Si no, una meta con clave rara compararía contra nada y el plan diría "0 € real"
  tan tranquilo — el modo de fallo más silencioso de esta función.
- **Los niveles NO se fuerzan a cuadrar** (decisión del dueño): cada uno se fija a mano y la pantalla
  enseña lo real al lado, **con un texto que dice que un descuadre no es un error — son metas, no
  contabilidad**. Un periodo sin meta **no sale**: un plan lleno de ceros que nadie puso sería ruido.
- **Permisos:** ver el plan → `analytics.read` + `invoices.read`. **Fijar → solo owner/admin**, sin
  crear permiso nuevo (el candado más estricto que ya existe). El botón no es el candado: el servidor
  lo vuelve a comprobar (403 afirmado en el gate).
- Verificado: `verify-plan-financiero` **35/0** (los tres periodos, los dos alcances, el rango derivado
  de la clave —febrero bisiesto incluido—, **el global == Ana + el resto**, el aviso de sin-coste,
  sustituir sin duplicar, quitar con 0, las 5 claves imposibles rechazadas, idempotencia) +
  `gate-margen-pantalla` ampliado a **44/0** (navegador: las tres pestañas pulsadas, el plan y su 403).
  Probado además **por HTTP contra el servidor real** (meta de 500.000 € → −208.430,50 €, −41,7 %),
  limpiando las metas de prueba al terminar.

### Anotado del peldaño 3 (no bloquea; cada uno cuando toque)
- Las **4 piezas a habilitar** del catálogo (usuario que teclea · producto en gasto puro · IRPF
  soportado · provincia sin rellenar). Ver `docs/analitica/catalogo-piezas.md`.
- **Reparto automático / que DISA asigne el responsable** — hoy NO, por decisión del dueño.
Módulo de **informes predefinidos por área** (ventas, compras, clientes…) + **plan financiero**
(objetivos mes a mes vs. real). Va más allá de los KPIs sueltos del panel actual.
*Origen: auditoría Bamburu vs Holded (9 jul 2026), repaso con el manual funcional completo de Holded
(más detallado que la del 4 jul). Era "Analítica" en esa lista.*

### ✅ 4a — Constructor de analíticas · **LAS SIETE ÁREAS, HECHAS**

> ~~🟡 **VENTAS HECHO (17 jul 2026) · faltan las otras 4 áreas.**~~ **⚙️ CADUCADO, CORREGIDO EL
> 24 AGO 2026.** No se borra: era cierto el 17 de julio. **Hoy el constructor tiene SIETE áreas**, no
> una: ventas, compras, clientes, inventario, contabilidad, **agenda** (ficha D, 23 ago) y
> **catálogo** (productos parados, 23 ago). Medido en `constructor-analitica.js`, donde se declaran.
> Las dos últimas nacieron después de escribirse esta línea y nadie volvió a ella.


**La puerta visual ya existe**: el dueño cruza lo que quiere y elige cómo verlo, sobre sus datos.
Vive en `/admin/analytics` (el área "Analítica" que se creó al reengancharla — la duda del "dónde"
quedó zanjada ahí). Motor: `modules/erp/constructor-analitica.js`.

**LA DECISIÓN QUE DEFINE LA PIEZA — el constructor NO arma SQL.** Salió del mini-plan y es lo único
que impide que esta función rompa el proyecto: armar SQL con una allowlist (el patrón de
`query_database`, D1) protege los **permisos** pero **no las reglas de negocio**. Un gráfico que
consultara `invoices` por su cuenta contaría **anuladas**, contaría **tickets sustituidos** y las
**rectificativas no netearían** — y el dueño tendría un gráfico, hecho por él, que dice un total de
ventas distinto del de la pantalla de Ventas. No sospecharía nunca. Aquí la regla de conteo se aplica
**UNA vez en el origen** (`countingSalesInvoices`) y todo lo demás es agrupar sobre ese conjunto ya
verificado. **Afirmado contra el servidor real: las 5 dimensiones dan 973.267,93 €, lo mismo que el
informe de Ventas.** El coste es cargar líneas en memoria — que es lo que `countingSalesInvoices` ya
hacía; si un negocio llegara a cientos de miles, se acota por fecha.

- **9 dimensiones · 6 medidas · 4 gráficos** (barras · líneas · tarta · tabla), del catálogo del paso 3
  — ni una pieza inventada. Un campo sin `valor` en el mapa **no existe**: falla cerrado.
- **Permisos por campo**: cliente/tipo/provincia/forma de pago → `clients.read`; producto/categoría →
  `products.read`; todo el constructor → `analytics.read` + `invoices.read`. El desplegable filtrado
  **NO es el candado**: `cruzar()` lo revalida (probado pidiéndolo a mano → 403). **Filtrar** por un
  campo que no ves también se deniega: acotar y mirar el total sería deducir el dato.
- **El margen no se regala** ni cruzando por lo que sea: sin coste conocido → `—`, nunca 0 ni 100 %, y
  el aviso viaja con el cruce (solo si pides margen; si miras facturación sería ruido).
- **Paneles: de quien los crea** (decisión del dueño; compartir es 4b). Guardan la **RECETA, no los
  datos** — al abrirlos se vuelve a cruzar y **se revalidan los permisos de HOY**. Si guardaran
  resultados, un panel sería una fuga con fecha: perder un permiso y seguir viendo lo de antes. El
  `user_id` sale de la sesión, nunca del cuerpo; y va en el `WHERE` (nadie edita ni borra el de otro).
- Verificado: `verify-constructor` **34/0** (las 9 dimensiones dan el mismo total; una factura anulada
  de 5.000 € **no aparece**; permisos por campo y por filtro; paneles ajenos; idempotencia) +
  `gate-margen-pantalla` **56/0** (navegador: se cambia el cruce de verdad, el "—" en tabla, y las 5
  dimensiones == el informe de Ventas contra el servidor real).

#### ✅ 4a-bis — LAS OTRAS ÁREAS · **Compras · Clientes · Inventario (17 jul) + Contabilidad (18 jul) — COMPLETO**
El constructor ya cubre **cuatro áreas**, cada una con su GRANO propio y su regla de conteo ya
verificada — **no es "repetir ventas ×4"**: el motor se generalizó a un registro de áreas (`AREAS` en
`constructor-analitica.js`) manteniendo Ventas **idéntico** (su gate siguió en 34/0 tras el refactor).
- ✅ **COMPRAS** — grano: factura recibida. Regla: `countsAsPayable` (anuladas fuera; abonos netean);
  el pendiente, de `supplierInvoicePago` (el mismo que Pagos). Dimensiones: fecha · proveedor ·
  categoría de gasto · tipo (gasto puro / mercancía, por `entity_type`). Medidas: comprado sin IVA ·
  nº facturas · pendiente de pago. **Cuadra:** Σ por proveedor == Σ por categoría == 2.042,55 € (dato
  vivo), la anulada no cuenta.
- ✅ **CLIENTES** — grano: cliente activo (no línea). Facturación de `ventasPorCliente` (regla intacta),
  deuda de `clientDebt`. Dimensiones: tipo · provincia · forma de pago · perfil de cobro · responsable.
  Medidas: nº clientes · facturación · deuda · nº compras · **ticket medio del grupo** (facturado/compras,
  NO media de medias). **El mostrador sin cliente no se atribuye a nadie** — 800 €, no 850: correcto.
- ✅ **INVENTARIO** — grano: movimiento de stock. **Mide FLUJO, no niveles**, y es una verdad técnica
  del PASO 0: el stock actual y el WAC dependen del ORDEN del libro (media móvil) y **no se reconstruyen
  sumando** un periodo — el nivel ya vive en Stock. Medidas: nº movimientos · entradas · salidas · neto ·
  valor movido a coste. **Cuadra:** Σ neto == Σ(quantity) del libro (743 uds, 168 movimientos);
  entradas − salidas == neto.
- ✅ **CONTABILIDAD — 5ª área, HECHA (18 jul 2026, encargo del dueño).** El riesgo era que diera **otro
  beneficio que el P&G**; se evita por diseño: se **cuelga de `cuentaPyG`** (el motor del P&G, la misma
  fuente que Libros y modelos), **NO de `ledger_lines`** — la regla contable (solo grupos 6/7, importe =
  `haber−debe`, clasificación PGC) se aplica una sola vez, en el motor, y el constructor **solo agrupa**
  sus importes.
  - **Grano:** (mes, partida). `filas()` llama a `cuentaPyG` **por mes** (periodo atómico, recortado a
    `[from,to]`) y emite una fila por partida con importe ≠ 0. La contabilidad es **aditiva** sobre
    rangos disjuntos → agrupar por fecha (mes/trim/año) o por partida da el mismo total que el P&G.
  - **Dimensiones:** Periodo · Partida (las 17 líneas del PGC) · Sección (Explotación/Financiero/
    Impuestos). **Medidas:** Resultado (beneficio) · Ingresos · Gastos — es partir el MISMO importe
    neto por su signo, no medidas inventadas. **Solo se listan las partidas con dato** (3 de 17 hoy).
  - **CUADRE AL CÉNTIMO, dato vivo:** cruzar por periodo, por partida y por sección da **1.273.511,38 €**
    — exactamente `resultadoEjercicio` del P&G. `ingresos − gastos == resultado`. Un rango acotado (T2)
    también cuadra con el P&G de ese rango (679.063,86 €).
  - **Candado:** `invoices.read` (el mismo que la pantalla de Libros); sin él, 403 a mano. Un panel de
    Contabilidad guarda la RECETA: al abrirlo sin permiso → 403; con permiso se **recalcula** al P&G de
    hoy (probado con datos vivos). Y es **comparable en el tiempo** en 4b (tiene fecha).
  - Verificado: `verify-constructor` **82/0** (los 10 casos de Contabilidad: cuadre por las 3
    dimensiones, ingresos−gastos, solo-con-dato, candado, rango acotado, comparable) + `gate-margen-
    pantalla` **79/0** (navegador: la 5ª área cuadra con el P&G contra el servidor real).
- **Candado por área:** cada una tras su permiso base (invoices/purchases/clients/inventory `.read`);
  `areasPara` solo ofrece las que el usuario puede, y `cruzar()` lo revalida (403 a mano, probado). Un
  campo de otra área no vale (`serie` en compras → 400); un área inventada, 400.
- **Cruzar ENTRE áreas es 4b** ("combinar fuentes"): granos distintos no se suman sin decidir antes cómo.
- Verificado: `verify-constructor` **51/0** (Ventas intacto + las tres áreas cuadran cada una con su
  fuente + candado por área + el periodo que no aplica en clientes) · `gate-margen-pantalla` **66/0**
  (navegador: selector de área que redibuja, las 4 áreas cruzando contra el servidor real, área
  inventada cortada).

> **Ficha original del 4a (referencia):**
Motor tipo Power BI: **catálogo de campos en cristiano** (ventas, márgenes, clientes, compras, stock,
caja…), el usuario **elige cómo cruzarlos**, **elige el tipo de gráfico a su estilo** (no gráficos
cerrados) y **guarda los suyos**. **Pantalla de panel propia = la puerta del usuario visual**
(CANON §3-bis, "Las dos puertas").
> **PIEZA MAYOR: se planifica en su propio mini-plan al llegar su turno.** No se detalla aquí.
> Dos cosas que ese mini-plan tendrá que resolver, anotadas para que no se descubran tarde:
> **(1)** dónde vive la pantalla — `DISEÑO.md` §3.3 dice *"no se fuerza una sexta área"*, así que habrá
> que decidir si el panel es área, o vive como Inicio/DISA en el riel (que no son áreas). **(2)** los
> permisos: un constructor de gráficos es un lector de datos, y CANON §3-bis exige que no saque por un
> gráfico lo que la pantalla te niega — mismo problema que resolvió D1 con `query_database` de DISA
> (allowlist, falla cerrado); hay solución de la que copiar.

### ✅ 4b — Constructor avanzado · HECHO (17 jul 2026)
Cálculos propios · combinar fuentes · compartir paneles. *(Más tipos de gráfico: los 4 de 4a bastan;
ampliar es aditivo cuando se pida.)*
- ✅ **CÁLCULOS PROPIOS con evaluador SEGURO (sin `eval`).** El usuario escribe una fórmula sobre las
  medidas de su área (`beneficio / base * 100`). **No se usa `eval` ni `new Function`** —el proyecto no
  los usa en ningún sitio y no los introduzco: una fórmula es texto del usuario, y `eval` sobre eso es
  ejecución de código arbitrario en el servidor—. Se tokeniza, se valida contra las medidas del área
  (variable desconocida → 400), se comprueba que el RPN esté completo (`base /` → 400) y se evalúa con
  un mini-intérprete de aritmética. **Un valor sin dato propaga NULL** (margen sin coste no da 100 %);
  **división por cero → null, no Infinity.** Se compila al GUARDAR también: no se guarda una receta rota.
- ✅ **COMBINAR FUENTES = comparar áreas EN EL TIEMPO.** La única dimensión común a
  ventas/compras/inventario es la **fecha**, así que "combinar" **no es sumar granos distintos** (una
  línea de venta y una factura de compra no se suman): es poner cada área como **su propia serie** sobre
  el eje temporal — "facturación vs. gasto por mes". Cada serie sale del `cruzar` de SU área (regla
  intacta) y **revalida su permiso**; clientes no entra (no tiene fecha). Donde un área no tiene dato
  ese periodo, va **NULL** (un hueco, no un 0). Afirmado: comparar ventas+compras deja ventas en 850,
  no la contamina.
- ✅ **COMPARTIR PANELES.** `analytics_panels.compartido` (aditivo). Un panel compartido lo ve el
  equipo, pero **guarda la RECETA, no los datos**: al abrirlo se re-cruza y **se revalidan los permisos
  de hoy** — un panel de Compras compartido **no se abre** para quien no tenga `purchases.read` (falla
  cerrado, ya lo hacía la arquitectura de 4a). Solo el dueño comparte/descomparte/borra (WHERE
  user_id); compartir no es ceder el control. La lista separa "los míos" de "compartidos contigo (autor)".
- Verificado: `verify-constructor` **72/0** (evaluador: inyección/variable falsa/incompleta/÷0 todas
  cortadas; comparar sin sumar granos + revalida permiso; compartir la receta no los datos) +
  `gate-margen-pantalla` **76/0** (navegador: cálculo propio con su ayuda, comparar 2 series, candado
  de 4b). Grupo margen 6/6.
- **Bug propio cazado, la lección de C4b otra vez:** un `\n` dentro de un `confirm(...)` en el JS de la
  pantalla se convirtió en salto de línea REAL al emitirse desde el template literal, rompiendo todo el
  script de cliente (invisible a `node --check`, que valida el template como string). Quitado el `\n`.

> **La escalera de analítica (pasos 2-4b) queda cerrada** salvo el paso 6 (dashboards personalizables:
> componer el Inicio con paneles guardados — ahora es posible porque los paneles existen) y la decisión
> pendiente de **Contabilidad en el constructor**.

### ✅ 5 — DISA predictiva · VALIDADO por Ibrahim en pantalla (21 jul 2026)
Previsión de caja **3/6/12 meses** · detección de anomalías · agente que avisa. Es "DISA como producto
proactivo/predictivo" — lo que el mapa de capas prometía y nunca tuvo número.
**Usa el motor de 4a para MOSTRAR: DISA analiza, no dibuja.**
*No reabre el Eje B (✅ COMPLETO, D0–D5f, seis propuestas de proactividad): aquello era DISA que
**prepara y propone**; esto es DISA que **predice**.*

- **PIEZA 1 — EL VIGÍA (motor de detección) · ✅ VALIDADA por Ibrahim (21 jul 2026).**
  Motor `modules/erp/vigia.js` + ruta/pantalla `modules/erp/routes/vigia.js` (`/admin/vigia`, gate
  `analytics.read`) + entrada de menú en Analítica. **NO hace sus propias cuentas:** cada hallazgo toma
  la cifra TAL CUAL del motor de su área —el mismo que pinta la pantalla— así que es imposible que
  contradiga a Cobros/Pagos/Ventas/Plan. Seis detectores: deuda de cliente vencida (`openDebts`,
  `cobros.read`) · cliente que se duerme (`clientesDormidos`, `clients.read`) · caída de facturación y
  de margen mes vs. mes anterior (`cruzar`, área Ventas, `invoices.read`) · desvío del plan
  (`planFinanciero`, `invoices.read`) · pago a proveedor que vence pronto (`openPayables`,
  `purchases.read`). **Solo lectura**, sin persistencia (se calcula en vivo) y **sin tocar
  WRITABLE_TABLES**. Permisos por detector: un empleado sin el permiso de un área no recibe sus
  hallazgos (van a `sinPermiso`) y forzarlos da 403. Umbrales fijos documentados en el código (vencida
  ≥1 d · caída ≥20% · desvío ≥10% · pago ≤7 d); su pantalla de configuración es pieza posterior.
  Verificado: `test-vigia` (33/0, lógica: cuadre + no-inventa + detecta + permisos), `verify-vigia`
  (cuadre sobre datos reales: deuda €232,75 = Cobros, pago €55 = Pagos), `gate-vigia-pantalla` (13/0,
  navegador: pinta 58 hallazgos reales, menú, candado por pantalla, 0 errores JS/CSP). Pieza posterior:
  previsión de caja, persistencia visto/descartado (en tabla `disa_*` fuera de WRITABLE_TABLES) y el
  agente que avisa.

- **PIEZA 2 — LA VOZ (narración + decisión propuesta) · ✅ VALIDADA por Ibrahim (21 jul 2026).**
  Módulo `modules/erp/voz.js` (función PURA `hallazgo → aviso`) + ruta/vista en `modules/erp/routes/vigia.js`
  (API `/api/erp/vigia/avisos` + tarjetas en `/admin/vigia`, encima del detalle crudo). Viste cada
  hallazgo del vigía con **(a) qué pasa + desde cuándo** y **(b) decisión propuesta** (jamás un hueco
  vacío). **CERO CIFRAS INVENTADAS:** el texto se compone por PLANTILLAS por tipo de detector, rellenadas
  SOLO con los campos limpios del hallazgo (`cifra`, `fecha`, códigos de `ref`); ningún número sale de
  IA ni se recalcula. El nombre del cliente/proveedor y el detalle exacto (de X a Y, objetivo/real) se
  muestran VERBATIM desde el `titulo`/`motivo` del propio vigía (su texto, sus números → imposible
  contradecirle); la decisión referencia la factura por su código, no por un nombre reparseado (que en
  datos reales puede llevar payload XSS: se escapa siempre al pintar). **NO EJECUTA:** solo texto, sin
  botón/formulario/enlace de acción; no manda nada ni toca datos de negocio. **Sin persistencia, sin
  consultas propias a BD, sin reabrir permisos:** hereda el filtrado del vigía (sin permiso de un área
  no hay hallazgo → no hay aviso; forzarlo da 403). **No toca** el motor del vigía, los motores de área,
  el constructor, Verifactu, KPIs ni WRITABLE_TABLES.
  Verificado: `test-voz` (87/0, lógica: cero cifras inventadas + cuadre aviso↔hallazgo + siempre decide
  + no ejecuta + permisos + trazable), `verify-voz` (datos reales *desarrollo*: 58/58 avisos cuadran con
  su motor y 0 dígitos inventados), `gate-voz-pantalla` (16/0, navegador: 58 tarjetas con su decisión,
  importe idéntico a la API, 0 controles de acción, candado heredado + 403, 0 errores JS/CSP).
  Regresión: `gate-vigia-pantalla` 13/0 y grupos `infra` (XSS/CSP/safe-error) + `margen` (motores) 14/14
  en verde; los 2 rojos preexistentes (`gate-avisos-pantalla`, `verify-avisos-crm-riesgo`) son ajenos
  (campana/CRM), documentados en `run-gates`. **NOTA DE PRODUCTO para validación:** las plantillas de
  decisión del encargo nombran al `[cliente]`/`[proveedor]` y el valor `[X]` del mes anterior; el vigía
  NO los expone como campos limpios (solo dentro de `titulo`/`motivo`), así que la decisión nombra la
  factura por su código y el nombre aparece en la cabecera del aviso (verbatim). Si se prefiere el nombre
  DENTRO de la frase de decisión, la vía limpia sería un campo `datos:{}` aditivo en el vigía (relajar
  "no tocar el vigía") — queda a decisión de Ibrahim. Pieza posterior: previsión de caja + la capa de
  EJECUCIÓN (recordatorios, correos) que sí acciona la decisión que la voz solo propone.

- **PIEZA 3 — EL DIBUJO (gráfico de apoyo por aviso) · ✅ VALIDADA por Ibrahim (21 jul 2026).**
  Módulo `modules/erp/dibujo.js` (compone una RECETA por tipo de aviso) + `public/js/grafico-constructor.js`
  (el render del constructor alojado UNA vez, para reutilizarlo sin duplicarlo) + enganche en
  `modules/erp/routes/vigia.js` (la API `/avisos` adjunta la receta; la vista pinta bajo cada aviso un
  gráfico perezoso). **REUTILIZA EL MOTOR DEL CONSTRUCTOR, no construye uno nuevo:** el gráfico se obtiene
  pasando la receta al MISMO endpoint `/api/erp/analytics/constructor/cruzar` y dibujándolo con la MISMA
  librería (Chart.js, mismo vendor local) — imposible que dé una cifra distinta del constructor hecho a
  mano. **NO se toca `analytics.js`** (el constructor): el render se aloja aparte y se reutiliza; `vigia.js`
  no hace ni un `new Chart(`. Recetas por tipo: caída de facturación/margen → `ventas·fecha·(base|beneficio)·mes`
  (EXACTAS: es la misma `cruzar` que dio la cifra del vigía); desvío del plan → serie real por periodo
  (hueco: el constructor no tiene medida "objetivo"); pago → `compras·proveedor·pendiente` (hueco: no hay
  dimensión "vencimiento"; misma fuente que Pagos); deuda/dormido → `ventas·fecha·base` filtrado por ese
  cliente (hueco: el constructor no tiene área de cobros/antigüedad; el nombre del filtro se resuelve
  `client_id→name`, solo lectura, un rótulo — no una cifra). **Permisos heredados:** `cruzar` revalida el
  permiso del área; quien ve un aviso pero no el área de su gráfico recibe una nota honesta ("no puedes ver
  este gráfico"), no un gráfico inventado. **Solo lectura**, sin persistencia, sin tocar motores/Verifactu/
  KPIs/WRITABLE_TABLES. Verificado: `test-dibujo` (32/0: receta==cruce a mano + punto==cifra + mismo motor),
  `verify-dibujo` (real *desarrollo*: 58/58 recetas cuadran; deuda María García López y pago Gabriela Gil
  55 € = Σ openPayables), `gate-dibujo-pantalla` (13/0: gráfico dibujado por Chart.js del constructor,
  pintado==API, un solo motor, candado heredado + nota de 403, 0 errores). Regresión: `gate-vigia-pantalla`
  13/0, `gate-voz-pantalla` 16/0, `gate-margen-pantalla` 79/0 + `verify-constructor` 82/0 (el constructor
  INTACTO), `infra` (XSS/CSP) 15/15 verde. **NOTA DE PRODUCTO para validación:** solo caída de facturación y
  de margen son EXACTAS; los otros 4 son el gráfico expresable más cercano con su hueco anotado en pantalla,
  porque el constructor no tiene hoy área de cobros/antigüedad, medida de objetivo ni dimensión de
  vencimiento. Si se quiere el gráfico "ideal" de esos tipos, es un paso posterior (ampliar el constructor).
  Alternativa señalada: extraer `dibujar()` de `analytics.js` al módulo compartido (fuente única real de
  render, tocando el constructor) — queda a decisión de Ibrahim.

- **PIEZA 5 — DÓNDE TE ESPERA (priorización + Inicio + barrido de permisos) · ✅ VALIDADA por Ibrahim
  (21 jul 2026). Con ella, el peldaño 5 (detección proactiva) queda CERRADO.**
  Módulo `modules/erp/prioridad.js` (ordena y etiqueta los avisos ya producidos por las piezas 1-3) +
  enganche en `routes/vigia.js` (la API `/avisos` ordena; la lista sale por grupos con píldora) + bloque
  nuevo en el Inicio (`views/disaHome.html.js`). **Solo ordena y coloca; no toca la detección, la voz ni
  el dibujo, ni crea cifras.** (A) PRIORIZACIÓN — grupos: ALTA = deuda·pago·desvío · MEDIA = caídas ·
  BAJA = dormido; dentro del grupo, por importe (€) de mayor a menor, y sin € (dormido) por urgencia
  (días); desempate estable. La lista de `/admin/vigia` sale ordenada, el de más impacto arriba, con
  cabecera de grupo y píldora Alta/Media/Baja por aviso. (B) INICIO — bloque compacto "Vigía de DISA ·
  lo más importante" con los top 5 (texto + prioridad) y enlace a `/admin/vigia`; carga por `fetch`
  `/avisos?top=5`, es lo MISMO que la lista (misma fuente, mismo orden) — no puede discrepar; **no se
  reestructura el resto del Inicio**, solo se añade el bloque. **Permisos heredados en los 4 puntos**
  (lista cruda, voz, gráfico, Inicio): quien no ve un área no ve su aviso por ningún lado, ni asoma en
  su Inicio, y da 403 al forzar (`?detector=` y `cruzar area=`). **`?top=N` no adjunta gráfico** (el
  Inicio no dibuja). Solo lectura, sin persistencia, sin tocar el constructor/motores/Verifactu/KPIs/
  WRITABLE_TABLES. Verificado: `test-prioridad` (13/0: grupos + orden + no inventa), `gate-espera-pantalla`
  (20/0: [1] orden Alta→Media→Baja con cabeceras y píldoras; [2] Inicio asoma top 5 y COINCIDE con la
  lista; [3] BARRIDO DE PERMISOS en un solo pase — sin `purchases.read` el pago no aparece en voz/tabla/
  gráfico/Inicio y da 403 en `/avisos?detector=pago` y `cruzar area=compras`). Regresión: `gate-vigia`
  13/0, `gate-voz` 16/0, `gate-dibujo` 13/0, `infra` (XSS/CSP) 15/15, `verify-constructor` verde.
  **Rojo AJENO (no propio):** `gate-nav-inicio-disa` deja 2 rojos porque el tenant *desarrollo* tiene
  **0 propuestas de DISA pendientes** (1 enviada + 27 descartadas) y ese gate necesita ≥1 para probar el
  badge de `disa_proposals` (dato vivo, nada que ver con esta pieza; "cero errores JS al cargar /admin"
  pasa — el bloque nuevo carga limpio). Ejemplo real (desarrollo): arriba, prioridad ALTA, las deudas de
  María García López de mayor importe (F2026-0023 €60493,95, F2026-0022 €12100, …); pagos y caídas
  intercalados por €; el cliente dormido, al final (BAJA). **Al validar Ibrahim en pantalla, el peldaño 5
  (detección proactiva) queda cerrado.**

### ✅ 6 — Dashboards personalizables · INICIO PERSONALIZABLE VALIDADO por Ibrahim en pantalla (21 jul 2026)
El usuario compone su **Inicio** con sus propios gráficos guardados en 4a. Aquí entra también el
**sidebar personalizable** (ocultar/reordenar módulos) — *de las "mejoras menores" de la auditoría vs
Holded*: es la misma idea (que el usuario ordene su casa) y comparte la decisión de dónde se guarda la
preferencia.

- **INICIO PERSONALIZABLE (opción C · híbrido) · ✅ VALIDADO por Ibrahim en pantalla (21 jul 2026).
  Con ello, el peldaño 6 queda CERRADO.**
  El Inicio se compone en una **rejilla** de bloques: los **paneles guardados del constructor** (4a/4b) +
  los **bloques nativos** que el Inicio ya tenía (cifras del negocio, avisos, vigía de DISA). Colocar =
  añadir/quitar, reordenar (drag, Sortable.js ya vendido) y **redimensionar** (ancho/alto en la rejilla).
  **DEFAULT POR EMPRESA (no por rol):** en PASO 0 se comprobó que los permisos se aplican POR USUARIO
  (`user_permissions`; las tablas de roles con nombre existen pero NO gobiernan el acceso — `requirePerm`/
  `can()` solo miran `user_permissions`), así que el default del dueño es uno de empresa, con filtrado por
  permiso de usuario. **Cascada:** `usuario:<id>` > `empresa` > `fábrica` (semilla en código, nunca lienzo
  en blanco). **Dos niveles de edición:** el dueño edita el default de empresa; cada usuario retoca su
  capa. **Reset** en los dos: usuario → "volver al de mi empresa"; dueño → "volver al de fábrica".
  Módulos: `modules/erp/inicio-layout.js` (cascada + persistencia + paleta + saneo por permiso) +
  `modules/erp/routes/inicio.js` (API `/api/erp/inicio/{layout,bloques,datos,empresa}`) + tabla nueva
  `dashboard_layouts` (`scope` PK: `fabrica`|`empresa`|`usuario:<id>`, `blocks` JSON) — **FUERA de
  WRITABLE_TABLES**, es config de presentación por tenant. La vista `views/disaHome.html.js` cambia SOLO
  la región de "esto pide tu atención" (las viejas cifras/fila-de-avisos/#dhVigia) por la rejilla; el
  saludo, la tarjeta de DISA y el chat quedan intactos. **REUTILIZA el motor del constructor:** un panel
  se pinta pasando su receta a `/constructor/cruzar` + `grafico-constructor.js` (Chart.js, mismo vendor) —
  **cero cifras propias, cuadra al céntimo** con el constructor. **PERMISOS heredados:** un bloque de un
  área que el usuario no ve NO aparece en la paleta, NO se pinta y NO se le cuela (ni el del default del
  dueño); 403 al forzar (`PUT /inicio/layout` con panel ajeno, o `cruzar area=`). Solo lectura de negocio:
  guarda la COLOCACIÓN, no deriva ni escribe cifras. Verificado: `test-inicio` (22/0: cascada + dos
  niveles + reset + omisión por permiso + paleta + normalizar + no-escribe), `gate-inicio-pantalla` (19/0,
  los 8 criterios con datos reales: fábrica montada, colocar/redimensionar/persistir un panel, cuadre al
  céntimo con el constructor, default de empresa visto por un empleado, retoque propio, resets, y permisos
  con 403). Regresión: `gate-espera-pantalla` 20/0 (actualizado: la vigía asoma ahora como bloque de la
  rejilla), `gate-vigia/voz/dibujo-pantalla`, `infra` (XSS/CSP) 15/15, `verify-constructor` verde. **Rojo
  AJENO (no propio):** `gate-nav-inicio-disa` deja 2 rojos por 0 propuestas de DISA pendientes en el tenant
  (badge de `disa_proposals`, dato vivo); "cero errores JS al cargar /admin" PASA (la rejilla carga limpia).
  Pieza posterior (anotada, no en esta tarea): el **sidebar personalizable** (ocultar/reordenar módulos).
  **Al validar Ibrahim en pantalla, el peldaño 6 queda cerrado; después, el peldaño 7 (primer oficio:
  servicios profesionales).**

### ✅ 7 — Servicios profesionales · **1er oficio** · **CERRADO (28 jul 2026)**
**Agenda** + **control de tiempo facturable** + **rentabilidad por proyecto**. Es la primera "cara por
oficio" (CANON §7: interfaces por profesión).

> **PELDAÑO CERRADO el 28 jul 2026 con la PIEZA 6 (puerta pública de reserva).** Las seis piezas
> entregadas y verificadas: **1** el proyecto · **2** registro de tiempo · **3** facturar horas ·
> **4** rentabilidad (contable + coste de las horas) · **5** sistema de citas (motor + agenda interna),
> más **Agenda sencilla** (capa de presentación) · **6** puerta pública de reserva. Un negocio de
> servicios puede hoy: publicar su página de reservas, recibir citas 24 h, atenderlas, cobrarlas por los
> motores de siempre y ver qué le renta. **Queda anotado y NO bloquea:** el **control horario (fichaje)**
> y la **agenda del CRM** de la lista de abajo no se construyeron — no estaban en ningún encargo, y el
> dueño decide si les da número propio o entran en otro peldaño.
> **⬅️ EL PUNTERO DE LA ESCALERA PASA AL PELDAÑO 8 (Salud / bienestar · 2º oficio).**
Aquí aterrizan, de las listas viejas:
- **Citas / Agenda** (iba marcada 🔺 prioritaria en el roadmap).
- **CRM comercial → su agenda/calendario** *(el **embudo/oportunidades** está **✅ HECHO 2026-07-09** —
  no se reabre; lo que quedaba pendiente era su agenda)*.
- **Control horario (registro de jornada)** — el fichaje, hermano del tiempo facturable.
- **Rentabilidad por proyecto** (era "Proyectos / rentabilidad").

- **PIEZA 1 — EL PROYECTO (entidad + pantalla) · ✅ VALIDADA por Ibrahim en pantalla (21 jul 2026).**
  Primera pieza del peldaño 7: SOLO la entidad "proyecto" y su pantalla de gestión;
  el registro de tiempo, facturar horas, rentabilidad y calendario son piezas 2-5 y NO entran hoy.
  Espejo EXACTO del patrón de clientes. Tabla `proyectos` (migración aditiva e idempotente, sin DROP):
  `codigo` PRY-NNNN (contador `code_counters`, no editable), `nombre`, `cliente_id`/`responsable_id`
  (FK lógicas OPCIONALES, resueltas EN VIVO por LEFT JOIN como el responsable del peldaño 3), `modo_cobro`
  (lista cerrada `horas`|`precio_cerrado`), `tarifa_hora`/`precio_cerrado` (según modo; el otro a null),
  `fecha_inicio`/`fecha_fin_prevista`, `estado` (`abierto`|`cerrado`), `active` (archivar-no-borrar),
  `notas`. **FUERA de WRITABLE_TABLES** (DISA no la escribe). Servicio validado compartido
  `modules/erp/routes/proyectos.js` (create/update/archive/restore con zod + `.status`), pantalla
  `/admin/proyectos` (buscador nombre/código, filtro Activos/Archivados, paginación 25, alta/edición/
  ficha/archivar/restaurar), permisos nuevos `proyectos.read`/`proyectos.edit` (bypass owner/admin,
  `requirePerm` en TODAS las rutas incluidas las VISTAS — M2), entrada "Proyectos" en el rail (provisional,
  en Ventas; oculta sin `proyectos.read`). Verificado: `test-proyectos` 20/0 (alta horas/precio, modo
  fuera de lista → 400, código correlativo/único/no-editable, editar, archivar+restaurar, cliente/
  responsable en vivo, migración idempotente sin DROP), `gate-proyectos-pantalla` 18/0 (entrada aparece y
  se llega pulsándola, CRUD desde pantalla, buscador/filtro, permisos con 403, 0 errores JS). Regresión
  14/14 verde (actividad-etiquetas 32, XSS/CSP, constructor 82). **Ventas (facturado sin IVA) sigue
  973.267,93 €**; Verifactu y las 5 áreas del constructor intactas. Commit `dfd20ca`. Pieza siguiente:
  PIEZA 2 — registro de tiempo (con la tarifa de la persona). **Al validar Ibrahim, esta pieza se cierra;
  el peldaño 7 sigue abierto hasta completar sus piezas.**

- **PIEZA 2 — REGISTRO DE TIEMPO · ✅ VALIDADA por Ibrahim en pantalla (21 jul 2026).**
  Registro por **cronómetro** (empezar/parar) y por **entrada manual**; **un solo cronómetro activo por
  persona** (arrancar uno nuevo finaliza el anterior). Cada entrada = proyecto (Pieza 1) + descripción +
  **duración EXACTA en segundos, sin redondeos** + **facturable/no facturable**. El **importe se calcula
  EN VIVO con la tarifa de la PERSONA** (nueva columna `admin_users.tarifa_hora`, la fija el dueño/admin en
  Usuarios), con la **tarifa del proyecto de respaldo** si la persona no tiene, o "— sin tarifa" si no hay
  ninguna (no inventa un 0). Vive **dentro de la ficha del proyecto** (lista + total de horas + total
  facturable) y en **pantalla propia `/admin/tiempo` con vista semanal** (cronómetro en vivo + lista por
  día + totales). Tabla nueva `time_entries` (aditiva, idempotente, sin DROP; índice único parcial = un
  cronómetro por persona; **FUERA de WRITABLE_TABLES**). Servicio validado `modules/erp/routes/tiempo.js`
  (start/stop/create/update/delete con `.status`). **Permisos nuevos `tiempo.read`/`tiempo.edit` +
  PROPIEDAD:** cada uno edita las suyas; dueño/admin (bypass) las de cualquiera; `requirePerm` en TODAS
  las rutas incluida la vista; sin `tiempo.read` no ve la entrada ni entra por URL (403). Eliminar =
  **ocultar** (no destruir). **FUERA:** facturar horas, rentabilidad, calendario (piezas 3-5); no se
  enlaza `project_id` a facturas. Verificado: `test-tiempo` 23/0 (cronómetro sin redondeo · un solo activo
  por persona · manual · facturable · importe con respaldo del proyecto / sin tarifa · propiedad + edición
  dueño/admin · ocultar · total por proyecto · migración idempotente), `gate-tiempo-pantalla` 17/0
  (cronómetro y manual desde pantalla, importe cuadrado, ficha de proyecto con total, vista semanal,
  permisos con 403 y propiedad, 0 errores JS). Regresión 9/9 verde (actividad-etiquetas 32, XSS/CSP,
  `gate-proyectos` 18/0) + constructor. **Ventas (facturado sin IVA) sigue 973.267,93 €**; Verifactu
  intacto. Pieza siguiente: PIEZA 3 — facturar horas. **NO se cierra sin que Ibrahim valide en pantalla.**

- **PIEZA 3 — FACTURAR HORAS · ✅ VALIDADA por Ibrahim en pantalla (21 jul 2026).** *(Además, a petición
  suya, «Proyectos» pasó a ÁREA PROPIA del rail, fuera de Ventas — commit da86ccd.)*
  Lleva las **horas facturables** de un proyecto (Pieza 2) a una **factura REAL**. **Cero camino nuevo de
  emisión**: reutiliza `createInvoice` del motor (correlativo + hash Verifactu + asiento contable + cola
  T2). Pantalla `/admin/facturar-horas`: eliges proyecto (+ rango de fechas opcional) → salen sus horas
  facturables con importe → seleccionas → **vista previa** que agrupa **una línea por (tarea + tarifa)**
  (cantidad = horas sumadas, precio = tarifa/hora) → IVA (por defecto el de la empresa) e **IRPF** editables
  → "Generar factura" → te lleva a la factura. **Cliente = el del proyecto** (sin cliente → 400 "asigna un
  cliente"; se avisa en la propia pantalla). **Entrada sin tarifa no se factura** (400). **"Facturada" se
  deriva EN VIVO**: `time_entries.invoice_id` puesto **Y** la factura enlazada `emitida`; si la factura se
  **anula, la entrada se libera sola** (sin tocar el motor de anulación). Una entrada facturada **no se
  edita ni elimina** (409, guarda en `tiempo.js`) y luce **🔒 Facturada** en la vista semanal y en la ficha
  del proyecto. **Migración aditiva**: columna `time_entries.invoice_id` + índice (sin DROP; `time_entries`
  sigue **FUERA de WRITABLE_TABLES**). **Permiso `invoices.create` en TODAS las rutas incluida la vista**
  (no por propiedad: quien puede facturar factura las horas del equipo). Ficheros: `models.js` (columna +
  índice), `schemas.js` (`facturarHorasSchema`), `routes/facturar-horas.js` (nuevo: servicio + vista),
  `routes/tiempo.js` (`SELECT_BASE` con LEFT JOIN a `invoices`, `facturada` en `conImporte`, guarda
  `noFacturada`), `routes/proyectos.js` (badge en la ficha), `layout.js` (nav + permiso), `routes/index.js`
  (mount). Verificado: `test-facturar-horas` 31/0 (qué entra/qué no · agrupación tarea+tarifa · **cuadra al
  céntimo** · marcado/bloqueo · **anular libera** · sin tarifa/sin cliente → 400 · otro proyecto → 400 ·
  IVA override + IRPF · migración idempotente), `gate-facturar-horas-pantalla` 21/0 (menú + pantalla ·
  facturables · previa cuadrada · **factura REAL emitida cuadrando 300+63=363** · entradas facturadas y
  bloqueadas · permisos 403 y candado por permiso, no por bypass · 0 errores JS · **neto-cero en Ventas**
  tras crear+anular). Nuevo grupo de regresión `servicios` en `run-gates.mjs` (proyectos + tiempo + facturar
  horas + `verify-constructor`): **7/7 verde**. **Ventas (facturado sin IVA) sigue 973.267,93 €**; Verifactu
  y el constructor intactos. **RESIDUO por diseño**: la factura de prueba del gate se anula (permanece en la
  cadena inmutable, neto-cero en Ventas). **FUERA:** rentabilidad por proyecto (pieza 4, ahí se enlaza
  `project_id` a facturas/compras) y calendario (pieza 5). **NO cerrar en Notion sin validación en pantalla.**

- **PIEZA 4 (parte 1) — RENTABILIDAD POR PROYECTO · 🟡 ENTREGADA (21 jul 2026), pendiente de validación en
  pantalla.** Etiqueta de proyecto (`project_id`, FK nullable, leída EN VIVO) en las **dos** tablas que
  postean al P&G: **factura de venta** (`invoices`, cubre venta + abono/rectificativa) y **factura recibida**
  (`supplier_invoices`, cubre compra-mercadería + gasto + abono de proveedor). La "compra directa"
  (`purchases`) queda FUERA a propósito: es stock/activo, no postea a grupos 6/7. **Hallazgo clave de la
  auditoría:** `cuentaPyG` es una vista del **libro diario**, no de los documentos → el filtro por proyecto
  resuelve el asiento → su documento (`origin_type`/`origin_id`, ya indexado) → `project_id`, **EN VIVO**
  (sin columna nueva en el diario, sin tocar el posteo ni Verifactu). `cuentaPyG(db,from,to,{project})`
  ACOTA sin cambiar la matemática: `<id>` = ese proyecto; `null` = estructura (no asignado); sin opts =
  todo. **Regla dura verificada: Σ(P&G de cada proyecto) + estructura = P&G total, al céntimo.** Motor nuevo
  `modules/erp/rentabilidad.js` (rentabilidadProyecto/comparativaProyectos, única fuente = P&G filtrado).
  **Panel** en la ficha del proyecto (ingresos facturado sin IVA − gastos = resultado + margen %; **cobrado**
  aparte como caja, no cambia el resultado). **Comparativa** `/admin/rentabilidad` (lista por proyecto +
  estructura + TOTAL, marca en **rojo** los que pierden). **Selector "Proyecto"** en el detalle de la factura
  de venta y de la recibida (reasignable, en vivo; en venta es campo NO fiscal fuera del hash) + en el alta
  de factura recibida. **Auto-etiqueta:** la factura de "Facturar horas" nace con su proyecto; la
  rectificativa hereda el de la original (el abono netea dentro del proyecto). **Permisos:** la etiqueta la
  pone quien edita el documento (invoices.create / purchases.create); el panel y la comparativa exigen
  **proyectos.read Y invoices.read** (candado AND en TODAS las rutas incluida la vista; navFilter admite
  array de permisos; sin ambos: ni menú ni URL, 403). Migración aditiva/idempotente, sin DROP; ambas tablas
  siguen FUERA de WRITABLE_TABLES. Ficheros: `models.js` (2 columnas + índices), `contabilidad-pyg.js`
  (`pygRows` + opts), `rentabilidad.js` (motor, nuevo), `routes/rentabilidad.js` (nuevo), `routes/proyectos.js`
  (panel), `routes/invoices.js` (endpoint proyecto + selector + rectificativa hereda), `routes/supplier-invoices.js`
  (esquema + svc + endpoint + selector), `routes/facturar-horas.js` (auto-etiqueta), `schemas.js`, `layout.js`
  (nav + permiso AND), `routes/index.js` (mount). Verificado: `test-rentabilidad-proyecto` 22/0 (filtro cuadra
  · Σ+estructura=total al céntimo · reasignar mueve en vivo · cobrado aparte · comparativa marca perdedores ·
  migración idempotente), `gate-rentabilidad-pantalla` 15/0 (asignar desde pantalla venta+gasto · panel ·
  comparativa en rojo · permisos AND 403 · 0 errores JS · **neto-cero en Ventas Y en P&G total**),
  `test-contabilidad-pyg` 36/0 (matemática del P&G intacta), grupo `servicios` **9/9** + `margen` 6/6.
  **Ventas seguía 973.267,93 €**; Verifactu, P&G total, las 5 áreas del constructor y los KPIs intactos.
  *(Nota 22 jul: el tenant de desarrollo se reseeded con datos "taller" tras esta validación, así que su
  base de Ventas hoy es ~115.497 €, no 973.267,93 €; el número absoluto ya no aplica — lo que se verifica
  es que cada trabajo NO lo mueve, vía neto-cero.)*

- **PIEZA 4 (parte 2) — COSTE DE LAS HORAS EN LA RENTABILIDAD · ✅ ENTREGADA y verificada (22 jul 2026,
  commit `3d19945`).** Valora a COSTE cada entrada de tiempo y suma por proyecto para dar, junto al
  "resultado contable" de la parte 1 (INTACTO), un **"resultado de gestión"** que resta también el coste de
  las horas. **Cascada del panel:** Ingresos − Gastos directos = **Resultado contable** (parte 1, del P&G
  filtrado) − **Coste de las horas** (Σ horas × coste-hora congelado) = **Resultado de gestión** (nuevo).
  **Coste-hora por persona:** columna nueva `admin_users.coste_hora` (ESPEJO de `tarifa_hora`; la tarifa es
  VENTA/facturación, el coste es COSTE), editable en la misma pantalla de Usuarios y con el mismo permiso
  (`admin.manage_users`). **Congelado (filosofía WAC):** cada entrada guarda `time_entries.coste_hora_congelado`
  al crearla (columnas nuevas `coste_hora_congelado` + `coste_backfill`); cambiar el coste-hora de una persona
  HOY **no reescribe** un proyecto pasado. Backfill idempotente de las entradas previas (estampa el coste-hora
  del momento, marcado `coste_backfill=1`). **Sin coste-hora (0/vacío) = "sin coste registrado", NO coste 0:**
  esas horas se **apartan** y el panel avisa cuántas quedan fuera (idéntico al aviso "sin tarifa" de la pieza 2).
  **Capa de GESTIÓN, no contable:** el coste de horas **NO entra en `cuentaPyG`, ni en el diario, ni toca
  Verifactu**; aviso honesto y visible ("el resultado de gestión incluye el coste estimado de las horas y NO es
  el resultado contable; tu P&G no cambia"). **Comparativa** `/admin/rentabilidad`: columnas nuevas **Coste
  horas** y **Resultado gestión** + aviso agregado de horas sin coste; badge "pierde con horas" (gana en
  contable, pierde tras el coste). **Permisos:** el panel y la comparativa mantienen el candado AND de la parte 1
  (`proyectos.read` Y `invoices.read`); editar el coste-hora exige `admin.manage_users`; el coste-hora congelado
  NO se filtra por la API de tiempo. Migración aditiva/idempotente, sin DROP; `time_entries` y `proyectos` siguen
  FUERA de WRITABLE_TABLES. Ficheros: `models.js` (2 cols en time_entries + col en admin_users + backfill),
  `schemas.js` (`coste_hora` en userUpdate), `routes/users.js` (campo + guardado + aclaración tarifa=venta),
  `routes/tiempo.js` (congela el coste al crear la entrada), `rentabilidad.js` (`costeHorasProyecto` + cascada
  en rentabilidadProyecto/comparativaProyectos), `routes/rentabilidad.js` (columnas + avisos en la comparativa),
  `routes/proyectos.js` (cascada en el panel de la ficha). Verificado: **`test-coste-horas-proyecto` 28/0**
  (coste = Σ horas×coste congelado · sin coste apartado · congelado no altera el pasado · gestión = contable −
  coste · contable intacto · cuadre Σ+estructura=total intacto · backfill marcado · migración idempotente),
  **`gate-coste-horas-pantalla` 17/0** (cascada en pantalla · coste horas · aviso horas sin coste · aviso honesto
  gestión≠contable · columnas en la comparativa · permisos del coste-hora 403 · sin fuga por la API de tiempo ·
  0 errores JS · **neto-cero en Ventas Y P&G total**). Regresión: `test-rentabilidad-proyecto` 22/0,
  `test-tiempo` 23/0, `test-facturar-horas` 31/0, `test-contabilidad-pyg` 36/0, `verify-constructor` 82/0,
  `test-contabilidad` 38/0, `test-proyectos` 20/0, `test-coste-wac` 19/0 — todo verde. **La pieza 4 queda
  COMPLETA (parte 1 + parte 2).**

- **PIEZA 5 — SISTEMA DE CITAS (motor + agenda interna) · ✅ ENTREGADA y verificada (27 jul 2026, commit `45dc9c7`).**
  El motor de la cita previa y su agenda interna. **UN solo motor para dos negocios**: cita previa
  (peluquería/estética/salud) y servicios por horas (piezas 1-4). NO es el **calendario FISCAL** (D5e,
  15-jul) — otra cosa, ni se toca ni se reutiliza su nombre.
  - **Servicio reservable = capa SOBRE el catálogo existente**, NO un segundo catálogo: se añade al
    producto de tipo `service` la geometría de la reserva en `service_config` (`duracion_min`, tiempo
    muerto interior `muerto_ini/dur_min` —la persona queda LIBRE ese rato, el tinte—, `margen_min`
    posterior), quién puede prestarlo (`service_providers`) y qué recurso exige (`service_resources`).
    **Precio e IVA SIGUEN viniendo del catálogo** (fuente única).
  - **Recursos** (`recursos`): silla, cabina, sala, box, equipo. Una cita puede exigir persona Y recurso.
  - **Horarios** (`horario_tramos` negocio/persona, descansos = hueco entre tramos; `horario_excepciones`
    con fecha: vacaciones/festivo/cierre/horario especial). **La excepción manda** sobre la regla semanal;
    persona sin horario propio hereda el del negocio.
  - **Huecos EN VIVO** (no en tabla): horario − citas − márgenes, devolviendo LIBRE el tiempo muerto
    interior de otra cita. Rejilla 15/30, antelación mínima, ventana máxima, corte del mismo día.
  - **La cita** (`citas` + `cita_servicios`, geometría CONGELADA al reservar): cliente de la ficha o
    **cliente suelto** (nombre + móvil), servicios encadenados, persona, recurso, fecha, hora, nota.
    Estados pedida→confirmada→atendida|no_show|anulada. Archivar-no-borrar. **Guarda de solape en
    SERVIDOR** (409 por persona o por recurso; el tiempo muerto interior es la única excepción, y solo
    para la persona: la silla no se libera). **Bloquear un rato** sin cita (`agenda_bloqueos`).
  - **Agenda** día/semana, por persona y por recurso, arrastrar para mover **revalidando en servidor**.
  - **Salida al dinero (1.8):** "Atendida" cobra **reutilizando los motores existentes** (TPV
    `emitTicketSvc` para cliente suelto / `createInvoice` para factura completa). **CERO camino de emisión
    nuevo, cero hash propio.** Si la cita cuelga de un proyecto, puede generar su entrada de tiempo
    reutilizando el registro de la pieza 2 (`createEntry`, no facturable si ya se cobró).
  - **Enlace de la cita (1.9):** cada cita lleva una LLAVE no adivinable (`randomBytes(32)`), ruta pública
    `/cita/<token>` (sin sesión, sin CSRF; el token ES la defensa; rate-limit propio 40/min; caduca pasada
    la cita). Solo abre SU cita: CONFIRMAR o AVISAR de que no puede ir. No lista ni adivina otra.
  - **Avisos (1.10-1.12):** confirmación y recordatorio, **todos pueden ir A MANO**. WhatsApp por enlace
    OFICIAL `wa.me` (coste cero, sin cuenta Meta; **PROHIBIDO** WhatsApp Web / librerías no oficiales),
    SMS por `sms:` nativo, y EMAIL —el único que además sale SOLO por el cron + plantillas Resend que YA
    existen (2 plantillas nuevas SISTEMA con `{{enlace}}` crítico). Ajustes: canal por defecto y modo
    (manual / auto_email). **Estado HONESTO**: "marcado como enviado" (con canal y hora), NUNCA
    "entregado"/"leído". **La cola de envíos** (`/admin/citas/cola`): citas de mañana pendientes de
    recordatorio + de hoy pendientes de confirmación, doce en doce clics.
  - **Dato listo para el canal automático (1.13):** móvil E.164 (`clients.movil_e164` + marca "sin móvil
    válido") y consentimiento RGPD con fecha. NO se construye capa de canales; solo el DATO.
  - **DISA solo lectura sobre la agenda (1.14):** añadida a `QUERY_TABLE_READ_PERMS` con `citas.read`
    (mismo patrón que pedidos) y contexto "qué hay hoy/mañana"; `citas` FUERA de WRITABLE_TABLES → no crea
    ni mueve citas.
  - **Permisos:** `citas.read`/`citas.edit`, `requirePerm` en TODAS las rutas (incluida la vista); el
    enlace va por llave, no por sesión. Área "Agenda" propia en el rail (agenda, cola, servicios
    reservables, recursos, horarios, ajustes).
  - **Cron automático:** `bamburu-recordatorios-cita` (timer systemd 09:00 Europe/Madrid) manda el
    recordatorio por email SOLO a los tenants con `cita_modo_recordatorio='auto_email'`; idempotente.
  - Migración aditiva e idempotente, sin DROP; **todas las tablas nuevas FUERA de WRITABLE_TABLES**. NO se
    tocó Verifactu, P&G, diario, proyectos/tiempo/facturar-horas/rentabilidad ni el constructor.
  - Ficheros: `models.js` (10 tablas + cols en clients/company_config + permisos citas), `codes.js`
    (prefijo CITA-), `citas-engine.js` (huecos/solape/horarios/estados, PURO), `citas-avisos.js`
    (móvil E.164, wa/sms/email, cola), `routes/citas.js` (API + vistas + rutas públicas), `schemas.js`,
    `email-templates.js` (2 plantillas), `routes/index.js`, `layout.js` (nav), `routes/users.js` (label),
    `disa/index.js` (lectura agenda), `activity-entities.js`, `scripts/bamburu-recordatorios-cita.mjs` +
    unit/timer systemd.
  - **Verificado:** `test-citas` 35/0 (huecos con horario+margen+tiempo muerto; solape por persona y
    recurso; excepción manda; antelación/ventana/corte; estados; zona Europe/Madrid), `test-enlace-cita`
    14/0 (la llave solo abre SU cita; no se lista ni adivina; caduca; rate-limit), `test-avisos-cita`
    20/0 (texto+enlace en los 3 canales; sin móvil cae a email; nunca "entregado"), `test-neto-cero-cita`
    8/0 (crear+cobrar+anular deja Ventas y P&G EXACTAMENTE igual), `gate-citas-pantalla` 24/0 (crear desde
    modal, mover con 409, agenda por persona y por recurso, cobro cuadrando, cola con botón WhatsApp que
    lleva el enlace, marcar="marcado", 403 sin permiso, 0 errores JS). **Regresión verde**: proyectos 20,
    tiempo 23, facturar-horas 31, rentabilidad 22, contabilidad-pyg 36, contabilidad 38, cobros 47,
    disa-clientes 30, disa-stock 22, gate-proyectos 18, gate-rentabilidad 15, gate-tiempo 18,
    gate-plantillas-email 41 (10 tipos/20 variantes), gate-xss 29, verify-actividad 32, verify-disa-query
    43. (gate-nav-inicio-disa: 30/32 — los 2 fallos son precondición de datos, el tenant reseeded no tiene
    propuestas de impago pendientes para encender el badge; no lo toca esta pieza.)
  - **La pieza 5 queda COMPLETA. El peldaño 7 SIGUE ABIERTO: siguiente pieza 6 — PUERTA PÚBLICA DE
    RESERVA (ficha abajo), a la espera de encargo.**

- **AGENDA SENCILLA — ajuste de presentación de la pieza 5, va ANTES de la PIEZA 6 · ✅ ENTREGADA y
  verificada (27 jul 2026, commit `4679d62`).** NO es "pieza 5b": es una capa de PRESENTACIÓN sobre el
  motor intacto. **Regla dura: no se eliminó ni una función** — solo cambió qué se ve de entrada y cómo se
  llama; lo que estorbaba se guardó tras un clic.
  - **Llamar a las cosas por su nombre (solo textos; NO se renombró tabla ni código):** «Recurso» →
    **PUESTO**, con el nombre configurable por el negocio en Ajustes (Sillas/Cabinas/Salas/…), aplicado en
    TODAS las pantallas y en el menú (nuevas columnas `company_config.cita_puesto_sing`/`_plural`). Los tres
    campos del servicio pasan a lenguaje normal: **Tiempo contigo** / **Tiempo de espera** (con la frase
    «Estos minutos aparecerán como hueco libre para atender a otra persona»; se pliega si va a 0) / **Margen
    después** — re-expresados sobre las MISMAS columnas (`duracion_min`/`muerto_ini`/`muerto_dur`/`margen`).
    Fuera «recurso», «token», «tiempo muerto» de pantalla.
  - **La pantalla del día con lo justo:** de entrada HOY, por persona, y **solo quien trabaja hoy** (quien
    libra no ocupa columna). La vista por puesto, la semana y los filtros van tras «Vistas y filtros» (un
    clic) y se **recuerda lo último**. La **Cola de envíos** sale de la agenda y tiene **contador en el
    menú** («Cola de envíos · N»). Cada cita en la rejilla enseña solo hora · cliente · servicio + color de
    estado, con **leyenda** siempre visible; el resto vive al abrir la cita. El **tramo de espera** se
    dibuja en otro tono dentro del mismo bloque («Aquí estás libre»).
  - **Crear en tres toques:** se pulsa el hueco vacío de la rejilla (de ahí salen persona y hora, no se
    re-preguntan) → panel con SOLO cliente (buscador que filtra; si no existe se usa ahí mismo con nombre y
    móvil) y servicio (duración/precio solos del catálogo, encadenables). El **puesto se autoasigna** (primer
    libre) si el servicio lo exige, y se dice cuál. Todo lo demás (puesto, nota, duración, aviso ya, otra
    persona/hora) va en **«Más opciones»**, plegado, pero **sigue existiendo TODO**. Si algo choca, el aviso
    **propone huecos cercanos** («Huecos cerca: 11:00, 11:30»), no un error seco.
  - **El motor NO se tocó** (huecos, solape en servidor, horarios, enlace por llave, avisos, cola, cobro,
    Verifactu, P&G). Todo lo nuevo (personas-que-trabajan, puesto-libre, sugerencia, huecos-cercanos, contador
    del menú) se calcula CON el motor, no cambiándolo. De paso se arregló un bug latente desde la pieza 5: la
    ruta `GET /:id` tragaba `GET /horario` (la pantalla de Horarios no cargaba); se acota `/:id` a numérico.
  - **Verificado:** `gate-agenda-sencilla` 11/0 (crear desde el hueco vacío con persona/hora heredadas;
    vista de entrada solo quien trabaja hoy + «Ver todo el equipo»; cliente nuevo sin salir del panel; tramo
    de espera distinto; choque propone huecos; 0 errores JS), `test-textos-citas` 24/0 (sin «recurso»/«token»/
    «tiempo muerto» en pantalla; nombre configurable del puesto en todas). Regresión de la pieza 5 y del resto
    VERDE: test-citas 39/0, test-enlace-cita 14/0, test-avisos-cita 20/0, test-neto-cero-cita 8/0,
    gate-citas-pantalla 25/0, proyectos 20, tiempo 23, facturar-horas 31, rentabilidad 22, coste-horas 28,
    contabilidad-pyg 36, contabilidad 38, plantillas 41, XSS 29. **Ninguna función desapareció.**

- **PIEZA 6 — PUERTA PÚBLICA DE RESERVA · ✅ ENTREGADA y verificada (28 jul 2026).** El cliente final
  ELIGE hueco y reserva SOLO, 24 h, por la **dirección propia del negocio** (no el enlace de una cita
  concreta). **Decisión del dueño confirmada: NO depende del constructor de páginas web** — la página de
  reserva la publica el sistema de citas (verificado jul 2026 contra Square, Fresha y Acuity).
  **CORRECCIÓN DE ESTA FICHA:** decía «Incluye señal / prepago (cancelación cobrada)». El encargo del
  28-jul lo deja **EXPRESAMENTE FUERA** (no hay pasarela de pago) y **prohíbe dejar ganchos**. Manda el
  encargo; la señal no entra y no hay nada dormido esperándola (se comprueba en test-neto-cero-reserva).

  - **LO QUE DESTAPÓ EL PASO 0 (auditoría de solo lectura, antes de escribir una línea):**
    1. **El «alta de cliente al vuelo» de la pieza 5 NO da de alta clientes.** Lo que la agenda llama
       «usar como cliente nuevo» escribe nombre y móvil DENTRO de la fila de `citas`
       (`cliente_suelto_nombre`/`_movil`); no crea fila en `clients`, no tiene email y **no deduplica por
       nada**. El encargo pedía «reutilizar esa alta y deduplicar por teléfono y email»: no existía eso que
       reutilizar. **Decisión del dueño (28 jul): la puerta pública NO crea fichas** (simétrica con la
       agenda), pero **sí busca antes**: si el móvil normalizado (E.164) o el email ya son de una ficha
       ACTIVA, la reserva se **ENLAZA** a ella (`cliente_id`); si no, nace suelta. Así «si ya existe, se
       enlaza, NO se duplica» se cumple entero sin sembrar fichas basura.
    2. **El enlace `/cita/<token>` de la pieza 5 NO identifica al negocio.** El token se busca en la BD que
       el `tenantMiddleware` YA resolvió (por subdominio en producción; por cookie en desarrollo). No sirve
       como dirección pública fija por negocio, y **no había ninguna dirección configurable**. Cambio
       mínimo aplicado: `/reservar/<handle>` bajo el subdominio del negocio, sin tocar la resolución de
       tenant ni `control.db`.
    3. **`citas.token_expira` se escribe y NUNCA se lee.** La caducidad real del enlace es `fecha < hoy`.
       Es código muerto de la pieza 5; se anota, no se toca (fuera de alcance).
    4. **La «cola de envíos» no es una cola:** es una vista calculada en vivo (`colaEnvios`). Para avisar al
       NEGOCIO el canal que existe es otro: el colector de fuentes de `avisos.js`.
  - **La dirección (A):** `https://<negocio>.bamburu.com/reservar/<handle>`. `handle` en
    `company_config.cita_pub_handle`, editable por el dueño y **generado del nombre del negocio** si lo deja
    vacío. El negocio lo sigue resolviendo el SUBDOMINIO; el handle se **comprueba** contra el del tenant y
    si no cuadra → 404. De paso tapa un agujero de desarrollo (un solo host, donde la cookie de sesión gana
    al subdominio). **Interruptor general `cita_pub_activa` APAGADO por defecto**: hasta que el dueño lo
    enciende, la dirección responde 404 — no «vacío», 404.
  - **El flujo (B), primero móvil y con el mismo idioma visual de la página pública de la pieza 5:**
    servicio → profesional («cualquiera disponible» o uno concreto) → día y hora → datos y confirmar.
    **Precio, IVA y duración salen del catálogo** (`products` + `service_config`), sin recalcular nada.
    **Varios servicios en una cita SÍ**, porque el motor ya los encadena. Al confirmar se **revalida en
    servidor** y, si el hueco se ocupó, **409 con huecos cercanos**, igual que dentro.
  - **Los huecos salen DEL MOTOR DE LA PIEZA 5** (`huecos()` de `citas-engine.js`), llamado con otros
    ARGUMENTOS de política (antelación 2 h, ventana 60 días), **nunca con otro cálculo**. La rejilla y el
    corte del mismo día se toman de los ajustes de dentro: son cómo trabaja el negocio, no escaparate.
    «Cualquiera disponible» es la unión de `huecos()` por persona pública elegible — usando el motor, no
    cambiándolo. **NO se filtra por puesto libre**, a propósito: dentro tampoco se filtra al listar, y si al
    confirmar no hay puesto, `createCitaSvc` responde 409 con alternativas.
  - **Los mandos del dueño (C)**, dentro del área de Agenda (`/admin/citas/publica`): qué servicios se
    reservan desde fuera (`service_config.publico`, **por servicio, defecto NO**), quién aparece y **con qué
    nombre** (`cita_pub_personas`, **por persona, defecto NO**), antelación mínima (**2 h**) y máxima
    (**60 días**), modo **automático** (defecto) o **«yo apruebo»** —donde la solicitud **RETIENE el hueco**
    y **caduca sola a las 24 h**—, ventana de cambio/anulación del cliente (**24 h**, configurable,
    desactivable) y **texto de política de cancelación**.
  - **El cliente (D):** alta al vuelo simétrica con la agenda (**no se crean fichas**) + **enlace** si el
    móvil normalizado o el email ya existen. **La pantalla NUNCA revela si un teléfono o un email ya está en
    la base**: el resultado de la búsqueda no sale del servidor. **Casilla obligatoria de consentimiento**
    con enlace a la política de privacidad; se archiva el **texto exacto aceptado con fecha y hora**
    (`cita_reserva_publica.consent_texto`/`consent_at`) y **la política tal como se mostró**, no la de hoy.
  - **Avisos (E) — cero mensajería nueva.** Al cliente: la plantilla `confirmacion_cita` de la pieza 5, con
    **su enlace por llave** (confirmar / no puedo ir) y la política repetida (hueco `{{politica}}`, opcional
    y no crítico: sin política, el correo sale idéntico al de la pieza 5). Al negocio: **una fuente nueva en
    el colector de `avisos.js`** (`reserva_publica`, permiso `citas.read`), y con eso aparece sola en la
    campana, en `/admin/avisos`, en Inicio y en el email diario. Si el email al cliente falla, **la reserva
    NO se cae**: queda hecha y el fallo se archiva como `email_fallo`.
  - **Seguridad (F):** las rutas sin sesión solo devuelven servicios públicos, personas públicas y huecos —
    nunca clientes, nunca otras citas, nunca nombres de terceros. **El nombre visible del profesional es el
    que pone el dueño**; sin nombre público se enseña «Profesional N», **jamás `admin_users.name`**. Freno
    **por IP** (90/min) **y por teléfono/email** (6/hora) + **campo trampa** oculto y fuera del recorrido del
    teclado. El **404 de la puerta es el mismo** para apagada, handle equivocado y servicio no público: no es
    un oráculo. **`/reservar` entra en las superficies de CSP ESTRICTA** (`script-src` con nonce, sin
    `unsafe-inline`), como `/registro`: un solo `<script>` con nonce y cero handlers de atributo.
  - **La pieza 5 NO se tocó donde el encargo lo prohíbe** (huecos, solapes, horarios). Lo que sí cambió es
    aditivo y condicional: `resolverCitaPorToken` se saca de una clausura a función exportada (mismo
    comportamiento, letra por letra) y `paginaCita` gana una rama que **solo se enciende si la cita nació
    fuera**. **Decisión del dueño: la ventana de cambio/anulación rige SOLO para las nacidas fuera** — el
    enlace de una cita creada en la agenda se comporta exactamente como antes (se prueba: sección 9 de
    `test-reserva-publica`).
  - **Migración aditiva e idempotente, sin DROP:** 10 columnas `cita_pub_*` en `company_config`,
    `service_config.publico`, y **dos tablas nuevas** (`cita_pub_personas`, `cita_reserva_publica`), ambas
    **FUERA de WRITABLE_TABLES**. **La tabla `citas` no gana ni una columna**: el origen público es la MERA
    EXISTENCIA de la fila en `cita_reserva_publica`.
  - **Cron:** `bamburu-caducar-reservas` (timer systemd **horario**, no diario: la retención la fija el
    dueño y puede ser de 2 h; un barrido diario dejaría el hueco retenido más de lo configurado).
    Idempotente.
  - Ficheros: `models.js` (migración), `schemas.js` (2 esquemas), **`reserva-publica-config.js`** (módulo
    HOJA: config, ventana, quién/qué se enseña, fuente de avisos — separado a propósito para no cerrar el
    círculo de imports `avisos → routes/citas → layout → avisos`), **`reserva-publica.js`** (servicios
    validados; escribe SIEMPRE por `createCitaSvc`/`moverCitaSvc`/`anularCitaSvc`), **`routes/reserva-publica.js`**
    (rutas públicas + enlace + mandos + la pantalla), `routes/citas.js` (rama aditiva), `citas-avisos.js`
    (`politica` opcional), `email-templates.js` (hueco `{{politica}}`), `avisos.js` (fuente),
    `layout.js` (nav), `routes/index.js` (montaje), `core/security-headers.js` (CSP estricta),
    `scripts/bamburu-caducar-reservas.mjs` + unit/timer systemd.
  - **Verificado:** `test-reserva-publica` **130/0** (puerta apagada por defecto · el 404 no es oráculo ·
    solo sale lo marcado · reserva completa · 409 con huecos cercanos · antelación mín/máx en servidor ·
    consentimiento y campo trampa · cliente enlazado sin duplicar y sin crear ficha · «yo apruebo» retiene y
    caduca · cambiar/anular dentro y fuera de ventana · la pieza 5 intacta · cualquiera-disponible · cero
    fuga · migración idempotente), **`test-coincidencia-huecos` 40/0** — **LA PRUEBA DE COINCIDENCIA**:
    barrido de **183/183 combinaciones día×servicio y 1993 huecos comparados**, idénticos AL MINUTO, con
    descansos, excepciones, tiempo de espera interior, márgenes, bloqueos, horario propio, rejilla de 15 y
    corte del mismo día; y con políticas distintas, la lista pública es SUBCONJUNTO de la interna, nunca algo
    distinto. **`test-neto-cero-reserva` 21/0** (reservar/cambiar/anular/aprobar/rechazar/caducar no mueven
    Ventas, P&G, facturas ni Verifactu; no hay gancho de pago en el código; y cuando el dueño SÍ cobra,
    cuadra y la anulación lo revierte). **`gate-reserva-publica-pantalla` 51/0** (móvil 390×844 y escritorio
    1400×900: 4 pasos, 0 errores JS/CSP, política visible ANTES de confirmar, cero fuga medida sobre el HTML
    Y sobre todo lo que viaja por la red, cita dentro de la agenda, enlace del cliente, permisos 403).
  - **Regresión VERDE**: test-citas 39/0, test-enlace-cita 14/0, test-avisos-cita 20/0, test-neto-cero-cita
    8/0, test-textos-citas 24/0, gate-citas-pantalla 25/0, gate-agenda-sencilla 11/0, gate-plantillas-email
    41/0, verify-xss-escape 49/0, gate-xss-escape 29/0, verify-disa-query-permisos 43/0,
    verify-avisos-permisos 16/0, gate-avisos-contador-vivo 17/0, verify-actividad-etiquetas 32/0,
    verify-constructor 82/0, proyectos 20/0, tiempo 23/0, facturar-horas 31/0, rentabilidad 22/0,
    coste-horas 28/0, contabilidad-pyg 36/0, contabilidad 38/0.
  - **BARRIDO COMPLETO de los 122 scripts `test-*`/`verify-*`: 21 en rojo, TODOS PREVIOS.** No se supone:
    se **revirtieron los 9 ficheros seguidos a HEAD, se reinició el servidor y se reejecutaron los 18 que
    fallan de verdad** (los otros 3 —`verify-dibujo`, `verify-vigia`, `verify-voz`— no fallan: exigen
    argumentos y el barrido los llamó sin ellos). **Fallan IGUAL, uno por uno, sin una línea de esta pieza:**
    `test-pago-voz-avisos`, `verify-albaranes-browser`, `verify-avisos-crm-riesgo`,
    `verify-inventory-fix-browser`, `verify-llm-migracion`, `verify-mostrador-browser`,
    `verify-over-stock-ui`, `verify-pedidos-browser`, `verify-pedidos-disa`, `verify-pieza-c-http`,
    `verify-plantillas-email`, `verify-propuestas-dormidos`, `verify-propuestas-fiscales`,
    `verify-quotes-browser`, `verify-suggest-legible`, `verify-sustitutiva-browser`,
    `verify-traslado-auditoria`, `verify-u3-errores`. Más los gates `gate-avisos-pantalla` (3),
    `gate-avisos-badge` (4), comprobados igual. La mayoría son **precondiciones de datos del tenant
    reseeded** (no existe el pedido/presupuesto/stock que el gate espera), el mismo patrón que el TABLERO ya
    anotó para `gate-nav-inicio-disa` en la pieza 5.
    **DOS son deuda con nombre, y conviene no perderlos:**
    · **`verify-plantillas-email` 3 fallos** — cuenta 8 tipos / 3 SISTEMA / 18 variantes; la **pieza 5** los
    dejó en **10 / 5 / 20** y no actualizó ese script. El guardián vigente es `gate-plantillas-email`
    (41/0 verde). No se toca aquí: es deuda de la pieza 5, y arreglarla es afirmar números de trabajo ajeno.
    · **`test-pago-voz-avisos` 1 fallo** — el asunto de fábrica del resumen dice **«1 avisos»** (plural mal
    con n=1) y el test espera «1 aviso». Es un bug de TEXTO real, previo, en `resumen_avisos`.
  - **DE PASO SE CERRÓ UN AGUJERO DEL MOTOR DE AVISOS que esta pieza destapó:** `resumenAvisos` solo recorre
    `TIPO_ORDEN`, así que una fuente registrada en `SOURCES` pero ausente de esa lista **existe y no se
    cuenta, EN SILENCIO**; y `avisoKey` caía al genérico (JSON de todo el `ref`), que incluye
    `horas_restantes` — la identidad del aviso habría cambiado **cada hora** y habría reaparecido como nuevo
    después de marcarlo visto. Añadidos `TIPO_ORDEN`, `TIPO_FRASE` y un caso propio en `avisoKey`
    (`rp:<cita_id>`), con su comentario de por qué, y las tres cosas quedan **probadas** en
    `test-reserva-publica` (secciones de la 7).
  - **CON ESTO EL PELDAÑO 7 QUEDA CERRADO** (piezas 1-6 + Agenda sencilla). Siguiente: **PELDAÑO 8**.

- **CONSTRUCTOR DE PÁGINAS WEB (⬜, sin turno asignado — pendiente de que el dueño lo ordene).** Antes solo
  vivía en `TAREAS.md` (histórico, Capa 2, backlog); se sube aquí para que no quede suelto. Su ÚNICA
  relación con las citas es **EMBEBER el botón de reserva** de la pieza 6 — **nunca requisito previo**.
  Verificado jul 2026 (Square/Fresha/Acuity): la página de reserva la publica el sistema de citas, no el
  constructor. *(Nota: el "agendado automático de citas (13 jun)" que citaba el encargo NO existe en
  TABLERO ni en el código — no había nada suelto que consolidar; "Citas / Agenda" era la pieza 5, ya
  entregada.)*

- **ENVÍO AUTOMÁTICO DESATENDIDO POR WHATSAPP / SMS (⬜, peldaño propio — a la espera de encargo).**
  · **NO es requisito de lanzamiento.** Con la vía manual de la pieza 5, un negocio opera entero sin él;
    es una MEJORA para quien tenga volumen o no quiera pulsar un botón por cita.
  · **WhatsApp SOLO por la plataforma OFICIAL de Meta.** PROHIBIDO WhatsApp Web y librerías no oficiales
    (las del QR): incumplen las condiciones y pueden costarle al cliente su número. No se reabre.
  · **Modelo de coste decidido por el DUEÑO:** Bamburu NO asume el coste. La cuenta es del negocio, que
    decide si contrata y paga; Bamburu pone el mensaje y el enlace.
  · Referencia jul 2026: ~0,0166 €/mensaje de aviso en España (tarifa Meta, revisable cada trimestre);
    desde el 1-oct-2026 Meta cobra también las respuestas dentro de la ventana de 24 h. SMS: 3-4× más caro.
  · Lo caro no es enviar: es que el **alta en Meta** (verificación de empresa, número dedicado, plantillas
    aprobadas) ocurra DENTRO de Bamburu sin que el autónomo se pelee con Meta.

- **DISA PROACTIVA SOBRE LA AGENDA (⬜, pendiente de que el dueño le dé número).** Huecos sin llenar,
  cliente que dejó de reservar. Hoy DISA solo LEE la agenda (pieza 1.14); esto sería el paso proactivo
  (avisar/proponer), apoyado en el vigía (peldaño 5).

### ✅ 8 — Salud / bienestar · **2º oficio** · **HECHO (24 ago 2026)**
Agenda presencial. **Se apoya en el peldaño 7, que quedó cerrado el 28 jul 2026**: el motor de citas, la
agenda interna y la puerta pública de reserva ya existen y son de USO GENERAL, no de un oficio. Lo que
este peldaño añade es la cara propia del sector, no otro motor. **Cerrado por el PUNTO 15 de esta misma
ficha. El Peldaño 9 permanece pendiente, pero está aplazado por la fase de saneamiento activa y no es
la siguiente tarea.**

- **PIEZA 1 — PERFIL DE OFICIO EN LA AGENDA · ✅ ENTREGADA y verificada (15 ago 2026).** Al crear el
  negocio se ELIGE a qué se dedica, y la agenda habla su idioma desde el primer minuto sin configurar
  nada. **OJO AL ALCANCE:** el encargo no fue solo salud — son **SEIS oficios** (Peluquería y barbería ·
  Estética y belleza · Fisioterapia y salud · Taller mecánico · Asesoría y consultoría · Otro). Da la
  «cara propia del sector» que prometía esta ficha para el 2º oficio y, de paso, para los peldaños 9
  (belleza) y parte del 7. **El peldaño 8 SIGUE ABIERTO**: esto es la cara, no el oficio entero.
  - **EL OFICIO HACE EXACTAMENTE DOS COSAS, y está escrito así en el código:** (1) cambia palabras de
    pantalla; (2) precarga el catálogo de servicios. **NO toca el motor, NO enciende ni apaga funciones,
    NO quita nada.** Se demuestra: `test-oficio` sección 9 comprueba que no crea citas, ni puestos, ni
    horarios, que `citas` no gana una columna y que la puerta pública **sigue apagada**.
  - **LO QUE DESTAPÓ EL PASO 0 (auditoría de solo lectura, antes de escribir una línea):**
    1. **El vocabulario YA estaba partido en dos.** `cita_puesto_plural` se leía en `ajustesCitas()`
       (`routes/citas.js`) y OTRA VEZ, por su cuenta, en el parche del menú de `layout.js:465-475`. Con
       una palabra se notaba poco; con un diccionario por oficio, el menú habría dicho una cosa y la
       pantalla otra. **Se unificó ANTES de meter nada** (orden exigido por el dueño): ahora las dos
       lecturas salen de `vocabulario()`.
    2. **Ya existían DOS conceptos de sector, y ninguno lo lee el producto.** `settings.business_sector`
       (texto libre que escribe el LLM del alta, `tenant-provisioning.js:97`) — sus ÚNICOS consumidores
       en todo el repo eran dos scripts de prueba — y `disa_profile.sector`/`business_type`, que solo usa
       DISA en su prompt. **Decisión del dueño: NO se tocan, NO se migran, NO se leen para esto.** El
       oficio es un enum propio (`company_config.oficio`), elegido pulsando un botón.
    3. **La agenda preguntaba por la persona aunque el negocio tuviera una sola.** No había ni un
       `if` sobre el número de personas en `routes/citas.js` ni en `routes/reserva-publica.js`.
  - **CONTRADICCIÓN DEL ENCARGO, RESUELTA POR EL DUEÑO ANTES DE TOCAR NADA.** El encargo pedía que la
    pantalla de crear cita enseñara de entrada quién/qué/cuándo/con quién, y su prueba 2 exigía «3 o 4
    campos». Eso **contradecía la Agenda Sencilla** (27 jul), donde desde el hueco de la rejilla se piden
    DOS cosas y persona/hora **se heredan de la celda pulsada** — afirmado por `gate-agenda-sencilla`
    11/0. **Decisión del dueño (15 ago): se recorta SOLO el panel del botón «Nueva cita»; el panel del
    hueco NO se toca.** Prueba 2 corregida por él y cumplida al pie de la letra.
  - **Lo que se ve ahora:** desde **«Nueva cita»**, negocio de UNA persona → **TRES campos** (cliente ·
    servicio · día y hora); de VARIAS → **CUATRO** (+ «Con quién»). Con una sola persona el campo **no se
    pinta y la cita se le asigna sola** — el `<select>` sigue en el DOM, oculto y preseleccionado, para
    que `cGuardar`/`cRecalc`/`cSugerir` no necesiten ni un caso especial. Desde el **hueco**, siguen
    siendo **DOS**. Puesto, proyecto, nota y avisar quedan tras **«Más opciones»**, cerrado de entrada:
    **nada se eliminó**, solo dejó de estar delante.
  - **El catálogo NO está inventado.** Cada duración viene de lo que se publica hoy en España, anotada
    servicio a servicio en `oficios.js`: agendas públicas de **Fresha** (barberías de Madrid, peluquerías
    de Barcelona) y **Booksy** (estética/uñas de Barcelona), tarifas de clínica de fisioterapia, tiempos
    de taller y duraciones de cita de gestoría. **El tiempo de espera y el margen nacen a 0 a propósito**:
    las fuentes publican el TOTAL de la cita, no su reparto interno, y ese reparto sí sería inventárselo.
    Peluquería 8 · Estética 8 · Salud 4 · Taller 5 · Asesoría 4 · **Otro 0** (no se inventa a qué se dedica).
    **Salud nace EXENTA de IVA** (asistencia sanitaria de profesional titulado, art. 20.Uno.3º LIVA), no al 21%.
  - **Los que YA existen no se rompen, y se demuestra:** la columna nace en `'otro'`, cuyo puesto es
    `Puesto/Puestos` — **literalmente el default histórico** — y cuyo catálogo está vacío. Un tenant
    migrado sin pasar por el alta ve exactamente lo que veía ayer (`test-oficio` §3).
  - **Cambiar de oficio después** (Datos del negocio): **NUNCA borra ni pisa**. Cambiar el selector solo
    cambia palabras y **dice** qué falta; añadirlos es un **segundo botón**, a propósito. Un servicio
    sembrado y luego editado (o renombrado) se respeta y el de fábrica se añade al lado. Idempotente.
    Y el nombre de los puestos **solo sigue al oficio si nadie lo escribió a mano** (`puestoEsDeFabrica`).
  - **Módulo HOJA `modules/erp/oficios.js`**, por la misma razón que `reserva-publica-config.js`:
    `layout.js` (menú) y `routes/citas.js` (pantallas) necesitan las mismas palabras, y si el diccionario
    viviera en `routes/` se cerraría el círculo. `createProductSvc` entra como **argumento**, no como
    import. Los servicios nacen por el MISMO camino que «Nuevo servicio»: cero puerta nueva de creación.
  - **Alcance del vocabulario (decisión del dueño):** SOLO las pantallas de `/admin/citas` y su menú.
    **`email-templates.js`, `citas-avisos.js` y `reserva-publica.js` NO se tocan** — el cliente final
    nunca ve «paciente». Los mandos de `/admin/citas/publica` se dejan también con «Cliente», por ser la
    pantalla de la pieza 6. `gate-plantillas-email` y `test-reserva-publica` siguen verdes **sin tocarlos**.
  - **Migración aditiva:** UNA columna (`company_config.oficio`, `DEFAULT 'otro'`). Sin DROP, sin
    reescribir, sin tabla nueva. Verifactu, cadenas de hash, libro de stock y WRITABLE_TABLES, intactos.
  - Ficheros: **`oficios.js`** (nuevo, HOJA), `models.js` (1 columna), `routes/citas.js` (unificación +
    panel + diccionario), `layout.js` (el menú deja de consultar por su cuenta), `routes/settings.js`
    (mandos + 3 endpoints), `core/signup-schema.js`, `core/tenant-provisioning.js`, `modules/registro/index.js`.
  - **Verificado:** `test-oficio` **94/0** (los 6 oficios arrancan solos · «otro» = lo de siempre · una
    sola fuente de palabras · cambiar de oficio no borra ni pisa · el puesto a mano no se pisa · siembra
    idempotente · duraciones al minuto · el motor sin tocar), `test-oficio-alta` **52/0** (los 6 botones
    salen de la misma lista que el ERP · alta real con cada oficio · paso saltado/texto libre/inventado →
    «otro» · `business_sector` y `disa_profile.sector` intactos · mandos de Ajustes),
    `gate-oficio-pantalla` **28/0** (4 campos con varias · 3 con una y se asigna sola · cita creada de
    verdad con esos tres · nada desapareció · **el panel del hueco sigue pidiendo DOS** · pantalla y menú
    dicen lo mismo · móvil 390×844 sin desbordar · **0 errores JS**).
  - **Regresión de las piezas 5 y 6, VERDE y en su número exacto**: test-citas 39/0, test-enlace-cita
    14/0, test-avisos-cita 20/0, test-neto-cero-cita 8/0, test-textos-citas 24/0, **test-reserva-publica
    130/0**, **test-coincidencia-huecos 40/0** (los huecos de dentro y los de la página pública siguen
    coincidiendo AL MINUTO), test-neto-cero-reserva 21/0, gate-citas-pantalla 25/0, **gate-agenda-sencilla
    11/0**, gate-reserva-publica-pantalla 51/0, **gate-plantillas-email 41/0**. Y alrededor:
    verify-xss-escape 49/0, gate-xss-escape 29/0, test-registro-alta 26/0, verify-constructor 82/0,
    proyectos 20/0, tiempo 23/0, facturar-horas 31/0, rentabilidad 22/0, coste-horas 28/0,
    contabilidad-pyg 36/0, contabilidad 38/0, verify-avisos-permisos 16/0, verify-actividad-etiquetas
    32/0, verify-disa-query-permisos 43/0.
  - **UN ROJO QUE NO ES DE ESTA PIEZA, comprobado como manda el ritual:** `gate-registro-alta` da 11/3.
    Se revirtieron los 7 ficheros a HEAD, se reinició el servidor y se reejecutó: **falla IGUAL, 11/3,
    sin una línea de este trabajo.** Los 3 fallos son de la conversación con el LLM («No se alcanzó
    ready»), no del alta. Se anota, no se toca.
    **⚠️ ESTE ROJO ERA EL ALTA CAÍDA, Y NO SE VIO (ver la ficha de la INCIDENCIA, abajo).** Demostrar que
    un rojo no es tuyo NO es lo mismo que saber qué es. Ese paso faltó.

- **PIEZA 2 — LA AGENDA COMO UN CALENDARIO DE VERDAD · ✅ ENTREGADA y verificada (15 ago 2026).** Tres
  cosas que el dueño encontró rotas o inútiles al probarla.
  - **LO QUE DESTAPÓ EL PASO 0 — y desmintió la sospecha de partida.** Se creó un negocio de cero y se
    miró: la rejilla **NO sale vacía**. Pinta 1 columna y **26 huecos, los 26 pulsables** (el motor abre
    el día por defecto 8:00–21:00, `DEFAULT_OPEN`). El clic llevaba funcionando desde la pieza 5. Lo que
    NO existía era **la manera de descubrirlo**: `.agcell` solo llevaba `cursor:pointer` —que únicamente
    se ve si ya estás encima— y **no había ni una regla `:hover` en todo el repo**. El dueño no podía
    elegir hora porque **no sabía que podía**, no porque no hubiera dónde pulsar. Eso cambió el arreglo:
    no había que crear huecos, había que hacerlos visibles.
  - **HALLAZGO EXTRA, no pedido, arreglado:** la rejilla estaba **CLAVADA de 08:00 a 21:00** en el dibujo
    del cliente y **no derivaba del horario**. Un negocio que abre a las 7:00 tenía huecos reservables
    **desde fuera** (la puerta pública sí usa el motor) que **dentro no se veían**. Ahora el rango sale
    del servidor con el mismo motor (`rangoRejilla`, sobre `tramosAmbito`); sin horario configurado
    devuelve el 8–21 de siempre, así que lo que se veía antes se sigue viendo igual.
  - **(A) TRES VISTAS: Día · Semana · Mes**, y **fuera del cajón de filtros** — cambiar de día a semana no
    es filtrar, es lo primero que se busca. Botones a la vista + flechas ‹ › que avanzan en **la unidad
    que se está mirando** (día, semana o mes). **Mes NO es la rejilla por columnas**: es un calendario
    normal, lunes primero, y cada día dice **cuántas citas tiene y cuánto hueco queda**. Pulsar un día
    abre **ese** día. **No hay vista de año, a propósito.**
    - **De dónde sale «cuánto hueco queda»:** `huecos()` necesita una DURACIÓN (calcula dónde cabe un
      servicio concreto) y en un resumen mensual no hay servicio elegido; preguntarle con una duración
      inventada daría un número sin significado. Se usan las MISMAS piezas del motor un escalón más
      abajo —`tramosPersona` + `ocupacionPersona`, ya exportadas— y se restan. **No hay cálculo paralelo.**
  - **(B) EL HUECO SE VE PULSABLE:** fondo de acento, borde y la pista **«+ Nueva cita»** al pasar por
    encima; `tabindex` + `role=button` + Enter/Espacio, para que también se llegue con teclado. El flujo
    de la Agenda Sencilla (persona y hora heredadas del hueco) **no se tocó**: `gate-agenda-sencilla` 11/0.
  - **(C) AGENDA SIN HORARIO — SE CORRIGIÓ EL ENUNCIADO DEL ENCARGO.** Pedía decir «qué falta». Pero
    **no falta nada**: el negocio puede crear citas ya, y el día abierto por defecto es una decisión
    deliberada del motor. Un cartel de «te faltan los horarios» habría dicho que está bloqueado cuando no
    lo está, contradiciendo `DEFAULT_OPEN`. El aviso dice la verdad y **enseña a usarla**: «Tu agenda ya
    funciona… **pulsa cualquier hueco libre** y creas la cita ahí mismo», con el horario a un clic al lado.
    **No bloquea nada.**
  - **(D) «PROYECTO» SOLO EN LOS OFICIOS QUE LO USAN.** Nuevo `usa_proyectos` en `oficios.js`. **Se
    OCULTA, nunca se saca del DOM**: `editCitaSvc` escribe `project_id=?` con lo que llegue, así que un
    campo ausente **le borraría el proyecto a la cita al editarla**. Y **«otro» lo mantiene**: son los
    negocios que ya existían y hoy lo ven; a esos no se les quita nada de la pantalla por una migración.
    Se comprobó que el campo NO es decorativo: alimenta `invoices.project_id` al cobrar (rentabilidad) y
    el registro de tiempo al atender.
  - **Sin migración**: esta pieza no añade ni una columna. `citas` intacta; motor, puerta pública,
    Verifactu, hashes, stock y WRITABLE_TABLES, sin tocar.
  - **Verificado:** `gate-agenda-calendario` **25/0** — y la primera prueba es **la que manda**: *crea un
    negocio de cero y llega hasta tener una cita puesta*, sin sembrar nada a mano (negocio nuevo → aviso
    → hueco con su pista → cita a las 11:00 en la BD, con «Arreglo de barba» de su propio catálogo). Más
    las tres vistas, mes→día, flechas por unidad, Proyecto por oficio (peluquería no / asesoría sí),
    móvil 390×844 sin desbordar y **0 errores JS**.
  - **Regresión VERDE en su número exacto**: test-citas 39/0, test-enlace-cita 14/0, test-avisos-cita
    20/0, test-neto-cero-cita 8/0, test-textos-citas 24/0, **test-reserva-publica 130/0**,
    **test-coincidencia-huecos 40/0**, test-neto-cero-reserva 21/0, test-oficio 94/0, test-oficio-alta
    52/0, test-llm-texto-respuesta 13/0, gate-citas-pantalla 25/0, **gate-agenda-sencilla 11/0**,
    gate-reserva-publica-pantalla 51/0, gate-oficio-pantalla 28/0, **gate-registro-alta 34/0**.

- **INCIDENCIA · EL ALTA CAÍDA EN PRODUCCIÓN · ✅ RESUELTA (15 ago 2026, `bfd0a24`).** El usuario
  escribía «peluqería» en el asistente de bienvenida y DISA **no contestaba nunca**.
  - **Síntoma engañoso:** no había error, ni traza, ni 500. La ruta devolvía **HTTP 200 con la respuesta
    VACÍA**, el cliente pintaba una burbuja vacía y parecía que DISA «pensaba» sin fin. **Log limpio.**
  - **Causa:** el modelo empezó a devolver un bloque **`thinking` DELANTE** del texto. El código leía
    `apiData.content[0].text` → `undefined` → `|| ''` → respuesta vacía. **Cambio de FORMA en la
    respuesta de la API, sin un solo cambio en nuestro código.** No lo provocó el commit `369173f`
    (perfil de oficio): se comprobó revirtiendo a HEAD antes de tocar nada.
  - **El arreglo ya estaba escrito:** `core/llm.js` **ya exportaba `textFromResponse()`**, que filtra por
    `type === 'text'`. El alta nunca lo usó. Había **tres formas distintas** de sacar el texto conviviendo
    en el repo; ahora hay una. Corregidos `modules/registro/index.js`, `modules/disa/index.js` (dos
    sitios) y `scripts/verify-llm-migracion.mjs`.
  - **LA PRUEBA QUE FALTABA — `test-llm-texto-respuesta` 13/0.** No es que no hubiera pruebas:
    `gate-registro-alta` y `verify-llm-migracion` §2 **estaban en rojo y avisaban** desde el barrido de
    la pieza 6. Fallaron por otra cosa: **las dos necesitan el modelo de verdad**, así que son lentas,
    cuestan dinero y fallan por motivos ajenos — y un rojo así se tolera y se cataloga como «previo».
    La nueva es **determinista, offline y en milisegundos**: fabrica la respuesta de la API a mano
    (`fetchImpl`), reproduce la caída, y añade una **GUARDIA que barre `modules/`, `core/` y `scripts/`
    y se pone roja si algún fichero vuelve a leer `content[0].text`** (probada mordiendo: se reintrodujo
    el bug a propósito en los dos módulos y lo cazó). Ignora comentarios, para poder explicarse.
  - **Verificado:** `gate-registro-alta` **34/0** (era 11/3) — alta completa: conversación → resumen →
    negocio creado → login; `verify-llm-migracion` **6/0** (era rojo); `test-llm-texto-respuesta` 13/0;
    `test-registro-alta` 26/0, `verify-disa-query-permisos` 43/0, `test-oficio` 94/0, `test-oficio-alta`
    52/0, `gate-oficio-pantalla` 28/0.
  - **De los 21 rojos «previos» del barrido de la pieza 6, DOS eran esto.** Los otros siguen anotados.

- **PIEZA 3 — EL VIGÍA APRENDE DE AGENDA · ✅ ENTREGADA y verificada (17 ago 2026).** Cuatro detectores
  nuevos en el vigía del peldaño 5, **solo lectura**, texto por plantilla, **sin IA** y **sin una sola
  cifra propia**: cada número sale del motor de citas, el mismo que pinta la agenda y la puerta pública.
  **Ni una columna nueva, ni una escritura** (el gate lo demuestra con foto de tablas antes/después).
  - **EL PASO 0 TUMBÓ EL MÉTODO QUE PEDÍA EL ENCARGO, y era el corazón de la pieza.** Pedía sacar los
    huecos de `huecos()`, «el mismo motor que pinta la agenda». **No se puede**: `huecos()` responde a
    otra pregunta —*¿dónde cabe un servicio de X minutos para la persona Y?*— y devuelve minutos de
    inicio alineados a la rejilla. Necesita una duración (aquí no hay servicio elegido), **sus
    resultados se solapan** (un bloque libre de 3 h con rejilla de 30 min da 6 inicios, que no son 6
    horas) y **no coincidiría con la agenda**, que dibuja rango menos citas. Se usan las piezas un
    escalón más abajo —`tramosPersona` y `ocupacionPersona`, que son las que `huecos()` llama por
    dentro—, exactamente como ya hizo la vista de mes de la pieza 2 y por el mismo motivo escrito.
    **Sigue siendo el motor: no hay cálculo paralelo.** Decisión del dueño.
  - **(A) HUECO QUE SE VA A PERDER** — los próximos 3 días **abiertos** (desde mañana: el hueco de esta
    mañana ya se perdió) con ocupación **< 60 %**. Dice qué día, cuántas horas y **en qué tramos y de
    quién**. Grupo **ALTA**: es dinero de mañana y **caduca**.
  - **(B) CLIENTE FUERA DE SU RITMO** — ritmo propio = **mediana** de días entre visitas atendidas
    (días distintos: dos citas el mismo día son una visita, la misma lección que ya aprendió el
    detector de facturas). Con **menos de 3 visitas no se inventa ritmo**. Avisa a **×1,5**, y el texto
    dice el ritmo real y **qué servicio hizo la última vez**.
  - **(C) SE FUE SIN PRÓXIMA CITA** — atendido en los últimos 7 días y sin ninguna cita futura viva. Uno
    por cliente (agrupado en la consulta: no puede repetirse).
  - **(D) AUSENCIAS — SE CONSTRUYÓ porque el estado EXISTE.** `citas-engine.js` declara
    `ESTADOS = ['pedida','confirmada','atendida','no_show','anulada']` con su etiqueta «No se presentó»
    y su transición: **se lee, no se deduce**. Se mide por `citas.fecha` porque no hay sello
    `no_show_at` — y es el dato correcto de todas formas.
  - **EL SOLAPE, RESUELTO CEDIENDO JURISDICCIÓN.** El viejo «cliente que se duerme» mide por FACTURAS
    (×2, suelo de 30 días) y el nuevo por CITAS (×1,5, sin suelo): en un negocio que factura cada visita
    son la misma persona **con umbrales que ni coinciden** — el mismo cliente saldría dos veces diciendo
    cosas distintas. Ahora **todo cliente con ritmo aprendible por citas queda bajo el detector de
    citas, haya saltado o no**, y se le retira del de facturas. El que compra **sin pedir cita**
    (mostrador) no tiene historial de citas y **sigue vigilado por el viejo, intacto**.
  - **ORDEN POR PROXIMIDAD (`prioridad.js`, aditivo).** Los avisos de agenda **no llevan importe en
    euros** —un hueco libre no vale un número hasta que alguien lo llena, y estimarlo sería inventarse
    dinero—, así que ordenarlos por su `cifra` pondría arriba el día más vacío en vez del más cercano.
    Dentro de cada grupo: **primero los de importe** (por importe, como siempre), **después los de
    agenda por distancia a hoy**. Se mide en **valor absoluto**, que vale igual para lo que viene (un
    hueco de mañana) que para lo que pasó (una visita de hace tres días).
  - **SI EL NEGOCIO NO USA AGENDA, LOS CUATRO CALLAN**, y no es cortesía: **sin horario configurado el
    motor abre TODOS los días de 8:00 a 21:00** (`DEFAULT_OPEN`, decisión deliberada de la pieza 5), así
    que un negocio que jamás toca la agenda tendría 13 h libres por persona y día — el detector A sería
    una máquina de ruido perpetuo. Guarda doble: sin horario de negocio **Y** sin ninguna cita.
  - **SIN GRÁFICO, Y SE DICE POR QUÉ.** El constructor tiene cinco áreas (ventas, compras, clientes,
    inventario, contabilidad) y **ninguna sabe expresar citas**. Se declara la receta «sin gráfico» con
    ese motivo exacto, en vez de dejar que caiga en el mensaje genérico: el hueco queda **explicado**, no
    parece un olvido. **No se crea el área de agenda en este encargo** (queda anotado abajo).
  - **Permisos:** los cuatro exigen `citas.read`, el permiso de la pantalla dueña del dato. Quien no
    puede ver la agenda no los recibe **ni en la lista, ni en el texto, ni en el Inicio**, se le **dice**
    qué detectores no puede ver, y forzar por URL da **403**. Cero código de permisos nuevo: es el
    mecanismo que ya tenían los seis detectores del peldaño 5.
  - **Verificado:** `gate-vigia-agenda` **41/0**. La primera prueba es la que manda y es la del encargo:
    **negocio creado de cero → oficio peluquería → catálogo sembrado → citas → los avisos en /admin/vigia
    y asomando en el Inicio**, sin datos precargados. Y la que de verdad importa: **las horas libres del
    aviso son idénticas AL MINUTO a las de la agenda** —contrastadas contra `/api/erp/citas/mes`, que es
    OTRO camino de código llegando al mismo número—, más «meter una cita de 2 h resta exactamente 120
    min». Cliente cada 5 semanas con 4 → **no avisa**; a las 8 → **sí**; con 2 visitas → **nunca**.
    Ningún cliente en los dos detectores a la vez. Móvil 390×844 y **0 errores JS**.
  - **Regresión VERDE en su número exacto** (medida antes y después): test-vigia **37/0** (era 33/0: +4,
    uno por detector nuevo), gate-vigia-pantalla 13/0, test-citas 39/0, test-enlace-cita 14/0,
    test-avisos-cita 20/0, test-neto-cero-cita 8/0, test-textos-citas 24/0, test-reserva-publica 130/0,
    test-coincidencia-huecos 40/0, test-neto-cero-reserva 21/0, gate-citas-pantalla 25/0,
    gate-reserva-publica-pantalla 51/0, gate-agenda-sencilla 11/0, gate-agenda-calendario 37/0,
    test-oficio 94/0, test-oficio-alta 52/0, gate-oficio-pantalla 28/0.
  - **ANOTADO, no construido:** el **área de agenda en el constructor de analíticas** (sin ella estos
    avisos no pueden llevar gráfico). Y `citas` no guarda **quién** anula: `anulada_at` dice cuándo, no
    si fue el cliente o el negocio — hoy no hace falta para nada, pero el día que se quiera distinguir
    «me lo canceló el cliente» de «lo cancelé yo», ese dato **no existe**.

### ⬜ 9 — Belleza / estética · **3er oficio**  ⬅️ **SIGUIENTE EN LA ESCALERA · A LA ESPERA DE ENCARGO · NO INICIADO**
Agenda + caja del día.

### ⬜ 10 — Proyectos · partes de horas · servicio de campo
**Proyectos**: gestión de tareas internas **tipo kanban** — distinto del CRM *(de la auditoría vs
Holded)*. **Partes de horas** · **Servicio de campo / órdenes de trabajo** · **Parte de obra**.

### ⬜ 11 — TPV / POS módulo completo

### ⬜ 12 — Cobro recurrente + domiciliación SEPA

### ⬜ 13 — Telegram como canal de DISA

### ⬜ 14 — Mapas (OpenStreetMap)

### ⬜ 15 — App móvil nativa

### ⬜ 16 — API pública / webhooks

### ⬜ 17 — Integraciones / marketplace
*(Descartado a propósito y por escrito el 9-jul: el marketplace de asesorías/gestorías de Holded — es
un canal de leads, no una función de gestión.)*

### ⬜ 18 — Documentos / suite ofimática ligera

### ⬜ 19 — Multiempresa · Multi-moneda · Fabricación · Firma digital de documentos · Helpdesk
Aquí entra también **RRHH**: ficha de empleado (datos fiscales/contrato) + **nóminas** + organigrama
*(de la auditoría vs Holded)*. Va aquí y no en el 7 a propósito: el **control horario** sí es del oficio
(paso 7), pero nóminas y organigrama son un módulo de plantilla, no una cara por profesión.

### Sin peldaño propio — entran donde toquen (anotadas, no perdidas)
De las **"mejoras menores de UX/plataforma"** de la auditoría vs Holded. No son módulos: son mejoras
sueltas que se enganchan a lo que ya existe, y por eso no ocupan peldaño.
- **Importar contactos en bloque desde archivo** (clientes/proveedores) → cuelga de Clientes/Proveedores.
  *Hermana del **importador CSV de productos**, que la ayuda pública ya promete (`docs.html.js:630`).*
- **Buzón de email propio para reenviar tickets de gasto** → cuelga de la captura de compras que ya existe.
- **Búsqueda global + botón de creación rápida universal** → cuelgan del chrome del panel (`layout.js`).
- **Calendario fiscal de vencimientos** → **YA CONSTRUIDO** el 15-jul: `calendario-fiscal.js` lo hizo
  **D5e** y alimenta las propuestas de DISA. Lo que falta es enchufarlo a la **campana** como fuente de
  avisos (ver §Eje B). *Esta línea de la auditoría vs Holded quedó saldada sin que la lista se enterara.*

---

> El detalle completo de cada módulo del roadmap, de las decisiones registradas (D1–D6) y de todas las
> piezas ya cerradas se conserva en `docs/contexto/` y en el historial de `git` (TABLERO anterior).

---

### PUNTO 7 · LAS 80 VENTANITAS DEL NAVEGADOR, FUERA  ✅ **HECHO (23 ago 2026, noche)** · gate `scripts/gate-sin-ventanitas.mjs` · **36 ✓ · 0 ✗**

**EL CENSO DABA 81 Y ERAN 80 VIVAS**, y la diferencia importa: `scripts/censo-ventanitas.mjs` **no
cuenta lo que está en un comentario**. Media docena de las apariciones eran las notas que explican
esta misma avería; contarlas habría dado un número que nunca podía llegar a cero. **Hoy da 0.**

**LA AVERÍA, otra vez, para que no se olvide.** Chrome ofrece la casilla «Impedir que esta página
cree cuadros de diálogo adicionales» en el **segundo** diálogo seguido. Marcada, `prompt()` devuelve
null y `confirm()` false **sin enseñar nada**: el botón queda muerto —ni ventana, ni petición, ni
aviso— y el usuario cree que el programa está roto. Las pantallas que **encadenaban dos** rompían del
todo; las de una sola «solo» se silenciaban.

**LO MIGRADO: 80 sitios en 40 ficheros** (21 `prompt` + 59 `confirm`), todos al panel compartido
`window.pedirDatos()` / `window.confirmarEnPagina()` de `layout.js`. **No se ha inventado ningún
componente nuevo**: es la pieza que nació con la ficha D-bis para esto exactamente.
- **Los pares que MATABAN, primero, como pedía el encargo:** Presupuestos (anular y rehacer, y el
  aviso de exceso de stock encadenado con la conversión), Pedidos (tres seguidos), Órdenes de compra
  (dos), Mostrador (**la línea libre pedía concepto e importe en DOS ventanitas seguidas**: ahora es
  UN panel con los dos campos, más rápido de rellenar y que valida sin cerrarse) y la **ficha de
  cliente** (editar y quitar una nota, que era el quinto par y no estaba en la lista de cinco).
- **Se gana una salida que antes no existía.** «Atender la cita» era una ventanita con **tres
  significados y dos botones**: Aceptar cobraba, Cancelar marcaba atendida **sin** cobrar… y **no
  había forma de arrepentirse** — pulsar Escape por error dejaba la cita atendida. Ahora la casilla
  decide si se cobra y cerrar el panel **no hace nada**. No se pierde ninguna de las dos acciones.
- **La validación se muda DENTRO del panel.** Antes, un motivo corto cerraba la ventana y soltaba un
  aviso suelto; ahora el panel **no se cierra** y dice **en qué campo** está el fallo.
- **El superadmin también**, y sin duplicar código: tiene su propio `window.saConfirmar()` construido
  **sobre el modal que ese panel ya tenía** (`saOpenModal`), así que no hay un segundo CSS ni un
  segundo estilo. Escape y clic fuera cuentan como «no».
- **`perfil.js` tenía un `onsubmit="return confirm(…)"`**, que es el peor caso de todos: apagada la
  ventanita, el formulario **se enviaba sin preguntar**, y ese formulario apaga la verificación en
  dos pasos. Ahora el envío se intercepta y solo sale con el panel aceptado.

**CÓMO SE COMPRUEBA, y por qué así**
- **Las ventanitas se NEUTRALIZAN antes de que cargue la página** y, además, **se apuntan**: el gate
  no se conforma con que «no pase nada», quiere saber si alguien lo **intentó**. Un solo intento lo
  tumba.
- **Se pulsan los botones de verdad**, y se prueban los tres caminos que estaban muertos: **cancelar**
  (el panel cierra, **cero peticiones**, el documento sigue como estaba), **campo vacío** (el panel
  **no** se cierra y dice dónde), y **Escape** (cierra, no deja a nadie atrapado).
- **Y el censo del código tiene que dar CERO**, porque pulsar seis pantallas no dice nada de las otras
  cincuenta. `censo-ventanitas.mjs` **sale con código 1** si aparece una: es la red que impide que
  vuelvan.

**DOS ROJOS DEL GATE QUE ERAN DEL GATE, no del producto**, y se dicen porque son la lección:
- Cogía la **última orden enviada** para probar «Anular», y esa tenía una **recepción confirmada**:
  el producto **no pinta el botón** en ese caso, y hacía bien. Rojo sobre una pantalla correcta.
- Contaba las notas del cliente con `SELECT COUNT(*)` a secas. **Quitar una nota la ARCHIVA**
  (`active=0`), que es la regla permanente del proyecto. El gate exigía que la fila desapareciera.

**Sin residuo:** 0 clientes, 0 notas y 0 sesiones del gate en `desarrollo-bamburu` al terminar.

---

### PUNTO 8 · LOS SEIS CABOS APUNTADOS Y NUNCA CONSTRUIDOS  ✅ **HECHO (23 ago 2026, noche)** · gate `scripts/gate-cabos-apuntados.mjs` · **46 ✓ · 0 ✗**

**1 · LA VOZ HABLA EN ESPAÑOL.** `voz.js` escribía `€232.75` y las fechas en ISO. En una frase que le
lee un dueño español —«Tienes una factura sin cobrar por €232.75, venció el 2026-07-15»— eso no se
lee, se descifra. Ahora es **`1.232,50 €`** y **`15/07/2026`**, usando `fmtEur`, **el formateador que
ya existía y nadie usaba**. La misma corrección en **la pantalla del vigía**, que no pasa por la voz
y pintaba el hallazgo en crudo. **La cifra que viaja no cambia: solo cambia cómo se escribe**, y el
gate lo comprueba.
- **Las cuatro comprobaciones que dependían, arregladas — y una de ellas llevaba tiempo en rojo.**
  `test-voz` y `verify-voz` tenían **cada una su copia** del formateador para poder quitar del texto
  los importes y comprobar que no queda ningún dígito inventado. Ahora **importan el del producto**:
  si tuvieran copia, un cambio de formato daría un falso rojo o, peor, un falso verde.
- **🔴 Y AL HACERLO SALIÓ UN ROJO VIEJO:** `verify-voz` daba **287/290 desde que existen los
  detectores de agenda**, y no era del producto — las dos copias de la comprobación quitaban
  `cifra`, `fecha` y dos códigos, y **nada más de `ref`**, así que el porcentaje de ocupación y los
  tramos libres (campos limpios, permitidos por la regla) contaban como cifras inventadas.
  **Comprobado contra el código de antes: el rojo era idéntico.** La comprobación se muda a
  `scripts/lib/voz-digitos.mjs`, en un solo sitio, y aplica la regla **tal y como está escrita**:
  todos los escalares de `ref`. **Ahora 290/290.** *(Que llevara meses en rojo sin que nadie se
  enterara es, otra vez, el problema del punto 5: `verify-voz` está fuera del barrido.)*

**2 · `gate-nav-inicio-disa` SE TRAE SU PROPIA PROPUESTA.** Afirmaba que el badge de DISA enseña el
número de propuestas pendientes… y exigía que el negocio tuviera alguna sin crearla él. Se resolvieron
a mano las 39 que quedaban, el generador es idempotente por documento y el gate se quedó en rojo por
una precondición que no era suya. Ahora la crea, con marca y sufijo de pasada, y la borra en el
`finally` **por la marca**. **34 OK**, sin residuo.

**3 · EL ALTA DEL SUPERADMIN — ⚙️ LA PREMISA ERA FALSA, y se midió antes de construir.** El paso «He
guardado mis códigos de rescate» **ya existía desde el 17 jul 2026** (C5-ter · T1). Comprobado
**pidiendo la pantalla de verdad** con sesión de superadmin: la casilla está, el botón «Terminar»
nace con `pointer-events:none` y `engancharCerrojo` se engancha. *El puntero del panel estaba rancio.*
- **Lo único que SÍ le faltaba, y se ha puesto:** el dueño podía **descargarse** los códigos y el
  superadmin solo copiarlos. **Copiar al portapapeles es justo lo que no hay que hacer con unos
  códigos de rescate** —se pisa con lo siguiente que copies—, así que la cuenta más poderosa de la
  plataforma era la única sin la forma buena de guardarlos. Botón «Descargar» añadido **en el bloque
  compartido**, para que lo tengan las dos pantallas que lo usan.

**4 · LOS TRES MOTORES QUE FALTABAN, y los dos «sin comparación» tapados.** Cada uno con su CONTROL,
porque un motor que calcula solo no se puede contrastar con nada:
| Motor nuevo | Qué tapa | Su control |
|---|---|---|
| `deudaAFecha` (cobros.js) | «Pendiente de cobro» decía *«no hay motor que la reconstruya a una fecha pasada»* | **Al día de hoy da EXACTAMENTE lo mismo que `openDebts`**, el motor que ya existía |
| `base` en `ventasPorDia` | el gráfico iba con IVA y el titular sin él, con una nota al pie explicando el desajuste | **La suma de las bases del mes cuadra al céntimo con `ventasResumen`**, que es otro motor |
| `clientesNuevosPorTramo` | «Clientes nuevos» decía *«no hay forma honesta de comparar medio mes con medio mes»* | **Pidiendo el día 31 devuelve el mes entero**, y avisa cuando el mes es más corto |
- **Y lo que un motor NO puede saber, se dice.** La deuda de una fecha pasada lee el estado de cada
  factura **como está HOY** (la base no guarda cuándo se anuló), así que sale igual o algo menor que
  la que se vio ese día. La tarjeta lo enseña: *«La comparación es aproximada: 87 factura(s) anuladas
  o rectificadas se leen como están hoy, no como estaban el 23/07/2026»*. **Preferimos una cifra con
  su matiz que un hueco.**

**5 · B10 · EL SERVICIO, MÁS CERRADO Y VIVO.** Aplazado desde el 9 de julio por ser «el único que
puede tirar el servicio», hecho esta noche porque no hay nadie usándolo. **Medido:
`systemd-analyze security` pasa de `8.7 EXPOSED` a `7.3 MEDIUM`**, con copia previa de la unidad y
**el PDF comprobado antes y después (59.652 bytes las dos veces)**, que es exactamente lo que se
rompe.
- **Lo que NO se pone, y por qué — escrito en la propia unidad:** `ProtectHome` (las BD viven en
  `/home/ubuntu`), `NoNewPrivileges` y `RestrictSUIDSGID` (el PDF lo genera el Chromium de **snap**, y
  `snap-confine` es **setuid** y necesita `cap_dac_override`) y `RestrictNamespaces`/`PrivateMounts`/
  `ProtectProc` (snap monta su espacio de nombres y Chromium gestiona procesos hijos). **Poner
  cualquiera de ellas apaga los PDF en silencio.** `NoNewPrivileges=false` queda escrito **a
  propósito**, no por olvido, y el gate exige que siga así.

**6 · B12 · LAS TRES TABLAS DE ROLES: RETIRADAS.** `roles`, `role_permissions` y `user_roles` estaban
sembradas desde siempre y **no concedían nada**: los permisos se aplican solo con `user_permissions`.
**Se RETIRAN, no se cablean, y el motivo es de fondo:** cablearlas sería **rediseñar el modelo de
permisos** —de permisos por persona a permisos por rol—, que es una decisión de producto del dueño y
una tarea entera. Y **dejarlas es peor que quitarlas**: un esquema con `roles` **parece** un sistema
de permisos, así que quien le dé el rol «Admin» a un empleado creerá que le ha concedido algo. **Un
control de seguridad de mentira es peor que no tenerlo.**
- **Archivadas, no destruidas** (`*_archived`), con migración aditiva e idempotente y **cero DROP**.
  Lo sembrado sigue legible, y el reparto de permisos por rol que describía queda en el histórico de
  git por si algún día se construye de verdad.
- **Se deja de escribir en el camino vivo:** `ensureAdminRole()` metía una fila en `user_roles` **en
  cada login**, y no la leía nadie.
- **🔴 Y el arreglo estuvo a punto de romper el alta de negocios.** Quitadas la creación y la siembra,
  quedaba **una tercera referencia 130 líneas más abajo** (el reparto de permisos por rol) que
  reventaba `runMigrations` con `no such table: roles`. **Lo cazó la prueba, no el razonamiento:**
  dar de alta un negocio nuevo de verdad y entrar con su contraseña. Un negocio nuevo nace ahora con
  `permissions` y `user_permissions` **y nada más**, con sus 66 permisos, y el login devuelve 302 con
  su cookie y `/admin` responde 200.

**🔎 HALLAZGO ANOTADO, NO TOCADO.** En `data/tenants/` hay **16 negocios de prueba de gates**
(`gate-*`, `__gate_*`, `peluqueria-arranque-*`, `muestra-logo-*`) que sus gates crearon y **no
borraron**. Es la misma regla del punto 7 —lo que una prueba crea, la prueba lo borra— pero **un
piso más arriba**: no son filas dentro de un negocio, son negocios enteros. No se tocan esta noche
porque borrar negocios es exactamente la clase de cosa que no se hace sin decirlo antes.

---

### PUNTO 9 · «¿QUÉ PRODUCTOS LLEVO TIEMPO SIN VENDER?» — LA PREGUNTA DOCE  ✅ **HECHO (23 ago 2026, noche)** · gate `scripts/gate-productos-parados.mjs` · **23 ✓ · 0 ✗**

**EL PROBLEMA ERA EL GRANO, no los datos.** El área de Inventario tiene como fila un MOVIMIENTO de
almacén: un producto que nunca se ha movido **no produce fila**, así que no puede salir en ningún
gráfico — y justo esos eran la respuesta. Es el mismo cambio de grano que hizo falta en la agenda
para poder hablar de horas libres.

**ÁREA NUEVA: «CATÁLOGO», cuya fila es el PRODUCTO** y las ventas se le cuelgan. Un producto que no
vendió nada sale con **cero, que es un dato, no un hueco**. Cinco formas de repartir (cuánto lleva
sin venderse · producto · categoría · bien o servicio · estado en el catálogo) y seis medidas.
- **«Parado» se mide por VENTAS, no por movimientos de almacén**, y es a propósito: una entrada de
  mercancía o un traslado mueven el stock y **no significan que el producto se venda**; y un
  **SERVICIO no mueve stock jamás**, así que por movimientos todos los servicios saldrían parados
  siempre. La fuente es `invoice_items` sobre las facturas que **cuentan como venta** — la misma
  regla que el área de Ventas, para que las dos digan lo mismo.
- **«Nunca se ha vendido» es un grupo APARTE de «más de un año».** Son cosas distintas, y juntarlas
  escondería justo la peor.
- **Cuidado con la ventana, y está resuelto:** las unidades y el importe son del periodo elegido,
  pero **«cuánto lleva sin venderse» mira toda la historia**. Si se recortara al periodo, un producto
  vendido hace dos años parecería igual de parado que uno vendido ayer en cuanto el periodo fuera
  corto: una respuesta falsa a la pregunta que se está haciendo.
- **Lo que no se sabe no se inventa:** los que nunca se han vendido **no entran en la media de días**
  —no tienen días que promediar, y meter un cero sería mentir—, así que su media sale «—». Pidiendo
  solo esa medida, el grupo se retira **y se cuenta** como grupo vacío, que es la norma de la D-ter.

**LO QUE CONTESTA, con los datos reales de `desarrollo-bamburu`:** de **126 productos**, **89 no se
han vendido nunca** (en una factura que cuente como venta) y tienen **4.430,23 € de stock parado**.
Antes de esta noche esa cifra no se podía sacar de ninguna pantalla.
- *Matiz medido y dicho:* 121 productos aparecen en alguna línea de factura, pero solo **43 en
  facturas que CUENTAN** — el resto son facturas anuladas o de prueba. Y de esos 43, **6 apuntan a
  productos que ya no existen** en el catálogo, así que no salen: el área parte del catálogo de HOY,
  que es de lo que el dueño puede hacer algo.

**DOS PREGUNTAS NUEVAS EN LA PORTADA**, en un grupo «Catálogo»: *«¿Qué productos llevo tiempo sin
vender?»* y la que sigue de forma natural, *«¿Cuánto dinero tengo parado en productos que no se
venden?»*. Se prueban **pulsándolas**, y dejan el constructor puesto en su receta.

**🔒 Y UN CANDADO QUE PARECÍA UN CANDADO Y NO LO ERA.** Al declarar las medidas del área nuevas con
`perm` salió que **`camposPara` filtraba las DIMENSIONES por permiso y las MEDIDAS no**: una medida
con `perm` lo declaraba y no lo comprobaba nadie. Ahora se aplica **en el desplegable y en `cruzar`**,
y falla cerrado (403 con su motivo, no un cero que se leería como «no hay nada»). Estreno: se ve el
catálogo con `products.read`, pero **lo facturado exige además `invoices.read`**. Ninguna otra área
pierde medidas por el cambio, comprobado área por área.

**DOS ROJOS DEL GATE QUE ERAN DEL GATE:** buscaba el botón de la pregunta por su texto y pulsaba un
contenedor sin manejador; y buscaba la leyenda del quesito en el HTML, cuando **Chart.js la dibuja
DENTRO del lienzo**. Ahora pulsa el `[data-preg]` de verdad y afirma sobre **píxeles pintados**
(50.822 de 361.760) más la tabla.

---

### PUNTO 10 · DISA Y LOS INFORMES — LA SEGUNDA PUERTA  ✅ **HECHO (23 ago 2026, noche)** · gate `scripts/gate-disa-informes.mjs` · **28 ✓ · 0 ✗**

**CUATRO HERRAMIENTAS NUEVAS**, en su propio módulo (`modules/disa/informes.js`):
`listar_informes` · `abrir_informe` · `catalogo_informes` · `componer_informe`. Y **el prompt le dice
que existen**, porque una herramienta que el modelo no sabe que tiene no la usa nunca.

**LAS TRES REGLAS QUE MANDAN, y cómo se comprueban:**
1. **MISMO MOTOR, NO UNA COPIA.** Todo sale de `constructor-analitica.js`. **El gate exige que
   componer por chat devuelva EXACTAMENTE las mismas filas que el cruce de la pantalla** — mismo
   JSON, mismo periodo. Si fueran dos motores no serían dos puertas: serían dos verdades.
2. **MISMOS PERMISOS QUE LA PANTALLA, y falla cerrado.** Un informe **compartido** de un área que no
   puedes ver **no se lista**; abrirlo a la fuerza da error; componer uno de esa área da **403, no un
   cero** (un cero se leería como «no hay nada»). El candado llega **hasta la medida**: sin
   `invoices.read` no se le ofrece «Facturado». Y **se dice cuántos informes se esconden**: no es lo
   mismo que no existan.
3. **NO ESCRIBE NADA.** Ni guardar, ni renombrar, ni borrar. Comprobado contando los informes antes y
   después de listar, abrir y componer, y leyendo el módulo: **cero `INSERT`/`UPDATE`/`DELETE`**.
   `analytics_panels` sigue **fuera de `WRITABLE_TABLES`**.

**DECISIÓN DE ALCANCE, dicha en voz alta: GUARDAR SE QUEDA EN LA PANTALLA.** El encargo pedía
«componer uno nuevo desde el chat», y eso es lo que hace: devuelve el resultado **y un enlace** que
abre el constructor con la receta puesta, donde el dueño le da a Guardar si le sirve. Es
**«DISA propone y el usuario confirma»** aplicado a esto, y evita abrir un camino de escritura nuevo
por una comodidad. **Si Ibrahin prefiere que guarde por chat, es cambiar una función** — pero es su
decisión, no la mía.

**LA PUERTA POR LA QUE ENTRA EL ENLACE.** La pantalla de Analítica aprende a abrirse con la receta
puesta: `?panel=<id>` para un informe guardado y `?area=..&dim=..&med=..` para una receta suelta.
**No es una puerta nueva a los datos**: la pantalla vuelve a pedir el cruce por el endpoint de
siempre, con los permisos de siempre — un enlace a un área que no puedes ver no te la enseña, y uno
a un informe que no existe no revienta la pantalla. **Los tres casos se abren en un navegador de
verdad** en el gate, porque un enlace que no lleva a ninguna parte es peor que no darlo.

**UNA TRAMPA QUE SE QUITÓ AL ENCONTRARLA.** `cruzar` **lanza** cuando falta un permiso —y hace bien,
fallar cerrado es lo correcto—, así que las funciones del módulo unas veces devolvían un objeto y
otras reventaban, según por dónde se llamaran. Ahora **todas devuelven lo mismo**: un resultado o
`{ error, status }`. Una función exportada que a veces explota es una trampa para el siguiente.

---

### PUNTO 11 · DESCUENTOS, PROMOCIONES Y BONOS, REHECHOS ENTEROS  ✅ **HECHO (23 ago 2026, noche)** · gate `scripts/gate-descuentos.mjs` · **60 ✓ · 0 ✗**

**LA DECISIÓN DE DISEÑO QUE LO GOBIERNA TODO, y por la que esto no toca el motor fiscal:**

> **UN DESCUENTO ES UNA LÍNEA DEL DOCUMENTO**, con importe negativo y el mismo tipo de IVA que lo que
> rebaja. No una columna de la cabecera.

`computeTotals` ya suma líneas negativas —la base baja, el IVA baja en proporción y el desglose por
tipo cuadra—, así que **ni el sello ni VERI\*FACTU cambian**. Y en el papel **se lee**: el cliente ve
qué le has descontado y por qué, en vez de un total más bajo sin explicación.

**Y LA SEGUNDA: EL MOTOR PROPONE, EL USUARIO CONFIRMA.** Ningún descuento entra solo en un documento.
Al facturar se pulsa **«Descuentos…»**, sale un panel con lo que toca —cada uno con su motivo y lo
que resta—, **las casillas nacen sin marcar**, y si se cancela **no se añade nada**. Comprobado
pulsando las dos cosas.

**LAS TRES PIEZAS**
- **Descuento fijo por cliente** (`clients.descuento_pct`, aditiva). Se pone en su ficha y se
  **propone** al facturarle. Validado en el esquema, no solo en la pantalla: un 150 % por la API se
  rechaza.
- **Promociones** (tabla nueva): porcentaje o importe fijo, con **ventana de fechas**, **mínimo de
  documento**, **alcance** (todo / una categoría / un producto), **tope de usos** y **código
  opcional**. Una promoción con código **no se aplica sola** — si lo hiciera no sería un código,
  sería una rebaja. Un importe fijo enorme **se recorta a la base**: nunca deja el total en negativo.
- **Bonos** (tabla nueva + su registro de consumos): un talonario prepagado. **Se vende con una
  factura normal** —ahí está el ingreso— y **consumirlo NO emite factura**: baja el contador y queda
  apuntado quién, cuándo y cuántas. Comprobado que el número de facturas **no cambia** al consumir.
  Caducidad, agotado y **deshacer un consumo** (que le devuelve al cliente lo que pagó) también.

**LOS TRES CUPONES ARCHIVADOS VUELVEN, y encajan.** `BIENVENIDA10` (10 %), `VERANO2026` (15 %) y
`FIJO5` (5 €) pasan a ser promociones con su código, migrados desde `discount_codes_archived`.
**Nacen APAGADOS: recuperar no es encender.** Lo que **no** se recupera es su mecánica de carrito de
tienda —esa pantalla estaba muerta y la tienda está congelada—: ahora se aplican al documento que se
esté haciendo.

**DISA LEE Y PROPONE, PERO NO APLICA.** Dos herramientas (`ver_descuentos`, `calcular_descuento`) y
las tres tablas en su mapa de LECTURA con `invoices.read`. **No están en `WRITABLE_TABLES`**: aplicar
un descuento cambia lo que se factura y consumir un bono le quita al cliente algo que pagó — las dos
son acciones con valor, y el canon dice que DISA propone. Y avisa del malentendido fácil: **un bono
no rebaja la factura, la evita.**

**🔴 LO QUE DESTAPÓ LA CAPTURA, Y NINGUNA ASERCIÓN VIO.** El gate daba 47 ✓ con la línea de descuento
puesta… y en la captura, **la base seguía diciendo 100,00 € con un −10,00 € dos centímetros más
abajo**. Dos fallos encadenados:
1. **El esquema rechazaba el precio negativo** (`unit_price: nonnegative()`), así que la factura se
   habría rechazado **al emitir**. Se cambia por `min(-1.000.000)`, y **la guarda que sustituye a esa
   se pone donde tiene sentido**: en `computeTotals`, sobre el TOTAL — *una línea negativa es un
   descuento y es legítima; una factura de −40 € no lo es, para eso está la rectificativa*.
2. **El preview de totales fallaba EN SILENCIO** (un `catch` vacío «para no spamear toasts»). La
   intención era buena y el efecto, malo: la pantalla enseñaba un total que **no cuadraba con sus
   propias líneas**, que es peor que un error. Ahora lo dice **donde está el total**, sin toast.
*Es la tercera vez esta noche que un `catch` mudo esconde una avería. Van tres.*

**LA PRUEBA QUE MÁS VALE, y dónde se hace.** El gate **emite una factura de verdad con descuento** y
comprueba la base (90 €), el total (108,90 €), que la línea queda guardada y que **la cadena de
huellas cuadra con ella dentro**. Y lo hace **en un negocio propio que borra entero al salir**:
una factura emitida entra en VERI\*FACTU y **ya no se puede borrar** — emitirla en el negocio
compartido sería dejar basura imborrable, que es la lección que costó 130 clientes archivados.

---

### PUNTO 12 · CONTROL HORARIO — EL REGISTRO DE JORNADA  ✅ **HECHO (23 ago 2026, noche)** · gate `scripts/gate-control-horario.mjs` · **41 ✓ · 0 ✗**

**QUÉ EXIGE LA LEY, que es lo que esto tiene que cumplir** (RD-ley 8/2019, art. 34.9 ET): registro
**diario** por trabajador con hora de inicio y de fin, conservable **cuatro años**, y **a disposición
del trabajador**, sus representantes y la Inspección.

**POR QUÉ ES UNA TABLA APARTE Y NO `time_entries`.** El encargo decía «cuelga del registro de tiempo
que ya existe, no montes un segundo motor», y **cuelga: comparte área y pantalla vecina**. Pero la
tabla no puede ser la misma, y el motivo es concreto: `time_entries` es tiempo **de proyecto** y
sirve para **facturar horas**; una jornada no tiene proyecto, no se factura e **incluye la pausa de
la comida**. Metiéndola ahí, las horas facturables de un cliente incluirían el bocadillo, y el
registro legal quedaría a merced de que alguien borrase una entrada de proyecto.

**ES UN LIBRO DE EVENTOS, NO UN ESTADO.** Se apuntan fichajes (entrada · pausa · vuelta · salida) y
**la jornada se DERIVA**. Un total guardado no se puede auditar; unos fichajes, sí.
- **Nada se borra.** Corregir **añade** un fichaje que dice a cuál sustituye; el original queda
  anulado **con su motivo y quién**, y los dos siguen en la tabla. Sin motivo no se corrige.
- **La secuencia imposible se rechaza con su motivo**, no «se arregla sola»: no se sale sin entrar,
  no se entra dos veces, no se vuelve de una pausa que no existe y **no se ficha hacia atrás**.
- **Una jornada sin cerrar se marca ABIERTA** — es un dato, no un fallo — y **la de un día pasado no
  se estira hasta ahora**: eso sería inventar horas.

**EL DERECHO DEL TRABAJADOR NO ES UN PERMISO.** «Mi semana» y «fichar» **no llevan candado**:
cualquiera que pueda entrar ve y ficha lo suyo, porque eso es lo que da la ley. Lo que sí lo lleva
(`tiempo.read`) es el bloque del **equipo** — son datos de otras personas. Comprobado con un
empleado sin permisos: ve el suyo (200) y **no** el ajeno, ni quién está dentro, ni el historial de
otro, ni puede fichar por otro, ni corregir (403 en los cinco).

**Y LO QUE NO HACE, escrito en la propia pantalla:** nóminas, horas extra, convenios y descansos
mínimos **no**. Registra y suma. Decirlo en la pantalla es lo que impide que alguien dé por hecho un
cumplimiento que no está.

**🔴 DOS FALLOS DE RELOJ, LOS DOS ENCONTRADOS PORQUE ESTO SE ESCRIBIÓ A LAS DOS DE LA MAÑANA:**
1. **`jornadaDe` mezclaba dos relojes**: `fichar` usaba el del negocio (`ahoraLocal`, Europe/Madrid)
   y el cálculo del día en curso usaba **UTC**. A las 23:50 son dos días distintos, así que el
   trabajador veía «todavía no has fichado» **un minuto después de fichar**. Un registro de jornada
   que se descuadra a medianoche no vale para lo que existe.
2. **El reloj grande de la pantalla era el del NAVEGADOR.** La captura lo enseñó sin lugar a dudas:
   **«23:39» en grande y «en pausa desde las 01:39» justo debajo**. Ahora arranca del minuto que
   dice el servidor. En un registro legal, dos relojes en la misma tarjeta parecen un fichaje
   apuntado a otra hora.
*Y un tercero, del gate y no del producto: sembraba la entrada de hoy «a las 08:00», que a la 01:38
está en el futuro — el producto rechazaba fichar después, con razón. Dos rojos que a las diez de la
mañana no habrían salido. Es la lección de los «gates escritos de día» otra vez.*

---

### PUNTO 13 · LA AGENDA DEL CRM — TAREAS Y SEGUIMIENTOS  ✅ **HECHO (23 ago 2026, noche)** · gate `scripts/gate-crm-tareas.mjs` · **38 ✓ · 0 ✗**

**LAS CUATRO PIEZAS QUE PEDÍA EL ENCARGO —«con fecha, dueño y aviso, enganchados a la línea de tiempo
del cliente»— y cómo se cumple cada una:**
| Pieza | Cómo | Cómo se comprueba |
|---|---|---|
| **Fecha** | obligatoria | una tarea sin fecha **se rechaza**, y sin título y sin cliente también |
| **Dueño** | `user_id`, y se enseña | *«sin dueño, una tarea es de todos y no la hace nadie»* — se guarda igual si no lo tiene, y **se ve que no lo tiene** |
| **Aviso** | una fuente nueva en el motor de avisos **que ya existía** | sale en la campana, en `/admin/avisos`, en el Inicio y en el correo diario **sin tocar nada más** |
| **Línea de tiempo** | `clientTimeline` las pinta con las facturas y las citas | las tres aparecen, y la vencida **marcada** |

**POR QUÉ UNA TABLA NUEVA Y NO `client_activities`.** Esa tabla es un **registro de lo que pasó**, y
la ficha la pinta como historia. Una tarea pendiente metida ahí haría que el historial enseñara como
hecho algo que **no ha pasado todavía**. Son dos cosas y se quedan en dos tablas — pero **la línea de
tiempo las junta al pintarlas**, que es donde el dueño las quiere ver.

**NADA SE BORRA.** Hecha (con su **resultado** apuntado: sin él, el siguiente seguimiento empieza a
ciegas), movida de día (**reprogramar no es anular**) o anulada **con su motivo** — las tres siguen
en la tabla. Comprobado contando filas antes y después.

**EL AVISO NO ES UNA BANDEJA NUEVA**, y eso es deliberado: se registra en `SOURCES` de `avisos.js` y
hereda todos los canales. Lleva **`crm.read`**, el mismo permiso que su pantalla — *un aviso no puede
ser una puerta trasera a datos que su pantalla te niega* — y **no tapa lo importante**: su urgencia es
301, la de una factura sin cobrar era 1773 en la medición.

**🔴 Y EL MISMO FALLO DE RELOJ DEL PUNTO 12, otra vez, en otro sitio.** El CRM entero usaba
`new Date().toISOString()` para saber qué día es. A partir de las 22:00 de Madrid en verano eso
devuelve **el día anterior**: la pantalla de tareas enseñaba «para hoy» una tarea del día pasado, y
**la cola de trabajo medía los retrasos contra un día que no era**. Ahora usa `hoyLocal()`, el mismo
reloj que la agenda, los avisos y el fichaje. *Van dos relojes descuadrados encontrados esta noche, y
los dos por trabajar de madrugada.*

---

### PUNTO 14 · FICHAS J Y K — LO EXTERNO, MEDIDO; Y LO CONSTRUIBLE, CONSTRUIDO  ✅ **HECHO (24 ago 2026, noche)** · gate `scripts/gate-importador-proveedores.mjs` · **25 ✓ · 0 ✗**

**(a) QUÉ FALTA DE FUERA, MEDIDO**

**FICHA J · pago con tarjeta en el portal.** Falta **una pasarela contratada**, y eso es una decisión
de negocio con coste, no una tarea de construcción: alta en Stripe o Redsys, credenciales y
comisiones. Medido: **cero integraciones** en el código (ni `stripe`, ni `api.stripe.com`, ni
`sis.redsys`, ni una clave `STRIPE_*`/`REDSYS_*`), y en `/etc/bamburu.env` hay **siete** variables,
ninguna de pago (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `NOTION_TOKEN`, `PUBLIC_BASE_DOMAIN`,
`HEALTHCHECKS_URL` y las dos de VERI\*FACTU).
- **(b) LO CONSTRUIBLE DE J ES CERO, Y POR DECISIÓN TUYA.** La norma del **28 jul 2026** prohíbe
  dejar **ganchos preparados** para la pasarela. Un gancho a medias es peor que nada: parece que el
  pago existe y no existe. **Así que aquí no se construye nada, y el gate comprueba que sigue sin
  haber ninguno** — y que el portal **no promete un botón que no está**, pero sí dice cómo se paga
  hoy (transferencia, con el IBAN). *Si prefieres levantar esa norma y que se deje el enchufe puesto,
  dilo y se hace: es tu regla, no mía.*
- Lo que **ya está listo** para el día que llegue: la factura, su **estado de pago derivado** y el
  IBAN viven en el portal desde antes.

**FICHA K · importadores de Holded y Quipu.** Falta **un fichero de exportación real** de esos
programas con el que comprobar sus nombres de columna. **Y la máquina ya estaba**: el importador de
la ficha H lee CSV con cuatro separadores, **automapea**, enseña vista previa, valida con el mismo
esquema que el formulario, entra **todo o nada** y **se puede deshacer**. Medido hoy: **3 tipos, 32
campos y 206 alias** de cabecera.
- **(b) LO CONSTRUIBLE, CONSTRUIDO: LOS PROVEEDORES.** Era el hueco de verdad y no dependía de nadie:
  se podían traer clientes y productos de otro programa, y **los proveedores había que teclearlos uno
  a uno**. Mismo motor, mismo permiso que el formulario (`suppliers.create`), mismo «todo o nada»,
  mismo deshacer — que **archiva, no borra**, y que hubo que enseñarle a archivar proveedores: sin esa
  línea habría dicho «hecho» sin archivar nada, *y un deshacer que miente es peor que no tenerlo*.
- **Su guarda de NIF es la SUYA, no la del cliente:** un proveedor y un cliente **pueden compartir
  NIF** (la gestoría que me factura y a la que yo facturo). Usar la del cliente habría rechazado
  filas correctas.
- **Los alias que se han añadido son una ayuda, no una promesa.** Ayudan al automapeo con cabeceras
  españolas —comprobado: acierta **10 de 10** con «Razón social», «CIF», «Persona de contacto»,
  «Población»…—, pero **esto no es «un importador de Holded verificado»**. Sin un fichero suyo
  delante, un alias es una apuesta razonable; si falla, se corrige la columna a mano.

**🔴 Y EL GATE DESTAPÓ UNA AVERÍA VIVA QUE NO ERA DE ESTE PUNTO: LA PANTALLA DEL IMPORTADOR ESTABA
MUERTA.** Al quitar las ventanitas (punto 7) convertí un `confirm()` en
`await window.confirmarEnPagina(...)` dentro de una función que **no era `async`**. Eso es un error
de sintaxis, y un error de sintaxis **mata el bloque entero** de JavaScript de la pantalla — no la
función. **Nada lo cazó:**
- `node --check` valida el fichero del **servidor**, donde ese JS es texto dentro de una plantilla;
- `lint-plantillas.mjs` busca backticks sueltos y escapes comidos, no sintaxis;
- y el barrido de pantallas del punto 7 recorrió **las 47 entradas del MENÚ**… y el importador cuelga
  de `/admin/migracion/importar`, que es una **subruta**. **Recorrer «todas las pantallas» y recorrer
  «todo el menú» no es lo mismo**, y por esa diferencia se coló.

**NACE `scripts/lint-js-servido.mjs`**, que pide cada pantalla, le saca los `<script>` y le pasa
`node --check` a cada uno — el único sitio donde ese JS es JS de verdad. **66 pantallas, 318 bloques,
todos válidos.** Y es **la sexta regla** de «Lo que solo ve un navegador» en `CLAUDE.md`.

---

### PUNTO 15 · PELDAÑO 8 — EL OFICIO DE SALUD Y BIENESTAR  ✅ **HECHO (24 ago 2026, noche)** · gate `scripts/gate-oficio-salud.mjs` · **42 ✓ · 0 ✗**

**PASO 0 — LO QUE YA ESTABA, medido antes de tocar nada.** El **mecanismo** de oficio se entregó el
15 ago (pieza 1): seis oficios, vocabulario de pantalla y catálogo precargado con duraciones reales y
fuente anotada. Y el 17 ago, la pieza 3: cuatro detectores de agenda en el vigía. Lo que faltaba era
**el oficio en sí**, que estaba a medio hacer: se llamaba «Fisioterapia y salud» y traía **cuatro
servicios, los cuatro de fisio**. Un psicólogo o un nutricionista lo elegía y se encontraba un
catálogo que no era el suyo.

**CATÁLOGO DEL SECTOR — de 4 a 14 servicios**, y ahora cubre las siete áreas que se atienden con
agenda: fisioterapia, psicología, nutrición, osteopatía, podología, logopedia y bienestar. Con sus
duraciones y su fuente, como los otros oficios.
- **EL IVA ES LO QUE MÁS SE HABRÍA EQUIVOCADO SOLO.** La asistencia sanitaria de profesional titulado
  está **exenta** (art. 20.Uno.3º LIVA), así que **12 de los 14 nacen exentos**. Pero **el masaje de
  bienestar sin finalidad terapéutica y el entrenamiento personal NO lo están**, y nacen al tipo
  general **con el nombre diciéndolo** — «Masaje de bienestar (no terapéutico)» — para que el negocio
  decida a sabiendas en vez de descubrirlo en una inspección.

**LA FICHA DEL PACIENTE — lo que se ha puesto, y sobre todo lo que NO.**
- **Puesto:** la **fecha de nacimiento**. La edad cambia la pauta de un tratamiento y es lo primero
  que se pregunta en una primera visita. La columna es de todos los negocios; **el campo solo se
  pinta en el oficio que lo pide** (`window.OFICIO_CAMPOS`), para no llenar de huecos la ficha de un
  taller.
- **✅ HECHO (24 ago 2026) — EL HISTORIAL CLÍNICO. Decisión tomada: la opción 2.** Se guarda dentro
  de Bamburu, con acceso restringido, consentimiento del paciente y registro de quién lo abre.
  **Bamburu nunca borra un historial por su cuenta.** `gate-historial-clinico`, 40 ✓.
  - **Un permiso que no perdona el rol**, y es el único del producto: entra el dueño —que responde
    ante la ley— y quien lo tenga concedido. Un `admin` sin él recibe 403. Recepción, tampoco.
  - **Solo en el oficio de salud:** en un taller da 404 aunque escribas la dirección.
  - **Sin consentimiento no escribe el MOTOR**, no la pantalla. Revocar no borra: la ley obliga.
  - **Nada se pisa:** los antecedentes se versionan y una nota se corrige añadiendo otra.
  - **La anotación privada no se filtra: no se lee.** La consulta de la copia del paciente ni
    siquiera nombra esa columna.
  - **DISA no lo ve ni pidiéndoselo el dueño** (`QUERY_PROTECTED_TABLES` se mira antes del bypass).
  - **Ningún borrado automático.** Borrar es del dueño, escribiendo el nombre del paciente.
  - ⬜ **APUNTADO, NO OCULTO — sin visor DICOM.** Los adjuntos aceptan cualquier fichero, `.dcm`
    incluido: se guarda y se descarga. No se construye visor. *Motivo (decisión del dueño, 24 ago
    2026): en fisioterapia la imagen la genera el centro de radiología y a la consulta llega el
    informe en PDF.* Si algún día hace falta, es una pieza aparte.

  ~~**⬜ NO PUESTO, Y ESTO NECESITA UNA DECISIÓN TUYA: el historial clínico.** Son **datos de salud,
  categoría especial del RGPD (art. 9)**, y guardarlos exige decisiones que no están escritas en
  ningún sitio de este proyecto. **Meter un campo «notas clínicas» sin resolverlas sería lo peor de
  los dos mundos: el dato dentro y la protección fuera.** Las tres opciones, para que elijas:
  1. **No guardarlos nunca.** El historial vive fuera de Bamburu. Cero riesgo, y el oficio queda
     cojo para quien lo esperaba.
  2. **Guardarlos con acceso restringido al profesional que atiende**, con registro de quién los
     abre y un aviso de consentimiento al dar de alta al paciente. Es lo que hace el sector, y exige
     decidir cuántos años se conservan y quién puede exportarlos.
  3. **Solo una nota libre, avisando de que no es un historial clínico** y que no se metan
     diagnósticos. Barato, y se incumple el primer día.
  *Mi recomendación es la 2, pero no es una decisión de programación y no la tomo yo.*~~ — **elegida la 2 el 24 ago 2026; queda tachado, no borrado: es el registro de lo que se preguntó.**

**LA AGENDA AJUSTADA A SU FORMA DE TRABAJAR: LAS SERIES.** Un fisio no cierra «una cita»: prescribe
**diez sesiones, los martes a las 17:00**. Eso eran diez altas a mano y diez ocasiones de
equivocarse. Ahora es una.
- **NO ES UN MOTOR NUEVO** — y esa es la mitad del asunto: llama a `createCitaSvc` una vez por
  sesión, así que hereda los huecos, los solapes, la asignación de sala y la geometría de la cadena
  de servicios. Si mañana cambia una regla de la agenda, la serie la hereda sin enterarse.
- **Y NO ES «TODO O NADA», a propósito:** si la tercera choca, **las otras se crean igual** y la que
  no cupo se devuelve con **el motivo del motor de citas** y su fecha. Deshacer nueve altas buenas
  por una colisión sería peor: el paciente ya se ha ido. Si **ninguna** cabe, se para y lo dice.

**EL AVISO QUE LE CORRESPONDE: «TRATAMIENTO SIN TERMINAR».** Alguien pagó un bono de diez sesiones,
lleva cuatro y **no tiene ninguna cita futura**. En una consulta eso no es «un cliente dormido»: es
un tratamiento sin acabar, y **el dinero ya está cobrado**, así que lo que se pierde es el resultado.
- **No se pisa con `sin_proxima_cita`**, que ya existía: aquel mira a quien vino y no dejó otra cita;
  este mira a quien **tiene sesiones pagadas sin usar**. Se puede tener cita y estar a punto de dejar
  cinco sesiones sin gastar.
- **Cruza dos áreas, así que pide los dos permisos** (`citas.read` **y** `invoices.read`).
- Y la voz propone algo **concreto** —«conviene llamarle y cerrar la siguiente sesión: ya está
  pagada, y si el bono caduca la pierde»— en vez del genérico «conviene revisar este punto».

**DOS FALLOS QUE CAZÓ EL GATE, y no el razonamiento:**
1. **`window.OFICIO_CAMPOS` llegaba SIEMPRE vacío.** `oficioDe(db)` devuelve el **id** (una cadena),
   no el objeto, así que el código pedía `'salud'.campos_ficha`. El campo no se habría pintado en
   ningún sitio, y en el negocio de desarrollo —que es «otro»— nunca se habría notado.
2. **«6 sesiónes».** El plural de *sesión* pierde la tilde. Pegar sufijos a mano lo escribe mal; se
   escriben las dos formas enteras.

**EL GATE SE TRAE SU PROPIO NEGOCIO DE SALUD** y lo borra entero al salir: fijar un oficio cambia el
vocabulario y el catálogo del negocio completo, y hacerlo en el compartido dejaría a los demás gates
hablando de «Pacientes» y «Salas».

---

## 🔍 EL BARRIDO COMPLETO DEL 24 AGO 2026 — y lo que salió de mirarlo entero

**Se corrió UNA vez al terminar los quince puntos del encargo nocturno: 65/103 en 23,6 min.** Lo que
sigue es el trabajo de mirar los **38 que no pasaron**, uno a uno. Ninguno se dio por ruido, y esa
decisión es la que dio de sí: **seis fallos de producto de verdad**, dos míos de esa noche y cuatro
anteriores que llevaban semanas o meses sin que nadie los viera.

### LOS SEIS FALLOS DE PRODUCTO

1. **El enlace público del cliente tenía DOS BOTONES MUERTOS.** «No puedo ir» y «Anular mi cita»
   llamaban a `window.confirmarEnPagina()`, que vive en el layout del panel — y `/cita/<token>` no lo
   carga. Se pulsaba y no pasaba nada, sin un solo error. **Mío, del punto 7.** Esa página lleva ahora
   su propio panel de confirmación, con su CSS, su Escape y su clic fuera.
2. **Los ABONOS no se podían emitir.** Mi guarda del punto 11 («los descuentos no pueden dejar el
   documento en negativo») miraba solo el signo del total, y en este producto **una devolución es una
   factura con las cantidades en negativo** (`verify-margen`, paso 7). **Mío**, y es exactamente lo
   que prohíbe la constante «no se pierde ninguna función existente». La condición correcta es la
   MEZCLA: hay líneas positivas y aun así el total baja de cero.
3. **La pantalla de PLANTILLAS DE CORREO estaba muerta**: no pintaba ni una. Un
   `/^https?:\/\/.+/` escrito dentro de una plantilla llegaba al navegador como `/^https?://.+/`, y
   el bloque entero de JavaScript no arrancaba. **Mío, del punto 7.**
4. **No se podía GUARDAR un informe recién creado.** La pantalla ofrece «lo que mejor se lea» y «un
   número», y la lista que valida el guardado solo tenía los cuatro dibujos: 400 «Ese tipo de gráfico
   no existe», con el panel abierto y el error dentro. **De la ficha D-ter (23 ago).**
5. **Las pestañas «Compras» y «Clientes» de Analítica no hacían nada**, ni se marcaban como activas:
   `engancharTabs()` estaba **definida y nunca llamada**. Con ellas, el selector de periodo. **De
   antes.**
6. **La ficha de una ORDEN DE COMPRA SIN LÍNEAS daba 500** — OC-0011, OC-0012 y OC-0013, del 14 jun
   2026, en estado «enviada», llevaban desde junio sin poder abrirse. `purchaseOrderTotals` usaba la
   validación de CREAR («se requiere al menos una línea») en la pantalla de VER. **De junio.**

Y un enlace muerto en Rentabilidad (`/admin/usuarios`, cuando la ruta es `/admin/users`).

### LAS DOS HERRAMIENTAS QUE DECÍAN QUE TODO ESTABA BIEN

El fallo 3 es el que más enseña, porque **las dos defensas que existen para cazarlo dieron verde**:

- **`lint-plantillas.mjs`** dejaba pasar `\/` **a propósito**, porque `<\/script>` es un idioma
  legítimo. Ahora se distinguen por lo que va delante: tras un `<` está bien; en cualquier otro sitio
  es el delimitador de un regex y la plantilla lo destruye. Probado con un fichero que lleva las dos.
- **`lint-js-servido.mjs`** recorría las 47 entradas del menú **más una lista de subrutas escrita a
  mano** — y una lista a mano se queda corta: por ahí se colaron el importador (23 ago) y las
  plantillas de correo (24 ago). Ahora **sigue los enlaces `/admin/...` del HTML de las pantallas que
  visita** (un nivel, tirando los href que son cadenas de JS a medio construir). **De 66 pantallas y
  318 bloques a 324 y 1426**, y en la primera pasada destapó el 500 de junio y el enlace muerto.

### EL RESTO DE LOS 38: COMPROBACIONES, NO PRODUCTO

- **Doce gates míos salían «SOSPECHOSOS» pasando todo.** Cierran con `RESULTADO: N ✓ · N ✗` y la
  expresión del runner no lo reconocía. Los había corrido **a mano**, que es justo lo que no
  demuestra que el barrido los sepa leer. Corregido en `run-gates.mjs`, **anclado a la palabra
  RESULTADO**: sin el ancla, cualquier número seguido de un tic valía como resumen y eso convierte un
  gate sin resumen en un falso verde.
- **Once gates se quedaron esperando un `confirm()` que ya no existe.** Al migrar las 81 ventanitas,
  los gates que no probaban el diálogo —sino que se lo quitaban de en medio con
  `page.on('dialog', d => d.accept())`— se quedaron sin nadie que aceptara el panel. Varios salían
  como «timeout» o «ProtocolError», que es lo que despista. Se añade `autoAceptarPaneles(page)` a
  `lib/gate-env.mjs`, con una **cola** (`window.__pdCola`) para los paneles con campo: el motivo de
  anular lo valida el producto y lo afirma el gate, así que no se puede adivinar. Si la cola está
  vacía, el panel con campos **se deja en paz**: mejor un gate colgado y visible que uno que se
  inventa un dato.
- **Recuentos congelados que envejecieron**: áreas (5→7), dimensiones (32→39), medidas (31→45),
  preguntas frecuentes (11→13), tipos de gráfico (4→6), puertas del menú (52→54). Donde se ha podido,
  el número se ha cambiado por la **lista**: un total suelto se queda verde si un área pierde un campo
  y otra gana otro.
- **Tres gates medían secciones de Analítica sin abrirlas.** Desde la D-ter los informes se cargan al
  desplegar su fila del índice; medir la pantalla recién cargada es medir el esqueleto. Uno de ellos
  daba además **verde falso** en dos líneas, por comparar contra el guion corto `-` cuando la pantalla
  pinta la raya larga `—`.
- **Dos gates solo pasaban de día.** `gate-agenda-visual` exigía que la agenda estuviera desplazada al
  abrir; a primera hora del día del negocio **no hay nada que subir** y el gate era rojo de madrugada
  (medido a las 01:39, con la línea de «ahora» al 11 %). Ya contemplaba el tope de abajo; ahora
  también el de arriba.
- **Un gate cogía el registro MÁS NUEVO de cada tabla** para abrir fichas — que en un barrido es casi
  siempre de otro gate corriendo a la vez, y para cuando navega ya lo han borrado: 404. Ahora coge el
  más antiguo, que es del negocio de verdad.
- **Una precondición que ningún gate posee.** `gate-margen-pantalla` exigía ver un «—» en la tabla del
  constructor, o sea un grupo **sin ninguna** línea con coste. En este negocio no existe (medido con
  las ocho dimensiones y el histórico entero: cero huecos) y el gate no puede fabricarlo, porque
  emitir una factura aquí la mete en la cadena de VERI*FACTU y no se puede quitar. Se cambió por el
  cuadre **motor ↔ pantalla**: cada hueco del motor se pinta «—» y nunca 0 ni 100 %. Si algún día hay
  un hueco, queda cubierto sin tocar nada.
- **Una carrera:** `gate-informes-legibles` esperaba 1800 ms fijos y leía la nota **a medias**; bajo la
  carga de un barrido cantaba un fallo que no existía. Ahora espera a que la nota **se quede quieta**.

### UN DATO REPARADO
El negocio de desarrollo se había quedado **sin almacén principal**: un script de limpieza archivó por
SQL el que lo era, saltándose la regla del producto (que devuelve 409 al intentar archivar el
principal). Se le devuelve la marca al más antiguo activo y **el limpiador ya lo repone solo**.

### LA SEGUNDA PASADA: 95/103, Y LOS OCHO QUE FALTABAN
Con los seis fallos de producto arreglados y las comprobaciones al día, el barrido pasó de **65/103 a
95/103**. Los ocho restantes NO eran producto: eran comprobaciones que se estorbaban a sí mismas.

- **`gate-margen-pantalla` pasaba sus 86 aserciones y moría AL LIMPIAR**: borraba su usuario de prueba
  sin soltar `user_permissions`, que no es `ON DELETE CASCADE`. En cuanto una pasada moría antes de
  limpiar —y esa noche murieron varias—, la siguiente reventaba con «FOREIGN KEY constraint failed»
  **después** de haberlo probado todo. Un gate que se envenena a sí mismo.
- **`gate-tiempo-pantalla` y `gate-rentabilidad-pantalla` no podían NI ARRANCAR.** Usaban códigos de
  proyecto FIJOS (`GATE-PRY`, `GATE-PG`, `GATE-PP`) y `proyectos.codigo` es UNIQUE: una caída sin
  limpieza dejaba el gate muerto para siempre (0 OK · 1 fallo en un segundo). **Un identificador fijo
  convierte cualquier caída en una avería permanente.** Código único por pasada.
- **`gate-importador-csv`** cerraba con «N aserciones, todas en verde»: SOSPECHOSO pasándolo todo.

### Y TRES CARRERAS, DECLARADAS EN VEZ DE MAQUILLADAS
Pasan **solos** y caen **en paralelo**, comprobado en la misma sesión. No se les ha tocado una
aserción ni bajado el listón: se han declarado en `SOLOS` con su causa escrita.

- **`gate-portal-ampliado`** verifica la **cadena propietaria entera** (`verifyTenantInvoices`): otro
  gate que cree o BORRE una factura a la vez le deja un eslabón suelto. Paralelo 34 ✓ · 1 ✗ · solo
  35 ✓ · 0 ✗.
- **`gate-informes-a-medida`** cuenta **a mano** las citas y las horas del negocio entero y las
  contrasta con el constructor. Otro gate creando una cita le mueve las dos cifras.
- **`gate-descuentos`** mira las **promociones activas del negocio compartido**, no solo las suyas.
  **El arreglo bueno, escrito para que no se olvide:** que filtre por SU promoción, como ya hacen los
  de compras con `productoDePrueba`. Mientras no esté, corre solo.

### EL CIERRE, MEDIDO
**Cuarta pasada del barrido completo: 105/106** (65/103 → 95/103 → 105/106, y el 106º es uno de los
tres lint que se acaban de meter). El único rojo que quedaba era real y no se puede arreglar
programando: en el eje del informe de Ventas sale **«GATE Rent Cliente»**, un cliente ARCHIVADO cuyas
facturas están en la cadena de VERI*FACTU. La aserción pedía cero nombres de gate y eso ya no se puede
cumplir; ahora exige cero **nuevos** y **lista por nombre** los imborrables. **Renombrarlos para que
dejen de salir en los informes es una decisión del dueño.**

**Y la limpieza, con sus cifras:**
- **Cero clientes, productos y proveedores de gate VISIBLES** en el negocio de desarrollo.
- Borrados: 7 clientes · 4 productos · 1 recurso · 50 proveedores · **22 usuarios de prueba**.
- Archivados (tienen documentos): 12 clientes · 28 proveedores.
- **Quedan DOS usuarios de prueba**, los dos archivados y los dos por un motivo escrito: «Gate FH
  Worker» tiene 3 horas fichadas y «ZZ traza» un apunte de auditoría — y un apunte de auditoría no se
  reescribe hacia atrás.
- **148 clientes archivados imborrables**: sus facturas están en la cadena legal.
- **La cadena de VERI*FACTU: 1.078 registros, CERO eslabones sueltos** (recorrida entera por huella).
- **El limpiador ya mira proveedores y usuarios**, que antes no miraba, con la misma regla: se borra
  el que está libre, se archiva el que tiene documentos.

### LOS TRES LINT ENTRAN AL BARRIDO — 103 → 106
`lint-plantillas`, `censo-ventanitas` y `lint-js-servido` estaban en `scripts/` y **solo corrían si
alguien se acordaba**, que es exactamente cómo una herramienta deja de cazar cosas: esta noche dos de
ellas dieron verde con una pantalla muerta. Grupo nuevo `lint`. Los tres cierran ya con el pie que el
runner sabe leer, y `lint-js-servido` se declara **consumidor de cupo** del freno de 600 pet./min:
pide más de 300 pantallas en un minuto, más que cualquier gate de navegador.

---

## 🧹 ENCARGO DEL 24 AGO 2026 — SANEAR LO INVISIBLE

**El argumento del encargo, y lo que lo demostró.** De 216 ficheros de comprobación, **99 no los
ejecutaba nadie**: ni corrían ni constaba que no corrieran. Al ejecutarlos uno a uno —73 pasaban, 26
no— aparecieron **dos fallos de producto que llevaban meses ahí**, y los dos los cazó una
comprobación que existía y nadie lanzaba:

- **La base de datos de un negocio, legible por cualquier usuario de la máquina.**
  `data/tenants/desarrollo.db` en 0644 y tres COPIAS DE SEGURIDAD del negocio de desarrollo en un
  directorio 0775. La pieza que cierra permisos existía desde C6 y no llegaba: cura la BD **cuando se
  abre**, y esa no se abre nunca porque **no tiene fila en `control.db`**. Ahora el arranque repasa
  todo el árbol de `data/` —registradas o no, copias incluidas— y solo aprieta directorios que
  GUARDAN bases de datos: la primera versión tocaba 157 (el caché de mapas incluido) para arreglar 4
  ficheros, y una pieza de seguridad que hace de más se acaba desactivando entera.
- **Los libros no cuadraban con los documentos.** Ventas 419.843,99 € de libro contra 418.803,39 € de
  documentos vivos; compras 121.883,06 contra 119.618,26. Causa: **65 asientos cuyo documento ya no
  existía**, de limpiezas que borraron facturas sin deshacer su apunte. Corregido como corrige un
  contable —asiento inverso, fechado hoy, con el motivo y la referencia; **cero DELETE**— y con
  `verify-libro-sin-huerfanos` para que no se vuelva a abrir.

**Y dos que parecían de producto y NO lo eran** (dicho porque el registro sirve para eso): el dinero
en inglés de la pantalla de avisos era la ASERCIÓN, que construía lo esperado como `'€' + toFixed(2)`;
y «salud nace exenta de IVA» era una premisa falsa que **corrigió Ibrahin**: la exención pide
profesional sanitario titulado Y finalidad terapéutica, así que el mismo fisio factura sin IVA una
rehabilitación y al 21 % un masaje relajante.

### CÓMO QUEDA EL CENSO
| | antes | después |
|---|---|---|
| ficheros de comprobación | 216 | 221 |
| en el barrido | 111 | **188** |
| declarados fuera, con motivo y fecha | 9 | **33** |
| **sin clasificar** | **99** | **0** |

**Y las 72 que entraron se ejecutaron enteras para medir si dejan basura: 75/75 en verde, y el
negocio ganó DOS facturas.** Las dos culpables salen del barrido y quedan declaradas:
`verify-verifactu-t1-http` emite 121,00 € y no los limpia —no puede: entran en la cadena— y
`gate-coste-horas-pantalla` emite 1.210,00 € y los ANULA, que es lo máximo que se puede hacer con una
factura, pero la fila se queda para siempre. Es la norma de `CLAUDE.md` escrita justo para esto: *un
gate que no pueda borrar lo que creó no debe crearlo en ese negocio; que se traiga el suyo.* Entran el
día que lo hagan. **Ninguna entra sucia.**

Las 21 que no pasan quedan en `DEUDA` con lo medido de cada una: la mayoría exige datos que no crea
ella (el caso de libro es `verify-permisos-coherencia`, que pide un 403 literal y el empleado de
prueba está INACTIVO, así que el rechazo llega como 302/401 — más duro, no más flojo; **comprobado a
mano: no hay agujero de permisos**). Ninguna se ablanda ni se retira.

### LO DEMÁS DEL ENCARGO
- **Las 14 pantallas escondidas, al menú**, cada una con el candado de su propia pantalla. De paso se
  cierra un agujero que llevaba anotado sin arreglar: `contabilidad` era la única clave del rail SIN
  candado, así que un empleado sin `invoices.read` VEÍA «Libros y modelos» y se comía un 403.
- **Cero cuadros de diálogo del navegador.** El «Deshacer» de conciliación era el último; pregunta ya
  dentro de la página, y se prueba PULSÁNDOLO con `prompt`/`confirm` neutralizados y también cuando
  el usuario dice que no.
- **Las seis pantallas retiradas, retiradas de verdad** (1.584 líneas) y sus 12 líneas de importación.
  Rutas registradas 642 → 603: **39 muertas fuera, ninguna viva perdida**.
- **Ningún papel se llama «Factura» sin serlo.** Con `orders.js` cae el documento de PEDIDO titulado
  «FACTURA», apuntado como riesgo legal desde julio. Nunca compartió la numeración legal (serie
  `DEV-2026-NNN`) y llevaba meses sin poder abrirse (404 medido).
- **Registro histórico, subordinado a RITUAL:** aquí se implantó el barrido en dos velocidades:
  `--rapido` a mano y el completo por temporizador cada madrugada a las 03:15. **Ese automatismo quedó
  retirado el 26 ago 2026 por contradecir la norma vigente.** Ambos modos solo pueden ejecutarse a mano
  cuando Ibrahin los solicita o autoriza expresamente; ninguna parte de este bloque histórico concede
  permiso para programarlos ni lanzarlos automáticamente.
- **Y tres listas a mano, fuera:** la de pantallas del dinero (ahora sigue enlaces: de 60 a 343
  pantallas, y destapó cinco sitios con el dinero o la fecha en inglés), la lista blanca de `voz.js`
  (ahora se deriva del código) y el recuento del mapa del barrido.

---

## 🔧 ENCARGO DEL 24 AGO 2026 — cuatro errores vistos por el dueño y los cabos de la noche

Ocho puntos. Los cuatro primeros son fallos que Ibrahin vio EN PANTALLA; los cuatro siguientes,
deuda que quedó apuntada la noche anterior.

### 1 · LOS CORREOS AL EQUIPO — y una respuesta que no esperaba
**PASO 0, la lista completa.** Correos automáticos que el producto manda a alguien del EQUIPO: **dos**
—el RESUMEN DIARIO (parte del día: deuda, cobros vencidos, pagos a proveedor, stock bajo, envíos a la
AEAT, reservas sin aprobar, recurrentes, clientes en riesgo, citas de hoy) y RECUPERAR CONTRASEÑA, que
no lleva ni un dato del negocio—. Todo lo demás va a CLIENTES o PROVEEDORES, donde no hay permisos que
consultar. Aparte, el heartbeat de las copias, que va a la dirección de Ibrahin.

**Y LO QUE SE MIDIÓ: el resumen diario YA filtraba por permisos, y lo hace bien.** Un empleado con solo
`citas.read` no recibe nada. Los correos con cifras que Ibrahin vio llegar iban a `empleado prueba
<gilibrahin@gmail.com>`, una cuenta de rol «empleado» **con 49 permisos**, entre ellos `invoices.read`,
`cobros.read`, `analytics.read` y `admin.manage_users`: cada cifra de esos correos es algo que esa
cuenta ve al entrar. **No se encontró ninguna fuga.**

**LO QUE SÍ FALTABA.** La regla se cumplía POR CONVENIO, escrita dentro del cron. `core/correo-equipo.js`
es ahora la ÚNICA puerta: quien mande algo a un compañero declara el permiso de CADA bloque, la puerta
lee los permisos DE LA BASE (nunca de quien llama), quita lo que ese destinatario no vería en pantalla
y, si no queda nada, NO MANDA. Falla cerrado en tres sitios: bloque sin permiso declarado → revienta al
escribirlo; destinatario inactivo → no recibe; usuario inexistente → tampoco.
`verify-correos-permisos` (13 ✓) enseña el correo entero de tres personas y hace de LLAMADOR
DESCUIDADO: pasa al empleado los bloques del dueño y la puerta los para.

### 2 · NO SE PODÍAN BORRAR EMPLEADOS
**PASO 0, en un navegador con sesión de dueño:** el botón estaba y funcionaba… solo con un empleado SIN
ningún permiso. **Con UN permiso: HTTP 500 «Ha ocurrido un error, inténtalo de nuevo» y el usuario
seguía ahí** — `DELETE FROM admin_users` chocaba con la clave ajena de `user_permissions`. Como
cualquier empleado útil tiene permisos, no se podía dar de baja a ninguno.

`modules/erp/usuarios-baja.js` decide en UN sitio: **sin rastro → se borra** (soltando lo suyo:
permisos, sesiones, preferencias, horarios); **con rastro → se archiva** (pierde el acceso al momento,
su sesión cae en el siguiente clic, desaparece de listas y desplegables, y su rastro queda intacto). El
rastro son **16 sitios del esquema**, cada uno con su nombre en cristiano. La pantalla PREGUNTA antes
(`GET /users/:id/baja`) y enseña qué va a pasar y por qué. Botón «Recuperar» en la fila de quien está
archivada. Al dueño y a una misma no se les ofrece, y forzar la ruta da 403. `gate-baja-empleado` 27 ✓.

### 3 · LA MIGRACIÓN NO LE LLEGABA AL EQUIPO
**DÓNDE SE CAÍA, MEDIDO:** la petición se registraba y el correo se mandaba —Resend lo aceptaba, por eso
`email_ok` decía 1—, pero iba a `hola@bamburu.com`, **que REBOTA**: el dominio está verificado para
ENVIAR con la recepción DESACTIVADA. Sonda al mismo buzón: estado **`bounced`**.
**Ahora se manda a `ibrahingil@gmail.com`** (la misma que ya usan los avisos de copia), configurable por
`settings.migracion_buzon` o `BAMBURU_MIGRACIONES_EMAIL`. **✅ CONFIRMADA por Ibrahin el 24 ago 2026:
`ibrahingil@gmail.com` es la buena.** Y no solo está puesta: el envío de las 10:32 figura en Resend
como **`delivered`**, no como «aceptado» —que fue lo que engañó al registro con la dirección vieja—.
Nada la pisa: ni la variable de entorno ni `settings.migracion_buzon` están puestas en ningún negocio. No hay más avisos al equipo en la misma situación: los otros dos van a esa dirección y llegan.

Y se arregla la causa, no el síntoma: **el fichero se guarda** (antes solo su nombre; el binario viajaba
únicamente dentro del correo) y hay **pantalla nueva en el panel de control, «Migraciones»**, con todas
las peticiones de todos los negocios, su fichero descargable y si el correo salió. Un buzón caído ya no
puede hacer desaparecer a un cliente que quiere entrar. `gate-migracion-al-equipo` 22 ✓.

### 4 · EL PANEL DE ARRANQUE Y EL LOGO
**PASO 0, los once uno a uno en un negocio nuevo:** diez se marcaban; **solo fallaba el del logo**. El
panel miraba `company_config.logo_url` —la columna vieja— y subir el fichero escribe
`company_config.company_logo_id`. Ahora mira las dos. Y el panel **se marca en el momento**: se pone al
día cuando la pestaña vuelve a estar a la vista, al volver del historial y al recuperar el foco.
`gate-arranque-once-pasos` 32 ✓, con la captura del panel abierto y el paso marcado.

### 5 · EL DINERO Y LAS FECHAS, COMO EN ESPAÑA
No eran 269 sitios sueltos: eran **QUINCE ayudantes distintos**, la mitad escribiendo `€117087.43`. Una
sola forma: `window.eur`/`window.dineroEs`/`window.fechaEs` en el componente compartido y `fmtEur` en el
servidor, con el MISMO nombre en los dos lados. **Lo que NO se tocó, y es la mitad del trabajo:** los
`toFixed(2)` que alimentan el `value` de un campo o el cuerpo de una petición, donde el número va crudo
porque alguien lo vuelve a leer. Por eso `verify-dinero-espanol` mide **sobre lo servido**: **60
pantallas —incluidas las de imprimir— sin un importe con el símbolo delante ni con punto decimal, y
sin una fecha en formato inglés.** *(En el punto 8 se le añade además una regla que mira el CÓDIGO,
porque media pantalla la dibuja el navegador después de cargar y ahí lo servido no llega.)*

### 6 · UN SOLO MOTOR DE DEUDA
Discrepaban en 242,00 € porque uno recorría CLIENTES y el otro FACTURAS. Decisión del dueño aplicada:
**se cuenta sobre las FACTURAS**. Un solo recorrido (`deudaViva`) con dos caras. **Cifra que se mueve en
pantalla: «Te deben» baja 2,00 €** (121.927,43 → 121.925,43), y la causa, buscada factura a factura, es
un ticket de mostrador sin cliente **pagado de más en 2 €** que el recorrido viejo no veía.

### 7 · LIMPIEZA
**29 negocios de prueba borrados** (33,2 MB), con sus filas de control.db y sus adjuntos. Se salvan ocho:
los dos que usan las comprobaciones, `desarrollo`, `peluqueria-gil` (lo nombra `desplegar.mjs`) y los
**cuatro negocios reales**. **148 clientes de gate renombrados** a «Cliente de pruebas» —eran 70 «GATE
Rent Cliente», 67 «GATE FH», 5 «GATE Coste» y 6 «ZZ Dormido»— y ahora agrupan en UNA fila. Para que eso
se viera hubo que arreglar algo más: el informe leía el nombre CONGELADO en la factura; la factura lo
conserva (un documento emitido no se reescribe), pero el informe usa ya el nombre de hoy. Y tres gates
reutilizan su cliente en vez de crear uno nuevo por pasada. **Las 13 comprobaciones con la ventanita
vieja, migradas**: no queda ninguna que solo sepa aceptar el diálogo del navegador.

### 8 · LA REVISIÓN COMPLETA — al final, una vez
**Primera pasada: 102/111.** Los nueve rojos, mirados uno a uno sin dar ninguno por ruido:

**Ocho eran de la comprobación, no del producto.** Al escribir el dinero como en España (punto 5),
ocho gates seguían exigiendo el texto viejo: buscaban `1234.56` y la pantalla ya decía `1.234,56 €`.
El producto estaba bien y la comprobación medía **la ortografía de la cifra en vez de la cifra**.
Corregidos para mirar el NÚMERO: `gate-descuentos`, `gate-rentabilidad-pantalla`,
`gate-facturar-horas-pantalla`, `gate-gasto-proveedor`, `gate-pagos-proveedor` (importe y fecha),
`gate-abono-proveedor`, `gate-orden-compra-c1a`, `gate-coste-horas-pantalla`,
`gate-devoluciones-proveedor` y `verify-plantillas-email`. Un detalle que costó una pasada: en
`gestión700,00 €` **no hay frontera de palabra** entre la «n» y el «7», así que `\b700,00` NO casa;
va con `(?<!\d)`. Y `gate-informes-legibles` llevaba dos aserciones atadas a datos que ya no existen
—contaba los archivados por su NOMBRE en vez de por si tienen facturas— (53 ✓).

**Uno era del producto: no había favicon.** Todas las pantallas pedían `/favicon.ico` y recibían un
**404**. Cosmético para el ojo, pero tumbaba un gate que exige CERO errores en consola: **un fallo
que no era del producto tapando los que sí lo son.** Ahora se sirve la «B» de Bamburu en un SVG
mínimo, sin fichero en disco ni dependencia nueva.

**Y la revisión me cazó a mí en el punto 5.** Al arreglar `gate-coste-horas-pantalla` vi la pantalla
de verdad, y decía: `Resultado contable 1.000,00 € (100.0% sobre lo que cobras)` · `Coste de las
horas (10.00 h)` · `⚠️ 4.00 h sin coste-hora`. **El dinero estaba bien y el número de al lado, en
inglés.** Cada pantalla se hacía su propio `toFixed(1) + '%'` teniendo la pieza compartida al lado.
Arreglado en la ficha de proyecto, la comparativa de rentabilidad, la portada de DISA, las dos tablas
de analítica y el panel de salud del superadmin. **Y en los AVISOS DE DISA**, que el encargo nombra a
propósito: llevaban además la fecha cruda («Última compra el 2026-08-01») y el mes como clave de base
de datos («cayó 12.5% en 2026-07» → «cayó 12,5 % en julio de 2026»).
Piezas nuevas, con el mismo nombre en los dos lados: `fmtNum` y `mesEs` en el servidor,
`window.numEs` en el navegador.
**Dos reglas nuevas en `verify-dinero-espanol`** para que no vuelva: (a) en pantalla, prohibido un
porcentaje con punto decimal; (b) **en el código**, prohibido `toFixed(1|2) + '%'` o `+ ' h'` —porque
media pantalla la dibuja el navegador DESPUÉS de cargar y el barrido de HTML no la ve—, dejando fuera
lo que va a CSS y `toFixed(0)`, que en español ya está bien escrito. **Probadas las dos volviendo a
meter el fallo a mano**: la de pantalla cazó cuatro porcentajes en `/admin/rentabilidad` y la de
código señaló fichero y línea.

**Segunda pasada, sobre el código final: `111/111` en 1009 s (16,8 min).**

### CONSTANTES
**Rutas 430 → 436, ninguna perdida**, comparadas una a una: las seis nuevas son `/users/:id/baja`,
`/users/:id/recuperar`, `/superadmin/migraciones`, `/superadmin/migraciones/:slug/:id/fichero`,
`/favicon.ico` y `/favicon.svg`. Cero `DROP`. Las tablas de DISA siguen fuera de `WRITABLE_TABLES`.
La cadena de VERI*FACTU, sin tocar.

---

---

# 📌 TAREAS EN FORMATO DEL ORQUESTADOR — convertidas el 31 ago 2026

> **Qué es esto.** Cinco de las mejoras del 31 ago, escritas en el formato que el orquestador
> sabe **leer y cerrar solo** (`docs/orquestador/paso-0-diagnostico.md` §2). El resto del
> backlog sigue en prosa a propósito: **solo se han convertido estas cinco**.
>
> **La prosa original NO se ha borrado.** Cada una está marcada allí donde estaba, con la fecha
> de conversión y un enlace a su bloque de aquí.
>
> **El orden de estas cinco es el que se pidió** y no lo decide el orquestador. ~~Solo la primera
> lleva el rótulo «SIGUIENTE TAREA»: es la única que el orquestador cogerá si se le suelta.~~
> **⚙️ CORREGIDO EL 31 ago 2026 (noche).** Eso era cierto y era la avería: el orquestador cerró la
> primera, se quedó **ocioso con estas cuatro escritas** y nadie le ponía el rótulo a la siguiente.
> **Ahora manda el campo `estado:`, no la etiqueta**: coge la primera `pendiente` en orden de
> documento y encadena solo. El rótulo sigue funcionando y ahora sirve para lo que quería servir:
> **saltarse el orden** cuando Ibrahin quiera otra antes. Diagnóstico y arreglo en
> `docs/orquestador/paso-0-por-que-no-encadena.md`.
>
> ⚠️ **Los criterios de aceptación los escribe el arquitecto** cuando le toque cada tarea, no
> están aquí. El orquestador rechaza un análisis que no los traiga.
>
> ✅ **CONTRADICCIÓN RESUELTA (31 ago 2026) — decisión de Ibrahin.** Hubo un momento en que el rótulo de
> «siguiente tarea» estaba en dos sitios: aquí y en la línea 9 (aislamiento de bloqueos SQLite).
> **Manda esta lista.** El rótulo de la línea 9 se retiró; aquella tarea sigue pendiente, no
> descartada. Se deja escrito lo que se creía y cuándo, en vez de borrarlo.

## ✅ HECHA (2026-08-31) — El dueño no puede ver sus propios informes por DISA · `e5111df`

- **id:** disa-informes-permiso-dueno
- **estado:** hecha
- **origen:** `docs/auditorias/diagnostico-arquitectonico.md` §4.1

`modules/disa/index.js:2528` construye el comprobador de permisos de las herramientas de informes
y de descuentos con `checkPermission` a secas, y **`checkPermission` no lleva el bypass de
owner/admin** (`core/permission-check.js:1`). El resto de `modules/disa/index.js` sí se lo añade a
mano donde hace falta (`:319`, `:1409`); aquí no. Y a un `owner` **nadie le siembra filas en
`user_permissions`** —solo se escriben cuando alguien edita permisos a mano
(`modules/erp/routes/users.js:201`)—, así que su acceso vive entero en el bypass por rol. Resultado:
`permClave('invoices.read')` es **false para el dueño**, `modules/disa/informes.js:81` le filtra la
lista y le devuelve `ocultos_por_permiso: N`.

**El dueño pide sus informes por chat y DISA le dice que no los tiene; la pantalla se los enseña.**
Rompe «las dos puertas respetan los mismos permisos» (CANON §3-bis) **justo al revés de como se
temía**: la puerta conversacional es *más estricta* que la visual, y con la única persona que lo
tiene todo. El comentario de la línea 2527 afirma que es «el MISMO `checkPermission` de
`requirePerm`», y es cierto: la primitiva es la misma; lo que falta es la mitad que `requirePerm`
tiene en la línea de al lado. Es el síntoma N2 del diagnóstico: **la regla de autorización no está
en la primitiva, así que se olvida en un punto de llamada.**

> **Cerrada por el orquestador el 2026-08-31.**
> Commits: `e5111df`
> Registro: `docs/orquestador/tareas/disa-informes-permiso-dueno.md`

## ✅ HECHA (2026-08-31) — DISA se rompe cuando el modelo llama a dos herramientas a la vez · `d9d5ed7`, `13ef3d8`

- **id:** disa-herramientas-en-paralelo
- **estado:** hecha
- **origen:** `docs/auditorias/diagnostico-arquitectonico.md` §4.2

`modules/disa/index.js:2570` coge con `find` **la primera** llamada a herramienta de la respuesta
(`data.content.find(b => b.type === 'tool_use')`), pero después empuja al historial **todas**
(`apiMessages.push({ role: 'assistant', content: data.content })`) y devuelve **un solo**
`tool_result`.

El uso de herramientas en paralelo está **activo por defecto** en la API: una respuesta puede traer
varios bloques `tool_use`, y cada uno exige su `tool_result`. La petición siguiente es inválida, la
API responde **400**, `callClaude` lo convierte en `llm_provider_error`, y el usuario lee: *«No se
pudo contactar con DISA. No se ha ejecutado ninguna acción; inténtalo de nuevo.»*

**Es un fallo de contrato disfrazado de fallo de red**: no determinista e imposible de perseguir
desde el mensaje que ve el usuario. Y con las 20 acciones más las herramientas de informes y
descuentos declaradas juntas, que el modelo pida dos en un turno **no es un caso raro**.

> **Cerrada por el orquestador el 2026-08-31.**
> Commits: `d9d5ed7`, `13ef3d8`
> Registro: `docs/orquestador/tareas/disa-herramientas-en-paralelo.md`

## TAREA — La pantalla de «no tienes permiso» abre una ventanita sobre una página en blanco

- **id:** pantalla-403-ventanita
- **estado:** pendiente
- **origen:** `docs/auditorias/diagnostico-arquitectonico.md` §4.3

La respuesta 403 de **todas** las rutas con `requirePerm` (`core/auth.js:28`) devuelve un HTML
suelto con un único script que llama a `showAccessDenied()` si existe y, si no,
`alert('Acceso no permitido')`. Pero `showAccessDenied` se define en `modules/erp/layout.js:793`, y
**ese documento no carga `layout.js`**: la condición **siempre** cae al `else`. Cada denegación de
permiso del producto es un `alert()` del navegador sobre una página en blanco. Hay una copia igual
en `modules/erp/routes/settings.js:489`.

Y si el usuario ya marcó «impedir que esta página cree cuadros de diálogo» —el segundo diálogo
seguido, que es exactamente el motivo por el que existe la norma de CERO ventanitas—, **se queda
una página en blanco y nada más**: ni ventana, ni aviso, ni explicación.

**El censo de ventanitas no lo ve**, por las dos razones del síntoma N5: `core/` está fuera de su
alcance y `alert` no está en su patrón. Se vuelve a cumplir la frase que ya está escrita en
`CLAUDE.md`: *un censo que dice cero y no es cierto es peor que no tenerlo, porque cierra la
pregunta*.

## TAREA — El portal del cliente escribe el dinero a la inglesa

- **id:** portal-formato-dinero
- **estado:** pendiente
- **origen:** TABLERO.md §G (cabo menor apuntado el 23 ago 2026)

El portal escribe los importes a la inglesa —`€6023.00`, **sin separador de miles y con punto
decimal**— en lugar del formato español.

**El matiz que no se puede perder:** esto **no es del bloque G1**. La tabla de facturas ya lo hacía
antes de G1, así que **arreglar solo el bloque nuevo dejaría dos formatos distintos en la misma
pantalla**, que es peor que el defecto actual. Se arregla **el portal entero de una vez**, no por
trozos.

## TAREA — Retirar las seis pantallas muertas que siguen en el árbol

- **id:** retirar-pantallas-muertas
- **estado:** pendiente
- **origen:** TABLERO.md §Deuda técnica (24 ago 2026) y §Backlog 31 ago (Limpieza)

Seis ficheros de pantalla **desmontados siguen en el árbol**: **1.584 líneas** en total, más sus 12
líneas de importación. Son `orders.js` (1061), `discounts.js` (191), `shipping.js` (107),
`feedback.js` (84), `reviews.js` (81) y `newsletter.js` (60). **Ninguno está montado.**

**El matiz que no se puede perder:** el registro anterior solo nombraba `orders.js`, y son seis. Y
el criterio es el mismo para los seis: **retirar o revivir, no dejarlos a medias.**

Recordatorio de la regla permanente de `CLAUDE.md`: *eliminar es sacarlo del sistema vivo, no
destruir datos*. Aquí son ficheros de código sin montar, no datos de ningún negocio.

# 🗃️ BACKLOG DE MEJORAS — sesión del 31 ago 2026 (SIN ORDEN DECIDIDO)

> **Esto NO es una cola de trabajo.** Es el volcado de todo lo que salió de las cinco auditorías del
> 31 ago. **El orden lo decide Ibrahin** (CANON §6); nada de aquí se inicia sin encargo. Los informes
> íntegros están en el repo, no aquí:
>
> - `docs/rendimiento/diagnostico-bloqueos-sqlite.md`
> - `docs/rendimiento/analisis-migracion-postgres.md`
> - `docs/auditorias/arquitectura-y-estandares.md`
> - `docs/auditorias/comparativa-referentes.md`
> - `docs/seguridad/vectores-de-ataque.md`
>
> **Orden propuesto (31 ago 2026):** `docs/auditorias/diagnostico-arquitectonico.md` reagrupa estos
> 54 puntos en 12 capacidades y las ordena **por impacto arquitectónico**. Es una PROPUESTA del
> architect: el orden lo sigue decidiendo Ibrahin (CANON §6) y no mueve nada de esta lista.

## Seguridad y datos

- [ ] **Cifrar las copias de seguridad.** Hoy en claro en dos Drive personales, con 203 clientes y 922 facturas dentro. Cierra a la vez los vectores 4 y 7 de la auditoría de seguridad. Es configuración (`rclone crypt`), no programación.
- [ ] **Manifiesto de huellas del histórico de backups.** Hoy solo se verifica la copia del día: una copia de hace cinco días se puede editar y nadie vuelve a mirarla. SHA-256 por copia, guardado aparte, comprobado contra las 14 en cada pasada.
- [ ] **La retención del backup borra aunque la subida haya fallado** (`scripts/bamburu-backup.sh:164`). Condicionar el borrado al éxito.
- [ ] **Cifrado en reposo de las bases de negocio.**
- [ ] **Permisos Paso 1:** 600 de 1.025 rutas sin comprobación de permiso visible en la línea. Recorrerlas y dejar escrito qué exige cada una. Desbloquea el Paso 2 (DISA administrando permisos).
- [ ] **Roles heredados.** Hoy son permisos casilla por casilla y persona por persona: 55 filas para 9 usuarios. Las tablas `roles`/`role_permissions`/`user_roles` no existen.
- [ ] **RGPD como función:** exportar, borrar y anonimizar los datos de un cliente. Requiere decidir antes cómo convive con la regla de no destruir datos y con la inmutabilidad fiscal.
- [ ] **2FA obligatoria para `owner`/`admin`.** Hoy es opcional, con mínimo de 8 caracteres.
- [ ] **Sesión de 24 h fijas sin renovación por actividad** (`core/auth.js:74`). Revisar.
- [ ] **CSP con `unsafe-inline`** (8 usos, `core/security-headers.js`) — hallazgo M8, esfuerzo alto.
- [ ] **2 vulnerabilidades moderadas** en dependencias (`npm audit`).
- [ ] **Ensayo de recuperación completo cronometrado**, con RTO/RPO escrito. Hoy se sabe que los ficheros abren; no cuánto se tarda en volver.
- [ ] **Anclar la cadena VERI\*FACTU fuera del servidor.** Quien tenga acceso al `.db` puede reescribir importes y recalcular la cadena. El envío real a la AEAT lo resuelve solo.

## Arquitectura

- [ ] **Los cuatro temporizadores que abren en escritura cada hora** (`caducar-reservas`, `avisos`, `propuestas`, `recordatorios-cita`), que abran en solo lectura donde solo leen.
- [ ] **Bajar la espera de bloqueo** de 5 s a una fracción: convierte «producto congelado 5 segundos» en «una operación falla rápido».
- [ ] **Un solo escritor:** que los temporizadores pidan el trabajo al servidor en vez de abrir la base.
- [ ] **Varios procesos con reparto de negocios** (opción B del diagnóstico de julio). Bloqueada hasta cerrar lo anterior.
- [ ] **Medir `worker_threads`** como alternativa a Postgres: mantiene SQLite y el aislamiento por fichero. Sin medir todavía.
- [ ] **PostgreSQL con el patrón de Odoo** (una base por negocio), cuando el número lo justifique. 571–987 h medidas. **No va primero.**

## Observabilidad

- [ ] **Integración continua** que ejecute las comprobaciones en cada subida. Hoy hay 267 gates y ningún automatismo.
- [ ] **Registro estructurado.** Hoy 22 `console.log` sueltos y el journal.
- [ ] **Métricas básicas:** cuántas peticiones, cuánto tardan, cuál va lenta.

## API

- [ ] **Versionado** (`/api/v1` no existe hoy).
- [ ] **Contrato documentado** (sin OpenAPI/Swagger).
- [ ] **Validación en todas las entradas** (`zod` en 16 sitios de 611 rutas).
- [ ] **Autenticación por token con ámbitos y cuotas.**

## Producto — de la comparativa con los grandes

- [ ] Datos de ejemplo borrables al crear un negocio.
- [ ] Que el oficio traiga también serie de facturas, IVA y recordatorios, no solo el catálogo.
- [ ] Papelera con recuperación por el propio dueño.
- [ ] Historial de cambios visible para el cliente.
- [ ] Exportación completa de todos sus datos.
- [ ] Modo de pruebas por negocio.
- [ ] Entrada como cliente para soporte, con motivo obligatorio y registro.
- [ ] Página de estado pública.
- [ ] Límites visibles antes de chocar contra ellos.
- [ ] Importación asistida con mapeo de columnas.
- [ ] Ciclo completo de suscripción: alta, cobro, tarjeta caducada, cancelación, recuperación.

## Producto — operativo

- [ ] Corregir errores de semanas atrás en documentos no fiscales.
- [ ] Deshacer una importación entera.
- [ ] Fusionar clientes duplicados.
- [ ] Búsqueda global.
- [ ] Aviso cuando dos personas editan lo mismo.
- [ ] Que el dueño vea la actividad de sus empleados.
- [ ] Acceso de gestoría sin consumir usuario.
- [ ] Canal de aviso desde dentro del programa.
- [ ] Modo mantenimiento.
- [ ] Acciones en bloque.
- [ ] Exportar cualquier lista a Excel.
- [ ] Adjuntar documentos a clientes, pedidos y facturas.
- [ ] Buscar dentro de los documentos adjuntos.

## Limpieza

- [ ] Retirar las 6 pantallas muertas (1.584 líneas ya sin montar). ↪️ **Convertida el 31 ago 2026** (id `retirar-pantallas-muertas`).
- [ ] Enlazar las 14 secciones sin acceso desde el menú.
- [ ] Reducir los 65 elementos de menú.
- [ ] Las 99 comprobaciones que nadie ejecuta: o entran al barrido o se retiran con motivo escrito.

## Decisiones tomadas el 31 ago 2026

- **Segunda copia en Google Drive** (`gilibrahin@gmail.com`), **no Backblaze**. B2 quedó medido (10 GB gratis, sin tarjeta, el backup ocupa el 3 %) y descartado por preferencia de Ibrahin por una cuenta propia.
- **Avisos de backup:** una copia caída = aviso · las dos = crítico.
- **Todo lo que hay hoy en Bamburu es de PRUEBA** hasta que Ibrahin diga lo contrario.
- **Postgres no se descarta, pero no va primero.**
- **No perseguir amplitud** (multi-moneda, nóminas, fabricación): es donde se pierde contra SAP.
