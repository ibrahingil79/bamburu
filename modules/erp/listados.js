// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL REGISTRO DE LISTADOS — lo único que hay que escribir para que un listado se pueda imprimir
// ════════════════════════════════════════════════════════════════════════════════════════════════
// AQUÍ NO HAY MOTOR. El motor está en `impresion.js` y no se toca nunca más: añadir un listado es
// añadir una entrada a `LISTADOS`, y con eso gana los tres verbos —imprimir, descargar y enviar—
// sin escribir ni una ruta (C11). Las tres rutas viven en `routes/listados.js`, son genéricas y
// tampoco cambian.
//
// ── EL PATRÓN QUE COPIARÁN LOS SIETE RESTANTES ─────────────────────────────────────────────────
// Cada entrada tiene CINCO cosas y ninguna más:
//
//   titulo   Cómo se llama el papel.
//   perm     El candado. Es EL MISMO que el de su pantalla, nunca uno nuevo: quien no puede ver un
//            listado tampoco puede imprimirlo ni mandárselo a nadie.
//   filtros  (q) → [{ etiqueta, valor }]. Lo que se imprime en la cabecera para declarar la base.
//            Devolver [] significa «Todos», y de eso se encarga el motor.
//   consulta (db, q) → { filas, periodo? }. LA MISMA que alimenta la pantalla, SIN LIMIT/OFFSET.
//   columnas [{ clave|valor, rotulo, formato, align }] y, si procede, `totales`.
//
// ── LA REGLA QUE NO SE NEGOCIA: UNA SOLA CONSULTA ──────────────────────────────────────────────
// La consulta que alimenta la PANTALLA y la que alimenta el PDF son LA MISMA FUNCIÓN. La pantalla le
// pide una página (`limit`/`offset`); el PDF le pide todo. Si el PDF tuviera su propia consulta, el
// día que alguien cambiara un filtro en una de las dos empezarían a decir cosas distintas y **nadie
// sabría cuál miente** — que es exactamente lo que costó la tarea C-0 con `docParties`, copiada
// cuatro veces. Cada listado tiene una aserción que compara el total del PDF con el de la pantalla
// al céntimo.
//
// PARA AÑADIR EL SIGUIENTE: copia el bloque de `clientes`, cambia la consulta y las columnas, y
// exporta la consulta para que su pantalla la use. No hay nada más que hacer.
import { dinero } from './impresion.js';

// ── C4 · CLIENTES ───────────────────────────────────────────────────────────────────────────────
// EL PATRÓN, en su forma más simple: filtros por URL, un WHERE que se arma una vez y se usa para
// contar, para la página y para el papel. `limit`/`offset` son OPCIONALES: sin ellos devuelve todo,
// que es lo que necesita el PDF.
export function consultaClientes(db, { q = '', archivados = false, limit = null, offset = 0 } = {}) {
  const where = ['c.active = ?'];
  const params = [archivados ? 0 : 1];
  if (q) { where.push('(c.name LIKE ? OR c.fiscal_id LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare('SELECT COUNT(*) AS n FROM clients c ' + whereSql).get(...params).n;
  const sql = 'SELECT c.*, g.name as group_name FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id '
            + whereSql + ' ORDER BY c.name' + (limit != null ? ' LIMIT ? OFFSET ?' : '');
  const filas = limit != null ? db.prepare(sql).all(...params, limit, offset) : db.prepare(sql).all(...params);
  return { filas, total };
}

// ── C5 · PRODUCTOS ──────────────────────────────────────────────────────────────────────────────
// OJO A ESTOS FILTROS, que la primera versión los inventó: la pantalla de productos filtra por
// BÚSQUEDA y CATEGORÍA, y NO excluye los archivados. Yo había escrito «tipo» y una exclusión de
// archivados que la pantalla no hace — o sea, dos consultas distintas diciendo ser la misma, que es
// exactamente lo que esta regla viene a impedir. Se corrigió mirando la pantalla, no de memoria.
export function consultaProductos(db, { q = '', categoria = '', limit = null, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  if (categoria) { where.push('p.category_id = ?'); params.push(categoria); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) AS n FROM products p ' + whereSql).get(...params).n;
  const sql = 'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id '
            + whereSql + ' ORDER BY p.name' + (limit != null ? ' LIMIT ? OFFSET ?' : '');
  const filas = limit != null ? db.prepare(sql).all(...params, limit, offset) : db.prepare(sql).all(...params);
  return { filas, total };
}

// ── C7 · FACTURAS — la más dura de las ocho, y va en la primera tanda a propósito ────────────────
// Tiene filtros, periodo, estados y totales que hay que sumar. Si el motor no aguantara esto, es
// mejor verlo con cuatro listados encima que con siete.
//
// EL TOTAL SE SUMA SOBRE LAS MISMAS FILAS QUE SE PINTAN, no con un SELECT SUM aparte: un total
// calculado por otra vía es un total que puede no cuadrar con lo que hay debajo, y este encargo dice
// que si el total impreso no cuadra con la pantalla el fallo es de la impresión — nunca se arregla
// cambiando el cálculo.
// ESTA ES LA CONSULTA DE LA PANTALLA, movida aquí tal cual. La API `/api/erp/invoices` —de la que
// come el listado de facturas del panel— la llama con `limit: 200`, que es el tope que ya tenía; el
// papel la llama sin límite. Se conservan el JOIN tolerante al clúster viejo archivado y la
// subconsulta de `cobrado`, porque quitarlos habría cambiado lo que ve la pantalla, y este encargo
// dice que aquí NO se recalcula nada: se imprime.
export function consultaFacturas(db, { estado = '', desde = '', hasta = '', cliente_id = null, limit = null, offset = 0 } = {}) {
  const soTbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sales_orders','sales_orders_archived') ORDER BY (name='sales_orders') DESC LIMIT 1").get()?.name || null;
  const where = [];
  const params = [];
  if (estado) { where.push('i.status = ?'); params.push(estado); }
  if (desde) { where.push('i.issue_date >= ?'); params.push(desde); }
  if (hasta) { where.push('i.issue_date <= ?'); params.push(hasta); }
  if (cliente_id) { where.push('i.client_id = ?'); params.push(cliente_id); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) AS n FROM invoices i ' + whereSql).get(...params).n;
  const sql = `SELECT i.*, ${soTbl ? 'o.order_number as order_ref' : 'NULL as order_ref'},
      (SELECT COALESCE(SUM(p.amount),0) FROM invoice_payments p WHERE p.invoice_id=i.id) AS cobrado
    FROM invoices i ${soTbl ? `LEFT JOIN ${soTbl} o ON o.id=i.order_id` : ''} `
    + whereSql + ' ORDER BY i.created_at DESC' + (limit != null ? ' LIMIT ? OFFSET ?' : '');
  const filas = limit != null ? db.prepare(sql).all(...params, limit, offset) : db.prepare(sql).all(...params);
  return { filas, total };
}

// ── C1 · LISTA DE PRECIOS ───────────────────────────────────────────────────────────────────────
// Es un listado propio y NO «productos con otras columnas»: lo que se le manda a un cliente es el
// precio con IVA incluido, y sin stock ni coste — el coste es un dato interno del negocio y no puede
// salir en un papel que sale por la puerta.
export function consultaPrecios(db, { q = '', categoria = '', limit = null, offset = 0 } = {}) {
  const r = consultaProductos(db, { q, categoria, limit, offset });   // LA MISMA, solo cambian las columnas
  const filas = r.filas.map(p => {
    const base = Number(p.price) || 0;
    const iva = Number(p.tax_rate) || 0;
    return { ...p, precio_base: base, iva, precio_final: Math.round(base * (1 + iva / 100) * 100) / 100 };
  });
  return { filas, total: r.total };
}

// La categoría se declara por su NOMBRE, no por su número: «Categoría: 7» no le dice nada a nadie.
function filtrosProducto(q, db) {
  const f = [];
  if (q.q) f.push({ etiqueta: 'Búsqueda', valor: q.q });
  if (q.categoria) {
    const nom = db ? db.prepare('SELECT name FROM categories WHERE id=?').get(q.categoria)?.name : null;
    f.push({ etiqueta: 'Categoría', valor: nom || ('#' + q.categoria) });
  }
  return f;
}

const ESTADO_FACTURA = { emitida: 'Emitidas', rectificada: 'Rectificadas', anulada: 'Anuladas' };

export const LISTADOS = {
  // ══ C4 ══════════════════════════════════════════════════════════════════════════════════════
  clientes: {
    titulo: 'Listado de clientes',
    perm: 'clients.read',
    volver: '/admin/clients',
    filtros: q => {
      const f = [];
      if (q.q) f.push({ etiqueta: 'Búsqueda', valor: q.q });
      f.push({ etiqueta: 'Estado', valor: q.archivados ? 'Archivados' : 'Activos' });
      return f;
    },
    consulta: (db, q) => consultaClientes(db, q),
    columnas: [
      { clave: 'client_code', rotulo: 'Código' },
      { clave: 'name', rotulo: 'Cliente' },
      { clave: 'fiscal_id', rotulo: 'NIF' },
      { clave: 'email', rotulo: 'Email' },
      { clave: 'phone', rotulo: 'Teléfono' },
      { clave: 'group_name', rotulo: 'Grupo' },
    ],
    totales: (filas) => [{ etiqueta: 'Clientes', valor: filas.length, formato: 'numero', grand: true }],
    vacio: 'No hay clientes que cumplan estos filtros.',
  },

  // ══ C5 ══════════════════════════════════════════════════════════════════════════════════════
  productos: {
    titulo: 'Listado de productos y servicios',
    perm: 'products.read',
    volver: '/admin/products',
    filtros: (q, db) => filtrosProducto(q, db),
    consulta: (db, q) => consultaProductos(db, q),
    columnas: [
      { clave: 'sku', rotulo: 'Referencia' },
      { clave: 'name', rotulo: 'Nombre' },
      { valor: p => p.type === 'service' ? 'Servicio' : 'Producto', rotulo: 'Tipo' },
      { clave: 'category_name', rotulo: 'Categoría' },
      { clave: 'price', rotulo: 'Precio', formato: 'dinero', align: 'right' },
      { clave: 'tax_rate', rotulo: 'IVA', formato: 'pct', align: 'right' },
      { valor: p => p.type === 'service' ? '—' : p.stock, rotulo: 'Stock', align: 'right' },
    ],
    totales: (filas) => [{ etiqueta: 'Referencias', valor: filas.length, formato: 'numero', grand: true }],
    vacio: 'No hay productos que cumplan estos filtros.',
  },

  // ══ C7 ══════════════════════════════════════════════════════════════════════════════════════
  facturas: {
    titulo: 'Listado de facturas',
    perm: 'invoices.read',
    volver: '/admin/invoices',
    filtros: q => {
      const f = [];
      if (q.estado) f.push({ etiqueta: 'Estado', valor: ESTADO_FACTURA[q.estado] || q.estado });
      if (q.cliente_id) f.push({ etiqueta: 'Cliente', valor: '#' + q.cliente_id });
      return f;
    },
    periodo: q => (q.desde || q.hasta) ? { desde: q.desde, hasta: q.hasta } : null,
    consulta: (db, q) => consultaFacturas(db, q),
    columnas: [
      { clave: 'invoice_number', rotulo: 'Nº' },
      { clave: 'issue_date', rotulo: 'Fecha', formato: 'fecha' },
      { valor: i => i.client_name || 'Cliente general', rotulo: 'Cliente' },
      { clave: 'client_fiscal_id', rotulo: 'NIF' },
      { valor: i => ({ emitida: 'Emitida', rectificada: 'Rectificada', anulada: 'Anulada' })[i.status] || i.status, rotulo: 'Estado' },
      { clave: 'subtotal', rotulo: 'Base', formato: 'dinero', align: 'right' },
      { clave: 'tax_amount', rotulo: 'IVA', formato: 'dinero', align: 'right' },
      { clave: 'total', rotulo: 'Total', formato: 'dinero', align: 'right' },
    ],
    // LOS TOTALES SE SUMAN SOBRE LAS FILAS QUE SE PINTAN. Y las ANULADAS no suman: una factura
    // anulada no es dinero, y meterla en el total daría una cifra que no existe en ninguna parte.
    totales: (filas) => {
      const vivas = filas.filter(f => f.status !== 'anulada');
      const s = k => vivas.reduce((a, f) => a + (Number(f[k]) || 0), 0);
      return [
        { etiqueta: 'Facturas (sin las anuladas)', valor: vivas.length, formato: 'numero' },
        { etiqueta: 'Base imponible', valor: s('subtotal') },
        { etiqueta: 'IVA', valor: s('tax_amount') },
        { etiqueta: 'Total facturado', valor: s('total'), grand: true },
      ];
    },
    vacio: 'No hay facturas que cumplan estos filtros.',
  },

  // ══ C1 ══════════════════════════════════════════════════════════════════════════════════════
  precios: {
    titulo: 'Lista de precios',
    perm: 'products.read',
    volver: '/admin/products',
    filtros: (q, db) => filtrosProducto(q, db),
    consulta: (db, q) => consultaPrecios(db, q),
    // SIN COSTE Y SIN STOCK, a propósito: este papel sale por la puerta. Lo que el cliente necesita
    // es el precio con el IVA ya sumado, que es lo que va a pagar.
    columnas: [
      { clave: 'sku', rotulo: 'Referencia' },
      { clave: 'name', rotulo: 'Descripción' },
      { clave: 'precio_base', rotulo: 'Precio', formato: 'dinero', align: 'right' },
      { clave: 'iva', rotulo: 'IVA', formato: 'pct', align: 'right' },
      { clave: 'precio_final', rotulo: 'Precio con IVA', formato: 'dinero', align: 'right' },
    ],
    totales: (filas) => [{ etiqueta: 'Artículos', valor: filas.length, formato: 'numero', grand: true }],
    vacio: 'No hay artículos con precio que cumplan estos filtros.',
  },
};

// Los filtros que llegan por URL, normalizados. Un solo sitio para que las tres rutas y la pantalla
// entiendan lo mismo por «estado» o por «desde».
export function filtrosDeUrl(c) {
  const g = k => (c.req.query(k) || '').trim();
  return {
    q: g('q'),
    categoria: g('categoria'),
    estado: g('estado'),
    desde: g('desde'),
    hasta: g('hasta'),
    cliente_id: parseInt(g('cliente_id'), 10) || null,
    archivados: c.req.query('archivados') === '1',
  };
}
