// Verificación — aviso de exceso de stock al EMITIR FACTURA (RAMA B: la factura no mueve stock).
// Parte A (determinista, en proceso): la detección de exceso solo aplica a productos FÍSICOS
// enlazados; servicio/digital/línea libre nunca; y emitir con exceso NO toca el libro de stock.
//   node scripts/verify-invoice-over-stock.mjs
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, invoiceStockExcess } from '../modules/erp/routes/invoices.js';
import { productStock } from '../modules/erp/stock.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

console.log('\n=== Factura · exceso de stock — Parte A (lógica) ===\n');
const dbPath = join(tmpdir(), 'vos-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate) VALUES (1,'T SL','B12345678',21)").run();
  db.prepare("UPDATE company_config SET fiscal_id='B12345678', country='ES' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name, fiscal_id) VALUES ('Cli','12345678Z')").run().lastInsertRowid;

  // Productos: físico (stock 5), servicio, digital.
  const ins = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)");
  const pFis = ins.run('Vela Física','vela-fis','FIS1',10,5,'active','physical',21,'general').lastInsertRowid;
  const pSrv = ins.run('Asesoría','aseso','SRV1',50,0,'active','service',21,'general').lastInsertRowid;
  const pDig = ins.run('Ebook','ebook','DIG1',9,0,'active','digital',21,'general').lastInsertRowid;
  // Stock real del físico = 5 (libro). warehouse_id=1.
  db.prepare("INSERT INTO stock_movements (product_id,warehouse_id,type,quantity,origin_type,note,created_at) VALUES (?,?,?,?,?,?,datetime('now'))")
    .run(pFis, 1, 'apertura', 5, 'opening', 'seed');
  ok(productStock(db, pFis) === 5, 'stock global del físico = 5 (libro)');

  // 1) FÍSICO con exceso → detectado
  let ex = invoiceStockExcess(db, [{ product_id: pFis, quantity: 100 }]);
  ok(ex.length === 1 && ex[0].available === 5 && ex[0].requested === 100 && ex[0].excess === 95,
     'físico 100 con 5 → exceso detectado (hay 5, facturas 100, exceso 95)');

  // 2) FÍSICO dentro de stock → no
  ok(invoiceStockExcess(db, [{ product_id: pFis, quantity: 5 }]).length === 0, 'físico 5 con 5 → sin exceso');
  ok(invoiceStockExcess(db, [{ product_id: pFis, quantity: 3 }]).length === 0, 'físico 3 con 5 → sin exceso');

  // 3) SERVICIO y DIGITAL → nunca se chequean (no tienen inventario)
  ok(invoiceStockExcess(db, [{ product_id: pSrv, quantity: 12 }]).length === 0, 'un SERVICIO no mira el stock, pida lo que pida → NUNCA se gatea');
  ok(invoiceStockExcess(db, [{ product_id: pDig, quantity: 12 }]).length === 0, 'un DIGITAL tampoco → NUNCA se gatea');

  // 4) LÍNEA LIBRE (sin product_id) → nunca se chequea
  ok(invoiceStockExcess(db, [{ description: 'Mano de obra', quantity: 12 }]).length === 0, 'línea libre (sin product_id) → NUNCA se gatea');

  // 5) RAMA B — emitir CON exceso NO mueve el libro de stock
  const before = db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
  const stockBefore = productStock(db, pFis);
  const r = createInvoice(db, { client_id: cli, confirm_excess: true,
    lines: [{ description: 'Vela Física', quantity: 100, unit_price: 10, tax_rate: 21, product_id: pFis }] });
  const after = db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
  ok(!!r.id, 'factura con exceso (confirmada) se emite');
  ok(after === before && productStock(db, pFis) === stockBefore,
     'RAMA B: el libro de stock NO cambia tras emitir con exceso (movs ' + before + '→' + after + ', stock ' + stockBefore + ')');

  // 6) mezcla: físico exceso + servicio + línea libre → solo el físico
  const mix = invoiceStockExcess(db, [
    { product_id: pFis, quantity: 20 }, { product_id: pSrv, quantity: 999 }, { description: 'libre', quantity: 999 },
  ]);
  ok(mix.length === 1 && mix[0].product_id === pFis, 'mezcla: solo la línea física en exceso se reporta');
} finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}
console.log('\n=== RESULTADO PARTE A: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
