import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { supplierInvoiceSchema, supplierInvoiceAnularSchema, supplierPaymentSchema } from '../schemas.js';
import { nextCode } from '../codes.js';
import { supplierInvoicePago, isPayable, supplierDebt, ESTADO_LABEL, ESTADO_BADGE } from '../pagos.js';
import { pagoModalHtml, pagoModalScript } from '../views/pago-modal.js';

// ════════════════════════════════════════════════════════════════════════════
// FACTURA RECIBIDA (Capa de dinero con proveedores · Paso a) — documento INMUTABLE
// que genera la DEUDA con el proveedor. Espejo de la factura/cobros, al revés.
//
// Nace de DOS formas, SIEMPRE enlazada a un documento de stock de origen:
//  - AUTO desde la captura C2 (confirmCaptureSvc): con los importes reales que la
//    captura calcula (base/IVA/total CON IVA) y hoy se descartaban.
//  - MANUAL (/admin/supplier-invoices/new): la mercancía llegó antes que la factura.
// Inmutable: corregir = ANULAR (motivo) + crear otra; nunca se edita ni se borra.
// NO toca stock/WAC (solo lee) ni la cadena de hash/Verifactu (no es emisión nuestra).
// ════════════════════════════════════════════════════════════════════════════

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const round2 = n => Math.round(Number(n || 0) * 100) / 100;
function addDays(iso, n) {
  const d = new Date(Date.parse(iso + 'T00:00:00Z') + Number(n || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

// Resolución del documento de stock de origen: dónde vive, su estado válido y su etiqueta.
// Mismo patrón que el ORIGIN de las devoluciones a proveedor.
const ORIGIN = {
  purchase: {
    load(db, id) {
      const o = db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
      if (!o) return null;
      return { supplier_id: o.supplier_id, status: o.status, ok: o.status === 'received' && !o.archived,
               label: 'Compra #' + o.id + (o.reference ? ' · ' + o.reference : ''), date: o.date, href: '/admin/purchases/' + o.id };
    },
    eligibleSql: "SELECT p.id, p.date, p.reference FROM purchases p WHERE p.supplier_id=? AND p.status='received' AND p.archived=0 ORDER BY p.date DESC, p.id DESC",
    label: r => 'Compra #' + r.id + (r.reference ? ' · ' + r.reference : ''),
  },
  po_receipt: {
    load(db, id) {
      const r = db.prepare('SELECT por.*, po.supplier_id FROM purchase_order_receipts por JOIN purchase_orders po ON po.id=por.order_id WHERE por.id=?').get(id);
      if (!r) return null;
      return { supplier_id: r.supplier_id, status: r.status, ok: r.status === 'confirmada',
               label: 'Recepción ' + (r.receipt_number || ('#' + r.id)), date: r.date, href: '/admin/purchase-order-receipts/' + r.id };
    },
    eligibleSql: "SELECT por.id, por.date, por.receipt_number FROM purchase_order_receipts por JOIN purchase_orders po ON po.id=por.order_id WHERE po.supplier_id=? AND por.status='confirmada' ORDER BY por.date DESC, por.id DESC",
    label: r => 'Recepción ' + (r.receipt_number || ('#' + r.id)),
  },
};

// Guarda de duplicado (CANON §5 — sin duplicados): una factura VIGENTE del mismo
// proveedor con el mismo número del proveedor. El número puede repetir ENTRE proveedores
// (cada uno tiene su propia numeración), por eso la guarda es por proveedor. Vacío no bloquea.
export function supplierInvoiceDuplicate(db, supplierId, number, excludeId = null) {
  const norm = String(number || '').trim();
  if (!norm) return null;
  const ex = Number(excludeId);
  return db.prepare(
    "SELECT id, internal_code FROM supplier_invoices WHERE supplier_id=? AND status='vigente' AND TRIM(supplier_invoice_number)=? AND id<>?"
  ).get(supplierId, norm, Number.isFinite(ex) ? ex : -1) || null;
}

// ── SERVICIO: crear una factura recibida ────────────────────────────────────
// Lo usan la ruta MANUAL y la captura C2 (auto). El proveedor se DERIVA del documento de
// origen (no se teclea suelto). due_date = invoice_date + plazo del proveedor. Snapshot del
// proveedor congelado al crear. opts.onDuplicate: 'throw' (manual) | 'skip' (auto, para no
// tumbar el aterrizaje de stock si la factura ya existía). NO abre transacción propia (es
// seguro tanto suelto como anidado dentro de la transacción de la captura).
export function createSupplierInvoiceSvc(db, d, opts = {}) {
  const cfg = ORIGIN[d.entity_type];
  if (!cfg) { const e = new Error('Tipo de origen no válido'); e.status = 400; throw e; }
  const origin = cfg.load(db, d.entity_id);
  if (!origin) { const e = new Error('Documento de origen no encontrado'); e.status = 404; throw e; }
  if (!origin.ok) { const e = new Error('El documento de origen no es válido (necesita una compra RECIBIDA o una recepción CONFIRMADA)'); e.status = 400; throw e; }

  const supplierId = origin.supplier_id;
  const number = String(d.supplier_invoice_number || '').trim();
  if (number) {
    const dup = supplierInvoiceDuplicate(db, supplierId, number);
    if (dup) {
      if (opts.onDuplicate === 'skip') return { skipped: true, reason: 'duplicate', existing_id: dup.id, internal_code: dup.internal_code };
      const e = new Error('Ya existe una factura vigente de este proveedor con el número "' + number + '" (' + (dup.internal_code || ('#' + dup.id)) + ')'); e.status = 409; throw e;
    }
  }

  const base  = round2(d.base != null ? d.base : 0);
  const total = round2(d.total != null ? d.total : (Number(d.base || 0) + Number(d.tax || 0)));
  const tax   = round2(d.tax != null ? d.tax : Math.max(0, total - base));
  if (!(total > 0)) { const e = new Error('El total de la factura debe ser mayor que 0'); e.status = 400; throw e; }

  const s = db.prepare('SELECT name, fiscal_id, address, payment_term_days FROM suppliers WHERE id=?').get(supplierId) || {};
  const dueDate = addDays(d.invoice_date, s.payment_term_days || 0);
  const code = nextCode(db, 'supplier_invoice');
  const r = db.prepare(`INSERT INTO supplier_invoices
      (supplier_id, internal_code, supplier_invoice_number, invoice_date, due_date, base, tax, total, status,
       supplier_name, supplier_fiscal_id, supplier_address, entity_type, entity_id, notes)
      VALUES (?,?,?,?,?,?,?,?, 'vigente', ?,?,?,?,?,?)`)
    .run(supplierId, code, number, d.invoice_date, dueDate, base, tax, total,
         s.name || '', s.fiscal_id || '', s.address || '', d.entity_type, d.entity_id, d.notes || '');
  return { id: r.lastInsertRowid, internal_code: code, supplier_id: supplierId, total, due_date: dueDate };
}

// ── SERVICIO: anular una factura recibida (motivo obligatorio) ──────────────
// Inmutable: marca anulada + motivo; la fila queda intacta. Sale de la deuda (countsAsPayable).
// Corregir = anular y crear otra. Los pagos ya registrados se conservan.
export function anularSupplierInvoiceSvc(db, id, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) { const e = new Error('Indica el motivo de la anulación'); e.status = 400; throw e; }
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  if (!inv) { const e = new Error('Factura recibida no encontrada'); e.status = 404; throw e; }
  if (inv.status === 'anulada') { const e = new Error('Esta factura ya está anulada'); e.status = 400; throw e; }
  db.prepare("UPDATE supplier_invoices SET status='anulada', anulada_motivo=? WHERE id=?").run(m, id);
  return { id, status: 'anulada' };
}

// ── SERVICIO: registrar un pago a proveedor (total o parcial) ───────────────
// ÚNICA vía de escritura de pagos (la usa el endpoint; espejo de registrar cobro).
// Doble seguro: solo facturas vivas (isPayable) y sin SOBREPAGO (no superar lo pendiente
// al céntimo). El estado de pago se calcula en vivo, no se guarda. Errores con .status.
export function registerSupplierPaymentSvc(db, id, input, opts = {}) {
  const t = opts.today || new Date().toISOString().slice(0, 10);
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  if (!inv) { const e = new Error('Factura recibida no encontrada'); e.status = 404; throw e; }
  if (!isPayable(inv)) { const e = new Error('Esta factura no admite pago (anulada o total inválido)'); e.status = 400; throw e; }
  const amount = round2(input.amount);
  if (!(amount > 0)) { const e = new Error('El importe debe ser mayor que 0'); e.status = 400; throw e; }
  const st = supplierInvoicePago(db, inv, t);
  if (Math.round(amount * 100) > Math.round(st.pendiente * 100)) {
    const e = new Error('El pago (' + amount.toFixed(2) + ') supera lo pendiente (' + st.pendiente.toFixed(2) + ')'); e.status = 400; throw e;
  }
  const res = db.prepare('INSERT INTO supplier_payments (supplier_invoice_id, amount, paid_date, payment_method, note) VALUES (?,?,?,?,?)')
    .run(id, amount, input.paid_date || t, input.payment_method || '', input.note || '');
  return { id: res.lastInsertRowid, pago: supplierInvoicePago(db, inv, t) };
}

// ── SERVICIO: deshacer (borrar) un pago mal metido ─────────────────────────
// Un pago a proveedor es un apunte de CAJA interno (no documento legal, no toca hash):
// corregir un pago equivocado = borrar ESE apunte, sin anular la factura entera. La
// factura recibida sigue intacta; su estado de pago se recalcula en vivo. Errores .status.
export function deleteSupplierPaymentSvc(db, invoiceId, paymentId, opts = {}) {
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(invoiceId);
  if (!inv) { const e = new Error('Factura recibida no encontrada'); e.status = 404; throw e; }
  const pay = db.prepare('SELECT * FROM supplier_payments WHERE id=? AND supplier_invoice_id=?').get(paymentId, invoiceId);
  if (!pay) { const e = new Error('Pago no encontrado en esta factura'); e.status = 404; throw e; }
  db.prepare('DELETE FROM supplier_payments WHERE id=?').run(paymentId);
  return { deleted: paymentId, amount: pay.amount, pago: supplierInvoicePago(db, inv, opts.today || new Date().toISOString().slice(0, 10)) };
}

// Lectura enriquecida de una factura recibida (para la ficha y el modal de pago).
export function getSupplierInvoice(db, id, today) {
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
  if (!inv) return null;
  const t = today || new Date().toISOString().slice(0, 10);
  const payments = db.prepare('SELECT * FROM supplier_payments WHERE supplier_invoice_id=? ORDER BY paid_date, id').all(id);
  const pago = supplierInvoicePago(db, inv, t);
  const cfg = ORIGIN[inv.entity_type];
  const origin = cfg ? cfg.load(db, inv.entity_id) : null;
  const sup = db.prepare('SELECT payment_method FROM suppliers WHERE id=?').get(inv.supplier_id) || {};
  return { ...inv, payments, pago, pagable: isPayable(inv), origin, payment_method_default: sup.payment_method || '' };
}

// Orígenes elegibles para una factura MANUAL de un proveedor: compras recibidas +
// recepciones confirmadas, marcando las que ya tienen una factura vigente enlazada.
export function eligibleOriginsForSupplier(db, supplierId) {
  const out = [];
  for (const type of ['po_receipt', 'purchase']) {
    const cfg = ORIGIN[type];
    for (const r of db.prepare(cfg.eligibleSql).all(supplierId)) {
      const already = db.prepare("SELECT 1 FROM supplier_invoices WHERE status='vigente' AND entity_type=? AND entity_id=? LIMIT 1").get(type, r.id);
      out.push({ entity_type: type, entity_id: r.id, label: cfg.label(r), date: r.date, already_invoiced: !!already });
    }
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export function createSupplierInvoiceRoutes(db) {
  const api = new Hono();
  const views = new Hono();
  const today = () => new Date().toISOString().slice(0, 10);

  // ── API ────────────────────────────────────────────────────────────────────
  // Lista (opcional ?supplier=ID), con estado de pago en vivo.
  api.get('/', requirePerm('purchases.read'), c => {
    try {
      const supplier = parseInt(c.req.query('supplier')) || null;
      const rows = db.prepare(
        'SELECT si.*, s.name AS supplier_name FROM supplier_invoices si JOIN suppliers s ON s.id=si.supplier_id'
        + (supplier ? ' WHERE si.supplier_id=?' : '') + ' ORDER BY si.invoice_date DESC, si.id DESC'
      ).all(...(supplier ? [supplier] : []));
      const t = today();
      const out = rows.map(inv => {
        const st = supplierInvoicePago(db, inv, t);
        return { ...inv, ...st, pagable: isPayable(inv) };
      });
      return c.json(out);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // Orígenes elegibles para la creación manual (ANTES de '/:id').
  api.get('/eligible-origins', requirePerm('purchases.read'), c => {
    try {
      const sid = parseInt(c.req.query('supplier_id'));
      if (!sid) return c.json([]);
      return c.json(eligibleOriginsForSupplier(db, sid));
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // Deuda viva de un proveedor (para la cabecera "Le debes X €" — superficie de cuenta).
  api.get('/supplier-debt', requirePerm('purchases.read'), c => {
    try {
      const sid = parseInt(c.req.query('supplier_id'));
      if (!sid) return c.json({ total: 0, oldest: null });
      const d = supplierDebt(db, sid, today());
      return c.json({ total: d.total, oldest: d.oldest });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  api.get('/:id', requirePerm('purchases.read'), c => {
    try {
      const inv = getSupplierInvoice(db, parseInt(c.req.param('id')), today());
      if (!inv) return c.json({ error: 'No encontrada' }, 404);
      return c.json(inv);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // Crear MANUAL.
  api.post('/', requirePerm('purchases.create'), validate(supplierInvoiceSchema), c => {
    try {
      const r = createSupplierInvoiceSvc(db, c.get('validated'), { onDuplicate: 'throw', today: today() });
      logActivity(db, c.get('session'), 'Creó factura recibida', 'supplier_invoice', r.id, r.internal_code || '');
      return c.json({ ...r, message: 'Factura recibida registrada' }, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // Anular.
  api.post('/:id/anular', requirePerm('purchases.create'), validate(supplierInvoiceAnularSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const r = anularSupplierInvoiceSvc(db, id, c.get('validated').motivo);
      logActivity(db, c.get('session'), 'Anuló factura recibida', 'supplier_invoice', id, c.get('validated').motivo);
      return c.json({ ...r, message: 'Factura anulada' });
    } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });

  // ÚNICO punto de escritura de pagos a proveedor. Espejo de POST /invoices/:id/payments.
  api.post('/:id/payments', requirePerm('purchases.create'), validate(supplierPaymentSchema), c => {
    try {
      const id = parseInt(c.req.param('id'));
      const r = registerSupplierPaymentSvc(db, id, c.get('validated'), { today: today() });
      const inv = db.prepare('SELECT internal_code FROM supplier_invoices WHERE id=?').get(id);
      logActivity(db, c.get('session'), 'Registró pago a proveedor', 'supplier_invoice', id, `${(inv && inv.internal_code) || ('#' + id)} · ${c.get('validated').amount}`);
      return c.json(r, 201);
    } catch (e) { return c.json({ error: e.message }, e.status || 400); }
  });

  // Deshacer un pago concreto (corrige un apunte mal metido sin anular la factura).
  api.delete('/:id/payments/:pid', requirePerm('purchases.create'), c => {
    try {
      const id = parseInt(c.req.param('id')), pid = parseInt(c.req.param('pid'));
      const r = deleteSupplierPaymentSvc(db, id, pid, { today: today() });
      const inv = db.prepare('SELECT internal_code FROM supplier_invoices WHERE id=?').get(id);
      logActivity(db, c.get('session'), 'Deshizo pago a proveedor', 'supplier_invoice', id, `${(inv && inv.internal_code) || ('#' + id)} · ${r.amount}`);
      return c.json(r);
    } catch (e) { return c.json({ error: e.message }, e.status || 400); }
  });

  // ── Vistas ──────────────────────────────────────────────────────────────────
  const sym = () => db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';

  // Lista. Con ?supplier=ID muestra la cabecera "Le debes X €" (superficie de cuenta).
  views.get('/', requirePerm('purchases.read'), c => {
    const s = sym();
    const supplierId = parseInt(c.req.query('supplier')) || null;
    const supplier = supplierId ? db.prepare('SELECT name FROM suppliers WHERE id=?').get(supplierId) : null;
    const canCreate = can(c, 'purchases.create');
    const content = `
      <div class="ph">
        <h2>Facturas recibidas${supplier ? ' · ' + esc(supplier.name) : ''}</h2>
        <div style="display:flex;gap:.5rem">
          ${supplierId ? '<a href="/admin/supplier-invoices" class="btn btn-secondary">Ver todas</a>' : ''}
          ${canCreate ? '<a href="/admin/supplier-invoices/new" class="btn btn-primary">Registrar factura</a>' : ''}
        </div>
      </div>
      ${supplierId ? `<div class="card" id="debtCard" style="margin-bottom:1rem;display:none"><div class="card-body" id="debtBox"></div></div>` : ''}
      <div class="card">
        <div class="card-head"><h3>Documentos de deuda con proveedores</h3><input class="search" id="searchBox" placeholder="Buscar proveedor, código o nº factura..." oninput="filterRows()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Código</th><th>Proveedor</th><th>Nº factura</th><th>Fecha</th><th>Vence</th><th>Total</th><th>Estado</th><th>Pendiente</th><th></th></tr></thead>
          <tbody id="siBody"></tbody>
        </table></div>
      </div>
      ${pagoModalHtml()}
      <script>
      ${pagoModalScript(s)}
      const SYM = ${JSON.stringify(s)};
      const SUPPLIER_ID = ${supplierId ? supplierId : 'null'};
      const ESTADO_LABEL = ${JSON.stringify(ESTADO_LABEL)};
      const ESTADO_BADGE = ${JSON.stringify(ESTADO_BADGE)};
      let rows = [];
      async function loadList(){
        try { rows = await api('GET','/api/erp/supplier-invoices'+(SUPPLIER_ID?('?supplier='+SUPPLIER_ID):'')); } catch(e){ toast(e.message||'Error','err'); return; }
        document.getElementById('siBody').innerHTML = rows.length ? rows.map(function(r){
          const badge = r.status==='anulada' ? '<span class="badge b-gray">Anulada</span>' : '<span class="badge '+(ESTADO_BADGE[r.estado]||'')+'">'+(ESTADO_LABEL[r.estado]||r.estado)+(r.dias_vencida>0?' · '+r.dias_vencida+'d':'')+'</span>';
          const pend = r.status==='anulada' ? '—' : SYM+Number(r.pendiente||0).toFixed(2);
          const payBtn = (r.pagable && r.pendiente>0.0049) ? '<button class="btn btn-primary btn-sm" onclick="openPagos('+r.id+')">Pago</button> ' : '';
          return '<tr class="frow">'
            +'<td style="font-family:monospace;color:var(--muted)">'+escHtml(r.internal_code||'-')+'</td>'
            +'<td><strong>'+escHtml(r.supplier_name||'')+'</strong></td>'
            +'<td>'+escHtml(r.supplier_invoice_number||'-')+'</td>'
            +'<td>'+escHtml(r.invoice_date||'')+'</td>'
            +'<td>'+escHtml(r.due_date||'-')+'</td>'
            +'<td><strong>'+SYM+Number(r.total||0).toFixed(2)+'</strong></td>'
            +'<td>'+badge+'</td>'
            +'<td>'+pend+'</td>'
            +'<td style="text-align:right;white-space:nowrap">'+payBtn+'<a href="/admin/supplier-invoices/'+r.id+'" class="btn btn-secondary btn-sm">Ver</a></td>'
            +'</tr>';
        }).join('') : '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--muted)">Sin facturas recibidas</td></tr>';
        filterRows();
        if(SUPPLIER_ID) loadDebt();
      }
      async function loadDebt(){
        try {
          const d = await api('GET','/api/erp/supplier-invoices/supplier-debt?supplier_id='+SUPPLIER_ID);
          const card=document.getElementById('debtCard'); const box=document.getElementById('debtBox');
          const o=d.oldest;
          box.innerHTML = 'Le debes <strong style="font-size:1.3rem">'+SYM+Number(d.total||0).toFixed(2)+'</strong>'
            + (o ? ' · Deuda más antigua: <a href="/admin/supplier-invoices/'+o.supplier_invoice_id+'">'+escHtml(o.internal_code||'')+'</a> ('+SYM+Number(o.pendiente||0).toFixed(2)+', vence '+escHtml(o.due_date||'-')+(o.dias_vencida>0?' · '+o.dias_vencida+' días vencida':'')+')' : ' · sin deuda pendiente');
          card.style.display='';
        } catch(e){}
      }
      function filterRows(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        document.querySelectorAll('#siBody tr.frow').forEach(function(tr){ tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      }
      window.pagoOnSaved = function(){ loadList(); };
      loadList();
      </script>`;
    return c.html(adminLayout('Facturas recibidas', content, 'supplier-invoices', c.get('session')?.csrfToken || '', c));
  });

  // Creación MANUAL.
  views.get('/new', requirePerm('purchases.create'), c => {
    const s = sym();
    const t = today();
    const suppliers = db.prepare('SELECT id,name FROM suppliers WHERE active=1 ORDER BY name').all();
    const supOptions = suppliers.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
    const content = `
      <div class="ph"><h2>Registrar factura recibida</h2><a href="/admin/supplier-invoices" class="btn btn-secondary">Volver</a></div>
      <div class="card" style="max-width:720px">
        <div class="card-body">
          <p style="color:var(--text2);margin-bottom:1rem">Para cuando la mercancía llegó antes que la factura. La factura SIEMPRE se enlaza a una <strong>compra recibida</strong> o <strong>recepción confirmada</strong> de stock ya existente.</p>
          ${suppliers.length ? '' : '<div class="alert alert-warn">No hay proveedores. <a href="/admin/suppliers">Crea uno primero.</a></div>'}
          <div class="form-row">
            <div class="form-group"><label class="form-label">Proveedor *</label><select class="form-control" id="fSupplier" onchange="loadOrigins()"><option value="">— Elige —</option>${supOptions}</select></div>
            <div class="form-group"><label class="form-label">Documento de origen *</label><select class="form-control" id="fOrigin"><option value="">— Elige proveedor primero —</option></select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Nº factura del proveedor</label><input class="form-control" id="fNumber" placeholder="(el que pone la factura)"></div>
            <div class="form-group"><label class="form-label">Fecha de factura *</label><input class="form-control" type="date" id="fDate" value="${t}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Base imponible</label><input class="form-control" type="number" step="0.01" min="0" id="fBase" value="0" oninput="syncTotal()"></div>
            <div class="form-group"><label class="form-label">IVA</label><input class="form-control" type="number" step="0.01" min="0" id="fTax" value="0" oninput="syncTotal()"></div>
            <div class="form-group"><label class="form-label">Total (con IVA) *</label><input class="form-control" type="number" step="0.01" min="0.01" id="fTotal" value="0"></div>
          </div>
          <div class="form-group"><label class="form-label">Notas</label><input class="form-control" id="fNotes"></div>
          <div style="display:flex;justify-content:flex-end;gap:.5rem">
            <a href="/admin/supplier-invoices" class="btn btn-secondary">Cancelar</a>
            <button class="btn btn-primary" onclick="save()">Registrar factura</button>
          </div>
        </div>
      </div>
      <script>
      async function loadOrigins(){
        const sid=document.getElementById('fSupplier').value;
        const sel=document.getElementById('fOrigin');
        if(!sid){ sel.innerHTML='<option value="">— Elige proveedor primero —</option>'; return; }
        let list=[];
        try { list = await api('GET','/api/erp/supplier-invoices/eligible-origins?supplier_id='+sid); } catch(e){ toast(e.message||'Error','err'); }
        sel.innerHTML = list.length
          ? '<option value="">— Elige —</option>'+list.map(function(o){ return '<option value="'+o.entity_type+':'+o.entity_id+'">'+escHtml(o.label)+' ('+escHtml(o.date||'')+')'+(o.already_invoiced?' · ya facturada':'')+'</option>'; }).join('')
          : '<option value="">— Sin compras/recepciones de este proveedor —</option>';
      }
      // El total manda (es lo que se debe); base+IVA se suman como ayuda si el usuario los teclea.
      function syncTotal(){
        const b=parseFloat(document.getElementById('fBase').value)||0;
        const t=parseFloat(document.getElementById('fTax').value)||0;
        if(b||t) document.getElementById('fTotal').value=(Math.round((b+t)*100)/100).toFixed(2);
      }
      async function save(){
        const origin=document.getElementById('fOrigin').value;
        if(!origin){ toast('Elige el documento de origen','err'); return; }
        const parts=origin.split(':');
        const total=parseFloat(document.getElementById('fTotal').value)||0;
        if(!(total>0)){ toast('El total debe ser mayor que 0','err'); return; }
        const date=document.getElementById('fDate').value;
        if(!date){ toast('La fecha es obligatoria','err'); return; }
        const body={
          entity_type:parts[0], entity_id:parseInt(parts[1]),
          supplier_invoice_number:document.getElementById('fNumber').value.trim(),
          invoice_date:date,
          base:parseFloat(document.getElementById('fBase').value)||0,
          tax:parseFloat(document.getElementById('fTax').value)||0,
          total:total,
          notes:document.getElementById('fNotes').value.trim()
        };
        try { const r=await api('POST','/api/erp/supplier-invoices',body); toast(r.message||'Registrada'); window.location.href='/admin/supplier-invoices/'+r.id; }
        catch(e){ toast(e.message||'Error','err'); }
      }
      </script>`;
    return c.html(adminLayout('Registrar factura recibida', content, 'supplier-invoices', c.get('session')?.csrfToken || '', c));
  });

  // Ficha del documento.
  views.get('/:id', requirePerm('purchases.read'), c => {
    const s = sym();
    const id = parseInt(c.req.param('id'));
    const inv = getSupplierInvoice(db, id, today());
    if (!inv) return c.redirect('/admin/supplier-invoices');
    const pg = inv.pago;
    const statusBadge = inv.status === 'anulada'
      ? '<span class="badge b-gray">Anulada</span>'
      : '<span class="badge ' + (ESTADO_BADGE[pg.estado] || '') + '">' + (ESTADO_LABEL[pg.estado] || pg.estado) + '</span>';
    const canCreate = can(c, 'purchases.create');
    const anuladaBlock = inv.status === 'anulada'
      ? `<div class="alert alert-warn" style="margin-bottom:1rem">Factura <strong>anulada</strong>. Motivo: ${esc(inv.anulada_motivo || '')}</div>` : '';
    const originBlock = inv.origin
      ? `<a href="${inv.origin.href}">${esc(inv.origin.label)}</a>` : '<span style="color:var(--muted)">—</span>';
    const actionBtns = (canCreate && inv.status !== 'anulada')
      ? `<button class="btn btn-primary" onclick="openPagos(${inv.id})">Registrar pago</button> <button class="btn btn-danger" onclick="anular()">Anular factura</button> ` : '';
    const content = `
      <div class="ph"><h2>Factura recibida ${esc(inv.internal_code || ('#' + inv.id))}</h2><div style="display:flex;gap:.5rem">${actionBtns}<a href="/admin/supplier-invoices" class="btn btn-secondary">Volver</a></div></div>
      ${anuladaBlock}
      <div class="grid g2" style="margin-bottom:1rem">
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Proveedor</span><br><strong>${esc(inv.supplier_name || '')}</strong>${inv.supplier_fiscal_id ? ' <span style="color:var(--muted)">' + esc(inv.supplier_fiscal_id) + '</span>' : ''}</div>
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Nº factura proveedor</span><br>${esc(inv.supplier_invoice_number || '—')}</div>
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Documento de origen</span><br>${originBlock}</div>
          ${inv.notes ? `<div><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Notas</span><br>${esc(inv.notes)}</div>` : ''}
        </div>
        <div class="card card-body">
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Fecha / Vencimiento</span><br>${esc(inv.invoice_date)} · vence <strong>${esc(inv.due_date || '-')}</strong></div>
          <div style="margin-bottom:.5rem"><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Importe</span><br>Base ${s}${Number(inv.base).toFixed(2)} · IVA ${s}${Number(inv.tax).toFixed(2)} · <strong style="font-size:1.2rem">Total ${s}${Number(inv.total).toFixed(2)}</strong></div>
          <div><span style="color:var(--muted);font-size:.8rem;text-transform:uppercase">Estado de pago</span><br>${statusBadge} ${inv.status !== 'anulada' ? `Pagado ${s}${Number(pg.pagado).toFixed(2)} · Pendiente <strong>${s}${Number(pg.pendiente).toFixed(2)}</strong>` : ''}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Pagos registrados</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th style="text-align:right">Importe</th><th>Forma</th><th>Nota</th><th></th></tr></thead>
          <tbody>${inv.payments.length ? inv.payments.map(p => `<tr><td>${esc(p.paid_date)}</td><td style="text-align:right">${s}${Number(p.amount).toFixed(2)}</td><td>${esc(p.payment_method || '—')}</td><td>${esc(p.note || '')}</td><td style="text-align:right">${canCreate ? `<button class="btn btn-secondary btn-sm" onclick="deshacerPago(${inv.id},${p.id})">Deshacer</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin pagos registrados</td></tr>'}</tbody>
        </table></div>
      </div>
      ${pagoModalHtml()}
      <script>
      ${pagoModalScript(s)}
      window.pagoOnSaved = function(){ location.reload(); };
      var INV_HAS_PAYMENTS = ${inv.payments.length};
      async function anular(){
        var aviso = 'Motivo de la anulación (mín. 3 caracteres):';
        if(INV_HAS_PAYMENTS>0) aviso = 'OJO: esta factura tiene ' + INV_HAS_PAYMENTS + ' pago(s) registrado(s). Anular la FACTURA no es lo mismo que deshacer un pago (para eso usa "Deshacer" en cada pago).\\n\\n' + aviso;
        const motivo = prompt(aviso);
        if(motivo==null) return;
        try { await api('POST','/api/erp/supplier-invoices/${inv.id}/anular',{ motivo:motivo }); toast('Factura anulada'); location.reload(); }
        catch(e){ toast(e.message||'Error','err'); }
      }
      </script>`;
    return c.html(adminLayout('Factura recibida ' + (inv.internal_code || ('#' + inv.id)), content, 'supplier-invoices', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
