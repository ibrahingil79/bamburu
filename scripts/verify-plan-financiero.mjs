// ESCALERA · PASO 3 · BLOQUE 2 — PLAN FINANCIERO. Gate del motor.
//
// QUÉ MIDE Y POR QUÉ. Un plan de objetivos falla de tres maneras, y las tres son silenciosas:
//   [1] Comparando contra el número EQUIVOCADO. La decisión del dueño (17-jul) es que beneficio =
//       MARGEN, no el resultado del P&G. Si esto se torciera, el dueño perseguiría una meta contra
//       una cifra que no es la suya. Aquí se afirma que el real sale del margen ya validado.
//   [2] No encontrando lo real y diciendo "0 €" tan tranquilo. Pasa si la clave del objetivo
//       ('2026-T3') y la de lo real no hablan la misma gramática. Por eso la forma se valida al fijar.
//   [3] Inventando metas. Un periodo sin objetivo NO debe salir: un plan lleno de ceros que nadie
//       puso es ruido disfrazado de información.
// Y la regla que el dueño fijó y que este gate protege: **los niveles NO se fuerzan a cuadrar**. Que
// enero+febrero+marzo no sumen el T1 no es un error — son metas, no contabilidad.
//
// BD DESECHABLE. El negocio vivo no se toca.
//
//   node scripts/verify-plan-financiero.mjs
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice } from '../modules/erp/routes/invoices.js';
import { createClientSvc } from '../modules/erp/routes/clients.js';
import { recordMovement } from '../modules/erp/stock.js';
import { margenResumen } from '../modules/erp/ventas-metrics.js';
import { fijarObjetivo, planFinanciero, listarObjetivos, rangoDePeriodo } from '../modules/erp/plan-financiero.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) < t;
const fila = (db, tipo, clave, alcance = 'global', uid = null) =>
  planFinanciero(db, {}).find(f => f.tipo === tipo && f.clave === clave && f.alcance === alcance && (f.user_id ?? null) === uid);

const raiz = mkdtempSync(join(tmpdir(), 'bamburu-plan-'));
mkdirSync(join(raiz, 'data'));
const db = new Database(join(raiz, 'plan.db'));

try {
  runMigrations(db);
  db.prepare("UPDATE company_config SET fiscal_id='B00000000', company_name='Test SL', country='ES' WHERE id=1").run();
  const ana = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Ana','ana@t.local','x','employee',1)").run().lastInsertRowid;
  const pFis = db.prepare("INSERT INTO products (name,sku,price,tax_rate,type,status) VALUES ('Vela','V-1',25,21,'physical','active')").run().lastInsertRowid;
  recordMovement(db, { product_id: pFis, type: 'entrada', quantity: 200, unit_cost: 10, reason: 'semilla' });
  const c1 = createClientSvc(db, { name: 'Cliente Ana', responsable_user_id: ana }).id;
  const c2 = createClientSvc(db, { name: 'Cliente Nadie' }).id;

  // Julio 2026 (T3): Ana vende 400 de base (16 velas), coste 160 → margen 240.
  //                  Nadie vende 200 de base (8 velas), coste 80  → margen 120.
  // Global julio: base 600 · margen 360.
  createInvoice(db, { client_id: c1, issue_date: '2026-07-05', lines: [{ product_id: pFis, description: 'Vela', quantity: 16, unit_price: 25, tax_rate: 21 }] });
  createInvoice(db, { client_id: c2, issue_date: '2026-07-20', lines: [{ product_id: pFis, description: 'Vela', quantity: 8,  unit_price: 25, tax_rate: 21 }] });

  console.log('\n[1] EL RANGO DE UN PERIODO se deriva de su clave, sin tabla de calendario');
  check('mes  2026-07 → 01-jul a 31-jul', rangoDePeriodo('mes', '2026-07').from === '2026-07-01' && rangoDePeriodo('mes', '2026-07').to === '2026-07-31');
  check('trim 2026-T3 → 01-jul a 30-sep', rangoDePeriodo('trimestre', '2026-T3').from === '2026-07-01' && rangoDePeriodo('trimestre', '2026-T3').to === '2026-09-30');
  check('año  2026    → 01-ene a 31-dic', rangoDePeriodo('anio', '2026').from === '2026-01-01' && rangoDePeriodo('anio', '2026').to === '2026-12-31');
  check('febrero bisiesto no se inventa', rangoDePeriodo('mes', '2028-02').to === '2028-02-29', rangoDePeriodo('mes', '2028-02').to);

  console.log('\n[2] SIN OBJETIVOS, EL PLAN ESTÁ VACÍO — no inventa metas');
  check('un plan sin metas fijadas no trae filas', planFinanciero(db, {}).length === 0,
        'un plan lleno de ceros que nadie puso sería ruido disfrazado de información');

  console.log('\n[3] FACTURACIÓN — los tres periodos, alcance global');
  fijarObjetivo(db, { tipo: 'facturacion', periodo: 'mes', clave: '2026-07', alcance: 'global', valor: 500 });
  fijarObjetivo(db, { tipo: 'facturacion', periodo: 'trimestre', clave: '2026-T3', alcance: 'global', valor: 1000 });
  fijarObjetivo(db, { tipo: 'facturacion', periodo: 'anio', clave: '2026', alcance: 'global', valor: 5000 });
  const fm = fila(db, 'facturacion', '2026-07'), ft = fila(db, 'facturacion', '2026-T3'), fa = fila(db, 'facturacion', '2026');
  check('el REAL del mes es la base sin IVA', near(fm.real, 600), fm.real + ' € (con IVA serían 726)');
  check('desviación = real − objetivo', near(fm.desviacion, 100), fm.desviacion + ' € sobre 500');
  check('y en %', near(fm.desviacionPct, 20), fm.desviacionPct + '%');
  check('cumplido cuando real >= objetivo', fm.cumplido === true);
  check('el trimestre encuentra su real', near(ft.real, 600), ft.real + ' € (julio cae en T3)');
  check('no cumplido cuando real < objetivo', ft.cumplido === false, '600 < 1000');
  check('el año encuentra su real', near(fa.real, 600), fa.real);

  console.log('\n[4] LOS NIVELES NO SE FUERZAN A CUADRAR — y eso es la decisión, no un bug');
  check('mes(500) + nada + nada ≠ trimestre(1000), y ambos conviven', fm.objetivo === 500 && ft.objetivo === 1000,
        'son metas, no contabilidad: el dueño fija el nivel que quiera');
  check('cada nivel compara contra SU real, no contra la suma de los hijos', near(ft.real, 600) && near(fm.real, 600));

  console.log('\n[5] BENEFICIO = MARGEN (la decisión del dueño), NO el P&G');
  fijarObjetivo(db, { tipo: 'beneficio', periodo: 'mes', clave: '2026-07', alcance: 'global', valor: 300 });
  const bm = fila(db, 'beneficio', '2026-07');
  const m = margenResumen(db, { from: '2026-07-01', to: '2026-07-31' });
  check('el real del beneficio == margenResumen', near(bm.real, m.beneficio), bm.real + ' == ' + m.beneficio);
  check('y es 600 − 240 de coste = 360', near(bm.real, 360), bm.real + ' € (24 velas × 10 € de WAC = 240)');
  check('cumplido: 360 >= 300', bm.cumplido === true, 'desviación +' + bm.desviacion);

  console.log('\n[6] POR RESPONSABLE — y el global CUADRA con la suma');
  fijarObjetivo(db, { tipo: 'facturacion', periodo: 'mes', clave: '2026-07', alcance: 'responsable', user_id: ana, valor: 300 });
  fijarObjetivo(db, { tipo: 'beneficio', periodo: 'mes', clave: '2026-07', alcance: 'responsable', user_id: ana, valor: 200 });
  const fAna = fila(db, 'facturacion', '2026-07', 'responsable', ana);
  const bAna = fila(db, 'beneficio', '2026-07', 'responsable', ana);
  check('la facturación de Ana es solo la suya', near(fAna.real, 400), fAna.real + ' € (16 velas)');
  check('su beneficio también', near(bAna.real, 240), bAna.real + ' € (400 − 160 de coste)');
  check('lleva el nombre del responsable, no un id', fAna.responsable === 'Ana', fAna.responsable);
  // ESTA es la aserción que justifica la decisión de "beneficio = margen": con el P&G global sería
  // IMPOSIBLE, porque el libro contable no sabe de responsables.
  check('EL GLOBAL == Ana + el resto (600 = 400 + 200)', near(fm.real, fAna.real + 200),
        'el P&G no podría hacer esto: un asiento de alquiler no es de nadie');
  check('y en beneficio (360 = 240 + 120)', near(bm.real, bAna.real + 120));

  console.log('\n[7] EL AVISO DE "SIN COSTE" viaja con el beneficio');
  createInvoice(db, { client_id: c1, issue_date: '2026-07-25', lines: [{ description: 'Mano de obra', quantity: 1, unit_price: 200, tax_rate: 21 }] });
  const bm2 = fila(db, 'beneficio', '2026-07');
  check('el beneficio NO sube con una línea sin coste', near(bm2.real, 360), bm2.real + ' € (la mano de obra no regala 200 de margen)');
  check('pero se AVISA de lo que queda fuera', !!bm2.aviso && near(bm2.aviso.sinCoste, 200), bm2.aviso ? bm2.aviso.sinCoste + ' €' : 'sin aviso');
  check('la facturación SÍ la incluye (es venta real)', near(fila(db, 'facturacion', '2026-07').real, 800), 'el aviso es solo del beneficio');

  console.log('\n[8] FIJAR DOS VECES SUSTITUYE, NO DUPLICA');
  fijarObjetivo(db, { tipo: 'facturacion', periodo: 'mes', clave: '2026-07', alcance: 'global', valor: 900 });
  const dup = planFinanciero(db, {}).filter(f => f.tipo === 'facturacion' && f.clave === '2026-07' && f.alcance === 'global');
  check('sigue habiendo UNA sola meta', dup.length === 1, dup.length + ' fila(s)');
  check('con el valor nuevo', near(dup[0].objetivo, 900), dup[0].objetivo);
  check('y ahora NO se cumple', dup[0].cumplido === false, '800 < 900');

  console.log('\n[9] VALOR 0 O NEGATIVO QUITA LA META');
  fijarObjetivo(db, { tipo: 'facturacion', periodo: 'anio', clave: '2026', alcance: 'global', valor: 0 });
  check('el objetivo del año desaparece', !fila(db, 'facturacion', '2026'), 'sin botón aparte ni estado "meta a cero" que nadie sabría leer');
  check('los demás siguen', planFinanciero(db, {}).length === 5);

  console.log('\n[10] LAS CLAVES MAL FORMADAS SE RECHAZAN, no dan "0 € real"');
  const malas = [
    ['mes', '2026-T3'], ['trimestre', '2026-07'], ['anio', '2026-07'], ['mes', 'julio'], ['trimestre', '2026-T9'],
  ];
  let rechazadas = 0;
  for (const [p, k] of malas) {
    try { fijarObjetivo(db, { tipo: 'facturacion', periodo: p, clave: k, alcance: 'global', valor: 100 }); }
    catch (e) { if (e.status === 400) rechazadas++; }
  }
  check('las 5 claves imposibles se rechazan con 400', rechazadas === 5, rechazadas + '/5',);
  check('un objetivo de responsable SIN usuario se rechaza', (() => {
    try { fijarObjetivo(db, { tipo: 'facturacion', periodo: 'mes', clave: '2026-08', alcance: 'responsable', valor: 100 }); return false; }
    catch (e) { return e.status === 400; } })());
  check('un tipo inventado se rechaza', (() => {
    try { fijarObjetivo(db, { tipo: 'ventas', periodo: 'mes', clave: '2026-08', alcance: 'global', valor: 1 }); return false; }
    catch (e) { return e.status === 400; } })());

  console.log('\n[11] IDEMPOTENCIA y NO-DAÑO');
  const antes = listarObjetivos(db, {}).length;
  runMigrations(db); runMigrations(db);
  check('re-ejecutar runMigrations no toca los objetivos', listarObjetivos(db, {}).length === antes, antes + ' metas');
  check('el margen del paso 2 sigue intacto', near(margenResumen(db, { from: '2026-07-01', to: '2026-07-31' }).beneficio, 360));

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN:', e.message, '\n', e.stack);
} finally {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify-plan-financiero: ${ok} OK · ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
