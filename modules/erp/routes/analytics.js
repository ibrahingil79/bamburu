import { Hono } from 'hono';
import { safeError } from '../../../core/errors.js';
import { adminLayout, skeletonRows } from '../layout.js';
import { requirePerm } from '../../../core/auth.js';
import { ventasResumen, topProductos, ventasPorDia, ventasCsvRows } from '../ventas-metrics.js';   // PIEZA C: ventas desde la cadena nueva (facturas)

export function createAnalyticsRoutes(db, cfg = {}) {
  const sym = cfg.sym || '€';
  const api = new Hono();
  const views = new Hono();

  api.get('/overview', requirePerm('analytics.read'), c => {
    try {
      // PIEZA C — ingresos/nº pedidos/ticket medio desde la cadena nueva (facturas que cuentan).
      const v = ventasResumen(db);
      return c.json({
        totalRevenue: v.total,                              // total facturado (con IVA)
        totalOrders: v.count,
        avgOrder: v.count ? Math.round(v.total / v.count * 100) / 100 : 0,
        totalClients: db.prepare("SELECT COUNT(*) as v FROM clients").get().v,
        totalProducts: db.prepare("SELECT COUNT(*) as v FROM products WHERE status='active'").get().v,
        lowStock: db.prepare("SELECT COUNT(*) as v FROM products WHERE stock<5 AND status='active'").get().v,
      });
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/sales-by-period', requirePerm('analytics.read'), c => {
    try {
      const days = parseInt(c.req.query('days') || '30');
      return c.json(ventasPorDia(db, days));   // PIEZA C — ventas/día desde facturas que cuentan
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/best-sellers', requirePerm('analytics.read'), c => {
    try {
      const limit = parseInt(c.req.query('limit') || '10');
      return c.json(topProductos(db, { limit }));   // PIEZA C — top productos desde líneas de facturas que cuentan
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/stock-report', requirePerm('analytics.read'), c => {
    try {
      return c.json(db.prepare("SELECT p.name, p.sku, p.stock, p.price, (p.stock*p.price) as inventory_value, c.name as category FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.status='active' ORDER BY p.stock ASC").all());
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  // CSV exports
  api.get('/export/sales', requirePerm('analytics.read'), c => {
    try {
      // PIEZA C — una fila por línea de las facturas que cuentan (serie = origen del documento).
      const rows = ventasCsvRows(db);
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const h = ['Factura','Fecha','Estado','Serie','Cliente','Producto','Cantidad','Precio_Unitario','Total'];
      const r = rows.map(x => [q(x.invoice_number),q(x.issue_date),q(x.status),q(x.series),q(x.client),q(x.product_name),x.quantity,x.unit_price,x.total].join(','));
      return c.body([h.join(','),...r].join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="ventas.csv"'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/export/products', requirePerm('analytics.read'), c => {
    try {
      const rows = db.prepare('SELECT p.name,p.sku,p.price,p.stock,p.status,p.type,c.name as category FROM products p LEFT JOIN categories c ON p.category_id=c.id ORDER BY p.name').all();
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const h = ['Nombre','SKU','Precio','Stock','Estado','Tipo','Categoria'];
      const r = rows.map(x => [q(x.name),q(x.sku),x.price,x.stock,q(x.status),q(x.type),q(x.category)].join(','));
      return c.body([h.join(','),...r].join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="productos.csv"'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  api.get('/export/clients', requirePerm('analytics.read'), c => {
    try {
      const rows = db.prepare('SELECT c.name,c.fiscal_id,c.email,c.phone,c.city,c.country,g.name as grupo,c.total_spent FROM clients c LEFT JOIN client_groups g ON c.group_id=g.id ORDER BY c.total_spent DESC').all();
      const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
      const h = ['Nombre','ID_Fiscal','Email','Teléfono','Ciudad','País','Grupo','Total_Gastado'];
      const r = rows.map(x => [q(x.name),q(x.fiscal_id),q(x.email),q(x.phone),q(x.city),q(x.country),q(x.grupo),x.total_spent].join(','));
      return c.body([h.join(','),...r].join('\n'), 200, {'Content-Type':'text/csv','Content-Disposition':'attachment; filename="clientes.csv"'});
    } catch(e) { return c.json({error:safeError(e)},500); }
  });

  views.get('/', requirePerm('analytics.read'), c => {
    const sym = db.prepare('SELECT currency_symbol FROM company_config WHERE id=1').get()?.currency_symbol || '€';
    const content = `
      <div class="ph"><h2>Analítica</h2>
        <div style="display:flex;gap:.5rem">
          <select class="form-control" id="periodSel" style="width:auto" onchange="loadCharts()">
            <option value="7">Últimos 7 días</option>
            <option value="30" selected>Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
          </select>
        </div>
      </div>

      <div class="grid ga" style="margin-bottom:1.5rem" id="kpiRow">
        <div class="kpi"><div class="kpi-label">Ingresos</div><div class="kpi-val" id="kRev" style="color:var(--ok)">-</div></div>
        <div class="kpi"><div class="kpi-label">Pedidos</div><div class="kpi-val" id="kOrd">-</div></div>
        <div class="kpi"><div class="kpi-label">Ticket medio</div><div class="kpi-val" id="kAvg">-</div></div>
        <div class="kpi"><div class="kpi-label">Clientes</div><div class="kpi-val" id="kCli">-</div></div>
      </div>

      <div class="grid g2" style="margin-bottom:1.5rem">
        <div class="card">
          <div class="card-head"><h3>Ventas por período</h3></div>
          <div class="card-body" style="height:240px"><canvas id="salesChart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Productos más vendidos</h3></div>
          <div class="card-body" style="height:240px"><canvas id="topChart"></canvas></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-head"><h3>Informe de stock</h3>
          <div style="display:flex;gap:.5rem">
            <a href="/api/erp/analytics/export/products" class="btn btn-secondary btn-sm">CSV Productos</a>
            <a href="/api/erp/analytics/export/sales" class="btn btn-secondary btn-sm">CSV Ventas</a>
            <a href="/api/erp/analytics/export/clients" class="btn btn-secondary btn-sm">CSV Clientes</a>
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th>SKU</th><th>Categoría</th><th>Stock</th><th>Precio</th><th>Valor en inventario</th></tr></thead>
          <tbody id="stockBody">${skeletonRows(6)}</tbody>
        </table></div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
      <script>
      let salesChartInst=null,topChartInst=null;
      async function loadCharts(){
        const days=document.getElementById('periodSel').value;
        const [ov,period,top,stock]=await Promise.all([
          api('GET','/api/erp/analytics/overview').catch(()=>({})),
          api('GET','/api/erp/analytics/sales-by-period?days='+days).catch(()=>[]),
          api('GET','/api/erp/analytics/best-sellers?limit=8').catch(()=>[]),
          api('GET','/api/erp/analytics/stock-report').catch(()=>[])
        ]);
        document.getElementById('kRev').textContent='${sym}'+Number(ov.totalRevenue||0).toFixed(2);
        document.getElementById('kOrd').textContent=ov.totalOrders||0;
        document.getElementById('kAvg').textContent='${sym}'+Number(ov.avgOrder||0).toFixed(2);
        document.getElementById('kCli').textContent=ov.totalClients||0;

        if(salesChartInst)salesChartInst.destroy();
        salesChartInst=new Chart(document.getElementById('salesChart').getContext('2d'),{type:'bar',data:{labels:period.map(d=>d.date),datasets:[{label:'${sym}',data:period.map(d=>d.total),backgroundColor:'rgba(16,185,129,.6)',borderColor:'#10b981',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'${sym}'+v}}}}});

        if(topChartInst)topChartInst.destroy();
        topChartInst=new Chart(document.getElementById('topChart').getContext('2d'),{type:'bar',data:{labels:top.map(p=>p.product_name.substring(0,15)),datasets:[{label:'Ingresos',data:top.map(p=>p.total_val),backgroundColor:'rgba(14,165,233,.6)',borderColor:'#0ea5e9',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{callback:v=>'${sym}'+v}}}}});

        document.getElementById('stockBody').innerHTML=stock.length?stock.map(p=>'<tr>'+
          '<td><strong>'+p.name+'</strong></td>'+
          '<td style="color:var(--muted)">'+(p.sku||'-')+'</td>'+
          '<td>'+(p.category||'-')+'</td>'+
          '<td><strong style="color:'+(p.stock<5?'var(--danger)':'inherit')+'">'+p.stock+'</strong></td>'+
          '<td>${sym}'+Number(p.price).toFixed(2)+'</td>'+
          '<td style="color:var(--ok);font-weight:600">${sym}'+Number(p.inventory_value||0).toFixed(2)+'</td>'+
          '</tr>').join(''):window.emptyRow(6,'Sin datos de stock todavía: aparecerán cuando tengas productos con movimiento.');
      }
      loadCharts();
      </script>`;
    return c.html(adminLayout('Analítica', content, 'analytics', c.get('session')?.csrfToken || '', c));
  });

  return { api, views };
}
