// ════════════════════════════════════════════════════════════════════════════
// CONSTRUCTOR DE ANALÍTICAS — el motor. Escalera · paso 4a + 4a-bis.
// Áreas: VENTAS · COMPRAS · CLIENTES · INVENTARIO. (Contabilidad, fuera: su resultado vive en Libros
// y modelos y meterla aquí arriesga dos verdades del beneficio — decisión pendiente del dueño.)
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

export const AREAS = { ventas: AREA_VENTAS, compras: AREA_COMPRAS, clientes: AREA_CLIENTES, inventario: AREA_INVENTARIO };

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
                            filtros = {}, from = null, to = null, limit = 100, hasPerm } = {}) {
  const A = AREAS[area];
  if (!A) { const e = new Error('No conozco el área "' + area + '"'); e.status = 400; throw e; }
  if (A.perm && hasPerm && !hasPerm(A.perm)) { const e = new Error('No tienes permiso para el área ' + A.etiqueta.toLowerCase()); e.status = 403; throw e; }
  const dim = A.dimensiones[dimension];
  if (!dim) { const e = new Error('No sé cruzar "' + area + '" por "' + dimension + '"'); e.status = 400; throw e; }
  if (dim.perm && hasPerm && !hasPerm(dim.perm)) { const e = new Error('No tienes permiso para cruzar por ' + dim.etiqueta.toLowerCase()); e.status = 403; throw e; }
  const meds = (Array.isArray(medidas) ? medidas : [medidas]).filter(m => A.medidas[m]);
  if (!meds.length) { const e = new Error('Elige al menos una medida'); e.status = 400; throw e; }
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

  const filas = [...map.values()].map(acc => A.salida(acc, meds));
  const ord = A.ordenar;
  // Por fecha, orden cronológico (una serie temporal desordenada no es una serie). Por lo demás, de
  // mayor a menor según la medida de referencia del área (ranking).
  filas.sort((a, b) => dimension === 'fecha' ? (a.clave < b.clave ? -1 : 1) : ((b[ord] ?? 0) - (a[ord] ?? 0)));

  return {
    area, dimension, dimensionEtiqueta: dim.etiqueta, medidas: meds, periodo, usaPeriodo: !!A.usaPeriodo,
    filas: filas.slice(0, limit), truncado: filas.length > limit,
    aviso: A.aviso ? A.aviso(map, meds) : null,
  };
}

// ── PANELES GUARDADOS ────────────────────────────────────────────────────────
// De QUIEN LOS CREA (decisión del dueño). Compartir es el paso 4b.
// Guardan la RECETA (qué área, qué cruzar), NO los datos: al abrirlos se vuelve a pasar por `cruzar`,
// que revalida los permisos de HOY. Si guardara resultados, un panel sería una fuga con fecha.
export function guardarPanel(db, userId, { id = null, nombre, config }) {
  const n = String(nombre || '').trim();
  if (!n) { const e = new Error('El panel necesita un nombre'); e.status = 400; throw e; }
  const area = (config && config.area) || 'ventas';   // por defecto ventas (compat. paso 4a)
  const A = AREAS[area];
  if (!A) { const e = new Error('El panel apunta a un área que no existe'); e.status = 400; throw e; }
  if (!config || !A.dimensiones[config.dimension]) { const e = new Error('El panel necesita una dimensión válida de su área'); e.status = 400; throw e; }
  if (!TIPOS_GRAFICO.includes(config.grafico || 'tabla')) { const e = new Error('Ese tipo de gráfico no existe'); e.status = 400; throw e; }
  const json = JSON.stringify({ ...config, area });
  if (id) {
    // El WHERE lleva el user_id: sin él, cambiar el id en la petición editaría el panel de otro.
    const r = db.prepare('UPDATE analytics_panels SET nombre=?, config=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(n, json, id, userId);
    if (!r.changes) { const e = new Error('Panel no encontrado'); e.status = 404; throw e; }
    return { id: Number(id) };
  }
  const r = db.prepare('INSERT INTO analytics_panels (user_id, nombre, config) VALUES (?,?,?)').run(userId, n, json);
  return { id: r.lastInsertRowid };
}

export function listarPaneles(db, userId) {
  return db.prepare('SELECT id, nombre, config, created_at FROM analytics_panels WHERE user_id=? ORDER BY id')
    .all(userId).map(p => { try { return { ...p, config: JSON.parse(p.config) }; } catch { return { ...p, config: null }; } });
}

export function borrarPanel(db, userId, id) {
  const r = db.prepare('DELETE FROM analytics_panels WHERE id=? AND user_id=?').run(id, userId);
  if (!r.changes) { const e = new Error('Panel no encontrado'); e.status = 404; throw e; }
  return { ok: true };
}
