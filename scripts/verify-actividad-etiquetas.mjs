// Gate de las ETIQUETAS del registro de actividad: DISA y las pantallas deben nombrar igual la misma
// cosa, tomándolo de un único sitio (core/activity-entities.js).
//
// Tiene dos patas, porque una sola no basta:
//
//   [A] ESTRUCTURAL, sobre el código fuente. `executeAction` de DISA es una función LOCAL a la que
//       solo se llega por el bucle del LLM, así que no se puede invocar desde un test. Lo que sí se
//       puede garantizar es que NINGÚN sitio teclea el literal: todos importan la misma constante.
//       Si los dos lados leen la misma constante, no pueden discrepar. Eso es más fuerte que probar
//       dos casos y confiar en el resto.
//
//   [B] DE COMPORTAMIENTO. Se escribe un apunte "como lo escribe la pantalla" (logActivity de
//       core/auth.js) y otro "como lo escribe DISA" (su helper local, con la MISMA firma que el
//       original), y se filtra con la MISMA consulta que usa el endpoint. Deben salir los dos.
//       Se demuestra además que ANTES fallaba: con la etiqueta vieja, el de DISA no aparecía.
//       Y contra el servidor real, en DOS negocios, para el aislamiento.
//
//   node scripts/verify-actividad-etiquetas.mjs
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import http from 'node:http';
import { runMigrations } from '../modules/erp/models.js';
import { logActivity } from '../core/auth.js';
import { ENTITY, TABLE_TO_ENTITY, entityForTable } from '../core/activity-entities.js';

const PORT = 3000;
const TENANTS = ['desarrollo-bamburu', 'ibrahin-repuestos'];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// Ficheros/literales que se dejan a propósito: su código está MUERTO y no se maquilla.
// (`modules/disa/index.js` estuvo aquí con 'sales_orders': el 2026-07-10 se retiraron esas cinco
// acciones enteras, así que ya no hay literal que perdonar. Ver `verify-disa-sin-pedidos.mjs`.)
const MUERTOS = {
  'modules/erp/routes/orders.js': new Set(['order']),     // ruta desmontada (POS viejo)
};

// Argumentos de nivel superior de una llamada, respetando paréntesis y comillas.
function args(src, i) {
  let d = 0, out = [], cur = '', q = null;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (q) { cur += ch; if (ch === q && src[k - 1] !== '\\') q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { d++; if (d === 1 && ch === '(') continue; }
    if (ch === ')' || ch === ']' || ch === '}') { d--; if (d === 0) { out.push(cur.trim()); return out; } }
    if (ch === ',' && d === 1) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return out;
}

function pedir(slug, path, { token } = {}) {
  return new Promise(resolve => {
    const headers = { Host: slug + '.localhost' };
    if (token) headers.Cookie = 'asess=' + token;
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path, method: 'GET', headers }, res => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j, raw: b }); });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
}

const creados = [];
try {
  // ═══ [A] ESTRUCTURAL ══════════════════════════════════════════════════════════════
  console.log('\n[A] Nadie teclea el literal: todas las entidades salen del catálogo');
  const ficheros = execSync("grep -rl 'logActivity(' --include=*.js modules/ core/", { encoding: 'utf8' }).trim().split('\n');
  const literales = [], dinamicos = new Set();
  for (const f of ficheros) {
    const src = readFileSync(f, 'utf8');
    const esDisa = f.includes('modules/disa/');
    const idxEnt = esDisa ? 2 : 3;
    let i = 0;
    while ((i = src.indexOf('logActivity(', i)) !== -1) {
      if (/function\s$/.test(src.slice(Math.max(0, i - 9), i))) { i += 12; continue; }
      const a = args(src, i + 11)[idxEnt];
      const linea = src.slice(0, i).split('\n').length;
      i += 12;
      if (!a) continue;
      const m = /^'([^']*)'$/.exec(a);
      if (!m) { dinamicos.add(a); continue; }
      if (MUERTOS[f]?.has(m[1])) continue;                 // muerto y marcado como tal
      literales.push(`${f}:${linea} → '${m[1]}'`);
    }
  }
  ok(literales.length === 0, `ninguna llamada viva teclea el literal${literales.length ? ':\n      ' + literales.join('\n      ') : ''}`);
  ok([...dinamicos].every(d => /^ENTITY\.|entityForTable\(|TRANSFER_ENTITY|entity_type/.test(d)),
    `las expresiones usadas son del catálogo: ${[...dinamicos].join(' · ')}`);
  const disaSrc = readFileSync('modules/disa/index.js', 'utf8');
  ok(/from '\.\.\/\.\.\/core\/activity-entities\.js'/.test(disaSrc), 'DISA importa el catálogo');
  ok(/from '\.\/activity-entities\.js'/.test(readFileSync('core/auth.js', 'utf8')), 'core/auth.js importa el catálogo');

  // Toda tabla escribible por la vía genérica de DISA debe tener entidad canónica.
  const bloque = disaSrc.slice(disaSrc.indexOf('WRITABLE_TABLES = new Set(['), disaSrc.indexOf('WRITABLE_TABLES = new Set([') + 700);
  const tablas = [...bloque.matchAll(/^\s*'([a-z_]+)'/gm)].map(m => m[1])
    .concat([...bloque.matchAll(/'([a-z_]+)',/g)].map(m => m[1]));
  const vivas = [...new Set(tablas)].filter(t => !new RegExp(`//[^\\n]*'${t}'`).test(bloque));
  const sinMapear = vivas.filter(t => !TABLE_TO_ENTITY[t]);
  ok(sinMapear.length === 0, `todas las tablas escribibles tienen entidad canónica${sinMapear.length ? ' — FALTAN: ' + sinMapear.join(', ') : ' (' + vivas.length + ' tablas)'}`);
  ok(entityForTable('products') === ENTITY.PRODUCT && entityForTable('categories') === ENTITY.CATEGORY,
    "entityForTable traduce tabla → entidad ('products'→'product', 'categories'→'category')");
  ok(entityForTable('tabla_que_no_existe') === 'tabla_que_no_existe',
    'una tabla sin mapear se degrada a su nombre crudo (no rompe la escritura de DISA)');

  // La pantalla del historial pintaba `user_name`, `action` y `entity` SIN escapar (solo `details`
  // pasaba por escHtml): un nombre de usuario con HTML se ejecutaba ahí. Se arregló al añadir el
  // filtro; esta guarda evita que vuelva.
  const usersSrc = readFileSync('modules/erp/routes/users.js', 'utf8');
  const pintar = usersSrc.slice(usersSrc.indexOf('function pintarActividad'), usersSrc.indexOf('window.cargarActividad'));
  const sinEscapar = ['l.user_name', 'l.action', 'l.entity'].filter(c => new RegExp('\\+\\s*\\(?' + c.replace('.', '\\.')).test(pintar) && !new RegExp('escHtml\\(' + c.replace('.', '\\.')).test(pintar));
  ok(sinEscapar.length === 0, `la pantalla escapa todo lo que viene de la BD${sinEscapar.length ? ' — SIN ESCAPAR: ' + sinEscapar.join(', ') : ''}`);

  // ═══ [B1] COMPORTAMIENTO, en memoria: los tipos corregidos ════════════════════════
  console.log('\n[B1] La pantalla y DISA escriben la MISMA etiqueta, y el filtro devuelve las dos');
  const db = new Database(':memory:'); runMigrations(db);
  // El helper LOCAL de DISA, con su firma real: (db, action, entity, entityId, details, session).
  const logDisa = (dbx, action, entity, id, det, ses) =>
    dbx.prepare('INSERT INTO activity_logs (user_id,user_name,action,entity,entity_id,details) VALUES (?,?,?,?,?,?)')
      .run(ses?.userId || null, ses?.userName || 'DISA', action, entity, id, det);
  // La MISMA consulta que sirve el endpoint /api/erp/users/activity?entity=…
  const filtrar = e => db.prepare('SELECT user_name, entity FROM activity_logs WHERE entity = ? ORDER BY id DESC').all(e);

  const PARES = [
    ['factura',        ENTITY.INVOICE,         'invoices'],
    ['producto',       ENTITY.PRODUCT,         'products'],
    ['cliente',        ENTITY.CLIENT,          'clients'],
    ['proveedor',      ENTITY.SUPPLIER,        'suppliers'],
    ['usuario admin',  ENTITY.ADMIN_USER,      'admin_users'],
    ['variante',       ENTITY.PRODUCT_VARIANT, 'product_variants'],
    ['descuento',      ENTITY.DISCOUNT_CODE,   'discount_codes'],
  ];
  for (const [nombre, canonica, vieja] of PARES) {
    logActivity(db, { userId: 1, userName: 'Ibrahin' }, 'Creó ' + nombre, canonica, 1, 'desde la pantalla');
    logDisa(db, 'create', canonica, 2, 'por DISA', null);
    const filas = filtrar(canonica);
    const autores = filas.map(f => f.user_name).sort();
    ok(filas.length === 2 && autores.join(',') === 'DISA,Ibrahin',
      `${nombre.padEnd(14)} filtrar por '${canonica}' devuelve pantalla Y DISA (${autores.join(' + ') || 'nada'})`);
    ok(filtrar(vieja).length === 0, `${nombre.padEnd(14)} nadie escribe ya la etiqueta vieja '${vieja}'`);
  }

  // La vía genérica de DISA (insert_record/update_record) también traduce.
  logDisa(db, 'create', entityForTable('categories'), 9, 'genérico', null);
  ok(filtrar(ENTITY.CATEGORY).length === 1, `la vía genérica de DISA escribe '${ENTITY.CATEGORY}', no 'categories'`);

  // Demostración de que ANTES fallaba: con la etiqueta vieja, el de DISA se perdía.
  const antes = new Database(':memory:'); runMigrations(antes);
  antes.prepare("INSERT INTO activity_logs (user_name,action,entity,entity_id,details) VALUES ('Ibrahin','Creó factura','invoice',1,'')").run();
  antes.prepare("INSERT INTO activity_logs (user_name,action,entity,entity_id,details) VALUES ('DISA','create','invoices',2,'')").run();
  const viejoFiltro = antes.prepare("SELECT COUNT(*) n FROM activity_logs WHERE entity='invoice'").get().n;
  ok(viejoFiltro === 1, `con las etiquetas VIEJAS, filtrar por 'invoice' solo devolvía 1 de 2 (el de DISA se perdía)`);
  antes.close(); db.close();

  // ═══ [B2] SERVIDOR REAL: el endpoint filtra, y los negocios están aislados ════════
  console.log('\n[B2] Servidor real: el endpoint filtra, y un negocio no ve la actividad del otro');
  const marcas = {};
  for (const slug of TENANTS) {
    const d = new Database(`data/tenants/${slug}.db`);
    const uid = d.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1").get().id;
    const token = randomBytes(32).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    d.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
      .run(token, uid, now, now + 900, randomBytes(32).toString('base64url'));
    // Un apunte "de pantalla" y otro "de DISA", ambos con la entidad canónica.
    const marca = 'zz-etiquetas-' + slug;
    logActivity(d, { userId: uid, userName: 'Gate Pantalla' }, 'Creó cliente', ENTITY.CLIENT, 991, marca);
    logDisa(d, 'create', ENTITY.CLIENT, 992, marca, null);
    marcas[slug] = { db: d, token, marca };
    creados.push({ db: d, token, marca });
  }
  for (const slug of TENANTS) {
    const { token, marca } = marcas[slug];
    const r = await pedir(slug, '/api/erp/users/activity?entity=' + ENTITY.CLIENT, { token });
    ok(r.status === 200, `${slug}: el endpoint filtrado responde 200`);
    const mios = (r.body || []).filter(l => l.details === marca);
    const autores = mios.map(l => l.user_name).sort();
    ok(mios.length === 2 && autores.join(',') === 'DISA,Gate Pantalla',
      `${slug}: filtrando por '${ENTITY.CLIENT}' salen los DOS apuntes (${autores.join(' + ') || 'ninguno'})`);
    const otro = TENANTS.find(t => t !== slug);
    ok(!(r.raw || '').includes('zz-etiquetas-' + otro), `${slug}: NO aparece la actividad de ${otro} (aislamiento)`);
    // Y el filtro filtra de verdad: pedir otra entidad no devuelve estos apuntes.
    const r2 = await pedir(slug, '/api/erp/users/activity?entity=' + ENTITY.WAREHOUSE, { token });
    ok(!(r2.raw || '').includes(marca), `${slug}: filtrando por otra entidad, estos apuntes no salen`);
  }
} finally {
  for (const { db, token, marca } of creados) {
    try {
      db.prepare('DELETE FROM activity_logs WHERE details=?').run(marca);   // filas NUESTRAS
      db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
      db.close();
    } catch {}
  }
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
  process.exit(fail ? 1 : 0);
}
