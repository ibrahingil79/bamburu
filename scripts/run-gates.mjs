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
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { cpus } from 'os';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
// El mapa de los gates (grupos, clases y qué toca qué) vive en su propio módulo: lo leen este
// runner y `barrido-estado.mjs`. Una sola lista, no dos.
import { GRUPOS, EMPIEZAN_DE_CERO, SOLOS, claseDe, AFECTA, FUERA_A_PROPOSITO, TENANT_EXTRA, censoDeGates, RAPIDO, velocidadDe } from './lib/gates-mapa.mjs';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 300000;


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
// ── LAS QUE NO PASAN, DECLARADAS (24 ago 2026) ──────────────────────────────────────────────────
// De las 99 que nadie ejecutaba, 21 no pasan hoy. **No se retiran ni se ablandan**: se declaran aquí
// con lo que se midió de cada una y su fecha, para que salgan POR SU NOMBRE en cada pasada. Un rojo
// con dueño y motivo es información; un rojo anónimo es ruido, y un fichero que nadie ejecuta no es
// ni una cosa ni la otra.
//
// LO QUE SE COMPROBÓ ANTES DE DECLARARLAS: ninguna de estas 21 es un fallo de producto sin arreglar.
// Las dos que SÍ lo eran —la base de datos legible por cualquiera y los libros descuadrados— se
// arreglaron el mismo día, y sus comprobaciones están en el barrido, en verde.
const DEUDA = {
  // PRECONDICIÓN AJENA: exigen datos que no crean ellas y que hoy no están. Es la avería que ya
  // documenta la cabecera de este fichero: «un gate que se apoya en datos vivos ajenos se pudre
  // porque no era suyo lo que pisaba». El arreglo bueno es que se traigan lo suyo.
  'verify-permisos-coherencia':
    'exige un 403 literal y el empleado de prueba (usuario 3) está INACTIVO, así que el rechazo llega '
    + 'como 302/401 — más duro, no más flojo. COMPROBADO A MANO el 24 ago 2026: NO hay agujero de permisos.',
  'verify-permisos-disa':      'misma familia y misma causa que la anterior (empleado de prueba inactivo).',
  'verify-invoice-over-stock-http': 'mismos 403 sobre el mismo empleado inactivo.',
  'verify-mostrador-overstock':     'ídem: el permiso se prueba contra un empleado que ya no está activo.',
  'verify-albaranes-browser':  'necesita un pedido confirmado de prueba que no crea ella y hoy no existe.',
  'verify-pedidos-browser':    'misma familia: datos sembrados que ya no están.',
  'verify-pedidos-disa':       'espera un cliente y un número de pedido concretos del negocio de desarrollo.',
  'verify-quotes-browser':     'espera un presupuesto ya convertido a factura; hoy no hay ninguno así.',
  'verify-sustitutiva-browser':'espera un ticket sustituido concreto; el suyo ya no está.',
  'verify-mostrador-browser':  'el ticket de prueba que espera ya no existe en el negocio.',
  'verify-inventory-fix-browser': 'cuenta 80 productos físicos y hoy hay 119: cifra congelada de junio.',
  'gate-espera-pantalla':      'exige que el bloque del vigía traiga avisos, y no los crea ella.',
  'gate-inicio-pantalla':      'exige la rejilla de fábrica con más de un bloque; hoy trae uno.',
  'gate-avisos-correos':       'depende de la hora del día (la pasada de las 15:00) — un gate con reloj es una moneda al aire.',
  'test-cobros-paso2-1':       'espera un desglose de importes en el correo que ya no se compone así.',
  'verify-u3-errores':         'smoke de errores del navegador anterior a los paneles de la casa.',
  // SALEN 0 PERO NO DEMUESTRAN NADA: no imprimen resumen, así que el corredor no puede leerlas.
  'test-c2-captura':           'sale 0 sin imprimir resumen: no demuestra nada. Necesita su línea de RESULTADO.',
  'verify-disa-alcance':       'ídem: termina bien y no dice qué ha verificado.',
  // NO ARRANCAN: abortan antes de comprobar nada.
  'verify-dibujo':             'aborta al arrancar (código 2): no llega a verificar nada.',
  'verify-vigia':              'aborta al arrancar (código 2).',
  'verify-voz':                'aborta al arrancar (código 2).',
};

// ROJOS CONOCIDOS de gates que SÍ se ejecutan. No son deuda (el gate corre y verifica), pero su rojo
// es anterior y de otro tema: se declara aquí para que salga por su nombre en cada barrido en vez de
// perderse entre los demás. Un rojo con dueño y motivo es información; un rojo anónimo es ruido.
const ROJOS_CONOCIDOS = {
  // 20 ago 2026 · NO ES DEL PARALELISMO, y se comprobó: falla igual EN SERIE y falla igual suelto.
  // El gate exige que el negocio de desarrollo tenga propuestas pendientes (`esperado > 0`) para
  // poder afirmar que el badge del riel enseña ese número — pero NO las crea él. Ese día se
  // resolvieron a mano las 39 que quedaban (10:13-10:14, como el usuario dueño) y el generador
  // diario NO puede recrearlas: es idempotente por documento, así que una factura cuya propuesta ya
  // se descartó no vuelve a generar otra.
  // ES LA FRAGILIDAD QUE AVISA LA CABECERA DE ESTE FICHERO: «un gate que se apoya en datos vivos
  // ajenos no se pudre por culpa del producto; se pudre porque no era suyo lo que pisaba». El
  // arreglo bueno es que el gate se traiga SU propia propuesta —como ya hacen los de compras con
  // `productoDePrueba`—, y eso es tocar el gate: tarea aparte, con su verificación.
  // CADA ENTRADA LLEVA SU FECHA. No es burocracia: sin ella, el barrido no puede decir «esto se
  // declaró hace tres semanas y hoy pasa», que es justo lo que la Pieza D existe para cantar.
  // 22 ago 2026 · AQUÍ VIVÍA `gate-nav-inicio-disa`, y se ha RETIRADO porque HOY PASA. No se ha
  // tocado el gate: lo que sobraba era la nota. Su rojo era una precondición ajena —exigía que el
  // negocio tuviera propuestas de DISA pendientes y no las creaba él—, y el barrido de esta fecha lo
  // da en verde en las dos pasadas (a plena luz y con el reloj del negocio en madrugada). Segunda
  // declaración que se retira por rancia en tres días: un puntero caducado manda al siguiente chat
  // al sitio equivocado con toda la confianza del mundo, y por eso se revisan TODAS al barrer.
  // 20 ago 2026 · AQUÍ VIVÍA `gate-vigia-agenda`, y se ha RETIRADO. No se ha tocado el gate: el gate
  // está bien y pasa 41/41. Lo que sobraba era esta nota. Su aserción en rojo era que «los hallazgos
  // de agenda no asoman en el bloque del vigía del Inicio», y el rediseño del Inicio (cuadro de mando,
  // commit 144a01d) los sacó a la vista en «DISA decide»: el rojo se arregló de rebote y la
  // declaración se quedó anunciando un rojo que ya no existía. Un puntero rancio manda al siguiente
  // chat al sitio equivocado con toda la confianza del mundo. La Pieza D de esta tarea existe para
  // que la próxima vez lo cante el propio barrido en vez de descubrirse dos semanas después.
};

// Excluidos por naturaleza, no por estar rotos: no son deuda, simplemente no van en un barrido.
const EXCLUIDOS = {
  // 24 ago 2026 · la última de las 99: llama al MODELO REAL para preguntar por el stock. Misma
  // familia que las de arriba — ni determinista ni gratis, y en un barrido de madrugada que corre
  // todas las noches el coste se multiplica por 365.
  'verify-llm-disa-stock': 'llama al MODELO REAL (stock por chat). A mano, cuando se toque DISA.',
  'verify-disa-pedidos-modelo-real': 'llama al MODELO REAL: ni determinista ni gratis. A mano.',
  'gate-pago-voz-avisos': 'llama al MODELO REAL (misma familia). A mano y a conciencia.',
  'gate-c2-captura':
    'llama al MODELO REAL (visión) para LEER la factura: cuesta dinero y depende de la cuota de IA del mes. '
    + 'Sin cuota ABORTA (código 2), no finge. La PANTALLA de revisión —que es lo que se rompe— sí va en el barrido: gate-c2-revision.',
  'gate-disa-captura-chat':
    'llama al MODELO REAL por el chat de DISA (misma familia). Sin cuota ABORTA. '
    + 'Lo que no necesita modelo (superficies de adjuntar, aterrizaje precargado, archivo protegido) va en el barrido: gate-disa-adjuntar.',
  // 22 ago 2026 · el número estaba rancio: son TRES aserciones en rojo, no una. Se corrige aquí
  // porque una cifra vieja en una declaración hace creer que el agujero es más pequeño de lo que es.
  'gate-avisos-pantalla': 'EN ROJO desde antes (3 aserciones, medidas el 22 ago 2026). Otro tema.',
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
  console.log('Modos:  --rapido   unos minutos: pantallas vivas, dinero y fechas, ventanitas, menú, cadena');
  console.log('        --all      TODO. Corre solo cada madrugada y manda el parte por correo');
  console.log('        --tocado   corre solo los gates de lo que has cambiado (ANTES de cada commit)');
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
if (args.includes('--rapido')) {
  // EL BARRIDO RÁPIDO: unos minutos, lo que se rompe a menudo y tumba el producto. Se lanza A MANO.
  // Incluye `gate-cadena-integridad`, que está fuera del completo porque cualquier gate que emita una
  // factura mientras corre le mueve el suelo — y aquí corre solo, que es lo que necesita.
  objetivo = [...RAPIDO.keys()];
} else if (args.includes('--all')) {
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
// formato: hay "22 OK", "PASS: 30   FAIL: 0", "48 OK, 0 fallos", "=== RESULTADO: 44 OK / 0 FALLOS ==="
// y "21 comprobaciones, 0 fallos". Si aquí falta un formato, el gate sale SOSPECHOSO — molesto, pero
// es el error seguro: prefiere desconfiar de un gate bueno antes que dar por bueno uno que no probó
// nada. (El formato "N comprobaciones" se añadió el 20 ago 2026 al meter las tres de la puerta
// pública: `test-reserva-publica` y `test-neto-cero-reserva` salían SOSPECHOSOS pasando 133/133 y
// 21/21. El listón no baja: sigue exigiendo que el gate DIGA cuántas aserciones corrió.)
// (24 ago 2026: se añade "RESULTADO: N \u2713" — es el formato de los doce gates de la noche del
// 23 y el runner no sabía leerlo: los doce habrían salido SOSPECHOSOS pasando todo. Va ANCLADO a la
// palabra RESULTADO a propósito: con solo \d+\s*\u2713 se colaba cualquier número seguido de un tic
// —una línea de detalle cualquiera— y eso convertía un gate sin resumen en un falso PASA. Sigue
// exigiendo lo mismo que el resto: que el gate DIGA cuántas aserciones corrió.)
const RESUMEN = /\d+\s+OK\b|\bOK[,:]\s*\d+|\bPASS:\s*\d+|\d+\s+comprobaciones\b|RESULTADO:\s*\d+\s*\u2713/i;

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
  // Y LOS QUE GASTAN CUPO SIN NAVEGADOR. El freno de 600 pet./min no distingue quién pide: cuenta
  // peticiones. `lint-js-servido` pide MÁS DE 300 pantallas con `fetch` en un minuto —más que
  // cualquier gate de navegador— y sin esto entraría como si no gastara nada, tirando el cupo de los
  // que corren a su lado. Se reconoce por lo que hace: recorrer pantallas con fetch en un bucle.
  if (!CON_NAVEGADOR.has(g) && /for\s*\(const\s+ruta\s+of|conRastreo\(/.test(src) && src.includes('fetch(')) {
    CON_NAVEGADOR.add(g);
  }
  // TENANT_EXTRA son los que levantan un negocio de más para UN caso y por lo demás viven en el
  // compartido: nombran `provisionTenant` sin ser «de cero». Sin declararlos, esta comprobación
  // cantaba un desajuste falso en cada pasada, que es la mejor forma de que se deje de mirar.
  if (seTraeSuNegocio && !EMPIEZAN_DE_CERO.has(g) && !TENANT_EXTRA.has(g)) desajustes.push(g + ': se trae su propio negocio y NO está declarado en EMPIEZAN_DE_CERO');
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
  console.log('── MODO CORTO (a petición: solo lo tocado) ' + '─'.repeat(36));
  for (const l of informeTocado) console.log('   ' + l);
  console.log('   → ' + objetivo.length + ' gates de ' + TODOS.length);
  console.log('   Esto NO es el veredicto: el barrido completo se PROPONE al cerrar y solo se lanza');
  console.log('   con un sí de Ibrahin. La norma, entera, en RITUAL.md · «LA REGRESIÓN».');
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

// ── EL CENSO DE GATES · que ninguno vuelva a ser invisible (23 ago 2026) ────────────────────────
// Un gate que no está en el mapa no lo ejecuta nadie, y una comprobación que nadie ejecuta acaba
// mintiendo. Ha pasado dos veces: catorce gates muertos tres semanas, y los cuatro de agenda dos
// días con `gate-oficio-pantalla` EN ROJO sin que nadie lo viera. NO tumba el barrido —es
// contabilidad, no producto— pero se canta en CADA pasada, y también con `--lista`, que es donde se
// mira la cobertura antes de decidir. Se cantará hasta que cada gate esté en un grupo o declarado
// fuera con su motivo escrito.
function cantarCenso() {
  try {
    // ⚙️ 24 ago 2026 — EL CENSO NO CONOCÍA LAS DECLARACIONES DE ESTE MISMO FICHERO. Miraba solo
    // GRUPOS y FUERA_A_PROPOSITO (que viven en el mapa) e ignoraba EXCLUIDOS, ENTORNO, DEUDA y
    // ROJOS_CONOCIDOS, que viven aquí — así que cantaba como «invisibles» ocho gates que estaban
    // declarados con su motivo tres pantallas más arriba. **Un censo que grita en falso se acaba
    // ignorando, y entonces deja de avisar cuando el grito es de verdad.**
    const declaradosAqui = new Set([...Object.keys(EXCLUIDOS), ...Object.keys(ENTORNO),
                                    ...Object.keys(DEUDA), ...Object.keys(ROJOS_CONOCIDOS)]);
    const censoBruto = censoDeGates(readdirSync(join(APP_DIR, 'scripts')));
    const censo = { ...censoBruto, invisibles: censoBruto.invisibles.filter(g => !declaradosAqui.has(g)) };
    if (censo.declaradosFuera.length) {
      console.log('\n📋 FUERA DEL BARRIDO A PROPÓSITO (' + censo.declaradosFuera.length + '), con su motivo:');
      for (const g of censo.declaradosFuera) console.log('  · ' + g + '\n      ' + FUERA_A_PROPOSITO.get(g));
    }
    if (censo.invisibles.length) {
      console.log('\n🚨 GATES INVISIBLES — están en scripts/ y NO los ejecuta nadie (' +
        censo.invisibles.length + ' de ' + censo.enDisco.length + '):');
      for (const g of censo.invisibles) console.log('  · ' + g);
      console.log('  Cada uno tiene que ir a un grupo de GRUPOS, a FUERA_A_PROPOSITO, o declararse aquí\n  (EXCLUIDOS / ENTORNO / DEUDA) con su motivo y su fecha. Ninguno puede quedarse sin destino.');
    }
    if (censo.sinFichero.length) {
      console.log('\n🚨 DECLARADOS Y SIN FICHERO (' + censo.sinFichero.length + '): ' + censo.sinFichero.join(', '));
    }
  } catch (e) { console.log('\n(no se pudo pasar el censo de gates: ' + e.message + ')'); }
}

// `--lista` enseña QUÉ correría y se va. Antes de un commit vale para mirar la selección sin
// esperar al barrido — y para discutir la tabla AFECTA con algo delante.
if (args.includes('--lista')) {
  console.log('\nLo que se correría (' + objetivo.length + '):');
  for (const g of pendientes) {
    console.log('  · ' + g.padEnd(36) + claseDe(g).padEnd(11) + (CON_NAVEGADOR.has(g) ? 'navegador' : '—'));
  }
  cantarCenso();
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
for (const [g, d] of Object.entries(ROJOS_CONOCIDOS)) {
  console.log('\n⚠️  ROJO CONOCIDO, con dueño y motivo (el gate SÍ se ejecuta):');
  console.log('  · ' + g + '  (declarado el ' + d.desde + ')\n      ' + d.motivo);
}

cantarCenso();

// ── PIEZA D · DECLARACIONES CADUCADAS ───────────────────────────────────────────────────────────
// NACE DE UN CASO REAL. `gate-vigia-agenda` se declaró rojo el 19-ago; el rediseño del Inicio lo
// arregló de rebote al día siguiente y la nota se quedó ahí, anunciando en cada pasada un rojo que
// ya no existía. Se descubrió de casualidad, auditando otra cosa. Una declaración es una promesa
// («esto falla, y sé por qué»): cuando deja de ser verdad, el barrido tiene que decirlo él, no
// esperar a que alguien lo note.
//
// NO TUMBA EL BARRIDO a propósito: esto es contabilidad de las declaraciones, no un fallo del
// producto. Pero se pinta al final y en su propio bloque, donde no se pueda pasar por alto.
const caducadas = Object.entries(ROJOS_CONOCIDOS)
  .filter(([g]) => (resultados.find(r => r.gate === g) || {}).estado === 'PASA');
if (caducadas.length) {
  console.log('\n🧹 DECLARACIÓN CADUCADA — se declara roja y HOY PASA. Retírala:');
  for (const [g, d] of caducadas) {
    console.log('  · ' + g + ' — declarada roja desde el ' + d.desde + ' y hoy termina en VERDE.');
    console.log('      Retira su entrada de ROJOS_CONOCIDOS en scripts/run-gates.mjs y di en el commit por qué dejó de fallar.');
  }
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
// ── EL BARRIDO COMPLETO SE REGISTRA SOLO ────────────────────────────────────────────────────────
// Correrlo ES el registro. Si dependiera de que alguien se acuerde de anotarlo, el bloque de
// TABLERO.md se quedaría viejo en dos semanas — y un panel que miente es peor que no tener panel.
// Solo el COMPLETO: un grupo suelto o el modo corto no son un barrido y no pueden decir que lo son.
if (args.includes('--all')) {
  try {
    const { registrarHecho } = await import('./barrido-estado.mjs');
    const r = registrarHecho(pasa + '/' + resultados.length, segsBarrido);
    console.log('\n🔁 Anotado en TABLERO.md: barrido completo ' + r.fecha + ' · ' + r.commit + ' · ' + r.resultado);
  } catch (e) {
    // Que falle el registro NO cambia el veredicto del barrido: se dice y se sigue.
    console.log('\n⚠️  No he podido anotar el barrido en TABLERO.md: ' + (e && e.message || e));
  }
}

process.exit(malos.length ? 1 : 0);
