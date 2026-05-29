import { Hono } from 'hono';
import { createHash } from 'crypto';
import { requirePerm, logActivity } from '../../../core/auth.js';
import { validate } from '../../../core/validate.js';
import { invoiceCreateSchema, invoiceComputeSchema } from '../schemas.js';
import { getCountryConfig } from '../../../core/control-db.js';
import { adminLayout } from '../layout.js';

// A2: helper puro de cálculo de totales (IVA múltiple por línea + IRPF global).
// Devuelve subtotal, agrupado por tasa, IVA total, base de IRPF, importe IRPF
// y total final. Todo redondeado a céntimo. Es la fuente de verdad de la
// matemática fiscal de Capa 1; createInvoice y el endpoint /compute-totals
// (preview en vivo) la usan.
export function computeTotals(lines, irpfRate = 0) {
  const r2 = n => Math.round(n * 100) / 100;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Se requiere al menos una línea');
  }

  let subtotal = 0;
  const taxByRate = {};                      // { '21': {base, amount}, '10': {...}, ... }

  for (const line of lines) {
    const qty   = Number(line.quantity) || 0;
    const price = Number(line.unit_price) || 0;
    const rate  = Number(line.tax_rate) || 0;
    const base  = r2(qty * price);
    const tax   = r2(base * rate / 100);

    subtotal += base;

    const key = String(rate);
    if (!taxByRate[key]) taxByRate[key] = { rate, base: 0, amount: 0 };
    taxByRate[key].base   += base;
    taxByRate[key].amount += tax;
  }

  // Redondeos finales por grupo para evitar arrastre.
  for (const k of Object.keys(taxByRate)) {
    taxByRate[k].base   = r2(taxByRate[k].base);
    taxByRate[k].amount = r2(taxByRate[k].amount);
  }
  subtotal = r2(subtotal);

  const taxAmount  = r2(Object.values(taxByRate).reduce((s, t) => s + t.amount, 0));
  const irpfBase   = subtotal;
  const irpfAmount = r2(irpfBase * (Number(irpfRate) || 0) / 100);
  const total      = r2(subtotal + taxAmount - irpfAmount);

  return { subtotal, taxByRate, taxAmount, irpfBase, irpfAmount, total };
}

// A2: determina la "tasa principal" para invoices.tax_rate.
// - Si todas las líneas comparten la misma tasa → esa tasa.
// - Si hay mezcla → 0 (semáforo "ver desglose en invoice_items").
function mainTaxRate(taxByRate) {
  const keys = Object.keys(taxByRate);
  if (keys.length === 1) return taxByRate[keys[0]].rate;
  return 0;
}

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

// A1+A2: crear factura directa (sin pedido). Cada línea lleva su propia tasa
// de IVA; el IRPF es global y solo aplica si country='ES'. Asigna correlativo
// y hash encadenado igual que generateInvoice, pero sin tocar sales_orders.
// order_id queda NULL.
export function createInvoice(db, invoiceData) {
  const { client_id, lines, issue_date, notes = '', irpf_rate = 0 } = invoiceData;

  const client = db.prepare('SELECT id, name, fiscal_id, address, email FROM clients WHERE id=?').get(client_id);
  if (!client) throw new Error('Cliente no existe');

  const cfg = db.prepare('SELECT * FROM company_config WHERE id=1').get() || {};
  const country = (cfg.country || 'ES').toUpperCase();
  // IRPF solo aplica a tenants ES por ahora. Otros países lo ignoran silenciosamente.
  const appliedIrpfRate = country === 'ES' ? (Number(irpf_rate) || 0) : 0;

  const totals = computeTotals(lines, appliedIrpfRate);
  const headerTaxRate = mainTaxRate(totals.taxByRate);  // 0 si hay mezcla, tasa única si todas iguales

  const series    = cfg.invoice_series || 'F';
  const year      = new Date().getFullYear();
  const issueDate = issue_date || new Date().toISOString().slice(0, 10);

  const create = db.transaction(() => {
    const seq = getNextSeq(db, series, year);
    const invoice_number = `${series}${year}-${String(seq).padStart(4, '0')}`;
    const prev_hash = getPrevHash(db, series, year);
    const verifactu_hash = calcHash({
      invoice_number,
      issue_date: issueDate,
      company_fiscal_id: cfg.fiscal_id || '',
      client_fiscal_id: client.fiscal_id || '',
      total: totals.total,
      prev_hash,
    });

    const result = db.prepare(`INSERT INTO invoices
      (invoice_number, order_id, client_id, series, year, sequence, issue_date,
       company_name, company_fiscal_id, company_address,
       client_name, client_fiscal_id, client_address, client_email,
       subtotal, tax_rate, tax_name, tax_amount, total,
       currency, currency_symbol, document_name,
       verifactu_hash, prev_hash, notes,
       irpf_rate, irpf_amount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      invoice_number, null, client_id,
      series, year, seq, issueDate,
      cfg.company_name || 'Mi empresa', cfg.fiscal_id || '', cfg.address || '',
      client.name, client.fiscal_id || '', client.address || '', client.email || '',
      totals.subtotal, headerTaxRate, cfg.tax_name || 'IVA', totals.taxAmount, totals.total,
      cfg.currency || 'EUR', cfg.currency_symbol || '€', cfg.document_name || 'Factura',
      verifactu_hash, prev_hash, notes,
      appliedIrpfRate, totals.irpfAmount
    );
    const invoiceId = result.lastInsertRowid;

    const insItem = db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total_price, tax_rate, tax_amount) VALUES (?,?,?,?,?,?,?)');
    for (const line of lines) {
      const qty   = Number(line.quantity);
      const price = Number(line.unit_price);
      const rate  = Number(line.tax_rate) || 0;
      const base  = Math.round(qty * price * 100) / 100;
      const tax   = Math.round(base * rate / 100 * 100) / 100;
      insItem.run(invoiceId, line.description, qty, price, base, rate, tax);
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
      // Bug fix: la columna real en sales_orders es order_number, no reference.
      // Antes de A1 nunca había facturas en BD así que el error 500 no se notaba.
      const rows = db.prepare(`SELECT i.*, o.order_number as order_ref FROM invoices i LEFT JOIN sales_orders o ON o.id=i.order_id ORDER BY i.created_at DESC LIMIT 200`).all();
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

  // A2: POST /api/erp/invoices/compute-totals — preview en vivo desde la UI
  // Debe ir ANTES de POST '/' para que Hono no lo capture como crear factura.
  api.post('/compute-totals', requirePerm('invoices.create'), validate(invoiceComputeSchema), c => {
    try {
      const { lines, irpf_rate } = c.get('validated');
      const cfg = db.prepare('SELECT country FROM company_config WHERE id=1').get() || {};
      const country = (cfg.country || 'ES').toUpperCase();
      const appliedIrpfRate = country === 'ES' ? (Number(irpf_rate) || 0) : 0;
      return c.json(computeTotals(lines, appliedIrpfRate));
    } catch (e) {
      return c.json({ error: e.message }, 400);
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
        document.getElementById('invBody').innerHTML=f.length?f.map(r=>{
          // Facturas sin pedido (A1/A2 directas): order_id = NULL → mostrar "—" sin enlace roto.
          const pedidoCell = r.order_id
            ? '<a href="/admin/orders/'+r.order_id+'">'+(r.order_ref||r.order_id)+'</a>'
            : '<span style="color:var(--muted)">—</span>';
          return \`<tr>
          <td><strong>\${r.invoice_number}</strong></td>
          <td>\${pedidoCell}</td>
          <td>\${r.client_name||'-'}</td>
          <td style="color:var(--muted);font-size:.85rem">\${r.issue_date||'-'}</td>
          <td><strong>${sym}\${r.total?.toFixed(2)||'0.00'}</strong></td>
          <td><span class="badge \${stBadge[r.status]||''}"\>\${r.status}</span></td>
          <td><a href="/admin/invoices/\${r.id}" target="_blank" class="btn btn-secondary btn-sm">Ver</a></td>
        </tr>\`}).join(''):'<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">Sin facturas</td></tr>';
      }
      loadInvoices();
      </script>`;
    return c.html(adminLayout('Facturas', content, 'invoices', c.get('session')?.csrfToken || '', c));
  });

  // A1+A2: GET /admin/invoices/new — formulario para crear factura sin pedido
  views.get('/new', requirePerm('invoices.create'), c => {
    const cfg = db.prepare('SELECT currency_symbol, country, tax_rate, tax_name FROM company_config WHERE id=1').get() || {};
    const sym = cfg.currency_symbol || '€';
    const country = (cfg.country || 'ES').toUpperCase();
    const cc = getCountryConfig(country) || { tax_rates: '21,10,4', tax_default: 21 };
    // tax_rates en country_configs es un CSV → array de numbers ordenado desc.
    const rates = cc.tax_rates.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    const defaultRate = Number(cc.tax_default) || rates[0] || 0;
    const today = new Date().toISOString().slice(0, 10);
    const showIrpf = country === 'ES';

    const ratesJson = JSON.stringify(rates);

    const content = `
      <div class="ph">
        <h2>Nueva factura</h2>
        <a href="/admin/invoices" class="btn btn-secondary">Cancelar</a>
      </div>

      <div class="card" style="max-width:900px">
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
                  <th style="width:80px">Cant.</th>
                  <th style="width:120px">P. unit.</th>
                  <th style="width:90px">IVA</th>
                  <th style="width:100px;text-align:right">Subtotal</th>
                  <th style="width:36px"></th>
                </tr>
              </thead>
              <tbody id="lines-body"></tbody>
              <tfoot id="totals-foot">
                <tr><td colspan="4" style="text-align:right;font-weight:600;padding:.7rem 1rem">Base imponible</td>
                    <td style="text-align:right;padding:.7rem 1rem"><span id="t-subtotal">${sym}0.00</span></td>
                    <td></td></tr>
                <tr id="t-breakdown-row" style="display:none">
                    <td colspan="6" style="padding:.4rem 1rem">
                      <div id="t-breakdown" style="color:var(--muted);font-size:.85rem"></div>
                    </td></tr>
                <tr><td colspan="4" style="text-align:right;color:var(--muted);padding:.4rem 1rem">IVA total</td>
                    <td style="text-align:right;color:var(--muted);padding:.4rem 1rem"><span id="t-tax">${sym}0.00</span></td>
                    <td></td></tr>
                ${showIrpf ? `
                <tr id="t-irpf-row" style="display:none">
                    <td colspan="4" style="text-align:right;color:#e879f9;padding:.4rem 1rem">IRPF <span id="t-irpf-rate"></span>%</td>
                    <td style="text-align:right;color:#e879f9;padding:.4rem 1rem">−<span id="t-irpf">${sym}0.00</span></td>
                    <td></td></tr>
                ` : ''}
                <tr><td colspan="4" style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem">Total</td>
                    <td style="text-align:right;font-weight:700;font-size:1.05rem;padding:.7rem 1rem"><span id="t-total">${sym}0.00</span></td>
                    <td></td></tr>
              </tfoot>
            </table>
          </div>

          ${showIrpf ? `
          <div class="form-group" style="margin-top:1.25rem;max-width:280px">
            <label class="form-label">IRPF (%) — retención profesional</label>
            <select id="f-irpf" class="form-control">
              <option value="0">Sin IRPF</option>
              <option value="7">7% — primeros 3 años</option>
              <option value="15">15% — general</option>
            </select>
          </div>
          ` : ''}

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
      const RATES = ${ratesJson};            // [21, 10, 4, ...]
      const DEFAULT_RATE = ${defaultRate};
      const SHOW_IRPF = ${showIrpf};
      let clients = [];
      let services = [];                       // P3: productos de tipo 'servicio' para autofill
      let recalcTimer = null;

      async function loadAll(){
        try {
          const [cl, prods] = await Promise.all([
            api('GET','/api/erp/clients').catch(()=>[]),
            api('GET','/api/erp/products').catch(()=>[]),
          ]);
          clients = cl;
          // Solo productos de tipo servicio activos: son los que tiene sentido autorrellenar.
          services = (prods || []).filter(p => p.type === 'service' && p.status === 'active');
          const sel = document.getElementById('f-client');
          for (const cl of clients) {
            const o = document.createElement('option');
            o.value = cl.id; o.textContent = cl.name + (cl.fiscal_id ? ' — ' + cl.fiscal_id : '');
            sel.appendChild(o);
          }
        } catch(e){ toast(e.message||'Error cargando datos','err'); }
        addLine();
        if (SHOW_IRPF) {
          document.getElementById('f-irpf').addEventListener('change', scheduleRecalc);
        }
      }

      function addLine(){
        const tbody = document.getElementById('lines-body');
        const row = document.createElement('tr');
        // Tasas positivas del país + opción "Exento (0%)" al final.
        // (Filtramos el 0 que viniera del CSV de country_configs para no duplicar.)
        const normalOpts = RATES.filter(r => r > 0).map(r =>
          '<option value="'+r+'"'+(r===DEFAULT_RATE?' selected':'')+'>'+r+'%</option>'
        ).join('');
        const exemptOpt = '<option value="0">Exento (0%)</option>';
        const opts = normalOpts + exemptOpt;
        // A3: selector de servicio guardado. "" = línea libre (escrita a mano, no se guarda).
        const svcOpts = '<option value="">— Línea libre —</option>' +
          services.map(s => '<option value="'+s.id+'">'+escHtml(s.name)+' ('+SYM+Number(s.price||0).toFixed(2)+')</option>').join('');
        row.innerHTML =
          '<td>' +
            (services.length ? '<select class="form-control line-service" style="margin-bottom:.35rem" onchange="applyService(this)">'+svcOpts+'</select>' : '') +
            '<input type="text" class="form-control line-desc" placeholder="Descripción del servicio o producto"></td>' +
          '<td><input type="number" class="form-control line-qty" step="0.01" min="0.01" value="1"></td>' +
          '<td><input type="number" class="form-control line-price" step="0.01" min="0" value="0"></td>' +
          '<td><select class="form-control line-tax">'+opts+'</select></td>' +
          '<td style="text-align:right;padding:.7rem 1rem"><span class="line-subtotal">' + SYM + '0.00</span></td>' +
          '<td><button class="btn btn-danger btn-sm" onclick="this.closest(\\'tr\\').remove();scheduleRecalc()">✕</button></td>';
        tbody.appendChild(row);
        row.querySelectorAll('.line-qty, .line-price, .line-tax').forEach(inp => inp.addEventListener('input', scheduleRecalc));
        scheduleRecalc();
      }

      // P3: al elegir un producto de tipo "servicio" del catálogo, rellena la línea
      // (descripción, precio, IVA). La cantidad NO se toca (queda editable). El IRPF NO
      // lo fija el producto: se elige a mano (CANON: el IRPF no es del producto). Elegir
      // "Línea libre" no borra nada: deja lo escrito tal cual.
      function applyService(sel){
        const id = parseInt(sel.value);
        if (!id) return;
        const svc = services.find(s => s.id === id);
        if (!svc) return;
        const row = sel.closest('tr');
        row.querySelector('.line-desc').value  = svc.name;
        row.querySelector('.line-price').value = Number(svc.price || 0).toFixed(2);
        const taxSel = row.querySelector('.line-tax');
        const rate = String(Number(svc.tax_rate) || 0);
        if (![...taxSel.options].some(o => o.value === rate)) {
          const o = document.createElement('option');
          o.value = rate; o.textContent = (rate === '0' ? 'Exento (0%)' : rate + '%');
          taxSel.appendChild(o);
        }
        taxSel.value = rate;
        scheduleRecalc();
      }

      function scheduleRecalc(){
        if (recalcTimer) clearTimeout(recalcTimer);
        recalcTimer = setTimeout(doRecalc, 300);
      }

      function collectLines(){
        const lines = [];
        for (const r of document.querySelectorAll('#lines-body tr')) {
          const desc = r.querySelector('.line-desc').value || '_';     // placeholder válido para preview
          const qty   = parseFloat(r.querySelector('.line-qty').value)   || 0;
          const price = parseFloat(r.querySelector('.line-price').value) || 0;
          const rate  = parseFloat(r.querySelector('.line-tax').value)   || 0;
          lines.push({ description: desc, quantity: qty || 0.01, unit_price: price, tax_rate: rate });
          // visual subtotal por línea (sin esperar al servidor)
          r.querySelector('.line-subtotal').textContent = SYM + (qty * price).toFixed(2);
        }
        return lines;
      }

      async function doRecalc(){
        const lines = collectLines();
        if (lines.length === 0) return;
        const irpf_rate = SHOW_IRPF ? (parseFloat(document.getElementById('f-irpf').value) || 0) : 0;
        try {
          const t = await api('POST','/api/erp/invoices/compute-totals', { lines, irpf_rate });
          document.getElementById('t-subtotal').textContent = SYM + t.subtotal.toFixed(2);
          document.getElementById('t-tax').textContent      = SYM + t.taxAmount.toFixed(2);
          document.getElementById('t-total').textContent    = SYM + t.total.toFixed(2);

          // Desglose por tasa: solo si hay más de una.
          const rates = Object.values(t.taxByRate);
          const breakRow = document.getElementById('t-breakdown-row');
          if (rates.length > 1) {
            document.getElementById('t-breakdown').innerHTML =
              'Desglose IVA: ' + rates.map(x =>
                'al ' + x.rate + '% sobre ' + SYM + x.base.toFixed(2) + ' = ' + SYM + x.amount.toFixed(2)
              ).join(' &nbsp;·&nbsp; ');
            breakRow.style.display = '';
          } else {
            breakRow.style.display = 'none';
          }

          // IRPF
          if (SHOW_IRPF) {
            const irpfRow = document.getElementById('t-irpf-row');
            if (t.irpfAmount > 0) {
              document.getElementById('t-irpf-rate').textContent = irpf_rate;
              document.getElementById('t-irpf').textContent = SYM + t.irpfAmount.toFixed(2);
              irpfRow.style.display = '';
            } else {
              irpfRow.style.display = 'none';
            }
          }
        } catch(e) {
          // Silencioso: si la línea está incompleta (precio 0, etc.) no spameamos toasts.
        }
      }

      async function emitInvoice(){
        const client_id = parseInt(document.getElementById('f-client').value);
        if (!client_id) { toast('Selecciona un cliente','err'); return; }
        const issue_date = document.getElementById('f-date').value || undefined;
        const notes = document.getElementById('f-notes').value || '';
        const irpf_rate = SHOW_IRPF ? (parseFloat(document.getElementById('f-irpf').value) || 0) : 0;
        const lines = [];
        for (const r of document.querySelectorAll('#lines-body tr')) {
          const desc = r.querySelector('.line-desc').value.trim();
          const qty = parseFloat(r.querySelector('.line-qty').value);
          const price = parseFloat(r.querySelector('.line-price').value);
          const rate = parseFloat(r.querySelector('.line-tax').value) || 0;
          if (!desc) { toast('Falta descripción en una línea','err'); return; }
          if (!(qty > 0)) { toast('Cantidad debe ser > 0','err'); return; }
          if (!(price >= 0)) { toast('Precio inválido','err'); return; }
          lines.push({ description: desc, quantity: qty, unit_price: price, tax_rate: rate });
        }
        if (lines.length === 0) { toast('Añade al menos una línea','err'); return; }
        const btn = document.getElementById('btn-emit');
        btn.disabled = true;
        try {
          const res = await api('POST','/api/erp/invoices',{ client_id, lines, issue_date, notes, irpf_rate });
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
  .status-pill{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;margin-top:4px}
  .status-emitida{background:#dcfce7;color:#166534}
  .status-rectificada{background:#fef3c7;color:#92400e}
  .status-anulada{background:#fee2e2;color:#991b1b}
  .actions{display:flex;gap:8px}
  .btn-primary{padding:8px 16px;background:#1e293b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;text-decoration:none}
  .btn-secondary{padding:8px 16px;background:#fff;color:#1e293b;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;font-size:13px;text-decoration:none}
  @media print{body{padding:20px}.hash{break-inside:avoid}.actions{display:none}.status-pill{display:none}}
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
  <div>
    <h1>${inv.document_name}</h1>
    <div class="sub">${inv.invoice_number}</div>
    <div class="status-pill status-${inv.status}">${inv.status === 'emitida' ? 'Emitida' : inv.status === 'rectificada' ? 'Rectificada' : 'Anulada'} el ${inv.issue_date}</div>
  </div>
  <div class="actions">
    <a href="/admin/invoices" class="btn-secondary">← Volver al listado</a>
    <button onclick="window.print()" class="btn-primary">Imprimir</button>
  </div>
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

${(() => {
  // Tres casos:
  // (1) Items con tasa registrada (A1+A2) → desglose desde items. 1 row si única tasa,
  //     N rows si mezcla. Fila al 0% se etiqueta "Exento de IVA".
  // (2) Factura vieja sin tasa en items pero con tax_rate global → resumen simple.
  // (3) Factura toda exenta (items todos al 0%) → "Exento de IVA".
  let taxBlock = '';
  const itemsHaveTax = items.length > 0 &&
    items.some(it => Number(it.tax_rate) > 0 || Number(it.tax_amount) > 0);

  if (itemsHaveTax) {
    const groups = {};
    for (const it of items) {
      const r = Number(it.tax_rate) || 0;
      if (!groups[r]) groups[r] = { base: 0, amount: 0 };
      groups[r].base   += Number(it.total_price) || 0;
      groups[r].amount += Number(it.tax_amount)  || 0;
    }
    taxBlock = Object.keys(groups).sort((a,b) => b-a).map(r => {
      const base = groups[r].base.toFixed(2);
      if (Number(r) === 0) {
        return `<tr><td>Exento de IVA (sobre ${sym}${base})</td><td>${sym}0.00</td></tr>`;
      }
      return `<tr><td>${inv.tax_name} ${r}% (sobre ${sym}${base})</td><td>${sym}${groups[r].amount.toFixed(2)}</td></tr>`;
    }).join('');
  } else if (inv.tax_rate > 0) {
    taxBlock = `<tr><td>${inv.tax_name} (${inv.tax_rate}%)</td><td>${sym}${inv.tax_amount.toFixed(2)}</td></tr>`;
  } else if (items.length > 0) {
    // Factura completa al 0% — A2 con todas las líneas exentas.
    const totalBase = items.reduce((s, it) => s + (Number(it.total_price) || 0), 0);
    taxBlock = `<tr><td>Exento de IVA (sobre ${sym}${totalBase.toFixed(2)})</td><td>${sym}0.00</td></tr>`;
  } else {
    taxBlock = `<tr><td>${inv.tax_name}</td><td>${sym}${inv.tax_amount.toFixed(2)}</td></tr>`;
  }

  const irpfBlock = (Number(inv.irpf_amount) > 0)
    ? `<tr><td style="color:#9333ea">IRPF (${inv.irpf_rate}%)</td><td style="color:#9333ea">−${sym}${inv.irpf_amount.toFixed(2)}</td></tr>`
    : '';
  return `<table class="totals">
  <tr><td>Base imponible</td><td>${sym}${inv.subtotal.toFixed(2)}</td></tr>
  ${taxBlock}
  ${irpfBlock}
  <tr class="grand"><td>TOTAL</td><td>${sym}${inv.total.toFixed(2)}</td></tr>
</table>`;
})()}

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
