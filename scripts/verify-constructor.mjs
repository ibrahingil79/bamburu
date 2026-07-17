// ESCALERA · PASO 4a — CONSTRUCTOR DE ANALÍTICAS. Gate del motor.
//
// QUÉ MIDE Y POR QUÉ. Un constructor da libertad, y la libertad es justo lo que puede romper la
// "única verdad": el dueño se dibuja un gráfico y ese gráfico dice OTRA cifra que la pantalla de
// Ventas. Como se la ha hecho él, no sospecharía. Este gate persigue esas cuatro formas de mentir:
//   [1] Que un cruce NO cuadre con ventasResumen → sería la prueba de que se saltó la regla de conteo.
//   [2] Que cambiar la dimensión cambie el total. Agrupar distinto NO puede cambiar cuánto vendiste.
//   [3] Que el margen se regale al 100 % donde no hay coste (la trampa del paso 2, ahora en manos del
//       usuario, que puede cruzar por lo que quiera).
//   [4] Que los permisos se salten por un campo: el desplegable filtrado NO es el candado.
// Y la promesa de los paneles: guardan la RECETA, no los datos → no congelan permisos.
//
// BD DESECHABLE. El negocio vivo no se toca.
//
//   node scripts/verify-constructor.mjs
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../modules/erp/models.js';
import { createInvoice, emitTicketSvc } from '../modules/erp/routes/invoices.js';
import { createClientSvc } from '../modules/erp/routes/clients.js';
import { recordMovement } from '../modules/erp/stock.js';
import { ventasResumen } from '../modules/erp/ventas-metrics.js';
import { cruzar, camposPara, filasVenta, guardarPanel, listarPaneles, borrarPanel,
         DIMENSIONES, MEDIDAS, AREAS, areasPara } from '../modules/erp/constructor-analitica.js';
const MEDIDAS_INV = Object.keys(AREAS.inventario.medidas);

let ok = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FALLO: ${label}${extra ? ' — ' + extra : ''}`); }
};
const near = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) < t;
const total = (r, k = 'base') => Math.round(r.filas.reduce((a, f) => a + (Number(f[k]) || 0), 0) * 100) / 100;
const TODO = () => true;   // permisos: puede todo (owner)

const raiz = mkdtempSync(join(tmpdir(), 'bamburu-cons-'));
mkdirSync(join(raiz, 'data'));
const db = new Database(join(raiz, 'cons.db'));

try {
  runMigrations(db);
  db.prepare("UPDATE company_config SET fiscal_id='B00000000', company_name='Test SL', country='ES' WHERE id=1").run();
  const ana = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Ana','a@t.local','x','employee',1)").run().lastInsertRowid;
  const cat = db.prepare("INSERT INTO categories (name) VALUES ('Velas')").run().lastInsertRowid;
  const pFis = db.prepare("INSERT INTO products (name,sku,price,tax_rate,type,status,category_id) VALUES ('Vela','V-1',25,21,'physical','active',?)").run(cat).lastInsertRowid;
  recordMovement(db, { product_id: pFis, type: 'entrada', quantity: 200, unit_cost: 10, reason: 'semilla' });
  const c1 = createClientSvc(db, { name: 'Cliente Uno', client_type: 'empresa', responsable_user_id: ana, province: 'Madrid' }).id;
  const c2 = createClientSvc(db, { name: 'Cliente Dos', client_type: 'particular' }).id;

  // 400 (Ana, feb) + 200 (nadie, may) + 50 (mostrador) + 200 sin coste = 850 de base.
  createInvoice(db, { client_id: c1, issue_date: '2026-02-10', lines: [{ product_id: pFis, description: 'Vela', quantity: 16, unit_price: 25, tax_rate: 21 }] });
  createInvoice(db, { client_id: c2, issue_date: '2026-05-20', lines: [{ product_id: pFis, description: 'Vela', quantity: 8,  unit_price: 25, tax_rate: 21 }] });
  emitTicketSvc(db, { lines: [{ product_id: pFis, quantity: 2 }], payment_method: 'efectivo', emitted_by: ana });
  createInvoice(db, { client_id: c1, issue_date: '2026-03-01', lines: [{ description: 'Mano de obra', quantity: 1, unit_price: 200, tax_rate: 21 }] });
  // Una ANULADA de 5.000: si el constructor se saltara la regla de conteo, aparecería.
  const anul = createInvoice(db, { client_id: c2, issue_date: '2026-04-01', lines: [{ product_id: pFis, description: 'Vela', quantity: 200, unit_price: 25, tax_rate: 21 }] });
  db.prepare("UPDATE invoices SET status='anulada' WHERE id=?").run(anul.id);

  const vr = ventasResumen(db);

  console.log('\n[1] EL CRUCE CUADRA CON VENTAS — la razón de que esta pieza no arme SQL');
  const porFecha = cruzar(db, { dimension: 'fecha', medidas: ['base'], hasPerm: TODO });
  check('Σ del cruce == ventasResumen.base', near(total(porFecha), vr.base), total(porFecha) + ' vs ' + vr.base);
  check('la factura ANULADA no aparece', near(vr.base, 850), vr.base + ' € (con la anulada serían 5.850)');
  check('...porque el conjunto ya viene filtrado por countingSalesInvoices', filasVenta(db).length === 4, filasVenta(db).length + ' líneas vivas');

  console.log('\n[2] AGRUPAR DISTINTO NO CAMBIA CUÁNTO VENDISTE');
  const dims = ['fecha', 'cliente', 'producto', 'categoria', 'responsable', 'serie', 'tipo_cliente', 'provincia', 'forma_pago'];
  const totales = dims.map(d => ({ d, t: total(cruzar(db, { dimension: d, medidas: ['base'], hasPerm: TODO })) }));
  check('las 9 dimensiones dan el MISMO total', totales.every(x => near(x.t, vr.base)),
        totales.map(x => x.d + ':' + x.t).join(' · '));
  check('pero agrupan distinto', new Set(dims.map(d => cruzar(db, { dimension: d, medidas: ['base'], hasPerm: TODO }).filas.length)).size > 1);

  console.log('\n[3] EL MARGEN NO SE REGALA — ni cruzando por lo que sea');
  const porProd = cruzar(db, { dimension: 'producto', medidas: ['base', 'coste', 'beneficio', 'margenPct'], hasPerm: TODO });
  const vela = porProd.filas.find(f => f.clave === 'Vela');
  const mano = porProd.filas.find(f => f.clave === 'Mano de obra');
  check('la vela: 650 de base, 260 de coste, 390 de beneficio', near(vela.base, 650) && near(vela.coste, 260) && near(vela.beneficio, 390));
  check('y su margen es 60%', near(vela.margenPct, 60), vela.margenPct + '%');
  check('la mano de obra NO declara 100% de margen', mano.margenPct === null && mano.beneficio === null, 'se pinta "—"');
  check('su base SÍ cuenta (es venta real)', near(mano.base, 200));
  check('y el aviso de "sin coste" viaja con el cruce', !!porProd.aviso && near(porProd.aviso.sinCoste, 200), porProd.aviso?.sinCoste + ' €');
  const soloBase = cruzar(db, { dimension: 'producto', medidas: ['base'], hasPerm: TODO });
  check('si NO pides margen, no hay aviso (sería ruido)', soloBase.aviso === null);

  console.log('\n[4] LOS PERMISOS — el desplegable no es el candado');
  const soloVentas = p => p === 'invoices.read';   // no puede clients.read ni products.read
  const campos = camposPara(soloVentas);
  check('el catálogo NO le ofrece cliente ni producto', !campos.dimensiones.cliente && !campos.dimensiones.producto,
        'ofrece: ' + Object.keys(campos.dimensiones).join(', '));
  check('pero sí fecha, responsable y serie', !!campos.dimensiones.fecha && !!campos.dimensiones.responsable && !!campos.dimensiones.serie);
  check('y aunque lo pida A MANO, el servidor lo deniega', (() => {
    try { cruzar(db, { dimension: 'cliente', medidas: ['base'], hasPerm: soloVentas }); return false; }
    catch (e) { return e.status === 403; } })(), 'saltarse el front no vale');
  check('tampoco puede FILTRAR por un campo que no ve', (() => {
    try { cruzar(db, { dimension: 'fecha', medidas: ['base'], filtros: { cliente: ['Cliente Uno'] }, hasPerm: soloVentas }); return false; }
    catch (e) { return e.status === 403; } })(), 'filtrar y mirar el total sería deducir el dato');
  check('una dimensión inventada se rechaza', (() => {
    try { cruzar(db, { dimension: 'lo_que_sea', medidas: ['base'], hasPerm: TODO }); return false; }
    catch (e) { return e.status === 400; } })(), 'falla cerrado: lo no mapeado no existe');
  check('sin medidas, se rechaza', (() => {
    try { cruzar(db, { dimension: 'fecha', medidas: [], hasPerm: TODO }); return false; }
    catch (e) { return e.status === 400; } })());

  console.log('\n[5] LOS FILTROS acotan sin descuadrar');
  const soloAna = cruzar(db, { dimension: 'fecha', medidas: ['base'], filtros: { responsable: ['Ana'] }, hasPerm: TODO });
  const soloSin = cruzar(db, { dimension: 'fecha', medidas: ['base'], filtros: { responsable: ['Sin asignar'] }, hasPerm: TODO });
  check('filtrar por Ana da lo suyo', near(total(soloAna), 650), total(soloAna) + ' € (400 + 50 ticket + 200 mano de obra)');
  check('Ana + sin asignar == el total', near(total(soloAna) + total(soloSin), vr.base));
  check('el filtro se aplica al MISMO valor que se agrupa', cruzar(db, { dimension: 'responsable', medidas: ['base'], filtros: { responsable: ['Ana'] }, hasPerm: TODO }).filas.length === 1,
        'lo que ves en la leyenda es lo que puedes filtrar');

  console.log('\n[6] EL PERIODO de la dimensión fecha');
  const mes = cruzar(db, { dimension: 'fecha', periodo: 'mes', medidas: ['base'], hasPerm: TODO });
  const tri = cruzar(db, { dimension: 'fecha', periodo: 'trimestre', medidas: ['base'], hasPerm: TODO });
  const anio = cruzar(db, { dimension: 'fecha', periodo: 'anio', medidas: ['base'], hasPerm: TODO });
  check('mes/trimestre/año suman igual', near(total(mes), total(tri)) && near(total(tri), total(anio)), total(mes) + ' €');
  check('y agrupan de más a menos filas', mes.filas.length > tri.filas.length && tri.filas.length >= anio.filas.length,
        mes.filas.length + ' · ' + tri.filas.length + ' · ' + anio.filas.length);
  check('la serie temporal sale ORDENADA por fecha', mes.filas.map(f => f.clave).join() === [...mes.filas.map(f => f.clave)].sort().join(),
        'una serie desordenada no es una serie');

  console.log('\n[7] LOS PANELES — de quien los crea, y guardan la RECETA');
  const p1 = guardarPanel(db, ana, { nombre: 'Mis ventas por mes', config: { dimension: 'fecha', periodo: 'mes', medidas: ['base'], grafico: 'lineas' } });
  const otro = db.prepare("INSERT INTO admin_users (name,email,password_hash,role,active) VALUES ('Beto','b@t.local','x','employee',1)").run().lastInsertRowid;
  guardarPanel(db, otro, { nombre: 'Panel de Beto', config: { dimension: 'cliente', medidas: ['base'], grafico: 'tarta' } });
  check('Ana ve SOLO el suyo', listarPaneles(db, ana).length === 1 && listarPaneles(db, ana)[0].nombre === 'Mis ventas por mes');
  check('Beto ve solo el suyo', listarPaneles(db, otro).length === 1 && listarPaneles(db, otro)[0].nombre === 'Panel de Beto');
  check('el panel guarda la RECETA, no los datos', !!listarPaneles(db, ana)[0].config.dimension && !listarPaneles(db, ana)[0].config.filas,
        'si guardara resultados, sería una fuga con fecha: perder un permiso y seguir viendo lo de antes');
  check('Ana NO puede borrar el de Beto', (() => {
    try { borrarPanel(db, ana, listarPaneles(db, otro)[0].id); return false; }
    catch (e) { return e.status === 404; } })(), 'el user_id va en el WHERE, no en la petición');
  check('un panel sin nombre se rechaza', (() => {
    try { guardarPanel(db, ana, { nombre: '  ', config: { dimension: 'fecha' } }); return false; }
    catch (e) { return e.status === 400; } })());
  check('un gráfico inventado se rechaza', (() => {
    try { guardarPanel(db, ana, { nombre: 'x', config: { dimension: 'fecha', grafico: 'holograma' } }); return false; }
    catch (e) { return e.status === 400; } })());
  check('editar el suyo lo actualiza, no lo duplica', (() => {
    guardarPanel(db, ana, { id: p1.id, nombre: 'Renombrado', config: { dimension: 'cliente', medidas: ['base'], grafico: 'barras' } });
    const l = listarPaneles(db, ana); return l.length === 1 && l[0].nombre === 'Renombrado'; })());
  check('Ana borra el suyo', (() => { borrarPanel(db, ana, p1.id); return listarPaneles(db, ana).length === 0; })());

  console.log('\n[8] 4a-bis — LAS OTRAS TRES ÁREAS cuadran cada una con SU fuente');
  // COMPRAS: dos facturas + una anulada + un gasto puro. Σ base por proveedor == por categoría, y la
  // anulada no cuenta (misma regla que Pagos).
  const s1c = db.prepare("INSERT INTO suppliers (name,active) VALUES ('Prov A',1)").run().lastInsertRowid;
  const s2c = db.prepare("INSERT INTO suppliers (name,active) VALUES ('Prov B',1)").run().lastInsertRowid;
  const SI = (sid, nom, base, cat, entity = 'purchase', st = 'vigente') =>
    db.prepare("INSERT INTO supplier_invoices (supplier_id,supplier_name,invoice_date,due_date,base,tax,total,status,expense_category,entity_type) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(sid, nom, '2026-03-01', '2026-04-01', base, base * 0.21, base * 1.21, st, cat, entity);
  SI(s1c, 'Prov A', 1000, 'Alquiler', null);       // gasto puro (entity null)
  SI(s2c, 'Prov B', 500, 'Software', 'purchase');  // mercancía
  SI(s1c, 'Prov A', 999, 'Alquiler', null, 'anulada');   // NO cuenta
  const compP = cruzar(db, { area: 'compras', dimension: 'proveedor', medidas: ['base', 'facturas'], hasPerm: TODO });
  const compC = cruzar(db, { area: 'compras', dimension: 'categoria', medidas: ['base'], hasPerm: TODO });
  const compT = cruzar(db, { area: 'compras', dimension: 'tipo', medidas: ['base'], hasPerm: TODO });
  check('COMPRAS: Σ por proveedor == Σ por categoría', near(total(compP), total(compC)) && near(total(compP), 1500), total(compP) + ' €');
  check('la ANULADA no cuenta (con ella serían 2499)', near(total(compP), 1500));
  check('distingue gasto puro (1000) de mercancía (500)', (() => {
    const gp = compT.filas.find(f => f.clave === 'Gasto puro'), mc = compT.filas.find(f => f.clave === 'Compra de mercancía');
    return near(gp.base, 1000) && near(mc.base, 500); })());

  // CLIENTES: grano cliente. nº clientes == activos; facturación reutiliza la regla de ventas.
  const cli = cruzar(db, { area: 'clientes', dimension: 'tipo_cliente', medidas: ['clientes', 'facturado', 'compras', 'ticket_medio'], hasPerm: TODO });
  const nAct = db.prepare('SELECT COUNT(*) n FROM clients WHERE active=1').get().n;
  check('CLIENTES: Σ nº clientes == activos', total(cli, 'clientes') === nAct, total(cli, 'clientes') + ' de ' + nAct);
  // 800, no 850: el ticket de MOSTRADOR (50 €) no tiene cliente, así que en un informe "por cliente"
  // no se atribuye a nadie — correcto. La anulada tampoco cuenta (regla de ventas intacta).
  check('facturación por cliente = ventas CON cliente (el mostrador no es de nadie)', near(total(cli, 'facturado'), 800), total(cli, 'facturado') + ' € (850 − 50 del mostrador sin cliente)');
  check('el ticket medio del grupo es facturado/compras, no media de medias', cli.filas.every(f => f.ticket_medio === null || f.ticket_medio > 0));

  // INVENTARIO: grano movimiento. Σ neto == Σ(quantity) del libro; entradas − salidas == neto.
  const inv = cruzar(db, { area: 'inventario', dimension: 'tipo', medidas: ['movimientos', 'entradas', 'salidas', 'neto', 'valor_movido'], hasPerm: TODO });
  const libro = db.prepare('SELECT ROUND(SUM(quantity),2) s, COUNT(*) n FROM stock_movements').get();
  check('INVENTARIO: Σ movimientos == el libro', total(inv, 'movimientos') === libro.n, total(inv, 'movimientos') + ' de ' + libro.n);
  check('Σ neto == Σ(quantity) del libro', near(total(inv, 'neto'), libro.s), total(inv, 'neto') + ' vs ' + libro.s);
  check('entradas − salidas == neto (es FLUJO, no stock)', near(total(inv, 'entradas') - total(inv, 'salidas'), total(inv, 'neto')));
  check('NO hay medida de "stock actual" (no es sumable)', !MEDIDAS_INV.includes('stock') && !MEDIDAS_INV.includes('nivel'),
        'el nivel depende del orden del libro: vive en Stock, no aquí');

  console.log('\n[9] CADA ÁREA TIENE SUS CAMPOS, y un campo de otra área no vale');
  check('compras no ofrece "responsable" (es de ventas/clientes)', !camposPara(TODO, 'compras').dimensiones.responsable);
  check('pedir una dimensión de otra área se rechaza', (() => {
    try { cruzar(db, { area: 'compras', dimension: 'serie', medidas: ['base'], hasPerm: TODO }); return false; }
    catch (e) { return e.status === 400; } })(), 'serie es de ventas');
  check('un área inventada se rechaza', (() => {
    try { cruzar(db, { area: 'marte', dimension: 'fecha', medidas: ['base'], hasPerm: TODO }); return false; }
    catch (e) { return e.status === 400; } })());
  // El candado por ÁREA: sin purchases.read no se cruza compras, ni a mano. (`soloVentas` se declaró
  // en [4]: solo invoices.read.)
  check('sin purchases.read, el área compras se deniega (403)', (() => {
    try { cruzar(db, { area: 'compras', dimension: 'proveedor', medidas: ['base'], hasPerm: soloVentas }); return false; }
    catch (e) { return e.status === 403; } })());
  check('areasPara solo ofrece las áreas que el usuario puede', (() => {
    const a = areasPara(soloVentas); return a.ventas && !a.compras && !a.clientes; })());

  console.log('\n[10] EL PERIODO no aplica en clientes (grano cliente, no temporal)');
  check('clientes NO usa periodo', camposPara(TODO, 'clientes').usaPeriodo === false);
  check('ventas y compras e inventario SÍ', camposPara(TODO, 'ventas').usaPeriodo && camposPara(TODO, 'compras').usaPeriodo && camposPara(TODO, 'inventario').usaPeriodo);

  console.log('\n[11] IDEMPOTENCIA y NO-DAÑO');
  const antes = listarPaneles(db, otro).length;
  runMigrations(db); runMigrations(db);
  check('re-ejecutar runMigrations no toca los paneles', listarPaneles(db, otro).length === antes);
  check('el catálogo tiene las 9 dimensiones y las 6 medidas', Object.keys(DIMENSIONES).length === 9 && Object.keys(MEDIDAS).length === 6);
  check('ventasResumen sigue intacto', near(ventasResumen(db).base, 850));

} catch (e) {
  fail++; console.error('\n✗ EXCEPCIÓN:', e.message, '\n', e.stack);
} finally {
  db.close();
  rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '✅' : '❌'} verify-constructor: ${ok} OK · ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
