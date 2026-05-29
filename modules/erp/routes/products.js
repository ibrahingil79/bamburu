import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { productSchema, productImageSchema, variantSchema, tagSchema } from '../schemas.js';
import { getVatBands, resolveVatRate } from '../../../core/vat-bands.js';

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
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
        return { ...p, variants };
      });
      return c.json(result);
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.get('/:id', requirePerm('products.read'), c => {
    try {
      const p = db.prepare(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?`).get(c.req.param('id'));
      if (!p) return c.json({error:'No encontrado'},404);
      p.images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY position').all(p.id);
      p.variants = db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id').all(p.id);
      p.tags = db.prepare('SELECT t.* FROM tags t JOIN product_tags pt ON pt.tag_id=t.id WHERE pt.product_id=?').all(p.id);
      return c.json(p);
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/', requirePerm('products.create'), validate(productSchema), async c => {
    try {
      const d = c.get('validated');
      if (!d.name || d.price === undefined) return c.json({error:'Nombre y precio requeridos'},400);
      const slug = slugify(d.name);
      // P1+P2 refinamiento: el % de IVA lo resuelve el servidor desde la banda elegida
      // y el país del negocio (nunca se confía en un número del cliente). Servicio y
      // digital no llevan stock (CANON §2).
      const cfg = db.prepare('SELECT country, tax_rate FROM company_config WHERE id=1').get() || {};
      const country = (cfg.country || 'ES').toUpperCase();
      const fallbackRate = cfg.tax_rate != null ? cfg.tax_rate : 21;
      const { band, rate } = resolveVatRate(country, d.tax_band, fallbackRate);
      const stock = (d.type === 'service' || d.type === 'digital') ? 0 : d.stock;
      const r = db.prepare(`INSERT INTO products (name,slug,sku,description,price,compare_price,image_url,category_id,status,type,digital_file_url,featured,stock,supplier_id,tax_rate,tax_band) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(d.name, slug, d.sku||'', d.description||'', d.price, d.compare_price||null, d.image_url||'', d.category_id||null, d.status||'active', d.type||'physical', d.digital_file_url||'', d.featured?1:0, stock, d.supplier_id||null, rate, band);
      if (d.tags?.length) {
        for (const tid of d.tags) {
          try { db.prepare('INSERT OR IGNORE INTO product_tags (product_id,tag_id) VALUES (?,?)').run(r.lastInsertRowid, tid); } catch(_){}
        }
      }
      logActivity(db, c.get('session'), 'Creó producto', 'product', r.lastInsertRowid, d.name);
      return c.json({id:r.lastInsertRowid, message:'Creado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id', requirePerm('products.edit'), validate(productSchema), async c => {
    try {
      const id = c.req.param('id');
      const d = c.get('validated');
      // P1+P2 refinamiento: el % se resuelve desde la banda + país. Si la API omite la
      // banda, se conserva la actual del producto.
      const cur = db.prepare('SELECT tax_band, tax_rate FROM products WHERE id=?').get(id);
      const cfg = db.prepare('SELECT country, tax_rate FROM company_config WHERE id=1').get() || {};
      const country = (cfg.country || 'ES').toUpperCase();
      const fallbackRate = cfg.tax_rate != null ? cfg.tax_rate : 21;
      let band, rate;
      if (d.tax_band != null) {
        ({ band, rate } = resolveVatRate(country, d.tax_band, fallbackRate));
      } else {
        band = cur?.tax_band || 'general';
        rate = cur?.tax_rate ?? fallbackRate;
      }
      db.prepare(`UPDATE products SET name=?,sku=?,description=?,price=?,compare_price=?,image_url=?,category_id=?,status=?,type=?,digital_file_url=?,featured=?,supplier_id=?,tax_rate=?,tax_band=? WHERE id=?`)
        .run(d.name, d.sku||'', d.description||'', d.price, d.compare_price||null, d.image_url||'', d.category_id||null, d.status||'active', d.type||'physical', d.digital_file_url||'', d.featured?1:0, d.supplier_id||null, rate, band, id);
      if (d.tags !== undefined) {
        db.prepare('DELETE FROM product_tags WHERE product_id=?').run(id);
        for (const tid of (d.tags||[])) {
          try { db.prepare('INSERT OR IGNORE INTO product_tags (product_id,tag_id) VALUES (?,?)').run(id, tid); } catch(_){}
        }
      }
      logActivity(db, c.get('session'), 'Editó producto', 'product', id, d.name);
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id', requirePerm('products.delete'), c => {
    try {
      const p = db.prepare('SELECT name FROM products WHERE id=?').get(c.req.param('id'));
      db.prepare('DELETE FROM products WHERE id=?').run(c.req.param('id'));
      logActivity(db, c.get('session'), 'Eliminó producto', 'product', c.req.param('id'), p?.name||'');
      return c.json({message:'Eliminado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: IMAGES ────────────────────────────────────────────────
  api.get('/:id/images', requirePerm('products.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY position').all(c.req.param('id'))); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/:id/images', requirePerm('products.edit'), validate(productImageSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO product_images (product_id,url,alt,position) VALUES (?,?,?,?)').run(c.req.param('id'), d.url, d.alt||'', d.position||0);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id/images/:imgId', requirePerm('products.edit'), c => {
    try { db.prepare('DELETE FROM product_images WHERE id=? AND product_id=?').run(c.req.param('imgId'), c.req.param('id')); return c.json({message:'Eliminada'}); }
    catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: VARIANTS ──────────────────────────────────────────────
  api.get('/:id/variants', requirePerm('products.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id').all(c.req.param('id'))); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/:id/variants', requirePerm('products.edit'), validate(variantSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO product_variants (product_id,name,option1_name,option1_value,option2_name,option2_value,sku,price,stock) VALUES (?,?,?,?,?,?,?,?,?)').run(c.req.param('id'), d.name, d.option1_name||'', d.option1_value||'', d.option2_name||'', d.option2_value||'', d.sku||'', d.price||null, d.stock||0);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.put('/:id/variants/:vid', requirePerm('products.edit'), validate(variantSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE product_variants SET name=?,option1_name=?,option1_value=?,option2_name=?,option2_value=?,sku=?,price=?,stock=? WHERE id=? AND product_id=?').run(d.name, d.option1_name||'', d.option1_value||'', d.option2_name||'', d.option2_value||'', d.sku||'', d.price||null, d.stock||0, c.req.param('vid'), c.req.param('id'));
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/:id/variants/:vid', requirePerm('products.edit'), c => {
    try { db.prepare('DELETE FROM product_variants WHERE id=? AND product_id=?').run(c.req.param('vid'), c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: TAGS ──────────────────────────────────────────────────
  api.get('/tags/all', requirePerm('tags.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM tags ORDER BY name').all()); }
    catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/tags/create', requirePerm('tags.create'), validate(tagSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(d.name.trim());
      const tag = db.prepare('SELECT * FROM tags WHERE name=?').get(d.name.trim());
      return c.json(tag);
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.delete('/tags/:id', requirePerm('tags.delete'), c => {
    try { db.prepare('DELETE FROM tags WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminada'}); }
    catch(e) { return c.json({error:e.message},500); }
  });

  // ── VIEWS ──────────────────────────────────────────────────────
  views.get('/', c => {
    const cfgRow = db.prepare('SELECT currency_symbol, tax_rate, country FROM company_config WHERE id=1').get() || {};
    const sym = cfgRow.currency_symbol || '€';
    const country = (cfgRow.country || 'ES').toUpperCase();
    const fallbackRate = cfgRow.tax_rate != null ? cfgRow.tax_rate : 21;
    const vatBands = getVatBands(country, fallbackRate);   // bandas del país (hoy ES); no quemadas en la pantalla
    const vatBandsJson = JSON.stringify(vatBands);
    const content = `
      <div class="ph">
        <h2>Productos</h2>
        <div style="display:flex;gap:.5rem">
          <input class="search" id="searchBox" placeholder="Buscar...">
          ${can(c, 'products.create') ? '<button class="btn btn-primary" id="btnNuevoProd">Nuevo producto</button>' : ''}
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Imagen</th><th>Nombre</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Tipo</th><th></th></tr></thead>
            <tbody id="prodBody"><tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Modal Producto -->
      <div class="modal-overlay" id="productModal">
        <div class="modal" style="max-width:680px">
          <div class="modal-head"><h3 id="modalTitle">Nuevo Producto</h3><button class="modal-close" onclick="closeModal('productModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="prodId">
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
                <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="pName"></div>
                <div class="form-group"><label class="form-label">SKU</label><input class="form-control" id="pSku"></div>
              </div>
              <div class="form-group"><label class="form-label">Descripción</label><textarea class="form-control" id="pDesc" rows="3"></textarea></div>
              <div class="form-row">
                <div class="form-group"><label class="form-label">Precio *</label><input class="form-control" type="number" id="pPrice" step="0.01"></div>
                <div class="form-group"><label class="form-label">IVA (banda)</label><select class="form-control" id="pTaxBand"></select></div>
                <div class="form-group" style="display:none"><label class="form-label">Precio antes (tachado)</label><input class="form-control" type="number" id="pCompare" step="0.01"></div><!-- OCULTO: promoción de tienda online -->
                <div class="form-group" id="pStockWrap"><label class="form-label">Stock</label><input class="form-control" type="number" id="pStock" value="0"></div>
              </div>
              <div style="font-size:.72rem;color:var(--muted);margin:-.5rem 0 .25rem">
                <a href="https://sede.agenciatributaria.gob.es/Sede/iva.html" target="_blank" rel="noopener" style="color:var(--teal)">Tipos de IVA oficiales (AEAT) ↗</a>
                &nbsp;·&nbsp; ¿Dudas sobre qué IVA aplicar? Pregunta a DISA.
              </div>
              <div class="form-row">
                <div class="form-group"><label class="form-label">Categoría</label><select class="form-control" id="pCategory"><option value="">Sin categoría</option></select></div>
                <div class="form-group"><label class="form-label">Tipo</label><select class="form-control" id="pType"><option value="physical">Físico</option><option value="digital">Digital</option><option value="service">Servicio</option></select></div>
                <div class="form-group"><label class="form-label">Estado</label><select class="form-control" id="pStatus"><option value="active">Activo</option><option value="draft">Borrador</option><option value="archived">Archivado</option></select></div>
              </div>
              <div class="form-group"><label class="form-label">URL imagen principal</label><input class="form-control" id="pImage" placeholder="https://..."></div>
              <div class="form-group" id="pDigitalWrap" style="display:none"><label class="form-label">URL archivo digital</label><input class="form-control" id="pDigital"></div>
              <div class="form-group" style="display:none"><!-- OCULTO: destacado es escaparate de tienda -->
                <label class="form-label"><input type="checkbox" id="pFeatured"> Producto destacado (aparece primero en la tienda)</label>
              </div>
              <div class="form-group">
                <label class="form-label">Proveedor</label>
                <select class="form-control" id="pSupplier"><option value="">Sin proveedor</option></select>
              </div>
              <div class="form-group">
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

      <script>
      const A='/api/erp';
      const VAT_BANDS=${vatBandsJson};   // bandas de IVA del país (P1+P2 refinamiento)
      let allProds=[], allTags=[], allCats=[], allSuppliers=[], selTags=[], currentProdId=null;

      // Rellena el selector de banda de IVA. Etiqueta clara + % + ejemplo corto.
      (function initVatBands(){
        const sel=document.getElementById('pTaxBand');
        sel.innerHTML=VAT_BANDS.map(b=>{
          const pct=b.rate>0?(' — '+b.rate+'%'):' — sin IVA';
          const ex=b.example?(' ('+b.example+')'):'';
          return '<option value="'+b.code+'">'+b.label+pct+ex+'</option>';
        }).join('');
      })();
      function bandRate(code){const b=VAT_BANDS.find(x=>x.code===code);return b?b.rate:null;}

      async function loadAll(){
        [allProds, allTags, allCats, allSuppliers]=await Promise.all([
          api('GET',A+'/products').catch(()=>[]),
          api('GET',A+'/products/tags/all').catch(()=>[]),
          api('GET',A+'/categories').catch(()=>[]),
          api('GET',A+'/suppliers').catch(()=>[])
        ]);
        renderProds(allProds);
        const catSel=document.getElementById('pCategory');
        catSel.innerHTML='<option value="">Sin categoría</option>'+allCats.map(c=>'<option value="'+c.id+'">'+c.name+'</option>').join('');
        const supSel=document.getElementById('pSupplier');
        supSel.innerHTML='<option value="">Sin proveedor</option>'+allSuppliers.map(s=>'<option value="'+s.id+'">'+s.name+'</option>').join('');
      }

      function renderProds(prods){
        const q=document.getElementById('searchBox').value.toLowerCase();
        const filtered=q?prods.filter(p=>p.name.toLowerCase().includes(q)||(p.sku||'').toLowerCase().includes(q)):prods;
        const statusB={active:'<span class="badge b-green">Activo</span>',draft:'<span class="badge b-yellow">Borrador</span>',archived:'<span class="badge b-gray">Archivado</span>'};
        document.getElementById('prodBody').innerHTML=filtered.length?filtered.map(p=>'<tr>'+
          '<td>'+(p.image_url?'<img class="thumb" src="'+p.image_url+'" alt="">':'<span style="font-size:1.2rem"></span>')+'</td>'+
          '<td><strong>'+escHtml(p.name)+'</strong>'+(p.featured?'  <span class="badge b-purple">Destacado</span>':'')+'<br><span style="color:var(--muted);font-size:.75rem">SKU: '+(p.sku||'-')+'</span></td>'+
          '<td>'+(p.category_name||'-')+'</td>'+
          '<td><strong>${sym}'+p.price.toFixed(2)+'</strong>'+(p.compare_price?'<br><span style="text-decoration:line-through;color:var(--muted);font-size:.75rem">${sym}'+p.compare_price.toFixed(2)+'</span>':'')+'<br><span style="color:var(--muted);font-size:.72rem">'+(Number(p.tax_rate)>0?('IVA '+p.tax_rate+'%'):'Exento')+'</span></td>'+
          '<td>'+(p.type==='service'?'<span style="color:var(--muted)">—</span>':(p.stock<5?'<span style="color:#ef4444;font-weight:600">'+p.stock+'</span>':p.stock))+'</td>'+
          '<td>'+(statusB[p.status]||p.status)+'</td>'+
          '<td><span class="badge b-gray">'+(p.type==='digital'?'Digital':p.type==='service'?'Servicio':'Físico')+'</span></td>'+
          '<td style="white-space:nowrap">'+(window.canDo('products.edit')?'<button class="btn btn-secondary btn-sm" onclick="editProd('+p.id+')">Editar</button> ':'')+( window.canDo('products.delete')?'<button class="btn btn-danger btn-sm" onclick="delProd('+p.id+')">Eliminar</button>':'')+'</td>'+
          '</tr>').join(''):'<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted)">No hay productos</td></tr>';
      }

      function escHtml(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

      document.getElementById('searchBox').addEventListener('input',()=>renderProds(allProds));
      // P1+P2: el tipo decide qué campos aplican. Digital → muestra URL de archivo.
      // Servicio y digital → no llevan stock (CANON §2), se oculta el campo Stock.
      function applyTypeUI(t){
        // URL archivo digital OCULTA de la vista (entrega de tienda online). El campo
        // sigue en el DOM (#pDigitalWrap, display:none de base); no se muestra para ningún tipo.
        document.getElementById('pStockWrap').style.display = (t==='service' || t==='digital') ? 'none' : '';
      }
      document.getElementById('pType').addEventListener('change',e=>applyTypeUI(e.target.value));

      function openNewProduct(){
        currentProdId=null; selTags=[];
        document.getElementById('modalTitle').textContent='Nuevo Producto';
        ['pName','pSku','pDesc','pPrice','pCompare','pImage','pDigital'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('pStock').value='0';
        document.getElementById('pTaxBand').value='general';
        document.getElementById('pStatus').value='active';
        document.getElementById('pType').value='physical';
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
        document.getElementById('pName').value=p.name;
        document.getElementById('pSku').value=p.sku||'';
        document.getElementById('pDesc').value=p.description||'';
        document.getElementById('pPrice').value=p.price;
        document.getElementById('pCompare').value=p.compare_price||'';
        document.getElementById('pStock').value=p.stock;
        document.getElementById('pTaxBand').value=p.tax_band||'general';
        document.getElementById('pImage').value=p.image_url||'';
        document.getElementById('pDigital').value=p.digital_file_url||'';
        document.getElementById('pStatus').value=p.status||'active';
        document.getElementById('pType').value=p.type||'physical';
        document.getElementById('pFeatured').checked=!!p.featured;
        document.getElementById('pCategory').value=p.category_id||'';
        document.getElementById('pSupplier').value=p.supplier_id||'';
        applyTypeUI(p.type||'physical');
        renderTagSelector();
        renderGallery(p.images||[]);
        renderVariantList(p.variants||[]);
        openModal('productModal');
      }

      async function saveProduct(){
        const isEdit=!!currentProdId;
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
          tax_band:document.getElementById('pTaxBand').value,
          featured:document.getElementById('pFeatured').checked,
          tags:selTags,
          stock:(document.getElementById('pType').value==='service'||document.getElementById('pType').value==='digital')?0:(parseInt(document.getElementById('pStock').value)||0)
        };
        try{
          if(isEdit) await api('PUT',A+'/products/'+currentProdId,body);
          else await api('POST',A+'/products',body);
          closeModal('productModal');
          toast(isEdit?'Producto actualizado':'Producto creado');
          loadAll();
        }catch(e){toast(e.message,'err')}
      }

      async function delProd(id){
        if(!confirm('¿Eliminar producto?'))return;
        try{await api('DELETE',A+'/products/'+id);toast('Eliminado');loadAll();}catch(e){toast(e.message,'err')}
      }

      // Tags
      function renderTagSelector(){
        const el=document.getElementById('tagSelector');
        el.innerHTML=allTags.map(t=>{
          const sel=selTags.includes(t.id);
          return '<span style="cursor:pointer;padding:.2rem .6rem;border-radius:99px;font-size:.75rem;font-weight:600;background:'+(sel?'#10b981':'#f1f5f9')+';color:'+(sel?'#fff':'#475569')+';border:1px solid '+(sel?'#10b981':'#e2e8f0')+'" onclick="toggleTag('+t.id+')">'+t.name+'</span>';
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
          '<div style="position:relative"><img src="'+img.url+'" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"><button onclick="delImage('+img.id+')" style="position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:.65rem;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button></div>'
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

  tagsViews.get('/', c => {
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
            <tbody id="tagBody"><tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr></tbody>
          </table>
        </div>
      </div>
      <script>
      async function loadTags(){
        const tags=await api('GET','/api/erp/products/tags/all').catch(()=>[]);
        document.getElementById('tagBody').innerHTML=tags.length?tags.map(t=>'<tr><td><span class="badge b-gray">'+t.name+'</span></td><td style="color:var(--muted);font-size:.8rem">'+(t.created_at?.split(' ')[0]||'-')+'</td><td>'+(window.canDo('products.delete')?'<button class="btn btn-danger btn-sm" onclick="delTag('+t.id+')">Eliminar</button>':'')+'</td></tr>').join(''):'<tr><td colspan="3" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin etiquetas</td></tr>';
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
