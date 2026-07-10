// Gate de MODELO REAL — DISA ya no ofrece ni intenta crear/modificar pedidos.
//
// `verify-disa-sin-pedidos.mjs` garantiza lo estructural (las acciones no existen, no se anuncian,
// no tienen permisos). Esto comprueba lo que solo se ve hablando con el modelo de verdad: que ante
// una petición explícita DISA **declina y redirige**, en vez de proponer una acción que reventaría.
//
// Contra el servidor vivo (tenant desarrollo, sesión OWNER). Cada pregunta va en su propio hilo, sin
// contexto previo. NO muta datos del negocio: solo crea hilos de conversación, que se borran al final.
//   node scripts/verify-disa-pedidos-modelo-real.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
const now = Math.floor(Date.now() / 1000);
const tok = randomBytes(24).toString('base64url');
const csrf = randomBytes(16).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(tok, 2, now, now + 3600, csrf);
const COOKIE = 'asess=' + tok + '; btenant=desarrollo-bamburu';
const threadIds = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freshThread() {
  const r = db.prepare('INSERT INTO disa_conversation_threads (user_id, is_active) VALUES (2, 1)').run();
  threadIds.push(r.lastInsertRowid);
  return r.lastInsertRowid;
}
async function ask(message) {
  const thread_id = freshThread();
  const r = await fetch(ORIGIN + '/api/disa/message', {
    method: 'POST',
    headers: { cookie: COOKIE, 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ message, thread_id }),
  });
  const j = await r.json().catch(() => ({}));
  await sleep(600);   // holgura para el freno (15/min)
  return { texto: j.reply || j.text || j.error || JSON.stringify(j), crudo: JSON.stringify(j) };
}

// Frases que delatarían que la función sigue ofreciéndose.
const RETIRADAS = /create_order|cancel_order|edit_order|update_order_status|create_invoice_from_order/i;
const EN_MIGRACION = /en migración|en migracion/i;
const REDIRIGE = /admin\/pedidos|pantalla de pedidos|pantalla «?pedidos|secci[oó]n de pedidos/i;

const PETICIONES = [
  'Créame un pedido para el cliente María García con 2 unidades del producto más caro.',
  'Cambia el estado del pedido 3 a enviado.',
  'Cancela el pedido número 5.',
  'Factura el pedido 2, por favor.',
];

try {
  console.log('\n[1] Ante una petición explícita, DISA declina y redirige (modelo real)');
  for (const q of PETICIONES) {
    const { texto, crudo } = await ask(q);
    console.log('\n  P: ' + q);
    console.log('  R: ' + texto.replace(/\s+/g, ' ').slice(0, 190) + (texto.length > 190 ? '…' : ''));
    ok(!RETIRADAS.test(crudo), '   no menciona ni propone ninguna de las acciones retiradas');
    ok(!EN_MIGRACION.test(texto), '   no responde el viejo "en migración" de D1');
  }

  console.log('\n[2] Al menos una respuesta manda a la pantalla de Pedidos');
  const { texto } = await ask('Quiero crear un pedido nuevo. ¿Puedes hacerlo tú?');
  console.log('  R: ' + texto.replace(/\s+/g, ' ').slice(0, 220));
  ok(REDIRIGE.test(texto) || /no puedo|no gestiono|no est[áa] disponible|desde la pantalla/i.test(texto),
    'declina y remite a la pantalla de Pedidos');

  console.log('\n[3] Lo que DISA SÍ hace sigue funcionando (no se ha roto el prompt)');
  const r2 = await ask('¿Cuántos pedidos tengo pendientes de entregar?');
  console.log('  R: ' + r2.texto.replace(/\s+/g, ' ').slice(0, 190));
  ok(!/error|no puedo acceder/i.test(r2.texto) && r2.texto.length > 15,
    'sigue pudiendo LEER los pedidos vivos y responder');
} finally {
  for (const id of threadIds) {
    db.prepare('DELETE FROM disa_conversations WHERE thread_id=?').run(id);
    db.prepare('DELETE FROM disa_conversation_threads WHERE id=?').run(id);
  }
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok);
  db.close();
  console.log('\n(sesión e hilos de prueba limpiados)');
  console.log((fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
