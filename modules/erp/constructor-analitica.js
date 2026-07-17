// ════════════════════════════════════════════════════════════════════════════
// CONSTRUCTOR DE ANALÍTICAS — el motor. Escalera · paso 4a. Área: VENTAS.
//
// LA DECISIÓN QUE LO SOSTIENE (dueño, 17 jul 2026): **el constructor NO arma SQL.** Cruza sobre un
// conjunto de filas YA VERIFICADO.
//
// Por qué, y es la razón de que esta pieza exista así y no de otra forma: armar SQL con una allowlist
// (el patrón de `query_database`, D1) protege los PERMISOS pero **no las reglas de negocio**. Un
// gráfico que consultara `invoices` por su cuenta contaría las **anuladas**, contaría los **tickets
// sustituidos**, y las **rectificativas no netearían** — porque no pasaría por `countsAsReceivable`.
// El dueño se construiría un gráfico que dice un "total de ventas" DISTINTO del de la pantalla de
// Ventas y del de Rentabilidad. Tres cifras verdaderas y contradictorias, y la que miente la ha hecho
// él, así que no sospecharía. Aquí la regla de conteo se aplica **UNA vez, en el origen**
// (`countingSalesInvoices`), y todo lo demás es agrupar. Es imposible contradecir a Ventas.
//
// EL COSTE, dicho claro: carga las líneas en memoria. No es una excepción — `countingSalesInvoices`
// YA lo hace (`SELECT *` + filtro en JS) y lo consume toda la Analítica. Si un negocio llegara a
// cientos de miles de líneas, se acota por fecha, que es lo que un panel hace igualmente.
import { countingSalesInvoices, SQL_RESPONSABLE, SQL_RESPONSABLE_JOIN, SIN_ASIGNAR, clavePeriodo } from './ventas-metrics.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const VACIO = '(sin dato)';

// ── EL CONJUNTO ENRIQUECIDO ──────────────────────────────────────────────────
// Una fila por LÍNEA de venta de las facturas que cuentan, con todo lo que se puede cruzar ya
// resuelto. Se construye con UNA consulta (no N+1) y la regla de conteo ya viene aplicada.
export function filasVenta(db, { from = null, to = null } = {}) {
  const facturas = countingSalesInvoices(db, { from, to });
  if (!facturas.length) return [];
  const ph = facturas.map(() => '?').join(',');
  const ids = facturas.map(f => f.id);
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
  ).all(...ids);
}

// ── EL CATÁLOGO DE CAMPOS, EN CRISTIANO ──────────────────────────────────────
// Lo que el usuario ve para elegir. `perm` = permiso EXTRA que exige ese campo (además de
// `analytics.read` + `invoices.read`, que son de toda el área). Sale del catálogo del paso 3
// (`docs/analitica/catalogo-piezas.md`): aquí no se inventa ninguna pieza nueva.
// FALLA CERRADO: un campo sin `valor` no se puede pedir (no está en el mapa → no existe).
export const DIMENSIONES = {
  fecha:        { etiqueta: 'Fecha',              valor: (f, o) => clavePeriodo(f.issue_date, o.periodo || 'mes') },
  cliente:      { etiqueta: 'Cliente',            perm: 'clients.read',  valor: f => f.client_id ? (f.client_name || VACIO) : 'Mostrador (sin cliente)' },
  tipo_cliente: { etiqueta: 'Tipo de cliente',    perm: 'clients.read',  valor: f => f.client_type || VACIO },
  provincia:    { etiqueta: 'Provincia',          perm: 'clients.read',  valor: f => (f.client_province || '').trim() || '(sin provincia)' },
  forma_pago:   { etiqueta: 'Forma de pago',      perm: 'clients.read',  valor: f => (f.payment_method || '').trim() || VACIO },
  producto:     { etiqueta: 'Producto',           perm: 'products.read', valor: f => f.producto || f.linea || VACIO },
  categoria:    { etiqueta: 'Categoría',          perm: 'products.read', valor: f => f.categoria || '(sin categoría)' },
  responsable:  { etiqueta: 'Responsable',        valor: f => f.responsable_nombre || SIN_ASIGNAR },
  serie:        { etiqueta: 'Serie de factura',   valor: f => f.series || VACIO },
};

// Las medidas se acumulan por grupo. `sinCoste` no es una medida que el usuario pida: es el aviso que
// viaja con el margen, igual que en Rentabilidad (paso 2).
export const MEDIDAS = {
  base:      { etiqueta: 'Facturado (sin IVA)', dinero: true },
  unidades:  { etiqueta: 'Unidades vendidas',   dinero: false },
  lineas:    { etiqueta: 'Nº de líneas',        dinero: false },
  coste:     { etiqueta: 'Coste',               dinero: true },
  beneficio: { etiqueta: 'Beneficio (margen)',  dinero: true },
  margenPct: { etiqueta: 'Margen %',            dinero: false, pct: true },
};

export const TIPOS_GRAFICO = ['barras', 'lineas', 'tarta', 'tabla'];

// Qué puede pedir ESTE usuario. Se calcula en el servidor y se le manda a la pantalla: si el
// desplegable ofreciera un campo que luego el servidor deniega, el usuario montaría un panel que no
// puede abrir. Y al revés: esconderlo en el front NO sería el candado — `cruzar` lo vuelve a mirar.
export function camposPara(hasPerm) {
  const dims = {}, meds = {};
  for (const [k, d] of Object.entries(DIMENSIONES)) if (!d.perm || hasPerm(d.perm)) dims[k] = { etiqueta: d.etiqueta };
  for (const [k, m] of Object.entries(MEDIDAS)) meds[k] = { etiqueta: m.etiqueta, dinero: !!m.dinero, pct: !!m.pct };
  return { dimensiones: dims, medidas: meds, graficos: TIPOS_GRAFICO };
}

// ── EL CRUCE ─────────────────────────────────────────────────────────────────
// dimensión × medidas × filtros. Es un group-by sobre las filas ya verificadas: por eso cualquier
// combinación funciona sin escribir una función por cada una, y por eso ninguna puede contradecir a
// Ventas. `filtros` = { dimension: [valores permitidos] } — se filtra por el MISMO valor que se
// agrupa, así que lo que el usuario ve en la leyenda es lo que puede filtrar.
export function cruzar(db, { dimension = 'fecha', medidas = ['base'], periodo = 'mes',
                            filtros = {}, from = null, to = null, limit = 100, hasPerm } = {}) {
  const dim = DIMENSIONES[dimension];
  if (!dim) { const e = new Error('No sé cruzar por "' + dimension + '"'); e.status = 400; throw e; }
  if (dim.perm && hasPerm && !hasPerm(dim.perm)) {
    const e = new Error('No tienes permiso para cruzar por ' + dim.etiqueta.toLowerCase()); e.status = 403; throw e;
  }
  const meds = (Array.isArray(medidas) ? medidas : [medidas]).filter(m => MEDIDAS[m]);
  if (!meds.length) { const e = new Error('Elige al menos una medida'); e.status = 400; throw e; }
  // Los filtros también se validan: filtrar por un campo que no puedes ver sería sacar por la puerta
  // de atrás lo que la dimensión te niega (podrías deducir el dato acotando y mirando el total).
  for (const k of Object.keys(filtros || {})) {
    const d = DIMENSIONES[k];
    if (!d) { const e = new Error('No sé filtrar por "' + k + '"'); e.status = 400; throw e; }
    if (d.perm && hasPerm && !hasPerm(d.perm)) { const e = new Error('No tienes permiso para filtrar por ' + d.etiqueta.toLowerCase()); e.status = 403; throw e; }
  }

  const opts = { periodo };
  const map = new Map();
  let sinCosteTotal = 0;
  for (const f of filasVenta(db, { from, to })) {
    let fuera = false;
    for (const [k, vals] of Object.entries(filtros || {})) {
      if (!Array.isArray(vals) || !vals.length) continue;
      if (!vals.includes(String(DIMENSIONES[k].valor(f, opts)))) { fuera = true; break; }
    }
    if (fuera) continue;
    const clave = String(dim.valor(f, opts));
    const e = map.get(clave) || { clave, base: 0, unidades: 0, lineas: 0, coste: 0, _conCoste: 0, sinCoste: 0 };
    const base = Number(f.base) || 0;
    e.base += base; e.unidades += Number(f.quantity) || 0; e.lineas++;
    // MISMA regla que `margenResumen`: sin coste conocido NO es margen del 100 %, se aparta. Si el
    // constructor la relajara, el usuario se dibujaría un margen precioso y falso.
    if (f.unit_cost == null) { e.sinCoste += base; sinCosteTotal += base; }
    else { e._conCoste += base; e.coste += (Number(f.unit_cost) || 0) * (Number(f.quantity) || 0); }
    map.set(clave, e);
  }

  const filas = [...map.values()].map(e => {
    const beneficio = e._conCoste - e.coste;
    const tiene = e._conCoste !== 0;
    const o = { clave: e.clave };
    for (const m of meds) {
      if (m === 'base') o.base = r2(e.base);
      else if (m === 'unidades') o.unidades = r2(e.unidades);
      else if (m === 'lineas') o.lineas = e.lineas;
      else if (m === 'coste') o.coste = tiene ? r2(e.coste) : null;
      else if (m === 'beneficio') o.beneficio = tiene ? r2(beneficio) : null;
      else if (m === 'margenPct') o.margenPct = tiene ? r2(beneficio / e._conCoste * 100) : null;
    }
    o.sinCoste = r2(e.sinCoste);
    return o;
  });
  // Por fecha se ordena por fecha (una serie temporal desordenada no es una serie); por lo demás, de
  // mayor a menor, que es lo que un ranking quiere.
  filas.sort((a, b) => dimension === 'fecha' ? (a.clave < b.clave ? -1 : 1) : ((b.base ?? 0) - (a.base ?? 0)));

  const pideMargen = meds.some(m => ['beneficio', 'margenPct', 'coste'].includes(m));
  return {
    dimension, dimensionEtiqueta: dim.etiqueta, medidas: meds, periodo,
    filas: filas.slice(0, limit), truncado: filas.length > limit,
    // El aviso solo sale si el usuario pidió margen: si mira facturación, lo de "sin coste" no le
    // afecta y sería ruido. Mismo criterio que Rentabilidad.
    aviso: (pideMargen && sinCosteTotal > 0) ? { sinCoste: r2(sinCosteTotal) } : null,
  };
}

// ── PANELES GUARDADOS ────────────────────────────────────────────────────────
// De QUIEN LOS CREA (decisión del dueño). Compartir es el paso 4b.
// UN PANEL NO CONGELA PERMISOS: guarda la RECETA (qué cruzar), no los datos. Al abrirlo se vuelve a
// pasar por `cruzar`, que revalida contra los permisos de HOY. Si guardara resultados, un panel sería
// una fuga con fecha: bastaría perder un permiso y seguir viendo lo de antes.
export function guardarPanel(db, userId, { id = null, nombre, config }) {
  const n = String(nombre || '').trim();
  if (!n) { const e = new Error('El panel necesita un nombre'); e.status = 400; throw e; }
  if (!config || !DIMENSIONES[config.dimension]) { const e = new Error('El panel necesita una dimensión válida'); e.status = 400; throw e; }
  if (!TIPOS_GRAFICO.includes(config.grafico || 'tabla')) { const e = new Error('Ese tipo de gráfico no existe'); e.status = 400; throw e; }
  const json = JSON.stringify(config);
  if (id) {
    // El WHERE lleva el user_id: sin él, cambiar el id en la petición editaría el panel de otro.
    const r = db.prepare('UPDATE analytics_panels SET nombre=?, config=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?')
      .run(n, json, id, userId);
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
