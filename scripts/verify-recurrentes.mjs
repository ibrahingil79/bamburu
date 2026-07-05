// Verificación FACTURAS RECURRENTES · Bloque A — plantilla → borradores en fecha → emitir → idempotencia.
//   node scripts/verify-recurrentes.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os'; import { join } from 'path'; import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createTemplate, generateDueOccurrences, borradoresPendientes, proximasFechas,
         emitirOcurrencia, setTemplateStatus, addMonths } from '../modules/erp/recurrentes.js';
import { borradoresRecurrentes } from '../modules/erp/avisos.js';

const DBF = join(tmpdir(), 'recur-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series) VALUES (1,'Test SL','89890001K','ES','F')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days) VALUES ('Iguala SL','B12345678','empresa',0)").run();
  const cli = db.prepare('SELECT id FROM clients LIMIT 1').get().id;

  console.log('\n=== Cadencia y recorte de fin de mes ===\n');
  ok(addMonths('2026-01-31', 1) === '2026-02-28', 'addMonths: 31-ene + 1 mes → 28-feb (recorte de día)');
  ok(addMonths('2026-01-15', 3) === '2026-04-15', 'addMonths: +3 meses (trimestral)');

  console.log('\n=== Plantilla mensual → borradores en cada fecha vencida ===\n');
  const t = createTemplate(db, { client_id: cli, interval_months: 1, start_date: '2026-01-15', irpf_rate: 0,
    lines: [{ description: 'Iguala mensual', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  const TODAY = '2026-03-20';
  let g = generateDueOccurrences(db, TODAY);
  ok(g.generados === 3, '3 borradores generados (15-ene, 15-feb, 15-mar)');
  ok(borradoresPendientes(db).length === 3, '3 borradores pendientes');

  console.log('\n=== Idempotencia del job ===\n');
  g = generateDueOccurrences(db, TODAY);
  ok(g.generados === 0 && borradoresPendientes(db).length === 3, 'correr el job otra vez NO duplica');

  console.log('\n=== Aviso al dueño (fuente de avisos) ===\n');
  ok(borradoresRecurrentes(db, TODAY).length === 3 && borradoresRecurrentes(db, TODAY)[0].tipo === 'factura_recurrente', 'los borradores aparecen como avisos (factura_recurrente)');

  console.log('\n=== Emitir un borrador → factura real con huella ===\n');
  const occ = db.prepare("SELECT * FROM recurring_occurrences ORDER BY due_date LIMIT 1").get();
  const created = emitirOcurrencia(db, occ.id);
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(created.id);
  ok(inv && inv.status === 'emitida' && inv.verifactu_hash, 'emitir crea la factura real (emitida + huella Verifactu)');
  ok(inv.total === 121 && inv.client_id === cli, 'la factura lleva las líneas y el cliente de la plantilla (121 €)');
  const occ2 = db.prepare('SELECT * FROM recurring_occurrences WHERE id=?').get(occ.id);
  ok(occ2.status === 'emitida' && occ2.invoice_id === created.id, 'el borrador queda ligado a la factura (emitida)');
  ok(borradoresPendientes(db).length === 2, 'quedan 2 borradores pendientes');

  console.log('\n=== No se emite dos veces el mismo borrador ===\n');
  let threw = false; try { emitirOcurrencia(db, occ.id); } catch (e) { threw = e.status === 409; }
  ok(threw, 'reemitir el mismo borrador → 409 (no duplica factura)');
  ok(db.prepare("SELECT COUNT(*) c FROM invoices").get().c === 1, 'una sola factura emitida (idempotente)');

  console.log('\n=== Pausar → no genera; próximas fechas ===\n');
  const tpl = db.prepare('SELECT * FROM recurring_templates WHERE id=?').get(t.id);
  ok(proximasFechas(tpl, TODAY, 2).length === 2 && proximasFechas(tpl, TODAY, 2)[0] === '2026-04-15', 'próximas fechas futuras correctas (15-abr…)');
  setTemplateStatus(db, t.id, 'pausada');
  const TOMORROW = '2026-04-20';
  g = generateDueOccurrences(db, TOMORROW);
  ok(g.generados === 0, 'plantilla pausada → el job no genera nuevos borradores');

  console.log('\n=== Fin por nº de ocurrencias ===\n');
  const t2 = createTemplate(db, { client_id: cli, interval_months: 1, start_date: '2026-01-10', max_occurrences: 2,
    lines: [{ description: 'X', quantity: 1, unit_price: 10, tax_rate: 21 }] });
  generateDueOccurrences(db, '2026-06-01');
  ok(db.prepare('SELECT COUNT(*) c FROM recurring_occurrences WHERE template_id=?').get(t2.id).c === 2, 'max_occurrences=2 → solo 2 ocurrencias, aunque hayan pasado más fechas');
} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close(); try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
