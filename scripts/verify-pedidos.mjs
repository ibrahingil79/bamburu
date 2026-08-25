// Verificación — Pilar 4 · Pieza 2a: PEDIDO + RESERVA DE STOCK (lógica, BD temporal).
//   node scripts/verify-pedidos.mjs
// Parte A: ciclo del pedido (borrador→confirmado→anulado, PED-NNNN solo al confirmar, foto
//          congelada, totales como factura) + motor de reserva (confirmar aparta, anular suelta,
//          reservado por almacén, solo físicos; disponible = stock − reservado) + quote→pedido.
// Parte B: las 4 superficies cableadas (aviso de factura, TPV, lectura de DISA, inventario/ficha)
//          + la guarda de integridad de ajuste/traslado.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { createPedidoSvc, updatePedidoSvc, confirmPedidoSvc, cancelPedidoSvc, cancelRedoPedidoSvc, orderTotals } from '../modules/erp/routes/pedidos.js';
import { createQuoteSvc, emitQuoteSvc, convertQuoteSvc } from '../modules/erp/routes/quotes.js';
import { invoiceStockExcess } from '../modules/erp/routes/invoices.js';
import { warehouseBreakdown } from '../modules/erp/routes/warehouses.js';
import { createStockTransferSvc } from '../modules/erp/routes/stock-transfers.js';
import { recordMovement, reservedOfProduct, availableOfProduct, productStock, productStockInWarehouse, adjustStock } from '../modules/erp/stock.js';
// 25 ago 2026 · Los dominios de las direcciones de prueba pasan a `.test`, que está RESERVADO y no
// puede existir (RFC 2606). Antes usaban dominios que sí existen —de otra gente—, así que un correo
// del producto podía acabar en una bandeja ajena, y cada intento era un rebote contra bamburu.com.
// La puerta del correo los desvía a simulación. Ver docs/censo-correos.md.

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round(n * 100) / 100;

console.log('\n=== Pedido (customer_orders) — Parte A (ciclo + reserva) ===\n');
const dbPath = join(tmpdir(), 'ped-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate) VALUES (1,'Acme SL','B11111111',21)").run();
  db.prepare("UPDATE company_config SET fiscal_id='B11111111', country='ES', irpf_default=15, company_name='Acme SL', address='Calle Mayor 1', phone='600', email='acme@x.test' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name, fiscal_id, address, email, client_type) VALUES ('Cliente Empresa SL','B22222222','Av. Test 2','cli@x.test','empresa')").run().lastInsertRowid;

  // Almacenes: el principal lo crea la migración; añadimos un segundo.
  const whMain = db.prepare("SELECT id FROM warehouses WHERE is_default=1").get().id;
  const wh2 = db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES ('Tienda',1,0)").run().lastInsertRowid;

  // Productos: físico 'Mesa' (50 en principal, 8 en Tienda) + servicio 'Montaje'.
  const ins = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)");
  const mesa = ins.run('Mesa roble','mesa','MESA1',10,0,'active','physical',21,'general').lastInsertRowid;
  const serv = ins.run('Montaje','montaje','SERV1',100,0,'active','service',21,'general').lastInsertRowid;
  recordMovement(db, { product_id: mesa, type: 'apertura', quantity: 50, origin_type: 'opening', warehouse_id: whMain, note: 'Stock inicial' });
  recordMovement(db, { product_id: mesa, type: 'apertura', quantity: 8,  origin_type: 'opening', warehouse_id: wh2,    note: 'Stock inicial' });
  ok(productStock(db, mesa) === 58 && productStockInWarehouse(db, mesa, whMain) === 50, 'stock físico sembrado: 58 global (50 principal + 8 Tienda)');

  // 1) Crear borrador: 10× Mesa (catálogo) + 1× Montaje (servicio). Cliente empresa → IRPF 15%.
  const oid = createPedidoSvc(db, { client_id: cli, warehouse_id: whMain, expected_delivery_date: '2026-07-15', lines: [
    { product_id: mesa, description: '', quantity: 10, unit_price: 10, tax_rate: 21 },
    { product_id: serv, description: '', quantity: 1, unit_price: 100, tax_rate: 21 },
  ]});
  let o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(oid);
  ok(o.status === 'borrador' && o.order_number === null, 'borrador creado SIN número (no consume PED-NNNN)');
  ok(db.prepare("SELECT last_seq FROM code_counters WHERE entity='order'").get() === undefined, 'el contador de pedidos no se tocó en el borrador');
  ok(o.warehouse_id === whMain && o.expected_delivery_date === '2026-07-15', 'el borrador guarda almacén + fecha de entrega prevista (informativa)');
  // totales: base 200 (100 mesa + 100 montaje), IVA 42, IRPF 30 (15% s/200), total 212
  ok(r2(o.subtotal) === 200 && r2(o.tax_amount) === 42 && r2(o.irpf_amount) === 30 && r2(o.total) === 212,
     'totales borrador como la factura: base 200 · IVA 42 · IRPF 30 · total 212  (got ' + [o.subtotal,o.tax_amount,o.irpf_amount,o.total].map(r2).join(' / ') + ')');

  // 2) BORRADOR NO reserva nada.
  ok(reservedOfProduct(db, mesa) === 0 && availableOfProduct(db, mesa, whMain) === 50, 'un borrador NO reserva: reservado 0, disponible = stock');

  // 3) Editar borrador (sigue sin número, sin reserva); cambiar a wh2 y a 5 unidades
  updatePedidoSvc(db, oid, { client_id: cli, warehouse_id: whMain, lines: [
    { product_id: mesa, description: '', quantity: 10, unit_price: 10, tax_rate: 21 },
    { product_id: serv, description: '', quantity: 1, unit_price: 100, tax_rate: 21 },
  ]});
  o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(oid);
  ok(o.order_number === null, 'editar borrador OK, sigue sin número');

  // 4) CONFIRMAR → PED-0001 + foto congelada + NACE LA RESERVA
  const cf = confirmPedidoSvc(db, oid);
  o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(oid);
  ok(cf.order_number === 'PED-0001' && o.status === 'confirmado', 'confirmar → número PED-0001 y estado confirmado (número SOLO al confirmar)');
  ok(o.company_name === 'Acme SL' && o.client_name === 'Cliente Empresa SL' && o.client_fiscal_id === 'B22222222', 'foto congelada de emisor + cliente copiada al confirmar');
  ok(reservedOfProduct(db, mesa) === 10, 'CONFIRMAR APARTA: reservado de Mesa = 10 (la línea física del pedido confirmado)');
  ok(reservedOfProduct(db, serv) === 0, 'SOLO FÍSICOS reservan: el servicio (Montaje) reserva 0');
  ok(availableOfProduct(db, mesa, whMain) === 40 && availableOfProduct(db, mesa) === 48, 'disponible = stock − reservado: principal 40, global 48 (el stock físico NO se mueve)');
  ok(productStockInWarehouse(db, mesa, whMain) === 50, 'el libro de stock NO cambió: la reserva es capa aparte (sigue habiendo 50 físicas en principal)');

  // 5) reservado POR ALMACÉN: la reserva sale del almacén del pedido (principal), no de Tienda
  ok(reservedOfProduct(db, mesa, whMain) === 10 && reservedOfProduct(db, mesa, wh2) === 0, 'reservado por almacén: 10 en principal, 0 en Tienda');
  ok(availableOfProduct(db, mesa, wh2) === 8, 'disponible en Tienda intacto (8): la reserva de otro almacén no le afecta');

  // 6) transiciones bloqueadas (un confirmado NO se edita ni se re-confirma)
  let blocked = 0;
  try { updatePedidoSvc(db, oid, { client_id: cli, warehouse_id: whMain, lines: [{ description: 'x', quantity: 1, unit_price: 1, tax_rate: 21 }] }); } catch (e) { if (e.status === 400) blocked++; }
  try { confirmPedidoSvc(db, oid); } catch (e) { if (e.status === 400) blocked++; }
  ok(blocked === 2, 'un confirmado NO se edita ni se re-confirma (400 en ambos)');

  // 7) Foto congelada: cambiar empresa + cliente DESPUÉS no toca el confirmado
  db.prepare("UPDATE company_config SET company_name='OTRO NOMBRE' WHERE id=1").run();
  db.prepare("UPDATE clients SET name='Cliente Renombrado' WHERE id=?").run(cli);
  o = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(oid);
  ok(o.company_name === 'Acme SL' && o.client_name === 'Cliente Empresa SL', 'cambiar Ajustes/cliente tras confirmar NO altera el pedido confirmado (foto congelada)');
  db.prepare("UPDATE company_config SET company_name='Acme SL' WHERE id=1").run();

  // 8) ANULAR → SUELTA LA RESERVA
  cancelPedidoSvc(db, oid, 'cliente desistió');
  ok(db.prepare('SELECT status FROM customer_orders WHERE id=?').get(oid).status === 'anulado', 'anular (con motivo) → estado anulado');
  ok(reservedOfProduct(db, mesa) === 0 && availableOfProduct(db, mesa, whMain) === 50, 'ANULAR SUELTA: reservado vuelve a 0, disponible vuelve a 50');

  // 9) numeración correlativa: un 2º confirmado → PED-0002
  const o2 = createPedidoSvc(db, { client_id: cli, warehouse_id: whMain, lines: [{ product_id: mesa, description: '', quantity: 3, unit_price: 10, tax_rate: 21 }] });
  const cf2 = confirmPedidoSvc(db, o2);
  ok(cf2.order_number === 'PED-0002', 'segundo confirmado → PED-0002 (contador solo avanza al confirmar)');
  ok(reservedOfProduct(db, mesa) === 3, 'reservado del 2º pedido = 3');

  // 10) anular-y-rehacer
  const re = cancelRedoPedidoSvc(db, o2, 'corregir cantidad');
  ok(db.prepare('SELECT status FROM customer_orders WHERE id=?').get(o2).status === 'anulado'
     && db.prepare('SELECT replaces_order_id, status FROM customer_orders WHERE id=?').get(re.id).replaces_order_id === o2
     && db.prepare('SELECT COUNT(*) n FROM customer_order_items WHERE order_id=?').get(re.id).n === 1,
     'anular-y-rehacer: anula el confirmado y abre un borrador nuevo enlazado con las mismas líneas');
  ok(reservedOfProduct(db, mesa) === 0, 'tras anular-y-rehacer (el nuevo es borrador) → reservado 0 (el borrador no reserva)');

  // 11) CONVERSIÓN presupuesto → PEDIDO (motor de conversión): arrastra líneas + enlace bidireccional
  const qid = createQuoteSvc(db, { client_id: cli, lines: [{ product_id: mesa, description: '', quantity: 4, unit_price: 10, tax_rate: 21 }] });
  emitQuoteSvc(db, qid);
  const conv = convertQuoteSvc(db, qid, 'order');
  const ped = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(conv.order_id);
  const pedItems = db.prepare('SELECT * FROM customer_order_items WHERE order_id=? ORDER BY id').all(conv.order_id);
  ok(!!ped && ped.status === 'borrador' && pedItems.length === 1 && pedItems[0].product_id === mesa && r2(pedItems[0].total_price) === 40,
     'presupuesto → pedido: crea un pedido en BORRADOR arrastrando las líneas del presupuesto');
  const link = db.prepare("SELECT * FROM document_links WHERE source_type='quote' AND source_id=? AND dest_type='order'").get(qid);
  ok(link && link.dest_id === conv.order_id, 'enlace bidireccional origen↔destino en document_links (quote→order)');
  let conv2blocked = false; try { convertQuoteSvc(db, qid, 'order'); } catch (e) { conv2blocked = e.status === 400; }
  ok(conv2blocked, 're-convertir a pedido el mismo presupuesto → 400 (ya convertido, sin duplicar)');
  ok(reservedOfProduct(db, mesa) === 0, 'el pedido recién convertido es borrador → aún no reserva');
  confirmPedidoSvc(db, conv.order_id);
  ok(reservedOfProduct(db, mesa) === 4, 'al confirmar el pedido convertido → reserva 4');

  console.log('\n=== Pedido — Parte B (4 superficies cableadas + guardas) ===\n');
  // Estado actual: Mesa stock principal 50, reservado (por el pedido convertido) 4 → disponible 46.
  // 12) SUPERFICIE 1 — aviso de factura por encima del stock mira DISPONIBLE = stock − reservado.
  ok(invoiceStockExcess(db, [{ product_id: mesa, quantity: 54 }]).length === 0, 'factura: 54 = disponible (58 − 4 reservado) → sin aviso (la reserva no es exceso)');
  const exc = invoiceStockExcess(db, [{ product_id: mesa, quantity: 55 }]);
  ok(exc.length === 1 && exc[0].stock === 58 && exc[0].reserved === 4 && exc[0].available === 54 && exc[0].requested === 55 && exc[0].excess === 1,
     'factura: 55 > disponible 54 → aviso con stock 58 / reservado 4 / disponible 54 / exceso 1  (got ' + JSON.stringify(exc[0] || {}) + ')');
  ok(invoiceStockExcess(db, [{ product_id: serv, quantity: 999 }]).length === 0, 'factura: servicios/digitales/líneas libres NUNCA se chequean');

  // 13) SUPERFICIE 2 — TPV: la guarda de venta usa disponible POR ALMACÉN (availableOfProduct).
  //     En principal: 50 stock − 4 reservado = 46 disponible.
  ok(availableOfProduct(db, mesa, whMain) === 46, 'TPV: disponible en principal = 46 (no deja vender lo reservado)');

  // 14) SUPERFICIE 4 — inventario/ficha: warehouseBreakdown da stock/reservado/disponible por almacén.
  const bd = warehouseBreakdown(db, mesa);
  const bdMain = bd.find(w => w.id === whMain);
  ok(bdMain && bdMain.qty === 50 && bdMain.reserved === 4 && bdMain.available === 46, 'inventario/ficha: desglose por almacén con stock 50 / reservado 4 / disponible 46');

  // 15) GUARDA DE INTEGRIDAD — AJUSTE: bajar el principal por debajo de lo reservado avisa (409)
  //     sin confirmar; con confirm pasa. (Reservado en principal = 4.)
  let adjGuard = false;
  try { adjustStock(db, mesa, { mode: 'set', value: 2, reason: 'error_conteo', warehouse_id: whMain }); }
  catch (e) { adjGuard = e.status === 409 && /reservad/i.test(e.message); }
  ok(adjGuard, 'guarda de ajuste: poner principal a 2 (< 4 reservados) → 409 con aviso (no en silencio)');
  const adjOk = adjustStock(db, mesa, { mode: 'set', value: 2, reason: 'error_conteo', warehouse_id: whMain }, { confirmBelowReserved: true });
  ok(adjOk && productStockInWarehouse(db, mesa, whMain) === 2, 'guarda de ajuste: con confirm_below_reserved el ajuste se aplica (principal queda en 2)');
  // restituir para el test de traslado
  adjustStock(db, mesa, { mode: 'set', value: 50, reason: 'error_conteo', warehouse_id: whMain }, { confirmBelowReserved: true });

  // 16) GUARDA DE INTEGRIDAD — TRASLADO: sacar del principal por debajo de lo reservado avisa (409).
  //     Principal: 50 stock, 4 reservados. Trasladar 48 dejaría 2 (< 4).
  let trGuard = false;
  try { createStockTransferSvc(db, { from_warehouse_id: whMain, to_warehouse_id: wh2, date: '2026-06-24', items: [{ product_id: mesa, quantity: 48 }] }); }
  catch (e) { trGuard = e.status === 409 && /reservad/i.test(e.message); }
  ok(trGuard, 'guarda de traslado: sacar 48 del principal (dejaría 2 < 4 reservados) → 409 con aviso');
  const trOk = createStockTransferSvc(db, { from_warehouse_id: whMain, to_warehouse_id: wh2, date: '2026-06-24', items: [{ product_id: mesa, quantity: 48 }], confirm_below_reserved: true });
  ok(trOk && trOk.id, 'guarda de traslado: con confirm_below_reserved el traslado se confirma');

  // 17) Migración idempotente
  const before = db.prepare('SELECT COUNT(*) n FROM customer_orders').get().n;
  runMigrations(db);
  ok(db.prepare('SELECT COUNT(*) n FROM customer_orders').get().n === before, 'runMigrations idempotente (datos intactos al re-ejecutar)');
} finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
