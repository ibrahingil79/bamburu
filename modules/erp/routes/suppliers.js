import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, skeletonRows } from '../layout.js';
import { validate } from '../../../core/validate.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { supplierSchema, supplierAccountPaymentSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { liveSupplierPayables } from '../pagos.js';                                 // Paso (e): facturas vivas del proveedor para el modal de pago a cuenta
import { registerSupplierAccountPayment } from './supplier-invoices.js';           // Paso (e): servicio de reparto ya hecho en (d) — se EXPONE, no se duplica
import { ENTITY } from '../../../core/activity-entities.js';

// Saneamiento de Proveedor.
// Guarda de NIF único GLOBAL: el NIF identifica fiscalmente al proveedor, así que un
// proveedor ARCHIVADO sigue reservando su NIF (no se libera al archivar). Bloquea si ya
// existe CUALQUIER proveedor (activo o archivado) con ese NIF (normaliza trim+UPPER; vacío
// no bloquea; excluye al propio en edición). Devuelve también `active` para que la ruta
// pueda sugerir "restaurar" si el conflicto es con uno archivado. La usan POST/PUT y restore.
export function supplierFiscalIdConflict(db, fiscalId, excludeId = null) {
  const norm = String(fiscalId || '').trim().toUpperCase();
  if (!norm) return null;
  const ex = Number(excludeId);
  return db.prepare(
    'SELECT id, name, active FROM suppliers WHERE UPPER(TRIM(fiscal_id))=? AND id<>?'
  ).get(norm, Number.isFinite(ex) ? ex : -1) || null;
}

// ── SERVICIO VALIDADO COMPARTIDO DE PROVEEDOR — única vía de alta (patrón T5) ──
// La usan la ruta POST y la captura de factura (C2): misma validación (supplierSchema)
// y misma guarda de NIF único global (supplierFiscalIdConflict). Errores con .status.
export function createSupplierSvc(db, input) {
  const res = supplierSchema.safeParse(input);
  if (!res.success) {
    const msg = res.error.issues.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    const e = new Error(msg || 'Datos de proveedor inválidos'); e.status = 400; throw e;
  }
  const d = res.data;
  const conf = supplierFiscalIdConflict(db, d.fiscal_id);
  if (conf) {
    const e = new Error(conf.active
      ? 'Ya existe un proveedor con ese NIF/CIF'
      : 'Ya existe un proveedor ARCHIVADO con ese NIF/CIF; restáuralo en vez de crear uno nuevo');
    e.status = 409; throw e;
  }
  const code = nextCode(db, 'supplier');   // código interno PROV-NNNN, tras la guarda de NIF
  const r = db.prepare('INSERT INTO suppliers (name,fiscal_id,contact,email,phone,address,city,notes,supplier_code,payment_term_days,payment_method) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(d.name, d.fiscal_id||'', d.contact||'', d.email||'', d.phone||'', d.address||'', d.city||'', d.notes||'', code, d.payment_term_days||0, d.payment_method||'');
  return { id: r.lastInsertRowid, name: d.name, supplier_code: code };
}

// C2 — búsqueda server-side de proveedores (patrón de searchClients): nombre o NIF,
// solo activos. El cuadre exacto por NIF usa supplierFiscalIdConflict.
export function searchSuppliers(db, { q = '', limit = 20 } = {}) {
  const where = ['active=1'];
  const params = [];
  if (q) { where.push('(name LIKE ? OR fiscal_id LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return db.prepare(
    'SELECT id, name, fiscal_id, email, phone, supplier_code, payment_term_days FROM suppliers WHERE '
    + where.join(' AND ') + ' ORDER BY name LIMIT ?'
  ).all(...params, lim);
}

export function createSupplierRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // GET lista: activos por defecto; ?archived=1 devuelve los archivados.
  api.get('/', requirePerm('suppliers.read'), c => {
    try {
      const archived = c.req.query('archived') === '1' ? 0 : 1;
      return c.json(db.prepare('SELECT * FROM suppliers WHERE active=? ORDER BY name').all(archived));
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // C2 — búsqueda de proveedores (JSON). ANTES de '/:id' (no hay /:id aquí, pero se mantiene el patrón).
  api.get('/search', requirePerm('suppliers.read'), c => {
    try {
      return c.json(searchSuppliers(db, { q: c.req.query('q') || '', limit: c.req.query('limit') }));
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // Paso (e) — resumen de cuenta del proveedor (deuda viva, factura a factura) para el modal
  // "Pagar a cuenta". Solo lectura; reusa liveSupplierPayables (excluye abonos). ANTES de '/:id'.
  api.get('/:id/account-summary', requirePerm('purchases.read'), c => {
    try {
      const sid = parseInt(c.req.param('id'));
      const sup = db.prepare('SELECT id, name FROM suppliers WHERE id=?').get(sid);
      if (!sup) return c.json({ error: 'Proveedor no encontrado' }, 404);
      const facturasVivas = liveSupplierPayables(db, sid, new Date().toISOString().slice(0, 10));
      const deudaTotal = Math.round(facturasVivas.reduce((s, f) => s + f.pendiente, 0) * 100) / 100;
      return c.json({ supplier_id: sid, supplier_name: sup.name, deudaTotal, facturasVivas });
    } catch (e) { return c.json({ error: safeError(e) }, 500); }
  });

  // Paso (e) — PAGO A CUENTA: reparte el importe entre las facturas vivas del proveedor
  // (auto = más antigua primero / manual) por el servicio EXISTENTE registerSupplierAccountPayment
  // (el MISMO que usa el pago por voz de DISA). NADA de lógica de reparto nueva aquí: solo se expone.
  api.post('/:id/account-payments', requirePerm('purchases.create'), validate(supplierAccountPaymentSchema), c => {
    try {
      const sid = parseInt(c.req.param('id'));
      const r = registerSupplierAccountPayment(db, sid, c.get('validated'), { today: new Date().toISOString().slice(0, 10) });
      logActivity(db, c.get('session'), 'Pago a cuenta de proveedor', ENTITY.SUPPLIER, sid, `${r.supplier_name} · ${r.repartido} en ${r.pagos.length} factura(s)`);
      return c.json(r, 201);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 400); }
  });

  // El alta pasa por el servicio compartido (misma validación + guarda de NIF que C2).
  api.post('/', requirePerm('suppliers.create'), validate(supplierSchema), c => {
    try {
      const r = createSupplierSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó proveedor', ENTITY.SUPPLIER, r.id, r.name);
      return c.json({id:r.id, message:'Proveedor creado'}, 201);
    } catch(e) { return c.json({error:safeError(e)}, e.status||500); }
  });

  api.put('/:id', requirePerm('suppliers.edit'), validate(supplierSchema), c => {
    try {
      const d = c.get('validated');
      const id = parseInt(c.req.param('id'));
      const conf = supplierFiscalIdConflict(db, d.fiscal_id, id);
      if (conf) return c.json({error: conf.active ? 'Ya existe un proveedor con ese NIF/CIF' : 'Ya existe un proveedor archivado con ese NIF/CIF'},409);
      const info = db.prepare('UPDATE suppliers SET name=?,fiscal_id=?,contact=?,email=?,phone=?,address=?,city=?,notes=?,payment_term_days=?,payment_method=? WHERE id=?')
        .run(d.name, d.fiscal_id||'', d.contact||'', d.email||'', d.phone||'', d.address||'', d.city||'', d.notes||'', d.payment_term_days||0, d.payment_method||'', id);
      if (!info.changes) return c.json({error:'No encontrado'},404);
      logActivity(db, c.get('session'), 'Editó proveedor', ENTITY.SUPPLIER, id, d.name);
      return c.json({message:'Actualizado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // Archivar (no borrar): soft-delete. Conserva la fila y sus compras; sale de lista y
  // selectores. El NIF sigue reservado (no se libera): para reutilizarlo, restaurar.
  api.delete('/:id', requirePerm('suppliers.delete'), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const s = db.prepare('SELECT name FROM suppliers WHERE id=?').get(id);
      if (!s) return c.json({error:'No encontrado'},404);
      db.prepare('UPDATE suppliers SET active=0 WHERE id=?').run(id);
      logActivity(db, c.get('session'), 'Archivó proveedor', ENTITY.SUPPLIER, id, s.name||'');
      return c.json({message:'Archivado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // Restaurar un archivado. Red de seguridad: si por datos heredados existiera otro
  // proveedor con el mismo NIF, se bloquea (la unicidad global ya lo evita al crear).
  api.post('/:id/restore', requirePerm('suppliers.edit'), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const s = db.prepare('SELECT id, name, fiscal_id FROM suppliers WHERE id=?').get(id);
      if (!s) return c.json({error:'No encontrado'},404);
      if (supplierFiscalIdConflict(db, s.fiscal_id, id)) return c.json({error:'Ya existe otro proveedor con este NIF/CIF'},409);
      db.prepare('UPDATE suppliers SET active=1 WHERE id=?').run(id);
      logActivity(db, c.get('session'), 'Restauró proveedor', ENTITY.SUPPLIER, id, s.name||'');
      return c.json({message:'Restaurado'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  views.get('/', requirePerm('suppliers.read'), c => {
    const content = `
      <div class="ph">
        <h2>Proveedores</h2>
        <div style="display:flex;gap:.5rem;align-items:center">
          <select class="form-control" id="supState" style="width:auto;min-width:150px" onchange="loadSups()">
            <option value="0">Activos</option>
            <option value="1">Archivados</option>
          </select>
          ${can(c,'suppliers.create')?'<button class="btn btn-primary" id="btnNew">Nuevo proveedor</button>':''}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Lista de proveedores</h3><input class="search" id="searchBox" placeholder="Buscar nombre, NIF o email..." oninput="filterTable()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Código</th><th>Nombre</th><th>NIF/CIF</th><th>Contacto</th><th>Email</th><th>Teléfono</th><th></th></tr></thead>
          <tbody id="supBody">${skeletonRows(7)}</tbody>
        </table></div>
      </div>

      <div class="modal-overlay" id="supModal">
        <div class="modal">
          <div class="modal-head"><h3 id="modalTitle">Nuevo proveedor</h3><button class="modal-close" onclick="closeModal('supModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="supId">
            <div class="form-group" id="supCodeWrap" style="display:none"><label class="form-label">Código interno</label><div id="supCode" style="font-family:monospace;color:var(--muted)"></div></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="supName"></div>
              <div class="form-group"><label class="form-label">NIF/CIF</label><input class="form-control" id="supFiscal"></div>
            </div>
            <div class="form-group"><label class="form-label">Persona de contacto</label><input class="form-control" id="supContact"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Email</label><input class="form-control" id="supEmail" type="email"></div>
              <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="supPhone"></div>
            </div>
            <div class="form-group"><label class="form-label">Dirección</label><input class="form-control" id="supAddress"></div>
            <div class="form-group" style="max-width:50%"><label class="form-label">Ciudad</label><input class="form-control" id="supCity"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Plazo de pago (días)</label><input class="form-control" id="supTerm" type="number" min="0" step="1" placeholder="0 = contado"></div>
              <div class="form-group"><label class="form-label">Forma de pago</label>
                <select class="form-control" id="supPayMethod">
                  <option value="">— Sin especificar —</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="domiciliacion">Domiciliación</option>
                </select>
              </div>
            </div>
            <div class="form-group"><label class="form-label">Notas</label><textarea class="form-control" id="supNotes"></textarea></div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" onclick="closeModal('supModal')">Cancelar</button>
            <button class="btn btn-primary" onclick="saveSup()">Guardar</button>
          </div>
        </div>
      </div>

      <script>
      var sups=[];
      var _btnNew=document.getElementById('btnNew'); if(_btnNew) _btnNew.onclick=function(){openNew();};
      function viewingArchived(){ return document.getElementById('supState').value==='1'; }
      async function loadSups(){
        var qs = viewingArchived() ? '?archived=1' : '';
        sups=await api('GET','/api/erp/suppliers'+qs).catch(function(){return[];});
        filterTable();
      }
      function filterTable(){
        var q=document.getElementById('searchBox').value.toLowerCase();
        var f=q?sups.filter(function(s){return s.name.toLowerCase().includes(q)||(s.fiscal_id||'').toLowerCase().includes(q)||(s.email||'').toLowerCase().includes(q);}):sups;
        var arch=viewingArchived();
        document.getElementById('supBody').innerHTML=f.length?f.map(function(s){
          var acts = arch
            ? (window.canDo('suppliers.edit')?'<button class="btn btn-secondary btn-sm" onclick="restoreSup('+s.id+')">Restaurar</button>':'')
            : (window.canDo('purchases.read')?'<a class="btn btn-secondary btn-sm" href="/admin/supplier-invoices?supplier='+s.id+'">Deuda</a> ':'')
              + ((window.canDo('suppliers.edit')||window.canDo('suppliers.delete')) ? window.rowMenu([
                  window.canDo('suppliers.edit') ? {label:'Editar', onclick:'editSup('+s.id+')'} : null,
                  window.canDo('suppliers.delete') ? {label:'Archivar', danger:true, onclick:'delSup('+s.id+')'} : null
                ].filter(Boolean)) : '');
          return '<tr><td style="color:var(--muted);font-family:monospace;font-size:.8rem">'+escHtml(s.supplier_code||'-')+'</td><td><strong>'+escHtml(s.name)+'</strong></td><td style="color:var(--muted)">'+escHtml(s.fiscal_id||'-')+'</td><td>'+escHtml(s.contact||'-')+'</td><td>'+escHtml(s.email||'-')+'</td><td>'+escHtml(s.phone||'-')+'</td><td style="text-align:right;white-space:nowrap">'+acts+'</td></tr>';
        }).join(''):(arch?window.emptyRow(7,'No tienes proveedores archivados.',{icon:'ti-search'}):(q?window.emptyRow(7,'No se encontraron proveedores con ese filtro.',{icon:'ti-search'}):window.emptyRow(7,'Todavía no tienes proveedores. ¿Damos de alta el primero?',window.canDo('suppliers.create')?{cta:'Nuevo proveedor',onclick:'openNew()'}:{})));
      }
      function openNew(){
        ['supId','supName','supFiscal','supContact','supEmail','supPhone','supAddress','supCity','supNotes','supTerm','supPayMethod'].forEach(function(id){document.getElementById(id).value='';});
        document.getElementById('supCodeWrap').style.display='none';
        document.getElementById('modalTitle').textContent='Nuevo proveedor';
        openModal('supModal');
      }
      function editSup(id){
        var s=sups.find(function(x){return x.id===id;});
        if(!s)return;
        document.getElementById('supId').value=s.id;
        document.getElementById('supCode').textContent=s.supplier_code||'—';
        document.getElementById('supCodeWrap').style.display=s.supplier_code?'':'none';
        document.getElementById('supName').value=s.name;
        document.getElementById('supFiscal').value=s.fiscal_id||'';
        document.getElementById('supContact').value=s.contact||'';
        document.getElementById('supEmail').value=s.email||'';
        document.getElementById('supPhone').value=s.phone||'';
        document.getElementById('supAddress').value=s.address||'';
        document.getElementById('supCity').value=s.city||'';
        document.getElementById('supTerm').value=(s.payment_term_days!=null?s.payment_term_days:'');
        document.getElementById('supPayMethod').value=s.payment_method||'';
        document.getElementById('supNotes').value=s.notes||'';
        document.getElementById('modalTitle').textContent='Editar proveedor';
        openModal('supModal');
      }
      async function saveSup(){
        var id=document.getElementById('supId').value;
        var body={
          name:document.getElementById('supName').value.trim(),
          fiscal_id:document.getElementById('supFiscal').value.trim(),
          contact:document.getElementById('supContact').value.trim(),
          email:document.getElementById('supEmail').value.trim(),
          phone:document.getElementById('supPhone').value.trim(),
          address:document.getElementById('supAddress').value.trim(),
          city:document.getElementById('supCity').value.trim(),
          payment_term_days:parseInt(document.getElementById('supTerm').value)||0,
          payment_method:document.getElementById('supPayMethod').value,
          notes:document.getElementById('supNotes').value.trim()
        };
        if(!body.name){toast('El nombre es obligatorio','err');return;}
        try{
          if(id){await api('PUT','/api/erp/suppliers/'+id,body);}
          else{await api('POST','/api/erp/suppliers',body);}
          closeModal('supModal');
          toast('Proveedor guardado');
          loadSups();
        }catch(e){toast(e.message,'err');}
      }
      async function delSup(id){
        if(!confirm('¿Archivar este proveedor? Dejará de aparecer en la lista y en los selectores, pero no se borra.'))return;
        try{await api('DELETE','/api/erp/suppliers/'+id);toast('Archivado');loadSups();}
        catch(e){toast(e.message,'err');}
      }
      async function restoreSup(id){
        try{await api('POST','/api/erp/suppliers/'+id+'/restore');toast('Restaurado');loadSups();}
        catch(e){toast(e.message,'err');}
      }
      loadSups();
      </script>`;
    return c.html(adminLayout('Proveedores', content, 'suppliers', c.get('session')?.csrfToken||'', c));
  });

  return { api, views };
}
