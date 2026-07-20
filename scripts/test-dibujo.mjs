// Test de LÓGICA — EL DIBUJO (Escalera · paso 5 · PIEZA 3), sobre BD temporal.
//   node scripts/test-dibujo.mjs
//
// El dibujo NO pinta ni calcula: por cada aviso compone una RECETA para el motor del constructor
// (`cruzar`). Aquí se demuestran los criterios propios de la pieza:
//   1. CUADRA CON EL CONSTRUCTOR — la receta pasada a `cruzar` y el MISMO cruce hecho "a mano" dan
//      filas IDÉNTICAS; y el punto relevante del gráfico coincide con la cifra del aviso / del motor
//      de su área (caída = cifra del vigía; pago = Σ pendiente del proveedor en Pagos).
//   2. MISMO MOTOR — la receta usa un área/dimensión/medida REALES del constructor; y el código del
//      dibujo NO instancia ningún motor de gráficos (no hay `new Chart(` ni SVG en vigia.js/dibujo.js).
//   3. EXPRESABLE / HUECOS — cada tipo trae receta (o, si no, su hueco explicado); los huecos
//      documentados (deuda/plan/pago/dormido) están anotados.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { unlinkSync, readFileSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { fijarObjetivo } from '../modules/erp/plan-financiero.js';
import { detectar } from '../modules/erp/vigia.js';
import { narrar } from '../modules/erp/voz.js';
import { graficoDe, RECETAS } from '../modules/erp/dibujo.js';
import { cruzar, AREAS } from '../modules/erp/constructor-analitica.js';
import { openPayables } from '../modules/erp/pagos.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a, b) => Math.round(r2(a) * 100) === Math.round(r2(b) * 100);
const P = () => true;
const HOY = '2026-07-15';
const dbs = [];
const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

function nuevaBD() {
  const f = join(tmpdir(), 'dibujo-' + randomBytes(4).toString('hex') + '.db');
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
  // supplier_name = el nombre REAL del proveedor (como en datos vivos): así la dimensión `proveedor`
  // del constructor agrupa por el mismo nombre que resuelve el aviso.
  const sn = db.prepare('SELECT name FROM suppliers WHERE id=?').get(supId).name;
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id) VALUES (?,?,?,?,?,?,?,?, 'vigente',?,'A99999999')")
    .run(supId, code, code, invDate, dueDate, base, tax, r2(base + tax), sn);
  return db.prepare('SELECT id FROM supplier_invoices WHERE internal_code=?').get(code).id;
}

try {
  const db = nuevaBD();
  const cVentas = nuevoCliente(db, 'Ventas SA');
  const cDeuda  = nuevoCliente(db, 'Moroso SL');
  const cDorm   = nuevoCliente(db, 'Dormido SL');
  const cActivo = nuevoCliente(db, 'Activo SL');
  const supA    = nuevoProveedor(db, 'Prove A');
  venta(db, cVentas, '2026-05-10', 1000, 400);
  venta(db, cVentas, '2026-06-10', 600, 480);
  const invDeuda = venta(db, cDeuda, '2026-06-12', 100, null); setDue(db, invDeuda, '2026-06-20');
  venta(db, cDorm, '2026-01-05', 50); venta(db, cDorm, '2026-02-05', 50); venta(db, cDorm, '2026-03-05', 50);
  const a1 = venta(db, cActivo, '2026-07-02', 50); const a2 = venta(db, cActivo, '2026-07-09', 50);
  setDue(db, a1, '2026-12-31'); setDue(db, a2, '2026-12-31');
  facturaProveedor(db, supA, { code: 'SAP-1', invDate: '2026-07-01', dueDate: '2026-07-18', base: 200, tax: 42 });
  fijarObjetivo(db, { tipo: 'facturacion', periodo: 'mes', clave: '2026-06', alcance: 'global', valor: 100000 });

  const resolvers = {
    nombreCliente: id => db.prepare('SELECT name FROM clients WHERE id=?').get(id)?.name || null,
    nombreProveedor: id => db.prepare('SELECT name FROM suppliers WHERE id=?').get(id)?.name || null,
  };
  const res = detectar(db, { hasPerm: P, hoy: HOY });
  const avisos = narrar(res, '€').avisos.map(a => ({ ...a, grafico: graficoDe(a, resolvers) }));
  const primero = k => avisos.find(a => a.detector === k);
  const seis = ['deuda_vencida','cliente_dormido','caida_facturacion','caida_margen','desvio_plan','pago_vence_pronto'];

  console.log('\n=== 0. Cada tipo trae receta (o su hueco explicado) ===\n');
  for (const k of seis) {
    const g = primero(k)?.grafico;
    ok(g && (g.receta || g.gap), k + ': trae gráfico (receta) o hueco explicado');
    if (g && g.receta) ok(!!AREAS[g.receta.area] && !!AREAS[g.receta.area].dimensiones[g.receta.dimension] && !!AREAS[g.receta.area].medidas[g.medida],
      k + ': la receta usa área/dimensión/medida REALES del constructor (' + g.receta.area + '/' + g.receta.dimension + '/' + g.medida + ')');
  }

  console.log('\n=== 1. CUADRA CON EL CONSTRUCTOR (receta == cruce a mano; punto == cifra) ===\n');
  const cruzarReceta = r => cruzar(db, { ...r, hasPerm: P });
  const manoIgual = (r) => JSON.stringify(cruzarReceta(r).filas) === JSON.stringify(cruzar(db, { area: r.area, dimension: r.dimension, medidas: r.medidas, periodo: r.periodo, filtros: r.filtros, hasPerm: P }).filas);

  // caída facturación: la fila del mes del aviso == la cifra del vigía (que salió de esta MISMA cruzar).
  { const a = primero('caida_facturacion'), r = a.grafico.receta;
    const fila = cruzarReceta(r).filas.find(f => f.clave === a.fecha);
    ok(fila && eq(fila.base, a.cifra), 'caída facturación: gráfico[' + a.fecha + '].base (' + (fila && fila.base) + ') == cifra del aviso (' + a.cifra + ')');
    ok(manoIgual(r), 'caída facturación: la receta y el mismo cruce a mano dan filas idénticas'); }

  // caída margen: la fila del mes == la cifra del vigía (beneficio).
  { const a = primero('caida_margen'), r = a.grafico.receta;
    const fila = cruzarReceta(r).filas.find(f => f.clave === a.fecha);
    ok(fila && eq(fila.beneficio, a.cifra), 'caída margen: gráfico[' + a.fecha + '].beneficio (' + (fila && fila.beneficio) + ') == cifra (' + a.cifra + ')');
    ok(manoIgual(r), 'caída margen: receta == cruce a mano'); }

  // desvío del plan: el gráfico (serie real) en la clave del plan == la cifra real del aviso.
  { const a = primero('desvio_plan'), r = a.grafico.receta;
    const fila = cruzarReceta(r).filas.find(f => f.clave === a.fecha);
    ok(fila && eq(fila[a.grafico.medida], a.cifra), 'desvío plan: gráfico[' + a.fecha + '].' + a.grafico.medida + ' (' + (fila && fila[a.grafico.medida]) + ') == real del aviso (' + a.cifra + ')');
    ok(manoIgual(r), 'desvío plan: receta == cruce a mano');
    ok(a.grafico.gap && /objetivo/i.test(a.grafico.gap), 'desvío plan: hueco anotado (sin línea de objetivo)'); }

  // pago próximo: la barra del proveedor del aviso == Σ pendiente de ese proveedor en Pagos.
  { const a = primero('pago_vence_pronto'), r = a.grafico.receta;
    const supName = db.prepare('SELECT name FROM suppliers WHERE id=?').get(a.ref.supplier_id).name;
    const barra = cruzarReceta(r).filas.find(f => f.clave === supName);
    const sumOP = r2(openPayables(db, res.hoy).rows.filter(x => x.supplier_id === a.ref.supplier_id && x.pendiente > 0.0049).reduce((s, x) => s + x.pendiente, 0));
    ok(barra && eq(barra.pendiente, sumOP), 'pago: gráfico[' + supName + '].pendiente (' + (barra && barra.pendiente) + ') == Σ openPayables del proveedor (' + sumOP + ')');
    ok(barra && eq(barra.pendiente, a.cifra), 'pago: y coincide con la cifra del aviso (' + a.cifra + ', 1 factura del proveedor)');
    ok(manoIgual(r), 'pago: receta == cruce a mano');
    ok(a.grafico.gap && /vencimiento/i.test(a.grafico.gap), 'pago: hueco anotado (por proveedor, no por vencimiento)'); }

  // deuda / dormido: el gráfico filtra por ESE cliente y cuadra con el ranking por cliente del constructor.
  for (const k of ['deuda_vencida', 'cliente_dormido']) {
    const a = primero(k), r = a.grafico.receta;
    const cliName = db.prepare('SELECT name FROM clients WHERE id=?').get(a.ref.client_id).name;
    ok(r && r.filtros && r.filtros.cliente && r.filtros.cliente[0] === cliName, k + ': la receta filtra por el cliente correcto (' + cliName + ')');
    const filtrado = cruzarReceta(r).filas;
    const totalFiltrado = r2(filtrado.reduce((s, f) => s + (f.base || 0), 0));
    const ranking = cruzar(db, { area: 'ventas', dimension: 'cliente', medidas: ['base'], hasPerm: P }).filas.find(f => f.clave === cliName);
    ok(ranking && eq(ranking.base, totalFiltrado), k + ': Σ del gráfico de ese cliente (' + totalFiltrado + ') == su total en el ranking del constructor (' + (ranking && ranking.base) + ')');
    ok(manoIgual(r), k + ': receta == cruce a mano');
  }

  console.log('\n=== 2. MISMO MOTOR — el dibujo NO instancia ningún motor de gráficos ===\n');
  const vigiaSrc = readFileSync(join(APP, 'modules/erp/routes/vigia.js'), 'utf8');
  const dibujoSrc = readFileSync(join(APP, 'modules/erp/dibujo.js'), 'utf8');
  ok(!/new\s+Chart\s*\(/.test(vigiaSrc), 'vigia.js NO hace `new Chart(` (delega en el render compartido del constructor)');
  ok(!/new\s+Chart\s*\(|<svg|createElementNS/.test(dibujoSrc), 'dibujo.js NO tiene Chart/SVG: solo compone la receta');
  ok(/grafico-constructor\.js/.test(vigiaSrc) && /chart\.umd\.min\.js/.test(vigiaSrc), 'vigia.js reutiliza el MISMO render (chart.umd + grafico-constructor.js)');

  console.log('\n=== EJEMPLOS (receta por tipo) ===');
  for (const k of seis) {
    const g = primero(k)?.grafico; if (!g) continue;
    console.log('  · ' + k.padEnd(20) + (g.receta ? JSON.stringify(g.receta) : '(sin receta) ') + (g.gap ? '  ⚠ ' + g.gap.slice(0, 60) : ''));
  }

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
