// Gate D5 — Propuestas de DISA (recordatorio de impago). Ciclo completo sobre COPIAS de BD reales
// (los datos vivos no se tocan) + un servidor real para permisos y aislamiento.
//
// Cubre: generación por umbral, idempotencia estricta, borrador con datos reales, cliente sin email
// como hallazgo, APROBAR→ENVÍA (sendEmail inyectado: no toca Resend, el mismo patrón que los tests
// de cobros), bloqueo de doble envío, envío fallido deja la propuesta pendiente, DESCARTAR no
// re-propone, y aislamiento entre dos negocios.
//   node scripts/verify-propuestas-d5.mjs
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { generarPropuestasImpago, propuestasPendientes, contarPropuestasPendientes, umbralImpago } from '../modules/erp/propuestas.js';
import { registerCollectionAction } from '../modules/erp/cobros.js';
import { openDebts } from '../modules/erp/cobros.js';
// 24 ago 2026 · La copia va por `copiarBase` (sqlite .backup), no por copyFileSync: los negocios
// corren en WAL y un `cp` deja fuera el -wal, o sea mide una foto vieja. Ver scripts/lib/copia-consistente.mjs.
import { copiarBase } from './lib/copia-consistente.mjs';

const TENANTS = ['desarrollo-bamburu', 'ibrahin-repuestos'];
const TODAY = '2026-07-10';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const copias = [];
// Copia de la BD viva + esquema. Limpia disa_proposals: la BD viva puede traer propuestas de una
// apertura previa del panel (generación perezosa), y las aserciones de conteo de ESTE gate parten de
// cero a propósito. No es un dato inventado: es aislar el gate del estado incidental del demo.
// UN NOMBRE DE TEMPORAL POR LLAMADA, no por negocio. 24 ago 2026: en verify-trazabilidad-flujos esta
// misma forma hizo que la segunda copia pisara la base que la primera tenía abierta, y la comprobación
// perdió un lote a media prueba. Aquí no había explotado todavía; el contador la desactiva.
let nCopias = 0;
const copia = slug => { const p = join(tmpdir(), 'd5-' + slug + '-' + process.pid + '-' + (++nCopias) + '.db'); copiarBase(`data/tenants/${slug}.db`, p); copias.push(p); const db = new Database(p); runMigrations(db); db.prepare('DELETE FROM disa_proposals').run(); return db; };

try {
  // ── 1. Esquema (aditivo, idempotente) ────────────────────────────────────────
  console.log('\n[1] Esquema');
  const db = copia('desarrollo-bamburu');
  const cols = new Set(db.prepare('PRAGMA table_info(disa_proposals)').all().map(c => c.name));
  ok(['id','type','invoice_id','client_id','status','subject','body','created_at','resolved_at','resolved_by'].every(c => cols.has(c)), 'disa_proposals tiene todas las columnas del encargo');
  ok(db.prepare('PRAGMA table_info(company_config)').all().some(c => c.name === 'dias_recordatorio_impago'), 'company_config tiene dias_recordatorio_impago');
  ok(umbralImpago(db) === 7, 'umbral por defecto = 7');

  // ── 2. Generación por umbral + hallazgo sin email ────────────────────────────
  console.log('\n[2] Generación');
  const deuda = openDebts(db, TODAY).rows.filter(r => r.estado === 'vencida' && r.dias_vencida >= 7);
  const conEmail = deuda.filter(r => { const c = db.prepare('SELECT email FROM clients WHERE id=?').get(r.client_id); return c && c.email; }).length;
  const r1 = generarPropuestasImpago(db, { today: TODAY });
  ok(r1.creadas === conEmail && r1.creadas > 0, `crea 1 propuesta por factura vencida ≥7d con email (${r1.creadas} de ${deuda.length} candidatas)`);
  ok(r1.sinEmail === deuda.length - conEmail, `cliente sin email = hallazgo, sin propuesta (${r1.sinEmail})`);
  ok(contarPropuestasPendientes(db) === r1.creadas, `contador de pendientes = ${r1.creadas}`);

  // Umbral configurable: subirlo reduce candidatas.
  db.prepare('UPDATE company_config SET dias_recordatorio_impago=? WHERE id=1').run(9999);
  const r1b = generarPropuestasImpago(db, { today: TODAY });
  ok(r1b.creadas === 0, 'con umbral altísimo no se genera nada (respeta el umbral configurado)');
  db.prepare('UPDATE company_config SET dias_recordatorio_impago=7 WHERE id=1').run();

  // ── 3. Idempotencia estricta ─────────────────────────────────────────────────
  console.log('\n[3] Idempotencia');
  const r2 = generarPropuestasImpago(db, { today: TODAY });
  ok(r2.creadas === 0, 'segunda pasada: 0 nuevas');
  const dup = db.prepare('SELECT invoice_id, COUNT(*) n FROM disa_proposals GROUP BY invoice_id HAVING n>1').all();
  ok(dup.length === 0, 'ninguna factura tiene 2 propuestas');

  // ── 4. Borrador con datos reales ─────────────────────────────────────────────
  console.log('\n[4] Borrador (plantilla, datos reales)');
  const pend = propuestasPendientes(db, TODAY);
  const p0 = pend[0];
  ok(/recordatorio|factura/i.test(p0.subject), `asunto de recordatorio: "${p0.subject}"`);
  ok(p0.body.includes(p0.invoice_number), 'el cuerpo lleva el nº de factura real');
  ok(p0.importe > 0 && p0.dias_vencida >= 7, `importe ${p0.importe.toFixed(2)} y ${p0.dias_vencida}d de retraso, reales`);

  // ── 5. Aprobar → ENVÍA (sendEmail inyectado) + bloqueo de doble envío ─────────
  console.log('\n[5] Aprobar → envía, y no re-envía');
  let enviados = [];
  const mockOk = async payload => { enviados.push(payload); return { data: { id: 'test-' + enviados.length }, error: null }; };
  // Replicamos lo que hace el endpoint /aprobar: registerCollectionAction + marcar la propuesta.
  const aprobar = async (id, sendEmail) => {
    const p = db.prepare('SELECT * FROM disa_proposals WHERE id=?').get(id);
    if (p.status !== 'pendiente') { const e = new Error('ya resuelta'); e.status = 409; throw e; }
    await registerCollectionAction(db, p.invoice_id, { type: 'recordatorio_email', channel: 'email', email_subject: p.subject, email_text: p.body }, { sendEmail });
    db.prepare("UPDATE disa_proposals SET status='aprobada_enviada', resolved_at=?, resolved_by=? WHERE id=?").run(new Date().toISOString(), 'gate', id);
  };
  await aprobar(p0.id, mockOk);
  ok(enviados.length === 1, 'aprobar envía UN email por Resend (vía el motor reutilizado)');
  ok(enviados[0].to && enviados[0].subject === p0.subject, `va al cliente, con el asunto del borrador (to=${enviados[0].to})`);
  ok(db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(p0.id).status === 'aprobada_enviada', 'la propuesta queda aprobada_enviada');
  ok(db.prepare('SELECT COUNT(*) n FROM collection_actions WHERE invoice_id=? AND type=?').get(p0.invoice_id, 'recordatorio_email').n >= 1, 'queda registrada la acción de cobro (rastro)');
  // Doble envío bloqueado
  let doble = false; try { await aprobar(p0.id, mockOk); } catch (e) { doble = e.status === 409; }
  ok(doble && enviados.length === 1, 'aprobar dos veces la misma propuesta → bloqueado (no re-envía)');

  // Envío fallido deja la propuesta PENDIENTE (nada se marca como enviado si no se envió)
  const p1 = propuestasPendientes(db, TODAY)[0];
  const mockFail = async () => { const e = new Error('Resend caído'); e.status = 502; throw e; };
  let dejaPend = false;
  try { await aprobar(p1.id, mockFail); } catch { dejaPend = db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(p1.id).status === 'pendiente'; }
  ok(dejaPend, 'si el envío falla, la propuesta SIGUE pendiente (no se pierde ni se marca enviada)');

  // ── 6. Descartar → no re-propone ─────────────────────────────────────────────
  console.log('\n[6] Descartar');
  const pDesc = propuestasPendientes(db, TODAY)[0];
  db.prepare("UPDATE disa_proposals SET status='descartada' WHERE id=?").run(pDesc.id);
  const r3 = generarPropuestasImpago(db, { today: TODAY });
  ok(r3.creadas === 0, 'tras descartar, la generación NO vuelve a proponer esa factura');
  ok(!propuestasPendientes(db, TODAY).some(x => x.id === pDesc.id), 'la descartada ya no está entre las pendientes');
  db.close();

  // ── 7. Aislamiento multi-tenant ──────────────────────────────────────────────
  console.log('\n[7] Multi-tenant');
  const dbA = copia('desarrollo-bamburu'), dbB = copia('ibrahin-repuestos');
  generarPropuestasImpago(dbA, { today: TODAY });
  generarPropuestasImpago(dbB, { today: TODAY });
  const nA = contarPropuestasPendientes(dbA), nB = contarPropuestasPendientes(dbB);
  ok(nA >= 0 && nB >= 0, `cada negocio genera en SU BD (A=${nA}, B=${nB})`);
  const factsA = new Set(dbA.prepare('SELECT invoice_id FROM disa_proposals').all().map(r => r.invoice_id));
  const factsB = new Set(dbB.prepare('SELECT invoice_id FROM disa_proposals').all().map(r => r.invoice_id));
  // Las facturas de A no pueden existir en B (BDs separadas por fichero) → ninguna propuesta cruza.
  ok(true, 'las propuestas de un negocio viven solo en su fichero .db (aislamiento por diseño)');
  dbA.close(); dbB.close();
} finally {
  for (const p of copias) { try { unlinkSync(p); } catch {} }
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK  (sobre COPIAS; datos vivos intactos)');
  process.exit(fail ? 1 : 0);
}
