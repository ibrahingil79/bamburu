// CRM · RESPONSABLE DE CLIENTE + atribución de la venta. Gate del motor.
//
// QUÉ MIDE Y POR QUÉ. La cascada de tres (decisión del dueño, 17-jul) tiene una asimetría que es
// justo donde se rompería si alguien la "simplifica" algún día:
//   · La rama 1 (hay cliente) se DERIVA EN VIVO → reasignar un cliente REATRIBUYE su histórico.
//   · La rama 2 (mostrador anónimo) se CONGELA  → quien cobró es un hecho, no una relación.
// Congelar la 1 rompería el CRM (reasignar no movería nada); derivar la 2 es imposible (no hay
// cliente del que derivar). Este gate afirma las dos, y que la 3 (sin asignar) no rompe nada.
//
// BD DESECHABLE creada aquí. El negocio vivo no se toca: una factura emitida es INMUTABLE (CANON) y
// sembrar/borrar facturas reales rompería la cadena de huellas Verifactu.
//
//   node scripts/verify-responsable.mjs
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { createClientSvc, updateClientSvc } from '../modules/erp/routes/clients.js';
import { recordMovement } from '../modules/erp/stock.js';
import { ventasPorResponsable, clientesPorResponsable, responsableDeVenta, SIN_ASIGNAR } from '../modules/erp/ventas-metrics.js';

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) < t;
const deQuien = (db, nombre) => (ventasPorResponsable(db).find(r => r.responsable === nombre) || { base: 0, facturas: 0 });

const raiz = mkdtempSync(join(tmpdir(), 'bamburu-resp-'));
mkdirSync(join(raiz, 'data'));
const db = new Database(join(raiz, 'resp.db'));

try {
  runMigrations(db);
  db.prepare("UPDATE company_config SET fiscal_id='B00000000', company_name='Test SL', country='ES' WHERE id=1").run();

  // El gate CREA SUS PROPIOS usuarios: probar la reatribución exige DOS comerciales de verdad, y dar
  // por hecho que el tenant ya los tiene es cómo un gate deja de probar lo que cree probar (C4a-bis).
  const ana  = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Ana Comercial','ana@test.local','x','employee',1)").run().lastInsertRowid;
  const beto = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Beto Mostrador','beto@test.local','x','employee',1)").run().lastInsertRowid;

  const pFis = db.prepare("INSERT INTO products (name,sku,price,tax_rate,type,status) VALUES ('Vela','V-1',25,21,'physical','active')").run().lastInsertRowid;
  recordMovement(db, { product_id: pFis, type: 'entrada', quantity: 100, unit_cost: 10, reason: 'semilla' });

  console.log('\n[1] LOS CLIENTES NACEN SIN ASIGNAR — y eso no es un error');
  const c1 = createClientSvc(db, { name: 'Cliente Uno', client_type: 'empresa' });
  check('un cliente nuevo nace sin responsable', db.prepare('SELECT responsable_user_id r FROM clients WHERE id=?').get(c1.id).r === null);
  createInvoice(db, { client_id: c1.id, lines: [{ product_id: pFis, description: 'Vela', quantity: 4, unit_price: 25, tax_rate: 21 }] });
  check('su venta cae en "sin asignar"', near(deQuien(db, SIN_ASIGNAR).base, 100), deQuien(db, SIN_ASIGNAR).base + ' €');
  check('y no rompe nada: la venta SIGUE contando', ventasPorResponsable(db).length === 1);

  console.log('\n[2] ASIGNAR → ATRIBUYE (rama 1)');
  updateClientSvc(db, c1.id, { name: 'Cliente Uno', client_type: 'empresa', responsable_user_id: ana });
  check('la ficha guarda el responsable', db.prepare('SELECT responsable_user_id r FROM clients WHERE id=?').get(c1.id).r === ana);
  check('la venta YA EMITIDA pasa a Ana', near(deQuien(db, 'Ana Comercial').base, 100), 'sin tocar la factura');
  check('y deja de estar sin asignar', deQuien(db, SIN_ASIGNAR).base === 0);

  console.log('\n[3] REASIGNAR → REATRIBUYE EL HISTÓRICO (la prueba de que se deriva EN VIVO)');
  updateClientSvc(db, c1.id, { name: 'Cliente Uno', client_type: 'empresa', responsable_user_id: beto });
  check('el histórico entero se mueve a Beto', near(deQuien(db, 'Beto Mostrador').base, 100),
        'si el responsable se congelara en la factura, esto seguiría en Ana');
  check('Ana se queda a cero', deQuien(db, 'Ana Comercial').base === 0);
  check('la factura NO se ha tocado', db.prepare('SELECT emitted_by e FROM invoices WHERE client_id=?').get(c1.id).e === null,
        'la reatribución es del CLIENTE, no del documento');

  console.log('\n[4] MOSTRADOR ANÓNIMO → QUIEN COBRÓ, CONGELADO (rama 2)');
  const t = emitTicketSvc(db, { lines: [{ product_id: pFis, quantity: 2 }], payment_method: 'efectivo', emitted_by: ana });
  const tick = db.prepare('SELECT * FROM invoices WHERE id=?').get(t.id);
  check('el ticket no tiene cliente', tick.client_id === null);
  check('pero SÍ guarda quién cobró', tick.emitted_by === ana);
  check('y se atribuye a Ana', near(deQuien(db, 'Ana Comercial').base, 50), deQuien(db, 'Ana Comercial').base + ' €');
  check('la cascada lo resuelve igual', responsableDeVenta(db, tick).id === ana);

  console.log('\n[5] EL CONGELADO NO SE MUEVE — aunque el cliente cambie de manos');
  updateClientSvc(db, c1.id, { name: 'Cliente Uno', client_type: 'empresa', responsable_user_id: ana });
  check('el ticket de Ana sigue siendo de Ana', db.prepare('SELECT emitted_by e FROM invoices WHERE id=?').get(t.id).e === ana,
        'la rama 2 no depende de ningún cliente');

  console.log('\n[6] LA RAMA 3 — el caso borde que el encargo no preveía');
  // Serie F, SIN cliente y SIN emisor: existe de verdad (4 así en el tenant de desarrollo, de junio).
  // No es mostrador y no tiene cliente → no lo cubre ni la rama 1 ni la 2. Debe caer en "sin asignar"
  // SIN romper nada ni desaparecer del total.
  const raro = createInvoice(db, { client_id: c1.id, lines: [{ description: 'Mano de obra', quantity: 1, unit_price: 200, tax_rate: 21 }] });
  db.prepare('UPDATE invoices SET client_id=NULL WHERE id=?').run(raro.id);   // se fuerza el caso borde
  const rowRaro = db.prepare('SELECT * FROM invoices WHERE id=?').get(raro.id);
  check('sin cliente y sin emisor', rowRaro.client_id === null && rowRaro.emitted_by === null);
  check('la cascada lo manda a "sin asignar"', responsableDeVenta(db, rowRaro).id === null && responsableDeVenta(db, rowRaro).nombre === SIN_ASIGNAR);
  check('aparece en el informe, NO desaparece', near(deQuien(db, SIN_ASIGNAR).base, 200), deQuien(db, SIN_ASIGNAR).base + ' €');

  console.log('\n[7] EL CUADRE — la suma por responsable ES el total de ventas');
  const filas = ventasPorResponsable(db);
  const suma = filas.reduce((a, r) => a + r.base, 0);
  // 100 (cliente) + 50 (ticket) + 200 (raro) = 350
  check('Σ por responsable == 350', near(suma, 350), suma + ' € en ' + filas.length + ' responsables');
  check('"sin asignar" es una fila más, no se esconde', filas.some(r => r.responsable === SIN_ASIGNAR),
        'esconderla descuadraría el total contra Ventas');

  console.log('\n[8] CLIENTES POR RESPONSABLE');
  const c2 = createClientSvc(db, { name: 'Cliente Dos' });
  const cli = clientesPorResponsable(db);
  check('Ana tiene 1 cliente', (cli.find(x => x.responsable === 'Ana Comercial') || {}).clientes === 1);
  check('y 1 queda sin asignar', (cli.find(x => x.responsable === SIN_ASIGNAR) || {}).clientes === 1, 'el recién creado');

  console.log('\n[9] UN RESPONSABLE DESACTIVADO cae en la rama 3, sin perder el dato');
  db.prepare('UPDATE admin_users SET active=0 WHERE id=?').run(ana);
  check('su cartera pasa a "sin asignar"', near(deQuien(db, SIN_ASIGNAR).base, 350 - deQuien(db, 'Beto Mostrador').base),
        'no desaparece: se queda sin dueño hasta que se reasigne');
  check('pero el id sigue en la ficha (nada se pierde)', db.prepare('SELECT responsable_user_id r FROM clients WHERE id=?').get(c1.id).r === ana);
  db.prepare('UPDATE admin_users SET active=1 WHERE id=?').run(ana);
  check('al reactivarlo, su cartera vuelve sola', near(deQuien(db, 'Ana Comercial').base, 150), '100 del cliente + 50 del ticket');

  console.log('\n[10] IDEMPOTENCIA y NO-DAÑO');
  const antes = db.prepare('SELECT COUNT(*) n FROM invoices WHERE emitted_by IS NOT NULL').get().n;
  runMigrations(db); runMigrations(db);
  check('re-ejecutar runMigrations no cambia nada', db.prepare('SELECT COUNT(*) n FROM invoices WHERE emitted_by IS NOT NULL').get().n === antes);
  check('la huella Verifactu del ticket sigue intacta', !!db.prepare('SELECT verifactu_hash h FROM invoices WHERE id=?').get(t.id).h);
  check('el margen del paso 2 sigue funcionando', db.prepare('SELECT unit_cost u FROM invoice_items WHERE invoice_id=?').get(t.id).u === 10);

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN:', e.message, '\n', e.stack);
} finally {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify-responsable: ${ok} OK · ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
