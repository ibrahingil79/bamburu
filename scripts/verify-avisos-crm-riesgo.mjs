// Gate de la fuente de avisos "cliente_en_riesgo" (CRM) y del contador en vivo de la campana.
// Contra el SERVIDOR REAL (:3000), con DOS negocios, y con datos que el propio gate crea y borra.
//
// Verifica, en este orden:
//   1. Aislamiento entre negocios: la oportunidad de un negocio no asoma en el otro.
//   2. Permiso: con `crm.read` se ve y se CUENTA; sin él no se ve, no cuenta, y no viaja ni el
//      nombre del cliente por el cable.
//   3. Ciclo de vida: oportunidad abierta con el seguimiento vencido → aparece el aviso y sube el
//      contador; se cierra → el aviso desaparece y el contador baja. Sin recargar nada: se
//      pregunta al mismo endpoint que sondea la campana (/api/erp/avisos/contador).
//   4. Regresión: las fuentes que ya existían devuelven exactamente lo mismo que antes de crear
//      la oportunidad (la nueva fuente no las toca).
//
//   node scripts/verify-avisos-crm-riesgo.mjs
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import http from 'node:http';

const PORT = 3000;
const TENANTS = ['desarrollo-bamburu', 'ibrahin-repuestos'];
const EMAIL = 'zz-prueba-riesgo@bamburu.test';
const MARCA = 'zz-prueba-riesgo';          // marca nuestras filas: nada más se toca

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

function usuarioRestringido(db, perms) {
  let u = db.prepare('SELECT id FROM admin_users WHERE email=?').get(EMAIL);
  if (!u) {
    const id = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,?,1)")
      .run('Prueba riesgo', EMAIL, 'x-no-login', 'employee').lastInsertRowid;
    u = { id };
  } else db.prepare('UPDATE admin_users SET active=1 WHERE id=?').run(u.id);
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(u.id);
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

// Cliente y oportunidad de prueba. `expected_close_date` en el pasado y `status='activa'` = la rama
// 'revisar' del motor del CRM: cierre previsto vencido con la oportunidad todavía abierta.
function crearOportunidadVencida(db, slug) {
  let cli = db.prepare('SELECT id FROM clients WHERE name=?').get(MARCA);
  if (!cli) cli = { id: db.prepare('INSERT INTO clients (name,active) VALUES (?,1)').run(MARCA).lastInsertRowid };
  const ayer = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  const id = db.prepare(
    `INSERT INTO opportunities (client_id,title,amount,stage,probability,expected_close_date,status,active,created_at,stage_changed_at)
     VALUES (?,?,?,?,?,?,'activa',1,?,?)`
  ).run(cli.id, MARCA + ' · ' + slug, 1234.5, 'propuesta', 50, ayer, ayer, ayer).lastInsertRowid;
  return { clientId: cli.id, oppId: Number(id) };
}

function borrarPrueba(db, oppId, clientId) {
  db.prepare('DELETE FROM client_activities WHERE opportunity_id=?').run(oppId);
  db.prepare('DELETE FROM opportunities WHERE id=?').run(oppId);          // fila NUESTRA, creada aquí
  db.prepare('DELETE FROM clients WHERE id=? AND name=?').run(clientId, MARCA);
}

const tipos = av => [...new Set((av || []).map(a => a.tipo))].sort();
const soloRiesgo = av => (av || []).filter(a => a.tipo === 'cliente_en_riesgo');
const cuentaPorTipo = av => { const m = {}; for (const a of av || []) m[a.tipo] = (m[a.tipo] || 0) + 1; return m; };

const abiertas = [], creado = {};
try {
  // ── 1. Línea base ANTES de crear nada, con el dueño de cada negocio ──────────────────
  const base = {};
  for (const slug of TENANTS) {
    const db = new Database(`data/tenants/${slug}.db`); abiertas.push(db);
    const ownerId = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1").get().id;
    const s = sesion(db, ownerId);
    const r = await pedir(slug, '/api/erp/avisos', s);
    base[slug] = { count: r.body.count, porTipo: cuentaPorTipo(r.body.avisos), db, ownerId, sesionOwner: s };
    console.log(`\n════ ${slug} · línea base: ${r.body.count} avisos · ${JSON.stringify(base[slug].porTipo)}`);
    ok(soloRiesgo(r.body.avisos).length === 0, 'antes de crear nada NO hay avisos de cliente_en_riesgo');
  }

  // ── 2. Creamos UNA oportunidad vencida en CADA negocio ───────────────────────────────
  for (const slug of TENANTS) creado[slug] = crearOportunidadVencida(base[slug].db, slug);

  for (const slug of TENANTS) {
    console.log(`\n════ ${slug} ════`);
    const { db, ownerId } = base[slug];

    // ── El dueño ve el aviso nuevo, y solo UNO ──
    const s = sesion(db, ownerId);
    const r = await pedir(slug, '/api/erp/avisos', s);
    const riesgo = soloRiesgo(r.body.avisos);
    ok(riesgo.length === 1, `el dueño ve 1 aviso de cliente_en_riesgo (vio ${riesgo.length})`);
    ok(r.body.count === base[slug].count + 1, `el contador sube exactamente 1: ${base[slug].count} → ${r.body.count}`);
    ok(riesgo[0]?.href === '/admin/crm/cola', `el aviso lleva a su sitio en el CRM (href=${riesgo[0]?.href})`);
    ok(/cierre previsto/i.test(riesgo[0]?.detalle || ''), `el detalle explica el motivo: "${(riesgo[0]?.detalle || '').slice(0, 60)}…"`);
    ok(riesgo[0]?.key === 'cr:' + creado[slug].oppId, `la clave del aviso identifica la oportunidad (${riesgo[0]?.key})`);

    // ── AISLAMIENTO: el aviso de ESTE negocio nombra a ESTE negocio, no al otro ──
    const otro = TENANTS.find(t => t !== slug);
    ok((riesgo[0]?.titulo || '').includes(slug), `el título es del negocio propio (${riesgo[0]?.titulo})`);
    ok(!(r.raw || '').includes(MARCA + ' · ' + otro), `NO aparece la oportunidad de ${otro} (aislamiento multi-tenant)`);

    // ── REGRESIÓN: las demás fuentes, intactas ──
    const ahora = cuentaPorTipo(r.body.avisos);
    const antes = base[slug].porTipo;
    const otras = [...new Set([...Object.keys(antes), ...Object.keys(ahora)])].filter(t => t !== 'cliente_en_riesgo');
    const iguales = otras.every(t => (antes[t] || 0) === (ahora[t] || 0));
    ok(iguales, `las fuentes previas no se mueven: ${otras.map(t => `${t}=${ahora[t] || 0}`).join(' · ') || '(ninguna)'}`);

    // ── PERMISO: CON crm.read lo ve y lo cuenta ──
    const uidCon = usuarioRestringido(db, ['crm.read']);
    const sCon = sesion(db, uidCon);
    const rCon = await pedir(slug, '/api/erp/avisos', sCon);
    const cCon = await pedir(slug, '/api/erp/avisos/contador', sCon);
    ok(rCon.status === 200 && tipos(rCon.body.avisos).join() === 'cliente_en_riesgo',
      `con crm.read ve SOLO cliente_en_riesgo (vio: ${tipos(rCon.body.avisos).join(', ') || 'nada'})`);
    ok(cCon.body?.count === 1, `su contador en vivo dice 1 (dijo ${cCon.body?.count})`);

    // ── PERMISO: SIN crm.read no lo ve, no cuenta, y no se filtra el nombre ──
    const uidSin = usuarioRestringido(db, ['products.read']);
    const sSin = sesion(db, uidSin);
    const rSin = await pedir(slug, '/api/erp/avisos', sSin);
    const cSin = await pedir(slug, '/api/erp/avisos/contador', sSin);
    ok(soloRiesgo(rSin.body.avisos).length === 0, 'sin crm.read NO ve el aviso de cliente_en_riesgo');
    ok(cSin.body?.count === 0, `sin crm.read el aviso NO suma en su contador (count=${cSin.body?.count})`);
    ok(!(rSin.raw || '').includes(MARCA), 'sin crm.read no viaja ni el nombre del cliente por el cable');
    ok(!(cSin.raw || '').includes(MARCA) && cSin.body && !('avisos' in cSin.body),
      'el endpoint del contador no devuelve la lista de avisos (solo números)');

    // ── CICLO DE VIDA: se cierra la oportunidad → el aviso se va y el contador baja ──
    db.prepare("UPDATE opportunities SET status='ganada', closed_at=datetime('now') WHERE id=?").run(creado[slug].oppId);
    const rTras = await pedir(slug, '/api/erp/avisos', sesion(db, ownerId));
    const cTras = await pedir(slug, '/api/erp/avisos/contador', sCon);
    ok(soloRiesgo(rTras.body.avisos).length === 0, 'al cerrar la oportunidad, el aviso desaparece');
    ok(rTras.body.count === base[slug].count, `el contador vuelve a la línea base: ${rTras.body.count}`);
    ok(cTras.body?.count === 0, `el contador en vivo del usuario con crm.read baja a 0 (dijo ${cTras.body?.count})`);

    // Limpieza de usuarios/sesiones de prueba.
    for (const uid of [uidCon, uidSin]) {
      db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(uid);
      db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(uid);
    }
    db.prepare("DELETE FROM admin_sessions WHERE user_id IN (SELECT id FROM admin_users WHERE email=?)").run(EMAIL);
    db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(ownerId);
  }
} finally {
  for (const slug of TENANTS) {
    if (creado[slug] && base_db(slug)) borrarPrueba(base_db(slug), creado[slug].oppId, creado[slug].clientId);
  }
  function base_db(slug) { return abiertas[TENANTS.indexOf(slug)]; }
  for (const db of abiertas) db.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
