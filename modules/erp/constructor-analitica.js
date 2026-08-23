// ════════════════════════════════════════════════════════════════════════════
// CONSTRUCTOR DE ANALÍTICAS — el motor. Escalera · paso 4a + 4a-bis + 4b.
// Áreas: VENTAS · COMPRAS · CLIENTES · INVENTARIO · CONTABILIDAD. Contabilidad entró (18 jul 2026)
// colgándose de `cuentaPyG` (el motor del P&G), NO de `ledger_lines`: así es imposible que dé un
// beneficio distinto del de Libros y modelos (ver el área CONTABILIDAD, abajo).
//
// LA DECISIÓN QUE LO SOSTIENE (dueño, 17 jul 2026): **el constructor NO arma SQL.** Cruza sobre un
// conjunto de filas YA VERIFICADO, uno POR ÁREA. Armar SQL con allowlist (patrón `query_database`,
// D1) protege los PERMISOS pero **no las reglas de negocio**: un gráfico que consultara `invoices`
// contaría anuladas y tickets sustituidos; uno que sumara `ledger_lines` mezclaría grupos de cuenta.
// Aquí la regla de cada área se aplica UNA vez, en su `filas()`, reutilizando el motor que ya la tiene
// escrita y probada (countingSalesInvoices · countsAsPayable · openDebts · el libro de stock). Todo lo
// demás es agrupar: imposible contradecir a la pantalla del área.
//
// CADA ÁREA TIENE UN GRANO DISTINTO, y esto NO es "repetir ventas ×4":
//   · VENTAS     → una LÍNEA de factura.        Mide dinero, unidades y margen.
//   · COMPRAS    → una FACTURA recibida.        Mide gasto y lo pendiente de pagar.
//   · CLIENTES   → un CLIENTE.                  Mide cartera (nº, facturación, deuda).
//   · INVENTARIO → un MOVIMIENTO de stock.      Mide FLUJO (entradas/salidas), NO niveles: el stock
//                  actual y el WAC dependen del ORDEN del libro y no se reconstruyen sumando un
//                  periodo. El nivel actual ya vive en Stock; aquí se mide lo que se movió.
// Cruzar ENTRE áreas (sumar granos distintos) es el paso 4b: no se hace sin decidir antes cómo.
import { countingSalesInvoices, ventasPorCliente, clientesDormidos,
         SQL_RESPONSABLE, SQL_RESPONSABLE_JOIN, SIN_ASIGNAR, clavePeriodo } from './ventas-metrics.js';
import { countsAsPayable, supplierInvoicePago } from './pagos.js';
import { cuentaPyG } from './contabilidad-pyg.js';   // PASO 4a-bis: Contabilidad se cuelga del P&G, no de ledger_lines
import { clientDebt } from './cobros.js';
import { margen as margenDe, MODOS, modoDeEmpresa, MODO_POR_DEFECTO } from './margen.js';
// FICHA D · PARTE 1 — el área de AGENDA se cuelga del MOTOR DE CITAS, no de una consulta propia.
// `tramosPersona` da el horario REAL de una persona un día (con las excepciones ya aplicadas) y
// `ocupacionPersona` lo que tiene pillado (con márgenes y tiempos muertos). Son las MISMAS dos
// funciones de las que come `ocupacionDia` del vigía, así que la capacidad que se mide aquí no
// puede contradecir a la que enseña la agenda ni a la del Inicio.
import { tramosPersona, ocupacionPersona, interseca, resta, ESTADO_LABEL,
         ANULADA_POR_LABEL, ANULADA_POR_SIN } from './citas-engine.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const VACIO = '(sin dato)';
const nombreUsuario = (db, id) => id ? (db.prepare('SELECT name FROM admin_users WHERE id=? AND active=1').get(id)?.name || SIN_ASIGNAR) : SIN_ASIGNAR;

export const TIPOS_GRAFICO = ['barras', 'lineas', 'tarta', 'tabla'];

// ── ÁREA: VENTAS ─────────────────────────────────────────────────────────────
// El conjunto enriquecido: una fila por LÍNEA de venta de las facturas que cuentan. Se exporta
// `filasVenta` (nombre histórico) por compatibilidad con el gate.
export function filasVenta(db, { from = null, to = null } = {}) {
  const facturas = countingSalesInvoices(db, { from, to });
  if (!facturas.length) return [];
  const ph = facturas.map(() => '?').join(',');
  return db.prepare(
    `SELECT ii.id, ii.invoice_id, ii.quantity, ii.total_price AS base, ii.unit_cost, ii.product_id,
            ii.description AS linea,
            i.issue_date, i.series, i.client_id, i.client_name, i.client_province,
            c.client_type, c.payment_method,
            p.name AS producto, cat.name AS categoria,
            ${SQL_RESPONSABLE}
       FROM invoice_items ii
       JOIN invoices i    ON i.id = ii.invoice_id
       LEFT JOIN clients c   ON c.id = i.client_id
       LEFT JOIN products p  ON p.id = ii.product_id
       LEFT JOIN categories cat ON cat.id = p.category_id
       ${SQL_RESPONSABLE_JOIN}
      WHERE ii.invoice_id IN (${ph})`
  ).all(...facturas.map(f => f.id));
}

const AREA_VENTAS = {
  etiqueta: 'Ventas', perm: 'invoices.read',
  filas: filasVenta,
  dimensiones: {
    fecha:        { etiqueta: 'Fecha',            valor: (f, o) => clavePeriodo(f.issue_date, o.periodo || 'mes') },
    cliente:      { etiqueta: 'Cliente',          perm: 'clients.read',  valor: f => f.client_id ? (f.client_name || VACIO) : 'Mostrador (sin cliente)' },
    tipo_cliente: { etiqueta: 'Tipo de cliente',  perm: 'clients.read',  valor: f => f.client_type || VACIO },
    provincia:    { etiqueta: 'Provincia',        perm: 'clients.read',  valor: f => (f.client_province || '').trim() || '(sin provincia)' },
    forma_pago:   { etiqueta: 'Forma de pago',    perm: 'clients.read',  valor: f => (f.payment_method || '').trim() || VACIO },
    producto:     { etiqueta: 'Producto',         perm: 'products.read', valor: f => f.producto || f.linea || VACIO },
    categoria:    { etiqueta: 'Categoría',        perm: 'products.read', valor: f => f.categoria || '(sin categoría)' },
    responsable:  { etiqueta: 'Responsable',      valor: f => f.responsable_nombre || SIN_ASIGNAR },
    serie:        { etiqueta: 'Serie de factura', valor: f => f.series || VACIO },
  },
  medidas: {
    base:      { etiqueta: 'Facturado (sin IVA)', dinero: true },
    unidades:  { etiqueta: 'Unidades vendidas',   dinero: false },
    lineas:    { etiqueta: 'Nº de líneas',        dinero: false },
    coste:     { etiqueta: 'Coste',               dinero: true },
    // FICHA D-bis — renombrada. «Beneficio (margen)» y «Margen sobre lo que te costó» se leían como
    // la misma cosa dos veces y eran dos medidas distintas: una en euros y otra en porcentaje.
    beneficio: { etiqueta: 'Beneficio en euros',  dinero: true },
    margenPct: { etiqueta: 'Margen %',            dinero: false, pct: true },
    // FICHA D-ter — MEDIDAS CON NOMBRE en vez de una caja de fórmulas. Un dueño no escribe cuentas:
    // pide «el ticket medio». La cuenta la hace el programa, y así además sale bien ponderada (el
    // total del grupo entre sus facturas, no la media de medias, que pondera mal).
    facturas:     { etiqueta: 'Nº de facturas',    dinero: false },
    ticket_medio: { etiqueta: 'Ticket medio',      dinero: true },
  },
  usaPeriodo: true,
  nuevoAcc: clave => ({ clave, base: 0, unidades: 0, lineas: 0, coste: 0, _conCoste: 0, sinCoste: 0, _fact: new Set() }),
  sumar: (a, f) => {
    const base = Number(f.base) || 0;
    a.base += base; a.unidades += Number(f.quantity) || 0; a.lineas++;
    if (f.invoice_id != null) a._fact.add(f.invoice_id);
    // MISMA regla que `margenResumen`: sin coste conocido NO es margen del 100 %, se aparta.
    if (f.unit_cost == null) a.sinCoste += base;
    else { a._conCoste += base; a.coste += (Number(f.unit_cost) || 0) * (Number(f.quantity) || 0); }
  },
  salida: (a, meds, modoMargen) => {
    // La división la hace el MOTOR ÚNICO (`margen.js`). Sale exactamente el mismo número que antes
    // —misma base `_conCoste`, mismo redondeo—, pero ahora viaja acompañado: `margen` lleva LAS DOS
    // cifras y la parte que queda fuera, para que ninguna pantalla pueda enseñar el % desnudo.
    const mg = margenDe({ venta: a._conCoste, coste: a.coste, fuera: a.sinCoste });
    const o = { clave: a.clave };
    for (const m of meds) {
      if (m === 'base') o.base = r2(a.base);
      else if (m === 'unidades') o.unidades = r2(a.unidades);
      else if (m === 'lineas') o.lineas = a.lineas;
      else if (m === 'coste') o.coste = mg.coste;
      else if (m === 'beneficio') o.beneficio = mg.euros;
      // El titular obedece al ajuste de empresa; las dos cifras viajan igualmente en `o.margen`.
      else if (m === 'margenPct') o.margenPct = modoMargen === 'coste' ? mg.pctCoste : mg.pctVenta;
      else if (m === 'facturas') o.facturas = a._fact.size;
      // El ticket medio del GRUPO = lo facturado del grupo / sus facturas. No la media de medias.
      else if (m === 'ticket_medio') o.ticket_medio = a._fact.size ? r2(a.base / a._fact.size) : null;
    }
    o.sinCoste = r2(a.sinCoste);
    o.margen = mg;
    return o;
  },
  // Solo sale si se pide margen: si miras facturación, "sin coste" no te afecta y sería ruido.
  aviso: (accs, meds) => {
    if (!meds.some(m => ['beneficio', 'margenPct', 'coste'].includes(m))) return null;
    const s = r2([...accs.values()].reduce((x, a) => x + a.sinCoste, 0));
    return s > 0 ? { sinCoste: s } : null;
  },
  ordenar: 'base',
};

// ── ÁREA: COMPRAS ────────────────────────────────────────────────────────────
// Grano: una FACTURA recibida. Regla de conteo: `countsAsPayable` (anuladas fuera; abonos netean por
// su base negativa). El pendiente sale de `supplierInvoicePago` — el MISMO que la pantalla de Pagos.
const AREA_COMPRAS = {
  etiqueta: 'Compras', perm: 'purchases.read',
  filas: (db, { from = null, to = null } = {}) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const where = [], params = [];
    if (from) { where.push('invoice_date >= ?'); params.push(from); }
    if (to)   { where.push('invoice_date <= ?'); params.push(to); }
    const sql = 'SELECT * FROM supplier_invoices' + (where.length ? ' WHERE ' + where.join(' AND ') : '');
    return db.prepare(sql).all(...params).filter(countsAsPayable).map(inv => ({
      ...inv, pendiente: supplierInvoicePago(db, inv, hoy).pendiente,
    }));
  },
  dimensiones: {
    fecha:     { etiqueta: 'Fecha',      valor: (f, o) => clavePeriodo(f.invoice_date, o.periodo || 'mes') },
    proveedor: { etiqueta: 'Proveedor',  valor: f => f.supplier_name || '(sin proveedor)' },
    categoria: { etiqueta: 'Categoría de gasto', valor: f => (f.expense_category || '').trim() || 'Sin categorizar' },
    // entity_type: null = gasto puro (sin mercancía); lo demás es compra de mercancía/recepción.
    tipo:      { etiqueta: 'Tipo',       valor: f => f.entity_type ? 'Compra de mercancía' : 'Gasto puro' },
  },
  medidas: {
    base:      { etiqueta: 'Comprado (sin IVA)', dinero: true },
    facturas:  { etiqueta: 'Nº de facturas',     dinero: false },
    pendiente: { etiqueta: 'Pendiente de pago',  dinero: true },
    pct_pendiente: { etiqueta: '% pendiente de pago', dinero: false, pct: true },
  },
  usaPeriodo: true,
  nuevoAcc: clave => ({ clave, base: 0, facturas: 0, pendiente: 0 }),
  sumar: (a, f) => { a.base += Number(f.base) || 0; a.facturas++; a.pendiente += Number(f.pendiente) || 0; },
  salida: (a, meds) => {
    const o = { clave: a.clave };
    for (const m of meds) {
      if (m === 'base') o.base = r2(a.base);
      else if (m === 'facturas') o.facturas = a.facturas;
      else if (m === 'pendiente') o.pendiente = r2(a.pendiente);
      else if (m === 'pct_pendiente') o.pct_pendiente = a.base ? r2(a.pendiente / a.base * 100) : null;
    }
    return o;
  },
  ordenar: 'base',
};

// ── ÁREA: CLIENTES ───────────────────────────────────────────────────────────
// Grano: un CLIENTE activo. La facturación reutiliza `ventasPorCliente` (regla de conteo intacta: base
// sin IVA, anuladas fuera) y la deuda `clientDebt` (el mismo cálculo que la ficha). Un cliente sin
// ventas también cuenta: tener cartera parada es un dato, no un cero que se esconde.
const AREA_CLIENTES = {
  etiqueta: 'Clientes', perm: 'clients.read',
  filas: (db) => {
    const ventas = new Map(ventasPorCliente(db, { limit: 100000 }).filter(v => v.client_id).map(v => [v.client_id, v]));
    const hoy = new Date().toISOString().slice(0, 10);
    return db.prepare("SELECT id, name, client_type, province, payment_method, collections_profile, responsable_user_id FROM clients WHERE active=1").all()
      .map(c => {
        const v = ventas.get(c.id) || { base: 0, facturas: 0 };
        return { client_id: c.id, name: c.name, tipo: c.client_type, provincia: c.province,
                 forma_pago: c.payment_method, perfil: c.collections_profile,
                 responsable: nombreUsuario(db, c.responsable_user_id),
                 facturado: v.base, compras: v.facturas, deuda: clientDebt(db, c.id, hoy).total };
      });
  },
  dimensiones: {
    // FICHA D-bis — la dimensión que faltaba y que hacía imposible «¿quién me debe dinero?»: el área
    // tenía la medida «deuda» y ninguna forma de repartirla POR CLIENTE, solo por provincia o tipo.
    // Las filas ya traían el nombre; era el único hueco entre la medida y la pregunta.
    cliente:      { etiqueta: 'Cliente',         valor: f => (f.name || '').trim() || VACIO },
    tipo_cliente: { etiqueta: 'Tipo de cliente', valor: f => f.tipo || VACIO },
    provincia:    { etiqueta: 'Provincia',       valor: f => (f.provincia || '').trim() || '(sin provincia)' },
    forma_pago:   { etiqueta: 'Forma de pago',   valor: f => (f.forma_pago || '').trim() || VACIO },
    perfil_cobro: { etiqueta: 'Perfil de cobro', valor: f => f.perfil || VACIO },
    responsable:  { etiqueta: 'Responsable',     valor: f => f.responsable || SIN_ASIGNAR },
  },
  medidas: {
    clientes:     { etiqueta: 'Nº de clientes',       dinero: false },
    facturado:    { etiqueta: 'Facturación (sin IVA)', dinero: true },
    deuda:        { etiqueta: 'Deuda pendiente',      dinero: true },
    compras:      { etiqueta: 'Nº de compras',        dinero: false },
    ticket_medio: { etiqueta: 'Ticket medio',         dinero: true },
    facturacion_media: { etiqueta: 'Facturación media por cliente', dinero: true },
    deuda_media:       { etiqueta: 'Deuda media por cliente',       dinero: true },
  },
  usaPeriodo: false,
  // FICHA D-ter — «Nº de clientes» repartido por «Cliente» da un 1 en cada grupo: no dice nada, y
  // con 90 clientes son 90 barras de altura 1. Se QUITA de la lista en vez de dejar que se elija y
  // dar un error después. Se declara aquí, junto al área, porque es una propiedad suya: la medida
  // cuenta el grano y la dimensión ES el grano. Es la única del catálogo con esa forma — se buscó
  // en las seis áreas ejecutando cada par (33 dimensiones × sus medidas) y comprobando el resultado.
  sinSentido: [['cliente', 'clientes', 'daría un 1 en cada grupo']],
  nuevoAcc: clave => ({ clave, clientes: 0, facturado: 0, deuda: 0, compras: 0 }),
  sumar: (a, f) => { a.clientes++; a.facturado += Number(f.facturado) || 0; a.deuda += Number(f.deuda) || 0; a.compras += Number(f.compras) || 0; },
  salida: (a, meds) => {
    const o = { clave: a.clave };
    for (const m of meds) {
      if (m === 'clientes') o.clientes = a.clientes;
      else if (m === 'facturado') o.facturado = r2(a.facturado);
      else if (m === 'deuda') o.deuda = r2(a.deuda);
      else if (m === 'compras') o.compras = a.compras;
      // El ticket medio del GRUPO = facturación del grupo / nº de compras del grupo. NO la media de
      // medias (que pondera mal): un cliente con una compra grande no debe pesar igual que 20 chicas.
      else if (m === 'ticket_medio') o.ticket_medio = a.compras ? r2(a.facturado / a.compras) : null;
      else if (m === 'facturacion_media') o.facturacion_media = a.clientes ? r2(a.facturado / a.clientes) : null;
      else if (m === 'deuda_media') o.deuda_media = a.clientes ? r2(a.deuda / a.clientes) : null;
    }
    return o;
  },
  ordenar: 'facturado',
};

// ── ÁREA: INVENTARIO ─────────────────────────────────────────────────────────
// Grano: un MOVIMIENTO de stock. Mide FLUJO, no niveles — el nivel actual y el WAC dependen del ORDEN
// del libro (media móvil) y no se reconstruyen sumando un periodo; ya viven en Stock. Aquí: qué entró,
// qué salió, cuánto se movió.
const AREA_INVENTARIO = {
  etiqueta: 'Inventario', perm: 'inventory.read',
  filas: (db, { from = null, to = null } = {}) => {
    const where = [], params = [];
    if (from) { where.push('m.created_at >= ?'); params.push(from); }
    if (to)   { where.push('m.created_at <= ?'); params.push(to + ' 23:59:59'); }
    const sql = `SELECT m.id, m.created_at, m.type, m.quantity, m.unit_cost, m.product_id,
                        p.name AS producto, cat.name AS categoria, w.name AS almacen
                   FROM stock_movements m
                   LEFT JOIN products p ON p.id = m.product_id
                   LEFT JOIN categories cat ON cat.id = p.category_id
                   LEFT JOIN warehouses w ON w.id = m.warehouse_id`
                + (where.length ? ' WHERE ' + where.join(' AND ') : '');
    return db.prepare(sql).all(...params);
  },
  dimensiones: {
    fecha:     { etiqueta: 'Fecha',    valor: (f, o) => clavePeriodo(String(f.created_at).slice(0, 10), o.periodo || 'mes') },
    producto:  { etiqueta: 'Producto', perm: 'products.read', valor: f => f.producto || VACIO },
    categoria: { etiqueta: 'Categoría', perm: 'products.read', valor: f => f.categoria || '(sin categoría)' },
    almacen:   { etiqueta: 'Almacén',  valor: f => f.almacen || VACIO },
    tipo:      { etiqueta: 'Tipo de movimiento', valor: f => f.type || VACIO },
  },
  medidas: {
    movimientos:   { etiqueta: 'Nº de movimientos', dinero: false },
    entradas:      { etiqueta: 'Unidades entradas',  dinero: false },
    salidas:       { etiqueta: 'Unidades salidas',   dinero: false },
    neto:          { etiqueta: 'Movimiento neto (uds)', dinero: false },
    valor_movido:  { etiqueta: 'Valor movido a coste', dinero: true },
  },
  usaPeriodo: true,
  nuevoAcc: clave => ({ clave, movimientos: 0, entradas: 0, salidas: 0, neto: 0, valor_movido: 0 }),
  sumar: (a, f) => {
    const q = Number(f.quantity) || 0;
    a.movimientos++; a.neto += q;
    if (q > 0) a.entradas += q; else a.salidas += -q;
    a.valor_movido += Math.abs(q) * (Number(f.unit_cost) || 0);
  },
  salida: (a, meds) => {
    const o = { clave: a.clave };
    for (const m of meds) {
      if (m === 'movimientos') o.movimientos = a.movimientos;
      else if (m === 'entradas') o.entradas = r2(a.entradas);
      else if (m === 'salidas') o.salidas = r2(a.salidas);
      else if (m === 'neto') o.neto = r2(a.neto);
      else if (m === 'valor_movido') o.valor_movido = r2(a.valor_movido);
    }
    return o;
  },
  ordenar: 'movimientos',
};

// ── ÁREA: CONTABILIDAD ───────────────────────────────────────────────────────
// LA REGLA DE ORO: el constructor NO arma consultas contables. Se cuelga del motor del P&G
// (`cuentaPyG`) — la MISMA fuente que Libros y modelos — y solo AGRUPA sus importes. `cuentaPyG` ya
// aplica toda la regla contable UNA vez (solo grupos 6/7, importe = haber−debe, clasificación PGC).
// GRANO: (mes, partida). Se llama a `cuentaPyG` por MES (el periodo atómico) y se emite una fila por
// partida con importe ≠ 0. La contabilidad es ADITIVA sobre rangos de fecha disjuntos, así que:
//   · agrupar esas filas por FECHA (mes/trim/año) = re-agrupar meses → cuadra con el P&G del periodo.
//   · agrupar por PARTIDA = sumar los meses de cada partida = el importe del P&G de esa partida.
//   · Σ de todas las filas = Σ de las 17 partidas = `resultadoEjercicio`. IMPOSIBLE que discrepe.
// `importe` es el NETO con signo (ingreso +, gasto −); por eso "resultado" = Σ importe, "ingresos" =
// Σ de los positivos y "gastos" = Σ |negativos| — es partir los MISMOS números por su signo, no
// inventar medidas nuevas.
const _SECCION_LABEL = { explotacion: 'Explotación', financiero: 'Financiero', impuesto: 'Impuestos' };
const AREA_CONTABILIDAD = {
  etiqueta: 'Contabilidad',
  // Mismo candado que la pantalla de Libros y modelos (`contabilidad-routes.js`): invoices.read.
  perm: 'invoices.read',
  filas: (db, { from = null, to = null } = {}) => {
    const w = [], p = [];
    if (from) { w.push('entry_date >= ?'); p.push(from); }
    if (to)   { w.push('entry_date <= ?'); p.push(to); }
    const meses = db.prepare('SELECT DISTINCT substr(entry_date,1,7) m FROM ledger_entries'
                             + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY m').all(...p).map(r => r.m);
    const out = [];
    for (const mes of meses) {
      // Rango del mes, RECORTADO a [from,to] para que la suma de meses cubra EXACTAMENTE el periodo
      // pedido (ni una línea de más ni de menos → el cuadre con el P&G del rango se mantiene).
      let mFrom = mes + '-01', mTo = mes + '-31';
      if (from && from > mFrom) mFrom = from;
      if (to && to < mTo) mTo = to;
      const pyg = cuentaPyG(db, mFrom, mTo);
      for (const par of pyg.partidas) {
        if (par.importe === 0) continue;   // "sin dato no se lista" (regla común a todas las áreas)
        out.push({ mes, partida: par.nombre, seccion: par.seccion, importe: par.importe });
      }
    }
    return out;
  },
  dimensiones: {
    fecha:    { etiqueta: 'Periodo',   valor: (f, o) => clavePeriodo(f.mes + '-01', o.periodo || 'mes') },
    partida:  { etiqueta: 'Partida (P&G)', valor: f => f.partida || VACIO },
    seccion:  { etiqueta: 'Sección',   valor: f => _SECCION_LABEL[f.seccion] || f.seccion || VACIO },
  },
  medidas: {
    resultado: { etiqueta: 'Resultado (beneficio)', dinero: true },
    ingresos:  { etiqueta: 'Ingresos',              dinero: true },
    gastos:    { etiqueta: 'Gastos',                dinero: true },
    margen_pct:{ etiqueta: 'Margen sobre ingresos (%)', dinero: false, pct: true },
  },
  usaPeriodo: true,
  nuevoAcc: clave => ({ clave, resultado: 0, ingresos: 0, gastos: 0 }),
  sumar: (a, f) => {
    const imp = Number(f.importe) || 0;
    a.resultado += imp;
    if (imp >= 0) a.ingresos += imp; else a.gastos += -imp;
  },
  salida: (a, meds) => {
    const o = { clave: a.clave };
    for (const m of meds) {
      if (m === 'resultado') o.resultado = r2(a.resultado);
      else if (m === 'ingresos') o.ingresos = r2(a.ingresos);
      else if (m === 'gastos') o.gastos = r2(a.gastos);
      else if (m === 'margen_pct') o.margen_pct = a.ingresos ? r2(a.resultado / a.ingresos * 100) : null;
    }
    return o;
  },
  ordenar: 'resultado',
};

// ── ÁREA: AGENDA (ficha D · D1+D4) ───────────────────────────────────────────
// LA DECISIÓN QUE MANDA AQUÍ, y hay que leerla antes de tocar nada: **esta área tiene DOS GRANOS**,
// y por eso no todas sus medidas valen para todas las dimensiones.
//
//   · Grano CITA  → nº de citas, horas reservadas, ingresos facturados, anuladas, ausencias.
//     Se pueden repartir por cualquiera de las seis dimensiones: una cita tiene cliente, servicio,
//     persona, puesto, estado y fecha.
//   · Grano DÍA×PERSONA → horas abiertas, horas ocupadas del horario, horas libres y % de ocupación.
//     **Una hora libre no tiene cliente, ni servicio, ni sala.** Y un día ENTERO sin citas está 100 %
//     libre y no produce ninguna fila de cita, así que contándolo sobre las citas las horas libres
//     saldrían siempre de menos. Por eso estas cuatro se ofrecen SOLO al agrupar por fecha o por
//     persona (`dimsCapacidad`), que son los dos ejes donde el horario está definido. Fuera de ahí no
//     se enseñan, y si alguien las fuerza por la API, `cruzar` responde 400. Decisión de Ibrahin
//     (23 ago 2026): «ofrecerlas solo donde son ciertas».
//
// Y POR QUÉ HAY DOS MEDIDAS DE HORAS Y NO UNA. Porque hay dos cifras verdaderas y distintas, y
// elegir una en silencio metería una contradicción dentro de la propia pantalla:
//   · «Horas reservadas» = lo que suman las citas, caigan donde caigan.
//   · «Horas ocupadas del horario» = lo que esas citas consumen DENTRO del horario de trabajo.
// Medido en la agenda real el 23 ago 2026: el lunes 27-jul hay una cita de 30 min a las 16:00 y el
// negocio cierra a las 14:00 → reservadas 0,5 h · ocupadas del horario 0 h. Las dos son ciertas. El
// recorte al horario NO es un bug: sin él una cita fuera de hora haría que la ocupación pasara del
// 100 % (está escrito en `ocupacionDia`). El % de ocupación se calcula SIEMPRE con la segunda, que es
// la que cuadra con las horas abiertas.
const AGENDA_MAX_DIAS = 1100;   // ~3 años. Cota de trabajo: 365 días cuestan 167 ms medidos.

// Capacidad de UN día, desglosada POR PERSONA. `ocupacionDia` (vigia-agenda.js) hace este mismo
// recorrido pero solo devuelve el total y, de cada persona, los tramos LIBRES —y omite a quien está
// lleno—, que es justo lo que necesita el vigía y no lo que necesita agrupar por persona. Así que se
// recorre aquí con las MISMAS primitivas (`tramosPersona` + `ocupacionPersona`), no con una segunda
// lectura del horario: el horario sigue teniendo una sola implementación.
function capacidadDiaPorPersona(db, fecha) {
  const out = [];
  const personas = db.prepare('SELECT id, name FROM admin_users WHERE active=1 ORDER BY id').all();
  for (const p of personas) {
    const base = tramosPersona(db, p.id, fecha);
    if (!base.length) continue;                       // esa persona no trabaja ese día
    const dentro = interseca(ocupacionPersona(db, p.id, fecha), base);
    const abierto = base.reduce((n, [a, b]) => n + (b - a), 0);
    const ocupado = dentro.reduce((n, [a, b]) => n + (b - a), 0);
    out.push({ user_id: p.id, nombre: p.name || SIN_ASIGNAR, abierto, ocupado, libre: Math.max(0, abierto - ocupado) });
  }
  return out;
}

const AREA_AGENDA = {
  etiqueta: 'Agenda',
  // MISMO candado que la pantalla de la agenda (`routes/citas.js`): quien no puede ver la agenda no
  // ve el área, ni en el desplegable ni forzando la API. No se inventa ningún permiso nuevo.
  perm: 'citas.read',
  filas: (db, { from = null, to = null } = {}) => {
    const w = ['c.archived = 0'], p = [];
    if (from) { w.push('c.fecha >= ?'); p.push(from); }
    if (to)   { w.push('c.fecha <= ?'); p.push(to); }
    // El SERVICIO PRINCIPAL es el primero de la cadena (`orden`), y la dimensión se llama así a
    // propósito: una cita puede llevar varios servicios, y repartirla entre todos haría que «nº de
    // citas» contara la misma cita tres veces. Se cuenta entera en su servicio principal.
    const filas = db.prepare(
      `SELECT c.id, c.fecha, c.dur_min, c.estado, c.user_id, c.recurso_id, c.cliente_id,
              c.cliente_suelto_nombre, c.invoice_id, c.anulada_por,
              u.name AS persona, r.nombre AS puesto, cl.name AS cliente,
              (SELECT pr.name FROM cita_servicios cs LEFT JOIN products pr ON pr.id = cs.product_id
                WHERE cs.cita_id = c.id ORDER BY cs.orden, cs.id LIMIT 1) AS servicio
         FROM citas c
         LEFT JOIN admin_users u ON u.id = c.user_id
         LEFT JOIN recursos r    ON r.id = c.recurso_id
         LEFT JOIN clients cl    ON cl.id = c.cliente_id
        WHERE ` + w.join(' AND ')).all(...p);
    // INGRESOS: solo de facturas que CUENTAN como venta (misma regla que el área de Ventas — una
    // anulada o un ticket sustituido no son ingreso). Se toma la BASE sin IVA, como en Ventas, para
    // que las dos áreas hablen el mismo idioma.
    const cuentan = new Map(countingSalesInvoices(db, {}).map(i => [i.id, Number(i.subtotal) || 0]));
    for (const f of filas) {
      f.base_factura = (f.invoice_id && cuentan.has(f.invoice_id)) ? cuentan.get(f.invoice_id) : 0;
      f.factura_id = (f.invoice_id && cuentan.has(f.invoice_id)) ? f.invoice_id : null;
    }
    return filas;
  },
  dimensiones: {
    fecha:    { etiqueta: 'Fecha',              valor: (f, o) => clavePeriodo(f.fecha, o.periodo || 'mes') },
    cliente:  { etiqueta: 'Cliente',            perm: 'clients.read',
                valor: f => (f.cliente || f.cliente_suelto_nombre || '').trim() || '(sin cliente)' },
    servicio: { etiqueta: 'Servicio principal', valor: f => (f.servicio || '').trim() || '(sin servicio)' },
    persona:  { etiqueta: 'Quién la atiende',   valor: f => (f.persona || '').trim() || SIN_ASIGNAR },
    puesto:   { etiqueta: 'Puesto o sala',      valor: f => (f.puesto || '').trim() || '(sin puesto)' },
    estado:   { etiqueta: 'Estado de la cita',  valor: f => ESTADO_LABEL[f.estado] || f.estado || VACIO },
    // CABO 4 de la TAREA 2, cerrado del todo el 23 ago 2026. La columna `anulada_por` se guardaba
    // desde el 20 de agosto y NO se podía repartir por ella: el dato existía y no lo veía nadie.
    // Sin esto no se puede contestar «¿me anulan más los clientes o cancelo más yo?», que es justo
    // para lo que se guardó — y que es distinto del plantón (`no_show`), que no es una anulación.
    // Las etiquetas vienen de citas-engine.js, la misma lista que usa la pantalla de la agenda.
    anulada_por: { etiqueta: 'Quién anuló la cita',
      valor: f => f.estado !== 'anulada' ? '(no anulada)'
        : (ANULADA_POR_LABEL[f.anulada_por] || ANULADA_POR_SIN) },
  },
  medidas: {
    citas:            { etiqueta: 'Nº de citas',                 dinero: false },
    horas_reservadas: { etiqueta: 'Horas reservadas',            dinero: false },
    ingresos:         { etiqueta: 'Ingresos facturados (sin IVA)', dinero: true },
    anuladas:         { etiqueta: 'Citas anuladas',              dinero: false },
    ausencias:        { etiqueta: 'Ausencias (no se presentó)',  dinero: false },
    horas_abiertas:   { etiqueta: 'Horas abiertas',              dinero: false, capacidad: true },
    horas_ocupadas:   { etiqueta: 'Horas ocupadas del horario',  dinero: false, capacidad: true },
    horas_libres:     { etiqueta: 'Horas libres',                dinero: false, capacidad: true },
    ocupacion_pct:    { etiqueta: '% de ocupación',              dinero: false, pct: true, capacidad: true },
    pct_ausencias:    { etiqueta: '% de ausencias',              dinero: false, pct: true },
    duracion_media:   { etiqueta: 'Duración media de la cita (h)', dinero: false },
  },
  // Las cuatro de capacidad SOLO con estas dos dimensiones. Ver la nota de arriba.
  dimsCapacidad: ['fecha', 'persona'],
  // Y lo que no dice nada, no se ofrece: un PLANTÓN NO ES UNA ANULACIÓN, así que las dos medidas de
  // ausencias repartidas por «quién anuló» caerían enteras en «(no anulada)» — un solo grupo con
  // todo dentro. Se esconde en el desplegable y `cruzar` lo explica si alguien lo fuerza por la API.
  sinSentido: [
    ['anulada_por', 'ausencias', 'las metería TODAS en «(no anulada)», porque un plantón no es una anulación'],
    ['anulada_por', 'pct_ausencias', 'saldría 0 % en todos los grupos menos en «(no anulada)»'],
  ],
  usaPeriodo: true,
  nuevoAcc: clave => ({ clave, citas: 0, min_reservados: 0, ingresos: 0, anuladas: 0, ausencias: 0, facturas: new Set() }),
  sumar: (a, f) => {
    a.citas++;
    // Las anuladas NO reservan tiempo: es el mismo criterio que `ocupacionPersona`, que las excluye.
    // Una ausencia SÍ lo reservó (el hueco estuvo bloqueado y nadie lo pudo usar), así que cuenta.
    if (f.estado !== 'anulada') a.min_reservados += Number(f.dur_min) || 0;
    if (f.estado === 'anulada') a.anuladas++;
    if (f.estado === 'no_show') a.ausencias++;
    // Una FACTURA se cuenta UNA vez por grupo aunque la paguen dos citas: sumarla dos veces sería
    // inventar ingresos. Por eso el acumulador lleva el conjunto de facturas ya contadas.
    if (f.factura_id && !a.facturas.has(f.factura_id)) { a.facturas.add(f.factura_id); a.ingresos += f.base_factura; }
  },
  salida: (a, meds, _modo, cap) => {
    const o = { clave: a.clave };
    const h = min => r2(min / 60);
    for (const m of meds) {
      if (m === 'citas') o.citas = a.citas;
      else if (m === 'horas_reservadas') o.horas_reservadas = h(a.min_reservados);
      else if (m === 'ingresos') o.ingresos = r2(a.ingresos);
      else if (m === 'anuladas') o.anuladas = a.anuladas;
      else if (m === 'ausencias') o.ausencias = a.ausencias;
      else if (m === 'pct_ausencias') o.pct_ausencias = a.citas ? r2(a.ausencias / a.citas * 100) : null;
      else if (m === 'duracion_media') o.duracion_media = a.citas ? h(a.min_reservados / a.citas) : null;
      // Las de capacidad vienen del segundo grano. Sin capacidad para ese grupo → null, que la
      // pantalla pinta como hueco. NUNCA cero: cero significa «cerrado», y no saberlo no es cerrar.
      else if (m === 'horas_abiertas') o.horas_abiertas = cap ? h(cap.abierto) : null;
      else if (m === 'horas_ocupadas') o.horas_ocupadas = cap ? h(cap.ocupado) : null;
      else if (m === 'horas_libres')   o.horas_libres   = cap ? h(cap.libre)   : null;
      else if (m === 'ocupacion_pct')  o.ocupacion_pct  = (cap && cap.abierto > 0) ? r2(cap.ocupado / cap.abierto * 100) : null;
    }
    return o;
  },
  // LA CAPACIDAD, por grupo. Recorre DÍA A DÍA el rango que cubre el informe —incluidos los días sin
  // ninguna cita, que son justo los que más horas libres tienen— y reparte por fecha o por persona.
  // Devuelve también el rango recorrido para que el aviso lo declare: unas «horas libres» sin decir
  // de qué ventana son es una cifra sin base, y eso el CANON no lo permite.
  capacidad: (db, { from = null, to = null, periodo = 'mes', dimension = 'fecha' } = {}) => {
    const mapa = new Map();
    let desde = from, hasta = to;
    if (!desde || !hasta) {
      // Sin rango explícito, la ventana es la que abarcan las propias citas del negocio. Si no hay
      // ninguna cita, no hay ventana que recorrer y no se inventa una.
      const r = db.prepare('SELECT MIN(fecha) a, MAX(fecha) b FROM citas WHERE archived=0').get() || {};
      desde = desde || r.a; hasta = hasta || r.b;
    }
    if (!desde || !hasta) return { mapa, rango: null, recortado: false };
    const DIA = 86400000;
    let t0 = Date.parse(desde + 'T00:00:00Z'), t1 = Date.parse(hasta + 'T00:00:00Z');
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return { mapa, rango: null, recortado: false };
    let dias = Math.round((t1 - t0) / DIA) + 1;
    const recortado = dias > AGENDA_MAX_DIAS;
    if (recortado) { dias = AGENDA_MAX_DIAS; t1 = t0 + (dias - 1) * DIA; }
    const suma = (clave, c) => {
      const e = mapa.get(clave) || { abierto: 0, ocupado: 0, libre: 0 };
      e.abierto += c.abierto; e.ocupado += c.ocupado; e.libre += c.libre;
      mapa.set(clave, e);
    };
    for (let i = 0; i < dias; i++) {
      const fecha = new Date(t0 + i * DIA).toISOString().slice(0, 10);
      for (const c of capacidadDiaPorPersona(db, fecha)) {
        suma(dimension === 'persona' ? c.nombre : clavePeriodo(fecha, periodo), c);
      }
    }
    return { mapa, rango: { desde, hasta: new Date(t1).toISOString().slice(0, 10) }, recortado };
  },
  ordenar: 'citas',
};

// ── ÁREA: CATÁLOGO — la que parte del PRODUCTO y no del movimiento ───────────
// POR QUÉ EXISTE (23 ago 2026, punto 9). La pregunta doce del catálogo —«¿qué productos llevo tiempo
// sin vender?»— NO SE PODÍA CONTESTAR, y no por falta de datos: el área de Inventario tiene como
// fila un MOVIMIENTO, así que un producto que no se ha movido nunca **no produce fila** y no puede
// salir en ningún gráfico. Medido el 23 ago en `desarrollo-bamburu`: 113 productos físicos, 76 con
// movimiento, **37 invisibles**. Y justo los invisibles son la respuesta a la pregunta.
//
// EL CAMBIO DE GRANO, que es todo el asunto: aquí la fila es el PRODUCTO, y las ventas se le cuelgan.
// Un producto que no vendió nada sale con CERO, que es un dato, no un hueco. Es el mismo cambio que
// hizo falta en la agenda para poder hablar de horas libres.
//
// «PARADO» SE MIDE POR VENTAS, NO POR MOVIMIENTOS DE ALMACÉN, y es a propósito: una entrada de
// mercancía o un traslado mueven el stock y no significan que el producto se venda; y un SERVICIO no
// mueve stock jamás, así que por movimientos todos los servicios saldrían parados siempre. La fuente
// es `invoice_items` sobre las facturas que CUENTAN como venta — la misma regla que el área de
// Ventas, para que las dos digan lo mismo.
//
// OJO A LA VENTANA: las unidades y el importe son DEL PERIODO elegido, pero «cuánto lleva sin
// venderse» se mira sobre TODA la historia. Si se recortara al periodo, un producto vendido hace dos
// años parecería igual de parado que uno vendido ayer en cuanto el periodo fuera corto — y eso sería
// una respuesta falsa a la pregunta que se está haciendo.
const TRAMOS_PARADO = [
  { max: 0,    etiqueta: 'Vendido en el periodo' },
  { max: 30,   etiqueta: 'Sin vender: menos de 1 mes' },
  { max: 90,   etiqueta: 'Sin vender: 1 a 3 meses' },
  { max: 180,  etiqueta: 'Sin vender: 3 a 6 meses' },
  { max: 365,  etiqueta: 'Sin vender: 6 meses a 1 año' },
  { max: 1e9,  etiqueta: 'Sin vender: más de 1 año' },
];
const AREA_CATALOGO = {
  etiqueta: 'Catálogo',
  // Mismo candado que la pantalla de productos. Las medidas de dinero de venta piden además
  // `invoices.read`, declarado en cada una: quien no ve facturas no ve lo facturado.
  perm: 'products.read',
  filas: (db, { from = null, to = null } = {}) => {
    const prods = db.prepare(
      `SELECT p.id, p.name AS producto, p.type, p.status, p.stock, p.average_cost,
              c.name AS categoria
         FROM products p LEFT JOIN categories c ON c.id = p.category_id`
    ).all();
    // Las ventas, UNA sola vez, y con la misma regla de «qué cuenta» que el área de Ventas.
    const cuentan = countingSalesInvoices(db, {});
    const idsCuentan = new Set(cuentan.map(i => i.id));
    const fechaDe = new Map(cuentan.map(i => [i.id, String(i.issue_date).slice(0, 10)]));
    const porProd = new Map();     // product_id → { uds, importe, ultima }
    let lineas = [];
    try {
      lineas = db.prepare('SELECT invoice_id, product_id, quantity, total_price FROM invoice_items WHERE product_id IS NOT NULL').all();
    } catch { lineas = []; }
    for (const l of lineas) {
      if (!idsCuentan.has(l.invoice_id)) continue;
      const f = fechaDe.get(l.invoice_id);
      const e = porProd.get(l.product_id) || { uds: 0, importe: 0, ultima: null, udsPeriodo: 0, importePeriodo: 0 };
      if (!e.ultima || f > e.ultima) e.ultima = f;                       // TODA la historia
      e.uds += Number(l.quantity) || 0;
      e.importe += Number(l.total_price) || 0;
      const dentro = (!from || f >= from) && (!to || f <= to);           // solo el periodo
      if (dentro) { e.udsPeriodo += Number(l.quantity) || 0; e.importePeriodo += Number(l.total_price) || 0; }
      porProd.set(l.product_id, e);
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const DIA = 86400000;
    return prods.map(p => {
      const v = porProd.get(p.id) || { uds: 0, importe: 0, ultima: null, udsPeriodo: 0, importePeriodo: 0 };
      const dias = v.ultima
        ? Math.max(0, Math.round((Date.parse(hoy + 'T00:00:00Z') - Date.parse(v.ultima + 'T00:00:00Z')) / DIA))
        : null;                                                          // null = no se ha vendido NUNCA
      return {
        ...p,
        uds_periodo: v.udsPeriodo, importe_periodo: r2(v.importePeriodo),
        ultima_venta: v.ultima, dias_sin_vender: dias,
        vendido_en_periodo: v.udsPeriodo > 0,
        valor_stock: r2((Number(p.stock) || 0) * (Number(p.average_cost) || 0)),
      };
    });
  },
  dimensiones: {
    // LA DIMENSIÓN DE LA PREGUNTA 12. «Nunca se ha vendido» es un grupo aparte y no se mezcla con
    // «más de un año»: son cosas distintas, y juntarlas escondería justo la peor.
    parado: {
      etiqueta: 'Cuánto lleva sin venderse',
      valor: f => {
        if (f.vendido_en_periodo) return TRAMOS_PARADO[0].etiqueta;
        if (f.dias_sin_vender == null) return 'No se ha vendido nunca';
        return (TRAMOS_PARADO.find(t => f.dias_sin_vender <= t.max) || TRAMOS_PARADO[TRAMOS_PARADO.length - 1]).etiqueta;
      },
    },
    producto:  { etiqueta: 'Producto',  valor: f => (f.producto || '').trim() || VACIO },
    categoria: { etiqueta: 'Categoría', valor: f => (f.categoria || '').trim() || '(sin categoría)' },
    tipo:      { etiqueta: 'Bien o servicio', valor: f => f.type === 'service' ? 'Servicio' : (f.type === 'digital' ? 'Digital' : 'Bien físico') },
    estado:    { etiqueta: 'Estado en el catálogo', valor: f => f.status === 'archived' ? 'Archivado' : 'Activo' },
  },
  medidas: {
    productos:      { etiqueta: 'Nº de productos',              dinero: false },
    uds_vendidas:   { etiqueta: 'Unidades vendidas',            dinero: false, perm: 'invoices.read' },
    importe:        { etiqueta: 'Facturado (sin IVA)',          dinero: true,  perm: 'invoices.read' },
    stock_actual:   { etiqueta: 'Stock actual (uds)',           dinero: false, perm: 'inventory.read' },
    valor_stock:    { etiqueta: 'Valor del stock a coste',      dinero: true,  perm: 'inventory.read' },
    dias_medios:    { etiqueta: 'Días sin venderse (media)',    dinero: false },
  },
  // Repartir «nº de productos» por «Producto» daría un 1 en cada grupo, como en Clientes.
  sinSentido: [['producto', 'productos', 'daría un 1 en cada grupo']],
  usaPeriodo: false,
  nuevoAcc: clave => ({ clave, productos: 0, uds: 0, importe: 0, stock: 0, valor: 0, diasSuma: 0, diasN: 0 }),
  sumar: (a, f) => {
    a.productos++;
    a.uds += Number(f.uds_periodo) || 0;
    a.importe += Number(f.importe_periodo) || 0;
    a.stock += Number(f.stock) || 0;
    a.valor += Number(f.valor_stock) || 0;
    // Los que no se han vendido NUNCA no entran en la media: no tienen un «cuántos días» que
    // promediar, y meterlos con un número inventado (¿la edad del producto? ¿cero?) sería mentir.
    if (f.dias_sin_vender != null) { a.diasSuma += f.dias_sin_vender; a.diasN++; }
  },
  salida: (a, meds) => {
    const o = { clave: a.clave };
    for (const m of meds) {
      if (m === 'productos') o.productos = a.productos;
      else if (m === 'uds_vendidas') o.uds_vendidas = r2(a.uds);
      else if (m === 'importe') o.importe = r2(a.importe);
      else if (m === 'stock_actual') o.stock_actual = r2(a.stock);
      else if (m === 'valor_stock') o.valor_stock = r2(a.valor);
      else if (m === 'dias_medios') o.dias_medios = a.diasN ? Math.round(a.diasSuma / a.diasN) : null;
    }
    return o;
  },
  ordenar: 'productos',
};

export const AREAS = { ventas: AREA_VENTAS, compras: AREA_COMPRAS, clientes: AREA_CLIENTES, inventario: AREA_INVENTARIO, contabilidad: AREA_CONTABILIDAD, agenda: AREA_AGENDA, catalogo: AREA_CATALOGO };

// El permiso BASE de un área (para que las rutas no tengan que conocer el registro). null si no existe.
export function areaPerm(area) { return AREAS[area]?.perm || null; }

// Alias históricos (el gate del paso 4a los importa). Apuntan a Ventas, que es donde nació el motor.
export const DIMENSIONES = AREA_VENTAS.dimensiones;
export const MEDIDAS = AREA_VENTAS.medidas;

// ── EL CATÁLOGO EN CRISTIANO ─────────────────────────────────────────────────
// Qué áreas puede el usuario, y dentro de cada una qué campos. `hasPerm` gatea: un área sin su permiso
// base NO se ofrece, y dentro, un campo con `perm` propio se esconde si no lo tiene. Es cortesía: el
// servidor lo revalida en `cruzar` — el desplegable filtrado nunca es el candado.
// ── FICHA D-ter · PARTE 2 — EL PERIODO, que no existía ────────────────────────────────────────
// Hasta hoy no había forma de decir «este año»: los informes salían con TODO el histórico, y eso es
// lo que convertía Contabilidad en cuarenta barras a cero y sacaba a pasear un grupo con fecha del
// año 2000 (el stock de apertura). Los rangos se calculan AQUÍ, en el servidor, para que la fecha
// del navegador del usuario no pueda dar un informe distinto del que sale en el papel.
//
// POR DEFECTO: `12m`, los últimos doce meses. NUNCA el histórico entero.
export const RANGOS = {
  '12m':       'Últimos 12 meses',
  mes:         'Este mes',
  trimestre:   'Este trimestre',
  anio:        'Este año',
  anio_pasado: 'El año pasado',
  todo:        'Todo el histórico',
  entre:       'Entre dos fechas',
};
export const RANGO_POR_DEFECTO = '12m';
const iso = d => d.toISOString().slice(0, 10);
export function rangoDeFechas(clave, { desde = null, hasta = null, hoy = new Date() } = {}) {
  const y = hoy.getUTCFullYear(), m = hoy.getUTCMonth();
  switch (clave) {
    case 'mes':         return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(hoy) };
    case 'trimestre':   return { from: iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to: iso(hoy) };
    case 'anio':        return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(hoy) };
    case 'anio_pasado': return { from: iso(new Date(Date.UTC(y - 1, 0, 1))), to: iso(new Date(Date.UTC(y - 1, 11, 31))) };
    case 'todo':        return { from: null, to: null };
    case 'entre':       return { from: desde || null, to: hasta || null };
    // 12m y cualquier cosa rara: los últimos doce meses. Nunca el histórico por accidente.
    default:            return { from: iso(new Date(Date.UTC(y, m - 11, 1))), to: iso(hoy) };
  }
}
export function etiquetaRango(clave, { desde = null, hasta = null } = {}) {
  if (clave === 'entre') return 'Entre ' + (desde || '…') + ' y ' + (hasta || '…');
  return RANGOS[clave] || RANGOS[RANGO_POR_DEFECTO];
}

export function areasPara(hasPerm) {
  const out = {};
  for (const [k, a] of Object.entries(AREAS)) if (!a.perm || hasPerm(a.perm)) out[k] = { etiqueta: a.etiqueta };
  return out;
}
// `modo` es el ajuste de margen de la empresa (G2). Se usa SOLO para nombrar la medida "Margen %"
// con su base: un porcentaje llamado "Margen %" a secas es exactamente el fallo que esta tarea viene
// a cerrar. La cuenta no cambia por esto; el nombre, sí.
// FICHA D-ter — LAS MEDIDAS PROPIAS. Tres piezas elegidas de listas, nunca una expresión escrita.
// `op` se valida contra esta tabla cerrada: lo que no esté aquí no se calcula.
export const OPERACIONES = {
  '/': { etiqueta: 'dividido entre', calc: (a, b) => (b ? a / b : null) },
  '-': { etiqueta: 'menos',          calc: (a, b) => a - b },
  '+': { etiqueta: 'más',            calc: (a, b) => a + b },
  '*': { etiqueta: 'por',            calc: (a, b) => a * b },
};
export function listarMedidasPropias(db, userId, area = null) {
  const w = area ? ' AND area=?' : '';
  const args = area ? [userId, area] : [userId];
  return db.prepare('SELECT id,area,nombre,medida_a,op,medida_b,por_cien FROM analytics_medidas WHERE user_id=?' + w + ' ORDER BY id').all(...args)
    .map(m => ({ ...m, clave: 'propia_' + m.id, por_cien: !!m.por_cien }));
}
export function guardarMedidaPropia(db, userId, { area, nombre, medida_a, op, medida_b, por_cien }) {
  const A = AREAS[area];
  if (!A) { const e = new Error('Esa área no existe'); e.status = 400; throw e; }
  const n = String(nombre || '').trim();
  if (!n) { const e = new Error('Ponle un nombre a tu medida'); e.status = 400; throw e; }
  if (!A.medidas[medida_a] || !A.medidas[medida_b]) { const e = new Error('Elige dos medidas del área'); e.status = 400; throw e; }
  if (!OPERACIONES[op]) { const e = new Error('Esa operación no existe'); e.status = 400; throw e; }
  // Una medida de CAPACIDAD solo vale en dos dimensiones: mezclarla en una propia la haría aparecer
  // en todas, y eso es justo el número inventado que el área de Agenda evita.
  if (A.medidas[medida_a].capacidad || A.medidas[medida_b].capacidad) {
    const e = new Error('Las medidas del horario (horas abiertas, libres, ocupadas y % de ocupación) no se pueden combinar: solo valen repartidas por fecha o por persona.');
    e.status = 400; throw e;
  }
  const r = db.prepare('INSERT INTO analytics_medidas (user_id,area,nombre,medida_a,op,medida_b,por_cien) VALUES (?,?,?,?,?,?,?)')
    .run(userId, area, n, medida_a, op, medida_b, por_cien ? 1 : 0);
  return { id: r.lastInsertRowid };
}
export function borrarMedidaPropia(db, userId, id) {
  const r = db.prepare('DELETE FROM analytics_medidas WHERE id=? AND user_id=?').run(id, userId);
  if (!r.changes) { const e = new Error('Esa medida no existe'); e.status = 404; throw e; }
  return { ok: true };
}

export function camposPara(hasPerm, areaKey = 'ventas', modo = MODO_POR_DEFECTO, propias = []) {
  const a = AREAS[areaKey]; if (!a) return { dimensiones: {}, medidas: {}, graficos: TIPOS_GRAFICO };
  const usa = MODOS[modo] ? modo : MODO_POR_DEFECTO;
  const dims = {}, meds = {};
  for (const [k, d] of Object.entries(a.dimensiones)) if (!d.perm || hasPerm(d.perm)) dims[k] = { etiqueta: d.etiqueta };
  for (const [k, m] of Object.entries(a.medidas)) {
    // EL CANDADO POR MEDIDA (23 ago 2026, punto 9). Hasta hoy solo las DIMENSIONES podían pedir un
    // permiso; una medida con `perm` lo declaraba y no lo comprobaba nadie — un candado que parece
    // un candado y no lo es, que es peor que no tenerlo. Lo estrena el área de Catálogo: se ve
    // el catálogo con `products.read`, pero lo FACTURADO exige además `invoices.read`.
    // Esto es la cortesía del desplegable; el candado de verdad está en `cruzar`, abajo.
    if (m.perm && !hasPerm(m.perm)) continue;
    // FICHA D-bis — el titular de la medida es «Margen en %» (que es lo que es) y su BASE va en la
    // ayuda, no pegada al nombre: «Margen sobre lo que te costó» se leía como otra medida distinta
    // de «Beneficio (margen)». La base no se pierde — sigue enseñándose, debajo.
    const etiqueta = k === 'margenPct' ? 'Margen en %' : m.etiqueta;
    meds[k] = { etiqueta, dinero: !!m.dinero, pct: !!m.pct };
    if (k === 'margenPct') meds[k].ayuda = 'calculado ' + MODOS[usa].sufijo;
    // FICHA D — una medida de CAPACIDAD solo es cierta en algunas dimensiones (ver AREA_AGENDA).
    // Se declara aquí para que el desplegable la esconda donde no vale. Es cortesía: el candado de
    // verdad está en `cruzar`, que responde 400 si alguien fuerza la combinación por la API.
    if (m.capacidad) meds[k].soloCon = a.dimsCapacidad || [];
    // FICHA D-ter — y las que no dicen nada se declaran para que el desplegable las esconda en
    // esa dimensión concreta, en vez de dejar elegirlas y contestar con un error.
    const nunca = (a.sinSentido || []).filter(([, mk]) => mk === k).map(([dk]) => dk);
    if (nunca.length) meds[k].nuncaCon = nunca;
  }
  // Las propias del usuario entran como una medida más de «quiero saber», ya calculada.
  for (const p of (propias || [])) {
    if (p.area !== areaKey) continue;
    if (!a.medidas[p.medida_a] || !a.medidas[p.medida_b]) continue;   // el área cambió: se ignora
    meds[p.clave] = { etiqueta: p.nombre, dinero: false, pct: !!p.por_cien, propia: true,
      ayuda: (a.medidas[p.medida_a].etiqueta) + ' ' + (OPERACIONES[p.op] || {}).etiqueta + ' '
             + (a.medidas[p.medida_b].etiqueta) + (p.por_cien ? ' por cien' : '') };
  }
  return { dimensiones: dims, medidas: meds, graficos: TIPOS_GRAFICO, usaPeriodo: !!a.usaPeriodo, modoMargen: usa };
}

// ── EL CRUCE ─────────────────────────────────────────────────────────────────
// Genérico: agrupa las filas del área por la dimensión y acumula las medidas con los ganchos del área.
// `area` por defecto 'ventas' → los llamadores del paso 4a (sin `area`) siguen funcionando igual.
export function cruzar(db, { area = 'ventas', dimension = 'fecha', medidas = ['base'], periodo = 'mes',
                            filtros = {}, from = null, to = null, limit = 100, formula = null, hasPerm,
                            // FICHA D-ter — el RANGO con nombre. Si viene, manda sobre from/to.
                            rango = null, desde = null, hasta = null, propias = [] } = {}) {
  if (rango) { const r = rangoDeFechas(rango, { desde, hasta }); from = r.from; to = r.to; }
  // G2 — qué porcentaje manda como TITULAR en esta empresa. No cambia ninguna cuenta: `margen` sigue
  // llevando las dos cifras en cada fila; esto solo decide cuál se copia a `margenPct`.
  const modoMargen = modoDeEmpresa(db);
  const A = AREAS[area];
  if (!A) { const e = new Error('No conozco el área "' + area + '"'); e.status = 400; throw e; }
  if (A.perm && hasPerm && !hasPerm(A.perm)) { const e = new Error('No tienes permiso para el área ' + A.etiqueta.toLowerCase()); e.status = 403; throw e; }
  const dim = A.dimensiones[dimension];
  if (!dim) { const e = new Error('No sé cruzar "' + area + '" por "' + dimension + '"'); e.status = 400; throw e; }
  // Lo que no dice nada no se contesta: se explica. (El desplegable ya no lo ofrece; esto es el cierre.)
  // Cada pareja puede traer SU motivo: no todas fallan igual. «Nº de clientes» por «Cliente» da un 1
  // en cada grupo; «Ausencias» por «Quién anuló» las mete TODAS en un mismo grupo. Decir lo primero
  // cuando pasa lo segundo es una ayuda que miente, que es justo lo que arregló la ficha D-ter.
  for (const [dk, mk, porQue] of (A.sinSentido || [])) {
    if (dimension === dk && (Array.isArray(medidas) ? medidas : [medidas]).includes(mk)) {
      const e = new Error('«' + A.medidas[mk].etiqueta + '» repartido por «' + A.dimensiones[dk].etiqueta
        + '» ' + (porQue || 'daría un 1 en cada grupo')
        + ': no dice nada. Elige otra cosa que medir, o reparte por otro campo.');
      e.status = 400; throw e;
    }
  }
  if (dim.perm && hasPerm && !hasPerm(dim.perm)) { const e = new Error('No tienes permiso para cruzar por ' + dim.etiqueta.toLowerCase()); e.status = 403; throw e; }
  // Y el mismo candado para las MEDIDAS que lo pidan. Falla CERRADO: si se pide una medida sin su
  // permiso, no se calcula y se dice — no se devuelve un cero, que se leería como «no hay nada».
  for (const mk of (Array.isArray(medidas) ? medidas : [medidas])) {
    const md = A.medidas[mk];
    if (md && md.perm && hasPerm && !hasPerm(md.perm)) {
      const e = new Error('No tienes permiso para ver «' + md.etiqueta + '»'); e.status = 403; throw e;
    }
  }
  // FICHA D-ter — las MEDIDAS PROPIAS del usuario. No son del catálogo del área, así que se resuelven
  // aparte: se piden sus dos ingredientes al motor y la cuenta se hace al final, con la operación de
  // la tabla cerrada `OPERACIONES`. No se interpreta ninguna expresión.
  const pedidas = (Array.isArray(medidas) ? medidas : [medidas]);
  const propiasPedidas = (propias || []).filter(p => p.area === area && pedidas.includes(p.clave)
    && A.medidas[p.medida_a] && A.medidas[p.medida_b] && OPERACIONES[p.op]);
  const ingredientes = [...new Set(propiasPedidas.flatMap(p => [p.medida_a, p.medida_b]))];
  const meds = [...new Set(pedidas.filter(m => A.medidas[m]).concat(ingredientes))];
  if (!meds.length) { const e = new Error('Elige al menos una medida'); e.status = 400; throw e; }
  // FICHA D — EL CANDADO DE LAS MEDIDAS DE CAPACIDAD. Una hora libre no tiene cliente ni servicio:
  // pedirla agrupada por ahí no es un error del usuario, es una pregunta sin respuesta. Se contesta
  // diciendo POR QUÉ y con qué sí se puede, en vez de devolver un número inventado o un cero.
  const dimsCap = A.dimsCapacidad || [];
  const capPedida = meds.filter(m => A.medidas[m].capacidad);
  if (capPedida.length && !dimsCap.includes(dimension)) {
    const nombres = capPedida.map(m => '«' + A.medidas[m].etiqueta + '»').join(', ');
    const validas = dimsCap.map(d => '«' + (A.dimensiones[d]?.etiqueta || d).toLowerCase() + '»').join(' o ');
    const e = new Error(nombres + ' se mide sobre el horario del negocio, no sobre cada cita: una hora '
      + 'libre no tiene ' + (A.dimensiones[dimension]?.etiqueta || dimension).toLowerCase()
      + '. Agrúpalo por ' + validas + '.');
    e.status = 400; throw e;
  }
  // PASO 4b — cálculo propio: se compila UNA vez (valida contra las medidas del área o lanza 400) y se
  // evalúa por grupo. Para evaluarlo hacen falta TODAS las medidas del grupo, aunque el usuario solo
  // pinte el cálculo — por eso se calculan todas cuando hay fórmula.
  const rpn = formula ? compilarFormula(formula, Object.keys(A.medidas)) : null;
  const medsSalida = rpn ? Object.keys(A.medidas) : meds;
  for (const k of Object.keys(filtros || {})) {
    const d = A.dimensiones[k];
    if (!d) { const e = new Error('No sé filtrar por "' + k + '"'); e.status = 400; throw e; }
    // Filtrar por un campo que no puedes ver sería deducir el dato acotando y mirando el total.
    if (d.perm && hasPerm && !hasPerm(d.perm)) { const e = new Error('No tienes permiso para filtrar por ' + d.etiqueta.toLowerCase()); e.status = 403; throw e; }
  }

  const opts = { periodo };
  const map = new Map();
  for (const f of A.filas(db, { from, to })) {
    let fuera = false;
    for (const [k, vals] of Object.entries(filtros || {})) {
      if (!Array.isArray(vals) || !vals.length) continue;
      if (!vals.includes(String(A.dimensiones[k].valor(f, opts)))) { fuera = true; break; }
    }
    if (fuera) continue;
    const clave = String(dim.valor(f, opts));
    const acc = map.get(clave) || A.nuevoAcc(clave);
    A.sumar(acc, f);
    map.set(clave, acc);
  }

  // FICHA D — EL SEGUNDO GRANO. Si el área tiene capacidad y la dimensión la admite, se calcula
  // aparte y se une: un día ABIERTO Y SIN NINGUNA CITA no produce fila arriba y es justo el que más
  // horas libres tiene, así que su grupo se crea aquí o no existiría. Las áreas sin `capacidad` no
  // pasan por nada de esto.
  let cap = null;
  if (A.capacidad && dimsCap.includes(dimension) && (capPedida.length || rpn)) {
    cap = A.capacidad(db, { from, to, periodo, dimension });
    for (const clave of cap.mapa.keys()) if (!map.has(clave)) map.set(clave, A.nuevoAcc(clave));
  }

  const filas = [...map.values()].map(acc => {
    const fila = A.salida(acc, medsSalida, modoMargen, cap ? cap.mapa.get(acc.clave) : null);
    if (rpn) fila.calculo = evalRPN(rpn, fila);   // el cálculo propio, sobre las medidas del grupo
    for (const p of propiasPedidas) {
      const a1 = Number(fila[p.medida_a]), b1 = Number(fila[p.medida_b]);
      const v1 = (Number.isFinite(a1) && Number.isFinite(b1)) ? OPERACIONES[p.op].calc(a1, b1) : null;
      fila[p.clave] = v1 == null ? null : r2(v1 * (p.por_cien ? 100 : 1));
    }
    return fila;
  });
  // FICHA D-ter — UN GRUPO VACÍO NO SE PINTA. Un mes sin nada no ocupa sitio en el eje. Se mide
  // sobre las medidas PEDIDAS: si todas son nulas o cero, el grupo no aporta. (Un null es «no se
  // sabe» y un 0 es «nada»: en los dos casos la barra no existe y solo estorba.) La única excepción
  // es que TODOS los grupos estén vacíos — entonces se dejan, porque «todo a cero» sí es una
  // respuesta y borrarla dejaría un lienzo mudo sin explicar.
  const mirar = pedidas.filter(m => A.medidas[m] || propiasPedidas.some(p => p.clave === m));
  const conAlgo = filas.filter(f => (mirar.length ? mirar : meds).some(m => f[m] != null && Number(f[m]) !== 0));
  const filasFinales = conAlgo.length ? conAlgo : filas;
  const vacios = filas.length - filasFinales.length;
  filas.length = 0; filas.push(...filasFinales);
  const ord = rpn ? 'calculo' : A.ordenar;
  // Por fecha, orden cronológico (una serie temporal desordenada no es una serie). Por lo demás, de
  // mayor a menor según la medida de referencia del área (ranking).
  filas.sort((a, b) => dimension === 'fecha' ? (a.clave < b.clave ? -1 : 1) : ((b[ord] ?? 0) - (a[ord] ?? 0)));

  return {
    area, dimension, dimensionEtiqueta: dim.etiqueta,
    // Se devuelven las que el usuario PIDIÓ, no los ingredientes que hubo que calcular por dentro.
    medidas: pedidas.filter(m => A.medidas[m] || propiasPedidas.some(p => p.clave === m)),
    periodo, usaPeriodo: !!A.usaPeriodo,
    calculo: !!rpn,
    // Lo que se recortó y con qué ventana, para que la pantalla y el papel lo puedan declarar.
    gruposVacios: vacios,
    rango: rango || null,
    rangoEtiqueta: rango ? etiquetaRango(rango, { desde, hasta }) : null,
    ventana: (from || to) ? { desde: from, hasta: to } : null,
    filas: filas.slice(0, limit), truncado: filas.length > limit,
    aviso: A.aviso ? A.aviso(map, meds) : null,
    // La ventana que se recorrió para la capacidad. Unas «horas libres» sin decir de qué periodo son
    // es una cifra sin base, y el CANON exige que toda cifra declare la suya.
    capacidad: cap && cap.rango ? { desde: cap.rango.desde, hasta: cap.rango.hasta, recortado: !!cap.recortado } : null,
  };
}

// ── PASO 4b · CÁLCULOS PROPIOS — evaluador SEGURO (sin eval) ──────────────────
// El usuario escribe una fórmula sobre las medidas de su área ("beneficio / base * 100",
// "pendiente / base"). NO se usa `eval` ni `new Function` — el proyecto no los usa en NINGÚN sitio y
// no los introduzco: una fórmula es texto del usuario, y `eval` sobre texto del usuario es ejecución
// de código arbitrario en el servidor. Se tokeniza, se valida contra la lista de medidas del área
// (una variable que no sea una medida conocida → 400), y se evalúa con un mini-intérprete de
// aritmética (+ − × ÷ y paréntesis). Se compila UNA vez (a RPN) y se evalúa por grupo.
const _PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };
export function compilarFormula(expr, medidasValidas) {
  const src = String(expr || '').trim();
  if (!src) { const e = new Error('La fórmula está vacía'); e.status = 400; throw e; }
  if (src.length > 200) { const e = new Error('La fórmula es demasiado larga'); e.status = 400; throw e; }
  const toks = src.match(/\s*([0-9]*\.?[0-9]+|[a-zA-Z_][a-zA-Z0-9_]*|[()+\-*/])\s*/g);
  // Reconstruir sin espacios y comprobar que NADA quedó fuera (un carácter raro no matchea).
  if (!toks || toks.map(t => t.trim()).join('') !== src.replace(/\s+/g, '')) {
    const e = new Error('La fórmula tiene caracteres que no entiendo (usa medidas, números y + − × ÷)'); e.status = 400; throw e;
  }
  const out = [], ops = [];
  for (let raw of toks) {
    const t = raw.trim();
    if (/^[0-9]*\.?[0-9]+$/.test(t)) out.push({ n: Number(t) });
    else if (/^[a-zA-Z_]/.test(t)) {
      if (!medidasValidas.includes(t)) { const e = new Error('"' + t + '" no es una medida de esta área'); e.status = 400; throw e; }
      out.push({ v: t });
    } else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push({ op: ops.pop() });
      if (!ops.length) { const e = new Error('Paréntesis sin cerrar en la fórmula'); e.status = 400; throw e; }
      ops.pop();
    } else { // operador
      while (ops.length && ops[ops.length - 1] !== '(' && _PREC[ops[ops.length - 1]] >= _PREC[t]) out.push({ op: ops.pop() });
      ops.push(t);
    }
  }
  while (ops.length) { const o = ops.pop(); if (o === '(') { const e = new Error('Paréntesis sin cerrar en la fórmula'); e.status = 400; throw e; } out.push({ op: o }); }
  // El RPN tiene que estar COMPLETO: cada número/medida aporta 1 a la pila, cada operador consume 2 y
  // deja 1. Si "base / " se colara, daría null en silencio en cada grupo — el usuario merece un aviso
  // claro ("fórmula incompleta"), no una serie muda de ceros.
  let prof = 0;
  for (const t of out) { prof += ('op' in t) ? -1 : 1; if (prof < 1) { const e = new Error('La fórmula está incompleta'); e.status = 400; throw e; } }
  if (prof !== 1) { const e = new Error('La fórmula está incompleta'); e.status = 400; throw e; }
  return out;   // RPN
}
// Evalúa el RPN con los valores de un grupo. Un valor NULL (medida sin dato, p. ej. margen sin coste)
// hace la fórmula NULL: no se inventa un 0. Dividir por 0 → null, no Infinity (un gráfico con Infinity
// no dice nada).
function evalRPN(rpn, valores) {
  const st = [];
  for (const t of rpn) {
    if ('n' in t) st.push(t.n);
    else if ('v' in t) { const x = valores[t.v]; if (x == null) return null; st.push(Number(x)); }
    else {
      const b = st.pop(), a = st.pop();
      if (a == null || b == null) return null;
      let r; if (t.op === '+') r = a + b; else if (t.op === '-') r = a - b; else if (t.op === '*') r = a * b;
      else { if (b === 0) return null; r = a / b; }
      st.push(r);
    }
  }
  return st.length === 1 ? st[0] : null;
}

// ── PASO 4b · COMBINAR FUENTES — comparar áreas EN EL TIEMPO ──────────────────
// La única dimensión común a ventas/compras/inventario es la FECHA. "Combinar" NO es sumar granos
// distintos (una línea de venta y una factura de compra no se suman): es poner cada área como su
// PROPIA SERIE sobre el mismo eje temporal — "facturación vs gasto por mes". Cada serie se calcula por
// el `cruzar` de SU área (regla intacta), y se alinean por periodo. Clientes NO entra: no tiene fecha.
// `modo` nombra "Margen %" con su base, igual que `camposPara`. Un desplegable de comparación que
// ofrece "Margen %" a secas vuelve a dejar el porcentaje desnudo en el gráfico que salga de él.
export function areasComparables(modo = MODO_POR_DEFECTO) {
  const usa = MODOS[modo] ? modo : MODO_POR_DEFECTO;
  const nombre = (mk, m) => mk === 'margenPct' ? 'Margen ' + MODOS[usa].sufijo : m.etiqueta;
  return Object.entries(AREAS).filter(([, a]) => a.usaPeriodo && a.dimensiones.fecha)
    .map(([k, a]) => ({ area: k, etiqueta: a.etiqueta,
      medidas: Object.fromEntries(Object.entries(a.medidas).map(([mk, m]) => [mk, { etiqueta: nombre(mk, m), dinero: !!m.dinero }])) }));
}
export function compararEnTiempo(db, { series = [], periodo = 'mes', from = null, to = null, hasPerm } = {}) {
  if (!Array.isArray(series) || series.length < 2) { const e = new Error('Elige al menos dos series para comparar'); e.status = 400; throw e; }
  if (series.length > 6) { const e = new Error('Como mucho 6 series a la vez'); e.status = 400; throw e; }
  const claves = new Set();
  const resueltas = series.map(s => {
    const A = AREAS[s.area];
    if (!A || !A.usaPeriodo || !A.dimensiones.fecha) { const e = new Error('El área "' + s.area + '" no se puede comparar en el tiempo'); e.status = 400; throw e; }
    // cruzar() revalida el permiso del área — comparar no es una puerta trasera.
    const r = cruzar(db, { area: s.area, dimension: 'fecha', medidas: [s.medida], periodo, from, to, limit: 100000, hasPerm });
    const meta = A.medidas[s.medida] || {};
    const porClave = new Map(r.filas.map(f => [f.clave, f[s.medida]]));
    r.filas.forEach(f => claves.add(f.clave));
    return { area: s.area, medida: s.medida, etiqueta: A.etiqueta + ' · ' + (meta.etiqueta || s.medida), dinero: !!meta.dinero, porClave };
  });
  const labels = [...claves].sort();
  return {
    periodo, labels,
    series: resueltas.map(s => ({ etiqueta: s.etiqueta, area: s.area, medida: s.medida, dinero: s.dinero,
      // null donde esa área no tiene dato ese periodo: un hueco es la verdad, un 0 sería una afirmación.
      datos: labels.map(k => s.porClave.has(k) ? s.porClave.get(k) : null) })),
  };
}

// ── PANELES GUARDADOS ────────────────────────────────────────────────────────
// De QUIEN LOS CREA (decisión del dueño). Compartir es el paso 4b.
// Guardan la RECETA (qué área, qué cruzar), NO los datos: al abrirlos se vuelve a pasar por `cruzar`,
// que revalida los permisos de HOY. Si guardara resultados, un panel sería una fuga con fecha.
// FICHA D · PARTE 3 — `esDueno` abre la puerta que faltaba: hasta hoy el `WHERE user_id=?` hacía que
// un informe compartido por alguien que se fue del negocio no lo pudiera tocar NADIE, ni el dueño.
// Regla de Ibrahin: «cada uno solo lo puede hacer quien lo creó, SALVO EL DUEÑO». El dueño no se cuela
// por el mismo sitio: se le quita la condición del WHERE, no se le regala el `user_id` de otro.
export function guardarPanel(db, userId, { id = null, nombre, config, compartido = null }, esDueno = false) {
  const n = String(nombre || '').trim();
  if (!n) { const e = new Error('El panel necesita un nombre'); e.status = 400; throw e; }
  const area = (config && config.area) || 'ventas';   // por defecto ventas (compat. paso 4a)
  const A = AREAS[area];
  if (!A) { const e = new Error('El panel apunta a un área que no existe'); e.status = 400; throw e; }
  // Un panel es de dimensión O de comparación (varias series). Se valida el que sea.
  const esComparar = config && config.modo === 'comparar';
  if (esComparar) {
    if (!Array.isArray(config.series) || config.series.length < 2) { const e = new Error('Una comparación necesita al menos dos series'); e.status = 400; throw e; }
  } else if (!config || !A.dimensiones[config.dimension]) { const e = new Error('El panel necesita una dimensión válida de su área'); e.status = 400; throw e; }
  if (!TIPOS_GRAFICO.includes(config.grafico || 'tabla')) { const e = new Error('Ese tipo de gráfico no existe'); e.status = 400; throw e; }
  // Si trae fórmula, se COMPILA aquí para no guardar una receta rota que reventaría al abrirla.
  if (config.formula) compilarFormula(config.formula, Object.keys(A.medidas));
  const json = JSON.stringify({ ...config, area });
  if (id) {
    // El WHERE lleva el user_id: sin él, cambiar el id en la petición editaría el panel de otro.
    const set = compartido == null ? 'nombre=?, config=?, updated_at=CURRENT_TIMESTAMP'
                                   : 'nombre=?, config=?, compartido=?, updated_at=CURRENT_TIMESTAMP';
    const where = esDueno ? 'WHERE id=?' : 'WHERE id=? AND user_id=?';
    const cola = esDueno ? [id] : [id, userId];
    const args = compartido == null ? [n, json, ...cola] : [n, json, compartido ? 1 : 0, ...cola];
    const r = db.prepare('UPDATE analytics_panels SET ' + set + ' ' + where).run(...args);
    if (!r.changes) { const e = new Error('Panel no encontrado'); e.status = 404; throw e; }
    return { id: Number(id) };
  }
  const r = db.prepare('INSERT INTO analytics_panels (user_id, nombre, config, compartido) VALUES (?,?,?,?)').run(userId, n, json, compartido ? 1 : 0);
  return { id: r.lastInsertRowid };
}

// Devuelve los panels PROPIOS + los COMPARTIDOS por otros. `propio`/`autor` para que la pantalla sepa
// cuáles puede editar. Abrir un compartido re-cruza (revalida permisos): compartir la receta no filtra.
export function listarPaneles(db, userId) {
  return db.prepare(
    `SELECT p.id, p.nombre, p.config, p.created_at, p.compartido, p.user_id,
            (p.user_id = ?) AS propio, u.name AS autor
       FROM analytics_panels p LEFT JOIN admin_users u ON u.id = p.user_id
      WHERE p.user_id = ? OR p.compartido = 1
      ORDER BY propio DESC, p.id`
  ).all(userId, userId).map(p => {
    let config = null; try { config = JSON.parse(p.config); } catch {}
    return { id: p.id, nombre: p.nombre, created_at: p.created_at, config,
             compartido: !!p.compartido, propio: !!p.propio, autor: p.propio ? null : (p.autor || null) };
  });
}

export function borrarPanel(db, userId, id, esDueno = false) {
  const r = esDueno
    ? db.prepare('DELETE FROM analytics_panels WHERE id=?').run(id)
    : db.prepare('DELETE FROM analytics_panels WHERE id=? AND user_id=?').run(id, userId);
  if (!r.changes) { const e = new Error('Panel no encontrado'); e.status = 404; throw e; }
  return { ok: true };
}

// Un panel por id, con la MISMA regla de visibilidad que `listarPaneles` (el mío, o uno compartido).
// Lo necesita el papel imprimible: la ruta recibe un id y tiene que resolver la receta sin fiarse de
// lo que venga por la URL. Devuelve null si no existe o no es visible para ese usuario.
export function panelVisible(db, userId, id) {
  const p = db.prepare('SELECT id, nombre, config, user_id, compartido FROM analytics_panels WHERE id=?').get(id);
  if (!p) return null;
  if (p.user_id !== userId && !p.compartido) return null;
  let config = null; try { config = JSON.parse(p.config); } catch {}
  if (!config) return null;
  return { id: p.id, nombre: p.nombre, config, propio: p.user_id === userId, compartido: !!p.compartido };
}
