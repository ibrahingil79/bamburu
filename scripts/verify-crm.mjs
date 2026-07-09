// Verificación CRM COMERCIAL · embudo de oportunidades + actividad de cliente.
// Espejo de verify-recurrentes.mjs / verify-conciliacion.mjs: motor puro contra BD temporal.
//   node scripts/verify-crm.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os'; import { join } from 'path'; import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import {
  ETAPA_PROB,
  createOpportunitySvc, updateOpportunitySvc, moveOpportunityStageSvc, closeOpportunitySvc,
  reopenOpportunitySvc, archiveOpportunitySvc, registerClientActivitySvc,
  calcularProximaAccionOportunidad, opportunityActivities,
  salesWorklist, pipelineByStage, clientTimeline, clientCrmSummary, opportunityEmail,
} from '../modules/erp/crm.js';

const DBF = join(tmpdir(), 'crm-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
// Reloj determinista: los servicios aceptan opts.now/opts.today, y calcular* recibe `hoy`.
const at = d => ({ now: d + 'T09:00:00.000Z', today: d });
const throws = (fn, status) => { try { fn(); return false; } catch (e) { return status ? e.status === status : true; } };
// Espejo async: registerClientActivitySvc es async → rechaza la promesa, no lanza síncrono.
const throwsA = async (fn, status) => { try { await fn(); return false; } catch (e) { return status ? e.status === status : true; } };

try {
  runMigrations(db);

  console.log('\n=== Migración: las dos tablas nuevas, aditivas ===\n');
  const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('opportunities','client_activities')").all().map(r => r.name).sort();
  ok(tbls.length === 2, 'runMigrations crea opportunities + client_activities');
  const perms = db.prepare("SELECT COUNT(*) n FROM permissions WHERE module='crm'").get().n;
  ok(perms === 2, 'permisos crm.read + crm.manage sembrados');

  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, currency_symbol) VALUES (1,'Reformas Test SL','89890001K','ES','€')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, email, client_type) VALUES ('Cliente Uno','B12345678','uno@ejemplo.com','empresa')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type) VALUES ('Cliente Dos (sin email)','B87654321','empresa')").run();
  const c1 = db.prepare("SELECT id FROM clients WHERE name='Cliente Uno'").get().id;
  const c2 = db.prepare("SELECT id FROM clients WHERE name LIKE 'Cliente Dos%'").get().id;

  console.log('\n=== Crear oportunidad: probabilidad por defecto = la de la etapa ===\n');
  const A = createOpportunitySvc(db, { client_id: c1, title: 'Reforma baño', amount: 1000, stage: 'nuevo' }, at('2026-03-01'));
  ok(A.probability === ETAPA_PROB.nuevo && A.probability === 10, 'sin probabilidad → toma la de la etapa (nuevo = 10%)');
  const B = createOpportunitySvc(db, { client_id: c1, title: 'Cocina completa', amount: 5000, stage: 'propuesta' }, at('2026-03-01'));
  ok(B.probability === 60, 'propuesta → 60%');
  // Personalizada: prob distinta de la de su etapa.
  const C = createOpportunitySvc(db, { client_id: c2, title: 'Pintura piso', amount: 800, stage: 'nuevo', probability: 50 }, at('2026-03-01'));
  ok(C.probability === 50, 'probabilidad explícita se respeta (personalizada)');
  ok(throws(() => createOpportunitySvc(db, { client_id: 99999, title: 'X' }), 404), 'cliente inexistente → 404');

  console.log('\n=== Mover de etapa: prob sigue a la etapa salvo personalizada; deja registro ===\n');
  const mvA = moveOpportunityStageSvc(db, A.id, 'cualificado', at('2026-03-03'));
  ok(mvA.probability === 30, 'A (10 = default) al mover a cualificado → prob sigue a 30');
  const mvC = moveOpportunityStageSvc(db, C.id, 'cualificado', at('2026-03-03'));
  ok(mvC.probability === 50, 'C (50 = personalizada) al mover → conserva su 50');
  const logA = opportunityActivities(db, A.id);
  ok(logA.length === 1 && logA[0].type === 'cambio_etapa' && logA[0].stage === 'cualificado', 'mover deja actividad cambio_etapa con la etapa nueva');
  ok(throws(() => moveOpportunityStageSvc(db, A.id, 'cualificado'), 400), 'mover a la misma etapa → 400 (no reinicia el reloj)');
  ok(throws(() => moveOpportunityStageSvc(db, A.id, 'no_existe'), 400), 'etapa inválida → 400');

  console.log('\n=== Próxima acción: cadencia de silencio de la etapa ===\n');
  const oppA = db.prepare('SELECT * FROM opportunities WHERE id=?').get(A.id);
  // A movida a cualificado el 03-03 (cadencia 5). Al día 07-03 → silencio 4 < 5 → informativo.
  let p = calcularProximaAccionOportunidad(oppA, opportunityActivities(db, A.id), '2026-03-07');
  ok(p && p.accion === null && p.etapa === 'cualificado', 'dentro de cadencia → informativo, sin acción');
  // Al día 09-03 → silencio 6 ≥ 5 → toca seguimiento.
  p = calcularProximaAccionOportunidad(oppA, opportunityActivities(db, A.id), '2026-03-09');
  ok(p && p.accion === 'seguimiento', 'silencio ≥ cadencia → propone seguimiento');

  console.log('\n=== Compromiso vivo pospone; en_riesgo manda si venció el cierre ===\n');
  registerClientActivitySvc(db, c1, { type: 'compromiso', opportunity_id: A.id, commitment_date: '2026-03-20' }, at('2026-03-09'));
  p = calcularProximaAccionOportunidad(db.prepare('SELECT * FROM opportunities WHERE id=?').get(A.id), opportunityActivities(db, A.id), '2026-03-10');
  ok(p && p.etapa === 'compromiso' && p.accion === null, 'compromiso hasta 20-03 → no insistir hasta esa fecha');
  // Oportunidad con cierre previsto ya pasado y sin compromiso → en_riesgo/revisar.
  const R = createOpportunitySvc(db, { client_id: c1, title: 'Tejado', amount: 3000, stage: 'negociacion', expected_close_date: '2026-02-20' }, at('2026-02-10'));
  p = calcularProximaAccionOportunidad(db.prepare('SELECT * FROM opportunities WHERE id=?').get(R.id), [], '2026-03-01');
  ok(p && p.etapa === 'en_riesgo' && p.accion === 'revisar', 'cierre previsto vencido + abierta → en_riesgo (revisar)');

  console.log('\n=== Cerrar: ganada (prob→100) / perdida exige motivo ===\n');
  const cB = closeOpportunitySvc(db, B.id, { status: 'ganada' }, at('2026-03-05'));
  const rowB = db.prepare('SELECT * FROM opportunities WHERE id=?').get(B.id);
  ok(cB.status === 'ganada' && rowB.probability === 100 && rowB.closed_at && rowB.stage === 'propuesta', 'ganada → prob 100, closed_at, CONSERVA la etapa (propuesta)');
  ok(throws(() => closeOpportunitySvc(db, A.id, { status: 'perdida' }), 400), 'perdida sin motivo → 400');
  ok(throws(() => closeOpportunitySvc(db, A.id, { status: 'perdida', lost_reason: 'otro' }), 400), 'perdida motivo «otro» sin nota → 400');
  const cA = closeOpportunitySvc(db, A.id, { status: 'perdida', lost_reason: 'precio' }, at('2026-03-06'));
  const rowA = db.prepare('SELECT * FROM opportunities WHERE id=?').get(A.id);
  ok(cA.status === 'perdida' && rowA.lost_reason === 'precio' && rowA.probability === 0 && rowA.stage === 'cualificado', 'perdida → lost_reason, prob 0, CONSERVA etapa (cualificado = dónde se cayó)');
  ok(throws(() => moveOpportunityStageSvc(db, A.id, 'nuevo'), 400), 'no se opera una oportunidad ya cerrada → 400');

  console.log('\n=== Reabrir: vuelve a activa en su etapa, con registro ===\n');
  reopenOpportunitySvc(db, A.id, at('2026-03-07'));
  const reA = db.prepare('SELECT * FROM opportunities WHERE id=?').get(A.id);
  ok(reA.status === 'activa' && reA.stage === 'cualificado' && reA.lost_reason === null && reA.probability === ETAPA_PROB.cualificado, 'reabrir → activa, misma etapa, motivo limpio, prob de la etapa');

  console.log('\n=== Actividad de cliente: reglas por tipo ===\n');
  ok(await throwsA(() => registerClientActivitySvc(db, c1, { type: 'contacto' }), 400), 'contacto sin canal → 400');
  ok(await throwsA(() => registerClientActivitySvc(db, c1, { type: 'compromiso' }), 400), 'compromiso sin fecha → 400');
  const act = await registerClientActivitySvc(db, c1, { type: 'contacto', channel: 'telefono', note: 'Llamada' }, at('2026-03-08'));
  ok(act && act.type === 'contacto', 'contacto con canal → registrado');
  ok(await throwsA(() => registerClientActivitySvc(db, c1, { type: 'cambio_etapa' }), 400), 'tipo automático (cambio_etapa) no se registra a mano → 400');
  // Oportunidad de OTRO cliente no puede colgarse de esta ficha.
  let cross = false; try { await registerClientActivitySvc(db, c1, { type: 'nota', opportunity_id: C.id, note: 'x' }); } catch (e) { cross = e.status === 400; }
  ok(cross, 'oportunidad de otro cliente → 400 (no se cruzan fichas)');

  console.log('\n=== Email: usa el mailer inyectado (Resend {data,error}), no lanza ===\n');
  let sent = null;
  const fakeSendOk = async (payload) => { sent = payload; return { data: { id: 'em_1' }, error: null }; };
  const em = await registerClientActivitySvc(db, c1, { type: 'email', opportunity_id: A.id, email_subject: 'Hola', email_text: 'Cuerpo' }, { ...at('2026-03-08'), sendEmail: fakeSendOk });
  ok(em.email && em.email.sent && sent.to === 'uno@ejemplo.com', 'email → envía por el mailer y registra actividad');
  ok(await throwsA(() => registerClientActivitySvc(db, c2, { type: 'email', email_text: 'x' }), 400), 'email a cliente sin dirección → 400');
  let mailFail = false; try { await registerClientActivitySvc(db, c1, { type: 'email', email_text: 'x' }, { ...at('2026-03-08'), sendEmail: async () => ({ data: null, error: { message: 'bad' } }) }); } catch (e) { mailFail = e.status === 502; }
  ok(mailFail, 'error de Resend → 502 y NO se registra actividad falsa');
  ok(opportunityEmail('primer-contacto', { client: { name: 'Cliente Uno' }, company: { company_name: 'Reformas Test SL' }, opp: { title: 'Reforma baño' } }).subject.length > 0, 'plantilla de email construye asunto/cuerpo');

  console.log('\n=== Cola de trabajo + embudo por etapas: totales explicables ===\n');
  const wl = salesWorklist(db, '2026-03-10');
  const abiertas = db.prepare("SELECT id, amount FROM opportunities WHERE active=1 AND status='activa'").all();
  const sumAb = Math.round(abiertas.reduce((s, o) => s + o.amount, 0) * 100) / 100;
  ok(wl.total === sumAb && wl.rows.length === abiertas.length, 'worklist suma solo las oportunidades abiertas');
  const pipe = pipelineByStage(db, '2026-03-10');
  ok(pipe.columnas.length === 4, 'embudo con 4 columnas (etapas abiertas)');
  ok(pipe.ganadas.count === 1 && pipe.ganadas.total === 5000, 'ganadas: 1 · 5000 € (la cocina)');
  const pond = Math.round(abiertas.reduce((s, o) => { const r = db.prepare('SELECT probability FROM opportunities WHERE id=?').get(o.id); return s + o.amount * r.probability / 100; }, 0) * 100) / 100;
  ok(pipe.ponderado === pond, 'previsión ponderada = Σ valor × probabilidad');
  ok(pipe.columnas.reduce((s, col) => s + col.count, 0) === abiertas.length, 'cada oportunidad abierta cae en exactamente una columna');

  console.log('\n=== Timeline unificado + resumen del cliente ===\n');
  const tl = clientTimeline(db, c1, '2026-03-10');
  ok(tl.some(e => e.kind === 'oportunidad' && /abierta/i.test(e.title)), 'timeline incluye apertura de oportunidad');
  ok(tl.some(e => e.kind === 'oportunidad' && /GANADA/.test(e.title)), 'timeline incluye cierre GANADA');
  ok(tl.some(e => e.kind === 'actividad'), 'timeline incluye la actividad registrada');
  // El troceo por permisos: sin invoices/cobros, siguen apareciendo oportunidades y actividad.
  const tlSolo = clientTimeline(db, c1, '2026-03-10', { include: { oportunidades: true, actividad: true, quotes: false, orders: false, albaranes: false, invoices: false, cobros: false } });
  ok(tlSolo.length > 0 && tlSolo.every(e => e.kind === 'oportunidad' || e.kind === 'actividad'), 'include trocea las fuentes (sin permiso de facturas/cobros no se filtran)');
  const sum = clientCrmSummary(db, c1, '2026-03-10');
  ok(sum.ganadas.count === 1 && sum.ganadas.total === 5000, 'resumen: 1 ganada · 5000 €');
  ok(sum.abiertas.every(o => o.status === 'activa'), 'resumen.abiertas solo activas, priorizadas');

  console.log('\n=== Archivar (nunca borrar) + idempotencia de la migración ===\n');
  archiveOpportunitySvc(db, R.id);
  ok(db.prepare('SELECT active FROM opportunities WHERE id=?').get(R.id).active === 0, 'archivar → active=0 (no DELETE)');
  ok(!salesWorklist(db, '2026-03-10').rows.some(r => r.id === R.id), 'archivada desaparece de la cola');
  const before = db.prepare('SELECT COUNT(*) n FROM opportunities').get().n;
  runMigrations(db);
  ok(db.prepare('SELECT COUNT(*) n FROM opportunities').get().n === before, 'runMigrations idempotente (datos intactos al re-ejecutar)');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close(); try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
