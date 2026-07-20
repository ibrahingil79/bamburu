// Test de LÓGICA — EL VIGÍA (Escalera · paso 5 · PIEZA 1), sobre BD temporal.
//   node scripts/test-vigia.mjs
//
// Demuestra los cinco criterios del encargo, cada uno con datos reales sembrados:
//   1. CUADRE   — la cifra de cada hallazgo == la del motor de su área (openDebts, cruzar,
//                 clientesDormidos, planFinanciero, openPayables). Misma cifra, mismo motor.
//   2. NO INVENTA — un tenant "en blanco" (sin ningún problema) NO produce ni un hallazgo.
//   3. DETECTA  — un tenant "con problemas" dispara los seis detectores.
//   4. PERMISOS — un usuario sin el permiso de un área no recibe sus hallazgos (van a `sinPermiso`)
//                 y forzar ese detector devuelve 403.
//   5. Estructura del barrido (umbrales, contadores) coherente.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { openDebts } from '../modules/erp/cobros.js';
import { openPayables } from '../modules/erp/pagos.js';
import { clientesDormidos } from '../modules/erp/ventas-metrics.js';
import { cruzar as cruzarArea } from '../modules/erp/constructor-analitica.js';
import { planFinanciero, fijarObjetivo } from '../modules/erp/plan-financiero.js';
import { detectar, DETECTORES } from '../modules/erp/vigia.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);
const HOY = '2026-07-15';
const dbs = [];

function nuevaBD() {
  const f = join(tmpdir(), 'vigia-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f);
  dbs.push([db, f]);
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name, currency_symbol) VALUES (1,'Test SL','B00000000','ES','F','R','IVA','€')").run();
  try { db.prepare("INSERT INTO warehouses (name, is_default) VALUES ('Principal',1)").run(); } catch {}
  return db;
}
const nuevoCliente = (db, name) => { db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days, active) VALUES (?, '11111111H','empresa',0,1)").run(name); return db.prepare('SELECT id FROM clients ORDER BY id DESC LIMIT 1').get().id; };
const nuevoProveedor = (db, name) => { db.prepare("INSERT INTO suppliers (name, fiscal_id, payment_term_days) VALUES (?, 'A99999999',0)").run(name); return db.prepare('SELECT id FROM suppliers ORDER BY id DESC LIMIT 1').get().id; };
// Una venta: línea libre qty 1 @ base. `cost` opcional congela el unit_cost (para el margen).
function venta(db, clientId, fecha, base, cost = null) {
  const r = createInvoice(db, { client_id: clientId, issue_date: fecha, lines: [{ description: 'Línea', quantity: 1, unit_price: base, tax_rate: 21 }] });
  if (cost != null) db.prepare('UPDATE invoice_items SET unit_cost=? WHERE invoice_id=?').run(cost, r.id);
  return r.id;
}
const setDue = (db, invId, due) => db.prepare('UPDATE invoices SET due_date=? WHERE id=?').run(due, invId);
function facturaProveedor(db, supId, { code, invDate, dueDate, base, tax }) {
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id) VALUES (?,?,?,?,?,?,?,?, 'vigente','Proveedor','A99999999')")
    .run(supId, code, code, invDate, dueDate, base, tax, r2(base + tax));
  return db.prepare('SELECT id FROM supplier_invoices WHERE internal_code=?').get(code).id;
}
const halla = (res, det, pred = () => true) => res.hallazgos.find(h => h.detector === det && pred(h));

try {
  // ══════════════════════════════════════════════════════════════════════════
  // ESCENARIO A — CON PROBLEMAS: los seis detectores tienen que dispararse.
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n=== ESCENARIO A · siembra con problemas ===\n');
  const A = nuevaBD();
  const cVentas = nuevoCliente(A, 'Ventas SA');
  const cDeuda  = nuevoCliente(A, 'Moroso SL');
  const cDorm   = nuevoCliente(A, 'Dormido SL');
  const cActivo = nuevoCliente(A, 'Activo SL');
  const supA    = nuevoProveedor(A, 'Prove A');

  // Ventas: mayo 1000 (coste 400 → margen 600), junio 600 (coste 480 → margen 120). Caída clara.
  venta(A, cVentas, '2026-05-10', 1000, 400);
  venta(A, cVentas, '2026-06-10', 600, 480);
  // Deuda VENCIDA: factura de junio (base 100, sin coste) con vencimiento pasado y sin cobrar.
  const invDeuda = venta(A, cDeuda, '2026-06-12', 100, null); setDue(A, invDeuda, '2026-06-20');
  // Dormido: compras mensuales ene/feb/mar y silencio → dormido a 15-jul.
  venta(A, cDorm, '2026-01-05', 50); venta(A, cDorm, '2026-02-05', 50); venta(A, cDorm, '2026-03-05', 50);
  // Activo (NO dormido, NO moroso): dos compras de julio, con vencimiento futuro (pendientes, no vencidas).
  const a1 = venta(A, cActivo, '2026-07-02', 50); const a2 = venta(A, cActivo, '2026-07-09', 50);
  setDue(A, a1, '2026-12-31'); setDue(A, a2, '2026-12-31');
  // Pago a proveedor que VENCE PRONTO (en 3 días) y otro lejano (blanco dentro de A).
  const invPago = facturaProveedor(A, supA, { code: 'SAP-1', invDate: '2026-07-01', dueDate: '2026-07-18', base: 200, tax: 42 });
  facturaProveedor(A, supA, { code: 'SAP-LEJOS', invDate: '2026-07-01', dueDate: '2026-12-01', base: 300, tax: 63 });
  // Plan: una meta de junio muy por encima (desvío) y una de mayo cumplida (blanco dentro de A).
  fijarObjetivo(A, { tipo: 'facturacion', periodo: 'mes', clave: '2026-06', alcance: 'global', valor: 100000 });
  fijarObjetivo(A, { tipo: 'facturacion', periodo: 'mes', clave: '2026-05', alcance: 'global', valor: 1 });

  const rA = detectar(A, { hasPerm: () => true, hoy: HOY });

  console.log('\n--- DETECTA: los seis detectores disparan ---\n');
  const h1 = halla(rA, 'deuda_vencida', h => h.ref.invoice_id === invDeuda);
  const h2 = halla(rA, 'cliente_dormido', h => h.ref.client_id === cDorm);
  const h3 = halla(rA, 'caida_facturacion');
  const h4 = halla(rA, 'caida_margen');
  const h5 = halla(rA, 'desvio_plan', h => h.ref.clave === '2026-06');
  const h6 = halla(rA, 'pago_vence_pronto', h => h.ref.supplier_invoice_id === invPago);
  ok(h1, 'Deuda vencida: detectada la factura morosa de junio');
  ok(h2, 'Cliente dormido: detectado el cliente que dejó de comprar');
  ok(h3, 'Caída de facturación: detectada (junio < mayo)');
  ok(h4, 'Caída de margen: detectada (junio < mayo)');
  ok(h5, 'Desvío del plan: detectada la meta de junio incumplida');
  ok(h6, 'Pago a proveedor: detectada la factura que vence en 3 días');

  console.log('\n--- CUADRE: cada cifra == la del motor de su área ---\n');
  const od = openDebts(A, HOY).rows.find(r => r.invoice_id === invDeuda);
  ok(h1 && eq(h1.cifra, od.pendiente), 'Deuda vencida: cifra == openDebts.pendiente (' + od.pendiente + ')');
  const cd = clientesDormidos(A, HOY).find(d => d.client_id === cDorm);
  ok(h2 && h2.cifra === cd.dias_sin_comprar, 'Cliente dormido: cifra == clientesDormidos.dias_sin_comprar (' + cd.dias_sin_comprar + ')');
  const facJun = cruzarArea(A, { area: 'ventas', dimension: 'fecha', medidas: ['base'], periodo: 'mes', limit: 100000, hasPerm: () => true }).filas.find(f => f.clave === '2026-06');
  ok(h3 && h3.fecha === '2026-06' && eq(h3.cifra, facJun.base), 'Caída facturación: cifra == cruzar(ventas·base·junio) (' + facJun.base + ')');
  const margJun = cruzarArea(A, { area: 'ventas', dimension: 'fecha', medidas: ['beneficio'], periodo: 'mes', limit: 100000, hasPerm: () => true }).filas.find(f => f.clave === '2026-06');
  ok(h4 && eq(h4.cifra, margJun.beneficio), 'Caída margen: cifra == cruzar(ventas·beneficio·junio) (' + margJun.beneficio + ')');
  const pf = planFinanciero(A, {}).find(f => f.clave === '2026-06' && f.tipo === 'facturacion');
  ok(h5 && eq(h5.cifra, pf.real), 'Desvío plan: cifra == planFinanciero.real (' + pf.real + ')');
  const op = openPayables(A, HOY).rows.find(r => r.supplier_invoice_id === invPago);
  ok(h6 && eq(h6.cifra, op.pendiente), 'Pago proveedor: cifra == openPayables.pendiente (' + op.pendiente + ')');

  console.log('\n--- NO INVENTA (dentro de A): lo que no cumple umbral NO sale ---\n');
  ok(!halla(rA, 'deuda_vencida', h => h.ref.client_id === cActivo), 'Cliente al día (vto. futuro) NO genera deuda vencida');
  ok(!halla(rA, 'cliente_dormido', h => h.ref.client_id === cActivo), 'Cliente que compró hace días NO se marca como dormido');
  ok(!halla(rA, 'desvio_plan', h => h.ref.clave === '2026-05'), 'Meta cumplida (mayo) NO genera desvío');
  ok(!halla(rA, 'pago_vence_pronto', h => h.ref.internal_code === 'SAP-LEJOS'), 'Pago con vto. lejano (dic) NO se marca como que vence pronto');

  // ══════════════════════════════════════════════════════════════════════════
  // ESCENARIO B — EN BLANCO: ningún problema → CERO hallazgos (uno por detector).
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n=== ESCENARIO B · tenant en blanco (sin problemas) ===\n');
  const B = nuevaBD();
  const cB = nuevoCliente(B, 'Cliente B');
  const supB = nuevoProveedor(B, 'Prove B');
  // Ventas al alza (mayo 500/mg 300, junio 550/mg 340), sin caída. Compra reciente → no dormido.
  const b1 = venta(B, cB, '2026-05-10', 500, 200);
  const b2 = venta(B, cB, '2026-06-10', 550, 210);
  const b3 = venta(B, cB, '2026-07-05', 300, 100);
  for (const id of [b1, b2, b3]) setDue(B, id, '2026-12-31');   // vto. futuro → nada vencido
  facturaProveedor(B, supB, { code: 'SBP-1', invDate: '2026-07-01', dueDate: '2026-12-01', base: 400, tax: 84 });   // vence en diciembre
  // Sin metas fijadas → plan vacío → sin desvío.
  const rB = detectar(B, { hasPerm: () => true, hoy: HOY });
  ok(rB.total === 0, 'Tenant en blanco: 0 hallazgos en total (' + rB.total + ')');
  for (const det of DETECTORES) ok((rB.porDetector[det.key] || 0) === 0, 'En blanco · ' + det.key + ': 0 hallazgos');

  // ══════════════════════════════════════════════════════════════════════════
  // PERMISOS — sobre el escenario A (que tiene de todo).
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n=== PERMISOS ===\n');
  const denyOne = key => (p) => p !== key;
  const onlyThese = set => (p) => set.has(p);

  // (a) Sin cobros.read → deuda vencida no aparece y va a sinPermiso.
  const sinCobros = detectar(A, { hasPerm: denyOne('cobros.read'), hoy: HOY });
  ok(!halla(sinCobros, 'deuda_vencida'), 'Sin cobros.read: NO hay hallazgos de deuda vencida');
  ok(sinCobros.sinPermiso.some(s => s.key === 'deuda_vencida'), 'Sin cobros.read: deuda vencida figura en sinPermiso (se dice qué falta)');

  // (b) Forzar el detector sin permiso → 403.
  let e403 = null;
  try { detectar(A, { hasPerm: denyOne('cobros.read'), hoy: HOY, soloDetector: 'deuda_vencida' }); }
  catch (e) { e403 = e; }
  ok(e403 && e403.status === 403, 'Forzar deuda vencida sin cobros.read → 403');

  // (c) Solo invoices.read (+ analytics.read para la página): solo corren ventas/margen/plan.
  const soloVentas = detectar(A, { hasPerm: onlyThese(new Set(['invoices.read', 'analytics.read'])), hoy: HOY });
  ok(halla(soloVentas, 'caida_facturacion') && halla(soloVentas, 'caida_margen') && halla(soloVentas, 'desvio_plan'),
     'Con invoices.read: SÍ corren caída de facturación, de margen y desvío del plan');
  ok(!halla(soloVentas, 'deuda_vencida') && !halla(soloVentas, 'cliente_dormido') && !halla(soloVentas, 'pago_vence_pronto'),
     'Con solo invoices.read: NO corren deuda (cobros), dormido (clientes) ni pago (compras)');
  const faltan = new Set(soloVentas.sinPermiso.map(s => s.key));
  ok(faltan.has('deuda_vencida') && faltan.has('cliente_dormido') && faltan.has('pago_vence_pronto'),
     'Con solo invoices.read: cobros/clientes/compras figuran en sinPermiso');

  // (d) La caída pasa por `cruzar`, que revalida el permiso del área por dentro: forzarla sin
  //     invoices.read también da 403 (la puerta de atrás está cerrada).
  let e403b = null;
  try { detectar(A, { hasPerm: denyOne('invoices.read'), hoy: HOY, soloDetector: 'caida_facturacion' }); }
  catch (e) { e403b = e; }
  ok(e403b && e403b.status === 403, 'Forzar caída de facturación sin invoices.read → 403');

  console.log('\n=== Estructura del barrido ===\n');
  ok(Array.isArray(rA.hallazgos) && typeof rA.total === 'number', 'detectar() devuelve { hallazgos, total, ... }');
  ok(rA.umbrales && rA.umbrales.CAIDA_FACTURACION_PCT === 20 && rA.umbrales.PAGO_VENCE_DIAS === 7, 'Umbrales fijos expuestos en la salida');
  ok(rA.hoy === HOY, 'El barrido respeta el día pedido (hoy)');

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
