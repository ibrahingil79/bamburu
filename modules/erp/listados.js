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
import { kardex } from './stock.js';

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

// ── C6 · COMPRAS ────────────────────────────────────────────────────────────────────────────────
// LA MISMA CONSULTA QUE LA PANTALLA, palabra por palabra: `api.get('/')` de routes/purchases.js.
// El `archived=0` no es un adorno — las compras rotas heredadas (sin líneas) están fuera del listado
// de la pantalla, así que tienen que estar fuera del papel: si el papel las trajera, el recuento
// impreso no cuadraría con el de la pantalla y el fallo sería del papel.
export function consultaCompras(db, { desde = '', hasta = '', proveedor_id = null, limit = null, offset = 0 } = {}) {
  const w = ['p.archived=0'], args = [];
  if (desde) { w.push('p.date >= ?'); args.push(desde); }
  if (hasta) { w.push('p.date <= ?'); args.push(hasta); }
  if (proveedor_id) { w.push('p.supplier_id = ?'); args.push(proveedor_id); }
  const where = ' WHERE ' + w.join(' AND ');
  const sql = 'SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON p.supplier_id=s.id'
    + where + ' ORDER BY p.date DESC, p.id DESC' + (limit != null ? ' LIMIT ? OFFSET ?' : '');
  const filas = db.prepare(sql).all(...args, ...(limit != null ? [limit, offset] : []));
  const total = db.prepare('SELECT COUNT(*) n FROM purchases p' + where).get(...args).n;
  return { filas, total };
}

// ── C8 · GASTOS (facturas recibidas) ────────────────────────────────────────────────────────────
// LA MISMA CONSULTA QUE LA PANTALLA: `api.get('/')` de routes/supplier-invoices.js.
//
// POR QUÉ ESTE LISTADO ES «GASTOS» Y NO OTRA COSA, que el TABLERO solo dice «C8 Listado de gastos»:
// en Bamburu un gasto ES una factura recibida. El producto ya lo distingue por dentro
// (`supplier-invoices.js:99`: «sin origen de stock → factura de GASTO») y guarda su categoría en
// `expense_category`. Medido en el negocio de desarrollo: de 270 facturas recibidas, 197 son gasto
// puro y 73 traen mercancía. Se imprime la pantalla entera —que es la regla— y se ofrece el filtro
// de categoría para quien quiera solo un tipo de gasto.
export function consultaGastos(db, { proveedor_id = null, categoria = '', desde = '', hasta = '', limit = null, offset = 0 } = {}) {
  const w = [], args = [];
  if (proveedor_id) { w.push('si.supplier_id = ?'); args.push(proveedor_id); }
  if (categoria) { w.push('si.expense_category = ?'); args.push(categoria); }
  if (desde) { w.push('si.invoice_date >= ?'); args.push(desde); }
  if (hasta) { w.push('si.invoice_date <= ?'); args.push(hasta); }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';
  const sql = 'SELECT si.*, s.name AS supplier_name FROM supplier_invoices si JOIN suppliers s ON s.id=si.supplier_id'
    + where + ' ORDER BY si.invoice_date DESC, si.id DESC' + (limit != null ? ' LIMIT ? OFFSET ?' : '');
  const filas = db.prepare(sql).all(...args, ...(limit != null ? [limit, offset] : []));
  const total = db.prepare('SELECT COUNT(*) n FROM supplier_invoices si' + where).get(...args).n;
  return { filas, total };
}

// ── C3 · KARDEX ─────────────────────────────────────────────────────────────────────────────────
// LA MISMA FUENTE QUE LA PANTALLA: `kardex()` de stock.js, que es de donde come el modal de stock
// (`/api/erp/products/:id/stock`). No se reescribe el cálculo aquí — y menos el SALDO, que ya viene
// resuelto fila a fila desde el servidor (`stock.js:175`). Ese fue justo el punto que había que
// medir antes de construir: el kardex parecía no caber en el motor «porque lleva saldo acumulado»,
// y resulta que el saldo no lo acumula la vista, así que es una columna más.
//
// ES POR PRODUCTO, no global, porque eso es lo que existe: el kardex vive en el modal de UN artículo.
export function consultaKardex(db, { producto_id = null } = {}) {
  if (!producto_id) return { filas: [], total: 0, producto: null };
  const producto = db.prepare('SELECT id, name, sku, type FROM products WHERE id=?').get(producto_id) || null;
  if (!producto || producto.type !== 'physical') return { filas: [], total: 0, producto };
  const filas = kardex(db, producto_id).slice().reverse();   // el modal lo enseña del más nuevo al más viejo
  return { filas, total: filas.length, producto };
}

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

  // ══ C2 · CATÁLOGO PARA ENVIAR AL CLIENTE ═══════════
  // MISMA CONSULTA QUE LA PANTALLA DE PRODUCTOS. Lo que cambia frente al «Listado de productos» no
  // son los datos, son las COLUMNAS: este papel va a un cliente, así que enseña lo que se le puede
  // enseñar —referencia, nombre, precio con IVA— y NO lo de dentro (coste, margen, stock). Va
  // agrupado por categoría porque un catálogo se lee por familias, no por orden de alta.
  catalogo: {
    titulo: 'Catálogo de productos y servicios',
    perm: 'products.read',
    volver: '/admin/products',
    filtros: (q, db) => filtrosProducto(q, db),
    consulta: (db, q) => consultaProductos(db, q),
    agrupar: { rotulo: p => p.category_name || 'Sin categoría' },
    columnas: [
      { clave: 'sku', rotulo: 'Referencia' },
      { clave: 'name', rotulo: 'Nombre' },
      { valor: p => p.type === 'service' ? 'Servicio' : 'Producto', rotulo: 'Tipo' },
      { valor: p => Number(p.price || 0) * (1 + Number(p.tax_rate || 0) / 100), rotulo: 'Precio con IVA', formato: 'dinero', align: 'right' },
    ],
    totales: (filas) => [{ etiqueta: 'Referencias en catálogo', valor: filas.length, formato: 'numero', grand: true }],
    vacio: 'No hay nada que enseñar en el catálogo con estos filtros.',
  },

  // ══ C3 · KARDEX ════════════════════════════════════
  // ES DE UN PRODUCTO, y por eso su título lo dice: un kardex sin decir de qué artículo es no sirve
  // para nada. El SALDO viene calculado del servidor, fila a fila; aquí no se acumula nada.
  kardex: {
    titulo: 'Kardex de movimientos de stock',
    perm: 'products.read',
    volver: '/admin/inventory',
    filtros: (q, db) => {
      const f = [];
      const pid = Number(q.producto_id) || null;
      const p = pid ? db.prepare('SELECT name, sku FROM products WHERE id=?').get(pid) : null;
      f.push({ etiqueta: 'Artículo', valor: p ? (p.name + (p.sku ? ' (' + p.sku + ')' : '')) : 'ninguno elegido' });
      return f;
    },
    consulta: (db, q) => consultaKardex(db, { producto_id: Number(q.producto_id) || null }),
    columnas: [
      { clave: 'created_at', valor: m => String(m.created_at || '').slice(0, 16), rotulo: 'Fecha' },
      { clave: 'type', rotulo: 'Tipo' },
      { clave: 'quantity', rotulo: 'Cantidad', formato: 'numero', align: 'right' },
      { valor: m => m.reason || m.note || (m.is_reversal ? 'Reversión' : ''), rotulo: 'Motivo' },
      { valor: m => (m.origin_type ? m.origin_type + (m.origin_id ? ' #' + m.origin_id : '') : ''), rotulo: 'Origen' },
      { clave: 'balance', rotulo: 'Saldo', formato: 'numero', align: 'right' },
    ],
    totales: (filas) => [
      { etiqueta: 'Movimientos', valor: filas.length, formato: 'numero' },
      { etiqueta: 'Saldo final', valor: filas.length ? Number(filas[0].balance) : 0, formato: 'numero', grand: true },
    ],
    vacio: 'Este artículo no tiene movimientos de stock (o no lleva stock).',
  },

  // ══ C6 · COMPRAS ═══════════════════════════════════
  compras: {
    titulo: 'Listado de compras',
    perm: 'purchases.read',
    volver: '/admin/purchases',
    filtros: q => {
      const f = [];
      if (q.desde || q.hasta) return f;      // el periodo se declara aparte, en su sitio
      return f;
    },
    periodo: q => (q.desde || q.hasta) ? { desde: q.desde || '', hasta: q.hasta || '' } : null,
    consulta: (db, q) => consultaCompras(db, q),
    columnas: [
      { clave: 'date', rotulo: 'Fecha', formato: 'fecha' },
      { clave: 'reference', rotulo: 'Referencia' },
      { clave: 'supplier_name', rotulo: 'Proveedor' },
      { clave: 'status', rotulo: 'Estado' },
      { clave: 'total', rotulo: 'Total', formato: 'dinero', align: 'right' },
    ],
    totales: (filas) => [
      { etiqueta: 'Compras', valor: filas.length, formato: 'numero' },
      { etiqueta: 'Total comprado', valor: filas.reduce((a, f) => a + (Number(f.total) || 0), 0), grand: true },
    ],
    vacio: 'No hay compras que cumplan estos filtros.',
  },

  // ══ C8 · GASTOS ════════════════════════════════════
  // LAS ANULADAS NO SUMAN, igual que en facturas de venta: una factura anulada sigue en la lista
  // —porque existió y hay que poder verla— pero no cuenta en el total. Si sumara, el papel diría que
  // se gastó un dinero que no se gastó.
  gastos: {
    titulo: 'Listado de gastos y facturas recibidas',
    perm: 'purchases.read',
    volver: '/admin/supplier-invoices',
    filtros: (q, db) => {
      const f = [];
      if (q.categoria) f.push({ etiqueta: 'Categoría', valor: q.categoria });
      if (q.proveedor_id) {
        const s = db.prepare('SELECT name FROM suppliers WHERE id=?').get(Number(q.proveedor_id));
        if (s) f.push({ etiqueta: 'Proveedor', valor: s.name });
      }
      return f;
    },
    periodo: q => (q.desde || q.hasta) ? { desde: q.desde || '', hasta: q.hasta || '' } : null,
    consulta: (db, q) => consultaGastos(db, q),
    columnas: [
      { clave: 'invoice_date', rotulo: 'Fecha', formato: 'fecha' },
      { clave: 'internal_code', rotulo: 'Código' },
      { clave: 'supplier_invoice_number', rotulo: 'Nº del proveedor' },
      { clave: 'supplier_name', rotulo: 'Proveedor' },
      { valor: g => g.expense_category || '—', rotulo: 'Categoría' },
      { clave: 'status', rotulo: 'Estado' },
      { clave: 'base', rotulo: 'Base', formato: 'dinero', align: 'right' },
      { clave: 'total', rotulo: 'Total', formato: 'dinero', align: 'right' },
    ],
    totales: (filas) => {
      const vivas = filas.filter(f => f.status !== 'anulada');
      return [
        { etiqueta: 'Facturas recibidas', valor: filas.length, formato: 'numero' },
        { etiqueta: 'Base (sin las anuladas)', valor: vivas.reduce((a, f) => a + (Number(f.base) || 0), 0) },
        { etiqueta: 'Total gastado (sin las anuladas)', valor: vivas.reduce((a, f) => a + (Number(f.total) || 0), 0), grand: true },
      ];
    },
    vacio: 'No hay gastos ni facturas recibidas con estos filtros.',
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
    // Los tres que traen los listados nuevos. Van aquí y no en cada ruta porque las rutas de los
    // tres verbos son genéricas: si cada listado leyera la URL por su cuenta, volveríamos a tener
    // ocho sitios haciendo lo mismo, que es de lo que huye todo este encargo.
    producto_id: parseInt(g('producto_id'), 10) || null,
    proveedor_id: parseInt(g('proveedor_id'), 10) || null,
  };
}
