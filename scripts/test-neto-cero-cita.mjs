// Test — NETO-CERO de una cita (Escalera · paso 7 · PIEZA 5), sobre BD temporal + motores REALES.
//   node scripts/test-neto-cero-cita.mjs
//
// Demuestra que crear una cita + cobrarla (reutilizando el TPV/createInvoice existente) + anularla deja
// VENTAS y el P&G EXACTAMENTE igual que al principio. El cobro se emite por el motor de siempre y la
// anulación lo revierte por SU motor (anularInvoice → asiento reconciliado): cero rastro neto.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createCitaSvc, atenderCitaSvc, anularCitaSvc } from '../modules/erp/routes/citas.js';
import { ventasResumen } from '../modules/erp/ventas-metrics.js';
import { cuentaPyG } from '../modules/erp/contabilidad-pyg.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const dbs = [];
const FROM = '2000-01-01', TO = '2100-01-01';
function nuevaBD() {
  const f = join(tmpdir(), 'neto-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("UPDATE company_config SET company_name='Test SL', fiscal_id='B00000000', country='ES', invoice_series='F', currency_symbol='€' WHERE id=1").run();
  return db;
}

try {
  const db = nuevaBD();
  const U = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Ana','ana@t.local','x','employee',1)").run().lastInsertRowid;
  const S = db.prepare("INSERT INTO products (name,price,type,tax_band,tax_rate,status) VALUES ('Corte',20,'service','general',21,'active')").run().lastInsertRowid;
  db.prepare("INSERT INTO service_config (product_id,reservable,duracion_min,margen_min) VALUES (?,1,30,0)").run(S);
  const F = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

  const snap = () => ({ ventas: ventasResumen(db), pyg: cuentaPyG(db, FROM, TO).resultadoExplotacion });
  const base = snap();
  console.log('\n=== baseline ===\n');
  ok(base.ventas.count === 0 && base.ventas.total === 0, 'de partida no hay ventas (total 0)');

  console.log('\n=== crear cita + cobrar (ticket, motor existente) ===\n');
  const cita = createCitaSvc(db, { cliente_suelto_nombre: 'María', user_id: U, fecha: F, inicio_min: 600, service_ids: [S] });
  const at = atenderCitaSvc(db, cita.id, { cobrar: true, via: 'ticket', payment_method: 'efectivo' });
  ok(at.invoice_id, 'al atender con cobro se emite una factura/ticket por el motor de siempre');
  const conCobro = snap();
  ok(conCobro.ventas.count === 1 && conCobro.ventas.total > 0, 'la venta aparece en Ventas mientras la cita está cobrada (total ' + conCobro.ventas.total + ')');
  ok(db.prepare('SELECT status FROM invoices WHERE id=?').get(at.invoice_id).status === 'emitida', 'la factura está emitida');

  console.log('\n=== anular la cita → revierte el cobro ===\n');
  anularCitaSvc(db, cita.id, 'Prueba neto-cero');
  ok(db.prepare('SELECT status FROM invoices WHERE id=?').get(at.invoice_id).status === 'anulada', 'al anular la cita, su factura queda anulada (por su motor)');
  ok(db.prepare('SELECT estado FROM citas WHERE id=?').get(cita.id).estado === 'anulada', 'la cita queda anulada (archivar-no-borrar: la fila sigue)');

  console.log('\n=== NETO-CERO: Ventas y P&G exactamente igual que al principio ===\n');
  const fin = snap();
  ok(fin.ventas.total === base.ventas.total && fin.ventas.count === base.ventas.count, 'VENTAS vuelve al punto de partida (total ' + fin.ventas.total + ', count ' + fin.ventas.count + ')');
  ok(fin.pyg === base.pyg, 'el RESULTADO de explotación del P&G vuelve al punto de partida (' + fin.pyg + ' = ' + base.pyg + ')');

  console.log('\n' + (fail === 0 ? '✅ TODO VERDE' : '❌ HAY FALLOS') + ` — ${pass} ok, ${fail} fallos`);
} catch (e) {
  console.error('\n💥 EXCEPCIÓN:', e); fail++;
} finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
}
