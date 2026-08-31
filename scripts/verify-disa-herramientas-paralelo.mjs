// Test de LÓGICA — DISA CONTESTA TODAS LAS HERRAMIENTAS DE UN TURNO. Sin red, sin clave, sin gasto.
//   node scripts/verify-disa-herramientas-paralelo.mjs
//
// POR QUÉ EXISTE ESTE FICHERO — EL 400 DISFRAZADO DE FALLO DE RED (31 ago 2026).
// El uso de herramientas en paralelo está ACTIVO POR DEFECTO en la Messages API: una respuesta puede
// traer varios bloques `tool_use`, y el contrato dice que el mensaje `user` siguiente tiene que traer
// UN `tool_result` POR CADA UNO, emparejado por su `tool_use_id`. El bucle de `/message` cogía la
// PRIMERA llamada con `.find(...)`, ejecutaba solo esa, reenviaba TODAS al historial y contestaba UNA.
// La petición siguiente era inválida → 400 → `core/llm.js` no distingue 400 de 5xx → el usuario leía
// «No se pudo contactar con DISA». Un fallo de CONTRATO disfrazado de fallo de RED, no determinista
// (depende de lo que decida el modelo) e imposible de perseguir desde ese mensaje.
//
// Y como en `test-llm-texto-respuesta.mjs`: los verificadores que usan el modelo de verdad
// (`verify-llm-disa-stock`, `verify-llm-migracion`) son lentos, cuestan dinero y fallan por motivos
// ajenos, así que su rojo SE TOLERA — y un rojo que se tolera no protege nada. Éste es lo contrario:
// determinista, offline y en milisegundos, con la respuesta de la API fabricada a mano.
//
// QUÉ NO TOCA: ninguna base de datos de negocio, ningún fixture, ninguna red (el `fetch` va inyectado
// con `fetchImpl`). No SIEMBRA NADA, así que la norma «lo que una prueba crea, la prueba lo borra» se
// cumple por construcción: no crea. (El import de `core/llm.js` abre `data/control.db` como efecto de
// módulo —lo hace el propio `core/control-db.js` al cargarse—, pero aquí no se escribe en ella: las
// respuestas fabricadas traen `usage` a cero, así que el contador de gasto no suma nada.)
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callClaude, toolUseBlocks, textFromResponse } from '../core/llm.js';
import { resultadosDeHerramientas, MAX_VUELTAS, MAX_HERRAMIENTAS_POR_MENSAJE,
         MSG_PRESUPUESTO_HERRAMIENTAS } from '../modules/disa/index.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

// Una respuesta de la API fabricada, con los bloques y el motivo de parada que le digamos.
const respuesta = (content, stop_reason = 'tool_use') => ({
  ok: true,
  json: async () => ({ id: 'msg_test', model: 'claude-sonnet-5', stop_reason, content, usage: { input_tokens: 0, output_tokens: 0 } }),
});
const THINKING = { type: 'thinking', thinking: '', signature: 'xxx' };
const TEXTO = (t) => ({ type: 'text', text: t });
const TOOL = (id, name = 'catalogo_informes', input = {}) => ({ type: 'tool_use', id, name, input });
const ids = (m) => (m.content || []).map(b => b.tool_use_id);

try {
  console.log('\n=== 1. toolUseBlocks: la lista COMPLETA de bloques, en orden, nunca solo el primero ===\n');
  {
    const dos = { content: [THINKING, TEXTO('voy a mirar dos cosas'), TOOL('A'), TOOL('B', 'componer_informe')] };
    const b = toolUseBlocks(dos);
    ok(b.length === 2 && b[0].id === 'A' && b[1].id === 'B',
      '[thinking, text, tool_use A, tool_use B] → [A, B] (longitud 2, en orden)', JSON.stringify(b.map(x => x.id)));
    ok(toolUseBlocks({ content: [TOOL('solo')] }).length === 1, 'un solo bloque → uno (el camino de hoy, intacto)');
    ok(toolUseBlocks({ content: [THINKING, TEXTO('hola')] }).length === 0, 'sin herramientas → []');
    ok(toolUseBlocks({ content: [] }).length === 0 && toolUseBlocks({}).length === 0 && toolUseBlocks(null).length === 0,
      'respuesta vacía / rara / null → [] sin lanzar');
    const sinId = toolUseBlocks({ content: [TOOL('A'), { type: 'tool_use', name: 'x', input: {} }] });
    ok(sinId.length === 1 && sinId[0].id === 'A',
      'un tool_use SIN id se descarta: no se puede contestar, así que tampoco se ejecuta');
  }

  console.log('\n=== 2. la forma que rompió: `.find(...)` coge una y el turno declara dos ===\n');
  {
    // Este fichero fabrica el patrón viejo A PROPÓSITO, para demostrar el fallo. Es el único sitio
    // donde está permitido (la guardia del bloque 6 se excluye a sí misma por eso).
    const turno = { content: [TOOL('A'), TOOL('B', 'componer_informe')] };
    const viejo = turno.content.find(b => b.type === 'tool_use');
    ok(viejo.id === 'A' && toolUseBlocks(turno).length === 2,
      '`.find(…)` devuelve SOLO A mientras el turno del asistente declara A y B');
    ok([{ type: 'tool_result', tool_use_id: viejo.id }].length !== turno.content.length,
      '…y contestar solo a A deja la petición malformada: 2 tool_use declarados, 1 tool_result. ESO es el 400');
  }

  console.log('\n=== 3. LA FORMA DE LA RESPUESTA: un tool_result por cada tool_use, mismo orden, mismos ids ===\n');
  for (const n of [1, 2, 3]) {
    const bloques = Array.from({ length: n }, (_, i) => TOOL('id_' + i, 'herramienta_' + i));
    const r = resultadosDeHerramientas(bloques, () => ({ filas: [] }));
    ok(r.mensaje.role === 'user', 'N=' + n + ': el mensaje es del rol `user`');
    ok(r.mensaje.content.length === n, 'N=' + n + ': ' + n + ' tool_use → ' + n + ' tool_result', 'salieron ' + r.mensaje.content.length);
    ok(r.mensaje.content.every(b => b.type === 'tool_result'), 'N=' + n + ': todos los bloques son tool_result');
    ok(JSON.stringify(ids(r.mensaje)) === JSON.stringify(bloques.map(b => b.id)),
      'N=' + n + ': los tool_use_id van EN EL MISMO ORDEN que los bloques', JSON.stringify(ids(r.mensaje)));
    const set = (a) => JSON.stringify([...a].sort());
    ok(set(ids(r.mensaje)) === set(bloques.map(b => b.id)),
      'N=' + n + ': el conjunto de ids del mensaje `user` es IDÉNTICO al del turno del asistente');
    ok(r.ejecutadas === n && r.traza.length === n && r.traza.every(t => t.estado === 'completada'),
      'N=' + n + ': la traza dice ' + n + ' completadas (y solo nombre + estado, nunca SQL ni argumentos)');
  }
  {
    const r = resultadosDeHerramientas([TOOL('dup'), TOOL('dup', 'otra')], () => ({ ok: true }));
    ok(r.mensaje.content.length === 1,
      'un tool_use_id repetido recibe UN solo resultado (dos con el mismo id es otro 400). Defensivo');
  }

  console.log('\n=== 4. AISLAMIENTO DEL ERROR: el fallo de una no se lleva por delante a las demás ===\n');
  {
    const r = resultadosDeHerramientas([TOOL('A'), TOOL('B', 'componer_informe')],
      (nombre) => nombre === 'componer_informe' ? { error: 'No tienes permiso para ver esos datos.' } : { filas: [1, 2, 3] });
    ok(r.mensaje.content.length === 2, 'siguen saliendo 2 tool_result');
    ok(!r.mensaje.content[0].is_error && /filas/.test(r.mensaje.content[0].content),
      'la PRIMERA conserva su resultado bueno (nada de «todo o nada»: aquí no se escribe, no hay nada que deshacer)');
    ok(r.mensaje.content[1].is_error === true && /permiso/.test(r.mensaje.content[1].content),
      'solo la segunda lleva `is_error: true`, con su frase legible para el modelo');
    ok(r.ejecutadas === 2 && r.rechazadas === 1 && r.traza[1].estado === 'rechazada',
      'la traza distingue completada de rechazada');
  }
  {
    const orden = [];
    const r = resultadosDeHerramientas([TOOL('A', 'primera'), TOOL('B', 'segunda')],
      (nombre) => { orden.push(nombre); return { ok: true }; });
    ok(r.mensaje.content.length === 2 && JSON.stringify(orden) === '["primera","segunda"]',
      'con dos bloques se ejecutan LOS DOS, en el orden de los bloques (un for síncrono, sin Promise.all)');

    console.log('  · (la traza de `[error]` que sale aquí debajo es de safeError, y es lo esperado)');
    const revienta = resultadosDeHerramientas([TOOL('A'), TOOL('B', 'buena')],
      (nombre) => { if (nombre !== 'buena') throw new Error('boom: no such column: cliente_id'); return { filas: [] }; });
    ok(revienta.mensaje.content.length === 2 && !revienta.mensaje.content[1].is_error,
      'una excepción en la primera NO impide que la segunda se ejecute y conserve su resultado');
    ok(revienta.mensaje.content[0].is_error === true,
      'un `ejecutar` que LANZA no propaga: sale un tool_result con is_error (patrón `seguro()` de informes.js)');
    ok(!/no such column/.test(revienta.mensaje.content[0].content),
      '…y el detalle técnico de la excepción no viaja en el tool_result (safeError)');
    ok(revienta.mensaje.content[0].tool_use_id === 'A',
      '…con su tool_use_id puesto: una excepción a mitad del lote dejaría el mensaje malformado');
  }

  console.log('\n=== 5. PRESUPUESTO: pasado el tope se rechaza CONTESTANDO, nunca callando ===\n');
  {
    let llamadas = 0;
    const r = resultadosDeHerramientas([TOOL('A'), TOOL('B'), TOOL('C')],
      () => { llamadas++; return { filas: [] }; }, { presupuesto: 1 });
    ok(r.mensaje.content.length === 3, 'con presupuesto 1 y 3 bloques salen 3 tool_result (los 3 se contestan)');
    ok(llamadas === 1, '`ejecutar` se llamó UNA vez', 'llamadas=' + llamadas);
    ok(r.ejecutadas === 1, 'r.ejecutadas === 1 (es lo que descuenta el bucle del presupuesto del mensaje)');
    ok(r.mensaje.content.slice(1).every(b => b.is_error === true && b.content.includes(MSG_PRESUPUESTO_HERRAMIENTAS)),
      'los 2 sobrantes traen MSG_PRESUPUESTO_HERRAMIENTAS con is_error: true');
    ok(r.traza.filter(t => t.estado === 'sin presupuesto').length === 2, 'la traza los marca «sin presupuesto»');
    const cero = resultadosDeHerramientas([TOOL('A')], () => ({ ok: true }), { presupuesto: 0 });
    ok(cero.mensaje.content.length === 1 && cero.ejecutadas === 0,
      'presupuesto 0 → se contesta igual, sin ejecutar nada (descartar sin contestar es volver al 400)');
    ok(MAX_VUELTAS === 5 && MAX_HERRAMIENTAS_POR_MENSAJE === 8,
      'el presupuesto es explícito y exportado: ' + MAX_VUELTAS + ' vueltas, ' + MAX_HERRAMIENTAS_POR_MENSAJE + ' herramientas por mensaje');
  }

  console.log('\n=== 6. DE PUNTA A PUNTA por callClaude, con la API fabricada (fetchImpl) ===\n');
  {
    const cuerpos = [];
    const fetchImpl = async (_url, opts) => {
      cuerpos.push(JSON.parse(opts.body));
      return cuerpos.length === 1
        ? respuesta([TEXTO('Déjame mirar dos cosas'), TOOL('tu_1', 'catalogo_informes'), TOOL('tu_2', 'componer_informe')])
        : respuesta([TEXTO('Aquí tienes tu informe de ventas.')], 'end_turn');
    };

    // El bucle del handler, con las MISMAS piezas que corre `/message`.
    let apiMessages = [{ role: 'user', content: 'compón un informe de ventas' }];
    let reply = '', vueltas = 0, gastadas = 0;
    while (vueltas < MAX_VUELTAS) {
      vueltas++;
      const data = await callClaude({
        model: 'claude-sonnet-5', max_tokens: 1024, apiKey: 'test-no-se-usa',
        messages: apiMessages, fetchImpl,
      });
      const bloques = toolUseBlocks(data);
      if (data.stop_reason !== 'tool_use' || bloques.length === 0) { reply = textFromResponse(data); break; }
      const r = resultadosDeHerramientas(bloques, (nombre) => ({ herramienta: nombre, filas: [] }),
        { presupuesto: Math.max(0, MAX_HERRAMIENTAS_POR_MENSAJE - gastadas) });
      gastadas += r.ejecutadas;
      apiMessages.push({ role: 'assistant', content: data.content });
      apiMessages.push(r.mensaje);
    }

    ok(cuerpos.length === 2, 'dos vueltas: el turno de herramientas y el de cierre', 'vueltas=' + cuerpos.length);
    ok(gastadas === 2, 'se ejecutaron LAS DOS herramientas (antes la segunda desaparecía sin traza)');
    ok(reply === 'Aquí tienes tu informe de ventas.', 'el bucle cierra con el texto del modelo', JSON.stringify(reply));

    // La invariante, medida sobre lo que DE VERDAD se le manda a la API en la segunda petición.
    const segunda = cuerpos[1].messages;
    const asistente = segunda[segunda.length - 2];
    const usuario = segunda[segunda.length - 1];
    const pedidos = asistente.content.filter(b => b.type === 'tool_use').map(b => b.id);
    const contestados = usuario.content.filter(b => b.type === 'tool_result').map(b => b.tool_use_id);
    ok(asistente.role === 'assistant' && usuario.role === 'user', 'el turno de herramientas va seguido de un mensaje `user`');
    ok(JSON.stringify(pedidos) === JSON.stringify(contestados),
      'LA PETICIÓN QUE SALE A LA API está emparejada: mismos ids, mismo orden ' + JSON.stringify(pedidos),
      'pedidos=' + JSON.stringify(pedidos) + ' contestados=' + JSON.stringify(contestados));
    ok(pedidos.length === 2 && contestados.length === 2,
      'con dos herramientas van dos tool_result: ESTE es el criterio que habría estado rojo el día del fallo');
    ok(reply.length > 0, 'y `reply` nunca sale vacía del bucle (la burbuja vacía con HTTP 200 del 15 ago)');
  }

  console.log('\n=== 7. GUARDIA: nadie vuelve a coger «la primera» herramienta con .find(...) ===\n');
  {
    // El bug no se arregla solo con el helper: se arregla si NADIE vuelve a escribir
    // `.find(b => b.type === 'tool_use')`. Este barrido es lo que habría puesto el commit en rojo.
    const PATRON = /\.find\s*\(\s*[^)]*type\s*===\s*['"]tool_use['"]/;
    const RAICES = ['modules', 'core', 'scripts'];
    const culpables = [];
    const recorrer = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) { recorrer(p); continue; }
        if (!/\.(js|mjs)$/.test(e.name)) continue;
        // Este mismo fichero fabrica el patrón a propósito (bloque 2), para demostrar el fallo.
        // Es el único sitio donde está permitido: si se vigilara a sí mismo, no podría probar nada.
        if (e.name === 'verify-disa-herramientas-paralelo.mjs') continue;
        const txt = readFileSync(p, 'utf-8');
        txt.split('\n').forEach((linea, i) => {
          // Solo CÓDIGO: los comentarios pueden (y deben) nombrar el patrón para explicar por qué
          // está prohibido, y la guardia no puede castigar la explicación.
          const t = linea.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          if (PATRON.test(linea)) culpables.push(p.replace(APP_DIR + '/', '') + ':' + (i + 1));
        });
      }
    };
    for (const r of RAICES) recorrer(join(APP_DIR, r));
    ok(culpables.length === 0,
      'ningún fichero de modules/, core/ ni scripts/ coge la primera herramienta con .find (se usa toolUseBlocks)',
      culpables.join(' · '));
  }
} catch (e) {
  fail++; console.error('\n  ✗ EXCEPCIÓN: ' + (e && e.stack || e));
}

console.log('\n──────────────────────────────');
console.log('  ' + pass + ' OK · ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
