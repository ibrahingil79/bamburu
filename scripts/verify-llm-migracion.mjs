// Prueba REAL (no simulada) de las 3 llamadas LLM migradas a core/llm.js.
// Ejercita el camino migrado (callClaude → modelo de verdad) con la config EXACTA
// (modelo, max_tokens, system, tools) de cada sitio: store builder, registro y DISA.
import { callClaude, textFromResponse } from '../core/llm.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✅ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ' — ' + extra : ''}`); }
};

// ── 1) STORE BUILDER (/store-message): claude-haiku-4-5-20251001, max_tokens 800 ──
console.log('\n[1] Store builder — haiku, max_tokens 800');
{
  const system = [
    'Eres el constructor web de Bamburu. Ayudas a crear y personalizar tiendas online.',
    'Temas: minimal_light, minimal_dark, nordic_forest, bold_tech, vintage_warm.',
    'Cuando el usuario pide un cambio, incluye [ACCION:{...}] AL FINAL de tu respuesta.',
    '[ACCION:{"type":"update_store_theme","params":{"theme":"nordic_forest"}}]',
  ].join('\n');
  const data = await callClaude({
    model: 'claude-haiku-4-5-20251001', max_tokens: 800, system,
    messages: [{ role: 'user', content: 'Cambia el tema de mi tienda a nordic forest, por favor.' }],
  });
  const raw = textFromResponse(data);   // por TIPO de bloque, nunca por posición (ver test-llm-texto-respuesta)
  console.log('  modelo devuelto:', data.model);
  console.log('  texto:', JSON.stringify(raw.slice(0, 220)));
  check('responde texto no vacío', raw.length > 0);
  check('incluye bloque [ACCION:...] parseable', /\[ACCION:(\{[\s\S]*?\})\]/.test(raw),
    (raw.match(/\[ACCION:(\{[\s\S]*?\})\]/) || [])[1] || 'sin acción');
}

// ── 2) REGISTRO (onboarding): claude-sonnet-5, max_tokens 1024 ──
console.log('\n[2] Registro/onboarding — sonnet, max_tokens 1024');
{
  const system = [
    'Eres DISA, el asistente de bienvenida de Bamburu.',
    'Recoge de forma conversacional: nombre del negocio, sector, país, propietario, email, contraseña.',
    'Habla en español, cercano. Haz las preguntas de una en una.',
  ].join('\n');
  const data = await callClaude({
    model: 'claude-sonnet-5', max_tokens: 1024, system,
    messages: [{ role: 'user', content: 'Hola, quiero registrar mi negocio. Se llama Fontanería Gómez.' }],
  });
  const reply = textFromResponse(data);   // por TIPO de bloque, nunca por posición (ver test-llm-texto-respuesta)
  console.log('  modelo devuelto:', data.model);
  console.log('  reply:', JSON.stringify(reply.slice(0, 220)));
  check('responde texto conversacional no vacío', reply.length > 20);
}

// ── 3) DISA asistente (/message): claude-sonnet-5, max_tokens 1024, tools (query_database) ──
console.log('\n[3] DISA asistente — sonnet, max_tokens 1024, tool query_database (bucle real)');
{
  const system = 'Eres DISA, asistente de gestión de Bamburu. Usa query_database para consultar datos del negocio cuando haga falta. Responde en español.';
  const tools = [{
    name: 'query_database',
    description: 'Ejecuta una consulta SQL SELECT de solo lectura para obtener datos del negocio.',
    input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
  }];
  const apiMessages = [{ role: 'user', content: '¿Cuántos clientes tengo en total? Usa la tabla clients.' }];

  // Primera vuelta: esperamos stop_reason=tool_use (el modelo pide la query)
  const first = await callClaude({
    model: 'claude-sonnet-5', max_tokens: 1024, system, messages: apiMessages, tools,
  });
  console.log('  modelo devuelto:', first.model, '| stop_reason:', first.stop_reason);
  const toolUse = (first.content || []).find(b => b.type === 'tool_use');
  check('primera vuelta usa la tool (tool_use)', first.stop_reason === 'tool_use' && !!toolUse,
    toolUse ? 'sql=' + JSON.stringify(toolUse.input?.sql) : 'sin tool_use');

  // Segunda vuelta: devolvemos un tool_result (simulamos el dato de la BD) y cerramos
  if (toolUse) {
    apiMessages.push({ role: 'assistant', content: first.content });
    apiMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ rows: [{ total: 7 }], count: 1 }) }] });
    const second = await callClaude({
      model: 'claude-sonnet-5', max_tokens: 1024, system, messages: apiMessages, tools,
    });
    const finalText = (second.content || []).find(b => b.type === 'text')?.text || '';
    console.log('  respuesta final:', JSON.stringify(finalText.slice(0, 220)));
    check('cierra el bucle con respuesta de texto', second.stop_reason !== 'tool_use' && finalText.length > 0);
    check('la respuesta menciona el dato devuelto (7)', /\b7\b|siete/i.test(finalText));
  }
}

console.log(`\n===== RESULTADO: ${ok} OK, ${fail} fallos =====`);
process.exit(fail ? 1 : 0);
