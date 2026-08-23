// GATE de la ficha B — CUPONES RETIRADOS + LAS 19 FACTURAS DE PRUEBA BORRADAS.
//   node scripts/gate-cupones-desmontados.mjs
//
// Prueba las DOS mitades del encargo contra el servidor REAL (:3000, el mismo proceso que Caddy
// proxya al público) y contra la BD real del tenant `desarrollo-bamburu`.
//
// TRES COSAS QUE ESTE GATE HACE A PROPÓSITO, Y POR QUÉ:
//
//  1. PIDE LAS RUTAS CON UNA SESIÓN VÁLIDA DE OWNER. Sin sesión, /admin/* redirige a login (302) y
//     /api/erp/* devuelve 401 — los devolvería igual si la pantalla siguiera montada. Medir eso sería
//     un verde por el motivo equivocado. Con sesión de dueño, un 404 solo puede significar una cosa:
//     la ruta no existe. (Y se comprueba a la vez que una pantalla VIVA sí da 200, para que un 404
//     por "el servidor está caído" no se disfrace de aprobado.)
//
//  2. LA CADENA DE VERIFACTU SE COMPARA, NO SE AFIRMA. `docs/ficha-b/linea-base.json` guarda el
//     SHA-256 de los 1050 registros y sus envíos TOMADO ANTES DE BORRAR NADA. Aquí se recalcula con
//     la misma receta y se exige que coincida byte a byte. Contar filas no bastaría: 1050 filas
//     alteradas siguen siendo 1050 filas.
//
//  3. LO DE DISA SE MIDE POR EL MECANISMO CUANDO SE PUEDE. El mapa de lectura y el evaluador son
//     exportados: se importan y se les pregunta de verdad ("¿puede un empleado consultar
//     discount_codes?"). Lo que vive dentro de la fábrica (WRITABLE_TABLES, el switch de acciones, la
//     lista blanca de URLs) no es alcanzable sin ejecutar el módulo, así que ahí se lee el fuente —y
//     se dice que es una comprobación de fuente, no de comportamiento.
//
// LO QUE ESTE GATE **NO** AFIRMA: que la cadena PROPIETARIA de `invoices`
// (verifactu_hash/prev_hash, la de superadmin/integridad.js) siga cuadrando. NO cuadra, y no puede:
// las 19 borradas eran la cabecera de la serie F. Está asumido y anotado en el TABLERO. Este gate lo
// COMPRUEBA Y LO IMPRIME para que nadie se lleve la sorpresa, pero no lo cuenta como fallo.
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tenantDb, APP_DIR, exigeCodigoServido } from './lib/gate-env.mjs';
import { QUERY_TABLE_READ_PERMS, evaluateQueryAccess } from '../modules/disa/index.js';
import { runMigrations } from '../modules/erp/models.js';
import { ventasResumen } from '../modules/erp/ventas-metrics.js';
import { verifyTenantInvoices } from '../modules/superadmin/integridad.js';

exigeCodigoServido();

const SLUG = 'desarrollo-bamburu';
const DB_PATH = tenantDb(SLUG);
const BASE = `http://${SLUG}.localhost:3000`;
const TOKEN_PREFIJO = 'gate-cupones-';

let pass = 0, fail = 0;
const ok = (c, m, det) => { if (c) { pass++; console.log('  ✓ ' + m + (det ? ' · ' + det : '')); } else { fail++; console.error('  ✗ ' + m + (det ? ' · ' + det : '')); } };
const info = (m) => console.log('    · ' + m);

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 10000');

// Sesión de OWNER. El token lleva prefijo para poder limpiar por prefijo en el `finally`: si el gate
// muere a mitad, la pasada siguiente no hereda sesiones vivas (el pecado de gate-almacenes).
const token = TOKEN_PREFIJO + randomBytes(24).toString('hex');
const ahora = Math.floor(Date.now() / 1000);
const owner = db.prepare("SELECT id FROM admin_users WHERE role='owner' AND active=1 ORDER BY id LIMIT 1").get();
if (!owner) { console.error('✗ GATE ABORTADO: no hay owner activo en ' + SLUG); process.exit(2); }
db.prepare('INSERT INTO admin_sessions (token,user_id,created_at,expires_at,csrf_token) VALUES (?,?,?,?,?)')
  .run(token, owner.id, ahora, ahora + 900, randomBytes(24).toString('hex'));
const H = { cookie: 'asess=' + token };

const BASE_JSON = path.join(APP_DIR, 'docs', 'ficha-b', 'linea-base.json');

try {
  // ═══ [1] LA PANTALLA Y SU API ESTÁN DESMONTADAS ══════════════════════════════════════════════
  console.log('\n[1] /admin/discounts y /api/erp/discounts ya no existen (con sesión de DUEÑO)');
  const pedir = async (p) => {
    const r = await fetch(BASE + p, { headers: H, redirect: 'manual' });
    return { status: r.status, loc: r.headers.get('location') || '' };
  };
  // Control primero: si esto no da 200, el gate no está midiendo el desmontaje sino un servidor roto.
  const vivo = await pedir('/admin/inventory');
  if (vivo.status !== 200) { console.error('✗ GATE ABORTADO: /admin/inventory no da 200 (' + vivo.status + '). El servidor o la sesión fallan; no se ha medido NADA.'); process.exit(2); }
  ok(true, 'control: una pantalla viva (/admin/inventory) responde 200 con esta sesión');

  for (const p of ['/admin/discounts', '/api/erp/discounts', '/api/erp/discounts/auto']) {
    const r = await pedir(p);
    ok(r.status === 404, `${p} → 404`, `got ${r.status}${r.loc ? ' → ' + r.loc : ''}`);
  }

  // ═══ [2] NI EN EL MENÚ NI EN EL BUSCADOR ═════════════════════════════════════════════════════
  console.log('\n[2] No queda rastro en el panel (menú + índice del buscador van en el MISMO HTML)');
  const html = await (await fetch(BASE + '/admin', { headers: H })).text();
  ok(html.includes('MENU_DESTINOS'), 'el HTML servido es el panel, no la pantalla de login', html.length + ' bytes');
  ok(!html.includes('/admin/discounts'), 'la cadena "/admin/discounts" NO aparece en el HTML del panel');
  ok(html.includes('/admin/inventory'), 'control: "/admin/inventory" sí aparece (el índice se está mirando de verdad)');

  // ═══ [3] LAS TABLAS: ARCHIVADAS, NO BORRADAS ═════════════════════════════════════════════════
  console.log('\n[3] Las tablas están ARCHIVADAS y sus datos intactos (nunca DROP)');
  const hay = (n) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
  ok(!hay('discount_codes') && !hay('auto_discounts'), 'discount_codes / auto_discounts ya no existen con su nombre vivo');
  ok(hay('discount_codes_archived') && hay('auto_discounts_archived'), 'existen discount_codes_archived / auto_discounts_archived');
  const cupones = db.prepare('SELECT COUNT(*) c FROM discount_codes_archived').get().c;
  ok(cupones === 3, 'los 3 cupones que había siguen ahí, legibles', cupones + ' filas');
  ok(!!db.prepare("SELECT 1 FROM settings WHERE key='migration_b_archive_discounts_2026_v1'").get(), 'la bandera de la migración está puesta');

  // Idempotencia y reversibilidad, sobre una COPIA: correr las migraciones otra vez no debe
  // resucitar las tablas vacías ni perder los datos archivados. Es el fallo que D1 tuvo que guardar
  // con `d1Archived`, y aquí se comprueba de verdad, ejecutando.
  const tmp = path.join(APP_DIR, 'data', 'copias-limpieza', 'gate-idempotencia.db');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const c2 = new Database(tmp);
  runMigrations(c2); runMigrations(c2);            // dos pasadas más, encima de la que ya corrió
  const hay2 = (n) => !!c2.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
  ok(!hay2('discount_codes') && !hay2('auto_discounts'), 'tras DOS pasadas más de migración, las tablas vivas NO reaparecen');
  ok(c2.prepare('SELECT COUNT(*) c FROM discount_codes_archived').get().c === 3, 'y los 3 cupones archivados siguen intactos');
  c2.close(); fs.rmSync(tmp, { force: true });

  // ═══ [4] DISA YA NO TIENE SUPERFICIE DE CUPONES ══════════════════════════════════════════════
  console.log('\n[4] DISA: sin cupones ni por lectura, ni por escritura, ni por enlace');
  // — Mecanismo real: el mapa exportado y el evaluador que usa el endpoint.
  ok(!('discount_codes' in QUERY_TABLE_READ_PERMS) && !('auto_discounts' in QUERY_TABLE_READ_PERMS),
     'las tablas salieron del mapa de lectura REAL (QUERY_TABLE_READ_PERMS)');
  const todasLasTablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  const veredicto = evaluateQueryAccess('SELECT * FROM discount_codes_archived', {
    isAdmin: false, allTables: todasLasTablas, hasPerm: () => true,
  });
  ok(typeof veredicto === 'string', 'evaluateQueryAccess DENIEGA la tabla archivada a un empleado', veredicto || 'la permitió');
  const control = evaluateQueryAccess('SELECT * FROM invoices', { isAdmin: false, allTables: todasLasTablas, hasPerm: () => true });
  ok(control === null, 'control: el mismo evaluador SÍ permite `invoices` (no está negando por sistema)');

  // — Comprobación de FUENTE (lo de dentro de la fábrica no es importable sin ejecutar el módulo).
  const fuenteDisa = fs.readFileSync(path.join(APP_DIR, 'modules', 'disa', 'index.js'), 'utf8');
  const sinComentarios = fuenteDisa.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const [aguja, que] of [
    ["'discount_codes'", 'WRITABLE_TABLES ya no incluye discount_codes'],
    ["'auto_discounts'", 'WRITABLE_TABLES ya no incluye auto_discounts'],
    ['create_discount:', 'ACTION_PERMS ya no declara create_discount'],
    ["case 'create_discount'", 'no queda el case create_discount'],
    ["case 'edit_discount'", 'no queda el case edit_discount'],
    ["case 'delete_discount'", 'no queda el case delete_discount'],
    ["'/admin/discounts'", 'la lista blanca de URLs ya no lleva /admin/discounts'],
    ['/admin/discounts,', 'el prompt de rutas permitidas tampoco'],
    ["FROM discount_codes", 'ninguna consulta viva lee discount_codes'],
  ]) ok(!sinComentarios.includes(aguja), '(fuente) ' + que);

  // Y que lo archivado no reaparezca en el esquema que se le enseña al modelo.
  const archivadas = todasLasTablas.filter(n => /_(archived|legacy)$/.test(n));
  ok(archivadas.length > 0, 'hay tablas archivadas en este negocio (si no, la siguiente no probaría nada)', archivadas.length + '');
  ok(/_\(archived\|legacy\)\$/.test(sinComentarios) || sinComentarios.includes('_(archived|legacy)$'),
     'getDbSchema filtra las tablas _archived/_legacy del prompt de DISA');

  // ═══ [5] LAS 19 FACTURAS YA NO EXISTEN, Y NO DEJARON HUÉRFANOS ═══════════════════════════════
  console.log('\n[5] Las 19 facturas de prueba ya no existen — y no dejaron nada colgando');
  const quedan = db.prepare(
    "SELECT COUNT(*) c FROM invoices i WHERE i.status='anulada' AND NOT EXISTS (SELECT 1 FROM verifactu_registros r WHERE r.invoice_id=i.id)"
  ).get().c;
  ok(quedan === 0, 'no queda ninguna factura anulada sin registro Verifactu', quedan + ' encontradas');
  const numeros = db.prepare("SELECT COUNT(*) c FROM invoices WHERE invoice_number IN ('F2026-0001','F2026-0011','F2026-0019','R2026-0001')").get().c;
  ok(numeros === 0, 'ni por número: F2026-0001, F2026-0011, F2026-0019 y R2026-0001 no están');

  const huerfanos = {
    invoice_items:       "SELECT COUNT(*) c FROM invoice_items       WHERE invoice_id NOT IN (SELECT id FROM invoices)",
    invoice_payments:    "SELECT COUNT(*) c FROM invoice_payments    WHERE invoice_id NOT IN (SELECT id FROM invoices)",
    invoice_anulaciones: "SELECT COUNT(*) c FROM invoice_anulaciones WHERE invoice_id NOT IN (SELECT id FROM invoices)",
    collection_actions:  "SELECT COUNT(*) c FROM collection_actions  WHERE invoice_id NOT IN (SELECT id FROM invoices)",
    verifactu_registros: "SELECT COUNT(*) c FROM verifactu_registros WHERE invoice_id NOT IN (SELECT id FROM invoices)",
    disa_proposals:      "SELECT COUNT(*) c FROM disa_proposals      WHERE invoice_id IS NOT NULL AND invoice_id NOT IN (SELECT id FROM invoices)",
    ledger_lines:        "SELECT COUNT(*) c FROM ledger_lines        WHERE entry_id   NOT IN (SELECT id FROM ledger_entries)",
    ledger_entries:      "SELECT COUNT(*) c FROM ledger_entries      WHERE origin_type='invoice' AND origin_id NOT IN (SELECT id FROM invoices)",
    ledger_cobros:       "SELECT COUNT(*) c FROM ledger_entries      WHERE origin_type='invoice_payment' AND origin_id NOT IN (SELECT id FROM invoice_payments)",
  };
  for (const [n, sql] of Object.entries(huerfanos)) {
    const c = db.prepare(sql).get().c;
    ok(c === 0, `sin huérfanos en ${n}`, c + '');
  }
  // ACTIVIDAD — aquí NO se exige cero, y hay que explicar por qué para que nadie lo "arregle" mal.
  // Este negocio ya arrastraba 11 apuntes con entity='invoice' apuntando a facturas inexistentes
  // (ids 145-155, del 15-jul-2026), muy anteriores a esta ficha. No son míos y limpiarlos no es de
  // esta tarea. Lo que sí es mío es no AÑADIR ni uno: por eso se compara contra la línea base.
  {
    const lineaTmp = JSON.parse(fs.readFileSync(BASE_JSON, 'utf8'));
    const c = db.prepare("SELECT COUNT(*) c FROM activity_logs WHERE entity='invoice' AND entity_id NOT IN (SELECT id FROM invoices)").get().c;
    ok(c <= lineaTmp.actividad_huerfana_previa,
       'la actividad huérfana NO creció (había 11 previos, ajenos a esta ficha)',
       `${c} ahora vs ${lineaTmp.actividad_huerfana_previa} antes`);
  }
  const fk = db.pragma('foreign_key_check');
  ok(fk.length === 0, 'foreign_key_check del motor: limpio', fk.length ? JSON.stringify(fk.slice(0, 3)) : '0 violaciones');

  // ═══ [6] LA CADENA DE VERIFACTU, IDÉNTICA — COMPARADA, NO AFIRMADA ═══════════════════════════
  console.log('\n[6] La cadena de Verifactu es la MISMA que antes de tocar nada');
  if (!fs.existsSync(BASE_JSON)) { console.error('✗ GATE ABORTADO: falta la línea base ' + BASE_JSON); process.exit(2); }
  const linea = JSON.parse(fs.readFileSync(BASE_JSON, 'utf8'));
  const regs = db.prepare(
    'SELECT id,invoice_id,record_type,id_emisor,num_serie,fecha_expedicion,tipo_factura,cuota_total,' +
    'importe_total,prev_huella,huella,fecha_hora_huso,primer_registro FROM verifactu_registros ORDER BY id'
  ).all();
  const env = db.prepare('SELECT id,registro_id,estado FROM verifactu_envios ORDER BY id').all();
  const sha = createHash('sha256').update(JSON.stringify({ regs, env })).digest('hex');
  ok(regs.length === linea.verifactu.registros, 'mismo número de registros', `${regs.length} vs ${linea.verifactu.registros}`);
  ok(env.length === linea.verifactu.envios, 'mismo número de envíos', `${env.length} vs ${linea.verifactu.envios}`);
  ok(sha === linea.verifactu.sha, 'SHA-256 de la cadena ENTERA idéntico', sha.slice(0, 16) + '… vs ' + linea.verifactu.sha.slice(0, 16) + '…');

  // ═══ [7] EL NEGOCIO CUADRA DESPUÉS ═══════════════════════════════════════════════════════════
  console.log('\n[7] El negocio cuadra: ventas, cobros y contabilidad');
  const dbRo = new Database(DB_PATH, { readonly: true });
  const v = ventasResumen(dbRo);
  dbRo.close();
  // Las 19 estaban ANULADAS: nunca contaron como venta. Si esta cifra se moviera, se habría borrado
  // algo que sí contaba — que es exactamente lo que no se quería.
  ok(v.count === linea.ventas.count && v.total === linea.ventas.total && v.base === linea.ventas.base,
     'las ventas NO se movieron (las 19 estaban anuladas y no contaban)',
     `${v.count} doc · ${v.total} € (base ${linea.ventas.count} doc · ${linea.ventas.total} €)`);
  const l = db.prepare('SELECT ROUND(SUM(debit),2) debe, ROUND(SUM(credit),2) haber FROM ledger_lines').get();
  ok(l.debe === l.haber, 'el libro sigue cuadrado', `debe ${l.debe} € = haber ${l.haber} €`);
  const bajaLibro = Math.round((linea.libro.debe - l.debe) * 100) / 100;
  ok(bajaLibro === 231.4, 'el libro bajó EXACTAMENTE los 3 asientos de cobro de las 19', bajaLibro + ' €');
  const cob = db.prepare('SELECT COUNT(*) c FROM invoice_payments').get().c;
  ok(cob === linea.cobros_total.c - 3, 'quedan 3 cobros menos, ni uno más', `${cob} vs ${linea.cobros_total.c} - 3`);
  const nInv = db.prepare('SELECT COUNT(*) c FROM invoices').get().c;
  ok(nInv === linea.facturas - 19, 'quedan 19 facturas menos, ni una más', `${nInv} vs ${linea.facturas} - 19`);

  // ── LO QUE NO SE AFIRMA, PERO SE MIRA Y SE DICE ──────────────────────────────────────────────
  console.log('\n[·] Cadena PROPIETARIA de invoices (superadmin/integridad.js) — informativo, NO cuenta');
  const integ = verifyTenantInvoices(DB_PATH);
  info(`resultado: ${integ.ok ? 'cuadra' : 'ALARMA'}` + (integ.alarm ? ` → ${integ.alarm.invoice_number}: ${integ.alarm.reason}` : ''));
  info('Esto ESTÁ ASUMIDO: las 19 eran la cabecera de la serie F y borrarlas deja a F2026-0012 sin');
  info('su eslabón anterior. Recomponerlo exigiría reescribir hashes de 700+ facturas. La cadena no se toca.');

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN: ' + e.message + '\n' + e.stack);
} finally {
  // Limpieza POR PREFIJO, no por la variable de esta pasada: si el gate muere a mitad, sus sesiones
  // no se quedan vivas para siempre.
  try { db.prepare("DELETE FROM admin_sessions WHERE token LIKE '" + TOKEN_PREFIJO + "%'").run(); } catch {}
  try { db.close(); } catch {}
}

console.log(`\n${'─'.repeat(70)}\nRESULTADO: ${pass} ✓  ·  ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
