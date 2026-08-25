// Verificación — PIEZA B · Ticket → factura completa (sustitutiva / canje, Verifactu F3). Lógica.
//   node scripts/verify-sustitutiva.mjs
// F3 (un paso, huella encadenada) · sustitutiva con cliente + líneas arrastradas · enlace
// bidireccional · ticket marcado sustituido · cobro NO duplicado (ya pagada, no pendiente, 1 fila)
// · stock NO movido · atomicidad · guardas (no 2 veces, no anulado, solo serie S).
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { emitTicketSvc, emitSustitutivaSvc, createInvoice, anularInvoice } from '../modules/erp/routes/invoices.js';
import { recordMovement, productStock } from '../modules/erp/stock.js';
import { invoiceCobro, paymentsSum, countsAsReceivable, collectionsWorklist } from '../modules/erp/cobros.js';
import { altaHuella } from '../modules/erp/verifactu.js';
// 25 ago 2026 · Los dominios de las direcciones de prueba pasan a `.test`, que está RESERVADO y no
// puede existir (RFC 2606). Antes usaban dominios que sí existen —de otra gente—, así que un correo
// del producto podía acabar en una bandeja ajena, y cada intento era un rebote contra bamburu.com.
// La puerta del correo los desvía a simulación. Ver docs/censo-correos.md.

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round(n * 100) / 100;
const today = new Date().toISOString().slice(0, 10);

console.log('\n=== Sustitutiva (ticket → factura completa F3) — lógica ===\n');
const dbPath = join(tmpdir(), 'sust-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate) VALUES (1,'Acme SL','B11111111',21)").run();
  db.prepare("UPDATE company_config SET country='ES', irpf_default=15, company_name='Acme SL', fiscal_id='B11111111', address='C/ Mayor 1' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name, fiscal_id, address, email, client_type) VALUES ('Cliente Empresa SL','B22222222','Av. Test 2','c@x.test','empresa')").run().lastInsertRowid;
  const whMain = db.prepare("SELECT id FROM warehouses WHERE is_default=1").get().id;
  const pRed = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES ('Libro','libro','LIB1',10,0,'active','physical',10,'reducido')").run().lastInsertRowid;
  recordMovement(db, { product_id: pRed, type: 'apertura', quantity: 30, origin_type: 'opening', warehouse_id: whMain });

  // Ticket de mostrador (2× Libro @10%), pagado en efectivo.
  const t = emitTicketSvc(db, { warehouse_id: whMain, payment_method: 'efectivo', lines: [{ product_id: pRed, quantity: 2, unit_price: 0, tax_rate: 0 }] });
  const ticket = db.prepare('SELECT * FROM invoices WHERE id=?').get(t.id);
  const stockTrasTicket = productStock(db, pRed);
  const movsTrasTicket = db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
  const paysTrasTicket = db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n;   // 1 (el cobro del ticket)

  // 1) Emitir factura completa que sustituye al ticket, con datos del cliente.
  const s = emitSustitutivaSvc(db, t.id, cli);
  const fac = db.prepare('SELECT * FROM invoices WHERE id=?').get(s.id);
  ok(fac.series === 'F' && fac.invoice_number.startsWith('F'), 'la sustitutiva va en la serie ORDINARIA de facturas completas: ' + fac.invoice_number);
  ok(fac.document_name === 'Factura' && fac.client_id === cli && fac.client_name === 'Cliente Empresa SL' && fac.client_fiscal_id === 'B22222222', 'factura COMPLETA con datos fiscales del cliente (NIF, nombre, domicilio)');
  ok(fac.substitutes_invoice_id === t.id, 'la sustitutiva referencia al ticket (substitutes_invoice_id)');

  // 2) Líneas arrastradas del ticket (mismos productos, mismas bases e IVA por tipo) + mismo importe.
  const ti = db.prepare('SELECT description, quantity, unit_price, tax_rate, total_price FROM invoice_items WHERE invoice_id=? ORDER BY id').all(t.id);
  const fi = db.prepare('SELECT description, quantity, unit_price, tax_rate, total_price FROM invoice_items WHERE invoice_id=? ORDER BY id').all(s.id);
  ok(JSON.stringify(ti) === JSON.stringify(fi), 'líneas arrastradas idénticas (descripción, cantidad, precio, IVA, base)');
  ok(r2(fac.total) === r2(ticket.total) && r2(fac.tax_amount) === r2(ticket.tax_amount) && r2(fac.irpf_amount) === 0, 'mismo importe que el ticket, SIN IRPF (total ' + r2(fac.total) + ')');

  // 3) Verifactu: TIPO F3, huella encadenada (recomputada == almacenada), enlaza tras el ticket.
  const regT = db.prepare("SELECT * FROM verifactu_registros WHERE invoice_id=? AND record_type='alta'").get(t.id);
  const regF = db.prepare("SELECT * FROM verifactu_registros WHERE invoice_id=? AND record_type='alta'").get(s.id);
  ok(regF.tipo_factura === 'F3', 'registrada en Verifactu con TIPO F3 (factura en sustitución de simplificadas)');
  const recomputed = altaHuella({ idEmisor: regF.id_emisor, numSerie: regF.num_serie, fechaExpedicion: regF.fecha_expedicion, tipoFactura: regF.tipo_factura, cuotaTotal: regF.cuota_total, importeTotal: regF.importe_total, prevHuella: regF.prev_huella, fechaHoraHuso: regF.fecha_hora_huso });
  ok(recomputed === regF.huella, 'huella SHA-256 de la F3 correcta (recomputada == almacenada)');
  ok(regF.prev_huella === regT.huella, 'la cadena de huella ENLAZA (prev de la F3 = huella del ticket)');

  // 4) Enlace bidireccional en document_links.
  const link = db.prepare("SELECT * FROM document_links WHERE source_type='ticket' AND source_id=? AND dest_type='invoice' AND dest_id=?").get(t.id, s.id);
  ok(!!link, 'enlace bidireccional ticket↔factura en document_links');

  // 5) COBRO no duplicado: la sustitutiva NO tiene fila de cobro propia; hereda el del ticket.
  ok(db.prepare('SELECT COUNT(*) n FROM invoice_payments WHERE invoice_id=?').get(s.id).n === 0, 'la sustitutiva NO genera fila nueva en invoice_payments');
  ok(db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n === paysTrasTicket, 'invoice_payments no crece (el importe NO se duplica): sigue en ' + paysTrasTicket + ' fila(s)');
  const cobF = invoiceCobro(db, fac, today);
  ok(cobF.estado === 'cobrada' && r2(cobF.pendiente) === 0, 'la sustitutiva NACE PAGADA (hereda el cobro del ticket) → cobrada, pendiente 0');
  ok(!countsAsReceivable(db, ticket), 'el ticket sustituido ya NO cuenta como deuda (la venta no se cuenta dos veces)');
  const wl = collectionsWorklist(db, today);
  ok(!wl.rows.some(r => r.invoice_id === s.id) && !wl.rows.some(r => r.invoice_id === t.id), 'ni la sustitutiva ni el ticket aparecen como pendientes en Cobros');

  // 6) STOCK no movido por la sustitución.
  ok(productStock(db, pRed) === stockTrasTicket && db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n === movsTrasTicket, 'la sustitución NO mueve stock (ya salió en el ticket)');

  // 7) GUARDA: no se puede sustituir dos veces.
  let dosVeces = false; try { emitSustitutivaSvc(db, t.id, cli); } catch (e) { dosVeces = e.status === 400 && /dos veces|ya fue sustituido/i.test(e.message); }
  ok(dosVeces, 'guarda: sustituir el mismo ticket dos veces → 400');

  // 8) GUARDA: no se puede sustituir un ticket anulado.
  const t2 = emitTicketSvc(db, { warehouse_id: whMain, payment_method: 'tarjeta', lines: [{ product_id: pRed, quantity: 1, unit_price: 0, tax_rate: 0 }] });
  anularInvoice(db, t2.id, 'Prueba de anulación');
  let anulado = false; try { emitSustitutivaSvc(db, t2.id, cli); } catch (e) { anulado = e.status === 400 && /anulado/i.test(e.message); }
  ok(anulado, 'guarda: sustituir un ticket anulado → 400');

  // 9) GUARDA: solo una factura simplificada (serie S) se sustituye (una ordinaria F no).
  const ord = createInvoice(db, { client_id: cli, lines: [{ description: 'Servicio', quantity: 1, unit_price: 100, tax_rate: 21 }], issue_date: today });
  let soloS = false; try { emitSustitutivaSvc(db, ord.id, cli); } catch (e) { soloS = e.status === 400 && /simplificada/i.test(e.message); }
  ok(soloS, 'guarda: una factura ordinaria (serie F) NO se puede "sustituir" como ticket → 400');

  // 10) ATOMICIDAD: fallo forzado en el enlace → NADA a medias.
  const t3 = emitTicketSvc(db, { warehouse_id: whMain, payment_method: 'efectivo', lines: [{ product_id: pRed, quantity: 1, unit_price: 0, tax_rate: 0 }] });
  const before = {
    inv: db.prepare('SELECT COUNT(*) n FROM invoices').get().n,
    items: db.prepare('SELECT COUNT(*) n FROM invoice_items').get().n,
    regs: db.prepare('SELECT COUNT(*) n FROM verifactu_registros').get().n,
    links: db.prepare('SELECT COUNT(*) n FROM document_links').get().n,
    seqF: (db.prepare("SELECT last_seq FROM invoice_sequences WHERE series='F'").get() || {}).last_seq,
  };
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => { if (String(sql).includes("INSERT INTO document_links")) throw new Error('FALLO SIMULADO en el enlace'); return origPrepare(sql); };
  let threw = false;
  try { emitSustitutivaSvc(db, t3.id, cli); } catch (e) { threw = /FALLO SIMULADO/.test(e.message); }
  db.prepare = origPrepare;
  const after = {
    inv: db.prepare('SELECT COUNT(*) n FROM invoices').get().n,
    items: db.prepare('SELECT COUNT(*) n FROM invoice_items').get().n,
    regs: db.prepare('SELECT COUNT(*) n FROM verifactu_registros').get().n,
    links: db.prepare('SELECT COUNT(*) n FROM document_links').get().n,
    seqF: (db.prepare("SELECT last_seq FROM invoice_sequences WHERE series='F'").get() || {}).last_seq,
  };
  ok(threw, 'atomicidad: el fallo forzado en el enlace lanza error');
  ok(JSON.stringify(before) === JSON.stringify(after), 'atomicidad: NADA a medias (factura/líneas/alta/enlace/secuencia idénticos: ' + (JSON.stringify(before) === JSON.stringify(after)) + ')');
  ok(!db.prepare('SELECT 1 FROM invoices WHERE substitutes_invoice_id=?').get(t3.id), 'atomicidad: el ticket t3 quedó SIN sustituir tras el fallo');

  // 11) Migración idempotente (columna substitutes_invoice_id ya existente).
  const inv0 = db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  runMigrations(db);
  ok(db.prepare('SELECT COUNT(*) n FROM invoices').get().n === inv0, 'runMigrations idempotente (datos intactos)');
} finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
