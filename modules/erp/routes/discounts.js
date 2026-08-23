import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, skeletonRows } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { discountCodeSchema, autoDiscountSchema } from '../schemas.js';

export function createDiscountRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  // ── API: DISCOUNT CODES ────────────────────────────────────────
  api.get('/', requirePerm('discounts.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM discount_codes ORDER BY id DESC').all()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/', requirePerm('discounts.create'), validate(discountCodeSchema), async c => {
    try {
      const d = c.get('validated');
      if (!d.code || !d.value) return c.json({error:'Código y valor requeridos'},400);
      const r = db.prepare('INSERT INTO discount_codes (code,type,value,min_order,max_uses,active,expires_at) VALUES (?,?,?,?,?,?,?)').run(d.code.trim().toUpperCase(), d.type||'percentage', d.value, d.min_order||0, d.max_uses||null, 1, d.expires_at||null);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.put('/:id', requirePerm('discounts.edit'), validate(discountCodeSchema), async c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE discount_codes SET code=?,type=?,value=?,min_order=?,max_uses=?,active=?,expires_at=? WHERE id=?').run(d.code?.toUpperCase()||'', d.type||'percentage', d.value, d.min_order||0, d.max_uses||null, d.active?1:0, d.expires_at||null, c.req.param('id'));
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.delete('/:id', requirePerm('discounts.delete'), c => {
    try { db.prepare('DELETE FROM discount_codes WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── API: AUTO DISCOUNTS ────────────────────────────────────────
  api.get('/auto', requirePerm('discounts.read'), c => {
    try { return c.json(db.prepare('SELECT * FROM auto_discounts ORDER BY id DESC').all()); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.post('/auto', requirePerm('discounts.create'), validate(autoDiscountSchema), async c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO auto_discounts (name,type,value,condition_type,condition_value,active) VALUES (?,?,?,?,?,?)').run(d.name, d.type||'percentage', d.value, d.condition_type||'min_order', d.condition_value||'0', 1);
      return c.json({id:r.lastInsertRowid});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.delete('/auto/:id', requirePerm('discounts.delete'), c => {
    try { db.prepare('DELETE FROM auto_discounts WHERE id=?').run(c.req.param('id')); return c.json({message:'Eliminado'}); }
    catch(e) { return c.json({error:safeError(e)},500); }
  });

  // ── VIEW ───────────────────────────────────────────────────────
  views.get('/', requirePerm('discounts.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Descuentos</h2></div>
      <div class="tabs" style="margin-bottom:1.5rem">
        <div class="tab active" data-tab-group="disc" data-tab-key="codes" onclick="switchTab('disc','codes')">Códigos de cupón</div>
        <div class="tab" data-tab-group="disc" data-tab-key="auto" onclick="switchTab('disc','auto')">Descuentos automáticos</div>
      </div>

      <!-- CÓDIGOS -->
      <div class="tab-pane active" data-pane-group="disc" data-pane-key="codes">
        <div style="display:flex;justify-content:flex-end;margin-bottom:1rem">
          ${can(c,'discounts.create')?'<button class="btn btn-primary" onclick="openModal(\'codeModal\')">Nuevo cupón</button>':''}
        </div>
        <div class="card">
          <div class="card-head"><h3>Cupones</h3><input class="search" id="codesSearch" placeholder="Buscar..." oninput="renderCodes()"></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Código</th><th>Tipo</th><th>Valor</th><th>Mín. pedido</th><th>Usos</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
            <tbody id="codesBody">${skeletonRows(8)}</tbody>
          </table></div>
        </div>
      </div>

      <!-- AUTO -->
      <div class="tab-pane" data-pane-group="disc" data-pane-key="auto">
        <div style="display:flex;justify-content:flex-end;margin-bottom:1rem">
          ${can(c,'discounts.create')?'<button class="btn btn-primary" onclick="openModal(\'autoModal\')">Nuevo descuento automático</button>':''}
        </div>
        <div class="card">
          <div class="card-head"><h3>Descuentos automáticos</h3><input class="search" id="autoSearch" placeholder="Buscar..." oninput="renderAuto()"></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Valor</th><th>Condición</th><th>Estado</th><th></th></tr></thead>
            <tbody id="autoBody">${skeletonRows(6)}</tbody>
          </table></div>
        </div>
      </div>

      <!-- Modal código -->
      <div class="modal-overlay" id="codeModal">
        <div class="modal">
          <div class="modal-head"><h3>Nuevo Cupón</h3><button class="modal-close" onclick="closeModal('codeModal')">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Código</label><input class="form-control" id="dcCode" placeholder="VERANO20" style="text-transform:uppercase"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Tipo</label><select class="form-control" id="dcType"><option value="percentage">Porcentaje (%)</option><option value="fixed">Fijo (${sym})</option></select></div>
              <div class="form-group"><label class="form-label">Valor</label><input class="form-control" type="number" id="dcValue" min="0" step="0.01"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Mínimo de pedido (${sym})</label><input class="form-control" type="number" id="dcMin" value="0" step="0.01"></div>
              <div class="form-group"><label class="form-label">Usos máximos</label><input class="form-control" type="number" id="dcMax" placeholder="Sin límite"></div>
            </div>
            <div class="form-group"><label class="form-label">Fecha de expiración</label><input class="form-control" type="date" id="dcExpires"></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('codeModal')">Cancelar</button><button class="btn btn-primary" onclick="saveCode()">Crear</button></div>
        </div>
      </div>

      <!-- Modal auto -->
      <div class="modal-overlay" id="autoModal">
        <div class="modal">
          <div class="modal-head"><h3>Nuevo Descuento Automático</h3><button class="modal-close" onclick="closeModal('autoModal')">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Nombre (interno)</label><input class="form-control" id="adName" placeholder="Ej: 10% en pedidos mayores ${sym}100"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Tipo</label><select class="form-control" id="adType"><option value="percentage">Porcentaje (%)</option><option value="fixed">Fijo (${sym})</option></select></div>
              <div class="form-group"><label class="form-label">Valor</label><input class="form-control" type="number" id="adValue" min="0" step="0.01"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Condición</label><select class="form-control" id="adCondType"><option value="min_order">Pedido mínimo (${sym})</option><option value="category">Categoría específica</option></select></div>
              <div class="form-group"><label class="form-label">Valor condición</label><input class="form-control" id="adCondVal" placeholder="Ej: 100"></div>
            </div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('autoModal')">Cancelar</button><button class="btn btn-primary" onclick="saveAuto()">Crear</button></div>
        </div>
      </div>

      <script>
      let _codes=[];
      let _autos=[];
      async function loadCodes(){
        _codes=await api('GET','/api/erp/discounts').catch(()=>[]);
        renderCodes();
      }
      function renderCodes(){
        const q=(document.getElementById('codesSearch').value||'').toLowerCase();
        const codes=q?_codes.filter(c=>(c.code||'').toLowerCase().includes(q)):_codes;
        document.getElementById('codesBody').innerHTML=codes.length?codes.map(c=>{
          const used=c.max_uses?c.uses_count+'/'+c.max_uses:(c.uses_count+' usos');
          return '<tr><td><code style="background:var(--bg3);padding:.2rem .5rem;border-radius:4px;font-weight:500">'+c.code+'</code></td>'+
            '<td>'+(c.type==='percentage'?'Porcentaje':'Fijo')+'</td>'+
            '<td><strong>'+(c.type==='percentage'?c.value+'%':'${sym}'+c.value)+'</strong></td>'+
            '<td>'+(c.min_order>0?'${sym}'+c.min_order:'-')+'</td>'+
            '<td style="color:var(--muted)">'+used+'</td>'+
            '<td style="color:var(--muted)">'+(c.expires_at?.split(' ')[0]||'Sin límite')+'</td>'+
            '<td>'+(c.active?'<span class="badge b-green">Activo</span>':'<span class="badge b-red">Inactivo</span>')+'</td>'+
            '<td>'+(window.canDo('discounts.delete')?'<button class="btn btn-danger btn-sm" onclick="delCode('+c.id+')">Eliminar</button>':'')+'</td></tr>';
        }).join(''):(q?window.emptyRow(8,'No se encontraron cupones con ese filtro.',{icon:'ti-search'}):window.emptyRow(8,'Aún no tienes cupones. Crea el primero para dar un descuento con código.',window.canDo('discounts.create')?{cta:'Nuevo cupón',onclick:"openModal('codeModal')"}:{}));
      }
      async function loadAuto(){
        _autos=await api('GET','/api/erp/discounts/auto').catch(()=>[]);
        renderAuto();
      }
      function renderAuto(){
        const q=(document.getElementById('autoSearch').value||'').toLowerCase();
        const autos=q?_autos.filter(a=>(a.name||'').toLowerCase().includes(q)):_autos;
        document.getElementById('autoBody').innerHTML=autos.length?autos.map(a=>'<tr>'+
          '<td><strong>'+window.escHtml(a.name)+'</strong></td>'+
          '<td>'+(a.type==='percentage'?'Porcentaje':'Fijo')+'</td>'+
          '<td><strong>'+(a.type==='percentage'?a.value+'%':'${sym}'+a.value)+'</strong></td>'+
          '<td style="color:var(--muted)">'+(a.condition_type==='min_order'?'Pedido ≥ ${sym}'+window.escHtml(a.condition_value):'Categoría: '+window.escHtml(a.condition_value))+'</td>'+
          '<td>'+(a.active?'<span class="badge b-green">Activo</span>':'<span class="badge b-red">Inactivo</span>')+'</td>'+
          '<td>'+(window.canDo('discounts.delete')?'<button class="btn btn-danger btn-sm" onclick="delAuto('+a.id+')">Eliminar</button>':'')+'</td></tr>').join(''):(q?window.emptyRow(6,'No se encontraron descuentos con ese filtro.',{icon:'ti-search'}):window.emptyRow(6,'No hay descuentos automáticos. Crea uno para aplicar rebajas sin código.',window.canDo('discounts.create')?{cta:'Nuevo descuento',onclick:"openModal('autoModal')"}:{}));
      }
      async function saveCode(){
        const exp=document.getElementById('dcExpires').value;
        const body={code:document.getElementById('dcCode').value,type:document.getElementById('dcType').value,value:parseFloat(document.getElementById('dcValue').value)||0,min_order:parseFloat(document.getElementById('dcMin').value)||0,max_uses:parseInt(document.getElementById('dcMax').value)||null,expires_at:exp||null};
        try{await api('POST','/api/erp/discounts',body);closeModal('codeModal');toast('Cupón creado');loadCodes();}catch(e){toast(e.message,'err')}
      }
      async function saveAuto(){
        const body={name:document.getElementById('adName').value,type:document.getElementById('adType').value,value:parseFloat(document.getElementById('adValue').value)||0,condition_type:document.getElementById('adCondType').value,condition_value:document.getElementById('adCondVal').value};
        try{await api('POST','/api/erp/discounts/auto',body);closeModal('autoModal');toast('Creado');loadAuto();}catch(e){toast(e.message,'err')}
      }
      async function delCode(id){if(!await window.confirmarEnPagina({titulo:'Eliminar el código de descuento',aceptar:'Sí, eliminarlo'}))return;await api('DELETE','/api/erp/discounts/'+id);toast('Eliminado');loadCodes();}
      async function delAuto(id){if(!await window.confirmarEnPagina({titulo:'Eliminar el descuento automático',aceptar:'Sí, eliminarlo'}))return;await api('DELETE','/api/erp/discounts/auto/'+id);toast('Eliminado');loadAuto();}
      loadCodes();loadAuto();
      </script>`;
    return c.html(adminLayout('Descuentos', content, 'discounts', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
