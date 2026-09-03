// El vigía recibe órdenes. Esto es una puerta al servidor: se prueba como tal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ORDENES, PIDEN_CONFIRMACION, interpretar, ayuda, pedirConfirmacion, NO_ERES_QUIEN } from '../vigia/ordenes.js';
import { Escucha, contestarEstado, contestarCuota, contestarTareas } from '../vigia/escucha.js';
import { Almacen, leerLineas } from '../nucleo/almacen.js';
import { repoTemporal, limpiar, configDe, registroMudo, TABLERO_BLOQUE } from './ayuda.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1 · El vocabulario: se habla en castellano llano
// ─────────────────────────────────────────────────────────────────────────────

test('entiende cómo escribe una persona, no comandos técnicos', () => {
  const casos = {
    'parte': ORDENES.PARTE, '/parte': ORDENES.PARTE, 'mándame el parte': ORDENES.PARTE,
    '¿qué estás haciendo?': ORDENES.ESTADO, 'qué haces': ORDENES.ESTADO, 'cómo vas': ORDENES.ESTADO,
    'cómo va la cuota': ORDENES.CUOTA, 'cuánto queda': ORDENES.CUOTA,
    'qué tareas quedan': ORDENES.TAREAS, 'qué falta': ORDENES.TAREAS,
    'para': ORDENES.PARAR, 'párate': ORDENES.PARAR, 'pausa': ORDENES.PARAR, 'no cojas más tareas': ORDENES.PARAR,
    'arranca': ORDENES.ARRANCAR, 'sigue': ORDENES.ARRANCAR, 'continúa': ORDENES.ARRANCAR,
    'para ya': ORDENES.PARAR_YA, 'para de golpe': ORDENES.PARAR_YA,
    'salta esta tarea': ORDENES.SALTAR, 'sáltate la tarea': ORDENES.SALTAR,
    'sí': ORDENES.SI, 'vale': ORDENES.SI, 'no': ORDENES.NO, 'déjalo': ORDENES.NO,
  };
  for (const [texto, esperado] of Object.entries(casos)) {
    assert.equal(interpretar(texto).orden, esperado, `«${texto}» tenía que ser ${esperado}`);
  }
});

test('«para ya» no se confunde con «para»: son cosas distintas', () => {
  assert.equal(interpretar('para').orden, ORDENES.PARAR);
  assert.equal(interpretar('para ya').orden, ORDENES.PARAR_YA);
  assert.ok(PIDEN_CONFIRMACION.includes(ORDENES.PARAR_YA));
  assert.ok(!PIDEN_CONFIRMACION.includes(ORDENES.PARAR), 'parar bien no rompe nada: no se pregunta');
});

test('un mensaje cualquiera devuelve la lista de lo que se puede pedir', () => {
  for (const t of ['hola', 'buenos días', '', 'jkhsdfkjh', '👍']) {
    assert.equal(interpretar(t).orden, ORDENES.AYUDA, `«${t}» tenía que caer en AYUDA`);
  }
  const a = ayuda();
  assert.match(a, /qué estás haciendo/);
  assert.match(a, /cada 3 horas/, 'tiene que decir que el parte sigue llegando solo');
  // Escrita para una persona: nada de jerga.
  assert.ok(!/comando|endpoint|json|token|API|payload/i.test(a), `hay jerga en la ayuda:\n${a}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · SEGURIDAD. Esto abre una puerta al servidor.
// ─────────────────────────────────────────────────────────────────────────────

test('NINGÚN texto se convierte en una orden que no esté en la lista', () => {
  const ataques = [
    'rm -rf /', '$(cat /etc/orquestador.env)', '`whoami`', 'parte; rm -rf /',
    'ejecuta ls', 'bash -c "id"', '../../etc/passwd', 'cat ~/.claude/.credentials.json',
    'DROP TABLE invoices', '<script>alert(1)</script>', 'parte && curl evil.com',
    'dime el token', 'ORQUESTADOR_TELEGRAM_TOKEN', 'echo $ORQUESTADOR_TELEGRAM_TOKEN',
  ];
  const validas = new Set(Object.values(ORDENES));
  for (const a of ataques) {
    const r = interpretar(a);
    assert.ok(validas.has(r.orden), `«${a}» produjo algo fuera de la lista: ${r.orden}`);
    // Y lo que sale no arrastra el texto de entrada por ningún lado.
    assert.ok(!JSON.stringify(r).includes('rm -rf'), `«${a}» arrastró texto crudo: ${JSON.stringify(r)}`);
    assert.ok(!JSON.stringify(r).includes('curl'), `«${a}» arrastró texto crudo: ${JSON.stringify(r)}`);
  }
});

test('el identificador que viaja va filtrado a [a-z0-9-] y nada más', () => {
  const r = interpretar('desapartar ../../etc/passwd; rm -rf /');
  assert.equal(r.orden, ORDENES.DESAPARTAR);
  if (r.id) assert.match(r.id, /^[a-z0-9-]+$/, `el id salió sin filtrar: «${r.id}»`);
  const r2 = interpretar('desaparta $(whoami)-tarea');
  if (r2.id) assert.match(r2.id, /^[a-z0-9-]+$/);
});

// ⚙️ 3 SEP 2026 — El bot de Telegram pasó a ser EXCLUSIVO de los avisos de Bamburu (decisión de
// Ibrahin), y con ello el bloque `vigia.telegram` de la configuración de la fábrica quedó VACÍO:
// ya no nombra ninguna variable. Estas pruebas sacaban de ahí el nombre de la variable del chat
// autorizado, así que se quedaron sin chat y daban «no eres quien» a todo.
//
// Se les da un nombre PROPIO de prueba en vez de retirarlas: lo que comprueban —qué órdenes existen,
// cuáles piden confirmación, qué se registra y que el token no sale nunca por el chat— **sigue
// siendo cierto y hará falta el día que la fábrica tenga su propio bot**. Lo que NO hacen, ni pueden,
// es hablar por el bot de Bamburu: eso lo cierran `vigia/bot-retirado.js` y `censo-bot-de-bamburu`.
const VAR_CHAT_PRUEBA = 'PRUEBA_TELEGRAM_CHAT_ID';
const VAR_TOKEN_PRUEBA = 'PRUEBA_TELEGRAM_TOKEN';

function montarVigia(raiz, { chatId = '111', entornoExtra = {} } = {}) {
  const cfg = configDe(raiz, { vigia: { activo: true,
    telegram: { tokenEnv: VAR_TOKEN_PRUEBA, chatIdEnv: VAR_CHAT_PRUEBA, timeoutMs: 1000, maxPendientes: 50 } } });
  const almacen = new Almacen({ rutaEstado: cfg.rutasAbs.estado, rutaJournal: cfg.rutasAbs.journal, rutaHistorial: cfg.rutasAbs.historial });
  const entorno = { [VAR_TOKEN_PRUEBA]: '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                    [VAR_CHAT_PRUEBA]: chatId, ...entornoExtra };
  const enviados = [];
  const vig = { async consultar() { return { fiable: true, sesionPct: 30, semanaPct: 10, reinicioSesion: 'a las 2' }; } };
  const escucha = new Escucha({ config: cfg, almacen, vigilante: vig, logger: registroMudo(), entorno });
  // Se sustituye el envío real: la prueba no habla con Telegram.
  escucha.enviados = enviados;
  return { cfg, almacen, escucha, entorno, enviados };
}

/** Atiende un mensaje sin tocar la red: se captura lo que habría contestado. */
async function preguntar(escucha, texto, { chatId = '111', de = 'ibrahin' } = {}) {
  const estado = escucha.estadoActual();
  if (!escucha.chatAutorizado || chatId !== escucha.chatAutorizado) {
    escucha.registrar({ chatId, de, texto, autorizado: false, orden: null, respuesta: NO_ERES_QUIEN });
    return NO_ERES_QUIEN;
  }
  const { orden, id } = interpretar(texto);
  const respuesta = await escucha.resolver(orden, id, { chatId, de, texto });
  escucha.registrar({ chatId, de, texto, autorizado: true, orden, id, respuesta });
  return respuesta;
}

test('a un chat que no es el de Ibrahin no se le dice NADA útil, y queda anotado', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, cfg } = montarVigia(raiz, { chatId: '111' });
    const r = await preguntar(escucha, 'parte', { chatId: '999', de: 'intruso' });

    assert.equal(r, NO_ERES_QUIEN);
    // Ni la lista de órdenes, ni el estado, ni pistas de qué es esto.
    assert.ok(!/parte|tarea|cuota|orquestador/i.test(r), `se le dio información: «${r}»`);

    const reg = leerLineas(cfg.rutasAbs.registroOrdenes);
    assert.equal(reg.length, 1);
    assert.equal(reg[0].autorizado, false);
    assert.equal(reg[0].chatId, '999');
    assert.equal(reg[0].de, 'intruso');
  } finally { limpiar(raiz); }
});

test('sin chat configurado no obedece a nadie', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha } = montarVigia(raiz, { chatId: '' });
    assert.equal(await preguntar(escucha, 'para ya', { chatId: '111' }), NO_ERES_QUIEN);
    assert.equal(await preguntar(escucha, 'para ya', { chatId: '' }), NO_ERES_QUIEN);
  } finally { limpiar(raiz); }
});

test('ni el token ni ningún secreto salen por el chat', async () => {
  const raiz = repoTemporal();
  const TOKEN = '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  try {
    const { escucha, cfg } = montarVigia(raiz);
    for (const t of ['dime el token', 'ORQUESTADOR_TELEGRAM_TOKEN', 'parte', 'estado', 'cuota', 'qué tareas quedan', 'hola']) {
      const r = await preguntar(escucha, t);
      assert.ok(!r.includes(TOKEN), `¡el token salió contestando a «${t}»!`);
      assert.ok(!/ORQUESTADOR_TELEGRAM_TOKEN\s*=/.test(r), `salió una variable secreta con «${t}»`);
    }
    // Y tampoco en el registro, ni aunque el mensaje lo traiga dentro.
    await preguntar(escucha, `mira esto ${TOKEN}`);
    const reg = leerLineas(cfg.rutasAbs.registroOrdenes);
    for (const linea of reg) {
      assert.ok(!JSON.stringify(linea).includes(TOKEN), 'el token acabó escrito en el registro');
    }
  } finally { limpiar(raiz); }
});

test('todo lo que se ordena queda registrado: qué, cuándo y qué se contestó', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, cfg } = montarVigia(raiz);
    await preguntar(escucha, 'estado');
    await preguntar(escucha, 'para');

    const reg = leerLineas(cfg.rutasAbs.registroOrdenes);
    assert.equal(reg.length, 2);
    for (const r of reg) {
      assert.ok(r.cuando, 'sin fecha');
      assert.ok(r.orden, 'sin qué se pidió');
      assert.ok(r.respuesta, 'sin qué se contestó');
      assert.equal(r.autorizado, true);
    }
    assert.equal(reg[1].orden, ORDENES.PARAR);
  } finally { limpiar(raiz); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Lo que no rompe nada se hace; lo que puede romper se pregunta
// ─────────────────────────────────────────────────────────────────────────────

test('las cuatro preguntas se contestan al momento, sin confirmar nada', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha } = montarVigia(raiz);
    assert.match(await preguntar(escucha, 'parte'), /Parte del orquestador/);
    assert.match(await preguntar(escucha, 'qué haces'), /Ahora mismo/);
    assert.match(await preguntar(escucha, 'cuota'), /Cuota/);
    assert.match(await preguntar(escucha, 'qué queda'), /Lo que queda/);
    assert.equal(escucha.pendienteDeConfirmar, null, 'ninguna de éstas pregunta nada');
  } finally { limpiar(raiz); }
});

test('«para» y «arranca» se anotan para el orquestador, sin confirmación', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, cfg } = montarVigia(raiz);
    const r = await preguntar(escucha, 'para');
    assert.match(r, /anotad/i, 'tiene que decir que queda anotada, esté el daemon en pie o no');
    assert.equal(escucha.pendienteDeConfirmar, null);

    const bandeja = leerLineas(cfg.rutasAbs.ordenes);
    assert.equal(bandeja.length, 1);
    assert.equal(bandeja[0].orden, ORDENES.PARAR);
  } finally { limpiar(raiz); }
});

test('«para ya» NO se hace sin un sí, y un «no» la deja en nada', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, cfg } = montarVigia(raiz);
    const r = await preguntar(escucha, 'para ya');
    assert.match(r, /¿Paro de golpe\?/);
    assert.match(r, /sí<\/b> o <b>no/);
    assert.ok(escucha.pendienteDeConfirmar, 'tiene que quedarse esperando');
    assert.equal(leerLineas(cfg.rutasAbs.ordenes).length, 0, 'no ha hecho nada todavía');

    const r2 = await preguntar(escucha, 'no');
    assert.match(r2, /lo dejo estar/i);
    assert.equal(escucha.pendienteDeConfirmar, null);
    assert.equal(leerLineas(cfg.rutasAbs.ordenes).length, 0, 'sigue sin hacer nada');
  } finally { limpiar(raiz); }
});

test('un mensaje que no es «sí» cancela la confirmación: no se da por confirmado lo que no se confirmó', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, cfg } = montarVigia(raiz);
    await preguntar(escucha, 'salta esta tarea');
    assert.ok(escucha.pendienteDeConfirmar);

    const r = await preguntar(escucha, 'qué tal');
    assert.match(r, /no he hecho nada/i);
    assert.equal(escucha.pendienteDeConfirmar, null);
    assert.equal(leerLineas(cfg.rutasAbs.ordenes).length, 0);
  } finally { limpiar(raiz); }
});

test('la confirmación caduca: un «sí» de dos horas después no vale', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, cfg } = montarVigia(raiz);
    await preguntar(escucha, 'para ya');
    escucha.pendienteDeConfirmar.hasta = Date.now() - 1;   // ya pasó su plazo

    const r = await preguntar(escucha, 'sí');
    assert.match(r, /No te había preguntado nada/);
    assert.equal(leerLineas(cfg.rutasAbs.ordenes).length, 0);
  } finally { limpiar(raiz); }
});

test('un «sí» suelto, sin haber preguntado nada, no dispara nada', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, cfg } = montarVigia(raiz);
    assert.match(await preguntar(escucha, 'sí'), /No te había preguntado nada/);
    assert.equal(leerLineas(cfg.rutasAbs.ordenes).length, 0);
  } finally { limpiar(raiz); }
});

test('«desapartar» sin tener ninguna apartada lo dice, y no pregunta nada', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha } = montarVigia(raiz);
    const r = await preguntar(escucha, 'desapartar loquesea-que-no-existe');
    assert.match(r, /No hay ninguna tarea apartada/);
    assert.equal(escucha.pendienteDeConfirmar, null);
  } finally { limpiar(raiz); }
});

test('«desapartar» con una apartada de verdad: pregunta, y con el sí la anota', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, almacen, cfg } = montarVigia(raiz);
    let estado = almacen.recuperar().estado;
    estado = almacen.transicion(estado, { tipo: 'TAREA_TOMADA', tarea: { id: 'sumar-dos-numeros', titulo: 'Sumar dos numeros' }, cuota: 0 });
    almacen.transicion(estado, { tipo: 'TAREA_APARTADA', motivo: 'no salía', detalle: [] });

    const r = await preguntar(escucha, 'desapartar sumar-dos-numeros');
    assert.match(r, /Sumar dos numeros/);
    assert.ok(escucha.pendienteDeConfirmar);

    const r2 = await preguntar(escucha, 'sí');
    assert.match(r2, /Anotado/);
    const bandeja = leerLineas(cfg.rutasAbs.ordenes);
    assert.equal(bandeja.length, 1);
    assert.equal(bandeja[0].orden, ORDENES.DESAPARTAR);
    assert.equal(bandeja[0].id, 'sumar-dos-numeros');
  } finally { limpiar(raiz); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Cómo se habla: en el mismo idioma que los partes
// ─────────────────────────────────────────────────────────────────────────────

test('las respuestas están en castellano y sin jerga', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha } = montarVigia(raiz);
    for (const t of ['hola', 'estado', 'cuota', 'qué queda', 'para', 'para ya']) {
      const r = await preguntar(escucha, t);
      assert.ok(!/undefined|null|NaN|\[object|Error:|stack/i.test(r), `respuesta con jerga a «${t}»:\n${r}`);
      assert.ok(!/timeout|offset|payload|endpoint|exit code/i.test(r), `jerga técnica a «${t}»:\n${r}`);
    }
  } finally { limpiar(raiz); }
});

test('el estado dice en qué va y desde cuándo', () => {
  const hace20 = new Date(Date.now() - 20 * 60000).toISOString();
  const t = contestarEstado({ estado: { tarea: { titulo: 'Arreglar el portal' }, paso: 'CONSTRUCCION', pasoDesde: hace20, intento: 1, apartadas: [] }, pid: 123 });
  assert.match(t, /Arreglar el portal/);
  assert.match(t, /construyendo/);
  assert.match(t, /hace 20 min/);
});

test('el estado avisa si el orquestador no está corriendo', () => {
  const t = contestarEstado({ estado: { tarea: null, paso: 'OCIOSO', apartadas: [] }, pid: null });
  assert.match(t, /no está corriendo/i);
});

test('la cuota dice cuánta queda y cuándo se reinicia', () => {
  const t = contestarCuota({ cuota: { fiable: true, sesionPct: 30, semanaPct: 10, reinicioSesion: 'a las 2:00' } });
  assert.match(t, /70%/);
  assert.match(t, /a las 2:00/);
});

test('las tareas señalan cuál es la siguiente y cómo recuperar una apartada', () => {
  const t = contestarTareas({
    pendientes: [{ id: 'a', titulo: 'La primera' }, { id: 'b', titulo: 'La segunda' }],
    siguiente: { id: 'a' },
    estado: { apartadas: [{ id: 'c', titulo: 'La apartada', motivo: 'no salía' }] },
  });
  assert.match(t, /➡️ La primera/);
  assert.match(t, /desapartar c/);
});

test('en pausa se dice, para que no parezca que está roto', () => {
  const t = contestarTareas({ pendientes: [{ id: 'a', titulo: 'X' }], siguiente: { id: 'a' }, estado: { pausado: true, apartadas: [] } });
  assert.match(t, /en pausa/i);
  assert.match(t, /arranca/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Convivencia: el vigía NO pisa al daemon
// ─────────────────────────────────────────────────────────────────────────────

test('el vigía lee el estado sin escribir NADA: el dueño del fichero es el daemon', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, almacen, cfg } = montarVigia(raiz);
    let estado = almacen.recuperar().estado;
    estado = almacen.transicion(estado, { tipo: 'TAREA_TOMADA', tarea: { id: 'x', titulo: 'Una tarea' }, cuota: 0 });

    const antes = fs.statSync(cfg.rutasAbs.estado).mtimeMs;
    const journalAntes = fs.readFileSync(cfg.rutasAbs.journal, 'utf8');

    // Se le pregunta de todo, varias veces.
    for (let i = 0; i < 5; i++) {
      await preguntar(escucha, 'estado');
      await preguntar(escucha, 'parte');
      await preguntar(escucha, 'qué queda');
    }

    assert.equal(fs.statSync(cfg.rutasAbs.estado).mtimeMs, antes, 'el vigía tocó estado.json');
    assert.equal(fs.readFileSync(cfg.rutasAbs.journal, 'utf8'), journalAntes, 'el vigía tocó el journal');
  } finally { limpiar(raiz); }
});

test('el vigía ve lo que el daemon acaba de escribir en el journal, aunque la instantánea vaya detrás', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, almacen, cfg } = montarVigia(raiz);
    let estado = almacen.recuperar().estado;
    // El vigía mira el pid para saber si el daemon vive. Aquí se usa el de la propia prueba.
    // Va después de la primera transición: antes, el directorio aún no existe.
    fs.mkdirSync(path.dirname(cfg.rutasAbs.estado), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(cfg.rutasAbs.estado), 'daemon.pid'), String(process.pid));
    estado = almacen.transicion(estado, { tipo: 'TAREA_TOMADA', tarea: { id: 'x', titulo: 'Recién cogida' }, cuota: 0 });

    // Se simula el hueco real: el daemon ya escribió el journal y aún no la instantánea.
    // Es el instante en el que un vigía mal hecho contestaría algo viejo.
    const inst = JSON.parse(fs.readFileSync(cfg.rutasAbs.estado, 'utf8'));
    fs.writeFileSync(cfg.rutasAbs.estado, JSON.stringify({ ...inst, seq: inst.seq - 1, tarea: null, paso: 'OCIOSO' }));

    const r = await preguntar(escucha, 'qué estás haciendo');
    assert.match(r, /Recién cogida/, 'el vigía tiene que reconciliar el journal, no creerse la instantánea vieja');
  } finally { limpiar(raiz); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 · No prometer lo que no va a pasar
// ─────────────────────────────────────────────────────────────────────────────

test('parado a propósito: NO dice que va a volver solo, y explica qué hace falta', () => {
  // De dónde sale (1 sep 2026): el vigía contestaba «Systemd debería levantarlo solo en menos
  // de un minuto» siempre que no encontraba el proceso. Con el servicio parado a propósito con
  // `systemctl stop`, systemd NO lo levanta — y ese mensaje salió de verdad a Telegram.
  const t = contestarEstado({
    estado: { tarea: null, paso: 'OCIOSO', apartadas: [] },
    pid: null, situacion: { vivo: null, parado: true, unidad: 'orquestador' },
  });
  assert.ok(!/debería levantarlo|en menos de un minuto|en cuanto systemd/i.test(t), `sigue prometiéndolo:\n${t}`);
  assert.match(t, /parado se queda/i);
  assert.match(t, /systemctl start orquestador/);
});

test('caído de verdad: sí dice que vuelve solo, porque es cierto', () => {
  const t = contestarEstado({
    estado: { tarea: null, paso: 'OCIOSO', apartadas: [] },
    pid: null, situacion: { vivo: null, volviendo: true },
  });
  assert.match(t, /levantando solo/i);
});

test('sin saber qué le pasa, lo dice en vez de inventárselo', () => {
  const t = contestarEstado({
    estado: { tarea: null, paso: 'OCIOSO', apartadas: [] },
    pid: null, situacion: { vivo: null, desconocido: true },
  });
  assert.match(t, /no sé decirte/i);
  assert.ok(!/systemctl start/.test(t), 'no manda ejecutar nada si no sabe qué pasa');
});

test('la consulta a systemd no lleva NI UN carácter de ningún mensaje de Telegram', async () => {
  const raiz = repoTemporal();
  try {
    const { escucha, cfg } = montarVigia(raiz);
    // La unidad sale de la configuración y va filtrada; el texto del mensaje no la toca.
    for (const t of ['estado', 'estado; rm -rf /', 'qué haces $(id)']) {
      const r = await preguntar(escucha, t);
      assert.ok(!/rm -rf|\$\(id\)/.test(r), `arrastró el texto del mensaje: ${r}`);
    }
    // Y una unidad con pinta rara no se consulta: se dice que no se sabe.
    const { situacionDelServicio } = await import('../vigia/escucha.js');
    const malo = { ...cfg, vigia: { ...cfg.vigia, escucha: { ...cfg.vigia.escucha, unidad: 'orq; rm -rf /' } } };
    assert.equal(situacionDelServicio(malo).desconocido, true);
  } finally { limpiar(raiz); }
});
