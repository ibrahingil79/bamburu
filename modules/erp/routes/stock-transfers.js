import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, can, estadoTabs, emptyRow } from '../layout.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { stockTransferSchema, purchaseOrderAnularSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { bloquearSiTrazable } from '../trazabilidad.js';
import { recordMovement, isPhysical, productStockInWarehouse, reservedOfProduct } from '../stock.js';
import { activeWarehouses } from './warehouses.js';
import { lineSearchCellHtml, lineSearchScript } from '../views/line-search.js';
import { ENTITY } from '../../../core/activity-entities.js';
import { jsonForScript } from '../../../core/escape.js';

// ════════════════════════════════════════════════════════════════════════════
// TRASLADO ENTRE ALMACENES — Multi-almacén · Capa 3. Mueve mercancía de un almacén
// a otro en un solo gesto (sale de uno, entra en otro) con su propio documento
// inmutable TR-NNNN. REGLA RECTORA: un traslado NO cambia el stock total ni el coste
// medio (WAC) global del producto; solo redistribuye cantidad —y, derivado, valor—
// entre almacenes.
//
// Confirmar = por cada línea DOS movimientos en el libro:
//   · transfer_out: almacén ORIGEN, cantidad −, coste NULL (una salida no toca el WAC).
//   · transfer_in:  almacén DESTINO, cantidad +, coste = WAC GLOBAL congelado (vuelve a
//     entrar exactamente el valor que salió → WAC global intacto; el valor por almacén se
//     mueve solo, es qty_almacén × WAC global, ya derivado).
// El coste se CONGELA en la línea (no se lee el WAC en vivo): así, aunque el traslado vacíe
// el stock global a 0 a mitad (el medio se resetea), el transfer_in lo recompone con el coste
// real. Corregir = ANULAR (motivo) y crear otro: re-entrada al ORIGEN (coste congelado, NO
// NULL: recompone el WAC sin hundirlo) + salida del DESTINO (coste NULL). Nada se borra.
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Nombre de la ENTIDAD del traslado en `activity_logs`. Fuente única, y por un motivo concreto: el
// traslado se registra desde DOS sitios (la ruta del panel y la acción `transfer_stock` de DISA), y
// cada uno lo escribía a mano. Divergieron: la ruta ponía 'stock_transfer' y DISA 'stock_transfers'
// (el nombre de la tabla), así que auditar por `entity='stock_transfer'` NO devolvía los traslados
// hechos por DISA. Se elige el SINGULAR porque es la convención de las rutas del ERP ('invoice',
// 'product', 'warehouse'…). Importar esta constante en vez de teclear el literal hace imposible
// volver a separarlos. OJO: las filas viejas conservan su etiqueta — un registro de actividad no se
// reescribe hacia atrás; ver `verify-traslado-auditoria.mjs`.
//
// El valor ya no vive aquí: es `ENTITY.STOCK_TRANSFER` del catálogo único (`core/activity-entities.js`),
// donde están TODAS las entidades. Esto se queda como re-exportación para no romper a quien lo importa.
export const TRANSFER_ENTITY = ENTITY.STOCK_TRANSFER;
// Detalle legible del registro, idéntico venga de donde venga.
export const transferLogDetails = r =>
  (r.transfer_number || ('#' + r.id)) + ' (' + r.lines + ' línea' + (r.lines === 1 ? '' : 's') + ')';

// ¿Hay traslados CONFIRMADOS que ya SACARON stock de este almacén para alguno de estos
// productos? (guarda de integridad AGUAS ARRIBA reutilizable). Cancelar la compra/recepción
// que metió ese stock escribe una salida inversa del MISMO almacén; si parte ya se trasladó,
// esa salida dejaría el almacén en negativo de forma silenciosa. Bloquear con 409.
export function hasActiveTransfersFromOrigin(db, warehouseId, productIds) {
  if (!productIds || !productIds.length) return false;
  const ph = productIds.map(() => '?').join(',');
  return !!db.prepare(
    `SELECT 1 FROM stock_transfer_items sti JOIN stock_transfers st ON st.id = sti.transfer_id
      WHERE st.status='confirmada' AND st.from_warehouse_id=? AND sti.product_id IN (${ph}) LIMIT 1`
  ).get(warehouseId, ...productIds);
}

export function getTransfer(db, id) {
  const t = db.prepare('SELECT * FROM stock_transfers WHERE id=?').get(id);
  if (!t) return null;
  const items = db.prepare(
    'SELECT sti.*, pr.name AS product_name, pr.sku FROM stock_transfer_items sti JOIN products pr ON pr.id=sti.product_id WHERE sti.transfer_id=? ORDER BY sti.id'
  ).all(id);
  return { ...t, items };
}

// ── SERVICIO: crear y confirmar un traslado (un solo paso; confirm-first de UI) ──
export function createStockTransferSvc(db, d) {
  const from = db.prepare('SELECT id, name FROM warehouses WHERE id=? AND active=1').get(d.from_warehouse_id);
  if (!from) { const e = new Error('Almacén de origen no válido o archivado'); e.status = 400; throw e; }
  const to = db.prepare('SELECT id, name FROM warehouses WHERE id=? AND active=1').get(d.to_warehouse_id);
  if (!to) { const e = new Error('Almacén de destino no válido o archivado'); e.status = 400; throw e; }
  if (from.id === to.id) { const e = new Error('El almacén de origen y el de destino deben ser distintos'); e.status = 400; throw e; }

  const seen = new Set();
  const resolved = [];
  for (const it of d.items) {
    const product = db.prepare('SELECT id, name, type, average_cost FROM products WHERE id=?').get(it.product_id);
    if (!product) { const e = new Error('Uno de los productos del traslado ya no existe.'); e.status = 400; throw e; }
    if (seen.has(product.id)) { const e = new Error('Producto repetido en el traslado ("' + product.name + '")'); e.status = 400; throw e; }
    seen.add(product.id);
    if (!isPhysical(db, product)) { const e = new Error('"' + product.name + '" no es un producto físico: no lleva stock'); e.status = 400; throw e; }
    bloquearSiTrazable(db, product.id, 'El traslado entre almacenes');
    if (!(it.quantity > 0)) { const e = new Error('"' + product.name + '": la cantidad debe ser mayor que 0'); e.status = 400; throw e; }
    const avail = productStockInWarehouse(db, product.id, from.id);
    if (it.quantity > avail) {
      const e = new Error('"' + product.name + '": disponible en ' + from.name + ' ' + avail + ', intentas trasladar ' + it.quantity);
      e.status = 400; throw e;
    }
    // PIEZA 2a — GUARDA DE INTEGRIDAD DE LA RESERVA (aviso-confirmado, nunca en silencio):
    // sacar este traslado no puede dejar el ORIGEN por debajo de lo reservado allí (pedidos
    // confirmados que apartan desde ese almacén) sin que el usuario lo confirme.
    if (!d.confirm_below_reserved) {
      const reserved = reservedOfProduct(db, product.id, from.id);
      const after = avail - it.quantity;
      if (reserved > 0 && after < reserved) {
        const e = new Error('"' + product.name + '": este traslado dejaría ' + after + ' en ' + from.name
          + ', y hay ' + reserved + ' reservados por pedidos confirmados (quedarían ' + (after - reserved)
          + ' libres). Confírmalo para trasladar igualmente (confirm_below_reserved).');
        e.status = 409; throw e;
      }
    }
    // WAC GLOBAL congelado: con este coste vuelve a entrar el valor en el destino.
    resolved.push({ product_id: product.id, quantity: it.quantity, unit_cost: product.average_cost || 0 });
  }

  const run = db.transaction(() => {
    const transfer_number = nextCode(db, 'stock_transfer');
    const r = db.prepare(`INSERT INTO stock_transfers
        (transfer_number, from_warehouse_id, from_warehouse_name, to_warehouse_id, to_warehouse_name, date, notes)
        VALUES (?,?,?,?,?,?,?)`)
      .run(transfer_number, from.id, from.name, to.id, to.name, d.date, d.notes || '');
    const tid = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO stock_transfer_items (transfer_id, product_id, quantity, unit_cost) VALUES (?,?,?,?)');
    for (const it of resolved) {
      ins.run(tid, it.product_id, it.quantity, it.unit_cost);
      // Salida del ORIGEN con coste NULL a propósito: una salida deja el WAC intacto.
      recordMovement(db, {
        product_id: it.product_id, type: 'transferencia', quantity: -it.quantity,
        origin_type: 'transfer_out', origin_id: tid, warehouse_id: from.id,
        note: 'Traslado ' + transfer_number + ' · salida ' + from.name + ' → ' + to.name,
      });
      // Entrada en el DESTINO con el WAC global congelado (NO NULL): recompone el valor.
      recordMovement(db, {
        product_id: it.product_id, type: 'transferencia', quantity: it.quantity, unit_cost: it.unit_cost,
        origin_type: 'transfer_in', origin_id: tid, warehouse_id: to.id,
        note: 'Traslado ' + transfer_number + ' · entrada ' + from.name + ' → ' + to.name,
      });
    }
    return { id: tid, transfer_number, lines: resolved.length };
  });
  return run();
}

// ── SERVICIO: anular un traslado confirmado (motivo obligatorio) ─────────────
// Movimientos INVERSOS: salida del DESTINO (coste NULL) + re-entrada al ORIGEN (coste
// congelado, NO NULL: recompone el WAC). GUARDA: el DESTINO debe seguir teniendo ≥ la
// cantidad trasladada de cada línea; si ese stock ya se vendió/movió, la salida inversa
// iría a negativo → 409 pidiendo deshacer antes lo de aguas abajo.
export function cancelStockTransferSvc(db, transferId, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const t = db.prepare('SELECT * FROM stock_transfers WHERE id=?').get(transferId);
  if (!t) { const e = new Error('Traslado no encontrado'); e.status = 404; throw e; }
  if (t.status !== 'confirmada') { const e = new Error('Este traslado ya está anulado'); e.status = 400; throw e; }
  const items = db.prepare('SELECT sti.*, pr.name AS product_name FROM stock_transfer_items sti JOIN products pr ON pr.id=sti.product_id WHERE sti.transfer_id=?').all(transferId);

  // Guarda de reversibilidad: el DESTINO debe poder soltar lo que se trasladó.
  for (const it of items) {
    const inDest = productStockInWarehouse(db, it.product_id, t.to_warehouse_id);
    if (inDest < it.quantity) {
      const e = new Error('No se puede anular: "' + it.product_name + '" tiene ' + inDest + ' en ' + (t.to_warehouse_name || 'el destino') + ' y el traslado movió ' + it.quantity + '. Deshaz antes las salidas/ventas de ese stock en el destino.');
      e.status = 409; throw e;
    }
  }

  const run = db.transaction(() => {
    for (const it of items) {
      // Salida del DESTINO con coste NULL (una salida no toca el WAC).
      recordMovement(db, {
        product_id: it.product_id, type: 'transferencia', quantity: -it.quantity,
        origin_type: 'transfer_in', origin_id: transferId, warehouse_id: t.to_warehouse_id,
        note: 'Anulación del traslado ' + (t.transfer_number || ('#' + transferId)) + ' · salida ' + (t.to_warehouse_name || ''),
      });
      // Re-entrada al ORIGEN con el coste congelado (NO NULL): recompone el WAC sin hundirlo.
      recordMovement(db, {
        product_id: it.product_id, type: 'transferencia', quantity: it.quantity, unit_cost: it.unit_cost,
        origin_type: 'transfer_out', origin_id: transferId, warehouse_id: t.from_warehouse_id,
        note: 'Anulación del traslado ' + (t.transfer_number || ('#' + transferId)) + ' · entrada ' + (t.from_warehouse_name || ''),
      });
    }
    db.prepare("UPDATE stock_transfers SET status='anulada', anulada_motivo=? WHERE id=?").run(m, transferId);
    return { id: transferId, transfer_number: t.transfer_number, reverted_lines: items.length };
  });
  return run();
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export function createStockTransferRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API ──
  api.get('/:id', requirePerm('inventory.read'), c => {
    try {
      const t = getTransfer(db, parseInt(c.req.param('id')));
      if (!t) return c.json({ error: 'No encontrado' }, 404);
      return c.json(t);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/', requirePerm('inventory.edit'), validate(stockTransferSchema), c => {
    try {
      const r = createStockTransferSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Registró traslado entre almacenes', TRANSFER_ENTITY, r.id, transferLogDetails(r));
      return c.json({ ...r, message: 'Traslado ' + r.transfer_number + ' confirmado' }, 201);
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  api.post('/:id/cancel', requirePerm('inventory.edit'), validate(purchaseOrderAnularSchema), c => {
    try {
      const { motivo } = c.get('validated');
      const r = cancelStockTransferSvc(db, parseInt(c.req.param('id')), motivo);
      logActivity(db, c.get('session'), 'Anuló traslado entre almacenes', TRANSFER_ENTITY, r.id, (r.transfer_number || '') + ' — ' + motivo);
      return c.json({ ...r, message: 'Traslado anulado y stock revertido' });
    } catch (e) { return c.json({ error: safeError(e) }, e.status || 500); }
  });

  // ── VISTAS ──

  // Lista server-rendered (patrón P4): búsqueda por nº/almacén + filtro estado + paginación 25.
  views.get('/', requirePerm('inventory.read'), c => {
    const q = (c.req.query('q') || '').trim();
    const estado = (c.req.query('estado') || '').trim();
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    const where = [];
    const params = [];
    if (q) { where.push('(transfer_number LIKE ? OR from_warehouse_name LIKE ? OR to_warehouse_name LIKE ?)'); params.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
    if (estado === 'confirmada' || estado === 'anulada') { where.push('status=?'); params.push(estado); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare('SELECT COUNT(*) AS n FROM stock_transfers ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const rows = db.prepare(
      `SELECT st.*,
              (SELECT COALESCE(SUM(quantity),0) FROM stock_transfer_items WHERE transfer_id=st.id) AS uds
         FROM stock_transfers st ` + whereSql +
      ' ORDER BY st.date DESC, st.id DESC LIMIT ? OFFSET ?'
    ).all(...params, perPage, offset);

    const buildQs = (p) => {
      const u = new URLSearchParams();
      if (q) u.set('q', q);
      if (estado) u.set('estado', estado);
      u.set('page', String(p));
      return u.toString();
    };

    const badge = s => s === 'confirmada' ? '<span class="badge b-green">Confirmado</span>' : '<span class="badge b-red">Anulado</span>';
    const rowsHtml = rows.map(r =>
      '<tr>'
      + '<td><strong style="font-family:monospace">' + esc(r.transfer_number || ('#' + r.id)) + '</strong></td>'
      + '<td><strong>' + esc(r.from_warehouse_name) + '</strong> <span style="color:var(--text3)">→</span> <strong>' + esc(r.to_warehouse_name) + '</strong></td>'
      + '<td>' + esc(r.date) + '</td>'
      + '<td>' + badge(r.status) + '</td>'
      + '<td style="text-align:right">' + Number(r.uds) + '</td>'
      + '<td style="text-align:right"><a href="/admin/stock-transfers/' + r.id + '" class="btn btn-secondary btn-sm">Ver</a></td>'
      + '</tr>'
    ).join('');

    const estadoTabsHtml = estadoTabs(estado, [['', 'Todos'], ['confirmada', 'Confirmados'], ['anulada', 'Anulados']], q);

    const content = `
      <div class="ph">
        <h2>Traslados entre almacenes</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${esc(q)}" placeholder="Buscar por número o almacén...">
          <input type="hidden" name="estado" value="${esc(estado)}">
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'inventory.edit') ? '<a href="/admin/stock-transfers/new" class="btn btn-primary">Nuevo traslado</a>' : ''}
        </form>
      </div>
      ${estadoTabsHtml}
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Número</th><th>Origen → Destino</th><th>Fecha</th><th>Estado</th><th style="text-align:right">Unidades</th><th></th></tr></thead>
          <tbody>${total === 0 ? ((q || estado) ? emptyRow(6, 'No se encontraron traslados con ese filtro.', { icon: 'ti-search' }) : emptyRow(6, 'Aún no hay traslados. Un traslado mueve mercancía entre almacenes sin cambiar tu stock total.', { cta: 'Nuevo traslado', href: '/admin/stock-transfers/new' })) : rowsHtml}</tbody>
        </table></div>
      </div>
      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--text3);font-size:.85rem">Página ${page} de ${totalPages} · ${total} traslado${total === 1 ? '' : 's'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div>
      </div>` : ''}`;
    return c.html(adminLayout('Traslados entre almacenes', content, 'stock-transfers', c.get('session')?.csrfToken || '', c));
  });

  // Crear: eliges Origen + Destino → añades líneas (productos físicos del catálogo) con
  // cantidad → resumen confirm-first → confirmar. El disponible en ORIGEN se consulta en vivo.
  views.get('/new', requirePerm('inventory.edit'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const today = new Date().toISOString().split('T')[0];
    const csrfToken = c.get('session')?.csrfToken || '';
    const warehouses = activeWarehouses(db);

    if (warehouses.length < 2) {
      const content = `
        <div class="ph"><h2>Nuevo traslado entre almacenes</h2><a href="/admin/stock-transfers" class="btn btn-secondary">Volver</a></div>
        <div class="card card-body" style="text-align:center;padding:2rem;color:var(--text3)">
          Necesitas al menos <strong>dos almacenes activos</strong> para trasladar mercancía. Crea otro almacén en <a href="/admin/warehouses" style="color:var(--teal)">Almacenes</a>.
        </div>`;
      return c.html(adminLayout('Nuevo traslado entre almacenes', content, 'stock-transfers', csrfToken, c));
    }

    const catalog = db.prepare(
      "SELECT id, name, sku, price FROM products WHERE status='active' AND COALESCE(type,'physical')='physical' ORDER BY name"
    ).all();
    const whOpt = (sel) => warehouses.map(w =>
      '<option value="' + w.id + '"' + (sel === 'from' && w.is_default ? ' selected' : '') + '>' + esc(w.name) + (w.is_default ? ' (principal)' : '') + '</option>'
    ).join('');

    const content = `
      <div class="ph"><h2>Nuevo traslado entre almacenes</h2><a href="/admin/stock-transfers" class="btn btn-secondary">Volver</a></div>
      <div class="alert alert-warn">El traslado es <strong>inmutable</strong> y mueve el stock del almacén de origen al de destino. <strong>No cambia el stock total ni el coste medio</strong> del producto. Corregirlo = anularlo (con motivo) y crear otro. Solo puedes trasladar hasta lo disponible en el origen.</div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Almacenes</h3></div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Origen *</label><select class="form-control" id="fFrom" onchange="onWh()">${whOpt('from')}</select></div>
            <div class="form-group"><label class="form-label">Destino *</label><select class="form-control" id="fTo" onchange="onWh()">${whOpt('to')}</select></div>
            <div class="form-group"><label class="form-label">Fecha *</label><input class="form-control" type="date" id="fDate" value="${today}"></div>
          </div>
          <div id="whWarn" class="alert alert-err" style="display:none;margin-bottom:0">El origen y el destino deben ser distintos.</div>
          <div class="form-group" style="margin-top:.6rem"><label class="form-label">Notas</label><input class="form-control" id="fNotes" placeholder="Motivo del movimiento, transportista interno..."></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Líneas a trasladar</h3></div>
        <!-- overflow:visible (no .table-wrap por defecto): el .table-wrap recorta con overflow
             auto en ambos ejes y, con una sola fila, esconde el desplegable del buscador que
             cae justo bajo el borde inferior. La tabla es estrecha (4 columnas) → no necesita
             scroll horizontal. -->
        <div class="table-wrap" style="overflow:visible"><table>
          <thead><tr><th style="min-width:220px">Producto</th><th style="text-align:right">Disponible en origen</th><th>Trasladar</th><th></th></tr></thead>
          <tbody id="rLines"></tbody>
        </table></div>
        <div class="card-body"><button type="button" class="btn btn-secondary btn-sm" onclick="addRow()">+ Añadir línea</button></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem">
        <a href="/admin/stock-transfers" class="btn btn-secondary">Cancelar</a>
        <button class="btn btn-primary" id="btn-confirm" onclick="confirmTransfer()">Confirmar traslado</button>
      </div>
      <script>
      const SYM = '${sym}';
      const catalog = ${jsonForScript(catalog)};
      const LINE_CELL = ${JSON.stringify(lineSearchCellHtml('<input type="hidden" class="line-pid">'))};
      let STOCKMAP = {};   // product_id -> qty disponible en el ORIGEN seleccionado

      ${lineSearchScript()}

      // Al elegir un producto del buscador: fija product_id oculto + nombre + refresca disponible.
      function applyLinePick(row, p){
        row.querySelector('.line-pid').value = p.id;
        row.querySelector('.line-desc').value = p.name + (p.sku ? ' [' + p.sku + ']' : '');
        refreshRow(row);
      }

      function availFor(pid){ return STOCKMAP[pid] != null ? STOCKMAP[pid] : 0; }

      function refreshRow(row){
        const pid = parseInt(row.querySelector('.line-pid').value) || 0;
        const cell = row.querySelector('.r-avail');
        const qtyEl = row.querySelector('.r-qty');
        if (!pid){ cell.textContent = '—'; qtyEl.max = ''; return; }
        const avail = availFor(pid);
        cell.textContent = avail;
        qtyEl.max = avail;
        let qty = parseInt(qtyEl.value) || 0;
        if (qty > avail){ qtyEl.value = avail; }
        cell.style.color = (parseInt(qtyEl.value)||0) > avail ? 'var(--danger)' : '';
      }

      function rowHtml(){
        return '<tr>' + LINE_CELL
          + '<td style="text-align:right" class="r-avail">—</td>'
          + '<td><input class="form-control r-qty" type="number" min="0" value="0" style="width:100px" oninput="onQty(this)"></td>'
          + '<td style="text-align:right"><button type="button" class="btn btn-secondary btn-sm" onclick="this.closest(\\'tr\\').remove()">✕</button></td>'
          + '</tr>';
      }
      function addRow(){
        const tb = document.getElementById('rLines');
        tb.insertAdjacentHTML('beforeend', rowHtml());
      }
      function onQty(el){ refreshRow(el.closest('tr')); }

      function onWh(){
        const from = document.getElementById('fFrom').value;
        const to = document.getElementById('fTo').value;
        document.getElementById('whWarn').style.display = (from && from === to) ? '' : 'none';
        loadStock(from);
      }

      async function loadStock(whId){
        STOCKMAP = {};
        if (whId){
          try {
            const arr = await api('GET','/api/erp/warehouses/' + whId + '/stock');
            (arr || []).forEach(function(r){ STOCKMAP[r.product_id] = r.qty; });
          } catch(e){ /* sin stock = todo 0 */ }
        }
        document.querySelectorAll('#rLines tr').forEach(refreshRow);
      }

      function collect(){
        const items = [];
        document.querySelectorAll('#rLines tr').forEach(function(r){
          const pid = parseInt(r.querySelector('.line-pid').value) || 0;
          const qty = parseInt(r.querySelector('.r-qty').value) || 0;
          if (pid && qty > 0) items.push({ product_id: pid, quantity: qty });
        });
        return items;
      }

      async function confirmTransfer(){
        const from = parseInt(document.getElementById('fFrom').value) || 0;
        const to = parseInt(document.getElementById('fTo').value) || 0;
        const date = document.getElementById('fDate').value;
        if (!from || !to){ toast('Elige origen y destino','err'); return; }
        if (from === to){ toast('El origen y el destino deben ser distintos','err'); return; }
        if (!date){ toast('La fecha es obligatoria','err'); return; }
        const items = collect();
        if (!items.length){ toast('Añade al menos una línea con producto y cantidad','err'); return; }
        // Aviso si alguna línea supera lo disponible (el servidor lo rechaza igualmente).
        for (const it of items){ if (it.quantity > availFor(it.product_id)){ toast('Una línea supera lo disponible en el origen','err'); return; } }
        const fromName = document.getElementById('fFrom').selectedOptions[0].text;
        const toName = document.getElementById('fTo').selectedOptions[0].text;
        const units = items.reduce(function(s,i){ return s + i.quantity; }, 0);
        if (!await window.confirmarEnPagina({titulo:'Confirmar el traslado',
      texto:'Son ' + items.length + ' línea(s), ' + units + ' unidades, de ' + fromName + ' a ' + toName + '. Moverá ese stock entre almacenes y será inmutable: corregirlo es anularlo y crear otro.',
      aceptar:'Sí, confirmarlo'})) return;
        const btn = document.getElementById('btn-confirm');
        btn.disabled = true;
        const send = function(confirmBelow){
          return api('POST','/api/erp/stock-transfers', {
            from_warehouse_id: from, to_warehouse_id: to,
            date: date, notes: document.getElementById('fNotes').value.trim(), items: items,
            confirm_below_reserved: !!confirmBelow,
          });
        };
        try {
          let d;
          try { d = await send(false); }
          catch(e){
            // PIEZA 2a — guarda de reserva: dejar el origen por debajo de lo reservado avisa
            // (aviso-confirmado). El usuario confirma y se reintenta.
            if (/reservad/i.test(e.message||'') && await window.confirmarEnPagina({titulo:'Hay stock reservado',texto:(e.message||''),aceptar:'Trasladar igualmente'})) d = await send(true);
            else throw e;
          }
          toast(d.message || 'Traslado confirmado');
          window.location.href = '/admin/stock-transfers/' + d.id;
        } catch(e){ toast(e.message || 'Error registrando el traslado','err'); btn.disabled = false; }
      }

      addRow();
      onWh();
      </script>`;
    return c.html(adminLayout('Nuevo traslado entre almacenes', content, 'stock-transfers', csrfToken, c));
  });

  // Ficha del traslado (inmutable): TR-NNNN, origen → destino, líneas, estado + botón Anular.
  views.get('/:id', requirePerm('inventory.read'), c => {
    const t = getTransfer(db, parseInt(c.req.param('id')));
    if (!t) return c.redirect('/admin/stock-transfers');
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const csrfToken = c.get('session')?.csrfToken || '';
    const canEdit = can(c, 'inventory.edit');

    const totalUds = t.items.reduce((s, i) => s + i.quantity, 0);
    const totalVal = t.items.reduce((s, i) => s + Math.round(i.quantity * i.unit_cost * 100) / 100, 0);
    const rows = t.items.map(i =>
      `<tr><td>${i.sku ? `<span style="color:var(--text3);font-size:.8rem">[${esc(i.sku)}]</span> ` : ''}${esc(i.product_name)}</td>` +
      `<td style="text-align:right">${i.quantity}</td><td style="text-align:right">${Number(i.unit_cost).toFixed(2)} ${sym}</td>` +
      `<td style="text-align:right"><strong>${(Math.round(i.quantity * i.unit_cost * 100) / 100).toFixed(2)} ${sym}</strong></td></tr>`
    ).join('');

    const badge = t.status === 'confirmada' ? '<span class="badge b-green">Confirmado</span>' : '<span class="badge b-red">Anulado</span>';
    const motivoBlock = t.status === 'anulada'
      ? `<div class="alert alert-err">Traslado anulado. Motivo: ${esc(t.anulada_motivo || '')}. El stock volvió al almacén de origen (salida del destino + entrada al origen con el coste congelado).</div>` : '';
    const notesBlock = t.notes ? `<div style="margin-top:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Notas</span><br>${esc(t.notes)}</div>` : '';

    const content = `
      <div class="ph"><h2>Traslado ${esc(t.transfer_number || ('#' + t.id))}</h2>
        <div style="display:flex;gap:.5rem">
          ${t.status === 'confirmada' && canEdit ? '<button class="btn btn-danger" onclick="anularTraslado()">Anular</button>' : ''}
          <a href="/admin/stock-transfers" class="btn btn-secondary">Volver</a>
        </div>
      </div>
      ${motivoBlock}
      <div class="grid g2" style="margin-bottom:1rem">
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Origen</span><br><strong>${esc(t.from_warehouse_name)}</strong></div>
          <div><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Destino</span><br><strong>${esc(t.to_warehouse_name)}</strong></div>
        </div>
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Fecha</span><br>${esc(t.date)}</div>
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Estado</span><br>${badge}</div>
          ${notesBlock}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Líneas trasladadas (inmutables — corregir = anular y crear otro)</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Coste unit. (WAC)</th><th style="text-align:right">Valor movido</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td style="text-align:right;font-weight:700;padding:.7rem 1rem">${totalUds} uds</td><td></td><td style="text-align:right;font-weight:700">Valor</td><td style="text-align:right;font-weight:700">${totalVal.toFixed(2)} ${sym}</td></tr></tfoot>
        </table></div>
        <div class="card-body" style="color:var(--text3);font-size:.78rem">El coste es el medio ponderado (WAC) global del producto congelado al confirmar. Un traslado no cambia el stock total ni el WAC global: solo redistribuye cantidad y valor entre almacenes.</div>
      </div>
      <script>
      async function anularTraslado(){
        const _v = await window.pedirDatos({titulo:'Anular el traslado ${esc(t.transfer_number || '')}',aceptar:'Anular',
      texto:'El stock volverá al almacén de origen.',
      campos:[{id:'motivo',etiqueta:'Motivo de la anulación'}]});
    const motivo = _v ? _v.motivo : null;
        if (motivo === null) return;
        if (motivo.trim().length < 3){ toast('El motivo es obligatorio (mínimo 3 caracteres)','err'); return; }
        try {
          const d = await api('POST','/api/erp/stock-transfers/${t.id}/cancel',{ motivo: motivo.trim() });
          toast(d.message || 'Traslado anulado'); location.reload();
        } catch(e){ toast(e.message || 'Error anulando','err'); }
      }
      </script>`;
    return c.html(adminLayout('Traslado ' + (t.transfer_number || ''), content, 'stock-transfers', csrfToken, c));
  });

  return { api, views };
}
