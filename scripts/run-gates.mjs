#!/usr/bin/env node
//
// run-gates.mjs — el barrido de regresión. Corre gates y dice la VERDAD sobre cada uno.
//
// POR QUÉ EXISTE. No había runner: la regresión se corría a mano, con bucles de shell improvisados.
// El 11-jul-2026 uno de esos bucles decidía "aprobado" buscando la cadena "✗" en la SALIDA del gate.
// Catorce gates que morían al arrancar —sin imprimir ni una aserción— no contenían ningún "✗", así
// que el bucle los dio por VERDES. Llevaban tres semanas muertos. El fallo no estaba en los gates
// (salían con código != 0, como debe ser): estaba en quien los miraba.
//
// Reglas de este runner, para que eso no pueda repetirse:
//   1. Manda el CÓDIGO DE SALIDA, no lo que el gate imprima. 0 = pasa. Cualquier otra cosa = falla.
//   2. Un gate que sale 0 pero NO imprime un resumen reconocible ("N OK") es SOSPECHOSO, y cuenta
//      como FALLO. Un aprobado tiene que demostrarse, no presumirse del silencio.
//   3. El código 2 (lo usa lib/gate-env.mjs) se reporta aparte, como ABORTADO: el gate no pudo ni
//      arrancar. No es "falla un test": es "no se ha probado nada". Se distingue a propósito.
//   4. El runner sale != 0 si algo falla o aborta. Si se mete en un CI, el CI se entera.
//
// DOS MODOS (RITUAL.md · rutina de cierre):
//   node scripts/run-gates.mjs --tocado     # ANTES DE CADA COMMIT: solo los gates de lo que has tocado
//   node scripts/run-gates.mjs --all        # AL CERRAR LA TAREA: el barrido completo, una vez
//
//   node scripts/run-gates.mjs pagos        # un grupo
//   node scripts/run-gates.mjs disa motor   # varios grupos
//   node scripts/run-gates.mjs gate-pagos-proveedor verify-propuestas-pagos   # gates sueltos
//   --jobs=N --jobs-navegador=N --jobs-compartido=N   # topes de paralelismo (sección de más abajo)
//   --lista                                 # dice qué correría y se va, sin correr nada
//   --serie                                 # uno detrás de otro, como antes: para comparar barridos
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { cpus } from 'os';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 300000;

// Grupos. Un gate puede estar en varios (la regresión de Pagos incluye los de compras/proveedor).
const GRUPOS = {
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
    'gate-vigia-agenda',             // los detectores de agenda (1 aserción EN ROJO desde antes: ver DEUDA)
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

// ── Gates que NO entran en el barrido, y POR QUÉ ────────────────────────────────────────────────
// Se imprimen SIEMPRE al final, con su motivo. Un gate que no se corre tiene que VERSE: desaparecer
// en silencio es exactamente el pecado que originó este runner.
//
// DEUDA — VACÍA desde el 14-jul-2026. Aquí vivían los 7 gates de navegador que el 11-jul quedaron
// muertos. Se diagnosticaron uno a uno y NINGUNO era un fallo del producto:
//
//   · gate-recepciones-c1b, gate-devoluciones-proveedor — CADUCADOS de verdad: anulaban compras del
//     producto 1, que hoy tiene traslados confirmados, y el guardián del multi-almacén lo bloquea con
//     un 409 (y hace BIEN). Ahora cada uno se trae SU PROPIO producto para el camino feliz y, además,
//     AFIRMA el bloqueo sobre un producto trasladado. Se prueban los dos caminos, no uno en vez del otro.
//   · gate-orden-compra-c1a — CADUCADO: esperaba un alert() y la UI usa toast(). De regalo, el alert
//     fantasma envenenaba la cola de diálogos y el prompt siguiente anulaba con motivo vacío. Y mandaba
//     un email REAL al dueño en cada pasada: ahora el envío se sigue probando contra Resend, pero a su
//     buzón sumidero.
//   · gate-almacenes — se envenenaba solo: se buscaba POR NOMBRE y enganchaba el almacén rancio de la
//     pasada anterior. Nombre único por pasada y borra lo suyo al salir.
//   · gate-c2-captura, gate-disa-captura-chat — el diagnóstico que había escrito aquí ERA FALSO
//     ("#step2 ya no existe": sí existe). La causa real: el tenant agotó su tope de gasto de IA del mes
//     y el modelo devolvía 429. Partidos en dos (ver EXCLUIDOS y los gates -revision/-adjuntar).
//   · gate-registro-tailscale — no es deuda: es un entorno que falta (ver ENTORNO).
//
// La moraleja, para el que venga: un gate que se apoya en datos vivos ajenos, o en el saldo de una
// cuenta, no se pudre por culpa del producto. Se pudre porque no era suyo lo que pisaba.
const DEUDA = {};

// ROJOS CONOCIDOS de gates que SÍ se ejecutan. No son deuda (el gate corre y verifica), pero su rojo
// es anterior y de otro tema: se declara aquí para que salga por su nombre en cada barrido en vez de
// perderse entre los demás. Un rojo con dueño y motivo es información; un rojo anónimo es ruido.
const ROJOS_CONOCIDOS = {
  'gate-vigia-agenda':
    '1 aserción EN ROJO desde antes de meterlo al barrido (19-ago-2026): los hallazgos de agenda no '
    + 'asoman en el bloque del vigía del Inicio. Comprobado que NO es del cambio que lo destapó '
    + '(idéntico con vigia.js revertido a HEAD). Las otras 40 aserciones pasan. Otro tema.',
};

// Excluidos por naturaleza, no por estar rotos: no son deuda, simplemente no van en un barrido.
const EXCLUIDOS = {
  'verify-disa-pedidos-modelo-real': 'llama al MODELO REAL: ni determinista ni gratis. A mano.',
  'gate-pago-voz-avisos': 'llama al MODELO REAL (misma familia). A mano y a conciencia.',
  'gate-c2-captura':
    'llama al MODELO REAL (visión) para LEER la factura: cuesta dinero y depende de la cuota de IA del mes. '
    + 'Sin cuota ABORTA (código 2), no finge. La PANTALLA de revisión —que es lo que se rompe— sí va en el barrido: gate-c2-revision.',
  'gate-disa-captura-chat':
    'llama al MODELO REAL por el chat de DISA (misma familia). Sin cuota ABORTA. '
    + 'Lo que no necesita modelo (superficies de adjuntar, aterrizaje precargado, archivo protegido) va en el barrido: gate-disa-adjuntar.',
  'verify-avisos-crm-riesgo': 'EN ROJO desde antes (datos de riesgo ya en la BD viva). Otro tema.',
  'gate-avisos-pantalla': 'EN ROJO desde antes (1 aserción). Otro tema.',
  'verify-pieza-c-http': 'gate FRÁGIL preexistente (redondeo de céntimos). Otro tema.',
};

// Requieren un ENTORNO que esta máquina no tiene. No están rotos ni caducados: aquí, sencillamente,
// no se pueden correr. Abortan con código 2 ("no he verificado NADA") en vez de fingir un veredicto.
// Se listan para que su falta de cobertura se VEA, que es lo único que un runner honesto puede hacer.
const ENTORNO = {
  'gate-registro-tailscale':
    'el alta POR LA DIRECCIÓN DE TAILSCALE necesita esa red montada, y aquí el host no resuelve. '
    + 'Apuntarlo a localhost lo dejaría sin probar lo que existe para probar. Correrlo donde haya Tailscale (`tailscale up`).',
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
const EMPIEZAN_DE_CERO = new Set([
  'gate-cliente-ficha-completa',   // negocio nuevo: la ficha entera, desde el alta
  'gate-cliente-360',              // negocio nuevo: la ficha cuadra con su pantalla de origen
  'gate-menu-navegacion',          // negocio nuevo: 50 puertas del menú, una a una
  'gate-agenda-visual',            // negocio nuevo: el lienzo de la agenda
  'gate-inicio-arranque',          // negocio RECIÉN CREADO: es justo lo que prueba
  'gate-inicio-cuadro-mando',      // negocio nuevo + uno vacío + un empleado sin permisos
  'gate-vigia-agenda',             // negocio nuevo: los cuatro detectores de agenda
]);

// Los que necesitan el negocio de desarrollo en silencio. Cada uno con su MOTIVO: un gate marcado
// «solo» sin explicar por qué es una excusa para tapar una carrera de verdad.
const SOLOS = new Map([
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
]);

const claseDe = g => EMPIEZAN_DE_CERO.has(g) ? 'propio' : (SOLOS.has(g) ? 'solo' : 'compartido');

// ── QUÉ TOCA QUÉ — el modo corto (antes de cada commit) ─────────────────────────────────────────
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
const AFECTA = [
  { re: /^(docs\/|.*\.md$|Logos\/|deploy\/|PROYECTO\.txt$)/, grupos: [] },        // documentación: no hay gate que correr
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

const args = process.argv.slice(2);
const bandera = (n, def) => {
  const a = args.find(x => x.startsWith('--' + n + '='));
  return a ? Math.max(1, parseInt(a.split('=')[1], 10) || def) : def;
};
// CUÁNTOS A LA VEZ. La máquina tiene 4 núcleos y cada gate de navegador se lleva uno largo mientras
// carga una pantalla. `--jobs` es el tope GLOBAL y `--jobs-compartido` el tope de los que escriben en
// el negocio de desarrollo (más bajo a propósito: ahí la carrera no es de CPU, es de datos).
const JOBS = bandera('jobs', Math.max(2, Math.min(4, cpus().length)));
const JOBS_COMP = bandera('jobs-compartido', 2);
// ── EL TECHO DE VERDAD: EL FRENO DE PETICIONES DEL PRODUCTO ─────────────────────────────────────
// `index.js` frena a 600 peticiones/min POR IP (`rateLimit({ windowMs: 60000, max: 600 })`), y todos
// los gates salen de 127.0.0.1, así que comparten cupo. NO se toca ese freno: es un control de
// seguridad y está donde debe estar.
//
// MEDIDO, no supuesto. Con 4 gates a la vez el primer barrido en paralelo frenó SIETE peticiones en
// UN solo minuto (`security_events`, type `ratelimit:global`) — apenas por encima del tope. Bastó
// para tumbar seis gates: un 429 en una carga de página deja la pantalla sin su script y el gate
// falla por un motivo que no es el suyo. Una pantalla del admin cuesta ~8,6 peticiones y un gate de
// navegador va a ~2,5 peticiones/s de media, así que tres a la vez ≈ 450/min: un 25 % de margen.
// Los gates SIN navegador (la mitad del barrido: BD en memoria, cero HTTP) no cuentan para esto.
//
// Y POR QUÉ SON DOS Y NO TRES. Con tres, una pasada de cada cuatro moría con un `TargetCloseError:
// Target.createTarget` — Chromium sin poder abrir una pestaña con tres navegadores compitiendo por
// cuatro núcleos. No es un fallo del producto ni del gate (suelto pasa 6/0), pero un rojo que sale
// una vez de cada cuatro es peor que uno fijo: enseña a desconfiar del barrido. Dos aguanta. El
// encargo decía «ajusta el número hasta que el servidor aguante sin falsos rojos», y el número es 2.
const JOBS_NAV = bandera('jobs-navegador', 2);
const EN_SERIE = args.includes('--serie');   // para comparar contra el barrido de antes

if (!args.length) {
  console.log('Uso: node scripts/run-gates.mjs <grupo|gate>...  |  --all  |  --tocado');
  console.log('Grupos: ' + Object.keys(GRUPOS).join(', '));
  console.log('Modos:  --tocado   corre solo los gates de lo que has cambiado (ANTES de cada commit)');
  console.log('        --all      el barrido completo (AL CERRAR la tarea)');
  console.log('Topes:  --jobs=N --jobs-navegador=N --jobs-compartido=N --serie');
  console.log('Ver:    --lista     dice qué correría y se va, sin correr nada');
  process.exit(64);
}

// ── EL MODO CORTO: qué gates cubren lo que has tocado ───────────────────────────────────────────
// Sale de tres sitios que se SUMAN, nunca se restan: la tabla AFECTA, el grafo de imports (todo gate
// que importe un fichero cambiado) y los gates que hayas cambiado tú. Y si algo no lo cubre nadie,
// NO se adivina: se corre el barrido entero y se dice qué fichero lo obligó.
function ficherosCambiados() {
  const salida = new Set();
  for (const cmd of ['git diff --name-only HEAD', 'git diff --name-only --cached', 'git ls-files --others --exclude-standard']) {
    try { for (const l of execSync(cmd, { cwd: APP_DIR, encoding: 'utf8' }).split('\n')) if (l.trim()) salida.add(l.trim()); }
    catch { /* sin git: se queda vacío y el modo corto lo dirá */ }
  }
  return [...salida];
}

// Grafo de imports: qué ficheros del producto alcanza cada gate (transitivo). No se mantiene a mano.
const _cacheImports = new Map();
function importsDe(f) {
  if (_cacheImports.has(f)) return _cacheImports.get(f);
  let s = ''; try { s = readFileSync(f, 'utf8'); } catch {}
  const out = [];
  for (const m of s.matchAll(/from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]/g)) {
    let p = resolve(dirname(f), m[1] || m[2]);
    if (!existsSync(p)) for (const e of ['.js', '.mjs', '/index.js']) if (existsSync(p + e)) { p += e; break; }
    if (existsSync(p)) out.push(p);
  }
  _cacheImports.set(f, out); return out;
}
function alcanceDe(f, vistos = new Set()) {
  for (const d of importsDe(f)) if (!vistos.has(d)) { vistos.add(d); alcanceDe(d, vistos); }
  return vistos;
}

function resolverTocado(todos) {
  const cambiados = ficherosCambiados();
  if (!cambiados.length) {
    console.log('· No hay nada cambiado respecto a HEAD: no hay gates que correr.');
    return { lista: [], informe: ['sin cambios'] };
  }
  const grupos = new Set(), informe = [], sinRegla = [];
  let todo = false;
  for (const f of cambiados) {
    const regla = AFECTA.find(r => r.re.test(f));
    if (!regla || regla.grupos === null) { todo = true; sinRegla.push(f); continue; }
    for (const g of regla.grupos) grupos.add(g);
    informe.push(f + ' → ' + (regla.grupos.length ? regla.grupos.join(', ') : '(ningún gate)'));
  }
  if (todo) {
    console.log('· El modo corto NO adivina: estos ficheros no los cubre ninguna regla o tocan el tronco,');
    console.log('  así que se corre el BARRIDO COMPLETO — ' + sinRegla.join(', '));
    return { lista: todos, informe };
  }
  const lista = new Set();
  for (const g of grupos) for (const x of (GRUPOS[g] || [])) lista.add(x);
  // Los gates que has cambiado tú, corren.
  for (const f of cambiados) {
    const m = f.match(/^scripts\/([a-z0-9-]+)\.(mjs|js)$/);
    if (m && todos.includes(m[1])) { lista.add(m[1]); informe.push(f + ' → él mismo'); }
  }
  // Y el grafo de imports, que no se pudre: todo gate que importe un fichero cambiado.
  const cambSet = new Set(cambiados.map(f => join(APP_DIR, f)));
  for (const g of todos) {
    if (lista.has(g)) continue;
    const fg = ficheroDe(g); if (!fg) continue;
    for (const d of alcanceDe(fg)) if (cambSet.has(d)) { lista.add(g); informe.push('(import) ' + relative(APP_DIR, d) + ' → ' + g); break; }
  }
  return { lista: todos.filter(g => lista.has(g)), informe };
}

// Resolver qué se corre.
const TODOS = [...new Set(Object.values(GRUPOS).flat())];
let objetivo = [], informeTocado = null;
if (args.includes('--all')) {
  objetivo = TODOS;
} else if (args.includes('--tocado')) {
  const r = resolverTocado(TODOS);
  objetivo = r.lista; informeTocado = r.informe;
} else {
  for (const a of args) if (!a.startsWith('--')) objetivo.push(...(GRUPOS[a] || [a]));
  objetivo = [...new Set(objetivo)];
}

// Resuelve el fichero del gate: unos son .mjs y otros .js. Un bucle de shell que asumía .mjs saltaba
// test-transfers EN SILENCIO — el mismo pecado que este runner existe para impedir.
function ficheroDe(gate) {
  for (const ext of ['.mjs', '.js']) {
    const p = join(APP_DIR, 'scripts', gate + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

// Un gate que se pide y NO existe es un FALLO, no un "no pasa nada". Si se llama distinto de lo que
// cree quien lo invoca, lo que hay que hacer es gritar, no seguir como si tal cosa.
const inexistentes = objetivo.filter(g => !ficheroDe(g));
if (inexistentes.length) {
  console.error('✗ Estos gates NO EXISTEN (¿nombre mal escrito, o extensión distinta?): ' + inexistentes.join(', '));
  process.exit(64);
}

// Un "resumen" que demuestre que el gate corrió aserciones. Los gates de este repo no siguen UN solo
// formato: hay "22 OK", "PASS: 30   FAIL: 0", "48 OK, 0 fallos", "=== RESULTADO: 44 OK / 0 FALLOS ===".
// Si aquí falta un formato, el gate sale SOSPECHOSO — molesto, pero es el error seguro: prefiere
// desconfiar de un gate bueno antes que dar por bueno uno que no probó nada.
const RESUMEN = /\d+\s+OK\b|\bOK[,:]\s*\d+|\bPASS:\s*\d+/i;

function correr(gate) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn('node', [ficheroDe(gate)], { cwd: APP_DIR });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    const kill = setTimeout(() => { p.kill('SIGKILL'); }, TIMEOUT_MS);
    p.on('close', code => {
      clearTimeout(kill);
      const segs = ((Date.now() - t0) / 1000).toFixed(0);
      const m = out.match(RESUMEN);
      const resumen = m ? (m[0].trim()) : null;
      let estado;
      if (code === 2) estado = 'ABORTADO';                        // no pudo ni arrancar
      else if (code !== 0) estado = 'FALLA';
      else if (!resumen) estado = 'SOSPECHOSO';                   // salió 0 pero no demostró nada
      else estado = 'PASA';
      resolve({ gate, estado, code, resumen, segs, out });
    });
  });
}

// ── LA DECLARACIÓN, VERIFICADA CONTRA EL CÓDIGO ─────────────────────────────────────────────────
// Una lista a mano que nadie comprueba se pudre. Aquí se compara con el fichero del gate: si uno se
// trae su propio negocio y no está declarado (o al revés), se DICE. No se corrige solo a propósito:
// corregirlo en silencio escondería que la declaración y el código dejaron de decir lo mismo.
const desajustes = [];
const CON_NAVEGADOR = new Set();   // los que piden pantallas: son los que gastan cupo del freno
for (const g of objetivo) {
  const f = ficheroDe(g); if (!f) continue;
  let src = ''; try { src = readFileSync(f, 'utf8'); } catch {}
  const seTraeSuNegocio = src.includes('provisionTenant');
  if (src.includes('puppeteer.launch')) CON_NAVEGADOR.add(g);
  if (seTraeSuNegocio && !EMPIEZAN_DE_CERO.has(g)) desajustes.push(g + ': se trae su propio negocio y NO está declarado en EMPIEZAN_DE_CERO');
  if (!seTraeSuNegocio && EMPIEZAN_DE_CERO.has(g)) desajustes.push(g + ': está declarado en EMPIEZAN_DE_CERO pero NO llama a provisionTenant');
}

// ── EL PLANIFICADOR ─────────────────────────────────────────────────────────────────────────────
// Tres reglas, y ninguna es una optimización: son la condición para que el resultado siga siendo el
// mismo que en serie.
//   · tope GLOBAL de procesos (`--jobs`), para que la máquina no se ahogue y empiece a dar timeouts;
//   · tope de los que ESCRIBEN en el negocio compartido (`--jobs-compartido`);
//   · un gate SOLOS espera a que no quede ninguno del negocio compartido, y mientras él corre no
//     arranca ninguno más de esa clase. Los de negocio propio siguen corriendo: no se miran.
// Los que EMPIEZAN DE CERO van PRIMEROS en la cola porque son los más largos (el más lento del
// barrido dura 2 minutos): si arrancara el último, todo el barrido esperaría por él.
const TIEMPOS = join(APP_DIR, 'data', 'tiempos-gates.json');   // data/ está en .gitignore
let historico = {};
try { historico = JSON.parse(readFileSync(TIEMPOS, 'utf8')); } catch {}
const pendientes = [...objetivo].sort((a, b) => {
  const pa = claseDe(a) === 'propio' ? 0 : 1, pb = claseDe(b) === 'propio' ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return (historico[b] || 0) - (historico[a] || 0);   // lo más lento primero, si ya se ha medido
});

async function correrTodos(lista) {
  if (EN_SERIE) {
    const out = [];
    for (const g of lista) { const r = await correr(g); traza(r); out.push(r); }
    return out;
  }
  const res = [], cola = [...lista];
  let enCurso = 0, compartidos = 0, navegadores = 0, exclusivo = false;
  return new Promise(resolveTodo => {
    const arrancar = () => {
      if (!cola.length && enCurso === 0) return resolveTodo(res);
      let bloqueaCompartidos = exclusivo;
      for (let i = 0; i < cola.length; i++) {
        if (enCurso >= JOBS) break;
        const g = cola[i], clase = claseDe(g), nav = CON_NAVEGADOR.has(g);
        // El cupo de peticiones no distingue de qué negocio es el gate: lo gastan TODOS los que
        // piden pantallas. Por eso este tope va antes que el de clase y se aplica a los tres tipos.
        if (nav && navegadores >= JOBS_NAV) continue;
        if (clase !== 'propio') {
          if (bloqueaCompartidos) continue;
          if (clase === 'solo') {
            // Un «solo» que aún no puede entrar BLOQUEA a los de su clase que vengan detrás: si no,
            // se quedaría esperando para siempre mientras los demás se van colando.
            if (compartidos > 0) { bloqueaCompartidos = true; continue; }
          } else if (compartidos >= JOBS_COMP) { bloqueaCompartidos = true; continue; }
        }
        cola.splice(i, 1); i--;
        enCurso++;
        if (nav) navegadores++;
        // OJO CON ESTA LÍNEA. `bloqueaCompartidos` se calcula UNA vez al entrar en la pasada, así que
        // sin actualizarla aquí el bucle seguía admitiendo compartidos DETRÁS del «solo» que acababa
        // de arrancar. Pasó de verdad (20 ago 2026): gate-avisos-badge y gate-nav-inicio-disa
        // arrancaron juntos y los dos contaron mal (273 en vez de 274, 40 en vez de 39). El fallo era
        // MÍO, del planificador — los gates tenían razón.
        if (clase === 'solo') { exclusivo = true; bloqueaCompartidos = true; }
        else if (clase === 'compartido') compartidos++;
        correr(g).then(r => {
          enCurso--;
          if (nav) navegadores--;
          if (clase === 'solo') exclusivo = false; else if (clase === 'compartido') compartidos--;
          traza(r); res.push(r);
          arrancar();
        });
      }
    };
    arrancar();
  });
}

// La línea de progreso se imprime CUANDO TERMINA cada gate, así que en paralelo llegan desordenadas.
// El informe final se ordena por la lista pedida, para que comparar dos barridos sea un `diff`.
let hechos = 0;
function traza(r) {
  const icono = { PASA: '✅', FALLA: '❌', ABORTADO: '🛑', SOSPECHOSO: '⚠️' }[r.estado];
  const detalle = r.estado === 'PASA' ? r.resumen
    : r.estado === 'ABORTADO' ? 'no pudo arrancar: NO ha verificado nada'
    : r.estado === 'SOSPECHOSO' ? 'salió 0 pero no imprimió resumen — no demuestra nada'
    : 'exit ' + r.code + (r.resumen ? ' · ' + r.resumen : '');
  hechos++;
  console.log(`[${String(hechos).padStart(2)}/${objetivo.length}] ${icono} ${r.gate.padEnd(36)} ${detalle}  (${r.segs}s)`);
}

const t0Barrido = Date.now();
if (informeTocado) {
  console.log('── MODO CORTO (antes del commit) ' + '─'.repeat(46));
  for (const l of informeTocado) console.log('   ' + l);
  console.log('   → ' + objetivo.length + ' gates de ' + TODOS.length);
  console.log('   El veredicto de la tarea NO es este: el barrido completo va al cerrar (RITUAL.md).');
  console.log('─'.repeat(78));
}
console.log('· ' + objetivo.length + ' gates · ' + (EN_SERIE ? 'EN SERIE'
  : 'hasta ' + JOBS + ' a la vez · ' + JOBS_NAV + ' con navegador (freno de 600 pet./min) · '
    + JOBS_COMP + ' sobre el negocio de desarrollo'));
if (desajustes.length) {
  console.log('\n⚠️  LA DECLARACIÓN Y EL CÓDIGO NO DICEN LO MISMO (arréglalo, no lo ignores):');
  for (const d of desajustes) console.log('   · ' + d);
  console.log('');
}

// `--lista` enseña QUÉ correría y se va. Antes de un commit vale para mirar la selección sin
// esperar al barrido — y para discutir la tabla AFECTA con algo delante.
if (args.includes('--lista')) {
  console.log('\nLo que se correría (' + objetivo.length + '):');
  for (const g of pendientes) {
    console.log('  · ' + g.padEnd(36) + claseDe(g).padEnd(11) + (CON_NAVEGADOR.has(g) ? 'navegador' : '—'));
  }
  process.exit(0);
}

const sinOrden = await correrTodos(pendientes);
// Orden canónico: el de la lista pedida. Dos barridos del mismo objetivo se comparan con un diff.
const porNombre = new Map(sinOrden.map(r => [r.gate, r]));
const resultados = objetivo.map(g => porNombre.get(g)).filter(Boolean);
const segsBarrido = ((Date.now() - t0Barrido) / 1000).toFixed(0);

// Se guardan los tiempos para que la próxima pasada arranque primero por lo más lento. Es una pista
// de orden, nunca un veredicto: si el fichero no está, el barrido corre igual.
try {
  const nuevos = { ...historico };
  for (const r of resultados) nuevos[r.gate] = Number(r.segs);
  writeFileSync(TIEMPOS, JSON.stringify(nuevos, null, 1));
} catch { /* data/ puede no existir en otra máquina: no es un fallo del barrido */ }

console.log('\n──── RESULTADO POR NOMBRE (orden fijo, para comparar dos barridos) ────');
for (const r of resultados) {
  const icono = { PASA: '✅', FALLA: '❌', ABORTADO: '🛑', SOSPECHOSO: '⚠️' }[r.estado];
  console.log(`${icono} ${r.gate.padEnd(36)} ${r.estado}`);
}

// Detalle de lo que no pasó: sin esto habría que re-ejecutar a mano para saber qué pasó.
const malos = resultados.filter(r => r.estado !== 'PASA');
for (const r of malos) {
  console.log('\n──── ' + r.gate + ' (' + r.estado + ', exit ' + r.code + ') ────');
  const lineas = r.out.split('\n').filter(l => /✗|Error|error:/i.test(l)).slice(0, 6);
  console.log((lineas.length ? lineas : r.out.split('\n').slice(-6)).join('\n'));
}

console.log('\nNO ejecutados, por su naturaleza (no son deuda):');
for (const [g, motivo] of Object.entries(EXCLUIDOS)) console.log('  · ' + g.padEnd(32) + motivo);

// Lo que NO se puede probar en esta máquina. Se ve siempre: una pantalla sin cobertura tiene que
// doler a la vista, aunque el motivo sea bueno.
console.log('\n🌍 REQUIEREN UN ENTORNO que esta máquina no tiene (abortan con código 2, no fingen):');
for (const [g, motivo] of Object.entries(ENTORNO)) console.log('  · ' + g + '\n      ' + motivo);

// La deuda va la ÚLTIMA y con banderita: es lo que el runner NO puede prometer. Un barrido "verde"
// que calle esto valdría lo mismo que el falso verde que lo hizo nacer.
for (const [g, motivo] of Object.entries(ROJOS_CONOCIDOS)) {
  console.log('\n⚠️  ROJO CONOCIDO, con dueño y motivo (el gate SÍ se ejecuta):');
  console.log('  · ' + g + '\n      ' + motivo);
}
const deuda = Object.keys(DEUDA).length;
if (deuda) {
  console.log('\n🚧 DEUDA — ' + deuda + ' gates de navegador ROTOS o CADUCADOS, NO se están ejecutando:');
  for (const [g, motivo] of Object.entries(DEUDA)) console.log('  · ' + g + '\n      ' + motivo);
  console.log('  → Mientras sigan aquí, ESTAS PANTALLAS NO ESTÁN CUBIERTAS EN NAVEGADOR. Arreglarlos es tarea aparte.');
} else {
  console.log('\n🚧 DEUDA — ninguna. Los 7 gates de navegador que estaban muertos volvieron el 14-jul-2026:');
  console.log('     4 estaban CADUCADOS (el producto cambió y ellos no) → arreglados y dentro del barrido.');
  console.log('     2 dependían del MODELO REAL (cuota de IA agotada, no un fallo) → partidos: la pantalla');
  console.log('       entra al barrido (gate-c2-revision, gate-disa-adjuntar) y la extracción real se corre a mano.');
  console.log('     1 necesita Tailscale, que aquí no existe → declarado ENTORNO (arriba), aborta en vez de fingir.');
}

// Los gates de compras crean documentos en la BD viva. Los seis de navegador arreglados el
// 14-jul-2026 se limpian solos (borran POR ID lo que crearon y dejan el stock cuadrado), pero el
// RESTO todavía deja documentos —y asientos contables huérfanos— detrás. Mientras sea así, hay que
// barrer. Que se diga en cada pasada, y no se descubra dentro de tres semanas.
console.log('\n🧹 Este barrido deja documentos de prueba en el tenant (los gates que aún NO se limpian solos):');
console.log('     node scripts/limpiar-residuo-gates.mjs           (en seco: dice qué borraría)');
console.log('     node scripts/limpiar-residuo-gates.mjs --hazlo   (borra y recalcula el stock)');

const pasa = resultados.filter(r => r.estado === 'PASA').length;
console.log('\n' + '═'.repeat(70));
console.log(`${pasa}/${resultados.length} pasan  ·  ${segsBarrido} s (${(segsBarrido / 60).toFixed(1)} min)`
  + (malos.length ? `  ·  ${malos.length} NO: ` + malos.map(r => r.gate).join(', ') : ''));
console.log(deuda
  ? `(y ${deuda} gates en DEUDA, sin ejecutar — arriba)`
  : `(0 en deuda · ${Object.keys(EXCLUIDOS).length} excluidos por naturaleza · ${Object.keys(ENTORNO).length} sin entorno aquí — todo listado arriba)`);
process.exit(malos.length ? 1 : 0);
