// Verificación — PIEZA A · Mostrador (ticket = factura simplificada F2). Lógica, BD temporal.
//   node scripts/verify-mostrador.mjs
// Emisión de simplificada (serie S propia, tipo F2, huella encadenada, QR), IVA por banda +
// línea libre 21% + IRPF 0, cobro registrado (cobrada, no pendiente), stock por el libro,
// atomicidad (fallo forzado → nada a medias), aviso 400 € que NO bloquea.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { emitTicketSvc, buildTicketPaper } from '../modules/erp/routes/invoices.js';
import { recordMovement, productStockInWarehouse, productStock } from '../modules/erp/stock.js';
import { invoiceCobro, collectionsWorklist } from '../modules/erp/cobros.js';
import { altaHuella, toFechaExpedicion } from '../modules/erp/verifactu.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round(n * 100) / 100;

console.log('\n=== Mostrador (ticket simplificada F2) — lógica ===\n');
const dbPath = join(tmpdir(), 'most-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate) VALUES (1,'Acme SL','B11111111',21)").run();
  // irpf_default a propósito > 0 para comprobar que el ticket NO aplica IRPF.
  db.prepare("UPDATE company_config SET country='ES', irpf_default=15, company_name='Acme SL', fiscal_id='B11111111', address='C/ Mayor 1' WHERE id=1").run();
  const whMain = db.prepare("SELECT id FROM warehouses WHERE is_default=1").get().id;
  const ins = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)");
  const pRed = ins.run('Libro','libro','LIB1',10,0,'active','physical',10,'reducido').lastInsertRowid;   // banda reducida 10%
  const pGen = ins.run('Cargador','carg','CARG1',50,0,'active','physical',21,'general').lastInsertRowid;
  recordMovement(db, { product_id: pRed, type: 'apertura', quantity: 30, origin_type: 'opening', warehouse_id: whMain });
  recordMovement(db, { product_id: pGen, type: 'apertura', quantity: 10, origin_type: 'opening', warehouse_id: whMain });

  // 1) Ticket: 2× Libro (10% banda) + 1 línea libre (100 @ 21%), efectivo.
  const t1 = emitTicketSvc(db, { warehouse_id: whMain, payment_method: 'efectivo', lines: [
    { product_id: pRed, quantity: 2, unit_price: 999, tax_rate: 0 },              // precio/IVA los pone el servidor (banda)
    { product_id: null, description: 'Grabado a medida', quantity: 1, unit_price: 100, tax_rate: 21 },
  ]});
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(t1.id);
  ok(inv.series === 'S' && inv.invoice_number === 'S' + new Date().getFullYear() + '-0001', 'serie PROPIA simplificada: ' + inv.invoice_number + ' (distinta de F y R)');
  ok(inv.document_name === 'Factura simplificada' && inv.client_id === null && (inv.client_name || '') === '', 'documento "Factura simplificada", SIN cliente (anónima)');
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(t1.id);
  ok(items[0].tax_rate === 10 && r2(items[0].unit_price) === 10, 'IVA por BANDA del producto (10%, no 21% en silencio) + precio del catálogo (servidor)');
  ok(items[1].tax_rate === 21, 'línea libre al 21% fijo');
  // base 120 (20 + 100), IVA 2 (10% de 20) + 21 (21% de 100) = 23, total 143
  ok(r2(inv.subtotal) === 120 && r2(inv.tax_amount) === 23 && r2(inv.total) === 143, 'totales: base 120 · IVA 23 · total 143 (got ' + [inv.subtotal, inv.tax_amount, inv.total].map(r2).join('/') + ')');
  ok(r2(inv.irpf_rate) === 0 && r2(inv.irpf_amount) === 0, 'SIN IRPF aunque el negocio tenga irpf_default 15 (venta a consumidor)');

  // 2) Verifactu: tipo F2, huella encadenada correcta, primer registro.
  const reg = db.prepare("SELECT * FROM verifactu_registros WHERE invoice_id=? AND record_type='alta'").get(t1.id);
  ok(reg && reg.tipo_factura === 'F2', 'registrado en Verifactu con TIPO F2 (factura simplificada)');
  const recomputed = altaHuella({ idEmisor: reg.id_emisor, numSerie: reg.num_serie, fechaExpedicion: reg.fecha_expedicion, tipoFactura: reg.tipo_factura, cuotaTotal: reg.cuota_total, importeTotal: reg.importe_total, prevHuella: reg.prev_huella, fechaHoraHuso: reg.fecha_hora_huso });
  ok(recomputed === reg.huella, 'huella SHA-256 encadenada correcta (recomputada == almacenada)');
  ok(reg.prev_huella === '' && reg.primer_registro === 'S', 'primer registro de la cadena (prev_huella vacía, primer_registro=S)');
  ok(reg.importe_total === '143.00' && reg.cuota_total === '23.00', 'importe/cuota del registro = total/IVA del ticket');

  // 3) QR + leyenda en el documento del ticket.
  const paper = await buildTicketPaper(db, inv);
  ok(/VERI\*FACTU/.test(paper) && /sede electrónica de la AEAT/i.test(paper) && /data:image\/png;base64,/.test(paper), 'documento ticket lleva QR de cotejo + leyenda Veri*Factu');
  ok(/Factura simplificada/.test(paper) && /Efectivo/.test(paper) && !/Cliente/.test(paper), 'formato ticket: "Factura simplificada" + método (Efectivo), SIN bloque de cliente');

  // 4) Cobro registrado: queda COBRADA, no pendiente.
  const cob = invoiceCobro(db, inv, new Date().toISOString().slice(0, 10));
  ok(cob.estado === 'cobrada' && r2(cob.pendiente) === 0, 'cobro total registrado → estado "cobrada", pendiente 0');
  const pay = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id=?').get(t1.id);
  ok(pay && r2(pay.amount) === 143 && pay.payment_method === 'efectivo', 'invoice_payments: 143 € por efectivo');
  const wl = collectionsWorklist(db, new Date().toISOString().slice(0, 10));
  ok(!wl.rows.some(r => r.invoice_id === t1.id), 'el ticket NO aparece en el worklist de Cobros (no es deuda)');

  // 5) Stock por el LIBRO (salida, origin 'ticket') en el almacén elegido.
  ok(productStockInWarehouse(db, pRed, whMain) === 28, 'stock del Libro bajó 30 → 28 por el libro (2 vendidos)');
  const mov = db.prepare("SELECT * FROM stock_movements WHERE product_id=? AND origin_type='ticket'").get(pRed);
  ok(mov && mov.quantity === -2 && mov.warehouse_id === whMain, 'movimiento de salida origin_type="ticket" (−2) en el almacén');

  // 6) Correlativo + cadena: segundo ticket → S-0002, prev_huella = huella del primero.
  const t2 = emitTicketSvc(db, { warehouse_id: whMain, payment_method: 'tarjeta', lines: [{ product_id: pGen, quantity: 1, unit_price: 0, tax_rate: 0 }] });
  ok(db.prepare('SELECT invoice_number FROM invoices WHERE id=?').get(t2.id).invoice_number.endsWith('-0002'), 'segundo ticket correlativo → -0002');
  const reg2 = db.prepare("SELECT * FROM verifactu_registros WHERE invoice_id=? AND record_type='alta'").get(t2.id);
  ok(reg2.prev_huella === reg.huella && reg2.primer_registro === 'N', 'la cadena de huella ENLAZA (prev del 2º = huella del 1º)');

  // 7) Aviso 400 € NO bloquea: ticket de total > 400 se emite igual.
  const big = emitTicketSvc(db, { warehouse_id: whMain, payment_method: 'tarjeta', lines: [{ product_id: pGen, quantity: 10, unit_price: 0, tax_rate: 0 }] }); // 10×50=500 +IVA=605
  const bigInv = db.prepare('SELECT total FROM invoices WHERE id=?').get(big.id);
  ok(r2(bigInv.total) === 605 && big.invoice_number.endsWith('-0003'), 'total > 400 € (605) se emite sin bloqueo (el aviso es de pantalla)');

  // 8) ATOMICIDAD: fallo forzado en el cobro → NO queda NADA (ni factura, ni stock, ni alta, ni secuencia).
  const before = {
    invoices: db.prepare('SELECT COUNT(*) n FROM invoices').get().n,
    items: db.prepare('SELECT COUNT(*) n FROM invoice_items').get().n,
    regs: db.prepare('SELECT COUNT(*) n FROM verifactu_registros').get().n,
    movs: db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,
    pays: db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n,
    seq: db.prepare("SELECT last_seq FROM invoice_sequences WHERE series='S'").get().last_seq,
    stockRed: productStock(db, pRed),
  };
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => { if (String(sql).includes('INSERT INTO invoice_payments')) throw new Error('FALLO SIMULADO en el cobro'); return origPrepare(sql); };
  let threw = false;
  try { emitTicketSvc(db, { warehouse_id: whMain, payment_method: 'efectivo', lines: [{ product_id: pRed, quantity: 1, unit_price: 0, tax_rate: 0 }] }); }
  catch (e) { threw = /FALLO SIMULADO/.test(e.message); }
  db.prepare = origPrepare;   // restaurar
  const after = {
    invoices: db.prepare('SELECT COUNT(*) n FROM invoices').get().n,
    items: db.prepare('SELECT COUNT(*) n FROM invoice_items').get().n,
    regs: db.prepare('SELECT COUNT(*) n FROM verifactu_registros').get().n,
    movs: db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,
    pays: db.prepare('SELECT COUNT(*) n FROM invoice_payments').get().n,
    seq: db.prepare("SELECT last_seq FROM invoice_sequences WHERE series='S'").get().last_seq,
    stockRed: productStock(db, pRed),
  };
  ok(threw, 'atomicidad: el fallo forzado en el cobro lanza error');
  ok(JSON.stringify(before) === JSON.stringify(after), 'atomicidad: NADA quedó a medias (factura/líneas/alta/stock/cobro/secuencia idénticos: ' + (JSON.stringify(before) === JSON.stringify(after)) + ')');

  // 9) Método inválido → 400.
  let bad = false; try { emitTicketSvc(db, { warehouse_id: whMain, payment_method: 'bizum', lines: [{ product_id: pGen, quantity: 1, unit_price: 0, tax_rate: 0 }] }); } catch (e) { bad = e.status === 400; }
  ok(bad, 'método de pago fuera de lista (efectivo/tarjeta) → 400');

  // 10) Migración idempotente (sin columnas nuevas; la serie S vive en invoice_sequences).
  const inv0 = db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
  runMigrations(db);
  ok(db.prepare('SELECT COUNT(*) n FROM invoices').get().n === inv0, 'runMigrations idempotente (datos intactos; sin columnas nuevas)');
} finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
