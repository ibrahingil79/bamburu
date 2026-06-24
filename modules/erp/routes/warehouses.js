import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { validate } from '../../../core/validate.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { warehouseSchema } from '../schemas.js';
import { reservedOfProduct } from '../stock.js';   // PIEZA 2a: reservado/disponible por almacén

// ════════════════════════════════════════════════════════════════════════════
// Multi-almacén · CAPA 1 — gestionar almacenes + ver stock por almacén. Es el
// CIMIENTO: aquí NO se elige almacén en las operaciones (POS, compras, etc. siguen
// escribiendo al por defecto — eso es Capa 2) ni hay transferencias (Capa 3). El
// coste medio (WAC) sigue siendo GLOBAL por producto: aquí no se toca.
//
// Patrón espejo de Proveedores/Clientes: servicio validado compartido por formulario
// y API, archivar-no-borrar (active=0) + restaurar, y guarda de duplicado. Invariante
// del modelo: EXACTAMENTE UN almacén activo es el principal (is_default=1).
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Guardas (en el servicio, no solo en la UI) ──────────────────────────────
// Nombre único entre los almacenes ACTIVOS (normaliza trim+UPPER; excluye al propio
// en edición). Devuelve la fila en conflicto o null.
export function warehouseNameConflict(db, name, excludeId = null) {
  const norm = String(name || '').trim().toUpperCase();
  if (!norm) return null;
  const ex = Number(excludeId);
  // Normaliza en JS (no en SQL): el UPPER de SQLite es solo-ASCII y no casaría acentos
  // (p. ej. "Almacén"). Comparamos sobre el conjunto de activos (excluyendo el propio).
  const rows = db.prepare('SELECT id, name FROM warehouses WHERE active=1 AND id<>?').all(Number.isFinite(ex) ? ex : -1);
  return rows.find(r => String(r.name || '').trim().toUpperCase() === norm) || null;
}

// ¿El almacén CONTIENE stock? (algún producto con SUM(quantity) != 0 en él).
export function warehouseHasStock(db, warehouseId) {
  return !!db.prepare(
    `SELECT 1 FROM (
       SELECT product_id, COALESCE(SUM(quantity),0) AS q
         FROM stock_movements WHERE warehouse_id=? GROUP BY product_id
     ) WHERE q != 0 LIMIT 1`
  ).get(warehouseId);
}

// ── Helpers de lectura (los usan la pantalla de Stock y la ficha de producto) ──
export function activeWarehouses(db) {
  return db.prepare('SELECT id, name, is_default FROM warehouses WHERE active=1 ORDER BY is_default DESC, id').all();
}

// Mapa producto→cantidad en UN almacén (al vuelo, sin caché nueva). PIEZA 2a: añade el
// reservado (pedidos confirmados en ESE almacén) y el disponible = qty − reservado, para que
// el TPV y el inventario miren "disponible" sin recalcular a ojo. qty sigue siendo el stock
// físico (no se rompe a ningún consumidor que ya lo lea).
export function warehouseStockMap(db, warehouseId) {
  const rows = db.prepare(
    'SELECT product_id, COALESCE(SUM(quantity),0) AS qty FROM stock_movements WHERE warehouse_id=? GROUP BY product_id'
  ).all(warehouseId);
  return rows.map(r => {
    const reserved = reservedOfProduct(db, r.product_id, warehouseId);
    return { ...r, reserved, available: r.qty - reserved };
  });
}

// Desglose por almacén activo de UN producto: stock físico (qty) + reservado + disponible
// (qty − reservado) en cada almacén. La reserva solo aplica a físicos; en no-físicos es 0.
export function warehouseBreakdown(db, productId) {
  const rows = db.prepare(`
    SELECT w.id, w.name, w.is_default,
           COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm
                      WHERE sm.warehouse_id=w.id AND sm.product_id=?), 0) AS qty
      FROM warehouses w WHERE w.active=1 ORDER BY w.is_default DESC, w.id`).all(productId);
  return rows.map(w => {
    const reserved = reservedOfProduct(db, productId, w.id);
    return { ...w, reserved, available: w.qty - reserved };
  });
}

// ── Valoración a coste (WAC global) — helpers CURADOS para que la voz de DISA no
// recalcule a ojo. Valor = cantidad × average_cost (coste medio ponderado GLOBAL del
// producto). Un traslado no cambia el WAC global; el valor por almacén es derivado
// (qty_almacén × WAC global), mismo criterio que /admin/inventory.
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Valoración de UN producto: stock + coste medio + valor, global y por almacén activo.
export function productValuation(db, productId) {
  const p = db.prepare("SELECT id, name, sku, stock, average_cost FROM products WHERE id=?").get(productId);
  if (!p) return null;
  const avg = p.average_cost || 0;
  const warehouses = warehouseBreakdown(db, productId).map(w => ({
    id: w.id, name: w.name, is_default: w.is_default, qty: w.qty, value: r2(w.qty * avg),
  }));
  return { product_id: p.id, name: p.name, sku: p.sku, stock: p.stock, average_cost: avg, value: r2(p.stock * avg), warehouses };
}

// Valoración del inventario completo: total global + por almacén (a coste WAC).
// Solo productos físicos (servicios/digitales no llevan stock).
export function inventoryValuation(db) {
  const tot = db.prepare(
    "SELECT COALESCE(SUM(stock * COALESCE(average_cost,0)),0) AS value, COALESCE(SUM(stock),0) AS units FROM products WHERE COALESCE(type,'physical')='physical'"
  ).get();
  const byWarehouse = db.prepare(`
    SELECT w.id, w.name, w.is_default,
           COALESCE(SUM(sm.quantity), 0) AS units,
           COALESCE(SUM(sm.quantity * COALESCE(p.average_cost, 0)), 0) AS value
      FROM warehouses w
      LEFT JOIN stock_movements sm ON sm.warehouse_id = w.id
      LEFT JOIN products p ON p.id = sm.product_id
     WHERE w.active = 1
     GROUP BY w.id ORDER BY w.is_default DESC, w.id`).all()
    .map(w => ({ id: w.id, name: w.name, is_default: w.is_default, units: w.units, value: r2(w.value) }));
  return { total_value: r2(tot.value), total_units: tot.units, warehouses: byWarehouse };
}

// ── Servicios validados (los usan la API y, por paridad, el resto del sistema) ──
export function createWarehouseSvc(db, input) {
  const res = warehouseSchema.safeParse(input);
  if (!res.success) {
    const msg = res.error.issues.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    const e = new Error(msg || 'Datos de almacén inválidos'); e.status = 400; throw e;
  }
  const d = res.data;
  if (warehouseNameConflict(db, d.name)) { const e = new Error('Ya existe un almacén activo con ese nombre'); e.status = 409; throw e; }
  const r = db.prepare('INSERT INTO warehouses (name, active, is_default) VALUES (?,1,0)').run(d.name.trim());
  return { id: r.lastInsertRowid, name: d.name.trim() };
}

export function renameWarehouseSvc(db, id, input) {
  const res = warehouseSchema.safeParse(input);
  if (!res.success) {
    const msg = res.error.issues.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    const e = new Error(msg || 'Datos de almacén inválidos'); e.status = 400; throw e;
  }
  const w = db.prepare('SELECT * FROM warehouses WHERE id=?').get(id);
  if (!w) { const e = new Error('Almacén no encontrado'); e.status = 404; throw e; }
  if (warehouseNameConflict(db, res.data.name, id)) { const e = new Error('Ya existe un almacén activo con ese nombre'); e.status = 409; throw e; }
  db.prepare('UPDATE warehouses SET name=? WHERE id=?').run(res.data.name.trim(), id);
  return { id, name: res.data.name.trim() };
}

// Marcar como principal: solo un almacén activo puede serlo. Atómico: quita la marca a
// todos los activos y la pone en este (que debe estar activo).
export function makeDefaultWarehouseSvc(db, id) {
  const w = db.prepare('SELECT * FROM warehouses WHERE id=?').get(id);
  if (!w) { const e = new Error('Almacén no encontrado'); e.status = 404; throw e; }
  if (!w.active) { const e = new Error('Un almacén archivado no puede ser el principal; restáuralo primero'); e.status = 400; throw e; }
  db.transaction(() => {
    db.prepare('UPDATE warehouses SET is_default=0 WHERE active=1').run();
    db.prepare('UPDATE warehouses SET is_default=1 WHERE id=?').run(id);
  })();
  return { id, name: w.name };
}

// Archivar (no borrar): bloquea si es el principal o si CONTIENE stock.
export function archiveWarehouseSvc(db, id) {
  const w = db.prepare('SELECT * FROM warehouses WHERE id=?').get(id);
  if (!w) { const e = new Error('Almacén no encontrado'); e.status = 404; throw e; }
  if (!w.active) { const e = new Error('El almacén ya está archivado'); e.status = 400; throw e; }
  if (w.is_default) { const e = new Error('No se puede archivar el almacén principal: marca antes otro como principal'); e.status = 409; throw e; }
  if (warehouseHasStock(db, id)) { const e = new Error('Este almacén contiene stock: vacíalo antes de archivarlo'); e.status = 409; throw e; }
  db.prepare('UPDATE warehouses SET active=0 WHERE id=?').run(id);
  return { id, name: w.name };
}

// Restaurar: vuelve a active=1 (is_default queda en 0; el principal no cambia). Re-aplica
// la guarda de nombre único entre activos (otro activo pudo tomar el nombre entretanto).
export function restoreWarehouseSvc(db, id) {
  const w = db.prepare('SELECT * FROM warehouses WHERE id=?').get(id);
  if (!w) { const e = new Error('Almacén no encontrado'); e.status = 404; throw e; }
  if (w.active) { const e = new Error('El almacén ya está activo'); e.status = 400; throw e; }
  if (warehouseNameConflict(db, w.name, id)) { const e = new Error('Ya existe un almacén activo con ese nombre; renómbralo antes de restaurar'); e.status = 409; throw e; }
  db.prepare('UPDATE warehouses SET active=1 WHERE id=?').run(id);
  return { id, name: w.name };
}

export function createWarehouseRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API ──
  // Lista (activos por defecto; ?archived=1 los archivados).
  api.get('/', requirePerm('inventory.read'), c => {
    try {
      const active = c.req.query('archived') === '1' ? 0 : 1;
      return c.json(db.prepare('SELECT * FROM warehouses WHERE active=? ORDER BY is_default DESC, id').all(active));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // Stock de UN almacén (mapa producto→cantidad), para el filtro de /admin/inventory.
  // ANTES de '/:id/...' genéricos (no hay colisión, pero mantiene el patrón).
  api.get('/:id/stock', requirePerm('inventory.read'), c => {
    try {
      return c.json(warehouseStockMap(db, parseInt(c.req.param('id'))));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  api.post('/', requirePerm('inventory.edit'), validate(warehouseSchema), c => {
    try {
      const r = createWarehouseSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Creó almacén', 'warehouse', r.id, r.name);
      return c.json({ ...r, message: 'Almacén creado' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.put('/:id', requirePerm('inventory.edit'), validate(warehouseSchema), c => {
    try {
      const r = renameWarehouseSvc(db, parseInt(c.req.param('id')), c.get('validated'));
      logActivity(db, c.get('session'), 'Renombró almacén', 'warehouse', r.id, r.name);
      return c.json({ ...r, message: 'Almacén actualizado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/default', requirePerm('inventory.edit'), c => {
    try {
      const r = makeDefaultWarehouseSvc(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Marcó almacén como principal', 'warehouse', r.id, r.name);
      return c.json({ ...r, message: 'Almacén marcado como principal' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.delete('/:id', requirePerm('inventory.edit'), c => {
    try {
      const r = archiveWarehouseSvc(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Archivó almacén', 'warehouse', r.id, r.name);
      return c.json({ ...r, message: 'Almacén archivado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/restore', requirePerm('inventory.edit'), c => {
    try {
      const r = restoreWarehouseSvc(db, parseInt(c.req.param('id')));
      logActivity(db, c.get('session'), 'Restauró almacén', 'warehouse', r.id, r.name);
      return c.json({ ...r, message: 'Almacén restaurado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // ── VISTA (lista con filtro Activos/Archivados, patrón de Proveedores) ──
  views.get('/', requirePerm('inventory.read'), c => {
    const canEdit = can(c, 'inventory.edit');
    const content = `
      <div class="ph">
        <h2>Almacenes</h2>
        <div style="display:flex;gap:.5rem;align-items:center">
          <select class="form-control" id="whState" style="width:auto;min-width:150px" onchange="loadWh()">
            <option value="0">Activos</option>
            <option value="1">Archivados</option>
          </select>
          ${canEdit ? '<button class="btn btn-primary" id="btnNew" onclick="openNew()">Nuevo almacén</button>' : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Lista de almacenes</h3><input class="search" id="searchBox" placeholder="Buscar por nombre..." oninput="filterTable()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Principal</th><th></th></tr></thead>
          <tbody id="whBody"></tbody>
        </table></div>
      </div>

      <div class="modal-overlay" id="whModal">
        <div class="modal" style="max-width:460px">
          <div class="modal-head"><h3 id="whModalTitle">Nuevo almacén</h3><button class="modal-close" onclick="closeModal('whModal')">✕</button></div>
          <div class="modal-body">
            <input type="hidden" id="whId">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="whName" maxlength="120"></div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" onclick="closeModal('whModal')">Cancelar</button>
            <button class="btn btn-primary" onclick="saveWh()">Guardar</button>
          </div>
        </div>
      </div>

      <script>
      const CAN_EDIT = ${canEdit ? 'true' : 'false'};
      let whs = [];
      function viewingArchived(){ return document.getElementById('whState').value === '1'; }
      async function loadWh(){
        const qs = viewingArchived() ? '?archived=1' : '';
        whs = await api('GET','/api/erp/warehouses'+qs).catch(function(){ return []; });
        filterTable();
      }
      function filterTable(){
        const q = (document.getElementById('searchBox').value||'').toLowerCase();
        const f = q ? whs.filter(function(w){ return (w.name||'').toLowerCase().includes(q); }) : whs;
        const arch = viewingArchived();
        document.getElementById('whBody').innerHTML = f.length ? f.map(function(w){
          const principal = w.is_default ? '<span class="badge b-green">Principal</span>' : '<span style="color:var(--muted)">—</span>';
          let acts = '';
          if (CAN_EDIT){
            if (arch){
              acts = '<button class="btn btn-primary btn-sm" onclick="restoreWh('+w.id+')">Restaurar</button>';
            } else {
              acts = '<button class="btn btn-secondary btn-sm" onclick="editWh('+w.id+')">Editar</button> ';
              if (!w.is_default) acts += '<button class="btn btn-secondary btn-sm" onclick="defaultWh('+w.id+')">Marcar principal</button> '
                                       + '<button class="btn btn-danger btn-sm" onclick="archiveWh('+w.id+')">Archivar</button>';
            }
          }
          return '<tr><td><strong>'+escHtml(w.name)+'</strong></td><td>'+principal+'</td><td style="text-align:right;white-space:nowrap">'+acts+'</td></tr>';
        }).join('') : '<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--muted)">Sin almacenes'+(arch?' archivados':'')+'</td></tr>';
      }
      function openNew(){
        document.getElementById('whId').value='';
        document.getElementById('whName').value='';
        document.getElementById('whModalTitle').textContent='Nuevo almacén';
        openModal('whModal');
      }
      function editWh(id){
        const w = whs.find(function(x){ return x.id===id; });
        if(!w) return;
        document.getElementById('whId').value=w.id;
        document.getElementById('whName').value=w.name;
        document.getElementById('whModalTitle').textContent='Renombrar almacén';
        openModal('whModal');
      }
      async function saveWh(){
        const id = document.getElementById('whId').value;
        const name = document.getElementById('whName').value.trim();
        if(!name){ toast('El nombre es obligatorio','err'); return; }
        try {
          if (id) await api('PUT','/api/erp/warehouses/'+id,{ name: name });
          else await api('POST','/api/erp/warehouses',{ name: name });
          closeModal('whModal'); toast('Almacén guardado'); loadWh();
        } catch(e){ toast(e.message||'Error','err'); }
      }
      async function defaultWh(id){
        try { await api('POST','/api/erp/warehouses/'+id+'/default'); toast('Marcado como principal'); loadWh(); }
        catch(e){ toast(e.message||'Error','err'); }
      }
      async function archiveWh(id){
        if(!confirm('¿Archivar este almacén? No se borra; deja de estar activo.')) return;
        try { await api('DELETE','/api/erp/warehouses/'+id); toast('Archivado'); loadWh(); }
        catch(e){ toast(e.message||'Error','err'); }
      }
      async function restoreWh(id){
        try { await api('POST','/api/erp/warehouses/'+id+'/restore'); toast('Restaurado'); loadWh(); }
        catch(e){ toast(e.message||'Error','err'); }
      }
      loadWh();
      </script>`;
    return c.html(adminLayout('Almacenes', content, 'warehouses', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
