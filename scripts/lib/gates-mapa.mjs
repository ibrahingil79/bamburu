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
export const GRUPOS = {
  // ── PANTALLAS DEL CLIENTE Y DE LA NAVEGACIÓN ─────────────────────────────────────────────────
  // NACE DE UN DESCUIDO MÍO: estos cuatro gates existían, se corrían A MANO al entregarlos, y NO
  // estaban en el barrido. Un gate fuera del barrido es un gate que nadie ejecuta, y esa es la
  // historia exacta que cuenta la cabecera de este fichero: catorce gates muertos tres semanas.
  // Añadir uno nuevo y no meterlo aquí es dejarlo muerto desde el primer día.
  clientes: [
    'gate-cliente-ficha-completa',   // ventana, tarjetas, registro de contactos y los dos márgenes
    'gate-cliente-360',              // la ficha cuadra al céntimo con la pantalla de la que sale
    'gate-menu-navegacion',          // ni una función del menú se pierde por el camino
    'gate-agenda-visual',            // el lienzo de la agenda, y que se sirve desde la dirección real
    'gate-inicio-arranque',          // el Inicio de un negocio que arranca: panel, «Hoy» y migración
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
    'verify-propuestas-d5', 'verify-propuestas-pagos', 'gate-propuestas-pagos-permisos',
    'verify-propuestas-recurrentes', 'gate-propuestas-recurrentes',
    'verify-propuestas-dormidos', 'gate-propuestas-dormidos',
    'verify-propuestas-fiscales',
    'verify-propuestas-reposicion', 'gate-propuestas-reposicion',
    'verify-disa-query-permisos', 'verify-disa-sin-pedidos', 'verify-actividad-etiquetas',
    'gate-nav-inicio-disa', 'gate-disa-dictar-compra', 'gate-disa-adjuntar',
  ],
  inventario: ['test-transfers', 'verify-traslado-auditoria', 'gate-almacenes', 'verify-propuestas-reposicion', 'gate-propuestas-reposicion',
               'verify-trazabilidad', 'verify-trazabilidad-flujos', 'gate-trazabilidad'],
  avisos: ['verify-avisos-permisos', 'gate-avisos-badge'],
  // Escalera · paso 7 — SERVICIOS PROFESIONALES (proyectos, tiempo, facturar horas). verify-constructor
  // va incluido a propósito: facturar horas EMITE facturas reales, así que la regresión tiene que probar
  // que Ventas (la "única verdad") no se mueve por ello.
  servicios: ['test-proyectos', 'gate-proyectos-pantalla', 'test-tiempo', 'gate-tiempo-pantalla',
              'test-facturar-horas', 'gate-facturar-horas-pantalla',
              'test-rentabilidad-proyecto', 'gate-rentabilidad-pantalla', 'verify-constructor'],
  // Escalera · paso 2 — MARGEN. Vigila que la cifra de "cuánto gano" no mienta: IVA fuera, coste
  // CONGELADO (no el WAC de hoy), lo que no tiene coste apartado en vez de regalado al 100%, y el
  // total cuadrando con la suma del desglose.
  // Escalera · pasos 2-4a: margen, informes, plan financiero y el constructor. Vigilan lo mismo: que
  // ninguna cifra de la Analítica pueda contradecir a Ventas, ni regalar margen donde no hay coste.
  margen: ['verify-margen', 'gate-margen-pantalla', 'verify-responsable', 'verify-informes',
           'verify-plan-financiero', 'verify-constructor'],
  // Plantillas de email editables: tocan TODOS los correos que el negocio manda.
  plantillas: ['verify-plantillas-email', 'gate-plantillas-email'],
  // Sala de máquinas: superadmin, conexiones a la BD, el fichero -wal, el saneo de errores al cliente,
  // el escapado del texto del usuario (que no se vuelva HTML ni JS) y la CSP estricta de las
  // superficies endurecidas (que sigan sin 'unsafe-inline' Y con los botones vivos).
  infra: ['verify-superadmin-escrituras', 'verify-tenant-lookup-readonly', 'verify-wal-acotado', 'verify-safe-error',
          'verify-xss-escape', 'gate-xss-escape', 'gate-csp-estricta'],
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
  'gate-cliente-ficha-completa',   // negocio nuevo: la ficha entera, desde el alta
  'gate-cliente-360',              // negocio nuevo: la ficha cuadra con su pantalla de origen
  'gate-menu-navegacion',          // negocio nuevo: 50 puertas del menú, una a una
  'gate-agenda-visual',            // negocio nuevo: el lienzo de la agenda
  'gate-inicio-arranque',          // negocio RECIÉN CREADO: es justo lo que prueba
  'gate-inicio-cuadro-mando',      // negocio nuevo + uno vacío + un empleado sin permisos
  'gate-vigia-agenda',             // negocio nuevo: los cuatro detectores de agenda
  'gate-agenda-calendario',        // negocio nuevo: el calendario, sin datos ajenos
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
   'DESACTIVA a todos los demás usuarios del negocio para probar la pantalla con una sola persona, y '
   + 'cambia el oficio y el nombre de los puestos en `company_config`. Lo devuelve todo al salir, pero '
   + 'mientras corre el negocio entero está tocado: no puede compartir.'],
  ['gate-agenda-sencilla',
   'abre el negocio de 00:00 a 24:00 SOLO PARA HOY (excepción de fecha) para que su aserción de '
   + '«huecos cerca» no dependa de la hora a la que se lance, y la borra al salir. Es un ajuste del '
   + 'negocio entero mientras dura: otro gate de agenda leyendo a la vez vería un horario que no es.'],
]);

export const claseDe = g => EMPIEZAN_DE_CERO.has(g) ? 'propio' : (SOLOS.has(g) ? 'solo' : 'compartido');

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
  { re: /^(docs\/|.*\.md$|Logos\/|deploy\/|PROYECTO\.txt$)/, grupos: [] },        // documentación: no hay gate que correr
  // EL RUNNER Y ESTE MISMO FICHERO DECIDEN QUÉ SE CUBRE: si cambian, el modo corto no puede fiarse de
  // su propia selección. Corre todo. Pasa poco y cuando pasa es justo cuando más falta hace.
  { re: /^scripts\/(run-gates\.mjs|lib\/gates-mapa\.mjs)$/, grupos: null },
  { re: /^scripts\//, grupos: [] },                                              // los gates cambiados se añaden aparte
  { re: /^(modules\/erp\/models\.js|modules\/erp\/schemas\.js|index\.js)$/, grupos: null },   // el tronco: todo
  { re: /^core\//, grupos: null },                                               // auth, CSRF, escapes, cabeceras: todo
  { re: /^modules\/erp\/(pagos|conciliacion|contabilidad)/, grupos: ['pagos'] },
  { re: /^modules\/erp\/routes\/(pagos|purchases|purchase-order|supplier|conciliacion|contabilidad)/, grupos: ['pagos'] },
  { re: /^modules\/erp\/(stock|trazabilidad|reposicion)/, grupos: ['inventario'] },
  { re: /^modules\/erp\/routes\/(stock|warehouses|inventory|albaranes|shipping)/, grupos: ['inventario'] },
  { re: /^modules\/erp\/(avisos|avisos-preferencias|calendario-fiscal)/, grupos: ['avisos', 'disa'] },
  { re: /^modules\/erp\/routes\/avisos/, grupos: ['avisos'] },
  { re: /^modules\/erp\/(margen|ventas-metrics|constructor-analitica|plan-financiero|rentabilidad)/, grupos: ['margen', 'servicios'] },
  { re: /^modules\/erp\/routes\/(analytics|rentabilidad)/, grupos: ['margen'] },
  { re: /^modules\/erp\/routes\/(proyectos|tiempo|facturar-horas)/, grupos: ['servicios'] },
  { re: /^modules\/erp\/(email-templates)/, grupos: ['plantillas'] },
  { re: /^modules\/erp\/routes\/(settings)/, grupos: ['plantillas', 'clientes'] },
  { re: /^modules\/(disa|erp\/(propuestas|voz|vigia|prioridad|dibujo))/, grupos: ['disa', 'clientes'] },
  { re: /^modules\/erp\/(cobros|crm|cliente-360|ficha-cliente-ui|contactos)/, grupos: ['clientes', 'avisos'] },
  { re: /^modules\/erp\/(citas-engine|citas-avisos|vigia-agenda|reserva-publica)/, grupos: ['clientes'] },
  { re: /^modules\/erp\/(layout|menu|inicio-layout|cuadro-mando|arranque|oficios)/, grupos: ['clientes'] },
  { re: /^modules\/erp\/(routes\/(dashboard|inicio|clients|crm|cobros|citas|menu-routes|migracion|vigia)|views\/)/, grupos: ['clientes'] },
  { re: /^modules\/erp\/(verifactu|facturae)/, grupos: ['margen', 'clientes'] },
  { re: /^modules\/erp\/routes\/(invoices|quotes|pedidos|mostrador|orders)/, grupos: ['margen', 'clientes'] },
  { re: /^modules\/store\//, grupos: ['infra'] },
  { re: /.*/, grupos: null },                     // NO SE ADIVINA: lo que no está arriba, corre todo
];

