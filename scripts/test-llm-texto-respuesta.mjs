// Test de LÓGICA — CÓMO SE SACA EL TEXTO DE UNA RESPUESTA DE LA IA. Sin red, sin clave, sin gasto.
//   node scripts/test-llm-texto-respuesta.mjs
//
// POR QUÉ EXISTE ESTE FICHERO — LA CAÍDA DEL 15 AGO 2026.
// El alta de negocios se cayó en producción: el usuario escribía «peluqería» y DISA no contestaba
// nunca. No había error en el log, ni traza, ni 500: la ruta devolvía **HTTP 200 con la respuesta
// VACÍA**. La causa: el modelo empezó a devolver un bloque `thinking` DELANTE del texto, y el código
// leía `data.content[0].text` — que pasó a ser `undefined`. Un cambio de FORMA en la respuesta, sin
// un solo cambio en nuestro código.
//
// LO QUE FALLÓ NO FUE QUE NO HUBIERA PRUEBAS: `gate-registro-alta` y `verify-llm-migracion` §2 estaban
// EN ROJO y avisaban. Fallaron por otra cosa: **las dos necesitan el modelo de verdad**, así que son
// lentas, cuestan dinero y fallan por mil motivos ajenos (cuota, red, humor del modelo). Un rojo así se
// tolera y se cataloga como «previo». Esta prueba es lo contrario: **determinista, offline y en
// milisegundos**, con la respuesta de la API fabricada a mano. Si vuelve a pasar, esto se pone rojo
// solo, sin excusa posible y sin depender de nadie.
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callClaude, textFromResponse } from '../core/llm.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m + (extra ? ' — ' + extra : '')); } };

// Una respuesta de la API fabricada, con los bloques que le digamos.
const respuesta = (content) => ({
  ok: true,
  json: async () => ({ id: 'msg_test', model: 'claude-sonnet-5', stop_reason: 'end_turn', content, usage: { input_tokens: 0, output_tokens: 0 } }),
});
const BLOQUE_THINKING = { type: 'thinking', thinking: '', signature: 'xxx' };
const BLOQUE_TEXTO = (t) => ({ type: 'text', text: t });
const BLOQUE_TOOL = { type: 'tool_use', id: 'tu_1', name: 'query_database', input: {} };

try {
  console.log('\n=== 1. textFromResponse: el texto se saca por TIPO, no por posición ===\n');
  ok(textFromResponse({ content: [BLOQUE_TEXTO('hola')] }) === 'hola',
    'solo texto → lo devuelve');
  ok(textFromResponse({ content: [BLOQUE_THINKING, BLOQUE_TEXTO('hola')] }) === 'hola',
    '**thinking DELANTE del texto → lo devuelve igual (ESTA es la caída del 15 ago)**');
  ok(textFromResponse({ content: [BLOQUE_TOOL, BLOQUE_TEXTO('hola')] }) === 'hola',
    'tool_use delante del texto → lo devuelve igual');
  ok(textFromResponse({ content: [BLOQUE_THINKING, BLOQUE_TOOL, BLOQUE_TEXTO('hola')] }) === 'hola',
    'thinking + tool_use delante → lo devuelve igual');
  ok(textFromResponse({ content: [BLOQUE_TEXTO('uno'), BLOQUE_TEXTO('dos')] }) === 'uno\ndos',
    'varios bloques de texto → se concatenan (no se pierde el segundo)');
  ok(textFromResponse({ content: [BLOQUE_THINKING] }) === '',
    'sin bloque de texto → cadena vacía, no undefined');
  ok(textFromResponse({ content: [] }) === '' && textFromResponse({}) === '' && textFromResponse(null) === '',
    'respuesta vacía / rara / null → cadena vacía, nunca revienta');

  console.log('\n=== 2. la forma que rompió: content[0].text sobre una respuesta con thinking ===\n');
  {
    const conThinking = { content: [BLOQUE_THINKING, BLOQUE_TEXTO('¡Qué bien, una peluquería!')] };
    ok(conThinking.content[0].text === undefined,
      'content[0].text es undefined cuando el primer bloque es `thinking`');
    ok((conThinking.content?.[0]?.text || '') === '',
      '…y el `|| \'\'` lo convierte en respuesta VACÍA con HTTP 200: sin error, sin log, sin nada en pantalla');
    ok(textFromResponse(conThinking) === '¡Qué bien, una peluquería!',
      'el helper sí saca el texto de esa MISMA respuesta');
  }

  console.log('\n=== 3. de punta a punta por callClaude, con la API fabricada ===\n');
  {
    const data = await callClaude({
      model: 'claude-sonnet-5', max_tokens: 100, apiKey: 'test-no-se-usa',
      messages: [{ role: 'user', content: 'peluqería' }],
      fetchImpl: async () => respuesta([BLOQUE_THINKING, BLOQUE_TEXTO('¿Y cómo se llama tu peluquería?')]),
    });
    ok(textFromResponse(data) === '¿Y cómo se llama tu peluquería?',
      'callClaude + textFromResponse devuelven el texto aunque el modelo mande `thinking` primero');
    ok((data.content?.[0]?.text || '').length === 0,
      'y por el camino viejo esa misma llamada habría devuelto vacío (la caída, reproducida)');
  }

  console.log('\n=== 4. GUARDIA: nadie vuelve a leer el texto por posición ===\n');
  {
    // El bug no se arregla solo con el helper: se arregla si NADIE vuelve a escribir content[0].text.
    // Este barrido es lo que habría puesto el commit en rojo el día que se escribió.
    const PATRON = /content\s*\??\s*\.?\s*\[\s*0\s*\]\s*\??\s*\.\s*text/;
    const RAICES = ['modules', 'core', 'scripts'];
    const culpables = [];
    const recorrer = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) { recorrer(p); continue; }
        if (!/\.(js|mjs)$/.test(e.name)) continue;
        // Este mismo fichero fabrica y examina `content[0].text` a propósito, para demostrar el fallo.
        // Es el único sitio donde el patrón está permitido: si se vigilara a sí mismo, no podría probar nada.
        if (e.name === 'test-llm-texto-respuesta.mjs') continue;
        const txt = readFileSync(p, 'utf-8');
        txt.split('\n').forEach((linea, i) => {
          // Solo CÓDIGO: los comentarios pueden (y deben) nombrar el patrón para explicar por qué está
          // prohibido — este mismo fichero lo hace, y la guardia no puede castigar la explicación.
          const t = linea.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          if (PATRON.test(linea)) culpables.push(p.replace(APP_DIR + '/', '') + ':' + (i + 1));
        });
      }
    };
    for (const r of RAICES) recorrer(join(APP_DIR, r));
    ok(culpables.length === 0,
      'ningún fichero lee `content[0].text` (se usa textFromResponse en todos)',
      culpables.join(' · '));
  }
} catch (e) {
  fail++; console.error('\n  ✗ EXCEPCIÓN: ' + (e && e.stack || e));
}

console.log('\n──────────────────────────────');
console.log('  ' + pass + ' OK · ' + fail + ' fallos');
process.exit(fail ? 1 : 0);
