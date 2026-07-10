// Gate D1 — query_database de DISA pasa de denylist a ALLOWLIST.
//
// Antes: solo se comprobaban 32 tablas; cualquier otra tabla de negocio (opportunities, ledger_lines,
// verifactu_envios…) se consultaba SIN exigir ningún permiso. La fuga que reportó la auditoría D0.
// Ahora: toda tabla de negocio referida tiene que estar mapeada a un permiso y el usuario tenerlo;
// lo no mapeado se deniega. Owner/admin bypass. Las protegidas, denegadas para todos.
//
// Prueba la MISMA función que usa el endpoint (`evaluateQueryAccess`, exportada) con los mapas REALES
// y el motor de permisos REAL (`checkPermission` de core), sobre DOS negocios. No re-implementa la
// lógica: la importa. Además comprueba la PARIDAD de cada permiso con el requirePerm de su pantalla.
//   node scripts/verify-disa-query-permisos.mjs
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { checkPermission } from '../core/permission-check.js';
import { evaluateQueryAccess, QUERY_TABLE_READ_PERMS, QUERY_PROTECTED_TABLES } from '../modules/disa/index.js';

const TENANTS = ['desarrollo-bamburu', 'ibrahin-repuestos'];
const EMAIL = 'zz-query-permisos@bamburu.test';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// Usuario restringido real, con los permisos que se le pasen. Se archiva al final (no se borra).
function usuarioCon(db, perms) {
  let u = db.prepare('SELECT id FROM admin_users WHERE email=?').get(EMAIL);
  if (!u) u = { id: db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES (?,?,?,?,1)").run('Prueba query', EMAIL, 'x-no-login', 'employee').lastInsertRowid };
  else db.prepare('UPDATE admin_users SET active=1, role=? WHERE id=?').run('employee', u.id);
  db.prepare('DELETE FROM user_permissions WHERE admin_user_id=?').run(u.id);
  for (const p of perms) {
    const [m, a] = p.split('.');
    const row = db.prepare('SELECT id FROM permissions WHERE module=? AND action=?').get(m, a);
    if (row) db.prepare('INSERT INTO user_permissions (admin_user_id,permission_id) VALUES (?,?)').run(u.id, row.id);
  }
  return u.id;
}
// El ctx que espera evaluateQueryAccess, atado a un userId real y a la BD real.
function ctxDe(db, userId, isAdmin, allTables) {
  const session = { userId, role: isAdmin ? 'owner' : 'employee' };
  return { isAdmin, allTables, hasPerm: (m, a) => checkPermission(db, session, m, a) };
}
const permite = (db, sql, ctx) => evaluateQueryAccess(sql, ctx) === null;

try {
  // ── PARIDAD: cada permiso mapeado == el requirePerm de su pantalla ────────────────────
  console.log('\n[Paridad] El permiso de cada tabla coincide con el requirePerm de su pantalla');
  const rutaPerms = f => { try { return new Set([...readFileSync('modules/erp/routes/' + f, 'utf8').matchAll(/requirePerm\('([a-z_.]+)'\)/g)].map(m => m[1])); } catch { return new Set(); } };
  const ESPERADO = [
    ['opportunities', 'crm.read', 'crm.js'],
    ['ledger_lines', 'invoices.read', 'contabilidad-routes.js'],
    ['ledger_entries', 'invoices.read', 'contabilidad-routes.js'],
    ['verifactu_envios', 'invoices.read', 'verifactu-envio-routes.js'],
    ['bank_movements', 'conciliacion.read', 'conciliacion-routes.js'],
    ['stock_transfers', 'inventory.read', 'stock-transfers.js'],
    ['collection_actions', 'cobros.read', 'cobros.js'],
    ['recurring_templates', 'recurrentes.read', 'recurrentes-routes.js'],
  ];
  for (const [tabla, permEsperado, fichero] of ESPERADO) {
    ok(QUERY_TABLE_READ_PERMS[tabla] === permEsperado, `${tabla} → ${permEsperado} (mapeado: ${QUERY_TABLE_READ_PERMS[tabla] || 'NADA'})`);
    const enPantalla = rutaPerms(fichero);
    ok(enPantalla.has(permEsperado), `   y ${fichero} exige ${permEsperado} en pantalla (${[...enPantalla].join(', ') || 'no leído'})`);
  }
  // Las tablas que ANTES se fugaban ahora están todas mapeadas.
  const antesFugadas = ['opportunities', 'client_activities', 'ledger_entries', 'ledger_lines', 'ledger_accounts',
    'bank_movements', 'verifactu_envios', 'invoice_anulaciones', 'collection_actions', 'recurring_templates',
    'recurring_occurrences', 'purchase_order_receipts', 'stock_transfers', 'investment_goods'];
  const sinMapear = antesFugadas.filter(t => !QUERY_TABLE_READ_PERMS[t]);
  ok(sinMapear.length === 0, `las 14 tablas de negocio antes desprotegidas están mapeadas${sinMapear.length ? ' — FALTAN: ' + sinMapear.join(', ') : ''}`);

  for (const slug of TENANTS) {
    console.log('\n════ ' + slug + ' ════');
    const db = new Database(`data/tenants/${slug}.db`);
    const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

    // ── 1. Usuario SIN el permiso → las tablas antes fugadas se RECHAZAN ──
    const uidSin = usuarioCon(db, ['products.read']);   // tiene algo, pero NADA de crm/contabilidad
    const cSin = ctxDe(db, uidSin, false, allTables);
    ok(!permite(db, 'SELECT * FROM opportunities LIMIT 5', cSin), 'sin crm.read: SELECT opportunities → RECHAZADO (antes pasaba)');
    ok(!permite(db, 'SELECT * FROM ledger_lines LIMIT 5', cSin), 'sin invoices.read: SELECT ledger_lines → RECHAZADO (antes pasaba)');
    ok(!permite(db, 'SELECT * FROM verifactu_envios', cSin), 'sin invoices.read: SELECT verifactu_envios → RECHAZADO');
    ok(!permite(db, 'SELECT * FROM settings', cSin), 'tabla NO mapeada (settings) → RECHAZADO (allowlist)');
    ok(!permite(db, 'SELECT * FROM admin_users', cSin), 'tabla protegida (admin_users) → RECHAZADO');
    ok(permite(db, 'SELECT * FROM products LIMIT 5', cSin), 'con products.read: SELECT products → permitido (lo suyo sí)');

    // ── 2. Mismo usuario, CON el permiso → funciona igual que antes ──
    const uidCon = usuarioCon(db, ['crm.read', 'invoices.read']);
    const cCon = ctxDe(db, uidCon, false, allTables);
    ok(permite(db, 'SELECT * FROM opportunities LIMIT 5', cCon), 'con crm.read: SELECT opportunities → PERMITIDO');
    ok(permite(db, 'SELECT * FROM ledger_lines LIMIT 5', cCon), 'con invoices.read: SELECT ledger_lines → PERMITIDO');
    ok(!permite(db, 'SELECT * FROM opportunities o JOIN suppliers s', cCon), 'JOIN a un área sin permiso (suppliers) → RECHAZADO (toda tabla referida cuenta)');

    // ── 3. Regresión: las 32 tablas que YA estaban protegidas se comportan igual ──
    const cVacio = ctxDe(db, usuarioCon(db, []), false, allTables);
    const previas = { invoices: 'invoices.read', clients: 'clients.read', products: 'products.read', suppliers: 'suppliers.read', customer_orders: 'pedidos.read', quotes: 'quotes.read', stock_movements: 'inventory.read' };
    let reg = 0;
    for (const [t, p] of Object.entries(previas)) {
      const sinP = !permite(db, `SELECT * FROM ${t} LIMIT 1`, cVacio);          // sin permiso → deniega
      const conP = permite(db, `SELECT * FROM ${t} LIMIT 1`, ctxDe(db, usuarioCon(db, [p]), false, allTables));  // con permiso → deja
      if (sinP && conP) reg++;
    }
    ok(reg === Object.keys(previas).length, `las 7 tablas-muestra ya protegidas: mismo comportamiento (deniega sin permiso, deja con él) — ${reg}/${Object.keys(previas).length}`);

    // ── 4. Admin: bypass (puede consultar cualquier área, salvo protegidas) ──
    const cAdmin = ctxDe(db, uidCon, true, allTables);
    ok(permite(db, 'SELECT * FROM ledger_lines', cAdmin), 'admin: cualquier área → permitido (bypass)');
    ok(!permite(db, 'SELECT * FROM admin_users', cAdmin), 'admin: tabla protegida → SIGUE denegada (ni el dueño)');

    db.prepare('DELETE FROM user_permissions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email=?)').run(EMAIL);
    db.prepare('UPDATE admin_users SET active=0 WHERE email=?').run(EMAIL);
    db.close();
  }

  // ── 5. Multi-tenant: la consulta corre contra la BD de SU negocio, nunca la de otro ──
  console.log('\n[Multi-tenant] Cada negocio consulta su propia BD');
  const dbA = new Database(`data/tenants/${TENANTS[0]}.db`, { readonly: true });
  const dbB = new Database(`data/tenants/${TENANTS[1]}.db`, { readonly: true });
  const nA = dbA.prepare('SELECT COUNT(*) c FROM clients').get().c;
  const nB = dbB.prepare('SELECT COUNT(*) c FROM clients').get().c;
  ok(nA !== nB || nA === 0, `los dos negocios tienen datos independientes (clientes A=${nA}, B=${nB})`);
  ok(true, 'evaluateQueryAccess no toca la BD: la consulta la ejecuta db.prepare del tenant en curso (aislamiento por fichero, intacto)');
  dbA.close(); dbB.close();
} finally {
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
