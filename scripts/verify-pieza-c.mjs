// Verificación — PIEZA C · Fuente única de métricas de ventas (ventas-metrics.js). Lógica, BD temporal.
//   node scripts/verify-pieza-c.mjs
// Que las cifras de venta salgan de la CADENA NUEVA (facturas F/S/R, tipos F1/F2/F3) reutilizando la
// MISMA clasificación de cobros.js: emitidas sí, anuladas no, sustitutiva F3 reemplaza al ticket (no
// doble), rectificativas/abonos netean. Comprueba ventasResumen, topProductos, ventasPorDia/Mes,
// clientVentas, ultimasFacturas, clientesInactivos y los pedidos (customer_orders).
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { emitTicketSvc, emitSustitutivaSvc, createInvoice, anularInvoice } from '../modules/erp/routes/invoices.js';
import { createRectificativa } from '../modules/erp/routes/invoices.js';
import { recordMovement } from '../modules/erp/stock.js';
import * as M from '../modules/erp/ventas-metrics.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round(n * 100) / 100;
const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 7) + '-01';

console.log('\n=== PIEZA C — métricas de venta desde la cadena nueva (lógica) ===\n');
const dbPath = join(tmpdir(), 'piezac-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate, country, invoice_series) VALUES (1,'Acme SL','B11111111',21,'ES','F')").run();
  const wh = db.prepare("SELECT id FROM warehouses WHERE is_default=1").get().id;
  const ins = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)");
  const pA = ins.run('Producto A','prod-a','A1',100,0,'active','physical',21,'general').lastInsertRowid;
  const pB = ins.run('Producto B','prod-b','B1',200,0,'active','physical',21,'general').lastInsertRowid;
  recordMovement(db, { product_id: pA, type: 'apertura', quantity: 100, origin_type: 'opening', warehouse_id: wh });
  recordMovement(db, { product_id: pB, type: 'apertura', quantity: 100, origin_type: 'opening', warehouse_id: wh });
  const cli = db.prepare("INSERT INTO clients (name,fiscal_id,active) VALUES ('Cliente Uno','12345678Z',1)").run().lastInsertRowid;
  const cli2 = db.prepare("INSERT INTO clients (name,fiscal_id,active) VALUES ('Cliente Dos','87654321X',1)").run().lastInsertRowid;

  const snap = () => M.ventasResumen(db);
  let s = snap();
  ok(s.count === 0 && s.total === 0, 'arranque: 0 ventas (BD limpia, sin sales_orders viejo)');

  // 1) Mostrador (ticket F2 anónimo): 1× A (100 @21) = base 100 · IVA 21 · total 121. CUENTA.
  const t1 = emitTicketSvc(db, { warehouse_id: wh, payment_method: 'efectivo', lines: [{ product_id: pA, quantity: 1, unit_price: 0, tax_rate: 0 }] });
  s = snap();
  ok(s.count === 1 && r2(s.total) === 121 && r2(s.base) === 100 && r2(s.iva) === 21, 'venta de mostrador (ticket F2) cuenta: 1 doc · base 100 · IVA 21 · total 121');

  // 2) Factura completa con cliente: 1× B (200 @21) = base 200 · IVA 42 · total 242. CUENTA.
  const inv1 = createInvoice(db, { client_id: cli, lines: [{ description: 'Producto B', quantity: 1, unit_price: 200, tax_rate: 21 }] });
  s = snap();
  ok(s.count === 2 && r2(s.total) === 363, 'factura con cliente cuenta: 2 docs · total 363 (121 + 242)');
  const hist = M.clientVentas(db, cli);
  ok(hist.length === 1 && hist[0].order_number === inv1.invoice_number && r2(hist[0].total) === 242, 'historial del cliente lista SU factura (' + inv1.invoice_number + ', 242)');
  ok(M.clientVentas(db, cli2).length === 0, 'historial de otro cliente NO la incluye');

  // 3) ANULAR la factura → deja de sumar; sigue en el historial pero marcada anulada.
  anularInvoice(db, inv1.id, 'prueba PIEZA C');
  s = snap();
  ok(s.count === 1 && r2(s.total) === 121, 'factura anulada NO suma (vuelve a 1 doc · 121)');
  const histA = M.clientVentas(db, cli);
  ok(histA.length === 1 && histA[0].status === 'anulada', 'la anulada sigue en el historial del cliente, marcada "anulada"');

  // 4) SUSTITUTIVA: ticket T2 (1× B = 242) y luego F3 que lo sustituye. NO cuentan los dos.
  const t2 = emitTicketSvc(db, { warehouse_id: wh, payment_method: 'tarjeta', lines: [{ product_id: pB, quantity: 1, unit_price: 0, tax_rate: 0 }] });
  const sAfterT2 = snap();
  ok(sAfterT2.count === 2 && r2(sAfterT2.total) === 363, 'tras el ticket T2: 2 docs · 363 (121 + 242)');
  const f3 = emitSustitutivaSvc(db, t2.id, cli2);
  const sAfterF3 = snap();
  ok(sAfterF3.count === 2 && r2(sAfterF3.total) === 363, 'tras la sustitutiva F3: SIGUEN 2 docs · 363 (no se cuenta doble: F3 reemplaza al ticket)');
  const counting = new Set(M.countingSalesInvoices(db, {}).map(i => i.id));
  ok(counting.has(f3.id) && !counting.has(t2.id), 'cuenta la F3, NO el ticket sustituido');
  ok(M.clientVentas(db, cli2).some(h => h.order_number === f3.invoice_number), 'la F3 aparece en el historial del cliente destinatario');

  // 5) RECTIFICATIVA por diferencias (abono): netea (resta su importe) sobre la factura viva.
  const inv2 = createInvoice(db, { client_id: cli, lines: [{ description: 'Producto A', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  const sBeforeRect = snap();
  const rect = createRectificativa(db, { original_id: inv2.id, rectification_type: 'R4', rectification_mode: 'I', notes: 'descuento posterior', lines: [{ description: 'Abono parcial', quantity: 1, unit_price: -50, tax_rate: 21 }] });
  const sAfterRect = snap();
  ok(r2(sAfterRect.total) === r2(sBeforeRect.total - 60.5), 'rectificativa/abono NETEA: el total baja 60.5 (-50 base, -10.5 IVA)');

  // 6) Top productos: desde líneas de facturas que cuentan; nada de la anulada.
  const top = M.topProductos(db, { limit: 10 });
  ok(top.length > 0 && top.every(p => p.product_name), 'topProductos sale de líneas de facturas (con product_name)');

  // 7) Series temporales y últimas facturas no rompen.
  ok(M.ventasPorDia(db, 30).some(d => d.date === today), 'ventasPorDia incluye hoy');
  ok(M.ventasPorMes(db, 3).some(m => m.month === today.slice(0, 7)), 'ventasPorMes incluye el mes actual');
  ok(M.ultimasFacturas(db, 5).length > 0, 'ultimasFacturas devuelve documentos recientes');

  // 8) Clientes inactivos: cli2 tiene una F3 de hoy → NO inactivo; un cliente nuevo sin facturas → inactivo.
  const cli3 = db.prepare("INSERT INTO clients (name,active) VALUES ('Cliente Tres',1)").run().lastInsertRowid;
  const inact = M.clientesInactivos(db, 30);
  ok(inact >= 1, 'clientesInactivos cuenta a quien NO tiene factura reciente (cli3 recién creado): ' + inact);

  // 9) Pedidos (customer_orders) — alineado con la 2a (no se tocó). Sin pedidos → 0 limpio.
  const ped = M.pedidosResumen(db);
  ok(ped.confirmadosMes === 0 && ped.pendientes === 0, 'pedidosResumen = 0 limpio sin customer_orders');
  ok(M.pedidosSinEntregar(db, 3) === 0, 'pedidosSinEntregar = 0 limpio');
} catch (e) { console.error('ERROR', e.message, e.stack?.split('\n')[1]); fail++; } finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
