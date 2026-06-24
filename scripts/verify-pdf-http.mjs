// Verificación — PDF real. Parte D (servidor real, tenant desarrollo):
//   node scripts/verify-pdf-http.mjs
// - GET .../:id/pdf de los 4 documentos como dueño → 200 + application/pdf + adjunto + %PDF.
// - Permisos: la ruta /pdf exige la MISMA guarda que la ficha (403 sin permiso, parità con la vista).
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

const DB = 'data/tenants/desarrollo-bamburu.db';
const ORIGIN = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const db = new Database(DB);
const mk = (uid) => { const t = randomBytes(24).toString('base64url'); const now = Math.floor(Date.now() / 1000); db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)').run(t, uid, now, now + 1800, randomBytes(8).toString('hex')); return t; };
const ownerTok = mk(2);   // owner: pasa requirePerm por bypass de rol
// Usuario SIN permisos: employee nuevo y sin user_permissions → requirePerm devuelve 403.
const noPermUid = Number(db.prepare("INSERT INTO admin_users (email, password_hash, name, role, active) VALUES (?,?,?,?,1)").run('nopermpdf-' + Date.now() + '@x.com', 'x', 'Sin Permisos', 'employee').lastInsertRowid);
const noPermTok = mk(noPermUid);
const ids = {
  quotes: (db.prepare("SELECT id FROM quotes WHERE status='emitido' ORDER BY id LIMIT 1").get() || {}).id,
  pedidos: (db.prepare('SELECT id FROM customer_orders ORDER BY id LIMIT 1').get() || {}).id,
  albaranes: (db.prepare('SELECT id FROM delivery_notes ORDER BY id LIMIT 1').get() || {}).id,
  invoices: (db.prepare('SELECT id FROM invoices ORDER BY id LIMIT 1').get() || {}).id,
};
db.close();

async function get(path, tok) {
  return fetch(ORIGIN + path, { headers: { Cookie: 'asess=' + tok + '; btenant=desarrollo-bamburu' }, redirect: 'manual' });
}

try {
  console.log('\n=== PDF real — Parte D (servidor real) ===\n');
  const labels = { quotes: 'Presupuesto', pedidos: 'Pedido', albaranes: 'Albarán', invoices: 'Factura' };
  for (const seg of ['quotes', 'pedidos', 'albaranes', 'invoices']) {
    const id = ids[seg];
    if (!id) { ok(false, seg + ': no hay documento de prueba en dev'); continue; }
    const r = await get('/admin/' + seg + '/' + id + '/pdf', ownerTok);
    const ct = r.headers.get('content-type') || '';
    const cd = r.headers.get('content-disposition') || '';
    const head = Buffer.from(await r.arrayBuffer()).slice(0, 5).toString('latin1');
    ok(r.status === 200 && /application\/pdf/.test(ct) && /attachment; filename=/.test(cd) && head === '%PDF-',
      labels[seg] + ' (#' + id + '): 200 · ' + ct + ' · ' + cd.replace('attachment; ', '') + ' · ' + head);
  }

  // Permisos: parità ficha vs /pdf para un usuario sin permiso.
  const q = ids.quotes;
  const viewStatus = (await get('/admin/quotes/' + q, noPermTok)).status;
  const pdfStatus = (await get('/admin/quotes/' + q + '/pdf', noPermTok)).status;
  ok(pdfStatus === 403, 'sin permiso: GET /admin/quotes/' + q + '/pdf → 403');
  ok(viewStatus === 403 && pdfStatus === viewStatus, 'la ruta /pdf exige la MISMA guarda que la ficha (ambas ' + viewStatus + ')');
  const ownerPdf = (await get('/admin/quotes/' + q + '/pdf', ownerTok)).status;
  ok(ownerPdf === 200, 'el dueño SÍ descarga el mismo /pdf (200) — la guarda no es un bloqueo global');
} catch (e) { console.error('ERROR', e.message); fail++; } finally {
  const d = new Database(DB);
  d.prepare('DELETE FROM admin_sessions WHERE user_id=? OR user_id=?').run(2, noPermUid);
  d.prepare('DELETE FROM admin_users WHERE id=?').run(noPermUid);   // limpia el usuario de prueba
  d.close();
}
console.log('\n=== RESULTADO PARTE D: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
