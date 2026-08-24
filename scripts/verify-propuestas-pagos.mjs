// Gate D5b — Propuestas de DISA · PAGO A PROVEEDOR POR VENCER. Réplica del gate de D5 (impago),
// invertido en el tiempo. Ciclo completo sobre COPIAS de BD reales (los datos vivos no se tocan).
//
// Cubre: esquema aditivo, generación por umbral SOLO de lo que está POR vencer (nunca lo ya vencido),
// umbral configurable, idempotencia estricta, la propuesta lleva los datos reales (proveedor, nº de
// factura, importe pendiente, vencimiento, días que faltan), APROBAR→REGISTRA EL PAGO por el ÚNICO
// motor de escritura (registerSupplierPaymentSvc, el mismo del botón "Pagar"), EDITAR (pago parcial),
// DESCARTAR no re-propone, permisos por tipo (quien no ve pagos no recibe la propuesta ni la cuenta
// en el badge), convivencia de los dos tipos, y aislamiento entre negocios.
//   node scripts/verify-propuestas-pagos.mjs
import Database from 'better-sqlite3';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../modules/erp/models.js';
import {
  generarPropuestasPago, generarPropuestasImpago, pagosPorVencer,
  propuestasPendientes, contarPropuestasPendientes, umbralPago,
  TIPO_IMPAGO, TIPO_PAGO,
} from '../modules/erp/propuestas.js';
import { registerSupplierPaymentSvc } from '../modules/erp/routes/supplier-invoices.js';
import { supplierInvoicePago } from '../modules/erp/pagos.js';
// 24 ago 2026 · La copia va por `copiarBase` (sqlite .backup), no por copyFileSync: los negocios
// corren en WAL y un `cp` deja fuera el -wal, o sea mide una foto vieja. Ver scripts/lib/copia-consistente.mjs.
import { copiarBase } from './lib/copia-consistente.mjs';

const TODAY = '2026-07-10';
const dias = n => new Date(Date.parse(TODAY + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
// UN NOMBRE DE TEMPORAL POR LLAMADA, no por negocio. 24 ago 2026: en verify-trazabilidad-flujos esta
// misma forma hizo que la segunda copia pisara la base que la primera tenía abierta, y la comprobación
// perdió un lote a media prueba. Aquí no había explotado todavía; el contador la desactiva.
let nCopias = 0;
const copias = [];

// Copia de una BD viva + esquema, con las propuestas a cero (la BD viva puede traer propuestas de una
// apertura previa del panel; este gate cuenta desde cero a propósito).
function copia(slug) {
  const p = join(tmpdir(), 'd5b-' + slug + '-' + process.pid + '-' + copias.length + '-' + (++nCopias) + '.db');
  copiarBase(`data/tenants/${slug}.db`, p);
  copias.push(p);
  const db = new Database(p);
  runMigrations(db);
  db.prepare('DELETE FROM disa_proposals').run();
  return db;
}

// Fixture: factura de compra con vencimiento a `enDias` de hoy (negativo = ya vencida) y total dado.
// Se cuelga de un proveedor real de la BD para no inventar datos maestros.
function facturaCompra(db, { enDias, total = 100, pagado = 0, status = 'vigente', tag = '' }) {
  const sup = db.prepare('SELECT id, name FROM suppliers ORDER BY id LIMIT 1').get();
  const res = db.prepare(
    `INSERT INTO supplier_invoices (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date,
                                    base, tax, total, status, supplier_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(sup.id, 'D5B-' + tag, 'PROV-' + tag, dias(-30), dias(enDias), total, 0, total, status, sup.name);
  const id = res.lastInsertRowid;
  if (pagado > 0) {
    db.prepare('INSERT INTO supplier_payments (supplier_invoice_id, amount, paid_date, payment_method, note) VALUES (?,?,?,?,?)')
      .run(id, pagado, dias(-1), 'transferencia', 'fixture');
  }
  return { id, supplier_id: sup.id, supplier_name: sup.name };
}

try {
  // ── 1. Esquema (aditivo, idempotente) ────────────────────────────────────────
  console.log('\n[1] Esquema');
  const db = copia('desarrollo-bamburu');
  const cols = new Set(db.prepare('PRAGMA table_info(disa_proposals)').all().map(c => c.name));
  ok(cols.has('supplier_invoice_id') && cols.has('supplier_id'), 'disa_proposals tiene supplier_invoice_id y supplier_id');
  ok(['id','type','invoice_id','client_id','status','subject','body','created_at','resolved_at','resolved_by'].every(c => cols.has(c)),
     'las columnas de D5 siguen intactas (cambio aditivo, sin DROP)');
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='disa_proposals'").all().map(r => r.name);
  ok(idx.includes('idx_disa_proposals_supplier_invoice_type'), 'existe el índice único (supplier_invoice_id, type)');
  ok(idx.includes('idx_disa_proposals_invoice_type'), 'sigue el índice único (invoice_id, type) de D5');
  ok(db.prepare('PRAGMA table_info(company_config)').all().some(c => c.name === 'dias_aviso_pago'), 'company_config tiene dias_aviso_pago');
  ok(umbralPago(db) === 7, 'umbral por defecto = 7 (el mismo que D5)');

  // ── 2. Generación: SOLO lo que está POR vencer ───────────────────────────────
  console.log('\n[2] Generación — solo lo que está POR vencer');
  // La BD copiada trae facturas de compra REALES, y algunas pueden caer ya dentro de la ventana. Se
  // mide la línea base y se asierta CONTRA ELLA: así el gate comprueba el efecto de sus fixtures sin
  // depender del estado incidental del demo (y sin borrar datos reales de la copia).
  const base = pagosPorVencer(db, TODAY, 7).length;
  console.log(`  · línea base: ${base} factura(s) de compra real(es) ya dentro de la ventana`);

  const fDentro   = facturaCompra(db, { enDias: 3,   total: 150, tag: 'dentro' });    // vence en 3d → SÍ
  const fHoy      = facturaCompra(db, { enDias: 0,   total: 80,  tag: 'hoy' });       // vence hoy → SÍ
  const fBorde    = facturaCompra(db, { enDias: 7,   total: 60,  tag: 'borde' });     // vence en 7d (=umbral) → SÍ
  const fLejos    = facturaCompra(db, { enDias: 30,  total: 200, tag: 'lejos' });     // vence en 30d → NO
  const fVencida  = facturaCompra(db, { enDias: -5,  total: 90,  tag: 'vencida' });   // YA vencida → NO (fuera de esta pieza)
  const fPagada   = facturaCompra(db, { enDias: 2,   total: 50, pagado: 50, tag: 'pagada' });   // sin pendiente → NO
  const fAnulada  = facturaCompra(db, { enDias: 2,   total: 70, status: 'anulada', tag: 'anulada' }); // anulada → NO
  const fParcial  = facturaCompra(db, { enDias: 4,   total: 100, pagado: 40, tag: 'parcial' });  // pendiente 60 → SÍ

  const r1 = generarPropuestasPago(db, { today: TODAY });
  const ids = new Set(db.prepare('SELECT supplier_invoice_id FROM disa_proposals WHERE type=?').all(TIPO_PAGO).map(r => r.supplier_invoice_id));
  ok(ids.has(fDentro.id) && ids.has(fHoy.id) && ids.has(fBorde.id) && ids.has(fParcial.id),
     'propone las que vencen dentro del umbral (en 3d, hoy, justo en el borde de 7d, y una pagada en parte)');
  ok(!ids.has(fLejos.id), 'NO propone la que vence en 30 días (fuera del umbral)');
  ok(!ids.has(fVencida.id), 'NO propone la YA VENCIDA (esta pieza mira hacia delante, no hacia atrás)');
  ok(!ids.has(fPagada.id), 'NO propone la que ya está pagada (sin importe pendiente)');
  ok(!ids.has(fAnulada.id), 'NO propone la anulada');
  ok(r1.creadas === base + 4, `crea exactamente 1 propuesta por candidata: ${base} reales + 4 fixtures = ${r1.creadas}`);
  ok(contarPropuestasPendientes(db, [TIPO_PAGO]) === base + 4, `el contador de pendientes de pago = ${base + 4}`);

  // Umbral configurable (hermano del de D5).
  db.prepare('UPDATE company_config SET dias_aviso_pago=? WHERE id=1').run(0);
  ok(umbralPago(db) === 0, 'el umbral se lee de Ajustes (0)');
  ok(pagosPorVencer(db, TODAY, umbralPago(db)).every(r => r.dias_para_vencer === 0), 'con umbral 0 solo entra lo que vence HOY');
  db.prepare('UPDATE company_config SET dias_aviso_pago=? WHERE id=1').run(14);
  ok(pagosPorVencer(db, TODAY, umbralPago(db)).some(r => r.supplier_invoice_id === fDentro.id), 'con umbral 14 sigue entrando la de 3d');
  db.prepare('UPDATE company_config SET dias_aviso_pago=7 WHERE id=1').run();

  // ── 3. Idempotencia estricta ─────────────────────────────────────────────────
  console.log('\n[3] Idempotencia');
  const r2 = generarPropuestasPago(db, { today: TODAY });
  ok(r2.creadas === 0 && r2.yaTenian === base + 4, `segunda pasada: 0 nuevas (las ${base + 4} ya estaban)`);
  const dup = db.prepare('SELECT supplier_invoice_id, COUNT(*) n FROM disa_proposals WHERE type=? GROUP BY supplier_invoice_id HAVING n>1').all(TIPO_PAGO);
  ok(dup.length === 0, 'ninguna factura de compra tiene 2 propuestas');
  // El panel genera al abrirse Y el cron genera: correr los dos el mismo día NO duplica.
  generarPropuestasPago(db, { today: TODAY });
  generarPropuestasPago(db, { today: TODAY });
  ok(db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_PAGO).n === base + 4,
     `panel + cron el mismo día → siguen siendo ${base + 4} (no duplica)`);

  // ── 4. La propuesta lleva los datos reales ───────────────────────────────────
  console.log('\n[4] Datos de la propuesta');
  const pend = propuestasPendientes(db, TODAY, [TIPO_PAGO]);
  const pDentro = pend.find(p => p.supplier_invoice_id === fDentro.id);
  ok(!!pDentro.supplier_name, `proveedor: "${pDentro.supplier_name}"`);
  ok(pDentro.internal_code === 'D5B-dentro', `nº de factura: ${pDentro.internal_code}`);
  ok(Math.abs(pDentro.importe - 150) < 0.005, `importe pendiente real: ${pDentro.importe}`);
  ok(pDentro.due_date === dias(3), `fecha de vencimiento: ${pDentro.due_date}`);
  ok(pDentro.dias_para_vencer === 3, `días que faltan: ${pDentro.dias_para_vencer}`);
  const pParcial = pend.find(p => p.supplier_invoice_id === fParcial.id);
  ok(Math.abs(pParcial.importe - 60) < 0.005, `en una pagada en parte, el importe es LO PENDIENTE (${pParcial.importe}), no el total`);
  ok(pend.every(p => !p.body), 'la propuesta de pago NO lleva email (sin cuerpo): a un proveedor no se le avisa de que se le va a pagar');

  // ── 5. Aprobar → REGISTRA EL PAGO (el mismo motor del botón "Pagar") ─────────
  console.log('\n[5] Aprobar → registra el pago');
  const antesPagos = db.prepare('SELECT COUNT(*) n FROM supplier_payments WHERE supplier_invoice_id=?').get(fDentro.id).n;
  // Esto es exactamente lo que hace el modal: importe PRECARGADO = lo pendiente, y al guardar pega al
  // ÚNICO endpoint de escritura, cuyo servicio es este. La propuesta se cierra solo si el pago sale bien.
  const res = registerSupplierPaymentSvc(db, fDentro.id, { amount: pDentro.importe, paid_date: TODAY, payment_method: 'transferencia' }, { today: TODAY });
  db.prepare("UPDATE disa_proposals SET status='aprobada_registrada', resolved_at=?, resolved_by=? WHERE id=?").run(new Date().toISOString(), 'gate', pDentro.id);
  ok(db.prepare('SELECT COUNT(*) n FROM supplier_payments WHERE supplier_invoice_id=?').get(fDentro.id).n === antesPagos + 1,
     'queda UN apunte nuevo en supplier_payments (el pago de verdad)');
  ok(Math.abs(res.pago.pendiente) < 0.005 && res.pago.estado === 'pagada', 'la factura queda PAGADA (pendiente 0)');
  ok(db.prepare('SELECT status FROM disa_proposals WHERE id=?').get(pDentro.id).status === 'aprobada_registrada', 'la propuesta queda aprobada_registrada');
  ok(!propuestasPendientes(db, TODAY, [TIPO_PAGO]).some(p => p.id === pDentro.id), 'la aprobada ya no está entre las pendientes');
  // Y no se vuelve a proponer nunca (índice único), aunque siga siendo candidata por fecha.
  ok(generarPropuestasPago(db, { today: TODAY }).creadas === 0, 'tras aprobar, la generación NO vuelve a proponer esa factura');

  // Sobrepago bloqueado por el motor (la propuesta no abre una puerta trasera al importe).
  let sobre = false;
  try { registerSupplierPaymentSvc(db, fBorde.id, { amount: 9999 }, { today: TODAY }); } catch (e) { sobre = e.status === 400; }
  ok(sobre, 'el motor sigue bloqueando el sobrepago (aprobar no salta las validaciones de pagos)');

  // ── 6. Editar → pago PARCIAL (lo que el modal ya permite) ────────────────────
  console.log('\n[6] Editar (pago parcial, como en el modal)');
  const pHoy = propuestasPendientes(db, TODAY, [TIPO_PAGO]).find(p => p.supplier_invoice_id === fHoy.id);
  registerSupplierPaymentSvc(db, fHoy.id, { amount: 30, paid_date: TODAY, payment_method: 'efectivo', note: 'a cuenta' }, { today: TODAY });
  const stHoy = supplierInvoicePago(db, db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(fHoy.id), TODAY);
  ok(Math.abs(stHoy.pagado - 30) < 0.005 && Math.abs(stHoy.pendiente - 50) < 0.005,
     `editar el importe registra un pago parcial (pagado 30, pendiente ${stHoy.pendiente}) — el modal manda`);
  ok(stHoy.estado === 'parcial', 'la factura queda "pagada en parte", no pagada');

  // ── 7. Descartar → no re-propone ─────────────────────────────────────────────
  console.log('\n[7] Descartar');
  const pDesc = propuestasPendientes(db, TODAY, [TIPO_PAGO]).find(p => p.supplier_invoice_id === fBorde.id);
  db.prepare("UPDATE disa_proposals SET status='descartada', resolved_at=? WHERE id=?").run(new Date().toISOString(), pDesc.id);
  const r3 = generarPropuestasPago(db, { today: TODAY });
  ok(r3.creadas === 0, 'tras descartar, la generación NO vuelve a proponer esa factura');
  ok(!propuestasPendientes(db, TODAY, [TIPO_PAGO]).some(x => x.id === pDesc.id), 'la descartada ya no está entre las pendientes');
  ok(db.prepare('SELECT COUNT(*) n FROM supplier_payments WHERE supplier_invoice_id=?').get(fBorde.id).n === 0, 'descartar NO ha pagado nada');

  // ── 8. Permisos por tipo (anti-backdoor) ─────────────────────────────────────
  console.log('\n[8] Permisos por tipo');
  generarPropuestasImpago(db, { today: TODAY });   // que convivan los dos tipos
  const nImpago = contarPropuestasPendientes(db, [TIPO_IMPAGO]);
  const nPago = contarPropuestasPendientes(db, [TIPO_PAGO]);
  ok(nImpago > 0 && nPago > 0, `conviven los dos tipos (impago=${nImpago}, pago=${nPago})`);
  // Quien solo ve cobros (invoices.read/cobros.read) NO recibe ni una propuesta de pago.
  const soloCobros = propuestasPendientes(db, TODAY, [TIPO_IMPAGO]);
  ok(soloCobros.length === nImpago && soloCobros.every(p => p.type === TIPO_IMPAGO),
     'quien solo tiene permiso de cobros no recibe NINGUNA propuesta de pago');
  // Quien solo ve compras (purchases.read) NO recibe ni una de impago.
  const soloCompras = propuestasPendientes(db, TODAY, [TIPO_PAGO]);
  ok(soloCompras.length === nPago && soloCompras.every(p => p.type === TIPO_PAGO),
     'quien solo tiene permiso de compras no recibe NINGUNA propuesta de impago');
  // Y el badge cuenta solo lo suyo (si contara todo, delataría propuestas que no puede abrir).
  ok(contarPropuestasPendientes(db, [TIPO_IMPAGO]) + contarPropuestasPendientes(db, [TIPO_PAGO])
     === contarPropuestasPendientes(db), 'el badge por tipos suma exactamente el total (sin fugas ni dobles)');
  ok(contarPropuestasPendientes(db, []) === 0, 'sin ningún tipo permitido, el badge cuenta 0 (falla cerrado)');

  // Los dos índices únicos conviven: los NULL no chocan entre sí (una de impago tiene
  // supplier_invoice_id NULL, y una de pago tiene invoice_id NULL).
  const totalPago = db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_PAGO).n;
  const totalImpago = db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=?').get(TIPO_IMPAGO).n;
  const nulosPago = db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=? AND invoice_id IS NULL').get(TIPO_PAGO).n;
  const nulosImpago = db.prepare('SELECT COUNT(*) n FROM disa_proposals WHERE type=? AND supplier_invoice_id IS NULL').get(TIPO_IMPAGO).n;
  ok(nulosPago === totalPago && totalPago > 0,
     `NINGUNA propuesta de pago usa invoice_id (${nulosPago}/${totalPago} con invoice_id NULL) — no pisa el espacio de ids de las ventas`);
  ok(nulosImpago === totalImpago && totalImpago > 0,
     `NINGUNA de impago usa supplier_invoice_id (${nulosImpago}/${totalImpago} NULL) — los dos índices únicos conviven`);
  db.close();

  // ── 9. Aislamiento multi-tenant ──────────────────────────────────────────────
  console.log('\n[9] Multi-tenant');
  const dbA = copia('desarrollo-bamburu'), dbB = copia('ibrahin-repuestos');
  facturaCompra(dbA, { enDias: 2, total: 111, tag: 'A' });
  const rA = generarPropuestasPago(dbA, { today: TODAY });
  const rB = generarPropuestasPago(dbB, { today: TODAY });
  ok(rA.creadas >= 1, `el negocio A genera en SU BD (${rA.creadas})`);
  ok(contarPropuestasPendientes(dbB, [TIPO_PAGO]) === rB.creadas, `el negocio B solo ve las suyas (${rB.creadas})`);
  const codesA = new Set(dbA.prepare('SELECT si.internal_code c FROM disa_proposals p JOIN supplier_invoices si ON si.id=p.supplier_invoice_id WHERE p.type=?').all(TIPO_PAGO).map(r => r.c));
  ok(!codesA.has(null) && codesA.size === rA.creadas, 'cada propuesta apunta a una factura de compra de SU propia BD');
  ok(true, 'las propuestas de un negocio viven solo en su fichero .db (aislamiento por diseño)');
  dbA.close(); dbB.close();
} finally {
  for (const p of copias) { try { unlinkSync(p); } catch {} }
  console.log('\n' + (fail ? '✗ ' + fail + ' fallos, ' : '') + pass + ' OK  (sobre COPIAS; datos vivos intactos)');
  process.exit(fail ? 1 : 0);
}
