// Test de LÓGICA — DÓNDE TE ESPERA · priorización (Escalera · paso 5 · PIEZA 5), sobre BD temporal.
//   node scripts/test-prioridad.mjs
//
// Demuestra la REGLA DE ORDEN:
//   1) por grupo: ALTA (deuda·pago·desvío) → MEDIA (caídas) → BAJA (dormido);
//   2) dentro del grupo, por importe (€) de mayor a menor; sin € (dormido), por urgencia (días);
//   3) desempate estable.
// No inventa: reordena y etiqueta los avisos que ya produce la detección.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { fijarObjetivo } from '../modules/erp/plan-financiero.js';
import { detectar } from '../modules/erp/vigia.js';
import { narrar } from '../modules/erp/voz.js';
import { priorizar, grupoDe, GRUPOS } from '../modules/erp/prioridad.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const P = () => true;
const HOY = '2026-07-15';
const dbs = [];

function nuevaBD() {
  const f = join(tmpdir(), 'prio-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f); dbs.push([db, f]); runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO company_config (id, company_name, fiscal_id, country, invoice_series, rectificative_series, tax_name, currency_symbol) VALUES (1,'Test SL','B00000000','ES','F','R','IVA','€')").run();
  try { db.prepare("INSERT INTO warehouses (name, is_default) VALUES ('Principal',1)").run(); } catch {}
  return db;
}
const nuevoCliente = (db, name) => { db.prepare("INSERT INTO clients (name, fiscal_id, client_type, payment_term_days, active) VALUES (?, '11111111H','empresa',0,1)").run(name); return db.prepare('SELECT id FROM clients ORDER BY id DESC LIMIT 1').get().id; };
const nuevoProveedor = (db, name) => { db.prepare("INSERT INTO suppliers (name, fiscal_id, payment_term_days) VALUES (?, 'A99999999',0)").run(name); return db.prepare('SELECT id FROM suppliers ORDER BY id DESC LIMIT 1').get().id; };
function venta(db, clientId, fecha, base, cost = null) {
  const r = createInvoice(db, { client_id: clientId, issue_date: fecha, lines: [{ description: 'Línea', quantity: 1, unit_price: base, tax_rate: 21 }] });
  if (cost != null) db.prepare('UPDATE invoice_items SET unit_cost=? WHERE invoice_id=?').run(cost, r.id);
  return r.id;
}
const setDue = (db, invId, due) => db.prepare('UPDATE invoices SET due_date=? WHERE id=?').run(due, invId);
function facturaProveedor(db, supId, { code, invDate, dueDate, base, tax }) {
  const sn = db.prepare('SELECT name FROM suppliers WHERE id=?').get(supId).name;
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id) VALUES (?,?,?,?,?,?,?,?, 'vigente',?,'A99999999')")
    .run(supId, code, code, invDate, dueDate, base, tax, r2(base + tax), sn);
  return db.prepare('SELECT id FROM supplier_invoices WHERE internal_code=?').get(code).id;
}

try {
  console.log('\n=== Grupo por detector ===\n');
  ok(grupoDe('deuda_vencida') === 'alta' && grupoDe('pago_vence_pronto') === 'alta' && grupoDe('desvio_plan') === 'alta', 'ALTA = deuda · pago · desvío');
  ok(grupoDe('caida_facturacion') === 'media' && grupoDe('caida_margen') === 'media', 'MEDIA = caída de facturación · de margen');
  ok(grupoDe('cliente_dormido') === 'baja', 'BAJA = cliente dormido');

  const db = nuevaBD();
  const cVentas = nuevoCliente(db, 'Ventas SA');
  const cDeudaGrande = nuevoCliente(db, 'Moroso Grande SL');
  const cDeudaChica  = nuevoCliente(db, 'Moroso Chico SL');
  const cDorm   = nuevoCliente(db, 'Dormido SL');
  const supA    = nuevoProveedor(db, 'Prove A');
  // Ventas globales con caída (para caída fact/margen) y desvío del plan.
  venta(db, cVentas, '2026-05-10', 1000, 400);
  venta(db, cVentas, '2026-06-10', 600, 480);
  // DOS deudas de distinto importe (para probar el orden dentro del grupo ALTA).
  const g = venta(db, cDeudaGrande, '2026-06-12', 5000, null); setDue(db, g, '2026-06-20');
  const chi = venta(db, cDeudaChica, '2026-06-12', 80, null);  setDue(db, chi, '2026-06-20');
  // Dormido (baja).
  venta(db, cDorm, '2026-01-05', 50); venta(db, cDorm, '2026-02-05', 50); venta(db, cDorm, '2026-03-05', 50);
  // Pago próximo (alta) y plan incumplido (alta).
  facturaProveedor(db, supA, { code: 'SAP-1', invDate: '2026-07-01', dueDate: '2026-07-18', base: 200, tax: 42 });
  fijarObjetivo(db, { tipo: 'facturacion', periodo: 'mes', clave: '2026-06', alcance: 'global', valor: 100000 });

  const avisos = priorizar(narrar(detectar(db, { hasPerm: P, hoy: HOY }), '€').avisos);

  console.log('\n=== Orden global: grupos no decrecientes (alta → media → baja) ===\n');
  const ranks = avisos.map(a => a.prioridad.rank);
  ok(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), 'los rangos de grupo no decrecen a lo largo de la lista');
  ok(avisos[0].prioridad.grupo === 'alta', 'el primero de la lista es de prioridad ALTA');
  ok(avisos[avisos.length - 1].prioridad.grupo === 'baja', 'el último es el cliente dormido (BAJA)');

  console.log('\n=== Dentro de cada grupo: por importe (€) de mayor a menor ===\n');
  for (const key of ['alta', 'media', 'baja']) {
    const delGrupo = avisos.filter(a => a.prioridad.grupo === key);
    const conEuro = delGrupo.filter(a => a.moneda).map(a => Number(a.cifra));
    const ordenado = conEuro.every((v, i) => i === 0 || conEuro[i - 1] >= v);
    ok(ordenado, 'grupo ' + key + ': los importes en € van de mayor a menor (' + conEuro.join(' ≥ ') + ')');
  }

  console.log('\n=== La deuda GRANDE va por delante de la chica (mismo grupo, más €) ===\n');
  // El importe del aviso es el PENDIENTE con IVA (base 5000 → 6050; base 80 → 96,8): la grande va antes.
  const iGrande = avisos.findIndex(a => a.detector === 'deuda_vencida' && /Moroso Grande/.test(a.encabezado || ''));
  const iChica  = avisos.findIndex(a => a.detector === 'deuda_vencida' && /Moroso Chico/.test(a.encabezado || ''));
  ok(iGrande >= 0 && iChica >= 0 && iGrande < iChica,
     'la deuda grande (€' + r2(avisos[iGrande].cifra) + ') aparece antes que la chica (€' + r2(avisos[iChica].cifra) + ')');

  console.log('\n=== No inventa: mismos avisos, solo reordenados y etiquetados ===\n');
  const sinPrio = narrar(detectar(db, { hasPerm: P, hoy: HOY }), '€').avisos;
  ok(avisos.length === sinPrio.length, 'priorizar no añade ni quita avisos (' + avisos.length + ')');
  ok(avisos.every(a => a.prioridad && GRUPOS[a.prioridad.grupo]), 'cada aviso lleva su prioridad con grupo válido');
  ok(avisos.every(a => sinPrio.some(s => s.detector === a.detector && JSON.stringify(s.ref) === JSON.stringify(a.ref) && s.cifra === a.cifra)),
     'ningún aviso cambia de cifra ni de identidad al priorizar');

  console.log('\n=== ORDEN RESULTANTE ===');
  for (const a of avisos) console.log('  [' + a.prioridad.etiqueta.padEnd(5) + '] ' + a.detector.padEnd(18) + (a.moneda ? '€' + a.cifra : a.cifra + ' días') + '  ' + (a.encabezado || '').slice(0, 44));

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
