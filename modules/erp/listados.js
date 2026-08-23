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
import { dinero, graficoSvg } from './impresion.js';
// FICHA D · PARTE 4 — el informe compuesto sale del MISMO motor del constructor que lo pinta en
// pantalla (`cruzar`), no de una consulta hecha aquí: por eso el papel no puede dar otra cifra.
import { cruzar, panelVisible, areaPerm, AREAS } from './constructor-analitica.js';
import { kardex } from './stock.js';
import { backfillLedger, libroVentas, libroCompras, libroDiario, libroMayor } from './contabilidad.js';
import { ventasAsientos, comprasAsientos } from './contabilidad-export.js';
import { libroBienes } from './contabilidad-bienes.js';
import { cuentaPyG, filasPyG } from './contabilidad-pyg.js';
import { modelo303, modelo130, filas303, filas130 } from './contabilidad-modelos.js';

// EL EJERCICIO POR DEFECTO, EL MISMO QUE USA LA PANTALLA DE CONTABILIDAD: el año de la última
// factura emitida. Se copia de `rangeOf` (contabilidad-routes.js) para que el papel y la pantalla
// hablen del mismo periodo — si cada uno eligiera el suyo, dirían cosas distintas del mismo negocio.
function ejercicio(db, q) {
  if (q && (q.desde || q.hasta)) return { from: q.desde || '1900-01-01', to: q.hasta || '2999-12-31' };
  const y = (db.prepare('SELECT MAX(issue_date) m FROM invoices').get()?.m || '').slice(0, 4)
    || String(new Date().getFullYear());
  return { from: y + '-01-01', to: y + '-12-31' };
}

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// C10-e · LOS SIETE INFORMES CONTABLES, ABSORBIDOS POR EL MOTOR
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Eran SIETE, no cuatro: el registro decía «los cuatro informes contables» y al medirlo salieron
// ventas, compras, diario, mayor, bienes de inversión, pérdidas y ganancias, y los borradores de
// modelos — con seis generadores de HTML propios. Todos pasan aquí, y con ellos ganan lo que no
// tenían: membrete, la cabecera de columnas repetida en cada hoja, «Página X de Y», la declaración
// del periodo… y los tres verbos, porque hasta hoy solo se podían descargar.
//
// ⚠️ EL ARCHIVO OFICIAL NO SE TOCA. El CSV y el XLSX de los libros de ventas y compras llevan 36
// columnas en el orden que exige la AEAT, y eso es un requisito legal, no una decisión de diseño.
// Siguen saliendo por su camino de siempre (`ventasMatrix`/`comprasMatrix` → `toCSV`/`buildXlsx`),
// intactos. El papel usa las columnas legibles. Son dos salidas del MISMO dato y así se quedan.
//
// ⚠️ Y NO SE TOCA NI UNA CIFRA. Estas declaraciones no calculan nada: llaman a las mismas funciones
// de contabilidad que ya alimentaban el papel viejo y solo cambian CÓMO se pinta el resultado.
const RANGO = q => ({ from: q.desde || '', to: q.hasta || '' });
const tasa = r => r === null || r === undefined ? 'sin desglosar' : (Number(r) === 0 ? '0% (exento)' : r + '%');

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FICHA D · PARTE 4 — EL INFORME COMPUESTO, DENTRO DEL MISMO MOTOR
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Un informe que el dueño se ha montado en «Construye tu gráfico» sale por los TRES verbos igual que
// los quince listados de la ficha C: imprimir, PDF y correo, con membrete, cabecera que declara la
// base y «Página X de Y». Sin un generador aparte — si hubiera que escribir HTML de informe aquí,
// esto iría mal.
//
// LA DIFERENCIA CON LOS OTROS QUINCE, y por qué obligó a tocar la fontanería: los quince tienen
// `titulo`, `columnas` y `perm` FIJOS. Un informe compuesto no puede: su título es el nombre que le
// puso el dueño, sus columnas dependen de la medida y su permiso es el del ÁREA de la receta. Así que
// los tres pueden ser función de `(q, db)`, igual que `totales`, `notas` y `secciones` ya podían.
// Ningún listado existente cambia: los que traen un valor fijo lo siguen trayendo.
//
// EL PAPEL LLEVA LAS DOS COSAS: el dibujo arriba (`grafico`) y la tabla con TODAS las filas debajo.
// Salen del MISMO `cruzar`, leído dos veces — por eso no pueden discrepar.
const panelDe = (q, db) => {
  if (!q.panel_id) { const e = new Error('Falta el informe'); e.status = 400; throw e; }
  const p = panelVisible(db, q._userId, q.panel_id);
  if (!p) { const e = new Error('Ese informe no existe o no es tuyo'); e.status = 404; throw e; }
  return p;
};

// El cruce del panel, cacheado por petición: `perm`, `titulo`, `columnas`, `consulta` y `grafico` se
// llaman por separado y no puede cruzarse cinco veces el mismo informe.
function cruceDePanel(db, q) {
  if (q._cache) return q._cache;
  const p = panelDe(q, db);
  const cfg = p.config || {};
  const medida = (cfg.medidas && cfg.medidas[0]) || 'citas';
  const r = cruzar(db, {
    area: cfg.area, dimension: cfg.dimension, medidas: [medida], periodo: cfg.periodo || 'mes',
    filtros: cfg.filtros || {}, formula: cfg.formula || null, limit: 100000, hasPerm: q._hasPerm,
  });
  const clave = r.calculo ? 'calculo' : medida;
  const meta = r.calculo
    ? { etiqueta: 'Cálculo: ' + (cfg.formula || ''), dinero: false, pct: false }
    : (AREAS[cfg.area]?.medidas?.[medida] || { etiqueta: medida, dinero: false, pct: false });
  q._cache = { panel: p, cfg, cruce: r, clave, meta, medida };
  return q._cache;
}

const LISTADO_PANEL = {
  titulo: (q, db) => cruceDePanel(db, q).panel.nombre,
  // EL CANDADO ES EL DEL ÁREA DE LA RECETA, no uno nuevo: quien no puede ver Compras tampoco puede
  // imprimir un informe de Compras que alguien le compartió. `cruzar` lo revalida por dentro además.
  perm: (q, db) => areaPerm(cruceDePanel(db, q).cfg.area) || 'analytics.read',
  filtros: (q, db) => {
    const { cfg, cruce } = cruceDePanel(db, q);
    const A = AREAS[cfg.area];
    const f = [
      { etiqueta: 'Área', valor: A?.etiqueta || cfg.area },
      { etiqueta: 'Mirado por', valor: A?.dimensiones?.[cfg.dimension]?.etiqueta || cfg.dimension },
      { etiqueta: 'Midiendo', valor: cruceDePanel(db, q).meta.etiqueta },
    ];
    if (cruce.usaPeriodo && cfg.dimension === 'fecha') f.push({ etiqueta: 'Agrupado', valor: cfg.periodo || 'mes' });
    if (cfg.formula) f.push({ etiqueta: 'Cálculo propio', valor: cfg.formula });
    for (const [k, vals] of Object.entries(cfg.filtros || {})) {
      if (Array.isArray(vals) && vals.length) f.push({ etiqueta: A?.dimensiones?.[k]?.etiqueta || k, valor: vals.join(', ') });
    }
    // La ventana que se recorrió para la capacidad — sin ella, unas «horas libres» no declaran su base.
    if (cruce.capacidad) f.push({ etiqueta: 'Ventana medida', valor: cruce.capacidad.desde + ' a ' + cruce.capacidad.hasta });
    return f;
  },
  columnas: (q, db) => {
    const { clave, meta } = cruceDePanel(db, q);
    return [
      { clave: 'clave', rotulo: 'Grupo' },
      { clave, rotulo: meta.etiqueta, formato: meta.dinero ? 'dinero' : (meta.pct ? 'pct' : 'decimal'), align: 'right' },
    ];
  },
  consulta: (db, q) => ({ filas: cruceDePanel(db, q).cruce.filas }),
  // EL DIBUJO. Los mismos pares (etiqueta, valor) que la tabla de debajo.
  grafico: (q, db, sym) => {
    const { cruce, clave, cfg, meta } = cruceDePanel(db, q);
    return graficoSvg({
      tipo: cfg.grafico || 'barras', sym, meta,
      etiquetas: cruce.filas.map(f => f.clave),
      valores: cruce.filas.map(f => f[clave]),
      titulo: meta.etiqueta,
    });
  },
  totales: (filas, _extra) => [],
  vacio: 'Este informe no devuelve ninguna fila con la receta guardada.',
  volver: '/admin/analytics',
};

export const LISTADOS = {
  // FICHA D · PARTE 4 — el informe compuesto. Va el primero para que se vea que existe.
  panel: LISTADO_PANEL,

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

  // ══ C10-e · LIBRO DE VENTAS E INGRESOS ═════════════
  'libro-ventas': {
    titulo: 'Libro de ventas e ingresos',
    perm: 'invoices.read',
    volver: '/admin/contabilidad',
    periodo: q => RANGO(q).from || RANGO(q).to ? { desde: q.desde, hasta: q.hasta } : null,
    filtros: () => [{ etiqueta: 'Formato', valor: 'un asiento por línea (AEAT) · copia para gestoría' }],
    consulta: (db, q) => {
      const { from, to } = ejercicio(db, q);
      backfillLedger(db);
      const libro = libroVentas(db, from, to);
      return { filas: ventasAsientos(libro), total: libro.rows.length, extra: libro.totals };
    },
    columnas: [
      { valor: a => String(a.invoice_number || '') + (a.es_rectificativa ? ' (R' + (a.rect_mode ? '·' + a.rect_mode : '') + ')' : ''), rotulo: 'Factura' },
      { clave: 'issue_date', rotulo: 'F. exped.' },
      { valor: a => a.operation_date || '—', rotulo: 'F. oper.' },
      { clave: 'tipo_factura', rotulo: 'Tipo' },
      { clave: 'nif', rotulo: 'NIF' },
      { clave: 'nombre', rotulo: 'Destinatario' },
      { clave: 'base', rotulo: 'Base', formato: 'dinero', align: 'right' },
      { valor: a => tasa(a.rate), rotulo: 'Tipo IVA', align: 'right' },
      { clave: 'cuota', rotulo: 'Cuota', formato: 'dinero', align: 'right' },
      { valor: a => (a.irpf != null && a.irpf !== 0) ? a.irpf : '', rotulo: 'Retención', formato: 'texto', align: 'right' },
      { clave: 'total_linea', rotulo: 'Total línea', formato: 'dinero', align: 'right' },
    ],
    totales: (filas, extra) => [
      { etiqueta: 'Base', valor: (extra && extra.base) || 0 },
      { etiqueta: 'Cuota', valor: (extra && extra.cuota) || 0 },
      { etiqueta: 'Total', valor: (extra && extra.total) || 0, grand: true },
    ],
    vacio: 'Sin operaciones en el periodo.',
  },

  // ══ C10-e · LIBRO DE COMPRAS Y GASTOS ══════════════
  'libro-compras': {
    titulo: 'Libro de compras y gastos',
    perm: 'invoices.read',
    volver: '/admin/contabilidad',
    periodo: q => RANGO(q).from || RANGO(q).to ? { desde: q.desde, hasta: q.hasta } : null,
    filtros: () => [{ etiqueta: 'Formato', valor: 'un asiento por línea (AEAT) · copia para gestoría' }],
    consulta: (db, q) => {
      const { from, to } = ejercicio(db, q);
      backfillLedger(db);
      const libro = libroCompras(db, from, to);
      return { filas: comprasAsientos(libro), total: libro.rows.length, extra: libro.totals };
    },
    columnas: [
      { clave: 'internal_code', rotulo: 'Nº recepción' },
      { clave: 'supplier_number', rotulo: 'Nº fra. prov.' },
      { clave: 'invoice_date', rotulo: 'F. exped.' },
      { valor: a => a.operation_date || '—', rotulo: 'F. oper.' },
      { clave: 'nif', rotulo: 'NIF' },
      { clave: 'nombre', rotulo: 'Expedidor' },
      { clave: 'base', rotulo: 'Base', formato: 'dinero', align: 'right' },
      { valor: a => tasa(a.rate), rotulo: 'Tipo IVA', align: 'right' },
      { clave: 'cuota', rotulo: 'Cuota', formato: 'dinero', align: 'right' },
      { clave: 'total_linea', rotulo: 'Total línea', formato: 'dinero', align: 'right' },
    ],
    totales: (filas, extra) => [
      { etiqueta: 'Base', valor: (extra && extra.base) || 0 },
      { etiqueta: 'Cuota', valor: (extra && extra.cuota) || 0 },
      { etiqueta: 'Total', valor: (extra && extra.total) || 0, grand: true },
    ],
    vacio: 'Sin operaciones en el periodo.',
  },

  // ══ C10-e · LIBRO DIARIO ═══════════════════════════
  // AGRUPADO POR ASIENTO, que es como se lee un diario: una línea de cabecera con la fecha, el
  // número y el tipo, y debajo sus apuntes. El motor ya sabe hacer eso — es la misma pieza que
  // agrupa el catálogo por categoría.
  'libro-diario': {
    titulo: 'Libro diario',
    perm: 'invoices.read',
    volver: '/admin/contabilidad',
    periodo: q => RANGO(q).from || RANGO(q).to ? { desde: q.desde, hasta: q.hasta } : null,
    consulta: (db, q) => {
      const { from, to } = ejercicio(db, q);
      backfillLedger(db);
      const d = libroDiario(db, from, to);
      const filas = [];
      for (const a of d.rows) for (const l of a.lines) {
        filas.push({ ...l, __asiento: a.id, __fecha: a.entry_date, __tipo: a.entry_type, __memo: a.memo || '' });
      }
      return { filas, total: filas.length, extra: { ...d.totals, cuadra: d.cuadra } };
    },
    agrupar: { rotulo: f => f.__fecha + ' · asiento ' + f.__asiento + ' · ' + f.__tipo + (f.__memo ? ' · ' + f.__memo : '') },
    columnas: [
      { clave: 'account_code', rotulo: 'Cuenta' },
      { clave: 'account_name', rotulo: 'Nombre' },
      { clave: 'debit', rotulo: 'Debe', formato: 'dinero0', align: 'right' },
      { clave: 'credit', rotulo: 'Haber', formato: 'dinero0', align: 'right' },
    ],
    totales: (filas, extra) => [
      { etiqueta: 'Debe', valor: (extra && extra.debe) || 0 },
      { etiqueta: 'Haber', valor: (extra && extra.haber) || 0, grand: true },
    ],
    vacio: 'Sin asientos en el periodo.',
  },

  // ══ C10-e · LIBRO MAYOR ════════════════════════════
  'libro-mayor': {
    titulo: 'Libro mayor',
    perm: 'invoices.read',
    volver: '/admin/contabilidad',
    periodo: q => RANGO(q).from || RANGO(q).to ? { desde: q.desde, hasta: q.hasta } : null,
    consulta: (db, q) => {
      const { from, to } = ejercicio(db, q);
      backfillLedger(db);
      const m = libroMayor(db, from, to);
      return { filas: m.rows, total: m.rows.length, extra: m.totals };
    },
    columnas: [
      { clave: 'code', rotulo: 'Cuenta' },
      { clave: 'name', rotulo: 'Nombre' },
      // EL MAYOR SÍ PINTA LOS CEROS, al revés que el diario: su papel usaba `m()` y no `numOrBlank`,
      // y tenía seis ceros escritos. Se conserva tal cual — la comparación cifra a cifra lo cazó
      // cuando puse aquí el mismo formato que en el diario y desapareció uno.
      { clave: 'debe', rotulo: 'Debe', formato: 'dinero', align: 'right' },
      { clave: 'haber', rotulo: 'Haber', formato: 'dinero', align: 'right' },
      { clave: 'saldo', rotulo: 'Saldo', formato: 'dinero', align: 'right' },
    ],
    totales: (filas, extra) => [
      { etiqueta: 'Debe', valor: (extra && extra.debe) || 0 },
      { etiqueta: 'Haber', valor: (extra && extra.haber) || 0, grand: true },
    ],
    vacio: 'Sin movimientos en el periodo.',
  },

  // ══ C10-e · LIBRO DE BIENES DE INVERSIÓN ═══════════
  'libro-bienes': {
    titulo: 'Libro de bienes de inversión',
    perm: 'invoices.read',
    volver: '/admin/contabilidad',
    periodo: q => RANGO(q).from || RANGO(q).to ? { desde: q.desde, hasta: q.hasta } : null,
    consulta: (db, q) => {
      const { from, to } = ejercicio(db, q);
      const l = libroBienes(db, from, to);
      return { filas: l.rows, total: l.rows.length, extra: l.totals };
    },
    columnas: [
      { valor: g => String(g.description || '') + (g.de_baja ? ' (baja ' + g.baja_date + ')' : ''), rotulo: 'Descripción' },
      { clave: 'doc_number', rotulo: 'Documento' },
      { clave: 'supplier_name', rotulo: 'Proveedor' },
      { clave: 'supplier_fiscal_id', rotulo: 'NIF' },
      { clave: 'start_date', rotulo: 'Puesta func.' },
      { clave: 'acquisition_value', rotulo: 'V. adquisición', formato: 'dinero', align: 'right' },
      { clave: 'amortizable_base', rotulo: 'V. amortizable', formato: 'dinero', align: 'right' },
      { valor: g => g.annual_rate, rotulo: '% anual', align: 'right' },
      { clave: 'acuInicio', rotulo: 'Acum. inicio', formato: 'dinero', align: 'right' },
      { clave: 'cuota', rotulo: 'Cuota periodo', formato: 'dinero', align: 'right' },
      { clave: 'acuFinal', rotulo: 'Acum. final', formato: 'dinero', align: 'right' },
      { clave: 'pendiente', rotulo: 'Pendiente', formato: 'dinero', align: 'right' },
    ],
    totales: (filas, extra) => [
      { etiqueta: 'Cuota del periodo', valor: (extra && extra.cuota) || 0 },
      { etiqueta: 'Pendiente de amortizar', valor: (extra && extra.pendiente) || 0, grand: true },
    ],
    vacio: 'Sin bienes registrados.',
  },

  // ══ C10-e · CUENTA DE PÉRDIDAS Y GANANCIAS ═════════
  // AQUÍ VIVEN LOS SUBTOTALES INTERCALADOS. Un P&G con sus subtotales movidos al pie deja de ser un
  // P&G: la lectura es «estas partidas suman ESTO, y de ahí sale lo siguiente». Por eso el motor
  // aprendió a marcar una fila en su sitio, en vez de obligar a este informe a pintarse solo.
  'pyg': {
    titulo: 'Cuenta de pérdidas y ganancias',
    perm: 'invoices.read',
    volver: '/admin/contabilidad',
    periodo: q => RANGO(q).from || RANGO(q).to ? { desde: q.desde, hasta: q.hasta } : null,
    filtros: () => [{ etiqueta: 'Modelo', valor: 'PGC de PYMES (RD 1515/2007) · derivada del libro diario' }],
    consulta: (db, q) => {
      const { from, to } = ejercicio(db, q);
      backfillLedger(db);
      const pyg = cuentaPyG(db, from, to);
      const filas = filasPyG(pyg).map(([etiqueta, nombre, importe, tipo]) => ({ etiqueta, nombre, importe, __sub: tipo === 'subtotal' }));
      return { filas, total: filas.length, extra: { avisos: pyg.warnings || [] } };
    },
    esSubtotal: f => !!f.__sub,
    columnas: [
      { clave: 'etiqueta', rotulo: 'Partida' },
      { clave: 'nombre', rotulo: 'Concepto' },
      { clave: 'importe', rotulo: 'Importe', formato: 'dinero', align: 'right' },
    ],
    notas: (filas, extra) => (extra && extra.avisos) || [],
    tituloNotas: 'Antes de dar el resultado por bueno, revisa:',
    vacio: 'Sin movimientos con los que calcular el resultado.',
  },

  // ══ C10-e · BORRADORES DE MODELOS 303 y 130 ════════
  // AQUÍ VIVEN LAS SECCIONES: es UN papel con DOS tablas, cada una con su título y su propio aviso.
  // Y cada una lleva filas de sección (las que en el modelo van con su epígrafe), que son las mismas
  // filas de grupo que usa el catálogo por categoría.
  'modelos': {
    titulo: 'Borradores de modelos trimestrales',
    perm: 'invoices.read',
    volver: '/admin/contabilidad',
    filtros: q => [{ etiqueta: 'Trimestre', valor: (q.trimestre || '1') + 'T ' + (q.anio || new Date().getFullYear()) }],
    consulta: (db, q) => {
      const year = Number(q.anio) || new Date().getFullYear();
      const qt = Number(q.trimestre) || 1;
      backfillLedger(db);
      const m303 = modelo303(db, year, qt);
      const m130 = modelo130(db, year, qt);
      const aFilas = (fs) => {
        let sec = '';
        return fs.map(([casilla, desc, importe]) => {
          if (casilla === '—') { sec = desc; return null; }
          return { casilla, desc, importe, __sec: sec };
        }).filter(Boolean);
      };
      const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
      return { filas: [], total: 0, extra: { m303, m130, sym, f303: aFilas(filas303(m303)), f130: aFilas(filas130(m130)) } };
    },
    secciones: (filas, extra) => {
      const cols = [
        { clave: 'casilla', rotulo: 'Casilla' },
        { clave: 'desc', rotulo: 'Concepto' },
        // La casilla 65 es un PORCENTAJE y no un importe: lleva %, no moneda. Lo hacía así el papel
        // viejo y se conserva — cambiarlo sería mover lo que el modelo dice.
        { valor: r => r.importe === '' ? '' : (r.casilla === '65' ? r.importe + ' %' : dinero(r.importe, extra.sym)), rotulo: 'Importe', align: 'right' },
      ];
      const agr = { rotulo: r => r.__sec || '' };
      return [
        { titulo: 'Modelo 303 · IVA', columnas: cols, filas: extra.f303, agrupar: agr,
          notas: (extra.m303.warnings || []), tituloNotas: 'Antes de presentar el 303, revisa:' },
        { titulo: 'Modelo 130 · IRPF', columnas: cols, filas: extra.f130, agrupar: agr,
          notas: (extra.m130.warnings || []), tituloNotas: 'Antes de presentar el 130, revisa:' },
      ];
    },
    notas: () => ['Calculados por Bamburu desde los libros registro. Documento de trabajo para revisión y presentación por el obligado o su gestoría: Bamburu no presenta.'],
    vacio: 'Sin datos para el trimestre.',
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
    anio: g('anio') || g('year'),
    trimestre: g('trimestre') || g('q'),
    proveedor_id: parseInt(g('proveedor_id'), 10) || null,
    // FICHA D · PARTE 4 — el informe compuesto. `panel_id` es lo ÚNICO que viaja por la URL: la
    // receta (área, dimensión, medida, periodo, fórmula) se lee de la base a partir del id, NO de la
    // dirección. Si viniera por la URL, cualquiera podría pedir un papel de un área que no puede ver
    // cambiando un parámetro — y el permiso se comprueba sobre el área de la receta guardada.
    panel_id: parseInt(g('panel_id'), 10) || null,
  };
}
