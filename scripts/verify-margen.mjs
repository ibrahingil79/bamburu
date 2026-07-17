// ESCALERA · PASO 2 — MARGEN. Gate del cálculo.
//
// QUÉ MIDE Y POR QUÉ. El margen es una cifra que el dueño va a usar para decidir precios. Si miente,
// miente en la dirección más cara posible: hacia arriba (parece que ganas más de lo que ganas). Las
// cuatro formas de mentir que este gate persigue son exactamente las cuatro decisiones del encargo:
//   [1] Meter el IVA dentro → margen inflado con dinero de Hacienda.
//   [2] Leer el WAC de HOY en vez del congelado → el margen de enero cambia si compras caro en marzo.
//   [3] Contar como coste 0 lo que no tiene coste → margen del 100% regalado a servicios y líneas libres.
//   [4] Que el total y la suma por producto no cuadren → dos cifras verdaderas y contradictorias.
//
// SOBRE LOS DATOS: BD DESECHABLE creada aquí desde runMigrations, nunca el negocio vivo. Una factura
// emitida es INMUTABLE (CANON) y sembrar/borrar facturas en el tenant real rompería la cadena de
// huellas Verifactu. Todo lo que se emite aquí muere con el fichero temporal.
//
//   node scripts/verify-margen.mjs
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { recordMovement } from '../modules/erp/stock.js';
import { margenResumen, margenPorProducto } from '../modules/erp/ventas-metrics.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) < t;

const raiz = mkdtempSync(join(tmpdir(), 'bamburu-margen-'));
mkdirSync(join(raiz, 'data'));
const db = new Database(join(raiz, 'margen.db'));

try {
  runMigrations(db);

  // ── Semilla ────────────────────────────────────────────────────────────────
  db.prepare("UPDATE company_config SET fiscal_id='B00000000', company_name='Test SL', country='ES' WHERE id=1").run();
  const cli = db.prepare("INSERT INTO clients (name, fiscal_id) VALUES ('Cliente Test','12345678Z')").run().lastInsertRowid;

  // FÍSICO con coste: WAC 10 €. Se vende a 25 € netos → margen 60%.
  // OJO — `products.stock` y `products.average_cost` son CACHÉS DERIVADAS del libro
  // `stock_movements`, no campos que se rellenen a mano. Sembrarlas por UPDATE parece funcionar y
  // luego revienta: al primer movimiento, `recomputeStock` recalcula desde el libro y, si el libro
  // está vacío, deja stock negativo y WAC 0. Así que el coste se siembra COMO EN LA VIDA REAL:
  // con una entrada de compra que lo justifica. (Esto lo descubrió este gate fallando; se deja
  // escrito para que el siguiente no repita el diagnóstico.)
  const pFis = db.prepare("INSERT INTO products (name, sku, price, tax_rate, type, status) VALUES ('Vela Test','V-1',25,21,'physical','active')").run().lastInsertRowid;
  recordMovement(db, { product_id: pFis, type: 'entrada', quantity: 100, unit_cost: 10, reason: 'semilla del gate' });
  // SERVICIO: sin WAC por naturaleza. Se vende a 100 € → NO es 100% de margen: es "no lo sé".
  const pSrv = db.prepare("INSERT INTO products (name, sku, price, tax_rate, type, status, average_cost, stock) VALUES ('Consultoría Test','S-1',100,21,'service','active',0,0)").run().lastInsertRowid;
  // FÍSICO NUNCA COMPRADO: WAC 0. Mismo trato que el servicio: sin coste conocido.
  const pNC  = db.prepare("INSERT INTO products (name, sku, price, tax_rate, type, status, average_cost, stock) VALUES ('Nunca Comprado','N-1',50,21,'physical','active',0,0)").run().lastInsertRowid;

  console.log('\n[1] EL SNAPSHOT — la línea nace sabiendo qué vendió y cuánto costaba');
  const f1 = createInvoice(db, { client_id: cli, lines: [{ product_id: pFis, description: 'Vela Test', quantity: 4, unit_price: 25, tax_rate: 21 }] });
  const l1 = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').get(f1.id);
  check('la línea guarda product_id', l1.product_id === pFis, 'antes se tiraba al insertar');
  check('la línea congela el coste (WAC 10)', near(l1.unit_cost, 10), 'unit_cost=' + l1.unit_cost);
  check('queda marcado como congelado', l1.cost_source === 'snapshot', "cost_source=" + l1.cost_source);

  console.log('\n[2] EL IVA SE QUEDA FUERA — la mentira más fácil de colar');
  // 4 × 25 = 100 base. Con IVA serían 121. Coste 4 × 10 = 40. Beneficio honesto: 60, margen 60%.
  let r = margenResumen(db);
  check('ingresos = BASE sin IVA, no el total con IVA', near(r.ingresos, 100), r.ingresos + ' (con IVA serían 121)');
  check('coste = WAC × unidades', near(r.coste, 40), r.coste);
  check('beneficio = 100 − 40', near(r.beneficio, 60), r.beneficio);
  check('margen % sobre ingresos SIN IVA', near(r.margenPct, 60), r.margenPct + '% (sobre 121 daría 49,6%)');

  console.log('\n[3] EL COSTE ESTÁ CONGELADO — el WAC de hoy no reescribe el pasado');
  db.prepare('UPDATE products SET average_cost=20 WHERE id=?').run(pFis);   // sube el coste DESPUÉS de vender
  r = margenResumen(db);
  check('el margen NO se mueve al cambiar el WAC', near(r.coste, 40) && near(r.beneficio, 60),
        'coste sigue 40 (si leyera el WAC vivo sería 80 y el beneficio 20)');
  db.prepare('UPDATE products SET average_cost=10 WHERE id=?').run(pFis);   // se restaura para el resto

  console.log('\n[4] SIN COSTE REGISTRADO — lo que NO se sabe se aparta, no se regala');
  createInvoice(db, { client_id: cli, lines: [{ product_id: pSrv, description: 'Consultoría Test', quantity: 1, unit_price: 100, tax_rate: 21 }] });
  createInvoice(db, { client_id: cli, lines: [{ description: 'Mano de obra', quantity: 1, unit_price: 200, tax_rate: 21 }] });   // línea LIBRE
  createInvoice(db, { client_id: cli, lines: [{ product_id: pNC, description: 'Nunca Comprado', quantity: 1, unit_price: 50, tax_rate: 21 }] });
  r = margenResumen(db);
  check('el servicio no trae coste', db.prepare("SELECT unit_cost FROM invoice_items WHERE description='Consultoría Test'").get().unit_cost === null);
  check('la línea libre no trae coste ni producto', (() => { const l = db.prepare("SELECT * FROM invoice_items WHERE description='Mano de obra'").get(); return l.unit_cost === null && l.product_id === null; })());
  check('el físico nunca comprado no trae coste', db.prepare("SELECT unit_cost FROM invoice_items WHERE description='Nunca Comprado'").get().unit_cost === null, 'WAC 0 = "no lo sé", NO "gratis"');
  check('esas ventas se apartan (100+200+50)', near(r.sinCoste, 350), r.sinCoste);
  check('y NO inflan el beneficio', near(r.beneficio, 60), r.beneficio + ' (contándolas a coste 0 daría 410)');
  check('el margen % NO se calcula sobre el total', near(r.margenPct, 60), r.margenPct + '% (sobre los 450 ingresos daría 13,3%)');
  check('los ingresos totales sí los incluyen', near(r.ingresos, 450), r.ingresos);
  check('se dice qué parte queda fuera', near(r.sinCostePct, 77.78), r.sinCostePct + '%');

  console.log('\n[5] EL CUADRE — el total es la suma del desglose, no otra cifra');
  const prods = margenPorProducto(db);
  const sumIng = prods.reduce((a, p) => a + p.ingresos, 0);
  const sumCos = prods.reduce((a, p) => a + (p.coste || 0), 0);
  const sumBen = prods.reduce((a, p) => a + (p.beneficio || 0), 0);
  const sumSin = prods.reduce((a, p) => a + p.sinCoste, 0);
  check('Σ ingresos por producto == total', near(sumIng, r.ingresos), sumIng + ' vs ' + r.ingresos);
  check('Σ coste por producto == total', near(sumCos, r.coste), sumCos + ' vs ' + r.coste);
  check('Σ beneficio por producto == total', near(sumBen, r.beneficio), sumBen + ' vs ' + r.beneficio);
  check('Σ sin-coste por producto == total', near(sumSin, r.sinCoste), sumSin + ' vs ' + r.sinCoste);

  console.log('\n[6] EL DESGLOSE dice la verdad fila a fila');
  const fVela = prods.find(p => p.product_name === 'Vela Test');
  const fSrv  = prods.find(p => p.product_name === 'Consultoría Test');
  const fLib  = prods.find(p => p.product_name === 'Mano de obra');
  check('la vela: 4 uds, 100 ingresos, 40 coste, 60 beneficio, 60%',
        fVela.qty === 4 && near(fVela.ingresos, 100) && near(fVela.coste, 40) && near(fVela.beneficio, 60) && near(fVela.margenPct, 60));
  check('el servicio: margen null, NO 100', fSrv.margenPct === null && fSrv.coste === null, 'se pinta "—"');
  check('la línea libre: margen null, NO 100', fLib.margenPct === null && fLib.beneficio === null);
  check('la línea libre aparece igual (no desaparece del informe)', near(fLib.ingresos, 200), 'agrupada por descripción');

  console.log('\n[7] EL ABONO NETEA — ingreso y coste restan a la vez');
  // Se devuelven 2 velas: −2 × 25 = −50 de ingreso, −2 × 10 = −20 de coste. Beneficio: 60 − 30 = 30.
  createInvoice(db, { client_id: cli, lines: [{ product_id: pFis, description: 'Vela Test', quantity: -2, unit_price: 25, tax_rate: 21 }] });
  r = margenResumen(db);
  check('el ingreso resta', near(r.ingresosConCoste, 50), r.ingresosConCoste);
  check('el coste TAMBIÉN resta', near(r.coste, 20), r.coste + ' (si no restara, el beneficio saldría 30 en vez de 30… y el margen 40%)');
  check('el beneficio queda 50 − 20 = 30', near(r.beneficio, 30), r.beneficio);
  check('el margen sigue siendo 60%', near(r.margenPct, 60), r.margenPct + '%');

  console.log('\n[8] EL MOSTRADOR también congela (vende físicos y mueve stock)');
  const t = emitTicketSvc(db, { lines: [{ product_id: pFis, quantity: 1 }], payment_method: 'efectivo' });
  const lt = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').get(t.id);
  check('el ticket guarda product_id', lt.product_id === pFis);
  check('el ticket congela el coste', near(lt.unit_cost, 10), 'unit_cost=' + lt.unit_cost);
  check('marcado como congelado', lt.cost_source === 'snapshot');

  console.log('\n[9] IDEMPOTENCIA de la migración');
  const antes = db.prepare('SELECT COUNT(*) n FROM invoice_items WHERE unit_cost IS NOT NULL').get().n;
  runMigrations(db); runMigrations(db);
  const despues = db.prepare('SELECT COUNT(*) n FROM invoice_items WHERE unit_cost IS NOT NULL').get().n;
  check('re-ejecutar runMigrations no cambia nada', antes === despues, antes + ' == ' + despues);
  check('la bandera del backfill queda puesta', !!db.prepare("SELECT value FROM settings WHERE key='migration_invoice_items_coste_backfill_2026_v1'").get());

  console.log('\n[10] NO SE TOCÓ NADA DE LO QUE NO TOCA');
  check('la huella Verifactu de la 1ª factura sigue ahí', !!db.prepare('SELECT verifactu_hash FROM invoices WHERE id=?').get(f1.id).verifactu_hash);
  check('el motor del WAC sigue mandando en su caché', near(db.prepare('SELECT average_cost FROM products WHERE id=?').get(pFis).average_cost, 10),
        'este paso NO recalcula ni escribe el WAC: solo le hace la foto');

  console.log('\n[11] LA PRUEBA DE FUEGO — el coste congelado sobrevive a que el WAC se caiga');
  // No es un caso raro: `average_cost` es una CACHÉ del libro y se mueve sola. Aquí se fuerza el
  // escenario extremo —el WAC del producto se va a 0— y se comprueba que la venta ya emitida NO
  // cambia de margen. Si el informe leyera el WAC vivo, esta venta pasaría a declarar un 100% de
  // beneficio. Esto es, literalmente, para qué existe la columna `unit_cost`.
  const antesBen = margenResumen(db).beneficio;
  db.prepare('UPDATE products SET average_cost=0 WHERE id=?').run(pFis);
  const rr = margenResumen(db);
  check('el coste congelado de la línea sigue siendo 10', near(db.prepare('SELECT unit_cost FROM invoice_items WHERE invoice_id=?').get(f1.id).unit_cost, 10));
  check('el beneficio NO se mueve con el WAC a 0', near(rr.beneficio, antesBen), rr.beneficio + ' == ' + antesBen);
  check('y NO aparece un margen del 100%', !near(rr.margenPct, 100), rr.margenPct + '% (leyendo el WAC vivo sería 100%)');

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN:', e.message, '\n', e.stack);
} finally {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify-margen: ${ok} OK · ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
