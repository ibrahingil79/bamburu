// Verificación D5 — DISA create_product debe EXIGIR banda de IVA (cero default silencioso General/21).
// CON MODELO REAL contra el tenant de desarrollo. Tres escenarios + regresión API + prueba del
// camino genérico (insert_record→createProductSvc) por unidad de servicio + grep.
//
//   node scripts/verify-d5-create-product.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createProductSvc } from '../modules/erp/routes/products.js';

const DB_PATH = 'data/tenants/desarrollo-bamburu.db';
const HOST = 'desarrollo-bamburu.localhost';
const ORIGIN = 'http://127.0.0.1:3000';
const MARK = 'ZZTEST-D5-' + Date.now();

const db = new Database(DB_PATH);
const now = Math.floor(Date.now() / 1000);
const token = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, 2, now, now + 3600, csrf);   // user 2 = owner (ibrahingil@gmail.com)

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

async function send(message, thread_id) {
  const res = await fetch(ORIGIN + '/api/disa/message', {
    method: 'POST',
    headers: { 'Host': HOST, 'Content-Type': 'application/json', 'x-csrf-token': csrf, 'Cookie': 'asess=' + token + '; btenant=desarrollo-bamburu' },
    body: JSON.stringify({ message, ...(thread_id ? { thread_id } : {}) }),
  });
  const j = await res.json();
  return j;
}
function newThread() { db.prepare('UPDATE disa_conversation_threads SET is_active=0 WHERE user_id=2').run(); }
function productsNamed(like) {
  return db.prepare("SELECT id,name,tax_band,tax_rate,status FROM products WHERE name LIKE ?").all('%' + like + '%');
}

console.log('\n=== D5 · DISA create_product — VERIFICACIÓN CON MODELO REAL ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// (a) SIN decir el IVA → DISA debe EXIGIR la banda, NO crear con 21 silencioso.
console.log('(a) Pido crear producto SIN decir el IVA:');
newThread();
let t;
{
  const name = MARK + '-Vela';
  const r1 = await send('Crea un producto nuevo en el catálogo: "' + name + '", precio 12 euros, físico.');
  t = r1.thread_id;
  console.log('  USER → Crea "' + name + '", 12€, físico (sin IVA).');
  console.log('  DISA → ' + r1.reply.replace(/\n/g, '\n         '));
  const asksBand = /banda|iva|tipo de impuesto|impuesto/i.test(r1.reply);
  ok(asksBand, '(a) DISA pide la banda de IVA en vez de asumirla');
  ok(r1.action_executed === false, '(a) no ejecuta creación en el primer turno');
  // Empuje: intento confirmar "sí" sin haber dado banda → no debe colar General/21.
  const r2 = await send('Sí, créalo.', t);
  console.log('  USER → "Sí, créalo." (sin haber dado la banda)');
  console.log('  DISA → ' + r2.reply.replace(/\n/g, '\n         '));
  const created = productsNamed(name);
  ok(created.length === 0, '(a) NO se creó ningún producto sin banda elegida (cero default 21). Filas=' + created.length +
     (created.length ? ' → ' + JSON.stringify(created) : ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// (b) IVA que mapea 1:1 a una banda (10% → reducido) → se crea con ESA banda.
console.log('\n(b) Pido crear producto diciendo IVA 10% (mapea 1:1 → reducido):');
newThread();
{
  const name = MARK + '-Camiseta';
  const r1 = await send('Crea un producto: "' + name + '", precio 15 euros, físico, con IVA del 10%.');
  const tb = r1.thread_id;
  console.log('  USER → Crea "' + name + '", 15€, IVA 10%.');
  console.log('  DISA → ' + r1.reply.replace(/\n/g, '\n         '));
  let createdRow = productsNamed(name);
  if (createdRow.length === 0 && !r1.action_executed) {
    const r2 = await send('Sí, confirmo.', tb);
    console.log('  USER → "Sí, confirmo."');
    console.log('  DISA → ' + r2.reply.replace(/\n/g, '\n         '));
    createdRow = productsNamed(name);
  }
  ok(createdRow.length === 1, '(b) producto creado (1 fila)');
  if (createdRow.length === 1) {
    ok(createdRow[0].tax_band === 'reducido' && Number(createdRow[0].tax_rate) === 10,
       '(b) banda=reducido y tasa=10% (mapeo 1:1 respetado). Fila=' + JSON.stringify(createdRow[0]));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (c) IVA AMBIGUO / "no lo sé" → DISA NO debe adivinar.
console.log('\n(c) Pido crear producto con IVA ambiguo ("no estoy seguro, ponle el normal o algo"):');
newThread();
{
  const name = MARK + '-Ambiguo';
  const r1 = await send('Crea un producto "' + name + '", 30 euros. El IVA no lo tengo claro, ponle el que sea.');
  const tc = r1.thread_id;
  console.log('  USER → Crea "' + name + '", 30€, "el IVA el que sea".');
  console.log('  DISA → ' + r1.reply.replace(/\n/g, '\n         '));
  const asksBand = /banda|iva|impuesto|general|reducido|superreducido|exento/i.test(r1.reply);
  const created = productsNamed(name);
  ok(asksBand, '(c) DISA pide que se concrete la banda en vez de inventarla');
  ok(created.length === 0, '(c) NO se creó producto con banda adivinada. Filas=' + created.length +
     (created.length ? ' → ' + JSON.stringify(created) : ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMINO GENÉRICO (insert_record sobre products) — ahora enrutado a createProductSvc.
// Prueba por unidad del servicio (misma función a la que el genérico delega):
console.log('\n[Camino genérico insert_record→createProductSvc] unidad del servicio validado:');
{
  let threw = false;
  try { createProductSvc(db, { name: MARK + '-NoBand', sku: MARK + '-nb', price: 9, type: 'physical' }); }
  catch (e) { threw = e.status === 400; }
  ok(threw, 'createProductSvc SIN banda → 400 (no hay INSERT con default silencioso)');
  let threw2 = false;
  try { createProductSvc(db, { name: MARK + '-BadBand', sku: MARK + '-bb', price: 9, type: 'physical', tax_band: 'inventada' }); }
  catch (e) { threw2 = e.status === 400; }
  ok(threw2, 'createProductSvc con banda FUERA de la lista cerrada → 400');
  const r = createProductSvc(db, { name: MARK + '-GoodBand', sku: MARK + '-gb', price: 9, type: 'physical', tax_band: 'superreducido' });
  const row = db.prepare('SELECT tax_band,tax_rate FROM products WHERE id=?').get(r.id);
  ok(row.tax_band === 'superreducido' && Number(row.tax_rate) === 4,
     'createProductSvc con banda válida → % derivado por el servidor (superreducido=4%)');
}

// ─────────────────────────────────────────────────────────────────────────────
// REGRESIÓN P2.2 — el API manual de producto sigue exigiendo banda válida (400).
console.log('\n[Regresión P2.2] API manual POST /api/erp/products:');
{
  const noBand = await fetch(ORIGIN + '/api/erp/products', {
    method: 'POST',
    headers: { 'Host': HOST, 'Content-Type': 'application/json', 'x-csrf-token': csrf, 'Cookie': 'asess=' + token + '; btenant=desarrollo-bamburu' },
    body: JSON.stringify({ name: MARK + '-API', sku: MARK + '-api', price: 5, type: 'physical' }),
  });
  ok(noBand.status === 400, 'API sin tax_band → 400 (P2.2 intacto). status=' + noBand.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Limpieza de los productos de prueba creados por ESTE script (creados ahora, sin movimientos).
const mine = db.prepare("SELECT id FROM products WHERE name LIKE ?").all('%' + MARK + '%');
for (const p of mine) {
  db.prepare('DELETE FROM product_tags WHERE product_id=?').run(p.id);
  db.prepare('DELETE FROM products WHERE id=?').run(p.id);
}
db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
console.log('\n(limpieza: ' + mine.length + ' productos de prueba "' + MARK + '" eliminados)');

console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
