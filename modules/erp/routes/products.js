import { Hono } from 'hono';
import { consultaProductos } from '../listados.js';
import { botonesListado, JS_LISTADO_ENVIAR } from './listados.js';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, rowMenu, emptyRow, skeletonRows } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { productSchema, productImageSchema, variantSchema, tagSchema, stockAdjustSchema, stockLevelsSchema } from '../schemas.js';
import { getVatBands } from '../../../core/vat-bands.js';
import { adjustStock, kardex, productStock, isPhysical, recordMovement, resolveWarehouseId, reservedOfProduct, availableOfProduct, TYPE_LABEL, REASON_LABEL } from '../stock.js';
import { warehouseBreakdown, activeWarehouses } from './warehouses.js';
import { nivelesDeProducto, setNivelesProducto } from '../reposicion.js';
// §4 · el precio del servicio vive aquí. Módulo HOJA (solo depende de db + citas-engine), así que
// importarlo desde products.js no cierra ningún círculo.
import { autoEncenderReservas } from '../reserva-publica-config.js';
import { lotesDeProducto, trazaDeLote, trackingDe } from '../trazabilidad.js';
import { stockModalHtml, stockModalScript } from '../views/stock-modal.js';
import { nextCode } from '../codes.js';
import { ENTITY } from '../../../core/activity-entities.js';

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
}

// P4: escape server-side para la lista de productos renderizada en el servidor.
function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// C2 — búsqueda server-side de productos (clona el patrón de searchClients de T5).
// Coincidencia parcial sobre nombre, SKU y código interno (product_code); solo
// activos. La usan el cuadre de la captura de factura (C2) y su endpoint JSON. NO
// sustituye la API de catálogo completo ni el buscador client-side de line-search.
export function searchProducts(db, { q = '', limit = 20 } = {}) {
  const where = ["status='active'"];
  const params = [];
  if (q) {
    where.push('(name LIKE ? OR sku LIKE ? OR product_code LIKE ?)');
    params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
  }
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return db.prepare(
    'SELECT id, name, sku, product_code, price, tax_band, tax_rate, type FROM products WHERE '
    + where.join(' AND ') + ' ORDER BY name LIMIT ?'
  ).all(...params, lim);
}

// ── SERVICIO VALIDADO COMPARTIDO DE PRODUCTO — única vía de alta (patrón T5) ──
// La usan la ruta POST y la captura de factura (C2: creación de producto al vuelo).
// Resuelve el % de IVA desde la BANDA elegida + país (nunca confía en un número del
// cliente); la banda es OBLIGATORIA (sin defecto silencioso, mismo principio que el
// pendiente de DISA create_product). Físico con stock inicial → siembra 'apertura'.
export function createProductSvc(db, input) {
  const res = productSchema.safeParse(input);
  if (!res.success) {
    const msg = res.error.issues.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    const e = new Error(msg || 'Datos de producto inválidos'); e.status = 400; throw e;
  }
  const d = res.data;
  const cfg = db.prepare('SELECT country, tax_rate FROM company_config WHERE id=1').get() || {};
  const country = (cfg.country || 'ES').toUpperCase();
  const fallbackRate = cfg.tax_rate != null ? cfg.tax_rate : 21;
  const chosen = getVatBands(country, fallbackRate).find(b => b.code === d.tax_band);
  if (!chosen) { const e = new Error('La banda de IVA es obligatoria y debe ser válida'); e.status = 400; throw e; }
  const band = chosen.code, rate = chosen.rate;
  const ptype = d.type || 'physical';
  const tracking = ptype === 'physical' ? (d.tracking || 'none') : 'none';   // solo físicos llevan traza
  // Un producto TRAZADO no nace con stock de apertura: sus unidades entran por recepción/ajuste, que es
  // donde se captura el lote/serie. Así el stock nunca queda sin traza.
  const initialStock = (ptype === 'service' || ptype === 'digital' || tracking !== 'none') ? 0 : (parseInt(d.stock) || 0);
  const code = nextCode(db, 'product');
  const slug = slugify(d.name);
  const r = db.prepare(`INSERT INTO products (name,slug,sku,description,price,compare_price,image_url,category_id,status,type,digital_file_url,featured,stock,supplier_id,tax_rate,tax_band,product_code,tracking) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(d.name, slug, d.sku||'', d.description||'', d.price, d.compare_price||null, d.image_url||'', d.category_id||null, d.status||'active', ptype, d.digital_file_url||'', d.featured?1:0, 0, d.supplier_id||null, rate, band, code, tracking);
  const id = r.lastInsertRowid;
  if (ptype === 'physical' && initialStock > 0) {
    // Capa 2: el stock inicial entra al almacén elegido (principal por defecto).
    recordMovement(db, { product_id: id, type: 'apertura', quantity: initialStock, origin_type: 'opening', warehouse_id: resolveWarehouseId(db, d.warehouse_id), note: 'Stock inicial' });
  }
  if (d.tags?.length) {
    for (const tid of d.tags) {
      try { db.prepare('INSERT OR IGNORE INTO product_tags (product_id,tag_id) VALUES (?,?)').run(id, tid); } catch(_){}
    }
  }
  return { id, name: d.name, product_code: code, tax_band: band, tax_rate: rate };
}

export function createProductRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();
  const tagsViews = new Hono();

  // ── API: PRODUCTS ──────────────────────────────────────────────
  api.get('/', requirePerm('products.read'), c => {
    try {
      const products = db.prepare(`SELECT p.*, c.name as category_name, s.name as supplier_name FROM products p LEFT JOIN categories c ON p.category_id=c.id LEFT JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.name`).all();
      const result = products.map(p => {
        const variants = db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id').all(p.id);
        // PIEZA 2a — reservado GLOBAL (pedidos confirmados) + disponible = stock − reservado.
        // Solo físicos reservan; en el resto reserved=0 y available=stock. Aditivo (no rompe lectores de p.stock).
        const reserved = reservedOfProduct(db, p.id);
        return { ...p, variants, reserved, available: (p.stock || 0) - reserved };
      });
      return c.json(result);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // C2 — búsqueda de productos (JSON). ANTES de '/:id' para que no la capture como id.
  api.get('/search', requirePerm('products.read'), c => {
    try {
      return c.json(searchProducts(db, { q: c.req.query('q') || '', limit: c.req.query('limit') }));
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/:id', requirePerm('products.read'), c => {
    try {
      const p = db.prepare(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?`).get(c.req.param('id'));
      if (!p) return c.json({error:'No encontrado'},404);
      p.images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY position').all(p.id);
      p.variants = db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id').all(p.id);
      p.tags = db.prepare('SELECT t.* FROM tags t JOIN product_tags pt ON pt.tag_id=t.id WHERE pt.product_id=?').all(p.id);
      return c.json(p);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/', requirePerm('products.create'), validate(productSchema), async c => {
    try {
      const r = createProductSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó producto', ENTITY.PRODUCT, r.id, r.name);
      return c.json({id:r.id, message:'Creado'});
    } catch(e) { return c.json({error:safeError(e)}, e.status||500); }
  });

  // ── Pilar 3 · Paso 1 — stock de un producto (caché + kardex) ──────────────
  // GET stock actual (caché derivada) + kardex (movimientos con saldo corriente, si está
  // revertido y el origen). Solo físicos llevan kardex; service/digital → physical:false.
  api.get('/:id/stock', requirePerm('products.read'), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const p = db.prepare('SELECT id, name, type FROM products WHERE id=?').get(id);
      if (!p) return c.json({ error: 'Producto no encontrado' }, 404);
      const physical = isPhysical(db, p);
      if (!physical) return c.json({ physical: false, stock: 0, movements: [] });
      const movements = kardex(db, id).map(m => ({
        id: m.id, type: m.type, type_label: TYPE_LABEL[m.type] || m.type,
        quantity: m.quantity, reason: m.reason, reason_label: m.reason ? (REASON_LABEL[m.reason] || m.reason) : null,
        origin_type: m.origin_type, origin_id: m.origin_id, note: m.note,
        created_at: m.created_at, balance: m.balance, reversed: m.reversed, is_reversal: m.is_reversal,
      }));
      // Multi-almacén · Capa 1: desglose por almacén activo (solo lectura; al vuelo).
      // PIEZA 2a: + reservado/disponible GLOBAL y por almacén (warehouseBreakdown ya los trae).
      const reserved = reservedOfProduct(db, id);
      const stock = productStock(db, id);
      return c.json({ physical: true, stock, reserved, available: stock - reserved, movements, by_warehouse: warehouseBreakdown(db, id) });
    } catch(e) { return c.json({ error: safeError(e) }, 500); }
  });

  // POST ajuste manual: crea UN movimiento type='ajuste' con el delta (poner/sumar/restar).
  // Doble seguro en backend: rechaza 400 si el producto no es físico (no solo en la UI).
  api.post('/:id/stock/adjust', requirePerm('inventory.edit'), validate(stockAdjustSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const d = c.get('validated');
      const res = adjustStock(db, id, { mode: d.mode, value: d.value, reason: d.reason, note: d.note, warehouse_id: d.warehouse_id }, { confirmBelowReserved: d.confirm_below_reserved });
      logActivity(db, c.get('session'), 'Ajustó stock', ENTITY.PRODUCT, id, `${d.mode} ${d.value} (${d.reason}) → ${res.stock}`);
      return c.json(res);
    } catch(e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  api.put('/:id', requirePerm('products.edit'), validate(productSchema), async c => {
    try {
      const id = c.req.param('id');
      const d = c.get('validated');
      // IVA OBLIGATORIO también al editar: la banda debe venir y ser válida (sin defecto silencioso).
      const cfg = db.prepare('SELECT country, tax_rate FROM company_config WHERE id=1').get() || {};
      const country = (cfg.country || 'ES').toUpperCase();
      const fallbackRate = cfg.tax_rate != null ? cfg.tax_rate : 21;
      const chosen = getVatBands(country, fallbackRate).find(b => b.code === d.tax_band);
      if (!chosen) return c.json({ error: 'La banda de IVA es obligatoria y debe ser válida' }, 400);
      const band = chosen.code, rate = chosen.rate;
      // Trazabilidad (Pilar 3): solo físicos; y NO se puede cambiar si el producto ya tiene movimientos
      // de stock (su stock existente no tendría lote → el libro quedaría descuadrado). Deja el stock a 0.
      const cur = db.prepare('SELECT tracking FROM products WHERE id=?').get(id) || {};
      const nuevoTracking = (d.type || 'physical') === 'physical' ? (d.tracking || 'none') : 'none';
      if (nuevoTracking !== (cur.tracking || 'none') && db.prepare('SELECT 1 FROM stock_movements WHERE product_id=? LIMIT 1').get(id)) {
        return c.json({ error: 'No puedes cambiar la trazabilidad de un producto que ya tiene movimientos de stock. Deja su stock a 0 primero, o crea un producto nuevo.' }, 400);
      }
      db.prepare(`UPDATE products SET name=?,sku=?,description=?,price=?,compare_price=?,image_url=?,category_id=?,status=?,type=?,digital_file_url=?,featured=?,supplier_id=?,tax_rate=?,tax_band=?,tracking=? WHERE id=?`)
        .run(d.name, d.sku||'', d.description||'', d.price, d.compare_price||null, d.image_url||'', d.category_id||null, d.status||'active', d.type||'physical', d.digital_file_url||'', d.featured?1:0, d.supplier_id||null, rate, band, nuevoTracking, id);
      if (d.tags !== undefined) {
        db.prepare('DELETE FROM product_tags WHERE product_id=?').run(id);
        for (const tid of (d.tags||[])) {
          try { db.prepare('INSERT OR IGNORE INTO product_tags (product_id,tag_id) VALUES (?,?)').run(id, tid); } catch(_){}
        }
      }
      logActivity(db, c.get('session'), 'Editó producto', ENTITY.PRODUCT, id, d.name);
      // §4 — el PRECIO de un servicio vive aquí, en el catálogo, no en la agenda. Ponérselo es lo que
      // cumple la segunda condición para que la página de reservas se encienda sola, así que el
      // enganche tiene que estar también en esta puerta o el automatismo se queda cojo por el lado más
      // natural: crear el servicio a 0 € y ponerle precio en Productos.
      if ((d.type || 'physical') === 'service') autoEncenderReservas(db);
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── Pilar 3 · Stock mínimo / punto de pedido — NIVELES DE REPOSICIÓN por almacén ──────────
  // Config del producto (ver con products.read, tocar con products.edit), solo para físicos. No mueve
  // stock ni WAC: solo dice cuándo avisar y hasta cuánto reponer. Ver reposicion.js.
  api.get('/:id/niveles', requirePerm('products.read'), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const p = db.prepare('SELECT id, type FROM products WHERE id=?').get(id);
      if (!p) return c.json({ error: 'Producto no encontrado' }, 404);
      if (!isPhysical(db, p)) return c.json({ fisico: false, niveles: [] });
      return c.json({ fisico: true, niveles: nivelesDeProducto(db, id) });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });
  api.put('/:id/niveles', requirePerm('products.edit'), validate(stockLevelsSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const p = db.prepare('SELECT id, type, name FROM products WHERE id=?').get(id);
      if (!p) return c.json({ error: 'Producto no encontrado' }, 404);
      if (!isPhysical(db, p)) return c.json({ error: 'Los niveles de stock solo aplican a productos físicos.' }, 400);
      const quien = c.get('session')?.userName || c.get('session')?.userId || '';
      setNivelesProducto(db, id, c.get('validated').levels, quien);
      logActivity(db, c.get('session'), 'Editó niveles de reposición', ENTITY.PRODUCT, id, p.name || '');
      return c.json({ ok: true, message: 'Niveles guardados' });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // ── Pilar 3 · Trazabilidad — LOTES / SERIES de un producto (informe) ──────────
  // Lotes/series con su saldo actual y caducidad. Y la traza de un lote concreto (?lot=ID): sus
  // movimientos con el documento que los originó, para "¿de dónde vino / a dónde fue?".
  api.get('/:id/lotes', requirePerm('products.read'), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const lotId = c.req.query('lot');
      if (lotId) return c.json({ traza: trazaDeLote(db, parseInt(lotId)) });
      return c.json({ tracking: trackingDe(db, id), lotes: lotesDeProducto(db, id) });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  api.delete('/:id', requirePerm('products.delete'), c => {
    try {
      const p = db.prepare('SELECT name FROM products WHERE id=?').get(c.req.param('id'));
      db.prepare('DELETE FROM products WHERE id=?').run(c.req.param('id'));
      logActivity(db, c.get('session'), 'Eliminó producto', ENTITY.PRODUCT, c.req.param('id'), p?.name||'');
      return c.json({message:'Eliminado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── API: IMAGES ────────────────────────────────────────────────
  api.get('/:id/images', requirePerm('products.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY position').all(c.req.param('id'))); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/:id/images', requirePerm('products.edit'), validate(productImageSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO product_images (product_id,url,alt,position) VALUES (?,?,?,?)').run(c.req.param('id'), d.url, d.alt||'', d.position||0);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.delete('/:id/images/:imgId', requirePerm('products.edit'), c => {
    try { db.prepare('DELETE FROM product_images WHERE id=? AND product_id=?').run(c.req.param('imgId'), c.req.param('id')); return c.json({message:'Eliminada'}); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── API: VARIANTS ──────────────────────────────────────────────
  api.get('/:id/variants', requirePerm('products.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id').all(c.req.param('id'))); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/:id/variants', requirePerm('products.edit'), validate(variantSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO product_variants (product_id,name,option1_name,option1_value,option2_name,option2_value,sku,price,stock) VALUES (?,?,?,?,?,?,?,?,?)').run(c.req.param('id'), d.name, d.option1_name||'', d.option1_value||'', d.option2_name||'', d.option2_value||'', d.sku||'', d.price||null, d.stock||0);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.put('/:id/variants/:vid', requirePerm('products.edit'), validate(variantSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE product_variants SET name=?,option1_name=?,option1_value=?,option2_name=?,option2_value=?,sku=?,price=?,stock=? WHERE id=? AND product_id=?').run(d.name, d.option1_name||'', d.option1_value||'', d.option2_name||'', d.option2_value||'', d.sku||'', d.price||null, d.stock||0, c.req.param('vid'), c.req.param('id'));
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.delete('/:id/variants/:vid', requirePerm('products.edit'), c => {
    try { db.prepare('DELETE FROM product_variants WHERE id=? AND product_id=?').run(c.req.param('vid'), c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── API: TAGS ──────────────────────────────────────────────────
  api.get('/tags/all', requirePerm('tags.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM tags ORDER BY name').all()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/tags/create', requirePerm('tags.create'), validate(tagSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(d.name.trim());
      const tag = db.prepare('SELECT * FROM tags WHERE name=?').get(d.name.trim());
      return c.json(tag);
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.delete('/tags/:id', requirePerm('tags.delete'), c => {
    try { db.prepare('DELETE FROM tags WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminada'}); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── VIEWS ──────────────────────────────────────────────────────
  views.get('/', requirePerm('products.read'), c => {
    const cfgRow = db.prepare('SELECT currency_symbol, tax_rate, country FROM company_config WHERE id=1').get() || {};
    const sym = cfgRow.currency_symbol || '€';
    const country = (cfgRow.country || 'ES').toUpperCase();
    const fallbackRate = cfgRow.tax_rate != null ? cfgRow.tax_rate : 21;
    const vatBands = getVatBands(country, fallbackRate);   // bandas del país (hoy ES); no quemadas en la pantalla
    const vatBandsJson = JSON.stringify(vatBands);
    // Capa 2: almacén del stock inicial (apertura) al crear un producto físico; principal por defecto.
    const warehouses = activeWarehouses(db);
    const whInitOptions = warehouses.map(w => '<option value="'+w.id+'"'+(w.is_default?' selected':'')+'>'+escHtml(w.name)+(w.is_default?' (principal)':'')+'</option>').join('');

    // P4: búsqueda (nombre/SKU), filtro por categoría y paginación, todo por URL (GET).
    const q = (c.req.query('q') || '').trim();
    const categoria = (c.req.query('categoria') || '').trim();
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    // ── LA MISMA CONSULTA QUE EL PDF (tarea C, tanda 1) ────────────────────────────────────────
    // Vive en `listados.js` y la piden por igual esta pantalla y las tres rutas de imprimir /
    // descargar / enviar. La única diferencia es `limit`: aquí una página, allí todo.
    const totalPrev = consultaProductos(db, { q, categoria, limit: 1 }).total;
    const totalPages = Math.max(1, Math.ceil(totalPrev / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const { filas: products, total } = consultaProductos(db, { q, categoria, limit: perPage, offset });
    // Los filtros VIGENTES, para que los tres verbos impriman lo que se está viendo.
    const qsListado = (() => { const u = new URLSearchParams(); if (q) u.set('q', q); if (categoria) u.set('categoria', categoria); return u.toString(); })();

    const categories = db.prepare('SELECT id, name FROM categories ORDER BY name').all();
    const catOptions = categories.map(cat =>
      '<option value="' + cat.id + '"' + (String(cat.id) === categoria ? ' selected' : '') + '>' + escHtml(cat.name) + '</option>'
    ).join('');

    // Conserva q y categoria al cambiar de página.
    const buildQs = (p) => {
      const u = new URLSearchParams();
      if (q) u.set('q', q);
      if (categoria) u.set('categoria', categoria);
      u.set('page', String(p));
      return u.toString();
    };

    const statusB = { active:'<span class="badge b-green">Activo</span>', draft:'<span class="badge b-yellow">Borrador</span>', archived:'<span class="badge b-gray">Archivado</span>' };
    const rowsHtml = products.map(p => '<tr>'+
      '<td>'+(p.image_url?'<img class="thumb" src="'+escHtml(p.image_url)+'" alt="">':'<span style="font-size:1.2rem"></span>')+'</td>'+
      '<td><strong>'+escHtml(p.name)+'</strong>'+(p.featured?'  <span class="badge b-purple">Destacado</span>':'')+'<br><span style="color:var(--muted);font-size:.75rem"><span style="font-family:monospace">'+escHtml(p.product_code||'-')+'</span> · SKU: '+escHtml(p.sku||'-')+'</span></td>'+
      '<td>'+escHtml(p.category_name||'-')+'</td>'+
      '<td><strong>'+sym+p.price.toFixed(2)+'</strong>'+(p.compare_price?'<br><span style="text-decoration:line-through;color:var(--muted);font-size:.75rem">'+sym+p.compare_price.toFixed(2)+'</span>':'')+'<br><span style="color:var(--muted);font-size:.72rem">'+(Number(p.tax_rate)>0?('IVA '+p.tax_rate+'%'):'Exento')+'</span></td>'+
      '<td>'+(p.type==='service'?'<span style="color:var(--muted)">—</span>':(p.stock<5?'<span style="color:var(--danger);font-weight:500">'+p.stock+'</span>':p.stock))+'</td>'+
      '<td>'+(statusB[p.status]||escHtml(p.status))+'</td>'+
      '<td><span class="badge b-gray">'+(p.type==='digital'?'Digital':p.type==='service'?'Servicio':'Físico')+'</span></td>'+
      '<td style="white-space:nowrap">'+(can(c,'products.edit')?'<button class="btn btn-secondary btn-sm" onclick="editProd('+p.id+')">Editar</button> ':'')+(can(c,'products.delete')?rowMenu([{label:'Eliminar',danger:true,onclick:'delProd('+p.id+')'}]):'')+'</td>'+
      '</tr>').join('');

    const content = `
      <div class="ph">
        <h2>Productos</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${escHtml(q)}" placeholder="Buscar por nombre o código...">
          <select class="form-control" name="categoria" style="width:auto;min-width:180px">
            <option value="">Todas las categorías</option>
            ${catOptions}
          </select>
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'products.create') ? '<button type="button" class="btn btn-primary" id="btnNuevoProd">Nuevo producto</button>' : ''}
        </form>
      </div>
      <!-- C9 · LOS TRES VERBOS, dos veces: el listado interno (con stock) y la LISTA DE PRECIOS, que
           es la que sale por la puerta — sin coste ni stock y con el IVA ya sumado. Son dos papeles
           distintos sobre LA MISMA consulta: lo que cambia son las columnas, no los datos. -->
      <div style="margin:-.5rem 0 1rem;display:flex;gap:1.2rem;flex-wrap:wrap;align-items:center">
        <span style="display:inline-flex;gap:.4rem;align-items:center"><span style="font-size:.78rem;color:var(--text3);font-weight:600">Listado</span>${botonesListado('productos', qsListado)}</span>
        <span style="display:inline-flex;gap:.4rem;align-items:center"><span style="font-size:.78rem;color:var(--text3);font-weight:600">Lista de precios</span>${botonesListado('precios', qsListado)}</span>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Imagen</th><th>Nombre</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Tipo</th><th></th></tr></thead>
            <tbody id="prodBody">${total === 0 ? ((q || categoria) ? emptyRow(8, 'No se encontraron productos con ese filtro.', { icon: 'ti-search' }) : emptyRow(8, 'Tu catálogo está vacío. ¿Añadimos el primer producto o servicio?', can(c, 'products.create') ? { cta: 'Nuevo producto', onclick: 'openNewProduct()' } : {})) : rowsHtml}</tbody>
          </table>
        </div>
      </div>

      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--muted);font-size:.85rem">Página ${page} de ${totalPages} · ${total} producto${total === 1 ? '' : 's'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div>
      </div>` : ''}

      <!-- Modal Producto -->
      <div class="modal-overlay" id="productModal">
        <div class="modal" style="max-width:680px">
          <div class="modal-head"><h3 id="modalTitle">Nuevo Producto</h3><button class="modal-close" onclick="closeModal('productModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="prodId">
            <div class="form-group" id="pCodeWrap" style="display:none"><label class="form-label">Código interno</label><div id="pCode" style="font-family:monospace;color:var(--muted)"></div></div>
            <div class="tabs">
              <div class="tab active" data-tab-group="prod" data-tab-key="basic" onclick="switchTab('prod','basic')">General</div>
              <!-- Imágenes OCULTA de la vista (e-commerce); botón con display:none, panel sigue en el DOM para no romper el JS de editar. Variantes SÍ se mantiene (necesaria). -->
              <div class="tab" data-tab-group="prod" data-tab-key="images" onclick="switchTab('prod','images')" style="display:none">Imágenes</div>
              <div class="tab" data-tab-group="prod" data-tab-key="variants" onclick="switchTab('prod','variants')">Variantes</div>
              <!-- OCULTO de la vista (e-commerce SEO, no aplica a gestión/facturación). Código conservado:
              <div class="tab" data-tab-group="prod" data-tab-key="seo" onclick="switchTab('prod','seo')">Avanzado</div>
              -->
            </div>
            <div class="tab-pane active" data-pane-group="prod" data-pane-key="basic">
              <div class="form-row">
                <div class="form-group"><label class="form-label">Tipo *</label><select class="form-control" id="pType"><option value="physical">Físico</option><option value="digital">Digital</option><option value="service">Servicio</option></select></div>
                <div class="form-group" id="pTrackingWrap" style="display:none">
                  <label class="form-label">Trazabilidad</label>
                  <select class="form-control" id="pTracking" onchange="applyTypeUI(document.getElementById('pType').value)">
                    <option value="none">Sin traza</option>
                    <option value="lot">Por lote (con caducidad)</option>
                    <option value="serial">Por nº de serie</option>
                  </select>
                  <small style="color:var(--text2);font-size:12px;margin-top:4px;display:block">Con traza, el stock entra por recepción de compra (capturas el lote y su caducidad, o el nº de serie) y sale por mostrador/albarán con FEFO (primero el que antes caduca). No se puede cambiar si el producto ya tiene movimientos de stock.</small>
                </div>
                <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="pName"></div>
                <div class="form-group"><label class="form-label">SKU *</label><input class="form-control" id="pSku"></div>
              </div>
              <div class="form-group" style="display:none"><!-- OCULTO: pensada para la tienda online --><label class="form-label">Descripción</label><textarea class="form-control" id="pDesc" rows="3"></textarea></div>
              <div class="form-row">
                <div class="form-group"><label class="form-label">Precio *</label><input class="form-control" type="number" id="pPrice" step="0.01"></div>
                <div class="form-group"><label class="form-label">Tipo de IVA *</label><select class="form-control" id="pTaxBand"></select></div>
                <div class="form-group" style="display:none"><label class="form-label">Precio antes (tachado)</label><input class="form-control" type="number" id="pCompare" step="0.01"></div><!-- OCULTO: promoción de tienda online -->
                <div class="form-group" id="pStockWrap"><label class="form-label">Stock inicial</label><input class="form-control" type="number" id="pStock" value="0"></div>
                <div class="form-group" id="pWarehouseWrap"><label class="form-label">Almacén del stock inicial</label><select class="form-control" id="pWarehouse">${whInitOptions}</select></div>
                <div class="form-group" id="pStockManage" style="display:none"><label class="form-label">Stock</label><div><button type="button" class="btn btn-secondary btn-sm" onclick="openStockKardex(currentProdId, document.getElementById('pName').value)">Gestionar stock (kardex · ajustar)</button></div></div>
                <div class="form-group" id="pNivelesWrap" style="display:none">
                  <label class="form-label">Niveles de reposición por almacén</label>
                  <p style="font-size:.75rem;color:var(--muted);margin:-.2rem 0 .5rem">Cuando el <strong>disponible</strong> de un almacén baja de su <strong>mínimo</strong>, DISA te avisa y —si el producto tiene proveedor habitual— te prepara un borrador de compra hasta el <strong>objetivo</strong>. Mínimo en 0 = no se vigila ese almacén.</p>
                  <div id="pNivelesBody" style="font-size:.85rem"></div>
                  <button type="button" class="btn btn-secondary btn-sm" style="margin-top:.5rem" onclick="guardarNiveles()">Guardar niveles</button>
                </div>
                <div class="form-group" id="pLotesWrap" style="display:none">
                  <label class="form-label">Lotes / nº de serie</label>
                  <div id="pLotesBody" style="font-size:.85rem"></div>
                </div>
                <div class="form-group" id="pAvgCostWrap" style="display:none"><label class="form-label">Coste medio</label><div id="pAvgCost" style="padding:.55rem 0;font-weight:600">—</div><div style="font-size:.7rem;color:var(--muted)">Se gana desde las compras (no editable)</div></div>
              </div>
              <div style="font-size:.72rem;color:var(--muted);margin:-.5rem 0 .25rem">
                <a href="https://sede.agenciatributaria.gob.es/Sede/iva.html" target="_blank" rel="noopener" style="color:var(--teal)">Tipos de IVA oficiales (AEAT) ↗</a>
                &nbsp;·&nbsp; ¿Dudas sobre qué IVA aplicar? Pregunta a DISA.
              </div>
              <div class="form-row">
                <div class="form-group"><label class="form-label">Categoría</label><select class="form-control" id="pCategory"><option value="">Sin categoría</option></select></div>
                <div class="form-group"><label class="form-label">Estado</label><select class="form-control" id="pStatus"><option value="active">Activo</option><option value="draft">Borrador</option><option value="archived">Archivado</option></select></div>
              </div>
              <div class="form-group" style="display:none"><!-- OCULTO: imagen es escaparate de tienda --><label class="form-label">URL imagen principal</label><input class="form-control" id="pImage" placeholder="https://..."></div>
              <div class="form-group" id="pDigitalWrap" style="display:none"><label class="form-label">URL archivo digital</label><input class="form-control" id="pDigital"></div>
              <div class="form-group" style="display:none"><!-- OCULTO: destacado es escaparate de tienda -->
                <label class="form-label"><input type="checkbox" id="pFeatured"> Producto destacado (aparece primero en la tienda)</label>
              </div>
              <div class="form-group">
                <label class="form-label">Proveedor</label>
                <select class="form-control" id="pSupplier"><option value="">Sin proveedor</option></select>
              </div>
              <div class="form-group" style="display:none"><!-- OCULTO: etiquetas pensadas para la tienda online -->
                <label class="form-label">Etiquetas</label>
                <div id="tagSelector" style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.5rem"></div>
                <div style="display:flex;gap:.5rem">
                  <input class="form-control" id="newTagInput" placeholder="Nueva etiqueta...">
                  <button class="btn btn-secondary btn-sm" onclick="addTag()">Agregar</button>
                </div>
              </div>
            </div>
            <div class="tab-pane" data-pane-group="prod" data-pane-key="images">
              <p style="font-size:.82rem;color:var(--muted);margin-bottom:1rem">Galería de imágenes adicionales del producto (guardar el producto primero).</p>
              <div style="display:flex;gap:.5rem;margin-bottom:1rem">
                <input class="form-control" id="imgUrl" placeholder="URL de imagen...">
                <input class="form-control" id="imgAlt" placeholder="Texto alternativo..." style="flex:.6">
                <button class="btn btn-primary btn-sm" onclick="addImage()">Agregar</button>
              </div>
              <div id="imageGallery" style="display:flex;flex-wrap:wrap;gap:.5rem"></div>
            </div>
            <div class="tab-pane" data-pane-group="prod" data-pane-key="variants">
              <p style="font-size:.82rem;color:var(--muted);margin-bottom:1rem">Variantes permiten tener diferentes combinaciones (talla/color) con precio y stock propio.</p>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:.75rem">
                <div><label class="form-label" style="font-size:.75rem">Nombre variante</label><input class="form-control" id="varName" placeholder="Ej: Rojo / L"></div>
                <div><label class="form-label" style="font-size:.75rem">Precio (vacío = precio base)</label><input class="form-control" type="number" id="varPrice" step="0.01"></div>
                <div><label class="form-label" style="font-size:.75rem">Stock</label><input class="form-control" type="number" id="varStock" value="0"></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:.5rem;margin-bottom:1rem;align-items:end">
                <div>
                  <label class="form-label" style="font-size:.75rem">Atributo 1 (ej: Talla)</label>
                  <input class="form-control" id="vOpt1Name" placeholder="Ej: Talla" style="margin-bottom:4px">
                  <input class="form-control" id="vOpt1Val" placeholder="Ej: M">
                </div>
                <div>
                  <label class="form-label" style="font-size:.75rem">Atributo 2 (ej: Color)</label>
                  <input class="form-control" id="vOpt2Name" placeholder="Ej: Color" style="margin-bottom:4px">
                  <input class="form-control" id="vOpt2Val" placeholder="Ej: Rojo">
                </div>
                <div>
                  <label class="form-label" style="font-size:.75rem">SKU</label>
                  <input class="form-control" id="vSku" placeholder="Opcional">
                </div>
                <button class="btn btn-primary btn-sm" style="margin-top:1.4rem" onclick="addVariant()">+</button>
              </div>
              <div id="variantList"></div>
            </div>
            <!-- OCULTO de la vista (e-commerce SEO, no aplica a gestión/facturación). Código y campos conservados:
            <div class="tab-pane" data-pane-group="prod" data-pane-key="seo">
              <div class="form-group"><label class="form-label">SEO: Título de página</label><input class="form-control" id="pSeoTitle" placeholder="Título para buscadores..."></div>
              <div class="form-group"><label class="form-label">SEO: Meta descripción</label><textarea class="form-control" id="pSeoDesc" rows="2" placeholder="Descripción para buscadores..."></textarea></div>
            </div>
            -->
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" onclick="closeModal('productModal')">Cancelar</button>
            <button class="btn btn-primary" onclick="saveProduct()">Guardar</button>
          </div>
        </div>
      </div>

      ${stockModalHtml()}
      <script>
      ${JS_LISTADO_ENVIAR}
      ${stockModalScript(sym, warehouses)}
      const A='/api/erp';
      const VAT_BANDS=${vatBandsJson};   // bandas de IVA del país (P1+P2 refinamiento)
      let allTags=[], allCats=[], allSuppliers=[], selTags=[], currentProdId=null;

      // Rellena el selector de banda de IVA. Etiqueta clara + % + ejemplo corto.
      (function initVatBands(){
        const sel=document.getElementById('pTaxBand');
        // Opción en blanco al inicio: el IVA es obligatorio, hay que elegirlo.
        sel.innerHTML='<option value="">— Selecciona —</option>'+VAT_BANDS.map(b=>{
          // Solo el monto (%); sin etiqueta de banda ni ejemplo. El value sigue siendo la banda.
          return '<option value="'+b.code+'">'+b.rate+'%</option>';
        }).join('');
      })();
      function bandRate(code){const b=VAT_BANDS.find(x=>x.code===code);return b?b.rate:null;}

      // P4: la lista la renderiza el servidor (búsqueda/filtro/paginación por URL).
      // Aquí solo se cargan las categorías/proveedores/etiquetas que necesita el modal.
      async function loadAll(){
        [allTags, allCats, allSuppliers]=await Promise.all([
          api('GET',A+'/products/tags/all').catch(()=>[]),
          api('GET',A+'/categories').catch(()=>[]),
          api('GET',A+'/suppliers').catch(()=>[])
        ]);
        const catSel=document.getElementById('pCategory');
        catSel.innerHTML='<option value="">Sin categoría</option>'+allCats.map(c=>'<option value="'+c.id+'">'+escHtml(c.name)+'</option>').join('');
        const supSel=document.getElementById('pSupplier');
        supSel.innerHTML='<option value="">Sin proveedor</option>'+allSuppliers.map(s=>'<option value="'+s.id+'">'+escHtml(s.name)+'</option>').join('');
      }

      function escHtml(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
      // P1+P2: el tipo decide qué campos aplican. Digital → muestra URL de archivo.
      // Servicio y digital → no llevan stock (CANON §2), se oculta el campo Stock.
      function applyTypeUI(t){
        // URL archivo digital OCULTA de la vista (entrega de tienda online). El campo
        // sigue en el DOM (#pDigitalWrap, display:none de base); no se muestra para ningún tipo.
        // Pilar 3: el stock es caché derivada del libro. En CREAR (físico) se ofrece "Stock
        // inicial" (siembra apertura); en EDITAR (físico) se gestiona por el kardex, no a mano.
        const physical = !(t==='service' || t==='digital');
        const isEdit = !!currentProdId;
        const trw = document.getElementById('pTrackingWrap');   // traza (lote/serie): solo físicos
        if (trw) trw.style.display = physical ? '' : 'none';
        // Un producto TRAZADO no tiene stock inicial de apertura (entra por recepción, con su lote).
        const tracked = physical && (document.getElementById('pTracking')?.value || 'none') !== 'none';
        document.getElementById('pStockWrap').style.display = (physical && !isEdit && !tracked) ? '' : 'none';
        const whw = document.getElementById('pWarehouseWrap');   // almacén del stock inicial: solo crear+físico
        if (whw) whw.style.display = (physical && !isEdit && !tracked) ? '' : 'none';
        const mng = document.getElementById('pStockManage');
        if (mng) mng.style.display = (physical && isEdit) ? '' : 'none';
        const nvw = document.getElementById('pNivelesWrap');   // niveles de reposición: solo editar+físico
        if (nvw) nvw.style.display = (physical && isEdit) ? '' : 'none';
        const lw = document.getElementById('pLotesWrap');      // lotes/series: solo editar + trazado
        if (lw) lw.style.display = (tracked && isEdit) ? '' : 'none';
        // Coste medio (WAC): solo lectura, solo en EDITAR de un físico (se gana desde compras).
        const avgw = document.getElementById('pAvgCostWrap');
        if (avgw) avgw.style.display = (physical && isEdit) ? '' : 'none';
      }
      document.getElementById('pType').addEventListener('change',e=>applyTypeUI(e.target.value));

      function openNewProduct(){
        currentProdId=null; selTags=[];
        document.getElementById('pCodeWrap').style.display='none';
        document.getElementById('modalTitle').textContent='Nuevo Producto';
        ['pName','pSku','pDesc','pPrice','pCompare','pImage','pDigital'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('pStock').value='0';
        document.getElementById('pTaxBand').value='';
        document.getElementById('pStatus').value='active';
        document.getElementById('pType').value='physical';
        document.getElementById('pTracking').value='none';
        document.getElementById('pFeatured').checked=false;
        applyTypeUI('physical');
        document.getElementById('pCategory').value='';
        document.getElementById('pSupplier').value='';
        document.getElementById('imageGallery').innerHTML='';
        document.getElementById('variantList').innerHTML='';
        renderTagSelector();
        openModal('productModal');
      }
      const _btnNew=document.getElementById('btnNuevoProd'); if(_btnNew) _btnNew.onclick=openNewProduct;

      async function editProd(id){
        const p=await api('GET',A+'/products/'+id);
        currentProdId=id;
        selTags=p.tags.map(t=>t.id);
        document.getElementById('modalTitle').textContent='Editar Producto';
        document.getElementById('prodId').value=id;
        document.getElementById('pCode').textContent=p.product_code||'—';
        document.getElementById('pCodeWrap').style.display=p.product_code?'':'none';
        document.getElementById('pName').value=p.name;
        document.getElementById('pSku').value=p.sku||'';
        document.getElementById('pDesc').value=p.description||'';
        document.getElementById('pPrice').value=p.price;
        document.getElementById('pCompare').value=p.compare_price||'';
        document.getElementById('pStock').value=p.stock;
        document.getElementById('pAvgCost').textContent='${sym}'+Number(p.average_cost||0).toFixed(2);
        document.getElementById('pTaxBand').value=p.tax_band||'general';
        document.getElementById('pImage').value=p.image_url||'';
        document.getElementById('pDigital').value=p.digital_file_url||'';
        document.getElementById('pStatus').value=p.status||'active';
        document.getElementById('pType').value=p.type||'physical';
        document.getElementById('pTracking').value=p.tracking||'none';
        document.getElementById('pFeatured').checked=!!p.featured;
        document.getElementById('pCategory').value=p.category_id||'';
        document.getElementById('pSupplier').value=p.supplier_id||'';
        applyTypeUI(p.type||'physical');
        if ((p.type||'physical')==='physical') cargarNiveles(id); else document.getElementById('pNivelesBody').innerHTML='';
        if ((p.tracking||'none')!=='none') cargarLotes(id); else document.getElementById('pLotesBody').innerHTML='';
        renderTagSelector();
        renderGallery(p.images||[]);
        renderVariantList(p.variants||[]);
        openModal('productModal');
      }

      // Niveles de reposición (stock mínimo/objetivo por almacén) — Pilar 3. Se cargan al editar un
      // producto físico y se guardan con su propio botón (independiente del guardado del producto).
      function nvEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
      async function cargarNiveles(id){
        const body=document.getElementById('pNivelesBody');
        body.innerHTML='<span style="color:var(--muted)">Cargando…</span>';
        try{
          const r=await api('GET',A+'/products/'+id+'/niveles');
          if(!r.fisico){ body.innerHTML='<span style="color:var(--muted)">Solo para productos físicos.</span>'; return; }
          if(!r.niveles.length){ body.innerHTML='<span style="color:var(--muted)">No hay almacenes activos.</span>'; return; }
          body.innerHTML='<table style="width:100%;border-collapse:collapse">'
            +'<thead><tr style="color:var(--muted);text-align:left">'
            +'<th style="padding:.2rem .4rem;font-weight:600">Almacén</th>'
            +'<th style="padding:.2rem .4rem;text-align:right;font-weight:600">Disp.</th>'
            +'<th style="padding:.2rem .4rem;text-align:right;font-weight:600">Mínimo</th>'
            +'<th style="padding:.2rem .4rem;text-align:right;font-weight:600">Objetivo</th></tr></thead><tbody>'
            + r.niveles.map(function(n){
              return '<tr data-wh="'+n.warehouse_id+'">'
                +'<td style="padding:.2rem .4rem">'+nvEsc(n.warehouse_name)+(n.is_default?' <span style="color:var(--muted)">(principal)</span>':'')+'</td>'
                +'<td style="padding:.2rem .4rem;text-align:right">'+n.disponible+'</td>'
                +'<td style="padding:.2rem .4rem;text-align:right"><input type="number" min="0" class="nvMin" value="'+n.min_qty+'" style="width:5rem;text-align:right"></td>'
                +'<td style="padding:.2rem .4rem;text-align:right"><input type="number" min="0" class="nvTarget" value="'+n.target_qty+'" style="width:5rem;text-align:right"></td></tr>';
            }).join('')
            +'</tbody></table>';
        }catch(e){ body.innerHTML='<span style="color:var(--danger)">No se pudieron cargar los niveles</span>'; }
      }
      // Informe de lotes/series: saldo por lote + caducidad (los caducados/agotados también, para el histórico).
      async function cargarLotes(id){
        const body=document.getElementById('pLotesBody');
        body.innerHTML='<span style="color:var(--muted)">Cargando…</span>';
        try{
          const r=await api('GET',A+'/products/'+id+'/lotes');
          const ls=r.lotes||[];
          if(!ls.length){ body.innerHTML='<span style="color:var(--muted)">Aún no hay lotes/series. Entran al recibir una orden de compra.</span>'; return; }
          const hoy=new Date().toISOString().slice(0,10);
          body.innerHTML='<table style="width:100%;border-collapse:collapse">'
            +'<thead><tr style="color:var(--muted);text-align:left">'
            +'<th style="padding:.2rem .4rem;font-weight:600">'+(r.tracking==='serial'?'Nº de serie':'Lote')+'</th>'
            +'<th style="padding:.2rem .4rem;text-align:right;font-weight:600">Saldo</th>'
            +'<th style="padding:.2rem .4rem;font-weight:600">Caducidad</th></tr></thead><tbody>'
            + ls.map(function(l){
                const cad = l.expiry ? (l.expiry < hoy ? '<span style="color:var(--danger)">'+nvEsc(l.expiry)+' (caducado)</span>' : nvEsc(l.expiry)) : '<span style="color:var(--text3)">—</span>';
                const ag = l.saldo>0 ? '' : ' style="color:var(--text3)"';
                return '<tr'+ag+'><td style="padding:.2rem .4rem">'+nvEsc(l.code)+'</td>'
                  +'<td style="padding:.2rem .4rem;text-align:right">'+l.saldo+'</td>'
                  +'<td style="padding:.2rem .4rem">'+cad+'</td></tr>';
              }).join('')
            +'</tbody></table>';
        }catch(e){ body.innerHTML='<span style="color:var(--danger)">No se pudieron cargar los lotes</span>'; }
      }
      async function guardarNiveles(){
        if(!currentProdId){toast('Guarda el producto primero','warn');return;}
        const levels=[...document.querySelectorAll('#pNivelesBody tr[data-wh]')].map(function(tr){
          return { warehouse_id:parseInt(tr.getAttribute('data-wh')),
                   min_qty:parseInt(tr.querySelector('.nvMin').value)||0,
                   target_qty:parseInt(tr.querySelector('.nvTarget').value)||0 };
        });
        try{ await api('PUT',A+'/products/'+currentProdId+'/niveles',{levels}); toast('Niveles guardados ✓'); }
        catch(e){ toast(e.message||'Error','err'); }
      }

      async function saveProduct(){
        const isEdit=!!currentProdId;
        // Obligatorios: tipo, nombre, SKU, precio y tipo de IVA.
        const _type=document.getElementById('pType').value;
        const _name=document.getElementById('pName').value.trim();
        const _sku=document.getElementById('pSku').value.trim();
        const _priceRaw=document.getElementById('pPrice').value.trim();
        const _band=document.getElementById('pTaxBand').value;
        if(!_type){toast('El tipo de producto es obligatorio','err');return;}
        if(!_name){toast('El nombre es obligatorio','err');return;}
        if(!_sku){toast('El SKU es obligatorio','err');return;}
        if(_priceRaw===''||isNaN(parseFloat(_priceRaw))||parseFloat(_priceRaw)<0){toast('El precio es obligatorio','err');return;}
        if(!_band){toast('El tipo de IVA es obligatorio','err');return;}
        const body={
          name:document.getElementById('pName').value,
          sku:document.getElementById('pSku').value,
          description:document.getElementById('pDesc').value,
          price:parseFloat(document.getElementById('pPrice').value)||0,
          compare_price:parseFloat(document.getElementById('pCompare').value)||null,
          image_url:document.getElementById('pImage').value,
          digital_file_url:document.getElementById('pDigital').value,
          category_id:document.getElementById('pCategory').value||null,
          supplier_id:document.getElementById('pSupplier').value?+document.getElementById('pSupplier').value:null,
          status:document.getElementById('pStatus').value,
          type:document.getElementById('pType').value,
          tracking:document.getElementById('pTracking').value,
          tax_band:document.getElementById('pTaxBand').value,
          featured:document.getElementById('pFeatured').checked,
          tags:selTags,
          stock:(document.getElementById('pType').value==='service'||document.getElementById('pType').value==='digital')?0:(parseInt(document.getElementById('pStock').value)||0),
          warehouse_id:(document.getElementById('pWarehouse')?parseInt(document.getElementById('pWarehouse').value):null)||null
        };
        try{
          if(isEdit) await api('PUT',A+'/products/'+currentProdId,body);
          else await api('POST',A+'/products',body);
          closeModal('productModal');
          toast(isEdit?'Producto actualizado':'Producto creado');
          location.reload();   // P4: refresca la lista server-rendered manteniendo búsqueda/filtro/página
        }catch(e){toast(e.message,'err')}
      }

      async function delProd(id){
        if(!confirm('¿Eliminar producto?'))return;
        try{await api('DELETE',A+'/products/'+id);toast('Eliminado');location.reload();}catch(e){toast(e.message,'err')}
      }

      // Tags
      function renderTagSelector(){
        const el=document.getElementById('tagSelector');
        el.innerHTML=allTags.map(t=>{
          const sel=selTags.includes(t.id);
          return '<span style="cursor:pointer;padding:.2rem .6rem;border-radius:99px;font-size:.75rem;font-weight:500;background:'+(sel?'var(--ok-s)':'var(--bg3)')+';color:'+(sel?'var(--ok)':'var(--text2)')+';border:1px solid '+(sel?'var(--ok-s)':'var(--border)')+'" onclick="toggleTag('+t.id+')">'+escHtml(t.name)+'</span>';
        }).join('')+(allTags.length===0?'<span style="color:var(--muted);font-size:.8rem">Sin etiquetas aún</span>':'');
      }
      function toggleTag(id){if(selTags.includes(id))selTags=selTags.filter(x=>x!==id);else selTags.push(id);renderTagSelector();}
      async function addTag(){
        const n=document.getElementById('newTagInput').value.trim();
        if(!n)return;
        const t=await api('POST',A+'/products/tags/create',{name:n});
        allTags.push(t);selTags.push(t.id);
        document.getElementById('newTagInput').value='';
        renderTagSelector();
      }

      // Images
      function renderGallery(imgs){
        document.getElementById('imageGallery').innerHTML=imgs.map(img=>
          '<div style="position:relative"><img src="'+img.url+'" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"><button onclick="delImage('+img.id+')" style="position:absolute;top:-6px;right:-6px;background:var(--danger-s);color:var(--danger);border:none;border-radius:50%;width:18px;height:18px;font-size:.65rem;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button></div>'
        ).join('');
      }
      async function addImage(){
        if(!currentProdId){toast('Guarda el producto primero','warn');return;}
        const url=document.getElementById('imgUrl').value.trim();
        if(!url)return;
        await api('POST',A+'/products/'+currentProdId+'/images',{url,alt:document.getElementById('imgAlt').value});
        document.getElementById('imgUrl').value='';
        const imgs=await api('GET',A+'/products/'+currentProdId+'/images');
        renderGallery(imgs);
        toast('Imagen agregada');
      }
      async function delImage(imgId){
        if(!currentProdId)return;
        await api('DELETE',A+'/products/'+currentProdId+'/images/'+imgId);
        const imgs=await api('GET',A+'/products/'+currentProdId+'/images');
        renderGallery(imgs);
      }

      // Variants
      function renderVariantList(variants){
        document.getElementById('variantList').innerHTML=variants.length?
          '<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Atributos</th><th>Precio</th><th>Stock</th><th></th></tr></thead><tbody>'+
          variants.map(v=>{const attrs=[v.option1_name&&v.option1_value?v.option1_name+': '+v.option1_value:'',v.option2_name&&v.option2_value?v.option2_name+': '+v.option2_value:''].filter(Boolean).join(' · ');return '<tr><td>'+escHtml(v.name)+'</td><td>'+(attrs||'—')+'</td><td>'+(v.price!=null?sym+v.price:'Base')+'</td><td>'+v.stock+'</td><td><button class="btn btn-danger btn-sm" onclick="delVariant('+v.id+')">Eliminar</button></td></tr>';}).join('')+
          '</tbody></table></div>':'<p style="color:var(--muted);font-size:.85rem">Sin variantes</p>';
      }
      async function addVariant(){
        if(!currentProdId){toast('Guarda el producto primero','warn');return;}
        const name=document.getElementById('varName').value.trim();
        if(!name)return;
        await api('POST',A+'/products/'+currentProdId+'/variants',{name,price:parseFloat(document.getElementById('varPrice').value)||null,stock:parseInt(document.getElementById('varStock').value)||0,option1_name:document.getElementById('vOpt1Name').value,option1_value:document.getElementById('vOpt1Val').value,option2_name:document.getElementById('vOpt2Name').value,option2_value:document.getElementById('vOpt2Val').value,sku:document.getElementById('vSku').value});
        document.getElementById('varName').value='';
        document.getElementById('varPrice').value='';
        document.getElementById('varStock').value='0';
        document.getElementById('vOpt1Name').value='';
        document.getElementById('vOpt1Val').value='';
        document.getElementById('vOpt2Name').value='';
        document.getElementById('vOpt2Val').value='';
        document.getElementById('vSku').value='';
        const vars=await api('GET',A+'/products/'+currentProdId+'/variants');
        renderVariantList(vars);
        toast('Variante agregada');
      }
      async function delVariant(vid){
        if(!currentProdId)return;
        await api('DELETE',A+'/products/'+currentProdId+'/variants/'+vid);
        const vars=await api('GET',A+'/products/'+currentProdId+'/variants');
        renderVariantList(vars);
      }

      loadAll();
      </script>`;

    return c.html(adminLayout('Productos', content, 'products', c.get('session')?.csrfToken || '', c));
  });

  tagsViews.get('/', requirePerm('tags.read'), c => {
    const content = `
      <div class="ph"><h2>Etiquetas</h2></div>
      <div class="card">
        <div class="card-head"><h3>Etiquetas de producto</h3>
          <div style="display:flex;gap:.5rem">
            <input class="form-control" id="tagName" placeholder="Nueva etiqueta..." style="width:200px">
            ${can(c,'products.create')?'<button class="btn btn-primary btn-sm" onclick="addTag()">Crear</button>':''}
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Creada</th><th></th></tr></thead>
            <tbody id="tagBody">${skeletonRows(3)}</tbody>
          </table>
        </div>
      </div>
      <script>
      async function loadTags(){
        const tags=await api('GET','/api/erp/products/tags/all').catch(()=>[]);
        document.getElementById('tagBody').innerHTML=tags.length?tags.map(t=>'<tr><td><span class="badge b-gray">'+escHtml(t.name)+'</span></td><td style="color:var(--muted);font-size:.8rem">'+(t.created_at?.split(' ')[0]||'-')+'</td><td>'+(window.canDo('products.delete')?'<button class="btn btn-danger btn-sm" onclick="delTag('+t.id+')">Eliminar</button>':'')+'</td></tr>').join(''):window.emptyRow(3,'Aún no tienes etiquetas. Crea la primera para clasificar tus productos.',window.canDo('products.create')?{cta:'Nueva etiqueta',onclick:"var i=document.getElementById('tagName');if(i)i.focus()"}:{});
      }
      async function addTag(){
        const n=document.getElementById('tagName').value.trim();if(!n)return;
        try{await api('POST','/api/erp/products/tags/create',{name:n});document.getElementById('tagName').value='';toast('Etiqueta creada');loadTags();}catch(e){toast(e.message,'err')}
      }
      async function delTag(id){if(!confirm('¿Eliminar?'))return;await api('DELETE','/api/erp/products/tags/'+id);toast('Eliminada');loadTags();}
      loadTags();
      </script>`;
    return c.html(adminLayout('Etiquetas', content, 'tags', c.get('session')?.csrfToken || '', c));
  });

  return { api, views, tagsViews };
}
