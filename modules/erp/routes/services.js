import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { serviceSchema } from '../schemas.js';

// A3: catálogo mixto de servicios. CRUD de los servicios que el autónomo repite
// (nombre + precio + IVA + IRPF). Se reutilizan al facturar; las líneas libres
// de un solo uso NO pasan por aquí. Tabla NUEVA `services`, no toca `products`.
export function createServiceRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API ────────────────────────────────────────────────────────
  api.get('/', requirePerm('services.read'), c => {
    try {
      return c.json(db.prepare('SELECT * FROM services ORDER BY name').all());
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  api.get('/:id', requirePerm('services.read'), c => {
    try {
      const svc = db.prepare('SELECT * FROM services WHERE id=?').get(c.req.param('id'));
      if (!svc) return c.json({ error: 'No encontrado' }, 404);
      return c.json(svc);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  api.post('/', requirePerm('services.create'), validate(serviceSchema), c => {
    try {
      const d = c.get('validated');
      const r = db.prepare('INSERT INTO services (name, base_price, tax_rate, irpf_rate) VALUES (?,?,?,?)')
        .run(d.name, d.base_price, d.tax_rate || 0, d.irpf_rate || 0);
      logActivity(db, c.get('session'), 'Creó servicio', 'service', r.lastInsertRowid, d.name);
      return c.json({ id: r.lastInsertRowid, message: 'Creado' }, 201);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  api.put('/:id', requirePerm('services.edit'), validate(serviceSchema), c => {
    try {
      const d = c.get('validated');
      db.prepare('UPDATE services SET name=?, base_price=?, tax_rate=?, irpf_rate=? WHERE id=?')
        .run(d.name, d.base_price, d.tax_rate || 0, d.irpf_rate || 0, c.req.param('id'));
      logActivity(db, c.get('session'), 'Editó servicio', 'service', c.req.param('id'), d.name);
      return c.json({ message: 'Actualizado' });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  api.delete('/:id', requirePerm('services.delete'), c => {
    try {
      const svc = db.prepare('SELECT name FROM services WHERE id=?').get(c.req.param('id'));
      db.prepare('DELETE FROM services WHERE id=?').run(c.req.param('id'));
      logActivity(db, c.get('session'), 'Eliminó servicio', 'service', c.req.param('id'), svc?.name || '');
      return c.json({ message: 'Eliminado' });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // ── VIEW: /admin/services ──────────────────────────────────────
  views.get('/', requirePerm('services.read'), c => {
    const cfg = db.prepare('SELECT currency_symbol, country FROM company_config WHERE id=1').get() || {};
    const sym = cfg.currency_symbol || '€';
    const showIrpf = (cfg.country || 'ES').toUpperCase() === 'ES';
    const canCreate = can(c, 'services.create');
    const canEdit = can(c, 'services.edit');
    const canDelete = can(c, 'services.delete');

    const content = `
      <div class="ph">
        <h2>Servicios</h2>
        <div style="display:flex;gap:.5rem">
          <input class="search" id="searchBox" placeholder="Buscar...">
          ${canCreate ? '<button class="btn btn-primary" onclick="openNew()">Nuevo servicio</button>' : ''}
        </div>
      </div>

      <p style="color:var(--muted);font-size:.85rem;margin:-.5rem 0 1rem">
        Lo que repites (la sesión, la hora de consultoría…). Al crear una factura podrás elegirlo
        y rellenar la línea de un toque. Las líneas sueltas de un solo uso se escriben directamente
        en la factura y no hace falta guardarlas aquí.
      </p>

      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Servicio</th><th style="text-align:right">Precio base</th><th>IVA</th>${showIrpf ? '<th>IRPF</th>' : ''}<th></th></tr></thead>
          <tbody id="svcBody"></tbody>
        </table></div>
      </div>

      <div class="modal-overlay" id="svcModal">
        <div class="modal" style="max-width:520px">
          <div class="modal-head"><h3 id="svcModalTitle">Nuevo servicio</h3><button class="modal-close" onclick="closeModal('svcModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="svcId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="sName" placeholder="Ej. Sesión de fotos"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Precio base (${sym}) *</label><input class="form-control" type="number" step="0.01" min="0" id="sPrice" value="0"></div>
              <div class="form-group"><label class="form-label">IVA (%)</label>
                <select class="form-control" id="sTax">
                  <option value="21">21%</option>
                  <option value="10">10%</option>
                  <option value="4">4%</option>
                  <option value="0">Exento (0%)</option>
                </select>
              </div>
              ${showIrpf ? `
              <div class="form-group"><label class="form-label">IRPF (%)</label>
                <select class="form-control" id="sIrpf">
                  <option value="0">Sin IRPF</option>
                  <option value="7">7%</option>
                  <option value="15">15%</option>
                </select>
              </div>` : ''}
            </div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('svcModal')">Cancelar</button><button class="btn btn-primary" onclick="saveSvc()">Guardar</button></div>
        </div>
      </div>

      <script>
      const SYM = '${sym}';
      const SHOW_IRPF = ${showIrpf};
      const CAN_EDIT = ${canEdit};
      const CAN_DELETE = ${canDelete};
      let services = [];

      async function load(){
        services = await api('GET','/api/erp/services').catch(()=>[]);
        render();
      }
      function render(){
        const q = document.getElementById('searchBox').value.toLowerCase();
        const f = q ? services.filter(s=>s.name.toLowerCase().includes(q)) : services;
        const cols = SHOW_IRPF ? 5 : 4;
        document.getElementById('svcBody').innerHTML = f.length ? f.map(s=>{
          const tax = Number(s.tax_rate)>0 ? Number(s.tax_rate)+'%' : 'Exento';
          const irpf = Number(s.irpf_rate)>0 ? Number(s.irpf_rate)+'%' : '—';
          return '<tr>'+
            '<td><strong>'+escHtml(s.name)+'</strong></td>'+
            '<td style="text-align:right"><strong>'+SYM+Number(s.base_price||0).toFixed(2)+'</strong></td>'+
            '<td><span class="badge b-gray">'+tax+'</span></td>'+
            (SHOW_IRPF ? '<td style="color:var(--muted)">'+irpf+'</td>' : '')+
            '<td style="white-space:nowrap;text-align:right">'+
              (CAN_EDIT ? '<button class="btn btn-secondary btn-sm" onclick="editSvc('+s.id+')">Editar</button> ' : '')+
              (CAN_DELETE ? '<button class="btn btn-danger btn-sm" onclick="delSvc('+s.id+')">Eliminar</button>' : '')+
            '</td>'+
          '</tr>';
        }).join('') : '<tr><td colspan="'+cols+'" style="text-align:center;padding:2rem;color:var(--muted)">Sin servicios guardados</td></tr>';
      }
      document.getElementById('searchBox').addEventListener('input', render);

      function openNew(){
        document.getElementById('svcModalTitle').textContent='Nuevo servicio';
        document.getElementById('svcId').value='';
        document.getElementById('sName').value='';
        document.getElementById('sPrice').value='0';
        document.getElementById('sTax').value='21';
        if (SHOW_IRPF) document.getElementById('sIrpf').value='0';
        openModal('svcModal');
      }
      function editSvc(id){
        const s = services.find(x=>x.id===id); if(!s) return;
        document.getElementById('svcModalTitle').textContent='Editar servicio';
        document.getElementById('svcId').value=id;
        document.getElementById('sName').value=s.name;
        document.getElementById('sPrice').value=Number(s.base_price||0);
        document.getElementById('sTax').value=String(Number(s.tax_rate)||0);
        if (SHOW_IRPF) document.getElementById('sIrpf').value=String(Number(s.irpf_rate)||0);
        openModal('svcModal');
      }
      async function saveSvc(){
        const id = document.getElementById('svcId').value;
        const name = document.getElementById('sName').value.trim();
        if(!name){ toast('Falta el nombre','err'); return; }
        const body = {
          name,
          base_price: parseFloat(document.getElementById('sPrice').value)||0,
          tax_rate: parseFloat(document.getElementById('sTax').value)||0,
          irpf_rate: SHOW_IRPF ? (parseFloat(document.getElementById('sIrpf').value)||0) : 0,
        };
        try {
          if(id) await api('PUT','/api/erp/services/'+id, body);
          else await api('POST','/api/erp/services', body);
          closeModal('svcModal'); toast(id?'Actualizado':'Creado'); load();
        } catch(e){ toast(e.message||'Error','err'); }
      }
      async function delSvc(id){
        if(!confirm('¿Eliminar este servicio del catálogo? Las facturas ya emitidas no se ven afectadas.')) return;
        try { await api('DELETE','/api/erp/services/'+id); toast('Eliminado'); load(); }
        catch(e){ toast(e.message||'Error','err'); }
      }
      load();
      </script>`;
    return c.html(adminLayout('Servicios', content, 'services', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
