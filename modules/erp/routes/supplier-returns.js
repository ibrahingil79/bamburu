import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { supplierReturnSchema, purchaseOrderAnularSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { recordMovement, isPhysical, resolveWarehouseId, originMovementWarehouse } from '../stock.js';

// ════════════════════════════════════════════════════════════════════════════
// DEVOLUCIÓN A PROVEEDOR — solo la CAPA FÍSICA (sale el stock + documento). La
// capa del dinero (lo que el proveedor abona / cuentas con proveedores) es tarea
// FUTURA y NO se construye aquí. Una devolución nace SIEMPRE de un documento de
// origen que ya movió stock: una compra directa RECIBIDA ('purchase') o una
// recepción de orden CONFIRMADA ('po_receipt'). No hay devolución "suelta".
//
// Confirmar = ENTRADA invertida: por línea, salida (−) al libro con coste NULL
// (origin_type 'supplier_return') → una salida no toca el WAC de lo que queda
// (comportamiento correcto). El coste de la línea se guarda en el documento solo
// para su VALOR. Corregir = ANULAR (motivo) y crear otra: la anulación re-entra
// stock con el coste de origen (NO NULL: una entrada con coste NULL hundiría el
// WAC a 0) — recompone el coste medio sin corromperlo. Nada se borra.
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Config por tipo de origen: dónde viven sus líneas y qué estado lo hace devolvible.
// El estado se comprueba sobre la compra/recepción EN SÍ (no sobre la orden padre):
// una recepción confirmada se puede devolver aunque su orden esté cerrada_manual.
const ORIGIN = {
  purchase: {
    table: 'purchases',
    okStatus: 'received',
    badStatusMsg: 'Solo se puede devolver una compra RECIBIDA',
    itemsSql: `SELECT pi.id AS origin_item_id, pi.product_id, pi.quantity AS recibido, pi.unit_cost,
                      pr.name AS product_name, pr.sku, pr.type AS product_type
                 FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
                WHERE pi.purchase_id = ? ORDER BY pi.id`,
    load(db, id) {
      const o = db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
      if (!o) return null;
      return { status: o.status, supplier_id: o.supplier_id, archived: !!o.archived, warehouse_id: o.warehouse_id,
               label: 'Compra #' + o.id + (o.reference ? ' · ' + o.reference : ''), date: o.date,
               href: '/admin/purchases/' + o.id };
    },
  },
  po_receipt: {
    table: 'purchase_order_receipts',
    okStatus: 'confirmada',
    badStatusMsg: 'Solo se puede devolver una recepción CONFIRMADA',
    itemsSql: `SELECT pori.id AS origin_item_id, pori.product_id, pori.quantity AS recibido, pori.unit_cost,
                      pr.name AS product_name, pr.sku, pr.type AS product_type
                 FROM purchase_order_receipt_items pori JOIN products pr ON pr.id = pori.product_id
                WHERE pori.receipt_id = ? ORDER BY pori.id`,
    load(db, id) {
      const r = db.prepare(
        'SELECT por.*, po.supplier_id FROM purchase_order_receipts por JOIN purchase_orders po ON po.id=por.order_id WHERE por.id=?'
      ).get(id);
      if (!r) return null;
      return { status: r.status, supplier_id: r.supplier_id, archived: false, warehouse_id: r.warehouse_id,
               label: 'Recepción ' + (r.receipt_number || ('#' + r.id)), date: r.date,
               href: '/admin/purchase-order-receipts/' + r.id };
    },
  },
};

// ¿Cuánto se ha devuelto YA (confirmado) de una línea de origen?
function alreadyReturned(db, origin_type, origin_id, origin_item_id) {
  return db.prepare(`
    SELECT COALESCE(SUM(sri.quantity),0) AS q
      FROM supplier_return_items sri JOIN supplier_returns sr ON sr.id = sri.return_id
     WHERE sr.status='confirmada' AND sr.origin_type=? AND sr.origin_id=? AND sri.origin_item_id=?`)
    .get(origin_type, origin_id, origin_item_id).q;
}

// ¿El origen tiene devoluciones CONFIRMADAS? (guarda de integridad reutilizable).
export function hasConfirmedReturns(db, origin_type, origin_id) {
  return !!db.prepare(
    "SELECT 1 FROM supplier_returns WHERE origin_type=? AND origin_id=? AND status='confirmada' LIMIT 1"
  ).get(origin_type, origin_id);
}

// Líneas DEVOLVIBLES de un origen: solo productos FÍSICOS, con recibido / ya devuelto /
// devolvible (= recibido − devuelto, nunca negativo) + coste de origen (para el valor).
export function returnableLines(db, origin_type, origin_id) {
  const cfg = ORIGIN[origin_type];
  if (!cfg) return [];
  return db.prepare(cfg.itemsSql).all(origin_id)
    .filter(l => (l.product_type || 'physical') === 'physical')   // servicio/digital no tienen stock
    .map(l => {
      const devuelto = alreadyReturned(db, origin_type, origin_id, l.origin_item_id);
      return { ...l, devuelto, devolvible: Math.max(0, l.recibido - devuelto) };
    });
}

// Orígenes elegibles para una devolución nueva: compras recibidas + recepciones
// confirmadas que aún tengan algo devolvible (físico, > 0).
export function eligibleOrigins(db) {
  const out = [];
  const purchases = db.prepare(
    "SELECT p.id, p.date, p.reference, p.supplier_id, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.status='received' AND p.archived=0 ORDER BY p.date DESC, p.id DESC"
  ).all();
  for (const p of purchases) {
    const lines = returnableLines(db, 'purchase', p.id);
    if (lines.some(l => l.devolvible > 0)) {
      out.push({ origin_type: 'purchase', origin_id: p.id, supplier_id: p.supplier_id, supplier_name: p.supplier_name,
                 date: p.date, label: 'Compra #' + p.id + (p.reference ? ' · ' + p.reference : '') });
    }
  }
  const receipts = db.prepare(
    "SELECT por.id, por.date, por.receipt_number, po.supplier_id, s.name AS supplier_name FROM purchase_order_receipts por JOIN purchase_orders po ON po.id=por.order_id JOIN suppliers s ON s.id=po.supplier_id WHERE por.status='confirmada' ORDER BY por.date DESC, por.id DESC"
  ).all();
  for (const r of receipts) {
    const lines = returnableLines(db, 'po_receipt', r.id);
    if (lines.some(l => l.devolvible > 0)) {
      out.push({ origin_type: 'po_receipt', origin_id: r.id, supplier_id: r.supplier_id, supplier_name: r.supplier_name,
                 date: r.date, label: 'Recepción ' + (r.receipt_number || ('#' + r.id)) });
    }
  }
  return out;
}

export function getReturn(db, id) {
  const r = db.prepare('SELECT sr.*, s.name AS supplier_current_name FROM supplier_returns sr JOIN suppliers s ON s.id=sr.supplier_id WHERE sr.id=?').get(id);
  if (!r) return null;
  const items = db.prepare(
    'SELECT sri.*, pr.name AS product_name, pr.sku FROM supplier_return_items sri JOIN products pr ON pr.id=sri.product_id WHERE sri.return_id=? ORDER BY sri.id'
  ).all(id);
  const cfg = ORIGIN[r.origin_type];
  const origin = cfg ? cfg.load(db, r.origin_id) : null;
  return { ...r, items, origin };
}

// ── SERVICIO: crear y confirmar una devolución (un solo paso; confirm-first de UI) ──
export function createSupplierReturnSvc(db, d) {
  const cfg = ORIGIN[d.origin_type];
  if (!cfg) { const e = new Error('Tipo de origen no válido'); e.status = 400; throw e; }
  const origin = cfg.load(db, d.origin_id);
  if (!origin) { const e = new Error('Documento de origen no encontrado'); e.status = 404; throw e; }
  if (origin.status !== cfg.okStatus) { const e = new Error(cfg.badStatusMsg); e.status = 400; throw e; }

  const lines = returnableLines(db, d.origin_type, d.origin_id);
  const byId = new Map(lines.map(l => [l.origin_item_id, l]));
  const seen = new Set();
  const resolved = [];
  for (const it of d.items) {
    const line = byId.get(it.origin_item_id);
    if (!line) { const e = new Error('La línea ' + it.origin_item_id + ' no pertenece a este origen o no es devolvible (¿producto no físico?)'); e.status = 400; throw e; }
    if (seen.has(it.origin_item_id)) { const e = new Error('Línea repetida en la devolución ("' + line.product_name + '")'); e.status = 400; throw e; }
    seen.add(it.origin_item_id);
    if (!isPhysical(db, line.product_id)) { const e = new Error('"' + line.product_name + '" no es un producto físico: no lleva stock'); e.status = 400; throw e; }
    if (it.quantity > line.devolvible) {
      const e = new Error('"' + line.product_name + '": devolvible ' + line.devolvible + ', intentas devolver ' + it.quantity);
      e.status = 400; throw e;
    }
    resolved.push({ origin_item_id: it.origin_item_id, product_id: line.product_id, quantity: it.quantity, unit_cost: line.unit_cost });
  }

  // Capa 2: la DEV sale del MISMO almacén al que entró el documento de origen (sin selector).
  // Origen histórico (sin almacén) → principal vía resolveWarehouseId.
  const wid = resolveWarehouseId(db, origin.warehouse_id);
  const run = db.transaction(() => {
    const s = db.prepare('SELECT name, fiscal_id FROM suppliers WHERE id=?').get(origin.supplier_id) || {};
    const return_number = nextCode(db, 'supplier_return');
    const r = db.prepare(`INSERT INTO supplier_returns
        (origin_type, origin_id, supplier_id, supplier_name, supplier_fiscal_id, return_number, date, motivo, notes)
        VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(d.origin_type, d.origin_id, origin.supplier_id, s.name || '', s.fiscal_id || '', return_number, d.date, d.motivo, d.notes || '');
    const rid = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO supplier_return_items (return_id, origin_item_id, product_id, quantity, unit_cost) VALUES (?,?,?,?,?)');
    for (const it of resolved) {
      ins.run(rid, it.origin_item_id, it.product_id, it.quantity, it.unit_cost);
      // Salida al libro con coste NULL a propósito: una salida deja el WAC intacto.
      // Capa 2: sale del almacén del origen (wid).
      recordMovement(db, {
        product_id: it.product_id, type: 'salida', quantity: -it.quantity,
        origin_type: 'supplier_return', origin_id: rid, warehouse_id: wid,
        note: 'Devolución ' + return_number + ' (' + origin.label + ')',
      });
    }
    return { id: rid, return_number, supplier_id: origin.supplier_id, lines: resolved.length };
  });
  return run();
}

// ── SERVICIO: anular una devolución confirmada (motivo obligatorio) ──────────
// Re-entra el stock con el COSTE DE ORIGEN guardado (NO NULL): recompone el WAC
// sin hundirlo a 0. Marca anulada + motivo. Nada se borra.
export function cancelSupplierReturnSvc(db, returnId, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const sr = db.prepare('SELECT * FROM supplier_returns WHERE id=?').get(returnId);
  if (!sr) { const e = new Error('Devolución no encontrada'); e.status = 404; throw e; }
  if (sr.status !== 'confirmada') { const e = new Error('Esta devolución ya está anulada'); e.status = 400; throw e; }
  const items = db.prepare('SELECT * FROM supplier_return_items WHERE return_id=?').all(returnId);

  const run = db.transaction(() => {
    for (const it of items) {
      // C1: la re-entrada vuelve al MISMO almacén del que salió la DEV (deriva de su salida).
      recordMovement(db, {
        product_id: it.product_id, type: 'entrada', quantity: it.quantity, unit_cost: it.unit_cost,
        origin_type: 'supplier_return', origin_id: returnId,
        warehouse_id: originMovementWarehouse(db, 'supplier_return', returnId, it.product_id),
        note: 'Anulación de la devolución ' + (sr.return_number || ('#' + returnId)),
      });
    }
    db.prepare("UPDATE supplier_returns SET status='anulada', anulada_motivo=? WHERE id=?").run(m, returnId);
    return { id: returnId, return_number: sr.return_number, reverted_lines: items.length };
  });
  return run();
}

// ── Rutas ────────────────────────────────────────────────────────────────────

export function createSupplierReturnRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // ── API ──
  // Líneas devolvibles de un origen (para el formulario). ANTES de '/:id'.
  api.get('/returnable', requirePerm('purchases.read'), c => {
    try {
      const origin_type = c.req.query('origin_type');
      const origin_id = parseInt(c.req.query('origin_id'));
      const cfg = ORIGIN[origin_type];
      if (!cfg || !Number.isFinite(origin_id)) return c.json({ error: 'Origen no válido' }, 400);
      const origin = cfg.load(db, origin_id);
      if (!origin) return c.json({ error: 'Origen no encontrado' }, 404);
      if (origin.status !== cfg.okStatus) return c.json({ error: cfg.badStatusMsg }, 400);
      const s = db.prepare('SELECT id, name, fiscal_id FROM suppliers WHERE id=?').get(origin.supplier_id) || {};
      return c.json({ supplier: s, origin: { type: origin_type, id: origin_id, label: origin.label, href: origin.href }, lines: returnableLines(db, origin_type, origin_id) });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.get('/:id', requirePerm('purchases.read'), c => {
    try {
      const r = getReturn(db, parseInt(c.req.param('id')));
      if (!r) return c.json({ error: 'No encontrada' }, 404);
      return c.json(r);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/', requirePerm('purchases.create'), validate(supplierReturnSchema), c => {
    try {
      const r = createSupplierReturnSvc(db, c.get('validated'));
      logActivity(db, c.get('session'), 'Registró devolución a proveedor', 'supplier_return', r.id, r.return_number + ' (' + r.lines + ' líneas)');
      return c.json({ ...r, message: 'Devolución ' + r.return_number + ' confirmada' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  api.post('/:id/cancel', requirePerm('purchases.edit'), validate(purchaseOrderAnularSchema), c => {
    try {
      const { motivo } = c.get('validated');
      const r = cancelSupplierReturnSvc(db, parseInt(c.req.param('id')), motivo);
      logActivity(db, c.get('session'), 'Anuló devolución a proveedor', 'supplier_return', r.id, (r.return_number || '') + ' — ' + motivo);
      return c.json({ ...r, message: 'Devolución anulada y stock reintegrado' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // ── VISTAS ──

  // Lista server-rendered (patrón P4): búsqueda por nº/proveedor + filtro estado + paginación 25.
  views.get('/', requirePerm('purchases.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const q = (c.req.query('q') || '').trim();
    const estado = (c.req.query('estado') || '').trim();
    const perPage = 25;
    let page = parseInt(c.req.query('page') || '1', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    const where = [];
    const params = [];
    if (q) { where.push('(sr.return_number LIKE ? OR sr.supplier_name LIKE ? OR s.name LIKE ?)'); params.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
    if (estado === 'confirmada' || estado === 'anulada') { where.push('sr.status=?'); params.push(estado); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare('SELECT COUNT(*) AS n FROM supplier_returns sr JOIN suppliers s ON s.id=sr.supplier_id ' + whereSql).get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * perPage;
    const rows = db.prepare(
      `SELECT sr.*, s.name AS supplier_current_name,
              (SELECT COALESCE(SUM(quantity*unit_cost),0) FROM supplier_return_items WHERE return_id=sr.id) AS valor
         FROM supplier_returns sr JOIN suppliers s ON s.id=sr.supplier_id ` + whereSql +
      ' ORDER BY sr.date DESC, sr.id DESC LIMIT ? OFFSET ?'
    ).all(...params, perPage, offset);

    const buildQs = (p) => {
      const u = new URLSearchParams();
      if (q) u.set('q', q);
      if (estado) u.set('estado', estado);
      u.set('page', String(p));
      return u.toString();
    };

    const badge = s => s === 'confirmada' ? '<span class="badge b-green">Confirmada</span>' : '<span class="badge b-red">Anulada</span>';
    const rowsHtml = rows.map(r =>
      '<tr>'
      + '<td><strong style="font-family:monospace">' + esc(r.return_number || ('#' + r.id)) + '</strong></td>'
      + '<td><strong>' + esc(r.supplier_name || r.supplier_current_name) + '</strong></td>'
      + '<td>' + esc(r.date) + '</td>'
      + '<td>' + badge(r.status) + '</td>'
      + '<td><strong>' + Number(r.valor).toFixed(2) + ' ' + sym + '</strong></td>'
      + '<td style="text-align:right"><a href="/admin/supplier-returns/' + r.id + '" class="btn btn-secondary btn-sm">Ver</a></td>'
      + '</tr>'
    ).join('');

    const estadoOptions = ['', 'confirmada', 'anulada'].map(v =>
      '<option value="' + v + '"' + (v === estado ? ' selected' : '') + '>' + (v === '' ? 'Todas' : v === 'confirmada' ? 'Confirmadas' : 'Anuladas') + '</option>'
    ).join('');

    const content = `
      <div class="ph">
        <h2>Devoluciones a proveedor</h2>
        <form method="get" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <input class="search" type="text" name="q" value="${esc(q)}" placeholder="Buscar por número o proveedor...">
          <select class="form-control" name="estado" style="width:auto;min-width:140px" onchange="this.form.submit()">${estadoOptions}</select>
          <button class="btn btn-secondary" type="submit">Buscar</button>
          ${can(c, 'purchases.create') ? '<a href="/admin/supplier-returns/new" class="btn btn-primary">Nueva devolución</a>' : ''}
        </form>
      </div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Número</th><th>Proveedor</th><th>Fecha</th><th>Estado</th><th>Valor devuelto</th><th></th></tr></thead>
          <tbody>${total === 0 ? '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3)">' + (q || estado ? 'No se encontraron devoluciones' : 'Sin devoluciones a proveedor. Una devolución sale siempre de una compra recibida o una recepción confirmada.') + '</td></tr>' : rowsHtml}</tbody>
        </table></div>
      </div>
      ${total > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--text3);font-size:.85rem">Página ${page} de ${totalPages} · ${total} devolución${total === 1 ? '' : 'es'}</span>
        <div style="display:flex;gap:.5rem">
          ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page - 1)}">← Anterior</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">← Anterior</span>'}
          ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="?${buildQs(page + 1)}">Siguiente →</a>` : '<span class="btn btn-secondary btn-sm" style="opacity:.4;pointer-events:none">Siguiente →</span>'}
        </div>
      </div>` : ''}`;
    return c.html(adminLayout('Devoluciones a proveedor', content, 'supplier-returns', c.get('session')?.csrfToken || '', c));
  });

  // Crear: eliges un documento de origen → ves sus líneas con lo devolvible → cantidades
  // + motivo → resumen confirm-first → confirmar.
  views.get('/new', requirePerm('purchases.create'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const today = new Date().toISOString().split('T')[0];
    const csrfToken = c.get('session')?.csrfToken || '';
    const origins = eligibleOrigins(db);

    if (!origins.length) {
      const content = `
        <div class="ph"><h2>Nueva devolución a proveedor</h2><a href="/admin/supplier-returns" class="btn btn-secondary">Volver</a></div>
        <div class="card card-body" style="text-align:center;padding:2rem;color:var(--text3)">
          No hay documentos con stock devolvible. Una devolución sale de una <strong>compra recibida</strong> o una <strong>recepción confirmada</strong> con unidades aún no devueltas.
        </div>`;
      return c.html(adminLayout('Nueva devolución a proveedor', content, 'supplier-returns', csrfToken, c));
    }

    const opts = origins.map((o, i) =>
      '<option value="' + i + '">' + esc(o.supplier_name + ' · ' + o.label + ' · ' + o.date) + '</option>'
    ).join('');

    const content = `
      <div class="ph"><h2>Nueva devolución a proveedor</h2><a href="/admin/supplier-returns" class="btn btn-secondary">Volver</a></div>
      <div class="alert alert-warn">La devolución es <strong>inmutable</strong> y saca el stock del almacén. Corregirla = anularla (con motivo) y crear otra. Solo puedes devolver hasta lo recibido y aún no devuelto de cada línea.</div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Documento de origen</h3></div>
        <div class="card-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Origen (compra recibida o recepción confirmada) *</label><select class="form-control" id="fOrigin" onchange="loadLines()"><option value="">— Elige un documento —</option>${opts}</select></div>
            <div class="form-group"><label class="form-label">Fecha *</label><input class="form-control" type="date" id="fDate" value="${today}"></div>
          </div>
          <div class="form-group"><label class="form-label">Motivo de la devolución * <span style="color:var(--text3);font-weight:400">(mín. 3 caracteres)</span></label><input class="form-control" id="fMotivo" placeholder="Mercancía defectuosa, pedido equivocado..."></div>
          <div class="form-group"><label class="form-label">Notas</label><input class="form-control" id="fNotes" placeholder="Nº de RMA del proveedor, transportista..."></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><h3>Líneas a devolver</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th style="text-align:right">Recibido</th><th style="text-align:right">Ya devuelto</th><th style="text-align:right">Devolvible</th><th>Devolver ahora</th><th style="text-align:right">Valor</th></tr></thead>
          <tbody id="rLines"><tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text3)">Elige un documento de origen para ver sus líneas.</td></tr></tbody>
          <tfoot><tr><td colspan="5" style="text-align:right;font-weight:700;padding:.7rem 1rem">Valor devuelto</td><td style="text-align:right;font-weight:700" id="rTotal">0.00 ${sym}</td></tr></tfoot>
        </table></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem">
        <a href="/admin/supplier-returns" class="btn btn-secondary">Cancelar</a>
        <button class="btn btn-primary" id="btn-confirm" onclick="confirmReturn()">Confirmar devolución</button>
      </div>
      <script>
      const SYM = '${sym}';
      const ORIGINS = ${JSON.stringify(origins)};
      let CURRENT = null;   // { supplier, origin, lines }

      async function loadLines(){
        const idx = document.getElementById('fOrigin').value;
        const tbody = document.getElementById('rLines');
        CURRENT = null; document.getElementById('rTotal').textContent = '0.00 ' + SYM;
        if (idx === ''){ tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text3)">Elige un documento de origen para ver sus líneas.</td></tr>'; return; }
        const o = ORIGINS[parseInt(idx)];
        try {
          const d = await api('GET','/api/erp/supplier-returns/returnable?origin_type=' + o.origin_type + '&origin_id=' + o.origin_id);
          CURRENT = d;
          const rows = d.lines.filter(l => l.devolvible > 0).map(l =>
            '<tr data-oid="' + l.origin_item_id + '" data-dev="' + l.devolvible + '" data-cost="' + l.unit_cost + '">'
            + '<td>' + (l.sku ? '<span style="color:var(--text3);font-size:.8rem">[' + escHtml(l.sku) + ']</span> ' : '') + escHtml(l.product_name) + '</td>'
            + '<td style="text-align:right">' + l.recibido + '</td>'
            + '<td style="text-align:right">' + l.devuelto + '</td>'
            + '<td style="text-align:right;font-weight:600">' + l.devolvible + '</td>'
            + '<td><input class="form-control r-qty" type="number" min="0" max="' + l.devolvible + '" value="0" style="width:90px" oninput="recalc()"></td>'
            + '<td style="text-align:right"><span class="r-sub">0.00 ' + SYM + '</span></td>'
            + '</tr>'
          ).join('');
          tbody.innerHTML = rows || '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text3)">Este documento no tiene nada devolvible.</td></tr>';
          recalc();
        } catch(e){ toast(e.message || 'Error cargando las líneas','err'); }
      }

      function recalc(){
        let total = 0;
        document.querySelectorAll('#rLines tr[data-oid]').forEach(function(r){
          let qty = parseInt(r.querySelector('.r-qty').value) || 0;
          const dev = parseInt(r.dataset.dev);
          if (qty < 0) qty = 0;
          if (qty > dev){ qty = dev; r.querySelector('.r-qty').value = dev; }
          const sub = qty * parseFloat(r.dataset.cost);
          r.querySelector('.r-sub').textContent = sub.toFixed(2) + ' ' + SYM;
          total += sub;
        });
        document.getElementById('rTotal').textContent = total.toFixed(2) + ' ' + SYM;
      }

      function collect(){
        const items = [];
        document.querySelectorAll('#rLines tr[data-oid]').forEach(function(r){
          const qty = parseInt(r.querySelector('.r-qty').value) || 0;
          if (qty > 0) items.push({ origin_item_id: parseInt(r.dataset.oid), quantity: qty });
        });
        return items;
      }

      async function confirmReturn(){
        if (!CURRENT){ toast('Elige un documento de origen','err'); return; }
        const motivo = document.getElementById('fMotivo').value.trim();
        const date = document.getElementById('fDate').value;
        if (motivo.length < 3){ toast('El motivo es obligatorio (mínimo 3 caracteres)','err'); return; }
        if (!date){ toast('La fecha es obligatoria','err'); return; }
        const items = collect();
        if (!items.length){ toast('Indica al menos una línea con cantidad a devolver','err'); return; }
        const units = items.reduce(function(s,i){ return s + i.quantity; }, 0);
        if (!confirm('Vas a CONFIRMAR la devolución de ' + items.length + ' línea(s) (' + units + ' unidades) a ' + CURRENT.supplier.name + '. Sacará ese stock del almacén y será inmutable (corregir = anular y crear otra).\\n\\n¿Confirmar?')) return;
        const btn = document.getElementById('btn-confirm');
        btn.disabled = true;
        try {
          const d = await api('POST','/api/erp/supplier-returns', {
            origin_type: CURRENT.origin.type, origin_id: CURRENT.origin.id,
            date: date, motivo: motivo, notes: document.getElementById('fNotes').value.trim(), items: items,
          });
          toast(d.message || 'Devolución confirmada');
          window.location.href = '/admin/supplier-returns/' + d.id;
        } catch(e){ toast(e.message || 'Error registrando la devolución','err'); btn.disabled = false; }
      }
      </script>`;
    return c.html(adminLayout('Nueva devolución a proveedor', content, 'supplier-returns', csrfToken, c));
  });

  // Ficha del documento (inmutable): DEV-NNNN, proveedor, enlace al origen, líneas con
  // valor, total, estado + botón Anular (con motivo) si está confirmada.
  views.get('/:id', requirePerm('purchases.read'), c => {
    const r = getReturn(db, parseInt(c.req.param('id')));
    if (!r) return c.redirect('/admin/supplier-returns');
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const csrfToken = c.get('session')?.csrfToken || '';
    const canEdit = can(c, 'purchases.edit');

    const total = r.items.reduce((s, i) => s + Math.round(i.quantity * i.unit_cost * 100) / 100, 0);
    const rows = r.items.map(i =>
      `<tr><td>${i.sku ? `<span style="color:var(--text3);font-size:.8rem">[${esc(i.sku)}]</span> ` : ''}${esc(i.product_name)}</td>` +
      `<td style="text-align:right">${i.quantity}</td><td style="text-align:right">${Number(i.unit_cost).toFixed(2)} ${sym}</td>` +
      `<td style="text-align:right"><strong>${(Math.round(i.quantity * i.unit_cost * 100) / 100).toFixed(2)} ${sym}</strong></td></tr>`
    ).join('');

    const badge = r.status === 'confirmada' ? '<span class="badge b-green">Confirmada</span>' : '<span class="badge b-red">Anulada</span>';
    const motivoBlock = r.status === 'anulada'
      ? `<div class="alert alert-err">Devolución anulada. Motivo: ${esc(r.anulada_motivo || '')}. El stock que sacó se reintegró con movimientos de entrada (coste de origen).</div>` : '';
    const notesBlock = r.notes ? `<div style="margin-top:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Notas</span><br>${esc(r.notes)}</div>` : '';
    const originLink = r.origin
      ? `<a href="${r.origin.href}" style="color:var(--teal);font-weight:600">${esc(r.origin.label)}</a>`
      : `<span style="color:var(--text3)">${esc(r.origin_type)} #${r.origin_id}</span>`;

    const content = `
      <div class="ph"><h2>Devolución ${esc(r.return_number || ('#' + r.id))}</h2>
        <div style="display:flex;gap:.5rem">
          ${r.status === 'confirmada' && canEdit ? '<button class="btn btn-danger" onclick="anularDevolucion()">Anular</button>' : ''}
          <a href="/admin/supplier-returns" class="btn btn-secondary">Volver</a>
        </div>
      </div>
      ${motivoBlock}
      <div class="grid g2" style="margin-bottom:1rem">
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Proveedor</span><br><strong>${esc(r.supplier_name || r.supplier_current_name)}</strong>${r.supplier_fiscal_id ? ` <span style="color:var(--text3)">(${esc(r.supplier_fiscal_id)})</span>` : ''}</div>
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Documento de origen</span><br>${originLink}</div>
          <div><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Motivo</span><br>${esc(r.motivo)}</div>
        </div>
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Fecha</span><br>${esc(r.date)}</div>
          <div style="margin-bottom:.5rem"><span style="color:var(--text3);font-size:.8rem;text-transform:uppercase">Estado</span><br>${badge}</div>
          ${notesBlock}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Líneas devueltas (inmutables — corregir = anular y crear otra)</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Coste unit. (neto)</th><th style="text-align:right">Valor</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;padding:.7rem 1rem">Valor devuelto</td><td style="text-align:right;font-weight:700">${total.toFixed(2)} ${sym}</td></tr></tfoot>
        </table></div>
        <div class="card-body" style="color:var(--text3);font-size:.78rem">El valor es informativo (lo que el proveedor debería abonar). El cobro/abono al proveedor no se gestiona aquí.</div>
      </div>
      <script>
      async function anularDevolucion(){
        const motivo = prompt('Motivo de anulación de la devolución ${esc(r.return_number || '')} (reintegrará su stock):');
        if (motivo === null) return;
        if (motivo.trim().length < 3){ toast('El motivo es obligatorio (mínimo 3 caracteres)','err'); return; }
        try {
          const d = await api('POST','/api/erp/supplier-returns/${r.id}/cancel',{ motivo: motivo.trim() });
          toast(d.message || 'Devolución anulada'); location.reload();
        } catch(e){ toast(e.message || 'Error anulando','err'); }
      }
      </script>`;
    return c.html(adminLayout('Devolución ' + (r.return_number || ''), content, 'supplier-returns', csrfToken, c));
  });

  return { api, views };
}
