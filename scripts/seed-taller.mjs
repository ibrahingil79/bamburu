#!/usr/bin/env node
//
// SEED — Negocio de prueba en el tenant DESARROLLO: TALLER MECÁNICO (recambios de coche + servicios de
// revisión), ~2 años de operación. Siembra por los SERVICIOS VALIDADOS (createInvoice, createSupplierInvoiceSvc,
// createClientSvc, createProductSvc…) para que cadena Verifactu, libro diario, WAC y P&G queden coherentes.
//
// ⚠️ DESTRUYE HISTÓRICO. Para que Ventas y P&G arranquen de cero, BORRA todos los asientos del libro
// diario previos y retira (archiva/anula) clientes, productos, proveedores, proyectos y facturas vivos.
// Es una EXCEPCIÓN a la regla permanente del proyecto —nunca destruir datos de un tenant— admisible
// SOLO sobre el tenant de desarrollo, que no tiene clientes reales. Contra cualquier otro tenant el
// script se NIEGA a arrancar. Si alguna vez hiciera falta sembrar otro sitio, se pregunta antes: la
// guarda no se toca.
//
// "Empezar limpio": archiva clientes/productos/compras genéricos y ANULA las facturas emitidas actuales
// (salen de Ventas; permanecen en la cadena por ley). Nota: el motor numera por AÑO ACTUAL (F2026-####)
// aunque la fecha sea de 2024/2025 — las fechas sí son reales de 2 años (analíticas/vencimientos correctos).
//
//   node scripts/seed-taller.mjs            # EN SECO: dice qué destruiría, no escribe nada
//   node scripts/seed-taller.mjs --hazlo    # siembra de verdad
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { tenantDb } from './lib/gate-env.mjs';
import { createInvoice, anularInvoice } from '../modules/erp/routes/invoices.js';
import { createClientSvc } from '../modules/erp/routes/clients.js';
import { createProductSvc } from '../modules/erp/routes/products.js';
import { createSupplierInvoiceSvc, anularSupplierInvoiceSvc } from '../modules/erp/routes/supplier-invoices.js';
import { createProyectoSvc } from '../modules/erp/routes/proyectos.js';
import { createEntry } from '../modules/erp/routes/tiempo.js';
import { postInvoice, postInvoicePayment, postSupplierInvoice } from '../modules/erp/contabilidad.js';
import { cuentaPyG } from '../modules/erp/contabilidad-pyg.js';
import { cruzar } from '../modules/erp/constructor-analitica.js';
import bcrypt from 'bcrypt';

// ── GUARDA — solo el tenant de desarrollo ────────────────────────────────────
// La ruta NO se escribe a mano (tenantDb la resuelve desde el repo y aborta si no existe), y el
// slug se comprueba ANTES de abrir nada: este script borra el libro diario entero, así que apuntarlo
// a un tenant con clientes reales no puede ser un descuido de una línea.
const TENANT = process.env.SEED_TENANT || 'desarrollo-bamburu';
if (!/^desarrollo(-|$)/.test(TENANT)) {
  console.error('\n✗ ABORTADO — este script BORRA el libro diario y solo puede correr sobre el tenant');
  console.error('  de desarrollo. Se ha pedido: "' + TENANT + '".');
  process.exit(2);
}
const HAZLO = process.argv.includes('--hazlo');

const db = new Database(tenantDb(TENANT));
db.pragma('busy_timeout = 15000');
const r2 = n => Math.round(n * 100) / 100;
// PRNG determinista (LCG) para que cada corrida sea reproducible.
let _s = 20240521;
const rnd = () => (_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const pickN = (arr, n) => { const c = [...arr]; const out = []; for (let i = 0; i < n && c.length; i++) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };

const BASE = new Date('2026-07-21T12:00:00Z');
const MONTHS = 25;   // 0..24 meses atrás (≈2 años)
function dateStr(monthsAgo, day) { const d = new Date(BASE); d.setUTCMonth(d.getUTCMonth() - monthsAgo); return d.toISOString().slice(0, 8) + String(Math.min(Math.max(day, 1), 28)).padStart(2, '0'); }
const addDaysStr = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = BASE.toISOString().slice(0, 10);
const ventasBase = () => { const r = cruzar(db, { dimension: 'fecha', medidas: ['base'], hasPerm: () => true }); return r2(r.filas.reduce((a, f) => a + (Number(f.base) || 0), 0)); };
const pygTotal = () => r2(cuentaPyG(db, '0001-01-01', '9999-12-31').resultadoEjercicio);

const stat = { anuladas: 0, clientes: 0, productos: 0, servicios: 0, proveedores: 0, categorias: 0, ventas: 0, cobros: 0, compras: 0, gastos: 0, proyectos: 0, tiempo: 0, errores: 0 };
const oops = (ctx, e) => { stat.errores++; if (stat.errores <= 8) console.error('   ! ' + ctx + ': ' + (e.message || e)); };

console.log('Tenant:', TENANT, '· Ventas ANTES:', ventasBase(), '· P&G ANTES:', pygTotal());

// ── EN SECO — sin --hazlo se enseña el destrozo y se sale sin escribir ───────
if (!HAZLO) {
  const n = sql => { try { return db.prepare(sql).get().n; } catch { return '—'; } };
  console.log('\n── EN SECO. No se ha escrito NADA. Con --hazlo pasaría esto ──');
  console.log('  asientos del diario BORRADOS ..... ' + n('SELECT COUNT(*) n FROM ledger_entries'));
  console.log('  facturas emitidas → anuladas ..... ' + n("SELECT COUNT(*) n FROM invoices WHERE status='emitida'"));
  console.log('  facturas de proveedor → anuladas . ' + n("SELECT COUNT(*) n FROM supplier_invoices WHERE status='vigente'"));
  console.log('  clientes → inactivos ............. ' + n('SELECT COUNT(*) n FROM clients WHERE active=1'));
  console.log('  productos → archivados ........... ' + n("SELECT COUNT(*) n FROM products WHERE status='active'"));
  console.log('  proveedores → inactivos .......... ' + n('SELECT COUNT(*) n FROM suppliers WHERE active=1'));
  console.log('  proyectos → inactivos ............ ' + n('SELECT COUNT(*) n FROM proyectos WHERE active=1'));
  console.log('\n  Y sembraría el taller: ~500 facturas de 24 meses, catálogo, clientes, compras y horas.');
  console.log('  Si es lo que quieres: node scripts/seed-taller.mjs --hazlo');
  db.close();
  process.exit(0);
}

// ── FASE 0 — EMPEZAR LIMPIO (archivar + anular; nada se destruye) ─────────────
console.log('\n[0] Limpiando lo genérico (archivar + anular)…');
try {
  // RESET del histórico genérico. En vez de anular una a una (los datos preexistentes traían reversiones
  // incompletas y hasta tickets de 99.990 € que ensuciaban el P&G con ingresos fantasma), se hace en bloque:
  //  (1) se marca todo lo vivo como retirado (sale de Ventas/compras), y
  //  (2) se BORRA la huella entera del diario PREEXISTENTE (asientos con id ≤ el máximo antes de sembrar).
  // Así el P&G y Ventas arrancan de cero y solo cuentan el negocio del taller. Los documentos legales no se
  // borran (siguen en su tabla); es un tenant de PRUEBAS y hay copia de seguridad.
  const MAX_LEDGER = db.prepare('SELECT COALESCE(MAX(id),0) m FROM ledger_entries').get().m;
  db.prepare("UPDATE clients SET active=0 WHERE active=1").run();
  db.prepare("UPDATE products SET status='archived' WHERE status='active'").run();
  db.prepare("UPDATE suppliers SET active=0 WHERE active=1").run();       // proveedores genéricos → fuera
  db.prepare("UPDATE proyectos SET active=0 WHERE active=1").run();       // proyectos viejos (incl. el de pruebas) → fuera
  // Limpiar etiquetas de proyecto en documentos ya anulados: apuntan a proyectos borrados de trabajos
  // anteriores y ensuciarían la comparativa de rentabilidad con filas fantasma.
  db.prepare("UPDATE invoices SET project_id=NULL WHERE status='anulada'").run();
  db.prepare("UPDATE supplier_invoices SET project_id=NULL WHERE status='anulada'").run();
  try { db.prepare("UPDATE purchases SET archived=1 WHERE archived=0").run(); } catch {}
  try { db.prepare("UPDATE quotes SET status='rejected' WHERE status NOT IN ('rejected','converted')").run(); } catch {}
  try { db.prepare("UPDATE customer_orders SET status='anulado' WHERE status NOT IN ('anulado','entregado')").run(); } catch {}
  stat.anuladas = db.prepare("UPDATE invoices SET status='anulada' WHERE status='emitida'").run().changes;
  db.prepare("UPDATE supplier_invoices SET status='anulada' WHERE status='vigente'").run();
  const del = db.prepare('DELETE FROM ledger_entries WHERE id<=?').run(MAX_LEDGER);
  console.log('   asientos viejos del diario eliminados:', del.changes);
} catch (e) { oops('limpieza', e); }
console.log('   facturas retiradas de Ventas:', stat.anuladas, '· Ventas tras limpiar:', ventasBase());

// ── FASE 1 — IDENTIDAD DEL NEGOCIO ───────────────────────────────────────────
try {
  db.prepare("UPDATE company_config SET company_name=?, address=?, city=?, province=?, postal_code=? WHERE id=1")
    .run('Talleres RecambiAuto SL', 'Polígono Industrial Las Fraguas, Nave 12', 'Getafe', 'Madrid', '28906');
} catch (e) { oops('company_config', e); }

// ── FASE 2 — CATEGORÍAS ──────────────────────────────────────────────────────
const CATS = ['Frenos', 'Filtros y aceites', 'Batería y sistema eléctrico', 'Neumáticos', 'Motor y distribución', 'Suspensión y dirección', 'Servicios de taller'];
const catId = {};
for (const name of CATS) { try { const r = db.prepare('INSERT INTO categories (name,description) VALUES (?,?)').run(name, 'Taller: ' + name); catId[name] = r.lastInsertRowid; stat.categorias++; } catch (e) { oops('cat ' + name, e); } }

// ── FASE 3 — PROVEEDORES ─────────────────────────────────────────────────────
const PROVS = ['Recambios Ibérica SL', 'AutoDistribución Norte SA', 'Frenos y Embragues García SL', 'Lubricantes del Sur SL', 'Neumáticos RuedaFácil SL', 'Baterías PowerCar SL', 'Eléctrico AutoLux SL'];
const provId = [];
for (const name of PROVS) { try { const r = db.prepare("INSERT INTO suppliers (name,fiscal_id,active,payment_term_days) VALUES (?,?,1,?)").run(name, 'B' + ri(10000000, 99999999), pick([30, 30, 60])); provId.push(r.lastInsertRowid); stat.proveedores++; } catch (e) { oops('prov ' + name, e); } }

// ── FASE 4 — CATÁLOGO (recambios + servicios) ────────────────────────────────
// [key, nombre, categoría, precioVenta, coste, sku]
const PARTS = [
  ['past_del', 'Pastillas de freno delanteras', 'Frenos', 45, 27, 'FRE-001'],
  ['past_tra', 'Pastillas de freno traseras', 'Frenos', 42, 25, 'FRE-002'],
  ['disco_del', 'Discos de freno delanteros (par)', 'Frenos', 84, 52, 'FRE-003'],
  ['liq_frenos', 'Líquido de frenos DOT4 1L', 'Frenos', 12, 6, 'FRE-004'],
  ['filtro_aceite', 'Filtro de aceite', 'Filtros y aceites', 9, 4.5, 'FIL-001'],
  ['filtro_aire', 'Filtro de aire', 'Filtros y aceites', 16, 9, 'FIL-002'],
  ['filtro_hab', 'Filtro de habitáculo', 'Filtros y aceites', 18, 10, 'FIL-003'],
  ['filtro_comb', 'Filtro de combustible', 'Filtros y aceites', 22, 13, 'FIL-004'],
  ['aceite5w30', 'Aceite motor 5W30 (5L)', 'Filtros y aceites', 42, 26, 'ACE-001'],
  ['aceite10w40', 'Aceite motor 10W40 (5L)', 'Filtros y aceites', 36, 22, 'ACE-002'],
  ['bateria60', 'Batería 60Ah', 'Batería y sistema eléctrico', 95, 62, 'BAT-001'],
  ['bateria70', 'Batería 70Ah', 'Batería y sistema eléctrico', 115, 78, 'BAT-002'],
  ['alternador', 'Alternador', 'Batería y sistema eléctrico', 165, 108, 'ELE-001'],
  ['arranque', 'Motor de arranque', 'Batería y sistema eléctrico', 145, 96, 'ELE-002'],
  ['bujias', 'Bujías (juego de 4)', 'Batería y sistema eléctrico', 32, 18, 'ELE-003'],
  ['neu195', 'Neumático 195/65 R15', 'Neumáticos', 62, 43, 'NEU-001'],
  ['neu205', 'Neumático 205/55 R16', 'Neumáticos', 74, 51, 'NEU-002'],
  ['neu225', 'Neumático 225/45 R17', 'Neumáticos', 92, 64, 'NEU-003'],
  ['kit_dist', 'Kit de distribución', 'Motor y distribución', 185, 122, 'MOT-001'],
  ['correa_aux', 'Correa auxiliar', 'Motor y distribución', 28, 16, 'MOT-002'],
  ['bomba_agua', 'Bomba de agua', 'Motor y distribución', 58, 36, 'MOT-003'],
  ['termostato', 'Termostato', 'Motor y distribución', 24, 14, 'MOT-004'],
  ['bobina', 'Bobina de encendido', 'Motor y distribución', 48, 30, 'MOT-005'],
  ['amort_del', 'Amortiguador delantero', 'Suspensión y dirección', 72, 47, 'SUS-001'],
  ['amort_tra', 'Amortiguador trasero', 'Suspensión y dirección', 66, 43, 'SUS-002'],
  ['rotula', 'Rótula de dirección', 'Suspensión y dirección', 34, 20, 'SUS-003'],
  ['silentblock', 'Silentblock', 'Suspensión y dirección', 18, 10, 'SUS-004'],
  ['brazo_sus', 'Brazo de suspensión', 'Suspensión y dirección', 88, 58, 'SUS-005'],
];
const SERVICES = [
  ['s_itv', 'Revisión pre-ITV', 55, 'SRV-001'],
  ['s_aceite', 'Cambio de aceite y filtro (mano de obra)', 35, 'SRV-002'],
  ['s_30k', 'Revisión de 30.000 km', 120, 'SRV-003'],
  ['s_frenos', 'Sustitución de frenos (mano de obra)', 60, 'SRV-004'],
  ['s_diag', 'Diagnosis electrónica', 40, 'SRV-005'],
  ['s_alin', 'Alineación de dirección', 45, 'SRV-006'],
  ['s_montaje', 'Montaje y equilibrado de neumáticos', 48, 'SRV-007'],
  ['s_dist', 'Sustitución kit de distribución (mano de obra)', 220, 'SRV-008'],
  ['s_bateria', 'Sustitución de batería (mano de obra)', 20, 'SRV-009'],
  ['s_general', 'Revisión general', 90, 'SRV-010'],
];
const P = {};   // key → {id, price, cost, name}
for (const [key, name, cat, price, cost, sku] of PARTS) {
  try {
    const r = createProductSvc(db, { name, sku, price, tax_band: 'general', type: 'physical', tracking: 'none', category_id: catId[cat], supplier_id: pick(provId), stock: ri(8, 60), status: 'active' });
    db.prepare('UPDATE products SET average_cost=? WHERE id=?').run(cost, r.id);   // WAC para que el margen cuadre
    P[key] = { id: r.id, price, cost, name }; stat.productos++;
  } catch (e) { oops('prod ' + name, e); }
}
for (const [key, name, price, sku] of SERVICES) {
  try { const r = createProductSvc(db, { name, sku, price, tax_band: 'general', type: 'service', category_id: catId['Servicios de taller'], status: 'active' }); P[key] = { id: r.id, price, cost: null, name }; stat.servicios++; }
  catch (e) { oops('serv ' + name, e); }
}

// ── FASE 5 — CLIENTES (particulares + flotas/empresas) ───────────────────────
const EMPRESAS = [
  ['Taxis Ríos SL', 60], ['Autoescuela El Volante SL', 30], ['Reparto Rápido Mensajería SL', 30],
  ['Distribuciones Valle SL', 60], ['Construcciones Peña SA', 60], ['Fontanería Aqua SL', 30],
];
const PARTIC = ['Juan Martín López', 'Laura Gómez Ruiz', 'Carlos Sánchez Díaz', 'María Fernández Gil', 'Antonio Jiménez Mora', 'Elena Torres Vega', 'David Romero Iglesias', 'Sofía Navarro Cruz', 'Miguel Ortega Ramos', 'Lucía Castro Peña', 'Javier Molina Serrano', 'Marta Delgado Nieto', 'Pablo Vidal Herrera', 'Ana Suárez Campos', 'Rubén Cano Prieto', 'Isabel Ramos León', 'Sergio Marín Flores', 'Nuria Blanco Gil'];
const cliEmpresa = {}, cliPartic = [];
for (const [name, term] of EMPRESAS) { try { const r = createClientSvc(db, { name, fiscal_id: 'B' + ri(10000000, 99999999), client_type: 'empresa', payment_term_days: term, city: 'Madrid', province: 'Madrid', country: 'España', collections_profile: pick(['estandar', 'firme']) }); cliEmpresa[name] = r.id; stat.clientes++; } catch (e) { oops('cli ' + name, e); } }
for (const name of PARTIC) { try { const r = createClientSvc(db, { name, fiscal_id: ri(10000000, 99999999) + pick('TRWAGMYFPDXBNJZSQVHLCKE'), client_type: 'particular', payment_term_days: 0, city: pick(['Getafe', 'Leganés', 'Madrid', 'Alcorcón']), province: 'Madrid', country: 'España' }); cliPartic.push(r.id); stat.clientes++; } catch (e) { oops('cli ' + name, e); } }
const clientesTodos = [...Object.values(cliEmpresa), ...cliPartic];

// ── FASE 6 — MECÁNICOS (para el registro de tiempo) ──────────────────────────
const mecanicos = [];
// La contraseña de estas cuentas NI se hardcodea NI se imprime (misma regla que seed-superadmin,
// C6/B7: un secreto impreso se queda en el scrollback). Por defecto es aleatoria e inservible —estas
// cuentas existen para colgarles horas, no para entrar—; si necesitas entrar como un mecánico,
// arranca con SEED_MEC_PASSWORD=... y usa esa.
const MEC_HASH = bcrypt.hashSync(process.env.SEED_MEC_PASSWORD || randomBytes(24).toString('base64url'), 10);
for (const [name, tarifa] of [['Andrés (mecánico)', 32], ['Beatriz (mecánica)', 34]]) {
  try { const r = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active,tarifa_hora) VALUES (?,?,?,'employee',1,?)").run(name, 'mec-' + ri(1000, 9999) + '@recambiauto.local', MEC_HASH, tarifa); mecanicos.push(r.lastInsertRowid); } catch (e) { oops('mec ' + name, e); }
}

// ── FASE 7 — PROYECTOS (trabajos de taller para la rentabilidad) ─────────────
const PROJ = [
  ['Reparación motor — Flota Taxis Ríos', 'Taxis Ríos SL', 45],
  ['Revisión pre-ITV flota — Autoescuela El Volante', 'Autoescuela El Volante SL', 40],
  ['Puesta a punto furgonetas — Reparto Rápido', 'Reparto Rápido Mensajería SL', 42],
  ['Restauración clásico — cliente particular', null, 45],
];
const proyId = [];
for (const [nombre, empresa, tarifa] of PROJ) {
  try { const r = createProyectoSvc(db, { nombre, modo_cobro: 'horas', tarifa_hora: tarifa, cliente_id: empresa ? cliEmpresa[empresa] : pick(cliPartic), estado: 'abierto' }); proyId.push(r.id); stat.proyectos++; } catch (e) { oops('proy ' + nombre, e); }
}

// ── FASE 8 — TRABAJOS DE TALLER (plantillas de líneas de factura) ────────────
// Cada plantilla = un servicio + recambios coherentes.
// Trabajos ponderados (los grandes se repiten para subir el ticket medio a lo realista de un taller).
const JOBS = [
  { s: 's_itv', parts: [] },
  { s: 's_itv', parts: [['filtro_hab', 1]] },
  { s: 's_aceite', parts: [['aceite5w30', 1], ['filtro_aceite', 1]] },
  { s: 's_aceite', parts: [['aceite5w30', 1], ['filtro_aceite', 1], ['filtro_aire', 1]] },
  { s: 's_aceite', parts: [['aceite10w40', 1], ['filtro_aceite', 1]] },
  { s: 's_frenos', parts: [['past_del', 1], ['disco_del', 1], ['liq_frenos', 1]] },
  { s: 's_frenos', parts: [['past_del', 1], ['disco_del', 1], ['liq_frenos', 1]] },
  { s: 's_frenos', parts: [['past_del', 1], ['past_tra', 1], ['disco_del', 1], ['liq_frenos', 1]] },
  { s: 's_30k', parts: [['aceite5w30', 1], ['filtro_aceite', 1], ['filtro_aire', 1], ['filtro_hab', 1]] },
  { s: 's_30k', parts: [['aceite5w30', 1], ['filtro_aceite', 1], ['filtro_aire', 1], ['filtro_hab', 1], ['bujias', 1]] },
  { s: 's_dist', parts: [['kit_dist', 1], ['correa_aux', 1], ['bomba_agua', 1], ['termostato', 1]] },
  { s: 's_dist', parts: [['kit_dist', 1], ['correa_aux', 1], ['bomba_agua', 1]] },
  { s: 's_montaje', parts: [['neu205', 2], ['s_alin', 1]] },
  { s: 's_montaje', parts: [['neu205', 4], ['s_alin', 1]] },
  { s: 's_montaje', parts: [['neu195', 4], ['s_alin', 1]] },
  { s: 's_bateria', parts: [['bateria60', 1]] },
  { s: 's_bateria', parts: [['bateria70', 1]] },
  { s: 's_diag', parts: [['alternador', 1]] },
  { s: 's_diag', parts: [['arranque', 1]] },
  { s: 's_diag', parts: [['bobina', 1], ['bujias', 1]] },
  { s: 's_general', parts: [['amort_del', 2], ['rotula', 1]] },
  { s: 's_general', parts: [['amort_del', 2], ['amort_tra', 2], ['brazo_sus', 1]] },
  { s: 's_general', parts: [['past_del', 1], ['filtro_aceite', 1], ['aceite5w30', 1]] },
];
function jobLines(job) {
  const lines = [];
  const serv = P[job.s]; if (serv) lines.push({ description: serv.name, quantity: 1, unit_price: serv.price, tax_rate: 21, product_id: serv.id });
  for (const [k, qty] of job.parts) { const pr = P[k]; if (!pr) continue; if (k.startsWith('s_')) lines.push({ description: pr.name, quantity: qty, unit_price: pr.price, tax_rate: 21, product_id: pr.id }); else lines.push({ description: pr.name, quantity: qty, unit_price: pr.price, tax_rate: 21, product_id: pr.id }); }
  return lines;
}

// Generar la lista de ventas (fecha, cliente, líneas, proyecto?) y crearlas EN ORDEN CRONOLÓGICO
// (para que la secuencia Verifactu vaya con las fechas). Más volumen en meses recientes.
const ventasPlan = [];
for (let m = MONTHS - 1; m >= 0; m--) {
  const n = ri(16, 26);
  for (let i = 0; i < n; i++) {
    const empresa = rnd() < 0.28;
    const cli = empresa ? pick(Object.values(cliEmpresa)) : pick(cliPartic);
    ventasPlan.push({ m, day: ri(1, 28), cli, job: pick(JOBS) });
  }
}
ventasPlan.sort((a, b) => (b.m - a.m) === 0 ? a.day - b.day : (b.m - a.m));   // más antiguo primero

console.log('\n[8] Creando', ventasPlan.length, 'facturas de venta (24 meses) + cobros…');
const ventaIds = [];
for (const v of ventasPlan) {
  try {
    const issue = dateStr(v.m, v.day);
    const inv = createInvoice(db, { client_id: v.cli, lines: jobLines(v.job), issue_date: issue });
    stat.ventas++; ventaIds.push({ id: inv.id, m: v.m, issue });
    // Cobro: la mayoría cobradas; las muy recientes, algunas pendientes (para vencimientos/avisos).
    const cobrar = v.m >= 2 ? (rnd() < 0.92) : (rnd() < 0.45);
    if (cobrar) {
      const total = db.prepare('SELECT total FROM invoices WHERE id=?').get(inv.id).total;
      const parcial = rnd() < 0.1;
      const amount = parcial ? r2(total * (0.4 + rnd() * 0.3)) : total;
      let pd = addDaysStr(issue, ri(1, 25)); if (pd > TODAY) pd = TODAY;
      const pr = db.prepare('INSERT INTO invoice_payments (invoice_id, amount, paid_date, payment_method, note) VALUES (?,?,?,?,?)').run(inv.id, amount, pd, pick(['transferencia', 'tarjeta', 'efectivo']), '');
      try { postInvoicePayment(db, pr.lastInsertRowid); } catch {}
      stat.cobros++;
    }
  } catch (e) { oops('venta', e); }
}

// Etiquetar algunas ventas a los proyectos (rentabilidad): 2 facturas recientes por proyecto.
if (proyId.length) {
  const recientes = ventaIds.filter(x => x.m <= 6).slice(-40);
  proyId.forEach((pid, k) => { for (const x of pickN(recientes, 2)) { try { db.prepare('UPDATE invoices SET project_id=? WHERE id=?').run(pid, x.id); } catch {} } });
}

// ── FASE 9 — COMPRAS (mercadería → 600) y GASTOS (categorías) 24 meses ───────
console.log('[9] Creando compras de recambios + gastos de estructura (24 meses)…');
for (let m = MONTHS - 1; m >= 0; m--) {
  // 2-3 compras de recambios al mes (mercadería: postea a aprovisionamientos 600). COGS ~40% de ventas.
  for (let i = 0, n = ri(2, 3); i < n; i++) {
    try {
      const base = r2(ri(400, 1100) + rnd());
      const tax = r2(base * 0.21), total = r2(base + tax);
      const id = db.prepare("INSERT INTO supplier_invoices (supplier_id,invoice_date,base,tax,total,status,supplier_name) VALUES (?,?,?,?,?, 'vigente', ?)")
        .run(pick(provId), dateStr(m, ri(1, 28)), base, tax, total, pick(PROVS)).lastInsertRowid;
      postSupplierInvoice(db, id); stat.compras++;
      if (rnd() < 0.7) { const pr = db.prepare('INSERT INTO supplier_payments (supplier_invoice_id, amount, paid_date, payment_method) VALUES (?,?,?,?)').run(id, total, addDaysStr(dateStr(m, ri(1, 28)), ri(5, 30)), 'transferencia'); }
    } catch (e) { oops('compra', e); }
  }
  // Gastos de estructura (una línea por gasto).
  const gastos = [['Alquiler', 'Alquiler nave taller', ri(1150, 1300)], ['Suministros', 'Luz y agua', ri(180, 520)], ['Servicios profesionales', 'Gestoría', 150], ['Software y herramientas', 'Software de gestión + diagnosis', 55]];
  if (m % 3 === 0) gastos.push(['Marketing y publicidad', 'Publicidad local', ri(80, 200)]);
  for (const [cat, concepto, imp] of gastos) {
    try { createSupplierInvoiceSvc(db, { supplier_id: pick(provId), expense_category: cat, invoice_date: dateStr(m, ri(1, 28)), lines: [{ concepto, base: imp, tax_rate: 21 }] }, { onDuplicate: 'skip', today: TODAY }); stat.gastos++; } catch (e) { oops('gasto ' + cat, e); }
  }
}

// Etiquetar un gasto reciente a cada proyecto (para que la rentabilidad tenga coste asignado).
if (proyId.length) {
  const recibidasRecientes = db.prepare("SELECT id FROM supplier_invoices WHERE status='vigente' AND project_id IS NULL ORDER BY id DESC LIMIT 20").all().map(r => r.id);
  let gi = 0;
  proyId.forEach((pid, k) => {
    // El último proyecto (restauración clásico) se lleva 3 gastos → sale a pérdida (recambios caros, mal presupuestado).
    const cuantos = (k === proyId.length - 1) ? 3 : 1;
    for (let j = 0; j < cuantos; j++) { const g = recibidasRecientes[gi++]; if (g) { try { db.prepare('UPDATE supplier_invoices SET project_id=? WHERE id=?').run(pid, g); } catch {} } }
  });
}

// ── FASE 10 — REGISTRO DE TIEMPO en los proyectos ────────────────────────────
console.log('[10] Registrando horas de los mecánicos en los proyectos…');
if (mecanicos.length && proyId.length) {
  for (const pid of proyId) {
    for (let i = 0, n = ri(4, 9); i < n; i++) {
      try { createEntry(db, pick(mecanicos), { proyecto_id: pid, descripcion: pick(['Desmontaje y diagnóstico', 'Sustitución de piezas', 'Pruebas y ajuste', 'Revisión final', 'Montaje']), fecha: dateStr(ri(0, 6), ri(1, 28)), horas: ri(1, 6), minutos: pick([0, 15, 30, 45]), facturable: rnd() < 0.85 }); stat.tiempo++; } catch (e) { oops('tiempo', e); }
    }
  }
}

console.log('\n════════════════ RESUMEN ════════════════');
for (const [k, v] of Object.entries(stat)) console.log('  ' + k.padEnd(12), v);
console.log('\nVentas DESPUÉS:', ventasBase(), '· P&G DESPUÉS:', pygTotal());
console.log('(Recuerda: números F2026-#### por el motor, pero fechas reales de 2 años.)');
db.close();
