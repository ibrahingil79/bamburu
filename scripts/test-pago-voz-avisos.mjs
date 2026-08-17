// Capa de dinero con proveedores · Paso (d) — tests de lógica de: (1) PAGO A CUENTA del
// proveedor (reparto auto/manual, abono excluido, sobrante, sobre el servicio validado) y
// (2) MOTOR PROACTIVO de avisos (vencimientosProveedor filtra ≤7d/vencida y ordena; avisosDelDia
// agrega; avisosEmail se arma solo con avisos). Sobre BD :memory: con runMigrations real.
//
//   node scripts/test-pago-voz-avisos.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  isPayable, supplierDebt, liveSupplierPayables, supplierAccountsSummary,
  repartoAutomaticoPago, validarRepartoManualPago,
} from '../modules/erp/pagos.js';
import { registerSupplierAccountPayment, registerSupplierPaymentSvc } from '../modules/erp/routes/supplier-invoices.js';
import {
  vencimientosProveedor, avisosDelDia, avisosEmail,
  stockBajo, resumenTexto, resumenAvisos, estadoAvisos, marcarVistos, avisoKey,
} from '../modules/erp/avisos.js';
import { recordMovement, defaultWarehouseId } from '../modules/erp/stock.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

const TODAY = '2026-06-17';
function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let seq = 0;
function addSupplier(db, name = 'Esencias') {
  return db.prepare("INSERT INTO suppliers (name,active,payment_term_days) VALUES (?,1,0)").run(name + (++seq)).lastInsertRowid;
}
// Inserta una factura recibida VIGENTE con due_date y total controlados (motor puro).
function addInvoice(db, supplierId, { total = 100, due = '2026-06-01', date = '2026-05-20', neg = false } = {}) {
  seq++;
  return db.prepare(`INSERT INTO supplier_invoices
    (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, entity_type, entity_id)
    VALUES (?,?,?,?,?,?,?,?, 'vigente', 'Prov', ?, ?)`)
    .run(supplierId, 'FRP-' + String(seq).padStart(4, '0'), 'N' + seq, date, due, total, 0, total,
         neg ? 'supplier_return' : null, neg ? seq : null).lastInsertRowid;
}
const pend = (db, id) => supplierDebt(db, db.prepare('SELECT supplier_id FROM supplier_invoices WHERE id=?').get(id).supplier_id, TODAY)
  .invoices.find(i => i.id === id).pendiente;

// ── 1. Reparto AUTOMÁTICO: más antigua primero, sin sobrepasar ──────────────
console.log('1. Reparto automático (más antigua primero)');
{
  const db = freshDb();
  const s = addSupplier(db);
  const a = addInvoice(db, s, { total: 100, due: '2026-06-01' });
  const b = addInvoice(db, s, { total: 100, due: '2026-06-05' });
  const c = addInvoice(db, s, { total: 100, due: '2026-06-10' });
  const vivas = liveSupplierPayables(db, s, TODAY);
  eq(vivas.map(v => v.supplier_invoice_id), [a, b, c], 'liveSupplierPayables ordena por vencimiento (antigua→nueva)');
  const r = registerSupplierAccountPayment(db, s, { amount: 250 }, { today: TODAY });
  eq(r.pagos.map(p => [p.supplier_invoice_id, p.importe]), [[a, 100], [b, 100], [c, 50]], 'reparte 250 → 100/100/50 de antigua a nueva');
  eq([r.repartido, r.sinAsignar], [250, 0], 'repartido 250, sin sobrante');
  ok(Math.abs(pend(db, a)) < 0.005 && Math.abs(pend(db, b)) < 0.005 && Math.abs(pend(db, c) - 50) < 0.005, 'pendientes tras el pago: 0/0/50');
  db.close();
}

// ── 2. Sobrante avisado (amount > deuda total) ──────────────────────────────
console.log('2. Sobrante (amount > deuda)');
{
  const db = freshDb();
  const s = addSupplier(db);
  addInvoice(db, s, { total: 100, due: '2026-06-01' });
  addInvoice(db, s, { total: 100, due: '2026-06-05' });
  const r = registerSupplierAccountPayment(db, s, { amount: 350 }, { today: TODAY });
  eq([r.repartido, r.sinAsignar], [200, 150], 'paga 200 (toda la deuda) y avisa sobrante 150');
  eq(r.pagos.length, 2, 'aplica a las 2 facturas, ni una más (no inventa crédito)');
  db.close();
}

// ── 3. Reparto MANUAL: válido + guardas ─────────────────────────────────────
console.log('3. Reparto manual + guardas');
{
  const db = freshDb();
  const s = addSupplier(db);
  const a = addInvoice(db, s, { total: 100, due: '2026-06-01' });
  const b = addInvoice(db, s, { total: 100, due: '2026-06-05' });
  const r = registerSupplierAccountPayment(db, s, { amount: 120, modo: 'manual', asignacion: [{ supplier_invoice_id: a, importe: 80 }, { supplier_invoice_id: b, importe: 40 }] }, { today: TODAY });
  eq(r.pagos.map(p => [p.supplier_invoice_id, p.importe]), [[a, 80], [b, 40]], 'manual aplica 80/40 exactos');
  // suma != importe → 400
  throws(() => registerSupplierAccountPayment(db, s, { amount: 50, modo: 'manual', asignacion: [{ supplier_invoice_id: a, importe: 10 }] }, { today: TODAY }), 400, 'manual con suma != importe → 400');
  // sobrepasar pendiente de una factura → 400
  const c = addInvoice(db, s, { total: 30, due: '2026-06-09' });
  throws(() => registerSupplierAccountPayment(db, s, { amount: 100, modo: 'manual', asignacion: [{ supplier_invoice_id: c, importe: 100 }] }, { today: TODAY }), 400, 'manual sobrepasando el pendiente → 400');
  db.close();
}

// ── 4. El ABONO queda EXCLUIDO del reparto ──────────────────────────────────
console.log('4. Abono excluido del reparto');
{
  const db = freshDb();
  const s = addSupplier(db);
  const a = addInvoice(db, s, { total: 100, due: '2026-06-01' });
  const abono = addInvoice(db, s, { total: -40, due: '2026-06-02', neg: true });
  ok(!isPayable(db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(abono)), 'el abono (total<0) NO es pagable');
  const vivas = liveSupplierPayables(db, s, TODAY);
  eq(vivas.map(v => v.supplier_invoice_id), [a], 'liveSupplierPayables excluye el abono');
  const r = registerSupplierAccountPayment(db, s, { amount: 100 }, { today: TODAY });
  eq(r.pagos.map(p => p.supplier_invoice_id), [a], 'el reparto solo toca la deuda real, no el abono');
  // El abono no recibió ningún apunte.
  eq(db.prepare('SELECT COUNT(*) n FROM supplier_payments WHERE supplier_invoice_id=?').get(abono).n, 0, 'el abono no recibe pagos');
  db.close();
}

// ── 5. Sin deuda viva → 400; proveedor inexistente → 404 ────────────────────
console.log('5. Guardas de proveedor');
{
  const db = freshDb();
  const s = addSupplier(db);
  throws(() => registerSupplierAccountPayment(db, s, { amount: 10 }, { today: TODAY }), 400, 'sin deuda viva → 400');
  throws(() => registerSupplierAccountPayment(db, 99999, { amount: 10 }, { today: TODAY }), 404, 'proveedor inexistente → 404');
  const a = addInvoice(db, s, { total: 50, due: '2026-06-01' });
  throws(() => registerSupplierAccountPayment(db, s, { amount: 0 }, { today: TODAY }), 400, 'importe 0 → 400');
  db.close();
}

// ── 6. supplierAccountsSummary (índice de DISA) ─────────────────────────────
console.log('6. supplierAccountsSummary');
{
  const db = freshDb();
  const s1 = addSupplier(db, 'Esencias');
  const s2 = addSupplier(db, 'Aromas');
  addInvoice(db, s1, { total: 100, due: '2026-06-01' });   // vencida 16d
  addInvoice(db, s1, { total: 50, due: '2026-06-20' });    // por vencer
  addInvoice(db, s2, { total: 200, due: '2026-06-25' });   // por vencer
  const sum = supplierAccountsSummary(db, TODAY);
  eq(sum.total, 350, 'total global de deuda = 350');
  eq(sum.rows[0].supplier_id, s1, 'el más vencido (s1) va primero');
  eq([sum.rows[0].deudaTotal, sum.rows[0].facturas], [150, 2], 's1 debe 150 en 2 facturas');
  ok(sum.rows[0].vivas.length === 2, 's1 lista sus 2 facturas vivas');
  db.close();
}

// ── 7. vencimientosProveedor: filtra ≤7d / vencida y ordena ─────────────────
console.log('7. vencimientosProveedor (filtro + orden)');
{
  const db = freshDb();
  const s = addSupplier(db);
  const venc = addInvoice(db, s, { total: 100, due: '2026-06-01' });   // vencida 16d → SÍ
  const hoy = addInvoice(db, s, { total: 30, due: '2026-06-17' });     // vence hoy (0d) → SÍ
  const pron = addInvoice(db, s, { total: 40, due: '2026-06-20' });    // 3d → SÍ
  const lejos = addInvoice(db, s, { total: 70, due: '2026-06-30' });   // 13d → NO
  const abono = addInvoice(db, s, { total: -20, due: '2026-06-02', neg: true }); // abono → NO
  const pagada = addInvoice(db, s, { total: 25, due: '2026-06-05' });
  registerSupplierPaymentSvc(db, pagada, { amount: 25 }, { today: TODAY });        // saldada → NO

  const av = vencimientosProveedor(db, TODAY);
  const ids = av.map(a => a.ref.supplier_invoice_id);
  eq(ids, [venc, hoy, pron], 'incluye SOLO vencida + las que vencen en ≤7d; excluye lejana, abono y pagada');
  ok(av[0].ref.vencida && av[0].ref.dias_vencida === 16, 'la vencida (16d) va primera');
  ok(!av[1].ref.vencida && av[1].ref.dias_para_vencer === 0, 'la que vence hoy va antes que la de 3d');
  ok(av[2].ref.dias_para_vencer === 3, 'la de 3d va al final del grupo por vencer');
  db.close();
}

// ── 8. avisosDelDia agrega; avisosEmail solo si hay avisos ──────────────────
console.log('8. avisosDelDia + avisosEmail');
{
  const db = freshDb();
  const s = addSupplier(db);
  // Sin nada vencido/próximo → cero avisos.
  addInvoice(db, s, { total: 70, due: '2026-07-30' });
  eq(avisosDelDia(db, TODAY).length, 0, 'sin vencimientos próximos → 0 avisos (no se mandará correo)');
  // Con una vencida → un aviso, y el email se arma.
  addInvoice(db, s, { total: 100, due: '2026-06-01' });
  const avs = avisosDelDia(db, TODAY);
  eq(avs.length, 1, 'una factura vencida → 1 aviso');
  const tpl = avisosEmail({ avisos: avs, company: { company_name: 'Esencias SL', currency_symbol: '€' } });
  // EL ASUNTO YA NO ES UN RECUENTO. Antes decía "Bamburu · {{n}} avisos que requieren tu atención",
  // y este test esperaba "1 aviso " mientras la plantilla escribía "1 avisos": llevaba en rojo desde
  // entonces por una 's'. El encargo de "avisos y correos" (17 ago 2026) reescribió el asunto para
  // que lleve LA NOTICIA —lo único que se lee en la notificación del móvil sin abrir nada—, así que
  // lo que hay que comprobar cambia: que el asunto diga QUÉ pasa, no CUÁNTAS cosas pasan.
  ok(/^Tu negocio hoy · /.test(tpl.subject), 'el asunto abre con el parte, no con un recuento: ' + JSON.stringify(tpl.subject));
  ok(/1 vencimiento de proveedor|proveedor/i.test(tpl.subject), 'y el asunto nombra la noticia concreta');
  ok(!/\d+ avisos\b/.test(tpl.subject), 'el asunto ya NO cuenta "N avisos" (era el rojo previo: decía "1 avisos")');
  ok(tpl.text.includes(avs[0].titulo) && tpl.html.includes('Esencias'), 'el cuerpo lista el aviso y el negocio');
  db.close();
}

// ── 13. Email UNIFICADO con el flag: bloque por fuente, mismos conteos ───────
console.log('13. Email unificado (bloques por fuente)');
{
  const db = freshDb();
  const s = addSupplier(db);
  addInvoice(db, s, { total: 100, due: '2026-06-01' });   // 1 vencimiento
  addLowProduct(db, { stock: 2 }); addLowProduct(db, { stock: 0 });   // 2 stock bajo
  const avs = avisosDelDia(db, TODAY);
  const tpl = avisosEmail({ avisos: avs, company: { company_name: 'X', currency_symbol: '€' } });
  // El email cuenta EXACTAMENTE lo mismo que el flag (misma fuente avisosDelDia). Lo que cambia con
  // el encargo de "avisos y correos" es DÓNDE se comprueba: el conteo por fuente sigue viviendo en
  // el cuerpo (los bloques de abajo), y el asunto pasa a llevar el titular. Las cifras son las mismas.
  ok(/Tu negocio hoy/.test(tpl.subject), 'el asunto lleva el parte');
  eq(avs.length, 3, 'el flag y el email parten de los mismos 3 avisos');
  ok(/Facturas de proveedor.*\(1\)/.test(tpl.text) && /Productos bajo su mínimo de stock \(2\)/.test(tpl.text), 'el email lleva LOS DOS bloques con sus conteos (1 / 2)');
  ok(tpl.html.includes('Facturas de proveedor') && tpl.html.includes('Productos bajo su mínimo de stock'), 'el HTML también muestra ambos bloques');

  // Tenant con SOLO stock bajo → el email lleva el bloque de stock (antes no lo llevaba).
  const db2 = freshDb();
  addLowProduct(db2, { stock: 1 });
  const avs2 = avisosDelDia(db2, TODAY);
  const tpl2 = avisosEmail({ avisos: avs2, company: { currency_symbol: '€' } });
  ok(/Productos bajo su mínimo de stock \(1\)/.test(tpl2.text) && !/Facturas de proveedor/.test(tpl2.text), 'solo stock bajo → bloque de stock, sin bloque de proveedor');
  db.close(); db2.close();
}

// ── 9. Idempotencia del marcador diario (daily_alert_log) ───────────────────
console.log('9. Idempotencia diaria (daily_alert_log)');
{
  const db = freshDb();
  ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_alert_log'").get(), 'tabla daily_alert_log existe (migración)');
  db.prepare('INSERT OR REPLACE INTO daily_alert_log (fecha, canal, avisos) VALUES (?,?,?)').run(TODAY, 'email', 3);
  // Reinsertar el mismo día NO duplica (PK por fecha).
  db.prepare('INSERT OR REPLACE INTO daily_alert_log (fecha, canal, avisos) VALUES (?,?,?)').run(TODAY, 'email', 5);
  eq(db.prepare('SELECT COUNT(*) n FROM daily_alert_log WHERE fecha=?').get(TODAY).n, 1, 'una sola fila por día (no reenvía dos veces)');
  db.close();
}

// Un producto BAJO SU MÍNIMO: la señal ya no es el umbral fijo stock<5 sobre la caché, sino el
// DISPONIBLE por almacén (stock_movements) contra un mínimo real (stock_levels). Se pone `stock`
// de disponible y un mínimo por encima (stock+10) para que quede bajo mínimo. Un aviso por producto.
function addLowProduct(db, { stock = 2, name = 'Vela' } = {}) {
  seq++;
  let w = defaultWarehouseId(db);
  if (!w) w = Number(db.prepare("INSERT INTO warehouses (name, active, is_default) VALUES ('Principal',1,1)").run().lastInsertRowid);
  const pid = Number(db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,status,tax_rate,tax_band) VALUES (?,?,?,10,'physical',0,'active',21,'general')")
    .run(name + seq, 'p' + seq, 'S' + seq).lastInsertRowid);
  if (stock > 0) recordMovement(db, { product_id: pid, type: 'apertura', quantity: stock, origin_type: 'opening', warehouse_id: w, note: 'seed' });
  db.prepare("INSERT INTO stock_levels (product_id, warehouse_id, min_qty, target_qty) VALUES (?,?,?,?)").run(pid, w, stock + 10, stock + 20);
  return pid;
}

// ── 10. Stock bajo es FUENTE del motor; resumen y conteo coinciden ──────────
console.log('10. Fuente stock bajo + resumen-primero');
{
  const db = freshDb();
  const s = addSupplier(db);
  addInvoice(db, s, { total: 100, due: '2026-06-01' });   // 1 vencimiento
  addLowProduct(db, { stock: 2 });
  addLowProduct(db, { stock: 0 });                          // 2 productos stock bajo
  const sb = stockBajo(db, TODAY);
  eq(sb.length, 2, 'stockBajo detecta 2 productos bajo su mínimo');
  const todos = avisosDelDia(db, TODAY);
  eq(todos.length, 3, 'avisosDelDia agrega 2 fuentes: 1 vencimiento + 2 stock = 3 (== badge)');
  const groups = resumenAvisos(todos);
  eq(groups.map(g => [g.tipo, g.count]), [['vencimiento_proveedor', 1], ['stock_bajo', 2]], 'resumen agrupa por fuente con sus conteos');
  const txt = resumenTexto(todos);
  // (el token "cobr" ya no sirve de proxy: "cobros de cliente vencidos" es una fuente legítima
  //  del motor y la palabra aparece nombrando el aviso. Se vigilan los verbos de oferta.)
  ok(/Tienes 2 cosas que mirar/.test(txt) && /1 factura/.test(txt) && /2 producto/.test(txt) && !/email|recordatorio|reclam/i.test(txt), 'resumen: 2 grupos, conteos correctos, SIN ofrecer acciones');
  db.close();
}

// ── 11. Estado visto/nuevo (Opción C): rojo→visto→rojo(nuevo)→visto(empeora)→apagado ──
console.log('11. Estado del badge (visto/nuevo)');
{
  const db = freshDb();
  const s = addSupplier(db);
  const a = addInvoice(db, s, { total: 100, due: '2026-06-01' });   // vencida → 1 aviso
  eq(estadoAvisos(db, TODAY).estado, 'rojo', 'con un aviso sin abrir → ROJO');

  marcarVistos(db, [], TODAY);                                    // abrir el badge
  eq(estadoAvisos(db, TODAY).estado, 'visto', 'tras abrir → VISTO');

  // Empeora la ya vista (vence antes → más días vencida): MISMA clave → sigue visto.
  db.prepare('UPDATE supplier_invoices SET due_date=? WHERE id=?').run('2026-05-01', a);
  eq(estadoAvisos(db, TODAY).estado, 'visto', 'que una ya vista EMPEORE no reactiva el rojo');

  // Aparece una factura NUEVA que cruza a vencida → clave nueva → ROJO.
  const b = addInvoice(db, s, { total: 50, due: '2026-06-05' });
  const est = estadoAvisos(db, TODAY);
  eq(est.estado, 'rojo', 'una factura NUEVA vencida → vuelve a ROJO');
  ok(est.nuevos.length === 1 && est.nuevos[0] === avisoKey({ ref: { source: 'vencimientos_proveedor', supplier_invoice_id: b } }), 'lo nuevo es exactamente la factura nueva');

  marcarVistos(db, [], TODAY);
  eq(estadoAvisos(db, TODAY).estado, 'visto', 'tras volver a abrir → VISTO de nuevo');

  // Se pagan todas → sin avisos → APAGADO.
  registerSupplierPaymentSvc(db, a, { amount: 100 }, { today: TODAY });
  registerSupplierPaymentSvc(db, b, { amount: 50 }, { today: TODAY });
  eq(estadoAvisos(db, TODAY).estado, 'apagado', 'sin avisos (todo pagado) → APAGADO');
  db.close();
}

// ── 12. Un producto que CAE a stock bajo reactiva el rojo (huella por fuente) ──
console.log('12. Stock nuevo reactiva el rojo');
{
  const db = freshDb();
  const s = addSupplier(db);
  addInvoice(db, s, { total: 100, due: '2026-06-01' });
  marcarVistos(db, [], TODAY);
  eq(estadoAvisos(db, TODAY).estado, 'visto', 'visto con solo el vencimiento');
  addLowProduct(db, { stock: 1 });                                  // producto nuevo bajo mínimos
  eq(estadoAvisos(db, TODAY).estado, 'rojo', 'un producto que cae a stock bajo → ROJO');
  db.close();
}

console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK');
process.exit(fail ? 1 : 0);
