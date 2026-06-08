// T4 Paso 2 — tests de lógica del pipeline de cobros (perfiles, próxima acción,
// priorización, plantillas, servicio de escritura) + consistencia de las 3 superficies
// + voz de DISA. Ejecuta sobre BD :memory: con el runMigrations real. No toca BD real.
//
//   node scripts/test-cobros-paso2.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  calcularProximaAccion, priorizarCobros, collectionsWorklist,
  invoiceProximaAccion, registerCollectionAction, collectionEmail,
  invoiceActionHistory, activeActions, CADENCIAS,
} from '../modules/erp/cobros.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

const TODAY = '2026-06-08';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("UPDATE company_config SET company_name=?, email=?, currency_symbol=? WHERE id=1").run('Autónomo SL', 'yo@autonomo.es', '€');
  return db;
}
let seq = 0;
function addClient(db, profile, email = 'cliente@x.es', name = 'Cliente') {
  return db.prepare("INSERT INTO clients (name,email,active,collections_profile) VALUES (?,?,1,?)").run(name, email, profile).lastInsertRowid;
}
function addInvoice(db, { clientId, due, total = 100, status = 'emitida', number }) {
  number = number || ('F2026-' + (++seq));
  return db.prepare(`INSERT INTO invoices
    (invoice_number, client_id, year, sequence, issue_date, company_name, company_fiscal_id, due_date, total, status)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(number, clientId, 2026, seq, '2026-01-01', 'Autónomo SL', 'B123', due, total, status).lastInsertRowid;
}
// factura sintética para probar el motor puro (sin BD)
function fac(due, pendiente, extra = {}) { return { due_date: due, total: 100, pendiente, estado: pendiente <= 0 ? 'cobrada' : 'pendiente', counts: true, ...extra }; }

// ── 1. CADENCIAS por perfil (próxima acción según dpd) ──────────────────────
console.log('1. Cadencias por perfil');
{
  // estandar r1 +3: vencida hace 4 días, sin acciones → 1er recordatorio amable.
  const p = calcularProximaAccion(fac('2026-06-04', 100), { collections_profile: 'estandar' }, [], TODAY);
  eq(p.etapa, 'r1', 'estandar dpd4 → r1');
  eq(p.accion, 'recordatorio_email', 'estandar r1 propone email');
  eq(p.tono, 'amable', 'estandar r1 tono amable');

  // estandar r2 +15: vencida hace 19 días, r1 ya hecho → 2º recordatorio firme-medio.
  const log1 = [{ type: 'recordatorio_email', stage: 'r1' }];
  const p2 = calcularProximaAccion(fac('2026-05-20', 100), { collections_profile: 'estandar' }, log1, TODAY);
  eq(p2.etapa, 'r2', 'estandar dpd19 + r1 hecho → r2');
  eq(p2.tono, 'firme-medio', 'estandar r2 tono firme-medio');

  // suave r1 +7: vencida hace 4 días (<7) → aún sin acción (por_vencer/espera), no r1.
  const ps = calcularProximaAccion(fac('2026-06-04', 100), { collections_profile: 'suave' }, [], TODAY);
  eq(ps.etapa, 'por_vencer', 'suave dpd4 (<7) → sin acción aún');
  eq(ps.accion, null, 'suave dpd4 no propone acción');

  // suave en_riesgo +90: vencida hace 100 días, r1/r2/firme hechos → en_riesgo, tono última.
  const logS = [{ type: 'recordatorio_email', stage: 'r1' }, { type: 'recordatorio_email', stage: 'r2' }, { type: 'recordatorio_email', stage: 'firme' }];
  const pr = calcularProximaAccion(fac('2026-02-28', 100), { collections_profile: 'suave' }, logS, TODAY);
  eq(pr.etapa, 'en_riesgo', 'suave dpd100 + 3 pasos → en_riesgo');
  eq(pr.tono, 'ultima', 'en_riesgo tono última');

  // firme r1 +1: vencida hace 2 días → r1 ya accionable (umbral 1).
  const pf = calcularProximaAccion(fac('2026-06-06', 100), { collections_profile: 'firme' }, [], TODAY);
  eq(pf.etapa, 'r1', 'firme dpd2 (>=1) → r1');

  // Umbrales fijos correctos.
  eq(CADENCIAS.estandar.firme, 30, 'estandar firme = +30');
  eq(CADENCIAS.firme.en_riesgo, 30, 'firme en_riesgo = +30');
}

// ── 2. Promesa de pago ──────────────────────────────────────────────────────
console.log('2. Promesa de pago');
{
  // Promesa viva (promised_date >= hoy) → no se reclama; etapa promesa, sin acción.
  const logProm = [{ type: 'promesa_pago', promised_date: '2026-06-20' }];
  const p = calcularProximaAccion(fac('2026-05-20', 100), { collections_profile: 'estandar' }, logProm, TODAY);
  eq(p.etapa, 'promesa', 'promesa viva → etapa promesa');
  eq(p.accion, null, 'promesa viva no propone acción');
  eq(p.fechaObjetivo, '2026-06-20', 'promesa fechaObjetivo = promised_date');

  // Promesa incumplida (promised_date < hoy, impagada) → reanuda cadencia + sube tono.
  const logRoto = [{ type: 'promesa_pago', promised_date: '2026-06-01' }];
  const pr = calcularProximaAccion(fac('2026-05-20', 100), { collections_profile: 'estandar' }, logRoto, TODAY);
  eq(pr.etapa, 'r1', 'promesa incumplida → reanuda cadencia (r1)');
  eq(pr.tono, 'firme-medio', 'promesa incumplida sube tono amable→firme-medio');
  ok(/incumplida/i.test(pr.motivo), 'motivo indica promesa incumplida');
}

// ── 3. Perfil manual + factura cobrada → null ───────────────────────────────
console.log('3. Manual y cobrada');
{
  const pm = calcularProximaAccion(fac('2026-05-01', 100), { collections_profile: 'manual' }, [], TODAY);
  eq(pm.etapa, 'manual', 'perfil manual → etapa manual');
  eq(pm.accion, null, 'perfil manual no propone acción');

  const pc = calcularProximaAccion(fac('2026-05-01', 0, { estado: 'cobrada' }), { collections_profile: 'estandar' }, [], TODAY);
  eq(pc, null, 'factura cobrada → null');

  const pn = calcularProximaAccion({ ...fac('2026-05-01', 100), counts: false }, { collections_profile: 'estandar' }, [], TODAY);
  eq(pn, null, 'no computa (anulada/sustituida) → null');
}

// ── 4. Priorización explicable ──────────────────────────────────────────────
console.log('4. Priorización');
{
  const items = [
    { invoice_id: 1, pendiente: 50, dias_vencida: 5, proximaAccion: { etapa: 'r1' } },
    { invoice_id: 2, pendiente: 300, dias_vencida: 62, proximaAccion: { etapa: 'en_riesgo' } },
    { invoice_id: 3, pendiente: 100, dias_vencida: 20, proximaAccion: { etapa: 'r2' } },
    { invoice_id: 4, pendiente: 999, dias_vencida: 0, proximaAccion: { etapa: 'promesa' } },
  ];
  const ord = priorizarCobros(items);
  eq(ord.map(i => i.invoice_id), [2, 3, 1, 4], 'orden: en_riesgo > r2 > r1 > promesa');
  ok(ord.every(i => typeof i.motivo === 'string' && i.motivo.length), 'cada item lleva motivo');
}

// ── 5. Servicio de escritura (= lo que ejecuta el endpoint y DISA) ───────────
console.log('5. Servicio registerCollectionAction');
{
  const db = freshDb();
  const cid = addClient(db, 'estandar');
  const id = addInvoice(db, { clientId: cid, due: '2026-05-20', total: 300 });

  // recordatorio_email → dispara Resend (mock) y registra en el log.
  let sent = null;
  const mock = async (payload) => { sent = payload; return { data: { id: 'em_test' }, error: null }; };
  const r1 = await registerCollectionAction(db, id, { type: 'recordatorio_email' }, { sendEmail: mock, today: TODAY, now: TODAY + 'T10:00:00Z' });
  ok(sent && sent.to === 'cliente@x.es', 'recordatorio_email envió email al cliente');
  ok(sent.subject && sent.text, 'email con asunto y cuerpo');
  eq(r1.email.sent, true, 'servicio reporta email enviado');
  eq(activeActions(db, id).length, 1, 'recordatorio quedó en el log');
  eq(activeActions(db, id)[0].stage, 'r1', 'stage registrado = etapa actual (dpd19, sin previos → r1)');

  // contacto_manual → solo registra, sin email.
  sent = null;
  await registerCollectionAction(db, id, { type: 'contacto_manual', channel: 'telefono', note: 'Llamé' }, { sendEmail: mock, today: TODAY, now: TODAY + 'T11:00:00Z' });
  eq(sent, null, 'contacto_manual NO envía email');
  const log = invoiceActionHistory(db, id);
  ok(log.some(a => a.type === 'contacto_manual' && a.channel === 'telefono'), 'contacto registrado con canal');

  // promesa_pago → registra promised_date.
  await registerCollectionAction(db, id, { type: 'promesa_pago', promised_date: '2026-06-30' }, { sendEmail: mock, today: TODAY, now: TODAY + 'T12:00:00Z' });
  ok(invoiceActionHistory(db, id).some(a => a.type === 'promesa_pago' && a.promised_date === '2026-06-30'), 'promesa con fecha registrada');

  // Tras la promesa viva, la próxima acción se pospone (etapa promesa).
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  eq(invoiceProximaAccion(db, inv, TODAY).etapa, 'promesa', 'promesa viva pospone próxima acción');

  // Rechazo 400 sobre factura NO viva (anulada) — mismo doble seguro de Paso 1.
  const idAnu = addInvoice(db, { clientId: cid, due: '2026-05-01', total: 100, status: 'anulada' });
  let threw = null;
  try { await registerCollectionAction(db, idAnu, { type: 'contacto_manual', channel: 'otro' }, { sendEmail: mock, today: TODAY }); }
  catch (e) { threw = e; }
  ok(threw && threw.status === 400, 'factura anulada → error 400');
  eq(activeActions(db, idAnu).length, 0, 'no se registró nada sobre la factura no viva');

  db.close();
}

// ── 6. Consistencia de las TRES superficies (misma próxima acción) ──────────
console.log('6. Tres superficies coherentes');
{
  const db = freshDb();
  const cid = addClient(db, 'estandar');
  const id = addInvoice(db, { clientId: cid, due: '2026-05-20', total: 300, number: 'F2026-AA' });
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);

  // Superficie A (Cobros): worklist priorizado.
  const wl = collectionsWorklist(db, TODAY);
  const row = wl.rows.find(r => r.invoice_id === id);
  ok(row, 'la deuda aparece en el worklist de Cobros');
  // Superficie B/C (ficha + listado de facturas): invoiceProximaAccion.
  const prox = invoiceProximaAccion(db, inv, TODAY);
  eq(row.proximaAccion.etapa, prox.etapa, 'Cobros y factura/ficha → misma etapa');
  eq(row.proximaAccion.accion, prox.accion, 'Cobros y factura/ficha → misma acción');
  eq(prox.etapa, 'r1', 'próxima acción coherente = r1');
  ok(typeof wl.total === 'number' && wl.total >= 300, 'total global incluye la deuda');

  db.close();
}

// ── 7. DISA: summary priorizado + escritura por el servicio (no insert directo) ──
console.log('7. DISA cobros');
{
  const db = freshDb();
  const cA = addClient(db, 'firme', 'a@x.es', 'Ana');
  const cB = addClient(db, 'estandar', 'b@x.es', 'Bea');
  const iA = addInvoice(db, { clientId: cA, due: '2026-03-01', total: 500 }); // muy vencida
  const iB = addInvoice(db, { clientId: cB, due: '2026-06-04', total: 100 }); // poco vencida

  // get_collections_summary (lo que DISA lee del contexto) = worklist priorizado con próxima acción.
  const wl = collectionsWorklist(db, TODAY);
  ok(wl.rows.length === 2, 'summary lista las 2 deudas');
  eq(wl.rows[0].invoice_id, iA, 'la más urgente (firme, +99d) va primero');
  ok(wl.rows.every(r => 'proximaAccion' in r), 'cada deuda lleva próxima acción');

  // register_collection_action de DISA pasa por el MISMO servicio (no INSERT directo).
  let sent = null;
  const mock = async (p) => { sent = p; return { data: { id: 'x' }, error: null }; };
  await registerCollectionAction(db, iB, { type: 'recordatorio_email' }, { sendEmail: mock, today: TODAY, now: TODAY + 'T09:00:00Z' });
  ok(sent && sent.to === 'b@x.es', 'DISA (vía servicio) envió el recordatorio');
  eq(invoiceActionHistory(db, iB).length, 1, 'quedó registrado por el servicio');

  // Plantillas por tono diferenciadas.
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(iA);
  const company = db.prepare('SELECT * FROM company_config WHERE id=1').get();
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(cA);
  const t1 = collectionEmail('amable', { inv, client, cobro: { pendiente: 500 }, company });
  const t4 = collectionEmail('ultima', { inv, client, cobro: { pendiente: 500 }, company });
  ok(t1.subject !== t4.subject, 'asunto cambia según tono');
  ok(/última gestión/i.test(t4.text), 'tono última menciona última gestión');

  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' Paso 2: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
