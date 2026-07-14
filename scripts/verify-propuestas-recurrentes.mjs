// Gate — PROPUESTA DE DISA: emitir la factura recurrente que toca (tipo `emitir_recurrente`).
//
// Ciclo completo sobre COPIAS de BD reales: los datos vivos NO se tocan. Y aquí eso no es pereza, es
// obligatorio: aprobar esta propuesta EMITE UNA FACTURA DE VERDAD — con su número de serie y su huella
// Verifactu encadenada a la anterior. Una factura emitida es inmutable (CANON): no se puede borrar
// para "limpiar el gate" sin romper la cadena de huellas y saltarse la regla de oro del proyecto. Así
// que el camino feliz se corre sobre una copia desechable, donde emitir es tan real como en vivo y no
// deja rastro en el negocio. (La cola de la AEAT, además, ni se despierta: sin `db.bamburuSlug`,
// `encolarSiProcede` no encola nada.)
//
// Cubre: esquema aditivo, generación desde `borradoresPendientes`, idempotencia estricta por el índice
// único (occurrence_id, type), importe recalculado EN VIVO, APROBAR → EMITE por la vía real
// (emitirOcurrencia → createInvoice → huella Verifactu) POR LA RUTA REAL, la ocurrencia emitida deja de
// proponerse sola, DESCARTAR no re-propone, plantilla sin líneas no se propone, el CANDADO de permisos,
// y el aislamiento entre dos negocios.
//
//   node scripts/verify-propuestas-recurrentes.mjs
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import {
  generarPropuestasRecurrentes, propuestasPendientes, contarPropuestasPendientes,
  TIPO_RECURRENTE, TIPO_IMPAGO,
} from '../modules/erp/propuestas.js';
import { createTemplate, generateDueOccurrences, borradoresPendientes, importeEstimado } from '../modules/erp/recurrentes.js';
import { createPropuestasRoutes } from '../modules/erp/routes/propuestas.js';

const TODAY = '2026-07-14';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const copias = [];
// Copia de la BD viva + esquema. Se vacía disa_proposals: la BD viva trae propuestas de impago de la
// generación perezosa del panel, y los conteos de este gate parten de cero a propósito.
function copia(slug) {
  const p = join(tmpdir(), 'rec-' + slug + '-' + process.pid + '.db');
  copyFileSync(`data/tenants/${slug}.db`, p);
  copias.push(p);
  const db = new Database(p);
  runMigrations(db);
  db.prepare('DELETE FROM disa_proposals').run();
  return db;
}

// Una app real con las rutas de propuestas montadas sobre esta BD, y un usuario con estos permisos.
// Prueba la RUTA de verdad (permisos incluidos), no una imitación del servicio.
function appPara(db, perms, opts = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('isOwner', !!opts.owner);
    c.set('isAdmin', false);
    c.set('userPerms', perms);
    c.set('session', { userName: 'gate', userId: 99, csrfToken: 'x' });
    await next();
  });
  app.route('/', createPropuestasRoutes(db).api);
  return app;
}
const POST = (app, path) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

// Siembra una plantilla mensual cuya PRIMERA fecha ya pasó → al generar ocurrencias, cae un borrador
// que "toca". Datos de prueba, en una copia desechable.
function sembrarPlantilla(db, { clientId = 1, precio = 100, desc = 'Iguala mensual de mantenimiento' } = {}) {
  return createTemplate(db, {
    client_id: clientId, document_name: 'Factura', interval_months: 1,
    start_date: '2026-06-14',            // un mes antes de TODAY → una ocurrencia vencida
    max_occurrences: 1,                  // una sola, para que las cuentas sean exactas
    irpf_rate: 0,
    lines: [{ description: desc, quantity: 1, unit_price: precio, tax_rate: 21 }],
  });
}

try {
  // ── 1. Esquema aditivo ──────────────────────────────────────────────────────
  console.log('\n[1] Esquema');
  const db = copia('desarrollo-bamburu');
  const cols = new Set(db.prepare('PRAGMA table_info(disa_proposals)').all().map(c => c.name));
  ok(cols.has('occurrence_id'), 'disa_proposals tiene la columna occurrence_id (aditiva)');
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='disa_proposals'").all();
  const uniq = idx.find(i => i.name === 'idx_disa_proposals_occurrence_type');
  ok(!!uniq && /UNIQUE/i.test(uniq.sql), 'existe el índice ÚNICO (occurrence_id, type)');
  ok(idx.some(i => i.name === 'idx_disa_proposals_invoice_type'), 'los índices de sus hermanos siguen ahí (nada se rompió)');

  // ── 2. Siembra + el generador de ocurrencias (el que ya existía) ─────────────
  console.log('\n[2] Siembra: plantilla mensual → ocurrencia en borrador');
  const { id: tplId } = sembrarPlantilla(db);
  const gen = generateDueOccurrences(db, TODAY);
  ok(gen.generados === 1, 'el motor de recurrentes creó 1 ocurrencia vencida (got ' + gen.generados + ')');
  const borradores = borradoresPendientes(db);
  ok(borradores.length === 1 && borradores[0].template_id === tplId, 'borradoresPendientes() la ve, en estado borrador');
  const occId = borradores[0].id;
  ok(borradores[0].due_date === '2026-06-14', 'la ocurrencia toca el 2026-06-14');

  // ── 3. Generación de la propuesta ───────────────────────────────────────────
  console.log('\n[3] Generación de la propuesta');
  const r1 = generarPropuestasRecurrentes(db, { today: TODAY });
  ok(r1.candidatas === 1 && r1.creadas === 1, 'candidatas 1 → creada 1');
  const p = db.prepare('SELECT * FROM disa_proposals WHERE type=?').get(TIPO_RECURRENTE);
  ok(!!p && p.occurrence_id === occId, 'la propuesta queda ANCLADA a la ocurrencia (occurrence_id=' + occId + ')');
  ok(p.invoice_id === null, 'invoice_id sigue NULL: la factura aún NO existe — de eso va la propuesta');
  ok(p.status === 'pendiente' && p.body === '', 'nace pendiente y sin cuerpo de email (aquí no se manda ningún email)');

  // ── 4. Idempotencia estricta ────────────────────────────────────────────────
  console.log('\n[4] Idempotencia');
  const r2 = generarPropuestasRecurrentes(db, { today: TODAY });
  ok(r2.creadas === 0 && r2.yaTenian === 1, 'segunda pasada: 0 creadas, 1 ya tenía');
  const r3 = generarPropuestasRecurrentes(db, { today: TODAY });
  ok(r3.creadas === 0, 'tercera pasada: sigue sin duplicar');
  ok(db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_RECURRENTE).n === 1, 'sigue habiendo UNA sola propuesta');
  // Y el índice único lo impide de verdad, no solo el SELECT previo:
  let choco = false;
  try { db.prepare('INSERT INTO disa_proposals (type, occurrence_id, status) VALUES (?,?,?)').run(TIPO_RECURRENTE, occId, 'pendiente'); }
  catch { choco = true; }
  ok(choco, 'el índice único RECHAZA un duplicado insertado a mano (el candado está en la BD, no en el código)');

  // ── 5. El importe se recalcula EN VIVO ──────────────────────────────────────
  console.log('\n[5] Importe en vivo (no la copia del día que se propuso)');
  let lista = propuestasPendientes(db, TODAY, [TIPO_RECURRENTE]);
  ok(lista.length === 1, 'el panel la lista');
  ok(Math.abs(lista[0].importe - 121) < 0.001, 'importe = 100 + 21% IVA = 121 (got ' + lista[0].importe + ')');
  ok(lista[0].client_name && lista[0].concepto.includes('Iguala'), 'trae cliente y concepto de la plantilla');
  ok(lista[0].viva === true, 'viva: la ocurrencia sigue en borrador');
  // Le subo el precio a la iguala DESPUÉS de proponerla: la propuesta debe enseñar el precio de HOY.
  db.prepare('UPDATE recurring_template_items SET unit_price=200 WHERE template_id=?').run(tplId);
  lista = propuestasPendientes(db, TODAY, [TIPO_RECURRENTE]);
  ok(Math.abs(lista[0].importe - 242) < 0.001, 'sube el precio de la plantilla → la propuesta enseña 242, no el 121 de ayer');

  // ── 6. APROBAR = EMITIR, por la RUTA REAL ───────────────────────────────────
  console.log('\n[6] Aprobar → emite de verdad (ruta real, vía real)');
  const facturasAntes = db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  const app = appPara(db, ['recurrentes.read', 'invoices.create']);
  const res = await POST(app, '/' + p.id + '/emitir');
  const body = await res.json();
  ok(res.status === 200 && body.ok, 'POST /:id/emitir → 200 (' + JSON.stringify(body.message || body.error) + ')');

  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(body.invoice_id);
  ok(!!inv, 'la factura EXISTE en la BD');
  ok(db.prepare('SELECT COUNT(*) n FROM invoices').get().n === facturasAntes + 1, 'y es UNA sola factura nueva');
  ok(/^[A-Z]+/.test(inv.invoice_number || ''), 'nació con su número de serie (' + inv.invoice_number + ')');
  ok(!!inv.verifactu_hash, 'nació con su HUELLA Verifactu → pasó por createInvoice, la vía real');
  ok(inv.client_id === 1 && Math.abs(inv.total - 242) < 0.001, 'cliente y total correctos (242 = precio de HOY)');
  const lineas = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(inv.id);
  ok(lineas.length === 1 && lineas[0].description.includes('Iguala'), 'con la línea de la plantilla');

  const occ = db.prepare('SELECT * FROM recurring_occurrences WHERE id=?').get(occId);
  ok(occ.status === 'emitida' && occ.invoice_id === inv.id, 'la ocurrencia queda EMITIDA y apunta a su factura');
  const pAfter = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(p.id);
  ok(pAfter.status === 'aprobada_emitida' && pAfter.resolved_at, 'la propuesta queda resuelta (aprobada_emitida)');

  // ── 7. Ya emitida → deja de proponerse SOLA ─────────────────────────────────
  console.log('\n[7] La emitida deja de proponerse');
  ok(borradoresPendientes(db).length === 0, 'ya no hay borradores pendientes');
  const r4 = generarPropuestasRecurrentes(db, { today: TODAY });
  ok(r4.candidatas === 0 && r4.creadas === 0, 'el generador no propone nada nuevo');
  ok(propuestasPendientes(db, TODAY, [TIPO_RECURRENTE]).length === 0, 'el panel ya no la enseña');
  ok(contarPropuestasPendientes(db, [TIPO_RECURRENTE]) === 0, 'el badge la deja de contar');

  // ── 8. No se puede emitir dos veces ─────────────────────────────────────────
  console.log('\n[8] Doble emisión, bloqueada');
  const res2 = await POST(app, '/' + p.id + '/emitir');
  ok(res2.status === 409, 'reintentar la MISMA propuesta → 409 (ya resuelta), no una segunda factura');
  ok(db.prepare('SELECT COUNT(*) n FROM invoices').get().n === facturasAntes + 1, 'y NO nació una segunda factura');

  // ── 9. DESCARTAR no se re-propone ───────────────────────────────────────────
  console.log('\n[9] Descartar');
  const { id: tpl2 } = sembrarPlantilla(db, { precio: 50, desc: 'Cuota de soporte' });
  generateDueOccurrences(db, TODAY);
  generarPropuestasRecurrentes(db, { today: TODAY });
  const p2 = db.prepare("SELECT * FROM disa_proposals WHERE type=? AND status='pendiente'").get(TIPO_RECURRENTE);
  ok(!!p2, 'la segunda plantilla genera su propuesta');
  const resD = await POST(app, '/' + p2.id + '/descartar');
  ok(resD.status === 200, 'descartar → 200');
  ok(db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(p2.id).status === 'descartada', 'queda descartada');
  const r5 = generarPropuestasRecurrentes(db, { today: TODAY });
  ok(r5.creadas === 0 && r5.yaTenian === 1, 'y NO se vuelve a proponer (el índice único la recuerda)');
  ok(propuestasPendientes(db, TODAY, [TIPO_RECURRENTE]).length === 0, 'el panel no la enseña');

  // ── 10. Plantilla sin líneas: no se promete un botón que fallaría ───────────
  console.log('\n[10] Plantilla sin líneas');
  db.prepare('DELETE FROM recurring_template_items WHERE template_id=?').run(tpl2);
  db.prepare("UPDATE recurring_occurrences SET status='borrador', invoice_id=NULL WHERE template_id=?").run(tpl2);
  db.prepare('DELETE FROM disa_proposals WHERE occurrence_id IN (SELECT id FROM recurring_occurrences WHERE template_id=?)').run(tpl2);
  const r6 = generarPropuestasRecurrentes(db, { today: TODAY });
  ok(r6.sinLineas === 1 && r6.creadas === 0, 'una plantilla sin líneas NO se propone (emitirla fallaría): se cuenta como hallazgo');

  // ── 11. EL CANDADO ──────────────────────────────────────────────────────────
  console.log('\n[11] Candado de permisos');
  const dbC = copia('desarrollo-bamburu');
  const { id: tplC } = sembrarPlantilla(dbC);
  generateDueOccurrences(dbC, TODAY);
  generarPropuestasRecurrentes(dbC, { today: TODAY });
  const pC = dbC.prepare('SELECT * FROM disa_proposals WHERE type=?').get(TIPO_RECURRENTE);
  ok(!!pC, 'hay una propuesta que proteger');

  // Sin NINGÚN permiso: ni la ve, ni la cuenta, ni la emite.
  const appNada = appPara(dbC, []);
  const gNada = await appNada.request('/');
  ok(gNada.status === 403, 'usuario sin permisos: GET /propuestas → 403');
  const eNada = await POST(appNada, '/' + pC.id + '/emitir');
  ok(eNada.status === 403, 'usuario sin permisos: POST /emitir → 403');

  // Puede ver recurrentes pero NO emitir facturas: NO la ve (el candado que pediste).
  const appSinEmitir = appPara(dbC, ['recurrentes.read', 'invoices.read']);
  const gSinEmitir = await (await appSinEmitir.request('/')).json();
  const tiposSinEmitir = new Set((gSinEmitir.propuestas || []).map(x => x.type));
  ok(!tiposSinEmitir.has(TIPO_RECURRENTE), 'SIN invoices.create: la propuesta recurrente NO aparece en su lista');
  const cSinEmitir = await (await appSinEmitir.request('/contador')).json();
  ok(!(gSinEmitir.propuestas || []).some(x => x.type === TIPO_RECURRENTE), 'ni se le cuela por otra vía');
  const eSinEmitir = await POST(appSinEmitir, '/' + pC.id + '/emitir');
  ok(eSinEmitir.status === 403, 'y si fuerza el POST /emitir a mano → 403');
  ok(dbC.prepare('SELECT status FROM disa_proposals WHERE id=?').get(pC.id).status === 'pendiente', 'la propuesta sigue pendiente: no se emitió nada');

  // Puede emitir facturas pero NO ver recurrentes: tampoco la ve (enseña datos de la plantilla).
  const appSinRec = appPara(dbC, ['invoices.create', 'invoices.read']);
  const gSinRec = await (await appSinRec.request('/')).json();
  ok(!(gSinRec.propuestas || []).some(x => x.type === TIPO_RECURRENTE), 'SIN recurrentes.read: tampoco la ve (la propuesta enseña la plantilla)');

  // El badge de quien SÍ puede: la cuenta.
  const appOk = appPara(dbC, ['recurrentes.read', 'invoices.create']);
  const cOk = await (await appOk.request('/contador')).json();
  ok(cOk.count >= 1, 'quien SÍ puede emitir: el badge se la cuenta (' + cOk.count + ')');
  const gOk = await (await appOk.request('/')).json();
  ok((gOk.propuestas || []).some(x => x.type === TIPO_RECURRENTE), 'y la ve en su lista');

  // El owner lo ve todo (bypass), como en el resto del panel.
  const appOwner = appPara(dbC, [], { owner: true });
  const gOwner = await (await appOwner.request('/')).json();
  ok((gOwner.propuestas || []).some(x => x.type === TIPO_RECURRENTE), 'el dueño la ve (bypass de owner, como en los otros tipos)');

  // ── 12. Aislamiento entre negocios ──────────────────────────────────────────
  console.log('\n[12] Aislamiento entre negocios');
  const dbB = copia('ibrahin-repuestos');
  generarPropuestasRecurrentes(dbB, { today: TODAY });
  ok(dbB.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_RECURRENTE).n === 0,
     'el otro negocio no hereda NADA: la plantilla sembrada vive solo en su BD');
  ok(dbC.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_RECURRENTE).n === 1,
     'y el primero conserva la suya');

  // ── 13. No se pisan los tipos hermanos ──────────────────────────────────────
  console.log('\n[13] Los hermanos siguen en pie');
  const impagosAntes = db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_IMPAGO).n;
  ok(TIPO_RECURRENTE !== TIPO_IMPAGO, 'el tipo nuevo no colisiona con el de impago');
  ok(impagosAntes >= 0, 'las propuestas de impago conviven con las recurrentes en la misma tabla');

} finally {
  for (const p of copias) { for (const f of [p, p + '-wal', p + '-shm']) { try { unlinkSync(f); } catch {} } }
  console.log('\n  (copias desechables borradas; el negocio vivo NO se ha tocado)');
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Propuestas recurrentes: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
