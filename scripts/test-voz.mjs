// Test de LÓGICA — LA VOZ (Escalera · paso 5 · PIEZA 2), sobre BD temporal.
//   node scripts/test-voz.mjs
//
// La voz VISTE los hallazgos del vigía. El vigía ya está probado (test-vigia 33/0: cada cifra ==
// la del motor de su área). Aquí se demuestran los criterios PROPIOS de la voz:
//   1. CERO CIFRAS INVENTADAS — todo dígito que aparece en (a)/(b) es EXACTAMENTE la `cifra`, la
//      `fecha` o un código de `ref` del hallazgo. Se quitan esos y no queda ni un dígito suelto.
//   2. CUADRE aviso↔hallazgo — `aviso.cifra === hallazgo.cifra` y el importe formateado aparece en
//      el texto. Encadenado con test-vigia (hallazgo==motor) ⇒ aviso == pantalla del área.
//   3. SIEMPRE DECIDE — todo aviso termina en una decisión concreta (no vacía).
//   4. NO EJECUTA — el texto no trae botones/formularios/enlaces de acción, y `voz.js` no exporta
//      ninguna función de escritura.
//   5. PERMISOS — la voz hereda el filtrado del vigía: sin permiso de un área, no hay hallazgo → no
//      hay aviso (y el área figura en `sinPermiso`).
//   6. TRAZABLE — `porque` es el `motivo` del vigía, VERBATIM.
// Se imprime además un ejemplo por tipo para leerlo (lenguaje llano).
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { fijarObjetivo } from '../modules/erp/plan-financiero.js';
import { detectar } from '../modules/erp/vigia.js';
import { narrar, vestir, PLANTILLAS } from '../modules/erp/voz.js';
import * as VOZ from '../modules/erp/voz.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FALLO: ' + m); } };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const SYM = '€';
const dinero = n => SYM + Number(n || 0).toFixed(2);
const HOY = '2026-07-15';
const dbs = [];

function nuevaBD() {
  const f = join(tmpdir(), 'voz-' + randomBytes(4).toString('hex') + '.db');
  const db = new Database(f);
  dbs.push([db, f]);
  runMigrations(db);
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
  db.prepare("INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status, supplier_name, supplier_fiscal_id) VALUES (?,?,?,?,?,?,?,?, 'vigente','Proveedor','A99999999')")
    .run(supId, code, code, invDate, dueDate, base, tax, r2(base + tax));
  return db.prepare('SELECT id FROM supplier_invoices WHERE internal_code=?').get(code).id;
}

// El corazón del criterio 1: quita del texto SOLO los campos limpios del hallazgo (importe con y sin
// símbolo, fecha, códigos de ref). Si tras quitarlos queda algún dígito, es un número INVENTADO.
function sinDigitosInventados(texto, a) {
  let t = ' ' + texto + ' ';
  // Se quitan los campos limpios permitidos MÁS LARGOS PRIMERO: si no, la cifra "20" borraría el "20"
  // de la fecha "2026-…" y dejaría un falso dígito huérfano (la cifra y la fecha son ambas del hallazgo).
  const quitar = [dinero(a.cifra), String(a.cifra ?? ''), a.fecha, a.ref && a.ref.invoice_number, a.ref && a.ref.internal_code]
    .filter(x => x != null && x !== '').map(String).sort((x, y) => y.length - x.length);
  for (const q of quitar) t = t.split(q).join(' ');
  const resto = t.match(/\d/g);
  return { limpio: !resto, resto: resto || [] };
}

try {
  // ── SIEMBRA (idéntica al escenario "con problemas" de test-vigia: dispara los seis) ──
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

  const res = detectar(db, { hasPerm: () => true, hoy: HOY });
  const narrado = narrar(res, SYM);
  const avisos = narrado.avisos;
  const porDet = k => avisos.find(a => a.detector === k);

  console.log('\n=== 0. La voz viste todos los hallazgos (1 aviso por hallazgo) ===\n');
  ok(avisos.length === res.hallazgos.length && avisos.length > 0,
     'narrar() devuelve un aviso por cada hallazgo (' + avisos.length + ' avisos / ' + res.hallazgos.length + ' hallazgos)');
  const seis = ['deuda_vencida', 'cliente_dormido', 'caida_facturacion', 'caida_margen', 'desvio_plan', 'pago_vence_pronto'];
  for (const k of seis) ok(!!porDet(k), 'hay aviso para ' + k);

  console.log('\n=== 1. CERO CIFRAS INVENTADAS (todo dígito viene de un campo limpio) ===\n');
  for (const a of avisos) {
    const q = sinDigitosInventados(a.quePasa, a);
    const d = sinDigitosInventados(a.decision, a);
    ok(q.limpio, a.detector + ' · (a) qué pasa: sin dígitos inventados' + (q.limpio ? '' : ' — sobran ' + q.resto.join(',')));
    ok(d.limpio, a.detector + ' · (b) decisión: sin dígitos inventados' + (d.limpio ? '' : ' — sobran ' + d.resto.join(',')));
  }

  console.log('\n=== 2. CUADRE aviso ↔ hallazgo (misma cifra; el importe aparece en el texto) ===\n');
  for (const a of avisos) {
    const h = res.hallazgos.find(x => x === undefined ? false : x.detector === a.detector && x.ref && a.ref && JSON.stringify(x.ref) === JSON.stringify(a.ref)) || res.hallazgos.find(x => x.detector === a.detector);
    ok(h && a.cifra === h.cifra, a.detector + ': aviso.cifra === hallazgo.cifra (' + a.cifra + ')');
    const importe = a.moneda ? dinero(a.cifra) : String(a.cifra);
    ok((a.quePasa + ' ' + a.decision).includes(importe), a.detector + ': el importe "' + importe + '" aparece en el aviso');
  }

  console.log('\n=== 3. SIEMPRE DECIDE (decisión concreta, no vacía) ===\n');
  for (const a of avisos) {
    ok(typeof a.decision === 'string' && a.decision.trim().length > 10 && /Conviene/i.test(a.decision),
       a.detector + ': la decisión es concreta y empieza a decidir ("' + a.decision.slice(0, 48) + '…")');
  }

  console.log('\n=== 4. NO EJECUTA (solo texto; ni botón, ni formulario, ni acción) ===\n');
  const prohibido = /<button|<form|onclick|href=|<a\s|<input|<script|javascript:/i;
  for (const a of avisos) {
    ok(!prohibido.test(a.quePasa) && !prohibido.test(a.decision), a.detector + ': el texto no trae ningún control de acción');
  }
  const exportsVoz = Object.keys(VOZ);
  ok(exportsVoz.every(n => ['vestir', 'narrar', 'PLANTILLAS'].includes(n)),
     'voz.js solo exporta vestir/narrar/PLANTILLAS (ninguna función de escritura): ' + exportsVoz.join(', '));

  console.log('\n=== 5. PERMISOS (la voz hereda el filtrado del vigía) ===\n');
  const sinCobros = narrar(detectar(db, { hasPerm: p => p !== 'cobros.read', hoy: HOY }), SYM);
  ok(!sinCobros.avisos.some(a => a.detector === 'deuda_vencida'), 'Sin cobros.read: NO hay aviso de deuda vencida');
  ok((sinCobros.sinPermiso || []).some(s => s.key === 'deuda_vencida'), 'Sin cobros.read: deuda vencida figura en sinPermiso (se dice qué falta)');

  console.log('\n=== 6. TRAZABLE (porque == motivo del vigía, verbatim) ===\n');
  for (const a of avisos) {
    const h = res.hallazgos.find(x => x.detector === a.detector && JSON.stringify(x.ref) === JSON.stringify(a.ref));
    ok(h && a.porque === h.motivo, a.detector + ': "porque" es el motivo del vigía sin tocar');
  }

  console.log('\n=== EJEMPLOS (lenguaje llano — un aviso por tipo) ===');
  for (const k of seis) {
    const a = porDet(k);
    if (!a) continue;
    console.log('\n── ' + a.detectorEtiqueta + ' (' + a.areaEtiqueta + ')');
    console.log('   ' + a.encabezado);
    console.log('   (a) ' + a.quePasa);
    console.log('   (b) ' + a.decision);
    console.log('   ·   ' + a.porque);
  }

} catch (e) { console.error('ERROR', e.stack || e.message); fail++; } finally {
  for (const [db, f] of dbs) { try { db.close(); } catch {} try { unlinkSync(f); } catch {} }
}
console.log('\n=== RESULTADO: ' + pass + ' OK / ' + fail + ' FALLOS ===');
process.exit(fail ? 1 : 0);
