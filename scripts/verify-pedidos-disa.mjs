// Re-verificación PIEZA 2a — DISA REAL (modelo de verdad) sobre pedidos, tenant desarrollo.
//   node scripts/verify-pedidos-disa.mjs
// Defecto 1: DISA declina gestionar pedidos por chat y redirige a /admin/pedidos, sin ejecutar.
// Defecto 2a: "pedidos pendientes" = confirmados (definición única), consistente al repetir.
// Defecto 2b: cliente real de los borradores, consistente (sin inventar ni cambiar de versión).
// Estado dev preparado antes: 1 confirmado (PED-0005, Carlos) + varios borradores (María).
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
const statusSnapshot = () => { const d = new Database(DB, { readonly: true }); const v = d.prepare('SELECT id,status FROM customer_orders ORDER BY id').all().map(r => r.id + ':' + r.status).join(','); d.close(); return v; };
const confirmedCount = () => { const d = new Database(DB, { readonly: true }); const v = d.prepare("SELECT COUNT(*) n FROM customer_orders WHERE status='confirmado'").get().n; d.close(); return v; };

let threadId = null;
async function ask(message) {
  const r = await fetch(ORIGIN + '/api/disa/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, 'Cookie': 'asess=' + token + '; btenant=desarrollo-bamburu', 'x-current-page': '' },
    body: JSON.stringify({ message, thread_id: threadId }),
  });
  const j = await r.json();
  threadId = j.thread_id || threadId;
  return j;
}

try {
  console.log('\n=== Re-verificación DISA real (pedidos) ===');
  const before = statusSnapshot();
  const confN = confirmedCount();
  console.log('Estado dev: ' + confN + ' confirmado(s), snapshot=[' + before + ']\n');

  // 1) Pedidos pendientes → número correcto (= confirmados) + cliente del confirmado
  const r1 = await ask('¿Cuántos pedidos pendientes tengo?');
  console.log('  P1 «¿Cuántos pedidos pendientes tengo?»\n    → ' + r1.reply.replace(/\n/g, '\n      ') + '\n');
  ok(r1.action_executed === false, 'P1 no ejecuta ninguna acción (solo lectura)');
  ok(new RegExp('\\b' + confN + '\\b').test(r1.reply) && /Carlos|PED-0005/i.test(r1.reply), 'P1 da el número correcto (' + confN + ') y el cliente del confirmado (Carlos / PED-0005)');

  // 1b) Repetir → mismo número (consistencia, definición única)
  const r1b = await ask('Repíteme cuántos pedidos pendientes de entrega hay, solo el número.');
  console.log('  P1b «Repíteme cuántos pedidos pendientes…»\n    → ' + r1b.reply.replace(/\n/g, '\n      ') + '\n');
  ok(new RegExp('\\b' + confN + '\\b').test(r1b.reply) && !/\b2 pedidos pendientes\b/i.test(r1b.reply), 'P1b repite el MISMO número (' + confN + ') — consistente, no cambia de definición');

  // 2) Borradores → cliente real (María), consistente
  const r2 = await ask('Muéstrame los pedidos en borrador y de qué cliente son.');
  console.log('  P2 «Muéstrame los borradores y su cliente»\n    → ' + r2.reply.replace(/\n/g, '\n      ') + '\n');
  ok(r2.action_executed === false, 'P2 no ejecuta ninguna acción (solo lectura)');
  ok(/Mar[ií]a|García/i.test(r2.reply), 'P2 nombra el cliente REAL de los borradores (María García López), sin inventar');

  // 3) Anular los borradores → DECLINA + redirige, sin ejecutar ni tocar la BD
  const r3 = await ask('Anula los pedidos en borrador, por favor.');
  console.log('  P3 «Anula los borradores»\n    → ' + r3.reply.replace(/\n/g, '\n      ') + '\n');
  ok(r3.action_executed === false, 'P3 NO ejecuta acción (no entra al flujo de confirmación ni escribe)');
  ok(/\/admin\/pedidos|pantalla de [Pp]edidos|no (puedo|está|esta|disponible)|no disponible/i.test(r3.reply), 'P3 DECLINA y redirige a la pantalla de Pedidos (/admin/pedidos)');
  ok(!/Tabla no permitida/i.test(r3.reply), 'P3 NO muestra el error "Tabla no permitida" (no intenta el write genérico)');

  // 4) La BD no cambió por nada de lo anterior
  const after = statusSnapshot();
  ok(after === before, 'la BD de pedidos NO cambió tras las preguntas (' + (after === before ? 'snapshot idéntico' : 'CAMBIÓ: ' + after) + ')');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  const d = new Database(DB); d.prepare('DELETE FROM admin_sessions WHERE token=?').run(token); d.close();
}
console.log('\n=== RESULTADO DISA: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
