// frontera.test.js — Las tres averías del 1 sep 2026, cada una atacada por donde se coló.
//
// POR QUÉ ESTE FICHERO EXISTE, y es lo importante del encargo. Las tres averías de ese día
// PASARON LAS PRUEBAS y fallaron en el primer uso real. No fue mala suerte tres veces: fue el
// mismo error tres veces, y tiene nombre —
//
//   CADA PRUEBA SUSTITUYÓ POR UN DOBLE INSTANTÁNEO LA FRONTERA QUE ESTABA ROTA,
//   Y EL DOBLE ESTABA DE ACUERDO CON LA SUPOSICIÓN DEL CÓDIGO.
//
//   · barrido — el código suponía que `run-gates.mjs` corre sin argumentos. Las ocho pruebas
//     escribían un `run-gates.mjs` FALSO que ignoraba `argv`. El de verdad exige uno y sale 64.
//   · cuota   — el código suponía que mirar cada 15 min llega a tiempo. La prueba cambiaba el
//     número del vigilante falso y llamaba a `unPaso()` EN EL ACTO: el tiempo nunca pasaba, así
//     que «llegar tarde» era indemostrable.
//   · parada  — el código suponía que un paso termina pronto. La prueba usaba
//     `binario: 'no-existe-este-binario'`, y un paso que revienta en 0 ms nunca está en vuelo
//     cuando llega el SIGTERM. Encima afirmaba `esperandoCuota === true`: probaba el camino que
//     YA se había arreglado esa mañana, no el que rompió.
//
// De ahí las tres reglas de este fichero, y valen para lo que se escriba después:
//   1. LA FRONTERA SE TOCA. Si lo que puede romperse es el contrato con un programa de fuera,
//      la prueba invoca ESE programa, no un remedo escrito por quien programó el contrato.
//   2. EL RELOJ SE MUEVE. Una avería de «llega tarde» solo se demuestra moviendo las agujas.
//      Por eso `decidir()` y `Ciclo` reciben el reloj por la puerta.
//   3. EL DOBLE SE PARECE A LO QUE SUPLE EN LO QUE IMPORTA. Un `claude` falso que muere al
//      instante no sirve para probar una parada: lo que hay que probar es la parada CON ALGO
//      EN VUELO, así que el falso tarda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { correrBarrido, invocacion } from '../barrido.js';
import { interpretarUsage, momentoDeReinicio } from '../cuota/usage.js';
import { decidir, ACCIONES, esperaHastaLaCuota } from '../nucleo/maquina.js';
import { cargarConfig } from '../nucleo/config.js';
import { Almacen } from '../nucleo/almacen.js';
import { arrancar } from '../bucle.js';
import { repoTemporal, limpiar, configDe } from './ayuda.js';

const RAIZ_REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ════════════════════════════════════════════════════════════════════════════════════════════
//  AVERÍA 1 · EL BARRIDO — la frontera con `run-gates.mjs` se toca, no se remeda
// ════════════════════════════════════════════════════════════════════════════════════════════

test('AVERÍA 1 · el barrido REAL acepta los argumentos que el orquestador le pasa', { timeout: 120000 }, async () => {
  // ESTA ES LA PRUEBA QUE FALTABA, y es la única que habría cazado la avería del 1 sep 2026.
  // No usa remedos: coge la invocación de la configuración de verdad y se la da al
  // `run-gates.mjs` de verdad. Se le añade `--lista` para que enumere y se vaya sin correr nada
  // —tarda segundos y no toca el producto—, pero los argumentos que se validan son LOS SUYOS.
  //
  // ⚙️ Y SE CUENTA CUÁNTAS SELECCIONA, no solo que no reviente. Escribiendo esta prueba caí en
  // el MISMO vicio que vengo a arreglar: `--lista` es por sí solo un argumento válido, así que
  // con `barrido.argumentos: []` —la avería exacta del 1 sep— la prueba pasaba en verde,
  // validando `--lista` a secas en vez de la invocación del daemon. `--lista` solo lista
  // 0 GATES. Un barrido de cero comprobaciones es tan inútil como uno que no arranca, y las dos
  // cosas dan verde si únicamente se mira el código de salida. Se comprobó reponiendo la
  // avería: con `argumentos: []` esta prueba tiene que ponerse ROJA.
  const cfg = cargarConfig({ entorno: {} });
  const inv = invocacion(cfg);
  const guion = path.join(RAIZ_REAL, inv.guion);
  assert.ok(fs.existsSync(guion), `la configuración apunta a ${inv.guion} y ahí no hay nada`);

  const { code, salida } = await correr(process.execPath, [guion, ...inv.argumentos, '--lista'], RAIZ_REAL);

  assert.notEqual(code, 64,
    `«${inv.guion} ${inv.argumentos.join(' ')}» sale 64 (EX_USAGE): el orquestador lo está invocando MAL.\n`
    + `Esto es EXACTAMENTE la avería del 1 sep 2026. Se arregla en orquestador.config.json → `
    + `barrido.argumentos.\nLo que contestó:\n${salida.slice(0, 800)}`);
  assert.doesNotMatch(salida, /^Uso: node scripts\/run-gates/m,
    'contestó con su pantalla de ayuda, que es lo que hace cuando no entiende lo que le pides');

  const cuantas = Number(/·\s*(\d+)\s+gates/.exec(salida)?.[1]);
  assert.ok(Number.isFinite(cuantas), `no dijo cuántos gates correría:\n${salida.slice(0, 800)}`);
  assert.ok(cuantas > 0,
    `«${inv.guion} ${inv.argumentos.join(' ')}» selecciona ${cuantas} comprobaciones. Un barrido `
    + 'de cero no es un barrido: revisa orquestador.config.json → barrido.argumentos.');
});

test('AVERÍA 1 · sin argumentos, el 64 se dice por su nombre: «lo he invocado mal YO»', async () => {
  // El 1 sep esto se reportó como «no se pudo leer ningún resultado (código 64)», que manda a
  // mirar al barrido cuando el que se equivocó fue quien lo llama. 64 es EX_USAGE y tiene dueño.
  const cfg = { ...cargarConfig({ entorno: {} }), barrido: { argumentos: [] } };
  cfg.repo = { ...cfg.repo, raiz: RAIZ_REAL };
  const r = await correrBarrido({ cfg, log: null });
  assert.equal(r.estado, 'reventado');
  assert.match(r.motivo, /LO HE INVOCADO MAL/);
  assert.match(r.motivo, /barrido\.argumentos/, 'y dice DÓNDE se arregla, que es media respuesta');
});

test('AVERÍA 1 · los argumentos llegan al guion: el doble ya no puede tragárselos', async () => {
  // La prueba que los ocho remedos no podían hacer: comprobar que el guion RECIBE lo que se le
  // manda. El falso de antes ignoraba `argv`, así que daba igual pasarle algo o no pasarle nada.
  const raiz = mkdtempSync(path.join(tmpdir(), 'barrido-argv-'));
  try {
    mkdirSync(path.join(raiz, 'scripts'), { recursive: true });
    writeFileSync(path.join(raiz, 'scripts', 'run-gates.mjs'), `
      if (!process.argv.slice(2).length) { process.stdout.write('Uso: …'); process.exit(64); }
      process.stdout.write('──── RESULTADO POR NOMBRE ────\\n');
      for (const a of process.argv.slice(2)) process.stdout.write('✅ ' + a.replace(/^--/, 'arg-') + '   PASA\\n');
    `);
    const cfg = { repo: { raiz }, cuota: {}, barrido: { argumentos: ['--all', '--serie'] } };
    const r = await correrBarrido({ cfg, log: null });
    assert.equal(r.estado, 'completo');
    assert.deepEqual(r.ejecutados, ['arg-all', 'arg-serie'], 'el guion tiene que haber visto los dos');
  } finally { limpiar(raiz); }
});

test('AVERÍA 1 · la salida entera queda EN DISCO, con sus rojos por nombre', async () => {
  // Del primer barrido que funcionó de verdad (1 sep 2026): devolvió «208 ejecutadas · 113 en
  // rojo» y no había forma de saber CUÁLES. La lista solo vivía en la memoria del daemon hasta
  // el parte de las 3 h —que además sale por un Telegram sin configurar—, y un reinicio se la
  // llevaba. 113 rojos sin nombre no son un resultado legible: son un número.
  const raiz = mkdtempSync(path.join(tmpdir(), 'barrido-disco-'));
  try {
    mkdirSync(path.join(raiz, 'scripts'), { recursive: true });
    mkdirSync(path.join(raiz, 'logs'), { recursive: true });
    writeFileSync(path.join(raiz, 'scripts', 'run-gates.mjs'), `
      process.stdout.write('──── RESULTADO POR NOMBRE ────\\n');
      process.stdout.write('✅ gate-bueno   PASA\\n');
      process.stdout.write('❌ gate-malo    FALLA\\n');
      process.stdout.write('el detalle de por qué falló gate-malo va aquí\\n');
    `);
    const cfg = { repo: { raiz }, cuota: {}, barrido: { argumentos: ['--all'] },
                  rutasAbs: { logs: path.join(raiz, 'logs') } };
    const r = await correrBarrido({ cfg, log: null });

    assert.equal(r.estado, 'completo');
    assert.ok(r.registro, 'tiene que decir DÓNDE dejó la salida');
    const guardado = fs.readFileSync(r.registro, 'utf8');
    assert.match(guardado, /gate-malo\s+FALLA/, 'el rojo, por su nombre');
    assert.match(guardado, /el detalle de por qué falló/, 'y el detalle, que es lo que no cabe en el parte');
    assert.match(guardado, /run-gates\.mjs --all/, 'y con qué se invocó, que es la avería de esta misma mañana');
  } finally { limpiar(raiz); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════
//  AVERÍA 2 · LA CUOTA — con el reloj en la mano
// ════════════════════════════════════════════════════════════════════════════════════════════

test('AVERÍA 2 · lee el /usage de HOY, con el bloque nuevo detrás', () => {
  // Pegado tal cual de una consulta real del 1 sep 2026. Trae debajo el bloque «What's
  // contributing…», que no existía en la salida del 31 ago con la que se escribió el lector.
  const real = `You are currently using your subscription to power your Claude Code usage

Current session: 7% used · resets Sep 1, 12:59pm (UTC)
Current week (all models): 25% used · resets Sep 3, 6pm (UTC)
Current week (Fable): 0% used

What's contributing to your limits usage?
Approximate, based on local sessions on this machine.

Last 24h · 1919 requests · 101 sessions
  64% of your usage was at >150k context
  14% of your usage came from sessions active for 8+ hours`;
  const ahora = Date.parse('2026-09-01T08:20:00Z');
  const u = interpretarUsage(real, ahora);
  assert.equal(u.fiable, true);
  assert.equal(u.sesionPct, 7, 'el 64% del bloque de abajo NO puede confundirse con el de sesión');
  assert.equal(u.semanaPct, 25);
  assert.equal(u.reinicioSesionMs, Date.parse('2026-09-01T12:59:00Z'));
  assert.equal(u.reinicioSemanaMs, Date.parse('2026-09-03T18:00:00Z'));
});

test('AVERÍA 2 · la hora del reinicio se convierte en un instante, o en null', () => {
  const ahora = Date.parse('2026-09-01T08:20:00Z');
  assert.equal(momentoDeReinicio('Sep 1, 8am (UTC)', ahora), Date.parse('2026-09-01T08:00:00Z'));
  assert.equal(momentoDeReinicio('Aug 31, 9:50pm (UTC)', ahora), Date.parse('2026-08-31T21:50:00Z'));
  assert.equal(momentoDeReinicio('Sep 2, 12am (UTC)', ahora), Date.parse('2026-09-02T00:00:00Z'), '12am es medianoche');
  assert.equal(momentoDeReinicio('Sep 2, 12pm (UTC)', ahora), Date.parse('2026-09-02T12:00:00Z'), '12pm es mediodía');
  // Nochevieja: sin año en el texto, «Jan 1» es del año que viene, no de hace once meses.
  assert.equal(momentoDeReinicio('Jan 1, 3am (UTC)', Date.parse('2026-12-31T23:00:00Z')),
               Date.parse('2027-01-01T03:00:00Z'));
  // Y NO SE INVENTA NADA, que es la regla del fichero.
  assert.equal(momentoDeReinicio('cuando sea'), null);
  assert.equal(momentoDeReinicio(null), null);
  assert.equal(momentoDeReinicio('Xxx 40, 99am (UTC)'), null);
});

const CFG_CUOTA = { cuota: { esperaSinCuotaMs: 900000, margenTrasReinicioMs: 60000 } };

test('AVERÍA 2 · se duerme hasta el reinicio, no los 15 min de siempre', () => {
  const ahora = Date.parse('2026-09-01T07:56:00Z');
  const reinicio = Date.parse('2026-09-01T08:00:00Z');   // a cuatro minutos
  const espera = esperaHastaLaCuota({ reinicioMs: reinicio, ahora, config: CFG_CUOTA });
  assert.equal(espera, (reinicio - ahora) + 60000, 'hasta el reinicio, más el margen');
  assert.ok(espera < CFG_CUOTA.cuota.esperaSinCuotaMs, 'y bastante menos que los 15 min planos');
  assert.ok(ahora + espera > reinicio, 'despierta DESPUÉS del reinicio, no antes: mirar antes cuesta una consulta para nada');
});

test('AVERÍA 2 · nunca duerme MÁS que el sondeo de siempre', () => {
  const ahora = Date.parse('2026-09-01T08:00:00Z');
  const espera = esperaHastaLaCuota({ reinicioMs: ahora + 5 * 3600000, ahora, config: CFG_CUOTA });
  assert.equal(espera, 900000, 'un reinicio a cinco horas no puede dejar al daemon cinco horas ciego');
});

test('AVERÍA 2 · un reinicio caducado NO acelera el sondeo (preguntar /usage también gasta)', () => {
  const ahora = Date.parse('2026-09-01T08:30:00Z');
  assert.equal(esperaHastaLaCuota({ reinicioMs: ahora - 60000, ahora, config: CFG_CUOTA }), 900000);
  assert.equal(esperaHastaLaCuota({ reinicioMs: null, ahora, config: CFG_CUOTA }), 900000);
});

test('AVERÍA 2 · LA ESCENA DEL 1 SEP, entera: 07:39 con reinicio a las 08:00', () => {
  // LO QUE PASÓ DE VERDAD, del registro:
  //   07:39:47  ⏸ Espero: queda 12% de sesión
  //   07:39:47  La ventana se reinicia: Sep 1, 8am (UTC)   ← lo sabía
  //   07:54:55  Decisión: ESPERAR_CUOTA — queda 12%
  //   08:00     la ventana se reinicia. Depósito lleno. Nadie mira.
  //   08:09:59  ▶ Vuelve a haber cuota tras 30 min
  // DIEZ MINUTOS con el depósito lleno y 43 tareas esperando, mientras la pantalla de Ibrahin
  // marcaba 0% usado. Eso es exactamente lo que vio a las 10:05 de su reloj.
  //
  // No se prueba UNA decisión: se reproduce la MAÑANA. Una avería de «llega tarde» solo se
  // demuestra dejando correr el reloj, y con un solo `decidir()` es indemostrable — que es
  // justo por lo que la prueba de esa mañana la dejó pasar.
  const config = cargarConfig({ entorno: {} });
  const reinicio = Date.parse('2026-09-01T08:00:00Z');
  let ahora = Date.parse('2026-09-01T07:39:47Z');
  const miradas = [];

  for (let vuelta = 0; vuelta < 30; vuelta++) {
    const cuota = {
      fiable: true,
      // La ventana se reinicia sola a las 08:00: de 88% usado a 0%. El daemon no se entera
      // hasta que vuelve a mirar, y de eso va la avería.
      sesionPct: ahora >= reinicio ? 0 : 88,
      semanaPct: 25,
      reinicioSesion: 'Sep 1, 8am (UTC)', reinicioSesionMs: reinicio,
      reinicioSemana: 'Sep 3, 6pm (UTC)', reinicioSemanaMs: Date.parse('2026-09-03T18:00:00Z'),
    };
    const d = decidir({ estado: { tarea: null, apartadas: [], historial: [], fallosTecnicos: {} },
                        cuota, tareaDisponible: { id: 'x', titulo: 'X' }, config, ahora });
    miradas.push({ ahora, tipo: d.tipo });
    if (d.tipo !== ACCIONES.ESPERAR_CUOTA) break;
    ahora += d.esperaMs;
  }

  const arranque = miradas[miradas.length - 1];
  assert.equal(arranque.tipo, ACCIONES.TOMAR_TAREA, 'tiene que acabar cogiendo la tarea');
  const tarde = arranque.ahora - reinicio;
  assert.ok(tarde >= 0, 'no puede arrancar antes de que se reinicie la ventana');
  assert.ok(tarde <= 3 * 60000,
    `arranca ${Math.round(tarde / 60000)} min después del reinicio. El 1 sep 2026 fueron 10, con `
    + '43 tareas esperando. Si esto vuelve a subir, el daemon ha dejado de mirar la hora que /usage le da.\n'
    + miradas.map((m) => `  ${new Date(m.ahora).toISOString().slice(11, 19)}  ${m.tipo}`).join('\n'));
});

test('AVERÍA 2 · si la que corta es la SEMANAL, se anuncia y se espera la SEMANAL', () => {
  // El caso que mezclaba las dos: `decidir` devolvía SIEMPRE `reinicioSesion`, aunque el que
  // estuviera frenando fuese el límite semanal. Prometer un reinicio a las 8 de la mañana
  // cuando el que manda es el del jueves es mentir con precisión.
  const config = cargarConfig({ entorno: {} });
  const ahora = Date.parse('2026-09-01T08:20:00Z');
  const d = decidir({
    estado: { tarea: null, apartadas: [], historial: [], fallosTecnicos: {} },
    cuota: { fiable: true, sesionPct: 0, semanaPct: 95,
             reinicioSesion: 'Sep 1, 12:59pm (UTC)', reinicioSesionMs: Date.parse('2026-09-01T12:59:00Z'),
             reinicioSemana: 'Sep 3, 6pm (UTC)',    reinicioSemanaMs: Date.parse('2026-09-03T18:00:00Z') },
    tareaDisponible: { id: 'x', titulo: 'X' }, config, ahora });

  assert.equal(d.tipo, ACCIONES.ESPERAR_CUOTA);
  assert.equal(d.ventana, 'semanal', 'la que corta con 95% semanal usado es la semanal');
  assert.equal(d.reinicio, 'Sep 3, 6pm (UTC)', 'y la hora que se anuncia es la SUYA');
  assert.equal(d.esperaMs, config.cuota.esperaSinCuotaMs, 'a dos días vista, sondeo normal');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
//  AVERÍA 3 · LA PARADA — con algo DE VERDAD en vuelo
// ════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Un `claude` falso que TARDA en trabajar y contesta al instante a `/usage`.
 *
 * Las dos mitades tienen motivo, y las dos salieron de escribir esta prueba:
 *   · TARDA — el falso de antes (`binario: 'no-existe-este-binario'`) moría en 0 ms, así que
 *     cuando llegaba el SIGTERM no había nada en vuelo: se medía un daemon parado, no uno
 *     trabajando. Deja su pid escrito para poder afirmar que se murió y no quedó huérfano.
 *   · CONTESTA A `/usage` — la primera versión de este falso dormía TAMBIÉN la consulta de
 *     cuota, y el daemon nunca llegaba a llamar al arquitecto: la prueba medía la puerta
 *     equivocada. Un doble tiene que parecerse a lo que suple en lo que importa, y `claude`
 *     contesta a `/usage` en un segundo.
 */
function claudeQueTarda(raiz, segundos = 600) {
  const ruta = path.join(raiz, 'claude-lento.sh');
  writeFileSync(ruta, [
    '#!/bin/sh',
    'prompt=$(cat)',
    'case "$prompt" in',
    "  */usage*)",
    "    cat <<'JSON'",
    '{"result":"You are currently using your subscription to power your Claude Code usage\\n\\nCurrent session: 5% used · resets Sep 1, 11am (UTC)\\nCurrent week (all models): 20% used · resets Sep 3, 6pm (UTC)","permission_denials":[]}',
    'JSON',
    '    exit 0 ;;',
    'esac',
    `echo $$ > "${path.join(raiz, 'hijo.pid')}"`,
    `sleep ${segundos}`,
    '',
  ].join('\n'));
  chmodSync(ruta, 0o755);
  return ruta;
}

const vive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('AVERÍA 3 · SIGTERM con una llamada EN VUELO devuelve el control dentro del plazo', { timeout: 60000 }, async () => {
  // LA PRUEBA QUE FALTABA. El 1 sep, a las 08:10:36, llegó un SIGTERM con el arquitecto llevando
  // 37 s de análisis. El daemon no volvió: hubo que matarlo con SIGKILL. La prueba de esa mañana
  // no podía verlo porque su `claude` moría al instante Y porque afirmaba `esperandoCuota`, que
  // era el otro camino — el que ya se había arreglado.
  const raiz = repoTemporal();
  try {
    const cfg = configDe(raiz, {
      cli: { binario: claudeQueTarda(raiz), timeoutMs: 600000 },
      ciclo: { plazoParadaMs: 2000 },
      cuota: { minimoParaCicloPct: 1, margenReservadoPct: 0 },
    });
    const almacen = new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal,
                                  rutaHistorial: cfg.rutasAbs.historial });
    const daemon = arrancar({ config: cfg, entorno: {} });

    // Se espera a que la llamada esté DE VERDAD en vuelo: el hijo escribe su pid al arrancar.
    const rutaPid = path.join(raiz, 'hijo.pid');
    await hasta(() => fs.existsSync(rutaPid), 30000, 'la llamada nunca llegó a arrancar');
    const pidHijo = Number(fs.readFileSync(rutaPid, 'utf8').trim());
    assert.ok(vive(pidHijo), 'el falso tiene que estar vivo cuando llegue el SIGTERM');

    const t0 = Date.now();
    process.kill(process.pid, 'SIGTERM');
    const codigo = await daemon;
    const tardo = Date.now() - t0;

    assert.equal(codigo, 0, 'la parada tiene que ser limpia');
    assert.ok(tardo < 15000,
      `tardó ${Math.round(tardo / 1000)} s en devolver el control. Con un plazo de 2 s eso es `
      + 'la avería del 1 sep: SIGTERM no corta la llamada en vuelo.');

    await hasta(() => !vive(pidHijo), 5000, 'la llamada siguió viva tras la parada: queda un huérfano');

    // Y la tarea NO se pierde: queda en su paso, que es de donde se retoma.
    const despues = almacen.leerEstado();
    assert.equal(despues.tarea?.id, 'sumar-dos-numeros');
    assert.equal(despues.esperandoCuota, false,
      'ESTE es el camino que rompió: parado TRABAJANDO, no esperando cuota');
    assert.equal(despues.paso, 'ANALISIS', 'y se retoma justo donde estaba');

    // Y NO SE LE APUNTA UN FALLO AL ARQUITECTO. Lo enseñó el `systemctl restart` de verdad del
    // 1 sep 2026: la llamada cortada volvía como «la salida no es JSON (código 143)» —143 es
    // 128+SIGTERM, nuestra propia señal— y el registro decía «Fallo técnico 1 de 3». Tres
    // reinicios seguidos habrían apartado una tarea que no falló ni una vez.
    assert.deepEqual(despues.fallosTecnicos, {},
      'una llamada que cortamos nosotros no es un fallo del papel: no puede gastar intento');
  } finally { limpiar(raiz); }
});

test('AVERÍA 3 · una parada buena termina UN paso, no la tarea entera', { timeout: 60000 }, async () => {
  // El fallo de fondo, que el arreglo de la mañana no tocó: `while (!parando || estado.tarea)`
  // hacía que un SIGTERM con tarea entre manos siguiera dando vueltas —análisis, construcción,
  // revisión, cierre— hasta terminarla. Tres llamadas más, de hasta 30 min cada una.
  const raiz = repoTemporal();
  try {
    const guion = path.join(raiz, 'claude-cuenta.sh');
    // Cada llamada apunta una raya y contesta al instante: así, si el daemon encadenara pasos,
    // habría varias rayas. Con la parada buena bien hecha tiene que haber UNA.
    writeFileSync(guion, [
      '#!/bin/sh',
      'prompt=$(cat)',
      'case "$prompt" in',
      "  */usage*) printf '%s' '{\"result\":\"Current session: 5% used · resets Sep 1, 11am (UTC)\",\"permission_denials\":[]}'; exit 0 ;;",
      'esac',
      `echo x >> "${path.join(raiz, 'llamadas')}"`,
      'sleep 1',
      `printf '%s' '{"result":"hecho","permission_denials":[]}'`,
      '',
    ].join('\n'));
    chmodSync(guion, 0o755);
    const cfg = configDe(raiz, {
      cli: { binario: guion, timeoutMs: 60000 },
      ciclo: { plazoParadaMs: 20000, intervaloVueltaMs: 10 },
      cuota: { minimoParaCicloPct: 1, margenReservadoPct: 0 },
    });
    const daemon = arrancar({ config: cfg, entorno: {} });
    const rutaLlamadas = path.join(raiz, 'llamadas');
    await hasta(() => fs.existsSync(rutaLlamadas), 30000, 'no llegó a llamar ni una vez');

    process.kill(process.pid, 'SIGTERM');
    assert.equal(await daemon, 0);

    const rayas = fs.readFileSync(rutaLlamadas, 'utf8').trim().split('\n').length;
    assert.equal(rayas, 1,
      `hizo ${rayas} llamadas tras el SIGTERM: está terminando la TAREA, no el PASO. `
      + 'Es la condición `while (!parando || estado.tarea)» del 1 sep 2026.');
  } finally { limpiar(raiz); }
});

test('AVERÍA 3 · un SEGUNDO SIGTERM corta sin esperar al plazo', { timeout: 60000 }, async () => {
  const raiz = repoTemporal();
  try {
    const cfg = configDe(raiz, {
      cli: { binario: claudeQueTarda(raiz), timeoutMs: 600000 },
      ciclo: { plazoParadaMs: 300000 },   // plazo absurdo a propósito: manda el segundo SIGTERM
      cuota: { minimoParaCicloPct: 1, margenReservadoPct: 0 },
    });
    const daemon = arrancar({ config: cfg, entorno: {} });
    await hasta(() => fs.existsSync(path.join(raiz, 'hijo.pid')), 30000, 'la llamada nunca arrancó');

    const t0 = Date.now();
    process.kill(process.pid, 'SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    process.kill(process.pid, 'SIGTERM');
    assert.equal(await daemon, 0);
    assert.ok(Date.now() - t0 < 15000, 'el segundo SIGTERM no puede quedarse esperando los 5 min del plazo');
  } finally { limpiar(raiz); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════
//  EL UMBRAL QUE GARANTIZA EL BLOQUEO — la misma familia, encontrada desde el otro lado
// ════════════════════════════════════════════════════════════════════════════════════════════

test('un umbral de cuota que no puede alcanzarse NUNCA revienta al cargar la config', () => {
  // DE DÓNDE SALE (1 sep 2026). Para verificar el barrido hice falta un rato muerto, así que colé
  // `ORQUESTADOR_MIN_CICLO_PCT=90` por entorno. El daemon lo aceptó sin pestañear y se quedó
  // parado con 43 tareas delante — 90 + 10 de reserva = 100 exactos, o sea «hace falta que la
  // ventana esté ENTERA libre».
  //
  // `validar()` existe precisamente para que «un umbral absurdo reviente en el arranque», y
  // comprobaba `> 100`: dejaba pasar el ÚNICO valor que garantiza el bloqueo. Es el mismo error
  // que las tres del día — el guardián estaba de acuerdo con la suposición.
  const bloquea = () => cargarConfig({ entorno: { ORQUESTADOR_MIN_CICLO_PCT: '90' } });
  assert.throws(bloquea, /NO ARRANCARÍA NUNCA/,
    '90 + 10 = 100 deja al daemon parado para siempre y tiene que reventar al cargar');

  // Y el valor de trabajo sigue siendo válido: la comprobación no puede pasarse de dura.
  const bueno = cargarConfig({ entorno: { ORQUESTADOR_MIN_CICLO_PCT: '15' } });
  assert.equal(bueno.cuota.minimoParaCicloPct + bueno.cuota.margenReservadoPct, 25);
});

// ── utilidades ───────────────────────────────────────────────────────────────────────────────

function correr(cmd, args, cwd) {
  return new Promise((res) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 110000 },
      (err, out, errOut) => res({ code: err?.code ?? 0, salida: `${out}${errOut}` }));
  });
}

/** Espera activa con motivo. Si no se cumple, dice QUÉ no se cumplió, no «timeout». */
async function hasta(cond, ms, queja) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(queja);
}
