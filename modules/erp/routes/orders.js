import { Hono } from 'hono';
import { adminLayout, can } from '../layout.js';
import { logActivity, requirePerm } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { posSchema, orderStatusSchema, orderNotesSchema, orderTrackingSchema, refundSchema, draftOrderSchema } from '../schemas.js';
import { escHtml } from '../../../core/escape.js';
import { generateInvoice } from './invoices.js';

const ORDER_STATUSES = [
  'borrador', 'en_preparacion', 'enviado',
  'completado', 'cancelado', 'reembolsado'
];

const STATUS_LABEL = {
  borrador:       'Borrador',
  en_preparacion: 'En preparación',
  enviado:        'Enviado',
  completado:     'Completado',
  cancelado:      'Cancelado',
  reembolsado:    'Reembolsado',
};

const STATUS_BADGE = {
  borrador:       'b-gray',
  en_preparacion: 'b-yellow',
  enviado:        'b-yellow',
  completado:     'b-green',
  cancelado:      'b-red',
  reembolsado:    'b-red',
};

export function createOrderRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  // ── API: SALES (POS, kept compatible) ─────────────────────────
  api.post('/sales', requirePerm('orders.create'), validate(posSchema), async c => {
    try {
      const { client_id, items, shipping_method_id, discount_code } = c.get('validated');
      if (!items || !items.length) return c.json({error:'Carrito vacío'},400);

      const cfg = db.prepare('SELECT tax_rate FROM company_config WHERE id=1').get();
      const taxRate = cfg ? cfg.tax_rate : 21;

      let subtotal = 0;
      items.forEach(i => { subtotal += parseFloat(i.price) * parseInt(i.qty); });

      // Shipping
      let shippingCost = 0;
      let shippingId = shipping_method_id || null;
      if (shippingId) {
        const sm = db.prepare('SELECT * FROM shipping_methods WHERE id=?').get(shippingId);
        if (sm) shippingCost = (sm.free_from && subtotal >= sm.free_from) ? 0 : sm.price;
      }

      // Discount
      let discountAmount = 0;
      let discountCodeId = null;
      if (discount_code) {
        const dc = db.prepare("SELECT * FROM discount_codes WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at > datetime('now'))").get(discount_code.trim().toUpperCase());
        if (dc && subtotal >= dc.min_order && (dc.max_uses === null || dc.uses_count < dc.max_uses)) {
          discountAmount = dc.type === 'percentage' ? subtotal * (dc.value / 100) : dc.value;
          discountCodeId = dc.id;
        }
      }

      const taxBase = subtotal - discountAmount + shippingCost;
      const tax = taxBase * (taxRate / 100);
      const total = taxBase + tax;
      const num = 'ORD-' + Date.now();

      const run = db.transaction(() => {
        for (const it of items) {
          const p = db.prepare('SELECT stock FROM products WHERE id=?').get(it.id);
          if (!p) throw new Error('Producto no encontrado: ' + it.name);
          if (it.variant_id) {
            const v = db.prepare('SELECT stock FROM product_variants WHERE id=? AND product_id=?').get(it.variant_id, it.id);
            if (!v) throw new Error('Variante no encontrada: ' + it.name);
            if (v.stock < parseInt(it.qty)) throw new Error('Stock insuficiente para la variante: ' + it.name);
          } else {
            if (p.stock < parseInt(it.qty)) throw new Error('Stock insuficiente: ' + it.name);
          }
        }
        const ord = db.prepare('INSERT INTO sales_orders (order_number,client_id,shipping_method_id,discount_code_id,subtotal,shipping_cost,discount_amount,tax_amount,total,status,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(num, client_id||null, shippingId, discountCodeId, subtotal, shippingCost, discountAmount, tax, total, 'completado', 'pos');
        const orderId = ord.lastInsertRowid;
        items.forEach(it => {
          db.prepare('INSERT INTO sales_items (order_id,product_id,variant_id,product_name,quantity,unit_price,total) VALUES (?,?,?,?,?,?,?)').run(orderId, it.id, it.variant_id || null, it.name, parseInt(it.qty), parseFloat(it.price), parseFloat(it.price)*parseInt(it.qty));
          db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(parseInt(it.qty), it.id);
          if (it.variant_id) {
            db.prepare('UPDATE product_variants SET stock=stock-? WHERE id=? AND product_id=?').run(parseInt(it.qty), it.variant_id, it.id);
          }
          db.prepare('INSERT INTO inventory_movements (product_id,variant_id,type,quantity,reason) VALUES (?,?,?,?,?)').run(it.id, it.variant_id || null, 'out', parseInt(it.qty), `Venta POS (Pedido #${num})`);
        });
        if (client_id) {
          db.prepare('UPDATE clients SET total_spent=total_spent+? WHERE id=?').run(total, client_id);
        }
        if (discountCodeId) {
          db.prepare('UPDATE discount_codes SET uses_count=uses_count+1 WHERE id=?').run(discountCodeId);
        }
        db.prepare('INSERT INTO order_status_history (order_id,status,comment,user_name) VALUES (?,?,?,?)').run(orderId, 'completado', 'Venta POS', c.get('session')?.userName || 'Sistema');
        return orderId;
      });
      const orderId = run();

      // Auto-facturación VeriFactu
      try {
        generateInvoice(db, orderId);
      } catch (invoiceErr) {
        console.error('Error al generar factura automática para pedido ' + num + ':', invoiceErr);
      }

      logActivity(db, c.get('session'), 'Creó venta POS', 'order', null, num);
      return c.json({order_number: num, message:'Venta completada', total});
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── API: ORDERS ────────────────────────────────────────────────
  api.get('/', requirePerm('orders.read'), c => {
    try {
      const status = c.req.query('status');
      let q = 'SELECT so.*,c.name as client_name FROM sales_orders so LEFT JOIN clients c ON so.client_id=c.id';
      const params = [];
      if (status) { q += ' WHERE so.status=?'; params.push(status); }
      q += ' ORDER BY so.id DESC';
      return c.json(db.prepare(q).all(...params));
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.get('/:id', requirePerm('orders.read'), c => {
    try {
      const order = db.prepare('SELECT so.*,c.name as client_name,c.email as client_email,c.phone as client_phone FROM sales_orders so LEFT JOIN clients c ON so.client_id=c.id WHERE so.id=?').get(c.req.param('id'));
      if (!order) return c.json({error:'No encontrado'},404);
      order.items = db.prepare('SELECT * FROM sales_items WHERE order_id=?').all(order.id);
      order.history = db.prepare('SELECT * FROM order_status_history WHERE order_id=? ORDER BY id DESC').all(order.id);
      order.refunds = db.prepare('SELECT * FROM refunds WHERE order_id=? ORDER BY id DESC').all(order.id);
      return c.json(order);
    } catch(e) { return c.json({error:e.message},500); }
  });

  const VALID_TRANSITIONS = {
    borrador:       ['en_preparacion', 'cancelado'],
    en_preparacion: ['enviado', 'cancelado'],
    enviado:        ['completado', 'reembolsado'],
    completado:     [],
    cancelado:      [],
    reembolsado:    [],
  };

  api.post('/:id/status', requirePerm('orders.edit'), validate(orderStatusSchema), async c => {
    try {
      const { status, comment } = c.get('validated');
      if (!ORDER_STATUSES.includes(status)) return c.json({error:'Estado inválido'},400);

      const order = db.prepare('SELECT status, order_number FROM sales_orders WHERE id=?')
        .get(c.req.param('id'));
      if (!order) return c.json({ error: 'Pedido no encontrado' }, 404);

      const allowed = VALID_TRANSITIONS[order.status] || [];
      if (!allowed.includes(status)) {
        return c.json({
          error: `No se puede cambiar de "${order.status}" a "${status}"`
        }, 400);
      }

      if (status === 'cancelado' && order.status === 'borrador') {
        const items = db.prepare('SELECT * FROM sales_items WHERE order_id=?').all(c.req.param('id'));
        for (const item of items) {
          db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
          if (item.variant_id) {
            db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ? AND product_id = ?').run(item.quantity, item.variant_id, item.product_id);
          }
          db.prepare('INSERT INTO inventory_movements (product_id,variant_id,type,quantity,reason) VALUES (?,?,?,?,?)').run(item.product_id, item.variant_id || null, 'in', item.quantity, `Cancelación de borrador (Pedido #${order.order_number})`);
        }
      }

      db.prepare('UPDATE sales_orders SET status=? WHERE id=?').run(status, c.req.param('id'));
      db.prepare('INSERT INTO order_status_history (order_id,status,comment,user_name) VALUES (?,?,?,?)').run(c.req.param('id'), status, comment||'', c.get('session')?.userName||'Admin');
      logActivity(db, c.get('session'), 'Cambió estado pedido', 'order', c.req.param('id'), status);
      return c.json({message:'Estado actualizado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/:id/notes', requirePerm('orders.edit'), validate(orderNotesSchema), async c => {
    try {
      const { admin_notes } = c.get('validated');
      db.prepare('UPDATE sales_orders SET admin_notes=? WHERE id=?').run(admin_notes||'', c.req.param('id'));
      return c.json({message:'Nota guardada'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/:id/tracking', requirePerm('orders.edit'), validate(orderTrackingSchema), async c => {
    try {
      const { tracking_number } = c.get('validated');
      db.prepare('UPDATE sales_orders SET tracking_number=? WHERE id=?').run(tracking_number||'', c.req.param('id'));
      db.prepare('INSERT INTO order_status_history (order_id,status,comment,user_name) VALUES (?,?,?,?)').run(c.req.param('id'), 'enviado', 'Número de seguimiento: ' + tracking_number, c.get('session')?.userName||'Admin');
      return c.json({message:'Tracking guardado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  api.post('/:id/refund', requirePerm('orders.edit'), validate(refundSchema), async c => {
    try {
      const { amount, reason } = c.get('validated');
      if (!amount || amount <= 0) return c.json({error:'Monto inválido'},400);
      db.prepare('INSERT INTO refunds (order_id,amount,reason) VALUES (?,?,?)').run(c.req.param('id'), amount, reason||'');
      db.prepare("UPDATE sales_orders SET status='reembolsado' WHERE id=?").run(c.req.param('id'));
      db.prepare('INSERT INTO order_status_history (order_id,status,comment,user_name) VALUES (?,?,?,?)').run(c.req.param('id'), 'reembolsado', 'Reembolso: ' + sym + amount + ' — ' + (reason||''), c.get('session')?.userName||'Admin');
      logActivity(db, c.get('session'), 'Reembolso', 'order', c.req.param('id'), sym+amount);
      return c.json({message:'Reembolso registrado'});
    } catch(e) { return c.json({error:e.message},500); }
  });

  // ── VIEW: ORDERS LIST ──────────────────────────────────────────
  views.get('/', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph">
        <h2>Pedidos</h2>
        <div style="display:flex;gap:.5rem;align-items:center">
          <select class="form-control" id="statusFilter" style="width:auto" onchange="loadOrders()">
            <option value="">Todos los estados</option>
            ${ORDER_STATUSES.map(s=>`<option value="${s}">${STATUS_LABEL[s]||s}</option>`).join('')}
          </select>
          <input class="search" id="searchBox" placeholder="Buscar orden...">
          ${can(c, 'orders.create') ? '<a href="/admin/orders/draft/new" class="btn btn-secondary">Nuevo borrador</a>' : ''}
        </div>
      </div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Orden</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Origen</th><th>Fecha</th><th></th></tr></thead>
          <tbody id="orderBody"><tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Cargando...</td></tr></tbody>
        </table></div>
      </div>
      <script>
      let orders=[];
      async function loadOrders(){
        const s=document.getElementById('statusFilter').value;
        orders=await api('GET','/api/erp/orders'+(s?'?status='+s:'')).catch(()=>[]);
        renderOrders();
      }
      function renderOrders(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        const f=q?orders.filter(o=>o.order_number?.toLowerCase().includes(q)||(o.client_name||'').toLowerCase().includes(q)):orders;
        const sb={'borrador':'b-gray','en_preparacion':'b-yellow','enviado':'b-yellow','completado':'b-green','cancelado':'b-red','reembolsado':'b-red'};
        document.getElementById('orderBody').innerHTML=f.length?f.map(o=>'<tr>'+
          '<td><strong>'+o.order_number+'</strong></td>'+
          '<td>'+(o.client_name?escHtml(o.client_name):'<span style="color:var(--muted)">Anónimo</span>')+'</td>'+
          '<td><strong>${sym}'+Number(o.total||0).toFixed(2)+'</strong></td>'+
          '<td><span class="badge '+(sb[o.status]||'b-gray')+'">'+o.status+'</span></td>'+
          '<td><span class="badge b-gray">'+(o.source||'pos')+'</span></td>'+
          '<td style="color:var(--muted);font-size:.8rem">'+(o.created_at?.split(' ')[0]||'-')+'</td>'+
          '<td><a href="/admin/orders/'+o.id+'" class="btn btn-secondary btn-sm">Ver</a></td>'+
          '</tr>').join(''):'<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Sin pedidos</td></tr>';
      }
      document.getElementById('searchBox').addEventListener('input',renderOrders);
      loadOrders();
      </script>`;
    return c.html(adminLayout('Pedidos', content, 'orders', c.get('session')?.csrfToken || '', c));
  });

  // ── VIEW: ORDER DETAIL ─────────────────────────────────────────
  views.get('/:id{[0-9]+}', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const orderId = c.req.param('id');

    const content = `
      <div class="ph">
        <h2>Detalle Pedido</h2>
        <div style="display:flex;gap:.5rem">
          <span id="invoice-btn-wrap"></span>
          <a href="/admin/orders" class="btn btn-secondary">← Volver</a>
        </div>
      </div>
      <div id="orderDetail" style="display:grid;gap:1rem">
        <div style="text-align:center;padding:3rem;color:var(--muted)">Cargando...</div>
      </div>

      <div class="modal-overlay" id="trackModal">
        <div class="modal">
          <div class="modal-head"><h3>Número de Seguimiento</h3><button class="modal-close" onclick="closeModal('trackModal')">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Tracking number</label><input class="form-control" id="trackNum"></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('trackModal')">Cancelar</button><button class="btn btn-primary" onclick="saveTracking()">Guardar</button></div>
        </div>
      </div>

      <div class="modal-overlay" id="refundModal">
        <div class="modal">
          <div class="modal-head"><h3>Registrar Reembolso</h3><button class="modal-close" onclick="closeModal('refundModal')">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Monto (${sym})</label><input class="form-control" type="number" id="refundAmount" step="0.01"></div>
            <div class="form-group"><label class="form-label">Motivo</label><textarea class="form-control" id="refundReason" rows="2"></textarea></div>
          </div>
          <div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal('refundModal')">Cancelar</button><button class="btn btn-danger" onclick="doRefund()">Confirmar Reembolso</button></div>
        </div>
      </div>

      <script>
      const orderId=${orderId};
      const VALID_TRANSITIONS=${JSON.stringify(VALID_TRANSITIONS)};
      const STATUS_LABEL=${JSON.stringify(STATUS_LABEL)};
      const sb={'borrador':'b-gray','en_preparacion':'b-yellow','enviado':'b-yellow','completado':'b-green','cancelado':'b-red','reembolsado':'b-red'};
      let order=null;

      async function loadOrder(){
        order=await api('GET','/api/erp/orders/'+orderId);
        const items=order.items||[];
        const history=order.history||[];
        document.getElementById('orderDetail').innerHTML=
          '<div class="grid g2">'+
          '<div class="card">'+
          '<div class="card-head"><h3>'+order.order_number+'</h3>'+
          '<span class="badge '+(sb[order.status]||'b-gray')+'">'+order.status+'</span></div>'+
          '<div class="card-body">'+
          '<p style="font-size:.85rem;color:var(--muted);margin-bottom:.5rem">Origen: '+order.source+' | Fecha: '+(order.created_at?.split(' ')[0]||'-')+'</p>'+
          '<p><strong>Cliente:</strong> '+escHtml(order.client_name||'Anónimo')+(order.client_email?' · '+escHtml(order.client_email):'')+'</p>'+
          (order.tracking_number?'<p style="margin-top:.5rem"><strong>Tracking:</strong> '+escHtml(order.tracking_number)+'</p>':'')+
          (order.admin_notes?'<div class="alert alert-ok" style="margin-top:.75rem">'+escHtml(order.admin_notes)+'</div>':'')+
          '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem">'+
          (order.status==='borrador'?'<button class="btn btn-primary btn-sm" onclick="confirmOrder()">Confirmar pedido</button>':'')+
          '<button class="btn btn-secondary btn-sm" onclick="openModal(&apos;trackModal&apos;)">Tracking</button>'+
          '<button class="btn btn-secondary btn-sm" onclick="editNotes()">Nota interna</button>'+
          '<button class="btn btn-danger btn-sm" onclick="openModal(&apos;refundModal&apos;)">Reembolso</button>'+
          '</div></div></div>'+

          '<div class="card">'+
          '<div class="card-head"><h3>Resumen financiero</h3></div>'+
          '<div class="card-body">'+
          '<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:var(--muted)">Subtotal</span><span>${sym}'+Number(order.subtotal||0).toFixed(2)+'</span></div>'+
          (order.discount_amount>0?'<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:#10b981">Descuento</span><span style="color:#10b981">-${sym}'+Number(order.discount_amount).toFixed(2)+'</span></div>':'')+
          (order.shipping_cost>0?'<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:var(--muted)">Envío</span><span>${sym}'+Number(order.shipping_cost).toFixed(2)+'</span></div>':'')+
          '<div style="display:flex;justify-content:space-between;margin-bottom:.4rem"><span style="color:var(--muted)">IVA</span><span>${sym}'+Number(order.tax_amount||0).toFixed(2)+'</span></div>'+
          '<hr style="border:none;border-top:1px solid var(--border);margin:.5rem 0">'+
          '<div style="display:flex;justify-content:space-between;font-weight:700;font-size:1.1rem"><span>Total</span><span>${sym}'+Number(order.total||0).toFixed(2)+'</span></div>'+
          '</div></div></div>'+

          '<div class="card">'+
          '<div class="card-head"><h3>Productos</h3></div>'+
          '<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cant.</th><th>P.Unit</th><th>Total</th></tr></thead><tbody>'+
          items.map(i=>'<tr><td>'+i.product_name+'</td><td>'+i.quantity+'</td><td>${sym}'+Number(i.unit_price).toFixed(2)+'</td><td>${sym}'+Number(i.total).toFixed(2)+'</td></tr>').join('')+
          '</tbody></table></div></div>'+

          '<div class="card">'+
          '<div class="card-head"><h3>Historial de estados</h3></div>'+
          '<div class="card-body">'+
          history.map(h=>'<div style="display:flex;gap:.75rem;padding:.5rem 0;border-bottom:1px solid #f8fafc">'+
          '<span class="badge '+(sb[h.status]||'b-gray')+'">'+h.status+'</span>'+
          '<span style="font-size:.82rem;color:var(--muted)">'+(h.comment||'')+'</span>'+
          '<span style="margin-left:auto;font-size:.75rem;color:var(--muted)">'+(h.created_at?.split(' ')[0]||'-')+'</span>'+
          '</div>').join('')+
          '</div></div>';

        const nextStates=VALID_TRANSITIONS[order.status]||[];
        if(nextStates.length>0 && window.canDo('orders.update_status')){
          const btns=nextStates.map(function(s){
            return '<button class="btn '+(s==='cancelado'||s==='reembolsado'?'btn-danger':'btn-primary')+'" onclick="changeStatus(\\\''+s+'\\\')">'+STATUS_LABEL[s]+'</button>';
          }).join('');
          document.getElementById('orderDetail').innerHTML+=
            '<div class="card" style="margin-top:1rem">'+
            '<div class="card-body">'+
            '<h2 style="font-size:16px;font-weight:600;margin-bottom:16px">Cambiar estado</h2>'+
            '<div style="display:flex;gap:12px;flex-wrap:wrap">'+btns+'</div>'+
            '<div style="margin-top:12px"><input type="text" id="status-comment" class="form-control" placeholder="Comentario opcional" style="max-width:400px"></div>'+
            '</div></div>';
        }

        document.getElementById('trackNum').value=order.tracking_number||'';
        if(['completado'].includes(order.status)){
          document.getElementById('invoice-btn-wrap').innerHTML=
            '<a href="/admin/orders/'+orderId+'/invoice" target="_blank" class="btn btn-secondary">Vista previa</a>'+
            (window.canDo('invoices.create')?' <button class="btn btn-primary" onclick="generateInvoice()">Generar factura</button>':'');
        } else {
          document.getElementById('invoice-btn-wrap').innerHTML='';
        }
      }

      async function changeStatus(newStatus){
        const label=STATUS_LABEL[newStatus];
        if(!confirm('¿Cambiar estado a "'+label+'"?'))return;
        const comment=document.getElementById('status-comment')?.value||'';
        try{
          await api('POST','/api/erp/orders/'+orderId+'/status',{status:newStatus,comment});
          location.reload();
        }catch(e){alert(e.message||'Error');}
      }
      async function saveTracking(){
        const n=document.getElementById('trackNum').value;
        await api('POST','/api/erp/orders/'+orderId+'/tracking',{tracking_number:n});
        closeModal('trackModal');toast('Tracking guardado');loadOrder();
      }
      async function generateInvoice(){
        try{
          const data=await api('POST','/api/erp/invoices/from-order/'+orderId);
          if(data.already){toast('Ya existe: '+data.invoice_number);window.open('/admin/invoices/'+data.id,'_blank');return;}
          toast('Factura '+data.invoice_number+' generada');
          window.open('/admin/invoices/'+data.id,'_blank');
          loadOrder();
        }catch(e){toast(e.message||'Error al generar factura','err');}
      }
      async function editNotes(){
        const n=prompt('Nota interna:',order?.admin_notes||'');
        if(n===null)return;
        await api('POST','/api/erp/orders/'+orderId+'/notes',{admin_notes:n});
        toast('Nota guardada');loadOrder();
      }
      async function doRefund(){
        const a=parseFloat(document.getElementById('refundAmount').value);
        const r=document.getElementById('refundReason').value;
        if(!a||a<=0){toast('Monto inválido','err');return;}
        await api('POST','/api/erp/orders/'+orderId+'/refund',{amount:a,reason:r});
        closeModal('refundModal');toast('Reembolso registrado');loadOrder();
      }
      async function confirmOrder(){
        try{
          await api('POST','/api/erp/orders/'+orderId+'/confirm',{});
          toast('Pedido confirmado');loadOrder();
        }catch(e){toast(e.message,'err');}
      }
      loadOrder();
      </script>`;

    return c.html(adminLayout('Detalle Pedido', content, 'orders', c.get('session')?.csrfToken || '', c));
  });

  // ── VIEW: INVOICE (printable) ──────────────────────────────────
  views.get('/:id{[0-9]+}/invoice', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const orderId = c.req.param('id');
    try {
      const order = db.prepare('SELECT so.*,c.name as client_name,c.email as client_email,c.address as client_address,c.fiscal_id as client_fiscal FROM sales_orders so LEFT JOIN clients c ON so.client_id=c.id WHERE so.id=?').get(orderId);
      if (!order) return c.html('<p>Pedido no encontrado</p>');
      const items = db.prepare('SELECT * FROM sales_items WHERE order_id=?').all(orderId);
      const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get();
      const watermark = order.status !== 'completado' ? order.status.toUpperCase() : null;

      return c.html(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Factura ${escHtml(order.order_number)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:700px;margin:2rem auto;padding:1rem;color:#1e293b}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2rem;padding-bottom:1rem;border-bottom:2px solid #10b981}
  .company{font-size:.85rem;color:#64748b}.company h2{color:#1e293b;font-size:1.3rem;margin:0 0 .25rem}
  .invoice-info{text-align:right;font-size:.85rem}
  .invoice-info h1{color:#10b981;font-size:1.5rem;margin:0}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-bottom:2rem}
  .party h4{margin:0 0 .5rem;font-size:.8rem;text-transform:uppercase;color:#64748b}
  table{width:100%;border-collapse:collapse;margin-bottom:1.5rem}
  th{background:#f8fafc;padding:.6rem 1rem;text-align:left;font-size:.8rem;font-weight:600;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0}
  td{padding:.6rem 1rem;border-bottom:1px solid #f1f5f9}
  .totals{margin-left:auto;width:280px}
  .total-row{display:flex;justify-content:space-between;padding:.3rem 0;font-size:.9rem}
  .total-final{font-size:1.1rem;font-weight:700;border-top:2px solid #10b981;padding-top:.5rem;color:#10b981}
  @media print{button{display:none}}
</style></head>
<body>
  ${watermark ? `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:80px;font-weight:900;color:rgba(0,0,0,0.08);pointer-events:none;z-index:9999;white-space:nowrap;">${watermark}</div>` : ''}
  <div class="header">
    <div class="company"><h2>${escHtml(cfg?.company_name||'Mi Empresa')}</h2>${cfg?.fiscal_id?'<div>NIF: '+escHtml(cfg.fiscal_id)+'</div>':''}<div>${escHtml(cfg?.address||'')}</div><div>${escHtml(cfg?.phone||'')}</div></div>
    <div class="invoice-info"><h1>FACTURA</h1><div><strong>${escHtml(order.order_number)}</strong></div><div>${order.created_at?.split(' ')[0]||'-'}</div></div>
  </div>
  <div class="parties">
    <div class="party"><h4>Facturado a</h4><strong>${escHtml(order.client_name||'Cliente general')}</strong>${order.client_fiscal?'<br>NIF: '+escHtml(order.client_fiscal):''}<br>${escHtml(order.client_email||'')}<br>${escHtml(order.client_address||'')}</div>
    <div class="party"><h4>Estado</h4><strong>${escHtml(order.status)}</strong></div>
  </div>
  <table>
    <thead><tr><th>Producto</th><th>Cant.</th><th>P.Unitario</th><th>Total</th></tr></thead>
    <tbody>${items.map(i=>'<tr><td>'+escHtml(i.product_name)+'</td><td>'+i.quantity+'</td><td>${sym}'+Number(i.unit_price).toFixed(2)+'</td><td>${sym}'+Number(i.total).toFixed(2)+'</td></tr>').join('')}</tbody>
  </table>
  <div class="totals">
    <div class="total-row"><span>Subtotal</span><span>${sym}${Number(order.subtotal||0).toFixed(2)}</span></div>
    ${order.discount_amount>0?'<div class="total-row" style="color:#10b981"><span>Descuento</span><span>-${sym}'+Number(order.discount_amount).toFixed(2)+'</span></div>':''}
    ${order.shipping_cost>0?'<div class="total-row"><span>Envío</span><span>${sym}'+Number(order.shipping_cost).toFixed(2)+'</span></div>':''}
    <div class="total-row"><span>IVA</span><span>${sym}${Number(order.tax_amount||0).toFixed(2)}</span></div>
    <div class="total-row total-final"><span>TOTAL</span><span>${sym}${Number(order.total||0).toFixed(2)}</span></div>
  </div>
  <br><button onclick="window.print()" style="background:#10b981;color:#fff;border:none;padding:.6rem 1.5rem;border-radius:6px;cursor:pointer;font-weight:600">Imprimir / PDF</button>
</body></html>`);
    } catch(e) { return c.html('<p>Error: '+e.message+'</p>'); }
  });

  // ── VIEW: POS ──────────────────────────────────────────────────
  views.get('/pos', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Punto de Venta</h2></div>
      <div class="grid g2">
        <div>
          <div class="card" style="margin-bottom:1rem">
            <div class="card-head"><h3>Seleccionar Productos</h3></div>
            <div class="card-body">
              <input class="search" id="prodSearch" placeholder="Buscar producto..." oninput="filterProds()" style="width:100%;margin-bottom:1rem">
              <div id="prodList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.5rem;max-height:400px;overflow-y:auto"></div>
            </div>
          </div>
        </div>
        <div>
          <div class="card" style="margin-bottom:1rem">
            <div class="card-head"><h3>Carrito</h3></div>
            <div class="card-body">
              <div style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem">
                  <label class="form-label" style="margin:0">Cliente</label>
                  <button class="btn btn-secondary btn-sm" onclick="openModal('newClientModal')">+ Nuevo</button>
                </div>
                <select class="form-control" id="posClient"><option value="">Anónimo</option></select>
              </div>
              <div id="cartItems" style="min-height:80px;border:1px dashed var(--border);border-radius:6px;padding:.75rem;margin-bottom:1rem"></div>
              <div style="margin-bottom:1rem">
                <label class="form-label">Cupón de descuento</label>
                <div style="display:flex;gap:.5rem">
                  <input class="form-control" id="couponCode" placeholder="Código...">
                  <button class="btn btn-secondary btn-sm" onclick="validateCoupon()">Aplicar</button>
                </div>
                <div id="couponMsg" style="font-size:.8rem;margin-top:.3rem"></div>
              </div>
              <div style="margin-bottom:1rem">
                <label class="form-label">Método de envío</label>
                <select class="form-control" id="shippingMethod"><option value="">Sin envío</option></select>
              </div>
              <div style="background:#f8fafc;padding:1rem;border-radius:8px;margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;margin-bottom:.3rem;font-size:.85rem"><span>Subtotal</span><span id="posSubtotal">${sym}0.00</span></div>
                <div style="display:flex;justify-content:space-between;margin-bottom:.3rem;font-size:.85rem;color:#10b981" id="discountRow" style="display:none"><span>Descuento</span><span id="posDiscount">-${sym}0.00</span></div>
                <div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:700"><span>Total estimado</span><span id="posTotal">${sym}0.00</span></div>
              </div>
              <button class="btn btn-primary" style="width:100%" onclick="checkout()">Cobrar</button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="newClientModal">
        <div class="modal" style="max-width:420px">
          <div class="modal-head"><h3>Nuevo Cliente</h3><button class="modal-close" onclick="closeModal('newClientModal')">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Nombre *</label><input class="form-control" id="ncName" placeholder="Nombre completo"></div>
            <div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" id="ncEmail" placeholder="correo@ejemplo.com"></div>
            <div class="form-group"><label class="form-label">Teléfono</label><input class="form-control" id="ncPhone" placeholder="600 000 000"></div>
            <div class="form-group"><label class="form-label">Dirección</label><input class="form-control" id="ncAddr" placeholder="Calle, número, ciudad"></div>
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" onclick="closeModal('newClientModal')">Cancelar</button>
            <button class="btn btn-primary" onclick="saveNewClient()">Crear y seleccionar</button>
          </div>
        </div>
      </div>

      <div id="variantModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:14px;padding:24px;max-width:400px;width:90%">
          <h3 id="variantModalTitle" style="margin-bottom:16px;font-size:16px;font-weight:600"></h3>
          <div id="variantOptionList" style="display:flex;flex-direction:column;gap:8px"></div>
          <button onclick="closeVariantModal()" style="margin-top:16px;width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer">Cancelar</button>
        </div>
      </div>

      <script>
      let cart=[],prods=[],couponApplied=null,_vmProd=null;
      window._sym='${sym}';
      async function loadPOS(){
        [prods,clients,shipping]=await Promise.all([
          api('GET','/api/erp/products').catch(()=>[]),
          api('GET','/api/erp/clients').catch(()=>[]),
          api('GET','/api/erp/shipping').catch(()=>[])
        ]);
        prods=prods.filter(p=>p.status==='active'&&p.stock>0);
        const cl=document.getElementById('posClient');
        cl.innerHTML='<option value="">Anónimo</option>'+clients.map(c=>'<option value="'+c.id+'">'+c.name+'</option>').join('');
        const sm=document.getElementById('shippingMethod');
        sm.innerHTML='<option value="">Sin envío (retiro/local)</option>'+shipping.filter(s=>s.active).map(s=>'<option value="'+s.id+'">'+s.name+' — ${sym}'+s.price+(s.free_from?' (gratis desde ${sym}'+s.free_from+')':'')+'</option>').join('');
        filterProds();
      }
      function filterProds(){
        const q=document.getElementById('prodSearch').value.toLowerCase();
        const filtered=q?prods.filter(p=>p.name.toLowerCase().includes(q)):prods;
        document.getElementById('prodList').innerHTML=filtered.map(p=>'<div style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:.75rem;cursor:pointer" onclick="addToCart('+p.id+')">'+(p.image_url?'<img src="'+p.image_url+'" style="width:100%;height:80px;object-fit:cover;border-radius:4px;margin-bottom:.4rem">':'<div style="height:60px;display:flex;align-items:center;justify-content:center;font-size:1.5rem"></div>')+'<div style="font-size:.8rem;font-weight:600">'+p.name+'</div><div style="color:#10b981;font-size:.85rem;font-weight:700">${sym}'+p.price.toFixed(2)+'</div><div style="font-size:.72rem;color:var(--muted)">Stock: '+p.stock+'</div></div>').join('');
      }
      function addToCart(id){
        const p=prods.find(x=>x.id===id);if(!p)return;
        if(p.variants&&p.variants.length>0){openVariantModal(p);}
        else{pushToCart(id,null,p.name,p.price);}
      }
      function pushToCart(productId,variantId,name,price){
        const key=productId+'-'+(variantId||'0');
        const e=cart.find(x=>x.key===key);
        if(e){e.qty++;}else{cart.push({key,id:productId,variant_id:variantId,name,price,qty:1});}
        renderCart();
      }
      function renderCart(){
        const el=document.getElementById('cartItems');
        if(!cart.length){el.innerHTML='<p style="color:var(--muted);font-size:.85rem;text-align:center">Carrito vacío</p>';updateTotals();return;}
        el.innerHTML=cart.map((x,i)=>'<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;font-size:.85rem">'+
          '<span style="flex:1">'+x.name+'</span>'+
          '<input type="number" min="1" value="'+x.qty+'" style="width:55px;padding:.25rem .4rem;border:1px solid var(--border);border-radius:4px;font-size:.82rem" onchange="cart['+i+'].qty=Math.max(1,+this.value);renderCart()">'+
          '<span style="min-width:55px;text-align:right">${sym}'+(x.price*x.qty).toFixed(2)+'</span>'+
          '<button onclick="cart.splice('+i+',1);renderCart()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:.9rem">✕</button>'+
          '</div>').join('');
        updateTotals();
      }
      function updateTotals(){
        const sub=cart.reduce((a,b)=>a+(b.price*b.qty),0);
        const disc=couponApplied?(couponApplied.type==='percentage'?sub*(couponApplied.value/100):couponApplied.value):0;
        document.getElementById('posSubtotal').textContent='${sym}'+sub.toFixed(2);
        document.getElementById('posDiscount').textContent='-${sym}'+disc.toFixed(2);
        document.getElementById('discountRow').style.display=disc>0?'flex':'none';
        document.getElementById('posTotal').textContent='${sym}'+(sub-disc).toFixed(2);
      }
      async function validateCoupon(){
        const code=document.getElementById('couponCode').value.trim();
        if(!code)return;
        const r=await fetch('/api/store/validate-coupon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,subtotal:cart.reduce((a,b)=>a+(b.price*b.qty),0)})});
        const d=await r.json();
        if(d.error){document.getElementById('couponMsg').innerHTML='<span style="color:#ef4444">'+d.error+'</span>';couponApplied=null;}
        else{document.getElementById('couponMsg').innerHTML='<span style="color:#10b981">✓ '+d.message+'</span>';couponApplied=d.discount;}
        updateTotals();
      }
      async function checkout(){
        if(!cart.length){toast('Carrito vacío','err');return;}
        const rawClient=document.getElementById('posClient').value;
        const clientId=rawClient?parseInt(rawClient,10):null;
        const shippingId=document.getElementById('shippingMethod').value||null;
        try{
          const d=await api('POST','/api/erp/orders/sales',{client_id:clientId,items:cart.map(x=>({id:x.id,variant_id:x.variant_id||null,name:x.name,price:x.price,qty:x.qty})),shipping_method_id:shippingId,discount_code:couponApplied?document.getElementById('couponCode').value:null});
          toast('Venta: '+d.order_number+' — ${sym}'+Number(d.total||0).toFixed(2));
          cart=[];couponApplied=null;document.getElementById('couponCode').value='';document.getElementById('couponMsg').textContent='';
          renderCart();
        }catch(e){toast(e.message,'err')}
      }
      async function saveNewClient(){
        const name=document.getElementById('ncName').value.trim();
        if(!name){toast('El nombre es obligatorio','err');return;}
        try{
          const d=await api('POST','/api/erp/clients',{
            name,
            email:document.getElementById('ncEmail').value.trim(),
            phone:document.getElementById('ncPhone').value.trim(),
            address:document.getElementById('ncAddr').value.trim()
          });
          // Reload client list and select the new one
          clients=await api('GET','/api/erp/clients').catch(()=>clients);
          const cl=document.getElementById('posClient');
          cl.innerHTML='<option value="">Anónimo</option>'+clients.map(c=>'<option value="'+c.id+'">'+c.name+'</option>').join('');
          cl.value=d.id;
          closeModal('newClientModal');
          ['ncName','ncEmail','ncPhone','ncAddr'].forEach(id=>document.getElementById(id).value='');
          toast('Cliente creado y seleccionado');
        }catch(e){toast(e.message,'err')}
      }
      function openVariantModal(p){
        _vmProd=p;
        document.getElementById('variantModalTitle').textContent='Selecciona variante: '+p.name;
        const sym=window._sym||'€';
        document.getElementById('variantOptionList').innerHTML=p.variants.map(function(v,i){
          const parts=[v.option1_name&&v.option1_value?v.option1_name+': '+v.option1_value:'',v.option2_name&&v.option2_value?v.option2_name+': '+v.option2_value:'',v.name].filter(Boolean);
          const label=parts.join(' · ');
          const price=v.price!==null?v.price:p.price;
          return '<button onclick="selectVariant('+i+')" style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;text-align:left;width:100%"><strong>'+label+'</strong><span style="float:right;color:#0D9488">'+sym+price.toFixed(2)+'</span><br><small style="color:#64748b">Stock: '+v.stock+'</small></button>';
        }).join('');
        document.getElementById('variantModal').style.display='flex';
      }
      function selectVariant(idx){
        const v=_vmProd.variants[idx];
        const price=v.price!==null?v.price:_vmProd.price;
        const parts=[v.option1_name&&v.option1_value?v.option1_name+': '+v.option1_value:'',v.option2_name&&v.option2_value?v.option2_name+': '+v.option2_value:'',v.name].filter(Boolean);
        const label=parts.join(' · ');
        pushToCart(_vmProd.id,v.id,_vmProd.name+(label?' ('+label+')':''),price);
        closeVariantModal();
      }
      function closeVariantModal(){
        document.getElementById('variantModal').style.display='none';
      }
      loadPOS();
      </script>`;
    return c.html(adminLayout('Punto de Venta', content, 'pos', c.get('session')?.csrfToken || '', c));
  });

  // ── VIEW: REFUNDS ──────────────────────────────────────────────
  views.get('/refunds', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const refunds = db.prepare('SELECT r.*,so.order_number,c.name as client_name FROM refunds r JOIN sales_orders so ON r.order_id=so.id LEFT JOIN clients c ON so.client_id=c.id ORDER BY r.id DESC').all();
    const rows = refunds.map(r => `<tr>
      <td><a href="/admin/orders/${r.order_id}" style="color:var(--p);font-weight:600">${escHtml(r.order_number)}</a></td>
      <td>${escHtml(r.client_name||'Anónimo')}</td>
      <td><strong>${sym}${Number(r.amount).toFixed(2)}</strong></td>
      <td style="color:var(--muted)">${escHtml(r.reason||'-')}</td>
      <td style="color:var(--muted);font-size:.8rem">${r.created_at?.split(' ')[0]||'-'}</td>
    </tr>`).join('');
    const total = refunds.reduce((a, b) => a + b.amount, 0);
    const content = `
      <div class="ph"><h2>Devoluciones</h2></div>
      <div class="kpi" style="margin-bottom:1rem;max-width:250px"><div class="kpi-label">Total reembolsado</div><div class="kpi-val" style="color:#ef4444">${sym}${total.toFixed(2)}</div></div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Monto</th><th>Motivo</th><th>Fecha</th></tr></thead>
          <tbody>${rows||'<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Sin devoluciones</td></tr>'}</tbody>
        </table></div>
      </div>`;
    return c.html(adminLayout('Devoluciones', content, 'refunds', c.get('session')?.csrfToken || '', c));
  });

  // ── API: CREAR BORRADOR ────────────────────────────────────────
  api.post('/draft', requirePerm('orders.create'), validate(draftOrderSchema), c => {
    try {
      const d = c.get('validated');
      const session = c.get('session');
      const subtotal = d.items.reduce((s, i) => s + i.price * i.qty, 0);
      const orderNumber = 'DRAFT-' + Date.now();

      const createDraft = db.transaction(() => {
        const r = db.prepare(`
          INSERT INTO sales_orders
            (order_number, client_id, subtotal, total, status, source,
             customer_notes, admin_notes)
          VALUES (?, ?, ?, ?, 'borrador', 'manual', ?, ?)
        `).run(orderNumber, d.client_id || null, subtotal, subtotal,
               d.customer_notes || '', d.admin_notes || '');

        const orderId = r.lastInsertRowid;
        for (const item of d.items) {
          const p = db.prepare('SELECT stock FROM products WHERE id=?').get(item.id);
          if (!p) throw new Error('Producto no encontrado: ' + item.name);
          if (item.variant_id) {
            const v = db.prepare('SELECT stock FROM product_variants WHERE id=? AND product_id=?').get(item.variant_id, item.id);
            if (!v) throw new Error('Variante no encontrada: ' + item.name);
            if (v.stock < parseInt(item.qty)) throw new Error('Stock insuficiente para la variante: ' + item.name);
          } else {
            if (p.stock < parseInt(item.qty)) throw new Error('Stock insuficiente: ' + item.name);
          }

          db.prepare(`
            INSERT INTO sales_items
              (order_id, product_id, variant_id, product_name, quantity, unit_price, total)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(orderId, item.id, item.variant_id || null, item.name, item.qty, item.price,
                 item.price * item.qty);
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(item.qty, item.id);
          if (item.variant_id) {
            db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ? AND product_id = ?').run(item.qty, item.variant_id, item.id);
          }
          db.prepare('INSERT INTO inventory_movements (product_id,variant_id,type,quantity,reason) VALUES (?,?,?,?,?)').run(item.id, item.variant_id || null, 'out', item.qty, `Reserva de borrador (Pedido #${orderNumber})`);
        }
        return orderId;
      });

      const orderId = createDraft();
      logActivity(db, session, 'Creó borrador', 'order', orderId, orderNumber);
      return c.json({ id: orderId, order_number: orderNumber, message: 'Borrador creado' }, 201);
    } catch(e) { return c.json({ error: e.message }, 500); }
  });

  // ── API: CONFIRMAR BORRADOR ────────────────────────────────────
  api.post('/:id/confirm', requirePerm('orders.edit'), c => {
    try {
      const id = Number(c.req.param('id'));
      const order = db.prepare("SELECT * FROM sales_orders WHERE id=? AND status='borrador'").get(id);
      if (!order) return c.json({ error: 'Borrador no encontrado' }, 404);
      db.prepare("UPDATE sales_orders SET status='en_preparacion', source='manual' WHERE id=?").run(id);
      db.prepare('INSERT INTO order_status_history (order_id,status,comment,user_name) VALUES (?,?,?,?)').run(id, 'en_preparacion', 'Borrador confirmado', c.get('session')?.userName || 'Admin');
      logActivity(db, c.get('session'), 'Confirmó borrador', 'order', id, order.order_number);
      return c.json({ message: 'Pedido confirmado', id });
    } catch(e) { return c.json({ error: e.message }, 500); }
  });

  // ── API: CANCELAR PEDIDO ───────────────────────────────────────
  api.post('/:id/cancel', requirePerm('orders.edit'), c => {
    try {
      const id = Number(c.req.param('id'));
      const order = db.prepare("SELECT * FROM sales_orders WHERE id=? AND status IN ('borrador','en_preparacion')").get(id);
      if (!order) return c.json({ error: 'Pedido no encontrado o no cancelable' }, 404);

      db.transaction(() => {
        if (order.status === 'borrador') {
          const items = db.prepare('SELECT * FROM sales_items WHERE order_id=?').all(id);
          for (const item of items) {
            db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
            if (item.variant_id) {
              db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ? AND product_id = ?').run(item.quantity, item.variant_id, item.product_id);
            }
            db.prepare('INSERT INTO inventory_movements (product_id,variant_id,type,quantity,reason) VALUES (?,?,?,?,?)').run(item.product_id, item.variant_id || null, 'in', item.quantity, `Cancelación de pedido (Pedido #${order.order_number})`);
          }
        }
        db.prepare("UPDATE sales_orders SET status='cancelado' WHERE id=?").run(id);
        db.prepare('INSERT INTO order_status_history (order_id,status,comment,user_name) VALUES (?,?,?,?)').run(id, 'cancelado', 'Pedido cancelado', c.get('session')?.userName || 'Admin');
      })();

      logActivity(db, c.get('session'), 'Canceló pedido', 'order', id, order.order_number);
      return c.json({ message: 'Pedido cancelado', id });
    } catch(e) { return c.json({ error: e.message }, 500); }
  });

  // ── VISTA: NUEVO BORRADOR ──────────────────────────────────────
  views.get('/draft/new', c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const session  = c.get('session');
    const clients  = db.prepare('SELECT id, name FROM clients ORDER BY name').all();
    const rawProds = db.prepare("SELECT id, name, sku, price FROM products WHERE status='active' ORDER BY name").all();
    const products = rawProds.map(p => ({ ...p, variants: db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id').all(p.id) }));

    const content = `
      <div class="ph">
        <h2>Nuevo borrador</h2>
        <a href="/admin/orders" class="btn btn-secondary">Cancelar</a>
      </div>

      <div class="card" style="max-width:820px">
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Cliente (opcional)</label>
            <select id="f-client" class="form-control">
              <option value="">Sin cliente</option>
              ${clients.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>

          <hr style="margin:1.25rem 0;border:none;border-top:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h3 style="font-size:.9rem;font-weight:600;margin:0">Productos</h3>
            <button class="btn btn-secondary btn-sm" onclick="addLine()">+ Añadir producto</button>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style="width:90px">Cantidad</th>
                  <th style="width:120px">Precio unit.</th>
                  <th style="width:100px;text-align:right">Subtotal</th>
                  <th style="width:36px"></th>
                </tr>
              </thead>
              <tbody id="lines-body"></tbody>
              <tfoot>
                <tr>
                  <td colspan="3" style="text-align:right;font-weight:600;padding:.7rem 1rem">Total</td>
                  <td style="text-align:right;font-weight:700;font-size:1rem;padding:.7rem 1rem">
                    <span id="total-display">${sym}0.00</span>
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="form-group" style="margin-top:1.25rem">
            <label class="form-label">Notas para el cliente</label>
            <textarea id="f-customer-notes" class="form-control" rows="2"
              placeholder="Visible para el cliente"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Notas internas</label>
            <textarea id="f-admin-notes" class="form-control" rows="2"
              placeholder="Solo visible para el equipo"></textarea>
          </div>

          <div style="text-align:right;margin-top:1rem">
            <button class="btn btn-primary" onclick="saveDraft()">Guardar borrador</button>
          </div>
        </div>
      </div>

      <script>
        const PRODUCTS = ${JSON.stringify(products)};
        window._sym = '${sym}';
        let lines = [];

        function getVariantSelect(l){
          const p=PRODUCTS.find(function(x){return x.id===l.product_id;});
          if(!p||!p.variants||!p.variants.length)return '';
          const sym=window._sym||'€';
          const opts=p.variants.map(function(v){
            const lbl=[v.option1_value,v.option2_value,v.name].filter(Boolean).join(' · ');
            const pr=v.price!==null?v.price:p.price;
            return '<option value="'+v.id+'"'+(l.variant_id===v.id?' selected':'')+'>'+lbl+' ('+sym+pr.toFixed(2)+')</option>';
          }).join('');
          return '<select class="form-control" style="margin-top:6px" onchange="updateLine('+l.uid+',\\'variant_id\\',this.value)"><option value="">Sin variante</option>'+opts+'</select>';
        }

        function addLine() {
          const p = PRODUCTS[0] || { id: 0, name: '', price: 0, sku: '' };
          lines.push({ uid: Date.now(), product_id: p.id, name: p.name, price: p.price, qty: 1 });
          renderLines();
        }

        function removeLine(uid) {
          lines = lines.filter(l => l.uid !== uid);
          renderLines();
        }

        function updateLine(uid, field, value) {
          const l = lines.find(l => l.uid === uid);
          if (!l) return;
          if (field === 'product_id') {
            const p = PRODUCTS.find(p => p.id === +value);
            if (p) { l.product_id = p.id; l.name = p.name; l.price = p.price; l.variant_id = null; }
          } else if (field === 'variant_id') {
            const p = PRODUCTS.find(p => p.id === l.product_id);
            const v = p?.variants?.find(v => v.id === +value);
            if (v) {
              l.variant_id = v.id;
              const lbl = [v.option1_value, v.option2_value, v.name].filter(Boolean).join(' · ');
              l.name = p.name + (lbl ? ' (' + lbl + ')' : '');
              l.price = v.price !== null ? v.price : p.price;
            }
          } else {
            l[field] = +value;
          }
          renderLines();
        }

        function renderLines() {
          document.getElementById('lines-body').innerHTML = lines.map(l => \`
            <tr>
              <td>
                <select class="form-control" onchange="updateLine(\${l.uid},'product_id',this.value)">
                  \${PRODUCTS.map(p => \`<option value="\${p.id}" \${p.id===l.product_id?'selected':''}>\${p.name}\${p.sku?' ('+p.sku+')':''}</option>\`).join('')}
                </select>
                \${getVariantSelect(l)}
              </td>
              <td><input type="number" class="form-control" value="\${l.qty}" min="1"
                onchange="updateLine(\${l.uid},'qty',this.value)"></td>
              <td><input type="number" class="form-control" value="\${l.price}" min="0" step="0.01"
                onchange="updateLine(\${l.uid},'price',this.value)"></td>
              <td style="text-align:right;padding:.7rem 1rem">${sym}\${(l.qty*l.price).toFixed(2)}</td>
              <td><button class="btn btn-sm btn-danger" onclick="removeLine(\${l.uid})">×</button></td>
            </tr>
          \`).join('');
          const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
          document.getElementById('total-display').textContent = '${sym}' + total.toFixed(2);
        }

        async function saveDraft() {
          if (!lines.length) { alert('Añade al menos un producto'); return; }
          const payload = {
            client_id: document.getElementById('f-client').value
                       ? +document.getElementById('f-client').value : null,
            items: lines.map(l => ({ id: l.product_id, variant_id: l.variant_id || null, name: l.name, price: l.price, qty: l.qty })),
            customer_notes: document.getElementById('f-customer-notes').value,
            admin_notes:    document.getElementById('f-admin-notes').value,
          };
          try {
            await api('POST', '/api/erp/orders/draft', payload);
            window.location.href = '/admin/orders';
          } catch(e) { toast(e.message || 'Error al guardar', 'err'); }
        }

        addLine();
      </script>`;

    return c.html(adminLayout('Nuevo borrador', content, 'orders', session?.csrfToken || '', c));
  });

  return { api, views };
}
