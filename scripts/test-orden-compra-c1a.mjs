// C1.a Orden de compra — tests de lógica. Gates del encargo:
//   (a) OC-NNNN correlativo asignado SOLO al enviar (el borrador no consume número)
//   (b) PUT/editar rechazado si no es borrador
//   (c) anular exige motivo (mín. 3) y solo sobre enviada
//   (d) anular-y-rehacer crea borrador con replaces_order_id correcto (y copia líneas)
//   (e) el pie cuadra con IVA por tasa (base + cuota por tasa, total)
//   (f) CERO stock_movements en TODO el flujo (la orden es documento, no mueve stock)
// Extra: email solo enviada + proveedor con email (mock de Resend, chequeo de {error}),
// línea solo-catálogo, tax_rate resuelto por el servidor desde el producto.
//
//   node scripts/test-orden-compra-c1a.mjs
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import {
  createPurchaseOrderSvc, updatePurchaseOrderSvc, sendPurchaseOrderSvc,
  anularPurchaseOrderSvc, anularYRehacerSvc, emailPurchaseOrderSvc, purchaseOrderTotals,
  lastKnownCost,
} from '../modules/erp/routes/purchase-orders.js';

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function throws(fn, status, m) { let e = null; try { fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }
async function throwsAsync(fn, status, m) { let e = null; try { await fn(); } catch (x) { e = x; } ok(e && e.status === status, m + ' (status ' + (e && e.status) + ', want ' + status + ')'); }

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
let n = 0;
function addSupplier(db, email = '') {
  return db.prepare("INSERT INTO suppliers (name, email) VALUES (?, ?)").run('Prov' + (++n), email).lastInsertRowid;
}
function addProduct(db, taxRate = 21, stock = 5) {
  return db.prepare("INSERT INTO products (name,slug,sku,price,type,stock,tax_rate,tax_band) VALUES (?,?,?,99,'physical',?,?,'general')")
    .run('P' + (++n), 'p' + n, 'S' + n, stock, taxRate).lastInsertRowid;
}
const movCount = db => db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c;
const stockOf = (db, id) => db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock;
const orderRow = (db, id) => db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
const itemsOf = (db, id) => db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY id').all(id);

// ── 1. Borrador: se crea SIN número y con líneas resueltas contra el catálogo ──
console.log('1. Crear borrador');
{
  const db = freshDb();
  const sup = addSupplier(db), p21 = addProduct(db, 21), p10 = addProduct(db, 10);
  const id = createPurchaseOrderSvc(db, {
    supplier_id: sup, date: '2026-06-10', expected_date: '2026-06-20', notes: 'urgente',
    items: [
      { product_id: p21, quantity: 4, unit_cost: 10 },
      { product_id: p10, quantity: 2, unit_cost: 5 },
    ],
  });
  const o = orderRow(db, id);
  eq(o.status, 'borrador', 'nace en estado borrador');
  eq(o.order_number, null, 'el borrador NO tiene número (a)');
  eq(o.expected_date, '2026-06-20', 'guarda la entrega prevista');
  const its = itemsOf(db, id);
  eq(its.length, 2, 'dos líneas');
  eq(its[0].tax_rate, 21, 'IVA de línea 1 resuelto desde el producto (no del cliente)');
  eq(its[1].tax_rate, 10, 'IVA de línea 2 resuelto desde el producto');
  eq(its[0].unit_cost, 10, 'coste NETO guardado tal cual');
  // línea solo-catálogo:
  throws(() => createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: 9999, quantity: 1, unit_cost: 1 }] }),
    400, 'producto inexistente → 400 (sin línea libre)');
  // proveedor archivado no vale:
  db.prepare('UPDATE suppliers SET active=0 WHERE id=?').run(sup);
  throws(() => createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p21, quantity: 1, unit_cost: 1 }] }),
    400, 'proveedor archivado → 400');
  eq(movCount(db), 0, 'crear borrador: 0 stock_movements (f)');
  db.close();
}

// ── 2. (a) Numeración: OC-NNNN correlativo SOLO al enviar ────────────────────
console.log('2. Enviar = numerar + bloquear');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const mk = () => createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 1, unit_cost: 2 }] });
  const a = mk(), b = mk(), c = mk();
  eq(orderRow(db, a).order_number, null, 'tres borradores: ninguno consume número');
  const r1 = sendPurchaseOrderSvc(db, b);     // se envía en otro orden que el de creación
  const r2 = sendPurchaseOrderSvc(db, a);
  eq(r1.order_number, 'OC-0001', 'primera enviada → OC-0001');
  eq(r2.order_number, 'OC-0002', 'segunda enviada → OC-0002 (correlativo por envío)');
  eq(orderRow(db, c).order_number, null, 'el borrador restante sigue sin número');
  eq(orderRow(db, b).status, 'enviada', 'estado → enviada');
  throws(() => sendPurchaseOrderSvc(db, b), 400, 'reenviar una enviada → 400');
  throws(() => sendPurchaseOrderSvc(db, 9999), 404, 'enviar inexistente → 404');
  eq(movCount(db), 0, 'enviar: 0 stock_movements (f)');
  db.close();
}

// ── 3. (b) Editar: solo borrador ─────────────────────────────────────────────
console.log('3. Editar solo borrador');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db, 21), p2 = addProduct(db, 4);
  const id = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 1, unit_cost: 2 }] });
  updatePurchaseOrderSvc(db, id, { supplier_id: sup, date: '2026-06-11', notes: 'editado', items: [{ product_id: p2, quantity: 3, unit_cost: 7 }] });
  const o = orderRow(db, id);
  eq([o.date, o.notes], ['2026-06-11', 'editado'], 'el borrador se edita (cabecera)');
  const its = itemsOf(db, id);
  eq([its.length, its[0].product_id, its[0].tax_rate], [1, p2, 4], 'las líneas se reemplazan y re-resuelven su IVA');
  sendPurchaseOrderSvc(db, id);
  throws(() => updatePurchaseOrderSvc(db, id, { supplier_id: sup, date: '2026-06-12', items: [{ product_id: p, quantity: 1, unit_cost: 1 }] }),
    400, 'editar una ENVIADA → 400 (b)');
  anularPurchaseOrderSvc(db, id, 'ya no hace falta');
  throws(() => updatePurchaseOrderSvc(db, id, { supplier_id: sup, date: '2026-06-12', items: [{ product_id: p, quantity: 1, unit_cost: 1 }] }),
    400, 'editar una ANULADA → 400 (b)');
  throws(() => updatePurchaseOrderSvc(db, 9999, { supplier_id: sup, date: '2026-06-12', items: [{ product_id: p, quantity: 1, unit_cost: 1 }] }),
    404, 'editar inexistente → 404');
  eq(movCount(db), 0, 'editar/enviar/anular: 0 stock_movements (f)');
  db.close();
}

// ── 4. (c) Anular: motivo obligatorio y solo enviada ─────────────────────────
console.log('4. Anular');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  const id = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 1, unit_cost: 2 }] });
  throws(() => anularPurchaseOrderSvc(db, id, 'error'), 400, 'anular un BORRADOR → 400 (c)');
  sendPurchaseOrderSvc(db, id);
  throws(() => anularPurchaseOrderSvc(db, id, ''), 400, 'sin motivo → 400 (c)');
  throws(() => anularPurchaseOrderSvc(db, id, 'ab'), 400, 'motivo de 2 caracteres → 400 (c)');
  const r = anularPurchaseOrderSvc(db, id, 'proveedor sin stock');
  eq(r.order_number, 'OC-0001', 'devuelve el número de la anulada');
  const o = orderRow(db, id);
  eq([o.status, o.anulada_motivo], ['anulada', 'proveedor sin stock'], 'queda anulada con su motivo');
  eq(o.order_number, 'OC-0001', 'conserva número y filas (nada se borra)');
  eq(itemsOf(db, id).length, 1, 'las líneas siguen ahí');
  throws(() => anularPurchaseOrderSvc(db, id, 'otra vez'), 400, 're-anular → 400');
  db.close();
}

// ── 5. (d) Anular y rehacer ──────────────────────────────────────────────────
console.log('5. Anular y rehacer');
{
  const db = freshDb();
  const sup = addSupplier(db), p21 = addProduct(db, 21), p10 = addProduct(db, 10);
  const id = createPurchaseOrderSvc(db, {
    supplier_id: sup, date: '2026-06-01', expected_date: '2026-06-15', notes: 'nota original',
    items: [{ product_id: p21, quantity: 4, unit_cost: 10 }, { product_id: p10, quantity: 2, unit_cost: 5 }],
  });
  sendPurchaseOrderSvc(db, id);
  throws(() => anularYRehacerSvc(db, id, ''), 400, 'sin motivo → 400 (transacción: no crea borrador)');
  eq(db.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c, 1, 'el fallo no dejó borrador huérfano');
  const r = anularYRehacerSvc(db, id, 'precio mal', { today: '2026-06-10' });
  eq(orderRow(db, id).status, 'anulada', 'la original queda anulada');
  const nuevo = orderRow(db, r.id);
  eq(nuevo.status, 'borrador', 'el nuevo es un borrador');
  eq(nuevo.order_number, null, 'el nuevo NO tiene número aún');
  eq(nuevo.replaces_order_id, id, 'replaces_order_id apunta a la anulada (d)');
  eq(nuevo.supplier_id, sup, 'mismo proveedor');
  eq(nuevo.date, '2026-06-10', 'fecha del borrador nuevo = hoy');
  const a = itemsOf(db, id), b = itemsOf(db, r.id);
  eq(b.map(x => [x.product_id, x.quantity, x.unit_cost, x.tax_rate]),
     a.map(x => [x.product_id, x.quantity, x.unit_cost, x.tax_rate]), 'líneas copiadas tal cual');
  const r2 = sendPurchaseOrderSvc(db, r.id);
  eq(r2.order_number, 'OC-0002', 'el sustituto gana su PROPIO número al enviarse');
  eq(movCount(db), 0, 'todo el ciclo anular-y-rehacer: 0 stock_movements (f)');
  db.close();
}

// ── 6. (e) Pie: IVA por tasa ─────────────────────────────────────────────────
console.log('6. Totales por tasa');
{
  // 4×10 al 21 (base 40, cuota 8.40) + 2×5 al 10 (base 10, cuota 1) + 3×2 exento (base 6, cuota 0)
  const t = purchaseOrderTotals([
    { quantity: 4, unit_cost: 10, tax_rate: 21 },
    { quantity: 2, unit_cost: 5, tax_rate: 10 },
    { quantity: 3, unit_cost: 2, tax_rate: 0 },
  ]);
  eq(t.subtotal, 56, 'base imponible 56');
  eq([t.taxByRate['21'].base, t.taxByRate['21'].amount], [40, 8.4], 'banda 21: base 40, cuota 8.40');
  eq([t.taxByRate['10'].base, t.taxByRate['10'].amount], [10, 1], 'banda 10: base 10, cuota 1.00');
  eq([t.taxByRate['0'].base, t.taxByRate['0'].amount], [6, 0], 'banda 0 (exento): base 6, cuota 0');
  eq(t.taxAmount, 9.4, 'IVA total 9.40');
  eq(t.total, 65.4, 'total documento 65.40 (sin IRPF)');
  eq(t.irpfAmount, 0, 'IRPF no aplica a la orden');
  // redondeo a céntimo por línea/grupo:
  const t2 = purchaseOrderTotals([{ quantity: 3, unit_cost: 0.333, tax_rate: 21 }]);
  eq(t2.subtotal, 1, 'base redondeada a céntimo (3×0.333 → 1.00)');
  eq(t2.taxByRate['21'].amount, 0.21, 'cuota redondeada a céntimo');
}

// ── 7. Email al proveedor (mock de Resend) ───────────────────────────────────
console.log('7. Email');
{
  const db = freshDb();
  const supSin = addSupplier(db, ''), supCon = addSupplier(db, 'prov@ejemplo.com');
  const p = addProduct(db, 21);
  const mk = (sup) => createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 2, unit_cost: 10 }] });

  // borrador → no se puede emailar
  const draft = mk(supCon);
  await throwsAsync(() => emailPurchaseOrderSvc(db, draft, { sendEmail: async () => ({ data: { id: 'x' } }) }),
    400, 'email de un borrador → 400');

  // enviada pero proveedor SIN email → 400 claro
  const sinMail = mk(supSin); sendPurchaseOrderSvc(db, sinMail);
  await throwsAsync(() => emailPurchaseOrderSvc(db, sinMail, { sendEmail: async () => ({ data: { id: 'x' } }) }),
    400, 'proveedor sin email → 400');

  // enviada + proveedor con email → envía con el documento en el cuerpo
  const okId = mk(supCon); sendPurchaseOrderSvc(db, okId);
  let sent = null;
  const r = await emailPurchaseOrderSvc(db, okId, { sendEmail: async (payload) => { sent = payload; return { data: { id: 'rsnd_1' } }; } });
  eq(r.sent, true, 'envío OK');
  eq(sent.to, 'prov@ejemplo.com', 'destinatario = email del proveedor');
  ok(sent.subject.includes(r.order_number), 'el asunto lleva el número OC');
  ok(sent.html.includes('Orden de compra') && sent.html.includes(r.order_number), 'el cuerpo HTML es el documento');
  ok(sent.text.includes('Total'), 'hay versión texto');

  // Resend devuelve {error} sin lanzar → se convierte en error 502
  await throwsAsync(() => emailPurchaseOrderSvc(db, okId, { sendEmail: async () => ({ error: { message: 'boom' } }) }),
    502, 'error de Resend chequeado → 502');

  eq(movCount(db), 0, 'email: 0 stock_movements (f)');
  db.close();
}

// ── 8. (f) Gate global: el flujo COMPLETO no toca stock ni coste ─────────────
console.log('8. Cero stock en todo el flujo');
{
  const db = freshDb();
  const sup = addSupplier(db, 'prov@ejemplo.com');
  const p = addProduct(db, 21, 5);
  const costBefore = db.prepare('SELECT average_cost FROM products WHERE id=?').get(p).average_cost;
  const id = createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 100, unit_cost: 3 }] });
  updatePurchaseOrderSvc(db, id, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 50, unit_cost: 4 }] });
  sendPurchaseOrderSvc(db, id);
  await emailPurchaseOrderSvc(db, id, { sendEmail: async () => ({ data: { id: 'x' } }) });
  const r = anularYRehacerSvc(db, id, 'cambio de condiciones');
  sendPurchaseOrderSvc(db, r.id);
  anularPurchaseOrderSvc(db, r.id, 'al final no');
  eq(movCount(db), 0, 'flujo completo (crear→editar→enviar→email→anular y rehacer→anular): 0 stock_movements');
  eq(stockOf(db, p), 5, 'products.stock intacto');
  eq(db.prepare('SELECT average_cost FROM products WHERE id=?').get(p).average_cost, costBefore, 'products.average_cost intacto');
  db.close();
}

// ── 9. Último coste conocido (autorrelleno de la línea) ──────────────────────
// El más reciente entre compra directa (no archivada) y orden ENVIADA; borradores
// y anuladas no cuentan. NULL si nunca → solo el producto nuevo exige teclearlo.
console.log('9. Último coste conocido');
{
  const db = freshDb();
  const sup = addSupplier(db), p = addProduct(db);
  eq(lastKnownCost(db, p), null, 'sin historial → null (producto nuevo: se teclea)');

  const buy = (date, cost, archived = 0) => {
    const pid = db.prepare("INSERT INTO purchases (supplier_id,date,status,total,archived) VALUES (?,?,'received',?,?)").run(sup, date, cost, archived).lastInsertRowid;
    db.prepare('INSERT INTO purchase_items (purchase_id,product_id,quantity,unit_cost) VALUES (?,?,1,?)').run(pid, p, cost);
    return pid;
  };
  const order = (date, cost) => createPurchaseOrderSvc(db, { supplier_id: sup, date, items: [{ product_id: p, quantity: 1, unit_cost: cost }] });

  buy('2026-06-01', 5);
  eq(lastKnownCost(db, p), 5, 'compra directa → 5.00');

  const draft = order('2026-06-05', 7);
  eq(lastKnownCost(db, p), 5, 'un BORRADOR posterior no compromete coste (sigue 5.00)');

  sendPurchaseOrderSvc(db, draft);
  eq(lastKnownCost(db, p), 7, 'orden ENVIADA más reciente → gana (7.00)');

  anularPurchaseOrderSvc(db, draft, 'precio incorrecto');
  eq(lastKnownCost(db, p), 5, 'al ANULARLA deja de contar → vuelve a la compra (5.00)');

  const o2 = order('2026-06-08', 6.5); sendPurchaseOrderSvc(db, o2);
  buy('2026-06-09', 5.9);
  eq(lastKnownCost(db, p), 5.9, 'entre orden enviada y compra directa gana la MÁS RECIENTE (5.90)');

  buy('2026-06-12', 99, 1);   // compra archivada (rota) → no cuenta
  eq(lastKnownCost(db, p), 5.9, 'una compra archivada no cuenta');
  db.close();
}

// ── 10. Foto congelada de emisor/proveedor al enviar ─────────────────────────
// El borrador no tiene foto (NULL); enviar copia company_config + proveedor en la
// misma transacción; cambiar después Ajustes o la ficha NO toca la orden enviada;
// un borrador posterior toma los datos nuevos al enviarse.
console.log('10. Foto congelada al enviar');
{
  const db = freshDb();
  db.prepare("UPDATE company_config SET company_name='Velas Ibra', fiscal_id='12345678Z', address='Calle Vieja 1', phone='600111222' WHERE id=1").run();
  const sup = db.prepare("INSERT INTO suppliers (name, fiscal_id, address, city, email) VALUES ('Prov Foto','B11111111','Av. Norte 5','Sevilla','p@x.com')").run().lastInsertRowid;
  const p = addProduct(db);
  const mk = () => createPurchaseOrderSvc(db, { supplier_id: sup, date: '2026-06-10', items: [{ product_id: p, quantity: 1, unit_cost: 2 }] });

  const id = mk();
  let o = orderRow(db, id);
  eq([o.company_name, o.supplier_name], [null, null], 'borrador: foto vacía (NULL)');

  sendPurchaseOrderSvc(db, id);
  o = orderRow(db, id);
  eq([o.company_name, o.company_fiscal_id, o.company_address, o.company_phone],
     ['Velas Ibra', '12345678Z', 'Calle Vieja 1', '600111222'], 'enviar congela los datos de empresa');
  eq([o.supplier_name, o.supplier_fiscal_id, o.supplier_address],
     ['Prov Foto', 'B11111111', 'Av. Norte 5, Sevilla'], 'enviar congela proveedor (dirección+ciudad unidas)');

  // Cambian Ajustes y la ficha del proveedor DESPUÉS del envío…
  db.prepare("UPDATE company_config SET company_name='Velas Ibra SL', address='Calle Nueva 99' WHERE id=1").run();
  db.prepare("UPDATE suppliers SET name='Prov Foto SA', address='Av. Sur 9', city='Cádiz' WHERE id=?").run(sup);
  o = orderRow(db, id);
  eq([o.company_name, o.company_address, o.supplier_name, o.supplier_address],
     ['Velas Ibra', 'Calle Vieja 1', 'Prov Foto', 'Av. Norte 5, Sevilla'],
     'la orden enviada conserva la foto del momento del envío');

  // …y anularla tampoco la toca.
  anularPurchaseOrderSvc(db, id, 'prueba de foto');
  o = orderRow(db, id);
  eq(o.company_address, 'Calle Vieja 1', 'anular no toca la foto');

  // Un borrador nuevo toma los datos NUEVOS al enviarse.
  const id2 = mk();
  sendPurchaseOrderSvc(db, id2);
  const o2 = orderRow(db, id2);
  eq([o2.company_name, o2.company_address, o2.supplier_name, o2.supplier_address],
     ['Velas Ibra SL', 'Calle Nueva 99', 'Prov Foto SA', 'Av. Sur 9, Cádiz'], 'el borrador nuevo congela los datos nuevos');
  eq(movCount(db), 0, 'la foto no añade movimientos de stock');
  db.close();
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' C1.a Orden de compra: ' + pass + ' OK, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
