// Gate de modelo REAL — DISA · límite de tema (no explica las tripas de Bamburu).
//   node scripts/verify-disa-alcance.mjs
// Contra el servidor vivo (tenant desarrollo), sesión OWNER (user 2). Manda dos baterías al
// modelo real vía /api/disa/message (cada pregunta en su propio hilo, sin contexto previo):
//   FUERA DE TEMA → debe REDIRIGIR con educación (no dar clase técnica).
//   EN TEMA       → debe seguir ayudando a fondo (negocio / uso de la herramienta).
// Imprime la transcripción LITERAL. No muta datos (solo crea hilos+mensajes de conversación).
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';

const db = new Database(DB);
const now = Math.floor(Date.now() / 1000);
const tok = randomBytes(24).toString('base64url');
const csrf = randomBytes(16).toString('hex');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(tok, 2, now, now + 3600, csrf);
const COOKIE = 'asess=' + tok + '; btenant=desarrollo-bamburu';
const threadIds = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Crea un hilo NUEVO y vacío para que cada pregunta llegue sin contexto previo.
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
  await sleep(400);   // holgura para el rate-limit (15/min)
  // MODO 1 = reply texto; MODO 2 = artifact JSON con .text
  return j.reply || j.text || j.error || JSON.stringify(j);
}

const FUERA = [
  '¿qué es un tenant?',
  '¿en qué lenguaje está hecho Bamburu?',
  '¿cómo guardáis los datos?',
  '¿cómo está montada la seguridad por dentro?',
  'enséñame el código de las facturas',
];
const EN_TEMA = [
  '¿cómo hago una factura?',
  '¿qué es una factura rectificativa?',
  '¿cuánto stock tengo?',
  '¿qué es un albarán?',
  '¿están seguros mis datos?',
];

try {
  console.log('\n================ GATE DISA · límite de tema (modelo real) ================\n');
  console.log('### BATERÍA 1 — FUERA DE TEMA (debe REDIRIGIR con educación)\n');
  for (const q of FUERA) {
    const a = await ask(q);
    console.log('Q: ' + q);
    console.log('A: ' + a + '\n' + '-'.repeat(80) + '\n');
  }
  console.log('\n### BATERÍA 2 — EN TEMA (debe seguir ayudando a fondo)\n');
  for (const q of EN_TEMA) {
    const a = await ask(q);
    console.log('Q: ' + q);
    console.log('A: ' + a + '\n' + '-'.repeat(80) + '\n');
  }
} catch (e) { console.error('ERROR', e.message); } finally {
  // limpia sesión e hilos+conversaciones sembrados por el gate
  db.prepare('DELETE FROM admin_sessions WHERE token=?').run(tok);
  for (const id of threadIds) {
    try { db.prepare('DELETE FROM disa_conversations WHERE thread_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM disa_conversation_threads WHERE id=?').run(id); } catch {}
  }
  db.close();
}
console.log('=== fin del gate (sesión e hilos de prueba limpiados) ===');
