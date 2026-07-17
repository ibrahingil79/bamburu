// ESCALERA · PASO 3 · BLOQUE 1 — INFORMES POR ÁREA. Gate del motor.
//
// QUÉ MIDE Y POR QUÉ. Un informe predefinido no falla dando error: falla dando **otro número**. Y dos
// cifras verdaderas que se contradicen son peores que una cifra que falta, porque nadie sabe cuál
// creer. Así que aquí no se comprueba que "responda": se comprueba que **CUADRE contra la fuente
// única** — que es toda la razón de que estos informes se apoyen en `countingSalesInvoices`,
// `countsAsPayable` y `openPayables` en vez de escribir sus propios SELECT.
//   [1] Σ ventas por periodo == Σ por cliente == Σ por responsable == ventasResumen.base
//   [2] mes/trimestre/año son AGRUPACIONES de lo mismo → los tres suman igual
//   [3] el IVA se queda fuera (base, no total)
//   [4] compras: Σ por proveedor == Σ por categoría; Σ tramos == openPayables.total
//   [5] lo que no tiene dueño/categoría NO se esconde (o el total dejaría de cuadrar)
//
// BD DESECHABLE. El negocio vivo no se toca.
//
//   node scripts/verify-informes.mjs
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { createClientSvc, updateClientSvc } from '../modules/erp/routes/clients.js';
import { recordMovement } from '../modules/erp/stock.js';
import { ventasResumen, ventasPorPeriodo, ventasPorCliente, ventasPorResponsable,
         cobradoVsPendiente, clientesNuevosPorMes, clavePeriodo } from '../modules/erp/ventas-metrics.js';
import { comprasPorProveedor, gastoPorCategoria, pendientePagoPorVencimiento, openPayables } from '../modules/erp/pagos.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) < t;
const suma = (arr, k) => Math.round(arr.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100;

const raiz = mkdtempSync(join(tmpdir(), 'bamburu-inf-'));
mkdirSync(join(raiz, 'data'));
const db = new Database(join(raiz, 'inf.db'));

try {
  runMigrations(db);
  db.prepare("UPDATE company_config SET fiscal_id='B00000000', company_name='Test SL', country='ES' WHERE id=1").run();
  const ana = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Ana','ana@t.local','x','employee',1)").run().lastInsertRowid;
  const pFis = db.prepare("INSERT INTO products (name,sku,price,tax_rate,type,status) VALUES ('Vela','V-1',25,21,'physical','active')").run().lastInsertRowid;
  recordMovement(db, { product_id: pFis, type: 'entrada', quantity: 100, unit_cost: 10, reason: 'semilla' });

  // Dos clientes: uno con responsable, otro sin. Fechas de DOS trimestres distintos, para que
  // mes/trimestre/año no puedan coincidir por casualidad.
  // createClientSvc devuelve {id,name,client_code}, no el id pelado.
  const c1 = createClientSvc(db, { name: 'Cliente Uno', responsable_user_id: ana }).id;
  const c2 = createClientSvc(db, { name: 'Cliente Dos' }).id;
  const F = (cid, fecha, qty) => createInvoice(db, { client_id: cid, issue_date: fecha,
    lines: [{ product_id: pFis, description: 'Vela', quantity: qty, unit_price: 25, tax_rate: 21 }] });
  F(c1, '2026-02-10', 4);   // 100 · T1
  F(c1, '2026-03-05', 2);   //  50 · T1
  F(c2, '2026-05-20', 8);   // 200 · T2
  emitTicketSvc(db, { lines: [{ product_id: pFis, quantity: 2 }], payment_method: 'efectivo', emitted_by: ana });   // 50 · mostrador, sin cliente

  const total = ventasResumen(db);

  console.log('\n[1] EL CUADRE — los cuatro informes de ventas dan LO MISMO');
  const porMes = ventasPorPeriodo(db, { periodo: 'mes' });
  const porCli = ventasPorCliente(db);
  const porResp = ventasPorResponsable(db);
  check('Σ por mes == ventasResumen.base', near(suma(porMes, 'base'), total.base), suma(porMes, 'base') + ' vs ' + total.base);
  check('Σ por cliente == ventasResumen.base', near(suma(porCli, 'base'), total.base), suma(porCli, 'base'));
  check('Σ por responsable == ventasResumen.base', near(suma(porResp, 'base'), total.base), suma(porResp, 'base'));

  console.log('\n[2] MES / TRIMESTRE / AÑO son la misma verdad, agrupada distinto');
  const porTri = ventasPorPeriodo(db, { periodo: 'trimestre' });
  const porAnio = ventasPorPeriodo(db, { periodo: 'anio' });
  check('Σ trimestre == Σ mes', near(suma(porTri, 'base'), suma(porMes, 'base')), suma(porTri, 'base'));
  check('Σ año == Σ mes', near(suma(porAnio, 'base'), suma(porMes, 'base')), suma(porAnio, 'base'));
  check('pero AGRUPAN distinto (no es el mismo array)', porMes.length > porTri.length && porTri.length > porAnio.length,
        porMes.length + ' meses · ' + porTri.length + ' trimestres · ' + porAnio.length + ' año');
  check('el trimestre se deriva de la fecha, sin tabla de calendario', clavePeriodo('2026-05-20', 'trimestre') === '2026-T2', clavePeriodo('2026-05-20', 'trimestre'));

  console.log('\n[3] EL IVA SE QUEDA FUERA');
  // 4+2+8+2 = 16 velas × 25 = 400 de base. Con IVA serían 484.
  check('el informe da la BASE, no el total con IVA', near(total.base, 400), total.base + ' (con IVA: ' + total.total + ')');
  check('y por periodo tampoco lleva IVA', near(suma(porMes, 'base'), 400));

  console.log('\n[4] NADA SE ESCONDE — o el total dejaría de cuadrar');
  check('el mostrador SIN cliente aparece como su propia fila', porCli.some(r => r.client_id === null && /Mostrador/.test(r.cliente)),
        'si se filtrara, faltarían 50 € y nadie sabría por qué');
  check('el cliente sin responsable cae en "Sin asignar"', porResp.some(r => r.responsable === 'Sin asignar'));
  check('y el de Ana se atribuye a Ana', near((porResp.find(r => r.responsable === 'Ana') || {}).base, 200), '100+50 del cliente + 50 del ticket');

  console.log('\n[5] FILTRO POR RESPONSABLE');
  const soloAna = ventasPorPeriodo(db, { periodo: 'anio', responsable_id: ana });
  const soloSin = ventasPorPeriodo(db, { periodo: 'anio', responsable_id: null });
  check('filtrar por Ana da solo lo suyo', near(suma(soloAna, 'base'), 200), suma(soloAna, 'base'));
  check('filtrar por null da SOLO los sin asignar', near(suma(soloSin, 'base'), 200), suma(soloSin, 'base') + ' (el cliente Dos)');
  check('Ana + sin asignar == el total', near(suma(soloAna, 'base') + suma(soloSin, 'base'), total.base));

  console.log('\n[6] COBRADO vs PENDIENTE — se apoya en el motor de Cobros');
  const cb = cobradoVsPendiente(db);
  check('facturado == ventasResumen.total (con IVA: es lo que entra en caja)', near(cb.facturado, total.total), cb.facturado);
  check('el ticket ya está cobrado', cb.cobrado > 0, cb.cobrado + ' € (el mostrador cobra al emitir)');
  check('facturado = cobrado + pendiente', near(cb.facturado, cb.cobrado + cb.pendiente));

  console.log('\n[7] COMPRAS — misma regla de conteo que Pagos');
  const s1 = db.prepare("INSERT INTO suppliers (name, active) VALUES ('Prov Uno',1)").run().lastInsertRowid;
  const s2 = db.prepare("INSERT INTO suppliers (name, active) VALUES ('Prov Dos',1)").run().lastInsertRowid;
  // OJO: `supplier_invoices.status` solo admite 'vigente' | 'anulada' (CHECK del esquema). El estado
  // de PAGO (pendiente/parcial/vencida/pagada/abono) NO se guarda: lo DERIVA `pagoState` de los pagos
  // y la fecha. Sembrar 'pendiente' aquí revienta — y hace bien: sería un estado inventado.
  const SI = (sid, nom, base, cat, estado = 'vigente', due = '2026-01-01') =>
    db.prepare("INSERT INTO supplier_invoices (supplier_id, supplier_name, invoice_date, due_date, base, tax, total, status, expense_category) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(sid, nom, '2026-02-01', due, base, base * 0.21, base * 1.21, estado, cat);
  SI(s1, 'Prov Uno', 1000, 'Alquiler');
  SI(s2, 'Prov Dos', 500, 'Software');
  SI(s2, 'Prov Dos', 300, null);                       // sin categorizar
  SI(s1, 'Prov Uno', 999, 'Alquiler', 'anulada');      // ANULADA: no debe contar en ningún informe
  const cp = comprasPorProveedor(db), gc = gastoPorCategoria(db);
  check('Σ por proveedor == Σ por categoría', near(suma(cp, 'base'), suma(gc, 'base')), suma(cp, 'base') + ' vs ' + suma(gc, 'base'));
  check('la ANULADA no cuenta (misma regla que Pagos)', near(suma(cp, 'base'), 1800), suma(cp, 'base') + ' (con la anulada serían 2799)');
  check('lo que no tiene categoría sale como "Sin categorizar"', gc.some(r => r.categoria === 'Sin categorizar' && near(r.base, 300)),
        'esconderlo descuadraría contra "por proveedor"');

  console.log('\n[8] PENDIENTE POR VENCIMIENTO — Σ tramos == openPayables');
  const tramos = pendientePagoPorVencimiento(db, '2026-07-17');
  const op = openPayables(db, '2026-07-17');
  check('Σ tramos == openPayables.total', near(suma(tramos, 'pendiente'), op.total), suma(tramos, 'pendiente') + ' vs ' + op.total);
  check('los tramos son los DEL MOTOR, no inventados', tramos.every(t => ['+60','30-60','0-30','al corriente','abono'].includes(t.tramo)),
        tramos.map(t => t.tramo).join(' · '));

  console.log('\n[9] LOS ABONOS NO SE DISFRAZAN DE "aún no vencida"');
  SI(s1, 'Prov Uno', -200, 'Alquiler');   // abono: base negativa
  const t2 = pendientePagoPorVencimiento(db, '2026-07-17');
  const ab = t2.find(t => t.tramo === 'abono');
  check('el abono va en SU tramo', !!ab, ab ? ab.etiqueta : 'no aparece');
  check('y no se suma a lo que aún no vence', !t2.some(t => t.tramo === 'al corriente' && t.pendiente < 0),
        'un abono no es un pago que no ha vencido: es dinero a tu favor');
  check('el cuadre aguanta con el abono dentro', near(suma(t2, 'pendiente'), openPayables(db, '2026-07-17').total));

  console.log('\n[10] CLIENTES NUEVOS POR MES');
  const nuevos = clientesNuevosPorMes(db, { meses: 12 });
  check('cuenta los clientes creados', suma(nuevos, 'clientes') === 2, suma(nuevos, 'clientes') + ' (los 2 del gate)');

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN:', e.message, '\n', e.stack);
} finally {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify-informes: ${ok} OK · ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
