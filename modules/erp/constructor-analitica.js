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
    `SELECT ii.id, ii.quantity, ii.total_price AS base, ii.unit_cost, ii.product_id,
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
    beneficio: { etiqueta: 'Beneficio (margen)',  dinero: true },
    margenPct: { etiqueta: 'Margen %',            dinero: false, pct: true },
  },
  usaPeriodo: true,
  nuevoAcc: clave => ({ clave, base: 0, unidades: 0, lineas: 0, coste: 0, _conCoste: 0, sinCoste: 0 }),
  sumar: (a, f) => {
    const base = Number(f.base) || 0;
    a.base += base; a.unidades += Number(f.quantity) || 0; a.lineas++;
    // MISMA regla que `margenResumen`: sin coste conocido NO es margen del 100 %, se aparta.
    if (f.unit_cost == null) a.sinCoste += base;
    else { a._conCoste += base; a.coste += (Number(f.unit_cost) || 0) * (Number(f.quantity) || 0); }
  },
  salida: (a, meds) => {
    const beneficio = a._conCoste - a.coste, tiene = a._conCoste !== 0, o = { clave: a.clave };
    for (const m of meds) {
      if (m === 'base') o.base = r2(a.base);
      else if (m === 'unidades') o.unidades = r2(a.unidades);
      else if (m === 'lineas') o.lineas = a.lineas;
      else if (m === 'coste') o.coste = tiene ? r2(a.coste) : null;
      else if (m === 'beneficio') o.beneficio = tiene ? r2(beneficio) : null;
      else if (m === 'margenPct') o.margenPct = tiene ? r2(beneficio / a._conCoste * 100) : null;
    }
    o.sinCoste = r2(a.sinCoste);
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
  },
  usaPeriodo: false,
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
    }
    return o;
  },
  ordenar: 'resultado',
};

export const AREAS = { ventas: AREA_VENTAS, compras: AREA_COMPRAS, clientes: AREA_CLIENTES, inventario: AREA_INVENTARIO, contabilidad: AREA_CONTABILIDAD };

// El permiso BASE de un área (para que las rutas no tengan que conocer el registro). null si no existe.
export function areaPerm(area) { return AREAS[area]?.perm || null; }

// Alias históricos (el gate del paso 4a los importa). Apuntan a Ventas, que es donde nació el motor.
export const DIMENSIONES = AREA_VENTAS.dimensiones;
export const MEDIDAS = AREA_VENTAS.medidas;

// ── EL CATÁLOGO EN CRISTIANO ─────────────────────────────────────────────────
// Qué áreas puede el usuario, y dentro de cada una qué campos. `hasPerm` gatea: un área sin su permiso
// base NO se ofrece, y dentro, un campo con `perm` propio se esconde si no lo tiene. Es cortesía: el
// servidor lo revalida en `cruzar` — el desplegable filtrado nunca es el candado.
export function areasPara(hasPerm) {
  const out = {};
  for (const [k, a] of Object.entries(AREAS)) if (!a.perm || hasPerm(a.perm)) out[k] = { etiqueta: a.etiqueta };
  return out;
}
export function camposPara(hasPerm, areaKey = 'ventas') {
  const a = AREAS[areaKey]; if (!a) return { dimensiones: {}, medidas: {}, graficos: TIPOS_GRAFICO };
  const dims = {}, meds = {};
  for (const [k, d] of Object.entries(a.dimensiones)) if (!d.perm || hasPerm(d.perm)) dims[k] = { etiqueta: d.etiqueta };
  for (const [k, m] of Object.entries(a.medidas)) meds[k] = { etiqueta: m.etiqueta, dinero: !!m.dinero, pct: !!m.pct };
  return { dimensiones: dims, medidas: meds, graficos: TIPOS_GRAFICO, usaPeriodo: !!a.usaPeriodo };
}

// ── EL CRUCE ─────────────────────────────────────────────────────────────────
// Genérico: agrupa las filas del área por la dimensión y acumula las medidas con los ganchos del área.
// `area` por defecto 'ventas' → los llamadores del paso 4a (sin `area`) siguen funcionando igual.
export function cruzar(db, { area = 'ventas', dimension = 'fecha', medidas = ['base'], periodo = 'mes',
                            filtros = {}, from = null, to = null, limit = 100, formula = null, hasPerm } = {}) {
  const A = AREAS[area];
  if (!A) { const e = new Error('No conozco el área "' + area + '"'); e.status = 400; throw e; }
  if (A.perm && hasPerm && !hasPerm(A.perm)) { const e = new Error('No tienes permiso para el área ' + A.etiqueta.toLowerCase()); e.status = 403; throw e; }
  const dim = A.dimensiones[dimension];
  if (!dim) { const e = new Error('No sé cruzar "' + area + '" por "' + dimension + '"'); e.status = 400; throw e; }
  if (dim.perm && hasPerm && !hasPerm(dim.perm)) { const e = new Error('No tienes permiso para cruzar por ' + dim.etiqueta.toLowerCase()); e.status = 403; throw e; }
  const meds = (Array.isArray(medidas) ? medidas : [medidas]).filter(m => A.medidas[m]);
  if (!meds.length) { const e = new Error('Elige al menos una medida'); e.status = 400; throw e; }
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

  const filas = [...map.values()].map(acc => {
    const fila = A.salida(acc, medsSalida);
    if (rpn) fila.calculo = evalRPN(rpn, fila);   // el cálculo propio, sobre las medidas del grupo
    return fila;
  });
  const ord = rpn ? 'calculo' : A.ordenar;
  // Por fecha, orden cronológico (una serie temporal desordenada no es una serie). Por lo demás, de
  // mayor a menor según la medida de referencia del área (ranking).
  filas.sort((a, b) => dimension === 'fecha' ? (a.clave < b.clave ? -1 : 1) : ((b[ord] ?? 0) - (a[ord] ?? 0)));

  return {
    area, dimension, dimensionEtiqueta: dim.etiqueta, medidas: meds, periodo, usaPeriodo: !!A.usaPeriodo,
    calculo: !!rpn,
    filas: filas.slice(0, limit), truncado: filas.length > limit,
    aviso: A.aviso ? A.aviso(map, meds) : null,
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
export function areasComparables() {
  return Object.entries(AREAS).filter(([, a]) => a.usaPeriodo && a.dimensiones.fecha)
    .map(([k, a]) => ({ area: k, etiqueta: a.etiqueta, medidas: Object.fromEntries(Object.entries(a.medidas).map(([mk, m]) => [mk, { etiqueta: m.etiqueta, dinero: !!m.dinero }])) }));
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
export function guardarPanel(db, userId, { id = null, nombre, config, compartido = null }) {
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
    const args = compartido == null ? [n, json, id, userId] : [n, json, compartido ? 1 : 0, id, userId];
    const r = db.prepare('UPDATE analytics_panels SET ' + set + ' WHERE id=? AND user_id=?').run(...args);
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

export function borrarPanel(db, userId, id) {
  const r = db.prepare('DELETE FROM analytics_panels WHERE id=? AND user_id=?').run(id, userId);
  if (!r.changes) { const e = new Error('Panel no encontrado'); e.status = 404; throw e; }
  return { ok: true };
}
