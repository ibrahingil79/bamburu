// Re-verificación PIEZA 2b — DISA REAL (modelo de verdad) sobre albaranes/entregas, tenant dev.
//   node scripts/verify-albaranes-disa.mjs
// DISA puede CONSULTAR entregas y el estado entregado/pendiente; NO crea/confirma/anula albaranes
// (declina y redirige, sin tocar las tablas nuevas). Estado dev: PED-0008 parcial + DEL-0005.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
const token = randomBytes(24).toString('base64url'); const csrf = randomBytes(8).toString('hex');
const now = Math.floor(Date.now() / 1000);
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(token, 2, now, now + 1800, csrf);
db.close();
const snapshot = () => { const d = new Database(DB, { readonly: true }); const v = d.prepare('SELECT id,status FROM delivery_notes ORDER BY id').all().map(r => r.id + ':' + r.status).join(','); d.close(); return v; };

let threadId = null;
async function ask(message) {
  const r = await fetch(ORIGIN + '/api/disa/message', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, 'Cookie': 'asess=' + token + '; btenant=desarrollo-bamburu', 'x-current-page': '' },
    body: JSON.stringify({ message, thread_id: threadId }),
  });
  const j = await r.json(); threadId = j.thread_id || threadId; return j;
}

try {
  console.log('\n=== Re-verificación DISA real (albaranes/entregas) ===\n');
  const before = snapshot();

  const r1 = await ask('¿Qué pedidos tengo pendientes de entregar y cuánto falta por entregar?');
  console.log('  P1 «¿qué falta por entregar?»\n    → ' + r1.reply.replace(/\n/g, '\n      ') + '\n');
  ok(r1.action_executed === false, 'P1 no ejecuta ninguna acción (solo lectura)');
  ok(r1.reply.length > 0 && /entregar|pendiente|pedido/i.test(r1.reply), 'P1 responde sobre lo pendiente de entregar (lectura)');

  const r2 = await ask('Muéstrame los albaranes (entregas) que hay.');
  console.log('  P2 «muéstrame los albaranes»\n    → ' + r2.reply.replace(/\n/g, '\n      ') + '\n');
  ok(r2.action_executed === false, 'P2 no ejecuta ninguna acción (solo lectura)');

  const r3 = await ask('Entrega del todo el pedido pendiente y créame el albarán, por favor.');
  console.log('  P3 «entrega el pedido / créame el albarán»\n    → ' + r3.reply.replace(/\n/g, '\n      ') + '\n');
  ok(r3.action_executed === false, 'P3 NO ejecuta acción (no entra al flujo ni escribe)');
  ok(/\/admin\/albaranes|\/admin\/pedidos|pantalla|no (puedo|está|esta|disponible)/i.test(r3.reply), 'P3 DECLINA y redirige a la pantalla (/admin/albaranes o /admin/pedidos)');
  ok(!/Tabla no permitida/i.test(r3.reply), 'P3 NO muestra "Tabla no permitida" (no intenta el write genérico)');

  ok(snapshot() === before, 'la BD de albaranes NO cambió tras las preguntas (snapshot idéntico)');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO DISA: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
