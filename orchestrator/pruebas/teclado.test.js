// Los botones del bot. Encargo de Ibrahin del 1 sep 2026: tocar en vez de acordarse de las
// palabras exactas. Lo que se defiende aquí no es que existan los botones, es que cada uno
// mande DE VERDAD la orden que su etiqueta promete — porque un botón mudo contesta con la
// ayuda y parece que ha funcionado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cargarConfig } from '../nucleo/config.js';
import { interpretar, revisarTeclado, ORDENES, PIDEN_CONFIRMACION } from '../vigia/ordenes.js';
import { marcaTeclado, enviar } from '../../core/telegram-transporte.js';

const cfg = cargarConfig({ raiz: '/tmp', entorno: {} });

test('los botones QUE SE VAN A ENVIAR de verdad caen en la orden que prometen', () => {
  // Contra el config REAL, no contra uno de laboratorio: lo que se rompió esta mañana fue
  // exactamente eso — se verificó una cosa y se desplegó otra.
  const r = revisarTeclado(cfg.vigia.teclado);
  assert.deepEqual(r.fallos, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.filas, [['Parte', 'Qué hace', 'Cuota'], ['Preguntas', 'Arranca', 'Para']]);
});

test('«Qué hace» pide el ESTADO, que es lo que costó descubrir', () => {
  // De los seis del encargo, éste era el único que no encajaba: el vocabulario tenía «qué
  // haces» y la etiqueta dice «qué hace». Caía en AYUDA y parecía que el bot contestaba.
  assert.equal(interpretar('Qué hace').orden, ORDENES.ESTADO);
});

test('«Qué hace» NO se lleva por delante «¿qué hace falta…?», que pregunta por la cola', () => {
  assert.notEqual(interpretar('que hace falta para cerrar esto').orden, ORDENES.ESTADO);
});

test('un botón que promete una cosa y manda otra NO se monta', () => {
  const r = revisarTeclado([[{ texto: 'Cuota', orden: 'PARTE' }]]);
  assert.equal(r.ok, false);
  assert.match(r.fallos[0], /promete «PARTE» pero el intérprete lo lee como «CUOTA»/);
});

test('las tres que pueden dejar algo a medias NO pueden ir en un botón', () => {
  // «parar ya», «saltar» y «desapartar» se tocan sin querer con el móvil en el bolsillo.
  for (const orden of PIDEN_CONFIRMACION) {
    const r = revisarTeclado([[{ texto: 'lo que sea', orden }]]);
    assert.equal(r.ok, false, `${orden} no debería poder ir en un botón`);
    assert.match(r.fallos.join(' '), /pide confirmación/);
  }
  // Y ninguna está en el teclado de verdad.
  const enUso = cfg.vigia.teclado.flat().map((b) => b.orden);
  for (const orden of PIDEN_CONFIRMACION) assert.ok(!enUso.includes(orden));
});

test('el teclado se queda FIJO: ni one_time_keyboard ni nada que lo pliegue', () => {
  const m = marcaTeclado([['Parte', 'Cuota']]);
  assert.equal(m.is_persistent, true);
  assert.equal(m.resize_keyboard, true);
  assert.equal(m.one_time_keyboard, undefined);
  assert.deepEqual(m.keyboard, [[{ text: 'Parte' }, { text: 'Cuota' }]]);
});

test('sin teclado válido no se monta ninguno, y eso NO es un error del bot', () => {
  assert.equal(revisarTeclado(null).ok, false);
  assert.equal(revisarTeclado([]).ok, false);
  assert.deepEqual(revisarTeclado(null).filas, []);
});

// ── Y lo que el encargo manda comprobar aunque «debería estar bien» ────────────
test('ESCRIBIR SIGUE FUNCIONANDO: una respuesta larga no se lee como orden', () => {
  const larga = '5: treinta días, y vaciarla solo el dueño';
  const r = interpretar(larga);
  assert.equal(r.orden, ORDENES.RESPONDER);
  assert.equal(r.numero, 5);
  assert.equal(r.respuesta, 'treinta días, y vaciarla solo el dueño');
});

test('el botón «Para» para, y la preposición «para» NO', () => {
  // El fallo más caro que puede repetirse aquí: hasta esta mañana cualquier frase con «para»
  // dentro paraba la fábrica. El botón manda un texto fijo que ABRE la frase, así que para;
  // una respuesta que la lleva en medio, no.
  assert.equal(interpretar('Para').orden, ORDENES.PARAR);
  for (const frase of [
    'que se le obligue para poder facturar',
    'esto es para el cliente, no para el dueño',
    '2FA obligatoria para el dueño',
    'una papelera para recuperar lo borrado',
    '3: sí, pero solo para los que ya han firmado',
  ]) {
    assert.notEqual(interpretar(frase).orden, ORDENES.PARAR, `«${frase}» NO puede parar la fábrica`);
  }
});

// ── El respaldo: «si el teclado no se puede montar, el bot sigue funcionando» ──
const ENTORNO = { TG_TOKEN: 'x', TG_CHAT: '1' };
const CFG_TG = { vigia: { telegram: { tokenEnv: 'TG_TOKEN', chatIdEnv: 'TG_CHAT', timeoutMs: 1000 } } };

test('si Telegram rechaza el teclado con un 400, el MENSAJE sale igual sin él', async () => {
  const envios = [];
  const poster = async ({ cuerpo }) => {
    envios.push(JSON.parse(cuerpo));
    return envios.length === 1
      ? { ok: false, reintentable: false, codigo: 400, motivo: 'Telegram respondió 400: BUTTON_TEXT_EMPTY' }
      : { ok: true };
  };
  const r = await enviar({ texto: 'hola', config: CFG_TG, entorno: ENTORNO, teclado: [['Parte']], poster });

  assert.equal(r.ok, true, 'el mensaje TIENE que llegar');
  assert.equal(r.sinTeclado, true);
  assert.equal(envios.length, 2, 'un intento con teclado y uno sin él');
  assert.ok(envios[0].reply_markup, 'el primero lo lleva');
  assert.equal(envios[1].reply_markup, undefined, 'el segundo no');
  assert.equal(envios[1].text, 'hola', 'y es el mismo mensaje, no otro');
});

test('un 500 NO dispara el respaldo: eso es Telegram caído, no un teclado malo', async () => {
  let veces = 0;
  const poster = async () => { veces++; return { ok: false, reintentable: true, codigo: 500, motivo: 'caído' }; };
  const r = await enviar({ texto: 'hola', config: CFG_TG, entorno: ENTORNO, teclado: [['Parte']], poster });
  assert.equal(veces, 1, 'reintentar sin teclado no arregla un 500 y gastaría un envío para nada');
  assert.equal(r.ok, false);
  assert.equal(r.reintentable, true, 'y se deja que lo reintente quien sabe esperar');
});

test('un botón con el texto vacío lo para NUESTRA revisión, porque Telegram lo acepta', () => {
  // Medido el 1 sep 2026 contra la API real: `{text: ""}` NO da 400, se acepta, y el chat se
  // queda con un teclado de un botón en blanco. La única puerta que lo impide es ésta.
  const r = revisarTeclado([[{ texto: '', orden: 'PARTE' }]]);
  assert.equal(r.ok, false);
  assert.match(r.fallos.join(' '), /sin texto o sin orden/);
});
