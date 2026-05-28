import { Hono } from 'hono';
import { createHash } from 'crypto';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { invoiceCreateSchema } from '../schemas.js';
import { adminLayout } from '../layout.js';

function getNextSeq(db, series, year) {
  db.prepare(`INSERT INTO invoice_sequences (series,year,last_seq) VALUES (?,?,0) ON CONFLICT(series,year) DO NOTHING`).run(series, year);
  db.prepare(`UPDATE invoice_sequences SET last_seq=last_seq+1 WHERE series=? AND year=?`).run(series, year);
  return db.prepare(`SELECT last_seq FROM invoice_sequences WHERE series=? AND year=?`).get(series, year).last_seq;
}

function getPrevHash(db, series, year) {
  const prev = db.prepare(`SELECT verifactu_hash FROM invoices WHERE series=? AND year=? ORDER BY sequence DESC LIMIT 1`).get(series, year);
  return prev?.verifactu_hash || '';
}

function calcHash(inv) {
  const data = [inv.invoice_number, inv.issue_date, inv.company_fiscal_id, inv.client_fiscal_id || '', inv.total.toFixed(2), inv.prev_hash].join('|');
  return createHash('sha256').update(data).digest('hex');
}

export function generateInvoice(db, orderId) {
  // prevent duplicate
  const existing = db.prepare('SELECT id, invoice_number FROM invoices WHERE order_id=?').get(orderId);
  if (existing) return { id: existing.id, invoice_number: existing.invoice_number, already: true };

  const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(orderId);
  if (!order) throw new Error('Pedido no encontrado');
  if (order.status !== 'completado') throw new Error('Solo se pueden facturar pedidos completados');

  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const client = order.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(order.client_id) : null;
  const items = db.prepare('SELECT * FROM sales_items WHERE order_id=?').all(orderId);

  const series = cfg.invoice_series || 'F';
  const year = new Date().getFullYear();
  const seq = getNextSeq(db, series, year);
  const invoice_number = `${series}${year}-${String(seq).padStart(4, '0')}`;
  const issue_date = new Date().toISOString().slice(0, 10);

  const subtotal = parseFloat((order.total / (1 + (cfg.tax_rate || 21) / 100)).toFixed(2));
  const tax_amount = parseFloat((order.total - subtotal).toFixed(2));
  const prev_hash = getPrevHash(db, series, year);

  const inv = {
    invoice_number,
    order_id: orderId,
    client_id: order.client_id || null,
    series,
    year,
    sequence: seq,
    issue_date,
    company_name: cfg.name || 'Mi empresa',
    company_fiscal_id: cfg.fiscal_id || '',
    company_address: cfg.address || '',
    client_name: client ? client.name : (order.client_name || ''),
    client_fiscal_id: client ? (client.fiscal_id || '') : '',
    client_address: client ? (client.address || '') : '',
    client_email: client ? (client.email || '') : '',
    subtotal,
    tax_rate: cfg.tax_rate || 21,
    tax_name: cfg.tax_name || 'IVA',
    tax_amount,
    total: order.total,
    currency: cfg.currency || 'EUR',
    currency_symbol: cfg.currency_symbol || '€',
    document_name: cfg.document_name || 'Factura',
    prev_hash,
  };
  inv.verifactu_hash = calcHash(inv);

  const result = db.prepare(`INSERT INTO invoices
    (invoice_number,order_id,client_id,series,year,sequence,issue_date,
     company_name,company_fiscal_id,company_address,
     client_name,client_fiscal_id,client_address,client_email,
     subtotal,tax_rate,tax_name,tax_amount,total,
     currency,currency_symbol,document_name,
     verifactu_hash,prev_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    inv.invoice_number, inv.order_id, inv.client_id, inv.series, inv.year, inv.sequence, inv.issue_date,
    inv.company_name, inv.company_fiscal_id, inv.company_address,
    inv.client_name, inv.client_fiscal_id, inv.client_address, inv.client_email,
    inv.subtotal, inv.tax_rate, inv.tax_name, inv.tax_amount, inv.total,
    inv.currency, inv.currency_symbol, inv.document_name,
    inv.verifactu_hash, inv.prev_hash
  );
  const invoiceId = result.lastInsertRowid;

  const insItem = db.prepare('INSERT INTO invoice_items (invoice_id,description,quantity,unit_price,total_price) VALUES (?,?,?,?,?)');
  for (const it of items) {
    insItem.run(invoiceId, it.product_name, it.quantity, it.unit_price, it.total);
  }

  return { id: invoiceId, invoice_number };
}

// A1: crear factura directa (sin pedido). Recibe datos de cliente + líneas libres,
// asigna correlativo y hash encadenado igual que generateInvoice, pero sin tocar
// sales_orders. order_id queda NULL.
export function createInvoice(db, invoiceData) {
  const { client_id, lines, issue_date, notes = '' } = invoiceData;
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Al menos una línea requerida');

  const client = db.prepare('SELECT id, name, fiscal_id, address, email FROM clients WHERE id=?').get(client_id);
  if (!client) throw new Error('Cliente no existe');

  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const series = cfg.invoice_series || 'F';
  const year = new Date().getFullYear();
  const issueDate = issue_date || new Date().toISOString().slice(0, 10);
  const tax_rate = cfg.tax_rate || 21;

  let subtotal = 0;
  for (const line of lines) subtotal += Number(line.quantity) * Number(line.unit_price);
  subtotal = parseFloat(subtotal.toFixed(2));
  const tax_amount = parseFloat((subtotal * (tax_rate / 100)).toFixed(2));
  const total = parseFloat((subtotal + tax_amount).toFixed(2));

  const create = db.transaction(() => {
    const seq = getNextSeq(db, series, year);
    const invoice_number = `${series}${year}-${String(seq).padStart(4, '0')}`;
    const prev_hash = getPrevHash(db, series, year);
    const verifactu_hash = calcHash({
      invoice_number,
      issue_date: issueDate,
      company_fiscal_id: cfg.fiscal_id || '',
      client_fiscal_id: client.fiscal_id || '',
      total,
      prev_hash,
    });

    const result = db.prepare(`INSERT INTO invoices
      (invoice_number, order_id, client_id, series, year, sequence, issue_date,
       company_name, company_fiscal_id, company_address,
       client_name, client_fiscal_id, client_address, client_email,
       subtotal, tax_rate, tax_name, tax_amount, total,
       currency, currency_symbol, document_name,
       verifactu_hash, prev_hash, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      invoice_number, null, client_id,
      series, year, seq, issueDate,
      cfg.company_name || 'Mi empresa', cfg.fiscal_id || '', cfg.address || '',
      client.name, client.fiscal_id || '', client.address || '', client.email || '',
      subtotal, tax_rate, cfg.tax_name || 'IVA', tax_amount, total,
      cfg.currency || 'EUR', cfg.currency_symbol || '€', cfg.document_name || 'Factura',
      verifactu_hash, prev_hash, notes
    );
    const invoiceId = result.lastInsertRowid;

    const insItem = db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total_price) VALUES (?,?,?,?,?)');
    for (const line of lines) {
      const qty = Number(line.quantity);
      const price = Number(line.unit_price);
      const total_price = parseFloat((qty * price).toFixed(2));
      insItem.run(invoiceId, line.description, qty, price, total_price);
    }
    return { id: invoiceId, invoice_number };
  });

  return create();
}

export function createInvoiceRoutes(db) {
  const api = new Hono();
  const views = new Hono();

  // GET /api/erp/invoices — list
  api.get('/', requirePerm('orders.read'), c => {
    try {
      const rows = db.prepare(`SELECT i.*, o.reference as order_ref FROM invoices i LEFT JOIN sales_orders o ON o.id=i.order_id ORDER BY i.created_at DESC LIMIT 200`).all();
      return c.json(rows);
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // GET /api/erp/invoices/:id — single invoice JSON
  api.get('/:id', requirePerm('orders.read'), c => {
    try {
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(c.req.param('id'));
      if (!inv) return c.json({ error: 'No encontrada' }, 404);
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
      return c.json({ ...inv, items });
    } catch (e) { return c.json({ error: e.message }, 500); }
  });

  // POST /api/erp/invoices/from-order/:orderId — generate invoice from order
  api.post('/from-order/:orderId', requirePerm('orders.edit'), c => {
    try {
      const orderId = parseInt(c.req.param('orderId'));
      const res = generateInvoice(db, orderId);
      return c.json(res);
    } catch (e) {
      let code = 500;
      if (e.message === 'Pedido no encontrado') code = 404;
      else if (e.message === 'Solo se pueden facturar pedidos completados') code = 400;
      return c.json({ error: e.message }, code);
    }
  });

  // A1: POST /api/erp/invoices — crear factura directa (sin pedido)
  api.post('/', requirePerm('invoices.create'), validate(invoiceCreateSchema), c => {
    try {
      const data = c.get('validated');
      const result = createInvoice(db, data);
      logActivity(db, c.get('session'), 'Creó factura', 'invoice', result.id, result.invoice_number);
      return c.json(result, 201);
    } catch (e) {
      let code = 400;
      if (e.message === 'Cliente no existe') code = 404;
      return c.json({ error: e.message }, code);
    }
  });

  // GET /admin/invoices — list view
  views.get('/', requirePerm('orders.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph">
        <h2>Facturas</h2>
        <a href="/admin/invoices/new" class="btn btn-primary">Nueva factura</a>
      </div>
      <div class="card">
        <div class="card-head"><h3>Todas las facturas</h3><input class="search" id="searchBox" placeholder="Buscar..." oninput="filterTable()"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Número</th><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody id="invBody"></tbody>
        </table></div>
      </div>
      <script>
      let rows=[];
      async function loadInvoices(){
        rows=await api('GET','/api/erp/invoices').catch(()=>[]);
        filterTable();
      }
      function filterTable(){
        const q=document.getElementById('searchBox').value.toLowerCase();
        const f=q?rows.filter(r=>r.invoice_number.toLowerCase().includes(q)||(r.client_name||'').toLowerCase().includes(q)):rows;
        const stBadge={emitida:'b-green',rectificada:'b-yellow',anulada:'b-red'};
        document.getElementById('invBody').innerHTML=f.length?f.map(r=>\`<tr>
          <td><strong>\${r.invoice_number}</strong></td>
          <td><a href="/admin/orders/\${r.order_id}">\${r.order_ref||r.order_id}</a></td>
          <td>\${r.client_name||'-'}</td>
          <td style="color:var(--muted);font-size:.85rem">\${r.issue_date||'-'}</td>
          <td><strong>${sym}\${r.total?.toFixed(2)||'0.00'}</strong></td>
          <td><span class="badge \${stBadge[r.status]||''}"\>\${r.status}</span></td>
          <td><a href="/admin/invoices/\${r.id}" target="_blank" class="btn btn-secondary btn-sm">Ver</a></td>
        </tr>\`).join(''):'<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Sin facturas</td></tr>';
      }
      loadInvoices();
      </script>`;
    return c.html(adminLayout('Facturas', content, 'invoices', c.get('session')?.csrfToken || '', c));
  });

  // A1: GET /admin/invoices/new — formulario para crear factura sin pedido
  views.get('/new', requirePerm('invoices.create'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const today = new Date().toISOString().slice(0, 10);
    const content = `
      <div class="ph">
        <h2>Nueva factura</h2>
        <a href="/admin/invoices" class="btn btn-secondary">Cancelar</a>
      </div>

      <div class="card" style="max-width:820px">
        <div class="card-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Cliente *</label>
              <select id="f-client" class="form-control">
                <option value="">— Selecciona cliente —</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Fecha emisión</label>
              <input type="date" id="f-date" class="form-control" value="${today}">
            </div>
          </div>

          <hr style="margin:1.25rem 0;border:none;border-top:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h3 style="font-size:.9rem;font-weight:600;margin:0">Líneas</h3>
            <button class="btn btn-secondary btn-sm" onclick="addLine()">+ Añadir línea</button>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th style="width:90px">Cantidad</th>
                  <th style="width:130px">Precio unit.</th>
                  <th style="width:110px;text-align:right">Subtotal</th>
                  <th style="width:36px"></th>
                </tr>
              </thead>
              <tbody id="lines-body"></tbody>
              <tfoot>
                <tr>
                  <td colspan="3" style="text-align:right;font-weight:600;padding:.7rem 1rem">Base imponible</td>
                  <td style="text-align:right;padding:.7rem 1rem"><span id="t-subtotal">${sym}0.00</span></td>
                  <td></td>
                </tr>
                <tr>
                  <td colspan="3" style="text-align:right;color:var(--muted);padding:.4rem 1rem">IVA (<span id="t-rate">21</span>%)</td>
                  <td style="text-align:right;color:var(--muted);padding:.4rem 1rem"><span id="t-tax">${sym}0.00</span></td>
                  <td></td>
                </tr>
                <tr>
                  <td colspan="3" style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">Total</td>
                  <td style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem"><span id="t-total">${sym}0.00</span></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="form-group" style="margin-top:1.25rem">
            <label class="form-label">Notas (opcional)</label>
            <textarea id="f-notes" class="form-control" rows="2"></textarea>
          </div>

          <div style="text-align:right;margin-top:1rem">
            <button class="btn btn-primary" id="btn-emit" onclick="emitInvoice()">Emitir factura</button>
          </div>
        </div>
      </div>

      <script>
      const SYM = '${sym}';
      let TAX_RATE = 21;
      let clients = [];

      async function loadAll(){
        try {
          const [cs, cfg] = await Promise.all([
            api('GET','/api/erp/clients').catch(()=>[]),
            api('GET','/api/erp/settings/company').catch(()=>null),
          ]);
          clients = cs;
          if (cfg && cfg.tax_rate) { TAX_RATE = Number(cfg.tax_rate) || 21; }
          document.getElementById('t-rate').textContent = TAX_RATE;
          const sel = document.getElementById('f-client');
          for (const cl of clients) {
            const o = document.createElement('option');
            o.value = cl.id; o.textContent = cl.name + (cl.fiscal_id ? ' — ' + cl.fiscal_id : '');
            sel.appendChild(o);
          }
        } catch(e){ toast(e.message||'Error cargando datos','err'); }
        addLine();
      }

      function addLine(){
        const tbody = document.getElementById('lines-body');
        const row = document.createElement('tr');
        row.innerHTML =
          '<td><input type="text" class="form-control line-desc" placeholder="Descripción del servicio o producto"></td>' +
          '<td><input type="number" class="form-control line-qty" step="0.01" min="0.01" value="1"></td>' +
          '<td><input type="number" class="form-control line-price" step="0.01" min="0" value="0"></td>' +
          '<td style="text-align:right;padding:.7rem 1rem"><span class="line-subtotal">' + SYM + '0.00</span></td>' +
          '<td><button class="btn btn-danger btn-sm" onclick="this.closest(\\'tr\\').remove();recalc()">✕</button></td>';
        tbody.appendChild(row);
        row.querySelectorAll('.line-qty, .line-price').forEach(inp => inp.addEventListener('input', recalc));
        recalc();
      }

      function recalc(){
        let sub = 0;
        document.querySelectorAll('#lines-body tr').forEach(r => {
          const q = parseFloat(r.querySelector('.line-qty').value) || 0;
          const p = parseFloat(r.querySelector('.line-price').value) || 0;
          const st = q * p;
          r.querySelector('.line-subtotal').textContent = SYM + st.toFixed(2);
          sub += st;
        });
        const tax = sub * (TAX_RATE/100);
        const tot = sub + tax;
        document.getElementById('t-subtotal').textContent = SYM + sub.toFixed(2);
        document.getElementById('t-tax').textContent = SYM + tax.toFixed(2);
        document.getElementById('t-total').textContent = SYM + tot.toFixed(2);
      }

      async function emitInvoice(){
        const client_id = parseInt(document.getElementById('f-client').value);
        if (!client_id) { toast('Selecciona un cliente','err'); return; }
        const issue_date = document.getElementById('f-date').value || undefined;
        const notes = document.getElementById('f-notes').value || '';
        const lines = [];
        for (const r of document.querySelectorAll('#lines-body tr')) {
          const desc = r.querySelector('.line-desc').value.trim();
          const qty = parseFloat(r.querySelector('.line-qty').value);
          const price = parseFloat(r.querySelector('.line-price').value);
          if (!desc) { toast('Falta descripción en una línea','err'); return; }
          if (!(qty > 0)) { toast('Cantidad debe ser > 0','err'); return; }
          if (!(price >= 0)) { toast('Precio inválido','err'); return; }
          lines.push({ description: desc, quantity: qty, unit_price: price });
        }
        if (lines.length === 0) { toast('Añade al menos una línea','err'); return; }
        const btn = document.getElementById('btn-emit');
        btn.disabled = true;
        try {
          const res = await api('POST','/api/erp/invoices',{ client_id, lines, issue_date, notes });
          toast('Factura ' + res.invoice_number + ' emitida');
          window.location.href = '/admin/invoices/' + res.id;
        } catch(e) {
          toast(e.message || 'Error emitiendo factura','err');
          btn.disabled = false;
        }
      }

      loadAll();
      </script>`;
    return c.html(adminLayout('Nueva factura', content, 'invoices', c.get('session')?.csrfToken || '', c));
  });

  // GET /admin/invoices/:id — printable invoice
  views.get('/:id', requirePerm('orders.read'), c => {
    try {
      const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(c.req.param('id'));
      if (!inv) return c.text('Factura no encontrada', 404);
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
      const sym = inv.currency_symbol || '€';

      const rows = items.map(it => `
        <tr>
          <td>${it.description}</td>
          <td style="text-align:right">${it.quantity}</td>
          <td style="text-align:right">${sym}${it.unit_price.toFixed(2)}</td>
          <td style="text-align:right">${sym}${it.total_price.toFixed(2)}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${inv.document_name} ${inv.invoice_number}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;font-size:13px;color:#1e293b;padding:40px;max-width:800px;margin:auto}
  h1{font-size:24px;font-weight:700;margin-bottom:4px}
  .sub{color:#64748b;font-size:12px;margin-bottom:32px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px}
  .label{font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:24px}
  th{background:#f8fafc;padding:8px 12px;text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0}
  td{padding:8px 12px;border-bottom:1px solid #f1f5f9}
  .totals{margin-left:auto;width:280px}
  .totals tr td:first-child{color:#64748b}
  .totals tr td:last-child{text-align:right;font-weight:600}
  .totals tr.grand td{font-size:15px;border-top:2px solid #1e293b;padding-top:10px}
  .hash{margin-top:32px;padding:12px;background:#f8fafc;border-radius:6px;font-family:monospace;font-size:10px;color:#94a3b8;word-break:break-all}
  @media print{body{padding:20px}.hash{break-inside:avoid}}
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
  <div>
    <h1>${inv.document_name}</h1>
    <div class="sub">${inv.invoice_number} &nbsp;·&nbsp; ${inv.issue_date}</div>
  </div>
  <button onclick="window.print()" style="padding:8px 16px;background:#1e293b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">Imprimir</button>
</div>

<div class="cols">
  <div>
    <div class="label">Emisor</div>
    <div><strong>${inv.company_name}</strong></div>
    ${inv.company_fiscal_id ? `<div>${inv.company_fiscal_id}</div>` : ''}
    ${inv.company_address ? `<div style="color:#64748b">${inv.company_address}</div>` : ''}
  </div>
  <div>
    <div class="label">Cliente</div>
    <div><strong>${inv.client_name || 'Cliente general'}</strong></div>
    ${inv.client_fiscal_id ? `<div>${inv.client_fiscal_id}</div>` : ''}
    ${inv.client_address ? `<div style="color:#64748b">${inv.client_address}</div>` : ''}
    ${inv.client_email ? `<div style="color:#64748b">${inv.client_email}</div>` : ''}
  </div>
</div>

<table>
  <thead><tr><th>Descripción</th><th style="text-align:right">Cant.</th><th style="text-align:right">P. unitario</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<table class="totals">
  <tr><td>Base imponible</td><td>${sym}${inv.subtotal.toFixed(2)}</td></tr>
  <tr><td>${inv.tax_name} (${inv.tax_rate}%)</td><td>${sym}${inv.tax_amount.toFixed(2)}</td></tr>
  <tr class="grand"><td>TOTAL</td><td>${sym}${inv.total.toFixed(2)}</td></tr>
</table>

${inv.notes ? `<div style="margin-top:16px;color:#64748b">${inv.notes}</div>` : ''}

<div class="hash">
  <strong>Hash Verifactu:</strong> ${inv.verifactu_hash}<br>
  <strong>Hash anterior:</strong> ${inv.prev_hash || '(primera factura)'}
</div>
</body>
</html>`;
      return c.html(html);
    } catch (e) { return c.text(e.message, 500); }
  });

  return { api, views };
}
