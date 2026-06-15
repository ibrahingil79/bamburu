// Gate de MODELO REAL — voz de DISA sobre stock. Llama al modelo de verdad (callClaude,
// claude-sonnet-4-6, tool query_database) con un system prompt + contexto construidos a
// partir de las MISMAS piezas que inyecta el módulo (índices producto/almacén, motivos de
// ajuste de lista cerrada, valoración curada y el spec de acciones adjust_stock/transfer_stock).
// Verifica: identificación por nombre, consultas con dato real, y emisión de la acción correcta
// (confirm-first lo impone el módulo: aquí comprobamos que el modelo PROPONE la acción bien).
//   node scripts/verify-llm-disa-stock.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { recordMovement, ADJUST_REASONS } from '../modules/erp/stock.js';
import { activeWarehouses, inventoryValuation } from '../modules/erp/routes/warehouses.js';
import { callClaude, hasAnthropicKey } from '../core/llm.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✅ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ' — ' + extra : ''}`); }
};

if (!hasAnthropicKey()) { console.log('Sin ANTHROPIC_API_KEY (ni /etc/bamburu.env): no se puede correr el gate.'); process.exit(2); }

// ── BD de prueba: principal + Tienda; Widget 20 uds @5 (principal) + 6 uds @5 (Tienda) ──
const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db);
const A = db.prepare('SELECT id FROM warehouses WHERE is_default=1').get().id;
const B = Number(db.prepare("INSERT INTO warehouses (name,active,is_default) VALUES ('Tienda',1,0)").run().lastInsertRowid);
const P = Number(db.prepare("INSERT INTO products (name,slug,sku,price,type,status) VALUES ('Widget','widget','W-1',10,'physical','active')").run().lastInsertRowid);
recordMovement(db, { product_id: P, type: 'entrada', quantity: 20, unit_cost: 5, origin_type: 'purchase', warehouse_id: A });
recordMovement(db, { product_id: P, type: 'entrada', quantity: 6, unit_cost: 5, origin_type: 'purchase', warehouse_id: B });

// ── Contexto + system prompt: mismas piezas que inyecta el módulo ────────────
const sym = '€';
const arVals = ADJUST_REASONS.join(' | ');
const whs = activeWarehouses(db);
const val = inventoryValuation(db);
const prods = db.prepare("SELECT id,name,sku,stock,average_cost FROM products WHERE status='active' AND COALESCE(type,'physical')='physical' ORDER BY name").all();

const context = [
  'PRODUCTOS FISICOS ACTIVOS — id, nombre, [SKU], stock GLOBAL, coste medio (WAC):',
  prods.map(p => '#' + p.id + ' ' + p.name + (p.sku ? ' [' + p.sku + ']' : '') + ' · stock ' + p.stock + ' · coste medio ' + sym + Number(p.average_cost || 0).toFixed(2)).join('\n'),
  'Resuelve un nombre de producto a su id con esta lista antes de consultar u operar.',
  '',
  'ALMACENES ACTIVOS — id, nombre:',
  whs.map(w => '#' + w.id + ' ' + w.name + (w.is_default ? ' (principal)' : '')).join('\n'),
  '',
  'INVENTARIO — valoracion a coste (WAC global) [dato curado, usalo tal cual]:',
  'Valor total: ' + sym + val.total_value.toFixed(2) + ' (' + val.total_units + ' uds)',
  'Por almacen: ' + val.warehouses.map(w => w.name + ' ' + sym + w.value.toFixed(2) + ' (' + w.units + ' uds)').join(' · '),
].join('\n');

const systemPrompt = [
  'Eres DISA, asistente del ERP Bamburu. Hablas en espanol, directa y honesta. Puede modificar datos: SI (admin).',
  'Identifica producto y almacen por NOMBRE (usa los indices del contexto) antes de consultar u operar.',
  'Para EJECUTAR una accion, incluye al FINAL del mensaje el bloque [ACCION:{"type":"...","params":{...},"confirm":"..."}].',
  'Antes del bloque, explica en texto lo que vas a hacer. Una sola accion por mensaje.',
  '',
  'Inventario (ids en el contexto):',
  '- adjust_stock: {"product_id":0,"mode":"set|add|sub","value":0,"reason":"...","warehouse_id":0}',
  '  set=poner a X, add=sumar, sub=restar. "poner a N"/"ajusta a N" = mode:set value:N. warehouse_id opcional (vacio=principal).',
  '  reason OBLIGATORIO, EXACTAMENTE uno de: ' + arVals,
  '- transfer_stock: {"from_warehouse_id":0,"to_warehouse_id":0,"items":[{"product_id":0,"quantity":0}]}',
  '  Mueve stock de un almacen a otro. Origen != destino. NO cambia stock total ni coste medio.',
  'NO consultes el stock antes de ajustar o trasladar: el servicio valida la disponibilidad y rechaza si no llega.',
  'Propon la accion directamente con el bloque [ACCION:...] al final, sin query previa.',
  '',
  'Consultas (solo lectura): stock global y coste medio estan en PRODUCTOS FISICOS ACTIVOS; valoracion en INVENTARIO.',
  'Stock por almacen o historico: usa query_database (SELECT). Stock en un almacen = SUMA(quantity) de stock_movements por product_id y warehouse_id.',
  'No inventes datos. El stock minimo no se gestiona: si preguntan "bajo minimos", dilo.',
  '',
  '## CONTEXTO', context,
  '',
  '## SCHEMA (tablas principales)',
  'products: id, name, sku, stock, average_cost, type, status',
  'warehouses: id, name, active, is_default',
  'stock_movements: id, product_id, warehouse_id, type, quantity, unit_cost, created_at',
].join('\n');

const tools = [{
  name: 'query_database',
  description: 'Ejecuta SQL SELECT de solo lectura. Usala para stock por almacen, historico, etc.',
  input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
}];

// Bucle real de tool-use (como el módulo): hasta 4 vueltas, ejecutando el SELECT de verdad.
async function ask(userMsg) {
  let msgs = [{ role: 'user', content: userMsg }];
  let turns = 0, usedTool = false, lastSql = '';
  while (turns <= 4) {
    const data = await callClaude({ model: 'claude-sonnet-4-6', max_tokens: 1024, system: systemPrompt, messages: msgs, tools });
    if (data.stop_reason === 'tool_use') {
      const tu = data.content.find(b => b.type === 'tool_use');
      usedTool = true; lastSql = tu.input?.sql || '';
      let result; try { const rows = db.prepare(lastSql).all(); result = { rows, count: rows.length }; } catch (e) { result = { error: e.message }; }
      msgs.push({ role: 'assistant', content: data.content });
      msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) }] });
      turns++; continue;
    }
    const text = data.content?.find(b => b.type === 'text')?.text || '';
    return { text, usedTool, lastSql };
  }
  return { text: '', usedTool, lastSql };
}
// Parser con balanceo de llaves (mismo criterio que extractActionBlock del módulo).
function parseAction(reply) {
  const tag = reply.indexOf('[ACCION:'); if (tag === -1) return null;
  const open = reply.indexOf('{', tag); if (open === -1) return null;
  let depth = 0, inStr = false, esc = false, close = -1;
  for (let i = open; i < reply.length; i++) {
    const ch = reply[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { if (--depth === 0) { close = i; break; } }
  }
  if (close === -1) return null;
  try { return JSON.parse(reply.slice(open, close + 1)); } catch { return null; }
}

// ── Escenario 1: consulta de stock global ("¿cuánto me queda de X?") ────────
console.log('\n[1] "¿cuánto me queda de Widget?"');
{
  const { text } = await ask('¿Cuánto me queda de Widget?');
  console.log('  →', JSON.stringify(text.slice(0, 200)));
  check('menciona el stock global (26)', /\b26\b/.test(text));
  check('no propone accion (es consulta)', !parseAction(text));
}

// ── Escenario 2: valoración de un almacén ("valor del almacén Tienda") ──────
console.log('\n[2] "¿Cuál es el valor del almacén Tienda?"');
{
  const tiendaVal = inventoryValuation(db).warehouses.find(w => w.id === B).value; // 6×5 = 30
  const { text } = await ask('¿Cuál es el valor a coste del almacén Tienda?');
  console.log('  →', JSON.stringify(text.slice(0, 200)));
  check('menciona el valor curado de Tienda (' + tiendaVal + ')', new RegExp('\\b' + tiendaVal + '\\b').test(text));
}

// ── Escenario 3: traslado por voz ("haz un traslado de 10 de X a Tienda") ───
console.log('\n[3] "Haz un traslado de 10 de Widget al almacén Tienda"');
{
  const { text } = await ask('Haz un traslado de 10 unidades de Widget al almacén Tienda.');
  console.log('  →', JSON.stringify(text.slice(0, 260)));
  const a = parseAction(text);
  check('propone accion transfer_stock', a?.type === 'transfer_stock', a?.type || 'sin accion');
  if (a?.type === 'transfer_stock') {
    const pr = a.params || {};
    const items = pr.items || [{ product_id: pr.product_id, quantity: pr.quantity }];
    check('origen = principal (#' + A + ')', Number(pr.from_warehouse_id) === A, 'from=' + pr.from_warehouse_id);
    check('destino = Tienda (#' + B + ')', Number(pr.to_warehouse_id) === B, 'to=' + pr.to_warehouse_id);
    check('producto Widget (#' + P + ') x10', Number(items[0].product_id) === P && Number(items[0].quantity) === 10,
      'item=' + JSON.stringify(items[0]));
  }
}

// ── Escenario 4: ajuste por voz ("ajusta X a 5") ────────────────────────────
console.log('\n[4] "Ajusta el stock de Widget a 5 unidades"');
{
  const { text } = await ask('Ajusta el stock de Widget a 5 unidades, por un error de conteo.');
  console.log('  →', JSON.stringify(text.slice(0, 260)));
  const a = parseAction(text);
  check('propone accion adjust_stock', a?.type === 'adjust_stock', a?.type || 'sin accion');
  if (a?.type === 'adjust_stock') {
    const pr = a.params || {};
    check('producto Widget (#' + P + ')', Number(pr.product_id) === P, 'product_id=' + pr.product_id);
    check('mode=set value=5', pr.mode === 'set' && Number(pr.value) === 5, 'mode=' + pr.mode + ' value=' + pr.value);
    check('reason de la lista cerrada', ADJUST_REASONS.includes(pr.reason), 'reason=' + pr.reason);
  }
}

console.log(`\n===== GATE MODELO: ${ok} OK, ${fail} fallos =====`);
process.exit(fail ? 1 : 0);
