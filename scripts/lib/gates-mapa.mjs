// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL MAPA DE LOS GATES — una sola lista, leída desde los dos sitios que la necesitan
//
// POR QUÉ VIVE AQUÍ Y NO DENTRO DEL RUNNER. Lo necesitan `run-gates.mjs` (para correr) y
// `barrido-estado.mjs` (para decir qué cubriría un barrido y qué ha cambiado desde el último). Si
// cada uno tuviera su copia habría DOS listas, y el día que una cambie la otra se queda vieja en
// silencio — que es exactamente el error contra el que están escritas las cabeceras de este repo.
//
// Y NO SE PUEDE IMPORTAR `run-gates.mjs`: ese fichero EJECUTA al importarlo (lanza los gates). Un
// módulo de datos, sin efectos, es la única forma de compartirlo.

// Grupos. Un gate puede estar en varios (la regresión de Pagos incluye los de compras/proveedor).
// ── CINCO PERTENECÍAN A DOS ÁREAS, Y EL MAPA CONTABA MAL ─────────────────────────────────────────
// GRUPOS tenía 116 APUNTES para 111 comprobaciones distintas: cinco estaban escritas en dos áreas.
// El corredor las desduplicaba, así que el barrido corría bien — pero quien LEYERA esta lista para
// saber qué se comprueba contaba 116, y contaba mal.
//
// ⚙️ ARREGLADO EL 24 AGO 2026, y no borrando cobertura. Cada una vive AHORA en un solo grupo, así que
// `GRUPOS` se puede contar sumando; y la segunda pertenencia —que era real: una propuesta de DISA
// sobre un pago pertenece a pagos Y a DISA— se declara aquí abajo, que es donde `--tocado` la lee.
// Tocar `pagos` sigue corriendo sus dos propuestas; lo que ya no pasa es que el mapa mienta al contarse.
// La clave es el área DE LA QUE SE QUITÓ el apunte repetido; el valor, lo que hay que correr igual.
export const TAMBIEN_LAS_TOCA = new Map([
  ['disa',       ['verify-propuestas-pagos', 'gate-propuestas-pagos-permisos']],  // viven en «pagos»
  ['inventario', ['verify-propuestas-reposicion', 'gate-propuestas-reposicion']], // viven en «disa»
  ['margen',     ['verify-constructor']],                                          // vive en «servicios»
]);

// ── EL BARRIDO, EN DOS VELOCIDADES ───────────────────────────────────────────────────────────────
// 24 ago 2026. Meter las comprobaciones que faltaban en un solo bloque lo volvería tan largo que
// dejaría de lanzarse — y un barrido que no se lanza no protege nada. Se parte en dos:
//
//   RÁPIDO   · unos minutos. Lo que se rompe a menudo y tumba el producto. Se lanza A MANO cuando se
//              pida: `node scripts/run-gates.mjs --rapido`.
//   COMPLETO · todo. Corre SOLO cada madrugada y manda el parte por correo. Nadie lo lanza a mano en
//              horario de trabajo.
//
// LA MARCA NO SE MANTIENE A MANO, y es a propósito: hoy van 113 comprobaciones y una lista paralela
// de 113 nombres se queda desincronizada el primer día (es la lección que ya costó dos veces hoy: la
// lista blanca de voz.js y la lista de pantallas del dinero). Aquí se declara SOLO el rápido —que es
// corto y es una decisión— y todo lo demás es completo por definición. Así **ninguna queda sin
// marcar**: `velocidadDe()` devuelve siempre una de las dos, y no hay tercer estado posible.
//
// QUÉ ENTRA EN EL RÁPIDO, y por qué cada una:
export const RAPIDO = new Map([
  // Que ninguna pantalla se caiga. Son las tres que cazan una pantalla muerta, y las tres son baratas.
  ['lint-plantillas',        'una plantilla rota mata la pantalla entera y no avisa'],
  ['lint-js-servido',        'un error de sintaxis en el JS servido mata el bloque entero, en silencio'],
  ['gate-pantallas-documento', 'las pantallas de documento, pedidas como salen del servidor'],
  // Que el dinero y las fechas salgan como en España. Recorre 343 pantallas siguiendo enlaces.
  ['verify-dinero-espanol',  'el dinero y las fechas, en pantalla y en papel'],
  // Que no haya cuadros de diálogo del navegador.
  ['censo-ventanitas',       'un prompt() o un confirm() nuevo deja un botón muerto sin avisar'],
  // Y que nadie vuelva a dejar un borrado capaz de vaciar el historial de un negocio entero. Es de
  // la misma familia que el anterior —estático, <1 s, no escribe nada— y del mismo día que el daño:
  // una ruta así no se descubre por el uso, porque el que la dispara no vuelve a contarlo.
  ['censo-borrado-sin-filtro', 'un DELETE sin filtro se lleva la conversación del negocio entero (AUD-002)'],
  // Y que nadie vuelva a escribir existencias a pelo saltándose el libro de movimientos. Misma
  // familia: estático, <1 s, no escribe nada, y el daño se hace el mismo día — un stock escrito a
  // mano se evapora en el próximo recálculo y nadie sabe cuándo.
  ['censo-stock-fuera-del-libro', 'existencias escritas a pelo: se saltan las guardas y se evaporan (AUD-004)'],
  // Y que ninguna consulta de DISA se quede sin tope ni reloj. Estático, <1 s: una consulta sin
  // tope se lleva una tabla entera al proveedor de IA, y una lenta bloqueaba el servidor de todos.
  ['censo-consultas-disa', 'una consulta de DISA sin tope ni plazo se lleva la tabla entera al proveedor (AUD-005)'],
  // Y que la puerta de DISA siga puesta. Estático, <1 s: sin ella, una pagina ajena puede mandar a
  // DISA en nombre del dueño — y el orden importa, porque el csrf delante del auth la deja inservible.
  ['censo-disa-csrf', 'sin la puerta, una página ajena manda a DISA en tu nombre (AUD-006)'],
  // Y que la cerradura de la confirmación no se relaje. Estático, <1 s, y saca la expresión DEL
  // fichero para EJECUTARLA: quitar el ancla o añadir una palabra a la lista son retoques de una
  // línea que no se ven raros al leerlos, y ejecutar de más es irreversible.
  ['censo-disa-confirmacion', 'una confirmación relajada ejecuta acciones que el dueño no pidió (AUD-015)'],
  // Y que el texto que no escribió el usuario siga llegando MARCADO. Estático, <1 s, y va en `lint`
  // porque una de sus cuatro vías —el extractor de facturas— NO despierta al grupo `disa`.
  ['censo-texto-ajeno', 'texto ajeno sin marcar: una orden dentro de un dato se lee como instrucción (AUD-016)'],
  // Y que Bamburu ARRANQUE, que es la pregunta más básica de todas. Va en el rápido porque cuesta
  // 0,3 s y porque un arranque a medias ya pasó CINCO veces en 30 días sin que nadie se enterara.
  ['gate-arranque-modulos', '¿arranca Bamburu, o arranca a medias sin decirlo? (AUD-007)'],
  // Y que la copia de seguridad vaya CIFRADA, sirva para VOLVER y no se lleve los secretos en claro.
  // Corre el guion de copia DE VERDAD contra un `crypt` montado sobre una carpeta local: sin red,
  // sin Drive, sin tocar nada del servidor. 5,6 s medidos.
  ['gate-copias-cifradas', 'la copia: ¿va cifrada, sirve para volver, y no filtra los secretos? (AUD-008)'],
  // Y que el bot de Telegram siga siendo SOLO de Bamburu. Estático, <1 s: desenganchar a la fábrica
  // cuesta un rato y volver a engancharla, dos líneas en un fichero de entorno.
  ['censo-bot-de-bamburu', 'el bot de avisos: ¿sigue siendo exclusivo de Bamburu? (decisión 3 sep 2026)'],
  // Y que Bamburu no vuelva a importar nada de la carpeta de la fábrica. Estático, <1 s: la
  // tubería de Telegram se mudó a core/ el 3 sep 2026 y esto es lo que impide que un import nuevo
  // la vuelva a atar a orchestrator/.
  ['censo-avisos-sin-fabrica', 'Bamburu: ¿sigue sin importar nada de orchestrator/? (remate del bot, 3 sep 2026)'],
  // Que no falte ninguna sección ni ninguna puerta.
  ['verify-menu-completo',   'una sección sin enlace es una función que nadie encuentra'],
  // Que la cadena de VERI*FACTU esté entera. Va aquí y no en el completo por su propio motivo: exige
  // que NADIE emita una factura mientras corre, y el rápido se lanza solo y a demanda.
  ['gate-cadena-integridad', 'las dos cadenas de huellas del negocio, comparadas enteras'],
  // Seguridad del mismo día: una base de datos legible por otro usuario no puede esperar a la noche.
  ['test-c6-secretos',       'ningún secreto ni PII por un log, y ninguna BD legible por otros'],
  // Y que ningún papel se llame «Factura» sin serlo: es riesgo legal, y cuesta cero.
  ['verify-nombre-documentos', 'un papel titulado Factura que no lo es puede acabar en manos de un cliente'],
  // Y que el propio barrido no le infle las ventas al dueño. Va en el RÁPIDO porque el daño se hace
  // el mismo día: una factura emitida cuenta como venta en cuanto existe.
  ['verify-barrido-no-infla-ventas', 'ninguna comprobación deja una factura emitida en el negocio del dueño'],
]);

// La velocidad de UNA comprobación. No hay tercer estado: o está declarada arriba o es del completo.
export function velocidadDe(nombre) { return RAPIDO.has(nombre) ? 'rapido' : 'completo'; }

export const GRUPOS = {
  // ── LAS QUE NADIE EJECUTABA (24 ago 2026) ─────────────────────────────────────────────────────
  // De las 99 comprobaciones que estaban en `scripts/` y no corría nadie, estas PASAN hoy —medido,
  // una a una— y entran. Un fichero de comprobación que existe y no se ejecuta no protege nada: solo
  // da la sensación de estar cubierto, que es peor. Las que no pasan quedan declaradas en `DEUDA`
  // con su motivo y su fecha; ninguna se queda sin destino.

  // ── PANTALLAS DEL CLIENTE Y DE LA NAVEGACIÓN ─────────────────────────────────────────────────
  // NACE DE UN DESCUIDO MÍO: estos cuatro gates existían, se corrían A MANO al entregarlos, y NO
  // estaban en el barrido. Un gate fuera del barrido es un gate que nadie ejecuta, y esa es la
  // historia exacta que cuenta la cabecera de este fichero: catorce gates muertos tres semanas.
  // Añadir uno nuevo y no meterlo aquí es dejarlo muerto desde el primer día.
  clientes: [
    'gate-cliente-ficha-completa',   // ventana, tarjetas, registro de contactos y los dos márgenes
    'gate-cliente-360',              // la ficha cuadra al céntimo con la pantalla de la que sale
    'gate-menu-navegacion',          // ni una función del menú se pierde por el camino
    'gate-migracion-puerta',         // ficha B: la migración tiene puerta, y solo la ve quien puede
    'gate-agenda-visual',            // el lienzo de la agenda, y que se sirve desde la dirección real
    'gate-inicio-arranque',
           // PUNTO 4 (24 ago 2026) — los ONCE pasos del panel, hechos uno a uno. Solo fallaba el
           // del logo: el panel miraba `logo_url` y subir el fichero guarda `company_logo_id`.
           'gate-arranque-once-pasos',          // el Inicio de un negocio que arranca: panel, «Hoy» y migración
    'gate-inicio-cuadro-mando',      // el Inicio es el cuadro de mando del día (contra la dirección pública)
    'gate-vigia-pantalla',           // el vigía en su pantalla
    'gate-vigia-agenda',             // los detectores de agenda
    // ── LOS CUATRO HUÉRFANOS, DENTRO DEL BARRIDO (20 ago 2026) ───────────────────────────────
    // Existían, se corrían a mano y NO estaban en ningún grupo: ni ejecutadas ni declaradas como
    // excluidas — invisibles. Se aparcaron el 18 ago porque alargaban la revisión; desde que el
    // barrido corre en paralelo y en dos modos ese argumento ya no pesa. Y el precio de tenerlas
    // fuera se vio al meterlas: `gate-oficio-pantalla` llevaba EN ROJO desde el 18 ago —la entrada
    // de «Puestos» se había mudado y encima nació condicional— y nadie se enteró en dos días.
    // Una comprobación que nadie ejecuta acaba mintiendo.
    'gate-agenda-sencilla',          // la vista de entrada de la agenda y el alta desde el hueco
    'gate-agenda-calendario',        // el calendario de la agenda (negocio propio)
    'gate-citas-pantalla',           // la pantalla de citas: atender, cobrar y anular (neto-cero)
    'gate-oficio-pantalla',          // el vocabulario del oficio, en la pantalla y en el menú
    // ── LA VISTA MES (Tarea A · 21 ago 2026) ─────────────────────────────────────────────────
    // Se declara AQUÍ el mismo día que nace, no «cuando toque»: un gate fuera de esta lista no lo
    // ejecuta nadie, y cuatro de los de arriba llevaban semanas invisibles por eso mismo.
    // DECLARAR NO ES EJECUTAR: entra en el mapa para que el barrido lo alcance CUANDO Ibrahin lo
    // pida; no se engancha a ningún disparador automático.
    'gate-citas-mes',                // la vista Mes: base de la cifra, un solo selector, los tres grises,
                                     // el reparto del alto, el servicio en la casilla y crear desde el mes
    // ── F · EL MAPA DE LA FICHA DE CLIENTE (23 ago 2026) ─────────────────────────────────────
    // Se declara EL MISMO DÍA que nace, como la vista Mes: un gate fuera de esta lista no lo
    // ejecuta nadie. DECLARAR NO ES EJECUTAR — entra para que el barrido lo alcance CUANDO
    // Ibrahin lo pida; no se engancha a ningún disparador.
    'gate-mapa-cliente',             // el mapa: que se pinte con dirección, que NO se pinte sin ella,
                                     // que las teselas salgan de Bamburu y no de un servidor ajeno,
                                     // y que un punto de una dirección vieja no llegue a la pantalla
    // ── EL IMPORTADOR DE CSV (ficha H · 23 ago 2026) ─────────────────────────────────────────
    // Se declara AQUÍ el mismo día que nace. Va en `clientes` porque es donde vive la cobertura de
    // la migración asistida (`gate-inicio-arranque`), de la que este importador cuelga — y porque
    // lo que da de alta son clientes. DECLARAR NO ES EJECUTAR: entra en el mapa para que el barrido
    // lo alcance CUANDO Ibrahin lo pida; no se engancha a ningún disparador.
    'gate-importador-csv',           // la vista previa no escribe, el «todo o nada» se comprueba
                                     // provocando un fallo a mitad, la asistida sigue primera y el
                                     // tipo «facturas» se rechaza
    'gate-cola-envios',              // «Recordatorios a clientes»: que siga siendo una pantalla del panel
                                     // (menú, buscador, permiso), con su contenedor, el orden hoy→mañana,
                                     // el número en la cabecera y la advertencia de «marcado ≠ entregado»
  ],
  // ── LOS SEIS PAPELES (C-0 · 21 ago 2026) ──────────────────────────────────────────────────────
  // Grupo propio y no dentro de `ventas`: lo que vigila cruza venta y compra (los seis papeles, del
  // presupuesto a la orden de compra) y además la pantalla de Ajustes, que es donde vive el logo.
  // Meterlo en un grupo de área lo dejaría fuera del barrido corto de la otra mitad.
  documentos: [
    'gate-documentos',               // una sola regla congelado-vs-vivo, un solo dialecto de membrete,
                                     // el logo incrustado (sin peticiones fuera) y el PDF de los seis
  ],
  // ── LA PUERTA PÚBLICA DE RESERVA (peldaño 7 · pieza 6) — DENTRO DEL BARRIDO (20 ago 2026) ────
  // SEGUNDA ZONA ENTERA que aparece fuera del mapa en el mismo día (la primera fue la agenda). Las
  // tres existían desde el 8 ago, se corrieron el día de la entrega y NADIE las volvió a ejecutar.
  // El precio se vio al mirarlas: `test-reserva-publica` llevaba DOS DÍAS en rojo —`921bbe1` añadió
  // dos columnas `cita_pub_*` y no actualizó la cuenta— y nadie se enteró. Igual que pasó con
  // `gate-oficio-pantalla`. Una comprobación que nadie ejecuta acaba mintiendo.
  reserva: [
    'test-reserva-publica',          // 133 aserciones de lógica, sin servidor ni negocio (38 s)
    'test-neto-cero-reserva',        // reservar NO es vender; y cuando se vende, cuadra (3 s)
    'gate-reserva-publica-pantalla', // navegador contra el servidor real: reservar sin sesión (17 s)
  ],
  pagos: [
    'test-pagos-proveedor', 'gate-pagos-proveedor', 'gate-pago-cuenta', 'gate-abono-proveedor',
    'gate-gasto-proveedor', 'test-devoluciones-proveedor', 'test-compras-motor',
    'test-suppliers-saneamiento', 'test-orden-compra-c1a', 'test-recepciones-c1b',
    'gate-c1c-diferencias-cierre', 'test-c1c-diferencias-cierre',
    'verify-propuestas-pagos', 'gate-propuestas-pagos-permisos',
    // Gates de NAVEGADOR de compras: estaban en DEUDA (muertos) y volvieron el 14-jul-2026.
    'gate-orden-compra-c1a', 'gate-recepciones-c1b', 'gate-devoluciones-proveedor', 'gate-c2-revision',
  ],
  disa: [
    // 3 sep 2026 · el centinela de AUD-002: va TAMBIÉN aquí porque `modules/disa` despierta a este
    // grupo, y el borrado sin filtro vivía justo ahí. En `lint` corre siempre; aquí, cuando toca.
    'censo-borrado-sin-filtro',
    'censo-stock-fuera-del-libro',
    'censo-consultas-disa',
    'censo-disa-csrf',
    'censo-disa-confirmacion',
    'censo-texto-ajeno',
    'gate-disa-borrado-conversaciones',
    'gate-disa-confirmacion',
    'gate-disa-csrf',
    'gate-disa-stock-libro',
    'gate-disa-sql-limites',
    'gate-disa-inyeccion',
    'test-c2-captura',
    // ↓ tres que ABORTABAN por pedir la ruta de la BD por parámetro (24 ago 2026): ya arrancan
    'verify-voz', 'verify-vigia', 'verify-dibujo',
    // ↓ de las 99 invisibles (24 ago 2026), medidas y en verde:
    'gate-dibujo-pantalla', 'gate-voz-pantalla', 'test-dibujo', 'test-disa-captura-chat', 'test-disa-clientes-t5', 'test-disa-dictar-compra', 'test-disa-stock', 'test-llm-texto-respuesta', 'test-pago-voz-avisos', 'test-vigia', 'test-voz', // ⚙️ 1 sep 2026 · verify-albaranes-disa, verify-d5-create-product y verify-llm-migracion SALEN
    // de este grupo: llaman al MODELO REAL y dependen del saldo de la cuenta del proveedor, así
    // que su rojo no dice nada del producto. Declaradas con su motivo en EXCLUIDOS de
    // run-gates.mjs, con las otras nueve de su misma familia.
    'verify-propuestas-d5',
    'verify-propuestas-recurrentes', 'gate-propuestas-recurrentes',
    'verify-propuestas-dormidos', 'gate-propuestas-dormidos',
    'verify-propuestas-fiscales',
    'verify-propuestas-reposicion', 'gate-propuestas-reposicion',
    'verify-disa-query-permisos', 'verify-disa-sin-pedidos', 'verify-actividad-etiquetas',
    'gate-nav-inicio-disa', 'gate-disa-dictar-compra', 'gate-disa-adjuntar',
  ],
  inventario: [
    // ↓ de las 99 invisibles (24 ago 2026), medidas y en verde:
    'test-almacenes', 'test-almacenes-capa2', 'test-stock-pilar3', 'test-transfer-upstream', 'verify-invoice-over-stock', 'verify-mostrador-overstock-browser', 'verify-over-stock-ui','test-transfers', 'verify-traslado-auditoria', 'gate-almacenes',
               'verify-trazabilidad', 'verify-trazabilidad-flujos', 'gate-trazabilidad'],
  // `verify-avisos-crm-riesgo` ENTRA AL BARRIDO el 22 ago 2026. Estaba excluido con la nota «EN ROJO
  // desde antes (datos de riesgo ya en la BD viva)» y hoy pasa limpio: la exclusión estaba caducada
  // y lo que hacía era esconder una comprobación buena. Se mide, no se supone.
  avisos: ['test-cobros-paso2-1',
    // ↓ de las 99 invisibles (24 ago 2026), medidas y en verde:
    'gate-avisos-contador-vivo', 'test-cobros-paso2', 'verify-crm', 'verify-suggest-legible','verify-avisos-permisos', 'gate-avisos-badge', 'verify-avisos-crm-riesgo',
           // PUNTO 3 (24 ago 2026) — la petición de migración llega al equipo, y si el correo
           // falla NO se pierde: se ve en el panel de control, con su fichero.
           'gate-migracion-al-equipo',
           // PUNTO 1 (24 ago 2026) — la regla de los correos al equipo: un correo nunca lleva un
           // dato que su destinatario no podría ver en pantalla. Estructural + de comportamiento.
           'verify-correos-permisos'],
  // Escalera · paso 7 — SERVICIOS PROFESIONALES (proyectos, tiempo, facturar horas). verify-constructor
  // va incluido a propósito: facturar horas EMITE facturas reales, así que la regresión tiene que probar
  // que Ventas (la "única verdad") no se mueve por ello.
  servicios: [
    // ↓ de las 99 invisibles (24 ago 2026), medidas y en verde:
    'gate-registro-alta', 'test-coste-horas-proyecto', 'test-inicio', 'test-oficio-alta', 'test-registro-alta','test-proyectos', 'gate-proyectos-pantalla', 'test-tiempo', 'gate-tiempo-pantalla',
              'test-facturar-horas', 'gate-facturar-horas-pantalla',
              'test-rentabilidad-proyecto', 'gate-rentabilidad-pantalla', 'verify-constructor'],
  // Escalera · paso 2 — MARGEN. Vigila que la cifra de "cuánto gano" no mienta: IVA fuera, coste
  // CONGELADO (no el WAC de hoy), lo que no tiene coste apartado en vez de regalado al 100%, y el
  // total cuadrando con la suma del desglose.
  // Escalera · pasos 2-4a: margen, informes, plan financiero y el constructor. Vigilan lo mismo: que
  // ninguna cifra de la Analítica pueda contradecir a Ventas, ni regalar margen donde no hay coste.
  margen: ['verify-margen', 'gate-margen-pantalla', 'verify-responsable', 'verify-informes',
           'verify-plan-financiero'],
  // Plantillas de email editables: tocan TODOS los correos que el negocio manda.
  plantillas: ['verify-plantillas-email', 'gate-plantillas-email'],
  // LOS LISTADOS IMPRESOS. Grupo propio y no dentro de `documentos` porque son dos familias
  // distintas: `documentos` vigila los SEIS papeles de venta y compra (una factura, un albarán), y
  // esto vigila los LISTADOS (clientes, productos, facturas, lista de precios). Comparten el
  // membrete —por eso tocar `documentos.js` despierta a los dos— pero no lo demás: un listado
  // pagina, declara sus filtros y se manda entero por correo; una factura no hace nada de eso.
  // El grupo nace con cuatro listados y crecerá con los otros cuatro y con C10-e.
  impresion: ['gate-impresion'],
  // LAS PANTALLAS QUE CUELGAN DE UN DOCUMENTO. Van con `clientes` —el grupo de las pantallas del
  // panel— y no en uno propio: lo que vigilan es transversal (que ninguna reviente al abrirse), así
  // que tiene que despertarse con casi cualquier cambio de pantalla, no solo con el suyo.
  pantallas: ['gate-pantallas-documento',
    // ── LOS SEIS DE LAS FICHAS D, E, G e I (23 ago 2026) ─────────────────────────────────────
    // Se declaran al SANEAR (punto 5 de la noche), no el día que nacieron, y eso es exactamente el
    // fallo que el censo de abajo viene a impedir: entre el 22 y el 23 de agosto escribí ocho gates
    // y no metí ninguno. La costumbre de «declarar el mismo día» se me olvidó dos días seguidos.
    // DECLARAR NO ES EJECUTAR: entran para que el barrido los alcance cuando Ibrahin lo pida.
    // Los seis se han corrido a mano al entregarse, y los seis pasaron.
    'gate-informes-a-medida',        // ficha D: el constructor y las cinco piezas de la ficha
    'gate-informes-se-entienden',    // ficha D-bis: guardar se ve, y sin una sola ventanita
    'gate-informes-legibles',        // ficha D-ter: nada ilegible, el periodo, y la ayuda no miente
    'gate-inicio-widgets',           // ficha E: el cuadro de mando se coloca, se esconde y vuelve
    'gate-portal-ampliado',          // ficha G: analíticas del cliente y el canal de mensajes
    'gate-tarjeta-unica',            // ficha I: una sola tarjeta de cifra en las 56 pantallas
    // Este SÍ se declara el mismo día que nace, que es la costumbre — y ahora, además, el censo la
    // comprueba. Va en `clientes` con los otros de agenda, que es donde vive su cobertura.
    'gate-agenda-cabos',             // punto 6: quién anuló, repartible en el constructor; los cinco
                                     // cabos del 20 ago siguen vivos; y un informe que falla lo dice
    'gate-sin-ventanitas',           // punto 7: cero prompt/confirm en el producto, comprobado
                                     // PULSANDO y con las ventanitas del navegador neutralizadas
    'gate-403-permiso',              // la pantalla de «no tienes permiso»: página con texto y salida
                                     // por navegación, JSON por la API, y cero ventanitas
    'gate-cabos-apuntados',          // punto 8: los seis cabos — la voz en español, los tres motores
                                     // que faltaban (cada uno contra su control), B10 y B12
    'gate-productos-parados',        // punto 9: el área de Catálogo parte del PRODUCTO, así que un
                                     // parado sale con cero en vez de no salir
    'gate-disa-informes',            // punto 10: las dos puertas dan el mismo número y los mismos
                                     // permisos; y el enlace que da DISA se abre de verdad
    'gate-descuentos',               // punto 11: descuentos, promociones y bonos — el IVA baja en
                                     // proporción, y emite una factura de verdad en un negocio propio
    'gate-control-horario',          // punto 12: el registro de jornada — nada se borra, corregir
                                     // deja el original a la vista, y cada trabajador ve lo suyo
    'gate-crm-tareas',               // punto 13: la agenda del CRM — fecha, dueño, aviso por el
                                     // motor que ya hay, y en la línea de tiempo del cliente
    'gate-importador-proveedores',   // punto 14: lo construible de J y K — proveedores por CSV, y
                                     // que la ficha J siga SIN un solo gancho de pasarela
    'gate-oficio-salud',             // punto 15 · peldaño 8: el oficio de salud y bienestar entero
  ],
  // Sala de máquinas: superadmin, conexiones a la BD, el fichero -wal, el saneo de errores al cliente,
  // el escapado del texto del usuario (que no se vuelva HTML ni JS) y la CSP estricta de las
  // superficies endurecidas (que sigan sin 'unsafe-inline' Y con los botones vivos).

  // GRUPO NUEVO (24 ago 2026): nace al colocar las comprobaciones que nadie ejecutaba.
  agenda: ['gate-historial-clinico','test-avisos-cita', 'test-citas', 'test-coincidencia-huecos', 'test-enlace-cita', 'test-neto-cero-cita', 'test-prioridad', 'test-textos-citas'],
  // GRUPO NUEVO (24 ago 2026): nace al colocar las comprobaciones que nadie ejecutaba.
  compras: ['verify-albaranes-browser', 'verify-pedidos-browser', 'verify-quotes-browser', 'verify-mostrador-browser',
            'verify-sustitutiva-browser','verify-albaranes', 'verify-mostrador', 'verify-pdf', 'verify-pdf-http', 'verify-pedidos', 'verify-portal', 'verify-quotes', 'verify-recurrentes'],
  // GRUPO NUEVO (24 ago 2026): nace al colocar las comprobaciones que nadie ejecutaba.
  contabilidad: ['test-codigos-internos', 'test-contabilidad', 'test-contabilidad-bienes', 'test-contabilidad-modelos', 'test-contabilidad-pyg', 'test-coste-wac', 'verify-conciliacion', 'verify-conciliacion-gastos', 'verify-contabilidad-diario-mayor', 'verify-contabilidad-export'],
  // GRUPO NUEVO (24 ago 2026): nace al colocar las comprobaciones que nadie ejecutaba.
  seguridad: ['gate-c5-2fa-superadmin', 'gate-c5bis-rescate-duenyo', 'gate-c5ter-cerrojo-superadmin', 'gate-c6-find-tenant', 'test-c5-2fa-superadmin', 'test-c5-forgot', 'test-c5-sesiones', 'test-c5bis-rescate-duenyo', 'test-c5ter-sin-email', 'test-c6-acceso'],
  // GRUPO NUEVO (24 ago 2026): nace al colocar las comprobaciones que nadie ejecutaba.
  verifactu: ['verify-pieza-c', 'verify-sustitutiva', 'verify-verifactu-anulaciones', 'verify-verifactu-cadena-nif', 'verify-verifactu-cola', 'verify-verifactu-t1', 'verify-verifactu-t2'],
  // 'verify-disco-perfiles' entra el 24 ago 2026, el día que el disco se llenó al 100 % POR SEGUNDA VEZ
  // y tiró el navegador, las capturas y hasta el /tmp del sistema. El arreglo está en
  // scripts/lib/perfil-chromium.mjs; esto es el aviso, para enterarse por un rojo y no por un servidor caído.
  // 25 ago 2026 · Las dos del correo. `verify-correo-freno` prueba que el freno para de verdad al
  // llegar al tope; `verify-comprobaciones-sin-correo-real` vigila la norma del dueño: ninguna
  // comprobación vuelve a escribir a una bandeja real. Ver docs/censo-correos.md.
  infra: ['gate-arranque-modulos', 'gate-copias-cifradas', 'censo-bot-de-bamburu', 'censo-avisos-sin-fabrica', 'verify-correo-freno', 'verify-comprobaciones-sin-correo-real', 'verify-disco-perfiles', 'test-c6-secretos', 'gate-conciliacion-deshacer', 'verify-superadmin-escrituras', 'verify-tenant-lookup-readonly', 'verify-wal-acotado', 'verify-safe-error',
          'verify-xss-escape', 'gate-xss-escape', 'gate-csp-estricta',
          // PUNTO 2 (24 ago 2026) — dar de baja a alguien del equipo: borrar si no dejó rastro,
          // archivar si lo dejó, y decirlo ANTES de pulsar. Antes daba un 500 seco.
          'gate-baja-empleado',
          // 1 SEP 2026 — que el barrido del DAEMON mida lo mismo que el de mano. Vigila que el
          // navegador siga siendo el ELF de dentro del snap y no el envoltorio, que muere bajo
          // `NoNewPrivileges` y daba 28 rojos falsos por pasada. Barata: no abre navegador.
          'verify-navegador-en-el-daemon',
          // 2 SEP 2026 (manifiesto-huellas-backups) — el manifiesto de huellas del histórico de
          // copias. Tarda ~30 s (monta laboratorios rclone y ejecuta bamburu-backup.sh real dos
          // veces, en claro y en cifrado): no va al RÁPIDO. Existía y nadie lo lanzaba nunca.
          'test-manifiesto-copias',
          // 2 SEP 2026 (suscripcion-plan-y-alta) — el plan de 9,90 € + IVA, la prueba de 15 días,
          // el prorrateo hasta el día 5 y los tres estados. Barato (~1 s): no abre navegador, no
          // llama a Stripe y trabaja contra una control.db de usar y tirar, nunca la de producción.
          'test-suscripcion'],

  // ── LOS TRES LINT, DENTRO DEL BARRIDO (24 ago 2026) ──────────────────────────────────────────
  // Estaban en `scripts/` y solo corrían si alguien se acordaba, y esa noche eso salió caro DOS veces:
  //   · la pantalla de plantillas de correo llevaba MUERTA (un regex cuyas barras se comió la
  //     plantilla) y `lint-plantillas` decía «limpias», porque dejaba pasar `\/` a propósito;
  //   · y `lint-js-servido` no la visitaba, porque recorría una lista de rutas escrita a mano.
  // Una herramienta que nadie ejecuta deja de cazar cosas: es la misma lección de los gates que
  // llevaban semanas fuera del barrido. Los tres son rápidos, no escriben NADA en ningún negocio y
  // salen != 0 cuando encuentran algo, que es todo lo que el runner necesita.
  //   · lint-plantillas    — backticks sueltos y escapes que la plantilla se come (169 ficheros, <1 s)
  //   · censo-ventanitas   — que no vuelva a colarse un prompt() o un confirm() (<1 s)
  //   · censo-borrado-sin-filtro — que no vuelva a colarse un DELETE capaz de vaciar el historial
  //     de conversación de un negocio entero (AUD-002, 3 sep 2026; <1 s). Se une a los tres de
  //     arriba por el mismo motivo por el que ellos entraron: una herramienta que nadie ejecuta
  //     deja de cazar cosas.
  //   · lint-js-servido    — pide cada pantalla y compila su JavaScript en línea (~324 pantallas)
  lint: ['lint-plantillas', 'censo-ventanitas', 'censo-borrado-sin-filtro', 'censo-stock-fuera-del-libro', 'censo-consultas-disa', 'censo-disa-csrf', 'censo-disa-confirmacion', 'censo-texto-ajeno', 'censo-bot-de-bamburu', 'censo-avisos-sin-fabrica', 'gate-arranque-modulos', 'lint-js-servido', 'verify-nombre-documentos', 'verify-menu-completo',
         'verify-barrido-no-infla-ventas', 'verify-deuda-una-sola-cuenta',
         'verify-factura-exenta', 'test-oficio', 'verify-libro-sin-huerfanos', 'verify-contabilidad-backfill',
         // PUNTO 5 (24 ago 2026) — el dinero y las fechas, como en España. Se mide sobre lo
         // SERVIDO: el código tiene toFixed(2) legítimos (el valor de un campo, un cuerpo de
         // petición) que romperlos sí sería un fallo. Lo que se prohíbe es lo que lee una persona.
         'verify-dinero-espanol'],
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EN PARALELO, SIN BAJAR EL LISTÓN — quién puede correr a la vez que quién
//
// LA MEDIDA QUE MANDA ESTA SECCIÓN (20 ago 2026). El barrido tardaba 11,5 min EN SERIE, y el tiempo
// NO se iba donde parecía: arrancar Chromium son 0,6 s (26 s en todo el barrido, un 3 %) y dar de
// alta un negocio de prueba 0,36 s (3 s en total, un 0,4 %). Lo caro es el propio trabajo — 176
// cargas de página a ~0,9 s (158 s) y 101 s de esperas fijas declaradas dentro de los gates. Contra
// eso no hay truco de arranque que valga: hay que hacer varias cosas a la vez.
//
// LO QUE IMPIDE HACERLO A LO BRUTO: casi todos los gates escriben en el MISMO negocio de desarrollo.
// Dos a la vez ahí no es «más rápido», es un gate contando las facturas que le está creando otro.
// Por eso cada gate se declara en una de tres clases, y el planificador respeta la declaración:
//
//   · EMPIEZAN_DE_CERO — se traen SU PROPIO negocio (`provisionTenant`) y no tocan el de desarrollo.
//     Están aislados por diseño: pueden correr todos a la vez sin mirarse.
//   · SOLOS — necesitan el negocio de desarrollo EN SILENCIO: cuentan totales suyos (todos los
//     avisos, todas las facturas) o marcan estado compartido. Mientras uno de estos corre, NINGÚN
//     otro gate del negocio compartido arranca.
//   · el resto — comparten el negocio de desarrollo pero solo tocan LO SUYO (cada uno se trae su
//     producto con `productoDePrueba`, con sufijo único, y borra por ID lo que creó). Corren varios
//     a la vez, hasta el tope de `--jobs-compartido`.
//
// LA REGLA DURA: ningún gate se elimina, ninguno se ablanda, ningún rojo se silencia. Si al
// paralelizar sale un rojo que en serie no salía, ES UN ROJO REAL de concurrencia: el gate se
// declara SOLOS con su motivo escrito, no se toca su contenido ni se le baja el listón.

// Los que empiezan de cero. Se DECLARAN aquí (el encargo lo pide así) y además se COMPRUEBA contra
// el fichero: si un gate llama a `provisionTenant` y no está en esta lista —o al revés—, el runner
// lo dice en cada pasada. Una declaración que nadie verifica se pudre en dos semanas.
export const EMPIEZAN_DE_CERO = new Set([
  // ── LAS TRECE QUE SE TRAEN SU PROPIO NEGOCIO (24 ago 2026) ────────────────────────────────────
  // Fallaban por esperar datos sembrados a mano que ya no estaban, y sembrarlos en el negocio de
  // desarrollo no valía: varias EMITEN una factura, y una factura emitida no se borra jamás. Con su
  // propio negocio, lo que emiten nace y muere ahí dentro y se tira el negocio entero.
  'verify-albaranes-browser', 'verify-pedidos-browser', 'verify-quotes-browser', 'verify-mostrador-browser',
  'verify-sustitutiva-browser', 'gate-espera-pantalla', 'gate-historial-clinico',
  // ── LAS CINCO QUE SE TRAÍAN SU PROPIO NEGOCIO Y NO LO DECÍAN (24 ago 2026) ────────────────────
  // Lo cantaba el propio corredor en cada arranque —«la declaración y el código no dicen lo mismo»—
  // y llevaba semanas sin que nadie lo mirara, porque las cinco eran de las 99 que no ejecutaba
  // nadie. Ibrahin: «Una comprobación que crea cosas por detrás sin decirlo es la misma trampa que
  // las 99 invisibles, en pequeño.» Declaradas.
  'gate-avisos-correos',           // negocio nuevo: el resumen diario, sin tocar los datos de nadie
  'gate-c5bis-rescate-duenyo',     // negocio nuevo: los códigos de rescate del dueño se prueban desde el alta
  'test-oficio',                   // negocio nuevo POR OFICIO: es justo lo que compara, seis veces
  'test-oficio-alta',              // negocio nuevo: elegir oficio en el alta
  'test-registro-alta',            // negocio nuevo: el alta ES lo que prueba
  'gate-cliente-ficha-completa',   // negocio nuevo: la ficha entera, desde el alta
  'gate-cliente-360',              // negocio nuevo: la ficha cuadra con su pantalla de origen
  'gate-menu-navegacion',          // negocio nuevo: 52 puertas del menú, una a una
  'gate-migracion-puerta',         // negocio nuevo: es la condición del encargo («creas uno de cero»)
  'gate-agenda-visual',            // negocio nuevo: el lienzo de la agenda
  'gate-inicio-arranque',          // negocio RECIÉN CREADO: es justo lo que prueba
  // 3 sep 2026 — se trae DOS negocios, y no podía ser de otra forma: DESTRUYE conversaciones para
  // demostrar que el borrado es real. Un gate que borra no se ejecuta sobre las de nadie.
  'gate-disa-borrado-conversaciones',
  'gate-importador-csv',           // negocio nuevo: DA DE ALTA clientes y productos. En el de
                                   // desarrollo dejaría basura y le movería los totales a los
                                   // gates que exigen neto-cero.
  'gate-inicio-cuadro-mando',      // negocio nuevo + uno vacío + un empleado sin permisos
  'gate-vigia-agenda',             // negocio nuevo: los cuatro detectores de agenda
  'gate-agenda-calendario',        // negocio nuevo: el calendario, sin datos ajenos
  'gate-citas-mes',                // DOS negocios nuevos: uno de una persona y otro de catorce
  'gate-cola-envios',              // negocio nuevo: la cola vacía es justo lo primero que se mide
  'gate-documentos',               // DOS negocios nuevos: uno con logo y otro sin él (y el de al lado
                                   // sirve para probar que un negocio no ve el logo del otro)
  // `gate-pantallas-documento` NO va aquí: necesita el negocio de desarrollo, que es el único con
  // documentos de los diez tipos que abre. Se trae lo suyo (el presupuesto en borrador) y lo limpia.
  'gate-mapa-cliente',             // negocio nuevo: cuatro clientes, uno por cada caso del mapa
  // PUNTO 15 · fijar un oficio cambia el vocabulario y el catálogo del negocio ENTERO, y hacerlo en
  // el compartido dejaría a los demás gates hablando de «Pacientes» y «Salas».
  'gate-oficio-salud',             // negocio nuevo DE SALUD, con su catálogo sembrado
  'gate-impresion',                // DOS negocios nuevos: uno siembra 200 facturas para ver paginar
                                   // de verdad, y el vecino existe para probar que su PDF no trae
                                   // ni un dato del primero
  // 3 sep 2026 — negocio propio: siembra productos y MUEVE stock para demostrar que el ajuste deja
  // su apunte. En el de desarrollo movería los totales de los gates que exigen neto-cero.
  'gate-disa-stock-libro',
  // 3 sep 2026 — negocio propio: siembra 250 clientes para forzar el recorte y lanza una consulta
  // lenta a propósito. En el de desarrollo dejaría basura y ocuparía el servidor cinco segundos.
  'gate-disa-sql-limites',
  // 3 sep 2026 — negocio propio: agota a propósito el límite de mensajes de DISA y sube un adjunto.
  // En el de desarrollo dejaría el limitador gastado para los demás gates.
  'gate-disa-csrf',
  // 3 sep 2026 — negocio propio: crea un cliente y le cambia el nombre para demostrar que confirmar
  // ejecuta exactamente lo propuesto. En el de desarrollo dejaría un cliente de prueba.
  'gate-disa-confirmacion',
  // 3 sep 2026 — negocio propio, y aquí no es una preferencia: siembra órdenes maliciosas DENTRO de
  // los datos (un producto llamado «IGNORA TUS INSTRUCCIONES…»), levanta un segundo negocio para
  // comprobar que no se filtra nada entre ellos, y lanza escrituras contra la base. En el de
  // desarrollo dejaría esos nombres en los informes del dueño, que es la avería del 23 ago.
  'gate-disa-inyeccion',
]);

// NI DE CERO NI COMPARTIDO DEL TODO: los que levantan un negocio EXTRA para UN caso concreto y el
// resto del tiempo viven en el de desarrollo. La comprobación automática del runner solo mira si el
// fichero nombra `provisionTenant`, así que sin esta lista canta un desajuste que no existe — y una
// alarma falsa repetida en cada pasada enseña a no mirar las alarmas. Se declara con su motivo.
export const TENANT_EXTRA = new Map([
  ['gate-descuentos',
   'vive en el negocio de desarrollo (promociones, bonos y la pantalla de la factura), pero para EMITIR '
   + 'una factura con descuento levanta uno propio y lo borra entero al salir: una factura emitida entra '
   + 'en la cadena de VERI*FACTU y ya no se puede borrar, así que no se emite en un negocio compartido.'],
  ['gate-oficio-pantalla',
   'vive en el negocio de desarrollo (le cambia el OFICIO en company_config y lo devuelve), pero para '
   + 'el caso «un negocio de una sola persona» levanta uno propio en vez de APAGAR a las demás, que es '
   + 'lo que hacía antes del 22 ago 2026 y lo que le costó estar declarado SOLOS por dos causas.'],
]);

// Los que necesitan el negocio de desarrollo en silencio. Cada uno con su MOTIVO: un gate marcado
// «solo» sin explicar por qué es una excusa para tapar una carrera de verdad.
export const SOLOS = new Map([
  ['gate-avisos-badge',
   'cuenta TODOS los avisos del negocio y afirma «sube a N+1»; además marca «visto» para todos. '
   + 'Cualquier otro gate que cree una factura de proveedor vencida a la vez le mueve el número.'],
  ['verify-avisos-permisos',
   'cuenta los avisos por fuente sobre el negocio entero: otro gate escribiendo en él le cambia el recuento.'],
  // ── LOS DOS QUE DESTAPÓ EL PRIMER BARRIDO EN PARALELO (20 ago 2026) ──────────────────────────
  // No se han tocado, no se les ha bajado el listón: se han DECLARADO. Los dos miden el total de
  // VENTAS del negocio entero antes y después de crear y anular un documento, y afirman que queda
  // EXACTAMENTE igual («neto-cero»). Es una aserción excelente y hay que conservarla tal cual —
  // pero solo se sostiene si nadie más está facturando en ese negocio a la vez.
  ['gate-facturar-horas-pantalla',
   'mide el TOTAL DE VENTAS del negocio antes y después y exige neto-cero al céntimo. En paralelo '
   + 'salió 340.087,01 → 341.087,01: la diferencia era una factura de OTRO gate. Rojo REAL de '
   + 'concurrencia; el gate tiene razón y por eso corre solo.'],
  ['gate-rentabilidad-pantalla',
   'lo mismo con Ventas Y con el total del P&G (340.387,01 → 340.087,01 y 244.406,77 → 244.106,77 '
   + 'en la primera pasada en paralelo). Corre solo.'],
  // ── AQUÍ ESTUVO `gate-propuestas-pagos-permisos`, Y SE HA RETIRADO (22 ago 2026). Lo declaré
  // «solo» el mismo día al verlo caer en el barrido, y eso era esconder el problema subiendo el
  // tiempo de la pasada. No tenía problema de datos —ya filtraba por SU factura y SU propuesta—:
  // dormía 1.500 ms fijos tras pulsar «Registrar pago» y bajo carga leía la base antes de tiempo.
  // Arreglada la causa (espera a la CONDICIÓN, no al reloj), vuelve a correr en compañía.
  // A `gate-oficio-pantalla` se le quitó ese mismo día la causa de los usuarios —ahora levanta su
  // propio negocio de una sola persona—, pero SIGUE declarado más abajo: mueve `company_config` del
  // negocio compartido, que es una causa distinta y anterior, y esa no se ha tocado.
  // ── LOS TRES QUE DESTAPÓ EL BARRIDO DEL 24 AGO 2026 ──────────────────────────────────────────
  // Los tres pasan SOLOS y caen en paralelo, comprobado en la misma sesión: no se les ha tocado una
  // aserción ni bajado el listón, se han declarado con su causa.
  ['gate-portal-ampliado',
   'verifica la CADENA PROPIETARIA ENTERA del negocio (`verifyTenantInvoices`) con sus facturas '
   + 'dentro. Cualquier gate que cree o BORRE una factura a la vez le deja un eslabón suelto y el '
   + 'chequeo canta «el enlace con la factura anterior está roto». En paralelo: 34 ✓ · 1 ✗; solo: '
   + '35 ✓ · 0 ✗. La aserción es buena y se conserva tal cual.'],
  ['gate-informes-a-medida',
   'cuenta A MANO las citas, las horas reservadas y las ocupadas del negocio entero y las contrasta '
   + 'con el constructor. Otro gate creando una cita le mueve las dos cifras a la vez (en paralelo: '
   + '«3 en la sala vs 6 a mano» y 4 h de diferencia entre reservadas y ocupadas; solo: 99 ✓ · 0 ✗).'],
  ['gate-descuentos',
   'la propuesta de descuentos mira las PROMOCIONES ACTIVAS del negocio compartido, no solo las '
   + 'suyas: si otro gate deja una activa, salen propuestas de más y el reparto por tipo de IVA deja '
   + 'de ser el que afirma (en paralelo salieron cuatro bandas donde espera dos). EL ARREGLO BUENO '
   + 'es que el gate filtre por SU promoción, como ya hacen los de compras con `productoDePrueba`; '
   + 'mientras eso no esté, corre solo — y queda dicho para que no se olvide.'],
  ['gate-nav-inicio-disa',
   'cuenta las PROPUESTAS PENDIENTES del negocio (`contarPropuestasPendientes`) y exige que el badge '
   + 'del riel enseñe ese mismo número. Los seis gates de propuestas crean y consumen propuestas en '
   + 'ese mismo negocio: uno a la vez le cambia el número entre las dos lecturas (39 → 40). Rojo REAL '
   + 'de concurrencia; el gate está bien.'],
  ['gate-devoluciones-proveedor',
   'además de su producto propio, prueba a propósito el BLOQUEO sobre el producto 1 —el vivo, el que '
   + 'tiene traslados— y afirma que su stock y su WAC vuelven al valor de partida. Ese producto es de '
   + 'todos: otro gate moviéndolo a la vez lo dejó en 47 donde esperaba 52. Rojo REAL de concurrencia.'],
  // ── LOS QUE ENTRAN EL 20 AGO Y NO PUEDEN COMPARTIR ────────────────────────────────────────────
  // Estos tres no es que necesiten silencio: es que HACEN RUIDO. Cambian ajustes del negocio entero
  // mientras corren y lo devuelven al salir. Con otro gate leyendo a la vez, el que se equivoca es
  // el otro — y el rojo aparecería lejos de la causa, que es la peor clase de rojo.
  ['gate-citas-pantalla',
   'atiende una cita, la COBRA emitiendo una factura de verdad y luego la anula para comprobar el '
   + 'neto-cero. Mientras tanto el total de ventas del negocio se mueve y vuelve: cualquier gate que '
   + 'mida ese total a la vez leería un número que no es el suyo.'],
  ['gate-oficio-pantalla',
   'cambia el OFICIO y el nombre de los puestos en `company_config` del negocio, y los devuelve al '
   + 'salir; mientras corre, el vocabulario del negocio entero está tocado. (El 22 ago 2026 se le '
   + 'quitó la OTRA causa: desactivaba a todas las demás personas para probar el caso «una sola», y '
   + 'ahora para eso levanta su propio negocio, que nace con una. Queda solo por `company_config`.)'],
  ['gate-reserva-publica-pantalla',
   'reescribe la configuración de la PUERTA PÚBLICA del negocio entero (`cita_pub_*`: la apaga para probar '
   + 'el 404, la enciende, le cambia handle, ventana y política) y luego la restaura. Y sus aserciones de '
   + 'CERO FUGA enumeran TODOS los clientes y TODOS los usuarios activos en ese instante para exigir que '
   + 'ninguno asome en la calle. Con otro gate escribiendo a la vez, ni la configuración ni el censo son '
   + 'estables. Misma familia que gate-oficio-pantalla, que también mueve company_config.'],
  ['gate-agenda-sencilla',
   'abre el negocio de 00:00 a 24:00 SOLO PARA HOY (excepción de fecha) para que su aserción de '
   + '«huecos cerca» no dependa de la hora a la que se lance, y la borra al salir. Es un ajuste del '
   + 'negocio entero mientras dura: otro gate de agenda leyendo a la vez vería un horario que no es.'],
]);

export const claseDe = g => EMPIEZAN_DE_CERO.has(g) ? 'propio' : (SOLOS.has(g) ? 'solo' : 'compartido');

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL CENSO — que un gate no pueda volver a ser invisible (23 ago 2026)
// ════════════════════════════════════════════════════════════════════════════════════════════════
// HAY DOS FORMAS DE QUE UN GATE NO CUENTE, y las dos han pasado ya en este repo:
//   (1) NO ESTÁ EN `GRUPOS` → no lo ejecuta nadie. Le pasó a catorce gates durante tres semanas, y
//       otra vez a los cuatro de agenda del 18 al 20 de agosto: `gate-oficio-pantalla` llevaba en
//       ROJO dos días y nadie se enteró.
//   (2) SÍ ESTÁ, pero su resumen final no lo sabe leer el runner y cuenta un verde inventado.
// Contra (1) no bastaba con la buena costumbre de «declarar el mismo día», porque la costumbre se
// olvida: al medirlo el 23 de agosto había **25 ficheros `gate-*` en disco fuera del mapa**, ocho de
// ellos escritos esa misma semana. Así que la costumbre pasa a ser una COMPROBACIÓN.
//
// LA REGLA: todo `scripts/gate-*.mjs` está en `GRUPOS` **o** en `FUERA_A_PROPOSITO` con su motivo
// escrito. Lo que no esté en ninguno de los dos, el barrido lo CANTA en cada pasada. Estar fuera es
// una decisión legítima; estarlo sin que nadie lo sepa, no.

// Fuera del barrido A PROPÓSITO, cada uno con su motivo. Declarar no es esconder: esto SALE en el
// parte, y por eso una excusa floja aquí se lee y se discute.
export const FUERA_A_PROPOSITO = new Map([
  ['gate-suscripcion-rescate',
   'el camino de vuelta: paga un mes y elige. Recorre los dos escenarios con relojes de prueba de '
   + 'Stripe —dentro de los 90 días y desde la bóveda— y los dos casos incómodos (rescatar la '
   + 'víspera del día 5 y el día 6). Necesita claves de Stripe vivas. Se lanza a mano.'],
  ['gate-suscripcion-rescate-pantallas',
   'el rescate mirado con navegador: que la pantalla diga qué compra con el importe y la fecha del '
   + 'próximo cobro DELANTE, que con la tarjeta vieja fallando ofrezca cambiarla y salga con la '
   + 'nueva, y la caza de frases que juntas se contradicen. Necesita navegador y claves vivas, y '
   + 'toca el estado de un negocio real (lo devuelve en el finally). Se lanza a mano.'],
  ['gate-descarga-sin-parpadeo',
   'que la espera de la copia NO recargue la pantalla. Lo demuestra dejando una marca en `window` '
   + '—una recarga se la llevaría— y contando las navegaciones del documento, que tienen que ser '
   + 'cero. Necesita navegador y prepara una copia de verdad, así que toca el estado de un negocio '
   + 'real (lo devuelve en el finally). Se lanza a mano.'],
  ['gate-suscripcion-datos',
   'los 90 días de descarga y la bóveda: genera la copia completa de un negocio real, la contrasta '
   + 'fila a fila contra la base, comprueba que el ZIP se abre y que los CSV los lee un programa '
   + 'independiente, y mide que al día 90 se cierre la ventana sin tocar ni un dato. Genera PDFs con '
   + 'Chromium, así que es lento y necesita navegador. Se lanza a mano al tocar la suscripción.'],
  ['gate-suscripcion-datos-pantallas',
   'la descarga mirada con navegador: que desde una cuenta CORTADA se pueda descargar (pidiendo la '
   + 'ruta, no leyendo el código), que el fichero que baja se abra de verdad, y que en la bóveda no '
   + 'se ofrezca un botón que ya no lleva a ninguna parte. Necesita navegador y toca el estado de un '
   + 'negocio real (lo devuelve en el finally). Se lanza a mano.'],
  ['gate-suscripcion-impago',
   'el impago entero: fallo, los cinco avisos en su día, el corte a los 30 y la vuelta al pagar, más '
   + 'los caminos de vuelta que nadie prueba (pagar tras el primer aviso, pagar la víspera). Usa los '
   + 'relojes de prueba de Stripe para el ciclo real, así que necesita claves vivas. No manda ningún '
   + 'correo: el envío se inyecta y se captura. Se lanza a mano al tocar la suscripción.'],
  ['gate-suscripcion-impago-pantallas',
   'las dos pantallas del impago miradas con navegador —la franja de aviso y la de solo lectura— y '
   + 'la comprobación que es el corazón de la tarea: que desde una cuenta CORTADA se pueda pagar, '
   + 'pidiendo la ruta y no leyendo el código. Necesita navegador y toca el estado de un negocio '
   + 'real (lo devuelve en el finally). Se lanza a mano.'],
  ['gate-suscripcion-mensual',
   'el cobro del día 5 y el aviso de la semana antes, con el TIEMPO AVANZADO de verdad (test clocks '
   + 'de Stripe). Necesita claves de Stripe vivas, así que en un servidor sin ellas sería un rojo '
   + 'permanente. No manda ningún correo: el envío se inyecta y se captura para poder afirmar sobre '
   + 'el texto del aviso. Con `--correo-de-verdad` manda UNO al dueño, para probar el camino real. '
   + 'Se lanza a mano al tocar la suscripción.'],
  ['gate-suscripcion-alta-real',
   'el alta de tarjeta de punta a punta: abre un navegador, va al Checkout de Stripe y teclea la '
   + 'tarjeta de prueba. Necesita CLAVES DE STRIPE VIVAS y un negocio real, así que en cualquier '
   + 'servidor sin claves sería un rojo permanente — y un rojo permanente se acaba ignorando. Se '
   + 'lanza a mano al tocar la suscripción. Lo que decide el producto (precio, IVA, prorrateo, '
   + 'estados) sí va en el barrido: es `test-suscripcion`, que no toca la red.'],
  ['gate-cupones-desmontados',
   'familia VERI*FACTU: comprueba que 19 facturas de prueba se fueron y que la cadena legal no se '
   + 'movió (SHA de los 1050 registros). Se corre a mano al tocar facturación, nunca en un barrido '
   + 'que puede ir en paralelo con gates que emiten y anulan facturas.'],
  ['gate-cadena-integridad',
   'familia VERI*FACTU: recorre y compara las DOS cadenas de huellas del negocio entero y lleva una '
   + 'línea base congelada en docs/. Cualquier gate que emita una factura mientras corre le cambia '
   + 'el suelo, así que NO va en el barrido COMPLETO. ⚙️ 24 ago 2026: SÍ va en el RÁPIDO, que se '
   + 'lanza a mano y a solas — que es justo la condición que necesita.'],
]);

// El censo. Recibe la lista de ficheros de `scripts/` (quien llama tiene el fs) y NO lee disco por
// su cuenta: este módulo es de datos y no puede tener efectos, o volvería a no poder importarse.
export function censoDeGates(ficheros) {
  const base = [...new Set(ficheros
    .filter(f => /^gate-.*\.(mjs|js)$/.test(f))
    .map(f => f.replace(/\.(mjs|js)$/, '')))].sort();
  const apuntes = Object.values(GRUPOS).flat();
  const enMapa = new Set(apuntes);
  return {
    apuntes: apuntes.length,          // desde el 24 ago 2026 es igual a `distintas`: ninguna se repite
    distintas: enMapa.size,
    repetidas: apuntes.filter((g, i) => apuntes.indexOf(g) !== i),   // si esto deja de estar vacío, el mapa vuelve a contarse mal
    enDisco: base,
    dentro: base.filter(g => enMapa.has(g)),
    declaradosFuera: base.filter(g => !enMapa.has(g) && FUERA_A_PROPOSITO.has(g)),
    invisibles: base.filter(g => !enMapa.has(g) && !FUERA_A_PROPOSITO.has(g)),
    sinFichero: [...enMapa].filter(g => !ficheros.some(f => f.replace(/\.(mjs|js)$/, '') === g)),
  };
}

// ── QUÉ TOCA QUÉ — el modo corto, cuando se pide ────────────────────────────────────────────────
// Traduce «qué ficheros has cambiado» a «qué grupos hay que correr». La tabla es a mano A PROPÓSITO:
// es una decisión de cobertura, y una decisión de cobertura tiene que poder leerse y discutirse.
//
// DOS REDES DE SEGURIDAD, porque una tabla a mano se queda vieja:
//   1. EL GRAFO DE IMPORTS. Además de la tabla, se corre TODO gate que importe (directa o
//      indirectamente) un fichero cambiado. Eso es automático y no se pudre. Cubre el 58 % del
//      árbol; el 42 % restante son rutas y vistas que los gates de navegador ejercitan por HTTP sin
//      importarlas — de ahí la tabla.
//   2. LA REGLA FINAL, que devuelve TODO. Un fichero que no case con ninguna regla NO se adivina:
//      el modo corto se convierte en barrido completo y DICE qué fichero lo ha obligado.
// El modo corto NUNCA es el veredicto de la tarea: el completo va al cerrar (RITUAL.md).
export const AFECTA = [
  // ── C-0 · EL MEMBRETE Y LOS SEIS PAPELES (21 ago 2026) ──────────────────────────────────────────
  // OJO AL ORDEN Y A LO QUE LLEVA CADA REGLA: aquí manda la PRIMERA que casa, así que una regla
  // nueva delante no AÑADE cobertura — la SUSTITUYE. La primera versión de esto puso
  // `routes/(quotes|invoices|…) → ['documentos']` y con eso un cambio en facturas habría dejado de
  // despertar a `margen` y `clientes`, que es justo donde vive lo que comprueba que una factura
  // cuadra. Menos cobertura disfrazada de más. Cada regla lleva los grupos de SIEMPRE **más**
  // `documentos`.
  { re: /^modules\/erp\/(documentos|attachments)\.js/, grupos: ['documentos', 'margen', 'clientes', 'impresion'] },
  { re: /^modules\/erp\/routes\/(quotes|pedidos|invoices|mostrador)\.js/, grupos: ['documentos', 'margen', 'clientes', 'impresion', 'pantallas'] },
  { re: /^modules\/erp\/routes\/albaranes\.js/, grupos: ['documentos', 'inventario', 'pantallas'] },
  { re: /^modules\/erp\/routes\/purchase-orders\.js/, grupos: ['documentos', 'pagos', 'pantallas'] },
  { re: /^modules\/erp\/routes\/settings\.js/, grupos: ['documentos', 'plantillas', 'clientes', 'impresion'] },
  { re: /^(docs\/|.*\.md$|Logos\/|deploy\/|PROYECTO\.txt$)/, grupos: [] },        // documentación: no hay gate que correr
  // EL RUNNER Y ESTE MISMO FICHERO DECIDEN QUÉ SE CUBRE: si cambian, el modo corto no puede fiarse de
  // su propia selección. Corre todo. Pasa poco y cuando pasa es justo cuando más falta hace.
  { re: /^scripts\/(run-gates\.mjs|lib\/gates-mapa\.mjs)$/, grupos: null },
  { re: /^scripts\//, grupos: [] },                                              // los gates cambiados se añaden aparte
  { re: /^(modules\/erp\/models\.js|modules\/erp\/schemas\.js|index\.js)$/, grupos: null },   // el tronco: todo
  { re: /^core\//, grupos: null },                                               // auth, CSRF, escapes, cabeceras: todo
  // C10-e (22 ago 2026): los siete informes contables pasan por el motor de impresión, así que
  // tocar contabilidad tiene que despertar también a `impresion`. Con sus grupos de siempre, no en
  // su lugar: lo que comprueba que los libros cuadran vive en `pagos` y ahí se queda.
  { re: /^modules\/erp\/(pagos|conciliacion|contabilidad)/, grupos: ['pagos', 'impresion'] },
  { re: /^modules\/erp\/routes\/(pagos|purchases|purchase-order|supplier|conciliacion|contabilidad)/, grupos: ['pagos', 'pantallas', 'impresion'] },
  { re: /^modules\/erp\/(stock|trazabilidad|reposicion)/, grupos: ['inventario', 'impresion'] },
  { re: /^modules\/erp\/routes\/(stock|warehouses|inventory|albaranes|shipping)/, grupos: ['inventario', 'pantallas', 'impresion'] },
  { re: /^modules\/erp\/(avisos|avisos-preferencias|calendario-fiscal)/, grupos: ['avisos', 'disa'] },
  { re: /^modules\/erp\/routes\/avisos/, grupos: ['avisos'] },
  { re: /^modules\/erp\/(margen|ventas-metrics|constructor-analitica|plan-financiero|rentabilidad)/, grupos: ['margen', 'servicios'] },
  { re: /^modules\/erp\/routes\/(analytics|rentabilidad)/, grupos: ['margen'] },
  { re: /^modules\/erp\/routes\/(proyectos|tiempo|facturar-horas)/, grupos: ['servicios'] },
  { re: /^modules\/erp\/(email-templates)/, grupos: ['plantillas'] },
  { re: /^modules\/erp\/routes\/(settings)/, grupos: ['plantillas', 'clientes', 'impresion'] },
  { re: /^modules\/(disa|erp\/(propuestas|voz|vigia|prioridad|dibujo))/, grupos: ['disa', 'clientes'] },
  { re: /^modules\/erp\/(cobros|crm|cliente-360|ficha-cliente-ui|contactos)/, grupos: ['clientes', 'avisos'] },
  { re: /^modules\/erp\/(citas-engine|citas-avisos|vigia-agenda)/, grupos: ['clientes'] },
  // La puerta pública: su motor y sus rutas. Antes `routes/reserva-publica.js` no lo cubría NINGUNA
  // regla, así que tocarlo mandaba el corto a correr los 75 — prudente, pero a ciegas. Va con
  // `clientes` porque la cita reservada acaba en la agenda de dentro y allí se atiende.
  { re: /^modules\/erp\/reserva-publica/, grupos: ['reserva', 'clientes'] },
  { re: /^modules\/erp\/routes\/reserva-publica/, grupos: ['reserva', 'clientes'] },
  { re: /^modules\/erp\/(layout|menu|inicio-layout|cuadro-mando|arranque|oficios)/, grupos: ['clientes', 'pantallas'] },
  // ── TANDA 1 DE C · LOS LISTADOS IMPRESOS (21 ago 2026) ──────────────────────────────────────
  // AMPLIADO EL 22 AGO 2026 con los cuatro listados nuevos: el kardex come de `stock.js`, y compras
  // y gastos de las rutas de proveedores. Cada regla lleva sus grupos DE SIEMPRE más `impresion` —
  // nunca en su lugar: tocar `stock.js` tiene que seguir despertando a `inventario`, que es donde
  // vive lo que comprueba que el libro de stock cuadra.
  // EL MOTOR, medido: `impresion.js` lo importan DOS ficheros y los dos son de esta familia
  // (`listados.js` y `routes/listados.js`). No hay ninguna pantalla colgando de él, así que la
  // regla estrecha es la correcta, no un recorte.
  { re: /^modules\/erp\/impresion\.js$/, grupos: ['impresion'] },
  { re: /^modules\/erp\/routes\/listados\.js$/, grupos: ['impresion'] },
  // `listados.js` CORRE TODO, y aquí está la trampa de C-0 otra vez: parece un fichero del motor,
  // pero dentro viven `consultaClientes`, `consultaProductos` y `consultaFacturas`, que son LAS
  // CONSULTAS DE TRES PANTALLAS del producto —esa es justo la regla que no se negocia de este
  // encargo—. Con `['impresion']` tocar la consulta de facturas habría dejado de despertar a
  // `margen` y `clientes`. Y una de sus tres pantallas, `routes/products.js`, hoy cae en el `.*`
  // final y corre todo: cubrir menos que su propio consumidor sería quedarse corto por escrito.
  { re: /^modules\/erp\/listados\.js$/, grupos: null },
  // F · EL MAPA DE LA FICHA (23 ago 2026). El motor y la ruta de teselas hoy solo los usa la ficha
  // de cliente: van con `clientes` —donde vive su gate— y con `pantallas`, que es lo que comprueba
  // que ninguna pantalla del panel reviente al abrirse. Sin esta regla los dos caerían en el `.*`
  // final y correrían los 85: prudente, pero a ciegas.
  { re: /^modules\/erp\/(mapa-cliente\.js|routes\/mapa\.js)$/, grupos: ['clientes', 'pantallas'] },
  // La pantalla de clientes ahora ADEMÁS imprime. Va delante de la regla grande de abajo y se lleva
  // los grupos que ya tenía **más** `impresion` — si llevara solo `impresion`, tocar esta pantalla
  // dejaría de despertar al grupo `clientes`, que es donde vive casi todo lo suyo.
  { re: /^modules\/erp\/routes\/clients\.js$/, grupos: ['clientes', 'impresion'] },
  // `routes/products.js` NO lleva regla a propósito: hoy no casa con ninguna y cae en el `.*` final,
  // que corre TODOS los gates. Escribirle una con `['impresion']` sería cambiar «todo» por «uno»:
  // menos cobertura disfrazada de más. Se deja como está.
  { re: /^modules\/erp\/(routes\/(dashboard|inicio|clients|crm|cobros|citas|menu-routes|migracion|vigia)|views\/)/, grupos: ['clientes', 'pantallas'] },
  { re: /^modules\/erp\/(verifactu|facturae)/, grupos: ['margen', 'clientes'] },
  { re: /^modules\/erp\/routes\/(invoices|quotes|pedidos|mostrador|orders)/, grupos: ['margen', 'clientes', 'pantallas'] },
  { re: /^modules\/store\//, grupos: ['infra'] },
  { re: /.*/, grupos: null },                     // NO SE ADIVINA: lo que no está arriba, corre todo
];

