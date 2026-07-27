// Test — ENLACE PÚBLICO DE LA CITA (Escalera · paso 7 · PIEZA 5 · 1.9), sobre BD temporal + rutas reales.
//   node scripts/test-enlace-cita.mjs
//
// Demuestra: la llave abre SOLO su cita; no se puede listar ni adivinar otra; caduca pasada la cita;
// el límite de peticiones está activo; confirmar y "no puedo ir" funcionan por el enlace.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createCitaSvc, createCitasPublicRoutes } from '../modules/erp/routes/citas.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
function nuevaBD() {
  const f = join(tmpdir(), 'enlace-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("UPDATE company_config SET company_name='Peluquería Test', address='C/ Mayor 1' WHERE id=1").run();
  return db;
}
const nuevoUsuario = (db, name) => db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,'employee',1)").run(name, name + '@t.local', 'x').lastInsertRowid;
function nuevoServicio(db, name, dur) {
  const id = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES (?,?,'service','general',21,'active')").run(name, 20).lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,margen_min) VALUES (?,1,?,0)").run(id, dur);
  return id;
}
const futura = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

try {
  const db = nuevaBD();
  const U = nuevoUsuario(db, 'Ana');
  const S = nuevoServicio(db, 'Corte', 30);
  const app = createCitasPublicRoutes(db);

  // Dos citas distintas, cada una con su token.
  const c1 = createCitaSvc(db, { cliente_suelto_nombre: 'María', cliente_suelto_movil: '600111222', user_id: U, fecha: futura(3), inicio_min: 600, service_ids: [S] });
  const c2 = createCitaSvc(db, { cliente_suelto_nombre: 'Juan', user_id: U, fecha: futura(4), inicio_min: 660, service_ids: [S] });
  ok(c1.token && c1.token.length >= 40 && c1.token !== c2.token, 'cada cita genera una llave propia, larga y no adivinable');

  console.log('\n=== 1. la llave abre SOLO su cita ===\n');
  const r1 = await app.request('/' + c1.token);
  const html1 = await r1.text();
  ok(r1.status === 200, 'GET /cita/<token1> → 200');
  ok(html1.includes('María') && !html1.includes('Juan'), 'muestra los datos de SU cita (María), no los de la otra (Juan)');
  ok(html1.includes('Peluquería Test') && html1.includes('C/ Mayor 1'), 'muestra negocio y dirección de la cita');

  console.log('\n=== 2. no se puede adivinar ni listar otra ===\n');
  const rBad = await app.request('/' + 'x'.repeat(43));
  ok(rBad.status === 403, 'token inventado → 403');
  const rShort = await app.request('/abc');
  ok(rShort.status === 403, 'token demasiado corto → 403 (ni siquiera se consulta)');
  const rRoot = await app.request('/');
  ok(rRoot.status === 404 || rRoot.status === 403, 'no hay índice/listado en /cita (' + rRoot.status + ')');

  console.log('\n=== 3. confirmar y "no puedo ir" por el enlace ===\n');
  const rConf = await app.request('/' + c1.token + '/confirmar', { method: 'POST' });
  ok(rConf.status === 200, 'POST confirmar → 200');
  ok(db.prepare('SELECT estado FROM citas WHERE id=?').get(c1.id).estado === 'confirmada', 'la cita queda confirmada');
  const rAvisa = await app.request('/' + c2.token + '/avisar', { method: 'POST' });
  ok(rAvisa.status === 200, 'POST avisar (no puedo ir) → 200');
  ok(db.prepare('SELECT estado FROM citas WHERE id=?').get(c2.id).estado === 'anulada', 'la cita se anula al avisar (libera el hueco)');
  // Un token ajeno no puede tocar la cita de otro (no hay forma: solo resuelve la suya).
  const rCross = await app.request('/' + 'z'.repeat(43) + '/confirmar', { method: 'POST' });
  ok(rCross.status === 403, 'confirmar con token inválido → 403 (no toca ninguna cita)');

  console.log('\n=== 4. caduca pasada la cita ===\n');
  const c3 = createCitaSvc(db, { cliente_suelto_nombre: 'Pedro', user_id: U, fecha: futura(5), inicio_min: 600, service_ids: [S] });
  db.prepare("UPDATE citas SET fecha=? WHERE id=?").run(futura(-1), c3.id);   // la ponemos en el pasado
  const rOld = await app.request('/' + c3.token);
  ok(rOld.status === 403, 'cita ya pasada → enlace caducado (403)');

  console.log('\n=== 5. límite de peticiones activo (evita barridos) ===\n');
  let got429 = false;
  for (let i = 0; i < 60; i++) {
    const r = await app.request('/' + 'q'.repeat(43));   // martilleo de tokens inválidos
    if (r.status === 429) { got429 = true; break; }
  }
  ok(got429, 'tras muchas peticiones seguidas salta el 429 (rate limit)');

  console.log('\n' + (fail === 0 ? '✅ TODO VERDE' : '❌ HAY FALLOS') + ` — ${pass} ok, ${fail} fallos`);
} catch (e) {
  console.error('\n💥 EXCEPCIÓN:', e); fail++;
} finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
}
