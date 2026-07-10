// Gate de la RETIRADA de las acciones de pedido de DISA (2026-07-10).
//
// DISA tenía cinco acciones que escribían contra el clúster de ventas viejo —`sales_orders`,
// `sales_items`, `order_status_history`—, las tres ARCHIVADAS por D1. Cualquier intento reventaba
// con "no such table". D1 las había neutralizado con una guarda que respondía "en migración", pero
// dejó los `case` y su declaración en el prompt: DISA seguía anunciando una función que no existía.
// Ahora se retiran del todo.
//
// El pedido VIVO (documento PED-NNNN, `customer_orders`, cadena presupuesto→pedido→albarán→factura)
// NO se toca: DISA lo LEE y redirige a /admin/pedidos, como antes.
//
// `executeAction` es una función LOCAL del módulo, solo alcanzable por el bucle del LLM, así que no
// se puede invocar desde un test. Lo que sí se garantiza es lo estructural: que las acciones no
// existen, no se anuncian, no tienen permisos, y que ninguna sentencia toca las tablas archivadas.
//   node scripts/verify-disa-sin-pedidos.mjs
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const RETIRADAS = ['create_order', 'edit_order', 'update_order_status', 'cancel_order', 'create_invoice_from_order'];
const ARCHIVADAS = ['sales_orders', 'sales_items', 'order_status_history'];

const bruto = readFileSync('modules/disa/index.js', 'utf8');
// Solo CÓDIGO: los comentarios pueden (y deben) seguir explicando qué se retiró y por qué.
const codigo = bruto.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

console.log('\n[1] Las cinco acciones ya no existen en el código');
for (const a of RETIRADAS) {
  ok(!codigo.includes(`case '${a}'`), `no queda el case '${a}'`);
  ok(!new RegExp(`'${a}'`).test(codigo), `'${a}' no aparece en ninguna lista de acciones ni permiso`);
}

console.log('\n[2] Ya no se anuncian al modelo en el prompt');
for (const a of RETIRADAS) ok(!codigo.includes(`'- ${a}:`), `el prompt no declara '- ${a}:'`);
ok(/NO gestionas PEDIDOS ni ALBARANES por chat/.test(codigo), 'el prompt dice explícitamente que no gestiona pedidos por chat');
ok(/redirige a \/admin\/pedidos/.test(codigo), 'y redirige a la pantalla de Pedidos');
ok(!/en migración/.test(codigo), 'ya no queda la respuesta "en migración" de D1 (la guarda se fue con las acciones)');

console.log('\n[3] Ninguna sentencia de DISA toca las tablas archivadas');
for (const t of ARCHIVADAS) {
  const tocada = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM|FROM)\\s+${t}\\b`).test(codigo);
  ok(!tocada, `ninguna sentencia SQL sobre '${t}'`);
}
ok(!/import\s*\{[^}]*generateInvoice/.test(codigo), 'ya no se importa generateInvoice (era el puente pedido-viejo→factura)');

console.log('\n[4] Lo que DISA SÍ debe seguir haciendo, sigue');
for (const a of ['anular_invoice', 'create_rectificativa', 'transfer_stock', 'adjust_stock', 'create_client', 'dictar_compra']) {
  ok(codigo.includes(`case '${a}'`) || codigo.includes(`'${a}'`), `sigue existiendo la acción '${a}'`);
}

console.log('\n[5] El flujo humano de pedidos no se ha tocado');
// La vía genérica nunca pudo escribir los pedidos vivos, y sigue sin poder.
const writable = codigo.slice(codigo.indexOf('WRITABLE_TABLES = new Set(['), codigo.indexOf('WRITABLE_TABLES = new Set([') + 600);
ok(!/'customer_orders'/.test(writable) && !/'customer_order_items'/.test(writable),
  'customer_orders / customer_order_items siguen fuera de WRITABLE_TABLES (DISA no los escribe)');
ok(/customer_orders:\s*'pedidos\.read'/.test(codigo), 'DISA sigue pudiendo LEER los pedidos vivos (permiso pedidos.read)');
ok(/GESTION DE PEDIDOS POR CHAT: NO disponible/.test(codigo), 'sigue en pie la guarda del documento Pedido del Pilar 4');

console.log('\n[6] El módulo carga (nada quedó colgando)');
try { await import('../modules/disa/index.js'); ok(true, 'modules/disa/index.js importa sin errores'); }
catch (e) { ok(false, 'modules/disa/index.js NO carga: ' + e.message); }

console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
process.exit(fail ? 1 : 0);
