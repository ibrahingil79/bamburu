// Verificación PORTAL DE CLIENTE · Bloque C — enlace mágico + facturas del cliente + estado de pago.
//   node scripts/verify-portal.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os'; import { join } from 'path'; import { randomBytes } from 'crypto';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { createToken, validateToken, revokeTokensDeCliente, clientInvoices, invoiceBelongsToClient,
         transferData, setPortalSetting, sendPortalLink } from '../modules/portal/portal.js';

const DBF = join(tmpdir(), 'portal-' + randomBytes(4).toString('hex') + '.db');
const db = new Database(DBF);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, invoice_series) VALUES (1,'Mi Empresa SL','89890001K','F')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days, email) VALUES ('Cliente A','A1','empresa',0,'a@cli.com')").run();
  db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days, email) VALUES ('Cliente B','B2','empresa',0,'b@cli.com')").run();
  const A = db.prepare("SELECT id FROM clients WHERE name='Cliente A'").get().id;
  const B = db.prepare("SELECT id FROM clients WHERE name='Cliente B'").get().id;
  const fA1 = createInvoice(db, { client_id: A, issue_date: '2026-03-01', lines: [{ description: 'S', quantity: 1, unit_price: 100, tax_rate: 21 }] }); // 121
  const fA2 = createInvoice(db, { client_id: A, issue_date: '2026-03-05', lines: [{ description: 'S', quantity: 1, unit_price: 200, tax_rate: 21 }] }); // 242
  createInvoice(db, { client_id: B, issue_date: '2026-03-02', lines: [{ description: 'S', quantity: 1, unit_price: 50, tax_rate: 21 }] }); // B
  // Cliente A paga la primera factura
  db.prepare("INSERT INTO invoice_payments (invoice_id, amount, paid_date, payment_method) VALUES (?,?,?,?)").run(fA1.id, 121, '2026-03-10', 'transferencia');

  console.log('\n=== Token: crear / validar / caducar / revocar ===\n');
  const NOW = 1_800_000_000;
  const tok = createToken(db, A, 14, NOW);
  ok(validateToken(db, tok, NOW)?.client_id === A, 'token válido resuelve al client_id correcto');
  ok(validateToken(db, tok, NOW + 15 * 86400) === null, 'token caducado → null');
  ok(validateToken(db, 'inventado', NOW) === null, 'token inexistente → null');
  revokeTokensDeCliente(db, A);
  ok(validateToken(db, tok, NOW) === null, 'token revocado → null');

  console.log('\n=== El cliente solo ve SUS facturas + estado de pago derivado ===\n');
  const inv = clientInvoices(db, A);
  ok(inv.rows.length === 2, 'Cliente A ve sus 2 facturas (no las de B)');
  ok(inv.rows.every(r => r.invoice_number), 'facturas con número');
  const r1 = inv.rows.find(r => r.id === fA1.id), r2 = inv.rows.find(r => r.id === fA2.id);
  ok(r1.pagada === true, 'la factura cobrada figura PAGADA (derivado de cobros, no del cliente)');
  ok(r2.pagada === false && r2.pendiente === 242, 'la no cobrada figura PENDIENTE (242)');
  ok(inv.totalPendiente === 242, 'total pendiente del cliente = 242');
  // Aislamiento: A no ve la factura de B
  const bInv = db.prepare("SELECT id FROM invoices WHERE client_id=?").get(B).id;
  ok(!inv.rows.some(r => r.id === bInv), 'Cliente A NO ve la factura de Cliente B');

  console.log('\n=== Guarda del PDF: nunca una factura ajena ===\n');
  ok(invoiceBelongsToClient(db, fA1.id, A) === true, 'la factura de A pertenece a A (PDF permitido)');
  ok(invoiceBelongsToClient(db, bInv, A) === false, 'la factura de B NO pertenece a A (PDF denegado)');

  console.log('\n=== Datos de transferencia (IBAN configurable) ===\n');
  ok(transferData(db).iban === '', 'sin IBAN configurado → vacío (no se inventa)');
  setPortalSetting(db, 'portal_iban', 'ES9121000418450200051332');
  setPortalSetting(db, 'portal_iban_holder', 'Mi Empresa SL');
  ok(transferData(db).iban === 'ES9121000418450200051332' && transferData(db).holder === 'Mi Empresa SL', 'IBAN + titular se muestran tras configurarlos');

  console.log('\n=== Envío del enlace por email (mock de Resend) ===\n');
  let capt = null;
  const mock = async (opts) => { capt = opts; return { data: { id: 'x' }, error: null }; };
  const res = await sendPortalLink(db, A, 'https://desarrollo-bamburu.bamburu.com', mock);
  ok(res.sent && capt.to === 'a@cli.com', 'envía el email al email del cliente');
  ok(/\/portal\//.test(capt.html) && capt.subject.includes('facturas'), 'el email contiene el enlace /portal/<token>');
  // cliente sin email → error claro, sin crear enlace a ciegas
  db.prepare("UPDATE clients SET email='' WHERE id=?").run(B);
  let threw = false; try { await sendPortalLink(db, B, 'https://x', mock); } catch (e) { threw = e.status === 400; }
  ok(threw, 'cliente sin email → error claro (no envía)');
} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  db.close(); try { (await import('fs')).unlinkSync(DBF); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
