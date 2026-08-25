// Verificación — Pilar 4 · Pieza 2b: ALBARÁN (entrega) — CIERRA LA CADENA (lógica, BD temporal).
//   node scripts/verify-albaranes.mjs
// Ciclo del albarán (confirmar saca stock, anular revierte); parcial (6+4 cierra el pedido,
// estados); consumo de reserva (entregar baja reservado, anular re-reserva); suelto sin reserva;
// solo físicos mueven stock; guardas (≤ pendiente, disponible, integridad 409);
// albarán→factura y pedido→factura con enlace.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import { createPedidoSvc, confirmPedidoSvc, cancelPedidoSvc, orderToInvoiceSvc } from '../modules/erp/routes/pedidos.js';
import { createAlbaranSvc, cancelAlbaranSvc, albaranToInvoiceSvc, orderDeliveryState } from '../modules/erp/routes/albaranes.js';
import { recordMovement, reservedOfProduct, availableOfProduct, productStock, productStockInWarehouse } from '../modules/erp/stock.js';
// 25 ago 2026 · Los dominios de las direcciones de prueba pasan a `.test`, que está RESERVADO y no
// puede existir (RFC 2606). Antes usaban dominios que sí existen —de otra gente—, así que un correo
// del producto podía acabar en una bandeja ajena, y cada intento era un rebote contra bamburu.com.
// La puerta del correo los desvía a simulación. Ver docs/censo-correos.md.

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const oitems = (db, oid) => db.prepare('SELECT id, product_id, description FROM customer_order_items WHERE order_id=? ORDER BY id').all(oid);

console.log('\n=== Albarán (delivery_notes) — lógica ===\n');
const dbPath = join(tmpdir(), 'alb-' + process.pid + '.db');
const db = new Database(dbPath);
try {
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, tax_rate) VALUES (1,'Acme SL','B11111111',21)").run();
  db.prepare("UPDATE company_config SET country='ES', irpf_default=15, company_name='Acme SL', address='C/ Mayor 1', phone='600', email='a@x.test' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name, fiscal_id, client_type) VALUES ('Cliente Empresa SL','B22222222','empresa')").run().lastInsertRowid;
  const whMain = db.prepare("SELECT id FROM warehouses WHERE is_default=1").get().id;
  const wh2 = db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES ('Tienda',1,0)").run().lastInsertRowid;
  const ins = db.prepare("INSERT INTO products (name,slug,sku,price,stock,status,type,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?)");
  const mesa = ins.run('Mesa roble','mesa','MESA1',10,0,'active','physical',21,'general').lastInsertRowid;
  const serv = ins.run('Montaje','montaje','SERV1',100,0,'active','service',21,'general').lastInsertRowid;
  recordMovement(db, { product_id: mesa, type: 'apertura', quantity: 50, origin_type: 'opening', warehouse_id: whMain });

  // Pedido confirmado: 10× Mesa (físico) + 1× Montaje (servicio). reserva 10.
  const oid = createPedidoSvc(db, { client_id: cli, warehouse_id: whMain, lines: [
    { product_id: mesa, description: '', quantity: 10, unit_price: 10, tax_rate: 21 },
    { product_id: serv, description: '', quantity: 1, unit_price: 100, tax_rate: 21 },
  ]});
  confirmPedidoSvc(db, oid);
  const its = oitems(db, oid);
  const oiMesa = its.find(i => i.product_id === mesa).id, oiServ = its.find(i => i.product_id === serv).id;
  ok(reservedOfProduct(db, mesa) === 10 && productStockInWarehouse(db, mesa, whMain) === 50, 'pedido confirmado: reservado 10, stock físico 50 (aún no sale)');

  // 1) ALBARÁN PARCIAL desde el pedido: entregar 6 de Mesa.
  const a1 = createAlbaranSvc(db, { order_id: oid, lines: [{ order_item_id: oiMesa, quantity: 6, description: '_', unit_price: 0 }] });
  ok(a1.delivery_number === 'DEL-0001', 'confirmar albarán → número DEL-0001 (al confirmar)');
  ok(productStockInWarehouse(db, mesa, whMain) === 44, 'CONFIRMAR SACA STOCK: 50 − 6 = 44 en el libro');
  ok(reservedOfProduct(db, mesa) === 4, 'CONSUME RESERVA: reservado 10 − 6 entregado = 4');
  let st = orderDeliveryState(db, oid);
  ok(st.lines.find(l => l.order_item_id === oiMesa).entregado === 6 && st.lines.find(l => l.order_item_id === oiMesa).pendiente === 4, 'pedido: Mesa entregado 6 / pendiente 4');
  ok(db.prepare('SELECT delivered_status FROM customer_orders WHERE id=?').get(oid).delivered_status === 'parcial', 'pedido pasa a "parcial" (parcialmente entregado)');

  // 2) Guarda ≤ pendiente: entregar 100 de Mesa (pendiente 4) → 400.
  let overPend = false; try { createAlbaranSvc(db, { order_id: oid, lines: [{ order_item_id: oiMesa, quantity: 100, description: '_', unit_price: 0 }] }); } catch (e) { overPend = e.status === 400 && /pendiente/i.test(e.message); }
  ok(overPend, 'guarda ≤ pendiente: entregar más de lo pendiente → 400');

  // 3) Segundo albarán cierra el pedido: 4 de Mesa + 1 de Montaje (servicio, no mueve stock).
  const a2 = createAlbaranSvc(db, { order_id: oid, lines: [
    { order_item_id: oiMesa, quantity: 4, description: '_', unit_price: 0 },
    { order_item_id: oiServ, quantity: 1, description: '_', unit_price: 0 },
  ]});
  ok(productStockInWarehouse(db, mesa, whMain) === 40, 'segundo albarán: 44 − 4 = 40 (solo Mesa mueve stock)');
  ok(reservedOfProduct(db, mesa) === 0, 'reserva CONSUMIDA del todo: reservado 0');
  ok(db.prepare('SELECT delivered_status FROM customer_orders WHERE id=?').get(oid).delivered_status === 'entregado', 'pedido pasa a "entregado" (6+4 cierra)');

  // 4) Anular el segundo albarán → re-entra stock y RE-RESERVA.
  cancelAlbaranSvc(db, a2.id, 'error de entrega');
  ok(productStockInWarehouse(db, mesa, whMain) === 44, 'anular albarán: re-entra stock (40 + 4 = 44)');
  ok(reservedOfProduct(db, mesa) === 4, 'anular RE-RESERVA: las 4 unidades vuelven a reservar');
  ok(db.prepare('SELECT delivered_status FROM customer_orders WHERE id=?').get(oid).delivered_status === 'parcial', 'pedido vuelve a "parcial" tras anular');

  // 5) Integridad: no anular el pedido con un albarán confirmado (a1 sigue confirmado) → 409.
  let cancelBlocked = false; try { cancelPedidoSvc(db, oid, 'cambio de idea'); } catch (e) { cancelBlocked = e.status === 409; }
  ok(cancelBlocked, 'integridad: anular pedido con albarán confirmado → 409 (anula antes el albarán)');

  // 6) ALBARÁN → FACTURA (factura lo entregado) + enlace + re-convertir bloqueado.
  const f1 = albaranToInvoiceSvc(db, a1.id);
  const inv1 = db.prepare('SELECT * FROM invoices WHERE id=?').get(f1.invoice_id);
  ok(inv1 && f1.invoice_number, 'albarán → factura: crea factura real ' + f1.invoice_number);
  const link1 = db.prepare("SELECT 1 FROM document_links WHERE source_type='delivery_note' AND source_id=? AND dest_type='invoice' AND dest_id=?").get(a1.id, f1.invoice_id);
  ok(!!link1, 'enlace bidireccional albarán↔factura en document_links');
  ok(productStockInWarehouse(db, mesa, whMain) === 44, 'la factura NO mueve stock (sigue 44; lo movió el albarán)');
  let reFact = false; try { albaranToInvoiceSvc(db, a1.id); } catch (e) { reFact = e.status === 400; }
  ok(reFact, 're-facturar el mismo albarán → 400 (ya facturado)');

  // 7) Integridad: no anular un albarán ya facturado (a1) → 409.
  let albFactBlocked = false; try { cancelAlbaranSvc(db, a1.id, 'no procede'); } catch (e) { albFactBlocked = e.status === 409; }
  ok(albFactBlocked, 'integridad: anular albarán facturado → 409 (anula antes la factura)');

  // 8) PEDIDO → FACTURA (atajo): otro pedido, facturar directo + enlace.
  const o2 = createPedidoSvc(db, { client_id: cli, warehouse_id: whMain, lines: [{ product_id: mesa, description: '', quantity: 2, unit_price: 10, tax_rate: 21 }] });
  confirmPedidoSvc(db, o2);
  const f2 = orderToInvoiceSvc(db, o2);
  const link2 = db.prepare("SELECT 1 FROM document_links WHERE source_type='order' AND source_id=? AND dest_type='invoice'").get(o2);
  ok(f2.invoice_number && !!link2, 'pedido → factura (atajo): crea factura ' + f2.invoice_number + ' con enlace');
  ok(reservedOfProduct(db, mesa) === 4 + 2, 'pedido facturado SIGUE reservando (la factura no entrega): 4 (pedido 1) + 2 (pedido 2) = 6');
  let rePedFact = false; try { orderToInvoiceSvc(db, o2); } catch (e) { rePedFact = e.status === 400; }
  ok(rePedFact, 're-facturar el mismo pedido → 400');

  // 9) ALBARÁN SUELTO (sin pedido): saca stock mirando disponible. Disponible Mesa = 44 − 6 reservado = 38.
  ok(availableOfProduct(db, mesa, whMain) === 44 - 6, 'disponible Mesa = stock 44 − reservado 6 = 38');
  const sa = createAlbaranSvc(db, { client_id: cli, warehouse_id: whMain, lines: [{ product_id: mesa, description: '', quantity: 5, unit_price: 10, tax_rate: 21 }] });
  ok(sa.delivery_number && productStockInWarehouse(db, mesa, whMain) === 39 && sa.order_id === null, 'albarán suelto: saca 5 (44 → 39), sin pedido');

  // 10) Guarda disponible en suelto: entregar 100 (disponible 33) sin confirm_over → 400; con flag pasa.
  let overAvail = false; try { createAlbaranSvc(db, { client_id: cli, warehouse_id: whMain, lines: [{ product_id: mesa, description: '', quantity: 100, unit_price: 10, tax_rate: 21 }] }); } catch (e) { overAvail = e.status === 400 && /disponible|supera/i.test(e.message); }
  ok(overAvail, 'guarda disponible (suelto): entregar > disponible sin confirm_over → 400 (no en silencio)');
  const saOver = createAlbaranSvc(db, { client_id: cli, warehouse_id: whMain, lines: [{ product_id: mesa, description: '', quantity: 100, unit_price: 10, tax_rate: 21 }], confirm_over: true });
  ok(saOver.over === 1 && productStockInWarehouse(db, mesa, whMain) === 39 - 100, 'con confirm_over la entrega se confirma aunque deje negativo (39 → −61)');

  // 11) Solo físicos mueven stock: un albarán suelto de SOLO servicio no cambia stock.
  const stockBefore = productStock(db, mesa);
  createAlbaranSvc(db, { client_id: cli, warehouse_id: whMain, lines: [{ product_id: serv, description: '', quantity: 3, unit_price: 100, tax_rate: 21 }] });
  ok(productStock(db, mesa) === stockBefore, 'línea de servicio en albarán: NO mueve stock');

  // 12) Migración idempotente
  const before = db.prepare('SELECT COUNT(*) n FROM delivery_notes').get().n;
  runMigrations(db);
  ok(db.prepare('SELECT COUNT(*) n FROM delivery_notes').get().n === before, 'runMigrations idempotente (datos intactos)');
} finally {
  db.close();
  try { (await import('fs')).unlinkSync(dbPath); } catch {}
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
