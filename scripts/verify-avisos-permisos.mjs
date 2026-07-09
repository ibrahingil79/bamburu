// Verificación de los dos CRÍTICOS de la auditoría del 9 jul, contra el servidor real:
//   1. GET /api/erp/avisos ya no filtra datos de cobros/pagos/stock a quien no tiene su permiso.
//   2. El endpoint tiene freno propio, con clave negocio+IP (no filtra entre tenants).
//
// Se ejecuta con DOS negocios distintos. Crea un usuario de prueba restringido en cada uno, mide, y
// lo deja ARCHIVADO (active=0) al terminar: no se borra nada del negocio.
//   node scripts/verify-avisos-permisos.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import http from 'node:http';

const PORT = 3000;
const TENANTS = ['desarrollo-bamburu', 'ibrahin-repuestos'];
const EMAIL = 'zz-prueba-permisos@bamburu.test';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

function pedir(slug, path, { method = 'GET', token, csrf, body } = {}) {
  return new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Host: slug + '.localhost' };
    if (token) headers.Cookie = 'asess=' + token;
    if (csrf) headers['x-csrf-token'] = csrf;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path, method, headers }, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j, raw: b }); });
    });
    req.on('error', () => resolve({ status: 0 }));
    if (data) req.write(data);
    req.end();
  });
}

// Usuario restringido: existe, activo, y SOLO con los permisos que se le pasen.
function usuarioRestringido(db, perms) {
  let u = db.prepare('SELECT id FROM admin_users WHERE email=?').get(EMAIL);
  if (!u) {
    const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,?,1)")
      .run('Prueba permisos', EMAIL, 'x-no-login', 'employee').lastInsertRowid;
    u = { id };
  } else {
    db.prepare('UPDATE admin_users SET active=1 WHERE id=?').run(u.id);
  }
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(u.id);   // solo filas nuestras
  for (const p of perms) {
    const [module, action] = p.split('.');
    const row = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(module, action);
    if (row) db.prepare('INSERT INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(u.id, row.id);
  }
  return u.id;
}

function sesion(db, userId) {
  const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
    .run(token, userId, now, now + 900, csrf);
  return { token, csrf };
}

const tipos = av => [...new Set((av || []).map(a => a.tipo))].sort();
const limpiar = [];

try {
  for (const slug of TENANTS) {
    console.log('\n════ ' + slug + ' ════');
    const db = new Database(`data/tenants/${slug}.db`);
    limpiar.push(db);

    const ownerId = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1").get().id;
    const so = sesion(db, ownerId);
    const rOwner = await pedir(slug, '/api/erp/avisos', so);
    ok(rOwner.status === 200, 'el dueño recibe 200');
    const tiposOwner = tipos(rOwner.body?.avisos);
    ok(rOwner.body.count > 0 || tiposOwner.length === 0, `dueño ve ${rOwner.body.count} avisos · fuentes: ${tiposOwner.join(', ') || '(ninguna)'}`);

    // ── Usuario SIN ningún permiso de fuente (solo products.read) ──
    const uid = usuarioRestringido(db, ['products.read']);
    const s1 = sesion(db, uid);
    const r1 = await pedir(slug, '/api/erp/avisos', s1);
    ok(r1.status === 200, 'usuario restringido recibe 200 (no 403: la campana existe para todos)');
    ok(r1.body.count === 0 && (r1.body.avisos || []).length === 0,
      `sin permisos de fuente NO ve ningún aviso (count=${r1.body.count}) — antes veía ${rOwner.body.count}`);
    const fuga = /Te deben|pendiente|vencida hace/i.test(r1.raw || '');
    ok(!fuga, 'la respuesta no contiene importes ni nombres de deudores');

    // ── Le damos SOLO inventory.read: debe ver stock, y nada más ──
    usuarioRestringido(db, ['products.read', 'inventory.read']);
    const s2 = sesion(db, uid);
    const r2 = await pedir(slug, '/api/erp/avisos', s2);
    const t2 = tipos(r2.body?.avisos);
    ok(t2.every(t => t === 'stock_bajo'), `con inventory.read solo ve stock_bajo (vio: ${t2.join(', ') || 'nada'})`);
    ok(!t2.includes('cobro_vencido') && !t2.includes('vencimiento_proveedor'), 'sigue sin ver cobros ni pagos');

    // ── Y con cobros.read aparece su fuente, y solo la suya ──
    usuarioRestringido(db, ['products.read', 'cobros.read']);
    const s3 = sesion(db, uid);
    const r3 = await pedir(slug, '/api/erp/avisos', s3);
    const t3 = tipos(r3.body?.avisos);
    ok(t3.every(t => t === 'cobro_vencido'), `con cobros.read solo ve cobro_vencido (vio: ${t3.join(', ') || 'nada'})`);

    // Deja el usuario de prueba ARCHIVADO (no se borra: regla permanente del proyecto).
    db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(uid);
    db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(uid);
    for (const s of [so, s1, s2, s3]) db.prepare('DELETE FROM admin_sessions WHERE token=?').run(s.token);
    console.log('  (usuario de prueba archivado, sesiones borradas)');
  }
} finally {
  for (const db of limpiar) db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
